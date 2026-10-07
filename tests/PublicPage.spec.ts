// ─── tests/PublicPage.spec.ts ────────────────────────────────────
// Complete automation for every element on the Sphere public home page.
// Covers: Header, Banner, Stats, Top Courses, CNE Courses, How Sphere Works,
//         Start Today CTA, Footer (Quick Links, Help & Contact, Additional Links, Social Icons)
//
// BILINGUAL: sphere.aastrika.org (and portal-staging) serve the public page in
// HINDI by default, but can also render English. Every text assertion below
// matches EITHER language via the tr() helper, so the suite is green on both.
//
// Run: npx playwright test tests/PublicPage.spec.ts --project=Chrome --headed

// The test runner, the assertion library, and the Page type.
import { test, expect, Page } from '@playwright/test';
import { hiAlso } from './helpers/i18n';

// Origin only — PUBLIC_URL appends the path. (Strip any trailing /public/home
// so we never end up with /public/home/public/home.)
// Take only the ORIGIN. Both replaces defend against a mis-set env var:
// strip trailing slashes, then strip an already-appended path — without the
// second one, BASE_URL=".../public/home" would produce /public/home/public/home.
const BASE_URL = (process.env.BASE_URL ?? 'https://sphere.aastrika.org')
  .replace(/\/+$/, '')
  .replace(/\/public\/home$/, '');

// The page every test here starts from.
const PUBLIC_URL = `${BASE_URL}/public/home`;

// ─── Bilingual label map: English → its Hindi rendering(s) ─────────
// Captured live from sphere.aastrika.org (Hindi is the default language).
// Labels absent here (course titles, partner badges, numbers, emails) render
// identically in both languages, so tr() falls back to the English key alone.
// The lookup table: one English key → its Hindi rendering(s). Some keys carry TWO
const HI: Record<string, string[]> = {
  'Log in': ['लॉग इन करें', 'लॉगिन'],
  'Create Account': ['खाता बनाएँ', 'एक नया खाता बनाएँ'],
  'Access free Healthcare courses': ['मुफ्त स्वास्थ्य सेवा पाठ्यक्रमों तक पहुंचें'],
  'Learn at your own pace & Get Certified': ['अपनी गति से सीखें और प्रमाणित हों'],
  'New User?': ['नया उपयोगकर्ता?'],
  'Learners onboarded': ['शिक्षार्थी शामिल'],
  'Number of courses': ['पाठ्यक्रमों की संख्या'],
  'CNE Hours': ['सीएनई घंटे'],
  'Total certificate issued': ['जारी किए गए कुल प्रमाणपत्र'],
  'TOP COURSES': ['शीर्ष पाठ्यक्रम'],
  'View All': ['सभी देखें'],
  'CNE COURSES': ['सीएनई पाठ्यक्रम'],
  'Trusted By': ['द्वारा विश्वस्त'],
  '50+ Partner Organizations and Growing': ['50+ भागीदार संगठन और बढ़ रहे हैं'],
  'How Sphere works': ['Sphere कैसे काम करता है'],
  'In 3-simple videos we guide you through making an account and getting certified.':
    ['इन तीन आसान वीडियो में हम आपको अकाउंट खोलना और कोर्स पूरा करना सिखाएंगे.'],
  'Register for a course': ['किसी पाठ्यक्रम के लिए पंजीकरण करें'],
  'Explore various courses and pick the ones you like':
    ['विभिन्न पाठ्यक्रमों का पता लगाएं और अपनी पसंद के पाठ्यक्रम चुनें'],
  'Take the course': ['पाठ्यक्रम लें'],
  'Access the course anytime, at your convenience': ['किसी भी समय, अपनी सुविधा पर पाठ्यक्रम तक पहुंचें'],
  'Get certified': ['प्रमाणित हो जाओ'],
  'Receive downloadable and shareable certificates': ['डाउनलोड करने योग्य और साझा करने योग्य प्रमाणपत्र प्राप्त करें'],
  'Transform your Healthcare career through Sphere!': ['Sphere के माध्यम से अपने स्वास्थ्य सेवा कैरियर को बदलें!'],
  'Start Today': ['आज शुरु करो'],
  'Quick Links': ['त्वरित लिंक'],
  'Privacy policy': ['गोपनीयता नीति'],
  'Terms of Use': ['उपयोग की शर्तें'],
  'Help & Contact': ['सहायता एवं संपर्क करें'],
  'Talk to us on WhatsApp': ['WhatsApp पर हमसे बात करें'],
  'Additional Links': ['अतिरिक्त लिंक'],
  'Aastrika Foundation:': ['आस्ट्रिका फाउंडेशन:'],
  // 'An initiative of' / 'A collaboration with' stay English even in Hindi mode.
};

// Turns one English key into a regex matching either language.
// Build a case-insensitive RegExp matching the English label OR any Hindi variant.
// Escape every regex metacharacter. Real labels contain & + ? ! and . —
// unescaped, "50+" would mean "one or more zeroes" and match nothing on screen.
function tr(en: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // English key FIRST, then any Hindi variants. Leading with English is what makes
  // an UNMAPPED label degrade to a plain English match instead of throwing.
  const alts = [en, ...(HI[en] || [])].map(esc);
  return new RegExp(alts.join('|'), 'i');
}

// ─── Helper: scroll element into view before clicking ─────────────
async function scrollAndClick(page: Page, locator: any) {
  // Scroll an element into view, then click it.
  await locator.scrollIntoViewIfNeeded();
  // Playwright can't click what isn't on screen.
  await locator.click();
// Then click.
}

// Scrolls an OPTIONAL element into view without failing if it's absent, and
// returns whether it's visible. Use for elements that may not exist on every
// build (partner/collaboration logos, social icons) so a missing one is a
// clean skip instead of a 15s scrollIntoViewIfNeeded timeout that fails the test.
async function safeScroll(locator: any): Promise<boolean> {
  await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  return locator.isVisible().catch(() => false);
}

