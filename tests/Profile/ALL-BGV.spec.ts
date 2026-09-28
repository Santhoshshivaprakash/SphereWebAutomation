/**
 * Profile Completion — One Account Per Role
 * ─────────────────────────────────────────
 * Sequentially creates 6 accounts — one per background.
 * For each role:
 *   1. Fresh signup (new yopmail address)
 *   2. Fill Tell-Us-More → Next
 *   3. Pick role → fill role-specific fields → click Done (real save)
 *   4. Append the role + email to registered-accounts.xlsx
 *
 * Each test produces one row in the Playwright Excel report.
 * Credentials for all 6 roles are saved to a separate tracking xlsx
 * so you can log into any of them later.
 *
 * Run: npx playwright test tests/Profile/ALL-BGV.spec.ts --headed
 */

// The test runner, the assertion library, and three types we annotate with.
import { generateTestEmail } from '../helpers/yopmail';
import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';
// Shared form helpers. fillTellUsMore is renamed on import to avoid colliding
// with this file's own wrapper of the same name (line 254).
import { fillTellUsMore as fillTellUsMoreForm, designationSelect, orgTypeSelect } from '../helpers/profileForm';
// Node's file system module — appends to the email log.
import * as fs from 'fs';
// Node's path module — builds cross-platform file paths.
import * as path from 'path';
// The Excel library, used to write the account-tracking spreadsheet.
import ExcelJS from 'exceljs';

// Which environment to sign up on.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════
// The signup entry URL.
const CREATE_ACCOUNT_URL = `${BASE_URL}/app/create-account`;
// yopmail's English homepage.
const YOPMAIL_URL        = 'https://yopmail.com/en/';

// File locations (project root)
// `__dirname` is /tests/Profile, so two levels up is the project root.
const PROJECT_ROOT       = path.resolve(__dirname, '..', '..');
// An append-only audit log of every address created.
const EMAIL_LOG          = path.resolve(PROJECT_ROOT, 'generated-emails.txt');
// The spreadsheet of accounts, one row per role.
const ACCOUNTS_XLSX      = path.resolve(PROJECT_ROOT, 'registered-accounts.xlsx');

// The same answers are used for every role's Tell-Us-More screen.
const PROFILE_DATA = {
  year: '2000', month: 'April', date: '11',
  country: 'India', state: 'Assam', city: 'Cachar',
};

// Month names in order — the index IS the value monthToValue returns.
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// The six backgrounds. A union type, so a typo is a compile error.
type Background =
  | 'Healthcare Worker' | 'Healthcare Volunteer' | 'ASHA'
  | 'Student' | 'Faculty' | 'Others';

// The same six as an array, which is what the test loop iterates over.
const ALL_BACKGROUNDS: Background[] = [
  'Healthcare Worker', 'Healthcare Volunteer', 'ASHA',
  'Student', 'Faculty', 'Others',
];

// Per-role form data. Every field is optional because each role asks for a
// different subset — ASHA wants Block/Sub Centre, Student wants an institution.
const SAMPLE_DATA: Record<Background, {
  designation?: string; orgType?: string;
  rnNumber?: string; orgName?: string;
  block?: string; subCentre?: string;
  subBackground?: string;
  institutionName?: string; qualification?: string;
}> = {
  // Healthcare Worker: the fullest form — four fields.
  'Healthcare Worker': {
    designation: 'ANM/MPW', orgType: 'Private Sector',
    rnNumber: '1234', orgName: 'Aastrika',
  },
  // Healthcare Volunteer: no registration number.
  'Healthcare Volunteer': {
    designation: 'Anganwadi Workers', orgType: 'NGO',
    orgName: 'Aastrika Volunteer Org',
  },
  // ASHA: identified by administrative area rather than an employer.
  'ASHA':    { block: 'Test Block', subCentre: 'Test Sub Centre' },
  // Student: institution plus an optional qualification.
  'Student': { designation: 'Bsc nursing', institutionName: 'Aastrika Institute', qualification: 'Bsc Nursing' },
  // Faculty: institution, no qualification.
  'Faculty': { designation: 'Nursing Faculty', institutionName: 'Aastrika Institute' },
  // Others: a single sub-background dropdown.
  'Others':  { subBackground: 'Mother/Family Members' },
};

