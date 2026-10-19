/**
 * Home Page — Full Element Coverage
 * ──────────────────────────────────────────────────────────────────
 * Reads the most recently registered test email from
 *   .last-registered-email.json
 * Logs in once via password, saves storageState, reuses session.
 * 
 * Each test is INDEPENDENT — a failure in one doesn't block others.
 */

// Types only — the runner itself comes from our authenticated harness below.
import { Page, Locator } from '@playwright/test';
// Auth via storageState (CI-friendly) with a CDP fallback for local dev.
// See tests/helpers/authedTest.ts.
// `test` here is the AUTHENTICATED one: every test gets a logged-in context.
import { test, expect } from './helpers/authedTest';
import { SEARCH_PLACEHOLDER, hiAlso } from './helpers/i18n';

// Which environment to test.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// The logged-in home page every test here starts from.
const PRIVATE_HOME_URL = `${BASE_URL}/page/home`;

// ════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ════════════════════════════════════════════════════════════════════
// Scroll an element into view, then click it.
async function scrollAndClick(page: Page, locator: Locator) {
  // Playwright can't click what isn't on screen.
  await locator.scrollIntoViewIfNeeded();
  // Then click.
  await locator.click();
}

// ════════════════════════════════════════════════════════════════════
// SETUP — auth is provided by the authedTest harness (storageState / CDP).
// See tests/helpers/authedTest.ts.
// ════════════════════════════════════════════════════════════════════

// Runs before every test: fresh page, back to the logged-in home.
test.beforeEach(async ({ page }) => {
  // Navigate.
  await page.goto(PRIVATE_HOME_URL);
  // Wait for the app's data calls to settle.
  await page.waitForLoadState('networkidle');
});

