# SECURITY_RELEASE_PLAN.md — Phased plan for the security hardening work

*Status: in progress (created v14.38). **Current state (as of v16.29):***
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
  `request.auth != null`" owner decision.*
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
| *Links designer* | `CONFIG.LINKS_DESIGNERS` (`['G. Miller', 'S. Silva']`) | *cross-cuts the above* — S. Silva is a **CEA**, not a manager. **The `linksDesigner` claim is LIVE (H2 ✓ SHIPPED v16.29)** — `setupRosterAuth` sets it from `CONFIG.LINKS_DESIGNERS` and `linkDesigns` writes are gated on it. What was done: add claim → re-provision → refresh → gate `linkDesigns` write. Historical apply record: **B3_STRICT_CUTOVER.HELD.md → "Sibling cutover — `linksDesigner` claim"**; shipped in the B3 window | `linkDesigns` (designs are **not** member-owned) — server-write control is now the **`linksDesigner`/`admin` claim** (was client-redirect only until H2) |

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
3. **B1 → B2** — named-session separation + per-member isolation rule (B2 also tightens the
   `pushSubscriptions` delete rule), all branch-safe with emulator tests (no deploy until merge).
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
- **Goal:** remove the transitive `uuid` advisories in `functions/`.
- **Resolution (chosen):** a scoped **`overrides: { "uuid": "^11.1.1" }`** in `functions/package.json`,
  keeping firebase-admin at the supported **`^13.10.0`**. `npm audit --omit=dev` → **0 vulnerabilities**
  (was 9 moderate). Module-load smoke test passed (uuid, @google-cloud/storage, gaxios, teeny-request,
  firebase-admin all `require()` cleanly; namespaced `admin.firestore/storage/auth/messaging` intact);
  `npm run test:functions` 103/103 green.
- **Why NOT firebase-admin v14 (the original plan):** two blockers made the v14 route both unnecessary
  and unsafe — (1) `firebase-functions@7.x` peers firebase-admin `^11||^12||^13`, so v14 violates the
  peer; (2) v14 drops the legacy `admin.firestore` namespace that `index.js` uses throughout
  (`admin.firestore.FieldValue.serverTimestamp()`, `admin.storage()`, `admin.auth()`), which would
  break the functions at runtime. Empirically, bumping to v14.1.0 also cleared only 2 of 9 advisories —
  the `uuid` chain persists under `@google-cloud/storage`, so v14 didn't even meet the goal.
- **Why the override is safe:** advisory GHSA-w5hq-g745-h8pq (moderate) is a missing buffer bounds
  check in uuid **v3/v5/v6 when a `buf` arg is provided**; the Google libs call `uuid.v4()` (random, no
  `buf`), so the flaw was never reachable — the override just removes audit noise. uuid's `v4()` API is
  unchanged v9→v11, and v11 keeps CJS `require` support (smoke-tested).
- **Rollback:** remove the `overrides` block; functions redeploy from the prior lockfile (reinstates
  uuid 9.x and the accepted-but-unreachable advisory).
- **Follow-up:** drop the override once `@google-cloud/storage` ships `uuid >= 11.1.1` upstream
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
> **Read "The identity tiers the rules must respect" first.** The original one-line scope here
> ("`overrides`/`linkDesigns` require `name == memberName` with an admin bypass") was wrong in three
> ways, each a silent lockout: it ignored the **manager** tier, it assumed `linkDesigns` is
> member-owned (it is not), and it assumed `pushSubscriptions` carries an owner identity (it does
> not). The corrected scope below is the result of the v14.51 sweep.

