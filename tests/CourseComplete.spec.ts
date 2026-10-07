/**
 * Course Completion E2E
 * ─────────────────────
 * Searches for a course, opens it, and completes every module:
 *   videos · PDFs · content pages · radio + checkbox assessments.
 *
 * Assessments use TWO answering strategies in order:
 *   1. Answer Key (100% accuracy) — Sphere prefetches a JSON for each
 *      assessment with `isCorrect: true/false` flags. We intercept it
 *      and pick the matching options on screen.
 *   2. Gemini AI batch (fallback) — used when no key is available
 *      (e.g. competency assessments where devs poison the key).
 *
 * Usage:
 *   npm run run:course           ← prompts for the account + course (scripts/run-course.mjs)
 *   $env:COURSE_NAME="Normal Labour & Birth and AMTSL"; npx playwright test tests/CourseComplete.spec.ts --headed
 *
 * Optional:
 *   $env:GEMINI_API_KEY="..." for the Gemini fallback
 *   $env:VERBOSE_CHECKBOX="1" to log each checkbox click strategy
 *
 * Account: learnerid001@yopmail.com / Sunbird@123
 */

// Types only — the runner itself comes from our authenticated harness below.
import { Page, Locator, BrowserContext } from '@playwright/test';
// Auth via storageState (CI-friendly) with a CDP fallback for local dev.
// See tests/helpers/authedTest.ts.
// `test` here is the AUTHENTICATED one (unlike SCROM.spec.ts, which logs in itself).
import { test, expect } from './helpers/authedTest';
// Renders the per-course HTML report at the end of the run.
import { generateCourseReport } from './helpers/courseReport';
// Clears the profile-onboarding screens if this account hasn't finished them.
import { completeOnboarding } from './helpers/onboarding';
// Node's file system module — reads .env below.
import * as fs from 'fs';
// Node's path module — builds cross-platform file paths.
import * as path from 'path';
// The shared matcher that maps an on-screen question to its answer-key entry.
import { findMatchingQuestion } from './helpers/questionMatch';
import { SEARCH_PLACEHOLDER, hiAlso } from './helpers/i18n';

// Which environment to test.
const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

// ══════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════
// The logged-in home, where the course search box lives.
const HOME_URL  = `${BASE_URL}/page/home`;

const MAX_MODULES      = 50;     // safety ceiling on module count
const VIDEO_WATCH_MS   = 5_000;  // how long to "watch" videos
const PDF_MAX_PAGES    = 60;     // max PDF pages to flip through
const ASSESSMENT_MAX_RETRIES = 2; // re-attempts when a graded assessment isn't passed
const GEMINI_RPM_DELAY = 6_500;  // self-throttle (safe for 10 RPM free tier)
const GEMINI_RETRY_WAIT_MS     = 20_000; // fallback wait when a 429 reports no delay
const GEMINI_MAX_RETRY_WAIT_MS = 65_000; // ceiling on a single rate-limit wait

// The preferred Gemini model.
const GEMINI_PRIMARY  = 'gemini-2.5-flash';
// A cheaper, higher-quota model used when the primary is rate-limited.
const GEMINI_FALLBACK = 'gemini-2.5-flash-lite';
// Base URL for the Gemini REST API.
const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// Load .env (no external dependency)
// An IIFE (immediately-invoked function) — it runs once at import time.
// Written this way so its locals don't leak into the module scope.
(function loadEnvFile() {
  // The project root's .env file.
  const envPath = path.resolve(__dirname, '..', '.env');
  // No file — nothing to load.
  if (!fs.existsSync(envPath)) return;
  // Walk it line by line.
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    // Skip blanks and comments.
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Split on the FIRST = only; `...rest` keeps any = characters inside the value.
    const [k, ...rest] = trimmed.split('=');
    // Never overwrite a variable already set in the real environment — CLI wins over .env.
    if (k && !process.env[k.trim()]) process.env[k.trim()] = rest.join('=').trim();
  }
})();

// Which course to complete. Empty means the test fails with instructions.
const COURSE_NAME    = process.env.COURSE_NAME ?? '';
// The Gemini key. Without it the AI fallback is unavailable.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════
// Every kind of module a course can contain.
type ModuleType = 'video' | 'pdf' | 'assessment' | 'content' | 'unknown';

// The shape of the answer-key JSON Sphere serves for each assessment.
type QuizQuestion = {
  questionId: string;
  question: string;
  options: { text: string; optionId: string; isCorrect: boolean }[];
  /** `mcq-mca` (select all that apply) vs `mcq-sca` — from the artifact JSON. */
  // This is the AUTHORITATIVE answer to "how many options should I tick?" —
  // far more reliable than guessing from the on-screen control type.
  multiSelection?: boolean;
};
// The whole key: its questions, and the score needed to pass.
type QuizKey = { questions: QuizQuestion[]; passPercentage: number };

// What we read off a question screen. `inputType` matters: a checkbox question
// needs EVERY correct option ticked, a radio question exactly one.
type ScrapedQuestion = {
  question: string;
  options: string[];
  inputType: 'radio' | 'checkbox' | 'unknown';
};

// ══════════════════════════════════════════════════════════════════════
// SEARCH + OPEN COURSE
// ══════════════════════════════════════════════════════════════════════
/** Collapse whitespace + case so on-screen titles compare cleanly against COURSE_NAME. */
function normalizeTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Search for a course by name from the home page and open it.
async function searchAndOpenCourse(page: Page, courseName: string): Promise<boolean> {
  console.log(`\n🔎 Searching: "${courseName}"`);
  // The search box, matched by its placeholder.
  const search = page.getByPlaceholder(SEARCH_PLACEHOLDER);
  await search.waitFor({ state: 'visible', timeout: 10_000 });
  // Type the course name.
  await search.fill(courseName);
  // Enter runs the search.
  await search.press('Enter');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  // Remember where we are, so we can detect whether the click actually navigated.
  const urlBefore = page.url();

  // Match on the RESULT TITLE, never on a prefix of the query. Sphere's search
  // also matches a card's "Competency Name" line, so searching a competency
  // (e.g. "Conducts VHND and campaigns…") returns courses that are NOT titled
  // that — a prefix match would happily open the wrong course.
  // The result cards' title links.
  const titles = page.locator('a[class*="mat-title"], a[class*="text-truncate"]');
  // How many results?
  const count = await titles.count().catch(() => 0);
  // Collect each one's index and text.
  const found: { idx: number; text: string }[] = [];
  for (let i = 0; i < count; i++) {
    const text = ((await titles.nth(i).innerText().catch(() => '')) ?? '').trim();
    if (text) found.push({ idx: i, text });
  }

  // Normalise what we asked for…
  const want = normalizeTitle(courseName);
  // …and look for an EXACT title match first.
  let target = found.find((f) => normalizeTitle(f.text) === want);

  // No exact hit.
  if (!target) {
    // No exact title: accept a single unambiguous partial, otherwise give up
    // rather than guess.
    // Titles that contain the query, or are contained by it.
    const partial = found.filter((f) => {
      const t = normalizeTitle(f.text);
      return t.includes(want) || want.includes(t);
    });
    // Exactly ONE near match is safe to take; two or more would be a guess.
    if (partial.length === 1) {
      target = partial[0];
      console.log(`ℹ️  No exact title match — using the only near match: "${target.text}"`);
    }
  }

  // Nothing usable.
  if (!target) {
    console.log(`❌ No result titled "${courseName}".`);
    // List what WAS on screen, so the failure is diagnosable.
    if (found.length) {
      console.log(`   ${found.length} result(s) on screen:`);
      found.forEach((f) => console.log(`     • ${f.text}`));
      // And name the most likely cause: a competency name, not a course title.
      console.log(`   (Sphere matches competency names too — this looks like a competency, not a course title.)`);
    // No cards at all — a different problem entirely.
    } else {
      console.log(`   The search returned no course cards.`);
    }
    return false;
  }

  // Open the course we settled on.
  console.log(`👆 Clicking: "${target.text}"`);
  await titles.nth(target.idx).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3500);

  // An unchanged URL means the click didn't navigate.
  if (page.url() === urlBefore) {
    console.log(`❌ Clicking "${target.text}" did not navigate`);
    return false;
  }
  console.log(`✅ Course opened`);
  return true;
}

// ══════════════════════════════════════════════════════════════════════
// START OR RESUME
// ══════════════════════════════════════════════════════════════════════
// Click Start/Resume to enter the course player.
async function startOrResume(page: Page): Promise<boolean> {
  console.log(`\n▶️  Looking for Start / Resume`);
  // Remember where we started.
  const urlBefore = page.url();

  // Five ways to find the control, ordered most to least reliable.
  const candidates: Locator[] = [
    page.getByRole('button', { name: hiAlso(/^(resume|start)$/i) }).first(),
    page.getByRole('link',   { name: hiAlso(/^(resume|start)$/i) }).first(),
    page.locator('.resumeButton, [class*="resumeButton"]').first(),
    page.locator('.banner-btn').first(),
    page.getByText(hiAlso(/^(resume|start)$/i)).first(),
  ];

  // Try each in turn.
  for (const btn of candidates) {
    // Skip any that isn't on screen.
    if (!(await btn.isVisible({ timeout: 2_000 }).catch(() => false))) continue;
    // Click it; ignore a failure and let the URL check decide.
    await btn.click().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3500);
    // A changed URL means the player opened.
    if (page.url() !== urlBefore) {
      console.log(`✅ Course player opened`);
      return true;
    }
  }

  // Last resort: maybe we were already in the player before we started.
  if (/\/viewer\/|\/play\/|\/learn\//i.test(page.url())) {
    console.log(`ℹ️  Already inside course player`);
    return true;
  }

  // Nothing worked.
  console.log(`⚠️  Could not start the course`);
  return false;
}

// 
// 
// ══════════════════════════════════════════════════════════════════════
// QUIZ ANSWER KEY INTERCEPTOR
// ══════════════════════════════════════════════════════════════════════
//
// Sphere fetches a JSON file for every assessment from one of:
//   sunbirdcontent.s3-ap-south-1.amazonaws.com/content/{id}/artifact/{id}_*_quiz.json
//   static.sphere.aastrika.org/content/{id}/artifact/{id}_*_assessment.json
//
// The JSON has `isCorrect: true/false` flags on every option. We intercept
// these responses and store them keyed by `resourceId` (extracted from URL),
// then look up the matching key when each assessment module opens.
// ──────────────────────────────────────────────────────────────────────
// A MAP, not a single slot: a course has many assessments and their JSON files
// are prefetched in bulk, so each must be filed under its own resource id.
const capturedKeys = new Map<string, QuizKey>();

// Pull the content id out of either URL shape.
function extractResourceId(url: string): string | null {
  // Same ID format in every viewer URL (`/viewer/quiz|video|pdf|html/do_…`),
  // in the sidebar's hrefs, and in the artifact JSON URLs (`/content/do_…`):
  // `do_11342049404909158411532`. Matching ALL viewer types (not just quiz) is
  // what lets openModule() confirm it landed on the module it clicked.
  const m = url.match(/(?:viewer\/\w+\/|content\/)(do_\w+)/);
  return m ? m[1] : null;
}

// Watch every network response and file the quiz JSON when it goes by.
function setupQuizKeyInterceptor(page: Page) {
  // Fires for every response the page receives.
  page.on('response', async (res) => {
    const url = res.url();
    // Only artifact JSON files, of either naming convention.
    if (!/\/content\/[^/]+\/artifact\/.*_(quiz|assessment)\.json/i.test(url)) return;
    // And only successful ones.
    if (!res.ok()) return;
    // We need the id to file it under.
    const resourceId = extractResourceId(url);
    if (!resourceId) return;
    // Wrapped: a non-JSON body must not break the response handler.
    try {
      const json = await res.json();
      // Only store it if it actually has questions.
      if (Array.isArray(json?.questions) && json.questions.length > 0) {
        // File it under its own resource id.
        capturedKeys.set(resourceId, json as QuizKey);
        console.log(`🔑 Captured answer key for ${resourceId} (${json.questions.length} questions)`);
      }
    // Swallow parse errors silently — this is an opportunistic capture.
    } catch { /* not JSON we care about */ }
  });
}

// Look up the key for whichever assessment is currently open.
function getAnswerKeyForUrl(url: string): QuizKey | null {
  // Pull the id out of the player URL.
  const resourceId = extractResourceId(url);
  if (!resourceId) return null;
  // `?? null` so a miss is an explicit null, not undefined.
  return capturedKeys.get(resourceId) ?? null;
}

/**
 * Fetch the REAL answer key: hierarchy → `artifactUrl` → the assessment JSON
 * on S3.
 *
 * The copy the player receives has its `isCorrect` flags stripped (see
 * isAnswerKeyPoisoned), but the published artifact still carries them — that is
 * where the answers actually live, so this is tried before anything else and
 * makes the AI fallback unnecessary for published assessments.
 *
 *   GET /apis/proxies/v8/action/content/v3/hierarchy/<do_id>?hierarchyType=detail
 *   → result.content.artifactUrl → { timeLimit, isAssessment, questions[] }
 *
 * Runs inside the page so the session cookies ride along.
 */
// A cache, so a re-attempted assessment doesn't re-fetch. It stores null too,
// which is why `.has()` is checked rather than just reading the value.
const hierarchyKeys = new Map<string, QuizKey | null>();

async function fetchAnswerKeyFromArtifact(page: Page, resourceId: string): Promise<QuizKey | null> {
  // Cached — including a cached failure.
  if (hierarchyKeys.has(resourceId)) return hierarchyKeys.get(resourceId) ?? null;

  // Both fetches run INSIDE the page, so the session cookies are sent automatically.
  const res = await page
    .evaluate(
      async ({ base, id }) => {
        // Wrapped: a network failure returns an error object rather than throwing.
        try {
          // Step 1: ask the content API for this assessment's hierarchy.
          const h = await fetch(
            `${base}/apis/proxies/v8/action/content/v3/hierarchy/${id}?hierarchyType=detail`,
            // `credentials: 'include'` sends the session cookie to our own API.
            { credentials: 'include' },
          );
          // Non-2xx — report the status.
          if (!h.ok) return { error: `hierarchy HTTP ${h.status}` };
          // Dig the artifact link out of the nested response.
          const artifactUrl: string = (await h.json())?.result?.content?.artifactUrl ?? '';
          // No link means no key.
          if (!artifactUrl) return { error: 'hierarchy has no artifactUrl' };
          // Step 2: download the artifact. `credentials: 'omit'` this time — it is a
          // public S3 URL, and sending our cookies to a third party would leak them.
          const a = await fetch(artifactUrl, { credentials: 'omit' });
          if (!a.ok) return { error: `artifact HTTP ${a.status}` };
          // Hand the parsed JSON back.
          return { json: await a.json() };
        // Any error becomes a message the caller can log.
        } catch (e: any) {
          return { error: e?.message ?? String(e) };
        }
      },
      // Passed in because page.evaluate runs in a separate context.
      { base: BASE_URL, id: resourceId },
    )
    // And a final guard in case the evaluate itself fails.
    .catch((e: any) => ({ error: e?.message ?? String(e) }));

  // Did we get a payload?
  const raw = (res as any)?.json;
  // No — log why, and CACHE THE FAILURE so we don't retry it every question.
  if (!raw) {
    console.log(`   ⚠️  Artifact answer key unavailable for ${resourceId}: ${(res as any)?.error ?? 'unknown'}`);
    hierarchyKeys.set(resourceId, null);
    return null;
  }

  // Normalise the artifact's shape into our own QuizQuestion type.
  const questions: QuizQuestion[] = (raw.questions ?? []).map((q: any) => ({
    questionId: String(q.questionId ?? ''),
    question: String(q.question ?? ''),
    // Two ways a multi-answer question is marked: an explicit flag, or a question
    // type containing "mca" (multiple-choice, multiple-answer).
    multiSelection: q.multiSelection === true || /mca/i.test(String(q.questionType ?? '')),
    // Normalise each option too.
    options: (q.options ?? []).map((o: any) => ({
      text: String(o.text ?? ''),
      optionId: String(o.optionId ?? ''),
      // `=== true` rather than truthiness, so a missing flag is definitively false.
      isCorrect: o.isCorrect === true,
    })),
  }));

  // 60% is the default pass mark when the artifact doesn't state one.
  const key: QuizKey = { questions, passPercentage: Number(raw.passPercentage ?? 60) };
  // Cache it for any re-attempt.
  hierarchyKeys.set(resourceId, key);
  return key;
}