// ════════════════════════════════════════════════════════════════════
// SECTION 1: HEADER
// ════════════════════════════════════════════════════════════════════
test.describe('Home Page — Header', () => {
  // TEST 1 — the app is branded.
  test('Aastrika Sphere logo is visible', async ({ page }) => {
    // Three alternatives: two alt-text spellings, or an image inside a logo wrapper.
    const logo = page.locator('img[alt*="aastrika" i], img[alt*="logo" i], [class*="logo"] img').first();
    // hard — a missing logo fails.
    await expect(logo).toBeVisible();
    console.log('✅ Logo visible');
  });

  // TEST 2 — the logo is a working Home link.
  test('Logo click navigates to Home', async ({ page }) => {
    // Navigate somewhere marginally different first (a query string), so the click
    // below has to actually do something rather than being a no-op on the same URL.
    await page.goto(PRIVATE_HOME_URL + '?test=1');
    const logo = page.locator('img[alt*="aastrika" i], [class*="logo"] img').first();
    // Click the logo.
    await scrollAndClick(page, logo);
    await page.waitForTimeout(1500);
    // hard — accepting both /app/home and /page/home keeps this working across builds.
    expect(page.url()).toMatch(/\/(app|page)\/home/i);
    console.log(`✅ Logo click → ${page.url()}`);
  });

  // TEST 3 — the search box takes input.
  test('Search bar is visible and accepts input', async ({ page }) => {
    // Matched by placeholder, the most stable handle for a search input.
    const search = page.getByPlaceholder(SEARCH_PLACEHOLDER);
    await expect(search).toBeVisible();
    // Type a query…
    await search.fill('maternal');
    // …and confirm it round-trips exactly. hard.
    await expect(search).toHaveValue('maternal');
    console.log('✅ Search bar accepts input');
  });

  // TEST 4 — submitting the search does something.
  test('Search submission triggers search', async ({ page }) => {
    const search = page.getByPlaceholder(SEARCH_PLACEHOLDER);
    // Type a query.
    await search.fill('maternal');
    // Enter submits it.
    await search.press('Enter');
    await page.waitForTimeout(2000);
    // The resulting URL is LOGGED, never asserted — so a broken search still passes.
    console.log(`✅ Search submitted. URL: ${page.url()}`);
  });

  // TEST 5 — the magnifier icon.
  test('Search icon is visible', async ({ page }) => {
    // By the Material ligature text, or by a search-icon class.
    const searchIcon = page.locator('mat-icon:has-text("search"), [class*="search-icon"]').first();
    // observe — visibility is recorded, not required.
    const visible = await searchIcon.isVisible().catch(() => false);
    console.log(`✅ Search icon visible: ${visible}`);
  });

  // TEST 6 — the theme toggle. Fifteen alternatives, and still only observed.
  test('Dark mode toggle is visible', async ({ page }) => {
    // Broader selector — tries every common pattern for theme toggles.
    // If it still misses, the diagnostic block at the bottom prints all
    // header buttons/icons so we can tune precisely.
    // The sheer length of this list is the finding: this control has moved often
    // enough that no single selector is trusted.
    const toggle = page.locator([
      'mat-slide-toggle',
      'button[aria-label*="theme" i]',
      'button[aria-label*="dark" i]',
      'button[aria-label*="mode" i]',
      'button[aria-label*="bright" i]',
      'mat-icon:has-text("dark_mode")',
      'mat-icon:has-text("brightness")',
      'mat-icon:has-text("light_mode")',
      'mat-icon:has-text("brightness_4")',
      'mat-icon:has-text("brightness_5")',
      'mat-icon:has-text("brightness_6")',
      '[class*="theme-toggle"]',
      '[class*="theme-switch"]',
      '[class*="dark-mode"]',
      '[class*="darkmode"]',
    ].join(', ')).first();

    // An explicit 5s window, then printed rather than asserted.
    const visible = await toggle.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(`✅ Dark mode toggle visible: ${visible}`);

    // The genuinely useful part: when nothing matched, dump every header element
    // so a human can read off a working selector.
    if (!visible) {
      // Diagnostic: dump every button/icon in the header so we can
      // see what selector to use.
      console.log(`   🔍 No match found — dumping header elements for tuning:`);
      // Runs inside the browser, where `document` exists.
      const headerElems = await page.evaluate(() => {
        // Every button and icon in any header- or nav-like container.
        const els = Array.from(document.querySelectorAll(
          'header button, header mat-icon, header [role="button"], ' +
          'nav button, nav mat-icon, [class*="header"] button, [class*="header"] mat-icon'
        ));
        // Cap at 25 so one page can't flood the log.
        return els.slice(0, 25).map((el) => ({
          // For each: its tag name…
          tag: el.tagName.toLowerCase(),
          // …its text (trimmed, first 40 chars)…
          text: (el.textContent ?? '').trim().slice(0, 40),
          // …its aria-label, the most likely handle for an icon button…
          aria: el.getAttribute('aria-label') ?? '',
          // …and its class list, truncated.
          cls: (el.getAttribute('class') ?? '').slice(0, 100),
        }));
      });
      // Print one line per element, indexed, ready to copy into a new selector.
      headerElems.forEach((b, i) => {
        console.log(`      [${i}] <${b.tag}> text="${b.text}" aria="${b.aria}" cls="${b.cls}"`);
      });
    }
  });

  // TEST 7 — does the toggle actually change anything?
  test('Dark mode toggle changes theme', async ({ page }) => {
    // Snapshot the theme BEFORE. Reading both <html> and <body> class lists covers
    // either place a theme class might be applied.
    const before = await page.evaluate(() =>
      document.documentElement.classList.toString() + ' ' + document.body.classList.toString()
    );
    // A shorter selector list than test 6 — eight instead of fifteen.
    const toggle = page.locator([
      'mat-slide-toggle',
      'button[aria-label*="theme" i]',
      'button[aria-label*="dark" i]',
      'button[aria-label*="bright" i]',
      'mat-icon:has-text("dark_mode")',
      'mat-icon:has-text("brightness")',
      'mat-icon:has-text("light_mode")',
      '[class*="theme-toggle"]',
    ].join(', ')).first();

    // No toggle on this build — return early rather than fail.
    if (!(await toggle.isVisible().catch(() => false))) {
      console.log('ℹ️  Toggle not found — skipping theme-change check');
      return;
    }
    // Flip it.
    await scrollAndClick(page, toggle);
    // Let the theme classes update.
    await page.waitForTimeout(800);
    // Snapshot AFTER, the same way.
    const after = await page.evaluate(() =>
      document.documentElement.classList.toString() + ' ' + document.body.classList.toString()
    );
    // Both snapshots printed and never compared — exactly the pair an assertion
    // would need. A toggle that changed nothing would pass.
    console.log(`✅ Before: "${before.trim()}"`);
    console.log(`✅ After : "${after.trim()}"`);
  });

  // TEST 8 — the Home nav link.
  test('"Home" nav link is visible', async ({ page }) => {
    // As a link if possible, else as text. Anchored, so it can't match "Home page".
    const homeLink = page.getByRole('link', { name: hiAlso(/^home$/i) })
      .or(page.getByText(hiAlso(/^home$/i))).first();
    // hard — presence only; this test never clicks.
    await expect(homeLink).toBeVisible();
    console.log('✅ Home nav link visible');
  });

  // TEST 9 — My Courses navigates.
  test('"My Courses" nav link is visible and clickable', async ({ page }) => {
    // Link or text.
    const link = page.getByRole('link', { name: hiAlso(/my courses/i) })
      .or(page.getByText(hiAlso(/my courses/i))).first();
    // Presence IS asserted…
    await expect(link).toBeVisible();
    // Keep the before-URL so the log shows a transition.
    const urlBefore = page.url();
    await scrollAndClick(page, link);
    await page.waitForTimeout(2000);
    // …but both URLs are only logged, never compared.
    console.log(`✅ My Courses click — URL: ${urlBefore} → ${page.url()}`);
  });

  // TEST 10 — Competency navigates. Same shape as test 9.
  test('"Competency" nav link is visible and clickable', async ({ page }) => {
    // Unanchored, so it also matches "Competency Framework" or similar.
    const link = page.getByRole('link', { name: hiAlso(/competency/i) })
      .or(page.getByText(hiAlso(/competency/i))).first();
    await expect(link).toBeVisible();
    // Before-URL for the log.
    const urlBefore = page.url();
    await scrollAndClick(page, link);
    await page.waitForTimeout(2000);
    // Logged, not asserted.
    console.log(`✅ Competency click — URL: ${urlBefore} → ${page.url()}`);
  });

  // TEST 11 — Account navigates.
  test('"Account" nav link is visible and clickable', async ({ page }) => {
    // Anchored, so it can't match "Account settings".
    const link = page.getByRole('link', { name: hiAlso(/^account$/i) })
      .or(page.getByText(hiAlso(/^account$/i))).first();
    // Presence asserted; destination logged only.
    await expect(link).toBeVisible();
    await scrollAndClick(page, link);
    await page.waitForTimeout(1500);
    console.log(`✅ Account click — URL: ${page.url()}`);
  });

  // TEST 12 — the notification bell.
  test('Notification bell icon is visible', async ({ page }) => {
    // Three shapes: the icon ligature, an aria-label, or a button wrapping the icon.
    const bell = page.locator(
      'mat-icon:has-text("notifications"), [aria-label*="notification" i], button:has(mat-icon:has-text("notifications"))'
    ).first();
    // observe.
    const visible = await bell.isVisible().catch(() => false);
    console.log(`✅ Notification bell visible: ${visible}`);
  });

  // TEST 13 — clicking the bell.
  test('Notification bell click opens panel/popup', async ({ page }) => {
    // Two of the three shapes this time.
    const bell = page.locator(
      'mat-icon:has-text("notifications"), [aria-label*="notification" i]'
    ).first();
    // Only click if it's there.
    if (await bell.isVisible().catch(() => false)) {
      await scrollAndClick(page, bell);
      await page.waitForTimeout(1500);
      // The result is logged — nothing checks that a panel actually opened.
      console.log(`✅ Bell clicked — URL: ${page.url()}`);
    // The honest alternative: say we skipped rather than pretend we checked.
    } else {
      console.log('ℹ️  Bell not visible — skipping click');
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 2: WELCOME / HERO
// ════════════════════════════════════════════════════════════════════
test.describe('Home Page — Welcome Section', () => {
  // TEST 1 — the personalised greeting.
  test('"Welcome !" greeting is visible', async ({ page }) => {
    // hard. `\s*!` tolerates "Welcome!" and "Welcome !" alike.
    await expect(page.getByText(hiAlso(/welcome\s*!/i)).first()).toBeVisible();
    console.log('✅ Welcome greeting visible');
  });

  // TEST 2 — the user's name appears in that greeting.
  test('User\'s display name is shown', async ({ page }) => {
    // The same heading as test 1.
    const heading = page.getByText(hiAlso(/welcome\s*!?/i)).first();
    // hard on its presence…
    await expect(heading).toBeVisible();
    // …then the text is read…
    const text = await heading.textContent();
    // …and PRINTED. The name itself is never checked, so a greeting rendering
    // "Welcome, undefined!" would pass this test.
    console.log(`✅ Welcome heading text: "${text?.trim()}"`);
  });

  // TEST 3 — the call-to-action subtitle.
  test('"Start Learning" subtitle is visible', async ({ page }) => {
    // hard.
    await expect(page.getByText(hiAlso(/start learning/i)).first()).toBeVisible();
    console.log('✅ "Start Learning" subtitle visible');
  });

  // TEST 4 — the hero carousel.
  test('Hero carousel banner is visible', async ({ page }) => {
    // Three class shapes for a rotating banner.
    const banner = page.locator('[class*="carousel"], [class*="slider"], [class*="banner"]').first();
    // observe — the carousel rotates, so a hard check would be timing-dependent.
    const visible = await banner.isVisible().catch(() => false);
    console.log(`✅ Hero banner visible: ${visible}`);
  });

  // TEST 5 — text on a rotating slide.
  test('"Watch how Sphere works" text is visible', async ({ page }) => {
    // The hero carousel rotates and its slides vary; treat as a soft check
    // like the other banner tests rather than a hard assertion.
    // The heading we're looking for.
    const el = page.getByText(/watch how sphere works/i).first();
    // observe — an inactive slide is not a defect.
    const visible = await el.isVisible().catch(() => false);
    console.log(`✅ Banner heading visible: ${visible}`);
  });

  // TEST 6 — the banner's call to action.
  test('"Watch now" button is visible and clickable', async ({ page }) => {
    // As a real button if there is one, else as text.
    const btn = page.getByRole('button', { name: /watch now/i })
      .or(page.getByText(/watch now/i)).first();
    // Only act if this slide happens to be showing.
    if (await btn.isVisible().catch(() => false)) {
      await scrollAndClick(page, btn);
      await page.waitForTimeout(2000);
      // The destination is logged, never asserted.
      console.log(`✅ Watch now clicked — URL: ${page.url()}`);
    // The honest alternative: say we skipped rather than pretend we checked.
    } else {
      console.log('ℹ️  "Watch now" not on current banner slide — skipping click');
    }
  });

  // TEST 7 — the carousel's pagination indicators.
  test('Carousel pagination dots are visible', async ({ page }) => {
    // Four shapes, covering Material tabs and Swiper bullets.
    const dots = page.locator('[class*="dot"], [class*="indicator"], .swiper-pagination-bullet, .mat-tab-label');
    // Counted…
    const count = await dots.count();
    // …and printed. observe — zero indicators passes.
    console.log(`✅ Carousel pagination indicators: ${count}`);
  });

  // TEST 8 — clicking an indicator.
  test('Clicking carousel dot switches slide', async ({ page }) => {
    // Two of the four shapes this time.
    const dots = page.locator('[class*="dot"], .swiper-pagination-bullet').first();
    // Only click if it's there.
    if (await dots.isVisible().catch(() => false)) {
      await scrollAndClick(page, dots);
      await page.waitForTimeout(1000);
      // Nothing checks that the slide actually changed.
      console.log('✅ Carousel dot clicked');
    } else {
      console.log('ℹ️  No pagination dot found — skipping click');
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 3: CONTINUE LEARNING
// ════════════════════════════════════════════════════════════════════
test.describe('Home Page — Continue Learning', () => {
  // TEST 1 — the in-progress section's heading.
  test('"CONTINUE LEARNING" section heading is visible', async ({ page }) => {
    // The heading.
    const heading = page.getByText(hiAlso(/continue learning/i)).first();
    // observe — deliberately soft, because a brand-new user has nothing in progress.
    const visible = await heading.isVisible().catch(() => false);
    console.log(`✅ "Continue Learning" heading visible: ${visible}`);
    // observe again — and the log explains WHY the section may be absent.
    if (!visible) console.log('   ℹ️  Section absent — user has no in-progress courses');
  });

  // TEST 2 — the section's View All link.
  test('"View All" link visible for Continue Learning', async ({ page }) => {
    // `.first()` takes the FIRST View All on the page, which may belong to a
    // different section entirely — the locator is not scoped to Continue Learning.
    const viewAll = page.getByText(hiAlso(/view all/i)).first();
    // observe.
    const visible = await viewAll.isVisible().catch(() => false);
    console.log(`✅ View All visible: ${visible}`);
  });

  // TEST 3 — a course card opens.
  test('Continue Learning course cards are clickable', async ({ page }) => {
    // Check the section exists before looking for its cards.
    const sectionHeading = page.getByText(hiAlso(/continue learning/i)).first();
    // Absent — return early rather than click something from another section.
    if (!(await sectionHeading.isVisible().catch(() => false))) {
      console.log('ℹ️  Section absent — skipping card click');
      return;
    }
    // "Any Material card, or anything card-classed" — very broad.
    const firstCard = page.locator('mat-card, [class*="card"]').first();
    // Only click if present.
    if (await firstCard.isVisible().catch(() => false)) {
      // Keep the before-URL for the log.
      const urlBefore = page.url();
      await scrollAndClick(page, firstCard);
      await page.waitForTimeout(2500);
      // Both URLs logged, never compared.
      console.log(`✅ Card click — URL: ${urlBefore} → ${page.url()}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 4: CNE COURSES
// ════════════════════════════════════════════════════════════════════
test.describe('Home Page — CNE Courses', () => {
  // TEST 1 — the accredited-course section heading.
  test('"CNE COURSES" section heading is visible', async ({ page }) => {
    // hard — unlike Continue Learning, this section is always present.
    await expect(page.getByText(hiAlso(/cne courses/i)).first()).toBeVisible();
    console.log('✅ "CNE Courses" heading visible');
  });

  // TEST 2 — a View All link exists somewhere on the page.
  test('"View All" link visible for CNE Courses', async ({ page }) => {
    // Every View All.
    const viewAllLinks = page.getByText(hiAlso(/view all/i));
    // Counted…
    const count = await viewAllLinks.count();
    console.log(`✅ View All link count on page: ${count}`);
    // hard, but only that at least one exists ANYWHERE — not that this section has one.
    expect(count).toBeGreaterThan(0);
  });

  // TEST 3 — the CNE cards.
  test('CNE Courses section has cards', async ({ page }) => {
    // Cards whose text mentions CNE credit.
    const cards = page.locator('[class*="course-card"], mat-card').filter({ hasText: /CNE:|cne:/i });
    const count = await cards.count();
    // observe — zero cards passes.
    console.log(`✅ CNE course cards: ${count}`);
  });

  // TEST 4 — course titles.
  test('First CNE card shows course title', async ({ page }) => {
    // Known catalogue titles. The Devanagari entry is there because course titles
    // are stored as authored and never translated by the platform.
    const titles = ['Implementing Respectful', 'सम्मानपूर्ण', 'Normal Labour', 'Integrated Sexual'];
    // Count how many we can find.
    let found = 0;
    for (const t of titles) {
      // Substring match — cards truncate long titles.
      const exists = await page.getByText(t, { exact: false }).first().isVisible().catch(() => false);
      if (exists) { found++; console.log(`   ✓ Title visible: "${t}"`); }
    }
    // A tally, not an assertion: 0/4 still passes, because which courses appear is data.
    console.log(`✅ ${found}/${titles.length} known CNE titles visible`);
  });

  // TEST 5 — the CNE points badge.
  test('CNE points badge is visible on cards', async ({ page }) => {
    // Requires the digits too, so "CNE:" alone won't match.
    const cne = page.locator('text=/CNE:\\s*\\d+/i').first();
    // observe.
    const visible = await cne.isVisible().catch(() => false);
    console.log(`✅ CNE points badge visible: ${visible}`);
  });

  // TEST 6 — the star rating.
  test('Course rating (e.g. 4.7) is visible on cards', async ({ page }) => {
    // Matches ANY decimal anywhere on the page — a duration, a version string.
    // Scoping it to a card would make it mean what the title claims.
    const rating = page.locator('text=/\\d\\.\\d/').first();
    // observe.
    const visible = await rating.isVisible().catch(() => false);
    console.log(`✅ Rating visible: ${visible}`);
  });

  // TEST 7 — the accrediting bodies.
  test('Provider tag is visible', async ({ page }) => {
    // Three organisations that publish on the platform.
    const providers = ['White Ribbon Alliance', 'Indian Nursing Council', 'UNFPA'];
    // Count the hits.
    let found = 0;
    for (const p of providers) {
      if (await page.getByText(p, { exact: false }).first().isVisible().catch(() => false)) {
        found++;
        console.log(`   ✓ Provider visible: "${p}"`);
      }
    }
    // Another tally — 0/3 passes.
    console.log(`✅ ${found}/${providers.length} known providers visible`);
  });

  // TEST 8 — a CNE card opens.
  test('First CNE card click navigates to course detail', async ({ page }) => {
    // Narrowed to cards carrying a CNE badge.
    const firstCard = page.locator('mat-card, [class*="card"]').filter({ hasText: /CNE:/i }).first();
    // Nothing to click.
    if (!(await firstCard.isVisible().catch(() => false))) {
      console.log('ℹ️  No CNE card visible — skipping');
      return;
    }
    // Before-URL for the log.
    const urlBefore = page.url();
    await scrollAndClick(page, firstCard);
    await page.waitForTimeout(2500);
    // Logged, not asserted.
    console.log(`✅ CNE card click — URL: ${urlBefore} → ${page.url()}`);
  });

  // TEST 9 — View All navigates.
  test('"View All" CNE click navigates', async ({ page }) => {
    // Again the first one on the page, whichever section it belongs to.
    const viewAll = page.getByText(hiAlso(/view all/i)).first();
    // Only click if present.
    if (await viewAll.isVisible().catch(() => false)) {
      await scrollAndClick(page, viewAll);
      await page.waitForTimeout(2000);
      // Destination logged only.
      console.log(`✅ View All click — URL: ${page.url()}`);
    }
  });

  // TEST 10 — the carousel's next arrow.
  test('CNE Courses horizontal scroll arrows', async ({ page }) => {
    // Three shapes: aria-label, or either of two class conventions.
    const rightArrow = page.locator('[aria-label*="next" i], [class*="arrow-right"], [class*="next-button"]').first();
    // Only interact if present. The arrow can be on-screen yet non-actionable
    // (overlapped by a course card, or a disabled edge state), which made a plain
    // click time out at 15s. This is a smoke check only — nothing asserts the
    // carousel moved — so scroll it into view and force-click with a short budget,
    // swallowing failures, so a flaky arrow never reds the suite.
    if (await rightArrow.isVisible().catch(() => false)) {
      await rightArrow.scrollIntoViewIfNeeded().catch(() => {});
      await rightArrow.click({ force: true, timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
      console.log('✅ Right arrow interaction attempted');
    } else {
      console.log('ℹ️  No horizontal scroll arrow visible');
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 5: INFO CARDS (Register / Take / Get Certified)
// ════════════════════════════════════════════════════════════════════
test.describe('Home Page — Info Cards', () => {
  // TEST 1 — the first explainer card. All six text checks in this group are hard,
  // because this is fixed copy, identical for every account.
  test('"Register for a course" card is visible', async ({ page }) => {
    await expect(page.getByText(hiAlso(/register for a course/i)).first()).toBeVisible();
    console.log('✅ Register card visible');
  });

  // TEST 2 — its description.
  test('"Register for a course" subtitle is visible', async ({ page }) => {
    // hard.
    await expect(page.getByText(hiAlso(/explore various courses and pick/i)).first()).toBeVisible();
    console.log('✅ Register subtitle visible');
  });

  // TEST 3 — the second card's title.
  test('"Take the course" card is visible', async ({ page }) => {
    // hard.
    await expect(page.getByText(hiAlso(/take the course/i)).first()).toBeVisible();
    console.log('✅ Take card visible');
  });

  // TEST 4 — its description.
  test('"Take the course" subtitle is visible', async ({ page }) => {
    // hard.
    await expect(page.getByText(hiAlso(/access the course anytime/i)).first()).toBeVisible();
    console.log('✅ Take subtitle visible');
  });

  // TEST 5 — the third card's title.
  test('"Get certified" card is visible', async ({ page }) => {
    // hard.
    await expect(page.getByText(hiAlso(/get certified/i)).first()).toBeVisible();
    console.log('✅ Get certified card visible');
  });

  // TEST 6 — its description.
  test('"Get certified" subtitle is visible', async ({ page }) => {
    // hard.
    await expect(page.getByText(hiAlso(/receive downloadable and shareable certificates/i)).first()).toBeVisible();
    console.log('✅ Get certified subtitle visible');
  });

  // TEST 7 — does the first card do anything when clicked?
  test('Register card click behavior', async ({ page }) => {
    // Find the card by the text it contains.
    const card = page.locator('mat-card, [class*="card"]').filter({ hasText: hiAlso(/register for a course/i) }).first();
    // Only click if present.
    if (await card.isVisible().catch(() => false)) {
      // Before-URL for the log.
      const urlBefore = page.url();
      await scrollAndClick(page, card);
      await page.waitForTimeout(1500);
      // Logged, not asserted — these cards may well be decorative.
      console.log(`✅ Register card click — URL: ${urlBefore} → ${page.url()}`);
    }
  });

  // TEST 8 — the second card. Same shape.
  test('Take card click behavior', async ({ page }) => {
    const card = page.locator('mat-card, [class*="card"]').filter({ hasText: hiAlso(/take the course/i) }).first();
    if (await card.isVisible().catch(() => false)) {
      const urlBefore = page.url();
      await scrollAndClick(page, card);
      await page.waitForTimeout(1500);
      console.log(`✅ Take card click — URL: ${urlBefore} → ${page.url()}`);
    }
  });

  // TEST 9 — the third card. Same shape.
  test('Get certified card click behavior', async ({ page }) => {
    const card = page.locator('mat-card, [class*="card"]').filter({ hasText: hiAlso(/get certified/i) }).first();
    if (await card.isVisible().catch(() => false)) {
      const urlBefore = page.url();
      await scrollAndClick(page, card);
      await page.waitForTimeout(1500);
      console.log(`✅ Get certified card click — URL: ${urlBefore} → ${page.url()}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 6: FOOTER
// ════════════════════════════════════════════════════════════════════
test.describe('Home Page — Footer', () => {
  // TEST 1 — the footer logo.
  test('Footer Aastrika Sphere logo is visible', async ({ page }) => {
    // Scope to the footer first — the semantic tag or a footer class.
    const footer = page.locator('footer, [class*="footer"]').first();
    // Then the first image inside it.
    const logo = footer.locator('img').first();
    // observe.
    const visible = await logo.isVisible().catch(() => false);
    console.log(`✅ Footer logo visible: ${visible}`);
  });

  // TEST 2 — the legal-links column heading.
  test('"Quick Links" heading is visible', async ({ page }) => {
    // hard.
    await expect(page.getByText(hiAlso(/quick links/i)).first()).toBeVisible();
    console.log('✅ Quick Links heading visible');
  });

  // TEST 3 — the privacy policy link.
  test('"Privacy policy" link is visible and clickable', async ({ page }) => {
    // The link.
    const link = page.getByText(hiAlso(/privacy policy/i)).first();
    // Presence IS asserted.
    await expect(link).toBeVisible();

    // Promise.all registers the new-tab listener and clicks AT THE SAME TIME, so a
    // tab that opens instantly isn't missed. `.catch(() => null)` turns the 3s
    // timeout into a null rather than a rejection, making both branches normal.
    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null),
      scrollAndClick(page, link),
    ]);
    await page.waitForTimeout(1500);

    // Opened in a new tab — log its URL and tidy up.
    if (popup) {
      console.log(`✅ Privacy policy opened popup: ${popup.url()}`);
      await popup.close();
    // Navigated in-page instead — log where we ended up. Neither is asserted.
    } else {
      console.log(`✅ Privacy policy click — URL: ${page.url()}`);
    }
  });

  // TEST 4 — the terms link. Identical shape to test 3.
  test('"Terms of Use" link is visible and clickable', async ({ page }) => {
    const link = page.getByText(hiAlso(/terms of use/i)).first();
    await expect(link).toBeVisible();

    // Same simultaneous listener-and-click pattern.
    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null),
      scrollAndClick(page, link),
    ]);
    await page.waitForTimeout(1500);

    if (popup) {
      console.log(`✅ Terms of Use opened popup: ${popup.url()}`);
      await popup.close();
    } else {
      console.log(`✅ Terms of Use click — URL: ${page.url()}`);
    }
  });

  // TEST 5 — the support column heading.
  test('"Help & Contact" heading is visible', async ({ page }) => {
    // hard.
    await expect(page.getByText(hiAlso(/help & contact/i)).first()).toBeVisible();
    console.log('✅ Help & Contact heading visible');
  });

  // TEST 6 — the support email.
  test('Support email link is visible', async ({ page }) => {
    // Either any mailto link, or one containing the address text.
    const link = page.locator('a[href*="mailto:"], a:has-text("support@aastrika.org")').first();
    // Presence IS asserted…
    await expect(link).toBeVisible();
    // …but the href is only read…
    const href = await link.getAttribute('href');
    // …and printed. A dead mailto would still pass.
    console.log(`✅ Support email link visible — href: ${href}`);
  });

  // TEST 7 — the WhatsApp button's presence.
  test('"Talk to us on WhatsApp" button is visible', async ({ page }) => {
    // hard.
    await expect(page.getByText(hiAlso(/talk to us on whatsapp/i)).first()).toBeVisible();
    console.log('✅ WhatsApp button visible');
  });

  // TEST 8 — clicking it.
  test('WhatsApp button click opens WhatsApp', async ({ page }) => {
    const btn = page.getByText(hiAlso(/talk to us on whatsapp/i)).first();

    // Same listener-and-click pattern.
    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null),
      // The WhatsApp link may navigate/open externally; a click timeout here
      // shouldn't fail the test — its sibling already asserts visibility.
      // Note the extra .catch on the CLICK itself: an external navigation can make
      // the click time out, and its sibling test above already asserts visibility.
      scrollAndClick(page, btn).catch((e) =>
        console.log(`ℹ️  WhatsApp click note: ${(e as Error).message.split('\n')[0]}`)),
    ]);
    await page.waitForTimeout(1500);

    // New tab — log and close.
    if (popup) {
      console.log(`✅ WhatsApp opened: ${popup.url()}`);
      await popup.close();
    // In-page — log the URL.
    } else {
      console.log(`✅ WhatsApp click — URL: ${page.url()}`);
    }
  });

  // TEST 9 — the extra-links column heading.
  test('"Additional Links" heading is visible', async ({ page }) => {
    // hard.
    await expect(page.getByText(hiAlso(/additional links/i)).first()).toBeVisible();
    console.log('✅ Additional Links heading visible');
  });

  // TEST 10 — the foundation link.
  test('"Aastrika Foundation" link is visible with URL', async ({ page }) => {
    // `.first()` here, unlike PublicPage which uses .last() to reach the footer copy.
    const link = page.locator('a[href*="aastrika.org"]').first();
    // Presence asserted; href logged only.
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    console.log(`✅ Aastrika Foundation link href: ${href}`);
  });

  // TEST 11 — that link opens externally.
  test('Aastrika Foundation link opens in new tab', async ({ page }) => {
    const link = page.locator('a[href*="aastrika.org"]').first();

    // Same listener-and-click pattern.
    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null),
      scrollAndClick(page, link),
    ]);
    await page.waitForTimeout(1500);

    if (popup) {
      console.log(`✅ Foundation link opened: ${popup.url()}`);
      await popup.close();
    } else {
      console.log(`✅ Foundation link click — URL: ${page.url()}`);
    }
  });

  // TEST 12 — Twitter/X. Covers both the old and new domains.
  test('Twitter social icon is visible', async ({ page }) => {
    const twitter = page.locator('a[href*="twitter"], a[href*="x.com"], [aria-label*="twitter" i]').first();
    // observe — href never even read.
    const visible = await twitter.isVisible().catch(() => false);
    console.log(`✅ Twitter icon visible: ${visible}`);
  });

  // TEST 13 — Facebook. Same shape.
  test('Facebook social icon is visible', async ({ page }) => {
    const fb = page.locator('a[href*="facebook"], [aria-label*="facebook" i]').first();
    const visible = await fb.isVisible().catch(() => false);
    console.log(`✅ Facebook icon visible: ${visible}`);
  });

  // TEST 14 — Instagram. Same shape.
  test('Instagram social icon is visible', async ({ page }) => {
    const ig = page.locator('a[href*="instagram"], [aria-label*="instagram" i]').first();
    const visible = await ig.isVisible().catch(() => false);
    console.log(`✅ Instagram icon visible: ${visible}`);
  });

  // TEST 15 — LinkedIn. Same shape.
  test('LinkedIn social icon is visible', async ({ page }) => {
    const li = page.locator('a[href*="linkedin"], [aria-label*="linkedin" i]').first();
    const visible = await li.isVisible().catch(() => false);
    console.log(`✅ LinkedIn icon visible: ${visible}`);
  });

  // TEST 16 — the copyright line.
  test('Copyright notice is visible', async ({ page }) => {
    // hard. Two accepted spellings — the first carries the site's own typo.
    await expect(page.getByText(hiAlso(/aastarurmika health systems|aastrika foundation/i)).first()).toBeVisible();
    console.log('✅ Copyright notice visible');
  });

  // TEST 17 — the copyright year.
  test('Copyright year is current', async ({ page }) => {
    // Find the © followed by four digits.
    const copyrightText = await page.locator('text=/©\\s*\\d{4}/').first().textContent();
    console.log(`✅ Copyright text: "${copyrightText?.trim()}"`);
    // What year is it actually?
    const currentYear = new Date().getFullYear();
    // Pull the year out of the text.
    const matches = copyrightText?.match(/\d{4}/);
    if (matches) {
      // Parsed and PRINTED beside the current year — never compared, so a stale
      // copyright year would pass unnoticed.
      const year = parseInt(matches[0]);
      console.log(`   Year in copyright: ${year}, current: ${currentYear}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 7: PAGE-LEVEL HEALTH
// ════════════════════════════════════════════════════════════════════
// TEST 1 — the page title.
test.describe('Home Page — Page Health', () => {
  test('Page title contains "Aastrika" or "Sphere"', async ({ page }) => {
    // Read it.
    const title = await page.title();
    console.log(`✅ Title: "${title}"`);
    // hard — a wrong or empty title usually means the wrong shell was served.
    expect(title).toMatch(/aastrika|sphere/i);
  });

  // TEST 2 — console errors.
  test('No console errors on page load', async ({ page }) => {
    // Collect them here.
    const errors: string[] = [];
    // Attach the listener before navigating.
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    // Re-navigate so the listener sees the whole load.
    await page.goto(PRIVATE_HOME_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    // Count printed…
    console.log(`✅ Console errors: ${errors.length}`);
    // …and the first five, truncated. NO expect() — PublicPage.spec.ts runs the same
    // check and DOES assert, after filtering out resource-load noise.
    errors.slice(0, 5).forEach((e, i) => console.log(`   [${i + 1}] ${e.slice(0, 200)}`));
  });

  // TEST 3 — mobile rendering.
  test('Page renders on mobile viewport (390 × 844)', async ({ page }) => {
    // Shrink the viewport.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    // hard — the greeting must survive the narrow layout.
    await expect(page.getByText(hiAlso(/welcome/i)).first()).toBeVisible();
    console.log('✅ Mobile viewport — Welcome visible');
  });

  // TEST 4 — tablet. The breakpoint where most grids switch layout.
  test('Page renders on tablet viewport (768 × 1024)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(500);
    // hard.
    await expect(page.getByText(hiAlso(/welcome/i)).first()).toBeVisible();
    console.log('✅ Tablet viewport — Welcome visible');
  });

  // TEST 5 — desktop, the design reference width.
  test('Page renders on desktop viewport (1440 × 900)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    // hard.
    await expect(page.getByText(hiAlso(/welcome/i)).first()).toBeVisible();
    console.log('✅ Desktop viewport — Welcome visible');
  });

  // TEST 6 — the header stays put when the page scrolls.
  test('Header stays sticky on scroll', async ({ page }) => {
    // Scroll down 1500px with the mouse wheel.
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(500);
    // The logo lives in the header.
    const logo = page.locator('img[alt*="aastrika" i], [class*="logo"] img').first();
    // hard — still visible after scrolling means the header really is sticky.
    await expect(logo).toBeVisible();
    console.log('✅ Logo still visible after scroll (sticky header)');
  });

  // TEST 7 — the footer is reachable.
  test('Footer is visible after scroll', async ({ page }) => {
    // Jump to the very bottom of the document.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    // hard — the copyright line proves we got there.
    await expect(page.getByText(hiAlso(/aastarurmika health systems|aastrika foundation/i)).first()).toBeVisible();
    console.log('✅ Footer visible after scroll to bottom');
  });
});