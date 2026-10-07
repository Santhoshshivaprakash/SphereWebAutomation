/**
 * "Tell us more about you" — DOB + location controls.
 * ───────────────────────────────────────────────────
 * The app used to give the DOB selects stable ids (#year / #month / #date) and
 * the location mat-selects auto-generated ones (#mat-select-value-0..2). Both
 * are gone / unstable now:
 *
 *   • DOB selects are native <select> exposed as comboboxes named
 *     "Year" / "Month" / "Date" — no ids at all.
 *   • Month options are LABELS ("April"), not the numeric indices the old
 *     `monthToValue()` produced.
 *   • The Date select is EMPTY until Year and Month are both chosen — it
 *     cascades, so its options cannot be asserted before then.
 *   • Location comboboxes are named "Country" / "State" / "City/District"
 *     (note: no longer plain "City"). #mat-select-value-N is an Angular
 *     Material counter that shifts as components mount — never address it.
 *
 * Locators here prefer the accessible name and fall back to the old id, so
 * they work against both the current build and any environment still serving
 * the previous DOM.
 */
// The assertion library, the page type, and the Locator type these helpers return.
import { expect, Page, Locator } from '@playwright/test';
import { hiAlso } from './i18n';

// The three date-of-birth dropdowns. A union type, so a typo is a compile error.
export type DobField = 'Year' | 'Month' | 'Date';
// The three location dropdowns.
export type LocationField = 'Country' | 'State' | 'City';

/** The native DOB <select> for one field. */
export function dobSelect(page: Page, field: DobField): Locator {
  return page
    // Preferred: the accessible name, anchored so "Year" can't match "Year of joining".
    .getByRole('combobox', { name: new RegExp(`^${field}$`, 'i') })
    // Fallback for older builds that still have the ids.
    .or(page.locator(`select#${field.toLowerCase()}`))
    .first();
}

/** The location mat-select for one field. "City" also matches "City/District". */
export function locationSelect(page: Page, field: LocationField): Locator {
  // City is special: the build renamed it to "City/District", so accept both spellings.
  const name = field === 'City' ? /^city(\s*\/\s*district)?$/i : new RegExp(`^${field}$`, 'i');
  // Match by accessible name only — never by #mat-select-value-N, which shifts as components mount.
  return page.getByRole('combobox', { name }).first();
}

