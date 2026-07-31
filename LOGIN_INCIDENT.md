# LOGIN_INCIDENT.md — resolved-incident record: the login freeze/slowness

*Status: **RESOLVED at v14.75** (Jun 2026), then **MONITORING**. The login-contract fix (timeout
`ensureNamedSession` + save the local session only after auth resolves + a visible "Signing in…"
state), on top of the earlier email-check fixes, ended the freeze — owner-confirmed smooth in a
private window, including the previously-frozen joiner accounts (Okeke, Jedlinski). **B1
(`ENFORCE_NAMED_SESSION`) was RE-ENABLED (`true`) at v14.98** once login was confirmed stable and B1
was exonerated. The **B3 token sweep is DONE** — `CLAIM_EPOCH` was armed to `2` at v15.33, so every
device force-refreshes its claim once on next open; the **B3 strict Rules cutover SHIPPED at v16.29**
(overrides create/update/delete now require `token.name == memberName || token.admin || token.manager`;
the `!('name' in token)` no-name/legacy escape has been removed). **Still open:** a residual,
pre-existing, slight first-load Firestore slowness, now OFF the login critical path (non-blocking) and
deferred. Not version-stamped; not a runtime asset.
**READ THIS before touching login/auth.***

---

## Current auth-flag state

| Flag / rule | Value now | Why |
|-------------|-----------|-----|
| `CONFIG.ENFORCE_NAMED_SESSION` (B1) | **`true`** (re-enabled v14.98) | Exonerated (freeze persisted with B1 off); re-enabled once login was stable on the v14.75 fix |
| `CONFIG.CLAIM_EPOCH` (B3 sweep) | **`2`** (armed v15.33) | Token sweep done — devices force-refresh once. Do NOT bump again unless deliberately forcing another sweep |
| B2 override rule + `manager` claim | **LIVE** (deployed; superseded by the B3 strict form v16.29) | Server-side; never implicated in the freeze |
| B3 strict override rule | **SHIPPED (v16.29)** — strict; no-name escape removed | Was gated on the freeze being resolved; shipped after the CLAIM_EPOCH=2 sweep + manager re-provision |

---

## Root cause (the load-bearing diagnosis — do not re-introduce)

A Firestore read was sitting on the **login critical path**: the admin login `onSuccess` `await`ed the
work-email check, which `await`s `getStaffContact()` (a `getDoc`) **before** `window.location.reload()`.
The local session is already saved by then, so while that first-read-after-a-fresh-sign-in is slow
(the SDK is warming its backend channel + completing the auth-token handshake — slow, not denied) the
user is **signed in but frozen on the login overlay**; when the read returns, the email-check overlay
"suddenly appears." (Confirmed by the owner's Okeke/Jedlinski traces.)

**Two lessons that must not be undone:**
1. **Never put a Firestore read (or any slow await) on the login→reload critical path.** The email
   check was moved to fire-and-forget on the *next* page load (`initEmailCheck()`, 4s read cap). That
   check was retired entirely at v19.30, but the rule is unchanged and now binds `password-force.js`,
   which took the same shape.
2. **The v14.75 login contract:** `login-overlay.js` must wrap `ensureNamedSession` in an **8s
   `withTimeout`** and **only `saveSession` AFTER auth resolves** (on timeout / enforce-failure: no
   session is written, the button is restored, an error is shown), with a visible **"Signing in…"**
   disabled button. Saving *before* the await caused the "half signed-in" freeze (phantom signed-in if
   you navigated away — Admin later ran its email check off the stray session). This contract is
   enforced by `runNamedSignIn` and covered by `login-overlay.test.mjs`.

**Three subtle invariants added while hardening this — all must survive:**
- **`_attempting` mutex (v14.78):** owned solely by `attempt()`'s inner `finally` (keyed on
  `_lockedUntil`) — the per-handler `.finally` must **NOT** reset it, or repeated Enter during the
  auth round-trip can start a second concurrent `runNamedSignIn`.
- **`_signingIn` back-link guard (v14.79):** the `← Back to roster` anchor is `preventDefault`-guarded
  + inert (`.login-back--busy`) **only during the Firebase round trip** (not during a 30s password
  lockout, so a locked-out user can still reach the public roster) — closing the same half-signed-in
  escape route Escape already guarded.
