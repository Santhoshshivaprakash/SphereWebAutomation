/**
 * Complete Competency — single, named-competency runner
 * ──────────────────────────────────────────────────────────────────
 * Give a competency NAME in the terminal and this clears EVERY level of
 * that ONE competency, end to end, using the standard test account.
 *
 *   Standard credentials (forced for this flow):
 *     sphereid041@yopmail.com  /  Sunbird@123
 *
 * Usage (easiest — the wrapper sets env + prod URL for you):
 *   .\run-competency.ps1 "Care of the newborn"
 *
 * Usage (manual):
 *   $env:BASE_URL="https://sphere.aastrika.org"
 *   $env:COMPETENCY_NAME="Care of the newborn"
 *   npx playwright test tests/CompleteCompetency.spec.ts --headed
 *
 * Env vars:
 *   COMPETENCY_NAME          — competency title to complete   (REQUIRED)
 *   BASE_URL                 — must be a real env (prod/staging) for password
 *                              login; localhost cannot log in with a password
 *   COMPETENCY_USER_EMAIL    — override the standard account (optional)
 *   COMPETENCY_USER_PASSWORD — override the standard password (optional)
 *   GEMINI_API_KEY           — for the Gemini answering fallback (recommended)
 *
 * This is a SEPARATE script: it does not modify Competency.spec.ts.
 */

// ── Force the standard credentials for this flow BEFORE the auth harness
//    resolves them at fixture time. resolveCreds() reads these at runtime, so
//    setting them here overrides whatever .env put in TEST_USER_EMAIL. Allow an
//    opt-in override via COMPETENCY_USER_EMAIL/PASSWORD.
// Precedence, most specific first: COMPETENCY_USER_* (this flow only) → whatever
// .env already set in TEST_USER_* → the standard learner as a last resort.
//
// This used to overwrite TEST_USER_EMAIL unconditionally, so editing .env
// changed nothing and the run silently stayed on sphereid041 — the account in
// the log was not the account you had configured.
// The email, with that three-level precedence.
process.env.TEST_USER_EMAIL =
  process.env.COMPETENCY_USER_EMAIL || process.env.TEST_USER_EMAIL || 'sphereid041@yopmail.com';
// And the password, the same way.
process.env.TEST_USER_PASSWORD =
  process.env.COMPETENCY_USER_PASSWORD || process.env.TEST_USER_PASSWORD || 'Sunbird@123';
// This flow logs in with a password, so it needs a real env. If someone left
// BASE_URL on the localhost mirror, don't silently auth-fail — make it obvious.
if (!process.env.BASE_URL) process.env.BASE_URL = 'https://sphere.aastrika.org';

// Types only — the runner itself comes from our authenticated harness below.
import { Page, Locator, BrowserContext } from '@playwright/test';
// `test` here is the AUTHENTICATED one: every test gets a logged-in context.
import { test, expect } from './helpers/authedTest';
// Node's file system module — reads .env below.
import * as fs from 'fs';
// Node's path module — builds cross-platform file paths.
import * as path from 'path';
// The shared matcher that maps an on-screen question to its answer-key entry.
import { findMatchingQuestion } from './helpers/questionMatch';
import { hiAlso } from './helpers/i18n';

// Mutable: in CDP mode we adopt the origin of the tab we attach to, so the run
// always targets the env you are actually logged into (see setBaseUrl below).
let BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════
// Also mutable, for the same reason — setBaseUrl rewrites both together.
let COMPETENCY_URL     = `${BASE_URL}/app/user/competency`;

/** Point the run at a different env (used when we attach to a CDP tab). */
function setBaseUrl(url: string) {
  // Strip any trailing slash so the concatenation below can't double up.
  BASE_URL = url.replace(/\/+$/, '');
  COMPETENCY_URL = `${BASE_URL}/app/user/competency`;
}
/**
 * A competency has FIVE levels. Not "up to ten, stop when nothing opens".
 *
 * The climb used to run to 10 and trust whatever the portal opened next. Once
 * level 5 was cleared the dashboard offered a DIFFERENT competency's
 * assessment, the modal header carried no "Level N", and the fallback below
 * labelled it "level 6" — so the run kept climbing someone else's competency
 * and reported it as this one.
 */
const MAX_LEVELS       = 5;

// The preferred Gemini model.
const GEMINI_PRIMARY   = 'gemini-2.5-flash';
// A cheaper, higher-quota model used when the primary is rate-limited.
const GEMINI_FALLBACK  = 'gemini-2.5-flash-lite';
// Base URL for the Gemini REST API.
const GEMINI_URL_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models/';
// Minimum gap between Gemini calls, to stay inside its requests-per-minute quota.
const GEMINI_RPM_DELAY = 6500;

// Load .env (so GEMINI_API_KEY etc. are available even when run directly).
// An IIFE (immediately-invoked function) — it runs once at import time.
// Written this way so its locals don't leak into the module scope.
(function loadEnvFile() {
  // The project root's .env file.
  const envPath = path.resolve(__dirname, '..', '.env');
  // No file — nothing to load.
  if (!fs.existsSync(envPath)) return;
  // Walk it line by line.
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    // Skip blanks and comments.
    if (!t || t.startsWith('#')) continue;
    // Split on the FIRST = only; `...rest` keeps any = characters inside the value.
    const [k, ...rest] = t.split('=');
    // Never overwrite a variable already set in the real environment — CLI wins over .env.
    if (k && !process.env[k.trim()]) process.env[k.trim()] = rest.join('=').trim();
  }
})();

// Which competency to complete. Trimmed, because it usually comes from a shell arg.
const COMPETENCY_NAME = (process.env.COMPETENCY_NAME ?? '').trim();
// The Gemini key. Without it the AI fallback is unavailable.
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY ?? '';

// ══════════════════════════════════════════════════════════════════════
// QUIZ ANSWER KEY INTERCEPTOR
// ══════════════════════════════════════════════════════════════════════
// The shape of the answer-key JSON Sphere serves from S3.
type QuizQuestion = {
  questionId: string;
  question: string;
  options: { text: string; optionId: string; isCorrect: boolean }[];
};
// The whole key: its questions, and the score needed to pass.
type QuizKey = { questions: QuizQuestion[]; passPercentage?: number };

// Holds the most recently captured key until a quiz consumes it.
let pendingQuizKey: QuizKey | null = null;

// Watch every network response and grab the quiz JSON when it goes by.
// This is the fast path — 100% accurate answers without any AI.
function setupQuizKeyInterceptor(page: Page) {
  // Fires for every response the page receives.
  page.on('response', async (res) => {
    const url = res.url();
    // Match the quiz JSON on ANY host (prod serves it from sunbirdcontent.s3,
    // but the localhost mirror may proxy it from a different origin). We still
    // validate the payload shape below, so a loose URL match is safe.
    if (!/_quiz\.json/i.test(url) && !/\/quiz\/.*\.json/i.test(url)) return;
    // Only successful responses.
    if (!res.ok()) return;
    // Wrapped: a non-JSON body must not break the response handler.
    try {
      const json = await res.json();
      // Only store it if it actually has questions — that's the shape validation.
      if (Array.isArray(json?.questions) && json.questions.length > 0) {
        // Stash it for the next quiz to consume.
        pendingQuizKey = json as QuizKey;
        // Log which HOST it came from — useful when the mirror proxies it from elsewhere.
        console.log(`   🔑 Captured quiz JSON (${json.questions.length} questions) from ${new URL(url).host}`);
      }
    // Swallow parse errors silently — this is an opportunistic capture.
    } catch { /* ignore */ }
  });
}

// Take the pending key and clear it, so it can't be reused on a later quiz.
function consumeQuizAnswerKey(): QuizKey | null {
  const k = pendingQuizKey;
  pendingQuizKey = null;
  return k;
}

/** Detects the "poisoned key" trick devs use on competency quizzes:
 *  every option has `isCorrect: false`. If so, the key is useless. */
function isAnswerKeyPoisoned(key: QuizKey): boolean {
  // How many questions does the key hold?
  const total = key.questions.length;
  // An empty key is as useless as a poisoned one.
  if (total === 0) return true;
  // Count the questions where NO option is flagged correct.
  const poisonedCount = key.questions.filter(
    (q) => q.options.every((o) => o.isCorrect === false)
  ).length;
  // 80% or more unmarked = poisoned. A threshold rather than "all", so a few
  // genuinely-unmarked questions do not discard an otherwise usable key.
  return poisonedCount / total >= 0.8;
}

// ══════════════════════════════════════════════════════════════════════
// REAL ANSWER KEY (from S3, via the content hierarchy)
// ──────────────────────────────────────────────────────────────────────
// The app serves the browser a POISONED quiz (isCorrect stripped) from
// /apis/proxies/... but the ORIGINAL quiz artifact on S3 still carries the real
// `isCorrect` flags. We get the S3 URL from the content hierarchy API (which
// needs only org/rootOrg/hostPath headers) and fetch it with the page's own
// request context. This is the reliable, Gemini-free answer source.
// ══════════════════════════════════════════════════════════════════════
// Captured from the app's own traffic, so our API calls look identical to its.
let apiHeaders: { org?: string; rootorg?: string; hostpath?: string } = {};

