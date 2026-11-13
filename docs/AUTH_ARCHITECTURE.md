# AUTH_ARCHITECTURE.md — how the client reasons about identity

*Not version-stamped; not a runtime asset. Not to be confused with `ARCHITECTURE.md`, the documents
index — the two are unrelated.*

*Track 1 (the identity state machine + page-auth policy) is **COMPLETE** and was behaviour-preserving;
it landed before B3, the strict override-isolation cutover. This is the architectural counterpart to
the security release: `SECURITY_RELEASE_PLAN.md` decides *what the rules enforce*; this file records
*how the client reasons about identity so the rules can be tightened safely*.*

*Code comments cite this file by **Phase number** (1, 2, 3, 4a, 4a.2, 5, 6, 7, 9), by **Track 1**, and
by **PAYSLIP_ACTUALS** — keep those anchors when editing. What remains is the **live architecture**:
the two pure layers, the design rules and guardrails, the per-phase reference code points at, and the
decisions.*

---

## The one invariant (read this first)

**Client-side auth state is UX and optimisation. It is NEVER the security boundary.** The actual
boundary is **Firestore Rules + Cloud Functions claim checks**, server-side. Everything here — the
state machine, claim-aware retries (`withClaimRetry`), optimistic reads, even "writes authorise strictly" — decides what the
client *attempts* and *renders*, not what is *allowed*. Two consequences make the design safe by
construction:

1. **Optimistic reads are safe** precisely because the server is authoritative. A stale client token
   that *claims* `admin` after the server revoked it just yields `permission-denied` (→ force-refresh +
   retry), never access. The client claim check is a latency optimisation.
2. **No client refactor can weaken security**, because the client was never enforcing it.

State it in code as: **the client decides what to *attempt* and what to *render*; the server decides
what is *allowed*.** The scattered-reconciliation model this replaced was the root of a recurring bug
class — "the two identity systems briefly disagreed and some page handled it its own way". One tested
machine removes that class as a foundation.

---

## Non-goals (Track 1 did NOT)

- Change Firestore/Storage Rules, or implement B3 / any claim-enforcement behaviour change.
- Change **who can access which page or perform which action** — behaviour was preserved.
- Change Pay Calculator calculations or any feature logic.
- Introduce a framework, bundler, or build step.
- Migrate the roster **data structure**, remove/alter GitHub Pages support, or solve surname passwords
  (Track C in the security plan).
- Make the Calendar's data private — that came later and separately, through the staff PIN
  (`AUTH_PLAN.md` → E2).
- Move `PAYSLIP_ACTUALS` — a **separate** privacy task (see its section), not on the auth critical path.
- Build a general app-wide state store (the machine owns identity only).

---

## The design: two pure layers over one thin shell

### Layer 1 — Identity state machine (authentication) — *pure* (`auth-state-core.js`, Phase 1)

`reduceAuthState(prevState, event) → nextState`. **No DOM, no Firebase, no localStorage, no redirects.**
States are **identity facts only**:

| State | Meaning |
|-------|---------|
| `initialising` | nothing checked yet |
| `resolving` | local session present; Firebase identity being restored/established |
| `named` | correct named Firebase user confirmed |
| `anonymous` | anonymous Firebase fallback present — no producer (nothing signs in anonymously); kept in the reducer |
| `signedOut` | no valid local session, no anonymous identity |
| `degraded` | transient Firebase/network failure mid-resolution (retryable) |
| `error` | non-recoverable auth/session problem |

`needsLogin` and `forbidden` are deliberately **not** identity states — the same `named` user is
"forbidden" on Operations but "allowed" on Admin. They are **policy outcomes** (Layer 2). Keeping them
out of the reducer is what delivers the authentication/authorisation separation.

### Layer 2 — Page-auth policy (authorisation) — *pure* (`auth-policy.js`, Phase 3)

`requirePageAuth(snapshot, policy) → { decision, reason }`, driven by a **declarative policy map**
(`PAGE_POLICIES`) — the single home for the per-page rules and the hard/soft matrix. Decisions:
`allow / soft-allow / login / forbidden / pending` (`pending` covers the resolving/degraded "not yet"
states). A page reads the store's snapshot (`getAuthSnapshot()`) when its own session settles;
`subscribeAuth` exists, but nothing in production subscribes (`auth-state.js`).

