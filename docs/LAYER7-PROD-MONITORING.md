# Layer 7 — Synthetic Production Monitoring

> Added 2026-07-03. Turns the test suite into a **24/7 uptime watchdog**: a tiny
> login journey runs against **production** every 15 minutes via GitHub Actions,
> and **emails** an alert the moment it goes red.

---

## 1. What it does

Instead of only catching bugs *before* release, this catches outages *in* prod —
before (or as) users hit them. Every 15 minutes a scheduled job:

1. Opens `https://sphere.aastrika.org/public/login` and checks the shell renders.
2. Logs in as a dedicated **monitor account**.
3. Confirms an authenticated page loads after login.

If any step fails, an email alert is sent listing the failing step(s) + error. A
green run stays **silent** (no noise).

This reuses Layer 2/earlier building blocks — `loginWithPassword()` from
`tests/helpers/login.ts` — so the monitor and the functional suite can't drift.

---

## 2. Files

### New
```
tests/monitor/prod-smoke.spec.ts     # the 3 synthetic checks (project: "monitor")
reporters/email-reporter.ts          # emails on failure via SMTP (no-op if unset)
.github/workflows/prod-monitor.yml   # cron */15 + manual dispatch
```

### Modified
| File | Change |
|---|---|
| `playwright.config.ts` | added the **`monitor`** project; registered the email reporter; `Chrome` project now ignores `**/monitor/**` too |
| `package.json` | added `test:monitor` script; added `nodemailer` dependency |
| `.env` | added `MONITOR_EMAIL`, `MONITOR_PASSWORD`, and SMTP vars (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`ALERT_EMAIL_TO`/`ALERT_EMAIL_FROM`) |

---

## 3. Why a *persistent* monitor account (not per-run provisioning)

Layer 2 can provision a fresh user via API — but doing that every 15 minutes would
create ~96 throwaway prod users per day. The monitor instead logs in as **one
dedicated, persistent account**. Create it once (via the normal signup flow, or a
one-off `provisionUser` call) and put its credentials in the CI secrets.

---

## 4. How alerting works

Two layers, so an alert fires even if the run breaks early:

1. **Email reporter** (`reporters/email-reporter.ts`) — runs after the tests. Sends
   an email (via SMTP / nodemailer) listing the failed step(s) and first error line.
   No-op when `SMTP_HOST` / `ALERT_EMAIL_TO` are unset; silent on all-pass.
2. **GitHub's built-in failure notification** — if the job itself dies before the
   reporter runs (e.g. `npm ci` fails), GitHub emails the workflow owner about the
   failed scheduled run automatically.

---

## 5. Setup (one time)

1. **Create the monitor account** on production and remember its email/password.
2. **Get SMTP credentials** for the sender mailbox. For a Google Workspace account
   (e.g. `tech-tools@aastrika.org`): enable 2-Step Verification, then create an
   **App Password** → use `smtp.gmail.com`, port `587`, user = the full address,
   pass = the app password. (Any SMTP server works — Gmail is just the example.)
3. **Push this repo to GitHub** (it isn't a git repo yet):
   ```bash
   cd "D:/Automation/SphereWebAutomation"
   git init && git add -A && git commit -m "Sphere web automation + prod monitor"
   gh repo create <owner>/SphereWebAutomation --private --source=. --push
   ```
4. **Add the secrets** (Settings → Secrets and variables → Actions, or via gh):
   ```bash
   gh secret set MONITOR_EMAIL    --body "monitor@yopmail.com"
   gh secret set MONITOR_PASSWORD --body "••••••"
   gh secret set SMTP_HOST        --body "smtp.gmail.com"
   gh secret set SMTP_PORT        --body "587"
   gh secret set SMTP_USER        --body "tech-tools@aastrika.org"
   gh secret set SMTP_PASS        --body "<app password>"
   gh secret set ALERT_EMAIL_TO   --body "tech-tools@aastrika.org"   # comma-separated for many
   gh secret set ALERT_EMAIL_FROM --body "tech-tools@aastrika.org"
   ```
5. The schedule starts automatically. Trigger a first run manually from the
   **Actions → Prod Synthetic Monitor → Run workflow** button to confirm.

> Until the repo is on GitHub with those secrets, the workflow simply doesn't run —
> the local `npm run test:monitor` still works for validation.

---

## 6. Run locally

```bash
npm run test:monitor
```
- With no `MONITOR_*` creds: only check #1 (public reachability) runs; #2/#3 skip.
- With creds in `.env`: all three run. Set the `SMTP_*` + `ALERT_EMAIL_TO` vars to
  also test email alerting (force a failure to see the email).

---

## 7. Cadence & cost

- `*/15` = 96 runs/day. GitHub may delay scheduled runs by a few minutes under load.
- Each run is ~1–2 min of a hosted runner. If Actions minutes become a concern,
  widen the cron (e.g. `*/30`) or move to a self-hosted runner.
- `concurrency.cancel-in-progress` prevents overlapping runs from piling up.

---

## 8. Verified status (2026-07-03)

- `npx tsc --noEmit` → clean
- `monitor` project isolated (3 tests); `Chrome` project excludes it
- `npm run test:monitor` against prod → **check #1 PASSED** live, #2/#3 skipped
  (no monitor creds locally)

---

## 9. Next ideas

- Add a **competency smoke** as check #4 (open the dashboard, assert a card loads).
- Track **latency** (fail if login takes >N s) to catch slowdowns, not just outages.
- Send a **daily green summary** email so silence isn't mistaken for a broken monitor.
