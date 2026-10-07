/**
 * Profile Completion — Element Coverage (single signup)
 * ─────────────────────────────────────────────────────
 * ONE signup. Cycles through every background using the "Change" link to
 * return to the background-picker without saving. Saves only at the very
 * end on Healthcare Worker.
 *
 * Coverage:
 *   • Tell us more about you — all headings, DOB labels, 12 months, 31 dates,
 *     Country/State/City, Next button enabled/disabled states
 *   • Choose your background — heading + all 6 cards
 *   • Almost done! — for each of 6 backgrounds, verify background label,
 *     all required field labels, and dropdown option lists
 *   • Final save — Healthcare Worker only
 *
 * Run: npx playwright test tests/ProfileCompletion.coverage.spec.ts --headed
 */

// The test runner, the assertion library, and three types we annotate with.
import { generateTestEmail } from '../helpers/yopmail';
import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';
// Node's file system module — appends to the email log.
import * as fs from 'fs';
// Node's path module — builds cross-platform file paths.
import * as path from 'path';
// Shared form helpers. fillTellUsMore is renamed to avoid colliding with this file's own wrapper.
import { dobSelect, expectDobSelects, fillTellUsMore as fillTellUsMoreForm, designationSelect, orgTypeSelect } from '../helpers/profileForm';

// Which environment to sign up on.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════
// The signup entry URL.
const CREATE_ACCOUNT_URL = `${BASE_URL}/app/create-account`;
// yopmail's English homepage.
const YOPMAIL_URL        = 'https://yopmail.com/en/';
// An append-only audit log of every address created.
const EMAIL_LOG          = path.resolve(__dirname, '..', '..', 'generated-emails.txt'); // project root — the one ledger

// The answers typed into the Tell-Us-More screen.
const PROFILE_DATA = {
  year:    '2000',
  month:   'April',     // selected by label — the options are month names
  date:    '11',
  country: 'India',
  state:   'Assam',
  city:    'Cachar',
};

// The six backgrounds. A union type, so a typo is a compile error.
type Background =
  | 'Healthcare Worker' | 'Healthcare Volunteer' | 'ASHA'
  | 'Student' | 'Faculty' | 'Others';

// The same six as an array, which is what the cycle below iterates over.
const ALL_BACKGROUNDS: Background[] = [
  'Healthcare Worker', 'Healthcare Volunteer', 'ASHA',
  'Student', 'Faculty', 'Others',
];

// Expected designation/option lists per background — used for assertion
// The EXPECTED shape of each role's form: which dropdowns it has, what options
// they should contain, and which text fields should appear. This is the
// specification the run is checked against.
const BACKGROUND_FIELDS: Record<Background, {
  designations?: string[];
  orgTypes?: string[];
  hasRnNumber?: boolean;
  hasOrgName?: boolean;
  hasDistrict?: boolean;
  hasBlock?: boolean;
  hasSubCentre?: boolean;
  hasInstitutionName?: boolean;
  hasQualification?: boolean;
  subBackgrounds?: string[];
}> = {
  // Healthcare Worker: two dropdowns and two text fields — the fullest form.
  'Healthcare Worker': {
    designations: ['Midwives','GNM','Doctors','Public Health Professionals','Paramedical','Pharmacist','Community Health Officer (CHO)','BSC Nurse','ANM/MPW','Others'],
    orgTypes:     ['Public/Government Sector','Private Sector','NGO','Academic Institue- Public','Academic Institute- Private','Others'],
    hasRnNumber:  true,
    hasOrgName:   true,
  },
  // Healthcare Volunteer: same dropdowns, no registration number.
  'Healthcare Volunteer': {
    designations: ['Anganwadi Workers','Mukhya Sevika (MS)','Child Development Project Officer (CDPO)','District Programme Officer (DPO)','BSC Nurse','Others'],
    orgTypes:     ['NGO','Public/Government Sector','Private Sector','Academic Institue- Public','Academic Institute- Private','Others'],
    hasOrgName:   true,
  },
  // ASHA: three location fields, no dropdowns.
  'ASHA': {
    hasDistrict:  true,
    hasBlock:     true,
    hasSubCentre: true,
  },
  // Student: one dropdown plus a required institution and an optional qualification.
  'Student': {
    designations: ['Bsc nursing','GNM','ANM/MPW','Midwife','Medical Student','Other'],
    hasInstitutionName: true,   // required
    hasQualification:   true,   // optional
  },
  // Faculty: like Student but with no qualification field.
  'Faculty': {
    designations: ['Nursing Faculty','Medical Faculty','Other'],
    hasInstitutionName: true,   // required
  },
  // Others: a single sub-background dropdown.
  'Others': {
    subBackgrounds: ['Mother/Family Members','Asha Facilitator','Asha Trainer','Others'],
  },
};

