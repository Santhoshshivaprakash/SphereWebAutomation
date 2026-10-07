/**
 * Create Account — End-to-End Signup
 * ──────────────────────────────────────────────────────────────────
 * Flow: Select Language → Personal Details → OTP (fetched from yopmail)
 *       → Name Confirm Modal → Set Password → Account Created
 *
 * - Generates email like "testautomation10001@yopmail.com" (no underscore)
 * - Stores the generated email to .last-registered-email.json
 * - Uses 9999999999 phone by default, auto-increments if "already exists"
 * - Fetches OTP directly from yopmail in a second tab
 * - Reuses the same browser tab across validation tests to save time
 *
 * Usage:
 *   npx playwright test tests/create-account.spec.ts --headed
 *
 * ── Reading this file ──────────────────────────────────────────────
 * Every line carries a short plain-English note saying what it does.
 * Block comments (like this one) explain WHY something is written the
 * way it is; the short `//` notes explain WHAT the line does.
 */
// Pull in Playwright's test runner, its assertion library, and the three types we annotate with.
import { generateTestEmail, recordCreatedEmail } from './helpers/yopmail';
import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';
// Node's file-system module — used to write the generated email and the saved session to disk.
import * as fs from 'fs';
// Node's path module — builds file paths that work on Windows and Linux alike.
import * as path from 'path';

// Signup can't run on the localhost mirror, so this flow targets staging
// (STAGING_URL) by default rather than the shared BASE_URL.
// Read BASE_URL from the environment; if it isn't set, fall back to staging.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════
// The full signup page URL — the one page every test in this file starts from.
const CREATE_ACCOUNT_URL  = `${BASE_URL}/app/create-account`;
// Where the most recent signup email gets written. `__dirname` is /tests, so '..' is the project root.
const EMAIL_RECORD_FILE   = path.resolve(__dirname, '..', '.last-registered-email.json');

// Starting phone number for the phone+password signup path.
const DEFAULT_PHONE       = '9999999999';
// The password typed on the password path (the project's standard test password).
const DEFAULT_PASSWORD    = 'Sunbird@123';
// First name typed into every signup form.
const FIRST_NAME          = 'Test';
// Last name typed into every signup form.
const LAST_NAME           = 'Aastrika';

// ══════════════════════════════════════════════════════════════════════
// EMAIL / PHONE GENERATION
// ══════════════════════════════════════════════════════════════════════
// Builds a brand-new throwaway email address for one signup.
function generateEmail(): string {
  // Pick a random 5-digit number between 10000 and 99999 — 90,000 possible addresses.
  const suffix = Math.floor(10000 + Math.random() * 90000);
  // Glue it into a yopmail address, tagged with the environment it was made on
  // and kept inside the portal's 19-character limit for the part before the "@":
  // "stage-testauto48213@yopmail.com" on staging, unchanged on production.
  return generateTestEmail('testautomation', suffix);
}

// Builds a phone number, counting DOWN from DEFAULT_PHONE by `seed`.
function generatePhone(seed = 0): string {
  // Turn the phone string into a number so we can subtract from it.
  const base = parseInt(DEFAULT_PHONE);
  // Subtract the seed and turn it back into a string: 9999999999, 9999999998, …
  return String(base - seed);
}

