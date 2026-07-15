# CLAUDE.md

*Last updated: July 2026 — v17.10 · Updated every 0.10 version*

# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Current app version | `17.10` (latest 0.10 milestone; exact value in `roster-data.js` — `APP_VERSION` is authoritative). The version stamp in **every** doc (this file, AI_MAP, OPERATIONS_REFERENCE, KNOWN_LIMITATIONS, ROADMAP) is enforced against the latest 0.10 milestone by `sw-asset-check.test.mjs` and `githooks/pre-commit` — a bump crossing a 0.10 line fails until each doc is reviewed and re-stamped. |
| Hosted URL | Deployed to Firebase Hosting via GitHub Actions on push to `main` |
| Staff-facing URL | `https://myb-roster.web.app` (canonical — Firebase Hosting; **primary install + notification target** since v14.29). A GitHub Pages mirror is still served at `https://garethdavidmiller.github.io/roster-app/` — the **roster-app repo's OWN** Pages, built from `main`; **note the `/roster-app/` path**, NOT the bare origin (which is a separate empty repo that 404s) — kept alive only for staff who already installed from it. `STAFF_SITE_URL` in `functions/index.js` is now the bare `https://myb-roster.web.app` (no sub-path). It only sets the notification payload's path/hash — each device's service worker discards the origin and re-bases the page onto its own scope, so existing github.io installs keep working. See API key note below. |
| Cloud Function URLs | `https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle` |
| | `https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF` |
| | `https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth` |
| Development branch convention | `claude/<description>-<sessionId>` — always push to this branch, never directly to `main` |

**GitHub Actions secrets required:**

| Secret | What it is |
|--------|-----------|
| ~~`FIREBASE_SERVICE_ACCOUNT`~~ | **Retired — no longer used.** All three deploy workflows now authenticate via **Workload Identity Federation** (short-lived GitHub OIDC tokens exchanged for the `github-deploy@myb-roster.iam.gserviceaccount.com` service account — pool `github-pool`, provider `github-provider`, repo-scoped by an `assertion.repository` condition). **A2 complete:** the old SA JSON key and the `FIREBASE_SERVICE_ACCOUNT` GitHub secret have both been deleted (deploys confidence-checked with the key gone), so no standing full-project deploy credential remains in GitHub. See SECURITY_RELEASE_PLAN.md → Appendix A2. |
| `HUDDLE_SECRET` | Bearer token for `ingestHuddle` — also set in Firebase Secret Manager |
| `ANTHROPIC_API_KEY` | Claude AI key for `parseRosterPDF` — Firebase Secret Manager only |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keys — Firebase Secret Manager only |

**Workflows:** `deploy-functions.yml` (functions only) · `deploy-hosting.yml` (PWA → Firebase Hosting, added v8.14) · `deploy-rules.yml` (Firestore/Storage rules). **All three authenticate via Workload Identity Federation** (`google-github-actions/auth`, pinned `v2.1.13`) — each job declares `permissions: id-token: write` and exchanges GitHub's OIDC token for short-lived credentials; there is no `FIREBASE_SERVICE_ACCOUNT` key file. The GitHub Pages staff mirror at `garethdavidmiller.github.io/roster-app/` is served by the **roster-app repo's own native Pages** ("pages build and deployment" — Settings → Pages → Deploy from `main`/root), so there is **no Pages workflow file**. The root **`.nojekyll`** marker (empty file — do not delete) makes Pages skip its Jekyll build and copy files directly: without it every mirror deploy ran the app through Jekyll, which hard-times-out at 10 minutes and caused repeated mirror deploy failures (Jul 2026). (The old cross-repo `deploy-pages.yml` + `PAGES_DEPLOY_TOKEN` secret were removed v14.25: redundant — they pushed a copy to a separate bare-origin `garethdavidmiller.github.io` repo that nothing used, and failed on every run.)

**⚠️ Firebase API key referrer restriction — add every domain the app is served from:**
The Firebase web API key is restricted to specific HTTP referrers in GCP Console → APIs & Services → Credentials. If a domain is missing, **every Firebase Auth call silently fails** — sign-ins, Firestore writes, and push subscriptions all break with no visible error in the app UI. Current allowlist must include:
- `myb-roster.firebaseapp.com/*`
- `myb-roster.web.app/*`
- `garethdavidmiller.github.io/*` ← staff-facing URL, must stay until GitHub Pages is retired
If a new custom domain is ever added, update the GCP allowlist in the same change. See KNOWN_LIMITATIONS.md task #1 for full history.

---

## Deployment health check — do this occasionally (and in every review)

> **⚠️ The installed PWA hides live-site breakage.** The app is offline-first, so
> a phone that already has it installed launches — and even updates — straight
> from the service-worker cache, **even when the live site is completely broken**
> (splash that never clears, `404`, CSP failure, expired API-key referrer). You
> will NOT see the problem from your own installed app. This is how a real outage
> went unnoticed (Firebase URL stuck on splash + GitHub Pages staff URL `404`,
> while every installed phone kept working). **"My phone works" is never evidence
> the site is up.**

**Verify the LIVE URLs in a fresh browser / private window (no cache, no SW):**

- [ ] `https://myb-roster.web.app` — loads *past* the splash to the calendar
- [ ] `https://garethdavidmiller.github.io/roster-app/` — loads (not `404`); the GitHub Pages staff mirror (**note the `/roster-app/` path** — the bare origin is a separate empty repo that 404s)
- [ ] A sub-page deep-link works (`/admin.html`, `/paycalc.html`) — not just the root
- [ ] DevTools → Console on each shows **no red errors** (CSP / failed module / `404` / `api-key-not-valid` / referrer-blocked)

**Cadence:** every code/app review, **and** immediately after any change to
`firebase.json` (CSP/headers), the Firebase SDK version in `firebase-client.js`,
the GCP API-key referrer allowlist, or the hosting/Pages setup. Full rationale
and the symptom table: KNOWN_LIMITATIONS.md → "The installed PWA masks live-site
breakage".

---

## Version bumping (MANDATORY on every change)

> **⚠️ INCREMENT IS EXACTLY 0.01 PER CHANGE — never 0.10.** A batch/change goes e.g.
> `15.90 → 15.91 → 15.92`. The **"update every 0.10 version"** documentation rule further down is
> ONLY about *when to re-stamp the docs* (when the version crosses a 0.10 line, e.g. `…99 → 16.00`) —
> it is **not** the step size. Do not confuse the two: bumping by 0.10 per batch (the v15.70→15.80→15.90
> slip) burns the version space and is wrong. The version only ever *increases* (it names the SW cache),
> so never set a value ≤ what is already on `main`.

> **⚠️ PRE-COMMIT CHECK — do this before every `git commit`:**
> Ask: "Did this change touch anything a user can see or experience?" UI text, layout,
> behaviour, CSS, security rules, SW caching — all require a bump. If yes, run `npm run bump`
> before committing. Forgetting and fixing in a follow-up commit is worse than bumping
> unnecessarily, because staff may be served a stale cached asset.

**2 runtime bump locations (v16.81 — was 9; the 7 pure-comment stamps were dropped):**

> **What requires a bump:** any change that alters runtime behaviour — logic, data, UI,
> CSS layout/appearance, security rules, HTTP headers, manifest, service worker caching.
> **What does NOT require a bump:** pure documentation edits (`.md` files only), comment-only
> changes inside JS/CSS with no runtime effect, and whitespace/formatting fixes with no
> semantic change. If in doubt, bump — the cache invalidation cost is zero and the benefit
> of always-fresh assets is real.

| File | Location |
|------|----------|
| `roster-data.js` | `export const APP_VERSION = '...'` — **primary source** (every runtime read) |
| `service-worker.js` | `const APP_VERSION = '...'` — names the SW cache (the freshness lever) |

**Always use `npm run bump <version>`** (e.g. `npm run bump 13.48`) — never hand-edit either location. Implemented by `scripts/bump-version.mjs`. The runtime version staff see (About lightbox) reads `APP_VERSION`. The old SW line-1 and six HTML line-2 comment stamps were removed in the v16.81 debt sweep: they carried no runtime effect but made the bump touch 8 files on ~half of all commits and conflicted across parallel `claude/*` branches. `sw-asset-check.test.mjs` now checks only the two runtime locations.

`?v=` cache-busting strings were removed at v9.94 — do not add them back. Cache freshness is handled by `Cache-Control: no-cache` in `firebase.json`.

**Documentation update policy:** Update every **0.10 version** (e.g. 10.10 → 10.20), or immediately on: new pay grade, auth/Firestore model change, SW strategy change, new page or module, data model change.

**Same-commit rule:** Any commit that adds, removes, or renames a JS module — **or removes/renames an exported symbol** from one — must also update `CLAUDE.md` and `AI_MAP.md` in the same commit. The pre-commit hook (`githooks/pre-commit`) enforces both: the module rule (modules must be listed in both docs) and the export rule (a staged module whose exports shrank vs `HEAD` requires `AI_MAP.md` to be staged too). The hook **also blocks** a commit when `AI_MAP.md`'s "Last updated" line has fallen behind the latest 0.10 milestone (mirrors `sw-asset-check.test.mjs`, so the 0.10 documentation sweep is enforced locally as well as in CI). It additionally runs ESLint on all staged JS files (if ESLint is installed) and checks that `firebase-client.js` does not import multiple different Firebase SDK versions at once.

---

## How to work with the owner

Gareth built this app through extended Claude.ai collaboration. He has strong operational knowledge and is actively learning software development. Every session is both development and teaching.

- **Explain decisions** — what, why, what the alternative was
- **Plain language first** — explain new concepts before implementation
- **Name the pattern** — name any design pattern and say why it fits
- **Flag trade-offs** — briefly note what the other option was
- **Never assume prior knowledge** of cloud services, auth patterns, or backend concepts

---

## Compact instructions

When compacting, always preserve:
- The list of modified files and their purpose
- Any unresolved errors or test failures
- The current version number being worked on
- Any decisions made about architecture or approach
- The branch name

---

## Current file structure

See `AI_MAP.md` for full module descriptions and export lists.

