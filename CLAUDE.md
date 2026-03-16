# Claude Code Instructions — MYB Roster App

## Version bumping (MANDATORY on every change)

**As of v4.92:** `APP_VERSION` is declared once in `roster-data.js` and read everywhere else. You only need to update **five** places:

| File | Location | Example |
|------|----------|---------|
| `roster-data.js` | `export const APP_VERSION = '...'` | `APP_VERSION = '4.92'` ← **primary source** |
| `service-worker.js` | `const APP_VERSION = '...'` | `APP_VERSION = '4.92'` ← must match |
| `index.html` | Line 2 HTML comment | `<!-- MYB Roster Calendar - Version 4.92 -->` |
| `index.html` | `import ... from './roster-data.js?v=...'` | `roster-data.js?v=4.92` |
| `index.html` | `import ... from './firebase-client.js?v=...'` | `firebase-client.js?v=4.92` |
| `admin.html` | Line 2 HTML comment | `<!-- MYB Roster Admin v4.92 -->` |
| `admin.html` | `import ... from './roster-data.js?v=...'` | `roster-data.js?v=4.92` |
| `admin.html` | `import ... from './firebase-client.js?v=...'` | `firebase-client.js?v=4.92` |

`CONFIG.APP_VERSION` and `ADMIN_VERSION` in the HTML files now read from `CONFIG.APP_VERSION` which is set inside `roster-data.js` — no manual update needed for those.

- Increment the patch number (e.g. 4.92 → 4.88) for every commit that touches app behaviour
- The import `?v=` cache-busting strings **must** still be updated manually (browsers use them to bust the module cache)
- Tell the user the new version number in your reply after committing

---

## How to work with the owner

Gareth built this app through extended collaboration with Claude.ai. He has strong operational knowledge of railway rostering and is actively learning software development. Every session is both a development session and a teaching session.

- **Explain decisions** — not just what, but why, what the alternative was, and what it enables
- **Plain language first** — explain new concepts before showing implementation
- **Name the pattern** — if using a design pattern, name it and say why it fits
- **Flag trade-offs** — briefly note what the other option was and why this was chosen
- **Never assume prior knowledge** of cloud services, authentication patterns, or backend concepts

The goal is that Gareth understands the codebase, not just that the codebase works.

---

## Current file structure

```
roster-app/
├── index.html          ← main PWA app
├── admin.html          ← staff self-service and admin portal
├── roster-data.js      ← shared module: APP_VERSION, CONFIG, teamMembers, all roster data, utility functions
├── firebase-client.js  ← shared module: Firebase init (one place), exports db + all Firestore functions
├── service-worker.js   ← v5.5 (cache name now includes app version, e.g. myb-roster-v4.92)
├── manifest.json       ← PWA manifest
└── icon-*.png          ← 6 sizes: 120, 152, 167, 180, 192, 512
```

**Service worker caching strategy:**
- Network-first: `index.html`, `admin.html`, `roster-data.js`, `firebase-client.js` — must always be fresh
- Cache-first: icons (cached individually), `manifest.json` — stable assets
- Cache name format: `myb-roster-v{APP_VERSION}` — any version bump automatically invalidates the old cache

---

## Brand colours — Chiltern Railways

| Variable | Hex | Use |
|----------|-----|-----|
| `--primary-blue` | `#001e3c` | Dark navy — headers, buttons, day-header cells |
| `--primary-blue-dark` | `#00152a` | Deeper navy — hover states |
| `--accent-gold` | `#f5c800` | Gold — today cell, today button, active highlights |
| `--accent-gold-dark` | `#e6bb00` | Darker gold — hover on today button |

The current scheme is navy and gold. All colour values must be assigned to CSS variables in `:root` — never hardcode hex values in CSS rules.

---

## Architecture decisions — never change without discussion