// ══════════════════════════════════════════════════════════════════════
// UTILITIES
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

// Build a fresh throwaway address AND log it.
function uniqueEmail(): string {
  // A random 5-digit suffix gives 90,000 possible addresses.
  const suffix = Math.floor(10000 + Math.random() * 90000);
  const email = generateTestEmail('testautomation', suffix);
  // Logging is a nicety — never let it fail the run.
  try {
    // appendFileSync ADDS to the file rather than replacing it.
    fs.appendFileSync(EMAIL_LOG, `${new Date().toISOString()}\t${email}\n`, 'utf-8');
  } catch { /* ignore */ }
  return email;
}

/**
 * Append a row to registered-accounts.xlsx. Creates the file with headers
 * if it doesn't exist. Each row = one account that was successfully saved
 * with a given role.
 */
// Append a row to registered-accounts.xlsx. Creates the file with headers if
// it doesn't exist. Each row = one account successfully saved with a role.
async function appendRegisteredAccount(record: {
  role: Background;
  email: string;
  signupMethod: string;
  formFields: Record<string, string>;
}) {
  // A workbook object to read into or build from scratch.
  const workbook = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet;
  // Tracks whether we are creating the spreadsheet from scratch.
  let isNewFile = false;

  // Existing file? Read it so we append rather than overwrite.
  if (fs.existsSync(ACCOUNTS_XLSX)) {
    await workbook.xlsx.readFile(ACCOUNTS_XLSX);
    // Reuse the sheet if it's there; create it if the file exists but the sheet doesn't.
    sheet = workbook.getWorksheet('Accounts') ?? workbook.addWorksheet('Accounts');
  // Brand-new file — build the sheet and its headers.
  } else {
    sheet = workbook.addWorksheet('Accounts');
    // Remember that this is a brand-new file, so the header styling below runs once.
    isNewFile = true;
  }

  // ALWAYS set the columns schema, even when reading an existing file: ExcelJS
  // remembers the HEADERS but not the column KEYS, and addRow({ key }) needs the
  // keys to map each value into the right column.
  // ALWAYS set the columns schema. This is required for sheet.addRow({ key })
  // to map values correctly. When reading an existing file, ExcelJS doesn't
  // remember the column keys — only the headers — so we re-declare them.
  // Column definitions: header text, the key addRow() uses, and a width.
  sheet.columns = [
    { header: '#',             key: 'index',         width: 5  },
    { header: 'Role',          key: 'role',          width: 22 },
    { header: 'Email',         key: 'email',         width: 38 },
    { header: 'Signup Method', key: 'signupMethod',  width: 14 },
    { header: 'Form Data',     key: 'formData',      width: 60 },
    { header: 'Created At',    key: 'createdAt',     width: 22 },
  ];

  // Only style the header row on a brand-new file.
  if (isNewFile) {
    // Style the header row: bold white text…
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    // …on a solid teal fill…
    sheet.getRow(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D8C' },
    };
    // …centred. (Matches the Tarento header-row convention.)
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  }

  // Find the real last data row (skip the header row at index 1)
  // lastRow is more reliable than rowCount, which can over-count when the sheet
  // has trailing empty rows. The fallback of 1 covers a sheet holding only a header.
  const lastRow = sheet.lastRow?.number ?? 1;
  const nextIdx = lastRow;   // for a fresh file, header is row 1, so first data row is #1

  // Append the record.
  sheet.addRow({
    index:        nextIdx,
    role:         record.role,
    email:        record.email,
    signupMethod: record.signupMethod,
    // Flatten the form fields into one readable "key: value | key: value" cell.
    formData:     Object.entries(record.formFields)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' | '),
    // A human-readable local timestamp.
    createdAt:    new Date().toLocaleString(),
  });

  // Write the whole workbook back to disk.
  await workbook.xlsx.writeFile(ACCOUNTS_XLSX);
  console.log(`   💾 Appended to registered-accounts.xlsx (entry #${nextIdx})`);
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

// Thin wrapper kept so the call sites below read unchanged.
async function fetchOtpFromYopmail(context: BrowserContext, email: string): Promise<string> {
  return getOtpFromYopmail(context, email);
}


