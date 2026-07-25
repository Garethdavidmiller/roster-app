# KNOWN_LIMITATIONS.md — Intentional constraints and deferred work

*Last updated: July 2026 — v18.80 · Updated every 0.10 version*

These are documented decisions, not oversights. Read before filing a bug or suggesting a fix.

---

## Security

> **Forward plan:** the deferred security work in this section (per-member write isolation,
> named-session separation, App Check, password retirement, Workload Identity Federation, the
> firebase-admin bump) is sequenced into a phased release with per-phase risk/rollback in
> **`SECURITY_RELEASE_PLAN.md`**. The entries below remain the authoritative *post-mortems and
> rationale*; that file is the *ordering* that keeps a fix from re-creating the v10.94 outage.

### Override data is publicly readable (intentional trade-off)
The `overrides` Firestore collection — which contains AL dates, sick days, and shift
changes for all staff members — is readable without any authentication. Anyone who
finds the app URL can view any staff member's recorded absences and leave.

**Why:** Requiring auth to read overrides was attempted at v12.04 using an anonymous
Firebase Auth session established at app startup. This was reverted at v12.05 because:
- The anonymous session workaround added complexity without meaningfully improving
  security (a malicious user could obtain an anonymous session just as easily as the
  app does).
- The correct fix — requiring a *named* staff login before viewing the calendar — was
  considered and declined as it adds friction to the primary daily workflow.

**Current mitigations:** The URL is not publicly advertised; the team is small and
known; writes still require a named Firebase Auth session (`request.auth != null`).

**If this becomes a concern:** Gate the calendar on a named session, remove the
anonymous read from `firestore.rules`, and remove the anonymous auth block from
`calendar-app.js`. See the June 2026 conversation for the full trade-off analysis.

**Re-reviewed July 2026 (A2 / F-SEC-2) — decision stands, leave-as-is.** Note for future
reviewers: the calendar now *does* establish an anonymous session (added v13.78 for error/usage
reporting), so the v12.05 "anon-session workaround adds complexity" objection is now moot and an
`allow read: if request.auth != null` gate would be near-free. It was **still declined** because
the security value remains marginal — the v12.05 finding holds: an anonymous token is as freely
obtainable as the app obtains it, so the gate only blocks a fully-token-less REST read, not a
determined reader — and it carries real breakage risk (every override reader across calendar /
paycalc / team-view / day-detail must read strictly after its session resolves, incl. cold/offline
cases). The only *real* fix is the named-session gate, which the owner has declined for daily-UX
reasons. Do not re-propose the anon-gate as a "quick win"; it is not one.

### Admin/manager password is surname-derived (F-SEC-1) — scoped July 2026, owner chose leave-as-is

Every account's Firebase Auth password is the member's surname (lowercased, non-alpha stripped,
padded to ≥6) — `normaliseSurname`. The typed login field is only a **local** gate that must equal
the surname; the real credential is derived from the (public) display name. So the **admin**
(`G. Miller` → `miller`) and **manager** accounts — which can do everything / write on-behalf — are
guessable by anyone who knows the app URL + the surname convention (stated in the login hint).

**A targeted fix was scoped (July 2026):** give admin/manager accounts a real secret, with a client
login branch that (for those names) passes the typed password verbatim and skips the surname check,
plus a `setupRosterAuth` guard so the break-glass surname-reset doesn't clobber it. Fully buildable;
the only owner-only parts are setting + holding the secret (it can't live in the repo).

**Owner decision: leave-as-is** — the exposure is impact-high but **likelihood-bounded by the
unadvertised URL + small known team**, matching the existing surname-password posture ("passwords are
surname-derived and not secrets; protection relies on Firebase Auth rate-limiting + Firestore rules").
The full staff-wide replacement is the planned **Track C** in SECURITY_RELEASE_PLAN.md.

**Partial remediation SHIPPED (v18.63) — PASSWORD_PLAN.md Phase 0+1.** Every account (admin/manager
included) can now **set its own real secret** in Settings → Password; sign-in accepts the typed
password and only falls back to the surname while the account is still on the default. So the specific
"guessable admin/manager password" exposure is **closable today by the owner simply setting their own
password** — the targeted admin/manager fix scoped above is effectively subsumed by the general
capability (no special-case login branch needed). It is **not automatically closed**: the surname
default stays valid until each account sets a password, and the surname is not *retired* (C5) until the
≥90%-migrated gate. So treat this as "the fix is now available and one action away", not "resolved for
all accounts". Migration progress is visible in Operations → Account status.

**Status update (25 Jul 2026, owner-reported — not independently verified in-repo).** 2 accounts had
migrated in the first 24 hours, **one of them the owner's**. So the specific exposure this entry is
about — a guessable *master admin* password, the highest-value target in the app — **is closed in
practice**. What remains open is the **6 management accounts**, which can write any member's
AL/absence/shifts on behalf; a staff account, by contrast, can only write its own overrides (the B3
isolation rule holds), so its blast radius is one person's roster. Chasing those 6 needs no code —
it is 7 people total opening Settings → Password, and it closes the large majority of what is left.
Verify against Operations → Account status rather than taking this paragraph's word for it.

**Revisit when:** the app URL is advertised more widely, or it becomes official Chiltern
infrastructure — then confirm the admin/manager accounts have set their own passwords (and sequence
Track C Phase 2/3 for staff-wide migration + surname retirement). Do not treat the guessable admin
password as fixed until those accounts have actually set a secret; it is an accepted, bounded risk with
a now-available fix, not an automatically-closed one.

### Huddle Firestore writes restricted to admin (v11.07)
`firestore.rules` now requires `request.auth.token.admin == true` for all browser
create/update/delete on the `huddles` collection. Prior to v11.07, any signed-in staff
member could alter huddle metadata (storageUrl, fileType, htmlContent) even though
Storage rules prevented them from uploading files. The two rules now match: both Storage
and Firestore require admin claim for huddle writes. Cloud Function writes via Admin SDK
bypass rules and are unaffected.

### CSP connect-src uses the `https://*.googleapis.com` wildcard — narrowing was tried and reverted (v11.07; A6/F-SEC-6 attempted + reverted v17.76–78)
`connect-src` deliberately keeps the broad `https://*.googleapis.com` wildcard. **A6 (F-SEC-6)
tried to narrow it** to the four hosts the app was believed to contact (`firestore` / `identitytoolkit`
/ `securetoken` / `firebasestorage`) — but that **broke the deployed-CSP CI proof** (`e2e/csp.spec.js`,
the `csp` job in `e2e.yml`) and was **reverted**. The lesson: the local `npm run test:csp` run passed
(a **false pass** — behind the dev-container's outbound proxy the real Firebase SDK never completed the
network init that reaches the extra hosts), while on CI's real network the SDK contacts **additional
`*.googleapis.com` sub-hosts** the four-host list omitted (the Firebase App core / an internal service
such as `firebaseinstallations.googleapis.com`, plus possibly others). Blocking those fired
`securitypolicyviolation`s and failed the suite.

**So the wildcard stays.** It only permits Google-owned `*.googleapis.com` origins (not arbitrary
hosts), `script-src 'self'` already blocks injected script, and this is P4 defence-in-depth with no
live vector — not worth the breakage. **If narrowing is retried:** first capture the COMPLETE host set
from a real-network run — read every `blockedURI` from the CI `csp` job (or a browser with the narrowed
header on a live network), not a proxied dev run — then list exactly those hosts in `firebase.json` AND
all ten `<meta>` CSPs, and confirm the CI `csp` job (not just local) goes green.

### `script-src`/`frame-src` must allow Firebase Auth's Google-API iframe — `apis.google.com` (fixed v17.82)
Firebase Auth (`firebase-auth.js`, loaded from gstatic) pulls in the Google API client
**`https://apis.google.com/js/api.js`** and opens an auth-helper iframe on the **authDomain**
(`myb-roster.firebaseapp.com`). `apis.google.com` is a **different domain** from the
`*.googleapis.com` `connect-src` wildcard, so it was never covered — the CI `csp` job failed on the
three app pages that initialise Auth with `Refused to load the script 'https://apis.google.com/js/api.js'`
(directive `script-src-elem`). It only surfaced on CI: behind the dev-container proxy `www.gstatic.com`
is tunnel-blocked, so the SDK never loads and never makes the call (the documented **false pass** — a
local `npm run test:csp` stays green while CI is red). Fix: `script-src` now includes
`https://apis.google.com`; `frame-src` (was `'none'`) now allows
`https://myb-roster.firebaseapp.com https://apis.google.com` for the auth iframe — the standard
Firebase-Auth-under-CSP requirement. **Second layer (v17.96):** once the gapi script could load, it
began pinging its own telemetry endpoint (`apis.google.com/js/gen_204`) — a `connect-src` violation
(the `*.googleapis.com` wildcard does NOT cover `apis.google.com`). `connect-src` now includes
`https://apis.google.com` too. Lesson: allowing a third-party script means allowing what it then
CONNECTS to — check the CI csp job after each layer, not just the first. Applied to the `firebase.json` header AND all ten `<meta>` CSPs
(csp-meta-parity), with `apis.google.com` added to `csp-hygiene.test.mjs`'s `DYNAMIC_HOSTS` (it's
requested by the gstatic SDK, not built in our source).

### GitHub Pages mirror — CSP via `<meta>`, with two residual header-only gaps (v17.63)
The staff mirror at `garethdavidmiller.github.io/roster-app/` is served by GitHub Pages, which
**cannot serve custom HTTP response headers at all** (no `_headers` support). So the `firebase.json`
CSP header — and every other security/cache header — never reaches the mirror. To close the biggest
gap, every served HTML page now carries a `<meta http-equiv="Content-Security-Policy">` mirroring the
header (v17.63; `csp-meta-parity.test.mjs` keeps them in lockstep, `e2e/csp.spec.js` proves it at
runtime). On Firebase Hosting the page then carries header + meta (identical → same enforcement); on
the mirror the meta is the only CSP, but it covers **all resource-loading directives** (`script-src`,
`connect-src`, `style-src`, `img-src`, `frame-src`, `object-src`, `base-uri`, `form-action`, …).
**Residual gaps on the mirror only — accepted, and a reason to retire the mirror:**
1. **`frame-ancestors 'none'` (anti-clickjacking) can't be expressed in a `<meta>` CSP** (browsers
   ignore it there), and GitHub Pages sends no `X-Frame-Options`. The mirror could therefore be
   framed. Low impact — the app has no same-origin sensitive action a clickjack could drive (all
   writes need a Firebase auth token, and `frame-src 'none'`/`object-src 'none'` still apply), but it
   is a genuine difference from the Firebase origin.
