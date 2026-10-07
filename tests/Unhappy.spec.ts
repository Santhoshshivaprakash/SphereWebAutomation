/**
 * Unhappy paths — login, signup and forgot password
 * ─────────────────────────────────────────────────
 * What a user sees when they get it wrong. Each test checks the message the
 * portal shows (several are short pop-up notices that vanish after a few
 * seconds — expect() waits for them) and that the user is NOT let in.
 *
 *   - wrong password
 *   - password / OTP login with an email that isn't registered
 *   - Login button stays disabled until both fields are filled
 *   - wrong OTP at login
 *   - signing up with an email that already exists
 *   - forgot password: unregistered email, wrong OTP
 *
 * No login session needed. The "registered" account below is only used for
 * WRONG passwords/OTPs, so it is a throwaway account, not TEST_USER (repeated
 * failures could lock an account the other specs depend on).
 *
 * OTP-based tests: the portal limits how many OTPs one account can request in a
 * short time ("OTP generation fail"). When that limit is hit the test is skipped
 * with a note instead of failing.
 */
import { test, expect, Page } from '@playwright/test';
import { bi, hiAlso } from './helpers/i18n';

const BASE_URL = (process.env.BASE_URL ?? 'https://sphere.aastrika.org').replace(/\/+$/, '');
const host = new URL(BASE_URL).hostname;

// A registered throwaway account per environment (override: UNHAPPY_EMAIL).
const REGISTERED = process.env.UNHAPPY_EMAIL
  || (/portal-staging/.test(host) ? 'stage-testauto75240@yopmail.com'
    : /^uat\./.test(host) ? 'uat-testautoma76629@yopmail.com'
      : 'sphereid051@yopmail.com');
const unregistered = () => `nobody-${Date.now().toString(36)}@yopmail.com`;

const OTP_LIMIT = /OTP generation fail/i;

// Production's login page and the staging/UAT build use different ids
// (`#emailOrMobile` vs `#emailOrMobile-lg-otp` …), so match both.
const L = {
  passwordRadio: (p: Page) => p.locator('[id^="usePasswordRB"]').first(),
  id: (p: Page) => p.locator('#emailOrMobile:visible, [id^="emailOrMobile-lg"]:visible').first(),
  password: (p: Page) => p.locator('input[type="password"]:visible').first(),
  loginBtn: (p: Page) => p.locator('[id^="login-username-password"]:visible').first(),
  getOtpBtn: (p: Page) => p.locator('[id^="otp-login"]:visible').first(),
  otpBox: (p: Page) => p.locator('[id^="totp"]:visible, input[name="OTPcode"]:visible').first(),
  submitOtp: (p: Page) => p.locator('[id^="submit-OTP"]:visible').first(),
};

async function openLogin(page: Page, mode: 'password' | 'otp') {
  await page.goto(`${BASE_URL}/public/login`);
  await page.waitForLoadState('networkidle').catch(() => {});
  if (mode === 'password') {
    await L.passwordRadio(page).check({ force: true });
    await expect(L.password(page)).toBeVisible();
  } else {
    await expect(L.id(page)).toBeVisible({ timeout: 30_000 });
  }
}

/** Ask for a login OTP. Returns false (and skips) when the portal's OTP limit is hit. */
async function requestLoginOtp(page: Page, email: string): Promise<void> {
  await openLogin(page, 'otp');
  await L.id(page).fill(email);
  await L.getOtpBtn(page).click();
  const otpBox = L.otpBox(page);
  const limit = page.getByText(OTP_LIMIT).first();
  await expect(otpBox.or(limit)).toBeVisible({ timeout: 20_000 });
  if (await limit.isVisible().catch(() => false)) {
    test.info().annotations.push({ type: 'note', description: `OTP limit hit for ${email}: "OTP generation fail"` });
    test.skip(true, `the portal's OTP limit is hit for ${email} — try again later`);
  }
}

/** The "User doesn't exist" dialog shown for unregistered emails. */
async function expectUserDoesNotExist(page: Page) {
  const dialog = page.locator('mat-dialog-container, [role=dialog]').filter({ hasText: /doesn.?t exist/i }).first();
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole('button', { name: hiAlso(/try again/i) })).toBeVisible();
  await expect(dialog.getByRole('button', { name: hiAlso(/create account/i) })).toBeVisible();
  return dialog;
}