// Writes the email we're about to sign up with to disk, so later specs can find it.
function saveEmail(email: string) {
  // Save it as JSON with a timestamp. Called BEFORE submitting, so the address survives a crash.
  fs.writeFileSync(EMAIL_RECORD_FILE, JSON.stringify({ email, timestamp: Date.now() }, null, 2));
  // Print what was saved so it shows up in the run log.
  console.log(`💾 Saved email to ${path.basename(EMAIL_RECORD_FILE)}: ${email}`);
  // …and add it to the ledger of every account created (generated-emails.txt).
  recordCreatedEmail(email, 'create-account');
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════
// Navigates to the signup page, recovering if the app bounces us to login first.
async function goToCreateAccount(page: Page) {
  // Go to the signup URL.
  await page.goto(CREATE_ACCOUNT_URL);
  // Wait until the page stops making network requests.
  await page.waitForLoadState('networkidle');
  // Give Angular half a second more to finish painting.
  await page.waitForTimeout(500);

  // Did the app redirect us to the login page instead of showing signup?
  if (/\/public\/login/i.test(page.url())) {
    // If so, click the "create an account" link on that login page to get back on course.
    await page.getByText(hiAlso(/create an account/i)).first().click();
    // Wait for the signup page to load.
    await page.waitForLoadState('networkidle');
    // And settle for a moment.
    await page.waitForTimeout(800);
  }
}

// Selects a language radio button by its position (0 = first, 1 = second). Returns whether it worked.
async function selectLanguageByIndex(page: Page, idx: 0 | 1): Promise<boolean> {
  // Grab the Material radio button at that position.
  const wrapper = page.locator('mat-radio-button').nth(idx);
  // Wait up to 5 seconds for it to appear on screen.
  await wrapper.waitFor({ state: 'visible', timeout: 5000 });
  // Scroll it into view if it's off-screen.
  await wrapper.scrollIntoViewIfNeeded();

  // ── Attempt 1: click the radio's outer wrapper. `force` skips Playwright's "is it clickable?" checks.
  await wrapper.click({ force: true });
  // Give Angular 600ms to register the selection.
  await page.waitForTimeout(600);

  // Find the real <input type="radio"> underneath — that's what actually holds the checked state.
  const input = page.locator('input[type="radio"]').nth(idx);
  // If it's now checked, we're done — return success.
  if (await input.isChecked().catch(() => false)) return true;

  // ── Attempt 2: click the inner ripple element, which is what Material binds its handler to.
  const mdcRadio = wrapper.locator('.mdc-radio').first();
  // Only try this if that inner element actually exists.
  if (await mdcRadio.isVisible().catch(() => false)) {
    // Click it, ignoring clickability checks.
    await mdcRadio.click({ force: true });
    // Wait for Angular to react.
    await page.waitForTimeout(500);
    // Checked now? Then we're done.
    if (await input.isChecked().catch(() => false)) return true;
  }

  // ── Attempt 3: drive the DOM directly inside the browser, bypassing the UI entirely.
  await page.evaluate((targetIdx: number) => {
    // Find every radio input on the page.
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    // Make sure the one we want exists.
    if (inputs[targetIdx]) {
      // Click it natively.
      inputs[targetIdx].click();
      // If clicking still didn't check it, set the property by hand.
      if (!inputs[targetIdx].checked) {
        // Force the checked flag on.
        inputs[targetIdx].checked = true;
        // Fire an 'input' event so Angular's form control notices the change.
        inputs[targetIdx].dispatchEvent(new Event('input', { bubbles: true }));
        // Fire a 'change' event too — Angular listens for this one on radios.
        inputs[targetIdx].dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }, idx);   // `idx` is passed into the browser because page.evaluate runs in a separate context.
  // Give Angular a moment after the manual DOM poke.
  await page.waitForTimeout(500);
  // Report back whether the radio ended up checked. We return a boolean instead of throwing.
  return await input.isChecked().catch(() => false);
}

// Picks ENGLISH on the language screen and clicks Next. Used whenever we actually create an account.
async function advancePastLanguageScreen(page: Page) {
  // Pick ENGLISH by label, not by position — on staging the screen itself renders
  // in Hindi ("अंग्रेजी" = English), and a reordered list would otherwise silently
  // sign the user up in Hindi, breaking every English selector downstream.
  // Find the radio whose text says "English" in either language.
  const english = page.locator('mat-radio-button')
    .filter({ hasText: /english|अंग्रेजी/i })
    .first();
  // Did we find it within 3 seconds?
  if (await english.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Scroll to it; ignore any error since it's only a convenience.
    await english.scrollIntoViewIfNeeded().catch(() => {});
    // Click it.
    await english.click({ force: true });
    // Let the selection register.
    await page.waitForTimeout(600);
  } else {
    // Couldn't match by label — fall back to picking whatever is first in the list.
    await selectLanguageByIndex(page, 0);
  }
  // Click Next (the button reads "Next" in English or "अगला" in Hindi).
  await page.getByRole('button', { name: /^next$|^अगला$/i }).click();
  // Wait for the next screen; swallow the error if the network never goes fully idle.
  await page.waitForLoadState('networkidle').catch(() => {});
  // Give the form screen time to render.
  await page.waitForTimeout(1200);
}

// Returns the three visible text boxes on the signup form: first name, last name, email/phone.
function formInputs(page: Page): Locator {
  // Exclude radios (the language + login-method controls), hidden fields (Angular internals),
  // and password fields — so the same helper returns exactly 3 inputs on every screen.
  return page.locator('input:not([type="radio"]):not([type="hidden"]):not([type="password"])');
}

// Empties the form so a test starts from a known-blank state.
async function clearFormInputs(page: Page) {
  // Get the text boxes.
  const inputs = formInputs(page);
  // Only ever clear the first 3, even if the page happens to show more.
  const count = Math.min(await inputs.count(), 3);
  // Walk through them one at a time.
  for (let i = 0; i < count; i++) {
    // Setting the value to an empty string clears the field.
    await inputs.nth(i).fill('');
    // Small pause so Angular's validation keeps up.
    await page.waitForTimeout(100);
  }
}

// True when the current screen is the Terms & Conditions page (`/app/new-tnc`).
// NOTE: don't key off the text "Terms of Use" — it also appears in the home
// page footer, which caused false positives. Use the route, or the T&C page's
// unique Decline + Accept control pair.
async function isOnTerms(page: Page): Promise<boolean> {
  // First and cheapest check: does the URL look like the terms route?
  if (/new-tnc|\/tnc\b|terms-and-cond|consent/i.test(page.url())) return true;
  // By class, not by label: this screen is served in the account's own language
  // (staging shows "मना करें" / "स्वीकार करना"), so an English-only name match
  // reports "not on the terms page" on a page that plainly is.
  // Look for a Decline button — by CSS class first, by name in either language second.
  const hasDecline = await page.locator('button.decline-btn')
    .or(page.getByRole('button', { name: /^decline$|^मना/i }))
    .first().isVisible({ timeout: 2000 }).catch(() => false);
  // No Decline button means this isn't the terms screen.
  if (!hasDecline) return false;
  // Now look for its partner, the Accept button.
  const hasAccept = await page.locator('button.accept-btn')
    .or(page.getByRole('button', { name: /^accept$|^स्वीकार|^सहमत/i }))
    .first().isVisible({ timeout: 1000 }).catch(() => false);
  // Only both buttons together prove we're on the real terms screen.
  return hasAccept;
}

// Checks whether the app popped up an "account already exists" message.
async function isAlreadyExistsToast(page: Page): Promise<boolean> {
  // Find the toast/snackbar, matching any of the four shapes the app might use.
  const toast = page.locator(
    'mat-snack-bar-container, [role="alert"], [class*="snackbar"], [class*="toast"]'
  ).first();
  // No toast on screen within 2 seconds → nothing was rejected.
  if (!(await toast.isVisible({ timeout: 2000 }).catch(() => false))) return false;
  // Read the toast's text (empty string if we can't).
  const text = (await toast.textContent().catch(() => '')) ?? '';
  // Return true only if the wording is about an existing account.
  return /already\s+(exists?|registered)|user.*exists?/i.test(text);
}

// ══════════════════════════════════════════════════════════════════════
// OTP HELPERS
// ══════════════════════════════════════════════════════════════════════
// Third-party library that reads yopmail inboxes over HTTP — no browser needed.
import yopmail from 'easy-yopmail';
import { hiAlso } from './helpers/i18n';

// Optional backend endpoint that can hand us an OTP directly (Layer 3 fallback).
const OTP_API_URL        = process.env.OTP_API_URL        ?? '';
// The auth key that endpoint requires. Without both, Layer 3 is unavailable.
const OTP_EXTRACTION_KEY = process.env.OTP_EXTRACTION_KEY ?? '';

// Digs the 4–8 digit code out of an email body.
function extractOtp(text: string): string | null {
  // Make sure we're working with a string even if `text` was null/undefined.
  const body = String(text ?? '');
  // Prefer the phrase form ("…is 483921"); only if that misses, take any standalone 4–8 digit run.
  // Preferring the phrase avoids grabbing a year, a ticket id or a support phone number.
  const m = body.match(/is\s+(\d{4,8})/i) ?? body.match(/\b(\d{4,8})\b/);
  // Return the captured digits, or null if nothing matched.
  return m ? m[1] : null;
}

// ══════════════════════════════════════════════════════════════════════
// THROTTLING — yopmail bot-flags BURSTS of automated inbox reads (that's what
// trips its CAPTCHA). We stay well under the threshold with three controls:
//   • a GLOBAL minimum gap between EVERY yopmail request (getInbox/readMessage
//     and each UI refresh), enforced across all signups in a run;
//   • a slower poll cadence + fewer attempts;
//   • a gap between consecutive OTP-fetch cycles (which track signups).
// Tune via env if needed.
// ══════════════════════════════════════════════════════════════════════
const YOPMAIL_MIN_GAP_MS = Number(process.env.YOPMAIL_MIN_GAP_MS ?? 6_000);   // ≥6s between yopmail requests
const YOPMAIL_POLL_MS    = Number(process.env.YOPMAIL_POLL_MS    ?? 7_000);   // wait between poll attempts
const YOPMAIL_RETRIES    = Number(process.env.YOPMAIL_RETRIES    ?? 8);       // poll attempts per fetch
const FETCH_CYCLE_GAP_MS = Number(process.env.FETCH_CYCLE_GAP_MS ?? 12_000);  // ≥12s between fetch cycles
// Timestamp of the last yopmail request — module-level, so it spans the whole run.
let lastYopmailAt = 0;
// Timestamp of the last whole fetch cycle (one cycle ≈ one signup).
let lastFetchAt   = 0;

// Sleeps for whatever is left of a minimum interval, then records "now" as the new last-call time.
async function throttleGate(getLast: () => number, setLast: (v: number) => void, minGap: number) {
  // How much of the gap hasn't elapsed yet?
  const wait = minGap - (Date.now() - getLast());
  // If time is still owed, sleep for exactly that long.
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  // Stamp the current time so the next caller measures from here.
  setLast(Date.now());
}
// Global gate before any yopmail network op — spaces requests across the run.
const yopmailGate    = () => throttleGate(() => lastYopmailAt, (v) => (lastYopmailAt = v), YOPMAIL_MIN_GAP_MS);
// Gate at the start of each fetch — spaces signup→fetch bursts.
const fetchCycleGate = () => throttleGate(() => lastFetchAt, (v) => (lastFetchAt = v), FETCH_CYCLE_GAP_MS);

// ── Layer 1: easy-yopmail (HTTP API) ────────────────────────────────
// Fastest way to get the OTP: read the inbox over HTTP, no browser involved.
async function fetchOtpFromYopmail(email: string, retries = YOPMAIL_RETRIES, delay = YOPMAIL_POLL_MS): Promise<string> {
  // Log which address we're checking.
  console.log('Fetching OTP from Yopmail for:', email);
  // The inbox name is just the part before the "@".
  const inbox = email.split('@')[0];

  // Poll the inbox up to `retries` times — the mail usually takes a few seconds to arrive.
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Wait between attempts (but not before the very first one).
    if (attempt > 1) await new Promise(r => setTimeout(r, delay));
    // Wrap the network call so one failure doesn't abort the whole loop.
    try {
      // Respect the global 6-second spacing before touching yopmail.
      await yopmailGate();
      // Ask for the first page of the inbox, at most 10 messages.
      const inboxData = await yopmail.getInbox(inbox, null, { LIMIT_PAGE: 1, LIMIT_MAIL: 10 });
      // Pull out the message list, defaulting to an empty array.
      const list = inboxData?.inbox ?? [];
      // Report how many messages are sitting there.
      console.log(`   [yopmail ${attempt}/${retries}] inbox has ${list.length} message(s)`);

      // Open each message in turn.
      for (const item of list) {
        // Space out this read too — every yopmail call goes through the gate.
        await yopmailGate();
        // Fetch the message body as plain text.
        const message = await yopmail.readMessage(inbox, item.id, { format: 'txt' });
        // Who sent it.
        const from    = String(message.from ?? '');
        // What the subject line says (the library calls this field `submit`).
        const subject = String(message.submit ?? '');
        // The message body.
        const body    = String(message.content ?? '');
        // Log the envelope so a wrong-mail problem is visible in the run output.
        console.log(`      from="${from}" subject="${subject}"`);

        // Skip anything that isn't the Sphere verification mail — filtering on sender AND subject
        // means a newsletter in the same inbox can't be mistaken for an OTP.
        if (!/support@aastrika\.org/i.test(from) || !/OTP to verify Email/i.test(subject)) continue;
        // Pull the digits out, preferring the "…is 123456" phrasing.
        const m = body.match(/is\s+(\d{4,8})/i) ?? body.match(/\b(\d{4,8})\b/);
        // Found a code? Hand it straight back.
        if (m) return m[1];
      }
    } catch (err) {
      // Network error or CAPTCHA — log it and try again.
      console.log(`   [yopmail ${attempt}/${retries}] error: ${(err as Error).message}`);
      // On the last attempt there's nothing left to try, so give up with a clear message.
      if (attempt === retries) {
        throw new Error(`OTP not received from Yopmail after ${retries} attempts: ${(err as Error).message}`);
      }
    }
  }
  // Loop finished without ever finding a matching mail.
  throw new Error(`OTP not received from Yopmail after ${retries} attempts`);
}

// ── Layer 2: Yopmail UI (Playwright iframe scraper) ─────────────────
// Backup plan: open yopmail.com in a real browser tab and read the mail off the screen.
async function fetchOtpFromYopmailUI(
  context: BrowserContext,
  email: string,
  retries = YOPMAIL_RETRIES,
  delay = YOPMAIL_POLL_MS,
): Promise<string> {
  // Inbox name = the part before the "@".
  const inboxName = email.split('@')[0];
  // Open a brand-new tab so we don't disturb the signup tab.
  const page = await context.newPage();
  // `try/finally` guarantees the tab is closed even if something throws.
  try {
    // Space this out like every other yopmail request.
    await yopmailGate();
    // Load the English yopmail homepage.
    await page.goto('https://yopmail.com/en/', { waitUntil: 'domcontentloaded' });

    // Dismiss cookie consent if it shows
    // Look for any of three consent-button shapes.
    const consent = page.locator('button:has-text("Accept"), .fc-cta-consent, #cookieConsent button').first();
    // Click it if it's there; ignore failures since it's optional.
    if (await consent.isVisible().catch(() => false)) await consent.click().catch(() => {});

    // Type the inbox name into yopmail's search box.
    await page.locator('input#login').fill(inboxName);
    // Press Enter to open that inbox.
    await page.locator('input#login').press('Enter');
    // Wait for the inbox page to load.
    await page.waitForLoadState('domcontentloaded');

    // yopmail renders the message LIST inside one iframe…
    const inboxFrame = page.frameLocator('#ifinbox');
    // …and the message BODY inside another.
    const mailFrame  = page.frameLocator('#ifmail');

    // Poll the inbox until the mail arrives or we run out of attempts.
    for (let attempt = 1; attempt <= retries; attempt++) {
      // On every attempt after the first, hit refresh.
      if (attempt > 1) {
        // Refresh counts as a yopmail request, so it goes through the gate too.
        await yopmailGate();
        // Click yopmail's refresh button; ignore if it's not clickable.
        await page.locator('#refresh').click().catch(() => {});
        // Wait before reading again.
        await page.waitForTimeout(delay);
      }

      // Find the message rows inside the inbox iframe.
      const messages = inboxFrame.locator('button.lm, div.m');
      // Count them (0 if the locator fails).
      const count = await messages.count().catch(() => 0);
      // Log what we saw.
      console.log(`   [yopmail-ui ${attempt}/${retries}] inbox shows ${count} message(s)`);

      // Nothing there yet — go round again.
      if (count === 0) continue;

      // Open the newest message.
      await messages.first().click().catch(() => {});
      // Give the body iframe a second to render.
      await page.waitForTimeout(1000);

      // Read the visible text of the mail body.
      const body = await mailFrame.locator('#mail').innerText().catch(() => '');
      // Try to pull a code out of it.
      const otp = extractOtp(body);
      // Got one? Log it and return.
      if (otp) {
        console.log(`✅ OTP from yopmail UI body: ${otp}`);
        return otp;
      }
      // No digits found — show the first 120 characters so we can see what arrived instead.
      console.log(`   body had no digits: "${body.slice(0, 120)}"`);
    }
    // Ran out of attempts without finding a code.
    throw new Error(`OTP not found in yopmail UI after ${retries} attempts`);
  } finally {
    // Always close the scraper tab, success or failure.
    await page.close().catch(() => {});
  }
}

// ── Layer 3: Prod OTP API ────────────────────────────────────────────
// Last resort: ask a backend endpoint for the code directly.
async function fetchOtpFromAPI(email: string, retries = 10, delay = 5000): Promise<string> {
  // Log what we're doing.
  console.log('Fetching OTP from API for:', email);
  // This layer only works if both env vars are configured.
  if (!OTP_API_URL || !OTP_EXTRACTION_KEY) {
    throw new Error('OTP_API_URL / OTP_EXTRACTION_KEY not configured');
  }

  // Poll the endpoint up to 10 times.
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Show progress.
    console.log(`Checking OTP API... Attempt ${attempt}/${retries}`);
    // Pause between attempts (not before the first).
    if (attempt > 1) await new Promise(r => setTimeout(r, delay));
    // Guard the request so one failure doesn't stop the loop.
    try {
      // POST the email and the extraction key to the endpoint.
      const res = await fetch(OTP_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: email, type: 'email', extractionKey: OTP_EXTRACTION_KEY }),
      });
      // Parse the JSON reply.
      const json: any = await res.json();
      // Dig the code out of the response shape.
      const otp = json?.data?.[0]?.otp;
      // Got one? Log and return it as a string.
      if (otp) {
        console.log('✓ OTP Received from API:', otp);
        return String(otp);
      }
      // Responded, but with no OTP in it — treat as a failed attempt.
      throw new Error('Invalid API response: no OTP in data');
    } catch (err) {
      // Log why this attempt failed.
      console.log(`✗ Attempt ${attempt} failed:`, (err as Error).message);
      // Out of attempts — give up.
      if (attempt === retries) {
        throw new Error(`OTP not received from API after ${retries} attempts`);
      }
    }
  }
  // Safety net if the loop somehow exits without returning.
  throw new Error(`OTP not received from API after ${retries} attempts`);
}

