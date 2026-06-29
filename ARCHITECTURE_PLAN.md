# ARCHITECTURE_PLAN.md — Auth/session consolidation (Track 1) and supporting refactors

*Status: proposed (not started). Companion to `SECURITY_RELEASE_PLAN.md`. This plan is a
**behaviour-preserving structural refactor** of how the app reasons about identity and page
access. It must land **before B3** (the strict token-refresh sweep) and must NOT change runtime
auth behaviour itself — B3 changes behaviour later, on top of the clean base this builds. Not
version-stamped; not a runtime asset.*

This is the architectural counterpart to the security release: `SECURITY_RELEASE_PLAN.md` decides
*what the rules enforce*; this plan decides *how the client reasons about identity so the rules
can be tightened safely*. Read alongside it — Track 1 here is the documented prerequisite for
B3 there.

---

## The one invariant (read this first)

**Client-side auth state is UX and optimisation. It is NEVER the security boundary.** The actual
boundary is **Firestore Rules + Cloud Functions claim checks**, server-side. Everything in this
plan — the state machine, `hasClaim()`, optimistic reads, even "writes authorise strictly" —
decides what the client *attempts* and *renders*, not what is *allowed*.

Two consequences make the whole refactor safe by construction:

1. **Optimistic reads are safe** precisely because the server is authoritative. A stale client
   token that *claims* `admin` after the server revoked it just yields `permission-denied`
   (→ force-refresh + retry), never access. The client claim check is a latency optimisation.
2. **No client refactor can weaken security**, because the client was never enforcing it. This is
   the structural answer to "could consolidating auth accidentally make us less safe?" — no.

State it in code as: **the client decides what to *attempt* and what to *render*; the server
decides what is *allowed*.**

---

## Why now (and why before B3)

The app has **two identity systems that must agree**: the local app session in `localStorage`
(`getSession()`) and the Firebase Auth identity/claims (`ensureFirebaseSession`/
`ensureNamedSession`). Today each page coordinator partly reconciles them itself, against shared
module-level mutable globals in `session.js` (`_fbIdentity`, `_fbAuthError`, `_sessionResolve`).

That is *serviceable while rules are broad*. It becomes *dangerous once rules depend on exact
claims* (B2 shipped that; B3 makes it strict). The scattered model is the root of a recurring bug
class — the v10.94 outage, the "bell stuck off-lapsed" bug, and the Operations-card
latency/race — all of which are "the two systems briefly disagreed, and some page handled it its
own way." Consolidating to one tested machine **before** B3 removes that class as a foundation,
rather than patching it under load.

---

## Non-goals (this refactor does NOT)

- Change Firestore Rules or Storage Rules.
- Implement B3 (strict token-refresh sweep) or any claim-enforcement behaviour change.
- Change **who can currently access which page or perform which action** — behaviour is preserved.
- Change Pay Calculator calculations or any feature logic.
- Introduce a framework, bundler, or build step.
- Migrate the roster **data structure** (Track 2 splits modules, not schemas).
- Remove or alter GitHub Pages support.
- Solve surname-derived passwords (that is Track C in the security plan).
- Make the public/anonymous-readable calendar data private.
- Move `MILLER_ACTUALS` — that is a **separate** privacy task (see the dedicated section), not part
  of the auth refactor's critical path.
- Build a general app-wide state store (the machine owns identity only — see scope guardrails).

---

## The design: two pure layers over one thin shell

### Layer 1 — Identity state machine (authentication) — *pure*

`reduceAuthState(prevState, event) → nextState`. **No DOM, no Firebase imports, no localStorage,
no redirects, no overlays.** States are **identity facts only**:

| State | Meaning |
|-------|---------|
| `initialising` | nothing checked yet |
| `resolving` | local session present; Firebase identity being restored/established |
| `named` | correct named Firebase user confirmed |
| `anonymous` | anonymous Firebase fallback present (valid only where policy allows) |
| `signedOut` | no valid local session, no anonymous identity |
| `degraded` | transient Firebase/network failure mid-resolution (retryable) |
| `error` | non-recoverable auth/session problem |

