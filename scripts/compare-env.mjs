/**
 * Production vs Staging, side by side.
 * ────────────────────────────────────
 * Loads every feature in config/compare-routes.json on BOTH environments at
 * the same time, in two browser contexts, and reports what differs:
 *
 *   UI        screenshots left/right + a pixel diff of the viewport shot,
 *             missing headings/buttons/fields/links, broken images, copy drift
 *   Function  HTTP status, redirects, blank pages, console + uncaught JS
 *             errors, failing network requests, page-settle time, build hash
 *   Data      API parity (status/count/latency) and course-catalogue parity
 *             (which courses exist on one environment but not the other)
 *
 * Output: a branded side-by-side HTML report + a JSON summary under
 * compare-reports/. Exit code is 1 when anything BLOCKING was found, so it can
 * gate a release.
 *
 *   npm run compare                        prod vs staging, public pages
 *   npm run compare -- --auth              also the signed-in features
 *   npm run compare -- --only home,course  just routes whose id/name matches
 *   npm run compare -- --headed            watch it run
 *   npm run compare -- --a https://sphere.aastrika.org --b http://localhost:3000
 *   npm run compare -- --threshold 1.5     ignore visual diffs under 1.5%
 *   npm run compare -- --no-catalogue      skip the course-catalogue parity pass
 *   npm run compare -- --refresh           re-fetch catalogue + re-login
 *
 * Credentials for --auth, most specific first:
 *   PROD_EMAIL/PROD_PASSWORD · STAGING_EMAIL/STAGING_PASSWORD
 *   → TEST_USER_EMAIL/TEST_USER_PASSWORD → MONITOR_* → config/accounts.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { capture, probeApi } from './lib/env-capture.mjs';
import { diffRoute, diffApi, diffCatalogue, pixelDiff } from './lib/env-diff.mjs';
import { renderReport } from './lib/env-report.mjs';
import { renderSimpleHtml, renderText } from './lib/simple-report.mjs';
import { authState, credentialsFor } from './lib/env-login.mjs';
import { loadCourses } from './lib/courses.mjs';
import { walk, stepsFor, withVars } from './lib/journey.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
require('dotenv').config({ path: resolve(ROOT, '.env') });

// ── args ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(name);

const URL_A = (flag('--a', 'https://sphere.aastrika.org') || '').replace(/\/+$/, '');
const URL_B = (flag('--b', 'https://portal-staging.aastrika.org') || '').replace(/\/+$/, '');
const LABEL_A = flag('--label-a', labelFor(URL_A));
const LABEL_B = flag('--label-b', labelFor(URL_B));
const WITH_AUTH = has('--auth');
const HEADED = has('--headed');
const REFRESH = has('--refresh');
const NO_CATALOGUE = has('--no-catalogue');
const NO_FULLPAGE = has('--no-fullpage');
const ONLY = (flag('--only', '') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// Exact ids (what the interactive picker sends) and one-off paths that are not
// in the inventory — e.g. a single course page you want to eyeball right now.
const IDS = (flag('--ids', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
// Journeys: flows walked step by step on both sides. --journey all runs them all.
const JOURNEY = (flag('--journey', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOW_WRITES = has('--allow-writes');
const NO_PAGES = has('--journey-only');
const NO_PDF = has('--no-pdf');
const EXTRA = argv.reduce((acc, a, i) => (a === '--route' && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
const THRESHOLD = Number(flag('--threshold', '0.5'));
const SETTLE = Number(flag('--settle', '800'));
const VIEWPORT = (flag('--viewport', '1280x800') || '').split('x').map(Number);

function labelFor(url) {
  const h = new URL(url).hostname;
  if (/^sphere\./i.test(h)) return 'Production';
  if (/portal-staging/i.test(h)) return 'Staging';
  if (/^uat\./i.test(h)) return 'UAT';
  if (/^localhost|^127\./.test(h)) return 'Localhost';
  return h;
}

// ── inventory ─────────────────────────────────────────────────────────
const inventory = JSON.parse(readFileSync(resolve(ROOT, 'config', 'compare-routes.json'), 'utf-8'));
const matches = (r) => !ONLY.length || ONLY.some((o) => r.id.toLowerCase().includes(o) || r.name.toLowerCase().includes(o));
const picked = (r) => !IDS.length || IDS.includes(r.id);
// --no-inventory: compare ONLY the --route paths given on the command line.
const routes = [
  ...(has('--no-inventory') || NO_PAGES
    ? []
    : inventory.routes.filter((r) => !r.skip && picked(r) && matches(r) && (WITH_AUTH || !r.auth))),
  // A --route path is compared as given; signed-in state follows --auth.
  ...EXTRA.map((path) => ({
    id: 'adhoc-' + slug(path).slice(0, 40),
    name: path,
    path: path.startsWith('/') ? path : '/' + path,
    auth: WITH_AUTH,
  })),
];
const apiEndpoints = (inventory.api || []).filter((e) => !e.skip);

// Known noise (analytics beacons, chat widgets…) muted via config, so the
// report stays about the portal. Nothing is muted by default.
const ignoreRe = (list) => (list || []).map((p) => new RegExp(p, 'i'));
const IGNORE_CONSOLE = ignoreRe(inventory.ignore?.console);
const IGNORE_REQUESTS = ignoreRe(inventory.ignore?.requests);
let ignoredCount = 0;

/** Drop muted console errors / failing requests from a capture, in place. */
function applyIgnores(cap) {
  const before = (cap.consoleErrors?.length || 0) + (cap.failedRequests?.length || 0);
  if (IGNORE_CONSOLE.length) {
    cap.consoleErrors = (cap.consoleErrors || []).filter((t) => !IGNORE_CONSOLE.some((re) => re.test(t)));
    cap.pageErrors = (cap.pageErrors || []).filter((t) => !IGNORE_CONSOLE.some((re) => re.test(t)));
  }
  if (IGNORE_REQUESTS.length) {
    cap.failedRequests = (cap.failedRequests || []).filter((r) => !IGNORE_REQUESTS.some((re) => re.test(r.host + r.url)));
  }
  ignoredCount += before - ((cap.consoleErrors?.length || 0) + (cap.failedRequests?.length || 0));
  return cap;
}

