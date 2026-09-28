/**
 * Profile Completion — Positive Flow
 * ──────────────────────────────────
 * One straight-through test:
 *   1. Sign up (or reuse last credentials if profile is incomplete)
 *   2. Land on home
 *   3. Click Account button in header
 *   4. Fill "Tell us more about you" (DOB + location) → Next
 *   5. Pick Healthcare Worker background → Next
 *   6. Fill "Almost done!" (designation + org details) → Done
 *
 * All in ONE tab, no closing. If the signup completed but the profile
 * isn't filled (e.g. previous run died mid-flow), reuse the stored
 * credentials and continue from wherever we are.
 *
 * Usage:
 *   npx playwright test tests/ProfileCompletion.spec.ts --headed
 */

// The test runner, the assertion library, and three types we annotate with.
import { generateTestEmail } from '../helpers/yopmail';
import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';
// Node's file system module — persists the email between runs.
import * as fs from 'fs';
// Node's path module — builds cross-platform file paths.
import * as path from 'path';
// Shared profile-onboarding components (single source of truth).
// Shared onboarding components, so this file doesn't re-implement the form filling.
import {
  Background, PROFILE_DATA, scrollAndClick, fillTellUsMoreForm,
  clickAction, pickBackground, fillAlmostDone,
} from '../helpers/onboarding';

// Which environment to sign up on.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════
// The signup entry URL.
const CREATE_ACCOUNT_URL = `${BASE_URL}/app/create-account`;
// The login page, used when reusing a stored account.
const PUBLIC_LOGIN_URL   = `${BASE_URL}/public/login`;
// yopmail's English homepage.
const YOPMAIL_URL        = 'https://yopmail.com/en/';
// Where the last-used email is remembered between runs.
const EMAIL_RECORD       = path.resolve(__dirname, '..', '.last-registered-email.json');
// An append-only audit log of every address this suite has created.
const EMAIL_LOG          = path.resolve(__dirname, '..', 'generated-emails.txt');

// Profile data + the Background type/helpers now live in ../helpers/onboarding.
// This file only exercises ONE background; the sibling ALL-BGV covers the rest.
const BACKGROUND: Background = 'Healthcare Worker';

// ══════════════════════════════════════════════════════════════════════
// URL HELPERS
// ══════════════════════════════════════════════════════════════════════
/**
 * Sphere lands users on /page/home, /app/home, or other /app/* routes
 * after login. These all count as "private" (logged-in) areas.
 * Public pages are /public/login, /app/create-account, /terms, etc.
 */
// "Are we logged in?" — checked by ROUTE, not by any element, so it works
// whatever language the app is rendering in.
function isPrivateUrl(url: string): boolean {
  // Public routes first: these disqualify the URL outright…
  const isPublic = /\/(public\/login|create-account|signup|terms)/i.test(url);
  if (isPublic) return false;
  // …otherwise any /page/ or /app/ route counts as private.
  return /\/(page|app)\//i.test(url);
}

// ══════════════════════════════════════════════════════════════════════
// EMAIL HELPERS — generate, store, reuse
// ══════════════════════════════════════════════════════════════════════

/** Get the last-registered email from disk (used to reuse incomplete signups). */
// Get the last-registered email from disk (used to reuse incomplete signups).
function getStoredEmail(): string | null {
  // No file yet — first run.
  if (!fs.existsSync(EMAIL_RECORD)) return null;
  try {
    // Read and parse it; `?? null` covers a file that exists but lacks the key.
    return JSON.parse(fs.readFileSync(EMAIL_RECORD, 'utf-8')).email ?? null;
  // Corrupt JSON is treated as "no stored email" rather than crashing the run.
  } catch { return null; }
}

