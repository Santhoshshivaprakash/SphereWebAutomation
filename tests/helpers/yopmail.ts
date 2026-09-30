// The Page type, used to annotate the browser tab this helper drives.
import { Page } from '@playwright/test';
// File system + paths — used by recordCreatedEmail() to append to the account ledger.
import * as fs from 'fs';
import * as path from 'path';

/**
 * The prefix that marks which ENVIRONMENT an account was created on.
 *
 * Accounts made on STAGING are named "stage-…" so they are identifiable at a
 * glance in yopmail, in created-users.txt and in the portal's own user list —
 * the same convention the e-kshamata suite uses. Production keeps the plain
 * name, so nothing that already exists there is renamed.
 *
 * Sphere staging is portal-staging.aastrika.org. e-kshamata is a DIFFERENT
 * portal (ekshamata-staging.aastrika.org) with its own suite, so its host is
 * deliberately not matched here.
 *
 * Override with SPHERE_USER_PREFIX=<word>, or SPHERE_USER_PREFIX=none to switch
 * the prefix off entirely.
 */
export function envPrefix(): string {
  const explicit = (process.env.SPHERE_USER_PREFIX || '').trim();
  if (explicit) return /^none$/i.test(explicit) ? '' : `${explicit.toLowerCase()}-`;
  try {
    const host = new URL(process.env.BASE_URL || '').hostname;
    return /^portal-staging\.aastrika\.org$/i.test(host) ? 'stage-' : '';
  } catch {
    return '';
  }
}

/**
 * The longest email LOCAL PART (the bit before the "@") the portal will accept.
 *
 * Measured against portal-staging's own signup endpoint, not guessed:
 * /apis/public/v8/signupWithAutoLoginV2/register answers 200 at 19 characters
 * and 500 "Sorry ! User not created. Please try again in sometime." at 20 — and
 * it fails the same way whatever the characters are, so this is a length limit,
 * not a rule about hyphens or particular words.
 *
 * "testautomation" + 5 digits is exactly 19, i.e. already at the ceiling, so any
 * prefix at all pushes a signup over it. The failure is quiet in the UI: the
 * wizard simply resets to a blank form, which looks like a button that was never
 * clicked rather than a rejected registration.
 */
const MAX_LOCAL_PART = 19;

/**
 * A throwaway signup address, tagged with the environment it was made on and
 * kept inside MAX_LOCAL_PART.
 *
 * The BASE is what gets shortened to make room for the tag, so production keeps
 * the exact addresses it always had ("testautomation48213@yopmail.com") while
 * staging becomes "stage-testauto48213@yopmail.com".
 */
export function testEmailLocalPart(base = 'testautomation', suffix?: string | number): string {
  const tail = String(suffix ?? Math.floor(10000 + Math.random() * 90000));
  const prefix = envPrefix();
  const room = MAX_LOCAL_PART - prefix.length - tail.length;
  if (room < 1) {
    throw new Error(
      `email prefix "${prefix}" leaves no room for a name within ${MAX_LOCAL_PART} characters `
      + '— shorten it, or set SPHERE_USER_PREFIX=none',
    );
  }
  return `${prefix}${base.slice(0, room)}${tail}`;
}

/** The full address. @see testEmailLocalPart */
export function generateTestEmail(base = 'testautomation', suffix?: string | number): string {
  return `${testEmailLocalPart(base, suffix)}@yopmail.com`;
}

// Builds a random throwaway yopmail address, e.g. "spherek3f9x2@yopmail.com".
export function generateRandomYopmail(prefix = 'sphere'): string {
  prefix = `${envPrefix()}${prefix}`;
  // toString(36) renders a random number in base 36 (0-9 + a-z); substring(2, 8) takes 6 of those chars,
  // skipping the leading "0." that Math.random().toString() always produces.
  const randomString = Math.random().toString(36).substring(2, 8);
  // Glue the prefix and the random part into a full address.
  return `${prefix}${randomString}@yopmail.com`;
}

// Reads an OTP out of a yopmail inbox by driving the real yopmail website in a browser tab.
export async function fetchOtpFromYopmail(
  page: Page,
  emailAddress: string,
  retries = 10,
  delay = 3000,
): Promise<string> {
  // The inbox name is the part before the "@".
  const username = emailAddress.split('@')[0];

  // Open yopmail.
  await page.goto('https://yopmail.com/');
  // Wait for it to finish loading.
  await page.waitForLoadState('networkidle');

  // Type the inbox name into the Login box.
  await page.getByRole('textbox', { name: 'Login' }).fill(username);
  // Click the button that opens that inbox — matched by its tooltip text.
  await page.getByTitle('Check Inbox @yopmail.com').click();
  // Wait for the inbox to load.
  await page.waitForLoadState('networkidle');

  // Poll the inbox until the mail arrives or we run out of attempts.
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Show progress.
    console.log(`Yopmail OTP attempt ${attempt}/${retries}...`);

    // Guard each attempt so one failure doesn't abort the loop.
    try {
      // On every attempt after the first, wait and refresh.
      if (attempt > 1) {
        // Give the mail time to arrive.
        await page.waitForTimeout(delay);
        // Find yopmail's refresh button.
        const refreshBtn = page.locator('#refresh');
        // Click it if it's there.
        if (await refreshBtn.isVisible()) await refreshBtn.click();
        // Wait for the refreshed inbox.
        await page.waitForLoadState('networkidle');
      }

      // yopmail renders the open message inside an iframe named "ifmail".
      const mailFrame = page.frameLocator('iframe[name="ifmail"]');
      // Read the visible text of that iframe's body.
      const emailBody = await mailFrame.locator('body').innerText({ timeout: 5000 });

      // Look for a standalone 6-digit run. \b are word boundaries, so "1234567" won't match.
      const otpMatch = emailBody.match(/\b\d{6}\b/);
      // Found it — log and return.
      if (otpMatch) {
        console.log('OTP found:', otpMatch[0]);
        return otpMatch[0];
      }

      // No digits yet. Throwing here jumps to the catch below, which decides whether to retry.
      throw new Error('OTP not found in email body');
    } catch {
      // Only give up once we've used every attempt; otherwise fall through and loop again.
      if (attempt === retries) throw new Error('OTP not received after all retries');
    }
  }

  // Safety net — unreachable in practice, but TypeScript needs every path to return or throw.
  throw new Error('OTP fetch failed');
}

// ══════════════════════════════════════════════════════════════════════
// CREATED-ACCOUNT LEDGER
// ══════════════════════════════════════════════════════════════════════
/**
 * Append a signup address to generated-emails.txt at the project root — the one
 * list of every account the suite has created.
 *
 * Line format: `<ISO time>\t<environment>\t<spec>\t<email>`. The email stays the
 * LAST column because scripts/login-check.mjs reads each line's last word, so
 * the older two-column lines (`<ISO time>\t<email>`) still parse.
 *
 * Call it when an address is about to be SUBMITTED for signup (not for throwaway
 * form-fill checks), so the account is recorded even if the run crashes later.
 * Never throws: a logging problem must not fail a signup that worked.
 */
export function recordCreatedEmail(email: string, source: string): void {
  try {
    const host = new URL(process.env.BASE_URL ?? 'https://sphere.aastrika.org').hostname;
    const env = /portal-staging/i.test(host) ? 'staging' : /^sphere\./i.test(host) ? 'production' : host;
    const file = path.resolve(__dirname, '..', '..', 'generated-emails.txt');
    fs.appendFileSync(file, `${new Date().toISOString()}\t${env}\t${source}\t${email}\n`, 'utf-8');
  } catch { /* ignore */ }
}
