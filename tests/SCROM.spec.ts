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
 *   $env:COURSE_NAME="Normal Labour & Birth and AMTSL"; npx playwright test tests/CourseComplete.spec.ts --headed
 *
 * Optional:
 *   $env:GEMINI_API_KEY="..." for the Gemini fallback
 *   $env:VERBOSE_CHECKBOX="1" to log each checkbox click strategy
 *
 * Account: learnerid001@yopmail.com / Sunbird@123
 */

// Straight from Playwright — this spec logs in itself rather than using the authed harness.
import { test, expect, Page, Locator } from '@playwright/test';
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
// The login page.
const LOGIN_URL = `${BASE_URL}/public/login`;
// The logged-in home, where the course search box lives.
const HOME_URL  = `${BASE_URL}/page/home`;
// Hard-coded learner account — this spec does its own password login.
const EMAIL     = 'learnerid001@yopmail.com';
const PASSWORD  = 'Sunbird@123';

const MAX_MODULES      = 50;     // safety ceiling on module count
const VIDEO_WATCH_MS   = 5_000;  // how long to "watch" videos
const PDF_MAX_PAGES    = 60;     // max PDF pages to flip through
const GEMINI_RPM_DELAY = 6_500;  // self-throttle (safe for 10 RPM free tier)

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

// Which course to complete. Empty means the test skips.
const COURSE_NAME    = process.env.COURSE_NAME ?? '';
// The Gemini key. Without it the AI fallback is unavailable.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? '';

// ══════════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════════
// Every kind of module a course can contain.
type ModuleType = 'video' | 'pdf' | 'assessment' | 'content' | 'scorm' | 'unknown';

// The shape of the answer-key JSON Sphere serves for each assessment.
type QuizQuestion = {
  questionId: string;
  question: string;
  options: { text: string; optionId: string; isCorrect: boolean }[];
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
// LOGIN
// ══════════════════════════════════════════════════════════════════════
// Log in with the hard-coded learner account.
async function login(page: Page) {
  console.log(`🔐 Logging in as ${EMAIL}`);
  // Open the login page.
  await page.goto(LOGIN_URL);
  await page.waitForLoadState('networkidle');

  // The password radio, identified by exclusion: it's the one in the
  // usePasswordOrOTP group that ISN'T the OTP radio.
  await page.locator('input[type="radio"][name="usePasswordOrOTP"]:not(#useOTPRB)')
    // `force` because Material hides the real input behind a styled wrapper.
    .first().check({ force: true });
  await page.waitForTimeout(400);

  // "The first input that isn't a radio, password or hidden field" — the identifier box.
  await page.locator('input:not([type="radio"]):not([type="password"]):not([type="hidden"])')
    .first().fill(EMAIL);
  // Then the password.
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  // Submit. Anchored, so it can't match "Login with OTP".
  await page.getByRole('button', { name: hiAlso(/^login$/i) }).click();

  // Wait for the redirect into the app.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  console.log(`✅ Logged in`);
}

// ══════════════════════════════════════════════════════════════════════
// SEARCH + OPEN COURSE
// ══════════════════════════════════════════════════════════════════════
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
  // Match on the first 8 characters only — long titles get truncated in result cards.
  const prefix = courseName.slice(0, Math.min(8, courseName.length));

  // Click the first text match for the course title
  const titleMatch = page.getByText(new RegExp(`^${prefix}`, 'i')).first();
  // Did we find one?
  if (await titleMatch.isVisible({ timeout: 5_000 }).catch(() => false)) {
    // Log the full title we're about to click.
    const title = (await titleMatch.textContent())?.trim() ?? '';
    console.log(`👆 Clicking: "${title}"`);
    // Open it.
    await titleMatch.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3500);
    // A changed URL is the proof the click really opened the course.
    if (page.url() !== urlBefore) {
      console.log(`✅ Course opened`);
      return true;
    }
  }

  // Either no result matched, or the click didn't navigate.
  console.log(`❌ Could not open course "${courseName}"`);
  return false;
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
  // Same ID format in both URL types: `do_11342049404909158411532`
  const m = url.match(/(?:viewer\/quiz\/|content\/)(do_\w+)/);
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

  // /viewer/html/ is used by BOTH plain content pages and SCORM packages.
  // SCORM is identified by an iframe that loads `index_lms.html`.
  if (/\/viewer\/html|\/content\b/i.test(url)) {
    // Wait a moment for iframe to render
    await page.waitForTimeout(2000);
    // Look for a SCORM-shaped iframe inside the browser.
    const hasScormIframe = await page.evaluate(() => {
      // Every iframe on the page…
      const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe'));
      // …does any of them point at a SCORM bundle?
      return iframes.some((f) => /index_lms\.html|scormcontent|scorm/i.test(f.src ?? ''));
    });
    // Yes — this is an interactive package, not a plain page.
    if (hasScormIframe) {
      console.log(`   📦 SCORM iframe detected (index_lms.html)`);
      return 'scorm';
    }
    // No SCORM iframe, so it's ordinary content.
    return 'content';
  }

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

