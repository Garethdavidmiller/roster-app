# ARCHITECTURE_PLAN.md — Auth/session consolidation (Track 1) and supporting refactors

*Status: **Track 1 COMPLETE (v14.57–v14.67) — all coordinator migrations landed; only B3 (Phase 8,
behaviour change, owner-gated in `SECURITY_RELEASE_PLAN.md`) remains.** Phase 0: characterisation
net (`session.test.mjs`, `firestore.rules.test.mjs` B2, flag-ON e2e) pins current behaviour. Phase 1
(v14.58): `auth-state-core.js` pure `reduceAuthState` machine. Phase 2 (v14.59): `auth-state.js`
store + `session.js` feed bridge (observing only; `sessionReady` untouched). Phase 3 (v14.60):
`auth-policy.js` pure page-auth map + `requirePageAuth`. Phases 4–7 (v14.61–v14.66): every write/named
coordinator now CONSUMES the store + policy — Operations (4a) + self-healing admin reads (4b, v14.62),
Links (5), Admin (6), Settings + Pay Calculator (7). Phase 4a.2 (v14.65/14.67): the HALT-style
coordinators (Operations, Links, Paycalc) wrapped in an exported `init()` + `*-boot.js` bootstrap
(branch-style Admin/Settings intentionally left inline). The whole refactor is behaviour-preserving
(665 unit + 173 rules + 68 e2e pass unchanged throughout). Companion to `SECURITY_RELEASE_PLAN.md`.
This plan is a **behaviour-preserving structural refactor** of how the app reasons about identity and
page access. It must land **before B3** (the strict token-refresh sweep) and must NOT change runtime
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

### Phase 0 — Characterisation tests first (safety net) — ✅ IDENTITY + CLAIM LAYERS DONE (v14.57)
Pin **current intended** behaviour *before* changing structure. Matrix: no / expired / valid local
session; Firebase already same-user / different-user (shared-device switch) / anonymous / none;
named sign-in success / transient-fail / permanent-fail; `ENFORCE_NAMED_SESSION` on/off; admin /
manager / designer claim present / missing / stale.
- Pin **intended** behaviour, **not** known bugs: the Operations-card hang and the
  degraded inconsistencies are defects to fix in migration, not behaviour to lock in.
- **Status:** the net was already ~90% in place from the B0/B1/B2 test discipline. As of v14.57:
  - **Identity layer (`session.test.mjs`, 43 tests) — COMPLETE.** Whole matrix pinned:
    getSession (none / invalid-JSON / absolute-expired / version-stale / idle-expired / valid-fresh /
    1ms-edge / **missing-lastActivity NaN edge** / refreshes-lastActivity / **no-signOut-on-passive-
    expiry**); ensureFirebaseSession (reuse-named / sign-in / self-heal / anon-fallback / all-fail /
    replace-anon / **replace-different-member shared-device switch**); flag-ON (named-success /
    user-not-found-no-heal / invalid-cred-no-anon / matching-reused); ensureNamedSession (flag-off
    passthrough / flag-on success / persistent-no-retry / transient-then-fail / **transient-then-
    recover**). The two bolded `lastActivity` and transient-recover cases were the only genuine gaps,
    added v14.57.
  - **Claim layer (`firestore.rules.test.mjs`) — COMPLETE** via the B2 3-tier tests
    (staff / manager / admin / no-name write + delete isolation; this is the "claim present/missing"
    characterisation — claims are token/rules-level, not in `session.js`).
  - **Page-policy layer — partial, by design.** The per-page enforcement matrix is pinned by the
    10 flag-ON e2e tests (admin/settings re-show login, operations/links redirect, paycalc soft).
    Deeper *unit* characterisation of each coordinator's policy outcome only becomes possible once
    that coordinator is wrapped in a testable `init()` — so it **rolls in per coordinator during
    Track 3 (Phases 4–7)**, not up front. This is the documented two-part split, now resolved:
    nothing further is needed before Phase 1.

