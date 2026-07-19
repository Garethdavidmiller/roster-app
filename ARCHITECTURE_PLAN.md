# ARCHITECTURE_PLAN.md — Auth/session consolidation (Track 1) and supporting refactors

*Track 1 (the identity state machine + page-auth policy) is **COMPLETE** and behaviour-preserving; it
landed **before** B3 (the strict override-isolation cutover, which then shipped v16.29 —
`SECURITY_RELEASE_PLAN.md`). This is the architectural counterpart to the security release:
`SECURITY_RELEASE_PLAN.md` decides *what the rules enforce*; this plan decides *how the client reasons
about identity so the rules can be tightened safely*. Not version-stamped; not a runtime asset.*

*Code comments cite this file by **Phase number** (1, 2, 3, 4a, 4a.2, 5, 6, 7, 9), by **Track 1**, and
by **MILLER_ACTUALS** — keep those anchors when editing. Trimmed v17.79: the completed-migration
planning narrative (Phase-0 test matrix, acceptance-criteria checklist, risk/rollback table, track
sequencing) was removed once it shipped; what remains is the **live architecture** — the two pure
layers, the design rules/guardrails, the per-phase reference code points at, and the decisions.*

---

## The one invariant (read this first)

**Client-side auth state is UX and optimisation. It is NEVER the security boundary.** The actual
boundary is **Firestore Rules + Cloud Functions claim checks**, server-side. Everything here — the
state machine, `hasClaim()`, optimistic reads, even "writes authorise strictly" — decides what the
client *attempts* and *renders*, not what is *allowed*. Two consequences make the refactor safe by
construction:

1. **Optimistic reads are safe** precisely because the server is authoritative. A stale client token
   that *claims* `admin` after the server revoked it just yields `permission-denied` (→ force-refresh +
   retry), never access. The client claim check is a latency optimisation.
2. **No client refactor can weaken security**, because the client was never enforcing it.

State it in code as: **the client decides what to *attempt* and what to *render*; the server decides
what is *allowed*.** (The scattered-reconciliation model this replaced was the root of a recurring bug
class — the v10.94 outage, the "bell stuck off-lapsed" bug, the Operations-card latency/race — all
"the two identity systems briefly disagreed and some page handled it its own way." One tested machine
removes that class as a foundation.)

---

## Non-goals (this refactor does NOT)

- Change Firestore/Storage Rules, or implement B3 / any claim-enforcement behaviour change.
- Change **who can access which page or perform which action** — behaviour is preserved.
- Change Pay Calculator calculations or any feature logic.
- Introduce a framework, bundler, or build step.
- Migrate the roster **data structure**, remove/alter GitHub Pages support, or solve surname passwords
  (Track C in the security plan).
- Make the public/anonymous-readable calendar data private.
- Move `MILLER_ACTUALS` — a **separate** privacy task (see its section), not on the auth critical path.
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
| `anonymous` | anonymous Firebase fallback present (valid only where policy allows) |
| `signedOut` | no valid local session, no anonymous identity |
| `degraded` | transient Firebase/network failure mid-resolution (retryable) |
| `error` | non-recoverable auth/session problem |

`needsLogin` and `forbidden` are deliberately **not** identity states — the same `named` user is
"forbidden" on Operations but "allowed" on Admin. They are **policy outcomes** (Layer 2). Keeping them
out of the reducer is what delivers the authentication/authorisation separation.

### Layer 2 — Page-auth policy (authorisation) — *pure* (`auth-policy.js`, Phase 3)

`requirePageAuth(snapshot, policy) → { decision, reason }`, driven by a **declarative policy map** — the
single home for the per-page rules once smeared across six coordinators, and for `ENFORCE_NAMED_SESSION`
+ the hard/soft matrix. Decisions: `allow / soft-allow / login / forbidden / pending` (`pending` was
added vs the original four for the resolving/degraded "not yet" states, which `subscribeAuth` fires on).