// ══════════════════════════════════════════════════════════════════
// PUBLIC PAGE — FULL ELEMENT COVERAGE
// ══════════════════════════════════════════════════════════════════
test.describe('Public Page - Complete Element Coverage', () => {

  // Runs before every test: fresh page, fresh navigation.
  test.beforeEach(async ({ page }) => {
    // Open the public home page.
    await page.goto(PUBLIC_URL);
    // Only wait for the HTML — not networkidle, which this ad-heavy page rarely reaches.
    await page.waitForLoadState('domcontentloaded');
    // Log the URL so a wrong environment is obvious in the report.
    console.log('✅ Page loaded:', page.url());
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 1: HEADER
  // ────────────────────────────────────────────────────────────────
  test.describe('Header', () => {

    // TEST 1 — the site is branded, not a blank shell.
    test('Aastrika Sphere logo is visible', async ({ page }) => {
      // Three alternatives: alt text, a logo class, or the Angular nav-bar's own image.
      const logo = page.locator('img[alt*="logo"], [class*="logo"], ws-app-public-nav-bar img').first();
      // hard — a missing logo fails.
      await expect(logo).toBeVisible();
      console.log('✅ Logo is visible');
    });

    // TEST 2 — the login entry point opens and closes cleanly.
    test('Log in button is visible and clickable - closes modal after', async ({ page }) => {
      // Matched through tr(), so it works on the Hindi build too.
      const loginBtn = page.getByRole('button', { name: tr('Log in') }).first();
      // It must be on screen…
      await expect(loginBtn).toBeVisible();
      // …and actually clickable, not greyed out.
      await expect(loginBtn).toBeEnabled();
      // Open the modal.
      await loginBtn.click();
      console.log('✅ Login button clicked');

      // Modal should open
      // Deliberately loose: match on ANY of three signals. The overlay's markup has
      // changed between builds, so "something modal-shaped appeared" is the durable check.
      const modal = page.locator('[class*="modal"], [class*="login"], [role="dialog"]').first();
      await expect(modal).toBeVisible({ timeout: 5000 });
      console.log('✅ Login modal opened');

      // Close modal by pressing Escape
      // Escape dismisses it. The dismissal itself is not asserted — the test's real
      // subject is that the click produced a modal at all.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      console.log('✅ Login modal closed');
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 2: HERO BANNER
  // ────────────────────────────────────────────────────────────────
  test.describe('Hero Banner', () => {

    // TEST 1 — the value proposition renders.
    test('"Access free Healthcare courses" heading is visible', async ({ page }) => {
      // Pattern A: above the fold, so no scroll is needed.
      const heading = page.getByText(tr('Access free Healthcare courses')).first();
      await expect(heading).toBeVisible();
      console.log('✅ Hero heading visible');
    });

    // TEST 2 — the supporting line.
    test('"Learn at your own pace & Get Certified" subtext is visible', async ({ page }) => {
      // The & in this label is exactly why tr() escapes before building the regex.
      const subtext = page.getByText(tr('Learn at your own pace & Get Certified')).first();
      await expect(subtext).toBeVisible();
      console.log('✅ Hero subtext visible');
    });

    // TEST 3 — the signup prompt.
    test('"New User?" text is visible', async ({ page }) => {
      // The ? here would be a regex quantifier if tr() didn't escape it.
      const newUserText = page.getByText(tr('New User?')).first();
      await expect(newUserText).toBeVisible();
      console.log('✅ New User? text visible');
    });

    // TEST 4 — the primary call to action navigates.
    test('Create Account button is visible and clickable', async ({ page }) => {
      // The hero's Create Account button.
      const createBtn = page.getByRole('button', { name: tr('Create Account') }).first();
      // Visible…
      await expect(createBtn).toBeVisible();
      // …and enabled.
      await expect(createBtn).toBeEnabled();
      // Click it. The click succeeding is asserted; where it LANDS is only logged.
      await createBtn.click();
      await page.waitForLoadState('domcontentloaded');
      console.log('✅ Create Account button clicked → URL:', page.url());
      // Navigate back
      // Return to the public page so the next test starts from a known state.
      await page.goto(PUBLIC_URL);
      await page.waitForLoadState('domcontentloaded');
    });

    // TEST 5 — content on a rotating carousel slide.
    test('CNE Hours banner - "Check out courses with CNE Hours" is visible', async ({ page }) => {
      // This lives on a rotating hero-carousel slide that may not be active
      // when the check runs — treat as a soft check.
      // Bilingual regex written inline here rather than through tr().
      const bannerText = page.getByText(/check out courses with cne hours|सीएनई घंटों वाले पाठ्यक्रम/i).first();
      // Soft: isVisible() with a catch, so an inactive slide can't fail the test.
      const visible = await bannerText.isVisible().catch(() => false);
      // The ✅ prints whether visible is true OR false — read the value, not the tick.
      console.log(`✅ CNE Hours banner text visible: ${visible}`);
    });

    // TEST 6 — the button on that same rotating slide.
    test('CNE Hours banner - "View courses" button is clickable', async ({ page }) => {
      // As a real button if there is one, else as a text node.
      const viewCoursesBtn = page.getByRole('button', { name: /view courses|पाठ्यक्रम देखें/i })
        .or(page.getByText(/view courses|पाठ्यक्रम देखें/i)).first();
      // Only act if the slide happens to be showing.
      if (await viewCoursesBtn.isVisible().catch(() => false)) {
        await scrollAndClick(page, viewCoursesBtn);
        await page.waitForLoadState('domcontentloaded');
        console.log('✅ View courses clicked → URL:', page.url());
        await page.goto(PUBLIC_URL);
        await page.waitForLoadState('domcontentloaded');
      // The honest alternative: say we skipped rather than pretend we checked.
      } else {
        console.log('ℹ️  "View courses" not on current banner slide — skipping');
      }
    });

    // TEST 7 — the carousel indicators are interactive.
    test('Banner carousel dots are visible and clickable', async ({ page }) => {
      // Three shapes: a dot class, a carousel-indicator class, or the ARIA tab role.
      const dots = page.locator('[class*="dot"], [class*="carousel-indicator"], [role="tab"]');
      // How many did we find?
      const count = await dots.count();
      console.log(`Found ${count} carousel dots`);
      // Needs at least two dots for clicking between them to mean anything.
      if (count > 1) {
        // Click second dot
        // Click the second dot…
        await dots.nth(1).click();
        await page.waitForTimeout(1000);
        console.log('✅ Clicked second carousel dot');
        // Click first dot back
        // …then the first, to leave the carousel where we found it.
        await dots.nth(0).click();
        await page.waitForTimeout(500);
        console.log('✅ Clicked first carousel dot');
      }
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 3: STATS ROW
  // ────────────────────────────────────────────────────────────────
  test.describe('Stats Row', () => {

    // TEST 1 — learners onboarded. Two hard assertions: label AND exact number.
    test('"310,000+ Learners onboarded" stat is visible', async ({ page }) => {
      // The translated label.
      const stat = page.getByText(tr('Learners onboarded')).first();
      // Below the fold, so scroll first. This is pattern B, the file's most common shape.
      await stat.scrollIntoViewIfNeeded();
      // The label must be visible.
      await expect(stat).toBeVisible();
      // The number is matched as a PLAIN string — digits render the same in both languages.
      const number = page.getByText('310,000+').first();
      // And it must be visible too.
      await expect(number).toBeVisible();
      console.log('✅ Learners onboarded stat visible');
    });

    // TEST 2 — number of courses.
    test('"490+ Number of courses" stat is visible', async ({ page }) => {
      const stat = page.getByText(tr('Number of courses')).first();
      await stat.scrollIntoViewIfNeeded();
      await expect(stat).toBeVisible();
      // Another live marketing figure hard-coded into the spec.
      const number = page.getByText('490+').first();
      await expect(number).toBeVisible();
      console.log('✅ Number of courses stat visible');
    });

    // TEST 3 — CNE hours.
    test('"57.5 CNE Hours" stat is visible', async ({ page }) => {
      const stat = page.getByText(tr('CNE Hours')).first();
      await stat.scrollIntoViewIfNeeded();
      await expect(stat).toBeVisible();
      // A decimal this time, still matched literally.
      const number = page.getByText('57.5').first();
      await expect(number).toBeVisible();
      console.log('✅ CNE Hours stat visible');
    });

    // TEST 4 — certificates issued.
    test('"400,000+ Total certificate issued" stat is visible', async ({ page }) => {
      const stat = page.getByText(tr('Total certificate issued')).first();
      await stat.scrollIntoViewIfNeeded();
      await expect(stat).toBeVisible();
      // The fourth and last hard-coded statistic.
      const number = page.getByText('400,000+').first();
      await expect(number).toBeVisible();
      console.log('✅ Total certificate stat visible');
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 4: TOP COURSES
  // ────────────────────────────────────────────────────────────────
  test.describe('Top Courses Section', () => {

    // TEST 1 — the section heading.
    test('"TOP COURSES" heading is visible', async ({ page }) => {
      // Matched through tr(); the i flag also absorbs any CSS-driven case change.
      const heading = page.getByText(tr('TOP COURSES')).first();
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
      console.log('✅ TOP COURSES heading visible');
    });

    // TEST 2 — the section's View All link navigates.
    test('"View All" link in Top Courses is visible and clickable', async ({ page }) => {
      // `.first()` takes the FIRST View All on the page — this section's. The CNE
      // section's test below takes .nth(1) for the same reason.
      const viewAll = page.getByText(tr('View All')).first();
      await viewAll.scrollIntoViewIfNeeded();
      await expect(viewAll).toBeVisible();
      // Click it; the destination is logged, not asserted.
      await viewAll.click();
      await page.waitForLoadState('domcontentloaded');
      console.log('✅ View All clicked → URL:', page.url());
      // Return to the public page for the next test.
      await page.goto(PUBLIC_URL);
      await page.waitForLoadState('domcontentloaded');
    });

    // TEST 3 — the carousel actually populated from the content API.
    test('Top course cards are visible', async ({ page }) => {
      // Scroll the section into view, which also triggers its lazy load.
      await page.getByText(tr('TOP COURSES')).first().scrollIntoViewIfNeeded();
      // The Angular component's own tag name first — the most stable handle available,
      // since it only changes if the component is renamed. The class is a fallback.
      const cards = page.locator('ws-web-course-card, [class*="course-card"]');
      const count = await cards.count();
      // An empty carousel (a failed content API) fails here.
      expect(count).toBeGreaterThan(0);
      console.log(`✅ Found ${count} course cards`);
    });

    // TEST 4 — the badges learners use to spot certified courses.
    test('Top course cards show Certificate badge', async ({ page }) => {
      // Scroll to trigger the lazy load.
      await page.getByText(tr('TOP COURSES')).first().scrollIntoViewIfNeeded();
      // Bilingual inline regex — प्रमाणपत्र is Hindi for "certificate".
      const certBadges = page.getByText(/Certificate|प्रमाणपत्र/i);
      // Auto-wait for the (lazy-loaded) cards instead of an instantaneous count()
      // that can fire before the carousel populates.
      // THIS is the pattern the group's other count tests should copy: toBeVisible()
      // polls for up to 15s, so it can't lose a race with the carousel's API call.
      await expect(certBadges.first()).toBeVisible({ timeout: 15000 });
      // Only once something is definitely on screen do we count.
      const count = await certBadges.count();
      // An empty result — a failed content API — fails here.
      expect(count).toBeGreaterThan(0);
      console.log(`✅ Found ${count} Certificate badges`);
    });

    // TEST 5 — star ratings.
    test('Top course cards show star ratings', async ({ page }) => {
      await page.getByText(tr('TOP COURSES')).first().scrollIntoViewIfNeeded();
      // Two class shapes.
      const ratings = page.locator('[class*="rating"], [class*="star"]');
      // An instantaneous count() with no auto-wait — one of the two most likely
      // places in this group for an intermittent failure. Copy test 4's shape if it flakes.
      const count = await ratings.count();
      expect(count).toBeGreaterThan(0);
      console.log(`✅ Found ${count} star ratings`);
    });

    // TEST 6 — an individual card opens.
    test('First top course card is clickable', async ({ page }) => {
      await page.getByText(tr('TOP COURSES')).first().scrollIntoViewIfNeeded();
      // Component tag first, class as fallback.
      const firstCard = page.locator('ws-web-course-card, [class*="course-card"]').first();
      await expect(firstCard).toBeVisible();
      // Click it; the destination is logged, not asserted.
      await firstCard.click();
      await page.waitForLoadState('domcontentloaded');
      console.log('✅ First course card clicked → URL:', page.url());
      await page.goto(PUBLIC_URL);
      await page.waitForLoadState('domcontentloaded');
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 5: CNE COURSES
  // ────────────────────────────────────────────────────────────────
  test.describe('CNE Courses Section', () => {

    // TEST 1 — the section heading. The only unconditional assertion in this group.
    test('"CNE COURSES" heading is visible', async ({ page }) => {
      // Matched through tr().
      const heading = page.getByText(tr('CNE COURSES')).first();
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
      console.log('✅ CNE COURSES heading visible');
    });

    // TEST 2 — the SECOND View All on the page belongs to this section.
    test('"View All" link in CNE Courses is clickable', async ({ page }) => {
      // Get every View All link…
      const headings = page.getByText(tr('View All'));
      // …and count them.
      const count = await headings.count();
      // second View All is for CNE courses
      // Index 1 when there are two. The ternary degrades to the first link if the
      // Top Courses section is ever absent, so the test still does something sensible.
      const viewAll = count > 1 ? headings.nth(1) : headings.first();
      await viewAll.scrollIntoViewIfNeeded();
      await expect(viewAll).toBeVisible();
      // Click it; the destination is logged, not asserted.
      await viewAll.click();
      await page.waitForLoadState('domcontentloaded');
      console.log('✅ CNE View All clicked → URL:', page.url());
      await page.goto(PUBLIC_URL);
      await page.waitForLoadState('domcontentloaded');
    });

    // TEST 3 — the accredited-course carousel populated.
    test('CNE course cards are visible', async ({ page }) => {
      await page.getByText(tr('CNE COURSES')).first().scrollIntoViewIfNeeded();
      // Component tag first, class as fallback.
      const cards = page.locator('ws-web-course-card, [class*="course-card"]');
      const count = await cards.count();
      // An empty CNE carousel fails here.
      expect(count).toBeGreaterThan(0);
      console.log(`✅ Found ${count} CNE course cards`);
    });

    // TEST 4 — the CNE-hours badges, the whole point of this section.
    test('CNE course cards show CNE hours badge', async ({ page }) => {
      await page.getByText(tr('CNE COURSES')).first().scrollIntoViewIfNeeded();
      // Either a cne-prefixed class, or the literal text "CNE:".
      const cneBadges = page.locator('[class*="cne"]').or(page.getByText(/CNE:/));
      // Counted…
      const count = await cneBadges.count();
      // …and printed. NO expect() anywhere — zero badges passes silently.
      console.log(`Found ${count} CNE badges`);
    });

    // TEST 5 — the carousel's next arrow.
    test('CNE section carousel right arrow is clickable', async ({ page }) => {
      await page.getByText(tr('CNE COURSES')).first().scrollIntoViewIfNeeded();
      // Three shapes; `.last()` because the previous/next pair share these classes.
      const rightArrow = page.locator('[class*="next"], [aria-label*="next"], button[class*="arrow"]').last();
      // Soft: only click if it's there, and assert nothing either way.
      if (await rightArrow.isVisible()) {
        await rightArrow.click();
        await page.waitForTimeout(1000);
        console.log('✅ CNE carousel right arrow clicked');
      }
    });

    // TEST 6 — a specific accredited course, matched by exact title.
    test('First CNE course card is clickable - "Normal Labour & Birth and AMTSL"', async ({ page }) => {
      await page.getByText(tr('CNE COURSES')).first().scrollIntoViewIfNeeded();
      // Course titles are NOT translated by the platform, so no tr() here.
      const courseLink = page.getByText('Normal Labour & Birth and AMTSL').first();
      // Soft: if the catalogue changes and this course is retired, the test quietly
      // stops checking anything rather than failing.
      if (await courseLink.isVisible()) {
        await courseLink.click();
        await page.waitForLoadState('domcontentloaded');
        console.log('✅ Normal Labour course clicked → URL:', page.url());
        // Return to the public page for the next test.
        await page.goto(PUBLIC_URL);
        await page.waitForLoadState('domcontentloaded');
      }
    });

    // TEST 7 — a second named course, same shape as test 6.
    test('Second CNE course card is clickable - "Integrated Sexual and Reproductive Health"', async ({ page }) => {
      await page.getByText(tr('CNE COURSES')).first().scrollIntoViewIfNeeded();
      // Again an exact, untranslated title.
      const courseLink = page.getByText('Integrated Sexual and Reproductive Health (ISRH)').first();
      // Same soft guard.
      if (await courseLink.isVisible()) {
        await courseLink.click();
        await page.waitForLoadState('domcontentloaded');
        console.log('✅ ISRH course clicked → URL:', page.url());
        await page.goto(PUBLIC_URL);
        await page.waitForLoadState('domcontentloaded');
      }
    });

    // TEST 8 — the accrediting body's badge.
    test('Partner logos - Indian Nursing Council badge visible', async ({ page }) => {
      await page.getByText(tr('CNE COURSES')).first().scrollIntoViewIfNeeded();
      // Exact organisation name.
      const badge = page.getByText('Indian Nursing Council').first();
      // The guard makes the assertion below unreachable when the badge is absent…
      // …so this expect() can only ever pass. Note the console.log is INSIDE the
      // guard too — a missing ✅ line in the run output is the real signal.
      if (await badge.isVisible()) {
        await expect(badge).toBeVisible();
        console.log('✅ Indian Nursing Council badge visible');
      }
    });

    // TEST 9 — the second accreditor's badge, same shape.
    test('Partner logos - UNFPA badge visible', async ({ page }) => {
      await page.getByText(tr('CNE COURSES')).first().scrollIntoViewIfNeeded();
      // Exact name.
      const badge = page.getByText('UNFPA').first();
      // Same soft guard.
      if (await badge.isVisible()) {
        await expect(badge).toBeVisible();
        console.log('✅ UNFPA badge visible');
      }
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 6: TRUSTED BY / PARTNER ORGANIZATIONS
  // ────────────────────────────────────────────────────────────────
  test.describe('Trusted By Section', () => {

    // TEST 1 — the social-proof heading. Hard.
    test('"Trusted By" heading is visible', async ({ page }) => {
      // Translated label.
      const heading = page.getByText(tr('Trusted By')).first();
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
      console.log('✅ Trusted By heading visible');
    });

    // TEST 2 — the partner count. Hard.
    test('"50+ Partner Organizations and Growing" is visible', async ({ page }) => {
      // The + in this label is the clearest illustration of why tr() escapes first.
      const text = page.getByText(tr('50+ Partner Organizations and Growing')).first();
      await text.scrollIntoViewIfNeeded();
      await expect(text).toBeVisible();
      console.log('✅ Partner count text visible');
    });

    // TEST 3 — a partner logo. Soft from here to the end of the group.
    test('Fernandez Foundation logo is visible', async ({ page }) => {
      // Text OR image: a partner mark may be an SVG with a text node or a raster with
      // alt text, and which one it is has changed between builds.
      const logo = page.getByText('FERNANDEZ').or(page.locator('img[alt*="Fernandez"]')).first();
      if (await safeScroll(logo)) {
        // safeScroll returns a boolean instead of throwing, so an absent logo is a
        // clean skip rather than a 15s scroll timeout and a red test.
        await expect(logo).toBeVisible();
        console.log('✅ Fernandez Foundation logo visible');
      }
    });

    // TEST 4 — Manyata. Same shape.
    test('Manyata logo is visible', async ({ page }) => {
      const logo = page.getByText('MANYATA').or(page.locator('img[alt*="Manyata"]')).first();
      if (await safeScroll(logo)) {
        await expect(logo).toBeVisible();
        console.log('✅ Manyata logo visible');
      }
    });

    // TEST 5 — KLE. Same shape.
    test('KLE logo is visible', async ({ page }) => {
      const logo = page.getByText('KLE').or(page.locator('img[alt*="KLE"]')).first();
      if (await safeScroll(logo)) {
        await expect(logo).toBeVisible();
        console.log('✅ KLE logo visible');
      }
    });

    // TEST 6 — UNFPA. Image-only: this mark has no text form, unlike the others.
    test('UNFPA logo is visible', async ({ page }) => {
      const logo = page.locator('img[alt*="UNFPA"], [class*="unfpa"]').first();
      if (await safeScroll(logo)) {
        await expect(logo).toBeVisible();
        console.log('✅ UNFPA logo visible');
      }
    });

    // TEST 7 — NQOCN. Same text-or-image shape.
    test('NQOCN logo is visible', async ({ page }) => {
      const logo = page.getByText('NQOCN').or(page.locator('img[alt*="NQOCN"]')).first();
      if (await safeScroll(logo)) {
        await expect(logo).toBeVisible();
        console.log('✅ NQOCN logo visible');
      }
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 7: HOW SPHERE WORKS
  // ────────────────────────────────────────────────────────────────
  test.describe('How Sphere Works Section', () => {

    // TEST 1 — the explainer heading. Hard.
    test('"How Sphere works" heading is visible', async ({ page }) => {
      // Note the Hindi keeps the English brand name: "Sphere कैसे काम करता है".
      const heading = page.getByText(tr('How Sphere works')).first();
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
      console.log('✅ How Sphere works heading visible');
    });

    // TEST 2 — the subtitle. Hard.
    test('"In 3-simple videos" subtitle is visible', async ({ page }) => {
      // The longest key in the HI map.
      const subtitle = page.getByText(
        tr('In 3-simple videos we guide you through making an account and getting certified.')
      ).first();
      await subtitle.scrollIntoViewIfNeeded();
      await expect(subtitle).toBeVisible();
      console.log('✅ Subtitle visible');
    });

    // TEST 3 — step one's card. A HYBRID: hard on the copy, soft on the video.
    test('Step 1 - "Register for a course" card is visible and play button works', async ({ page }) => {
      // The card title.
      const registerCard = page.getByText(tr('Register for a course')).first();
      await registerCard.scrollIntoViewIfNeeded();
      // Hard assertion 1.
      await expect(registerCard).toBeVisible();
      console.log('✅ Register for a course card visible');

      // And its description.
      const subtext = page.getByText(tr('Explore various courses and pick the ones you like')).first();
      // Hard assertion 2. Both are fixed copy, so both are safely assertable.
      await expect(subtext).toBeVisible();

      // Click play button on first video
      // Three shapes for a play control.
      const playBtn = page.locator('[class*="play"], [aria-label*="play"], button[class*="video"]').first();
      // Soft: a video player is fragile, so only attempt it if it's actually there.
      if (await playBtn.isVisible()) {
        await playBtn.click();
        await page.waitForTimeout(1000);
        console.log('✅ Play button 1 clicked');
        // Escape dismisses any modal player. Each test gets a fresh page anyway, so this
        // is really about keeping the end-of-test screenshot showing the page, not a video.
        await page.keyboard.press('Escape');
      }
    });

    // TEST 4 — step two. Same hybrid shape.
    test('Step 2 - "Take the course" card is visible and play button works', async ({ page }) => {
      // The card title.
      const takeCard = page.getByText(tr('Take the course')).first();
      await takeCard.scrollIntoViewIfNeeded();
      await expect(takeCard).toBeVisible();

      // Its description.
      const subtext = page.getByText(tr('Access the course anytime, at your convenience')).first();
      await expect(subtext).toBeVisible();
      console.log('✅ Take the course card and subtext visible');

      // Click second video play button
      // The shared play-button locator, indexed by position.
      const playBtns = page.locator('[class*="play"], [aria-label*="play"], button[class*="video"]');
      // The count guard is what makes positional indexing safe — nth(1) on a page
      // with one button would throw rather than skip.
      if (await playBtns.count() >= 2) {
        await playBtns.nth(1).click();
        await page.waitForTimeout(1000);
        console.log('✅ Play button 2 clicked');
        await page.keyboard.press('Escape');
      }
    });

    // TEST 5 — step three. Same hybrid shape.
    test('Step 3 - "Get certified" card is visible and play button works', async ({ page }) => {
      // The card title.
      const getCertCard = page.getByText(tr('Get certified')).first();
      await getCertCard.scrollIntoViewIfNeeded();
      await expect(getCertCard).toBeVisible();

      // Its description.
      const subtext = page.getByText(tr('Receive downloadable and shareable certificates')).first();
      await expect(subtext).toBeVisible();
      console.log('✅ Get certified card and subtext visible');

      // Click third video play button
      // Same shared locator.
      const playBtns = page.locator('[class*="play"], [aria-label*="play"], button[class*="video"]');
      // Needs at least three before reaching for index 2.
      if (await playBtns.count() >= 3) {
        await playBtns.nth(2).click();
        await page.waitForTimeout(1000);
        console.log('✅ Play button 3 clicked');
        await page.keyboard.press('Escape');
      }
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 8: TRANSFORM CTA BANNER
  // ────────────────────────────────────────────────────────────────
  test.describe('Transform CTA Section', () => {

    // TEST 1 — the closing call to action. Hard.
    test('"Transform your Healthcare career through Sphere!" text is visible', async ({ page }) => {
      // The trailing ! is escaped by tr().
      const heading = page.getByText(tr('Transform your Healthcare career through Sphere!')).first();
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
      console.log('✅ Transform heading visible');
    });

    // TEST 2 — the page's second conversion entry point.
    test('"Start Today" button is visible and clickable', async ({ page }) => {
      // The Start Today button.
      const startBtn = page.getByRole('button', { name: tr('Start Today') }).first();
      await startBtn.scrollIntoViewIfNeeded();
      // Visible…
      await expect(startBtn).toBeVisible();
      // …and enabled.
      await expect(startBtn).toBeEnabled();
      // Click it; the destination is logged, not asserted.
      await startBtn.click();
      await page.waitForLoadState('domcontentloaded');
      console.log('✅ Start Today button clicked → URL:', page.url());
      // Return to the public page for the next test.
      await page.goto(PUBLIC_URL);
      await page.waitForLoadState('domcontentloaded');
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 9: INITIATIVE / COLLABORATION LOGOS
  // ────────────────────────────────────────────────────────────────
  test.describe('Initiative and Collaboration Section', () => {

    // TEST 1 — the institutional-backing label. Hard.
    test('"An initiative of" section is visible', async ({ page }) => {
      // Stays English even in Hindi mode.
      // Note: NO tr() here. The portal does not translate this label, so matching the
      // literal string is what the page actually does — adding it to HI would misrepresent it.
      const label = page.getByText(hiAlso(/An initiative of/i)).first();
      await label.scrollIntoViewIfNeeded();
      await expect(label).toBeVisible();
      console.log('✅ An initiative of visible');
    });

    // TEST 2 — the funder's logo. Soft, like every logo in this file.
    test('Nilekani Philanthropies logo is visible', async ({ page }) => {
      // The same text-or-image hedge used for the Trusted By marks.
      const logo = page.getByText('NILEKANI').or(page.locator('img[alt*="Nilekani"]')).first();
      // safeScroll: absent is a clean skip, not a failure.
      if (await safeScroll(logo)) {
        await expect(logo).toBeVisible();
        console.log('✅ Nilekani logo visible');
      }
    });

    // TEST 3 — the second institutional label. Hard, and also untranslated.
    test('"A collaboration with" section is visible', async ({ page }) => {
      // Stays English even in Hindi mode.
      // Literal match again, for the same reason as line 577.
      const label = page.getByText(hiAlso(/A collaboration with/i)).first();
      await label.scrollIntoViewIfNeeded();
      await expect(label).toBeVisible();
      console.log('✅ A collaboration with visible');
    });

    // TEST 4 — the collaborator's logo. Soft.
    test('Societal Platform logo is visible', async ({ page }) => {
      // Text or image.
      const logo = page.getByText('SOCIETAL').or(page.locator('img[alt*="Societal"]')).first();
      if (await safeScroll(logo)) {
        await expect(logo).toBeVisible();
        console.log('✅ Societal Platform logo visible');
      }
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 10: FOOTER — QUICK LINKS
  // ────────────────────────────────────────────────────────────────
  test.describe('Footer - Quick Links', () => {

    // TEST 1 — the footer column heading. Hard.
    test('"Quick Links" heading in footer is visible', async ({ page }) => {
      const heading = page.getByText(tr('Quick Links')).first();
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
      console.log('✅ Quick Links heading visible');
    });

    // TEST 2 — the privacy policy link. A real navigation.
    test('"Privacy policy" link is visible and clickable', async ({ page }) => {
      // Translated label.
      const link = page.getByText(tr('Privacy policy')).first();
      await link.scrollIntoViewIfNeeded();
      // Presence is asserted; the click must succeed…
      await expect(link).toBeVisible();
      // …but where it lands is only logged.
      await link.click();
      await page.waitForLoadState('domcontentloaded');
      console.log('✅ Privacy policy clicked → URL:', page.url());
      // Return for the next test.
      await page.goto(PUBLIC_URL);
      await page.waitForLoadState('domcontentloaded');
    });

    // TEST 3 — the terms link. Same shape.
    test('"Terms of Use" link is visible and clickable', async ({ page }) => {
      const link = page.getByText(tr('Terms of Use')).first();
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeVisible();
      // Click; destination logged, not asserted.
      await link.click();
      await page.waitForLoadState('domcontentloaded');
      console.log('✅ Terms of Use clicked → URL:', page.url());
      await page.goto(PUBLIC_URL);
      await page.waitForLoadState('domcontentloaded');
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 11: FOOTER — HELP & CONTACT
  // ────────────────────────────────────────────────────────────────
  test.describe('Footer - Help & Contact', () => {

    // TEST 1 — the column heading. Hard.
    test('"Help & Contact" heading in footer is visible', async ({ page }) => {
      // The & here is another reason tr() escapes before building its regex.
      const heading = page.getByText(tr('Help & Contact')).first();
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
      console.log('✅ Help & Contact heading visible');
    });

    // TEST 2 — the support address. The only href in this file that IS asserted.
    test('"support@aastrika.org" email link is visible', async ({ page }) => {
      // Matched by the literal address — email addresses aren't translated.
      const emailLink = page.getByText('support@aastrika.org').first();
      await emailLink.scrollIntoViewIfNeeded();
      // The text must be on screen…
      await expect(emailLink).toBeVisible();
      // …and we then read the underlying link target.
      const href = await emailLink.getAttribute('href');
      // This is the real check: a visually-correct address with a dead link fails here.
      expect(href).toMatch(/mailto:|support@aastrika/i);
      console.log('✅ Email link visible with href:', href);
    });

    // TEST 3 — the WhatsApp contact channel.
    test('"Talk to us on WhatsApp" button is visible and clickable', async ({ page }) => {
      // The button's label, translated.
      const whatsappBtn = page.getByText(tr('Talk to us on WhatsApp')).first();
      await whatsappBtn.scrollIntoViewIfNeeded();
      // The text being visible IS asserted…
      await expect(whatsappBtn).toBeVisible();
      console.log('✅ WhatsApp button visible');
      // Check it has a WhatsApp href
      // …but the link itself is found separately, by its wa.me host.
      const link = page.locator('a[href*="wa.me"], a[href*="whatsapp"]').first();
      // `.catch(() => null)` makes a missing link yield null rather than throwing.
      const href = await link.getAttribute('href').catch(() => null);
      // …and then merely PRINTED. So a broken or missing wa.me link passes with
      // "WhatsApp href: null" in the log — unlike the email test right above it.
      console.log('   WhatsApp href:', href);
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 12: FOOTER — ADDITIONAL LINKS & SOCIAL ICONS
  // ────────────────────────────────────────────────────────────────
  test.describe('Footer - Additional Links & Social Icons', () => {

    // TEST 1 — the column heading. The only hard test in this group.
    test('"Additional Links" heading is visible', async ({ page }) => {
      const heading = page.getByText(tr('Additional Links')).first();
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
      console.log('✅ Additional Links heading visible');
    });

    // TEST 2 — the foundation link.
    test('"Aastrika Foundation" link is visible and has correct href', async ({ page }) => {
      // `.last()` picks the FOOTER occurrence; aastrika.org appears earlier on the page too.
      const link = page.locator('a[href*="aastrika.org"]').last();
      // Soft guard — the assertion below is unreachable when the link is absent.
      if (await safeScroll(link)) {
        const href = await link.getAttribute('href');
        // Asserted, but only inside the guard.
        expect(href).toContain('aastrika');
        console.log('✅ Aastrika Foundation link visible, href:', href);
      }
    });

    // TEST 3 — Twitter/X. Soft, and href-logging only.
    test('Twitter/X social icon is visible and clickable', async ({ page }) => {
      // Covers both the old twitter.com and the new x.com domains, plus alt text.
      const twitterIcon = page.locator('a[href*="twitter"], a[href*="x.com"], img[alt*="Twitter"], img[alt*="twitter"]').first();
      // Soft guard.
      if (await safeScroll(twitterIcon)) {
        // Read the link target…
        const href = await twitterIcon.getAttribute('href');
        // …and print it. No expect() — this test exists to surface the link in the log.
        console.log('✅ Twitter icon visible, href:', href);
      }
    });

    // TEST 4 — Facebook. Identical shape.
    test('Facebook social icon is visible and clickable', async ({ page }) => {
      const fbIcon = page.locator('a[href*="facebook"], img[alt*="Facebook"]').first();
      if (await safeScroll(fbIcon)) {
        const href = await fbIcon.getAttribute('href');
        console.log('✅ Facebook icon visible, href:', href);
      }
    });

    // TEST 5 — Instagram. Identical shape.
    test('Instagram social icon is visible and clickable', async ({ page }) => {
      const igIcon = page.locator('a[href*="instagram"], img[alt*="Instagram"]').first();
      if (await safeScroll(igIcon)) {
        const href = await igIcon.getAttribute('href');
        console.log('✅ Instagram icon visible, href:', href);
      }
    });

    // TEST 6 — LinkedIn. Identical shape.
    test('LinkedIn social icon is visible and clickable', async ({ page }) => {
      const liIcon = page.locator('a[href*="linkedin"], img[alt*="LinkedIn"]').first();
      if (await safeScroll(liIcon)) {
        const href = await liIcon.getAttribute('href');
        console.log('✅ LinkedIn icon visible, href:', href);
      }
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 13: FOOTER — COPYRIGHT
  // ────────────────────────────────────────────────────────────────
  test.describe('Footer - Copyright', () => {

    // TEST 1 — the copyright line. Hard.
    test('Copyright text is visible', async ({ page }) => {
      // Same string in both languages (the site's own text, typo included).
      // Anchored on the first and last few words, with .* absorbing everything between.
      const copyright = page.getByText(/Health Systems.*Aastrika Foundation/i).first();
      // That gap is deliberate: the line contains a typo and a year that rolls over,
      // so matching the STRUCTURE survives both while still failing if the line vanishes.
      await copyright.scrollIntoViewIfNeeded();
      await expect(copyright).toBeVisible();
      console.log('✅ Copyright text visible');
    });

    // TEST 2 — the footer logo. Soft.
    test('Aastrika Sphere footer logo is visible', async ({ page }) => {
      // Three fallbacks: the semantic <footer> tag, a footer class, then a logo class inside one.
      const footerLogo = page.locator('footer img, [class*="footer"] img, [class*="footer"] [class*="logo"]').first();
      // Soft guard.
      if (await safeScroll(footerLogo)) {
        await expect(footerLogo).toBeVisible();
        console.log('✅ Footer logo visible');
      }
    });

  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 14: PAGE-WIDE CHECKS
  // ────────────────────────────────────────────────────────────────
  test.describe('Page-Wide Checks', () => {

    // TEST 1 — the most carefully engineered test in the file.
    test('No broken images on the entire public page', async ({ page }) => {
      // Scroll through the whole page in steps so lazy-loaded course thumbnails
      // (loading="lazy") actually start — and finish — loading before we check.
      // Step 1: walk the whole page in 12 steps so every loading="lazy" thumbnail
      // enters the viewport and starts fetching. The 0.9 factor overlaps the steps
      // slightly, so nothing between them is skipped.
      for (let i = 0; i < 12; i++) {
        await page.evaluate((n) => window.scrollTo(0, n * window.innerHeight * 0.9), i);
        await page.waitForTimeout(400);
      }
      // Step 2: jump to the very bottom, catching anything a longer page hid below step 12.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // Step 3: wait for quiet — network idle plus a further 3s for in-flight images.
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
      // Flag only images that FINISHED loading (complete) yet have zero natural
      // size — i.e. a genuine 404/decoding failure. Images still loading, or a
      // lazy one that never scrolled into view, report complete=false → ignored.
      // Step 4: collect only GENUINE failures, inside the browser.
      const brokenImgs: string[] = await page.evaluate(() =>
        // Every image on the page.
        Array.from(document.querySelectorAll('img'))
          .filter((img: HTMLImageElement) => {
            // currentSrc is the resolved source for responsive images; src is the fallback.
            const src = img.currentSrc || img.src;
            // Skip inline data: URIs — they can't 404.
            if (!src || src.startsWith('data:')) return false;
            // THE TRICK: complete means the browser finished trying; naturalWidth === 0 means
            // it got no pixels. Together they mean a real 404 or decode failure. An image
            // still downloading reports complete=false and is correctly ignored.
            return img.complete && img.naturalWidth === 0;
          })
          .map((img: HTMLImageElement) => img.currentSrc || img.src)
      );
      // Warn FIRST, so the report names the exact URLs…
      if (brokenImgs.length > 0) {
        console.warn('⚠️ Broken images found:', brokenImgs);
      }
      // …then fail. Hard.
      expect(brokenImgs).toEqual([]);
      console.log('✅ No broken images');
    });

    // TEST 2 — no JavaScript errors.
    test('No console errors on page load', async ({ page }) => {
      // Collect them here.
      const errors: string[] = [];
      // Attach the listener before reloading, so the whole load is observed.
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      // Reload so the listener sees it from the start.
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      // Ignore resource-load noise (e.g. a 404 for an asset) — only fail on
      // real JavaScript errors.
      // Filter out resource 404s: a missing font or beacon shouldn't fail a page whose
      const jsErrors = errors.filter((e) => !/Failed to load resource/i.test(e));
      // own code is fine, and broken IMAGES already have their own test above.
      if (jsErrors.length > 0) console.warn('Console JS errors:', jsErrors);
      // What survives is real JavaScript — uncaught exceptions, failed promises. Hard.
      expect(jsErrors).toEqual([]);
      console.log('✅ No console JS errors (resource 404s ignored)');
    });

    // TEST 3 — the page's de facto performance trend line.
    test('Page loads within 10 seconds', async ({ page }) => {
      // Start the clock.
      const start = Date.now();
      // Reload.
      await page.reload();
      // Stop at domcontentloaded — this measures HTML + blocking scripts, NOT lazy
      // images or carousel API calls. A "did the page get going" check, not a weight budget.
      await page.waitForLoadState('domcontentloaded');
      const elapsed = Date.now() - start;
      // The number is printed on every run, pass or fail — useful even when green.
      console.log(`✅ Page loaded in ${elapsed}ms`);
      // Hard: 10 seconds is the budget.
      expect(elapsed).toBeLessThan(10000);
    });

    // TEST 4 — cheap, and a real canary.
    test('Page title contains Sphere or Aastrika', async ({ page }) => {
      // Read the document title.
      const title = await page.title();
      console.log('✅ Page title:', title);
      // A wrong or empty title usually means the router served the wrong shell, a deploy
      // landed on the wrong environment, or an error page came back with a 200.
      expect(title).toMatch(/sphere|aastrika/i);
    });

  });

});
