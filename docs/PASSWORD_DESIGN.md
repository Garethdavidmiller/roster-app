# PASSWORD_DESIGN.md — chosen passwords + admin reset (Track C-lite)

*Every phase in the status table below is shipped, so this is the design of what runs, not a plan for
what to build. Status lives in `SECURITY_RELEASE_PLAN.md`'s canonical track table; the forward-looking
credential work — recovery codes, step-up, passkeys, SSO — is `CREDENTIAL_LIFECYCLE.md`.*


## Current state

| Phase | What it is | State |
|---|---|---|
| **0 — enabler** | Sign-in rework: gated dual-attempt (`credentialCandidatesFor` → `ensureFirebaseSession`), credential rejection that never falls back, page-load re-establishment | ✅ v18.63 |
| **1 — capability + recovery + visibility** | Settings Password card + `savePasswordSetAt` · `resetMemberPassword` break-glass · `passwordStatus` collection + rules · Operations Account-status table · Settings nudge | ✅ v18.63 |
| **2 — compel** | Forced set-password overlay (`password-force.js`), kill-switched by `CONFIG.FORCE_PASSWORD_SET` | ✅ v18.92 |
| **Reset-request queue** | Login overlay "Can't get in?" → `requestPasswordReset` → admin queue (§12), + targeted admin push (§14) | ✅ v18.93 / v18.95 |
| **C2 — email verification/reset** | The email half, deferred from the start | ⏸ Needs an email relay |
| **C5 — retire the surname default** | Irreversible. ≥90% migrated | ⏸ Also gated on Track E |

> **Status of record is `SECURITY_RELEASE_PLAN.md` → the canonical track table.** This file owns the
> DESIGN and the implementation record; it must not restate a stage. The table above is a convenience
> index into the sections below, not a second source.

**Two things only this file knows, and both are load-bearing:**

- **Phase 2 compels at NEXT SIGN-IN and nobody is signed out to accelerate it** (owner, 25 Jul 2026 —
  "force everyone, but only on the next log in"). Sessions cap at 60 days, so coverage completes itself
  inside 60 days and staggers by each member's own expiry rather than landing on everyone at once.
- **C5 cannot converge on Phase 2 alone.** A member who only ever reads the roster signs in nowhere,
  so is never compelled — reaching them is Track E (or C6's second route, not adopted —
  `CREDENTIAL_LIFECYCLE.md` §7). Retiring the surname default is therefore gated on a decision in a
  different track, which is easy to miss when reading "≥90% migrated".

**Sections §1–§10 are the design as specified; §11 onward is the implementation record** — kept
because it has demonstrably prevented repeat bugs, but it is history, not work.

---

*The agreed design for replacing surname-derived passwords with **user-chosen passwords**, with the
**admin reset button as the recovery channel** — no email, no security questions. This is
SECURITY_RELEASE_PLAN.md → Track C with the email half deferred: it delivers **C4′** (admin reset as
the recovery path) **+ C3** (self-service change), defers **C2** (email verification), and leaves
**C5** (retire the surname — irreversible, ≥90% gate) exactly as planned. The two critical review fixes
(§3.2, §3.3) are load-bearing — do not change either without re-reading them. Not version-stamped; not
a runtime asset. **Read LOGIN_INCIDENT.md before touching any of this.***

---

## 1. Scope

**In:**
- Every member can set their **own** password (Settings card; forced flow after a reset).
- An admin can **reset any member back to their surname default** with one button on Operations,
  which flips that member to "must set a new password".
- A per-member **"password migrated Y/N"** status, shown on Operations as one **Account status** table
  (Email ✓/✗ · Password ✓/✗).

**Out (deferred, not cancelled):**
- Email verification (C2), self-service "forgot password" email links, security questions.
  **Recovery = the admin reset.** When an email relay arrives, email becomes an additional recovery
  channel bolted onto this machinery — nothing here is throwaway.

**Unchanged by this design:**
- The login screen shape (grade → name → password), the Firebase account model
  (`initial.surname@myb-roster.local`), the claim tiers (`admin`/`manager`/`name`/`linksDesigner`) and
  the 60-day session rule.
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

### 3.1 Before
Before this design the typed password was only a **local gate** (`login-overlay.js` — normalise,
compare to `getSurname(name)`, since removed); the real Firebase credential was **derived** from the name in
`ensureFirebaseSession` (`session.js` — `normaliseSurname` + pad-to-6). The typed value never reached
Firebase.

### 3.2 The GATED dual-attempt (critical review fix #1)
The typed password is the real credential. `ensureFirebaseSession(name, { password? })`:

1. **Attempt 1 — raw typed value** (trimmed of leading/trailing whitespace, otherwise
   UN-normalised — custom passwords have case/digits/symbols). This is the migrated member's path
   and the end state.
2. **Attempt 2 — the derived padded surname — ONLY IF
   `normalise(typed) === normaliseSurname(name)`.** This gate is load-bearing: an ungated fallback
   would sign an attacker typing *anything* into any un-migrated account (the surname attempt would
   succeed regardless of the typed value) — strictly worse than before. Gated, the fallback only
   covers what the local check allowed: caps ("Miller") and the <6-char padding cases
   ("bibi" → "bibibi"). It grants an attacker nothing the surname doesn't already grant.
   Micro-hardening: skip attempt 2 when the raw typed value already equals the derived padded value
   (it would be byte-identical to attempt 1).
