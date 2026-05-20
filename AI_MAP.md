# AI_MAP.md — Claude routing guide for MYB Roster

*Last updated: May 2026 — v10.63 · Updated every 0.10 version*

Use this file to decide which source file to read or edit for a given task.
Read CLAUDE.md first for project identity, version bumping rules, and architecture constraints.

---

## Quick decision table

| Task | Primary file(s) |
|------|----------------|
| Roster logic, team members, bank holidays, pay periods | `roster-data.js` |
| Raw roster cycle patterns (weeklyRoster, cesRoster, etc.) | `roster-cycle-data.js` |
| Calendar UI, month view, swipe, shift display | `app.js` |
| Team Week View — grid, navigation, Firestore fetch, toggle | `app-team-view.js` |
| Override priority and member-start logic — tsToMillis, shouldReplaceOverride, isBeforeMemberStart | `app-override-utils.js` |
| Admin portal UI, login, cultural calendar, module wiring | `admin-app.js` + `admin.html` |
| Annual Leave Booking section | `admin-al.js` |
| Sick Days Recording section | `admin-sick.js` |
| Huddle upload card, push notifications, Huddle card toggle | `admin-huddle.js` |
| Staff Firebase Auth account setup card | `admin-auth.js` |
| Change a Shift — week grid, override entry, bulk bar, save logic | `admin-overrides.js` |
| Roster PDF upload, review pipeline, cell state logic | `admin-roster-upload.js` |
| Roster PDF parsing (Cloud Function) | `functions/index.js` + `functions/roster-parse-helpers.js` |
| Pay calculator UI, period select, form, settings, HPP | `paycalc.js` + `paycalc.html` |
| Pay maths — tax, NI, gross, thresholds, student loan | `paycalc-calc.js` |
| Pre-fill suggestion engine, override fetch, BH detection | `paycalc-roster-suggestions.js` |
| Navigation panel — burger menu, slide-out drawer, Information links, footer bell | `nav-panel.js` |
| Push notification subscribe/unsubscribe, VAPID key, notification state (shared) | `notif.js` |
| Shared CSS — colours, typography, badges, layout | `shared.css` |
| Service worker — caching strategy, version bump | `service-worker.js` |
| Firebase init and Firestore helpers | `firebase-client.js` |
| localStorage wrappers (lsGet, lsSet, lsDel) | `ls.js` |
| Push notifications, Huddle ingest, auth setup | `functions/index.js` |
| Railcard at-work reference — cards, GroupSave, season tickets, gateline checks | `railcard-guide.html` — standalone page, no JS module |

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
- `navigateToPaycalc(paydayStr)` — shared helper for payday/cutoff cell clicks; checks session then navigates

### `admin-app.js`
Login, session management, shared DOM handles, and the glue that wires all admin modules together.
- Login flow, Firebase Auth sign-in/out, session state
- `alMember`, `sickMember`, `syncMemberDisplay`, `syncSickMemberDisplay` — declared here (module scope) because the `fieldMember` change handler references them before `admin-al.js` / `admin-sick.js` init runs
- `fieldMember` change handler, `fieldDate` change handler — keep AL/sick/overrides in sync
- AL over-entitlement confirm bar (`alConfirmBar`) — calls `triggerConfirmedALSave()` from `admin-al.js` for the AL booking path
- Faith calendar settings, cultural calendar, booked-period helpers (`_renderBookedPeriods`, `deletePeriodOverrides`, `updateALBookedBox`, `updateSickBookedBox`)
- Calls `initALSection()`, `initSickSection()`, `initOverrides()`, `initRosterUpload()`, `initHuddleCards()`, `initAuthSetup()` to initialise all sections
- Does **not** contain AL save logic, sick save logic, week grid, override list, bulk bar, roster review pipeline, Huddle upload, push notifications, or auth setup — those are in sub-modules

### `admin-al.js`
Annual Leave Booking section (extracted v9.93).
- `initALSection(deps)` — sets up date picker, preview, entitlement check, and Firestore save. Receives DOM handles and callbacks via `deps` to avoid circular imports.
- `triggerConfirmedALSave()` — called by the confirm bar in `admin-app.js` when the user accepts booking over their AL entitlement; sets internal flag and re-fires the save button.
- Imports `teamMembers`, `getALEntitlement`, `getBaseShift`, `formatISO`, `isSunday`, `escapeHtml` from `roster-data.js`; `writeBatch`, `db`, etc. from `firebase-client.js`; `getAllOverrides`, `setAllOverrides`, `renderWeekGrid`, `renderTable`, `formatDisplay` from `admin-overrides.js`.

