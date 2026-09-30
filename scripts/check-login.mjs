/**
 * Credential preflight — "will the signed-in specs actually get in?"
 * ──────────────────────────────────────────────────────────────────
 * Checks, in the SAME ORDER tests/helpers/authedTest.ts uses:
 *
 *   1. the LAST SIGNED-UP account's saved session (.auth/fresh-user.json)
 *   2. the account in .env (TEST_USER_EMAIL / TEST_USER_PASSWORD)
 *
 * Why it exists: a wrong or stale credential used to surface twenty steps later
 * as something unrelated — a missing search box, an empty course list. Ten
 * seconds here names the problem instead.
 *
 * TWO MODES, decided by whether a person is present:
 *
 *   Terminal (TTY)   → prints what it found and ASKS before you run a suite.
 *   CI / piped       → prints the same lines, asks nothing, and exits
 *                      0 = at least one account works, 1 = none do.
 *
 * That second mode is the point: a deployment pipeline runs this unattended as
 * a gate, and the suite itself never prompts either — the fixture walks the
 * same order on its own.
 *
 *   npm run check:login                                  (against .env BASE_URL)
 *   $env:BASE_URL="https://portal-staging.aastrika.org"; npm run check:login
 */
import readline from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: resolve(ROOT, '.env') });

const BASE_URL = (process.env.BASE_URL || 'https://sphere.aastrika.org').replace(/\/+$/, '');
const HOST = new URL(BASE_URL).hostname;
const FRESH_FILE = resolve(ROOT, '.auth', 'fresh-user.json');
const FRESH_EMAIL = resolve(ROOT, '.auth', 'fresh-user-email.json');
const LAST_REGISTERED = resolve(ROOT, '.last-registered-email.json');
const INTERACTIVE = process.stdin.isTTY && process.stdout.isTTY && process.env.CI !== 'true';

function savedEmail() {
  for (const f of [FRESH_EMAIL, LAST_REGISTERED]) {
    try {
      if (existsSync(f)) {
        const j = JSON.parse(readFileSync(f, 'utf-8'));
        if (j?.email) return String(j.email);
      }
    } catch { /* unreadable — treat as absent */ }
  }
  return '';
}

/** True when this page is the signed-in portal rather than the public site. */
async function signedIn(page) {
  await page.goto(`${BASE_URL}/page/home`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2_000);
  return page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const search = document.querySelector('input[placeholder*="learn today" i]');
    const login = Array.from(document.querySelectorAll('button, a'))
      .filter(vis).find((b) => /^log\s*in$/i.test(clean(b.textContent)));
    return Boolean(search && vis(search)) && !login;
  }).catch(() => false);
}

/** Can this session open a real app page? Mirrors authedTest.canUseAppPages.
 *  Signing in is not enough: a brand-new signup user is logged in but cannot
 *  open Account until onboarding is done, and the specs reach Account through
 *  the header because a direct URL renders it blank. */
async function canUseApp(page) {
  await page.goto(`${BASE_URL}/page/home`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2_000);
  const nav = page.getByRole('link', { name: /^(account|खाता)$/i })
    .or(page.getByRole('button', { name: /^(account|खाता)$/i }))
    .or(page.getByText(/^(account|खाता)$/i)).first();
  if (!(await nav.isVisible({ timeout: 10_000 }).catch(() => false))) return false;
  await nav.click({ timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(2_500);
  return page.getByText(/^(personal details|व्यक्तिगत विवरण)$/i).first()
    .isVisible({ timeout: 8_000 }).catch(() => false);
}

const { chromium } = require('playwright-core');

async function checkFreshSession(browser) {
  const email = savedEmail();
  if (!existsSync(FRESH_FILE)) {
    return { name: 'last signed-up session', detail: '(none saved)', ok: false, skipped: true };
  }
  const ctx = await browser.newContext({ storageState: FRESH_FILE });
  const page = await ctx.newPage();
  const ok = (await signedIn(page)) && (await canUseApp(page));
  await ctx.close().catch(() => {});
  return { name: 'last signed-up session', detail: email || '(address unknown)', ok };
}

async function checkEnvAccount(browser) {
  const email = process.env.TEST_USER_EMAIL || process.env.MONITOR_EMAIL || '';
  const password = process.env.TEST_USER_PASSWORD || process.env.MONITOR_PASSWORD || '';
  if (!email || !password) {
    return { name: '.env account', detail: '(TEST_USER_EMAIL / TEST_USER_PASSWORD not set)', ok: false, skipped: true };
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Drive the same UI login the suite uses, via the compiled helper's route.
  let ok = false;
  try {
    await page.goto(`${BASE_URL}/public/login`);
    await page.waitForLoadState('networkidle').catch(() => {});
    const toggle = page.getByText(/login with password|पासवर्ड\s*से\s*लॉगिन/i).first();
    await toggle.waitFor({ state: 'visible', timeout: 60_000 });
    await toggle.click({ timeout: 60_000 });
    await page.waitForTimeout(500);
    await page.locator('input[type="text"], input[type="email"], input[type="tel"], input:not([type])').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    const btn = page.getByRole('button', { name: /^(log\s*in|लॉगिन)$/i }).first();
    if (await btn.isEnabled().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(4_000);
    }
    ok = await signedIn(page);
  } catch { /* ok stays false */ }
  await ctx.close().catch(() => {});
  return { name: '.env account', detail: email, ok };
}

const browser = await chromium.launch({ headless: true });
console.log(`\n🔐 Credential check on ${HOST}\n`);

const results = [];
results.push(await checkFreshSession(browser));
// Only bother with the second when the first cannot carry the run.
results.push(await checkEnvAccount(browser));
await browser.close().catch(() => {});

for (const [i, r] of results.entries()) {
  const mark = r.skipped ? '–' : r.ok ? '✅' : '✖';
  console.log(`  ${i + 1}. ${mark} ${r.name.padEnd(26)} ${r.detail}`);
}

const winner = results.find((r) => r.ok);
if (winner) {
  console.log(`\n▶  The signed-in specs will run as: ${winner.detail}  (${winner.name})\n`);
} else {
  console.log('\n✖ No account can sign in on this environment.');
  console.log('  • Mint a fresh signup user:  npm run mint:fresh-user');
  console.log('  • …or fix TEST_USER_EMAIL / TEST_USER_PASSWORD in .env');
  console.log('  Remember: signup addresses (testautomation…@yopmail.com) are OTP-only —');
  console.log('  they have no password, so they only work through their saved session.\n');
}

// CI and piped runs stop here: a gate, never a prompt.
if (!INTERACTIVE) process.exit(winner ? 0 : 1);

// A person is watching — let them decide whether to go ahead.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise((res) => rl.question(
  winner ? '  Continue with this account? (Y/n) : ' : '  Continue anyway? (y/N) : ', (a) => { rl.close(); res((a || '').trim()); }));
const go = winner ? !/^n/i.test(answer) : /^y/i.test(answer);
console.log('');
process.exit(go ? 0 : 1);
