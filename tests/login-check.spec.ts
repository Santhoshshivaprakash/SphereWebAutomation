/**
 * Login verification — existing credentials, password AND/OR OTP.
 * ──────────────────────────────────────────────────────────────────
 * Just the login flow: confirm an already-created account can sign in.
 * Driven entirely by env (set for you by `npm run login:check`):
 *
 *   LOGIN_ID       email or phone to log in with
 *   LOGIN_PASSWORD password (only needed for the password method)
 *   LOGIN_METHOD   password | otp | both   (default: both)
 *   BASE_URL       which environment
 *
 * OTP is fetched automatically for @yopmail.com test accounts.
 *
 * Run interactively:  npm run login:check
 * Or directly:        cross-env LOGIN_ID=foo@yopmail.com LOGIN_PASSWORD=Sunbird@123 \
 *                       LOGIN_METHOD=both playwright test tests/login-check.spec.ts --headed
 */
// Straight from Playwright — no custom fixtures needed.
import { test, expect } from '@playwright/test';
// The two shared login helpers: one per sign-in method.
import { loginWithPassword, loginWithOtp } from './helpers/login';

// The account to log in with — email or phone. Empty means "skip everything".
const ID = process.env.LOGIN_ID || '';
// Its password. Only the password method needs this.
const PWD = process.env.LOGIN_PASSWORD || '';
// Which method(s) to exercise. Lower-cased so "Both", "BOTH" and "both" all work.
const METHOD = (process.env.LOGIN_METHOD || 'both').toLowerCase();

// A successful login leaves the public area and lands on an authenticated route:
//   /page/home     → logged-in home (the usual landing)
//   /app/new-tnc   → T&C gate (still means the credentials were accepted)
//   /app/…         → profile/other authenticated pages
// Shared assertion so both tests check "logged in" the same way.
function assertLoggedIn(url: string) {
  // We must have left the public area entirely.
  expect(url, `expected to leave the public area but stayed at ${url}`).not.toMatch(/\/public\//);
  // And landed on a real in-app route. Accepting BOTH /app/ and /page/ keeps this
  // working across builds that route the authenticated home differently.
  expect(url, `expected an authenticated /page/* or /app/* route but got ${url}`).toMatch(/\/(app|page)\//);
}

// Group for the login check.
test.describe('Login verification (existing credentials)', () => {
  // Nothing to log in as → skip the whole group.
  test.skip(!ID, 'No LOGIN_ID set — launch via `npm run login:check`.');

  // Only declare the password test when the chosen method covers it.
  // This `if` runs at COLLECTION time, so the test simply doesn't exist otherwise.
  if (METHOD === 'password' || METHOD === 'both') {
    // Name the test after the account so the report says who was tested.
    test(`Password login → ${ID || '(none)'}`, async ({ page }) => {
      // Can't do a password login without a password.
      test.skip(!PWD, 'No LOGIN_PASSWORD provided for the password method.');
      // Allow 90 seconds — a cold login page can be slow.
      test.setTimeout(90_000);
      // Drive the real login form.
      await loginWithPassword(page, ID, PWD);
      // Log where we ended up before asserting, so a failure still shows the URL.
      console.log(`   after PASSWORD login → ${page.url()}`);
      // Check we actually got in.
      assertLoggedIn(page.url());
      // Log success.
      console.log(`✅ Password login OK for ${ID}`);
    });
  }

  // Same again for the OTP method.
  if (METHOD === 'otp' || METHOD === 'both') {
    // `context` is needed as well as `page` — the OTP helper opens a second tab to read the mailbox.
    test(`OTP login → ${ID || '(none)'}`, async ({ page, context }) => {
      test.setTimeout(180_000); // yopmail OTP polling can take a while
      // Request an OTP, read it out of the yopmail inbox, and submit it.
      await loginWithOtp(page, context, ID);
      // Log the landing URL.
      console.log(`   after OTP login → ${page.url()}`);
      // Same "did we actually get in" check as the password path.
      assertLoggedIn(page.url());
      // Log success.
      console.log(`✅ OTP login OK for ${ID}`);
    });
  }
});
