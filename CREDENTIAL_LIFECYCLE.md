# The credential lifecycle

*Not version-stamped; not a runtime asset. How a member GETS a credential, how they get a new one
when they lose it, and how the surname stops being either.*

**Status lives in `SECURITY_RELEASE_PLAN.md`'s canonical track table** — this file owns DESIGN and
ORDER, and states no stage. **The invariants live in `AUTH_AND_SESSIONS.md`** — this file argues
for them; that file is what an edit must not break. Password mechanics (the dual-attempt sign-in,
the forced overlay, the reset queue, the passkey survey) are `PASSWORD_PLAN.md`'s and are pointed
at here, never restated.

---

## Why this file exists

The plumbing is finished and it is good: a 60-day session with a single written expiry, strict
claim-based write isolation, chosen passwords with a forced migration, an admin reset queue, and a
staff PIN that keeps the roster off the open internet without pretending to be individual
authentication. None of that needs redesigning.

What is left is the **credential lifecycle**, and it was scattered — the reset mechanism in
`PASSWORD_PLAN.md` §5, the email half as a deferred row in the status table, passkeys in a survey
section that deliberately carries no schedule, the read question in `AUTH_PLAN.md`, and the
identity round trip in `LATENCY_PLAN.md`. Each is described well where it sits. **The order was
written down nowhere**, and the order is the whole argument: several of these unblock each other,
and one of them changes what a different track is waiting for.

Same reason `MAINTENANCE_CALENDAR.md` exists. A fact that lives only inside a document you open for
another purpose is a fact nobody acts on.

---

## The programme, in order

Each row's *unblocks* column is the reason it sits where it does. Nothing here is scheduled; the
owner decides what is worth doing and when.

| # | Change | Why now | Unblocks |
|---|---|---|---|
| 1 | **C6 — one-time recovery/activation codes** (§1) | The single biggest remaining weakness. Recovery currently makes the surname valid again, so the migration's own repair mechanism undoes the migration | The C5 decision (§7); new-starter activation without a seeded surname |
| 2 | **Keep converting personal devices** (§2) | Machinery all exists; it is a campaign, not a build | Moves the migration figure toward whatever C5 ends up needing |
| 3 | **F — step-up for sensitive admin actions** (§3) | A 60-day admin session is the right trade for ordinary work and the wrong one for account administration | Nothing. Independent, cheap, and the only item here with no prerequisite |
| 4 | **Keep both kinds of Calendar access** (§4) | Not a change — a decision to record, because "make named sign-in mandatory" keeps suggesting itself | — |
| 5 | **C5 — retire the surname entirely** (§7) | The milestone. Two possible routes, and which one is taken is an **open owner decision** | Removes a whole credential class from the threat model |
| 6 | **Retire the anonymous fallback** (§5) | Migration machinery that has outlived its migration is debt | Fewer identity states, so fewer future auth races |
| 7 | **Calendar start latency, IF the field data confirms it** (§6) | Already instrumented and deliberately not yet acted on | — |
| 8 | **C2 — verified work-email recovery** (§8) | Needs a mail relay that does not exist, and needs #1 first so it is a SECOND route rather than the only one | Admin reset becomes true break-glass |
| 9 | **Passkeys** (§9) | Excellent fit, blocked on serving from one origin | — |
| — | **Entra / Microsoft SSO** (§10) | Only if Chiltern formally adopts the app | Supersedes most of this file |

---

## 1 · C6 — one-time recovery and activation codes

**Supersedes C4′** (admin reset as the recovery path, shipped v18.63) as the recovery mechanism.
C4′ stays in the tree until C6 is live, because break-glass may not have a gap.

### The problem, stated plainly

Track C moved staff from a surname password to one they chose. When a member forgets the one they
chose, the remedy is `resetMemberPassword`, which sets their credential **back to their surname**
until they pick another. That was the right interim mechanism — it reused `nameToPassword`, needed
no new secret-handling, and was strictly no worse than the state everyone was already in.

