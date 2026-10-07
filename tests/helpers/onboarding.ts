/**
 * Profile onboarding components — the "Tell us more about you" → "Choose your
 * background" → "Almost done!" flow a brand-new user must finish before courses
 * unlock.
 *
 * These are the proven components extracted from tests/Profile/BGVPositive.spec.ts
 * (single source of truth). The key detail: the location fields are cascading
 * Angular Material <mat-select>s whose child lists (state, city) load
 * asynchronously — selectMatOption re-opens the panel until the option renders.
 */
// The page type, the Locator type, and the assertion library.
import { Page, Locator, expect } from '@playwright/test';
// Shared form helpers — DOB filling, Material dropdown picking, and two named selects.
import { fillDob, selectMatOption, designationSelect, orgTypeSelect } from './profileForm';
import { hiAlso } from './i18n';

// The six background options a user can pick. A union type, so a typo is a compile error.
export type Background =
  | 'Healthcare Worker' | 'Healthcare Volunteer' | 'ASHA'
  | 'Student' | 'Faculty' | 'Others';

/** Profile data used for filling. Values match the working recording. */
export const PROFILE_DATA = {
  year:    '2000',
  month:   'April',
  date:    '11',
  country: 'India',
  state:   'Assam',
  city:    'Cachar',
};

// Scroll an element into view, then click it.
export async function scrollAndClick(page: Page, locator: Locator) {
  // Bring it on screen first — Playwright can't click what isn't visible.
  await locator.scrollIntoViewIfNeeded();
  // Then click.
  await locator.click();
}

