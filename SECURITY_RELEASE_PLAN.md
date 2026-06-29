# SECURITY_RELEASE_PLAN.md — Phased plan for the security hardening work

*Status: in progress. Created v14.38. **B1 ENABLED v14.42** (`CONFIG.ENFORCE_NAMED_SESSION = true`)
after the owner confirmed every active account is provisioned and the list matches current staff —
write pages now require the member's own named session; kill-switch revert is a one-line flip back
to false. A3 (doc-only) + B0 (identity signal) shipped v14.38–v14.39.
B1.1 (remove anonymous fallback + browser account-creation) shipped v14.40; B1.2 (per-page
enforcement) shipped v14.41; the flag-ON e2e coverage shipped v14.41 too (10 tests proving the
per-page matrix) — all behind the default-OFF `CONFIG.ENFORCE_NAMED_SESSION` kill-switch, so
production behaviour is unchanged until the flag is flipped. **B1 is now code-complete and tested;
the only remaining step before enabling is the OWNER provisioning audit** (Operations → Set up
accounts + private-window role check), then flip the flag. See "Appendix: B1 detailed scope".
**B2 scope corrected v14.51** after a tier sweep: the original "`name == memberName` + admin bypass"
ignored the **Management tier** (6 managers who edit staff data on behalf and would have been
silently locked out), wrongly treated `linkDesigns` as member-owned (it is keyed by design name;
designer S. Silva is a CEA), and assumed `pushSubscriptions` carries an owner identity (it does
not). B2 now introduces a **`manager: true` claim** and a three-tier override rule (incl. delete);
see "The identity tiers the rules must respect" and the rewritten B2/B3/B4 phases.
**B2 BUILT v14.53** (branch, not deployed): `setupRosterAuth` sets the `manager` claim for
`MANAGER_NAMES`; `firestore.rules` enforces the permissive 3-tier override isolation (create/update/
delete) + bounded date validation; `linkDesigns` deliberately left open; `pushSubscriptions`
unchanged. 13 new emulator tests (3-tier matrix, delete, date denial) — full `test:rules` suite
green (173). **Before it can be relied upon, see the B2 deploy runbook below.**\*

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
| **Management** | `CONFIG.MANAGER_NAMES` (6 names) | **`{ manager: true, name }`** ← does not exist yet | Overrides (AL/sick/shift) **on behalf of any staff member** — but NOT the master-admin uploads/auth-setup |
| **Staff** | everyone else | `{ name }` | Only their **own** overrides (`token.name == memberName`) |
| *Links designer* | `CONFIG.LINKS_DESIGNERS` (`['G. Miller', 'S. Silva']`) | *cross-cuts the above* — S. Silva is a **CEA**, not a manager | `linkDesigns` (designs are **not** member-owned) |

**Today:** only `ADMIN_NAMES` is sent to `setupRosterAuth` as `adminMembers`, so only G. Miller
carries `admin: true`. Managers carry just `{ name }`; the *client* (`admin-app.js`
`applyPermissions`) grants them full edit access, but **the Firestore rules cannot tell a manager
from ordinary staff.** That is fine while the rule is `request.auth != null`, and a silent lockout
the moment a rule needs a claim. So:

- **B2 introduces a `manager: true` claim** (set by `setupRosterAuth` for `MANAGER_NAMES`) and the
  override/Links rules check `name == memberName || admin == true || manager == true`. The
  master-admin-only collections (huddles, circulars, newsletters, roster upload, auth setup) stay
  `admin == true` only — do **not** grant managers `admin: true`, which would let them reach those
  APIs directly and dissolve the very tier separation `MANAGER_NAMES` exists to enforce.
- **B3's claims audit + token-refresh sweep must cover all three tiers** — a manager on a token
  minted before the `manager` claim existed is rejected by the strict rule exactly like a staff
  member on a pre-`name` token.
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
    A1 firebase-admin v14 ........ (blocked on upstream peer range; mechanical when freed)
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
   **The single highest-risk step in the entire plan.**
5. **B4** — server-owned roster/role lists.
6. **C2 → C4 → C3 → C5** — password release.
7. **D1 → D2** — App Check monitor-then-enforce, once B is stable.
8. **A1** — firebase-admin v14 whenever `firebase-functions` widens its peer range.