// ── journeys ──────────────────────────────────────────────────────────
const journeyFile = resolve(ROOT, 'config', 'compare-journeys.json');
const allJourneys = existsSync(journeyFile) ? JSON.parse(readFileSync(journeyFile, 'utf-8')).journeys || [] : [];
const wantsAll = JOURNEY.includes('all');
const journeys = allJourneys.filter(
  (j) => !j.skip && (wantsAll || JOURNEY.includes(j.id)) && (WITH_AUTH || !j.auth),
);
if (JOURNEY.length && !journeys.length) {
  console.error(`\n✖ No journey matched "${JOURNEY.join(',')}". Available: ${allJourneys.map((j) => j.id).join(', ')}`);
  console.error('  (signed-in journeys need --auth)\n');
  process.exit(1);
}

if (!routes.length && !journeys.length) {
  console.error(`\n✖ No routes to compare${ONLY.length ? ` for --only ${ONLY.join(',')}` : ''}${IDS.length ? ` for --ids ${IDS.join(',')}` : ''}.`);
  console.error('  Check config/compare-routes.json (signed-in routes need --auth), or pass --route /some/path.\n');
  process.exit(1);
}

// ── output folders ────────────────────────────────────────────────────
const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT_DIR = resolve(ROOT, 'compare-reports');
const RUN_NAME = `compare_${slug(LABEL_A)}_vs_${slug(LABEL_B)}_${stamp}`;
const ASSETS_NAME = `${RUN_NAME}_assets`;
const ASSETS_DIR = resolve(OUT_DIR, ASSETS_NAME);
mkdirSync(ASSETS_DIR, { recursive: true });

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── run ───────────────────────────────────────────────────────────────
console.log(`\n🔍  Comparing ${LABEL_A} vs ${LABEL_B}`);
console.log(`    A: ${URL_A}`);
console.log(`    B: ${URL_B}`);
console.log(`    ${routes.length} feature${routes.length === 1 ? '' : 's'}${WITH_AUTH ? ' (incl. signed-in)' : ' (public only — add --auth for the rest)'}\n`);

const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
});

const viewport = { width: VIEWPORT[0] || 1280, height: VIEWPORT[1] || 800 };
let authNote = 'public pages only';

