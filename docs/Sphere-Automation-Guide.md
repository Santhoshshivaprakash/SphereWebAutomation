# Sphere Web Automation — What We Built & How It Works

*A plain-language guide to the test automation for the Sphere (Aastrika) learning platform.*

---

## 1. What this project is

This is an **automated testing suite** for the **Sphere** website (the Aastrika / Sunbird-iGOT nursing e-learning platform). Instead of a person manually clicking through the site to check it works, these scripts drive a real browser and do it automatically — logging in, opening courses, completing them, filling forms, and checking every button and screen behaves correctly.

- **Tools:** Playwright (browser automation) + TypeScript.
- **What it checks:** account/profile pages, course pages, course completion, competency assessments, sign-up, login, and the terms-and-conditions flow.
- **Output:** after every run it produces an **Excel report** and a **Tarento-branded HTML report** showing what passed, failed, or was skipped.

---

## 2. How it logs in (the important trick)

Most pages need you to be **logged in**. Copying a login session into the automation didn't work (the server rejects copied sessions). So we use a smarter method called **CDP**:

1. You open a normal Chrome window with a special "debugging" switch turned on.
2. You log in to Sphere once, by hand, in that window.
3. The tests **connect to that already-logged-in window** and drive it.

This is how the account, course, and competency tests run — they pigg-back on your live logged-in Chrome. The sign-up and login tests are different (they *create* new accounts), so they run on the **staging** site instead.

> **Rule to remember:** always run the tests from the `SphereWebAutomation` folder, **not** the parent `Automation` folder — otherwise Playwright loads the wrong copy of itself and everything fails.

---

## 3. Which site each test runs against

| Test group | Runs against | Why |
|---|---|---|
| Account, Course, Competency, Course TOC | **Production** (via your logged-in CDP Chrome) | These pages render blank on the localhost mirror, so they need the real site |
| Sign-up, Login, OTP, Positive Flow | **Staging** (`STAGING_URL`) | These create new accounts, which can't be done on localhost |

You switch environments with two settings in the `.env` file: `BASE_URL` (for the logged-in pages) and `STAGING_URL` (for the sign-up flows).

---

## 4. What each test suite does (and what we fixed)

### Account page (`Account.spec.ts`) — 68 checks, all passing
Checks everything on the profile/account screen: the user's name and position, all left-nav links, every field (name, phone, email, date of birth, country, pincode), the Organization and Academic sections, Language Preference, My Certificates, Logout, and the page working on mobile/tablet/desktop.

**What we did:**
- Fixed 21 broken checks → now **68 out of 68 pass**.
- Made every check **work in English *and* Hindi**, so the tests never fail just because the page is showing Hindi.
- Made it **open the Account page once and run all checks on that one open page** (instead of re-opening for every check) — faster and gentler on the session.
- Added logic to close any leftover pop-up before each check so one test can't block the next.

### Sign-up (`create-account.spec.ts`)
Creates a brand-new user: pick language, fill the form, verify by email OTP, confirm name, and accept Terms.