| Page | Local session | Firebase (read) | Firebase (write) | Role | Anonymous |
|------|---------------|-----------------|------------------|------|-----------|
| Calendar | optional | anonymous ok | n/a | none | yes |
| Admin | required | named | **named + fresh claims** | admin *or* manager (per action) | no |
| Operations | required | named | **named** | master admin | no |
| Links | required | named | **named** | designer | no |
| Settings | required | named (writes) | **named** | owner/admin | no |
| Pay Calculator | required | best-effort | best-effort | none | **soft** |
| Guides | — | — | — | — | n/a |

**Start page-based; leave the seam for action-based.** Policy keys can later evolve `page → page.action`
(e.g. `admin.writeAnyOverride`) **without touching the reducer**, because granularity lives entirely in
the authz layer. Do not build action-level policy on day one.

### The store — `auth-state.js` (Phase 2), fed by `session.js`

`getAuthSnapshot` / `subscribeAuth` / `dispatchAuth` over the reducer, importing only
`auth-state-core.js`. **Deliberate refinement vs the original plan:** rather than build a NEW shell that
re-wraps Firebase/localStorage (duplicating `session.js`), the **existing `session.js` is the adapter**
and FEEDS the store — `ensureNamedSession` dispatches `RESOLVE_START → (TRANSIENT/RETRY) →
NAMED/ANONYMOUS/NONE/FATAL` from the B0 signals; `clearSession` dispatches `SIGN_OUT`. Acyclic:
`session.js → auth-state.js → auth-state-core.js`.

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
preserve local/cached read-only UX. Any privileged write under `degraded` collapses to `signedOut`.**

| Page / action | Degraded behaviour |
|---------------|--------------------|
| Calendar read | allow cached/anonymous display |
| Pay Calculator | allow local calculator use |
| Settings read | allow local view; **block cloud save** |
| Admin / Operations / Links pages | render a clear degraded/blocked state |
| Override write/delete, roster upload, doc uploads, auth setup, link-design save | **block** |

---

## Reads hydrate optimistically; writes authorise strictly

The practical rule that avoids both bad extremes (everything-waits = slow blank cards;
everything-trusts-local = fake security):

- **Reads** may proceed once `snapshot.firebaseUser && snapshot.hasClaim(role)` — even while `resolving`.
  On `permission-denied`, call `refreshClaims()` (force `getIdToken(true)`) **once** and retry **once**.
- **Writes** must await `state === 'named'` with fresh-enough claims, per the policy map.
- **Local session alone is never sufficient for a privileged cloud write.**

Formalised as a load-bearing comment so it can't be quietly weakened:

```js
// Design rule (ARCHITECTURE_PLAN.md):
// Reads may hydrate optimistically once a Firebase user and the required claim are present.
// Privileged writes must wait for a confirmed named identity and fresh-enough claims.
// Local session alone is NEVER sufficient for a privileged cloud write.
// The server (Firestore Rules / Functions) is the boundary; this is UX, not enforcement.
```

---

## The phases (what landed — code cites these by number)

Behaviour-preserving throughout; the suite passed unchanged (665 unit + 173 rules + 68 e2e at the
Track-1 refactor; ~1,020 unit now). The live modules + tests are the source of truth for detail.

- **Phase 0 — characterisation net (v14.57):** pinned *current intended* behaviour before the refactor
  (not known bugs). `session.test.mjs` (getSession expiry edges incl. the missing-`lastActivity` NaN
  edge + no-signOut-on-passive-expiry; ensureFirebaseSession reuse/sign-in/self-heal/anon-fallback/
  shared-device switch; ensureNamedSession transient-then-recover), the B2 3-tier rules tests, and the
  10 flag-ON e2e for the page matrix.
- **Phase 1 — `auth-state-core.js` (v14.58):** the pure `reduceAuthState(prev, event) → next` +
  `INITIAL_STATE` + `AUTH_STATUSES`. 7 states, 8 events (RESOLVE_START/NAMED/ANONYMOUS/NONE/TRANSIENT/
  RETRY/FATAL/SIGN_OUT); unknown events inert; every result a new frozen object. 24 tests.
- **Phase 2 / 2.5 — `auth-state.js` store + the `sessionReady`-untouched decision (v14.59):** see "The
  store" above. Store `auth-state.test.mjs` (9); bridge `session.test.mjs` "auth-store bridge" (6).
