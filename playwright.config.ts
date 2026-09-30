import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Auto-load .env at startup so process.env.* works in tests.
dotenv.config({ path: path.resolve(__dirname, '.env') });

// ── BASE_URL / STAGING_URL must be ORIGINS ────────────────────────────
// Every spec and helper treats these as an origin and appends a path:
//   `${BASE_URL}/app/create-account`, `${BASE_URL}/public/login`, ...
// A path in the value (e.g. https://host/public/home) makes each derived URL
// hit the Angular SPA fallback, which answers 200 while rendering the PUBLIC
// HOME PAGE. Specs then run against the wrong screen and fail somewhere far
// from the real cause. 24 files build URLs this way, so normalise once here
// rather than in each of them.
for (const key of ['BASE_URL', 'STAGING_URL'] as const) {
  const raw = process.env[key];
  if (!raw) continue;
  try {
    const u = new URL(raw);
    if (u.pathname !== '/' || u.search || u.hash) {
      console.warn(
        `⚠  ${key} had a path ("${u.pathname}${u.search}${u.hash}") — using origin "${u.origin}".\n` +
        `   ${key} must be an origin; helpers append their own paths.`
      );
    }
    process.env[key] = u.origin;
  } catch {
    console.warn(`⚠  ${key}="${raw}" is not a valid URL — leaving it as-is.`);
  }
}

// Reporters. The branded/excel/email reporters always run. When BLOB=1 (grouped
// runs that will be merged later) we ALSO emit a Playwright blob to blob-reports/
// so `playwright merge-reports` can stitch multiple runs into one report; the
// per-run standard HTML report is dropped in that mode to avoid conflicts.
const reporters: any[] = [
  ['list'],
  ['./reporters/excel-reporter.ts'],
  ['./reporters/brand-html-reporter.ts'], // Tarento-styled HTML → brand-reports/ on every run
  ['./reporters/run-report.ts'],          // full HTML + PDF (every step/log) → test-reports/run-reports/
  ['./reporters/email-reporter.ts'],      // no-op unless SMTP_HOST + ALERT_EMAIL_TO are set
];
// JSON_OUT: a machine-readable result file, ON TOP of the usual reporters.
// scripts/run.mjs sets it per environment when running BOTH, then stitches the
// two files into one side-by-side report — so nothing here is replaced.
if (process.env.JSON_OUT) {
  reporters.push(['json', { outputFile: process.env.JSON_OUT }]);
}
if (process.env.BLOB === '1') {
  // Each group writes to its OWN dir (the blob reporter clears its outputDir on
  // start, so separate dirs prevent one group wiping another's blob).
  reporters.push(['blob', { outputDir: process.env.BLOB_DIR || 'blob-reports', fileName: process.env.BLOB_NAME || 'report.zip' }]);
} else {
  reporters.push(['html', { outputFolder: 'playwright-report' }]);
}

// Specs that mint REAL accounts on the target environment (yopmail signups).
// `npm run test:all -- --no-signup` sets SKIP_SIGNUP=1 to keep a full-suite run
// from creating a pile of users on production.
const SIGNUP_SPECS = [
  '**/create-account.spec.ts',
  '**/positiveflow.spec.ts',
  '**/OTP.spec.ts',
  '**/yopmail.spec.ts',
  '**/api/userProvisioning.api.spec.ts',
];
const signupIgnore = process.env.SKIP_SIGNUP === '1' ? SIGNUP_SPECS : [];

export default defineConfig({
  testDir: './tests',

  // ── Timing ─────────────────────────────────────────────────────
  timeout: 300_000,                  // 5 min per test ceiling
  expect: { timeout: 10_000 },       // assertion timeout

  // ── Execution mode ─────────────────────────────────────────────
  fullyParallel: false,              // never run tests in parallel
  workers: 1,                        // single browser tab at a time
  retries: 0,                        // no retries (signup flows are expensive)

  // ── Reporting ──────────────────────────────────────────────────
  reporter: reporters,

  // ── Browser/page defaults ──────────────────────────────────────
  use: {
    baseURL: process.env.BASE_URL ?? 'https://sphere.aastrika.org',
    // Headed by default (matches the run:* scripts). The master report run sets
    // HEADLESS=true for a fast, unattended full-suite pass.
    // CI machines (GitHub sets CI=true) have no screen, so they are always headless.
    headless: process.env.HEADLESS === 'true' || !!process.env.CI,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    // 'on' = capture for EVERY test, not just failures — the branded/PDF report
    // then shows visual evidence for passing runs too (each image is embedded).
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'on-first-retry',

    launchOptions: {
      args: [
        '--disable-features=SafeBrowsingEnhancedProtection,SafeBrowsing,IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--no-default-browser-check',
        '--no-first-run',
        '--disable-popup-blocking',
      ],
    },
  },

  projects: [
    // Layer 2 — API / service tests. No browser.
    { name: 'api', testMatch: '**/api/**/*.spec.ts', testIgnore: signupIgnore },
    // Layer 7 — synthetic production smoke (runs on a schedule in CI).
    { name: 'monitor', testMatch: '**/monitor/**/*.spec.ts', use: { ...devices['Desktop Chrome'] } },
    // The 'legacy' project (SphereCase.spec.ts, 108 tests) was retired on
    // 2026-09-08 — see archive/README.md. Its areas are all covered by the
    // dedicated specs, and its failures were test rot, not product defects.
    // Layer 1 — UI / E2E tests. Excludes API and monitor.
    { name: 'Chrome', testIgnore: ['**/api/**', '**/monitor/**', '**/SphereCase.spec.ts', ...signupIgnore], use: { ...devices['Desktop Chrome'] } },
  ],
});