# KNOWN_LIMITATIONS.md — Intentional constraints and deferred work

*Last updated: June 2026 — v13.00 · Updated every 0.10 version*

These are documented decisions, not oversights. Read before filing a bug or suggesting a fix.

---

## Security

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
`app.js`. See the June 2026 conversation for the full trade-off analysis.

### Huddle Firestore writes restricted to admin (v11.07)
`firestore.rules` now requires `request.auth.token.admin == true` for all browser
create/update/delete on the `huddles` collection. Prior to v11.07, any signed-in staff
member could alter huddle metadata (storageUrl, fileType, htmlContent) even though
Storage rules prevented them from uploading files. The two rules now match: both Storage
and Firestore require admin claim for huddle writes. Cloud Function writes via Admin SDK
bypass rules and are unaffected.

### faithCalendar field stores a personal religious preference (GDPR note)
The `faithCalendar` field in `memberSettings/{memberName}` stores the staff member's
chosen cultural calendar (e.g. `'islamic'`, `'hindu'`). This is a personal religious/
cultural preference and constitutes special-category personal data under UK GDPR Article 9.
Current mitigations: Firestore rules require `request.auth != null` for all reads and
writes; only the member themselves can write their own setting. No additional retention
policy or right-to-erasure flow has been implemented — `allow delete: if request.auth != null`
in `firestore.rules` covers self-deletion. If this data is ever exported or shared beyond
the app, a DPIA should be completed.

### CSP connect-src includes firebasestorage.googleapis.com (v11.07)
Firebase Storage browser uploads (manual Huddle upload in Operations) use
`firebasestorage.googleapis.com`. This was implicitly covered by `https://*.googleapis.com`
but is now also listed explicitly in `connect-src` in `firebase.json` for clarity.
Both `connect-src` and `img-src` explicitly list `https://firebasestorage.googleapis.com`.

### localStorage session can be forged for UI access (#14)
The `myb_admin_session` localStorage session can be modified via DevTools to
impersonate another user or gain the admin UI. Since v7.94, Firestore security
rules are deployed and require a real Firebase Auth session for all writes — so a
forged localStorage session can see the UI but cannot write to Firestore.
Practical risk is low for a small known team.

### Firebase Auth session is re-established on page load (v10.93)
A returning user with a valid 30-day localStorage session skips the login click handler on
every subsequent open, which would leave `auth.currentUser` null and break all Firestore
writes. Fixed in v10.93 by `ensureFirebaseSession()`, which runs on page load whenever a
localStorage session exists (waits for `onAuthStateChanged`, signs in if none found,
self-heals a missing account). Full description and the "do not remove this call" rule:
**CLAUDE.md → "Firebase Auth (complete — v7.94)"**.

### ⏰ The four v11 security tasks — current status

Originally pencilled in for v10.50, deferred to v11. Status as of v11.39:
**#1 done** (with a critical allowlist caveat — see below) · **#2 suspended** (caused a
production outage) · **#3 done** · **#4 awaiting verification on a real payday**.

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

**2. Firestore security rules — member write isolation ⚠️ SUSPENDED (v10.94)**
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

**To re-introduce (deferred to a future version):**
- Confirm `setupRosterAuth` reliably sets `name` claims for all staff (v10.88 fixed this)
- Confirm page-load Firebase Auth session is reliably established (v10.93 fixed this)
- Re-add the per-member claim checks to `firestore.rules`
- Deploy rules and run "Set up accounts" to ensure all tokens carry the claim
- Test that every staff member can write their own overrides before deploying to prod

**3. Back pay HPP — check variable pay split against a payslip**
Back pay covers both basic pay/London Allowance (no HPP) and variable components
(overtime, RDW, Sundays — which do accrue HPP). The calculator adds the full lump sum
to gross for take-home but does not include any of it in the HPP accumulator, so the
HPP estimate will be slightly low after a back pay event.
**✓ DONE (v10.73):** Confirmed from G. Miller's period 32 (Oct 2025) payslip — Chiltern
itemises each back pay line with an explicit `(Back Pay)` suffix per category (Basic Pay,
Overtime 1.25, RDW 1.25, RDW Sun 1.5, Bank Holiday Rostered 1.25, etc.). No new UI field
was needed — `calcBackPay()` already iterates saved period data by category, so
`_bpVarAmount` is computed automatically. `calcHPP()` now adds `_bpVarAmount` to
`totalVar` for the paid-in period so the HPP estimate is correct after a back pay event.