- **Phase 3 — `auth-policy.js` (v14.60):** `PAGE_POLICIES` + pure `requirePageAuth → {decision,reason}`
  (5 decisions) + `rolesFor(member)` + `requirePage(snapshot, page)` (fails closed on unknown page).
  Encodes the invariants (degraded never grants → `pending`; soft never blocks; public always allows).
  42 tests. Consumed by the 5 write coordinators' access gate (active since the v14.98 B1 re-enable).
- **Phases 4–7 — coordinators migrated to consume the store + policy** (each body → exported `init()`
  called by a 2-line `*-boot.js`; top-level `throw` → early `return`; access via `requirePage`). Order
  and the beneficial change per phase are in **Appendix: Phase 4 detailed scope**. Summary: **Operations**
  (4a v14.61 structural; **4b v14.62** self-healing admin reads — the one behaviour change); **Links**
  (Phase 5, v14.63); **Admin** (Phase 6, v14.64); **Settings + Pay Calculator** (Phase 7, v14.66 — Pay
  stays **soft**; its no-local-session→login gate is deliberately OUTSIDE the policy because paycalc
  needs a local member identity to namespace localStorage). **Phase 4a.2:** all five coordinators are
  now wrapped in `init()` + `*-boot.js` (the HALT-style trio Operations/Links/Paycalc first, then Admin
  `admin-boot.js` + Settings `settings-boot.js` v17.09). Calendar is left un-migrated (most staff-visible)
  unless B3 required it — it did not.
- **Phase 8 — B3** (strict token-refresh sweep): handed to `SECURITY_RELEASE_PLAN.md`; **shipped v16.29**
  as a policy-led change, not six coordinator rewrites.
- **Phase 9 — in-place sign-in** (remove the post-login reload): **rollout complete v15.17** — see
  **Appendix: Phase 9**.

---

## MILLER_ACTUALS — privacy task — ✅ RESOLVED (Option A privacy + Option B feature, v14.68–v14.69)

**Done as Track 2 step 1.** `MILLER_ACTUALS` (13 periods of real payslip figures) was moved OUT of the
served `roster-data.js` into `test-fixtures/miller-actuals.js`, **excluded from Firebase Hosting**
(`firebase.json` `ignore` → `test-fixtures/**`) so it is no longer fetchable; `paycalc.test.mjs` imports
the fixture as its single source. This closes the (small) privacy exposure — in a no-build app any
served JS file is publicly fetchable, and these were real payslip figures.

**The in-app "Actual Take-Home" comparison was kept, made DEVICE-LOCAL (Option B, v14.69):** the owner
imports the figures once per device via an owner-only paste box (Settings → "Import payslip actuals"),
stored under the member-namespaced `myb_pc_<slug>_actuals` (`payslipActualsKey`/`readPayslipActuals`/
`writePayslipActuals`/`clearPayslipActuals` in `paycalc-migrations.js`); `paycalc-app.js`/`paycalc-hpp.js`
read it there (gated to G. Miller) and degrade to the normal estimate everywhere else. Options
considered (for the record): **A — test-only fixture (chosen)**; B — device-local (chosen for the
feature); C — owner-only Firestore doc (cross-device but heavy). **Anti-patterns avoided:** moving it to
another *served* JS file, URL-obscurity, or leaving it in `roster-data.js`.

---

## Track ranking — the decisions

1. **Track 1 — Auth state machine** — done; was highest priority (before B3), behaviour-preserving.
2. **Track 3 — Testable coordinators** — done; it is *how* Track 1 landed (Phases 4–7).
3. **Track 2 — Split `roster-data.js`** — ❌ **REJECTED (Jul 2026, WON'T DO)** (step 1, `MILLER_ACTUALS`,
   was already done for a privacy reason and stands). **Why rejected:** the payoff is cosmetic (smaller
   files) with a wide blast radius and no correctness/security benefit. `roster-data.js` is ~1,020 lines
   but well-organised (CONFIG → `teamMembers` → roster-logic) and stable; it's imported by ~40 files,
   sits in the SW precache + modulepreload graphs, and holds `APP_VERSION` (the primary version source),
   so a split touches all of that, and the barrel-shim leaves MORE files unless you also rewrite 40
   imports (the risky step). **Revisit only if** it becomes a genuine pain point (frequent conflicts, or
   a section needing independent testing/reuse) OR a Vite build step is adopted.