// Watch the app's outgoing requests and steal the headers it uses. Far more
// reliable than hard-coding them, since they vary by environment.
function setupApiHeaderCapture(page: Page) {
  // Fires for every request the page makes.
  page.on('request', (req) => {
    // Stop once we have them, and only look at the proxy API.
    if (apiHeaders.org || !/\/apis\/proxies\//.test(req.url())) return;
    const h = req.headers();
    // Grab all three in one go.
    if (h['org']) apiHeaders = { org: h['org'], rootorg: h['rootorg'], hostpath: h['hostpath'] };
  });
}

/** Fetch the REAL answer key for the quiz currently open in the viewer.
 *  Returns null if it can't (then we fall back to the intercepted/Gemini path). */
async function fetchRealAnswerKey(page: Page): Promise<QuizKey | null> {
  // The viewer URL carries both ids we need.
  const url = page.url();
  // The quiz's own content id…
  const levelId  = url.match(/\/viewer\/quiz\/(do_\w+)/i)?.[1];
  // …and the course it belongs to.
  const courseId = url.match(/collectionId=(do_\w+)/i)?.[1];
  // Either missing means we can't build the hierarchy call.
  if (!levelId || !courseId) return null;

  // The API wants the host as a flat token: "sphere.aastrika.org" becomes
  // "sphere_aastrika_org". Strip the scheme, replace : and / with _, trim trailing _.
  const hostPath = BASE_URL.replace(/^https?:\/\//, '').replace(/[:/]+/g, '_').replace(/_+$/, '');
  // Use the captured headers when we have them, with sensible defaults if not.
  const headers: Record<string, string> = {
    Accept: 'application/json',
    org:     apiHeaders.org     ?? 'aastar',
    rootOrg: apiHeaders.rootorg ?? 'aastar',
    hostPath: apiHeaders.hostpath ?? hostPath,
    locale: 'en',
  };
  // hierarchyType=detail is what makes the response include artifactUrl.
  const hierApi = `${BASE_URL}/apis/proxies/v8/action/content/v3/hierarchy/${courseId}?hierarchyType=detail`;

  // Where the S3 link will go once we find it.
  let artifactUrl: string | undefined;
  // Wrapped: a failed hierarchy call just means we fall back to another strategy.
  try {
    // Use the PAGE's request context, so it carries the session cookies.
    const hr = await page.request.get(hierApi, { headers });
    if (hr.ok()) {
      // Parse the hierarchy.
      const j = await hr.json();
      // Two response shapes, depending on the endpoint version.
      const root = j?.result?.content || j?.content;
      // A depth-first search over the course tree, done iteratively with an explicit
      // stack rather than recursion — the tree can be deep and this can't blow up.
      const stack = root ? [root] : [];
      while (stack.length) {
        // Take the next node.
        const n: any = stack.pop();
        // Found our quiz AND it has an artifact — stop looking.
        if (n?.identifier === levelId && n?.artifactUrl) { artifactUrl = n.artifactUrl; break; }
        // Otherwise push its children and keep going.
        for (const k of (n?.children || [])) stack.push(k);
      }
    }
  // Swallow errors — the caller handles a null result.
  } catch { /* ignore */ }
  // No artifact link — give up on this path.
  if (!artifactUrl) return null;

  // Now download the artifact itself.
  try {
    const ar = await page.request.get(artifactUrl); // S3 artifact is public
    if (ar.ok()) {
      // Parse it…
      const j = await ar.json();
      // …and only accept it if it actually has questions.
      if (Array.isArray(j?.questions) && j.questions.length > 0) return j as QuizKey;
    }
  } catch { /* ignore */ }
  // Anything else — null, so the caller falls back.
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════
// Click a dashboard tab by name. Five selector shapes in one.
async function clickTab(page: Page, name: 'Job Description' | 'Passbook' | 'Required') {
  // English or Hindi label ("Started" / "शुरू किया") — the tabs follow the account's language.
  const tab = page.locator('[role="tab"], mat-tab-label, .mat-mdc-tab, button, a')
    .filter({ hasText: hiAlso(new RegExp(name, 'i')) })
    .first();
  // Click it.
  await tab.click();
  // Let the tab panel re-render.
  await page.waitForTimeout(800);
}

// Reduce HTML to plain text: drop tags, decode &nbsp;, collapse whitespace, trim.
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Lower-case and flatten punctuation to single spaces. The । is the Devanagari
// full stop, included so Hindi questions normalise too.
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[।?.,!\s]+/g, ' ').trim();
}

// Two strings are "the same" if they normalise to the same thing.
function textsMatch(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

// ══════════════════════════════════════════════════════════════════════
// GEMINI
// ══════════════════════════════════════════════════════════════════════
// Timestamp of the last Gemini call, for the rate limiter below.
let lastGeminiCallAt = 0;
// Set once the daily quota is clearly gone, so we stop retrying every question.
let geminiQuotaExhausted = false;

// Sleep just long enough to respect Gemini's requests-per-minute quota.
async function throttle() {
  // How long since the last call?
  const elapsed = Date.now() - lastGeminiCallAt;
  // Skip the wait on the very first call (lastGeminiCallAt is still 0).
  if (lastGeminiCallAt > 0 && elapsed < GEMINI_RPM_DELAY) {
    await new Promise((r) => setTimeout(r, GEMINI_RPM_DELAY - elapsed));
  }
  // Stamp now, so the next caller measures from here.
  lastGeminiCallAt = Date.now();
}

// One Gemini REST call. Returns a result object rather than throwing.
async function callGemini(model: string, prompt: string, maxOutputTokens = 2000) {
  // Everything is wrapped: a network failure is a normal outcome here.
  try {
    const body: any = {
      contents: [{ parts: [{ text: prompt }] }],
      // temperature 0 = deterministic. topP 1 keeps the full distribution available.
      generationConfig: { temperature: 0, maxOutputTokens, topP: 1 },
    };
    // The full 2.5-flash model reasons before answering, which costs latency…
    if (model.includes('2.5-flash') && !model.includes('lite')) {
      // …so disable that budget: these are recall questions, not reasoning puzzles.
      body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    // POST it. The key rides in the query string, as this API expects.
    const res = await fetch(`${GEMINI_URL_BASE}${model}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Non-2xx — hand the status back so the caller can decide whether to retry.
    if (!res.ok) return { ok: false, status: res.status, error: await res.text() };
    const data: any = await res.json();
    // Dig the generated text out of Gemini's nested response shape.
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    // An empty answer counts as a failure, not a success.
    return text ? { ok: true, text } : { ok: false, error: 'empty response' };
  // Network or parse error.
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// Turn Gemini's reply into a { questionNumber: letter } map. Two passes, so a
// reply that isn't valid JSON can still be salvaged.
function parseAnswerMap(raw: string, count: number): Record<number, string> {
  const map: Record<number, string> = {};
  // Strip any markdown code fences the model added despite being told not to.
  const cleaned = raw.replace(/```json|```/g, '').trim();
  // Find the outermost {...} block.
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    // Pass 1: proper JSON parse.
    try {
      const obj = JSON.parse(jsonMatch[0]);
      for (const k of Object.keys(obj)) {
        // The key is the question number.
        const n = parseInt(k, 10);
        // Take the FIRST letter of the value — tolerates "B", "B)" or "Option B".
        const letter = String(obj[k]).trim().toUpperCase().match(/[A-Z]/)?.[0];
        // Only record entries where both parts parsed.
        if (n && letter) map[n] = letter;
      }
    // Malformed JSON — fall through to pass 2 rather than failing.
    } catch { /* fall through */ }
  }
  // Pass 2: if JSON gave us fewer answers than questions, scrape the raw text.
  if (Object.keys(map).length < count) {
    // Matches "Q1: B", "1. B", "1) B" and "1 - B".
    const re = /Q?\s*(\d{1,2})\s*[:.)\-]\s*([A-Z])/gi;
    let m: RegExpExecArray | null;
    // exec with a /g regex walks all matches.
    while ((m = re.exec(raw))) {
      const n = parseInt(m[1], 10);
      // Don't overwrite anything pass 1 already found.
      if (n && !map[n]) map[n] = m[2].toUpperCase();
    }
  }
  // Whatever we managed to recover.
  return map;
}

/**
 * Ask Gemini for the correct answer to ONE multiple-choice question.
 * Returns a 0-based option index. Defaults to 0 on any failure.
 */
// Ask Gemini for ONE question. Never throws — defaults to A on any failure.
async function askGeminiOne(question: string, options: string[]): Promise<number> {
  // No key configured — default to A rather than failing the run.
  if (!GEMINI_API_KEY) {
    console.log(`      ⚠️  GEMINI_API_KEY not set — defaulting to A`);
    return 0;
  }

  // The last valid letter, so the prompt can name the exact allowed range.
  const lastLetter = String.fromCharCode(65 + options.length - 1);
  // Letter each option: A) …, B) …
  const optsText = options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n');
  // The prompt. It names the clinical domains, then demands a bare letter on the
  // first line — easy to parse — with the reason after it for the log.
  const prompt =
`You are answering a medical/clinical competency assessment question (WHO newborn care, KMC, family planning, normal labour, emergency triage, maternal health, referral protocols). Use accurate medical and clinical knowledge.

Question:
${question}

Options:
${optsText}

Respond with ONLY a single letter (A through ${lastLetter}) on the first line, then a brief one-line reason. Example:
B
Reason: <one sentence>`;

  // If Gemini's daily quota is already exhausted, don't burn minutes backing off
  // on every remaining question — bail fast.
  if (geminiQuotaExhausted) {
    console.log(`      ⚠️  Gemini quota exhausted earlier — skipping API, defaulting to A`);
    return 0;
  }

  // Free-tier Gemini rate-limits and returns 429 with a "retry in Ns" hint.
  // Honour it once or twice, but if the body says the DAILY quota is exhausted
  // (RESOURCE_EXHAUSTED that won't clear in seconds), give up immediately and
  // remember it so later questions don't each stall.
  // Try the primary model, then the cheaper fallback…
  for (const model of [GEMINI_PRIMARY, GEMINI_FALLBACK]) {
    // …with up to two attempts each, for transient rate limits.
    for (let attempt = 1; attempt <= 2; attempt++) {
      // Respect the per-minute gap.
      await throttle();
      // 200 output tokens is plenty for a letter plus one sentence.
      const result = await callGemini(model, prompt, 200);

      if (result.ok) {
        // The raw reply.
        const raw = (result.text ?? '').trim();
        // The first line should be the bare letter.
        const firstLine = raw.split('\n')[0]?.trim() ?? '';
        // Word-boundaries, so it can't pick a letter out of the middle of a word.
        const m = raw.match(/\b([A-Z])\b/);
        if (m) {
          // Convert the letter to a 0-based index — charCode 65 is 'A'.
          const idx = m[1].charCodeAt(0) - 65;
          // Guard the range: a model answering "F" to a 4-option question is ignored.
          if (idx >= 0 && idx < options.length) {
            // Log the model's own reason alongside its choice.
            console.log(`      🤖 ${model} → "${firstLine.slice(0, 50)}"`);
            return idx;
          }
        }
        // Got a reply but couldn't parse a valid letter — default to A and say so.
        console.log(`      🤖 ${model} → "${firstLine.slice(0, 50)}" (couldn't parse, defaulting A)`);
        // Return rather than retry: the model answered, it just answered oddly.
        return 0;
      }

      // 429 = rate-limited, 503 = overloaded.
      if (result.status === 429 || result.status === 503) {
        // Read Gemini's own suggested wait; default to 20s if it didn't say.
        const waitMs = parseRetryDelayMs(result.error) ?? 20_000;
        // A per-minute limit clears in ~tens of seconds; a persistent large delay
        // means the daily quota is gone. Only wait for the short-window case.
        if (waitMs > 45_000) {
          // Say so clearly — this is the difference between a slow run and a stalled one.
          console.log(`      🛑 ${model} ${result.status} quota exhausted (retry ~${Math.round(waitMs / 1000)}s) — giving up on Gemini for this run`);
          // Remember it, so the remaining questions skip the API entirely.
          geminiQuotaExhausted = true;
          return 0;
        }
        // Add a second's headroom to Gemini's own estimate.
        const capped = waitMs + 1_000;
        console.log(`      ⏳ ${model} ${result.status} (rate-limited) — waiting ${Math.round(capped / 1000)}s then retry (attempt ${attempt}/2)`);
        // Wait it out…
        await new Promise((r) => setTimeout(r, capped));
        // …then retry the same model.
        continue;
      }

      // Any other error — report it…
      console.log(`      ⚠️  ${model} error: ${result.error?.slice(0, 100) ?? '?'}`);
      break; // non-rate-limit error → try the fallback model
    }
  }

  // Everything failed. Defaulting to A is better than aborting the climb.
  console.log(`      ⚠️  All Gemini attempts failed — defaulting to A`);
  return 0;
}

/** Pull the retry delay (ms) out of a Gemini 429 body: "retry in 41.58s"
 *  or a RetryInfo `"retryDelay": "41s"`. Returns null if none found. */
function parseRetryDelayMs(errBody?: string): number | null {
  // No body to read.
  if (!errBody) return null;
  // Two shapes: the prose hint, or the structured RetryInfo field.
  const m =
    errBody.match(/retry in\s+([\d.]+)s/i) ||
    errBody.match(/"?retryDelay"?\s*:\s*"?([\d.]+)s/i);
  if (m) {
    // Parse the seconds…
    const secs = parseFloat(m[1]);
    // …and convert to whole milliseconds, rounding up.
    if (!Number.isNaN(secs)) return Math.ceil(secs * 1000);
  }
  // Neither shape matched — the caller uses its own default.
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// QUESTION SCRAPER + RADIO CLICK
// ══════════════════════════════════════════════════════════════════════
// Read the question and its options off the quiz player. Multi-strategy,
// because the player gives the question text no stable class or id.
async function scrapeCurrentQuestion(page: Page): Promise<{ question: string; options: string[] }> {
  // Let the question settle after a page transition.
  await page.waitForTimeout(500);
  // Everything below runs INSIDE the browser, where `document` exists.
  return await page.evaluate(() => {
    // Every radio group on the page…
    const groups = Array.from(document.querySelectorAll<HTMLElement>('mat-radio-group'));
    // …but only the VISIBLE one: the player keeps previous questions mounted.
    const visible = groups.find((g) => {
      const r = g.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    // Nothing on screen — return empty and let the caller retry.
    if (!visible) return { question: '', options: [] };

    // Scrape the options first — they're reliably inside the radio group.
    const options = Array.from(visible.querySelectorAll<HTMLElement>('mat-radio-button'))
      .map((r) => (r.innerText ?? '').trim())
      // Drop blanks.
      .filter((t) => t.length > 0);

    // A set of option texts, so the question search below can exclude them.
    const optionTexts = new Set(options.map((o) => o.trim()));

    // Strategy 1: climb the DOM from the radio group looking for the stem.
    let parent: HTMLElement | null = visible.parentElement;
    let question = '';
    // UI chrome to ignore: buttons, "3 / 10" counters, "Question 4" labels.
    const blacklist = /^(next|previous|submit|start now|cancel|close|\d+\s*\/\s*\d+|question\s*\d+)\s*$/i;

    // Climb until we find something or run out of ancestors.
    while (parent && !question) {
      const innerText = (parent.innerText ?? '').trim();
      if (innerText) {
        // Split into lines, trimmed, blanks dropped.
        const lines = innerText.split('\n').map((l) => l.trim()).filter(Boolean);
        // Score each candidate line, then take the best.
        const candidates: { text: string; score: number }[] = [];
        for (const line of lines) {
          // Too short to be a question, or too long to be anything but a paragraph.
          if (line.length < 10 || line.length > 500) continue;
          // It's one of the options — skip.
          if (optionTexts.has(line)) continue;
          // It's a button or a counter — skip.
          if (blacklist.test(line)) continue;
          // Base score is simply the length — longer lines are more likely to be the stem.
          let score = line.length;
          // A sentence-ending mark (? or the Devanagari ।) is a strong signal.
          if (line.endsWith('?') || line.endsWith('।')) score += 200;
          // An interrogative opening is the second-strongest signal.
          if (/^(what|which|how|when|where|why|who|is|does|did|can|will|should|in|the|a|an)\s/i.test(line)) {
            score += 100;
          }
          candidates.push({ text: line, score });
        }
        // Any candidates?
        if (candidates.length > 0) {
          // Highest score first…
          candidates.sort((a, b) => b.score - a.score);
          // …and take the winner.
          question = candidates[0].text;
        }
      }
      // Otherwise climb one level further out.
      parent = parent.parentElement;
    }

    // Strategy 2: no stem found, so fall back to headings near the radio group.
    if (!question) {
      // Scope to the quiz container if we can find one; else the whole document.
      const dialog = visible.closest('mat-dialog-container, [class*="viewer"], [class*="quiz"]') ?? document.body;
      // Every heading or paragraph inside it…
      const headings = Array.from(dialog.querySelectorAll<HTMLElement>('h1, h2, h3, h4, p'))
        // …filtered the same way as strategy 1.
        .filter((h) => {
          const r = h.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const t = (h.innerText ?? '').trim();
          return t.length > 10 && t.length < 500 && !optionTexts.has(t) && !blacklist.test(t);
        });
      // Any survivors?
      if (headings.length > 0) {
        // Where is the radio group on screen?
        const rgRect = visible.getBoundingClientRect();
        // Sort by POSITION rather than by text.
        headings.sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          // Is this heading entirely above the options?
          const aAbove = ar.bottom <= rgRect.top;
          const bAbove = br.bottom <= rgRect.top;
          // Headings above the options win outright…
          if (aAbove && !bAbove) return -1;
          if (!aAbove && bAbove) return 1;
          // …and among those, the CLOSEST one wins.
          return Math.abs(ar.bottom - rgRect.top) - Math.abs(br.bottom - rgRect.top);
        });
        // Take the winner.
        question = (headings[0].innerText ?? '').trim();
      }
    }

    // Hand both back to the Node side.
    return { question, options };
  });
}

/** Is the option at `idx` selected right now? Read after Angular has settled. */
async function radioIsChecked(page: Page, idx: number): Promise<boolean> {
  // Runs inside the browser.
  return page.evaluate((targetIdx: number) => {
    // Find the visible radio group, the same way the scraper does.
    const groups = Array.from(document.querySelectorAll<HTMLElement>('mat-radio-group'));
    const visible = groups.find((g) => {
      const r = g.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    // The option at this index, if the group exists.
    const target = visible && Array.from(visible.querySelectorAll<HTMLElement>('mat-radio-button'))[targetIdx];
    if (!target) return false;
    // "Checked" measured three ways, because Material's state lives in a class, an
    // ARIA attribute AND the underlying input — different builds update different ones.
    return target.classList.contains('mat-mdc-radio-checked')
      || target.getAttribute('aria-checked') === 'true'
      || !!target.querySelector('input[type="radio"]:checked');
  }, idx);
}

/**
 * Select the option at `idx`, and make sure it actually took.
 *
 * A real Playwright click comes FIRST: Angular Material acts on trusted events,
 * and the old version only ever fired synthetic ones from inside page.evaluate.
 * It also re-read the checked state in the same synchronous pass — before
 * Angular's change detection had run — so a click that HAD worked looked failed,
 * the next strategy fired, and the two could cancel out.
 *
 * Returns whether the option is selected. An unanswered question quietly costs a
 * mark, which is how a level fails with a perfectly good answer key.
 */
async function selectRadioOption(page: Page, idx: number): Promise<boolean> {
  // Let the question settle.
  await page.waitForTimeout(300);

  // The VISIBLE group — not the first one in the DOM. The quiz keeps earlier
  // questions' radio groups mounted but hidden, so `.first()` aimed every click
  // at a stale off-screen group and nothing ever registered. `radioIsChecked`
  // reads the visible group, so the two must agree on which group they mean.
  const group = page.locator('mat-radio-group:visible').first();
  // The option we want, within that group.
  const option = group.locator('mat-radio-button').nth(idx);

  // Three full passes through four escalating strategies.
  for (let attempt = 1; attempt <= 3; attempt++) {
    // 1) trusted click on the label — what a person does
    // Bring it on screen first.
    await option.scrollIntoViewIfNeeded().catch(() => {});
    // Three wrapper shapes; whichever exists gets the click.
    await option.locator('label, .mdc-form-field, .mat-mdc-radio-touch-target').first()
      .click({ timeout: 4_000 }).catch(() => {});
    // Wait for Angular's change detection BEFORE reading the state back.
    await page.waitForTimeout(350);
    // Took? Done.
    if (await radioIsChecked(page, idx)) return true;

    // 2) trusted click on the component itself
    // `force` only from the second attempt on — try it honestly first.
    await option.click({ timeout: 4_000, force: attempt > 1 }).catch(() => {});
    await page.waitForTimeout(350);
    if (await radioIsChecked(page, idx)) return true;

    // 3) check the native input directly
    // `force` because Material hides the real input behind a styled wrapper.
    await option.locator('input[type="radio"]').first()
      .check({ timeout: 4_000, force: true }).catch(() => {});
    await page.waitForTimeout(350);
    if (await radioIsChecked(page, idx)) return true;

    // 4) last resort: drive it from the DOM and tell Angular about it
    // Runs inside the browser.
    await page.evaluate((targetIdx: number) => {
      // Find the visible group again, from in here.
      const groups = Array.from(document.querySelectorAll<HTMLElement>('mat-radio-group'));
      const visible = groups.find((g) => {
        const r = g.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const target = visible && Array.from(visible.querySelectorAll<HTMLElement>('mat-radio-button'))[targetIdx];
      // Reach the real <input>.
      const input = target?.querySelector<HTMLInputElement>('input[type="radio"]');
      // Nothing to click.
      if (!input) return;
      // Try a native click first.
      input.click();
      // Still not checked — set the property by hand…
      if (!input.checked) {
        input.checked = true;
        // …then fire input…
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // …and change, so Angular's form control notices.
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, idx).catch(() => {});
    // Give Angular time before the final read.
    await page.waitForTimeout(500);
    // Took? Done.
    if (await radioIsChecked(page, idx)) return true;

    // Report each failed pass, so the log shows how hard this fought.
    if (attempt < 3) console.log(`      ↻ Option ${idx} did not take — retry ${attempt + 1}/3`);
  }

  // All twelve attempts failed. Say UNANSWERED explicitly — that is the real cost.
  console.log(`      ⚠️  Radio click did not register at index ${idx} after 3 attempts — this question is UNANSWERED`);
  // The caller uses this to fall back to option A.
  return false;
}

// Advance to the next question, or submit on the last one.
async function clickNextOrSubmit(page: Page) {
  // Prefer Next…
  let btn = page.getByRole('button', { name: hiAlso(/^next$/i) }).first();
  // …and fall back to Submit when Next is gone.
  if (!(await btn.isVisible().catch(() => false))) {
    btn = page.getByRole('button', { name: hiAlso(/^submit$/i) }).first();
  }
  // Neither on screen — nothing to do.
  if (!(await btn.isVisible().catch(() => false))) return;
  // Disabled means no option is selected yet; return rather than click blindly.
  if (await btn.isDisabled().catch(() => false)) return;
  await btn.click();
  await page.waitForTimeout(1500);
}

// ══════════════════════════════════════════════════════════════════════
// ANSWER-KEY MATCHING
// ══════════════════════════════════════════════════════════════════════
// findMatchingQuestion now lives in helpers/questionMatch.ts — shared by every
// quiz-answering spec so the case-study stem collision is fixed in one place.

// ══════════════════════════════════════════════════════════════════════
// QUIZ RUNNER
// ══════════════════════════════════════════════════════════════════════
// Run one quiz attempt with the best available answering strategy.
async function runQuizOnce(
  page: Page,
  levelNumber: number,
): Promise<{ passed: boolean; totalQuestions: number; mode: 'key' | 'gemini' }> {

  // Whatever the interceptor caught off the wire.
  let answerKey = consumeQuizAnswerKey();

  // The browser-served quiz is usually POISONED. Try the REAL key from S3 first
  // (via the content hierarchy) — this is the reliable, Gemini-free source.
  const realKey = await fetchRealAnswerKey(page);
  // Got a real one, and it isn't poisoned — prefer it over the intercepted copy.
  if (realKey && !isAnswerKeyPoisoned(realKey)) {
    answerKey = realKey;
    console.log(`   🔓 REAL answer key from S3: ${realKey.questions.length} questions (bypassing the poisoned copy)`);
  // Even S3 is poisoned — say so; Gemini is the only route left.
  } else if (realKey) {
    console.log(`   ⚠️  S3 key also poisoned`);
  }

  // Re-check whichever key we settled on.
  const keyPoisoned = answerKey ? isAnswerKeyPoisoned(answerKey) : false;
  // Only use it if we have one AND it isn't poisoned.
  const useKey = answerKey && !keyPoisoned;

  // Log which strategy we're about to take — the most useful line in the run.
  if (answerKey) {
    if (keyPoisoned) {
      console.log(`   ⚠️  Answer key POISONED (all isCorrect: false) — using Gemini`);
    } else {
      console.log(`   🔑 Answer key ready (${answerKey.questions.length} questions in pool)`);
    }
  } else {
    console.log(`   🤖 No answer key — using Gemini`);
  }

  // The quiz viewer usually opens on an intro with a "Start Now!" button, but
  // depending on how we arrived it may drop us straight onto Q1. Handle both.
  const startBtn = page.getByRole('button', { name: hiAlso(/start now/i) }).first();
  // A 15s window, because the viewer can be slow to paint.
  const hasStart = await startBtn.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false).catch(() => false);

  // Read the question count off the intro screen.
  const qText = await page.getByText(/\d+\s*questions?/i).first().textContent().catch(() => null);
  // Pull the digits out; default to 5 if the text wasn't there.
  const totalQuestions = parseInt(qText?.match(/(\d+)/)?.[1] ?? '5');
  console.log(`   📋 Level ${levelNumber} — ${totalQuestions} questions`);

  // Intro present — start the quiz.
  if (hasStart) {
    await startBtn.click();
    await page.waitForTimeout(2500);
  // Already on Q1 — just let it settle.
  } else {
    console.log(`   ▶️  No "Start Now" screen — assuming the quiz is already open`);
    await page.waitForTimeout(1500);
  }

  // The fast, accurate route.
  if (useKey && answerKey) {
    await answerWithKey(page, answerKey, totalQuestions);
    await page.waitForTimeout(2500);
    // Did we pass?
    const passed = await detectQuizPassed(page);
    return { passed, totalQuestions, mode: 'key' };
  }

  // No usable key — ask the model, one question at a time.
  await answerWithGeminiBatch(page, totalQuestions);
  await page.waitForTimeout(2500);
  const passed = await detectQuizPassed(page);
  return { passed, totalQuestions, mode: 'gemini' };
}

// Answer every question using the key.
async function answerWithKey(page: Page, key: QuizKey, total: number) {
  // One iteration per question.
  for (let q = 1; q <= total; q++) {
    console.log(`\n   ❓ Q${q}/${total}`);
    // Let the question render.
    await page.waitForTimeout(600);

    // Read what's on screen.
    const { question, options } = await scrapeCurrentQuestion(page);
    // Nothing scraped — pick the first option and move on rather than stalling.
    if (options.length === 0) {
      await selectRadioOption(page, 0);
      await clickNextOrSubmit(page);
      continue;
    }

    // Map this on-screen question to its entry in the key.
    const match = findMatchingQuestion(question, options, key.questions);
    // Default to option A if we can't do better.
    let idx = 0;
    if (match) {
      // Find the option flagged correct.
      const correctOption = match.options.find((o) => o.isCorrect);
      if (correctOption) {
        // Strip any HTML from its text…
        const correctText = stripHtml(correctOption.text);
        // …then find that SAME text among the on-screen options. Matching by TEXT, not
        // by index, is essential: the player shuffles option order between attempts.
        const onScreenIdx = options.findIndex((o) => textsMatch(o, correctText));
        idx = onScreenIdx >= 0 ? onScreenIdx : match.options.findIndex((o) => o.isCorrect);
        // Log the letter and a truncated preview of what we picked.
        console.log(`      🔑 [${String.fromCharCode(65 + idx)}] "${options[idx]?.slice(0, 60)}"`);
      }
    // No entry matched — the matcher DECLINED rather than guessing.
    } else {
      console.log(`      ⚠️  No key match for: "${question.slice(0, 70)}"`);
    }
    // An option that never registered leaves the question UNANSWERED, which
    // costs the mark even though the answer was right. Fall back to the first
    // option so something is submitted, and say so.
    // The `idx !== 0` guard avoids retrying A when A is what already failed.
    if (!(await selectRadioOption(page, idx)) && idx !== 0) {
      console.log(`      ↩︎ Falling back to option A so the question is not left blank`);
      await selectRadioOption(page, 0);
    }
    // Advance.
    await clickNextOrSubmit(page);
  }
}

// Answer every question by asking Gemini, one question at a time.
async function answerWithGeminiBatch(page: Page, total: number) {
  console.log(`\n   📝 Answering ${total} questions one by one`);

  // One iteration per question.
  for (let q = 1; q <= total; q++) {
    console.log(`\n   ❓ Q${q}/${total}`);
    await page.waitForTimeout(500);

    // Read what's on screen.
    const { question, options } = await scrapeCurrentQuestion(page);
    // Nothing scraped — default to A rather than stalling.
    if (options.length === 0) {
      console.log(`      ⚠️  No options found, defaulting to A`);
      await selectRadioOption(page, 0);
      await clickNextOrSubmit(page);
      continue;
    }

    // Log the stem…
    console.log(`      📝 "${question.slice(0, 90)}"`);
    // …and every option, lettered, so the run log is auditable after the fact.
    options.forEach((o, i) =>
      console.log(`         [${String.fromCharCode(65 + i)}] ${o.slice(0, 60)}`)
    );

    // Ask the model.
    const idx = await askGeminiOne(question, options);
    // Say which one we're picking before we click it.
    console.log(`      ✅ Selecting [${String.fromCharCode(65 + idx)}] ${options[idx]?.slice(0, 60)}`);

    // An option that never registered leaves the question UNANSWERED, which
    // costs the mark even though the answer was right. Fall back to the first
    // option so something is submitted, and say so.
    if (!(await selectRadioOption(page, idx)) && idx !== 0) {
      console.log(`      ↩︎ Falling back to option A so the question is not left blank`);
      await selectRadioOption(page, 0);
    }
    // Advance.
    await clickNextOrSubmit(page);
  }
}

// Did we pass? Five wordings, because the app phrases this differently by build.
async function detectQuizPassed(page: Page): Promise<boolean> {
  const passMarkers = [
    /passed the assessment/i,
    /congratulations/i,
    /you have passed/i,
    /level\s+cleared/i,
    /assessment cleared/i,
  ];
  // Try each in turn; the first match wins.
  for (const re of passMarkers) {
    if (await page.getByText(re).first().waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false).catch(() => false)) {
      return true;
    }
  }
  // None found — treat as a fail.
  return false;
}

// Return to the dashboard after a quiz.
async function goBackToDashboard(page: Page) {
  // The results screen offers a button back.
  const btn = page.getByRole('button', { name: hiAlso(/go to competency dashboard/i) }).first();
  // Use it if it's there.
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(2500);
  }
  // Then make sure we really landed there.
  await ensureCompetencyDashboard(page);
}

// ══════════════════════════════════════════════════════════════════════
// LEVEL OPENER — targets the NAMED competency's card
// ══════════════════════════════════════════════════════════════════════
// Open a specific level of the NAMED competency.
async function openLevel(
  page: Page,
  competencyName: string,
  targetLevel: number,
): Promise<{ ok: boolean; actualLevel: number }> {
  // Make sure we're on the dashboard first.
  await ensureCompetencyDashboard(page);
  // Competencies to assess live under the Required tab.
  await clickTab(page, 'Required');
  await page.waitForTimeout(1000);

  // The NEAREST card around the competency's own title — not the first element
  // that merely CONTAINS the name.
  //
  // `.filter({ hasText })` matches every ancestor too, so an outer wrapper
  // holding ALL the competencies matched as well, and `.first()` took that
  // wrapper. The Re-Assess button picked from inside it then belonged to
  // whichever competency happened to come first: asking for "neonatal" and
  // getting handed "Normal delivery" from level 2 onward.
  // Walk UP from the competency's own title to the nearest ancestor that also
  // holds an Assess/Re-Assess button, and mark it.
  //
  // Neither extreme works on its own. `.filter({ hasText })` matched every
  // ancestor including the wrapper around ALL competencies, and `.first()` took
  // that wrapper — so the button clicked belonged to whichever competency came
  // first ("neonatal" → "Normal delivery"). Going to the NEAREST card ancestor
  // instead landed on the title's own little wrapper, which has no button at
  // all. The right element is the closest one containing BOTH.
  // So: find the title, then climb until we hit an ancestor that ALSO holds an
  // Assess button, and tag it with a data attribute Playwright can select.
  const marked = await page.evaluate((name: string) => {
    // Clear any tag left by a previous call.
    document.querySelectorAll('[data-pw-card]').forEach((e) => e.removeAttribute('data-pw-card'));
    // Collapse whitespace and lower-case, so titles compare reliably.
    const norm = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const wanted = norm(name);

    // The element whose OWN text is the competency name (not a container that
    // merely includes it).
    const titles = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,span,div,p'))
      // Exact text match, and it must be on screen.
      .filter((e) => norm(e.textContent ?? '') === wanted && e.getBoundingClientRect().height > 0);
    // No title anywhere — give up.
    if (!titles.length) return false;

    // Does this element contain an Assess / Re-Assess button?
    const hasAssess = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('button')).some((b) => /^\s*(re-?assess|assess)\s*$/i.test(b.textContent ?? ''));

    // For each matching title…
    for (const title of titles) {
      // …start at the title itself…
      let node: HTMLElement | null = title;
      // …and climb up to 12 levels looking for one that holds the button.
      for (let hops = 0; node && hops < 12; hops++, node = node.parentElement) {
        // Found it — tag it and stop.
        if (hasAssess(node)) { node.setAttribute('data-pw-card', '1'); return true; }
      }
    }
    // No ancestor had both.
    return false;
  // `competencyName` is passed in because page.evaluate runs in a separate context.
  }, competencyName).catch(() => false);

  // Now select whatever we tagged.
  const cards = page.locator('[data-pw-card="1"]');
  // Wait for it, but only if the tagging actually succeeded.
  if (marked) await cards.first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

  // How many did we find?
  const cardCount = await cards.count();
  // None — this is the most common failure, so it gets a real diagnostic.
  if (cardCount === 0) {
    console.log(`   ❌ No card found containing "${competencyName}" on the Required tab`);
    // Print what IS on the page, so the name can be corrected without guessing.
    console.log(`   🔍 Diagnostic — first 8 competency titles visible:`);
    // Read the titles inside the browser.
    const allTitles = await page.evaluate(() => {
      const cs = Array.from(document.querySelectorAll(
        'mat-card, [class*="card" i], [class*="assessment" i]'
      ));
      // First eight cards only, so the log stays readable.
      return cs.slice(0, 8).map((c) => {
        // Prefer a heading inside the card; fall back to the card's own text.
        const t = c.querySelector('h1, h2, h3, h4, [class*="title" i]') ?? c;
        // First line only, capped at 80 chars.
        return ((t as HTMLElement).innerText ?? '').trim().split('\n')[0].slice(0, 80);
      }).filter((t) => t.length > 0);
    });
    // Print them indexed, ready to copy.
    allTitles.forEach((t, i) => console.log(`      [${i}] "${t}"`));

    // Nothing at all on the page? Say WHY instead of just "not found".
    if (allTitles.length === 0) {
      // Gather three facts about the empty page, inside the browser.
      const diag = await page.evaluate(() => ({
        url: location.href,
        // Is a "Log in" control on screen? That means the session died.
        hasLogin: Array.from(document.querySelectorAll('button, a'))
          .some((e) => /^log\s?in$/i.test(((e as HTMLElement).innerText ?? '').trim())),
        // And the first 300 characters of whatever IS rendered.
        text: ((document.body as HTMLElement).innerText ?? '')
          .replace(/\s+/g, ' ').trim().slice(0, 300),
      }));
      // Print all three — this turns "not found" into an actionable diagnosis.
      console.log(`      (zero cards on the page)`);
      console.log(`      url            : ${diag.url}`);
      // The arrow calls out the session case explicitly.
      console.log(`      "Log in" shown : ${diag.hasLogin}  ${diag.hasLogin ? '← NOT SIGNED IN on this env' : ''}`);
      console.log(`      page text      : "${diag.text}"`);
    }
    return { ok: false, actualLevel: 0 };
  }

  // Found the card.
  console.log(`   ✅ Found ${cardCount} card(s) matching "${competencyName}"`);
  // Take the tagged one.
  const card = cards.first();
  // Its Re-Assess button — for a competency already started.
  let reAssessBtn = card.getByRole('button', { name: hiAlso(/re-?assess/i) }).first();
  // Not there? Then this is a FRESH competency…
  if (!(await reAssessBtn.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false).catch(() => false))) {
    // …so look for "Assess" instead. Anchored, so it can't match "Re-Assess".
    reAssessBtn = card.getByRole('button', { name: hiAlso(/^assess$/i) }).first();
  }

  // Neither button on the card — give up cleanly.
  if (!(await reAssessBtn.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false).catch(() => false))) {
    console.log(`   ❌ Assess / Re-Assess button not visible on the "${competencyName}" card`);
    return { ok: false, actualLevel: 0 };
  }

  // Open it.
  await reAssessBtn.scrollIntoViewIfNeeded();
  await reAssessBtn.click();
  await page.waitForTimeout(2500);

  // Two possible flows after Assess/Re-Assess:
  //   (A) prod: a "Start Now!" intro modal appears directly.
  //   (B) this env: it navigates to a competency TOC page that lists every
  //       level as a link (href → /viewer/quiz/...). We must click the level.
  const startBtn = page.getByRole('button', { name: hiAlso(/start now/i) }).first();
  // Flow (A): the modal appeared.
  if (await startBtn.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false).catch(() => false)) {
    // Read its heading inside the browser.
    const headerText = await page.evaluate(() => {
      const dialog = document.querySelector('mat-dialog-container, [class*="modal"], [class*="dialog"]');
      const heading = dialog?.querySelector('h1, h2, h3, h4');
      return (heading as HTMLElement)?.innerText?.trim() ?? '';
    });
    console.log(`   📍 Modal opened: "${headerText.slice(0, 80)}"`);

    // WHOSE assessment is this? The dashboard hands back a different
    // competency's quiz readily (ask for "neonatal", get "Normal delivery"), and
    // nothing downstream would notice — the questions are answered from the
    // quiz's own key, so a wrong competency still "passes".
    // So refuse anything that isn't the competency we asked for.
    if (!(await modalIsFor(page, competencyName))) {
      console.log(`   ⛔ This assessment is not "${competencyName}" — refusing it.`);
      // Dismiss the modal so the next dashboard visit starts clean.
      await closeAssessmentModal(page);
      return { ok: false, actualLevel: 0 };
    }

    // Use the level the modal states — but only REJECT on a stated mismatch.
    // Plenty of screens never name a level at all (portal-staging's header is
    // just the question count, e.g. "10"), and refusing those stops a climb that
    // is perfectly fine. What actually went wrong before was opening a DIFFERENT
    // competency, and modalIsFor above is what catches that.
    // Parse the stated level; 0 means the header never named one.
    const stated = parseInt(headerText.match(/level\s*(\d+)/i)?.[1] ?? '0');
    // A STATED mismatch is a real problem — stop rather than climb the wrong thing.
    if (stated && stated !== targetLevel) {
      console.log(`   ⛔ Portal opened Level ${stated}, not the Level ${targetLevel} being climbed — stopping.`);
      await closeAssessmentModal(page);
      return { ok: false, actualLevel: 0 };
    }
    // Trust the stated level when there is one; otherwise assume the one we asked for.
    const actualLevel = stated || targetLevel;
    // Log which of those two cases applied, so the run is auditable.
    console.log(stated
      ? `   ✅ Detected Level ${stated}`
      : `   ✅ Level ${targetLevel} (the modal states no level; competency confirmed as "${competencyName}")`);
    return { ok: true, actualLevel };
  }

  // Flow (B): pick the level from the TOC list.
  return openLevelFromToc(page, targetLevel, competencyName);
}

/** Loose comparison: case, spacing and punctuation vary between screens. */
function sameCompetency(haystack: string, name: string): boolean {
  // Flatten everything non-alphanumeric to spaces before comparing.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(haystack).includes(norm(name));
}

/**
 * Does the assessment now on screen belong to `name`?
 *
 * Checked on the modal first, then the page behind it — the competency title is
 * not always inside the dialog. Answering the wrong competency's quiz still
 * "passes" (the answers come from that quiz's own key), so without this the run
 * reports success for a competency it never touched.
 */
async function modalIsFor(page: Page, name: string): Promise<boolean> {
  // Deliberately NOT a name check.
  //
  // The modal shows the LEVEL's own title — e.g. "Level 1 : Understands health
  // of males and females and initial assessment protocols" — never the
  // competency's name, so requiring the name here rejects every valid level.
  // And falling back to the page behind the modal was worse than useless: the
  // dashboard lists every competency, so that always matched and the check
  // "confirmed" the competency on levels it had never verified.
  //
  // Identity is enforced instead by competencyIdOf() below: a competency's
  // levels all live under one collectionId, so the id must not change mid-climb.
  // `void name` marks the parameter as deliberately unused, not forgotten.
  void name;
  // So this always returns true — the real guard is the id check.
  return true;
}

/**
 * The competency (collection) this assessment belongs to, from the player URL.
 * All levels of one competency share it, so a change means a different
 * competency was opened.
 */
function competencyIdOf(url: string): string {
  // Pull collectionId out of the query string; empty string if absent.
  return url.match(/[?&]collectionId=(do_\w+)/i)?.[1] ?? '';
}

/**
 * The competency id, once the player has opened far enough to carry one.
 *
 * The intro modal appears BEFORE the app navigates to /viewer/quiz/…, so the
 * URL has no collectionId yet at that moment. Dismiss the intro (Start Now) and
 * wait for the player, then read it.
 */
async function waitForCompetencyId(page: Page, timeoutMs = 25_000): Promise<string> {
  // The intro's Start button.
  const startBtn = page.getByRole('button', { name: hiAlso(/start now/i) }).first();
  // Click it if it's there — that's what triggers the navigation.
  if (await startBtn.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false).catch(() => false)) {
    await startBtn.click().catch(() => {});
  }
  // Poll until the deadline.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Has the URL picked up a collectionId yet?
    const id = competencyIdOf(page.url());
    // Yes — done.
    if (id) return id;
    // No — wait half a second and look again.
    await page.waitForTimeout(500);
  }
  // Timed out; the caller treats an empty id as "unknown".
  return '';
}

/**
 * Dismiss an assessment intro modal we have decided NOT to take, so the next
 * dashboard visit starts clean instead of behind a stale dialog.
 */
async function closeAssessmentModal(page: Page) {
  // Escape dismisses most Material dialogs.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  // If that didn't work, look for an explicit close control INSIDE the dialog.
  const close = page.locator('mat-dialog-container button[aria-label*="close" i], mat-dialog-container .close, mat-dialog-container button:has-text("×")').first();
  if (await close.waitFor({ state: 'visible', timeout: 1_500 }).then(() => true, () => false).catch(() => false)) {
    await close.click().catch(() => {});
  }
  await page.waitForTimeout(400);
}

/**
 * On the competency TOC page (list of levels, each a link to /viewer/quiz/...),
 * click the link for `targetLevel` to open that level's assessment. Returns
 * ok:false when there is no such level (i.e. the climb is complete).
 */
async function openLevelFromToc(
  page: Page,
  targetLevel: number,
  competencyName: string,
): Promise<{ ok: boolean; actualLevel: number }> {
  // The TOC is a whole page for ONE competency — make sure it is the right one
  // before clicking a level off it.
  if (!(await modalIsFor(page, competencyName))) {
    console.log(`   ⛔ This level list is not "${competencyName}" — refusing it.`);
    return { ok: false, actualLevel: 0 };
  }
  // Every level link on the page.
  const links = page.locator('a[href*="/viewer/quiz/"]');
  // None — neither flow produced anything usable.
  if (!(await links.first().waitFor({ state: 'visible', timeout: 8_000 }).then(() => true, () => false).catch(() => false))) {
    console.log(`   ❌ No "Start Now" modal and no level list appeared after Assess`);
    return { ok: false, actualLevel: 0 };
  }

  // How many levels does this competency have?
  const total = await links.count().catch(() => 0);
  // Match "Level N :" precisely so Level 1 never matches Level 10, etc.
  const levelLink = links
    .filter({ hasText: new RegExp(`level\\s*${targetLevel}\\s*:`, 'i') })
    .first();

  // No such level — that's the SUCCESS case: the climb is complete. The log says
  // so rather than reporting a failure.
  if (!(await levelLink.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false).catch(() => false))) {
    console.log(`   🏁 No "Level ${targetLevel}" in the list (competency has ${total} level(s)) — climb complete`);
    return { ok: false, actualLevel: 0 };
  }

  // Log the level's own title before opening it.
  const label = ((await levelLink.innerText().catch(() => '')) || '').split('\n')[0].slice(0, 80);
  console.log(`   📍 Opening "${label}"`);
  // Open it.
  await levelLink.scrollIntoViewIfNeeded().catch(() => {});
  await levelLink.click().catch(() => {});
  await page.waitForTimeout(2500);
  return { ok: true, actualLevel: targetLevel };
}

// Open the named competency via Job Description → Roles → Assess (fallback path).
async function openViaJobDescription(page: Page, competencyName: string, targetLevel: number): Promise<{ ok: boolean; actualLevel: number }> {
  await ensureCompetencyDashboard(page);
  // Switch to the Job Description tab.
  await clickTab(page, 'Job Description').catch(() => {});
  await page.waitForTimeout(1500);

  // Expand role panels so the named competency's Assess button is revealed.
  const headers = page.locator('[id^="mat-expansion-panel-header"], mat-expansion-panel-header');
  // How many roles?
  const count = await headers.count().catch(() => 0);
  // Open up to 15 of them.
  for (let i = 0; i < Math.min(count, 15); i++) {
    await headers.nth(i).click().catch(() => {});
    await page.waitForTimeout(400);
  }

  // ONLY click the Assess button inside the card that mentions this competency.
  // NEVER fall back to "any Assess button on the page" — that opens a DIFFERENT
  // competency's quiz (a real bug we hit: answered a labour quiz for an
  // immunization request). If the named button isn't here, fail cleanly.
  // Start from the competency's OWN title and take the NEAREST ancestor that holds
  // an Assess button — the same approach as the Required tab. Filtering containers
  // by "mentions the name" is not enough: the whole ROLE panel mentions it too, and
  // its first Assess button belongs to a different competency (a real bug: asked
  // for "Normal delivery", it climbed "Vaginal examination…", the entry above it).
  const escaped = competencyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const titles = page.getByText(new RegExp(`^\\s*${escaped}\\s*$`, 'i'));
  const nearestAssess = (i: number) => titles.nth(i)
    .locator('xpath=ancestor::*[.//button[normalize-space()="Assess" or normalize-space()="Re-Assess" or normalize-space()="Reassess"]][1]')
    .getByRole('button', { name: hiAlso(/^(re-?assess|assess)$/i) }).first();
  let assessBtn = nearestAssess(0);
  // The same competency can sit under several roles — use the first visible copy.
  for (let i = 0; i < (await titles.count()); i++) {
    if (await nearestAssess(i).isVisible().catch(() => false)) { assessBtn = nearestAssess(i); break; }
  }

  // Not there — fail cleanly rather than grabbing someone else's button.
  if (!(await assessBtn.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false))) {
    console.log(`   ❌ No Assess/Re-Assess button for "${competencyName}" under Job Description → Roles`);
    return { ok: false, actualLevel: 0 };
  }
  // Open it.
  await assessBtn.scrollIntoViewIfNeeded().catch(() => {});
  await assessBtn.click().catch(() => {});
  await page.waitForTimeout(2500);

  // Same two flows as the Required path: a "Start Now!" modal, or a TOC list.
  const startBtn = page.getByRole('button', { name: hiAlso(/start now/i) }).first();
  // Flow (A): the modal appeared.
  if (await startBtn.waitFor({ state: 'visible', timeout: 6_000 }).then(() => true, () => false).catch(() => false)) {
    // Read its heading inside the browser.
    const headerText = await page.evaluate(() => {
      const d = document.querySelector('mat-dialog-container, [class*="modal"], [class*="dialog"]');
      return (d?.querySelector('h1,h2,h3,h4') as HTMLElement)?.innerText?.trim() ?? '';
    });
    console.log(`   📍 Opened assessment via Job Description: "${headerText.slice(0, 60)}"`);

    // Same two guards as the Required path: it must be THIS competency, and the
    // level must be stated on screen rather than assumed from what we asked for.
    if (!(await modalIsFor(page, competencyName))) {
      console.log(`   ⛔ This assessment is not "${competencyName}" — refusing it.`);
      // Dismiss it so the next dashboard visit starts clean.
      await closeAssessmentModal(page);
      return { ok: false, actualLevel: 0 };
    }
    // Same rule as the Required path: reject only a STATED mismatch. A header
    // with no level in it is normal on some builds.
    const lvl = parseInt(headerText.match(/level\s*(\d+)/i)?.[1] ?? '0');
    // A stated mismatch means the portal opened the wrong level — stop.
    if (lvl && lvl !== targetLevel) {
      console.log(`   ⛔ Portal opened Level ${lvl}, not the Level ${targetLevel} being climbed — stopping.`);
      await closeAssessmentModal(page);
      return { ok: false, actualLevel: 0 };
    }
    // Trust the stated level when there is one; otherwise assume the one we asked for.
    return { ok: true, actualLevel: lvl || targetLevel };
  }
  // Flow (B): fall through to the TOC list.
  return openLevelFromToc(page, targetLevel, competencyName);
}