| Decision | Reason |
|----------|--------|
| No framework (vanilla JS) | No build step, easy to understand and modify. Do not introduce React, Vue, or any library beyond Firebase. |
| No bundler | External dependencies load from CDN only. |
| Pointer Events API for swipe | Handles mobile touch, desktop mouse, and trackpad in one handler. Do not revert to Touch Events. |
| `aria-live` for month announcements | Programmatic `.focus()` on the month heading caused flex container reflow — confirmed mobile layout bug. Do not switch. |
| `Math.ceil()` on carousel panel width | Eliminates sub-pixel rendering seam on high-DPI screens. Do not remove. |
| CSS variables for all colours | Defined in `:root`. Never hardcode hex values anywhere in CSS or JS. |
| Semantic elements (`<nav>`, `<header>`, `<main>`) | Screen readers depend on these landmarks. Do not revert to `<div>`. |
| Network-first service worker for app files | Ensures staff always receive roster updates on next open. |
| `isChristmasRD()` applied before Firestore overrides | Forces Dec 25 and Dec 26 to RD first; Firestore can then override Dec 26 to RDW for overtime. Never reorder this. |

---

## Shift types

| Value | Badge | Meaning |
|-------|-------|---------|
| `'RD'` | 🏠 Rest | Rest day |
| `'OFF'` | 🏠 Rest | Off day — bilingual roster only, treated identically to RD |
| `'SPARE'` | 📋 Spare | On standby, shift not yet assigned |
| `'RDW'` | 💼 RDW | Rest day worked — overtime |
| `'AL'` | 🏖️ AL | Annual leave |
| `'HH:MM-HH:MM'` | ☀️ / 🌙 / 🌃 | Worked shift |

**Shift classification:**
- Early: 04:00–10:59 (`EARLY_START_THRESHOLD = 4`, `EARLY_SHIFT_THRESHOLD = 11`)
- Late: 11:00–20:59
- Night: 21:00–03:59 (`NIGHT_START_THRESHOLD = 21`)

**isWorkedDay:** Returns false for RD, OFF, SPARE, AL. True for everything else including RDW.

---

## Roster data structure

### teamMembers fields

```javascript
{
  name: 'G. Miller',       // Display name — MUST match Firestore memberName exactly
  currentWeek: 3,          // Current roster week number
  rosterType: 'main',      // 'main' | 'bilingual' | 'fixed' | 'ces' | 'dispatcher'
  role: 'CEA',             // 'CEA' | 'CES' | 'Dispatcher'
  hidden: false,           // Optional — hides from dropdown (vacancies, leavers)
  permanentShift: 'early'  // Optional — forces all worked days to early or late badge
}
```

### Roster types

| Type | Cycle | Notes |
|------|-------|-------|
| main | 20 weeks | Core CEA roster |
| bilingual | 8 weeks | Bilingual CEAs |
| fixed | 1 week | C. Reen, Mon–Fri 12:00–19:00 |
| ces | 10 weeks | CES Supervisors |
| dispatcher | 10 weeks | Dispatchers |

### Firestore collections

**overrides** — shift overrides entered by staff or admin

```
date         string     "YYYY-MM-DD"
memberName   string     Must match teamMembers[n].name exactly — including
                        capitalisation and punctuation. One character mismatch
                        means overrides silently fail to appear.
type         string     "spare_shift" | "overtime" | "rdw" | "swap" |
                        "annual_leave" | "correction"
value        string     "HH:MM-HH:MM" or "AL" or "RD"
note         string     Free text — use "" if none. Field must always be present.
createdAt    timestamp  Firestore server timestamp
```

**memberSettings** — per-member preferences (currently: Islamic marker toggle)

Override cache key format: `"memberName|YYYY-MM-DD"` (pipe separator)

### Authentication

Staff log in to admin.html with their name (dropdown) and surname as password (lowercase, no spaces or special characters). Example: `'G. Miller'` → `miller`. Sessions persist for 30 days via localStorage.

`ADMIN_NAME = 'G. Miller'` has elevated admin access beyond standard staff permissions.

