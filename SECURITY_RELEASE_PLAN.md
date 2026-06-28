# SECURITY_RELEASE_PLAN.md — Phased plan for the security hardening work

*Status: planning only — nothing here is implemented yet. Created v14.38 (June 2026).*

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
    B0 ensureFirebaseSession rework ──┬─► B1 named-session separation
        (FOUNDATION)                   │      (+ remove browser account-creation)
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
- **Goal:** stop the silent anonymous fallback on pages that write. Classify the failure
  (`auth/wrong-password` / `auth/invalid-credential` = custom password set elsewhere;
  `auth/user-not-found` = provisioning gap; provider disabled) and surface a "please sign in
  again" state instead of a claim-less anonymous session.
- **Who:** Claude (branch + unit tests in `session.test.mjs`).
- **Why first:** prerequisite for B1, B2 and C3. Also the documented Stage-3 prerequisite
  (ROADMAP → Password Stage 3, "ensureFirebaseSession rework").
- **Risk:** over-aggressive removal of the anonymous path could break the **calendar's**
  legitimate anonymous read/usage/error-report writes (which intentionally use anonymous auth).
- **Mitigation:** scope the change to the **write/named pages** (admin, operations, settings,
  links, paycalc); leave the calendar's anonymous bootstrap (`calendarAuthReady`) untouched —
  it is a *read* surface with best-effort analytics writes, governed separately.
- **Rollback:** revert `session.js`; behaviour returns to today's silent fallback.
- **Gate:** unit tests prove each error code routes to re-login, not anonymous, on named pages;
  e2e still green; calendar anonymous path unaffected.

### B1 — named-session separation + remove browser account-creation
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
- **Goal:** `overrides` (and `linkDesigns`) writes require `request.auth.token.name == memberName`
  with the **load-bearing** admin bypass `|| request.auth.token.admin == true` (admin writes for
  others constantly: AL/sick on behalf, every `source:'roster_import'` row). **Also tighten the
  `pushSubscriptions` delete rule here** (folded in from A3) — add an owner/admin check, verifying
  the legitimate `deletePushSubscription` unsubscribe path still works under emulator test.
- **Who:** Claude (branch — rule + emulator tests). **Branch push does not deploy** (deploy-rules.yml
  runs on merge to `main`).
- **Risk:** the rule is correct but rollout locks out cached-token sessions (see B3); a too-tight
  `pushSubscriptions` delete rule could break a device unsubscribing.
- **Mitigation:** this phase ships **only** the permissive interim isolation rule + tests; the strict
  tighten happens in B3 after the re-auth sweep. Mirror the pattern already live on `staffContact`.
  For pushSubscriptions, prove the unsubscribe path under emulator test before tightening.
- **Rollback:** revert the rule; `request.auth != null` restored.
- **Gate:** emulator tests prove (a) member A cannot write member B's override, (b) admin can
  write anyone's, (c) the `roster_import` path still saves, (d) Links isolation + admin bypass,
  (e) a device can still delete its own push subscription under the tightened delete rule.

### B3 — claims audit + token-refresh rollout (HIGHEST RISK)
- **Goal:** every active session carries a fresh `name` claim, then tighten the interim rule to strict.
- **Who:** Owner (Console + chosen window) + Claude (the two rule versions + verification script).
- **The risk, stated plainly:** a member on a valid 30-day localStorage session holds a Firebase
  token minted *before* the `name` claim existed. A strict `token.name == memberName` rule rejects
  that token until they sign out/in. Doing this as a hard cutover **is** the v10.94 outage.
- **Mitigation — permissive→strict migration:**
  1. Deploy the **permissive** rule: allow the write if `token.name == memberName` **OR** the
     token has no `name` claim yet (legacy/anonymous). Isolation applies to claim-carrying
     sessions; legacy sessions keep working — same posture as today, no lockout.
  2. Force/await a token refresh for all active sessions (forced re-auth, or a short
     `getIdToken(true)` sweep triggered on next app open) so every live token gains the claim.
  3. After the window, deploy the **strict** rule (drop the `|| no-name` branch).
  - Pick a low-traffic window. **Verify in a fresh private window, never your installed phone.**
- **Rollback:** redeploy the permissive rule (instant), or revert to `request.auth != null`.
- **Gate:** in a private window, a non-admin writes their own AL/sick AND cannot write another
  member's; admin still writes for others; roster upload still saves — *then* tighten to strict.

### B4 — server-owned roster/role lists
- **Goal:** `setupRosterAuth` stops trusting the member/admin lists sent by the client; move to
  server-owned config with recent-login/revocation-aware checks, **dry-run** orphan removal,
  explicit destructive confirmation, and token revocation after demote/disable.
- **Who:** Claude (function) + owner deploy.
- **Risk:** a server-owned list that drifts from `teamMembers` could disable a real account, or
  orphan-removal could delete a needed account.
- **Mitigation:** generate the server list from `roster-data.js` via the existing
  `generate-roster-members.mjs` pipeline (single source of truth); dry-run + explicit confirm on
  any destructive op; revocation is additive.
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
| A low-traffic **re-auth window** | B3 | The single highest-risk step; pick when a brief staff re-login is acceptable. |
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
- **Do not** verify any of this from an installed phone — always a fresh private window.

---

## Progress checklist (tick as shipped)

- [x] A3 — doc-only accuracy ✓ (v14.38: pushSubscriptions delete posture stated; bearer-URL notes confirmed; rule-tighten moved into B2)
- [ ] B0 — `ensureFirebaseSession` hardening (foundation — first substantive phase)
- [ ] A2 — Workload Identity Federation (one workflow first)
- [ ] B1 — named-session separation + remove browser account-creation
- [ ] B2 — per-member override + Links isolation rule (permissive) + emulator tests
- [ ] B3 — claims audit + permissive→strict token-refresh rollout
- [ ] B4 — server-owned roster/role lists
- [ ] C2 — email verification
- [ ] C4 — forgotten-password reset
- [ ] C3 — self-service password change
- [ ] C5 — retire surname password (irreversible; gated on ≥90% migrated)
- [ ] D1 — App Check monitor-first
- [ ] D2 — App Check enforce (Firestore → Storage → Functions)
- [ ] A1 — firebase-admin v14 (when upstream peer range allows)
