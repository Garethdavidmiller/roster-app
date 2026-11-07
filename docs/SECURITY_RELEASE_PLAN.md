# SECURITY_RELEASE_PLAN.md — Phased plan for the security hardening work

*The master **ordering + go/no-go** doc for the security work. Detailed designs live in their own
documents and are NOT duplicated here. Not version-stamped; not a runtime asset. **Code comments cite
this file by section** (`B0`, `B1`, "B1 kill-switch", `B3`, "Appendix A2") — keep those anchors when
editing.*

*Completed phases keep only their durable **decisions, invariants and ordering lessons**; their
cutover runbooks and risk registers are in git history, and `firestore.rules` +
`firestore.rules.test.mjs` are the source of truth for the rule text.*

---

## ⭐ CANONICAL TRACK STATUS — this table is the single source of truth

**Every other document owns DESIGN; this table owns STATUS.** The current stage of a track used to
have to be reconciled across five files, and `auth-plan-parity.test.mjs` exists because two of them
had already drifted.

**If you are updating a status, update it HERE and nowhere else.** A detailed plan may say "see
SECURITY_RELEASE_PLAN.md for status"; it may not restate the stage.

| Track | Current stage | Next stage | Blocking decision | Exit condition |
|---|---|---|---|---|
| **A — infra** | ✅ Complete (A1 · A2 · A3) | — | — | WIF live, no standing deploy key; `npm audit --omit=dev` clean |
| **B — write isolation** | ✅ Complete (B0–B4, H2; strict since v16.29) | — | — | Strict `overrides` rules live, no lockout, self-heal proven |
| **Member-claim binding** | ✅ Complete — v24.23 believes a `name` only on a password sign-in at the name's derived email; v24.24 stamps the server-only `member` claim (Set up accounts); v24.27 requires it (`isMember()` in `firestore.rules`, `memberNameFromClaims` on the server) | — | — | Every member rule and endpoint reads identity through `isMember()` / `memberName()`; never roll rules back past v24.23 |
| **A5 — push subscriptions** | ✅ Complete (v17.76, extended v18.74) | — | — | Per-owner create/update/delete enforced |
| **A7 — deploy credential scope** | Code side done (v24.97): the backup check reads its account from the `BACKUP_CHECK_SERVICE_ACCOUNT` repository variable, and alerts only on a definite "no backups" | **Owner, in GCP:** limit the WIF provider to `refs/heads/main`, then give the backup check a read-only account — the commands are **Appendix A2 → "Tightening it"** | — | A token for `github-deploy@` cannot be minted from any ref but `main`, and the weekly backup check no longer runs as the deploy account |
| **C — passwords** | Forced migration live (Phase 0+1 v18.63, Phase 2 v18.92, reset queue v18.93–95) | **C5** — retire the surname default | Track E (below): un-migrated roster-viewers never sign in, so the metric cannot converge. **⚠️ A SECOND ROUTE is on the table and NOT adopted** — C6 (below) would let the remaining surname credentials be replaced server-side with unknown random ones, which answers the CREDENTIAL question without touching the READ question. The two routes and what the second costs: `CREDENTIAL_LIFECYCLE.md` §7. Until the owner decides, this row stands as written | ≥90% migrated **and** a proven recovery route for the remainder |
| **C2 — email verification/reset** | Deferred | — | Needs an email relay that does not exist | Relay available and owner wants it. **A saved address is not a credential** — possession must be proven and recorded (`verifiedAt`) before it can recover an account; design in `CREDENTIAL_LIFECYCLE.md` §8 |
| **C6 — one-time recovery/activation codes** | Proposed, not started | Owner decision | — | Design in `CREDENTIAL_LIFECYCLE.md` §1. Supersedes C4′ as the recovery path: today's reset makes the SURNAME valid again, so the migration's own repair mechanism undoes the migration. C4′ stays live until C6 does — break-glass may not have a gap |
| **F — step-up for sensitive admin actions** | Proposed, not started | — | — | Design in `CREDENTIAL_LIFECYCLE.md` §3. **No prerequisites** — the only item in that programme with none. Server-enforced from the token's `auth_time`, never a client timer |
| **D — App Check** | Deferred, not started | **D1** — monitor mode | Owner decision | Legitimate traffic characterised over a real window before any enforcement |
| **E — full-app auth** | E0 ✓ v19.00 · E1 ✓ v19.01 · **the READ closure is IN FORCE since 26 Aug 2026** — the Calendar asks for a named session or the staff PIN, and the server refuses anything without a verified member (`isMember()`), `admin`, or `calendarViewer`. RECOVERY_RUNBOOK → "The Calendar PIN" step 4 records the go/no-go | **E3** — INDIVIDUAL authentication, if it is ever required. E2 was superseded, not built: it would have required merely *any* session, which an anonymous sign-in satisfies | Owner decision, most likely forced externally by a Chiltern IT requirement that each person authenticates | Owner approval + rollback rehearsed + **E3 criteria pre-registered before telemetry starts** |
| **E6 — document files** | Short-lived signed links live (`getDocumentUrl`: server v24.16–18, client v24.19); the stored permanent link kept as the fallback (owner, 7 Oct 2026) | — | Owner — revisit on DECISIONS.md's trigger (a leaked link, or `getDocumentUrl` failures making the fallback usual) | ARCHITECTURE.md EXC-007 closes: the links already in circulation no longer open |
| **Deferred residual** | ✅ **Complete (v24.34, owner-approved).** Both switches retired with every branch that ran only when one was false: `calendar-access.js` no longer calls `signInAnonymously`, and `session.js` no longer self-heals an account or falls back to anonymous. Neither was a working rollback any more — the rules refused every session they restored | — | — | — |

