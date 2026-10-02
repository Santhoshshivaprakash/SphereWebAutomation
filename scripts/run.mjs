/**
 * Interactive Sphere test runner.
 *
 * Asks WHICH ENVIRONMENT / URL to run against (production, staging, localhost,
 * BOTH, or any full URL), then WHICH SPEC to run (or all), and launches
 * Playwright with the chosen BASE_URL.
 *
 * Choose BOTH and the whole spec runs end to end on production, then on staging,
 * finishing with a side-by-side PASS/FAIL table — so "works on prod, breaks on
 * staging" is the first thing you see. They run one after the other on purpose.
 *
 *   npm run go                 (prompts for environment + spec)
 *   npm run go:both            production AND staging, same spec, side-by-side verdict
 *   node scripts/run.mjs Account.spec.ts        (spec as arg; still prompts URL)
 *   npm run go -- --refresh    (re-fetch the course list instead of using the cache)
 *
 * Specs driven by COURSE_NAME (CourseComplete / CourseTOC / SCROM) also ask for
 * a course, and those driven by COMPETENCY_NAME (CompleteCompetency /
 * Competency) ask for a competency — either pasted in, or picked from that
 * environment's live catalogue. Pick several and the spec runs once per pick.
 *
 * If BASE_URL is already set in the environment the URL prompt is skipped;
 * likewise COURSE_NAME / COMPETENCY_NAME skip their prompt.
 */
import { readdirSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promptForCourses, promptForCompetencies } from './lib/course-picker.mjs';
import { credentialsFor } from './lib/env-login.mjs';
import { writeBothReport } from './lib/both-report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load .env HERE, not just inside Playwright.
//
// The competency/course pickers below resolve an account through
// credentialsFor(), which reads TEST_USER_EMAIL & co. Without this the runner's
// own process has none of them, so the picker silently fell through to the last
// resort — config/accounts.json — and read a different learner's dashboard than
// the spec then signed in as.
require('dotenv').config({ path: resolve(__dirname, '..', '.env') });

function ask(query) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let done = false;
    const finish = (a) => { if (done) return; done = true; rl.close(); res((a || '').trim()); };
    // Piped answers that run out hit EOF with no answer; resolve empty (take the
    // default) instead of hanging, which exits node with code 13. Only for
    // non-TTY stdin — on a real terminal 'close' also fires on Ctrl+C, and there
    // it must stay a cancel.
    if (!process.stdin.isTTY) rl.on('close', () => finish(''));
    rl.question(query, finish);
  });
}

// Environments the scripts can run against. Add more here as needed.
const BASE_URLS = [
  ['Sphere PRODUCTION', 'https://sphere.aastrika.org'],
  ['Sphere STAGING',    'https://portal-staging.aastrika.org'],
  ['Sphere UAT',        'https://uat.aastrika.org'],
  ['Localhost',         'http://localhost:3000'],
];
const PROD = BASE_URLS[0][1];
const STAGING = BASE_URLS[1][1];

/**
 * The hosts THIS suite belongs to.
 *
 * e-kshamata is a DIFFERENT portal with its own suite in
 * ../EkshamataWebAutomation: different pages, different accounts, its own user
 * provisioning. Sphere specs pointed at it fail for reasons that have nothing
 * to do with Sphere — and worse, a "create account" run there would provision
 * the new user on the wrong portal. Both suites read the same BASE_URL
 * variable, and in PowerShell `$env:BASE_URL=…` outlives the command that set
 * it, so a value left over from an e-kshamata run silently captures this one.
 */
const SPHERE_HOSTS = [
  /^sphere\.aastrika\.org$/i,
  /^portal-staging\.aastrika\.org$/i,
  /^localhost$/i,
  /^127\.0\.0\.1$/,
];
const isSphereHost = (url) => {
  try { return SPHERE_HOSTS.some((re) => re.test(new URL(url).hostname)); }
  catch { return false; }
};

/**
 * Which environment(s) to run against — one, or BOTH.
 *
 * "Both" runs the whole chosen spec end to end on production and then on
 * staging, and prints a side-by-side verdict. They run one after the other, not
 * at once: two headed browsers racing each other on the same machine makes the
 * slower one time out and report a failure that is not real.
 *
 * @returns {Promise<string[]>} base URLs, in run order
 */
