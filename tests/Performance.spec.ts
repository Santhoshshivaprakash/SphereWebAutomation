/**
 * Page-load timings — how long the main pages take
 * ────────────────────────────────────────────────
 * Times the main pages twice: on a normal connection, and on a simulated slow
 * 3G connection (many Sphere users are rural, on low-end phones). For each page:
 *
 *   TTFB   time until the server starts answering
 *   DCL    page structure ready (DOMContentLoaded)
 *   Load   everything loaded
 *   LCP    when the largest thing on screen (usually the main content) appeared
 *   KB     how much was downloaded
 *
 * A page FAILS only if it is slower than its budget (LCP). Budgets are generous
 * on purpose — the point is to catch a page that suddenly gets much slower:
 *   PERF_BUDGET_MS        normal connection   (default 8000)
 *   PERF_BUDGET_SLOW_MS   slow 3G             (default 30000)
 *
 * Every run is appended to test-reports/page-timings.csv so the trend can be
 * followed over time. Chrome only (the slow network is simulated through
 * Chrome's DevTools protocol).
 */
import { Page, BrowserContext } from '@playwright/test';
import { test, expect } from './helpers/authedTest';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = (process.env.BASE_URL ?? 'https://sphere.aastrika.org').replace(/\/+$/, '');
const BUDGET = Number(process.env.PERF_BUDGET_MS ?? 8_000);
const BUDGET_SLOW = Number(process.env.PERF_BUDGET_SLOW_MS ?? 30_000);
const SAMPLE_COURSE = process.env.SAMPLE_COURSE_ID || 'do_11342648503935795211688';
const CSV = path.resolve(__dirname, '..', 'test-reports', 'page-timings.csv');

const PUBLIC_PAGES = [
  { name: 'Public home', path: '/public/home' },
  { name: 'Login', path: '/public/login' },
];
const SIGNED_IN_PAGES = [
  { name: 'Home', path: '/page/home' },
  { name: 'My Courses', path: '/app/user/my_courses' },
  { name: 'Search results', path: '/app/search/learning?q=maternal' },
  { name: 'Course page', path: `/app/toc/${SAMPLE_COURSE}/overview` },
];

// Chrome DevTools "Slow 3G"-like profile: ~400 kbps down, 400 ms round trip.
const SLOW_3G = { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 };

type Timing = { ttfb: number; dcl: number; load: number; lcp: number; kb: number };

async function measure(page: Page, context: BrowserContext, url: string, slow: boolean): Promise<Timing> {
  // Count every byte that crosses the network (the page's own Performance API
  // hides sizes for files served from other domains, e.g. the content CDN).
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  if (slow) await cdp.send('Network.emulateNetworkConditions', SLOW_3G);
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => { bytes += e.encodedDataLength || 0; });

  // Record the largest paint from the very start of the page.
  await page.addInitScript(() => {
    (window as any).__lcp = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) (window as any).__lcp = Math.max((window as any).__lcp, e.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* not supported */ }
  });
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  // Let the app finish rendering its content (SPA) before reading LCP.
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1_000);
  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      ttfb: Math.round(nav.responseStart),
      dcl: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      lcp: Math.round((window as any).__lcp || nav.loadEventEnd),
    };
  });
  await cdp.detach().catch(() => {});
  return { ...t, kb: Math.round(bytes / 1024) };
}

function record(profile: string, name: string, t: Timing) {
  try {
    fs.mkdirSync(path.dirname(CSV), { recursive: true });
    if (!fs.existsSync(CSV)) fs.writeFileSync(CSV, 'when,environment,network,page,ttfb_ms,dcl_ms,load_ms,lcp_ms,kb\n');
    fs.appendFileSync(CSV, [new Date().toISOString(), new URL(BASE_URL).hostname, profile, name, t.ttfb, t.dcl, t.load, t.lcp, t.kb].join(',') + '\n');
  } catch { /* a logging problem must not fail the test */ }
}

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function report(profile: string, name: string, t: Timing, budget: number) {
  record(profile, name, t);
  const line = `${name} [${profile}]: TTFB ${fmt(t.ttfb)} · DCL ${fmt(t.dcl)} · Load ${fmt(t.load)} · LCP ${fmt(t.lcp)} · ${t.kb} KB`;
  test.info().annotations.push({ type: 'timing', description: line });
  console.log(`${t.lcp <= budget ? '✅' : '❌'} ${line}  (budget ${fmt(budget)})`);
  expect(t.lcp, `${name} on ${profile}: main content took ${fmt(t.lcp)}, budget ${fmt(budget)}`).toBeLessThanOrEqual(budget);
}

test.describe('Page-load timings', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'timings use Chrome DevTools (Chrome only)');
  test.setTimeout(240_000);

  for (const [profile, budget] of [['normal', BUDGET], ['slow 3G', BUDGET_SLOW]] as const) {
    for (const p of PUBLIC_PAGES) {
      test(`${p.name} — ${profile}`, async ({ browser }) => {
        // Logged out: a fresh context with no session.
        const context = await browser.newContext();
        const page = await context.newPage();
        const t = await measure(page, context, BASE_URL + p.path, profile === 'slow 3G');
        await context.close();
        report(profile, p.name, t, budget);
      });
    }
    for (const p of SIGNED_IN_PAGES) {
      test(`${p.name} (signed in) — ${profile}`, async ({ page, context }) => {
        const t = await measure(page, context, BASE_URL + p.path, profile === 'slow 3G');
        report(profile, p.name, t, budget);
      });
    }
  }
});
