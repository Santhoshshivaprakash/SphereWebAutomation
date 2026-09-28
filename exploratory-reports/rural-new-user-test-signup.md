# Rural New-User Test Report — Signup / Onboarding (verified)

**Persona:** Meena (34, rural, first-time user, low-end Android, slow 2G/3G, low digital literacy, English not first language)
**Target:** https://portal-staging.aastrika.org/page/home → redirects to `/public/home`
**Journey:** Home → understand portal → Log in → Create Account → Select language → signup form → name confirmation → **OTP screen (stopped here per safety rules — OTP not entered)**
**Run type:** Exploratory pass via in-app browser (mobile 375×812), followed by a **manual typed re-check** of the two submit-related findings.
**Evidence captured this run:** DOM / accessibility tree, network log, console log. **No screenshots** (browser pane not composited this session).

> ✅ **This report supersedes the automated-only pass.** Two "High" findings from the first pass turned out to be **automation artifacts, not product bugs** — see "Corrections" below. The core onboarding flow **works end-to-end up to OTP.**

---

## Corrections from the automated-only pass (important)

| First-pass claim | Verdict after manual re-check |
|---|---|
| 🔴 "Home *Create Account* button does nothing" | ❌ **False.** Clicking it routes correctly to `/app/create-account`. The earlier failure was synthetic coordinate-taps not firing JS handlers (pane not composited). |
| 🔴 "Signup submit does nothing / no feedback" | ❌ **False.** Submitting opens a **name-confirmation modal** ("…will be shown on the certificate → Confirm name"), then **sends an OTP**. Flow works. |
| "3 stacked duplicate confirmation dialogs" | ⚪ **Not a bug** — caused by *my* repeated submit attempts during testing, not the product. |

**Lesson baked into the agent:** prefer real typed input; tag anything that could be a tooling limit as *[needs manual confirmation]* before calling it a bug.

---

## Meena's journey (narrated)

1. **Home page.** "Free healthcare courses for nurses," trust numbers (310,000+ learners). Busy, and full of short-forms she doesn't know: *CNE*, *AMTSL*, *ISRH*.
2. **Create Account / Log in.** Both routes work and reach auth. On the login screen the copy says *"Login with your Aastrika account"* — she has none yet, and "Aastrika" ≠ the portal name "Sphere," so she's briefly unsure she's in the right place.
3. **Select Language → हिंदी.** Regional language exists — a relief. (Minor: selecting Hindi re-rendered the same language screen in Hindi and needed a second "Next" — see finding.)
4. **Signup form — fully in Hindi.** पहला नाम, उपनाम, फोन/ईमेल, OTP/पासवर्ड. She types her details, picks OTP, taps अगला.
5. **Name confirmation modal** — "Test Meena — will be shown on the certificate." Nice touch: it makes her check her name before it's printed on a certificate. She confirms.
6. **OTP sent** to her email, with a ~10-min expiry and a resend link. *(Test stops here.)*

**Could Meena onboard? ✅ Yes — the flow works up to OTP entry**, with genuine Hindi support throughout.

---

## Findings (verified, most severe first)

### [High] Broken third-party widget throwing repeated JS errors
- **Where:** Home page (every load).
- **What:** A third-party script from `api.freecustomer.in` throws repeatedly — `TypeError: Cannot read properties of undefined (reading 'template')` — plus `[UserDataCache] Error fetching user data after retries`.
- **Why it matters for Meena:** Failing third-party scripts waste her limited mobile data and can hang/slow a low-end phone.
- **Evidence:** Console errors from `api.freecustomer.in/.../component.bundle.js:102` (tooling-independent).
- **Fix:** Remove or lazy-load / sandbox the `freecustomer.in` widget; it appears misconfigured on staging.