```
roster-app/
├── index.html              ← main PWA app (HTML + CSS only)
├── admin.html              ← staff self-service portal: AL booking, absence, override list
├── operations.html         ← admin-only: Huddle upload, Circular upload, Newsletter upload, Roster upload, Work Email Progress, Error Log, Usage, App Speed (Project 0 latency), Staff Login Accounts
├── settings.html           ← Notifications, Work Email
├── paycalc.html            ← pay calculator (HTML + CSS only)
├── calendar-app.js         ← coordinator for index.html: event wiring, month navigation, Team Week View, notification wiring
├── calendar-state.js       ← display month/year state for index.html (getters/setters + persistViewedMonth)
├── calendar-swipe.js       ← Pointer Events swipe carousel for index.html: initSwipeHandler, isSwipeCooldown
├── calendar-al-lightbox.js ← AL lightbox + day-detail lightbox for index.html: initCalendarLightboxes() → { openDayDetail, closeALLightbox }
├── calendar-initial-fetch.js ← initial 3-month Firestore fetch and sync-chip UI for index.html: initInitialFetch({ isTeamViewMode, renderCalendar })
├── calendar-keyboard.js    ← keyboard navigation + hover tooltip for index.html: initCalendarTooltip(), initCalendarKeyboard({ navigateToPaycalc, openDayDetail })
├── calendar-overrides.js   ← Firestore override cache for index.html (fetch/ensure range, getShiftTypesInMonth)
├── calendar-member.js      ← team member selection for index.html (dropdown, current member, stale-name handling)
├── calendar-renderer.js    ← calendar cell/grid building for index.html
├── calendar-huddle-viewer.js    ← Huddle viewer overlay: initHuddleViewer, _triggerAutoOpen, hashchange
├── calendar-doc-viewer.js  ← Circular/Newsletter in-app viewer (index.html): opens a #circular/#newsletter notification deep link in a lightbox. Reuses createLightbox; separate from the Huddle viewer.
├── nav-panel.js            ← shared nav drawer: initNavPanel, NAV_PAGES/INFORMATION/GUIDES, archiveNotice, isNoticeExpired
├── notif.js                ← shared Web Push: notifSupported, getNotifState, peekNotifState, enable/disableNotifications
├── overlay.js              ← shared overlay helpers: lockBodyScroll, createLightbox, _pushOverlayState, trapFocus, initCardCollapse
├── about-lightbox.js       ← shared About (#iconLightbox) panel: initAboutLightbox(). Used by all six pages
├── tips-lightbox.js        ← shared per-card Tips panel: initTipsLightbox(CARD_TIPS, { getIsAdmin })
├── login-overlay.js        ← shared in-place sign-in overlay for all 5 protected pages: initLoginOverlay({ pageLabel, onSuccess }); owns grade/name dropdowns, surname-password check, client rate-limit. The DOM-free sign-in core `runNamedSignIn` time-boxes ensureNamedSession (8s) and commits the local session ONLY after auth resolves — never before (the v14.75 half-signed-in/freeze fix; see LOGIN_INCIDENT.md). `primeAuth()` pre-warm + `_signingIn` back-link guard (v14.79–80). Full detail + exports: AI_MAP.md.
├── session.js              ← shared auth/session: ensureFirebaseSession/ensureNamedSession, primeAuth (v14.80 pre-warm), get/save/clearSession, and the B0 named-vs-anonymous identity signals. Full exports: AI_MAP.md.
├── auth-state-core.js      ← PURE identity state machine (ARCHITECTURE_PLAN.md Track 1, Phase 1): reduceAuthState(state, event)→state + INITIAL_STATE. No DOM/Firebase/localStorage. Tested by auth-state-core.test.mjs.
├── auth-state.js           ← auth STORE (Phase 2): getAuthSnapshot/subscribeAuth/dispatchAuth over the reducer. Imports ONLY auth-state-core.js (acyclic); session.js FEEDS it (observing only; sessionReady untouched). Full detail: AI_MAP/ARCHITECTURE_PLAN.
├── auth-policy.js          ← page-AUTHORISATION (Phase 3): PAGE_POLICIES map + pure requirePageAuth→{decision,reason} (allow/soft-allow/login/forbidden/pending) + rolesFor + requirePage. CLIENT UX only — server rules are the real boundary. Consumed by the 5 write coordinators (active since ENFORCE_NAMED_SESSION on). Full detail: AI_MAP/ARCHITECTURE_PLAN.
├── sw-register.js          ← shared SW registration + update lifecycle: registerServiceWorker(). v16.09: the first-install claim no longer reloads (hadController guard — it double-loaded every new device) and controllerchange is no longer {once:true} (a declined beforeReload confirm must not swallow the next update). Tested by sw-register.test.mjs
├── splash-watchdog.js      ← CLASSIC (non-module) recovery script for index.html, loaded via `<script defer src>` so it runs even when the ES-module graph fails to load (the only thing that removes the launch splash is calendar-app.js). If the #splash is still up after 20s: one guarded auto-reload (sessionStorage `myb_splash_reloaded`), then a Reload / Reset-cache (unregister SW + delete caches) panel. Runtime-only (guarded on `document`). Registered in service-worker.js like any asset (v16.18)
├── error-reporter.js       ← shared uncaught-error reporter: initErrorReporter() — writes to Firestore clientErrors
├── usage-reporter.js       ← shared anonymous usage recorder: recordUsage(page, member?) — page popularity + active-account counts (client-side dedup; no identity stored)
├── usage-stats.js          ← pure usage maths: monthKey, dayKey, shouldCountMonth, shouldCountRolling, recentDayKeys, sumDailyWindow, orderPageCounts, staleDailyKeys
├── perf-reporter.js        ← shared anonymous latency recorder (Project 0): recordPageLatency buckets Navigation + Paint Timing (ttfb/domReady/fcp) → analytics/perf_<YYYY-MM>; no identity, no raw ms; skips admin (developer) loads (still consumes the one-shot login marker). Full detail: AI_MAP.
├── perf-stats.js           ← pure latency maths: PERF_BUCKETS, bucketDuration, perfSampleKey, parsePerfSampleKey
├── calendar-team-view.js        ← Team Week View: state, grid render, Firestore fetch, toggle
├── override-utils.js   ← override/member-start/shift helpers: tsToMillis, shouldReplaceOverride, reconcileRangeIntoCache (authoritative range-refresh — rebuild winners from the snapshot, evict deletes; shared by both fetch paths), isBeforeMemberStart, isRestShift, resolveEffectiveShift (shared override→display ladder for renderer/team-view/legend)
├── admin-app.js            ← coordinator for admin.html: login, AL/absence, Team Week View, module wiring. Body is an exported `init()` (Phase 4a.2) invoked by admin-boot.js — importing the module no longer auto-runs it (test seam). The in-place-login re-invocation calls the nested `initAuthorised()`, not `init()`.
├── admin-boot.js           ← 2-line bootstrap for admin.html: imports `init` from admin-app.js and calls it (CSP `script-src 'self'` blocks inline module scripts; keeps init() importable without auto-running, for tests)
├── operations-app.js       ← coordinator for operations.html: session guard, initHuddleUpload/RosterUpload/AuthSetup/ErrorLog. Body is an exported `init()` (Phase 4a.2) invoked by operations-boot.js — early-return access gate, no top-level throw
├── operations-boot.js      ← 2-line bootstrap for operations.html: imports `init` from operations-app.js and calls it (CSP `script-src 'self'` blocks inline module scripts; keeps init() importable without auto-running, for tests)
├── settings-app.js         ← coordinator for settings.html: session, login, initHuddleNotifications, work email. Body is an exported `init()` (Phase 4a.2, v17.09) invoked by settings-boot.js — importable without auto-running, for tests
├── settings-boot.js        ← 2-line bootstrap for settings.html: imports `init` from settings-app.js and calls it (CSP `script-src 'self'` blocks inline module scripts; keeps init() importable without auto-running, for tests)
├── huddle.js               ← initHuddleUpload (→ operations) + initHuddleNotifications (→ settings)
├── doc-upload.js           ← shared Operations upload-card skeleton (Circular/Newsletter/Huddle): file-pick → validate (type + 20 MB) → optional transform (Huddle DOCX→HTML) → upload → feedback. initDocUploadCard(cfg)
├── admin-auth.js           ← Staff Firebase Auth account setup card: initAuthSetup()
├── admin-email-check.js    ← one-time work-email confirmation overlay (extracted from admin-app.js v16.41): initEmailCheck(member) + the pure isEmailCheckDue/EMAIL_CHECK_INTERVAL_MS cadence helper (tested). Self-contained (imports ls/firebase-client/roster-data/overlay/session + DOM only) — shown once per fresh login, ~3-monthly, mandatory once shown; never blocks the app. The login `myb_email_check_pending_<member>` marker is still SET by admin-app.js's login onSuccess and CONSUMED here.
├── admin-al.js             ← Annual Leave Booking: initALSection(deps), triggerConfirmedALSave() — thin config wrapper over admin-range-booking.js (60-day cap, 🏖️ preview + spare warning, over-entitlement confirm bar)
├── admin-sick.js           ← Sick Days Recording: initSickSection(deps) — thin config wrapper over admin-range-booking.js (1-year cap, 🪑 preview; no entitlement cap)
├── admin-range-booking.js  ← shared skeleton for the two date-range booking sections: createRangeBookingSection(cfg) — dropdown + range picker → live preview → recordRangeOverrides save flow. Per-section differences (range rule, preview copy, AL pre-save entitlement check, refresh hooks) injected via config
├── admin-overrides.js      ← Change a Shift: PILL_TYPES, week grid, bulk bar, override list, recordRangeOverrides()
├── admin-rangepicker.js    ← Inline date-range calendar: buildRangePicker(prefix), getDateRange()
├── admin-roster-upload.js  ← Weekly Roster Upload: computeCellStates, renderReviewTable, shiftDisplay, _saveOverrideBatches (chunked Firestore save — each batch rebuilt inside writeWithClaimRetry so roster-import saves self-heal a stale admin/manager claim, like every other Admin write path)
├── paycalc-app.js          ← coordinator for paycalc.html (UI, DOM, autosave, HPP, sticky bar, back-pay). Body is an exported `init()` (Phase 4a.2) invoked by paycalc-boot.js — local-identity gate early-returns, no top-level throw
├── paycalc-boot.js         ← 2-line bootstrap for paycalc.html: imports `init` from paycalc-app.js and calls it (CSP blocks inline module scripts; keeps init() importable without auto-running, for tests)
├── paycalc-lightboxes.js   ← lightbox and overlay initialisation for paycalc.html: initPaycalcLightboxes() → { openAboutLightbox }
├── paycalc-periods.js      ← period arithmetic + select UI (getPeriods, prev/next, BH/Boxing-Day, CONDITIONAL_ROWS)
├── paycalc-settings.js     ← grade/contracted-hours helpers + settings persistence (getGrade, getEffectiveContr, getProRateFactor, saveSettings, loadSettings, …)
├── paycalc-roster-hint.js  ← roster-assist hint bar UI (updateRosterHint, fillFromRoster, fillCategoryFromRoster, snapKey, …)
├── paycalc-hpp.js          ← Holiday Pay Premium estimator and shared period helpers: isDataEmpty, _decodeHours, _varPayForPeriod, calcHPP, updatePriorHpp
├── paycalc-backpay.js      ← back-pay lump sum calculator: prefillBackPay, calcBackPay, _bpAwardTaxYear, raiseByPercent
├── paycalc-format.js       ← shared date/currency formatters (pure, no DOM): fd, fdShort, fmt. Imported by paycalc-app.js and paycalc-backpay.js.
├── paycalc-calc.js         ← pure pay maths (no DOM/Firebase): tax, NI, SL, gross, GRADES, TAX_YEARS
├── paycalc-help.js         ← HELP_CONTENT tooltip data (pure, no DOM)
├── paycalc-migrations.js   ← localStorage key constants (SK, periodKey, etc.), runMigrations(), and the shared saved-period decoder parseSavedPeriod/readSavedPeriod (returns {data,error}; back-pay + HPP surface a corrupt period instead of silently dropping it)
├── paycalc-roster-suggestions.js ← roster pre-fill engine: getRosterSuggestion, fetchOverridesForPeriod
├── roster-data.js          ← shared: APP_VERSION, CONFIG, teamMembers, all roster data, utility functions
├── roster-cycle-data.js    ← raw roster cycle arrays — imported by roster-data.js only
├── firebase-client.js      ← shared: Firebase init, db, all Firestore helpers
├── auth-identity.js        ← pure account-identity helpers extracted from firebase-client (no Firebase import, so unit-testable): normaliseSurname (surname derivation for Firebase Auth) + nameToEmail (initial.surname@myb-roster.local account email). Re-exported by firebase-client.js; the surname-parity source-equivalence check + the functions/roster-parse-helpers.js duplicate track THIS file
├── storage-utils.js        ← pure Storage helpers extracted from firebase-client (no Firebase import, so unit-testable): isSafeStorageUrl (download-URL allowlist — a security control), isDocxUpload (upload file-type detect), officeViewerUrl (wraps a .docx download URL in Microsoft's Office Online viewer so Word circulars/newsletters open+render instead of downloading), sixMonthCutoffISO (month-underflow-safe 6-month retention cutoff for _pruneOldDocs). Re-exported by firebase-client.js
├── client-errors.js        ← pure error-log ordering/retention: isResolvedErrorExpired, expiredResolvedIds, orderClientErrors
├── ls.js                   ← iOS-safe localStorage wrappers: lsGet, lsSet, lsDel
├── storage-keys.js         ← single source for the CROSS-FILE localStorage keys (SELECTED_MEMBER + legacy alias, VIEWED_MONTH/YEAR); shared by calendar-member/calendar-state/admin-app so a shared key has ONE spelling (v16.81). Per-module + paycalc-namespaced keys stay local.
├── index.css / admin.css / paycalc.css / operations.css / settings.css ← page-specific CSS
├── links.html              ← link design workspace (28-line rotation designer; visible to CONFIG.LINKS_DESIGNERS only)
├── links.css               ← CSS for links.html (grid, paint bar, picker chips, compare, heat map)
├── links-app.js            ← coordinator for links.html: multi-design Firestore, grid, paint, compare, generator UI. Body is an exported `init()` (Phase 4a.2) invoked by links-boot.js — early-return access gate, no top-level throw
├── links-boot.js           ← 2-line bootstrap for links.html: imports `init` from links-app.js and calls it (CSP blocks inline module scripts; keeps init() importable without auto-running, for tests)
├── links-design.js         ← pure link-design maths: classifyShift, normaliseCustomShift, calcCoverage, calcHourlyCoverage, generatePatterns, runDesignChecks, dayClass
├── shared.css              ← CSS shared by all six app pages (nav panel, lightbox, login, card-header, btn-action) — NOT the guides
├── guide-shell.css         ← shared chrome for all 4 guide pages (header, .btn-back, .btn-pdf, print, palette tokens)
├── guide-doc.css           ← shared styles for the two document-style guides (guide.html, paycalc-guide.html): two-column print layout, info boxes, tables, numbered steps, banner. Loaded between guide-shell.css and page CSS. NOT linked by railcard-guide.html or fip.html.
├── guide.css / paycalc-guide.css / railcard-guide.css / fip.css ← page-specific guide CSS
├── purify.es.mjs           ← self-hosted DOMPurify v3.4.12. Upgrade: `npm pack dompurify@<ver>`, extract purify.es.mjs
├── service-worker.js       ← single SW for all pages; cache name includes APP_VERSION
├── manifest.json           ← PWA manifest for all pages
├── guide.html / paycalc-guide.html / railcard-guide.html / fip.html ← printable guides (via nav panel)
├── railcard-guide.js       ← JS for railcard-guide.html: print, chip-bar navigation
├── fip.js                  ← JS for fip.html: opens the target country <details> when a jump link or deep link navigates to it (native <details> otherwise land collapsed)
├── guide-print.js          ← shared print button for guide.html and paycalc-guide.html
├── icon-*.png              ← 6 sizes: 120, 152, 167, 180, 192, 512 · icon-badge.png (monochrome notification badge, 96px)
├── fonts/
│   └── inter-latin.woff2   ← self-hosted Inter variable font (latin, wght 100–900)
├── CLAUDE.md / AI_MAP.md / OPERATIONS_REFERENCE.md / KNOWN_LIMITATIONS.md / ROADMAP.md ← docs
├── SECURITY_RELEASE_PLAN.md ← master sequencing/risk plan for the deferred security release (per-member isolation, named sessions, App Check, password retirement, WIF, firebase-admin bump). Not version-stamped; not a runtime asset.
├── ARCHITECTURE_PLAN.md     ← auth/session consolidation plan (Track 1: identity state machine + page-auth policy map, behaviour-preserving, landed ahead of the B3 strict cutover) + supporting refactors (testable coordinators, roster-data split) and the MILLER_ACTUALS privacy decision. Companion to SECURITY_RELEASE_PLAN.md. Not version-stamped; not a runtime asset.
├── LOGIN_INCIDENT.md        ← incident log for the v14.72–74 login freeze/slowness — RESOLVED (freeze fixed v14.75; B1 re-enabled v14.98). Records the diagnosis, the current auth-flag state (B1 `ENFORCE_NAMED_SESSION=true`; B2/B3 shipped — override write-isolation is now STRICT (v16.29), `CLAIM_EPOCH=2` since v15.33), and the re-enable checklist. READ THIS before touching login/auth. Not version-stamped.
├── RECOVERY_RUNBOOK.md      ← "break glass" backup/rollback/disaster-recovery runbook: preventative setup (Firestore PITR + scheduled backups + GCS exports) and task-led incident playbooks (deleted override, bad roster upload, Functions/Rules/Hosting rollback, GitHub-mirror failover, Firebase outage, restore-from-export). Owner-facing ops doc; not version-stamped; not a runtime asset.
├── override-utils.test.mjs            ← tests for override-utils.js
├── roster-data.test.mjs    ← tests for roster-data.js
├── paycalc.test.mjs        ← tests for paycalc-calc.js
├── paycalc-roster-suggestions.test.mjs ← (--experimental-test-module-mocks)
├── roster-parse-helpers.test.mjs / links-design.test.mjs / admin-rangepicker.test.mjs / client-errors.test.mjs / usage-stats.test.mjs / perf-stats.test.mjs
├── storage-utils.test.mjs ← tests for isSafeStorageUrl (bucket allowlist) + isDocxUpload + officeViewerUrl (Office viewer wrap/encoding) + sixMonthCutoffISO (month-underflow clamp); part of test:hygiene
├── auth-identity.test.mjs ← tests for normaliseSurname + nameToEmail (identity-critical account email derivation); part of test:hygiene
├── notif.test.mjs         ← tests for notif.js: notifSupported/isIOS, getNotifState VAPID rotation, peekNotifState (no side effects), enable/disableNotifications (--experimental-test-module-mocks)
├── surname-parity.test.mjs ← asserts normaliseSurname (auth-identity.js) and nameToPassword (functions/roster-parse-helpers.js) stay in sync (behavioural + source-equivalence); part of test:hygiene
├── import-graph.test.mjs   ← detects circular imports across all root ES modules (regex-based, no build step)
├── admin-overrides.test.mjs ← tests for getEffectiveShift, validateShiftRules, buildMemberDateMap (--experimental-test-module-mocks)
├── admin-roster-upload.test.mjs ← tests for shiftValueToOverrideType (parsed value → override type, incl. training + Sunday block) + _saveOverrideBatches stale-claim retry parity (permission-denied → token refresh → fresh batch → retry once) (--experimental-test-module-mocks)
├── nav-panel.test.mjs      ← tests for isNoticeExpired, archiveNotice, initNavPanel DOM guard (--experimental-test-module-mocks)
├── sw-register.test.mjs    ← tests for registerServiceWorker: first-install claim must not reload, update reloads once, beforeReload gets every controllerchange, SKIP_WAITING gating (no mocks; part of test:hygiene)
├── sw-internals.test.mjs   ← unit tests for service-worker.js's PURE helpers (_appCacheVersion, compareAppCacheDesc — the v16.86 cross-version cache sort — ctSafe, unredirect). The SW is a classic worker (can't be imported), so the test reads the SW source and evals each function BY NAME in a sandbox — assertions run against the SW's real code, no duplicate copy, no runtime change. Extraction throws (test fails loudly) if a helper is renamed. No mocks; part of test:hygiene
├── session.test.mjs        ← tests for constants, getSession, saveSession, clearSession, sessionReady/resolveSession, getSurname, refreshClaimsIfStale (--experimental-test-module-mocks)
├── login-overlay.test.mjs  ← tests for runNamedSignIn: the sign-in core commits the local session ONLY after auth resolves (timeout/throw/enforce-fail → no save), enforce on/off, transient-vs-persistent messages (--experimental-test-module-mocks)
├── admin-email-check.test.mjs ← tests for isEmailCheckDue: never/legacy-'1'/junk → due, the 3-month interval boundary, custom interval (--experimental-test-module-mocks; firebase-client + session mocked)
├── auth-state-core.test.mjs ← tests for reduceAuthState (pure identity state machine; no mocks; part of test:hygiene)
├── auth-state.test.mjs     ← tests for the auth store: getAuthSnapshot/subscribeAuth/dispatchAuth, no-op/listener isolation (no mocks; part of test:hygiene). The session.js→store bridge is tested in session.test.mjs.
├── auth-policy.test.mjs    ← tests for requirePageAuth/requirePage/rolesFor: the page×status×role decision matrix + invariants (degraded never allows, soft never blocks, public always allows, fail-closed on unknown page). No mocks; part of test:hygiene.
├── overlay.test.mjs        ← tests for lockBodyScroll, unlockBodyScroll, trapFocus, initCardCollapse (no mocks; runs in test:hygiene)
├── overlay-history.test.mjs ← tests for the Android-Back history STACK in overlay.js: nested overlays each get their own entry, Back closes only the topmost, a handler's own _clearOverlayHistory doesn't cascade, dedupe on double-open (capturing popstate harness; runs in test:hygiene)
├── calendar-state.test.mjs / calendar-member.test.mjs / calendar-overrides.test.mjs ← tests for calendar-state.js, calendar-member.js, calendar-overrides.js (--experimental-test-module-mocks)
├── calendar-renderer.test.mjs   ← tests for createCalendarHeader, createDayCell, getSwipeDirection, buildCalendarContainer (fake DOM; --experimental-test-module-mocks)
├── calendar-initial-fetch.test.mjs ← tests for initInitialFetch: pre-fetch setup, success/failure paths, sync-chip state machine, retry, visibilitychange (--experimental-test-module-mocks)
├── paycalc-periods.test.mjs ← tests for getPeriods, hasBoxingDay, hasBankHoliday, _setSelectPeriod, prevPeriod/nextPeriod; also getEffectiveContr, getProRateFactor, settingsKey, _bpAwardTaxYear (--experimental-test-module-mocks)
├── paycalc-hpp.test.mjs    ← tests for isDataEmpty, _decodeHours, _varPayForPeriod from paycalc-hpp.js (--experimental-test-module-mocks)
├── paycalc-migrations.test.mjs ← tests for pcPrefix, setPaycalcNamespace, SK rebuild, one-shot namespace migration (--experimental-test-module-mocks)
├── firestore.rules.test.mjs ← Firestore security rules integration tests (all 9 collections incl. analytics); run with `npm run test:rules` — starts/stops Firestore + Storage emulators automatically via firebase emulators:exec; NOT part of npm test (requires Firebase emulator binary); runs as a gate in deploy-rules.yml before any rules ship
├── storage.rules.test.mjs  ← Firebase Storage security rules integration tests (huddles, circulars, newsletters, catch-all); run with `npm run test:rules` alongside firestore.rules.test.mjs
├── storage-rules-static.test.mjs ← static (no-emulator) hygiene guard: asserts the 20 MB `request.resource.size` cap is present in all 3 upload blocks (the emulator suite can't practically test the size cap); part of `npm test` (test:hygiene)
├── sw-asset-check.test.mjs ← deployment hygiene: SW asset lists (incl. non-JS HTML/CSS precache + no ghost entries), APP_VERSION sync, roster-members.json sync, admin/operations/settings/links have zero modulepreloads, NOTIFICATION_FEATURES hashPaths ⊆ SW SAFE_NOTIFICATION_PAGES, firestore.rules work-email domain = CONFIG.WORK_EMAIL_DOMAIN, all 5 doc "Last updated" stamps current to latest 0.10 milestone
├── csp-hygiene.test.mjs    ← static (no-emulator) CSP guard: asserts firebase.json's Content-Security-Policy stays in step with what the app actually loads — every contacted host is permitted AND no stale origin lingers. Part of test:hygiene. (Its REQUIRED host list is itself hand-maintained — add a newly-contacted host there.)
├── module-parse.test.mjs   ← verifies every root JS module parses as valid ES module (--experimental-vm-modules) — guards against the settings-app.js incident where a fatal SyntaxError shipped undetected because node --check silently misses ES module errors
├── e2e/                    ← Playwright smoke suite (restored v13.95). `npm run test:e2e`. Real headless Chromium loads every page; Firebase SDK stubbed at the network layer so the suite never touches the gstatic CDN. Catches blank-page breaks (SyntaxError, missing import, broken module graph, auth redirects) that pass all unit tests. Does NOT catch CSP header violations — the local http-server doesn't apply Firebase Hosting headers (use the Firebase Hosting emulator for CSP testing). NOT part of `npm test`. See ROADMAP → "E2E smoke tests".
│   ├── smoke.spec.js       ← page-load tests (calendar, admin/settings login, paycalc/settings signed-in, operations/links auth redirects) + desktop-geometry checks (calendar/team-view/admin/paycalc/operations at 1024–1440px and short heights) + B1 named-session enforcement (flag-ON: admin/settings re-show login, operations/links redirect, paycalc soft). Each run on Desktop Chrome + Pixel 5
│   └── fixtures.js         ← hermetic Firebase: intercepts `gstatic.com/firebasejs/**`, serves local no-op stubs of every symbol firebase-client.js imports. `enforceNamedSession(page)` rewrites roster-data.js to flip `ENFORCE_NAMED_SESSION` on, and `window.__E2E.failSignIn` forces sign-in to fail — for the B1 enforcement tests
├── playwright.config.mjs   ← Playwright config: chromium + mobile-chrome projects, local http-server, SW blocked, CDN-free. Uses pre-installed Chromium in dev (`/opt/pw-browsers`); CI installs its own
├── package.json            ← dev dependencies only
├── eslint.config.js        ← flat ESLint config (browser globals); run on staged JS by the pre-commit hook and `npm run check`
├── scripts/
│   ├── bump-version.mjs          ← `npm run bump <version>` — updates APP_VERSION in the 2 runtime locations (roster-data.js + service-worker.js)
│   ├── generate-roster-members.mjs ← `npm run generate:roster-members` — rebuilds functions/roster-members.json
│   └── typecheck.mjs             ← `npm run typecheck` — type-checks every root JS module via tsc --noEmit using jsconfig.json
├── jsconfig.json               ← TypeScript project config for `// @ts-check` coverage; drives `npm run typecheck`
├── firebase.json           ← Firebase Hosting config: CSP headers, cache rules, redirects
├── firestore.rules         ← Firestore security rules (deployed via deploy-rules.yml, gated by firestore.rules.test.mjs; tested by firestore.rules.test.mjs)
├── storage.rules / firestore.indexes.json ← Firebase Storage rules + Firestore composite indexes
├── generate-sri.mjs        ← dev utility: patches Mammoth CDN SRI hash in huddle.js
└── functions/
    ├── index.js                  ← Cloud Functions: ingestHuddle, parseRosterPDF, setupRosterAuth
    ├── roster-parse-helpers.js   ← pure helpers: normaliseShift, buildWeekDates, extractAIJson, etc.
    ├── roster-members.json       ← generated from roster-data.js — do NOT hand-edit; run `npm run generate:roster-members`. Holds the AI-parsing name lists (cea/ces/dispatcher) AND the B4 server-owned auth lists (`activeMembers` + `roles.admin`/`manager`/`designer`) that setupRosterAuth trusts instead of the client payload. CI-locked by sw-asset-check.test.mjs
    └── package.json
```

**Run all tests:**
```
npm test              # test:hygiene + test:parse + test:unit (~980 unit tests)
npm run check         # lint + typecheck + npm test (full pre-push gate)
npm run lint          # ESLint on all JS files
npm run typecheck     # tsc --noEmit on all root JS modules

# By test runner (same as npm test, useful for --watch or targeting specific files):
npm run test:hygiene  # sw-asset-check, import-graph, links-design, admin-rangepicker, client-errors, overlay(+history), usage-stats, perf-stats, surname-parity, storage-rules-static, storage-utils, auth-identity, auth-state-core, auth-state, auth-policy, sw-register, sw-internals, csp-hygiene
npm run test:parse    # module-parse (--experimental-vm-modules)
npm run test:unit     # all --experimental-test-module-mocks tests
npm run test:functions # Cloud Functions pure-helper tests (roster-parse-helpers.test.mjs) — not part of npm test

# Firestore + Storage security rules tests (requires Firebase emulator binary — starts automatically):
npm run test:rules

# E2E smoke tests (real headless Chromium; uses pre-installed browser in the dev env):
npm run test:e2e
```

**Service worker caching:**
- **Update lifecycle (v15.41; hardened v15.46):** install does ONLY `skipWaiting()`; activate does ONLY `clients.claim()`; the ~90-file precache runs as a DETACHED post-activation warm-up. Never move the precache back into install's or activate's `waitUntil` — install's held every update behind ~90 no-cache fetches (the "app updates with a lot of lag" complaint), and activate's would queue every fetch of the freshly-reloaded page behind the warm-up. **Warm-up resilience (v15.46):** a `__precache-complete` marker is written only when EVERY asset cached; the SW's top-level startup check re-runs an incomplete warm-up on every wake (covers a killed mid-run warm-up AND first installs — offline-first coverage converges instead of silently staying partial); the fetch handler piggybacks the in-flight warm-up onto `event.waitUntil` so page traffic keeps the SW alive through it; **old-version caches are deleted only after a FULLY-successful warm-up** (they are the transition fallback — a partial warm-up keeps them and retries). The doc/navigation fallback checks the CURRENT-version cache before the global any-cache lookup (the global `caches.match` prefers the OLDEST cache, which served previous-version HTML to a fresh-JS page — a mixed-version hazard); the JS/CSS SWR path keeps its any-cache LAST resort for pure-offline mid-transition. **v16.09 latency pass:** Navigation Preload is enabled on activate (the browser starts the network-first HTML fetch in parallel with SW boot; the doc branch consumes `event.preloadResponse`); the warm-up runs in batches of 8 (not ~100 parallel) and skips assets the reloading page already cached; fonts/icons warm without `cache:'no-cache'` (immutable, served from HTTP cache); navigations are cached under the bare path (query stripped — `ignoreSearch` on fallback match) and redirected responses are re-wrapped before caching/serving (`unredirect` — Firebase 301s `/index.html`→`/`; in-app links now navigate to `./`); the 2s abort is guarded so it can never kill a response that already resolved. An `opaqueredirect` (status 0 — a redirect under the navigation's 'manual' redirect mode, which is how navigation preload surfaces the start_url `./index.html` → `/` 301) is passed straight through so the browser follows it — treating it as a broken-site response would send every installed-PWA launch down the cache fallback. `manifest.json` `start_url` and the Calendar shortcut now point at `./` (takes effect on reinstall; the pass-through covers existing installs).
- Stale-while-revalidate: HTML documents too (v16.10) — instant from cache; the navigation-preload response doubles as the background refresh. Cache miss → network-first with the 2s cache-fallback race (the pre-v16.10 behaviour)
- Stale-while-revalidate: all JS + CSS (v14.18) — served instantly from cache, refreshed in the background **at most once per SW process lifetime** (v16.09: the cache is version-pinned and content never changes within a version, so per-request refreshes were ~35 guaranteed no-op 304s per page open competing with Firestore; one check per SW start keeps the un-bumped-deploy self-heal). Code freshness is preserved by the version-bump → new SW → new cache lifecycle (each deploy precaches fresh assets and the new SW claims immediately); roster DATA is always live from Firestore regardless of cached JS version
- Cache-first: icons, fonts, `manifest.json` — stable assets; and the gstatic Firebase SDK in its own `myb-roster-sdk-v{ver}` cache (v16.10 — warmed with the app, swept on SDK bump only)
- Cache name: `myb-roster-v{APP_VERSION}` — version bump auto-invalidates

---

## Brand colours — Chiltern Railways

Full hex table and "never hardcode" rule: see `.claude/rules/css-tokens.md` → Brand colours.

---

## Architecture decisions — never change without discussion

| Decision | Rule |
|----------|------|
| No framework (vanilla JS) | No build step. Do not introduce React, Vue, or any UI framework. A **few** vetted, self-contained libraries are allowed where they earn their place — currently Firebase (auth/Firestore/Storage), Mammoth (DOCX→HTML for the Huddle), and DOMPurify (sanitising that HTML). Adding another runtime library is a discuss-first decision, not a default. |
| No bundler | External dependencies load without a build step: **vendored** (served from origin) where offline-first or CSP demands it — DOMPurify (`purify.es.mjs`) and the Inter font are vendored — otherwise **from a pinned CDN** with SRI where practical (Firebase from gstatic, Mammoth from jsdelivr). Prefer vendoring for anything the app must work offline without. |
| **When a build step earns its keep (threshold, not yet crossed)** | The no-build rule is a deliberate trade (zero toolchain, direct debuggability, no build-supply-chain) paid for by hand-maintained work a bundler does for free: the ~35-entry `modulepreload` lists on the **two** heaviest pages only (index.html + paycalc.html — the deepest module graphs; admin/operations/settings/links deliberately have none, their graphs being shallower and their loads less latency-critical, all CI-locked by sw-asset-check.test.mjs), the ~110-entry SW precache, the 2-location version bump, `generate-*` codegen, the 3 CSP `*-boot.js` shims, the `firebase-client.js`-untestable-in-Node pure-helper splits, and the `normaliseSurname` browser/functions duplication. This cost rises with module count (~70 and growing). **Revisit the trade — do not auto-adopt — when either: (a) you want real TypeScript types** (you already run `tsc --noEmit` over 67 `// @ts-check` files — the checker without the emit), **or (b) a bug is traced to drift in a hand-maintained preload/precache/duplication list.** Until one of those, the trade still favours no build. |
| **Self-hosted Inter typeface (v11.53)** | `fonts/inter-latin.woff2` is served from origin, NOT Google Fonts CDN. CSP is `font-src 'self'` — a CDN would mean loosening it, and self-hosting keeps the app offline-first (SW precaches the file) with no third-party request. One variable woff2 (latin, wght 100–900) covers every weight. `@font-face` lives in `shared.css`; `--font-sans` token in `:root` is the single place the stack is defined; every page's `body` uses `var(--font-sans)`. Do not re-add a Google Fonts `<link>`. **Inter is the app's ONLY typeface** — a Barlow Semi Condensed display face for the hero £/month heading was tried at v16.73 and reverted at v16.74 (owner decision: the gain was modest, and Inter — a neo-grotesque like the real Rail Alphabet — already fits the brand). Don't re-add a display face without a fresh discussion. |
| Pointer Events API for swipe | Handles touch, mouse, and trackpad in one handler. Do not revert to Touch Events. |
| `aria-live` for month announcements | Programmatic `.focus()` on the month heading caused mobile layout reflow. Do not switch. |
| `Math.ceil()` on carousel panel width | Eliminates sub-pixel seam on high-DPI screens. Do not remove. |
| CSS variables for all colours | Defined in `:root`. Never hardcode hex anywhere in CSS or JS. |
| Three-surface model (v11.55) | canvas (navy) → card (`oklch(98%)`) → sunken (`oklch(96.3%)`). Fields use `--field-bg`, brighten to `white` on focus. Focus CSS uses literal `white`, not `var(--surface)`. Always use `background-color` longhand on fields (not shorthand — `<select>` arrow uses `background-image`). See `.claude/rules/css-tokens.md` for full surface, motion, and type-scale rules. |
| Motion vocabulary (v11.56) | `--ease-standard/emphasized/spring`, `--dur-fast/base` in `shared.css :root`. Every primary button uses `:active { transform: scale(var(--press-scale)) }` (`0.97`; `1` under reduced-motion). Nav-drawer pills keep opacity-based press. See `.claude/rules/css-tokens.md`. |
| Typography scale (v11.77) | `--type-micro` 10px · `--type-small` 12px · `--type-body` 14px · `--type-medium` 16px (also prevents iOS focus-zoom — never below 16px on focusable fields) · `--type-large` 18px. Consistent sizes across sub-pages. See `.claude/rules/css-tokens.md`. |
| Semantic elements (`<nav>`, `<header>`, `<main>`) | Screen readers depend on these landmarks. Do not revert to `<div>`. |
| SW caching: stale-while-revalidate for HTML + JS/CSS (v16.10; HTML was network-first v14.18–v16.09, changed with owner approval Jul 2026) | HTML, JS, and CSS are all served instantly from the version-pinned cache and refreshed in the background — no blocking network wait on any page open (network-first HTML cost 100–500ms per open, or the full 2s timeout on poor signal). An HTML cache MISS (first visit/evicted storage) falls back to the old network-first 2s race. Freshness propagates via the version-bump → new SW → new cache → warm-up → controllerchange-reload lifecycle for ALL code; roster DATA is live from Firestore, never from cached JS. Serving HTML and JS from the same version cache also shrinks the mixed-version deploy window network-first had. Do not revert without discussion. |
| Firebase SDK cache-first from an SDK-versioned cache (v16.10) | The gstatic SDK modules (version-pinned, immutable) are served cache-first from `myb-roster-sdk-v{FIREBASE_SDK_VERSION}` and warmed with the app — offline launch no longer depends on the browser HTTP cache keeping ~400 KB of CDN files (evictable under storage pressure on budget Androids). The SDK cache survives app version bumps and is swept only when the SDK version changes. **Bumping the SDK in `firebase-client.js` requires bumping `FIREBASE_SDK_VERSION` in `service-worker.js` in the same commit** — enforced by `sw-asset-check.test.mjs`. |
| `isChristmasRD()` applied before Firestore overrides | Forces Dec 25 and Dec 26 to RD first; Firestore can then override Dec 26 to RDW for overtime. Never reorder this. |
| `getBaseShift(member, date)` for all base shift lookups | Direct access to `roster.data[week][day]` bypasses `startDate` suppression, Christmas rules, and future base-shift logic. Always call `getBaseShift()`, never read `roster.data` directly. |
| Type pills in admin — single source of truth (v13.48) | `PILL_TYPES` in `admin-overrides.js` is the one authoritative list. `renderWeekGrid()` generates per-row pills from it; `admin-app.js` generates the bulk-bar pills from it at init (the `#bulkTypePills` div in `admin.html` is empty — populated at runtime). Order: AL · Shift · RDW · Absent · Rest Day · Other (v15.37; renamed from Training v15.40; **Spare moved OUT of the top row into the Other submenu v15.57** — a rarely-used placeholder, so 6 top pills now). Never hardcode either list. Other reveals per-row sub-controls (full-word flavour chips Training/Induction/Assessment/Team Day + **Spare** — later Meetings/Union duties — + a pre-ticked-on-rest-day RDW tick + OPTIONAL times — `timesOptional: true`); the save collector composes the grammar `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`. **Spare is special-cased:** it stays its own `spare_shift`/'SPARE' override type (📋 purple badge, not worked), so picking Spare in the submenu writes a `spare_shift` (not an 'other' day) and hides the RDW tick + times. |
| **`AL` pill label must stay as `AL`** | Compact mobile layout requires short labels. `AL` is the standard Chiltern abbreviation. Do not expand without discussing layout impact. |
| **`🪑` is the absence emoji — do not change** | Absence covers sickness, childcare, bereavement, and other reasons. Using 🤒 implies illness — GDPR concern. The reason for absence is never stored. **Always ask Gareth before changing the absence icon.** |
| `_staleMemberName` flag in `calendar-app.js` | When `getSelectedMemberIndex()` can't find a saved name, sets flag, falls back to default member. On the next page open the banner fires via `_showStaleMemberBanner()` — called from the pre-branch init block for team-view users (v14.08), or from inside `renderCalendar()` for calendar-view users. `takeStaleMemberName()` is one-shot so only one path fires. |
| Sync chip state machine in `calendar-app.js` | hidden → (800ms) → "↻ Updating…" → silent remove on success, or "⚠ Couldn't update" (stays, 10s timeout). "✓ Up to date" removed (v10.19) — noise. Never show raw errors to staff. |
| App Notices system (v13.36) | `nav-panel.js` owns the archive: `archiveNotice({ id, title, section, date, body })` writes to localStorage `myb_app_notices` (capped at 50 entries, deduped by `id`). "📣 App Notices" in `NAV_INFORMATION` opens the archive panel. Notice lightboxes live on individual pages; see **"One-time notice pattern"** section below for the full creation guide. Current notices are tracked in that section's table — do not duplicate the list here. |
| `_clearState` / `CONDITIONAL_ROWS` in `paycalc-app.js` | `_clearState` groups destructive-clear state atomically (includes `countdownTimer`). `CONDITIONAL_ROWS` is data-driven: condition → row/field IDs — add a new conditional row by adding one array entry. See `.claude/rules/paycalc.md`. |
| `touch-only` CSS class in `shared.css` | `display:none` by default; revealed via `@media (pointer: coarse)`. Use for touch-only UI. Do not use inline `display:none`. `(hover: hover)` inverse was dropped (v10.15) — some Android devices misreport it. |
| `window.matchMedia('(pointer: coarse)')` in `initSwipeHint()` | Gesture-tutorial UI must only show on touch devices. Always add this guard. |
| **Do not gate layout on `(hover: hover) and (pointer: fine)` alone** | Some Android devices misreport `hover: hover`. For layout breakpoints, always use `min-width`. Hover/pointer queries are only safe for cosmetic `:hover` transitions. |
| `paycalc.html` desktop grid on `<main>` | CSS grid applies to direct children only — declare on `main { display: grid }`. `.app` only holds max-width. |
| `lsGet` / `lsSet` / `lsDel` / `lsKeys` from `ls.js` | iOS Safari private mode throws `SecurityError` on any `localStorage` access. **Never call `localStorage` directly** in `calendar-app.js`, `admin-app.js`, or `paycalc-app.js` — always use these wrappers. `lsKeys()` (v14.11) returns a safe snapshot of all key names for code that must enumerate storage (e.g. the paycalc namespace migration). |
| Per-member paycalc localStorage namespacing (v14.11) | On a shared device two staff must not read each other's pay data. Every per-member key carries a member segment `myb_pc_<slug>_…`; `pcPrefix()` in `paycalc-migrations.js` is the single source, and `SK` + every `…Key()` builder (incl. `settingsKey` in `paycalc-settings.js`, `snapKey` in `paycalc-roster-hint.js`) derive from it. `setPaycalcNamespace(memberName)` runs once in `runMigrations` before `loadSettings`. Pre-existing **shared/legacy** unnamespaced data is **not** silently claimed — `hasPendingLegacyMigration()` triggers a one-time ownership prompt (mine → move / fresh → discard / ✕ → decide later; `resolveLegacyMigration` sets the one-shot `myb_pc_ns_migrated` guard). **Device-level keys stay unnamespaced** (see `DEVICE_KEYS`). Never namespace device flags, and never read/write a paycalc key without `pcPrefix()`/`SK`. Full detail: `.claude/rules/paycalc.md`. |
| VAPID fingerprint migration | Both pages store first 12 chars of VAPID key in `localStorage('myb_vapid_ver')`. On mismatch, silently unsubscribes → re-subscribes. Cloud Function `fanOutPush` deletes a subscription ONLY on 410/404 (genuinely dead); a 401 is a VAPID-auth failure (server misconfig, not a dead endpoint) and is logged, NOT deleted — deleting on 401 would wipe the whole collection on any VAPID key error (v16.15). |
| One-off notification prompt (`#notifPrompt`) | Appears once per device between `</nav>` and pay-period strip. Both Enable and × set `myb_notif_prompt_done`. Do not move below the calendar. |
| PWA shortcuts in `manifest.json` | Three long-press shortcuts. Changes require reinstall to take effect on existing installs. |
| Paycalc desktop workspace + sticky bar (`#stickyTotal`) | ≥1024px: THREE-column grid — Hours + Settings span the two wide work columns (cols 1–2); a **col-3 sidebar** (`.pc-side`) stacks the **result card + the four occasional cards** in one column (v16.67, owner-approved — replaced the v16.14 lone-sticky-rail, whose empty col 3 was a full-height navy void). `.pc-side` is `display:contents` on mobile (DOM order unchanged) and a `flex` column on desktop, `grid-row: 4 / 6` (span only the rows the left cards occupy — a wider span makes grid distribute the sidebar over empty rows → phantom footer gap). The result is **no longer sticky**; the `#stickyTotal` fixed bottom bar (all widths, capped to `--content-max-width`, centred) keeps the take-home £ visible while scrolling. `IntersectionObserver` + `body.sticky-active`. Residual imbalance (left cards inherently taller) sits at the bottom-right, the least-prominent spot. See `.claude/rules/paycalc.md`. |
| 3-digit time input auto-correction in `admin-overrides.js` | On blur, if length is 3 and `parseInt(raw.slice(0,2)) > 23`, prepend `'0'`. Without this, `"630"` produced `"63:0"`. |
| Range picker clear button (`.rp-clear`) | Resets both `from` and `to` dates. Built into `buildRangePicker()` in `admin-rangepicker.js`. |
| **Sundays are non-contracted — AL and Absent cannot be recorded on Sundays** | Sundays are uncontracted for all grades (CEA, CES, Dispatcher). Neither `annual_leave` nor `sick` overrides may be written for a Sunday. Enforcement (do not remove any layer — they work together): (1) `admin-overrides.js` week grid disables both the AL and Absent pills on Sunday rows; (2) the bulk-apply bar silently skips Sunday rows when AL or Absent is the active type; (3) `recordRangeOverrides()` filters Sundays out of `workingDates` before writing overrides; (4) roster upload — `computeCellStates()` in `admin-roster-upload.js` normalises a Sunday PDF `AL`/`SICK` to `RD` (so it classifies as MATCH and is never written), with `shiftValueToOverrideType()` → `correction` plus a `value:'RD'` write-path backstop for the edited-cell path; (5) **display** — `calendar-app.js` calendar render and month-legend both suppress a `sick` override when `isSunday(dateStr)` (in addition to base `RD`/`OFF`), so absence never renders on a Sunday even from legacy data when the rotating roster brings a worked Sunday into the range (v12.61). A worked Sunday time is always RDW, never AL/Absent. |
| Sunday RD corrections on absence/AL save | Every Sunday in the range is checked; if `getBaseShift` returns a non-RD shift, an explicit `correction/RD` override is written alongside the AL/sick overrides. Used in both save handlers. |
| Range picker swipe — pointer capture on `grid` not `clip` | Events dispatched to a capture target do not bubble down to children — captures on `clip` breaks the drag animation. |
| Team Week View | Available to all logged-in staff. Grade state (`currentTeamGrade`) persists across re-renders. Fetch token = week-start timestamp — stale Firestore results are discarded. Week navigation clamped to `CONFIG.MIN_YEAR`/`MAX_YEAR`. **No override-load status indicator** — deliberately not added (minimal-noise app). A review (Finding #5, Team View half) proposed a "freshness warning" when a Team View week fetch fails; **accepted as won't-do** — it IS an override-load status indicator, so it's covered by this rule. The failure path is already safe without one: `fetchTeamWeekOverrides` reconciles only on a successful snapshot (no partial-data poisoning) and discards stale results via the fetch token, so a failed refresh keeps the last-good grid silently. The far-month calendar fetch half of the same finding was closed by test coverage of its silent fallback (`calendar-overrides.test.mjs`). |
| `persistentLocalCache()` in `firebase-client.js` | Firestore stores queries in IndexedDB. Do not revert to `getFirestore()` — Huddle viewer and override cache depend on instant load. |
| `subscribeToLatestHuddle` in `firebase-client.js` | Persistent `onSnapshot` — Huddle viewer updates automatically when a new Huddle arrives. Do not replace with one-time fetch. |
| `normaliseSurname()` in `auth-identity.js` (v12.04; moved out of `firebase-client.js` v16.50) | Shared surname derivation for Firebase Auth: lowercases and strips non-alpha (the ≥6-char padding for the Firebase *password* is applied separately by the password builders in `session.js` / `functions`, **not** inside `normaliseSurname`). Lives in the pure `auth-identity.js` (so it's unit-testable) and is **re-exported by `firebase-client.js`**; `getSurname()` in `session.js` delegates to it. A deliberate duplicate also exists in `functions/roster-parse-helpers.js` — Cloud Functions are CommonJS and cannot import browser ES modules, so unification requires a build step. If the rule ever changes, update both locations (surname-parity.test.mjs enforces it). |
| `cors: ADMIN_FUNCTION_ORIGINS` on `parseRosterPDF` and `setupRosterAuth` | Both functions restrict CORS to an explicit origin allowlist (`ADMIN_FUNCTION_ORIGINS` in `functions/index.js`: `garethdavidmiller.github.io`, `myb-roster.web.app`, `myb-roster.firebaseapp.com`) — defence-in-depth on top of the real control, which is Firebase ID token + admin claim. Add any new hosting domain to that array. `ingestHuddle` keeps `cors: false` (server-to-server). |
| Android Back button overlay pattern | Overlays push `history.pushState({ mybOverlay: true })` when opening, close on `popstate`. `_pushOverlayState(handler)` / `_clearOverlayHistory()` helpers in all six app pages. |
| Canonical lightbox lifecycle (standardised v11.50, factored into `createLightbox` v12.50) | Every `.lb-overlay` lightbox (About, AL, Team info, Month jump, per-card Tips, paycalc Help/Welcome, links Beta) is built with **`createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose })` in `overlay.js`** — do NOT hand-write the lifecycle in a page module. It implements focus save/restore, `.visible`→`.open`, `lockBodyScroll`, Android Back (`_pushOverlayState`), Escape, the `trapFocus` Tab trap, and backdrop/closeBtn close — including a **mandatory 500ms `transitionend` fallback** (iOS suppresses `transitionend` on a backgrounded tab; reduced-motion finishes synchronously). Close controls are `<button class="lb-close">` (never `<span>` — not keyboard-focusable). The shared About/Tips panels are `about-lightbox.js` / `tips-lightbox.js`. **Exceptions:** the coming-soon lightbox is owned **only** by `nav-panel.js` (shares the drawer's history entry — never re-wire `#navComingSoonLightbox` or migrate it to `createLightbox`); the huddle viewer (`#huddleViewer`) is a full-bleed panel, so it has no overlay-click-to-close (intentional). Full lifecycle detail: AI_MAP → `overlay.js`. |
| Nav panel on all 6 pages (v10.57, extended v10.99 + v11.06 + v12.07) | `nav-panel.js` injects overlay + drawer. Burger button `#navMenuBtn` in each page header. `NAV_PAGES` drives the pill row (current page omitted). `NAV_INFORMATION` drives the flat always-open section (Workplace: Daily Huddle, Weekly Retail Circular, Marylebone Newsletter, App Notices). `NAV_GUIDES` (v11.21) drives a separate **expanded-by-default** "📖 Guides" submenu (Staff & Admin Guide, Pay Calculator Guide, Railcard Guide, FIP Travel Guide) — toggled by `#navGuidesToggle`, list is `#navGuidesList` (change to `hidden` and `aria-expanded="false"` if the section becomes too long to show open). Adding a guide = one entry in `NAV_GUIDES`; adding a live doc = one `links` entry in `NAV_INFORMATION`. A `NAV_INFORMATION` entry with `comingSoon: true` (instead of `url`) renders as a `<button>` that opens the injected `#navComingSoonLightbox` placeholder instead of navigating. |
| Dark (navy) drawer + scoped tokens (v11.54) | Continuous navy surface. Scoped tokens: `--nav-raised/strong`, `--nav-text/muted/faint`, `--nav-border`. Admin pill = `--nav-raised` + gold text (not navy-fill). Do not revert to white drawer. See `.claude/rules/css-tokens.md`. |
| Nav-panel logo = About; drawer head shows version (v11.21) | The drawer head is a `#navPanelBrand` button (logo + title + `Version {APP_VERSION}` muted text). Tapping it closes the panel (via `closePanelForNavigation`) then calls `onLogoClick`, which each page passes as `() => openAboutLightbox?.()` — opening that page's existing `#iconLightbox` (version, update status, bug report, and page-specific print/guide links). Each page exposes its scoped open fn through a module-level `let openAboutLightbox` assigned inside its About-lightbox IIFE. This replaces the header logo's old role (see header-logo back button entry). |
| Settings page — shared session, flat nav link (v11.06) | `settings.html` uses the same `AUTH_KEY` as `admin-app.js` — a user already signed in on any page arrives without seeing the login overlay. `initNavPanel` is called at module scope in `settings-app.js` regardless of sign-in state so unsigned users can navigate away via the Calendar/Admin pills. Settings link renders outside the scrollable `nav-panel-body` (pinned above footer) so it is always visible without scrolling. Hidden only on the settings page itself. Styled as a flat link (not a pill). `--indigo` badge colour. |
| Nav-panel footer initials badge (v12.22) | The footer shows a 26px circular badge (`#navPanelAvatar`) before the member name — previously showed a profile photo, now always shows initials on a stable per-name colour. `avatarInitials(name)` and `avatarHue(name)` from `roster-data.js` are called directly in `nav-panel.js` — no fetch, no localStorage, no event listeners. Profile photo feature removed at v12.22; full spec and revert checklist in ROADMAP.md → "Profile photo / avatar". |
| Operations page — admin-only pill (v10.99) | `NAV_PAGES` entry for Operations has `adminOnly: true`. `initNavPanel({ isAdmin })` filters it out for non-admins. `calendar-app.js`, `admin-app.js`, and `paycalc-app.js` pass `isAdmin: CONFIG.ADMIN_NAMES.includes(member)`. `operations-app.js` passes `isAdmin: true` (page already guards against non-admins). When NOT signed in, Operations shows the **shared in-place login** (`login-overlay.js`, v14.45+) — it no longer redirects to `admin.html` to authenticate. A signed-in **non-admin** is still redirected to `admin.html` (that is access control, not a login divert). |
| Links page — access control (v12.06) | `linksDesignerOnly: true` in `NAV_PAGES`. Add name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` to grant access. Current designers: `’G. Miller’`, `’S. Silva’`. |
| Links page — beta marker + first-visit notice (v12.33) | Gold-OUTLINE `.beta-chip` beside the solid `.badge-page`. First-visit `#betaLightbox` via `createLightbox`; gated on `lsGet(‘myb_links_beta_seen’)`. See `.claude/rules/links-design.md`. |
| Links page — design and save model (v12.09–v12.47) | Multi-design Firestore collection `linkDesigns` `{ name, patterns, updatedAt, updatedBy }`. 28-line full rotation — every line must carry a real pattern. CEAs do not work nights. Auto-generator is the only way to create a new design. Grid clicks delegated on `#linksGridBodyRows`. Position keys always `String`. See `.claude/rules/links-design.md` for full grid/paint/generator/coverage/checks/concurrency/print detail. |
| Header back button removed (v10.63) | `admin.html` / `paycalc.html` no longer have a header `←` back button — it duplicated the nav drawer's Calendar pill (two competing nav paradigms) and clashed visually with the logo box. Navigation back to the roster is via the drawer. Header is now `[☰] [logo] Title … [badge]`. The admin "open calendar on the month I was editing" behaviour moved from the back button onto the `.nav-panel-pill--calendar` click in `admin-app.js`. `.btn-back` CSS removed from `shared.css` (still defined locally in `fip.html` / `railcard-guide.html`). |
| Header logo = back to calendar on sub-pages (v11.21) | On `admin.html` / `paycalc.html` / `operations.html` / `settings.html` the header logo `#appIcon` now navigates to `./` (the app root — `./index.html` 301s on Firebase Hosting, a wasted round trip per tap; changed v16.09) (`title`/`aria-label` = "Back to calendar"). This restores an iOS-friendly back affordance (iOS standalone PWA has no system back) without re-adding a visible back button — kept "invisible" as just the logo. The About lightbox it used to open moved to the **nav-panel drawer logo** (see that entry). The **calendar page keeps its header logo opening About** (`.title-icon` in `calendar-app.js`) — home has no "back" target. Do not wire the calendar header logo to navigate. |
| `.app-header` brand centering (v10.66) | `admin.html` / `paycalc.html` headers use `display:grid; grid-template-columns:1fr auto 1fr`. Burger sits in col 1 (`justify-self:start`), logo+title in an `.app-header-brand` flex wrapper in col 2 (auto, truly centred), badge in col 3 (`justify-self:end`). Equal `1fr` side columns guarantee the brand is always centred regardless of burger/badge width asymmetry. The calendar uses a different `.header` (balanced spacers), unaffected. |
| Sign-out in nav panel footer (v10.59) | Sign-out button moved from page headers to the nav panel footer. `initNavPanel({ onSignOut: fn })` — each page passes its own sign-out callback. Footer (member name + Sign out button) renders only when `onSignOut` is supplied. `.btn-signout` CSS removed from `shared.css`. |
| Notification bell in nav panel footer (v10.61) | `notif.js` is the shared Web Push module; `nav-panel.js` imports it and renders a 🔔/🔕 toggle in the footer (signed-in only, hidden when `notifSupported()` is false — incl. iOS non-standalone). Bell refreshes on every panel open; tap keeps the panel open. States: `on`/`off-default`/`off-lapsed`/`denied`/`unsupported`. `calendar-app.js` and `huddle.js` also import `notif.js` — VAPID key and subscribe/unsubscribe logic live in one place (v10.79). The `#notifPrompt` calendar strip stays on the calendar; the Notifications card lives on settings.html (moved v11.06). **The bell is a COMPACT icon next to Sign out (`.nav-panel-bell`)** — a labelled full-width "Notifications — On/Off" row has been tried and reverted TWICE (v13.14→v13.19, v16.56→v16.75; owner decision: the settings.html Notifications card is the canonical surface, the drawer bell is just a quick toggle). Don't re-promote it without a fresh discussion. |
| Guide pages back button → index.html (v10.57) | `railcard-guide.html` and `fip.html` back buttons now link to `./index.html` (not `./admin.html`) — guides are accessed from the nav panel, not the admin page. |
| Maskable icons | 512px entry uses `"purpose": "any maskable"` for Android adaptive shapes. Smaller icons omit this. |
| **Chiltern payroll rules** | Rostered Sat → `sat` (1.25×); Sat-on-RD → `rdw`. Sunday-on-BH: Sunday wins (1.5×) — `dow===0` before `isBH`. BH + `rdw` is additive (`bhOt` + `bh`). Confirmed May 2026; tests assert. See `.claude/rules/paycalc.md` for full detail. |
| `initALSection()` / `initSickSection()` in `admin-app.js` | `alMember`, `sickMember`, `syncMemberDisplay`, `syncSickMemberDisplay` are hoisted to module scope above the `fieldMember` change handler — that handler fires before init. Do not move them inside the init functions. |
| SW synthesised offline page uses status 200 | Some browsers suppress 5xx response bodies. `Cache-Control: no-store` prevents caching the synthesised page. |
| SW offline fallback only for navigation requests (v10.15) | Only `event.request.destination === 'document'` requests get the offline HTML page. JS/CSS get `Response.error()`. Without this, `/admin-app.js` matched `'admin'` in the fallback logic and got HTML for a JS request — MIME-type error. Fallback routing chain (v11.87): `paycalc` → `paycalc.html` · `operations` → `operations.html` · `settings` → `settings.html` · `admin` → `admin.html` · otherwise → `index.html`. |
| Huddle notification → `#huddle` hash pattern | SW navigates to `#huddle`; `calendar-app.js` `hashchange` handler triggers the viewer (`_autoOpen` is `let` so it can reset). **Two viewer paths — do not unify, do not revert notification path to direct `window.open`/`location.href`:** `htmlContent` present (DOCX converted server-side) → renders inline in both paths. No `htmlContent` (PDF or failed conversion) → the viewer shows an in-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`); its click is a real gesture (a direct `window.open`/`location.href` on a hash-open would be pop-up-blocked or knock the PWA out of standalone). The viewer is opened **only** via the `#huddle` hash — from both the nav-panel "Daily Huddle" link and notification taps (the old `#huddleBtn` was removed at v12.57). `huddles` Firestore reads are open (no auth) — `calendar-app.js` has no Auth session, so requiring auth would break auto-open on fresh visits. Full rationale: **OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour"**. |
| `isBeforeMemberStart(member, date)` in `override-utils.js` (v10.16) | Returns true if `date` is before the member's `startDate`. Always use this helper — never inline the date comparison. |
| `navigateToPaycalc(paydayStr)` in `calendar-app.js` (v10.17) | Encapsulates session-check-then-navigate for payday and cutoff cell clicks. Always call this helper — never duplicate the navigation logic. |
| SW `new Request(url)` fetch pattern (v10.16) | `new Request(event.request.url, { cache: 'no-store', ... })` instead of passing opts to an existing Request. Passing opts alongside a Request doesn't reliably override cache mode on older Safari/Chromium. |
| `initErrorReporter()` call pattern (v13.78) | Writes to Firestore `clientErrors`, so a valid auth token is required. Three canonical call sites: (1) **`calendar-app.js`** — wait for auth persistence to load, then sign in anonymously only if no named user is already present: `authReady.then(()=>auth.currentUser?null:signInAnonymously(auth).catch(()=>{})).catch(()=>{}).finally(()=>initErrorReporter())` — this preserves a named identity (e.g. admin opened admin.html first) instead of racing with or replacing it; (2) **Authenticated pages with `sessionReady`** (`admin-app.js`, `settings-app.js`, `operations-app.js`, `links-app.js`) — call `sessionReady.then(()=>initErrorReporter())`; (3) **`paycalc-app.js`** (no `sessionReady`, uses `ensureFirebaseSession` directly) — call `ensureFirebaseSession(name).catch(()=>{}).finally(initErrorReporter)`. Never call `initErrorReporter()` bare without an auth context — writes will be silently rejected by Firestore rules. |
| Work email check — login-gated, ~3-monthly (v13.68; Fix 4 + cadence v14.77) | `_runEmailCheck(member)` in `admin-app.js` is the inner engine; `initEmailCheck(member)` is a thin wrapper called (fire-and-forget) on every authenticated page load. **Trigger (v14.77):** it shows ONLY when (a) a one-shot `myb_email_check_pending_{member}` marker is present — set by `showAdminLogin`'s `onSuccess` on a real login, consumed on the next load — so it never appears on a random Admin page load (Fix 4), AND (b) the member is **due**: `_emailCheckDue()` is true when `myb_email_check_done_{member}` (now the last-confirmed **timestamp**, ms) is absent / legacy `'1'` / ≥ 3 months old (`EMAIL_CHECK_INTERVAL_MS`). `_dismiss()` stamps `Date.now()` so it's not due again for ~3 months. (Pre-v14.77 it was off the login critical path since v14.74 — the login freeze fix; it must never block sign-in.) Fetches `getStaffContact(member)` with a 4s timeout; on timeout/error returns silently (never blocks the app). Shows `#emailCheckOverlay`: confirm view ("Yes" / "Use a different email → ← Back") or add view (email input + save). **No ✕ close button** — mandatory once shown. Also editable any time via Settings. |

---

## One-time notice pattern

Full HTML template, JS patterns (close-only and CTA+snooze), rules table, and monthly cleanup instructions are in `.claude/skills/new-notice/` — invoke `/new-notice` when adding a notice.

**Current notices** (keep this table current — monthly cleanup removes entries older than 180 days):

| ID | Page | Title | Badge | Posted | Expiry | Dismiss mechanism |
|----|------|-------|-------|--------|--------|-------------------|
| `ytd_2627` | `paycalc.html` | Enter your YTD figures | 💷 Pay | 6 Apr 2026 | 90 days | One-time; `NOTICE_YTD_KEY` set on close |
| `links-beta-2026` | `links.html` | Links Workspace | 🔗 Links | 9 Jun 2026 | 28 days | One-time; `myb_links_beta_seen` set on close |

**Monthly cleanup:** on the 1st of each month, remove any notice from the table where `(today − Posted) > 180 days` — delete the HTML block, JS IIFE, and bump the version.

---

## Payday calculator — integrated (v6.50)

| Component | Location |
|-----------|----------|
| `getPaydaysAndCutoffs(year)` | `roster-data.js` |
| `isPayday(date)` / `isCutoffDate(date)` | `roster-data.js` |
| 💷 / ✂️ calendar markers | `calendar-app.js` — `.payday` / `.cutoff` CSS classes |
| `getRosterSuggestion(p, member)` | `paycalc-roster-suggestions.js` — counts Sat/Sun/BH/Boxing Day/RDW. **Conservatism policy (v9.02, permanent):** does NOT infer ambiguous categories (swap shifts, rest-day weekday overrides). |
| `getEffectiveContr(p)` | `paycalc-settings.js` — contracted hours, pro-rated if member has `startDate` in the period |
| Reference guide | `paycalc-guide.html` |

---

## Shift types

| Value | Badge | Meaning |
|-------|-------|---------|
| `'RD'` | 🏠 Rest | Rest day |
| `'OFF'` | 🏠 Rest | Off day — bilingual roster only, treated identically to RD |
| `'SPARE'` | 📋 Spare | On standby, shift not yet assigned. Type `spare_shift`. Recorded via the **Other** pill's submenu (v15.57 — demoted from a top pill), but stays its own type/badge |
| `'RDW'` | 💼 RDW | Rest day worked — overtime |
| `'AL'` | 🏖️ AL | Annual leave |
| `'SICK'` | 🪑 Absent | Sick/absent day — recorded via override |
| `'HH:MM-HH:MM'` | ☀️/🌙/🦉 | Worked shift |
| `'TRG'` / `'IND'` / `'ASSESS'` / `'TEAM'` (+ optional `' RDW'`, `' HH:MM-HH:MM'`) | 🏷️ Train / Ind / Assess / Team | The **"Other" family** (v15.35; evolved v15.40, Team Day v15.51, OTHER_PLAN.md): Training / Induction / Assessment / Team Day — later Meetings / Union duties. `'TEAM'` appears on the roster as the multi-word label "Team Day" (parser collapses it to the `TEAM` sentinel). LEAF-GREEN `other-day` family (`--other`, hue 136° — deliberately NOT bronze, which was hue-identical to Early's orange); hours slot shows actual times → `RDW` → base time; tap shows the FULL word; pays as the day underneath (`resolveOtherPay` in `override-utils.js`); Sundays and Boxing Day (26 Dec) can never be training/Other days (confirmed by Gareth Jul 2026). The unknown-value fallback classes were renamed `unknown-day`/`badge-unknown` (v15.40) to free the `other-*` names |

**Classification:** Early 04:00–10:59 · Late 11:00–20:59 · Night 21:00–03:59

**isWorkedDay:** false for RD, OFF, SPARE, AL, SICK. True for everything else including RDW.

---

## Roster data structure

### teamMembers fields

```javascript
{
  name: 'G. Miller',       // MUST match Firestore memberName exactly
  currentWeek: 3,
  rosterType: 'main',      // 'main' | 'bilingual' | 'fixed' | 'ces' | 'dispatcher'
  role: 'CEA',             // 'CEA' | 'CES' | 'Dispatcher' | 'Management'
  hidden: false,           // Optional — hides from dropdown
  managerOnly: false,      // Optional — login-only manager/clerk account (Management group); hidden from the calendar member selector, has no roster of its own
  permanentShift: 'early', // Optional — forces early/late badge on all worked days
  startDate: new Date(2026, 3, 20), // Optional — midnight local time: new Date(year, month-1, day)
  noProRate: true,                  // Optional — set for secondment returns: startDate suppresses pre-return shifts but pay and AL are full-year (no pro-rating in paycalc; joiner banner hidden)
  proRatedAL: { 2026: 23 }, // Optional — overrides getALEntitlement for joining year only
  rosterChanges: [{ from: new Date(2026, 6, 1), rosterType: 'ces', currentWeek: 4 }] // Optional — scheduled roster moves
}
```

**`rosterChanges` (v12.31)** — date-driven roster transitions for a member who changes rosterType/link mid-life (e.g. a new starter on a temporary `fixed` pattern who later joins a rotating link). Each entry is `{ from: Date, rosterType, currentWeek }`; from `from` (midnight, **inclusive**) onward the member follows that rosterType/currentWeek instead of the base fields. Array must be **sorted ascending by `from`** — the latest entry whose `from` ≤ date wins. Resolved by `resolveMemberRoster(member, date)` in `roster-data.js`; `getBaseShift` and `getWeekNumberForDate` apply it automatically, so **no call site needs special handling**. The base `rosterType`/`currentWeek` describe the member *before* the first change. `startDate` (join-date RD suppression) is independent and still applies.

**AL entitlement** (`getALEntitlement` in `roster-data.js`) — `proRatedAL[year]` takes priority before any role check:

| Role / type | Days |
|-------------|------|
| CEA (main, bilingual, fixed — incl. C. Reen's fixed line) | 32/year |
| CES (`ces`) | 34/year |
| Dispatcher | 22 + 1 lieu per BH worked (`countDispatcherBankHolidaysWorked`) |

### Roster cycles

| Type | Weeks |
|------|-------|
| main | 20 |
| bilingual | 8 |
| fixed | 1 per member, no rotation — `currentWeek` selects which fixed pattern in `fixedRoster` (1 = C. Reen 12:00–19:00; 2 = S. Boyle / K. Jedlinski 09:00–16:00) |
| ces | 10 |
| dispatcher | 10 |

### Firestore collections

**overrides**
```
date         "YYYY-MM-DD"
memberName   Must match teamMembers[n].name exactly — one char mismatch = silent failure
type         "spare_shift" | "shift" | "rdw" | "annual_leave" | "correction" | "sick" | "other"
             Legacy (still in data, not creatable): "allocated" | "overtime" | "swap"
value        "HH:MM-HH:MM" for shift/rdw; "SPARE" for spare_shift; "AL" for annual_leave; "RD" for correction; "SICK" for sick;
             training uses the grammar FLAVOUR[" RDW"][" HH:MM-HH:MM"] — flavour "TRG"|"IND"|"ASSESS"|"TEAM", optional rest-day
             marker, optional actual times (see OTHER_PLAN.md; grammar single-source: override-utils.js)
note         Free text — "" if none. Field must always be present.
source       "manual" | "roster_import" — required by Firestore rules; written by all override save paths
changedBy    Optional — display name of who last changed the override; type-checked by the rules when present
createdAt    Firestore server timestamp
```

**huddles**
```
date         "YYYY-MM-DD" — also the document ID
storageUrl   Permanent tokenised download URL (both manual upload and Cloud Function ingest — the ingest path uses a download token, NOT a signed URL: GCS caps v4 signed-URL expiry at 7 days, too short for the 3-month retention window)
storagePath  Firebase Storage object path, e.g. "huddles/2026-06-25-lv9kab12.pdf" — versioned suffix
             prevents overwriting the old file before Firestore commits; absent on docs written before
             versioned paths — uploadHuddle/pruneOldHuddles fall back to "huddles/{date}.{fileType}"
fileType     "pdf" | "docx" — short form on browser writes (rule-constrained to ['pdf','docx'] since v14.29);
             the Cloud Function ingest path uses the Admin SDK and may store a MIME string
uploadedAt   Firestore server timestamp
uploadedBy   Member name string (manual upload) or "power-automate" (Cloud Function ingest)
htmlContent  Converted HTML string — present when a DOCX was uploaded/ingested; absent for PDFs
```
Reads: open (no auth required — calendar-app.js has no session; see Huddle notification tap behaviour in OPERATIONS_REFERENCE.md).
Writes: require auth + admin claim. Cloud Function writes via Admin SDK (bypasses rules).
Auto-prunes: docs older than **3 months** (Firestore doc + Storage file) are deleted by `pruneOldHuddles()` in `functions/index.js`, awaited at the end of every `ingestHuddle` run (the daily path). Huddles are higher-volume than circulars/newsletters (which keep 6 months) and rarely referenced after the day, so retention is shorter (v14.29). Storage delete on `/huddles` requires the admin-delete rule (v14.29).

**staffContact** (v12.68)
```
memberName  Must match teamMembers[n].name exactly — used as the document ID
workEmail   Work email address (5–200 chars; must be the `@chilternrailways.co.uk` domain — case-insensitive, anchored so look-alikes/subdomains are rejected, and no whitespace in the local part). Enforced by firestore.rules AND the client `isChilternWorkEmail()` (roster-data.js, single source `CONFIG.WORK_EMAIL_DOMAIN`); keep the two in sync (v14.97; rule local-part whitespace tightened v16.34)
updatedAt   Firestore server timestamp
```
Read/write restricted: owner can read/write their own doc; admin can read all.
Write requires the `name` JWT claim (set by setupRosterAuth) — anonymous fallback sessions cannot write.
Purpose: Stage 1 of password security improvements. Email will enable future account recovery (Stage 4).
Read/written/deleted by: `getStaffContact` / `saveStaffContact` / `deleteStaffContact` in `firebase-client.js`, called from `settings-app.js`. `getAllStaffContacts` (reads all docs) called from `operations-app.js` (Work Email Progress card).

**pushSubscriptions**
```
endpoint     Browser push endpoint URL — also used (hashed) as the document ID
keys.p256dh  base64url-encoded p256dh public key
keys.auth    base64url-encoded auth secret
subscribedAt Firestore server timestamp — required by the rules
```
Written by `savePushSubscription`, deleted by `deletePushSubscription` in `firebase-client.js`.
Each document ID is a SHA-256 hash of the endpoint URL (first 20 hex chars). One doc per subscribed browser/device.
Read by the `ingestHuddle` Cloud Function (Admin SDK) when fanning out push notifications.
Client read: denied (`allow read: if false`) — no client may enumerate endpoints/keys. Create/update:
any authenticated session, shape-validated (`endpoint`, `keys.p256dh`, `keys.auth`, `subscribedAt` only). **Delete:
any authenticated session (`request.auth != null`) — there is no per-owner check, so an authenticated
identity that knows a doc id could delete that subscription.** Low risk (the id is a hash of the
endpoint, so it must be known) but a real hardening gap. Per-member override isolation shipped strict
(v16.29), but this pushSubscriptions delete-rule tightening is a separate item that remains open —
see `SECURITY_RELEASE_PLAN.md`.

**clientErrors** (v13.31)
```
memberName   Display name of the member whose session caught the error
page         Filename where the error occurred (e.g. "admin.html")
message      Error message string — capped at 300 chars
stack        Stack trace string — capped at 800 chars
appVersion   APP_VERSION string at time of capture
userAgent    navigator.userAgent — capped at 150 chars
timestamp    Firestore server timestamp (when the error occurred)
resolved     boolean — false on create; set to true by admin to dismiss
resolvedAt   Firestore server timestamp — set when an admin resolves; retention is measured from this (90 days), not from `timestamp`
```
Write: any authenticated session (`request.auth != null`); shape-validated by Firestore rules.
Read/update/delete: admin only (`request.auth.token.admin == true`).
Written by: `logClientError` in `firebase-client.js`, called fire-and-forget from `error-reporter.js`.
Read/resolved by: `getClientErrors` / `resolveClientError` in `firebase-client.js`, called from `operations-app.js` Error Log card. `getClientErrors` queries unresolved and resolved separately (single-field equality, no composite index) so unresolved records are always prioritised — within expected operational volume (< 100 unresolved at once) a backlog of resolved records cannot hide them. It returns `{ errors, truncated }`: the unresolved query shows at most 100 with **no `orderBy`** (an `orderBy` would need the composite index this design deliberately avoids), so above that volume the shown 100 are arbitrary — not the newest. It fetches `100 + 1` and sets `truncated` only when the extra row returns (i.e. > 100 genuinely exist, not exactly 100), so the card shows a "showing the first 100" banner rather than silently hiding the rest (no-silent-caps, v15.69). Prunes resolved records 90 days past `resolvedAt`.

**analytics** (v14.14) — anonymous usage counters; **no member identity is ever stored**
```
Document  analytics/pv_<YYYY-MM>   { month: "YYYY-MM", counts: { <pageId>: <int> } }  — page popularity per month
Document  analytics/activeAccounts { months: { "YYYY-MM": <int> }, daily: { "YYYY-MM-DD": <int> } } — unique active-account counts
Document  analytics/perf_<YYYY-MM> { month: "YYYY-MM", samples: { "<ver>|<page>|<metric>|<bucket>|<mode>|<conn>": <int> } } — page-load latency (Project 0, v14.89). Metrics: ttfb · fcp (first-contentful-paint, "appears") · domReady ("fully ready") · loginTotal (sign-in). admin loads excluded (v14.95)
```
Page ids: `calendar` | `admin` | `paycalc` | `operations` | `settings` | `links`.
Uniqueness of "active accounts" is deduped **client-side** (localStorage flags keyed by member name, which never leave the device) so the server only ever receives `increment(1)` — it stores *how many* accounts were active, never *which*. "Last 30 days" = sum of the `daily` buckets over the rolling window (each account self-suppresses for the window, so the sum is a true unique count). Counts are per account-device (multi-device users count more than once) — a usage trend, not an exact headcount.
Write: any authenticated session (`request.auth != null`), including the calendar's anonymous Firebase session. Values aren't individually validatable (Firestore can't restrict to increment-only) — App Check is the eventual integrity control; the data is non-sensitive aggregate counts. No client delete.
Read: admin only (`request.auth.token.admin == true`).
Written by: `recordPageView` / `recordActiveAccount` in `firebase-client.js`, called from `usage-reporter.js` (`recordUsage`) on every page. Read by: `getUsageStats` in `firebase-client.js`, called from `operations-app.js` Usage card (which also prunes daily buckets past ~35 days). Decision/aggregation maths is the pure `usage-stats.js` module.
The `perf_<YYYY-MM>` doc (Project 0, v14.89) holds anonymous page-load latency: `recordPageLatency(page, identity?)` in `perf-reporter.js` buckets Navigation Timing (`ttfb`/`domReady`) **and Paint Timing (`fcp` — first-contentful-paint, "appears on screen")** and calls `recordPerfSample` in `firebase-client.js`; key dimensions (version/page/metric/bucket/PWA mode/connection class) are non-identifying — no member, no raw ms. **Admin (developer) sessions are excluded** so figures reflect real staff. The Operations "App speed" card (`getPerfStats` → `initPageSpeedCard`) reads THIS month + LAST month and shows two journeys — 🔑 Signing in, and 📄 Opening pages as two milestones (✨ First appears / ✅ Fully ready) with both bars per page. Bucketing/verdict maths is the pure `perf-stats.js` module.

**Admin-exclusion (usage + speed, v14.95):** both `recordUsage` and `recordPageLatency` drop a session whose active member is in `CONFIG.ADMIN_NAMES` — the figures must reflect real staff, not the developer's own testing. It is a WRITE-time filter (no identity is stored, so it can't be filtered on read); historical pre-v14.95 data stays polluted, but is clean going forward. The Operations cards now also offer a **This month / Last month** window (month-over-month trend; last month is a stable full window early in a month) — active accounts keep their existing "Last 30 days" rolling figure.

**circulars** (v13.58)
```
date         "YYYY-MM-DD" — also used as the document ID; re-uploading the same date overwrites
storageUrl   Permanent tokenised download URL
storagePath  Firebase Storage object path, e.g. "circulars/2026-06-25-lv9kab12.pdf" — added v13.99
             (versioned suffix prevents overwriting the old file before Firestore commits);
             absent on docs uploaded before v13.99 — _pruneOldDocs falls back to "{collection}/{date}.pdf"
fileType     "pdf" | "docx" (Word uploads allowed since v16.31; no inline HTML conversion — a PDF opens directly, a Word doc opens via Microsoft's Office Online viewer (`officeViewerUrl`, v16.45) so it renders with images instead of downloading; rule-constrained to [pdf,docx])
uploadedAt   Firestore server timestamp
uploadedBy   Member name string
```
Read: open (no auth required — `calendar-app.js` has no session; matches Huddle model). Write: admin only (Storage rules also enforce PDF-or-DOCX, ≤20 MB).
Written by: `uploadCircular(date, file, uploadedBy)` in `firebase-client.js`, called from `operations-app.js`.
Read by: `getLatestCircular()` in `firebase-client.js`, called from **`nav-panel.js`** (☰ → Weekly Retail Circular — opens **directly** in a new tab, one tap: a PDF by its own URL, a Word doc via the Office Online viewer) and from **`calendar-doc-viewer.js`** (the `#circular` in-app viewer used by **notification taps only**, which have no user gesture to open the file directly).
Auto-prunes: documents older than 6 months are deleted (Firestore doc + Storage file) fire-and-forget on every upload via `_pruneOldDocs()` in `firebase-client.js`.

**newsletters** (v13.59)
```
date         "YYYY-MM-DD" — also used as the document ID; re-uploading the same date overwrites
storageUrl   Permanent tokenised download URL
storagePath  Firebase Storage object path, e.g. "newsletters/2026-06-25-lv9kab12.pdf" — added v13.99;
             absent on docs uploaded before v13.99 — _pruneOldDocs falls back to "{collection}/{date}.pdf"
fileType     "pdf" | "docx" (Word uploads allowed since v16.31; no inline HTML conversion — a PDF opens directly, a Word doc opens via Microsoft's Office Online viewer (`officeViewerUrl`, v16.45) so it renders with images instead of downloading; rule-constrained to [pdf,docx])
uploadedAt   Firestore server timestamp
uploadedBy   Member name string
```
Read: open (no auth required — `calendar-app.js` has no session; matches Huddle model). Write: admin only (Storage rules also enforce PDF-or-DOCX, ≤20 MB).
Written by: `uploadNewsletter(date, file, uploadedBy)` in `firebase-client.js`, called from `operations-app.js`.
Read by: `getLatestNewsletter()` in `firebase-client.js`, called from **`nav-panel.js`** (☰ → Marylebone Newsletter — opens **directly** in a new tab, one tap: a PDF by its own URL, a Word doc via the Office Online viewer) and from **`calendar-doc-viewer.js`** (the `#newsletter` in-app viewer used by **notification taps only**).
Auto-prunes: documents older than 6 months are deleted (Firestore doc + Storage file) fire-and-forget on every upload via `_pruneOldDocs()` in `firebase-client.js`.

**linkDesigns** (v12.09)
```
name        Design name
patterns    28-line full-rotation pattern data
updatedAt   Firestore server timestamp
updatedBy   Member name string
```
Read: any authenticated session (`request.auth != null`). Write: requires the `linksDesigner` claim OR `admin` (H2, shipped v16.29 — was any-authenticated write until then), AND (create/update, v17.02 — Finding #12) is **shape-validated**: `hasOnly(['name','patterns','updatedAt','updatedBy'])`, `name` a 1–100 char string, `patterns` a map, `updatedAt` a timestamp, `updatedBy` a ≤100 char string (delete carries no body). `linksDesigner` is set by `setupRosterAuth` from `CONFIG.LINKS_DESIGNERS`; `links-app.js` wraps every write in `writeWithClaimRetry` so a stale token self-heals, and saves atomically via `runTransaction` (v17.02 — Finding #13). Designs are **not** member-owned (no per-member isolation — any designer edits any design).
Written/read by: `links-app.js` (the multi-design workspace collection).

Override cache key: `"memberName|YYYY-MM-DD"`

### Authentication

Staff log in with name (dropdown) + surname as password (lowercase, no spaces/special chars). Sessions expire after 30 days (absolute) or 7 days of inactivity, whichever comes first — every successful page load refreshes the idle clock. `CONFIG.ADMIN_NAMES = ['G. Miller']` — elevated access. `CONFIG.LINKS_DESIGNERS = ['G. Miller', 'S. Silva']` — access to the Links design workspace.

The login dropdown groups members by grade (CEA · CES · Dispatcher · Management, in that order). `managerOnly: true` members (managers/clerks) appear **only** in the Management group and are hidden from the calendar's member selector — they have login access but no roster of their own. Their grade dropdown filtering lives in `admin-app.js` (`GRADE_ORDER`).

**Password security note:** Passwords are surname-derived and not secrets — protection relies on Firebase Auth rate-limiting (v9.53) and Firestore rules (`request.auth != null`).

Firebase SDK: currently v12.16.0. Check version before any new Firebase work. **An SDK bump must also update `FIREBASE_SDK_VERSION` in `service-worker.js`** (the SDK offline cache is keyed on it) — `sw-asset-check.test.mjs` fails the build if they diverge.

---

## Key rules

- **Offline first** — Firestore is an enhancement. Every Firestore call needs a silent fallback. Never block rendering waiting for Firestore.
- **Mobile is primary** — all staff use Android phones. Test every change at 375px.
- **Print CSS** — any new shift type, cell class, or badge needs `@media print` rules.
- **No `alert()`** — `console.error()` for developer errors. No visible error text for recoverable failures.
- **Code quality** — pure functions where possible, JSDoc on all functions, meaningful variable names, error handling on all async operations.

---

## Known issues & deferred work

Active constraints, deferred fixes, and the four v11 security tasks: **see `KNOWN_LIMITATIONS.md`**.
UX experiments tried and reverted, plus future capabilities: **see `ROADMAP.md`**.

**Do-not-change UI labels (Claude-relevant):**
- **Admin button label** — "Admin" = administration, not administrator. Intentional. Do not rename.
- **Shift type count** — 6 pills in the admin selector (v15.57; was 7 — Spare moved into the Other submenu). New day KINDS go into the Other submenu, not new top pills.

### Staff-facing wording conventions

Applies to **all user-visible copy** (cards, hints, tips, lightboxes, error banners, notifications) — not to code identifiers, data values, or comments.

**"the admin" vs "your manager" — who a staff member is told to contact:**
- **App / account matters → "the admin".** Anything about the app itself or a staff member's account: password reset, who can read a saved work email, a technical failure (roster won't display, a Huddle link is broken, data won't load). The admin (developer/app owner) fixes these.
- **Work / operational matters → "your manager".** Anything about the roster as work: booking annual leave, recording absence, shift changes, general rota queries. The manager owns these.
- Rationale: staff can't fix app faults by asking a line manager, and the admin isn't the right contact for an AL request. Matching the contact to the problem is the whole point. When in doubt, ask: *"is this a broken-app problem or a work problem?"*
- Note on data access: only the **owner + admin** can read a `staffContact` work email (Firestore rules) — a manager cannot — so "only you and the admin can see this email" is the factually correct phrasing, not "your manager".

**Canonical terms (use these exact forms in visible copy; established in the v15.05 wording sweep):**
- **"Change a Shift"** — never "override", "Recording a Shift Change", or "shift override" (the word "override" stays in code/data only).
- **"Absent" / "record an absence"** — never "sick"/"sickness" in UI copy (the reason is never stored — GDPR). The internal data value `SICK` and ids are fine.
- **"Year to Date"** — always spelled out, never bare "YTD". The two payslip figures are exactly **"Taxable Pay"** and **"Tax Paid"** (never "Gross Pay" for the YTD figure). See `.claude/rules/paycalc.md` → payslip line names.
- **"Fill from calendar" / "From your calendar" / "Replace with calendar values"** — the paycalc pre-fill reads the *calendar* function, not the base roster; do not reword to "roster".
- **"password reset (not available yet)"** — one phrasing for the future feature; never "recovery" or "coming soon".
- **App name "Marylebone Roster"** — the on-screen name everywhere (incl. bug-report `appLabel` as "Marylebone Roster — <Page>"). "MYB …" survives only in the iOS home-screen `apple-mobile-web-app-title` meta and line-2 HTML comments.
- **Documents:** "Daily Huddle" (proper noun), "Weekly Retail Circular", "Marylebone Newsletter".
- **Tone:** calm and factual — no exclamation marks, no marketing voice (mirrors `.claude/rules/notifications.md`).

---

## Huddle ingest

Daily Huddle PDF/DOCX → Power Automate → `ingestHuddle` → Firebase Storage + Firestore `huddles` collection + push notification. The upload button is labelled **"Choose file"** (not "Choose PDF") — intentional, Huddles can be PDF or DOCX.

Full flow diagram, request format, gotchas, and Security Rules: **see `OPERATIONS_REFERENCE.md`**.

**Push notification design language:** all Web Push payloads (Huddle, Pay, and future Circular/Newsletter) must follow `.claude/rules/notifications.md` — leading emoji = the feature's in-app icon, "Latest X" for document arrivals, calm/no-exclamation tone, monochrome badge, and a single `buildPushPayload` builder. Never hand-write a payload literal.

---

## Weekly Roster Upload

Admin uploads PDF → `parseRosterPDF` (model in `functions/index.js` `CLAUDE_MODEL` — currently `claude-sonnet-5`) → JSON → review UI → Firestore. Works for CEA/Bilingual, CES, and Dispatcher rosters.

**Critical:** `RDW|HH:MM-HH:MM` pipe encoding — AI returns `"RDW HH:MM-HH:MM"`, normalised to pipe in review, stripped to plain time on save. Do not strip `RDW` from the AI return value.

**`source: 'roster_import'`** on all roster-upload overrides — used by `computeCellStates()` for COVERED/DIFF/CONFLICT classification.

**`UNKNOWN|<raw>` sentinel (v15.30):** a non-empty cell `normaliseShift` can't parse is NOT defaulted to `RD` (which, when the base is also RD, silently dropped a real shift as a MATCH). It returns `UNKNOWN|<raw>`; `computeCellStates` maps it to a skip-only **UNREADABLE** review row — surfaced but never written (the save path only writes DIFF/CONFLICT). Empty/blank cells still → `RD`.

**Day-drift defence (v16.68) — three layers; a one-day shift can no longer be silently written.** The only entry point for a shifted row is the AI's visual ROW read (date assignment is deterministic: day-name keys → server dates). Layers: (1) `applySundayScanCorrections` — the original Sunday-anchored Case A/B repair; (2) **`applyColumnScanCrossCheck`** (`functions/roster-parse-helpers.js`) — the prompt now demands a second, column-by-column read (`columnScan`, generalising `sundayScan` to all 7 columns) and every cell is cross-checked row-vs-column: agreement → keep; a disagreement that realigns exactly under a one-day SUFFIX shift anchored at the first disagreeing day (a dropped blank shifts only the tail after it) with ≥2 disagreements and ≥5 signalled days → deterministic repair (two-source consensus); any other disagreement → the cell becomes `UNKNOWN|row or col? (PDF unclear)` — the skip-only UNREADABLE review state carrying BOTH readings. Fails open when `columnScan` is absent. (3) **`detectShiftedRow`** (`admin-roster-upload.js`, client) — the AI-independent signal: the parsed week is correlated against the member's OWN base roster at offsets −1/0/+1; if a ±1 alignment beats offset 0 by ≥3 matches (and scores ≥5/7), the review section shows a prominent "these days may be one day out" warning banner — catches the residual case where BOTH AI reads misread identically. Warn-only; nothing auto-changed client-side.

Full request/response format and review pipeline: **see `OPERATIONS_REFERENCE.md`**.

---

## Firebase Auth (complete — v7.94)

All staff have Firebase Auth accounts. Firestore rules require `request.auth != null` for all writes.

**Session re-establishment on page load (v10.93):** `admin-app.js` signs in to Firebase Auth
both on fresh login AND on every page load when a localStorage session already exists. This is
critical — a returning user with a valid 30-day localStorage session skips the login screen, so
without the page-load sign-in, `auth.currentUser` stays null and all Firestore writes fail.
`ensureFirebaseSession(name)` in `session.js` handles this: waits for `onAuthStateChanged`
(to detect any IndexedDB-persisted session), then signs in if none exists, self-healing a
missing account via `createUserWithEmailAndPassword` if needed. Do not remove this call.

**Per-member write isolation (STRICT — B2 built v14.53, B3 strict cutover shipped v16.29):**
`overrides` create/update/delete require the member's own `name` claim, OR an `admin`/`manager`
claim (both write on behalf). The rule is now **STRICT** — the old permissive `!('name' in token)`
escape (which allowed a token with no `name` claim so legacy/anonymous sessions could never lock
out) has been REMOVED. The v10.94 hard-cutover outage was avoided this time by the permissive→strict
CLAIM_EPOCH=2 token sweep (v15.33), which force-refreshed every active device onto its correct-tier
claim before the strict rule shipped; stale tokens now self-heal via `writeWithClaimRetry`, so no
mass sign-out is needed. **Three claim tiers**, all set by `setupRosterAuth`:
`{ admin: true, name }` for `ADMIN_NAMES`, `{ manager: true, name }` for `MANAGER_NAMES`, `{ name }`
for everyone else (admin outranks manager). The `manager` tier is load-bearing: managers edit staff
AL/sick/shifts on behalf daily — without the `manager` bypass the isolation rule silently locks
them out. Master-admin collections (huddles/circulars/newsletters/roster/auth) stay `admin`-only —
do NOT grant managers `admin: true`. **Deploy prerequisite:** managers must be re-provisioned
(Operations → Set up accounts, which now sets the `manager` claim) AND token-refreshed before the
isolation rule is relied upon — a stale manager token has `name` but not `manager`. Full scope,
runbook, and the B3 strict step (shipped v16.29): `SECURITY_RELEASE_PLAN.md` → B2/B3; history:
KNOWN_LIMITATIONS.md task #2.

**New starter:** invoke `/new-starter` — the skill has the full 3-step checklist, mid-year field reference, and pro-rata formula invariant.

**Removing a staff member:** Set `hidden: true`, run Set up accounts → "Disable accounts for leavers".

Email/password convention: **see `OPERATIONS_REFERENCE.md`**.

---

## Pay calculator — current reality (v8.21+)

Manual-entry. CEA £20.74/hr · CES £21.81/hr · both 140hrs/period · pension £147.36 · London Allowance £276.16 (rates from P51 May 8 2026; 2026/27 not yet confirmed — update `GRADES` in `paycalc-calc.js` when announced). Roster-assist pre-fills Sat/Sun/BH/RDW; standard weekday hours not pre-filled. Full detail (rates, state management, layout, payroll rules) in `.claude/rules/paycalc.md`.

**Example payslips for testing:** `MILLER_ACTUALS` in `test-fixtures/miller-actuals.js` (moved out of the served `roster-data.js` at v14.68 for privacy — excluded from Firebase Hosting; the SERVED "Actual Take-Home" comparison — which read `MILLER_ACTUALS` from the then-served `roster-data.js` — was removed in the same change; a **device-local** actuals overlay remains developer-only: `paycalc-app.js` reads `readPayslipActuals()` from localStorage, gated to `G. Miller`, data imported per-device and never served) contains 13 real payslip records from G. Miller's 2025/26 tax year (the 13 four-weekly periods, printed P4–P52 on the payslip) with actual gross, tax, NI, net, and varPay values. `paycalc.test.mjs` imports the fixture to verify tax and NI computations stay within payslip tolerance. When making changes to pay maths (tax, NI, thresholds, variable pay), run the payslip integration tests in `paycalc.test.mjs` and check that existing assertions still hold. Use `paycalc-hpp.test.mjs` for `_varPayForPeriod` regression tests.

---

## Guide pages (railcard, FIP, guide shell)

Four guide pages (`guide.html`, `paycalc-guide.html`, `railcard-guide.html`, `fip.html`) share `guide-shell.css` (sticky header, back/PDF buttons, print rules, brand palette tokens). Each has its own CSS file. No `shared.css` import. No inline scripts or `onclick` (CSP blocks them). Full design principles, factual accuracy notes, and shell spec in `.claude/rules/guide-pages.md`.
