# PASSWORD_PLAN.md — chosen passwords + admin reset (Track C-lite)

> **STATUS: Phase 0 + Phase 1 SHIPPED v18.63.** The decisions table (§10) was confirmed and built —
> gated dual-attempt sign-in (`credentialCandidatesFor` → `ensureFirebaseSession`), the Settings
> Password card + `savePasswordSetAt`, the `resetMemberPassword` admin break-glass Cloud Function, the
> `passwordStatus` collection + rules, and the Operations Account-status table are all live. **Still to
> come:** Phase 2 (an optional forced set-your-own overlay), C2 (email-based self-service reset, needs
> an email relay), and C5 (retire the surname default once ≥90% have migrated). Sections below that
> read in future tense describe the design as it was written *before* the build — treat them as the
> spec, not a to-do list.

*The agreed design for replacing surname-derived passwords with **user-chosen passwords**, with the
**admin reset button as the recovery channel** — no email, no security questions. This is
SECURITY_RELEASE_PLAN.md → Track C with the email half deferred: it delivers **C4′** (admin reset as
the recovery path) **+ C3** (self-service change), defers **C2** (email verification), and leaves
**C5** (retire the surname — irreversible, ≥90% gate) exactly as planned. Deep-reviewed Jul 2026;
the two critical review fixes (§3.2, §3.3) are load-bearing — do not build without them. Not
version-stamped; not a runtime asset. **Read LOGIN_INCIDENT.md before touching any of this.***

---

## 1. Scope

**In:**
- Every member can set their **own** password (Settings card; forced flow after a reset).
- An admin can **reset any member back to their surname default** with one button on Operations,
  which flips that member to "must set a new password".
- A per-member **"password migrated Y/N"** status, shown on Operations next to the existing
  Work Email Progress data as one **Account status** table (Email ✓/✗ · Password ✓/✗).

**Out (deferred, not cancelled):**
- Email verification (C2), self-service "forgot password" email links, security questions.
  **Recovery = the admin reset.** When Power Automate + an email relay arrive, email becomes an
  additional recovery channel bolted onto this machinery — nothing here is throwaway.

**Unchanged:**
- The login screen shape (grade → name → password), the Firebase account model
  (`initial.surname@myb-roster.local`), the claim tiers (`admin`/`manager`/`name`/`linksDesigner`),
  `ENFORCE_NAMED_SESSION=true`, the calendar's anonymous read, and the 30-day/7-day session rules.
- **No new custom claims → no `CLAIM_EPOCH` bump.** Deliberate: migration state lives in Firestore,
  not tokens, so the whole token-propagation sweep machinery stays untouched — one less way to
  reproduce the v10.94 outage class.

---

## 2. Why this shape (the reframe)

The security win is **not** the recovery mechanism — it is that each member's credential becomes
something only they know. The recovery channel (admin reset now, email later) is swappable. For a
small trusted team, "tell the admin → admin resets → set a new one on next sign-in" is a complete
recovery story at a fraction of the risk surface of codes/questions/emails.

---

## 3. The sign-in model (the crux — login-core surgery)

### 3.1 Today
The typed password is only a **local gate** (`login-overlay.js` — normalise, compare to
`getSurname(name)`); the real Firebase credential is **derived** from the name in
`ensureFirebaseSession` (`session.js` — `normaliseSurname` + pad-to-6). The typed value never
reaches Firebase.

### 3.2 New — the GATED dual-attempt (critical review fix #1)
The typed password becomes the real credential. `ensureFirebaseSession(name, { password? })`:

1. **Attempt 1 — raw typed value** (trimmed of leading/trailing whitespace, otherwise
   UN-normalised — custom passwords have case/digits/symbols). This is the migrated member's path
   and the end state.
2. **Attempt 2 — the derived padded surname — ONLY IF
   `normalise(typed) === normaliseSurname(name)`.** This gate is load-bearing: an ungated fallback
   would sign an attacker typing *anything* into any un-migrated account (the surname attempt would
   succeed regardless of the typed value) — strictly worse than today. Gated, the fallback only
   covers what the local check allows today: caps ("Miller") and the <6-char padding cases
   ("bibi" → "bibibi"). It grants an attacker nothing the surname doesn't already grant.
   Micro-hardening: skip attempt 2 when the raw typed value already equals the derived padded value
   (it would be byte-identical to attempt 1).
