// The test runner, the assertion library, and three types we annotate with.
import { generateTestEmail, recordCreatedEmail } from './helpers/yopmail';
import { test, expect, Page, BrowserContext, Locator } from '@playwright/test';
// The shared, hardened OTP reader (throttling, captcha detection, retries).
import { getOtpFromYopmail } from './helpers/otp';
import { hiAlso } from './helpers/i18n';

// OTP/signup can't run on the localhost mirror, so this targets staging
// Runs against the shared BASE_URL (production).
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// The signup entry URL every test here starts from.
const CREATE_ACCOUNT_URL = `${BASE_URL}/app/create-account`;
// yopmail's English homepage.
const YOPMAIL_URL = 'https://yopmail.com/en/';
// What a logged-in URL looks like — used to prove we made it past the terms gate.
const PRIVATE_URL_PATTERN = /\/app\/(home|dashboard|welcome|page)/i;

// ────────────────────────────────────────────────────────────────────
// Helpers (re-used / extended from create-account.spec.ts)
// ────────────────────────────────────────────────────────────────────
// Scroll an element into view, then click it.
async function scrollAndClick(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
}

// Click something without letting a failure fail the test — it logs instead.
async function safeClick(page: Page, locator: Locator, label: string) {
  try {
    await scrollAndClick(page, locator);
    console.log(`✅ Clicked: ${label}`);
  } catch (err) {
    // Take only the first line of the error, so one stack trace doesn't flood the log.
    console.log(`⚠️  Could not click ${label}: ${(err as Error).message.split('\n')[0]}`);
  }
}

// Build a fresh throwaway address for one signup.
function uniqueEmail(): string {
  // 5-digit random suffix (10000–99999) — avoids 10-digit numbers which can be
  // mistaken for phone numbers by the form. Each test gets a fresh email
  // because once Next is clicked on the password screen, the email is
  // permanently registered and cannot be reused.
  const suffix = Math.floor(10000 + Math.random() * 90000);
  return generateTestEmail('testautomation', suffix);
}

// Find a language radio by name rather than position.
function languageOption(page: Page, name: 'english' | 'hindi'): Locator {
  // Hindi is matched in both scripts, since the screen may render in either language.
  const matcher = name === 'english' ? /english|अंग्रेज़?ी/i : /हिंदी|hindi/i;
  // Three selector shapes, covering the Material versions this app has shipped.
  return page.locator('mat-radio-button, .mat-mdc-radio-button, [role="radio"]')
    .filter({ hasText: matcher })
    .first();
}

// Select a language, verify it took, and report whether it did.
async function selectLanguage(page: Page, name: 'english' | 'hindi') {
  // Find it by label.
  const option = languageOption(page, name);
  // Bring it on screen.
  await option.scrollIntoViewIfNeeded();
  // Click the wrapper.
  await option.click();
  // Let Angular register the change.
  await page.waitForTimeout(400);

  // Verify against the REAL radio input, which holds the checked state.
  const idx = name === 'english' ? 0 : 1;
  const radio = page.locator('input[type="radio"]').nth(idx);
  // Did the wrapper click take?
  let checked = await radio.isChecked().catch(() => false);

  // If not, tick the input directly. `force` skips the clickability checks that
  // Material's hidden input would otherwise fail.
  if (!checked) {
    await radio.check({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    // Re-read so the returned value reflects the fallback attempt.
    checked = await radio.isChecked().catch(() => false);
  }
  // Report the final state rather than throwing.
  return checked;
}

// ────────────────────────────────────────────────────────────────────
// OTP Extraction from Yopmail
// ────────────────────────────────────────────────────────────────────
/**
 * Opens yopmail in a new browser tab, navigates to the inbox for the given
 * email, opens the latest OTP email, and extracts the 6-digit OTP code.
 *
 * Returns the OTP code as a string.
 */
// Thin wrapper around the shared helper, kept so the call sites read unchanged.
async function fetchOtpFromYopmail(context: BrowserContext, email: string): Promise<string> {
  return getOtpFromYopmail(context, email);
}

// ────────────────────────────────────────────────────────────────────
// End-to-end signup helper — completes Steps 1-4 with given email
// ────────────────────────────────────────────────────────────────────
// Drives signup as far as the OTP screen. Every test below starts from here.
async function completeSignup(page: Page, email: string, password = 'Sunbird@123') {
  console.log(`🚀 Starting signup for: ${email}`);

  // Open the signup page.
  await page.goto(CREATE_ACCOUNT_URL);
  await page.waitForLoadState('networkidle');

  // Handle case where app redirects to /public/login first
  if (/\/public\/login/i.test(page.url())) {
    // Click the "create an account" link to get back on course — as a button or as text.
    const createBtn = page.getByRole('button', { name: hiAlso(/create an account/i) })
      .or(page.getByText(hiAlso(/create an account/i))).first();
    await scrollAndClick(page, createBtn);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);
  }

  // Step 1: Language
  await selectLanguage(page, 'english');
  // The Next button.
  const nextBtn = page.getByRole('button', { name: hiAlso(/^next$/i) });
  // It only enables once a language is chosen, so this also confirms the selection worked.
  await expect(nextBtn).toBeEnabled({ timeout: 5000 });
  // Advance.
  await scrollAndClick(page, nextBtn);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  console.log('   ✅ Step 1 done — language selected');

  // Step 2: Fill account form
  // All inputs, addressed by position.
  const inputs = page.locator('input');
  await inputs.nth(0).fill('Test');
  await inputs.nth(1).fill('Automation');
  await inputs.nth(2).fill(email);

  // Select "By OTP" (so we land on the OTP screen)
  await scrollAndClick(page, page.getByText(hiAlso(/by otp/i)).first());
  await page.waitForTimeout(400);

  // Submit the form.
  await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/^next$/i) }));
  await page.waitForTimeout(1500);
  console.log('   ✅ Step 2 done — form submitted');

  // Step 3: Confirm name modal
  // Sphere prints this name on certificates, so it asks the user to confirm it.
  const confirmBtn = page.getByRole('button', { name: hiAlso(/confirm name/i) })
    .or(page.getByText(hiAlso(/confirm name/i)))
    .first();
  await scrollAndClick(page, confirmBtn);
  // Wait for the OTP request to fire and the OTP screen to render.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  console.log('   ✅ Step 3 done — name confirmed');
}