2. **`Cache-Control: no-cache` isn't applied** on the mirror; GitHub Pages uses its own caching.
   Freshness is still carried by the service-worker version-bump lifecycle, so this is cosmetic.
Both close automatically if/when the GitHub Pages mirror is retired (the stated long-term direction).

### localStorage session can be forged for UI access (#14)
The `myb_admin_session` localStorage session can be modified via DevTools to
impersonate another user or gain the admin UI. A forged local session does not by
itself create a Firebase Auth identity. **B1 (v14.42, `ENFORCE_NAMED_SESSION = true`)
closed the anonymous-fallback write path:** the write pages (admin/operations/settings/links)
now require the member's OWN named Firebase session — a session that can't establish one is
bounced to re-login rather than proceeding as a nameless guest, so anonymous writes from a
forged UI session no longer occur there. Per-member write isolation on `overrides` has since
**shipped strict (B3, v16.29)** — create/update/delete require
`token.name == memberName || token.admin || token.manager` — though the named password is still
surname-derived, so this remains hardening, not full remediation. Local UI checks remain
non-security controls. Practical risk is low for a small known team. The per-member role-based
rules are tracked in `SECURITY_RELEASE_PLAN.md` → B2/B3, and task #2 below for the suspended
first attempt.

### Firebase Auth session is re-established on page load (v10.93)
A returning user with a valid 30-day localStorage session skips the login click handler on
every subsequent open, which would leave `auth.currentUser` null and break all Firestore
writes. Fixed in v10.93 by `ensureFirebaseSession()`, which runs on page load whenever a
localStorage session exists (waits for `onAuthStateChanged`, signs in if none found,
self-heals a missing account). Full description and the "do not remove this call" rule:
**CLAUDE.md → "Firebase Auth (complete — v7.94)"**.

### ⏰ The four v11 security tasks — current status

Originally pencilled in for v10.50, deferred to v11. Current status:
**#1 done** (with a critical allowlist caveat — see below) · **#2 SHIPPED strict at v16.29**
(was suspended after the v10.94 outage; rebuilt as B2 v14.53, hardened to strict B3 v16.29) ·
**#3 done** · **#4 done** (verified live 27 June 2026).

**1. Firebase web API key — restrict to HTTP referrers ✓ DONE (May 2026) ⚠️ SEE NOTE**
The key is visible in page source (normal for client-side Firebase). Without a GCP referrer
restriction it could theoretically be used to brute-force Firebase Auth from any origin.
**Applied manually in GCP Console:** APIs & Services → Credentials → Firebase web API key →
HTTP referrer restrictions set to `myb-roster.firebaseapp.com/*` and `myb-roster.web.app/*`.
Verified with curl: 403 for requests without a `Referer` header, 403 for a bad origin
(`evil.com`), 400 (reached Firebase — key accepted, credentials invalid as expected) for the
correct origin (`myb-roster.web.app`). Restriction is working correctly.

**⚠️ CRITICAL — all served domains must be in the allowlist (v10.95):**
In May 2026 the referrer restriction was found to be blocking **all** Firebase Auth calls
from `garethdavidmiller.github.io` — the domain staff actually use — because only the two
Firebase-issued domains were added to the allowlist, not the GitHub Pages / custom domain.
Every sign-in attempt threw `auth/requests-from-referer-...-are-blocked`, making every
Firestore write fail silently for all users.

**Fix:** In GCP Console → APIs & Services → Credentials → Firebase web API key, add every
domain the app is served from. Current allowlist must include:
- `myb-roster.firebaseapp.com/*`
- `myb-roster.web.app/*`
- `garethdavidmiller.github.io/*`

If you ever add a custom domain, add it here too — or ALL Firebase Auth and API calls
will silently fail for users on that domain, with no visible error in the app UI.

