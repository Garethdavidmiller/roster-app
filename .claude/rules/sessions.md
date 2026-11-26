---
paths:
  - "session.js"
  - "test/session.test.mjs"
  - "page-session.js"
  - "test/page-session.test.mjs"
  - "login-overlay.js"
  - "test/login-overlay.test.mjs"
  - "login-core.js"
  - "auth-*.js"
  - "test/auth-*.test.mjs"
  - "claim-retry.js"
  - "test/claim-retry.test.mjs"
  - "password-force.js"
  - "test/password-force*.test.mjs"
  - "silent-sign-in.js"
  - "own-password.js"
  - "firebase-client.js"
  - "firestore.rules"
  - "test/surname-parity.test.mjs"
  - "functions/auth-endpoints.js"
  - "functions/member-identity.js"
  - "functions/roster-parse-helpers.js"
---

# Sign-in and sessions — area decisions

**The contract is `docs/AUTH_AND_SESSIONS.md`**: numbered invariants for session ↔ identity ↔ claim,
the three ways they disagree, and a write whose account has gone. Link its numbers; never restate
them. This file holds the area's working notes; the rules every session needs are in `CLAUDE.md` →
"Firebase Auth". The strict cutover's design is AUTH_AND_SESSIONS.md → "Write isolation (B0–B3)".

## One local session, every page

`AUTH_KEY` in `session.js` is the one local session record, so a member signed in on any page arrives
on every other without seeing the login overlay. It lasts 60 days from sign-in — renewed on each open in
the INSTALLED app, once the server has vouched for the account within the hour (`renewWhenServerVouches`;
owner, 26 Nov 2026; AUTH_AND_SESSIONS.md 2) — and it is not an identity on its own (17).

## Session re-establishment on page load

Every write page signs in to Firebase Auth on fresh login AND on every page load with an existing
local session — a returning member skips the login screen, so without it `auth.currentUser` stays null
and every Firestore write fails. `ensureNamedSession(name)` in `session.js` handles this (every
page calls it; the sign-in inside it is `ensureFirebaseSession`, which nothing calls directly): it
waits for `onAuthStateChanged` (to detect any IndexedDB-persisted session; at most
`AUTH_RESTORE_TIMEOUT_MS` — `AUTH_READY_TIMEOUT_MS` is the separate, longer bound on Firebase Auth
starting at all), then signs in if none exists. No account self-heal and no anonymous
fallback: a refused sign-in leaves no named identity (`'none'`) and a sign-in prompt, while one that
never reached an answer is `TRANSIENT` and keeps the 60-day session (AUTH_AND_SESSIONS.md 23).
**Do not remove this call.** The silent attempt's own rules — the no-surname memory, the six-hourly
re-check, the hold while a re-check is unanswered, and the refusal after a reset — are the pure
`silent-sign-in.js`; `session.js` only wires them. A session's start, which that refusal compares with
the server's `resetAt`, is the server's record of the sign-in (`lastSignInTime`) when it is this
member's and within three days of the device clock (`sessionStartMs`), so a phone whose clock runs
ahead cannot make a reset look older than the session it should end.

## Per-member write isolation (STRICT)

`overrides` create/update/delete require the member's own bound name (`memberName()`,
AUTH_AND_SESSIONS 19), OR an `admin`/`manager` claim (both write on behalf). The rule is **STRICT**:
the old permissive `!('name' in token)` escape (a token with no `name` claim let through) is gone
and must not come back (AUTH_AND_SESSIONS 4). A stale token self-heals through `writeWithClaimRetry`
(invariant 5).

**Three claim tiers**, all set by `setupRosterAuth` from the server-owned `roster-members.json`:
`{ admin: true, name, member }` for `ADMIN_NAMES`, `{ manager: true, name, member }` for
`MANAGER_NAMES`, `{ name, member }` for everyone else (admin outranks manager; `linksDesigner` on top).
The `manager` tier is load-bearing: managers edit staff AL/sick/shifts on behalf daily — without the
`manager` bypass the isolation rule silently locks them out. Master-admin collections
(huddles/circulars/newsletters/roster/auth) stay `admin`-only — do NOT grant managers `admin: true`.
**Deploy prerequisite:** a manager must be provisioned (Operations → Set up accounts, which sets the
`manager` claim) AND token-refreshed before the isolation rule is relied upon — a stale manager token
has `name` but not `manager`.

## `normaliseSurname()` in `auth-identity.js`

Shared surname derivation for Firebase Auth: lowercases and strips non-alpha (the ≥6-char padding for
the Firebase *password* is applied separately by the password builders, `surnamePassword` here and `nameToPassword` in `functions`,
**not** inside `normaliseSurname`). Lives in the pure `auth-identity.js` (so it's unit-testable) and is
**re-exported by `firebase-client.js`**. The member's own password calls (`reauthenticateWithPassword`,
`changeOwnPassword`) are built in `own-password.js` and refuse — before anything is sent — unless the
signed-in account is the page member's own (`myb/account-mismatch`; another tab can change it). The letters-only rule is spelled ONCE on each side:
`lettersOnly` in `auth-identity.js`, which `normaliseSurname`,
`credentialCandidatesFor` and `validateNewPassword` all go through, and `surnameCore` in
`functions/roster-parse-helpers.js`, which `nameToEmail` and `nameToPassword()` share — Cloud
Functions are CommonJS and cannot import browser ES modules, so unification requires a build step.
If the rule ever changes, update both cores (`surname-parity.test.mjs` compares them across the whole
roster and checks each side spells the rule once), and read AUTH_AND_SESSIONS.md 12 first:
`firestore.rules` carries a third copy of the email derivation.
