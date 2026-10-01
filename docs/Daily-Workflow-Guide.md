# Daily Workflow Guide — `env-compare-daily.yml`

How the daily production-vs-staging comparison runs on GitHub Actions, and how
to add more scripts to the daily schedule.

File: [`.github/workflows/env-compare-daily.yml`](../.github/workflows/env-compare-daily.yml)

---

## 1. What it does

Every day at **09:00 IST**, GitHub opens every **public** page on production
(`https://sphere.aastrika.org`) and staging (`https://portal-staging.aastrika.org`)
side by side, compares them, and saves a report.

It runs `scripts/compare-env.mjs` without `--auth`, so only logged-out pages are
compared:

- Public home
- Login page
- Create account — step 1 (language)
- Create account — step 2 (details form)

It also checks API parity (live courses, competency areas, learning resources)
and course-catalogue parity (courses that exist on one site but not the other).

---

## 2. How it works

Think of it as an alarm clock plus a to-do list that GitHub runs for you on a
fresh computer:

```
09:00 IST alarm ─► GitHub starts a new Linux machine
                   │
                   ├─ 1. Download your code             (checkout)
                   ├─ 2. Install Node 20                (setup-node)
                   ├─ 3. Install packages               (npm ci)
                   ├─ 4. Install Chrome                 (playwright install)
                   ├─ 5. Compare prod vs staging        (compare-env.mjs)
                   ├─ 6. Write the report on the Summary page
                   └─ 7. Upload the report files        (artifact, kept 14 days)
                   │
                   └─ Machine is deleted
```

### The parts of the file

| Part | Plain meaning |
|---|---|
| `on: schedule: cron: '30 3 * * *'` | "Run every day at 03:30 UTC" (09:00 IST). GitHub may start it a few minutes late. |
| `workflow_dispatch` | Adds a **Run workflow** button in the Actions tab so you can start it by hand. |
| `concurrency` | If a run is still going when a new one starts, the old one is cancelled. |
| `jobs: compare:` | One job, a list of steps that run on one machine. |
| `timeout-minutes: 20` | GitHub stops the job if it runs longer than 20 minutes. |
| `if: always()` | "Do this step even if an earlier one failed", so you always get the report. |
| The "did it complete" check | See below. |

### Green vs red

`compare-env.mjs` gives the same failure signal (exit code 1) in two very
different situations:

- it **found differences** between prod and staging, or
- it **crashed** and could not finish.

The workflow tells them apart by checking whether the JSON report was written,
because the script writes that file only after a complete run:

| Result | Run colour |
|---|---|
| Compare finished, no blocking differences | ✅ Green |
| Compare finished, differences found | ✅ Green, with a ⚠️ note on the Summary page |
| Compare could not finish (crash, site unreachable, setup failure) | ❌ Red |

Differences are **reported, not failed on**, because staging is normally ahead
of production and would otherwise turn the run red every day. To fail on
differences instead, remove `set +e` and the JSON check from the compare step
so the script's own exit code decides.

### Where to see the results

1. Open the repo on GitHub, go to **Actions → Daily Prod vs Staging Compare**, and
   open a run.
2. The **Summary** page shows the plain-English report: every page, what was
   checked on each site, and what differs.
3. At the bottom of the Summary page, download the
   **`env-compare-report-<run number>`** artifact. It contains:
   - `..._SIMPLE.html` / `.pdf` / `.txt`: the plain-English side-by-side report
   - `....html`: the detailed report
   - `....json`: machine-readable results
   - `..._assets/`: screenshots of both sites

Artifacts are kept on GitHub for 90 days (the maximum).

### Environments (production, staging, UAT)

Scheduled runs test **production + staging**. The **Run workflow** button has an
**Environments** choice:

| Choice | What runs |
|---|---|
| `production + staging` (default) | Same as the schedule |
| `uat only` | Compare production vs UAT, plus tests and signup on UAT |
| `production + staging + uat` | Everything, with two compares (vs staging and vs UAT) |

UAT is `uat.aastrika.org` (Sphere) and `ekshamata-uat.aastrika.org` (e-Kshamata).
It is its own backend, so it has its own accounts:

| Repo | Secrets UAT needs |
|---|---|
| Sphere | `UAT_EMAIL`, `UAT_PASSWORD` |
| e-Kshamata | `SPHERE_UAT_API_TOKEN` (creates the UAT test users on UAT) |

The same choice is on the Synthetic Monitor (Sphere) and the e-Kshamata daily
workflow. For Staging Deploy Tests, type `https://uat.aastrika.org` in
"Portal to test"; it then signs in with the UAT account. In the terminal, every
runner's environment menu lists UAT after Staging.

### One combined report, emailed

The last job, `daily-report`, waits for every other job (even failed ones),
collects their results and builds **one report** for the whole run
(`scripts/daily-summary.mjs`):

