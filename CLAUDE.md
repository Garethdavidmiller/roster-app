# CLAUDE.md

*Last updated: June 2026 — v13.50 · Updated every 0.10 version*

# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Current app version | `13.50` (latest 0.10 milestone; exact value in `roster-data.js` — `APP_VERSION` is authoritative). The version stamp in **every** doc (this file, AI_MAP, OPERATIONS_REFERENCE, KNOWN_LIMITATIONS, ROADMAP) is enforced against the latest 0.10 milestone by `sw-asset-check.test.mjs` and `githooks/pre-commit` — a bump crossing a 0.10 line fails until each doc is reviewed and re-stamped. |
| Hosted URL | Deployed to Firebase Hosting via GitHub Actions on push to `main` |
| Staff-facing URL | `https://garethdavidmiller.github.io` (GitHub Pages — see API key note below) |
| Cloud Function URLs | `https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle` |
| | `https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF` |
| | `https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth` |
| Development branch convention | `claude/<description>-<sessionId>` — always push to this branch, never directly to `main` |

**GitHub Actions secrets required:**

| Secret | What it is |
|--------|-----------|
| `FIREBASE_SERVICE_ACCOUNT` | Service account key JSON with Functions deploy permissions |
| `HUDDLE_SECRET` | Bearer token for `ingestHuddle` — also set in Firebase Secret Manager |
| `ANTHROPIC_API_KEY` | Claude AI key for `parseRosterPDF` — Firebase Secret Manager only |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push keys — Firebase Secret Manager only |

**Workflows:** `deploy-functions.yml` (functions only) · `deploy-hosting.yml` (PWA → Firebase Hosting, added v8.14) · `deploy-rules.yml` (Firestore/Storage rules) · `deploy-pages.yml` (PWA → staff GitHub Pages site `garethdavidmiller.github.io`, added v12.33 — requires the `PAGES_DEPLOY_TOKEN` secret; see the workflow header for one-time setup)

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
- [ ] `https://garethdavidmiller.github.io` — loads (not `404`); this is the staff URL
- [ ] A sub-page deep-link works (`/admin.html`, `/paycalc.html`) — not just the root
- [ ] DevTools → Console on each shows **no red errors** (CSP / failed module / `404` / `api-key-not-valid` / referrer-blocked)

**Cadence:** every code/app review, **and** immediately after any change to
`firebase.json` (CSP/headers), the Firebase SDK version in `firebase-client.js`,
the GCP API-key referrer allowlist, or the hosting/Pages setup. Full rationale
and the symptom table: KNOWN_LIMITATIONS.md → "The installed PWA masks live-site
breakage".

---

## Version bumping (MANDATORY on every change)

> **⚠️ PRE-COMMIT CHECK — do this before every `git commit`:**
> Ask: "Did this change touch anything a user can see or experience?" UI text, layout,
> behaviour, CSS, security rules, SW caching — all require a bump. If yes, update all
> 9 locations below before committing. Forgetting and fixing in a follow-up commit is
> worse than bumping unnecessarily, because staff may be served a stale cached asset.

**9 edit locations (8 files), every commit that touches behaviour:**

> **What requires a bump:** any change that alters runtime behaviour — logic, data, UI,
> CSS layout/appearance, security rules, HTTP headers, manifest, service worker caching.
> **What does NOT require a bump:** pure documentation edits (`.md` files only), comment-only
> changes inside JS/CSS with no runtime effect, and whitespace/formatting fixes with no
> semantic change. If in doubt, bump — the cache invalidation cost is zero and the benefit
> of always-fresh assets is real.

| File | Location |
|------|----------|
| `roster-data.js` | `export const APP_VERSION = '...'` — **primary source** |
| `service-worker.js` | Line 1 comment |
| `service-worker.js` | `const APP_VERSION = '...'` |
| `index.html` | Line 2 HTML comment |
| `admin.html` | Line 2 HTML comment |
| `paycalc.html` | Line 2 HTML comment |
| `operations.html` | Line 2 HTML comment |
| `settings.html` | Line 2 HTML comment |
| `links.html` | Line 2 HTML comment |

**Shortcut:** `npm run bump <version>` (e.g. `npm run bump 13.48`) updates all 9 locations in one command. Implemented by `scripts/bump-version.mjs`.

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

