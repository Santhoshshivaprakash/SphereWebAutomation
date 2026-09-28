/**
 * Reusable password-login helper.
 *
 * The repo already has a *signup* helper (createAccount.ts) but no reusable
 * *login*. This fills that gap: log an existing account in through the real
 * public/login UI, clearing the new-user terms gate if it appears.
 *
 * Selectors mirror the ones verified in public-login.spec.ts.
 */
// The browser tab, the context (needed to open a second tab for the OTP), and the assertion library.
import { Page, BrowserContext, expect } from '@playwright/test';
// Shared OTP reader — opens yopmail and polls the inbox.
import { getOtpFromYopmail } from './otp';

// Which environment to log in to.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';
// How long to wait for the login shell to paint. Deliberately well above the
// global actionTimeout — a slow login page must not read as a selector failure.
const LOGIN_SHELL_TIMEOUT = Number(process.env.LOGIN_SHELL_TIMEOUT ?? 60_000);

/**
 * If the page is on the new-user terms gate, accept it. Best-effort and
 * non-fatal (markup is language/theme dependent). No-op for existing users.
 */
/**
 * Accept the Terms of use gate whenever it appears — new user or old.
 *
 * Detected by the gate's OWN BUTTONS (`accept-btn` / `decline-btn`), not by its
 * wording. The previous version looked for "Terms and conditions" while the page
 * actually says "Terms of use", so it decided the gate was not there and
 * returned without accepting; and the portal renders this screen in the
 * account's language, where Accept reads "स्वीकार करना".
 *
 * Accept stays DISABLED until the consent box is ticked, so the box is ticked
 * first and verified — a click that does not register would otherwise leave the
 * run pressing a dead button.
 *
 * Safe to call after every login: it returns false immediately when no gate is
 * on screen.
 */
export async function acceptTermsIfPresent(page: Page): Promise<boolean> {
  const acceptBtn = page.locator('button.accept-btn')
    .or(page.getByRole('button', { name: /^\s*(accept|agree|proceed|continue|submit)\s*$/i }))
    .or(page.getByRole('button', { name: /^\s*(स्वीकार|सहमत)/i }))
    .first();

  // Let the post-login redirect chain finish before deciding anything. Login
  // resolves the moment the URL stops being /public/login, which is BEFORE the
  // app has routed to the gate.
  await page.waitForLoadState('networkidle').catch(() => {});

  // waitFor, NOT isVisible: `isVisible()` is an INSTANT check and its `timeout`
  // option does not make it wait. Detection built on it answered "no gate" while
  // the SPA was still rendering one — which is precisely why a Terms screen a
  // human sees on staging was never accepted, and every fresh account then sat
  // on /app/new-tnc with an empty home behind it.
  const looksLikeTerms = /new-tnc|\/tnc\b|consent/i.test(page.url());
  const present = await acceptBtn
    .waitFor({ state: 'visible', timeout: looksLikeTerms ? 25_000 : 6_000 })
    .then(() => true)
    .catch(() => false);
  if (!present) return false;
  console.log('[tnc] Terms of use gate — accepting');

  // ── tick the consent box, and make sure it took ──
  const boxChecked = async () =>
    page.evaluate(() => {
      const input = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      const mat = document.querySelector('mat-checkbox, [role="checkbox"]');
      return Boolean(input?.checked) || mat?.getAttribute('aria-checked') === 'true'
        || Boolean(mat?.classList.contains('mat-mdc-checkbox-checked'));
    }).catch(() => false);

  for (let attempt = 1; attempt <= 3 && !(await boxChecked()); attempt++) {
    const targets = [
      page.locator('mat-checkbox.tnc-checkbox label, mat-checkbox label').first(),
      page.locator('mat-checkbox, [role="checkbox"]').first(),
      page.locator('input[type="checkbox"]').first(),
    ];
    for (const target of targets) {
      if (!(await target.isVisible({ timeout: 1_000 }).catch(() => false))) continue;
      await target.click({ force: attempt > 1 }).catch(() => {});
      await page.waitForTimeout(350);
      if (await boxChecked()) break;
    }
  }
  if (!(await boxChecked())) console.log('[tnc] the consent box would not tick — Accept may stay disabled');

  // ── accept ──
  await acceptBtn.scrollIntoViewIfNeeded().catch(() => {});
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (!(await acceptBtn.isDisabled().catch(() => false))) {
      await acceptBtn.click().catch(() => {});
      await page.waitForTimeout(1_200);
      break;
    }
    await page.waitForTimeout(700);
  }

  // ── did we actually leave? ──
  const left = await page
    .waitForFunction(() => !document.querySelector('button.accept-btn'), undefined, { timeout: 12_000 })
    .then(() => true).catch(() => false);
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log(left ? '[tnc] accepted' : '[tnc] still on the Terms of use screen after accepting');
  return left;
}

