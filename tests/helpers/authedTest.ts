/**
 * authedTest — authenticated test harness that works in CI *and* locally.
 * ──────────────────────────────────────────────────────────────────────────
 * Replaces the CDP-only harness (helpers/cdpTest.ts) so the authenticated specs
 * can run headless in GitHub Actions. It authenticates ONCE per worker and hands
 * every test a logged-in context via Playwright storageState.
 *
 * Auth mode is chosen from env (first match wins):
 *   1. USE_CDP=1            → connect to a live, logged-in Chrome over CDP
 *                            (local dev on the localhost mirror, where UI login
 *                            and cookie-injection don't work). No storageState.
 *   2. SESSION_COOKIE (+ SESSION_LOCALSTORAGE) → seed the session and save state.
 *   3. AUTH_VIA_API=1      → provision a fresh user via the Sphere API, then UI-login.
 *   4. TEST_USER_EMAIL + TEST_USER_PASSWORD (or MONITOR_*) → UI login on a real env.
 *
 * CI (staging/prod) uses mode 3 or 4; localhost dev uses mode 1.
 */
import {
  // `base` is Playwright's test object, renamed so we can export our extended one as `test`.
  // `chromium` is needed to connect over CDP; `request` to make API calls without a browser.
  test as base, expect, chromium, request,
  Browser, BrowserContext,
} from '@playwright/test';
// Node's file system module — reads and writes the saved session files.
import * as fs from 'fs';
// Node's path module — builds cross-platform file paths.
import * as path from 'path';
// The shared UI-login helper.
import { loginWithPassword } from './login';
// Builds a context pre-seeded with a session cookie.
import { newCookieAuthedContext } from './auth';
// The API client class.
import { SphereApiClient } from './sphereApi';
// Creates a brand-new user over the API.
import { provisionUser } from './apiFixtures';

// Where this harness saves its session. `__dirname` is /tests/helpers, so '..','..' is the project root.
const STATE_FILE = path.resolve(__dirname, '..', '..', '.auth', 'state.json');
// A fresh, logged-in user's session captured by create-account after signup.
// Used to COMPLETE a course as a brand-new user (fresh email users are OTP-only,
// so there's no password to log in with). See create-account.spec.ts.
const FRESH_FILE = path.resolve(__dirname, '..', '..', '.auth', 'fresh-user.json');
// Which environment to authenticate against.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';
// Use 127.0.0.1, NOT "localhost": on Windows localhost resolves to ::1 (IPv6)
// first, while Chrome binds its DevTools port to 127.0.0.1 (IPv4). Mixing them
// produces a confusing "404 / not a DevTools server" when a stale Chrome holds
// the other stack's socket.
const CDP_ENDPOINT = process.env.CDP_ENDPOINT ?? 'http://127.0.0.1:9222';

// Mode 1 selected? Written as a function so it re-reads env at call time.
const useCdp = () => process.env.USE_CDP === '1';
// Should we reuse the session create-account minted?
const useFreshUser = () => process.env.USE_FRESH_USER === '1';

// Works out which email/password to log in with, provisioning a user first if asked to.
async function resolveCreds(): Promise<{ email: string; password: string }> {
  // Mode 3: make a brand-new user over the API, then use their credentials.
  if (process.env.AUTH_VIA_API === '1') {
    // A browser-less HTTP client for the API calls.
    const reqCtx = await request.newContext();
    // `try/finally` guarantees the client is disposed even if provisioning throws.
    try {
      // Wrap it in our API class.
      const api = new SphereApiClient(reqCtx);
      // Create the user in the configured org, defaulting to BNRC.
      const u = await provisionUser(api, process.env.SPHERE_DEFAULT_ORG || 'BNRC');
      // Log who we made, so the run output shows which account it used.
      console.log(`Provisioned auth user via API: ${u.email}`);
      // Hand back the new credentials.
      return { email: u.email, password: u.password };
    } finally {
      // Release the HTTP client.
      await reqCtx.dispose();
    }
  }
  // Mode 4: read credentials from env, accepting either the TEST_ or MONITOR_ prefix.
  const email = process.env.TEST_USER_EMAIL || process.env.MONITOR_EMAIL || '';
  const password = process.env.TEST_USER_PASSWORD || process.env.MONITOR_PASSWORD || '';
  // Nothing configured — fail immediately with instructions, rather than running
  // 50 tests against a login page and producing 50 confusing failures.
  if (!email || !password) {
    throw new Error(
      'Authenticated specs need credentials. Set ONE of:\n' +
        '  • USE_CDP=1 (local: connect to a logged-in Chrome over CDP)\n' +
        '  • SESSION_COOKIE (+ SESSION_LOCALSTORAGE) for cookie-injected auth\n' +
        '  • TEST_USER_EMAIL + TEST_USER_PASSWORD (UI login on a real env)\n' +
        '  • AUTH_VIA_API=1 with SPHERE_API_TOKEN + cookie (provision, then log in)',
    );
  }
  // Credentials found.
  return { email, password };
}