- headline numbers: tests passed / failed / skipped, compare pages with blocking
  differences, accounts created
- the result of every job
- test results for **production and staging side by side**, per spec file
- every failed test with its reason
- the prod vs staging compare: each public page's verdict, API parity, and the
  course catalogue counts
- the accounts created by the signup jobs

It is shown on the run's **Summary** page, uploaded as `daily-summary-<N>`, and
**emailed** (HTML body, with the report and the compare PDF attached) when these
secrets are set: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`. Only this job receives them, so each run
sends exactly one email. The subject starts with ✅ when everything passed and ⚠️
otherwise. If the email can't be sent, the report is still uploaded and the job
turns red.

### Keeping reports on your PC for good

`npm run reports:pull` downloads every finished run's artifacts, from all
workflows, into `ci-reports/` in the project folder:

```
ci-reports/
  synthetic-monitor-prod-staging/
    2026-09-30_15-00_run42_success/
      monitor-report-production-42/test-reports/run-reports/RunReport_….pdf
      monitor-report-staging-42/…
  daily-prod-vs-staging-compare/
    2026-09-30_09-00_run3_failure/…
```

- Folder names use your PC's local time, the run number and its result.
- Runs already downloaded are listed in `ci-reports/.pulled.json` and skipped, so
  run it as often as you like; only new runs are fetched.
- A download that fails (network, permissions) is not recorded and is retried on
  the next pull.
- `ci-reports/` is git-ignored: the reports stay on your PC and are never pushed.
- Run it at least once every 90 days, or GitHub deletes reports before they are
  copied.

Options: `-- --limit 300` looks further back than the newest 100 runs;
`-- --workflow prod-monitor.yml` pulls one workflow only.

One-time setup (the script uses the GitHub CLI):

```powershell
winget install --id GitHub.cli
# open a NEW terminal, then:
gh auth login      # GitHub.com → HTTPS → log in with a web browser
```

### The GitHub machine starts empty

The GitHub machine has **no `.env` file, no logged-in Chrome, and none of your
local files** beyond what is committed to the repo. Anything a script needs,
such as usernames and passwords, has to be given to it as a **GitHub secret**
(see section 4).

---

## 3. Which other scripts can run daily

Not every script can run unattended on GitHub:

| Script | Daily on GitHub? | What it needs |
|---|---|---|
| **Public compare** (`compare-env.mjs`) | ✅ Already running | Nothing |
| **API tests** (`--project=api`) | ✅ Easy | `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` secrets |
| **Public page UI tests** (`PublicPage`, `public-login`) | ✅ Easy | Nothing (same as the existing `npm run report:ci`) |
| **Signed-in pages** (`Account`, `Mycourse`, `CourseTOC`, `Competency`) | ✅ With secrets | `TEST_USER_*` secrets |
| **Signed-in compare** (`compare-env.mjs --auth`) | ⚠️ Partly | `PROD_*` / `STAGING_*` secrets. Staging login is currently blocked, so the staging side of signed-in pages will fail for now. |
| **Signup specs** (`create-account`, `OTP`, `positiveflow`, `yopmail`) | ✅ Running (`create-account`) | Creates real yopmail accounts on each run; these are excluded from production reporting. Runs on both production and staging, see the `daily-signup` section below. |
| **CourseComplete** | ❌ Not daily | Needs a course name, a Gemini API key and 10+ minutes. It also completes the course, so the next run has nothing left to do. |
| **CompleteCompetency** | ❌ Not possible | Connects to your own logged-in Chrome over CDP, which does not exist on a GitHub machine. |

---

## 4. How to add scripts to the daily run

### Step 1 — Add the secrets

On GitHub, open the repo and go to
**Settings → Secrets and variables → Actions → New repository secret**.
Add each value from your local `.env` that the scripts need:

| Secret | Used by |
|---|---|
| `TEST_USER_EMAIL`, `TEST_USER_PASSWORD` | API tests and signed-in UI tests |
| `PROD_EMAIL`, `PROD_PASSWORD` | Signed-in compare (production side) |
| `STAGING_EMAIL`, `STAGING_PASSWORD` | Signed-in compare (staging side) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM` | Optional: email alerts when tests fail (the same secrets the Prod Synthetic Monitor uses) |

Never commit these values to the repo. Secrets are hidden in GitHub's logs.

### Step 2 — Add a job to the workflow

Each job gets its own machine, and jobs in the same workflow run at the same
time. Paste this under `jobs:` in `env-compare-daily.yml`, at the same
indentation as `compare:`:

