# KNOWN_LIMITATIONS.md — Intentional constraints and deferred work

*Last updated: September 2026 — v22.40 · Updated every 0.10 version*

These are documented decisions, not oversights. Read before filing a bug or suggesting a fix.

---

## A failed deploy is now announced — but the gate can still flake (Aug 2026)

**What happened.** The hosting deploy for v19.94 failed its own `npm run check` gate on **one unit
test out of 1254**, so the workflow exited before deploying. Staff stayed on v19.91 for about two
hours and nothing said so. It was noticed only because the owner compared the Firebase version
against the GitHub Pages mirror — which has no test gate at all and had gone straight to v19.94.

**It was a flake, and that is provable rather than assumed.** `e2e.yml`'s `unit` job and
`deploy-hosting.yml`'s test step run the *identical* `npm run check`. On the same commit the PR's
job passed and the deploy's failed. A re-run of the same code then went green. Locally it would not
reproduce in six runs of the unit suite, nor in three more of the six most timing-dependent suites
under eight CPU spinners.

**The failing test was not identified.** The job log is far too large to retrieve through the API
and its tail contains only passing lines. If this recurs, pull the log promptly — that is the one
chance to name it.

**Frequency:** 1 in the last 30 hosting deploys (746 all-time).

### What the announcement covers, and what it does not

Fixed: the SILENCE. All three deploy workflows now open (or comment on) a `deploy-failure` GitHub
issue via `.github/actions/report-deploy-failure`. Read that action's header for why an issue rather
than email or push.

**And a second silent class, found the hard way (Aug 2026).** The reporter shipped as the deploy
job's own last step under `if: failure()`, with a comment claiming that covered "EVERY step above".
It did — and a step-level guard cannot run when NO step runs. On 14 Aug the rules deploy failed in
`Prepare all required actions` (codeload would not serve a pinned action), so the job died during
setup, every step including the reporter was skipped, and a failed production deploy sat unnoticed
until someone listed the workflow runs by hand. That is the exact outcome the reporter was built to
prevent, reached by a route it could not see. It is now a **separate job** — `needs: deploy` plus a
JOB-level `if: failure()` — which fires whatever kills the deploy, setup included, and it replaces
the in-job step rather than joining it (two reporters would comment twice on one issue). Enforced by
`workflow-hygiene.test.mjs`, which asserts the shape, because the triggering condition is an outage
and cannot be reproduced on demand — which is precisely why the gap survived review the first time.
The irreducible tail: the reporter job still needs `checkout` and the action itself, so an outage
broad enough to take those down takes the reporter with it. Nothing inside a workflow can report
that.

NOT fixed: the flake itself, and deliberately. An automatic retry would have hidden this one, but it
also hands a genuinely intermittent product bug a second chance to reach staff. The gate stays
single-shot; the notification tells you to re-run when the failure is spurious.

**Two properties of the notification worth preserving.** It never fails the job — every command is
`|| echo "::warning::…"`, because it only runs when something has already gone wrong and must not
bury the real error under a second one. And repeated failures COMMENT on the open issue rather than
opening a second: a run of consecutive failures is one situation, and N issues is how a notification
channel teaches its reader to ignore it.

**A deploy failure does not fix itself.** `paths-ignore: '**/*.md'` means a documentation-only commit
will not retry it, so production can stay stale indefinitely until an unrelated change lands.

### The `webkit` job is intermittently red, and it is not a gate (measured Aug 2026, v21.40)

Branch CI has shown a red `webkit` job on most recent pushes while `unit`, `smoke`, `rules` and
`csp` were all green. **It is flake, and unlike the entry above this one is measured rather than
inferred**: `paycalc: backup → restore round trip survives the reload` failed **1 run in 6** locally,
same code, same machine, same command — and it failed on *desktop webkit* locally while CI failed it
on *mobile-safari*, which is a different project each time. Across two CI runs on one commit the
failing sets had **zero overlap**.

**Do not read a red `webkit` as a broken build, and do not read it as nothing either.** The right
check is the one that distinguishes them: compare the failing test NAMES between runs. Different
names ⇒ flake. The same test failing repeatedly ⇒ investigate it, because the engine difference is
exactly what this job exists to catch.

`webkit` is deliberately **not** in `deploy-hosting.yml` — the reasoning is in `e2e.yml`'s own header,
and it is the v19.94 lesson applied: a second engine in the deploy gate lets a WebKit-only flake keep
staff on a stale version. Merging with `webkit` red and the other four green is the designed
behaviour, not a shortcut.

**Both candidate fixes were applied the same day (v21.40), because a job that is usually red teaches
everyone to stop reading it.** The commonest offender — the paycalc backup→restore round trip — was a
genuine race in the TEST (a fixed 1200ms sleep betting on the card's own 800ms self-reload; the log
said so plainly: "Execution context was destroyed") and now waits for the navigation itself. The
residual tail — click timeouts on a slow runner, different tests each run — is covered by
`retries: process.env.CI ? 1 : 0` in `playwright.webkit.mjs` ONLY: an engine difference is
deterministic and still fails both attempts, so the job stays red for exactly the thing it exists to
catch, while a one-off race is reported "flaky" instead of failing the run. The deploy gate keeps its
single-shot rule — the entry above explains why, and nothing here touches it. If `webkit` goes red
NOW, take it seriously: the flake excuse has been spent.

## Security

> **Forward plan:** the deferred security work in this section (per-member write isolation,
> named-session separation, App Check, password retirement, Workload Identity Federation, the
> firebase-admin bump) is sequenced into a phased release with per-phase risk/rollback in
> **`SECURITY_RELEASE_PLAN.md`**. The entries below remain the authoritative *post-mortems and
> rationale*; that file is the *ordering* that keeps a fix from re-creating the v10.94 outage.

### The document FILES are protected by a bearer URL, not by auth
`storage.rules` gates direct Storage SDK reads, but staff never read Huddles/Circulars/Newsletters
that way — they open the permanent tokenised `storageUrl` saved in the Firestore doc, which carries
its own access token and **bypasses the rules entirely** (documented in `storage.rules` itself:
"Don't store confidential files here unless that delivery model changes").

Consequence, stated plainly because no other doc says it: **tightening the Firestore read rules would
not put these documents behind authentication.** It would change who can *discover* a URL; anyone who
has ever held one — a forwarded link, browser history, a synced bookmark — keeps access indefinitely,
and revocation requires rewriting the object, not editing a rule. So the internal operational
documents are the app's least-protected content, and the change everyone reaches for first (a login
on the calendar) does not touch them. Closing this is a delivery-model change — authenticated
`getBlob`, or short-lived signed URLs minted per request — tracked as **`AUTH_PLAN.md` → E6** (§5),
which is independent of the calendar-login decision and can start at any time.

**And there is a second reader nobody authorised.** Word circulars/newsletters open via
`officeViewerUrl`, which passes the storage URL to **Microsoft's Office Online viewer** — Microsoft
fetches the document **server-side**. So (a) these documents already reach a third party today, which is
worth knowing independently of any auth work, and (b) authenticated download would break `.docx`
viewing outright, because Microsoft cannot fetch an auth-gated URL. Any fix has to replace the Word
rendering path at the same time.

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
practice**. What remains open is the **7 management accounts**, which can write any member's
AL/absence/shifts on behalf; a staff account, by contrast, can only write its own overrides (the B3
isolation rule holds), so its blast radius is one person's roster. Chasing those 6 needs no code —
it is 8 people total opening Settings → Password, and it closes the large majority of what is left.
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
all twelve `<meta>` CSPs, and confirm the CI `csp` job (not just local) goes green.

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
CONNECTS to — check the CI csp job after each layer, not just the first. Applied to the `firebase.json` header AND all twelve `<meta>` CSPs
(csp-meta-parity), with `apis.google.com` added to `csp-hygiene.test.mjs`'s `DYNAMIC_HOSTS` (it's
requested by the gstatic SDK, not built in our source).