/** One context per environment, signed in when asked for. */
async function contextFor(baseUrl, label) {
  const opts = { viewport, ignoreHTTPSErrors: true };
  if (WITH_AUTH) {
    const creds = credentialsFor(baseUrl);
    if (!creds) {
      console.log(`   ⚠️  no credentials for ${label} — signed-in features will be compared logged out`);
    } else {
      try {
        const { state } = await authState(browser, baseUrl, creds.email, creds.password, { refresh: REFRESH });
        opts.storageState = state;
      } catch (e) {
        console.log(`   ⚠️  login failed on ${label}: ${e.message}`);
      }
    }
  }
  return browser.newContext(opts);
}

const ctxA = await contextFor(URL_A, LABEL_A);
const ctxB = await contextFor(URL_B, LABEL_B);
if (WITH_AUTH) {
  const ca = credentialsFor(URL_A);
  const cb = credentialsFor(URL_B);
  authNote = `signed in as ${ca?.email ?? '—'} (${LABEL_A}) / ${cb?.email ?? '—'} (${LABEL_B})`;
}

const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

const results = [];
for (const [i, route] of routes.entries()) {
  process.stdout.write(`  [${i + 1}/${routes.length}] ${route.name.padEnd(22)} `);
  const opts = { shotDir: ASSETS_DIR, fullPage: !NO_FULLPAGE, settle: SETTLE };

  // Both environments are hit at the same moment, so a transient backend blip
  // shows up on both sides instead of looking like a regression on one.
  const [A, B] = await Promise.all([
    capture(pageA, route, URL_A, { ...opts, prefix: 'a' }).then(applyIgnores).catch((e) => errorCapture(route, URL_A, e)),
    capture(pageB, route, URL_B, { ...opts, prefix: 'b' }).then(applyIgnores).catch((e) => errorCapture(route, URL_B, e)),
  ]);

  let pixel = null;
  let diffImage = '';
  if (A.shots?.viewport && B.shots?.viewport) {
    const outName = `diff_${route.id}.png`;
    pixel = pixelDiff(
      resolve(ASSETS_DIR, A.shots.viewport),
      resolve(ASSETS_DIR, B.shots.viewport),
      resolve(ASSETS_DIR, outName),
      { tolerance: 24, minPercent: THRESHOLD },
    );
    if (pixel.wrote) diffImage = outName;
  }

  const r = diffRoute(route, A, B, { labelA: LABEL_A, labelB: LABEL_B, pixelThreshold: THRESHOLD, pixel });
  r.diffImage = diffImage;
  results.push(r);

  const mark = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ', same: '✅' }[r.worst];
  const px = pixel && !pixel.unavailable && !pixel.sizeMismatch ? ` · ${pixel.percent.toFixed(2)}% pixels` : '';
  console.log(`${mark} ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}${px}`);
}

function errorCapture(route, baseUrl, e) {
  return {
    routeId: route.id,
    url: baseUrl + route.path,
    finalUrl: baseUrl + route.path,
    redirected: false,
    status: 0,
    navError: String(e?.message || e).slice(0, 300),
    timings: { domReadyMs: 0, idleMs: 0 },
    consoleErrors: [], consoleWarnings: [], pageErrors: [], failedRequests: [],
    shots: {}, headings: [], buttons: [], links: [], fields: [], bundles: [],
    counts: {}, brokenImages: [], text: '', textLength: 0, isBlank: true,
  };
}

