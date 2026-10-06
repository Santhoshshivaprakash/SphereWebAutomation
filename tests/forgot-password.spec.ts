import { test, expect } from '@playwright/test';
import { getOtpFromYopmail } from './helpers/otp';
import { loginWithPassword } from './helpers/login';

/**
 * Forgot-password flow (Sphere web).
 * ──────────────────────────────────
 * Same flow as the e-Kshamata version: login page → Forgot Password? → enter the
 * account email → Submit → read the OTP from the account's Yopmail inbox → enter
 * it → Reset Password → set the new password on the Keycloak screen the reset
 * hands off to.
 *
 *   - the OTP is READ LIVE from Yopmail (shared reader in helpers/otp.ts);
 *   - the Keycloak screen is reached by following the redirect — its
 *     tab_id/execution token is single-use, so it can't be a recorded goto().
 *
 * Only runs when FORGOT_EMAIL is set, so a full-suite run never resets a
 * password by accident. Use the interactive runner:
 *
 *   npm run forgot                 (asks env + account)
 *   npm run forgot -- <email>      reset that account on staging
 *
 * Env vars:
 *   BASE_URL              which environment (default production)
 *   FORGOT_EMAIL          the @yopmail.com account to reset
 *   FORGOT_NEW_PASSWORD   the password to set (default Sunbird@123)
 */
const BASE_URL = (process.env.BASE_URL ?? 'https://sphere.aastrika.org').replace(/\/+$/, '');
const EMAIL = process.env.FORGOT_EMAIL || '';
const NEW_PASSWORD = process.env.FORGOT_NEW_PASSWORD || 'Sunbird@123';

test.describe('Sphere web — forgot password', () => {
  // The OTP mail has to actually arrive, so give the flow room.
  test.setTimeout(180_000);

  test('resets the password via an emailed OTP', async ({ page, context }) => {
    test.skip(!EMAIL, 'Set FORGOT_EMAIL (or use `npm run forgot`) to reset an account');
    expect(EMAIL, 'FORGOT_EMAIL must be a @yopmail.com address so the OTP can be read')
      .toMatch(/@yopmail\.com$/i);

    // ── 1. login page → Forgot Password? ──
    await page.goto(`${BASE_URL}/public/login`);
    await page.waitForLoadState('networkidle').catch(() => {});
    // The link only shows in password mode. Hindi: "पासवर्ड से लॉगिन करें".
    const modeToggle = page.getByText(/login with password|पासवर्ड\s*से\s*लॉगिन/i).first();
    await modeToggle.waitFor({ state: 'visible', timeout: 60_000 });
    await modeToggle.click();
    const forgotLink = page.locator('#fgtKeycloakFlow-lg')
      .or(page.getByText(/forgot password|पासवर्ड\s*भूल/i))
      .first();
    await forgotLink.waitFor({ state: 'visible', timeout: 15_000 });
    await forgotLink.click();
    await page.waitForURL(/forgot-password/, { timeout: 20_000 });

    // ── 2. note the code already in the inbox, then enter the email and submit ──
    // A rerun would otherwise read the previous reset's OTP before the new mail
    // lands, and the portal rejects it.
    const staleOtp = await getOtpFromYopmail(context, EMAIL, { attempts: 1 }).catch(() => null);
    if (staleOtp) console.log(`[forgot] inbox already has code ${staleOtp} — will wait for a new one`);
    const idField = page.locator('#userid-field');
    await idField.waitFor({ state: 'visible', timeout: 15_000 });
    await idField.fill(EMAIL);
    await page.locator('#submit-btn').click();

    // ── 3. did the reset move on to the OTP screen, or did it error? ──
    // If the portal refuses the reset no OTP is sent, so fail fast instead of
    // waiting on a field that never shows (and reading an old OTP from the inbox).
    const otpField = page.locator('#forgot-password-otp')
      .or(page.getByRole('textbox', { name: /enter otp/i }))
      .first();
    const resetError = page
      .getByText(/issue in resetting your account|please contact admin|not registered|does not exist|invalid user/i)
      .first();
    await expect(otpField.or(resetError)).toBeVisible({ timeout: 20_000 });
    if (await resetError.isVisible().catch(() => false)) {
      const msg = (await resetError.textContent().catch(() => ''))?.trim() || 'reset refused by the portal';
      throw new Error(
        `Password reset refused for ${EMAIL} on ${new URL(BASE_URL).hostname}: "${msg}". ` +
          `The account can't be reset by email OTP on this environment — not a script fault.`,
      );
    }

    // ── 4. read the NEW OTP (skipping the stale one noted above) ──
    const otp = await getOtpFromYopmail(context, EMAIL, { attempts: 15, intervalMs: 5000, ignore: staleOtp });
    console.log(`[forgot] OTP read from ${EMAIL}: ${otp}`);
    await otpField.fill(otp);
    await page.getByRole('button', { name: /reset password/i }).click();

    // ── 5. set the new password on the Keycloak update-password screen ──
    const newPwd = page.locator('#password-new')
      .or(page.getByRole('textbox', { name: /new password/i }))
      .first();
    const confirmPwd = page.locator('#password-confirm')
      .or(page.getByRole('textbox', { name: /confirm password/i }))
      .first();
    await newPwd.waitFor({ state: 'visible', timeout: 30_000 });
    await newPwd.fill(NEW_PASSWORD);
    await confirmPwd.fill(NEW_PASSWORD);
    await page.getByRole('button', { name: /set password|submit/i })
      .or(page.locator('input[type="submit"]'))
      .first()
      .click();

    // ── 6. back at the app ──
    const backLink = page.getByRole('link', { name: /back to aastrika sphere|back to application/i });
    await expect(backLink).toBeVisible({ timeout: 30_000 });
    console.log('[forgot] password reset complete — back-to-app link shown');

    // ── 7. prove it: log in with the new password ──
    await context.clearCookies();
    await loginWithPassword(page, EMAIL, NEW_PASSWORD);
    await expect(page, 'login with the new password should leave /public/login')
      .not.toHaveURL(/\/public\/login/, { timeout: 20_000 });
    console.log(`[forgot] logged in with the new password — ${EMAIL} now uses ${NEW_PASSWORD}`);
  });
});