| Page | Local session | Firebase (read) | Firebase (write) | Role | Anonymous |
|------|---------------|-----------------|------------------|------|-----------|
| Calendar | optional | a member or the `calendarViewer` capability (staff PIN) — anonymous reads nothing | n/a | none | session only, grants no read |
| Admin | required | named | **named + fresh claims** | admin *or* manager (per action) | no |
| Operations | required | named | **named** | master admin | no |
| Links | required | named | **named** | designer | no |
| Settings | required | named (writes) | **named** | owner/admin | no |
| Pay Calculator | required | best-effort | best-effort | none | **soft** |
| Overtime | required | named | **named** | admin, manager *or* `overtimeBeta` participant — **paused, closed to everyone** (`OVERTIME_AVAILABILITY.md` → Paused) | no |
| Trains | required, or the staff PIN | — (no Firestore reads) | — | none | no |
| New link | required | — (no Firestore reads) | — | master admin, a name in `CONFIG.NEWLINK_PREVIEW`, or `newlinkAudience` — a normal CEA contract or a manager (since v25.60) | no |
| Guides | — | — | — | — | n/a |

**Start page-based; leave the seam for action-based.** Policy keys can later evolve `page → page.action`
(e.g. `admin.writeAnyOverride`) **without touching the reducer**, because granularity lives entirely in
the authz layer. Do not build action-level policy on day one.

### The store — `auth-state.js` (Phase 2), fed by `session.js`

`getAuthSnapshot` / `subscribeAuth` / `dispatchAuth` over the reducer, importing only
`auth-state-core.js`. **Deliberate refinement vs the original plan:** rather than build a NEW shell that
re-wraps Firebase/localStorage (duplicating `session.js`), the **existing `session.js` is the adapter**
and FEEDS the store — `ensureNamedSession` dispatches `RESOLVE_START → (TRANSIENT/RETRY) →
NAMED/NONE` from the B0 signals (ANONYMOUS and FATAL have no producer); `clearSession` dispatches
`SIGN_OUT`. Acyclic: `session.js → auth-state.js → auth-state-core.js`.

**`sessionReady` is left UNTOUCHED (Phase 2.5 decision).** Re-routing it through the machine was risk
for zero benefit (every write page awaits it). Instead the store and `sessionReady` are **both driven by
the same `ensureNamedSession` resolution**, so they cannot diverge — the "single source" property
achieved with zero change to `sessionReady`. The literal re-route was dropped, not deferred.

**Concurrency win:** a single-owner machine with one in-flight resolution eliminates the class of bug
where concurrent `ensureFirebaseSession` calls reset/race the `_fbIdentity` global ("works after reload",
the Operations race). **Not a state framework** — it owns identity only (session expiry, Firebase
restore/sign-in/out, named-vs-anonymous, token refresh, auth-error classification, role claims, page
policy), NOT page/card/form UI, Pay Calculator data, roster data, or nav state.

---

## Degraded-state rules (the most important guardrail)

`degraded` must never become a privilege loophole. Forbidden anti-pattern: *"Firebase is degraded, so
carry on because the local session says admin."* **Rule: degraded never grants authority; it may only
preserve local/cached read-only UX.** What happens instead (since v24.61): a sign-in that never
reached an answer is TRANSIENT, so the store stays `degraded`; the page policy answers `pending`; and
the page keeps the 60-day local session and shows the sign-in over it (`guardNamedSession`,
`page-session.js`), reloading into the identity if it lands late. Nothing can be written meanwhile:
every write needs an identity whose claim the rules accept (AUTH_AND_SESSIONS 9). The store no longer collapses to
`signedOut` here — that would have cleared the session of a member whose network merely stalled.

| Page / action | Degraded behaviour |
|---------------|--------------------|
| Calendar read | allow the cached display once access is granted |
| Pay Calculator | allow local calculator use |
| Settings read | allow local view; **block cloud save** |
| Admin / Operations / Links pages | render a clear degraded/blocked state |
| Override write/delete, roster upload, doc uploads, auth setup, link-design save | **block** |