---

## Phase detail and risk register

Each phase: **Goal · Who · Risk · Mitigation · Rollback · Go/no-go gate.**
"Claude" = branch + test work; "Owner" = Firebase/GCP Console or a chosen production window.

### A1 — firebase-admin v14 (clears 9 moderate advisories)
- **Goal:** remove the transitive `uuid` advisories in `functions/`.
- **Who:** Claude (mechanical), owner deploys.
- **Status:** externally blocked — `firebase-functions@7.x` peers `^11||^12||^13`. Not a
  readiness gap; a wait.
- **Risk:** v14 dropped the legacy `admin.firestore` namespace → `FieldValue` import path
  changes; an unaudited call site breaks a Cloud Function at runtime.
- **Mitigation:** follow the step list in KNOWN_LIMITATIONS → "firebase-admin upgrade to v14";
  test all three functions (ingestHuddle, parseRosterPDF, setupRosterAuth) pre-deploy.
- **Rollback:** revert the `functions/package.json` bump; functions redeploy from the prior lockfile.
- **Gate:** `npm outdated` in `functions/` shows `firebase-functions` peering `^14`. Until then, do not start.

### A2 — Workload Identity Federation (retire the long-lived SA JSON)
- **Goal:** replace `FIREBASE_SERVICE_ACCOUNT` JSON (written to `/tmp/key.json` in CI) with
  keyless GitHub OIDC/WIF.
- **Who:** Owner (GCP Workload Identity Pool + provider + binding); Claude edits the workflow YAML.
- **Risk:** a faulty federation config **stops all deploy workflows** (hosting, functions, rules).
- **Mitigation:** migrate **one** workflow first (rules — lowest frequency); keep the
  `FIREBASE_SERVICE_ACCOUNT` secret in place as a fallback until all three are proven on WIF;
  only then delete the secret and rotate the old key.
- **Rollback:** revert the workflow to the secret-based auth step (secret still present).
- **Gate:** the migrated workflow completes a real deploy via OIDC with no SA JSON in the job.

### A3 — doc-only accuracy fixes ✓ DONE (v14.38)
- **Goal:** make the docs state the actual posture; defer any *rule* change to B2.
- **Who:** Claude. **Status: done, doc-only, no rule changed.**
- **What was done:**
  - `pushSubscriptions` **delete** posture: the rule is `request.auth != null` (any authenticated
    identity that knows the doc id can delete). AI_MAP already noted this; CLAUDE.md now states it
    explicitly too, so no doc overclaims owner/admin-only. The id is a SHA-256 of the endpoint, so
    exploitation needs the endpoint — low risk. **Tightening the rule is folded into B2** (it is a
    rule change with the same silent-failure class, and must not break the legitimate
    `deletePushSubscription` unsubscribe path — so it belongs with the emulator-test work, not here).
  - Bearer-URL read distinction for huddle/circular/newsletter Storage — done in the v14.37 L1 pass
    (`storage.rules` + rule comments). ROADMAP "Documentation accuracy fixes" updated to reflect both.
- **Why it is NOT a "phase 1":** ordering by easiness conflated a free doc edit with a real rule
  change. Only the doc edit was free; the rule edit moved to B2. **B0 is the first substantive phase.**

### B0 — `ensureFirebaseSession` hardening (FOUNDATION)
Split into two safe increments (same discipline as A3 — don't bundle a zero-risk change with a
behavioural one):

**B0 (observability) — ✓ DONE (v14.39).** `ensureFirebaseSession` now records and exposes whether
it established the member's **named** account or only the **anonymous** fallback:
`getFirebaseIdentity()` → `'named'|'anonymous'|'none'`, `firebaseSessionIsNamed()`,
`getFirebaseAuthError()`. **No runtime behaviour change** — the anonymous fallback still happens,
so nothing regresses. `firebaseSessionIsNamed()` is the exact signal B2 needs. 7 unit tests in
`session.test.mjs` cover named reuse, email/password sign-in, self-heal create, anonymous fallback,
total failure, and stale-session (anonymous / other-member) replacement. The `window._mybAuthError`
writes are now `typeof window` guarded so the path is node-testable. (Also fixed stale AI_MAP text
that still described the reverted v14.28 `_endSession` behaviour.)

