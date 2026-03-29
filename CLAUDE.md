# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Current app version | `5.66` (check `roster-data.js` — `APP_VERSION` is the authoritative source) |
| Hosted URL | Deployed to Firebase Hosting via GitHub Actions on push to `main` |
| Cloud Function URL | `https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle` |
| Development branch convention | `claude/<description>-<sessionId>` — always push to this branch, never directly to `main` |

**GitHub Actions secrets required** (Settings → Secrets and variables → Actions):

| Secret name | What it is |
|-------------|-----------|
| `FIREBASE_SERVICE_ACCOUNT` | Full JSON of a Firebase service account key with Functions deploy permissions |
| `HUDDLE_SECRET` | The Bearer token that Power Automate sends to authenticate with `ingestHuddle` — must also be set in Firebase Secret Manager: `firebase functions:secrets:set HUDDLE_SECRET` |

**GitHub Actions workflows:**
- `.github/workflows/deploy-functions.yml` — triggers on push to `main` when any file under `functions/` changes, or manually via `workflow_dispatch`. Deploys Cloud Functions only (not the PWA). Exit code from Firebase CLI is treated as success if the only error text is "cleanup policy" (a benign GCP Artifact Registry warning).

---

## Version bumping (MANDATORY on every change)

**As of v5.49:** JS is now in separate files. You need to update **thirteen** places:

| File | Location | Example |
|------|----------|---------|
| `roster-data.js` | `export const APP_VERSION = '...'` | `APP_VERSION = '4.95'` ← **primary source** |
| `service-worker.js` | Line 1 comment | `// MYB Roster — Service Worker v4.95` |
| `service-worker.js` | `const APP_VERSION = '...'` | `APP_VERSION = '4.95'` ← must match |
| `index.html` | Line 2 HTML comment | `<!-- MYB Roster Calendar - Version 4.95 -->` |
| `index.html` | `<script src="./app.js?v=...">` | `app.js?v=4.95` |
| `admin.html` | Line 2 HTML comment | `<!-- MYB Roster Admin v4.95 -->` |
| `admin.html` | `<script src="./admin-app.js?v=...">` | `admin-app.js?v=4.95` |
| `app.js` | `import ... from './roster-data.js?v=...'` | `roster-data.js?v=4.95` |
| `app.js` | `import ... from './firebase-client.js?v=...'` | `firebase-client.js?v=4.95` |
| `admin-app.js` | `import ... from './roster-data.js?v=...'` | `roster-data.js?v=4.95` |
| `admin-app.js` | `import ... from './firebase-client.js?v=...'` | `firebase-client.js?v=4.95` |
| `index.html` | `<link rel="stylesheet" href="./shared.css?v=...">` | `shared.css?v=4.95` |
| `admin.html` | `<link rel="stylesheet" href="./shared.css?v=...">` | `shared.css?v=4.95` |

`CONFIG.APP_VERSION` and `ADMIN_VERSION` read from `CONFIG.APP_VERSION` which is set inside `roster-data.js` — no manual update needed for those.

- Increment the patch number for every commit that touches app behaviour
- The `?v=` cache-busting strings **must** be updated manually (browsers use them to bust the module cache)
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
├── index.html          ← main PWA app (HTML + CSS only)
├── admin.html          ← staff self-service and admin portal (HTML + CSS only)
├── app.js              ← all JavaScript for index.html
├── admin-app.js        ← all JavaScript for admin.html
├── roster-data.js      ← shared module: APP_VERSION, CONFIG, teamMembers, all roster data, utility functions
├── firebase-client.js  ← shared module: Firebase init (one place), exports db + all Firestore functions
├── shared.css          ← CSS shared between index.html and admin.html
├── service-worker.js   ← cache name includes app version, e.g. myb-roster-v4.95
├── manifest.json       ← PWA manifest
├── icon-*.png          ← 6 sizes: 120, 152, 167, 180, 192, 512
└── functions/
    ├── index.js        ← Firebase Cloud Functions (ingestHuddle endpoint)
    └── package.json    ← Node 20, firebase-admin + firebase-functions only