3. **Both fail → wrong-password error.** Never anonymous (see 3.3).

The old local pre-Firebase surname blocker is **demoted to the fallback-qualifier above** — not
removed. Firebase becomes the authority for attempt 1.

**Timeout budget:** the whole sequence stays inside `runNamedSignIn`'s existing 8s `withTimeout`.
Attempt 2 fires **only after a fast, definitive auth-server rejection** — never after a network
timeout — so the budget holds; a timeout mid-attempt-2 is already handled by the v14.75 contract
(no session saved, error shown, a late success benefits the next attempt).

### 3.3 Flag-independent credential rejection (critical review fix #2)
A **definitive credential rejection** (`auth/wrong-password` / `auth/invalid-credential`) must
resolve to identity `'none'` + a re-sign-in prompt **regardless of `ENFORCE_NAMED_SESSION`**. The
anonymous fallback (flag-off behaviour) keeps its original job — resilience to *network* failures —
and only that. Without this, the documented one-line rollback (flip the flag off) becomes a trap
once anyone has migrated: surname attempt fails → silent anonymous session → strict B3 rules
silently deny every write — exactly the v10.94 class. This is also the `ROADMAP.md` Stage-3
prerequisite ("catch wrong-password… surface a prompt rather than silently falling back"), fully
implemented rather than only on the fresh-login path.

### 3.4 The page-load re-establishment path (no typed password exists)
`ensureFirebaseSession` also runs on every page load for a returning member (valid localStorage
session, login screen skipped) — with **no password available**:
- **Common case:** Firebase's own IndexedDB session restores → the existing "reuse restored user"
  branch needs no password. Unchanged.
- **Firebase session evicted, member un-migrated:** the automatic surname attempt still works
  (no typed value to gate here — this is automated re-auth of an existing session, the same trust
  model as today, not an attacker at a keyboard).