```yaml
  daily-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    env:
      BASE_URL: https://sphere.aastrika.org
      HEADLESS: 'true'
      SKIP_SIGNUP: '1'   # never create real prod users
      TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
      TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
      # Optional email alerts on failure:
      SMTP_HOST: ${{ secrets.SMTP_HOST }}
      SMTP_PORT: ${{ secrets.SMTP_PORT }}
      SMTP_USER: ${{ secrets.SMTP_USER }}
      SMTP_PASS: ${{ secrets.SMTP_PASS }}
      ALERT_EMAIL_TO: ${{ secrets.ALERT_EMAIL_TO }}
      ALERT_EMAIL_FROM: ${{ secrets.ALERT_EMAIL_FROM }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Run UI + API tests
        run: >
          npx playwright test
          tests/PublicPage.spec.ts tests/public-login.spec.ts
          tests/Account.spec.ts tests/Mycourse.spec.ts
          tests/CourseTOC.spec.ts tests/Competency.spec.ts
          tests/api/
          --project=Chrome --project=api
      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: daily-test-reports-${{ github.run_number }}
          path: |
            brand-reports/
            playwright-report/
            test-reports/
          retention-days: 14
```

Unlike the compare job, this job **goes red when a test fails**, which is what
you want for tests.

To run fewer specs, delete them from the `npx playwright test` line. Keep
`tests/api/` in the list: when files are listed, Playwright runs only those, and
the `api` project only looks inside `tests/api/`, so without it no API tests run. To run
only the API tests, use `npx playwright test --project=api`.

### Step 3 (optional) — Compare signed-in pages too

In the existing `compare` job, add `--auth` to the compare command and give the
step the credentials:

```yaml
      - name: Compare public pages (production vs staging)
        id: compare
        env:
          PROD_EMAIL: ${{ secrets.PROD_EMAIL }}
          PROD_PASSWORD: ${{ secrets.PROD_PASSWORD }}
          STAGING_EMAIL: ${{ secrets.STAGING_EMAIL }}
          STAGING_PASSWORD: ${{ secrets.STAGING_PASSWORD }}
        run: |
          set +e
          node scripts/compare-env.mjs --auth \
            --a https://sphere.aastrika.org \
            --b https://portal-staging.aastrika.org
          ...
```

While staging login is blocked, the signed-in staging pages will show as
failures in the report.

### Create account on both environments (`daily-signup`)

The `daily-signup` job runs `tests/create-account.spec.ts` on **production and
staging**. It uses a **matrix**: one job definition that GitHub runs twice, once
per environment, on separate machines at the same time. In the Actions tab it
appears as two jobs: `daily-signup (production)` and `daily-signup (staging)`.

```yaml
    strategy:
      fail-fast: false
      matrix:
        include:
          - env: production
            url: https://sphere.aastrika.org
          - env: staging
            url: https://portal-staging.aastrika.org
    env:
      BASE_URL: ${{ matrix.url }}
```

- `BASE_URL` is the only setting that changes between the two runs. The spec
  names staging accounts `stage-testauto…@yopmail.com` and production accounts
  `testauto…@yopmail.com`, so you can tell them apart.
- `fail-fast: false` means a failure on one environment does not cancel the other.
- No secrets are needed: every run registers a new yopmail account and reads the
  OTP from yopmail.
- Each environment uploads its own artifact:
  `daily-signup-production-<run>` and `daily-signup-staging-<run>`.
  `.last-registered-email.json` inside it holds the last email created.

To run more signup specs on both environments, add them to the test line, for
example:

```yaml
        run: npx playwright test tests/create-account.spec.ts tests/OTP.spec.ts tests/positiveflow.spec.ts --project=Chrome
```

To add a third environment, add another `- env: … url: …` entry to the matrix.

Yopmail accounts created by these tests are excluded from production reporting,
so they do not affect real user numbers.

### Step 4 — Commit, push, and test

```powershell
cd D:\Automation\SphereWebAutomation
git add .github/workflows/env-compare-daily.yml
git commit -m "Add daily UI and API tests to the daily workflow"
git push origin main
```

Then go to **Actions → Daily Prod vs Staging Compare → Run workflow** to try it
straight away rather than waiting until 09:00 IST.

---

## 5. Caveats

- **Logins from GitHub may behave differently.** The signed-in specs have not
  been run from a GitHub machine yet. If production shows a captcha or OTP prompt
  for logins from GitHub's servers, those tests will fail there even though they
  pass locally. The same issue may be behind the Prod Synthetic Monitor failures.
- **Changing the time.** The cron time is in UTC. IST is UTC + 5:30, so 09:00 IST
  is `30 3 * * *`. For example, 07:00 IST would be `30 1 * * *`.
- **Scheduled runs only start from `main`.** GitHub runs the schedule from the
  default branch, so changes to the workflow take effect only after they are
  pushed to `main`.
- **Inactive repositories.** GitHub pauses scheduled workflows in a repo with no
  activity for 60 days. Pushing a commit or re-enabling the workflow in the
  Actions tab restarts them.
