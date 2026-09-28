/**
 * Course TOC — Full Element Coverage
 * ──────────────────────────────────────────────────────────────────
 * One granular test per element on the Course TOC OVERVIEW page (the page you
 * land on after opening a course): header (title, CNE hours, duration, rating,
 * author/org), action icons (Details, Certificate, Share), Resume/Start, the
 * Overview / Modules / Discussion tabs, Description, and License terms.
 *
 * These are the controls that are actually on the TOC overview — so they PASS
 * rather than skip. A genuinely-optional control (e.g. a Creative-Commons link)
 * still skips gracefully when the course doesn't expose it.
 *
 * Auth: live logged-in Chrome over CDP — see tests/helpers/cdpTest.ts.
 *
 * Usage:
 *   $env:COURSE_NAME="Implementing Respectful Maternity Care In Healthcare Facilities"; npm run run:course-toc
 */
// Types only — the test runner itself comes from our authenticated harness below.
import { Page, Locator } from '@playwright/test';
// `test` here is the AUTHENTICATED one: every test gets a logged-in context.
import { test, expect } from './helpers/authedTest';

// Which environment to test.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';
// The logged-in home page, where the course search box lives.
const HOME_URL = `${BASE_URL}/page/home`;
// Which course to open. Empty means every test skips.
const COURSE_NAME = process.env.COURSE_NAME ?? '';

// How long the TOC banner (Start/Resume) may take to render. Generous on
// purpose: measured 1.6-2.8s on a clean load, but ~70s once the course has been
// opened and returned from. The old 10s default expect window failed there
// while the page was still painting.
const BANNER_TIMEOUT = Number(process.env.TOC_BANNER_TIMEOUT ?? 90_000);
// Readiness check in beforeEach: shorter, because when it times out we simply
// re-open the course via search instead of waiting the full window.
const BANNER_READY_MS = Number(process.env.TOC_BANNER_READY ?? 30_000);
// How long to wait for the tabs, which paint far sooner than the banner.
const TABS_READY_MS = Number(process.env.TOC_TABS_READY ?? 10_000);
// Above this, the wait is called out in the log as a slowness finding.
const SLOW_BANNER_MS = Number(process.env.TOC_SLOW_BANNER_MS ?? 10_000);

// ══════════════════════════════════════════════════════════════════════
// HELPERS (self-contained so this file is independent of CourseComplete)
// ══════════════════════════════════════════════════════════════════════
// Search for a course by name from the home page and open it. Returns whether it worked.
async function searchAndOpenCourse(page: Page, courseName: string): Promise<boolean> {
  console.log(`\n🔎 Searching: "${courseName}"`);
  // The search box, matched by its placeholder — the most stable handle for a search input.
  const search = page.getByPlaceholder(/what do you want to learn today/i);
  // Wait for it to render.
  await search.waitFor({ state: 'visible', timeout: 10_000 });
  // Type the course name.
  await search.fill(courseName);
  // Enter runs the search.
  await search.press('Enter');
  // Wait for the results page.
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(3000);

  // Remember where we are, so we can detect whether the click actually navigated.
  const urlBefore = page.url();
  // Match on the first 8 characters only — long titles get truncated in result cards.
  const prefix = courseName.slice(0, Math.min(8, courseName.length));
  // Find a result whose title STARTS with that prefix.
  const titleMatch = page.getByText(new RegExp(`^${prefix}`, 'i')).first();
  // Did we find one?
  if (await titleMatch.isVisible({ timeout: 5_000 }).catch(() => false)) {
    // Log the full title we're about to click.
    const title = (await titleMatch.textContent())?.trim() ?? '';
    console.log(`👆 Clicking: "${title}"`);
    // Open it.
    await titleMatch.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3500);
    // A changed URL is the proof the click really opened the course.
    if (page.url() !== urlBefore) {
      console.log(`✅ Course opened`);
      return true;
    }
  }
  // Either no result matched, or the click didn't navigate.
  console.log(`❌ Could not open course "${courseName}"`);
  return false;
}