---

## Reads hydrate optimistically; writes authorise strictly

The practical rule that avoids both bad extremes (everything-waits = slow blank cards;
everything-trusts-local = fake security):

- **Reads** may proceed once there is a Firebase user — even while `resolving`. On `permission-denied`,
  run through `withClaimRetry` (`firebase-client.js`, over `runWithClaimRetry` in `claim-retry.js`):
  force `getIdToken(true)` **once** and retry **once**.
- **Writes** must await `state === 'named'` with fresh-enough claims, per the policy map.
- **Local session alone is never sufficient for a privileged cloud write.**

Formalised as a load-bearing comment so it can't be quietly weakened:

```js
// Design rule (AUTH_ARCHITECTURE.md):
// Reads may hydrate optimistically once a Firebase user and the required claim are present.
// Privileged writes must wait for a confirmed named identity and fresh-enough claims.
// Local session alone is NEVER sufficient for a privileged cloud write.
// The server (Firestore Rules / Functions) is the boundary; this is UX, not enforcement.
```

---

## The phases (what landed — code cites these by number)

Behaviour-preserving throughout. The live modules + tests are the source of truth for the detail.

- **Phase 0 — characterisation net:** pinned *current intended* behaviour before the refactor (not
  known bugs) — `session.test.mjs`'s expiry and `ensureFirebaseSession` edges, the 3-tier rules tests,
  and e2e for the page matrix.
- **Phase 1 — `auth-state-core.js`:** the pure `reduceAuthState(prev, event) → next` +
  `INITIAL_STATE` + `AUTH_STATUSES`. 7 states, 8 events (RESOLVE_START/NAMED/ANONYMOUS/NONE/TRANSIENT/
  RETRY/FATAL/SIGN_OUT); unknown events inert; every result a new frozen object.
- **Phase 2 / 2.5 — `auth-state.js` store + the `sessionReady`-untouched decision:** see "The store"
  above.
- **Phase 3 — `auth-policy.js`:** `PAGE_POLICIES` + pure `requirePageAuth → {decision,reason}`
  (5 decisions) + `rolesFor(member)` + `requirePage(snapshot, page)` (fails closed on unknown page).
  Encodes the invariants (degraded never grants → `pending`; soft never blocks; public always allows).
  Consumed by every protected page's access gate.
- **Phases 4–7 — coordinators migrated to consume the store + policy** (each body → exported `init()`
  called by a 2-line `*-boot.js`; top-level `throw` → early `return`; access via `requirePage`). Order
  and the beneficial change per phase are in **Appendix: Phase 4 detailed scope**. Summary: **Operations**
  (4a structural; **4b** self-healing admin reads — the one behaviour change); **Links** (Phase 5);
  **Admin** (Phase 6); **Settings + Pay Calculator** (Phase 7 — Pay stays **soft**; its
  no-local-session→login gate is deliberately OUTSIDE the policy because paycalc needs a local member
  identity to namespace localStorage). **Phase 4a.2:** every protected page's coordinator is wrapped in
  `init()` + `*-boot.js`. The Calendar was left un-migrated (most staff-visible) unless B3 required it — it did
  not.
- **Phase 8 — B3** (strict token-refresh sweep): handed to `SECURITY_RELEASE_PLAN.md`, and shipped as a
  policy-led change, not six coordinator rewrites.
- **Phase 9 — in-place sign-in** (remove the post-login reload): see **Appendix: Phase 9**.

---

## PAYSLIP_ACTUALS — privacy task — ✅ RESOLVED

**The real payslip figures are never served and never in the repository.** The thirteen real periods
that the pay-maths regression checks against live in `test-fixtures/payslip-actuals.local.js`, which is
**gitignored** (`*.local.js`), so only the owner's checkout holds them.