3. **Both fail → wrong-password error.** Never anonymous (see 3.3).

The old local pre-Firebase surname blocker is **demoted to the fallback-qualifier above** — not
removed. Firebase is the authority for attempt 1.

**Timeout budget:** the whole sequence stays inside `runNamedSignIn`'s 8s `withTimeout`.
Attempt 2 fires **only after a fast, definitive auth-server rejection** — never after a network
timeout — so the budget holds; a timeout mid-attempt-2 is already handled by the login contract
(no session saved, error shown, a late success benefits the next attempt).

### 3.3 A credential rejection never falls back (critical review fix #2)
A **definitive credential rejection** (`auth/wrong-password` / `auth/invalid-credential`) resolves to
identity `'none'` + a re-sign-in prompt. When this was designed an anonymous fallback still existed for
*network* failures, and the rule was that it must never catch a credential rejection: surname attempt
fails → silent anonymous session → strict B3 rules silently deny every write — exactly the v10.94
class. **The anonymous fallback has since been retired altogether**, because the rules refused the
anonymous session on every path, so every failure, credential or not, now resolves to `'none'`.
Rollback is reverting a release. This is also the `ROADMAP_HISTORY.md` Stage-3 prerequisite ("catch
wrong-password… surface a prompt rather than silently falling back"), implemented on every path.

### 3.4 The page-load re-establishment path (no typed password exists)
`ensureFirebaseSession` also runs on every page load for a returning member (valid localStorage
session, login screen skipped) — with **no password available**:
- **Common case:** Firebase's own IndexedDB session restores → the "reuse restored user" branch needs
  no password.
- **Firebase session evicted, member un-migrated:** the automatic surname attempt still works
  (no typed value to gate here — this is automated re-auth of an existing session, not an attacker at a
  keyboard) — **except in three cases** (AUTH_AND_SESSIONS.md invariant 23): it is REFUSED when this
  device's session began before the admin's last reset of the account (`resetAt`), HELD when that time
  cannot be confirmed, and SKIPPED after a definitive rejection on this device. Without the first, a
  reset's sign-out of other devices (§5 — every reset revokes) would be undone by the very next load.
- **Firebase session evicted, member migrated:** they **cannot be silently re-authenticated —
  ever.** The named session fails → the login overlay is shown again. **Honest UX cost:** migrated
  members are occasionally asked to sign in again. Inherent to real passwords, not a bug. (On paycalc —
  "soft" policy — a failed re-auth just means the roster pre-fill quietly doesn't load.)

### 3.5 Error codes + copy
With Firebase email-enumeration protection, failures arrive as `auth/invalid-credential`
(indistinguishable from "no account") — one message covers both, using the house wording rule
(account matters → "the admin"): **"Password not recognised — if you've forgotten it, or your
account isn't set up yet, ask the admin."** The remedy for a never-provisioned account is set-up, not a
reset, so the wording promises neither; `login-overlay.js` is the source of truth. `auth/too-many-requests`
gets its own message ("Too many attempts — please wait a few minutes and try again.") and is never
retried. The client 3-strikes-30s lockout is keyed off returned failures. The login hint is **static**
(a per-member hint would need a Firestore read on the login path — forbidden): *"Your surname in
lowercase — or the password you've set yourself."*

### 3.6 Invariants preserved verbatim (LOGIN_INCIDENT.md)
The login contract: 8s `withTimeout`, **`saveSession` only after auth resolves**, visible "Signing in…"
disabled button. The `_attempting` mutex, `_signingIn` back-guard, and `_authGen` stale-auth generation
guard all survive unchanged. **No Firestore read (or any slow await) on the login→reload critical
path** — the must-set-password check runs fire-and-forget after login, with a short cap, which is the
pattern `password-force.js` follows.

---

## 4. Set-your-own-password

- **Settings card** ("Set / change your password"): current password → new password ×2 →
  reauthenticate → `updatePassword` — through `reauthenticateWithPassword` and `changeOwnPassword` in
  `firebase-client.js`, which re-exports `updatePassword`, `reauthenticateWithCredential` and
  `EmailAuthProvider` from the SDK.
- **Shared helper `credentialCandidatesFor(name, typed)`** — the §3.2 gate+padding logic written
  ONCE, used by both sign-in and the reauth step (an un-migrated "C. Reen" typing "reen" must
  reauth via the padded "reenre" exactly as sign-in does).
- **Validation (`validateNewPassword`, `auth-identity.js`):** minimum **8** chars (`MIN_PASSWORD_LENGTH`;
  Firebase's floor is 6); **hard-block** a new password whose normalised form equals
  `normaliseSurname(name)` — otherwise "migrated ✓" is a lie for that member; confirm-twice field; trim
  leading/trailing whitespace on set AND sign-in (iOS keyboard spaces are a real lockout source);
  `autocomplete="current-password"` / `"new-password"` on the fields (free password-manager support).
- **Forced variant** (after a reset / the Phase 2 compel): the mandatory overlay in `password-force.js`
  — login-gated, no ✕, shown fire-and-forget after login, never blocks the app on network failure
  (retries next login). It is the only post-login overlay.
- On success the client writes `passwordStatus.passwordSetAt` (§6) — after `updatePassword`
  resolves, never before.

---

## 5. The admin reset (break-glass)

> **⚠️ INTERIM. Superseded in design by C6 — one-time recovery codes (`CREDENTIAL_LIFECYCLE.md` §1),
> which is proposed and not started.** What is described below is live and stays live until C6
> ships, because break-glass may not have a gap. But the mechanism has a flaw worth naming where a
> reader meets it: **it makes the surname a valid credential again**, so the repair mechanism for
> the migration re-creates the exact condition the migration exists to remove — at the moment the
> account is least attended. C6 replaces the surname with a random, single-use, 24-hour, hashed
> code, and the admin never learns a working credential at all.

The admin-only Cloud Function **`resetMemberPassword`** (`functions/auth-endpoints.js`) mirrors
`setupRosterAuth`:

- Same shell: `onRequest({ region: 'europe-west2', cors: ADMIN_FUNCTION_ORIGINS })`, POST-only,
  then the identical guard — `getAuth().verifyIdToken(bearer, true)` → `decoded.admin !== true`
  → 403. **Admin-only** — managers cannot reset (account administration is master-admin territory,
  matching the huddles/roster/auth precedent).
- Validates the target name against `roster-members.json` `activeMembers` (server-owned list — never
  trust a raw client name). Unprovisioned member → clear error ("run Set up accounts first").
- `email = nameToEmail(name)`, `password = nameToPassword(name)` — **reusing** the existing helpers
  (the `surname-parity` test guards the algorithm); `getUserByEmail`, then:
- Server-stamps `passwordStatus.resetAt` FIRST (Admin SDK bypasses rules). A stamp that cannot be
  written stops the reset — 503, nothing changed — because a stamp written after the password would let
  a lost device sign itself straight back in (AUTH_AND_SESSIONS.md 23).
- `getAuth().updateUser(uid, { password })`, then `revokeRefreshTokens(uid)` on every reset
  (`revoke: false` was retired on 10 Nov 2026: nothing sent it). It tells the member on their own
  devices — never naming the new password (`.claude/rules/notifications.md` → `password-reset`).
- **Nothing else clobbers custom passwords:** `setupRosterAuth` sets a password on `createUser` (first
  creation), and otherwise uses `updateUser` for enable/disable — with two exceptions. An existing
  account at a roster email carrying NO custom claims (one the server never stamped, so registered from
  outside) is TAKEN BACK — `resetAt` stamped first, then its password reset to the surname default, its
  display name to the roster's, `disabled: false` and its refresh tokens revoked (reported as "Reset to
  the default password and signed out"). And a DISABLED account (a leaver's) is reset the same way
  before it is re-enabled, so a returning name never inherits the old password. A member's own
  provisioned account always carries claims, so re-running "Set up accounts" is safe for migrated
  members. The guard is `mustReclaim` (`functions/member-identity.js`), tested in
  `auth-endpoints.test.mjs`.

**Operations UI:** a per-member Reset button (confirm dialog) in the Account status card. A refusal
is shown in a dialog in the server's own words; a reply that is not one — an HTML error page, from a
function not yet deployed, say — reads "The server answered <status> without a reason this page can
show. Nothing was reset."

---

## 6. Migration state — `passwordStatus/{memberName}`

Named to avoid collision with the client `auth-state.js` module. Doc ID = display name (matches the
`name` claim, same as `staffContact`).

| Field | Written by | Meaning |
|-------|-----------|---------|
| `resetAt` | **Admin SDK only** (reset function, and the take-back and the re-enable in Set up accounts) | last forced back to surname |
| `passwordSetAt` | the member's client, after `updatePassword` resolves | last set their own |

- **Migrated = Y** ⇔ `passwordSetAt` exists AND is newer than any `resetAt` (`isPasswordMigrated` in
  `auth-identity.js`). Missing doc = N (covers new starters with zero provisioning changes). The two
  race directions converge correctly (whichever write lands last wins, and the password state matches
  the flag either way).
- **Rules** (mirror `staffContact`): read = owner or admin; member `create/update` may touch ONLY
  `passwordSetAt`, pinned `== request.time` (the `clientErrors` pattern — a wrong device clock
  can't fake ordering against the server-stamped `resetAt`), and must leave `resetAt` unchanged;
  `allow delete: if false`. `resetAt` is only ever written by the Admin SDK.
- **Honest limitation (accepted):** `passwordSetAt` is client-written, so a member could fake "Y"
  without really changing their password — leaving them on the surname default, i.e. **no worse
  than before**; a compliance gap, not a security escalation, and the admin can reset them anyway.
  Making it airtight would route the change through a Cloud Function for no real gain.

**The Operations "Account status" table** joins `getAllStaffContacts` and `getAllPasswordStatus` by name:
`Member · Grade · Email ✓/✗ · Password ✓ (date) / ✗ still surname`. It is both the rollout dashboard
and **the ≥90% metric that gates C5**.

---

## 7. Phasing

| Phase | Contents | Notes |
|-------|----------|-------|
| **0 — enabler** | §3 sign-in rework (gated dual-attempt, credential rejection, page-load path) | Shipped **atomically with Phase 1** — alone it is risk without capability |
| **1 — capability + recovery + visibility** | Settings set-password card · `resetMemberPassword` + Operations reset button · `passwordStatus` + rules · **Operations Account status table** · Settings nudge banner | **This alone delivers the security win.** Migration voluntary |
| **2 — compel + measure** | Forced set-password overlay, gated on `!isPasswordMigrated(status)` | ✅ **SHIPPED v18.92** as `password-force.js` in every page coordinator, kill-switched by `CONFIG.FORCE_PASSWORD_SET`. Applied to EVERYONE at once rather than owner → managers → staff (owner, 25 Jul 2026): the session model staggers it anyway |
| **3 — retire the surname (later, optional, C5)** | Stop seeding surname passwords for new starters; delete the surname fallback + padding | **Irreversible.** Gated on ≥90% migrated. Out of scope for this plan; the door is left open |

> **A reset does not compel — the forced overlay is the entire mechanism.** Running
> `resetMemberPassword` with `revoke:false` over un-migrated members was once proposed as a "staged
> compel", and it does nothing: for an un-migrated member the call rewrites the password to the
> surname it already is, stamps `resetAt`, and signs nobody out — and migrated status
> (`passwordSetAt > 0 && passwordSetAt >= resetAt`) is false before and after. So the overlay gates on
> `!isPasswordMigrated` (the shared tested helper), never on `resetAt` being present, and a reset keeps
> its real purpose — genuine break-glass, where signing the member out is the point. (`revoke: false`
> itself was retired on 10 Nov 2026, so every reset now signs the member out.)

**Rollback (the one-way door):** Phase 0+1 was hosting-revertible **only until the first member set a
custom password** — reverted code derives the surname and would lock migrated members out. Members
have migrated, so it is forward-fix only now; the fallback is to admin-reset the migrated members back
to surname (the server-side reset function survives a hosting revert — a deliberate property of
putting reset on the server).

---

## 8. Testing

- **Unit:** `login-overlay.test.mjs` (typed-password param, no normalisation of attempt 1, gated
  fallback, error copy, contract intact) · `session.test.mjs` (dual-attempt, credential rejection,
  page-load path) · `auth-identity.test.mjs` (`credentialCandidatesFor`, `isPasswordMigrated`,
  `validateNewPassword`) · `auth-endpoints.test.mjs` (the reset and the setupRosterAuth take-back).
- **Rules:** `firestore.rules.test.mjs` — `passwordStatus` suite (owner/admin read, member
  `passwordSetAt`-only + `request.time` pin, `resetAt` immutable to clients, no delete).
- **E2E:** `e2e/auth.spec.js` sign-in/reset/set flows. The Firebase stub accepts the password param;
  `forcePasswordSet(page)` opts a test into the forced overlay (the suite defaults it OFF — §11).
- **Manual, both platforms** (Android Chrome + iOS Safari standalone), on the **live URLs in a
  fresh private window — never an installed phone** (the referrer-allowlist class of silent
  failure).

---

## 9. Reading the App Speed card

`loginTotal` on the App Speed card includes the dual-attempt cost for un-migrated short-surname
members (always 2 attempts until they migrate) — expected, and transitional.

---

## 10. Decisions record

| # | Decision | Status |
|---|----------|--------|
| 1 | Phase 1 = **nudge** (banner); force arrives in Phase 2 | ✅ Confirmed + shipped v18.63 |
| 2 | Password rules: **≥8 chars, surname hard-block, trim whitespace, confirm field** | ✅ Confirmed + shipped v18.63 |
| 3 | Revoke other devices: **yes on every reset** (the `revoke` flag was retired 10 Nov 2026) | ✅ Confirmed + shipped v18.63 |
| 4 | Reset button: **admin-only** (not managers) | ✅ Confirmed + shipped v18.63 |
| 5 | Go/no-go on building Phase 0+1 | ✅ Given — Phase 0+1 built v18.63 |
| 6 | Phase 2 compels **everyone, at their next sign-in**, with no forced sign-out (owner, 25 Jul 2026) | ✅ Shipped v18.92 — §11 |

*C2 (email reset) and C5 (retire the surname) remain open; status lives in SECURITY_RELEASE_PLAN.md →
the canonical track table.*

---

## Passkeys — POSSIBLE, not planned (recorded 10 Aug 2026)

> The survey, the domain-binding blocker and the four options are below and are authoritative.
> **The ORDER they sit in relative to everything else** — migration, then one canonical origin,
> then a spike, then additive passkeys alongside passwords — is `CREDENTIAL_LIFECYCLE.md` §9, which
> is the file that holds sequencing. Nothing here is restated there.

*Owner-raised: "give me the options for making the app compatible with passkeys." Recorded here with
its costs and its one hard blocker attached — **as a possibility, not as scheduled work**, and not given
a C-number: the track list is C1–C6 and the canonical table in `SECURITY_RELEASE_PLAN.md` owns it. If
this is ever committed to, it is the successor to C5, not a track of its own.*

**Why this file and not `AUTH_PLAN.md`.** Track E asks *what sits behind authentication* — the
boundary ladder E0–E6, the calendar read, the document files. A passkey changes none of that; it
changes **what a member presents at the door**, which is exactly this file's subject: the surname
default, the self-set password, the admin reset, and C5's plan to retire the default. Passkeys are
the natural successor to C5. `AUTH_PLAN.md` §7/§8 carry a pointer here, because passkeys turn one of
its open owner decisions from cosmetic into binding — see the blocker below.

### What a passkey is, in one paragraph

WebAuthn replaces "something you know" with a key pair. The private key is generated and held by the
phone's secure hardware (or iCloud Keychain / Google Password Manager), never leaves it, and is
released by fingerprint or face. The server keeps only the **public** key. Signing in means the
server sends a random challenge, the phone signs it, the server verifies the signature. There is no
shared secret — nothing to phish, nothing to reuse across sites, and nothing worth stealing in our
database.

### ⚠️ THE BLOCKER: a passkey is bound to ONE domain, and this app is served from two

WebAuthn's RP ID must be a registrable-domain suffix of the origin. **Both `web.app` and `github.io`
are on the Public Suffix List**, so the RP ID can only be the full hostname, and
`myb-roster.web.app` and `garethdavidmiller.github.io` share no parent. A passkey registered on one
**can never be used on the other**. There is no workaround, no cross-origin trick, no shared list.

So passkeys make the GitHub Pages mirror a decision rather than an inheritance: either retire it
first, or accept that passkeys reach only the members on `web.app` while the mirror stays
password-only for ever. `analytics/origins` is the existing instrument for that call — it was built to
answer exactly this question, and the Operations Usage card reads it ("Which address staff are on").

### The four options

| | Approach | Effort | What it buys |
|---|---|---|---|
| **A** | Firebase Auth native passkeys | unknown — **verify first** | Understood to be NOT GA for Firebase Auth (as opposed to raw Identity Platform), and every working implementation known to this project uses B. **Ten minutes against current docs before anything else** — if it has landed, the effort drops by an order of magnitude and B is wasted work. |
| **B** | **WebAuthn + custom token** | ≈ the Calendar PIN project | The real thing. The option this section is about. |
| **C** | Passkey as a re-auth shortcut only | ≈ half of B | Skips the password at the 60-day expiry, keeps everything else as-is. Most of B's work for a fraction of its benefit. |
| **D** | Do nothing — rely on browser password autofill | zero | Members set their own password, and both platforms already offer to save and autofill it. **This is the honest baseline B must beat**, and it should be stated whenever B is costed. |

### Option B — why it is cheaper here than it usually is

Two things this app already has:

1. **Custom-token minting is proven in production.** `unlockCalendarViewer` does `createCustomToken`
   → `signInWithCustomToken`, and its rollout established the standing IAM prerequisite
   (`iam.serviceAccountTokenCreator` on the runtime service account, on itself) — **already granted**.
   A passkey sign-in is the same shape: verify the assertion, then mint. The unglamorous half of this
   work is done and has been debugged the hard way.
2. **No new browser dependency.** `navigator.credentials` is native; the client needs ~20 lines of
   base64url helpers and two fetches. Verification (`@simplewebauthn/server` or equivalent) lives in
   `functions/`, which is CommonJS Node — it never touches the no-bundler rule. That constraint is
   usually what kills passkeys in a build-free app, and here it does not apply.

**Custom claims survive, and this is the thing that would otherwise break silently.** An ID token
obtained via `signInWithCustomToken` carries the user record's `setCustomUserClaims` values as well
as any developer claims passed in the token — so `name` / `member` / `admin` / `manager` /
`linksDesigner` survive. **But every member rule would still fail it:** `isMember()` in
`firestore.rules` and `memberNameFromClaims` in `functions/member-identity.js` believe a `name` only
on `sign_in_provider == 'password'`, and a custom-token session reports `custom`. So a passkey sign-in
as designed permission-denies every member read and write — as would any SSO route
(`CREDENTIAL_LIFECYCLE.md` §10). The fix is a binding of equal strength for the new provider, never
dropping the provider check, which is what stops an anonymous or PIN session being believed. A
sign-in that works while every write permission-denies is the PIN rollout's failure shape again.

**What it costs:** two Cloud Function endpoints (begin/finish, registration and assertion), a client
module, a Settings card ("Add this phone"), a branch in `login-overlay.js`, a new `passkeys`
collection with client read **and** write denied outright (Admin SDK only) plus rules tests, and
server-side single-use, short-lived challenges.

**The UX win worth having** is discoverable credentials (`residentKey: 'required'`) plus conditional
UI (`mediation: 'conditional'`, with `autocomplete="username webauthn"` on the field): the member
taps Sign in and the OS offers their face — the grade and name dropdowns never appear. That is
meaningfully better than a saved password, and it is the only reason to prefer B over D.

### Constraints to settle before starting, not during

- **Never the only factor.** A lost phone is a lockout. The password path and the admin reset stay.
  Passkeys are additive until there is a second recovery route (C2, the email reset).
- **Not for the shared station PC.** A platform authenticator there binds to whichever Windows
  profile is signed in. That machine keeps the staff PIN and the password — which is what the PIN
  was built for.
- **iOS standalone PWA needs a real-device check.** WebAuthn works on iOS 16+, but standalone-mode
  behaviour has had quirks. That is a spike on a real handset, not an assumption.
- **`user.id` must be the Firebase uid, never the member name.** It is a permanent opaque handle and
  names change; the display name belongs in `user.name`/`displayName`, which is what the OS prompt
  shows.
- **The fake `@myb-roster.local` domain is not an obstacle** — passkeys need no deliverable address.
- **Prove the success path by hand in production.** The PIN rollout's lesson stated once more, because
  this feature has the same shape: a registration endpoint returning 200 proves nothing until a real
  finger has signed in with the credential it stored.

### Recommended ordering

Do **A** (the ten-minute check) first. Then settle the mirror, because until that is decided the
question "who can even use this?" has no answer. **C5 is the higher-value item, and passkeys do
not block it** — it stays gated as the canonical table in SECURITY_RELEASE_PLAN.md says (on Track E).
Passkeys do not replace it, though they make its endgame considerably more attractive.

---

# ── HISTORICAL IMPLEMENTATION RECORD ────────────────────────────────────────────

*What was BUILT and what successive reviews found, condensed to what still governs the code. Nothing
below is outstanding work, and it should not compete for attention with the two open items (C2, C5)
named at the top of this file.*

## 11. Phase 2 as built (v18.92)

**Scope: every page where a member signs in**, the Calendar included (it runs the overlay after a
`named` grant). An admin-only first draft would have missed a member who signs in on the pay
calculator and never opens Admin.

**No wave selector.** `CONFIG.FORCE_PASSWORD_SET` is a plain kill switch, not a tier control, because
the 60-day session model already staggers the rollout by each member's own expiry.

**Reach, stated honestly.** This compels anyone who signs in. It does NOT reach a member who only ever
views the roster with the staff PIN: they have no session to expire and no sign-in to intercept, and
`passwordStatus` is owner-or-admin read, so the Calendar cannot even tell whether the selected member
has migrated. Closing it means Track E (or C6's second route).

**What the review changed, each closing a real failure** — the reasoning is in `password-force.js`'s
header:

1. **The gate keys on `authStatus === 'named'`, not "an auth user exists."** `updatePassword` cannot
   succeed for any other identity, so the weaker test shows a hard block nobody can satisfy.
2. **It fails open AFTER showing, not only before.** A quiet "Continue for now" appears on any failure
   the member cannot type their way out of, and after three failures of any kind. It stamps nothing,
   so the member is compelled again next sign-in.
3. **The e2e harness defaults the flag OFF.** The hermetic Firebase stub reads every member as
   un-migrated, so leaving it on would put the overlay over every sign-in test; `forcePasswordSet(page)`
   opts in. Playwright runs only the most-recent matching route handler, so the flag helpers share ONE
   `roster-data.js` route — two separate routes would silently apply only one.
4. **The login marker is consumed even when the overlay is not shown**, so it can never resurface on
   a later ordinary page load (the v14.77 "Fix 4" ambush).

**Two defects the rendered overlay caught that code review did not**, and the reason the assertions
check visibility rather than text content: `.pwf-escape { display: block }` silently beat the `hidden`
attribute, so the escape hatch showed from the moment the overlay opened; and `.login-error` stays
`display: none` until a `.visible` class is added, so setting `textContent` alone left every error
invisible.

**Not verified here (no live Firebase in this environment):** whether a client-side password change
signs that member's other devices out. The copy is written to be correct either way — "you'll need it
the next time you sign in on any device" — so confirm it before writing anything more specific.

---

## 12. The reset-request queue (v18.93) — Phase 1

§1 put recovery entirely out-of-band: "tell the admin → admin resets". Compulsory migration raises the
volume of exactly those conversations, and the admin had **no way to know a request existed** until
someone messaged them. This closes that, and only that.

**Scope deliberately small.** A member taps a link, the admin sees a queue. There is no email, no code
and no self-service reset. The admin notification is the queue's own phase 2 (§14 — not to be confused
with the *plan's* Phase 2 in §11).

**Why it is a Cloud Function.** A member on a protected page's login overlay has NO Firebase identity —
the person who needs this feature is precisely the person who cannot write to Firestore. The
alternatives were to establish a new anonymous session on the protected pages (an explicit anti-goal,
and new auth behaviour next to the login path — this app's worst outage area) or to open a
client-writable collection. The endpoint beats both: `resetRequests` denies every client write, and
all validation is server-side.

**It never resets a password, by design.** An unauthenticated caller who could force any member back to
the surname default would undo the migration and, with token revocation, boot them off their devices —
a downgrade-plus-nuisance attack available to anyone with the URL. The admin performs the reset. The
human in the loop authenticates the reset *action*; this is a doorbell, not a recovery mechanism.

**Bounding a public unauthenticated endpoint** — the one new exposure this creates:

| Control | Why |
|---------|-----|
| **Doc ID = member name** | The collection can never exceed the roster. Flooding is impossible BY CONSTRUCTION, not by rate limiting — worst case is one stale row per member. |
| Name ∈ server-owned `activeMembers` | Rejects junk, AND makes the name safe for the admin card to render (it came from our list, never the request body). |
| **No free text stored** | An unauthenticated endpoint writing caller-controlled strings into an admin UI is an injection surface for no benefit. |
| `shouldRecordResetRequest` throttle | Repeat taps must not inflate the `count` the admin reads, nor generate repeat notifications. Pure + unit-tested; fails OPEN on a junk timestamp (never block someone from asking). |
| `maxInstances: 3` | Caps the cost of a flood (`unlockCalendarViewer` is the only other function that sets one). App Check (Track D) is the eventual real control. |
| No enumeration | Same answer for any roster name whether provisioned or not — and the roster is already public in the login dropdown, so nothing new is revealed. |

**`provisioned` earns its place.** The login overlay deliberately cannot distinguish "forgotten password"
from "never set up" (that would leak which names are provisioned). The admin's card has no such
constraint, so the function records whether a Firebase account exists — the difference between **Reset**
and **run Set up accounts**, which otherwise costs a wasted round trip to discover.

**Where the link appears: always, below the Sign in button.** It was first revealed only after two
credential failures — don't offer a reset to someone who merely mistyped — which got the user wrong:
the member who KNOWS they have forgotten had to fail twice on purpose to be given the mechanism. Filing
a request RESETS NOTHING, so a spurious one costs a row the admin clears, while a missing one costs a
member their access. The reasoning sits beside the button in `login-overlay.js`.

**Still true after this:** a member who never signs in anywhere is unreachable. Email self-service (C2)
remains blocked on a relay — Firebase's own `sendPasswordResetEmail` cannot substitute, because the
accounts are synthetic `initial.surname@myb-roster.local` addresses that receive no mail.

---

## 13. What the review of the queue found (and what it did not fix)

The things that are **accepted, not fixed**, and the reasons:

### The one that matters most: a request proves nothing about who sent it

Nothing ties a reset request to the person named in it. A reviewer filed valid requests for every member
in well under a second from Node, with no browser, no Origin header and no JavaScript — a plain
auto-submitting `<form>` on any site would do it from every visitor's browser. Acting on one puts a
member who had chosen their own password **back on the guessable surname default and revokes their
tokens** — the downgrade attack §12 forecloses, reached through the admin as a proxy.

**Mitigated, not solved.** The card says plainly that requests aren't verified and to confirm with the
member before resetting, and the Tips panel repeats it with the consequence spelled out. That is a human
control. The real fixes, in ascending cost: **App Check** (Track D — the right answer), or a short-lived
server-issued token the login overlay can only obtain after a genuine credential failure. Until one
lands, **treat the queue as a notification, never as evidence** — and a request is not proof of
urgency: the admin decides.

`count` is attacker-owned for the same reason, so "asked 3 times" is not evidence either.

### `CONFIG.PASSWORD_RESET_REQUESTS` does not reach the endpoint

It hides the login link. The public endpoint stays live — **do not reach for the flag in an incident
expecting it to close the door**. The endpoint's own switch is `RESET_REQUESTS_ENABLED` in
`functions/auth-endpoints.js` (§16).

### `maxInstances: 3` bounds cost, not rate — and is itself a lever

With no `concurrency` override the platform default (~80/instance) applies, so ~240 requests can be in
flight: the cap does not throttle request rate. It genuinely bounds spend, but an unauthenticated
caller can saturate all three instances and have Cloud Run 429 real requests — taking the only in-app
recovery route offline. Accepted trade; recorded here so it is not discovered during an incident.

### CORS is not a boundary on this endpoint

`cors: ADMIN_FUNCTION_ORIGINS` sets response headers and calls `next()` regardless of the request's
Origin, and a non-browser caller sends none. On the authenticated functions CORS is "defence-in-depth
on top of the real control" — here there is no other control, so the allowlist reads far more
protective than it is. The name is also misleading on a deliberately public endpoint.

### Smaller accepted items

- **A stale `provisioned: false`** can persist up to the 10-minute throttle window after the admin runs
  Set up accounts, because a throttled repeat doesn't rewrite the flag.
- **The compel marker is consumed before the identity is known**, so a member whose session barrier
  doesn't settle in time loses that compel cycle. Fixing it means restoring the marker, which re-creates
  the Fix-4 ambush — the worse of the two. Coverage completes anyway.
- **The modulepreload guard only walks STATIC imports**, so a dynamic-only import would be invisible to
  it. Not live (every dynamically-imported module here is also statically imported elsewhere), but the
  guard is weaker than it looks.

---

## 14. The reset-request queue, phase 2 — the admin notification (v18.95)

> **Two different "phase 2"s live in this document.** §11 is *the plan's* Phase 2 (the forced-set
> overlay). This is *the request queue's* phase 2 — a separate, much smaller phasing internal to §12.

A genuinely-recorded request pushes a notice to the admin's phone, so the admin no longer has to *look*
at Operations to discover it.

**It is not a broadcast, and the whole design follows from that.** "N. Surname asked for a password
reset" sent to every subscribed device is a leak — it tells the whole team who is locked out. So the
send goes through **`sendTargetedPush`**, never `fanOutPush` (`.claude/rules/notifications.md`).

**Fails closed in three places**, because every failure mode here has the same consequence:

| Situation | Behaviour | Why not the alternative |
|-----------|-----------|-------------------------|
| No target uids resolved | Send nothing | There is deliberately **no "no targets → fall back to everyone"** branch. That fallback is the bug the function is shaped to make unwritable. |
| A subscription doc has no `owner` | Skip it | Those are legacy docs from before the uid was stamped. Guessing an identity from an unowned record is exactly the mistake that leaks. |
| No owner-stamped matches | Log, return | A notification that cannot be delivered privately is not delivered. |

**The push can never fail the request.** It is wrapped, swallowed and time-boxed. The row in Firestore is
the doorbell; the push is a courtesy. A push outage that became an error would lose the request itself
and send a locked-out member away thinking nobody heard them.

**Only on a RECORDED request, never a throttled repeat**, and coalesced to one push per 5-minute window
(`shouldNotifyAdmin`) — otherwise anyone with the URL could ring the admin's phone at will, or walk the
public roster for one push per name.

**Why the queue depth is in the headline.** One stable `tag` per feature means request #2 *replaces*
request #1 on the lock screen, so the headline states the current total (`Reset requests — 2 waiting`)
and the body names whoever just asked. The newest notification is always an accurate summary of the
whole queue, and it counts the same rows as the card's chip. Wording is the pure, tested
`buildResetRequestNotice`.

**Deep link.** `operations.html#reset-requests` — in the SW's `SAFE_NOTIFICATION_PAGES` (listing a page
there is not an access grant; the page keeps its own admin gate). `DEEP_LINK_CARDS` in
`operations-app.js` opens and scrolls to the card, because Operations is a page of collapsed cards. It
only ever *opens* — a repeat tap must not toggle shut the card it sent them to.

**§13 is unchanged by this.** A notification makes the admin aware of a request faster; it does nothing
to establish that the request is genuine.

---

## 15. What the second review round found (v18.95)

Five defects, four introduced by a polish pass, and three invisible to every existing gate. The rules
they left:

- **A page stylesheet must never reach into the shared login overlay.** A Settings-only rule on
  `.login-pw-wrap` — also the class `login-overlay.js` injects on every page — grew one page's sign-in
  card; it is scoped now, and `e2e/auth.spec.js` measures the login card's geometry on every page and
  requires them equal.
- **Every network wait inside a request handler is time-boxed**, because a try/catch survives only a
  rejection and a promise that never settles is not one. The queue's notify path is raced against its
  own budget inside the request's.
- **The Settings Password card shares the overlay's timeout helpers** (`withTimeout` /
  `settleOrTimeout`, exported from `password-force.js`), so there is one implementation.
- **A revealed password is re-masked after a successful save**, so the next password typed on a shared
  device does not appear in the clear.
- **The notification headline names the queue, not "password reset"**, because a collapsed notification
  shows only the title, and "Password reset — 1 waiting" on your own lock screen reads as something
  about *your* password.

The same round found three committed visual baselines that had drifted under the tolerance while
passing; the current baseline procedure is CLAUDE.md → `test:visual`.

---

## 16. What the external review found (v18.97)

**A timed-out password write is INDETERMINATE, not failed.** `Promise.race` stops waiting; it does not
cancel. So `updatePassword` could land a second after the UI had said "Couldn't connect", leaving the
member believing their old password still worked — during a COMPULSORY migration, which makes it a route
into the exact lockout the timeout was added to prevent.

`settleOrTimeout` reports three outcomes — `ok` / `failed` / `pending` — and hands back a handle on the
original work. On `pending` both surfaces:
- say plainly that the result could not be confirmed, and to **keep the new password and try it
  first** (the safe instruction under either outcome);
- keep the Save button **disabled**, because a second write racing a first that may still land is the
  worst version of this bug — the retry re-authenticates with a password the late write may already
  have replaced;
- keep watching: a late success finishes the flow normally, a late failure re-enables retry with the
  real error;
- still offer "Continue for now", so a compulsory overlay never holds someone on an outcome nobody
  can resolve.

`withTimeout` is kept for calls that change nothing (reads, the idempotent re-auth). **The rule: a
state-changing call may never use a timeout that reports failure.** The browser tests that pin it drive
the overlay through a deadline, a late success and a late failure (`__E2E.hangPasswordWrite`).

**Sign-in statistics count only accounts on the roster.** `summariseSignIns` takes an ALLOWLIST built
from the server-owned roster and fails closed — an empty allowlist counts nothing, because a
visibly-wrong zero beats a plausible number drawn from an unknown population. An enabled account for a
leaver (the orphan sweep is a manual admin action) used to inflate a card headed "exact".

**Two quick Clears must not leave a ghost row.** Refreshes of the queue card are QUEUED, not dropped: a
dropped refresh let an older snapshot repaint a row that had just been cleared, with nothing queued to
correct it.

**The kill switch reaches the endpoint.** `CONFIG.PASSWORD_RESET_REQUESTS` hides the client link; the
public function stayed callable until `RESET_REQUESTS_ENABLED` in `functions/auth-endpoints.js` closed
it with a 503. Deliberately a constant, not a Firestore flag: an incident switch must not depend on a
read the incident might be affecting.

### Still accepted, unchanged

§13 stands in full. A request still proves nothing about who sent it; coalescing bounds the *noise* of
a forged burst, not the forgery. App Check (Track D — deferred and sequenced, not closed;
SECURITY_RELEASE_PLAN.md is authoritative) remains the real control. INDIVIDUAL authentication is Track
E and undecided: absence data has been behind a named session or the staff PIN since 26 Aug 2026, so
what remains open is whether each person signs in rather than a station sharing a code.