### Phase 1 — Pure reducer (`auth-state-core.js`) — ✅ DONE (v14.58)
The functional core: `reduceAuthState(prev, event) → next` + `INITIAL_STATE` + `AUTH_STATUSES`. No
I/O (no DOM/Firebase/localStorage). Seven identity states; eight events (RESOLVE_START / NAMED /
ANONYMOUS / NONE / TRANSIENT / RETRY / FATAL / SIGN_OUT); unknown events inert; every result a new
frozen object, never mutates prev. Maps 1:1 onto the Phase-0 outcomes. 24 tests in
`auth-state-core.test.mjs` (each event, the RETRY-only-from-degraded guard, purity/immutability,
and realistic lifecycles incl. transient-recover). **Not wired into anything** — behaviour
unchanged. Listed in the SW precache lists + CLAUDE.md/AI_MAP so it ships ready for Phase 2.

### Phase 2 — The auth STORE (`auth-state.js`) — ✅ DONE (v14.59)
The store holds the single identity state (`getAuthSnapshot` / `subscribeAuth` / `dispatchAuth` over
the reducer), importing only `auth-state-core.js`. **Refinement vs the original plan (deliberate, for
safety):** rather than build a NEW shell that re-wraps Firebase/localStorage — which would duplicate
`session.js` and add risk — the **existing `session.js` is the adapter** and FEEDS the store:
`ensureNamedSession` dispatches `RESOLVE_START → (TRANSIENT/RETRY) → NAMED/ANONYMOUS/NONE/FATAL` from
the B0 signals, and `clearSession` dispatches `SIGN_OUT`. Acyclic: `session.js → auth-state.js →
auth-state-core.js`. Store: `auth-state.test.mjs` (9); bridge: `session.test.mjs` "auth-store bridge"
(6). The 43 pre-existing session tests pass unchanged → behaviour preserved.

### Phase 2.5 — `sessionReady` is left UNTOUCHED (the safe realisation of "single source")
The original 2.5 re-routed `sessionReady` through the machine. On reflection that is **risk for zero
benefit**: `sessionReady` is awaited by every write page, so re-sourcing it could change its value or
timing. Instead, the store and `sessionReady` are **both driven by the same `ensureNamedSession`
resolution**, so they cannot diverge — which IS the "single source / never two authoritative models"
property 2.5 was for, achieved with **zero change to `sessionReady`**. Phase 2 is OBSERVING ONLY
(every feed wrapped so a store error can't break auth; nothing consumes the store yet). The literal
re-route is therefore dropped, not deferred — the goal is already met. (Calendar's anonymous bootstrap
and paycalc's direct `ensureFirebaseSession` feed the store when those pages migrate, Phase 7.)

### Phase 3 — Policy map + `requirePageAuth` guards — ✅ DONE (v14.60)
`auth-policy.js`: `PAGE_POLICIES` (the table above, **grounded in the coordinators' real gates** —
operations admin-only, links designer-only, admin/settings any-named, paycalc soft, calendar public,
guides open) + the **pure** `requirePageAuth(snapshot, policy, roles) → { decision, reason }` with
five decisions `allow / soft-allow / login / forbidden / pending` + `rolesFor(member)` (CONFIG glue)
+ `requirePage(snapshot, page)` (coordinator convenience, fails closed on unknown page). Encodes the
invariants: degraded never grants authority (→ pending, not allow), soft never blocks, public always
allows, server is the boundary. 42 tests. Not wired in — behaviour unchanged. **Decision deviation
from the plan's four outcomes:** added `pending` for the resolving/degraded states (a "not yet"
outcome the coordinator shows as loading/reconnecting) — necessary because `subscribeAuth` fires on
those transient states. The read-vs-write distinction is left as the documented `page→page.action`
seam for Phase 4.

### Phases 4–7 — Migrate coordinators (this is Track 3)
Wrap each coordinator body in an exported `init()` called by a 2-line bootstrap; replace top-level
`throw new Error('Not signed in')` with explicit guard/early-return; route through
`requirePageAuth`. Order and rationale:
1. **Operations** — admin-only, recently raced, many async cards, touches Functions+Firestore+
   Storage, lower staff-facing blast radius than Calendar. **DONE** (4a v14.61, 4b v14.62).
2. **Links** — currently client-side designer gating; benefits most from the policy map. **DONE
   (Phase 5, v14.63):** the two-gate `!currentUser` / `!isLinksDesigner` block and the `!named` B1
   check both route through `requirePage(..., 'links')` now (designer-only policy); the inline
   `CONFIG.LINKS_DESIGNERS` test moved into `rolesFor`. Behaviour-preserving — 68 e2e pass unchanged
   (incl. the links designer-load + B1 `failSignIn` redirect cases). 4b's stale-claim retry does NOT
   apply: links reads `linkDesigns` (`request.auth != null`), not an admin-claim-gated collection.
3. **Admin** — bigger and more sensitive (override writes are core data); migrate after the pattern
   is proven. **DONE (Phase 6, v14.64):** the page gate `if (!isAuthenticated)` routes through
   `requirePage(..., 'admin')` (policy `role: null` → any named user; no 'forbidden' path) and the
   `!named` B1 check through `requirePage(getAuthSnapshot(), 'admin')`. STRICTLY page-access only —
   `applyPermissions()` (the admin/manager-vs-staff ACTION/UI restriction) and every override write
   path are untouched. The snapshot maps the local session-existence flag (`!!currentSession`) to an
   optimistic 'named', preserving the exact prior trigger. Behaviour-preserving: 665 unit + 68 e2e
   pass unchanged (incl. admin signed-in render + B1 `failSignIn` re-show-login).
4. **Settings / Pay Calculator** — Settings matters for push + work-email; Pay Calculator stays
   **soft** (calculator works locally even if Firebase fails). **DONE (Phase 7, v14.66):**
   - *Settings* — mirrors Admin: the `if (!isAuthenticated)` gate routes through
     `requirePage(..., 'settings')` (policy `role: null` → any named user; no 'forbidden'), and the
     `!named` B1 check through `requirePage(getAuthSnapshot(), 'settings')`.
   - *Pay Calculator* — the soft Firebase-confirmation path (`_initErrorReporting`) now decides via
     `requirePage(getAuthSnapshot(), 'paycalc')` — being `soft` it returns only `allow`/`soft-allow`,
     never `login`, so the calculator is never blocked (warn-only on `soft-allow`). **Gate #1 (no
     local session → login overlay) is DELIBERATELY left outside the policy**: paycalc needs a local
     member identity to namespace its per-member localStorage, a precondition stricter than the
     page-soft policy (whose tested invariant is "soft never yields login"). Documented in-code so it
     is never "simplified" into requirePage (which would regress to rendering with no identity).
   - Behaviour-preserving: 665 unit + 68 e2e pass unchanged (incl. settings login + B1 re-show-login,
     and "paycalc stays SOFT — calculator renders, no redirect").
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