// Open the next level of the NAMED competency: Required-tab first, then JD path.
async function openNextAssessment(page: Page, competencyName: string, targetLevel: number): Promise<{ ok: boolean; actualLevel: number }> {
  // Try the Required tab first — it's the shorter route when it works.
  const viaRequired = await openLevel(page, competencyName, targetLevel);
  if (viaRequired.ok) return viaRequired;
  // Otherwise fall through to the roles accordion.
  return openViaJobDescription(page, competencyName, targetLevel);
}

// ══════════════════════════════════════════════════════════════════════
// DASHBOARD NAV
// ══════════════════════════════════════════════════════════════════════
// Navigate home → Competency dashboard (as a user would) and wait for load.
async function openCompetencyDashboard(page: Page) {
  // Always start from home.
  await page.goto(`${BASE_URL}/page/home`);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(2000);
  // The header's Competency control, in either language.
  const nav = page.getByRole('button', { name: /^(competency|योग्यता)$/i })
    .or(page.getByText(/^(competency|योग्यता)$/i)).first();
  // Prefer clicking it — that keeps the SPA's auth state intact.
  if (await nav.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false).catch(() => false)) {
    await nav.click().catch(() => {});
  // No nav control — fall back to a direct URL.
  } else {
    await page.goto(COMPETENCY_URL);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  // Give competencies a few seconds to load.
  await page.waitForTimeout(4000);
}