```

**Service worker caching strategy:**
- Network-first: `index.html`, `admin.html`, `app.js`, `admin-app.js`, `roster-data.js`, `firebase-client.js`, `shared.css` — must always be fresh
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

## Payday calculator — planned feature

Work on a payday calculator UI is in progress externally and will be integrated when ready. **Do not rebuild the data layer — it already exists.**

| What exists | Location |
|-------------|----------|
| `getPaydaysAndCutoffs(year)` | `roster-data.js` — returns `{ paydays[], cutoffs[] }` for any year |
| `isPayday(date)` / `isCutoffDate(date)` | `roster-data.js` — boolean helpers |
| `FIRST_PAYDAY`, `PAYDAY_INTERVAL_DAYS` | `CONFIG` in `roster-data.js` |
| 💷 / ✂️ calendar markers | `app.js` — `.payday` and `.cutoff` CSS classes applied per cell |
| Tests | `roster-data.test.mjs` — payday and cutoff tests already passing |

**When integrating the calculator UI:**
- Follow the existing file pattern: `paycalc.html` (HTML+CSS only) + `paycalc.js` (JS only)
- Import shared functions from `roster-data.js` and `firebase-client.js` — do not duplicate
- Add both new files to the service worker `ASSETS_TO_CACHE` and network-first list
- The version bump table will need two new rows (`paycalc.html` and `paycalc.js`)
- See ROADMAP.md for full context

---

## Shift types

| Value | Badge | Meaning |
|-------|-------|---------|
| `'RD'` | 🏠 Rest | Rest day |
| `'OFF'` | 🏠 Rest | Off day — bilingual roster only, treated identically to RD |
| `'SPARE'` | 📋 Spare | On standby, shift not yet assigned |
| `'RDW'` | 💼 RDW | Rest day worked — overtime |
| `'AL'` | 🏖️ AL | Annual leave |
| `'SICK'` | 🤒 Sick | Sick day — recorded via override, shown in calendar and summary |
| `'HH:MM-HH:MM'` | ☀️ / 🌙 / 🌃 | Worked shift |

**Shift classification:**
- Early: 04:00–10:59 (`EARLY_START_THRESHOLD = 4`, `EARLY_SHIFT_THRESHOLD = 11`)
- Late: 11:00–20:59
- Night: 21:00–03:59 (`NIGHT_START_THRESHOLD = 21`)

**isWorkedDay:** Returns false for RD, OFF, SPARE, AL, SICK. True for everything else including RDW.

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
                        "annual_leave" | "correction" | "sick"
value        string     "HH:MM-HH:MM" for spare_shift/overtime/rdw/swap;
                        "AL" for annual_leave; "RD" for correction; "SICK" for sick
note         string     Free text — use "" if none. Field must always be present.
createdAt    timestamp  Firestore server timestamp
```

**memberSettings** — per-member preferences

```
memberName   string     Must match teamMembers[n].name exactly
faithCalendar string    'islamic' | 'hindu' | 'chinese' | 'jamaican' |
                        'congolese' | 'portuguese' | 'none'
                        Controls which cultural calendar badges appear in
                        the user's calendar view.
```

Override cache key format: `"memberName|YYYY-MM-DD"` (pipe separator)

### Authentication

Staff log in to admin.html with their name (dropdown) and surname as password (lowercase, no spaces or special characters). Example: `'G. Miller'` → `miller`. Sessions persist for 30 days via localStorage.

