/**
 * Interactive course-completion runner.
 * ─────────────────────────────────────
 * Asks TWO questions before launching Playwright:
 *   1. WHICH ACCOUNT to run as (from .env / config/accounts.json, a typed
 *      email+password, a brand-new signup, or a logged-in Chrome over CDP)
 *   2. WHICH COURSE(S) to complete — the list is fetched LIVE from the
 *      platform (POST /api/content/v1/search, Live courses) and cached, so
 *      it always reflects what is actually published.
 *
 * Then it runs tests/CourseComplete.spec.ts once per selected course with
 * COURSE_NAME + the chosen credentials in the environment.
 *
 *   npm run run:course                     (prompts for account + course)
 *   npm run run:course -- --spec SCROM.spec.ts
 *   npm run run:course -- --refresh        (ignore the cached course list)
 *   npm run run:course -- --list           (just print the courses and exit)
 *   npm run run:course -- --headless
 *   npm run run:course -- --base-url https://portal-staging.aastrika.org
 *
 * Non-interactive: if COURSE_NAME is already set, the course prompt is
 * skipped; if TEST_USER_EMAIL + TEST_USER_PASSWORD (or USE_CDP=1 /
 * USE_FRESH_USER=1) are set AND stdin is not a TTY, the account prompt is
 * skipped too — so CI keeps working unchanged.
 */
import { existsSync, readFileSync } from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chooseCourses } from './lib/course-picker.mjs';
import { loadCourses } from './lib/courses.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// BASE_URL from the real shell wins over .env (which is pinned to staging for
// the auth specs); the runners have always defaulted to production.
const SHELL_BASE_URL = process.env.BASE_URL;
require('dotenv').config({ path: resolve(ROOT, '.env') });

// ── args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name) => argv.includes(name);

const SPEC      = (flag('--spec') || 'CourseComplete.spec.ts').replace(/^tests\//, '');
const HEADLESS  = has('--headless');
const REFRESH   = has('--refresh');
const LIST_ONLY = has('--list');

const INTERACTIVE = process.stdin.isTTY && process.stdout.isTTY;

// Filled in by pickBaseUrl() before anything that talks to the platform.
let BASE_URL = '';
let API_ORIGIN = '';

// ── prompts ───────────────────────────────────────────────────────────
function ask(query) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(query, (a) => { rl.close(); res((a || '').trim()); });
  });
}

/** Same as ask(), but the typed characters are not echoed. */
function askHidden(query) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    // Once muted, swallow every redraw so the typed password never reaches the
    // terminal (readline rewrites the whole line on each keypress).
    rl._writeToOutput = function (s) { if (!muted) rl.output.write(s); };
    rl.question(query, (a) => { rl.output.write('\n'); rl.close(); res((a || '').trim()); });
    muted = true;
  });
}

const requireTTY = (what) => {
  if (INTERACTIVE) return;
  console.error(`\n✖ ${what} is needed but this is not an interactive terminal.`);
  console.error('  Set it via env instead, e.g.  $env:COURSE_NAME="AMTSL"; $env:TEST_USER_EMAIL="..."\n');
  process.exit(1);
};

// ══════════════════════════════════════════════════════════════════════
// 1. ENVIRONMENT
// ══════════════════════════════════════════════════════════════════════
const ENVIRONMENTS = [
  ['Production', 'https://sphere.aastrika.org'],
  ['Staging',    'https://portal-staging.aastrika.org'],
  ['Localhost',  'http://localhost:3000'],
];

const isLocal = () => /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(BASE_URL);