// Watch a video module.
async function handleVideo(page: Page) {
  console.log(`🎬 VIDEO — playing`);
  // The video element.
  const video = page.locator('video').first();
  if (await video.isVisible().catch(() => false)) {
    // Skip to near-end so we don't wait the full duration
    // Runs inside the browser, where the element's API is available.
    await video.evaluate((v: HTMLVideoElement) => {
      // Start playback — some players only register progress once playing.
      v.play().catch(() => {});
      // Then jump to one second before the end. `isFinite` guards a live or
      // not-yet-loaded stream, whose duration is Infinity or NaN.
      if (isFinite(v.duration) && v.duration > 0) v.currentTime = Math.max(0, v.duration - 1);
    }).catch(() => {});
  }
  // Linger briefly so the player reports the watch.
  await page.waitForTimeout(VIDEO_WATCH_MS);
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

// 
// 
// ══════════════════════════════════════════════════════════════════════
// SCORM HANDLER
// ══════════════════════════════════════════════════════════════════════
//
// SCORM packages are interactive HTML5 bundles that load in a same-origin
// iframe at `…/index_lms.html`. The user advances through slides by clicking
// a "Next" button inside the iframe. Completion is registered via the SCORM
// JavaScript API (window.API_1484_11 or window.API) which the package calls
// after the last slide. The outer course-player listens for those calls
// and unlocks the module Next button.
//
// Strategy:
//   1. Find the iframe pointing to index_lms.html
//   2. Inside the iframe, find a Next/Continue/forward button
//   3. Click it in a loop until it disappears or becomes disabled
//   4. As a safety net, try calling the SCORM API directly to mark
//      completion (LMSSetValue + LMSFinish) — harmless if the package
//      already did it
// ──────────────────────────────────────────────────────────────────────
async function handleScorm(page: Page) {
  console.log(`📦 SCORM — playing through slides`);

  // Wait for the SCORM iframe to load
  await page.waitForTimeout(2000);
  // Find it among the page's frames, by URL shape.
  const scormFrame = page.frames().find((f) =>
    /index_lms\.html|scormcontent|scorm/i.test(f.url())
  );

  // No iframe — fall back to treating it as ordinary content.
  if (!scormFrame) {
    console.log(`   ⚠️  SCORM iframe not found — falling back to content handler`);
    await handleContent(page);
    return;
  }

  // Log which bundle we found.
  console.log(`   📂 Found SCORM iframe: ${scormFrame.url().slice(0, 100)}`);

  // Wait for the iframe content to be ready
  try {
    await scormFrame.waitForLoadState('domcontentloaded', { timeout: 10_000 });
    await page.waitForTimeout(2000);
  // A timeout here is not fatal — try the slides anyway.
  } catch { /* proceed regardless */ }

  // Click Next inside the iframe until we run out of slides
  const SCORM_MAX_SLIDES = 100;
  // How many slides we've advanced.
  let slideCount = 0;
  // How many consecutive passes found no Next button.
  let stuckCount = 0;

  // Up to 100 slides.
  for (let i = 0; i < SCORM_MAX_SLIDES; i++) {
    // Selector candidates for the Next button. Most SCORM packages from
    // Articulate / Captivate / iSpring use one of these.
    const nextSelectors = [
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Forward")',
      'button[aria-label*="next" i]',
      'button[aria-label*="forward" i]',
      'button.next-btn, button.btn-next, button#next',
      'a:has-text("Next")',
      'a[aria-label*="next" i]',
      // Iconic chevron / arrow buttons
      '[class*="next"]:not([disabled])',
      '[class*="forward"]:not([disabled])',
    ];

    // Did any selector work this pass?
    let clicked = false;
    // Try each in turn.
    for (const sel of nextSelectors) {
      // Wrapped: a bad selector must not abort the loop.
      try {
        const btn = scormFrame.locator(sel).first();
        // Skip if not on screen.
        if (!(await btn.isVisible({ timeout: 500 }).catch(() => false))) continue;
        // Skip if disabled — that means the last slide.
        if (await btn.isDisabled().catch(() => false)) continue;

        // Click it. `force` because SCORM overlays often sit on top of their buttons.
        await btn.click({ timeout: 3000, force: true }).catch(() => {});
        clicked = true;
        slideCount++;
        // Per-slide logging is opt-in, since 100 slides would flood the log.
        if (process.env.VERBOSE_SCORM) {
          console.log(`   ➡️  Slide ${slideCount} (via ${sel})`);
        }
        // One click per pass — stop trying other selectors.
        break;
      } catch { /* try next selector */ }
    }

    // Nothing clicked this pass.
    if (!clicked) {
      stuckCount++;
      // TWO consecutive empty passes before giving up — one alone is often just a
      // slide still animating in.
      if (stuckCount >= 2) {
        console.log(`   ✅ No more Next button after ${slideCount} slides — assuming complete`);
        break;
      }
      // Try waiting a moment in case the slide is loading animations
      await page.waitForTimeout(1500);
      continue;
    }
    // A successful click resets the stuck counter.
    stuckCount = 0;
    await page.waitForTimeout(900);   // give the slide time to render
  }

  // Safety net: try calling the SCORM API directly to mark complete.
  // This is harmless if the package already reported completion.
  // Runs inside the iframe, where the SCORM API object lives.
  const scormApiCalled = await scormFrame.evaluate(() => {
    // Wrapped: a locked-down package may throw on access.
    try {
      // SCORM 2004 (API_1484_11) or SCORM 1.2 (API)
      // Check the frame itself AND its parent — packages put it in either.
      const api = (window as any).API_1484_11 ?? (window as any).parent?.API_1484_11;
      const api12 = (window as any).API ?? (window as any).parent?.API;

      // SCORM 2004 branch.
      if (api) {
        // Mark it complete…
        api.SetValue?.('cmi.completion_status', 'completed');
        // …and passed…
        api.SetValue?.('cmi.success_status',    'passed');
        // …with a full score…
        api.SetValue?.('cmi.score.scaled',      '1');
        // …then commit, which is what actually persists it.
        api.Commit?.('');
        return 'SCORM 2004 API called';
      }
      // SCORM 1.2 branch — different method names, same intent.
      if (api12) {
        api12.LMSSetValue?.('cmi.core.lesson_status', 'completed');
        api12.LMSSetValue?.('cmi.core.score.raw',     '100');
        api12.LMSCommit?.('');
        return 'SCORM 1.2 API called';
      }
      // Neither API present.
      return 'no SCORM API found';
    // Report the error rather than throwing.
    } catch (err: any) {
      return `error: ${err?.message?.slice(0, 80)}`;
    }
  // And a final guard in case the evaluate itself fails.
  }).catch(() => 'evaluate failed');

  // Report which API (if any) we managed to call.
  console.log(`   🔌 SCORM API: ${scormApiCalled}`);
  await page.waitForTimeout(2000);
}

// ══════════════════════════════════════════════════════════════════════
// ASSESSMENT HANDLER
// ══════════════════════════════════════════════════════════════════════
// Answer an assessment module, with the best available strategy.
async function handleAssessment(page: Page) {
  // Look up the key captured for THIS assessment.
  const answerKey = getAnswerKeyForUrl(page.url());
  // Its resource id, for the log.
  const resourceId = extractResourceId(page.url()) ?? '?';

  // Say up front which strategy we're taking — the most useful line in the run.
  if (answerKey) {
    console.log(`📝 ASSESSMENT — using captured answer key for ${resourceId}`);
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

  // Detect total question count from "1/N" counter
  const counter = await page.locator('text=/\\d+\\/\\d+/').first().textContent().catch(() => '');
  // Pull N out of "1/12"; default to 5 if the counter isn't there.
  const total = parseInt(counter?.match(/\d+\/(\d+)/)?.[1] ?? '5');
  console.log(`   ${total} questions to answer`);

  // A usable key — take the accurate route.
  if (answerKey && answerKey.questions.length > 0) {
    // Log the pool size and the pass mark.
    console.log(`   🔑 Answer key pool: ${answerKey.questions.length} questions, pass: ${answerKey.passPercentage ?? '?'}%`);
    await answerWithKey(page, answerKey, total);
  // No key — fall back to the AI.
  } else {
    console.log(`   🤖 Falling back to Gemini AI`);
    await answerWithGeminiBatch(page, total);
  }
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
    // Default an undetectable input type to radio — the safer guess, since
    // clicking one option can't over-answer a checkbox question.
    const questionType: 'radio' | 'checkbox' =
      scraped.inputType === 'unknown' ? 'radio' : scraped.inputType;

    console.log(`      📝 Type: ${questionType.toUpperCase()} | "${question.slice(0, 80)}"`);

    // Nothing scraped — answer A and move on rather than stalling.
    if (options.length === 0) {
      console.log(`      ⚠️  No options scraped — defaulting to A`);
      await selectAnswer(page, 0, questionType);
      await clickNextQuestion(page, q === total);
      continue;
    }

    // Log every option, lettered, so the run is auditable after the fact.
    options.forEach((o, i) =>
      console.log(`         [${String.fromCharCode(65 + i)}] ${o.slice(0, 70)}`)
    );

    // Find the matching question in the JSON pool
    const match = findMatchingQuestion(question, options, key.questions);
    // The matcher DECLINED rather than guessing — default to A and say so.
    if (!match) {
      console.log(`      ⚠️  No JSON match — defaulting to A`);
      await selectAnswer(page, 0, questionType);
      await clickNextQuestion(page, q === total);
      continue;
    }

    // Get all options marked isCorrect: true
    const correctOptions = match.options.filter((o) => o.isCorrect);
    // A poisoned entry — nothing is flagged correct.
    if (correctOptions.length === 0) {
      console.log(`      ⚠️  Key has no correct answers — defaulting to A`);
      await selectAnswer(page, 0, questionType);
      await clickNextQuestion(page, q === total);
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
      console.log(`      ⚠️  No correct answers mapped — defaulting to A`);
      await selectAnswer(page, 0, questionType);
      await clickNextQuestion(page, q === total);
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
// ANSWER STRATEGY 2: GEMINI AI (fallback when no key available)
// ══════════════════════════════════════════════════════════════════════
//
// Three phases:
//   1. Walk forward through every question with placeholder answers,
//      scraping each one.
//   2. Send the whole batch to Gemini in ONE API call.
//   3. Click Re-attempt → walk forward again with the real answers.
// ──────────────────────────────────────────────────────────────────────
async function answerWithGeminiBatch(page: Page, total: number) {
  // Phase 1: walk through, scraping and answering A.
  console.log(`\n   📋 Phase 1: scraping all ${total} questions`);
  // Everything we scrape, in order.
  const collected: { stem: string; options: string[]; inputType: 'radio' | 'checkbox' }[] = [];

  // One iteration per question.
  for (let q = 1; q <= total; q++) {
    // Wait for it to render.
    await waitForQuestionReady(page);
    const scraped = await scrapeCurrentQuestion(page);
    // Default an undetectable type to radio.
    const qType: 'radio' | 'checkbox' =
      scraped.inputType === 'unknown' ? 'radio' : scraped.inputType;
    console.log(`      Q${q}/${total} [${qType}]: "${scraped.question.slice(0, 70)}"`);
    // Record it for the batch call.
    collected.push({ stem: scraped.question, options: scraped.options, inputType: qType });
    // Answer A as a placeholder — we only need to get to the end.
    await selectAnswer(page, 0, qType);
    await clickNextQuestion(page, q === total);
  }

  // Phase 2: ONE API call for the whole quiz — this is what fits the free tier.
  console.log(`\n   🤖 Phase 2: batch-asking Gemini`);
  // Question number → answer letter.
  let answerMap: Record<number, string> = {};
  // Wrapped: a failed batch leaves the placeholders in place rather than crashing.
  try {
    answerMap = await askGeminiBatch(collected);
    // Report how many of the questions the model actually answered.
    console.log(`      ✅ Got ${Object.keys(answerMap).length}/${total} answers`);
  } catch (err: any) {
    console.log(`      ⚠️  Batch failed: ${err?.message ?? err}`);
  }

  // Phase 3: re-attempt and apply real answers
  // Three accepted labels for the retry control.
  const reattemptBtn = page.getByRole('button', { name: hiAlso(/re.?attempt|try again|retake/i) }).first();
  // Present?
  if (await reattemptBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log(`   ▶️  Clicking Re-attempt`);
    // Start the second pass.
    await reattemptBtn.click();
    await page.waitForTimeout(2500);

    // Walk forward again, this time with real answers.
    for (let q = 1; q <= total; q++) {
      console.log(`\n   ❓ Q${q}/${total}`);
      // Wait for each question to render.
      await waitForQuestionReady(page);

      // The letter Gemini gave for this question.
      const letter = answerMap[q];
      // What we scraped for it on the first pass; `??` guards a short array.
      const qInfo = collected[q - 1] ?? { options: [], inputType: 'radio' as const };
      // Default to A.
      let idx = 0;
      if (letter) {
        // Convert the letter to a 0-based index — charCode 65 is 'A'.
        const candidate = letter.charCodeAt(0) - 65;
        // Guard the range: a model answering "F" to a 4-option question is ignored.
        if (candidate >= 0 && candidate < qInfo.options.length) idx = candidate;
      }
      console.log(`      ✅ Selecting [${String.fromCharCode(65 + idx)}] (${qInfo.inputType})`);
      // Select it, using the input type we recorded on pass 1.
      await selectAnswer(page, idx, qInfo.inputType);
      await clickNextQuestion(page, q === total);
    }
  // No retry control — the placeholders stand, and we say so.
  } else {
    console.log(`   ⚠️  No Re-attempt button — quiz submitted with placeholders`);
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

/** Click the Next/Submit button between questions. */
async function clickNextQuestion(page: Page, isLast: boolean): Promise<void> {
  // Prefer Next…
  let btn = page.getByRole('button', { name: hiAlso(/^next$/i) }).first();
  // …and fall back to Submit on the last question.
  if (!(await btn.isVisible().catch(() => false))) {
    btn = page.getByRole('button', { name: hiAlso(/^submit$/i) }).first();
  }
  // Neither on screen — nothing to do.
  if (!(await btn.isVisible().catch(() => false))) return;
  // Disabled means nothing is selected, or the quiz is already over.
  if (await btn.isDisabled().catch(() => false)) {
    // On the last question that means the quiz is over.
    if (isLast) console.log(`      ℹ️  Assessment finished`);
    return;
  }
  // Go.
  await btn.click();
  await page.waitForTimeout(1500);
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

/**
 * Send all collected questions to Gemini in one call.
 * Returns a map: { 1: "B", 2: "D", ... } (question number -> letter).
 */
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
    const opts = q.options
      .map((o, j) => `   [${String.fromCharCode(65 + j)}] ${o}`)
      .join('\n');
    // Number each question so the reply can be mapped back.
    return `Q${i + 1}: ${q.stem}\n${opts}`;
  }).join('\n\n');

  // The prompt. It names the clinical domains and warns that questions may be in
  // Hindi, then demands bare JSON so the reply is machine-readable.
  const prompt =
`You are answering a medical/clinical assessment (WHO newborn-care protocols, KMC, family planning, emergency triage, referral guidance). Questions may be in Hindi (Devanagari) or mixed Hindi-English. Use accurate medical and clinical knowledge.

Answer ALL ${questions.length} questions below. Respond with ONLY a JSON object mapping each question number to its correct option letter. No prose, no markdown fences.

Example format: {"1":"B","2":"D","3":"A"}

${block}`;

  // Try the primary model, then the cheaper fallback.
  for (const model of [GEMINI_PRIMARY, GEMINI_FALLBACK]) {
    // Respect the rate limit before each call.
    await throttleGemini();
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
  // Both models failed — an empty map leaves the placeholder answers in place.
  return {};
}

/** Parse Gemini's JSON response into a {questionNum: letter} map. */
function parseAnswerMap(raw: string, count: number): Record<number, string> {
  const map: Record<number, string> = {};

  // Strategy 1: strict JSON
  // Strip any markdown code fences the model added despite being told not to.
  const cleaned = raw.replace(/```json|```/g, '').trim();
  // Find the outermost {...} block.
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
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
    // Malformed JSON — fall through to strategy 2 rather than failing.
    } catch { /* fall through */ }
  }

  // Strategy 2: regex scrape "1: B", "Q1 B", "1) B" lines
  // Only bother if strategy 1 came up short.
  if (Object.keys(map).length < count) {
    // Matches "Q1: B", "1. B", "1) B" and "1 - B".
    const re = /Q?\s*(\d{1,2})\s*[:.)\-]\s*([A-Z])/gi;
    let m: RegExpExecArray | null;
    // exec with a /g regex walks all matches.
    while ((m = re.exec(raw))) {
      const n = parseInt(m[1], 10);
      // Don't overwrite anything strategy 1 already found.
      if (n && !map[n]) map[n] = m[2].toUpperCase();
    }
  }

  // Whatever we managed to recover.
  return map;
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
async function advanceToNextModule(page: Page): Promise<{ advanced: boolean; courseDone?: boolean }> {
  console.log(`\n⏭️  Advancing to next module`);
  // Remember where we are, so we can detect whether anything actually moved.
  const urlBefore = page.url();

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
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(2500);
      // A changed URL is the proof we actually advanced.
      if (page.url() !== urlBefore) {
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
        /\d+m(\s+\d+s)?$/.test(txt) ||
        /\d+\s*Minutes?/i.test(txt) ||
        /\d+\s*Questions?/i.test(txt)
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
    // Let the module load.
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    // A changed URL is the proof we moved.
    if (page.url() !== urlBefore) return { advanced: true };
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

// ══════════════════════════════════════════════════════════════════════
// THE TEST
// ══════════════════════════════════════════════════════════════════════
test.use({ storageState: undefined });   // fresh login each run

// ONE test that drives the entire course, module by module.
test('Complete course end-to-end', async ({ page }) => {
  test.setTimeout(60 * 60 * 1000);   // 60 min ceiling

  // No course named — fail immediately with an example command.
  if (!COURSE_NAME) {
    throw new Error(`Set COURSE_NAME env var. Example:\n  $env:COURSE_NAME="Normal Labour & Birth and AMTSL"`);
  }

  // Log the target and whether the AI fallback is available.
  console.log(`\n🎯 Target course: "${COURSE_NAME}"`);
  console.log(GEMINI_API_KEY ? `🤖 Gemini AI ready (${GEMINI_PRIMARY})` : `⚠️  No GEMINI_API_KEY`);

  // Step 1: Login
  await login(page);

  // Step 2: Attach the quiz answer-key interceptor BEFORE opening any course
  // Order matters: the keys are prefetched as soon as the course opens.
  setupQuizKeyInterceptor(page);

  // Step 3: Search and open the course
  await page.goto(HOME_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  // Not found — fail with the name we looked for.
  if (!(await searchAndOpenCourse(page, COURSE_NAME))) {
    throw new Error(`Could not find course "${COURSE_NAME}"`);
  }

  // Step 4: Start or resume the course
  if (!(await startOrResume(page))) {
    throw new Error(`Could not start the course`);
  }

  // Step 5: Complete each module
  console.log(`\n📍 Completing modules (max ${MAX_MODULES})`);
  // A record of every module we processed, for the summary.
  const log: { idx: number; type: ModuleType; resourceId: string | null }[] = [];
  // How many consecutive times we failed to advance.
  let stuck = 0;
  // The previous module's resource id, used for the stuck check below.
  let lastResourceId: string | null = null;

  // Walk up to MAX_MODULES modules.
  for (let m = 1; m <= MAX_MODULES; m++) {
    console.log(`\n${'═'.repeat(50)}\n📚 Module ${m}\n${'═'.repeat(50)}`);

    // Check for course completion BEFORE processing
    // The course may already be finished when we arrive.
    if (await isCourseComplete(page).catch(() => false)) {
      console.log(`🎉 Course complete marker detected — stopping`);
      break;
    }
    // A closed page usually means a completion popup closed the tab — not an error.
    if (page.isClosed()) {
      console.log(`🛑 Browser page closed — likely course-complete popup. Stopping.`);
      break;
    }

    // Detect if we're stuck on the same resource as last iteration
    const currentResourceId = extractResourceId(page.url());
    // The same id twice running means Next silently did nothing — stop rather than loop.
    if (currentResourceId && currentResourceId === lastResourceId) {
      console.log(`🛑 Same resource as previous module (${currentResourceId}) — stuck, stopping`);
      break;
    }
    lastResourceId = currentResourceId;

    // Process this module
    // Work out what kind of module this is.
    const type = await detectModuleType(page);
    console.log(`Type: ${type.toUpperCase()}`);

    // Wrapped, so a page closing mid-module reads as completion rather than a crash.
    try {
      // Dispatch to the handler for this module type.
      switch (type) {
        case 'video':       await handleVideo(page);      break;
        case 'pdf':         await handlePdf(page);        break;
        case 'assessment':  await handleAssessment(page); break;
        case 'scorm':       await handleScorm(page);      break;
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
    log.push({ idx: m, type, resourceId: currentResourceId });

    // Check again after the module
    if (await isCourseComplete(page).catch(() => false)) {
      console.log(`🎉 Course complete marker detected after module — stopping`);
      break;
    }

    // Advance
    let result: { advanced: boolean; courseDone?: boolean };
    // Same closed-page handling as above.
    try {
      result = await advanceToNextModule(page);
    } catch (err: any) {
      if (page.isClosed() || /Target page.*closed|context.*destroyed/i.test(err?.message ?? '')) {
        console.log(`🎉 Page closed during advance — likely course complete!`);
        break;
      }
      throw err;
    }

    // The sidebar reported the last module — done.
    if (result.courseDone) break;
    // Couldn't advance.
    if (!result.advanced) {
      stuck++;
      // TWO consecutive failures before giving up — one alone is often a slow render.
      if (stuck >= 2) {
        console.log(`\n🛑 Stuck — exiting`);
        break;
      }
      // Wait five seconds and try once more.
      await page.waitForTimeout(5000).catch(() => {});
    // A successful advance resets the counter.
    } else {
      stuck = 0;
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

  // Only readable if the page survived.
  if (!page.isClosed()) {
    // Did we end on a completion marker?
    const done = await isCourseComplete(page).catch(() => false);
    console.log(`Completion marker: ${done ? '🎉 YES' : '❌ NO'}`);
    console.log(`Final URL: ${page.url()}`);
  // A closed page is itself the completion signal.
  } else {
    console.log(`Completion marker: 🎉 YES (page closed during completion popup)`);
  }

  // hard — the ONE assertion in this file: at least one module was processed.
  expect(log.length).toBeGreaterThanOrEqual(1);
});