**2. Firestore security rules — member write isolation ✅ SHIPPED, strict (B2 v14.53 → B3 strict v16.29)**
> **Status update:** the original suspended isolation was reintroduced the *cautious* way as
> phase **B2** (`SECURITY_RELEASE_PLAN.md`), then hardened to the **strict B3 form at v16.29**.
> `overrides` create/update/delete now require
> `token.name == memberName || token.admin || token.manager` — the `!('name' in token)` no-name/legacy
> escape has been **removed**. The two v10.94 root causes were both fixed years ago (the `name` claim is
> set for everyone by `setupRosterAuth`; the page-load Firebase session is reliably established via
> `ensureFirebaseSession`, B1). B2 first avoided the original outage by (a) an interim `!('name' in token)`
> escape so no legacy/anonymous token was hard-rejected, and (b) adding the **`manager` tier** the original
> lacked — the 6 managers edit staff data on behalf and would otherwise be locked out. B3 (v16.29) then
> dropped the escape and went strict, after the CLAIM_EPOCH=2 token sweep + manager re-provision; stale
> tokens self-heal via `writeWithClaimRetry`, so no mass sign-out was needed. Emulator-tested (tier matrix
> + delete + date bounding, all green). The historical post-mortem below is retained for context.

Originally implemented in v10.72 (`firestore.rules`). Per-member write isolation required
every write to carry a custom JWT claim (`request.auth.token.name` = memberName,
`request.auth.token.admin` = true for G. Miller), set server-side by `setupRosterAuth`.

**Why it was reverted (v10.94):** Two cascading bugs caused a full production outage:

1. **setupRosterAuth bug (v10.88 fixed):** The Cloud Function only ever set `{ admin: true }`
   for G. Miller — it never set the `name` claim for anyone. So every staff member's
   writes failed the isolation check, not just non-admins.

2. **Page-load Firebase Auth session bug (v10.93 fixed):** The Firebase Auth sign-in only
   ran inside the login click handler. A returning user with a valid 30-day localStorage
   session never hit that handler, so `auth.currentUser` was persistently null — breaking
   both the Firestore writes (no session at all) and the "Set up accounts" button needed to
   fix the claims. A classic deadlock.

With both bugs fixed, the claims path could technically work. However, it still requires
a multi-step manual recovery (Set up accounts → sign out/in → Set up accounts again →
all staff sign out/in). During an active outage, that fragility is unacceptable.

**Current state (v10.94):** Rules reverted to `request.auth != null` — any signed-in
staff member may write, matching the pre-v10.72 model that ran without incident for
months. Field validation (type whitelist, size limits, required keys) is still enforced
for data integrity.

**To re-introduce (RE-INTRODUCED as B2 v14.53, then shipped STRICT as B3 v16.29):**
- Confirm `setupRosterAuth` reliably sets `name` claims for all staff (v10.88 fixed this)
- Confirm page-load Firebase Auth session is reliably established (v10.93 fixed this)
- Re-add the per-member claim checks to `firestore.rules`
- Deploy rules and run "Set up accounts" to ensure all tokens carry the claim
- Test that every staff member can write their own overrides before deploying to prod

**3. HPP variable-pay split — which pay accrues the Holiday Pay Premium**
Only genuinely-VARIABLE pay accrues HPP: overtime, RDW, Sunday, Saturday, bank-holiday and
Boxing Day premiums. **Basic pay and London Allowance do NOT accrue HPP** — London is a fixed
allowance paid every period (including while on leave), so it needs no holiday premium.
**✓ Code now matches this rule (v17.23):** London was wrongly folded into the HPP base at
v16.90 and has been removed from `_varPayForPeriod`; the HPP estimate no longer includes it
(owner-confirmed; the annual HPP lump appears as its own payslip line, separate from London
Allowance). The per-category back-pay itemisation was confirmed from G. Miller's period 32
(Oct 2025) payslip (each line carries a `(Back Pay)` suffix). (History: back pay's variable
portion was briefly added into HPP at v10.73, then removed at v16.89 as a double-count — see
"Back pay lump sum vs HPP" below.)

**4. Pay reminder push notification — ✓ DONE (verified live 27 June 2026)**
`sendPayReminderNotification` did not fire on 30 May 2026 because the Cloud Scheduler job
had never been created. Root causes (both fixed in May 2026):
- The `FIREBASE_SERVICE_ACCOUNT` lacked `roles/cloudscheduler.admin` — deployment failed
  silently trying to manage the scheduler job. (Historical: that SA JSON key + GitHub secret
  have since been **retired** — all deploys now use Workload Identity Federation; see
  CLAUDE.md → SECURITY_RELEASE_PLAN Appendix A2. The scheduler perms now attach to the WIF
  `github-deploy@` service account.)
- A stale `us-central1` deployment record blocked redeployment (the function had initially
  deployed to us-central1 before the region was set to `europe-west2`). Deleted manually
  from Firebase Console, then redeployed cleanly.
The Cloud Scheduler job `firebase-schedule-sendPayReminderNotification-europe-west2` now
exists. A force-run on 31 May confirmed the function executes and correctly skips on
non-cutoff days (`[payReminder] Not a cutoff date — skipping`).
**✓ Verified live on Saturday 27 June 2026** (cutoff for the 3 Jul payday): the reminder
push arrived on a real device. The full scheduled path — Cloud Scheduler trigger →
cutoff-date detection → fan-out — now works end to end. All four v11 security tasks are
now resolved (#1 done, #2 shipped strict v16.29, #3 done, #4 done).

### Deep-review residuals (July 2026) — accepted / inherent, not code-fixable

A max-effort 8-reviewer deep review (July 2026) found **no critical, high, or security defect**; the
actionable low-severity findings were fixed in the same pass. These few remain **by nature** — they
are architecture/App-Check territory or inherent platform behaviour, not bugs to patch:

- **Analytics dynamic-map value integrity.** `analytics/activeAccounts` and `analytics/perf_<month>`
  hold date-keyed maps whose *values* Firestore rules cannot iterate/type-check, so an authenticated
  (incl. anonymous calendar) session could write junk/forged counts. The rules already validate
  SHAPE + block key-removal (the destructive wipe); per-value integrity is **App Check territory**
  (see below) on non-sensitive, admin-only aggregate counts. The `pv_` counts *are* int-checked.
- **A late-resolving sign-in can briefly strand a privileged Firebase identity.** A
  `signInWithEmailAndPassword` that resolves *after* an 8 s login timeout / `clearSession` can leave
  `auth.currentUser` signed in until the next launch — Firebase sign-in is not cancellable mid-flight.
  Mitigated already: `reconcileExpiredIdentity()` runs on virtually every calendar/protected-page
  load and tears down a lingering expired identity. Inherent residual, not a logic error.
- **`passwordSetAt` vs `resetAt` is a two-system stamp, not atomic.** A sub-second interleave of a
  member's self-set and an admin reset can momentarily misreport the "migrated" chip. It self-heals
  on the next set/reset and stores no password material — a monitoring signal, not a control.
- **Concurrent Huddle ingest can leave a stale notification deep-link.** Two Power-Automate runs for
  the same date: only one push is sent (the transaction closes the check-then-act race), but the
  second commit can delete the object the first run's already-sent push linked to → that tap 404s
  (the in-app viewer still works). Rare double-run only.
- **`style-src 'unsafe-inline'`** stays in the CSP — the app sets inline styles from JS; style
  injection is far lower-risk than script (which is fully locked down, no `'unsafe-inline'`). And the
  `connect-src` `firebasestorage.googleapis.com` entry is redundant under the `*.googleapis.com`
  wildcard but kept for explicit readability (harmless; the hygiene test tolerates it).

### Two card-collapse systems (v18.87 aesthetic pass) — owner decision, not drift-by-accident

paycalc's five cards animate open (`.collapsible-body` + `.card-toggle-arrow`, a `max-height`
reveal) while admin/operations/settings/links use the shared `.card-collapsible-body` +
`.collapse-chevron`, which is `display: none/block` — instant. Same interaction, different feel
depending which page you're on. The v18.16 pass promoted paycalc's card HEADER to `shared.css` as
the canonical one but left the BODY behaviour per-page, which is how the split survived.

