/**
 * Yopmail OTP Fetcher
 * ──────────────────────────────────────────────────────────────────
 * Fetches the latest email from a yopmail inbox using yopmail's
 * internal endpoints (no scraping, no browser needed).
 *
 * Yopmail flow under the hood:
 *   1. GET https://yopmail.com/?d=&login=<inbox>          → sets cookies & inbox state
 *   2. GET https://yopmail.com/inbox?login=<inbox>&p=1&d=&ctrl=&scrl=&spam=true&yp=<yp>&yj=<yj>&v=...
 *                                                        → returns HTML mail list with message IDs
 *   3. GET https://yopmail.com/mail?b=<inbox>&id=<msgId> → returns the mail body HTML
 *
 * The `yp` and `yj` tokens are anti-bot tokens. They are obtained from
 * the homepage HTML on the first request.
 *
 * Requires Node 18+ (has built-in fetch) or `npm install node-fetch`.
 */

// `request` creates a standalone HTTP client; the other two are types we annotate with.
// Despite the .spec.ts name this file declares no tests — it's a library of exported helpers.
import { request, APIRequestContext, BrowserContext } from '@playwright/test';

// Every URL below is relative to this origin.
const YOPMAIL_BASE = 'https://yopmail.com';

// Shape of the anti-bot tokens we scrape off the homepage.
interface YopmailTokens {
  yp: string;   // anti-bot token 1
  yj: string;   // anti-bot token 2
  v: string;    // yopmail's webmail version, e.g. "8.5"
}

/**
 * Parse the anti-bot tokens (yp, yj, v) from yopmail's homepage HTML.
 */
