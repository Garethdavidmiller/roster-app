# Authentication and sessions — the contract

*Not version-stamped; not a runtime asset. Who the app thinks you are, and what that entitles you to.*

Identity in this app is assembled from three things that can each be true without the others: a
**local session** (localStorage — who you told us you are), a **Firebase identity** (an account, in
IndexedDB), and a **claim** (what the server will let that identity write). Most of the defects in
this area have been a moment where two of the three disagreed.

**This is the authoritative contract for authentication and sessions.** Other documents link here
rather than restating participant, claim, session-lifetime or persistence rules. If you find those
rules written out somewhere else, that copy is the defect.

**This file states WHAT must hold. It does not explain WHY** — that lives in the module header beside
the code, where it cannot drift from the thing it describes. Every row points at its home.

For the plan-level view — what is shipped, what is sequenced, what is still undecided — the canonical
track status is `SECURITY_RELEASE_PLAN.md`. Design lives in `PASSWORD_DESIGN.md` (credentials as
built, and — since 24 Nov 2026, when `CREDENTIAL_LIFECYCLE.md` was merged into it — the C5/C6
programme: how a credential is issued, recovered and eventually retired, the ORDER those changes go
in, and the one open decision about what retiring the surname should mean) and `AUTH_PLAN.md`
(Track E, the app-wide read question). How the client reasons about identity is **Architecture**,
below.

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
| 2 | **A session expires 60 days after SIGN-IN, full stop.** Nothing extends it, inactivity never ends it early, so `expiry` is written once and `getSession()` is a pure read. **An `expiry` that cannot be read is treated as EXPIRED, never as absent** — a comparison against a missing or NaN value is false, so a corrupt session would otherwise never expire. | `session.js` |
| 3 | **Three claim tiers, and admin outranks manager.** `{admin, name, member}` · `{manager, name, member}` · `{name, member}` (plus `linksDesigner` for a designer; an "Other Staff" login is the third tier, its narrower page set a CLIENT policy, `otherStaff` in `auth-policy.js` — DECISIONS.md, 23 Nov 2026) — all stamped by `setupRosterAuth` from the **server-owned** `roster-members.json`, never from the client payload. **A tier taken away stops at once** (sign-in audit, Nov 2026): a run that removes admin, manager or `linksDesigner` revokes that account's sessions, so the Cloud Functions refuse the old tier immediately (`checkRevoked`), and the rules, which read the token itself, follow when it renews within the hour. Never for the same tier or a higher one: a revocation signs the member out of every device. | `functions/auth-endpoints.js` · `functions/account-lifecycle.js` (`elevatedClaimsLost`) |
| 4 | **Override writes are STRICT.** Your own verified name (`memberName()`, which is null unless `isMember()` — invariant 19), or `admin`/`manager` writing on behalf. The old "no `name` claim ⇒ allow" escape is gone and must not come back. | `firestore.rules` |
| 5 | **A stale claim self-heals; it never fails silently.** Force a token refresh, retry ONCE, and preserve the original error if it still fails. Every write path uses it. | `claim-retry.js` |
| 6 | **Client page-authorisation is UX only.** `requirePageAuth` decides what to SHOW. The rules are the boundary. A decision here is never a security control. | `auth-policy.js` |
| 7 | **The Calendar viewer holds no identity claims.** Not `name`, not `member`, not `admin`, not `manager`, not `linksDesigner` — the claim set is asserted to be exactly `{ calendarViewer: true }`, because a capability that quietly grew one would look like a working sign-in. **Server-side only, and retiring:** no screen has asked for the PIN since the client release that retired it (23 Nov 2026), but the endpoint that mints this claim stays deployed until the server release, and this holds until then — strike it in that release. | `functions/calendar-viewer-auth.js` · `calendar-viewer-auth.test.mjs` (`viewerClaims`) |
| 8 | **A calendar-viewer session left on a device by the retired staff PIN is signed out, never granted — and boot must not migrate it.** Its next Calendar or Trains load ends it, and the sign-in card says the PIN has been retired. `setPersistence` moves the *current user* between stores, so signing the viewer out has to happen BEFORE restoring the member chain. A transition rule (23 Nov 2026): it retires in the cleanup release, once the `calendar-viewer` account is deleted (`DECISIONS.md` → "The staff PIN retired"). | `calendar-access.js` · `viewer-shed.js` (`shedCalendarViewer` — the sign-out before persistence is restored) · `firebase-client.js` (`authReady`) · `staff-pin-ended.js` |
| 9 | **Anonymous grants nothing.** A rule written `request.auth != null` re-admits every visitor, because the Calendar used to sign them all in. Ask for a claim, never for a session — true of every read rule, and direct Storage reads are admin-only (members open a document by its stored or signed URL). | `firestore.rules` · `storage.rules` · `rules-claim-gate.test.mjs` (every rule and rules function that tests for a session must also ask a claim, on every path) |
| 10 | ~~**The PIN is never compared on the client, and never enters the repository.**~~ (retired 23 Nov 2026 — the staff PIN was removed). Until the secret is destroyed after the server release, its value still never enters the repository (`OPERATIONS_REFERENCE.md` → "The staff PIN (retired)"). | — |
| 11 | **The forced-password overlay fails OPEN, both before and after showing.** A mandatory overlay that cannot be satisfied is a lockout. | `password-force.js` |
| 12 | **Identity derivation exists three times and may not drift.** The surname rule is spelled once on each side of the ESM/CommonJS boundary — `lettersOnly` in `auth-identity.js` for the browser, `surnameCore` in `functions/roster-parse-helpers.js` for the Functions — and `firestore.rules` carries a third copy of `nameToEmail` (`memberEmailFor`); a drifted email provisions an account that does not exist while "Set up accounts" reports success, and a drifted rules copy locks that member out. | `auth-identity.js` · `functions/roster-parse-helpers.js` · `firestore.rules` (`memberEmailFor`) · `surname-parity.test.mjs` · `firestore.rules.test.mjs` (whole-roster test) |
| 13 | **`initErrorReporter()` needs an auth context.** Called bare, every write is silently rejected by the rules — so the error log looks healthy because it is broken. Three canonical call sites (the Calendar, the `sessionReady` pages, and the Pay Calculator), and they differ because the pages establish identity differently. | `error-reporter.js` (header) |
| 14 | **Overtime has two audiences, and reviewing is not participating.** `isOvertimeReviewer` (admin/manager) sees everyone's declarations; a beta participant answers only for themselves. Never widen the first to make the nav pill work. Overtime is paused for everyone (`OVERTIME_AVAILABILITY.md` → Paused); the rule stands for its return. | `auth-policy.js` (`isOvertimeReviewer`/`canOpenOvertime`) · `roster-data.js` |
| 15 | **A saved work email is an ADDRESS, not a credential.** `staffContact.workEmail` is what somebody typed; nothing has shown that anyone can receive mail there. It may recover an account only after possession is proven and recorded server-side. Wiring "send a reset here" to an unverified address is account takeover by mistyping. | `PASSWORD_DESIGN.md` → credential lifecycle L8 (design) · not yet built |
| 16 | **A step-up check is the SERVER reading `auth_time`.** A client that remembers when it last asked is an affordance, not a control — invariant 6, arriving by a second route. Fails closed: no `auth_time`, no elevated operation. | `PASSWORD_DESIGN.md` → credential lifecycle L3 (design) · not yet built |
| 17 | **A local session is not an identity.** The session is a localStorage record this device wrote for itself; it buys nothing on the Calendar until Firebase has restored the identity behind it (`decideAccess` requires both). One scoped exception exists, governed by `CALENDAR_DATA.md` 17 rather than here: the member's OWN stored roster (`calendar-snapshot.js`), shown labelled before the grant and deleted on any disagreement. It grants no read, no write and no action, so a session still buys no AUTHORITY. | `calendar-access-core.js` (`decideAccess`) · `CALENDAR_DATA.md` 13 (retired) · `DECISIONS.md` → "The provisional paint" |
| 18 | ~~**The staff PIN is a BARRIER, not authentication — and no surface may describe it as more.**~~ (retired 23 Nov 2026 — the staff PIN was removed). Its argument (one code for the whole station, unattributable and unrevocable per person) is why it went: `DECISIONS.md` → "The staff PIN retired". | — |
| 19 | **A `name` is believed only from the member's own account.** Firebase fills a token's `name` from the account's DISPLAY NAME, which any session may set for itself — so a bare `name` proves nothing. It counts only on a PASSWORD sign-in whose email is the one that name derives to (`nameToEmail`), and only alongside `member`, a custom claim only the server sets (stamped by Set up accounts, which also takes back any account at a roster email it never stamped). One account per email makes that the real member. The shared `calendar-viewer` account (the retired staff PIN's, deleted after the server release) carries no display name and has any it acquires cleared on every unlock (invariant 7 from the other side). An account registered from outside at any derived address — an invented name's, or a real member's before the server provisioned it — passes the email binding and still believes nothing (KNOWN_LIMITATIONS.md → "The member claim"). | `firestore.rules` (`isMember`/`memberName`) · `functions/member-identity.js` · `member-identity.test.mjs` · the rules suite's whole-roster test |
| 20 | **`calendarViewer` is believed only on the custom-token session the unlock mints, and the shared account stays a bare capability.** Server-side, and retiring with invariant 7: it holds while `isCalendarViewer` and the unlock are deployed, and is struck in the server release. Every PIN holder signs in to ONE account, and any of them can link an email/password to it; a password sign-in would then carry the claim past every PIN rotation. So the rules and `getDocumentUrl` require `sign_in_provider == 'custom'` beside the claim; the unlock REBUILDS the account when it has an email, a phone, a linked provider or is disabled; and Set up accounts and the leaver sweep never adopt, stamp or disable it. | `firestore.rules` (`isCalendarViewer`) · `functions/doc-url-core.js` · `functions/calendar-viewer-auth.js` (`viewerAccountTamper`/`isViewerAccount`) · `index-endpoints.test.mjs` |
| 21 | **No write waits on an account that has gone.** A refused token refresh (after an admin reset, a password change on another device, or an account taken back) makes Firebase Auth sign the account out, and Firestore then never settles that account's pending batched commit: it keeps it for when the same member signs in again. (A transaction — every online save since v25.90 — is never kept: it commits or fails. But its answer can be lost just the same, so it is reported the same way.) So every `withClaimRetry` request stops waiting when the signed-in account changes while an attempt is on its way, and rejects with `SIGNED_OUT_CODE` — but only then: the stale-claim token refresh between two attempts sends nothing, so a write the rules have already REFUSED stays that refusal when the refresh is refused too and signs the account out (`runWatchedClaimRetry`, review 17 Nov 2026) — and when ANOTHER account was signed in during the refresh, no retry is sent as it: the refusal stands (`currentUid`, 17 Nov 2026). Every write surface reports `SIGNED_OUT_CODE` UNCONFIRMED, never failed or lost, because it may still send (`signedOutLine`). Admin, Settings, Operations, Links, Overtime, Trains and New link then offer their sign-in (`watchIdentityLoss`, through `page-session.js`'s `guardNamedSession`) — only when NOBODY is signed in and it has lasted, never because another account arrived: Firebase shares one account across a browser's tabs, and a colleague signing in from another tab is not a sign-out. | `claim-retry.js` (`abandonOnSignOut`, `runWatchedClaimRetry`, `watchIdentityLoss`) · `page-session.js` · `firebase-client.js` (`withClaimRetry`) · `claim-retry.test.mjs` · `firebase-client.test.mjs` (a refused write whose refresh is refused; an account switched during the refresh) · `e2e/admin.spec.js` (revoked mid-save) · `e2e/signed-in.spec.js` (a renewal the real Auth emulator refuses, mid-save) |
| 22 | **A write whose outcome is unknown is never treated as a write that failed.** Ending the wait does not cancel the write: Firestore keeps a batched write for that account and may send it after the member signs back in, and a transaction may have committed before its answer was lost. So every write surface reports it UNCONFIRMED; after one, the page refuses any new write until reload (`runGatedWrite`), because a retry that mints fresh ids writes a second copy; the roster import closes its review on it even on the first batch; a document upload goes through the same gate, keeps the sign-out as its own code (worded by `unconfirmedWriteLine`, never as a dropped connection) and keeps the new file; and the service worker does not reload the page while it stands — every page whose busy check guards work counts it, Admin, Settings and Operations through `writesInFlight`, Links through `hasUnconfirmedWrite`. | `claim-retry.js` (`runGatedWrite`) · `firebase-client.js` (`writeWithClaimRetry`, `guardCommit`, `savePushSubscription`) · `documents-client.js` · `doc-upload.js` · `doc-upload.test.mjs` (the upload, driven) · `slow-save.js` · `claim-retry.test.mjs` · `page-contract-parity.test.mjs` (the wiring, on every page) · `e2e/admin.spec.js` |
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

*Moved here from `AUTH_ARCHITECTURE.md` (24 Nov 2026), which is now a pointer. Code comments still
cite that file by Phase number; what each phase built is `ROADMAP_HISTORY.md` → "Track 1 — the auth
consolidation phases".*

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

### Guardrails for an auth change

- Do not combine an auth refactor with a rules cutover: refactor first, behaviour change later.
- Do not change who may open which page inside a refactor.
- Do not build a general app-wide state store; the machine owns identity only.
- Keep `sessionReady`, and keep the server as the security boundary.

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

`ROADMAP_HISTORY.md` → "The login freeze" — resolved, but it records the diagnosis, and invariant 1
exists because of it.