It is the wrong permanent one, and the reason is not subtle: **the repair mechanism for the
migration re-creates the exact condition the migration exists to remove**, and it does so at the
moment the account is least attended. A guessable credential with an unknown lifetime is a worse
object than a guessable credential with a known one.

### The shape

Two endpoints, and the second one is the dangerous one.

**`issueRecoveryCode`** — admin-only, same shell and guard as `resetMemberPassword`
(`onRequest` · `cors: ADMIN_FUNCTION_ORIGINS` · POST · `verifyIdToken(bearer, true)` ·
`decoded.admin !== true` → 403). Validates the target against the server-owned `activeMembers`
list, never the request body. Generates a code, stores its **hash**, returns the plaintext **once**
in the response and never again.

**`redeemRecoveryCode`** — **unauthenticated, and this is the app's most dangerous endpoint**. The
member has no working credential; that is the whole situation. It takes a name, a code and a new
password, and on success sets the credential and revokes existing sessions.

The app has exactly one public unauthenticated endpoint today, `requestPasswordReset`, and the
reason it is safe is that it is *deliberately incapable* of changing anything — it records a
request. This one is not that. It deserves the treatment `unlockCalendarViewer` got, and for the
same reasons.

### The code itself

- **Random, from a CSPRNG.** Nothing derived from the name, the date, or a counter — the point of
  the whole change is that a credential must not be predictable from public facts.
- **≥40 bits.** Crockford base32 (no `I`, `L`, `O`, `U`, so nothing is misread aloud), grouped for
  reading over a noisy platform: `J7KM-42PX-QT`.
- **Single-use, and short-lived** — 24 hours. Both are the point: a code is a bearer token that a
  colleague has heard.
- **Hashed at rest, with a server-side secret.** HMAC-SHA256 keyed from Secret Manager, or scrypt.
  Not a bare digest: a 40-bit code behind a fast unkeyed hash is offline-crackable from a Firestore
  export in the time it takes to read this paragraph.
- **Never logged, never returned twice, never in analytics or the error log.** The `CALENDAR_VIEWER_PIN`
  rule, unchanged: a secret that reaches telemetry has been published.
- **Compared timing-safely** — `functions/calendar-viewer-auth.js` already holds that discipline.

### Storage — `recoveryCodes/{memberName}`

Doc id is the member name, deliberately: **at most one live code per member, and the collection can
never exceed the roster size.** That is the same by-construction bound `resetRequests` uses, and it
is what makes flooding an unauthenticated endpoint impossible rather than merely rate-limited.
Issuing a second code overwrites the first, which is also how *revoke* works — there is no separate
revoke path to get wrong.

| Field | Written by | Meaning |
|---|---|---|
| `hash` | Admin SDK | HMAC of the code. The plaintext exists in one HTTP response and nowhere else |
| `expiresAt` | Admin SDK | 24h after issue |
| `issuedBy` / `issuedAt` | Admin SDK | who to ask about it |
| `attempts` / `lastAttemptAt` | Admin SDK | the per-name throttle's state |
| `usedAt` | Admin SDK | set inside the claiming transaction; a present value means spent |

**Client read and write: denied entirely**, including for the admin. The only writer is the Admin
SDK, exactly as `overtimeWindows` and `resetRequests` are.

### Throttling — two ways, because one is not enough

`unlockCalendarViewer` learned this at v20.35 and the lesson transfers whole:

- **Per name**, from the `recoveryCodes` doc's own `attempts` — the natural key here, and better
  than a source key because it bounds the thing that actually matters (guesses against one
  account). A handful of failures burns the code and tells the admin.
- **An all-sources ceiling** under a fixed key no header can influence. The station sits behind one
  corporate NAT address, so a per-source bucket is a poor primary control — and a caller can
  *prepend* to `x-forwarded-for`, which is why the per-source key must be derived from its END.

### The ordering problem, and which way it fails

Claiming the code (Firestore, transactional) and setting the password (Firebase Auth Admin SDK) are
**two systems**, so one of them commits first and the other can fail after it.

