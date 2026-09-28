# Sphere Web Automation — Detailed Session Summary

**Project:** `D:\Automation\SphereWebAutomation`
**Stack:** Playwright Test (`@playwright/test` ^1.59.1) + TypeScript (no build step) + ExcelJS + Gemini AI fallback
**Target app:** Sphere (Aastrika / Sunbird-iGOT) — an Angular Material SPA learning platform
**Environment:** Windows 11, PowerShell 5.1
**Date range:** covered through 2026-07-02.

---

## 1. Objectives & outcomes

| # | Goal | Status | Notes |
|---|------|--------|-------|
| 1 | Detailed project documentation | ✅ | `README.md` with per-spec run commands |
| 2 | Universal Excel report on every spec run | ✅ | Global via config reporter — no per-test wiring needed |
| 3 | Fix PublicPage failures | ✅ | 52/12 → 62/2 (remaining 2 are content items checked manually) |
| 4 | Fix public-login failures | ✅ | 10 failures → 0 |
| 5 | Switch all testing to localhost | ✅ | Central `BASE_URL` env switch |
| 6 | Authenticate on localhost | ✅ | Via CDP reuse of a logged-in Chrome |
| 7 | Split into two focused scripts | ✅ | `CourseComplete.spec.ts` + `CourseTOC.spec.ts` |
| 8 | Comprehensive course completion | ✅ | Validated end-to-end on "Care of Sick Newborn" |
| 9 | Certificate download + 100% progress confirmation | ✅ | Normalised filename, retry logic |
| 10 | Tarento-branded course report | ✅ | HTML, brand v3.2, logo omitted |
| 11 | Three output folders in `test-reports` | ✅ | excel-reports / course-reports / certificates |

---

## 2. Environment & URL switching

### The central switch
```ts
// playwright.config.ts
baseURL: process.env.BASE_URL ?? 'https://sphere.aastrika.org'
```
- `.env` sets `BASE_URL=http://localhost:3000` (the local box mirrors production).
- To run against prod, comment out the localhost line / set the prod URL.
- **Why localhost:** the user's localhost is mapped to production data, so tests run against real content without touching the public site.

