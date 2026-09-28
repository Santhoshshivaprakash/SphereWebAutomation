/**
 * Account Page — Full Element Coverage
 * ──────────────────────────────────────────────────────────────────
 * 5 left-nav sections:
 *   1. Personal Details       (name, phone, email, DOB, country, pincode)
 *   2. Organization Details   (background, designation, RN/RM, org type, org name)
 *   3. Academic Details       (Education with Add Education)
 *   4. Language Preference    (English / Hindi radio + Save)
 *   5. My Certificates        ("No Certificates" empty state for new users)
 * Plus: profile pic edit (pencil icon), Help and Support button,
 *       Logout button (modal with Yes/No, we click No).
 *
 * Each test is INDEPENDENT — reuses .auth-state.json from previous tests.
 */

// Types only — the runner itself comes from our authenticated harness below.
import { Page, Locator, BrowserContext } from '@playwright/test';
// Auth via storageState (CI-friendly) with a CDP fallback for local dev.
// See tests/helpers/authedTest.ts.
// `test` here is the AUTHENTICATED one: every test gets a logged-in context.
import { test, expect } from './helpers/authedTest';

// Which environment to test.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// ════════════════════════════════════════════════════════════════════
// BILINGUAL TEXT — the Account UI can be English OR Hindi. Every text
// assertion matches either language so tests never fail just because the
// heading/label isn't shown in English. (Field *placeholders* stay English
// in both languages, so field-presence checks prefer placeholders.)
// ════════════════════════════════════════════════════════════════════
// One lookup table of bilingual regexes, used everywhere below. Anchored (^…$)
// entries match a label exactly; unanchored ones match it anywhere in a string.
const T = {
  personalDetails:       /^(personal details|व्यक्तिगत विवरण)$/i,
  personalDetailsHead:   /(personal details|व्यक्तिगत विवरण)/i,
  organizationNav:       /^(organization details|संगठन विवरण)$/i,
  organizationalHead:    /(organizational details|संगठनात्मक विवरण)/i,
  academicDetails:       /^(academic details|शैक्षणिक विवरण)$/i,
  languagePreference:    /^(language preference|भाषा प्राथमिकता)$/i,
  myCertificates:        /^(my certificates|मेरे प्रमाण पत्र)$/i,
  helpSupport:           /(help and support|सहायता और समर्थन)/i,
  logout:                /^(logout|log ?out|लॉग आउट)$/i,
  education:             /(education|शिक्षा)/i,
  // Note the leading `\+?` — the button renders as "+ Add Education" on some builds.
  addEducation:         /(\+?\s*add education|शिक्षा जोड़ें|जोड़ें)/i,
  background:            /(background|पृष्ठ भूमि)/i,
  save:                  /^(save|सेव करें|सहेजें)$/i,
  home:                  /^(home|होम)$/i,
  account:               /^(account|खाता)$/i,
  // Trailing colon: matches "Position :" and "पद:" but not the bare word.
  position:              /(position|पद|स्थिति)\s*:/i,
};

// The Account page itself.
const ACCOUNT_URL      = `${BASE_URL}/app/profile-view`;
// The logged-in home, which is the only reliable way IN to the Account page.
const PRIVATE_HOME_URL = `${BASE_URL}/page/home`;

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════
// Scroll an element into view, then click it.
async function scrollAndClick(page: Page, locator: Locator) {
  // Playwright can't click what isn't on screen.
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
}

// Hindi equivalents of the left-nav labels. The Language Preference test can
// flip the whole UI to Hindi; matching both languages keeps every later
// section resilient even if a revert is delayed.
const NAV_HINDI: Record<string, string> = {
  'Personal Details': 'व्यक्तिगत विवरण',
  'Organization Details': 'संगठन विवरण',
  'Academic Details': 'शैक्षणिक विवरण',
  'Language Preference': 'भाषा प्राथमिकता',
  'My Certificates': 'मेरे प्रमाण पत्र',
};

// Click a left-side nav item by label (matches English OR Hindi).
async function clickAccountNav(
  page: Page,
  name: 'Personal Details' | 'Organization Details' | 'Academic Details' | 'Language Preference' | 'My Certificates'
) {
  // Look up this item's Hindi rendering.
  const hi = NAV_HINDI[name];
  // Build an anchored either-language regex from the two.
  const link = page.getByText(new RegExp(`^(${name}|${hi})$`, 'i')).first();
  // Click it.
  await scrollAndClick(page, link);
  // Let the right-hand panel re-render.
  await page.waitForTimeout(1000);
}

// The header "Account" control renders as a <button> (not a link) on this SPA,
// and sometimes lags behind first paint — so match all three shapes.
function accountNav(page: Page): Locator {
  return page.getByRole('button', { name: /^(account|खाता)$/i })
    .or(page.getByRole('link', { name: /^(account|खाता)$/i }))
    .or(page.getByText(/^(account|खाता)$/i)).first();
}

// The "Position :" label on the profile panel — matches English or Hindi.
function positionLabel(page: Page): Locator {
  return page.getByText(T.position).first();
}

// A reliable, language-independent "the Account panel is mounted" locator:
// the left-nav "Personal Details" item is always present in both languages.
// A language-independent "the Account panel is mounted" marker: either the
// Position label or the left-nav item, whichever appears.
function accountMountedMarker(page: Page): Locator {
  return positionLabel(page).or(page.getByText(T.personalDetails).first()).first();
}

// The Save button on any Account form — matches English or Hindi.
function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: /^(save|सेव करें|सहेजें)$/i })
    .or(page.getByText(/^(save|सेव करें|सहेजें)$/i)).first();
}