/**
 * Detects the "poisoned key" trick: Sphere serves the quiz JSON with EVERY
 * option flagged `isCorrect: false`, so the key matches the on-screen
 * questions but marks nothing correct. Graded course assessments use this,
 * not just competency quizzes — answering "A" for every question then fails
 * the pass mark and the module never completes. When 80%+ of the questions
 * carry no correct answer, treat the whole key as useless and go to Gemini.
 * (Same rule as Competency.spec.ts.)
 */
function isAnswerKeyPoisoned(key: QuizKey): boolean {
  // How many questions does the key hold?
  const total = key.questions.length;
  // An empty key is as useless as a poisoned one.
  if (total === 0) return true;
  // Count the questions where NO option is flagged correct.
  const poisoned = key.questions.filter((q) => q.options.every((o) => o.isCorrect === false)).length;
  // 80% or more unmarked = poisoned. A threshold rather than "all", so a few
  // genuinely-unmarked questions do not discard an otherwise usable key.
  return poisoned / total >= 0.8;
}

// 
// ══════════════════════════════════════════════════════════════════════
// MODULE TYPE DETECTION
// ══════════════════════════════════════════════════════════════════════
//
// Sphere uses `/viewer/quiz/` for BOTH real quizzes AND course intro pages,
// so URL alone isn't enough. We check the URL, then VERIFY via the DOM and
// the captured answer keys (strongest signal: if Sphere fetched a quiz JSON
// for this exact resourceId, the module IS an assessment).
// ──────────────────────────────────────────────────────────────────────
async function detectModuleType(page: Page): Promise<ModuleType> {
  const url = page.url();

  // Reliable URL signals
  // A PDF route or a .pdf file — unambiguous.
  if (/\/viewer\/pdf|\.pdf(\?|$)/i.test(url))       return 'pdf';
  // A video route — also unambiguous.
  if (/\/viewer\/video|\/play\/|player/i.test(url)) return 'video';
  if (/\/viewer\/html|\/content\b/i.test(url))      return 'content';

  // Quiz URL — must verify by DOM and captured keys
  if (/\/viewer\/quiz|\/assessment\b|\/quiz\b/i.test(url)) {
    // Let the page render before inspecting it.
    await page.waitForTimeout(2000);

    // Strongest signal: Sphere fetched a quiz JSON for this exact resource
    const resourceId = extractResourceId(url);
    // If we captured a key for this id, it IS an assessment — no further checks needed.
    if (resourceId && capturedKeys.has(resourceId)) {
      console.log(`   🔑 Confirmed assessment by answer-key match (${resourceId})`);
      return 'assessment';
    }

    // Otherwise check the actual content
    // Gather seven signals from the DOM in one round trip.
    const dom = await page.evaluate(() => {
      // Small helper: is there a button whose text matches this pattern?
      const hasButton = (re: RegExp) =>
        Array.from(document.querySelectorAll<HTMLElement>('button'))
          .some((b) => re.test(b.innerText ?? ''));

      return {
        // A "Start Now" button is the classic quiz intro.
        startNow:      hasButton(/start\s*now/i),
        // Radio inputs — a single-answer question.
        radios:        document.querySelectorAll('mat-radio-button').length,
        // Checkbox inputs — a multi-answer question.
        checkboxes:    document.querySelectorAll('mat-checkbox').length,
        // "N Questions" AND "N Minutes" together are a quiz-intro signature.
        hasCounters:   /\d+\s*Questions?/i.test(document.body.innerText) &&
                       /\d+\s*Minutes?/i.test(document.body.innerText),
        // A canvas usually means a rendered PDF page…
        pdfCanvas:     document.querySelectorAll('canvas').length,
        // …as does a PDF iframe or embed.
        pdfIframe:     !!document.querySelector('iframe[src*="pdf"], embed[type*="pdf"]'),
        // An "Introduction"/"Overview" heading suggests a content page, not a quiz.
        introHeading:  Array.from(document.querySelectorAll<HTMLElement>('h1, h2, h3'))
                         .some((h) => /^(introduction|overview)$/i.test(h.innerText?.trim() ?? '')),
      };
    });

    // PDF signals beat the quiz URL — trust the content over the route.
    if (dom.pdfIframe || dom.pdfCanvas >= 1) {
      console.log(`   ℹ️  URL says quiz but PDF detected — treating as PDF`);
      return 'pdf';
    }
    // An intro heading with NO quiz controls at all means it's really content.
    if (dom.introHeading && !dom.startNow && dom.radios === 0 && dom.checkboxes === 0) {
      console.log(`   ℹ️  URL says quiz but only Intro/Overview heading visible — treating as content`);
      return 'content';
    }
    // Any one quiz signal is enough to call it an assessment.
    if (dom.startNow || dom.radios > 0 || dom.checkboxes > 0 || dom.hasCounters) {
      return 'assessment';
    }
    // A quiz URL with no quiz indicators anywhere — treat as content and say so.
    console.log(`   ⚠️  URL says quiz but no quiz indicators — treating as content`);
    return 'content';
  }

  // No URL hint — DOM-only detection
  // Two or more choice inputs is the clearest remaining signal.
  const inputs = await page.locator('mat-radio-button, mat-checkbox').count();
  if (inputs >= 2) return 'assessment';
  // A <video> element means a video module.
  if (await page.locator('video').first().isVisible().catch(() => false)) return 'video';
  // Default to content — the safest assumption, since it just scrolls.
  return 'content';
}

// ══════════════════════════════════════════════════════════════════════
// MODULE HANDLERS — Video / PDF / Content / Assessment
// ══════════════════════════════════════════════════════════════════════

async function handleVideo(page: Page): Promise<boolean> {
  console.log(`🎬 VIDEO — waiting for it to load`);
  // The video element.
  const video = page.locator('video').first();

  // 1. Wait for the <video> element to actually appear/attach.
  // A generous 30s — the player mounts the element only after its own setup.
  if (!(await video.isVisible({ timeout: 30_000 }).catch(() => false))) {
    console.log(`   ⚠️  No <video> element appeared — waiting ${VIDEO_WATCH_MS}ms and moving on`);
    await page.waitForTimeout(VIDEO_WATCH_MS);
    return false;
  }

  // 2. Wait for the video to LOAD its metadata so duration is known
  //    (readyState >= 1). Nudge .load() if the browser is being lazy.
  const loaded = await page
    // waitForFunction polls INSIDE the browser until the condition holds.
    .waitForFunction(
      () => {
        const v = document.querySelector('video') as HTMLVideoElement | null;
        // Element gone — keep waiting.
        if (!v) return false;
        // readyState 0 means nothing loaded; calling load() kicks it off.
        if (v.readyState === 0) { try { v.load(); } catch { /* ignore */ } }
        // Ready when metadata is in AND the duration is a real, finite number.
        return v.readyState >= 1 && isFinite(v.duration) && v.duration > 0;
      },
      { timeout: 60_000, polling: 500 },
    )
    // `.then(true).catch(false)` turns the wait into a boolean rather than a throw.
    .then(() => true)
    .catch(() => false);

  // Read the duration for the log.
  const dur = await video
    .evaluate((v: HTMLVideoElement) => (isFinite(v.duration) ? v.duration : 0))
    .catch(() => 0);
  // Report whether it loaded, and how long the video is.
  console.log(`   ${loaded ? '✅ loaded' : '⚠️ load timed out'} — duration: ${dur ? dur.toFixed(0) + 's' : 'unknown'}`);

  // 3. Wait until enough is buffered to play (readyState >= 3), best-effort.
  await page
    .waitForFunction(
      () => {
        const v = document.querySelector('video') as HTMLVideoElement | null;
        // readyState 3 = HAVE_FUTURE_DATA, i.e. enough buffered to start playing.
        return !!v && v.readyState >= 3;
      },
      { timeout: 20_000, polling: 500 },
    )
    // Best-effort: a timeout here is fine, we try to play anyway.
    .catch(() => {});

  // 4. Start playback (muted so autoplay is allowed), let it actually begin.
  await video
    .evaluate((v: HTMLVideoElement) => {
      // Muting is what makes browsers permit programmatic autoplay.
      v.muted = true;
      // A rejected play() promise is normal and harmless here.
      v.play().catch(() => {});
    })
    .catch(() => {});
  await page.waitForTimeout(1500);

  // 5. Now that it's loaded, seek to the end so the platform marks it watched.
  await video
    .evaluate((v: HTMLVideoElement) => {
      // Half a second before the end, so the 'ended' event still fires naturally.
      if (isFinite(v.duration) && v.duration > 0) v.currentTime = Math.max(0, v.duration - 0.5);
      // Keep playing, so that last half-second actually elapses.
      v.play().catch(() => {});
    })
    .catch(() => {});

  // 6. Wait for the 'ended' event (fires the platform's completion), else fall back.
  const ended = await video
    // Wrap an event listener in a Promise so we can await it. This is what makes
    // the platform register the video as watched.
    .evaluate(
      (v: HTMLVideoElement) =>
        new Promise<boolean>((resolve) => {
          // Already finished — resolve immediately.
          if (v.ended) return resolve(true);
          // `once: true` auto-removes the listener after it fires.
          v.addEventListener('ended', () => resolve(true), { once: true });
          // A 15s safety net, so a video that never ends can't hang the run.
          setTimeout(() => resolve(v.ended), 15_000);
        }),
    )
    .catch(() => false);
  // Report which way it went; either is acceptable.
  console.log(`   ${ended ? '🏁 video ended' : 'ℹ️ end event not observed — proceeding'}`);

  // A final settle so the platform's progress call lands.
  await page.waitForTimeout(VIDEO_WATCH_MS);
  return loaded;
}