## MILLER_ACTUALS — privacy task — ✅ RESOLVED (Option A, v14.68)

**Done as Track 2 step 1.** `MILLER_ACTUALS` (13 periods of real payslip figures) was moved OUT of
the served `roster-data.js` into `test-fixtures/miller-actuals.js`, which is **excluded from Firebase
Hosting** (`firebase.json` `ignore` → `test-fixtures/**`) so it is no longer fetchable. The former
in-app "Actual Take-Home" comparison feature (gated to G. Miller in `paycalc-app.js`/`paycalc-hpp.js`)
was removed — the test suite already validates the pay maths against these figures, and `paycalc.test.mjs`
now **imports the fixture** as its single source of truth (the previously-duplicated inline array was
deleted). This closes the (small) privacy exposure: in a no-build app any served JS file is publicly
fetchable, and these were real payslip figures.

The three options considered (kept for the record): **A — test-only fixture (chosen)**; B — device-local
localStorage (keeps the in-app feature but needs a one-time owner import); C — owner-only Firestore doc
(cross-device but heavy: owner-only rules + import/export UI). **Anti-patterns avoided:** moving it to
another *served* JS file, obscure-filename/URL-obscurity, or leaving it in `roster-data.js`.

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

---

## Appendix: Phase 4 detailed scope (Operations first) — scoped v14.61

Phase 4 makes the FIRST coordinator actually CONSUME the store + policy. Two owner decisions are
settled:

1. **Split 4a / 4b.** Ship the structural consumption first (4a), the read-latency improvement
   second (4b) — so the riskiest change lands with reads behaving exactly as today.
