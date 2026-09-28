# Archive

Retired test files. Nothing in here runs — `playwright.config.ts` has `testDir: './tests'`,
so this folder is outside the test root. Files are kept (not deleted) because this project
is not under version control.

## SphereCase.spec.ts — retired 2026-09-08

The "legacy" consolidated suite: 108 tests in one file, run via a dedicated `legacy`
project. The config already described it as *"brittle hardcoded selectors, redundant with
the dedicated specs"* and quarantined it out of the main run.

**Why it was retired.** A full run had 39 of its tests failing (~15.8 min of a 1.1 h run).
Every failure examined was test rot, not a product defect:

| Test | Cause |
|---|---|
| TC09 / TC10 | Clicked the caption text instead of the play button, so `#myModal` never got its `show` class |
| TC11 | `getByText('Get certified')` matched 2 elements → strict-mode violation |
| TC12 | `waitForLoadState('networkidle')` is a no-op for Angular client-side routing, so the URL was read before the router updated |
| TC13 / TC14 | Expected `/privacy` and `/terms` routes; the app serves both as panels on `/public/tnc?panel=...` |

TC12 was fixed in place before retirement to confirm the diagnosis — it passed.

**Coverage was checked before retiring.** Every area this file touched is covered by a
dedicated spec:

| Area (tests here) | Covered by |
|---|---|
| Account Page (16) | `Account.spec.ts` (68) |
| Public Page (14) | `PublicPage.spec.ts` (64) |
| Login Page (13) | `public-login.spec.ts` (29) |
| Course TOC Page (11) | `CourseTOC.spec.ts` (21) |
| Competency Dashboard (9) | `Competency.spec.ts` (23) |
| Private Home Page (8) | `PrivatePage.spec.ts` (67) |
| Create Account (8) | `create-account.spec.ts` (23) |
| Quiz (6) / Assessment (6) | `SCROM.spec.ts`, `CompleteCompetency.spec.ts`, `CourseComplete.spec.ts` |
| My Courses (5) | `Mycourse.spec.ts` (49) |
| Search Bar (4) | `PrivatePage.spec.ts`, `CourseTOC.spec.ts`, `Mycourse.spec.ts` |
| Notifications (4) | `Account.spec.ts`, `Mycourse.spec.ts`, `PrivatePage.spec.ts` |
| Logout (4) | `Account.spec.ts` |

Suite size went from 527 to 419 tests.

**To restore:** move the file back to `tests/helpers/`, re-add the `legacy` project to
`playwright.config.ts`, and put `legacy` back in the project lists in
`scripts/run-all.mjs` and `scripts/test-inventory.mjs`.
