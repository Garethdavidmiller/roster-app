# LOGIN_INCIDENT.md — live working log for the login freeze/slowness

*Status: **LOGIN FREEZE RESOLVED at v14.75** (Jun 2026) — owner-confirmed in a private window:
login is smooth, including the previously-frozen joiner accounts (Okeke, Jedlinski). Now in
**MONITORING**. The fix was the login-contract change (timeout `ensureNamedSession` + only save the
local session after auth resolves + visible "Signing in…" state) on top of the earlier email-check
fixes. **Status update (v14.98):** **B1 (`ENFORCE_NAMED_SESSION`) has been RE-ENABLED** (`true`) now
that login has been stable since the v14.75 fix and B1 was exonerated. The **B3 sweep (`CLAIM_EPOCH`)
stays OFF (`0`)** — it belongs with the B3 strict-rule cutover, not this step. **Remaining open:** (1)
the **B3** strict override rule + claim-refresh sweep (next security step); (2) a **residual slight slowness connecting to Firestore on first
load** — owner notes this is **pre-existing / long-standing**, it is now **OFF the login critical
path** (non-blocking — login no longer waits on it), and it is **deferred** (likely the first-read
connection + auth-token handshake; revisit later if it gets worse). This file is the running memory
so any session can resume without re-deriving it. Not version-stamped; not a runtime asset. Branch:
`claude/review-claude-md-mKJbK`.*

---

## TL;DR — current production-intended state (what is ON / OFF right now)

| Flag / rule | Value now | Was | Why changed |
|-------------|-----------|-----|-------------|
| `CONFIG.ENFORCE_NAMED_SESSION` (B1) | **`true`** (RE-ENABLED v14.98) | `false` (rolled back v14.72) | Exonerated; re-enabled once login confirmed stable on the v14.75 fix |
| `CONFIG.CLAIM_EPOCH` (B3 sweep) | **`0`** = disabled (rolled back v14.72) | `1` (v14.71) | Removed forced `getIdToken(true)` as a variable while diagnosing |
| B2 override rule + `manager` claim | **LIVE** (merged, deployed) | n/a | NOT rolled back — server-side, permissive, not implicated |
| B3 strict override rule | **NOT shipped** (still permissive) | n/a | Was never deployed; gated on the freeze being resolved |

**Rollback to re-do once login is confirmed stable:** set `ENFORCE_NAMED_SESSION` back to `true`
and `CLAIM_EPOCH` back to `1` (or higher) in `roster-data.js`, in one clean reviewed commit. They
were **exonerated** (see timeline) — the freeze persisted with B1 off — so they are safe to restore.

---

## What the freeze actually is (best current understanding)

A Firestore read was sitting on the **login critical path**: the admin login `onSuccess` `await`ed
the work-email check, which `await`s `getStaffContact()` (a `getDoc`) **before** `window.location
.reload()`. The session is already saved by then, so while that read is slow the user is **signed in
but frozen on the login overlay**. When the read finally returns, the email-check overlay "suddenly
appears." (Confirmed by the owner's Okeke trace: froze → back-to-roster → was briefly in admin →
email check appeared.)

**Why the read is slow (seconds):** it is the **first** Firestore read after a *fresh* sign-in —
the SDK is warming up its backend channel + completing the **auth-token handshake**. Slow, not
denied (a denied read would skip the check, not show it). Plausibly worse right now due to the
post-"Set up accounts" token churn and Okeke/Jedlinski being freshly-provisioned joiner accounts
(coldest first connection).

**Open question (unresolved):** is the slowness ONLY the first-read-after-signin (now off the login
path, so login is fine even if the app is briefly slow), or is there **broader Firestore/token
slowness** affecting other reads (calendar, override list)? Need DevTools Network/Console from a slow
login: which request stalls — `accounts:signInWithPassword`, `securetoken…/token`, or a Firestore
`Listen`/`getDoc` — and any red console errors (`auth/…`, `permission-denied`, referrer-blocked).

---

## Timeline (most recent last)