/** Ask which environment to run against. --base-url or a shell BASE_URL skips it. */
async function pickBaseUrl() {
  const preset = flag('--base-url') || SHELL_BASE_URL;
  if (preset) return preset.replace(/\/+$/, '');
  if (!INTERACTIVE) return ENVIRONMENTS[0][1];

  console.log('\n🌐 Which environment should the run use?\n');
  ENVIRONMENTS.forEach(([name, url], i) =>
    console.log(`  ${i + 1}. ${name.padEnd(11)} ${url}`));

  const sel = await ask('\n  Number, name, or a full URL (Enter = 1 = Production) : ');
  let url;
  if (!sel) url = ENVIRONMENTS[0][1];
  else if (/^\d+$/.test(sel)) url = (ENVIRONMENTS[Number(sel) - 1] ?? [])[1];
  else if (/^https?:\/\//i.test(sel)) url = sel;
  else url = (ENVIRONMENTS.find(([n]) => n.toLowerCase().startsWith(sel.toLowerCase())) ?? [])[1];

  if (!url) { console.error(`Invalid environment: "${sel}"`); process.exit(1); }
  return url.replace(/\/+$/, '');
}

// ══════════════════════════════════════════════════════════════════════
// 2. ACCOUNT
// ══════════════════════════════════════════════════════════════════════
const ACCOUNTS_FILE = resolve(ROOT, 'config', 'accounts.json');

function knownAccounts() {
  const out = [];
  const add = (email, password, source) => {
    if (!email || !password) return;
    if (out.some((a) => a.email.toLowerCase() === email.toLowerCase())) return;
    out.push({ email, password, source });
  };

  if (existsSync(ACCOUNTS_FILE)) {
    try {
      const list = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
      for (const a of Array.isArray(list) ? list : []) {
        add(a.email, a.password, a.label || 'config/accounts.json');
      }
    } catch (e) {
      console.log(`⚠️  Could not read config/accounts.json: ${e.message}`);
    }
  }

  add(process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, '.env TEST_USER_*');
  add(process.env.MONITOR_EMAIL,   process.env.MONITOR_PASSWORD,   '.env MONITOR_*');
  return out;
}

/** @returns {Promise<{label:string, env:Record<string,string>, mintFresh?:boolean}>} */
async function pickAccount() {
  const preset =
    process.env.USE_CDP === '1' ? { label: 'logged-in Chrome (USE_CDP=1)', env: {} } :
    process.env.USE_FRESH_USER === '1' ? { label: 'fresh signup (USE_FRESH_USER=1)', env: {}, mintFresh: true } :
    (process.env.TEST_USER_EMAIL && process.env.TEST_USER_PASSWORD && !INTERACTIVE)
      ? { label: `${process.env.TEST_USER_EMAIL} (from env)`, env: {} }
      : null;
  if (preset) return preset;

  requireTTY('An account');

  const accounts = knownAccounts();
  console.log('\n🔐 Which credentials should the run use?\n');
  accounts.forEach((a, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${a.email.padEnd(34)} ${a.source}`));
  const iCustom = accounts.length + 1;
  const iFresh  = accounts.length + 2;
  const iCdp    = accounts.length + 3;
  console.log(`  ${String(iCustom).padStart(2)}. Type a different email + password`);
  console.log(`  ${String(iFresh).padStart(2)}. Brand-new user  (signs up a fresh yopmail account first)`);
  console.log(`  ${String(iCdp).padStart(2)}. Already-logged-in Chrome over CDP  (port 9222)`);

  const sel = await ask(`\n  Number, or an email address (Enter = 1) : `);
  const clear = { USE_CDP: '', AUTH_VIA_API: '', USE_FRESH_USER: '', SESSION_COOKIE: '', CONNECT_SID: '' };

  const useAccount = (a) => ({
    label: a.email,
    env: { ...clear, TEST_USER_EMAIL: a.email, TEST_USER_PASSWORD: a.password },
  });

  if (!sel) {
    if (!accounts.length) { console.error('No saved accounts — pick the "type a different email" option.'); process.exit(1); }
    return useAccount(accounts[0]);
  }

  if (/^\d+$/.test(sel)) {
    const n = Number(sel);
    if (n >= 1 && n <= accounts.length) return useAccount(accounts[n - 1]);
    if (n === iCustom) {
      const email = await ask('    Email    : ');
      const password = await askHidden('    Password : ');
      if (!email || !password) { console.error('Email and password are both required.'); process.exit(1); }
      return useAccount({ email, password });
    }
    if (n === iFresh) {
      return { label: 'brand-new signup', env: { ...clear, USE_FRESH_USER: '1' }, mintFresh: true };
    }
    if (n === iCdp) {
      return { label: 'logged-in Chrome (CDP)', env: { ...clear, USE_CDP: '1' } };
    }
    console.error(`Invalid selection: ${sel}`);
    process.exit(1);
  }

  // Typed an email: reuse its saved password if we know it, else ask.
  const match = accounts.find((a) => a.email.toLowerCase() === sel.toLowerCase());
  if (match) return useAccount(match);
  const password = await askHidden('    Password : ');
  if (!password) { console.error('A password is required.'); process.exit(1); }
  return useAccount({ email: sel, password });
}

// ══════════════════════════════════════════════════════════════════════
// 3. COURSES  (live list from the chosen environment, cached for a day)
// ══════════════════════════════════════════════════════════════════════
// The catalogue itself lives in lib/courses.mjs (shared with scripts/run.mjs).

const PAGE_SIZE = 30;

/** @returns {Promise<string[]>} the course names to run */
async function pickCourses() {
  if (process.env.COURSE_NAME) {
    console.log(`🎓 Course from env: "${process.env.COURSE_NAME}"`);
    return [process.env.COURSE_NAME];
  }
  requireTTY('A course');

  const courses = await loadCourses(API_ORIGIN, { refresh: REFRESH });
  if (!courses.length) {
    const typed = await ask('\n  Could not load the list. Type the course name to run : ');
    if (!typed) { console.error('No course given.'); process.exit(1); }
    return [typed];
  }

  return chooseCourses({
    courses,
    ask,
    where: new URL(API_ORIGIN).hostname,
    pageSize: PAGE_SIZE,
  });
}

// ══════════════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════════════
const pwCli = require.resolve('@playwright/test/cli');

function runPlaywright(args, env) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [pwCli, 'test', ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => res(code ?? 1));
  });
}

BASE_URL = await pickBaseUrl();
API_ORIGIN = new URL(BASE_URL).origin;

if (LIST_ONLY) {
  const courses = await loadCourses(API_ORIGIN, { refresh: REFRESH });
  courses.forEach((c, i) => console.log(`${String(i + 1).padStart(3)}. ${c.name}`));
  process.exit(0);
}

// The localhost mirror rejects both UI login and cookie injection (419), so the
// only auth that works there is a Chrome you are already signed into.
if (isLocal()) {
  console.log(
    `\nℹ️  On localhost, UI login and cookie injection do not work — pick the\n` +
      `   "Already-logged-in Chrome over CDP" option below, with Chrome started as:\n` +
      `   & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:TEMP\\sphere-cdp"`,
  );
}

const account = await pickAccount();
const chosen = await pickCourses();

const baseEnv = {
  BASE_URL,
  ...(HEADLESS ? { HEADLESS: 'true' } : {}),
  ...account.env,
};

console.log(`\n▶  Env     : ${BASE_URL}`);
console.log(`▶  Account : ${account.label}`);
console.log(`▶  Spec    : tests/${SPEC}`);
console.log(`▶  ${(chosen.length > 1 ? 'Courses' : 'Course').padEnd(7)} : ${chosen.map((c) => `"${c}"`).join(', ')}\n`);

if (account.mintFresh && isLocal()) {
  console.error(
    `\n✖ Signup (yopmail OTP) does not work against ${BASE_URL}.\n` +
      `  Mint the user on production/staging, or pick the CDP option instead.\n`,
  );
  process.exit(1);
}

// A brand-new user has to be signed up before the course run can reuse it.
if (account.mintFresh && process.env.SKIP_MINT !== '1') {
  console.log('👤 Minting a fresh signup (tests/create-account.spec.ts → Step 5) …\n');
  const code = await runPlaywright(
    ['tests/create-account.spec.ts', '--grep', 'Step 5', '--project=Chrome'],
    { BASE_URL, ...(HEADLESS ? { HEADLESS: 'true' } : {}) },
  );
  if (code !== 0) {
    console.error('\n✖ Could not mint a fresh user — aborting.\n');
    process.exit(code);
  }
}

const results = [];
for (const [i, courseName] of chosen.entries()) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  [${i + 1}/${chosen.length}]  ${courseName}`);
  console.log(`${'═'.repeat(70)}\n`);
  const code = await runPlaywright(
    [`tests/${SPEC}`, '--project=Chrome', ...(HEADLESS ? [] : ['--headed'])],
    { ...baseEnv, COURSE_NAME: courseName },
  );
  results.push({ courseName, code });
}

if (results.length > 1) {
  console.log(`\n${'═'.repeat(70)}\n  SUMMARY\n${'═'.repeat(70)}`);
  for (const r of results) console.log(`  ${r.code === 0 ? '✅ PASS' : '❌ FAIL'}  ${r.courseName}`);
  console.log('');
}

process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