`CONFIG.ADMIN_NAMES = ['G. Miller']` — an array in `roster-data.js`. Members in this array have elevated admin access. To add another admin, add their name to the array (must match `teamMembers[n].name` exactly).

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
| 7 | 🟠 High | **Core roster logic duplicated across both HTML files.** `getWeekNumberForDate`, `getRosterForMember`, `getShiftBadge`, etc. moved to `roster-data.js` and exported. Both HTML files import them. admin.html retains a one-liner `shiftBadge()` alias with a different default separator — not a duplicate. |
| 34 | 🟡 Med | **No automated tests.** Added `roster-data.test.mjs` (158 lines) using Node's built-in `node:test` runner — covers bank holidays, Easter, paydays, cutoffs, AL entitlement, and roster validation. Run with `node --test roster-data.test.mjs`. |
| 23 | 🟢 Low | **Legend was very long on mobile.** Responsive CSS collapses the three legend rows into a single centred strip at narrow viewports. |
| 31/16 | 🟠 High | **Two 4,000-line monolithic HTML files; JS embedded in HTML.** Extracted all JavaScript from `index.html` into `app.js` (1,693 lines) and from `admin.html` into `admin-app.js` (1,983 lines). Both HTML files now contain only HTML and CSS. JS can now be linted, cached independently, and navigated separately. |
| 9/32 | 🟡 Med | **Cultural calendar dates were 400+ lines of hardcoded strings.** Added three private helpers (`fixedAnnualDate`, `easterOffset`, `nthWeekdayOfMonth`) in `roster-data.js`. 18 of 33 datasets (all fixed-date, Easter-relative, and day-of-week-rule holidays) are now auto-computed for the full CONFIG year range — no manual updates ever needed. 15 genuinely lunar/lunisolar datasets (Islamic ×5, Hindu ×5, Chinese ×5) remain as lookup tables and still need annual updates. `warnIfCulturalCalendarMissingYear()` now checks all 15 of these. |

| v5.00 | 🟡 Med | **SW offline fallback served index.html for admin requests.** The catch branch fell back to `caches.match("./index.html")` regardless of which page was requested. Fixed to detect `admin` in the path and fall back to `./admin.html` instead. |
| v5.00 | 🟢 Low | **`shared.css?v=` was missing from the version bump checklist.** Both HTML files were stuck on `?v=4.93` while the app moved through several releases. Added `shared.css` to the mandatory version bump table and corrected both references to v5.00. |
| v5.00 | 🟢 Low | **app.js defined `dayNames` and `dayKeys` locally when identical constants were already imported from `roster-data.js`.** Removed local declarations; all call sites updated to use `DAY_NAMES` and `DAY_KEYS`. `fullDayNames` and `monthNames` retained as they have no equivalent in the shared module. |
| v5.00 | 🟢 Low | **Test suite expanded from 23 to 51 tests.** Added coverage for `isChristmasRD`, `isEarlyShift`, `isNightShift`, `getShiftClass`, `getShiftBadge`, `isSameDay`, `getRosterForMember`, `getWeekNumberForDate`, `getBaseShift`, and AL entitlement edge cases. |
| v5.15 | 🟢 Low | **"Book/Booked Annual Leave" label was verbose.** Renamed to "Record Annual Leave" in both the type pill and the confirm button for consistency and brevity. |
| v5.16 | 🟢 Low | **Date inputs in the sick/AL date row overflowed their container on narrow viewports.** Added `min-width: 0` and `width: 100%` to `.date-input` so inputs shrink correctly inside the flex row. |
| v5.17 | 🟢 Low | **Bulk type pills left-aligned when wrapping to a second row.** Added `justify-content: center` to `.bulk-type-group` so the second row (Swap, Sick, Rest Day) is centred rather than left-orphaned on mobile. |
| v5.00 | 🟡 Med | **#11 — `ADMIN_NAME` was hardcoded** in `admin-app.js`. Moved to `CONFIG.ADMIN_NAMES` as an array in `roster-data.js`. Admin check now uses `CONFIG.ADMIN_NAMES.includes(currentUser)`. |

### Remaining items — not yet fixed

These were identified in the audit but not addressed. Tackle in future sessions:

#### 🟠 High
- **#14 — Authentication is client-side only.** Anyone who opens DevTools can impersonate any staff member by writing to localStorage. Plan: migrate to Firebase Authentication (email/password). Free at this scale, gives server-verified tokens.

