/**
 * Profile Completion — Single Background Verification
 * ──────────────────────────────────────────────────────────────────
 * Run this FIRST to validate the profile flow end-to-end on one
 * background (Healthcare Worker). Once green, we'll wire up the
 * other 5 backgrounds.
 *
 * Includes a DOM inspector that prints the structure of dropdowns
 * the first time the page loads, so we can tune selectors without
 * guessing.
 */

// The test runner, the assertion library, and three types we annotate with.
import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';
// File system + paths — used by the last step to save the new user's session.
import * as fs from 'fs';
import * as path from 'path';

// Signup can't run on the localhost mirror, so this targets staging
// (STAGING_URL) by default rather than the shared BASE_URL.
//const BASE_URL = process.env.STAGING_URL ?? 'https://staging.aastrika.org';
// Which environment to sign up on.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// The signup entry URL this whole flow starts from.
const CREATE_ACCOUNT_URL = `${BASE_URL}/app/create-account`;

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

// Find a language radio by name rather than position.
function languageOption(page: Page, name: 'english' | 'hindi'): Locator {
  // Hindi is matched in both scripts, since the screen may render in either language.
  const matcher = name === 'english' ? /english/i : /हिंदी|hindi/i;
  // Three selector shapes, covering the Material versions this app has shipped.
  return page.locator('mat-radio-button, .mat-mdc-radio-button, [role="radio"]')
    .filter({ hasText: matcher })
    .first();
}

