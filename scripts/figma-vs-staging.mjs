/**
 * Figma design vs Sphere staging — design-conformance report.
 * ──────────────────────────────────────────────────────────
 * Captures the live staging home page and the Figma frame it was designed
 * from, then reports every place the build departs from the design.
 *
 * The Figma side is a fixed reading of the frame (taken 2026-08-19) — the
 * design file is view-only over the public link, so its values are recorded
 * here rather than re-derived. The STAGING side is re-measured on every run
 * and each finding re-checked, so a finding flips to FIXED on its own once
 * the build catches up.
 *
 *   npm run compare:figma                 capture both, write the report
 *   npm run compare:figma -- --open       ...and open it
 *   npm run compare:figma -- --no-figma   skip the Figma capture (much faster)
 *   npm run compare:figma -- --url <u>    point at a different build
 *
 * Output: compare-reports/figma-vs-staging-<timestamp>.html (+ latest.html)
 */
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flag = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };

const STAGING_URL = flag('--url', 'https://portal-staging.aastrika.org/public/home');
const FIGMA_FILE = '292XaDAhFUjijPyfU2kN2H';
const FIGMA_NODE = '4973-4320';
const FIGMA_URL = `https://www.figma.com/design/${FIGMA_FILE}/For-Engg-build?node-id=${FIGMA_NODE}`;
const FIGMA_READ_ON = '2026-08-19';