Left as-is because converging it is a design choice, not a bug fix, and both directions cost
something: making the other five animate inherits the `max-height` reveal's weakness (it eases
toward a fixed ceiling, so short cards finish early and the easing reads wrong), while making
paycalc instant removes a nicety staff already have on the page they use most. Worth an explicit
decision rather than a silent sweep. What WAS fixed at v18.87 is the drift inside paycalc's own
animation: height ran 0.4s against its own padding at 0.3s, so the last 100ms of every card opening
was height-only; all three now share `--dur-slower`.

**Two more from the v18.84 sweep — real code paths, deliberately NOT changed** (the fix costs more
risk than the defect):

- **A retry can run a second authoritative reconciler over a month another fetch already owns.**
  `doRetry` (`calendar-initial-fetch.js`) re-claims all three initial months and reconciles the whole
  range. Reachable only as: initial fetch fails → its catch releases the months → a render/swipe
  calls `ensureOverridesCached` for one of them (claiming it, fetch F1) → the user taps the retry
  chip (fetch F2). Both are authoritative for the overlapping month, so if F1 resolves later with a
  staler snapshot it can evict an override F2 just loaded — the class of bug removed from Team View
  at v18.76. Left as-is: the window is one Firestore round-trip inside a three-step failure sequence,
  the next fetch heals it, and the alternative (routing the retry through `ensureOverridesCached`)
  would rewrite a delicate chip state machine whose success/failure signalling depends on awaiting a
  single range fetch. Revisit only if it is ever seen in the wild.