**Why a gitignore and not an ignore list.** The app has TWO live origins. `firebase.json`'s
`test-fixtures/**` exclusion governs Firebase Hosting; the GitHub Pages staff mirror serves every
committed file but the hidden ones such as `.claude/`, and reads no ignore list (measured: a fixture
there returned `200`). An exclusion list expresses a decision for an origin that reads it, and the
mirror does not read one. Keeping the bytes out of the repository is the only rule BOTH origins obey.
`sw-asset-check.test.mjs` guards the `.gitignore` rule itself, because a deleted line there re-opens
this the next time somebody runs `git add -A` on a machine that holds the file. **The same limitation
applies to anything else the exclusion list hides** — it governs one origin, not two.

**Options considered and declined.** Synthesised figures lose the "matches a real payslip" property
that is the fixture's whole value, and a green run against invented numbers REPORTS the payslip
regression as passing — so `payslip-actuals.example.js` documents the shape and is deliberately never
imported. Retiring the mirror remains the stated direction and is unaffected; this stopped waiting for
it. Moving the figures to another *served* JS file, URL-obscurity, or leaving them in `roster-data.js`
were anti-patterns from the start.

**What it costs, stated rather than glossed:** on any checkout but the owner's, the payslip regression
does not run — computeSL against every clean Plan 1 deduction, tax within £1 and NI within 20p of
thirteen real payslips, the cumulative-PAYE pair, and the take-home reconciliation. `paycalc.test.mjs`
announces exactly that as a SKIP rather than letting the assertions quietly stop existing, which is
what a loop over an absent fixture would otherwise do: register nothing, and report a smaller green
number that reads identically to a passing one. `npm run test:payslip-local` is the lane that requires
it (`.claude/rules/paycalc.md` → Example payslips).

**History was deliberately not rewritten** (owner decision): the figures remain in old commits. A scrub
rewrites every SHA on `main`, breaks existing clones, stales every commit link in these documents, and
does not recall what GitHub has already served. Recorded in KNOWN_LIMITATIONS.md rather than quietly
accepted.