**Three things this table is deliberately explicit about**, because each was previously implied and
misread: **E1 is client preparation, not protection** — the boundary moves at the READ RULE, which
E2 was meant to move and the **staff PIN moved instead (v20.12)**; **C5 is gated on a decision in a
different track**, so it is further away than "≥90% migrated" suggests; and **that gate conflates
two questions**, which C6 would separate — *may a guessable password sign somebody in?* is not the
same as *may the roster be read without individual identity?*. The first is answerable today. The
second is Track E and stays where it is.

**If you change a status, change the table, then search this file for prose that restates it.** This
file's own Track E prose has disagreed with the table twice, once in each direction — a fact written in
two places gets updated in one, and which one is arbitrary.

---

## Current state

**Shipped** — the live `firestore.rules` + `firestore.rules.test.mjs` are the source of truth for the
rule text and gate cases:

- **Track A (infra, standalone):** A1 — the Cloud Functions' production dependencies audit clean
  (`npm audit --omit=dev`). The Functions deploy refuses to ship on a high or critical advisory, and the
  weekly `functions-audit.yml` fails on the same (`scripts/audit-functions-deps.sh`), so **low and
  moderate drift does NOT fail CI** — it is caught only by looking. Re-check when reading this doc.
  firebase-admin is on `^14` (the exact range is `functions/package.json`); the namespaced `admin.*`
  API v14 removed was migrated to the modular entry points before the move, so the version change
  itself changed no code — KNOWN_LIMITATIONS.md carries what to expect at the next major. · A2 —
  Workload Identity Federation, keyless OIDC on all three deploy workflows; the SA JSON key and the
  `FIREBASE_SERVICE_ACCOUNT` secret both deleted (**Appendix A2**). · A3 — doc-only accuracy.
- **Track B (authorization release):** B0 — named-vs-anonymous identity signal. · B1 — named-session
  enforcement on the write pages, unconditional since its kill-switch was retired (v24.34;
  LOGIN_INCIDENT.md has the freeze it was once rolled back for). · B2 — per-member `overrides`
  isolation, permissive 3-tier `name || admin || manager`, plus the `manager` claim in
  `setupRosterAuth`. · **B3 — strict cutover (v16.29):** the `!('name' in token)` legacy escape removed
  from `overrides` create/update AND delete; shipped via the `CLAIM_EPOCH` sweep + `writeWithClaimRetry`
  self-heal, so **no lockout / no mass sign-out**. · B4 — server-owned role lists (`activeMembers` +
  admin/manager/designer) read from `functions/roster-members.json`, dry-run orphan removal. · H2 —
  `linkDesigns` writes gated on `linksDesigner`/`admin` and shape-validated.
