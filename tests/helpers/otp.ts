/**
 * Robust OTP retrieval from yopmail — one shared implementation.
 *
 * Replaces the ~6 duplicated `fetchOtpFromYopmail` copies scattered across the
 * signup specs. Hardened against the failures seen in the full-suite report
 * ("Could not fetch OTP … after 6 attempts"):
 *   - fresh navigation to the inbox each attempt (dodges stale iframes),
 *   - more attempts + backoff with jitter (mail can take a while to arrive),
 *   - detects yopmail's captcha/rate-limit wall and backs off with a clear log,
 *   - Aastrika-specific patterns first, generic digit fallback last.
 *
 * yopmail rate-limits heavy same-IP usage, so under a big signup run some misses
 * are still possible — the thrown error says exactly that.
 */
// The context we open a tab in, and the Frame type for yopmail's two iframes.
import { BrowserContext, Frame } from '@playwright/test';

// yopmail's English homepage.
const YOPMAIL = 'https://yopmail.com/en/';
// Promise-based sleep, so we can `await` a pause.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Adds 0–1.5s of randomness to a delay, so parallel runs don't hit yopmail in lockstep.
const jitter = (base: number) => base + Math.floor(Math.random() * 1500);

// Ordered most-specific to least. The first match wins, so precision beats recall.
const OTP_PATTERNS = [
  /OTP for Aastrika Sphere Platform is\s+(\d{4,8})/i, // exact Aastrika message
  /OTP[^0-9]{0,20}(\d{4,8})/i,                         // "OTP ... <digits>"
  /\bis\s+(\d{4,8})\b/i,                               // "... is <digits>"
  /\b(\d{6})\b/,                                       // last resort: any 6 digits
];

// Pull the code out of a mail body, or return null if nothing looks like one.
function extractOtp(text: string): string | null {
  // Empty body — nothing to search.
  if (!text) return null;
  // Try each pattern in order of specificity.
  for (const re of OTP_PATTERNS) {
    // Does this one match?
    const m = text.match(re);
    // Yes — return the captured digits.
    if (m) return m[1];
  }
  // None matched. Null lets the caller retry rather than fail on a half-loaded mail.
  return null;
}

// The tuning knobs a caller may override.
export interface OtpOptions {
  /** How many polling attempts (default 12 ≈ 60–90s with backoff). */
  attempts?: number;
  /** Base delay between attempts in ms (default 5000; jittered). */
  intervalMs?: number;
}

/** Open a fresh yopmail tab, poll the inbox, and return the OTP code. */
export async function getOtpFromYopmail(
  context: BrowserContext,
  email: string,
  opts: OtpOptions = {},
): Promise<string> {
  // How many times to poll. `??` means "use the default only if not supplied".
  const attempts = opts.attempts ?? 12;
  // Base wait between polls.
  const intervalMs = opts.intervalMs ?? 5000;
  // The inbox name is the part before the "@".
  const localPart = email.split('@')[0];
  // Announce what we're doing.
  console.log(`📧 Fetching OTP for: ${email}`);

  // Open a separate tab so we don't disturb the caller's page.
  const page = await context.newPage();
  // `try/finally` guarantees the tab is closed however this ends.
  try {
    // Poll until the mail arrives or we run out of attempts.
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Guard each attempt so one error doesn't abort the whole loop.
      try {
        // Navigate straight to the inbox each attempt — a full reload is more
        // reliable than the in-page refresh button and avoids stale frames.
        await page.goto(`${YOPMAIL}?login=${encodeURIComponent(localPart)}`, { waitUntil: 'domcontentloaded' });
        // Let the iframes mount.
        await page.waitForTimeout(1200);

        // Cookie banner (first load only; harmless otherwise).
        // Match any of three button labels.
        const cookieBtn = page
          .locator('button:has-text("Accept"), button:has-text("OK"), button:has-text("I agree")')
          .first();
        // Only look for 800ms — it's optional, so don't spend real time on it.
        if (await cookieBtn.isVisible({ timeout: 800 }).catch(() => false)) {
          // Dismiss it; ignore failures.
          await cookieBtn.click().catch(() => {});
        }

        // Captcha / rate-limit wall → clear log + longer back-off.
        // Look for a reCAPTCHA iframe or widget.
        const captcha = await page
          .locator('iframe[src*="recaptcha"], .g-recaptcha')
          .first()
          .isVisible({ timeout: 600 })
          .catch(() => false);
        // If yopmail has thrown up a captcha, no amount of retrying at this pace will help.
        if (captcha) {
          // Say so explicitly — this is the single most common cause of OTP failures.
          console.log(`   ⚠️  yopmail captcha wall (attempt ${attempt}/${attempts}) — rate-limited, backing off`);
          // Wait DOUBLE the normal interval before trying again.
          await sleep(jitter(intervalMs * 2));
          // Skip the rest of this attempt.
          continue;
        }

        // Open the newest message in the inbox list frame.
        // `page.frame()` returns null if that frame isn't present yet.
        const inboxFrame: Frame | null = page.frame({ name: 'ifinbox' }) ?? null;
        // Only proceed if the inbox frame exists.
        if (inboxFrame) {
          // The message rows, matched by any of three shapes yopmail uses.
          const firstMail = inboxFrame.locator('button.lm, div.m, .mail').first();
          // Is there a message to open?
          if (await firstMail.isVisible({ timeout: 2000 }).catch(() => false)) {
            // Click the newest one.
            await firstMail.click().catch(() => {});
            // Let the body frame render.
            await page.waitForTimeout(1200);
          }
        }

        // Read the open message body.
        // The mail body lives in a second iframe.
        const mailFrame: Frame | null = page.frame({ name: 'ifmail' }) ?? null;
        // Only proceed if it's there.
        if (mailFrame) {
          // Read its text, falling back to an empty string on any error.
          const body = (await mailFrame.locator('body').textContent().catch(() => '')) ?? '';
          // Try to pull a code out.
          const otp = extractOtp(body);
          // Found it — log and return, ending the loop and closing the tab via `finally`.
          if (otp) {
            console.log(`   ✅ OTP: ${otp} (attempt ${attempt}/${attempts})`);
            return otp;
          }
        }
        // Nothing usable yet — report and fall through to the wait below.
        console.log(`   🔄 Attempt ${attempt}/${attempts} — OTP not yet available`);
      } catch (e) {
        // Log just the first line of the error, so one stack trace doesn't flood the run output.
        console.log(`   ⚠️  Attempt ${attempt}/${attempts} error: ${(e as Error).message.split('\n')[0]}`);
      }
      // Wait before the next attempt — but not after the last one, which would waste time.
      if (attempt < attempts) await sleep(jitter(intervalMs));
    }
  } finally {
    // Always close the scraper tab.
    await page.close().catch(() => {});
  }

  // Every attempt failed. The message names the most likely cause and what to do about it,
  // rather than just saying "not found".
  throw new Error(
    `Could not fetch OTP for ${email} from yopmail after ${attempts} attempts ` +
      `(likely yopmail rate-limiting/captcha under heavy same-IP signup — space out signups or use an API mailbox)`,
  );
}
