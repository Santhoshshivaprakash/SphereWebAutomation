# Layer 2 — API / Service Testing

> Added 2026-07-03. This document explains **everything** that was added to bring
> API-level testing (and fast API-based user provisioning) to this repo, why it
> exists, and how to use it.

---

## 1. Why this layer exists

The existing suite is **Layer 1 (UI / E2E)** — it drives a real browser through
signup, login, competency, courses, etc. That's essential but slow and brittle
for *setup*: every test that needs "a logged-in user" pays ~90 seconds of YOPmail
signup wizard.

Sphere is a **Sunbird** platform — every UI action is really a REST call. **Layer 2**
tests those calls directly and, just as importantly, **reuses them as fast test
setup**:

| | Layer 1 (UI) | Layer 2 (API) |
|---|---|---|
| Create a user | ~90s YOPmail signup wizard | ~1s `createUser` API call |
| Speed | seconds–minutes | milliseconds |
| Stability | selector-dependent | contract-dependent |
| What it proves | the screen works | the service works |

Both matter. Layer 2 does **not** replace Layer 1 — it complements it and removes
signup cost from tests that only *need* a user, not a signup *screen*.

---

## 2. The maturity ladder (where this fits)

1. **UI / E2E** — existing specs ✅
2. **API / service** — **this document** ✅ (new)
3. Data-driven (loop orgs / competencies / languages)
4. Visual regression
5. Perf / accessibility / security
6. Cross-browser
7. CI + synthetic prod monitoring
8. AI-assisted / self-healing

---

## 3. What was added — file by file

### New files (7)

```
tests/
├─ helpers/
│  ├─ orgs.ts            # org registry (orgId + email prefix + designation)
│  ├─ sphereApi.ts       # SphereApiClient — the API client
│  ├─ apiFixtures.ts     # sphereApi / apiAccount fixtures + provisionUser()
│  └─ login.ts           # reusable password-login helper (+ terms gate)
├─ api/
│  ├─ auth.api.spec.ts             # auth contract (rejects bad/no creds)
│  ├─ org.api.spec.ts              # org search resolves each channel
│  ├─ userProvisioning.api.spec.ts # create → role → search confirms
│  └─ answerKey.api.spec.ts        # questionset → artifact → answer key
└─ apiFastLogin.spec.ts # REFERENCE: API-provision a user, then log in via UI
```

#### `tests/helpers/orgs.ts`
A small registry of orgs. Only stores what the provisioning APIs need:
`orgId` (for assign-role), an `emailPrefix`, and a `designation`. The real
`channel` string is **not** stored — it's resolved live from the org API by
`orgId`, because some orgs store invisible characters (e.g. a non-breaking space)
that `createUser` validates byte-for-byte. Ships with **BNRC, SIHFWUP, SHSB**;
add more as needed.

#### `tests/helpers/sphereApi.ts`
`SphereApiClient`, built on Playwright's `APIRequestContext` (so every call is
traced and appears in the HTML report). Endpoints wrapped:

| Method | Endpoint | Purpose |
|---|---|---|
| `orgSearch` / `getOrgChannel` | `POST /api/org/v1/search` | resolve an org's exact channel |
| `createUser` | `POST /api/user/v3/create` | create a user → returns `userId` |
| `assignRole` | `POST /api/user/private/v1/assign/role` | grant roles (default `PUBLIC`) |
| `updateProfile` | `PATCH /api/user/private/v1/update` | set profile details |
| `userSearch` | `POST /api/user/v1/search` | find users |
| `questionsetHierarchy` | `GET /api/questionset/v1/hierarchy/:id` | quiz metadata + `artifactUrl` |
| `fetchAnswerKey` | (artifact JSON on S3) | deterministic self-assessment answers |

Also exports `rawPost/rawPatch/rawGet` (return the raw `APIResponse` for
negative-case assertions), plus helpers `authHeaders`, `hasApiCreds`,
`isSuccessEnvelope`, `normalize`, `quizIdFromUrl`.

**Two important details baked in:**
- **Envelope check** — Sunbird replies with `params.status: "SUCCESS"` *or*
  `responseCode: "OK"` and the casing varies, so success is matched
  case-insensitively.
- **Poisoned answer keys** — Sphere sets **all** options to `isCorrect:false` on
  some competency quizzes specifically to defeat the answer-key approach.
  `fetchAnswerKey` detects this and returns `poisoned: true` so callers can fall
  back to another strategy (your `Competency.spec.ts` already uses Gemini for
  exactly this).