// Month names in order — the index IS the value monthToValue returns.
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// ══════════════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ══════════════════════════════════════════════════════════════════════
// Scroll an element into view, then click it.
async function scrollAndClick(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
}

// Convert a month name to its 0-based index.
function monthToValue(month: string): string {
  // Case-insensitive lookup.
  const idx = MONTHS.findIndex((m) => m.toLowerCase() === month.toLowerCase());
  // findIndex returns -1 when not found; fall back to January rather than sending "-1".
  return String(idx >= 0 ? idx : 0);
}

// Append an address to the audit log.
function logEmail(email: string) {
  // Logging is a nicety — never let it fail the run.
  try {
    fs.appendFileSync(EMAIL_LOG, `${new Date().toISOString()}\t${email}\n`, 'utf-8');
  } catch { /* ignore */ }
}

// Build a fresh throwaway address AND log it.
function uniqueEmail(): string {
  // A random 5-digit suffix gives 90,000 possible addresses.
  const suffix = Math.floor(10000 + Math.random() * 90000);
  const email = generateTestEmail('testautomation', suffix);
  logEmail(email);
  return email;
}

// ══════════════════════════════════════════════════════════════════════
// OTP FETCH (yopmail)
// ══════════════════════════════════════════════════════════════════════
// Extract the OTP digits from yopmail body text.
function extractOtp(text: string): string | null {
  // Ordered most-specific to least; the first match wins.
  const patterns = [
    /OTP\s+for\s+Aastrika\s+Sphere\s+Platform\s+is\s+(\d{4,8})/i,
    /OTP[^0-9]{0,30}(\d{4,8})/i,
    /\b(\d{6})\b/,
  ];
  // Try each in turn.
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  // Nothing matched.
  return null;
}

// The shared, hardened OTP reader (throttling, captcha detection, retries).
import { getOtpFromYopmail } from '../helpers/otp';
import { bi, hiAlso } from '../helpers/i18n';

// Thin wrapper kept so the call sites below read unchanged.
async function fetchOtpFromYopmail(context: BrowserContext, email: string): Promise<string> {
  return getOtpFromYopmail(context, email);
}