### [High — needs measurement] Heavy page weight for a 2G/3G phone
- **Where:** Home page load.
- **What:** Full Angular JS bundle + many PNG banners (`banner_1_cne_dark.png`, `trusted-banner-sphere-dark.png`, `Group-people-dark.png`) + partner-logo images + 5 Roboto font weights (~40+ asset requests).
- **Why it matters:** Slow and data-hungry on weak connections; she may leave before it loads.
- **Evidence:** Network log (asset count/type). **Exact bytes not measured — run throttled Lighthouse to quantify.**
- **Fix:** WebP + compression, lazy-load below-the-fold banners, subset fonts, code-split. Set a perf budget (ties into the k6/Lighthouse gate).

### [Medium] "Login with your Aastrika account" confuses brand-new users
- **Where:** Login screen (reached on the way to signup).
- **Why:** No account yet, and "Aastrika" vs product name "Sphere" reads as two brands.
- **Fix:** Lead the new-user path with "Create your account"; use one consistent product name (or explain the Aastrika/Sphere relationship once).

### [Medium] Acronym / jargon overload on the public home page
- **Where:** Home + course cards.
- **What:** `CNE Hours`, `CNE: 7.5`, `AMTSL`, `ISRH`, `RMC Charter` shown unexplained.
- **Why:** Meena doesn't know what CNE is; jargon signals "not for me."
- **Fix:** Expand acronyms / add first-use tooltip ("CNE = Continuing Nursing Education").

### [Medium — needs manual confirmation] Language step needs a second "Next"
- **Where:** Signup → Select Language → हिंदी.
- **What observed:** After selecting Hindi and pressing Next, the same language screen re-rendered in Hindi and required pressing "अगला" again to advance.
- **Caveat:** May be influenced by test interaction timing — **please confirm by selecting Hindi and pressing Next once, manually.**
- **Fix (if confirmed):** Advance on selection, or make it obvious language is set and Next is the action.

### [Low] Awkward Hindi microcopy on the OTP screen
- **Where:** OTP screen.
- **What:** Phrases like *"यहां क्लिक करें ईमेल!"* read as literal/word-order-off translations rather than natural Hindi.
- **Caveat:** Native-speaker review recommended.
- **Fix:** Have a Hindi speaker review OTP/verification microcopy for natural phrasing.

### [Low] Home "Create Account" link has no `href` (JS-only routing)
- **What:** It routes correctly on click, but as an `<a>` with no `href` it can't be middle-clicked/opened in a new tab, isn't crawlable, and won't work if JS fails to load (a real risk on flaky rural connections).
- **Fix:** Give it a real `routerLink`/`href` to the signup route.

### [Low] Mixed English/Hindi course titles on the pre-login home list
- **What:** Some titles English, some Hindi (e.g., "केयर ऑफ़ सिक न्यू बोर्न") in the same list.
- **Fix:** Consistent per-card language; localize once language is known.

### [Low] `/page/home` redirects to `/public/home`
- Confirm the redirect is intentional and doesn't break shared/deep links.

---

## Positives (keep these)
- **Full Hindi support** — language option *and* the entire signup form + OTP screen are translated. Big win for the rural persona.
- **Name-on-certificate confirmation** step — thoughtful, prevents a wrong name on a printed certificate.
- **Working end-to-end signup** up to OTP.
- Strong **trust signals** (learner counts, INC certification, partner logos, ratings).
- Decent accessibility base: labelled form controls, alt text on most images, proper radiogroups.

---

## Summary
- **Core task:** ✅ Onboarding works up to OTP; genuine Hindi support throughout.
- **Top 3 to fix first:**
  1. Fix/remove the broken `freecustomer.in` third-party widget (console errors + data waste).
  2. Measure and reduce page weight for 2G/3G (Lighthouse budget).
  3. Clarify the "Aastrika account" vs "Sphere" naming and expand jargon (CNE) for new users.
- **First-impression rating for a rural new user: 7/10** — a working, genuinely Hindi-first onboarding, held back by a broken third-party script, heavy assets, and some jargon/copy polish.

---
*Generated by the `rural-new-user-tester` agent (persona: Meena) + manual verification pass. Evidence: DOM/accessibility tree, network log, console log. OTP not entered (safety stop). No screenshots this run.*
