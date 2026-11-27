# Authentication and sessions — the contract

*Not version-stamped; not a runtime asset. Who the app thinks you are, and what that entitles you to.*

Identity in this app is assembled from three things that can each be true without the others: a
**local session** (localStorage — who you told us you are), a **Firebase identity** (an account, in
IndexedDB), and a **claim** (what the server will let that identity write). Most of the defects in
this area have been a moment where two of the three disagreed.

**This is the authoritative contract for authentication and sessions.** Other documents link here
rather than restating participant, claim, session-lifetime or persistence rules. If you find those
rules written out somewhere else, that copy is the defect.

**The invariants state WHAT must hold; the module header beside the code says WHY**, where it cannot
drift from the thing it describes. Every row points at its home. The decisions that span several
modules and have no single header — the sign-in model, the passwords, the claim tiers, what the read
closure does and does not protect — are **"Why it is this way"**, below the architecture. Each is a
shipped design; the history of how it arrived is in git (this file absorbed `AUTH_PLAN.md`,
`PASSWORD_DESIGN.md`, `AUTH_ARCHITECTURE.md` and `CREDENTIAL_LIFECYCLE.md` on 26 November 2026).

**What is still to do is `SECURITY_RELEASE_PLAN.md`**: the canonical status of every security track,
and the design and order of the work not yet built — recovery codes (C6), email recovery
(C2), retiring the surname (C5, with its open owner decision), App Check (Track D) and the rest of
Track E. How the client reasons about identity is **Architecture**, below.

**Invariants 15 and 16 describe things that are not built.** They are here rather than only in the
plan because both are rules an implementation could plausibly skip and still appear to work: an
unverified address accepts a reset perfectly well, and a client-side step-up timer looks exactly
like a server-side one until somebody calls the endpoint directly.

**Numbers are permanent.** Other documents and code comments cite these rows by number, so a new
invariant is appended and a retired one is struck through in place, never renumbered.

---

## Invariants