**What we did:**
- Fixed a loading overlay that was swallowing the "submit OTP" click.
- **Added a whole new flow:** create a user → on the Terms page click **Decline** (which drops you back to the public page) → **log in again** as that same user → **Accept** the Terms. (We use email because a phone number can only ever register one account and its SMS can't be read by automation.)
- Slowed down and spaced out the email checks so the throwaway-email service (yopmail) doesn't block us as a bot.

### Course completion (`CourseComplete.spec.ts`)
Opens a course and **finishes it end-to-end** — plays every video to the end, answers quizzes and assessments (using an answer key, with an AI fallback), unlocks the gated final tests, waits for the "Congratulations" and "Ratings" pop-ups, and downloads the certificate.

**What we did:**
- Completed the course **"Care of Newborn & Newborn Resuscitation"** and **generated its certificate**.
- Fixed the certificate download: the certificate is drawn onto the screen first, so the download was timing out — we now wait for it to finish drawing.

### Competency (`Competency.spec.ts`)
Works through the competency dashboard and completes assessment levels.

**What we did:**
- **Self-healing:** if the dashboard shows "no result" because the account's role is wrong, the test automatically goes to Account → Organization Details, sets **Background = Healthcare Worker** and **Designation = ANM/MPW**, saves, and reloads — then the competencies appear.
- Broke it into **many separate test cases** (one per step) so the report shows each step clearly.
- Uses the real path to open assessments (**Job Description → expand a role → Assess**) and always navigates via the **Competency menu button** (typing the web address directly redirects to the home page).
- Added a check that **completed assessments show up in the Passbook**.

### Course TOC page (`CourseTOC.spec.ts`) — was 16 skipped, now covered
Checks the course overview page: title, CNE hours, duration, rating, author, the **Details / Certificate / Share** icons, Resume/Start, the **Overview / Modules / Discussion** tabs, the module list, Description, and License terms.

**What we did:**
- The old tests were **skipping 16 of 22** because they looked for PDF/quiz viewers that only exist *inside* modules. We **rewrote them to check the real overview elements**, so they now **pass** instead of skip (went from 1 passing to 19 passing).
- Found the real elements: the icons are `div.toc-icon-action` (clicking the label text does nothing — you must click the box), the module list is `mat-list-item`, and the author is a coloured link, not a normal web link.

### Positive Flow (`positiveflow.spec.ts`) — now 26 steps
The full happy-path journey: sign up → verify OTP → accept Terms → complete the profile (date of birth, country/state/city, choose Healthcare Worker, designation, RN/RM number, organization type and name) → Done.

**What we did:**
- Turned it from **one big test into 26 small test cases**, one for each thing you click, so the report shows exactly how far the flow got and where it stopped.

---

## 5. The reports

Every run writes files into three tidy folders and produces two report styles:

```
test-reports/
├─ excel-reports/     ← spreadsheet of every test (pass/fail/skip)
├─ course-reports/    ← course-completion reports
└─ certificates/      ← downloaded certificates
brand-reports/        ← Tarento-styled HTML reports
```

We also set up **grouped runs that merge into one report**:
- `report:auth` → sign-up/login tests (staging)
- `report:app` → account/course/competency tests (production)
- `report:course` → course completion
- `report:merge` → stitches them all into one branded report

A full combined run produced **149 passing tests** across everything.

---

## 6. How to run it

From the `SphereWebAutomation` folder:

```powershell
# individual suites (open your logged-in Chrome on port 9222 first for CDP ones)
npm run run:account          # Account page
npm run run:course-toc       # Course TOC page
npm run run:competency       # Competency
npm run run:login            # Login (staging)
npm run run:create-account   # Sign-up (staging)

# complete a specific course + get its certificate
$env:COURSE_NAME="Care of Newborn & Newborn Resuscitation"; npx playwright test tests/CourseComplete.spec.ts

# the full merged report
npm run report:sanity
```

---

## 7. The one known blocker: yopmail

The sign-up tests need to read a one-time code (OTP) from a **throwaway email inbox (yopmail)**. When we run many sign-ups quickly, yopmail decides we're a bot and shows a **CAPTCHA**, which automation can't solve — so the OTP step fails and the sign-up flow stops there.

**Why it's not a code bug:** the app *does* send the email (it returns "OTP sent"); we just can't read it while yopmail is blocking us. We confirmed the OTP is **not** returned in the app's API response, so there's no way around the email.

**Options to fix it (for later):**
1. **Wait it out** — the block is temporary (clears in ~15–60 minutes), then it works again.
2. **Slower checks** — we already added throttling to space out the email lookups so we stay under the bot limit.
3. **Switch email provider** — use a CAPTCHA-free service (like 1secmail) as a last resort.

---

## 8. Summary of everything done this session

- Fixed the Account suite from 21 failures to **68/68**, and made it **bilingual** and **single-session**.
- Fixed and extended the **sign-up** flow, including a new **Decline-Terms → re-login → Accept** journey.
- **Completed a course and generated its certificate**, and fixed the certificate download.
- Gave the **Competency** suite a **self-healing role fix**, a granular per-step layout, and a Passbook check.
- Rewrote **Course TOC** to cover the real overview page — turning **16 skips into real passing coverage**.
- Turned the **Positive Flow** into **26 clear, per-step test cases**.
- Set up **grouped + merged reporting** and routed each suite to the correct environment.
- Diagnosed the **yopmail CAPTCHA** limitation and added throttling to reduce it.

*Everything is type-checked and the reports generate automatically on each run.*
