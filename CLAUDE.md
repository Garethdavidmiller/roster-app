# CLAUDE.md

*Last updated: June 2026 — v13.10 · Updated every 0.10 version*

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Current app version | `13.10` (latest 0.10 milestone; exact value in `roster-data.js` — `APP_VERSION` is authoritative). The version stamp in **every** doc (this file, AI_MAP, OPERATIONS_REFERENCE, KNOWN_LIMITATIONS, ROADMAP) is enforced against the latest 0.10 milestone by `sw-asset-check.test.mjs` and `githooks/pre-commit` — a bump crossing a 0.10 line fails until each doc is reviewed and re-stamped. |
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

## Current file structure

```
roster-app/
├── index.html              ← main PWA app (HTML + CSS only)
├── admin.html              ← staff self-service portal: AL booking, absence, override list
├── operations.html         ← admin-only operations page: Huddle upload, Roster upload, Staff Login Accounts (v10.99)
├── settings.html           ← staff self-service settings page: Notifications, Cultural Calendar (v11.06)
├── paycalc.html            ← pay calculator (HTML + CSS only)
├── app.js                  ← all JavaScript for index.html (calendar, overrides cache, swipe, notifications)
├── app-huddle-viewer.js    ← Huddle viewer overlay: sanitiseHtml, viewer open/close, _triggerAutoOpen, hashchange handler, subscribeToLatestHuddle wiring. Exports initHuddleViewer (applyHuddleButtonState removed v12.57 — #huddleBtn no longer exists). Imported by app.js (v11.40)
├── nav-panel.js            ← shared slide-out navigation drawer: initNavPanel(opts), NAV_PAGES config, NAV_INFORMATION config, NAV_GUIDES collapsible submenu, brand logo→About (onLogoClick) + version, footer notification bell. Imported by app.js, admin-app.js, paycalc.js, operations-app.js, settings-app.js, links-app.js
├── notif.js                ← shared Web Push module: notifSupported, getNotifState, peekNotifState (read-only), enableNotifications, disableNotifications. VAPID key + subscribe lifecycle. Imported by nav-panel.js
├── overlay.js              ← shared overlay helpers: lockBodyScroll, unlockBodyScroll, _pushOverlayState, _clearOverlayHistory, dismissOverlay, trapFocus, createLightbox (canonical lightbox lifecycle factory, v12.50), initCardCollapse. Singleton popstate listener. Imported by all six app pages and nav-panel.js (v11.40)
├── about-lightbox.js       ← shared About (#iconLightbox) panel: initAboutLightbox({ appLabel, bugLinkId, getUserName, onOpen, printFn }) — version line, SW update status, bug-report mailto, optional print button. Built on createLightbox. Imported by all six app pages (v12.50)
├── tips-lightbox.js        ← shared per-card Tips (#tipsLightbox) panel: initTipsLightbox(CARD_TIPS, { getIsAdmin }) — lifecycle, renderer (incl. adminOnly/staffOnly filtering), and .btn-card-tips wiring. Pages own only their CARD_TIPS content. Imported by admin-app.js, operations-app.js, settings-app.js, links-app.js (v12.50)
├── session.js              ← shared auth/session module: AUTH_KEY, SESSION_MS, SESSION_VER, getSurname, ensureFirebaseSession, getSession, saveSession, clearSession. Imported by admin-app.js, settings-app.js, operations-app.js, paycalc.js, links-app.js (v11.40; paycalc added v12.49)
├── sw-register.js          ← shared service worker registration + update lifecycle: registerServiceWorker({ beforeReload, bfcache }). Imported by all six app pages (v12.28)
├── app-team-view.js        ← Team Week View: state, grid render, Firestore fetch, toggle, chrome. Imported by app.js
├── app-override-utils.js   ← override priority, member-start, and shift-classification helpers: tsToMillis, shouldReplaceOverride, isBeforeMemberStart, isRestShift. Shared by app.js, app-team-view.js, and admin modules
├── admin-app.js            ← coordinator for admin.html: login, AL/absence booking, Team Week View, module wiring, booked-box helpers, admin-only annual cultural-calendar maintenance reminder (Notifications + Cultural Calendar cards moved to settings-app.js at v11.06)
├── operations-app.js       ← coordinator for operations.html: session guard, Firebase Auth re-establish, initHuddleUpload, initRosterUpload, initAuthSetup (v10.99)
├── settings-app.js         ← coordinator for settings.html: session check (shared AUTH_KEY), login overlay, initHuddleNotifications, cultural calendar init, initNavPanel (v11.06)
├── huddle.js               ← Huddle upload (initHuddleUpload → operations.html), push notifications card (initHuddleNotifications → settings.html), Huddle card toggle. Renamed from admin-huddle.js at v11.40
├── admin-auth.js           ← Staff Firebase Auth account setup card (extracted v9.54)
├── admin-al.js             ← Annual Leave Booking section. Exports initALSection(deps) and triggerConfirmedALSave()
├── admin-sick.js           ← Sick Days Recording section. Exports initSickSection(deps)
├── admin-overrides.js      ← Change a Shift module: week grid, bulk bar, override list, save logic, utilities; exports recordRangeOverrides() shared AL/Sick save helper
├── admin-rangepicker.js    ← Inline date-range calendar: buildRangePicker(prefix) → { reset() }. Imported by admin-al.js and admin-sick.js
├── admin-roster-upload.js  ← Weekly Roster Upload pipeline: computeCellStates, renderReviewTable, shiftDisplay
├── paycalc.js              ← all JavaScript for paycalc.html (UI, DOM, period logic)
├── paycalc-calc.js         ← pure pay math module (no DOM/Firebase): tax, NI, SL, gross, thresholds
├── paycalc-help.js         ← HELP_CONTENT object (tooltip/help text for pay calculator). Pure data, no DOM/Firebase. Imported by paycalc.js (v11.40)
├── paycalc-migrations.js   ← localStorage key constants (SK, periodKey, hppEstKey etc.) and runMigrations(). Imported by paycalc.js (v11.40)
├── paycalc-roster-suggestions.js ← roster pre-fill engine: getRosterSuggestion(p, member), fetchOverridesForPeriod
├── roster-data.js          ← shared module: APP_VERSION, CONFIG, teamMembers, all roster data, utility functions
├── roster-cycle-data.js    ← raw roster cycle arrays — imported by roster-data.js only
├── firebase-client.js      ← shared module: Firebase init, exports db + all Firestore functions
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
├── guide-doc.css           ← shared styles for the TWO document-style guides only (guide.html + paycalc-guide.html): print setup, navy in-document banner, version pill, two-column layout, numbered steps, info box, table, footer, body copy, --text/--mid/--light/--border/--bg tokens. De-duplicated from guide.css + paycalc-guide.css at v13.07. NOT linked by railcard/fip (single-column card pages). Load order: guide-shell.css → guide-doc.css → page CSS (page CSS wins on ties)
├── guide.css               ← guide.html-specific styles only (badge/marker/nav-tip/feature/install grids; banner screen-hide; feature-label print colour). Shared document-guide styles moved to guide-doc.css at v13.07 (extracted from inline <style> at v12.04)
├── paycalc-guide.css       ← paycalc-guide.html-specific styles only (pay-type grid, disc list, banner screen-hide). Shared document-guide styles moved to guide-doc.css at v13.07 (extracted from inline <style> at v12.04)
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
├── admin-rangepicker.test.mjs ← tests for getDateRange() in admin-rangepicker.js (inclusive endpoints, reversed range, month/year/leap/DST boundaries)
├── sw-asset-check.test.mjs ← deployment hygiene: every root JS module listed in service-worker.js asset lists + APP_VERSION matching in all 9 bump locations
├── module-parse.test.mjs   ← verifies every root JS module parses as an ES module (catches fatal SyntaxErrors that would brick a page — added v12.50 after settings-app.js shipped one undetected at v12.28)
├── package.json            ← dev dependencies only: http-server (not deployed; see firebase.json ignore list)
├── firebase.json           ← Firebase Hosting config: CSP headers, cache rules, redirect rules, deploy ignore list
├── storage.rules           ← Firebase Storage security rules: authenticated staff can read huddle files; admin-role token required to write
├── firestore.indexes.json  ← Firestore composite indexes: overrides (memberName + date)
├── generate-sri.mjs        ← dev utility: fetches Mammoth CDN SRI hash and patches huddle.js in-place (DOMPurify is self-hosted — no longer managed here)
└── functions/
    ├── index.js                  ← Cloud Functions: ingestHuddle, parseRosterPDF, setupRosterAuth
    ├── roster-parse-helpers.js   ← Pure helpers: normaliseShift, buildWeekDates, extractAIJson, etc.
    └── package.json
```

