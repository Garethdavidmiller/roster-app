# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Current app version | `10.30` (check `roster-data.js` — `APP_VERSION` is the authoritative source) |
| Hosted URL | Deployed to Firebase Hosting via GitHub Actions on push to `main` |
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

**Workflows:** `deploy-functions.yml` (functions only) · `deploy-hosting.yml` (PWA only, added v8.14)

---

## Version bumping (MANDATORY on every change)

**6 places, every commit that touches behaviour:**

| File | Location |
|------|----------|
| `roster-data.js` | `export const APP_VERSION = '...'` — **primary source** |
| `service-worker.js` | Line 1 comment |
| `service-worker.js` | `const APP_VERSION = '...'` |
| `index.html` | Line 2 HTML comment |
| `admin.html` | Line 2 HTML comment |
| `paycalc.html` | Line 2 HTML comment |

`?v=` cache-busting strings were removed at v9.94 — do not add them back. Cache freshness is handled by `Cache-Control: no-cache` in `firebase.json`.

**Documentation update policy:** Update every **0.10 version** (e.g. 10.10 → 10.20), or immediately on: new pay grade, auth/Firestore model change, SW strategy change, new page or module, data model change.

**Same-commit rule:** Any commit that adds, removes, or renames a JS module must also update `CLAUDE.md` and `AI_MAP.md` in the same commit. The pre-commit hook (`githooks/pre-commit`) enforces this.

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
├── admin.html              ← staff self-service and admin portal (HTML + CSS only)
├── paycalc.html            ← pay calculator (HTML + CSS only)
├── app.js                  ← all JavaScript for index.html (calendar, overrides cache, swipe, notifications)
├── app-team-view.js        ← Team Week View: state, grid render, Firestore fetch, toggle, chrome. Imported by app.js
├── app-override-utils.js   ← override priority and member-start helpers: tsToMillis, shouldReplaceOverride, isBeforeMemberStart. Shared by app.js and app-team-view.js
├── admin-app.js            ← coordinator for admin.html: login, cultural calendar, module wiring, booked-box helpers
├── admin-huddle.js         ← Huddle upload card, push notifications, Huddle card toggle (extracted v9.54)
├── admin-auth.js           ← Staff Firebase Auth account setup card (extracted v9.54)
├── admin-al.js             ← Annual Leave Booking section. Exports initALSection(deps) and triggerConfirmedALSave()
├── admin-sick.js           ← Sick Days Recording section. Exports initSickSection(deps)
├── admin-overrides.js      ← Change a Shift module: week grid, bulk bar, override list, save logic, utilities
├── admin-roster-upload.js  ← Weekly Roster Upload pipeline: computeCellStates, renderReviewTable, shiftDisplay
├── paycalc.js              ← all JavaScript for paycalc.html (UI, DOM, period logic)
├── paycalc-calc.js         ← pure pay math module (no DOM/Firebase): tax, NI, SL, gross, thresholds
├── paycalc-roster-suggestions.js ← roster pre-fill engine: getRosterSuggestion(p, member), fetchOverridesForPeriod
├── roster-data.js          ← shared module: APP_VERSION, CONFIG, teamMembers, all roster data, utility functions
├── roster-cycle-data.js    ← raw roster cycle arrays — imported by roster-data.js only
├── firebase-client.js      ← shared module: Firebase init, exports db + all Firestore functions
├── ls.js                   ← shared localStorage wrappers: lsGet, lsSet, lsDel — iOS Safari safe
├── shared.css              ← CSS shared by all three pages
├── service-worker.js       ← single SW for all pages; cache name includes app version
├── manifest.json           ← PWA manifest for all pages
├── paycalc-guide.html      ← printable pay calculator reference guide
├── fip.html                ← FIP European travel guide for staff
├── guide.html              ← printable staff + admin quick guide
├── railcard-guide.html     ← UK Railcard at-work reference sheet (admin-only for now); linked from admin.html
├── icon-*.png              ← 6 sizes: 120, 152, 167, 180, 192, 512
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
└── functions/
    ├── index.js                  ← Cloud Functions: ingestHuddle, parseRosterPDF, setupRosterAuth
    ├── roster-parse-helpers.js   ← Pure helpers: normaliseShift, buildWeekDates, extractAIJson, etc.
    └── package.json