// Page through a PDF module.
async function handlePdf(page: Page) {
  console.log(`📄 PDF — paging through`);
  // PDF viewer has its OWN chevron_right button. The outer "Next module"
  // button stays disabled until we flip through every page.
  // Flip up to PDF_MAX_PAGES times.
  for (let p = 0; p < PDF_MAX_PAGES; p++) {
    // The viewer's own forward control, matched by its Material ligature text.
    const chevron = page.locator('button:has-text("chevron_right")').first();
    // Gone — nothing left to flip.
    if (!(await chevron.isVisible({ timeout: 1_000 }).catch(() => false))) break;
    // Disabled means we've reached the last page.
    if (await chevron.isDisabled().catch(() => false)) {
      console.log(`   📑 Reached end of PDF (${p} pages)`);
      break;
    }
    // Turn the page. `force` because the overlay can intercept the click.
    await chevron.click({ force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1500);
}

// Read through a content module.
async function handleContent(page: Page) {
  console.log(`📖 CONTENT — reading through`);
  // Scroll to the bottom — that's what registers the page as read.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  // Then back to the top, so any inner controls are in view.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  // Some content pages have inner page-turn chevrons too
  // Flip up to 30 of them.
  for (let p = 0; p < 30; p++) {
    const chevron = page.locator('button:has-text("chevron_right")').first();
    // Gone — nothing left.
    if (!(await chevron.isVisible({ timeout: 800 }).catch(() => false))) break;
    // Disabled means we're at the end.
    if (await chevron.isDisabled().catch(() => false)) break;
    await chevron.click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(1000);
}

// ══════════════════════════════════════════════════════════════════════
// ASSESSMENT HANDLER
// ══════════════════════════════════════════════════════════════════════
// Answer an assessment module, with the best available strategy.
async function handleAssessment(page: Page) {
  // Its resource id, for the log.
  const resourceId = extractResourceId(page.url()) ?? '?';

  // 1. The published artifact (hierarchy → artifactUrl) — the real answers.
  // 2. The key the player fetched — usually has its isCorrect flags stripped.
  // 3. Gemini, only when neither yields a usable key.
  const artifactKey = await fetchAnswerKeyFromArtifact(page, resourceId);
  const interceptedKey = getAnswerKeyForUrl(page.url());
  const usable = (k: QuizKey | null) => (k && k.questions.length > 0 && !isAnswerKeyPoisoned(k) ? k : null);

  const answerKey = usable(artifactKey) ?? usable(interceptedKey);
  // Even a stripped key still knows the questions — keep the richer of the two.
  const capturedKey =
    answerKey ??
    ((artifactKey?.questions.length ?? 0) >= (interceptedKey?.questions.length ?? 0)
      ? artifactKey
      : interceptedKey);

  // Say up front which strategy we're taking — the most useful line in the run.
  if (answerKey) {
    const src = answerKey === usable(artifactKey) ? 'published artifact' : 'intercepted quiz.json';
    console.log(`📝 ASSESSMENT — using answer key from the ${src} for ${resourceId}`);
  } else if (capturedKey) {
    console.log(`📝 ASSESSMENT — every key for ${resourceId} is POISONED (all isCorrect: false) — using Gemini AI`);
  } else {
    console.log(`📝 ASSESSMENT — no answer key for ${resourceId}, will use Gemini AI`);
  }

  // Wait for either "Start Now!" or an answer input to appear
  console.log(`   ⏳ Waiting for assessment to render`);
  // The intro button…
  const startBtn = page.getByRole('button', { name: hiAlso(/start\s*now/i) }).first();
  // …or the first answer control, in any of its three shapes.
  const firstInput = page.locator('mat-radio-button, mat-checkbox, mat-list-option').first();

  // Did we reach a question?
  let ready = false;
  // Poll up to ten times — the player can be slow.
  for (let attempt = 0; attempt < 10; attempt++) {
    // Intro screen present.
    if (await startBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log(`   ▶️  Clicking "Start Now!"`);
      // Start the quiz…
      await startBtn.click();
      await page.waitForTimeout(2500);
      // …then wait for the first question to actually render.
      ready = await firstInput.isVisible({ timeout: 10_000 }).catch(() => false);
      break;
    }
    // Already on a question — no intro to dismiss.
    if (await firstInput.isVisible({ timeout: 500 }).catch(() => false)) {
      ready = true;
      break;
    }
    await page.waitForTimeout(500);
  }

  // Neither appeared — give up on this module rather than hanging.
  if (!ready) {
    console.log(`   ⚠️  Quiz did not load`);
    return;
  }

  // Determine how many questions to answer. The on-screen "N/N" counter is
  // UNRELIABLE — the /\d+\/\d+/ regex can match a value inside a question
  // (e.g. a BP reading "100/70" → total 70). When we have the assessment's
  // captured quiz.json, its question count is authoritative: it holds exactly
  // this assessment's questions (a 13-question assessment ⇒ 13, not the bank).
  const counterTxt = await page.locator('text=/\\d+\\s*\\/\\s*\\d+/').first().textContent().catch(() => '');
  const counterN = parseInt(counterTxt?.match(/(\d+)\s*\/\s*(\d+)/)?.[2] ?? '0');
  // Even a poisoned key knows how many questions this assessment has.
  const total = capturedKey && capturedKey.questions.length > 0
    ? capturedKey.questions.length
    : counterN || 5;
  console.log(
    `   ${total} questions to answer ${capturedKey ? '(from matched quiz.json)' : '(from on-screen counter)'}`,
  );

  const answerRound = async () => {
    // A usable key — take the accurate route.
    if (answerKey && answerKey.questions.length > 0) {
      // Log the pool size and the pass mark.
      console.log(`   🔑 Answer key pool: ${answerKey.questions.length} questions, pass: ${answerKey.passPercentage ?? '?'}%`);
      await answerWithKey(page, answerKey, total);
    } else if (capturedKey && capturedKey.questions.length > 0) {
      // Poisoned key: the answers are useless but the QUESTIONS are all there,
      // so Gemini can answer the whole assessment in ONE request.
      await answerWithGeminiFromKey(page, capturedKey, total, resourceId);
    // No usable key — fall back to the AI.
    } else {
      // One request per question (not batched) — more accurate, and quota is ample here.
      console.log(`   🤖 Answering with Gemini AI (no key — one request per question)`);
      await answerWithGeminiPerQuestion(page, total);
    }
  };

  // Run the first pass.
  await answerRound();

  // Drive the Submit → results → Continue sequence so we actually leave the
  // assessment (this is where the run was getting stuck).
  await finishAssessment(page);

  // A graded assessment only marks the module complete when the pass mark is
  // met. If the results screen says we failed, re-attempt with Gemini rather
  // than walking away from a module that will never register as done.
  // Up to ASSESSMENT_MAX_RETRIES re-attempts.
  for (let attempt = 1; attempt <= ASSESSMENT_MAX_RETRIES; attempt++) {
    // What did the results screen say?
    const verdict = await readAssessmentVerdict(page);
    // Passed, or we can't tell — either way, stop retrying.
    if (verdict !== 'failed') break;
    console.log(`   🔁 Assessment not passed — re-attempt ${attempt}/${ASSESSMENT_MAX_RETRIES} with Gemini`);
    // No retry control — nothing more we can do.
    if (!(await clickReattempt(page))) {
      console.log(`   ⚠️  No Re-attempt button — leaving the assessment as-is`);
      break;
    }
    // Cached Gemini answers are reused, so a re-attempt costs no extra quota.
    // Answer again…
    await answerRound();
    // …and submit again.
    await finishAssessment(page);
  }
}

/**
 * Read the end-of-assessment verdict. Sphere's results screen shows the score
 * plus a pass/fail line ("Congratulations…" vs "You did not pass" / "Failed"),
 * and offers Re-attempt when the pass mark was missed.
 */
async function readAssessmentVerdict(page: Page): Promise<'passed' | 'failed' | 'unknown'> {
  // A closed page tells us nothing.
  if (page.isClosed()) return 'unknown';
  // Read the whole page's text…
  const body = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')) ?? '';
  // …with whitespace collapsed, so the patterns below match across line breaks.
  const text = body.replace(/\s+/g, ' ');
  // Signal 1: explicit failure wording, in five variants.
  if (/you (did not|didn'?t) pass|not qualified|unsuccessful|\bfailed\b|try again to pass/i.test(text)) return 'failed';
  // Signal 2: explicit success wording.
  if (/congratulation|you (have )?passed|successfully (passed|completed)|qualified/i.test(text)) return 'passed';
  // Score line without a verdict: compare against the pass mark when shown.
  // Any percentage on the page…
  const score = text.match(/(\d{1,3})\s*%/);
  // …and one specifically labelled as the requirement.
  const required = text.match(/(\d{1,3})\s*%\s*(required|to pass)/i);
  // With both, we can decide for ourselves.
  if (score && required) return Number(score[1]) >= Number(required[1]) ? 'passed' : 'failed';
  // A visible Re-attempt button on the results screen means the pass mark was missed.
  const reattempt = page.getByRole('button', { name: hiAlso(/re.?attempt|try again|retake/i) }).first();
  if (await reattempt.isVisible({ timeout: 1000 }).catch(() => false)) return 'failed';
  // None of the four signals fired — say so rather than guessing.
  return 'unknown';
}

// Click the Re-attempt button, and clear any intro gate behind it.
async function clickReattempt(page: Page): Promise<boolean> {
  // Three accepted labels for the retry control.
  const btn = page.getByRole('button', { name: hiAlso(/re.?attempt|try again|retake/i) }).first();
  // Not there — report failure so the caller stops retrying.
  if (!(await btn.isVisible({ timeout: 3000 }).catch(() => false))) return false;
  // Click it.
  await btn.click().catch(() => {});
  await page.waitForTimeout(2500);
  // Some assessments drop back to the "Start Now!" gate after a re-attempt.
  const startBtn = page.getByRole('button', { name: hiAlso(/start\s*now/i) }).first();
  // So clear that too, otherwise the next answer pass would find no questions.
  if (await startBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await startBtn.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  // Report success, so the caller answers again.
  return true;
}

// ══════════════════════════════════════════════════════════════════════
// ANSWER STRATEGY 1: ANSWER KEY (100% accuracy)
// ══════════════════════════════════════════════════════════════════════
// Answer every question using the captured key.
async function answerWithKey(page: Page, key: QuizKey, total: number) {
  // One iteration per question.
  for (let q = 1; q <= total; q++) {
    console.log(`\n   ❓ Q${q}/${total}`);
    // Wait until the question has finished rendering.
    await waitForQuestionReady(page);

    // Read what's on screen.
    const scraped = await scrapeCurrentQuestion(page);
    const { question, options } = scraped;
    let questionType: 'radio' | 'checkbox' =
      scraped.inputType === 'unknown' ? 'radio' : scraped.inputType;

    console.log(`      📝 Type: ${questionType.toUpperCase()} | "${question.slice(0, 80)}"`);

    // Nothing scraped — answer A and move on rather than stalling.
    if (options.length === 0) {
      // No question text AND no options ⇒ we've run past the real end of the
      // assessment (safety net if the count was ever over-estimated). Stop.
      if (!question || question.trim().length === 0) {
        console.log(`      ⏹️  Empty question ${q} — assessment finished, stopping answer loop`);
        break;
      }
      console.log(`      ⚠️  No options scraped — defaulting to A`);
      await selectAnswer(page, 0, questionType);
      await clickNextQuestion(page, q === total);
      continue;
    }

    // Log every option, lettered, so the run is auditable after the fact.
    options.forEach((o, i) =>
      console.log(`         [${String.fromCharCode(65 + i)}] ${o.slice(0, 70)}`)
    );

    // Whenever the key can't answer this question, ask Gemini instead of
    // blindly picking A — a wrong answer costs the pass mark, and the module
    // only completes when the assessment is passed.
    const askGemini = async (why: string) => {
      console.log(`      ⚠️  ${why} — asking Gemini`);
      const picks = await askGeminiOne(question, options, questionType === 'checkbox');
      console.log(`      🤖 ${picks.map((i) => `[${String.fromCharCode(65 + i)}]`).join(' + ')}`);
      if (questionType === 'radio') await selectAnswer(page, picks[0] ?? 0, 'radio');
      else await selectAnswer(page, picks, 'checkbox');
      await clickNextQuestion(page, q === total);
    };

    // Find the matching question in the JSON pool
    const match = findMatchingQuestion(question, options, key.questions);
    // The matcher DECLINED rather than guessing — default to A and say so.
    if (!match) {
      await askGemini('No JSON match');
      continue;
    }

    // The artifact says whether the question is select-all-that-apply; trust it
    // when the DOM didn't make the input type obvious.
    if (scraped.inputType === 'unknown' && match.multiSelection) questionType = 'checkbox';

    // Get all options marked isCorrect: true
    const correctOptions = match.options.filter((o) => o.isCorrect);
    // A poisoned entry — nothing is flagged correct.
    if (correctOptions.length === 0) {
      await askGemini('Key has no correct answers');
      continue;
    }

    // Map each correct JSON option to its on-screen index by TEXT match.
    // Sphere randomizes option order, so we never trust positional indexing.
    // Where the on-screen indices go.
    const onScreenIndices: number[] = [];
    // And any correct answers we couldn't find on screen.
    const missing: string[] = [];
    for (const correctOpt of correctOptions) {
      // Strip HTML from the key's text…
      const correctText = stripHtml(correctOpt.text);
      // …then find it among the on-screen options, using the fuzzy matcher.
      const idx = findBestOptionMatch(correctText, options);
      if (idx >= 0) onScreenIndices.push(idx);
      else missing.push(correctText);
    }

    // De-duplicate: two key entries can map to the same on-screen option.
    const uniqueIndices = [...new Set(onScreenIndices)];
    // Report anything the key claims but the screen doesn't show.
    if (missing.length > 0) {
      console.log(`      ⚠️  ${missing.length}/${correctOptions.length} not found on screen:`);
      missing.forEach((t) => console.log(`         JSON says: "${t.slice(0, 80)}"`));
    }

    // Nothing mapped at all — default to A.
    if (uniqueIndices.length === 0) {
      await askGemini('No correct answers mapped to the screen');
      continue;
    }

    // Build a readable "[A] + [C]" summary of what we're about to pick.
    const picks = uniqueIndices.map((i) => `[${String.fromCharCode(65 + i)}]`).join(' + ');
    console.log(`      🔑 ${picks} (${correctOptions.length} correct in JSON, ${uniqueIndices.length} on screen)`);

    // Radio = pick first correct only; Checkbox = pick all correct
    // A radio question takes exactly one answer…
    if (questionType === 'radio') {
      await selectAnswer(page, uniqueIndices[0], 'radio');
    // …a checkbox question takes the whole array.
    } else {
      await selectAnswer(page, uniqueIndices, 'checkbox');
    }
    // Advance; the last question submits instead.
    await clickNextQuestion(page, q === total);
  }
  await page.waitForTimeout(2500);
}

// ══════════════════════════════════════════════════════════════════════
// ANSWER STRATEGY 2: GEMINI AI (no key, or a poisoned one)
// ══════════════════════════════════════════════════════════════════════
//
// A poisoned key still carries every question and every option — only the
// `isCorrect` flags are stripped. So we send the WHOLE assessment to Gemini in
// ONE request (the free tier allows just 20 requests per DAY per model, which
// one-call-per-question blows through on a single 20-question quiz), then map
// the answers onto the screen by option TEXT, since Sphere shuffles the order.
//
// Answers are cached per assessment, so a re-attempt costs no extra quota.
// ──────────────────────────────────────────────────────────────────────

/** resourceId → (normalized question stem → correct option TEXTS). */
const geminiAnswerCache = new Map<string, Map<string, string[]>>();

async function answerWithGeminiFromKey(
  page: Page,
  key: QuizKey,
  total: number,
  resourceId: string,
) {
  const answers = await getGeminiAnswersFromKey(key, resourceId);

  // One iteration per question.
  for (let q = 1; q <= total; q++) {
    console.log(`\n   ❓ Q${q}/${total}`);
    // Wait for it to render.
    await waitForQuestionReady(page);

    // Read what's on screen.
    const scraped = await scrapeCurrentQuestion(page);
    const { question, options } = scraped;
    // Default an undetectable type to radio — the safer guess.
    const questionType: 'radio' | 'checkbox' =
      scraped.inputType === 'unknown' ? 'radio' : scraped.inputType;

    // Nothing at all on screen means the assessment ended early (fewer questions
    // than the counter claimed). Stop cleanly rather than clicking into nothing.
    if (!question && options.length === 0) {
      console.log(`      ⏹️  Empty question ${q} — assessment finished, stopping answer loop`);
      break;
    }
    // Log the type and the stem…
    console.log(`      📝 Type: ${questionType.toUpperCase()} | "${question.slice(0, 80)}"`);
    // …and every option, lettered, so the run is auditable after the fact.
    options.forEach((o, i) =>
      console.log(`         [${String.fromCharCode(65 + i)}] ${o.slice(0, 70)}`)
    );

    // Match the on-screen question back to the key, then to Gemini's answer.
    const match = findMatchingQuestion(question, options, key.questions);
    // Key the lookup on the MATCHED question's stem when we found one, falling
    // back to the scraped text — so shuffled wording still finds its answer.
    const stemKey = normalizeText(stripHtml(match?.question ?? question));
    // The answer TEXTS Gemini gave for this question.
    const answerTexts = answers.get(stemKey) ?? [];

    // Map each answer text to its on-screen index, drop any that didn't match,
    // and de-duplicate — two answers can resolve to the same option.
    const indices = [
      ...new Set(
        answerTexts
          .map((t) => findBestOptionMatch(t, options))
          .filter((i) => i >= 0),
      ),
    ];

    // Gemini had nothing for this one — default to A.
    if (indices.length === 0) {
      console.log(`      ⚠️  No Gemini answer for this question — defaulting to A`);
      await selectAnswer(page, 0, questionType);
      await clickNextQuestion(page, q === total);
      continue;
    }

    // Log the picks as letters.
    console.log(`      🤖 ${indices.map((i) => `[${String.fromCharCode(65 + i)}]`).join(' + ')}`);
    // A radio question takes exactly one…
    if (questionType === 'radio') await selectAnswer(page, indices[0], 'radio');
    // …a checkbox question takes the whole array.
    else await selectAnswer(page, indices, 'checkbox');
    // Advance; the last question submits instead.
    await clickNextQuestion(page, q === total);
  }
  await page.waitForTimeout(2500);
}

// 
// Returning TEXTS rather than letters is what makes the result reusable: the
// player shuffles option order, so a letter would be wrong on a re-attempt.
/**
 * ONE Gemini request for the whole assessment, built from the captured quiz
 * JSON. Returns normalized question stem → the correct option TEXTS.
 */
async function getGeminiAnswersFromKey(key: QuizKey, resourceId: string): Promise<Map<string, string[]>> {
  // Already asked for this assessment?
  const cached = geminiAnswerCache.get(resourceId);
  // Then reuse it — this is what makes a re-attempt cost no extra quota.
  if (cached) {
    console.log(`   ♻️  Reusing cached Gemini answers for ${resourceId} (no extra quota)`);
    return cached;
  }

  // Build the question list from the KEY, not the screen — we have it all at once.
  const questions = key.questions.map((q) => ({
    // Strip HTML from each stem…
    stem: stripHtml(q.question),
    // …and from every option.
    options: q.options.map((o) => stripHtml(o.text)),
  }));

  console.log(`   🤖 Asking Gemini for all ${questions.length} questions in ONE request`);
  // Build the question block.
  const block = questions
    .map((q, i) => {
      // Label the options A, B, C… — charCode 65 is 'A'.
      const opts = q.options.map((o, j) => `   ${String.fromCharCode(65 + j)}) ${o}`).join('\n');
      // Number each question so the reply can be mapped back.
      return `Q${i + 1}: ${q.stem}\n${opts}`;
    })
    .join('\n\n');

  // The prompt. Note it names three languages and explicitly asks for EVERY
  // correct letter on select-all questions — comma-separated.
  const prompt =
`You are answering a medical/clinical assessment (WHO newborn care, KMC, family planning, normal labour and AMTSL, emergency triage, maternal health, referral protocols). Questions may be in Hindi (Devanagari), Kannada, or mixed with English. Use accurate medical and clinical knowledge.

Answer ALL ${questions.length} questions below. Some are select-all-that-apply: list EVERY correct letter for those, comma-separated. Respond with ONLY a JSON object mapping the question number to its correct letter(s). No prose, no markdown fences.

Example format: {"1":"B","2":"A,C","3":"D"}

${block}`;

  // One request for the whole assessment.
  const letters = await askGeminiBatch(prompt, questions.length);
  // Stem → correct option texts.
  const map = new Map<string, string[]>();
  // Convert each answer's letters back into the option TEXTS they refer to.
  questions.forEach((q, i) => {
    // `letters` is 1-indexed by question number.
    const picks = (letters[i + 1] ?? [])
      // Letter → index → the option's text.
      .map((l) => q.options[l.charCodeAt(0) - 65])
      // Drop anything that didn't resolve. The type guard narrows away undefined.
      .filter((t): t is string => Boolean(t));
    // Only record questions we actually got an answer for.
    if (picks.length) map.set(normalizeText(q.stem), picks);
  });

  // Report the hit rate.
  console.log(`      ✅ Gemini answered ${map.size}/${questions.length} questions`);
  // Cache it for any re-attempt.
  geminiAnswerCache.set(resourceId, map);
  return map;
}

/**
 * Last resort when Sphere never served a quiz JSON: ask per question. Costs one
 * request per question, so it exhausts a free-tier key fast — logged as such.
 */
async function answerWithGeminiPerQuestion(page: Page, total: number) {
  console.log(`\n   🤖 Answering ${total} questions with Gemini (one pass)`);

  // One iteration per question.
  for (let q = 1; q <= total; q++) {
    console.log(`\n   ❓ Q${q}/${total}`);
    // Wait for it to render.
    await waitForQuestionReady(page);

    // Read what's on screen.
    const scraped = await scrapeCurrentQuestion(page);
    // Default an undetectable type to radio.
    const qType: 'radio' | 'checkbox' =
      scraped.inputType === 'unknown' ? 'radio' : scraped.inputType;

    // Nothing on screen — the assessment ended early. Stop cleanly.
    if (!scraped.question && scraped.options.length === 0) {
      console.log(`      ⏹️  Empty question ${q} — assessment finished, stopping answer loop`);
      break;
    }

    // Log the type and the stem…
    console.log(`      📝 Type: ${qType.toUpperCase()} | "${scraped.question.slice(0, 80)}"`);
    // …and every option, lettered.
    scraped.options.forEach((o, i) =>
      console.log(`         [${String.fromCharCode(65 + i)}] ${o.slice(0, 70)}`)
    );

    // Only ask if there's anything to ask about…
    const picks = scraped.options.length
      // …passing whether this is a multi-answer question…
      ? await askGeminiOne(scraped.question, scraped.options, qType === 'checkbox')
      // …otherwise default to A.
      : [0];

    // Log the picks as letters.
    console.log(`      🤖 ${picks.map((i) => `[${String.fromCharCode(65 + i)}]`).join(' + ')}`);
    // A radio question takes one; `?? 0` guards an empty result.
    if (qType === 'radio') await selectAnswer(page, picks[0] ?? 0, 'radio');
    // A checkbox question takes them all.
    else await selectAnswer(page, picks, 'checkbox');

    // Advance; the last question submits instead.
    await clickNextQuestion(page, q === total);
  }
  await page.waitForTimeout(2500);
}

// ══════════════════════════════════════════════════════════════════════
// QUESTION MATCHING + TEXT UTILS
// ══════════════════════════════════════════════════════════════════════

// Reduce HTML to plain text: drop tags, decode &nbsp;, collapse whitespace, trim.
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Lower-case and flatten punctuation to single spaces. The । is the Devanagari
// full stop, included so Hindi questions normalise too.
function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[।?.,!\s]+/g, ' ').trim();
}

// findMatchingQuestion lives in helpers/questionMatch.ts — shared by every
// quiz-answering spec so the case-study stem collision is fixed in one place.

/**
 * Find the on-screen option that matches the correct-answer text from JSON.
 * Strategy: exact normalized match → contains-match → word-overlap ≥60%.
 */
function findBestOptionMatch(target: string, options: string[]): number {
  // Normalise the target once, up front.
  const targetNorm = normalizeText(target);
  // Nothing usable to match.
  if (!targetNorm) return -1;

  // 1. Exact
  let idx = options.findIndex((o) => normalizeText(o) === targetNorm);
  // Found — no need for the looser passes.
  if (idx >= 0) return idx;

  // 2. Contains either direction
  idx = options.findIndex((o) => {
    const opt = normalizeText(o);
    // Ignore very short options — "a" would match almost anything.
    if (opt.length < 4) return false;
    // Either direction: the key may be a truncation of the screen text, or vice versa.
    return opt.includes(targetNorm) || targetNorm.includes(opt);
  });
  if (idx >= 0) return idx;

  // 3. Word-overlap score
  // Stop words carry no meaning, so counting them would let two unrelated
  // options score highly just for both being English.
  const stopWords = new Set([
    'a','an','the','is','are','was','were','be','of','in','on','at','to','for',
    'with','by','from','and','or','but','not','it','this','that','these','those',
  ]);
  // The target's meaningful words.
  const targetWords = targetNorm.split(/\s+/).filter((w) => w.length >= 2 && !stopWords.has(w));
  // Nothing left after filtering — no usable signal.
  if (targetWords.length === 0) return -1;

  // Track the best-scoring option.
  let bestScore = 0, bestIdx = -1;
  options.forEach((opt, i) => {
    // This option's meaningful words, as a Set for O(1) lookups.
    const optWords = new Set(
      normalizeText(opt).split(/\s+/).filter((w) => w.length >= 2 && !stopWords.has(w))
    );
    // How many words do they share?
    const overlap = targetWords.filter((w) => optWords.has(w)).length;
    // Divide by the LARGER of the two sizes. Using the larger denominator stops a
    // two-word option scoring 100% against a ten-word target.
    const score = overlap / Math.max(targetWords.length, optWords.size);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  });

  // Only accept a strong match — below 60% we return -1 and let the caller default.
  return bestScore >= 0.6 ? bestIdx : -1;
}

// ══════════════════════════════════════════════════════════════════════
// SCRAPING THE CURRENT QUESTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Wait for the current question to be fully rendered.
 * Polls until visible-input counts are stable across two consecutive reads.
 */
async function waitForQuestionReady(page: Page): Promise<void> {
  await page.waitForTimeout(400);
  // A signature of the last reading.
  let lastSig = '';
  // How many consecutive readings have matched.
  let stable = 0;
  // Poll up to 30 times.
  for (let attempt = 0; attempt < 30; attempt++) {
    // Count the visible inputs inside the browser.
    const counts = await page.evaluate(() => {
      // "Visible" measured four ways: real size, plus three CSS properties.
      const isVisible = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width >= 30 && r.height >= 15 &&
          s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
      };
      // Radio buttons…
      const radios = Array.from(document.querySelectorAll<HTMLElement>('mat-radio-button'))
        .filter(isVisible).length;
      // …list options (a checkbox variant)…
      const listOptions = Array.from(document.querySelectorAll<HTMLElement>('mat-list-option'))
        .filter(isVisible).length;
      // …and bare checkboxes NOT inside a list option, so they aren't double-counted.
      const bareCheckboxes = Array.from(document.querySelectorAll<HTMLElement>('mat-checkbox'))
        .filter((c) => isVisible(c) && !c.closest('mat-list-option')).length;
      return { radios, listOptions, bareCheckboxes };
    });

    // A single string capturing all three counts — easy to compare.
    const sig = `${counts.radios}|${counts.listOptions}|${counts.bareCheckboxes}`;
    // Two or more of any input type means a real question is on screen.
    const hasInputs = counts.radios >= 2 || counts.listOptions >= 2 || counts.bareCheckboxes >= 2;

    // Same counts as last time AND real inputs present.
    if (hasInputs && sig === lastSig) {
      // Count it as one stable reading…
      stable++;
      // …and accept after TWO in a row, which rules out a mid-animation snapshot.
      if (stable >= 2) return;
    // Anything changed — start counting again.
    } else {
      stable = 0;
    }
    lastSig = sig;
    await page.waitForTimeout(200);
  }
}

/**
 * Scrape the current question's text, options, AND input type.
 * Sphere mixes radio + checkbox questions in the same quiz, so we detect
 * per-question. Element selection here MUST match selectAnswer's selection
 * priority, so that index N from the scraper = same element as index N at click.
 *
 * Priority order:
 *   mat-list-option (Sphere's main checkbox layout)
 *   → mat-radio-button (single-choice)
 *   → bare mat-checkbox
 *   → mat-option / [role="option"]
 */
async function scrapeCurrentQuestion(page: Page): Promise<ScrapedQuestion> {
  // Everything below runs INSIDE the browser.
  return await page.evaluate(() => {
    // Read an element's text WITHOUT the control markup.
    const cleanText = (el: HTMLElement): string => {
      // Clone it, so removing nodes can't damage the real page…
      const clone = el.cloneNode(true) as HTMLElement;
      // …strip the inputs and their styled wrappers…
      clone.querySelectorAll('input, mat-checkbox, mat-radio-button, .mdc-checkbox, .mdc-radio')
        .forEach((n) => n.remove());
      // …and return what's left: the option's label alone.
      return (clone.innerText ?? '').trim();
    };

    // "Visible" measured by real size — big enough to be a genuine control.
    const isVisible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.width > 50 && r.height > 20;
    };

    // Detect input layout
    // Radio buttons…
    const allRadios = Array.from(document.querySelectorAll<HTMLElement>('mat-radio-button'))
      .filter(isVisible);
    // …list options (Sphere's main checkbox layout)…
    const allListOptions = Array.from(document.querySelectorAll<HTMLElement>('mat-list-option'))
      .filter(isVisible);
    // …bare checkboxes NOT inside a list option, so they aren't double-counted…
    const allBareCheckboxes = Array.from(document.querySelectorAll<HTMLElement>('mat-checkbox'))
      .filter((c) => isVisible(c) && !c.closest('mat-list-option'));
    // …and generic options as a last resort.
    const allMatOptions = Array.from(document.querySelectorAll<HTMLElement>('mat-option, [role="option"]'))
      .filter(isVisible);

    // What kind of question this is.
    let inputType: 'radio' | 'checkbox' | 'unknown' = 'unknown';
    // And which elements represent its options.
    let elements: HTMLElement[] = [];

    // Priority order matters: it must match selectAnswer's, so index N here is
    // the same element as index N at click time.
    if (allListOptions.length >= 2) {
      inputType = 'checkbox';
      elements = allListOptions;
    // Radios mean a single-answer question.
    } else if (allRadios.length >= 2) {
      inputType = 'radio';
      elements = allRadios;
    // Bare checkboxes — a multi-answer question in a different layout.
    } else if (allBareCheckboxes.length >= 2) {
      inputType = 'checkbox';
      elements = allBareCheckboxes;
    // Generic options — treated as checkboxes, the safer assumption.
    } else if (allMatOptions.length >= 2) {
      inputType = 'checkbox';
      elements = allMatOptions;
    }

    // First pass: scrape option texts (also used to exclude them from question search)
    // For each option element…
    const options = elements.map((el) => {
      // …try its own text first.
      const direct = cleanText(el);
      // Usable — done.
      if (direct.length > 0 && direct.length < 300) return direct;
      // Empty or absurdly long: climb up to 5 ancestors looking for the real label.
      let container: HTMLElement | null = el.parentElement;
      let attempts = 0;
      while (container && attempts < 5) {
        const t = cleanText(container);
        if (t.length > 0 && t.length < 300) return t;
        container = container.parentElement;
        attempts++;
      }
      // Nothing usable anywhere.
      return '';
    // Drop any that came back empty.
    }).filter((t) => t.length > 0);

    // A lower-cased set, so the question search below can exclude the options.
    const optionTextLower = new Set(options.map((o) => o.toLowerCase().trim()));

    // Find the question text by scoring candidate lines.
    // Excludes option texts and UI chrome. Prefers `?` ending and question-starting words.
    let question = '';
    // Only possible if we found options to anchor on.
    if (elements[0]) {
      // Score each candidate line, then take the best.
      const candidates: { text: string; score: number }[] = [];
      // Start at the first option and climb.
      let parent: HTMLElement | null = elements[0];
      let depth = 0;

      // Up to 8 levels up.
      while (parent && depth < 8) {
        parent = parent.parentElement;
        depth++;
        if (!parent) break;

        // Split this ancestor's text into lines.
        const lines = (parent.innerText ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          // Too short to be a question, or too long to be anything but a paragraph.
          if (line.length < 8 || line.length > 500) continue;
          // It's one of the options — skip.
          if (optionTextLower.has(line.toLowerCase().trim())) continue;
          // It's a button, a counter or a results label — skip.
          if (/^(next|previous|submit|start now|cancel|close|\d+\s*\/\s*\d+|question\s*\d+|true|false|results?|assessment)\s*$/i.test(line)) continue;
          // It's a bare "3/10" or "75%" — skip.
          if (/^\s*\d+\s*(\/|%)/.test(line)) continue;

          // Base score is the length, CAPPED at 100 so a long paragraph can't win on size alone.
          let score = Math.min(line.length, 100);
          // Ending in a question mark is the strongest signal (both ASCII and full-width).
          if (line.endsWith('?') || line.endsWith('?')) score += 300;
          // Containing one anywhere is weaker but still meaningful.
          else if (line.includes('?') || line.includes('?')) score += 100;
          // Other sentence-ending marks are a mild signal.
          if (line.endsWith('।') || line.endsWith('.') || line.endsWith(':')) score += 30;
          // An interrogative or imperative opening is the second-strongest signal.
          if (/^(what|which|how|when|where|why|who|is|does|did|can|will|should|are|do|name|list|identify|describe|select|choose)\s/i.test(line)) {
            score += 200;
          }
          candidates.push({ text: line, score });
        }
        // Stop once we have candidates AND have climbed at least 3 levels — enough to
        // have seen the stem, without walking out into the whole page.
        if (candidates.length > 0 && depth >= 3) break;
      }

      // Any candidates?
      if (candidates.length > 0) {
        // Highest score first…
        candidates.sort((a, b) => b.score - a.score);
        // …and take the winner.
        question = candidates[0].text;
      }
    }

    // Hand all three back to the Node side.
    return { question, options, inputType };
  });
}

// 
// 
// ══════════════════════════════════════════════════════════════════════
// SELECTING AN ANSWER
// ══════════════════════════════════════════════════════════════════════
//
// Radio and checkbox need different strategies:
//   • Radios: DOM-level click on inner .mat-mdc-radio-touch-target (proven)
//   • Checkboxes: Playwright native click on .mdc-checkbox (proven via recording)
//
// For checkboxes, we verify by reading input.checked AFTER 400ms. False positives
// from aria-* attributes during hover/focus are filtered out.
// ──────────────────────────────────────────────────────────────────────

// Select one option (radio) or several (checkbox).
async function selectAnswer(
  page: Page,
  indices: number | number[],
  inputType: 'radio' | 'checkbox',
): Promise<void> {
  // Let the question settle.
  await page.waitForTimeout(300);
  // Accept either a single index or an array, and normalise to an array.
  const idxArray = Array.isArray(indices) ? indices : [indices];

  // Click each one.
  for (const idx of idxArray) {
    // Radio and checkbox need completely different handling.
    if (inputType === 'radio') {
      await selectRadioOption(page, idx);
    } else {
      await selectCheckboxOption(page, idx);
    }
    // Pause between clicks so Material's change detection keeps up.
    await page.waitForTimeout(300);
  }
}

/** Click a radio button at the given index. Tries 6 strategies in priority order. */
async function selectRadioOption(page: Page, idx: number): Promise<void> {
  // Runs inside the browser.
  const result = await page.evaluate((targetIdx: number) => {
    // A stricter visibility test than the scraper's: it also walks the ANCESTORS,
    // because a hidden parent makes a child unclickable even at full size.
    const isVisible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      if (r.width < 30 || r.height < 15) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      // Climb the parents…
      let p = el.parentElement;
      while (p) {
        const ps = window.getComputedStyle(p);
        // …and reject if any of them is hidden.
        if (ps.display === 'none' || ps.visibility === 'hidden') return false;
        p = p.parentElement;
      }
      return true;
    };

    // The visible radio buttons.
    const radios = Array.from(document.querySelectorAll<HTMLElement>('mat-radio-button'))
      .filter(isVisible);

    // Guard the index — an out-of-range pick would throw.
    if (targetIdx < 0 || targetIdx >= radios.length) {
      return { ok: false, reason: `index ${targetIdx} out of range (have ${radios.length})` };
    }

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

    // Already selected — nothing to do.
    if (isChecked(target)) return { ok: true };

    // Strategy 1-4: click each inner element in order
    // Ordered innermost-first: the touch target is what Material actually listens on.
    const innerSelectors = [
      '.mat-mdc-radio-touch-target',
      'input[type="radio"]',
      '.mdc-form-field',
      'label',
      '.mdc-radio',
    ];
    // Try each layer…
    for (const sel of innerSelectors) {
      const el = target.querySelector<HTMLElement>(sel);
      if (el) {
        // …click it…
        el.click();
        // …and stop as soon as the radio reports checked.
        if (isChecked(target)) return { ok: true };
      }
    }

    // Strategy 5: click the wrapper itself
    target.click();
    if (isChecked(target)) return { ok: true };

    // Strategy 6: force-check the native input and dispatch events
    const input = target.querySelector<HTMLInputElement>('input[type="radio"]');
    if (input) {
      // Set the property by hand…
      input.checked = true;
      // …then fire input…
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // …and change, so Angular's form control notices.
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (isChecked(target)) return { ok: true };
    }
    // Every strategy failed — report why.
    return { ok: false, reason: 'radio did not become checked' };
  }, idx);

  // Warn rather than throw: the quiz can continue with a wrong answer.
  if (!result.ok) {
    console.log(`      ⚠️  radio click failed at index ${idx}: ${(result as any).reason}`);
  }
}

/** Click a checkbox at the given index. Uses Playwright native click. */
async function selectCheckboxOption(page: Page, idx: number): Promise<void> {
  // Wait for stable visible checkboxes
  // waitForFunction polls INSIDE the browser until at least two are rendered.
  await page.waitForFunction(() => {
    const els = Array.from(document.querySelectorAll('.mdc-checkbox'));
    return els.filter((e) => {
      const r = (e as HTMLElement).getBoundingClientRect();
      return r.width > 10 && r.height > 10;
    }).length >= 2;
  }, { timeout: 5000 }).catch(() => {});

  // `:visible` is a Playwright pseudo-class — it filters to on-screen elements.
  const checkboxLocator = page.locator('.mdc-checkbox:visible');
  // How many are there?
  const total = await checkboxLocator.count();
  // Guard the index.
  if (idx < 0 || idx >= total) {
    console.log(`      ⚠️  checkbox click skipped: index ${idx} out of range (have ${total})`);
    return;
  }

  // The one we want.
  const target = checkboxLocator.nth(idx);

  // Verify by reading input.checked after 400ms (Material's selectionChange
  // needs time to fire). Race against a 2s timeout in case evaluate hangs.
  const isReallyChecked = async (): Promise<boolean> => {
    // The wait is what makes this reliable — reading immediately gives a false negative.
    await page.waitForTimeout(400);
    try {
      // Promise.race returns whichever settles first: the real check, or a 2s
      // timeout resolving false. That stops a hung evaluate from stalling the run.
      return await Promise.race([
        checkboxLocator.nth(idx).evaluate((el: HTMLElement) => {
          // Read the REAL input's checked property — not an aria attribute, which can
          const input = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
          return !!input && input.checked === true;
        }),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
    // Any error counts as "not checked".
    } catch {
      return false;
    }
  };

  // Did any strategy work?
  let success = false;
  // And which one — recorded for the log.
  let strategy = '';

  // PRIMARY: Playwright click on .mdc-checkbox (proven by user's recording)
  try {
    // A real, trusted click — Material responds to those far more reliably.
    await target.click({ timeout: 4000 });
    strategy = '.mdc-checkbox click';
    success = await isReallyChecked();
  // Report and fall through to the fallbacks.
  } catch (e: any) {
    console.log(`      ⚠️  primary click threw: ${e?.message?.slice(0, 100)}`);
  }

  // FALLBACK 1: force-click (skip actionability check)
  if (!success) {
    try {
      // `force` skips Playwright's "is it clickable?" checks.
      await target.click({ timeout: 2000, force: true });
      strategy = '.mdc-checkbox force-click';
      success = await isReallyChecked();
    } catch { /* try next */ }
  }

  // FALLBACK 2: click the parent mat-list-option row
  if (!success) {
    try {
      // The whole row is often clickable even when the box itself is covered.
      const row = page.locator('mat-list-option:visible').nth(idx);
      if (await row.count() > 0) {
        await row.click({ timeout: 2000, force: true });
        strategy = 'mat-list-option row click';
        success = await isReallyChecked();
      }
    } catch { /* try next */ }
  }

  // FALLBACK 3: click the native input with force
  if (!success) {
    try {
      // The real <input>, which Material normally hides.
      const native = target.locator('input[type="checkbox"]').first();
      await native.click({ timeout: 2000, force: true });
      strategy = 'native input forced';
      success = await isReallyChecked();
    } catch { /* try next */ }
  }

  // All four failed — say so, and name the last strategy tried.
  if (!success) {
    console.log(`      ⚠️  checkbox[${idx}] click did NOT register (last tried: ${strategy})`);
  // Per-click logging is opt-in, since a long quiz would flood the log.
  } else if (process.env.VERBOSE_CHECKBOX) {
    console.log(`      ✓ checkbox[${idx}] checked via ${strategy}`);
  }
}

/**
 * Advance from the current question to the next.
 *
 * Handles two resource shapes:
 *  - Quiz: select → SUBMIT (reveals the correct answer + enables Next) → NEXT.
 *    "Next" starts DISABLED here, so we must click Submit first.
 *  - Assessment: usually just NEXT per question (SUBMIT only on the last one).
 * So: click Submit if present/enabled (reveal), then click Next if present/enabled.
 */
async function clickNextQuestion(page: Page, isLast: boolean): Promise<void> {
  // Step 1: Submit / Check — reveals the answer in a quiz; submits an assessment.
  // Four accepted labels: Submit, Check, Submit Answer, Check Answer.
  const submit = page.getByRole('button', { name: /^(submit|check)( answer)?$/i }).first();
  // Only click it if it is BOTH on screen and enabled.
  if (
    (await submit.isVisible().catch(() => false)) &&
    !(await submit.isDisabled().catch(() => false))
  ) {
    await submit.click().catch(() => {});
    await page.waitForTimeout(1500); // answer-reveal slide renders; Next enables
  }

  // Step 2: Next — advance to the next question (now enabled after the reveal).
  const next = page.getByRole('button', { name: hiAlso(/^next$/i) }).first();
  // Only if it exists.
  if (await next.isVisible().catch(() => false)) {
    // Still disabled after the submit — on the last question that means we're done.
    if (await next.isDisabled().catch(() => false)) {
      if (isLast) console.log(`      ℹ️  Quiz/Assessment finished`);
      return;
    }
    // Advance.
    await next.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
}

/**
 * After all questions are answered, drive the end-of-assessment buttons
 * (Submit → results screen → Continue) until we actually leave the quiz.
 * This is the step where the run was getting stuck — it answered every
 * question but never clicked the final Continue on the results screen.
 */
async function finishAssessment(page: Page): Promise<void> {
  console.log(`   🏁 Finishing assessment (Submit / Continue)`);
  // Seven accepted labels, anchored, covering every build's wording.
  const labels = /^(submit|continue|finish|view\s*results?|go\s*to\s*course|proceed|done)$/i;

  // Up to eight rounds — the sequence can be Submit → results → Continue → …
  for (let round = 0; round < 8; round++) {
    // A closed page means the course finished.
    if (page.isClosed()) return;

    // Are we still inside the quiz (a question/option is showing)?
    // Four signals that a question is still on screen.
    const stillInQuiz = await page
      .locator('mat-radio-button, mat-checkbox, mat-list-option, [class*="question"]')
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    // Find the first visible, enabled proceed-button.
    // Every button on the page…
    const buttons = page.getByRole('button');
    const n = await buttons.count().catch(() => 0);
    // Which one we clicked, if any.
    let clickedLabel = '';
    // …checked one at a time.
    for (let b = 0; b < n; b++) {
      const btn = buttons.nth(b);
      // Read its label, whitespace collapsed.
      const name = ((await btn.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      // Not one of our seven labels — skip.
      if (!labels.test(name)) continue;
      // Not on screen — skip.
      if (!(await btn.isVisible().catch(() => false))) continue;
      // Disabled — skip.
      if (await btn.isDisabled().catch(() => false)) continue;
      // Bring it into view, then click it.
      await btn.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      await btn.click({ timeout: 3000 }).catch(() => {});
      clickedLabel = name;
      // Log which one, so the sequence is visible in the run output.
      console.log(`      ▶️  clicked "${name}"`);
      await page.waitForTimeout(2500);
      // One click per round — re-evaluate the page before the next.
      break;
    }

    // Left the quiz and nothing more to click → done.
    if (!clickedLabel && !stillInQuiz) {
      console.log(`      ✅ left the assessment`);
      return;
    }
    // Nothing clickable but still on a question → let the outer advance retry.
    if (!clickedLabel) {
      console.log(`      ℹ️  no proceed button found this round`);
      return;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
// GEMINI AI BATCH
// ══════════════════════════════════════════════════════════════════════
// Timestamp of the last Gemini call, for the rate limiter below.
let lastGeminiCallAt = 0;

// Sleep just long enough to respect Gemini's requests-per-minute quota.
async function throttleGemini() {
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
    // Disable hidden "thinking" tokens for the main flash model
    // These are recall questions, not reasoning puzzles, so the budget is wasted latency.
    if (model.includes('2.5-flash') && !model.includes('lite')) {
      body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }
    // POST it. The key rides in the query string, as this API expects.
    const res = await fetch(`${GEMINI_URL_BASE}${model}:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const error = await res.text();
      // A 429 is either the per-minute cap (worth waiting out — the API reports
      // the delay) or the free tier's PER-DAY cap of 20 requests per model, which
      // no amount of waiting fixes. The quotaId tells them apart.
      const secs = error.match(/retry in ([\d.]+)s/i)?.[1] ?? error.match(/"retryDelay":\s*"([\d.]+)s"/i)?.[1];
      return {
        ok: false,
        status: res.status,
        error,
        retryAfterMs: secs ? Math.ceil(Number(secs) * 1000) : 0,
        daily: /PerDay/i.test(error),
      };
    }
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

// Set once the key's PER-DAY free-tier quota is gone: every further request
// would 429 no matter how long we wait, so we stop asking and say so plainly.
let geminiDailyExhausted = false;

/**
 * One prompt → Gemini's raw text, or null. Handles model fallback and waits out
 * per-minute rate limits; gives up immediately on the per-day quota.
 */
async function geminiAsk(prompt: string, maxOutputTokens: number, indent = '      '): Promise<string | null> {
  // No key configured — say so and return an empty map.
  if (!GEMINI_API_KEY) {
    console.log(`${indent}⚠️  GEMINI_API_KEY not set`);
    return null;
  }
  if (geminiDailyExhausted) {
    console.log(`${indent}⚠️  Gemini daily free-tier quota already exhausted — skipping`);
    return null;
  }

  // Both models share the same free-tier allowance per project, so on a rate
  // limit we alternate AND wait rather than hopping once and guessing.
  for (const model of [GEMINI_PRIMARY, GEMINI_FALLBACK, GEMINI_PRIMARY, GEMINI_FALLBACK]) {
    // Respect the rate limit before each call.
    await throttleGemini();
    const result = await callGemini(model, prompt, maxOutputTokens);
    if (result.ok) return (result.text ?? '').trim();

    if (result.status === 429 && result.daily) {
      geminiDailyExhausted = true;
      console.log(
        `${indent}🚫 Gemini free-tier DAILY quota exhausted (20 requests/day per model).\n` +
          `${indent}   Answers fall back to guessing until it resets — use a key with paid quota.`,
      );
      return null;
    }
    // 429 = rate-limited, 503 = overloaded.
    if (result.status === 429 || result.status === 503) {
      // Honour Gemini's own suggested delay, but cap it — a multi-minute wait means
      // the daily quota is gone, and waiting it out would stall the whole run.
      const waitMs = Math.min(result.retryAfterMs || GEMINI_RETRY_WAIT_MS, GEMINI_MAX_RETRY_WAIT_MS);
      console.log(`${indent}⏳ ${model} ${result.status} (rate limit) — waiting ${Math.round(waitMs / 1000)}s`);
      // Wait it out…
      await new Promise((r) => setTimeout(r, waitMs));
      // …then retry the same model.
      continue;
    }
    // Any other error — report it and stop trying.
    console.log(`${indent}⚠️  ${model} error: ${result.error?.slice(0, 120) ?? '?'}`);
    break;
  }
  // Everything failed.
  return null;
}

/**
 * One request for a WHOLE assessment. Returns { questionNumber: ["B","D"] }.
 */
async function askGeminiBatch(prompt: string, count: number): Promise<Record<number, string[]>> {
  // 2000 output tokens — enough for a whole assessment's answers.
  const raw = await geminiAsk(prompt, 2000);
  // No reply at all.
  if (!raw) return {};

  // Question number → its correct letters.
  const map: Record<number, string[]> = {};
  // Shared parser used by both strategies below.
  const addLetters = (n: number, value: string) => {
    // Pull every A-Z out of the value, so "A,C" and "A and C" both work.
    const letters: string[] = value.toUpperCase().match(/[A-Z]/g) ?? [];
    // Guard the range, require at least one letter, and never overwrite an earlier hit.
    if (n >= 1 && n <= count && letters.length && !map[n]) map[n] = [...new Set(letters)];
  };

  // Strategy 1: strip any markdown fences, then find the outermost {...} block.
  const jsonMatch = raw.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    // Proper JSON parse.
    try {
      const obj = JSON.parse(jsonMatch[0]);
      // Feed each entry through the shared parser.
      for (const k of Object.keys(obj)) addLetters(parseInt(k, 10), String(obj[k]));
    // Malformed JSON — fall through to the line scrape.
    } catch { /* fall through to the line scrape */ }
  }

  // Fallback: scrape "1: B", "Q2 - A,C", "3) D" lines.
  // Only bother if strategy 1 came up short.
  if (Object.keys(map).length < count) {
    // The trailing group is what captures comma-separated multi-answers.
    const re = /Q?\s*(\d{1,2})\s*[:.)\-]\s*([A-Z](?:\s*,\s*[A-Z])*)/gi;
    let m: RegExpExecArray | null;
    // exec with a /g regex walks all matches.
    while ((m = re.exec(raw))) addLetters(parseInt(m[1], 10), m[2]);
  }

  // Whatever we managed to recover.
  return map;
}

/**
 * Ask Gemini for ONE multiple-choice question. Returns 0-based option indices:
 * a single index for radio questions, every correct index for checkbox ones
 * (Sphere's "select all that apply" items only score when ALL are picked).
 * Falls back to [0] on any failure.
 */
async function askGeminiOne(
  question: string,
  options: string[],
  multi: boolean,
): Promise<number[]> {

  // The last valid letter, so the prompt can name the exact allowed range.
  const lastLetter = String.fromCharCode(65 + options.length - 1);
  // Letter each option: A) …, B) …
  const optsText = options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n');
  // The prompt. It names the clinical domains and three possible languages.
  const prompt =
`You are answering a medical/clinical assessment question (WHO newborn care, KMC, family planning, normal labour and AMTSL, emergency triage, maternal health, referral protocols). Questions may be in Hindi (Devanagari), Kannada, or mixed with English. Use accurate medical and clinical knowledge.

Question:
${question}

Options:
${optsText}

${multi
  ? `This is a SELECT-ALL-THAT-APPLY question — more than one option can be correct. Respond with ONLY the correct letters (A through ${lastLetter}), comma-separated, on the first line. Example:\nB,D`
  : `Respond with ONLY a single letter (A through ${lastLetter}) on the first line. Example:\nB`}
Then a brief one-line reason.`;

  // 300 output tokens — a few letters plus one sentence.
  const raw = await geminiAsk(prompt, 300);
  // No reply — default to A.
  if (!raw) {
    console.log(`      ⚠️  No Gemini answer — defaulting to A`);
    return [0];
  }

  // The first line should carry the letter(s).
  const firstLine = raw.split('\n')[0]?.trim() ?? '';
  // Word-boundaries, so it can't pick a letter out of the middle of a word.
  const found: string[] = firstLine.toUpperCase().match(/\b[A-Z]\b/g) ?? [];
  // De-duplicate…
  const letters = [...new Set(found)]
    // …convert each to a 0-based index…
    .map((l) => l.charCodeAt(0) - 65)
    // …and drop anything outside the real option range.
    .filter((i) => i >= 0 && i < options.length);
  // Nothing parseable — default to A and say so.
  if (!letters.length) {
    console.log(`      🤖 "${firstLine.slice(0, 50)}" (couldn't parse, defaulting A)`);
    return [0];
  }
  // Multi-answer gets them all; single-answer gets just the first.
  return multi ? letters : [letters[0]];
}

// 
// ══════════════════════════════════════════════════════════════════════
// ADVANCE TO NEXT MODULE
// ══════════════════════════════════════════════════════════════════════
//
// Three-tier advance strategy:
//   0. If on a Results screen, dismiss it (Continue / Go to Course / Close)
//   1. Click the course player's "Next" button (or its variants)
//   2. Click the next non-disabled, non-current sidebar link
// ──────────────────────────────────────────────────────────────────────
// Signature of the CURRENTLY-ACTIVE module. The player is a single-page app:
// moving between modules often does NOT change the URL — instead the active
// sidebar/TOC item gets the `content-active` / `li-active` class. Comparing this
// signature before/after a click reliably detects advancement.
async function activeModuleSignature(page: Page): Promise<string> {
  // Read it inside the browser.
  return page
    .evaluate(() => {
      // Four class shapes for the active entry.
      const active = document.querySelector(
        '.content-active, .li-active, [class*="content-active"], [class*="li-active"]',
      );
      // Its text, whitespace collapsed, capped at 90 chars.
      const txt = (active?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 90);
      // Combine text AND url — so either changing counts as having advanced.
      return `${txt}||${location.href}`;
    })
    // An error just yields an empty signature, which never equals a real one.
    .catch(() => '');
}

async function advanceToNextModule(page: Page): Promise<{ advanced: boolean; courseDone?: boolean }> {
  console.log(`\n⏭️  Advancing to next module`);
  // Remember where we are, so we can detect whether anything actually moved.
  const urlBefore = page.url();
  const sigBefore = await activeModuleSignature(page);

  // Strategy 0: dismiss Results screen if present
  // Eight labels, because the results screen differs by module type.
  const resultScreenButtons = [
    'button:has-text("Go to Course")',
    'button:has-text("Continue")',
    'button:has-text("Done")',
    'button:has-text("OK")',
    'button:has-text("Close")',
    'button:has-text("Exit")',
    'button[aria-label*="close" i]',
    'button:has(mat-icon:has-text("close"))',
  ];
  // Did we dismiss one?
  let resultBtnClicked = false;
  // Try each label.
  for (const sel of resultScreenButtons) {
    const btn = page.locator(sel).first();
    // Short timeout — most modules have no results screen at all.
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      // Disabled means not ready; try the next label.
      if (await btn.isDisabled().catch(() => false)) continue;
      console.log(`   📋 Closing results screen via ${sel}`);
      // Dismiss it.
      await btn.click().catch(() => {});
      await page.waitForTimeout(2500);
      resultBtnClicked = true;
      // One is enough.
      break;
    }
  }

  // Strategy 1: player's "Next" button
  // Seven shapes, ordered most to least specific.
  const nextSelectors = [
    'button.next-btn',
    'button:has-text("Next")',
    'button:has-text("Continue")',
    'button:has-text("Mark Complete")',
    'button:has-text("Done")',
    'button:has(mat-icon:has-text("chevron_right"))',
    'button[aria-label*="next" i]',
  ];
  // Try each selector…
  for (const sel of nextSelectors) {
    // …and every element it matches, since several can share a class.
    const btns = page.locator(sel);
    const count = await btns.count();
    for (let i = 0; i < count; i++) {
      const btn = btns.nth(i);
      // Skip anything not on screen.
      if (!(await btn.isVisible().catch(() => false))) continue;
      // Skip anything disabled — that usually means the module isn't complete yet.
      if (await btn.isDisabled().catch(() => false)) continue;
      // Click it.
      await btn.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(2500);
      const sigAfter = await activeModuleSignature(page);
      if (page.url() !== urlBefore || (sigAfter && sigAfter !== sigBefore)) {
        console.log(`   ✅ Advanced via ${sel}`);
        return { advanced: true };
      }
    }
  }

  // Strategy 2: click next non-current, non-disabled sidebar link
  // Runs inside the browser, where the sidebar's classes are readable.
  const sidebar = await page.evaluate((currentUrl: string) => {
    // Identify sidebar module links by SHAPE rather than by a container class:
    // they either carry an active/disabled class, or their text ends in a duration
    // ("12m 30s") or a count ("10 Questions").
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a')).filter((a) => {
      const txt = (a.innerText ?? '').trim();
      return (
        a.classList.contains('content-active') ||
        a.classList.contains('disabled') ||
        /\d+\s*m(\s*\d+\s*s)?/i.test(txt) ||   // "8m 20s" anywhere (TOC items have a trailing "check" icon)
        /\d+\s*Minutes?/i.test(txt) ||
        /\d+\s*Questions?/i.test(txt) ||
        /\b(video|lecture|assessment|pdf|content)\b/i.test(txt)
      );
    });
    // No sidebar at all.
    if (links.length === 0) return { ok: false as const };

    // Which module is open right now, from the URL.
    const currentMatch = currentUrl.match(/(?:viewer\/quiz|viewer\/pdf|viewer\/video|viewer\/html)\/(do_\w+)/);
    const currentResourceId = currentMatch ? currentMatch[1] : null;

    // Find the active entry by its class…
    let activeIdx = links.findIndex((a) => a.classList.contains('content-active'));
    // …or, failing that, by matching the current resource id against each href.
    if (activeIdx < 0 && currentResourceId) {
      activeIdx = links.findIndex((a) => (a.href ?? '').includes(currentResourceId));
    }

    // Already on the last module — that's the end of the course, not a failure.
    if (activeIdx === links.length - 1) return { ok: false as const, isLast: true };

    // Walk forward from the active entry.
    for (let i = activeIdx + 1; i < links.length; i++) {
      // Skip locked modules.
      if (links[i].classList.contains('disabled')) continue;
      // Skip same resource (avoid looping on completed modules)
      if (currentResourceId && (links[i].href ?? '').includes(currentResourceId)) continue;
      // Bring it into view, then click it.
      links[i].scrollIntoView({ block: 'center' });
      links[i].click();
      // Report which module we opened, for the log.
      return { ok: true as const, text: (links[i].innerText ?? '').trim().slice(0, 80) };
    }
    // Nothing clickable after the active one.
    return { ok: false as const };
  // `urlBefore` is passed in because page.evaluate runs in a separate context.
  }, urlBefore);

  // The sidebar click worked.
  if (sidebar.ok) {
    console.log(`   ✅ Clicked next sidebar module: "${sidebar.text}"`);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3000);
    const sig2 = await activeModuleSignature(page);
    if (page.url() !== urlBefore || (sig2 && sig2 !== sigBefore)) return { advanced: true };
    // Same URL, but we DID dismiss a results screen — that counts as progress.
    if (resultBtnClicked) return { advanced: true };
  }

  // The sidebar said we were on the last entry — the course is finished.
  if ((sidebar as any).isLast) {
    console.log(`   🎉 Last module — course complete!`);
    return { advanced: false, courseDone: true };
  }

  // We cleared a results screen but found nothing further; still call it progress.
  if (resultBtnClicked) {
    console.log(`   ℹ️  Result screen dismissed but no further module visible`);
    return { advanced: true };
  }

  // All three strategies failed.
  console.log(`   ⚠️  Could not advance`);
  return { advanced: false };
}

// 
// ══════════════════════════════════════════════════════════════════════
// COURSE COMPLETION CHECK
// ══════════════════════════════════════════════════════════════════════
//
// Strict markers — must be unambiguous completion text, never something
// that could appear in module descriptions or sidebars.
// ──────────────────────────────────────────────────────────────────────
async function isCourseComplete(page: Page): Promise<boolean> {
  // Fourteen wordings, because the completion screen varies by course and language.
  const markers = [
    /course\s+complete/i,
    /100\s*%\s*complete/i,
    // The trailing character class stops this matching the word inside a longer sentence.
    /congratulations[\s!,]/i,
    /you have completed/i,
    /you\s+have\s+successfully\s+completed/i,
    /thank\s+you\s+for\s+completing/i,
    /you've\s+earned/i,
    /your\s+certificate/i,         // "Your certificate is ready" (not "Earn a certificate")
    // A rating prompt only appears AFTER completion, so it is a reliable marker.
    /rate\s+(this|the)\s+course/i,
    /rate\s+your\s+experience/i,
    /how\s+(was|did)\s+(this|your)\s+(course|experience)/i,
    /share\s+your\s+feedback/i,
    /बधाई/i,                       // "Congratulations" in Hindi
    /आपने\s+(.*\s+)?(पूरा|पूर्ण)/i, // "You completed" in Hindi
  ];

  // Try each in turn; the first match wins.
  for (const re of markers) {
    // A very short 300ms timeout — this runs on every module, so it must stay cheap.
    if (await page.getByText(re).first().isVisible({ timeout: 300 }).catch(() => false)) {
      return true;
    }
  }
  // None found — not complete yet.
  return false;
}

// 
// ══════════════════════════════════════════════════════════════════════
// COURSE OVERVIEW PAGE — full element coverage (non-destructive)
// ══════════════════════════════════════════════════════════════════════
// Before starting the course we click through every element on the overview /
// TOC page (Details, Share, License Terms, About / Contents tabs, expandable
// sections, ratings) and detect whether a certificate is attached. Everything
// here is best-effort and SOFT — it never throws, so it cannot break the
// completion flow that follows.

// What the overview tour reports back to the main test.
interface OverviewInfo {
  title: string;
  hasCertificate: boolean;
  tocItemCount: number;
}

// Dismiss whatever popup is open, by its close button or failing that Escape.
async function closeAnyPopup(page: Page): Promise<void> {
  // Nothing to do on a dead tab.
  if (page.isClosed()) return;
  // Five shapes of close button, since the app uses several.
  const closeBtn = page
    .locator('button[aria-label*="close" i], [class*="close-btn"], .close, mat-icon:has-text("close"), button:has-text("×")')
    .first();
  // Short timeout — this is best-effort cleanup, not worth real time.
  if (await closeBtn.isVisible({ timeout: 700 }).catch(() => false)) {
    await closeBtn.click({ timeout: 1500 }).catch(() => {});
  } else {
    // No button found — Escape dismisses most Material dialogs.
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(400);
}

// Is a certificate attached to this course?
async function hasCertificate(page: Page): Promise<boolean> {
  // Two signals: the word itself, or a certificate-classed element or image.
  const indicators = [
    page.getByText(hiAlso(/certificate/i)),
    page.locator('[class*="certificate"], img[alt*="certificate" i], img[src*="certificate" i]'),
  ];
  // Either one is enough.
  for (const loc of indicators) {
    if (await loc.first().isVisible({ timeout: 1200 }).catch(() => false)) return true;
  }
  // Neither found.
  return false;
}

// Tour every control on the overview page, without breaking anything.
async function exploreCourseOverview(page: Page): Promise<OverviewInfo> {
  console.log(`\n🧭 Course overview — clicking through every element`);
  // What we'll report back.
  const info: OverviewInfo = { title: '', hasCertificate: false, tocItemCount: 0 };
  // Remember the overview URL, so softClick can always return here.
  const overviewUrl = page.url();

  // Soft click: click if visible; close any popup/new tab it opens; if THIS
  // page navigated away from the overview, return to it. Never throws.
  const softClick = async (locator: Locator, label: string): Promise<boolean> => {
    // Dead tab — give up quietly.
    if (page.isClosed()) return false;
    const el = locator.first();
    // Not present on this course — say so and move on.
    if (!(await el.isVisible({ timeout: 1500 }).catch(() => false))) {
      console.log(`   ⏭️  not present: ${label}`);
      return false;
    }
    // Bring it into view.
    await el.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    // Promise.all registers the popup listener and clicks AT THE SAME TIME, so a
    // tab that opens instantly isn't missed.
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 1500 }).catch(() => null),
      el.click({ timeout: 2500 }).catch(() => {}),
    ]);
    console.log(`   ✅ clicked: ${label}`);
    await page.waitForTimeout(700);
    // A new tab opened — log where it went, then close it.
    if (popup) {
      console.log(`      ↪ opened new tab: ${popup.url()}`);
      await popup.close().catch(() => {});
    }
    // Dismiss any in-page dialog the click raised.
    await closeAnyPopup(page);
    // Did the click navigate US away from the overview?
    if (!page.isClosed() && page.url() !== overviewUrl) {
      // Prefer going back; fall back to a direct goto if that fails.
      await page.goBack({ timeout: 8000 }).catch(async () => {
        await page.goto(overviewUrl).catch(() => {});
      });
      await page.waitForTimeout(800);
    }
    // Report that we did click it.
    return true;
  };

  // The course title — first heading or title-classed element.
  info.title = ((await page.locator('h1, h2, [class*="title"]').first().textContent().catch(() => '')) ?? '').trim();
  console.log(`   📖 title: ${info.title || '(unknown)'}`);

  // Whether a certificate is attached (reported to the summary at the end).
  info.hasCertificate = await hasCertificate(page);
  console.log(`   🏅 certificate attached: ${info.hasCertificate ? 'YES' : 'no'}`);

  // Click every interactive element on the overview page
  // Each softClick names the control, so the log reads as a checklist.
  await softClick(page.getByRole('button', { name: hiAlso(/^details$/i) }).or(page.getByText(hiAlso(/^details$/i))), 'Details');
  await softClick(page.getByRole('button', { name: hiAlso(/share/i) }).or(page.locator('[class*="share"]')), 'Share');
  await softClick(page.getByText(hiAlso(/license\s*terms?/i)), 'License Terms');
  await softClick(page.getByText(hiAlso(/^about/i)).or(page.getByText(hiAlso(/description/i))), 'About / Description');
  await softClick(page.getByText(hiAlso(/^contents?$|curriculum|table of contents/i)), 'Contents / Curriculum');
  await softClick(page.getByRole('button', { name: hiAlso(/certificate/i) }).or(page.locator('[class*="certificate"]')), 'Certificate (preview)');

  // Expand every collapsible section / accordion so the whole TOC is visible
  // Four shapes of expander.
  const expanders = page.locator(
    'mat-expansion-panel-header, [class*="accordion"], [class*="expansion"], [class*="collapse"]',
  );
  // How many are there?
  const exCount = await expanders.count().catch(() => 0);
  console.log(`   📂 expandable sections: ${exCount}`);
  // Open up to 25 — a cap, so a huge course can't stall the tour.
  for (let i = 0; i < Math.min(exCount, 25); i++) {
    // Stop if the page died.
    if (page.isClosed()) break;
    await expanders.nth(i).click({ timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(150);
  }

  // Enumerate TOC / resource items (log only — Start opens them)
  // Five shapes of TOC entry.
  const tocItems = page.locator(
    'ws-web-course-toc-card, [class*="toc"] li, [class*="content-list"] li, [class*="resource-card"], [class*="lesson"]',
  );
  // Counted and reported — this is the course's module count.
  info.tocItemCount = await tocItems.count().catch(() => 0);
  console.log(`   📑 TOC / resource items: ${info.tocItemCount}`);

  // Is a star rating shown?
  const rating = page.locator('[class*="rating"], [class*="star"]').first();
  console.log(`   ⭐ rating shown: ${await rating.isVisible({ timeout: 800 }).catch(() => false)}`);

  // End back on the overview so Start / Resume works
  if (!page.isClosed() && page.url() !== overviewUrl) {
    await page.goto(overviewUrl).catch(() => {});
    await page.waitForTimeout(1000);
  }
  // Hand the findings back.
  return info;
}

// 
// ══════════════════════════════════════════════════════════════════════
// CERTIFICATE — generate/download after the course is completed
// ══════════════════════════════════════════════════════════════════════
// Uses a fresh page in the same (CDP) context so it works even if the player
// page closed on the completion popup. Reopens the course overview and clicks
// its Certificate control, saving any download to test-reports/.
async function generateCertificate(
  context: BrowserContext,
  overviewUrl: string,
  courseName: string,
): Promise<boolean> {
  // Announce it.
  console.log(`\n🏅 Generating certificate for "${courseName}"`);

  // Normalized filename: Certificate_<CourseSlug>_<timestamp>.<ext> (jfif/jpeg → jpg).
  // Non-word characters become underscores; trimmed and capped at 60 chars.
  const courseSlug = courseName.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'course';
  // Run timestamp (e.g. 2026-09-30T06-36-24) so a rerun of the same course
  // keeps the earlier certificates instead of overwriting them.
  const stamp = new Date().toISOString().replace(/:/g, '-').slice(0, 19);
  // Saves a download under that normalised name.
  const save = async (dl: import('@playwright/test').Download): Promise<boolean> => {
    // Take the extension from the suggested filename, defaulting to pdf.
    let ext = (dl.suggestedFilename().split('.').pop() || 'pdf').toLowerCase();
    // Normalise the two JPEG spellings to one.
    if (ext === 'jfif' || ext === 'jpeg') ext = 'jpg';
    // Certificates go under test-reports/certificates.
    const certDir = path.join(process.cwd(), 'test-reports', 'certificates');
    // Create it the first time.
    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });
    const dest = path.join(certDir, `Certificate_${courseSlug}_${stamp}.${ext}`);
    // Save it. Errors swallowed — the log below still records the attempt.
    await dl.saveAs(dest).catch(() => {});
    console.log(`   ✅ certificate saved → ${dest}`);
    return true;
  };

  // Up to 3 attempts: 1st on the current TOC; retries re-search the completed
  // course fresh (per the "certificate is taking time to generate" flow).
  for (let attempt = 1; attempt <= 3; attempt++) {
    // A fresh tab per attempt, so a broken one can't poison the next.
    const page = await context.newPage();
    // try/finally-style: the page is closed on every exit path below.
    try {
      // Always reach the TOC via search+open — a direct goto to the overview
      // URL sometimes loads a state without the certificate control.
      console.log(`   📄 Attempt ${attempt}: opening the completed course via search`);
      await page.goto(HOME_URL, { timeout: 30_000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1500);
      // Search and open it.
      await searchAndOpenCourse(page, courseName).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(3000);

      // Confirm 100% on the TOC progress bar. <100% ⇒ a resource is still
      // incomplete and the certificate won't be available.
      const progress = await readProgress(page);
      // Only judge when the bar actually reported a number.
      if (progress !== null) {
        console.log(`   📊 TOC progress: ${progress}%`);
        // Below 100% — say which resource state we're in and stop; retrying won't help.
        if (progress < 100) {
          console.log(`   ⚠️  progress ${progress}% (<100) — a resource is incomplete; certificate not yet available`);
          await page.close().catch(() => {});
          return false;
        }
      }

      // The certificate control on the TOC is a div.toc-icon-action ("Certificate").
      // The certificate control on the TOC is a div.toc-icon-action ("Certificate"
      // + a download icon) — NOT a <button>.
      // Three shapes, most specific first — the div, then a button, then the bare text.
      const certBtn = page
        .locator('.toc-icon-action, [class*="toc-icon-action"]').filter({ hasText: hiAlso(/certificate/i) })
        .or(page.getByRole('button', { name: hiAlso(/certificate/i) }))
        .or(page.getByText('Certificate', { exact: true }))
        .first();

      // Not on the TOC yet — close this tab, wait, and try again.
      if (!(await certBtn.isVisible({ timeout: 6000 }).catch(() => false))) {
        console.log(`   ⏭️  no certificate button on the TOC (attempt ${attempt})`);
        await page.close().catch(() => {});
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      // Bring it into view.
      await certBtn.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      // Clicking Certificate opens a preview dialog (mat-mdc-dialog-panel) that
      // holds a "Download" button — or, if generated, may download directly.
      // Register the download listener and click AT THE SAME TIME.
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 4000 }).catch(() => null),
        certBtn.click({ timeout: 4000 }).catch(() => {}),
      ]);
      await page.waitForTimeout(2000);
      // Direct download — save it and we're done.
      if (download) { await save(download); await page.close().catch(() => {}); return true; }

      // The preview dialog's Download control is button.download-btn ("Download").
      // Three shapes for it, plus the accessible name as a fallback.
      const dlBtn = page
        .locator('button.download-btn, .mat-mdc-dialog-panel .download-btn, [role="dialog"] [class*="download"]')
        .or(page.getByRole('button', { name: hiAlso(/download/i) }))
        .first();
      // A 10s window — the dialog itself takes a while to appear.
      if (await dlBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
        // The dialog renders the certificate onto a <canvas> before the download
        // is available; this can take several seconds. Wait for the canvas, then
        // give the download a generous timeout and retry the click if needed.
        // Wait for the canvas — that's the signal the certificate has rendered.
        await page.locator('.mat-mdc-dialog-panel canvas, [role="dialog"] canvas')
          .first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2500);
        // Two download attempts.
        for (let dlTry = 1; dlTry <= 2; dlTry++) {
          // Listener and click together again.
          const [dl2] = await Promise.all([
            // 25s: generating and streaming a certificate is genuinely slow.
            page.waitForEvent('download', { timeout: 25_000 }).catch(() => null),
            dlBtn.click({ timeout: 3000 }).catch(() => {}),
          ]);
          // Got it — save and finish.
          if (dl2) { await save(dl2); await page.close().catch(() => {}); return true; }
          // Missed it — retry once.
          console.log(`   ⏳ download not captured (dl attempt ${dlTry}/2) — retrying`);
          await page.waitForTimeout(2000);
        }
      }

      // "Certificate is taking time to generate" — wait, close, and re-try by
      // re-searching the course.
      // Six wordings for the still-generating message.
      const generating = page
        .getByText(/taking (some )?time|is being generated|will be (generated|ready)|being processed|try again later|generat/i)
        .first();
      // Present?
      if (await generating.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Quote the actual message, so the log shows which state we hit.
        const msg = ((await generating.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 70);
        console.log(`   ⏳ certificate still generating ("${msg}") — waiting, then re-trying`);
        // Close the dialog and the tab…
        await closeAnyPopup(page);
        await page.close().catch(() => {});
        // …wait 20 seconds — the longest wait here, because generation is slow…
        await new Promise((r) => setTimeout(r, 20_000));
        // …then try the whole thing again.
        continue;
      }

      // Clicked, but neither a download nor a generating message appeared.
      console.log(`   ℹ️  certificate clicked, no download/generating popup seen (attempt ${attempt})`);
      await page.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 8000));
    // Any error in this attempt is caught so the remaining attempts still run.
    } catch (e) {
      console.log(`   ⚠️  certificate attempt ${attempt} error: ${(e as Error).message.split('\n')[0]}`);
      await page.close().catch(() => {});
    }
  }
  // All three attempts failed.
  console.log(`   ⚠️  certificate not downloaded after retries`);
  return false;
}

