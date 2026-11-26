# SECURITY_RELEASE_PLAN.md — the security work still to do

*Not version-stamped; not a runtime asset.* **What is still open in the security work, in what
order, and what it is waiting on.** Everything already shipped is in **`AUTH_AND_SESSIONS.md`** — the
numbered invariants, and its "Why it is this way" section for the design decisions — and the
operational steps are in **`RECOVERY_RUNBOOK.md`**. This file holds only the open work, so a section
that ships moves out (its durable rule to `AUTH_AND_SESSIONS.md`, its story to git). The sign-in plans
were folded into these three on 26 November 2026; the old text is in git.

---

## ⭐ CANONICAL TRACK STATUS — this table is the single source of truth

**This table owns STATUS; nothing else may restate a stage.** The stage of a track once had to be
reconciled across five files, and two had drifted — `auth-plan-parity.test.mjs` exists for that.
**If you change a status, change the table, then search this file for prose that restates it.**

| Track | Current stage | Next stage | Blocking decision | Exit condition |
|---|---|---|---|---|
| **A — infra** | ✅ Complete (A1 · A2 · A3) | — | — | WIF live, no standing deploy key; `npm audit --omit=dev` clean (13 Nov 2026, v25.93) |
| **B — write isolation** | ✅ Complete (B0–B4, H2; strict since v16.29) | — | — | Strict `overrides` rules live, no lockout, self-heal proven |
| **Member-claim binding** | ✅ Complete — v24.23 believes a `name` only on a password sign-in at the name's derived email; v24.24 stamps the server-only `member` claim (Set up accounts); v24.27 requires it (`isMember()` in `firestore.rules`, `memberNameFromClaims` on the server) | — | — | Every member rule and endpoint reads identity through `isMember()` / `memberName()`; never roll rules back past v24.23 |
| **A5 — push subscriptions** | ✅ Complete (v17.76, extended v18.74) | — | — | Per-owner create/update/delete enforced |
| **A7 — deploy credential scope** | Code side done (v24.97): the backup check reads its account from the `BACKUP_CHECK_SERVICE_ACCOUNT` repository variable, and alerts only on a definite "no backups" | **Owner, in GCP:** limit the WIF provider to `refs/heads/main`, then give the backup check a read-only account — the commands are `RECOVERY_RUNBOOK.md` → "Tightening it" | — | A token for `github-deploy@` cannot be minted from any ref but `main`, and the weekly backup check no longer runs as the deploy account |
| **C — passwords** | Forced migration live (Phase 0+1 v18.63, Phase 2 v18.92, reset queue v18.93–95) | **C5** — retire the surname default | Track E (below): un-migrated roster-viewers never signed in, so the metric could not converge — a premise gone since the staff PIN was retired (23 Nov 2026); what that does to the gate is part of the open decision. **⚠️ A SECOND ROUTE is on the table and NOT adopted** — C6 (below) would let the remaining surname credentials be replaced server-side with unknown random ones, which answers the CREDENTIAL question without touching the READ question. The two routes and what the second costs: "C5 — the open decision", below. Until the owner decides, this row stands as written | ≥90% migrated **and** a proven recovery route for the remainder |
| **C2 — email verification/reset** | Deferred | — | Needs an email relay that does not exist | Relay available and owner wants it. **A saved address is not a credential** — possession must be proven and recorded (`verifiedAt`) before it can recover an account; design under C2, below |
| **C6 — one-time recovery/activation codes** | Proposed, not started | Owner decision | — | Design under C6, below. Supersedes C4′ (the admin reset) as the recovery path: today's reset makes the SURNAME valid again, so the migration's own repair mechanism undoes the migration. C4′ stays live until C6 does — break-glass may not have a gap |
| **F — step-up for sensitive admin actions** | Proposed, not started | — | — | Design under F, below. **No prerequisites** — the only open item with none. Server-enforced from the token's `auth_time`, never a client timer |
| **D — App Check** | Deferred, not started | **D1** — monitor mode | Owner decision | Legitimate traffic characterised over a real window before any enforcement |
| **E — full-app auth** | E0 ✓ v19.00 · E1 ✓ v19.01 · **the READ closure is IN FORCE since 26 Aug 2026** — the Calendar asks for a named session (the staff PIN was retired on 23 Nov 2026 — DECISIONS.md → "The staff PIN retired"), and the server refuses anything without a verified member (`isMember()`) or `admin` (the retired PIN's `calendarViewer` grants nothing since its server release). RECOVERY_RUNBOOK → "The staff PIN (retired)" has the read-tightening order | **E3** — INDIVIDUAL authentication as designed, if it is ever required. E2 was superseded, not built: it would have required merely *any* session, which an anonymous sign-in satisfies | Owner decision, most likely forced externally by a Chiltern IT requirement that each person authenticates | Owner approval + rollback rehearsed + **E3 criteria pre-registered before telemetry starts** |
| **E6 — document files** | Short-lived signed links live (`getDocumentUrl`: server v24.16–18, client v24.19); the stored permanent link kept as the fallback (owner, 7 Oct 2026); rotation built (12 Nov 2026), not yet run | — | Owner — the first rotation run; revisit the fallback on DECISIONS.md's trigger (a leaked link, or `getDocumentUrl` failures making the fallback usual) | ARCHITECTURE.md EXC-007 closes: the links already in circulation no longer open |

**Three things the table is deliberately explicit about**, because each was once implied and
misread: **E1 is client preparation, not protection** — the boundary moves at the READ RULE, which
the staff PIN moved (v20.12) in E2's place; **C5 is gated on a decision in a different track**, so it
is further away than "≥90% migrated" suggests; and **that gate conflates two questions**, which C6
would separate — *may a guessable password sign somebody in?* is not *may the roster be read without
individual identity?*. The first is answerable today; the second is Track E.

---

## The rules that order what is left

How to ship any rule that needs a claim — migrate rather than cut over, the deploy order, never two
silent-failure cutovers at once — is `AUTH_AND_SESSIONS.md` → "Shipping a rule that needs a claim".
The constraints on the remaining work specifically:

- **D2 (App Check enforce) must not overlap a rules cutover** — separate them by a stabilisation
  window.
- **C5 is irreversible**, gated on ≥90% migration and on Track E (the C row), unless the owner takes
  the second route.
- **Keep Track A (the deploy identity, the Functions dependencies) out of an authorisation release.**
- **Verify in a fresh private window, never from an installed phone.**

---

## Track A — what to watch

**A1 — the Functions' production dependencies audit clean** (`npm audit --omit=dev`). The Functions
deploy refuses a high or critical advisory, and the weekly `functions-audit.yml` fails on the same
(`scripts/audit-functions-deps.sh`), so **low and moderate drift does NOT fail CI** — it is caught only
by looking (ROADMAP.md → WATCH). **What the next firebase-admin major will hit again:** the endpoint
harnesses inject their fakes by RESOLVED PATH, so they must stub the modular entry points
(`firebase-admin/auth`, `firebase-admin/firestore`) the code requires — a fake left on a path nothing
requires is loaded by nobody, and the suite runs against the real SDK. Migrate on the old major
first, then bump.

**A7** — the owner's GCP step: `RECOVERY_RUNBOOK.md` → "The deploy identity" → "Tightening it".

---

## Track C — passwords: what is left

What is built — chosen passwords, the forced overlay, the admin reset, the request queue — is
`AUTH_AND_SESSIONS.md` → "Why it is this way". The order of what is left, and why each sits where it
does (nothing here is scheduled; the owner decides what is worth doing and when):

| # | Change | Why there | Unblocks |
|---|---|---|---|
| 1 | **C6 — one-time recovery/activation codes** | The biggest remaining weakness: recovery makes the surname valid again | The C5 decision; activating a new starter with no seeded surname |
| 2 | **Keep converting personal devices** | Everything needed exists; it is a campaign, not a build | Moves the migration figure toward whatever C5 needs |
| 3 | **F — step-up for sensitive admin actions** | A 60-day session is right for ordinary work and wrong for account administration | Nothing — independent, cheap, no prerequisite |
| 4 | **C5 — retire the surname entirely** | The milestone; two routes, an **open owner decision** | Removes a whole credential class |
| 5 | **C2 — verified work-email recovery** | Needs a mail relay, and C6 first, so it is a SECOND route | The admin route becomes true break-glass |
| 6 | **Passkeys** | Excellent fit, blocked on serving from one origin | — |
| — | **Entra / Microsoft SSO** | Only if Chiltern formally adopts the app (ROADMAP.md → the governance gate) | Supersedes most of this list |

**Keep converting personal devices** needs no notice: the sign-in card is the only way in since the
PIN was retired, somebody with no login asks the admin for one (an Other Staff login where they have
no roster — `OPERATIONS_REFERENCE.md`), and Operations' Account status summary states the campaign's
position as "N/M own password" per grade.

### C6 — one-time recovery and activation codes

**Supersedes C4′, the admin reset, as the recovery mechanism**; C4′ stays until C6 is live, because
break-glass may not have a gap. The reset was the right interim — it reused `nameToPassword` and was
no worse than where everyone started — and is the wrong permanent answer: **the repair mechanism for
the migration re-creates the condition the migration removes**, at the moment the account is least
attended.

- **`issueRecoveryCode`** — admin-only, the same shell and guard as `resetMemberPassword`; the target
  checked against `activeMembers`. Stores the code's **hash** and returns the plaintext once, never
  again.
- **`redeemRecoveryCode`** — **unauthenticated, and it would be the app's most dangerous endpoint**: it
  takes a name, a code and a new password, and on success sets the credential. `requestPasswordReset`
  is safe because it cannot change anything; this one sets a password, so it needs a per-name and an
  all-sources throttle, as the retired PIN's exchange had.
- **The code**: from a CSPRNG, nothing derived from the name or the date; at least 40 bits, Crockford
  base32 (no `I`, `L`, `O`, `U`), grouped for reading aloud (`J7KM-42PX-QT`); **single-use and 24
  hours** — it is a bearer token a colleague has heard; **hashed with a server-side secret**
  (HMAC-SHA256 keyed from Secret Manager, or scrypt — a bare digest of 40 bits is crackable from an
  export); never logged, never in analytics or the error log; compared timing-safely.
- **Storage — `recoveryCodes/{memberName}`**: one live code per member, so the collection can never
  exceed the roster (the `resetRequests` bound); a second code overwrites the first, which is also how
  revoking works. Fields `hash`, `expiresAt`, `issuedBy`/`issuedAt`, `attempts`/`lastAttemptAt`,
  `usedAt`, all Admin SDK; **client read and write denied entirely**, the admin included.
- **Throttling, two ways**: per name, from the code's own `attempts` (a handful of failures burns it
  and tells the admin); and an all-sources ceiling under a fixed key no header can influence — the
  station sits behind one corporate NAT address, and a caller can prepend to `x-forwarded-for`, so a
  per-source key must come from its END.