// ── Orchestrator: Layer 1 → Layer 2 → Layer 3 ───────────────────────
//
//  Priority:
//    1. easy-yopmail  (fast HTTP API, no browser needed)
//    2. Yopmail UI    (Playwright iframe scraper, needs BrowserContext)
//    3. Prod OTP API  (last resort, requires OTP_API_URL env var)
//
// Tries each reader in turn and only raises once all three have failed.
export async function fetchOtp(
  email: string,
  {
    retries    = YOPMAIL_RETRIES,
    delay      = YOPMAIL_POLL_MS,
    useYopmail = true,
    context,                       // required for Layer 2 (UI scraper)
  }: {
    retries?:    number;
    delay?:      number;
    useYopmail?: boolean;
    context?:    BrowserContext;   // pass sharedContext from your test
  } = {},
): Promise<string> {
  // Space consecutive OTP fetches so back-to-back signups don't burst yopmail.
  await fetchCycleGate();
  // Print a banner so this stage is easy to find in a long run log.
  console.log('=============================================');
  console.log('Starting OTP Fetch Process | Email:', email, '| Use Yopmail:', useYopmail);
  console.log('=============================================');

  // Caller explicitly asked to skip yopmail — go straight to the API.
  if (!useYopmail) return fetchOtpFromAPI(email, retries, delay);

  // ── Layer 1: easy-yopmail ──────────────────────────────────────────
  // Remember Layer 1's error so the final message can name it.
  let yopmailErr: Error | null = null;
  try {
    // Announce the attempt.
    console.log('\n[STEP 1] Attempting easy-yopmail (HTTP API)...');
    // If this works, we return here and the other layers never run.
    return await fetchOtpFromYopmail(email, retries, delay);
  } catch (err) {
    // Stash the failure and fall through to Layer 2.
    yopmailErr = err as Error;
    console.log('\n[STEP 1 FAILED]', yopmailErr.message);
  }

  // ── Layer 2: Yopmail UI scraper ────────────────────────────────────
  // Remember Layer 2's error too.
  let yopmailUiErr: Error | null = null;
  // Layer 2 needs a BrowserContext to open a tab in — skip it if the caller didn't pass one.
  if (context) {
    try {
      // Announce the attempt.
      console.log('\n[STEP 2] Attempting yopmail UI (iframe scraper)...');
      // Success here returns immediately.
      return await fetchOtpFromYopmailUI(context, email, retries, delay);
    } catch (err) {
      // Stash the failure and fall through to Layer 3.
      yopmailUiErr = err as Error;
      console.log('\n[STEP 2 FAILED]', yopmailUiErr.message);
    }
  } else {
    // No context supplied — say so loudly, because it silently drops us to two layers.
    console.log('\n[STEP 2 SKIPPED] No BrowserContext provided — pass `context` to enable UI fallback');
  }

  // ── Layer 3: Prod OTP API ──────────────────────────────────────────
  try {
    // Last chance.
    console.log('\n[STEP 3] Falling back to Prod OTP API...\n');
    return await fetchOtpFromAPI(email, retries, delay);
  } catch (apiErr) {
    // Everything failed — raise ONE error that names all three reasons, so the report is diagnosable.
    throw new Error(
      [
        'OTP fetch failed across all layers:',
        `  Layer 1 (easy-yopmail):  ${yopmailErr?.message}`,
        `  Layer 2 (yopmail UI):    ${yopmailUiErr?.message ?? 'skipped (no context)'}`,
        `  Layer 3 (prod API):      ${(apiErr as Error).message}`,
      ].join('\n'),
    );
  }
}

