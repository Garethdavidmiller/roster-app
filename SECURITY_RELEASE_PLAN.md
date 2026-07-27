# SECURITY_RELEASE_PLAN.md — Phased plan for the security hardening work

*The master **ordering + go/no-go** doc for the deferred security release. Detailed designs live in
ROADMAP.md / KNOWN_LIMITATIONS.md and are NOT duplicated here. Not version-stamped; not a runtime
asset. **Code comments cite this file by section** (`B0`, `B1`, "B1 kill-switch", `B3`, "Appendix
A2") — keep those anchors when editing.*

*Trimmed v17.79: the completed-phase risk registers and the step-by-step cutover runbooks were
removed once the work shipped and `firestore.rules` + `firestore.rules.test.mjs` became the source of
truth (recoverable from git history). What remains: the durable **decisions, invariants, and ordering
lessons**, everything still **open**, and the sections code points at.*

---

## Current state

**Shipped** — the live `firestore.rules` + `firestore.rules.test.mjs` are the source of truth for the
rule text and gate cases:

- **Track A (infra, standalone):** A1 — the transitive `uuid` advisories in `functions/` cleared via a
  scoped **`overrides: { "uuid": "^11.1.1" }`** on the supported firebase-admin **`^13`** (v15.32).
  **`npm audit --omit=dev` is 0 again as of v18.88** — it had drifted to 2 (low `body-parser`,
  moderate `protobufjs`, both transitive DoS advisories), cleared by a lockfile-only `npm audit fix`
  (body-parser 1.20.5→1.20.6, protobufjs 7.6.4→7.6.5; no `package.json` range moved). **Note the
  weekly `functions-audit.yml` runs `--audit-level=high`, so low/moderate drift like this does NOT
  fail CI** — it is caught only by looking. Re-check when reading this doc. The originally-assumed firebase-admin **v14 bump was neither needed nor
  safe** — it breaks the `firebase-functions` peer range and the namespaced `admin.*` API `index.js`
  uses. Drop the override once `@google-cloud/storage` ships `uuid >= 11.1.1` upstream. · A2 — Workload
  Identity Federation, keyless OIDC on all 3 deploy workflows; SA JSON key + `FIREBASE_SERVICE_ACCOUNT`
  secret both deleted (v14.93 — **Appendix A2**). · A3 — doc-only accuracy (v14.38).
- **Track B (authorization release):** B0 — named-vs-anonymous identity signal (v14.39). · B1 —
  named-session enforcement behind `CONFIG.ENFORCE_NAMED_SESSION` (enabled v14.42, rolled back in the
  v14.72 login freeze, **re-enabled v14.98** after the freeze was fixed and B1 exonerated —
  LOGIN_INCIDENT.md). · B2 — per-member `overrides` isolation, permissive 3-tier
  `name || admin || manager` (v14.53) + the `manager` claim in `setupRosterAuth`. · **B3 — strict
  cutover (v16.29):** the `!('name' in token)` legacy escape removed from `overrides` create/update AND
  delete; shipped via the `CLAIM_EPOCH = 2` sweep + `writeWithClaimRetry` self-heal, so **no lockout /
  no mass sign-out**. · B4 — server-owned role lists (`activeMembers` + admin/manager/designer) read
  from `functions/roster-members.json`, dry-run orphan removal (v16.30). · H2 — `linkDesigns` writes
  gated on `linksDesigner`/`admin`, reads open (v16.29); shape-validated since v17.02.
- **Later hardenings:** A5 — `pushSubscriptions` per-owner delete (v17.76): `savePushSubscription`
  stamps `owner = auth.currentUser.uid`; delete requires `resource.data.owner == request.auth.uid` OR
  no `owner` (legacy docs stay deletable so VAPID-rotation cleanup isn't locked out; orphans swept by
  `fanOutPush`'s 410/404 cleanup). **Extended v18.74:** create/update now also require `owner ==
  request.auth.uid` when the field is present, AND on update re-check the EXISTING doc's owner — so a
  session can't take over another device's subscription by re-stamping its own uid (the same
  overwrite-by-re-labelling gap the delete rule closed). Emulator-tested. A6 — a CSP `*.googleapis.com` narrowing was **tried
  and reverted** (it broke the CI `csp` job — the SDK reaches more `*.googleapis.com` hosts on a real
  network than the four listed; the wildcard stays — KNOWN_LIMITATIONS).

**Open** (in dependency order):

- [~] **Track C — password release:** **C3 (self-service change) + C4′ (admin reset) SHIPPED v18.63**
  (the "C-lite" plan in `PASSWORD_PLAN.md` → Phase 0+1: gated dual-attempt sign-in, Settings Password
  card, `resetMemberPassword` break-glass, `passwordStatus` migration flags). **Still open:** C2 email
  verification (deferred until an email relay exists) and C5 retire the surname default (irreversible,
  ≥90% migrated — track via the `passwordStatus` collection).
- [ ] **Track D — App Check:** D1 monitor-first → D2 enforce (Firestore → Storage → Functions) + the
  analytics doc-size key-count cap.
- [ ] **Track E — full-app auth** (calendar behind login) — **UNDECIDED**; most likely trigger is a
  Chiltern-IT requirement if the app becomes official infrastructure.
- [ ] **Deferred residual** — retire the anonymous fallback + the `ENFORCE_NAMED_SESSION` kill-switch
  (held on purpose while the B release soaks — see the section at the foot).

---

## Why a separate plan doc — the one idea that drives it

Almost every item shares a single failure mode: **a write silently fails because the session is not
the identity the rule (or App Check) expects.** This took the app down at v10.94, and it is invisible
from an installed phone (KNOWN_LIMITATIONS → "The installed PWA masks live-site breakage"). The value
of this doc is the **ordering and go/no-go gates**, not feature detail. Three durable consequences:

1. **`ensureFirebaseSession` must stop silently falling back to anonymous on write-pages *before* any
   rule requires a named identity.** A claim-less anonymous session's writes "work" only while the rule
   is `request.auth != null`; the moment a rule needs `token.name`, that same fallback becomes a silent
   lockout. This is the shared foundation (B0).
2. **Never run two silent-failure cutovers at once.** Per-member isolation rollout and App Check
   *enforce* both fail as "writes silently rejected" — if they overlap you can't tell which locked a
   user out. Separate them in time.
3. **Migrate, don't cut over.** Any rule that newly requires a token claim ships first in a *permissive*
   form that accepts both old and new sessions, then tightens after a forced re-auth sweep — converting
   the v10.94 hard-cutover lockout into a two-step migration with no lockout window.

**Hard ordering constraints (still govern the remaining C/D/E work — violating these re-introduces the
v10.94 class of outage):** B0 before anything claim-requiring or custom-password (C3). · **D2 (App Check
enforce) must not overlap a rules cutover** — separate by a stabilisation window. · C5 (retire surname)
is irreversible, gated on ≥90% migration. · Keep Track-A infra (WIF, the functions `uuid` fix) **out**
of the authz release — different failure domains, bundling only widens the blast radius.

---

## The identity tiers the rules must respect (READ BEFORE touching the isolation rules)

The app has **three** privilege tiers, defined in `roster-data.js`. Any isolation rule that only thinks
in "owner vs. admin" silently locks out the middle tier — the manager-lockout gap found while scoping
B2, which recurs in B3/B4. State the tiers once, here:

| Tier | Source list | Firebase claim they must carry | What they legitimately write |
|------|-------------|-------------------------------|------------------------------|
| **Master admin** | `CONFIG.ADMIN_NAMES` (`['G. Miller']`) | `{ admin: true, name }` | Everything — overrides for any member, huddle/circular/newsletter, roster upload, auth setup |
| **Management** | `CONFIG.MANAGER_NAMES` (6 names) | **`{ manager: true, name }`** ← set by `setupRosterAuth` since B2 (v14.53); live only on tokens minted after each manager was re-provisioned + refreshed | Overrides (AL/sick/shift) **on behalf of any staff member** — but NOT the master-admin uploads/auth-setup |
| **Staff** | everyone else | `{ name }` | Only their **own** overrides (`token.name == memberName`) |
| *Links designer* | `CONFIG.LINKS_DESIGNERS` (`['G. Miller', 'S. Silva']`) | *cross-cuts the above* — S. Silva is a **CEA**, not a manager. The `linksDesigner` claim is LIVE (H2, v16.29): `setupRosterAuth` sets it from `CONFIG.LINKS_DESIGNERS` and `linkDesigns` writes are gated on it | `linkDesigns` (designs are **not** member-owned) — write control is the `linksDesigner`/`admin` claim |

Three design points that flow from this and still govern any future rule change:

- The **`manager: true` bypass is load-bearing** — the 6 managers edit staff AL/absence/shifts on behalf
  every day; without it the isolation rule silently locks them out. Equally, the **`admin` bypass** is
  load-bearing (admin writes for others constantly: on-behalf AL/sick, every `source:'roster_import'`
  row). Master-admin-only collections (huddles/circulars/newsletters/roster/auth) stay `admin == true`
  only — **never grant managers `admin: true`**, which would dissolve the very tier separation
  `MANAGER_NAMES` exists to enforce.
- **`linkDesigns` is NOT member-isolated** — designs are keyed by design **name**, not member, and
  designer S. Silva is a CEA with no admin/manager claim, so `token.name == memberName` is meaningless.
  Its write gate is the separate `linksDesigner`/`admin` claim (H2). Do not fold it into the override
  member-name model.
- **Server-owned lists carry all three tiers** (admin + manager + designer), generated from
  `roster-data.js` (B4) so a tampered client payload can't self-promote.

---

## Remaining work

### Track C — password release (C2 → C4 → C3 → C5)
- **Goal & detail:** the 5-stage plan in ROADMAP → "Password security improvements".
- **Agreed interim shape (Jul 2026) — `PASSWORD_PLAN.md` ("C-lite"):** chosen passwords + the admin
  reset as the recovery channel, deferring C2 (email) until a relay exists. It honours this track's
  ordering (reset path ships before/with the change flow) and carries the two deep-review-critical
  design rules: the surname fallback is **gated** on the typed value normalising to the surname, and
  a definitive credential rejection resolves to `'none'` (never anonymous) **regardless of
  `ENFORCE_NAMED_SESSION`** — see that doc before building anything password-related.
- **SHIPPED — PASSWORD_PLAN.md Phase 2 (v18.92):** `password-force.js` compels any member still on the
  surname default to set their own password at their NEXT SIGN-IN, on all five authenticated pages,
  behind the `CONFIG.FORCE_PASSWORD_SET` kill switch. No forced sign-out — sessions cap at 30 days
  absolute / 7 days idle and an expired session forces a real typed login, so coverage completes itself
  inside 30 days and staggers naturally. Shows only for a `named` identity, and fails open on any
  failure it cannot recover from: a mandatory overlay that cannot be satisfied is a lockout, not a
  control. Pure roster-viewers who never sign in anywhere are NOT reached — that needs Track E. This
  makes the C5 ≥90% gate reachable for the first time.
- **SHIPPED — PASSWORD_PLAN.md Phase 0 + Phase 1 (v18.63):** the capability is live. Sign-in accepts a
  typed password with the gated surname fallback (`credentialCandidatesFor` / `ensureFirebaseSession`);
  staff set their own password in **Settings → Password**; the admin resets anyone to their surname
  default via **Operations → Account status → Reset** (the admin-only `resetMemberPassword` Cloud
  Function, refresh-token revoke); migration is tracked in the `passwordStatus` collection
  (`passwordSetAt`/`resetAt`) and surfaced as the Operations Account-status table + a Settings status
  chip/nudge. Still to come: **Phase 2** (a forced set-your-password overlay to drive migration) and
  **Phase 3 / C5** (retire the surname default — gated on ≥90% migrated, irreversible). Email
  self-service reset (C2) remains deferred until a mail relay exists.
- **Ordering within C:** verification (C2) → reset path (C4) → self-service change (C3, needs B0) →
  retire surname (C5, irreversible, ≥90% migrated). *(Historic ordering — C3/C4′ shipped first as the
  "C-lite" reshuffle; C2 is deferred behind a mail relay.)*

- **RE-PRIORITISED (v18.88) — migrate the 7 PRIVILEGED accounts first, as their own milestone.**
  The plan's only migration gate is "≥90% of everyone", which conflates two different goals: *closing
  risk* and *retiring the surname mechanism*. They are not the same size of job, because **risk is
  concentrated in 7 of the 50 active accounts** (counted from `functions/roster-members.json`, the
  server-owned list — managers carry `hidden: true`, which is why a headcount off the visible
  dropdown reads lower):

  | Tier | Accounts | What a guessed password gets an attacker |
  |------|----------|------------------------------------------|
  | Master admin | 1 | Everything — any member's overrides, uploads, roster import, auth setup |
  | Management | 6 | Any member's AL / absence / shifts, on behalf |
  | Staff | 43 | **Only their own** overrides (the B3 isolation rule holds) |

  **SUPERSEDED as the ROLLOUT plan (v18.92).** The owner chose to compel EVERYONE at their next sign-in
  rather than run privileged-first waves — the 30-day/7-day session model staggers it by each member's
  own expiry anyway, so a tiered flag would have added releases without lowering the peak. The tier
  table above still stands as the RISK analysis (it is why the 7 mattered most, and why chasing them by
  conversation was worth doing first); it is no longer the sequencing.

  So migrating the admin + 6 managers closes the large majority of the exposure, and it needs **no
  code at all** — 7 people opening Settings → Password. The ≥90% gate is about being able to delete
  the surname fallback, which is a tidiness/one-way-door goal, not the risk-closing one.

  **Owner-reported (25 Jul 2026, not independently verified here): 2 accounts migrated in the first
  24 hours, one of them the owner's.** That means the single highest-value target — the master admin —
  **is already off the guessable surname default**, which is the biggest single risk reduction
  available in this whole track and it has already happened. It also means voluntary migration among
  everyone else is running at roughly one account per day, so **the ≥90% (≈38 accounts) gate is
  unreachable without compulsion** — which is exactly why Phase 2 shipped at v18.92.

  **Recommended next step:** chase the 6 managers directly (a conversation, not a release), and record
  "all admin + manager accounts migrated" as an explicit milestone here. Only then decide whether the
  Phase 2 forced overlay is worth building for the ~35 staff accounts, whose blast radius is one
  person's own roster.
- **Risk:** locking staff out of the *core roster* is a bigger operational risk than the present
  surname-password weakness. C5 is one-way.
- **Mitigation:** admin break-glass always available; all secret-setting server-side only (never
  trust the client to set `password`).
- **C5 gate — corrected (v18.88).** This previously read "gated on `staffContact.verified` count vs
  active `teamMembers`". **`staffContact.verified` does not exist and never did** — `firestore.rules`
  still calls it "a FUTURE server-only `verified`". The mechanism that actually shipped (v18.63) is
  the **`passwordStatus`** collection: migrated ⇔ `passwordSetAt` present AND `>= resetAt`
  (`isPasswordMigrated` in `auth-identity.js`, the single tested source), surfaced as the Operations
  **Account status** table. Read the gate off THAT, not a field that was never built.
- **Rollback:** C2–C4 are additive (revertible); C5 is **not** — do not ship until the metric gate is met.

### Track D — App Check (monitor → enforce; AFTER Track B stable)
- **Goal:** only requests from our own pages can reach Firestore/Storage/browser-called Functions.
- **Risk:** identical failure mode to the API-key referrer restriction — miss a served domain
  (`web.app`, `firebaseapp.com`, `garethdavidmiller.github.io`) or hit a provider hiccup and writes fail
  silently with no in-app error. The allowlist must be maintained forever.
- **Mitigation:** **monitor-first** — ship log-only (D1), watch metrics for legitimate-but-unattested
  traffic, register every domain + CI/dev debug tokens, then **enforce one product at a time**
  (Firestore → Storage → Functions) (D2). **Never enforce during a rules cutover.**
- **Note:** App Check gates *which clients* connect, not *what an authenticated client may read* — it
  does **not** address the world-readable `overrides` exposure (a deliberate design trade-off,
  KNOWN_LIMITATIONS). Per-member write isolation (Track B) was the higher-value work; App Check is
  defence-in-depth, correctly sequenced last.
- **D-adjacent hardening — analytics doc size (deferred, App Check is the real fix).** The
  `analytics/activeAccounts` and `analytics/perf_<YYYY-MM>` rules validate that `daily`/`months`/
  `samples` are *maps* but do **not** bound the map-key **count**. So any authenticated session —
  including the anonymous calendar session every visitor gets — could pad one of those single documents
  toward Firestore's 1 MB limit; once near the cap, every legitimate `increment()` merge fails and only
  an admin can shrink it back — a self-inflicted **availability** DoS on analytics recording (not a data
  or money risk; non-sensitive aggregate counts). **Why deferred:** it needs an authed session and only
  degrades analytics; the rules-only fix (`request.resource.data.daily.keys().size() < N`) must ride a
  `deploy-rules.yml`-gated rules release with an emulator `assertFails`; and App Check (D2) removes the
  un-attested write path entirely. **If tightened before App Check:** add a key-count cap to the
  `activeAccounts` + `perf_` create/update conditions and a matching `assertFails`. (v17.43 audit.)

### Track E — full-app authentication (put the calendar behind login) — IDEA CAPTURED, NOT DECIDED

> **Status: undecided — may or may not ever be built.** Recorded as a *considered option*, not a
> committed plan. The most likely trigger is **external**: if the app becomes (or is being assessed as)
> official Chiltern infrastructure, **Chiltern IT may require** the sensitive roster data to sit behind
> authentication rather than a public URL. Until such a requirement lands (or the owner independently
> decides), the deliberate public-calendar design stands and Track E is dormant.

Today five of six pages sit behind a named login; the **calendar (`index.html`) is deliberately
public** — it runs an *anonymous* Firebase session and reads `overrides`/`huddles`/`circulars`/
`newsletters` with open (`allow read;`) rules. "Put the whole app behind login" means making the
calendar require a session too, closing the external review's **"public absence/AL data"** finding.

**Two different bars, wildly different costs:**

| | Rule shape | Who it lets in | What it blocks | UX cost |
|---|-----------|----------------|----------------|---------|
| **Level 1** — auth-required read | `allow read: if request.auth != null;` | any session **incl. the calendar's existing anonymous one** | a raw REST/`curl` scrape with **no** Firebase session; casual URL sharing | **Small, not zero** — see E1 below. No front-door change. |
| **Level 2** — named-only read | `allow read: if request.auth.token.name != null;` | only a **named** staff session | anonymous sessions too — anyone not signed in as staff | **Real** — the calendar must show a login before it renders. The true "behind login". |

**Be honest about what each buys.** The project config is in the client JS, so a *determined* scraper
can replicate the anonymous sign-in — Level 1 raises the bar from "trivially public" to "must initiate a
Firebase anonymous session against our project", not to "must be staff". Level 2 is the real gate. The
exposure being closed is **outsider-with-URL**, not colleague-to-colleague (the member selector already
lets any staff member view any colleague's roster/AL by design — Track E does not change that).

**The rules tightening is the actual control** (a client gate over open rules is theatre, bypassable via
REST). Staged:

- **E0 (free, no decision needed) — ✓ SHIPPED v19.00.** Search engines excluded: `X-Robots-Tag:
  noindex, nofollow` on Firebase Hosting + a mirrored `<meta name="robots">` in all ten served pages
  (the GitHub Pages mirror gets no headers, and a `robots.txt` cannot reach it — only honoured at an
  origin root). `robots.txt` deliberately **permits** crawling: a crawler blocked from fetching can
  never read the noindex, so `Disallow: /` would hide the signal, not the page. Guarded by
  `sw-asset-check.test.mjs`. Closes the *casual* half of the exposure, independent of everything below.
- **E1 (prep, behaviour-preserving): make the calendar's reads await auth.** Do this as its OWN
  release, before any rules change. `calendarAuthReady` currently gates only WRITES — the earlier
  "≈ zero cost, already satisfied" claim here was **wrong**, and KNOWN_LIMITATIONS ("read strictly
  after its session resolves") was right. Four paths read with whatever auth exists:
  `calendar-initial-fetch.js`, `calendar-huddle-viewer.js`, `calendar-doc-viewer.js`, and
  `nav-panel.js`'s Circular/Newsletter open. Ships green under today's open rules, so it soaks alone.
- **E2 (was E1): tighten reads to Level 1** (`request.auth != null`, anonymous OK) on `overrides` +
  the three document collections — only after E1 has soaked. ~6 of the 199 rules tests flip. Verify the
  notification-tap fresh-visit path from a **fresh private window** with a cold cache. Keep the
  Anonymous auth provider **enabled**.
- **E2 (soft): require named on the calendar behind the existing kill-switch.** Flip
  `PAGE_POLICIES.calendar` to require named, wire the shared `login-overlay.js`, gate on
  `ENFORCE_NAMED_SESSION` in a **soft** posture first — measure how many launches hit the wall.
- **E3 (hard): tighten reads to Level 2** (`token.name != null`) + make the calendar login mandatory.
  Only after E2 soaks. At this point `signInAnonymously` is dead and the **Anonymous provider can be
  disabled project-wide** — which settles the "retire the anonymous fallback" residual below (decide
  them together).

- **E6 (independent of all the above): put the document FILES behind auth.** E1–E5 tighten Firestore
  *reads*; the Huddle/Circular/Newsletter files themselves ride permanent tokenised bearer URLs that
  bypass `storage.rules` entirely, so **no rules change in this track touches them** (see
  KNOWN_LIMITATIONS → "The document FILES are protected by a bearer URL, not by auth"). Needs a
  delivery-model change — authenticated `getBlob`, or short-lived signed URLs minted per request —
  plus **rotating the existing tokens** (old URLs stay live until the objects are rewritten). Can start
  any time; does not depend on the calendar decision. Note the asymmetry when prioritising: the track's
  headline change protects the personal data, and only E6 protects the company-confidential documents.

**Why it's not much code but is a big decision.** Mechanically a pattern-copy + a rules change + a policy
flag (~a day). But the calendar is the app's **front door**, and four real consequences hang off its
being open:

1. **Offline lockout (sharpest).** The app is offline-first and the calendar is the PWA `start_url`,
   launched from cache. A staff member whose 30-day session lapsed **and who is offline** cannot log in
   (login needs network) → locked out of their **own cached roster**. Today a cached roster always
   renders. A genuine regression to weigh.
2. **Notification deep-links.** A push tap opens `#huddle`; on a lapsed session it now lands on a login
   screen. The deep link (and first-fresh-visit auto-open) must survive the login flow.
3. **First-run onboarding.** Today a new starter opens the calendar, picks their name, sees the roster —
   no account interaction. Behind login, first contact becomes "sign in".
4. **The document viewers** rely on open reads *because* the calendar had no session — E3 couples them to
   the login working on every path.

**Rollout discipline:** migrate, don't cut over — E1 → E2-soft → E3-hard, never a single flip. Reuse
`ENFORCE_NAMED_SESSION` + the staged posture the B-track proved. Verify only from a **fresh private
window**. **Track E consciously REVERSES an anti-goal** (the calendar's deliberate anonymous read
surface) — starting E means re-stamping that anti-goal, not violating it silently.

**Owner questions — answer BEFORE writing any E code:**

1. **What bar are we defending?** Casual (indexing / shared URL) → **E1** may be *enough*. A motivated
   outsider willing to script an anonymous sign-in → you need **E3** (named) and must accept the
   front-door cost. *This single answer decides whether Track E is a one-hour rules tweak or a multi-week
   front-door change.*
2. **Is a login wall on the home screen acceptable?** (The calendar is opened many times a day.)
3. **Is the offline-lockout regression acceptable?** If not: a grace mode (render the cached roster
   read-only, require login only to *sync fresh* data) and/or longer sessions.
4. **Member selector vs identity.** Default to showing your own roster, or stay a free selector with
   login as a pure gate? (UX, not security.)
5. **Analytics identity guarantee.** Keep the calendar identity-free, or make it an active-account
   surface (still client-deduped, no server identity)?
6. **Anonymous provider fate.** At E3 `signInAnonymously` becomes dead code and the provider could be
   **disabled project-wide** (real hardening) — retire anonymous entirely, or keep it as a Level-1 tier?

---

## Owner decisions needed (collect before starting the dependent phase)

| Decision | Blocks | Notes |
|----------|--------|-------|
| ~~Confirmed Chiltern **work-email domain**~~ | ~~staffContact validation~~; C2/C4 email recovery | **✓ RESOLVED (v14.97): `chilternrailways.co.uk`** — `CONFIG.WORK_EMAIL_DOMAIN` (single source) + `isChilternWorkEmail()`, enforced client-side AND in `firestore.rules`. Confirm it's right before C2/C4 email *recovery* relies on it. |
| Email relay choice — Power Automate vs Firebase Trigger Email | C2, C4 | Power Automate relay already exists (Huddle ingest). |
| Code expiry / retry-rate-limit policy | C2, C4 | 10-minute expiry + 3-attempt lockout is the documented default. |
| reCAPTCHA Enterprise provider | D1/D2 | Required before App Check can attest. |
| Is the app **official Chiltern infrastructure**? | App Check priority; header-capable hosting; Track E | If yes, App Check and Firebase-Hosting-only (drop github.io) rise in priority, and Track E may become a requirement. |
| **Full-app auth — do it at all, and which bar?** | Track E (undecided) | See Track E header + Q1. The "which bar" answer may itself be dictated by IT. |
| **Full-app auth — front-door + offline-lockout acceptable?** | Track E (E2/E3) | Login wall on the PWA `start_url`; lapsed-session **offline** user loses their own cached roster. Q2–Q3. |
| ~~re-auth window / `linkDesigns` claim / `pushSubscriptions` owner / WIF pool~~ | ~~B2/B3/A2~~ | **All ✓ DONE** — B3 strict cutover (v16.29), H2 `linksDesigner` claim (v16.29), A5 `pushSubscriptions` owner delete (v17.76), A2 WIF pool (v14.93). |

---

## What NOT to do (anti-goals)

- **Do not** ship a claim-requiring rule as a hard cutover. Use the permissive→strict migration.
- **Do not** enforce App Check and roll out a rules cutover in the same window.
- **Do not** bundle the Track-A infra work (WIF/A2, the functions `uuid` fix/A1) into an authz release —
  different failure domains.
- **Do not** retire the surname password (C5) before the ≥90% migration metric.
- **Do not** remove the calendar's anonymous read/bootstrap when hardening `ensureFirebaseSession` — that
  path is a deliberate public-read surface. **(Holds until Track E is chosen — Track E E3 is exactly the
  decision to retire it; reverse this anti-goal there, not silently.)**
- **Do not** drop the `|| token.admin == true` bypass from the isolation rule — admin writes for other
  members are load-bearing (roster import + on-behalf booking).
- **Do not** drop (or forget to add) the `|| token.manager == true` bypass — the 6 managers write staff
  AL/absence/shifts on behalf every day; without it the isolation rule silently locks them out. Equally,
  **do not grant managers `admin: true`** as a shortcut — that reaches the master-admin-only collections
  the tier exists to deny.
- **Do not** isolate `linkDesigns` by `token.name == memberName` — designs are keyed by design name, and
  a designer (S. Silva) may be ordinary staff with no admin/manager claim.
- **Do not** verify any of this from an installed phone — always a fresh private window.

---

## Shipped phases — the durable invariants (code cites these sections)

The full cutover runbooks and rule diffs are gone (git history + the live `firestore.rules` /
`firestore.rules.test.mjs`). What remains here is only what code comments reference or what constrains
future work.

### B0 — the identity signal
`ensureFirebaseSession` exposes whether it established the member's **named** account or only the
**anonymous** fallback: `getFirebaseIdentity()` → `'named'|'anonymous'|'none'`, `firebaseSessionIsNamed()`
(the exact signal B1/B2 consume), `getFirebaseAuthError()`. No runtime behaviour change; the fallback
still happens. The calendar bootstrap reads via `calendarAuthReady`, not `ensureFirebaseSession`, so its
legitimate anonymous public reads are unaffected. (`session.test.mjs`.)

### B1 — named-session separation + the kill-switch (Appendix: B1 detailed scope)
B1 turns the B0 signal into *enforcement*: write pages stop accepting a claim-less session, anonymous
auth is confined to the public calendar, and the client stops self-creating Firebase accounts. It ships
**while the rules are still `request.auth != null`**, so **B1 cannot lock anyone out via rules** — its
only lockout surface is client-side and reversible with the one-line kill-switch.

**Per-page enforcement matrix — strength matches what the page WRITES** (load-bearing — the coordinators
+ `auth-policy.js` consume exactly this):

| Page | Writes isolated/admin data? | Enforcement |
|------|------------------------------|-------------|
| admin | Yes — `overrides` for all members; admin ops | **Hard** — in-place login overlay, block the app |
| operations | Yes — admin-only huddle/circular/newsletter/roster/auth writes | **Hard** — in-place login overlay; a signed-in NON-admin is still redirected to `admin.html` (access control, not a login divert) |
| settings | Yes — `staffContact` (needs the `name` claim) | **Hard** — in-place login overlay, block writes |
| links | Yes — `linkDesigns` | **Hard** — in-place login overlay |
| paycalc | **No** — only `clientErrors`/`analytics` (non-isolated) | **Soft** — log only; the calculator is localStorage-based and must keep working |

All five pages show the **shared in-place login overlay** (`login-overlay.js`, `CONFIG.INPLACE_LOGIN`)
rather than redirecting; on success the coordinator re-inits in place. The Hard/Soft *strength* is
unchanged from the matrix.

**Provisioning prerequisite:** every active member (incl. managers) must have a server account via
Operations → "Set up accounts" **before** B1 enables — the client no longer self-heals. Admin break-glass
(reset to surname default) stays as recovery until self-service recovery (C4) lands; `/new-starter`
marks "Set up accounts" mandatory before a new starter's first login.

**Re-auth UX** when a returning user has a valid *local* session but the *named Firebase* session can't
be established (branch on `getFirebaseAuthError()`): **Transient** (`network-request-failed`/timeout) →
auto-retry once or twice, then "Couldn't reach sign-in" + Retry; do **not** clear the local session
(paycalc stays offline-usable). **Persistent** (`invalid-credential`/`user-not-found`) → "ask your
manager to reset your access" (break-glass).

**Kill-switch (the single most important mitigation):** all B1 enforcement is gated behind
`CONFIG.ENFORCE_NAMED_SESSION` (`roster-data.js`). Revert = flip to false, one-line deploy, no rules
involved. Verify on the live URLs in a private window across every role **and** a deliberately-
unprovisioned account — never an installed phone.

### B3 — the live write-side invariant ("Live invariant — writeWithClaimRetry")
**`writeWithClaimRetry` (built v15.18, `firebase-client.js`):** retries **exactly once**, **only** on
`permission-denied` with a live `auth.currentUser`, after a forced `getIdToken(true)`; any other error
class or a second denial is re-thrown. Wired into all three `admin-overrides.js` write paths via
re-runnable thunks (a `WriteBatch` can't be re-committed; the cache reflects only the successful attempt).
It self-heals a straggler token, which is why the strict cutover needed no mass sign-out. Independent of —
not a replacement for — the `CLAIM_EPOCH` sweep.

**Deploy-order invariant (keep for any future claim-gated rule):** function first → re-provision ("Set up
accounts") → **then** the strict rule. `writeWithClaimRetry` can only self-heal a claim that already
exists server-side. Repo rules being right is necessary but not sufficient — the live project (deployed
function + provisioned claims + refreshed tokens) must be right too. Always verify in a private window,
never an installed phone.

**`CLAIM_EPOCH` (roster-data.js) is armed to 2** (via `refreshClaimsIfStale()` in `session.js`, gated by
`localStorage('myb_claim_epoch')`) — every device swept its token once on next open. **Do NOT bump again
unless deliberately forcing a fresh sweep.**

**Rollback (still instant):** re-add the `!('name' in request.auth.token)` escape to the `overrides`
create/update + delete blocks and redeploy the permissive rule, or revert `overrides` to
`request.auth != null`. No data migration either way.

### Deferred residual — retire the anonymous fallback + kill-switch (NOT YET; held on purpose)

With `ENFORCE_NAMED_SESSION` ON, two branches in `session.js` `ensureFirebaseSession` are **unreachable
dead code**: the `signInAnonymously` fallback and the `createUserWithEmailAndPassword` self-heal (both
below the `if (CONFIG.ENFORCE_NAMED_SESSION) return commit('none', false)` guard). "Finishing" means
deleting that dead code and the flag, making named-only **permanent** — a pure refactor with no
staff-visible change. **Deliberately deferred:**

- **Why held:** the flag is *the* one-line rollback for the entire B1/B2/B3 release. While it soaks, that
  instant escape hatch beats the tidiness of removing ~2 dead branches. (Owner, Jul 2026: keep the switch,
  revisit in a few weeks.)
- **Go/no-go before removing:** ☐ several weeks of clean production on `ENFORCE_NAMED_SESSION = true` +
  B3 strict, no auth-lockout reports, no need to have flipped the switch · ☐ self-service recovery (C4)
  shipped, or admin break-glass confirmed sufficient · ☐ confirmed no wish to ever re-enable the
  anonymous write fallback.
- **Removal scope (~10 files, one version bump):** delete the two dead branches + the flag in
  `session.js`; drop `ENFORCE_NAMED_SESSION` from `CONFIG`; drop the flag guard from the 5 write
  coordinators + `login-overlay.js`'s `enforce` param; collapse the flag-on/off matrix in
  `session.test.mjs` to a single always-enforced path; simplify `e2e/fixtures.js` `enforceNamedSession`;
  re-stamp this appendix, LOGIN_INCIDENT.md, KNOWN_LIMITATIONS.md, and the ROADMAP bullets from "gated
  behind a kill-switch" to "permanent".

---

## Appendix: A2 — Workload Identity Federation ✓ COMPLETE (v14.93)

**What it did:** retired the long-lived `FIREBASE_SERVICE_ACCOUNT` JSON key for **short-lived GitHub OIDC
tokens** on all 3 deploy workflows (`google-github-actions/auth`, pinned `v2.1.13`; provider + SA written
directly in each YAML — they aren't secrets; job `permissions: { contents: read, id-token: write }`). No
standing full-project deploy credential remains in GitHub — the SA JSON key AND the GitHub secret are
both deleted, and a deploy from `main` was confidence-checked with the key gone. De-risked by migrating
one workflow (rules) first, keeping the secret as fallback until all three were proven, then deleting the
key last.

**As-built config:** pool `github-pool`, provider `github-provider`, project number `532910998075`, SA
`github-deploy@myb-roster.iam.gserviceaccount.com`.

**The one security invariant that still constrains any future change — do NOT lose it:** the provider
carries the attribute **condition `assertion.repository == 'Garethdavidmiller/roster-app'`**, and the
`roles/iam.workloadIdentityUser` impersonation binding is scoped to the same repo's `principalSet`.
**Without the repo condition, ANY GitHub repo could impersonate the SA** (full-project compromise) — any
change to the pool/provider/binding must preserve it. (Functions deploy also needs the gen2 role set on
the SA — Cloud Functions/Run/Build/Artifact Registry/Eventarc/Scheduler/Secret Manager/Service Account
User — unchanged by WIF, which swaps only the auth mechanism. WIF resource names use the numeric project
**number**, not the id.)
