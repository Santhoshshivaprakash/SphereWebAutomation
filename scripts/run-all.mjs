/**
 * The whole suite, one run, one report.
 * ─────────────────────────────────────
 * `playwright test` with no --project filter runs every project, but it also
 * pulls in the specs that mint real accounts on whatever environment you point
 * at. This wraps that with sane defaults and a pre-flight summary so a long run
 * doesn't start on a wrong assumption.
 *
 * The environment is CHOSEN AT RUN TIME — it prompts for prod / staging /
 * localhost rather than inheriting BASE_URL from .env, and normalises whatever
 * you pick to an origin (a path in BASE_URL breaks every login helper).
 *
 *   npm run test:all                     prompts for env; Chrome + api + monitor
 *   npm run test:all -- --env prod       skip the prompt (prod|staging|local)
 *   npm run test:all -- --url <base>     an environment not in the list
 *   npm run test:all -- --no-signup      skip the 5 account-minting specs
 *   npm run test:all -- --headed         watch it
 *   npm run test:all -- --workers 4      override the serial default (see below)
 *   npm run test:all -- --dry            show what would run, then stop
 *
 * Env URLs default to the three below and can be overridden in .env via
 * ENV_PROD_URL / ENV_STAGING_URL / ENV_LOCAL_URL.
 *
 * One invocation = one branded report at brand-reports/latest.html. The blob +
 * merge pipeline (`npm run test:everything`) exists only because that splits the
 * suite into groups; a single run needs no merge.
 *
 * See the full ordered list of what runs: `npm run test:list`.
 */
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: join(ROOT, '.env') });

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flag = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };

const noSignup = has('--no-signup');
const headed = has('--headed');
const dry = has('--dry');
const workers = flag('--workers', null);
const url = flag('--url', null);

const projects = ['Chrome', 'api', 'monitor'];

// ── environment ───────────────────────────────────────────────────────────
// The target is chosen at run time, NOT read from .env — BASE_URL there is a
// per-spec convenience and has held a full page URL, which breaks every helper
// that builds `${BASE_URL}/public/login`. Override any of these in .env.
const ENVS = [
  ['Production', process.env.ENV_PROD_URL || 'https://sphere.aastrika.org'],
  ['Staging (Portal)', process.env.ENV_STAGING_URL || 'https://portal-staging.aastrika.org'],
  ['Localhost', process.env.ENV_LOCAL_URL || 'http://localhost:3000'],
];
const ALIASES = { prod: 0, production: 0, staging: 1, stage: 1, portal: 1, local: 2, localhost: 2 };

const ask = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.question(q, (a) => { rl.close(); res(a); });
});

/** Helpers append paths to BASE_URL, so it must be an origin. */
function toOrigin(raw) {
  let u;
  try { u = new URL(raw); } catch { console.error(`\n✗ "${raw}" is not a valid URL.`); process.exit(2); }
  const origin = u.origin;
  if (u.pathname && u.pathname !== '/') {
    console.log(`\n  note: dropped path "${u.pathname}" — BASE_URL must be an origin.`);
    console.log(`        Helpers build "\${BASE_URL}/public/login"; a path here breaks every login.`);
  }
  return origin;
}

async function pickEnv() {
  if (url) return toOrigin(url);

  const named = flag('--env', null);
  if (named) {
    const i = ALIASES[String(named).toLowerCase()];
    if (i === undefined) {
      console.error(`\n✗ Unknown --env "${named}". Use: prod | staging | local (or --url <base>).`);
      process.exit(2);
    }
    return toOrigin(ENVS[i][1]);
  }

  // Non-interactive (CI, piped): default to staging rather than guessing prod.
  if (!process.stdin.isTTY) {
    console.log('  non-interactive shell — defaulting to Staging. Use --env or --url to be explicit.');
    return toOrigin(ENVS[1][1]);
  }

  console.log('\nWhich environment should the suite run against?\n');
  ENVS.forEach(([name, u], i) => console.log(`  ${i + 1}. ${name.padEnd(18)} ${u}`));
  console.log('  4. Custom URL');
  const sel = (await ask('\nChoice [2 = Staging]: ')).trim();

  if (!sel) return toOrigin(ENVS[1][1]);
  if (sel === '4') return toOrigin((await ask('Base URL: ')).trim());
  if (/^[123]$/.test(sel)) return toOrigin(ENVS[Number(sel) - 1][1]);
  const match = ENVS.find(([n]) => n.toLowerCase().includes(sel.toLowerCase()));
  if (match) return toOrigin(match[1]);
  console.error(`\n✗ Unrecognised choice "${sel}".`);
  process.exit(2);
}