| # | Invariant | Where it lives |
|---|---|---|
| 1 | **The local session is committed only AFTER auth resolves.** Never before, never optimistically — a timeout, a throw or a sign-in that resolves with no named identity commits nothing. A failed attempt clears a session this device holds for ANOTHER member, and leaves one it already holds for the SAME member as it was. | `login-core.js` (`runNamedSignIn`, its `keepsLocalSession` dependency; `SIGN_IN_GIVE_UP_MS`, when a typed attempt is ended) · `login-overlay.js` (re-exports it and supplies that dependency; `awaitLateSignIn`, which opens the page if an ended attempt's answer arrives late) |
| 2 | **A session expires 60 days after SIGN-IN — or, in the app INSTALLED on a phone, 60 days after it was last opened** (owner, 26 Nov 2026: the installed app is the personal phone). Inactivity never ends it early, and `getSession()` is a pure read: the one thing that extends a session is `renewInstalledSession`, only in the installed app, only once the member's OWN account is restored, at most once a day, never reviving one that has ended, and never moving its start (`createdAt`, which a reset is compared with — 23). **An `expiry` that cannot be read is treated as EXPIRED, never as absent** — a comparison against a missing or NaN value is false, so a corrupt session would otherwise never expire. | `session.js` |
| 3 | **Three claim tiers, and admin outranks manager.** `{admin, name, member}` · `{manager, name, member}` · `{name, member}` (plus `linksDesigner` for a designer; an "Other Staff" login is the third tier, its narrower page set a CLIENT policy, `otherStaff` in `auth-policy.js` — DECISIONS.md, 23 Nov 2026) — all stamped by `setupRosterAuth` from the **server-owned** `roster-members.json`, never from the client payload. **A tier taken away stops at once** (sign-in audit, Nov 2026): a run that removes admin, manager or `linksDesigner` revokes that account's sessions, so the Cloud Functions refuse the old tier immediately (`checkRevoked`), and the rules, which read the token itself, follow when it renews within the hour. Never for the same tier or a higher one: a revocation signs the member out of every device. | `functions/auth-endpoints.js` · `functions/account-lifecycle.js` (`elevatedClaimsLost`) |
| 4 | **Override writes are STRICT.** Your own verified name (`memberName()`, which is null unless `isMember()` — invariant 19), or `admin`/`manager` writing on behalf. The old "no `name` claim ⇒ allow" escape is gone and must not come back. | `firestore.rules` |
| 5 | **A stale claim self-heals; it never fails silently.** Force a token refresh, retry ONCE, and preserve the original error if it still fails. Every write path uses it. | `claim-retry.js` |
| 6 | **Client page-authorisation is UX only.** `requirePageAuth` decides what to SHOW. The rules are the boundary. A decision here is never a security control. | `auth-policy.js` |
| 7 | ~~**The Calendar viewer holds no identity claims.**~~ (struck in the staff PIN's server release, Nov 2026 — the endpoint that minted the claim is deleted). A leftover session on the shared account still carries only `calendarViewer`, and since the server release that claim grants nothing (invariant 20). | — |
| 8 | **A calendar-viewer session left on a device by the retired staff PIN is signed out, never granted — and boot must not migrate it.** Its next Calendar or Trains load ends it, and the sign-in card says the PIN has been retired. `setPersistence` moves the *current user* between stores, so signing the viewer out has to happen BEFORE restoring the member chain. A transition rule (23 Nov 2026): it retires in the cleanup release, once the `calendar-viewer` account is deleted (`DECISIONS.md` → "The staff PIN retired"). | `calendar-access.js` · `viewer-shed.js` (`shedCalendarViewer` — the sign-out before persistence is restored) · `firebase-client.js` (`authReady`) · `staff-pin-ended.js` |
| 9 | **Anonymous grants nothing.** A rule written `request.auth != null` re-admits every visitor, because the Calendar used to sign them all in. Ask for a claim, never for a session — true of every read rule, and direct Storage reads are admin-only (members open a document by its stored or signed URL). | `firestore.rules` · `storage.rules` · `rules-claim-gate.test.mjs` (every rule and rules function that tests for a session must also ask a claim, on every path) |
| 10 | ~~**The PIN is never compared on the client, and never enters the repository.**~~ (retired 23 Nov 2026 — the staff PIN was removed). Its value still never enters the repository, before or after the owner destroys the secret (`OPERATIONS_REFERENCE.md` → "The staff PIN (retired)"). | `calendar-viewer-parity.test.mjs` (Contract B) |
| 11 | **The forced-password overlay fails OPEN, both before and after showing.** A mandatory overlay that cannot be satisfied is a lockout. | `password-force.js` |
| 12 | **Identity derivation exists three times and may not drift.** The surname rule is spelled once on each side of the ESM/CommonJS boundary — `lettersOnly` in `auth-identity.js` for the browser, `surnameCore` in `functions/roster-parse-helpers.js` for the Functions — and `firestore.rules` carries a third copy of `nameToEmail` (`memberEmailFor`); a drifted email provisions an account that does not exist while "Set up accounts" reports success, and a drifted rules copy locks that member out. | `auth-identity.js` · `functions/roster-parse-helpers.js` · `firestore.rules` (`memberEmailFor`) · `surname-parity.test.mjs` · `firestore.rules.test.mjs` (whole-roster test) |
| 13 | **`initErrorReporter()` needs an auth context.** Called bare, every write is silently rejected by the rules — so the error log looks healthy because it is broken. Three canonical call sites (the Calendar, the `sessionReady` pages, and the Pay Calculator), and they differ because the pages establish identity differently. | `error-reporter.js` (header) |
| 14 | **Overtime has two audiences, and reviewing is not participating.** `isOvertimeReviewer` (admin/manager) sees everyone's declarations; a beta participant answers only for themselves. Never widen the first to make the nav pill work. Overtime is paused for everyone (`OVERTIME_AVAILABILITY.md` → Paused); the rule stands for its return. | `auth-policy.js` (`isOvertimeReviewer`/`canOpenOvertime`) · `roster-data.js` |
| 15 | **A saved work email is an ADDRESS, not a credential.** `staffContact.workEmail` is what somebody typed; nothing has shown that anyone can receive mail there. It may recover an account only after possession is proven and recorded server-side. Wiring "send a reset here" to an unverified address is account takeover by mistyping. | `SECURITY_RELEASE_PLAN.md` → C2 (design) · not yet built |
| 16 | **A step-up check is the SERVER reading `auth_time`.** A client that remembers when it last asked is an affordance, not a control — invariant 6, arriving by a second route. Fails closed: no `auth_time`, no elevated operation. | `SECURITY_RELEASE_PLAN.md` → F · declined (owner, 27 Nov 2026), so not built: the rule for a reopening |
| 17 | **A local session is not an identity.** The session is a localStorage record this device wrote for itself; it buys nothing on the Calendar until Firebase has restored the identity behind it (`decideAccess` requires both). One scoped exception exists, governed by `CALENDAR_DATA.md` 17 rather than here: the member's OWN stored roster (`calendar-snapshot.js`), shown labelled before the grant and deleted on any disagreement. It grants no read, no write and no action, so a session still buys no AUTHORITY. | `calendar-access-core.js` (`decideAccess`) · `CALENDAR_DATA.md` 13 (retired) · `DECISIONS.md` → "The provisional paint" |
| 18 | ~~**The staff PIN is a BARRIER, not authentication — and no surface may describe it as more.**~~ (retired 23 Nov 2026 — the staff PIN was removed). Its argument (one code for the whole station, unattributable and unrevocable per person) is why it went: `DECISIONS.md` → "The staff PIN retired". | — |
| 19 | **A `name` is believed only from the member's own account.** Firebase fills a token's `name` from the account's DISPLAY NAME, which any session may set for itself — so a bare `name` proves nothing. It counts only on a PASSWORD sign-in whose email is the one that name derives to (`nameToEmail`), and only alongside `member`, a custom claim only the server sets (stamped by Set up accounts, which also takes back any account at a roster email it never stamped). One account per email makes that the real member. The shared `calendar-viewer` account (the retired staff PIN's, deleted by the owner after the server release) was created with no display name and had any it acquired cleared on every unlock; it carries no `member` claim, so it fails this however it is named. An account registered from outside at any derived address — an invented name's, or a real member's before the server provisioned it — passes the email binding and still believes nothing (KNOWN_LIMITATIONS.md → "The member claim"). | `firestore.rules` (`isMember`/`memberName`) · `functions/member-identity.js` · `member-identity.test.mjs` · the rules suite's whole-roster test |
| 20 | **`calendarViewer` is believed on no session at all, and the server never adopts the shared account.** (Rewritten in the staff PIN's server release, Nov 2026: until then the claim was believed on the unlock's custom-token session only.) The rules and `getDocumentUrl` grant the claim nothing, however the session signed in. Until the owner deletes the `calendar-viewer` account a session left open on it can still link an email/password to it, so Set up accounts, the leaver sweep, a reset, the audit and the targeted notices never adopt, stamp, reset, disable or address it. Retires in the cleanup release, with the account. | `firestore.rules` · `functions/doc-url-core.js` · `functions/retired-viewer-account.js` (`isViewerAccount`) · `firestore.rules.test.mjs` · `doc-url-core.test.mjs` · `calendar-viewer-parity.test.mjs` |
| 21 | **No write waits on an account that has gone.** A refused token refresh (after an admin reset, a password change on another device, or an account taken back) makes Firebase Auth sign the account out, and Firestore then never settles that account's pending batched commit: it keeps it for when the same member signs in again. (A transaction — every online save since v25.90 — is never kept: it commits or fails. But its answer can be lost just the same, so it is reported the same way.) So every `withClaimRetry` request stops waiting when the signed-in account changes while an attempt is on its way, and rejects with `SIGNED_OUT_CODE` — but only then: the stale-claim token refresh between two attempts sends nothing, so a write the rules have already REFUSED stays that refusal when the refresh is refused too and signs the account out (`runWatchedClaimRetry`, review 17 Nov 2026) — and when ANOTHER account was signed in during the refresh, no retry is sent as it: the refusal stands (`currentUid`, 17 Nov 2026). Every write surface reports `SIGNED_OUT_CODE` UNCONFIRMED, never failed or lost, because it may still send (`signedOutLine`). Admin, Settings, Operations, Links, Overtime, Trains and New link then offer their sign-in (`watchIdentityLoss`, through `page-session.js`'s `guardNamedSession`) — only when NOBODY is signed in and it has lasted, never because another account arrived: Firebase shares one account across a browser's tabs, and a colleague signing in from another tab is not a sign-out. | `claim-retry.js` (`abandonOnSignOut`, `runWatchedClaimRetry`, `watchIdentityLoss`) · `page-session.js` · `firebase-client.js` (`withClaimRetry`) · `claim-retry.test.mjs` · `firebase-client.test.mjs` (a refused write whose refresh is refused; an account switched during the refresh) · `e2e/admin-saves.spec.js` (revoked mid-save) · `e2e/signed-in.spec.js` (a renewal the real Auth emulator refuses, mid-save) |
| 22 | **A write whose outcome is unknown is never treated as a write that failed.** Ending the wait does not cancel the write: Firestore keeps a batched write for that account and may send it after the member signs back in, and a transaction may have committed before its answer was lost. So every write surface reports it UNCONFIRMED; after one, the page refuses any new write until reload (`runGatedWrite`), because a retry that mints fresh ids writes a second copy; the roster import closes its review on it even on the first batch; a document upload goes through the same gate, keeps the sign-out as its own code (worded by `unconfirmedWriteLine`, never as a dropped connection) and keeps the new file; and the service worker does not reload the page while it stands — every page whose busy check guards work counts it, Admin, Settings and Operations through `writesInFlight`, Links through `hasUnconfirmedWrite`. | `claim-retry.js` (`runGatedWrite`) · `firebase-client.js` (`writeWithClaimRetry`, `guardCommit`, `savePushSubscription`) · `documents-client.js` · `doc-upload.js` · `doc-upload.test.mjs` (the upload, driven) · `slow-save.js` · `claim-retry.test.mjs` · `page-contract-parity.test.mjs` (the wiring, on every page) · `e2e/admin-saves.spec.js` |
| 23 | **An admin reset signs every device OUT, and they stay out.** A reset puts the password back to the surname default and revokes refresh tokens — and a device still holding the 60-day local session would re-sign itself in with that same surname on its next load, because the no-typed-password path tries exactly that. So a silent sign-in is refused, and the local session ended, when the session began before the server's `resetAt`. **The stamp lands first**: every path that puts an account on its surname default — a reset, a take-back, a re-enable, and a NEW account, which Set up accounts stamps before creating it — writes `resetAt` before the password changes, and changes nothing if it cannot. **On an admin reset, a password write the service REFUSED puts the stamp back** (only while the record is as that stamp left it); one whose outcome is UNKNOWN keeps it, the safe direction — a stale stamp costs one typed sign-in, a missing one would let an old device back in with the surname. Set up accounts never puts its stamp back: a new account, take-back or re-enable that fails keeps it, in the same direction. **The check runs BEFORE the sign-in**: the SDK announces and stores a user the instant it signs in, so a check made afterwards lets the Calendar's late-identity watcher grant the device first, and a reload mid-check skips it. An unknown `resetAt` holds the silent sign-in but destroys nothing — it is treated like a sign-in that could not reach the server, which ends `TRANSIENT` (`terminalAuthEvent`), not `NONE`, so a write page keeps the 60-day session rather than clearing it. A TYPED sign-in is never refused by it. | `auth-identity.js` (`sessionPredatesReset`, `resetAtFromRestDoc`) · `session.js` (`ensureFirebaseSession`) · `firebase-client.js` (`probeResetAtMs`) · `functions/auth-endpoints.js` (`stampResetAt`, `restoreResetAt`) · `functions/account-lifecycle.js` (`passwordWriteRefused`) · `session.test.mjs` · `e2e/signed-in.spec.js` (a real reset, the phone opened again) · `e2e/calendar*.spec.js` (the Calendar's access spec) |
| 24 | ~~**The staff PIN is kept only where the policy admits it: the Calendar, and Trains.**~~ (retired 23 Nov 2026 — the staff PIN was removed). No page admits it; every page that needs a sign-in asks for a named one. A PIN session still on a device is signed out on arrival (invariant 8). | — |

---

**The one owner decision that sat on this boundary** — whether a returning member's cached roster
may be painted before Firebase has confirmed the stored account — was answered yes and later retired
by the owner, so a local session means nothing on its own (invariant 17). The record, the measurement
and what would reopen it: `DECISIONS.md` → "The provisional paint" and `LATENCY.md`.

---

## The three states, and what each one is for

```
local session        localStorage   who you said you are, and until when
  └─ session.js          getSession / saveSession / clearSession

Firebase identity    IndexedDB      an account the server recognises
  └─ session.js          ensureFirebaseSession / ensureNamedSession
  └─ firebase-client.js  authReady — the persistence chain, viewer-aware

claim                the JWT        what that identity may write
  └─ functions/auth-endpoints.js   setupRosterAuth stamps it
  └─ claim-retry.js                refresh-and-retry when it is stale
```

**A member can hold the first without the second two.** That is not an error state — it happens on a
slow restore, and on iPhones when the identity's IndexedDB read fails (not, as this said until 7 Nov
2026, Safari's seven-day rule, which deletes the session too — KNOWN_LIMITATIONS → "One interaction to
expect on iOS"). The Calendar's
access gate handles it with a silent re-establishment behind the boot skeleton, a sign-in card only
when silence fails, and a late-identity watcher. See
`CALENDAR_DATA.md` invariant 11 and, for the order (silence before any sign-in surface), the boot path
in `calendar-access.js`.

---

## Architecture — two pure layers over one thin shell

**The client decides what to ATTEMPT and what to RENDER; the server decides what is ALLOWED**
(invariant 6). Everything below — the state machine, the policy map, claim-aware retries, optimistic
reads — is UX and optimisation. A stale client token that claims `admin` after the server revoked it
yields `permission-denied` (→ refresh and retry once, invariant 5), never access, which is why no
client refactor can weaken security and why optimistic reads are safe.

### Layer 1 — the identity state machine (authentication) — pure

`reduceAuthState(prev, event) → next` in `auth-state-core.js`: no DOM, no Firebase, no localStorage,
no redirects. Every result is a new frozen object; an unknown event is inert. States are **identity
facts only**:

| State | Meaning |
|-------|---------|
| `initialising` | nothing checked yet |
| `resolving` | local session present; Firebase identity being restored or established |
| `named` | the correct named Firebase user confirmed |
| `anonymous` | kept in the reducer, with no producer — nothing signs in anonymously (invariant 9) |
| `signedOut` | no valid local session, no identity |
| `degraded` | a sign-in that never reached an answer (retryable) |
| `error` | a non-recoverable auth or session problem |

`needsLogin` and `forbidden` are deliberately **not** identity states — the same `named` user is
forbidden on Operations and allowed on Admin. They are policy outcomes, Layer 2.

### Layer 2 — the page-auth policy (authorisation) — pure

`requirePageAuth(snapshot, policy, roles) → { decision, reason }` in `auth-policy.js`, driven by the
declarative `PAGE_POLICIES` map, the single home for each page's rule (who may open it, whether it is
soft, whether an Other Staff login may read it). **Read the map, not a copy of it**
— a page table here went stale within weeks. Decisions are `allow` / `soft-allow` / `login` /
`forbidden` / `pending`; `requirePage(snapshot, page)` fails closed on an unknown page. Policy keys
can later grow `page → page.action` without touching the reducer, because granularity lives entirely
in this layer; do not build action-level policy until something needs it.