/**
 * Is this context ACTUALLY signed in?
 *
 * A `connect.sid` cookie proves nothing — the portal hands one to anonymous
 * visitors too, so a failed login still produces a plausible-looking
 * storageState. The honest signals are on the page: the authenticated header
 * carries the "What do you want to learn today?" search box, and the public
 * landing page carries a "Log in" button instead.
 *
 * Without this check a login that silently does not take is saved as a good
 * session, and the run fails much later with something unrelated — a missing
 * search box, twenty steps downstream of the real problem.
 */
async function verifyAuthenticated(ctx: BrowserContext, label: string): Promise<void> {
  const page = await ctx.newPage();
  try {
    await page.goto(`${BASE_URL}/page/home`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2_000);

    const state = await page.evaluate(() => {
      const vis = (e: Element) => (e as HTMLElement).offsetParent !== null;
      const clean = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim();
      const search = document.querySelector('input[placeholder*="learn today" i]');
      const loginBtn = Array.from(document.querySelectorAll('button, a'))
        .filter(vis).find((b) => /^log\s*in$/i.test(clean(b.textContent)));
      return { url: location.href, hasSearch: Boolean(search && vis(search)), hasLogin: Boolean(loginBtn) };
    });

    if (state.hasSearch && !state.hasLogin) return;   // signed in

    throw new Error(
      `Login did not take on ${new URL(BASE_URL).hostname} (${label}).\n`
      + `  Landed on: ${state.url}\n`
      + `  The page shows ${state.hasLogin ? 'a "Log in" button' : 'no authenticated header'}`
      + ' — the session saved would have been an anonymous one.\n'
      + '  Check the account exists ON THIS ENVIRONMENT and the password is right:'
      + ' production and staging are separate backends, so an account that works on one'
      + ' need not exist on the other.',
    );
  } finally {
    await page.close().catch(() => {});
  }
}

