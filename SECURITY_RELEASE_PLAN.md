# SECURITY_RELEASE_PLAN.md — Phased plan for the security hardening work

*Status: in progress (created v14.38). **Current state (as of v17.22):***
- *Track A — **A2 Workload Identity Federation ✓ DONE (v14.93)** (keyless OIDC deploys; SA JSON key +
  secret deleted — see Appendix A2); A3 doc-only ✓ DONE (v14.38); **A1 ✓ DONE (v15.32)** — the `uuid`
  advisories were cleared with a scoped `uuid` override on the supported firebase-admin `^13`, NOT the
  v14 bump the plan originally assumed (v14 breaks the peer range + the namespaced API — see A1).*
- *Track B — B0 identity signal ✓ DONE (v14.39); **B1 named-session enforcement ✓ ENABLED** (v14.42,
  rolled back during the v14.72 login freeze, **re-enabled v14.98** after the freeze was fixed and B1
  exonerated — see LOGIN_INCIDENT.md); **B2 per-member override isolation BUILT + DEPLOYED permissive**
  (v14.53: the 3-tier `name || admin || manager || !name` rule + `manager` claim in `setupRosterAuth`,
  incl. delete + bounded date validation); **B3 — the strict cutover ✓ SHIPPED (v16.29)** — the
  `!name` legacy escape was removed from the `overrides` create/update AND delete rules, so writes now
  require `token.name == memberName || token.admin || token.manager`, shipped after re-provision + the
  `CLAIM_EPOCH == 2` sweep with `writeWithClaimRetry` self-healing stale tokens (no mass sign-out
  needed). **H2 ✓ SHIPPED (v16.29)** — `linkDesigns` writes now require `token.linksDesigner == true ||
  token.admin == true` (reads stay open); `setupRosterAuth` sets `linksDesigner` from
  `CONFIG.LINKS_DESIGNERS`, and every `links-app.js` write is wrapped in `writeWithClaimRetry` so a
  stale designer token self-heals. This SUPERSEDES the earlier "leave `linkDesigns` at
  `request.auth != null`" owner decision; since v17.02 `linkDesigns` create/update are also
  shape-validated (`hasOnly(['name','patterns','updatedAt','updatedBy'])` + typed fields).*
- *B4 (server-owned role lists) ✅ SHIPPED v16.30.*
- *Remaining security roadmap: surname-derived credential replacement (Track C), App Check enforcement
  (Track D), and the public-read / tokenised-document-URL decisions.*

*This is the master **ordering + go/no-go** doc; the detailed designs live in ROADMAP.md /
KNOWN_LIMITATIONS.md and are NOT duplicated here. Not version-stamped; not a runtime asset.*

This is the **master sequencing and risk document** for the deferred security work. The
detailed designs already live elsewhere and are NOT duplicated here — this file ties them
into an ordered, phased release with explicit dependencies, per-phase risk/rollback, and the
owner decisions each phase needs. Read alongside:

