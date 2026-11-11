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
built), `AUTH_PLAN.md` (Track E, the app-wide read question) and `CREDENTIAL_LIFECYCLE.md` (how a
credential is issued, recovered and eventually retired — the ORDER those changes go in, and the one
open decision about what retiring the surname should mean).

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
| 1 | **The local session is committed only AFTER auth resolves.** Never before, never optimistically — a timeout, a throw or a sign-in that resolves with no named identity commits nothing. A failed attempt clears a session this device holds for ANOTHER member, and leaves one it already holds for the SAME member as it was. | `login-overlay.js` (`runNamedSignIn`, `keepsLocalSession`) |
| 2 | **A session expires 60 days after SIGN-IN, full stop.** Nothing extends it, inactivity never ends it early, so `expiry` is written once and `getSession()` is a pure read. **An `expiry` that cannot be read is treated as EXPIRED, never as absent** — a comparison against a missing or NaN value is false, so a corrupt session would otherwise never expire. | `session.js` |
| 3 | **Three claim tiers, and admin outranks manager.** `{admin, name, member}` · `{manager, name, member}` · `{name, member}` (plus `linksDesigner` for a designer) — all stamped by `setupRosterAuth` from the **server-owned** `roster-members.json`, never from the client payload. | `functions/auth-endpoints.js` |
| 4 | **Override writes are STRICT.** Your own verified name (`memberName()`, which is null unless `isMember()` — invariant 19), or `admin`/`manager` writing on behalf. The old "no `name` claim ⇒ allow" escape is gone and must not come back. | `firestore.rules` |
| 5 | **A stale claim self-heals; it never fails silently.** Force a token refresh, retry ONCE, and preserve the original error if it still fails. Every write path uses it. | `claim-retry.js` |
| 6 | **Client page-authorisation is UX only.** `requirePageAuth` decides what to SHOW. The rules are the boundary. A decision here is never a security control. | `auth-policy.js` |
| 7 | **The Calendar viewer holds no identity claims.** Not `name`, not `member`, not `admin`, not `manager`, not `linksDesigner` — the claim set is asserted to be exactly `{ calendarViewer: true }`, because a capability that quietly grew one would look like a working sign-in. | `functions/calendar-viewer-auth.js` · `calendar-viewer-auth.test.mjs` (`viewerClaims`) |
| 8 | **The viewer's persistence is session-only, and boot must not migrate it.** `setPersistence` moves the *current user* between stores, so signing the viewer out has to happen BEFORE restoring the member chain. | `calendar-access.js` · `firebase-client.js` (`authReady`) |
| 9 | **Anonymous grants nothing.** A rule written `request.auth != null` re-admits every visitor, because the Calendar used to sign them all in. Ask for a claim, never for a session — true of every read rule, and direct Storage reads are admin-only (members and PIN viewers open a document by its stored or signed URL). | `firestore.rules` · `storage.rules` |
| 10 | **The PIN is never compared on the client, and never enters the repository.** A client-side check turns a 10,000-space secret into an offline brute force; a committed copy makes rotation the only remedy. | `calendar-access-core.js` · `calendar-viewer-parity.test.mjs` |
| 11 | **The forced-password overlay fails OPEN, both before and after showing.** A mandatory overlay that cannot be satisfied is a lockout. | `password-force.js` |
| 12 | **Identity derivation exists three times and may not drift.** `normaliseSurname` and `nameToEmail` are duplicated across the ESM/CommonJS boundary, and `firestore.rules` carries a third copy of `nameToEmail` (`memberEmailFor`); a drifted email provisions an account that does not exist while "Set up accounts" reports success, and a drifted rules copy locks that member out. | `auth-identity.js` · `functions/roster-parse-helpers.js` · `firestore.rules` (`memberEmailFor`) · `surname-parity.test.mjs` · `firestore.rules.test.mjs` (whole-roster test) |
| 13 | **`initErrorReporter()` needs an auth context.** Called bare, every write is silently rejected by the rules — so the error log looks healthy because it is broken. Four canonical call sites (the Calendar, the `sessionReady` pages, the Pay Calculator, and the Trains page's PIN branch), and they differ because the pages establish identity differently. | `error-reporter.js` (header) |
| 14 | **Overtime has two audiences, and reviewing is not participating.** `isOvertimeReviewer` (admin/manager) sees everyone's declarations; a beta participant answers only for themselves. Never widen the first to make the nav pill work. Overtime is paused for everyone (`OVERTIME_AVAILABILITY.md` → Paused); the rule stands for its return. | `auth-policy.js` (`isOvertimeReviewer`/`canOpenOvertime`) · `roster-data.js` |
| 15 | **A saved work email is an ADDRESS, not a credential.** `staffContact.workEmail` is what somebody typed; nothing has shown that anyone can receive mail there. It may recover an account only after possession is proven and recorded server-side. Wiring "send a reset here" to an unverified address is account takeover by mistyping. | `CREDENTIAL_LIFECYCLE.md` §8 (design) · not yet built |
| 16 | **A step-up check is the SERVER reading `auth_time`.** A client that remembers when it last asked is an affordance, not a control — invariant 6, arriving by a second route. Fails closed: no `auth_time`, no elevated operation. | `CREDENTIAL_LIFECYCLE.md` §3 (design) · not yet built |
| 17 | **A local session is not an identity.** The session is a localStorage record this device wrote for itself; it buys nothing on the Calendar until Firebase has restored the identity behind it (`decideAccess` requires both). One scoped exception exists, governed by `CALENDAR_DATA.md` 17 rather than here: the member's OWN stored roster (`calendar-snapshot.js`), shown labelled before the grant and deleted on any disagreement. It grants no read, no write and no action, so a session still buys no AUTHORITY. | `calendar-access-core.js` (`decideAccess`) · `CALENDAR_DATA.md` 13 (retired) · `DECISIONS.md` → "The provisional paint" |
| 18 | **The staff PIN is a BARRIER, not authentication — and no surface may describe it as more.** One code for the whole station: unattributable (nothing records who used it), unrevocable per person (the only remedy for one leaver is rotating it for everyone), and it carries no identity, which is invariant 7 arriving from the other side. So the sign-in card comes FIRST and the PIN sits one tap behind it — an order, not a grant — and a browser holding a live local session is offered its own sign-in rather than the shared code. Copy that implies the PIN signs somebody in is wrong about the boundary, not merely loose. | `calendar-lock-cards.js` (`showLockPanel` / `showMemberPanel`) · `calendar-access.js` · OPERATIONS_REFERENCE.md |
| 19 | **A `name` is believed only from the member's own account.** Firebase fills a token's `name` from the account's DISPLAY NAME, which any session may set for itself — so a bare `name` proves nothing. It counts only on a PASSWORD sign-in whose email is the one that name derives to (`nameToEmail`), and only alongside `member`, a custom claim only the server sets (stamped by Set up accounts, which also takes back any account at a roster email it never stamped). One account per email makes that the real member. The PIN account carries no display name and has any it acquires cleared on every unlock (invariant 7 from the other side). An account registered from outside at any derived address — an invented name's, or a real member's before the server provisioned it — passes the email binding and still believes nothing (KNOWN_LIMITATIONS.md → "The member claim"). | `firestore.rules` (`isMember`/`memberName`) · `functions/member-identity.js` · `member-identity.test.mjs` · the rules suite's whole-roster test |
| 20 | **`calendarViewer` is believed only on the custom-token session the unlock mints, and the shared account stays a bare capability.** Every PIN holder signs in to ONE account, and any of them can link an email/password to it; a password sign-in would then carry the claim past every PIN rotation. So the rules and `getDocumentUrl` require `sign_in_provider == 'custom'` beside the claim; the unlock REBUILDS the account when it has an email, a phone, a linked provider or is disabled; and Set up accounts and the leaver sweep never adopt, stamp or disable it. | `firestore.rules` (`isCalendarViewer`) · `functions/doc-url-core.js` · `functions/calendar-viewer-auth.js` (`viewerAccountTamper`/`isViewerAccount`) · `index-endpoints.test.mjs` |
| 21 | **No write waits on an account that has gone.** A refused token refresh (after an admin reset, a password change on another device, or an account taken back) makes Firebase Auth sign the account out, and Firestore then never settles that account's pending commit: it keeps it for when the same member signs in again. So every `withClaimRetry` request stops waiting when the signed-in account changes and rejects with `SIGNED_OUT_CODE`. Every write surface reports it UNCONFIRMED, never failed or lost, because it may still send (`signedOutLine`). Admin, Settings, Operations, Links, Overtime, Trains and New link then offer their sign-in (`watchIdentityLoss`, through `page-session.js`'s `guardNamedSession`) — only when NOBODY is signed in and it has lasted, never because another account arrived: Firebase shares one account across a browser's tabs, and a colleague signing in from another tab is not a sign-out. | `claim-retry.js` (`abandonOnSignOut`, `watchIdentityLoss`) · `page-session.js` · `firebase-client.js` (`withClaimRetry`) · `claim-retry.test.mjs` · `e2e/admin.spec.js` (revoked mid-save) |
| 22 | **A write whose outcome is unknown is never treated as a write that failed.** Ending the wait does not cancel the write: Firestore keeps it for that account and may send it after the member signs back in. So every write surface reports it UNCONFIRMED; after one, the page refuses any new write until reload (`runGatedWrite`), because a retry that mints fresh ids writes a second copy; the roster import closes its review on it even on the first batch; a document upload goes through the same gate, keeps the sign-out as its own code (worded by `unconfirmedWriteLine`, never as a dropped connection) and keeps the new file; and the service worker does not reload the page while it stands — every page whose busy check guards work counts it, Admin, Settings and Operations through `writesInFlight`, Links through `hasUnconfirmedWrite`. | `claim-retry.js` (`runGatedWrite`) · `firebase-client.js` (`writeWithClaimRetry`, `guardCommit`, `savePushSubscription`) · `documents-client.js` · `doc-upload.js` · `doc-upload.test.mjs` (the upload, driven) · `slow-save.js` · `claim-retry.test.mjs` · `page-contract-parity.test.mjs` (the wiring, on every page) · `e2e/admin.spec.js` |
| 23 | **An admin reset signs other devices OUT, and they stay out.** A reset puts the password back to the surname default and revokes refresh tokens — and a device still holding the 60-day local session would re-sign itself in with that same surname on its next load, because the no-typed-password path tries exactly that. So a silent sign-in is refused, and the local session ended, when the session began before the server's `resetAt`. **The stamp lands first**: every path that puts an account back on its surname default — a reset, a take-back, a re-enable — writes `resetAt` before the password changes, and changes nothing if it cannot. **The check runs BEFORE the sign-in**: the SDK announces and stores a user the instant it signs in, so a check made afterwards lets the Calendar's late-identity watcher grant the device first, and a reload mid-check skips it. An unknown `resetAt` holds the silent sign-in but destroys nothing — it is treated like a sign-in that could not reach the server, which ends `TRANSIENT` (`terminalAuthEvent`), not `NONE`, so a write page keeps the 60-day session rather than clearing it. A TYPED sign-in is never refused by it. | `auth-identity.js` (`sessionPredatesReset`, `resetAtFromRestDoc`) · `session.js` (`ensureFirebaseSession`) · `firebase-client.js` (`probeResetAtMs`) · `functions/auth-endpoints.js` (`stampResetAt`) · `session.test.mjs` · `e2e/calendar-pin.spec.js` |
| 24 | **The staff PIN is kept only where the policy admits it: the Calendar, and Trains** (owner, 22 Oct 2026). `staffPin: true` in `PAGE_POLICIES` is the one list. A page on it asks `holdsStaffPin` BEFORE offering a sign-in and then runs with nobody signed in — no session, no password nudge, the drawer's Lock where a member has Sign out; every other protected page takes `reconcileExpiredIdentity`'s default and signs the PIN out on arrival, so it can never stand in for a member there (invariant 18). Trains qualifies because it shows nothing but the public timetable. A page holding anybody's own data does not, however convenient the station would find it. **The sign-out is never silent** (owner, 11 Nov 2026): that page's sign-in card says the roster is locked again, and its way back opens the Calendar on the PIN box. | `auth-policy.js` (`admitsStaffPin`) · `session.js` (`holdsStaffPin` / `signOutStaffPin`) · `staff-pin-ended.js` (`onStaffPinEnded`) · `login-overlay.js` (`sayStaffPinEnded`) · `page-contract-parity.test.mjs` · `e2e/calendar-pin.spec.js` |

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
when silence fails, and a late-identity watcher — never by sending a member to the staff PIN. See
`CALENDAR_DATA.md` invariant 11 and, for the order (silence before any sign-in surface), the boot path
in `calendar-access.js`.

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

`LOGIN_INCIDENT.md` — the login freeze. Resolved, but it records the diagnosis and the current flag
state, and invariant 1 exists because of it.