**Before the incident (security release, this session):**
- B1 (named-session enforcement) enabled v14.42 (`ENFORCE_NAMED_SESSION=true`).
- B2 (per-member override isolation: permissive 3-tier rule `name||admin||manager||!name`, + `manager`
  claim in `setupRosterAuth`) **merged + deployed**. Owner ran Operations → **Set up accounts** to
  provision the `manager` claims (B2 verification).
- B3 claim-refresh sweep **built v14.71**: `CONFIG.CLAIM_EPOCH` + `refreshClaimsIfStale()` in
  `session.js` (fire-and-forget `getIdToken(true)` after a named session resolves).

**Incident + hotfixes:**
- Owner: "login running incredibly slow," then **"freezing on the login screen even though signed in."**
- **v14.72 HOTFIX** — `ENFORCE_NAMED_SESSION → false` (B1 kill-switch) + `CLAIM_EPOCH → 0` (sweep off).
  Initial theory: B1 re-login loop. (Both reversible one-liners.)
- Owner on 14.72: still hung; signed into **Jedlinski**; pressed back-to-roster → was logged in.
  ⇒ **B1 EXONERATED** (freeze persisted with B1 off).
- **v14.73 HOTFIX** — time-boxed the email-check read: `getStaffContact` wrapped in a 4s
  `Promise.race` timeout in `_runEmailCheck` (`admin-app.js`). Diagnosis: email check `await`s the
  read before reload.
- Owner on 14.73: signed into **Okeke**; froze; back-to-roster; "briefly in admin"; **email check
  screen suddenly appears.** ⇒ 4s cap *bounded* but didn't *remove* the freeze (read still on the
  login path).
- **v14.74 HOTFIX** — removed the email check from the login critical path entirely: admin login
  `onSuccess` now just `window.location.reload()`. The email check still runs on the next page load
  via `initEmailCheck()` (already wired, fire-and-forget, with the 4s read cap), so no Firestore read
  remains on the login→reload path.
- Owner on 14.74: **"not sure it is totally fixed."** Then provided an external code review.
- **v14.75 FIX (the deeper login-contract fix, from the external review — verified correct):**
  `login-overlay.js` `attempt()` was saving the local session (`saveSession(name)`) **before**
  `await ensureNamedSession(name)`, and that await had **no timeout**. So a slow Firebase Auth step
  (token restore / sign-in / anonymous fallback) left the overlay stuck while the app already
  honoured the saved session → "half signed-in" (navigate away = phantom signed-in; Admin later ran
  its email check off the stray session). v14.75: (1) wrap `ensureNamedSession` in an **8s
  `withTimeout`**; (2) **only `saveSession` AFTER auth resolves** (on timeout/enforce-failure: no
  session written, button restored, error shown); (3) visible **"Signing in…"** disabled button.
  This is the real remaining freeze fix (my v14.72–74 only addressed the email-check half). 671 unit
  + 68 e2e pass (incl. all B1 login-overlay paths).

---

## Files touched by the hotfixes (for revert/reference)

- `roster-data.js` — `CONFIG.ENFORCE_NAMED_SESSION=false`, `CONFIG.CLAIM_EPOCH=0` (both with
  ⚠️ comments marking them as temporary).
- `admin-app.js` — `_runEmailCheck` getStaffContact 4s timeout (v14.73); `showAdminLogin` onSuccess
  no longer awaits the email check (v14.74).
- `session.js` — `refreshClaimsIfStale()` + `CLAIM_EPOCH_KEY` (built v14.71; now no-ops because
  `CLAIM_EPOCH=0`). Not reverted — just inert.

## Things NOT yet tried / next diagnostic steps

1. **Get DevTools evidence** from a genuinely slow login (private window, never an installed phone):
   which network request stalls + any console errors. This decides "first-read-only" vs "broader
   Firestore slowness."
2. If broader: suspect the **auth-token handshake** — check whether `getIdToken()` itself is slow,
   whether App Check is unexpectedly involved, or whether the API-key **referrer allowlist** is
   missing a domain (CLAUDE.md warns this makes Firebase Auth calls silently fail/slow).