`needsLogin` and `forbidden` are deliberately **not** identity states — the same `named` user is
"forbidden" on Operations but "allowed" on Admin. They are **policy outcomes** (Layer 2). Keeping
them out of the reducer is what delivers the authentication/authorisation separation.

### Layer 2 — Page-auth policy (authorisation) — *pure*

`requirePageAuth(snapshot, policy) → { decision, reason }` where `decision ∈
{ allow, login, forbidden, soft-allow }`, driven by a **declarative policy map** — the single home
for the per-page rules currently smeared across six coordinators, and the single home for
`ENFORCE_NAMED_SESSION` and the hard/soft matrix:

| Page | Local session | Firebase (read) | Firebase (write) | Role | Anonymous |
|------|---------------|-----------------|------------------|------|-----------|
| Calendar | optional | anonymous ok | n/a | none | yes |
| Admin | required | named | **named + fresh claims** | admin *or* manager (per action) | no |
| Operations | required | named | **named** | master admin | no |
| Links | required | named | **named** | designer | no |
| Settings | required | named (writes) | **named** | owner/admin | no |
| Pay Calculator | required | best-effort | best-effort | none | **soft** |
| Guides | — | — | — | — | n/a |

**Start page-based; leave the seam for action-based.** The policy map keys can later evolve
`page → page.action` (e.g. `admin.writeAnyOverride`, `admin.importRoster`) **without touching the
reducer**, because granularity lives entirely in the authz layer. Do not build action-level policy
on day one.

### The shell — `auth-state.js` (imperative, thin, allowed to be messy)

Wraps the real systems — `getSession`, Firebase `currentUser` / `onAuthStateChanged` /
`getIdTokenResult` / `signOut` / token refresh, session expiry, network failure classification —
feeds events into the reducer, and **owns the single in-flight resolution**. Minimal API:

```
getSnapshot()      subscribe(listener)      requirePageAuth(policy)
signOut()          refreshClaims()
```

**Concurrency win:** today, concurrent `ensureFirebaseSession` calls reset and race the
`_fbIdentity` global (the mechanism behind "works after reload" and the Operations race). A
single-owner machine with one in-flight resolution **eliminates that bug class structurally.**

**Not a state framework.** It owns: local-session expiry, Firebase restore/sign-in/sign-out,
named-vs-anonymous identity, token refresh, auth-error classification, role claims, page-auth
policy. It does **not** own: page/card/form UI state, Pay Calculator data, roster data, nav-drawer
state. Replacing a scattered concern with a central god-module would be a net loss.

---

## Degraded-state rules (the most important guardrail)

`degraded` must never become a privilege loophole. The anti-pattern to forbid: *"Firebase is
degraded, so carry on because the local session says the user is admin."* That would undo the
security model.

**Rule: degraded never grants authority. It may only preserve local/cached read-only UX. Any
privileged write under `degraded` collapses to the same decision as `signedOut`.**

| Page / action | Degraded behaviour |
|---------------|--------------------|
| Calendar read | allow cached/anonymous display |
| Pay Calculator | allow local calculator use |
| Settings read | allow local view; **block cloud save** |
| Admin / Operations / Links pages | render a clear degraded/blocked state |
| Override write/delete, roster upload, huddle/circular/newsletter upload, auth setup, link-design save | **block** |

---

## Reads hydrate optimistically; writes authorise strictly

The practical rule that avoids both bad extremes (everything-waits = slow blank cards;
everything-trusts-local = fake security):

- **Reads** may proceed once `snapshot.firebaseUser && snapshot.hasClaim(role)` — even while the
  state is still `resolving`. On `permission-denied`, call `refreshClaims()` (force
  `getIdToken(true)`) **once** and retry **once**. (This is the real fix for the Operations-card
  latency.)
- **Writes** must await `state === 'named'` with fresh-enough claims, per the policy map.
- **Local session alone is never sufficient for a privileged cloud write.**