// ══════════════════════════════════════════════════════════════════════
// SIGNUP + FORM HELPERS
// ══════════════════════════════════════════════════════════════════════
// Run the full Create-Account → OTP → Terms flow, landing on the private home.
async function signup(page: Page, context: BrowserContext, email: string) {
  console.log(`🚀 Signing up: ${email}`);
  // Open the signup page.
  await page.goto(CREATE_ACCOUNT_URL);
  await page.waitForLoadState('networkidle');

  // If the app bounced us to login, click through to signup.
  if (/\/public\/login/i.test(page.url())) {
    await scrollAndClick(page, page.getByRole('button', { name: /create an account/i })
      .or(page.getByText(/create an account/i)).first());
    await page.waitForTimeout(800);
  }

  // Language
  // Match English by LABEL, not by position — the screen may render in Hindi.
  const englishRadio = page.locator('mat-radio-button, [role="radio"]')
    .filter({ hasText: /english/i }).first();
  await scrollAndClick(page, englishRadio);
  await page.waitForTimeout(400);
  // Advance to the details form.
  await scrollAndClick(page, page.getByRole('button', { name: /^next$/i }));
  await page.waitForTimeout(1500);

  // Name + email + OTP
  // All inputs, addressed by position.
  const inputs = page.locator('input');
  await inputs.nth(0).fill('Test');
  await inputs.nth(1).fill('Automation');
  await inputs.nth(2).fill(email);
  // Choose the OTP login method.
  await scrollAndClick(page, page.getByText(/by otp/i).first());
  await page.waitForTimeout(400);
  // Submit the form.
  await scrollAndClick(page, page.getByRole('button', { name: /^next$/i }));
  await page.waitForTimeout(1500);

  // Confirm name
  // Sphere prints this name on certificates, so it asks the user to confirm it.
  await scrollAndClick(page, page.getByRole('button', { name: /confirm name/i })
    .or(page.getByText(/confirm name/i)).first());
  await page.waitForTimeout(2500);

  // OTP
  // Read the real code out of the yopmail inbox, in a second tab.
  const otp = await fetchOtpFromYopmail(context, email);
  await page.locator('input').first().fill(otp);
  await page.waitForTimeout(400);
  // Submit it.
  await scrollAndClick(page, page.getByRole('button', { name: /^next$/i }));
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
  // Try clicking the input itself.
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

// Open the onboarding form, unless we're already on one of its screens.
async function openProfileForm(page: Page) {
  // Three early returns: if any onboarding screen is already showing, clicking
  // Account would navigate AWAY from it.
  if (await page.getByText(/tell us more about you/i).isVisible({ timeout: 2000 }).catch(() => false)) return;
  if (await page.getByText(/almost done!?/i).isVisible({ timeout: 1000 }).catch(() => false)) return;
  if (await page.getByText(/choose your background/i).isVisible({ timeout: 1000 }).catch(() => false)) return;

  // Otherwise click the header's Account control.
  const accountBtn = page.getByRole('button', { name: /^account$/i })
    .or(page.getByText(/^account$/i)).first();
  // hard — if the header never renders, fail here rather than deeper in.
  await expect(accountBtn).toBeVisible({ timeout: 10000 });
  await scrollAndClick(page, accountBtn);
  await page.waitForTimeout(1500);
}

// Fill the DOB + location screen.
async function fillTellUsMore(page: Page) {
  // Selectors live in helpers/profileForm.ts — the old #year/#month/#date and
  // #mat-select-value-N ids no longer exist in the build.
  await fillTellUsMoreForm(page, PROFILE_DATA);
}

/**
 * Open a mat-select by its value-id and pick an option matching the label.
 * Falls back to the first available option if the named one isn't found.
 * Throws clearly if the dropdown doesn't open at all.
 */
// Open a mat-select by its value-id and pick an option matching the label.
// Falls back to the first available option if the named one isn't found.
async function pickMatSelect(page: Page, selectId: string, optionName: string) {
  console.log(`   ▶️  Opening ${selectId} → looking for "${optionName}"`);
  // Open the dropdown.
  await page.locator(selectId).click();
  await page.waitForTimeout(500);

  // Wait up to 8s for the overlay panel to have at least one option
  try {
    // waitForFunction polls INSIDE the browser until the options actually render —
    // mat-select only creates them when the panel opens, and child lists load async.
    await page.waitForFunction(
      () => document.querySelectorAll('mat-option, [role="option"]').length > 0,
      { timeout: 8000 },
    );
  // Nothing appeared — report and return rather than throw.
  } catch {
    console.log(`   ⚠️  No options appeared for ${selectId}`);
    return;
  }

  // Try the named option first
  // Match by accessible name.
  const named = page.getByRole('option', { name: new RegExp(optionName, 'i') }).first();
  if (await named.isVisible({ timeout: 1500 }).catch(() => false)) {
    // Click it; a failure is logged rather than thrown.
    await named.click().catch(async (e) => {
      console.log(`   ⚠️  Could not click named option "${optionName}": ${e?.message?.slice(0, 60)}`);
    });
    console.log(`   ✅ Picked: ${optionName}`);
    return;
  }

  // Fallback: pick the first available option (whatever it is)
  // Any option at all.
  const fallback = page.locator('mat-option, [role="option"]').first();
  if (await fallback.isVisible({ timeout: 1500 }).catch(() => false)) {
    // Record which one we settled for, so the log shows the substitution.
    const fallbackText = (await fallback.textContent())?.trim() ?? '?';
    await fallback.click();
    console.log(`   ℹ️  "${optionName}" not found, using first option: "${fallbackText}"`);
  // Neither worked — report it.
  } else {
    console.log(`   ⚠️  Dropdown ${selectId} had no clickable options`);
  }
}

// Pick a background card.
async function pickBackground(page: Page, bg: Background) {
  // hard — confirm we're on the right screen first.
  await expect(page.getByText(/choose your background/i)).toBeVisible({ timeout: 10000 });
  // Anchored so "Student" can't match "Students". Index 1, not 0 — index 0 is
  // an outer wrapper that isn't clickable.
  const card = page.locator('div').filter({ hasText: new RegExp(`^${bg}$`, 'i') }).nth(1);
  // Clicking the card advances the flow on its own — there is no Next button.
  await scrollAndClick(page, card);
  await page.waitForTimeout(1500);
}

/**
 * Fill background-specific form fields.
 * Returns the filled data so we can record it to the tracking xlsx.
 */
// Fill background-specific form fields.
// Returns the filled data so we can record it to the tracking xlsx.
async function fillBackgroundForm(page: Page, bg: Background): Promise<Record<string, string>> {
  // The sample answers for this role.
  const data = SAMPLE_DATA[bg];
  console.log(`📝 Filling form for ${bg}`);
  // What we actually filled, returned for the spreadsheet.
  const recorded: Record<string, string> = {};

  // Each role asks for a different set of fields, so branch on it.
  switch (bg) {
    // Healthcare Worker — four fields, all required.
    case 'Healthcare Worker':
      // `!` tells TypeScript this optional field is definitely set for this role.
      await designationSelect(page).selectOption({ label: data.designation! });
      console.log(`   ✅ Designation: ${data.designation}`);
      recorded.designation = data.designation!;

      // The nursing registration number.
      await page.getByRole('textbox', { name: /RN\/RM Number/i }).fill(data.rnNumber!);
      console.log(`   ✅ RN/RM Number: ${data.rnNumber}`);
      recorded.rnNumber = data.rnNumber!;

      // What kind of organisation.
      await orgTypeSelect(page).selectOption({ label: data.orgType! });
      console.log(`   ✅ Org Type: ${data.orgType}`);
      recorded.orgType = data.orgType!;

      // And its name.
      await page.getByRole('textbox', { name: /Organization Name/i }).fill(data.orgName!);
      console.log(`   ✅ Org Name: ${data.orgName}`);
      recorded.orgName = data.orgName!;
      break;

    // Healthcare Volunteer — three fields.
    case 'Healthcare Volunteer':
      // The .catch fallback addresses the select POSITIONALLY when the accessible
      // name doesn't match — this role's labels differ between builds.
      await designationSelect(page).selectOption({ label: data.designation! })
        .catch(async () => { await page.locator('select').first().selectOption({ label: data.designation! }); });
      console.log(`   ✅ Designation: ${data.designation}`);
      recorded.designation = data.designation!;

      // Same fallback for the org-type select (index 1).
      await orgTypeSelect(page).selectOption({ label: data.orgType! })
        .catch(async () => { await page.locator('select').nth(1).selectOption({ label: data.orgType! }); });
      console.log(`   ✅ Org Type: ${data.orgType}`);
      recorded.orgType = data.orgType!;

      // Free-text, so no fallback needed.
      await page.getByRole('textbox', { name: /Organization Name/i }).fill(data.orgName!);
      console.log(`   ✅ Org Name: ${data.orgName}`);
      recorded.orgName = data.orgName!;
      break;

    // ASHA — administrative area instead of an employer.
    case 'ASHA':
      await page.getByRole('textbox', { name: /Block/i }).fill(data.block!);
      console.log(`   ✅ Block: ${data.block}`);
      recorded.block = data.block!;

      await page.getByRole('textbox', { name: /Sub Centre/i }).fill(data.subCentre!);
      console.log(`   ✅ Sub Centre: ${data.subCentre}`);
      recorded.subCentre = data.subCentre!;
      break;

    // Student and Faculty share a form, so they share a case (no `break` after Student).
    case 'Student':
    case 'Faculty':
      // Designation, with the same positional fallback.
      await designationSelect(page).selectOption({ label: data.designation! })
        .catch(async () => { await page.locator('select').first().selectOption({ label: data.designation! }); });
      console.log(`   ✅ Designation: ${data.designation}`);
      recorded.designation = data.designation!;

      // Institution Name is REQUIRED for both Student and Faculty — without it
      // the Done button stays disabled. Placeholder is "Institution Name"
      // (Student) / "Institution Name*" (Faculty); the regex matches both.
      await page.getByRole('textbox', { name: /Institution Name/i }).fill(data.institutionName!);
      console.log(`   ✅ Institution: ${data.institutionName}`);
      recorded.institutionName = data.institutionName!;

      // Qualification — Student only, optional field.
      // So it is guarded twice: by role, and by whether the field rendered.
      if (bg === 'Student' && data.qualification) {
        const qual = page.getByRole('textbox', { name: /Qualification/i });
        if (await qual.isVisible({ timeout: 1500 }).catch(() => false)) {
          await qual.fill(data.qualification);
          console.log(`   ✅ Qualification: ${data.qualification}`);
          recorded.qualification = data.qualification;
        }
      }
      break;

    // Others — a single dropdown, addressed positionally.
    case 'Others':
      await page.locator('select').first().selectOption({ label: data.subBackground! });
      console.log(`   ✅ Sub-background: ${data.subBackground}`);
      recorded.subBackground = data.subBackground!;
      break;
  }
  // Let Angular's validation run so the Done button enables.
  await page.waitForTimeout(500);

  // Defensive: auto-fill ANY remaining unfilled visible required fields
  // (covers cases where Sphere adds new fields we don't know about yet).
  await autoFillRemainingFields(page, recorded);

  // Hand back what we filled.
  return recorded;
}

/**
 * Look for any visible text inputs / selects in the form that are still empty
 * and fill them with sensible defaults. This is a safety net for forms where
 * we don't yet know all the required fields.
 */
async function autoFillRemainingFields(page: Page, recorded: Record<string, string>) {
  // Inspect the form inside the browser, where getBoundingClientRect() exists.
  const fields = await page.evaluate(() => {
    // "Visible" here means big enough to be a real field — a size check rather than
    // a CSS one, which also skips zero-sized hidden inputs.
    const isVisible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.width > 30 && r.height > 15;
    };
    // Only target inputs/selects inside the profile form (avoid background cards, headers)
    // Two type filters plus one untyped catch-all — every plain text field.
    const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="number"], input:not([type])'
    )).filter(isVisible);

    // Every native select, same visibility filter.
    const allSelects = Array.from(document.querySelectorAll<HTMLSelectElement>('select'))
      .filter(isVisible);

    return {
      // Return a plain description of each field — DOM nodes cannot cross this boundary.
      inputs: allInputs.map((i) => ({
        id: i.id,
        name: i.name,
        placeholder: i.placeholder,
        ariaLabel: i.getAttribute('aria-label') ?? '',
        value: i.value,
      // Keep ONLY the empty ones — anything already filled is left alone.
      })).filter((i) => !i.value),  // only empty ones
      // Same for selects: id, name, current value, and the first five option labels.
      selects: allSelects.map((s) => ({
        id: s.id,
        name: s.name,
        value: s.value,
        optionLabels: Array.from(s.options).map((o) => o.label).slice(0, 5),
      })).filter((s) => !s.value || s.value === ''),  // only unset ones
    // Keep only the unset ones.
    };
  });

  if (fields.inputs.length === 0 && fields.selects.length === 0) return;