3. Consider **warming the Firestore connection** earlier (a cheap read kicked off during sign-in) so
   the first real read isn't cold — only if the slowness is confirmed to be first-read latency.
4. Confirm whether the slowness is account-specific (joiners Okeke/Jedlinski) or universal — if
   account-specific, re-check those accounts' provisioning/claims from "Set up accounts."

## Comprehensive review (v14.78) — 3 independent adversarial passes + all gates

A max-effort review of all security + architecture + login code: 678 unit + 173 rules + 68 e2e all
green, plus 3 parallel reviewers (login flow / security rules+claims / architecture Track 1).
**Security: clean. Architecture: clean.** Login: **one real low-severity bug found and FIXED (v14.78)** —
the `_attempting` sign-in mutex didn't actually serialise attempts: the per-handler
`.finally(() => _attempting = false)` cleared the flag even for early-returned (mutex-held) calls, so
repeated Enter during the auth round-trip could start a second concurrent `runNamedSignIn`. Benign in
this build (idempotent post-await `saveSession`, duplicate `reload()`, lockout still held by
`_lockedUntil` — no freeze / half-signed-in / security impact) but a genuine defect. Fix: `_attempting`
is now owned solely by `attempt()`'s inner `finally` (keyed on `_lockedUntil`, not button state) + the
30s-lockout timer; the handlers no longer reset it. The login-freeze class itself is confirmed fixed
(saveSession is single-site + post-auth; no Firestore/auth call on the login critical path).

## Recommended follow-ups from the external review (not yet done — lower priority than the freeze fix)

- **Email-check trigger marker (review "Fix 4") — ✅ DONE (v14.77), with a 3-monthly cadence (owner
  request).** The modal now shows ONLY after a real login (one-shot `myb_email_check_pending_<member>`
  set in `showAdminLogin.onSuccess`, consumed on the next load) AND only when due — `_emailCheckDue()`
  treats `myb_email_check_done_<member>` as the last-confirmed timestamp and re-prompts every ~3 months
  (`EMAIL_CHECK_INTERVAL_MS`); `_dismiss()` stamps the time. Legacy `'1'` flags read as due so the
  cadence starts cleanly. See CLAUDE.md "Work email check" decision.