- **Firebase session evicted, member migrated:** they **cannot be silently re-authenticated —
  ever.** The named session fails → the existing enforce plumbing re-shows the login overlay.
  **Honest UX cost, stated up front:** migrated members will occasionally be asked to sign in
  again where today nobody ever is. Inherent to real passwords, not a bug. (On paycalc — "soft"
  policy — a failed re-auth just means the roster pre-fill quietly doesn't load.)

### 3.5 Error codes + copy
With Firebase email-enumeration protection, failures arrive as `auth/invalid-credential`
(indistinguishable from "no account") — one message covers both, using the house wording rule
(account matters → "the admin"): **"Password incorrect — if you've forgotten it, ask the admin to
reset it."** `auth/too-many-requests` gets its own message ("Too many attempts — wait a few
minutes") and is never retried. The client 3-strikes-30s lockout stays, keyed off returned
failures instead of the local check. The login hint is **static** (a per-member hint would need a
Firestore read on the login path — forbidden): *"Your surname in lowercase — or the password
you've set yourself."*

### 3.6 Invariants preserved verbatim (LOGIN_INCIDENT.md)
The v14.75 contract: 8s `withTimeout`, **`saveSession` only after auth resolves**, visible
"Signing in…" disabled button. The `_attempting` mutex, `_signingIn` back-guard, and `_authGen`
stale-auth generation guard all survive unchanged. **No Firestore read (or any slow await) on the
login→reload critical path** — the must-set-password check runs fire-and-forget after login
(the `initEmailCheck` pattern, 4s cap).

---

## 4. Set-your-own-password

- **Settings card** ("Set / change your password"): current password → new password ×2 →
  `reauthenticateWithCredential` → `updatePassword`. `firebase-client.js` gains re-exports for
  `updatePassword`, `reauthenticateWithCredential`, `EmailAuthProvider` (none exist today).
- **Shared helper `credentialCandidatesFor(name, typed)`** — the §3.2 gate+padding logic written
  ONCE, used by both sign-in and the reauth step (an un-migrated "C. Reen" typing "reen" must
  reauth via the padded "reenre" exactly as sign-in does).
- **Validation:** minimum **8** chars (Firebase's floor is 6); **hard-block** a new password whose
  normalised form equals `normaliseSurname(name)` — otherwise "migrated ✓" is a lie for that
  member; confirm-twice field; trim leading/trailing whitespace on set AND sign-in (iOS keyboard
  spaces are a real lockout source); `autocomplete="current-password"` / `"new-password"` on the
  fields (free password-manager support).
- **Forced variant** (after a reset / Phase 2 compel): a mandatory overlay on the
  `admin-email-check.js` model — login-gated, no ✕, shown fire-and-forget after login, never
  blocks the app on network failure (retries next login). **Overlay precedence:** when both this
  and the email check are due on one login, **password wins**; the email check is suppressed for
  that session.
- On success the client writes `passwordStatus.passwordSetAt` (§6) — after `updatePassword`
  resolves, never before.

---

## 5. The admin reset (break-glass)

A new admin-only Cloud Function **`resetMemberPassword`**, mirroring `setupRosterAuth` exactly:

- Same shell: `onRequest({ region: 'europe-west2', cors: ADMIN_FUNCTION_ORIGINS })`, POST-only,
  then the identical guard — `admin.auth().verifyIdToken(bearer, true)` → `decoded.admin !== true`
  → 403. **Admin-only** — managers cannot reset (account administration is master-admin territory,
  matching the huddles/roster/auth precedent).
- Validate the target name against `roster-members.json` `activeMembers` (server-owned list — never
  trust a raw client name). Unprovisioned member → clear error ("run Set up accounts first").
- `email = nameToEmail(name)`, `password = nameToPassword(name)` — **reuse** the existing helpers
  (the `surname-parity` test guards the algorithm); `getUserByEmail` →
  `admin.auth().updateUser(uid, { password })` — the first password-write Admin SDK call in the
  codebase. `revokeRefreshTokens(uid)` behind an **optional `revoke` flag**: `true` for real
  resets (kick lost/stolen sessions), `false` for Phase 2 compels (don't sign a mid-shift member
  out of their devices just to nudge them).
- Server-stamps `passwordStatus.resetAt` (Admin SDK bypasses rules).
- **Verified — nothing else clobbers custom passwords:** `setupRosterAuth` sets a password only on
  `createUser` (first creation); `updateUser` is used solely for enable/disable. Re-running "Set
  up accounts" is already safe for migrated members. Add a guard comment + a functions test so a
  future edit can't silently regress this.

**Operations UI:** per-member "Reset password to surname" button (confirm dialog) inside the Staff
Login Accounts area. The card's error path must handle a not-yet-deployed function gracefully
("try again shortly" — see §9 deploy ordering).

---

## 6. Migration state — `passwordStatus/{memberName}`

Named to avoid collision with the client `auth-state.js` module. Doc ID = display name (matches the
`name` claim, same as `staffContact`).

| Field | Written by | Meaning |
|-------|-----------|---------|
| `resetAt` | **Admin SDK only** (reset function) | last forced back to surname |
| `passwordSetAt` | the member's client, after `updatePassword` resolves | last set their own |

- **Migrated = Y** ⇔ `passwordSetAt` exists AND is newer than any `resetAt`. Missing doc = N
  (covers new starters with zero provisioning changes). The two race directions converge correctly
  (whichever write lands last wins, and the password state matches the flag either way).
- **Rules** (mirror `staffContact`): read = owner or admin; member `create/update` may touch ONLY
  `passwordSetAt`, pinned `== request.time` (the `clientErrors` pattern — a wrong device clock
  can't fake ordering against the server-stamped `resetAt`), and must leave `resetAt` unchanged;
  `allow delete: if false`. `resetAt` is only ever written by the Admin SDK.
- **Honest limitation (accepted):** `passwordSetAt` is client-written, so a member could fake "Y"
  without really changing their password — leaving them on the surname default, i.e. **no worse
  than today**; a compliance gap, not a security escalation, and the admin can reset them anyway.
  Making it airtight would route the change through a Cloud Function for no real gain.

**Operations "Account status" table** (extends the Work Email Progress card's read-all pattern —
`getAllStaffContacts` + new `getAllPasswordStatus`, joined by name):
`Member · Grade · Email ✓/✗ · Password ✓ (date) / ✗ still surname`. This is both the rollout
dashboard and, later, **the ≥90% metric that gates C5** — measured from day one.

---

## 7. Phasing

| Phase | Contents | Notes |
|-------|----------|-------|
| **0 — enabler** | §3 sign-in rework (gated dual-attempt, flag-independent rejection, page-load path) | Ships **atomically with Phase 1** — alone it is risk without capability |
| **1 — capability + recovery + visibility** | Settings set-password card · `resetMemberPassword` + Operations reset button · `passwordStatus` + rules · **Operations Account status table** · Settings nudge banner | **This alone delivers the security win.** Migration voluntary |
| **2 — compel + measure** | Forced set-password overlay · staged compel (run reset with `revoke:false` on batches of **un-migrated** members — for them the password write is a credential no-op, only the flag flips) | Order: owner → managers → staff, driven from the Account status table |
| **3 — retire the surname (later, optional, C5)** | Stop seeding surname passwords for new starters; delete the surname fallback + padding | **Irreversible.** Gated on ≥90% migrated. Out of scope for this plan; the door is left open |

**Rollback story (be honest about the one-way door):** Phase 0+1 is a hosting-revertible commit
**only until the first member sets a custom password** — reverted code derives the surname and
would lock migrated members out. After that: forward-fix only, or admin-reset the migrated members
back to surname (the server-side reset function survives a hosting revert — a deliberate property
of putting reset on the server). Dogfood order (owner first) keeps this window safe. Additionally,
once anyone has migrated, the `ENFORCE_NAMED_SESSION` kill-switch must never be flipped casually —
§3.3 makes the credential-rejection path safe regardless, but the flag's rollback semantics are
narrowed and SECURITY_RELEASE_PLAN's deferred-residual section should be read alongside.

---

## 8. Testing

- **Unit:** `login-overlay.test.mjs` (typed-password param, no normalisation of attempt 1, gated
  fallback, error copy, contract intact) · `session.test.mjs` (dual-attempt, flag-independent
  rejection, page-load path) · new `credentialCandidatesFor` tests · functions test for the reset
  helper + the setupRosterAuth no-clobber guard.
- **Rules:** `firestore.rules.test.mjs` — `passwordStatus` suite (owner/admin read, member
  `passwordSetAt`-only + `request.time` pin, `resetAt` immutable to clients, no delete).
- **E2E:** `auth.spec.js` sign-in/reset/set flows — note the harness itself needs updating:
  `e2e/fixtures.js` (Firebase sign-in stub must accept the password param), `helpers.js`
  (`pickFirstMemberAndPassword`, `armEnforcementWithFailingSignIn`).
- **Manual, both platforms** (Android Chrome + iOS Safari standalone), on the **live URLs in a
  fresh private window — never an installed phone** (the referrer-allowlist class of silent
  failure). No new domains are introduced (`ADMIN_FUNCTION_ORIGINS` unchanged), but the rule
  stands.

---

## 9. Ship checklist (beyond code)

- **Deploy ordering:** one PR fires rules + functions + hosting; all changes are additive so any
  completion order is safe — the only seam is the Operations reset button briefly calling a
  not-yet-deployed function (handled by the card's calm error path).
- **Canonical-phrase sweep:** the fixed phrase **"password reset (not available yet)"** becomes
  false at Phase 1 — sweep Settings/login copy, CLAUDE.md (wording table + Authentication
  section), OPERATIONS_REFERENCE (email/password convention), KNOWN_LIMITATIONS (F-SEC-1), and
  tick/annotate the Track C boxes in SECURITY_RELEASE_PLAN.md.
- Version bump + docs per the standard rules; any new JS module lands in the SW lists +
  CLAUDE.md/AI_MAP (same-commit rule).
- Perf note: `loginTotal` in the App Speed card will show the dual-attempt cost for un-migrated
  short-surname members (always 2 attempts until they migrate) — expected, transitional.

---

## 10. Decisions record

| # | Decision | Status |
|---|----------|--------|
| 1 | Phase 1 = **nudge** (banner); force arrives in Phase 2 | ✅ Confirmed + shipped v18.63 |
| 2 | Password rules: **≥8 chars, surname hard-block, trim whitespace, confirm field** | ✅ Confirmed + shipped v18.63 |
| 3 | Revoke other devices: **yes on real resets, off for compels** (`revoke` flag) | ✅ Confirmed + shipped v18.63 |
| 4 | Reset button: **admin-only** (not managers) | ✅ Confirmed + shipped v18.63 |
| 5 | Go/no-go on building Phase 0+1 | ✅ Given — Phase 0+1 built v18.63 |

*Phase 0+1 shipped v18.63 (decisions 1–5 confirmed). Phase 2 (forced set-your-own overlay) remains a
future decision; C2 (email reset) + C5 (retire surname) are still open — see SECURITY_RELEASE_PLAN.md → Track C.*