/** Escape a literal string for safe use inside a RegExp. */
export function escapeRegExp(s: string): string {
  // Backslash-prefix every regex metacharacter. $& means "whatever matched".
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert month name to its 0-based value index (January=0, February=1, ...). */
export function monthToValue(month: string): string {
  // The twelve month names in order — the index IS the value.
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  // Find the match, case-insensitively.
  const idx = months.findIndex((m) => m.toLowerCase() === month.toLowerCase());
  // findIndex returns -1 when not found; fall back to January rather than sending "-1".
  return String(idx >= 0 ? idx : 0);
}

// selectMatOption now lives in profileForm.ts (single copy, shared with the
// Profile specs). Re-exported here so existing importers keep working.
export { selectMatOption } from './profileForm';

/** Fill the "Tell us more about you" form (DOB + location). */
export async function fillTellUsMoreForm(page: Page) {
  // Announce the stage.
  console.log(`📝 Filling "Tell us more about you"`);
  // Confirm we're on the right screen before touching any field.
  await expect(page.getByText(hiAlso(/tell us more about you/i))).toBeVisible({ timeout: 10000 });

  // DOB — native <select>s addressed by accessible name. The old #year/#month/
  // #date ids are gone, Month options are labels (not numeric values), and the
  // Date select only populates once Year and Month are set. See profileForm.ts.
  await fillDob(page, PROFILE_DATA);
  // Log what we set.
  console.log(`   ✅ DOB: ${PROFILE_DATA.year}-${PROFILE_DATA.month}-${PROFILE_DATA.date}`);

  // Location — cascading Angular Material mat-selects (formcontrolname: country
  // → state → distict [sic]). Picking the country fires an async fetch that loads
  // its states; picking the state loads its cities. mat-select renders the loaded
  // options into the already-open panel, so selectMatOption just waits for the
  // exact option to appear. Country defaults to "India" but must be actively
  // clicked — that click is what triggers the state fetch.
  await selectMatOption(page, 'country', PROFILE_DATA.country);
  console.log(`   ✅ Country: ${PROFILE_DATA.country}`);

  // State next — only selectable once the country's fetch has returned.
  await selectMatOption(page, 'state', PROFILE_DATA.state);
  console.log(`   ✅ State: ${PROFILE_DATA.state}`);

  // City last, for the same reason.
  await selectMatOption(page, 'distict', PROFILE_DATA.city); // app misspells "district"
  console.log(`   ✅ City: ${PROFILE_DATA.city}`);
}

/** Click Next/Done with a 5s enabled-check. */
export async function clickAction(page: Page, label: 'Next' | 'Done') {
  // Anchored (^…$) so "Next" can't match a longer label elsewhere on the page.
  const btn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') });
  // A disabled button means the form isn't satisfied — asserting here gives a clear failure.
  await expect(btn).toBeEnabled({ timeout: 5000 });
  // Scroll to it and click.
  await scrollAndClick(page, btn);
  // Let the next screen render.
  await page.waitForTimeout(2500);
  // Log it.
  console.log(`   ✅ Clicked ${label}`);
}

/** Pick a background card from the "Choose your background" screen. */
export async function pickBackground(page: Page, bg: Background) {
  // Announce the choice.
  console.log(`🎯 Choosing background: ${bg}`);
  // Confirm we're on the right screen.
  await expect(page.getByText(hiAlso(/choose your background/i))).toBeVisible({ timeout: 10000 });

  // The card structure has multiple divs containing the background text;
  // .nth(1) is the actual clickable card div (the recording confirmed this).
  const card = page.locator('div')
    // Anchored, so "Student" can't also match "Students".
    .filter({ hasText: new RegExp(`^${bg}$`, 'i') })
    // Index 1, not 0 — index 0 is an outer wrapper that isn't clickable.
    .nth(1);
  // Click it.
  await scrollAndClick(page, card);
  // Picking a card advances the flow on its own — there's no Next button here.
  await page.waitForTimeout(1500);
}

/**
 * Fill the "Almost done!" form for the given background.
 * Uses exact field IDs from the working recording.
 */
export async function fillAlmostDone(page: Page, bg: Background) {
  // Announce the stage.
  console.log(`📝 Filling "Almost done!" for ${bg}`);
  // Confirm we're on the right screen.
  await expect(page.getByText(hiAlso(/almost done!?/i))).toBeVisible({ timeout: 10000 });

  // Each background asks for different fields, so branch on it.
  switch (bg) {
    case 'Healthcare Worker': {
      // Form fields (exact selectors from the recording):
      //   Designation        → combobox (was #profession)
      //   RN/RM Number       → text input
      //   Organization Type  → combobox (was #orgType)
      //   Organization Name  → text input
      await designationSelect(page).selectOption({ label: 'ANM/MPW' });
      console.log(`   ✅ Designation: ANM/MPW`);

      // The nursing registration number.
      await page.getByRole('textbox', { name: hiAlso(/RN\/RM Number/i) }).fill('1234');
      console.log(`   ✅ RN/RM Number: 1234`);

      // What kind of organisation they work for.
      await orgTypeSelect(page).selectOption({ label: 'Private Sector' });
      console.log(`   ✅ Org Type: Private Sector`);

      // And its name.
      await page.getByRole('textbox', { name: hiAlso(/Organization Name/i) }).fill('Aastrika');
      console.log(`   ✅ Org Name: Aastrika`);
      break;
    }
    case 'Healthcare Volunteer': {
      // `.catch(() => {})` on the selects: these option lists vary by environment,
      // so a missing option is tolerated rather than failing the whole onboarding.
      await designationSelect(page).selectOption({ label: 'Anganwadi Workers' }).catch(() => {});
      await orgTypeSelect(page).selectOption({ label: 'NGO' }).catch(() => {});
      // The org name is a free-text field, so it always works.
      await page.getByRole('textbox', { name: hiAlso(/Organization Name/i) }).fill('Aastrika Volunteer Org');
      break;
    }
    case 'ASHA': {
      // ASHA workers are identified by their administrative area instead of an employer.
      await page.getByRole('textbox', { name: hiAlso(/Block/i) }).fill('Test Block');
      await page.getByRole('textbox', { name: hiAlso(/Sub Centre/i) }).fill('Test Sub Centre');
      break;
    }
    case 'Student': {
      // Tolerated if this option isn't in the list on this environment.
      await designationSelect(page).selectOption({ label: 'Bsc nursing' }).catch(() => {});
      // Institution Name is REQUIRED — Done stays disabled without it.
      // No .catch() here, deliberately: skipping it would leave the form unsubmittable.
      await page.getByRole('textbox', { name: hiAlso(/Institution Name/i) }).fill('Aastrika Institute');
      console.log(`   ✅ Institution: Aastrika Institute`);
      // Qualification is optional and doesn't appear on every build.
      const qual = page.getByRole('textbox', { name: hiAlso(/Qualification/i) });
      // Only fill it if it's actually there.
      if (await qual.isVisible({ timeout: 1500 }).catch(() => false)) {
        await qual.fill('Bsc Nursing');
        console.log(`   ✅ Qualification: Bsc Nursing`);
      }
      break;
    }
    case 'Faculty': {
      // Optional select.
      await designationSelect(page).selectOption({ label: 'Nursing Faculty' }).catch(() => {});
      // Institution Name is REQUIRED — Done stays disabled without it.
      await page.getByRole('textbox', { name: hiAlso(/Institution Name/i) }).fill('Aastrika Institute');
      console.log(`   ✅ Institution: Aastrika Institute`);
      break;
    }
    case 'Others': {
      // The simplest branch — one optional dropdown and nothing else.
      await designationSelect(page).selectOption({ label: 'Mother/Family Members' }).catch(() => {});
      break;
    }
  }
  // Let Angular's validation run so the Done button enables.
  await page.waitForTimeout(500);
  // Log completion of this stage.
  console.log(`   ✅ "Almost done!" filled`);
}

/**
 * Complete the full onboarding flow if the user is on any of its screens.
 * No-op (returns false) when no onboarding screen is showing.
 *
 * The flow has 3 stages and the user may resume at any of them, so we loop:
 *   1. "Tell us more about you" — DOB + location → Next
 *   2. "Choose your background" — pick the card (auto-advances, no Next)
 *   3. "Almost done!"           — role form → Done
 *
 * Returns true once no onboarding screen remains (profile fully completed).
 */
export async function completeOnboarding(page: Page, bg: Background = 'Healthcare Worker'): Promise<boolean> {
  // A closed tab can't be onboarded.
  if (page.isClosed()) return false;
  // One regex matching any of the three onboarding screens.
  const onboardingRe = /tell us more about you|choose your background|almost done/i;
  // Not onboarding at all? Return false — this is the normal case for an existing user.
  if (!(await page.getByText(onboardingRe).first().isVisible({ timeout: 2500 }).catch(() => false))) return false;
  // We are onboarding, so say so.
  console.log('📝 Onboarding required — completing profile…');

  // Loop because the user may resume at any stage, and each stage leads to the next.
  // The cap of 6 guarantees termination even if a screen somehow never advances.
  for (let step = 0; step < 6 && !page.isClosed(); step++) {
    // Stage 1?
    if (await page.getByText(hiAlso(/tell us more about you/i)).first().isVisible({ timeout: 1500 }).catch(() => false)) {
      // Fill DOB and location.
      await fillTellUsMoreForm(page);
      // Advance.
      await clickAction(page, 'Next');
      // Re-check from the top — we should now be on stage 2.
      continue;
    }
    // Stage 2?
    if (await page.getByText(hiAlso(/choose your background/i)).first().isVisible({ timeout: 1500 }).catch(() => false)) {
      await pickBackground(page, bg); // picking the card advances the flow
      continue;
    }
    // Stage 3?
    if (await page.getByText(hiAlso(/almost done!?/i)).first().isVisible({ timeout: 1500 }).catch(() => false)) {
      // Fill the role-specific form.
      await fillAlmostDone(page, bg);
      // Submit it.
      await clickAction(page, 'Done');
      continue;
    }
    break; // no onboarding screen left
  }

  // Did we actually clear every stage?
  const stillOnboarding = await page.getByText(onboardingRe).first().isVisible({ timeout: 1500 }).catch(() => false);
  // Report either way.
  console.log(stillOnboarding ? '⚠️  Onboarding not fully completed' : '✅ Profile completed — user onboarded');
  // `true` means onboarding is done — note the `!`, since the variable tracks the opposite.
  return !stillOnboarding;
}
