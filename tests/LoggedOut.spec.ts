/**
 * Logged-out access — private pages and APIs must not leak anything
 * ─────────────────────────────────────────────────────────────────
 * Opens every signed-in page with NO session and checks that nothing private
 * shows up. Two behaviours are accepted, because the portal uses both:
 *   - redirect to a public page / login (Home, course pages);
 *   - stay on the address but show only an empty shell with a "Log in" button
 *     (My Courses, Competency, Account, My Certificates).
 * Either way: no Logout, no profile fields, no course counts or Resume buttons.
 *
 * It also calls the private APIs with no session and expects them to refuse
 * (401/403/419, or a redirect to the login server).
 *
 * No login needed — runs on any BASE_URL.
 */
import { test, expect, Page } from '@playwright/test';
import { hiAlso, withCount } from './helpers/i18n';

const BASE_URL = (process.env.BASE_URL ?? 'https://sphere.aastrika.org').replace(/\/+$/, '');
const SAMPLE_COURSE = process.env.SAMPLE_COURSE_ID || 'do_11342648503935795211688';
const NO_USER = '00000000-0000-0000-0000-000000000000';

const PRIVATE_PAGES: { name: string; path: string }[] = [
  { name: 'Home', path: '/page/home' },
  { name: 'My Courses', path: '/app/user/my_courses' },
  { name: 'Competency', path: '/app/user/competency' },
  { name: 'Account', path: '/app/profile-view' },
  { name: 'My Certificates', path: '/app/user/my_certificates' },
  { name: 'Course page', path: `/app/toc/${SAMPLE_COURSE}/overview` },
];

/** Things only a signed-in user should ever see. */
async function privateMarkers(page: Page): Promise<string[]> {
  const found: string[] = [];
  const checks: [string, ReturnType<Page['locator']>][] = [
    ['Logout button', page.getByRole('button', { name: /^\s*(logout|log out|लॉग\s*आउट)\s*$/i })],
    ['Resume button', page.getByRole('button', { name: /^\s*(resume|जारी\s*रखें)\s*$/i })],
    ['Started/Completed counts', page.getByText(withCount('Started')).or(page.getByText(withCount('Completed')))],
    ['profile form (First name field)', page.locator('input[formcontrolname="firstname"], input[formcontrolname="firstName"]')],
    ['Save button', page.getByRole('button', { name: hiAlso(/^\s*save\s*$/i) })],
    ['Continue Learning section', page.getByText(hiAlso(/^\s*continue learning\s*$/i))],
  ];
  for (const [label, loc] of checks) {
    if (await loc.first().isVisible().catch(() => false)) found.push(label);
  }
  return found;
}

test.describe('Logged-out access — private pages', () => {
  for (const { name, path } of PRIVATE_PAGES) {
    test(`${name} shows nothing private without login`, async ({ page }) => {
      await page.goto(BASE_URL + path);
      await page.waitForLoadState('networkidle').catch(() => {});
      // Give the SPA time to redirect or paint, whichever it does.
      await page.waitForTimeout(3_000);

      const url = new URL(page.url());
      const redirected = /^\/(public\/|auth\/)/.test(url.pathname) || url.host !== new URL(BASE_URL).host;
      const leaks = await privateMarkers(page);
      expect(leaks, `${name} (${path}) shows private content to a logged-out visitor`).toEqual([]);

      if (redirected) {
        console.log(`✅ ${name}: redirected to ${url.pathname}`);
      } else {
        // Stayed on the page — then it must at least offer a way to log in.
        const loginPrompt = page.getByRole('button', { name: /^\s*(log\s*in|लॉगिन)\s*$/i })
          .or(page.getByRole('link', { name: /^\s*(log\s*in|लॉगिन)\s*$/i }))
          .or(page.getByText(hiAlso(/^\s*log\s*in\s*$/i)))
          .first();
        await expect(loginPrompt, `${name} stays on ${url.pathname} — it should at least show "Log in"`).toBeVisible();
        test.info().annotations.push({ type: 'note', description: `${name} does not redirect; shows an empty page with "Log in"` });
        console.log(`✅ ${name}: no redirect, empty page with "Log in" (nothing private shown)`);
      }
    });
  }
});

test.describe('Logged-out access — private APIs refuse', () => {
  const CALLS: { name: string; method: 'GET' | 'POST'; path: string; body?: unknown }[] = [
    { name: 'enrolment list', method: 'GET', path: `/apis/proxies/v8/learner/course/v1/user/enrollment/list/${NO_USER}` },
    { name: 'passbook', method: 'POST', path: '/apis/proxies/v8/user/v1/passbook', body: { request: { typeName: 'competency' } } },
    { name: 'user profile read', method: 'GET', path: `/apis/proxies/v8/api/user/v2/read/${NO_USER}` },
    { name: 'course progress', method: 'POST', path: '/apis/proxies/v8/learner/course/v1/content/state/read', body: { request: { userId: NO_USER, courseId: SAMPLE_COURSE, batchId: 'x' } } },
    { name: 'user details', method: 'GET', path: '/apis/protected/v8/user/details' },
  ];

  for (const c of CALLS) {
    test(`${c.name} API refuses a request with no session`, async ({ playwright }) => {
      // A bare request context: no cookies, no token.
      const api = await playwright.request.newContext();
      const res = await api.fetch(BASE_URL + c.path, {
        method: c.method,
        data: c.body,
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      const status = res.status();
      const location = res.headers()['location'] || '';
      await api.dispose();
      const refused = [401, 403, 419].includes(status) || (status >= 300 && status < 400 && /\/auth\//.test(location));
      expect(refused, `${c.method} ${c.path} answered ${status} ${location} — expected 401/403/419 or a login redirect`).toBe(true);
      console.log(`✅ ${c.name}: ${status}${status >= 300 && status < 400 ? ' → login redirect' : ' refused'}`);
    });
  }
});