```
roster-app/
├── index.html              ← main PWA app (HTML + CSS only)
├── admin.html              ← staff self-service portal: AL booking, absence, override list
├── operations.html         ← admin-only operations page: Huddle upload, Roster upload, Staff Login Accounts (v10.99)
├── settings.html           ← staff self-service settings page: Notifications, Work Email (v11.06)
├── paycalc.html            ← pay calculator (HTML + CSS only)
├── calendar-app.js                  ← all JavaScript for index.html (calendar, overrides cache, swipe, notifications)
├── app-huddle-viewer.js    ← Huddle viewer overlay: sanitiseHtml, viewer open/close, _triggerAutoOpen, hashchange handler, subscribeToLatestHuddle wiring. Exports initHuddleViewer (applyHuddleButtonState removed v12.57 — #huddleBtn no longer exists). Imported by calendar-app.js (v11.40)
├── nav-panel.js            ← shared slide-out navigation drawer: initNavPanel(opts), NAV_PAGES config, NAV_INFORMATION config, NAV_GUIDES collapsible submenu, brand logo→About (onLogoClick) + version, footer notification bell. App Notices archive: archiveNotice({ id, title, section, date, body }) — idempotent, writes to localStorage `myb_app_notices`; "📣 App Notices" nav link opens the archive panel. Imported by calendar-app.js, admin-app.js, paycalc-app.js, operations-app.js, settings-app.js
├── notif.js                ← shared Web Push module: notifSupported, getNotifState, peekNotifState (read-only), enableNotifications, disableNotifications. VAPID key + subscribe lifecycle. Imported by nav-panel.js
├── overlay.js              ← shared overlay helpers: lockBodyScroll, unlockBodyScroll, _pushOverlayState, _clearOverlayHistory, dismissOverlay, trapFocus, createLightbox (canonical lightbox lifecycle factory, v12.50), initCardCollapse. Singleton popstate listener. Imported by all six app pages and nav-panel.js (v11.40)
├── about-lightbox.js       ← shared About (#iconLightbox) panel: initAboutLightbox({ appLabel, bugLinkId, getUserName, onOpen, printFn }) — version line, SW update status, bug-report mailto, optional print button. Built on createLightbox. Imported by all six app pages (v12.50)
├── tips-lightbox.js        ← shared per-card Tips (#tipsLightbox) panel: initTipsLightbox(CARD_TIPS, { getIsAdmin }) — lifecycle, renderer (incl. adminOnly/staffOnly filtering), and .btn-card-tips wiring. Pages own only their CARD_TIPS content. Imported by admin-app.js, operations-app.js, settings-app.js, links-app.js (v12.50)
├── session.js              ← shared auth/session module: AUTH_KEY, SESSION_MS, SESSION_VER, getSurname, ensureFirebaseSession, getSession, saveSession, clearSession. Imported by admin-app.js, settings-app.js, operations-app.js, paycalc-app.js (v11.40; paycalc added v12.49)
├── sw-register.js          ← shared service worker registration + update lifecycle: registerServiceWorker({ beforeReload, bfcache }). Imported by all six app pages (v12.28)
├── error-reporter.js       ← shared uncaught-error reporter: initErrorReporter() — registers window.onerror + window.onunhandledrejection, filters noise (cross-origin, ResizeObserver, empty), session-deduplicates, writes to Firestore clientErrors collection. Imported by admin-app.js, operations-app.js, settings-app.js, paycalc-app.js (v13.31)
├── app-team-view.js        ← Team Week View: state, grid render, Firestore fetch, toggle, chrome. Imported by calendar-app.js
├── app-override-utils.js   ← override priority, member-start, and shift-classification helpers: tsToMillis, shouldReplaceOverride, isBeforeMemberStart, isRestShift. Shared by calendar-app.js, app-team-view.js, and admin modules
├── admin-app.js            ← coordinator for admin.html: login, AL/absence booking, Team Week View, module wiring, booked-box helpers
├── operations-app.js       ← coordinator for operations.html: session guard, Firebase Auth re-establish, initHuddleUpload, initRosterUpload, initAuthSetup, initErrorLog (v10.99; error log v13.31)
├── settings-app.js         ← coordinator for settings.html: session check (shared AUTH_KEY), login overlay, initHuddleNotifications, work email card, initNavPanel (v11.06)
├── huddle.js               ← Huddle upload (initHuddleUpload → operations.html), push notifications card (initHuddleNotifications → settings.html), Huddle card toggle. Renamed from admin-huddle.js at v11.40
├── admin-auth.js           ← Staff Firebase Auth account setup card (extracted v9.54)
├── admin-al.js             ← Annual Leave Booking section. Exports initALSection(deps) and triggerConfirmedALSave()
├── admin-sick.js           ← Sick Days Recording section. Exports initSickSection(deps)
├── admin-overrides.js      ← Change a Shift module: week grid, bulk bar, override list, save logic, utilities; exports recordRangeOverrides() shared AL/Sick save helper
├── admin-rangepicker.js    ← Inline date-range calendar: buildRangePicker(prefix) → { reset() }. Imported by admin-al.js and admin-sick.js
├── admin-roster-upload.js  ← Weekly Roster Upload pipeline: computeCellStates, renderReviewTable, shiftDisplay
├── paycalc-app.js          ← all JavaScript for paycalc.html (UI, DOM, period logic)
├── paycalc-calc.js         ← pure pay math module (no DOM/Firebase): tax, NI, SL, gross, thresholds
├── paycalc-help.js         ← HELP_CONTENT object (tooltip/help text for pay calculator). Pure data, no DOM/Firebase. Imported by paycalc-app.js (v11.40)
├── paycalc-migrations.js   ← localStorage key constants (SK, periodKey, hppEstKey etc.) and runMigrations(). Imported by paycalc-app.js (v11.40)
├── paycalc-roster-suggestions.js ← roster pre-fill engine: getRosterSuggestion(p, member), fetchOverridesForPeriod
├── roster-data.js          ← shared module: APP_VERSION, CONFIG, teamMembers, all roster data, utility functions
├── roster-cycle-data.js    ← raw roster cycle arrays — imported by roster-data.js only
├── firebase-client.js      ← shared module: Firebase init, exports db + all Firestore functions
├── client-errors.js        ← pure error-log ordering/retention logic (no DOM/Firebase): CLIENT_ERROR_RETENTION_MS, isResolvedErrorExpired, expiredResolvedIds, orderClientErrors. Imported by firebase-client.js. Tested by client-errors.test.mjs (v13.48)
├── ls.js                   ← shared localStorage wrappers: lsGet, lsSet, lsDel — iOS Safari safe
├── index.css               ← all CSS for index.html (extracted from inline <style> at v11.41)
├── admin.css               ← all CSS for admin.html (extracted from inline <style> at v11.41)
├── paycalc.css             ← all CSS for paycalc.html (extracted from inline <style> at v11.41)
├── operations.css          ← all CSS for operations.html (extracted from inline <style> at v12.01)
├── settings.css            ← all CSS for settings.html (extracted from inline <style> at v12.01)
├── links.html              ← 28-line link design workspace (v12.07, redesigned v12.39–v12.40); visible only to CONFIG.LINKS_DESIGNERS
├── links.css               ← all CSS for links.html — grid table, cell colours, paint brush bar, design picker chips, compare layout, hourly coverage heat map, design checks, generator slot table (v12.47)
├── links-app.js            ← coordinator for links.html: auth guard, Firestore load/save for the linkDesigns collection (named multi-design docs), design picker, side-by-side compare, grid render, paint mode, coverage heat map, design checks, auto-generator UI (v12.47)
├── links-design.js         ← pure link-design maths (no DOM/Firebase): classifyShift, normaliseCustomShift, calcCoverage, calcHourlyCoverage, generatePatterns (rotating-window), runDesignChecks, dayClass (v12.40)
├── shared.css              ← CSS shared by all six app pages (index, admin, paycalc, operations, settings, links): nav panel, lightbox, login, card-header, collapsible, btn-action, btn-card-tips, tips lightbox — NOT the guides
├── guide-shell.css         ← shared chrome for the 4 guide pages only (header, .btn-back, .btn-pdf, print). Defines brand palette tokens (--navy, --navy-dark, --navy-mid, --gold) in :root — guide pages no longer define these themselves. Linked by guide/paycalc-guide/railcard-guide/fip (v11.48; palette tokens added v11.85)
├── guide.css               ← page-specific styles for guide.html (extracted from inline <style> at v12.04)
├── paycalc-guide.css       ← page-specific styles for paycalc-guide.html (extracted from inline <style> at v12.04)
├── railcard-guide.css      ← page-specific styles for railcard-guide.html (extracted from inline <style> at v12.04)
├── fip.css                 ← page-specific styles for fip.html (extracted from inline <style> at v12.04)
├── purify.es.mjs           ← self-hosted DOMPurify (v3.4.8 ES module). Used by app-huddle-viewer.js to sanitise Huddle HTML. To upgrade: `npm pack dompurify@<ver>`, extract package/dist/purify.es.mjs, replace this file, update version comment in app-huddle-viewer.js (v12.04)
├── service-worker.js       ← single SW for all pages; cache name includes app version
├── manifest.json           ← PWA manifest for all pages
├── paycalc-guide.html      ← printable pay calculator reference guide
├── fip.html                ← FIP European travel guide for staff
├── guide.html              ← printable staff + admin quick guide
├── railcard-guide.html     ← Railcard at-work reference sheet (cards, GroupSave, season tickets, gateline checks); accessed via nav panel
├── railcard-guide.js       ← JS for railcard-guide.html: print button, chip-bar navigation, sticky-offset calculation. No modules.
├── guide-print.js          ← Shared print button handler for guide.html and paycalc-guide.html. No modules.
├── icon-*.png              ← 6 sizes: 120, 152, 167, 180, 192, 512
├── fonts/
│   └── inter-latin.woff2   ← self-hosted Inter (variable, latin subset, wght 100–900). @font-face in shared.css; preloaded in every page head; precached by the SW (v11.53)
├── CLAUDE.md               ← this file
├── OPERATIONS_REFERENCE.md ← Power Automate, Cloud Function formats, Firebase Auth detail
├── AI_MAP.md               ← routing guide: which file to edit for a given task
├── KNOWN_LIMITATIONS.md    ← intentional constraints and deferred decisions
├── ROADMAP.md              ← product history, future ideas
├── app.test.mjs            ← tests for app-override-utils.js (tsToMillis, shouldReplaceOverride, isBeforeMemberStart)
├── roster-data.test.mjs    ← tests for roster-data.js (bank holidays, paydays, AL, etc.)
├── paycalc.test.mjs        ← tests for paycalc-calc.js (tax, NI, gross)
├── paycalc-roster-suggestions.test.mjs ← tests for paycalc-roster-suggestions.js (requires --experimental-test-module-mocks)
├── roster-parse-helpers.test.mjs ← tests for functions/roster-parse-helpers.js
├── links-design.test.mjs   ← tests for links-design.js (generator targets/turnarounds, hourly coverage, design checks, custom-shift validation)
├── admin-overrides.test.mjs ← tests for admin-overrides.js exports: getEffectiveShift (batch/override/base-roster priority), validateShiftRules (12h duration, 12h rest gap), buildMemberDateMap (requires --experimental-test-module-mocks)
├── nav-panel.test.mjs      ← tests for nav-panel.js exports: isNoticeExpired (28/90-day windows) and archiveNotice (legacy-record migration, 180-day prune, malformed-data resilience, idempotency, 50-entry cap; requires --experimental-test-module-mocks)
├── admin-rangepicker.test.mjs ← tests for getDateRange() in admin-rangepicker.js (inclusive endpoints, reversed range, month/year/leap/DST boundaries)
├── client-errors.test.mjs  ← tests for client-errors.js: isResolvedErrorExpired, expiredResolvedIds, orderClientErrors (v13.48)
├── sw-asset-check.test.mjs ← deployment hygiene: every root JS module listed in service-worker.js asset lists + APP_VERSION matching in all 9 bump locations + functions/roster-members.json sync check (v13.48)
├── module-parse.test.mjs   ← verifies every root JS module parses as an ES module (catches fatal SyntaxErrors that would brick a page — added v12.50 after settings-app.js shipped one undetected at v12.28)
├── package.json            ← dev dependencies only: http-server (not deployed; see firebase.json ignore list)
├── scripts/
│   ├── bump-version.mjs          ← dev utility: update APP_VERSION in all 9 locations at once — run via `npm run bump <version>` (v13.48)
│   └── generate-roster-members.mjs ← dev utility: regenerate functions/roster-members.json from roster-data.js — run via `npm run generate:roster-members` after any staff change (v13.48)
├── firebase.json           ← Firebase Hosting config: CSP headers, cache rules, redirect rules, deploy ignore list
├── storage.rules           ← Firebase Storage security rules: authenticated staff can read huddle files; admin-role token required to write
├── firestore.indexes.json  ← Firestore composite indexes: overrides (memberName + date)
├── generate-sri.mjs        ← dev utility: fetches Mammoth CDN SRI hash and patches huddle.js in-place (DOMPurify is self-hosted — no longer managed here)
└── functions/
    ├── index.js                  ← Cloud Functions: ingestHuddle, parseRosterPDF, setupRosterAuth
    ├── roster-parse-helpers.js   ← Pure helpers: normaliseShift, buildWeekDates, extractAIJson, etc.
    ├── roster-members.json       ← generated staff name list by grade (cea/ces/dispatcher) — do NOT hand-edit; regenerate via `npm run generate:roster-members` after any staff change (v13.48)
    └── package.json
```

