# Master Report — one run, every test, one branded report

> For sharing a complete automation coverage report with the client. Runs the
> **entire** functional suite in a single pass — across both environments — and
> produces one Tarento-branded report with no test left out.

---

## The problem it solves

The suite spans **two environments**:

| Environment | Specs | Env var |
|---|---|---|
| **Staging** (signup/OTP flows — can't run on the localhost mirror) | `create-account`, `OTP`, `positiveflow` | `STAGING_URL` |
| **App** (the logged-in portal) | `PublicPage`, `public-login`, `Account`, `Competency`, `CourseComplete`, `CourseTOC`, `Mycourse`, `PrivatePage`, `SCROM`, `Profile/*` | `BASE_URL` |

Because each spec reads **its own** env var (not a single config `baseURL`), a single
`playwright test` run routes each spec to the right environment — and the branded
reporter aggregates all of them into **one** report.

---

## Run it

```bash
npm run report:full     # every UI spec (both envs), headless, one report
```
- `report:full` → the `Chrome` project = all functional specs across both envs.
- `report:all`  → also includes the Layer 2 `api` contract tests.
- Runs **headless** (via `HEADLESS=true`) so it's fast and unattended.

Output (open the first one to share):
```
brand-reports/latest.html                      ← the client-facing branded report
brand-reports/report_<timestamp>.html          ← timestamped copy
test-reports/excel-reports/TestReport_*.xlsx   ← branded Excel
```

The report header shows both environments + their URLs, and every row is tagged
**App** or **Staging**, so the client sees exactly what ran where. Nothing is
filtered: one pass captures every test in the project.

---

## Environment setup (pick one before running)

The report reflects whatever `BASE_URL` / `STAGING_URL` point at. Choose based on
who the report is for:

### Option A — everything on staging (recommended for a client report)
Cleanest: one real environment, no localhost, no "localhost" showing in the report.
```dotenv
BASE_URL=https://staging.aastrika.org
STAGING_URL=https://staging.aastrika.org
```
Prereq: valid login credentials the app specs use.

### Option B — mixed (your dev setup: app on the localhost mirror)
```dotenv
BASE_URL=http://localhost:3000
STAGING_URL=https://staging.aastrika.org
```
Prereqs: the localhost mirror is **running on :3000**, and a valid `SESSION_COOKIE`
+ `SESSION_LOCALSTORAGE` are set (they expire — refresh from DevTools). The app
specs authenticate via the seeded session; the signup specs still hit staging.

> If an environment isn't reachable at run time, those specs **fail** (and appear
> red in the report) rather than being silently dropped — so "complete" stays
> honest. For a clean green client report, make sure the chosen environment(s) are
> up and credentials are fresh before running.

---

## What the client receives

`brand-reports/latest.html` — a self-contained, Tarento-styled page:
- KPI cards (Total / Passed / Failed / Skipped) + a gold **Pass Rate** headline
- Per-test table: **Env** badge, spec, test name, status, duration, error
- Both environment URLs in the header

It's a single file — email it or drop it in a shared drive as-is. (No logo, per brand.)

---

## Notes

- **Runtime:** the full suite includes heavy journeys (`CourseComplete`,
  `Competency` level-climbs) — a full pass can take a while. That's expected for a
  complete coverage report.
- **Adjusting the env split:** if the staging spec list changes, set
  `STAGING_SPECS="create-account,OTP,positiveflow,<new>"` and the report re-tags rows.
- **Excel too:** the same run also writes a brand-styled `.xlsx` for teams that
  prefer a spreadsheet.