Firebase SDK: currently v12.10.0. Check for the current version before any new Firebase work.

---

## Key rules

- **Offline first** — Firestore is an enhancement, not a dependency. Every Firestore call needs a silent fallback to the base roster. Never block rendering waiting for Firestore.
- **Mobile is primary** — all staff use this on Android phones. Test every change at 375px.
- **Print CSS** — any new shift type, cell class, or badge needs rules inside `@media print`.
- **No `alert()`** — use `console.error()` for developer errors. No visible error text for recoverable failures.
- **Code quality** — pure functions where possible, JSDoc on all functions, meaningful variable names, error handling on all async operations.

---

## Senior code review — v4.86 → v4.92 (March 2026)

A full audit was completed at v4.86. The items below are ordered by priority. Items marked ✅ were fixed in v4.92.

### Fixed in v4.92

| # | Severity | What was fixed |
|---|----------|----------------|
| 2/25 | 🟠 High | **Service worker offline fallback was broken.** `caches.match() \|\| caches.match()` joined two Promises (always truthy), so the index.html fallback never triggered. Fixed to `.then(r => r \|\| ...)`. |
| 26 | 🟠 High | **Cache name was independent of app version.** Cache is now `myb-roster-v{APP_VERSION}` so any version bump automatically invalidates old caches across all clients. |
| 27 | 🟠 High | **`cache.addAll()` on all assets — a missing icon blocked SW install.** Icons are now cached individually in try/catch so a transient network error on one icon does not prevent the service worker from activating. |
| 20 | 🟢 Low | **`"./"` and `"./index.html"` were both in ASSETS_TO_CACHE** — same resource cached twice. Removed `"./"`. |
| 5 | 🟢 Low | **CSS `dvh`/`vh` fallback order was wrong** — `100dvh` came first then `100vh` overwrote it in all browsers. Swapped to `100vh` first, `100dvh` second (modern browsers use the last valid value). Fixed in both HTML files. |
| 1 | 🟠 High | **`#alConfirmBar` HTML was after `</script>` outside the normal document flow.** Moved inside `<body>` alongside other UI elements where it is guaranteed to render correctly. |
| 3 | 🟡 Med | **Payday loop had no guard.** If `FIRST_PAYDAY` were ever misconfigured, the while loop could iterate thousands of times. Added a 1000-iteration guard with a `console.warn`. |
| 6 | 🟢 Low | **`calculateBankHolidays()` had no year-range guard.** Now returns `[]` and logs a warning for years outside `CONFIG.MIN_YEAR`–`CONFIG.MAX_YEAR`. |
| 4 | 🟡 Med | **`getSurname()` lacked documentation.** Added JSDoc explaining exactly which characters are stripped and warning that changing this function locks out all staff. |
| 21 | 🟡 Med | **`select:focus { outline: none }` removed focus ring for keyboard/AT users.** Removed the `:focus` suppression rule; the styled ring is now applied only on `:focus-visible`. Fixed in both HTML files. |
| 29 | 🟢 Low | **`manifest.json` was missing `id` field.** Added `"id": "/"`. Without it, if the URL ever changes, installed PWAs lose their home-screen icon. |
| 33 | 🟡 Med | **Roster pattern strings had no validation.** Added `validateRosterPatterns()` and `warnIfCulturalCalendarMissingYear()` in `roster-data.js`; both run automatically at module load and log errors/warnings to the console. |
| 10 | 🟡 Med | **Version number required manual updates in 7 places** — a known source of drift. `APP_VERSION` is now exported from `roster-data.js` and read by both HTML files via `CONFIG.APP_VERSION`. The remaining manual step is updating the import `?v=` cache-busting strings. |
| 15 | 🟠 High | **innerHTML + Firestore data audit.** Reviewed all `innerHTML` assignments. The override list table (admin.html ~3296) correctly passes all Firestore values through `esc()`. The `alPreview.innerHTML` correctly uses `esc(member)`. All other `innerHTML` assignments use only app-computed values. **No changes required — audit passed.** |
| 30 | 🟢 Low | **No PWA shortcuts defined in manifest.** Added `shortcuts` array with "My Roster" (index.html) and "Admin" (admin.html) entries, each with a 192×192 icon. |
| 24 | 🟢 Low | **Print output lacked member name, date, and print timestamp.** index.html uses `beforeprint` to set `data-print-date` on `.header`; admin.html populates a `#printHeader` div with member name, week label, and timestamp. |
| 19 | 🟢 Low | **Override list re-queried Firestore after every edit.** After saving or deleting, `allOverrides` is now updated in-memory (filter removed IDs, push new docs, re-sort) and `renderTable()` is called directly — no round-trip. |
| 18 | 🟡 Med | **`getShiftTypesInMonth()` recalculated all days on every swipe.** Result is now memoised in a Map keyed by `"memberName\|year\|month"`, cleared on override change. |
| 22 | 🟡 Med | **Splash screen used a fixed 1.5s delay.** Now dismissed when `renderCalendar()` completes, with a 300ms minimum to ensure the calendar is painted before the fade. |
| 35 | 🟢 Low | **No linter or formatter.** Added `.eslintrc.json` (`eslint:recommended`) and `.prettierrc` to the repo root. |
| 28 | 🟡 Med | **admin.html auto-reloaded immediately on `controllerchange`.** Added SW registration to admin.html with an `#updateToast` banner (top of screen, navy + gold "Refresh now" button). Toast appears when a new SW is waiting; pressing the button sends `SKIP_WAITING` then reloads — user controls when to refresh. |
| 8 | 🟠 High | **~1,500 lines of CSS duplicated** between index.html and admin.html. Extracted shared CSS to `shared.css` (242 lines); both HTML files now link to it. |
| 34 | 🟡 Med | **No automated tests.** Added `roster-data.test.mjs` (158 lines) using Node's built-in `node:test` runner — covers bank holidays, Easter, paydays, cutoffs, AL entitlement, and roster validation. Run with `node --test roster-data.test.mjs`. |
| 23 | 🟢 Low | **Legend was very long on mobile.** Responsive CSS collapses the three legend rows into a single centred strip at narrow viewports. |