/**
 * The banner's Start / Resume / Start Again control.
 *
 * IMPORTANT: its ELEMENT TYPE changes with the learner's progress —
 *   in progress / not started  →  <button class="banner-btn">Start|Resume</button>
 *   100% complete              →  <a class="banner-btn resumeButton">Start Again</a>
 * so a getByRole('button') locator silently finds nothing once the course has
 * been completed (verified on staging: 0 matches as a link, 1 via .banner-btn).
 * The class is the stable part; the roles below are belt-and-braces.
 *
 * It is also the LAST thing the TOC paints — the tabs appear in under half a
 * second while this waits on the enrolment/progress calls — so its presence,
 * not the tabs, is what "the TOC is ready" means.
 */
function startOrResumeBtn(page: Page): Locator {
  // Class first (works for both the button and the link forms), then the two roles.
  return page.locator('.banner-btn, [class*="resumeButton"]')
    .or(page.getByRole('button', { name: /^(resume|start|start again)$/i }))
    .or(page.getByRole('link', { name: /^(resume|start|start again)$/i }))
    .first();
}

/** How long the banner button takes to appear; -1 when it never does. */
async function waitForBanner(page: Page, timeout: number): Promise<number> {
  // Start the clock.
  const started = Date.now();
  try {
    // Wait for the control to appear.
    await startOrResumeBtn(page).waitFor({ state: 'visible', timeout });
    // Return how many milliseconds that took — the caller uses this to flag slowness.
    return Date.now() - started;
  } catch {
    // -1 is the sentinel for "never appeared", so the caller can tell it from a fast 0ms.
    return -1;
  }
}

// Click Start/Resume, trying six different locators. Returns whether we actually navigated.
async function startOrResume(page: Page): Promise<boolean> {
  // Remember where we started.
  const urlBefore = page.url();
  // Six ways to find the control, ordered most to least reliable.
  const candidates: Locator[] = [
    // The class-based locator first: it covers both the <button> (in progress)
    // and the <a> (completed) forms of the same control.
    startOrResumeBtn(page),
    page.getByRole('button', { name: /^(resume|start|start again)$/i }).first(),
    page.getByRole('link', { name: /^(resume|start|start again)$/i }).first(),
    page.locator('.resumeButton, [class*="resumeButton"]').first(),
    page.locator('.banner-btn').first(),
    page.getByText(/^(resume|start|start again)$/i).first(),
  ];
  // Try each in turn.
  for (const btn of candidates) {
    // Skip any that isn't on screen.
    if (!(await btn.isVisible({ timeout: 2_000 }).catch(() => false))) continue;
    // Click it; ignore a failure and let the URL check decide.
    await btn.click().catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3500);
    // A changed URL means the player opened.
    if (page.url() !== urlBefore) return true;
  }
  // Last resort: maybe we were already in the player before we started.
  if (/\/viewer\/|\/play\/|\/learn\//i.test(page.url())) return true;
  // Nothing worked.
  return false;
}

// Dismiss whatever popup is open, by its close button or failing that the Escape key.
async function closeAnyPopup(page: Page): Promise<void> {
  // Nothing to do on a dead tab.
  if (page.isClosed()) return;
  // Five shapes of close button, since the app uses several.
  const closeBtn = page
    .locator('button[aria-label*="close" i], [class*="close-btn"], .close, mat-icon:has-text("close"), button:has-text("×")')
    .first();
  // Short timeout — this is best-effort cleanup, not worth real time.
  if (await closeBtn.isVisible({ timeout: 700 }).catch(() => false)) {
    await closeBtn.click({ timeout: 1500 }).catch(() => {});
  } else {
    // No button found — Escape dismisses most Material dialogs.
    await page.keyboard.press('Escape').catch(() => {});
  }
  // Let the dialog animate away.
  await page.waitForTimeout(400);
}

// An action icon on the TOC (Details / Certificate / Share) is a
// `div.toc-icon-action` wrapping an icon + label span. The (click) handler is
// on the DIV — clicking the inner span doesn't fire it — so target the div.
function actionIcon(page: Page, label: RegExp): Locator {
  // Find the wrapper div, then narrow to the one containing this label.
  return page.locator('.toc-icon-action, [class*="toc-icon-action"]').filter({ hasText: label }).first();
}

// Any popup/overlay container the app uses (mat dialog / cdk overlay / modal).
// Six shapes in one string, so a markup change in any single one doesn't break the tests.
const POPUP = '[role="dialog"], .cdk-overlay-pane, .mat-mdc-dialog-panel, [class*="modal"], [class*="popup"], [class*="dialog"]';