**Run all tests:**
```
npm test
# or individually:
node --test sw-asset-check.test.mjs links-design.test.mjs admin-rangepicker.test.mjs client-errors.test.mjs
node --experimental-vm-modules --test module-parse.test.mjs
node --experimental-test-module-mocks --test app.test.mjs roster-data.test.mjs paycalc.test.mjs paycalc-roster-suggestions.test.mjs roster-parse-helpers.test.mjs admin-overrides.test.mjs nav-panel.test.mjs
```

**Service worker caching:**
- Network-first: all JS, HTML, CSS — must always be fresh
- Cache-first: icons, `manifest.json` — stable assets
- Cache name: `myb-roster-v{APP_VERSION}` — version bump auto-invalidates

---

## Brand colours — Chiltern Railways

| Variable | Hex | Use |
|----------|-----|-----|
| `--primary-blue` | `#001e3c` | Dark navy — headers, buttons, day-header cells |
| `--primary-blue-dark` | `#00152a` | Deeper navy — hover states |
| `--accent-gold` | `#f5c800` | Gold — today cell, today button, active highlights |
| `--accent-gold-dark` | `#e6bb00` | Darker gold — hover on today button |

All colour values must be in CSS variables in `:root` — never hardcode hex.

---

## Architecture decisions — never change without discussion