test.describe('Unhappy paths — login', () => {
  test('wrong password shows an error and does not log in', async ({ page }) => {
    await openLogin(page, 'password');
    await L.id(page).fill(REGISTERED);
    await L.password(page).fill('Wrong@12345');
    await L.loginBtn(page).click();
    await expect(page.getByText(/authentication failed.*check credentials/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/public\/login/);
    console.log('✅ wrong password → "Authentication failed ! Please check credentials and try again."');
  });

  test('password login with an unregistered email offers Create account', async ({ page }) => {
    await openLogin(page, 'password');
    await L.id(page).fill(unregistered());
    await L.password(page).fill('Sunbird@123');
    await L.loginBtn(page).click();
    const dialog = await expectUserDoesNotExist(page);
    await dialog.getByRole('button', { name: hiAlso(/create account/i) }).click();
    await expect(page).toHaveURL(/create-account/, { timeout: 20_000 });
    console.log('✅ unregistered (password) → "User doesn\'t exist" → Create account opens signup');
  });

  test('OTP login with an unregistered email shows "User doesn\'t exist"', async ({ page }) => {
    await openLogin(page, 'otp');
    await L.id(page).fill(unregistered());
    await L.getOtpBtn(page).click();
    const dialog = await expectUserDoesNotExist(page);
    // "Try again" closes the dialog and leaves the user on the login page.
    await dialog.getByRole('button', { name: hiAlso(/try again/i) }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/public\/login/);
    console.log('✅ unregistered (OTP) → "User doesn\'t exist" → Try again closes it');
  });

  test('Login button stays disabled until both fields are filled', async ({ page }) => {
    await openLogin(page, 'password');
    const login = L.loginBtn(page);
    await expect(login).toBeDisabled();
    await L.id(page).fill(REGISTERED);
    await expect(login, 'email alone should not enable Login').toBeDisabled();
    await L.password(page).fill('Sunbird@123');
    await expect(login).toBeEnabled();
    await L.id(page).fill('');
    await expect(login, 'password alone should not enable Login').toBeDisabled();
    console.log('✅ Login disabled until email and password are both filled');
  });

  test('wrong OTP at login shows an error and does not log in', async ({ page }) => {
    await requestLoginOtp(page, REGISTERED);
    const submit = L.submitOtp(page);
    await expect(submit, 'Submit should be disabled with no OTP').toBeDisabled();
    await L.otpBox(page).fill('000000');
    await submit.click();
    await expect(page.getByText(hiAlso(/provide correct otp/i)).first()).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/public\/login/);
    console.log('✅ wrong OTP → "Please provide correct otp and try again."');
  });
});

test.describe('Unhappy paths — signup', () => {
  test('signing up with an email that already exists is refused', async ({ page }) => {
    await page.goto(`${BASE_URL}/public/home`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.getByRole('button', { name: hiAlso(/create account/i) }).first().click();
    // by value — the label may read "English" or "अंग्रेजी"
    await page.locator('mat-radio-button[value="en"]').click();
    await page.getByRole('button', { name: hiAlso(/Next/i) }).click();

    await page.locator('input#firstname').fill('Duplicate');
    await page.locator('input#lastname').fill('Check');
    await page.locator('input#email-field').fill(REGISTERED);
    await page.getByRole('radio', { name: hiAlso(/password/i) }).first().click();
    await page.getByRole('button', { name: hiAlso(/Next/i) }).click();
    await page.getByRole('button', { name: hiAlso(/confirm name/i) }).click();
    await page.locator('input#password-field').fill('Sunbird@123');
    await page.locator('input#confpassword-field').fill('Sunbird@123');
    await page.getByRole('button', { name: hiAlso(/Next/i) }).click();

    const dialog = page.locator('mat-dialog-container, [role=dialog]').filter({ hasText: hiAlso(/already exists/i) }).first();
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole('button', { name: hiAlso(/^\s*login\s*$/i) })).toBeVisible();
    await expect(dialog.getByRole('button', { name: hiAlso(/try again/i) })).toBeVisible();
    // Only shown at the END of the form — note it for the report.
    test.info().annotations.push({ type: 'note', description: '"User already exists" appears only after the password step, not when the email is typed' });
    console.log('✅ existing email → "User already exists." with Login / Try again');
  });
});

test.describe('Unhappy paths — forgot password', () => {
  async function openForgot(page: Page, email: string) {
    await page.goto(`${BASE_URL}/public/forgot-password?value=true&version=null`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.locator('#userid-field').fill(email);
    await page.locator('#submit-btn').click();
  }

  test('unregistered email is refused and no OTP screen appears', async ({ page }) => {
    await openForgot(page, unregistered());
    await expect(page.getByText(hiAlso(/issue in resetting your account|not registered|does not exist|doesn.?t exist/i)).first())
      .toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#forgot-password-otp').or(page.getByRole('textbox', { name: hiAlso(/enter otp/i) }))).toHaveCount(0);
    test.info().annotations.push({ type: 'note', description: 'message is the generic "Sorry ! There is some issue in resetting your account. Please contact admin." — it does not say the email is not registered' });
    console.log('✅ unregistered → refused, no OTP screen');
  });

  test('wrong OTP is refused and the password is not reset', async ({ page }) => {
    await openForgot(page, REGISTERED);
    // id on staging/UAT; production's box has a generated id, so also match its label.
    const otpBox = page.locator('#forgot-password-otp').or(page.getByRole('textbox', { name: hiAlso(/enter otp/i) })).first();
    const refused = page.getByText(hiAlso(/issue in resetting your account/i)).first();
    await expect(otpBox.or(refused)).toBeVisible({ timeout: 20_000 });
    test.skip(await refused.isVisible().catch(() => false), `the portal would not send a reset OTP for ${REGISTERED} right now`);

    await otpBox.fill('000000');
    await page.getByRole('button', { name: hiAlso(/reset password/i) }).click();
    await expect(page.getByText(hiAlso(/issue in verifying your account|incorrect otp|invalid otp|provide correct otp/i)).first())
      .toBeVisible({ timeout: 20_000 });
    await expect(page.locator('#password-new'), 'must not reach the set-new-password screen').toHaveCount(0);
    test.info().annotations.push({ type: 'note', description: 'wrong OTP message is "Sorry ! There is some issue in verifying your account. Please try after sometime." — it does not say the OTP is wrong' });
    console.log('✅ wrong reset OTP → refused, password not reset');
  });
});