const target = await pickEnv();
const isProd = new URL(target).hostname === 'sphere.aastrika.org';

const env = { ...process.env, BASE_URL: target, STAGING_URL: target };
if (!headed) env.HEADLESS = 'true';
if (noSignup) env.SKIP_SIGNUP = '1';

// Anything we don't recognise is forwarded to Playwright verbatim, so
// `npm run test:all -- -g "login"` or a file filter still works.
const OWN = new Set(['--no-signup', '--headed', '--dry']);
const OWN_WITH_VALUE = new Set(['--workers', '--url', '--env']);
const passthrough = [];
for (let i = 0; i < argv.length; i++) {
  if (OWN.has(argv[i])) continue;
  if (OWN_WITH_VALUE.has(argv[i])) { i++; continue; }
  passthrough.push(argv[i]);
}

const pwArgs = [
  'playwright', 'test',
  ...projects.flatMap((p) => ['--project', p]),
  ...(workers ? ['--workers', workers] : []),
  ...passthrough,
];

// ── pre-flight ────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────');
console.log(' Full suite run');
console.log('─────────────────────────────────────────────');
console.log(` Target    : ${target}${isProd ? '  ⚠ PRODUCTION' : ''}`);
console.log(` Projects  : ${projects.join(', ')}`);
console.log(` Mode      : ${headed ? 'headed' : 'headless'}`);
console.log(` Signup    : ${noSignup ? 'SKIPPED' : 'included — real accounts will be created'}`);
console.log(` Workers   : ${workers || '1 (config default, serial)'}`);

const list = spawnSync('npx', [...pwArgs, '--list', '--reporter=line'],
  { cwd: ROOT, env, shell: true, encoding: 'utf8' });
const total = (list.stdout || '').match(/Total:\s*(\d+)\s*tests?\s*in\s*(\d+)\s*files?/);
if (total) console.log(` Tests     : ${total[1]} in ${total[2]} files`);
else console.log(' Tests     : (could not read count — continuing)');

if (!noSignup && isProd) {
  console.log('\n ⚠ Signup specs are enabled against PRODUCTION. Every run creates');
  console.log('   real yopmail users on sphere.aastrika.org. Use --no-signup to skip them.');
}
if (workers && +workers > 1) {
  console.log('\n ⚠ The config sets fullyParallel:false / workers:1 deliberately —');
  console.log('   these specs share auth state and mint users. Parallel runs may be flaky.');
}
console.log('─────────────────────────────────────────────\n');

if (dry) {
  console.log('--dry: nothing executed.');
  process.exit(0);
}

// Creating real users on production is not something to do by accident.
if (isProd && !noSignup && process.stdin.isTTY) {
  const ok = (await ask(' This will create real accounts on PRODUCTION. Type "yes" to continue: ')).trim();
  if (ok.toLowerCase() !== 'yes') { console.log(' Aborted.'); process.exit(0); }
  console.log('');
}

// ── run ───────────────────────────────────────────────────────────────────
const started = Date.now();
const child = spawn('npx', pwArgs, { cwd: ROOT, env, shell: true, stdio: 'inherit' });

child.on('exit', (code) => {
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  const report = join(ROOT, 'brand-reports', 'latest.html');
  console.log(`\n─────────────────────────────────────────────`);
  console.log(` Finished in ${mins} min — exit ${code}`);
  if (existsSync(report)) console.log(` Report: ${report}`);
  console.log(`─────────────────────────────────────────────`);
  process.exit(code ?? 1);
});