Formalise it as a load-bearing comment so future maintainers (human or AI) can't quietly weaken it:

```js
// Design rule (ARCHITECTURE_PLAN.md):
// Reads may hydrate optimistically once a Firebase user and the required claim are present.
// Privileged writes must wait for a confirmed named identity and fresh-enough claims.
// Local session alone is NEVER sufficient for a privileged cloud write.
// The server (Firestore Rules / Functions) is the boundary; this is UX, not enforcement.
```

---

## Phased migration

### Phase 0 — Characterisation tests first (safety net)
Pin **current intended** behaviour *before* changing structure. Matrix: no / expired / valid local
session; Firebase already same-user / different-user (shared-device switch) / anonymous / none;
named sign-in success / transient-fail / permanent-fail; `ENFORCE_NAMED_SESSION` on/off; admin /
manager / designer claim present / missing / stale.
- Pin **intended** behaviour, **not** known bugs: the Operations-card hang and the
  degraded inconsistencies are defects to fix in migration, not behaviour to lock in.
- Note the split: the **identity layer** (`session.js`) is unit-testable now; the **page-policy
  outcomes** are partly covered by existing flag-ON e2e and partly only become unit-testable as
  each coordinator is refactored (Track 3). So Phase 0 lands in two parts — identity-layer
  characterisation now, page-policy characterisation rolling in per coordinator.

### Phase 1 — Pure reducer (`auth-state-core.js`)
The functional core: `reduceAuthState(prev, event)`. No I/O. Heavily unit-tested. Not yet wired in.

### Phase 2 — Shell adapter (`auth-state.js`)
Wrap Firebase/localStorage; internally delegate to today's `session.js` functions at first (safe).

### Phase 2.5 — Re-implement `sessionReady` ON TOP of the new machine
Bidirectional shim: un-migrated pages keep importing `sessionReady` and behave identically, but it
is now sourced from the one machine — a single source of truth **even mid-migration**, so the old
and new models are never both authoritative at once. (This is "migrate, don't cut over.")

### Phase 3 — Policy map + `requirePageAuth` guards
Author `auth-policy.js` (the table above) and the pure decision function.

### Phases 4–7 — Migrate coordinators (this is Track 3)
Wrap each coordinator body in an exported `init()` called by a 2-line bootstrap; replace top-level
`throw new Error('Not signed in')` with explicit guard/early-return; route through
`requirePageAuth`. Order and rationale:
1. **Operations** — admin-only, recently raced, many async cards, touches Functions+Firestore+
   Storage, lower staff-facing blast radius than Calendar.
2. **Links** — currently client-side designer gating; benefits most from the policy map.
3. **Admin** — bigger and more sensitive (override writes are core data); migrate after the pattern
   is proven.
4. **Settings / Pay Calculator** — Settings matters for push + work-email; Pay Calculator stays
   **soft** (calculator works locally even if Firebase fails).
- **Calendar** is left until last (or untouched) unless B3 requires it — it is the most
  staff-visible page.

### Phase 8 — B3 (handed back to `SECURITY_RELEASE_PLAN.md`)
Strict token-refresh sweep, now a **policy-led change** rather than a scattered coordinator
rewrite. (Not "one line" — B3 still needs rule changes, Functions claim checks, the re-auth window,
tests, and docs — but the *client* change becomes a policy edit, not six coordinator rewrites.)

---

## Acceptance criteria (objective pass/fail)

**Track 1 / per migrated coordinator:**
- Existing test suites still pass (unit, hygiene, rules, e2e).
- The Phase-0 characterisation matrix passes against the new machine.
- `sessionReady` behaviour is preserved for un-migrated pages.
- No coordinator initialises a privileged **write** path before policy returns `allow`.
- Admin-only **reads** hydrate without waiting for the full write gate (Operations cards no longer
  block on confirmed-named).