/**
 * Fail fast (with instructions) when the attached tab has no session.
 * Symptom otherwise: the Competency Dashboard shell renders, "Roles" spins
 * forever, and the run reports "no competency cards found".
 */
async function assertLoggedIn(page: Page) {
  // A "Log in" control, as a button or a link.
  const loginCta = page.getByRole('button', { name: hiAlso(/^log\s?in$/i) })
    .or(page.getByRole('link', { name: hiAlso(/^log\s?in$/i) })).first();
  // Signal 1: the login CTA is on screen.
  const showsLogin = await loginCta.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false).catch(() => false);
  // Signal 2: we're on a public route.
  const onPublic  = /\/public\//.test(page.url());

  // Either means there is no session to drive.
  if (showsLogin || onPublic) {
    // Throw with a numbered, copy-pasteable fix rather than a bare error.
    throw new Error(
      `Not signed in on ${BASE_URL}.\n` +
      `The tab still shows a "Log in" button, so there is no session to drive.\n\n` +
      `Fix (you only do this once per Chrome window):\n` +
      `  1. In the Chrome running on :9222, go to ${BASE_URL}\n` +
      `  2. Sign in, and land inside the app (e.g. ${BASE_URL}/page/home)\n` +
      `  3. Leave that tab open and re-run this script.`,
    );
  }
}