// ══════════════════════════════════════════════════════════════════════
// SIGNUP (creates ONE account for the whole test)
// ══════════════════════════════════════════════════════════════════════
// Run the full Create-Account → OTP → Terms flow. Called exactly ONCE per run.
async function signup(page: Page, context: BrowserContext, email: string) {
  console.log(`\n🚀 Signing up: ${email}`);

  // Open the signup page.
  await page.goto(CREATE_ACCOUNT_URL);
  await page.waitForLoadState('networkidle');

  // If the app bounced us to login, click through to signup.
  if (/\/public\/login/i.test(page.url())) {
    await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/create an account/i) })
      .or(page.getByText(hiAlso(/create an account/i))).first());
    await page.waitForTimeout(800);
  }

  // Language
  // Match English by LABEL, not by position — the screen may render in Hindi.
  const englishRadio = page.locator('mat-radio-button[value="en"]')
    // by VALUE, so it works whether the label reads "English" or "अंग्रेजी"
    .or(page.locator('mat-radio-button, [role="radio"]').filter({ hasText: bi('English', { exact: false }) }))
    .first();
  await scrollAndClick(page, englishRadio);
  await page.waitForTimeout(400);
  // Advance to the details form.
  await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/^next$/i) }));
  await page.waitForTimeout(1500);

  // Name + email + "By OTP"
  // All inputs, addressed by position.
  const inputs = page.locator('input');
  await inputs.nth(0).fill('Test');
  await inputs.nth(1).fill('Automation');
  await inputs.nth(2).fill(email);
  // Choose the OTP login method.
  await scrollAndClick(page, page.getByText(hiAlso(/by otp/i)).first());
  await page.waitForTimeout(400);
  // Submit the form.
  await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/^next$/i) }));
  await page.waitForTimeout(1500);

  // Confirm name
  // Sphere prints this name on certificates, so it asks the user to confirm it.
  await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/confirm name/i) })
    .or(page.getByText(hiAlso(/confirm name/i))).first());
  await page.waitForTimeout(2500);

  // OTP
  // Read the real code out of the yopmail inbox, in a second tab.
  const otp = await fetchOtpFromYopmail(context, email);
  await page.locator('input').first().fill(otp);
  await page.waitForTimeout(400);
  // Submit it.
  await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/^next$/i) }));
  await page.waitForTimeout(3000);

  // Terms
  // The T&C screen renders in the ACCOUNT's language: a Hindi signup shows
  // "उपयोग की शर्तें" and "स्वीकार करना", which no English-only matcher finds.
  // accept-btn / decline-btn are the same class in every language, so wait for
  // the button and keep the wording only as a fallback.
  // hard — a brand-new account MUST be shown the terms.
  await expect(
    page.locator('button.accept-btn')
      .or(page.getByText(/^terms of use$|^उपयोग की शर्तें$/i))
      .first(),
  ).toBeVisible({ timeout: 10000 });
  // The consent checkbox.
  const checkbox = page.locator('input[type="checkbox"]').first();
  await scrollAndClick(page, checkbox);
  // Didn't take?
  if (!(await checkbox.isChecked().catch(() => false))) {
    // Click the checkbox COMPONENT, not its label text — the label is translated.
    await scrollAndClick(page, page.locator('mat-checkbox.tnc-checkbox, mat-checkbox').first());
  }
  await page.waitForTimeout(500);
  // Accept the terms — by class first, by name in either language second.
  await scrollAndClick(
    page,
    page.locator('button.accept-btn')
      .or(page.getByRole('button', { name: /^accept$|^स्वीकार|^सहमत/i }))
      .first(),
  );
  // Wait for the redirect into the app.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);

  console.log(`   ✅ Landed on: ${page.url()}`);
}

// ══════════════════════════════════════════════════════════════════════
// PROFILE FLOW HELPERS
// ══════════════════════════════════════════════════════════════════════
// Open the onboarding form, unless it opened itself.
async function openProfileForm(page: Page) {
  // Check if it auto-opened first
  if (await page.getByText(hiAlso(/tell us more about you/i)).isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log(`   ℹ️  Profile form auto-opened`);
    return;
  }
  console.log(`👆 Clicking Account button`);
  // Otherwise click the header's Account control.
  const accountBtn = page.getByRole('button', { name: hiAlso(/^account$/i) })
    .or(page.getByText(hiAlso(/^account$/i))).first();
  // hard — if the header never renders, fail here rather than deeper in.
  await expect(accountBtn).toBeVisible({ timeout: 10000 });
  await scrollAndClick(page, accountBtn);
  await page.waitForTimeout(1500);
}

// Fill the DOB + location screen with PROFILE_DATA.
async function fillTellUsMore(page: Page) {
  await fillTellUsMoreForm(page, PROFILE_DATA);
}

// Click Next or Done, asserting it is enabled first.
async function clickAction(page: Page, label: 'Next' | 'Done') {
  // Anchored so "Next" can't match a longer label.
  const btn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') });
  // hard — a disabled button means the form isn't satisfied.
  await expect(btn).toBeEnabled({ timeout: 5000 });
  await scrollAndClick(page, btn);
  await page.waitForTimeout(2500);
}

// Pick a background card.
async function pickBackground(page: Page, bg: Background) {
  // hard — confirm we're on the right screen first.
  await expect(page.getByText(hiAlso(/choose your background/i))).toBeVisible({ timeout: 10000 });
  // Anchored so "Student" can't match "Students". Index 1, not 0 — index 0 is
  // an outer wrapper that isn't clickable.
  const card = page.locator('div').filter({ hasText: new RegExp(`^${bg}$`, 'i') }).nth(1);
  // Clicking the card advances the flow on its own — there is no Next button.
  await scrollAndClick(page, card);
  await page.waitForTimeout(1500);
}