**4. Pay reminder push notification — infrastructure fixed May 2026 ✓ AWAITING LIVE VERIFICATION**
`sendPayReminderNotification` did not fire on 30 May 2026 because the Cloud Scheduler job
had never been created. Root causes (both fixed in May 2026):
- The `FIREBASE_SERVICE_ACCOUNT` lacked `roles/cloudscheduler.admin` — deployment failed
  silently trying to manage the scheduler job.
- A stale `us-central1` deployment record blocked redeployment (the function had initially
  deployed to us-central1 before the region was set to `europe-west2`). Deleted manually
  from Firebase Console, then redeployed cleanly.
The Cloud Scheduler job `firebase-schedule-sendPayReminderNotification-europe-west2` now
exists. A force-run on 31 May confirmed the function executes and correctly skips on
non-cutoff days (`[payReminder] Not a cutoff date — skipping`).
**Next live test: Saturday 27 June 2026** (cutoff for the 3 Jul payday). If the notification
arrives, mark this done. If not, check Firebase Console → Functions → Logs for that date.

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

### Back pay lump sum — HPP now included (v10.73)
Resolved — `calcBackPay()` computes the variable-pay portion (`_bpVarAmount`) and
`calcHPP()` folds it into the HPP estimate for the paid-in period. See task #3 above for the
payslip confirmation detail.

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

---

## Calendar / roster

### Team View summary chips — considered and declined (v11.85)
A summary chip strip showing aggregate counts per week (e.g. "Working 10 · AL 2 · RDW 1")
was considered for Team View. Declined: the working environment uses the grid for individual
planning, not aggregate operational analysis. The dense row grid already gives sufficient
at-a-glance clarity. Do not re-add without a specific operational use case from Gareth.

### Override cache is never cleared on member switch
`rosterOverridesCache` in `app.js` is keyed `"memberName|date"` and accumulates
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

### ⚠️ The installed PWA masks live-site breakage — verify the URLs, not your phone
Because the app is offline-first, an installed PWA launches (and updates) from
the service-worker cache. It keeps working even when the **live deployment is
completely broken** — a splash that never clears, a `404`, a CSP violation, an
expired/missing API-key referrer entry. You will **not** notice from your own
installed app, which is exactly how the June 2026 outage went unseen (Firebase
URL stuck on splash, GitHub Pages staff URL returning 404, while every installed
phone carried on fine).

**Therefore: never treat "my phone works" as evidence the site is up.** Always
test the **live URLs in a fresh browser / private window** (no SW, no cache):
- `https://myb-roster.web.app` — must load *past* the splash to the calendar
- `https://garethdavidmiller.github.io` — must load (not `404`); the staff URL
- Deep-link a sub-page (`/admin.html`, `/paycalc.html`) — not just the root
- DevTools → Console on each: no red errors (CSP / failed module / `404` /
  `api-key-not-valid` / referrer-blocked)

This check is now part of the routine review cadence — see CLAUDE.md →
"Deployment health check". Re-run it after any change to `firebase.json`
(CSP/headers), the Firebase SDK version in `firebase-client.js`, the GCP API-key
referrer allowlist, or the hosting setup.

**Root cause of the June 2026 splash outage (fixed v12.34):** `firebase.json`'s
hosting `ignore` list contained `**/*.mjs` — intended to skip the `*.test.mjs`
test files, but it also dropped the **runtime** `purify.es.mjs` from every
Firebase deploy. The import is static (`index.html → app.js → app-huddle-viewer.js
→ import './purify.es.mjs'`), so the 404 broke the whole module graph and the
splash never cleared; it also failed the SW precache (`purify.es.mjs` is in
`CORE_ASSETS`). Fixed by narrowing the ignore to `**/*.test.mjs` + `generate-sri.mjs`.
**Lesson:** any deploy-ignore pattern must exclude *only* dev/test files — never
match a file the app imports at runtime. When adding a new runtime asset with a
test-like or tooling-like extension, confirm it is not caught by an `ignore`
glob in `firebase.json` (and is present in the `deploy-pages.yml` rsync).

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

### Cultural calendar data needs annual update
15 lunar/lunisolar datasets need updating each November/December. Full list and
sources in `CLAUDE.md` → "Annual maintenance — cultural calendar data".