### Critical run-location rule
`npx playwright` **must** be run from `D:\Automation\SphereWebAutomation\`, **never** from the `D:\Automation` root — otherwise every spec fails to resolve config/paths. (Saved as a memory.)

---

## 3. Authentication — why CDP won

### What failed first
1. **`connect.sid` cookie injection** → server returned **419 UNAUTHORIZED**.
2. Root cause: the app doesn't gate purely on the cookie. It reads **`localStorage.userUUID`** plus a cross-origin call to the **production API**. The session token isn't portable between a scripted context and the real logged-in origin.
3. Even injecting the full `localStorage` JSON (`userUUID`, `loginDetailsWithToken`) didn't hold — the app re-validates against prod.

### The working approach: CDP reuse
`tests/helpers/cdpTest.ts`:
- Connects to an **already-running, already-logged-in Chrome** via
  `chromium.connectOverCDP(process.env.CDP_ENDPOINT ?? 'http://localhost:9222')`.
- Reuses the existing browser context: `cdpBrowser.contexts()[0]`.
- Opens a **fresh page per test**, and **never closes** the user's browser.
- Exports `test` / `expect` so specs just `import { test, expect } from './helpers/cdpTest'`.

**Operational flow:** launch Chrome with `--remote-debugging-port=9222`, log into Sphere once by hand, then run the specs — they piggyback on that authenticated session.

---

## 4. Reliability engineering (the flakiness fixes)

| Problem | Root cause | Fix |
|---------|-----------|-----|
| Tests hung 60s then failed randomly | `networkidle` never settles on this SPA (long-poll/analytics) | Replaced **all 23** `networkidle` waits with `domcontentloaded` — the single biggest stability win |
| "Course advanced" detection wrong | SPA doesn't change the URL between modules | **Active-module signature**: read `.content-active`/`.li-active` text + URL; detect *change*, not a specific URL |
| Valid modules skipped in sidebar | Filter regex was over-anchored (`/^\d+\s*m$/`) | De-anchored to `/\d+\s*m(\s*\d+\s*s)?/i` + module-type keyword match |
| Assessment tried to answer 70 Qs on a 13-Q quiz | On-screen counter regex `/\d+\/\d+/` matched clinical text like **"BP is 100/70 mmHg"** → total = 70 | Use **`answerKey.questions.length`** as the authoritative count |
| Quiz stuck — Next disabled | Next only enables *after* Submit reveals the answer | **Submit-then-Next** per question |
| Course looped to a 50-module cap | `next-btn` wraps around; last unit is LOCKED | **Sidebar-driven loop** + lock-retry (4 attempts) |
| Certificate "not found" | Clicked non-actionable "Certificate" *text* | Real control is `div.toc-icon-action` filtered by `/certificate/i`; download via `button.download-btn` in the dialog |
| Malformed selector error | Mixed CSS + text engine in one list: `[class*="cne"], text=/CNE:/` | Split with `.or(page.getByText(/CNE:/))` |
| `scrollIntoViewIfNeeded` crashed before guard | Element not present | `safeScroll()` soft helper |
| Background output never flushed | `Select-Object -Last N` buffers | `--reporter=line` raw streaming + poll the `.output` file |
| `Move-Item` "file in use" | 6 xlsx open in Excel | Retried — all moved on 2nd pass |

---

## 5. `tests/CourseComplete.spec.ts` — completing an entire course

**Design:** a **sidebar-driven main loop**. It reads the module tree, opens the first module that is *incomplete AND unlocked*, processes it by type, then re-reads the sidebar. This survives the SPA's URL-less navigation and gated content.

### Core helpers
- **`readModules(page): SidebarModule[]`** — over `mat-tree-node`:
  - `done` = icon matches `/check/` and NOT `/outline/`
  - `locked` = `/lock/` or `/disabled/`
  - `active` = `/content-active|li-active/`
- **`openModule(page, idx)`** — clicks the nth tree node's anchor.
- **`handleVideo(page): Promise<boolean>`** — waits for `<video>`, then `waitForFunction` for `readyState ≥ 1` + `duration`, then `readyState ≥ 3` (**fully loaded before completing** — the user's explicit requirement), plays muted, seeks to end, waits for the `ended` event.
- **`clickNextQuestion(page, isLast)`** — quiz reveal pattern: click Submit/Check (`/^(submit|check)( answer)?$/i`) then Next (`/^next$/i`).
- **`answerWithKey(...)`** — fills answers from the captured key; breaks on empty question (`if (!question) break`).
- **`handleAssessment(...)`** — total from `answerKey.questions.length`; then `finishAssessment(page)`.
- **`finishAssessment(page)`** — loops Submit/Continue/Finish until it leaves the quiz.
- **`handleCompletionPopups(page)`** — detects the **Congratulations** popup + **Ratings** popup; for ratings, **verifies** heading/stars/feedback/buttons, then clicks the **X close** (does NOT submit a rating).
- **`readProgress(page): number|null`** — reads `mat-progress-bar[aria-valuenow]` or a scoped "NN%" text.
- **`generateCertificate(context, overviewUrl, courseName)`** — up to 3 attempts; each attempt searches + opens the course, reads progress (skips if < 100%), clicks `div.toc-icon-action` (`/certificate/i`), then `button.download-btn`; `save()` normalises `.jfif`/`.jpeg` → `.jpg` and writes `test-reports/certificates/Certificate_<slug>.<ext>`.

### The "honest completion" rule
A course is **not** declared complete just because modules were clicked. Completion requires observable proof:
```
completionMarker = pageClosed || sawPopups || allModulesComplete
                   || progressPct === 100 || isCourseComplete
```
Final assertion: `expect(completionMarker).toBe(true)`. No false PASS.

### Answer-key interception
- Intercepts `quiz.json` / `assessment.json` responses keyed by `resourceId`.
- Shape: `QuizKey = { questions: QuizQuestion[]; passPercentage }`.
- **Gemini `gemini-2.5-flash`** is the fallback when no key is captured.

### Gated finals
Drug List / Final / Post-test units stay **LOCKED** until prerequisites complete → the lock-retry (4 tries) reopens them after upstream modules finish.

**Validated:** "Care of Sick Newborn" — 33/33 modules, gated finals unlocked, real Congratulations popup, honest PASS, certificate downloaded, 100% progress confirmed.

---

## 6. `tests/CourseTOC.spec.ts` — the TOC page suite

- **22 self-contained tests** — each has its own `searchAndOpenCourse` / `startOrResume` / `closeAnyPopup` helpers, uses CDP auth, and **skips** any case not present on the course.
- Covers the ~32 spreadsheet cases: back button (`ws-widget-btn-page-back`), share (`ws-widget-btn-content-share`), Start / "Start Again" / resume, progress bar, certificate icon, overview elements, etc.
- `beforeEach` includes an open-retry so a slow first load doesn't fail the whole case.

---

## 7. Reporting & output organisation

### Excel report (every run)
`reporters/excel-reporter.ts` (custom Playwright reporter, ExcelJS) → `test-reports/excel-reports/TestReport_*.xlsx`. Global via config, so **every** spec run produces one automatically.

### Tarento-branded course report (course runs)
`tests/helpers/courseReport.ts` → `generateCourseReport(d: CourseReportData): string` renders HTML to `test-reports/course-reports/CourseReport_*.html`:
- Navy / teal / gold palette, Inter / Lato type.
- Verdict uses state colours (success `#22C55E` / error `#EF4444`).
- One gold headline KPI, a timeline strip, assessments table, observations, environment block.
- Type colours: video = navy, assessment = teal, pdf = `#FF9400`, content = `#31005E`.
- **No Tarento logo** (per instruction) — only a "Tarento brand" text credit in the footer.