const OUT_DIR = join(ROOT, 'compare-reports');
const SHOT_DIR = join(OUT_DIR, 'figma-vs-staging');
for (const d of [OUT_DIR, SHOT_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// ── the design reading ────────────────────────────────────────────────────
// Frame: "Sphere Desktop design → Home non logged in", 1440px wide.
// `check` runs against the live staging capture and returns the value found
// now; a finding is FIXED when that value matches `design`.
const FINDINGS = [
  // ---- missing / structural -----------------------------------------------
  { cat: 'missing', sev: 'high',
    what: 'Header search field',
    design: 'present',
    wasFound: 'absent',
    note: 'Rounded pill ~610x47px, "Search" placeholder, magnifier icon, between logo and Log in.',
    check: (s) => s.hasSearch ? 'present' : 'absent' },

  { cat: 'missing', sev: 'high',
    what: 'Footer column count',
    design: '4',
    wasFound: '3',
    note: 'Design: Quick Links / Policies / Help and Contact / Additional Links. The Policies column is not built.',
    check: (s) => String(s.footerHeadings.length) },

  { cat: 'missing', sev: 'medium',
    what: 'Footer "Policies" column',
    design: 'present',
    wasFound: 'absent',
    note: 'Its two links were folded into Quick Links instead.',
    check: (s) => s.footerHeadings.some(h => /^policies$/i.test(h)) ? 'present' : 'absent' },

  { cat: 'missing', sev: 'medium',
    what: 'Quick Links contents',
    design: 'My courses, Competency, Account',
    wasFound: 'Privacy policy, Terms of Use',
    note: 'VERIFY — these are signed-in destinations, so omitting them from the logged-out footer may be deliberate.',
    check: (s) => s.quickLinks.join(', ') || '(none)' },

  { cat: 'missing', sev: 'medium',
    what: '"Experience sphere app on mobile" + Google Play badge',
    design: 'present',
    wasFound: 'absent',
    note: 'Whole block missing from the footer. No signed-in excuse for this one.',
    check: (s) => s.hasPlayBadge ? 'present' : 'absent' },

  { cat: 'missing', sev: 'low',
    what: 'CTA band background',
    design: 'line-art illustration pattern',
    wasFound: 'flat colour',
    note: 'Behind "Transform your Healthcare career through Sphere!". Visual check — not auto-detected.',
    check: null },

  // ---- copy ----------------------------------------------------------------
  { cat: 'copy', sev: 'low', what: 'Hero prompt', design: 'New user?', wasFound: 'New User?',
    check: (s) => s.find(/new user\?/i) },
  { cat: 'copy', sev: 'medium', what: 'First course section label', design: 'FEATURED COURSES', wasFound: 'TOP COURSES',
    check: (s) => s.find(/^(featured|top) courses$/im) },
  { cat: 'copy', sev: 'low', what: 'Carousel link', design: 'View all', wasFound: 'View All',
    check: (s) => s.find(/view all/i) },
  { cat: 'copy', sev: 'low', what: 'Partners heading', design: 'Trusted by', wasFound: 'Trusted By',
    check: (s) => s.find(/trusted by/i) },
  { cat: 'copy', sev: 'low', what: 'Stat 1 label', design: 'Learners Onboarded', wasFound: 'Learners onboarded',
    check: (s) => s.find(/learners onboarded/i) },
  { cat: 'copy', sev: 'low', what: 'Stat 2 label', design: 'Certificate Coruses', wasFound: 'Number of courses',
    note: 'The design itself has a typo here ("Coruses"). Staging reworded rather than copying it — arguably correct.',
    check: (s) => s.find(/certificate coruses|number of courses/i) },
  { cat: 'copy', sev: 'low', what: 'Stat 4 label', design: 'Certificates Issued', wasFound: 'Total certificate issued',
    check: (s) => s.find(/certificates issued|total certificate issued/i) },
  { cat: 'copy', sev: 'low', what: 'Footer contact heading', design: 'Help and Contact', wasFound: 'Help & Contact',
    check: (s) => s.find(/help (and|&) contact/i) },
  { cat: 'copy', sev: 'medium', what: 'Privacy link casing', design: 'Privacy Policy', wasFound: 'Privacy policy',
    note: 'Staging flipped the casing on Privacy and Terms in OPPOSITE directions, so the two links no longer match each other.',
    check: (s) => s.find(/privacy polic\w+/i) },
  { cat: 'copy', sev: 'medium', what: 'Terms link casing', design: 'Terms of use', wasFound: 'Terms of Use',
    check: (s) => s.find(/terms of use/i) },
  { cat: 'copy', sev: 'low', what: 'Copyright line', design: '@2022 AastarUrmika Health Systems',
    wasFound: '© 2024 AastarUrmika Health Systems',
    note: 'Design is stale here, not the build.',
    check: (s) => s.find(/[@©]\s?\d{4} AastarUrmika Health Systems/) },

  // ---- visual --------------------------------------------------------------
  { cat: 'visual', sev: 'medium',
    what: 'Stat icons 2 and 3',
    design: 'bookmark=courses, cap=CNE Hours',
    wasFound: 'cap=courses, bookmark=CNE Hours',
    note: 'The two icons are swapped relative to the design. Visual check — not auto-detected.',
    check: null },
  { cat: 'visual', sev: 'medium',
    what: '"Log in" button size',
    design: '~128x47px',
    wasFound: '102x32px',
    note: 'Same fill (#2E6491) and 50px radius, but noticeably undersized. Design figure measured off the frame render, +/- a few px.',
    check: (s) => s.loginBtn ? `${s.loginBtn.w}x${s.loginBtn.h}px` : '(not found)' },
  { cat: 'visual', sev: 'medium',
    what: 'First course row fill',
    design: '4 cards, row full',
    wasFound: '3 cards, ~25% empty',
    note: 'Grid is sized for 4; only 3 courses exist, leaving dead space to the right of the row.',
    check: (s) => `${s.topCourseCards} cards` },
  { cat: 'visual', sev: 'low',
    what: 'Carousel dots',
    design: 'round, under banner on white',
    wasFound: 'pill-shaped, in grey strip above stats',
    note: 'Staging also loads with slide 2 active where the design shows slide 1 — may just be autoplay timing.',
    check: null },
  { cat: 'visual', sev: 'low',
    what: '"View all" treatment',
    design: 'underlined text link',
    wasFound: 'pill on #F8F8F8, no underline',
    check: null },
  { cat: 'visual', sev: 'low',
    what: '"How Sphere works" thumbnails',
    design: 'photographs (desk, laptop, certificate)',
    wasFound: 'illustrated phone mockups',
    note: 'Headings and sub-copy match exactly; only the imagery differs.',
    check: null },
  { cat: 'visual', sev: 'low',
    what: 'CNE badge format',
    design: 'CNE 1.5 (no colon)',
    wasFound: 'CNE: 7.5 (colon)',
    check: (s) => s.find(/CNE:?\s?[\d.]+/) },
];

// Staging problems that stand on their own, design aside.
const DEFECTS = [
  { sev: 'high', what: 'No heading elements on the page',
    detail: 'Zero <h1>-<h6>. "Access free Healthcare courses", "Trusted By" and "How Sphere works" are all styled <div>s. Accessibility and SEO problem on a page whose <title> targets "Free Online Courses for Nurses in India".',
    check: (s) => `${s.headingCount} heading elements` },
  { sev: 'medium', what: 'Third-party widget fails and throws',
    detail: 'api.freecustomer.in/api/v1/widgets/initial-loadup fails CORS preflight, then its bundle throws "Cannot read properties of undefined (reading \'template\')".',
    check: (s) => `${s.consoleErrors.length} console error(s)` },
];

// ── capture: staging ──────────────────────────────────────────────────────
async function captureStaging(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240)); });

  const resp = await page.goto(STAGING_URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SHOT_DIR, 'staging.png'), fullPage: true });

  const facts = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const txt = document.body.innerText;

    const login = [...document.querySelectorAll('button,a')].filter(vis)
      .find((e) => /^log ?in$/i.test(e.innerText.trim()));
    const lr = login?.getBoundingClientRect();

    // Footer column headings carry .link-header, and they sit outside <footer>,
    // so scan document-wide rather than scoping to the footer element.
    const headingEls = [...document.querySelectorAll('.link-header')].filter(vis)
      .filter((e) => !e.children.length);
    const footerHeadings = headingEls.map((e) => e.innerText.trim()).filter(Boolean);

    // Quick Links' anchors live several levels up (span > span > mat-list-item > mat-list).
    const qlHeading = headingEls.find((e) => /^quick links$/i.test(e.innerText.trim()));
    let quickLinks = [];
    for (let n = qlHeading?.parentElement, i = 0; n && i < 5; i++, n = n.parentElement) {
      const links = [...n.querySelectorAll('a')].map((a) => a.innerText.trim()).filter(Boolean);
      if (links.length) { quickLinks = links; break; }
    }

    // Course cards are buttons carrying a "Certificate"/"CNE" badge and a rating.
    // Group them by row (y position); the first row is the Top Courses carousel.
    const cardBtns = [...document.querySelectorAll('button,[role=button],a[class*=btn]')].filter(vis)
      .filter((e) => /^(certificate|cne)\b/i.test(e.innerText.trim()) && /\b\d\.\d\b/.test(e.innerText));
    const rows = new Map();
    for (const e of cardBtns) {
      const y = Math.round((e.getBoundingClientRect().top + scrollY) / 20) * 20;
      rows.set(y, (rows.get(y) || 0) + 1);
    }
    const topCourseCards = [...rows.entries()].sort((a, b) => a[0] - b[0])[0]?.[1] ?? 0;

    return {
      title: document.title,
      allText: txt,
      headingCount: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(vis).length,
      hasSearch: !!document.querySelector('input[type=search], input[placeholder*="Search" i], [role=search]')
                 || /(^|\n)\s*Search\s*(\n|$)/i.test(txt),
      hasPlayBadge: /experience sphere app on mobile/i.test(txt)
                    || !!document.querySelector('img[src*="google" i][src*="play" i], img[alt*="google play" i]'),
      footerHeadings,
      quickLinks,
      loginBtn: lr ? { w: Math.round(lr.width), h: Math.round(lr.height) } : null,
      topCourseCards,
    };
  });

  facts.status = resp?.status();
  facts.consoleErrors = consoleErrors;
  facts.find = (re) => (facts.allText.match(re) || ['(not found)'])[0].trim();
  await ctx.close();
  return facts;
}

