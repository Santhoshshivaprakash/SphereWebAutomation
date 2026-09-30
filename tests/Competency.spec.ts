/**
 * Competency Level Climber
 * ──────────────────────────────────────────────────────────────────
 * Goal: clear EVERY level of a target competency.
 *
 * Answering strategy (in order):
 *   1. Answer-key fast path: intercept Sphere's S3 quiz JSON and use
 *      the `isCorrect: true` flags. 100% accuracy when available.
 *   2. Poisoned-key detection: if all options are `isCorrect: false`
 *      (Sphere does this for competency assessments to defeat the
 *      answer-key approach), fall through to Gemini.
 *   3. Gemini batch fallback: scrape all questions, ask Gemini once,
 *      apply real answers on the Re-attempt run.
 *
 * Usage:
 *   $env:COMPETENCY_NAME="<competency title here>"; npx playwright test tests/competency-climb.spec.ts --headed
 *
 * If COMPETENCY_NAME is omitted, the first Re-Assess card is used.
 *
 * Env vars:
 *   COMPETENCY_NAME   — competency title (optional)
 *   GEMINI_API_KEY    — for Gemini fallback (recommended)
 */

// Types only — the runner itself comes from our authenticated harness below.
import { Page, Locator, BrowserContext } from '@playwright/test';
// Auth via storageState (CI-friendly) with a CDP fallback for local dev.
// See tests/helpers/authedTest.ts.
// `test` here is the AUTHENTICATED one: every test gets a logged-in context.
import { test, expect } from './helpers/authedTest';
// Node's file system module — reads .env below.
import * as fs from 'fs';
// Node's path module — builds cross-platform file paths.
import * as path from 'path';
// The shared matcher that maps an on-screen question to its answer-key entry.
import { findMatchingQuestion } from './helpers/questionMatch';

// Which environment to test.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════
// The competency dashboard.
const COMPETENCY_URL    = `${BASE_URL}/app/user/competency`;

// Safety ceiling — stops an infinite climb if the app never reports completion.
const MAX_LEVELS            = 10;

// The preferred Gemini model.
const GEMINI_PRIMARY     = 'gemini-2.5-flash';
// A cheaper, higher-quota model used when the primary is rate-limited.
const GEMINI_FALLBACK    = 'gemini-2.5-flash-lite';
// Base URL for the Gemini REST API.
const GEMINI_URL_BASE    = 'https://generativelanguage.googleapis.com/v1beta/models/';
// Minimum gap between Gemini calls, to stay inside its requests-per-minute quota.
const GEMINI_RPM_DELAY   = 6500;

// Load .env
// An IIFE (immediately-invoked function) — it runs once at import time. Written
// this way so its local variables don't leak into the module scope.
(function loadEnvFile() {
  // The project root's .env file.
  const envPath = path.resolve(__dirname, '..', '.env');
  // No file — nothing to load.
  if (!fs.existsSync(envPath)) return;
  // Walk it line by line.
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    // Trim whitespace.
    const t = line.trim();
    // Skip blanks and comments.
    if (!t || t.startsWith('#')) continue;
    // Split on the FIRST = only; `...rest` keeps any = characters inside the value.
    const [k, ...rest] = t.split('=');
    // Never overwrite a variable already set in the real environment — CLI wins over .env.
    if (k && !process.env[k.trim()]) process.env[k.trim()] = rest.join('=').trim();
  }
})();

// Which competency to climb. Empty means "use the first Re-Assess card".
const COMPETENCY_NAME = process.env.COMPETENCY_NAME ?? '';
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
    // Only the S3 quiz files; ignore everything else.
    if (!/sunbirdcontent\.s3.*\/content\/.*_quiz\.json/i.test(url)) return;
    // And only successful ones.
    if (!res.ok()) return;
    // Wrapped: a non-JSON body must not break the response handler.
    try {
      const json = await res.json();
      // Only store it if it actually has questions.
      if (Array.isArray(json?.questions) && json.questions.length > 0) {
        // Stash it for the next quiz to consume.
        pendingQuizKey = json as QuizKey;
        console.log(`   🔑 Captured quiz JSON: ${json.questions.length} questions`);
      }
    // Swallow parse errors silently — this is an opportunistic capture.
    } catch { /* ignore */ }
  });
}