### Three-folder layout
```
test-reports/
├─ excel-reports/    ← TestReport_*.xlsx    (all specs)      132 files migrated
├─ course-reports/   ← CourseReport_*.html  (course runs)     15 files migrated
└─ certificates/     ← Certificate_*        (downloads)        2 files migrated
```
Each writer creates its folder if missing. Existing files were moved into place; `tsc --noEmit` is clean (exit 0).

---

## 8. Tarento brand (v3.2) — applied to generated docs

- **80 / 15 / 5** composition: Navy `#17283C` (~80%), Teal `#1E8F8E` (~15%), Gold `#F0A500` (~5%, one loud signal per view).
- Type: Open Sans / Lato base; Inter for web; JetBrains Mono for code.
- State colours are functional only: success `#22C55E`, warning `#F59E0B`, error `#EF4444`.
- **The logo is intentionally omitted** on all generated deliverables.
- Saved as memory `tarento-brand-guide.md` and reused for any future document/slide/sheet/web output.

---

## 9. Run commands

All from `D:\Automation\SphereWebAutomation\`:

```powershell
npm run test                 # all specs
npm run run:public           # PublicPage
npm run run:login            # public-login
npm run run:private          # PrivatePage
npm run run:account          # account
npm run run:mycourse         # my courses
npm run run:competency       # competency
npm run run:course-toc       # Course TOC page tests
npm run run:scorm            # SCORM
npm run report               # open the HTML report

# Complete a specific course (headed, over CDP — Chrome must be logged in on :9222):
$env:COURSE_NAME="Care of Sick Newborn"; npx playwright test tests/CourseComplete.spec.ts --headed
```

---

## 10. PowerShell / tooling gotchas
- No `&&` — chain with `;` (or `; if ($?) { ... }` for conditional).
- Don't `2>&1` on native exes (PS 5.1 wraps stderr as errors and flips `$?`).
- Files written for other tools: use `-Encoding utf8` (default is UTF-16 LE BOM).
- TypeScript runs directly (no build); typecheck via `tsc --noEmit`.

---

## 11. Files created / changed

| File | Purpose |
|------|---------|
| `README.md` | Full project documentation |
| `tests/helpers/cdpTest.ts` | CDP auth fixture (reuse logged-in Chrome) |
| `tests/helpers/courseReport.ts` | Tarento-styled HTML course report |
| `tests/CourseComplete.spec.ts` | Comprehensive course completion (main file) |
| `tests/CourseTOC.spec.ts` | TOC page test suite (22 tests) |
| `reporters/excel-reporter.ts` | Excel reporter → `excel-reports/` |
| `playwright.config.ts` | `BASE_URL` env switch |
| `.env` | `BASE_URL`, CDP/session, `GEMINI_API_KEY` (gitignored) |
| `package.json` | Added `run:*` scripts |
| Memory | `tarento-brand-guide.md`, `baseurl-env-switch.md`, `localhost-auth-cdp.md`, `run-playwright-from-subdir.md` |

---

## 12. Timeline of the work
1. Wrote README; confirmed Excel report is global.
2. Fixed PublicPage & public-login failures.
3. Switched to localhost via `BASE_URL`; attempted cookie auth → 419 → adopted CDP.
4. Split work into two scripts.
5. Built comprehensive course completion: video-load wait, quiz Submit-then-Next, assessment via answer key (fixed the 70-vs-13 counter bug), gated-final lock-retry, honest completion via popups + progress.
6. Added certificate generation/download with retry + filename normalisation + 100% progress gate.
7. Applied Tarento branding to the course report; saved the brand guide to memory.
8. Organised outputs into three folders and migrated existing files.