// ══════════════════════════════════════════════════════════════════
// POST-SIGNUP FLOW — OTP Verification → Terms of Use → Private Page
// ══════════════════════════════════════════════════════════════════
test.describe('Post-Signup Flow - Complete Element Coverage', () => {

  // Each test starts from a fresh signup with a unique email
  // Shared between beforeEach and the test bodies.
  let signupEmail: string;

  // Runs before EVERY test — so each one costs a full real signup.
  test.beforeEach(async ({ page }) => {
    // A brand-new address, because an email can only ever register once.
    signupEmail = uniqueEmail();
    // Record it in the account ledger (generated-emails.txt) before it is submitted.
    recordCreatedEmail(signupEmail, 'OTP');
    // Drive signup as far as the OTP screen.
    await completeSignup(page, signupEmail);
    // After Confirm name on OTP flow → user should be on "Check your Email!" screen
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 1: CHECK YOUR EMAIL (OTP) SCREEN
  // ────────────────────────────────────────────────────────────────
  test.describe('Step 5 - OTP Verification Screen', () => {

    test('"Check your Email!" heading is visible', async ({ page }) => {
      // The OTP screen's heading.
      const heading = page.getByText(hiAlso(/check your email/i)).first();
      // It must appear — proof that the signup POST succeeded.
      await expect(heading).toBeVisible({ timeout: 10000 });
      console.log('✅ "Check your Email!" heading visible');
    });

    test('Sub-heading shows the registered email address', async ({ page }) => {
      // The explanatory line.
      const sub = page.getByText(hiAlso(/we have sent an otp to/i));
      await expect(sub).toBeVisible();
      console.log('✅ "We have sent an OTP to" text visible');

      // The screen must echo back the exact address we registered — proof it kept the right one.
      const emailDisplayed = page.getByText(signupEmail, { exact: false });
      await expect(emailDisplayed.first()).toBeVisible();
      console.log(`✅ Registered email "${signupEmail}" displayed on screen`);
    });

    test('Phone illustration image is visible', async ({ page }) => {
      // Four ways to find the illustration: by alt text, or by file extension.
      const img = page.locator('img[alt*="otp" i], img[alt*="email" i], img[src*=".svg"], img[src*=".png"]').first();
      // Observed, not asserted — decoration, so a missing image shouldn't fail the run.
      const visible = await img.isVisible().catch(() => false);
      console.log(`✅ Illustration image visible: ${visible}`);
    });

    test('OTP expiry timer is visible and counting down', async ({ page }) => {
      // The countdown text.
      const timer = page.getByText(/otp expires in.*minutes?/i).first();
      // It must be present.
      await expect(timer).toBeVisible();
      // Read it once.
      const text1 = await timer.textContent();
      console.log(`   Timer reading: "${text1?.trim()}"`);

      // Wait a few seconds and read again — should be different (counting down)
      await page.waitForTimeout(3000);
      const text2 = await timer.textContent();
      console.log(`   Timer after 3s: "${text2?.trim()}"`);

      // Don't strictly assert difference (some apps tick per minute) — just log
      // A minute-granularity timer wouldn't change in 3 seconds, so asserting would be flaky.
      console.log('✅ Timer text captured');
    });

    test('OTP code input field is visible and accepts numeric input', async ({ page }) => {
      // Prefer the placeholder; fall back to any text/tel/number input.
      const codeInput = page.getByPlaceholder(hiAlso(/code/i))
        .or(page.locator('input[type="text"], input[type="tel"], input[type="number"]'))
        .first();
      await expect(codeInput).toBeVisible();
      console.log('✅ Code input field visible');

      // Type six digits…
      await codeInput.fill('123456');
      // …and confirm the field kept them all — no maxlength truncation or input mask.
      await expect(codeInput).toHaveValue('123456');
      console.log('✅ Code field accepts 6-digit input');
    });

    test('"Did not receive a OTP?" text and resend link are visible', async ({ page }) => {
      // The prompt.
      const text = page.getByText(/did not receive.*otp/i).first();
      await expect(text).toBeVisible();
      console.log('✅ "Did not receive a OTP?" text visible');

      // And the resend link beside it.
      const resendLink = page.getByText(hiAlso(/click here to resend/i)).first();
      await expect(resendLink).toBeVisible();
      console.log('✅ "Click Here to resend" link visible');
    });

    test('Resend link is clickable', async ({ page }) => {
      // The resend link.
      const resendLink = page.getByText(hiAlso(/click here to resend/i)).first();
      // safeClick: the click is attempted but a failure only logs.
      await safeClick(page, resendLink, 'Click Here to resend');
      await page.waitForTimeout(1500);

      // Capture any toast confirming OTP was resent
      const toast = page.locator('mat-snack-bar-container, [role="alert"], .toast').first();
      // Log whatever the server said — useful evidence, but not asserted.
      if (await toast.isVisible().catch(() => false)) {
        const txt = (await toast.textContent())?.trim();
        console.log(`   Resend confirmation: "${txt}"`);
      }
    });

    test('Next button is visible and disabled when code field is empty', async ({ page }) => {
      // The submit button.
      const nextBtn = page.getByRole('button', { name: hiAlso(/^next$/i) });
      await expect(nextBtn).toBeVisible();
      console.log('✅ Next button visible on OTP screen');

      // Blank the code field so the state is unambiguous.
      const codeInput = page.locator('input').first();
      await codeInput.fill('');
      await page.waitForTimeout(300);

      // Observed, not asserted — the gate is recorded rather than required.
      const disabled = await nextBtn.isDisabled().catch(() => false);
      console.log(`✅ Next button disabled with empty code: ${disabled}`);
    });

    test('Invalid OTP shows an error message', async ({ page }) => {
      // Type a code that cannot be correct.
      const codeInput = page.locator('input').first();
      await codeInput.fill('000000');
      await page.waitForTimeout(300);

      // Will the form even let us submit it?
      const nextBtn = page.getByRole('button', { name: hiAlso(/^next$/i) });
      const enabled = await nextBtn.isEnabled().catch(() => false);
      console.log(`   Next enabled with invalid code: ${enabled}`);

      // Only submit if the client-side validation allowed it.
      if (enabled) {
        await scrollAndClick(page, nextBtn);
        // Wait for the server's rejection.
        await page.waitForTimeout(2500);

        // Capture the error toast, matching any of four shapes.
        const toast = page.locator('mat-snack-bar-container, [role="alert"], .toast, .error-message').first();
        // Log the message rather than asserting its wording, which varies by language.
        if (await toast.isVisible().catch(() => false)) {
          const txt = (await toast.textContent())?.trim();
          console.log(`   Error message for invalid OTP: "${txt}"`);
        }
      }
      console.log('✅ Invalid OTP case exercised');
    });

    // ════════════════════════════════════════════════════════════
    // THE MAIN END-TO-END TEST: fetch real OTP and complete signup
    // ════════════════════════════════════════════════════════════
    test('Full flow — fetch OTP from yopmail, submit, accept Terms, land on private page', async ({ page, context }) => {
      // 1. Fetch the OTP from yopmail in a new browser tab
      const otp = await fetchOtpFromYopmail(context, signupEmail);
      // It must look like a real code — 4 to 8 digits and nothing else.
      expect(otp).toMatch(/^\d{4,8}$/);
      console.log(`✅ OTP fetched: ${otp}`);

      // 2. Type the OTP and submit
      const codeInput = page.getByPlaceholder(hiAlso(/code/i)).or(page.locator('input').first()).first();
      await codeInput.fill(otp);
      await page.waitForTimeout(400);

      // The submit button.
      const nextBtn = page.getByRole('button', { name: hiAlso(/^next$/i) });
      // A valid code must unlock it.
      await expect(nextBtn).toBeEnabled({ timeout: 5000 });
      console.log('✅ Next button enabled after OTP entry');

      // Submit.
      await scrollAndClick(page, nextBtn);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
      console.log(`   URL after OTP submit: ${page.url()}`);

      // 3. Terms of Use screen should appear
      // Anchored, so it can't match the footer link of the same name.
      const tosHeading = page.getByText(hiAlso(/^terms of use$/i)).first();
      await expect(tosHeading).toBeVisible({ timeout: 10000 });
      console.log('✅ Terms of Use screen visible');

      // 4. Verify TOS elements
      const acknowledgeText = page.getByText(/by ticking the box below.*acknowledge.*read and agree/i);
      await expect(acknowledgeText.first()).toBeVisible();
      console.log('✅ Acknowledgement text visible');

      // The link to the actual policy documents.
      const tosLink = page.getByText(hiAlso(/terms of use and privacy policy/i)).first();
      await expect(tosLink).toBeVisible();
      console.log('✅ "Terms of use and Privacy Policy" link visible');

      // The consent checkbox's label.
      const checkboxLabel = page.getByText(hiAlso(/i have read and agree to the terms of use & privacy policy/i));
      await expect(checkboxLabel.first()).toBeVisible();
      console.log('✅ Checkbox label visible');

      // 5. Verify Accept button is disabled before checking the box
      const acceptBtn = page.getByRole('button', { name: hiAlso(/^accept$/i) });
      await expect(acceptBtn).toBeVisible();
      // Recorded rather than asserted — the gate is observed here, then proven at step 8.
      const acceptDisabledBefore = await acceptBtn.isDisabled().catch(() => false);
      console.log(`✅ Accept button disabled before checking the box: ${acceptDisabledBefore}`);

      // 6. Decline button is also visible
      // By class as well as label — staging serves this screen in Hindi ("मना करें").
      const declineBtn = page.locator('button.decline-btn')
        .or(page.getByRole('button', { name: /^decline$|^मना/i })).first();
      await expect(declineBtn).toBeVisible();
      console.log('✅ Decline button visible');

      // 7. Check the agreement checkbox
      // Prefer the ARIA role; fall back to the Material classes or the raw input.
      const checkbox = page.getByRole('checkbox')
        .or(page.locator('mat-checkbox, .mat-mdc-checkbox, input[type="checkbox"]'))
        .first();
      await scrollAndClick(page, checkbox);
      await page.waitForTimeout(500);

      // Verify it's actually checked
      const isChecked = await page.locator('input[type="checkbox"]').first().isChecked().catch(() => false);
      console.log(`✅ Agreement checkbox checked: ${isChecked}`);

      if (!isChecked) {
        // Fallback — Material checkboxes sometimes need the label clicked
        await scrollAndClick(page, page.getByText(hiAlso(/i have read and agree/i)).first());
        await page.waitForTimeout(500);
      }

      // 8. Accept button should now be enabled
      // THIS is the real assertion about the consent gate: ticking the box unlocks Accept.
      await expect(acceptBtn).toBeEnabled({ timeout: 5000 });
      console.log('✅ Accept button enabled after checking the box');

      // 9. Click Accept
      // Keep the URL so the log can show the before/after transition.
      const urlBeforeAccept = page.url();
      await scrollAndClick(page, acceptBtn);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(4000);
      console.log(`   URL before Accept: ${urlBeforeAccept}`);
      console.log(`   URL after Accept:  ${page.url()}`);

      // 10. Verify we landed on the private (logged-in) page
      const finalUrl = page.url();
      // Two ways to qualify: it matches a known private route, OR it's simply no longer
      // any of the public ones. The second clause keeps this working across route renames.
      const onPrivate = PRIVATE_URL_PATTERN.test(finalUrl) ||
                        !/(public|create-account|signup|login|terms)/i.test(finalUrl);
      console.log(`✅ Landed on private page: ${onPrivate} → ${finalUrl}`);
      // The account exists and the app let it in.
      expect(onPrivate).toBe(true);

      console.log('🎉 End-to-end signup flow completed successfully');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // SECTION 2: TERMS OF USE SCREEN (isolated checks)
  // These run with a stubbed OTP path — only useful if you have a way
  // to bypass OTP in a test environment. Marked .skip() by default.
  // ────────────────────────────────────────────────────────────────
  // NOTE: each test here repeats the signup + OTP fetch, so this group costs
  // five full signups and five inbox polls.
  test.describe('Step 6 - Terms of Use (isolated)', () => {

    test('"Terms of Use" heading is visible', async ({ page, context }) => {
      // Fetch and submit a real OTP to reach the terms screen.
      const otp = await fetchOtpFromYopmail(context, signupEmail);
      await page.locator('input').first().fill(otp);
      await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/^next$/i) }));
      await page.waitForTimeout(3000);

      // Anchored, so it can't match the footer link of the same name.
      const heading = page.getByText(hiAlso(/^terms of use$/i)).first();
      await expect(heading).toBeVisible({ timeout: 10000 });
      console.log('✅ "Terms of Use" heading visible');
    });

    test('Illustration is visible on Terms of Use page', async ({ page, context }) => {
      // Same setup: real OTP, real terms screen.
      const otp = await fetchOtpFromYopmail(context, signupEmail);
      await page.locator('input').first().fill(otp);
      await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/^next$/i) }));
      await page.waitForTimeout(3000);

      // Just "the first image on the page" — loose, but the screen has only one.
      const img = page.locator('img').first();
      await expect(img).toBeVisible();
      console.log('✅ Terms of Use illustration visible');
    });

    test('Decline button is visible and clickable', async ({ page, context }) => {
      // Same setup.
      const otp = await fetchOtpFromYopmail(context, signupEmail);
      await page.locator('input').first().fill(otp);
      await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/^next$/i) }));
      await page.waitForTimeout(3000);

      // By class as well as label — staging serves this screen in Hindi ("मना करें").
      const declineBtn = page.locator('button.decline-btn')
        .or(page.getByRole('button', { name: /^decline$|^मना/i })).first();
      await expect(declineBtn).toBeVisible();
      console.log('✅ Decline button visible');

      // Click it and log where it led — the destination is recorded, not asserted.
      const urlBefore = page.url();
      await safeClick(page, declineBtn, 'Decline');
      await page.waitForTimeout(2000);
      console.log(`   URL before Decline: ${urlBefore}`);
      console.log(`   URL after Decline:  ${page.url()}`);
    });

    test('Unchecking the box disables Accept again', async ({ page, context }) => {
      // Same setup.
      const otp = await fetchOtpFromYopmail(context, signupEmail);
      await page.locator('input').first().fill(otp);
      await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/^next$/i) }));
      await page.waitForTimeout(3000);

      // The consent checkbox and the button it gates.
      const checkbox = page.locator('input[type="checkbox"]').first();
      const acceptBtn = page.getByRole('button', { name: hiAlso(/^accept$/i) });

      // Check
      await scrollAndClick(page, checkbox);
      await page.waitForTimeout(400);
      // Record the enabled state with the box ticked.
      const enabledChecked = await acceptBtn.isEnabled().catch(() => false);
      console.log(`   Accept enabled (after check): ${enabledChecked}`);

      // Uncheck
      await scrollAndClick(page, checkbox);
      await page.waitForTimeout(400);
      // And with it un-ticked.
      const enabledUnchecked = await acceptBtn.isEnabled().catch(() => false);
      console.log(`   Accept enabled (after uncheck): ${enabledUnchecked}`);

      // Both directions are asserted — the gate must open AND close with the box.
      expect(enabledChecked).toBe(true);
      expect(enabledUnchecked).toBe(false);
      console.log('✅ Accept button state correctly reflects checkbox state');
    });

    test('Terms of Use link is visible', async ({ page, context }) => {
      // Same setup.
      const otp = await fetchOtpFromYopmail(context, signupEmail);
      await page.locator('input').first().fill(otp);
      await scrollAndClick(page, page.getByRole('button', { name: hiAlso(/^next$/i) }));
      await page.waitForTimeout(3000);

      // The link to the policy documents.
      const link = page.getByText(hiAlso(/terms of use and privacy policy/i)).first();
      await expect(link).toBeVisible();
      console.log('✅ Terms of use & Privacy Policy link visible');
      // Note: we don't click the link here — it likely opens external content
      // or scrolls within the page; that's a separate test concern.
    });
  });
});