// Nothing left empty — return early.

  console.log(`   🔧 Auto-filling ${fields.inputs.length + fields.selects.length} remaining empty fields`);
  for (const f of fields.inputs) {
    // Fill each empty text input.
    const label = f.id || f.name || f.placeholder || f.ariaLabel || '(unnamed)';
    // Pick the most descriptive identifier available for the log.
    try {
      // Wrapped: a field that refuses input must not abort the whole sweep.
      const loc = f.id
        // Prefer the id; fall back to the name attribute.
        ? page.locator(`#${f.id}`)
        : page.locator(`input[name="${f.name}"]`).first();
      await loc.fill('Test', { timeout: 2000 });
      // A short timeout — this is a best-effort sweep, not the main path.
      console.log(`      ✅ Auto-filled input "${label}" = "Test"`);
      recorded[`autofill_${label}`] = 'Test';
    // Record what we auto-filled, so it lands in the tracking spreadsheet too.
    } catch (err: any) {
      // Report the failure with a truncated message and carry on.
      console.log(`      ⚠️  Could not auto-fill "${label}": ${err?.message?.slice(0, 60)}`);
    }
  }
  // Now the empty selects.
  for (const s of fields.selects) {
    const label = s.id || s.name || '(unnamed)';
    // Skip if no options or only the placeholder option
    // Filter out "Select…", "Choose…" and "--" placeholder entries.
    const realOptions = s.optionLabels.filter((o) => o && !/select|choose|--/i.test(o));
    // Nothing real to pick — skip this one.
    if (realOptions.length === 0) continue;
    try {
      const loc = s.id
        ? page.locator(`#${s.id}`)
        // Prefer the id; fall back to the name attribute.
        : page.locator(`select[name="${s.name}"]`).first();
      await loc.selectOption({ label: realOptions[0] }, { timeout: 2000 });
      console.log(`      ✅ Auto-selected ${label} = "${realOptions[0]}"`);
      // Take the first REAL option, whatever it is.
      recorded[`autofill_${label}`] = realOptions[0];
    } catch (err: any) {
      console.log(`      ⚠️  Could not auto-select "${label}": ${err?.message?.slice(0, 60)}`);
    }
  // Report and carry on.
  }
  await page.waitForTimeout(500);
}
// Let Angular validate after the sweep.