- **A back-pay lump on an un-entered payslip is excluded from "This tax year so far".** The
  year-summary skips a paid payslip with no saved hours wholesale (it is listed under "Not entered
  yet"), so its opt-in lump is skipped with it, while the result card shows the lump. Judged correct
  rather than broken: including only the lump from a payslip the member hasn't filled in would make
  the "N of M entered" count and the money disagree. The HPP lump behaves the same way, and
  `paycalc-year-summary.test.mjs` now pins it.

### Firebase App Check — considered and declined (June 2026)
App Check (register the app's hosting domains so only requests from our own pages can reach
Firestore/Storage) was considered as a defence-in-depth measure and **declined for now**.

**Why declined:**
- It is **not** a console-only toggle — it requires client-side SDK init in `firebase-client.js`
  wired to a provider (e.g. reCAPTCHA Enterprise), so it is a real code change with its own
  outage risk, not a 30-minute setting.
- It shares the **exact failure mode** that the API-key referrer restriction (task #1) already
  caused in production: miss a served domain (`web.app`, `firebaseapp.com`,
  `garethdavidmiller.github.io`) or hit a provider hiccup and writes start failing silently with
  no visible error in the app. The allowlist must be kept in sync forever.
- Our biggest data exposure — the `overrides` collection — is **already world-readable by
  design** (see "Override data is publicly readable" above). App Check gates *which clients*
  connect, not what an authenticated client may read, so it does not address that exposure.
- Payoff for this threat model (unadvertised app, small known team) is low: it blocks scripted
  bulk reads/writes from outside our pages, which is a real but low-probability attack here.

**When to revisit:** if the app is advertised more widely or becomes official Chiltern
infrastructure. Of the deferred security work, per-member write isolation (task #2 above) had
the higher real value and has now **SHIPPED strict at v16.29** (B3). Its old blocker — the
Firestore emulator test suite (ROADMAP Phase 7) — was put **in place** (`firestore.rules.test.mjs`
+ `storage.rules.test.mjs`, run via `npm run test:rules`, gating `deploy-rules.yml`), letting the
rules change be tested before shipping. The old operational-fragility barrier (the multi-step claim
recovery that caused the v10.94 outage) was resolved by shipping after the CLAIM_EPOCH=2 sweep +
manager re-provision, with stale tokens self-healing via `writeWithClaimRetry` — so no mass sign-out
was needed.

---

## Pay calculator

### Not a payslip replacement
The calculator estimates take-home pay from staff-entered data. Actual payslips from
Chiltern may differ due to arrears, adjustments, and deductions not captured here.

### 2026/27 pay rates not confirmed
`GRADES` in `paycalc-calc.js` has placeholder 2026/27 rates. Update when the pay
award is announced. The UI shows a yellow "rate unconfirmed" notice for 2026/27 periods.
Pay awards at Chiltern are typically not decided until August — do not expect confirmed
rates before then.

### Back pay lump sum vs HPP (v10.73 — SUPERSEDED at v16.89)
The v10.73 fix fed `calcBackPay()`'s variable-pay portion (`_bpVarAmount`) into `calcHPP()`.
That coupling was later found to DOUBLE-COUNT the award uplift (calcHPP already prices the
whole year at the settled post-award rate) and was deliberately removed at v16.89 — the lump
no longer feeds HPP. Current rule: `.claude/rules/paycalc.md` → "The lump is deliberately NOT
added into the HPP estimate (v16.89)". See task #3 above for the original payslip confirmation.

### Pre-fill reads base roster + Firestore overrides only
The "Fill from roster" suggestion counts special-rate shifts (Sat/Sun/BH/RDW/Boxing Day).
Standard weekday contracted hours are not pre-filled — staff enter those manually.
The suggestion is advisory; staff should verify it against their actual payslip.

### Tax band model is approximate for 0T and K codes (flagged v12.49 — check later)
In `computeTax()` (`paycalc-calc.js`), the basic-rate band width is computed as
`income threshold − personal allowance` (e.g. £50,270 − £12,570 = £37,700 for 1257L).
HMRC actually applies the bands to **taxable pay**: the first £37,700 of taxable income
is at 20% regardless of the tax code. The two models agree exactly for ordinary `nL`
codes, but diverge for **0T** and **K codes** — there the current model makes the 20%
band the full £50,270 wide, under-taxing anyone on those codes who crosses into the
40% band. The existing tests in `paycalc.test.mjs` encode the current behaviour, so
changing this means updating tests too. Rare codes at Marylebone; **verify against a
real payslip from someone on a 0T/K code before changing** — do not fix speculatively.

### ~~Pension default is frozen onto a period once it is touched~~ — CLOSED v18.43

**Closed (v18.43),** with the pension cut-overs this deferral prescribed as its trigger (the historic
`PENSION_STEPS` table — review item 8): `readFormData` now stores `null` when the pension field still
equals the period's default (default × pro-rate, 2dp, ±0.005 — mirroring `_hasCustomPension`), so a
merely-touched period keeps self-healing to default changes while a genuinely custom pension
persists. Periods frozen BEFORE v18.43 keep their stored value (indistinguishable from a deliberate
entry — the per-payslip pension design); re-saving them heals them. Original finding below for the record.

**Original finding:** Pension default is frozen onto a period once it is touched (defer to the next pension change)
`loadPeriodData` writes the period-appropriate pension default into `#pensionAmt` when a period
has no saved pension (`d.pension == null`), and `readFormData` then persists whatever is in the
field — so the first edit to that period saves the default as a concrete value, and the period no
longer "self-heals" to a *future* pension-default change (the self-heal the `loadPeriodData` comment
intends for pension rate cut-overs). **Impact today is zero**: there is only one pension value
(£147.36), so default == stored for every period and nothing can diverge. It becomes real only when
(a) a pension **cut-over** is configured in `getPensionDefault` (like the rate `pensionPre`/`pensionFrom`
pattern) *and* (b) a **future** period was edited before that cut-over — then that period shows the
old pension. **Fix belongs with the next pension-rate change** (that's when it matters and when it can
be tested against a real cut-over): make `readFormData` store `null` when the field still equals the
period's default — `Math.abs(fieldValue − getPensionDefault(period)×proRate) < 0.005`, mirroring the
existing `_hasCustomPension` check — so a pre-touched period self-heals while a genuinely-custom pension
is preserved. Do NOT fix speculatively now (unverifiable without a cut-over; risks the historical-accuracy
case). Surfaced by the v15.70 whole-page paycalc review (finding #6).

---

## Calendar / roster

### Team View summary chips — considered and declined (v11.85)
A summary chip strip showing aggregate counts per week (e.g. "Working 10 · AL 2 · RDW 1")
was considered for Team View. Declined: the working environment uses the grid for individual
planning, not aggregate operational analysis. The dense row grid already gives sufficient
at-a-glance clarity. Do not re-add without a specific operational use case from Gareth.

### Override cache is never cleared on member switch
`rosterOverridesCache` in `calendar-overrides.js` is keyed `"memberName|date"` and accumulates
overrides for all members without a size limit. It is not cleared when the selected
member changes — switching members triggers a new fetch that adds to the existing map.
This is intentional (avoids redundant Firestore reads on member switch) but means the
cache grows unboundedly for long sessions where many members are viewed.

### Duplicate Firestore override documents
If a date has multiple override documents for the same member, the cache keeps the
most recently created one (by `createdAt` timestamp). Duplicates are logged via
`console.warn`. Clean up at source in the Firebase Console.

---

## Navigation / accessibility

### Keyboard focus trap is panel-only (not full ARIA modal)
The nav panel traps Tab/Shift+Tab within its focusable elements while open (v10.69), and the coming-soon lightbox also traps Tab focus to its single close button. Both elements are declared `role="dialog" aria-modal="true"` (v10.80). Screen-reader users can still reach page content behind the overlay via browse mode — `inert` on background content is deferred. The app is staff-only on mobile (primarily Android), where VoiceOver/TalkBack bypass risks are low.

---

## PWA / service worker

### PWA shortcuts require reinstall to update
Changes to `manifest.json` shortcuts do not take effect on existing installs
until the user reinstalls the PWA (removes and re-adds to home screen).

### Service worker activates immediately (`skipWaiting`)
`self.skipWaiting()` means a new SW takes over all open tabs at once.
In the rare case this causes a mid-session race, a hard reload resolves it.

### Mixed-version cache window during a deploy — mitigated, not fully closed (accepted)
During the brief window between a new version deploying and a client fully reloading onto it, a page
can in principle pair one version's HTML/JS with another version's — an "interface-incompatible" mix
that can throw. The exposure is **already narrow and mitigated**, not silent:

- **Same-version serving (v16.10):** HTML, JS, and CSS are all served from the one version-pinned
  cache (`myb-roster-v{APP_VERSION}`), so a normal page open is single-version by construction.
- **Newest-older fallback (v16.86):** when an asset misses the current cache and can't be fetched
  (offline / a mid-deploy hosting hiccup), `matchNewestManagedCache` serves the **newest available
  older** cache — not the oldest one `caches.match()` would pick — and routes the HTML and JS
  fallbacks to the *same* older version, staying as close to single-version as the caches allow.
- **Reload lifecycle:** version bump → new SW → new cache → warm-up → `controllerchange` reload
  (`sw-register.js`) converges every client onto the new version; roster **data** is always live from
  Firestore regardless of the cached JS version.

**Residual (accepted):** a *partially-warmed* current cache can still pair a fresh module with an
older fallback for that one window, and a `beforeReload`-deferred reload (e.g. admin mid-edit) runs
old JS against a claimed new SW until it reloads. **Fully closing this is a deliberate scope
decision** — it needs either per-file version markers (the cheap HTML-comment marker was removed in
v16.81 because it made the version bump touch ~8 files on half of all commits) or per-page-load
version-coordination with a self-heal reload (a reload-loop hazard) — **both live in the
highest-outage-risk file (the SW)**, so the risk of a rushed change exceeds the (rare, self-resolving)
bug. Revisit only if a real mixed-version incident is observed in the field. (v16.95 review Finding #11.)

### Dual hosting: web.app primary, github.io kept for existing installs (v14.29)
The app is served, identically, from **two** live origins:

- **`https://myb-roster.web.app`** (+ its alias `myb-roster.firebaseapp.com`) — Firebase
  Hosting. **Canonical and primary** since v14.29: this is the URL to hand staff for any
  *new* install, and the origin written into Cloud Function notification payloads
  (`STAFF_SITE_URL`).
- **`https://garethdavidmiller.github.io/roster-app/`** — the GitHub Pages mirror (the
  roster-app repo's own native Pages). **Still live and not retired** — kept so the phones
  that already installed from it keep updating. Note the `/roster-app/` sub-path.

**Why both can coexist safely:** push *delivery* is origin-independent (every subscription in
`pushSubscriptions` is fanned out regardless of which origin it came from). The notification
*tap-through* is made origin-correct by the service worker, which discards the payload's origin
and re-bases the target page onto its **own** `registration.scope` (see `notificationclick` in
`service-worker.js`). So a github.io install taps through to github.io, a web.app install to
web.app — `STAFF_SITE_URL`'s origin only supplies the path + hash.

**Both origins must stay in the GCP API-key referrer allowlist** (`web.app`,
`firebaseapp.com`, `garethdavidmiller.github.io`) until github.io is deliberately retired —
dropping one silently breaks all Firebase Auth on that origin (see security task #1 above).

**Retiring github.io later** (optional, no deadline): confirm all staff have reinstalled from
web.app, remove the github.io entry from the allowlist, and turn off Pages in repo Settings.
There is no code dependency on it once nobody has it installed.

### ⚠️ The installed PWA masks live-site breakage — verify the URLs, not your phone
Because the app is offline-first, an installed PWA launches (and updates) from
the service-worker cache. It keeps working even when the **live deployment is
completely broken** — a splash that never clears, a `404`, a CSP violation, an
expired/missing API-key referrer entry. You will **not** notice from your own
installed app, which is exactly how the June 2026 outage went unseen (Firebase
URL stuck on splash, GitHub Pages staff URL returning 404, while every installed
phone carried on fine).

**Therefore: never treat "my phone works" as evidence the site is up.** Always
test the **live URLs in a fresh browser / private window** (no SW, no cache) —
the canonical URL checklist and cadence live in **CLAUDE.md → "Deployment health
check"** (both origins past the splash, a sub-page deep-link, no red console
errors). Re-run it after any change to `firebase.json` (CSP/headers), the
Firebase SDK version in `firebase-client.js`, the GCP API-key referrer
allowlist, or the hosting setup.

**Root cause of the June 2026 splash outage (fixed v12.34):** `firebase.json`'s
hosting `ignore` list contained `**/*.mjs` — intended to skip the `*.test.mjs`
test files, but it also dropped the **runtime** `purify.es.mjs` from every
Firebase deploy. The import is static (`index.html → calendar-app.js → calendar-huddle-viewer.js
→ import './purify.es.mjs'`), so the 404 broke the whole module graph and the
splash never cleared; it also failed the SW precache (`purify.es.mjs` is in
`CORE_ASSETS`). Fixed by narrowing the ignore to `**/*.test.mjs` + `generate-sri.mjs`.
**Lesson:** any deploy-ignore pattern must exclude *only* dev/test files — never
match a file the app imports at runtime. When adding a new runtime asset with a
test-like or tooling-like extension, confirm it is not caught by an `ignore`
glob in `firebase.json`.

---

## Huddle ingest

### Power Automate HTTP connector is Premium
The Huddle ingest flow requires the Premium HTTP connector in Power Automate.
The standard "Send an HTTP request (Office 365)" connector does not work here.

### File type detection uses filename extension, not Content-Type
Power Automate sends `text/plain` for both PDF and DOCX attachments.
The `ingestHuddle` function detects file type from the `X-Huddle-Filename` header
extension, not from `Content-Type`.

---

## Roster data

### Cloud Function payday constant duplicated from `roster-data.js`
`functions/roster-parse-helpers.js` contains its own `FIRST_PAYDAY_MS` and `INTERVAL_DAYS`
constants (inside `isPayCutoffDay()`, which `functions/index.js` imports) for the pay-reminder
scheduled notification. These must stay in sync with `CONFIG.FIRST_PAYDAY` and
`CONFIG.PAYDAY_INTERVAL_DAYS` in `roster-data.js`. If the pay schedule ever changes, both files
must be updated. The correct long-term fix is a shared JSON config consumed by both, but the
no-build constraint makes this awkward. For now: if you change payday config, search for
`FIRST_PAYDAY_MS` in `functions/roster-parse-helpers.js` and update it in the same commit.

### Cloud Function staff list duplicated from `roster-data.js`
`parseRosterPDF` name-matches the AI-parsed roster output against a `STAFF_NAMES` list, which is
**generated**, not hand-maintained: `functions/index.js` does `require('./roster-members.json')`
and `roster-members.json` is produced from `teamMembers` in `roster-data.js` by
`scripts/generate-roster-members.mjs` (`npm run generate:roster-members`). It is marked
"do NOT hand-edit". So a new starter/leaver does NOT need a manual edit in `functions/` —
update `teamMembers` in `roster-data.js`, then run `npm run generate:roster-members` to rebuild
the JSON in the same commit. (The `/new-starter` skill already includes this step.)

### firebase-admin upgrade to v14 blocked on firebase-functions compatibility (June 2026)

`firebase-admin@14.0.0` is available. Its original driver — a `uuid < 11.1.1` advisory in the
transitive dependency chain — is **already mitigated**: `functions/package.json` pins
`"overrides": { "uuid": "^11.1.1" }` (see that file's comment for the exact advisory), and
`cd functions && npm audit --omit=dev` now reports **0 vulnerabilities**. So the v14 bump is no
longer a vulnerability fix — it is hygiene / staying-current only. It remains blocked by one thing:

- `firebase-functions@7.x` (all released versions as of June 2026) declares
  `firebase-admin@"^11 || ^12 || ^13"` — it does not yet list v14 as a supported peer.

(The Node-runtime prerequisite that previously also blocked this is already met:
`functions/package.json` `engines` is on Node 22.)

**Practical risk:** none outstanding — the `uuid` advisory is pinned out entirely by the `overrides`
entry (production audit = 0). The v14 bump is deferred purely on the `firebase-functions` peer range.

**When to upgrade:** once `firebase-functions` releases a version adding `firebase-admin@^14`
to its peer dependency range. Check with `npm outdated` in `functions/`. When unblocked:
1. Bump `firebase-admin` to `^14.0.0` (the Node 22 `engines` requirement is already satisfied)
2. Audit `admin.firestore.FieldValue.serverTimestamp()` usage in `functions/index.js` —
   v14 dropped the legacy `admin.firestore` namespace; `FieldValue` must be imported from
   `firebase-admin/firestore` directly
3. Test all three Cloud Functions (ingestHuddle, parseRosterPDF, setupRosterAuth) before
   deploying to production

### `firebase-tools` → `gaxios` dev-only advisory — no clean forward fix (F-DEP-1, reviewed v17.74)

`npm audit` reports **5 moderate** advisories, all one root cause: a transitive `gaxios` in the
**6.4.0 – 6.7.1** range pulled in by **`firebase-tools`** (root `devDependency`, currently
`^15.22.2`).

**Impact: none in production.** `firebase-tools` is a **dev/CI-only** tool (Firebase emulators +
deploy) — it is **never bundled or served** to staff. The app ships no npm dependencies at all
(vanilla JS, no bundler); this advisory cannot reach a user.

**Why it is not "fixed" yet — the only npm fix is a *downgrade*.** The advisory is patched in
`gaxios@7.x`, but the latest `firebase-tools` (15.24.0) still declares `gaxios@^6.7.0`, which
resolves *within* the vulnerable range. `npm audit fix` therefore offers only
`firebase-tools@14.23.0` — a **semver-major downgrade** that moves the toolchain backwards and is a
breaking change. That is a worse position than the current moderate dev-only advisory, so it is
**declined**.

**Why not force it with `overrides`.** A root `"overrides": { "gaxios": "^7.2.0" }` would clear the
audit, but `gaxios` 6→7 is a **major** API change and the 6.x copy is required by an intermediate
Google dependency that expects the 6.x API — forcing 7.x risks breaking the **deploy/emulator
toolchain** (which gates every rules/hosting deploy). Not worth that risk for a moderate dev-only
advisory. (Contrast `functions/package.json`'s `uuid` override, which is safe because that pin stays
within a compatible range.)

**When to close:** once `firebase-tools` widens its `gaxios` range to include `7.x` (or its
intermediate Google deps do). Re-check with `npm audit` / `npm outdated` periodically; bump
`firebase-tools` then and confirm `npm run test:rules` + a hosting-emulator run still pass.

---

### Links design workspace — beta constraints (v12.37–v12.43)
The Links workspace (`links.html`) is flagged beta in the UI. Known limits accepted
for now:

- **Firefox keyboard editing commits early.** Firefox fires `change` on every
  arrow-key press inside a focused `<select>`, so keyboard-only editing of a shift
  cell commits on the first arrow instead of on Enter. Chrome/Safari (all staff
  devices) behave correctly. Escape cancels cleanly in all browsers.
- **Coverage heat map counts pattern positions, not a named headcount.** All 28
  positions are counted, including any line not yet designed. Staff names were removed
  at v12.39 — the design is patterns-only — so there is no distinction between named
  and unnamed positions. The heat map colour scale is relative to the week's own peak,
  so a lightly staffed day naturally shows cooler colours.
- **All 28 lines rotate and must be filled (v12.42).** Two earlier models were both
  dropped: "lines 23–27 are vacant placeholders" (`VACANT_FROM`, removed v12.41) and
  "line 28 is C. Reen's fixed link" (`FIXED_POS` + a separator row + non-editable
  cells, removed v12.42). In a rotating link everyone passes through every line, so an
  all-rest line is an *unfinished* line, not a vacancy — the link can't be authorised
  then re-cut each time a post is filled. The link is designed as a full 28 so it
  survives staff changes; C. Reen's adjusted fixed shifts are handled as overrides on
  the base roster, not in this designer. A Design-checks row and amber grid marker
  (`.row-unfilled`) flag any unfilled line until it is designed. **The auto-generator
  is the only way to create a new design (v12.43)** — it reads Mon–Fri/Sat/Sun
  headcount targets and produces a complete 28-line rotation in one step.
- **The 28-line structure is hardcoded by design.** `TOTAL_POS` and `ROTATING_LINES`
  reflect the agreed link concept — they are deliberately not derived from roster data.
  If the link concept changes (e.g. more lines), these constants change with it.
- **Save concurrency is warn-on-conflict, not merge.** Two designers saving at
  once get a confirm naming who saved last; the whole document is still replaced.
  A field-level merge is not worth the complexity for a 2-person beta tool.

### Test coverage gaps
The suite is now broad (40+ test files, ~1420 tests — see CLAUDE.md's file tree for the
full per-suite listing; nearly every pure module has a companion `.test.mjs`, the exceptions
being trivial data/formatter modules like `paycalc-help.js` and
`roster-cycle-data.js`). What matters here is what is **still not** covered:

**Closed v16.32–16.33:** the push-notification state machine + subscribe/unsubscribe flow
(`notif.test.mjs`, 23 tests — Push APIs stubbed on globalThis), the `setupRosterAuth` (B4) decision
logic (extracted to `functions/roster-parse-helpers.js` and unit-tested: `parseSetupActionFlags`,
`resolveRosterAuthConfig`, `claimsForTier`, `computeOrphanLabels`), and the `isSafeStorageUrl`
download-URL allowlist (extracted to `storage-utils.js` + `storage-utils.test.mjs`).

Still not tested: the coordinator wiring in `calendar-app.js` / `admin-app.js` (the extracted
`calendar-renderer.js` / `calendar-*` state modules have unit tests; the coordinators themselves do
not — e2e covers their page-load), the Firestore read/write layer in the page modules (behind the
gstatic-CDN import), and the Cloud Function HTTP *handlers* end-to-end (the Admin-SDK orchestration —
their pure decision logic IS now tested; a full handler test needs firebase-admin mocking). Before
adding new untested behaviour in these modules, consider whether a unit or integration test can be
added first.

### E2E smoke tests — REMOVED v12.75, RESTORED v13.95 (no longer a limitation)

**Resolved v13.95.** Restored once Chromium became available pre-installed in the
dev environment (`/opt/pw-browsers`), giving back the local iteration loop whose
absence forced the v12.75 removal. The suite (`e2e/`, `npm run test:e2e`) runs in CI
and gates the hosting deploy; `@playwright/test` is pinned to `1.56.1` to match the
pre-installed browser revision. Full restoration notes: ROADMAP.md → "E2E smoke tests".
The original removal rationale is preserved below.

Playwright smoke tests were added to verify that each app page loads, the JS module graph
executes without error, and key UI elements render (member dropdown, calendar grid, login
overlays, auth redirects for operations and links). They were the only tests that caught
page-level wiring failures — a SyntaxError, a missing import, or a CSP violation that
breaks the module graph shows up as a blank page and passes all unit tests.

**Why they were removed:** The Playwright Chromium binary cannot be downloaded in the
current development environment (CDN blocked), so the suite cannot be run locally to
verify a fix before pushing. In CI, they were originally solving a real problem: the
Firebase SDK is loaded as a static ES module import from the `gstatic.com` CDN; if that
CDN is slow or blocked on the CI runner, the entire module graph fails to load and every
page test times out — no amount of retry or timeout increase helps a hard import failure.
The `e2e/fixtures.js` stub solved this elegantly (intercepting `https://www.gstatic.com/
firebasejs/**` at the network layer and serving no-op local stubs), but the inability to
run them locally made maintenance impractical. When the suite broke or needed updating,
there was no way to iterate on it without pushing to CI.

**To bring back:** When resuming this work, **ask Gareth to walk through the better
options before committing to Playwright again.** The key questions are:
- Can the Chromium binary be made available in the dev environment, or is Playwright
  the wrong tool for a no-bundler CDN-only codebase?
- Should E2E tests run in a real browser at all, or would jsdom-based unit tests for the
  DOM wiring layer (nav-panel, overlay, session) cover the same defects more cheaply?
- Puppeteer, Cypress, or a different Playwright setup (pre-installed system Chromium)
  might remove the binary-download friction.
- The Firebase CDN stub approach was sound — whatever tool is chosen should reuse that
  pattern or find an equivalent way to eliminate the CDN single point of failure.

See ROADMAP.md → "E2E smoke tests" for the full history and the original test design.

### Legacy override types still in Firestore
Types `"allocated"`, `"overtime"`, `"swap"` are no longer creatable via the UI but
exist in older Firestore documents. They are displayed with their original labels in
Saved Changes. Editing them re-saves as `"shift"`.

The pay suggestion engine (`getRosterSuggestion` in `paycalc-roster-suggestions.js`)
reads the `type` field to classify shifts. Legacy types are treated as plain `"shift"`
overrides — they will not be miscounted, but any overtime/RDW semantics the original
type implied are lost. Clean up legacy documents in the Firebase Console to replace
them with the correct current types if the pay suggestion is producing wrong results.

### `window._mybSession` global replaced by `sessionReady` / `resolveSession()` ✓ (v13.74)
The `window._mybSession` global handshake was replaced at v13.74. `session.js` now exports:
- `sessionReady` — a `Promise<boolean>` that feature modules `await` before Firestore/Storage writes
- `resolveSession(result)` — called once by each page coordinator after `ensureFirebaseSession()`

Page coordinators (`admin-app.js`, `operations-app.js`, `settings-app.js`, `links-app.js`)
call `resolveSession()` at module scope. Feature modules (`huddle.js`, `admin-auth.js`,
`admin-roster-upload.js`) import `sessionReady` explicitly — a missing import produces
an ESLint `no-undef` error rather than a silent permissions failure.

**Residual:** `window._mybSession` is no longer set or read anywhere in the codebase. This
limitation entry is kept for history; the underlying issue is resolved.

---

## Error handling — silent catches audit (v13.72)

A full audit of `.catch(() => {})` patterns was completed in v13.72. The following
decisions are intentional. **Do not add new silent catches** — use
`catch(e => console.warn('[tag] message:', e))` for fire-and-forget paths so failures
appear in DevTools and the Operations Error Log.

### Intentional silent-catch patterns (correct)

| File | Location | Why silent is correct |
|------|----------|-----------------------|
| `nav-panel.js` | Circular / Newsletter fetch | The `.finally()` handler resets `_docFetching` and the `.catch()` renders "Couldn't connect" — the error is surfaced to the user; logging would be noise |
| `operations-app.js` | Clipboard copy in Error Log | `.catch()` shows '✗ Copy failed' inline — user-visible fallback; no logging needed |
| `firebase-client.js` | `logClientError` call inside `error-reporter.js` | Logging a logging failure would recurse; the silent swallow is the correct terminal handler |
| `firebase-client.js` | Firestore persistence setup chain | Persistence is best-effort; a silent fallback to non-persistent mode is the documented Firebase pattern |
| `firebase-client.js` | `getClientErrors` resolved-record cleanup | Expired resolved records are pruned fire-and-forget; individual delete failures are inconsequential |
| `paycalc-app.js` | Firebase session failure before `initErrorReporter` | Error reporter is not yet initialised at this point; the silent fallback is the only safe option |
| `sw-register.js` | `registration.update()` calls (hourly interval, visibility-change, pageshow) | SW update failures are not actionable — the existing SW stays active and the user experience is unaffected. Chrome also fires its own background update check that produces "Failed to update a ServiceWorker" unhandled rejections (suppressed in `error-reporter.js`); logging our own update attempts would add noise without benefit |
| `calendar-app.js` | `authReady.then(…).catch(() => {})` around anonymous sign-in | `authReady` failure means Firebase persistence is unavailable; anonymous sign-in is best-effort (it just gives `initErrorReporter` a token). Surfacing a secondary auth error via the error reporter that hasn't yet started would recurse |

### Fixed in v13.72 (now log `console.warn`)

| File | Location | Before | After |
|------|----------|--------|-------|
| `firebase-client.js:_pruneOldDocs` | Individual Storage file delete inside prune loop | `.catch(() => {})` | `.catch(e => console.warn('[pruneOldDocs] ...', e))` |
| `firebase-client.js:uploadCircular` | Rollback Storage delete on Firestore write failure | `.catch(() => {})` | `.catch(e => console.warn('[uploadCircular] rollback ...', e))` |
| `firebase-client.js:uploadNewsletter` | Rollback Storage delete on Firestore write failure | `.catch(() => {})` | `.catch(e => console.warn('[uploadNewsletter] rollback ...', e))` |

---

## Time-boxed maintenance (deadlines, not bugs)

Scheduled maintenance with real-world deadlines (rescued from the retired `REVIEW_TODO.md`, v15.06).
Not defects — things that must be done *before* a future date.

- **Paycalc period selector ends ~P62 (≈ March 2027).** Before April 2027, extend `TAX_YEARS` +
  `FIRST_OFFSET`/`LAST_OFFSET` + the tax thresholds in `paycalc-calc.js` (documented rollover task)
  so the period selector keeps advancing into 2027/28.
- **Override collection scale.** Define an archival strategy before the `overrides` collection
  reaches ~5000 documents (query cost + client cache size). A watch item — no action needed yet.
- **`MAX_YEAR` 2030 → 2032** before the end of 2028 (update the lunar / bank-holiday data first).
- **2026/27 pay rates** — see "2026/27 pay rates not confirmed" above (update `GRADES` when the award lands).

---

## Whole-app audit — deferred findings (v17.54)

A max-effort adversarial audit (7 parallel subsystem reviews) found **no high/critical bugs** — the
app is well-hardened. Four low-severity defects were fixed in v17.54 (Cloud Functions header coercion;
links new-design concurrency-baseline invariant; calendar `renderCalendarWhenIdle` team-view guard;
`peekNotifState` keyless-subscription check). The findings below were **deliberately not fixed** —
they are latent, owner-territory, or within a documented tolerance. Each is real; none is urgent.

- **Payday/cutoff crossing a year boundary is filed under the wrong year (LATENT).**
  `getPaydaysAndCutoffs(year)` files a payday/cutoff under the unshifted payday's year, but a paired
  cutoff (or a bank-holiday-shifted payday) can fall in the previous December; `isPayday`/`isCutoffDate`
  then look it up under the date's own year and miss it. **Unreachable under `MAX_YEAR = 2030`** (verified
  zero misses 2026–2030) — first bites ~2034. **Fix when extending `MAX_YEAR`** (see Time-boxed
  maintenance above): key each entry under `formatISO(date).slice(0,4)`, or have `_get*Set(year)` also
  pull `year+1`'s first entry when its cutoff lands in `year`.
- **Sync-chip retry has no timeout (LOW UX).** `calendar-initial-fetch.js doRetry()` awaits the fetch
  with no `loadingTimer`/`timeoutTimer`, so on a connection that neither resolves-from-cache nor rejects
  promptly the chip can strand on "↻ Retrying…" with no re-tap affordance (the initial path always
  surfaces a tappable error after 10 s). No data impact; the sync-chip state machine is a documented
  do-not-break invariant, so left as-is.
- **"Active accounts (30 days)" boundary undercount (LOW, analytics-only).** `usage-stats.js`
  suppression length (`> 30 days`, strict) equals the window length, so a single account active only at
  the day-30 boundary can contribute 0 for that span. Never over-counts; matches the documented
  "usage trend, not exact headcount" tolerance.
- **A manually-entered Sunday worked shift is stored as `type:'shift'`, not `'rdw'` (LOW, display-only).**
  The admin week-grid keeps the Shift pill enabled on Sundays; picking it stores `shift` where the
  roster-import path promotes Sunday times to `rdw`. **Pay is identical** (the suggestion engine buckets
  any Sunday-worked minutes at 1.5× regardless); only the calendar badge differs (Early/Late vs 💼 RDW).
  A data-model/display change on a deliberate admin action — owner decision before altering.
- **Roster-import save path has no equal-start/end guard (VERY LOW).** The two manual authoring paths
  reject `s === e` (validates 0 h but pays 24 h via overnight-wrap); `_saveOverrideBatches` does not.
  Implausible from a real roster PDF and visible in the review table before any write.
- **Applying the *estimated* 2026/27 award rate overstates pre-award (Apr–Jul 2026) periods (LOW,
  conditional).** The pending 2026/27 award has no `londonAllowFrom`, so there is no mid-year step:
  clicking "apply estimated rate" prices *all* 2026/27 periods at the estimate, ~£105/period high for
  the pre-payment months, and the back-pay card also counts those arrears. Behind an opt-in,
  explicitly-*estimated* action; self-corrects once the confirmed award's payment date is set on the
  tax year. No clean fix until the award lands.
- **`nameToEmail` collision surface (LOW, theoretical).** Distinct display-name spellings that differ
  only in separators/case collapse to one account email (`"A. Mc Donald"` = `"A. McDonald"`). Not
  exploitable on the current roster; a hygiene hazard for a future compound-surname starter typed two
  ways. Worth a note in the new-starter flow.