```

**Run all tests:**
```
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
| Pointer Events API for swipe | Handles touch, mouse, and trackpad in one handler. Do not revert to Touch Events. |
| `aria-live` for month announcements | Programmatic `.focus()` on the month heading caused mobile layout reflow. Do not switch. |
| `Math.ceil()` on carousel panel width | Eliminates sub-pixel seam on high-DPI screens. Do not remove. |
| CSS variables for all colours | Defined in `:root`. Never hardcode hex anywhere in CSS or JS. |
| Semantic elements (`<nav>`, `<header>`, `<main>`) | Screen readers depend on these landmarks. Do not revert to `<div>`. |
| Network-first SW for app files | Ensures staff always receive roster updates on next open. |
| `isChristmasRD()` applied before Firestore overrides | Forces Dec 25 and Dec 26 to RD first; Firestore can then override Dec 26 to RDW for overtime. Never reorder this. |
| `getBaseShift(member, date)` for all base shift lookups | Direct access to `roster.data[week][day]` bypasses `startDate` suppression, Christmas rules, and future base-shift logic. Always call `getBaseShift()`, never read `roster.data` directly. |
| Two separate type pill lists in admin | Per-row pills in `renderWeekGrid()` (`admin-overrides.js`) and bulk bar pills in `admin.html` (~line 2215) must stay in sync. Current order: AL · Spare · Shift · Swap · RDW · Absence · Rest Day |
| **`AL` pill label must stay as `AL`** | Compact mobile layout requires short labels. `AL` is the standard Chiltern abbreviation. Do not expand without discussing layout impact. |
| **`🪑` is the absence emoji — do not change** | Absence covers sickness, childcare, bereavement, and other reasons. Using 🤒 implies illness — GDPR concern. The reason for absence is never stored. **Always ask Gareth before changing the absence icon.** |
| `_staleMemberName` flag in `app.js` | When `getSelectedMemberIndex()` can't find a saved name, sets flag, falls back to default member, shows dismissible banner on next render. Flag cleared after banner fires. |
| Sync chip state machine in `app.js` | hidden → (800ms) → "↻ Updating…" → silent remove on success, or "⚠ Couldn't update" (stays, 10s timeout). "✓ Up to date" removed (v10.19) — noise. Never show raw errors to staff. |
| `_clearState` object in `paycalc.js` | Groups all state for a two-tap destructive action so it resets atomically. Includes `countdownTimer` for live countdown in button label. |
| `CONDITIONAL_ROWS` in `paycalc.js` | Data-driven array: condition → row IDs → field IDs. `updateBhRows(p)` iterates it. Adding future conditional rows means one array entry, not new show/hide logic. |
| `touch-only` CSS class in `shared.css` | `display:none` by default; revealed via `@media (pointer: coarse)`. Use for touch-only UI. Do not use inline `display:none`. `(hover: hover)` inverse was dropped (v10.15) — some Android devices misreport it. |
| `window.matchMedia('(pointer: coarse)')` in `initSwipeHint()` | Gesture-tutorial UI must only show on touch devices. Always add this guard. |
| **Do not gate layout on `(hover: hover) and (pointer: fine)` alone** | Some Android devices misreport `hover: hover`. For layout breakpoints, always use `min-width`. Hover/pointer queries are only safe for cosmetic `:hover` transitions. |
| `paycalc.html` desktop grid on `<main>`, not `.app` | CSS grid applies to direct children only — declare on `main { display: grid }`. `.app` only holds max-width. |
| `lsGet` / `lsSet` / `lsDel` from `ls.js` | iOS Safari private mode throws `SecurityError` on any `localStorage` access. **Never call `localStorage` directly** in `app.js`, `admin-app.js`, or `paycalc.js` — always use these wrappers. |
| VAPID fingerprint migration | Both pages store first 12 chars of VAPID key in `localStorage('myb_vapid_ver')`. On mismatch, silently unsubscribes → re-subscribes. Cloud Function treats 401 same as 410/404. |
| One-off notification prompt (`#notifPrompt`) | Appears once per device between `</nav>` and pay-period strip. Both Enable and × set `myb_notif_prompt_done`. Do not move below the calendar. |
| PWA shortcuts in `manifest.json` | Three long-press shortcuts. Changes require reinstall to take effect on existing installs. |
| Sticky take-home bar (`#stickyTotal`) | Fixed bar on mobile (hidden ≥1040px). `IntersectionObserver` shows it when `.result-card` scrolls off. `body.sticky-active` adds bottom padding. |
| 3-digit time input auto-correction in `admin-overrides.js` | On blur, if length is 3 and `parseInt(raw.slice(0,2)) > 23`, prepend `'0'`. Without this, `"630"` produced `"63:0"`. |
| Range picker clear button (`.rp-clear`) | Resets both `from` and `to` dates. Built into `buildRangePicker()` in `admin-app.js`. |
| Sunday RD corrections on absence/AL save | Every Sunday in the range is checked; if `getBaseShift` returns a non-RD shift, an explicit `correction/RD` override is written alongside the AL/sick overrides. Used in both save handlers. |
| Range picker swipe — pointer capture on `grid` not `clip` | Events dispatched to a capture target do not bubble down to children — captures on `clip` breaks the drag animation. |
| Team Week View | Available to all logged-in staff. Grade state (`currentTeamGrade`) persists across re-renders. Fetch token = week-start timestamp — stale Firestore results are discarded. Week navigation clamped to `CONFIG.MIN_YEAR`/`MAX_YEAR`. **No override-load status indicator** — deliberately not added (minimal-noise app). |
| `persistentLocalCache()` in `firebase-client.js` | Firestore stores queries in IndexedDB. Do not revert to `getFirestore()` — Huddle button and override cache depend on instant load. |
| `subscribeToLatestHuddle` in `firebase-client.js` | Persistent `onSnapshot` — button updates automatically when new Huddle arrives. Do not replace with one-time fetch. |
| `cors: true` on `parseRosterPDF` and `setupRosterAuth` | firebase-functions v6 `cors: [array]` doesn't consistently set `Access-Control-Allow-Headers` on preflight. Both functions use Firebase ID token auth, so wildcard origin adds no attack surface. `ingestHuddle` keeps `cors: false` (server-to-server). |
| Android Back button overlay pattern | Overlays push `history.pushState({ mybOverlay: true })` when opening, close on `popstate`. `_pushOverlayState(handler)` / `_clearOverlayHistory()` helpers in all three pages. |
| Maskable icons | 512px entry uses `"purpose": "any maskable"` for Android adaptive shapes. Smaller icons omit this. |
| **Chiltern Saturday payroll: rostered Saturday → `sat` (1.25×); Saturday-on-RD → `rdw`** | Rostered Saturday: 1.25× in `sat` bucket. Saturday that was a rest day and worked: `rdw` bucket — staff use the RDW field, not the Saturday field. Confirmed by Gareth May 2026. Tests assert this. Do not change without further payroll confirmation. |
| **Chiltern Sunday-on-BH: Sunday wins (1.5×)** | `dow === 0` check is before `isBH` in the suggestion engine. Confirmed by Gareth May 2026. |
| **BH + `rdw` override is additive, not replacement** | `rdw` override on a worked BH day adds hours to `bhOt`; base hours stay in `bh`. Do not change to "override replaces base" without specific confirmation. |
| `initALSection()` / `initSickSection()` in `admin-app.js` | `alMember`, `sickMember`, `syncMemberDisplay`, `syncSickMemberDisplay` are hoisted to module scope above the `fieldMember` change handler — that handler fires before init. Do not move them inside the init functions. |
| SW synthesised offline page uses status 200 | Some browsers suppress 5xx response bodies. `Cache-Control: no-store` prevents caching the synthesised page. |
| SW offline fallback only for navigation requests (v10.15) | Only `event.request.destination === 'document'` requests get the offline HTML page. JS/CSS get `Response.error()`. Without this, `/admin-app.js` matched `'admin'` in the fallback logic and got HTML for a JS request — MIME-type error. |
| Huddle notification → `#huddle` hash pattern | SW navigates to `#huddle`; `app.js` listens for `hashchange` and triggers the viewer. `_autoOpen` is `let` so the hashchange handler can reset it. |
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
  role: 'CEA',             // 'CEA' | 'CES' | 'Dispatcher'
  hidden: false,           // Optional — hides from dropdown
  permanentShift: 'early', // Optional — forces early/late badge on all worked days
  startDate: new Date(2026, 3, 20), // Optional — midnight local time: new Date(year, month-1, day)
  proRatedAL: { 2026: 23 } // Optional — overrides getALEntitlement for joining year only
}
```

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
createdAt    Firestore server timestamp
```

