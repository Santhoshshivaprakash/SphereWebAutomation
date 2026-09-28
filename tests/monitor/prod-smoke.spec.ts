/**
 * Layer 7 — Synthetic production smoke.
 * ──────────────────────────────────────────────────────────────────
 * A tiny, fast, HIGH-SIGNAL journey run against PRODUCTION on a schedule
 * (GitHub Actions cron). If this goes red, real users are affected — the
 * Slack reporter fires an alert.
 *
 * Kept deliberately small (<2 min) and resilient:
 *   1. Public site is reachable and the login shell renders.
 *   2. A dedicated MONITOR account can log in.           (skips w/o creds)
 *   3. An authenticated page loads after login.          (skips w/o creds)
 *
 * Uses a PERSISTENT monitor account (MONITOR_EMAIL / MONITOR_PASSWORD), NOT
 * per-run provisioning — we don't want to create a prod user every 15 min.
 *
 * Env:
 *   BASE_URL          production URL (default https://sphere.aastrika.org)
 *   MONITOR_EMAIL     dedicated monitor account
 *   MONITOR_PASSWORD  its password
 *   SLACK_WEBHOOK_URL where failures are announced (handled by the reporter)
 */
// Straight from Playwright — this spec needs no custom fixtures.
import { test, expect } from '@playwright/test';
// The shared helper that drives the real login form.
import { loginWithPassword } from '../helpers/login';

// Which environment to monitor. Defaults to production.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';
// The dedicated monitoring account's email (empty string if unset).
const MONITOR_EMAIL = process.env.MONITOR_EMAIL || '';
// Its password.
const MONITOR_PASSWORD = process.env.MONITOR_PASSWORD || '';
// True only when BOTH are configured — tests 2 and 3 skip without them.
const hasMonitorCreds = Boolean(MONITOR_EMAIL && MONITOR_PASSWORD);

// Group for the production monitor. @monitor matches the dedicated Playwright project.
test.describe('Prod synthetic monitor @monitor', () => {
  // TEST 1 — is the public site up at all? This one needs no credentials.
  test('1. public login page is reachable and renders', async ({ page }) => {
    // Navigate and keep the HTTP response so we can check its status code.
    const resp = await page.goto(`${BASE_URL}/public/login`, { waitUntil: 'domcontentloaded' });
    // The response must be 2xx. `?.` guards against a null response; the message prints the real status.
    expect(resp?.ok(), `navigation status ${resp?.status()}`).toBeTruthy();
    // Let the Angular shell finish loading; ignore if the network never fully idles.
    await page.waitForLoadState('networkidle').catch(() => {});
    // The "Welcome!" heading proves the app actually painted, not just that the server answered.
    await expect(page.getByText(/^welcome!?$/i).first()).toBeVisible({ timeout: 15_000 });
    // Log success with the final URL.
    console.log(`✅ Public login shell up: ${page.url()}`);
  });

  // TEST 2 — can a real account actually get in?
  test('2. monitor account can log in', async ({ page }) => {
    // No credentials configured → skip rather than fail the monitor.
    test.skip(!hasMonitorCreds, 'MONITOR_EMAIL / MONITOR_PASSWORD not set');
    // Drive the real login form with the monitor account.
    await loginWithPassword(page, MONITOR_EMAIL, MONITOR_PASSWORD);
    // Success = we're no longer on the public login page.
    expect(page.url(), 'should leave the public login page after login').not.toContain('/public/login');
    // Log where we landed.
    console.log(`✅ Login OK — landed on: ${page.url()}`);
  });

  // TEST 3 — did the authenticated app actually render, or just redirect to a blank shell?
  test('3. authenticated app loads after login', async ({ page }) => {
    // Needs credentials too.
    test.skip(!hasMonitorCreds, 'MONITOR_EMAIL / MONITOR_PASSWORD not set');
    // Log in again — each test gets a fresh page, so the session from test 2 isn't reused.
    await loginWithPassword(page, MONITOR_EMAIL, MONITOR_PASSWORD);
    // We should be inside the app (any /app/ route) with real content painted.
    // `toHaveURL` polls, so this tolerates a slow redirect.
    await expect(page).toHaveURL(/\/app\//, { timeout: 20_000 });
    // Read whatever text the page rendered.
    const body = await page.locator('body').innerText().catch(() => '');
    // A blank page would mean the shell loaded but the app failed — catch that here.
    expect(body.trim().length, 'authenticated page should render content').toBeGreaterThan(0);
    // Log success.
    console.log(`✅ Authenticated app rendered at: ${page.url()}`);
  });
});