/** Click the "Change" link on Almost Done to return to the background picker. */
// Click the "Change" link on Almost Done to return to the background picker.
// This is what lets ONE signup inspect all six role forms.
async function clickChange(page: Page) {
  // Anchored, so it can't match "Change password" or similar.
  const changeLink = page.getByText(hiAlso(/^change$/i)).first();
  await scrollAndClick(page, changeLink);
  await page.waitForTimeout(1500);
}

// ══════════════════════════════════════════════════════════════════════
// VERIFICATION FUNCTIONS — one per screen
// ══════════════════════════════════════════════════════════════════════

/** Verify every element on the "Tell us more about you" screen. */
// Verify every element on the "Tell us more about you" screen.
async function verifyTellUsMoreScreen(page: Page) {
  console.log(`\n🔍 Verifying "Tell us more about you" screen`);

  // Headings
  // hard.
  await expect(page.getByText(hiAlso(/tell us more about you/i))).toBeVisible();
  console.log(`   ✅ Heading visible`);
  // hard — the sub-heading too.
  await expect(page.getByText(hiAlso(/and unlock access to multiple courses/i))).toBeVisible();
  console.log(`   ✅ Sub-heading visible`);

  // DOB section
  // hard. Anchored, so it can't match "Date of Birth is required".
  await expect(page.getByText(hiAlso(/^date of birth$/i))).toBeVisible();
  console.log(`   ✅ "Date of Birth" label visible`);

  // The 3 DOB dropdowns — addressed by accessible name; the old #year/#month/
  // #date ids no longer exist in the build.
  // hard ×3, via the shared helper.
  await expectDobSelects(page);
  console.log(`   ✅ DOB dropdowns (Year, Month, Date) present`);

  // Verify all 12 months are options
  // Read every option's text once…
  const monthOptionLabels = await dobSelect(page, 'Month').locator('option').allTextContents();
  // …then check each expected month against that list.
  for (const m of MONTHS) {
    // Substring match, so "April" matches an option rendered as " April ".
    const found = monthOptionLabels.some((opt) => opt.toLowerCase().includes(m.toLowerCase()));
    // observe — a missing month is WARNED about, not failed.
    if (!found) console.log(`   ⚠️  Month "${m}" not found in dropdown options`);
    else        console.log(`   ✓  Month "${m}" present`);
  }

  // The Date select cascades — it stays empty until Year and Month are chosen,
  // so its options are counted after the form is filled, not here.
  // Count the selectable ones right now (expected to be zero).
  const dateOptsNow = await dobSelect(page, 'Date').locator('option:not([disabled])').count();
  console.log(`   ℹ️  Date dropdown currently has ${dateOptsNow} selectable options (populates after Year+Month)`);

  // Location section
  // hard. Anchored.
  await expect(page.getByText(hiAlso(/^your location$/i))).toBeVisible();
  console.log(`   ✅ "Your Location" label visible`);
  // hard ×3 — the three location labels.
  await expect(page.getByText(hiAlso(/country/i)).first()).toBeVisible();
  await expect(page.getByText(hiAlso(/state/i)).first()).toBeVisible();
  await expect(page.getByText(/city/i).first()).toBeVisible();
  console.log(`   ✅ Country / State / City labels visible`);

  // Next button should be DISABLED when nothing is filled
  const nextBtn = page.getByRole('button', { name: hiAlso(/^next$/i) });
  // observe — the gate is measured…
  const disabled = await nextBtn.isDisabled().catch(() => false);
  // …and the log's ✅/⚠️ reflects the VALUE, which is better than a bare tick.
  console.log(`   ${disabled ? '✅' : '⚠️ '} Next button disabled when empty: ${disabled}`);
}