- ROADMAP.md → "Password security improvements" (the 5-stage password plan)
- ROADMAP.md → "Security project — per-member override write isolation" (staged rule plan)
- ROADMAP.md → "Dedicated security release" + "Infrastructure phase"
- KNOWN_LIMITATIONS.md → "The four v11 security tasks" (task #2 outage post-mortem) and
  "Firebase App Check — considered and declined"

**Why a separate plan doc:** the individual designs are sound, but they are scattered and
they *interlock* in ways that aren't obvious from any single entry. Shipping them in the
wrong order re-creates the exact v10.94 production outage (a rule requiring a token claim
that live sessions didn't carry). The value of this document is the **ordering and the
go/no-go gates**, not new feature detail.

---

## The one idea that drives the whole plan

Almost every item below shares a single failure mode: **a write silently fails because the
session is not the identity the rule (or App Check) expects.** This is what took the app down
at v10.94, and it is invisible from an installed phone (see KNOWN_LIMITATIONS → "The installed
PWA masks live-site breakage"). Three consequences shape the sequencing:

1. **`ensureFirebaseSession` must stop silently falling back to anonymous on write-pages
   *before* any rule starts requiring a named identity.** Today an auth failure lands the user
   on a claim-less anonymous session whose writes "work" only because the rule is
   `request.auth != null`. The moment a rule needs `token.name`, that same fallback becomes a
   silent lockout. This rework is the shared foundation of both the authorization release and
   the password release.

2. **Never run two silent-failure systems' cutovers at once.** Per-member isolation rollout and
   App Check *enforcement* both fail as "writes silently rejected." If they overlap you cannot
   tell which one locked a user out. They must be temporally separated.

3. **Migrate, don't cut over.** Any rule that newly requires a token claim ships first in a
   *permissive* form that accepts both old and new sessions, then tightens after a forced
   re-auth sweep. This converts the v10.94 hard-cutover lockout into a two-step migration with
   no lockout window. (Detail in Phase B3.)

---

## The identity tiers the rules must respect (READ BEFORE B2/B3/B4)

The app has **three** privilege tiers, defined in `roster-data.js`. Any isolation rule that only
thinks in "owner vs. admin" will silently lock out the middle tier — this is the manager-lockout
gap found while scoping B2, and it recurs in B3 and B4. State the tiers once, here, and have every
B-track phase reference them.

| Tier | Source list | Firebase claim they must carry | What they legitimately write |
|------|-------------|-------------------------------|------------------------------|
| **Master admin** | `CONFIG.ADMIN_NAMES` (`['G. Miller']`) | `{ admin: true, name }` | Everything — overrides for any member, huddle/circular/newsletter, roster upload, auth setup |
| **Management** | `CONFIG.MANAGER_NAMES` (6 names) | **`{ manager: true, name }`** ← set by `setupRosterAuth` since B2 (v14.53); live only on tokens minted after each manager was re-provisioned + refreshed | Overrides (AL/sick/shift) **on behalf of any staff member** — but NOT the master-admin uploads/auth-setup |
| **Staff** | everyone else | `{ name }` | Only their **own** overrides (`token.name == memberName`) |
| *Links designer* | `CONFIG.LINKS_DESIGNERS` (`['G. Miller', 'S. Silva']`) | *cross-cuts the above* — S. Silva is a **CEA**, not a manager. **The `linksDesigner` claim is LIVE (H2 ✓ SHIPPED v16.29)** — `setupRosterAuth` sets it from `CONFIG.LINKS_DESIGNERS` and `linkDesigns` writes are gated on it. What was done: add claim → re-provision → refresh → gate `linkDesigns` write; shipped in the B3 window (v16.29). The exact apply patch is live in `firestore.rules` (linkDesigns block) + `firestore.rules.test.mjs` (the H2 `describe`) | `linkDesigns` (designs are **not** member-owned) — server-write control is now the **`linksDesigner`/`admin` claim** (was client-redirect only until H2) |

**The gap B2 closed (pre-v14.53):** originally only `ADMIN_NAMES` was sent to `setupRosterAuth` as
`adminMembers`, so only G. Miller carried `admin: true`; managers carried just `{ name }`. The
*client* (`admin-app.js` `applyPermissions`) granted them full edit access, but **the Firestore
rules could not tell a manager from ordinary staff** — fine while the rule was `request.auth != null`,
but a silent lockout the moment a rule needed a claim. B2 (v14.53) shipped the fix; it is now live in
`setupRosterAuth` (managers get `manager: true`) and in the permissive isolation rule. The three
design points that flowed from this, still governing B3/B4:

- **B2 introduced the `manager: true` claim** (set by `setupRosterAuth` for `MANAGER_NAMES`) and the
  override rule checks `name == memberName || admin == true || manager == true`. (`linkDesigns` has its
  own separate `linksDesigner`/`admin` write gate — H2 ✓ SHIPPED v16.29 — so the "Links rules" are not
  part of this override check.) The master-admin-only collections (huddles, circulars, newsletters,
  roster upload, auth setup) stay `admin == true` only — do **not** grant managers `admin: true`, which
  would let them reach those APIs directly and dissolve the very tier separation `MANAGER_NAMES` exists
  to enforce.
- **B3's claims audit + token-refresh sweep covered all three tiers** (✓ SHIPPED v16.29) — a manager
  on a token minted before the `manager` claim existed would be rejected by the strict rule exactly
  like a staff member on a pre-`name` token, so the sweep + `writeWithClaimRetry` self-heal handled
  both before the escape was removed.
- **B4's server-owned lists must carry all three tiers** (admin + manager + designer), generated
  from `roster-data.js` so they cannot drift.

---

## Tracks and dependency graph

Four tracks. Tracks A and D are largely independent; Track B is the headline work; Track C
depends on B's foundation. **Do not bundle tracks** — each has a different blast radius
(CI deploys vs runtime authz vs login UX vs client gating), and bundling multiplies the
surface to debug when something goes silent.

```
  Track A — standalone infra (any time, parallelisable)
    A1 uuid advisories ✓ DONE .... (uuid override on firebase-admin ^13; did NOT need the v14 bump)
    A2 Workload Identity Fed ..... (isolated CI change; SA-JSON kept as fallback during cutover)
    A3 doc-only accuracy ✓ DONE .. (pushSubscriptions delete posture + bearer-URL notes; rule-tighten → B2)

  Track B — authorization release (interlocking; ONE planned release)
    B0 fb-identity signal ✓ DONE ─────┬─► B1 named-session separation (consumes B0 signal;
        (FOUNDATION; enforce → B1)     │      enforces re-login; removes browser account-creation)
                                       └─► B2 per-member override + Links write isolation
                                              │
                                              └─► B3 claims audit + token-refresh rollout ◄── highest risk
                                                     │
                                                     └─► B4 server-owned roster/role lists

  Track C — password release (needs B0; sequential)
    C2 email verification ─► C4 reset path ─► C3 self-service change ─► C5 retire surname (irreversible)

  Track D — App Check (AFTER Track B is stable; never concurrent with B3)
    D1 monitor-first (log-only) ─► D2 enforce: Firestore ─► Storage ─► browser Functions
```

**Hard ordering constraints (violating these re-introduces the v10.94 class of outage):**

- B0 **before** B1, B2, and C3. The silent anonymous fallback is incompatible with any
  claim-requiring rule and with custom passwords.
- B1 + B2 + B3 ship as a tight unit. Isolation (B2) without named-session-only writes (B1)
  means anonymous/claim-less sessions silently fail the new rule.
- **D2 (App Check enforce) must not overlap B3.** Separate them by a stabilisation window.
- A1 and A2 stay **out** of the authz release — different failure domains; bundling widens the
  blast radius for no benefit.
- C5 (retire surname) is irreversible and gated on migration metrics (≥90% custom passwords).

---

## Recommended sequence (value-to-risk ordered)

> **A3 was split (v14.38).** Its only genuinely-free part was a *documentation* correction
> (the `pushSubscriptions` delete posture), which is **done**. The *rule-tighten* it implied is
> not a freebie — it's a Firestore rule change with the same silent-failure class as the rest of
> Track B and a real correctness consideration (it must not break the legitimate unsubscribe
> path). So it's **folded into B2**, where the rules + emulator-test work already lives. There is
> no standalone "A3 first" step; **B0 is the first substantive phase.**

1. **B0** — `ensureFirebaseSession` hardening. Branch + unit tests. The foundation everything
   depends on, and the first substantive phase.
2. **A2** — Workload Identity Federation. Isolated, removes standing credential risk, doesn't
   touch runtime. Do it while B0 is in review.
3. **B1 → B2** — named-session separation + per-member isolation rule. (B2 CONSIDERED tightening
   the `pushSubscriptions` delete rule and kept it as-is — the rule is still `request.auth != null`;
   tightening remains an OPEN decision, see the owner-decisions table.) All branch-safe with
   emulator tests (no deploy until merge).
4. **B3** — claims audit + permissive→strict token-refresh rollout in a low-traffic window.
   **Was the single highest-risk step in the entire plan — ✓ SHIPPED v16.29** (no lockout; the
   `writeWithClaimRetry` self-heal meant no mass sign-out).
5. **B4** — server-owned roster/role lists.
6. **C2 → C4 → C3 → C5** — password release.
7. **D1 → D2** — App Check monitor-then-enforce, once B is stable.
8. **A1 ✓ DONE (v15.32)** — `uuid` advisories cleared via a scoped override on firebase-admin `^13`
   (the v14 bump was neither needed nor safe — it breaks the `firebase-functions` peer range and the
   namespaced API `index.js` uses; see A1). Standalone, done out of band.

---

## Phase detail and risk register

Each phase: **Goal · Who · Risk · Mitigation · Rollback · Go/no-go gate.**
"Claude" = branch + test work; "Owner" = Firebase/GCP Console or a chosen production window.

### A1 — clear the transitive `uuid` advisories in `functions/` ✓ DONE (v15.32-era, uuid override)
- **Outcome:** a scoped **`overrides: { "uuid": "^11.1.1" }`** in `functions/package.json` on the
  supported firebase-admin **`^13`** — `npm audit --omit=dev` → 0 vulnerabilities (was 9 moderate);
  module-load smoke test + `npm run test:functions` green. The originally-planned firebase-admin v14
  bump was neither needed nor safe (breaks the `firebase-functions` peer range and the namespaced
  `admin.*` API `index.js` uses; empirically cleared only 2 of 9 advisories). The advisory itself
  (GHSA-w5hq-g745-h8pq) was never reachable — the Google libs call `uuid.v4()` with no `buf` arg.
- **Rollback:** remove the `overrides` block (prior lockfile reinstates the unreachable advisory).
  **Follow-up:** drop the override once `@google-cloud/storage` ships `uuid >= 11.1.1` upstream
  (`npm ls uuid` in `functions/` will then show it without "overridden").

### A2 — Workload Identity Federation ✓ DONE (v14.93)
Retired the long-lived `FIREBASE_SERVICE_ACCOUNT` JSON for keyless GitHub OIDC/WIF on all 3 deploy
workflows; the SA JSON key + GitHub secret are both deleted. The mitigations that got there safely
(migrate one workflow first, keep the secret as fallback until proven, delete the key last) and the
one security invariant that still constrains any future change — the `assertion.repository` provider
condition — are recorded in **Appendix: A2** below.

### A3 — doc-only accuracy fixes ✓ DONE (v14.38)
Doc-only, no rule changed: the `pushSubscriptions` **delete** posture (`request.auth != null` — any
authenticated id that knows the doc id) is now stated in CLAUDE.md, and the bearer-URL read
distinction in `storage.rules` comments. **The rule-tighten this implied is folded into B2** (same
silent-failure class; must not break the legitimate `deletePushSubscription` unsubscribe path) —
there is no standalone A3 rule step. **B0 is the first substantive phase.**

### B0 — `ensureFirebaseSession` hardening (FOUNDATION) ✓ DONE (v14.39)
**B0 (observability):** `ensureFirebaseSession` now exposes whether it established the member's
**named** account or only the **anonymous** fallback — `getFirebaseIdentity()` → `'named'|'anonymous'
|'none'`, `firebaseSessionIsNamed()`, `getFirebaseAuthError()`. **No runtime behaviour change** (the
fallback still happens); `firebaseSessionIsNamed()` is the exact signal B1/B2 consume. 7 unit tests
in `session.test.mjs`.
- **B0-enforce was folded into B1** (refusing to proceed on a claim-less session is multi-page UX
  that belongs with B1's named-session separation).
- **Why first:** the B0 signal is the prerequisite for B1, B2, and C3 (also the ROADMAP Password
  Stage-3 `ensureFirebaseSession` rework).
- **Leave the calendar bootstrap untouched** — the calendar reads via `calendarAuthReady`, not
  `ensureFirebaseSession`, so its legitimate anonymous public reads are automatically unaffected.

### B1 — named-session separation + remove browser account-creation ✓ ENABLED (v14.42; re-enabled v14.98)
> **Detailed scope: see "Appendix: B1 detailed scope" at the foot of this file** — call-site map,
> the soft/hard per-page enforcement matrix, re-auth UX, the kill-switch, and the testing plan.
- **Goal:** anonymous auth confined to the public Calendar read path; Admin/Operations/Links/Settings
  require a genuine named session (**Pay stays SOFT** — it writes no isolated data, so it only logs;
  see the enforcement matrix). Stop the client auto-creating Firebase accounts
  (`createUserWithEmailAndPassword` self-heal) once server provisioning is the source of truth.
- **Who:** Claude (branch), owner confirms all accounts exist server-side first.
- **Dependency:** removing client account-creation needs reliable server provisioning
  (`setupRosterAuth`) **and** an admin break-glass reset (exists today: Operations → Staff Login
  Accounts). Full self-service recovery (C4) is *not* a hard prerequisite as long as break-glass
  exists.
- **Risk:** a member whose server account was never provisioned becomes a lockout (previously
  self-healed silently).
- **Mitigation:** run "Set up accounts" and reconcile against `teamMembers` before shipping;
  keep admin break-glass; surface a clear "ask admin to set up your account" message, not a silent fail.
- **Rollback:** re-enable the self-heal create path (kept behind a single flag during rollout).
- **Gate:** every active `teamMembers` account verified present server-side; break-glass reset tested.

### B2 — per-member override write isolation (the headline gap) ✓ BUILT + DEPLOYED permissive (v14.53)
> **Read "The identity tiers the rules must respect" first.** The original one-line scope here was
> wrong in three ways, each a silent lockout: it ignored the **manager** tier, it assumed
> `linkDesigns` is member-owned (it is not), and it assumed `pushSubscriptions` carries an owner
> identity (it does not). Corrected in the v14.51 sweep.

- **What shipped (v14.53):** the **`manager: true`** claim in `setupRosterAuth` (for `MANAGER_NAMES`,
  mirroring `admin`) + the permissive 3-tier `overrides` rule — **create, update, AND delete** gated
  on `token.name == memberName || token.admin || token.manager` (plus the interim
  `!('name' in token)` escape, removed at B3/v16.29). Also bounded month/day date validation on
  `overrides`/`circulars`/`newsletters` (impossible dates like `2026-13-01` denied), folded in from
  the v14.51 review. Emulator tests covered the full tier matrix (staff own-only; manager/admin
  on-behalf incl. delete; `roster_import` saves; manager still rejected by master-admin collections;
  own push-subscription delete). The live `firestore.rules` + `firestore.rules.test.mjs` are the
  source of truth for the rule text and gate cases.
- **Why both bypasses are load-bearing:** the `admin` bypass — admin writes for others constantly
  (on-behalf AL/sick, every `source:'roster_import'` row). The **`manager` bypass is equally
  load-bearing** — the 6 managers edit staff AL/absence/shifts on behalf every day; without
  `manager: true` B2 silently locks them out. Master-admin collections
  (huddles/circulars/newsletters/roster/auth) stay `admin`-only — never grant managers `admin: true`.
- **`linkDesigns` — NOT member-isolated.** Designs are keyed by **design name, not member**, and
  designer **S. Silva is a CEA** (no admin/manager claim), so `token.name == memberName` is
  meaningless here. The original owner decision (leave at `request.auth != null`) was **SUPERSEDED:
  H2 ✓ SHIPPED (v16.29)** — a dedicated **`linksDesigner: true`** claim is set by `setupRosterAuth`
  for `LINKS_DESIGNERS`, and writes are gated on `admin || linksDesigner` (reads stay open). Do
  **not** fold `linkDesigns` into the override member-name model.
- **`pushSubscriptions` delete — TIGHTENED (A5 / F-SEC-5, shipped v17.76).** Previously the doc had
  **no member identity** (keyed by a SHA-256 of the endpoint; fields were only `endpoint`,
  `keys.p256dh`, `keys.auth`), so an owner check was structurally impossible. Resolved via option (b):
  `savePushSubscription` now stamps an **`owner` = Firebase Auth uid** on create (rules require it to
  equal `request.auth.uid`, so you can only claim your own), and **delete requires
  `resource.data.owner == request.auth.uid`** — OR no `owner` (legacy docs from older clients stay
  deletable so VAPID-rotation cleanup isn't locked out; orphans from a uid change are swept by
  `fanOutPush`'s server-side 410/404 cleanup). Non-breaking (owner is optional in the shape, so old
  cached clients keep working) and gradually hardening (new subs protected immediately). Emulator-tested
  in `firestore.rules.test.mjs` (a different identity cannot delete an owner-stamped sub; legacy escape
  preserved).
- **Provisioning invariant (executed in the B2 window, not deferred to B3):** the `manager` claim
  only lands when "Set up accounts" is re-run after `setupRosterAuth` ships, and takes effect on each
  manager's next token refresh — the permissive rule already required it for on-behalf writes (a
  stale token has `name` but not `manager`, so the escape did NOT cover it). Deploy order was:
  merge → immediately run Set up accounts → token refresh → verify in a private window (never an
  installed phone); the short residual window was soft/recoverable, with admin break-glass cover.
- **Rollback:** revert the rule; `request.auth != null` restored. The `manager` claim is additive
  (an extra claim on a token harms nothing if the rule is rolled back).

### B3 — claims audit + token-refresh rollout (HIGHEST RISK) — ✅ COMPLETED (v16.29)

> ✅ **COMPLETED (v16.29) — this is now a historical record.** The `!('name' in token)` legacy escape
> was removed from the `overrides` create/update AND delete rules; writes now require
> `token.name == memberName || token.admin || token.manager`. No lockout, no mass sign-out. The live
> `firestore.rules` + `firestore.rules.test.mjs` (the strict-isolation matrix, incl. the
> no-name-token-denied and delete-mirror cases, and the `staffDb()`→`namedDb()` field-test rework)
> are the source of truth for what shipped — the step-by-step cutover runbook and inline diffs that
> used to live here were removed once duplicated there (recoverable from git history if ever needed).

- **The risk it managed:** a member on a valid 30-day localStorage session holds a Firebase token
  minted *before* its claim existed — a strict rule rejects staff on a pre-`name` token AND a
  manager on a pre-`manager` token. A hard cutover **is** the v10.94 outage; hence the
  permissive→strict migration across all three tiers.
- **How it was executed:** permissive rule shipped at B2 (v14.53) → re-provision via Set up accounts →
  **the `CLAIM_EPOCH` sweep**: `CONFIG.CLAIM_EPOCH` (`roster-data.js`) + `refreshClaimsIfStale()`
  (`session.js`, built v14.71, 6 tests) force-refresh each device's token ONCE per epoch bump, gated
  by `localStorage('myb_claim_epoch')`. **Armed to `CLAIM_EPOCH = 2` at v15.33** (higher than any
  previously-shipped value — 1 shipped v14.71, hotfixed to 0 in v14.72 — so every device swept on
  next open; do NOT bump again unless deliberately forcing a fresh sweep). After the sweep window:
  re-ran Set up accounts in-window, applied the strict rule + reworked emulator tests on a fresh
  branch, verified the private-window role matrix (staff own-only; manager on-behalf ✓ but still
  blocked from master-admin collections; admin ✓; roster upload saves; designer Links write ✓),
  then merged → `deploy-rules.yml` gated on the suite and shipped it live.
- **Live invariant — `writeWithClaimRetry` (built v15.18):** the write-side safety net in
  `firebase-client.js` retries **exactly once**, **only** on `permission-denied` with a live
  `auth.currentUser`, after a forced `getIdToken(true)`; any other error class or a second denial is
  re-thrown. Wired into all three `admin-overrides.js` write paths via re-runnable thunks (a
  `WriteBatch` can't be re-committed; the cache reflects only the successful attempt). It self-healed
  any straggler token, which is why no mass sign-out was needed. Independent of — not a replacement
  for — the `CLAIM_EPOCH` sweep. See LOGIN_INCIDENT.md.
- **Deploy-order invariant (keep for any future claim-gated rule):** function first → re-provision
  (Set up accounts) → then the strict rule — `writeWithClaimRetry` can only self-heal a claim that
  already exists server-side. Repo rules being right is necessary but not sufficient; the live
  project (deployed function + provisioned claims + refreshed tokens) must be right too. Always
  verify in a private window, never an installed phone.
- **Rollback (still instant):** re-add the two `!('name' in request.auth.token)` escape lines to the
  `overrides` create/update + delete blocks and redeploy the permissive rule, or revert `overrides`
  to `request.auth != null`. No data migration either way.

### B4 — server-owned roster/role lists — ✅ SHIPPED (v16.30)
- **Shipped:** `setupRosterAuth` no longer trusts client-sent member/role lists. All four
  (`activeMembers` + `admin`/`manager`/`designer`) are read from `functions/roster-members.json`,
  generated from `roster-data.js` (CONFIG + `getMembersForGrade`, mirroring `ACTIVE_MEMBERS` exactly)
  by `generate-roster-members.mjs` and CI-locked by `sw-asset-check.test.mjs`. The function fails
  closed on a missing `activeMembers` or an empty `admin` list (admin-lockout guard). Orphan removal
  is now **dry-run by default** — `removeOrphans` returns `orphansToDisable` (a preview) and disables
  nothing; a second call with `confirmOrphanRemoval` disables **and revokes refresh tokens**. The
  client (`admin-auth.js`) stopped sending the lists and shows the preview → confirm step.
- **Original goal (for reference):** move member/admin lists server-side with **dry-run** orphan
  removal, explicit destructive confirmation, and token revocation after demote/disable.
- **All three tier lists move server-side, not just the member + admin lists.** Today the client
  sends `members` (`ACTIVE_MEMBERS`) and `adminMembers` (`CONFIG.ADMIN_NAMES`); B2 adds a manager
  list. B4 must own **`ADMIN_NAMES` + `MANAGER_NAMES` + `LINKS_DESIGNERS`** server-side so none of
  the three claim tiers can be elevated by a tampered client payload (a client that adds itself to
  `adminMembers`/`managerMembers` today would self-promote). This is the actual security win of B4 —
  do not let the manager/designer lists stay client-supplied while only the admin list is locked down.
- **Who:** Claude (function) + owner deploy.
- **Risk:** a server-owned list that drifts from `teamMembers` could disable a real account, or
  orphan-removal could delete a needed account.
- **Mitigation:** generate all three role lists from `roster-data.js` via the existing
  `generate-roster-members.mjs` pipeline (single source of truth — extend it to emit the admin/
  manager/designer designations, not just names); dry-run + explicit confirm on any destructive op;
  revocation is additive.
- **Rollback:** revert the function; provisioning returns to client-list behaviour.
- **Gate:** dry-run output reviewed before any destructive run; token revocation tested on a demo account.

### Track C — password release (C2 → C4 → C3 → C5)
- **Goal & detail:** exactly the 5-stage plan in ROADMAP → "Password security improvements".
- **Who:** Claude (functions + UI), owner (email relay choice + Console break-glass).
- **Ordering within C:** verification (C2) → reset path (C4) → self-service change (C3, needs B0)
  → retire surname (C5, irreversible, ≥90% migrated).
- **Risk:** locking staff out of the *core roster* is a bigger operational risk than the present
  surname-password weakness. C5 is one-way.
- **Mitigation:** admin break-glass always available; C5 gated on `staffContact.verified` count
  vs active `teamMembers`; all secret-setting operations server-side only (never trust client to
  set `verified`/`password`).
- **Rollback:** C2–C4 are additive (revertible); C5 is **not** — do not ship until the metric gate
  is met.
- **Gate per stage:** see the ROADMAP stage entries; end-to-end test on Android Chrome + iOS
  Safari standalone before each ship.

### Track D — App Check (monitor → enforce; AFTER Track B stable)
- **Goal:** only requests from our own pages can reach Firestore/Storage/browser-called Functions.
- **Who:** Claude (`firebase-client.js` provider init + CI/dev debug tokens) + owner (Console reCAPTCHA).
- **Risk:** identical failure mode to the API-key referrer restriction (task #1) — miss a served
  domain (`web.app`, `firebaseapp.com`, `garethdavidmiller.github.io`) or a provider hiccup and
  writes fail silently with no in-app error. The allowlist must be maintained forever.
- **Mitigation:** **monitor-first** — ship in log-only/observe mode (D1), watch the App Check
  metrics for legitimate-but-unattested traffic, register every domain + CI/dev debug tokens, and
  only then **enforce one product at a time** (Firestore, then Storage, then Functions) (D2).
  **Never enforce during the B3 window.**
- **Rollback:** flip enforcement back to monitor (Console), instant.
- **Gate:** D1 metrics show ~100% of legitimate traffic attesting before any D2 enforce step.
- **Note:** App Check gates *which clients* connect, not *what an authenticated client may read*.
  It does **not** address the world-readable `overrides` exposure (that is a deliberate design
  trade-off — KNOWN_LIMITATIONS). Per-member write isolation (Track B) is the higher-value work;
  App Check is defence-in-depth, correctly sequenced last.
- **D-adjacent hardening — analytics doc size (deferred, App Check is the real fix).** The
  `analytics/activeAccounts` and `analytics/perf_<YYYY-MM>` rules validate that `daily` / `months` /
  `samples` are *maps* but do **not** bound the map-key **count** (the `pv_` counts are `is int`-checked,
  but no branch caps key count). So any authenticated session — including the anonymous calendar
  session every visitor gets — could pad one of those single documents with thousands of junk keys
  toward Firestore's 1 MB doc limit; once near the cap, every legitimate `increment()` merge to that
  doc fails ("document too large"), and the anti-wipe guard means only an admin can shrink it back —
  a self-inflicted **availability** DoS on analytics recording (not a data or money risk; the data is
  non-sensitive aggregate counts). Same root cause as the documented "values aren't individually
  validatable → App Check is the eventual integrity control" gap, so it belongs here. **Why deferred:**
  (a) it needs an authenticated session and only degrades analytics, not the app; (b) a rules-only fix
  (`request.resource.data.daily.keys().size() < N`) is a security-rules change that must be
  emulator-verified via `firestore.rules.test.mjs` on the `deploy-rules.yml` gate, so it should ride a
  rules release, not a one-off; (c) App Check (D2) removes the un-attested-client write path that makes
  the abuse possible in the first place. **If tightened before App Check:** add a key-count cap to the
  `activeAccounts` and `perf_` create/update conditions and a matching `assertFails` in
  `firestore.rules.test.mjs`. (Found in the v17.43 second full-app audit.)

---

## Track E — full-app authentication (put the calendar behind login) — IDEA CAPTURED, NOT DECIDED (Jul 2026)

> **Status: undecided — this may or may not ever be built.** Track E is recorded as a *considered
> option*, not a committed plan. Nothing here is scheduled. The most likely trigger is **external**:
> if the app becomes (or is being assessed as) official Chiltern infrastructure, **Chiltern IT may
> eventually require** the sensitive roster data to sit behind authentication rather than a public URL —
> at which point this becomes a requirement to satisfy, not a choice to weigh. Until such a requirement
> lands (or the owner independently decides to do it), the deliberate public-calendar design stands and
> Track E is dormant. See the owner questions at the end — those must be answered before any code, and
> the "which bar?" answer may itself be dictated by whatever IT asks for.

The idea: today five of six pages sit behind a named login; the **calendar (`index.html`) is
deliberately public** — it runs an *anonymous* Firebase session and reads `overrides` / `huddles` /
`circulars` / `newsletters` with open (`allow read;`) rules. "Put the whole app behind login" means
making the calendar require a session too, so the sensitive data (staff AL / absence / shift changes)
is no longer readable by anyone with the URL. This is the item that would close the external review's
**"public absence/AL data"** finding (High).

**The insight that reframes the whole thing — there are TWO different bars, not one, and they cost
wildly different amounts:**

| | Rule shape | Who it lets in | What it blocks | UX cost |
|---|-----------|----------------|----------------|---------|
| **Level 1** — auth-required read | `allow read: if request.auth != null;` | any session **including the calendar's existing anonymous one** | a raw REST/`curl` scrape with **no** Firebase session; search-engine indexing; casual URL sharing | **≈ zero** — the calendar already signs in anonymously (`calendar-app.js` ~L831), so `request.auth != null` is already satisfied. No front-door change at all. |
| **Level 2** — named-only read | `allow read: if request.auth.token.name != null;` | only a **named** staff session (name + surname) | anonymous sessions too — i.e. anyone not signed in as staff | **Real** — the calendar must now show a login before it can render. This is the true "behind login". |

**Be honest about what each buys.** The project config is in the client JS, so a *determined*
scraper can replicate the anonymous sign-in — Level 1 raises the bar from "trivially public" to
"must initiate a Firebase anonymous session against our project", not to "must be staff". Level 2 is
the real gate. Also note the exposure being closed is **outsider-with-URL**, not colleague-to-colleague:
the calendar's member selector already lets any staff member view any colleague's roster/AL/absence by
design — that intra-staff visibility is the operational model and Track E does not change it.

**The two halves must land together (Level 2), but Level 1 is separable and nearly free.** The client
login is only the *means* to obtain the session; the **rules tightening is the actual control** (server
rules are the boundary — a client gate over open rules is theatre, bypassable via REST). So:

- **E1 (cheap, do-anytime): tighten reads to Level 1** (`request.auth != null`, anonymous OK) on
  `overrides` + the three document collections. The anonymous bootstrap already satisfies it, so this
  is a rules-only change with no front-door impact — **verify** the notification-tap fresh-visit path
  establishes the anonymous session *before* the first read (else `#huddle` auto-open breaks), then ship.
  This alone closes the "trivially public via REST" hole. Keep the Anonymous auth provider **enabled**.
- **E2 (soft): require named on the calendar behind the existing kill-switch.** Flip
  `PAGE_POLICIES.calendar` from `{ requireNamed: false, anonymousOk: true }` to require named, wire the
  shared `login-overlay.js` (the same ~30-line pattern the other five pages use), and gate it on
  `ENFORCE_NAMED_SESSION` (extend the flag the B1/B3 release already owns to the calendar) in a **soft**
  posture first — measure how many launches hit the wall before hardening.
- **E3 (hard): tighten reads to Level 2** (`token.name != null`) + make the calendar login mandatory.
  Only after E2 has soaked. At this point the calendar's `signInAnonymously` is dead and the **Anonymous
  provider can be disabled project-wide** — which directly interacts with the *"retire the anonymous
  fallback"* appendix below (they should be decided together: E3 is the event that finally kills the
  anonymous surface the anti-goal currently protects).

**Why it's not much code but is a big decision.** Mechanically it's a pattern-copy (login infra exists,
tested on five pages) + a rules change + a policy flag — roughly a day. But the calendar is the app's
**front door**, and four things hang off its being open, each a real consequence rather than a bug:

1. **Offline lockout (the sharpest one).** The app is offline-first and the calendar is the PWA
   `start_url`, launched from cache. A staff member whose 30-day session has lapsed **and who is offline**
   cannot log in (login needs Firebase Auth = network) → they are locked out of their **own cached
   roster**. Today that never happens — a cached roster always renders. This is a genuine regression to
   weigh, not a detail.
2. **Notification deep-links.** A push tap opens `#huddle` on the calendar; on a lapsed session it now
   lands on a login screen. The deep link (and first-fresh-visit auto-open) must survive the login flow.
3. **First-run onboarding.** Today a new starter opens the calendar, picks their name, sees the roster —
   no account interaction. Behind login, first contact becomes "sign in".
4. **The document viewers** (huddle/circular/newsletter) currently rely on open reads *because* the
   calendar had no session — E3 moves them to auth-gated, coupling them to the login working on every path.

**Rollout discipline (inherits the plan's core principle).** Migrate, don't cut over: E1 → E2-soft →
E3-hard, never a single flip (the v10.94 hard-cutover outage precedent). Reuse `ENFORCE_NAMED_SESSION` +
the staged posture the B-track already proved. Verify only from a **fresh private window**, never an
installed phone (the installed PWA masks live-site breakage).

**Interaction with existing anti-goals — Track E consciously REVERSES one.** The current anti-goal
*"Do not remove the calendar's anonymous read/bootstrap … that path is a deliberate public-read surface"*
is correct **until Track E is chosen**. E3 is exactly the decision to retire that surface — so starting
Track E means re-stamping that anti-goal, not violating it silently. Do not begin E without recording
that reversal.

### Questions to ask the owner when the time comes (the crux — answer these BEFORE writing any E code)

1. **What bar are we defending?** Casual (search indexing / shared URL / curious non-staff) → **E1 (Level 1)**
   is nearly free and may be *enough*. A motivated outsider willing to script an anonymous sign-in → you
   need **E3 (Level 2 / named)** and must accept the front-door cost. *This single answer decides whether
   Track E is a one-hour rules tweak or a multi-week front-door change.*
2. **Is a login wall on the home screen acceptable?** Given sessions last 30 days and refresh the idle
   clock on every load, most staff would rarely hit it — but the calendar is opened many times a day.
   Yes/no on "the front door may sometimes show login instead of the roster."
3. **Is the offline-lockout regression acceptable?** A lapsed-session **offline** user loses access to
   their own cached roster. If not acceptable: do we build a grace mode (render the cached roster
   read-only, require login only to *sync fresh* data), and/or lengthen sessions to make lapse rare?
4. **Member selector vs identity.** Once the calendar knows who you are, should it **default to showing
   your own roster** (selector still available for colleagues), or stay a free selector with login as a
   pure gate? (UX change, not security.)
5. **Analytics identity guarantee.** The calendar stores **no** member identity in analytics today
   (anonymous). A named calendar could count active-accounts more accurately. Keep the identity-free
   guarantee, or consciously make the calendar an active-account surface (still client-deduped, no server
   identity)?
6. **Anonymous provider fate.** At E3 the calendar's `signInAnonymously` becomes dead code and the
   Anonymous auth provider could be **disabled project-wide** (a real hardening) — but that also ends the
   Level-1 fallback and settles the "retire the anonymous fallback" appendix. Retire anonymous entirely,
   or keep it as a Level-1 read tier?

---

## Owner decisions needed (collect before starting the dependent phase)

| Decision | Blocks | Notes |
|----------|--------|-------|
| ~~Confirmed Chiltern **work-email domain**~~ | ~~staffContact domain validation~~; C2/C4 email recovery | **✓ RESOLVED (v14.97): `chilternrailways.co.uk`** — `CONFIG.WORK_EMAIL_DOMAIN` (single source) + `isChilternWorkEmail()` in `roster-data.js`, enforced client-side AND in `firestore.rules`. (Was deferred in v14.24 for lockout risk.) Still confirm it's the right domain before C2/C4 email *recovery* relies on it. |
| Email relay choice — Power Automate vs Firebase Trigger Email | C2, C4 | Power Automate relay already exists (Huddle ingest). |
| Code expiry / retry-rate-limit policy | C2, C4 | 10-minute expiry + 3-attempt lockout is the documented default. |
| ~~A low-traffic **re-auth window**~~ | ~~B3~~ | **✓ DONE (v16.29): strict cutover shipped.** The window re-provisioned + refreshed tokens for the 6 managers too (`manager` claim), the `CLAIM_EPOCH == 2` sweep + `writeWithClaimRetry` self-heal meant no mass sign-out, and the no-name escape was removed. |
| ~~`linkDesigns` isolation: leave open vs. add a `linksDesigner` claim~~ | ~~B2~~ | **SUPERSEDED — ✓ H2 SHIPPED (v16.29): added the `linksDesigner` claim.** The earlier "leave at `request.auth != null`" decision (Jul 2026) was replaced: `linkDesigns` writes now require `linksDesigner`/`admin` (reads stay open); `setupRosterAuth` sets the claim from `CONFIG.LINKS_DESIGNERS`. |
| ~~`pushSubscriptions` delete: keep `request.auth != null` vs. add a stored owner field~~ | ~~B2~~ | **✓ DONE (A5/F-SEC-5, v17.76): added an `owner`=uid field on create; delete now requires `owner == request.auth.uid` (legacy no-owner docs stay deletable; server 410 cleanup sweeps orphans).** |
| ~~GCP **Workload Identity Pool** setup~~ | ~~A2~~ | **✓ DONE (v14.93)** — pool/provider/binding built with the repo-scoped `assertion.repository` condition (Appendix A2). |
| reCAPTCHA Enterprise provider | D1/D2 | Required before App Check can attest. |
| Is the app **official Chiltern infrastructure**? | App Check priority; header-capable hosting | If yes, App Check and Firebase-Hosting-only (drop github.io) rise in priority. |
| **Full-app auth — do it at all?** (and if so, which bar?) | Track E (undecided) | Track E is captured but **not decided** — may never be built, or may become a **Chiltern IT requirement** if the app becomes official infrastructure. The "which bar" answer may itself be dictated by IT. See Track E → header + Questions Q1. |
| **Full-app auth — front-door + offline-lockout acceptable?** | Track E (E2/E3) | Login wall on the PWA `start_url`; lapsed-session **offline** user loses their own cached roster. See Track E → Questions Q2–Q3. |

---

## What NOT to do (anti-goals)

- **Do not** ship per-member isolation as a hard cutover. Use the permissive→strict migration.
- **Do not** enforce App Check and roll out isolation in the same window.
- **Do not** bundle the Track-A infra work (WIF/A2, the functions `uuid` fix/A1) into the authz
  release — different failure domains. (Both are now done, shipped standalone as intended.)
- **Do not** retire the surname password (C5) before the ≥90% migration metric.
- **Do not** remove the calendar's anonymous read/bootstrap when hardening
  `ensureFirebaseSession` — that path is a deliberate public-read surface. **(Holds until Track E is
  chosen — Track E E3 is exactly the decision to retire this surface; reverse this anti-goal there, not
  silently.)**
- **Do not** drop the `|| token.admin == true` bypass from the isolation rule — admin writes for
  other members are load-bearing (roster import + on-behalf booking).
- **Do not** drop (or forget to add) the `|| token.manager == true` bypass — the 6 managers write
  staff AL/absence/shifts on behalf every day; without it, B2/B3 silently lock them out. Equally,
  **do not grant managers `admin: true`** as a shortcut — that would let them reach the
  master-admin-only collections (huddles/circulars/newsletters/roster/auth) the tier exists to deny.
- **Do not** isolate `linkDesigns` by `token.name == memberName` — designs are keyed by design name,
  not member, and a designer (S. Silva) may be ordinary staff with no admin/manager claim.
- **Do not** verify any of this from an installed phone — always a fresh private window.

---

## Progress checklist (tick as shipped)

- [x] A3 — doc-only accuracy ✓ (v14.38: pushSubscriptions delete posture stated; bearer-URL notes confirmed; rule-tighten moved into B2)
- [x] B0 (observability) — ✓ (v14.39: named-vs-anonymous identity exposed + tested; no behaviour change). Enforce half folded into B1.
- [x] A2 — Workload Identity Federation ✓ **DONE (v14.93)** — keyless OIDC on all 3 workflows; the
      SA JSON key + `FIREBASE_SERVICE_ACCOUNT` secret are both deleted (Appendix A2).
- [x] B1 — named-session separation + remove browser account-creation. **ENABLED v14.42**, rolled
      back during the v14.72 login freeze, **RE-ENABLED v14.98** after the freeze was fixed and B1
      exonerated (LOGIN_INCIDENT.md). Revert = flip `ENFORCE_NAMED_SESSION` back to false (one line).
- [x] B2 — per-member override isolation (permissive, **3-tier: name/admin/manager**, incl. delete)
      + `setupRosterAuth` `manager` claim + `linkDesigns`/`pushSubscriptions` decisions + emulator tests.
      **BUILT + DEPLOYED permissive (v14.53)** (Firestore + Storage rules suite green); managers re-provisioned per the
      B2 deploy runbook. **B3 shipped the strict tighten** (dropped the `!('name' in token)` escape — v16.29).
- [x] B3 — claims audit + permissive→strict token-refresh rollout (**re-provisioned the manager claim too**)
      — **✓ SHIPPED v16.29.** **Client sweep BUILT v14.71** (`CONFIG.CLAIM_EPOCH` + `refreshClaimsIfStale()`,
      6 tests) — the deterministic token-refresh mechanism. **Write-side stale-claim retry net BUILT v15.18**
      (`writeWithClaimRetry`, all three override write paths). **`CLAIM_EPOCH` ARMED → 2 at v15.33** (the
      pre-cutover sweep). **Executed (v16.29):** health-checked the sweep in a private window → let it settle
      → re-ran Set up accounts in-window → applied the strict rule + reworked tests (live in
      `firestore.rules` + `firestore.rules.test.mjs`) on a fresh branch → verified the private-window
      matrix → deployed the strict rule. `writeWithClaimRetry` self-healed stale tokens, so no mass
      sign-out was needed.
- [x] H2 — `linkDesigns` write requires the `linksDesigner`/`admin` claim (reads stay open)
      — **✓ SHIPPED v16.29.** `setupRosterAuth` sets `linksDesigner` from `CONFIG.LINKS_DESIGNERS`,
      `admin-auth.js` sends `designerMembers`, and every `links-app.js` write is wrapped in
      `writeWithClaimRetry` so a stale designer token self-heals. Superseded the earlier
      "leave at `request.auth != null`" decision.
- [x] B4 — server-owned role lists (**admin + manager + designer** + activeMembers, generated into
      roster-members.json, CI-locked) — **✓ SHIPPED v16.30.** Plus dry-run orphan removal (preview →
      confirm) and refresh-token revocation on disable; fail-closed on empty admin/members config.
- [ ] C2 — email verification
- [ ] C4 — forgotten-password reset
- [ ] C3 — self-service password change
- [ ] C5 — retire surname password (irreversible; gated on ≥90% migrated)
- [ ] D1 — App Check monitor-first
- [ ] D2 — App Check enforce (Firestore → Storage → Functions)
- [x] A1 — `uuid` advisories cleared ✓ **DONE (v15.32)** via a scoped `uuid` override on firebase-admin
      `^13` (0 vulnerabilities; smoke + `test:functions` green). The v14 bump the plan originally
      assumed was neither needed nor safe (breaks the `firebase-functions` peer range + the namespaced
      API). Drop the override when `@google-cloud/storage` ships `uuid >= 11.1.1` upstream.

---

## Appendix: B1 detailed scope (implemented v14.40–41; ENABLED v14.98)

B1 turns the B0 *signal* (`firebaseSessionIsNamed()`) into *enforcement*: the write pages stop
accepting a claim-less session, anonymous auth is confined to the public Calendar, and the client
stops self-creating Firebase accounts. B1 ships **while the Firestore rules are still
`request.auth != null`**, so **B1 cannot lock anyone out via rules** — its only lockout surface is
client-side and reversible with the one-line kill-switch. It is the safe precursor that removes the
claim-less write sessions B2 would otherwise reject.

**The three coordinated changes (DONE, gated behind `CONFIG.ENFORCE_NAMED_SESSION`):**
- **B1.1 (v14.40)** — `ensureFirebaseSession` drops the anonymous fallback + the self-heal
  `createUserWithEmailAndPassword`; a failed named sign-in returns `false`/`_fbIdentity='none'`.
- **B1.2 (v14.41)** — each write page enforces per the matrix below via `ensureNamedSession`
  (transient-only retry). Flag-ON e2e proves it (`enforceNamedSession(page)` + `__E2E.failSignIn`).
- **B1.3** — remove browser-side account creation + the provisioning prerequisite (below).

**Per-page enforcement matrix — strength matches what the page WRITES** (load-bearing — the
coordinators + `auth-policy.js` consume exactly this; the blanket "Pay requires a named session" was
too strong):

| Page | Writes isolated/admin data? | Enforcement |
|------|------------------------------|-------------|
| admin | Yes — `overrides` for all members; admin ops | **Hard** — in-place login overlay, block the app |
| operations | Yes — admin-only huddle/circular/newsletter/roster/auth writes | **Hard** — in-place login overlay (was: redirect to admin login, until in-place login / Phase 9, v14.45+); a signed-in NON-admin is still redirected to `admin.html` (access control, not a login divert) |
| settings | Yes — `staffContact` (needs the `name` claim) | **Hard** — in-place login overlay, block writes |
| links | Yes — `linkDesigns` | **Hard** — in-place login overlay (was: redirect to admin login, until Phase 9) |
| paycalc | **No** — only `clientErrors`/`analytics` (non-isolated) | **Soft** — log only; the calculator is localStorage-based and must keep working |

> **Mechanism note (Phase 9, v15.16–17):** all five pages now show the **shared in-place login overlay**
> (`login-overlay.js`, gated by `CONFIG.INPLACE_LOGIN` — all `true`) rather than redirecting; on success
> the coordinator re-inits in place (or reloads on the B1 stale-session path — see admin-app.js). The
> Hard/Soft *strength* above is unchanged; only the divert mechanism was replaced.

**Provisioning prerequisite (B1.3):** every active member (incl. managers) must have a server account
via Operations → "Set up accounts" **before** B1 enables — the client no longer self-heals. Admin
break-glass (reset to surname default) stays as recovery until self-service recovery (C4) lands;
`/new-starter` marks "Set up accounts" mandatory before a new starter's first login.

**Re-auth UX** when a returning user has a valid *local* session but the *named Firebase* session
can't be established (reuse the login overlay pre-filled with their name; branch on
`getFirebaseAuthError()`):
- **Transient** (`network-request-failed`/timeout): auto-retry once or twice, then "Couldn't reach
  sign-in — check your connection" + Retry. Do **not** clear the local session (paycalc stays offline-usable).
- **Persistent** (`invalid-credential`/`user-not-found`/`operation-not-allowed`): "Couldn't sign you
  in — ask your manager to reset your access" (break-glass) — the same password would just fail again.

**Kill-switch (the single most important mitigation):** all B1 enforcement is gated behind
`CONFIG.ENFORCE_NAMED_SESSION` (`roster-data.js`). Revert = flip to false, one-line deploy, no rules
involved. Verify on the live URLs in a private window across every role (admin/manager/CEA/CES/
dispatcher/designer) **and** a deliberately-unprovisioned account — never an installed phone.

### Deferred residual — retire the anonymous fallback + kill-switch (NOT YET; held on purpose)

With the flag ON, two branches in `session.js` `ensureFirebaseSession` are **unreachable dead code**:
the `signInAnonymously` fallback and the `createUserWithEmailAndPassword` self-heal (both sit *below*
the `if (CONFIG.ENFORCE_NAMED_SESSION) return commit('none', false)` guard). "Finishing" the ROADMAP
items *"Separate named sessions…"* and *"Remove browser-side account creation"* means deleting that
dead code and the flag itself, making named-only **permanent**. Because the flag is already on, this
is a pure refactor with **no staff-visible behaviour change** — but it is deliberately **deferred**:

- **Why held:** the flag is *the* rollback for the entire B1/B2/B3 named-session + per-member isolation
  release — flip to `false`, one-line deploy, no rules change. While the release is still soaking, that
  instant escape hatch is worth more than the tidiness of removing ~2 dead branches. (Decision Jul 2026,
  owner: keep the switch, revisit in a few weeks.)
- **Go/no-go before removing:**
  - [ ] Several weeks of clean production running with `ENFORCE_NAMED_SESSION = true` and B3 strict —
        no auth-lockout reports, no need to have flipped the switch.
  - [ ] Self-service recovery (C4) shipped, or admin break-glass confirmed sufficient — so losing the
        one-line rollback no longer matters.
  - [ ] Confirmed no wish to ever re-enable the anonymous write fallback.
- **Removal scope (~10 files, one version bump when done):** delete the two dead branches + the flag in
  `session.js`; drop `ENFORCE_NAMED_SESSION` from `CONFIG` (`roster-data.js`); drop the flag guard from
  the 5 write coordinators (`admin`/`operations`/`settings`/`links`/`paycalc`-app.js) and `login-overlay.js`'s
  `enforce` param (always-on); rewrite the flag-on/flag-off matrix in `session.test.mjs` to a single
  always-enforced path; simplify `e2e/fixtures.js` `enforceNamedSession` (no longer needs to rewrite the
  flag); re-stamp this appendix, LOGIN_INCIDENT.md, KNOWN_LIMITATIONS.md, and the ROADMAP bullets from
  "gated behind a kill-switch" to "permanent".

---

## Appendix: A2 — Workload Identity Federation ✓ COMPLETE (v14.93)

**What it did:** retired the long-lived `FIREBASE_SERVICE_ACCOUNT` JSON key for **short-lived GitHub
OIDC tokens** on all 3 deploy workflows (`google-github-actions/auth`, pinned `v2.1.13`, commit
`c200f369`; provider + SA written directly in each YAML — they aren't secrets; job
`permissions: { contents: read, id-token: write }`). No standing full-project deploy credential
remains in GitHub — the SA JSON key AND the GitHub secret are both deleted, and a deploy from `main`
was confidence-checked with the key gone. De-risked by migrating one workflow (rules) first, keeping
the secret as fallback until all three were proven, then deleting the key last.

**As-built config:** pool `github-pool`, provider `github-provider`, project number `532910998075`,
SA `github-deploy@myb-roster.iam.gserviceaccount.com`.

**The one security invariant that still constrains any future change — do NOT lose it:** the provider
carries the attribute **condition `assertion.repository == 'Garethdavidmiller/roster-app'`**, and the
`roles/iam.workloadIdentityUser` impersonation binding is scoped to the same repo's `principalSet`.
**Without the repo condition, ANY GitHub repo could impersonate the SA** (full-project compromise) —
any change to the pool/provider/binding must preserve it. (Functions deploy also needs the gen2 role
set on the SA — Cloud Functions/Run/Build/Artifact Registry/Eventarc/Scheduler/Secret Manager/Service
Account User — unchanged by WIF, which swaps only the auth mechanism, not the SA's roles. WIF resource
names use the numeric project **number**, not the id.)