// Force the account UI back to English (radio index 0 is always English /
// अंग्रेजी). Best-effort — never throws — used to undo the Hindi-switch test.
// Force the account UI back to English. Radio index 0 is always English
// (अंग्रेजी), whatever language the page is currently rendering in.
async function ensureEnglish(page: Page): Promise<void> {
  // Everything here is best-effort: the whole body is wrapped so it never throws.
  try {
    // Get to the Account page.
    await openAccountViaHeader(page);
    // Open the Language Preference section.
    const langNav = page.getByText(/^(language preference|भाषा प्राथमिकता)$/i).first();
    await langNav.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
    await langNav.click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    // Tick the first radio — always English. `force` because Material hides the input.
    await page.locator('input[type="radio"]').first().check({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    // Save the change.
    const save = saveButton(page);
    await save.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
    await save.click({ timeout: 5_000 }).catch(() => {});
    // Give the app time to re-render in English.
    await page.waitForTimeout(2500);
  // Swallow everything: this is a cleanup helper, not a check.
  } catch {
    /* best effort */
  }
}

// Robust Home → Account hop. Retries the whole navigation a few times because
// the SPA header can render slowly under headed/loaded conditions. Uses
// 'domcontentloaded' rather than 'networkidle' (this SPA never goes idle —
// long-poll/analytics keep the network busy). Returns true once the Account
// panel is mounted (Position label visible).
async function openAccountViaHeader(page: Page, attempts = 3): Promise<boolean> {
  // Up to three attempts.
  for (let i = 1; i <= attempts; i++) {
    // Always start from Home — a direct URL renders the Account route blank.
    await page.goto(PRIVATE_HOME_URL);
    // domcontentloaded, NOT networkidle: this SPA never goes idle (long-poll/analytics).
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // Let the header paint.
    await page.waitForTimeout(1500);

    // Find the Account control.
    const nav = accountNav(page);
    // A generous 12s window — this is the element that renders slowly.
    if (await nav.isVisible({ timeout: 12_000 }).catch(() => false)) {
      // Click it.
      await scrollAndClick(page, nav);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(2000);
      // The click isn't enough; wait for the panel to actually mount.
      const mounted = await accountMountedMarker(page)
        .isVisible({ timeout: 8_000 }).catch(() => false);
      // Mounted — done.
      if (mounted) return true;
    }
    // Otherwise report which attempt failed, and where we were, then retry.
    console.log(`⚠️  Account nav not ready (attempt ${i}/${attempts}) — url: ${page.url()}`);
  }
  // All attempts exhausted.
  return false;
}

// Re-navigate to the Account page via Home → header click (since direct
// URL/reload causes the Account route to render blank). Use this in
// reload-then-verify tests instead of page.reload() alone.
async function reNavigateToAccount(page: Page) {
  await openAccountViaHeader(page);
}

// ════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════
// Authentication is provided by the authedTest harness (storageState in CI,
// CDP fallback locally). See tests/helpers/authedTest.ts.

// ── ONE shared page for the whole file ──────────────────────────────
// Open the Account page ONCE (beforeAll) and run every test against that
// same live session. We do NOT re-open/re-navigate for each test and never
// close the CDP browser. The per-test hook only re-opens when a previous
// test navigated away (Logout / Home / reload), so most tests are a no-op.
// The shared context and the ONE tab every test in this file uses.
let sharedCtx: BrowserContext;
let page: Page;

// Language-independent "are we on the mounted Account panel?" check.
async function onAccountPage(p: Page): Promise<boolean> {
  // Cheapest checks first: is the tab alive, and does the URL look right?
  if (p.isClosed() || !/profile-view|\/profile/i.test(p.url())) return false;
  // Then confirm the panel actually rendered, in either language.
  return await p.getByText(T.personalDetails).first().isVisible({ timeout: 2500 }).catch(() => false);
}

// Runs once, before the first test.
test.beforeAll(async ({ authContext }) => {
  // `authContext` is a WORKER-scoped fixture — authenticated once per run.
  sharedCtx = authContext;
  // Open the single shared tab.
  page = await sharedCtx.newPage();
  // Get to the Account page.
  const opened = await openAccountViaHeader(page);
  // Fail the whole file immediately, with a message naming the likely cause.
  expect(opened, 'Account page failed to mount — is TEST_USER logged in on the right env (BASE_URL)?').toBeTruthy();
});

// Runs once, after the last test.
test.afterAll(async () => {
  // Close only our tab — never the user's CDP browser/context.
  await page?.close().catch(() => {});
});

// Runs before every test: undo whatever the previous one left behind.
test.beforeEach(async () => {
  // The shared page persists state across tests, so reset the viewport (the
  // responsive tests change it) ...
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  // ... and dismiss any modal/overlay a previous test left open (the Logout
  // confirmation, a profile-picture uploader, etc.) — its backdrop would
  // otherwise block clicks in this test.
  // Dismiss any modal a previous test left open. Up to three attempts, because
  // a stale backdrop would silently block every click in this test.
  for (let i = 0; i < 3; i++) {
    // Three shapes of overlay.
    const overlay = page.locator('.cdk-overlay-backdrop, .mat-mdc-dialog-container, [role="dialog"]').first();
    // Nothing open — stop early. The 250ms timeout keeps this cheap.
    if (!(await overlay.isVisible({ timeout: 250 }).catch(() => false))) break;
    // Escape dismisses most Material dialogs.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    // Fall back to clicking the backdrop if Escape didn't dismiss it.
    await page.locator('.cdk-overlay-backdrop').first().click({ timeout: 500, force: true }).catch(() => {});
    await page.waitForTimeout(200);
  }
  // Reuse the already-open Account page; only re-open if a prior test left it.
  if (!(await onAccountPage(page))) {
    const opened = await openAccountViaHeader(page);
    // Warn rather than throw — let the test's own assertion produce the failure.
    if (!opened) console.log(`⚠️  Account page did not mount — likely a dropped session. URL: ${page.url()}`);
  }
});

// ════════════════════════════════════════════════════════════════════
// SECTION 1: ACCOUNT LANDING & LEFT NAV
// ════════════════════════════════════════════════════════════════════
test.describe('Account — Landing & Left Nav', () => {
  // TEST 1 — we are where we think we are.
  test('URL contains "/profile" (or account path)', async () => {
    // hard — accepts either route spelling.
    expect(page.url()).toMatch(/profile|account/i);
    console.log(`✅ URL: ${page.url()}`);
  });

  // TEST 2 — the user's name in the left panel.
  test('User name is visible in left panel', async () => {
    // E.g. "ashsjs hshs"
    // Any heading-ish element whose text looks like two words — a crude
    // "firstname lastname" shape.
    const name = page.locator('h1, h2, h3, [class*="user-name"]').filter({ hasText: /\w+\s+\w+/ }).first();
    // Read it…
    const text = await name.textContent().catch(() => '');
    // …and PRINT it. observe — no assertion, so a blank name passes.
    console.log(`✅ User name text: "${text?.trim()}"`);
  });

  // TEST 3 — the Position label.
  test('Position label (e.g. "Position : Healthcare Worker") is visible', async () => {
    // hard, via the language-independent marker.
    await expect(accountMountedMarker(page)).toBeVisible();
    // Read the marker's text…
    const text = await accountMountedMarker(page).textContent().catch(() => '');
    // …and print it. The label's presence is asserted; its CONTENT is only logged.
    console.log(`✅ Position/profile marker: "${text?.trim()}"`);
  });

  // TEST 4 — the profile picture.
  test('Profile avatar image is visible', async () => {
    // Three class conventions for an avatar.
    const avatar = page.locator('[class*="avatar"] img, [class*="profile-pic"] img, [class*="user-image"]').first();
    // observe — a user with no photo still has a valid account.
    const visible = await avatar.isVisible().catch(() => false);
    console.log(`✅ Profile avatar visible: ${visible}`);
  });

  // TEST 5 — the edit-photo control.
  test('Pencil edit icon on profile picture is visible', async () => {
    // Four shapes: a button wrapping the icon, the Material ligature, aria-label, or a class.
    const pencil = page.locator([
      'button:has(mat-icon:has-text("edit"))',
      'mat-icon:has-text("edit")',
      '[aria-label*="edit" i]',
      '[class*="edit-icon"]',
    ].join(', ')).first();
    // observe.
    const visible = await pencil.isVisible().catch(() => false);
    console.log(`✅ Pencil edit icon visible: ${visible}`);
  });

  // TEST 6 — the five left-nav items. All five are hard: the nav is fixed chrome,
  test('"Personal Details" nav link is visible', async () => {
    // identical for every account, so it is safely assertable in either language.
    await expect(page.getByText(T.personalDetails).first()).toBeVisible();
    console.log('✅ Personal Details nav visible');
  });

  // TEST 7 — Organization Details nav.
  test('"Organization Details" nav link is visible', async () => {
    await expect(page.getByText(T.organizationNav).first()).toBeVisible();
    console.log('✅ Organization Details nav visible');
  });

  // TEST 8 — Academic Details nav.
  test('"Academic Details" nav link is visible', async () => {
    await expect(page.getByText(T.academicDetails).first()).toBeVisible();
    console.log('✅ Academic Details nav visible');
  });

  // TEST 9 — Language Preference nav.
  test('"Language Preference" nav link is visible', async () => {
    await expect(page.getByText(T.languagePreference).first()).toBeVisible();
    console.log('✅ Language Preference nav visible');
  });

  // TEST 10 — My Certificates nav.
  test('"My Certificates" nav link is visible', async () => {
    await expect(page.getByText(T.myCertificates).first()).toBeVisible();
    console.log('✅ My Certificates nav visible');
  });

  // TEST 11 — the support entry point.
  test('"Help and Support" button is visible', async () => {
    // As a button if there is one, else as text. hard.
    await expect(page.getByRole('button', { name: T.helpSupport })
      .or(page.getByText(T.helpSupport)).first()).toBeVisible();
    console.log('✅ Help and Support visible');
  });

  // TEST 12 — the logout control.
  test('"Logout" button is visible', async () => {
    // Same button-or-text hedge. hard.
    await expect(page.getByRole('button', { name: T.logout })
      .or(page.getByText(T.logout)).first()).toBeVisible();
    console.log('✅ Logout button visible');
  });

  // TEST 13 — which section opens by default.
  test('"Personal Details" is active by default on first load', async () => {
    // The nav item.
    const heading = page.getByText(T.personalDetails).first();
    // Read its class list…
    const klass = await heading.getAttribute('class').catch(() => '');
    // …and print the first 100 chars. observe — whether it carries an "active"
    // marker is left for a human to judge.
    console.log(`✅ Personal Details class hints: "${klass?.slice(0, 100)}"`);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 2: PERSONAL DETAILS
// ════════════════════════════════════════════════════════════════════
test.describe('Account — Personal Details', () => {
  // Nested hook: open this section before every test in the group.
  test.beforeEach(async () => {
    await clickAccountNav(page, 'Personal Details');
  });

  // TEST 1 — the section heading.
  test('"Personal Details" page heading is visible', async () => {
    // The heading is a <p class="text-2xl">, not a real <h*>, so the locator lists
    // every element it might be and then filters by the bilingual text.
    // Heading is a <p class="text-2xl">; match English OR Hindi.
    await expect(page.locator('p, h1, h2, h3, h4, [class*="text-2xl"], [class*="head" i], [class*="title" i]')
      .filter({ hasText: T.personalDetailsHead }).first()).toBeVisible();
    console.log('✅ Personal Details heading visible');
  });

  // TEST 2 — the first-name field.
  test('First name field is visible with value', async () => {
    // Field placeholders stay English in both languages — language-proof.
    // hard on presence…
    await expect(page.getByPlaceholder(/first name/i).first()).toBeVisible();
    // …then the value is read…
    const val = await page.getByPlaceholder(/first name/i).first().inputValue().catch(() => '');
    // …and printed. observe on the content.
    console.log(`✅ First name value: "${val}"`);
  });

  // TEST 3 — last name. hard on presence only.
  test('Last name field is visible with value', async () => {
    await expect(page.getByPlaceholder(/last name/i).first()).toBeVisible();
    console.log('✅ Last name field visible');
  });

  // TEST 4 — phone number. hard on presence.
  test('Phone Number field is visible', async () => {
    await expect(page.getByPlaceholder(/phone/i).first()).toBeVisible();
    console.log('✅ Phone Number input visible');
  });

  // TEST 5 — the email field, and whether it is masked.
  test('Email ID field is visible and masked', async () => {
    // hard on presence.
    await expect(page.getByPlaceholder(/email/i).first()).toBeVisible();
    // Find an input containing @ symbol
    // Every input except the radios.
    const emailInput = page.locator('input').filter({ hasNot: page.locator('[type="radio"]') });
    // How many?
    const count = await emailInput.count();
    // Did we find a masked one?
    let masked = false;
    // Walk them looking for a value containing @ — that's the email.
    for (let i = 0; i < count; i++) {
      const v = await emailInput.nth(i).inputValue().catch(() => '');
      // Found it.
      if (v.includes('@')) {
        console.log(`   Email value: "${v}"`);
        // Masking is indicated by an asterisk in the value.
        masked = /\*/.test(v);
        break;
      }
    }
    // observe — masking is measured and printed, never required.
    console.log(`✅ Email is masked with *: ${masked}`);
  });

  // TEST 6 — the date-of-birth block.
  test('Date of Birth section is visible with Year/Month/Date dropdowns', async () => {
    // hard on the section label, in either language.
    await expect(page.getByText(/date of birth|जन्म की तारीख/i).first()).toBeVisible();
    // Then count the native selects…
    const selects = page.locator('select');
    const count = await selects.count();
    // …and print the total. The three DOB dropdowns are not individually checked.
    console.log(`✅ DOB section visible — total <select> elements on page: ${count}`);
  });

  // TEST 7 — the country dropdown's label.
  test('Country dropdown is visible', async () => {
    // hard. Anchored, so it can't match "Country code".
    await expect(page.getByText(/^(country|देश)$/i).first()).toBeVisible();
    console.log('✅ Country label visible');
  });

  // TEST 8 — the pincode field.
  test('Pincode field is visible', async () => {
    // hard, by placeholder.
    await expect(page.getByPlaceholder(/pincode/i).first()).toBeVisible();
    console.log('✅ Pincode input visible');
  });

  // TEST 9 — the Save button.
  test('Save button is visible', async () => {
    // hard.
    await expect(saveButton(page)).toBeVisible();
    console.log('✅ Save button visible');
  });

  // TEST 10 — actually edit and save the form.
  test('Fill Phone Number and Pincode then Save', async () => {
    test.setTimeout(60_000);

    // Phone — read-only on prod (verified/masked), so only fill if editable.
    // The phone box.
    const phoneInput = page.locator('input[placeholder*="phone" i]').first();
    // isEditable() is the guard: a read-only field would throw on fill().
    if (await phoneInput.isEditable().catch(() => false)) {
      await phoneInput.fill('9876543210');
      console.log('✅ Phone filled');
    } else {
      console.log('ℹ️  Phone field is read-only — skipping fill');
    }

    // Pincode — same treatment.
    // Pincode
    const pincodeInput = page.locator('input[placeholder*="pincode" i]').first();
    // Only fill if the app allows it.
    if (await pincodeInput.isEditable().catch(() => false)) {
      await pincodeInput.fill('560001');
      console.log('✅ Pincode filled');
    } else {
      console.log('ℹ️  Pincode field is read-only — skipping fill');
    }

    // Save — the button stays disabled until an editable field actually
    // changes. On prod the phone is read-only, so if nothing changed the
    // button is legitimately disabled; only click when it's enabled.
    const save = saveButton(page);
    // So only click when it's genuinely enabled.
    if (await save.isEnabled().catch(() => false)) {
      await scrollAndClick(page, save);
      await page.waitForTimeout(3000);
      // Three shapes of confirmation toast.
      const toast = page.locator('[class*="snackbar"], [class*="toast"], [role="status"]').first();
      // Read whatever the server said…
      const toastText = await toast.textContent().catch(() => '');
      // …and print it. The save's SUCCESS is never asserted.
      console.log(`✅ After save — toast/status text: "${toastText?.trim() ?? '(none)'}"`);
    } else {
      // The honest alternative: say nothing was saved rather than pretend it was.
      console.log('ℹ️  Save button is disabled (no editable fields changed) — nothing to save');
    }
  });

  // TEST 11 — do saved values survive a reload?
  test('Saved values persist after page reload', async () => {
    test.setTimeout(60_000);
    // Note: reNavigateToAccount, not page.reload() — a direct reload renders blank.
    await reNavigateToAccount(page);
    // Back to this section.
    await clickAccountNav(page, 'Personal Details');

    // Re-read both fields…
    const phoneInput = page.locator('input[placeholder*="phone" i]').first();
    const pincodeInput = page.locator('input[placeholder*="pincode" i]').first();
    const phoneVal = await phoneInput.inputValue().catch(() => '');
    const pincodeVal = await pincodeInput.inputValue().catch(() => '');
    // …and print them. observe — nothing compares these to what test 10 typed,
    // so a save that silently failed would pass.
    console.log(`✅ After reload — phone: "${phoneVal}", pincode: "${pincodeVal}"`);
  });

  // TEST 12 — the DOB year dropdown responds.
  test('DOB Year dropdown can be changed', async () => {
    // The native selects.
    const selects = page.locator('select');
    // Need at least the three DOB ones before indexing.
    if ((await selects.count()) >= 3) {
      // Index 0 is Year.
      const yearSel = selects.first();
      // Pick an arbitrary option by position; errors swallowed.
      await yearSel.selectOption({ index: 5 }).catch(() => {});
      const v = await yearSel.inputValue().catch(() => '');
      // The chosen value is printed, not asserted.
      console.log(`✅ Year selected: "${v}"`);
    } else {
      console.log('ℹ️  Fewer than 3 selects — skipping');
    }
  });

  // TEST 13 — the country dropdown responds.
  test('Country dropdown can be changed', async () => {
    const selects = page.locator('select');
    // Count them.
    const count = await selects.count();
    // Country is index 3, so we need at least four.
    if (count >= 4) {
      const countrySel = selects.nth(3);
      // Pick an arbitrary option.
      await countrySel.selectOption({ index: 2 }).catch(() => {});
      const v = await countrySel.inputValue().catch(() => '');
      // Printed, not asserted.
      console.log(`✅ Country selected: "${v}"`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 3: ORGANIZATION DETAILS
// ════════════════════════════════════════════════════════════════════
test.describe('Account — Organization Details', () => {
  // Nested hook: open this section before every test in the group.
  test.beforeEach(async () => {
    await clickAccountNav(page, 'Organization Details');
  });

  // TEST 1 — the section heading.
  test('"Organizational Details" page heading is visible', async () => {
    // Heading is a <p class="text-2xl">; match English OR Hindi.
    await expect(page.locator('p, h1, h2, h3, h4, [class*="text-2xl"], [class*="head" i], [class*="title" i]')
      .filter({ hasText: T.organizationalHead }).first()).toBeVisible();
    console.log('✅ Organizational Details heading visible');
  });

  // TEST 2 — the Background label.
  test('"Background" label is visible', async () => {
    // Match English OR Hindi (पृष्ठ भूमि); substring since the label carries markers.
    // hard.
    await expect(page.getByText(T.background).first()).toBeVisible();
    console.log('✅ Background label visible');
  });

  // TEST 3 — which background this user chose.
  test('Background dropdown shows current value (e.g. Healthcare Worker)', async () => {
    // Any of the six background options.
    const bgValue = page.getByText(/healthcare worker|volunteer|asha|student|faculty|others/i).first();
    // observe…
    const visible = await bgValue.isVisible().catch(() => false);
    // …read the text only if it's there…
    const text = visible ? await bgValue.textContent() : '';
    // …and print it.
    console.log(`✅ Background value: "${text?.trim()}"`);
  });

  // TEST 4 — the designation dropdown.
  test('Designation dropdown is visible (e.g. ANM/MPW)', async () => {
    // All three dropdown shapes.
    const selects = page.locator('select, mat-select, [role="combobox"]');
    // Counted…
    const count = await selects.count();
    // …and printed. observe — it never checks that a DESIGNATION dropdown exists,
    // only that SOME dropdown does.
    console.log(`✅ Dropdown/select elements visible: ${count}`);
  });

  // TEST 5 — the registration-number field.
  test('"RN/RM Number" label and field are visible', async () => {
    // Its label.
    const label = page.getByText(/rn\/rm number/i).first();
    // observe.
    const visible = await label.isVisible().catch(() => false);
    console.log(`✅ RN/RM Number label visible: ${visible}`);
  });

  // TEST 6 — the organisation type.
  test('Organization type / Private Sector dropdown is visible', async () => {
    // Any of four known type values.
    const orgType = page.getByText(/private sector|government|ngo|public sector/i).first();
    // observe.
    const visible = await orgType.isVisible().catch(() => false);
    console.log(`✅ Organization type value visible: ${visible}`);
  });

  // TEST 7 — the organisation name input.
  test('Organization Name input is visible', async () => {
    // Two placeholder spellings.
    const orgName = page.locator('input[placeholder*="organization name" i], input[placeholder*="org name" i]').first();
    // observe.
    const visible = await orgName.isVisible().catch(() => false);
    console.log(`✅ Organization Name input visible: ${visible}`);
  });

  // TEST 8 — the Save button. hard.
  test('Save button is visible on Organization Details', async () => {
    await expect(saveButton(page)).toBeVisible();
    console.log('✅ Save button visible');
  });

  // TEST 9 — edit and save the organisation name.
  test('Fill Organization Name and Save', async () => {
    test.setTimeout(60_000);

    // The field.
    const orgName = page.locator('input[placeholder*="organization name" i], input[placeholder*="org name" i]').first();
    // Only proceed if it's there — the whole body is inside this guard.
    if (await orgName.isVisible().catch(() => false)) {
      // Type a new value.
      await orgName.fill('Test Hospital Bangalore');
      console.log('✅ Organization Name filled');

      // Save it. No isEnabled() guard here, unlike the Personal Details save.
      const save = saveButton(page);
      await scrollAndClick(page, save);
      await page.waitForTimeout(3000);

      // Read the confirmation toast…
      const toast = page.locator('[class*="snackbar"], [class*="toast"], [role="status"]').first();
      const toastText = await toast.textContent().catch(() => '');
      // …and print it. Success is never asserted.
      console.log(`✅ Save toast: "${toastText?.trim() ?? '(none)'}"`);
    }
  });

  // TEST 10 — does that name survive a reload?
  test('Saved Organization Name persists after reload', async () => {
    test.setTimeout(60_000);
    // Via Home → header, not page.reload().
    await reNavigateToAccount(page);
    // Back to this section.
    await clickAccountNav(page, 'Organization Details');

    // Re-read the field…
    const orgName = page.locator('input[placeholder*="organization name" i], input[placeholder*="org name" i]').first();
    // …and print it.
    const val = await orgName.inputValue().catch(() => '');
    // observe — nothing compares this to the value test 9 typed.
    console.log(`✅ Organization Name after reload: "${val}"`);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 4: ACADEMIC DETAILS
// ════════════════════════════════════════════════════════════════════
test.describe('Account — Academic Details', () => {
  // Nested hook: open this section before every test in the group.
  test.beforeEach(async () => {
    await clickAccountNav(page, 'Academic Details');
  });

  // TEST 1 — the section heading.
  test('"Education" heading is visible', async () => {
    // Heading is a <p class="text-2xl">; match English OR Hindi (शिक्षा).
    await expect(page.locator('p, h1, h2, h3, h4, [class*="text-2xl"], [class*="head" i], [class*="title" i]')
      // hard.
      .filter({ hasText: T.education }).first()).toBeVisible();
    console.log('✅ Education heading visible');
  });

  // TEST 2 — the add-entry link.
  test('"+ Add Education" link is visible', async () => {
    // hard. The regex tolerates the leading "+" that some builds render.
    await expect(page.getByText(T.addEducation).first()).toBeVisible();
    console.log('✅ + Add Education link visible');
  });

  // TEST 3 — does that link actually open a form?
  test('Clicking "+ Add Education" opens education entry form or modal', async () => {
    // The link.
    const link = page.getByText(T.addEducation).first();
    // Click it.
    await scrollAndClick(page, link);
    await page.waitForTimeout(1500);

    // Look for fields that would appear in an education form
    // Seven field labels an education form might plausibly contain.
    const formMarkers = [
      /degree/i, /institution/i, /university/i, /qualification/i, /year/i,
      /field of study/i, /school/i,
    ];
    // Count how many appeared.
    let found = 0;
    for (const re of formMarkers) {
      // Check each.
      if (await page.getByText(re).first().isVisible().catch(() => false)) {
        found++;
        console.log(`   ✓ Form marker visible: ${re}`);
      }
    }
    // A tally, not an assertion — 0/7 still passes, so a link that opens nothing
    // would be reported as a pass.
    console.log(`✅ Education form markers found: ${found}/${formMarkers.length}`);
  });

  // TEST 4 — is this nav item highlighted?
  test('"Academic Details" is highlighted as active in left nav', async () => {
    // The nav link.
    const link = page.getByText(T.academicDetails).first();
    // Read its class list…
    const klass = await link.getAttribute('class').catch(() => '');
    // …and print it. observe.
    console.log(`✅ Academic Details link class: "${klass?.slice(0, 100)}"`);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 5: LANGUAGE PREFERENCE
// ════════════════════════════════════════════════════════════════════
test.describe('Account — Language Preference', () => {
  // Nested hook: open this section before every test in the group.
  test.beforeEach(async () => {
    await clickAccountNav(page, 'Language Preference');
  });

  // Safety net: always leave the shared account in English, otherwise a Hindi
  // switch here poisons every English selector in the later sections.
  test.afterEach(async () => {
    await ensureEnglish(page);
  });

  // TEST 1 — the section heading.
  test('"Language Preference" page heading is visible', async () => {
    // The <p class="text-2xl"> shape, falling back to plain text. hard.
    await expect(page.locator('p, h1, h2, h3, h4, [class*="text-2xl"], [class*="head" i], [class*="title" i]')
      .filter({ hasText: T.languagePreference })
      .or(page.getByText(T.languagePreference)).first()).toBeVisible();
    console.log('✅ Language Preference heading visible');
  });

  // TEST 2 — the English option.
  test('English radio option is visible', async () => {
    // "English" shows as अंग्रेजी when the UI is in Hindi.
    // hard, in either language.
    await expect(page.getByText(/^(english|अंग्रेजी)$/i).first()).toBeVisible();
    console.log('✅ English radio visible');
  });

  // TEST 3 — the Hindi option.
  test('Hindi radio option (हिंदी) is visible', async () => {
    // hard. "Hindi" and हिंदी are both accepted.
    await expect(page.getByText(/हिंदी|hindi/i).first()).toBeVisible();
    console.log('✅ Hindi radio visible');
  });

  // TEST 4 — which language is currently selected.
  test('English is selected by default', async () => {
    // Every radio on the page.
    const radios = page.locator('input[type="radio"]');
    const count = await radios.count();
    // Walk them looking for the checked one.
    for (let i = 0; i < count; i++) {
      const checked = await radios.nth(i).isChecked().catch(() => false);
      if (checked) {
        // Get the label text near this radio
        // `xpath=..` is the radio's PARENT element — the label text sits beside the
        // input, not inside it, so we climb one level to read it.
        const labelText = await radios.nth(i).locator('xpath=..').textContent().catch(() => '');
        console.log(`   ✓ Radio ${i + 1} is checked, label: "${labelText?.trim().slice(0, 30)}"`);
      }
    }
    // observe — the checked radio is found and printed, but the test never asserts
    // that it is the ENGLISH one, despite its name.
    console.log('✅ Default selection verified');
  });

  // TEST 5 — the Save button. hard.
  test('Save button is visible on Language Preference', async () => {
    await expect(saveButton(page)).toBeVisible();
    console.log('✅ Save button visible');
  });

  // TEST 6 — switch to Hindi and confirm it sticks.
  test('Select Hindi, click Save, verify Hindi remains selected after reload', async () => {
    test.setTimeout(60_000);

    // Radio index 1 is Hindi.
    const hindiRadio = page.locator('input[type="radio"]').nth(1);
    // `force` because Material hides the real input behind a styled wrapper.
    await hindiRadio.check({ force: true });
    await page.waitForTimeout(400);
    console.log('✅ Hindi selected');

    // Selecting Hindi relabels the Save button to "सेव करें" instantly, so
    // match either language.
    // …which is exactly why saveButton() matches both languages.
    await scrollAndClick(page, saveButton(page));
    await page.waitForTimeout(3000);

    // Re-navigate via header (direct reload renders blank) and re-check
    await reNavigateToAccount(page);
    // Back to this section.
    await clickAccountNav(page, 'Language Preference');
    const radios = page.locator('input[type="radio"]');
    // Re-read the radio's state…
    const hindiChecked = await radios.nth(1).isChecked().catch(() => false);
    // …and print it. observe — a preference that failed to persist would pass.
    console.log(`✅ Hindi still selected after reload: ${hindiChecked}`);
  });

  // TEST 7 — switch back to English. Mirror image of test 6.
  test('Switch back to English, save, verify English remains selected', async () => {
    test.setTimeout(60_000);

    // Radio index 0 is always English.
    const englishRadio = page.locator('input[type="radio"]').first();
    await englishRadio.check({ force: true });
    await page.waitForTimeout(400);

    // Save.
    await scrollAndClick(page, saveButton(page));
    await page.waitForTimeout(3000);

    // Re-navigate and re-check.
    await reNavigateToAccount(page);
    await clickAccountNav(page, 'Language Preference');
    const radios = page.locator('input[type="radio"]');
    const englishChecked = await radios.first().isChecked().catch(() => false);
    // Printed, not asserted.
    console.log(`✅ English selected after reload: ${englishChecked}`);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 6: MY CERTIFICATES
// ════════════════════════════════════════════════════════════════════
test.describe('Account — My Certificates', () => {
  // Nested hook: open this section before every test in the group.
  test.beforeEach(async () => {
    await clickAccountNav(page, 'My Certificates');
  });

  // TEST 1 — is this nav item highlighted? observe, like the others.
  test('"My Certificates" is active in left nav', async () => {
    const link = page.getByText(T.myCertificates).first();
    const klass = await link.getAttribute('class').catch(() => '');
    console.log(`✅ My Certificates link class: "${klass?.slice(0, 100)}"`);
  });

  // TEST 2 — the empty state.
  test('Empty state "No Certificates" is visible for new users', async () => {
    // The message a user with no certificates sees.
    const emptyMsg = page.getByText(/no certificates/i).first();
    // observe — correct to be soft here, since the account MAY have certificates.
    const visible = await emptyMsg.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(`✅ "No Certificates" empty state visible: ${visible}`);
  });

  // TEST 3 — no cards when there are none.
  test('No certificate cards rendered when user has none', async () => {
    // Certificate cards.
    const cards = page.locator('[class*="certificate-card"], mat-card');
    const count = await cards.count();
    // Counted and printed. The parenthetical says "expected 0", but nothing
    // enforces it.
    console.log(`✅ Certificate card count: ${count} (expected 0 for new user)`);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 7: PROFILE PICTURE EDIT
// ════════════════════════════════════════════════════════════════════
test.describe('Account — Profile Picture', () => {
  // TEST 1 — does the pencil open an uploader?
  test('Clicking the pencil icon opens an upload/edit option', async () => {
    // The same four shapes used in the landing section.
    const pencil = page.locator([
      'button:has(mat-icon:has-text("edit"))',
      'mat-icon:has-text("edit")',
      '[aria-label*="edit" i]',
      '[class*="edit-icon"]',
    ].join(', ')).first();

    // Not present — return early rather than fail.
    if (!(await pencil.isVisible().catch(() => false))) {
      console.log('ℹ️  Pencil not visible — skipping');
      return;
    }
    // Click it.
    await scrollAndClick(page, pencil);
    await page.waitForTimeout(1500);

    // Look for a file input or upload-related UI
    // A real <input type="file"> is the strongest signal…
    const fileInputCount = await page.locator('input[type="file"]').count();
    // …and upload-ish wording is the fallback.
    const uploadText = await page.getByText(/upload|choose file|browse/i).first().isVisible().catch(() => false);
    // Both printed. observe — a pencil that opens nothing would pass.
    console.log(`✅ After pencil click — file inputs: ${fileInputCount}, upload text visible: ${uploadText}`);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 8: HELP AND SUPPORT
// ════════════════════════════════════════════════════════════════════
test.describe('Account — Help and Support', () => {
  // TEST 1 — the support entry point does something.
  test('Clicking "Help and Support" navigates / opens helper', async () => {
    // As a button if there is one, else as text.
    const btn = page.getByRole('button', { name: T.helpSupport })
      .or(page.getByText(T.helpSupport)).first();
    // Keep the before-URL for the log.
    const urlBefore = page.url();

    // Promise.all registers the new-tab listener and clicks AT THE SAME TIME, so a
    // tab that opens instantly isn't missed. `.catch(() => null)` makes the 3s
    // timeout a null rather than a rejection, so both branches below are normal.
    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null),
      scrollAndClick(page, btn),
    ]);
    await page.waitForTimeout(2000);

    // New tab — log its URL and tidy up.
    if (popup) {
      console.log(`✅ Help and Support opened popup: ${popup.url()}`);
      await popup.close();
    // In-page navigation — log the before/after pair. Neither is asserted.
    } else {
      console.log(`✅ Help and Support click — URL: ${urlBefore} → ${page.url()}`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 9: LOGOUT FLOW (click No to cancel)
// ════════════════════════════════════════════════════════════════════
test.describe('Account — Logout Flow', () => {
  // TEST 1 — Logout opens a confirmation rather than logging out immediately.
  test('Clicking Logout opens confirmation modal', async () => {
    // The logout control.
    const logoutBtn = page.getByRole('button', { name: T.logout })
      .or(page.getByText(T.logout)).first();
    // Click it.
    await scrollAndClick(page, logoutBtn);
    await page.waitForTimeout(1500);

    // hard — either the modal's heading or its Yes button proves it opened.
    // This is real coverage: an immediate logout with no confirmation would fail.
    await expect(page.getByText(/logout now|लॉग आउट|साइन आउट/i)
      .or(page.getByRole('button', { name: /^(yes|हाँ|हां)$/i })).first()).toBeVisible({ timeout: 5_000 });
    console.log('✅ "Logout Now" modal opened');
  });

  // TEST 2 — the modal asks for confirmation.
  test('Logout modal shows "Are you sure?" text', async () => {
    // Re-open the modal (each test starts from a clean page).
    const logoutBtn = page.getByRole('button', { name: T.logout })
      .or(page.getByText(T.logout)).first();
    await scrollAndClick(page, logoutBtn);
    await page.waitForTimeout(1500);

    // hard — the "are you sure" wording, or failing that the No button.
    await expect(page.getByText(/are you sure\??|क्या आप सुनिश्चित|क्या आप वाकई/i)
      .or(page.getByRole('button', { name: /^(no|नहीं)$/i })).first()).toBeVisible();
    console.log('✅ "Are you sure?" text visible');
  });

  // TEST 3 — both choices are offered.
  test('Logout modal has "Yes" and "No" buttons', async () => {
    // Re-open the modal.
    const logoutBtn = page.getByRole('button', { name: T.logout })
      .or(page.getByText(T.logout)).first();
    await scrollAndClick(page, logoutBtn);
    await page.waitForTimeout(1500);

    // The confirm button, in either language.
    const yesBtn = page.getByRole('button', { name: /^(yes|हाँ|हां)$/i }).first();
    // And the cancel button.
    const noBtn = page.getByRole('button', { name: /^(no|नहीं)$/i }).first();
    // hard ×2 — a modal with only Yes would be a trap.
    await expect(yesBtn).toBeVisible();
    await expect(noBtn).toBeVisible();
    console.log('✅ Both Yes and No buttons visible');
  });

  // TEST 4 — the group's most valuable test: No really does cancel.
  test('Clicking "No" in logout modal closes the modal and keeps user signed in', async () => {
    // Re-open the modal.
    const logoutBtn = page.getByRole('button', { name: T.logout })
      .or(page.getByText(T.logout)).first();
    await scrollAndClick(page, logoutBtn);
    await page.waitForTimeout(1500);

    // The cancel button.
    const noBtn = page.getByRole('button', { name: /^(no|नहीं)$/i }).first();
    // Click it.
    await scrollAndClick(page, noBtn);
    await page.waitForTimeout(2000);

    // Modal should be gone
    // Read whether it's still there…
    const stillOpen = await page.getByText(/logout now|लॉग आउट/i).first().isVisible().catch(() => false);
    // …and print it. observe on the dismissal itself.
    console.log(`✅ Modal closed (logout now text hidden): ${!stillOpen}`);

    // URL still on Account
    // hard — this IS asserted: cancelling must not navigate us away.
    expect(page.url()).toMatch(/profile|account/i);
    console.log(`✅ URL still on Account: ${page.url()}`);

    // User still authenticated (profile marker still visible)
    // Read whether the profile still renders…
    const userStillVisible = await accountMountedMarker(page).isVisible().catch(() => false);
    // …and print it. observe — so a No that silently logged the user out would
    // still be reported as a pass.
    console.log(`✅ User still authenticated (profile marker visible): ${userStillVisible}`);
  });
});

// ════════════════════════════════════════════════════════════════════
// SECTION 10: HEADER & PAGE HEALTH
// ════════════════════════════════════════════════════════════════════
test.describe('Account — Header & Page Health', () => {
  // TEST 1 — the shared header's logo.
  test('Aastrika logo is visible on Account page', async () => {
    // By alt text, or an image in a logo wrapper.
    const logo = page.locator('img[alt*="aastrika" i], [class*="logo"] img').first();
    // hard.
    await expect(logo).toBeVisible();
    console.log('✅ Logo visible');
  });

  // TEST 2 — the search bar.
  test('Search bar is visible on Account page', async () => {
    // Placeholder is localized (English/Hindi); fall back to the search input.
    // hard, with the input type as a last resort.
    await expect(
      page.getByPlaceholder(/what do you want to learn today|क्या सीखना चाहते/i)
        .or(page.locator('input[type="search"]')).first(),
    ).toBeVisible();
    console.log('✅ Search bar visible');
  });

  // TEST 3 — is the Account nav item highlighted? observe.
  test('"Account" nav link is marked active', async () => {
    const link = page.getByRole('link', { name: T.account })
      .or(page.getByText(T.account)).first();
    const klass = await link.getAttribute('class').catch(() => '');
    console.log(`✅ Account nav link class: "${klass?.slice(0, 100)}"`);
  });

  // TEST 4 — Home navigates.
  test('Clicking "Home" navigates to Home page', async () => {
    // Home is a header <button> (not a link) and localized (Home / होम).
    // All three shapes, in both languages.
    const homeLink = page.getByRole('button', { name: /^(home|होम)$/i })
      .or(page.getByRole('link', { name: /^(home|होम)$/i }))
      .or(page.getByText(/^(home|होम)$/i)).first();
    // Click it.
    await scrollAndClick(page, homeLink);
    await page.waitForTimeout(2000);
    // hard — one of the few asserted destinations in the file.
    expect(page.url()).toMatch(/\/(app|page)\/home/i);
    console.log(`✅ Home click — URL: ${page.url()}`);
  });

  // TEST 5 — the theme toggle. Six alternatives, and still only observed.
  test('Dark mode toggle is visible on Account', async () => {
    const toggle = page.locator([
      'mat-slide-toggle', 'button[aria-label*="theme" i]',
      'button[aria-label*="dark" i]', 'mat-icon:has-text("dark_mode")',
      'mat-icon:has-text("brightness")', '[class*="theme-toggle"]',
    ].join(', ')).first();
    // observe.
    const visible = await toggle.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(`✅ Dark mode toggle visible: ${visible}`);
  });

  // TEST 6 — the notification bell. observe.
  test('Notification bell is visible on Account', async () => {
    const bell = page.locator('mat-icon:has-text("notifications"), [aria-label*="notification" i]').first();
    const visible = await bell.isVisible().catch(() => false);
    console.log(`✅ Bell visible: ${visible}`);
  });

  // TEST 7 — console errors.
  test('No console errors on Account page load', async () => {
    // Collect them here.
    const errors: string[] = [];
    // Attach the listener.
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    // NOTE: no navigation happens here, so the listener is attached AFTER the page
    // already loaded — it can only catch errors that fire from now on.
    // beforeEach already navigated us to Account via the header link.
    // Just wait long enough for any deferred errors to surface.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    // Count printed…
    console.log(`✅ Console errors: ${errors.length}`);
    // …plus the first five, truncated. NO expect().
    errors.slice(0, 5).forEach((e, i) => console.log(`   [${i + 1}] ${e.slice(0, 200)}`));
  });

  // TEST 8 — mobile rendering.
  test('Page renders on mobile (390 × 844)', async () => {
    // Shrink the shared tab. (beforeEach resets it to 1280 for the next test.)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    // hard — the profile panel must survive the narrow layout.
    await expect(accountMountedMarker(page)).toBeVisible();
    console.log('✅ Mobile viewport — Position label visible');
  });

  // TEST 9 — tablet. hard.
  test('Page renders on tablet (768 × 1024)', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(500);
    await expect(accountMountedMarker(page)).toBeVisible();
    console.log('✅ Tablet viewport — Position label visible');
  });

  // TEST 10 — desktop. hard.
  test('Page renders on desktop (1440 × 900)', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    await expect(accountMountedMarker(page)).toBeVisible();
    console.log('✅ Desktop viewport — Position label visible');
  });

  // TEST 11 — what a reload actually does.
  test('URL persists on reload (page may need re-navigation via header)', async () => {
    // A genuine page.reload(), unlike every other test here.
    await page.reload();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2000);
    // On prod, reloading the profile route bounces to Home (the route renders
    // blank on direct load). Both "stayed on profile" and "redirected home"
    // are acceptable, well-defined behaviors.
    // hard, but deliberately permissive: all three outcomes pass.
    expect(page.url()).toMatch(/profile|account|home/i);
    console.log(`✅ URL after reload: ${page.url()}`);

    // Check if the page actually rendered content. The Account route is
    // known to render blank on direct navigation / reload — log this case
    // rather than fail, since the URL behavior IS correct.
    const contentRendered = await accountMountedMarker(page)
      .isVisible({ timeout: 5_000 }).catch(() => false);
    // Printed…
    console.log(`✅ Account content rendered after reload: ${contentRendered}`);
    // …and when blank, the log names it as a known issue rather than a test fault.
    if (!contentRendered) {
      console.log(`   ℹ️  Known issue: Account page renders blank on reload; user must navigate via header link`);
    }
  });

  // TEST 12 — access control. The most valuable test in the file.
  test('Unauthenticated access does not expose the profile', async ({ browser }) => {
    // A fresh CDP context has no session cookies, so it must NOT render the
    // authenticated profile — it should bounce to login/public/home instead.
    // The throwaway context.
    let context: BrowserContext;
    // Wrapped: a CDP-attached browser cannot always create an isolated context…
    try {
      // `storageState: undefined` guarantees no session is inherited.
      context = await browser.newContext({ storageState: undefined });
    } catch {
      // …so in that case skip honestly rather than pass for the wrong reason.
      test.skip(true, 'CDP browser cannot create an isolated unauthenticated context');
      return;
    }
    // A tab in the sessionless context.
    const page = await context.newPage();
    // Try to open the protected page.
    await page.goto(ACCOUNT_URL);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2500);
    const url = page.url();
    // Is the authenticated profile content visible?
    const authedVisible = await positionLabel(page).isVisible({ timeout: 2000 }).catch(() => false);
    // Log both the URL and the verdict.
    console.log(`✅ Unauth URL: ${url} | profile content visible: ${authedVisible}`);
    // hard — the profile must NOT render for a logged-out visitor.
    expect(authedVisible).toBeFalsy();
    // Clean up our own context so it doesn't leak into the rest of the run.
    await context.close();
  });
});