// ── capture: the Figma frame ──────────────────────────────────────────────
// The file is view-only over the public link, so there is no selection or
// zoom-to-fit; we ctrl+wheel toward the frame until it fills the viewport.
async function captureFigma() {
  const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1500, height: 3200 }, deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
    const page = await ctx.newPage();
    await page.goto(FIGMA_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(18000);

    for (const t of ['Do not allow cookies', 'Close']) {
      const el = page.locator(`button:has-text("${t}")`).first();
      if (await el.count() && await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        await page.waitForTimeout(600);
      }
    }
    await page.keyboard.press('Escape').catch(() => {});

    const zoom = async () => +((await page.evaluate(
      () => (document.body.innerText.match(/\b(\d{1,4})%/) || [0, '0'])[1])) || 0);

    const [cx, cy] = [466, 1500];
    await page.keyboard.down('Control');
    for (let i = 0; i < 40; i++) {
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -260);
      await page.waitForTimeout(320);
      if (await zoom() >= 60) break;
    }
    await page.keyboard.up('Control');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: join(SHOT_DIR, 'figma.png') });
    return { ok: true, zoom: await zoom() };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) };
  } finally {
    await browser.close();
  }
}

// ── report ────────────────────────────────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CATS = {
  missing: ['Missing in staging', 'Present in the design, not built (or built differently).'],
  copy: ['Copy differences', 'Same element, different words or casing.'],
  visual: ['Visual & layout differences', 'Built, but does not look like the design.'],
};