| Decision | Rule |
|----------|------|
| No framework (vanilla JS) | No build step. Do not introduce React, Vue, or any library beyond Firebase. |
| No bundler | CDN-only external dependencies. |
| **Self-hosted Inter typeface (v11.53)** | `fonts/inter-latin.woff2` is served from origin, NOT Google Fonts CDN. CSP is `font-src 'self'` — a CDN would mean loosening it, and self-hosting keeps the app offline-first (SW precaches the file) with no third-party request. One variable woff2 (latin, wght 100–900) covers every weight. `@font-face` lives in `shared.css`; `--font-sans` token in `:root` is the single place the stack is defined; every page's `body` uses `var(--font-sans)`. Do not re-add a Google Fonts `<link>`. |
| Pointer Events API for swipe | Handles touch, mouse, and trackpad in one handler. Do not revert to Touch Events. |
| `aria-live` for month announcements | Programmatic `.focus()` on the month heading caused mobile layout reflow. Do not switch. |
| `Math.ceil()` on carousel panel width | Eliminates sub-pixel seam on high-DPI screens. Do not remove. |
| CSS variables for all colours | Defined in `:root`. Never hardcode hex anywhere in CSS or JS. |
| Three-surface model (v11.55) | canvas (navy) → card (`oklch(98%)`) → sunken (`oklch(96.3%)`). Fields use `--field-bg`, brighten to `white` on focus. Focus CSS uses literal `white`, not `var(--surface)`. Always use `background-color` longhand on fields (not shorthand — `<select>` arrow uses `background-image`). See `.claude/rules/css-tokens.md` for full surface, motion, and type-scale rules. |
| Motion vocabulary (v11.56) | `--ease-standard/emphasized/spring`, `--dur-fast/base` in `shared.css :root`. Every primary button uses `:active { transform: scale(var(--press-scale)) }` (`0.97`; `1` under reduced-motion). Nav-drawer pills keep opacity-based press. See `.claude/rules/css-tokens.md`. |
| Typography scale (v11.77) | `--type-micro` 10px · `--type-small` 12px · `--type-body` 14px · `--type-medium` 16px (also prevents iOS focus-zoom — never below 16px on focusable fields) · `--type-large` 18px. Consistent sizes across sub-pages. See `.claude/rules/css-tokens.md`. |
| Semantic elements (`<nav>`, `<header>`, `<main>`) | Screen readers depend on these landmarks. Do not revert to `<div>`. |
| Network-first SW for app files | Ensures staff always receive roster updates on next open. |
| `isChristmasRD()` applied before Firestore overrides | Forces Dec 25 and Dec 26 to RD first; Firestore can then override Dec 26 to RDW for overtime. Never reorder this. |
| `getBaseShift(member, date)` for all base shift lookups | Direct access to `roster.data[week][day]` bypasses `startDate` suppression, Christmas rules, and future base-shift logic. Always call `getBaseShift()`, never read `roster.data` directly. |
| Type pills in admin — single source of truth (v13.48) | `PILL_TYPES` in `admin-overrides.js` is the one authoritative list. `renderWeekGrid()` generates per-row pills from it; `admin-app.js` generates the bulk-bar pills from it at init (the `#bulkTypePills` div in `admin.html` is empty — populated at runtime). Order: AL · Spare · Shift · RDW · Absent · Rest Day. Never hardcode either list. |
| **`AL` pill label must stay as `AL`** | Compact mobile layout requires short labels. `AL` is the standard Chiltern abbreviation. Do not expand without discussing layout impact. |
| **`🪑` is the absence emoji — do not change** | Absence covers sickness, childcare, bereavement, and other reasons. Using 🤒 implies illness — GDPR concern. The reason for absence is never stored. **Always ask Gareth before changing the absence icon.** |
| `_staleMemberName` flag in `calendar-app.js` | When `getSelectedMemberIndex()` can't find a saved name, sets flag, falls back to default member, shows dismissible banner on next render. Flag cleared after banner fires. |
| Sync chip state machine in `calendar-app.js` | hidden → (800ms) → "↻ Updating…" → silent remove on success, or "⚠ Couldn't update" (stays, 10s timeout). "✓ Up to date" removed (v10.19) — noise. Never show raw errors to staff. |
| App Notices system (v13.36) | `nav-panel.js` owns the archive: `archiveNotice({ id, title, section, date, body })` writes to localStorage `myb_app_notices` (capped at 50 entries, deduped by `id`). "📣 App Notices" in `NAV_INFORMATION` opens the archive panel. Notice lightboxes live on individual pages; see **"One-time notice pattern"** section below for the full creation guide. Current notices: `ytd_2627` (paycalc.html), `links-beta-2026` (links.html). |
| `_clearState` / `CONDITIONAL_ROWS` in `paycalc-app.js` | `_clearState` groups destructive-clear state atomically (includes `countdownTimer`). `CONDITIONAL_ROWS` is data-driven: condition → row/field IDs — add a new conditional row by adding one array entry. See `.claude/rules/paycalc.md`. |
| `touch-only` CSS class in `shared.css` | `display:none` by default; revealed via `@media (pointer: coarse)`. Use for touch-only UI. Do not use inline `display:none`. `(hover: hover)` inverse was dropped (v10.15) — some Android devices misreport it. |
| `window.matchMedia('(pointer: coarse)')` in `initSwipeHint()` | Gesture-tutorial UI must only show on touch devices. Always add this guard. |
| **Do not gate layout on `(hover: hover) and (pointer: fine)` alone** | Some Android devices misreport `hover: hover`. For layout breakpoints, always use `min-width`. Hover/pointer queries are only safe for cosmetic `:hover` transitions. |
| `paycalc.html` desktop grid on `<main>` | CSS grid applies to direct children only — declare on `main { display: grid }`. `.app` only holds max-width. |
| `lsGet` / `lsSet` / `lsDel` from `ls.js` | iOS Safari private mode throws `SecurityError` on any `localStorage` access. **Never call `localStorage` directly** in `calendar-app.js`, `admin-app.js`, or `paycalc-app.js` — always use these wrappers. |
| VAPID fingerprint migration | Both pages store first 12 chars of VAPID key in `localStorage('myb_vapid_ver')`. On mismatch, silently unsubscribes → re-subscribes. Cloud Function treats 401 same as 410/404. |
| One-off notification prompt (`#notifPrompt`) | Appears once per device between `</nav>` and pay-period strip. Both Enable and × set `myb_notif_prompt_done`. Do not move below the calendar. |
| PWA shortcuts in `manifest.json` | Three long-press shortcuts. Changes require reinstall to take effect on existing installs. |
| Sticky take-home bar (`#stickyTotal`) | Fixed bar on mobile (hidden ≥1040px). `IntersectionObserver` + `body.sticky-active`. See `.claude/rules/paycalc.md`. |
| 3-digit time input auto-correction in `admin-overrides.js` | On blur, if length is 3 and `parseInt(raw.slice(0,2)) > 23`, prepend `'0'`. Without this, `"630"` produced `"63:0"`. |
| Range picker clear button (`.rp-clear`) | Resets both `from` and `to` dates. Built into `buildRangePicker()` in `admin-rangepicker.js`. |
| **Sundays are non-contracted — AL and Absent cannot be recorded on Sundays** | Sundays are uncontracted for all grades (CEA, CES, Dispatcher). Neither `annual_leave` nor `sick` overrides may be written for a Sunday. Enforcement (do not remove any layer — they work together): (1) `admin-overrides.js` week grid disables both the AL and Absent pills on Sunday rows; (2) the bulk-apply bar silently skips Sunday rows when AL or Absent is the active type; (3) `recordRangeOverrides()` filters Sundays out of `workingDates` before writing overrides; (4) roster upload — `computeCellStates()` in `admin-roster-upload.js` normalises a Sunday PDF `AL`/`SICK` to `RD` (so it classifies as MATCH and is never written), with `shiftValueToOverrideType()` → `correction` plus a `value:'RD'` write-path backstop for the edited-cell path; (5) **display** — `calendar-app.js` calendar render and month-legend both suppress a `sick` override when `isSunday(dateStr)` (in addition to base `RD`/`OFF`), so absence never renders on a Sunday even from legacy data when the rotating roster brings a worked Sunday into the range (v12.61). A worked Sunday time is always RDW, never AL/Absent. |
| Sunday RD corrections on absence/AL save | Every Sunday in the range is checked; if `getBaseShift` returns a non-RD shift, an explicit `correction/RD` override is written alongside the AL/sick overrides. Used in both save handlers. |
| Range picker swipe — pointer capture on `grid` not `clip` | Events dispatched to a capture target do not bubble down to children — captures on `clip` breaks the drag animation. |
| Team Week View | Available to all logged-in staff. Grade state (`currentTeamGrade`) persists across re-renders. Fetch token = week-start timestamp — stale Firestore results are discarded. Week navigation clamped to `CONFIG.MIN_YEAR`/`MAX_YEAR`. **No override-load status indicator** — deliberately not added (minimal-noise app). |
| `persistentLocalCache()` in `firebase-client.js` | Firestore stores queries in IndexedDB. Do not revert to `getFirestore()` — Huddle viewer and override cache depend on instant load. |
| `subscribeToLatestHuddle` in `firebase-client.js` | Persistent `onSnapshot` — Huddle viewer updates automatically when a new Huddle arrives. Do not replace with one-time fetch. |
| `normaliseSurname()` in `firebase-client.js` (v12.04) | Shared surname derivation for Firebase Auth: lowercases, strips non-alpha, pads to 6 chars. Exported from `firebase-client.js`; `getSurname()` in `session.js` delegates to it. A deliberate duplicate also exists in `functions/roster-parse-helpers.js` — Cloud Functions are CommonJS and cannot import browser ES modules, so unification requires a build step. If the rule ever changes, update both locations. |
| `cors: true` on `parseRosterPDF` and `setupRosterAuth` | firebase-functions v6 `cors: [array]` doesn't consistently set `Access-Control-Allow-Headers` on preflight. Both functions use Firebase ID token auth, so wildcard origin adds no attack surface. `ingestHuddle` keeps `cors: false` (server-to-server). |
| Android Back button overlay pattern | Overlays push `history.pushState({ mybOverlay: true })` when opening, close on `popstate`. `_pushOverlayState(handler)` / `_clearOverlayHistory()` helpers in all six app pages. |
| Canonical lightbox lifecycle (standardised v11.50, factored into `createLightbox` v12.50) | Every `.lb-overlay` lightbox (About `#iconLightbox`, AL, Team info, Month jump, per-card Tips, paycalc Help/Welcome, links Beta) is built with **`createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose })` in `overlay.js`** — do NOT hand-write the lifecycle in a page module. The factory implements: focus save → `.visible` → rAF `.open` + focus close button (or `initialFocus`) → `lockBodyScroll()` → `_pushOverlayState(close)` → Escape keydown + **`trapFocus` Tab trap** → close via `dismissOverlay` (which removes `.open`, restores focus synchronously, then `transitionend` **with a 500ms `setTimeout` fallback** removes `.visible` + `unlockBodyScroll()` — the fallback is mandatory: iOS suppresses `transitionend` on a backgrounded tab; under `prefers-reduced-motion` it finishes synchronously because the transition is disabled). Backdrop click (`e.target === overlay`) and closeBtn click are wired by the factory; callers prepare dynamic content before `open()` or in `onOpen`. Close controls are `<button class="lb-close">` (never `<span>` — spans aren't keyboard-focusable). The About panel is the shared `about-lightbox.js`; per-card Tips is the shared `tips-lightbox.js`. The coming-soon lightbox is owned **only** by `nav-panel.js` (it shares the drawer's history entry) — never re-wire `#navComingSoonLightbox` from a page module and do not migrate it to `createLightbox`. The huddle viewer (`#huddleViewer`) is a full-bleed panel, not a centred `.lb-content` card, so it has no overlay-click-to-close — that difference is intentional. |
| Nav panel on all 6 pages (v10.57, extended v10.99 + v11.06 + v12.07) | `nav-panel.js` injects overlay + drawer. Burger button `#navMenuBtn` in each page header. `NAV_PAGES` drives the pill row (current page omitted). `NAV_INFORMATION` drives the flat always-open section (Workplace: Daily Huddle, Weekly Retail Circular — live docs only). `NAV_GUIDES` (v11.21) drives a separate **expanded-by-default** "📖 Guides" submenu (Staff & Admin Guide, Pay Calculator Guide, Railcard Guide, FIP Travel Guide) — toggled by `#navGuidesToggle`, list is `#navGuidesList` (change to `hidden` and `aria-expanded="false"` if the section becomes too long to show open). Adding a guide = one entry in `NAV_GUIDES`; adding a live doc = one `links` entry in `NAV_INFORMATION`. A `NAV_INFORMATION` entry with `comingSoon: true` (instead of `url`) renders as a `<button>` that opens the injected `#navComingSoonLightbox` placeholder instead of navigating. |
| Dark (navy) drawer + scoped tokens (v11.54) | Continuous navy surface. Scoped tokens: `--nav-raised/strong`, `--nav-text/muted/faint`, `--nav-border`. Admin pill = `--nav-raised` + gold text (not navy-fill). Do not revert to white drawer. See `.claude/rules/css-tokens.md`. |
| Nav-panel logo = About; drawer head shows version (v11.21) | The drawer head is a `#navPanelBrand` button (logo + title + `Version {APP_VERSION}` muted text). Tapping it closes the panel (via `closePanelForNavigation`) then calls `onLogoClick`, which each page passes as `() => openAboutLightbox?.()` — opening that page's existing `#iconLightbox` (version, update status, bug report, and page-specific print/guide links). Each page exposes its scoped open fn through a module-level `let openAboutLightbox` assigned inside its About-lightbox IIFE. This replaces the header logo's old role (see header-logo back button entry). |
| Settings page — shared session, flat nav link (v11.06) | `settings.html` uses the same `AUTH_KEY` as `admin-app.js` — a user already signed in on any page arrives without seeing the login overlay. `initNavPanel` is called at module scope in `settings-app.js` regardless of sign-in state so unsigned users can navigate away via the Calendar/Admin pills. Settings link renders outside the scrollable `nav-panel-body` (pinned above footer) so it is always visible without scrolling. Hidden only on the settings page itself. Styled as a flat link (not a pill). `--indigo` badge colour. |
| Nav-panel footer initials badge (v12.22) | The footer shows a 26px circular badge (`#navPanelAvatar`) before the member name — previously showed a profile photo, now always shows initials on a stable per-name colour. `avatarInitials(name)` and `avatarHue(name)` from `roster-data.js` are called directly in `nav-panel.js` — no fetch, no localStorage, no event listeners. Profile photo feature removed at v12.22; full spec and revert checklist in ROADMAP.md → "Profile photo / avatar". |
| Operations page — admin-only pill (v10.99) | `NAV_PAGES` entry for Operations has `adminOnly: true`. `initNavPanel({ isAdmin })` filters it out for non-admins. `calendar-app.js`, `admin-app.js`, and `paycalc-app.js` pass `isAdmin: CONFIG.ADMIN_NAMES.includes(member)`. `operations-app.js` passes `isAdmin: true` (page already guards against non-admins). Operations page has NO login overlay — JS redirects to `admin.html` immediately if the user is not authenticated or not an admin. |
| Links page — access control (v12.06) | `linksDesignerOnly: true` in `NAV_PAGES`. Add name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` to grant access. Current designers: `’G. Miller’`, `’S. Silva’`. |
| Links page — beta marker + first-visit notice (v12.33) | Gold-OUTLINE `.beta-chip` beside the solid `.badge-page`. First-visit `#betaLightbox` via `createLightbox`; gated on `lsGet(‘myb_links_beta_seen’)`. See `.claude/rules/links-design.md`. |
| Links page — design and save model (v12.09–v12.47) | Multi-design Firestore collection `linkDesigns` `{ name, patterns, updatedAt, updatedBy }`. 28-line full rotation — every line must carry a real pattern. CEAs do not work nights. Auto-generator is the only way to create a new design. Grid clicks delegated on `#linksGridBodyRows`. Position keys always `String`. See `.claude/rules/links-design.md` for full grid/paint/generator/coverage/checks/concurrency/print detail. |
| Header back button removed (v10.63) | `admin.html` / `paycalc.html` no longer have a header `←` back button — it duplicated the nav drawer's Calendar pill (two competing nav paradigms) and clashed visually with the logo box. Navigation back to the roster is via the drawer. Header is now `[☰] [logo] Title … [badge]`. The admin "open calendar on the month I was editing" behaviour moved from the back button onto the `.nav-panel-pill--calendar` click in `admin-app.js`. `.btn-back` CSS removed from `shared.css` (still defined locally in `fip.html` / `railcard-guide.html`). |
| Header logo = back to calendar on sub-pages (v11.21) | On `admin.html` / `paycalc.html` / `operations.html` / `settings.html` the header logo `#appIcon` now navigates to `./index.html` (`title`/`aria-label` = "Back to calendar"). This restores an iOS-friendly back affordance (iOS standalone PWA has no system back) without re-adding a visible back button — kept "invisible" as just the logo. The About lightbox it used to open moved to the **nav-panel drawer logo** (see that entry). The **calendar page keeps its header logo opening About** (`.title-icon` in `calendar-app.js`) — home has no "back" target. Do not wire the calendar header logo to navigate. |
| `.app-header` brand centering (v10.66) | `admin.html` / `paycalc.html` headers use `display:grid; grid-template-columns:1fr auto 1fr`. Burger sits in col 1 (`justify-self:start`), logo+title in an `.app-header-brand` flex wrapper in col 2 (auto, truly centred), badge in col 3 (`justify-self:end`). Equal `1fr` side columns guarantee the brand is always centred regardless of burger/badge width asymmetry. The calendar uses a different `.header` (balanced spacers), unaffected. |
| Sign-out in nav panel footer (v10.59) | Sign-out button moved from page headers to the nav panel footer. `initNavPanel({ onSignOut: fn })` — each page passes its own sign-out callback. Footer (member name + Sign out button) renders only when `onSignOut` is supplied. `.btn-signout` CSS removed from `shared.css`. |
| Nationality flags in nav panel footer (v10.64) | Optional `flags: ['🇬🇧','🇳🇬']` array on a `teamMember` (max 2). `nav-panel.js` imports `teamMembers`, looks up the logged-in member by exact name, and renders the flags between the name and the bell (set via `textContent`). Flag emojis render correctly on Android (primary platform); **hidden on Windows** via UA detection (`/Win/.test(navigator.platform) \|\| /Windows/.test(navigator.userAgent)`) — Windows renders them as 2-letter codes. Adding a member's flags = one array on their `teamMembers` entry. |
| Notification bell in nav panel footer (v10.61) | `notif.js` is the shared Web Push module; `nav-panel.js` imports it and renders a 🔔/🔕 toggle in the footer (signed-in only, hidden when `notifSupported()` is false — incl. iOS non-standalone). Bell refreshes on every panel open; tap keeps the panel open. States: `on`/`off-default`/`off-lapsed`/`denied`/`unsupported`. `calendar-app.js` and `huddle.js` also import `notif.js` — VAPID key and subscribe/unsubscribe logic live in one place (v10.79). The `#notifPrompt` calendar strip stays on the calendar; the Notifications card lives on settings.html (moved v11.06). |
| Guide pages back button → index.html (v10.57) | `railcard-guide.html` and `fip.html` back buttons now link to `./index.html` (not `./admin.html`) — guides are accessed from the nav panel, not the admin page. |
| Maskable icons | 512px entry uses `"purpose": "any maskable"` for Android adaptive shapes. Smaller icons omit this. |
| **Chiltern payroll rules** | Rostered Sat → `sat` (1.25×); Sat-on-RD → `rdw`. Sunday-on-BH: Sunday wins (1.5×) — `dow===0` before `isBH`. BH + `rdw` is additive (`bhOt` + `bh`). Confirmed May 2026; tests assert. See `.claude/rules/paycalc.md` for full detail. |
| `initALSection()` / `initSickSection()` in `admin-app.js` | `alMember`, `sickMember`, `syncMemberDisplay`, `syncSickMemberDisplay` are hoisted to module scope above the `fieldMember` change handler — that handler fires before init. Do not move them inside the init functions. |
| SW synthesised offline page uses status 200 | Some browsers suppress 5xx response bodies. `Cache-Control: no-store` prevents caching the synthesised page. |
| SW offline fallback only for navigation requests (v10.15) | Only `event.request.destination === 'document'` requests get the offline HTML page. JS/CSS get `Response.error()`. Without this, `/admin-app.js` matched `'admin'` in the fallback logic and got HTML for a JS request — MIME-type error. Fallback routing chain (v11.87): `paycalc` → `paycalc.html` · `operations` → `operations.html` · `settings` → `settings.html` · `admin` → `admin.html` · otherwise → `index.html`. |
| Huddle notification → `#huddle` hash pattern | SW navigates to `#huddle`; `calendar-app.js` `hashchange` handler triggers the viewer (`_autoOpen` is `let` so it can reset). **Two viewer paths — do not unify, do not revert notification path to direct `window.open`/`location.href`:** `htmlContent` present (DOCX converted server-side) → renders inline in both paths. No `htmlContent` (PDF or failed conversion) → the viewer shows an in-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`); its click is a real gesture (a direct `window.open`/`location.href` on a hash-open would be pop-up-blocked or knock the PWA out of standalone). The viewer is opened **only** via the `#huddle` hash — from both the nav-panel "Daily Huddle" link and notification taps (the old `#huddleBtn` was removed at v12.57). `huddles` Firestore reads are open (no auth) — `calendar-app.js` has no Auth session, so requiring auth would break auto-open on fresh visits. Full rationale: **OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour"**. |
| `isBeforeMemberStart(member, date)` in `app-override-utils.js` (v10.16) | Returns true if `date` is before the member's `startDate`. Always use this helper — never inline the date comparison. |
| `navigateToPaycalc(paydayStr)` in `calendar-app.js` (v10.17) | Encapsulates session-check-then-navigate for payday and cutoff cell clicks. Always call this helper — never duplicate the navigation logic. |
| SW `new Request(url)` fetch pattern (v10.16) | `new Request(event.request.url, { cache: 'no-store', ... })` instead of passing opts to an existing Request. Passing opts alongside a Request doesn't reliably override cache mode on older Safari/Chromium. |

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
| `getEffectiveContr(p)` | `paycalc-app.js` — contracted hours, pro-rated if member has `startDate` in the period |
| Reference guide | `paycalc-guide.html` |

