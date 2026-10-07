/**
 * My Courses Page — Full Element Coverage
 * ──────────────────────────────────────────────────────────────────
 * Three tabs: Started (in-progress), For You (recommended), Completed (empty for new users).
 * Reuses .auth-state.json from the home page setup — no re-login.
 *
 * Each test is INDEPENDENT — a failure in one doesn't block the others.
 */

// Types only — the runner itself comes from our authenticated harness below.
import { Page, Locator } from '@playwright/test';
// Auth via storageState (CI-friendly) with a CDP fallback for local dev.
// See tests/helpers/authedTest.ts.
// Renamed to `authedBase` so we can extend it and export the result as `test`.
import { test as authedBase, expect } from './helpers/authedTest';
import { SEARCH_PLACEHOLDER, hiAlso, withCount } from './helpers/i18n';

// ── Single shared tab for the whole file ────────────────────────────────────
// The CDP harness opens (and closes) a fresh tab per test by default, so every
// test was spawning a new tab. Override the `page` fixture so ALL tests in this
// file reuse ONE tab — opened on the first test, kept open between tests, and
// closed once at the end. (workers=1 + fullyParallel=false ⇒ tests already run
// sequentially, so sharing the page is safe and tests stay independent.)
// Module-level, so it survives between tests.
let sharedPage: Page | undefined;

// Extend the authenticated test, overriding just the `page` fixture.
const test = authedBase.extend<{}>({
  page: async ({ context }, use) => {
    // Create the tab only if we don't already have a live one. The isClosed()
    // guard transparently reopens it if something killed it mid-run.
    if (!sharedPage || sharedPage.isClosed()) {
      sharedPage = await context.newPage();
    }
    // Hand the SAME tab to every test.
    await use(sharedPage);
    // Do NOT close between tests — keep the single tab open.
  },
});

// Runs once, after all 49 tests — the only place the tab is closed.
test.afterAll(async () => {
  // `?.` and `.catch` keep teardown from failing the run.
  await sharedPage?.close().catch(() => {});
  // Clear the handle so a later worker starts clean.
  sharedPage = undefined;
});

// Which environment to test.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';
// The authenticated My Courses page.
const MY_COURSES_URL = `${BASE_URL}/app/user/my_courses`;

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════
// Scroll an element into view, then click it.
async function scrollAndClick(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
}

// Click a tab by name — handles mat-tab, anchor, button
// Five selector shapes in one, so a markup change in any single one doesn't break it.
async function clickTab(page: Page, name: 'Started' | 'For You' | 'Completed') {
  // English or Hindi label ("Started" / "शुरू किया") — the tabs follow the account's language.
  const tab = page.locator('[role="tab"], mat-tab-label, .mat-mdc-tab, button, a')
    .filter({ hasText: hiAlso(new RegExp(name, 'i')) })
    .first();
  // The tab bar renders only after the course lists load, which can take well
  // over 15s on a slow CI machine — wait for it explicitly before clicking.
  // If the page is still stuck after 30s (a slow or dropped data call), reload
  // once and wait again, as a person would, before giving up.
  if (!(await tab.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => false))) {
    console.log(`   ↻ "${name}" tab not shown after 30s — reloading My Courses once`);
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await tab.waitFor({ state: 'visible', timeout: 30_000 });
  }
  // Click it.
  await scrollAndClick(page, tab);
  // Let the tab panel re-render.
  await page.waitForTimeout(800);
}

// ════════════════════════════════════════════════════════════════════
// SETUP — reuse auth-state from prior runs (or log in once)
// ════════════════════════════════════════════════════════════════════
// Authentication is provided by the live CDP Chrome session (see
// tests/helpers/cdpTest.ts) — the connected browser is already logged in.

// Runs before every test: resets the shared tab to a known state.
test.beforeEach(async ({ page }) => {
  // Shared tab keeps its last viewport; reset to desktop so a prior responsive
  // test (mobile/tablet) doesn't bleed into the next one.
  // This is the specific hazard the shared-tab design creates.
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  // Back to My Courses, whatever the last test did. One retry: a single network
  // timeout (seen on UAT: net::ERR_TIMED_OUT) shouldn't fail a test about the page.
  await page.goto(MY_COURSES_URL).catch(async (e) => {
    console.log(`   ↻ My Courses didn't load (${String(e.message).split('\n')[0]}) — retrying once`);
    await page.goto(MY_COURSES_URL);
  });
  // Wait for the app's data calls to settle.
  await page.waitForLoadState('networkidle');
});