- **Goal (overrides):** add a **`manager: true`** claim (`setupRosterAuth` sets it for
  `MANAGER_NAMES`, mirroring how `admin` is set for `ADMIN_NAMES`), then gate `overrides`
  **create, update, AND delete** on:
  `request.auth.token.name == memberName || request.auth.token.admin == true || request.auth.token.manager == true`.
  - The `admin` bypass is **load-bearing** (admin writes for others constantly: AL/sick on behalf,
    every `source:'roster_import'` row). The `manager` bypass is **equally load-bearing** — the 6
    managers edit staff AL/absence/shifts on behalf every day; without it B2 silently locks them out.
  - **Tighten the delete rule too.** Today `overrides` delete is `request.auth != null` (any
    authenticated user can delete any override). It must get the **same three-tier check** as
    create/update, or isolation on writes is pointless (anyone could still delete anyone's data).
- **Goal (`linkDesigns`) — NOT member-isolated.** Link designs are keyed by **design name, not
  member**, so `token.name == memberName` is meaningless, and the designer **S. Silva is a CEA**
  (no admin/manager claim). Member-name isolation does not fit this collection. **The original owner
  decision (Jul 2026) was (a) — leave `linkDesigns` at `request.auth != null`**, treating the client
  redirect on `CONFIG.LINKS_DESIGNERS` as the real control given a one-tool blast radius. **That
  decision was SUPERSEDED: H2 ✓ SHIPPED (v16.29)** — option (b) landed. A dedicated
  **`linksDesigner: true`** claim is now set by `setupRosterAuth` for the `LINKS_DESIGNERS` names, and
  `linkDesigns` writes are gated on `admin || linksDesigner` (reads stay open). Do **not** fold
  `linkDesigns` into the override member-name model — its gate is the orthogonal `linksDesigner` claim.
- **Goal (date validation hardening) — folded in from an external v14.51 review.** The `overrides`
  date rule validates *shape* only (`matches('[0-9]{4}-[0-9]{2}-[0-9]{2}')`), so an impossible date
  like `2026-99-99` or `2026-02-31` passes; the `circulars`/`newsletters` date rules are weaker
  still (`size() == 10`, no regex at all). Tighten all three to bound month `01-12` and day `01-31`
  via `matches('[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])')` — the same bounded-alternation
  style already proven on the `HH:MM-HH:MM` value check in the same file. (Full leap-year/Feb-30
  validation belongs server-side; rules can at least reject month/day out of range.) This is pure
  hardening with no migration risk — the client never generates impossible dates — but it is a
  `firestore.rules` change with emulator tests, so it rides with B2's rule work rather than shipping
  as a casual standalone rules deploy. Add emulator cases: `2026-00-10`, `2026-13-01`, `2026-02-31`
  denied; `2026-02-28` / `2028-02-29` accepted.
- **Goal (`pushSubscriptions` delete) — framing corrected.** The doc has **no member identity**
  (keyed by a SHA-256 of the endpoint; fields are only `endpoint`, `keys.p256dh`, `keys.auth`), so
  an "owner check by name" is **structurally impossible** without first adding a stored owner field.
  Realistic options: (a) **keep `request.auth != null`** and document that the id already requires
  knowing the endpoint (mild obscurity, low risk — the current posture); or (b) add an
  `ownerName`/`uid` field on create and check it on delete (a schema change + a `savePushSubscription`
  change, not just a rule edit). **Recommended: (a)** — the gain from (b) is small and it widens the
  change surface. Either way, the prior plan text "add an owner/admin check" is not directly
  implementable and is corrected here.
- **Who:** Claude (branch — `setupRosterAuth` `manager` claim + rules + emulator tests). **Branch
  push does not deploy** (deploy-rules.yml runs on merge to `main`; `setupRosterAuth` deploys via
  deploy-functions.yml on merge).
- **Provisioning dependency (new):** the `manager: true` claim only lands when **"Set up accounts"
  is re-run** after `setupRosterAuth` ships, and only takes effect on each manager's **next token
  refresh** (custom claims are read at token mint). **Correction to an earlier draft:** because the
  *permissive* rule already requires the `manager` claim for on-behalf writes (a stale token has
  `name` but not `manager`, so the `!('name' in token)` escape does NOT cover it), managers must be
  re-provisioned + refreshed **in the B2 window — not deferred to B3.** See the B2 deploy runbook below.
- **Risk:** the rule is correct but rollout locks out cached-token sessions — for **managers too**,
  now (see B3).
- **Mitigation:** this phase shipped **only** the permissive interim isolation rule + tests; the strict
  tighten then happened in B3 after the re-auth sweep (✓ SHIPPED v16.29). Mirrors the pattern already
  live on `staffContact` (which is already three-tier-correct: `name == memberName || admin`).
- **Rollback:** revert the rule; `request.auth != null` restored. The `manager` claim is additive
  (an extra claim on a token harms nothing if the rule is rolled back).
- **Gate:** emulator tests prove (a) staff member A cannot write or delete member B's override,
  (b) **a manager CAN write and delete any member's override**, (c) admin can write/delete anyone's,
  (d) the `roster_import` path still saves, (e) a **manager is still rejected** by the master-admin
  collections (huddles/circulars/newsletters/roster/auth) — tier separation holds, (f) `linkDesigns`
  behaved per the interim decision at B2 time (later tightened to the `linksDesigner`/`admin` gate —
  H2 ✓ SHIPPED v16.29), (g) a device can still delete its own push subscription,
  (h) impossible dates (`2026-13-01`, `2026-99-99`) are denied while real dates still save.

#### B2 deploy runbook (the order matters — a stale manager token has `name` but not `manager`)
The permissive rule already requires the `manager` claim for on-behalf writes, so managers must be
migrated **in the B2 window** (not deferred to B3). Both `deploy-functions.yml` and `deploy-rules.yml`
fire on the same merge to `main`, so to avoid a brief manager lockout window do this in order:
1. **Merge B2.** `setupRosterAuth` (with the `manager` claim) and the new rules both deploy.
2. **Immediately** run Operations → **Set up accounts** — this sets `{ manager: true, name }` on the
   6 manager accounts. (Until this runs, managers have only `name`.)
3. **Refresh manager tokens:** have each manager sign out/in, or just wait — Firebase ID tokens
   auto-refresh hourly and on next app open, so the window is short and self-healing.
4. **Verify in a private window** (never an installed phone): a manager saves another member's AL;
   a non-manager staff member cannot; admin still can; roster upload still saves.
- **Residual window:** between step 1 and a given manager's token refresh, that manager's on-behalf
  writes are rejected (a soft, recoverable failure — re-open the app — not data loss). Admin
  break-glass covers anything urgent. **Zero-window alternative:** merge the `setupRosterAuth` change
  first, run Set up accounts + manager refresh, *then* merge the rules in a follow-up — ask if you
  want B2 split into two merges.

### B3 — claims audit + token-refresh rollout (HIGHEST RISK) — ✅ COMPLETED (v16.29)

> ✅ **COMPLETED (v16.29) — the steps below are what was executed; this is now a historical record.**
> The `!('name' in token)` legacy escape was removed from the `overrides` create/update AND delete
> rules; writes now require `token.name == memberName || token.admin || token.manager`. It shipped
> after re-provision + the `CLAIM_EPOCH == 2` sweep, with `writeWithClaimRetry` self-healing any stale
> token on first write — no mass sign-out was needed. Rollback (re-add the two escape lines) remains
> instant. The runbook and diffs below record what was done.

- **Goal:** every active session carries a fresh claim **of its correct tier** (`admin`, `manager`,
  or plain `name`), then tighten the interim rule to strict.
- **Who:** Owner (Console + chosen window) + Claude (the two rule versions + verification script).
- **The risk, stated plainly:** a member on a valid 30-day localStorage session holds a Firebase
  token minted *before* its claim existed. A strict `token.name == memberName` rule rejects a
  staff member on a pre-`name` token; the strict three-tier rule **also** rejects a **manager on a
  pre-`manager`-claim token** (their on-behalf write needs `token.manager == true`, which an old
  token lacks). Doing this as a hard cutover **is** the v10.94 outage — and now with a second class
  of victim (managers), which is easy to forget because there are only six of them.
- **Mitigation — permissive→strict migration (all three tiers):**
  1. Deploy the **permissive** rule: allow the write if `token.name == memberName` **OR**
     `token.admin == true` **OR** `token.manager == true` **OR** the token has no `name` claim yet
     (legacy/anonymous). Claim-carrying sessions are isolated; legacy sessions keep working — same
     posture as today, no lockout.
  2. **Re-provision first:** run "Set up accounts" so the new `manager` claim is set on all six
     manager accounts (and every `name`/`admin` claim is reasserted). Then force/await a token
     refresh for all active sessions so every live token gains its correct-tier claim.
     **The `getIdToken(true)` sweep mechanism is now BUILT (v14.71):** `CONFIG.CLAIM_EPOCH` in
     `roster-data.js` + `refreshClaimsIfStale()` in `session.js` (called fire-and-forget from
     `ensureNamedSession` once a named session resolves). It force-refreshes each device's token
     ONCE per epoch bump, gated by `localStorage('myb_claim_epoch')` — so to sweep all active
     sessions you **bump `CLAIM_EPOCH` and deploy**, and every device refreshes on its next app open.
     Shipped at `CLAIM_EPOCH: 1`, which also accelerates B2 (managers pick up the `manager` claim on
     next open instead of waiting for the hourly auto-refresh). 6 unit tests in `session.test.mjs`.
     For the strict cutover this ran as: `CLAIM_EPOCH` → 2 (armed v15.33), deploy, let the sweep window
     pass, then ship strict (done v16.29).
  3. After the window, the **strict** rule was deployed (dropped the `|| no-name` branch) — ✓ v16.29.
  - A low-traffic window was used. **Verified in a fresh private window, never an installed phone.**
- **Rollback:** redeploy the permissive rule (instant), or revert to `request.auth != null`.
- **Gate (verified before the strict tighten, ✓ v16.29):** in a private window — a **staff** member
  writes their own AL/sick AND cannot write/delete another member's; a **manager** writes AND deletes
  another member's AL/sick (on-behalf works) but is still blocked from
  huddle/circular/newsletter/roster/auth; **admin** still writes for others; roster upload still saves
  — the strict rule was then shipped.
- **Write-side stale-claim retry (v15.07 review H3) — ✓ DONE (v15.18).** This is **only the
  write-side retry** — one part of the B3 claim-freshness story (re-provision, `CLAIM_EPOCH` sweep,
  matrix verify, and removing the no-name Rules escape were the rest — all now DONE, strict shipped
  v16.29; see the checklist below).
  `writeWithClaimRetry(writeFn)` in `firebase-client.js` (the write-side equivalent of
  `adminReadWithRetry`) retries **exactly once**, and **only** on `err.code === 'permission-denied'`
  with a live `auth.currentUser`, after a **forced** token refresh (`getIdToken(true)`); any other
  error class (unavailable/network, deadline-exceeded, etc.) or a second denial is re-thrown, so a
  genuine authorisation failure is never masked or looped. Wired into all three `admin-overrides.js`
  override write paths — `executeSave` (shift changes), `recordRangeOverrides` (AL/absence), and the
  override-list bulk delete — each passing a re-runnable build-and-commit thunk (a `WriteBatch` can't
  be re-committed) whose return value is what updates the in-memory cache, so the cache/UI reflects
  only the **successful** attempt (no ghost row from the failed one) and is never mutated when both
  attempts fail. 4 retry tests in `admin-overrides.test.mjs` (recordRangeOverrides + executeSave,
  incl. refresh-called-once and cache-untouched-on-persistent-denial; a single-commit `WriteBatch`
  mock catches batch reuse). Bulk delete shares the identical wrapped-thunk pattern (verified by
  inspection — its cache mutation is after the awaited commit, inside the `try`). This is a safety net
  that is **independent of — and does not replace —** the `CLAIM_EPOCH` sweep
  (which already ran — armed to `2` at v15.33, so `refreshClaimsIfStale` is now active).
  See LOGIN_INCIDENT.md.

#### B3 cutover runbook — ✅ COMPLETED (v16.29) — the steps below are what was executed; this is now a historical record

> **Exact, line-verified patch (as applied):** `B3_STRICT_CUTOVER.HELD.md` (repo root) holds the
> `firestore.rules` diff AND the `firestore.rules.test.mjs` rework that shipped, verified against the
> live files at v15.32 (dry-run re-verified v16.28) and deployed v16.29. The steps below are the
> surrounding overview; that file is the patch that was applied.
> **Note the test rework was broader than a naive "create tests" swap:** the whole
> `describe('overrides')` field-validation block used `staffDb()` (no-name), which strict denies — every
> one moved to `namedDb('G. Miller')`, and the no-name escape test flipped to `assertFails` (+ a delete
> mirror).

Everything below **WAS HELD until the v16.29 window**, then applied on a fresh branch, gated by the
`test:rules` emulator suite, and merged (merging to `main` runs `deploy-rules.yml` and ships the rule
LIVE). It was executed in this order. (The write-side retry net, v15.18, was already live and meant a
manager who missed the sweep self-healed on first write — so the cutover was safer than a cold one; the
sweep was still done.)

**Pre-window checks:** `CLAIM_EPOCH == 2` (sweep already armed v15.33 — see Progress below),
`ENFORCE_NAMED_SESSION == true`, in-place-login rollout deployed and settled; `CONFIG.MANAGER_NAMES`
matches current staff.

**Step 1 — Re-provision (owner).** Operations → Set up accounts (sets `admin`/`manager`/`name` on every
account). Idempotent — re-run in the window even if done earlier as a warm-up, to catch any account
that changed since.

**Step 2 — Force the token sweep — ✓ ALREADY DONE (v15.33).** `CONFIG.CLAIM_EPOCH` is already `2`
(higher than any previously-shipped value — 1 shipped in v14.71, hotfixed to 0 in v14.72 — so every
device force-refreshes once on next open regardless of its stored `myb_claim_epoch`). **Do NOT bump it
again** unless deliberately forcing a fresh sweep. What remains of this step at window time: confirm
active devices have re-opened since the v15.33 hosting deploy, and force sign-out any stragglers.

**Step 3 — Strict rule diff (Claude) — ✓ DONE (v16.29).** Removed the no-name escape from the
`overrides` create/update AND delete blocks in `firestore.rules`:

```diff
           request.auth.token.name == request.resource.data.memberName ||
           request.auth.token.admin == true ||
-          request.auth.token.manager == true ||
-          !('name' in request.auth.token)
+          request.auth.token.manager == true
         );
   ...
       allow delete: if request.auth != null && (
         request.auth.token.name == resource.data.memberName ||
         request.auth.token.admin == true ||
-        request.auth.token.manager == true ||
-        !('name' in request.auth.token)
+        request.auth.token.manager == true
       );
```

**Step 4 — Rules-test rework (Claude) — REQUIRED and non-obvious.** In `firestore.rules.test.mjs` the
existing override **create** tests use `staffDb()` (an authed context with NO `name` claim), which today
only passes isolation via the permissive escape. Under strict, `staffDb()` create is DENIED, so:
- Replace `staffDb()` → `namedDb('G. Miller')` in **every override CREATE test** (VALID_OVERRIDE's
  `memberName` is `'G. Miller'`). Otherwise the `assertSucceeds` field tests break, and the
  `assertFails` field tests would pass for the WRONG reason (isolation denial, not field validation) —
  masking a real regression.

**Step 5 — Strict matrix tests to add** (create + a delete mirror):

```js
describe('overrides — strict isolation (B3)', () => {
  test('staff writes OWN override',            async () => { await assertSucceeds(setDoc(doc(namedDb('G. Miller'),  'overrides', uid()), VALID_OVERRIDE())); });
  test('staff CANNOT write another member',    async () => { await assertFails   (setDoc(doc(namedDb('A. Other'),   'overrides', uid()), VALID_OVERRIDE())); }); // memberName = G. Miller
  test('manager writes another member',        async () => { await assertSucceeds(setDoc(doc(managerDb('S. Stewart'),'overrides', uid()), VALID_OVERRIDE())); });
  test('admin writes another member',          async () => { await assertSucceeds(setDoc(doc(adminDb(),             'overrides', uid()), VALID_OVERRIDE())); });
  test('no-name token DENIED (escape gone)',   async () => { await assertFails   (setDoc(doc(staffDb(),             'overrides', uid()), VALID_OVERRIDE())); });
  test('anonymous DENIED',                     async () => { await assertFails   (setDoc(doc(anonDb(),              'overrides', uid()), VALID_OVERRIDE())); });
});
```

**Step 6 — Deploy strict rules (owner) — ✓ DONE (v16.29).** The strict branch was merged →
`deploy-rules.yml` ran the reworked suite as a gate, then shipped. Done **after** the Step 2 sweep
window, never before.

**Step 7 — Verify live (owner, private window) — ✓ DONE (v16.29):** staff writes own AL/absence ✓;
staff cannot edit another's ✗; manager edits another's ✓ and is still blocked from
huddle/circular/newsletter/roster/auth; admin edits others' ✓; roster upload saves ✓.

**Rollback:** re-add the two escape lines and redeploy the permissive rule (instant), or revert
`overrides` to `request.auth != null`. No data migration either way.

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

---

## Owner decisions needed (collect before starting the dependent phase)

| Decision | Blocks | Notes |
|----------|--------|-------|
| ~~Confirmed Chiltern **work-email domain**~~ | ~~staffContact domain validation~~; C2/C4 email recovery | **✓ RESOLVED (v14.97): `chilternrailways.co.uk`** — `CONFIG.WORK_EMAIL_DOMAIN` (single source) + `isChilternWorkEmail()` in `roster-data.js`, enforced client-side AND in `firestore.rules`. (Was deferred in v14.24 for lockout risk.) Still confirm it's the right domain before C2/C4 email *recovery* relies on it. |
| Email relay choice — Power Automate vs Firebase Trigger Email | C2, C4 | Power Automate relay already exists (Huddle ingest). |
| Code expiry / retry-rate-limit policy | C2, C4 | 10-minute expiry + 3-attempt lockout is the documented default. |
| ~~A low-traffic **re-auth window**~~ | ~~B3~~ | **✓ DONE (v16.29): strict cutover shipped.** The window re-provisioned + refreshed tokens for the 6 managers too (`manager` claim), the `CLAIM_EPOCH == 2` sweep + `writeWithClaimRetry` self-heal meant no mass sign-out, and the no-name escape was removed. |
| ~~`linkDesigns` isolation: leave open vs. add a `linksDesigner` claim~~ | ~~B2~~ | **SUPERSEDED — ✓ H2 SHIPPED (v16.29): added the `linksDesigner` claim.** The earlier "leave at `request.auth != null`" decision (Jul 2026) was replaced: `linkDesigns` writes now require `linksDesigner`/`admin` (reads stay open); `setupRosterAuth` sets the claim from `CONFIG.LINKS_DESIGNERS`. |
| `pushSubscriptions` delete: keep `request.auth != null` vs. add a stored owner field | B2 | Recommendation: keep as-is (no member identity on the doc; the id already requires knowing the endpoint). |
| ~~GCP **Workload Identity Pool** setup~~ | ~~A2~~ | **✓ DONE (v14.93)** — pool/provider/binding built with the repo-scoped `assertion.repository` condition (Appendix A2). |
| reCAPTCHA Enterprise provider | D1/D2 | Required before App Check can attest. |
| Is the app **official Chiltern infrastructure**? | App Check priority; header-capable hosting | If yes, App Check and Firebase-Hosting-only (drop github.io) rise in priority. |

---

## What NOT to do (anti-goals)

- **Do not** ship per-member isolation as a hard cutover. Use the permissive→strict migration.
- **Do not** enforce App Check and roll out isolation in the same window.
- **Do not** bundle the Track-A infra work (WIF/A2, the functions `uuid` fix/A1) into the authz
  release — different failure domains. (Both are now done, shipped standalone as intended.)
- **Do not** retire the surname password (C5) before the ≥90% migration metric.
- **Do not** remove the calendar's anonymous read/bootstrap when hardening
  `ensureFirebaseSession` — that path is a deliberate public-read surface.
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
      → re-ran Set up accounts in-window → applied the strict rule + reworked tests
      (`B3_STRICT_CUTOVER.HELD.md`) on a fresh branch → verified the private-window matrix → deployed the
      strict rule. `writeWithClaimRetry` self-healed stale tokens, so no mass sign-out was needed.
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

---

## Appendix: A2 — Workload Identity Federation ✓ COMPLETE (v14.93)

**What it did:** retired the long-lived `FIREBASE_SERVICE_ACCOUNT` JSON key (previously
`echo … > /tmp/key.json` in all 3 deploy workflows) for **short-lived GitHub OIDC tokens** — no
standing full-project deploy credential remains in GitHub. All 3 workflows use
`google-github-actions/auth` (pinned `v2.1.13`, commit `c200f369`) with the provider + SA written
directly in each YAML (they aren't secrets) and job `permissions: { contents: read, id-token: write }`.
The old SA JSON key AND the `FIREBASE_SERVICE_ACCOUNT` secret are both deleted; a deploy from `main`
was confidence-checked with the key gone. It was de-risked by migrating one workflow (rules) first
and keeping the secret as a fallback until all three were proven, then deleting the key last.

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