async function pickBaseUrls() {
  if (process.env.BASE_URL) {
    // BASE_URL=both is the non-interactive way in (CI, or a repeat run).
    if (/^both$/i.test(process.env.BASE_URL)) return [PROD, STAGING];
    // BASE_URL set in the SHELL silently skips this prompt — and in PowerShell
    // `$env:BASE_URL=…` outlives the command that set it, so a value from
    // earlier in the session keeps pinning every later run to one environment.
    // Say so, loudly, instead of quietly running somewhere unexpected.
    const pinned = process.env.BASE_URL.replace(/\/+$/, '');

    // Not a Sphere host → almost certainly left over from the e-kshamata suite.
    // Ignore it and ask, rather than run Sphere specs against another portal.
    if (!isSphereHost(pinned)) {
      const host = (() => { try { return new URL(pinned).hostname; } catch { return pinned; } })();
      console.log(`\n⚠️  BASE_URL is set to ${pinned}`);
      console.log(`   ${host} is NOT a Sphere portal — Sphere and e-kshamata are`);
      console.log('   separate portals with separate accounts, so this suite cannot run');
      console.log('   there (and would create any new user on the wrong portal).');
      console.log('   → Ignoring it and asking below.');
      console.log('   e-kshamata has its own suite:  cd ..\\EkshamataWebAutomation');
      console.log('   To clear it:   PowerShell  Remove-Item Env:BASE_URL');
      console.log('                  bash        unset BASE_URL');
      delete process.env.BASE_URL;
      return pickBaseUrls();
    }

    console.log(`\n📌 BASE_URL is already set — running ONLY on ${pinned}`);
    console.log('   No environment prompt, and no both-environment run.');
    console.log('   To choose again:   PowerShell  Remove-Item Env:BASE_URL');
    console.log('                      bash        unset BASE_URL');
    console.log('   Or force both:     npm run go:both');
    return [pinned];
  }
  console.log('\n🌐 Which environment / URL should the scripts run against?\n');
  BASE_URLS.forEach(([name, url], i) => console.log(`  ${i + 1}. ${name.padEnd(22)} ${url}`));
  console.log(`  ${BASE_URLS.length + 1}. BOTH${' '.repeat(18)} production, then staging — the same spec on each`);
  const sel = await ask('\n  Number, name, "both", or a full https URL (Enter = 1) : ');

  if (/^both$/i.test(sel) || Number(sel) === BASE_URLS.length + 1) return [PROD, STAGING];
  let url;
  if (!sel) url = BASE_URLS[0][1];
  else if (/^\d+$/.test(sel)) url = (BASE_URLS[Number(sel) - 1] || [])[1];
  else if (/^https?:\/\//i.test(sel)) url = sel.trim().replace(/\/+$/, '');
  else url = (BASE_URLS.find(([n]) => n.toLowerCase().includes(sel.toLowerCase())) || [])[1];
  if (!url) { console.error(`Invalid URL selection: "${sel}"`); process.exit(1); }
  return [url];
}

const ENVS = await pickBaseUrls();
const BOTH = ENVS.length > 1;
// The catalogue prompts read ONE environment's course list — the first, which is
// production when running both.
const BASE_URL = ENVS[0];
if (BOTH) {
  console.log(`\n  → running on BOTH:  ${ENVS.join('  then  ')}`);
}

/**
 * Every spec this runner can launch, including the ones in SUBFOLDERS —
 * tests/Profile/ was invisible here for as long as this only read the top level.
 *
 * api/ and monitor/ are left out on purpose: playwright.config.ts gives them
 * their own projects, and this runner launches --project=Chrome, which ignores
 * exactly those two folders. Run them with `npm run test:api` / `test:monitor`.
 */
function findSpecs(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (['api', 'monitor', 'helpers', 'fixtures', 'pages'].includes(entry.name)) continue;
      out.push(...findSpecs(resolve(dir, entry.name), rel));
    } else if (entry.name.endsWith('.spec.ts')) {
      out.push(rel);
    }
  }
  return out;
}