### Remaining items — not yet fixed

These were identified in the audit but not addressed. Tackle in future sessions:

#### 🔴 Critical
- **#13 — Firestore Security Rules missing.** The Firebase credentials are public (expected), but without Firestore rules anyone can read/write the entire database from a browser console. Log in to the Firebase Console → Firestore → Rules and restrict access. Also consider Firebase App Check and restricting the API key in Google Cloud Console.

#### 🟠 High
- **#7 — Core roster logic duplicated across both HTML files.** `getWeekNumberForDate` / `getWeekNum`, `getRosterForMember` / `getRosterData`, `shiftBadge` / `getShiftBadge`, etc. exist in both files with diverging implementations. Plan: move all shared logic into `roster-data.js` and export it.
- **#14 — Authentication is client-side only.** Anyone who opens DevTools can impersonate any staff member by writing to localStorage. Plan: migrate to Firebase Authentication (email/password). Free at this scale, gives server-verified tokens.
- **#31 — Two 4,000-line monolithic HTML files.** Plan: extract to `app.js`, `admin-app.js` (shared.css already done). JS is still embedded in HTML — cannot be linted, tested, or cached independently.

#### 🟡 Medium
- **#9/#32 — Cultural calendar dates are 400+ lines of hardcoded strings** that must be updated manually each year. `warnIfCulturalCalendarMissingYear()` will warn if a year is missing. Long-term: store in Firestore or a JSON file.
- **#11 — `ADMIN_NAME` is hardcoded** in `admin.html` (line 2040). Plan: move to `CONFIG.ADMIN_NAMES` as an array, or a Firestore `admins` collection.
- **#16 — JavaScript is embedded in HTML files** — cannot be linted, tested, or cached independently. Plan: same as #31 above.

---