/** Log in with email/phone + password via the public login page. */
export async function loginWithPassword(page: Page, identifier: string, password: string): Promise<void> {
  // Open the login page.
  await page.goto(`${BASE_URL}/public/login`);
  // Let the Angular shell load; ignore if the network never fully idles.
  await page.waitForLoadState('networkidle').catch(() => {});

  // Switch to "Login with Password" mode. The portal defaults to HINDI, where
  // this toggle reads "पासवर्ड से लॉगिन करें" — match either language.
  //
  // Wait explicitly rather than relying on the global 15s actionTimeout: the
  // login shell is Angular-rendered and, on a loaded staging, has taken longer
  // than that to paint. When it did, EVERY authenticated spec in the run failed
  // here — 19 of 21 in one CourseTOC run — with a click timeout that looked
  // like a broken selector rather than a slow page.
  const modeToggle = page.getByText(/login with password|पासवर्ड\s*से\s*लॉगिन/i).first();
  // Wait up to 60s for it to appear.
  await modeToggle.waitFor({ state: 'visible', timeout: LOGIN_SHELL_TIMEOUT });
  // Click it, with the same generous timeout.
  await modeToggle.click({ timeout: LOGIN_SHELL_TIMEOUT });
  // Let the password field appear.
  await page.waitForTimeout(400);

  // Identifier field is the first real text/email/tel input (not the radio).
  // The OTP/Password radio is the page's first <input>, which is why the type filter matters.
  const idInput = page
    .locator('input[type="text"], input[type="email"], input[type="tel"], input:not([type])')
    .first();
  // Type the email or phone.
  await idInput.fill(identifier);

  // The password box.
  const pwdInput = page.locator('input[type="password"]').first();
  // Make sure it's rendered before typing into it.
  await pwdInput.waitFor({ state: 'visible', timeout: 5_000 });
  // Type the password.
  await pwdInput.fill(password);

  // "Login" button — Hindi renders it as "लॉगिन".
  // Anchored (^…$) so it can't match a longer label like "Login with OTP".
  const loginBtn = page.getByRole('button', { name: /^(log\s*in|लॉगिन|लॉग\s*इन\s*करें)$/i }).first();
  // It must be enabled — a disabled button means the form didn't accept our input.
  await expect(loginBtn).toBeEnabled();
  // Scroll to it; ignore failures.
  await loginBtn.scrollIntoViewIfNeeded().catch(() => {});
  // Submit.
  await loginBtn.click();

  // Authenticated landing is /page/home; the T&C gate is /app/new-tnc.
  // Wait for either. Swallowing the error lets acceptTermsIfPresent run regardless.
  await page.waitForURL(/\/(app|page)\//, { timeout: 20_000 }).catch(() => {});
  // Clear the terms gate if this account hasn't accepted them yet.
  await acceptTermsIfPresent(page);
  // Settle before handing control back to the caller.
  await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * Log in with email/phone + OTP via the public login page.
 * The OTP is fetched automatically ONLY for @yopmail.com addresses (the test
 * accounts). For a real email/phone we can't read the code, so it throws with a
 * clear message. Bilingual (EN/HI) selectors throughout.
 */
export async function loginWithOtp(page: Page, context: BrowserContext, identifier: string): Promise<void> {
  // Open the login page.
  await page.goto(`${BASE_URL}/public/login`);
  // Let it load.
  await page.waitForLoadState('networkidle').catch(() => {});

  // Ensure "Login with OTP" mode (it's the default, but be explicit).
  // Prefer the radio's id — the most precise handle available.
  const otpRadio = page.locator('#useOTPRB');
  // If that id exists, tick it. `force` because Material hides the real input.
  if (await otpRadio.count()) await otpRadio.check({ force: true }).catch(() => {});
  // Otherwise fall back to clicking the label, in either language.
  else await page.getByText(/login with otp|by otp|OTP\s*से\s*लॉगिन/i).first().click().catch(() => {});
  // Let the mode switch settle.
  await page.waitForTimeout(400);

  // Identifier field (email/phone).
  // Prefer the field's id; fall back to "the first input that isn't a radio, password or hidden field".
  await page.locator('#emailOrMobile')
    .or(page.locator('input:not([type="radio"]):not([type="password"]):not([type="hidden"])'))
    .first().fill(identifier);

  // Request the OTP. Hindi: "ओटीपी प्राप्त करें".
  await page.getByRole('button', { name: /get\s*otp|send\s*otp|ओटीपी\s*प्राप्त|^login$|^लॉगिन$/i })
    .first().click();
  // Give the mail a few seconds to be sent before we start polling the inbox.
  await page.waitForTimeout(3000);

  // We can only read a code from a yopmail inbox. Fail loudly and early for anything else,
  // rather than polling a mailbox we'll never be able to open.
  if (!/@yopmail\.com$/i.test(identifier)) {
    throw new Error(
      `OTP auto-fetch only works for @yopmail.com test accounts (got "${identifier}"). ` +
        `Use a yopmail account or enter the OTP manually.`,
    );
  }

  // Open yopmail in a second tab and poll until the code arrives.
  const otp = await getOtpFromYopmail(context, identifier);

  // The LOGIN OTP field is a single #totp input (not the signup #code boxes).
  // Three fallbacks: the id, the form field name, then the placeholder in either language.
  const otpField = page.locator('#totp')
    .or(page.locator('input[name="OTPcode"]'))
    .or(page.getByPlaceholder(/enter\s*otp|ओटीपी\s*दर्ज/i)).first();
  // Wait for whichever one exists.
  await otpField.waitFor({ state: 'visible', timeout: 15_000 });
  // Type the code.
  await otpField.fill(otp);
  // Let validation run.
  await page.waitForTimeout(400);

  // Submit it — again matching every label this button uses across both languages.
  await page.getByRole('button', { name: /^submit$|verify|^login$|^सबमिट$|^जमा\s*करें$|सत्यापित/i })
    .first().click();

  // Authenticated landing is /page/home; the T&C gate is /app/new-tnc.
  await page.waitForURL(/\/(app|page)\//, { timeout: 20_000 }).catch(() => {});
  // Clear the terms gate if it appears.
  await acceptTermsIfPresent(page);
  // Settle before returning.
  await page.waitForLoadState('networkidle').catch(() => {});
}