**B0-enforce — folded into B1.** The behavioural half (refuse to proceed on a claim-less session /
prompt re-login instead of writing silently) is multi-page UX that belongs with B1's named-session
separation. Doing it before B1 would either regress (silent write loss with no prompt) or require
B1's per-page work anyway. It consumes `firebaseSessionIsNamed()` from B0.
- **Why first:** the B0 signal is the prerequisite for B1, B2 and C3 (also the documented Stage-3
  prerequisite — ROADMAP → Password Stage 3, "ensureFirebaseSession rework").
- **Risk (of the enforce half, in B1):** over-aggressive blocking could break the **calendar's**
  legitimate anonymous reads — but the calendar uses `calendarAuthReady`, not `ensureFirebaseSession`,
  so the split is automatic; leave the calendar bootstrap untouched.
- **Rollback:** B0 is purely additive (new exports); revert `session.js` to drop them.
- **Gate:** ✓ unit tests prove the identity is reported correctly for every path; full suite + e2e green.

### B1 — named-session separation + remove browser account-creation
> **Detailed scope: see "Appendix: B1 detailed scope" at the foot of this file** — call-site map,
> the soft/hard per-page enforcement matrix, re-auth UX, the kill-switch, and the testing plan.
- **Goal:** anonymous auth confined to the public Calendar read path; Admin/Operations/Links/
  Settings/Pay require a genuine named session. Stop the client auto-creating Firebase accounts
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

### B2 — per-member override + Links write isolation (the headline gap)
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
  (no admin/manager claim). Member-name isolation does not fit this collection. **Decision needed
  (owner):** either (a) **leave `linkDesigns` at `request.auth != null`** — its current rule, whose
  comment already says "per-designer isolation is not needed here"; the real access control is the
  client redirect on `CONFIG.LINKS_DESIGNERS`, and the blast radius is one niche internal design
  tool — **recommended**; or (b) add a dedicated **`linksDesigner: true`** claim for the
  `LINKS_DESIGNERS` names and gate writes on `admin || linksDesigner`. Do **not** fold `linkDesigns`
  into the override member-name model. (Recommendation: (a) — defer the designer claim unless/until
  the workspace opens to more people.)
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
- **Mitigation:** this phase ships **only** the permissive interim isolation rule + tests; the strict
  tighten happens in B3 after the re-auth sweep. Mirror the pattern already live on `staffContact`
  (which is already three-tier-correct: `name == memberName || admin`).
- **Rollback:** revert the rule; `request.auth != null` restored. The `manager` claim is additive
  (an extra claim on a token harms nothing if the rule is rolled back).
- **Gate:** emulator tests prove (a) staff member A cannot write or delete member B's override,
  (b) **a manager CAN write and delete any member's override**, (c) admin can write/delete anyone's,
  (d) the `roster_import` path still saves, (e) a **manager is still rejected** by the master-admin
  collections (huddles/circulars/newsletters/roster/auth) — tier separation holds, (f) `linkDesigns`
  behaves per the chosen option, (g) a device can still delete its own push subscription,
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

### B3 — claims audit + token-refresh rollout (HIGHEST RISK)
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
     For the strict cutover: bump `CLAIM_EPOCH` → 2, deploy, let the sweep window pass, then ship strict.
  3. After the window, deploy the **strict** rule (drop the `|| no-name` branch).
  - Pick a low-traffic window. **Verify in a fresh private window, never your installed phone.**
- **Rollback:** redeploy the permissive rule (instant), or revert to `request.auth != null`.
- **Gate:** in a private window — a **staff** member writes their own AL/sick AND cannot write/delete
  another member's; a **manager** writes AND deletes another member's AL/sick (on-behalf works) but
  is still blocked from huddle/circular/newsletter/roster/auth; **admin** still writes for others;
  roster upload still saves — *then* tighten to strict.