The Pay Calculator is **soft** and its no-local-session → sign-in gate sits deliberately OUTSIDE the
policy: it needs a local member identity to namespace localStorage (`.claude/rules/paycalc.md`
invariant 3).

### The store — `auth-state.js`, fed by `session.js`

`getAuthSnapshot` / `subscribeAuth` / `dispatchAuth` over the reducer, importing only
`auth-state-core.js` (acyclic: `session.js → auth-state.js → auth-state-core.js`). The existing
`session.js` is the adapter and FEEDS the store — `ensureNamedSession` dispatches
`RESOLVE_START → (TRANSIENT/RETRY) → NAMED/NONE`, `clearSession` dispatches `SIGN_OUT` — rather than
a second shell re-wrapping Firebase. A page reads the snapshot when its own session settles; nothing
in production subscribes. **`sessionReady` is driven by the same `ensureNamedSession` resolution** as
the store, so the two cannot diverge, and re-routing it through the machine was declined as risk for
no benefit. **Not a state framework:** the machine owns identity only — never page, form, roster or
Pay Calculator state.

### Degraded never grants authority

`degraded` must never become a privilege loophole ("Firebase is degraded, so carry on because the
local session says admin"). **Degraded may only preserve local or cached read-only UX.** A sign-in
that never reached an answer is `TRANSIENT`, so the store stays `degraded` and the policy answers
`pending`; the page keeps the 60-day local session and shows the sign-in over it (`guardNamedSession`,
`page-session.js`). If the identity lands late the page reloads into it — at most once per
`LATE_RELOAD_GAP_MS`, and never on a tab with no storage to remember the last one
(`lateReloadAllowed` → `'no-memory'`), where the card offers Try again instead. Nothing can be written
meanwhile: every write needs a claim the rules accept (invariant 9). The store does not collapse to
`signedOut` here, which would clear the session of a member whose network merely stalled.

| Page / action | Degraded behaviour |
|---------------|--------------------|
| Calendar read | the cached display, once access is granted |
| Pay Calculator | local calculator use |
| Settings read | the local view; **cloud save blocked** |
| Admin / Operations / Links | a clear degraded or blocked state |
| Override write or delete, roster upload, document upload, account setup, link-design save | **blocked** |

### Reads hydrate optimistically; writes authorise strictly

- **Reads** may proceed once there is a Firebase user, even while `resolving`; a `permission-denied`
  goes through `withClaimRetry` (`firebase-client.js`, over `runWithClaimRetry` in `claim-retry.js`):
  one forced token refresh, one retry.
- **Writes** wait for a confirmed `named` identity with fresh-enough claims.
- **A local session alone is never sufficient for a privileged cloud write** (invariant 17).

The rule is restated as a load-bearing comment at the head of `auth-policy.js`, so it cannot be
quietly weakened there.

### The page shell — an exported `init()` and a two-line boot

Every protected page's body is an exported `init()` in its `*-app.js`, called by a two-line
`*-boot.js`. CSP `script-src 'self'` forbids an inline module script, and keeping the call out of the
coordinator lets a test `import { init }` without the page running itself. A boot file holds no logic.

### In-place sign-in — no reload after a confirmed sign-in

The shared login overlay signs a member in over the page, and the coordinator then initialises in
place (`onSuccess`, the continuation inside `startPage`, `page-start.js`). **The safety net is a
reload**: if `init()`/`initAuthorised()` throws, or the session save failed, the page reloads rather
than running half-initialised (`e2e/auth.spec.js`, the no-reload tests). Removing the duplicate
post-login `ensureNamedSession` was scoped and deliberately not built (`DECISIONS.md` → "What
ROADMAP_HISTORY.md held that still binds").

### Guardrails for an auth change

- Do not combine an auth refactor with a rules cutover: refactor first, behaviour change later.
- Do not change who may open which page inside a refactor.
- Do not build a general app-wide state store; the machine owns identity only.
- Keep `sessionReady`, and keep the server as the security boundary.

---

## Why it is this way — the design decisions

Shipped decisions that span several modules, each with the reason that stops it being undone. Code
comments cite these by heading (`AUTH_AND_SESSIONS.md` → "The gated dual-attempt"). Work not yet
built is `SECURITY_RELEASE_PLAN.md`, never here.

### The gated dual-attempt

The typed password is the real credential. `credentialCandidatesFor` (`auth-identity.js`) writes the
candidate rule once, for sign-in (`ensureNamedSession(name, { password })` → `ensureFirebaseSession`)
and for the Settings reauthentication alike:

1. **The raw typed value**, trimmed of outer whitespace and otherwise un-normalised — a chosen
   password has case, digits and symbols.
2. **The derived padded surname — ONLY IF the typed value normalises to the member's surname.** The
   gate is load-bearing: an ungated fallback would sign anybody typing anything into an un-migrated
   account. Gated, it covers only capitals ("Miller") and the padding of a surname under six letters
   ("bibi" → "bibibi"), which grants nothing the surname does not already grant. When the two are the
   same string they are one attempt.
3. **When the gate opens, the surname goes FIRST** (v26.12). Behind an open gate the raw value can be
   the password only if it IS the default, because `validateNewPassword` refuses a chosen password
   that spells the surname — so raw-first sent a request that could never succeed and logged a wrong
   password at Google on every such sign-in. What can sign in is unchanged; only the order moved, and
   `auth-identity.test.mjs` ties the order to the refusal.
4. **Both fail → the wrong-password error**, never anything weaker.

The second attempt fires only after a fast, definitive rejection of the first — never after a
timeout — so the ladder stays inside `runNamedSignIn`'s 30-second budget (`SIGN_IN_GIVE_UP_MS`, `login-core.js`). The App Speed card's
**Signing in** figure (`loginTotal`) carried the doomed first attempt until v26.12; the reading
before the change is `LATENCY.md` → THE NOVEMBER READ.

### A credential rejection never falls back

Every failure — a definitive `auth/wrong-password` / `auth/invalid-credential`, or anything else —
resolves to identity `'none'` and a sign-in prompt. When this was designed an anonymous fallback
still existed for network failures; had it caught a credential rejection, the member would have held
a silent anonymous session whose every write the strict rules deny — the v10.94 outage class. The
fallback has since gone altogether (v24.34, invariant 9); rollback is reverting a release.

### Re-establishing on page load

`ensureFirebaseSession` also runs on every load for a returning member, with no typed password:

- **Firebase restores its own session** (the common case) — no password is needed.
- **Evicted, un-migrated** — the automatic surname attempt runs (automated re-authentication of an
  existing session, not somebody at a keyboard), except: REFUSED when this device's session began
  before the account's last `resetAt` (invariant 23), HELD when that time cannot be confirmed, and
  SKIPPED after a definitive rejection on this device. Skipped, not abandoned: a flagged device asks
  again every six hours (`RESET_RECHECK_MS`, `silent-sign-in.js`) through the reset check (`probeResetAtMs`).
- **Evicted, migrated** — cannot be re-authenticated silently, ever, so the sign-in shows again. That
  is the honest cost of a real password, not a bug. On the Pay Calculator (soft) the roster pre-fill
  quietly does not load.

### Sign-in error copy

With email-enumeration protection a failure arrives as `auth/invalid-credential`, indistinguishable
from "no account", so one message covers both and promises neither a reset nor set-up — "ask the
admin" (`login-overlay.js` holds the words). `auth/too-many-requests` has its own message and is never
retried; the client's three-strikes, 30-second lockout counts returned failures only. **The hint is
static**: a per-member hint would need a Firestore read on the sign-in path, which the login freeze
forbids.

### The login freeze

The freeze of v14.72–v14.75 is why invariant 1 exists. The sign-in contract: a bounded
`withTimeout` (`SIGN_IN_GIVE_UP_MS`, 30 seconds; at 8 the card only says the attempt is taking longer); `saveSession` only after auth resolves; a visible, disabled "Signing in…" button; the
`_attempting` mutex, the `_signingIn` back-guard and the `_authGen` stale-attempt guard. **No
Firestore read, and no slow await, on the critical path from sign-in to a usable page** — the
must-set-password check runs fire-and-forget after sign-in with a short cap, the pattern
`password-force.js` follows. `login-core.js`'s header has the rest.

### Chosen passwords

The security gain is that each member's credential becomes something only they know; the recovery
route (the admin reset, today) is swappable. **No new custom claim, so no `CLAIM_EPOCH` bump**:
migration state lives in Firestore, not in tokens.

- **The Settings Password card**: current password, new password twice, reauthenticate,
  `updatePassword` — through `reauthenticateWithPassword` and `changeOwnPassword` (`own-password.js`,
  every Firebase handle injected; re-exported by `firebase-client.js`). Both refuse before anything is
  sent unless the signed-in account is the page member's own (`myb/account-mismatch`).
- **`validateNewPassword`** (`auth-identity.js`): at least 8 characters (`MIN_PASSWORD_LENGTH`;
  Firebase's floor is 6); **a password that normalises to the surname is refused**, or "migrated"
  would be a lie; typed twice; outer whitespace trimmed on set AND on sign-in (an iOS keyboard's
  trailing space is a real lockout); `autocomplete="current-password"` / `"new-password"`.
- **`passwordSetAt` is written only after `updatePassword` resolves.**
- **A timed-out password write is INDETERMINATE, not failed** — `Promise.race` stops waiting, it does
  not cancel. A state-changing call never uses a timeout that reports failure: `settleOrTimeout`
  (`own-password.js`, with `withTimeout` the one implementation of the deadline helpers) answers
  `ok` / `failed` / `pending`, and on `pending` the page says the result is unconfirmed and to try
  the new password first, and keeps Save disabled. A revealed password is re-masked after a save.
- **Not verified** (no live Firebase): whether a change on one device signs the member's other
  devices out. The copy is right either way; confirm it before writing anything more specific.

### The forced password overlay

`password-force.js` compels a member still on the surname default to choose a password at their
**next sign-in, or their next open of the app** — on every page where a member signs in, the Calendar
included, behind the `CONFIG.FORCE_PASSWORD_SET` kill switch. It asked only at a sign-in until the
installed app stopped running out (invariant 2), and the owner's condition for that change was "you
should still be made to reset the surname password" (26 Nov 2026). On an ordinary open the current
password is asked for from the start, since Firebase changes a password only after a recent sign-in;
a member this device has seen the server confirm on their own password is not asked again, so the
check costs a read only for those still on the surname. **Nobody is signed out to hurry it** (owner,
25 Jul 2026).

- It shows only for a `named` identity whose status is not migrated (`!isPasswordMigrated`), and
  **fails open before and after showing** (invariant 11; "Continue for now" stamps nothing).
- **A reset does not compel.** For an un-migrated member a reset rewrites the password to the
  surname it already is, so migrated status is false before and after: the overlay is the whole
  mechanism, and gates on `isPasswordMigrated`, never on `resetAt` being present.
- The e2e suite defaults the flag OFF (`forcePasswordSet(page)` opts in); the browser tests assert
  VISIBILITY, not text, because two CSS defects once hid parts of it while the text was right.
- Accepted: the compel marker is consumed before the identity is known, so a member whose session
  does not settle in time loses that sign-in's cycle; their next open asks again.

### The admin reset (break-glass)

> **Interim — superseded in design by C6** (`SECURITY_RELEASE_PLAN.md` → C6), and live until C6
> ships, because break-glass may not have a gap. Its flaw, named where a reader meets it: it makes
> the surname a valid credential again, at the moment the account is least attended.

`resetMemberPassword` (`functions/auth-endpoints.js`):

- **Admin-only** — managers cannot reset; account administration is master-admin territory, like the
  documents, the roster and Set up accounts. The target is checked against the server-owned
  `activeMembers`, never taken from the request.
- **Stamps `passwordStatus.resetAt` FIRST**, and a stamp it cannot write stops the reset — 503,
  nothing changed (invariant 23).
- **A password write that throws is REFUSED or UNKNOWN** (`passwordWriteRefused`,
  `functions/account-lifecycle.js`). Only a short allowlist of codes proves nothing changed: then the
  stamp is put back (`restoreResetAt`) and the answer is a 4xx. Anything else may have landed, so the
  stamp stays and the answer is a 500 saying so, and that resetting again is safe.
- **Every reset signs every device out** (the `revoke` flag was retired on 10 Nov 2026) and tells the
  member on their own devices, never naming the password — **except when the admin ticks "Their phone
  is lost or stolen"**: then nothing is sent, because it would land on that phone, and every push
  record the account owns is deleted. The password is still the surname afterwards, so Operations
  asks the admin to have them sign in elsewhere promptly. Every word the Reset says is
  `operations-reset.js`.
- **Nothing else overwrites a chosen password.** `setupRosterAuth` sets one only when it creates an
  account (stamping `resetAt` first, so a recreated account never inherits an old `passwordSetAt`)
  and otherwise only enables and disables — with two take-backs, each stamped first: an account at a
  roster email carrying no custom claims (registered from outside) is reset, renamed, enabled and
  signed out; and a disabled leaver's account is reset before it is re-enabled, so a returning name
  never inherits an old password (`mustReclaim`, `functions/member-identity.js`).
- **It is a one-way door.** Once members had chosen passwords, a hosting revert to code that derives
  the surname would lock them out, so the passwords are forward-fix only. The fallback is to reset a
  migrated member back to the surname, and the server-side reset survives a hosting revert — a
  deliberate property of putting it on the server.

### Password migration status

`passwordStatus/{memberName}` (its fields: `DATA_MODEL.md`). `resetAt` is written by the Admin SDK
alone; `passwordSetAt` by the member's own client.

- **Migrated** ⇔ `passwordSetAt` present AND not older than `resetAt` (`isPasswordMigrated`,
  `auth-identity.js`, the one tested source); no document means not migrated.
- **The rules**: read by the owner or the admin; a member may touch only `passwordSetAt`, pinned to
  `request.time`, so a wrong device clock cannot fake the order against the server's `resetAt`;
  never deleted.
- **Accepted**: `passwordSetAt` is client-written, so a member could mark themselves migrated while
  staying on the surname — no worse than before, a compliance gap rather than an escalation. Routing
  the change through a Function would gain nothing real.
- Operations' **Account status** card (Email ✓/✗ · Password ✓/✗, "N/M own password" per grade) is
  the rollout's dashboard and C5's metric. **Read the C5 figure off `passwordStatus`**, never off a
  `staffContact.verified` field — none exists.

### The reset-request queue

"Can't get in?" on the sign-in card → `requestPasswordReset` → the admin's **Password Reset
Requests** card and a targeted push. A doorbell, not a recovery mechanism.

- **A Cloud Function**, because the person who needs it has no Firebase identity. The alternatives —
  an anonymous session on the protected pages, or a collection clients may write — were both worse;
  `resetRequests` refuses every client write.
- **It never resets a password.** An unauthenticated caller who could put a member back on the
  surname would undo their migration and sign them out everywhere. The admin performs the reset: the
  human authenticates the ACTION.
- **Bounding a public endpoint**: the document id is the member name, so the collection can never
  exceed the roster (flooding is impossible by construction, not by rate limit); the name must be in
  the server-owned `activeMembers`, which also makes it safe to render; no free text is stored;
  `shouldRecordResetRequest` throttles repeats and fails OPEN on a junk timestamp (never stop
  somebody asking); `maxInstances: 3`; every roster name gets the same answer (the roster is already
  public in the sign-in list). `provisioned` tells the admin whether to Reset or run Set up accounts.
- **The link is always visible** under Sign in: a request resets nothing, so a spurious one costs a
  row the admin clears, while a hidden link costs a member their access.
- **Accepted, not fixed: a request proves nothing about who sent it.** A reviewer filed valid
  requests for every member from Node in under a second; acting on one puts a member back on the
  surname and signs them out — a downgrade attack with the admin as proxy. The card and its Tips say
  requests are unverified and to confirm with the member first. **Treat the queue as a notification,
  never as evidence** — `count` included — and a request is not proof of urgency. The real fix is
  App Check (Track D), or a server token only a genuine credential failure can obtain.
- **`CONFIG.PASSWORD_RESET_REQUESTS` only hides the link.** The endpoint's own switch is
  `RESET_REQUESTS_ENABLED` in `functions/auth-endpoints.js` (a 503) — a constant, because an incident
  switch must not depend on a read the incident might affect.
- **`maxInstances: 3` bounds cost, not rate**: about 240 requests can be in flight, so a flood can
  make Cloud Run refuse real ones — the only in-app recovery route. Accepted.
- **CORS is not a boundary here**: `cors: ADMIN_FUNCTION_ORIGINS` sets headers and calls `next()`
  whatever the Origin, and a non-browser caller sends none.
- **The admin's push is targeted, never a broadcast** (`sendTargetedPush`; "N. Surname asked for a
  reset" sent to every device tells the team who is locked out). It fails closed — no resolved
  target, an unowned subscription, no owner-stamped match: send nothing, and there is no
  fall-back-to-everyone branch. It can never fail the request (wrapped, swallowed, time-boxed); it
  fires only on a RECORDED request, at most one per five minutes (`shouldNotifyAdmin`); its headline
  states the queue depth, because one stable tag replaces the last (`buildResetRequestNotice`); its
  deep link (`operations.html#reset-requests`) only ever opens the card.
- **Rules the reviews left**: every network wait inside a request handler is time-boxed (a try/catch
  survives only a rejection); a page stylesheet never reaches into the shared login overlay
  (`e2e/auth.spec.js` holds its geometry equal on every page); sign-in statistics count only accounts
  on the roster (`summariseSignIns` takes an allowlist, and an empty one counts nothing); queue-card
  refreshes are queued, never dropped; a stale `provisioned: false` can last the ten-minute throttle
  window. Firebase's own `sendPasswordResetEmail` cannot stand in: the accounts are synthetic
  `@myb-roster.local` addresses that receive no mail.

### The claim tiers

Invariant 3 states the tiers; this is what each may write, and why. Any rule that thinks only in
"owner versus admin" silently locks out the middle tier.

| Tier | Source list | What they legitimately write |
|---|---|---|
| Master admin | `CONFIG.ADMIN_NAMES` | Everything — overrides for any member, the three documents, the roster upload, account set-up |
| Management | `CONFIG.MANAGER_NAMES` | Overrides (leave, absence, shifts) **on behalf of any member** — not the master-admin uploads or set-up |
| Staff | everyone else | Only their **own** overrides (`memberName()`, invariant 19) |
| *Links designer* | `CONFIG.LINKS_DESIGNERS` | `linkDesigns` — cross-cuts the others; a designer may be a CEA |

- **The `manager` bypass is load-bearing** — managers book leave, absence and shifts on behalf every
  day — and so is `admin` (on-behalf bookings, every `source: 'roster_import'` row). **Never grant
  managers `admin: true`**: it reaches the master-admin-only collections the tier exists to deny. A
  manager's token carries `manager` only after Set up accounts and a token refresh.
- **`linkDesigns` is not member-isolated** — designs are keyed by design name. Its write gate is
  `linksDesigner` or `admin` (H2); its read gate is a verified member or `admin` — one notch, not two,
  because requiring `linksDesigner` to READ would remove the load path a stale designer token needs
  before its first write can self-heal.
- **The server-owned lists carry all three tiers** (`functions/roster-members.json`, generated from
  `roster-data.js` — B4), so a tampered client payload cannot promote itself. Count tiers from that
  file: managers carry `hidden: true`, so the visible sign-in list reads lower.
- **The risk sits in the privileged accounts**: a guessed staff password reaches only that member's
  own overrides; an admin's or a manager's reaches everybody's.

### Write isolation (B0–B3)

- **B0** — `ensureFirebaseSession` reports whether it established the member's NAMED account
  (`getFirebaseIdentity()` → `'named' | 'none'`, `firebaseSessionIsNamed()`,
  `getFirebaseAuthError()`; `session.test.mjs`). The pages now read the store through `requirePage`.
- **B1** — the write pages stop accepting a claim-less session, and the client never creates an
  account itself. **Enforcement matches what a page writes**: `PAGE_POLICIES` (`auth-policy.js`) is
  the live authority; the Pay Calculator is soft because it writes only non-isolated counters and
  must work offline. Every active member needs a server account from Operations → Set up accounts
  (`/new-starter` makes it the step before a first sign-in). A session that cannot be re-established
  branches on `getFirebaseAuthError()`: a transient failure retries, then offers Retry and keeps the
  local session; a persistent one (`invalid-credential`, `user-not-found`) sends the member to the
  admin.
- **B2** — per-member `overrides` isolation, and the `manager` claim.
- **B3 (v16.29)** — the strict cutover: the `!('name' in token)` escape removed from `overrides`
  create, update and delete, shipped with the `CLAIM_EPOCH` sweep and the `writeWithClaimRetry`
  self-heal, so there was no lockout and no mass sign-out.
  - **`writeWithClaimRetry`** (`firebase-client.js`) retries exactly once, only on
    `permission-denied` with a live `auth.currentUser`, after a forced `getIdToken(true)`; any other
    error, or a second denial, is re-thrown. Writes are re-runnable thunks, because a `WriteBatch`
    cannot be committed twice. Invariants 5, 21 and 22 govern it now.
  - **`CLAIM_EPOCH` is armed to 3** (2 was the strict cutover's sweep, 3 the `member` claim's):
    `refreshClaimsIfStale()` in `session.js`, gated by `myb_claim_epoch`, refreshes every device's
    token once. **Do not bump it unless deliberately forcing a fresh sweep.**
  - **Rollback: never re-add the `!('name' in request.auth.token)` escape, and never revert
    `overrides` to `request.auth != null`** — Anonymous sign-in is still enabled in the project, so
    either re-admits anonymous writes to every member's record. A lockout after a claims change is a
    CLAIM problem: run Set up accounts, then let tokens refresh. A bad rules deploy rolls back only
    to the immediately previous version — **never past v24.23**, the member-claim binding (v24.23
    believes a `name` only on a password sign-in at its derived email, v24.24 stamps `member`, v24.27
    requires it).
- **Retired switches.** The B1 kill switch (`CONFIG.ENFORCE_NAMED_SESSION`) and the Calendar's
  `CALENDAR_PIN_ACCESS` went at v24.34 (owner-approved), with every branch that ran only when one was
  false: once the rules refused the sessions they restored, flipping one would have produced silently
  failing saves — traps, not brakes. Rollback is reverting a release.
- **A5 — push subscriptions are per owner**: `savePushSubscription` stamps `owner =
  auth.currentUser.uid`; delete needs a matching `owner` or none at all (legacy documents stay
  deletable so a VAPID rotation can clean up; `fanOutPush`'s 410/404 sweep removes orphans); create and
  update need `owner == request.auth.uid` when present, and update re-checks the EXISTING owner, so a
  session cannot take over another device's subscription by stamping its own uid.

### Shipping a rule that needs a claim

Almost every security change here shares one failure: **a write silently fails because the session
is not the identity the rule expects.** It took the app down at v10.94, and it is invisible from an
installed phone.

1. **Migrate, don't cut over.** A rule that newly requires a claim ships permissive, accepting old
   and new sessions, and tightens after a forced token sweep.
2. **Deploy order**: the function first → re-provision (Set up accounts) → then the strict rule.
   `writeWithClaimRetry` can heal only a claim that already exists on the server; the rules in the
   repository being right is necessary, not sufficient.
3. **Never two silent-failure cutovers at once.** An isolation rollout and App Check enforcement
   both fail as "writes silently rejected"; overlap them and nobody can tell which locked a member
   out.
4. **Keep infrastructure out of an authorisation release** (the deploy identity, the Functions
   dependencies) — different failure domains, and bundling only widens the blast radius.
5. **A tightened READ rule ships client-first** (`RECOVERY_RUNBOOK.md` → "Tightening a read rule");
   a rule that accepts a new field ships rules-first (CLAUDE.md → Workflows).
6. **Verify on the live URLs in a fresh private window**, across every role and a deliberately
   unprovisioned account — never from an installed phone.

### What "behind authentication" can mean

The phrase bundles three problems, and only one of them is enforcement:

| Layer | Can it go behind a sign-in? | What does it |
|---|---|---|
| **Data** — Firestore reads | **Yes, server-enforced** — the only real control | the read rules (`isMember()` or `admin`) |
| **Files** — Storage documents | **Not by any rules change** — members open a stored bearer URL or a short-lived signed one, neither of which the rules see | the delivery model ("The document files (E6)") |
| **Shell** — HTML, CSS, JS | **No** — static files on public hosting; a client gate is UX, never security | `auth-policy.js` (invariant 6) |

- **A sign-in in front of the Calendar buys nothing by itself**; without the read rule every byte
  would still be fetchable over REST. **"The entire app behind authentication" is not achievable** on
  static hosting: say "all data behind a named session, plus a client gate so the UI matches".
- **No read rule may admit an anonymous session.** The Firebase config ships in the client, so
  anybody can make one; a rule asking only for *a* session is no barrier.
- **Firestore ORs every matching `allow`.** A broad rule above a tightened one keeps the data open; a
  tightening is not done while any broader rule still matches.
- **The exposure closed is outsider-with-URL, not colleague-to-colleague.** The member selector lets
  any member see any colleague's roster and leave, by design.
- Open reads (`allow read;`) today: none — every read rule asks for a claim. The read closure has
  been in force since 26 Aug 2026; since the staff PIN was retired (23 Nov 2026) every reader signs in
  by name.

### Public by decision: the base roster

**The shipped JavaScript carries the base roster, and that is a deliberate classification** (owner,
4 Sep 2026 — external review). With no session, anyone can read `roster-member-data.js` — every named
member with their roster type and cycle position, plus join dates, pro-rated leave entitlements,
scheduled roster moves and bilingual contracts, where a member carries them — and
`roster-cycle-data.js`, the patterns those index into: enough to compute any named member's shift for
any date. **The owner's decision is that this is not confidential**: shift patterns are printed on
the station's own rosters and shared freely. It is not an `EXC-*` row, because deployed and intended
agree.

- **The read closure protects the CHANGES to the roster, not the roster.** `overrides` (leave,
  absence, shift changes) is closed; the base shift beneath every unchanged day is public.
- **A field added to `teamMembers` is published the moment it ships.**
  `public-data-classification.test.mjs` holds an allowlist with a reason per field, so the decision is
  made in the open; anything that should not be public belongs in Firestore behind a claim, as
  `staffContact` is. A pattern is public; a payslip is not (`payroll-anonymity.test.mjs`).

### Search engines excluded (E0)

`X-Robots-Tag: noindex, nofollow` on Firebase Hosting, and a mirrored `<meta name="robots">` in every
served page, because the Pages mirror serves no headers and a `robots.txt` cannot reach it (honoured
only at an origin root; the mirror lives under `/roster-app/`). `robots.txt` deliberately **permits**
crawling: a crawler blocked from fetching can never read the noindex. Guarded by
`sw-asset-check.test.mjs`.

### The two-phase load (E1)

**Client preparation, NOT a security boundary** — it changed no rule and must never be cited as
protection. It shipped alone, before any rules change, so the later rules change was only a rules
change. Four paths had read with whatever auth happened to exist: the Calendar's three-month
`overrides` read (`calendar-initial-fetch.js`), the `#huddle` viewer (`calendar-huddle-viewer.js`),
the Circular and Newsletter viewer (`calendar-doc-viewer.js`) and the drawer (`nav-panel.js`).

- **No user-facing path may await auth without a deadline, and every failure state needs a control,
  not just text.** The first cut awaited auth plainly and each path became a dead end — a
  notification tap on "Loading…" for ever, a drawer tap stalling, a retry chip stuck on
  "Retrying…". Each now waits a bounded moment, then reads anyway and fails into something retryable.
- **The render path must not wait at all**, because the data is already cached: paint from the
  cache at once, then refresh authoritatively once access is granted.
  1. `reconcileRangeIntoCache` takes an `authoritative` flag (`override-utils.js`). A cache snapshot
     is a possibly stale subset, so it merges additively and evicts nothing — **the load-bearing
     detail**: two authoritative reconcilers racing on one range is how the staler snapshot once
     wiped the Team View back to the base roster.
  2. `fetchOverridesForRangeFromCache` (`calendar-overrides.js`) reads with `getDocsFromCache` and
     never sets the error chip: a cache miss is normal.
  3. `initInitialFetch` fires the cache read at once, then awaits the grant for the server read.
  4. A generation guard (the first load's attempt tickets, `standing` in `calendar-initial-fetch.js`)
     stops a slow cache read overwriting a server read that already landed.
  5. The sync chip tracks the server read only.
- **The tap paths**: the Huddle subscription attaches only once a session exists, with its 8-second
  safety timeout started on invocation, because an `onSnapshot` that hits `permission-denied` is
  terminated, not retried; the document viewer awaits auth inside `openDoc()`; the drawer takes an
  `authReady` option (`calendarAuthReady` on the Calendar, `sessionReady` elsewhere). The viewers also
  wait on `calendar-doc-access.js` (`CALENDAR_DATA.md` 15).
- **Guarded in `npm test`**: `calendar-initial-fetch.test.mjs` injects an auth promise that never
  resolves and asserts the cache read still paints; `override-utils.test.mjs` holds the additive and
  authoritative modes apart.

### The local cache does not ask the rules

**Demonstrated, not assumed** (`experiments/firestore-offline-proof/`, against the emulator and the
production SDK in a real Chromium with a real IndexedDB cache): cached `overrides` survive a reload, a
browser restart, a rules tightening and the loss of the network, in any combination, while the
server read of the same query is refused. A listener under denied rules emits the cached snapshot
first and only then errors, and **a denied listen does not evict the cache**. Two limits: it ran on
the emulator, so it is strong evidence rather than proof of production; and after a browser restart
a cache read can return nothing, with no error, for two to three seconds (measured in a container).

So **closing a read rule protects the devices that had not already cached the data, and nothing
else** — which is what `calendar-overrides.js`'s own access gate exists for. And the 60-day expiry is
this app's own construct (`SESSION_MS`), not Firebase's: an offline member with a lapsed session
would be locked out by our overlay, not by Firebase — a design problem, not a constraint
(`SECURITY_RELEASE_PLAN.md` → E4).

### The document files (E6)

`storage.rules` admits only the admin to direct Storage reads. Members open the permanent tokenised
`storageUrl` stored in Firestore, or a short-lived signed URL from `getDocumentUrl`, and **both bypass
the rules entirely**: anyone who ever held a permanent one keeps access until the object is deleted or
rewritten.

- **Retention bounds a leak**: both sweeps DELETE the Storage object — Huddles at 3 months
  (`pruneOldHuddles`, `functions/huddle-retention.js`), Circulars and Newsletters at 6 months
  (`pruneOldDocs`, `doc-retention.js`). Three gaps remain: the Circular and Newsletter sweep runs
  after an UPLOAD, not on a schedule; it refuses to run on a client clock with no server time; and a
  partial prune ORPHANS the object (Firestore first, then Storage, because the reverse leaves a broken
  link), still serving its bearer URL, permanently.
- **A third party fetches these documents.** A Word document opens through Microsoft's Office Online
  viewer (`officeViewerUrl`, `storage-utils.js`), which fetches it server-side, so an authenticated
  `getBlob` would break `.docx` viewing outright, and "the documents are behind authentication" cannot
  be claimed while this path exists.
- **Decided 19 Sep 2026 (owner): the Office viewer stays and is handed a 15-minute signed link.**
  `getDocumentUrl` (`functions/documents.js`; the rules in `functions/doc-url-core.js`) signs a read URL
  for the latest document of a named KIND. **Converting `.docx` to HTML was refused**: a Circular is a
  designed document, and flattening it through Mammoth degrades what staff read. **Requiring PDF was
  refused**: the documents arrive as `.docx`, so it would be a manual export on every weekly issue, for
  ever. **This does NOT remove Microsoft** — the window bounds this app's leak, not any copy Microsoft
  keeps. The stored permanent link stays as the fallback (owner, 7 Oct 2026 — `DECISIONS.md`).
- **Deploy prerequisite**: signing needs `roles/iam.serviceAccountTokenCreator` on the runtime
  service account, granted to ITSELF (`RECOVERY_RUNBOOK.md` → 5b). Without it every call answers 503,
  which the client treats as "use the stored URL" — a silent degrade, not a dead button.
- **Rotation is built** (Operations → Document links, `rotateDocumentLinks`, rules in
  `functions/doc-link-rotation.js`, 12 Nov 2026): rewriting the objects turns "whoever ever held a
  URL" into "whoever held one since", and it is the only thing that reaches an orphaned object. Its
  first run is the owner's (`ARCHITECTURE.md` EXC-007).
- **The documents are behind the sign-in** (owner, 7 Sep 2026: the Daily Huddle, the Weekly Retail
  Circular and the Marylebone Newsletter must not be visible without signing in). The viewers open on
  the full grant only and refuse the read at source, so the local cache cannot answer it
  (`calendar-doc-access.js`); a tap made while locked is HELD and finished when access arrives. The
  client shipped before the rules (client v23.17, rules v23.18).
- **A notification cannot be broken by any rule change**: `fanOutPush` builds it with the Admin SDK,
  and nothing on the way to the lock screen reads Firestore or asks for auth.
- **The ordering lesson**: gating the document READS alone protected nothing, because the bearer URL
  is the control — the roster was the more sensitive surface, and closing it first was the right
  order.

---

## Dependencies

```
Any protected page
 ├─ login-overlay.js     the sign-in surface and its core
 ├─ session.js           local session + the Firebase identity chain
 ├─ auth-state.js        the observable identity store (auth-state-core.js holds the reducer)
 ├─ auth-policy.js       page × status × role → what to SHOW
 ├─ password-force.js    the one post-login overlay
 └─ claim-retry.js       every write, wrapped
```

Changing any of these changes **every page at once** — every page that needs a sign-in, and the
Calendar — see CLAUDE.md → *Change impact*.

---

## Read this first

The login freeze (v14.72–v14.75) — resolved, and invariant 1 exists because of it: its lessons are
"The login freeze", above, and `login-core.js`'s header.
