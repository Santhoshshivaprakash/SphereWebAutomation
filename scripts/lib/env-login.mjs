/**
 * Log one environment in and hand back a storageState the comparison run can
 * reuse. Mirrors tests/helpers/login.ts (same selectors, same terms gate), but
 * in plain JS so the runner scripts can use it without a TypeScript step.
 *
 * States are cached per host under .cache/ so a re-run does not log in again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const STATE_TTL_MS = 6 * 60 * 60 * 1000; // a session lasts comfortably longer than a run

const stateFile = (baseUrl, email) =>
  resolve(ROOT, '.cache', `state-${new URL(baseUrl).hostname}-${email.replace(/[^a-z0-9]/gi, '_')}.json`);

/** Accept the new-user terms gate if it is showing. Best effort, non-fatal. */
async function acceptTermsIfPresent(page) {
  const onTerms =
    /new-tnc|terms|tnc/i.test(page.url()) ||
    (await page
      .getByText(/terms\s*(&|and)?\s*conditions|नियम\s*(और|एवं)?\s*शर्तें|उपयोग की शर्तें/i)
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false));
  if (!onTerms) return;

  const checkbox = page.locator('input[type="checkbox"], mat-checkbox input, [role="checkbox"]').first();
  if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
    await checkbox.check({ force: true }).catch(() => {});
  }
  const accept = page.getByRole('button', { name: /accept|agree|proceed|continue|स्वीकार|सहमत|जारी\s*रखें/i }).first();
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accept.click().catch(() => {});
  }
  await page.waitForURL((u) => !/new-tnc/i.test(u.toString()), { timeout: 10000 }).catch(() => {});
}

/** Log in through the public login page. Throws if the app never leaves /public/. */
export async function loginWithPassword(page, baseUrl, email, password) {
  await page.goto(`${baseUrl}/public/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  // The portal defaults to Hindi, where the toggle reads "पासवर्ड से लॉगिन करें".
  await page.getByText(/login with password|पासवर्ड\s*से\s*लॉगिन/i).first().click({ timeout: 15000 });
  await page.waitForTimeout(400);

  const idInput = page.locator('input[type="text"], input[type="email"], input[type="tel"], input:not([type])').first();
  await idInput.fill(email);

  const pwdInput = page.locator('input[type="password"]').first();
  await pwdInput.waitFor({ state: 'visible', timeout: 5000 });
  await pwdInput.fill(password);

  const loginBtn = page.getByRole('button', { name: /^(log\s*in|लॉगिन|लॉग\s*इन\s*करें)$/i }).first();
  await loginBtn.scrollIntoViewIfNeeded().catch(() => {});
  await loginBtn.click();

  await page.waitForURL(/\/(app|page)\//, { timeout: 30000 }).catch(() => {});
  await acceptTermsIfPresent(page);
  await page.waitForLoadState('networkidle').catch(() => {});

  if (/\/public\/login/.test(page.url())) {
    throw new Error(`login did not leave /public/login on ${baseUrl} (wrong credentials, or the account is not on this environment)`);
  }
}

/**
 * A storageState for `baseUrl`, logging in only when the cached one is stale.
 *
 * @returns {Promise<{state: object, cached: boolean}>}
 */
export async function authState(browser, baseUrl, email, password, { refresh = false, print = console.log } = {}) {
  const file = stateFile(baseUrl, email);
  if (!refresh && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf-8'));
      if (Date.now() - Date.parse(saved.savedAt) < STATE_TTL_MS) {
        print(`   🔐 reusing the saved session for ${email} on ${new URL(baseUrl).hostname}`);
        return { state: saved.state, cached: true };
      }
    } catch (e) {
      /* fall through and log in again */
    }
  }

  print(`   🔐 logging in as ${email} on ${new URL(baseUrl).hostname} …`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, baseUrl, email, password);
    const state = await context.storageState();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), state }, null, 2));
    return { state, cached: false };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Credentials for one environment, most specific first:
 *   PROD_EMAIL / STAGING_EMAIL (per env)  →  TEST_USER_EMAIL  →  MONITOR_EMAIL
 *   →  the first entry in config/accounts.json
 */
export function credentialsFor(baseUrl) {
  const host = new URL(baseUrl).hostname;
  const prefix = /portal-staging/i.test(host) ? 'STAGING' : /^localhost|127\.0\.0\.1/.test(host) ? 'LOCAL' : 'PROD';

  const pairs = [
    [process.env[`${prefix}_EMAIL`], process.env[`${prefix}_PASSWORD`], `${prefix}_EMAIL`],
    [process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD, 'TEST_USER_EMAIL'],
    [process.env.MONITOR_EMAIL, process.env.MONITOR_PASSWORD, 'MONITOR_EMAIL'],
  ];
  for (const [email, password, source] of pairs) {
    if (email && password) return { email, password, source };
  }

  const accountsFile = resolve(ROOT, 'config', 'accounts.json');
  if (existsSync(accountsFile)) {
    try {
      const list = JSON.parse(readFileSync(accountsFile, 'utf-8'));
      const first = (Array.isArray(list) ? list : []).find((a) => a.email && a.password);
      if (first) return { email: first.email, password: first.password, source: 'config/accounts.json' };
    } catch (e) {
      /* ignore a malformed accounts file */
    }
  }
  return null;
}
