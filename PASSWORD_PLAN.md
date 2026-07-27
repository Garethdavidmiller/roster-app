# PASSWORD_PLAN.md — chosen passwords + admin reset (Track C-lite)

> **STATUS: Phases 0, 1 and 2 SHIPPED (Phase 0+1 v18.63; Phase 2 v18.92).** The decisions table (§10) was confirmed and built —
> gated dual-attempt sign-in (`credentialCandidatesFor` → `ensureFirebaseSession`), the Settings
> Password card + `savePasswordSetAt`, the `resetMemberPassword` admin break-glass Cloud Function, the
> `passwordStatus` collection + rules, and the Operations Account-status table are all live. **Phase 2 (the forced
> overlay) is live** as `password-force.js`, gated by the `CONFIG.FORCE_PASSWORD_SET` kill switch: any
> member still on the surname default is compelled at their NEXT SIGN-IN (owner decision, 25 Jul 2026 —
> "force everyone, but only on the next log in"; nobody is signed out to accelerate it). The
> **reset-request queue** (§12, v18.93) and its **admin notification** (§14, v18.95) are also live —
> that is the queue's own two-step phasing, unrelated to the plan's Phase numbers. **Still to
> come:** C2 (email-based self-service reset, needs an email relay) and C5 (retire the surname default
> once ≥90% have migrated). Sections below that
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
(account matters → "the admin"): **"Password not recognised — if you've forgotten it, or your
account isn't set up yet, ask the admin."** (Updated v18.74 from the older "Password incorrect …
ask the admin to reset it" — the remedy for a never-provisioned account is set-up, not a reset, so
the wording no longer promises a reset that can't help; login-overlay.js is the source of truth.)
`auth/too-many-requests` gets its own message ("Too many attempts — wait a few
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
| **2 — compel + measure** | Forced set-password overlay, gated on `!isPasswordMigrated(status)` | ✅ **SHIPPED v18.92** as `password-force.js` on all five authenticated pages, kill-switched by `CONFIG.FORCE_PASSWORD_SET`. Applied to EVERYONE at once rather than owner → managers → staff (owner, 25 Jul 2026): the session model staggers it anyway, so a tiered rollout would have added releases for no reduction in peak load. ~~staged compel via `resetMemberPassword(revoke:false)`~~ — **struck v18.88, see below** |
| **3 — retire the surname (later, optional, C5)** | Stop seeding surname passwords for new starters; delete the surname fallback + padding | **Irreversible.** Gated on ≥90% migrated. Out of scope for this plan; the door is left open |

> **Correction (v18.88) — the "staged compel via reset" step did nothing.** Phase 2 originally
> proposed running `resetMemberPassword` with `revoke:false` over batches of un-migrated members, on
> the theory that "the password write is a credential no-op, only the flag flips". Traced against
> `functions/index.js`: for an un-migrated member that call (a) rewrites the password to the surname
> it already is, (b) stamps `resetAt`, and (c) with `revoke:false` does not sign them out. Migrated
> status is `passwordSetAt > 0 && passwordSetAt >= resetAt` — for someone with no `passwordSetAt` it
> was false before and is false after. **No flag flips and nothing compels them.** The forced overlay
> is the entire mechanism; it needs no reset call, and it should gate on `!isPasswordMigrated` (the
> shared tested helper), not on `resetAt` being present. Keep `revoke:true` for its real purpose —
> genuine break-glass, where signing the member out is the point.

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

---

## 11. Phase 2 as built (v18.92)

Sequenced against the reviewed plan; the deltas are the ones that survived a max-effort review of it.

**Scope:** all five authenticated pages. An earlier draft put it on `admin.html` only, justified by a
managers-first wave; once the decision became "everyone", admin-only would have missed a member who signs
in on the pay calculator and never opens Admin.

**No wave selector.** `CONFIG.FORCE_PASSWORD_SET` is a plain kill switch, not a tier control, because the
30-day/7-day session model already staggers the rollout by each member's own expiry — a tiered flag would
have added releases without lowering the peak.

**Reach, stated honestly.** This compels anyone who signs in. It does NOT reach a member who only ever
views the roster: the calendar is `anonymousOk`, so they have no session to expire and no sign-in to
intercept. That is not fixable on the calendar side either — `passwordStatus` is owner-or-admin read, so
an anonymous session cannot even tell whether the selected member has migrated, and a device-local flag
can't distinguish "never signed in" from "migrated elsewhere". Closing it means Track E.

**Four things the review changed, each closing a real failure:**

1. **The gate keys on `authStatus === 'named'`, not "an auth user exists."** On the calendar that user is
   anonymous; on paycalc a member can be locally signed in with a failed Firebase session. `updatePassword`
   cannot succeed for either, so the weaker test would have shown a hard block nobody could satisfy.
2. **It fails open AFTER showing, not only before.** The email-check model this is built on cannot fail
   once visible; this can (rate limit, dropped connection). A quiet "Continue for now" appears on those,
   and after three failures of any kind. It stamps nothing, so the member is compelled again next sign-in.
3. **The e2e harness defaults the flag OFF.** The hermetic Firebase stub resolves every `getDoc` as
   non-existent, i.e. every member reads as un-migrated — so leaving it on would have put the overlay over
   every sign-in test in the suite. `forcePasswordSet(page)` opts in. The three flag helpers were also
   consolidated onto ONE `roster-data.js` route: Playwright runs only the most-recent matching handler, so
   the previous per-helper routes meant a test calling two of them silently got one.
4. **Password wins over the work-email check, and admin-app.js deletes that check's marker.** Skipping the
   call alone would leave the marker set, and the email check would then appear on a later ordinary Admin
   load — the v14.77 "Fix 4" defect its marker exists to prevent.

**Two defects the rendered overlay caught that code review did not:**

- `.pwf-escape { display: block }` silently beat the `hidden` attribute's UA `display: none`, so the escape
  hatch was visible from the moment the overlay opened — the compel had no teeth at all.
- `shared.css` keeps `.login-error` at `display: none` until a `.visible` class is added. Setting
  `textContent` alone left EVERY error message invisible: a member typing a short password would have seen
  nothing happen. A test asserting text content passes straight through that, which is why the assertions
  now check visibility.

**Not verified here (no live Firebase in this environment):** whether a client-side password change signs
that member's other devices out. The copy is written to be correct either way — "you'll need it the next
time you sign in on any device" — so nothing depends on the answer, but confirm it before writing anything
more specific.

---

## 12. The reset-request queue (v18.93) — Phase 1

§1 put recovery entirely out-of-band: "tell the admin → admin resets". v18.92 then made migration
compulsory, which raises the volume of exactly those conversations — and the admin had **no way to know
a request existed** until someone messaged them. This closes that, and only that.

**Scope deliberately small.** A member taps a link, the admin sees a queue. There is no email, no code
and no self-service reset. The notification was held back as this queue's own
phase 2 (§14, shipped v18.95 — not to be confused with the *plan's* Phase 2 in §11) because it carries
the only fiddly part: filtering `pushSubscriptions` by `owner` uid, failing closed when a legacy doc has
no `owner`, and never falling back to the all-devices fan-out.

**Why it is a Cloud Function.** Verified rather than assumed: `signInAnonymously` runs ONLY in
calendar-app.js, and with `ENFORCE_NAMED_SESSION` on, session.js's anonymous fallback is dead code. So a
member on a protected page's login overlay has NO Firebase identity — the person who needs this feature
is precisely the person who cannot write to Firestore. The alternatives were to establish a new anonymous
session on the protected pages (an explicit anti-goal in SECURITY_RELEASE_PLAN.md, and new auth behaviour
next to the login path — this app's worst outage area) or to open a client-writable collection. The
endpoint beats both: `resetRequests` denies every client write, and all validation is server-side.

**It never resets a password, by design.** An unauthenticated caller who could force any member back to
the surname default would undo v18.92 and, with token revocation, boot them off their devices — a
downgrade-plus-nuisance attack available to anyone with the URL. The admin performs the reset. The human
in the loop IS the authentication; this is a doorbell, not a recovery mechanism.

**Bounding the app's first public unauthenticated endpoint** — the one new exposure this creates:

| Control | Why |
|---------|-----|
| **Doc ID = member name** | The collection can never exceed the roster. Flooding is impossible BY CONSTRUCTION, not by rate limiting — worst case is one stale row per member. |
| Name ∈ server-owned `activeMembers` | Rejects junk, AND makes the name safe for the admin card to render (it came from our list, never the request body). |
| **No free text stored** | An unauthenticated endpoint writing caller-controlled strings into an admin UI is an injection surface for no benefit. |
| `shouldRecordResetRequest` throttle | Repeat taps must not inflate the `count` the admin reads as "how stuck is this person", nor generate repeat notifications later. Pure + unit-tested; fails OPEN on a junk timestamp (never block someone from asking). |
| `maxInstances: 3` | Caps the cost of a flood. No other function in the codebase sets this; a public one needs it. App Check (Track D) is the eventual real control. |
| No enumeration | Same answer for any roster name whether provisioned or not — and the roster is already public in the login dropdown, so nothing new is revealed. |

**`provisioned` earns its place.** The login overlay deliberately cannot distinguish "forgotten password"
from "never set up" (that would leak which names are provisioned). The admin's card has no such
constraint, so the function records whether a Firebase account exists — the difference between **Reset**
and **run Set up accounts**, which otherwise costs a wasted round trip to discover.

**Where the link appears:** only after a `kind: 'credential'` failure. Always-visible would invite a
request from anyone who merely mistyped, and the remedy for a mistype is to try again. A network or
rate-limit failure gets no link either — a reset does not fix a dropped connection.

**One thing the render caught:** with the link shown, the card stated the same advice three times at
once (the error text, the link, and the static "Trouble signing in? Ask the admin." footer). Revealing
the link now hides that footer — the actionable version replaces the passive one.

**Still true after this:** a member who never signs in anywhere is unreachable. Email self-service (C2)
remains blocked on a relay — note that Firebase's own `sendPasswordResetEmail` cannot substitute, because
the accounts are synthetic `initial.surname@myb-roster.local` addresses that receive no mail.

---

## 13. What the v18.94 review found (and what it did not fix)

A five-reviewer adversarial pass over v18.92+v18.93 found ~20 defects. The fixes are in v18.94; what
follows is the part worth keeping — the things that are **accepted, not fixed**, and the reasons.

### The one that matters most: a request proves nothing about who sent it

Nothing ties a reset request to the person named in it. A reviewer filed valid requests for **all 50
members in 406ms** from Node, with no browser, no Origin header, and no JavaScript — a plain
auto-submitting `<form>` on any site would do it from every visitor's browser. The card then presents
each row as an outstanding lockout with the remedy "Reset below in Account status", and acting on it
puts a member who had chosen their own password **back on the guessable surname default and revokes
their tokens**. That is the downgrade attack §12 says the design forecloses — reached through the admin
as a proxy. "The human in the loop IS the authentication" authenticates the reset *action*; it does not
authenticate the *asker*, and the card gave the admin nothing to doubt.

**Mitigated, not solved (v18.94).** The card now says plainly that requests aren't verified and to
confirm with the member before resetting, and the Tips panel repeats it with the consequence spelled
out. That is honest but it is a human control. The real fixes, in ascending cost: **App Check** (Track
D — already planned, and the right answer), or a short-lived server-issued token the login overlay can
only obtain after a genuine credential failure. Until one lands, treat the queue as a **notification**,
never as evidence.

`count` is attacker-owned for the same reason, so "asked 3 times" is not evidence either.

### `CONFIG.PASSWORD_RESET_REQUESTS` does not reach the endpoint

It hides the login link. The public endpoint stays live and unauthenticated, so it is **not** a lever
against any of the above — the real levers are a functions redeploy or deleting the function. Do not
reach for the flag in an incident expecting it to close the door.

### `maxInstances: 3` bounds cost, not rate — and is itself a lever

With no `concurrency` override the platform default (~80/instance) applies, so ~240 requests can be in
flight: the cap does not throttle request rate. It genuinely bounds spend, but an unauthenticated
caller can saturate all three instances and have Cloud Run 429 real requests — taking the only in-app
recovery route offline. Accepted trade; recorded here so it is not discovered during an incident.

### CORS is not a boundary on this endpoint

`cors: ADMIN_FUNCTION_ORIGINS` sets response headers and calls `next()` regardless of the request's
Origin, and a non-browser caller sends none. On the other three functions the docstring correctly calls
CORS "defence-in-depth on top of the real control" — here there is no other control, so the allowlist
reads far more protective than it is. The name is also misleading on a deliberately public endpoint.

### Smaller accepted items

- **A stale `provisioned: false`** can persist up to the 10-minute throttle window after the admin runs
  Set up accounts, because a throttled repeat doesn't rewrite the flag.
- **The compel marker is consumed before the identity is known**, so a member whose session barrier
  doesn't settle inside 4s loses that compel cycle (up to 30 days). Fixing it means restoring the
  marker, which re-creates the Fix-4 ambush — the worse of the two. Coverage completes anyway.
- **The modulepreload guard only walks STATIC imports**, so a dynamic-only import would be invisible to
  it. Not live (every dynamically-imported module here is also statically imported elsewhere), but the
  guard is weaker than it looks.

---

## 14. The reset-request queue, phase 2 — the admin notification (v18.95)

> **Two different "phase 2"s live in this document.** §11 is *the plan's* Phase 2 (the forced-set
> overlay, v18.92). This is *the request queue's* phase 2 — a separate, much smaller phasing internal
> to §12. They are unrelated; only the queue's is described here.

§12 shipped the queue; the admin still had to *look* at Operations to discover it. This closes that,
and only that: a genuinely-recorded request pushes a notice to the admin's phone.

**It is the app's first non-broadcast notification, and the whole design follows from that.** Every
other push (Huddle, Circular, Newsletter, Pay) goes to every subscribed device. "N. Surname asked for a
password reset" sent to ~50 staff is a leak — and worse, it tells the whole team who is locked out,
which is the same social-engineering fuel §13 objects to in the `throttled` oracle. So the send goes
through a new **`sendTargetedPush`**, never `fanOutPush`.

**Fails closed in three places**, because every failure mode here has the same consequence:

| Situation | Behaviour | Why not the alternative |
|-----------|-----------|-------------------------|
| No target uids resolved | Send nothing | There is deliberately **no "no targets → fall back to everyone"** branch. That fallback is the bug the function is shaped to make unwritable. |
| A subscription doc has no `owner` | Skip it | Those are legacy docs from before v17.76 stamped the uid. Guessing an identity from an unowned record is exactly the mistake that leaks. |
| No owner-stamped matches | Log, return | A notification that cannot be delivered privately is not delivered. |

**Accepted cost:** an admin device that subscribed before v17.76 gets no push until the bell is toggled
off and on (which rewrites the doc *with* an owner). Silence is the right failure here, and the queue
card is unaffected either way.

**The push can never fail the request.** It is wrapped and swallowed. The row in Firestore is the
doorbell; the push is a courtesy. A push outage that became a 500 would lose the request itself and send
a locked-out member away thinking nobody heard them — the precise defect v18.94 fixed on the line above,
and it must not reappear by another route.

**Only on a RECORDED request, never a throttled repeat.** Otherwise anyone with the URL could ring the
admin's phone at will; the existing 10-minute throttle is the notification's rate limit too.

**Why the queue depth is in the headline.** The design language gives each feature one stable `tag`, so
request #2 *replaces* request #1 on the lock screen. Rather than let that lose information, the headline
states the current total (`Reset requests — 2 waiting`) and the body names whoever just asked. The newest
notification is therefore always an accurate summary of the whole queue, and it counts the same rows as
the card's chip, so the two can never disagree. Wording is the pure, tested `buildResetRequestNotice`.

**Deep link.** `operations.html#reset-requests` — added to the SW's `SAFE_NOTIFICATION_PAGES` (listing a
page there is not an access grant; it only decides which in-scope page a payload may open, and the page
keeps its own admin gate). `DEEP_LINK_CARDS` in `operations-app.js` opens and scrolls to the card;
Operations has nine collapsed cards, so landing on the page alone would still leave the admin hunting.
It only ever *opens* — a repeat tap must not toggle shut the card it sent them to.

**§13 is unchanged by this.** A notification makes the admin aware of a request faster; it does nothing
to establish that the request is genuine. The verification gap, App Check (Track D), and the rest of §13
all stand exactly as written.

---

## 15. What the second review round found (v18.95)

Everything shipped today was re-reviewed after §14. Five defects, four of them introduced by the
polish pass itself — worth recording because three were invisible to every existing gate.

**A page-local CSS rule reached into the shared login overlay.** The Settings Password card's new
reveal toggle needed `.login-pw-wrap { margin-bottom }` — but `.login-pw-wrap` is *also* the class
`login-overlay.js` injects on every page, so settings.html's sign-in card silently grew 14px taller
than the other five. Page stylesheets load per page, so no single-page test could see it. Fixed by
scoping to `#passwordBody`, and there is now a permanent cross-page login-geometry test
(`e2e/auth.spec.js`) that measures the card, the password wrap, the input and the submit button on
all five pages and requires them equal. Teeth-verified against the unscoped rule.

**The endpoint's new notification was inside the request's own 30s budget.** The try/catch around it
only survives a rejection; the notify path makes up to four network calls and none is guaranteed to
settle. A hung push would have let Cloud Run kill the request — returning an error to a member whose
request WAS recorded, telling them nobody heard them. Now raced against a 10s budget. This is the
never-settles-is-not-a-rejection class from §13 reappearing by a different route, one release later.

**The Settings Password card had that same missing timeout.** v18.94 time-boxed `setOwnPassword` in
the forced overlay and stopped there; the Settings card makes the identical call and was left with a
button that stays disabled on "Saving…" forever if the promise never settles. `withTimeout` is now
exported from `password-force.js` and shared, so there is one implementation, and it is unit-tested.

**The reveal was never re-masked after a successful save.** Clearing the field values left the inputs
in whatever reveal state the member chose, so the next password typed into that card — possibly by
someone else on a shared device — would appear in the clear.

**The notification headline was ambiguous alone.** A collapsed notification shows only the title, and
"Password reset — 1 waiting" on your own lock screen reads first as something about *your* password.
Now "Reset requests — N waiting", which also matches the card it opens.

### Not a defect, but the gate that let three of them exist

Re-baselining the visual suite revealed that **three committed baselines had drifted from what the app
actually renders** — the admin week label, a railcard sub-heading reflow, and a calendar change — each
sitting under the 0.3% `maxDiffPixelRatio` and so passing. Worse, the documented refresh command could
not fix them: a bare `--update-snapshots` defaults to `changed`, which rewrites only baselines whose
comparison FAILED, so a drifted-but-passing baseline was unreachable by the documented procedure.
Both fixed: the command is now `--update-snapshots=all` everywhere it is documented, and the tolerance
is tightened to 0.1% on the evidence that re-rendering twice in this environment produces
byte-identical PNGs — the noise floor here is zero, not 0.3%.

---

## 16. What the external review found (v18.97)

An external review of v18.96 rated it 9.0/10 and raised one urgent defect, which was real and was
mine: the guard I added to stop a hang had turned a *slow* password write into a *reported failure*.

**A timed-out password write is INDETERMINATE, not failed.** `Promise.race` stops waiting; it does
not cancel. So `updatePassword` could land a second after the UI had said "Couldn't connect", leaving
the member believing their old password still worked — during a COMPULSORY migration, which makes it
a route into the exact lockout the timeout was added to prevent. The v18.94/95 tests proved a *hang*
becomes `myb/timeout`; none covered a promise settling *after* the deadline.

`settleOrTimeout` now reports three outcomes rather than two — `ok` / `failed` / `pending` — and
hands back a handle on the original work. On `pending` both surfaces now:
- say plainly that the result could not be confirmed, and to **keep the new password and try it
  first** (the safe instruction under either outcome);
- keep the Save button **disabled**, because a second write racing a first that may still land is the
  worst version of this bug — the retry re-authenticates with a password the late write may already
  have replaced;
- keep watching: a late success finishes the flow normally, a late failure re-enables retry with the
  real error;
- still offer "Continue for now", so a compulsory overlay never holds someone on an outcome nobody
  can resolve.

`withTimeout` is kept for calls that change nothing (reads, the idempotent re-auth) and its docstring
now says so. **The rule: a state-changing call may never use a timeout that reports failure.**

**Sign-in statistics counted accounts that are not on the roster.** `summariseSignIns` filtered on
"not disabled", so an enabled `@myb-roster.local` account for a leaver — the orphan sweep is a manual
admin action — inflated both `total` and `neverSignedIn` on a card headed "exact". It now takes an
ALLOWLIST built from the server-owned roster, and fails closed: an empty allowlist counts nothing,
because a visibly-wrong zero beats a plausible number drawn from an unknown population.

**Two quick Clears could still leave a ghost row.** The v18.94 guard *dropped* a refresh requested
during an active load, so: clear A → refresh A starts → clear B → refresh B discarded → A's older
snapshot repaints B, with nothing queued to correct it. Refreshes are now queued, not dropped.

**A roster walk produced one push per name.** The per-member throttle bounds one person; it does
nothing about a caller walking the public roster. `shouldNotifyAdmin` now coalesces globally: one
push per 5-minute window, and because the feature shares one notification tag carrying the queue
depth, that one push is an accurate summary of the whole queue rather than a fragment of it. Derived
from the timestamps already on the rows — no new document, no new rules surface, and nothing a client
could write to suppress the admin's notifications.

**The kill switch didn't reach the endpoint.** `CONFIG.PASSWORD_RESET_REQUESTS` hides the client
link; the public function stayed callable. `RESET_REQUESTS_ENABLED` in `functions/index.js` now
closes it with a 503. Deliberately a constant, not a Firestore flag: an incident switch must not
depend on a read the incident might be affecting.

### Still accepted, unchanged

§13 stands in full. A request still proves nothing about who sent it; coalescing bounds the *noise*
of a forged burst, not the forgery. App Check (Track D) remains the real control, and the public
absence data remains a deliberate, documented trade.

### Test gaps the same review listed, closed at v18.98

§16 fixed the behaviour; it did not pin all of it. The review's own "most valuable additions" list had
five items and only two were done, which is the pattern that lets a fix regress silently. Three are
now closed and each was **teeth-verified against the pre-fix code**:

- **A browser test for the indeterminate state.** The unit tests proved `settleOrTimeout` returns the
  right shape; nothing proved the OVERLAY behaves accordingly — and the v18.92 `.pwf-escape` bug is the
  standing proof that a CSS/DOM-level defect here is invisible to code reading and to unit tests.
  Three e2e cases now cover it: the deadline passing reports "couldn't confirm" (and explicitly NOT
  "Couldn't connect") with the Save button disabled and the escape offered; a LATE SUCCESS closes the
  overlay; a LATE FAILURE re-enables retry with the real error.
- **A coalesced reset-request refresh test.** Two rapid Clears, with reads deliberately delayed so the
  interleaving is reproducible rather than lucky, must leave neither row behind.
- **A sign-in stat test with an enabled orphan** (already added in §16's release).

Two fixture capabilities were needed and are worth knowing about: `deleteDoc` now really removes the
seeded row (so a ghost row and a cleared row look different), and `__E2E.docsDelayMs` / 
`__E2E.hangPasswordWrite` make the two races reproducible instead of timing-dependent.

**Still open from the review, by choice not oversight:** App Check (Track D — an owner decision, and
the reason it was declined in June 2026 still stands on its own terms); moving absence data behind
authentication (Track E, undecided); and the remaining FIP country source URLs, which need one
verified per-country link each rather than a guessed pattern.
