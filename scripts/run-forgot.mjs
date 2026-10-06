/**
 * Interactive forgot-password runner (Sphere web).
 * ────────────────────────────────────────────────
 * Same as e-Kshamata's `npm run forgot`: asks which environment and which
 * account to reset — pick one of the accounts in generated-emails.txt, or type
 * any email — then runs tests/forgot-password.spec.ts against it. The new
 * password is always Sunbird@123.
 *
 *   npm run forgot                 (prompts)
 *   npm run forgot -- <email>      skip the prompts, reset that account
 *                                  (env picked from its stage-/uat- prefix)
 *
 * The OTP is read live from the account's Yopmail inbox, so the email must be a
 * @yopmail.com address.
 */
import readline from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: resolve(ROOT, '.env') });

const NEW_PASSWORD = 'Sunbird@123';
const SPEC = 'tests/forgot-password.spec.ts';
const LEDGER = resolve(ROOT, 'generated-emails.txt');
const argv = process.argv.slice(2);
const INTERACTIVE = (process.stdin.isTTY && process.stdout.isTTY) || process.env.FORGOT_INTERACTIVE === '1';

const ENVIRONMENTS = [
  ['Staging', 'https://portal-staging.aastrika.org', 'staging'], // default, like e-Kshamata
  ['Production', 'https://sphere.aastrika.org', 'production'],
  ['UAT', 'https://uat.aastrika.org', 'uat'],
  ['Localhost', 'http://localhost:3000', 'localhost'],
];

/** Which env an address belongs to — the stage-/uat- prefix wins, else the ledger column. */
function envOf(email, column = '') {
  if (/^stage-/i.test(email)) return 'staging';
  if (/^uat-/i.test(email)) return 'uat';
  if (/staging/i.test(column)) return 'staging';
  if (/uat/i.test(column)) return 'uat';
  return 'production';
}

/** Accounts created on one env, newest first, no duplicates. */
function createdOn(envKey) {
  if (!existsSync(LEDGER)) return [];
  const seen = new Set();
  const out = [];
  const lines = readFileSync(LEDGER, 'utf-8').split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    const cols = line.split('\t');
    const email = cols[cols.length - 1].trim();
    if (!/@/.test(email) || seen.has(email.toLowerCase())) continue;
    const column = cols.length >= 4 ? cols[1] : '';
    if (envOf(email, column) !== envKey) continue;
    seen.add(email.toLowerCase());
    out.push({ email, when: cols[0].slice(0, 10), source: cols.length >= 4 ? cols[2] : '' });
  }
  return out;
}

// ── prompting that also works when answers are piped in ──
let rl = null;
const pending = [];
let waiting = null;
let stdinClosed = false;
function prompts() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
    rl.on('line', (line) => {
      const answer = (line || '').trim();
      if (waiting) { const res = waiting; waiting = null; res(answer); }
      else pending.push(answer);
    });
    rl.on('close', () => { stdinClosed = true; if (waiting) { const res = waiting; waiting = null; res(''); } });
  }
  return rl;
}
function ask(query) {
  prompts();
  process.stdout.write(query);
  if (pending.length) return Promise.resolve(pending.shift());
  if (stdinClosed) return Promise.resolve('');
  return new Promise((res) => { waiting = res; });
}
function closePrompts() { if (rl) { rl.close(); rl = null; } }

function run(baseUrl, email) {
  closePrompts();
  const cli = require.resolve('@playwright/test/cli');
  const args = [cli, 'test', SPEC, '--project=Chrome', '--headed'];
  console.log(`\n▶  Same run without the prompts:\n   cross-env BASE_URL=${baseUrl} FORGOT_EMAIL=${email} FORGOT_NEW_PASSWORD=${NEW_PASSWORD} npm run test:forgot\n`);
  return new Promise((res) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, BASE_URL: baseUrl, FORGOT_EMAIL: email, FORGOT_NEW_PASSWORD: NEW_PASSWORD, HEADLESS: 'false' },
    });
    child.on('exit', (code) => res(code ?? 1));
  });
}

async function pickEnv() {
  console.log('\n🌐 Which environment?\n');
  ENVIRONMENTS.forEach(([name, url], i) => console.log(`  ${i + 1}. ${name.padEnd(11)} ${url}`));
  const sel = await ask(`\n  Number, name, or a full URL (Enter = ${ENVIRONMENTS[0][0]}) : `);
  let env;
  if (!sel) env = ENVIRONMENTS[0];
  else if (/^\d+$/.test(sel)) env = ENVIRONMENTS[Number(sel) - 1];
  else if (/^https?:\/\//i.test(sel)) env = ['Custom', sel, envOf('', new URL(sel).hostname)];
  else env = ENVIRONMENTS.find(([n]) => n.toLowerCase().startsWith(sel.toLowerCase()));
  if (!env) { console.error(`✖ Invalid environment: "${sel}"`); process.exit(1); }
  return { url: env[1].replace(/\/+$/, ''), key: env[2] };
}

async function pickEmail({ url, key }) {
  const here = createdOn(key);
  console.log(`\n📧 Which account to reset?  (accounts created on ${new URL(url).hostname})\n`);
  if (here.length) {
    here.slice(0, 20).forEach((u, i) =>
      console.log(`  ${String(i + 1).padStart(2)}. ${u.email.padEnd(36)} ${[u.when, u.source].filter(Boolean).join(' · ')}`));
  } else {
    console.log('  (none in generated-emails.txt for this environment yet)');
  }
  console.log('\n  Pick a number, or type any email.');

  for (;;) {
    const sel = await ask(`\n  Choice${here.length ? ` (Enter = 1, ${here[0].email})` : ''} : `);
    let email;
    if (!sel && here.length) email = here[0].email;
    else if (/^\d+$/.test(sel)) email = (here[Number(sel) - 1] || {}).email;
    else if (sel) email = sel;

    if (!email) { console.log('  ✖ Not a valid choice — pick a listed number or type an email.'); continue; }
    if (!/@yopmail\.com$/i.test(email)) {
      console.log(`  ⚠️  ${email} is not a @yopmail.com address — the OTP is read from Yopmail, so the reset will stall waiting for a code it cannot see.`);
      const ok = await ask('     Use it anyway? (y/N) : ');
      if (!/^y/i.test(ok)) continue;
    }
    return email;
  }
}

async function interactive() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  Sphere — forgot password (OTP read live from Yopmail)        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  const env = await pickEnv();
  const email = await pickEmail(env);
  console.log(`\n✅ Resetting ${email} on ${new URL(env.url).hostname}  →  new password ${NEW_PASSWORD}`);
  process.exit(await run(env.url, email));
}

// A bare email argument skips the prompts; its stage-/uat- prefix picks the env
// (no prefix → staging, the same default as the menu).
const emailArg = argv.find((a) => /@/.test(a));
if (emailArg) {
  const key = /^(stage|uat)-/i.test(emailArg) ? envOf(emailArg) : 'staging';
  process.exit(await run(ENVIRONMENTS.find((e) => e[2] === key)[1], emailArg));
} else if (!INTERACTIVE) {
  console.error('\n✖ No TTY and no email given.  npm run forgot -- <email@yopmail.com>\n');
  process.exit(1);
} else {
  await interactive();
}