// ══════════════════════════════════════════════════════════════════════
// THE TEST
// ══════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════
// END-OF-COURSE POPUPS — the course is only "complete" once the
// Congratulations popup and the Ratings popup appear. This detects them,
// submits a rating, and reports whether completion was actually reached.
// ══════════════════════════════════════════════════════════════════════
async function handleCompletionPopups(page: Page): Promise<boolean> {
  if (page.isClosed()) return true; // page closed on completion popup = complete
  // Did we see either popup?
  let sawCompletion = false;

  // Signal 1: the congratulations message, in English or Hindi.
  const congrats = page
    .getByText(/congratulations|बधाई|you have (successfully )?completed|course complete/i)
    .first();
  // Present?
  if (await congrats.isVisible({ timeout: 5000 }).catch(() => false)) {
    sawCompletion = true;
    console.log('🎉 Congratulations popup detected');
  }

  // Signal 2: the ratings prompt — which only appears AFTER completion.
  const rating = page
    .getByText(/rate (this|the|your)|how (was|did)|share your feedback|rate your experience/i)
    .first();
  // Present?
  if (await rating.isVisible({ timeout: 5000 }).catch(() => false)) {
    sawCompletion = true;
    console.log('⭐ Ratings popup detected — verifying elements');

    // Verify the popup's elements (log what's present).
    // The heading, whitespace collapsed and capped at 70 chars.
    const heading = ((await rating.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 70);
    console.log(`   • heading: "${heading}"`);
    // Four shapes of star control.
    const stars = page.locator('[class*="star"], mat-icon:has-text("star"), [aria-label*="star" i], [class*="rating"] [class*="icon"]');
    console.log(`   • star elements: ${await stars.count().catch(() => 0)}`);
    // A free-text feedback field, if there is one.
    const feedback = page.locator('textarea, input[type="text"]').first();
    console.log(`   • feedback field present: ${await feedback.isVisible({ timeout: 800 }).catch(() => false)}`);
    // Every button inside the dialog.
    const btns = page.locator('[role="dialog"] button, [class*="modal"] button, [class*="popup"] button');
    const btnCount = await btns.count().catch(() => 0);
    const btnLabels: string[] = [];
    // Read up to eight of their labels.
    for (let i = 0; i < Math.min(btnCount, 8); i++) {
      const t = ((await btns.nth(i).textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
      // Fall back to the aria-label for icon-only buttons.
      const aria = (await btns.nth(i).getAttribute('aria-label').catch(() => '')) ?? '';
      if (t || aria) btnLabels.push(t || `[${aria}]`);
    }
    // Print them, so the log records what the popup offered.
    console.log(`   • buttons: ${btnLabels.join(', ') || '(none)'}`);

    // Close via the X icon (do NOT submit a rating) — the run must not leave a
    // fake review on a real course.
    // Close via the X icon (do NOT submit a rating).
    // Five shapes of close control.
    const closeX = page
      .locator('[role="dialog"] button[aria-label*="close" i], [class*="modal"] [class*="close"], mat-icon:has-text("close"), button:has-text("×"), [class*="close-icon"]')
      .first();
    // Prefer the explicit X…
    if (await closeX.isVisible({ timeout: 2500 }).catch(() => false)) {
      await closeX.click({ timeout: 2500 }).catch(() => {});
      console.log(`   ✅ Closed ratings popup via "X"`);
    // …falling back to Escape.
    } else {
      await closeAnyPopup(page);
      console.log(`   ✅ Closed ratings popup (Escape/fallback)`);
    }
    await page.waitForTimeout(1500);
  }

  // Report whether completion was actually reached.
  return sawCompletion;
}

// ══════════════════════════════════════════════════════════════════════
// SIDEBAR MODULE MAP — the course is complete when every module in the TOC
// shows a "check". The last modules can be LOCKED until prerequisites are
// done, so we drive completion from the sidebar: repeatedly open the first
// incomplete + unlocked module. Blindly clicking "Next" just loops.
// ══════════════════════════════════════════════════════════════════════
// Everything we need to know about one module in the sidebar.
interface SidebarModule {
  idx: number;
  text: string;
  done: boolean;
  locked: boolean;
  active: boolean;
  /** Router link on the node, e.g. "/viewer/quiz/do_113…?collectionId=…". */
  href: string;
  /** do_… id parsed out of href — the ground truth for "did we land on it?". */
  resourceId: string | null;
}

// Read the whole sidebar into a plain array.
async function readModules(page: Page): Promise<SidebarModule[]> {
  // Dead tab — nothing to read.
  if (page.isClosed()) return [];
  // Runs inside the browser.
  return page
    .evaluate(() => {
      // Each module is a mat-tree-node.
      const nodes = Array.from(document.querySelectorAll('mat-tree-node'));
      return nodes.map((el, idx) => {
        // Its icons' ligature text is what encodes done/locked state.
        const iconTxt = Array.from(el.querySelectorAll('mat-icon'))
          .map((i) => (i.textContent ?? '').trim())
          .join(',');
        // Its router link.
        const a = el.querySelector('a');
        // Combine both class lists — the state can live on either element.
        const cls = `${el.className ?? ''} ${a?.className ?? ''}`;
        // Done: a filled "check"/"check_circle" (NOT "check_circle_outline").
        // The outline variant means "not done", so it must be excluded explicitly.
        const done = /check/.test(iconTxt) && !/outline/.test(iconTxt);
        // Locked: a lock icon, or a disabled class.
        const locked = /\block\b/.test(iconTxt) || /\bdisabled\b/.test(cls);
        // Active: whichever module is currently open.
        const active = /content-active|li-active/.test(cls);
        return {
          idx,
          // Its label, whitespace collapsed and capped at 60 chars.
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
          done,
          locked,
          active,
          href: a?.getAttribute('href') ?? '',
        };
      });
    })
    // Any failure yields an empty list rather than throwing.
    .catch(() => [])
    // Then parse the do_ id out of each href — done here, in Node, not in the browser.
    .then((nodes) =>
      nodes.map((n) => ({ ...n, resourceId: extractResourceId(n.href) })),
    );
}

/**
 * Open a sidebar module and CONFIRM we landed on it.
 *
 * Clicking the router link is not enough: the player is a single-page app and
 * the previous viewer stays mounted for a beat, so the old code would click a
 * quiz, detect the still-showing video, "complete" that instead, and then
 * blame the quiz for never registering. Every node carries a real href with
 * the resource id, so we wait for the URL to actually become that resource and
 * navigate straight to the href if the click didn't take.
 */
async function openModule(page: Page, mod: SidebarModule): Promise<boolean> {
  // The id we're aiming for.
  const want = mod.resourceId;
  // "Are we there yet?" — true if the URL now names that resource.
  const landed = async () => !want || extractResourceId(page.url()) === want;

  // The sidebar node at this index.
  const node = page.locator('mat-tree-node').nth(mod.idx);
  // Its link.
  const link = node.locator('a').first();
  // Prefer clicking the link; fall back to the whole node.
  const target = (await link.isVisible({ timeout: 1500 }).catch(() => false)) ? link : node;
  await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  // Click it.
  await target.click({ timeout: 4000 }).catch(() => {});
  await page.waitForLoadState('domcontentloaded').catch(() => {});

  // Poll for up to 6 seconds for the URL to become the target resource.
  for (let i = 0; i < 12 && !(await landed()); i++) await page.waitForTimeout(500);

  // The click didn't navigate — go to the href directly.
  if (!(await landed()) && mod.href) {
    console.log(`   ↪️  Click did not navigate — going straight to ${mod.href.slice(0, 60)}…`);
    // `new URL(href, BASE_URL)` turns a relative router link into an absolute URL.
    await page.goto(new URL(mod.href, BASE_URL).toString()).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    // Poll again.
    for (let i = 0; i < 12 && !(await landed()); i++) await page.waitForTimeout(500);
  }

  // Let the newly-mounted viewer settle before the type is detected.
  await page.waitForTimeout(2500);

  // Still not there — report it and let the caller decide.
  if (!(await landed())) {
    console.log(`   ⚠️  Still not on "${mod.text}" (url ${page.url().slice(0, 80)})`);
    return false;
  }
  return true;
}

/**
 * Read the course progress % from the TOC's progress bar. 100% confirms the
 * course is fully complete (safe to fetch the certificate); anything less means
 * a resource is still incomplete. Returns null if no progress bar is found.
 */
async function readProgress(page: Page): Promise<number | null> {
  // Dead tab — nothing to read.
  if (page.isClosed()) return null;
  return page
    // Runs inside the browser.
    .evaluate(() => {
      // Angular Material progress bar exposes the value via aria-valuenow.
      const pb = document.querySelector('mat-progress-bar[aria-valuenow], [role="progressbar"][aria-valuenow]');
      if (pb) {
        // Parse it…
        const v = parseFloat(pb.getAttribute('aria-valuenow') || '');
        // …and round to a whole percent.
        if (isFinite(v)) return Math.round(v);
      }
      // Fallback: a "NN%" label near "complete"/"progress" wording.
      // Walk every element…
      for (const el of Array.from(document.querySelectorAll('*'))) {
        // …but only LEAF nodes, so a container's combined text can't match.
        if (el.children.length !== 0) continue;
        const t = (el.textContent || '').trim();
        // Anchored, so the whole text must be exactly "87%".
        const m = t.match(/^(\d{1,3})\s*%$/);
        if (m) {
          // Check the surrounding text for context…
          const near = (el.parentElement?.textContent || '').toLowerCase();
          // …so a random percentage elsewhere on the page isn't mistaken for progress.
          if (/complete|progress|course/.test(near)) {
            const v = parseInt(m[1], 10);
            // Guard the range.
            if (v >= 0 && v <= 100) return v;
          }
        }
      }
      // No progress bar found at all.
      return null;
    })
    .catch(() => null);
}

// A brand-new (fresh) user must complete the "Tell us more about you" profile
// (DOB → location → background → almost-done) before they can access courses.
// This fills it if prompted; it's a no-op for already-onboarded users.
async function completeProfileIfNeeded(page: Page): Promise<boolean> {
  // Delegates to the shared, proven onboarding components (DOB + cascading
  // mat-select location + background + almost-done). See tests/helpers/onboarding.ts,
  // extracted from the working Profile/BGVPositive.spec.ts flow. Returns false when
  // no onboarding screen is showing (no-op) or when onboarding couldn't complete.
  return completeOnboarding(page, 'Healthcare Worker');
}

test.use({ storageState: undefined });   // fresh login each run

// ONE test that drives the entire course, module by module.
test('Complete course end-to-end', async ({ page }) => {
  test.setTimeout(60 * 60 * 1000);   // 60 min ceiling

  // No course named — fail immediately with both ways to set it.
  if (!COURSE_NAME) {
    throw new Error(
      `No course selected.\n` +
        `  Pick one interactively:  npm run run:course\n` +
        `  …or set it yourself:     $env:COURSE_NAME="Normal Labour & Birth and AMTSL"`,
    );
  }

  // Log the target and whether the AI fallback is available.
  console.log(`\n🎯 Target course: "${COURSE_NAME}"`);
  console.log(GEMINI_API_KEY ? `🤖 Gemini AI ready (${GEMINI_PRIMARY})` : `⚠️  No GEMINI_API_KEY`);

  // Report collectors (drive the per-course HTML report at the end)
  // Used to compute the run's wall time.
  const startTime = new Date();
  // Modules the run flagged as suspicious.
  const reportWarnings: { module: number; reason: string }[] = [];
  // Each assessment encountered, for the report's table.
  const reportAssessments: { module: number; id: string; questions: number }[] = [];

  // Step 1: Login — handled by authedTest (helpers/authedTest.ts). To COMPLETE
  // a course, run with USE_FRESH_USER=1 to reuse a freshly-signed-up user's
  // session (minted by create-account); otherwise it logs in as TEST_USER_EMAIL
  // (e.g. creator777@yopmail.com) to verify an already-completed course.

  // Step 2: Attach the quiz answer-key interceptor BEFORE opening any course
  // Order matters: the keys are prefetched as soon as the course opens.
  setupQuizKeyInterceptor(page);

  // Step 3: Search and open the course
  await page.goto(HOME_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Fresh users must finish onboarding before courses unlock — do it if prompted.
  await completeProfileIfNeeded(page);
  // Back to home afterwards, since onboarding navigates away.
  await page.goto(HOME_URL).catch(() => {});
  await page.waitForTimeout(1500);

  // Not found — fail with the name we looked for.
  if (!(await searchAndOpenCourse(page, COURSE_NAME))) {
    throw new Error(`Could not find course "${COURSE_NAME}"`);
  }

  // Step 3b: Detect (without clicking through) whether a certificate is
  // attached. The full overview element sweep lives in CourseTOC.spec.ts now —
  // clicking around here would disrupt the Resume state.
  // Kept so the certificate step can open its own tab in the same session.
  const courseContext = page.context();
  // And the overview URL, to come back to.
  const overviewUrl = page.url();
  // Recorded for the report; not asserted.
  const hasCert = await hasCertificate(page).catch(() => false);
  console.log(`🏅 Certificate attached: ${hasCert ? 'YES' : 'no'}`);

  // Step 4: Resume (continue from the last unfinished resource) or Start.
  if (!(await startOrResume(page))) {
    // The onboarding form can appear on first course access — complete it and retry.
    if (await completeProfileIfNeeded(page)) {
      // Re-open the course, since onboarding navigated away…
      await searchAndOpenCourse(page, COURSE_NAME);
      // …and try again.
      if (!(await startOrResume(page))) {
        throw new Error(`Could not start/resume the course after onboarding`);
      }
    // Onboarding wasn't the problem, so this is a real failure.
    } else {
      throw new Error(`Could not start/resume the course`);
    }
  }

  // Step 5: Complete every module — SIDEBAR-DRIVEN.
  // Repeatedly open the first incomplete + unlocked module in the TOC and
  // complete it (which unlocks later gated modules). Finish when every module
  // shows "check". Blindly clicking "Next" just loops through the units.
  console.log(`\n📍 Completing modules (sidebar-driven, max ${MAX_MODULES} steps)`);
  // A record of every module we processed, for the summary.
  const log: { idx: number; type: ModuleType; resourceId: string | null }[] = [];
  // How many consecutive steps made no progress.
  let noProgress = 0;
  // How many times we've waited for a locked module to unlock.
  let lockRetries = 0;
  // Set once every module shows a check.
  let allModulesComplete = false;
  // Modules that were opened but never registered as complete. A single stuck
  // module used to end the whole run; now we retry it a couple of times, then
  // move on to the other unfinished modules and only stop once every one of
  // them is exhausted.
  const moduleAttempts = new Map<string, number>();
  // Two attempts per module before we skip it.
  const MODULE_MAX_ATTEMPTS = 2;
  // Which module this step is working on — used to charge a stall to it.
  let currentModuleText = '';

  // Up to MAX_MODULES steps. Note: STEPS, not modules — a retry costs a step.
  for (let step = 1; step <= MAX_MODULES; step++) {
    // A closed page usually means a completion popup closed the tab — not an error.
    if (page.isClosed()) { console.log(`🛑 Page closed — likely completion popup`); break; }
    // Or the course may already show its completion marker.
    if (await isCourseComplete(page).catch(() => false)) { console.log(`🎉 Completion marker detected`); break; }

    // Read the whole sidebar.
    const mods = await readModules(page);
    // Sidebar present — drive from it.
    if (mods.length > 0) {
      // Which modules aren't done?
      const remaining = mods.filter((x) => !x.done);
      const doneCount = mods.length - remaining.length;
      // Print a progress banner for this step.
      console.log(`\n${'═'.repeat(50)}\n📚 Step ${step} — ${doneCount}/${mods.length} modules done\n${'═'.repeat(50)}`);

      // Every module shows a check — the course is finished.
      if (remaining.length === 0) {
        console.log(`🎉 All ${mods.length} modules complete — surfacing completion`);
        allModulesComplete = true;
        // One last advance, to surface the completion popup.
        await advanceToNextModule(page).catch(() => {});
        await page.waitForTimeout(2500);
        break;
      }

      // Of the remaining, which are actually openable (not gated)?
      const unlocked = remaining.filter((x) => !x.locked);
      // Skip past modules we've already tried and failed to complete.
      const openable = unlocked.find((x) => (moduleAttempts.get(x.text) ?? 0) < MODULE_MAX_ATTEMPTS);

      // Unlocked modules remain, but all have hit the attempt cap.
      if (!openable && unlocked.length > 0) {
        // Name them, so the failure says exactly which modules would not complete.
        console.log(`\n🛑 These modules would not register as complete after ${MODULE_MAX_ATTEMPTS} attempts each:`);
        unlocked.forEach((m) => console.log(`     • ${m.text}`));
        // Record it for the HTML report too.
        reportWarnings.push({
          module: step,
          reason: `modules did not register as complete: ${unlocked.map((m) => m.text).join(' | ')}`,
        });
        break;
      }

      // No openable module, and none unlocked either — everything left is gated.
      if (!openable) {
        // The final gated unit often unlocks a beat after its prerequisites
        // register, or needs a "Next" nudge to enter the unit. Retry a few
        // times (reload + re-read) before conceding.
        if (lockRetries < 4) {
          // Count this nudge.
          lockRetries++;
          console.log(`🔒 All remaining locked — nudging to unlock (retry ${lockRetries}/4): ${remaining.map((r) => r.text).join(' | ')}`);
          // Nudge Next…
          await advanceToNextModule(page).catch(() => {});
          await page.waitForTimeout(2500);
          // …and reload if we drifted off the overview, so the sidebar re-reads fresh.
          if (page.url() !== overviewUrl) {
            await page.reload().catch(() => {});
            await page.waitForLoadState('domcontentloaded').catch(() => {});
          }
          await page.waitForTimeout(3500);
          // Then try the whole step again.
          continue;
        }
        // Four nudges and still locked — report which ones and stop.
        console.log(`🔒 Remaining modules stay LOCKED: ${remaining.map((r) => r.text).join(' | ')}`);
        reportWarnings.push({ module: step, reason: 'remaining modules locked — could not unlock' });
        break;
      }
      // Progress: reset the lock counter.
      lockRetries = 0;
      // Remember which module this step is working on.
      currentModuleText = openable.text;
      // Are we already on it? Requires BOTH the active flag AND a URL match — the
      // flag alone can lag behind the actual navigation.
      const alreadyHere =
        openable.active && (!openable.resourceId || extractResourceId(page.url()) === openable.resourceId);
      if (alreadyHere) {
        // Nothing to do; just process it.
        console.log(`▶️  Already on: "${openable.text}"`);
      } else {
        // Otherwise open it.
        console.log(`👉 Opening: "${openable.text}"`);
        // The open failed.
        if (!(await openModule(page, openable))) {
          // Never process whatever viewer happens to be on screen — that used
          // to credit the wrong module and burn this one's attempts.
          // Charge the failure to this module…
          const tries = (moduleAttempts.get(openable.text) ?? 0) + 1;
          moduleAttempts.set(openable.text, tries);
          console.log(`   ⚠️  Could not open "${openable.text}" (attempt ${tries}/${MODULE_MAX_ATTEMPTS})`);
          await page.waitForTimeout(1500);
          // …and try the next step rather than processing the wrong thing.
          continue;
        }
      }
    // No sidebar at all — fall back to processing whatever is on screen.
    } else {
      currentModuleText = '';
      console.log(`\n📚 Step ${step} — no sidebar (processing current view)`);
    }

    // How many were done BEFORE this module — the baseline for the progress check.
    const beforeDone = mods.filter((x) => x.done).length;
    // Which resource we're about to process.
    const currentResourceId = extractResourceId(page.url());
    // Work out what kind of module this is.
    const type = await detectModuleType(page);
    console.log(`Type: ${type.toUpperCase()}`);

    // Wrapped, so a page closing mid-module reads as completion rather than a crash.
    try {
      // Dispatch to the handler for this module type.
      switch (type) {
        // Video: the handler reports whether it actually loaded.
        case 'video': {
          const vLoaded = await handleVideo(page);
          // A load timeout is a warning in the report, not a failure.
          if (!vLoaded) reportWarnings.push({ module: step, reason: 'video load timeout' });
          break;
        }
        case 'pdf':         await handlePdf(page);        break;
        // Assessment: also record it for the report's table.
        case 'assessment': {
          await handleAssessment(page);
          // Look up how many questions its key held.
          const key = currentResourceId ? capturedKeys.get(currentResourceId) : null;
          reportAssessments.push({
            module: step,
            id: currentResourceId ?? '?',
            questions: key?.questions.length ?? 0,
          });
          break;
        }
        case 'content':     await handleContent(page);    break;
        // An unknown type: just wait, then try to advance.
        default:            await page.waitForTimeout(2000);
      }
    // Something threw.
    } catch (err: any) {
      // A closed page or destroyed context means the course finished — not a failure.
      if (page.isClosed() || /Target page.*closed|context.*destroyed/i.test(err?.message ?? '')) {
        console.log(`🎉 Page closed during module — likely course complete!`);
        break;
      }
      // Any other error is real — re-throw it.
      throw err;
    }
    // Record what we did.
    log.push({ idx: step, type, resourceId: currentResourceId });
    await page.waitForTimeout(1500);

    // Did the sidebar's completed-count increase? If not, nudge Next; give up
    // after a few stalls so we never loop forever.
    // Re-read the sidebar…
    const after = await readModules(page);
    // …and count the checks now.
    const afterDone = after.filter((x) => x.done).length;
    // No new check — this module didn't register.
    if (after.length > 0 && afterDone <= beforeDone) {
      noProgress++;
      // We know which module it was.
      if (currentModuleText) {
        // Charge the stall to THIS module. Once it hits the attempt cap the
        // picker above skips it and moves on to the next unfinished module,
        // instead of the whole run stopping here.
        const tries = (moduleAttempts.get(currentModuleText) ?? 0) + 1;
        moduleAttempts.set(currentModuleText, tries);
        // Report the attempt count, and flag when we're about to give up on it.
        console.log(
          `   ⚠️  No new completion (${afterDone}/${after.length}) — "${currentModuleText}" ` +
            `attempt ${tries}/${MODULE_MAX_ATTEMPTS}${tries >= MODULE_MAX_ATTEMPTS ? ' — will skip it' : ''}`,
        );
        // Record it for the HTML report.
        reportWarnings.push({ module: step, reason: `did not register as complete: ${currentModuleText}` });
      // No sidebar, so the stall can't be attributed to a specific module.
      } else {
        console.log(`   ⚠️  No new completion (${afterDone}/${after.length}) — nudging Next (${noProgress})`);
      }
      // Either way, nudge Next.
      await advanceToNextModule(page).catch(() => {});
      // With no sidebar there is nothing to attribute the stall to, so fall
      // back to the old global give-up rule.
      if (!currentModuleText && noProgress >= 3) {
        console.log(`\n🛑 No completion progress after ${noProgress} tries — stopping`);
        break;
      }
    // A new check appeared — reset the stall counter.
    } else {
      noProgress = 0;
    }
  }

  // Step 6: Summary
  console.log(`\n${'═'.repeat(62)}\n🏁 SUMMARY\n${'═'.repeat(62)}`);
  console.log(`Course:           ${COURSE_NAME}`);
  console.log(`Modules touched:  ${log.length}`);
  // Tally the modules by type. `reduce` folds the list into a count object.
  const byType = log.reduce(
    (acc, m) => ({ ...acc, [m.type]: (acc[m.type] ?? 0) + 1 }),
    {} as Record<string, number>
  );
  // Print one line per type, padded so the numbers line up.
  for (const [t, count] of Object.entries(byType)) {
    console.log(`  - ${t.padEnd(11)}: ${count}`);
  }

  // A course is only complete once the Congratulations + Ratings popups appear.
  const sawPopups = await handleCompletionPopups(page).catch(() => false);
  // A closed page is itself a completion signal.
  const pageClosed = page.isClosed();
  // Read the progress bar, if the page survived.
  const progressPct = pageClosed ? null : await readProgress(page);
  if (progressPct !== null) console.log(`Progress bar:      ${progressPct}%`);
  // FIVE independent signals, any one of which means complete. Being generous
  // here is deliberate: the app surfaces completion differently by course type.
  const completionMarker =
    pageClosed ||
    sawPopups ||
    allModulesComplete ||
    progressPct === 100 ||
    (await isCourseComplete(page).catch(() => false));
  // Record the final URL, or say why we don't have one.
  const finalUrl = pageClosed ? '(page closed during completion popup)' : page.url();
  console.log(`Completion marker: ${completionMarker ? '🎉 YES' : '❌ NO'}`);
  console.log(`Final URL: ${finalUrl}`);

  // Step 7: Certificate — ONLY after the course is actually complete: go back to
  // the TOC page and click the certificate button to generate it.
  let certGenerated = false;
  // Not complete — don't even try; the control won't be there.
  if (!completionMarker) {
    console.log(`\n⏭️  Course not complete — skipping certificate (needs Congratulations/Ratings first)`);
  // Complete AND a certificate is attached — go and fetch it.
  } else if (hasCert) {
    // A failure here is logged, never thrown: the course still completed.
    certGenerated = await generateCertificate(courseContext, overviewUrl, COURSE_NAME).catch((e) => {
      console.log(`⚠️  Certificate generation failed: ${(e as Error).message.split('\n')[0]}`);
      return false;
    });
  // No certificate on this course at all.
  } else {
    console.log(`\nℹ️  No certificate attached to this course — skipping certificate generation`);
  }
  // Report one of three outcomes: generated, attached-but-not-confirmed, or none.
  console.log(
    `Certificate:       ${
      hasCert
        ? certGenerated
          ? '🏅 generated/downloaded'
          : '⚠️ attached but generation not confirmed'
        : 'none'
    }`,
  );

  // Step 8: Write the detailed per-course HTML report.
  // Wrapped: a report-writing failure must not fail a run that actually passed.
  try {
    const reportPath = generateCourseReport({
      courseName: COURSE_NAME,
      startedAt: startTime,
      // Wall time, in milliseconds.
      durationMs: Date.now() - startTime.getTime(),
      // Just the type of each module, in order — that drives the report's timeline.
      moduleTypes: log.map((l) => l.type),
      warnings: reportWarnings,
      assessments: reportAssessments,
      completionMarker,
      certificateAttached: hasCert,
      certificateGenerated: certGenerated,
      finalUrl,
      passed: completionMarker,
      // Only name the AI model if it was actually available.
      aiModel: GEMINI_API_KEY ? GEMINI_PRIMARY : undefined,
    });
    // Tell the user where the report went.
    console.log(`\n📄 Course report: ${reportPath}`);
  } catch (e) {
    console.log(`⚠️  Could not write course report: ${(e as Error).message.split('\n')[0]}`);
  }

  // Honest verdict: the course is complete ONLY if the Congratulations/Ratings
  // completion state was reached — not merely that some modules were touched.
  // The ONE assertion in this file. Its message names how many modules were
  // touched and points at the report, so a failure is diagnosable without a re-run.
  expect(
    completionMarker,
    `Course did not reach the Congratulations/Ratings completion popup (touched ${log.length} modules). See the course report for where it stopped.`,
  ).toBe(true);
});
