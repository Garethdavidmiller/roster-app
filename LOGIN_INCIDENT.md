# LOGIN_INCIDENT.md — live working log for the login freeze/slowness

*Status: **OPEN / UNRESOLVED** as of v14.74 (Jun 2026). Owner reports login still not
"totally fixed." This file is the running memory of what was changed, what was rolled back, and
what is still suspected, so any session can resume diagnosis without re-deriving it. Not
version-stamped; not a runtime asset. Branch: `claude/review-claude-md-mKJbK`.*

---

## TL;DR — current production-intended state (what is ON / OFF right now)

| Flag / rule | Value now | Was | Why changed |
|-------------|-----------|-----|-------------|
| `CONFIG.ENFORCE_NAMED_SESSION` (B1) | **`false`** (rolled back v14.72) | `true` (since v14.42) | Suspected (wrongly) as the freeze cause; kept off until login is stable |
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
- Owner on 14.74: **"not sure it is totally fixed."** ← we are here.

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

## Re-enable checklist (do NOT do until login confirmed smooth on the deployed build)

- [ ] Owner confirms login is smooth across roles (admin, manager, CEA, CES, dispatcher) in a private window.
- [ ] Re-enable B1: `ENFORCE_NAMED_SESSION = true` (one clean commit, revert the ⚠️ comment).
- [ ] Re-enable B3 sweep: `CLAIM_EPOCH = 1` (or bump).
- [ ] Verify again, then resume the **B3 strict cutover** (drop `!('name' in token)` from `overrides`
      create/update/delete) per SECURITY_RELEASE_PLAN.md → B3.