// Select a language and verify it really took.
async function selectLanguage(page: Page, name: 'english' | 'hindi') {
  // Find it by label.
  const option = languageOption(page, name);
  // Bring it on screen.
  await option.scrollIntoViewIfNeeded();
  // Click the wrapper.
  await option.click();
  // Let Angular register the change.
  await page.waitForTimeout(400);

  // Now verify against the REAL radio input, which is what holds the checked state.
  const idx = name === 'english' ? 0 : 1;
  const radio = page.locator('input[type="radio"]').nth(idx);
  // Did the wrapper click actually check it?
  let checked = await radio.isChecked().catch(() => false);
  // If not, tick the input directly. `force` skips Playwright's clickability checks,
  // which Material's hidden input would otherwise fail.
  if (!checked) {
    await radio.check({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

// ════════════════════════════════════════════════════════════════════
// YOPMAIL OTP FETCHER — opens yopmail in another browser tab
// ════════════════════════════════════════════════════════════════════
// This is the version that was working in the earlier post-signup tests
// (browser-based, not API-based). Yopmail's API tokens change too often
// to be reliable, but the inbox UI loads fine when opened as a new tab.

// Which mail domain to use for throwaway addresses.
const OTP_MAIL_DOMAIN = process.env.OTP_MAIL_DOMAIN ?? 'yopmail.com';

// Pull the code out of a mail body. Ordered most-specific to least.
function extractOtp(text: string): string | null {
  const patterns = [
    // The exact sentence Sphere sends.
    /OTP for Aastrika Sphere Platform is\s+(\d{4,8})/i,
    // Looser: "OTP" followed by digits.
    /OTP[^0-9]+(\d{4,8})/i,
    // Loosest: any "is <digits>" phrase.
    /\bis\s+(\d{4,8})\b/i,
  ];
  // Try each in order; first match wins.
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  // Nothing matched.
  return null;
}

// Build a fresh throwaway address, e.g. "testautomation48213@yopmail.com".
function uniqueEmail(): string {
  // A random 5-digit suffix gives 90,000 possible addresses.
  const suffix = Math.floor(10000 + Math.random() * 90000);
  return `testautomation${suffix}@${OTP_MAIL_DOMAIN}`;
}

// yopmail's English homepage.
const YOPMAIL_URL = 'https://yopmail.com/en/';

// The shared, hardened OTP reader (throttling, captcha detection, retries).
import { getOtpFromYopmail } from './helpers/otp';
// Appends each signup address to the account ledger (generated-emails.txt).
import { recordCreatedEmail } from './helpers/yopmail';

// Thin wrapper kept so the call sites below read the same as they did before
// the shared helper was extracted.
async function fetchOtpFromYopmail(context: BrowserContext, email: string): Promise<string> {
  return getOtpFromYopmail(context, email);
}


// ════════════════════════════════════════════════════════════════════
// DOM INSPECTOR — logs the structure of the page so we know what
// types of dropdowns / form controls are present.
// ════════════════════════════════════════════════════════════════════
// A debugging aid, not an assertion: it prints what's on the page so selectors
// can be tuned from evidence rather than guesswork.
async function inspectProfileFormDom(page: Page) {
  // A visual banner so this block stands out in a long run log.
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  🔍 DOM INSPECTOR — Profile Form Structure`);
  console.log(`══════════════════════════════════════════════`);

  // Count each kind of control, inside the browser where `document` exists.
  const counts = await page.evaluate(() => ({
    nativeSelect:    document.querySelectorAll('select').length,
    matSelect:       document.querySelectorAll('mat-select').length,
    matMdcSelect:    document.querySelectorAll('mat-mdc-select, .mat-mdc-select').length,
    matFormField:    document.querySelectorAll('mat-form-field').length,
    inputs:          document.querySelectorAll('input').length,
    buttons:         document.querySelectorAll('button').length,
    combobox:        document.querySelectorAll('[role="combobox"]').length,
    listbox:         document.querySelectorAll('[role="listbox"]').length,
  }));
  // Print the tally, padded so the numbers line up.
  console.log(`   <select>        : ${counts.nativeSelect}`);
  console.log(`   <mat-select>    : ${counts.matSelect}`);
  console.log(`   <mat-mdc-select>: ${counts.matMdcSelect}`);
  console.log(`   <mat-form-field>: ${counts.matFormField}`);
  console.log(`   <input>         : ${counts.inputs}`);
  console.log(`   <button>        : ${counts.buttons}`);
  console.log(`   [role=combobox] : ${counts.combobox}`);
  console.log(`   [role=listbox]  : ${counts.listbox}`);

  // Print outerHTML of each dropdown (first 200 chars)
  // Now dump each dropdown's actual markup, so we can see how to address it.
  const dropdownDetails = await page.evaluate(() => {
    const out: string[] = [];
    // Every dropdown shape this app might use.
    document.querySelectorAll('select, mat-select, mat-mdc-select, .mat-mdc-select, [role="combobox"]')
      .forEach((el, i) => {
        // The element's tag name, lower-cased.
        const tag = el.tagName.toLowerCase();
        // The first 300 characters of its markup, whitespace collapsed onto one line.
        const html = (el as HTMLElement).outerHTML.slice(0, 300).replace(/\s+/g, ' ');
        // Prefix with the index, which is how the tests below address them.
        out.push(`[${i}] <${tag}> ${html}`);
      });
    return out;
  });
  // Print the header…
  console.log(`\n   Dropdowns (outerHTML preview):`);
  // …then one line per dropdown.
  dropdownDetails.forEach((d) => console.log(`   ${d}`));
  console.log(`══════════════════════════════════════════════\n`);
}

// ════════════════════════════════════════════════════════════════════
// DROPDOWN HELPER — handles native AND Material dropdowns
// ════════════════════════════════════════════════════════════════════
// The profile form mixes native <select>s (DOB) with Material ones (location),
// and the two are driven completely differently — hence this helper.
async function selectDropdownOption(
  page: Page,
  dropdown: Locator,
  optionLabel: string | RegExp,
) {
  // Bring it on screen.
  await dropdown.scrollIntoViewIfNeeded();
  // Ask the browser what kind of element this actually is.
  const tagName = await dropdown.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');

  // ── Native <select>: use Playwright's built-in selectOption. ──
  if (tagName === 'select') {
    // Native HTML <select>
    // A plain string can be passed straight through as the label.
    if (typeof optionLabel === 'string') {
      await dropdown.selectOption({ label: optionLabel });
    } else {
      // A regex can't be — so read every option's text…
      const opts = await dropdown.locator('option').allTextContents();
      // …find the one that matches…
      const match = opts.find((o) => optionLabel.test(o));
      // …and fail clearly if none does.
      if (!match) throw new Error(`No option matching ${optionLabel} in native select`);
      // Then select it by its exact label.
      await dropdown.selectOption({ label: match });
    }
    return;
  }

  // Material custom select — click to open, then click the option
  // Material renders its options into a floating panel, so they don't exist until it opens.
  // Find the option in that panel, covering three Material versions.
  const option = page.locator('mat-option, .mat-mdc-option, [role="option"]')
    .filter({ hasText: optionLabel })
    .first();
  // State and City lists load from the server AFTER the previous pick. If the
  // panel opens before they arrive it can stay empty, so: open, wait up to 15s,
  // and if the option still isn't there, close and reopen once.
  for (let attempt = 1; attempt <= 2; attempt++) {
    await dropdown.click();
    // Let the panel render.
    await page.waitForTimeout(500);
    const shown = await option.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
    if (shown) break;
    if (attempt === 2) throw new Error(`No option matching ${optionLabel} appeared in the dropdown`);
    // Close the empty panel and give the list time to load before reopening.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2_000);
  }
  // Click it.
  await option.click();
  // Let the panel close.
  await page.waitForTimeout(300);
}

// ════════════════════════════════════════════════════════════════════
// TEST
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
// POSITIVE FLOW — every step of signup → OTP → T&C → profile completion is
// its OWN test case (granular reporting). A shared page/context carries the
// flow; describe.serial runs them in order and stops if a step fails (a later
// step can't run if an earlier one didn't complete).
// ════════════════════════════════════════════════════════════════════
// The designation the new user signs up with (Step 21).
const DESIGNATION = process.env.PROFILE_DESIGNATION || 'BSC Nurse';

test.describe.serial('Positive Flow — signup → T&C → profile completion (Healthcare Worker)', () => {
  // The context all 26 steps share.
  let ctx: BrowserContext;
  // The single tab the flow is driven in.
  let page: Page;
  // The address this run signs up with.
  let email = '';

  // DOB (native <select>) + Country/State/City (mat-select) dropdowns, in order.
  // Written as a function, not a constant, because `page` doesn't exist until beforeAll runs.
  const dropdowns = () => page.locator('select, mat-select, mat-mdc-select, .mat-mdc-select, [role="combobox"]');

  // Runs once, before step 01.
  test.beforeAll(async ({ browser }) => {
    // A clean context — no stored login.
    ctx = await browser.newContext();
    // The one tab the whole flow uses.
    page = await ctx.newPage();
    // Mint the address.
    email = uniqueEmail();
    // Record it in the account ledger before signup, so it is kept even if a later step fails.
    recordCreatedEmail(email, 'positiveflow');
    // Log it up front so a failure at any step still tells you which account was involved.
    console.log(`\n🚀 Positive-flow account: ${email}`);
  });

  // Runs once, after the last step.
  test.afterAll(async () => {
    // Close the context (and its tab). Errors swallowed so teardown can't fail the run.
    await ctx?.close().catch(() => {});
  });

  // ─── SIGNUP ──────────────────────────────────────────────────────
  test('Step 01 — Open the Create Account page', async () => {
    // Allow a minute — a cold signup page can be slow.
    test.setTimeout(60_000);
    // Navigate.
    await page.goto(CREATE_ACCOUNT_URL);
    // Let it settle; ignore if the network never fully idles.
    await page.waitForLoadState('networkidle').catch(() => {});
    // Proof of arrival: either the Next button or a language radio must be on screen.
    await expect(
      page.getByRole('button', { name: /^next$/i })
        .or(page.locator('mat-radio-button').first()).first(),
    ).toBeVisible({ timeout: 15_000 });
    console.log('   ✅ Create Account page loaded');
  });

  test('Step 02 — Select language "English" and click Next', async () => {
    // Pick English and verify the radio really checked.
    await selectLanguage(page, 'english');
    // Advance to the details form.
    await scrollAndClick(page, page.getByRole('button', { name: /^next$/i }));
    // Let the form render.
    await page.waitForTimeout(1500);
    console.log('   ✅ Language selected, advanced to the details form');
  });

  test('Step 03 — Fill First name, Last name and Email', async () => {
    // All inputs on the form, addressed by position.
    const inputs = page.locator('input');
    // Box 0 — first name.
    await inputs.nth(0).fill('Test');
    // Box 1 — last name.
    await inputs.nth(1).fill('Automation');
    // Box 2 — the email/phone field.
    await inputs.nth(2).fill(email);
    console.log(`   ✅ Filled name + email (${email})`);
  });

  test('Step 04 — Choose the "By OTP" login method', async () => {
    // Click the OTP option.
    await scrollAndClick(page, page.getByText(/by otp/i).first());
    // Let the choice register.
    await page.waitForTimeout(400);
    console.log('   ✅ "By OTP" selected');
  });

  test('Step 05 — Submit the signup form (Next)', async () => {
    // Submit.
    await scrollAndClick(page, page.getByRole('button', { name: /^next$/i }));
    // Wait for the confirm-name modal to mount.
    await page.waitForTimeout(2500);
    console.log('   ✅ Signup form submitted');
  });

  test('Step 06 — Confirm the name on the confirmation modal', async () => {
    // Find the confirm button as a real button, falling back to plain text.
    const confirmBtn = page.getByRole('button', { name: /confirm name/i })
      .or(page.getByText(/confirm name/i)).first();
    // It must appear — Sphere prints this name on certificates.
    await expect(confirmBtn).toBeVisible({ timeout: 8_000 });
    // Click it.
    await scrollAndClick(page, confirmBtn);
    // Wait for the OTP request to fire and the next screen to render.
    await page.waitForTimeout(2500);
    console.log('   ✅ Name confirmed');
  });

  test('Step 07 — Fetch the OTP from yopmail and enter it', async () => {
    // Allow 2.5 minutes — polling a real inbox is slow by design.
    test.setTimeout(150_000);
    // Open yopmail in a second tab and read the code.
    const otp = await fetchOtpFromYopmail(ctx, email);
    // A code must have come back.
    expect(otp, 'OTP should be fetched from yopmail').toBeTruthy();
    // Type it into the first input on the OTP screen.
    await page.locator('input').first().fill(otp);
    // Let validation run.
    await page.waitForTimeout(400);
    console.log(`   ✅ OTP entered: ${otp}`);
  });

  test('Step 08 — Submit the OTP (Next)', async () => {
    // Submit the code.
    await scrollAndClick(page, page.getByRole('button', { name: /^next$/i }));
    // Give the server time to create the account.
    await page.waitForTimeout(3000);
    console.log('   ✅ OTP submitted');
  });

  // ─── TERMS OF USE ────────────────────────────────────────────────
  test('Step 09 — Terms of Use page is displayed', async () => {
    // A brand-new account is always shown the terms first.
    await expect(page.getByText(/terms of use/i).first()).toBeVisible({ timeout: 10_000 });
    console.log('   ✅ Terms of Use page shown');
  });

  test('Step 10 — Tick the "I have read and agree" checkbox', async () => {
    // The consent checkbox.
    const checkbox = page.locator('input[type="checkbox"]').first();
    // Try clicking the input itself first.
    await scrollAndClick(page, checkbox);
    // Material often hides the real input behind a label, so if that didn't take, click the label.
    if (!(await checkbox.isChecked().catch(() => false))) {
      await scrollAndClick(page, page.getByText(/i have read and agree/i).first());
    }
    // Let the state settle.
    await page.waitForTimeout(500);
    // Either way, it must end up checked — Accept is gated on it.
    expect(await checkbox.isChecked().catch(() => false)).toBe(true);
    console.log('   ✅ Consent checkbox ticked');
  });

  test('Step 11 — Click Accept on the Terms of Use', async () => {
    // Accept the terms. English OR Hindi: the portal has intermittently served this
    // page in Hindi even though English was picked in Step 02.
    await scrollAndClick(page, page.getByRole('button', { name: /^(accept|स्वीकार करना|स्वीकार करें)$/i }));
    // Wait for the redirect into the app.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(4000);
    console.log(`   ✅ Accepted Terms — URL: ${page.url()}`);
  });

  // ─── PROFILE COMPLETION ──────────────────────────────────────────
  test('Step 12 — Open the profile form ("Tell us more about you")', async () => {
    // Some builds drop straight into onboarding; others land on home first.
    if (!(await page.getByText(/tell us more about you/i).isVisible({ timeout: 2500 }).catch(() => false))) {
      // Not there — navigate via the Account control, as a button or as text.
      const accountBtn = page.getByRole('button', { name: /^account$/i })
        .or(page.getByText(/^account$/i)).first();
      await scrollAndClick(page, accountBtn);
      await page.waitForTimeout(1500);
    }
    // Either way, we must now be on the onboarding form.
    await expect(page.getByText(/tell us more about you/i)).toBeVisible({ timeout: 10_000 });
    // Dump the form's structure, so the positional dropdown indices below can be verified.
    await inspectProfileFormDom(page);
    console.log('   ✅ Profile form opened');
  });

  test('Step 13 — Select Date of Birth: Year (1995)', async () => {
    // Dropdown 0 is Year. Anchored regex so "1995" can't match "11995".
    await selectDropdownOption(page, dropdowns().nth(0), /^1995$/);
    console.log('   ✅ Year selected');
  });

  test('Step 14 — Select Date of Birth: Month (January)', async () => {
    // Dropdown 1 is Month.
    await selectDropdownOption(page, dropdowns().nth(1), /january/i);
    console.log('   ✅ Month selected');
  });

  test('Step 15 — Select Date of Birth: Date (15)', async () => {
    // Dropdown 2 is Date. It only populates once Year and Month are both set.
    await selectDropdownOption(page, dropdowns().nth(2), /^15$/);
    console.log('   ✅ Date selected');
  });

  test('Step 16 — Select Country (India)', async () => {
    // Dropdown 3 is Country. Choosing it triggers the async fetch that loads the states.
    await selectDropdownOption(page, dropdowns().nth(3), /india/i);
    // Give that fetch time to return.
    await page.waitForTimeout(500);
    console.log('   ✅ Country selected');
  });

  test('Step 17 — Select State (Karnataka)', async () => {
    // Dropdown 4 is State. This one loads the cities.
    await selectDropdownOption(page, dropdowns().nth(4), /karnataka/i);
    await page.waitForTimeout(500);
    console.log('   ✅ State selected');
  });

  test('Step 18 — Select City (Bengaluru)', async () => {
    // Dropdown 5 is City. Both spellings accepted — the data source uses either.
    await selectDropdownOption(page, dropdowns().nth(5), /bengaluru|bangalore/i);
    console.log('   ✅ City selected');
  });

  test('Step 19 — Click Next to background selection', async () => {
    // The Next button.
    const nextBtn = page.getByRole('button', { name: /^next$/i });
    // It only enables once every required field is filled — so this also validates steps 13–18.
    await expect(nextBtn).toBeEnabled({ timeout: 5_000 });
    // Advance.
    await scrollAndClick(page, nextBtn);
    await page.waitForTimeout(2000);
    // Confirm we reached the next stage.
    await expect(page.getByText(/choose your background/i)).toBeVisible({ timeout: 8_000 });
    console.log('   ✅ Background selection screen shown');
  });

  test('Step 20 — Select background: Healthcare Worker', async () => {
    // Anchored, so it can't also match "Healthcare Worker Volunteer".
    const hcw = page.getByText(/^healthcare worker$/i).first();
    // It must be on screen.
    await expect(hcw).toBeVisible();
    // Click the card — this advances the flow on its own, with no Next button.
    await scrollAndClick(page, hcw);
    await page.waitForTimeout(1500);
    // Confirm we reached the final stage.
    await expect(page.getByText(/almost done!?/i)).toBeVisible({ timeout: 8_000 });
    console.log('   ✅ Healthcare Worker selected — "Almost done!" shown');
  });

  // PROFILE_DESIGNATION picks the role (default "BSC Nurse"). Competencies depend
  // on it: "Normal delivery" and the other maternal-care ones belong to ANM/MPW,
  // so the course + competency CI job signs its user up with PROFILE_DESIGNATION=ANM/MPW.
  test(`Step 21 — Select Designation (${DESIGNATION})`, async () => {
    // Re-inspect: this screen has its own, different set of dropdowns.
    await inspectProfileFormDom(page);
    // On this screen the selects are native, so address them directly. Index 0 is Designation.
    const designation = page.locator('select').nth(0);
    // Wait for it to render.
    await designation.waitFor({ state: 'visible', timeout: 5_000 });
    // Match the label loosely ("ANM/MPW", "ANM / MPW"…), then select it exactly.
    const want = new RegExp('^\\s*' + DESIGNATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\?\//g, '\\s*/?\\s*') + '\\s*$', 'i');
    const opts = await designation.locator('option').allTextContents();
    const index = opts.findIndex((o) => want.test(o));
    if (index === -1) throw new Error(`No designation matching "${DESIGNATION}". Options: ${opts.map((o) => o.trim()).join(' | ')}`);
    const match = opts[index];
    // By position, not label: some option texts carry padding (" ANM/MPW ") that
    // an exact label match never finds.
    await designation.selectOption({ index });
    await page.waitForTimeout(300);
    console.log(`   ✅ Designation selected: ${match.trim()}`);
  });

  test('Step 22 — Fill RN/RM Number (nursing roles only)', async () => {
    // The nursing registration number field, matched by its placeholder.
    const rn = page.getByPlaceholder(/rn\/rm number/i);
    // Only nursing designations ask for it — skip for roles like ANM/MPW.
    const needed = await rn.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!needed && !/nurse/i.test(DESIGNATION), `no RN/RM field for ${DESIGNATION}`);
    // Wait for it.
    await rn.waitFor({ state: 'visible', timeout: 5_000 });
    // Type a value.
    await rn.fill('1234');
    await page.waitForTimeout(300);
    console.log('   ✅ RN/RM Number filled');
  });

  test('Step 23 — Select Organization Type', async () => {
    // Index 1 is Organization Type.
    const orgType = page.locator('select').nth(1);
    await orgType.waitFor({ state: 'visible', timeout: 5_000 });
    // The label carries the app's own typo ("Institue"), so it must be matched verbatim.
    await orgType.selectOption({ label: 'Academic Institue- Public' });
    await page.waitForTimeout(300);
    console.log('   ✅ Organization Type selected');
  });

  test('Step 24 — Fill Organization Name', async () => {
    // The org name field, by placeholder.
    const org = page.getByPlaceholder(/organization name/i);
    await org.waitFor({ state: 'visible', timeout: 5_000 });
    // Type a value.
    await org.fill('Aastrika');
    await org.press('Tab'); // blur to enable Done
    // Angular validates on blur, so without the Tab the Done button stays disabled.
    await page.waitForTimeout(500);
    console.log('   ✅ Organization Name filled');
  });

  test('Step 25 — Click Done to submit the profile', async () => {
    // The submit button.
    const doneBtn = page.getByRole('button', { name: /^done$/i });
    // Enabled means the whole form validated.
    await expect(doneBtn).toBeEnabled({ timeout: 5_000 });
    // Submit.
    await scrollAndClick(page, doneBtn);
    // Wait for the save and the redirect.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(4000);
    console.log(`   ✅ Done clicked — URL: ${page.url()}`);
  });

  test('Step 26 — Profile submitted (no longer on the profile form)', async () => {
    // Are any of the three onboarding screens still showing?
    const stillOnForm = await page.getByText(/tell us more about you|almost done|choose your background/i)
      .first().isVisible({ timeout: 3000 }).catch(() => false);
    // Log both readings before asserting, so a failure still shows where we ended up.
    console.log(`   Final URL: ${page.url()} | still on profile form: ${stillOnForm}`);
    // Leaving onboarding behind is the proof that the profile actually saved.
    expect(stillOnForm).toBe(false);
    console.log('   🎉 Positive flow complete');
  });

  // Hand the fully-onboarded user to later specs. create-account saves its session
  // right after T&C, but that user has no profile yet, so authedTest rejects it
  // ("onboarding unfinished") and the course / competency runners can't use it.
  // This one has finished onboarding. Consumed by authedTest when USE_FRESH_USER=1.
  test('Step 27 — Save the onboarded user\'s session for later specs', async () => {
    const authDir = path.resolve(__dirname, '..', '.auth');
    fs.mkdirSync(authDir, { recursive: true });
    // Cookies plus origin storage — signup users are OTP-only, so there is no password to reuse.
    await ctx.storageState({ path: path.resolve(authDir, 'fresh-user.json') });
    // Record which account the session belongs to, the same files create-account writes.
    fs.writeFileSync(path.resolve(authDir, 'fresh-user-email.json'), JSON.stringify({ email, timestamp: Date.now() }, null, 2));
    fs.writeFileSync(path.resolve(__dirname, '..', '.last-registered-email.json'), JSON.stringify({ email, timestamp: Date.now() }, null, 2));
    console.log(`   💾 Onboarded session saved for ${email} → .auth/fresh-user.json`);
  });
});