/** Save the email so we can reuse it next time if the profile flow died. */
// Save the email so we can reuse it next time if the profile flow died.
function saveEmail(email: string) {
  // Overwrite the record with the current address and a timestamp.
  fs.writeFileSync(EMAIL_RECORD, JSON.stringify({ email, savedAt: new Date().toISOString() }, null, 2));
  // Also append to the running log for human auditing
  try {
    // appendFileSync ADDS to the file rather than replacing it, so the log accumulates.
    fs.appendFileSync(EMAIL_LOG, `${new Date().toISOString()}\t${email}\n`, 'utf-8');
  // Logging is a nicety — never let it fail the run.
  } catch { /* ignore */ }
}

/** Create a new unique yopmail address and persist it. */
// Create a new unique yopmail address and persist it.
function generateAndSaveEmail(): string {
  // A random 5-digit suffix gives 90,000 possible addresses.
  const suffix = Math.floor(10000 + Math.random() * 90000);
  const email = generateTestEmail('testautomation', suffix);
  // Persist it BEFORE returning, so a crash mid-signup still leaves a usable record.
  saveEmail(email);
  return email;
}

/** Delete the stored email record so the next run creates a fresh account. */
// Delete the stored email record so the next run creates a fresh account.
function clearStoredEmail() {
  // Only if it exists.
  if (fs.existsSync(EMAIL_RECORD)) {
    fs.unlinkSync(EMAIL_RECORD);
  }
}

// scrollAndClick now lives in ../helpers/onboarding (shared).

// ══════════════════════════════════════════════════════════════════════
// SIGNUP FLOW (yopmail OTP)
// ══════════════════════════════════════════════════════════════════════