/** Authenticate once and write a storageState file; returns its path. */
async function buildStorageState(browser: Browser): Promise<string> {
  // Make sure the .auth folder exists. `recursive` also creates any missing parents.
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  // The context we'll capture the session from.
  let ctx: BrowserContext;

  // Mode 2: a session cookie was supplied, so seed it rather than logging in.
  if (process.env.SESSION_COOKIE || process.env.CONNECT_SID) {
    // Build a context with the cookie (and any captured localStorage) already installed.
    const cookieCtx = await newCookieAuthedContext(browser);
    // It returns null only if no cookie is configured — which we just checked, so this is a real error.
    if (!cookieCtx) throw new Error('SESSION_COOKIE is set but the authed context could not be created.');
    ctx = cookieCtx;
    // Materialise the session (localStorage is injected on navigation) so it's
    // captured in storageState.
    // Without this navigation the init script never runs, and storageState would save an empty localStorage.
    const page = await ctx.newPage();
    // Visit the authenticated home. Errors swallowed — the navigation is what matters, not the result.
    await page.goto(`${BASE_URL}/page/home`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    // Let the app finish writing its auth keys.
    await page.waitForLoadState('networkidle').catch(() => {});
    // Done with this tab.
    await page.close().catch(() => {});
  } else {
    // Modes 3 and 4: get credentials (provisioning first if needed) and log in through the UI.
    const { email, password } = await resolveCreds();
    // A clean context to log in within.
    ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Drive the real login form.
    const host = new URL(BASE_URL).hostname;
    console.log(`🔑 Auth: logging in as ${email} on ${host}`);
    try {
      await loginWithPassword(page, email, password);
    } catch (e) {
      // The helper's own assertion failure says nothing about WHO or WHERE.
      throw new Error(`Login failed for ${email} on ${host}: ${(e as Error).message.split('\n')[0]}`);
    }
    // The session now lives in the context, so the tab can go.
    await page.close().catch(() => {});
  }

  // Save cookies + origin storage to disk. Every test later loads this file.
  // Prove the session is real BEFORE it is written to disk and reused by
  // every test in this worker.
  await verifyAuthenticated(ctx, process.env.TEST_USER_EMAIL || process.env.MONITOR_EMAIL || 'the configured account');

  await ctx.storageState({ path: STATE_FILE });
  // Close the setup context — the saved file is all we need.
  await ctx.close();
  // Tell the caller where it went.
  return STATE_FILE;
}

/** Open a logged-in context (CDP session or a storageState context). */
async function openAuthedContext(browser: Browser, authFile: string): Promise<{ ctx: BrowserContext; close: boolean }> {
  // Mode 1: attach to a Chrome the developer already has open and logged in.
  if (useCdp()) {
    // The connected browser handle.
    let cdp: Browser;
    try {
      // Connect over the DevTools protocol.
      cdp = await chromium.connectOverCDP(CDP_ENDPOINT);
    } catch (e) {
      // Connection failed. Everything below builds a genuinely actionable error message.
      let port = '9222';
      // Pull the port out of the endpoint so the instructions name the right one.
      try { port = new URL(CDP_ENDPOINT).port || '9222'; } catch { /* keep default */ }
      // Was the endpoint overridden? If so, a stale env var is the likeliest cause.
      const usingOverride = Boolean(process.env.CDP_ENDPOINT);
      throw new Error(
        `USE_CDP=1 but could not connect to Chrome at ${CDP_ENDPOINT}.\n` +
          // Only mention the override when there actually is one.
          (usingOverride
            ? `CDP_ENDPOINT is set to "${process.env.CDP_ENDPOINT}". If you did not mean to ` +
              `use that port, clear it:\n    Remove-Item Env:\\CDP_ENDPOINT\n`
            : '') +
          // The exact command to launch a debuggable Chrome.
          `Otherwise launch Chrome with --remote-debugging-port=${port} and sign in first:\n` +
          `    & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=${port} --user-data-dir="$env:TEMP\\sphere-cdp"\n` +
          // And how to confirm it worked. The original error is appended at the end.
          `Verify it is live:  curl http://localhost:${port}/json/version\n\n${(e as Error).message}`,
      );
    }
    // Reuse the browser's existing context (that's where the login lives); make one only if there is none.
    const ctx = cdp.contexts()[0] ?? (await cdp.newContext());
    return { ctx, close: false }; // never close the user's browser/context
  }
  // Modes 2–4: build a fresh context from the saved session file.
  const ctx = await browser.newContext({ storageState: authFile });
  // `close: true` — we created it, so we clean it up.
  return { ctx, close: true };
}

// The extended test object. The second type parameter declares WORKER-scoped fixtures,
// which are built once per worker process rather than once per test.
export const test = base.extend<{}, { authFile: string; authContext: BrowserContext }>({
  // Worker-scoped: authenticate ONCE per worker (workers=1 ⇒ once per run).
  authFile: [
    async ({ browser }, use) => {
      // CDP mode authenticates by attaching to a live browser, so there's no file to build.
      if (useCdp()) {
        await use(''); // CDP mode needs no storageState
        return;
      }
      // Reuse the fresh signup session (to complete a course as a brand-new
      // user). Run create-account first to mint it.
      if (useFreshUser()) {
        // Only if create-account actually left one behind.
        if (fs.existsSync(FRESH_FILE)) {
          console.log(`🔑 Auth: reusing fresh-user session → ${FRESH_FILE}`);
          await use(FRESH_FILE);
          return;
        }
        // Asked for it but it isn't there — say so clearly, then fall through to a normal login.
        console.log('⚠️  USE_FRESH_USER=1 but .auth/fresh-user.json not found — run create-account first. Falling back to credential login.');
      }
      // Normal path: log in once and save the session.
      const file = await buildStorageState(browser);
      // Hand the path to every test in this worker.
      await use(file);
    },
    // This option is what makes the fixture run once per worker instead of once per test.
    { scope: 'worker' },
  ],

  // Worker-scoped shared logged-in context — for specs that keep ONE page across
  // all their tests (Account, Competency) via test.beforeAll.
  authContext: [
    async ({ browser, authFile }, use) => {
      // Open the logged-in context; `close` says whether we own it.
      const { ctx, close } = await openAuthedContext(browser, authFile);
      // Hand it to the tests.
      await use(ctx);
      // Teardown — but never close a browser the developer owns (CDP mode).
      if (close) await ctx.close().catch(() => {});
    },
    { scope: 'worker' },
  ],

  // Every test gets a logged-in context.
  // This OVERRIDES Playwright's built-in `context` fixture, so specs get a logged-in
  // one automatically just by importing `test` from this file.
  context: async ({ browser, authFile }, use) => {
    // Same helper as above, but test-scoped this time.
    const { ctx, close } = await openAuthedContext(browser, authFile);
    await use(ctx);
    // Again, only close what we created.
    if (close) await ctx.close().catch(() => {});
  },

  // Overrides the built-in `page` fixture so it opens inside our authenticated context.
  page: async ({ context }, use) => {
    // A fresh tab per test.
    const page = await context.newPage();
    // Hand it to the test.
    await use(page);
    // Close it afterwards. (Mycourse.spec.ts overrides this again to share one tab.)
    await page.close().catch(() => {});
  },
});

// Re-export `expect` unchanged so specs can get both from this one file.
export { expect };