---

## Shift types

| Value | Badge | Meaning |
|-------|-------|---------|
| `'RD'` | 🏠 Rest | Rest day |
| `'OFF'` | 🏠 Rest | Off day — bilingual roster only, treated identically to RD |
| `'SPARE'` | 📋 Spare | On standby, shift not yet assigned |
| `'RDW'` | 💼 RDW | Rest day worked — overtime |
| `'AL'` | 🏖️ AL | Annual leave |
| `'SICK'` | 🪑 Absent | Sick/absent day — recorded via override |
| `'HH:MM-HH:MM'` | ☀️/🌙/🦉 | Worked shift |

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
  flags: ['🇬🇧', '🇳🇬'], // Optional — up to 2 nationality flag emojis; shown in nav panel footer (v10.64); hidden on Windows (v10.65)
  rosterChanges: [{ from: new Date(2026, 6, 1), rosterType: 'ces', currentWeek: 4 }] // Optional — scheduled roster moves
}
```

**`rosterChanges` (v12.31)** — date-driven roster transitions for a member who changes rosterType/link mid-life (e.g. a new starter on a temporary `fixed` pattern who later joins a rotating link). Each entry is `{ from: Date, rosterType, currentWeek }`; from `from` (midnight, **inclusive**) onward the member follows that rosterType/currentWeek instead of the base fields. Array must be **sorted ascending by `from`** — the latest entry whose `from` ≤ date wins. Resolved by `resolveMemberRoster(member, date)` in `roster-data.js`; `getBaseShift` and `getWeekNumberForDate` apply it automatically, so **no call site needs special handling**. The base `rosterType`/`currentWeek` describe the member *before* the first change. `startDate` (join-date RD suppression) is independent and still applies.

**AL entitlement** (`getALEntitlement` in `roster-data.js`) — `proRatedAL[year]` takes priority before any role check:

| Role / type | Days |
|-------------|------|
| CEA (main, bilingual, fixed) | 32/year |
| CES (`ces`) | 34/year |
| C. Reen (`fixed`) | 34/year |
| Dispatcher | 22 + 1 lieu per BH worked (`countDispatcherBankHolidaysWorked`) |

### Roster cycles

| Type | Weeks |
|------|-------|
| main | 20 |
| bilingual | 8 |
| fixed | 1 |
| ces | 10 |
| dispatcher | 10 |

### Firestore collections

**overrides**
```
date         "YYYY-MM-DD"
memberName   Must match teamMembers[n].name exactly — one char mismatch = silent failure
type         "spare_shift" | "shift" | "rdw" | "annual_leave" | "correction" | "sick"
             Legacy (still in data, not creatable): "allocated" | "overtime" | "swap"