function parseTokens(html: string): YopmailTokens {
  // Tokens are embedded in inline scripts on the homepage.
  // Example: <script src="/ver/8.5/webmail.js"></script>
  //          window.yp = "..."; window.yj = "..."
  // Try the inline-script form first, then the hidden-form-field form, then give up with ''.
  const yp = html.match(/yp\s*[:=]\s*['"]([^'"]+)['"]/i)?.[1]
           ?? html.match(/name=["']yp["']\s*value=["']([^"']+)["']/i)?.[1]
           ?? '';
  // Same two-shape lookup for the second token.
  const yj = html.match(/yj\s*[:=]\s*['"]([^'"]+)['"]/i)?.[1]
           ?? html.match(/name=["']yj["']\s*value=["']([^"']+)["']/i)?.[1]
           ?? '';
  // The version comes from the script path "/ver/8.5/". Fall back to 8.5 if it isn't there.
  const v  = html.match(/\/ver\/(\d+\.\d+)\//)?.[1] ?? '8.5';

  // Hand all three back together.
  return { yp, yj, v };
}

/**
 * Extract message IDs from the inbox HTML.
 * Yopmail inbox HTML contains divs like:
 *   <div class="m" id="m_..." onclick="webmail.doshowmail('e_xxxxxx','...')">
 * The message ID is the value passed to doshowmail().
 */
function parseMessageIds(inboxHtml: string): string[] {
  // Collect the ids here.
  const ids: string[] = [];
  // The `g` flag makes this regex walk ALL matches, not just the first.
  const re = /doshowmail\(['"]([^'"]+)['"]/g;
  // Holds each match as we loop.
  let m;
  // exec() with a /g regex returns matches one at a time, then null when exhausted.
  while ((m = re.exec(inboxHtml)) !== null) {
    // m[1] is the captured id inside the quotes.
    ids.push(m[1]);
  }
  // Newest message first — that's the order yopmail renders them in.
  return ids;
}

/**
 * Strip HTML tags from a string to get plain text content.
 */
function stripHtml(html: string): string {
  return html
    // Drop <style> blocks entirely — CSS text would otherwise pollute the output.
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    // Same for <script> blocks.
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    // Now remove every remaining tag, leaving only the text between them.
    .replace(/<[^>]+>/g, ' ')
    // Turn non-breaking spaces into ordinary ones.
    .replace(/&nbsp;/g, ' ')
    // Decode escaped ampersands.
    .replace(/&amp;/g, '&')
    // Collapse all runs of whitespace into a single space.
    .replace(/\s+/g, ' ')
    // Trim the ends.
    .trim();
}

/**
 * Extract the OTP digits from the email body text.
 * Tuned for: "OTP for Aastrika Sphere Platform is 672759. This is valid for 10 minutes only."
 * The phrase-anchored patterns avoid grabbing the "10" from "10 minutes".
 */
function extractOtp(text: string): string | null {
  // Ordered most-specific to least — the first match wins, so precision beats recall here.
  const patterns = [
    // Best case: the exact sentence Sphere sends.
    /OTP for Aastrika Sphere Platform is\s+(\d{4,8})/i,
    // Looser: the word "OTP" followed by digits.
    /OTP[^0-9]+(\d{4,8})/i,
    // Loosest: any "is <digits>" phrase.
    /\bis\s+(\d{4,8})\b/i,
  ];
  // Try each pattern in order.
  for (const re of patterns) {
    // Does this one match?
    const m = text.match(re);
    // Yes — return the captured digits immediately.
    if (m) return m[1];
  }
  // None matched. Returning null lets the caller retry rather than fail on a half-loaded mail.
  return null;
}

/**
 * Main entry point: fetch OTP for the given email from yopmail.
 *
 * @param email     Full yopmail address, e.g. "testautomation_12345@yopmail.com"
 * @param options   Optional retry/delay config
 * @returns         The OTP code as a string (e.g. "672759")
 * @throws          Error if OTP isn't found after all retries
 */
export async function fetchOtpFromYopmail(
  email: string,
  options: { retries?: number; delayMs?: number; apiContext?: APIRequestContext } = {},
): Promise<string> {
  // Pull the tuning knobs out of options, with defaults.
  const { retries = 10, delayMs = 3000 } = options;
  // The inbox name is the part before the "@".
  const inbox = email.split('@')[0];

  // Announce what we're doing.
  console.log(`📧 [yopmail] Fetching OTP for: ${email}`);

  // Use an isolated APIRequestContext so cookies persist between calls
  // Reuse the caller's client if they passed one; otherwise build our own.
  const apiContext = options.apiContext ?? await request.newContext({
    // Everything below is relative to yopmail.com.
    baseURL: YOPMAIL_BASE,
    extraHTTPHeaders: {
      // Pose as a real Chrome — yopmail serves different HTML to obvious bots.
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      // Ask for HTML, like a browser would.
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      // And an English locale.
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });

  // `try/finally` guarantees we dispose our own client even if a step throws.
  try {
    // Step 1: Hit homepage to acquire cookies + anti-bot tokens
    console.log(`   🌐 GET ${YOPMAIL_BASE}/en/`);
    // Load the homepage — this also sets the session cookies the later calls need.
    const homeResp = await apiContext.get('/en/', { timeout: 15_000 });
    // Bail early if yopmail is down or blocking us.
    if (!homeResp.ok()) {
      throw new Error(`Homepage returned ${homeResp.status()}`);
    }
    // Read the HTML.
    const homeHtml = await homeResp.text();
    // Scrape the anti-bot tokens out of it.
    const tokens = parseTokens(homeHtml);
    // Log ✓/✗ per token rather than the values themselves — enough to debug, without leaking them.
    console.log(`   🔑 Tokens — yp: ${tokens.yp ? '✓' : '✗'}, yj: ${tokens.yj ? '✓' : '✗'}, v: ${tokens.v}`);

    // Step 2: Initialise inbox session
    console.log(`   🌐 GET /?d=&login=${inbox}`);
    // Tell yopmail which inbox we want. encodeURIComponent escapes anything unsafe in the name.
    await apiContext.get(`/?d=&login=${encodeURIComponent(inbox)}`, { timeout: 15_000 });

    // Step 3: Poll the inbox for OTP email
    // Loop until we find the mail or run out of attempts.
    for (let attempt = 1; attempt <= retries; attempt++) {
      // Show progress.
      console.log(`   🔄 Attempt ${attempt}/${retries} — checking inbox`);

      // Wait before every attempt except the first — the mail needs time to arrive.
      if (attempt > 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }

      // Fetch inbox listing
      // Build the inbox URL with the anti-bot tokens attached. spam=true so nothing is hidden.
      const inboxUrl = `/inbox?login=${encodeURIComponent(inbox)}&p=1&d=&ctrl=&scrl=&spam=true` +
                       `&yp=${encodeURIComponent(tokens.yp)}&yj=${encodeURIComponent(tokens.yj)}` +
                       `&v=${tokens.v}`;
      // Request it.
      const inboxResp = await apiContext.get(inboxUrl, { timeout: 15_000 });

      // A non-2xx usually means a rate limit — log it and try again rather than aborting.
      if (!inboxResp.ok()) {
        console.log(`   ⚠️  Inbox fetch returned ${inboxResp.status()}`);
        continue;
      }

      // Read the inbox HTML.
      const inboxHtml = await inboxResp.text();
      // Pull out the message ids.
      const messageIds = parseMessageIds(inboxHtml);

      // Nothing has arrived yet — go round again.
      if (messageIds.length === 0) {
        console.log(`   📭 Inbox empty`);
        continue;
      }

      // Report what we found.
      console.log(`   📬 Found ${messageIds.length} message(s); reading latest`);
      // Index 0 is the newest message.
      const latestId = messageIds[0];

      // Step 4: Fetch the mail body
      // Build the URL for that one message.
      const mailUrl = `/mail?b=${encodeURIComponent(inbox)}&id=${encodeURIComponent(latestId)}`;
      // Request it.
      const mailResp = await apiContext.get(mailUrl, { timeout: 15_000 });

      // Again, a bad status is a retry rather than a failure.
      if (!mailResp.ok()) {
        console.log(`   ⚠️  Mail fetch returned ${mailResp.status()}`);
        continue;
      }

      // Read the mail's HTML.
      const mailHtml = await mailResp.text();
      // Reduce it to plain text.
      const mailText = stripHtml(mailHtml);
      // Log the first 200 characters — enough to see what arrived if the pattern misses.
      console.log(`   📝 Mail preview: "${mailText.slice(0, 200)}"`);

      // Try to pull the code out.
      const otp = extractOtp(mailText);
      // Found it — log and return, ending the loop.
      if (otp) {
        console.log(`   ✅ OTP extracted: ${otp}`);
        return otp;
      }

      // A mail arrived but it wasn't the OTP (or hadn't finished rendering) — retry.
      console.log(`   ⏳ Mail found but no OTP pattern matched — retrying`);
    }

    // Loop exhausted without success.
    throw new Error(`No OTP found for ${email} after ${retries} attempts`);
  } finally {
    // Dispose the context we created (don't dispose the caller's context)
    // Only clean up what we own — disposing the caller's client would break their later calls.
    if (!options.apiContext) {
      await apiContext.dispose();
    }
  }
}

/**
 * Convenience wrapper that takes a BrowserContext and uses its
 * built-in `request` for the API calls. Use this from Playwright tests:
 *
 *   const otp = await fetchOtpFromYopmailViaContext(context, email);
 */
export async function fetchOtpFromYopmailViaContext(
  context: BrowserContext,
  email: string,
  options: { retries?: number; delayMs?: number } = {},
): Promise<string> {
  // Reuse the browser's own HTTP client so cookies are shared with the live session.
  // The spread keeps the caller's retries/delay and just adds apiContext.
  return fetchOtpFromYopmail(email, { ...options, apiContext: context.request });
}