### `admin-sick.js`
Sick Days Recording section (extracted v9.93).
- `initSickSection(deps)` — sets up date picker, preview, and Firestore save. Receives DOM handles and callbacks via `deps` to avoid circular imports.
- Same direct imports as `admin-al.js` (roster-data, firebase-client, admin-overrides). No `lsSet` or `confirmNavigate` needed — the sick section has no member-change handler.

### `admin-overrides.js`
The Change a Shift module. Owns the week grid and override list entirely.
- `initOverrides(opts)` — called once by `admin-app.js` after login; receives callbacks
- `renderWeekGrid()` — generates per-row type pills (must stay in sync with `admin.html` bulk bar)
- `loadOverrides()` / `renderTable()` — Saved Changes list
- `executeSave()` — writes override to Firestore
- `updateSaveBtn()` — exported so swipe carousel can call it
- State accessors: `getAllOverrides()` / `setAllOverrides()` — used by `admin-al.js` and `admin-sick.js`

### `admin-huddle.js`
Huddle upload, push notification subscribe/unsubscribe, and Huddle card toggle.
- `initHuddleCards(opts)` — called once by `admin-app.js` after login
- Notifications card: VAPID key handling, fingerprint-based re-subscription on key rotation
- Huddle upload: file validation, DOCX conversion via mammoth.js, upload to Firebase Storage via `uploadHuddle`
- Huddle card: collapse/expand toggle

### `admin-auth.js`
Staff Firebase Auth account setup (admin only).
- `initAuthSetup(opts)` — called once by `admin-app.js` after login
- Wires up the Staff Login Accounts card; calls `setupRosterAuth` Cloud Function
- Sends a fresh Firebase ID token (`getIdTokenResult(true)`) as the bearer token — no client-side secret since v9.88

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
- `getRosterSuggestion(p, member)` — merges base roster + overrides, returns categorised totals; member is passed by caller (no localStorage access)
- `_setOverridesForTest(map)` — test-only hook to inject overrides without Firestore
- Edit here for: overtime split rules, BH detection logic, override fetch behaviour
- Covered by `paycalc-roster-suggestions.test.mjs` — run with `node --experimental-test-module-mocks --test paycalc-roster-suggestions.test.mjs`

### `firebase-client.js`
Single Firestore initialisation point — import `db` and Firestore helpers from here, never from the Firebase CDN directly.
- `db` — initialised with `persistentLocalCache()` so all queries are backed by IndexedDB offline storage
- Standard exports re-exported: `collection`, `query`, `where`, `orderBy`, `limit`, `getDocs`, `getDoc`, `addDoc`, `setDoc`, `deleteDoc`, `doc`, `serverTimestamp`, `writeBatch`, `onSnapshot`
- `uploadHuddle(date, file, uploadedBy)` — writes to Firebase Storage + Firestore `huddles` collection
- `subscribeToLatestHuddle(onData, onError)` — real-time `onSnapshot` listener; returns an unsubscribe function. Used by `app.js` to keep the Huddle button live without a page refresh. Logs a `console.warn` if a huddle document is missing its `storageUrl` (data integrity signal).
- `savePushSubscription` / `deletePushSubscription` — Web Push subscription management. `deletePushSubscription` guards against empty endpoint (no-ops silently).
- `auth`, `signInWithEmailAndPassword`, `signOut`, `nameToEmail` — Firebase Auth

### `nav-panel.js`
Shared slide-out navigation panel — imported by `app.js`, `admin-app.js`, and `paycalc.js`.
- `initNavPanel({ currentPage, memberName, onSignOut })` — injects overlay + drawer HTML, wires burger button, manages open/close. `memberName` displays in footer; `onSignOut` callback wires the Sign out button (omit both to hide footer).
- `NAV_PAGES` — page navigation destinations (Calendar / Admin / Pay); current page is omitted from the pill row
- `NAV_INFORMATION` — flat always-open Information section config: Workplace (Daily Huddle, Weekly Retail Circular, Railcard Guide) + Staff Travel (FIP Guide). An entry with `comingSoon: true` (instead of `url`) renders as a `<button>` that opens the injected `#navComingSoonLightbox` placeholder instead of navigating.
- Sign-out footer (v10.59): shown only when `onSignOut` is supplied. Each page passes its own sign-out logic as a callback — nav-panel.js only calls it.
- Notification bell (v10.61): footer 🔔/🔕 toggle, rendered only when `notifSupported()` (from `notif.js`) is true. Refreshes on every panel open; tap toggles via `enable/disableNotifications()` and keeps the panel open. `denied` state shows an inline "change in browser settings" hint. This file owns only the bell UI — all push logic is in `notif.js`.
- Android back-button pattern: pushes `{ mybNavPanel: true }` history state on open; closes on popstate. `closePanelForNavigation()` (visual-only, no `history.back()`) is used for link/sign-out clicks to avoid racing hash navigation.
- Adding a new guide = one `links` entry in `NAV_INFORMATION`. No other changes needed.