// ── journeys: walk the flow on both sides, comparing at every step ────
const skippedWrites = [];
for (const raw of journeys) {
  const stamp = String(startedAt.getTime()).slice(-6);
  const journey = withVars(raw, { stamp, email: `cmp${stamp}@yopmail.com` });
  const { steps, skipped } = stepsFor(journey, ALLOW_WRITES);
  if (skipped.length) skippedWrites.push({ journey: journey.name, steps: skipped.map((s) => s.label) });

  console.log(`\n  🚶 Journey: ${journey.name} — ${steps.length} step${steps.length === 1 ? '' : 's'}` +
    (skipped.length ? ` (${skipped.length} write step(s) skipped — add --allow-writes to include them)` : ''));

  const opts = { shotDir: ASSETS_DIR, fullPage: !NO_FULLPAGE, steps };
  const [walkA, walkB] = await Promise.all([
    walk(pageA, journey, URL_A, { ...opts, prefix: 'a' }).catch((e) => { console.log(`     ✖ ${LABEL_A}: ${e.message}`); return []; }),
    walk(pageB, journey, URL_B, { ...opts, prefix: 'b' }).catch((e) => { console.log(`     ✖ ${LABEL_B}: ${e.message}`); return []; }),
  ]);

  for (const [i, step] of steps.entries()) {
    const A = applyIgnores(walkA[i] || errorCapture({ id: `${journey.id}-s${i + 1}`, path: journey.path }, URL_A, new Error('step not reached')));
    const B = applyIgnores(walkB[i] || errorCapture({ id: `${journey.id}-s${i + 1}`, path: journey.path }, URL_B, new Error('step not reached')));

    const stepRoute = {
      id: `${journey.id}-s${i + 1}`,
      name: `${journey.name} · ${step.label}`,
      path: journey.path,
      auth: journey.auth,
      journey: journey.name,
      note: step.do?.length
        ? `Reached by: ${step.do.map(describeAction).join(', ')}.`
        : 'The screen the journey starts on.',
    };

    let pixel = null;
    let diffImage = '';
    if (A.shots?.viewport && B.shots?.viewport) {
      const outName = `diff_${stepRoute.id}.png`;
      pixel = pixelDiff(
        resolve(ASSETS_DIR, A.shots.viewport),
        resolve(ASSETS_DIR, B.shots.viewport),
        resolve(ASSETS_DIR, outName),
        { tolerance: 24, minPercent: THRESHOLD },
      );
      if (pixel.wrote) diffImage = outName;
    }

    const r = diffRoute(stepRoute, A, B, { labelA: LABEL_A, labelB: LABEL_B, pixelThreshold: THRESHOLD, pixel });
    r.diffImage = diffImage;
    results.push(r);

    const mark = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ', same: '✅' }[r.worst];
    const px = pixel && !pixel.unavailable && !pixel.sizeMismatch ? ` · ${pixel.percent.toFixed(2)}% pixels` : '';
    console.log(`     ${mark} ${step.label.padEnd(30)} ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}${px}`);
  }
}

function describeAction(a) {
  if (a.click) return `click "${a.click}"`;
  if (a.fill) return `type into ${a.fill.split(',')[0]}`;
  if (a.waitFor) return `wait for "${a.waitFor}"`;
  return `wait ${a.wait} ms`;
}

// ── API parity ────────────────────────────────────────────────────────
const apiResults = [];
if (apiEndpoints.length) {
  console.log('\n  API parity …');
  for (const ep of apiEndpoints) {
    const [a, b] = await Promise.all([probeApi(new URL(URL_A).origin, ep), probeApi(new URL(URL_B).origin, ep)]);
    const r = diffApi(a, b, LABEL_A, LABEL_B);
    apiResults.push(r);
    console.log(`    ${r.worst === 'same' ? '✅' : r.worst === 'error' ? '❌' : 'ℹ️ '} ${ep.name.padEnd(20)} ${a.status}/${b.status}  count ${a.count ?? '—'}/${b.count ?? '—'}`);
  }
}

// ── catalogue parity ──────────────────────────────────────────────────
let catalogue = null;
if (!NO_CATALOGUE) {
  console.log('\n  Course catalogue parity …');
  const [ca, cb] = await Promise.all([
    loadCourses(new URL(URL_A).origin, { refresh: REFRESH, print: () => {} }).catch(() => []),
    loadCourses(new URL(URL_B).origin, { refresh: REFRESH, print: () => {} }).catch(() => []),
  ]);
  if (ca.length || cb.length) {
    catalogue = diffCatalogue(ca, cb, LABEL_A, LABEL_B);
    console.log(`    ${LABEL_A}: ${catalogue.totalA} · ${LABEL_B}: ${catalogue.totalB} · only-A ${catalogue.onlyA.length} · only-B ${catalogue.onlyB.length}`);
  } else {
    console.log('    (catalogue unavailable on both environments — skipped)');
  }
}

// ── report ────────────────────────────────────────────────────────────
const durationMs = Date.now() - startedAt.getTime();
const reportData = {
  labelA: LABEL_A, labelB: LABEL_B, urlA: URL_A, urlB: URL_B,
  routes: results, api: apiResults, catalogue,
  assetsDir: ASSETS_NAME,
  startedAt: startedAt.toLocaleString(),
  durationMs,
  authNote,
  skippedWrites,
};

