# Sphere Web Automation — Complete Guide

End-to-end **Playwright + TypeScript** automation suite for the Aastrika Sphere learning
platform (`https://sphere.aastrika.org`). It covers the public site, login, account
creation, profile/background completion, the private learner portal, "My Courses",
the Account settings area, full course completion (videos, PDFs, assessments), and the
Competency dashboard — with an automatic **Excel report** produced after every run.

---

## 1. What this project does (in plain words)

| Area | What is automated |
|------|-------------------|
| **Public site** | Every element on the public home + login pages (headers, banners, stats, course cards, footer, social links, responsiveness, page health). |
| **Sign up** | Full create-account flow — language → details → **OTP fetched automatically from Yopmail** → password → terms → profile. |
| **Profile / Background (BGV)** | Fills "Tell us more" + role-specific forms for all 6 backgrounds (Healthcare Worker, Volunteer, ASHA, Student, Faculty, Others). |
| **Private portal** | Logged-in Home page, My Courses tabs, Account settings (personal / org / academic / language / certificates). |
| **Course completion** | Opens a course and finishes **every module**: videos, PDFs, content pages, radio & checkbox assessments. Answers via Sphere's answer-key JSON, falling back to **Gemini AI**. |
| **Competency** | Clears every level of a competency, with answer-key + Gemini fallback (handles "poisoned" answer keys). |
| **API / service (Layer 2)** | Tests Sphere's Sunbird REST endpoints directly (auth, org search, user provisioning, answer key) and provisions test users via API in ~1s instead of the ~90s signup wizard. |
| **Reporting** | Every run auto-generates a **Tarento-branded HTML report** in `brand-reports/` (+ `latest.html`) and a brand-styled `.xlsx` in `test-reports/`, alongside the standard Playwright HTML report. |