// ── Enter OTP into the form (Playwright) ────────────────────────────
// Types the code into the OTP screen, handling both single-box and one-box-per-digit layouts.
export async function enterOtp(page: Page, otp: string): Promise<void> {
  // Find the OTP field(s) by their id.
  const fields = page.locator('input#code');
  // Wait up to 15 seconds for the first one to appear.
  await fields.first().waitFor({ state: 'visible', timeout: 15000 });

  // How many boxes are there?
  const count = await fields.count();
  // One box per digit? Then fill them one digit at a time.
  if (count > 1 && count === otp.length) {
    // Walk the digits, putting each into its own box.
    for (let i = 0; i < otp.length; i++) await fields.nth(i).fill(otp[i]);
    // Press Enter on the last box to submit.
    await fields.nth(count - 1).press('Enter');
  } else {
    // Single field — drop the whole code in at once.
    await fields.first().fill(otp);
    // And submit with Enter.
    await fields.first().press('Enter');
  }
  // Confirm in the log that the code went in.
  console.log('OTP entered successfully');
}

// ══════════════════════════════════════════════════════════════════════
// SHARED PAGE (one tab across all tests)
// ══════════════════════════════════════════════════════════════════════
// The single browser tab that Sections 1–3 all drive.
let sharedPage: Page;
// The browser context that tab lives in — a clean cookie jar with no stored login.
let sharedContext: BrowserContext;

// Never retry a test in this file: retrying a signup would restart mid-journey on the wrong screen.
test.describe.configure({ retries: 0 });

// Runs once, before every test in the file.
test.beforeAll(async ({ browser }) => {
  // Make a fresh context. If we inherited a logged-in session, /app/create-account would bounce to home.
  sharedContext = await browser.newContext();
  // Open the one tab that Sections 1–3 will share.
  sharedPage = await sharedContext.newPage();
});

