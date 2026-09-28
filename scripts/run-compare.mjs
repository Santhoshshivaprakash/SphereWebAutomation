/**
 * Interactive environment-comparison runner.
 * ──────────────────────────────────────────
 * Asks everything scripts/compare-env.mjs needs, then runs it:
 *
 *   1. WHICH TWO ENVIRONMENTS to put side by side (or any full URL)
 *   2. SIGNED IN or public-only — and shows which account each side will use
 *   3. WHICH FEATURES to compare (all, a few, a keyword, or a one-off path)
 *   4. The run options — visual threshold, headed, catalogue parity, open report
 *
 * It prints the equivalent one-liner before running, so anything you set up
 * here can be repeated (or dropped into CI) without the prompts.
 *
 *   npm run compare                 (prompts)
 *   npm run compare -- --auth ...   (any flag skips the prompts entirely)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { credentialsFor } from './lib/env-login.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: resolve(ROOT, '.env') });

const COMPARE = resolve(__dirname, 'compare-env.mjs');
const CONFIG = resolve(ROOT, 'config', 'compare-routes.json');
const JOURNEYS = resolve(ROOT, 'config', 'compare-journeys.json');
const argv = process.argv.slice(2);
// Prompts need a real terminal. COMPARE_INTERACTIVE=1 forces them on when the
// answers are piped in (a wrapper script, or a scripted check of this flow).
const INTERACTIVE = (process.stdin.isTTY && process.stdout.isTTY) || process.env.COMPARE_INTERACTIVE === '1';

function ask(query) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(query, (a) => { rl.close(); res((a || '').trim()); });
  });
}
const yes = (answer, dflt = true) => (answer === '' ? dflt : /^y/i.test(answer));

function run(args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [COMPARE, ...args], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => res(code ?? 1));
  });
}

// ══════════════════════════════════════════════════════════════════════
// 1. ENVIRONMENTS
// ══════════════════════════════════════════════════════════════════════
const ENVIRONMENTS = [
  ['Production', 'https://sphere.aastrika.org'],
  ['Staging', 'https://portal-staging.aastrika.org'],
  ['Localhost', 'http://localhost:3000'],
];

async function pickEnv(which, dflt) {
  console.log(`\n🌐 ${which} environment\n`);
  ENVIRONMENTS.forEach(([name, url], i) => console.log(`  ${i + 1}. ${name.padEnd(11)} ${url}`));
  const sel = await ask(`\n  Number, name, or a full URL (Enter = ${dflt}) : `);
  let url;
  if (!sel) url = (ENVIRONMENTS.find(([n]) => n === dflt) ?? [])[1];
  else if (/^\d+$/.test(sel)) url = (ENVIRONMENTS[Number(sel) - 1] ?? [])[1];
  else if (/^https?:\/\//i.test(sel)) url = sel;
  else url = (ENVIRONMENTS.find(([n]) => n.toLowerCase().startsWith(sel.toLowerCase())) ?? [])[1];
  if (!url) { console.error(`Invalid environment: "${sel}"`); process.exit(1); }
  return url.replace(/\/+$/, '');
}

// ══════════════════════════════════════════════════════════════════════
// 3. FEATURES
// ══════════════════════════════════════════════════════════════════════
/**
 * Pick the features to compare. Returns { ids, extra } — inventory ids plus
 * any one-off paths typed in.
 */