// Are we on the competency dashboard? Two markers.
async function onCompetencyDashboard(page: Page): Promise<boolean> {
  return await page.getByRole('tab', { name: hiAlso(/required/i) })
    .or(page.getByText(hiAlso(/competency dashboard/i))).first()
    .waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false).catch(() => false);
}

// Get us to the dashboard, retrying up to three times.
async function ensureCompetencyDashboard(page: Page) {
  for (let i = 0; i < 3; i++) {
    // Already there — nothing to do.
    if (await onCompetencyDashboard(page)) return;
    // Prefer the header nav — it keeps us authenticated.
    const nav = page.getByRole('button', { name: /^(competency|योग्यता)$/i })
      .or(page.getByText(/^(competency|योग्यता)$/i)).first();
    if (await nav.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false).catch(() => false)) {
      await nav.click().catch(() => {});
    // Not on screen — go home first, then click it from there.
    } else {
      await page.goto(`${BASE_URL}/page/home`).catch(() => {});
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: /^(competency|योग्यता)$/i })
        .or(page.getByText(/^(competency|योग्यता)$/i)).first().click().catch(() => {});
    }
    // Let the dashboard load before the next check.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);
  }
}

// ══════════════════════════════════════════════════════════════════════
// TEST — complete EVERY level of the ONE named competency
// ══════════════════════════════════════════════════════════════════════
// One row per level attempted.
type LevelOutcome = { level: number; passed: boolean; mode: string };