/** Escape a literal string for safe use inside a RegExp. */
export function escapeRegExp(s: string): string {
  // Backslash-prefix every regex metacharacter. $& means "whatever matched".
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** formControlName for each location field — note the app's own misspelling. */
const LOCATION_CONTROL: Record<LocationField, string> = {
  Country: 'country',
  State: 'state',
  City: 'distict', // app misspells "district"
};

/**
 * Open an Angular Material mat-select by its formControlName and pick the option
 * whose accessible name exactly matches `value`.
 *
 * Child selects (state, city) fetch their options asynchronously after the parent
 * changes, and mat-select only renders options when the panel opens — so a panel
 * opened before the list arrived stays empty. Re-open until the option appears.
 * Exact anchored matching avoids partial hits ("India" → "British Indian Ocean
 * Territory").
 */
export async function selectMatOption(page: Page, formControl: string, value: string) {
  // The closed dropdown we click to open.
  const trigger = page.locator(`mat-select[formcontrolname="${formControl}"]`);
  // The floating panel Material renders when a select is open.
  const panel = page.locator('.mat-mdc-select-panel');
  // The option we want, anchored at both ends so "India" can't match "British Indian Ocean Territory".
  const option = panel
    .getByRole('option', { name: new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`, 'i') })
    .first();

  // `expect(fn).toPass()` retries the whole block until it succeeds or 30s elapse.
  // That's the mechanism that handles "options hadn't loaded when we opened the panel".
  await expect(async () => {
    // If a panel is already open (from a previous failed attempt), close it first.
    if (await panel.count()) {
      // Escape dismisses a Material select.
      await page.keyboard.press('Escape');
      // Wait until it's really gone before reopening.
      await expect(panel).toHaveCount(0, { timeout: 3000 });
    }
    // Open the dropdown.
    await trigger.click();
    // If the option isn't there, this throws — and toPass() retries the whole block.
    await expect(option).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });

  // The option is on screen — select it.
  await option.click();
  // Wait for the panel to close. Non-fatal: the click already registered.
  await expect(panel).toHaveCount(0, { timeout: 5000 }).catch(() => {});
}

/**
 * "Almost done!" selects. The build dropped the #profession / #orgType ids in
 * favour of accessible names ("Designation", "Organization Type"); the option
 * lists themselves are unchanged. Old ids kept as a fallback.
 */
export function designationSelect(page: Page): Locator {
  return page
    // `\*?` makes the required-field asterisk optional, so "Designation" and "Designation*" both match.
    .getByRole('combobox', { name: hiAlso(/^designation\*?$/i) })
    // Fallback to the old id.
    .or(page.locator('#profession'))
    .first();
}

// The "Organization Type" dropdown on the same screen.
export function orgTypeSelect(page: Page): Locator {
  return page
    // [sz] accepts both the American "Organization" and British "Organisation" spellings.
    .getByRole('combobox', { name: /^organi[sz]ation type\*?$/i })
    // Fallback to the old id.
    .or(page.locator('#orgType'))
    .first();
}

/** Assert the three DOB selects are present. */
export async function expectDobSelects(page: Page, timeout = 15_000) {
  // Check each in turn. The cast tells TypeScript these strings are DobField values.
  for (const f of ['Year', 'Month', 'Date'] as DobField[]) {
    // `toBeAttached` = present in the DOM. Deliberately weaker than toBeVisible, because
    // the Date select exists but may be empty until Year and Month are chosen.
    await expect(dobSelect(page, f), `DOB "${f}" select should be present`).toBeAttached({ timeout });
  }
}

/**
 * Fill Date of Birth. Order matters — Date is populated by the app only once
 * Year and Month are set, so we wait for its options to arrive before picking.
 */
export async function fillDob(
  page: Page,
  dob: { year: string; month: string; date: string },
) {
  // Year first. Selecting by LABEL, not value — the build switched Month to text labels.
  await dobSelect(page, 'Year').selectOption({ label: dob.year });
  // Month second. Both must be set before Date populates.
  await dobSelect(page, 'Month').selectOption({ label: dob.month });

  // Now the Date select.
  const dateSel = dobSelect(page, 'Date');
  // `expect.poll` re-runs the function until it passes — waiting for the app to fill the list.
  await expect
    .poll(async () => dateSel.locator('option:not([disabled])').count(), {
      // Shown if this times out, so the failure explains itself.
      message: 'Date options should populate after Year + Month are chosen',
      timeout: 15_000,
    })
    // At least one selectable day must exist before we try to pick one.
    .toBeGreaterThan(0);

  // Now it's safe to choose the day.
  await dateSel.selectOption({ label: dob.date });
}

/** Choose a location value, addressing the mat-select by its formControlName. */
export async function pickLocation(page: Page, field: LocationField, value: string) {
  // Translate the friendly field name into the app's formControlName (including its misspelling).
  await selectMatOption(page, LOCATION_CONTROL[field], value);
}

/** Fill the whole screen: DOB then Country → State → City (each cascades). */
export async function fillTellUsMore(
  page: Page,
  data: { year: string; month: string; date: string; country: string; state: string; city: string },
) {
  // Date of birth first.
  await fillDob(page, data);
  // Country — this populates the State list.
  await pickLocation(page, 'Country', data.country);
  // State — this populates the City list. Order is not optional.
  await pickLocation(page, 'State', data.state);
  // City last.
  await pickLocation(page, 'City', data.city);
}