/**
 * One full happy-path: signup → Tell-Us-More → pick role → fill role form → click Done.
 * Saves the credentials + role to registered-accounts.xlsx on success.
 */
// One full happy path: signup → Tell-Us-More → pick role → fill → Done.
// Returns the credentials and the data, for the tracking spreadsheet.
async function runHappyPathForRole(
  bg: Background,
  context: BrowserContext,
): Promise<{ email: string; formFields: Record<string, string> }> {
  // A fresh tab for this role.
  const page = await context.newPage();

  // try/finally guarantees the tab closes even if an assertion throws.
  try {
    // Fresh signup
    // A brand-new address — each role needs its own account.
    const email = uniqueEmail();
    await signup(page, context, email);

    // Profile form
    await openProfileForm(page);
    // hard — confirm we reached stage 1 of onboarding.
    await expect(page.getByText(/tell us more about you/i)).toBeVisible({ timeout: 10000 });
    // Fill DOB and location.
    await fillTellUsMore(page);

    // The Next button.
    const nextBtn = page.getByRole('button', { name: /^next$/i });
    // It only enables once every required field is filled — so this validates the fill.
    await expect(nextBtn).toBeEnabled({ timeout: 5000 });
    await scrollAndClick(page, nextBtn);
    await page.waitForTimeout(2500);

    // Pick role
    await pickBackground(page, bg);
    // hard — confirm we reached the final stage.
    await expect(page.getByText(/almost done!?/i)).toBeVisible({ timeout: 10000 });
    // hard — and that the screen echoes back the role we actually picked.
    await expect(page.getByText(new RegExp(`background:\\s*${bg}`, 'i'))).toBeVisible();

    // Fill role-specific form
    const formFields = await fillBackgroundForm(page, bg);

    // Done must enable
    const doneBtn = page.getByRole('button', { name: /^done$/i });
    // hard — proof the role-specific form validated.
    await expect(doneBtn).toBeEnabled({ timeout: 5000 });
    console.log(`   ✅ Done button enabled`);

    // SAVE — click Done for real
    // This actually writes the profile to the server.
    await scrollAndClick(page, doneBtn);
    await page.waitForTimeout(3000);

    // Verify we landed on a private page
    const finalUrl = page.url();
    console.log(`   🏁 Final URL: ${finalUrl}`);
    // Logged in AND not on any of the public/gate routes.
    const onPrivate = /\/(app|page)\//i.test(finalUrl) &&
                      !/(create-account|signup|public\/login|terms|new-tnc)/i.test(finalUrl);
    // Neither onboarding screen may still be showing.
    const stillOnForm =
      (await page.getByText(/tell us more about you/i).isVisible({ timeout: 1500 }).catch(() => false)) ||
      (await page.getByText(/almost done!?/i).isVisible({ timeout: 1500 }).catch(() => false));

    // hard ×2 — both must hold before this role counts as saved.
    expect(onPrivate).toBe(true);
    expect(stillOnForm).toBe(false);

    console.log(`   ✅ ${bg} saved for ${email}`);
    return { email, formFields };
  // Always close this role's tab, success or failure.
  } finally {
    await page.close().catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════════════
// TEST SUITE
// ══════════════════════════════════════════════════════════════════════
// The suite: one test per background.
test.describe('Profile Completion — One Account Per Role', () => {
  // No serial mode — each role gets its own browser context, so a failure in one
  // role does not block the others. workers: 1 in playwright.config.ts still
  // guarantees they run one at a time.
  // No serial mode — each role gets its own browser context, so failures
  // in one role don't block the others. workers: 1 in playwright.config.ts
  // still ensures sequential execution.
  test.describe.configure({ retries: 0 });

  // Each test gets up to 5 min (signup + OTP + form fill)
  test.setTimeout(5 * 60 * 1000);

  // Generate one test per role rather than writing six near-identical tests.
  for (const bg of ALL_BACKGROUNDS) {
    // `testInfo` gives access to the reporter, used for the attachment below.
    test(`${bg}: fresh signup, fill all fields, click Done`, async ({ browser }, testInfo) => {
      // A banner so each role is easy to find in a long run log.
      console.log(`\n${'═'.repeat(56)}`);
      console.log(`🎯 Creating account for: ${bg}`);
      console.log(`${'═'.repeat(56)}`);

      // A fresh context per role — complete isolation between accounts.
      const context = await browser.newContext();
      // try/finally guarantees the context closes even if the run throws.
      try {
        // Do the whole journey.
        const { email, formFields } = await runHappyPathForRole(bg, context);

        // Persist credentials + role to the long-term tracking xlsx
        await appendRegisteredAccount({
          role:         bg,
          email,
          signupMethod: 'OTP',
          formFields,
        });

        // Attach account info to this test so the Excel reporter can show
        // it in the report's "Actual" / "Description" columns.
        // Flatten the fields into one readable line.
        const formSummary = Object.entries(formFields)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        // Attachments travel with the test result into the report.
        await testInfo.attach('account-info', {
          body: `Role: ${bg} | Email: ${email} | Signup: OTP | Fields: ${formSummary}`,
          contentType: 'text/plain',
        });
      // Always dispose the context.
      } finally {
        await context.close().catch(() => {});
      }
    });
  }
});