- **Stale-auth generation guard (v14.87, correctness fix v14.91; B5 spurious-failure fix v17.11):**
  `session.js` `_authGen` — a superseded (timed-out, late-resolving) `ensureNamedSession` attempt drops
  ALL its terminal writes so it can't downgrade the winner's `_fbIdentity` / auth-store identity. **Do
  NOT un-guard the top `_fbIdentity='none'` reset in `ensureFirebaseSession`** (v14.91 caught exactly
  that gap: under B1 a superseded retry ran the reset after the winner committed, leaving
  `_fbIdentity='none'` while the store read `'named'`). **B5 (v17.11):** the superseded branch of
  `ensureNamedSession` no longer returns a blanket `false` — a direct `ensureFirebaseSession(name)`
  overlapping a login bumps `_authGen` and superseded it even though the login's own sign-in succeeded,
  so the overlay showed a spurious "sign-in failed". It now returns the **identity-honest** result
  (`ok && auth.currentUser` is this member's own named account) — reading `auth.currentUser` (ground
  truth), NEVER the shared `_fbIdentity` a newer attempt may have moved, and publishing **nothing** (no
  `_syncAuthTerminal`, no `commit`) so it still cannot clobber the winner. A teardown that superseded it
  (`clearSession`, or timeout→`clearSession`) also signs Firebase out, so `currentUser` is null there and
  it correctly still returns `false`. Covered by `session.test.mjs` → "B5: superseded login is
  identity-honest". This was the reviews' stated prerequisite for re-enabling strict enforcement.

---

## Timeline (condensed)

- **Before:** B1 enabled v14.42; B2 (permissive 3-tier rule + `manager` claim) merged + deployed, owner
  ran Operations → "Set up accounts" to provision the manager claims; B3 sweep built v14.71
  (`CLAIM_EPOCH` + `refreshClaimsIfStale()`).
- **Incident:** login "incredibly slow," then "freezing even though signed in."
- **v14.72** flipped B1 off + `CLAIM_EPOCH` 0 (initial theory: a B1 re-login loop) — the freeze
  persisted ⇒ **B1 EXONERATED** (it froze with B1 off; the owner reached admin via back-to-roster).
- **v14.73–74** time-boxed, then removed, the email-check read from the login path (bounded the freeze
  but didn't remove it — the read was still on the path).
- **v14.75** the real fix: the login contract above (from an external review). 671 unit + 68 e2e pass.
- **v14.77–91** follow-ups, all done: email-check trigger marker + ~3-monthly cadence (v14.77, see
  CLAUDE.md "Work email check"); real-overlay Playwright click-path tests (v14.79); the back-link
  `_signingIn` guard (v14.79); the `_attempting` mutex fix (v14.78); the stale-auth generation guard
  (v14.87/91).
- **v14.98** B1 re-enabled.

Login latency was also improved safest-first (v14.79–80): `primeAuth()` pre-warms Firebase Auth when
the overlay mounts (one-shot, best-effort — see AI_MAP → `session.js`), and a `#loginStatus` line
escalates so a multi-second wait reads as progress. The bigger latency wins (drop the post-login
`reload()`; lazy-load the Firebase import) are **deliberately deferred** to the auth-state-store /
in-place-login work — do **NOT** hack them in page-by-page. Tracked in ARCHITECTURE_PLAN.md → Phases 9/10.

---

## Re-enable checklist (all steps done — B3 strict shipped v16.29)

- [x] **Stale-auth generation guard — DONE (v14.87, fix v14.91).** The prerequisite for strict enforcement.
- [x] Owner confirms login is smooth across roles — satisfied in practice: B1 has run enabled since
      v14.98 and B3 strict since v16.29 with no login complaints (the freeze class this checklist
      guarded against would have surfaced immediately).
- [x] **Re-enable B1** (`ENFORCE_NAMED_SESSION = true`) — DONE v14.98; verify live in a private window
      across roles, watch login for a day; one-line revert if needed.
- [x] ~~Re-enable the B3 sweep~~ **DONE (v15.33): `CLAIM_EPOCH` is `2`** — devices force-refresh once on open.
- [x] **B3 strict cutover — DONE (v16.29):** dropped `!('name' in token)` from `overrides`
      create/update/delete, so writes now require `token.name == memberName || token.admin || token.manager`
      per SECURITY_RELEASE_PLAN.md → B3. Shipped after the CLAIM_EPOCH=2 sweep + manager re-provision;
      stale tokens self-heal via `writeWithClaimRetry` (no mass sign-out needed).