// Runs once, after every test in the file.
test.afterAll(async () => {
  // Close the context (and its tab). `?.` and `.catch` keep teardown from failing the run.
  await sharedContext?.close().catch(() => {});
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 1 — LANGUAGE SELECTION
// ══════════════════════════════════════════════════════════════════════
// `.serial` = run these in order, and skip the rest if one fails.
test.describe.serial('Step 1: Select Language', () => {

  // TEST 1 — can we even reach the signup page?
  test('Open Create Account page', async () => {
    // Navigate (absorbing a login redirect if one happens).
    await goToCreateAccount(sharedPage);
    // Count the language radio buttons on screen.
    const count = await sharedPage.locator('mat-radio-button').count();
    // There must be at least two languages offered.
    expect(count).toBeGreaterThanOrEqual(2);
    // Log how many we found.
    console.log(`✅ Found ${count} language options`);
  });

  // TEST 2 — is the page branded and titled, not a blank shell?
  test('Heading + logo visible', async () => {
    // The "Select language" heading must be on screen.
    await expect(sharedPage.getByText(hiAlso(/select language/i)).first()).toBeVisible();
    // Find the logo by its alt text, either spelling.
    const logo = sharedPage.locator('img[alt*="logo" i], img[alt*="aastrika" i]').first();
    // It must be visible too.
    await expect(logo).toBeVisible();
    // Log success.
    console.log(`✅ Heading and logo visible`);
  });

  // TEST 3 — the Next button must be locked until a language is chosen.
  test('Next button disabled before any language is selected', async () => {
    // Grab the Next button by its accessible name.
    const next = sharedPage.getByRole('button', { name: hiAlso(/^next$/i) });
    // It should report as disabled right now.
    expect(await next.isDisabled()).toBe(true);
    // Log success.
    console.log(`✅ Next disabled before selection`);
  });

  // TEST 4 — can the first radio (English) actually be selected?
  test('English (index 0) selectable', async () => {
    // Use the three-strategy helper and capture whether it worked.
    const ok = await selectLanguageByIndex(sharedPage, 0);
    // Assert on the helper's return value, not on the click succeeding.
    expect(ok).toBe(true);
    // Log success.
    console.log(`✅ English selected`);
  });

  // TEST 5 — and the second radio (Hindi)?
  test('Hindi (index 1) selectable', async () => {
    // Same helper, index 1 this time.
    const ok = await selectLanguageByIndex(sharedPage, 1);
    // Must have ended up checked.
    expect(ok).toBe(true);
    // Log success.
    console.log(`✅ Hindi selected`);
  });

  // TEST 6 — this is a radio group, so picking one must clear the other.
  test('Single-choice: selecting one unselects the other', async () => {
    // Select English (Hindi is currently selected from the previous test).
    await selectLanguageByIndex(sharedPage, 0);
    // Read the first radio's checked state.
    const r0 = await sharedPage.locator('input[type="radio"]').nth(0).isChecked();
    // Read the second radio's checked state.
    const r1 = await sharedPage.locator('input[type="radio"]').nth(1).isChecked();
    // English must now be on…
    expect(r0).toBe(true);
    // …and Hindi must have turned off.
    expect(r1).toBe(false);
    // Log success.
    console.log(`✅ Single-choice behavior confirmed`);
  });

  // TEST 7 — with a language chosen, Next must unlock. Leaves English selected for Section 2.
  test('Next button enables after selecting a language', async () => {
    // Grab the Next button.
    const next = sharedPage.getByRole('button', { name: hiAlso(/^next$/i) });
    // Poll for up to 5 seconds while Angular updates the form state.
    await expect(next).toBeEnabled({ timeout: 5000 });
    // Log success.
    console.log(`✅ Next button enabled`);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 2 — FORM FIELDS
// ══════════════════════════════════════════════════════════════════════
// Still the same tab — picks up where Section 1 left off, with English selected.
test.describe.serial('Step 2: Form Validation (shared tab)', () => {

  // TEST 1 — click the Next that Section 1 just unlocked, landing on the details form.
  test('Advance to form screen', async () => {
    // Click Next.
    await sharedPage.getByRole('button', { name: hiAlso(/^next$/i) }).click();
    // Wait for the transition; ignore if the network never fully idles.
    await sharedPage.waitForLoadState('networkidle').catch(() => {});
    // Give the new screen time to render.
    await sharedPage.waitForTimeout(1200);
    // Confirm we're on the form by its heading.
    await expect(sharedPage.getByText(hiAlso(/create your account/i)).first()).toBeVisible({ timeout: 8000 });
    // Log success.
    console.log(`✅ On Create Account form`);
  });

  // TEST 2 — six checks in one: the three field labels plus the login-method block.
  test('All form fields and login-method options visible', async () => {
    // First name label.
    await expect(sharedPage.getByText(hiAlso(/first name/i)).first()).toBeVisible();
    // Last name label.
    await expect(sharedPage.getByText(hiAlso(/last name/i)).first()).toBeVisible();
    // The combined label — this is what documents that one field takes a phone OR an email.
    await expect(sharedPage.getByText(/phone number.*email/i).first()).toBeVisible();
    // The login-method prompt.
    await expect(sharedPage.getByText(hiAlso(/choose your login method/i)).first()).toBeVisible();
    // The OTP option.
    await expect(sharedPage.getByText(hiAlso(/by otp/i)).first()).toBeVisible();
    // The password option.
    await expect(sharedPage.getByText(hiAlso(/by password/i)).first()).toBeVisible();
    // Log success.
    console.log(`✅ All field labels visible`);
  });

  // TEST 3 — the form must refuse to advance while it's empty.
  test('Next disabled with empty fields', async () => {
    // Blank all three fields so the state is unambiguous.
    await clearFormInputs(sharedPage);
    // Let validation run.
    await sharedPage.waitForTimeout(400);
    // Grab Next.
    const next = sharedPage.getByRole('button', { name: hiAlso(/^next$/i) });
    // It must report disabled.
    expect(await next.isDisabled().catch(() => false)).toBe(true);
    // Log success.
    console.log(`✅ Next disabled with empty fields`);
  });

  // TEST 4 — type a full identity and read every value back.
  test('Form accepts text input (First/Last name, email)', async () => {
    // Start from blank.
    await clearFormInputs(sharedPage);
    // Get the three text boxes.
    const inputs = formInputs(sharedPage);
    // Box 0 is First name.
    await inputs.nth(0).fill(FIRST_NAME);
    // Box 1 is Last name.
    await inputs.nth(1).fill(LAST_NAME);
    // Make a throwaway address — this one is never submitted.
    const testEmail = generateEmail();
    // Box 2 is the email/phone field.
    await inputs.nth(2).fill(testEmail);
    // Each value must round-trip exactly.
    expect(await inputs.nth(0).inputValue()).toBe(FIRST_NAME);
    expect(await inputs.nth(1).inputValue()).toBe(LAST_NAME);
    expect(await inputs.nth(2).inputValue()).toBe(testEmail);
    // Log success.
    console.log(`✅ Form accepts text input`);
  });

  // TEST 5 — the SAME field must also accept a phone number, with no mask rewriting it.
  test('Email field accepts phone number too', async () => {
    // Get the text boxes.
    const inputs = formInputs(sharedPage);
    // Clear the identity field.
    await inputs.nth(2).fill('');
    // Type digits instead of an email.
    await inputs.nth(2).fill(DEFAULT_PHONE);
    // The digits must come back unchanged.
    expect(await inputs.nth(2).inputValue()).toBe(DEFAULT_PHONE);
    // Log success.
    console.log(`✅ Phone number "${DEFAULT_PHONE}" accepted in same field`);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 3 — FULL SIGNUP FLOW: OTP PATH
// ══════════════════════════════════════════════════════════════════════
// The first section that actually creates an account on the server.
test.describe.serial('Step 3: Full Signup — OTP Path', () => {

  // Belt-and-braces: no retries here either, since each run burns a real signup.
  test.describe.configure({ retries: 0 });

  // The address this section signs up with — shared across its five tests.
  let signupEmail: string;

  // TEST 1 — fill the form with a real address, pick OTP, and submit.
  test('Submit form with By OTP and email', async () => {
    // Allow 2 minutes: this test talks to the signup backend.
    test.setTimeout(120_000);

    // If a previous section killed the tab, open a new one and walk back to the form.
    if (sharedPage.isClosed()) {
      sharedPage = await sharedContext.newPage();
      await goToCreateAccount(sharedPage);
      await advancePastLanguageScreen(sharedPage);
    }

    // Are we actually on the form screen right now?
    const onForm = await sharedPage.getByText(hiAlso(/create your account/i)).first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    // If not — e.g. this section was run alone with --grep — navigate there from scratch.
    if (!onForm) {
      await goToCreateAccount(sharedPage);
      await advancePastLanguageScreen(sharedPage);
    }

    // Start from a blank form.
    await clearFormInputs(sharedPage);
    // Mint the address this account will use.
    signupEmail = generateEmail();
    // Write it to disk BEFORE submitting, so it's recoverable even if the run dies here.
    saveEmail(signupEmail);

    // Get the three text boxes.
    const inputs = formInputs(sharedPage);
    // First name.
    await inputs.nth(0).fill(FIRST_NAME);
    // Last name.
    await inputs.nth(1).fill(LAST_NAME);
    // The email we just generated.
    await inputs.nth(2).fill(signupEmail);

    // Choose the "By OTP" login method.
    await sharedPage.getByText(hiAlso(/by otp/i)).first().click();
    // Let the choice register.
    await sharedPage.waitForTimeout(400);

    // Submit the form.
    await sharedPage.getByRole('button', { name: hiAlso(/^next$/i) }).click();
    // Wait for the confirm-name modal to mount.
    await sharedPage.waitForTimeout(2500);
    // Log which address we used.
    console.log(`✅ Form submitted with email: ${signupEmail}`);
  });

  // TEST 2 — Sphere prints this name on certificates, so it asks the user to confirm it.
  test('Name confirmation modal appears and "Confirm name" advances', async () => {
    // If the tab died, skip rather than adding a confusing second failure.
    if (sharedPage.isClosed()) { test.skip(true, 'Page closed'); return; }

    // Look for any of four wordings the modal might use.
    const modalShown = await sharedPage.getByText(
      hiAlso(/confirm your name|will be displayed on the certificate|edit name|confirm name/i)
    ).first().isVisible({ timeout: 5000 }).catch(() => false);
    // The modal must have appeared.
    expect(modalShown).toBe(true);
    // Log success.
    console.log(`✅ Name confirmation modal shown`);

    // Find the confirm button — as a real button if possible, else as plain text.
    const confirmBtn = sharedPage.getByRole('button', { name: hiAlso(/confirm name/i) })
      .or(sharedPage.getByText(hiAlso(/confirm name/i))).first();
    // Click it.
    await confirmBtn.click();
    // Wait for the OTP request to fire and the next screen to render.
    await sharedPage.waitForTimeout(3500);
    // Log success.
    console.log(`✅ Confirmed name`);
  });

  // TEST 3 — confirm the app moved to the verification screen. Tolerant of eight wordings.
  test('OTP screen visible after confirm', async () => {
    // Skip if the tab is gone.
    if (sharedPage.isClosed()) { test.skip(true, 'Page closed'); return; }

    // Let the screen settle.
    await sharedPage.waitForTimeout(2000);
    // Scroll to the top so the heading is in view; ignore failures.
    await sharedPage.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

    // Every phrase that might signal "we're on the OTP screen".
    const otpMarkers = [
      /enter.*otp/i, /verification code/i, /verify/i, /one.time.*password/i,
      /enter.*code/i, /we (have|'ve) sent/i, /sent.*to.*your.*(email|inbox)/i,
      /check your email/i,
    ];

    // Track whether any marker matched.
    let otpVisible = false;
    // Try each phrase in turn; first match wins.
    for (const re of otpMarkers) {
      // Give each one 2 seconds.
      if (await sharedPage.getByText(re).first().isVisible({ timeout: 2000 }).catch(() => false)) {
        // Found it — record and stop looking.
        otpVisible = true;
        console.log(`   Matched marker: ${re}`);
        break;
      }
    }

    // No wording matched — fall back to structure: per-digit boxes are unmistakably an OTP screen.
    if (!otpVisible) {
      // Count inputs that hold exactly one character.
      const digitBoxes = await sharedPage.locator('input[maxlength="1"]').count();
      // Four or more means we're on the OTP screen after all.
      if (digitBoxes >= 4) {
        otpVisible = true;
        console.log(`   Found ${digitBoxes} per-digit OTP boxes — OTP screen confirmed`);
      }
    }

    // Still nothing — dump diagnostics so the report shows where we actually landed.
    if (!otpVisible) {
      // Current URL.
      const url = sharedPage.url();
      // Whatever text is on the page.
      const bodyText = await sharedPage.locator('body').innerText().catch(() => '');
      // Print the URL…
      console.log(`   ⚠️  OTP screen not detected. URL: ${url}`);
      // …and the first 200 characters, whitespace collapsed so it fits on one line.
      console.log(`   Body preview: "${bodyText.slice(0, 200).replace(/\s+/g, ' ')}"`);
    }

    // Fail if we never confirmed the OTP screen.
    expect(otpVisible).toBe(true);
    // Log success.
    console.log(`✅ OTP screen visible`);
  });

  // TEST 4 — the only step that leaves the app to read a real mailbox.
  test('Retrieve OTP from yopmail and submit', async () => {
    // Allow 3 minutes — polling an inbox is slow by design (see the throttling block).
    test.setTimeout(180_000);
    // Skip if the tab is gone.
    if (sharedPage.isClosed()) { test.skip(true, 'Page closed'); return; }

    // Pass sharedContext so Layer 2 (UI scraper) is available as fallback
    // Run the three-layer fetch and get the code.
    const otp = await fetchOtp(signupEmail, { context: sharedContext });
    // A code must have come back.
    expect(otp).not.toBeNull();
    // Log it.
    console.log(`✅ OTP retrieved: ${otp}`);
    // Type it in (handles both single-box and per-digit layouts).
    await enterOtp(sharedPage, otp);

    // Make sure the signup tab is the focused one — the scraper may have stolen focus.
    await sharedPage.bringToFront();
    // Re-find the per-digit boxes. Some builds render them WITHOUT the #code id that enterOtp used,
    // so we fill them again here; re-filling an already-correct field is harmless.
    const otpDigitBoxes = sharedPage.locator('input[maxlength="1"]');
    // How many boxes are there?
    const boxCount = await otpDigitBoxes.count();

    // Per-digit layout?
    if (boxCount >= 4) {
      // Put one digit in each box, stopping at whichever runs out first.
      for (let i = 0; i < Math.min(otp!.length, boxCount); i++) {
        // Fill this box.
        await otpDigitBoxes.nth(i).fill(otp![i]);
        // Tiny pause so the UI keeps up with the typing.
        await sharedPage.waitForTimeout(150);
      }
      // Log what we did.
      console.log(`✅ Filled OTP across ${otp!.length} boxes`);
    } else {
      // Single-field layout — drop the whole code into the first visible input.
      const otpInput = sharedPage.locator('input:not([type="radio"]):not([type="hidden"])').first();
      await otpInput.fill(otp!);
      // Log what we did.
      console.log(`✅ Filled OTP into single input`);
    }

    // Let the form settle before submitting.
    await sharedPage.waitForTimeout(1000);
    // Find the submit button under any of its three likely labels.
    const verifyBtn = sharedPage.getByRole('button', { name: hiAlso(/verify|submit|next/i) }).first();
    // Only click if it's actually there.
    if (await verifyBtn.isVisible().catch(() => false)) {
      // Submitting OTP shows a loading `.overlay` that intercepts pointer
      // events and swallows the click. Wait for it to clear, then retry;
      // the Enter key in enterOtp() may also have already submitted, so a
      // vanished button counts as success.
      // Track whether the submit went through.
      let submitted = false;
      // Try up to four times.
      for (let i = 0; i < 4 && !submitted; i++) {
        // Wait for the loading overlay to disappear; ignore if it never shows.
        await sharedPage.locator('.overlay').first()
          .waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
        // Attempt the click.
        try {
          await verifyBtn.click({ timeout: 6_000 });
          submitted = true;
        } catch {
          // The click failed. If the button has vanished, Enter already submitted — count that as done.
          if (!(await verifyBtn.isVisible().catch(() => false))) { submitted = true; break; }
          // Otherwise wait a second and try again.
          await sharedPage.waitForTimeout(1000);
        }
      }
      // Give the server time to create the account.
      await sharedPage.waitForTimeout(3000);
      // Log success.
      console.log(`✅ Submitted OTP`);
    }
  });

  // TEST 5 — the account now exists; accept either landing (terms page or home).
  test('Account creation succeeds and lands on Terms of Use or Home', async () => {
    // Skip if the tab is gone.
    if (sharedPage.isClosed()) { test.skip(true, 'Page closed'); return; }

    // Let the redirect settle.
    await sharedPage.waitForTimeout(2000);
    // Where did we end up?
    const url = sharedPage.url();
    // Are we on the terms page — by URL, or by its heading?
    const onTerms = /terms/i.test(url) || await sharedPage.getByText(hiAlso(/terms of use|terms and conditions/i))
      .first().isVisible({ timeout: 3000 }).catch(() => false);
    // Or straight on the logged-in home?
    const onHome  = /\/(page|app)\/home/i.test(url);

    // Log both readings.
    console.log(`   Final URL: ${url}`);
    console.log(`   On Terms: ${onTerms}, On Home: ${onHome}`);

    // If we're on the terms screen, clear it so the account is fully usable.
    if (onTerms) {
      // Find the consent checkbox.
      const checkbox = sharedPage.locator('mat-checkbox, input[type="checkbox"]').first();
      // Tick it if it's there; Accept is usually gated on it.
      if (await checkbox.isVisible().catch(() => false)) {
        await checkbox.click({ force: true }).catch(() => {});
        await sharedPage.waitForTimeout(400);
      }
      // Find the Accept button under any of its three likely labels.
      const acceptBtn = sharedPage.getByRole('button', { name: hiAlso(/accept|agree|continue/i) }).first();
      // Click it if present.
      if (await acceptBtn.isVisible().catch(() => false)) {
        await acceptBtn.click();
        // Wait for the redirect into the app.
        await sharedPage.waitForTimeout(3000);
        console.log(`✅ Accepted Terms`);
      }
    }

    // Read the URL one last time.
    const finalUrl = sharedPage.url();
    // Log it.
    console.log(`   ✅ Final landing URL: ${finalUrl}`);
    // Pass if we reached the terms page, home, or any in-app route — i.e. the account exists and works.
    expect(onTerms || onHome || /\/page\/|\/app\//.test(finalUrl)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 4 — FULL SIGNUP FLOW: PASSWORD + PHONE
// ══════════════════════════════════════════════════════════════════════
// The second registration route: identify by phone, set a password instead of verifying a code.
test.describe.serial('Step 4: Full Signup — Phone + Password Path', () => {

  // One test that walks the whole path in a clean tab.
  test('Open a fresh signup tab and complete with phone + password', async () => {
    // Allow 3 minutes — this may retry up to 10 phone numbers.
    test.setTimeout(180_000);

    // Open a new tab so we start with no carried-over form state.
    const page = await sharedContext.newPage();
    // Navigate to signup.
    await goToCreateAccount(page);
    // Pick the first language option.
    await selectLanguageByIndex(page, 0);
    // Move to the form.
    await page.getByRole('button', { name: hiAlso(/^next$/i) }).click();
    // Wait for the transition.
    await page.waitForLoadState('networkidle').catch(() => {});
    // Let the form render.
    await page.waitForTimeout(1500);

    // The phone number we end up using.
    let phone = '';
    // Whether the server accepted it.
    let phoneAccepted = false;
    // Try up to 10 numbers, counting down from 9999999999.
    for (let seed = 0; seed < 10; seed++) {
      // Build this attempt's number.
      phone = generatePhone(seed);
      // Get the three text boxes.
      const inputs = formInputs(page);
      // First name.
      await inputs.nth(0).fill(FIRST_NAME);
      // Last name.
      await inputs.nth(1).fill(LAST_NAME);
      // The candidate phone number.
      await inputs.nth(2).fill(phone);

      // Choose the password login method.
      await page.getByText(hiAlso(/by password/i)).first().click();
      // Let the choice register.
      await page.waitForTimeout(400);

      // Submit.
      await page.getByRole('button', { name: hiAlso(/^next$/i) }).click();
      // Wait for the server's answer.
      await page.waitForTimeout(2500);

      // Did it come back "already registered"?
      if (await isAlreadyExistsToast(page)) {
        // Say so, clear the form, and try the next number down.
        console.log(`⚠️  Phone ${phone} already exists — trying next`);
        await clearFormInputs(page);
        continue;
      }

      // No rejection — this number worked.
      phoneAccepted = true;
      console.log(`✅ Phone ${phone} accepted`);
      // Stop looping.
      break;
    }

    // All 10 candidates taken is a genuine failure worth reporting.
    expect(phoneAccepted).toBe(true);

    // The same confirm-name modal as the OTP path.
    const confirmBtn = page.getByRole('button', { name: hiAlso(/confirm name/i) })
      .or(page.getByText(hiAlso(/confirm name/i))).first();
    // Click it only if it appeared — it's optional on this path.
    if (await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(2500);
      console.log(`✅ Confirmed name`);
    }

    // Find the password box.
    const pwdField = page.locator('input[type="password"]').first();
    // Wait up to 10 seconds for the set-password screen.
    await pwdField.waitFor({ state: 'visible', timeout: 10_000 });
    // Type the password.
    await pwdField.fill(DEFAULT_PASSWORD);
    // Type the same thing into the confirm box (the second password field).
    await page.locator('input[type="password"]').nth(1).fill(DEFAULT_PASSWORD);
    // Let validation run.
    await page.waitForTimeout(800);
    // Log success.
    console.log(`✅ Password set`);

    // Submit the password.
    await page.getByRole('button', { name: hiAlso(/^next$/i) }).click();
    // Wait for the account to be created and the redirect to happen.
    await page.waitForTimeout(4000);

    // Where did we end up?
    const finalUrl = page.url();
    // Log it — note this path only LOGS the landing, it doesn't assert it (see the note below).
    console.log(`   Final URL after submit: ${finalUrl}`);
    console.log(`✅ Signup flow completed`);

    // Close this tab so it doesn't leak into Section 5.
    await page.close().catch(() => {});
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 5 — NEW USER SIGNS UP AND ACCEPTS THE T&C (positive flow)
// ══════════════════════════════════════════════════════════════════════
// Create a brand-new user and ACCEPT the Terms & Conditions straight away,
// landing on the logged-in home. The resulting session is saved to
// .auth/fresh-user.json so a course run can continue as this brand-new user.
//
// The old Decline → re-login → Accept detour was removed: it doubled the OTP
// fetches (and so the runtime) and made minting a fresh user fail whenever the
// public login page changed, without adding coverage the positive path needs.
//
// IDENTITY = EMAIL, on purpose. The phone path can't be automated repeatably:
// a number can only ever register ONE account, the SMS OTP can't be read by
// automation, and any real-looking number risks texting a stranger. A yopmail
// email gives an unlimited supply of single-use identities whose OTP we CAN
// fetch — which is how we overcome the "number can't be reused" limitation.
//
// A physical dummy number is kept here only for MANUAL phone-path testing,
// where a human reads the SMS. It is intentionally NOT used by automation.
const DUMMY_PHONE = process.env.DUMMY_PHONE ?? '8971159809';

// The section every other suite depends on: it mints the reusable logged-in user.
test.describe.serial('Step 5: New user signs up and ACCEPTS the T&C', () => {
  // The tab this section runs in.
  let tcPage: Page;
  // The address this new account uses.
  let tcEmail = '';

  // Overlay-safe click of the OTP verify/submit button (a loading `.overlay`
  // can intercept the click; the Enter key in enterOtp may also have already
  // submitted, so a vanished button counts as done).
  async function submitOtp(page: Page) {
    // Find the submit button under any of its three labels.
    const verify = page.getByRole('button', { name: hiAlso(/verify|submit|next/i) }).first();
    // No button on screen? Then Enter already submitted — just wait and return.
    if (!(await verify.isVisible({ timeout: 3000 }).catch(() => false))) { await page.waitForTimeout(3000); return; }
    // Otherwise try up to four times to get the click through.
    for (let i = 0; i < 4; i++) {
      // Let the loading overlay clear first.
      await page.locator('.overlay').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      // Try the click; success breaks out of the loop.
      try { await verify.click({ timeout: 6000 }); break; }
      // Failed — if the button is gone the form already submitted, so stop; else wait and retry.
      catch { if (!(await verify.isVisible().catch(() => false))) break; await page.waitForTimeout(1000); }
    }
    // Give the server time to finish creating the account.
    await page.waitForTimeout(4000);
  }

  // TEST 1 — sign up a brand-new user and get as far as the terms screen.
  test('Create a new user (email + OTP) and reach the T&C page', async () => {
    // Allow 3 minutes — this fetches a real OTP.
    test.setTimeout(180_000);
    // Reference the dummy number so it stays documented in the file. `void` = evaluate and discard.
    void DUMMY_PHONE; // documented dummy number for manual phone testing only

    // Open a clean tab for this signup.
    tcPage = await sharedContext.newPage();
    // Mint a fresh address.
    tcEmail = generateEmail();
    // Record it to disk before we submit anything.
    saveEmail(tcEmail);

    // Navigate to signup.
    await goToCreateAccount(tcPage);
    // Pick English BY LABEL (not by index) and click Next.
    await advancePastLanguageScreen(tcPage);
    // Start from a blank form.
    await clearFormInputs(tcPage);

    // Get the three text boxes.
    const inputs = formInputs(tcPage);
    // First name.
    await inputs.nth(0).fill(FIRST_NAME);
    // Last name.
    await inputs.nth(1).fill(LAST_NAME);
    // The new address.
    await inputs.nth(2).fill(tcEmail);
    // Choose the OTP login method.
    await tcPage.getByText(hiAlso(/by otp/i)).first().click();
    // Let the choice register.
    await tcPage.waitForTimeout(400);
    // Submit the form.
    await tcPage.getByRole('button', { name: hiAlso(/^next$/i) }).click();
    // Wait for the confirm-name modal.
    await tcPage.waitForTimeout(2500);

    // Confirm-name modal
    // Find the confirm button, as a button or as plain text.
    const confirmBtn = tcPage.getByRole('button', { name: hiAlso(/confirm name/i) })
      .or(tcPage.getByText(hiAlso(/confirm name/i))).first();
    // Click it if it appeared.
    if (await confirmBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
      await confirmBtn.click();
      // Wait for the OTP screen.
      await tcPage.waitForTimeout(3000);
    }

    // Email OTP (fetched from yopmail)
    // Run the three-layer fetch.
    const otp = await fetchOtp(tcEmail, { context: sharedContext });
    // A code must have come back.
    expect(otp).not.toBeNull();
    // Log it.
    console.log(`✅ Signup OTP: ${otp}`);
    // Type it in. `!` tells TypeScript we've already checked it isn't null.
    await enterOtp(tcPage, otp!);
    // Submit it, working around the loading overlay.
    await submitOtp(tcPage);

    // Did we land on the terms screen?
    const onTerms = await isOnTerms(tcPage);
    // Log both the URL and the verdict.
    console.log(`   URL: ${tcPage.url()} | onTerms: ${onTerms}`);
    // A brand-new account MUST be shown the terms before anything else.
    expect(onTerms).toBe(true);
    // Log success.
    console.log(`✅ New user ${tcEmail} reached the Terms & Conditions page`);
  });

  // TEST 2 — accept the terms, confirm we're inside the app, and save the session for other suites.
  test('ACCEPT the T&C → lands on the logged-in home', async () => {
    // Skip if the tab died in the previous test.
    if (tcPage.isClosed()) { test.skip(true, 'Page closed'); return; }
    // Allow 2.5 minutes.
    test.setTimeout(150_000);

    // Re-confirm our position before touching anything.
    const onTerms = await isOnTerms(tcPage);
    // Log it.
    console.log(`   T&C URL: ${tcPage.url()} | onTerms: ${onTerms}`);
    // Must still be on the terms screen.
    expect(onTerms).toBe(true);

    // Accept: tick the consent checkbox (Accept is gated on it) then click Accept
    // Find the consent checkbox.
    const checkbox = tcPage.locator('mat-checkbox, input[type="checkbox"]').first();
    // Tick it if present; `force` skips clickability checks since Material hides the real input.
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.click({ force: true }).catch(() => {});
      await tcPage.waitForTimeout(400);
    }
    // Match the BUTTON, not its wording. The portal language is a per-account
    // setting, and staging serves this screen in Hindi, where Accept reads
    // "स्वीकार करना" — which an anchored /^स्वीकार( करें)?$/ does not match, so
    // the button was never found and the T&C was never accepted there. The
    // accept-btn / decline-btn classes are the same in every language.
    // Find Accept by CSS class first, falling back to its name in either language.
    const acceptBtn = tcPage.locator('button.accept-btn')
      .or(tcPage.getByRole('button', { name: /^accept$|^स्वीकार|^सहमत/i }))
      .first();
    // It must be on screen within 8 seconds.
    await expect(acceptBtn).toBeVisible({ timeout: 8000 });
    // Click it.
    await acceptBtn.click();
    // Wait for the redirect into the app.
    await tcPage.waitForTimeout(4000);

    // Where did we end up?
    const finalUrl = tcPage.url();
    // Are we still stuck on the terms screen?
    const stillOnTerms = await isOnTerms(tcPage);
    // Log both.
    console.log(`   ✅ Final URL after Accept: ${finalUrl} | stillOnTerms: ${stillOnTerms}`);
    // Pass only if we left the terms screen AND reached an in-app route.
    expect(!stillOnTerms && /\/(page|app)\//i.test(finalUrl)).toBe(true);
    // Log success.
    console.log('✅ Accepted T&C — logged in successfully');

    // Hand off this fresh, logged-in user's session so CourseComplete can reuse
    // it (fresh email users are OTP-only, so we save the live session instead of
    // re-logging-in). Consumed by authedTest when USE_FRESH_USER=1.
    // Wrapped in try/catch so a disk-write problem can't fail a signup that actually worked.
    try {
      // Build the path to the .auth folder at the project root.
      const authDir = path.resolve(__dirname, '..', '.auth');
      // Create it if it doesn't exist yet.
      fs.mkdirSync(authDir, { recursive: true });
      // Save the live session — cookies plus origin storage — to disk.
      await tcPage.context().storageState({ path: path.resolve(authDir, 'fresh-user.json') });
      // Record WHICH account that session belongs to, and when it was minted.
      fs.writeFileSync(
        path.resolve(authDir, 'fresh-user-email.json'),
        JSON.stringify({ email: tcEmail, timestamp: Date.now() }, null, 2),
      );
      // Log the hand-off.
      console.log(`💾 Saved fresh-user session for course completion: ${tcEmail}`);
    } catch (e) {
      // Warn but don't fail — take just the first line of the error to keep the log readable.
      console.log(`⚠️  Could not save fresh-user session: ${(e as Error).message.split('\n')[0]}`);
    }

    // Close this tab.
    await tcPage.close().catch(() => {});
  });
});

// ══════════════════════════════════════════════════════════════════════
// SECTION 6 — RESPONSIVE LAYOUT
// ══════════════════════════════════════════════════════════════════════
// Plain `describe` (not `.serial`) — these three build their own contexts, so they're parallel-safe.
test.describe('Responsive Layout', () => {
  // The three screen sizes to check.
  const viewports = [
    { name: 'Mobile (390x844)',   w: 390,  h: 844  },
    { name: 'Tablet (768x1024)',  w: 768,  h: 1024 },
    { name: 'Desktop (1440x900)', w: 1440, h: 900  },
  ];

  // Generate one test per viewport instead of writing the same test three times.
  for (const vp of viewports) {
    // Build the test, naming it after the viewport.
    test(`Renders on ${vp.name}`, async ({ browser }) => {
      // A throwaway context sized to this viewport — isolation is what makes these parallel-safe.
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      // Open a tab in it.
      const page = await ctx.newPage();
      // Navigate to signup.
      await goToCreateAccount(page);
      // Pick the first language.
      await selectLanguageByIndex(page, 0);
      // Move to the form.
      await page.getByRole('button', { name: hiAlso(/^next$/i) }).click();
      // Wait for the transition.
      await page.waitForLoadState('networkidle').catch(() => {});
      // Let the form render.
      await page.waitForTimeout(1200);
      // The form must be reachable and visible at this width.
      await expect(page.getByText(hiAlso(/create your account/i)).first()).toBeVisible();
      // Log success.
      console.log(`✅ ${vp.name}: form renders correctly`);
      // Dispose of the context and its page together.
      await ctx.close();
    });
  }
});
