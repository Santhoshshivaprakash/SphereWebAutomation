/**
 * Reference spec — the Layer 2 "fast path".
 *
 * Instead of the ~90s YOPmail signup wizard (helpers/fixtures.ts `freshAccount`),
 * provision a fresh user via API (`apiAccount`, ~1s) and then log in through the
 * real UI. This is the template for any UI test that needs "a logged-in user"
 * but doesn't need to test signup itself.
 *
 * Runs under the Chrome project. Skips cleanly when API creds aren't configured.
 */
// Import the test runner from our OWN fixtures file, not straight from Playwright —
// that's what adds the `apiAccount` fixture used below.
import { test, expect } from './helpers/apiFixtures';
// Helper that reports whether the API token / cookie is configured in .env.
import { hasApiCreds } from './helpers/sphereApi';
// Reusable helper that logs a user in through the real public/login UI.
import { loginWithPassword } from './helpers/login';

// Group for this spec. The @fastpath tag lets you target it with --grep @fastpath.
test.describe('Fast login via API-provisioned user @fastpath', () => {
  // Skip the whole group (rather than fail it) when the API credentials are missing.
  test.skip(!hasApiCreds(), 'SPHERE_API_TOKEN / cookie not set — configure .env');

  // `apiAccount` is a fixture: it creates a brand-new user over the API before the test runs.
  test('an API-provisioned user can log in through the UI', async ({ page, apiAccount }) => {
    // Log which account we were handed, so the run output shows who we logged in as.
    console.log(`Provisioned via API (no signup wizard): ${apiAccount.email}`);

    // Drive the real login form with that account's email and password.
    await loginWithPassword(page, apiAccount.email, apiAccount.password);

    // Success = we left the public login page for the authenticated app.
    // If we're still on /public/login, the credentials were rejected.
    expect(page.url()).not.toContain('/public/login');
    // Log where we ended up.
    console.log(`Logged in — landed on: ${page.url()}`);
  });
});