**Run all tests:**
```
# Unit / deployment-hygiene tests (no browser, fast)
node --test sw-asset-check.test.mjs links-design.test.mjs admin-rangepicker.test.mjs
node --experimental-vm-modules --test module-parse.test.mjs
node --experimental-test-module-mocks --test app.test.mjs roster-data.test.mjs paycalc.test.mjs paycalc-roster-suggestions.test.mjs roster-parse-helpers.test.mjs
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
| Three-surface model (v11.55, updated v11.58) | Depth comes from three layered surfaces, defined in `shared.css :root`: **canvas** (`--surface-canvas` = navy `--primary-blue`, the page `body` on every page) → **card** (`--surface` = `oklch(98% 0.004 250deg)`, a barely-tinted off-white — cards "sit into" the canvas) → **sunken** (`--surface-sunken` = `oklch(96.3% 0.006 250deg)`, a more visibly cool-tinted off-white for recessed elements *inside* cards). Form fields rest on `--field-bg` (= sunken, 96.3% L) and **brighten to `white` on `:focus-visible`** — a "fills in when active" cue. **Focus rules use the literal value `white`, NOT `var(--surface)`** — focus must always reach the true white ceiling above the card surface. Card backgrounds use `var(--surface)` (not hardcoded `white`); lightbox contents, buttons, day cells, and select options stay at `white` (they are Layer 2, raised above the card). Disabled fields use `--field-bg-disabled` (a flatter, slightly darker NEUTRAL grey), kept deliberately distinct from the cool enabled tint so locked/disabled controls read as inert; admin's `#fieldMember:disabled` (locked-for-non-admins display box) intentionally uses `--field-bg`, not the disabled grey, so it reads as a normal field. **Always set field fills with `background-color` (longhand)** — `<select>`s layer their dropdown arrow via `background-image`, which the `background` shorthand would wipe. The navy canvas is intentional — do not switch the body to a light canvas. |
| Motion vocabulary + unified press (v11.56) | One easing/duration vocabulary in `shared.css :root`: `--ease-standard` (general), `--ease-emphasized` (entrances), `--ease-spring` (overshoot), `--dur-fast` / `--dur-base`. Use these tokens, not inline `cubic-bezier(...)`. **Every primary button** (calendar `.controls button`, paycalc `.btn-primary`/`.nav-pill`/`.ty-tab`, admin `.btn-save`, settings/operations `.btn-action`, shared `#loginSubmit`) shares one tactile press: `:active { transform: scale(var(--press-scale)) }` with `transform` in its `transition`. `--press-scale` is `0.97`, overridden to `1` under a single `@media (prefers-reduced-motion: reduce)` block — so the press becomes a no-op for reduced-motion users **without** a global transition-killer (which would break the lightbox's `transitionend`-driven close). Nav-drawer pills/links keep their opacity-based press (the flat-drawer aesthetic) — do not scale them. |
| Typography scale — shared `--type-*` tokens (standardised v11.77–v11.79) | One type scale in `shared.css :root`: `--type-micro` 10px · `--type-small` 12px · `--type-body` 14px · `--type-medium` 16px · `--type-large` 18px. The four sub-pages (admin, paycalc, operations, settings) use **identical sizes for the same conceptual element**: `body` base `--type-body`; card-header `h2` 13px/700; card `.hint` 12px; form/eyebrow labels `--type-small`; inputs/selects `--type-medium` (16px also stops iOS focus-zoom — never go below 16px on a focusable field); primary action buttons (`.btn-action`/`.btn-primary`/`.btn-save`) 15px. Genuinely distinct components (nav drawer pills, dense roster-review rows, badges, lightbox text) keep their own sizes — they are not "the same element rendered differently", so do not force them onto the shared values. When adding a card/field/button to any sub-page, reuse these sizes rather than inventing new ones. |
| Semantic elements (`<nav>`, `<header>`, `<main>`) | Screen readers depend on these landmarks. Do not revert to `<div>`. |
| Network-first SW for app files | Ensures staff always receive roster updates on next open. |
| `isChristmasRD()` applied before Firestore overrides | Forces Dec 25 and Dec 26 to RD first; Firestore can then override Dec 26 to RDW for overtime. Never reorder this. |
| `getBaseShift(member, date)` for all base shift lookups | Direct access to `roster.data[week][day]` bypasses `startDate` suppression, Christmas rules, and future base-shift logic. Always call `getBaseShift()`, never read `roster.data` directly. |
| Two separate type pill lists in admin | Per-row pills in `renderWeekGrid()` (`admin-overrides.js`) and the bulk-bar pills in `admin.html` (`#bulkBar`) must stay in sync. Current order: AL · Spare · Shift · RDW · Absent · Rest Day |
| **`AL` pill label must stay as `AL`** | Compact mobile layout requires short labels. `AL` is the standard Chiltern abbreviation. Do not expand without discussing layout impact. |
| **`🪑` is the absence emoji — do not change** | Absence covers sickness, childcare, bereavement, and other reasons. Using 🤒 implies illness — GDPR concern. The reason for absence is never stored. **Always ask Gareth before changing the absence icon.** |
| `_staleMemberName` flag in `app.js` | When `getSelectedMemberIndex()` can't find a saved name, sets flag, falls back to default member, shows dismissible banner on next render. Flag cleared after banner fires. |
| Sync chip state machine in `app.js` | hidden → (800ms) → "↻ Updating…" → silent remove on success, or "⚠ Couldn't update" (stays, 10s timeout). "✓ Up to date" removed (v10.19) — noise. Never show raw errors to staff. |
| `_clearState` object in `paycalc.js` | Groups all state for a two-tap destructive action so it resets atomically. Includes `countdownTimer` for live countdown in button label. |
| `CONDITIONAL_ROWS` in `paycalc.js` | Data-driven array: condition → row IDs → field IDs. `updateBhRows(p)` iterates it. Adding future conditional rows means one array entry, not new show/hide logic. |
| Roster snapshot in `paycalc.js` — `snapKey` / `_saveRosterSnap` / `_restoreRosterSuggested` (v12.98) | When the calendar pre-fill is applied, `_saveRosterSnap(pNum, s)` persists the suggested values to `myb_pc_snap_${pNum}` in localStorage. On the next page load, `writeFormData` runs first (restoring saved hours), then `_restoreRosterSuggested(pNum)` compares each field value against the snapshot — fields that still match the roster suggestion re-receive the `roster-suggested` CSS class (gold). This means `_suggestIfBlank` will update those fields again when Firestore returns new data (e.g. an admin added an RDW shift). Fields the user manually edited will differ from the snapshot and are left untouched. `clearPeriod()` deletes the snap key alongside the period data. **Why this is necessary:** `writeFormData` writes `0` as `''` (falsy-zero → blank field); `_suggestIfBlank` skips any field whose value is non-empty AND whose element lacks `roster-suggested` — so a previously-auto-filled non-zero value (e.g. `rdwH=8`) loses its gold class on reload and is mistaken for a manually-entered value, preventing the next Firestore fetch from updating it. The snapshot restores the distinction between "user typed this" and "roster filled this in". |
| `.card-header--row` must declare `display: flex` explicitly (v13.00) | `shared.css` sets `.card-header { display: grid; grid-template-columns: 1fr }` as the base for all card headers. A modifier like `.card-header--row` that only adds `flex-direction: row` will be silently ignored — `flex-direction` has no effect on grid containers. Any modifier that needs horizontal layout must also set `display: flex` to override the inherited grid. Without this, extra content (e.g. the `?` help button) falls into a new grid row below the title rather than sitting beside it. |
| `touch-only` CSS class in `shared.css` | `display:none` by default; revealed via `@media (pointer: coarse)`. Use for touch-only UI. Do not use inline `display:none`. `(hover: hover)` inverse was dropped (v10.15) — some Android devices misreport it. |
| `window.matchMedia('(pointer: coarse)')` in `initSwipeHint()` | Gesture-tutorial UI must only show on touch devices. Always add this guard. |
| **Do not gate layout on `(hover: hover) and (pointer: fine)` alone** | Some Android devices misreport `hover: hover`. For layout breakpoints, always use `min-width`. Hover/pointer queries are only safe for cosmetic `:hover` transitions. |
| `paycalc.html` desktop grid on `<main>`, not `.app` | CSS grid applies to direct children only — declare on `main { display: grid }`. `.app` only holds max-width. |
| `lsGet` / `lsSet` / `lsDel` from `ls.js` | iOS Safari private mode throws `SecurityError` on any `localStorage` access. **Never call `localStorage` directly** in `app.js`, `admin-app.js`, or `paycalc.js` — always use these wrappers. |
| **`select.value = x` silently fails on iOS Safari when options are inside `<optgroup>`** | Setting `sel.value = x` programmatically does nothing — the displayed value stays blank — when the select's options are wrapped in `<optgroup>` elements. The native picker still works (user tap), but page-load restores, programmatic syncs, and post-action resets all break. **Fix: iterate `sel.options` and set `option.selected = true` directly.** Pattern in use: `_setSelectPeriod` in `paycalc.js`; `_setSelectValue` in `admin-app.js`; inline loop in `admin-al.js` and `admin-sick.js`. Every new `<select>` that uses optgroups and is set programmatically must follow this pattern. |
| VAPID fingerprint migration | Both pages store first 12 chars of VAPID key in `localStorage('myb_vapid_ver')`. On mismatch, silently unsubscribes → re-subscribes. Cloud Function treats 401 same as 410/404. |
| One-off notification prompt (`#notifPrompt`) | Appears once per device between `</nav>` and pay-period strip. Both Enable and × set `myb_notif_prompt_done`. Do not move below the calendar. |
| PWA shortcuts in `manifest.json` | Three long-press shortcuts. Changes require reinstall to take effect on existing installs. |
| Sticky take-home bar (`#stickyTotal`) | Fixed bar on mobile (hidden ≥1040px). `IntersectionObserver` shows it when `.result-card` scrolls off. `body.sticky-active` adds bottom padding. |
| 3-digit time input auto-correction in `admin-overrides.js` | On blur, if length is 3 and `parseInt(raw.slice(0,2)) > 23`, prepend `'0'`. Without this, `"630"` produced `"63:0"`. |
| Range picker clear button (`.rp-clear`) | Resets both `from` and `to` dates. Built into `buildRangePicker()` in `admin-rangepicker.js`. |
| **Sundays are non-contracted — AL and Absent cannot be recorded on Sundays** | Sundays are uncontracted for all grades (CEA, CES, Dispatcher). Neither `annual_leave` nor `sick` overrides may be written for a Sunday. Enforcement (do not remove any layer — they work together): (1) `admin-overrides.js` week grid disables both the AL and Absent pills on Sunday rows; (2) the bulk-apply bar silently skips Sunday rows when AL or Absent is the active type; (3) `recordRangeOverrides()` filters Sundays out of `workingDates` before writing overrides; (4) roster upload — `computeCellStates()` in `admin-roster-upload.js` normalises a Sunday PDF `AL`/`SICK` to `RD` (so it classifies as MATCH and is never written), with `shiftValueToOverrideType()` → `correction` plus a `value:'RD'` write-path backstop for the edited-cell path; (5) **display** — `app.js` calendar render and month-legend both suppress a `sick` override when `isSunday(dateStr)` (in addition to base `RD`/`OFF`), so absence never renders on a Sunday even from legacy data when the rotating roster brings a worked Sunday into the range (v12.61). A worked Sunday time is always RDW, never AL/Absent. |
| Sunday RD corrections on absence/AL save | Every Sunday in the range is checked; if `getBaseShift` returns a non-RD shift, an explicit `correction/RD` override is written alongside the AL/sick overrides. Used in both save handlers. |
| Range picker swipe — pointer capture on `grid` not `clip` | Events dispatched to a capture target do not bubble down to children — captures on `clip` breaks the drag animation. |
| Team Week View | Available to all logged-in staff. Grade state (`currentTeamGrade`) persists across re-renders. Fetch token = week-start timestamp — stale Firestore results are discarded. Week navigation clamped to `CONFIG.MIN_YEAR`/`MAX_YEAR`. **No override-load status indicator** — deliberately not added (minimal-noise app). |
| `persistentLocalCache()` in `firebase-client.js` | Firestore stores queries in IndexedDB. Do not revert to `getFirestore()` — Huddle viewer and override cache depend on instant load. |
| `subscribeToLatestHuddle` in `firebase-client.js` | Persistent `onSnapshot` — Huddle viewer updates automatically when a new Huddle arrives. Do not replace with one-time fetch. |
| `normaliseSurname()` in `firebase-client.js` (v12.04) | Shared surname derivation for Firebase Auth: lowercases, strips non-alpha, pads to 6 chars. Exported from `firebase-client.js`; `getSurname()` in `session.js` delegates to it. A deliberate duplicate also exists in `functions/roster-parse-helpers.js` — Cloud Functions are CommonJS and cannot import browser ES modules, so unification requires a build step. If the rule ever changes, update both locations. |
| `cors: true` on `parseRosterPDF` and `setupRosterAuth` | firebase-functions v6 `cors: [array]` doesn't consistently set `Access-Control-Allow-Headers` on preflight. Both functions use Firebase ID token auth, so wildcard origin adds no attack surface. `ingestHuddle` keeps `cors: false` (server-to-server). |
| Android Back button overlay pattern | Overlays push `history.pushState({ mybOverlay: true })` when opening, close on `popstate`. `_pushOverlayState(handler)` / `_clearOverlayHistory()` helpers in all six app pages. |
| Canonical lightbox lifecycle (standardised v11.50, factored into `createLightbox` v12.50) | Every `.lb-overlay` lightbox (About `#iconLightbox`, AL, Team info, Month jump, per-card Tips, paycalc Help/Welcome, links Beta) is built with **`createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose })` in `overlay.js`** — do NOT hand-write the lifecycle in a page module. The factory implements: focus save → `.visible` → rAF `.open` + focus close button (or `initialFocus`) → `lockBodyScroll()` → `_pushOverlayState(close)` → Escape keydown + **`trapFocus` Tab trap** → close via `dismissOverlay` (which removes `.open`, restores focus synchronously, then `transitionend` **with a 500ms `setTimeout` fallback** removes `.visible` + `unlockBodyScroll()` — the fallback is mandatory: iOS suppresses `transitionend` on a backgrounded tab; under `prefers-reduced-motion` it finishes synchronously because the transition is disabled). Backdrop click (`e.target === overlay`) and closeBtn click are wired by the factory; callers prepare dynamic content before `open()` or in `onOpen`. Close controls are `<button class="lb-close">` (never `<span>` — spans aren't keyboard-focusable). The About panel is the shared `about-lightbox.js`; per-card Tips is the shared `tips-lightbox.js`. **Two nav-panel lightboxes are exempt from `createLightbox`** — they share the drawer's single `history.pushState` entry and must use the bespoke open/close pattern in `nav-panel.js`: `#navComingSoonLightbox` (coming-soon placeholder) and `#navNoticesLightbox` (App Notices archive). Never re-wire either from a page module and do not migrate either to `createLightbox`. The huddle viewer (`#huddleViewer`) is a full-bleed panel, not a centred `.lb-content` card, so it has no overlay-click-to-close — that difference is intentional. |
| Nav panel on all 6 pages (v10.57, extended v10.99 + v11.06 + v12.07) | `nav-panel.js` injects overlay + drawer. Burger button `#navMenuBtn` in each page header. `NAV_PAGES` drives the pill row (current page omitted). `NAV_INFORMATION` drives the flat always-open section (Workplace: Daily Huddle, Weekly Retail Circular, Marylebone Newsletter — live docs only). `NAV_GUIDES` (v11.21) drives a separate **expanded-by-default** "📖 Guides" submenu (Staff & Admin Guide, Pay Calculator Guide, Railcard Guide, FIP Travel Guide) — toggled by `#navGuidesToggle`, list is `#navGuidesList` (change to `hidden` and `aria-expanded="false"` if the section becomes too long to show open). Adding a guide = one entry in `NAV_GUIDES`; adding a live doc = one `links` entry in `NAV_INFORMATION`. A `NAV_INFORMATION` entry with `comingSoon: true` (instead of `url`) renders as a `<button>` that opens the injected `#navComingSoonLightbox` placeholder instead of navigating. An entry with `notices: true` renders as a `<button>` that opens `#navNoticesLightbox` — the App Notices archive. The archive is populated via `archiveNotice(notice)` (exported from `nav-panel.js`), which page modules call when a notice lightbox is dismissed. |
| Dark (navy) drawer + scoped tokens (v11.54) | The whole drawer is one continuous navy surface (`--nav-surface` = `--primary-blue`), matching the page header and the navy login overlay so the three read as one family. A set of **drawer-scoped tokens** on `.nav-panel` — `--nav-raised` / `--nav-raised-strong` (white-overlay chips & hover fills), `--nav-text` / `--nav-text-muted` (0.70) / `--nav-text-faint` (0.55), `--nav-border` (0.12) — are the on-navy equivalents of the global `--text-*` / `--border-light` / `--bg-faint` neutrals. Every drawer rule reads these, so the dark theme re-tones from one place; they are defined explicitly (not silent overrides of the global tokens). Alpha values are tuned for WCAG AA on navy (0.70 ≈ 7:1, 0.55 ≈ 5:1). Head and footer are separated from the scrolling body by hairline `--nav-border` borders, not by a colour change. **Pills:** Calendar (gold), Pay (green), Operations (orange) keep their solid fills (they contrast on navy); the **Admin pill** — formerly navy-fill + gold-text, which would vanish on navy — is now a raised chip (`--nav-raised`) with gold text, preserving its navy+gold identity while staying distinct from the solid-gold Calendar pill. Sign-out and the blocked-bell hint mix `--error-red` 65% with white to clear AA on the dark footer. Do not revert the drawer to a white body. |
| Nav-panel logo = About; drawer head shows version (v11.21) | The drawer head is a `#navPanelBrand` button (logo + title + `Version {APP_VERSION}` muted text). Tapping it closes the panel (via `closePanelForNavigation`) then calls `onLogoClick`, which each page passes as `() => openAboutLightbox?.()` — opening that page's existing `#iconLightbox` (version, update status, bug report, and page-specific print/guide links). Each page exposes its scoped open fn through a module-level `let openAboutLightbox` assigned inside its About-lightbox IIFE. This replaces the header logo's old role (see header-logo back button entry). |
| Settings page — shared session, flat nav link (v11.06) | `settings.html` uses the same `AUTH_KEY` as `admin-app.js` — a user already signed in on any page arrives without seeing the login overlay. `initNavPanel` is called at module scope in `settings-app.js` regardless of sign-in state so unsigned users can navigate away via the Calendar/Admin pills. Settings link renders outside the scrollable `nav-panel-body` (pinned above footer) so it is always visible without scrolling. Hidden only on the settings page itself. Styled as a flat link (not a pill). `--indigo` badge colour. |
| Nav-panel footer initials badge (v12.22) | The footer shows a 26px circular badge (`#navPanelAvatar`) before the member name — previously showed a profile photo, now always shows initials on a stable per-name colour. `avatarInitials(name)` and `avatarHue(name)` from `roster-data.js` are called directly in `nav-panel.js` — no fetch, no localStorage, no event listeners. Profile photo feature removed at v12.22; full spec and revert checklist in ROADMAP.md → "Profile photo / avatar". |
| Operations page — admin-only pill (v10.99) | `NAV_PAGES` entry for Operations has `adminOnly: true`. `initNavPanel({ isAdmin })` filters it out for non-admins. `app.js`, `admin-app.js`, and `paycalc.js` pass `isAdmin: CONFIG.ADMIN_NAMES.includes(member)`. `operations-app.js` passes `isAdmin: true` (page already guards against non-admins). Operations page has NO login overlay — JS redirects to `admin.html` immediately if the user is not authenticated or not an admin. |
| Links page — designer-only pill (v12.06) | `NAV_PAGES` entry for Links has `linksDesignerOnly: true`. `initNavPanel({ isLinksDesigner })` filters it out for non-designers. Each page passes `isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(member)`. `links-app.js` passes `isLinksDesigner: true` (page already guards against non-designers, redirecting to `admin.html`). To grant another colleague access, add their name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` — every page already derives `isLinksDesigner` from that list, so no per-page change is needed. Current designers: `'G. Miller'`, `'S. Silva'` (S. Silva added v12.33). |
| One-time notice lightboxes — pattern (v12.33, extended v13.18) | A one-time notice lightbox announces a feature or prompts an action once per device, then archives itself to App Notices. **Recipe:** (1) Add `lb-overlay` markup to the page HTML — one emoji div, `lightbox-app-name` title, `lightbox-badge` section label, one or two `notice-lb-desc` paragraphs, optional `lightbox-bug-link` for a CTA. Card ID-specific CSS goes in the page CSS file — use these exact values (canonical reference: `#noticeYtdContent` in `paycalc.css`, verified v13.18): overlay `z-index: 9000`; content card `display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 24px; padding: 28px 24px 24px; width: min(340px, calc(100vw - 48px)); max-height: 80vh; transform: scale(0.85);` with `#overlayID.open #contentID { transform: scale(1); }` for the entrance animation; `.notice-lb-emoji { font-size: 56px; line-height: 1; margin-bottom: 4px; }`; `.notice-lb-desc { margin: 0; font-size: 13px; line-height: 1.6; color: rgba(255,255,255,0.68); }`; `#contentID strong { color: rgba(255,255,255,0.9); }`; close button `color: rgba(255,255,255,0.45)` with `white` on `:active` and on `:hover` under `@media (hover: hover) and (pointer: fine)`. (2) In the page JS module, add a guarded IIFE at the bottom: `import { createLightbox } from './overlay.js'` and `import { archiveNotice } from './nav-panel.js'`. Gate on `lsGet(NOTICE_KEY)`. The `onClose` callback calls `lsSet(NOTICE_KEY, '1')` and `archiveNotice({ id, title, section, date, body })`. If the notice has a CTA link that navigates away, add a `{ once: true }` click listener that calls the same `archiveAndMark` function before the browser navigates — otherwise the notice reappears on return. (3) `archiveNotice` deduplicates by `id`, so calling it from both paths is safe. **IDs** must be unique and stable (e.g. `'work-email-2026-06'`). **`section`** should be plain text — no emoji — matching the page area (e.g. `'Settings'`, `'Admin'`, `'Pay'`). The CSS applies `text-transform: uppercase`, so an emoji in the value would appear stranded beside the uppercased text. **`date`** is a month-and-year display string (e.g. `'June 2026'`) — never a specific day date. **Do not use `createLightbox` in the two nav-panel lightboxes** — they are exempt (see Canonical lightbox lifecycle entry). Existing instances: `#betaLightbox` (links.html, key `myb_links_beta_seen`) · `#workEmailNoticeLightbox` (admin.html, key `myb_work_email_notice_seen`, v13.17). |
| Links page — beta marker + first-visit notice (v12.33) | The Links workspace is flagged as beta. **Header:** a gold-OUTLINE `.beta-chip` ("Beta") sits beside the solid-gold "🔗 Links" `.badge-page` inside a `.header-end` flex wrapper — outline vs solid keeps them as secondary + primary tags, not two identical pills. A slow `beta-sheen` sweep animates it (disabled under `prefers-reduced-motion`). **First-visit lightbox:** `#betaLightbox` (in `links.html`) follows the canonical lightbox lifecycle and the paycalc Welcome pattern exactly — dark glass `.lb-content`, ✕/overlay/Escape close, `lockBodyScroll` → `_pushOverlayState` → `dismissOverlay`, `trapFocus`, focus-return. Shown once, gated on `lsGet('myb_links_beta_seen')` set on close. Reuses shared `.lightbox-app-name` / `.lightbox-badge`; only the content card is themed in `links.css`. |
| Links page — design and save model (v12.09, redesigned v12.39–v12.43, multi-design v12.46–v12.47) | **Card order (v12.46):** Grid (primary object) → Auto-generator (collapsed by default) → Coverage (hourly heat map) → Design checks. The grid is the artefact; the generator sits directly beneath it because it is the only way to create a new design. **Firestore model (multi-design, v12.46):** `linkDesigns` is a **collection** of named design documents `{ name, patterns, updatedAt, updatedBy }` with auto-IDs. The legacy singleton `linkDesigns/combined-28` (it has no `name` field) is auto-migrated to a named design ("Design 1") on first load and thereafter ignored — never write to it. A picker strip above the grid switches designs: **+ New** (blank), **⎘ Duplicate** (forks the LIVE in-memory patterns, unsaved edits included), **✎ Rename**, **✕ Delete** (disabled on the last design). Designs sort by name (Firestore returns auto-ID order, which is random); the active design id persists via `lsGet('myb_links_active_design')`. Picker chips are a `<div>` wrapping separate `<button>`s — **buttons must not nest** (the HTML parser force-closes an open `<button>` when another starts). **⇔ Compare (v12.46):** with ≥2 designs, compare mode shows two read-only grids (active + chosen) with a gold-outline diff on differing cells — side-by-side at ≥1024px, stacked below; each compare column keeps `overflow-x:auto` even on desktop (two 560px-min tables can't share an 1100px container). The main grid stays **rendered** in compare mode and is hidden on screen only (`body.links-compare-on` + `@media screen` rule) so print always outputs the active design; a print-only `#printDesignName` label names the printed sheet. `.shift-cell-btn` and `.brush-chip` set `touch-action: manipulation` — paint mode is rapid tapping, which otherwise triggers double-tap zoom on iOS/Android. `patterns` is `{ "1"–"28": { sun, mon, tue, wed, thu, fri, sat } }` (each value a shift string, `"SPARE"`, or `"RD"`). **Staff names were removed at v12.39** — the design is patterns-only ("Line 1", "Line 2"…); who goes on which line is a separate decision made after the patterns are agreed. Legacy `meta` in old documents is ignored on load and dropped on the next save. **Pure-maths module:** all design maths live in `links-design.js` (no DOM, no Firebase; tested by `links-design.test.mjs`) — `classifyShift`, `normaliseCustomShift`, `calcCoverage`, `calcHourlyCoverage`, `generatePatterns`, `runDesignChecks`, `dayClass`. `links-app.js` imports these; do not duplicate them back into the app file. **Single dirty flag** + one `linksSaveBtn` / `saveChanges()`. **Unsaved-changes guard:** `beforeunload` + explicit `confirm()` on sign-out, logo navigation, and a capture-phase click guard on nav-drawer links (mobile browsers suppress `beforeunload` dialogs). **Paint mode (v12.39):** a brush chip bar above the grid (`#brushBar`) — clicking a chip arms that shift; clicking grid cells then applies it directly (no dropdown); clicking the armed chip again or pressing Escape disarms. With no brush armed, a cell click opens the dropdown as before. Grid clicks are **delegated** on `#linksGridBodyRows` — do NOT call `renderGrid()` from inside `saveChanges()`. **CEAs do not work night shifts (confirmed by Gareth June 2026)** — night times are never offered in any dropdown or brush chip, and `normaliseCustomShift()` rejects starts between 21:00 and 03:59; do not re-add a Night option. `classifyShift`’s `night` return is defensive only (legacy/imported data). **Coverage heat map (v12.40):** the Coverage card renders an **hour-by-hour table** (`calcHourlyCoverage`) — rows = days, columns = hours spanning the staffed day, cell = on-duty headcount, intensity buckets `heat-b0`–`heat-b5` (color-mix tints of `--cov-early`, scaled to the week’s peak). The station is staffed in **waves** (opens ~06:20, morning build 07:00–08:30, middles 11:00–12:00, afternoons 13:30–14:30, closes 15:00+), so an early/late split hides the real shape — do not revert to per-type stacked bars. A red `0` inside a day’s staffed span marks a coverage gap; spares (no times) get their own `SP` column. The grid `tfoot` keeps compact per-day `E:/L:/SP:` counts. **Design checks (v12.39, completeness added v12.41):** `runDesignChecks(patterns, 28)` — **unfilled lines** (any rotating line that is entirely rest days is *not yet designed*, not a vacancy — see Line numbering), weekends off (Sat of line w + Sun of line w+1, wrapping), short turnarounds (<12 h rest between consecutive timed shifts across the whole circular rotation), longest consecutive-worked-days run, early/late balance. Renders plain-English traffic-light rows (completeness first); updates live on every cell edit / generate. All 28 lines rotate and are checked. **Auto-generator (v12.39, slot-based v12.40) — the only way to create a new design (v12.43):** targets are a LIST of shift slots — one row per distinct start time, each with separate **Mon–Fri / Sat / Sun** headcounts (the real roster genuinely differs on all three) — plus a spare row. The table is **seeded from the current roster** on page load via `buildRosterTargets()` (main 20 weeks + the 2 BL lines; weekday count = busiest Mon–Fri day) so designers start from what today’s roster provides; `↺ Reset targets from current roster` re-seeds. `generatePatterns({ slots, spare, lines: 28 })` uses a rotating-window construction: window slides forward completing one lap per week; within the window slots are ordered latest-start at the front, earliest at the back, spare in the middle — so each person’s week only moves later (never a late finish then early start; asserted by tests). Daily targets are met exactly; any day-class total > 28 is rejected. Generator writes all 28 lines. **Do not add back an "Initialise/Reset from current rosters" path** — that path (removed v12.43: `buildDefaultDesign`, `initFromRosters`, `resetFromRosters`) copied raw 22-line roster patterns as a starting point, leaving lines 23–28 as all-RD blanks. That’s the wrong tool: the designer needs a complete 28-line rotation, not a partial copy; the generator produces exactly that. **Line numbering (full 28-line rotation, v12.42):** All 28 lines rotate and **every one must carry a real worked pattern** — in the rotation everyone passes through every line, so a "vacancy" is a missing *person*, not a missing *pattern*. You can’t authorise a link with empty lines and re-cut it each time someone is hired; the posts will be filled by the time it goes live (confirmed by Gareth June 2026). **C. Reen is NOT a special case here (v12.42):** the link is designed as a full 28 so it still works if she ever leaves; her adjusted fixed shifts are applied as overrides on the base roster (the normal app override mechanism), not modelled inside this designer. The old "line 28 is C. Reen’s fixed link" model (`FIXED_POS`, the `fixed-link-separator` row, non-editable `fixed-cell`) and the earlier "lines 23–27 are vacant placeholders" model (`VACANT_FROM`) were **both removed** (v12.41 dropped vacant; v12.42 dropped fixed). `ROTATING_LINES = 28`. All 28 rows are normal editable rotating rows. The grid flags an all-rest line with an amber line-number cell (`.row-unfilled`); the Design checks "Lines not yet designed" row lists them until filled. **Position keys:** always `String(pos)` (`"1"`–`"28"`), never `Number`. **Shift option lists:** `EARLY_SHIFTS` / `LATE_SHIFTS` derived from `weeklyRoster` + `bilingualRoster` at module load — never a static list, never a Night group. **Custom time…** in cell dropdown, brush bar, and generator selects — `prompt()` validated by `normaliseCustomShift()`. **Concurrency & load safety (v12.37):** `saveChanges()` re-reads the doc and compares `updatedAt` against `loadedUpdatedAt`; on mismatch a `confirm()` names who saved and when before overwriting. A failed read sets `loadFailed` — empty state shows an error. **Print (v12.37):** A4 landscape grid + coverage + checks; generator and brush bar hidden. **Sticky day headers (v12.37):** at ≥1024px `.links-grid-wrapper` drops `overflow-x` and `.card` uses `overflow: clip` (not `hidden`) — both load-bearing for the sticky `thead`. |
| Header back button removed (v10.63) | `admin.html` / `paycalc.html` no longer have a header `←` back button — it duplicated the nav drawer's Calendar pill (two competing nav paradigms) and clashed visually with the logo box. Navigation back to the roster is via the drawer. Header is now `[☰] [logo] Title … [badge]`. The admin "open calendar on the month I was editing" behaviour moved from the back button onto the `.nav-panel-pill--calendar` click in `admin-app.js`. `.btn-back` CSS removed from `shared.css` (still defined locally in `fip.html` / `railcard-guide.html`). |
| Header logo = back to calendar on sub-pages (v11.21) | On `admin.html` / `paycalc.html` / `operations.html` / `settings.html` the header logo `#appIcon` now navigates to `./index.html` (`title`/`aria-label` = "Back to calendar"). This restores an iOS-friendly back affordance (iOS standalone PWA has no system back) without re-adding a visible back button — kept "invisible" as just the logo. The About lightbox it used to open moved to the **nav-panel drawer logo** (see that entry). The **calendar page keeps its header logo opening About** (`.title-icon` in `app.js`) — home has no "back" target. Do not wire the calendar header logo to navigate. |
| `.app-header` brand centering (v10.66) | `admin.html` / `paycalc.html` headers use `display:grid; grid-template-columns:1fr auto 1fr`. Burger sits in col 1 (`justify-self:start`), logo+title in an `.app-header-brand` flex wrapper in col 2 (auto, truly centred), badge in col 3 (`justify-self:end`). Equal `1fr` side columns guarantee the brand is always centred regardless of burger/badge width asymmetry. The calendar uses a different `.header` (balanced spacers), unaffected. |
| Sign-out in nav panel footer (v10.59) | Sign-out button moved from page headers to the nav panel footer. `initNavPanel({ onSignOut: fn })` — each page passes its own sign-out callback. Footer (member name + Sign out button) renders only when `onSignOut` is supplied. `.btn-signout` CSS removed from `shared.css`. |
| Nationality flags in nav panel footer (v10.64) | Optional `flags: ['🇬🇧','🇳🇬']` array on a `teamMember` (max 2). `nav-panel.js` imports `teamMembers`, looks up the logged-in member by exact name, and renders the flags between the name and the bell (set via `textContent`). Flag emojis render correctly on Android (primary platform); **hidden on Windows** via UA detection (`/Win/.test(navigator.platform) \|\| /Windows/.test(navigator.userAgent)`) — Windows renders them as 2-letter codes. Adding a member's flags = one array on their `teamMembers` entry. |
| Notification bell in nav panel footer (v10.61) | `notif.js` is the shared Web Push module; `nav-panel.js` imports it and renders a 🔔/🔕 toggle in the footer (signed-in only, hidden when `notifSupported()` is false — incl. iOS non-standalone). Bell refreshes on every panel open; tap keeps the panel open. States: `on`/`off-default`/`off-lapsed`/`denied`/`unsupported`. `app.js` and `huddle.js` also import `notif.js` — VAPID key and subscribe/unsubscribe logic live in one place (v10.79). The `#notifPrompt` calendar strip stays on the calendar; the Notifications card lives on settings.html (moved v11.06). |
| Guide pages back button → index.html (v10.57) | `railcard-guide.html` and `fip.html` back buttons now link to `./index.html` (not `./admin.html`) — guides are accessed from the nav panel, not the admin page. |
| Maskable icons | 512px entry uses `"purpose": "any maskable"` for Android adaptive shapes. Smaller icons omit this. |
| **Chiltern Saturday payroll: rostered Saturday → `sat` (1.25×); Saturday-on-RD → `rdw`** | Rostered Saturday: 1.25× in `sat` bucket. Saturday that was a rest day and worked: `rdw` bucket — staff use the RDW field, not the Saturday field. Confirmed by Gareth May 2026. Tests assert this. Do not change without further payroll confirmation. |
| **Chiltern Sunday-on-BH: Sunday wins (1.5×)** | `dow === 0` check is before `isBH` in the suggestion engine. Confirmed by Gareth May 2026. |
| **BH + `rdw` override is additive, not replacement** | `rdw` override on a worked BH day adds hours to `bhOt`; base hours stay in `bh`. Do not change to "override replaces base" without specific confirmation. |
| `initALSection()` / `initSickSection()` in `admin-app.js` | `alMember`, `sickMember`, `syncMemberDisplay`, `syncSickMemberDisplay` are hoisted to module scope above the `fieldMember` change handler — that handler fires before init. Do not move them inside the init functions. |
| SW synthesised offline page uses status 200 | Some browsers suppress 5xx response bodies. `Cache-Control: no-store` prevents caching the synthesised page. |
| SW offline fallback only for navigation requests (v10.15) | Only `event.request.destination === 'document'` requests get the offline HTML page. JS/CSS get `Response.error()`. Without this, `/admin-app.js` matched `'admin'` in the fallback logic and got HTML for a JS request — MIME-type error. Fallback routing chain (v11.87): `paycalc` → `paycalc.html` · `operations` → `operations.html` · `settings` → `settings.html` · `admin` → `admin.html` · otherwise → `index.html`. |
| Huddle notification → `#huddle` hash pattern | SW navigates to `#huddle`; `app.js` `hashchange` handler triggers the viewer (`_autoOpen` is `let` so it can reset). **Two viewer paths — do not unify, do not revert notification path to direct `window.open`/`location.href`:** `htmlContent` present (DOCX converted server-side) → renders inline in both paths. No `htmlContent` (PDF or failed conversion) → the viewer shows an in-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`); its click is a real gesture (a direct `window.open`/`location.href` on a hash-open would be pop-up-blocked or knock the PWA out of standalone). The viewer is opened **only** via the `#huddle` hash — from both the nav-panel "Daily Huddle" link and notification taps (the old `#huddleBtn` was removed at v12.57). `huddles` Firestore reads are open (no auth) — `app.js` has no Auth session, so requiring auth would break auto-open on fresh visits. Full rationale: **OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour"**. |
| `isBeforeMemberStart(member, date)` in `app-override-utils.js` (v10.16) | Returns true if `date` is before the member's `startDate`. Always use this helper — never inline the date comparison. |
| `navigateToPaycalc(paydayStr)` in `app.js` (v10.17) | Encapsulates session-check-then-navigate for payday and cutoff cell clicks. Always call this helper — never duplicate the navigation logic. |
| SW `new Request(url)` fetch pattern (v10.16) | `new Request(event.request.url, { cache: 'no-store', ... })` instead of passing opts to an existing Request. Passing opts alongside a Request doesn't reliably override cache mode on older Safari/Chromium. |

---

## Payday calculator — integrated (v6.50)

| Component | Location |
|-----------|----------|
| `getPaydaysAndCutoffs(year)` | `roster-data.js` |
| `isPayday(date)` / `isCutoffDate(date)` | `roster-data.js` |
| 💷 / ✂️ calendar markers | `app.js` — `.payday` / `.cutoff` CSS classes |
| `getRosterSuggestion(p, member)` | `paycalc-roster-suggestions.js` — counts Sat/Sun/BH/Boxing Day/RDW. **Conservatism policy (v9.02, permanent):** does NOT infer ambiguous categories (swap shifts, rest-day weekday overrides). |
| `getEffectiveContr(p)` | `paycalc.js` — contracted hours, pro-rated if member has `startDate` in the period |
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
Reads: open (no auth required — app.js has no session; see Huddle notification tap behaviour in OPERATIONS_REFERENCE.md).
Writes: require auth + admin claim. Cloud Function writes via Admin SDK (bypasses rules).

**memberSettings**
```
memberName     Must match teamMembers[n].name exactly
faithCalendar  'islamic' | 'hindu' | 'chinese' | 'jamaican' | 'congolese' | 'portuguese' | 'none'
```

**staffContact** (v12.68)
```
memberName  Must match teamMembers[n].name exactly — used as the document ID
workEmail   Work email address (5–200 chars, must contain @)
updatedAt   Firestore server timestamp
```
Read/write restricted: owner can read/write their own doc; admin can read all.
Write requires the `name` JWT claim (set by setupRosterAuth) — anonymous fallback sessions cannot write.
Purpose: Stage 1 of password security improvements. Email will enable future account recovery (Stage 4).
Read/written/deleted by: `getStaffContact` / `saveStaffContact` / `deleteStaffContact` in `firebase-client.js`, called from `settings-app.js`.

**pushSubscriptions**
```
endpoint   Browser push endpoint URL — also used (hashed) as the document ID
keys.p256dh  base64url-encoded p256dh public key
keys.auth    base64url-encoded auth secret
```
Written by `savePushSubscription`, deleted by `deletePushSubscription` in `firebase-client.js`.
Each document ID is a SHA-256 hash of the endpoint URL (first 16 hex chars). One doc per subscribed browser/device.
Read by the `ingestHuddle` Cloud Function (Admin SDK) when fanning out push notifications.

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

## Annual maintenance — cultural calendar data

15 lunar/lunisolar datasets need updating each November/December:

| Calendar | Datasets |
|----------|----------|
| Islamic | Ramadan, Eid al-Fitr, Eid al-Adha, Islamic New Year, Mawlid |
| Hindu | Holi, Navratri, Dussehra, Diwali, Raksha Bandhan |
| Chinese | New Year, Lantern Festival, Qingming, Dragon Boat, Mid-Autumn |

Jamaican, Congolese, and Portuguese calendars are rule-based and auto-compute.

**Sources:** islamicfinder.org · drikpanchang.com (London timezone) · chinesenewyear.net

`warnIfCulturalCalendarMissingYear()` logs a console warning if any dataset is missing the current year.

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

**New starter checklist — run through every time:**

**Step 1 — `roster-data.js` (always required)**
- [ ] Add entry to `teamMembers` with `name`, `currentWeek`, `rosterType`, `role`, `flags`
- [ ] If joining mid-year: add `startDate: new Date(year, month-1, day)` — **midnight only, no time component**
- [ ] If joining mid-year: add `proRatedAL: { year: N }` — formula: `⌈(daysRemainingInYear / 365) × entitlement⌉`
  - Count from start date inclusive to 31 Dec inclusive
  - CEA entitlement = 32 days; CES = 34 days
  - Example: May 5 start → 241 days → ⌈241/365 × 32⌉ = 22

**Step 2 — Firebase Auth (always required)**
- [ ] Admin → Operations → Staff Login Accounts → **Set up accounts** (creates the login)
- [ ] Confirm password convention in `OPERATIONS_REFERENCE.md`

**Step 2b — `functions/index.js` (CEA / CES / Dispatcher only — not Management)**
- [ ] Add the new member's name to the correct `STAFF_NAMES` array (`cea`, `ces`, or `dispatcher`) inside `parseRosterPDF` — the weekly roster PDF upload ignores any name not in this list, so a missing entry means that staff member's shifts are silently excluded from every roster import until this is updated. The list is hardcoded (can't import the browser ES module `roster-data.js` from a Cloud Function) and must be kept in sync manually.

**Step 3 — Pay calculator verification (mid-year joiners only)**
- [ ] Log in as the new member, open pay calculator, check the joining period shows the info banner and correct pro-rated contracted hours
- [ ] Joining period = the pay period whose cutoff is on or after the start date
- [ ] Expected pro-rated hours = `Math.round(140 × daysEmployed / totalDays)` where totalDays = cutoff − prevCutoff and daysEmployed = `Math.round((cutoff − startDate) / msPerDay) + 1`

**That's everything** — calendar display, team view, override eligibility, roster-assist pre-fill, and all subsequent pay periods are automatic.

---

**Adding a mid-year joiner — field reference:**

| Field | Example | Purpose |
|-------|---------|---------|
| `startDate` | `new Date(2026, 3, 20)` | Midnight local time — no hours argument. `getBaseShift` returns `'RD'` before this. Scales hours, London Allowance, pension, HPP for the joining period. |
| `proRatedAL` | `{ 2026: 23 }` | Override AL entitlement for joining year only. Standard entitlement resumes next year. |

**Formula invariant — do not break:** `calcProRateFactor` in `paycalc-calc.js`:
```
raw          = (periodCutoff_noon − startDate_midnight) / msPerDay   // always X.5
daysEmployed = Math.round(raw) + 1                                    // rounds .5 up
factor       = daysEmployed / totalDays
```
`startDate` must be midnight local. A time component breaks the formula. Verified against M. Okeke May 8 2026 payslip (50% factor, London Allowance £138.08 ✓).

**Removing a staff member:** Set `hidden: true`, run Set up accounts with "Disable accounts for leavers".

Email/password convention: **see `OPERATIONS_REFERENCE.md`**.

---

## Pay calculator — current reality (v8.21+)

Primarily **manual-entry**. Staff enter hours; calculator computes tax, NI, pension, take-home.

**Grades supported:** CEA and CES. Dispatcher not yet supported — rates not confirmed.

| Grade | 2025/26 rate | Contracted hrs | Pension | London Allowance |
|-------|-------------|----------------|---------|-----------------|
| CEA | £20.74/hr | 140/period | £147.36 (from P51 May 8 2026) | £276.16 |
| CES | £21.81/hr | 140/period | £147.36 (from P51 May 8 2026) | £276.16 |

2026/27 rates: not yet confirmed — update `GRADES` in `paycalc.js` when announced.

**Members with `startDate`:** for the joining period, `calcProRateFactor` scales contracted hours, London Allowance, pension default, and HPP. All subsequent periods use standard amounts automatically.

`saveSettings` guards the pension default on joining periods — writes `getPensionDefault(curP)` (full rate), not the field value (pro-rated). Without this guard, saving Settings on the joining period corrupts the default for subsequent periods.

The **calendar pre-fill bar** ("Fill from calendar" / "Replace with calendar values", renamed from "Fill from roster" at v12.99) pre-fills Sat/Sun/BH/Boxing Day/RDW hours from base roster + Firestore overrides. Standard weekday hours are not pre-filled. Pre-filled fields turn gold. When an admin changes a shift after a member has already opened that pay period, the updated values appear automatically on the member's next open — the roster snapshot system (v12.98) restores the `roster-suggested` class on reload so `_suggestIfBlank` can update still-gold fields when Firestore returns new data.

---

## Railcard guide

`railcard-guide.html` is an at-work quick reference for staff checking railcard-discounted tickets at the **gateline** and **selling** them at the **ticket office**. It is not a customer-facing page and not an educational article — judge every decision against "can a staff member glance at this mid-transaction and get the right answer fast?"

**Design principles — do not change without discussion:**
- **"For dummies" clarity over completeness.** Plain language; no jargon. If adding a fact makes the page harder to scan, leave it out.
- **Glanceable card layout.** One card per railcard. Rows: Save / When / Who (only where genuinely needed). Do not add rows that aren't operationally relevant at the gateline or ticket office.
- **Colour stripe = Mon–Fri time rule only.** Green = any time. Amber = morning restriction. Red = Network (strictest). Do not repurpose these colours for anything else.
- **£ / ⊘ tokens in the When row.** £ = travel allowed, minimum fare applies. ⊘ = no discount before the cutoff. These symbols are defined in the key strip at the top — keep both the symbols and the key.
- **Weekend banner is deliberately simple.** It says the morning/min-fare limits usually don't apply at weekends — it does NOT say all restrictions lift. Do not broaden it back.
- **Chiltern-specific callouts** (`rc-chiltern`) are amber banners inside the card. Keep them; staff are Chiltern staff and need route-specific guidance.
- **Photo-check is a table, not prose.** The `.photo-table` inside check step 3 gives colour-coded rows by card type. Keep it. Distinguish physical vs digital explicitly.
- **Selling essentials live in gotchas.** Minimum-fare mechanic ("charge the higher of the discounted fare or the minimum — never on Advance"), First Class eligibility per card, season-ticket exceptions. Do not move these to the card rows — the gotchas section is where selling detail belongs.

**What to care about:**
- Factual accuracy per card — verify against nationalrail.co.uk and the individual card's own site before changing any rule.
- Min-fare amounts (£12/£13) and the July/August waiver list (16-25, HM Forces, Veterans waived; 26-30 not waived) — these are reviewed annually; re-check each spring.
- Senior Railcard Chiltern note — must say "journeys within the Network area" not "all Marylebone services"; through journeys to Birmingham are different. Do not collapse these into a single blanket rule.
- Family & Friends — the morning-peak restriction is on Network-area journeys only, not the whole card. The subtext must not imply the card is Network-area-only.
- Two Together photocard — the current wording is deliberately softened ("check names/photos on the card or its photocard") because the physical card format was not verified from an authoritative source. Do not strengthen the claim without confirmation.
- Guide pages do **not** import the app's `shared.css` (nav panel / lightbox / login chrome they don't use). They share only `guide-shell.css` — the small common header/button/print chrome (v11.48). Each page has its own external CSS file (`guide.css`, `paycalc-guide.css`, `railcard-guide.css`, `fip.css`) for its content — extracted from inline `<style>` blocks at v12.04. The two **document-style** guides (`guide.html` + `paycalc-guide.html`) additionally share `guide-doc.css` (linked between the shell and their page CSS) for the print/banner/steps/table/info/footer/two-column styles they have in common — de-duplicated at v13.07; `railcard`/`fip` do not link it. Do not add a `shared.css` import to any guide.
- Guide pages use no inline `<script>` or `onclick` handlers — Firebase Hosting CSP (`script-src 'self'`) blocks them. All guide JS is in external files: `railcard-guide.js` (v10.84) and `guide-print.js` (v10.84, shared by `guide.html` and `paycalc-guide.html`). Do not add inline scripts or `onclick` attributes to any of these pages.

**What not to flag as defects:**
- No JS modules — static page, intentional.
- Sticky header + sticky chip bar eating vertical space on small phones — acceptable trade-off for fast navigation.
- A–Z order with numeric cards first — intentional, easy to scan.

## FIP guide

`fip.html` is a low-frequency educational reference — not a core workflow. Judge it as an article-like reference page. Do not flag reference-page format as a design defect. Care about: factual accuracy, "last checked" date, source links, mobile layout, navy/gold palette.

## Unified guide shell (v11.47)

All four guide pages — `guide.html`, `paycalc-guide.html`, `railcard-guide.html`, `fip.html` — share one chrome so they behave consistently on iOS, Android, desktop and print. The common chrome lives in **`guide-shell.css`** (linked by all four, before each page's inline `<style>`). Edit the shell there once — do not re-inline it. As of v11.85, `guide-shell.css` defines the shared brand palette tokens (`--navy`, `--navy-dark`, `--navy-mid`, `--gold`) in its own `:root` — guide pages no longer redefine these themselves.

**In `guide-shell.css` (shared — change once):**
- **Header:** full-bleed sticky navy `.page-header`, `align-items: center`, `top: 0`, with `←` `.btn-back` (left) · title `<h1>` + `.sub` · `⤓ PDF` `.btn-pdf` (right, `margin-left:auto`). Top padding `max(14px, env(safe-area-inset-top))` for the iOS notch.
- **Print:** `.page-header { position: static; print-color-adjust: exact }` and `.btn-back, .btn-pdf { display: none }`. railcard/fip print the sticky header as their title banner; on guide/paycalc the header is `.no-print` so these rules are inert there (they print their own in-document `.guide-header` banner instead — `print-color-adjust: exact` on that banner stays inline).

**Still per-page in each page's own CSS file (keep aligned by eye):**
- **Background:** flat `#f4f5f8` edge-to-edge. No white "page" card (removed at v11.47).
- **Content width:** `max-width: 760px`, centred. guide/paycalc keep their two-column `.cols` grid inside this for print density; railcard/fip are single-column. (Old 620px reference width widened to 760 at v11.47.)
- **Safe-area:** side insets `max(16px, env(safe-area-inset-*))` on the content wrapper; bottom `max(40px, env(safe-area-inset-bottom))`.
- **PDF button markup:** `<button id="savePdfBtn" class="btn-print btn-pdf">⤓ PDF</button>`. Wired by `guide-print.js` (`.btn-print`) on guide/paycalc/fip; `railcard-guide.js` wires `#savePdfBtn` itself because it also owns the chip-bar.