/** Extract the OTP digits from yopmail body text. */
// Extract the OTP digits from yopmail body text.
function extractOtp(text: string): string | null {
  // Ordered most-specific to least; the first match wins.
  const patterns = [
    // The exact sentence Sphere sends.
    /OTP\s+for\s+Aastrika\s+Sphere\s+Platform\s+is\s+(\d{4,8})/i,
    // Looser: "OTP" followed by digits within 30 characters.
    /OTP[^0-9]{0,30}(\d{4,8})/i,
    // Loosest: any standalone 6-digit run.
    /\b(\d{6})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  // Nothing matched — null lets the caller retry rather than fail on a half-loaded mail.
  return null;
}

/** Open yopmail in a tab and pull the OTP for the given email. */
// The shared, hardened OTP reader (throttling, captcha detection, retries).
import { getOtpFromYopmail } from '../helpers/otp';

// Thin wrapper kept so the call sites below read unchanged.
async function fetchOtpFromYopmail(context: BrowserContext, email: string): Promise<string> {
  return getOtpFromYopmail(context, email);
}


/**
 * Run the full Create-Account → OTP → Terms flow.
 * Lands on the private home page.
 */
// Run the full Create-Account → OTP → Terms flow, landing on the private home.
// This is a condensed copy of create-account.spec.ts's happy path.
async function signup(page: Page, context: BrowserContext, email: string) {
  console.log(`🚀 Signing up: ${email}`);

  // Open the signup page.
  await page.goto(CREATE_ACCOUNT_URL);
  await page.waitForLoadState('networkidle');

  // If redirected to /public/login, click "Create an account"
  if (/\/public\/login/i.test(page.url())) {
    const createBtn = page.getByRole('button', { name: /create an account/i })
      .or(page.getByText(/create an account/i)).first();
    await scrollAndClick(page, createBtn);
    await page.waitForTimeout(800);
  }

  // Step 1: language
  // Match English by LABEL, not by position — the screen may render in Hindi.
  const englishRadio = page.locator('mat-radio-button, [role="radio"]')
    .filter({ hasText: /english/i }).first();
  await scrollAndClick(page, englishRadio);
  await page.waitForTimeout(400);
  // Advance to the details form.
  await scrollAndClick(page, page.getByRole('button', { name: /^next$/i }));
  await page.waitForTimeout(1500);

  // Step 2: name + email + "By OTP"
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

  // Step 3: confirm name
  // Sphere prints this name on certificates, so it asks the user to confirm it.
  await scrollAndClick(page, page.getByRole('button', { name: /confirm name/i })
    .or(page.getByText(/confirm name/i)).first());
  await page.waitForTimeout(2500);

  // Step 4: OTP
  // Read the real code out of the yopmail inbox, in a second tab.
  const otp = await fetchOtpFromYopmail(context, email);
  // Type it in.
  await page.locator('input').first().fill(otp);
  await page.waitForTimeout(400);
  // Submit it.
  await scrollAndClick(page, page.getByRole('button', { name: /^next$/i }));
  await page.waitForTimeout(3000);

  // Step 5: Terms of Use
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
  // Did that take?
  const checked = await checkbox.isChecked().catch(() => false);
  // If not, fall back…
  if (!checked) {
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

  // Log where we landed.
  console.log(`   ✅ Landed on: ${page.url()}`);
}

// ══════════════════════════════════════════════════════════════════════
// PROFILE FORM HELPERS
// ══════════════════════════════════════════════════════════════════════

/** Click the Account button in the header to open the profile flow. */
// Click the Account button in the header to open the profile flow.
async function openProfileForm(page: Page) {
  console.log(`👆 Clicking Account button`);
  // Three shapes: it is a <button> on this SPA, not a link.
  const accountBtn = page.getByRole('button', { name: /^account$/i })
    .or(page.getByRole('link', { name: /^account$/i }))
    .or(page.getByText(/^account$/i))
    .first();
  // hard — if the header never renders, fail here rather than deeper in.
  await expect(accountBtn).toBeVisible({ timeout: 10000 });
  // Open the profile panel.
  await scrollAndClick(page, accountBtn);
  await page.waitForTimeout(1500);
}

// fillTellUsMoreForm, selectMatOption, clickAction, pickBackground, fillAlmostDone,
// monthToValue and escapeRegExp now live in ../helpers/onboarding (shared, imported
// above). openProfileForm stays here because it's specific to this signup flow.

// ══════════════════════════════════════════════════════════════════════
// FLOW STATE DETECTION
// ══════════════════════════════════════════════════════════════════════
//
// After login/signup, the user lands on one of these screens. We detect
// which one and resume from there.
// ──────────────────────────────────────────────────────────────────────
// The four screens a user can land on after login. Modelling them explicitly
// is what lets this test RESUME a half-finished profile instead of restarting.
type FlowState =
  | 'home'             // private home — need to click Account button
  | 'tell-us-more'     // already on "Tell us more about you"
  | 'choose-bg'        // already on "Choose your background"
  | 'almost-done'      // already on "Almost done!"
  | 'unknown';

// Work out which screen we're on right now.
async function detectFlowState(page: Page): Promise<FlowState> {
  // Let the page settle before looking.
  await page.waitForTimeout(800);

  // If we hit a T&C re-acceptance page, accept it and recurse to detect again
  if (/\/new-tnc|\/terms|\/tnc/i.test(page.url())) {
    // Clear the gate first, then fall through and detect the real screen.
    await acceptTnCIfPresent(page);
    await page.waitForTimeout(1000);
  }

  // Checked in REVERSE flow order — furthest-along screen first, so a resumed
  // run continues from where it stopped rather than redoing earlier steps.
  if (await page.getByText(/almost done!?/i).isVisible({ timeout: 1500 }).catch(() => false)) {
    return 'almost-done';
  }
  if (await page.getByText(/choose your background/i).isVisible({ timeout: 1500 }).catch(() => false)) {
    return 'choose-bg';
  }
  if (await page.getByText(/tell us more about you/i).isVisible({ timeout: 1500 }).catch(() => false)) {
    return 'tell-us-more';
  }
  // Not on any onboarding screen, but logged in → we're on home.
  if (isPrivateUrl(page.url()) && !/\/new-tnc|\/terms|\/tnc/i.test(page.url())) {
    return 'home';
  }
  // None of the above — the caller will report this rather than guess.
  return 'unknown';
}

// ══════════════════════════════════════════════════════════════════════
// LOGIN HELPERS — for reusing an existing account
// ══════════════════════════════════════════════════════════════════════

/**
 * Try logging in with an existing email via OTP.
 * Returns true if we land on a private page, false otherwise.
 */
// Try logging in with an existing email via OTP.
// Returns true if we land on a private page, false otherwise.
async function loginExistingAccount(page: Page, context: BrowserContext, email: string): Promise<boolean> {
  console.log(`🔐 Attempting login with existing account: ${email}`);
  // Open the login page.
  await page.goto(PUBLIC_LOGIN_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Step 1: Click the "Login with OTP" tab/toggle at the top
  const otpTab = page.getByText(/login with otp/i).first();
  // Only click it if it's there.
  if (await otpTab.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log(`   👆 Clicking "Login with OTP" tab`);
    await scrollAndClick(page, otpTab);
    await page.waitForTimeout(800);
  } else {
    // Warn rather than fail — OTP may already be the default mode.
    console.log(`   ⚠️  "Login with OTP" tab not found — UI may have changed`);
  }

  // Step 2: Fill email
  // Prefer the accessible name; fall back to "the first input that isn't a
  const emailInput = page.getByRole('textbox', { name: /phone.*email|email|phone/i }).first()
    // radio, password, hidden or checkbox" — which leaves the identifier field.
    .or(page.locator('input:not([type="radio"]):not([type="password"]):not([type="hidden"]):not([type="checkbox"])').first());
  await emailInput.fill(email);
  await page.waitForTimeout(400);

  // Step 3: Click "Get OTP" button
  const getOtpBtn = page.getByRole('button', { name: /get\s*otp/i }).first();
  // Not there — give up cleanly and let the caller decide.
  if (!(await getOtpBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
    console.log(`   ⚠️  "Get OTP" button not visible`);
    return false;
  }
  // Disabled means the app rejected the address; same treatment.
  if (await getOtpBtn.isDisabled().catch(() => false)) {
    console.log(`   ⚠️  "Get OTP" button is disabled — email may be invalid`);
    return false;
  }
  console.log(`   👆 Clicking "Get OTP"`);
  // Request the code.
  await scrollAndClick(page, getOtpBtn);
  // Give the mail a few seconds to send before polling.
  await page.waitForTimeout(3000);

  // Step 4: Fetch OTP from yopmail
  let otp: string;
  // Wrapped: a rate-limited inbox is a normal outcome here, not a crash.
  try {
    otp = await fetchOtpFromYopmail(context, email);
  } catch (err: any) {
    // Report the first 100 chars of the failure and return false.
    console.log(`   ⚠️  OTP fetch failed: ${err?.message?.slice(0, 100)}`);
    return false;
  }

  // Step 5: Enter OTP and submit
  // OTP input may be a single field OR multiple single-digit fields
  // Everything that isn't a radio, hidden field or checkbox.
  const otpInputs = page.locator('input:not([type="radio"]):not([type="hidden"]):not([type="checkbox"])');
  // How many are there?
  const inputCount = await otpInputs.count();

  // One box — paste the whole code.
  if (inputCount === 1) {
    await otpInputs.first().fill(otp);
  } else {
    // Multi-digit OTP fields — fill one digit each
    // min() guards against a mismatch between code length and box count.
    for (let i = 0; i < Math.min(otp.length, inputCount); i++) {
      await otpInputs.nth(i).fill(otp[i]);
    }
  }
  await page.waitForTimeout(500);

  // Click the final submit button (could be "Login", "Submit", "Verify", "Next")
  // Five accepted labels, anchored.
  const submitBtn = page.getByRole('button', { name: /^(login|submit|verify|next|sign\s*in)$/i }).first();
  if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log(`   👆 Clicking submit`);
    await scrollAndClick(page, submitBtn);
  } else {
    // Some flows auto-submit on full OTP entry — wait and check
    console.log(`   ℹ️  No explicit submit button — waiting for auto-submit`);
  }

  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000);

  // Handle new T&C page that may appear after login (Sphere shows this when
  // their terms have been updated and the user must re-accept)
  await acceptTnCIfPresent(page);

  // Did we actually get in?
  if (isPrivateUrl(page.url())) {
    console.log(`   ✅ Logged in, landed on: ${page.url()}`);
    return true;
  }
  // Report the URL so a failure is diagnosable.
  console.log(`   ⚠️  Login did not reach private area. Current URL: ${page.url()}`);
  return false;
}

/**
 * If the user lands on a T&C re-acceptance page (e.g. /app/new-tnc),
 * tick the checkbox and click Accept to proceed to home.
 *
 * Called after login. Silently no-ops if no T&C page is visible.
 */
// If the user lands on a T&C re-acceptance page (e.g. /app/new-tnc), tick the
// checkbox and click Accept. Silently no-ops if no T&C page is visible.
async function acceptTnCIfPresent(page: Page): Promise<void> {
  // Where are we?
  const url = page.url();
  // Two signals: the route, or the heading text.
  const isOnTnC = /\/new-tnc|\/terms|\/tnc/i.test(url) ||
                  await page.getByText(/terms\s+of\s+use|terms\s*&\s*conditions/i).first()
                    .isVisible({ timeout: 1500 }).catch(() => false);

  // Not on the gate — nothing to do.
  if (!isOnTnC) return;

  console.log(`   📜 T&C page detected — accepting`);

  // Tick the "I have read and agree" checkbox
  // The consent checkbox.
  const checkbox = page.locator('input[type="checkbox"]').first();
  if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Already ticked? Then leave it alone.
    const checked = await checkbox.isChecked().catch(() => false);
    if (!checked) {
      // Try clicking the input itself.
      await scrollAndClick(page, checkbox);
      // If clicking the input didn't tick it, click the associated label text
      const stillUnchecked = !(await checkbox.isChecked().catch(() => false));
      if (stillUnchecked) {
        const agreeLabel = page.getByText(/i\s+have\s+read\s+and\s+agree/i).first();
        if (await agreeLabel.isVisible({ timeout: 1000 }).catch(() => false)) {
          await scrollAndClick(page, agreeLabel);
        }
      }
    }
    console.log(`   ☑️  Checkbox ticked`);
  }
  await page.waitForTimeout(500);

  // Click Accept (Accept / Agree / Continue / Submit)
  // The Accept button, under six accepted labels.
  const acceptBtn = page.getByRole('button', { name: /^(accept|agree|continue|submit|i\s+agree|i\s+accept)$/i }).first();
  if (await acceptBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Disabled means the checkbox didn't register — say so rather than click blindly.
    if (await acceptBtn.isDisabled().catch(() => false)) {
      console.log(`   ⚠️  Accept button is disabled — checkbox may not have registered`);
    } else {
      console.log(`   👆 Clicking Accept`);
      // Accept.
      await scrollAndClick(page, acceptBtn);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3500);
      // Log where we ended up.
      console.log(`   ✅ T&C accepted, now on: ${page.url()}`);
    }
  } else {
    // No button at all — report it; the caller's URL check will decide.
    console.log(`   ⚠️  No Accept button found on T&C page`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// THE TEST — single positive flow
// ══════════════════════════════════════════════════════════════════════
// No retries: each run can burn a real signup and a real OTP fetch.
test.describe.configure({ retries: 0 });

// The whole flow is ONE test — the sibling specs split it into steps instead.
test('Profile Completion — Positive Flow (Healthcare Worker)', async ({ page, context }) => {
  // Five minutes: signup, an inbox poll and three form screens all fit inside.
  test.setTimeout(5 * 60 * 1000);   // 5 min ceiling

  // ── Step 1: Get or create credentials ─────────────────────────
  // Did a previous run leave an account behind?
  const storedEmail = getStoredEmail();
  let email: string;
  let signedUpThisRun = false;

  // Yes — reuse it rather than burning another signup.
  if (storedEmail) {
    console.log(`\n📂 Found stored email: ${storedEmail} — using this account (NO new signup)`);
    const loggedIn = await loginExistingAccount(page, context, storedEmail);
    // Login failed.
    if (!loggedIn) {
      // Don't silently create a new account — the user's intent is to reuse this
      // one. Failing loudly with the exact remedy is better than quietly diverging.
      // Don't silently create a new account — the user's intent is to reuse
      // this one. If login fails, surface the error so they can investigate.
      throw new Error(
        `Could not log in with stored email "${storedEmail}". ` +
        `Either fix the login flow or delete .last-registered-email.json to force a fresh signup.`
      );
    }
    email = storedEmail;
  // No stored account — start fresh.
  } else {
    console.log(`\n📂 No stored email — creating a new account`);
    // Mint and persist a new address…
    email = generateAndSaveEmail();
    // …then run the full signup.
    await signup(page, context, email);
    signedUpThisRun = true;
  }

  // Log which account this run is using, whichever path we took.
  console.log(`\n🆔 Active account: ${email}`);
  console.log(`📍 Current URL:    ${page.url()}`);

  // ── Step 2: Detect where we are in the flow ───────────────────
  // Could be home, or any of the three onboarding screens.
  let state = await detectFlowState(page);
  console.log(`\n🔍 Detected flow state: ${state}`);

  // ── Step 3: Open profile form if needed ───────────────────────
  // On home → click Account, then re-detect.
  if (state === 'home') {
    await openProfileForm(page);
    state = await detectFlowState(page);
    console.log(`🔍 State after Account click: ${state}`);
  }

  // ── Step 4: Fill "Tell us more about you" ─────────────────────
  // Each of these blocks is `if`, not `else if` — so a single run can fall
  // through all three stages in sequence, re-detecting after each one.
  if (state === 'tell-us-more') {
    await fillTellUsMoreForm(page);
    await clickAction(page, 'Next');
    state = await detectFlowState(page);
    console.log(`🔍 State after "Next" on tell-us-more: ${state}`);
  }

  // ── Step 5: Pick background ───────────────────────────────────
  // Clicking the card advances the flow on its own — no Next button here.
  if (state === 'choose-bg') {
    await pickBackground(page, BACKGROUND);
    state = await detectFlowState(page);
    console.log(`🔍 State after picking ${BACKGROUND}: ${state}`);
  }

  // ── Step 6: Fill "Almost done!" ───────────────────────────────
  // The final stage: role-specific fields, then Done.
  if (state === 'almost-done') {
    await fillAlmostDone(page, BACKGROUND);
    await clickAction(page, 'Done');
    await page.waitForTimeout(2000);
  }

  // ── Step 7: Verify we landed back on a private page ───────────
  // Where did we end up?
  const finalUrl = page.url();
  console.log(`\n🏁 Final URL: ${finalUrl}`);
  // Still logged in?
  const onPrivate = isPrivateUrl(finalUrl);

  // Sanity check: the profile form should NOT be visible anymore
  // Either of the two form screens still showing means onboarding didn't finish.
  const stillOnForm =
    (await page.getByText(/tell us more about you/i).isVisible({ timeout: 1500 }).catch(() => false)) ||
    (await page.getByText(/almost done!?/i).isVisible({ timeout: 1500 }).catch(() => false));

  // Success: off the form AND inside the app.
  if (!stillOnForm && onPrivate) {
    console.log(`\n✅ Profile completion successful for ${email}`);
    // Profile is fully filled — clear the record so the NEXT run starts a
    // fresh account (otherwise next run would log into this completed account
    // and find nothing to fill).
    clearStoredEmail();
    console.log(`📂 Cleared .last-registered-email.json — next run will create a fresh account`);
  // Unclear outcome — KEEP the record so the next run can retry this account.
  } else {
    console.log(`\n⚠️  Final state unclear (stillOnForm=${stillOnForm}, onPrivate=${onPrivate})`);
    console.log(`📂 Keeping .last-registered-email.json — next run will reuse "${email}" to retry`);
  }

  // hard ×2 — both must hold: logged in, and off the onboarding form.
  expect(onPrivate).toBe(true);
  expect(stillOnForm).toBe(false);

  // Note in the log whether this run consumed a new signup.
  if (signedUpThisRun) {
    console.log(`\nℹ️  This run created a new account: ${email}`);
  }
});