**The in-app "Actual Take-Home" comparison is DEVICE-LOCAL.** Pay data is kept off the server. The
owner imports the figures once per device via an owner-only paste box (Pay Calculator → "Import payslip
actuals (this device)"), stored under the member-namespaced `myb_pc_<slug>_actuals`
(`payslipActualsKey`/`readPayslipActuals`/`writePayslipActuals`/`clearPayslipActuals` in
`paycalc-migrations.js`); `paycalc-app.js`/`paycalc-hpp.js` read it there (gated to the developer
account by `isActualsDev`) and degrade to the normal estimate everywhere else. An owner-only Firestore
doc (cross-device) was considered and declined as heavy.

---

## Track ranking — the decisions

1. **Track 1 — Auth state machine** — done; was highest priority (before B3), behaviour-preserving.
2. **Track 3 — Testable coordinators** — done; it is *how* Track 1 landed (Phases 4–7).
3. **Track 2 — Split `roster-data.js`** — ❌ **REJECTED (Jul 2026, WON'T DO)** (step 1, `PAYSLIP_ACTUALS`,
   was done for a privacy reason and stands). **Why rejected:** the payoff is cosmetic (smaller
   files) with a wide blast radius and no correctness/security benefit. `roster-data.js` is well-organised
   (CONFIG → `teamMembers` → roster-logic) and stable; it is imported very widely, sits in the SW
   precache + modulepreload graphs, and holds `APP_VERSION` (the primary version source), so a split
   touches all of that, and a barrel shim leaves MORE files unless every import is rewritten too (the
   risky step). **Revisit only if** it becomes a genuine pain point (frequent conflicts, or a section
   needing independent testing/reuse) OR a build step is adopted. **Two data tables have since moved
   out on their own merits** — `teamMembers` to `roster-member-data.js` and the cycle patterns to
   `roster-cycle-data.js` — both re-exported by `roster-data.js`, so no importer changed.
4. **Track 4 — CJS/ESM duplication** — leave alone (parity tests cover it; surname passwords retire in
   security Track C).

---

## Claude Code guardrails (for any future session)

- **Do not combine an auth refactor with a rules cutover.** Refactor first; behaviour change later.
- **Do not change page-access behaviour during a refactor.** It is behaviour-preserving.
- **Do not add a build step, bundler, or framework.**
- **Do not create a general app-wide state store.** The machine owns identity only.
- **Do not move payslip actuals to another public served file** (see the privacy task).
- **Keep the `sessionReady` shim** and **the server as the security boundary** — never treat client auth
  state as enforcement.

---

## Appendix: Phase 4 detailed scope (Operations first) — ✅ DONE

Phase 4 made the FIRST coordinator (Operations) actually CONSUME the store + policy, as 4a (structural,
behaviour-preserving) then 4b (the one beneficial behaviour change).

**4a — consume `requirePage` + the store:** the two top-level access gates (`!currentUser` /
`!isAdmin`) became ONE `requirePage(...)` decision (`login`→overlay, `forbidden`→redirect to admin,
`allow`→continue), with a synthesised local-derived snapshot preserving the fast localStorage render.
The B1 check decides via `requirePage(getAuthSnapshot(), 'operations')`. `sessionReady`, write handlers,
and read cards unchanged.

**4a.2 — testable `init()` wrap + `throw`→`return` — every protected page:** each body is
`export function init()`, invoked by a `<page>-boot.js` 2-line bootstrap (CSP `script-src 'self'` blocks
an inline call; the boot file keeps `init` importable without auto-running, for tests). A
module-aborting top-level `throw` became a clean early `return`. Note: the in-place-login
re-invocation on Admin/Settings calls their nested `initAuthorised()`, not `init()`.

**4b — self-healing admin reads:** the admin read cards read admin-gated collections. The observed
latency was NOT the `sessionReady` await — it was a **stale-claim `permission-denied`**: immediately
after "Set up accounts" the freshly-minted token has no `admin` claim yet (Firebase refreshes ID tokens
~hourly), so the first read fails though the account IS admin. So 4b is **retry-only, not
optimistic-start**: keep `await sessionReady`, then run each read through `withClaimRetry`
(`firebase-client.js`) — on `permission-denied` with a live user, one `getIdToken(true)` (force-refresh
→ pick up the claim) + one retry; any other error re-throws to the card's existing silent-fallback
catch.

---

## Appendix: Phase 9 — Remove the post-login reload (in-place sign-in) — ✅ DONE

Every protected page signs in IN PLACE — after a confirmed sign-in the login overlay is torn down
(`overlay.remove()` + `unlockBodyScroll()`) and the page initialises without `window.location.reload()`.
The in-place path is the only path; its rollout flag was retired, so a rollback means reverting the
release.

**Honest payoff:** the reload never re-ran the *named sign-in* (IndexedDB auth-restore is fast) — the win
is skipping a full HTML reload + ES-module re-evaluation + a service-worker navigation cycle + a second
auth-restore + the white flash (a few hundred ms plus the flash).

**Mechanism (kept for maintenance):** `sessionReady` did not need replacing — on the login path nothing
awaits it. Each coordinator (a) defers `resolveSession` until the real sign-in (so `sessionReady` still
resolves once per page life), (b) runs its signed-in-only body exactly once — at load if already signed
in, else from the overlay's `onSuccess` (Admin/Settings via their extracted `initAuthorised()`, since
their in-place path must not re-run `init()`'s unconditional module wiring) — so no listener is wired
twice, and (c) `saveSession` precedes `onSuccess` in `runNamedSignIn`, so identity/namespace are
committed before the body runs.

**What keeps it safe:** every in-place `onSuccess` reloads if `init()`/`initAuthorised()` throws, or if
`saveSession` silently failed (iOS private mode) — a bad page self-heals, never locks anyone out.
Coverage: the no-reload tests in `e2e/auth.spec.js`.

**Deliberately stays a reload:** the **B1 re-show path** (named session fails after an
apparently-valid local session → `clearSession()` + overlay — session *invalidation*, rare); and
paycalc's **data-ownership** `resolveLegacyMigration → reload`.

*(A "Phase 10 — remove the duplicate post-login `ensureNamedSession`" was scoped and **deliberately not
built**: the `auth.currentUser` fast path makes the second call a synchronous near-noop, so only
contract cleanliness remained. If ever built: Admin and Settings only, the in-place `onSuccess` path
only, with tests asserting no write hits a non-live `auth.currentUser`.)*