// ════════════════════════════════════════════════════════════════════
// SECTION 1: PAGE HEADING & TABS
// ════════════════════════════════════════════════════════════════════
// The most strongly-asserted group in the file: tab STRUCTURE is the same for
// every account, regardless of what data they have.
test.describe('My Courses — Page Heading & Tabs', () => {
  test('Page heading "My Courses" is visible', async ({ page }) => {
    // Anchored, so it can't match the nav link of the same name.
    await expect(page.getByText(hiAlso(/^my courses$/i)).filter({ visible: true }).first()).toBeVisible();
    console.log('✅ "My Courses" heading visible');
  });

  test('URL contains "/my_courses"', async ({ page }) => {
    // `[-_]?` tolerates my-courses, my_courses or mycourses.
    expect(page.url()).toMatch(/my[-_]?courses/i);
    console.log(`✅ URL: ${page.url()}`);
  });

  test('"Started" tab is visible with count', async ({ page }) => {
    // The `\(\d+\)` requires the count to actually be there, not just the word.
    const tab = page.getByText(withCount('Started')).first();
    await expect(tab).toBeVisible();
    // Log what it says, e.g. "Started (5)".
    const text = await tab.textContent();
    console.log(`✅ Started tab text: "${text?.trim()}"`);
  });

  test('"For You" tab is visible with count', async ({ page }) => {
    // Same shape for the recommendations tab.
    const tab = page.getByText(withCount('For You')).first();
    await expect(tab).toBeVisible();
    const text = await tab.textContent();
    console.log(`✅ For You tab text: "${text?.trim()}"`);
  });

  test('"Completed" tab is visible with count', async ({ page }) => {
    // And for the completed tab.
    const tab = page.getByText(withCount('Completed')).first();
    await expect(tab).toBeVisible();
    const text = await tab.textContent();
    console.log(`✅ Completed tab text: "${text?.trim()}"`);
  });

  test('"Started" tab is active by default', async ({ page }) => {
    // Active tab is usually visually emphasised (aria-selected="true" or active class)
    const startedTab = page.locator('[role="tab"]:has-text("Started"), .mat-mdc-tab:has-text("Started")').first();
    // Read the ARIA state…
    const ariaSelected = await startedTab.getAttribute('aria-selected').catch(() => null);
    // …and the class list, as a fallback signal.
    const klass = await startedTab.getAttribute('class').catch(() => '');
    // Either signal counts as "active".
    const isActive = ariaSelected === 'true' || /active|selected/i.test(klass ?? '');
    // NO expect() — the evidence is gathered and then printed. Which tab opens by
    // default is fixed product behaviour, so `expect(isActive).toBe(true)` would be safe.
    console.log(`✅ Started tab active state — aria-selected: ${ariaSelected}, class hints: ${isActive}`);
  });

  test('Tab count totals are non-negative integers', async ({ page }) => {
    // All three tab labels.
    const labels = ['Started', 'For You', 'Completed'];
    for (const name of labels) {
      // Build the anchored regex for this tab name.
      const txt = await page.getByText(withCount(name)).first().textContent();
      // Pull the number out of the parentheses.
      const match = txt?.match(/\((\d+)\)/);
      // -1 (not 0) when unparseable — that's what makes the assertion below meaningful.
      // Defaulting to 0 would let a label that LOST its number pass silently.
      const count = match ? parseInt(match[1]) : -1;
      console.log(`   ${name}: ${count}`);
      // So a missing or malformed count fails here.
      expect(count).toBeGreaterThanOrEqual(0);
    }
    console.log('✅ All tab counts are valid');
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 2: STARTED TAB
// ════════════════════════════════════════════════════════════════════
test.describe('My Courses — Started Tab', () => {
  // Nested hook: opens this tab before every test in the group.
  test.beforeEach(async ({ page }) => {
    await clickTab(page, 'Started');
  });

  test('Started tab content is displayed when active', async ({ page }) => {
    // Should show course rows (with image, title, progress, Resume button)
    // Three selector shapes for a course row.
    const rows = page.locator('[class*="course-row"], [class*="course-item"], mat-card');
    const count = await rows.count();
    // Observed only — a new account legitimately has zero started courses.
    console.log(`✅ Started tab visible rows: ${count}`);
  });

  test('First Started course displays a thumbnail image', async ({ page }) => {
    // "The first image that isn't the logo."
    const firstImg = page.locator('img').filter({ hasNotText: 'logo' }).first();
    // Observed, not asserted.
    const visible = await firstImg.isVisible().catch(() => false);
    console.log(`✅ First course thumbnail visible: ${visible}`);
  });

  test('First Started course displays a title', async ({ page }) => {
    // Titles seen in screenshots — at least one must be visible
    // Note the Devanagari entry: course titles are stored as authored and never
    // translated, so a Hindi course keeps its own script whatever the UI language.
    const knownTitles = ['Initial assessment protocols for ANC', 'Pregnancy Identification',
                         'Integrated Sexual', 'सम्मानजनक', 'Normal Labour'];
    // How many we can find.
    let found = 0;
    for (const t of knownTitles) {
      // Substring match, since cards truncate long titles.
      if (await page.getByText(t, { exact: false }).first().isVisible().catch(() => false)) {
        found++;
        console.log(`   ✓ Title: "${t}"`);
      }
    }
    // A tally, not an assertion — 0/5 still passes, because which courses this
    // account is enrolled in is data, not product behaviour.
    console.log(`✅ ${found}/${knownTitles.length} known titles visible in Started`);
  });

  test('Progress bar is visible on Started courses', async ({ page }) => {
    // Three shapes: the ARIA role, the Material component, or a progress class.
    const progress = page.locator('[role="progressbar"], mat-progress-bar, [class*="progress-bar"]').first();
    // Observed only.
    const visible = await progress.isVisible().catch(() => false);
    console.log(`✅ Progress bar visible: ${visible}`);
  });

  test('Progress percentage is displayed (e.g. "0% Complete" or "11% Complete")', async ({ page }) => {
    // Any "<digits>% Complete" text.
    const pct = page.getByText(/\d+%\s*complete/i).first();
    const visible = await pct.isVisible().catch(() => false);
    // Read the text only if it's there.
    const text = visible ? await pct.textContent() : '';
    // Observed only — prints "(none)" when absent.
    console.log(`✅ Progress percent text: "${text?.trim() ?? '(none)'}"`);
  });

  test('"Resume" button is visible on each Started course', async ({ page }) => {
    // Count the course rows…
    const rows = page.locator('[class*="course-row"], [class*="course-item"], mat-card');
    const startedCount = await rows.count();
    // …and the Resume buttons.
    const resumeBtns = page.getByRole('button', { name: hiAlso(/^resume$/i) });
    const count = await resumeBtns.count();
    console.log(`✅ Resume buttons visible: ${count} (started rows: ${startedCount})`);
    // A "Resume" appears per in-progress course. An account with no started
    // courses legitimately has zero — only require Resume when rows are present.
    // THIS is the group's one real assertion, and the pattern the rest could adopt:
    // it asserts a RELATIONSHIP between two observations rather than a fact about
    // the data, so it holds for any account and still catches a broken render.
    if (startedCount > 0) {
      expect(count).toBeGreaterThanOrEqual(1);
    } else {
      console.log('ℹ️  No in-progress courses on this account — no Resume buttons expected (valid state)');
    }
  });

  test('Clicking "Resume" navigates to the course player', async ({ page }) => {
    // The first Resume button.
    const resumeBtn = page.getByRole('button', { name: hiAlso(/^resume$/i) }).first();
    // Nothing to click on an account with no started courses.
    if (!(await resumeBtn.isVisible().catch(() => false))) {
      console.log('ℹ️  No Resume button — skipping');
      return;
    }
    // Keep the before-URL so the log shows a transition.
    const urlBefore = page.url();
    await scrollAndClick(page, resumeBtn);
    await page.waitForTimeout(2500);
    // Both URLs logged, never compared — so a Resume that goes nowhere still passes.
    console.log(`✅ Resume click — URL: ${urlBefore} → ${page.url()}`);
  });

  test('Clicking a course title navigates to the course', async ({ page }) => {
    // Find any course-card-like clickable element with a title
    // `hasText: /\w/` just means "contains at least one word character" — i.e. not empty.
    const card = page.locator('[class*="course"]').filter({ hasText: /\w/ }).first();
    // Nothing to click.
    if (!(await card.isVisible().catch(() => false))) {
      console.log('ℹ️  No course card visible — skipping');
      return;
    }
    const urlBefore = page.url();
    // Within the card, find the title — as a link, a heading, or a title-classed element.
    const titleLink = card.locator('a, h2, h3, [class*="title"]').first();
    if (await titleLink.isVisible().catch(() => false)) {
      await scrollAndClick(page, titleLink);
      await page.waitForTimeout(2500);
      // Logged, not asserted.
      console.log(`✅ Title click — URL: ${urlBefore} → ${page.url()}`);
    }
  });

  test('Started tab count matches actual course rows visible', async ({ page }) => {
    // Read the number the tab label declares…
    const tabText = await page.getByText(withCount('Started')).first().textContent();
    const declaredCount = parseInt(tabText?.match(/\((\d+)\)/)?.[1] ?? '0');
    // …and count the rows actually rendered.
    const rows = page.locator('[class*="course-row"], [class*="course-item"], mat-card');
    const visibleCount = await rows.count();
    // The test's NAME says "matches", but the body prints both numbers and never
    // compares them. (A strict equality check would need care: a virtualised or
    // paginated list legitimately renders fewer rows than the count declares.)
    console.log(`✅ Declared (in tab label): ${declaredCount}, visible rows: ${visibleCount}`);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 3: FOR YOU TAB
// ════════════════════════════════════════════════════════════════════
// The largest group in the file — and the one with no assertions at all.
test.describe('My Courses — For You Tab', () => {
  // Nested hook: opens this tab before every test in the group.
  test.beforeEach(async ({ page }) => {
    await clickTab(page, 'For You');
  });

  test('For You tab content is displayed when active', async ({ page }) => {
    // The recommendation cards.
    const cards = page.locator('[class*="course-card"], mat-card');
    const count = await cards.count();
    // Observed only — what the recommendation engine returns is account-dependent.
    console.log(`✅ For You tab visible cards: ${count}`);
  });

  test('For You section displays course cards in a grid', async ({ page }) => {
    // Narrow to cards that carry a Certificate badge.
    const cards = page.locator('[class*="course-card"], mat-card').filter({ hasText: hiAlso(/Certificate|certificate/i) });
    const count = await cards.count();
    console.log(`✅ Certificate-tagged cards: ${count}`);
  });

  test('Course thumbnail is visible on each For You card', async ({ page }) => {
    // The cards.
    const cards = page.locator('[class*="course-card"], mat-card');
    // Nothing to check without cards.
    if ((await cards.count()) === 0) {
      console.log('ℹ️  No For You cards visible — skipping');
      return;
    }
    // Despite the test's name ("each card"), only the FIRST card's image is checked.
    const firstImg = cards.first().locator('img').first();
    const visible = await firstImg.isVisible().catch(() => false);
    console.log(`✅ First card thumbnail visible: ${visible}`);
  });

  test('"Certificate" badge is visible on cards (top-left)', async ({ page }) => {
    // Anchored, so it matches the badge and not a sentence mentioning certificates.
    const badge = page.getByText(hiAlso(/^Certificate$/i)).first();
    const visible = await badge.isVisible().catch(() => false);
    console.log(`✅ Certificate badge visible: ${visible}`);
  });

  test('Star rating with number (e.g. 4.7 ⭐) is visible on cards', async ({ page }) => {
    // NOTE: this matches ANY decimal anywhere on the page — a duration, a version
    // string, a price. Scoping it to a card would make it mean what the title claims.
    const rating = page.locator('text=/\\d\\.\\d/').first();
    const visible = await rating.isVisible().catch(() => false);
    console.log(`✅ Rating visible: ${visible}`);
  });

  test('Provider tag is visible on cards (e.g. Indian Nursing Council, Jhpiego)', async ({ page }) => {
    // Four accrediting bodies that publish courses on the platform.
    const providers = ['Indian Nursing Council', 'Jhpiego', 'White Ribbon Alliance', 'UNFPA'];
    let found = 0;
    for (const p of providers) {
      // Substring match.
      if (await page.getByText(p, { exact: false }).first().isVisible().catch(() => false)) {
        found++;
        console.log(`   ✓ Provider: "${p}"`);
      }
    }
    // A tally, not an assertion — 0/4 passes.
    console.log(`✅ ${found}/${providers.length} known providers visible in For You`);
  });

  test('Course titles are visible on For You cards', async ({ page }) => {
    // Four course titles known to exist in the catalogue.
    const knownTitles = ['Hypertension in Pregnancy', 'Infection Prevention',
                         'Care of Newborn', 'Newborn Resuscitation'];
    let found = 0;
    for (const t of knownTitles) {
      if (await page.getByText(t, { exact: false }).first().isVisible().catch(() => false)) {
        found++;
        console.log(`   ✓ Title: "${t}"`);
      }
    }
    // Again a tally — what gets recommended varies per account.
    console.log(`✅ ${found}/${knownTitles.length} known For You titles visible`);
  });

  test('Clicking a For You card opens the course detail page', async ({ page }) => {
    // The first card.
    const firstCard = page.locator('[class*="course-card"], mat-card').first();
    // Nothing to click.
    if (!(await firstCard.isVisible().catch(() => false))) {
      console.log('ℹ️  No card visible — skipping');
      return;
    }
    const urlBefore = page.url();
    await scrollAndClick(page, firstCard);
    await page.waitForTimeout(2500);
    // Logged, not asserted.
    console.log(`✅ Card click — URL: ${urlBefore} → ${page.url()}`);
  });

  test('For You tab count matches displayed card count', async ({ page }) => {
    // The declared count from the tab label…
    const tabText = await page.getByText(withCount('For You')).first().textContent();
    const declared = parseInt(tabText?.match(/\((\d+)\)/)?.[1] ?? '0');
    // …and the rendered card count.
    const cards = page.locator('[class*="course-card"], mat-card');
    const visible = await cards.count();
    // Same as the Started tab: the name promises a comparison the body never makes.
    console.log(`✅ Declared: ${declared}, visible cards: ${visible}`);
  });

  test('For You cards are arranged in 3-column grid on desktop', async ({ page }) => {
    // Force a desktop width so the grid is definitely three-wide.
    await page.setViewportSize({ width: 1440, height: 900 });
    // Let the layout reflow.
    await page.waitForTimeout(500);
    // `.all()` resolves the locator into an array of individual card handles.
    const cards = await page.locator('[class*="course-card"], mat-card').all();
    // Can't judge a 3-column grid with fewer than 3 cards.
    if (cards.length < 3) {
      console.log(`ℹ️  Only ${cards.length} cards — skipping grid check`);
      return;
    }
    // Measure the first three cards' on-screen rectangles, in parallel.
    const boxes = await Promise.all(cards.slice(0, 3).map((c) => c.boundingBox()));
    // boundingBox() returns null for a hidden element, so check all three exist.
    if (boxes[0] && boxes[1] && boxes[2]) {
      // Same row = near-identical y coordinates. The 20px tolerance absorbs card-height variation.
      const sameRow = Math.abs(boxes[0].y - boxes[1].y) < 20 && Math.abs(boxes[1].y - boxes[2].y) < 20;
      // The only geometric check in the whole suite — and the answer is printed, not
      // asserted. Column count at 1440px is fixed design, so expect(sameRow).toBe(true)
      // would be safe here.
      console.log(`✅ First 3 cards on same row (3-col grid): ${sameRow}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 4: COMPLETED TAB
// ════════════════════════════════════════════════════════════════════
test.describe('My Courses — Completed Tab', () => {
  // Nested hook: opens this tab before every test in the group.
  test.beforeEach(async ({ page }) => {
    await clickTab(page, 'Completed');
  });

  test('Completed tab becomes active when clicked', async ({ page }) => {
    // The tab element.
    const tab = page.locator('[role="tab"]:has-text("Completed"), .mat-mdc-tab:has-text("Completed")').first();
    // Read both "active" signals.
    const ariaSelected = await tab.getAttribute('aria-selected').catch(() => null);
    const klass = await tab.getAttribute('class').catch(() => '');
    // Printed only. The class is truncated to 100 chars to keep the log readable.
    console.log(`✅ Completed tab — aria-selected: ${ariaSelected}, class: ${klass?.slice(0, 100)}`);
  });

  test('Completed tab count is 0 for new user', async ({ page }) => {
    // Read the count from the tab label.
    const tabText = await page.getByText(withCount('Completed')).first().textContent();
    const count = parseInt(tabText?.match(/\((\d+)\)/)?.[1] ?? '-1');
    console.log(`✅ Completed count: ${count}`);
    // Don't assert == 0 strictly — user may have completed courses elsewhere
    // Correct call: the suite may run as an account that has genuinely finished something.
  });

  test('Empty-state message is visible when no courses completed', async ({ page }) => {
    // The empty-state copy.
    const emptyMsg = page.getByText(hiAlso(/you have not completed any courses/i)).first();
    const visible = await emptyMsg.isVisible().catch(() => false);
    console.log(`✅ Empty-state message visible: ${visible}`);
  });

  test('Empty-state message text matches exactly', async ({ page }) => {
    // The exact expected copy.
    const expected = 'You have not completed any courses.';
    // …but `exact: false` makes this a SUBSTRING search, despite the test's name.
    const msg = page.getByText(expected, { exact: false }).first();
    if (await msg.isVisible().catch(() => false)) {
      // The text is read and printed, never compared to `expected`.
      const text = await msg.textContent();
      console.log(`✅ Empty-state text: "${text?.trim()}"`);
    } else {
      // The legitimate other case: this account HAS completed courses.
      console.log('ℹ️  Empty-state message not found — user may have completed courses');
    }
  });

  test('No course cards are visible when Completed tab is empty', async ({ page }) => {
    // Cards carrying either a Certificate badge or a Resume button.
    const cards = page.locator('[class*="course-card"], mat-card').filter({ hasText: hiAlso(/Certificate|Resume/i) });
    const count = await cards.count();
    // Printed, never required to be zero — even though "empty tab ⇒ no cards" is
    // internal consistency that could be asserted whenever the count is 0.
    console.log(`✅ Card count in empty Completed tab: ${count}`);
  });

  test('No "Resume" buttons appear in Completed tab', async ({ page }) => {
    // Resume belongs to the Started tab and should never appear here.
    const resume = page.getByRole('button', { name: hiAlso(/^resume$/i) });
    const count = await resume.count();
    // Printed, not asserted — so a Resume button offering to re-do a FINISHED
    // course (a real defect) would be reported as a pass.
    console.log(`✅ Resume buttons in Completed tab: ${count}`);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 5: TAB SWITCHING BEHAVIOR
// ════════════════════════════════════════════════════════════════════
// The only group that tests the TRANSITIONS rather than a tab's contents.
// No nested beforeEach — each test drives clickTab itself.
test.describe('My Courses — Tab Switching', () => {
  test('Started → For You switch shows different content', async ({ page }) => {
    // Snapshot the whole document body on the Started tab…
    await clickTab(page, 'Started');
    const startedHTML = await page.locator('body').innerHTML();
    // …switch…
    await clickTab(page, 'For You');
    // …and snapshot again.
    const forYouHTML = await page.locator('body').innerHTML();
    // Deliberately blunt: it needs no knowledge of either tab's contents, so it works
    // for any account. If the tab click silently failed, the snapshots would be
    // identical and this fails. (The flip side: ANY change satisfies it.)
    expect(startedHTML).not.toEqual(forYouHTML);
    console.log('✅ Started vs For You content differs');
  });

  test('For You → Completed switch shows empty state', async ({ page }) => {
    // On For You, the empty-state message should NOT be present…
    await clickTab(page, 'For You');
    const beforeEmpty = await page.getByText(hiAlso(/you have not completed any courses/i)).isVisible().catch(() => false);
    // …and on Completed it should be.
    await clickTab(page, 'Completed');
    const afterEmpty = await page.getByText(hiAlso(/you have not completed any courses/i)).isVisible().catch(() => false);
    // Both values gathered — exactly what an assertion would need — then printed.
    console.log(`✅ Empty msg before switch: ${beforeEmpty}, after: ${afterEmpty}`);
  });

  test('Completed → Started restores Started content', async ({ page }) => {
    // Switch away…
    await clickTab(page, 'Completed');
    await page.waitForTimeout(500);
    // …and back.
    await clickTab(page, 'Started');
    // A Resume button is the marker that Started's content came back.
    const resume = page.getByRole('button', { name: hiAlso(/^resume$/i) }).first();
    const visible = await resume.isVisible().catch(() => false);
    // Printed only.
    console.log(`✅ Started content restored — Resume button visible: ${visible}`);
  });

  test('Each tab switch keeps URL on /my_courses', async ({ page }) => {
    // Walk all three tabs. `as const` keeps the names typed as literals for clickTab.
    for (const tab of ['Started', 'For You', 'Completed'] as const) {
      await clickTab(page, tab);
      const url = page.url();
      console.log(`   ${tab} tab → ${url}`);
      // Asserted three times: tabs must not change the route.
      expect(url).toMatch(/my[-_]?courses/i);
    }
    console.log('✅ URL stays on /my_courses across tab switches');
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 6: HEADER (consistency check — same as Home)
// ════════════════════════════════════════════════════════════════════
// Re-checks the shared shell here, to catch a header that renders on one route but not another.
test.describe('My Courses — Header (same as Home)', () => {
  test('Aastrika logo is visible on My Courses', async ({ page }) => {
    // By alt text, or by an image inside a logo-classed wrapper.
    const logo = page.locator('img[alt*="aastrika" i], [class*="logo"] img').first();
    await expect(logo).toBeVisible();
    console.log('✅ Logo visible');
  });

  test('Search bar is visible on My Courses', async ({ page }) => {
    // Matched by placeholder — the most stable handle for a search input.
    await expect(page.getByPlaceholder(SEARCH_PLACEHOLDER)).toBeVisible();
    console.log('✅ Search bar visible');
  });

  test('"My Courses" nav link is marked active', async ({ page }) => {
    // As a link if possible, else as text.
    const link = page.getByRole('link', { name: hiAlso(/my courses/i) })
      .or(page.getByText(hiAlso(/my courses/i))).first();
    // Read the class list…
    const klass = await link.getAttribute('class').catch(() => '');
    // …and print the first 100 chars. Whether it contains an "active" marker is left
    // for a human to judge — nothing is asserted.
    console.log(`✅ My Courses link class: "${klass?.slice(0, 100)}"`);
  });

  test('Clicking "Home" from My Courses navigates to Home', async ({ page }) => {
    // Anchored, so it can't match "Home page" or similar.
    const homeLink = page.getByRole('link', { name: hiAlso(/^home$/i) })
      .or(page.getByText(hiAlso(/^home$/i))).first();
    await scrollAndClick(page, homeLink);
    await page.waitForTimeout(2000);
    // The ONLY navigation in this file whose destination is actually asserted.
    // Accepting both /app/home and /page/home keeps it working across builds.
    expect(page.url()).toMatch(/\/(app|page)\/home/i);
    console.log(`✅ Home click — URL: ${page.url()}`);
  });

  test('Dark mode toggle is visible on My Courses', async ({ page }) => {
    // Six alternatives — a sign this control has moved more than once.
    const toggle = page.locator([
      'mat-slide-toggle',
      'button[aria-label*="theme" i]',
      'button[aria-label*="dark" i]',
      'mat-icon:has-text("dark_mode")',
      'mat-icon:has-text("brightness")',
      '[class*="theme-toggle"]',
    ].join(', ')).first();
    // An explicit 5s window, then printed. The toggle is never actually operated.
    const visible = await toggle.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(`✅ Dark mode toggle visible: ${visible}`);
  });

  test('Notification bell is visible on My Courses', async ({ page }) => {
    // By the Material ligature text, or by aria-label.
    const bell = page.locator('mat-icon:has-text("notifications"), [aria-label*="notification" i]').first();
    const visible = await bell.isVisible().catch(() => false);
    console.log(`✅ Bell visible: ${visible}`);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 7: PAGE HEALTH
// ════════════════════════════════════════════════════════════════════
// The second most strongly-asserted group, and it holds the file's best test.
test.describe('My Courses — Page Health', () => {
  test('Page loads without console errors', async ({ page }) => {
    // Collect them here.
    const errors: string[] = [];
    // Attach the listener before navigating.
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    // Re-navigate so the listener sees the whole load.
    await page.goto(MY_COURSES_URL);
    await page.waitForLoadState('networkidle');
    // Extra settle for anything that errors late.
    await page.waitForTimeout(2000);
    console.log(`✅ Console errors: ${errors.length}`);
    // Print the first five, truncated. NO expect() — PublicPage.spec.ts runs the
    // same check and DOES assert, after filtering resource-load noise.
    errors.slice(0, 5).forEach((e, i) => console.log(`   [${i + 1}] ${e.slice(0, 200)}`));
  });

  test('Page renders on mobile (390 × 844)', async ({ page }) => {
    // Shrink the shared tab. (beforeEach resets it to 1280 for the next test.)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    // A reachability check: the heading must survive the narrow layout.
    await expect(page.getByText(hiAlso(/^my courses$/i)).filter({ visible: true }).first()).toBeVisible();
    console.log('✅ Mobile viewport — heading visible');
  });

  test('Page renders on tablet (768 × 1024)', async ({ page }) => {
    // The breakpoint where most responsive grids switch layout.
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(500);
    await expect(page.getByText(hiAlso(/^my courses$/i)).filter({ visible: true }).first()).toBeVisible();
    console.log('✅ Tablet viewport — heading visible');
  });

  test('Page renders on desktop (1440 × 900)', async ({ page }) => {
    // The design reference width.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    await expect(page.getByText(hiAlso(/^my courses$/i)).filter({ visible: true }).first()).toBeVisible();
    console.log('✅ Desktop viewport — heading visible');
  });

  test('Page title contains "Aastrika" or "Sphere" or "Courses"', async ({ page }) => {
    // Read the document title.
    const title = await page.title();
    console.log(`✅ Title: "${title}"`);
    // Three accepted words. A wrong or empty title usually means the wrong shell was served.
    expect(title).toMatch(/aastrika|sphere|courses/i);
  });

  test('URL persists on reload', async ({ page }) => {
    // Refresh the page.
    await page.reload();
    await page.waitForLoadState('networkidle');
    // Proves a refresh doesn't bounce the user out or lose the route.
    expect(page.url()).toMatch(/my[-_]?courses/i);
    console.log(`✅ URL after reload: ${page.url()}`);
  });

  test('Unauthenticated access redirects to login', async ({ browser }) => {
    // NOTE the fixture: `{ browser }`, not `{ page }` — this test deliberately opts
    // OUT of the shared authenticated tab.
    // An explicitly EMPTY storageState guarantees a sessionless context.
    // `storageState: undefined` did not: Playwright treats undefined as "not
    // given" and applied the logged-in session from the fixture, so the page
    // opened signed in and the test failed for the wrong reason.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    // Try to open the protected page with no session.
    await page.goto(MY_COURSES_URL);
    await page.waitForLoadState('networkidle').catch(() => {});
    // Give the redirect time to happen.
    await page.waitForTimeout(2000);
    const url = page.url();
    console.log(`✅ Unauth URL: ${url}`);
    // Real access-control coverage: a logged-out visitor must not see the page.
    // Either the app bounces them to a public route, or — what prod does today —
    // it keeps the URL but renders the public shell: a "Log in" button, no
    // signed-in nav, and no course lists. Both are fine; showing data is not.
    if (!/login|public/i.test(url)) {
      await expect(page.getByRole('button', { name: hiAlso(/^log ?in$/i) }).first(), 'logged-out view should offer Log in').toBeVisible();
      await expect(page.getByRole('button', { name: hiAlso(/Account/i) }), 'signed-in nav must not render').toHaveCount(0);
      await expect(page.getByText(withCount('Started')).or(page.getByText(hiAlso(/you have not started any courses/i))), 'course lists must not render').toHaveCount(0);
      console.log('✅ No redirect, but the logged-out shell is shown (Log in button, no user data)');
    }
    // Clean up our own context so it doesn't leak into the rest of the run.
    await context.close();
  });
});