- **Login-click-path tests (review's test list) — ✅ DONE (v14.79).** Added two DOM-level Playwright
  tests that drive the REAL overlay (select grade/name, type the surname password, click Sign in),
  not just the pure `runNamedSignIn` core: (1) while Firebase auth is in flight (`__E2E.hangSignIn`
  fixture hook → sign-in never resolves) the button reads "Signing in…", **no** `myb_admin_session`
  is written, and the Back link is inert; (2) a failed enforced sign-in (`enforceNamedSession` +
  `__E2E.failSignIn`) shows an error, restores the "Sign in →" button, re-enables Back, and writes no
  session. e2e count 68 → 72. (The "no save while pending / save only on success / timeout path"
  logic also stays covered by the pure `login-overlay.test.mjs`.)
- **Back-link hardening during sign-in — ✅ DONE (v14.79, from the external review of v14.78).** The
  `← Back to roster` anchor in `login-overlay.js` previously had no guard, so a mid-submit tap could
  navigate away during the auth round trip and re-open the half-signed-in escape route the v14.75 fix
  closed (Escape was already guarded; the anchor was not). Fix: a `_signingIn` flag (true ONLY during
  the Firebase round trip, NOT during a 30s password lockout — so a lockout still lets you reach the
  public roster) drives a `preventDefault` click guard plus a visible inert state (`.login-back--busy`
  in `shared.css` + `aria-disabled`); both are cleared in `attempt()`'s `finally`.
- **Confirm the live PWA is actually serving the latest version**, not stale SW cache, when testing —
  About panel shows the version; or DevTools: `fetch('./roster-data.js?b='+Date.now()).then(r=>r.text()).then(t=>console.log(t.match(/APP_VERSION = '([\d.]+)'/)))`.

## Login latency improvements (v14.79–80, from the latency review)

A four-layer latency review was actioned **safest-first**. Shipped now (no security/behaviour
change, no architecture dependency):

- **Pre-warm Firebase Auth** — `primeAuth()` (session.js) is fired when the login overlay mounts; it
  starts `authReady` + the first `onAuthStateChanged` restore in the background and caches it.
  `ensureFirebaseSession` consumes that promise **once** instead of starting the restore on submit, so
  the IndexedDB restore overlaps the user's typing. One-shot + best-effort: not primed / failed /
  tests → fresh restore, identical to before. **This is the low-risk latency win the review ranked
  highest.**
- **Staged progress + success confirmation** — a `#loginStatus` line escalates while auth is in flight
  ("Checking your sign-in…" → 1.5s → 4s), and on success the button shows "Signed in — opening X…"
  before the reload, so a multi-second wait reads as progress, not a freeze.
- **Back link disabled during an in-flight sign-in** (v14.79, above).

**Deliberately deferred (need the architecture/security work first — do NOT hack page-by-page):**

1. **Stop doing auth twice — remove the post-login `reload()`** and instead remove the overlay +
   initialise the page in place. The single biggest win, BUT it depends on finishing the auth-state
   store + retiring the one-shot `sessionReady` (a coordinator currently resolves `sessionReady(false)`
   on the login path, which a no-reload flow can't re-resolve true). Tracked in ARCHITECTURE_PLAN.md.
2. **Split the login shell from the Firebase import** (lazy `import('./session.js')` only after the
   local surname check) — lower value here than it looks, because every protected page's coordinator
   already imports session.js→firebase-client at module load, so the overlay isn't the thing pulling
   Firebase in. Revisit alongside #1.
3. **Strict named sessions remove the slow create-user/anonymous fallback path** → faster, clearer
   failures. Gated on B1/B3 being re-enabled (below) after accounts are provisioned.
4. **Email check as a banner, not a full-screen modal** — explicitly NOT changed unilaterally: CLAUDE.md
   records the "mandatory once shown, no ✕" decision (GDPR/contactability). An owner call.

## Re-enable checklist (do NOT do until login confirmed smooth on the deployed build)

- [x] **Stale-auth generation guard — DONE (v14.87, correctness fix v14.91).** `session.js` `_authGen`:
      each `ensureNamedSession` takes a generation and a superseded (timed-out, late-resolving) attempt
      drops ALL its terminal writes, so it can't downgrade the winner's `_fbIdentity`/auth-store identity.
      This was the reviews' stated prerequisite for re-enabling strict enforcement — without it, a stale
      completion under B1 could trigger a spurious re-login. **v14.91:** a review caught one terminal-state
      write the v14.87 guard had left UNGUARDED — the top `_fbIdentity='none'` reset in `ensureFirebaseSession`.
      With ENFORCE on, a superseded retry (ensureNamedSession re-enters with its stale gen) ran that reset
      AFTER the winner committed, leaving `_fbIdentity` stuck at `'none'` while the store read `'named'`
      (the exact disagreement the guard exists to prevent). Now gen-guarded; regression test added
      (ENFORCE-on retry-loop overlap, verified to fail without the fix). No behaviour change while B1 is off.
- [ ] Owner confirms login is smooth across roles (admin, manager, CEA, CES, dispatcher) in a private window.
- [x] Re-enable B1: `ENFORCE_NAMED_SESSION = true` (done v14.98, one clean commit). Verify live in a private window across roles, then watch login for a day; one-line revert if needed.
- [ ] Re-enable B3 sweep: `CLAIM_EPOCH = 1` (or bump) — with the B3 strict cutover, not before.
- [ ] Verify again, then resume the **B3 strict cutover** (drop `!('name' in token)` from `overrides`
      create/update/delete) per SECURITY_RELEASE_PLAN.md → B3.