**Claim first, then set the password.** If the password write then fails, the code is spent and the
member needs another one — annoying, and the response says exactly that so the admin reissues
without a diagnosis. The reverse ordering leaves a window in which a second redeem also succeeds,
and a second redeem sets *a password somebody else chose*. An inconvenience that announces itself
beats a silent second grant.

This is the same class of decision as `upload-commit.js` and should read the same way.

### On success

Set the credential, `revokeRefreshTokens(uid)` (a recovery is exactly when other devices should
stop being signed in), stamp `passwordStatus.passwordSetAt` server-side — which, unlike the
client-written stamp the Settings card produces, is real evidence — and mark the code used.

### It is also the ACTIVATION path

The same endpoint pair serves a new starter. `setupRosterAuth` currently seeds a surname password
on `createUser`; under C6 it can create the account with an unknown random credential and the admin
issues an activation code. **That is the mechanism that makes §7's second route possible**, and it
is worth noticing that it needs no new machinery — the recovery flow and the activation flow are
the same flow, which is why this is one item and not two.

### What stays exactly as it is

The member's end of the existing queue — *Can't get in?* → `requestPasswordReset` → the admin's
**Password Reset Requests** card, with its targeted push. Only the admin's ANSWER changes:

```
was:  member asks → admin makes the surname valid again → member may or may not choose a new one
now:  member asks → admin issues a code → member chooses a password to redeem it
```

The admin never learns the member's password in either version. In the new one they never learn a
working credential at all.

---

## 2 · Keep converting personal devices

Not a build — everything needed shipped already: the forced overlay at named sign-in, the Account
status table, `neverSignedIn` from `getSignInStats`, and (v22.37) a Settings page that states
`✓ Password set` or `Using surname` without being opened.

The one addition worth making is a **restrained, one-time invitation on a PIN-unlocked personal
device**, in the shape the `sign-in-2026` notice already has:

> Using this on your phone? Sign in once and you won't need the staff PIN again for 60 days.

That notice exists and is live to ~25 Nov 2026. Its audience rule (`'signed-out'`, retiring itself
the moment the reader signs in) is the correct mechanism and needs no change. What is missing is
that **Operations does not state the campaign's position as a number** — the Account status table
holds it per member, but "Passwords: 43 / 48 set" appears nowhere, and a migration nobody can see
the size of is one nobody finishes.

---

## 3 · F — step-up authentication for sensitive admin actions

**Independent of everything else here.** No prerequisites, small, and it addresses the one risk a
60-day session genuinely carries.

Shortening the session for everybody would be the wrong answer: it makes the app worse for fifty
people to address a risk that concerns one account. The risk is not that a member's phone is
unattended for 58 days — it is that an **admin's** is, and that picking it up is enough to reset
somebody else's password and take their account.

**The sensitive set** — anything that changes another person's ability to sign in:
`resetMemberPassword` and its successor `issueRecoveryCode`; `setupRosterAuth` (create, disable);
any future operation that changes a member's identity or claims.

**The rule, enforced on the server:** `verifyIdToken` returns `auth_time` — when the credential was
last actually presented. If that is more than 15–30 minutes old, refuse with a distinct code and
let the client ask.

**It has to be `auth_time`, not a client timer.** A client that remembers "we asked them four
minutes ago" is a UX affordance, not a control — invariant 6 in `AUTH_AND_SESSIONS.md` says exactly
this about page authorisation and it is the same mistake. **Fails closed:** a token with no
`auth_time` is treated as stale.

The client half already exists — `reauthenticateWithPassword` in `firebase-client.js`, which the
Settings password card uses. The flow is: refuse → *Confirm your password to continue* →
reauthenticate → force a token refresh → retry once. That is the shape `claim-retry.js` already
established for a stale claim, and it should reuse it rather than grow a second retry idiom.

---

## 4 · Keep both kinds of Calendar access

Recorded as a decision because the alternative keeps suggesting itself.