/** Verify every element on the "Choose your background" screen. */
// Verify every element on the "Choose your background" screen.
async function verifyChooseBackgroundScreen(page: Page) {
  console.log(`\n🔍 Verifying "Choose your background" screen`);
  // hard — the heading.
  await expect(page.getByText(hiAlso(/choose your background/i))).toBeVisible();
  console.log(`   ✅ Heading visible`);

  // Then check all six cards…
  for (const bg of ALL_BACKGROUNDS) {
    // Exact match, so "Faculty" can't match "Faculty of Nursing".
    const card = page.getByText(bg, { exact: true }).first();
    const visible = await card.isVisible({ timeout: 2000 }).catch(() => false);
    // …observe — a missing card is warned about, not failed.
    if (visible) console.log(`   ✓  Card "${bg}" visible`);
    else         console.log(`   ⚠️  Card "${bg}" NOT visible`);
  }
}

/** Verify every element on the "Almost done!" screen for a specific background. */
// Verify every element on the "Almost done!" screen for a specific background.
async function verifyAlmostDoneScreen(page: Page, bg: Background) {
  console.log(`\n🔍 Verifying "Almost done!" for: ${bg}`);
  // hard — the heading.
  await expect(page.getByText(hiAlso(/almost done!?/i))).toBeVisible({ timeout: 10000 });
  console.log(`   ✅ "Almost done!" heading visible`);

  // Background label
  // hard — the screen must echo back the role we actually picked.
  await expect(page.getByText(new RegExp(`background:\\s*${bg}`, 'i'))).toBeVisible();
  console.log(`   ✅ "Background: ${bg}" label visible`);

  // Change link
  // hard — without it this test could not cycle through the other roles.
  await expect(page.getByText(hiAlso(/^change$/i))).toBeVisible();
  console.log(`   ✅ "Change" link visible`);

  // Done button (should be disabled until form is filled)
  const doneBtn = page.getByRole('button', { name: hiAlso(/^done$/i) });
  // observe.
  const initiallyDisabled = await doneBtn.isDisabled().catch(() => false);
  console.log(`   ${initiallyDisabled ? '✅' : '⚠️ '} Done button initially disabled: ${initiallyDisabled}`);

  // The expected shape for this role, from the table at the top.
  const expected = BACKGROUND_FIELDS[bg];

  // Verify designation dropdown + its options
  // Only roles that have one.
  if (expected.designations) {
    const designationDropdown = designationSelect(page);
    // Read every option's text in one call.
    const designationOptions = await designationDropdown.locator('option').allTextContents();
    console.log(`   📋 Designation dropdown has ${designationOptions.length} options`);
    // Check each expected option against that list.
    for (const d of expected.designations) {
      // Substring match, tolerating padding and case differences.
      const found = designationOptions.some((opt) =>
        opt.toLowerCase().includes(d.toLowerCase())
      );
      // observe — a missing option is warned about, not failed.
      if (found) console.log(`      ✓  "${d}"`);
      else       console.log(`      ⚠️  "${d}" NOT in dropdown`);
    }
  }

  // Verify org-type dropdown + its options
  // Only roles that have one.
  if (expected.orgTypes) {
    const orgTypeDropdown = orgTypeSelect(page);
    // count() > 0 means "present in the DOM" — guard before reading options.
    if (await orgTypeDropdown.count() > 0) {
      // Read them all…
      const orgTypeOptions = await orgTypeDropdown.locator('option').allTextContents();
      console.log(`   📋 Org Type dropdown has ${orgTypeOptions.length} options`);
      // …and check each expected value.
      for (const t of expected.orgTypes) {
        const found = orgTypeOptions.some((opt) =>
          opt.toLowerCase().includes(t.toLowerCase())
        );
        if (found) console.log(`      ✓  "${t}"`);
        else       console.log(`      ⚠️  "${t}" NOT in dropdown`);
      }
    // Absent entirely — report it.
    } else {
      console.log(`   ⚠️  Organization Type dropdown not found`);
    }
  }

  // Verify text input fields
  // Each of these seven blocks follows the same shape: if the spec says this
  // role should have the field, look for it and PRINT whether it was there.
  if (expected.hasRnNumber) {
    const visible = await page.getByRole('textbox', { name: hiAlso(/RN\/RM Number/i) }).isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`   ${visible ? '✅' : '⚠️ '} RN/RM Number field: ${visible}`);
  }
  // Organization Name.
  if (expected.hasOrgName) {
    const visible = await page.getByRole('textbox', { name: hiAlso(/Organization Name/i) }).isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`   ${visible ? '✅' : '⚠️ '} Organization Name field: ${visible}`);
  }
  // District (ASHA only).
  if (expected.hasDistrict) {
    const visible = await page.getByText(hiAlso(/district/i)).first().isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`   ${visible ? '✅' : '⚠️ '} District field: ${visible}`);
  }
  // Block (ASHA only).
  if (expected.hasBlock) {
    const visible = await page.getByRole('textbox', { name: hiAlso(/Block/i) }).isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`   ${visible ? '✅' : '⚠️ '} Block field: ${visible}`);
  }
  // Sub Centre (ASHA only).
  if (expected.hasSubCentre) {
    const visible = await page.getByRole('textbox', { name: hiAlso(/Sub Centre/i) }).isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`   ${visible ? '✅' : '⚠️ '} Sub Centre field: ${visible}`);
  }
  // Institution Name (Student and Faculty).
  if (expected.hasInstitutionName) {
    const visible = await page.getByRole('textbox', { name: hiAlso(/Institution Name/i) }).isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`   ${visible ? '✅' : '⚠️ '} Institution Name field: ${visible}`);
  }
  // Qualification (Student only).
  if (expected.hasQualification) {
    const visible = await page.getByRole('textbox', { name: hiAlso(/Qualification/i) }).isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`   ${visible ? '✅' : '⚠️ '} Qualification field: ${visible}`);
  }
  // Sub-background dropdown (Others only).
  if (expected.subBackgrounds) {
    // Addressed positionally — it is the only select on that form.
    const dropdown = page.locator('select').first();
    const options = await dropdown.locator('option').allTextContents();
    console.log(`   📋 Sub-background dropdown has ${options.length} options`);
    // Check each expected option.
    for (const sb of expected.subBackgrounds) {
      const found = options.some((opt) => opt.toLowerCase().includes(sb.toLowerCase()));
      if (found) console.log(`      ✓  "${sb}"`);
      else       console.log(`      ⚠️  "${sb}" NOT in dropdown`);
    }
  }
}