// Top-level specs first, then the foldered ones, each group alphabetical — so
// the everyday specs stay where they have always been in the list.
const specs = findSpecs(resolve(__dirname, '../tests'))
  .sort((a, b) => (a.includes('/') === b.includes('/') ? a.localeCompare(b) : a.includes('/') ? 1 : -1));

let spec = process.argv[2];
if (spec && spec.startsWith('--')) spec = undefined;   // flags are not spec names
if (!spec) {
  console.log('\n🧪 Which spec should I run?\n');
  console.log('   0. ALL specs');
  specs.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${s}`));
  const sel = await ask('\n  Number or name (Enter = 0 = all) : ');
  if (!sel || sel === '0') spec = '';
  else if (/^\d+$/.test(sel)) spec = specs[Number(sel) - 1];
  else spec = specs.find((s) => s.toLowerCase().includes(sel.toLowerCase()));
  if (sel && sel !== '0' && !spec) { console.error(`No spec matched "${sel}".`); process.exit(1); }
}

const target = spec ? `tests/${spec.replace(/^tests\//, '')}` : '';

// These specs are driven by COURSE_NAME — ask for a course instead of failing.
const NEEDS_COURSE = ['CourseComplete.spec.ts', 'CourseTOC.spec.ts', 'SCROM.spec.ts'];
// …and these by COMPETENCY_NAME. Competency.spec.ts can manage without one
// (it falls back to the first Re-Assess card), so there the prompt is skippable.
const NEEDS_COMPETENCY = { 'CompleteCompetency.spec.ts': false, 'Competency.spec.ts': true };

const specName = spec ? spec.replace(/^tests\//, '') : '';
const refresh = process.argv.includes('--refresh');

// "ALL specs" includes the course-driven and competency-driven ones, so it needs
// BOTH names too. Without this they started with nothing set and failed on every
// ALL run — the prompts only fired when a single spec was chosen by name.
const runningAll = !specName;

let courses = [''];
if ((specName && NEEDS_COURSE.includes(specName)) || runningAll) {
  if (process.env.COURSE_NAME) {
    console.log(`\n🎓 Course from env: "${process.env.COURSE_NAME}"`);
  } else {
    if (runningAll) {
      console.log(`\n🎓 ALL specs includes ${NEEDS_COURSE.join(', ')} — they need a course.`);
    }
    courses = await promptForCourses({ apiOrigin: new URL(BASE_URL).origin, ask, refresh });
    // One course for the whole suite: picking several would re-run every spec
    // once per course, which is not what "run everything" means.
    if (runningAll && courses.length > 1) {
      console.log(`   Using the first pick for the whole run: "${courses[0]}"`);
      courses = [courses[0]];
    }
  }
}

// The runner loops over whichever list is in play; competencies use their own
// env var, so keep them separate from the course list.
let competencies = [];
if ((specName && specName in NEEDS_COMPETENCY) || runningAll) {
  if (process.env.COMPETENCY_NAME) {
    console.log(`\n🧗 Competency from env: "${process.env.COMPETENCY_NAME}"`);
  } else {
    if (runningAll) {
      console.log(`\n🧗 ALL specs includes ${Object.keys(NEEDS_COMPETENCY).join(', ')} — they need a competency.`);
    }
    competencies = await promptForCompetencies({
      apiOrigin: new URL(BASE_URL).origin,
      ask,
      refresh,
      // Optional on an ALL run: the competency specs can fall back to the first
      // card on the dashboard, and a whole-suite run should not be blocked here.
      optional: runningAll ? true : NEEDS_COMPETENCY[specName],
    });
    if (runningAll && competencies.length > 1) {
      console.log(`   Using the first pick for the whole run: "${competencies[0]}"`);
      competencies = [competencies[0]];
    }
    if (!competencies.length) {
      console.log('\n🧗 No competency chosen — the spec clicks the FIRST Assess/Re-Assess card on the');
      console.log('   dashboard, so whichever competency sits at the top is the one that opens.');
    }
  }
}

// ONE account for the whole run.
//
// The pickers above read a competency/course list through credentialsFor(), and
// the spec resolved its own login separately — so the list came from one
// learner's dashboard while the spec signed in as another, and picking a
// competency that was "on the dashboard" opened nothing. Resolve once here and
// hand the SAME account to the spec.
// COMPETENCY_USER_* is the per-flow override the competency spec honours first.
// The runner has to honour it at the SAME priority, or the picker reads one
// learner's dashboard while the spec signs in as another.
const account = (process.env.COMPETENCY_USER_EMAIL && process.env.COMPETENCY_USER_PASSWORD)
  ? {
    email: process.env.COMPETENCY_USER_EMAIL,
    password: process.env.COMPETENCY_USER_PASSWORD,
    source: 'COMPETENCY_USER_EMAIL',
  }
  : credentialsFor(BASE_URL);
if (account) {
  console.log(`\n👤 Account for this run: ${account.email}  (from ${account.source})`);
  if (process.env.TEST_USER_EMAIL && process.env.TEST_USER_EMAIL !== account.email) {
    console.log(`   note: .env also sets TEST_USER_EMAIL=${process.env.TEST_USER_EMAIL}, but`);
    console.log(`         ${account.source} is more specific and wins. Clear it to use TEST_USER_EMAIL.`);
  }
} else {
  console.log('\n👤 No account resolved — the spec will fall back to its own default.');
}

const cli = require.resolve('@playwright/test/cli');

function runPlaywright(baseUrl, extraEnv, specList = target ? [target] : []) {
  return new Promise((res) => {
    // Headed by default — you are meant to watch these. HEADLESS=true for CI
    // or an unattended both-environment sweep.
    const headed = process.env.HEADLESS === 'true' ? [] : ['--headed'];
    const args = [cli, 'test', ...specList, '--project=Chrome', ...headed];
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        // The account the picker used, so the spec signs in as the same learner.
        // COMPETENCY_USER_* still wins inside the spec if it is set.
        ...(account ? { TEST_USER_EMAIL: account.email, TEST_USER_PASSWORD: account.password } : {}),
        ...extraEnv,
      },
    });
    child.on('exit', (code) => res(code ?? 0));
  });
}

const envLabel = (url) => (BASE_URLS.find(([, u]) => u === url) ?? [new URL(url).hostname])[0];

// One run per selected course, or per selected competency, or a single plain run.
const targets = runningAll
  // ONE pass over the whole suite, carrying BOTH names — the course specs read
  // COURSE_NAME and the competency specs read COMPETENCY_NAME from the same run.
  ? [{
    label: [courses[0], competencies[0]].filter(Boolean).join(' + '),
    env: {
      ...(courses[0] ? { COURSE_NAME: courses[0] } : {}),
      ...(competencies[0] ? { COMPETENCY_NAME: competencies[0] } : {}),
    },
  }]
  : competencies.length
    ? competencies.map((name) => ({ label: name, env: { COMPETENCY_NAME: name } }))
    : courses.map((name) => ({ label: name, env: name ? { COURSE_NAME: name } : {} }));

// Environment is the OUTER loop: production finishes completely before staging
// starts, so the two never compete for the machine.
// A BOTH run also emits one machine-readable result file per environment, which
// becomes the side-by-side report at the end. Kept out of single-environment
// runs so they behave exactly as before.
const REPORT_DIR = resolve(__dirname, '..', 'test-reports', 'both-env');
const jsonFor = (baseUrl) =>
  resolve(REPORT_DIR, `.results_${new URL(baseUrl).hostname.replace(/[^a-z0-9]/gi, '_')}.json`);
if (BOTH) mkdirSync(REPORT_DIR, { recursive: true });

// ── ALL specs = the user's journey, in order, as ONE new user ───────────
// Playwright orders files alphabetically inside a run (Account first, before any
// account exists), so ALL runs these as separate, ordered invocations:
//   public page → create account → My Courses → course completion →
//   competency dashboard → Account tab → everything else
// The account is created by positiveflow (signup + full onboarding — create-account
// stops at T&C, and authedTest rejects a user with unfinished onboarding), which
// saves its session. Every later step runs with USE_FRESH_USER=1, so it signs in
// as THAT user on whichever environment was picked — and fails loudly rather than
// falling back to an .env account that belongs to another backend.
const SIGNUP_ONLY = ['create-account.spec.ts', 'OTP.spec.ts', 'yopmail.spec.ts'];
// Left out of ALL for now (still runnable on its own from the menu).
const NOT_IN_ALL = ['SCROM.spec.ts'];
function journeySteps(competencyChosen) {
  const used = new Set(['PublicPage.spec.ts', 'public-login.spec.ts', 'positiveflow.spec.ts', 'Mycourse.spec.ts',
    'CourseComplete.spec.ts', 'Competency.spec.ts', 'CompleteCompetency.spec.ts', 'Account.spec.ts',
    'RoleCourses.spec.ts', ...SIGNUP_ONLY, ...NOT_IN_ALL]);
  const t = (s) => `tests/${s}`;
  const rest = specs.filter((s) => !used.has(s));
  return [
    { name: 'Public page', specs: [t('PublicPage.spec.ts'), t('public-login.spec.ts')] },
    { name: 'Create account (signup + onboarding)', specs: [t('positiveflow.spec.ts')], creates: true },
    { name: 'My Courses', specs: [t('Mycourse.spec.ts')], fresh: true },
    { name: 'Course completion', specs: [t('CourseComplete.spec.ts')], fresh: true },
    { name: 'Competency dashboard', specs: [t('Competency.spec.ts'), ...(competencyChosen ? [t('CompleteCompetency.spec.ts')] : [])], fresh: true },
    { name: 'Account tab', specs: [t('Account.spec.ts')], fresh: true },
    // The rest: other signed-in specs, then the role sweep (it changes the user's
    // role), then the specs that sign up accounts of their own.
    { name: 'Everything else', specs: [...rest.map(t), t('RoleCourses.spec.ts')], fresh: true },
    { name: 'Other signup flows', specs: SIGNUP_ONLY.map(t) },
  ].filter((s) => s.specs.length);
}

/** Run the journey on one environment; returns the worst exit code. */
async function runJourney(baseUrl, targetEnv, jsonFile) {
  const steps = journeySteps(Boolean(targetEnv.COMPETENCY_NAME));
  const stepJson = [];
  const summary = [];
  let haveUser = true;
  for (const [i, step] of steps.entries()) {
    console.log(`\n${'─'.repeat(70)}\n  STEP ${i + 1}/${steps.length} — ${step.name}\n${'─'.repeat(70)}`);
    if (step.fresh && !haveUser) {
      console.log('  ⏭  skipped — the account could not be created, so there is no user to run as');
      summary.push({ name: step.name, code: 'skipped' });
      continue;
    }
    const env = {
      ...targetEnv,
      // Competency content belongs to the role: ANM/MPW sees the maternal-care
      // competencies (Normal delivery…). PROFILE_DESIGNATION overrides it.
      PROFILE_DESIGNATION: process.env.PROFILE_DESIGNATION || 'ANM/MPW',
      ...(step.fresh ? { USE_FRESH_USER: '1' } : {}),
      ...(jsonFile ? { JSON_OUT: `${jsonFile}.step${i + 1}.json` } : {}),
    };
    // Signup has occasional flaky steps (slow city list, Terms page language),
    // so it gets a second try — with a brand-new user.
    let code = await runPlaywright(baseUrl, env, step.specs);
    if (code !== 0 && step.creates) {
      console.log('\n  ↻ signup failed — retrying once with a new user');
      code = await runPlaywright(baseUrl, env, step.specs);
    }
    if (step.creates && code !== 0) haveUser = false;
    if (jsonFile) stepJson.push(env.JSON_OUT);
    summary.push({ name: step.name, code });
  }
  console.log(`\n  Journey on ${baseUrl}:`);
  for (const s of summary) console.log(`    ${s.code === 0 ? '✅' : s.code === 'skipped' ? '⏭ ' : '❌'}  ${s.name}`);
  // One results file per environment, as the both-environment report expects:
  // the steps' files merged into one (their suites side by side).
  if (jsonFile) {
    const merged = { suites: [], errors: [] };
    for (const f of stepJson) {
      try {
        const r = JSON.parse(readFileSync(f, 'utf-8'));
        merged.suites.push(...(r.suites || []));
        merged.errors.push(...(r.errors || []));
        if (!merged.config && r.config) merged.config = r.config;
      } catch { /* a step that never started wrote no file */ }
    }
    writeFileSync(jsonFile, JSON.stringify(merged));
  }
  return summary.some((s) => s.code !== 0) ? 1 : 0;
}

const results = [];
for (const baseUrl of ENVS) {
  if (BOTH) {
    console.log(`\n${'█'.repeat(70)}`);
    console.log(`  ${envLabel(baseUrl).toUpperCase()}  —  ${baseUrl}`);
    console.log(`${'█'.repeat(70)}`);
  }
  for (const [n, t] of targets.entries()) {
    if (targets.length > 1) {
      console.log(`\n${'═'.repeat(70)}`);
      console.log(`  [${n + 1}/${targets.length}]  ${t.label}`);
      console.log(`${'═'.repeat(70)}`);
    }
    console.log(`\n▶  Running ${spec || 'ALL specs'} on ${baseUrl}${t.label ? ` — "${t.label}"` : ''}\n`);
    if (runningAll) {
      results.push({ baseUrl, courseName: t.label, code: await runJourney(baseUrl, t.env, BOTH ? jsonFor(baseUrl) : null) });
      continue;
    }
    const extra = BOTH ? { ...t.env, JSON_OUT: jsonFor(baseUrl) } : t.env;
    results.push({ baseUrl, courseName: t.label, code: await runPlaywright(baseUrl, extra) });
  }
}

if (results.length > 1) {
  console.log(`\n${'═'.repeat(70)}\n  SUMMARY — ${spec || 'ALL specs'}\n${'═'.repeat(70)}`);
  if (BOTH) {
    // Side by side, so "passes on production, fails on staging" is the thing you
    // read first — that is the whole point of running both.
    const width = Math.max(...targets.map((t) => (t.label || 'run').length), 4);
    console.log(`  ${'WHAT'.padEnd(width)}   ${ENVS.map((u) => envLabel(u).padEnd(22)).join('')}`);
    for (const t of targets) {
      const cells = ENVS.map((u) => {
        const r = results.find((x) => x.baseUrl === u && x.courseName === t.label);
        return (r ? (r.code === 0 ? '✅ PASS' : '❌ FAIL') : '—').padEnd(22);
      });
      console.log(`  ${(t.label || 'run').padEnd(width)}   ${cells.join('')}`);
    }
    const differs = targets.filter((t) => {
      const codes = ENVS.map((u) => results.find((x) => x.baseUrl === u && x.courseName === t.label)?.code);
      return new Set(codes).size > 1;
    });
    console.log('');
    if (differs.length) {
      console.log(`  ⚠️  ${differs.length} differ between the environments: ${differs.map((d) => d.label || spec || 'run').join(', ')}`);
      console.log('      That is a real difference between production and staging — start there.');
    } else {
      console.log('  Both environments agree on every run.');
    }

    // ── one report covering BOTH environments, test by test ──
    try {
      const report = writeBothReport({
        spec: spec || '',
        envs: ENVS.map((u) => ({
          label: envLabel(u),
          baseUrl: u,
          jsonFile: jsonFor(u),
          code: results.find((x) => x.baseUrl === u)?.code ?? 1,
        })),
        outDir: REPORT_DIR,
      });
      console.log(`\n  📊 Both-environment report (${report.rows} tests, ${report.differing} differing)`);
      console.log(`     ${report.htmlPath}`);
      console.log(`     ${report.textPath}`);
    } catch (e) {
      console.log(`\n  ⚠️  Could not build the combined report: ${e.message}`);
      console.log('     The per-environment reports in brand-reports/ and test-reports/ are still there.');
    }
  } else {
    for (const r of results) console.log(`  ${r.code === 0 ? '✅ PASS' : '❌ FAIL'}  ${r.courseName}`);
  }
  console.log('');
}

process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
