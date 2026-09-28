/**
 * Test case catalog — Part 4: courses, competency, API and monitoring.
 */
import { PROD, PROD_AUTH, API_ENV, ANY_ENV } from './tc-01-public.mjs';

export const part4 = [

// ══════════════════════════════════════════════════════════════════
// COURSE TOC / OVERVIEW — tests/CourseTOC.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'TOC',
  module: 'Course Overview (TOC) Page',
  spec: 'tests/CourseTOC.spec.ts',
  command: 'npm run run:course-toc  (set COURSE_NAME first)',
  env: PROD_AUTH,
  precondition: 'A logged-in session is available and COURSE_NAME is set. Each test re-opens the course overview page via search.',
  rows: [
    ['1. Search for the target course and open it.\n2. Read the course title on the overview banner.', 'COURSE_NAME env var', 'The course title is visible on the overview page.'],
    ['1. Open the course overview.\n2. Locate the CNE hours badge.', '-', 'The "CNE hours" badge is visible.'],
    ['1. Open the course overview.\n2. Read the duration value.', '-', 'The course duration is visible.'],
    ['1. Open the course overview.\n2. Read the rating and the review count.', '-', 'Both the rating value and the review count are visible.'],
    ['1. Open the course overview.\n2. Read the author line.', '-', 'The author line "By: <organization>" is visible.'],
    ['1. Open the course overview.\n2. Locate the action icon row.', '-', 'Details, Certificate and Share icons are all visible.'],
    ['1. Open the course overview.\n2. Click the "Details" icon.', 'Click: Details', 'The course details popup opens.'],
    ['1. Open the details popup.\n2. Click the "X" close control.', 'Click: X', 'The details popup closes and the overview page is restored.'],
    ['1. Open the course overview.\n2. Click the "Certificate" icon.', 'Click: Certificate', 'A certificate popup is displayed.'],
    ['1. Open the certificate popup.\n2. Click "Close".', 'Click: Close', 'The certificate popup closes.'],
    ['1. Open the course overview.\n2. Click the "Share" icon.', 'Click: Share', 'Shareable options are displayed.'],
    ['1. Open the course overview.\n2. Locate the primary action button on the banner.', '-', 'The Resume / Start button is visible.'],
    ['1. Open the course overview.\n2. Locate the content tab strip.', '-', 'The Overview, Modules and Discussion tabs are all visible.'],
    ['1. Open the course overview.\n2. Click the "Modules" tab.', 'Click: Modules', 'The module list is displayed.'],
    ['1. Open the course overview.\n2. Click the "Discussion" tab.', 'Click: Discussion', 'The Discussion tab is clickable and its panel opens.'],
    ['1. Open the course overview.\n2. Scroll to the Description block.', '-', 'The "Description" section is visible.'],
    ['1. Open the course overview.\n2. Scroll to the License terms block.', '-', 'The "License terms" section is visible.'],
    ['1. Open the course overview.\n2. Inspect the License terms block for the CC link.', '-', 'The Creative Commons link is shown (test skips gracefully when the course does not expose one).'],
    ['1. Open the course overview.\n2. Click the author / organization name.', 'Click: By: <organization>', 'The organization page opens.'],
    ['1. Open the course overview.\n2. Click the back icon.', 'Click: back icon', 'The browser leaves the course overview page.'],
    ['1. Open the course overview.\n2. Click "Start" (or "Resume").', 'Click: Start / Resume', 'The course player opens on the first / last-unfinished resource.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// COURSE COMPLETION E2E — tests/CourseComplete.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'CRS',
  module: 'Course Completion End-to-End',
  spec: 'tests/CourseComplete.spec.ts',
  command: 'npm run run:course   |   npm run run:course-fresh',
  env: PROD_AUTH,
  precondition: 'COURSE_NAME must be set (npm run run:course picks one interactively). One automated test with a 60-minute ceiling; each row below is a verification point inside that run.',
  rows: [
    ['1. Read COURSE_NAME from the environment.\n2. Abort with a clear message if it is missing.', 'COURSE_NAME env var', 'The run refuses to start without a target course and prints the correct usage.'],
    ['1. Log in — either as the standard test user, or reuse a freshly signed-up user when USE_FRESH_USER=1.', 'TEST_USER_EMAIL / freshly minted account', 'An authenticated session is established before any course is opened.'],
    ['1. Attach the quiz answer-key network interceptor before opening any course.', '-', 'The interceptor is active, so every assessment JSON the portal prefetches is captured.'],
    ['1. Open the Home page.\n2. If a fresh user is prompted for onboarding, complete the profile form (Healthcare Worker).', 'Background: Healthcare Worker', 'Onboarding completes so courses are unlocked for the new user.'],
    ['1. Search for the target course by name.\n2. Open it from the results.', 'COURSE_NAME', 'The course is found and its overview page opens; the run fails with a clear error if it cannot be found.'],
    ['1. On the overview page, detect whether a certificate is attached (without clicking through).', '-', 'Certificate presence is correctly detected and reported.'],
    ['1. Click "Resume" (or "Start") on the overview banner.\n2. If the onboarding form appears instead, complete it and retry.', 'Click: Resume / Start', 'The course player opens at the last unfinished resource.'],
    ['1. Read the module sidebar (TOC).\n2. Identify each module as done / not done / locked.', '-', 'Every module and its completion and lock state are read correctly from the sidebar.'],
    ['1. Open the first incomplete and unlocked module in the sidebar.\n2. Detect its content type.', '-', 'The module opens and its type is classified as video, PDF, assessment or content page.'],
    ['1. For a VIDEO module: play the video and watch long enough for the portal to register progress.', 'Module type: video', 'The video loads and plays; a load timeout is recorded as a warning rather than silently passing.'],
    ['1. For a PDF module: open the PDF viewer and page through the document.', 'Module type: PDF (up to 60 pages)', 'Every page is flipped through so the portal marks the resource as consumed.'],
    ['1. For a CONTENT module: open the content page and scroll through it.', 'Module type: content page', 'The content page is consumed and marked complete.'],
    ['1. For an ASSESSMENT module: use the intercepted answer key to select the correct options.\n2. Submit the quiz.', 'Module type: assessment | answer key (isCorrect flags)', 'All questions are answered correctly from the answer key and the assessment is submitted and passed.'],
    ['1. If the answer key is unavailable or poisoned (all options flagged false), fall back to the Gemini AI batch answering strategy.', 'GEMINI_API_KEY, model gemini-2.5-flash', 'Questions are scraped, answered by the AI fallback, and applied on the re-attempt run.'],
    ['1. After each module, re-read the sidebar.\n2. Compare the completed count before and after.', '-', 'The completed-module count increases; a module that will not register is retried up to 2 times, then skipped with a recorded warning.'],
    ['1. If every remaining module is locked, nudge "Next" and reload, up to 4 retries.', '-', 'Gated modules unlock as their prerequisites register; a permanent lock is recorded as a warning instead of hanging the run.'],
    ['1. Continue until every module in the sidebar shows the completed check mark.', 'Max 50 module steps', 'All modules are completed.'],
    ['1. On completion, handle the Congratulations and Ratings popups.', '-', 'The completion popups appear and are handled; this is the authoritative signal that the course is complete.'],
    ['1. Read the course progress bar after completion.', '-', 'The progress bar reads 100%.'],
    ['1. If the course is complete AND a certificate is attached, return to the overview page and click the certificate button.', '-', 'The certificate is generated and downloaded.'],
    ['1. If the course is NOT complete, skip certificate generation.', '-', 'Certificate generation is correctly skipped, and the reason is logged.'],
    ['1. Write the per-course HTML report (modules touched by type, assessments and question counts, warnings, completion marker, certificate status, duration).', '-', 'A detailed HTML report is written to test-reports/course-reports/.'],
    ['1. Assert the final verdict.', '-', 'The test passes ONLY if the Congratulations/Ratings completion state was actually reached — touching modules alone is not accepted as a pass.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// SCORM COURSE COMPLETION — tests/SCROM.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'SCO',
  module: 'SCORM Course Completion End-to-End',
  spec: 'tests/SCROM.spec.ts',
  command: 'npm run run:scorm   (set COURSE_NAME first)',
  env: PROD,
  precondition: 'COURSE_NAME must be set. Signs in fresh with the dedicated learner account. One automated test with a 60-minute ceiling; each row is a verification point inside that run.',
  rows: [
    ['1. Read COURSE_NAME from the environment.\n2. Abort with usage instructions if missing.', 'COURSE_NAME env var', 'The run refuses to start without a target course.'],
    ['1. Open the login page.\n2. Sign in with the dedicated SCORM learner account.', 'learnerid001@yopmail.com / Sunbird@123', 'Login succeeds and the authenticated Home page loads.'],
    ['1. Attach the quiz answer-key network interceptor before opening any course.', '-', 'The interceptor is active for every assessment in the course.'],
    ['1. Search for the target course by name and open it.', 'COURSE_NAME', 'The course is found and its overview page opens.'],
    ['1. Click "Start" (or "Resume") on the overview banner.', 'Click: Start / Resume', 'The course player opens.'],
    ['1. Detect the current module type.\n2. Handle it accordingly.', '-', 'Module type is classified as video, PDF, assessment, SCORM package or content page.'],
    ['1. For a SCORM module: load the SCORM package iframe and drive it to completion.', 'Module type: SCORM', 'The SCORM package loads, is played through, and reports completion back to the portal.'],
    ['1. For a VIDEO module: play the video for the configured watch duration.', 'Module type: video', 'The video plays and progress is registered.'],
    ['1. For a PDF module: page through the document.', 'Module type: PDF (up to 60 pages)', 'All pages are flipped so the resource is marked consumed.'],
    ['1. For a CONTENT module: consume the content page.', 'Module type: content page', 'The content page is marked complete.'],
    ['1. For an ASSESSMENT module: answer from the intercepted answer key, falling back to Gemini AI when the key is missing or poisoned.', 'Answer key / GEMINI_API_KEY', 'The assessment is answered correctly and submitted.'],
    ['1. After each module, click "Next" to advance.\n2. Detect whether the resource id actually changed.', '-', 'The player advances to the next module; repeating on the same resource is detected and the run stops rather than looping.'],
    ['1. Detect the course-complete marker before and after each module.', 'Max 50 modules', 'Completion is detected as soon as it happens (marker, completion popup, or the player tab closing).'],
    ['1. Print the run summary: course name, modules touched, and a breakdown by module type.', '-', 'A complete summary of the run is produced.'],
    ['1. Assert the final verdict.', '-', 'At least one module was processed and the course reached its completion state.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// COMPETENCY DASHBOARD — tests/Competency.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'CMP',
  module: 'Competency Dashboard & Level Climb',
  spec: 'tests/Competency.spec.ts',
  command: 'npm run run:competency',
  env: PROD_AUTH,
  precondition: 'A logged-in session is available. COMPETENCY_NAME is optional — the first Re-Assess card is used when omitted.',
  rows: [
    ['1. Navigate to the Competency Dashboard.\n2. Wait for it to render.', '-', 'The Competency Dashboard opens successfully.'],
    ['1. Open the "Required" tab.\n2. Check whether any competencies are listed for the logged-in role.', '-', 'The Required tab is read and it is correctly determined whether competencies load for this role.'],
    ['1. If no competencies load, open Account then Organizational Details to fix the role.', 'Click: Account > Organizational Details', 'The Organizational Details form opens so the role can be corrected.', 'Skipped when the role already loads competencies.'],
    ['1. Set the Background field.', 'Background: Healthcare Worker', 'The Background dropdown accepts the value.', 'Skipped when no role fix is needed.'],
    ['1. Set the Designation field.', 'Designation: ANM/MPW', 'The Designation dropdown accepts the value.', 'Skipped when no role fix is needed.'],
    ['1. Set the Organization Type field.', 'Organization Type: sample value', 'The Organization Type dropdown accepts the value.', 'Skipped when no role fix is needed.'],
    ['1. Click Save on the Organizational Details form.', 'Click: Save', 'The organizational details are saved successfully.', 'Skipped when no role fix is needed.'],
    ['1. Reopen the Competency Dashboard after the role fix.', '-', 'Competencies are now available for the corrected role.'],
    ['1. Open the "Explore" tab.\n2. Open the Job Description view.', 'Click: Explore > Job Description', 'The Job Description view lists roles and their competencies.'],
    ['1. Open the "Explore" tab.\n2. Open the Passbook view.', 'Click: Explore > Passbook', 'The Passbook view opens and renders.'],
    ['1. Check that competencies are listed under either the Required tab or the Job Description view.', '-', 'At least one competency is available to work with.'],
    ['1. Select the target competency card (COMPETENCY_NAME, or the first Re-Assess card).', 'COMPETENCY_NAME (optional)', 'The target competency is selected and its title is captured.'],
    ['1. Open the next available assessment for the competency.\n2. Answer every question using the intercepted answer key.\n3. Submit and read the result.', 'Level 1 | answer key or Gemini fallback', 'Level 1 assessment is completed and passed.'],
    ['1. Open the Level 2 assessment.\n2. Answer and submit.', 'Level 2 | answer key or Gemini fallback', 'Level 2 assessment is completed and passed (skipped if no further level is available).'],
    ['1. Open the Level 3 assessment.\n2. Answer and submit.', 'Level 3 | answer key or Gemini fallback', 'Level 3 assessment is completed and passed (skipped if no further level is available).'],
    ['1. Open the Level 4 assessment.\n2. Answer and submit.', 'Level 4 | answer key or Gemini fallback', 'Level 4 assessment is completed and passed (skipped if no further level is available).'],
    ['1. Open the Level 5 assessment.\n2. Answer and submit.', 'Level 5 | answer key or Gemini fallback', 'Level 5 assessment is completed and passed (skipped if no further level is available).'],
    ['1. Detect a poisoned answer key (every option flagged isCorrect:false).\n2. Fall through to the Gemini AI batch strategy.', 'GEMINI_API_KEY', 'The poisoned key is detected and the AI fallback answers the questions on the re-attempt run.'],
    ['1. Return to the dashboard.\n2. Open the Passbook tab.\n3. Look for the completed competency.', '-', 'The Passbook lists entries, and the competency cleared during this run appears in it.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// COMPLETE A NAMED COMPETENCY — tests/CompleteCompetency.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'CCM',
  module: 'Complete a Named Competency (All Levels)',
  spec: 'tests/CompleteCompetency.spec.ts',
  command: 'npm run run:complete-competency   |   .\\run-competency.ps1 "<name>"',
  env: PROD,
  precondition: 'COMPETENCY_NAME is required. Runs with the standard account sphereid041@yopmail.com. One automated test with a 40-minute ceiling; each row is a verification point inside that run.',
  rows: [
    ['1. Read COMPETENCY_NAME from the environment.\n2. Abort with usage instructions if it is missing.', 'COMPETENCY_NAME env var', 'The run refuses to start without a named competency.'],
    ['1. Check BASE_URL.\n2. Reject a localhost target unless USE_CDP=1.', 'BASE_URL', 'The run fails fast with a clear message when localhost is targeted without CDP, because localhost cannot do password login.'],
    ['1. Log in with the standard competency account.', 'sphereid041@yopmail.com / Sunbird@123', 'Login succeeds and the session is authenticated.'],
    ['1. Open the Competency Dashboard.\n2. Assert the session is genuinely logged in before hunting for cards.', '-', 'The dashboard renders for an authenticated user; an unauthenticated shell is detected rather than mistaken for "competency not found".'],
    ['1. Find the named competency card on the dashboard.\n2. Open its next available assessment.', 'COMPETENCY_NAME', 'The correct competency is located and its next level opens.'],
    ['1. Read the level number from the screen (never assume it).', '-', 'The actual level number is read from the UI.'],
    ['1. After the player opens, read the collectionId from the URL.\n2. Compare it against the id captured at the first level.', '-', 'Every level belongs to the SAME competency; if a different collectionId is opened, the run stops rather than climbing the wrong competency.'],
    ['1. Answer the quiz using the intercepted answer key.\n2. If the key is poisoned, fall back to Gemini AI.\n3. Submit and read the result.', 'Answer key / GEMINI_API_KEY', 'The level assessment is answered and passed; the answering mode used is recorded.'],
    ['1. Repeat for each level until no further level is available.', 'Levels 1 to 5', 'Every level of the named competency is climbed in order.'],
    ['1. If a level fails, stop the climb.', '-', 'The run stops immediately, because a failed level cannot unlock the next one.'],
    ['1. Assert that at least one level was found and cleared.', '-', 'At least one level of the named competency was attempted and passed.'],
    ['1. Assert that every attempted level passed.', '-', 'All attempted levels are marked passed.'],
    ['1. Assert that no level outside the 1-5 range was attempted.', '-', 'No out-of-range level was climbed.'],
    ['1. Assert that no level number was climbed twice.', '-', 'Each level is climbed exactly once; a repeat would mean the run wandered into another competency.'],
    ['1. Return to the dashboard.\n2. Open the Passbook tab.\n3. Find the entry for the named competency.', '-', 'The competency is listed in the Passbook — confirming the portal actually recorded the climb.'],
    ['1. Read the level stated on the Passbook entry.\n2. Compare it with the highest level cleared this run.', '-', 'The Passbook level is at least the highest level cleared, proving the later levels were recorded.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// API — AUTH CONTRACT — tests/api/auth.api.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'API',
  module: 'API — Auth Contract',
  spec: 'tests/api/auth.api.spec.ts',
  command: 'npm run test:api',
  env: API_ENV,
  precondition: 'Negative cases run without credentials (CI-safe). The positive case needs SPHERE_API_TOKEN / session cookie in .env.',
  rows: [
    ['1. POST to /api/user/v3/create with a valid body but NO Authorization header.\n2. Read the response status.', 'POST /api/user/v3/create, headers: Content-Type only', 'The request is rejected with a non-2xx status — 401, 403 or 419.'],
    ['1. POST to /api/user/v3/create with a bogus bearer token and a fake session cookie.\n2. Read the response status.', 'Authorization: bearer not-a-real-token', 'The request is rejected with a non-2xx status.'],
    ['1. Build headers from the configured session credentials.\n2. Call the org search endpoint.', 'SPHERE_API_TOKEN + session cookie, orgId 014005962721189888281 (BNRC)', 'Header construction does not throw and the org search returns a record containing a "channel" property — confirming the configured credentials are accepted.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// API — ORG SEARCH — tests/api/org.api.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'ORG',
  module: 'API — Org Search',
  spec: 'tests/api/org.api.spec.ts',
  command: 'npm run test:api',
  env: API_ENV,
  precondition: 'SPHERE_API_TOKEN / session cookie must be configured in .env, otherwise the suite skips.',
  rows: [
    ['1. POST /api/org/v1/search filtered by the org id.\n2. Read back the id and channel.', 'BNRC — orgId 014005962721189888281', 'The returned record id matches the requested org id and its channel is a non-empty string.'],
    ['1. POST /api/org/v1/search filtered by the org id.\n2. Read back the id and channel.', 'SIHFWUP — orgId 0142443633580769283117', 'The returned record id matches and its channel is a non-empty string.'],
    ['1. POST /api/org/v1/search filtered by the org id.\n2. Read back the id and channel.', 'SHSB — orgId 01403709013603123234776', 'The returned record id matches and its channel is a non-empty string.'],
    ['1. POST /api/org/v1/search with an org id that does not exist.\n2. Read the response body.', 'orgId: does-not-exist-000000000000', 'The request succeeds (HTTP OK) and the content array is empty — no record is invented.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// API — USER PROVISIONING — tests/api/userProvisioning.api.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'USR',
  module: 'API — User Provisioning',
  spec: 'tests/api/userProvisioning.api.spec.ts',
  command: 'npm run test:api',
  env: API_ENV,
  precondition: 'SPHERE_API_TOKEN / session cookie must be configured in .env, otherwise the suite skips.',
  rows: [
    ['1. Resolve the org channel by orgId.\n2. Create a user under that channel.\n3. Assign the PUBLIC role.\n4. Search for the created user.\n5. Inspect the returned record.', 'Org: BNRC | email <prefix>@yopmail.com', 'A user is created with a valid userId, is findable via user search, carries the BNRC rootOrgId, and has the PUBLIC role assigned.'],
    ['1. POST /api/user/v3/create with an incomplete body (email only, required fields missing).\n2. Read the response status.', 'Body: { email: incomplete@yopmail.com }', 'The API returns a client error — the malformed body is rejected rather than creating a partial user.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// API — ANSWER KEY — tests/api/answerKey.api.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'KEY',
  module: 'API — Quiz Answer Key Contract',
  spec: 'tests/api/answerKey.api.spec.ts',
  command: 'npm run test:api',
  env: API_ENV,
  precondition: 'SPHERE_API_TOKEN / session cookie required. The artifact test also needs a real quiz do_id in SPHERE_TEST_QUIZ_ID.',
  rows: [
    ['1. Pass a full quiz player URL to the id extractor.\n2. Pass a non-quiz TOC URL to the same extractor.', 'https://sphere.aastrika.org/viewer/quiz/do_12345?foo=bar  and  /app/toc/do_999/overview', 'The quiz id "do_12345" is extracted from the player URL, and the TOC URL correctly yields null.'],
    ['1. Fetch the questionset hierarchy for the quiz id.\n2. Read its artifactUrl.\n3. Fetch the answer key from that artifact.\n4. Report whether the key is usable or poisoned.', 'SPHERE_TEST_QUIZ_ID', 'The questionset exposes an artifactUrl, the artifact contains questions, and either usable correct-option ids are returned or the bank is correctly reported as POISONED (a valid, documented outcome).'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// API FAST LOGIN — tests/apiFastLogin.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'FST',
  module: 'Fast Login via API-Provisioned User',
  spec: 'tests/apiFastLogin.spec.ts',
  command: 'npm run run:fastlogin',
  env: PROD,
  precondition: 'SPHERE_API_TOKEN / session cookie must be configured. Replaces the ~90s yopmail signup wizard with a ~1s API provision.',
  rows: [
    ['1. Provision a fresh user through the API (no signup wizard).\n2. Open the login page in the browser.\n3. Log in through the real UI with the provisioned credentials.\n4. Read the landing URL.', 'API-provisioned email + password', 'The API-provisioned user logs in successfully through the UI and leaves /public/login for the authenticated app.'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// PRODUCTION SMOKE MONITOR — tests/monitor/prod-smoke.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'MON',
  module: 'Production Synthetic Monitor (Smoke)',
  spec: 'tests/monitor/prod-smoke.spec.ts',
  command: 'npm run test:monitor',
  env: PROD,
  precondition: 'Runs against production on a schedule. Login checks need MONITOR_EMAIL / MONITOR_PASSWORD, otherwise they skip.',
  rows: [
    ['1. Navigate to /public/login.\n2. Read the HTTP response status.\n3. Wait for the page to paint and check the Welcome heading.', 'URL: /public/login', 'Navigation returns an OK status and the "Welcome!" heading renders — the public shell is up.'],
    ['1. Log in with the monitor account using the password method.\n2. Read the landing URL.', 'MONITOR_EMAIL / MONITOR_PASSWORD', 'Login succeeds and the browser leaves /public/login.'],
    ['1. Log in with the monitor account.\n2. Wait for an /app/ route.\n3. Read the rendered body text.', 'MONITOR_EMAIL / MONITOR_PASSWORD', 'The authenticated app loads on an /app/ route and renders real content (non-empty body).'],
  ],
},

// ══════════════════════════════════════════════════════════════════
// SUPPORT UTILITY — tests/yopmail.spec.ts
// ══════════════════════════════════════════════════════════════════
{
  id: 'UTL',
  module: 'Support Utility — Yopmail OTP Fetcher',
  spec: 'tests/yopmail.spec.ts',
  command: 'Used internally by the signup / OTP / login suites',
  env: ANY_ENV,
  precondition: 'Shared helper, not a standalone test. Consumed by REG, OTP, PF, PRF, BGV, ROL, ABG and LCK.',
  rows: [
    ['1. Request the yopmail homepage and parse the anti-bot tokens (yp, yj, v).\n2. Open the target inbox.\n3. List the messages and take the newest id.\n4. Fetch the mail body.\n5. Extract the numeric OTP from the body.', 'Inbox: <generated>@yopmail.com', 'The latest OTP mail is retrieved via yopmail internal endpoints (no scraping, no browser) and the OTP code is parsed out for the calling suite.'],
  ],
},
];
