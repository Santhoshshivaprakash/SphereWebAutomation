/**
 * Interactive login verification.
 *
 * Verifies an EXISTING account can log in — password and/or OTP. Prompts for:
 *   1. environment / URL
 *   2. method: password | otp | both
 *   3. the credential — type it, OR pick from stored emails already created
 *      (.last-registered-email.json, .auth/fresh-user-email.json, generated-emails.txt)
 *   4. password (only for the password method; defaults to the signup default)
 *
 *   npm run login:check
 *
 * OTP is fetched automatically for @yopmail.com test accounts.
 */
import { readFileSync, existsSync } from 'node:fs';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function ask(query) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(query, (a) => { rl.close(); res((a || '').trim()); });
  });
}

// ── Environment picker ────────────────────────────────────────────
const BASE_URLS = [
  ['Production (Sphere)', 'https://sphere.aastrika.org'],
  ['Staging (Portal)',    'https://portal-staging.aastrika.org'],
  ['UAT (Sphere)',        'https://uat.aastrika.org'],
  ['Localhost',           'http://localhost:3000'],
];
async function pickBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/+$/, '');
  console.log('\n🌐 Which environment / URL?\n');
  BASE_URLS.forEach(([name, url], i) => console.log(`  ${i + 1}. ${name.padEnd(22)} ${url}`));
  const sel = await ask('\n  Number, name, or a full https URL (Enter = 1) : ');
  let url;
  if (!sel) url = BASE_URLS[0][1];
  else if (/^\d+$/.test(sel)) url = (BASE_URLS[Number(sel) - 1] || [])[1];
  else if (/^https?:\/\//i.test(sel)) url = sel.trim().replace(/\/+$/, '');
  else url = (BASE_URLS.find(([n]) => n.toLowerCase().includes(sel.toLowerCase())) || [])[1];
  if (!url) { console.error(`Invalid URL: "${sel}"`); process.exit(1); }
  return url;
}

// ── Stored emails already created ─────────────────────────────────
function storedEmails() {
  const out = [];
  const pushJson = (f) => { try { const j = JSON.parse(readFileSync(resolve(ROOT, f), 'utf8')); if (j.email) out.push(j.email); } catch {} };
  pushJson('.last-registered-email.json');
  pushJson('.auth/fresh-user-email.json');
  try {
    const lines = readFileSync(resolve(ROOT, 'generated-emails.txt'), 'utf8').trim().split(/\r?\n/);
    for (const l of lines.reverse()) {          // newest first
      const e = l.split(/\s+/).pop();
      if (e && /@/.test(e)) out.push(e);
    }
  } catch {}
  return [...new Set(out)];                       // dedupe, keep order
}

const DEFAULT_PASSWORD = 'Sunbird@123';           // signup default for generated accounts

// ── Flow ──────────────────────────────────────────────────────────
const BASE_URL = await pickBaseUrl();

console.log('\n🔑 Login method?\n  1. Password\n  2. OTP\n  3. Both');
const mSel = await ask('\n  Number (Enter = 3 = both) : ');
const METHOD = ({ '1': 'password', '2': 'otp', '3': 'both' }[mSel] || 'both');

// Credential source
let id = '';
const stored = storedEmails();
if (stored.length) {
  console.log(`\n📇 Use a stored (already-created) email, or type a new credential?\n`);
  stored.slice(0, 15).forEach((e, i) => console.log(`  ${String(i + 1).padStart(2)}. ${e}`));
  console.log('   0. Type a different email / phone');
  const sel = await ask('\n  Number (Enter = 1 = newest) : ');
  if (sel === '0') id = await ask('  Email or phone : ');
  else if (!sel) id = stored[0];
  else if (/^\d+$/.test(sel)) id = stored[Number(sel) - 1];
  if (!id) id = await ask('  Email or phone : ');
} else {
  console.log('\n(No stored emails found.)');
  id = await ask('  Email or phone to log in with : ');
}
if (!id) { console.error('No credential entered.'); process.exit(1); }

let password = '';
if (METHOD === 'password' || METHOD === 'both') {
  const p = await ask(`  Password (Enter = ${DEFAULT_PASSWORD}) : `);
  password = p || DEFAULT_PASSWORD;
}

if ((METHOD === 'otp' || METHOD === 'both') && !/@yopmail\.com$/i.test(id)) {
  console.log(`\n⚠️  OTP auto-fetch only works for @yopmail.com accounts — "${id}" isn't one.`);
  console.log('   The OTP test will fail unless you use a yopmail address.');
}

console.log(`\n▶  Verifying LOGIN for ${id}  [method: ${METHOD}]  on ${BASE_URL}\n`);

const cli = require.resolve('@playwright/test/cli');
const child = spawn(
  process.execPath,
  [cli, 'test', 'tests/login-check.spec.ts', '--project=Chrome', '--headed'],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, BASE_URL, LOGIN_ID: id, LOGIN_PASSWORD: password, LOGIN_METHOD: METHOD },
  },
);
child.on('exit', (code) => process.exit(code ?? 0));