function renderReport(results, staging, figma) {
  const open = results.filter((r) => r.status === 'OPEN').length;
  const fixed = results.filter((r) => r.status === 'FIXED').length;
  const visual = results.filter((r) => r.status === 'VISUAL').length;

  const row = (r) => `
    <tr>
      <td><span class="sev sev-${r.sev}">${r.sev}</span></td>
      <td class="what">${esc(r.what)}${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}</td>
      <td class="val design">${esc(r.design)}</td>
      <td class="val">${esc(r.now)}</td>
      <td><span class="st st-${r.status.toLowerCase()}">${r.status}</span></td>
    </tr>`;

  const section = (cat) => {
    const rows = results.filter((r) => r.cat === cat);
    if (!rows.length) return '';
    const [title, blurb] = CATS[cat];
    return `
    <section>
      <h2>${title}</h2>
      <p class="blurb">${blurb}</p>
      <table>
        <thead><tr><th>Severity</th><th>Element</th><th>Figma</th><th>Staging now</th><th>Status</th></tr></thead>
        <tbody>${rows.map(row).join('')}</tbody>
      </table>
    </section>`;
  };

  const defects = DEFECTS.map((d) => `
    <tr>
      <td><span class="sev sev-${d.sev}">${d.sev}</span></td>
      <td class="what">${esc(d.what)}<div class="note">${esc(d.detail)}</div></td>
      <td class="val">${esc(d.now)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Figma vs Sphere staging — design conformance</title>
<style>
  :root{
    --navy:#17283C; --navy-300:#2D3E54; --navy-100:#7E8A9A;
    --teal:#1E8F8E; --teal-600:#186E6E; --teal-50:#E3F7F6;
    --gold:#F0A500; --gold-50:#FEF6E0; --gold-700:#9A6800;
    --bg:#F6F7F9; --surface:#fff; --border:#D8DEE5; --mid:#7C8696; --ink:#0D1218;
    --ok:#15803D; --ok-bg:#DCFCE7; --warn:#B45309; --warn-bg:#FEF3C7; --err:#B91C1C; --err-bg:#FEE2E2;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font:400 16px/1.6 Inter,"Open Sans",system-ui,-apple-system,sans-serif}
  .wrap{max-width:1280px;margin:0 auto;padding:40px 24px 72px}
  header{border-bottom:3px solid var(--teal);padding-bottom:24px;margin-bottom:32px}
  h1{font:700 40px/1.2 Inter,"Open Sans",sans-serif;color:var(--navy);margin:0 0 8px}
  .meta{color:var(--mid);font-size:14px}
  .meta a{color:var(--teal-600)}
  .kpis{display:flex;gap:16px;flex-wrap:wrap;margin:28px 0 40px}
  .kpi{flex:1 1 160px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px}
  .kpi.lead{background:var(--gold-50);border-color:var(--gold)}
  .kpi b{display:block;font:700 32px/1.1 Inter,sans-serif;color:var(--navy)}
  .kpi span{font-size:13px;color:var(--mid)}
  h2{font:600 32px/1.3 Inter,"Open Sans",sans-serif;color:var(--navy);margin:48px 0 4px}
  .blurb{color:var(--mid);font-size:14px;margin:0 0 16px}
  table{width:100%;border-collapse:collapse;background:var(--surface);
        border:1px solid var(--border);border-radius:8px;overflow:hidden;font-size:14px}
  thead th{background:var(--navy);color:#fff;font-weight:600;text-align:left;padding:12px 16px;font-size:13px}
  td{padding:12px 16px;border-top:1px solid var(--border);vertical-align:top}
  tbody tr:nth-child(even){background:var(--bg)}
  .what{font-weight:600;min-width:220px}
  .note{font-weight:400;color:var(--mid);font-size:13px;margin-top:4px;max-width:52ch}
  .val{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:13px}
  .val.design{color:var(--teal-600)}
  .sev,.st{display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600;white-space:nowrap}
  .sev-high{background:var(--err-bg);color:var(--err)}
  .sev-medium{background:var(--warn-bg);color:var(--warn)}
  .sev-low{background:var(--teal-50);color:var(--teal-600)}
  .st-open{background:var(--err-bg);color:var(--err)}
  .st-fixed{background:var(--ok-bg);color:var(--ok)}
  .st-visual{background:var(--bg);color:var(--mid);border:1px solid var(--border)}
  .shots{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:16px}
  .shot{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px}
  .shot h3{margin:0 0 8px;font:600 16px Inter,sans-serif;color:var(--navy)}
  .shot img{width:100%;display:block;border:1px solid var(--border);border-radius:6px}
  .callout{background:var(--teal-50);border-left:4px solid var(--teal);padding:16px 20px;border-radius:0 6px 6px 0;margin:24px 0;font-size:14px}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--border);color:var(--mid);font-size:13px}
  @media (max-width:900px){.shots{grid-template-columns:1fr}}
</style></head><body><div class="wrap">

<header>
  <h1>Figma vs Sphere staging</h1>
  <div class="meta">
    Frame <b>Sphere Desktop design &rarr; Home non logged in</b> &middot;
    <a href="${FIGMA_URL}">open in Figma</a><br>
    Build: <a href="${esc(STAGING_URL)}">${esc(STAGING_URL)}</a>
    &middot; HTTP ${staging.status} &middot; measured at 1440px
    &middot; run ${esc(stamp.replace('T', ' '))}
  </div>
</header>

<div class="kpis">
  <div class="kpi lead"><b>${open}</b><span>differences still open</span></div>
  <div class="kpi"><b>${fixed}</b><span>now matching the design</span></div>
  <div class="kpi"><b>${visual}</b><span>need a visual check</span></div>
  <div class="kpi"><b>${DEFECTS.length}</b><span>defects, design aside</span></div>
</div>

<div class="callout">
  The Figma column is a fixed reading of the frame taken ${FIGMA_READ_ON} — the file is view-only over
  the public link, so its values are recorded rather than re-derived each run. The staging column is
  re-measured every run, so a row flips to <b>FIXED</b> on its own once the build catches up.
  Rows marked <b>VISUAL</b> cannot be auto-checked; compare the screenshots below.
</div>

${section('missing')}
${section('copy')}
${section('visual')}

<section>
  <h2>Defects, design aside</h2>
  <p class="blurb">Problems with the staging build that hold regardless of what the design says.</p>
  <table>
    <thead><tr><th>Severity</th><th>Problem</th><th>Staging now</th></tr></thead>
    <tbody>${defects}</tbody>
  </table>
</section>

<section>
  <h2>Side by side</h2>
  <p class="blurb">Design frame as rendered from Figma, and the live staging page at 1440px.</p>
  <div class="shots">
    <div class="shot"><h3>Figma — Home non logged in</h3>
      ${figma?.ok ? `<img src="figma-vs-staging/figma.png" alt="Figma frame">`
                  : `<p class="note">Not captured this run${figma?.error ? ` — ${esc(figma.error)}` : ' (--no-figma)'}.</p>`}
    </div>
    <div class="shot"><h3>Staging — /public/home</h3>
      <img src="figma-vs-staging/staging.png" alt="Staging home page">
    </div>
  </div>
</section>

<section>
  <h2>Content drift — not defects</h2>
  <p class="blurb">Expected divergence. The design is stale here, not the build.</p>
  <div class="callout">
    The frame is dated <b>@2022</b> and carries placeholder counts (80000+ learners, 200+ courses,
    2200+ certificates) against staging's live 310,000+ / 490+ / 57.5 / 400,000+. Card imagery,
    course titles, ratings and provider chips are live data versus design placeholders. None of this
    should be "fixed" toward the design.
  </div>
</section>

<footer>
  Generated by <code>scripts/figma-vs-staging.mjs</code> &middot;
  re-run with <code>npm run compare:figma</code>
</footer>

</div></body></html>`;
}

// ── main ──────────────────────────────────────────────────────────────────
console.log(`Staging : ${STAGING_URL}`);
console.log(`Figma   : ${FIGMA_URL}`);

const browser = await chromium.launch();
let staging;
try {
  process.stdout.write('capturing staging... ');
  staging = await captureStaging(browser);
  console.log(`HTTP ${staging.status}, ${staging.headingCount} headings, ${staging.consoleErrors.length} console errors`);
} finally {
  await browser.close();
}

let figma = null;
if (has('--no-figma')) {
  console.log('skipping Figma capture (--no-figma)');
} else {
  process.stdout.write('capturing Figma frame (~45s)... ');
  figma = await captureFigma();
  console.log(figma.ok ? `ok at ${figma.zoom}% zoom` : `FAILED: ${figma.error}`);
}

const results = FINDINGS.map((f) => {
  const now = f.check ? String(f.check(staging)) : '(visual check)';
  // Case-sensitive on purpose: for several findings the casing IS the difference.
  const status = !f.check ? 'VISUAL'
    : now.trim() === String(f.design).trim() ? 'FIXED' : 'OPEN';
  return { ...f, now, status };
});
for (const d of DEFECTS) d.now = d.check(staging);

const html = renderReport(results, staging, figma);
const file = join(OUT_DIR, `figma-vs-staging-${stamp}.html`);
writeFileSync(file, html);
copyFileSync(file, join(OUT_DIR, 'figma-vs-staging-latest.html'));

const open = results.filter((r) => r.status === 'OPEN').length;
const fixed = results.filter((r) => r.status === 'FIXED').length;
const vis = results.filter((r) => r.status === 'VISUAL').length;
console.log(`\n${open} open · ${fixed} fixed · ${vis} visual · ${DEFECTS.length} defects`);
console.log(`report: ${file}`);

if (has('--open')) execFile('cmd', ['/c', 'start', '', file], () => {});
process.exit(open > 0 ? 1 : 0);