const htmlPath = resolve(OUT_DIR, `${RUN_NAME}.html`);
const simplePath = resolve(OUT_DIR, `${RUN_NAME}_SIMPLE.html`);
const textPath = resolve(OUT_DIR, `${RUN_NAME}_SIMPLE.txt`);
const jsonPath = resolve(OUT_DIR, `${RUN_NAME}.json`);
writeFileSync(htmlPath, renderReport(reportData), 'utf-8');
// The plain-language pair: side-by-side columns + pictures, and the same thing
// as text for pasting into a ticket or an email.
writeFileSync(simplePath, renderSimpleHtml(reportData), 'utf-8');
writeFileSync(textPath, renderText(reportData), 'utf-8');
writeFileSync(jsonPath, JSON.stringify({
  startedAt: startedAt.toISOString(), durationMs,
  envA: { label: LABEL_A, url: URL_A }, envB: { label: LABEL_B, url: URL_B },
  auth: WITH_AUTH, authNote,
  routes: results.map((r) => ({
    id: r.route.id, name: r.route.name, path: r.route.path, worst: r.worst,
    findings: r.findings,
    pixelPercent: r.pixel && !r.pixel.unavailable && !r.pixel.sizeMismatch ? r.pixel.percent : null,
    a: slimCapture(r.A), b: slimCapture(r.B),
  })),
  api: apiResults.map((r) => ({ id: r.a.id, worst: r.worst, a: r.a, b: r.b, findings: r.findings })),
  catalogue,
}, null, 2), 'utf-8');

// ── PDF (printed from the simple report, so it reads the same) ────────
const pdfPath = resolve(OUT_DIR, `${RUN_NAME}_SIMPLE.pdf`);
let pdfWritten = false;
if (!NO_PDF) {
  process.stdout.write('\n🖨  Printing the simple report to PDF … ');
  try {
    const pdfPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await pdfPage.goto(pathToFileURL(simplePath).href, { waitUntil: 'networkidle', timeout: 120000 });
    await pdfPage.emulateMedia({ media: 'screen' }); // keep the colours and the highlight rows
    await pdfPage.waitForTimeout(1200);
    await pdfPage.pdf({
      path: pdfPath,
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '10mm', bottom: '12mm', left: '8mm', right: '8mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-family:Segoe UI,Arial,sans-serif;font-size:8pt;color:#7C8696;padding:0 10mm;">' +
        `<span style="float:left;">${LABEL_A} vs ${LABEL_B} — ${startedAt.toLocaleString()}</span>` +
        '<span style="float:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    });
    await pdfPage.close();
    pdfWritten = true;
    console.log('done');
  } catch (e) {
    console.log(`failed (${e.message.slice(0, 120)})`);
  }
}

await browser.close().catch(() => {});

function slimCapture(c) {
  return {
    status: c.status, finalUrl: c.finalUrl, navError: c.navError, timings: c.timings,
    counts: c.counts, consoleErrors: c.consoleErrors, pageErrors: c.pageErrors,
    failedRequests: c.failedRequests, title: c.title, lang: c.lang, shots: c.shots,
  };
}

const blocking = results.filter((r) => r.worst === 'error').length +
  apiResults.filter((r) => r.worst === 'error').length;
const review = results.filter((r) => r.worst === 'warn').length;
const identical = results.filter((r) => r.worst === 'same').length;

console.log(`\n${'═'.repeat(70)}`);
console.log(`  ${LABEL_A} vs ${LABEL_B} — ${blocking} blocking · ${review} to review · ${identical} identical`);
console.log(`${'═'.repeat(70)}`);
console.log(`\n📗 Simple report (side-by-side, plain English) : ${simplePath}`);
console.log(`📄 Same thing as text                         : ${textPath}`);
if (pdfWritten) console.log(`📕 Same thing as PDF                          : ${pdfPath}`);
console.log(`📊 Detailed report                            : ${htmlPath}`);
console.log(`🧾 JSON (for CI)                              : ${jsonPath}`);
console.log(`🖼  Images                                     : ${ASSETS_DIR}\n`);

if (existsSync(simplePath) && has('--open')) {
  // Open the plain-English one — that is the report people actually read.
  const { spawn } = await import('node:child_process');
  const opener = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', simplePath]]
    : process.platform === 'darwin'
      ? ['open', [simplePath]]
      : ['xdg-open', [simplePath]];
  spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
}

process.exit(blocking ? 1 : 0);