value        "HH:MM-HH:MM" for spare_shift/shift/rdw; "AL" for annual_leave; "RD" for correction; "SICK" for sick
note         Free text — "" if none. Field must always be present.
source       "manual" | "roster_import" — required by Firestore rules; written by all override save paths
createdAt    Firestore server timestamp
```

**huddles**
```
date         "YYYY-MM-DD"
storageUrl   Permanent tokenised download URL (manual upload) or 1-year signed URL (Cloud Function ingest)
fileType     MIME type string
uploadedAt   Firestore server timestamp
uploadedBy   Member name string (manual upload only)
htmlContent  Converted HTML string — present when a DOCX was uploaded/ingested; absent for PDFs
```
Reads: open (no auth required — calendar-app.js has no session; see Huddle notification tap behaviour in OPERATIONS_REFERENCE.md).
Writes: require auth + admin claim. Cloud Function writes via Admin SDK (bypasses rules).

**staffContact** (v12.68)
```
memberName  Must match teamMembers[n].name exactly — used as the document ID
workEmail   Work email address (5–200 chars, must contain @)
updatedAt   Firestore server timestamp
```
Read/write restricted: owner can read/write their own doc; admin can read all.
Write requires the `name` JWT claim (set by setupRosterAuth) — anonymous fallback sessions cannot write.
Purpose: Stage 1 of password security improvements. Email will enable future account recovery (Stage 4).
Read/written/deleted by: `getStaffContact` / `saveStaffContact` / `deleteStaffContact` in `firebase-client.js`, called from `settings-app.js`. `getAllStaffContacts` (reads all docs) called from `operations-app.js` (Work Email Progress card).

**pushSubscriptions**
```
endpoint   Browser push endpoint URL — also used (hashed) as the document ID
keys.p256dh  base64url-encoded p256dh public key
keys.auth    base64url-encoded auth secret
```
Written by `savePushSubscription`, deleted by `deletePushSubscription` in `firebase-client.js`.
Each document ID is a SHA-256 hash of the endpoint URL (first 16 hex chars). One doc per subscribed browser/device.
Read by the `ingestHuddle` Cloud Function (Admin SDK) when fanning out push notifications.

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
Read/resolved by: `getClientErrors` / `resolveClientError` in `firebase-client.js`, called from `operations-app.js` Error Log card. `getClientErrors` queries unresolved and resolved separately (single-field equality, no composite index) so a backlog of resolved records can never hide an older unresolved one, and prunes resolved records 90 days past `resolvedAt`.

Override cache key: `"memberName|YYYY-MM-DD"`

### Authentication

Staff log in with name (dropdown) + surname as password (lowercase, no spaces/special chars). Sessions expire after 30 days (absolute) or 7 days of inactivity, whichever comes first — every successful page load refreshes the idle clock. `CONFIG.ADMIN_NAMES = ['G. Miller']` — elevated access. `CONFIG.LINKS_DESIGNERS = ['G. Miller', 'S. Silva']` — access to the Links design workspace.

The login dropdown groups members by grade (CEA · CES · Dispatcher · Management, in that order). `managerOnly: true` members (managers/clerks) appear **only** in the Management group and are hidden from the calendar's member selector — they have login access but no roster of their own. Their grade dropdown filtering lives in `admin-app.js` (`GRADE_ORDER`).

**Password security note:** Passwords are surname-derived and not secrets — protection relies on Firebase Auth rate-limiting (v9.53) and Firestore rules (`request.auth != null`).

Firebase SDK: currently v12.10.0. Check version before any new Firebase work.

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
- **Shift type count** — 8 types in admin selector. Consider merging before adding more.

---

## Huddle ingest

Daily Huddle PDF/DOCX → Power Automate → `ingestHuddle` → Firebase Storage + Firestore `huddles` collection + push notification. The upload button is labelled **"Choose file"** (not "Choose PDF") — intentional, Huddles can be PDF or DOCX.

Full flow diagram, request format, gotchas, and Security Rules: **see `OPERATIONS_REFERENCE.md`**.

---

## Weekly Roster Upload

Admin uploads PDF → `parseRosterPDF` (model in `functions/index.js` `CLAUDE_MODEL` — currently `claude-sonnet-4-6`) → JSON → review UI → Firestore. Works for CEA/Bilingual, CES, and Dispatcher rosters.

**Critical:** `RDW|HH:MM-HH:MM` pipe encoding — AI returns `"RDW HH:MM-HH:MM"`, normalised to pipe in review, stripped to plain time on save. Do not strip `RDW` from the AI return value.

**`source: 'roster_import'`** on all roster-upload overrides — used by `computeCellStates()` for COVERED/DIFF/CONFLICT classification.

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

**Per-member write isolation (suspended at v10.94):** `firestore.rules` previously required
`request.auth.token.name == memberName` for override writes (v10.72 / v11 task #2). This was
reverted after it caused a production outage — see KNOWN_LIMITATIONS.md task #2 for full
details and the re-introduction checklist.

**New starter:** invoke `/new-starter` — the skill has the full 3-step checklist, mid-year field reference, and pro-rata formula invariant.

**Removing a staff member:** Set `hidden: true`, run Set up accounts → "Disable accounts for leavers".

Email/password convention: **see `OPERATIONS_REFERENCE.md`**.

---

## Pay calculator — current reality (v8.21+)

Manual-entry. CEA £20.74/hr · CES £21.81/hr · both 140hrs/period · pension £147.36 · London Allowance £276.16 (rates from P51 May 8 2026; 2026/27 not yet confirmed — update `GRADES` in `paycalc-app.js` when announced). Roster-assist pre-fills Sat/Sun/BH/RDW; standard weekday hours not pre-filled. Full detail (rates, state management, layout, payroll rules) in `.claude/rules/paycalc.md`.

---

## Guide pages (railcard, FIP, guide shell)

Four guide pages (`guide.html`, `paycalc-guide.html`, `railcard-guide.html`, `fip.html`) share `guide-shell.css` (sticky header, back/PDF buttons, print rules, brand palette tokens). Each has its own CSS file. No `shared.css` import. No inline scripts or `onclick` (CSP blocks them). Full design principles, factual accuracy notes, and shell spec in `.claude/rules/guide-pages.md`.
