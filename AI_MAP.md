# AI_MAP.md — Claude routing guide for MYB Roster

Use this file to decide which source file to read or edit for a given task.
Read CLAUDE.md first for project identity, version bumping rules, and architecture constraints.

---

## Quick decision table

| Task | Primary file(s) |
|------|----------------|
| Roster data, team members, bank holidays, pay periods | `roster-data.js` |
| Calendar UI, month view, swipe, shift display | `app.js` |
| Admin portal UI, login, AL/sick sections | `admin-app.js` + `admin.html` |
| Change a Shift — week grid, override entry, bulk bar, save logic | `admin-overrides.js` |
| Roster PDF upload, review pipeline, cell state logic | `admin-roster-upload.js` |
| Roster PDF parsing (Cloud Function) | `functions/index.js` |
| Pay calculator UI, period select, form, settings, HPP | `paycalc.js` + `paycalc.html` |
| Pay maths — tax, NI, gross, thresholds, student loan | `paycalc-calc.js` |
| Pre-fill suggestion engine, override fetch, BH detection | `paycalc-roster-suggestions.js` |
| Shared CSS — colours, typography, badges, layout | `shared.css` |
| Service worker — caching strategy, version bump | `service-worker.js` |
| Firebase init and Firestore helpers | `firebase-client.js` |
| Push notifications, Huddle ingest, auth setup | `functions/index.js` |

---

## File responsibilities in plain English

### `roster-data.js`
The single source of truth for all roster data.
- `APP_VERSION` — **always bump here first**
- `teamMembers` array — names, roles, roster types, start dates
- `getBaseShift(member, date)` — **always use this, never read roster.data directly**
- `getBankHolidays(year)` — algorithmic UK bank holiday list
- `getPaydaysAndCutoffs(year)`, `isPayday()`, `isCutoffDate()`
- Cultural calendar datasets (Islamic, Hindu, Chinese — need annual update)

### `app.js`
Everything that touches `index.html` at runtime.
- Calendar render, month carousel, swipe gestures
- Override cache for the calendar view (`rosterOverridesCache`)
- Team Week View toggle
- Notification/push subscription wiring
- Sync chip state machine

### `admin-app.js`
Login, session management, AL section, sick section, and the glue that wires all admin modules together.
- Login flow, Firebase Auth sign-in/out, session state
- AL entry, sick entry, faith calendar, huddle viewer, push subscription
- Calls `initOverrides()` from `admin-overrides.js` and `initRosterUpload()` from `admin-roster-upload.js`
- Does **not** contain week grid, override list, bulk bar, or roster review pipeline — those are in the sub-modules

### `admin-overrides.js`
The Change a Shift module. Owns the week grid and override list entirely.
- `initOverrides(opts)` — called once by `admin-app.js` after login; receives callbacks
- `renderWeekGrid()` — generates per-row type pills (must stay in sync with `admin.html` bulk bar)
- `loadOverrides()` / `renderTable()` — Saved Changes list
- `executeSave()` — writes override to Firestore
- `updateSaveBtn()` — exported so swipe carousel can call it
- State accessors: `getAllOverrides()` / `setAllOverrides()` — used by AL/sick sections in `admin-app.js`

### `admin-roster-upload.js`
The Weekly Roster Upload pipeline.
- `initRosterUpload(opts)` — called once by `admin-app.js` after login
- `computeCellStates()` — classifies each day: MATCH / DIFF / CONFLICT / COVERED
- `renderReviewTable()` — per-person card list with approve/skip
- `shiftDisplay()`, `shiftValueToOverrideType()` — display and type helpers

### `paycalc.js`
UI layer for `paycalc.html`. No pure pay maths here.
- Period select, form read/write, autosave
- `onPeriodChange()` — orchestrates all period-level updates
- `_suggestIfBlank()` / `_applyRosterSuggestion()` — pre-fill helpers
- Settings card, HPP card, sticky take-home bar
- `getLoggedMember()`, `getEffectiveContr(p)` — session/period helpers

### `paycalc-calc.js`
Pure functions only — no DOM, no Firebase, no localStorage.
- All pay rate tables (`GRADES`, `TAX_YEARS`)
- `computeGross()`, `computeTax()`, `computeNI()`, `computeSL()`
- Edit here for: rate changes, tax year rollover, NI threshold changes
- Covered by `paycalc.test.mjs` — run tests after any change here

### `paycalc-roster-suggestions.js`
Owns the override cache and the suggestion engine. No DOM access.
- Private state: `_overridesByDate`, `_overrideFetchToken`, `_overridesFetchState`
- `resetOverrides(newState)` — called by `onPeriodChange` on every period switch
- `fetchOverridesForPeriod(p, memberName)` — async Firestore fetch, returns Promise
- `getRosterSuggestion(p)` — merges base roster + overrides, returns categorised totals
- Edit here for: overtime split rules, BH detection logic, override fetch behaviour

### `shared.css`
All CSS shared across the three pages.
- CSS custom properties (`--primary-blue`, `--accent-gold`, etc.) — **never hardcode hex**
- Typography scale, badge/pill variants, button types
- `touch-only` class — hidden on pointer-fine devices
- `@media print` rules — every shift type needs a print rule

### `service-worker.js`
- Add any new JS/CSS/HTML file to both `NETWORK_FIRST_FILES` and `CORE_ASSETS`
- Version string must match `APP_VERSION` in `roster-data.js`

### `roster-cycle-data.js`
Raw roster cycle arrays only — `weeklyRoster`, `bilingualRoster`, `fixedRoster`, `cesRoster`, `dispatcherRoster`. Imported by `roster-data.js` only. Edit here when the actual cycle patterns change (very rare). Do not import this file directly from app code — always go through `roster-data.js`.

### `functions/index.js`
Three Cloud Functions:
- `ingestHuddle` — Power Automate → Firebase Storage + Firestore
- `parseRosterPDF` — admin upload → Claude AI → parsed shifts JSON
- `setupRosterAuth` — creates Firebase Auth accounts for all roster members

---

## What NOT to do

| Temptation | Why not |
|-----------|---------|
| Read `roster.data[week][day]` directly | Bypasses `startDate` suppression and Christmas rules. Always use `getBaseShift()`. |
| Add DOM access to `paycalc-calc.js` | It must stay importable by the Node test runner. |
| Add DOM access to `paycalc-roster-suggestions.js` | It must stay free of circular deps with `paycalc.js`. |
| Hardcode hex colours | Use CSS variables — every colour lives in `:root` in `shared.css`. |
| Import Firebase in `paycalc-calc.js` | Same reason as above — test-runner compatibility. |
| Use `alert()` | Use `console.error()` for dev errors; never show raw errors to staff. |
| Skip the version bump | Browsers will serve stale JS. Bump all places listed in `CLAUDE.md`. |

---

## Version bump checklist (summary — full list in CLAUDE.md)

Every commit that changes app behaviour requires updating the version string everywhere.
The authoritative version is `APP_VERSION` in `roster-data.js`.
Key files: `service-worker.js` (×2), all three HTML files (comment + script + css `?v=`), all JS module import `?v=` strings.
**Tip:** `grep -rn "?v=<old>" *.js *.html` finds every stale reference.