- **Claim the code first, then set the password.** They are two systems; if the password write then
  fails the code is spent and the response says to ask for another. The reverse order lets a second
  redeem succeed, setting a password somebody else chose. (The `upload-commit.js` class of decision.)
- **On success**: set the credential, revoke every session, stamp `passwordStatus.passwordSetAt`
  server-side (real evidence, unlike the Settings card's) and mark the code used.
- **It is also the ACTIVATION path**: `setupRosterAuth` could create an account with an unknown random
  credential and the admin issue an activation code — which is what makes C5's second route possible.
- **What stays**: the member's end of the queue. Only the admin's ANSWER changes — from "make the
  surname valid again" to "issue a code"; the admin never learns a working credential at all.

### F — step-up for sensitive admin actions

The risk a 60-day session carries is not a member's phone left unattended; it is an **admin's**,
where picking it up is enough to reset somebody else's password. Shortening every session would make
the app worse for everybody to address one account.

- **The sensitive set**: `resetMemberPassword` (and `issueRecoveryCode`), `setupRosterAuth` (create,
  disable), and any future operation that changes a member's identity or claims.
- **The rule, on the server**: `verifyIdToken` returns `auth_time`, when the credential was last
  presented; older than 15–30 minutes → refuse with a distinct code. **It must be `auth_time`, never a
  client timer** (invariant 16), and it **fails closed**: no `auth_time`, no elevated operation.
- **The client half exists** — `reauthenticateWithPassword`: refuse → "Confirm your password to
  continue" → reauthenticate → force a token refresh → retry once, reusing `claim-retry.js`'s shape
  rather than a second retry idiom.

### C5 — the open decision

⚠️ **This section describes two routes. Neither is adopted. The choice is the owner's, and the
current plan (the C row) is unchanged until they make it.** The owner asked explicitly that the
second not be adopted quietly; `auth-plan-parity.test.mjs` pins this marking here and in the C row.

- **Route 1 — the plan as it stands.** C5 waits on ≥90% migrated and on Track E, because a member
  who only ever opened the roster with the staff PIN signed in nowhere, never met the forced overlay,
  and never migrated. **Since the PIN was retired (23 Nov 2026) that premise is gone**: every reader
  signs in and meets the overlay, so the figure can converge. What that does to the gate is part of
  this decision.
- **Route 2 — what C6 makes possible.** Every remaining surname password replaced server-side with an
  unknown random credential; anybody who later wants in asks for an activation code — the ordinary
  new-starter flow. With the PIN gone, an account whose surname is replaced cannot read the Calendar
  until it is activated.
- **What they differ on**: the CREDENTIAL question (*may a guessable password sign somebody in?*) —
  Route 2 answers it today; the READ question (*may the roster be read without individual identity?*)
  — Route 2 does not; that is Track E. The coupling of C5 to E3 is real under Route 1 and dissolves
  under Route 2. **It does not make Track E unnecessary.**
- **What Route 2 costs**: irreversible per account (rehearse on one first); a support burst — read
  `neverSignedIn` and the Account status table **before** deciding; it can strand somebody silently, so
  it needs a notice campaign first and a code issued before the credential changes for anybody
  actually using it.
- **The question**: does C5 mean "no guessable credential exists" (Route 2, once C6 ships) or "every
  member authenticates individually" (Route 1, gated on E3)?

### C2 — an address is not a credential

The app collects `@chilternrailways.co.uk` addresses, and that groundwork is right. **A
`staffContact.workEmail` is an address somebody TYPED** — nothing shows anyone can receive mail there,
and wiring "send a reset here" to it is account takeover by mistyping (invariant 15). **The rule:** a
work email may recover an account only after possession is proven — a code or link sent and returned
— recorded as a server-written `verifiedAt`. Gated on a mail relay that does not exist (Power
Automate, Graph, or whatever is approved), and **sequenced after C6**, so it arrives as a second route
rather than the only one.

### Passkeys — possible, not planned

Owner-raised (10 Aug 2026), recorded with its costs and its blocker, **not scheduled** and given no
C-number: if ever committed to, it is C5's successor.

- **The blocker: a passkey is bound to ONE domain, and the app is served from two.** The RP ID must
  be a registrable suffix of the origin; `web.app` and `github.io` are both public suffixes, so
  `myb-roster.web.app` and `garethdavidmiller.github.io` share no parent and a passkey made on one can
  never work on the other. Passkeys make the Pages mirror a decision: retire it first, or accept that
  passkeys reach only members on `web.app`. `analytics/origins` (Operations → Usage) measures it.
- **The options**: **A** — Firebase Auth native passkeys: understood not to be generally available;
  **check current docs for ten minutes before anything else**. **B** — WebAuthn + custom token: the
  real thing, about the size of the PIN project. **C** — a passkey only to skip the password at the
  60-day expiry: most of B's work for a fraction of its benefit. **D** — nothing, relying on the
  browser's password autofill: **the honest baseline B must beat**.
- **Why B is cheaper here than usual**: custom-token minting has run in production (the retired PIN's
  exchange) and its IAM grant is already in place (`RECOVERY_RUNBOOK.md` → 5b); `navigator.credentials`
  is native, and verification lives in `functions/` (CommonJS), so the no-bundler rule is untouched.
- **What would break silently**: a custom-token session keeps its custom claims, but `isMember()`
  and `memberNameFromClaims` believe a `name` only on `sign_in_provider == 'password'`, so every member
  read and write would permission-deny. The fix is a binding of equal strength for the new provider —
  **never dropping the provider check**. The same holds for SSO.
- **Its cost**: begin/finish endpoints for registration and assertion, a client module, a Settings
  "Add this phone" card, a branch in `login-overlay.js`, a `passkeys` collection with client access
  denied outright plus rules tests, and single-use short-lived challenges. The win worth having is
  conditional UI (`residentKey: 'required'`, `mediation: 'conditional'`): the OS offers a face, and the
  grade and name lists never appear.
- **Settle before starting**: never the only factor (a lost phone is a lockout; the password and the
  recovery route stay); not for a shared PC; a real-device check of an installed iOS app; `user.id`
  is the Firebase uid, never the name; and prove the success path by hand in production.
- **The order**: password migration → one canonical origin → retire the Pages install route →
  a passkey spike → passkeys ADDITIVE, alongside passwords. C5 is the higher-value item and passkeys
  do not block it.

---

## Track D — App Check

**Goal:** only this app's own pages reach Firestore, Storage and the browser-called Functions.
**Deferred and sequenced, not closed** — KNOWN_LIMITATIONS → "Firebase App Check" defers here; if
the track is ever cancelled, close it THERE too.

- **Risk**: the API-key referrer restriction's failure, again — miss a served domain or meet a
  provider hiccup and writes fail silently. The allowlist is maintained for ever.
- **Monitor first**: D1 logs only, to learn what legitimate traffic looks like; register every domain
  and the CI/dev debug tokens; then **enforce one product at a time** (Firestore → Storage →
  Functions) as D2. Enforcing before that is how you lock out your own staff, and **never during a
  rules cutover**.
- It gates WHICH CLIENTS connect, not what an authenticated client may read; the `overrides` exposure
  closed by other means. It is defence in depth, rightly last — and the real fix for the reset-request
  queue's unverifiable requests (`AUTH_AND_SESSIONS.md` → "The reset-request queue").
- **Analytics document size (deferred; App Check is the real fix).** The `analytics/activeAccounts`
  and `analytics/perf_<YYYY-MM>` rules check that `daily`/`months`/`samples` are maps but not how many
  keys they hold, so a signed-in member could pad one toward Firestore's 1 MB limit, after which every
  legitimate `increment()` fails until the admin shrinks it — an availability nuisance on aggregate
  counts, not a data risk. If tightened before App Check: a key-count cap on the `activeAccounts` and
  `perf_` create/update conditions, with a matching emulator `assertFails`. (A `perf_` month must be
  the present one or one either side since 10 Nov 2026, which stops padding spreading, not the
  present month's exposure.)

---

## Track E — full-app authentication

**Status — a summary of the canonical table, which wins if they differ.** **E0 shipped v19.00**
(search engines excluded) and **E1 shipped v19.01** (the two-phase load). E2 was never built: the
staff PIN (v20.12) did its job more strictly, and was itself retired on 23 Nov 2026. The read closure
is in force since 26 Aug 2026 and every reader signs in by name. **INDIVIDUAL authentication as
designed — E3, E4, E5 — is dormant**; the likeliest trigger is external, an IT requirement that each
person authenticates if the app becomes official Chiltern infrastructure. What "behind
authentication" can and cannot mean, what is public by decision, and the shipped phases' rules:
`AUTH_AND_SESSIONS.md` → "Why it is this way".

**How far to trust each part**: E0, E1 and E2 are verified against code; E3, the decision gate and
the measurement are **sound but unverified** — the design is right and the numbers are missing
(VALIDATION_REGISTER.md VAL-AUTH-001); E4's one load-bearing assumption is **demonstrated**
(`AUTH_AND_SESSIONS.md` → "The local cache does not ask the rules"); E5 is **under-analysed**.

**Rollout discipline:** migrate, don't cut over — **E0 → E1 → PIN (v20.12, in place of E2) → decision gate → E3 + E4 → E5**.
Never make the Calendar's front door and named-only read rules one flip. E6 is independent.
`auth-plan-parity.test.mjs` pins this exact sequence.

**Why it is little code but a big decision.** Mechanically E3–E5 are a policy flag, a rules change
and a pattern copy — about a day. But the Calendar is the front door and the installed app's start
page, opened many times a day, and individual sign-in there brings offline lockout (E4 answers it),
notification deep links surviving the sign-in, first-run onboarding, and the document viewers'
coupling to sign-in working on every path.

### E0 — exclude search engines ✓ SHIPPED v19.00
`AUTH_AND_SESSIONS.md` → "Search engines excluded (E0)".

### E1 — make the Calendar's reads auth-aware ✓ SHIPPED v19.01
`AUTH_AND_SESSIONS.md` → "The two-phase load (E1)". Client preparation, never a boundary.

### E2 — Level 1 rules (`request.auth != null`) — superseded, and must not be built
Any session, the anonymous one included, would have satisfied it: a barrier of one scripted
`signInAnonymously()` call. The PIN cleared the stricter bar instead, and its retirement left a named
sign-in. **No read rule may admit an anonymous session**, and a tightening is not done while any
broader rule still matches (`AUTH_AND_SESSIONS.md` → "What "behind authentication" can mean").

**⟨ The decision gate ⟩ — answered v20.12, for the READ only.** Casual exposure and a motivated
outsider are answered by E0 and the read rule; what the shared PIN left open (attribution,
per-person revocation) was closed by retiring it. **Whether to go further** — E3/E4/E5 — is the owner's
question, below.

### E3 — named Calendar, soft posture
**Not what exists today, and worth saying so**: since the PIN was retired only a named sign-in opens
the Calendar — the gate decides it (`decideAccess`), and `PAGE_POLICIES.calendar` still does not set
`requireNamed`. That reached E3's front door by removing the shared code, without E3's soft posture
or its measurement. As designed: set `PAGE_POLICIES.calendar` to `{ requireNamed: true }` (one line),
wire the shared login overlay, start **soft** and **measure** (below) before hardening — which would
need a Calendar flag of its own. Client UX only: no rules change in the same window. **Starting E3
consciously REVERSES a recorded decision; record any reversal, never make it silently** — retiring
the PIN was one (`DECISIONS.md` → "The staff PIN retired").

### E4 — offline grace mode (ships WITH E3, never after)
Without it E3 is a real regression for a member whose session lapsed offline. Both halves are ours:
the 60-day expiry is this app's (`SESSION_MS`), and the cache serves reads without the rules.

1. A **durable device marker** — "this device has held a valid named session" — written deliberately,
   because `reconcileExpiredIdentity()` signs the Firebase user out on expiry.
2. On launch: session expired **and** offline **and** marker present → the cached roster **read-only**
   with a calm banner ("Showing your saved roster — sign in when you're back online").
3. Read with `getDocsFromCache` explicitly — a live listener would re-attach on reconnect and blank
   the roster with `permission-denied`.
4. The moment the network returns, require the real sign-in.

It helps only somebody holding a device that was already signed in. The two-to-three-second empty
cache after a browser restart belongs here. Today a member's own stored roster is shown before the
grant and deleted when the session expires (`CALENDAR_DATA.md` 17).

### E5 — Level 2 rules (`isMember()`) everywhere, and a hard gate
Only after E3/E4 have soaked, the numbers say the wall is survivable, and the analysis below exists.
**Disabling the Anonymous provider** does not wait on E5 — nothing signs in anonymously — and is a
Console step that can be taken now (`firestore.rules` still records it as enabled).

> **⚠️ NOT YET ANALYSED — do not treat `isMember()` everywhere as a one-line rule.** The B-track
> needed a permissive→strict migration and a token sweep for WRITES, where `writeWithClaimRetry`
> self-heals. The equivalent for READS has not been done. Found by inspection, and E5 must answer
> both: (1) **no Calendar or Pay Calculator read has a claim retry**, so a stale-claim read just fails
> — add the retry first, or prove no legitimate reader can hold a stale claim; (2) **the Pay
> Calculator's soft posture silently loses its calendar assist** — `fetchOverridesForPeriod` reads
> with a LOCAL session name, and a denied read degrades to "base roster only" invisibly, for exactly
> the users the soft posture protects; decide deliberately, and say so in the UI if accepted.
> **Enumerate every override reader and the identity it holds at read time before writing the
> rule.** That list does not exist yet.

### E6 — the document FILES (independent)
Built: short-lived signed links, the Office viewer kept (`AUTH_AND_SESSIONS.md` → "The document files
(E6)"). **Open**: the first run of Operations → Document links, which rotates the URLs already in
circulation and reaches the orphaned objects retention cannot; and the stored permanent fallback,
revisited only on DECISIONS.md's trigger. Both keep `ARCHITECTURE.md` EXC-007 open. E6 is a different
failure domain from the rules work, on its own schedule.

### What to measure — and pre-register
**Before the gate, with data that exists**: `getSignInStats.neverSignedIn` counts provisioned
accounts that have never signed in — a proxy for who E3 would wall. It measures sign-ins, not
activity, keeps no history, and cannot see somebody with no account; it bounds the question for free.

**During a soft E3**: anonymous counters (no identity, as the existing analytics) for launches that
hit the wall, launches resolved by an existing session, grace-mode activations, and failures at the
wall. Two weeks turns "is a login wall acceptable?" into a number.

**The owner writes the thresholds down BEFORE the telemetry starts, here, dated, and they may not be
revised once data exists** — except once, recorded here as a change of mind with its reason. **An
empty cell at E3 ship time is itself a stop condition**: an experiment with no failure criterion can
only conclude "proceed".

| Metric | Pre-registered threshold | Meaning if breached |
|---|---|---|
| Sign-in failure rate at the wall | _to be set_ | The wall rejects legitimate staff — revise E3, do not proceed |
| Grace-mode reliance | _to be set_ | Offline is doing more work than designed; E4 is load-bearing |
| Launches resolved by an existing session | _to be set_ | If low, the wall is a daily event, not an occasional one |
| `neverSignedIn` at cutover | _to be set_ | The population E5 would lock out with no route back |
| Migration percentage (Track C) | ≥90% (agreed for C5) | — |

### Verification, per phase
- [ ] A fresh **private window**, cold cache — never an installed app.
- [ ] A notification tap on a cold start opens the Huddle; the drawer's Circular and Newsletter open in one tap.
- [ ] Aeroplane mode with a valid session: the cached roster renders; with an expired one: grace mode, not a wall (E4).
- [ ] `npm run test:rules`, and `npm test` (`firestore-contract-parity.test.mjs`).
- [ ] Rollback rehearsed: every phase is a release or rules revert, with no data migration.

---

## Owner decisions needed

| Decision | Blocks | Notes |
|---|---|---|
| **C5 — "no guessable credential" or "everyone authenticates individually"?** | C5 | "C5 — the open decision", above. Neither route is adopted |
| Build C6 (recovery codes)? | C6, and Route 2 of C5 | — |
| **Which bar for Track E — casual, motivated outsider, or individual identity everywhere?** | E3 onward | Casual and motivated outsider are answered. Individual identity is E3/E4/E5 and their front-door cost; may be dictated by IT. **Never answer it with E1** — preparation, not a boundary |
| The E3 thresholds | E3 | Written down before telemetry starts; an empty table is a stop condition |
| Is a sign-in wall on the home screen acceptable? Is grace mode an acceptable answer to offline? | E3, E4 | If grace mode is not, the alternative is longer sessions, not accepting the lockout |
| Member selector vs identity; the Calendar's analytics identity guarantee | E3 | UX, not security |
| Is the app **official Chiltern infrastructure**? | App Check priority; header-capable hosting; Track E | If yes, App Check and Firebase-Hosting-only rise, and Track E may become a requirement |
| **Retire the GitHub Pages mirror?** | asserting "behind authentication" — and **passkeys outright** | A second public front door that serves no headers; it does not weaken the rules (one project), but a passkey made on one origin can never work on the other |
| Confirm the work-email domain before email recovery relies on it | C2 | Set to `chilternrailways.co.uk` — `CONFIG.WORK_EMAIL_DOMAIN` + `isChilternWorkEmail()`, enforced client-side and in `firestore.rules` |
| Email relay — Power Automate or Firebase Trigger Email | C2 | Power Automate already exists (the Huddle ingest) |
| Code expiry and retry policy | C2 | A 10-minute expiry and a 3-attempt lockout is the documented default |
| reCAPTCHA Enterprise provider | D1/D2 | Required before App Check can attest |
| Disable the Anonymous provider | — | Overtaken: nothing signs in anonymously, so it is a Console step that waits on nothing |

---

## What NOT to do

- **Do not** retire the surname (C5) before the ≥90% metric, and do not build to either C5 route on
  the strength of this file — the owner decides.
- **Do not** wire a reset to an unverified work email (invariant 15), or build step-up on a client
  timer (invariant 16).
- **Do not** ship E3 as if it were security — without the read rule the data is unchanged — and do
  not flip the front door and the rules in one step.
- **Do not** bundle client preparation into the rules change it prepares for; it soaks on its own.
- **Do not** enforce App Check in the same window as a rules cutover.
- **Do not** treat E6 as part of the rules work.
- **Do not** verify any of this from an installed phone.