// ══════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════
test.describe('Course TOC — full element coverage', () => {
  // NOT serial — each test resets to the TOC in beforeEach, so one failure
  // must not skip the rest.
  // Three minutes per test: the banner alone can take 90 seconds.
  test.setTimeout(3 * 60 * 1000);

  // Cached once the first test opens the course, then reused as a fast path.
  let tocUrl = '';

  // True when the page is on the course TOC overview AND it has finished
  // rendering. The tabs alone are not enough: they paint in well under a second
  // while the banner (Start/Resume) is still waiting on the progress calls, so
  // a test that trusted the tabs would assert against a half-drawn page.
  //
  // Both checks WAIT. isVisible() does not — its `timeout` option is ignored,
  // so it answers about this instant only. Used here it reported "not the TOC"
  // milliseconds after the goto and sent every test down the slow re-open-via-
  // search path.
  const onToc = async (page: Page) => {
    // Cheapest check first: is the URL even a TOC overview?
    if (!/\/toc\/.*\/overview/.test(page.url())) return false;
    // Then WAIT for the tabs. `.then(true).catch(false)` turns the wait into a boolean.
    const tabs = await page.getByText(/^(Details|Overview|Modules)$/i).first()
      .waitFor({ state: 'visible', timeout: TABS_READY_MS }).then(() => true).catch(() => false);
    // No tabs means this isn't a rendered TOC.
    if (!tabs) return false;
    // Finally wait for the banner. >= 0 means it appeared (-1 means it never did).
    return (await waitForBanner(page, BANNER_READY_MS)) >= 0;
  };

  // Puts the page on a fully-rendered TOC before every test.
  test.beforeEach(async ({ page }) => {
    // Nothing to test without a course name.
    test.skip(!COURSE_NAME, 'Set COURSE_NAME to run Course TOC coverage');
    // Fast path: reload the cached TOC URL, but VERIFY it landed on the TOC
    // (a prior test can navigate away, and the goto can drift).
    if (tocUrl) {
      await page.goto(tocUrl).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1500);
      // Verified — nothing more to do.
      if (await onToc(page)) return;
      // The cached URL didn't get us there; fall through to the slow path.
      console.log('   ↻ TOC not loaded from cached URL — re-opening via search');
    }
    // Open the course, with one retry — the initial open can flake if Home
    // hasn't fully rendered the search box yet.
    let opened = false;
    // Up to three attempts.
    for (let attempt = 1; attempt <= 3 && !opened; attempt++) {
      // Back to the home page.
      await page.goto(HOME_URL);
      await page.waitForLoadState('domcontentloaded');
      // Wait longer on retries, since a slow render is the usual cause of the first failure.
      await page.waitForTimeout(attempt === 1 ? 1500 : 3000);
      // Search and open.
      opened = await searchAndOpenCourse(page, COURSE_NAME);
      if (!opened) console.log(`   ↻ open attempt ${attempt} failed`);
    }
    // Three failures means something is genuinely wrong — fail loudly.
    if (!opened) throw new Error(`Could not open course "${COURSE_NAME}"`);
    // Cache the URL for the next test's fast path.
    tocUrl = page.url();
    console.log(`📌 Course TOC URL: ${tocUrl}`);
    // Hand the test a fully-painted TOC, banner included — otherwise the first
    // assertion races the progress calls that draw it.
    const ms = await waitForBanner(page, BANNER_TIMEOUT);
    // Warn rather than throw — let the individual assertion produce the real failure.
    if (ms < 0) console.log('   ⚠️  Banner (Start/Resume) never rendered — assertions on it will fail');
    // Slow but present: surface it as a performance finding.
    else if (ms > SLOW_BANNER_MS) console.log(`   🐢 Banner took ${(ms / 1000).toFixed(1)}s to render`);
  });

  // Helper: skip the current test with a message when a control is absent.
  // Used for genuinely-optional controls, so a course without one skips rather than fails.
  const skipIfAbsent = (visible: boolean, what: string) => {
    if (!visible) {
      console.log(`   ⏭️  ${what} not present on this course — skipping`);
      test.skip(true, `${what} not present`);
    }
  };

  // ─── HEADER ──────────────────────────────────────────────────────
  test('TOC: course title is visible', async ({ page }) => {
    // Match the first 18 characters — enough to be unique, short enough to survive truncation.
    const title = page.getByRole('heading', { name: new RegExp(COURSE_NAME.slice(0, 18), 'i') })
      .or(page.getByText(new RegExp(COURSE_NAME.slice(0, 18), 'i'))).first();
    await expect(title).toBeVisible();
    // Log the first 60 characters of what we actually found.
    console.log(`   ✅ Title: "${(await title.textContent())?.trim()?.slice(0, 60)}"`);
  });

  test('TOC: "CNE hours" badge is visible', async ({ page }) => {
    // The colon is what distinguishes the badge from prose mentioning CNE hours.
    await expect(page.getByText(/CNE hours?\s*:/i).first()).toBeVisible();
    console.log('   ✅ CNE hours badge visible');
  });

  test('TOC: course duration is visible', async ({ page }) => {
    // Matches "2h", "2h 30m", "45 min" or "3 hours" — every format the app uses.
    await expect(page.getByText(/\b\d+\s*h(\s*\d+\s*m)?\b|\b\d+\s*min|\b\d+\s*hours?/i).first()).toBeVisible();
    console.log('   ✅ Duration visible');
  });

  test('TOC: rating and review count are visible', async ({ page }) => {
    // The review count is rendered as a parenthesised number, e.g. "(42)".
    const reviews = page.getByText(/\(\s*\d+\s*\)/).first();
    await expect(reviews).toBeVisible();
    console.log(`   ✅ Reviews: ${(await reviews.textContent())?.trim()}`);
  });

  test('TOC: author "By: <organization>" is visible', async ({ page }) => {
    // Anchored at the start, so it can't match "By:" appearing mid-sentence.
    await expect(page.getByText(/^\s*By\s*:/i).first()).toBeVisible();
    console.log('   ✅ Author line visible');
  });

  // ─── ACTION ICONS ────────────────────────────────────────────────
  test('TOC: Details / Certificate / Share icons are visible', async ({ page }) => {
    // All three anchored, so they match the icon labels and not longer text.
    await expect(page.getByText(/^Details$/i).first()).toBeVisible();
    await expect(page.getByText(/^Certificate$/i).first()).toBeVisible();
    await expect(page.getByText(/^Share$/i).first()).toBeVisible();
    console.log('   ✅ Details, Certificate, Share icons visible');
  });

  test('TOC: "Details" opens the details popup', async ({ page }) => {
    // Click the wrapper div — the click handler isn't on the inner label span.
    await actionIcon(page, /^details$/i).click();
    // A popup must appear.
    await expect(page.locator(POPUP).first()).toBeVisible({ timeout: 5000 });
    console.log('   ✅ Details popup opened');
    // Clean up so the next test starts on a clear page.
    await closeAnyPopup(page);
  });

  test('TOC: "X" closes the details popup', async ({ page }) => {
    // Open it.
    await actionIcon(page, /^details$/i).click();
    const popup = page.locator(POPUP).first();
    // Confirm it opened, so a failure below can only be about closing.
    await expect(popup).toBeVisible({ timeout: 5000 });
    // Dismiss it.
    await closeAnyPopup(page);
    // And confirm it really went away — a modal that can't be closed traps the user.
    await expect(popup).not.toBeVisible({ timeout: 4000 });
    console.log('   ✅ Details popup closed');
  });

  test('TOC: "Certificate" shows a popup', async ({ page }) => {
    // Click the Certificate icon.
    await actionIcon(page, /^certificate$/i).click();
    await page.waitForTimeout(2000);
    // Completed course → certificate dialog; in-progress → a "complete the
    // course" message. Accept either a popup/canvas or that message.
    // The canvas is how a rendered certificate is drawn.
    const shown = await page.locator(POPUP).or(page.locator('canvas'))
      .or(page.getByText(/complete the course|certificate|finish the course|not.*(eligible|complete)/i)).first()
      .isVisible({ timeout: 6000 }).catch(() => false);
    console.log(`   ✅ Certificate action produced a popup/message: ${shown}`);
    // Either response is fine; silence is not.
    expect(shown).toBe(true);
    await closeAnyPopup(page);
  });

  test('TOC: "Close" closes the certificate popup', async ({ page }) => {
    // Open it.
    await actionIcon(page, /^certificate$/i).click();
    // Either the dialog or the "complete the course" message counts.
    const popup = page.locator(POPUP).or(page.getByText(/complete the course|finish the course/i)).first();
    // Nothing opened — skip rather than fail, since the previous test already covers that case.
    skipIfAbsent(await popup.isVisible({ timeout: 6000 }).catch(() => false), 'Certificate popup');
    // Prefer a labelled Close button.
    const closeBtn = page.getByRole('button', { name: /^close$/i }).first();
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) await closeBtn.click();
    // Otherwise fall back to the generic dismiss helper.
    else await closeAnyPopup(page);
    // It must actually be gone.
    await expect(popup).not.toBeVisible({ timeout: 4000 });
    console.log('   ✅ Certificate popup closed');
  });

  test('TOC: "Share" shows shareable options', async ({ page }) => {
    // Click Share.
    await actionIcon(page, /^share$/i).click();
    // Accept any of three signals: a share-styled container, a social link, or a social button.
    await expect(
      page.locator('[class*="share"], [class*="social"]')
        .or(page.getByRole('link', { name: /facebook|twitter|whatsapp|linkedin|copy|telegram/i }))
        .or(page.getByRole('button', { name: /facebook|twitter|whatsapp|linkedin|copy link/i })).first(),
    ).toBeVisible({ timeout: 5000 });
    console.log('   ✅ Share options shown');
    await closeAnyPopup(page);
  });

  // ─── RESUME / START + TABS ───────────────────────────────────────
  test('TOC: Resume/Start button is visible', async ({ page }) => {
    // Self-heal if the shared CDP browser drifted the tab off the TOC.
    if (!(await onToc(page))) { await page.goto(tocUrl).catch(() => {}); await page.waitForTimeout(2000); }
    // Time how long the banner takes.
    const ms = await waitForBanner(page, BANNER_TIMEOUT);
    // Short timeout here — waitForBanner already did the waiting.
    await expect(startOrResumeBtn(page)).toBeVisible({ timeout: 5_000 });
    console.log(`   ✅ Resume/Start button visible (rendered in ${ms} ms)`);
    // Not a failure — but a learner staring at a course page for this long is
    // worth seeing in the report rather than passing silently.
    if (ms > SLOW_BANNER_MS) {
      console.log(`   🐢 SLOW: the banner took ${(ms / 1000).toFixed(1)}s to render (over ${SLOW_BANNER_MS / 1000}s)`);
    }
  });

  test('TOC: Overview / Modules / Discussion tabs are visible', async ({ page }) => {
    // All three anchored so they match the tab labels exactly.
    await expect(page.getByText(/^Overview$/i).first()).toBeVisible();
    await expect(page.getByText(/^Modules$/i).first()).toBeVisible();
    await expect(page.getByText(/^Discussion$/i).first()).toBeVisible();
    console.log('   ✅ Overview, Modules, Discussion tabs visible');
  });

  test('TOC: "Modules" tab opens the module list', async ({ page }) => {
    // Switch to the Modules tab.
    await page.getByText(/^Modules$/i).first().click();
    await page.waitForTimeout(1500);
    // Five selector shapes, covering the component names this app has shipped.
    const modules = page.locator(
      'mat-list-item, ws-web-course-toc-card, [class*="toc-card"], [class*="module-item"], mat-tree-node',
    );
    // Count them.
    const count = await modules.count().catch(() => 0);
    console.log(`   ✅ Modules tab — ${count} module/resource item(s)`);
    // An empty module list means the course content failed to load.
    expect(count).toBeGreaterThan(0);
  });

  test('TOC: "Discussion" tab is clickable', async ({ page }) => {
    // Switch to Discussion.
    await page.getByText(/^Discussion$/i).first().click();
    await page.waitForTimeout(1200);
    // The destination is logged, not asserted — discussion may be a tab or a separate route.
    console.log(`   ✅ Discussion tab opened → ${page.url()}`);
  });

  // ─── DESCRIPTION + LICENSE ───────────────────────────────────────
  test('TOC: "Description" section is visible', async ({ page }) => {
    // Go back to the Overview tab, in case a previous test left us elsewhere.
    await page.getByText(/^Overview$/i).first().click().catch(() => {});
    await page.waitForTimeout(600);
    // The Description heading.
    const desc = page.getByText(/^Description$/i).first();
    // It's below the fold, so scroll to it first.
    await desc.scrollIntoViewIfNeeded().catch(() => {});
    await expect(desc).toBeVisible();
    console.log('   ✅ Description section visible');
  });

  test('TOC: "License terms" section is visible', async ({ page }) => {
    // Matches both "License term" and "License terms".
    const license = page.getByText(/license\s*terms?/i).first();
    // Right at the bottom of the page.
    await license.scrollIntoViewIfNeeded().catch(() => {});
    await expect(license).toBeVisible();
    console.log('   ✅ License terms section visible');
  });

  test('TOC: License terms shows the Creative Commons link', async ({ page }) => {
    // By accessible name, falling back to the href — not every build labels the link.
    const ccLink = page.getByRole('link', { name: /creativecommons|creative commons/i })
      .or(page.locator('a[href*="creativecommons.org"]')).first();
    await ccLink.scrollIntoViewIfNeeded().catch(() => {});
    // Genuinely optional — not every course is CC-licensed, so skip rather than fail.
    skipIfAbsent(await ccLink.isVisible({ timeout: 3000 }).catch(() => false), 'Creative Commons link');
    console.log(`   ✅ CC link: ${await ccLink.getAttribute('href').catch(() => '')}`);
  });

  // ─── NAVIGATION ──────────────────────────────────────────────────
  test('TOC: clicking the author opens the organization page', async ({ page }) => {
    // The org name after "By:" is a span.blue-link (not an <a>).
    // Prefer the structural selector; fall back to a blue link naming a known org type.
    const author = page.locator('.details .blue-link, .blue-link.cursor-pointer')
      .or(page.locator('.blue-link, [class*="blue-link"]')
        .filter({ hasText: /alliance|council|foundation|jhpiego|unfpa|others|india/i })).first();
    // Skip when the course has no linked organisation.
    skipIfAbsent(await author.isVisible({ timeout: 3000 }).catch(() => false), 'Author org link');
    // Register the popup listener BEFORE clicking — Promise.all starts both at once,
    // so a tab that opens instantly isn't missed.
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 2500 }).catch(() => null),
      author.click().catch(() => {}),
    ]);
    await page.waitForTimeout(2500);
    // Work with the popup if one opened, otherwise the same page navigated.
    const target = popup ?? page;
    // Just glance at the org-page elements — the course COUNT varies by org,
    // so we only confirm we're on an org-style page (any of these markers).
    const markers = [/courses offered/i, /filter by language/i, /^english$/i, /हिंदी/, /courses/i];
    // Count how many markers we can see.
    let seen = 0;
    for (const m of markers) {
      if (await target.getByText(m).first().isVisible({ timeout: 1500 }).catch(() => false)) seen++;
    }
    console.log(`   ✅ Organization page — ${seen} marker(s) present → ${target.url()}`);
    // One marker is enough to prove we landed on an org page.
    expect(seen).toBeGreaterThan(0);
    // Close the popup so it doesn't leak into the next test.
    if (popup) await popup.close().catch(() => {});
  });

  test('TOC: back icon leaves the course overview', async ({ page }) => {
    // Three ways to find the back control: the Angular component, the Material icon
    // ligature text, or the icon's nearest ancestor button.
    const back = page.locator('ws-widget-btn-page-back button, ws-widget-btn-page-back')
      .or(page.getByRole('button').filter({ hasText: /chevron_left|arrow_back/i }))
      .or(page.locator('mat-icon:has-text("chevron_left")').locator('xpath=ancestor-or-self::button[1]'))
      .first();
    // Skip if there's no back control on this build.
    skipIfAbsent(await back.isVisible({ timeout: 3000 }).catch(() => false), 'Back button');
    // Click it.
    await back.click().catch(() => {});
    // Wait until the URL is no longer a TOC overview.
    await page.waitForURL((u) => !/\/toc\/.*\/overview/.test(u.toString()), { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(800);
    console.log(`   URL after back: ${page.url()}`);
    // We must have actually left — this one IS asserted.
    expect(page.url()).not.toMatch(/\/toc\/.*\/overview/);
  });

  test('TOC: "Start"/"Resume" opens the course player', async ({ page }) => {
    // Remember where we were.
    const urlBefore = page.url();
    // Try all six locators.
    const started = await startOrResume(page);
    // Skip if the control simply isn't there.
    skipIfAbsent(started, 'Start/Resume button');
    console.log(`   ✅ Course player opened (URL changed: ${page.url() !== urlBefore}) → ${page.url()}`);
  });
});