| | Shared station PC | Personal device |
|---|---|---|
| Way in | Staff PIN | Named sign-in |
| Lasts | The browser session | 60 days |
| Leaves behind | Nothing — no identity, no writes, no notifications | A member identity |
| Gets | The Calendar | Settings, Overtime, pay integration, notifications |

The PIN is not individual authentication and does not claim to be. Its job is to stop the roster
being public while preserving a ten-second glance on a shared machine, and it does that.

**Do not lengthen the PIN to six digits.** The endpoint is throttled per source and globally, the
space is 10,000 against a hard ceiling, and the cost of the change lands on fifty colleagues
remembering a longer shared secret. If a threat model ever needs more than this, the answer is
individual authentication (Track E, §7), not a longer shared code — a stronger shared secret is
still a shared secret.

---

## 5 · Retire the anonymous fallback

The Calendar's anonymous bootstrap is gone in effect (v20.12) but not in code: `calendar-access.js`
still calls `signInAnonymously` under the `CALENDAR_PIN_ACCESS === false` rollback path, and
`session.js` keeps its soft fallback. `ENFORCE_NAMED_SESSION` is the same kind of object.

Both were valuable rollback machinery and both are now **permanent migration machinery, which is
the definition of debt**. Fewer identity states means fewer states that can disagree, and every
recorded defect in this area has been two of the three disagreeing.

**Not before the recovery route is settled**, deliberately: removing them changes what a rollback
can do, and §1 is the thing that would need rolling back.

---

## 6 · The Calendar start round trip

Already instrumented, already priced, and deliberately not yet acted on — the reading that would
justify it is named in `LATENCY_PLAN.md` → Phase 2, and the trade in `ROADMAP.md`.

**If the field data confirms the predicted signature**, the preferred answer is the repository's
Option 3: for a named member holding an otherwise-valid 60-day local session, paint their cached
roster immediately, **visibly marked as not yet confirmed**, while Firebase validates the stored
account behind it.

Four conditions, and they are what make it a policy rather than an optimisation:

1. **Never for a staff-PIN viewer.** A shared station has no local identity to extend trust to.
2. **Never for a server read or write.** The cached paint is a display, not an authorisation — no
   query goes out and no write is attempted before auth resolves.
3. **On rejection, the cached privileged state is removed immediately**, not at the next navigation.
4. **The marking is honest.** "Updating" means the app has not yet been told this is still you.

This is `AUTH_AND_SESSIONS.md`'s question, not the performance plan's: it decides how much a local
session is allowed to MEAN before the server has agreed with it. That contract already records it
as the one open decision on the boundary.

---

## 7 · C5 — the surname retirement, and the decision on the table

⚠️ **This section describes two routes. Neither is adopted. The choice is the owner's, and the
current plan is unchanged until they make it.**

### Route 1 — the plan as it stands

C5 is gated on Track E because of a metric argument: a member who only ever reads the roster signs
in nowhere, never meets the forced-password overlay, and therefore never migrates — so the "≥90%
migrated" figure cannot converge without individual authentication first.

### Route 2 — what C6 makes possible

Once one-time codes exist, every remaining un-migrated account's surname password can be replaced
**server-side with an unknown random credential**. Nobody loses Calendar access, because the staff
PIN is not a password. Anyone who later wants named access asks for an activation code and chooses
a password — which is the ordinary new-starter flow, not a special case.

### What the two routes actually differ on

The gating argument conflates two questions that C6 separates:

- **The credential question** — *may a guessable password sign somebody in?* Route 2 answers it,
  today, without touching how the Calendar is read.
- **The read question** — *may the roster be read without individual identity?* Route 2 does **not**
  answer it. That is Track E, and it stays exactly where it is.

C5 is currently waiting on E3 for a reason that belongs to the read question. That coupling is real
under Route 1 and dissolves under Route 2.

### What Route 2 costs — stated, because it is not free

- **Irreversible per account.** The surname is gone; only a code restores access. Rehearse it on
  one account first.
