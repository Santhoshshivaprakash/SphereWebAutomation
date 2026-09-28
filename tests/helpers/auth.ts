// Types for the browser and the isolated context this helper builds.
import { Browser, BrowserContext } from '@playwright/test';

// Which environment we're authenticating against.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

/**
 * Session cookie used to authenticate against environments where the normal
 * login flow doesn't work (e.g. the localhost prod-mirror). Provide it via
 * .env:
 *
 *   SESSION_COOKIE=<the connect.sid value copied from the browser>
 *   # optional overrides:
 *   SESSION_COOKIE_NAME=connect.sid
 *
 * Copy the value from DevTools → Application → Cookies → (your origin).
 * Paste the RAW value exactly (it usually starts with "s%3A").
 */
export function getSessionCookie(): { name: string; value: string } | null {
  // Accept either env var name; empty string if neither is set.
  const value = process.env.SESSION_COOKIE || process.env.CONNECT_SID || '';
  // The cookie's name, defaulting to the Express session cookie.
  const name = process.env.SESSION_COOKIE_NAME || 'connect.sid';
  // Return null (not an empty object) when unconfigured, so callers can fall back to a real login.
  return value ? { name, value } : null;
}

/**
 * Create a browser context pre-seeded with the shared session cookie for the
 * current BASE_URL origin. Returns null if no SESSION_COOKIE is configured, so
 * callers can fall back to a normal login.
 */
export async function newCookieAuthedContext(browser: Browser): Promise<BrowserContext | null> {
  // Read the configured cookie.
  const cookie = getSessionCookie();
  // Nothing configured — tell the caller so they can log in normally instead.
  if (!cookie) return null;

  // A fresh, empty context we're about to seed.
  const context = await browser.newContext();

  // Seed the cookie on every origin the app authenticates against. The
  // localhost frontend calls the production API, so the session cookie must
  // exist on BOTH the frontend origin (BASE_URL) and the API origin
  // (API_ORIGIN, default sphere.aastrika.org). Cross-site API calls require
  // Secure + SameSite=None.
  // A Set de-duplicates, so when both are the same origin we only add the cookie once.
  const origins = new Set<string>([
    BASE_URL,
    process.env.API_ORIGIN ?? 'https://sphere.aastrika.org',
  ]);

  // Build one cookie object per origin.
  const cookies = [...origins].map((origin) => {
    // Parse the origin so we can read its hostname and protocol.
    const url = new URL(origin);
    // Is this origin served over HTTPS? That decides the two flags below.
    const https = url.protocol === 'https:';
    return {
      name: cookie.name,
      value: cookie.value,
      domain: url.hostname, // e.g. "localhost" or "sphere.aastrika.org"
      path: '/',
      // The real session cookie is httpOnly, so ours must be too.
      httpOnly: true,
      // Secure is only valid over HTTPS — setting it on http://localhost would drop the cookie.
      secure: https,
      // SameSite=None is what lets the cookie ride along on cross-site API calls, but it
      // REQUIRES Secure — hence Lax on plain HTTP. The cast narrows the string to the literal union.
      sameSite: (https ? 'None' : 'Lax') as 'None' | 'Lax',
    };
  });

  // Install them into the context.
  await context.addCookies(cookies);

  // The Angular app gates login on localStorage (keys like
  // `loginDetailsWithToken` and `userUUID`), not the cookie. Inject the
  // captured localStorage from the logged-in browser so the route guard
  // treats us as authenticated. Provide it via .env as SESSION_LOCALSTORAGE
  // (a JSON object of { key: value }).
  // Read the captured localStorage blob, if one was provided.
  const rawLs = process.env.SESSION_LOCALSTORAGE;
  // Only do this work when it's configured.
  if (rawLs) {
    // Where the parsed key/value pairs will go.
    let entries: Record<string, string> = {};
    try {
      // Parse the JSON from .env.
      entries = JSON.parse(rawLs);
    } catch {
      // Malformed JSON: warn and carry on with an empty object rather than crashing the run.
      console.warn('⚠️  SESSION_LOCALSTORAGE is not valid JSON — ignoring');
    }
    // Runs before app scripts on every navigation, so the guard sees the
    // auth state on first paint.
    await context.addInitScript((data: Record<string, string>) => {
      // Write each captured key into the page's localStorage.
      for (const [k, v] of Object.entries(data)) {
        // Wrapped individually so one blocked write (private mode, quota) doesn't stop the rest.
        try { window.localStorage.setItem(k, v); } catch { /* ignore */ }
      }
    }, entries);   // `entries` is passed in because the init script runs inside the browser.
  }

  // Hand back the fully seeded, already-authenticated context.
  return context;
}