- A `permission-denied` read triggers **exactly one** forced token refresh and **one** retry.
- **Passive local-session expiry clears localStorage only and does NOT force a Firebase sign-out**
  (preserves the calendar anonymous-bootstrap / "bell stuck off-lapsed" fix). Firebase sign-out
  happens **only** on explicit `clearSession()` (user logout). *(Corrects an earlier draft
  criterion that had this backwards.)*
- The shared-device identity switch (Person A → Person B) is a tested transition.
- No `throw new Error('Not signed in …')` remains at module-eval in a migrated coordinator.
- **No local session alone authorises a privileged cloud write** (the invariant, asserted).
- The client auth state is never the sole security boundary — Firestore Rules/Functions remain
  authoritative (asserted by the rules tests, which already exist).

---

## Risks and rollback

| Risk | Mitigation | Rollback |
|------|------------|----------|
| Auth is load-bearing; a regression locks users out | Phase 0 net + behaviour-preserving discipline + one-coordinator-at-a-time | Each coordinator migration is an independent revert; `sessionReady` shim keeps un-migrated pages working |
| Two auth models briefly coexist | Phase 2.5 shim makes the new machine the single source even mid-migration | Revert the shim → back to `session.js` directly |
| Refactor "improves" security mid-flight (smuggles B3 early) | Hard non-goal + acceptance criteria assert behaviour is preserved | n/a — caught in review/tests |
| New module per split increases SW/asset surface | Update SW lists + `sw-asset-check` + AI_MAP in the same commit (existing discipline) | Revert the module split |

---

## MILLER_ACTUALS — separate privacy task (owner decision needed)

**Not part of the auth refactor's critical path.** Tracked here only so it isn't forgotten.

`MILLER_ACTUALS` (13 periods of real payslip figures — gross/tax/NI/net/varPay) currently lives in
`roster-data.js` and is imported by **production** modules (`paycalc-app.js`, `paycalc-hpp.js`) for
G. Miller's actual-payslip comparison and HPP basis. In a no-build app, **any served JS file is
fetchable by anyone who knows the URL** — so this is a real (small) privacy exposure, not bloat.
Three honest options (owner picks):

- **A — remove the production feature:** move the data to `test-fixtures/`, imported by tests only.
- **B — keep the feature, device-local:** figures live only in the owner's browser `localStorage`,
  fitting the Pay Calculator's existing local/private model. **Likely best for current use.**
- **C — owner-only Firestore doc:** robust across devices, but needs owner-only rules, claim
  correctness, no public reads, import UI, and deletion/export controls.

**Anti-patterns (do none):** move it to another public JS file, hide behind an obscure filename,
rely on URL obscurity, or leave it in `roster-data.js`. Decoupling it from `roster-data.js` (Track
2) reduces coupling but does **not** by itself fix the exposure.

---

## Track ranking and sequence

1. **Track 1 — Auth state machine** — highest; **before B3**, no debate. Behaviour-preserving.
2. **Track 3 — Testable coordinators** — high; it is *how* Track 1 lands (Phases 4–7). Operations first.
3. **Track 2 — Split `roster-data.js`** — medium-high; SW-aware order
   (`MILLER_ACTUALS → CONFIG/APP_VERSION → team → roster-logic`), barrel-shim, change direct imports
   last. Deliberately **not** concurrent with the auth work.
4. **Track 4 — CJS/ESM duplication** — leave alone (parity tests cover it; surname passwords are
   slated to retire in security Track C).

---

## Claude Code guardrails (for any future session implementing this)

- **Do not combine Track 1 with B3.** Refactor first; behaviour change later.
- **Do not change page-access behaviour during the refactor.** It is behaviour-preserving.
- **Do not add a build step, bundler, or framework.**
- **Do not create a general app-wide state store.** The machine owns identity only.
- **Do not move payslip actuals to another public served file** (see the privacy task).
- **Migrate one coordinator at a time**, Operations → Links → Admin → Settings/Paycalc.
- **Keep the `sessionReady` shim until every page is migrated.**
- **The server is the security boundary** — never treat client auth state as enforcement.