- **A support burst.** Everyone still un-migrated needs a conversation before their next named
  sign-in. `neverSignedIn` and the Account status table say how many that is **today** — read it
  before deciding, not after.
- **It can strand somebody silently.** A member who has been signing in with their surname on a new
  phone would simply stop being able to, with no explanation at the moment it happens. So it needs
  a notice campaign first, and the code issued *before* the credential is changed for anyone who is
  actually using it.
- **It does not make Track E unnecessary** — see above. Anyone reading it as "we can skip E" has
  read it wrong.

### The decision this needs

**Does the owner want C5 to mean "no guessable credential exists" (Route 2, available once C6
ships) or "every member authenticates individually" (Route 1, gated on E3)?**

Until that is answered, `SECURITY_RELEASE_PLAN.md`'s C5 row stands as written, and this section is
the record of the alternative — not a change to it.

---

## 8 · C2 — an address is not a credential

The app collects `@chilternrailways.co.uk` addresses and that groundwork is right. **It is not yet
a recovery credential and must not become one by default.**

A `staffContact.workEmail` is an address a member or an admin *typed*. Nothing has demonstrated
that anyone can receive mail at it. The gap between those is the whole of account takeover: an
address supplied by an attacker, or simply mistyped into a colleague's mailbox, becomes a way in
the moment "send a reset here" is wired to it.

**The rule:** a work email may be used for recovery only after possession is proven — a code or
link sent to the mailbox and returned — recorded as a server-written `verifiedAt`. Unverified
addresses stay what they are today: contact information.

This belongs in `AUTH_AND_SESSIONS.md` as an invariant rather than only here, because the temptation
arrives later, when the field is full and the relay finally exists and wiring it up looks like a
one-line change.

Still gated on a mail relay that does not exist (Power Automate, Graph, or whatever route is
approved). **Sequenced after C6 deliberately**, so that when it arrives it is a *second* route and
the admin code path becomes true break-glass rather than the only recovery.

---

## 9 · Passkeys

`PASSWORD_PLAN.md` → *Passkeys — POSSIBLE, not planned* holds the survey, the domain-binding
blocker and the four options. Not restated here. What that section does not carry is the **order**,
which is the only thing this file adds:

```
password migration → one canonical origin → retire the GitHub Pages install route
                   → passkey spike → passkeys ADDITIVE, alongside passwords
```

A passkey is bound to one origin, and the app is served from two. That is the blocker, and it is
not a passkey problem — it is the two-origins problem, which has other costs already.

**Passwords and the recovery route stay** when passkeys arrive. A lost phone must never be a
lockout, and a passkey-only account on a single device is exactly that.

---

## 10 · The end-state, if the app is ever adopted formally

If Chiltern adopts this as official infrastructure, the right answer is **Microsoft / Entra ID
work-account SSO**, and most of this file stops being needed. The company then owns joiners,
leavers, password and MFA policy, account disablement, and identity verification; the app consumes
an identity and maps it to its own roles, which it already does cleanly via claims.

That is a better end-state than maintaining a staff authentication system indefinitely. It is also
entirely dependent on Chiltern IT registering the application, so it is a long-term entry in
`ROADMAP.md` and not a plan.

**Worth knowing while building anything above:** the claim model (`{admin|manager|name}` stamped
from a server-owned list) is exactly the shape an SSO integration would keep. Nothing in this
programme paints into a corner — except passkeys, which SSO would make redundant, which is one more
reason they sit last.

---

## The target, in one picture

```
Shared PC          staff PIN ──────────────► read the Calendar
                                             browser close destroys it

Personal device    password or passkey ────► named member, 60-day session

Forgotten          one-time admin code ────► choose a new password
                   later: verified work email ──► self-service

Admin action       named admin session + a RECENT credential ──► proceed
                   (sensitive operations only)

Server             claims are the authority
                   rules are the boundary
                   no anonymous fallback
```

Simpler than what exists now, and stronger. The single most valuable move in it is the first one:
**stop making the surname a valid credential again every time somebody forgets their password.**
