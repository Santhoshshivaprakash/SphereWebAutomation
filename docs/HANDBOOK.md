# Sphere Web Automation — Developer Handbook

> **Read this first.** It explains the whole project from scratch: how to set it up, every command, what each test file does and what we changed, the important gotchas, and **how to add your own test cases**. If you are brand new, start at Section 1 and go in order.

---

## Table of contents

1. [What you need before starting](#1-what-you-need-before-starting)
2. [One-time setup](#2-one-time-setup)
3. [The two ways tests log in (VERY important)](#3-the-two-ways-tests-log-in)
4. [Every command, explained](#4-every-command-explained)
5. [Project structure — where everything lives](#5-project-structure)
6. [Each test file: what it does & what we changed](#6-each-test-file)
7. [Key mechanisms (how the magic works)](#7-key-mechanisms)
8. [How to ADD a new test case](#8-how-to-add-a-new-test-case)
9. [How to add a whole new test file](#9-how-to-add-a-whole-new-test-file)
10. [Selector cheat-sheet](#10-selector-cheat-sheet)
11. [Reports — how they are made](#11-reports)
12. [Troubleshooting & golden rules](#12-troubleshooting--golden-rules)

---

## 1. What you need before starting

| Need | Detail |
|---|---|
| **Node.js** | v18+ (check with `node -v`) |
| **Google Chrome** | Installed at the normal location |
| **A Sphere login** | Email/phone + password (or OTP) for the site |
| **Terminal** | Windows PowerShell (this guide uses PowerShell syntax) |
| **Editor** | VS Code recommended |

**What is Playwright?** A tool that controls a real browser with code. You write "click this", "type that", "check this text is visible", and it does it in Chrome. Our tests are `.spec.ts` files (TypeScript).

---

## 2. One-time setup

```powershell
# 1. Go into the project folder (ALWAYS work from here, never the parent)
cd D:\Automation\SphereWebAutomation

# 2. Install dependencies
npm install

# 3. Install the browsers Playwright uses
npx playwright install
```

### The `.env` file (settings)
In the project root there is a `.env` file. The important lines:

```ini
# The site the logged-in pages test against (localhost mirror OR production)
BASE_URL=https://sphere.aastrika.org

# The site the SIGN-UP flows test against (they can't run on localhost)
STAGING_URL=https://staging.aastrika.org

# AI key used to answer assessments when there's no answer key
GEMINI_API_KEY=...
```

> **Rule:** `BASE_URL` controls the account/course/competency tests. `STAGING_URL` controls sign-up/login/OTP/positive-flow. They are separate on purpose.

---

## 3. The two ways tests log in

This is the single most important thing to understand.

### A) CDP — for pages that need you already logged in
*(Account, Mycourse, Competency, CourseComplete, CourseTOC, PrivatePage)*

You launch a Chrome that the tests can attach to, and **log in by hand once**. The tests then reuse that session.

```powershell
# Launch the debug Chrome (separate profile so it won't clash with your normal Chrome)
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-cdp" https://sphere.aastrika.org
```

Then, **in that window**, log in to Sphere. Leave it open. Now the CDP tests can run.

- In code, these files start with: `import { test, expect } from './helpers/cdpTest';`
- `cdpTest.ts` connects to `http://localhost:9222` (the debug Chrome) and reuses its logged-in tab.

### B) Fresh browser — for sign-up flows
*(create-account, public-login, OTP, positiveflow)*

These **create new accounts**, so they don't need CDP. They launch a clean browser and go to **staging**. In code they use the normal `import { test, expect } from '@playwright/test';`.

---

## 4. Every command, explained

Run all of these from `D:\Automation\SphereWebAutomation`.

### Run one suite (headed = you can watch)
| Command | What it runs | Login type |
|---|---|---|
| `npm run run:account` | Account/profile page | CDP |
| `npm run run:mycourse` | My Courses | CDP |
| `npm run run:competency` | Competency dashboard | CDP |
| `npm run run:course` | Complete a course (needs `COURSE_NAME`) | CDP |
| `npm run run:course-toc` | Course TOC page (needs `COURSE_NAME`) | CDP |
| `npm run run:scorm` | SCORM module | CDP |
| `npm run run:public` | Public landing page | none |
| `npm run run:private` | Private home page | CDP |
| `npm run run:login` | Login flow | staging |
| `npm run run:create-account` | Sign-up flow | staging |
| `npm run run:otp` | OTP flow | staging |

### Run a specific file directly
```powershell
npx playwright test tests/Account.spec.ts                 # whole file
npx playwright test tests/Account.spec.ts --headed        # watch it
npx playwright test tests/Account.spec.ts --grep "Logout" # only tests whose title contains "Logout"
npx playwright test tests/Account.spec.ts --list          # list tests without running
```

### Set a variable for one run (PowerShell)
```powershell
# Complete a specific course and get its certificate
$env:COURSE_NAME="Care of Newborn & Newborn Resuscitation"; npx playwright test tests/CourseComplete.spec.ts

# Run a CDP suite against production explicitly
$env:BASE_URL="https://sphere.aastrika.org"; npx playwright test tests/CourseTOC.spec.ts
```

### Reports (grouped + merged)
| Command | What it does |
|---|---|
| `npm run report:auth` | Sign-up/login suites → a blob in `blob-reports/auth/` (staging) |
| `npm run report:app` | Account/Mycourse/CourseTOC/Competency → `blob-reports/app/` (production) |
| `npm run report:course` | CourseComplete → `blob-reports/course/` |
| `npm run report:merge` | Stitches every blob into one branded HTML report |
| `npm run report:sanity` | Clears blobs, runs auth + app + course, then merges (the "everything" run) |
| `npm run report` | Opens the last standard Playwright HTML report |

### Type-check (catch code mistakes without running)
```powershell
npx tsc --noEmit        # should print nothing / exit 0 when clean
```

---

## 5. Project structure

```
SphereWebAutomation/
├─ tests/                     ← all the test files (*.spec.ts)
│   ├─ Account.spec.ts
│   ├─ create-account.spec.ts
│   ├─ CourseComplete.spec.ts
│   ├─ Competency.spec.ts
│   ├─ CourseTOC.spec.ts
│   ├─ positiveflow.spec.ts
│   └─ helpers/
│       └─ cdpTest.ts         ← the CDP login harness (import test/expect from here)
├─ reporters/
│   ├─ excel-reporter.ts      ← writes the Excel report
│   └─ brand-html-reporter.ts ← writes the Tarento-styled HTML report
├─ scripts/
│   ├─ merge-branded.mjs      ← merges blob reports
│   └─ make-pdf.mjs           ← turns an HTML doc into a PDF
├─ docs/                      ← guides (this file lives here)
├─ test-reports/
│   ├─ excel-reports/         ← Excel files
│   ├─ course-reports/        ← course HTML reports
│   └─ certificates/          ← downloaded certificates
├─ brand-reports/             ← branded HTML reports
├─ playwright.config.ts       ← global settings (reporters, timeouts, projects)
├─ package.json               ← the npm run commands
└─ .env                       ← BASE_URL, STAGING_URL, keys
```

---

## 6. Each test file

For every file: **what it tests**, **what we changed**, and **points to note**.

### `Account.spec.ts` — the profile/account page
- **Tests:** name, position, all nav links, every field, Organization/Academic/Language/My-Certificates sections, Logout, viewport rendering. **68 test cases.**
- **What we changed:**
  - Fixed 21 failures → **68/68 pass** on production.
  - Made every text check **bilingual** (English *or* Hindi) using a dictionary called `T`.
  - Fields are checked by **placeholder** (placeholders stay English even in Hindi).
  - **One shared page:** opens the Account page once in `beforeAll` and runs all tests on it; `beforeEach` only re-opens if a prior test navigated away, and it dismisses any leftover pop-up.
- **Points to note:** Account renders **blank on localhost** — run it on **production** via CDP. The `beforeAll` uses the `cdpBrowser` worker fixture to make the shared page.

### `create-account.spec.ts` — sign-up
- **Tests:** language → form → email OTP → confirm name → accept Terms, plus the **sign-up → Accept** positive journey (Step 5) that mints the fresh user used by course runs.
- **What we changed:**
  - Fixed a loading overlay swallowing the OTP-submit click.
  - Step 5 is email-based (a phone number registers only once and its SMS can't be read), selects **English** on the language screen by label, and saves the logged-in session to `.auth/fresh-user.json` for `USE_FRESH_USER=1`.
  - Removed the old **Decline → re-login → Accept** detour: it needed a second OTP fetch and broke whenever the public login page changed (e.g. staging renders it in Hindi), without adding coverage the mint needs.
  - Added **yopmail throttling** (a global gap between inbox reads, slower polling, gap between fetches) to avoid CAPTCHA.
- **Points to note:** runs on **staging**. Login-OTP field is `#totp` + "Submit" (different from sign-up's per-digit boxes). The Terms page route is `/app/new-tnc`.

### `CourseComplete.spec.ts` — finish a course end-to-end
- **Tests:** plays videos, answers quizzes/assessments, unlocks finals, waits for Congratulations + Ratings, downloads the certificate.
- **What we changed:** fixed the certificate download — it now waits for the certificate `<canvas>` to finish drawing before saving (was timing out).
- **Points to note:** needs `$env:COURSE_NAME`. Uses an **answer-key interceptor** + **Gemini** fallback. Certificate saves to `test-reports/certificates/`.

### `Competency.spec.ts` — competency levels
- **Tests:** open dashboard → (self-heal role) → explore tabs → pick a competency → complete levels → Passbook.
- **What we changed:**
  - **Self-healing:** if "no result" shows, it sets Account → Org Details → Background = Healthcare Worker, Designation = **ANM/MPW**, saves, reloads.
  - Split into **many per-step test cases**.
  - Opens assessments via **Job Description → expand role → Assess**, and navigates with the **Competency menu button** (a direct URL redirects home).
  - Added a **Passbook** verification.
- **Points to note:** competencies live under **Job Description → Roles**, not just the Required tab.

### `CourseTOC.spec.ts` — the course overview page
- **Tests:** title, CNE hours, duration, rating, author, Details/Certificate/Share, Resume/Start, Overview/Modules/Discussion tabs, module list, Description, License terms, author→org page, back, Start-opens-player.
- **What we changed:** **rewrote it** — the old version skipped 16 tests hunting for viewers inside modules; now it checks the real overview elements (**1 → 19 passing**). The action icons are `div.toc-icon-action` (click the box, not the label), modules are `mat-list-item`, the author is a `span.blue-link`.
- **Points to note:** needs `$env:COURSE_NAME`. Each test re-opens the TOC if the shared browser drifts.

### `positiveflow.spec.ts` — the full happy path
- **Tests:** sign up → OTP → Terms → profile completion (DOB, country/state/city, Healthcare Worker, designation, RN/RM, org type, org name) → Done. **26 steps.**
- **What we changed:** turned one big test into **26 granular per-step cases** (`describe.serial`), so the report shows exactly where the flow stops.
- **Points to note:** runs on **staging**; blocked at the OTP step when yopmail shows a CAPTCHA.

---

## 7. Key mechanisms

**CDP login harness (`helpers/cdpTest.ts`).** Exports `test`/`expect` that connect to the debug Chrome on port 9222 and reuse its logged-in context. Any file that imports from here runs against your live logged-in session.

**Bilingual matching.** UI can be English or Hindi. We keep a dictionary of regexes that match either language, e.g.
```ts
const T = { personalDetails: /^(personal details|व्यक्तिगत विवरण)$/i, save: /^(save|सेव करें|सहेजें)$/i };
```
Field **placeholders stay English** in both languages, so field checks prefer `getByPlaceholder(/first name/i)`.

**Shared page (open once, run many).** For pages where re-opening every test is slow, we open once in `beforeAll` and reuse:
```ts
let page;
test.beforeAll(async ({ cdpBrowser }) => {
  const ctx = cdpBrowser.contexts()[0] ?? await cdpBrowser.newContext();
  page = await ctx.newPage();
  await openAccountViaHeader(page);   // open once
});
```

**Answer-key interception.** Course/competency quizzes load a JSON with the correct answers. We listen for that network response and read the answers; if it's "poisoned" (all marked wrong), we fall back to **Gemini AI**.

**yopmail OTP.** Sign-ups verify with an email code fetched from throwaway inboxes at yopmail. We throttle these reads (a global gap between requests) so yopmail doesn't flag us as a bot.

**Blob reports.** When `BLOB=1` is set, Playwright writes a `.zip` "blob" of results. Running each group with its own `BLOB_DIR`, then `report:merge`, stitches them into one report.

---

## 8. How to ADD a new test case

A test case is one `test('title', async ({ page }) => { ... })` inside a `test.describe(...)`. Here is the recipe.

### Step 1 — pick the right file
Testing a logged-in page? Add to a CDP file (e.g. `Account.spec.ts`). Testing sign-up? Add to `create-account.spec.ts`.

### Step 2 — write the test
```ts
test('My new check — the Notification bell opens the panel', async ({ page }) => {
  // 1. FIND the element (prefer role or visible text)
  const bell = page.getByRole('button', { name: /notification/i })
    .or(page.locator('[aria-label*="notification" i]')).first();

  // 2. ACT
  await bell.click();
  await page.waitForTimeout(1000);          // give the UI a moment

  // 3. ASSERT (this decides pass/fail)
  await expect(page.getByText(/notifications|no new/i).first()).toBeVisible();

  // 4. (optional) log something for the report
  console.log('✅ Notification panel opened');
});
```

### Step 3 — make it bilingual if it checks text
```ts
await expect(page.getByText(/^(logout|लॉग आउट)$/i).first()).toBeVisible();
```

### Step 4 — run just your test
```powershell
npx playwright test tests/Account.spec.ts --grep "Notification bell" --headed
```

### Step 5 — type-check
```powershell
npx tsc --noEmit
```

**Tips**
- If your element might not exist on every course/page, skip gracefully instead of failing:
  ```ts
  if (!(await el.isVisible({ timeout: 3000 }).catch(() => false))) { test.skip(true, 'not present'); return; }
  ```
- For a strict sequence of steps (each needs the previous), put them in `test.describe.serial(...)` and share a page — see `positiveflow.spec.ts` for the pattern.
- Prefer `getByRole` / `getByText` / `getByPlaceholder` over brittle CSS. Use `.first()` when several match.

---

## 9. How to add a whole new test file

Create `tests/MyThing.spec.ts`:

```ts
// CDP (logged-in) version:
import { test, expect } from './helpers/cdpTest';
// ...or fresh browser (sign-up) version:
// import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'https://sphere.aastrika.org';

test.describe('My Thing — coverage', () => {
  test('opens and shows the heading', async ({ page }) => {
    await page.goto(`${BASE_URL}/page/home`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(/welcome/i).first()).toBeVisible();
  });
});
```

Then add a shortcut in `package.json` under `"scripts"`:
```jsonc
"run:mything": "playwright test tests/MyThing.spec.ts --headed",
```
Run it: `npm run run:mything`.

---

## 10. Selector cheat-sheet

| You want to… | Use |
|---|---|
| Click a button by its label | `page.getByRole('button', { name: /save/i })` |
| Match visible text exactly | `page.getByText(/^details$/i)` |
| Match a field by its placeholder | `page.getByPlaceholder(/email/i)` |
| A dropdown option (native) | `select.selectOption({ label: 'BSC Nurse' })` |
| A Material dropdown | click it, then `page.getByRole('option', { name: /assam/i }).click()` |
| Handle "either English or Hindi" | `/^(save|सेव करें)$/i` |
| Wait for something to appear | `await expect(loc).toBeVisible({ timeout: 8000 })` |
| Try, but don't crash if missing | `await loc.isVisible({ timeout: 2000 }).catch(() => false)` |

---

## 11. Reports

Every run automatically writes:
- an **Excel** file → `test-reports/excel-reports/`
- a **Tarento HTML** report → `brand-reports/`

> **Important:** if you add `--reporter=json` (or `line`) on the command line, it **replaces** the config reporters, so **no Excel/HTML is produced**. To get the reports, run **without** a `--reporter` flag.

To build one combined report across suites:
```powershell
npm run report:sanity     # runs auth + app + course, then merges
# or run pieces yourself, then:
npm run report:merge
```

To turn any HTML document into a PDF (used for the guides in `docs/`):
```powershell
node scripts/make-pdf.mjs docs/MyDoc.html docs/MyDoc.pdf
```

---

## 12. Troubleshooting & golden rules

| Symptom | Cause & fix |
|---|---|
| **"two versions of @playwright/test" / describe() error** | You ran from the wrong folder. Run from `SphereWebAutomation`, not `Automation`. |
| **CDP test fails: "Could not connect over CDP"** | The debug Chrome isn't running. Launch it on port 9222 and log in. |
| **Account/course pages are blank** | You're on **localhost**. Switch `BASE_URL` to production (CDP pages need the real site). |
| **Everything on a page fails after one test** | A pop-up/modal was left open. Dismiss it in `beforeEach` (Escape / close backdrop). |
| **Text checks fail only sometimes** | The account is in **Hindi**. Make the check bilingual, or reset language to English. |
| **Sign-up OTP step fails (0 messages)** | yopmail bot-block/CAPTCHA. Wait ~15–60 min, rely on the throttling, or switch mail provider. |
| **No Excel/HTML report generated** | You used `--reporter=json/line`. Remove it. |
| **Competency shows "no result"** | The account role isn't ANM/MPW — the self-heal in `Competency.spec.ts` fixes it automatically. |
| **A page keeps redirecting to home** | Don't `goto` deep URLs (`/app/user/competency`); click the menu button instead. |

### The golden rules
1. **Always run from `SphereWebAutomation/`.**
2. **CDP suites** need the debug Chrome open and logged in.
3. **CDP/account/course suites → production; sign-up suites → staging.**
4. **Prefer role/text/placeholder selectors; make text bilingual.**
5. **Never leave a modal open** at the end of a test on a shared page.
6. **`npx tsc --noEmit`** before you consider a change done.
7. **Don't add `--reporter=json`** if you want the Excel/HTML reports.

---

*You now have everything: setup, commands, per-file changes, how the mechanisms work, and how to add tests. Start small — copy an existing test, change the selector and assertion, run it with `--grep`, and build from there.*
