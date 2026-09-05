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
track status is `SECURITY_RELEASE_PLAN.md`. Design lives in `PASSWORD_PLAN.md` (credentials as
built), `AUTH_PLAN.md` (Track E, the app-wide read question) and `CREDENTIAL_LIFECYCLE.md` (how a
credential is issued, recovered and eventually retired — the ORDER those changes go in, and the one
open decision about what retiring the surname should mean).

**Invariants 15 and 16 describe things that are not built.** They are here rather than only in the
plan because both are rules an implementation could plausibly skip and still appear to work: an
unverified address accepts a reset perfectly well, and a client-side step-up timer looks exactly
like a server-side one until somebody calls the endpoint directly.

---

## Invariants

| # | Invariant | Where it lives |
|---|---|---|
| 1 | **The local session is committed only AFTER auth resolves.** Never before, never optimistically — a timeout, a throw or a failed enforcement must leave nothing saved. | `login-overlay.js` (`runNamedSignIn`) |
| 2 | **A session expires 60 days after SIGN-IN, full stop.** Nothing extends it, inactivity never ends it early, so `expiry` is written once and `getSession()` is a pure read. **An `expiry` that cannot be read is treated as EXPIRED, never as absent** (v22.43): `Date.now() > undefined` is false and so is every NaN comparison, so a corrupt or hand-edited session used to pass the check and then never expire — switching off the only automatic revocation the app has. | `session.js` |
| 3 | **Three claim tiers, and admin outranks manager.** `{admin, name}` · `{manager, name}` · `{name}` — all stamped by `setupRosterAuth` from the **server-owned** `roster-members.json`, never from the client payload. | `functions/auth-endpoints.js` |
| 4 | **Override writes are STRICT.** Your own `name` claim, or `admin`/`manager` writing on behalf. The old "no `name` claim ⇒ allow" escape is gone and must not come back. | `firestore.rules` |
| 5 | **A stale claim self-heals; it never fails silently.** Force a token refresh, retry ONCE, and preserve the original error if it still fails. Every write path uses it. | `claim-retry.js` |
| 6 | **Client page-authorisation is UX only.** `requirePageAuth` decides what to SHOW. The rules are the boundary. A decision here is never a security control. | `auth-policy.js` |
| 7 | **The Calendar viewer holds no identity claims.** Not `name`, not `admin`, not `manager`, not `linksDesigner` — each asserted by name, because a capability that quietly grew one would look like a working sign-in. | `functions/calendar-viewer-auth.js` · `calendar-viewer-parity.test.mjs` |
| 8 | **The viewer's persistence is session-only, and boot must not migrate it.** `setPersistence` moves the *current user* between stores, so signing the viewer out has to happen BEFORE restoring the member chain. | `calendar-access.js` · `firebase-client.js` (`authReady`) |
| 9 | **Anonymous grants nothing.** A rule written `request.auth != null` re-admits every visitor, because the Calendar used to sign them all in. Ask for a claim, never for a session. True of `overrides` reads since 26 Aug 2026, when the `allow read;` hold line was deleted. | `firestore.rules` |
| 10 | **The PIN is never compared on the client, and never enters the repository.** A client-side check turns a 10,000-space secret into an offline brute force; a committed copy makes rotation the only remedy. | `calendar-access-core.js` · `calendar-viewer-parity.test.mjs` |
| 11 | **The forced-password overlay fails OPEN, both before and after showing.** A mandatory overlay that cannot be satisfied is a lockout. | `password-force.js` |
| 12 | **Identity derivation exists twice and may not drift.** `normaliseSurname` and `nameToEmail` are duplicated across the ESM/CommonJS boundary; a drifted email provisions an account that does not exist while "Set up accounts" reports success. | `auth-identity.js` · `functions/roster-parse-helpers.js` · `surname-parity.test.mjs` |
| 13 | **`initErrorReporter()` needs an auth context.** Called bare, every write is silently rejected by the rules — so the error log looks healthy because it is broken. Three canonical call sites. | CLAUDE.md → architecture decisions |
| 14 | **Overtime has two audiences, and reviewing is not participating.** `isOvertimeReviewer` (admin/manager) sees everyone's declarations; a beta participant answers only for themselves. Never widen the first to make the nav pill work. | `auth-policy.js` (`isOvertimeReviewer`/`canOpenOvertime`) · `roster-data.js` |
| 15 | **A saved work email is an ADDRESS, not a credential.** `staffContact.workEmail` is what somebody typed; nothing has shown that anyone can receive mail there. It may recover an account only after possession is proven and recorded server-side. Wiring "send a reset here" to an unverified address is account takeover by mistyping. | `CREDENTIAL_LIFECYCLE.md` §8 (design) · not yet built |
| 16 | **A step-up check is the SERVER reading `auth_time`.** A client that remembers when it last asked is an affordance, not a control — invariant 6, arriving by a second route. Fails closed: no `auth_time`, no elevated operation. | `CREDENTIAL_LIFECYCLE.md` §3 (design) · not yet built |
| 17 | **A local session is not an identity, and a provisional paint is not a grant.** The session is a localStorage record this device wrote for itself. It may buy a member ONE thing while Firebase revalidates them — a scoped re-show of override data this device already received while genuinely authorised — and nothing else: no server read, no write, no other member, and `calendarAccessReady` stays pending throughout. | `calendar-access-core.js` (`decideProvisionalAccess`) · `CALENDAR_DATA.md` 13 |

---

**The decision that sat on this boundary was ANSWERED on 5 Sep 2026, and invariant 17 is the
answer.** Restoring a saved identity costs a network round trip — Firebase validates the stored user
against the server before emitting it, on every boot, which is how a disabled account stops being
restored. That round trip is the measured cause of the Calendar's start-latency wall, and the only
way off it was to trust the local session for one paint. The owner's ruling is that a returning
member may be re-shown **their own already authorised cached roster** while it completes.

**It was this contract's question, not the performance plan's**, and the answer is a statement about
how much a local session is allowed to mean: exactly one thing, scoped to one member, for the length
of one revalidation. Never for the shared PIN viewer, which holds no identity to re-show. The whole
pre-decision write-up is preserved in `ROADMAP_HISTORY.md`; the measurement is in `LATENCY_PLAN.md`;
what shipped is `calendar-access-core.js` → `decideProvisionalAccess`.

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
slow restore and after iOS ITP evicts IndexedDB (~7 days, against a 60-day session). The Calendar's
access gate handles it with a silent re-establishment behind the boot skeleton, a sign-in card only
when silence fails, and a late-identity watcher — never by sending a member to the staff PIN. See
`CALENDAR_DATA.md` invariant 11 and, for the order (silence before any sign-in surface, v21.62),
the boot path in `calendar-access.js`.

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

Changing any of these changes **all six protected pages at once** — see CLAUDE.md → *Change impact*.

---

## Read this first

`LOGIN_INCIDENT.md` — the v14.72–74 login freeze. Resolved, but it records the diagnosis and the
current flag state, and invariant 1 exists because of it.