### Fixed after v5.19

| Version | Severity | What was fixed |
|---------|----------|----------------|
| v5.18 | 🟢 Low | **Colour audit — RDW, late, spare, rest day.** RDW changed from magenta to amber (distinct from sick's red family). Late badge darkened (#2196f3 → #1565c0, contrast 3.7:1 → 8.5:1). Spare badge darkened (#9c27b0 → #7b1fa2, contrast 3.5:1 → 8.3:1). Rest day background changed from pure white to #f9f9fb so cells don't vanish on the page. |
| v5.19 | 🟠 High | **RDW text contrast failures in admin.** Amber text on white pill (1.4:1) and amber text on pale amber lpill (1.4:1) both failed WCAG AA. Added --rdw-text: #8b6000 (dark amber, 5.5:1 on white) for all text-on-light contexts. |
| #13 | 🔴 Critical | **Firestore Security Rules deployed.** Rules now: allow reads on both collections; allow writes only if all required fields are present and `type`/`faithCalendar` values are within the valid set. Junk/missing-field writes return 403. Verified by live REST API tests (read ✅, invalid write blocked ✅, valid write allowed ✅). |
| v5.22 | 🟢 Low | **RDW colour reverted to magenta** (`#c2185b`) while colour scheme is reconsidered. Amber was too close to early-shift orange. RDW badge text changed from dark (`--text-dark`) to white (7.9:1 contrast on magenta). `--rdw-light` set to `#fce4ec`, `--rdw-text` to `#880e4f`. |
| v5.23 | 🟢 Low | **Per-row type pills centred** in the week grid to match the bulk-bar pills (added `justify-content: center` to `.col-pills`). |
| v5.23 | 🟢 Low | **Button label casing made consistent** — "Save Changes", "Record Annual Leave", "Record Sick Days" changed to sentence case to match the rest of the UI. |
| v5.23 | 🟠 High | **`fetchedMonths` no longer permanently poisoned on Firestore error.** Month key deleted from Set in catch block so it retries on next navigation. |
| v5.23 | 🟢 Low | **AL/sick booked boxes now show all years** instead of filtering to the year inferred from input fields, which could silently hide records from other years. |
| v5.23 | 🟡 Med | **Service worker network-first fetch bypasses browser HTTP cache** (`{ cache: 'no-store' }`) so a stale HTTP-cached file can no longer defeat the network-first strategy. |
| v5.23 | 🟡 Med | **Service worker network-first fetch times out after 5 s** on slow/hanging connections and falls back to the cached copy, preventing indefinite loading on weak signal. |
| v5.23 | 🟢 Low | **Deep-link card scroll** switched from `setTimeout(300)` to double `requestAnimationFrame` for reliable timing on slow devices. |
| v5.23 | 🟢 Low | **SW update poll interval** cleared on `visibilitychange: hidden` to avoid unnecessary background network traffic on mobile. |
| v5.48 | 🟢 Low | **Month/year filter added to Saved Changes.** Dropdown in the list toolbar lets admin filter overrides by month. Options rebuild automatically from available data when member selection changes. |
| v5.48 | 🟢 Low | **Per-row note buttons replaced with a shared note field.** The `+ Note` button on each day row (and its expanding note-row, extra grid column, and associated CSS) was removed. A single `Note (optional)` input now sits between the week grid and the Save button — applies to all days in the batch. Pre-populates when editing an existing override that has a note. Clears on save. |
| v5.49 | 🟢 Low | **Stale note field on week navigation fixed.** Typing a note then swiping or navigating to a different week without saving left the old note text in the field, where it would silently attach to the next save. `renderWeekGrid()` and the swipe commit path now both clear the field before loading a new week. |

---

## Huddle ingest — automated briefing upload

### What it does

The daily Huddle briefing arrives as an email with a PDF or DOCX attachment. A Power Automate flow detects it, extracts the file, and calls a Firebase Cloud Function (`ingestHuddle`) which stores the file in Firebase Storage and writes a metadata record to Firestore. This mirrors what admin staff would otherwise do manually through admin.html.

### Files

| File | Purpose |
|------|---------|
| `functions/index.js` | Cloud Function — receives file, validates, uploads to Storage, writes Firestore doc |
| `functions/package.json` | Node 20; only `firebase-admin` and `firebase-functions` as dependencies |

### Firebase Storage

Files are stored at: `huddles/YYYY-MM-DD.pdf` or `huddles/YYYY-MM-DD.docx`

Each file is uploaded with a custom `firebaseStorageDownloadTokens` metadata field so a stable direct download URL is available immediately after upload.

Download URL format:
```
https://firebasestorage.googleapis.com/v0/b/{bucket}/o/huddles%2FYYYY-MM-DD.pdf?alt=media&token={uuid}
```

### Firestore — `huddles` collection

Document ID = `YYYY-MM-DD` (the London date of the huddle).

```
date        string     "YYYY-MM-DD"
storageUrl  string     Full Firebase Storage download URL (with token)
fileType    string     "pdf" | "docx"
uploadedAt  timestamp  Firestore server timestamp
uploadedBy  string     "power-automate" (hardcoded — identifies automated uploads)
```

### Cloud Function — `ingestHuddle`

- **Region:** `europe-west2` (London)
- **Auth:** `Authorization: Bearer <HUDDLE_SECRET>` — secret stored in Firebase Secret Manager, accessed via `defineSecret('HUDDLE_SECRET')`
- **Method:** POST only

**Request format** (this is critical — do not change without updating the Power Automate flow):

```
Headers:
  Authorization:      Bearer <secret>
  Content-Type:       text/plain
  X-Huddle-Date:      YYYY-MM-DD
  X-Huddle-Filename:  original-name.pdf   (or .docx)

Body:
  Raw base64-encoded file content — plain text, no JSON wrapper
```

**Why plain-text body instead of JSON?**
Power Automate's `@{body('...')?['contentBytes']}` template substitution in a JSON body has a practical size limit and silently truncates large base64 strings (a 190 KB PDF produces a ~256,000-char base64 string). Putting the file in the raw body as `text/plain` bypasses this entirely. Metadata goes in custom headers instead.

**Body reading:** The function reads `req.rawBody` first (Firebase Functions runtime provides this); falls back to streaming the request if rawBody is unavailable. Never use an Express body-parser — it consumes the stream before the function can read it.

**File type detection:** Based on the `X-Huddle-Filename` header extension (`.docx` → DOCX; anything else → PDF). Never rely on `Content-Type` from Power Automate as it sends `text/plain` for both.

**Deploying the function:**

Gareth's GitHub repo is **online-only** — he does not have a local clone. All deploys happen via GitHub Actions. To trigger a deploy of the Cloud Function, commit a change to any file under `functions/` and push to `main`. The workflow (`.github/workflows/deploy-functions.yml`) runs automatically.

If the workflow shows "Skipped (No changes detected)" it means Firebase compared the deployed function hash with the local build and found no difference — this is normal and means the function is already up to date.

For first-time secret setup (must be done once from a machine with `firebase-tools` installed, or via the Firebase Console):
```bash
firebase login
firebase use myb-roster
firebase functions:secrets:set HUDDLE_SECRET   # paste a strong random UUID when prompted
cd functions && npm install
```

The `HUDDLE_SECRET` must exist in **two places**:
1. Firebase Secret Manager (so the Cloud Function can read it at runtime)
2. GitHub Actions secrets (not directly used by the function, but useful to have the same value documented)

**Generating a secret:**
```
node -e "console.log(require('crypto').randomUUID())"
```

**Finding secrets in Firebase Console:**
In Firebase Console, go to the project → Build → Functions → then look for "Secret Manager" in the left nav (it may be under Google Cloud Console → Security → Secret Manager for project `myb-roster`). The secret is named `HUDDLE_SECRET`.

### Power Automate flow — "huddle ingest"

The flow is built in Power Automate (Microsoft 365). Gareth's organisation provides access. The HTTP connector used is the **HTTP** (Premium) connector — not "Send an HTTP request (Office 365)".

**Trigger:** "When a new email arrives (V3)" on the Huddle mailbox, filtered to emails with attachments.

**Overall structure:**

```
Trigger: new email with attachment
│
├── Compose: London_time
│   convertTimeZone(triggerOutputs()?['body/receivedDateTime'],
│                   'UTC', 'GMT Standard Time', 'yyyy-MM-dd')
│
├── Set variable: huddleDate  ← outputs('London_time')
│
└── Condition: is it after noon? (to avoid duplicate early-morning emails)
    │
    ├── YES branch (afternoon/main email):
    │   ├── Filter array: filter_array_1
    │   │   From: triggerOutputs()?['body/attachments']
    │   │   Condition: item()?['contentType']  is equal to  application/pdf
    │   │             (LEFT = expression tab; RIGHT = value tab)
    │   │
    │   ├── Compose: attachment
    │   │   body('filter_array_1')[0]?['contentBytes']
    │   │
    │   ├── Compose: debug_content   ← REMOVE THIS once everything works
    │   │   length(outputs('attachment'))
    │   │
    │   └── HTTP action (Premium)
    │       Method: POST
    │       URI: https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle
    │         (URI goes in value tab, NOT expression tab)
    │       Headers:
    │         Authorization  →  Bearer <paste secret here>  (value tab)
    │         Content-Type   →  text/plain                  (value tab)
    │         X-Huddle-Date  →  @{variables('huddleDate')}  (value tab, @{} syntax)
    │         X-Huddle-Filename → @{body('filter_array_1')[0]?['name']}  (value tab)
    │       Body: @{outputs('attachment')}  (value tab, @{} syntax — NOT expression tab)
    │
    └── NO branch (morning/DOCX email):
        ├── Filter array: filter_array_2
        │   From: triggerOutputs()?['body/attachments']
        │   Condition: item()?['contentType']  is equal to
        │     application/vnd.openxmlformats-officedocument.wordprocessingml.document
        │             (LEFT = expression tab; RIGHT = value tab)
        │
        ├── Compose: attachment
        │   body('filter_array_2')[0]?['contentBytes']
        │
        └── HTTP action (Premium)
            (same structure as YES branch but references filter_array_2 and filter_array_2's name)
```

### Critical Power Automate gotchas — read carefully

**1. Expression tab vs value tab**
Power Automate input fields have two modes: "Expression" (for dynamic functions/variables) and "Value" (for static text). Getting this wrong silently breaks the flow:

| What you're entering | Which tab |
|---------------------|-----------|
| `item()?['contentType']` — left side of filter condition | Expression |
| `application/pdf` — right side of filter condition | Value |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` — right side of DOCX filter | Value |
| `body('filter_array_1')[0]?['contentBytes']` — Compose source | Expression |
| The Cloud Function URL | Value |
| `Bearer <secret>` — Authorization header value | Value |
| `text/plain` — Content-Type header value | Value |
| `@{variables('huddleDate')}` — X-Huddle-Date header value | Value (the @{} syntax works in value tab) |
| `@{body('filter_array_1')[0]?['name']}` — X-Huddle-Filename | Value |
| `@{outputs('attachment')}` — HTTP body | Value |

**2. Filter array returning empty — the most common failure**
If `body('filter_array_1')[0]` or `body('filter_array_2')[0]` throws "array index 0 cannot be selected from empty array", the filter returned nothing. Check:
- Left side of condition is on the **expression** tab (if on value tab it compares literal string `"item()?['contentType']"` which never matches)
- Right side MIME type has no typos — the DOCX one is 71 characters and easy to mistype
- "From" field references `triggerOutputs()?['body/attachments']` directly — not a previous filter's output

**3. London timezone**
The Compose action that calculates the huddle date must be named `London_time` (underscore, not space). Power Automate action names with spaces are accessible via expressions but cause `InvalidTemplate` errors in some contexts. Always use underscores in action names.

Expression used:
```
convertTimeZone(triggerOutputs()?['body/receivedDateTime'], 'UTC', 'GMT Standard Time', 'yyyy-MM-dd')
```
Note: `'GMT Standard Time'` has spaces — `'GMTStandardTime'` (no spaces) is invalid.

**4. `@{}` syntax in value tab**
To reference a dynamic value in a header or body field while on the **value tab**, use `@{expression}` syntax — for example `@{variables('huddleDate')}`. Do not switch to expression tab for this; the @{} wrapper is how Power Automate interpolates expressions inside value-tab strings.

**5. HTTP action references**
The HTTP action body cannot reference a Compose action by name inside the action's own "inputs" scope. Always use a separate Compose action to prepare the value first, then reference it as `@{outputs('attachment')}` in the HTTP body.

### Power Automate flow — condition logic

The flow sends Huddle emails to the correct branch based on when they arrive:
- **Yes branch (after noon):** Assumed to be the main/final PDF version. Filters for `application/pdf`.
- **No branch (before noon):** Assumed to be the morning DOCX draft. Filters for the full DOCX MIME type.

The condition expression checks the received time in London timezone:
```
greater(int(formatDateTime(outputs('London_time'), 'HH')), 12)
```

### Firestore Security Rules — `huddles` collection

The `huddles` collection is written only by the Cloud Function (server-side, authenticated via service account — bypasses Security Rules). The Security Rules for client-side reads should be:

```
match /huddles/{docId} {
  allow read: if true;   // all authenticated staff can read huddle links
  allow write: if false; // writes only via Cloud Function (server-side)
}
```

If `allow write: if false` blocks the Cloud Function, that is a misconfiguration — the Admin SDK bypasses Security Rules entirely. Client-side writes (from the browser) are correctly blocked.

### Current status (as of v5.66)

- ✅ Cloud Function deployed and live at `https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle`
- ✅ PDF upload via Power Automate Yes branch — working end to end
- ✅ DOCX upload via Power Automate No branch — working end to end
  - Root cause of previous failure: both sides of the `Filter_array_2` condition had been entered as values instead of the left side (expression) / right side (value) pattern. Once corrected, the branch worked.
- ⏳ `debug_content` Compose action in the Yes branch (outputs `length(outputs('attachment'))` to confirm base64 length) — safe to remove once both branches are confirmed stable over several days
- ⏳ Huddle viewer UI in admin.html — not yet built. Firestore `huddles` collection is populated and ready; UI needs to query it and display a download link per date

### Next steps for huddle viewer UI

When building the viewer in admin.html:
- Query the `huddles` Firestore collection, order by `date` descending
- Display date, file type badge, and a download link using `storageUrl`
- The `storageUrl` already contains the access token — open directly in a new tab
- Admin-only section (check `CONFIG.ADMIN_NAMES.includes(currentUser)`)
- Follow the existing file pattern — JS stays in `admin-app.js`, HTML/CSS in `admin.html`

---

## Annual maintenance reminder — cultural calendar data

**15 lunar/lunisolar calendar datasets need updating each year** (typically in November/December before the new year begins):

| Calendar | Datasets to update |
|----------|--------------------|
| Islamic  | Ramadan, Eid al-Fitr, Eid al-Adha, Islamic New Year, Mawlid |
| Hindu    | Holi, Navratri, Dussehra, Diwali, Raksha Bandhan |
| Chinese  | New Year, Lantern Festival, Qingming, Dragon Boat, Mid-Autumn |

Jamaican, Congolese, and Portuguese calendars are **rule-based** (fixed-date or Easter-relative) and auto-compute — no annual update needed.

**Sources:** islamicfinder.org · drikpanchang.com (London timezone) · chinesenewyear.net

`warnIfCulturalCalendarMissingYear()` in `roster-data.js` logs a console warning automatically if any of these datasets are missing data for the current year.

---