#### `tests/helpers/apiFixtures.ts`
Playwright fixtures on top of the client:
- `sphereApi` — a ready `SphereApiClient` bound to the test's request context.
- `provisionUser(api, orgKey)` — create + assign-role a fresh user; returns
  `{ email, password, userId, orgKey }`. Uses the repo's existing
  `generateRandomYopmail()` and the repo password convention `Sample@123`.
- `apiAccount` — a fixture that auto-provisions a user (the **fast alternative to
  the UI `freshAccount` fixture**). Throws a clear message if creds are missing.

#### `tests/api/*.spec.ts`
Four contract specs (11 tests total):

| Spec | Covers |
|---|---|
| `auth.api.spec.ts` | private endpoints reject no-auth / bad-token; valid creds reach org search |
| `org.api.spec.ts` | channel resolves for each org; unknown id → empty result |
| `userProvisioning.api.spec.ts` | `channel → createUser → assignRole → userSearch` confirms; malformed body rejected |
| `answerKey.api.spec.ts` | `questionset → artifactUrl → quiz.json`; reports **usable vs poisoned** |

### Modified files (3)

| File | Change |
|---|---|
| `playwright.config.ts` | added a browser-less **`api`** project (`testMatch **/api/**`); the existing **`Chrome`** project now has `testIgnore **/api/**` so the two never overlap |
| `package.json` | added `test:api` and `test:ui` scripts |
| `.env` | appended `SPHERE_API_TOKEN`, `SPHERE_API_COOKIE`, `SPHERE_USER_PASSWORD`, `SPHERE_DEFAULT_ORG`, `SPHERE_TEST_QUIZ_ID` (existing secrets untouched) |

**Existing UI specs were NOT modified** — they already provision via `freshAccount`
and authenticate via CDP. The `apiAccount` fixture is available to drop into any UI
spec that wants the fast path.

---

## 4. How to run

```bash
npm run test:api     # API project only (no browser)
npm run test:ui      # UI project only (Chrome)
npm test             # everything
```

### Credentials
The private provisioning endpoints need a **bearer token + connect.sid cookie**.
Add to `.env`:

```dotenv
SPHERE_API_TOKEN=<bearer token from DevTools → Network → any request header>
SPHERE_API_COOKIE=<connect.sid value>   # or leave blank to reuse SESSION_COOKIE
```

These are **session creds and they expire** — when API tests start returning
401/419, refresh both from DevTools.

**Without creds the suite still passes:** credential-gated tests `test.skip`
cleanly, and only the live negative-auth checks run — so `npm run test:api` is
safe in CI even before secrets are wired.

To enable the answer-key spec, set `SPHERE_TEST_QUIZ_ID` to a real quiz id (the
`do_...` part of a running `/viewer/quiz/<do_id>?...` URL).

---

## 5. Verified status (2026-07-03)

- `npx tsc --noEmit` → clean
- `Chrome` project excludes the API folder (0 api specs discovered under it)
- `npm run test:api` with **no creds** → **2 passed** (live negative-auth against
  the real server) + **9 skipped** (credential-gated) → 4 spec files, 11 tests

---

## 6. Using the fast path in a UI test

A working reference already exists: **`tests/apiFastLogin.spec.ts`**. It provisions
a user via API (`apiAccount`, ~1s) and logs in through the real UI using the shared
`loginWithPassword()` helper — no signup wizard.

```bash
npm run run:fastlogin      # headed, watch it provision + log in
```

The pattern for any new UI spec:

```ts
import { test, expect } from './helpers/apiFixtures';
import { hasApiCreds } from './helpers/sphereApi';
import { loginWithPassword } from './helpers/login';

test.skip(!hasApiCreds(), 'needs SPHERE_API_TOKEN + cookie');

test('account page loads for a fresh user', async ({ page, apiAccount }) => {
  await loginWithPassword(page, apiAccount.email, apiAccount.password);
  // apiAccount already exists on the server — no signup needed.
  // ...assert account page...
});
```

`loginWithPassword()` also clears the new-user terms gate automatically, so a
freshly provisioned user lands straight in the app.

---

## 7. Next on the ladder

- ✅ **Fast-path reference** — `tests/apiFastLogin.spec.ts` (done).
- **Layer 7 — synthetic prod monitoring:** reuse these specs to run a login +
  one competency smoke every ~15 min against production and alert on failure.
- **Grow `orgs.ts`** toward the full 10-org set for data-driven coverage (Layer 3).
- **Adopt the fast path** in existing setup-heavy specs (e.g. `Account.spec.ts`)
  by swapping `freshAccount` for `apiAccount` + `loginWithPassword`.