4. **Track 4 — CJS/ESM duplication** — leave alone (parity tests cover it; surname passwords retire in
   security Track C).

---

## Claude Code guardrails (for any future session)

- **Do not combine Track 1 with B3.** Refactor first; behaviour change later.
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

**4a — consume `requirePage` + the store (v14.61):** the two top-level access gates (`!currentUser` /
`!isAdmin`) became ONE `requirePage(...)` decision (`login`→overlay, `forbidden`→redirect to admin,
`allow`→continue), with a synthesised local-derived snapshot preserving the fast localStorage render.
The B1 check decides via `requirePage(getAuthSnapshot(), 'operations')`. `sessionReady`, write handlers,
and read cards unchanged.

**4a.2 — testable `init()` wrap + `throw`→`return` — ALL FIVE coordinators:** each body is
`export function init()`, invoked by a `<page>-boot.js` 2-line bootstrap (CSP `script-src 'self'` blocks
an inline call; the boot file keeps `init` importable without auto-running, for tests). The HALT-style
trio shipped first (Operations v14.65; Links + Paycalc v14.67) — turning a module-aborting top-level
`throw` into a clean early `return`; the branch-style pair (Admin `admin-boot.js`, Settings
`settings-boot.js` v17.09) followed (superseding the earlier "leave Admin/Settings inline" decision).
Note: the in-place-login re-invocation on Admin/Settings calls their nested `initAuthorised()`, not
`init()`.

**4b — self-healing admin reads (v14.62):** the three admin read cards (work-email/error-log/usage) read
admin-gated collections. The observed latency was NOT the `sessionReady` await — it was a **stale-claim
`permission-denied`**: immediately after "Set up accounts" the freshly-minted token has no `admin` claim
yet (Firebase refreshes ID tokens ~hourly), so the first read fails though the account IS admin. So 4b is
**retry-only, not optimistic-start**: keep `await sessionReady`, then run each read through
`adminReadWithRetry(readFn)` in `operations-app.js` — on `permission-denied` with a live user, one
`getIdToken(true)` (force-refresh → pick up the claim) + one retry; any other error re-throws to the
card's existing silent-fallback catch. Separate + revertible.

---

## Appendix: Phase 9 — Remove the post-login reload (in-place sign-in) — ✅ ROLLOUT COMPLETE (v15.17)

All five coordinators sign in IN PLACE — after a confirmed sign-in the login overlay is torn down
(`overlay.remove()` + `unlockBodyScroll()`) and the page initialises without `window.location.reload()`.
Built v14.81–83 behind the per-page `CONFIG.INPLACE_LOGIN` flag (default OFF), enabled one page at a time
(paycalc v15.07 → operations v15.08 → links v15.09 → admin v15.16 → settings v15.17), after login was
confirmed stable (freeze fixed v14.75, B1 re-enabled v14.98).

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

**Deliberately stays a reload:** the **B1 re-show path** (`ENFORCE_NAMED_SESSION` on + named session
fails after an apparently-valid local session → `clearSession()` + overlay — session *invalidation*,
rare); and paycalc's **data-ownership** `resolveLegacyMigration → reload`.

**Kill-switch (live):** the per-page `CONFIG.INPLACE_LOGIN` object — set any key back to `false` to
revert just that page to the reload path (per-page, not one global boolean — the lesson from the B1
global flip). NOT the B1 risk class: it changes only post-sign-in rendering, never whether auth succeeds,
and every in-place `onSuccess` falls back to `reload()` if `init()`/`initAuthorised()` throws — a bad
page self-heals, never locks anyone out. Coverage: 5 e2e no-reload tests + the whole suite passing with
the flag OFF.

*(A further "Phase 10 — remove the duplicate post-login `ensureNamedSession`" idea was scoped v14.86 and
**deliberately not built** — since v14.84 the `auth.currentUser` fast path makes the second call a
synchronous near-noop, so only contract cleanliness remained. Drop with no real loss; if ever built,
admin+settings only, in-place `onSuccess` path only, behind `INPLACE_LOGIN`, with tests asserting no
write hits a non-live `auth.currentUser`.)*