- **Later hardenings:** A5 — `pushSubscriptions` per-owner: `savePushSubscription` stamps
  `owner = auth.currentUser.uid`; delete requires `resource.data.owner == request.auth.uid` OR no
  `owner` (legacy docs stay deletable so VAPID-rotation cleanup isn't locked out; orphans swept by
  `fanOutPush`'s 410/404 cleanup); create/update also require `owner == request.auth.uid` when the
  field is present, AND on update re-check the EXISTING doc's owner — so a session can't take over
  another device's subscription by re-stamping its own uid. A6 — a CSP `*.googleapis.com` narrowing
  was **tried and reverted** (the SDK reaches more `*.googleapis.com` hosts on a real network than the
  four listed; the wildcard stays — KNOWN_LIMITATIONS).

**Open** — *stages are in the canonical table above; these bullets carry only what the table cannot:*

- **Track C — password release.** The shipped shape is the "C-lite" plan in `PASSWORD_DESIGN.md`
  (gated dual-attempt sign-in, Settings Password card, `resetMemberPassword` break-glass,
  `passwordStatus` migration flags, forced overlay, reset-request queue). What remains is **C2**
  (email verification — deferred until an email relay exists) and **C5** (retire the surname default
  — irreversible; the ≥90% metric is tracked via the `passwordStatus` collection and rendered on the
  Operations Account-status card).
- **Track D — App Check.** D1 monitor-first → D2 enforce, in the order Firestore → Storage →
  Functions, plus the analytics doc-size key-count cap. Monitor mode exists to learn what legitimate
  traffic looks like; enforcing before that is how you lock out your own staff.
- **Track E — full-app auth.** Design is `AUTH_PLAN.md`; the phase list below is the sequencing half
  and the two are kept in step by `auth-plan-parity.test.mjs`. The most likely external trigger is a
  Chiltern-IT requirement if the app becomes official infrastructure — see ROADMAP.md → the
  governance gate.

---

## Why a separate plan doc — the one idea that drives it

Almost every item shares a single failure mode: **a write silently fails because the session is not
the identity the rule (or App Check) expects.** This took the app down at v10.94, and it is invisible
from an installed phone (KNOWN_LIMITATIONS → "The installed PWA masks live-site breakage"). The value
of this doc is the **ordering and go/no-go gates**, not feature detail. Three durable consequences:

1. **No page may silently fall back to an anonymous session before a rule requires a named
   identity.** A claim-less session's writes "work" only while the rule is `request.auth != null`; the
   moment a rule needs a claim, that same fallback becomes a silent lockout. This was B0, the shared
   foundation — and it is now permanent: there is no anonymous fallback at all.
2. **Never run two silent-failure cutovers at once.** Per-member isolation rollout and App Check
   *enforce* both fail as "writes silently rejected" — if they overlap you can't tell which locked a
   user out. Separate them in time.
3. **Migrate, don't cut over.** Any rule that newly requires a token claim ships first in a *permissive*
   form that accepts both old and new sessions, then tightens after a forced re-auth sweep — converting
   the v10.94 hard-cutover lockout into a two-step migration with no lockout window.

**Hard ordering constraints (still govern the remaining C/D/E work — violating these re-introduces the
v10.94 class of outage):** **D2 (App Check enforce) must not overlap a rules cutover** — separate by a
stabilisation window. · C5 (retire surname) is irreversible, gated on ≥90% migration. · Keep Track-A
infra (WIF, the Functions dependencies) **out** of the authz release — different failure domains,
bundling only widens the blast radius.

---

## The identity tiers the rules must respect (READ BEFORE touching the isolation rules)

The app has **three** privilege tiers, defined in `roster-data.js`. Any isolation rule that only thinks
in "owner vs. admin" silently locks out the middle tier — the manager-lockout gap found while scoping
B2, which recurs whenever the rules change. State the tiers once, here:

| Tier | Source list | Firebase claim they must carry | What they legitimately write |
|------|-------------|-------------------------------|------------------------------|
| **Master admin** | `CONFIG.ADMIN_NAMES` | `{ admin: true, name, member }` | Everything — overrides for any member, huddle/circular/newsletter, roster upload, auth setup |
| **Management** | `CONFIG.MANAGER_NAMES` | **`{ manager: true, name, member }`** ← set by `setupRosterAuth`; a manager's token carries it only after Set up accounts and a token refresh | Overrides (AL/absence/shift) **on behalf of any staff member** — but NOT the master-admin uploads/auth-setup |
| **Staff** | everyone else | `{ name, member }` | Only their **own** overrides (`memberName() == memberName` — `memberName()` is the `name` of a verified member, `isMember()`, else null) |
| *Links designer* | `CONFIG.LINKS_DESIGNERS` | *cross-cuts the above* — a designer may be a CEA, not a manager. `setupRosterAuth` sets the `linksDesigner` claim from the server copy of that list, and `linkDesigns` writes are gated on it (H2) | `linkDesigns` (designs are **not** member-owned) — write control is the `linksDesigner`/`admin` claim |

Three design points that flow from this and still govern any future rule change:

- The **`manager: true` bypass is load-bearing** — the managers edit staff AL/absence/shifts on behalf
  every day; without it the isolation rule silently locks them out. Equally, the **`admin` bypass** is
  load-bearing (admin writes for others constantly: on-behalf AL/absence, every `source:'roster_import'`
  row). Master-admin-only collections (huddles/circulars/newsletters/roster/auth) stay `admin == true`
  only — **never grant managers `admin: true`**, which would dissolve the very tier separation
  `MANAGER_NAMES` exists to enforce.
- **`linkDesigns` is NOT member-isolated** — designs are keyed by design **name**, not member, and a
  designer may hold no admin/manager claim, so `token.name == memberName` is meaningless. Its write gate
  is the separate `linksDesigner`/`admin` claim (H2). Do not fold it into the override member-name
  model. Its **read** gate is a verified member (`isMember()`) or `admin` — one notch, not two:
  `request.auth != null` was reached by the calendar's anonymous session, so it admitted any visitor;
  requiring the `linksDesigner` claim instead would remove the load path a stale designer token needs
  before its first write can self-heal.
- **Server-owned lists carry all three tiers** (admin + manager + designer), generated from
  `roster-data.js` (B4) so a tampered client payload can't self-promote.

---

## Remaining work

### Track C — password release (C2 → C4 → C3 → C5)
- **Goal & detail:** the 5-stage plan in ROADMAP_HISTORY.md → "Password security — the original five-stage design".
- **The agreed interim shape — `PASSWORD_DESIGN.md` ("C-lite"):** chosen passwords + the admin reset as
  the recovery channel, deferring C2 (email) until a relay exists. It honours this track's ordering
  (reset path ships before/with the change flow) and carries the two deep-review-critical design
  rules: the surname fallback is **gated** on the typed value normalising to the surname, and a
  definitive credential rejection resolves to `'none'`, never anonymous — see that doc before building
  anything password-related.
- **SHIPPED — PASSWORD_DESIGN.md Phase 0 + Phase 1 (v18.63):** sign-in accepts a typed password with
  the gated surname fallback (`credentialCandidatesFor` / `ensureFirebaseSession`); staff set their own
  password in **Settings → Password**; the admin resets anyone to their surname default via
  **Operations → Account status → Reset** (the admin-only `resetMemberPassword` Cloud Function,
  refresh-token revoke); migration is tracked in the `passwordStatus` collection
  (`passwordSetAt`/`resetAt`) and surfaced as the Operations Account-status table + a Settings status
  chip/nudge.
- **SHIPPED — PASSWORD_DESIGN.md Phase 2 (v18.92):** `password-force.js` compels any member still on the
  surname default to set their own password at their NEXT SIGN-IN, in every page coordinator, behind
  the `CONFIG.FORCE_PASSWORD_SET` kill switch. No forced sign-out — sessions cap at 60 days absolute
  and an expired session forces a real typed login, so coverage completes itself inside 60 days and
  staggers naturally. Shows only for a `named` identity, and fails open on any failure it cannot
  recover from: a mandatory overlay that cannot be satisfied is a lockout, not a control. Pure
  roster-viewers who never sign in anywhere are NOT reached — that needs Track E (or C6's second
  route). This made the C5 ≥90% gate reachable for the first time.
- **Ordering within C:** verification (C2) → reset path (C4) → self-service change (C3, needs B0) →
  retire surname (C5, irreversible, ≥90% migrated). *(Historic ordering — C3/C4′ shipped first as the
  "C-lite" reshuffle; C2 is deferred behind a mail relay.)*
- **Risk is concentrated in the privileged accounts** — the reason the admin and the managers
  mattered most, and why chasing them by conversation was worth doing first. The rollout itself
  compels EVERYONE at their next sign-in (owner decision): the 60-day session staggers it by each
  member's own expiry anyway, so a tiered rollout would have added releases without lowering the peak.
  The tiers as a risk analysis (count them from `functions/roster-members.json`, the server-owned list
  — managers carry `hidden: true`, so a headcount off the visible dropdown reads lower):

  | Tier | Accounts | What a guessed password gets an attacker |
  |------|----------|------------------------------------------|
  | Master admin | `roles.admin` | Everything — any member's overrides, uploads, roster import, auth setup |
  | Management | `roles.manager` | Any member's AL / absence / shifts, on behalf |
  | Staff | the rest of `activeMembers` | **Only their own** overrides (the B3 isolation rule holds) |

  So migrating the admin and the managers closes the large majority of the exposure. The ≥90% gate is
  about being able to delete the surname fallback, which is a tidiness/one-way-door goal, not the
  risk-closing one.
- **Risk:** locking staff out of the *core roster* is a bigger operational risk than the present
  surname-password weakness. C5 is one-way.
- **Mitigation:** admin break-glass always available; all secret-setting server-side only (never
  trust the client to set `password`).
- **Read the C5 gate off `passwordStatus`**, never off a `staffContact.verified` field — that field
  does not exist (`firestore.rules` mentions it only as a FUTURE server-only field). Migrated ⇔
  `passwordSetAt` present AND `>= resetAt` (`isPasswordMigrated` in `auth-identity.js`, the single tested
  source), surfaced as the Operations **Account status** table.
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
  never addressed the `overrides` exposure, which closed by other means (reads need a member, the
  admin or the staff PIN). Per-member write isolation (Track B) was the higher-value work; App Check is
  defence-in-depth, correctly sequenced last.
- **This track is authoritative: App Check is deferred and sequenced, not closed.** KNOWN_LIMITATIONS
  → "Firebase App Check — declined as an immediate action, RETAINED as Track D" defers here; if this
  track is ever genuinely cancelled, close it THERE too rather than leaving two readings.
- **D-adjacent hardening — analytics doc size (deferred, App Check is the real fix).** The
  `analytics/activeAccounts` and `analytics/perf_<YYYY-MM>` rules validate that `daily`/`months`/
  `samples` are *maps* but do **not** bound the map-key **count**. So any signed-in member or
  staff-PIN session (`isKnownIdentity` — an anonymous token is refused here) could pad one of those
  single documents toward Firestore's 1 MB limit; once near the cap, every legitimate `increment()`
  merge fails and only an admin can shrink it back — a self-inflicted **availability** DoS on analytics
  recording (not a data or money risk; non-sensitive aggregate counts). **Why deferred:** it needs an
  authed session and only degrades analytics; the rules-only fix
  (`request.resource.data.daily.keys().size() < N`) must ride a `deploy-rules.yml`-gated rules release
  with an emulator `assertFails`; and App Check (D2) removes the un-attested write path entirely. **If
  tightened before App Check:** add a key-count cap to the `activeAccounts` + `perf_` create/update
  conditions and a matching `assertFails`.

### Track E — full-app authentication — E0+E1 SHIPPED · the read closure is **CLOSED (26 Aug 2026)** · individual auth UNDECIDED

> **📄 `AUTH_PLAN.md` is the authoritative DESIGN doc for this track** (what "behind authentication" can
> and cannot mean here, the per-phase build detail, the offline grace-mode answer, what to measure, the
> owner decisions). This section stays authoritative for **sequencing and risk**, consistent with how
> `PASSWORD_DESIGN.md` relates to Track C. Keep each to its half.

> **Status: the read closure is IN FORCE since 26 Aug 2026; INDIVIDUAL authentication is undecided.**
>
> `overrides` reads require a verified member (`isMember()`), `admin`, or the shared staff-PIN
> `calendarViewer` capability. The bare `allow read;` that once sat ABOVE that rule — and which,
> because Firestore ORs every matching allow rule, kept override data public — was deleted in its own
> push after the client had soaked; RECOVERY_RUNBOOK.md → "The Calendar PIN" step 4 records the
> go/no-go. **The external review's "public absence/AL data" finding is closed.** The `huddles` /
> `circulars` / `newsletters` reads closed too (owner decision, 7 Sep 2026: the documents are not
> visible without the PIN or a password). What stays open is the FILES half, the permanent bearer URLs
> (E6 below; `ARCHITECTURE.md` EXC-007).
>
> What is separately a *considered option, not a committed plan* is putting the whole app behind an
> INDIVIDUAL login — the PIN is one code for the whole station. The most likely trigger remains
> **external**: if the app becomes (or is being assessed as) official Chiltern infrastructure,
> **Chiltern IT may require** each person to authenticate rather than a station to share a code. Until
> such a requirement lands (or the owner independently decides), the staff-PIN design stands and
> E3/E4/E5 are dormant. `AUTH_PLAN.md` → E2 records how a server-validated shared credential answered
> the decision gate in a way the phase list did not contain, and what it deliberately leaves open.

**Two different bars, wildly different costs:**

| | Rule shape | Who it lets in | What it blocks | UX cost |
|---|-----------|----------------|----------------|---------|
| **Level 1** — auth-required read | `allow read: if request.auth != null;` | any session **incl. an anonymous one** | a raw REST/`curl` scrape with **no** Firebase session; casual URL sharing | **Small, not zero** — needed the E1 prep first. No front-door change. |
| **Level 2** — named-only read | `allow read: if isMember();` (already the live `overrides` read rule's member door — a bare `token.name != null` is weaker: any session can set its own display name) | only a **named** staff session | anonymous sessions too — anyone not signed in as staff | **Real** — the calendar must show a login before it renders. The true "behind login". |

**Be honest about what each buys.** The project config is in the client JS, so a *determined* scraper
can create an anonymous session — Level 1 raises the bar from "trivially public" to "must initiate a
Firebase anonymous session against our project", not to "must be staff". The PIN and Level 2 are the
real gates. The exposure being closed is **outsider-with-URL**, not colleague-to-colleague (the member
selector already lets any staff member view any colleague's roster/AL by design — Track E does not
change that).

**The rules tightening is the actual control** (a client gate over open rules is theatre, bypassable via
REST). Staged:

- **E0 (free, no decision needed) — ✓ SHIPPED v19.00.** Search engines excluded: `X-Robots-Tag:
  noindex, nofollow` on Firebase Hosting + a mirrored `<meta name="robots">` in every served page
  (the GitHub Pages mirror gets no headers, and a `robots.txt` cannot reach it — only honoured at an
  origin root). `robots.txt` deliberately **permits** crawling: a crawler blocked from fetching can
  never read the noindex, so `Disallow: /` would hide the signal, not the page. Guarded by
  `sw-asset-check.test.mjs`. Closes the *casual* half of the exposure, independent of everything below.
- **E1 (prep, behaviour-preserving): make the calendar's reads auth-aware — ✓ SHIPPED v19.01.**
  Shipped as its OWN release, before any rules change. Four paths had read with whatever auth existed —
  `calendar-initial-fetch.js`, `calendar-huddle-viewer.js`, `calendar-doc-viewer.js`, and
  `nav-panel.js`'s Circular/Newsletter open. The calendar's own load became **two-phase** (paint from
  the local cache with no network and no auth, then the authoritative server read once auth resolves),
  so requiring a session for reads can never put a sign-in round trip in front of data the device
  already holds. The three tap paths wait for auth **with a deadline** — see `AUTH_PLAN.md` → E1 for
  the rule that came out of it. **This is client preparation, NOT a security boundary** — it changes
  no rule (see question 1 below).
- **E2: tighten reads to Level 1** (`request.auth != null`, anonymous OK) — **SUPERSEDED at v20.12,
  and by something STRICTER. Do not build it.** Its whole content was "require *any* Firebase
  session", with the Anonymous provider left enabled — so the barrier was one `signInAnonymously()`
  call, which is no barrier to anyone willing to script it. The staff PIN replaced it: `overrides`
  reads require a verified member (`isMember()`) **or** the `calendarViewer` capability, and anonymous
  is denied outright. That clears the **E5** bar for the read without paying E3's front-door cost. Full
  argument: `AUTH_PLAN.md` → E2. The **three document collections**, the one piece left over from E2,
  were closed under E6 (the reads require access; the files' bearer URLs are E6's remaining half).
- **E3: require named on the calendar, SOFT posture.** Flip `PAGE_POLICIES.calendar` to require named,
  wire the shared `login-overlay.js`, start in a **soft** posture first (a Calendar-specific policy flag
  — the write pages' requirement is unconditional, so there is no shared switch to borrow) — measure
  how many launches hit the wall. Client UX only; the rules are unchanged at this phase.
- **E4: offline grace mode — ships WITH E3, not after.** Without it E3 is a genuine regression for a
  member whose session lapsed while offline. Design in `AUTH_PLAN.md` §4 (durable device marker,
  cache-only render, real login on reconnect). Do not schedule E3 without it.
- **E5: tighten reads to Level 2** (`isMember()`) + make the calendar login mandatory. Only after E3/E4
  soak, and only after the claim-tier analysis `AUTH_PLAN.md` flags as missing. Nothing in the app
  calls `signInAnonymously` any more, so **disabling the Anonymous provider project-wide** does not wait
  on E5: it is a Console step that can be taken now (`firestore.rules` still records the provider as
  enabled).
- **E6 — the READS closed (client v23.17, rules v23.18), and the FILES are handed out as 15-minute
  signed links** (`getDocumentUrl`: server v24.16–18, client v24.19), with the stored permanent link
  kept as the fallback when one cannot be fetched (owner, 7 Oct 2026 — DECISIONS.md). **What remains
  open is the tokens already in circulation** (ARCHITECTURE.md EXC-007): the files ride bearer URLs
  that bypass `storage.rules` entirely, so **no rules change in this track touches them**, and old
  URLs stay live until the objects are rewritten. Word documents open through Microsoft's Office Online
  viewer, which fetches them **server-side** — which is why authenticated download (the obvious route)
  was not taken. Note the asymmetry when prioritising: the track's headline change protected the
  personal data, and only E6 protects the company-confidential documents. Design and the options
  weighed: `AUTH_PLAN.md` §5.

**Why it's not much code but is a big decision.** Mechanically E3–E5 are a pattern-copy + a rules
change + a policy flag (~a day). But the calendar is the app's **front door**, and four real
consequences hang off requiring an individual sign-in there:

1. **Offline lockout (sharpest).** The app is offline-first and the calendar is the PWA `start_url`,
   launched from cache. A staff member whose 60-day session lapsed **and who is offline** cannot log in
   (login needs network) → locked out of their **own cached roster**. A genuine regression to weigh —
   E4 is the answer.
2. **Notification deep-links.** A push tap opens `#huddle`; on a lapsed session it would land on a
   login screen. The deep link must survive the login flow.
3. **First-run onboarding.** First contact becomes "sign in" for everyone, including the shared
   station PC, which today uses the PIN.
4. **The document viewers** couple to the login working on every path.

**Rollout discipline:** migrate, don't cut over — **E0 → E1 → PIN (v20.12, in place of E2) → decision gate → E3 + E4 → E5**.
Never make the calendar's front door and named-only read rules a single flip. `auth-plan-parity.test.mjs`
pins this exact sequence in both documents and rejects superseded shorthand for the phases. Reuse the
staged posture the B-track proved. Verify only from a **fresh private window**. **Starting E3
consciously REVERSES a recorded decision** — `CREDENTIAL_LIFECYCLE.md` §4, keep both kinds of Calendar
access — so record the reversal rather than making it silently.

**Owner questions — answer BEFORE writing any E code:**

1. **What bar are we defending?** Casual (indexing / shared URL) → **E0 + the staff PIN** is the
   stopping point, and both have shipped. A motivated outsider willing to script an anonymous sign-in
   is already refused by the PIN rule; *individual* identity — each person authenticates — needs
   **E3/E4/E5** and the front-door cost that comes with them. *This single answer decides whether the
   rest of Track E is needed at all.*
   **Not E1.** E1 is behaviour-preserving CLIENT preparation — it changes no rule and does not stop a
   direct Firestore REST read, so it is not a security boundary and must never be cited as one.
2. **Is a login wall on the home screen acceptable?** (The calendar is opened many times a day.)
3. **Is the offline-lockout regression acceptable?** If not: a grace mode (render the cached roster
   read-only, require login only to *sync fresh* data) and/or longer sessions.
4. **Member selector vs identity.** Default to showing your own roster, or stay a free selector with
   login as a pure gate? (UX, not security.)
5. **Analytics identity guarantee.** Keep the calendar identity-free, or make it an active-account
   surface (still client-deduped, no server identity)?
6. **Anonymous provider fate — overtaken.** Nothing in the app signs in anonymously any more, so the
   provider can be **disabled project-wide** (real hardening) as a Console step, with nothing depending
   on it.

---

## Owner decisions needed (collect before starting the dependent phase)

| Decision | Blocks | Notes |
|----------|--------|-------|
| Confirm the Chiltern **work-email domain** before email recovery relies on it | C2/C4 email recovery | Set to `chilternrailways.co.uk` — `CONFIG.WORK_EMAIL_DOMAIN` (single source) + `isChilternWorkEmail()`, enforced client-side AND in `firestore.rules`. |
| Email relay choice — Power Automate vs Firebase Trigger Email | C2, C4 | Power Automate relay already exists (Huddle ingest). |
| Code expiry / retry-rate-limit policy | C2, C4 | 10-minute expiry + 3-attempt lockout is the documented default. |
| reCAPTCHA Enterprise provider | D1/D2 | Required before App Check can attest. |
| Is the app **official Chiltern infrastructure**? | App Check priority; header-capable hosting; Track E | If yes, App Check and Firebase-Hosting-only (drop github.io) rise in priority, and Track E may become a requirement. |
| **Full-app auth — do it at all, and which bar?** | Track E (undecided) | See Track E header + Q1. The "which bar" answer may itself be dictated by IT. |
| **Full-app auth — front-door + offline-lockout acceptable?** | Track E (E3) | Login wall on the PWA `start_url`; lapsed-session **offline** user loses their own cached roster. Q2–Q3. |

---

## What NOT to do (anti-goals)

- **Do not** ship a claim-requiring rule as a hard cutover. Use the permissive→strict migration.
- **Do not** enforce App Check and roll out a rules cutover in the same window.
- **Do not** bundle the Track-A infra work (WIF/A2, the Functions dependencies/A1) into an authz release —
  different failure domains.
- **Do not** retire the surname password (C5) before the ≥90% migration metric.
- ~~**Do not** remove the calendar's anonymous read/bootstrap when hardening `ensureFirebaseSession` — that
  path is a deliberate public-read surface.~~ **SPENT — the reversal happened, deliberately, at v20.12.**
  The unconditional bootstrap is gone and `calendar-app.js` forbids restoring it ("Do not re-add it
  'so telemetry keeps working'"), and the public-read surface it protected was closed on 26 Aug 2026.
  Kept struck through rather than deleted because this anti-goal was cited while it was live, and an
  anti-goal that quietly disappears reads as one nobody thought about.
- **Do not** drop the `|| token.admin == true` bypass from the isolation rule — admin writes for other
  members are load-bearing (roster import + on-behalf booking).
- **Do not** drop (or forget to add) the `|| token.manager == true` bypass — the managers write staff
  AL/absence/shifts on behalf every day; without it the isolation rule silently locks them out. Equally,
  **do not grant managers `admin: true`** as a shortcut — that reaches the master-admin-only collections
  the tier exists to deny.
- **Do not** isolate `linkDesigns` by `token.name == memberName` — designs are keyed by design name, and
  a designer may be ordinary staff with no admin/manager claim.
- **Do not** verify any of this from an installed phone — always a fresh private window.

---

## Shipped phases — the durable invariants (code cites these sections)

What remains here is only what code comments reference or what constrains future work.

### B0 — the identity signal
`ensureFirebaseSession` exposes whether it established the member's **named** account:
`getFirebaseIdentity()` → `'named'|'none'`, `firebaseSessionIsNamed()` (the exact signal B1/B2
consume), `getFirebaseAuthError()`. It had an `'anonymous'` third value while an anonymous fallback
existed; there is none now. (`session.test.mjs`.)

### B1 — named-session separation + the kill-switch (Appendix: B1 detailed scope)
B1 turned the B0 signal into *enforcement*: write pages stop accepting a claim-less session, and the
client stops self-creating Firebase accounts. It shipped **while the rules were still
`request.auth != null`**, so **B1 could not lock anyone out via rules** — its only lockout surface was
client-side and reversible.

**Per-page enforcement — strength matches what the page WRITES.** `PAGE_POLICIES` in `auth-policy.js` is
the live authority; this is the reasoning behind its hard/soft split:

| Page | Writes isolated/admin data? | Enforcement |
|------|------------------------------|-------------|
| admin | Yes — `overrides` for all members; admin ops | **Hard** — in-place login overlay, block the app |
| operations | Yes — admin-only huddle/circular/newsletter/roster/auth writes | **Hard** — in-place login overlay; a signed-in NON-admin is still redirected to `admin.html` (access control, not a login divert) |
| settings | Yes — `staffContact` (needs a verified member, `isMember()`) | **Hard** — in-place login overlay, block writes |
| links | Yes — `linkDesigns` | **Hard** — in-place login overlay |
| overtime | Yes — the member's own availability, through the Overtime endpoints | **Hard** — in-place login overlay. While paused the page shows a paused note to everyone, signed in or not (`OVERTIME_AVAILABILITY.md` → Paused) |
| trains, newlink | **No** — they read nothing from the server | **Hard** — in-place login overlay (Trains also admits the staff PIN, AUTH_AND_SESSIONS 24) |
| paycalc | **No** — only `clientErrors`/`analytics` (non-isolated) | **Soft** — log only; the calculator is localStorage-based and must keep working |

Every protected page shows the **shared in-place login overlay** (`login-overlay.js`) rather than
redirecting; on success the coordinator re-inits in place.

**Provisioning prerequisite:** every active member (incl. managers) must have a server account via
Operations → "Set up accounts" — the client never self-heals. Admin break-glass (reset to surname
default) stays as recovery until self-service recovery lands; `/new-starter` marks "Set up accounts"
mandatory before a new starter's first login.

**Re-auth UX** when a returning user has a valid *local* session but the *named Firebase* session can't
be established (branch on `getFirebaseAuthError()`): **Transient** (`network-request-failed`/timeout) →
auto-retry once or twice, then "Couldn't reach sign-in" + Retry; do **not** clear the local session
(paycalc stays offline-usable). **Persistent** (`invalid-credential`/`user-not-found`) → "ask the
admin" (break-glass — only the admin can reset a password; `login-overlay.js`).

**Kill-switch (RETIRED):** B1 enforcement was gated behind `CONFIG.ENFORCE_NAMED_SESSION`, and while
the rules were permissive "revert = flip to false, one-line deploy" was true. It stopped being true once
B3 and the `member` claim made the rules refuse the anonymous session it restored, so the switch was
retired: rollback is reverting the release. Verify on the live URLs in a private window across every
role **and** a deliberately-unprovisioned account — never an installed phone.

### B3 — the live write-side invariant ("Live invariant — writeWithClaimRetry")
**`writeWithClaimRetry` (`firebase-client.js`):** retries **exactly once**, **only** on
`permission-denied` with a live `auth.currentUser`, after a forced `getIdToken(true)`; any other error
class or a second denial is re-thrown. Wired into every `admin-overrides.js` write path via re-runnable
thunks (a `WriteBatch` can't be re-committed; the cache reflects only the successful attempt). It
self-heals a straggler token, which is why the strict cutover needed no mass sign-out. Independent of —
not a replacement for — the `CLAIM_EPOCH` sweep.

**Deploy-order invariant (keep for any future claim-gated rule):** function first → re-provision ("Set up
accounts") → **then** the strict rule. `writeWithClaimRetry` can only self-heal a claim that already
exists server-side. Repo rules being right is necessary but not sufficient — the live project (deployed
function + provisioned claims + refreshed tokens) must be right too. Always verify in a private window,
never an installed phone.

**`CLAIM_EPOCH` (roster-data.js) is armed to 3** (2 was the strict-cutover sweep; 3 the `member`
claim), via `refreshClaimsIfStale()` in `session.js`, gated by `localStorage('myb_claim_epoch')` — every
device sweeps its token once on next open. **Do NOT bump again unless deliberately forcing a fresh
sweep.**

**Rollback — do NOT re-add the `!('name' in request.auth.token)` escape or revert `overrides` to
`request.auth != null`.** Anonymous sign-in is still enabled, so either one re-admits anonymous writes
to every member's record. A lockout after a claims change is a CLAIM problem, not a rules problem: run
Operations → Set up accounts, then let tokens refresh (`CLAIM_EPOCH` sweep / `writeWithClaimRetry`). A
genuinely bad rules deploy is rolled back only to the immediately previous rules version — never past
v24.23 (the member-claim binding).

### Deferred residual — retire the anonymous fallback + kill-switch ✅ DONE (v24.34)

Done, owner-approved, together with the Calendar's `CALENDAR_PIN_ACCESS` switch (whose `false` path was
the other surviving `signInAnonymously` call). The case that settled it: neither switch was a rollback
any more. The strict override writes, the claim-gated override and document reads and the
server-issued `member` claim refuse every session either one restored, so flipping one would have
produced silently-failing saves or a Calendar showing the base roster as though current — traps, not
brakes. Rollback is reverting a release.

---

## Appendix: A2 — Workload Identity Federation ✓ COMPLETE (v14.93)

**What it did:** retired the long-lived `FIREBASE_SERVICE_ACCOUNT` JSON key for **short-lived GitHub OIDC
tokens** on all 3 deploy workflows (`google-github-actions/auth`, pinned `v3.0.0`; provider + SA written
directly in each YAML — they aren't secrets; job `permissions: { contents: read, id-token: write }`). No
standing full-project deploy credential remains in GitHub — the SA JSON key AND the GitHub secret are
both deleted, and a deploy from `main` was confidence-checked with the key gone.

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

### Tightening it — deploys from `main` only, and a read-only backup check (A7, whole-app review Oct 2026)

**What is open.** The provider's condition names the REPOSITORY and nothing else, so a workflow on
ANY branch of this repository can exchange its GitHub token for `github-deploy@` — which can replace
the rules, the functions and the hosted site. "Deploy only from `main`" is an `if:` inside each deploy
workflow, and a branch controls its own copy of that file: a pushed branch that edits the `if:` away
deploys. Branch protection on `main` does not help, because the token is minted on the branch. And
the weekly backup check asks a read-only question as that same deploy account.

**Nothing in the repository can close the first half** — it is the provider's condition, in GCP. The
code side is done: no workflow authenticates from anything but `main` (deploys are `push` to `main`;
the backup check is a schedule, which runs on the default branch), so the tightened condition below
refuses nothing that runs today. A `workflow_dispatch` of the backup check from another branch will
be refused afterwards — that is the point.

Run in Cloud Shell, signed in as the project owner:

```bash
PROJECT=myb-roster
NUMBER=532910998075

# 1 · Deploys from main only. Keeps the repository condition (the invariant above) and adds the ref.
gcloud iam workload-identity-pools providers update-oidc github-provider \
  --project="$PROJECT" --location=global --workload-identity-pool=github-pool \
  --attribute-condition="assertion.repository == 'Garethdavidmiller/roster-app' && assertion.ref == 'refs/heads/main'"

# 2 · A read-only account for the backup check — two permissions, no document reads.
#     (roles/datastore.viewer would also read every document; do not use it here.)
gcloud iam roles create backupCheckReader --project="$PROJECT" \
  --title="Backup check (read-only)" \
  --permissions=datastore.backupSchedules.list,datastore.databases.getMetadata
gcloud iam service-accounts create backup-check --project="$PROJECT" \
  --display-name="Backup check (read-only)"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:backup-check@$PROJECT.iam.gserviceaccount.com" \
  --role="projects/$PROJECT/roles/backupCheckReader"
gcloud iam service-accounts add-iam-policy-binding "backup-check@$PROJECT.iam.gserviceaccount.com" \
  --project="$PROJECT" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUMBER/locations/global/workloadIdentityPools/github-pool/attribute.repository/Garethdavidmiller/roster-app"
```

Then, in GitHub: **Settings → Secrets and variables → Actions → Variables → New repository
variable**, name `BACKUP_CHECK_SERVICE_ACCOUNT`, value `backup-check@myb-roster.iam.gserviceaccount.com`.
The workflow falls back to the deploy account while the variable is unset, so the order above is safe.

**Confirm both:** run *"Are Firestore backups actually being taken?"* from the Actions tab on `main`
— its summary should name `backup-check@` and give a real answer rather than "could not check" — and
let the next deploy from `main` go through. A deploy that fails at "Authenticate to Google Cloud"
after step 1 means the condition was mistyped; re-run step 1 with the line exactly as above.