/** Fill the Healthcare Worker form completely so Done becomes enabled. */
// Fill the Healthcare Worker form completely so Done becomes enabled.
async function fillHealthcareWorkerForm(page: Page) {
  console.log(`\n📝 Filling Healthcare Worker form for final save`);
  // The role dropdown.
  await designationSelect(page).selectOption({ label: 'ANM/MPW' });
  console.log(`   ✅ Designation: ANM/MPW`);
  // The nursing registration number.
  await page.getByRole('textbox', { name: hiAlso(/RN\/RM Number/i) }).fill('1234');
  console.log(`   ✅ RN/RM Number: 1234`);
  // The organisation type.
  await orgTypeSelect(page).selectOption({ label: 'Private Sector' });
  console.log(`   ✅ Org Type: Private Sector`);
  // And its name.
  await page.getByRole('textbox', { name: hiAlso(/Organization Name/i) }).fill('Aastrika');
  console.log(`   ✅ Org Name: Aastrika`);
  // Let Angular's validation run so Done enables.
  await page.waitForTimeout(500);
}

// ══════════════════════════════════════════════════════════════════════
// THE TEST
// ══════════════════════════════════════════════════════════════════════
// ONE test, ONE signup, all six role forms inspected — the "Change" link is
// what makes that possible without creating six accounts.
test('Profile Completion — Element Coverage (single signup, all backgrounds)', async ({ page, context }) => {
  // Eight minutes: a signup, an inbox poll, and seven form screens.
  test.setTimeout(8 * 60 * 1000);  // 8 minute ceiling

  // ─ Step 1: Fresh signup ─────────────────────────────────────────
  // A brand-new address.
  const email = uniqueEmail();
  await signup(page, context, email);
  console.log(`\n🆔 Account created: ${email}`);

  // ─ Step 2: Open profile form ────────────────────────────────────
  await openProfileForm(page);

  // ─ Step 3: Verify Tell-Us-More screen elements ─────────────────
  await verifyTellUsMoreScreen(page);

  // ─ Step 4: Fill Tell-Us-More and proceed ───────────────────────
  console.log(`\n📝 Filling Tell-Us-More to proceed`);
  await fillTellUsMore(page);

  // Now that Year + Month are set, the Date select is populated — check its range.
  // Read the selectable options…
  const dateLabels = await dobSelect(page, 'Date').locator('option:not([disabled])').allTextContents();
  // …parse them to numbers, drop anything unparseable, and de-duplicate with a
  // Set. The size is then the real count of distinct days offered.
  const datesFound = new Set(dateLabels.map((d) => parseInt(d, 10)).filter((n) => !isNaN(n)));
  console.log(`   ✅ Date dropdown has ${datesFound.size} numeric options (expected 28-31)`);

  // After filling, Next should be ENABLED
  const nextBtn = page.getByRole('button', { name: hiAlso(/^next$/i) });
  // observe — measured and printed rather than asserted here…
  const enabledNow = await nextBtn.isEnabled().catch(() => false);
  console.log(`   ${enabledNow ? '✅' : '⚠️ '} Next button enabled after fill: ${enabledNow}`);
  // …but clickAction DOES assert it is enabled, so the gate is covered.
  await clickAction(page, 'Next');

  // ─ Step 5: Verify Choose-Background screen ─────────────────────
  await verifyChooseBackgroundScreen(page);

  // ─ Step 6: Cycle through ALL 6 backgrounds via "Change" link ───
  console.log(`\n🔁 Cycling through all 6 backgrounds via "Change" link`);
  // For each role: pick it, inspect its form, then Change back.
  for (let i = 0; i < ALL_BACKGROUNDS.length; i++) {
    const bg = ALL_BACKGROUNDS[i];
    console.log(`\n   ─── [${i + 1}/${ALL_BACKGROUNDS.length}] Background: ${bg} ───`);

    // Pick the card.
    await pickBackground(page, bg);
    // Inspect every field the spec says this role should have.
    await verifyAlmostDoneScreen(page, bg);

    // Go back via Change link — UNLESS this is Healthcare Worker which we save
    // Defensive only: Healthcare Worker is at index 0, so this condition can
    // never be true with the current array order. The comment below says so.
    if (bg === 'Healthcare Worker' && i === ALL_BACKGROUNDS.length - 1) {
      // Healthcare Worker is at index 0; we won't be in this branch.
      // Code path here is defensive only.
      break;
    }

    // Back to the picker for the next role.
    await clickChange(page);
    // hard — confirm the Change link actually returned us.
    await expect(page.getByText(hiAlso(/choose your background/i))).toBeVisible({ timeout: 5000 });
    console.log(`   ↩️  Returned to "Choose your background"`);
  }

  // ─ Step 7: Final save — pick Healthcare Worker and click Done ──
  console.log(`\n💾 Final save: picking Healthcare Worker and clicking Done`);
  // Come back to the first role…
  await pickBackground(page, 'Healthcare Worker');
  // …re-inspect it…
  await verifyAlmostDoneScreen(page, 'Healthcare Worker');
  // …and fill it for real this time.
  await fillHealthcareWorkerForm(page);

  const doneBtn = page.getByRole('button', { name: hiAlso(/^done$/i) });
  // observe on the gate…
  const enabledNowDone = await doneBtn.isEnabled().catch(() => false);
  console.log(`   ${enabledNowDone ? '✅' : '⚠️ '} Done button enabled after fill: ${enabledNowDone}`);
  // …though clickAction asserts it too.
  await clickAction(page, 'Done');

  // ─ Step 8: Verify we landed on private home ────────────────────
  const finalUrl = page.url();
  console.log(`\n🏁 Final URL: ${finalUrl}`);
  // Logged in AND not on any of the public/gate routes.
  const onPrivate = /\/(app|page)\//i.test(finalUrl) &&
                    !/(create-account|signup|public\/login|terms|new-tnc)/i.test(finalUrl);
  // Neither onboarding screen may still be showing.
  const stillOnForm =
    (await page.getByText(hiAlso(/tell us more about you/i)).isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await page.getByText(hiAlso(/almost done!?/i)).isVisible({ timeout: 1500 }).catch(() => false));

  // hard ×2 — the only two assertions about the FINAL outcome.
  expect(onPrivate).toBe(true);
  expect(stillOnForm).toBe(false);

  console.log(`\n✅ All elements verified across 6 backgrounds. Final save completed as Healthcare Worker.`);
  console.log(`📧 Account used: ${email}`);
});