### Cloud Function payday constant duplicated from `roster-data.js`
`functions/index.js` contains its own `FIRST_PAYDAY_MS` and `INTERVAL_DAYS` constants
for the pay-reminder scheduled notification. These must stay in sync with `CONFIG.FIRST_PAYDAY`
and `CONFIG.PAYDAY_INTERVAL_DAYS` in `roster-data.js`. If the pay schedule ever changes,
both files must be updated. The correct long-term fix is a shared JSON config consumed by
both, but the no-build constraint makes this awkward. For now: if you change payday config,
search for `FIRST_PAYDAY_MS` in `functions/index.js` and update it in the same commit.

### Cloud Function staff list duplicated from `roster-data.js`
`functions/index.js` contains a hardcoded `STAFF_NAMES` object used by `parseRosterPDF`
to name-match the AI-parsed roster output. This must stay in sync with `teamMembers` in
`roster-data.js`. Every new starter or leaver needs updating in both files. The code
comment in `functions/index.js` acknowledges this. For now: when adding or removing a
member, search `functions/index.js` for `STAFF_NAMES` and update the relevant grade array
in the same commit.

### firebase-admin upgrade to v14 blocked on firebase-functions compatibility (June 2026)

`firebase-admin@14.0.0` is available and would fix 9 moderate-severity vulnerabilities
in the dependency chain (`uuid < 11.1.1` via `@google-cloud/firestore → google-gax → uuid`).
The upgrade is blocked by two things:

- `firebase-admin@14` requires **Node >=22**, but the functions runtime is set to Node 20.
- `firebase-functions@7.x` (all released versions as of June 2026) declares
  `firebase-admin@"^11 || ^12 || ^13"` — it does not yet list v14 as a supported peer.

**Practical risk:** The `uuid` vulnerability only triggers when a caller passes an explicit
`buf` argument to UUID generation. Firebase's internals never do this, so the vulnerability
is present in the dependency tree but not reachable in normal operation. Severity: moderate.

**When to upgrade:** once `firebase-functions` releases a version adding `firebase-admin@^14`
to its peer dependency range. Check with `npm outdated` in `functions/`. When unblocked:
1. Bump `"node": "20"` → `"node": "22"` in `functions/package.json` engines field
2. Bump `firebase-admin` to `^14.0.0`
3. Audit `admin.firestore.FieldValue.serverTimestamp()` usage in `functions/index.js` —
   v14 dropped the legacy `admin.firestore` namespace; `FieldValue` must be imported from
   `firebase-admin/firestore` directly
4. Test all three Cloud Functions (ingestHuddle, parseRosterPDF, setupRosterAuth) before
   deploying to production

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
Current test suites cover: override priority logic (`app.test.mjs`), roster data / bank
holidays / paydays / AL (`roster-data.test.mjs`), pay maths (`paycalc.test.mjs`),
roster suggestions (`paycalc-roster-suggestions.test.mjs`), Cloud Function parse helpers
(`roster-parse-helpers.test.mjs`), SW asset completeness (`sw-asset-check.test.mjs`),
and link-design pure maths including generator, coverage, and design checks
(`links-design.test.mjs`, added v12.40).

Not currently tested: DOM rendering in `app.js` / `admin-app.js`, the Firestore read/write
layer in all page modules, nav panel injection and overlay lifecycle (`nav-panel.js`,
`overlay.js`), session management edge cases (`session.js`), push notification subscribe/
unsubscribe flow (`notif.js`), and Cloud Function HTTP endpoints (no integration tests).
Before adding new untested behaviour in these modules, consider whether a unit or
integration test can be added first.

### E2E smoke tests removed (v12.75) — to be brought back with a better approach

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

### `window._mybSession` is a cross-module global handshake (deferred refactor)
`operations-app.js`, `settings-app.js`, `links-app.js`, and `admin-app.js` each store
the result of `ensureFirebaseSession()` as `window._mybSession` — a Promise that resolves
once Firebase Auth has a live session. Feature modules that need auth before writing
(`huddle.js`, `admin-auth.js`, `admin-roster-upload.js`) await this global before their
first Firestore/Storage write.

**Why it's a global:** the Promise must be set by the page coordinator before feature
modules are initialised, and ES module import order doesn't guarantee coordinator-first
execution. A named export from `session.js` would be cleaner but requires a broader
refactor (the coordinator would have to export the Promise; every feature module would
import it explicitly).

**Risk:** a new page that imports huddle.js or admin-auth.js but forgets to set
`window._mybSession` will silently fail on uploads with a Firebase permissions error.
No type-checker or import graph enforces it.

**If/when to fix:** when a new page needs these feature modules, add
`window._mybSession` to a checklist in CLAUDE.md, or refactor `session.js` to export
a `getSessionPromise() / setSessionPromise()` pair so the contract is explicit and
grep-able.