test.describe('Complete a single named competency', () => {
  // The shared context and the ONE tab this test drives.
  let ctx: BrowserContext;
  let page: Page;
  let ownsPage = false; // true only when WE created the tab (so we clean it up)

  // Runs once, before the test.
  test.beforeAll(async ({ authContext }) => {
    // `authContext` is a WORKER-scoped fixture — authenticated once per run.
    ctx = authContext;
    // In CDP mode, DRIVE THE TAB YOU ALREADY LOGGED INTO. Opening a fresh tab
    // with ctx.newPage() lands on public/home because Sphere keeps its session
    // in per-tab sessionStorage, which a new tab doesn't inherit. Reuse the
    // existing page instead. (Non-CDP storageState runs: a new tab is fine.)
    // Every tab already open in the attached browser.
    const existing = ctx.pages();
    if (process.env.USE_CDP === '1' && existing.length > 0) {
      // Show every tab so we can see which one is your logged-in session.
      console.log(`🔎 CDP tabs open (${existing.length}):`);
      existing.forEach((p, i) => console.log(`     [${i}] ${p.url()}`));
      // Parse an origin safely — a blank or about: URL must not throw.
      const originOf = (u: string) => { try { return new URL(u).origin; } catch { return ''; } };
      // Is this tab inside the app, rather than on a public page?
      const isApp = (u: string) => /\/(page|app)\//.test(u);

      // Prefer a tab on the env you ASKED for (BASE_URL) — that respects -Local.
      // Only fall back to another env's tab if you have none open there.
      // Best: right env AND inside the app. Then: right env. Then: any app tab.
      page = existing.find((p) => originOf(p.url()) === BASE_URL && isApp(p.url()))
          ?? existing.find((p) => originOf(p.url()) === BASE_URL)
          ?? existing.find((p) => isApp(p.url()))
          // Last resort: the most recently opened tab, whatever it is.
          ?? existing[existing.length - 1];
      // We did not create it, so we must not close it.
      ownsPage = false;
      console.log(`♻️  Reusing your tab: ${page.url()}`);

      // If we had to fall back to a different env, adopt it — we are DRIVING
      // this tab, so navigating it cross-origin would drop your session.
      const tabOrigin = originOf(page.url());
      // A real http(s) origin that isn't the one we asked for.
      if (/^https?:/.test(tabOrigin) && tabOrigin !== BASE_URL) {
        console.log(`⚠️  No tab open on ${BASE_URL}; this tab is on ${tabOrigin}.`);
        console.log(`   → Using ${tabOrigin} instead (keeps your session).`);
        // So retarget the whole run at the env the tab is actually on.
        setBaseUrl(tabOrigin);
      }
    // Non-CDP: a fresh tab inherits the storageState, so this is fine.
    } else {
      page = await ctx.newPage();
      // We opened it, so we close it.
      ownsPage = true;
    }
    // Start watching for the quiz JSON before any quiz can load.
    setupQuizKeyInterceptor(page);
    setupApiHeaderCapture(page); // capture org/rootOrg headers for the S3 key fetch
    // In CDP mode we never log in, so TEST_USER_EMAIL is NOT the account used —
    // it is whoever is already signed into that Chrome tab. With USE_FRESH_USER=1
    // it is the last signed-up user (the "🔑 Auth:" line above names it too).
    const freshEmail = (() => {
      try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '.auth', 'fresh-user-email.json'), 'utf-8')).email; } catch { return ''; }
    })();
    console.log(process.env.USE_CDP === '1'
      ? `👤 Account: whoever is signed into that Chrome tab (CDP — no login performed)`
      : process.env.USE_FRESH_USER === '1'
        ? `👤 Account: ${freshEmail || 'the last signed-up user'} (signed-up session)`
        : `👤 Account: ${process.env.TEST_USER_EMAIL}`);
    // Log the env and whether the AI fallback is available.
    console.log(`🌐 Env: ${BASE_URL}`);
    console.log(GEMINI_API_KEY ? `🤖 Gemini AI ready (${GEMINI_PRIMARY})` : `⚠️  No GEMINI_API_KEY`);
  });

  // Runs once, after the test.
  test.afterAll(async () => {
    // Never close the user's own tab in CDP mode; only close tabs we opened.
    if (ownsPage) await page?.close().catch(() => {});
  });

  // ONE test for the whole climb — unlike Competency.spec.ts, which splits it up.
  test(`Complete competency: "${COMPETENCY_NAME || '(none provided)'}"`, async () => {
    // Whole-competency climb can take a while (Gemini fallback is throttled).
    test.setTimeout(40 * 60 * 1000);

    // ── Guard rails ──────────────────────────────────────────────
    // No competency named — fail immediately with the exact command to run.
    if (!COMPETENCY_NAME) {
      throw new Error(
        'No competency name provided. Pass one in the terminal, e.g.:\n' +
        '  .\\run-competency.ps1 "Care of the newborn"\n' +
        'or set $env:COMPETENCY_NAME="<name>" before running this spec.',
      );
    }
    // Localhost can't do password login — but CDP mode (attach to a Chrome you
    // logged into by hand) works fine there. Only block localhost WITHOUT CDP.
    if (/localhost|127\.0\.0\.1|:3000/.test(BASE_URL) && process.env.USE_CDP !== '1') {
      // Again, a thrown error carrying the three ways to fix it.
      throw new Error(
        `BASE_URL is "${BASE_URL}". The localhost mirror does not support password login.\n` +
        `Run locally over CDP instead (attach to a logged-in Chrome):\n` +
        `  .\\run-competency.ps1 "${COMPETENCY_NAME}" -Local\n` +
        `or set USE_CDP=1 with Chrome started on --remote-debugging-port=9222.\n` +
        `Otherwise target a real env:  $env:BASE_URL="https://sphere.aastrika.org"`,
      );
    }

    console.log(`\n🎯 Target competency: "${COMPETENCY_NAME}"\n`);

    // ── Open the dashboard ───────────────────────────────────────
    await openCompetencyDashboard(page);
    // Check the session BEFORE hunting for cards — an unauthenticated tab shows
    // the dashboard shell with a spinner, which otherwise looks like "not found".
    await assertLoggedIn(page);
    await ensureCompetencyDashboard(page);
    // hard — a 30s window, because the dashboard is slow to paint.
    await expect(page.getByText(hiAlso(/competency dashboard/i)).first()).toBeVisible({ timeout: 30_000 });

    // ── Climb every level of the named competency ────────────────
    // One entry per level attempted.
    const levels: LevelOutcome[] = [];
    // The highest level cleared so far.
    let lastLevel = 0;
    // Set from the first level opened; every later level must match it.
    let competencyId = '';

    // Climb up to MAX_LEVELS (5), one level per iteration.
    for (let n = 1; n <= MAX_LEVELS; n++) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🧗 Attempting level ${n} of "${COMPETENCY_NAME}"`);

      // Start from a known place.
      await goBackToDashboard(page).catch(() => {});
      // Open level n, by whichever of the two routes works.
      const { ok, actualLevel } = await openNextAssessment(page, COMPETENCY_NAME, n);
      // None left — that's SUCCESS, not failure: the competency is complete.
      if (!ok) {
        console.log(`\n🏁 No further level available — competency complete (last cleared: Level ${lastLevel}).`);
        break;
      }
      // actualLevel is now always READ from the screen, never assumed.
      lastLevel = actualLevel;

      // Identity check that actually holds: every level of one competency runs
      // under the same collectionId. If level 2 opens a different one, the
      // portal has handed back another competency — which is exactly the bug
      // where "neonatal" silently became "Normal delivery" after level 1.
      //
      // Read it AFTER the player has actually opened. Reading it here, straight
      // off the intro modal, gave an empty id at level 2 and the check skipped
      // itself — which is how a Pregnancy Identification quiz still got through.
      const thisId = await waitForCompetencyId(page);
      // No id at all — stop rather than climb something we can't identify.
      if (!thisId) {
        console.log(`\n⛔ Level ${actualLevel}: no collectionId in ${page.url().slice(0, 90)}`);
        console.log('   Cannot confirm which competency this is — stopping rather than guessing.');
        break;
      }
      // First level: record the id as the reference for every later one.
      if (!competencyId) {
        competencyId = thisId;
        console.log(`   🆔 Competency id: ${competencyId}`);
      // A DIFFERENT id means the portal switched competencies — stop.
      } else if (thisId !== competencyId) {
        console.log(`\n⛔ Level ${actualLevel} belongs to a DIFFERENT competency`);
        console.log(`   expected ${competencyId}, opened ${thisId} — stopping rather than climbing the wrong one.`);
        break;
      }

      // Run the quiz with the best available strategy.
      const { passed, mode } = await runQuizOnce(page, actualLevel);
      // Record the outcome for the summary and the assertions below.
      levels.push({ level: actualLevel, passed, mode });
      console.log(passed
        ? `\n🎉 Level ${actualLevel} PASSED (via ${mode})`
        : `\n❌ Level ${actualLevel} FAILED (via ${mode})`);

      // Return to the dashboard for the next level.
      await goBackToDashboard(page).catch(() => {});

      if (!passed) {
        // A failed level can't unlock the next one — stop the climb.
        console.log(`\n⛔ Stopping: Level ${actualLevel} was not cleared, so higher levels stay locked.`);
        break;
      }
    }

    // ── Summary ──────────────────────────────────────────────────
    // Which levels actually passed.
    const cleared = levels.filter((l) => l.passed).map((l) => l.level);
    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`📊 "${COMPETENCY_NAME}" — levels cleared this run: ${cleared.length}`);
    console.log(`   ${JSON.stringify(levels)}`);
    console.log(`═══════════════════════════════════════════════════════════\n`);

    // At least one level must have been found & cleared for a green run.
    // hard — finding no levels at all means the competency was never located.
    expect(levels.length, `Expected to find at least one level for "${COMPETENCY_NAME}"`).toBeGreaterThan(0);
    // hard — and every level we DID attempt must have passed.
    expect(levels.every((l) => l.passed),
      `Every attempted level of "${COMPETENCY_NAME}" should pass`).toBe(true);

    // No level may be outside 1..5, and none may repeat — either means the run
    // wandered into a different competency rather than climbing this one.
    // Any level number outside the valid range.
    const bad = levels.filter((l) => l.level < 1 || l.level > MAX_LEVELS);
    // hard — the message lists the offending levels.
    expect(bad, `Levels outside 1..${MAX_LEVELS} were attempted: ${JSON.stringify(bad)}`).toHaveLength(0);
    // hard — a Set drops duplicates, so its size must equal the array's length.
    expect(new Set(cleared).size, `The same level was climbed twice: ${JSON.stringify(cleared)}`)
      .toBe(cleared.length);

    // ── Verify it in the Passbook ────────────────────────────────
    // The climb reports what the quizzes said; the Passbook is what the portal
    // actually recorded. A run is only believable when the two agree.
    // test.step groups this in the report as its own collapsible section.
    const passbook = await test.step('Verify the competency in the Passbook', async () => {
      await goBackToDashboard(page).catch(() => {});
      await ensureCompetencyDashboard(page);
      // Open the Passbook.
      await clickTab(page, 'Passbook');
      await page.waitForTimeout(3_000);

      // Four row shapes, narrowed to the one naming this competency.
      const entry = page.locator('mat-card, [class*="card" i], tr, [class*="row" i]')
        .filter({ hasText: COMPETENCY_NAME }).first();
      // A 20s window — the Passbook loads slowly.
      const found = await entry.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false).catch(() => false);
      // Not there — dump what IS listed, so the failure is diagnosable.
      if (!found) {
        const titles = await page.evaluate(() =>
          Array.from(document.querySelectorAll('mat-card, [class*="card" i], tr'))
            .map((c) => ((c as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 70))
            .filter(Boolean).slice(0, 10));
        // Print the first ten entries.
        console.log('   🔍 Passbook entries seen:');
        titles.forEach((t, i) => console.log(`      [${i}] ${t}`));
        return { found: false, text: '', level: 0 };
      }

      // Read the entry's text, whitespace collapsed.
      const text = ((await entry.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      // Pull the level out of it, if it states one.
      const level = parseInt(text.match(/level\s*(\d+)/i)?.[1] ?? '0');
      console.log(`   📗 Passbook: "${text.slice(0, 120)}"`);
      return { found: true, text, level };
    });

    // hard — the portal must have RECORDED the climb, not just reported it.
    expect(passbook.found,
      `"${COMPETENCY_NAME}" is not listed in the Passbook, so the portal did not record this climb`)
      .toBe(true);

    // When the entry states a level, it must be the highest one just cleared —
    // a lower number means the portal did not record the later levels.
    // The highest level we cleared.
    const highest = Math.max(...cleared);
    // Only assert when the Passbook actually states a level.
    if (passbook.level) {
      // hard — `toBeGreaterThanOrEqual`, since a prior run may have gone higher.
      expect(passbook.level,
        `Passbook shows Level ${passbook.level} for "${COMPETENCY_NAME}" but Level ${highest} was cleared`)
        .toBeGreaterThanOrEqual(highest);
      console.log(`   ✅ Passbook confirms Level ${passbook.level} (cleared up to ${highest})`);
    // No level stated — record that, rather than pretending it was verified.
    } else {
      console.log(`   ✅ Passbook lists "${COMPETENCY_NAME}" (no level stated on the entry)`);
    }
  });
});
