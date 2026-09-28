# Sanity Positive-Flow Report (two envs → one merged report)

> The end-to-end positive journey — **create account → login → consume a course** —
> can't run in a single environment *yet*, so we run it as two grouped sanity
> reports and **merge** them into one branded report. When a single stable
> environment exists, this collapses to one `npm run report:full` run.

---

## Why it's split right now

| | Staging | Localhost mirror |
|---|---|---|
| Login / Create account | ✅ works | ❌ can't (login/signup flow not usable) |
| Courses to consume | ⚠️ too few | ✅ available |

So the positive flow is captured in two groups, each on the env where it works,
then merged:

| Group | Runs | Env | Command |
|---|---|---|---|
| **auth** | create-account · public-login · positiveflow · OTP | Staging | `npm run report:auth` |
| **app** | Account · Mycourse · CourseComplete · CourseTOC · Competency | Localhost / `BASE_URL` | `npm run report:app` |
| **merge** | combine both into one branded report | — | `npm run report:merge` |

---

## Run it

### Option 1 — everything in one command (both envs must be reachable)
```bash
npm run report:sanity
```
Clears old blobs → runs `report:auth` (staging) → runs `report:app` (localhost) →
merges. Prereqs: staging reachable **and** the localhost mirror up on :3000 with a
valid `SESSION_COOKIE` / `SESSION_LOCALSTORAGE`.

### Option 2 — one group at a time, merge when ready
```bash
npm run report:auth     # produces the login + create-account report (staging)
npm run report:app      # produces the course-consume report (localhost)
npm run report:merge    # stitches both into one branded report
```
This matches your ask: **one report for login+createaccount, one for the rest,
then merge.** You can run the two groups on different days/machines — the merge
just needs both blobs present under `blob-reports/`.

---

## Outputs

Each group writes its own branded report **and** a Playwright blob (for merging):
```
brand-reports/report_auth_<ts>.html      ← login + create account (Staging)
brand-reports/report_app_<ts>.html       ← course consume etc. (App)
blob-reports/auth/auth.zip               ← blob for merge
blob-reports/app/app.zip                 ← blob for merge
```
`report:merge` gathers the blobs and produces the combined report:
```
brand-reports/report_merged_<ts>.html    ← the one to share
brand-reports/latest.html                ← always the newest
```
In every report each row is tagged **Staging** or **App**, and the header shows
both environment URLs — so the client sees the full journey and where each part ran.

---

## How the merge works (under the hood)

- Grouped runs set `BLOB=1` + a per-group `BLOB_DIR`, so Playwright's blob reporter
  (which clears its own output dir on start) can't wipe another group's blob.
- `scripts/merge-branded.mjs` copies every `blob-reports/<group>/*.zip` into one flat
  folder and calls `playwright merge-reports --reporter ./reporters/brand-html-reporter.ts`,
  so the merged output is the **same Tarento-branded** report — not the default
  Playwright HTML.

---

## When you get a single stable environment

Drop the split entirely and run the true end-to-end positive flow in one pass:
```bash
npm run report:full        # every functional spec, one env, one report
```
(See [MASTER-REPORT.md](MASTER-REPORT.md).) At that point create → login → consume
runs in a single go, and there's nothing to merge.

---

## Tuning

- **Which specs are in each group:** edit the file lists in the `report:auth` /
  `report:app` scripts in `package.json`.
- **Env tagging:** specs listed in `STAGING_SPECS`
  (`create-account,OTP,positiveflow,public-login` by default) render as **Staging**;
  everything else as **App**. Override with `STAGING_SPECS="a,b,c"`.
- **Runtime:** `CourseComplete` / `Competency` are long journeys — expected for a
  real consume report.