async function pickFeatures(inventory, withAuth) {
  const all = inventory.routes.filter((r) => !r.skip);
  const available = all.filter((r) => withAuth || !r.auth);
  const hiddenByAuth = all.length - available.length;

  const show = (list) => {
    console.log('\n🧩 Which features should I compare?\n');
    console.log('   0. ALL of them');
    list.forEach((r, i) =>
      console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(24)} ${r.path}${r.auth ? '   (signed in)' : ''}`));
    if (hiddenByAuth) console.log(`\n  (${hiddenByAuth} signed-in feature(s) hidden — answer "yes" to signing in to include them)`);
    console.log('\n  Type numbers (1,4,6) · a keyword · a path starting with "/" to compare something not listed');
  };

  for (;;) {
    show(available);
    const sel = await ask('\n  Choice (Enter = 0 = all) : ');
    if (!sel || sel === '0') return { ids: [], extra: [] };

    if (sel.startsWith('/')) {
      const path = sel;
      const save = await ask(`  Add "${path}" to config/compare-routes.json for next time? (y/N) : `);
      if (yes(save, false)) {
        const name = (await ask('    Name it : ')) || path;
        addRoute(inventory, { id: slug(name), name, path, auth: withAuth });
        console.log('    ✔ saved');
        return { ids: [slug(name)], extra: [] };
      }
      return { ids: [], extra: [path] };
    }

    if (/^\d+(\s*,\s*\d+)*$/.test(sel)) {
      const picked = [];
      let bad = false;
      for (const part of sel.split(',')) {
        const n = Number(part.trim());
        if (n < 1 || n > available.length) { console.log(`  ✖ ${n} is not in the list.`); bad = true; break; }
        picked.push(available[n - 1].id);
      }
      if (bad) continue;
      return { ids: picked, extra: [] };
    }

    // Anything else: treat as a keyword over name + path.
    const hits = available.filter(
      (r) => r.name.toLowerCase().includes(sel.toLowerCase()) || r.path.toLowerCase().includes(sel.toLowerCase()));
    if (!hits.length) { console.log(`\n  ✖ Nothing matches "${sel}".`); continue; }
    console.log(`\n  Matched: ${hits.map((h) => h.name).join(', ')}`);
    const ok = await ask('  Compare these? (Y/n) : ');
    if (yes(ok)) return { ids: hits.map((h) => h.id), extra: [] };
  }
}

/**
 * Journeys — flows walked step by step on both environments, compared at every
 * screen. Returns { ids, allowWrites, only }.
 */
async function pickJourneys(withAuth) {
  if (!existsSync(JOURNEYS)) return { ids: [], allowWrites: false, only: false };
  const all = (JSON.parse(readFileSync(JOURNEYS, 'utf-8')).journeys || []).filter((j) => !j.skip);
  const available = all.filter((j) => withAuth || !j.auth);
  if (!available.length) return { ids: [], allowWrites: false, only: false };

  console.log('\n🚶 Step-by-step journeys — every screen of a flow compared one by one.\n');
  console.log('   0. None');
  available.forEach((j, i) => {
    const writes = j.steps.filter((s) => s.writes).length;
    console.log(
      `  ${String(i + 1).padStart(2)}. ${j.name.padEnd(24)} ${j.steps.length} steps` +
        `${writes ? `, ${writes} of them create real data` : ''}${j.auth ? '   (signed in)' : ''}`);
  });
  console.log(`  ${String(available.length + 1).padStart(2)}. ALL of them`);

  const sel = await ask('\n  Number(s), e.g. 1 or 1,3 (Enter = none) : ');
  if (!sel || sel === '0') return { ids: [], allowWrites: false, only: false };

  let chosen;
  if (Number(sel) === available.length + 1) chosen = available;
  else {
    chosen = [];
    for (const part of sel.split(',')) {
      const n = Number(part.trim());
      if (n >= 1 && n <= available.length) chosen.push(available[n - 1]);
    }
  }
  if (!chosen.length) { console.log('  ✖ Nothing matched — skipping journeys.'); return { ids: [], allowWrites: false, only: false }; }

  const writeSteps = chosen.flatMap((j) => j.steps.filter((s) => s.writes).map((s) => `${j.name}: ${s.label}`));
  let allowWrites = false;
  if (writeSteps.length) {
    console.log('\n  ⚠️  These steps create real data on BOTH sites (send an OTP, submit a signup):');
    writeSteps.forEach((s) => console.log(`       ${s}`));
    allowWrites = yes(await ask('\n  Perform them anyway? (y/N) : '), false);
  }
  const only = yes(await ask('  Compare ONLY these journeys (skip the page-by-page list)? (Y/n) : '));
  return { ids: chosen.map((j) => j.id), allowWrites, only };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function addRoute(inventory, route) {
  inventory.routes.push(route);
  writeFileSync(CONFIG, JSON.stringify(inventory, null, 2) + '\n', 'utf-8');
}

// ══════════════════════════════════════════════════════════════════════
// THE PROMPT FLOW
// ══════════════════════════════════════════════════════════════════════
async function interactive() {
  const inventory = JSON.parse(readFileSync(CONFIG, 'utf-8'));

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Sphere — compare two environments, feature by feature        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const urlA = await pickEnv('LEFT (baseline, usually production)', 'Production');
  const urlB = await pickEnv('RIGHT (the one under test, usually staging)', 'Staging');
  if (urlA === urlB) {
    console.error('\n✖ Both sides are the same environment — nothing to compare.\n');
    process.exit(1);
  }

  // ── 2. auth ──
  const credA = credentialsFor(urlA);
  const credB = credentialsFor(urlB);
  console.log('\n🔐 Sign in?  Public pages need no account; home / my courses / competency / profile do.');
  console.log(`   ${new URL(urlA).hostname.padEnd(30)} ${credA ? credA.email + '  (' + credA.source + ')' : 'no credentials found'}`);
  console.log(`   ${new URL(urlB).hostname.padEnd(30)} ${credB ? credB.email + '  (' + credB.source + ')' : 'no credentials found'}`);
  if (!credA || !credB) {
    console.log('   ↳ set PROD_EMAIL/PROD_PASSWORD and STAGING_EMAIL/STAGING_PASSWORD in .env to enable this');
  }
  const withAuth = credA && credB ? yes(await ask('\n  Compare signed-in features too? (Y/n) : ')) : false;

  // ── 3. features + journeys ──
  const { ids, extra } = await pickFeatures(inventory, withAuth);
  const journeys = await pickJourneys(withAuth);

  // ── 4. options ──
  console.log('\n⚙️  Options — Enter accepts the default each time.');
  const thresholdIn = await ask('  Ignore visual differences under __ % of pixels (Enter = 0.5) : ');
  const threshold = thresholdIn && !Number.isNaN(Number(thresholdIn)) ? thresholdIn : '0.5';
  const headed = yes(await ask('  Watch the browsers work? (y/N) : '), false);
  const catalogue = yes(await ask('  Compare the course catalogues too? (Y/n) : '));
  const freshLogin = withAuth ? yes(await ask('  Force a fresh login (ignore the cached session)? (y/N) : '), false) : false;
  const open = yes(await ask('  Open the report when it finishes? (Y/n) : '));

  // ── build + show the equivalent command ──
  const args = ['--a', urlA, '--b', urlB];
  if (withAuth) args.push('--auth');
  if (ids.length) args.push('--ids', ids.join(','));
  // A one-off path is compared on its own — not alongside the whole inventory.
  if (extra.length && !ids.length) args.push('--no-inventory');
  if (journeys.ids.length) args.push('--journey', journeys.ids.join(','));
  if (journeys.allowWrites) args.push('--allow-writes');
  if (journeys.only) args.push('--journey-only');
  for (const p of extra) args.push('--route', p);
  if (threshold !== '0.5') args.push('--threshold', threshold);
  if (headed) args.push('--headed');
  if (!catalogue) args.push('--no-catalogue');
  if (freshLogin) args.push('--refresh');
  if (open) args.push('--open');

  const quoted = args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
  console.log(`\n▶  Same run without the prompts:\n   npm run compare -- ${quoted}\n`);

  process.exit(await run(args));
}

// Any flag at all means the caller already knows what they want — just run.
// (Declared last so every helper above is initialised before it fires.)
if (argv.length || !INTERACTIVE) {
  process.exit(await run(argv));
} else {
  await interactive();
}