### `notif.js`
Shared Web Push module — single source of truth for the VAPID key and subscription lifecycle. Imported by `nav-panel.js`.
- `notifSupported()` — feature detection incl. the iOS "must be a Home Screen PWA" rule
- `getNotifState()` — async → `'on'|'off-default'|'off-lapsed'|'denied'|'unsupported'`; also does the silent VAPID-rotation re-subscribe
- `enableNotifications()` / `disableNotifications()` — async; subscribe/unsubscribe + Firestore save/delete
- Imports `savePushSubscription`/`deletePushSubscription` from `firebase-client.js`, `lsGet`/`lsSet` from `ls.js`
- **Not yet wired into `app.js` or `admin-huddle.js`** — they keep their own duplicate copies of this logic (deferred cleanup). If you change the VAPID key or subscribe flow, update all three until they are consolidated.

### `app-override-utils.js`
Override priority and member-start helpers — shared by `app.js` and `app-team-view.js`.
- `tsToMillis(ts)` — converts Firestore Timestamp or `{seconds}` object to milliseconds
- `shouldReplaceOverride(existing, incoming)` — priority logic: manual beats import; newer wins within same class
- `isBeforeMemberStart(member, date)` — returns true if `date` is before the member's `startDate`; used to suppress overrides before a member joined. Always call this — never inline the date comparison.
- Covered by `app.test.mjs`

### `ls.js`
Safe localStorage wrappers for all three pages (iOS Safari private mode compatibility).
- `lsGet(k)`, `lsSet(k, v)`, `lsDel(k)` — wrap every `localStorage` call in try/catch
- On the first failure, emits a single `console.warn` (visible in DevTools) — subsequent failures are silent
- **Never call `localStorage` directly** in `app.js`, `admin-app.js`, or `paycalc.js` — always use these wrappers

### `shared.css`
All CSS shared across the three pages.
- CSS custom properties (`--primary-blue`, `--accent-gold`, etc.) — **never hardcode hex**
- Typography scale, badge/pill variants, button types
- `touch-only` class — hidden by default, revealed on `@media (pointer: coarse)` (touch devices)
- `@media print` rules — every shift type needs a print rule

### `service-worker.js`
- Add any new JS/CSS/HTML file to both `NETWORK_FIRST_FILES` and `CORE_ASSETS`
- Version string must match `APP_VERSION` in `roster-data.js`

### `roster-cycle-data.js`
Raw roster cycle arrays only — `weeklyRoster`, `bilingualRoster`, `fixedRoster`, `cesRoster`, `dispatcherRoster`. Imported by `roster-data.js` only. Edit here when the actual cycle patterns change (very rare). Do not import this file directly from app code — always go through `roster-data.js`.

### `functions/index.js`
Three Cloud Functions (Firebase-dependent shell — pure logic lives in `roster-parse-helpers.js`):
- `ingestHuddle` — Power Automate → Firebase Storage + Firestore
- `parseRosterPDF` — admin upload → Claude AI → parsed shifts JSON
- `setupRosterAuth` — creates Firebase Auth accounts for all roster members

### `functions/roster-parse-helpers.js`
Pure helper functions — no Firebase, no HTTP, no secrets. Fully testable with Node's built-in test runner.
- `normaliseShift(raw)` — AI shift value → canonical app format (time, RDW pipe encoding, keywords)
- `buildWeekDates(weekEnding)` — Saturday ISO date → 7-date array Sun–Sat
- `extractAIJson(text)` — strips preamble/fences from AI response, returns parsed object
- `HEADER_TO_INDEX` — day-name → week-index map (0 = Sunday)
- `mapColumnHeadersToDates(headers, dates)` — returns `{ columnDates, error }` — validates and maps AI column headers to ISO dates
- `buildSafeEntries(parsedMembers, headers, dates)` — fills missing AI day keys with 'RD', normalises values
- `applySundayScanCorrections(entries, sundayScan, hasSundayCol, dates)` — fixes blank-Sunday misreads (Case A) and RDW stripping (Case B)
- `huddleDayLabel(huddleDate, nowLondon)` — "Today's" / "Tomorrow's" / "Thursday's"
- `isPayCutoffDay(date)` — mirrors isCutoffDate() from roster-data.js
- `nameToEmail(fullName)` / `nameToPassword(fullName)` — Firebase Auth credential derivation
- Covered by `roster-parse-helpers.test.mjs` (76 tests)

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

## Version bump checklist

See `CLAUDE.md` → "Version bumping (MANDATORY on every change)". Six places, authoritative source is `APP_VERSION` in `roster-data.js`.