**Third layer — the beacons we deliberately keep blocked (v18.90).** Once the iframe was allowed to
load and connect, it started firing two fire-and-forget telemetry requests the app does not need:
`www.google.com/images/cleardot.gif` (a 1×1 tracking pixel) and `apis.google.com/js/gen_204`
(Google's logging beacon). These are **correctly refused** — `www.google.com` is in no directive, and
`apis.google.com` is allowed to CONNECT but not to serve images. The problem was the *test*, not the
policy: `e2e/csp.spec.js` asserted zero violations of any kind, so a deliberately-blocked third-party
beacon failed the run. Worse, it only failed *sometimes* — the beacons fire only if the iframe reaches
that state before the spec ends — which is why the `csp` job failed on three unrelated PRs in one day
(#1070/#1078/#1080) while the parallel run of the same commit passed. `IGNORED_BLOCKS` now names those
two URIs, gated by `BEACON_DIRECTIVES` so the waiver applies **only** to `img-src`/`connect-src`
refusals: if `apis.google.com` is ever refused for a `script-src` or `frame-src` load — the v17.82
outage — it still fails. (A live Chromium probe under the Hosting emulator confirmed the `gen_204`
beacon is refused by `img-src`, so the two directives named are the two that can legitimately fire.) **Do not widen the policy to make a beacon pass;** blocking third-party
telemetry is the intended behaviour.

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

**A second header now travels the same way (v19.00).** `X-Robots-Tag: noindex, nofollow` is mirrored
into every page as `<meta name="robots">` for exactly this reason — and here the meta is not merely
the best available option, it is the *only* one: a `robots.txt` is honoured only at an ORIGIN root,
and the mirror lives under `/roster-app/` while `garethdavidmiller.github.io` itself is a different
repo. Enforced by `sw-asset-check.test.mjs` ("every served page carries the noindex meta"). Adding a
new page means adding both metas; both guards will tell you which one you forgot.

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

### A signed-in session lasts 60 days regardless of use (v20.41 + v20.47 — accepted trade)

Two owner decisions, one direction. At **v20.41** the 7-day inactivity cutoff was removed: `SESSION_MS`
(absolute, set once at sign-in) became the only clock, and the `IDLE_MS` constant, the `lastActivity`
timestamp and the write-back inside `getSession()` went with it rather than being left dormant. At
**v20.47** that clock was doubled, **30 days → 60**, on the same reasoning as the removal — the
absolute bound is not what protects an account (below), so its length is a UX dial.

**Existing sessions are not migrated, and no `SESSION_VER` bump was made.** `expiry` is stamped once
at sign-in, so a session created before v20.47 keeps its original 30-day date and picks up the longer
term at its next sign-in. Migrating them would mean writing on read — precisely the behaviour v20.41
removed — and bumping the version would sign every member out, which is the opposite of the intent.
So the change arrives gradually, per member, which is also how it should be reviewed.

**What it makes worse, and what reads FROM this number.** Two things downstream are derived from the
session length rather than owning their own clock, and both get further away as it grows:

- **The forced password migration** (`CONFIG.FORCE_PASSWORD_SET`, PASSWORD_PLAN Track C) is driven by
  sign-ins, so full coverage now takes up to 60 days instead of 30 — the C5 exit metric converges
  half as fast.
- **Operations → Usage, "Accounts that have signed in — last 30 days"** used to be a slight
  *over*-count of active people, because a live session required a sign-in inside 30 days. **That
  inference is now dead and the error runs both ways**: someone can sign in once and use the app
  daily for two months without re-entering the window. The card's visible note already says only
  "counts sign-ins, not opens", which stays true; the reasoning beside `_appendSignInSection` states
  the new direction. Do not restore an active-people claim unless the window is derived from
  `SESSION_MS`.

The iOS ITP window below widens with it too — from about three weeks to about seven.

**What this does not change.** Every path that genuinely REVOKES access is immediate and was never
the idle clock's job: an explicit sign-out (`clearSession`, which signs Firebase out too), a disabled
or deleted Firebase account, revoked credentials, and the `CLAIM_EPOCH` sweep. The **Calendar
viewer** is untouched — it is not a member session, holds no `name` claim, and its persistence is
session-only, so it ends when the browser session does.

**What it does change, stated plainly.** A LEAVER whose device still holds a local session keeps the
signed-in *UI* for up to 60 days instead of up to 7. That was never the control it looked like: the
real remedy is Operations → Set up accounts → "Disable accounts for leavers", and once an account is
disabled the ID token stops refreshing (≤1 hour) and every authenticated read and write fails. The
Admin page independently blocks a signed-in name that is no longer a selectable roster member
(v16.21). So the exposure is bounded by the account disable, not by our localStorage timer — which
is why lengthening the timer is a UX change, not a security one.

**One interaction to expect on iOS, found while reviewing this change.** `decideAccess` grants
`named` only when a live local session is backed by a **restored Firebase identity** — both halves,
because either alone is a real failure (see `calendar-access-core.js`). iOS ITP evicts IndexedDB
after roughly **7 days** of no PWA use, which is where the Firebase identity lives. Until now the
7-day idle cutoff aged out at about the same moment, so the two expired together and the member
simply saw a login. With the cutoff gone, an iPhone user who does not open the app for a fortnight
can hold a valid local session with **no restorable identity** — a state that previously lasted
about a day, became up to three weeks at v20.41, and is up to **seven weeks** at v20.47 now the
session runs 60 days against ITP's unchanged 7.

Since v20.51 (`CONFIG.CALENDAR_PIN_ACCESS: true` — v20.46 released it, v20.50 rolled it back) this is **live behaviour, not a future one**:
that member gets the unlock card instead of their roster, despite being signed in. The
card's "Sign in instead" link resolves it in one step and re-establishes the identity, so it is
recoverable rather than a lockout — but it will generate a support question, it will land on iPhone
users specifically, and it is worth expecting rather than diagnosing. Watch for it in the first week
after the rollout (RECOVERY_RUNBOOK.md → "The Calendar PIN").

**Why removed rather than lengthened.** A policy left in place with no effect is the thing a later
reader "restores" on the assumption it was load-bearing. `session.test.mjs` pins the replacement
properties instead: a long-untouched session inside its window is still valid, a pre-v20.41 session
carrying the old field is accepted and the field ignored (no `SESSION_VER` bump, so nobody is signed
out by this change), a read leaves the stored session byte-identical, and a newly-written session
contains exactly `name`/`ver`/`expiry`.

### Firebase Auth session is re-established on page load (v10.93)
A returning user with a valid 60-day localStorage session skips the login click handler on
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
> lacked — the 7 managers edit staff data on behalf and would otherwise be locked out. B3 (v16.29) then
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
   ran inside the login click handler. A returning user with a valid 60-day localStorage
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
  session could write junk/forged counts (this said "incl. anonymous calendar" until v21.63 — the
  Calendar's anonymous bootstrap went at v20.12, so the writer is now a named or viewer session).
  The rules already validate
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

### The App Speed card's "First appears" cannot mean the roster (v20.80) — inherent

First Contentful Paint is defined by the browser as the first pixel of content, and on the Calendar
that is the **splash** — inline markup in `index.html`. It has never measured the roster and no
change to this app can make it, because the splash is deliberately the first thing painted.

That mattered more than it looks once the v20.12 access gate landed, because the OTHER milestone was
`domReady` and it drifted too: DOMContentLoaded is when the module scripts finish, and the access
decision is asynchronous, so it can fire while the Calendar is still blank. Measured with the auth
restore held at 2s — first paint 512ms, scripts done 669ms, **roster on screen 2630ms**. A card
reading "fully ready in 669ms" was describing a load that took four times that.

v20.80 added a third milestone, **Usable**, marked by the page itself when its own content is on
screen, and relabelled `domReady` to "Code loaded" so nothing claims to be the answer that is not.
What remains inherent:

- **"First appears" is still the splash.** Kept because it is genuinely useful — it is the
  difference between a slow network and a slow app — but it is not "the member can see their
  roster", and reading it as that is the trap this note exists to close.
- **"Usable" is a smaller population.** Only pages that mark the milestone report it: the Calendar,
  and Admin/Operations/Links (which hide their whole shell until they are ready). Settings, the Pay
  Calculator and Overtime render their cards immediately and have no equivalent instant, so their
  cell shows a dash rather than a number. The card says so; the smaller total is not fewer opens.
- **Historic data cannot be backfilled.** The metric starts at v20.80, so a month-over-month
  comparison across that line has no "Usable" figure on the earlier side.

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

### Firebase App Check — declined as an immediate action, RETAINED as Track D (reconciled Aug 2026)

> **⚠️ This section and `SECURITY_RELEASE_PLAN.md` → Track D read as contradicting each other, and
> were written in the SAME COMMIT** (`a7e8bbf`, 16 Jul 2026) — so neither superseded the other; the
> two framings were inconsistent from birth. "Declined" reads as closed; Track D reads as queued.
> **The reconciled position: App Check is NOT closed. It was declined as an immediate action and
> kept in the security plan as Track D, sequenced last.**
>
> The two are compatible once read that way, and Track D directly answers the objection below that
> caused the decline: **monitor-first** (D1 log-only, watch for legitimate-but-unattested traffic,
> register every domain and debug token, then enforce one product at a time) exists precisely
> because the silent-failure risk is real. The third objection stands unchanged in both places —
> App Check gates *which clients* connect, not *what an authenticated client may read*, so it does
> nothing about the world-readable `overrides`. That is Track E's problem, not this one's.
>
> The Aug 2026 external review recommended App Check for the telemetry and reset-request paths,
> which is the same "defence-in-depth, sequenced last" position rather than a new argument.
> **`SECURITY_RELEASE_PLAN.md` → Track D is authoritative for whether and when.** What follows is
> the reasoning for the deferral, which is still the reasoning.

App Check (register the app's hosting domains so only requests from our own pages can reach
Firestore/Storage) was considered as a defence-in-depth measure and **declined as an immediate
action**.

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
Firestore emulator test suite (ROADMAP_HISTORY.md → Maintainability roadmap, Phase 7) — was put **in place** (`firestore.rules.test.mjs`
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

### Pre-fill reads base roster + Firestore overrides only
The "Fill from roster" suggestion counts special-rate shifts (Sat/Sun/BH/RDW/Boxing Day).
Standard weekday contracted hours are not pre-filled — staff enter those manually.
The suggestion is advisory; staff should verify it against their actual payslip.

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
  roster-app repo's own native Pages). **Still live, not retired, and still the origin MOST
  staff use** (owner, Sep 2026) — the move to the canonical URL is gradual by design. Note the
  `/roster-app/` sub-path. It serves no redirects and no HTTP headers, so anything leaning on
  either reaches the minority of users rather than the majority.

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

### The base-roster drift detector is BLIND on a flat pattern — measured 60% coverage (v22.42)

`detectShiftedRow` (`roster-alignment.js`) is described everywhere in this repo as the roster
import's one AI-independent witness, and it is. What no document said is that **its coverage is not
uniform, and for some members it is zero.**

It works by correlating the parsed week against the member's own base pattern at offsets −1/0/+1 and
requiring a ±1 alignment to beat offset 0 by ≥3 matches. That evidence exists only where a week has
SHAPE. On a flat Mon–Fri line — `RD · 09:00–16:00 ×5 · RD` — a one-day shift moves two cells, never
three, so the detector correctly reports nothing. There is no defect to fix here: the signal is
genuinely absent, and lowering the threshold would trade silence for false refusals across the
rotating links where it does work.

**Measured 2 Sep 2026** over every active member across ten consecutive weeks, both shift
directions: **538 of 900 one-day shifts detected, 60%.** Three members were blind in at least 18 of
their 20 sampled cases — **S. Boyle, C. Reen and S. Faure**, all currently on flat fixed lines
(`fixedRoster[1]` and `[2]`). B. Toth's three training weeks were in the same position while he sat
on `fixedRoster[2]`. So the population that is hardest to check by eye — the people whose weeks all
look alike — is exactly the population this layer cannot speak for.

**What still covers them.** The geometry witness (`functions/roster-geometry.js`) is positional, not
pattern-based: it asks whether the PDF's own cell is physically empty, which is as true of a flat
line as of a rotating one. So the fail-closed protection for these members rests entirely on layer
4, and when `geometry.status` comes back `unavailable` they have **no independent check at all** —
which is the case `geometryCopy` now states in the review (v22.40) rather than leaving silent.

**Why it is recorded rather than fixed.** Any fix means either a second pattern-independent witness
or a weaker threshold, and the second is the one that makes the import worse. Worth revisiting if a
flat-line member is ever the one a misread week lands on.

### A blank weekday is safe only while the AI reports it as blank (v22.25) — residual, and it is the geometry programme's case

**What is fixed.** v22.19 established the domain rule from three real rosters — a blank cell is an
ANSWER on Sunday (the uncontracted column; its blank is how the sheet says "not working") and a
QUESTION every other day, because Mon–Sat unworked days are always stated explicitly (RD, AL, SC,
SN, OD, HA, ML, NA). `buildSafeEntries` implements exactly that, and until v22.25 it was **dead
code**: the prompt told the model "a blank cell = RD" in three places, so an obedient model returned
an explicit `"RD"`, the key arrived present and non-empty, and the fail-closed branch never ran.
Reproduced through the real helpers — five physically blank weekdays became five explicit Rest Days
with nothing warning. Found by external review, 1 Sep 2026. The prompt now asks for a `BLANK` token
and forbids the model from interpreting it; `roster-prompt-parity.test.mjs` stops the instruction
coming back.

**What is NOT fixed.** The safety now rests on the model doing as it is told. If it writes `"RD"`
for a physically empty weekday anyway, nothing downstream can distinguish that from a printed RD,
and the day imports as a rest day.

**A cross-check on the column scan was built to close it, and refused.** The obvious hardening is to
ask the other pass: if the column scan saw an empty weekday where the row read printed a rest day,
flag it. It was implemented and the existing fixtures rejected it, correctly. One real CES row scans
as `['blank', '06:00-14:00', 'OFF', 'blank', '07:00-15:00', '-', 'blank']` against a row read of
`OFF` for every one of those days — the scan uses `blank`, `OFF` and `-` **interchangeably for the
same kind of cell, inside one row**. So a scan `blank` is not evidence the cell is physically empty,
and the rule would have flagged ordinary rest days across a whole CES roster. The test that caught
it is named for preventing exactly that flood.

**So the column scan cannot be the independent witness**, and neither can the row read or the Sunday
scan — all three are one model looking at one PDF in one call. The witness this needs is the PDF's
own text geometry, where cell occupancy is a physical fact the model cannot influence. Until that
lands the residual stands, bounded by the review table: every import is shown to an admin first.

**The geometry corpus test is now DONE (1 Sep 2026), and it moved one of the numbers.** 12 real
documents — 3 roster types × 3 week-endings, draft and final — extracted through
`experiments/roster-pdf-geometry`. Zero pages failed to carry the 9-column grid, including the
drafts, so the structural prerequisite for promoting geometry from witness to authority is met. The
domain figures, measured from the PDF's own text positions rather than from any model:

- **blank Sunday: 111 of 207 rows (54%)** — ordinary, as the rule assumes.
- **worked Sunday with no RDW marker: 80, against 1 with** — decisive confirmation that removing the
  v22.16 "unmarked Sunday must be RDW" rule at v22.19 was correct.
- **blank Mon–Sat: 49 cells in 1,242 (3.9%)** — and the DISTRIBUTION is the finding. CEA 1 in 678,
  Supervisors 0 in 240, **Dispatch 48 in 324 (15%) across four people** (S. Horsman 19, S Faure 18,
  P. Prashanthan 6, F. Mohamed 5).

The earlier single-week reading — "5 blank Mon–Sat cells, all one person" — was not wrong, it was
unrepresentative. **The consequence is a live one**: the v22.19 rule was dead code until v22.25 made
it reachable, so nobody has yet seen what it does at volume. On CEA and Supervisors it will send one
cell in 918 to review. On **Dispatch it will be roughly a dozen rows per import on a 14–16 row
roster**, because those four people appear on that sheet and work most of their week elsewhere —
which is precisely the case the rule exists for, since writing RD across them would overwrite what
their primary roster's import had just written. The rule is right; the friction is real and is
mitigated by the v22.17 in-place entry control, which lets each row be answered without leaving the
page. **Worth watching on the first live Dispatch import** — if it proves tiresome, the question to
ask is whether a member whose row is blank Mon–Sat on a SECOND sheet should be skipped wholesale
rather than cell by cell. That is a product decision, not a bug.

**Do not rebuild the cross-check on the column scan.** The reasoning is repeated in
`applyColumnScanCrossCheck`'s own header, beside the code, so it is met by whoever tries.

**The geometry witness is now live (v22.31, `functions/roster-geometry.js`), and it closes PART of
this — say which part.** It refuses any AI day that lands in a physically EMPTY cell, which is the
blank-Sunday collapse in full: a duty slid into an empty Sunday is refused, the cell is UNREADABLE
and the row starts unticked. **It does not close the residual above.** An `RD` written for a
physically empty weekday is exactly the value an empty cell is consistent with, so occupancy cannot
refute it — distinguishing a printed RD from an empty cell from a printed duty means READING the
text, which is phase 3 of the ROADMAP's plan. Nor can it see a shifted row whose week is fully
occupied (nothing empty to contradict; `assessRosterAlignment` stays for that). Both limits are
stated in the module header and pinned by its tests rather than left to be discovered.

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

### `firebase-tools` → `gaxios` dev-only advisory — no clean forward fix (F-DEP-1, reviewed v17.74)

`npm audit` at the root reports a set of advisories that are **all dev-only** and all reachable
through **`firebase-tools`** (root `devDependency`, currently `^15.22.2`). The original and still the
awkward one is a transitive `gaxios` in the **6.4.0 – 6.7.1** range.

**Do not trust a count written down here — run it.** This paragraph said "5 moderate, all one root
cause" from v17.74 until 28 Aug 2026, by which point the real figure was **16 (1 low, 10 moderate,
4 high, 1 critical)** across sixteen packages — `tar`, `brace-expansion`, `fast-uri`, `ip-address`,
`js-yaml`, `hono`, `undici` and others had joined, and "one root cause" had stopped being true. A
transitive dev tree moves on its own, so a number recorded in prose is stale from the day after it is
written.

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

### Links design workspace — accepted constraints (v12.37 onwards)
The Links workspace (`links.html`) no longer carries a beta marker (removed v19.50 — it is the tool
the December 2026 proposals are built in). The constraints below are unchanged by that; they were
never contingent on the beta label, and dropping it does not make any of them go away:

- **The rotation is 24 lines with 4 spare weeks, on evidence class C (v19.98, corrected v20.01/02).**
  The December 2026 link is the CEA/main roster widened from 20 and excludes the bilingual roster
  entirely — not its lines, not its shift times, not its work. All of it is **owner-relayed**
  (Aug 2026), with **no document behind it**; the length was given as 22 at v19.98 and corrected to
  24 at v20.01, and a fifth spare week was added at v20.01 and reverted at v20.02 once the finding
  that motivated it turned out to be a bug (below). That is class C on ROADMAP.md's
  scale — fine for building against, and not something to put in front of an assessing manager as a
  requirement. It is recorded here rather than left implicit because the number shapes every figure
  the tool produces, and "why 24?" is a question a proposal will be asked.

- **~~The docs say the panel covers "24 fatigue factors"; it renders 23~~ — SETTLED at v21.97, and
  the answer was NEITHER NUMBER.** The row said the right fix was "either a 24th factor that was
  never implemented, or a doc that has been saying 24 for no reason", and instructed a reader to
  check the source before changing either. That instruction was correct and unfollowable — the ORR
  site was blocked from this environment — until network egress opened in Aug 2026. The sheet
  (`good-practice-guidelines-fatigue-factors.pdf`, Dec 2021) carries **25 rows in six families**.
  **TWO were missing, not one**, both MRSF rows in the Cumulative family, and one of them matters:
  *"More than 7 consecutive 8h shifts"* is the tightest consecutive-working rule on the page and the
  one most likely to bite a link of eight-hour duties — FF11 allows 13 shifts between 48h breaks and
  this allows 7. The panel had been silent on it since v19.46. The other, *"More than 6 consecutive
  night or early shifts in a permanent pattern"*, is not applicable to a rotating link and now
  renders saying so rather than being absent. Both shipped at v21.97; the reasoning is in
  `links-fatigue.js`'s header. **The general lesson is worth more than the fix: a disagreement
  between two numbers is not settled by picking whichever is easier to change**, and for two years
  the easier one would have been wrong in both directions at once.

- **~~The seeded default trips FF11, and the spare count is why~~ — CAUSE FOUND AND FIXED (v20.02).**
  Recorded at v20.01 as a property of running 5 spare weeks. It was not: the **line-order optimiser
  was clustering the cover weeks**. `generateLink` spreads them evenly (gaps 5, 5, 5, 4, 5 at 24/5)
  and the reorder returned gaps 9, 3, 1, 7, 4 with two ADJACENT, which chain into one long run —
  taking FF11 from **9 to 14** on the generator's own output. The v20.01 measurement across lengths
  22–25 was measuring the bug, not the spare count. `spareSpread` is now charged unconditionally in
  `links-adjacency.js` — at weight **3000**, not the 500 it was first written at, which `variety`
  could still outbid (see `.claude/rules/links-design.md` → the spare spread). On the shipped default
  (24 lines, 4 spare) the cover weeks come back evenly spaced (gaps 6, 6, 6, 6), FF11 at **11** and
  the longest run at **8**.
  **The lesson worth keeping: the reorder can make a design worse than the one it was handed**, and
  before v20.02 nothing in it was watching for that. Every other term is a preference; this one
  protects a guarantee.

- **The run cap cannot always reach its target, and says so** (v20.02; justification re-measured
  v20.03). The "Most shifts in a row" box defaults to 6. With that switch on alone the reorder
  reaches 6; with the full objective set on it reaches **8**, and the generator's status line states
  the achieved figure and names the shortfall rather than letting the box imply a guarantee.
  **The original justification for the weight was partly the spare-spread bug talking** and does not
  survive re-measurement: it said harder weighting takes FF11 from 11 to 14, i.e. that pushing the
  cap makes the design worse on the factor the panel reports. With the cover weeks now held evenly,
  the real trade is **weekends off** — every weight that reaches the 6-day target costs 3–4 full
  weekends across the rotation (9 of 24 at the shipped weight, 5–6 above it), while FF11 bounces
  (11, 11, 9, 16, 9, 10) because the 2-opt lands in different local minima, so no figure there is a
  property of the weight. **This is now an owner decision, not a settled one:** a longest run of 8 is
  well inside the 13-day company limit, and three more full weekends is something staff feel — but
  which way that goes is a judgement about conditions, so it is recorded here rather than tuned in
  code. Raising the weight is a one-line change if the answer is the other way.

- **Designs saved against the OLD 28-line rotation are left exactly as they are.** They still load,
  render their first 24 rows, are analysed over 24 — and, because the working copy deep-copies the
  whole patterns object, **save all 28 back**. Nothing trims them, deliberately: doing it on load
  would destroy six lines of somebody's work on a page visit (the v19.84 stale-hard-delete class),
  and doing it on save would do it at the moment they least expect it. `#linksOverLengthNotice`
  states the two lengths and that the surplus rows are neither shown nor counted but are still
  stored. **Binning them is the owner's call**, and until it is made a designer can open one and
  work on a proposal that describes a link nobody is building.

- **The fatigue-factor panel is an AID, not a fatigue risk assessment (v19.46).** This is the
  limitation that matters most on this page, because the failure mode is not a wrong number — it is
  a design showing few findings and being read as approved. The panel reports which of the ORR's p3
  factors are *present*; the ORR is explicit these are not prescriptive limits, and the escalation
  it defines (justify why the factor cannot be avoided, minimise it, then assess and control the
  residual risk) is a human process the panel feeds and does not perform. Specifically:
  - **Three definitions are not settled** — FF17 (is "backward rotation" about individual steps or
    the cycle's net direction?), FF19 (are start-time jumps counted across rest days?) and FF18
    ("a rotating pattern of about a week"). They render as "(definition to confirm)" and the numbers
    should not be quoted without settling them. **FF18's framing here was wrong until v19.60** and is
    worth stating properly: this doc used to call it unavoidable because a rotating link moves everyone
    one line a week by construction. That reads the factor as being about the weekly *cadence*, when
    the concern is the **size of the step** — a rotation whose consecutive lines sit close together
    asks far less of the body clock than one where they do not. The cadence is fixed; the step is a
    design choice, is measured by `links-adjacency.js`, and the generator can tune for it. **FF18's
    row now reads from that measurement** (v19.69) — it had reported a hardcoded `standing` since
    v19.46, breaking the module's own "never hardcode a status" rule for the second time (FF13 was
    the first, v19.48). It states the typical weekly move, the largest, and how many line boundaries
    exceed two hours; the live main roster measures 4h 0m typical / 8h 46m worst / 9 of 20 over.
    The status stays `standing` when the step is measurable — the ORR gives no threshold for FF18,
    so promoting it to `present` above some figure would invent the pass/fail this panel forbids —
    and derives to `n/a` for a design with no timed lines, which is the branch a hardcoded status
    could not express.
  - **Every hours figure is a FLOOR.** SPARE days carry no times, so a standby day contributes zero
    to "hours in any 7 days". The real total is higher; the panel says so on the row (it did **not**
    until v19.59 — `hoursAreFloor` had been returned "so the UI can say so" since v19.46 and nothing
    read it, so this line described an app that did not exist).
  - **Coverage is not completeness.** The factors the panel asserts as not-applicable are the
    night-shift family, and that rests on CEAs working no nights. It flips to live the moment any
    duty reaches 00:00–05:00 — but the p3 list is a good-practice summary, not the whole of fatigue
    risk, and nothing here models workload, commute, or individual circumstance.
  - **The baseline is measured on the MAIN cycle at its own length** (main-only since v19.98).
    "Today's link" is computed over `weeklyRoster` (20 lines) — the rotation the new design
    replaces. The bilingual row was dropped rather than left as an unexplained gap: the panel's
    summary now names the comparator ("the main 20-line cycle, which this 24-line design replaces"),
    because a missing row reads as an oversight. The underlying rule survives and still binds any
    future pairing: splicing two unrelated rotations end to end reports a longest run of 19 that
    belongs to the join rather than to either roster, so a design's figures only mean anything once
    its lines genuinely are one rotation.

- **The generator's objectives genuinely conflict, and no default is right for everyone** (v19.60).
  Line ORDER is one scarce resource with several claims on it, and two of them are direct opposites:
  `gentle` minimises the week-to-week change, and taken to its limit that IS a long block of the same
  shift — the smallest possible step is no step at all. `variety` caps the block length. Shipped with
  both on and variety weighted as a constraint, which lands on the live roster's own figure (longest
  block 3) while keeping the step at ~1h35. **Turning variety off gives blocks of 8+**, which is what
  the tool did between v19.59 and v19.60 and is the shape the owner rejected as "excessive and
  unpopular". The switches are the honest answer, not a better formula: the trade is real and the
  designer should be the one making it.
- **Interleaving the waves inside the generator is a WON'T-DO, measured** (v19.60). It fixes the
  block length in the raw output (11 → 2) but puts a late wave's 23:55 Saturday beside a morning
  wave's 06:20 Sunday — a 6h25 turnaround the construction was free of — and constrains the reorder
  into two fewer long weekends for no gain, since both routes reach a longest block of 3. The
  generator owns the SHAPE, `links-adjacency.js` owns the ORDER. A test fails if the interleave
  returns.

- **The hard-limit check is a WORST CASE on a design, and it enforces nothing** (v19.80;
  re-sourced v19.90, re-tensed v19.96). 13 consecutive worked days is **Chiltern's roster limit**,
  carried in company policy; its origin is the working-hours standard the industry adopted after the
  **Hidden report** into the Clapham Junction crash of 1988, and that standard was itself withdrawn
  in 2007 — so the row cites Hidden as an origin, never as a current industry requirement. It is not
  legislation. Unlike the ORR factors beside it, this one does pass or
  fail, renders red on a breach, and shows whether it passes or fails rather than collapsing behind
  the quiet-rows disclosure. Three things it does not do:
  - **It measures the LINK, not a person's actual roster.** A design is a pattern; what somebody
    ends up working is that pattern plus overtime, RDW, cover and swaps, none of which this page
    can see. A design that passes here can still produce a breach once real weeks are built on it.
  - **The answer is the worst case, which is a ceiling and not a prediction.** A spare week is four
    duties whose placement the roster clerk chooses week by week, so the figure is what the link
    *permits*. That is the right question for a hard limit — if any placement reaches 14 the link
    allows a breach — but it means the number is usually higher than what anyone works, and it must
    not be quoted as "our people do 9 days in a row".
  - **It rests on a spare week being four duties** (owner, Aug 2026). If that ever changes — a
    different cover model, or a link where spare weeks routinely carry a fifth day — every figure
    here moves and `SPARE_WORKED_DAYS` has to move with it.

  **This section previously described a breach that did not exist.** Until v19.79 both run checks
  counted a spare week as SEVEN worked days, which fused the blocks either side of it: the main
  cycle reported 15 consecutive days and the bilingual 14, against true ceilings of 9 and 8. The
  comment justifying it said over-reporting was "the safe direction for a fatigue check". It is not,
  once a number has a hard limit under it — a tool that cries breach on the roster people are
  actually working teaches its readers to discount the row, and the next design that genuinely does
  breach is hidden by that discount.

- **The GRID's header is fixed from 768px up** (v19.77) — it had been broken to 1024px, and the band
  between was costing the sticky header for nothing. Measured: the wrapper's content fits its box at
  768/834/900/1000 (684/684, 720/720, …), so `overflow-x: auto` was making it a scroll container with
  nothing to scroll, and `position: sticky` resolves against the nearest scroll container. That band
  includes **iPad portrait**, the device this workspace's own first-visit notice recommends. Moving
  the breakpoint to 768 fixed it with no nested scrolling, no desktop change, and no baseline moving.
  **Below 768 it stays broken, deliberately** — see the next entry.
- **The generator and the grid lose their column headers on a PHONE** (measured v19.67, recorded
  here in the v19.70 sweep). Both tables sit in an `overflow-x: auto` wrapper below their breakpoint
  so the table can scroll inside the card — and per spec, when one overflow axis is not `visible`
  the other computes to `auto` too. The wrapper therefore becomes a vertical scroll container as
  tall as its own content, and a `position: sticky` header sticks to a box that never scrolls. The
  declaration is present and inert. **Do not "fix" it with `overflow-y: visible`** — that is the
  exact declaration the spec overrides, so it would read as correct and change nothing.
  Measured at 390×844: the grid is **43% off-screen horizontally** (592px of table in a 338px
  wrapper) with no LINE/SUN/MON header on screen for most of the scroll, so neither a label nor a
  countable column position tells you which day you are editing; the generator's SUN column and the
  footer totals clip the same way. The sticky save row takes **146px of an 844px viewport (17%)**
  and the brush bar **239px**.
  **Accepted rather than fixed**, on three grounds: the workspace's own first-visit notice says
  *"Best used on a desktop or tablet; the grid is tight on a phone"*; a tablet at ≥768px
  gets the working desktop layout, so this is phone-only; and the plan explicitly defers redesigning
  the target table until package 4, so rebuilding it for mobile now means doing it twice. The real
  fix is a `max-height` and therefore a nested scrollbox around the primary creation path — a UX
  decision, not a tidy-up. Both facts are pinned by an e2e that runs at both widths.
- **Firefox keyboard editing commits early.** Firefox fires `change` on every
  arrow-key press inside a focused `<select>`, so keyboard-only editing of a shift
  cell commits on the first arrow instead of on Enter. Chrome/Safari (all staff
  devices) behave correctly. Escape cancels cleanly in all browsers.
- **Coverage heat map counts pattern positions, not a named headcount.** Every position in the
  rotation is counted, including any line not yet designed. Staff names were removed
  at v12.39 — the design is patterns-only — so there is no distinction between named
  and unnamed positions. The heat map colour scale is relative to the week's own peak,
  so a lightly staffed day naturally shows cooler colours.
- **EVERY line rotates and must be filled (v12.42).** Two earlier models were both
  dropped: "lines 23–27 are vacant placeholders" (`VACANT_FROM`, removed v12.41) and
  "the last line is C. Reen's fixed link" (`FIXED_POS` + a separator row + non-editable
  cells, removed v12.42). In a rotating link everyone passes through every line, so an
  all-rest line is an *unfinished* line, not a vacancy — the link can't be authorised
  then re-cut each time a post is filled. The link is designed as a full rotation so it
  survives staff changes; C. Reen's adjusted fixed shifts are handled as overrides on
  the base roster, not in this designer. A Design-checks row and amber grid marker
  (`.row-unfilled`) flag any unfilled line until it is designed. The auto-generator
  reads Mon–Fri/Sat/Sun headcount targets and produces a complete rotation in one step;
  it is **no longer the only way in** — "Start with a blank grid" (`#linksEmptyNew`) and
  the importer (`links-import.js`) both create a design without it.
- **The rotation LENGTH is hardcoded by design.** `ROTATING_LINES` reflects the agreed
  link concept — deliberately not derived from roster data. If the link concept changes,
  the constant changes with it. Since **v19.38 it is declared once**, in
  `links-design.js`, and imported: it was previously a literal in three files kept in step
  by a comment. **Do not write the number down here** — it was 28, then 22, then 24, and
  four entries in this section were still saying 28 at v21.62 while two others said 24;
  `links-rotation-parity.test.mjs` fails on a literal in prose for exactly that reason.
- **Save concurrency is warn-on-conflict, not merge.** Two designers saving at
  once get a confirm naming who saved last; the whole document is still replaced.
  A field-level merge is not worth the complexity for a small design tool. Declining the
  overwrite now offers **"Save mine as new"** (v19.38), so the loser of a race has somewhere
  to put their work instead of choosing between discarding it and clobbering a colleague.
  The concurrency RULES themselves are the pure `links-concurrency.js` (v19.38), tested with
  a case per historical bug — three separate silent-overwrite bugs came out of that logic
  while it was inline in the coordinator.
- **The 13-day hard limit has no document citation yet, and the panel now SAYS so** (v19.96 →
  v20.08, external review P1 twice). Until v20.08 the Links Design-checks panel printed, in red on a
  sheet that goes to an assessing manager, that a design breaching 13 consecutive worked days
  "cannot be run as drawn", under a heading reading "must be met". ROADMAP.md's own evidence gate
  requires class A or B for exactly that phrase and this limit is class **C** — the owner's account
  of practice — so the app was breaking its own rule in the loudest place it has.
  **The number, the separation and the red are unchanged; only the CLAIM was demoted.** The heading
  reads "Configured Chiltern limit — policy source outstanding", and the row reports the measurement
  plus what to go and check instead of the verdict. `POLICY_SOURCE_CONFIRMED` in `links-limits.js`
  is the single home of that judgement — the heading, the row's `basis` and its prose are all
  derived from it, and tests in both files fail in BOTH directions, so **the day the citation
  arrives is a test failure rather than a forgotten edit**. To close this: get the policy reference,
  put it in `CONFIRMED_BASIS`, flip the flag, run `npm test`.
  The limit itself is Chiltern's roster limit
  (owner, Aug 2026), historically derived from the working-hours standard the industry adopted after
  the Hidden report into Clapham Junction — **and that standard was withdrawn in 2007**, so the row
  must cite Hidden as an origin and never as a current industry requirement. It did the latter from
  v19.90 to v19.95, under the heading "Industry limits · Hidden report — must be met"; the tense is
  now pinned by tests in three places, including the rendered heading, which had none.
  **What is still missing is the policy itself:** title, clause, which staff group it covers, and its
  effective/review date. The evidence contract in `links-limits.test.mjs` will then be checking a
  real citation rather than a plausible one.
  Related: the other limits in that family (max turn length, minimum rest between turns, the weekly
  ceiling) are ALREADY COMPUTED and rendered as advisory ORR rows — promoting them is a rendering
  change plus the confirmed figures. Do not do it from recall; see `.claude/rules/links-design.md`.
- **Delete is a SOFT delete (v19.41).** A deleted design carries `deletedAt`/`deletedBy`, drops
  out of the picker, and is restorable from "🗑 Recently deleted" **until somebody removes it by
  hand** — automatic expiry was suspended at v19.86 (external review P2). `isPurgeable` fails closed
  on an unresolved or FUTURE `deletedAt`, but no client-side age check can defend against a device
  clock running more than 30 days FAST: every recent deletion then looks expired, the purge
  transaction re-checks with the same wrong local time and agrees, and a colleague's design is
  destroyed. The bin exists so that a delete is recoverable, so a path that can silently empty it
  early defeats the feature it belongs to. The cost is a bin that grows; with three designers that
  is nothing against losing somebody's work to a wrong clock. Expiry returns when it can be
  computed from SERVER time (a scheduled Cloud Function) — `_purgeExpiredDeletions` is kept,
  unwired, because its transactional re-check is the part worth keeping.

  **And the UI went on promising the expiry for ten more versions** (fixed v19.96, external review
  P2). Suspending the purge left `deletedLabel` still appending "· removed for good in N days" to
  every row, and the delete confirm and the tips still saying 30 days — while the bin's own intro
  line, two inches above the rows, correctly read "Nothing is deleted automatically". One dialog,
  two mutually exclusive explanations. The behaviour was SAFER than the promise, so nothing was
  lost; what was damaged is the reason to believe the next thing the panel says, and a designer
  who took the countdown seriously might have hurried or written the work off. `daysLeft` and
  `SOFT_DELETE_RETENTION_DAYS` are now explicitly DORMANT and must not drive visible copy again
  until the age comes from the server.

## Overtime Availability — accepted gaps (v20.56 onwards)

Design: `OVERTIME_AVAILABILITY.md`. Operating: OPERATIONS_REFERENCE.md. These are the things the
feature deliberately does NOT do yet, so that a reader stops looking for them.

- **No expiry purge.** Windows past `retentionUntil` (13 weeks) are filtered out of both read
  endpoints, so they are invisible and inert — but the documents stay in Firestore. Enforcement is
  in the endpoints on purpose: **rules are not filters**, and a `resource.data` condition would fail
  a reviewer's whole query rather than drop one row. The deadline for actually deleting them is in
  MAINTENANCE_CALENDAR.md, which is where work with a date lives.

- **~~No reminders.~~ The MEMBER half shipped at v21.47; the reviewer half has not.** Two targeted
  push notices now go out on their own — *you have been asked* when a window starts asking somebody,
  and *answers due today* on the morning of the initial deadline to participants who have submitted
  nothing. Both are addressed to resolved member uids and never fan out. What has NOT changed is the
  reviewer's side: nothing tells a clerk who is outstanding, so the *Awaiting a form* list and the
  **No response** section are still the only answer to that question — which is still why they must
  never merge into "not available". Operating detail: OPERATIONS_REFERENCE.md → "Nobody is asked
  silently any more".

- **~~The page does not re-read state while it sits open.~~ WIRED at v20.78.** `visibilitychange`
  now resyncs against the server when `shouldResyncClock` says a deadline is near, one read at a
  time. Recorded here rather than deleted because the entry said the opposite for ten releases, and
  a limitation that has been fixed is a worse doc than one that was never written.

- **The reviewer's workspace is a SNAPSHOT, not a live feed (v21.48).** It states its own age, offers
  a Refresh, and re-reads when the tab becomes visible (debounced to a minute) — but it does not
  listen, so an answer arriving while a clerk watches the page does not appear on its own. That is a
  cost decision, not an oversight: a Firestore listener costs a read per arriving revision for every
  open workspace, which a restricted beta cannot justify. The signal that would change it is in
  `OVERTIME_AVAILABILITY.md` → "evidence to gather during the beta".

- **Deleting an AL doc destroys the swap evidence it carried (v21.56, external sweep).** An AL
  written over a swapped-in day is the only surviving record of the swap (`replacedType` — the
  `shift` doc itself was deleted by the booking). Cancelling that leave via Saved Changes or the
  period delete removes the AL doc, and with it the record: the day reverts to base REST, and leave
  re-booked on it later would charge nothing. Not coded around, deliberately: the same deletion
  makes the calendar visibly WRONG (the member is contracted to work a day now showing Rest), so
  the manager's natural next action — re-recording the shift — restores both the display and the
  evidence in one step. Restoring it automatically is impossible anyway: the shift's TIME was never
  preserved, only its type. If a cancelled-leave-on-swapped-day case ever recurs without the
  re-record, that is the signal to store more than the type.

- **Restricted audience — TWO lists, not one (v20.76).** `currentAudience()` returns `'restricted'`,
  which selects eligible members holding the server-owned **admin** entitlement **or** named in
  `overtimeBeta`. Reviewing and participating are different things: a manager reviews without
  submitting, a beta tester submits without reviewing. Widening it is one edit in
  `CONFIG.OVERTIME_BETA` plus `npm run generate:roster-members` — the server reads its own copy, so
  an un-regenerated list gives somebody a page with no form on it.

- **An open window's population can GROW — and only before its first deadline (v20.78, corrected
  v20.81).** Populations are still frozen against removal and against late addition, but automatic
  creation made "existing windows never change" mean "an invitation never takes effect": by the time
  anybody is invited, every week they could usefully answer already exists. So the nightly scheduler
  tops up windows that are still in `INITIAL_OPEN`.
  **Not every open window** — that was the v20.78 rule and it was half a deadline out (external
  review, Aug 2026). Somebody added between the two deadlines is reported as **No response** for a
  deadline that pre-dates their invitation, and the moment they submit `deriveHistory` labels them
  **submitted after the initial deadline**. Both describe a person who was asked and did not answer.
  The remedy is the phase, not a kinder label: they join from the next week whose first deadline is
  still ahead of them.

- **Name-keyed documents.** Participants and submissions are keyed by canonical member name for
  legibility. A rename would orphan them; the participant `uid`, stamped on first submission, is the
  recovery route. Nothing reads it today.

### Test coverage gaps
The suite is now broad (see CLAUDE.md's file tree for the
full per-suite listing, which `doc-parity.test.mjs` keeps complete; nearly every pure module has a companion `.test.mjs`, the exceptions
being trivial data/formatter modules like `paycalc-help.js` and
`roster-cycle-data.js`). What matters here is what is **still not** covered:

**Closed v16.32–16.33:** the push-notification state machine + subscribe/unsubscribe flow
(`notif.test.mjs` — Push APIs stubbed on globalThis), the `setupRosterAuth` (B4) decision
logic (extracted to `functions/roster-parse-helpers.js` and unit-tested: `parseSetupActionFlags`,
`resolveRosterAuthConfig`, `claimsForTier`, `computeOrphanLabels`), and the `isSafeStorageUrl`
download-URL allowlist (extracted to `storage-utils.js` + `storage-utils.test.mjs`).

**Closed for Overtime v20.56, for account administration v21.83–85:** the Cloud Function HTTP
*handlers* end-to-end. `overtime-endpoints.test.mjs` executes the five Overtime handlers, and
`auth-endpoints.test.mjs` now executes `requestPasswordReset`, `resetMemberPassword` and
`setupRosterAuth` — each against a fake Firestore, a fake Auth and a recording push transport. That
is what the entry below said needed firebase-admin mocking; it turned out to need a fake, not a
mock. The lesson that produced it is worth keeping: a surface test proves the handlers were DEFINED,
not that any of them works, and the Calendar PIN outage was a mint path that had never once run in
production.

**Still not covered at handler level**, in the order they are worth doing:
- **`getSignInStats`** — the one Auth handler left. Deliberately last: it is a READ, it returns four
  integers and no identity, and its aggregation is already pinned by `summariseSignIns`.
- ~~**The Documents domain**~~ — **CLOSED v22.02.** `documents-endpoints.test.mjs` executes
  `ingestHuddle`, the three `onDocumentCreated` triggers and the scheduled pay reminder against a
  fake Firestore, a fake Storage and a recording transport, organised by cost: a DOUBLE push (both
  halves of the guard — the atomic create-vs-resend transaction and the trigger's power-automate
  skip), a SILENT non-push, and a write that should not exist. Teeth-verified by six mutations.
  This entry said the DECISION to send was what remained untested; it is now the covered part.

Also still untested: the coordinator wiring in `calendar-app.js` / `admin-app.js` (the extracted
`calendar-renderer.js` / `calendar-*` state modules have unit tests; the coordinators themselves do
not — e2e covers their page-load) and the Firestore read/write layer in the page modules (behind the
gstatic-CDN import). Before adding new untested behaviour in these modules, consider whether a unit
or integration test can be added first.

### Legacy override types still in Firestore
Types `"allocated"`, `"overtime"`, `"swap"` are no longer creatable via the UI but
exist in older Firestore documents. They are displayed with their original labels in
Saved Changes. Editing them re-saves as `"shift"`.

The pay suggestion engine (`getRosterSuggestion` in `paycalc-roster-suggestions.js`)
reads the `type` field to classify shifts. Legacy types are treated as plain `"shift"`
overrides — they will not be miscounted, but any overtime/RDW semantics the original
type implied are lost. Clean up legacy documents in the Firebase Console to replace
them with the correct current types if the pay suggestion is producing wrong results.

## Error Log noise filters (v19.20)

Not every uncaught error is a fault in this app. Six classes are suppressed before the Firestore
write, by the pure `shouldReport` in `client-errors.js`: the opaque cross-origin `Script error.`,
browser-extension URL schemes, `ResizeObserver loop`, the skipped declarative view transition, a
service-worker background-update failure **when accompanied by a network phrase**, and **WebKit's
IndexedDB teardown messages when they come from the SDK origin**.

That last one came from a staff report on an iPhone (iOS 18.7 / Safari 26.5, v19.19):

    Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.
        getObjectStore@…/firebase-auth.js
        _withRetries@…/firebase-auth.js

Firebase Auth's `indexedDBLocalPersistence` POLLS its object store, because Safari's storage events
are unreliable across tabs. WebKit closes IndexedDB connections whenever it suspends or reclaims a
page — backgrounding the PWA, screen lock, the app switcher, memory pressure — so a poll landing in
that window throws from deep inside the SDK with no app frame on the stack. Firebase wraps the call
in `_withRetries` precisely because it expects this; when the retries are spent the rejection
escapes to our reporter. The identity is already restored by then, Firestore uses a SEPARATE
database (so calendar data is untouched, and since v19.01 the calendar paints from cache with no
auth at all), and the connection reopens on the next foreground. Harmless and self-healing — but it
recurs on every iPhone, and the Error Log is only worth reading if it is mostly signal.

**Scoped to the SDK origin deliberately.** The same phrases from our own origin would mean the
Firestore persistent cache is failing, which is a real fault worth seeing, so those still log. The
list is exact phrases, never a loose `Database` substring — a version conflict or a quota failure is
a genuine problem that happens to involve the same API call.

**Do not add a filter without a test on BOTH sides.** The failure directions are not symmetric: too
narrow leaves noise you can see and complain about, too broad silently swallows real errors and the
log looks healthy *because* it is broken. `error-reporter.test.mjs` pins each rule against the thing
it must suppress AND the neighbouring real error it must not.

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

## Time-boxed maintenance (deadlines, not bugs)

> **MOVED to `MAINTENANCE_CALENDAR.md` (v19.97).** Every dated obligation now lives there, with a
> **warning point earlier than its deadline** — "must be done by 6 April" reliably becomes "started
> on 4 April", and this section had no warning dates at all. It also sat at line ~1,130 of a
> 1,190-line file about *defects*, which is not where anyone looks for a tax-year rollover.
>
> Not duplicated here. This section is a signpost so a reader arriving from a code comment or an
> old link still finds the work.

What is over there: the **2027/28 paycalc rollover** (hard deadline 6 Apr 2027, warning Feb 2027 —
the period selector runs out at ≈ P62 and does not warn, it simply stops offering periods),
**`MAX_YEAR` 2030 → 2032** (end 2028, lunar/bank-holiday data first), the **override-count archive
trigger** (design at ~4,000, must land before ~5,000), the recurring guide and pay-threshold source
reviews, and the **after-every-new-starter** checks — including the work email, which since v19.30
nothing prompts for.

The one item that stayed here as a *constraint* rather than a date — **2026/27 pay rates** — is
**closed**: the award was payslip-confirmed on 28 Aug 2026 and is shipped. See "2026/27 pay
rates — ✅ CONFIRMED AND SHIPPED" above, and `MAINTENANCE_CALENDAR.md` for the recurring
read-the-payslip instruction that replaced it.

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
- **~~A manually-entered Sunday worked shift is stored as `type:'shift'`, not `'rdw'`~~ — FIXED; the
  Shift pill is DISABLED on Sunday rows** (`admin-week-editor.js`, and layer 6 of the Sunday rule in
  CLAUDE.md). Struck through rather than deleted because this entry was wrong in a way worth naming:
  it called the gap "display-only", and the code comment that closed it says the opposite — a Sunday
  saved as `shift` rendered as an ordinary worked badge and **the pay calculator's Sunday-overtime
  pre-fill missed it, under-counting pay**. An entry that under-rates its own severity is how a real
  defect stays parked as an accepted limitation.
- **~~Roster-import save path has no equal-start/end guard~~ — CLOSED at v20.39, and this row outlived
  the fix by more than a hundred versions.** It said `_saveOverrideBatches` did not reject `s === e`
  while the two manual paths did. It does: the refusal is at `admin-roster-upload.js:153`, logged
  and unwritten, with the parse-side reasoning in `functions/roster-parse-helpers.js` — a
  zero-length range reads as TWENTY-FOUR HOURS through the overnight wrap, and it reaches pay.
  Found by an external review reading the code against this file, which is the only way a stale
  "we don't do X" is ever caught: nothing fails when a limitation is fixed, so the entry simply sits
  here being believed.
- **~~Applying the *estimated* 2026/27 award rate overstates pre-award (Apr–Jul 2026) periods~~ —
  CLOSED, and it self-corrected exactly as written.** The entry said "no clean fix until the award
  lands"; the award landed, `londonAllowFrom` is set to 28 Aug 2026 on the 2026/27 row
  (`paycalc-calc.js`), and the `rateUnconfirmed` flag that gates the whole estimated-rate path is
  gone — so the mechanism cannot fire. It sat here contradicting this file's own "2026/27 pay
  rates — ✅ CONFIRMED AND SHIPPED" section 840 lines above it.
- **`nameToEmail` collision surface (LOW, theoretical).** Distinct display-name spellings that differ
  only in separators/case collapse to one account email (`"A. Mc Donald"` = `"A. McDonald"`). Not
  exploitable on the current roster; a hygiene hazard for a future compound-surname starter typed two
  ways. Worth a note in the new-starter flow.