2. **No write-gating UI change.** Every Operations write handler ALREADY `await sessionReady`
   before executing (huddle.js, operations-app.js circular/newsletter + roster, admin-auth.js), and
   the buttons gate on file-selection (which outlasts sign-in). So a premature tap simply waits then
   writes — the reviewer's M1 is adequately handled, and the server is the boundary regardless.
   Adding a visible "confirming…" disabled state would be a behaviour change with ~zero benefit.
   **Therefore 4a is behaviour-PRESERVING**, not behaviour-adjacent.

### 4a — consume `requirePage` + the store (behaviour-preserving)
- **Access gate:** replace the two top-level `if (!currentUser)` / `if (!isAdmin)` blocks with ONE
  `requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'operations')`
  decision — `login` → overlay (was Gate A), `forbidden` → redirect to admin (was Gate B), `allow`
  → continue. The synthesised "local-derived" snapshot preserves today's fast render from
  localStorage (it treats a present local session as `named`, exactly today's optimism).
- **B1 enforcement:** the existing `_opsAuth.then(...)` keeps its once-only timing but now decides
  via `requirePage(getAuthSnapshot(), 'operations') === 'login'` (the store reflects the terminal
  Firebase identity by then, fed by the Phase-2 bridge). `clearSession()` + overlay unchanged.
- **Unchanged:** `sessionReady`, every write handler, the read cards, all chrome/card behaviour,
  the `throw`s (kept — see 4a.2). Small diff at the top of `operations-app.js`; imports
  `requirePage` + `getAuthSnapshot`.

### 4a.2 — testable `init()` wrap + `throw`→`return` — BUILT (Operations v14.65; Links + Paycalc v14.67)
The plan's "wrap each coordinator in an exported `init()`, remove the top-level throws" is a real
goal but is a large re-indent and needs import-mocks (or full dep-injection) to unit-test the wiring
— so it was deferred from 4a (kept that diff small) and picked up once the consumption pattern was
proven. Each wrapped coordinator's body is `export function init()`, invoked by a `<page>-boot.js`
2-line bootstrap (CSP `script-src 'self'` blocks an inline call; the boot file also keeps `init`
importable without auto-running, for tests). The transform is mechanical and behaviour-preserving
(`git diff -w` shows only the wrapper + `throw`→`return` + brace); nothing imports these coordinators,
so function-scoping their module-level symbols breaks no consumer.

**Scope decision — wrap the HALT-style coordinators, not the BRANCH-style ones.** The wrap's
load-bearing benefit is turning a module-aborting top-level `throw` into a clean early `return`.
- **Operations, Links, Paycalc** HALT on a failed gate (top-level `throw`) → wrapped. Paycalc's gate
  was an IIFE-with-throw; it was de-IIFE'd to a plain `if (...) return;` inside `init()`.
- **Admin, Settings** BRANCH instead (`if (authed) { init } else { showLogin }`) and have **no
  top-level throw**, so the wrap would be a large re-indent (Admin ~1620 lines) for only *latent*
  testability — not worth the risk. Left inline by design. (Revisit if/when their wiring is unit-tested.)

### 4b — self-healing admin reads (the one beneficial behaviour change) — BUILT v14.62
The three admin read cards (work-email / error-log / usage) read admin-gated collections. The
observed latency was NOT the `sessionReady` await (which resolves on the same `onAuthStateChanged`
the reads would optimistically start from — so an "optimistic start" that skips it buys nothing);
it was a **stale-claim `permission-denied`**. Immediately after "Set up accounts" the freshly-minted
token has no `admin` claim yet (Firebase refreshes ID tokens only ~hourly), so the first read fails
even though the account IS an admin. So 4b is **retry-only**, not optimistic-start: keep
`await sessionReady`, then run each read through `adminReadWithRetry(readFn)` in `operations-app.js`
— on `permission-denied` with a live user it `getIdToken(true)` once (force-refresh → pick up the
claim) and retries once; any other error re-throws to the card's existing silent-fallback catch.
The optimistic-start idea was dropped as no-benefit. Separate + revertible.

### Tests & safety net
- **Behaviour preservation is proven by the EXISTING e2e passing UNCHANGED**: admin loads (not
  redirected), non-admin redirected, not-signed-in shows the overlay, B1 `failSignIn` re-shows
  login. `requirePage` itself is already unit-tested (auth-policy.test.mjs).
- **Rollback:** revert the single `operations-app.js` commit — isolated to one coordinator, no
  shared-module change. **Verify in a private window, never an installed phone.**