### B4 — server-owned roster/role lists
- **Goal:** `setupRosterAuth` stops trusting the member/admin lists sent by the client; move to
  server-owned config with recent-login/revocation-aware checks, **dry-run** orphan removal,
  explicit destructive confirmation, and token revocation after demote/disable.
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
| Confirmed Chiltern **work-email domain** | staffContact domain validation; C2/C4 email recovery | Deferred in v14.24 for exactly this reason (lockout risk if wrong). |
| Email relay choice — Power Automate vs Firebase Trigger Email | C2, C4 | Power Automate relay already exists (Huddle ingest). |
| Code expiry / retry-rate-limit policy | C2, C4 | 10-minute expiry + 3-attempt lockout is the documented default. |
| A low-traffic **re-auth window** | B3 | The single highest-risk step; pick when a brief staff re-login is acceptable. **The window must re-provision + refresh tokens for the 6 managers too** (new `manager` claim) — not just staff. |
| `linkDesigns` isolation: leave open vs. add a `linksDesigner` claim | B2 | Recommendation: leave at `request.auth != null` (designs aren't member-owned; S. Silva is a CEA; client redirect on `LINKS_DESIGNERS` is the real control). |
| `pushSubscriptions` delete: keep `request.auth != null` vs. add a stored owner field | B2 | Recommendation: keep as-is (no member identity on the doc; the id already requires knowing the endpoint). |
| GCP **Workload Identity Pool** setup | A2 | Owner GCP work; Claude does the workflow YAML. |
| reCAPTCHA Enterprise provider | D1/D2 | Required before App Check can attest. |
| Is the app **official Chiltern infrastructure**? | App Check priority; header-capable hosting | If yes, App Check and Firebase-Hosting-only (drop github.io) rise in priority. |

---

## What NOT to do (anti-goals)

- **Do not** ship per-member isolation as a hard cutover. Use the permissive→strict migration.
- **Do not** enforce App Check and roll out isolation in the same window.
- **Do not** bundle WIF or the firebase-admin bump into the authz release.
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
- [ ] A2 — Workload Identity Federation (one workflow first)
- [x] B1 — named-session separation + remove browser account-creation. **ENABLED v14.42**
      (`CONFIG.ENFORCE_NAMED_SESSION = true`) after the owner provisioning audit. Revert = flip back
      to false. Watch for any "bounced to re-login and can't get back in" reports in the first days.
- [~] B2 — per-member override isolation (permissive, **3-tier: name/admin/manager**, incl. delete)
      + `setupRosterAuth` `manager` claim + `linkDesigns`/`pushSubscriptions` decisions + emulator tests.
      **BUILT v14.53** (branch; 173 rules tests green). Not deployed — see the B2 deploy runbook
      (re-provision + manager token refresh required before the rule is relied upon).
- [~] B3 — claims audit + permissive→strict token-refresh rollout (**re-provision the manager claim too**).
      **Client sweep BUILT v14.71** (`CONFIG.CLAIM_EPOCH` + `refreshClaimsIfStale()`, 6 tests) — the
      deterministic token-refresh mechanism. **Remaining (owner-gated):** re-provision audit, pick a
      low-traffic window, bump `CLAIM_EPOCH`→2 + let the sweep run, verify the private-window matrix,
      THEN deploy the strict rule (drop the `!('name' in token)` branch from `overrides` create/update/delete).
- [ ] B4 — server-owned role lists (**admin + manager + designer**, all generated server-side)
- [ ] C2 — email verification
- [ ] C4 — forgotten-password reset
- [ ] C3 — self-service password change
- [ ] C5 — retire surname password (irreversible; gated on ≥90% migrated)
- [ ] D1 — App Check monitor-first
- [ ] D2 — App Check enforce (Firestore → Storage → Functions)
- [ ] A1 — firebase-admin v14 (when upstream peer range allows)

---

## Appendix: B1 detailed scope (scoped v14.39, not yet implemented)

B1 turns the B0 *signal* (`firebaseSessionIsNamed()`) into *enforcement*: the write pages stop
accepting a claim-less session, anonymous auth is confined to the public Calendar, and the client
stops self-creating Firebase accounts. B1 ships **while the Firestore rules are still
`request.auth != null`** (B2's strict rule comes later), so **B1 cannot lock anyone out via
rules** — its only lockout surface is client-side and reversible with a one-line flag flip. That
makes B1 the safe precursor that *removes the claim-less write sessions* B2 would otherwise reject.

### Why B1 is much lower risk than B2/B3
- No rule changes ship in B1 — a regression is a client-JS revert, not a Firestore rollback.
- In steady state almost nobody hits the anonymous fallback today: named sign-in succeeds for any
  provisioned member. The fallback only fires for an *unprovisioned* account, a password mismatch
  (no custom passwords exist yet), or a disabled provider (misconfig). So once provisioning is
  confirmed, B1's availability impact is ~nil.
- The whole enforcement sits behind a kill-switch (below).

### The three coordinated changes

**B1.1 — `ensureFirebaseSession`: delete the anonymous fallback and the self-heal account creation.**
Because the function is write-pages-only, on a failed named sign-in it now returns `false` /
`_fbIdentity = 'none'` with the error code (B0 already tracks identity). No `signInAnonymously`, no
`createUserWithEmailAndPassword`. **Useful consequence:** the boolean return regains a crisp meaning
— `true` ⇔ named session active — so most of B1.2 is simply "stop ignoring the return value."

**B1.2 — Enforce a named session on each write page** (consume the boolean / `firebaseSessionIsNamed()`).
Current call sites and the change each needs:

| File | Today | B1 change |
|------|-------|-----------|
| `admin-app.js:159` (login `attempt`) | `await ensureFirebaseSession(name)` — **result ignored**, reloads anyway | gate: on `false`, show the login error (don't `saveSession`/reload) |
| `admin-app.js:1634` (returning init) | `resolveSession(ensureFirebaseSession(currentUser))` fire-and-forget | await + on non-named show the login overlay (local session alone no longer suffices) |
| `settings-app.js:137` (login) | checks `authOk` but only `console.warn`s | gate: on `false`, block + show error |
| `settings-app.js:51` (returning) | fire-and-forget | await + gate to overlay |
| `operations-app.js:43` | fire-and-forget (page already redirects non-admins) | await + on non-named, clear session → redirect to admin login |
| `links-app.js:47` | fire-and-forget (already redirects non-designers) | await + on non-named, clear session → redirect to admin login |
| `paycalc-app.js:1297` | fire-and-forget | **SOFT** — log the degraded identity; do NOT block (see matrix) |

**Per-page enforcement matrix — strength matches what the page WRITES** (the key refinement; the
plan's blanket "Pay requires a named session" was too strong):

| Page | Writes isolated/admin data? | Enforcement |
|------|------------------------------|-------------|
| admin | Yes — `overrides` for all members; admin ops | **Hard** — overlay, block the app |
| operations | Yes — admin-only huddle/circular/newsletter/roster/auth writes | **Hard** — redirect to admin login |
| settings | Yes — `staffContact` (already needs the `name` claim) | **Hard** — overlay, block writes |
| links | Yes — `linkDesigns` | **Hard** — redirect to admin login |
| paycalc | **No** — only `clientErrors`/`analytics` (non-isolated, accept any auth) | **Soft** — log only; the calculator is localStorage-based and must keep working |

**B1.3 — Remove browser-side account creation** (the `createUser` removal in B1.1) **+ provisioning
prerequisite.** Owner runs "Set up accounts" and reconciles against `teamMembers` so every active
member (incl. managers) has a server account *before* B1 enables. `/new-starter` already lists "Set
up accounts" — strengthen its wording to **mandatory before the new starter's first login** (the
client no longer self-heals). Admin break-glass (reset to surname default) stays as recovery until
self-service recovery (C4) lands.

### Re-auth UX (the real design question)
When a returning user has a valid *local* session but the *named Firebase* session can't be
established, reuse the existing login overlay, pre-filled with their name, and branch on
`getFirebaseAuthError()`:
- **Transient** (`network-request-failed` / timeout): auto-retry once or twice; if still failing,
  "Couldn't reach sign-in — check your connection" + a Retry button. Do **not** force a full
  re-login or clear the local session (so paycalc's offline calculator keeps working).
- **Persistent** (`invalid-credential` / `user-not-found` / `operation-not-allowed`): "Couldn't
  sign you in — ask your manager to reset your access" (break-glass). Re-entering the same password
  would just fail again.

### Kill-switch (the single most important mitigation)
Gate all B1 enforcement behind one flag (e.g. `CONFIG.ENFORCE_NAMED_SESSION` in `roster-data.js`).
Ship **default-off**, verify in a fresh private window across every role (admin, manager, CEA, CES,
dispatcher, links designer) **and** a deliberately-unprovisioned account, then flip on in a low-traffic
check. If anything locks out, flip off — a one-line deploy, no rules involved. (Verify on the live
URLs in a private window, never an installed phone.)

### Testing
- **Unit** (`session.test.mjs`): the B0 tests asserting an `'anonymous'` outcome are rewritten to
  assert `'none'` + `false` (no fallback); add a "no self-heal on `user-not-found`" test; named-success
  paths unchanged.
- **e2e**: extend `e2e/fixtures.js` so sign-in can be configured to fail, then assert admin/settings
  show the login overlay, operations/links redirect to admin, and **paycalc still renders the
  calculator** (soft path). Today the fixture always resolves sign-in, so this is new fixture work.
- **Manual**: private-window matrix above + the unprovisioned-account re-auth message.

### Files touched (estimate)
`session.js` (−~20 lines: drop fallback/create), `session.test.mjs`, `admin-app.js`,
`settings-app.js`, `operations-app.js`, `links-app.js`, `paycalc-app.js` (soft), `roster-data.js`
(kill-switch flag), `e2e/fixtures.js` + `e2e/smoke.spec.js`, `.claude/skills/new-starter/SKILL.md`
(provisioning wording), and docs (CLAUDE.md Auth section, AI_MAP, KNOWN_LIMITATIONS' "localStorage
session forgeable" + anonymous-fallback entries, this plan).

### Owner decisions before enabling
1. **Provisioning audit** — confirm every active account exists server-side (the gating prerequisite).
2. **Re-auth aggressiveness** — auto-retry count; keep-vs-clear local session on persistent failure.
3. **Kill-switch default** — recommend ship-off → verify → enable.
4. **Paycalc soft vs hard** — recommendation: **soft** (don't block a localStorage tool on Firebase auth).

### Sub-phase order + go/no-go
1. **B1.1** ✓ DONE (v14.40) — `session.js` gates the self-heal account creation and the anonymous
   fallback behind `CONFIG.ENFORCE_NAMED_SESSION` (default **false** = today's behaviour exactly).
   When true: no `createUser`, no anonymous fallback; a failed named sign-in returns `false`/`'none'`.
   11 unit tests across both flag states (4 new for the flag-on path assert `createUser`/anonymous are
   NOT called). No production behaviour change until the flag is flipped.
2. **B1.2** ✓ DONE (v14.41) — per-page gating behind the same kill-switch (default-off). New
   `ensureNamedSession(name)` helper (transient-only retry via `isTransientAuthError`, then returns
   whether the named session is genuinely active; flag-off → passes through unchanged). Wired into
   all five pages per the matrix: admin/settings show the login overlay (login path shows an inline
   error and routes persistent failures to admin break-glass); operations/links clear + redirect to
   admin; **paycalc soft (log only, never blocks)**. 5 new unit tests for the helper + retry logic.
   All gating is `if (CONFIG.ENFORCE_NAMED_SESSION && !named)`, so flag-off is verified unchanged by
   the existing e2e. **Flag-ON e2e coverage shipped (v14.41):** `enforceNamedSession(page)` in
   `e2e/fixtures.js` rewrites roster-data.js to flip the switch on, and `window.__E2E.failSignIn`
   forces sign-in to fail — 10 tests prove admin/settings re-show the login overlay (despite a valid
   local session), operations/links redirect to admin, and paycalc still renders (soft).
   **Only remaining before enabling:** the owner provisioning audit (Operations → Set up accounts) +
   a private-window role check, then flip the flag.
3. **Owner**: provisioning audit + `/new-starter` wording.
4. **Verify** in a private window across the role matrix + an unprovisioned account.
5. **Enable** the flag (low-traffic check; client-side reversible) — then it's ready for B2.
- **Gate to start B2:** B1 enabled and stable for a few days with no re-auth complaints, so no
  claim-less write sessions remain when B2's strict rule lands.