> 🧩 **API / service testing (Layer 2)** lives under `tests/api/` + `tests/helpers/`.
> Run it with `npm run test:api`. Full explanation of every file, why it exists, and how
> to use it: **[docs/LAYER2-API-TESTING.md](docs/LAYER2-API-TESTING.md)**.
>
> 🛰️ **Synthetic prod monitoring (Layer 7)** — `tests/monitor/` runs a login smoke
> against production every 15 min via GitHub Actions and **emails** an alert on failure.
> Run locally with `npm run test:monitor`. Details:
> **[docs/LAYER7-PROD-MONITORING.md](docs/LAYER7-PROD-MONITORING.md)**.
>
> 📑 **Master client report** — `npm run report:full` runs the **entire** functional
> suite across both environments (App + Staging) in one pass and produces a single
> branded report at `brand-reports/latest.html`, every test tagged by environment.
> Details: **[docs/MASTER-REPORT.md](docs/MASTER-REPORT.md)**.
>
> ⭐ **Test EVERYTHING in one command (production)** — `npm run test:everything`
> runs the whole application against **production** and produces ONE branded report:
> signup + login + OTP → account/profile → my courses → competency → full course
> completion + certificate → the API/service layer, all merged into
> `brand-reports/latest.html`. See **["Test everything"](#test-everything-production)** below.
>
> 🧪 **Sanity positive-flow (grouped → merged)** — the individual groups behind
> `test:everything`: `npm run report:auth` (signup + login), `report:app` (portal),
> `report:course` (course + certificate); `npm run report:sanity` chains them and
> `report:merge` stitches one branded report.
> Details: **[docs/SANITY-MERGED-REPORT.md](docs/SANITY-MERGED-REPORT.md)**.
>
> 🚀 **Run on prod deploy + efficiency/cleanup plan** — `.github/workflows/prod-deploy-tests.yml`
> runs the suite on prod deploy (via `repository_dispatch`) and publishes a branded
> report. Setup, requirements, the CDP-in-CI blocker, and the phased cleanup plan:
> **[docs/CI-ON-DEPLOY.md](docs/CI-ON-DEPLOY.md)**.

---

## Test everything (production)

One command runs the **entire web application against production** and produces a
single branded report:

```bash
npm run test:everything
```

It runs each area on prod, each producing a blob, then merges them into one report:

| Group | Covers |
|---|---|
| `report:auth` | create-account · public-login · positiveflow · OTP |
| `report:app` | Account · Mycourse · CourseTOC · Competency |
| `report:course` | full course completion → **certificate** |
| `report:api-blob` | Layer 2 API / service tests |

**Output:** `brand-reports/latest.html` (share this) + `report_merged_*.html`.

**Everything is pinned to production** (`https://sphere.aastrika.org`) — not staging,
not localhost. `BASE_URL` and `STAGING_URL` both point at prod in `.env`.

**Prerequisites (set in `.env`):**
- `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` — a prod account (authenticated specs log in via storageState). `SESSION_COOKIE` must stay commented so UI-login is used.
- `SPHERE_API_TOKEN` + `SPHERE_API_COOKIE` — for the API layer (its tests skip cleanly if unset).
- `GEMINI_API_KEY` — optional, course-assessment fallback.

**Note:** because it runs on prod, the signup specs create real (yopmail) users on
production each run, and course completion writes real progress for `TEST_USER`.

---

## 2. Tech stack

- **Playwright Test** (`@playwright/test`) — browser automation & test runner
- **TypeScript** (run directly, no build step)
- **Node.js** (v18+ recommended — needs built-in `fetch`)
- **ExcelJS** — custom Excel reporter and account tracking
- **dotenv / easy-yopmail** — env loading and disposable inbox helpers
- **Gemini API** (optional) — AI answering fallback for assessments

---

## 3. Prerequisites

1. **Node.js 18 or newer** installed (`node -v` to check).
2. Internet access to `sphere.aastrika.org`, `yopmail.com`, and (optionally) the Gemini API.
3. Windows PowerShell (all example commands below use PowerShell syntax).

---

## 4. Installation

> ⚠️ **IMPORTANT:** Every command must be run **from inside the `SphereWebAutomation`
> folder**, *not* from `D:\Automation`. Running from the parent folder makes all specs fail.

```powershell
# 1. Go into the project folder
cd "D:\Automation\SphereWebAutomation"

# 2. Install dependencies
npm install

# 3. Install the Playwright browsers (first time only)
npx playwright install
```

---

## 5. Project structure

```
SphereWebAutomation/
├─ playwright.config.ts        # Global Playwright config (baseURL, timeouts, reporters)
├─ tsconfig.json               # TypeScript compiler options
├─ package.json                # Dependencies
├─ .env                        # Secrets (Gemini key, credentials) — NOT committed
│
├─ reporters/
│   └─ excel-reporter.ts       # Custom reporter → test-reports/*.xlsx
│
├─ tests/
│   ├─ PublicPage.spec.ts          # Public home page — full element coverage
│   ├─ public-login.spec.ts        # Public login page — full element coverage
│   ├─ create-account.spec.ts      # Create-account signup (OTP via Yopmail)
│   ├─ OTP.spec.ts                 # OTP verification + Terms of Use screens
│   ├─ positiveflow.spec.ts        # Profile completion happy path (HCW)
│   ├─ PrivatePage.spec.ts         # Logged-in Home page — full coverage
│   ├─ Mycourse.spec.ts            # "My Courses" tabs (Started / For You / Completed)
│   ├─ Account.spec.ts             # Account settings area — full coverage
│   ├─ Competency.spec.ts          # Clear every level of a competency
│   ├─ CourseComplete.spec.ts      # Complete a full course end-to-end
│   ├─ SCROM.spec.ts               # SCORM course completion variant
│   ├─ login-flow-simple.spec.ts   # Lightweight signup/login checks
│   ├─ yopmail.spec.ts             # Standalone Yopmail OTP fetcher (API-based)
│   │
│   ├─ Profile/
│   │   ├─ ALL-Roles.spec.ts       # One fresh account per role (6 accounts)
│   │   ├─ ALL-BGV.spec.ts         # All backgrounds, background verification
│   │   ├─ BGVPositive.spec.ts     # Single HCW positive background flow
│   │   └─ ProfileCompletion.spec.ts # Single signup, walk all backgrounds
│   │
│   └─ helpers/
│       ├─ fixtures.ts             # `createAccount` / `freshAccount` test fixtures
│       ├─ createAccount.ts        # Reusable full-signup routine
│       ├─ yopmail.ts              # OTP fetch + random email generator
│       └─ SphereCase.spec.ts      # Large TC01–TC213 manual-style regression suite
│
├─ test-reports/               # Generated Excel reports (one per run)
├─ playwright-report/          # Generated HTML report
├─ test-results/               # Screenshots / videos on failure
├─ registered-accounts.xlsx    # Log of accounts created by Profile suites
├─ generated-emails.txt        # Log of every generated email
└─ lastGeneratedEmail.txt      # Most recent generated email
```

---

## 6. Configuration

### 6.1 `playwright.config.ts`

| Setting | Value | Meaning |
|---------|-------|---------|
| `baseURL` | `https://sphere.aastrika.org` | Target site |
| `headless` | `false` | Browser is **visible** by default |
| `workers` / `fullyParallel` | `1` / `false` | Tests run **one at a time** (signup flows are expensive) |
| `retries` | `0` | No retries |
| `timeout` | `300000` (5 min) | Per-test ceiling |
| `reporter` | `list` + `html` + `excel-reporter` | Console + HTML + Excel |
| `projects` | `Chrome` | Runs on Desktop Chrome |

### 6.2 `.env`

Create/edit `D:\Automation\SphereWebAutomation\.env`:

```ini
# Optional — enables the Gemini AI answer fallback for assessments
GEMINI_API_KEY=your_key_here

# Only used by a couple of specs
ASKME_EMAIL=you@example.com
ASKME_PASSWORD=yourpassword
```

> The `.env` is loaded automatically by `playwright.config.ts` (and again manually inside
> `CourseComplete.spec.ts` / `SCROM.spec.ts`). Keep it out of version control.

### 6.3 Test accounts used by the suites

| Account | Password | Used by |
|---------|----------|---------|
| `learnerid001@yopmail.com` | `Sunbird@123` | Account, CourseComplete, SCROM, Mycourse, PrivatePage, Competency |
| `creator777@yopmail.com` | `Sunbird@123` | SphereCase regression suite |
| auto-generated `testautomation…@yopmail.com` | `Sunbird@123` / `Sample@123` | signup & profile suites |

Newly created accounts are appended to **`registered-accounts.xlsx`** and every generated
email is logged to **`generated-emails.txt`**.

---

## 7. Running the tests — command cheat sheet

> Always start with: `cd "D:\Automation\SphereWebAutomation"`

### The interactive runner (easiest)

```powershell
npm run go
```

It asks which environment, then which spec — and when the spec needs a **course**
(`CourseComplete`, `CourseTOC`, `SCROM`) or a **competency** (`CompleteCompetency`,
`Competency`) it asks for that too:

* **Show me the list** — fetched live from the environment you picked, searchable
  by keyword, numbered; competencies show how many levels each has
* **I'll paste the name myself** — for a title you already have
* For `Competency.spec.ts` there is also **Skip**, which lets the spec use the
  first Re-Assess card it finds

Pick several (`1,4,7`) and the spec runs once per pick, with a PASS/FAIL summary
at the end. `npm run go -- --refresh` re-fetches the lists instead of using the
day-old cache. Setting `COURSE_NAME` / `COMPETENCY_NAME` in the environment
skips the prompt entirely.

### Run everything
```powershell
npx playwright test
```

### Run one spec file
```powershell
npx playwright test tests/PublicPage.spec.ts
```

### Run in headed (visible) mode — this is already the default, but explicit:
```powershell
npx playwright test tests/PublicPage.spec.ts --headed
```

### Run headless (no visible browser)
```powershell
npx playwright test tests/PublicPage.spec.ts --headless
```

### Run a specific test by title
```powershell
npx playwright test tests/PublicPage.spec.ts -g "Logo is visible"
```

### Run a folder (e.g. all Profile suites)
```powershell
npx playwright test tests/Profile
```

### Debug mode (step through, inspector)
```powershell
npx playwright test tests/OTP.spec.ts --debug
```

### UI mode (interactive runner)
```powershell
npx playwright test --ui
```

### Slow it down to watch what happens
```powershell
npx playwright test tests/Account.spec.ts --headed --workers=1
```

### Open the last HTML report
```powershell
npx playwright show-report
```

---

## 8. Test suites — detailed reference

Each entry lists **what it covers** and the **exact command** to run it.

### 8.1 `PublicPage.spec.ts` — Public home page (full coverage)
Verifies every section of the public landing page: header/logo/login modal, hero banner,
CNE banner, stats row (Learners, Courses, CNE Hours, Certificates), Top Courses & CNE
Courses cards, Trusted-By partner logos, "How Sphere Works" videos, Transform CTA,
initiative/collaboration logos, footer (Quick Links, Help & Contact, social icons,
copyright), plus page-wide checks (broken images, console errors, load time, title).
```powershell
npx playwright test tests/PublicPage.spec.ts --headed
```

### 8.2 `public-login.spec.ts` — Public login page (full coverage)
Header, welcome text, OTP/Password toggle, OTP login flow, password login flow (mask,
eye toggle, forgot password), Create-Account link, help chat modal, input validation,
responsive layouts, page health.
```powershell
npx playwright test tests/public-login.spec.ts --headed
```

### 8.3 `create-account.spec.ts` — Signup end-to-end
Full create-account flow: Select Language → Personal Details → **OTP auto-fetched from
Yopmail** → Name confirm → Set Password → Account created. Generates a unique
`testautomation…@yopmail.com`, stores it, and includes validation tests.
```powershell
npx playwright test tests/create-account.spec.ts --headed
```

### 8.4 `OTP.spec.ts` — OTP verification & Terms
The post-signup OTP screen (heading, email echo, timer, numeric input, resend, invalid-OTP
error) and the full flow that fetches the OTP from Yopmail, submits, accepts Terms, and
lands on the private page. Also isolates the Terms-of-Use screen.
```powershell
npx playwright test tests/OTP.spec.ts --headed
```

### 8.5 `positiveflow.spec.ts` — Profile completion happy path
Clicks Account → fills the profile → chooses **Healthcare Worker** → submits.
```powershell
npx playwright test tests/positiveflow.spec.ts --headed
```

### 8.6 Profile suites (`tests/Profile/`)
| File | What it does |
|------|--------------|
| `ALL-Roles.spec.ts` | Creates **6 fresh accounts**, one per background, filling all role-specific fields and clicking Done. Saves each to `registered-accounts.xlsx`. |
| `ALL-BGV.spec.ts` | All-backgrounds run for background verification. |
| `BGVPositive.spec.ts` | Single positive flow for Healthcare Worker. |
| `ProfileCompletion.spec.ts` | Single signup, walks through element coverage for all backgrounds. |

```powershell
# All roles (creates 6 accounts — long run, ~5 min per role)
npx playwright test tests/Profile/ALL-Roles.spec.ts --headed

# Single positive background flow
npx playwright test tests/Profile/BGVPositive.spec.ts --headed
```

### 8.7 `PrivatePage.spec.ts` — Logged-in Home (full coverage)
Header (logo, search, dark mode, nav links, notifications), Welcome section, hero
carousel, Continue Learning, CNE Courses cards, info cards, footer, and page health
(title, console errors, mobile/tablet/desktop, sticky header). Logs in with
`learnerid001` and reuses stored auth state.
```powershell
npx playwright test tests/PrivatePage.spec.ts --headed
```

### 8.8 `Mycourse.spec.ts` — My Courses tabs
Page heading & tabs (Started / For You / Completed with counts), Started-tab course rows
(thumbnail, title, progress bar, Resume), For You grid cards, Completed empty state, tab
switching, header, and page health/responsiveness.
```powershell
npx playwright test tests/Mycourse.spec.ts --headed
```

### 8.9 `Account.spec.ts` — Account settings (full coverage)
Left nav + landing, Personal Details (fields, save, persistence after reload),
Organization Details, Academic Details (add education), Language Preference (switch
English/Hindi and persist), My Certificates empty state, profile picture, help & support,
logout flow. Logs in as `learnerid001@yopmail.com`.
```powershell
npx playwright test tests/Account.spec.ts --headed
```

### 8.10 `CourseComplete.spec.ts` — Full course completion
Searches for a course by name, opens it, and completes **every** module: videos, PDFs,
content pages, radio + checkbox assessments. Answers assessments using Sphere's answer-key
JSON, falling back to **Gemini AI**.

**Interactive (recommended)** — asks which credentials to use, then shows the live list of
published courses to choose from (one, several, or all matches):
```powershell
npm run run:course
npm run run:course -- --refresh          # re-fetch the course list (cached 24h)
npm run run:course -- --spec SCROM.spec.ts
npm run run:course -- --headless
npm run courses:list                     # just print every live course
```
Accounts offered come from `config/accounts.json` + `.env` (`TEST_USER_*`, `MONITOR_*`), plus
"type a different email", "brand-new signup", and "logged-in Chrome over CDP". Add your own
regulars to `config/accounts.json`.

**Direct** — set `COURSE_NAME` yourself (both prompts are skipped when the env vars are set,
so CI is unaffected):
```powershell
$env:COURSE_NAME="Normal Labour & Birth and AMTSL"; npx playwright test tests/CourseComplete.spec.ts --headed
npm run run:course:env                   # old fixed-env script
```
Optional env vars: `GEMINI_API_KEY` (fallback answering), `VERBOSE_CHECKBOX="1"` (extra logs).

### 8.11 `SCROM.spec.ts` — SCORM course completion
Same idea as CourseComplete, tuned for SCORM content. Also driven by `COURSE_NAME`.
```powershell
$env:COURSE_NAME="Normal Labour & Birth and AMTSL"; npx playwright test tests/SCROM.spec.ts --headed
```

### 8.12 `Competency.spec.ts` — Clear every competency level
Climbs each level of a competency. Uses the answer-key fast path, detects "poisoned" keys
(all options marked incorrect), and falls back to a **Gemini batch** to answer for real.
```powershell
# Target a specific competency
$env:COMPETENCY_NAME="Your Competency Title"; npx playwright test tests/Competency.spec.ts --headed

# Or omit the name to use the first Re-Assess card
npx playwright test tests/Competency.spec.ts --headed
```

### 8.13 `login-flow-simple.spec.ts` — Lightweight signup/login checks
Quick language-selection, signup, and wrong-email checks using the shared fixtures.
```powershell
npx playwright test tests/login-flow-simple.spec.ts --headed
```

### 8.14 `helpers/SphereCase.spec.ts` — Full manual-style regression (TC01–TC213)
A large regression suite mirroring the manual test cases across Public Page, Login,
Create Account, Private Home, Course TOC, Assessment, My Courses, Competency, Search,
Account, Logout, Quiz, and Notifications. Logs in as `creator777@yopmail.com`.
```powershell
npx playwright test tests/helpers/SphereCase.spec.ts --headed
```

### 8.15 `yopmail.spec.ts` — Standalone OTP fetcher
Reference implementation that pulls the latest mail from a Yopmail inbox using Yopmail's
internal endpoints (no browser scraping). Useful for debugging OTP retrieval.
```powershell
npx playwright test tests/yopmail.spec.ts
```

---

## 9. Helpers (shared code)

- **`helpers/yopmail.ts`** — `generateRandomYopmail()` makes a fresh disposable address;
  `fetchOtpFromYopmail(page, email)` opens the inbox and reads the 6-digit OTP (retries up
  to 10×).
- **`helpers/createAccount.ts`** — `createSphereAccount(...)` runs the entire signup +
  profile flow and returns the created account (email, password, page, session cookie).
- **`helpers/fixtures.ts`** — extends Playwright's `test` with:
  - `createAccount(overrides?)` — factory to spin up a new account inside a test
  - `freshAccount` — a ready-made account fixture
  ```ts
  import { test, expect } from './helpers/fixtures';

  test('does X', async ({ freshAccount }) => {
    console.log(freshAccount.email);
  });
  ```

---

## 9b. Comparing two environments side by side (`npm run compare`)

`scripts/compare-env.mjs` loads the **same feature on production and staging at
the same moment**, in two browser contexts, and reports everything that differs.
Use it before a release, or when "it works on prod but not on staging".

```powershell
npm run compare                 # INTERACTIVE — asks which envs, which features, which options
npm run compare:auth            # straight to it: public + signed-in features, prod vs staging
npm run compare:all             # same, and opens the report when it finishes
npm run compare:local           # prod vs http://localhost:3000
```

### The interactive runner

`npm run compare` with no flags walks you through the whole thing:

1. **Which two environments** — production / staging / localhost, or any URL you type
2. **Sign in?** — it prints the account each side will use, then asks
3. **Which features** — `Enter` for all, numbers (`1,4,6`), a keyword, or a path
   starting with `/` to compare something that is not in the inventory yet (it
   offers to save that path into `config/compare-routes.json` for next time)
4. **Options** — visual threshold, headed, catalogue parity, fresh login, open report

Before it runs, it prints the equivalent one-liner, so anything you set up in the
prompts can be repeated or dropped into CI without them. Passing **any** flag
skips the prompts entirely and goes straight to the comparison.

What it compares, per feature:

| Layer | Checks |
|-------|--------|
| **UI** | Side-by-side screenshots (viewport + full page) and a **pixel diff** image; missing headings, buttons, form fields and links; broken images; copy/label drift; page title and default language |
| **Function** | HTTP status, redirects, blank pages, console errors, uncaught JS errors, failing network requests, time to network-idle, front-end build hash |
| **Data** | API parity (status / record count / latency for each endpoint in the config) and **course-catalogue parity** — which courses exist on one environment but not the other |

Findings are graded **Blocking** (the portal itself is broken or missing on one
side) → **Review** (a real difference to look at, incl. third-party breakage and
visual drift) → **FYI** (different build, copy changes). The script exits with
code **1** when anything blocking is found, so CI can gate on it.

Every run writes four things to `compare-reports/`:

| File | What it is |
|---|---|
| `..._SIMPLE.html` | **Start here.** Plain English, one table per page with **Production and Staging in their own columns**, the two screenshots plus a highlighted-differences image underneath, and every difference written as a sentence. Rows where the two sites disagree are highlighted. |
| `..._SIMPLE.txt` | The same thing as plain text — paste it into a ticket, an email or a chat |
| `..._SIMPLE.pdf` | The simple report printed to PDF (screenshots included) — the one to send to someone. Skip it with `--no-pdf`. |
| `....html` | The detailed/branded report (severity legend, per-feature "What was checked here", filter buttons) |
| `....json` | The same data for CI |
| `..._assets/` | Every screenshot and diff image |

### Journeys — compare a flow step by step

A **journey** walks a flow on both environments *in lockstep* and compares at
**every step**: create an account, log in, move through the Account tabs. Each
step gets its own screenshot pair, its own comparison table and its own
findings, so instead of "signup differs" you get "step 4 of signup differs, here
are the two pictures".

```powershell
npm run compare:signup            # the create-account flow, step by step, opens the report
npm run compare:journeys          # every journey (signed in), opens the report
npm run compare -- --journey create-account --journey-only
npm run compare -- --journey all --auth --allow-writes    # include the OTP/submit steps
```

Journeys live in `config/compare-journeys.json`. Shipped: **Create account**
(7 steps), **Login with password** (4 steps), **Account settings tabs** (5 steps).

Steps that would create real data — sending an OTP, submitting a signup — are
marked `"writes": true` and are **skipped unless you pass `--allow-writes`**, so
a routine comparison never registers users on production. They are listed in the
report as "steps that were not performed". `{{email}}` and `{{stamp}}` in a step
value become a unique yopmail address and timestamp per run.

### What it does and does not do

It compares each screen **as it is reached**: the page is loaded, any configured
steps are walked, and then everything on that screen is compared. It does **not**
run journeys — no signup is submitted, no course completed, no quiz answered,
nothing saved. Those are the Playwright specs (`npm run go`). Every feature in
the report carries a **“What was checked here”** panel listing the URL opened,
the steps walked, the checks applied, and what was out of scope.

That is why a wizard shows only its first page unless you tell it to walk in —
`/app/create-account` on its own is the *language chooser*, not the signup form.

### Adding a feature to the comparison

Edit `config/compare-routes.json` — no code change needed:

```json
{ "id": "course-toc", "name": "Course TOC", "path": "/app/toc/do_1131/overview", "auth": true, "wait": 2000,
  "note": "Course table of contents as it lands." }
```

To compare a screen **behind** a click or two, add `steps` — they run on both
environments before anything is captured, and a step that lands on one side but
fails on the other is reported as **Blocking**:

```json
{ "id": "signup-details", "name": "Create account — step 2 (details form)",
  "path": "/app/create-account", "auth": false,
  "steps": [ { "click": "English" }, { "click": "Next", "wait": 1200 } ] }
```

Step forms: `{ "click": "<button name, visible text, or css/xpath>" }` ·
`{ "fill": "<selector>", "value": "…" }` · `{ "waitFor": "<text or selector>" }` ·
`{ "wait": <ms> }`. Keep them read-only — click and type to *reach* a screen,
but do not submit anything that would create data on production.

`auth: true` means the route is only captured with `--auth`. The same file holds
the `api` endpoints to probe and an `ignore` block (regex) for muting known
third-party noise, e.g. the embedded chat widget:

```json
"ignore": { "console": ["freecustomer\\.in"], "requests": ["freecustomer\\.in", "cdn\\.jsdelivr\\.net"] }
```

### Useful flags

```powershell
npm run compare -- --auth                     # include signed-in features
npm run compare -- --only home,course         # just matching routes
npm run compare -- --ids app-home,profile     # exact feature ids (what the prompts send)
npm run compare -- --route /app/toc/do_123/overview --no-inventory   # one off-inventory path only
npm run compare -- --threshold 2              # ignore visual diffs under 2% (rotating banners)
npm run compare -- --headed                   # watch both browsers work
npm run compare -- --a <urlA> --b <urlB>      # any two environments
npm run compare -- --refresh                  # re-login and re-fetch the catalogue
npm run compare -- --no-catalogue             # skip the course parity pass (faster)
npm run compare -- --open                     # open the report when it finishes
```

**Credentials for `--auth`** live in `.env` as `PROD_EMAIL`/`PROD_PASSWORD` and
`STAGING_EMAIL`/`STAGING_PASSWORD` — the same person on both sides, so any
difference is the environment and not the account. Resolution order, most
specific first: those per-environment keys →
`TEST_USER_EMAIL`/`TEST_USER_PASSWORD` → `MONITOR_*` → the first entry in
`config/accounts.json`. Sessions are cached in `.cache/` for 6 hours, so
re-runs skip the login.

---

## 10. Reports & artifacts

After **every** run you get:

1. **Excel report** → `test-reports/TestReport_<spec>_<timestamp>.xlsx`
   - Sheet 1 "Test Results": TC ID, Suite, Test Case, Description, Expected, Actual,
     Status (color-coded), Duration, Run At, Error.
   - Sheet 2 "Summary": totals, pass rate, duration, spec files.
2. **HTML report** → `playwright-report/` (open with `npx playwright show-report`).
3. **Failure artifacts** → `test-results/` (screenshots + video only on failure).

To attach custom info to the report, tests use:
```ts
await testInfo.attach('account-info', { body: 'Email: ... | Role: ...', contentType: 'text/plain' });
```
which the Excel reporter shows in the Description/Actual columns.

---

## 11. Troubleshooting

| Problem | Fix |
|---------|-----|
| **All specs fail immediately** | You're in the wrong folder. Run from `D:\Automation\SphereWebAutomation`, not `D:\Automation`. |
| `browserType.launch: Executable doesn't exist` | Run `npx playwright install`. |
| OTP never found | Yopmail may be slow/rate-limited; re-run. The fetcher already retries 10×. |
| `Set COURSE_NAME env var` error | Provide it: `$env:COURSE_NAME="Normal Labour & Birth and AMTSL"` before the command. |
| Assessments answered wrong / Gemini errors | Set a valid `GEMINI_API_KEY` in `.env`; free tier is rate-limited (self-throttled at ~10 RPM). |
| Login fails on private specs | The shared learner account password may have changed; update the credentials at the top of the spec. |
| Want it faster / on CI | Add `--headless` (note: some flows are timing-sensitive and tuned for headed). |

---

## 12. Quick start (copy-paste)

```powershell
cd "D:\Automation\SphereWebAutomation"
npm install
npx playwright install

# Smoke test the public page
npx playwright test tests/PublicPage.spec.ts --headed

# Complete a course end-to-end
$env:COURSE_NAME="Normal Labour & Birth and AMTSL"; npx playwright test tests/CourseComplete.spec.ts --headed

# See the report
npx playwright show-report
```