**memberSettings**
```
memberName     Must match teamMembers[n].name exactly
faithCalendar  'islamic' | 'hindu' | 'chinese' | 'jamaican' | 'congolese' | 'portuguese' | 'none'
```

Override cache key: `"memberName|YYYY-MM-DD"`

### Authentication

Staff log in with name (dropdown) + surname as password (lowercase, no spaces/special chars). Sessions persist 30 days via localStorage. `CONFIG.ADMIN_NAMES = ['G. Miller']` — elevated access.

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

Active constraints, deferred fixes, and the four v10.50 security tasks: **see `KNOWN_LIMITATIONS.md`**.
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

Admin uploads PDF → `parseRosterPDF` (claude-haiku-4-5-20251001) → JSON → review UI → Firestore. Works for CEA/Bilingual, CES, and Dispatcher rosters.

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

All staff have Firebase Auth accounts. Firestore rules require `request.auth != null` for all writes. `admin-app.js` signs in via Firebase Auth after each localStorage login.

**Adding a new staff member:** Add to `teamMembers` in `roster-data.js`, then admin.html → **Staff Login Accounts** → **Set up accounts**.

**Adding a mid-year joiner:**

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

The **roster-assist hint bar** pre-fills Sat/Sun/BH/Boxing Day/RDW hours from base roster + Firestore overrides. Standard weekday hours are not pre-filled. Pre-filled fields turn gold.

---

## FIP guide

`fip.html` is a low-frequency educational reference — not a core workflow. Judge it as an article-like reference page. Do not flag reference-page format as a design defect. Care about: factual accuracy, "last checked" date, source links, mobile layout, navy/gold palette.
