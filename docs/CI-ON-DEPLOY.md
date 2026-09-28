# Run automation on prod deploy (GitHub) + efficiency/cleanup plan

Two parts: (A) how the deploy-triggered CI works and what it needs, and (B) the
plan to make the suite efficient and CI-ready.

---

## A. GitHub integration — run on prod deploy, publish a report

**Workflow:** `.github/workflows/prod-deploy-tests.yml` — triggers on
`repository_dispatch: prod-deployed` (or manual `workflow_dispatch`), runs the
suite against prod, and uploads the branded report as an artifact (+ email on
failure).

**Trigger it from your prod deploy pipeline** with one HTTP call at the end of a
successful deploy:
```bash
curl -X POST \
  -H "Authorization: token $GH_PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/SphereWebAutomation/dispatches \
  -d '{"event_type":"prod-deployed"}'
```

### What I need from you to switch it on
1. **Repo on GitHub** — this folder isn't a git repo yet:
   ```bash
   git init && git add -A && git commit -m "Sphere web automation"
   gh repo create <owner>/SphereWebAutomation --private --source=. --push
   ```
2. **A PAT** (or GitHub App token) your deploy pipeline can use to POST the
   `repository_dispatch` (scope: `repo`). Store it in the deploy pipeline, not here.
3. **Secrets** (`gh secret set …`): `MONITOR_EMAIL`, `MONITOR_PASSWORD` (a prod
   test account for the login smoke), and the SMTP set (`SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`) for the emailed
   report.
4. **Decision:** which specs run in CI (see the blocker below).

### The CDP blocker — RESOLVED (Phase 1 done)
`Account`, `Competency`, `CourseComplete`, `CourseTOC`, `Mycourse`, `PrivatePage`
used to authenticate via **CDP** (a live local Chrome), which GitHub Actions can't
provide. They now use `tests/helpers/authedTest.ts`, which authenticates once per
run and hands each test a logged-in **storageState** context — so they run headless
in CI. Provide a prod test account (`TEST_USER_EMAIL` / `TEST_USER_PASSWORD`
secrets) and the workflow runs the authenticated suite too.

Auth mode is env-driven (see Phase 1 below). Local dev on the localhost mirror
still works via `USE_CDP=1`.

---

## B. Efficiency + cleanup plan

Grounded in the current code: `scrollAndClick` defined 11×, `getStoredEmail` 5×,
`loginWithPassword` 3×, `BASE_URL` 21×, and **487 `waitForTimeout` calls**.

### Phase 1 — CI-capable auth ✅ DONE
Replaced CDP auth with `tests/helpers/authedTest.ts`: authenticate once per worker,
hand every test a logged-in **storageState** context. All 6 formerly-CDP specs now
import `authedTest` instead of `cdpTest`. Auth mode (first match wins):

| Mode | When | Env |
|---|---|---|
| CDP | local dev on localhost mirror | `USE_CDP=1` (Chrome on `--remote-debugging-port=9222`) |
| Cookie | seeded session | `SESSION_COOKIE` (+ `SESSION_LOCALSTORAGE`) |
| API-provision | fresh user each run | `AUTH_VIA_API=1` + `SPHERE_API_TOKEN` + cookie |
| UI login | real env (CI) | `TEST_USER_EMAIL` + `TEST_USER_PASSWORD` |

`state.json` is written to `.auth/` (gitignored). `helpers/cdpTest.ts` is now unused
(superseded; safe to delete in Phase 3).

### Phase 2 — consolidate duplicated helpers
Move the copy-pasted helpers into `tests/helpers/ui.ts`:
`scrollAndClick`, `clickTab`, `getStoredEmail`, and reuse the existing
`loginWithPassword` from `tests/helpers/login.ts`. Delete the per-file copies.
One env module for `BASE_URL` / `STAGING_URL` instead of 21 declarations.

### Phase 3 — delete dead code
Remove unused constants/functions/imports per spec (done for `Mycourse`:
dropped its unused `loginWithPassword`, `getStoredEmail`, `EMAIL_RECORD`,
`AUTH_STATE_FILE`, `LOGIN_PASSWORD`, and `fs`/`path` imports — ~40 lines).

### Phase 4 — replace `waitForTimeout` (biggest speed + stability win)
Swap the 487 fixed sleeps for Playwright web-first assertions / auto-waiting
(`expect(locator).toBeVisible()`, `waitForURL`, `waitForResponse`). This alone
cuts run time substantially and removes most flakiness.

### Phase 5 — share state, trim runtime
Single shared tab per file where safe (done for `Mycourse`); shared
`storageState` so specs don't each re-login; consider sharding in CI.

**Suggested order:** Phase 1 (unblocks CI) → 3 (quick wins) → 2 → 4 (largest, do
incrementally per spec) → 5. Each phase should be run/verified before the next.