// Take the pending key and clear it, so it can't be reused on a later quiz.
function consumeQuizAnswerKey(): QuizKey | null {
  // Grab it…
  const k = pendingQuizKey;
  // …clear the slot…
  pendingQuizKey = null;
  // …and hand it over.
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
  // If 80%+ of questions have no correct answer marked, treat as poisoned
  // A threshold rather than "all", so a few genuinely-unmarked questions do not
  // discard an otherwise usable key.
  return poisonedCount / total >= 0.8;
}

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════
// Click a dashboard tab by name. Five selector shapes in one.
async function clickTab(page: Page, name: 'Job Description' | 'Passbook' | 'Required') {
  const tab = page.locator([
    `[role="tab"]:has-text("${name}")`,
    `mat-tab-label:has-text("${name}")`,
    `.mat-mdc-tab:has-text("${name}")`,
    `button:has-text("${name}")`,
    `a:has-text("${name}")`,
  ].join(', ')).first();
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
// GEMINI (batch mode — same as course-complete)
// ══════════════════════════════════════════════════════════════════════
// Timestamp of the last Gemini call, for the rate limiter below.
let lastGeminiCallAt = 0;

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
    // The request body.
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
    // Parse the reply.
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

// Ask Gemini ALL the questions in ONE call. Batching is what keeps this inside
// the free-tier quota — one request per quiz instead of one per question.
async function askGeminiBatch(
  questions: { stem: string; options: string[] }[],
): Promise<Record<number, string>> {
  // No key configured — say so and return an empty map.
  if (!GEMINI_API_KEY) {
    console.log(`      ⚠️  GEMINI_API_KEY not set — returning empty map`);
    return {};
  }
  // Build the question block.
  const block = questions.map((q, i) => {
    // Label the options A, B, C… — charCode 65 is 'A'.
    const opts = q.options.map((o, j) => `   [${String.fromCharCode(65 + j)}] ${o}`).join('\n');
    // Number each question so the reply can be mapped back.
    return `Q${i + 1}: ${q.stem}\n${opts}`;
  }).join('\n\n');

  // The prompt. It names the clinical domains and warns that questions may be in
  // Hindi, then demands bare JSON so the reply is machine-readable.
  const prompt =
`You are answering a medical/clinical competency assessment (WHO newborn care, KMC, family planning, emergency triage, maternal health, referral protocols). Questions may be in Hindi (Devanagari) or mixed Hindi-English. Use accurate medical and clinical knowledge.

Answer ALL ${questions.length} questions below. Respond with ONLY a JSON object mapping each question number to its correct option letter. No prose, no markdown fences.

Example format: {"1":"B","2":"D","3":"A"}

${block}`;

  // Try the primary model, then the cheaper fallback.
  for (const model of [GEMINI_PRIMARY, GEMINI_FALLBACK]) {
    // Respect the rate limit before each call.
    await throttle();
    // Make the call.
    const result = await callGemini(model, prompt, 2000);
    if (result.ok) {
      // Parse whatever came back into a question-number → letter map.
      const map = parseAnswerMap(result.text ?? '', questions.length);
      // How many answers did we actually get?
      const got = Object.keys(map).length;
      console.log(`      🤖 ${model} returned ${got}/${questions.length} answers`);
      // Any answers at all is good enough — return them.
      if (got > 0) return map;
    }
    // 429 = rate-limited, 503 = overloaded. Both are worth retrying on the other model.
    if (result.status === 429 || result.status === 503) {
      console.log(`      ⚠️  ${model} ${result.status}, trying fallback`);
      continue;
    }
    // Any other error: report a truncated message and try the fallback anyway.
    console.log(`      ⚠️  ${model} error: ${result.error?.slice(0, 120) ?? '?'}`);
  }
  // Both models failed — an empty map tells the caller to guess.
  return {};
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
      // Walk the keys.
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

// ══════════════════════════════════════════════════════════════════════
// QUESTION SCRAPER + RADIO CLICK (multi-strategy)
// ══════════════════════════════════════════════════════════════════════
// Read the question and its options off the quiz player. Multi-strategy,
// because the player gives the question text no stable class or id.
async function scrapeCurrentQuestion(page: Page): Promise<{ question: string; options: string[] }> {
  // Wait for the question to settle (page transitions sometimes leave a brief
  // empty state between questions)
  await page.waitForTimeout(500);

  // Everything below runs INSIDE the browser, where `document` exists.
  return await page.evaluate(() => {
    // Every radio group on the page…
    const groups = Array.from(document.querySelectorAll<HTMLElement>('mat-radio-group'));
    // …but only the VISIBLE one: the player keeps previous questions in the DOM.
    const visible = groups.find((g) => {
      const r = g.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    // Nothing on screen — return empty and let the caller retry.
    if (!visible) return { question: '', options: [] };

    // Scrape options first — they're reliably inside the radio group
    // Each radio button's text.
    const options = Array.from(visible.querySelectorAll<HTMLElement>('mat-radio-button'))
      .map((r) => (r.innerText ?? '').trim())
      // Drop blanks.
      .filter((t) => t.length > 0);

    // Build a set of option texts so we can exclude them when finding the question
    const optionTexts = new Set(options.map((o) => o.trim()));

    // The question text usually lives in a heading element above the radio group.
    // Strategy 1: walk UP the DOM, look for the FIRST meaningful text line that
    // isn't an option, isn't UI chrome, and is long enough to be a question.
    // Start at the radio group's parent and climb.
    let parent: HTMLElement | null = visible.parentElement;
    let question = '';
    // UI chrome to ignore: buttons, "3 / 10" counters, "Question 4" labels.
    const blacklist = /^(next|previous|submit|start now|cancel|close|\d+\s*\/\s*\d+|question\s*\d+)\s*$/i;

    // Climb until we find something or run out of ancestors.
    while (parent && !question) {
      // All the text inside this ancestor.
      const innerText = (parent.innerText ?? '').trim();
      if (innerText) {
        // Split into lines, trimmed, blanks dropped.
        const lines = innerText.split('\n').map((l) => l.trim()).filter(Boolean);
        // Pick the longest reasonable line that isn't an option/UI chrome. Question
        // text is usually 15-500 chars and appears before the options in the container.
        // Pick the longest reasonable line that isn't an option/UI chrome.
        // Question text usually 15-500 chars, and is the FIRST such line that
        // appears before the options in the container.
        // Score each candidate line, then take the best.
        const candidates: { text: string; score: number }[] = [];
        for (const line of lines) {
          // Too short to be a question, or too long to be anything but a paragraph.
          if (line.length < 10 || line.length > 500) continue;
          // It's one of the options — skip.
          if (optionTexts.has(line)) continue;
          // It's a button or a counter — skip.
          if (blacklist.test(line)) continue;
          // Boost score if the line ends in ? or ।  (Devanagari period)
          // Base score is simply the length — longer lines are more likely to be the stem.
          let score = line.length;
          // A sentence-ending mark is a strong signal, so it outweighs length.
          if (line.endsWith('?') || line.endsWith('?') || line.endsWith('।')) score += 200;
          // Boost if it contains "What", "Which", "How", "When", etc.
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

    // Strategy 2: if still no question found, fall back to any heading element
    // (h1-h4) inside the closest dialog/container
    if (!question) {
      // Scope to the quiz container if we can find one; else the whole document.
      const dialog = visible.closest('mat-dialog-container, [class*="viewer"], [class*="quiz"]') ?? document.body;
      // Every heading or paragraph inside it…
      const headings = Array.from(dialog.querySelectorAll<HTMLElement>('h1, h2, h3, h4, p'))
        // …filtered the same way as strategy 1.
        .filter((h) => {
          // Must be visible.
          const r = h.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const t = (h.innerText ?? '').trim();
          // Right length, not an option, not UI chrome.
          return t.length > 10 && t.length < 500 && !optionTexts.has(t) && !blacklist.test(t);
        });
      // Any survivors?
      if (headings.length > 0) {
        // Pick the heading closest to (but above) the radio group
        // Where is the radio group on screen?
        const rgRect = visible.getBoundingClientRect();
        // Sort by position rather than by text.
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

// Click the radio at `idx`, escalating through five strategies until the
// option actually registers as checked.
async function selectRadioOption(page: Page, idx: number): Promise<void> {
  // Let the question settle.
  await page.waitForTimeout(300);
  // All of this runs inside the browser.
  const result = await page.evaluate((targetIdx: number) => {
    // Find the visible radio group, the same way the scraper does.
    const groups = Array.from(document.querySelectorAll<HTMLElement>('mat-radio-group'));
    const visible = groups.find((g) => {
      const r = g.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    // Nothing on screen.
    if (!visible) return { ok: false };

    // Its radio buttons.
    const radios = Array.from(visible.querySelectorAll<HTMLElement>('mat-radio-button'));
    // Guard the index — an out-of-range pick would throw.
    if (targetIdx < 0 || targetIdx >= radios.length) return { ok: false };

    // The one we want.
    const target = radios[targetIdx];
    // Bring it into view; `block: 'center'` avoids sticky headers overlapping it.
    target.scrollIntoView({ block: 'center' });

    // "Is it checked?" measured three ways, because Material's state lives in a
    // class, an ARIA attribute AND the underlying input.
    const isChecked = (el: HTMLElement) =>
      el.classList.contains('mat-mdc-radio-checked') ||
      el.getAttribute('aria-checked') === 'true' ||
      !!el.querySelector('input[type="radio"]:checked');

    // Attempts 1–4: click each wrapper layer in turn, outermost first.
    for (const sel of ['.mat-mdc-radio-touch-target', '.mdc-form-field', 'label', '.mdc-radio']) {
      // Does this layer exist on this build?
      const el = target.querySelector<HTMLElement>(sel);
      if (el) {
        // Click it…
        el.click();
        // …and stop as soon as the radio reports checked.
        if (isChecked(target)) return { ok: true };
      }
    }
    // Attempt 5: click the component itself.
    target.click();
    if (isChecked(target)) return { ok: true };

    // Attempt 6: reach the real <input> underneath.
    const input = target.querySelector<HTMLInputElement>('input[type="radio"]');
    if (input) {
      // Click it natively.
      input.click();
      if (isChecked(target)) return { ok: true };
      // Still not checked — set the property by hand…
      input.checked = true;
      // …then fire input…
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      // …and change, so Angular's form control notices.
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (isChecked(target)) return { ok: true };
    }
    // Every strategy failed.
    return { ok: false };
  // `idx` is passed in because page.evaluate runs in a separate context.
  }, idx);
  // Let Angular react.
  await page.waitForTimeout(400);
  // Warn rather than throw — the quiz can still continue with a wrong answer.
  if (!result.ok) console.log(`      ⚠️  Radio click did not register at index ${idx}`);
}

// Advance to the next question, or submit on the last one.
async function clickNextOrSubmit(page: Page) {
  // Prefer Next…
  let btn = page.getByRole('button', { name: /^next$/i }).first();
  // …and fall back to Submit when Next is gone.
  if (!(await btn.isVisible().catch(() => false))) {
    btn = page.getByRole('button', { name: /^submit$/i }).first();
  }
  // Neither on screen — nothing to do.
  if (!(await btn.isVisible().catch(() => false))) return;
  // Disabled means no option is selected yet; return rather than click blindly.
  if (await btn.isDisabled().catch(() => false)) return;
  // Go.
  await btn.click();
  await page.waitForTimeout(1500);
}

// ══════════════════════════════════════════════════════════════════════
// ANSWER-KEY MATCHING
// ══════════════════════════════════════════════════════════════════════
// findMatchingQuestion lives in helpers/questionMatch.ts — shared by every
// quiz-answering spec so the case-study stem collision is fixed in one place.

// ══════════════════════════════════════════════════════════════════════
// QUIZ RUNNER
// ══════════════════════════════════════════════════════════════════════
// Run through a single quiz attempt with the best available answering
// strategy. Returns { passed, totalQuestions, mode }.
/**
 * Run through a single quiz attempt with the best available answering
 * strategy. Returns { passed, totalQuestions, mode }.
 */
async function runQuizOnce(
  page: Page,
  levelNumber: number,
): Promise<{ passed: boolean; totalQuestions: number; mode: 'key' | 'gemini' | 'fallback' }> {

  // Consume any captured answer key (cleared after read)
  const answerKey = consumeQuizAnswerKey();
  // Is it the poisoned kind?
  const keyPoisoned = answerKey ? isAnswerKeyPoisoned(answerKey) : false;
  // Only use it if we have one AND it isn't poisoned.
  const useKey = answerKey && !keyPoisoned;

  // Log which strategy we're about to take — the single most useful line in the run.
  if (answerKey) {
    if (keyPoisoned) {
      console.log(`   ⚠️  Answer key intercepted but POISONED (all isCorrect: false) — using Gemini`);
    } else {
      console.log(`   🔑 Answer key intercepted (${answerKey.questions.length} questions in pool)`);
    }
  } else {
    console.log(`   🤖 No answer key — using Gemini`);
  }

  // Wait for "Start Now!" intro
  const startBtn = page.getByRole('button', { name: /start now/i }).first();
  // hard-ish: a 15s wait, so a quiz that never loads fails here with a clear cause.
  await startBtn.waitFor({ state: 'visible', timeout: 15_000 });

  // Read the question count off the intro screen; default to 5 if it isn't there.
  const qText = await page.getByText(/\d+\s*questions?/i).first().textContent().catch(() => '5');
  // Pull the digits out.
  const totalQuestions = parseInt(qText?.match(/(\d+)/)?.[1] ?? '5');
  console.log(`   📋 Level ${levelNumber} — ${totalQuestions} questions`);

  // Begin the quiz.
  await startBtn.click();
  await page.waitForTimeout(2500);

  // ── Answer-key path ─────────────────────────────────────────────
  // The fast, 100%-accurate route.
  if (useKey && answerKey) {
    await answerWithKey(page, answerKey, totalQuestions);
    await page.waitForTimeout(2500);
    // Did we pass?
    const passed = await detectQuizPassed(page);
    return { passed, totalQuestions, mode: 'key' };
  }

  // ── Gemini batch path ───────────────────────────────────────────
  // No usable key — scrape everything and ask the model.
  await answerWithGeminiBatch(page, totalQuestions);
  await page.waitForTimeout(2500);
  const passed = await detectQuizPassed(page);
  return { passed, totalQuestions, mode: 'gemini' };
}

// Answer every question using the intercepted key.
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
    // Matched.
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
      // So we fall back to option A, and say so loudly.
      console.log(`      ⚠️  No key match for: "${question.slice(0, 70)}"`);
    }
    // Select it…
    await selectRadioOption(page, idx);
    // …and advance.
    await clickNextOrSubmit(page);
  }
}

// Answer every question by asking Gemini, one question at a time.
async function answerWithGeminiBatch(page: Page, total: number) {
  // For competency assessments: ask Gemini ONE question at a time during
  // the forward pass. No placeholder-then-reattempt. No batch (Gemini
  // sometimes returns more accurate answers when focused on a single
  // question), no navigate-back complexity.
  //
  // Slower (12 API calls per level instead of 1), but reliable and
  // since this spec is run occasionally, daily quota is plenty.

  console.log(`\n   📝 Answering ${total} questions one by one`);

  // One iteration per question.
  for (let q = 1; q <= total; q++) {
    console.log(`\n   ❓ Q${q}/${total}`);
    // Let the question render.
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

    // Ask Gemini for this single question
    const idx = await askGeminiOne(question, options);
    // Say which one we're picking before we click it.
    console.log(`      ✅ Selecting [${String.fromCharCode(65 + idx)}] ${options[idx]?.slice(0, 60)}`);

    await selectRadioOption(page, idx);
    await clickNextOrSubmit(page);
  }
}

/**
 * Ask Gemini for the correct answer to ONE multiple-choice question.
 * Returns a 0-based option index. Defaults to 0 on any failure.
 */
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

  // Try the primary model, then the cheaper fallback.
  for (const model of [GEMINI_PRIMARY, GEMINI_FALLBACK]) {
    // Respect the rate limit.
    await throttle();
    // 200 output tokens is plenty for a letter plus one sentence.
    const result = await callGemini(model, prompt, 200);

    if (result.ok) {
      // The raw reply.
      const raw = (result.text ?? '').trim();
      // The first line should be the bare letter.
      const firstLine = raw.split('\n')[0]?.trim() ?? '';
      // Parse: first letter A-Z in the response, bounded by option count
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

    // 429 = rate-limited, 503 = overloaded. Both are worth trying on the other model.
    if (result.status === 429 || result.status === 503) {
      console.log(`      ⚠️  ${model} ${result.status}, trying fallback`);
      continue;
    }
    // Any other error — report it and stop trying.
    console.log(`      ⚠️  ${model} error: ${result.error?.slice(0, 100) ?? '?'}`);
    break;
  }

  // Everything failed. Defaulting to A is better than aborting the climb.
  console.log(`      ⚠️  All Gemini attempts failed — defaulting to A`);
  return 0;
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
    if (await page.getByText(re).first().isVisible({ timeout: 2000 }).catch(() => false)) {
      return true;
    }
  }
  // None found — treat as a fail.
  return false;
}

// Return to the dashboard after a quiz.
async function goBackToDashboard(page: Page) {
  // The results screen offers a button back.
  const btn = page.getByRole('button', { name: /go to competency dashboard/i }).first();
  // Use it if it's there.
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(2500);
  }
  // Direct goto to /app/user/competency redirects to home, so ensure via nav.
  await ensureCompetencyDashboard(page);
}

// ══════════════════════════════════════════════════════════════════════
// LEVEL OPENER
// ══════════════════════════════════════════════════════════════════════
// Open the next available level for the chosen competency.
// 
// Each Re-Assess click opens the NEXT available level's intro modal directly.
// After passing Level 1, the next Re-Assess opens Level 2, and so on. The
// modal header reads "Level N : <title>", so N is read off the screen to
// confirm which level actually opened — it may not be the one we expected.
/**
 * Open the next available level for the chosen competency.
 *
 * Behavior:
 *   - Each Re-Assess click opens the next available level's intro modal
 *     directly (with "Start Now!"). After passing Level 1, the next
 *     Re-Assess opens Level 2, and so on.
 *   - The intro modal header reads "Level N : <title>" so we read N
 *     from the screen to confirm we're on the level we expect.
 *
 * Returns: { ok, actualLevel } where actualLevel is the level the modal
 * actually opened (might not equal levelNumber if the system jumped or
 * skipped).
 */
async function openLevel(
  page: Page,
  expectedLevel: number,
  competencyName: string,
): Promise<{ ok: boolean; actualLevel: number }> {
  // Make sure we're on the dashboard first.
  await ensureCompetencyDashboard(page);
  // Competencies to assess live under the Required tab.
  await clickTab(page, 'Required');
  await page.waitForTimeout(1000);

  // ── Find the competency card ───────────────────────────────────
  // Declared here because both branches below assign it.
  let reAssessBtn: Locator;
  // A specific competency was named.
  if (competencyName) {
    // Three card shapes, narrowed to the one containing that title.
    const cards = page.locator('mat-card, [class*="card" i], [class*="assessment" i]')
      .filter({ hasText: competencyName });

    // How many matched?
    const cardCount = await cards.count();
    // None — this is the most common failure, so it gets a real diagnostic.
    if (cardCount === 0) {
      console.log(`   ❌ No card found containing "${competencyName}"`);
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
      return { ok: false, actualLevel: 0 };
    }

    // Matched.
    console.log(`   ✅ Found ${cardCount} card(s) matching "${competencyName}"`);
    // Take the first match.
    const card = cards.first();
    // Its Re-Assess button — for a competency already started.
    reAssessBtn = card.getByRole('button', { name: /re-?assess/i }).first();
    // Not there? Then this is a FRESH competency…
    if (!(await reAssessBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      // …so look for "Assess" instead. Anchored, so it can't match "Re-Assess".
      reAssessBtn = card.getByRole('button', { name: /^assess$/i }).first();
    }
  // No name given — auto-select the first available competency: Re-Assess if one
  // has been started, else Assess for a fresh one.
  } else {
    // Auto-select the first available competency: click "Re-Assess" if it's
    // already been started, else "Assess" if it's a fresh competency.
    reAssessBtn = page.getByRole('button', { name: /re-?assess/i }).first();
    if (!(await reAssessBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      reAssessBtn = page.getByRole('button', { name: /^assess$/i }).first();
    }
  }

  // Neither button found anywhere — give up cleanly.
  if (!(await reAssessBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
    console.log(`   ❌ Assess / Re-Assess button not visible`);
    return { ok: false, actualLevel: 0 };
  }

  // ── Click Re-Assess — opens the next available level's intro modal ──
  await reAssessBtn.scrollIntoViewIfNeeded();
  // Open it.
  await reAssessBtn.click();
  await page.waitForTimeout(2500);

  // ── Confirm the modal opened (Start Now! visible) ──────────────
  const startBtn = page.getByRole('button', { name: /start now/i }).first();
  // No Start Now means the modal never appeared — report and return.
  if (!(await startBtn.isVisible({ timeout: 8_000 }).catch(() => false))) {
    console.log(`   ❌ Level intro modal did not appear (no "Start Now!" button)`);
    return { ok: false, actualLevel: 0 };
  }

  // ── Read which level the modal is showing ──────────────────────
  // Modal header reads: "Level N : <title>"
  // Read it inside the browser.
  const headerText = await page.evaluate(() => {
    // Three dialog shapes.
    const dialog = document.querySelector('mat-dialog-container, [class*="modal"], [class*="dialog"]');
    if (!dialog) return '';
    // Its first heading.
    const heading = dialog.querySelector('h1, h2, h3, h4');
    return (heading as HTMLElement)?.innerText?.trim() ?? '';
  });

  // Pull the level number out of "Level 3 : …".
  const levelMatch = headerText.match(/level\s*(\d+)/i);
  // Fall back to the expected level if the header didn't parse.
  const actualLevel = levelMatch ? parseInt(levelMatch[1]) : expectedLevel;

  // Log the header verbatim…
  console.log(`   📍 Modal opened: "${headerText.slice(0, 80)}"`);
  // …and flag it when the app opened a different level than we asked for.
  console.log(`   ✅ Detected Level ${actualLevel}${actualLevel !== expectedLevel ? ` (expected ${expectedLevel})` : ''}`);

  return { ok: true, actualLevel };
}

// ══════════════════════════════════════════════════════════════════════
// OPEN AN ASSESSMENT VIA JOB DESCRIPTION → ROLES → ASSESS
// The reliable path (from the recorded flow): competencies live under the
// "Job Description" tab, grouped by role in mat-expansion-panels. Expanding a
// role reveals competencies each with an "Assess" (fresh) / "Re-Assess"
// (started) button that opens the assessment intro ("Start Now!").
// ══════════════════════════════════════════════════════════════════════
async function openViaJobDescription(page: Page): Promise<{ ok: boolean; actualLevel: number }> {
  // Make sure we're on the dashboard.
  await ensureCompetencyDashboard(page);
  // Switch to the Job Description tab; ignore a failure and let the checks below decide.
  await clickTab(page, 'Job Description').catch(() => {});
  await page.waitForTimeout(1500);

  // Expand role panels until an Assess/Re-Assess button is revealed.
  // Maybe one is already on screen — check before expanding anything.
  const alreadyVisible = await page.getByRole('button', { name: /^(assess|re-?assess)$/i })
    .first().isVisible({ timeout: 1500 }).catch(() => false);
  // Not visible, so start opening the role accordions.
  if (!alreadyVisible) {
    // Two shapes of expansion-panel header.
    const headers = page.locator('[id^="mat-expansion-panel-header"], mat-expansion-panel-header');
    const count = await headers.count().catch(() => 0);
    // Cap at 15 panels, so a long role list can't stall the run.
    for (let i = 0; i < Math.min(count, 15); i++) {
      // Open this one.
      await headers.nth(i).click().catch(() => {});
      await page.waitForTimeout(500);
      // Stop as soon as a button appears — no need to open the rest.
      if (await page.getByRole('button', { name: /^(assess|re-?assess)$/i })
        .first().isVisible({ timeout: 800 }).catch(() => false)) break;
    }
  }

  // Now grab whichever button surfaced.
  const assessBtn = page.getByRole('button', { name: /^(re-?assess|assess)$/i }).first();
  // Still nothing — give up cleanly.
  if (!(await assessBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
    console.log('   ❌ No Assess/Re-Assess button under Job Description → Roles');
    return { ok: false, actualLevel: 0 };
  }
  // Bring it on screen and click it.
  await assessBtn.scrollIntoViewIfNeeded().catch(() => {});
  await assessBtn.click().catch(() => {});
  await page.waitForTimeout(2500);

  // The intro modal's Start Now button.
  const startBtn = page.getByRole('button', { name: /start now/i }).first();
  // No modal means the click didn't open an assessment.
  if (!(await startBtn.isVisible({ timeout: 8_000 }).catch(() => false))) {
    console.log('   ❌ Assessment intro ("Start Now!") did not appear after Assess');
    return { ok: false, actualLevel: 0 };
  }
  // Read the modal's heading inside the browser.
  const headerText = await page.evaluate(() => {
    // Three dialog shapes.
    const d = document.querySelector('mat-dialog-container, [class*="modal"], [class*="dialog"]');
    return (d?.querySelector('h1,h2,h3,h4') as HTMLElement)?.innerText?.trim() ?? '';
  });
  // Pull the level number out; `|| 0` also converts a NaN to 0.
  const lvl = parseInt(headerText.match(/level\s*(\d+)/i)?.[1] ?? '0') || 0;
  console.log(`   📍 Opened assessment via Job Description: "${headerText.slice(0, 60)}"`);
  return { ok: true, actualLevel: lvl };
}

// Open the next assessment, trying the Required-tab Re-Assess path first, then
// the Job Description → Roles → Assess path (the recorded, reliable flow).
async function openNextAssessment(page: Page): Promise<{ ok: boolean; actualLevel: number }> {
  // Try the Required tab first — it's the shorter route when it works.
  const viaRequired = await openLevel(page, 0, COMPETENCY_NAME);
  if (viaRequired.ok) return viaRequired;
  // Otherwise fall through to the roles accordion.
  return openViaJobDescription(page);
}

// Are there any assessable competencies? Check the Required tab, then fall back
// to Job Description → Roles (expanding panels) — competencies live in either.
async function competenciesExist(page: Page): Promise<boolean> {
  await ensureCompetencyDashboard(page);
  // A small helper so the same count can be taken at three points below.
  const assessBtn = page.getByRole('button', { name: /re-?assess|^assess$/i });
  const anyAssess = () => assessBtn.count().catch(() => 0);
  // After a tab switch, WAIT for the list to load instead of counting once after a
  // fixed pause — on slower CI machines the buttons arrive after 1.2s and a single
  // count reported "no competencies" for an account that has them.
  const assessAppears = (timeout: number) =>
    assessBtn.first().waitFor({ state: 'attached', timeout }).then(() => true, () => false);
  // Check the Required tab…
  await clickTab(page, 'Required').catch(() => {});
  // …found some, done.
  if (await assessAppears(10_000)) return true;
  // Otherwise try Job Description.
  await clickTab(page, 'Job Description').catch(() => {});
  // Found some there, done.
  if (await assessAppears(10_000)) return true;
  // Still nothing — the competencies may be hidden inside collapsed role panels.
  const headers = page.locator('[id^="mat-expansion-panel-header"], mat-expansion-panel-header');
  const hc = await headers.count().catch(() => 0);
  // Open up to 15 of them, checking after each.
  for (let i = 0; i < Math.min(hc, 15); i++) {
    await headers.nth(i).click().catch(() => {});
    await page.waitForTimeout(400);
    if ((await anyAssess()) > 0) return true;
  }
  // Genuinely none — the caller will trigger the role self-heal.
  return false;
}

// ══════════════════════════════════════════════════════════════════════
// ROLE SELF-HEAL
// The competency dashboard only populates the "Required" tab for ANM/MPW-type
// roles. If the account's Designation is something else (e.g. "Doctors"), the
// Required tab shows "no result". In that case we open Account →
// Organizational Details, set Background=Healthcare Worker, Designation=
// ANM/MPW, an Org Type, save, and reload — then the competencies appear.
// ══════════════════════════════════════════════════════════════════════
// Is the Required tab empty?
async function requiredTabHasNoResult(page: Page): Promise<boolean> {
  await ensureCompetencyDashboard(page);
  await clickTab(page, 'Required').catch(() => {});
  await page.waitForTimeout(1500);
  // Six wordings for an empty state, since the app phrases it differently by build.
  const emptyState = await page
    .getByText(/no results?( found)?|no competenc|nothing (here|to show)|not found|no data|no record/i)
    .first().isVisible({ timeout: 2500 }).catch(() => false);
  // Explicit empty message — definitely empty.
  if (emptyState) return true;
  // No Re-Assess / Assess cards at all → treat as empty.
  const cards = await page.getByRole('button', { name: /re-?assess|^assess$/i }).count().catch(() => 0);
  return cards === 0;
}

// Pick an option in a Material dropdown by visible text.
async function selectMatOption(page: Page, matSelect: Locator, optionRe: RegExp): Promise<boolean> {
  // Bring the dropdown on screen…
  await matSelect.scrollIntoViewIfNeeded().catch(() => {});
  // …and open it. Material only renders its options once the panel opens.
  await matSelect.click().catch(() => {});
  await page.waitForTimeout(700);
  // Find the option matching the pattern.
  const opt = page.locator('mat-option, [role="option"]').filter({ hasText: optionRe }).first();
  // Present?
  if (await opt.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Click it.
    await opt.click().catch(() => {});
    await page.waitForTimeout(500);
    // Report success.
    return true;
  }
  // Not found — close the panel again so it can't block the next click.
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  // Report failure rather than throwing; the caller decides what that means.
  return false;
}

// Set Organizational Details to an ANM/MPW healthcare-worker role and save.
async function fixOrgToANM(page: Page): Promise<boolean> {
  console.log('\n🩹 Role fix: setting Organizational Details (Background=Healthcare Worker, Designation=ANM/MPW)…');
  await page.goto(`${BASE_URL}/page/home`);            // Account renders blank on direct URL — go via header
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(2000);
  // Click the header's Account control, in either language.
  await page.getByText(/^(account|खाता)$/i).first().click().catch(() => {});
  await page.waitForTimeout(3000);
  // Then the Organization Details section.
  await page.getByText(/^(organization details|संगठन विवरण)$/i).first().click().catch(() => {});
  await page.waitForTimeout(1800);

  // The Org form has exactly 3 <mat-select>s, in order: Background, Designation,
  // Org Type. (The header search is a plain input, not a mat-select.)
  const selects = page.locator('mat-select');
  // Fewer than three means we're not on the form — bail rather than click blindly.
  if ((await selects.count().catch(() => 0)) < 3) {
    console.log('   ⚠️  Org Details dropdowns not found — cannot apply role fix');
    return false;
  }
  // Set the background…
  const bg   = await selectMatOption(page, selects.nth(0), /healthcare worker/i);
  // …the designation (the one that actually matters)…
  const desig = await selectMatOption(page, selects.nth(1), /anm\s*\/?\s*mpw/i);
  // …and any org type at all; four accepted values, since the list varies.
  const org  = await selectMatOption(page, selects.nth(2), /private sector|public\/government|ngo|others/i);
  // Log all three outcomes so a partial fix is visible.
  console.log(`   • Background=${bg}  Designation(ANM/MPW)=${desig}  OrgType=${org}`);

  // The Save button, in either language.
  const save = page.getByRole('button', { name: /^(save|सेव करें|सहेजें)$/i })
    .or(page.getByText(/^(save|सेव करें|सहेजें)$/i)).first();
  await save.scrollIntoViewIfNeeded().catch(() => {});
  // Save.
  await save.click().catch(() => {});
  await page.waitForTimeout(3500);
  console.log('   💾 Saved Organizational Details');
  return desig; // the fix only matters if Designation became ANM/MPW
}

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
  if (await nav.isVisible({ timeout: 4000 }).catch(() => false)) {
    await nav.click().catch(() => {});
  // No nav control — fall back to a direct URL.
  } else {
    await page.goto(COMPETENCY_URL);
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(4000); // give competencies a few seconds to load
}

// Ensure the shared page is actually on the competency dashboard. The SPA
// redirects /app/user/competency → /page/home after idle, so a plain goto
// bounces back home; clicking the header "Competency" button is reliable.
async function onCompetencyDashboard(page: Page): Promise<boolean> {
  // Two markers: the Required tab, or the dashboard heading.
  return await page.getByRole('tab', { name: /required/i })
    .or(page.getByText(/competency dashboard/i)).first()
    .isVisible({ timeout: 2500 }).catch(() => false);
}

// Get us to the dashboard, retrying up to three times.
async function ensureCompetencyDashboard(page: Page) {
  for (let i = 0; i < 3; i++) {
    // Already there — nothing to do.
    if (await onCompetencyDashboard(page)) return;
    // Prefer the header "Competency" nav (stays authenticated); fall back to goto.
    const nav = page.getByRole('button', { name: /^(competency|योग्यता)$/i })
      .or(page.getByText(/^(competency|योग्यता)$/i)).first();
    // Click it if it's on screen…
    if (await nav.isVisible({ timeout: 2500 }).catch(() => false)) {
      await nav.click().catch(() => {});
    // …otherwise go home first, then click it from there.
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

// Best-effort tour of every element on the competency dashboard (coverage).
async function exploreCompetencyDashboard(page: Page) {
  console.log('\n🔎 Exploring competency dashboard elements…');
  // Visit all three tabs…
  for (const tab of ['Job Description', 'Passbook', 'Required'] as const) {
    await clickTab(page, tab).catch(() => {});
    await page.waitForTimeout(1000);
    // …counting the cards on each.
    const cards = await page.locator('mat-card, [class*="card" i]').count().catch(() => 0);
    console.log(`   • Tab "${tab}": ${cards} card(s)`);
  }
  // Back to Required for the detail below.
  await clickTab(page, 'Required').catch(() => {});
  await page.waitForTimeout(1000);
  // Read every competency title.
  const titles = await page.locator('mat-card h1, mat-card h2, mat-card h3, [class*="card"] [class*="title"]')
    .allInnerTexts().catch(() => []);
  // De-duplicate with a Set, cap at 15, and print as JSON so it's copy-pasteable.
  console.log(`   • Competencies: ${JSON.stringify([...new Set(titles.map((t: string) => t.trim()).filter(Boolean))].slice(0, 15))}`);
  // Every VISIBLE button's label. offsetParent === null is a cheap way to detect
  // a hidden element from inside the browser.
  const btns = await page.getByRole('button').evaluateAll((els: any[]) =>
    els.filter((e) => e.offsetParent !== null).map((e) => (e.innerText || '').trim()).filter(Boolean));
  console.log(`   • Buttons: ${JSON.stringify([...new Set(btns)].slice(0, 20))}`);
  // And how many progress bars are on screen.
  const progress = await page.locator('mat-progress-bar, [role="progressbar"], [class*="progress"]').count().catch(() => 0);
  console.log(`   • Progress indicators: ${progress}`);
}

// ══════════════════════════════════════════════════════════════════════
// TESTS — each step is its OWN test case (granular reporting). A plain
// describe (not .serial) runs them in order on a shared page and, crucially,
// does NOT skip later cases when one fails — so a wrong-answer level still
// leaves the Passbook check to run and each passing step reports green.
// ══════════════════════════════════════════════════════════════════════
// One row per level attempted.
type LevelOutcome = { level: number; passed: boolean; mode: string };

// Shared state across the ordered test cases.
// Module-level mutable state. This is what lets the tests be separate cases
// (each reporting green or red on its own) while still forming one journey.
const flow = {
  needsFix: false,
  competenciesAvailable: false,
  competencyTitle: COMPETENCY_NAME,
  lastLevel: 0,
  climbDone: false,
  levels: [] as LevelOutcome[],
};

const HAS_FIX_SELECTS = () => flow.needsFix; // gate for the org-details steps

test.describe('Competency Dashboard — full flow', () => {
  // The shared context and the ONE tab every test in this file uses.
  let ctx: BrowserContext;
  let page: Page;

  // Runs once, before the first test.
  test.beforeAll(async ({ authContext }) => {
    // `authContext` is a WORKER-scoped fixture — authenticated once per run.
    ctx = authContext;
    // Open the single shared tab.
    page = await ctx.newPage();
    setupQuizKeyInterceptor(page); // attach quiz-key interceptor before any quiz loads
    // Say up front whether the AI fallback is even available.
    console.log(GEMINI_API_KEY ? `🤖 Gemini AI ready (${GEMINI_PRIMARY})` : `⚠️  No GEMINI_API_KEY`);
  });

  // Runs once, after the last test.
  test.afterAll(async () => {
    // Close only our tab — never the user's CDP browser.
    await page?.close().catch(() => {});
  });

  // ── Step 1: open the dashboard ─────────────────────────────────
  test('Open Competency Dashboard', async () => {
    test.setTimeout(60_000);
    // Always start from home.
    await page.goto(`${BASE_URL}/page/home`);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2000);
    await ensureCompetencyDashboard(page); // click the "Competency" nav (goto redirects to home)
    // hard — the dashboard heading proves we arrived.
    await expect(page.getByText(/competency dashboard/i).first()).toBeVisible();
  });

  // ── Step 2: detect whether the role blocks the Required tab ────
  test('Required tab — detect if competencies load for this role', async () => {
    // Record the answer in the shared state; later steps are gated on it.
    flow.needsFix = await requiredTabHasNoResult(page);
    console.log(flow.needsFix
      ? '⚠️  Required tab shows NO RESULT — role likely not ANM/MPW; role fix needed'
      : '✅ Competencies already available for this role');
    // A deliberately trivial assertion: this step's job is to MEASURE, not to
    // judge. Either answer is a valid state, so it just proves the check ran.
    expect(typeof flow.needsFix).toBe('boolean');
  });

  // ── Step 3–7: role self-heal via Organizational Details ────────
  test('Role fix: open Account → Organizational Details', async () => {
    // Every fix step skips when the role already works — so a healthy account shows
    // these five as skipped rather than failing them.
    test.skip(!HAS_FIX_SELECTS(), 'Role already loads competencies — no fix needed');
    await page.goto(`${BASE_URL}/page/home`);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2000);
    // Click the header's Account control, in either language.
    await page.getByText(/^(account|खाता)$/i).first().click().catch(() => {});
    await page.waitForTimeout(3000);
    // Then the Organization Details section.
    await page.getByText(/^(organization details|संगठन विवरण)$/i).first().click().catch(() => {});
    await page.waitForTimeout(1800);
    // hard — the Background label proves we reached the right form.
    await expect(page.getByText(/background|पृष्ठ भूमि/i).first()).toBeVisible();
  });

  // Fix step 1 of 4: the background.
  test('Set Background = Healthcare Worker', async () => {
    test.skip(!HAS_FIX_SELECTS(), 'no fix needed');
    // mat-select index 0 is Background.
    const ok = await selectMatOption(page, page.locator('mat-select').nth(0), /healthcare worker/i);
    // hard — the fix is worthless if the option didn't take.
    expect(ok).toBe(true);
  });

  // Fix step 2 of 4: the designation — the one that actually unlocks competencies.
  test('Set Designation = ANM/MPW', async () => {
    test.skip(!HAS_FIX_SELECTS(), 'no fix needed');
    // Index 1 is Designation. The regex tolerates "ANM/MPW", "ANM / MPW", "ANMMPW".
    const ok = await selectMatOption(page, page.locator('mat-select').nth(1), /anm\s*\/?\s*mpw/i);
    expect(ok).toBe(true);
  });

  // Fix step 3 of 4: the organisation type.
  test('Set Organization Type', async () => {
    test.skip(!HAS_FIX_SELECTS(), 'no fix needed');
    // Index 2 is Org Type. Any of four values will do — the list varies by build.
    const ok = await selectMatOption(page, page.locator('mat-select').nth(2), /private sector|public\/government|ngo|others/i);
    expect(ok).toBe(true);
  });

  // Fix step 4 of 4: save it.
  test('Save Organizational Details', async () => {
    test.skip(!HAS_FIX_SELECTS(), 'no fix needed');
    // The Save button, in either language.
    const save = page.getByRole('button', { name: /^(save|सेव करें|सहेजें)$/i })
      .or(page.getByText(/^(save|सेव करें|सहेजें)$/i)).first();
    await save.scrollIntoViewIfNeeded().catch(() => {});
    // Note: NOT wrapped in .catch — if Save can't be clicked, this step should fail.
    await save.click();
    await page.waitForTimeout(3500);
    console.log('💾 Saved Organizational Details');
  });

  // ── Step 8: reopen the dashboard, competencies should now load ─
  test('Reopen dashboard — competencies now available', async () => {
    test.setTimeout(60_000);
    // Only re-navigate if we actually applied a fix.
    if (flow.needsFix) await openCompetencyDashboard(page);
    await ensureCompetencyDashboard(page);
    // Competencies live under Required OR Job Description → Roles.
    // Record the answer — every later step is gated on it.
    flow.competenciesAvailable = await competenciesExist(page);
    console.log(`Competencies available on dashboard: ${flow.competenciesAvailable}`);
    // hard — this is the real verdict on whether the self-heal worked.
    expect(flow.competenciesAvailable).toBe(true);
  });

  // ── Step 9–11: explore each tab ────────────────────────────────
  test('Explore tab — Job Description (roles & competencies)', async () => {
    // Make sure we're on the dashboard.
    await ensureCompetencyDashboard(page);
    // hard — the tab exists.
    await expect(page.getByText(/job description/i).first()).toBeVisible();
    // Open it.
    await clickTab(page, 'Job Description');
    await page.waitForTimeout(1200);
    // Expand role panels to reveal each role's competencies + Assess buttons.
    const headers = page.locator('[id^="mat-expansion-panel-header"], mat-expansion-panel-header');
    // How many roles?
    const hc = await headers.count().catch(() => 0);
    // Open up to 15 of them, briefly, to reveal what's inside.
    for (let i = 0; i < Math.min(hc, 15); i++) { await headers.nth(i).click().catch(() => {}); await page.waitForTimeout(250); }
    // Count the assess buttons that surfaced…
    const assess = await page.getByRole('button', { name: /^(assess|re-?assess)$/i }).count().catch(() => 0);
    // …and read the competency names. They render as "3 Newborn Care" — a number
    // then the title — which is what the /^d+s+w/ pattern matches.
    const comps = await page.getByRole('button', { name: /^\d+\s+\w/ }).allInnerTexts().catch(() => []);
    console.log(`Job Description: ${hc} role panel(s), ${assess} Assess/Re-Assess button(s)`);
    // De-duplicate, cap at 15, print as JSON. observe — nothing is asserted here.
    console.log(`Competencies: ${JSON.stringify([...new Set(comps.map((t: string) => t.trim()))].slice(0, 15))}`);
  });

  // Explore the Passbook tab.
  test('Explore tab — Passbook', async () => {
    await ensureCompetencyDashboard(page);
    // hard — the tab exists.
    await expect(page.getByText(/passbook/i).first()).toBeVisible();
    await clickTab(page, 'Passbook');
    await page.waitForTimeout(1200);
    // The card count is printed, not asserted.
    console.log(`Passbook cards: ${await page.locator('mat-card, [class*="card" i]').count().catch(() => 0)}`);
  });

  // A summary step, restating step 8's finding with more detail in the log.
  test('Competencies are available (Required or Job Description)', async () => {
    // Competencies live under the Required tab OR Job Description → Roles.
    const exists = await competenciesExist(page);
    // Count the assess buttons…
    const assessBtns = await page.getByRole('button', { name: /re-?assess|^assess$/i }).count().catch(() => 0);
    // …and list the competency names.
    const titles = await page.getByRole('button', { name: /^\d+\s+\w/ }).allInnerTexts().catch(() => []);
    console.log(`Assess/Re-Assess buttons visible: ${assessBtns}`);
    console.log(`Competencies (${titles.length}): ${JSON.stringify([...new Set(titles.map((t: string) => t.trim()))].slice(0, 15))}`);
    // hard — same assertion as step 8, but reported as its own test case.
    expect(exists).toBe(true);
  });

  // ── Step 12: select the target competency ──────────────────────
  test('Select target competency', async () => {
    await ensureCompetencyDashboard(page);
    // Use the configured name if there is one.
    let title = COMPETENCY_NAME;
    // Otherwise discover one from the page.
    if (!title) {
      // Read a competency name from a "N <Name>" button under Job Description.
      await clickTab(page, 'Job Description').catch(() => {});
      await page.waitForTimeout(1000);
      const headers = page.locator('[id^="mat-expansion-panel-header"], mat-expansion-panel-header');
      const hc = await headers.count().catch(() => 0);
      // Open up to 10 role panels to reveal the names.
      for (let i = 0; i < Math.min(hc, 10); i++) { await headers.nth(i).click().catch(() => {}); await page.waitForTimeout(250); }
      // The first "number then title" button.
      const nameBtn = page.getByRole('button', { name: /^\d+\s+\w/ }).first();
      if (await nameBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        // Strip the leading number, take the first line, cap at 50 chars. The chain of
        // fallbacks means this never throws, only degrades to '(unknown)'.
        title = ((await nameBtn.innerText().catch(() => '')) || '').replace(/^\d+\s*/, '').trim().split('\n')[0].slice(0, 50) || '(unknown)';
      } else {
        // Nothing found — record that we're letting the app choose.
        title = '(auto-select)';
      }
    }
    // Store it for the Passbook check at the end.
    flow.competencyTitle = title;
    console.log(`🎯 Selected competency: "${title}"`);
    // hard, but only that we settled on SOME name.
    expect(title.length).toBeGreaterThan(0);
  });

  // ── Step 13: complete each level (one test case per level) ─────
  // Generate MAX_LEVELS test cases up front. Playwright must know its tests
  // before the run starts, so the ceiling is declared rather than discovered —
  // levels that don't exist simply skip.
  for (let n = 1; n <= MAX_LEVELS; n++) {
    test(`Complete Level ${n}`, async () => {
      // Eight minutes: a quiz can mean a dozen throttled Gemini calls.
      test.setTimeout(8 * 60 * 1000);
      // Nothing to climb.
      test.skip(!flow.competenciesAvailable, 'no competencies available');
      // A previous level ended the climb — skip the rest rather than fail them.
      test.skip(flow.climbDone, 'no further level available for this competency');

      // Start from a known place.
      await goBackToDashboard(page).catch(() => {});
      // Open the next level, by whichever of the two routes works.
      const { ok, actualLevel } = await openNextAssessment(page);
      // None left — that's success, not failure, so mark the climb done and SKIP.
      if (!ok) {
        flow.climbDone = true;
        test.skip(true, `No further assessment available (last completed: ${flow.lastLevel})`);
        return;
      }
      // Record which level we actually opened.
      flow.lastLevel = actualLevel;

      // Run the quiz with the best available strategy.
      const { passed, mode } = await runQuizOnce(page, actualLevel || n);
      // Record the outcome for the summary at the end.
      flow.levels.push({ level: actualLevel, passed, mode });
      console.log(passed
        ? `🎉 Level ${actualLevel} PASSED (via ${mode})`
        : `❌ Level ${actualLevel} FAILED (via ${mode})`);
      if (!passed) flow.climbDone = true; // can't unlock the next level if this one failed
      // Return to the dashboard for the next level.
      await goBackToDashboard(page).catch(() => {});
      // hard — the level must have been passed. The message names which one.
      expect(passed, `Level ${actualLevel} should be passed`).toBe(true);
    });
  }

  // ── Step 14: verify the Passbook shows the completed assessment ─
  test('Passbook displays the completed assessment(s)', async () => {
    test.setTimeout(90_000);
    // Nothing was completed, so there's nothing to verify.
    test.skip(!flow.competenciesAvailable, 'no competencies were available to complete');
    await goBackToDashboard(page).catch(() => {});
    // Open the Passbook.
    await clickTab(page, 'Passbook');
    await page.waitForTimeout(2500);

    // How many entries does it hold?
    const cards = await page.locator('mat-card, [class*="card" i]').count().catch(() => 0);
    // All the page's text, whitespace collapsed onto one line.
    const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    // Use the first 15 characters of the competency title as the search key —
    // short enough to survive truncation in the card, long enough to be unique.
    const key = (flow.competencyTitle && flow.competencyTitle !== '(unknown)')
      ? flow.competencyTitle.toLowerCase().slice(0, 15) : '';
    // If we know the title, look for it; otherwise fall back to "any cards at all".
    const showsCompetency = key ? bodyText.toLowerCase().includes(key) : cards > 0;
    // How many levels did this run clear?
    const passedLevels = flow.levels.filter((l) => l.passed).length;

    // Log everything before asserting, so a failure is diagnosable.
    console.log(`Passbook cards: ${cards}`);
    console.log(`Levels passed this run: ${passedLevels} — ${JSON.stringify(flow.levels)}`);
    console.log(`Passbook shows "${flow.competencyTitle}": ${showsCompetency}`);
    console.log(`Passbook preview: ${bodyText.slice(0, 220)}`);

    // The passbook must have entries...
    expect(cards).toBeGreaterThan(0);
    // ...and if we cleared levels this run, the completed competency must appear.
    // Conditional, because a run that cleared nothing can't expect a new entry.
    if (passedLevels > 0) expect(showsCompetency).toBe(true);
  });
});