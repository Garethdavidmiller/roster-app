# AI_MAP.md — Claude routing guide for MYB Roster

*Last updated: November 2026 — v25.40 · Updated every 0.10 version*

Use this file to decide which source file to read or edit for a given task.
Read CLAUDE.md first for project identity, version bumping rules, and architecture constraints.

## What an entry holds

Each module entry says what the module is for, names every export with a short note, and lists the
invariants an editor must not break, each as one line or as a pointer to where the module explains
it. Design reasoning lives in the module's own header and comments; release history lives in git log
and the plan docs (CLAUDE.md → "Current file structure", the three homes). An entry that restates its
module drifts from it, so an entry points rather than argues.

`doc-parity.test.mjs` keeps the map honest: every root module has its own `###` entry, every root
export is named somewhere in this file, a "`symbol` in `file.js`" claim must be true, and a
backticked name the source no longer holds must be marked as gone where it is named.

---

## Quick decision table

| Task | Primary file(s) |
|------|----------------|
| Roster logic, team members, bank holidays, pay periods | `roster-data.js` |
| Raw roster cycle patterns (weeklyRoster, cesRoster, etc.) | `roster-cycle-data.js` |
| The roster's people (`teamMembers`) | `roster-member-data.js` (re-exported by `roster-data.js`) |
| Calendar coordinator — event wiring, month navigation, the access hooks | `calendar-app.js` |
| Calendar display month and year — getDisplayMonth/Year, setDisplayMonth/Year, changeDisplay, addMonths, persistViewedMonth, watchLocalDate | `calendar-state.js` |
| Calendar swipe carousel — initSwipeHandler, isSwipeGestureActive, isSwipeCooldown | `calendar-swipe.js` |
| Calendar annual-leave panel and day-detail panel — initCalendarLightboxes | `calendar-al-lightbox.js` |
| Calendar first three-month read and the sync chip — initInitialFetch | `calendar-initial-fetch.js` |
| Calendar keyboard navigation and hover tooltip — initCalendarKeyboard, initCalendarTooltip | `calendar-keyboard.js` |
| Calendar override cache — rosterOverridesCache, fetchOverridesForRange, ensureOverridesCached, getShiftTypesInMonth | `calendar-overrides.js` |
| What the Calendar knows about each month, and so what it may show | `calendar-data-state.js` |
| The Calendar's access gate, the cards that stand in for it, and its pure rules | `calendar-access.js` · `calendar-lock-cards.js` · `calendar-lock-slot.js` · `calendar-access-core.js` |
| The member's own roster kept on the device, shown labelled before the sign-in check finishes | `calendar-snapshot.js` |
| The Calendar page's one-time notices (which are live: CLAUDE.md → "Current notices") | `calendar-notices.js` |
| Calendar member selection — getSelectedMemberIndex, getCurrentMember, populateTeamMemberDropdown, validateTeamMembers | `calendar-member.js` |
| The phone's text scale, measured rather than asked, for the Calendar's control rows — LARGE_FROM, LARGE_VALUE, COMPACT_FROM, COMPACT_VALUE, tierFor, isCompact, measureTextScale, applyTextScale | `text-scale.js` |
| Calendar rendering — buildCalendarContainer, createCalendarHeader, createDayCell, dayCellParts, dayCellName, getSwipeDirection | `calendar-renderer.js` |
| The month legend — which keys apply, and whether it shows at all | `calendar-legend.js` |
| The document gate on the Calendar — may the Huddle, Circular and Newsletter be read (opened on the grant, shut on access lost) | `calendar-doc-access.js` |
| The notification prompt strip and silent renewal on the Calendar — initNotifPrompt (never on the shared PIN viewer) | `calendar-notif-prompt.js` |
| The install strip on the Calendar, and the route the install notice asks of it — initInstallPrompt, installRoute, promptInstall, yieldToInstallNotice, retireInstallStrip, installNoticeHasTheVisit | `install-prompt.js` |
| Daily Huddle viewer — the `#huddle` hash, the subscription, the two render paths, the per-table scroll boxes (wrapTables) | `calendar-huddle-viewer.js` |
| Which Huddle cells are physically in column 1 (`firstColumnMask`), for the sticky job column | `huddle-table-grid.js` |
| Circular/Newsletter in-app viewer (#circular/#newsletter notification deep link) | `calendar-doc-viewer.js` |
| Team Week View — initTeamView, and `weekStartForMonth` (which week it opens on) | `calendar-team-view.js` |
| Override priority, member-start, rest-shift helpers — tsToMillis, shouldReplaceOverride, reconcileRangeIntoCache (authoritative range refresh), isBeforeMemberStart, isRestShift, isOverrideDisplaySuppressed, resolveEffectiveShift (shared display ladder), computePeriodDeleteIds; training value grammar + pay resolver | `override-utils.js` |
| Body scroll lock, overlay history, focus trap, lightbox lifecycle, card collapse (lockBodyScroll, trapFocus, createLightbox, initCardCollapse, etc.) | `overlay.js` |
| About panel content (version, update status, bug link, print button) | `about-lightbox.js` |
| Per-card ? tips lightbox lifecycle/renderer (content data stays per page) | `tips-lightbox.js` |
| Service worker registration + update lifecycle (every app page) | `sw-register.js` |
| Auth/session helpers (AUTH_KEY, getSession, saveSession, clearSession, ensureFirebaseSession) | `session.js` |
| Admin portal UI, login, AL, sick, overrides, module wiring | `admin-app.js` (+ `admin-boot.js`) + `admin.html` |
| Settings page — Password, Work email, Notifications, Install, Pay Calculator data | `settings-app.js` + `settings.html` |
| Nav-panel footer initials badge | `nav-panel.js` + `avatarInitials`/`avatarHue` in `roster-data.js` |
| Operations page — Huddle upload, Roster upload, Staff Login Accounts | `operations-app.js` + `operations.html` |
| Error Log card (ops page) — uncaught error capture, the card, Copy for Claude | `error-reporter.js`, `firebase-client.js` (logClientError/getClientErrors/resolveClientError), `client-errors.js` (ordering/retention policy), `operations-errors.js`, `operations.css` |
| Usage card (ops page) — anonymous page popularity + active-account counts | `usage-reporter.js` (recordUsage per page), `firebase-client.js` (recordPageView/recordActiveAccount/getUsageStats), `usage-stats.js` (date/aggregation maths), `operations-usage.js`, `operations.css`, `firestore.rules` (`analytics`) |
| Links design workspace — the rotation design grid (`ROTATING_LINES` lines), paint mode, hourly coverage heat map, design checks, auto-generator UI | `links-app.js` + `links.html` + `links.css` |
| Link-design maths — shift classification, custom-time validation, coverage counting (per-type + hour-by-hour), rotating-window generator, design quality checks | `links-design.js` (pure — no DOM/Firebase; tested by `links-design.test.mjs`) · `runDesignChecks(patterns, rotatingLines)` returns `{ weekendsOff, weekendsOffPct, totalWeeks, unfilledLines, turnarounds, longestStretch, balance }` |
| Annual Leave Booking section | `admin-al.js` |
| Which AL days consume entitlement, and a member's taken/booked/remaining position | `al-entitlement.js` (pure — no DOM/Firebase; tested by `al-entitlement.test.mjs`) |
| CHRISTMAS LEAVE — who is shown on leave on 25/26 December, never counted, and the Boxing Day day in lieu | `christmas-leave.js` (pure; `christmas-leave.test.mjs`) · the whole allowance `entitlementFor` in `al-entitlement.js` |
| WHICH YEAR'S ALLOWANCE a day of annual leave comes out of — a January day may be moved to the year before | `leave-year.js` (pure, no imports; `leave-year.test.mjs`) · Admin panel `admin-leave-year.js` · its save `admin-leave-year-save.js` |
| WHICH YEAR the Admin AL figures describe, when four surfaces each imply one | `admin-al-year.js` (pure — no DOM/Firebase; tested by `admin-al-year.test.mjs`) |
| The recorded-DATES list on Admin, and which year of it is shown | `admin-booked-periods.js` (imports nothing; tested by `admin-booked-periods.test.mjs`) |
| Sick Days Recording section | `admin-sick.js` |
| Huddle upload (admin-only, operations page) | `huddle.js` → `initHuddleUpload` |
| Push notifications card (all staff, settings page) | `huddle.js` → `initHuddleNotifications` |
| Staff Firebase Auth account setup card | `admin-auth.js` |
| Change a Shift — week grid, override entry, bulk bar, save logic | `admin-overrides.js` |
| Inline date-range calendar widget (AL and Sick date pickers) | `admin-rangepicker.js` |
| Roster PDF upload, review pipeline, cell state logic | `admin-roster-upload.js` |
| Roster PDF parsing (Cloud Function) | `functions/index.js` (`parseRosterPDF`) + `functions/roster-parse-helpers.js` + `functions/roster-prompt.js` |
| Pay calculator coordinator — calculate(), autosave, HPP, back-pay | `paycalc-app.js` + `paycalc.html` |
| Pay calculator lightboxes — About, Help, YTD notice, decimal converter | `paycalc-lightboxes.js` |
| Pay calculator period arithmetic, select UI, nav | `paycalc-periods.js` |
| Pay calculator grade helpers, settings save/load | `paycalc-settings.js` |
| Roster-assist hint bar UI, fill logic, snap persistence | `paycalc-roster-hint.js` |
| Holiday Pay Premium estimator, shared period decode helpers | `paycalc-hpp.js` |
| Back-pay lump sum calculator | `paycalc-backpay.js` |
| Shared date/currency formatters (pure) | `paycalc-format.js` |
| Result-card HTML builders (pure) — summary + breakdown | `paycalc-breakdown.js` |
| Pay calculator help/tooltip text | `paycalc-help.js` |
| Pay calculator localStorage keys and data migrations | `paycalc-migrations.js` |
| Pay maths — tax, NI, gross, thresholds, student loan | `paycalc-calc.js` |
| Pre-fill suggestion engine, override fetch, BH detection | `paycalc-roster-suggestions.js` |
| Navigation panel — burger menu, slide-out drawer, Information links, footer bell | `nav-panel.js` |
| Push notification subscribe/unsubscribe, VAPID key, notification state (shared) | `notif.js` |
| Firestore security rules — write isolation, field validation, admin bypass | `firestore.rules` |
| Shared CSS — colours, typography, badges, layout | `shared.css` |
| Service worker — caching strategy, version bump | `service-worker.js` |
| Firebase init and Firestore helpers | `firebase-client.js` |
| localStorage wrappers (lsGet, lsSet, lsDel, lsKeys) | `ls.js` |
| Cross-file localStorage key constants (SELECTED_MEMBER, VIEWED_MONTH/YEAR and the rest) | `storage-keys.js` |
| Cloud Functions — the composition root (`functions/index.js`); documents and the Huddle ingest (`functions/documents.js`); accounts and the PIN (`functions/auth-endpoints.js`, `functions/calendar-viewer-auth.js`); push (`functions/push.js`) | `functions/index.js` |
| Railcard at-work reference — cards, GroupSave, season tickets, gateline checks | `railcard-guide.html` + `railcard-guide.js` + `railcard-guide.css` |
| Print button for every guide, and the FIP per-country print buttons | `guide-print.js` |
| Guide back-arrow retarget (`?from=` → the page you came from, every guide) | `guide-back.js` |
| Shared guide chrome — header, back/PDF buttons, print banner (every guide) | `guide-shell.css` |
| Page-specific styles for staff-guide.html | `staff-guide.css` |
| Page-specific styles for paycalc-guide.html | `paycalc-guide.css` |
| FIP travel guide — country reference; jump links open the target section | `fip-guide.html` + `fip-guide.js` + `fip-guide.css` |
| HTML sanitisation for Huddle viewer (self-hosted) | `purify.es.mjs` |

---

## File responsibilities in plain English

### `roster-data.js`
The roster's single source of truth: configuration, the people and cycle patterns (re-exported), and
every base-shift, date and shift-classification helper. Rules: `.claude/rules/roster-data.md`.
- `APP_VERSION` — the authoritative version; change it only with `npm run bump`.
- `CONFIG` — cycle lengths, reference Sundays, `MIN_YEAR`/`MAX_YEAR`, payday anchors, the role lists
  (`ADMIN_NAMES` and the rest), `GRADE_ORDER`, `WORK_EMAIL_DOMAIN` and the feature switches. The server
  reads a generated copy of several: run `npm run generate:roster-members` in the same commit (CLAUDE.md
  → Change impact).
- `teamMembers` (from `roster-member-data.js`) · `weeklyRoster` · `bilingualRoster` · `fixedRoster` ·
  `cesRoster` · `dispatcherRoster` (from `roster-cycle-data.js`) — world-readable (CLAUDE.md → teamMembers).
- **Base shifts.** `getBaseShift(member, date)` — **always use this, never read `roster.data`**; it
  applies start-date suppression, roster changes and the Christmas rule. `getPatternShift(member, date)`
  — the same lookup without the Christmas rule, for the Christmas leave rules only (`christmas-leave.js`).
  `resolveMemberRoster(member, date)` — applies `rosterChanges` (latest `from` ≤ date wins); never
  special-case `rosterType` at a call site. `getWeekNumberForDate(date, member)` ·
  `getRosterForMember(member, date?)` → `{ type, data, cycleLength, weekPrefix }` (`weekPrefix` is `''` for a
  fixed line).
- **Dates.** `isChristmasRD(date)` — 25 and 26 December are rest days, applied BEFORE Firestore overrides
  so 26 December can still become RDW; never reorder (`CALENDAR_DATA.md` 8). `isChristmasDay` ·
  `getBankHolidays(year)` · `isBankHoliday` · `isEasterSunday` · `computeEaster(year)` ·
  `getSpecialDayBadges(date)` (Admin's day-row markers, worded as `dayMarkers` words them) ·
  `getPaydaysAndCutoffs(year)` · `isPayday` · `isCutoffDate` · `paydayForCutoff(cutoffIso)` (or null).
- **Shifts.** `getShiftKind(timeStr, member)` (honours `permanentShift`, so not interchangeable with
  `getShiftClass(timeStr)`) · `isEarlyShift` · `isNightShift` · `isWorkedShift(shift)` (false for
  RD/OFF/SPARE/AL/SICK, true for everything else, RDW included) · `shiftBadgeParts(timeStr)` →
  `{ cls, emoji, word, title?, timed? }`, the one source of a badge's colour and words ·
  `getShiftBadge(timeStr, { showTime? })` (`showTime` shows a timed shift's time — Admin's week grid and
  Overtime's `rosterBadge`; the default stays byte-identical) · `SHIFT_TIME_REGEX` · `TIME_RE` ·
  `validateRosterPatterns(rosters?)` (a load-time self-check on localhost or `?debug`).
- **Leave and grades.** `getALEntitlement(member, year, overrides)` → number or **`null`** (none on
  record: test for it, because `null - taken - booked` is a number). Read the whole allowance through
  `entitlementFor` (`al-entitlement.js`), never this (`christmas-leave.test.mjs`).
  `projectAnnualLeaveOverage({...})` (both AL write paths' over-entitlement warning, or null) ·
  `gradeForRole(role)` → `'cea'|'ces'|null` (re-exported by `paycalc-settings.js`, whose entry says what
  null means) · `getMembersForGrade(grade)` (Management is not filtered on `hidden` — see the comment) ·
  `TEAM_GRADES`.
- **Utilities.** `escapeHtml` · `formatISO(date)` / `parseISODate(str)` (its local-noon inverse) ·
  `isSunday` · `isSameDay` · `parseSmartFloat` / `parseSmartFloatOrNull` (normalise smart hyphens, `£` and
  commas; the second keeps "unusable" distinct from 0) · `isValidEmail` · `isChilternWorkEmail` (mirrors
  the `staffContact` rule) · `workEmailLocalPart` / `workEmailFrom` (strip and restore OUR domain only) ·
  `avatarInitials` / `avatarHue` · `MONTH_NAMES` · `DAY_NAMES` / `MONTH_ABB` (from `date-format.js`) ·
  `SWIPE_THRESHOLD` / `SWIPE_VELOCITY`.
- Never put real pay figures in this served file (`.claude/rules/paycalc.md` → Example payslips).

### `calendar-app.js`
Coordinator for `index.html`: it wires the modules below and owns what is left — month navigation,
the access hooks, the member's own-roster copy, the month-jump picker and About. It exports nothing.
- `renderCalendar()` — draws the month through `buildCalendarContainer` (no Try again, and `checking`,
  while the first read runs) and shows the stale-member banner (`takeStaleMemberName`).
  `renderCalendarWhenIdle()` defers a background render while a swipe is live; `_repaintAfterMonthRead()`
  is the one stable callback every month read repaints through.
- `navigateToPaycalc(paydayStr)` — the one route to the calculator (`?payday=`) and its one gate,
  `personalActionsAllowed`; it returns whether it went, so a refused Enter falls through to the day
  panel. It never diverts to a sign-in: Pay signs in in place.
- `changeMonth(delta)` · `retryMonth(year, month)` (the month panel's Try again; it also withdraws a
  recorded sync failure) · `updateLegend()` (delegates to `calendar-legend.js`).
- **Access hooks** (`initCalendarAccess`): `onEveryGrant` opens the override gate BEFORE anything
  renders, sets the access-lost handler, opens the document gate and repaints a re-grant; `onGranted`
  runs once — the workspace, the claim sweep and the forced set-password step, which the notices queue
  behind.
- **The own-roster copy** (`calendar-snapshot.js`): painted into the lock slot before the decision,
  offered to the renderer for a month still loading, saved from settled months — only on the member's
  own calendar, signed in by name, outside Team View.
- Delegates the AL and day panels, the first read, swipe, keyboard, Team View, notices, the Huddle and
  document viewers and the two prompt strips to their modules; `watchLocalDate` repaints when the date
  turns.

### `calendar-state.js`
The Calendar's display month and year, and the arithmetic that moves them. No DOM.
- `getDisplayMonth()` / `getDisplayYear()` · `setDisplayMonth(m)` / `setDisplayYear(y)` (the Today button
  and the month-jump picker).
- `changeDisplay(delta)` — clamped to `CONFIG.MIN_YEAR`–`MAX_YEAR`.
- `addMonths(month, year, delta)` → `{ month, year }` — the one clamped month arithmetic, shared with the
  swipe carousel's adjacent panels so the two cannot disagree.
- `persistViewedMonth()` — stores the position after each navigation.
- `watchLocalDate(onChange, env?)` → a stop function — fires when the device's local date turns (on
  resume, and at local midnight while open), so a PWA resumed next morning stops highlighting
  yesterday. Tested by `calendar-state.test.mjs`.
- At load, `restoreViewedMonth` honours a `?date=` link once (then strips it), else the stored month
  unless it is in the future.

### `calendar-swipe.js`
The Pointer Events month carousel on `#calendarDisplay`. The design notes (panels built on
`pointerdown`, capture deferred to `pointermove` for iOS, rAF-throttled transforms, no left-edge guard
unlike `admin-week-swipe.js`) are in the module.
- `initSwipeHandler({ isTeamViewMode, changeMonth, renderCalendar, updateLegend, updateNavButtonState,
  openDayDetail, onRetryMonth })` — the incoming panel becomes the live view on commit, so it is built
  with the same `onRetryMonth` and `checking` rules as `renderCalendar`.
- `isSwipeGestureActive()` — **background re-renders must wait on this**: a render mid-gesture detaches
  the carousel's panels.
- `isSwipeCooldown()` — true while a swipe animation runs; the buttons and keyboard wait for it.

### `calendar-al-lightbox.js`
The Calendar's annual-leave panel and its day-detail panel — the only place a touch user reads what a
day is. The reasoning sits beside each step, in `index.css` (layout) and in `index.html` (markup).
- `initCalendarLightboxes({ navigateToPaycalc })` → `{ openDayDetail, closeALLightbox }`.
- **Leave panel.** Reads the member's own `annual_leave` overrides (one member, to the end of next
  January) and counts them with `countedAlDates`, `entitlementFor` and `entitlementNote`
  (`al-entitlement.js`), adding the carry line (`leave-year.js`) and the Christmas line
  (`christmas-leave.js`). A last-known-good memo per member and year paints at once; a refresh that fails,
  or that the offline cache answered, keeps it. A `null` entitlement shows the em-dash state. The panel
  has its own year (‹ ›), opening on the Calendar's.
- **Day panel.** Filled from the cell's `data-detail-*` attributes (`calendar-renderer.js` writes them):
  the date and roster week, the shift with its kind glyph, the change as two badges built from
  `shiftBadgeParts` with `textContent` (never markup from an attribute), who last saved it, "As rostered"
  only where the renderer earned it, the day markers as chips, and the leave-year and Christmas lines.
- **Its two actions are personal.** "Pay estimate" and "Leave dates" show only when
  `personalActionsAllowed` says the calendar on screen is the signed-in member's own; the leave link
  carries the tapped day's year (`admin.html?alYear=…#alBookedBox`). The action row must vanish when
  both are hidden (`index.css`).
- **Layout rules that each shipped wrong once:** the kind glyph on an unchanged day; the time in its own
  span (`splitShiftLine`); the arrow travelling with the badge it points at; the date clearing the close
  button on both sides; the eyebrow naming the base roster.
- A click opens it on every pointer type, and the keyboard keeps Enter's pay jump (the renderer's click
  handler says why); a mouse drag opens nothing (`e2e/calendar.spec.js`). Tested by that spec's
  `day detail:` block, `lightbox-transform-parity.test.mjs` and `day-detail-explains.test.mjs`.

### `calendar-initial-fetch.js`
The Calendar's first three-month override read and the sync chip. Two phases (`AUTH_PLAN.md` → E1):
phase 1 paints from the local Firestore cache with no network and no session (though not before
Firebase Auth initialises — `CALENDAR_DATA.md` 10); phase 2 waits for `authReady`, bounded by
`SYNC_TIMEOUT_MS`, then runs the authoritative server read.
- `initInitialFetch({ isTeamViewMode, renderCalendar, renderTeamView?, refetchTeamView?, authReady?,
  onAccessLost? })` → `{ cacheSettled, dismissSyncError }`. It pre-claims the three months so no
  per-month read competes, and on success repaints whichever surface is live. `onAccessLost` hands a
  `permission-denied` to the access layer instead of looping on Retry. `cacheSettled` lets the boot wait
  a moment for the cache paint; `dismissSyncError()` withdraws a recorded failure (never a running
  "Updating…") when the month panel's Try again takes over.
- Chip: hidden → "↻ Updating your shifts…" after 800 ms → "⚠ Couldn't update — tap to retry" at the
  timeout. The owed state is `_chipState`, not the DOM, and a `MutationObserver` puts the chip back
  whenever a header rebuild takes it away (beside `setChipState`).
- Coming back into view, or a bfcache restore, releases months older than `STALE_MONTH_MS` so they are
  re-read behind the grid (`releaseStaleMonths`, `CALENDAR_DATA.md` 18); Team View re-reads through
  `refetchTeamView`.

### `calendar-keyboard.js`
Keyboard navigation and the hover tooltip for the month grid.
- `initCalendarTooltip()` — fine pointers only; one floating `#calTooltip` fed by each cell's
  `data-tooltip`. An open overlay takes it down (`index.css`, `body.lb-open #calTooltip`).
- `initCalendarKeyboard({ navigateToPaycalc, openDayDetail })` — roving tabindex on the arrows,
  PageUp/Down for months, Enter/Space to activate: a pay or cut-off cell tries the calculator, and a
  refused jump falls through to the day panel. On the stored copy painted before the grant only the
  arrows work.

### `calendar-access.js`
The Calendar's access gate: decide at boot, show the right card, and hold the shared staff-PIN
viewer's session. The header carries the design; `CALENDAR_DATA.md` 3, 4, 11 and 12 and
`AUTH_AND_SESSIONS.md` 7–10 and 17–20 hold the invariants.
- `initCalendarAccess({ onGranted, onEveryGrant, paintBeforeDecision?, onAwaitingInput? })` — the
  bootstrap. `onGranted` runs once (it builds the workspace); `onEveryGrant` runs on every grant,
  including one after a re-lock, and carries everything the access-lost path turns off — bundling the
  two is the bug `grant()`'s comment describes. `paintBeforeDecision` shows the member's stored roster
  while the decision runs; `onAwaitingInput` hears when a card that needs typing goes up.
- `calendarAccessReady` — resolves on the first grant, never rejects. `calendarAuthReady` — when a
  WRITE can use the identity (today the same instant): writers await it, renderers the other.
- `getAccessType()` → `'named'|'viewer'|'none'` · `isViewerMode()`.
- `unlockWithPin(pin)` → `{ ok }` or `{ ok:false, kind, message }` — posts the PIN to
  `unlockCalendarViewer`, signs out anyone current (and refuses if that fails), switches to session-only
  persistence, signs in with the custom token and checks the claim before granting. The PIN is never
  stored, logged or held in module state.
- `lockCalendar()` — the drawer's Lock. Fails closed (throws if the viewer is still current) and reloads
  onto `#staff-pin`.
- `handleAccessLost()` — re-lock after a read refused because the session went: a member gets their own
  card, a viewer the PIN card. The CALLER shuts the override gate first.
- **Rules an edit can break:** the gate is structural — nothing is initialised while access is `none`,
  and `calendar-overrides.js` refuses reads on its own, because the local cache never consults the
  rules; sign the old identity out BEFORE changing persistence, and check the claim BEFORE granting; the
  boot's waits share one budget, `ACCESS_DECISION_BUDGET_MS` (`session.js`); a member is never sent to
  the PIN — a late-identity watcher keeps listening, and a held session tries a silent sign-in behind the
  skeleton for up to `SILENT_BEFORE_CARD_MS` before its card goes up; whichever recovery route grants
  second stands down; `#staff-pin` is consumed at boot whatever the decision.
- The cards are `calendar-lock-cards.js`, in the one slot `calendar-lock-slot.js` owns. Why `overrides`
  stopped being world-readable, and running the PIN: OPERATIONS_REFERENCE.md → "Staff PIN access for the
  Calendar".

### `calendar-lock-cards.js`
The three cards that can stand where the Calendar goes. They DRAW; `calendar-access.js` DECIDES and
keeps the security properties (the persistence order and the claim check). The header lists the four
things an edit can silently break.
- `initLockCards({ unlockWithPin, getAccessType, setWorkspaceHidden, unlockUrl, onAwaitingInput? })` —
  called once in `calendar-access.js`; injected because importing back would be a cycle
  (`import-graph.test.mjs`).
- `showSignInPanel(notice?)` — the front door: the shared `login-overlay.js` card mounted inline, with
  "Use the staff PIN instead". It re-reads `getAccessType()` after its dynamic import, so it never mounts
  over a granted Calendar; with no module it falls back to the PIN card.
- `showLockPanel()` — the staff-PIN card. Collects four digits and hands them on, never storing or
  comparing a PIN. Warms the cold exchange with one GET as it appears; a failure clears the field,
  returns focus to it and applies `attemptBackoffMs`.
- `showMemberPanel(name, why?)` — the come-back card for a session that outlived its Firebase identity.
  Its "use the staff PIN instead" is a sign-out (`releaseDevicePush`, `clearSession`, reload), never a
  panel swap, because the drawer still carries that member's name and role pills.
- `hideLockPanel()` (takes whatever is up off the page, and the backoff timer with it) ·
  `resetUnlockFailures()` (on a grant) · `PIN_FIRST_HASH` (re-exported from `calendar-access-core.js`).
- Tested through `calendar-access.test.mjs` and `e2e/calendar-pin.spec.js`.

### `calendar-lock-slot.js`
The one place on the Calendar page where a card stands in for the grid — at most one at a time.
- `mountLockCard({ id, className, html, labelledBy })` — replaces whatever is up; falls back to `<body>`,
  because a front door with no card is worse than a misplaced one.
- `unmountLockCard()` — the only teardown; it also disarms the skeleton timer. `lockCardId()` — which
  card is up.
- `armSkeleton(ms)` / `showBootSkeleton()` — a data-free calendar shape while a slow decision runs. It
  never replaces the member's stored roster (`calendarSnapshot`).

### `calendar-snapshot.js`
The member's own roster, kept on the device so the Calendar shows it, labelled, while the sign-in
check runs (owner decision Oct 2026; `CALENDAR_DATA.md` 17). Storage only and synchronous; the rules
it keeps are in its header. Tested by `calendar-snapshot.test.mjs`.
- `saveSnapshotMonths(memberName, { 'YYYY-MM': records[] }, now?)` — keeps months the live read
  SETTLED, the member's own rows only, trimmed to `type`, `value`, `source`, `changedBy`, `replacedType`
  and `leaveYear`; an unchanged month is re-stamped after a day.
- `readSnapshot(memberName, now?)` / `snapshotMonth(memberName, year, month, now?)` — any refusal
  deletes the copy: another member, no name, an unreadable or old-shape copy, or nothing left within
  `MAX_AGE_MS` and the `MONTHS_BEFORE`/`MONTHS_AFTER` window.
- `clearSnapshot()` · `inWindow(key, now)` · `SNAPSHOT_VERSION`.
- **Never a source of truth:** never written into `rosterOverridesCache`, never `noteKnowledge`. Deleted
  by `clearSession()`, a PIN or failed grant, and access loss.

### `calendar-access-core.js`
The pure rules of Calendar access — no DOM, no Firebase, no storage — tested by
`calendar-access-core.test.mjs`. The header's three rules: named beats viewer, anything missing is
`none`, and no client file ever compares the PIN.
- `CALENDAR_VIEWER_UID` · `CALENDAR_VIEWER_CLAIM` · `PIN_LENGTH` · `PIN_FIRST_HASH` (`'#staff-pin'`, here so
  the Trains page can use it without the Calendar's cards).
- `decideAccess({ session, firebaseUser })` → `'named'|'viewer'|'none'`. Named needs a local session
  AND a restored, non-anonymous Firebase user whose email, if it has one, is this member's.
- `isViewerUser(user)` — uid match and non-anonymous; `session.js` uses it to decide which identity
  survives `reconcileExpiredIdentity`.
- `normalisePin` / `isCompletePin` — shape only. `classifyUnlockFailure` — the words a member reads
  (offline first; never "not recognised" after a correct PIN; no rate-limit figure). `attemptBackoffMs` —
  a UX brake, not a security control.
- `noticeAudienceAllows(audience, accessType)` — `'members'` (the default, and the answer for anything
  unrecognised), `'signed-out'` or `'everyone'`. A refused notice is left unflagged.
- `personalActionsAllowed({ accessType, sessionName, shownMember })` — may the day panel offer "Leave
  dates" or "Pay estimate"? Refused in viewer mode whatever the device remembers, and unless the
  calendar on screen is the signed-in member's own (`CALENDAR_DATA.md` 14).

### `calendar-overrides.js`
The Calendar's override cache and every read that fills it. The reasoning is beside each function;
`CALENDAR_DATA.md` 3–6, 16 and 18 are its invariants.
- `rosterOverridesCache` — a `Map` keyed `"memberName|YYYY-MM-DD"`.
- `fetchOverridesForRange(startStr, endStr)` — the authoritative server read. It reconciles each month
  slice only where no NEWER read has written it (`_monthSlices`, a test seam). A snapshot the offline
  cache answered is merged additively and thrown as `SERVED_FROM_CACHE` (carrying `painted`), so the
  month is recorded `cached` or `error` and released.
- `fetchOverridesForRangeFromCache(startStr, endStr, monthsWithRows?)` — phase 1: the local cache only,
  additive (never evicts), skipping months a server read owns; never throws.
- `ensureOverridesCached(year, month, renderFn)` — a no-op once the month is claimed; otherwise reads it,
  records what is now known, and calls back EVERY waiter when it settles (a caller arriving mid-read
  joins). A failure repaints once per claim, or it would be a fetch↔render loop.
- `getShiftTypesInMonth(member, year, month, snapshot?)` — the legend's set (SPARE, RDW, AL, SICK, OTHER)
  through the shared `resolveDayShift`; memoised, except for a month drawn from the stored copy.
- `monthKey(year, month)` · `releaseStaleMonths(maxAgeMs, now?)` (releases settled months older than
  that — never one in flight, nothing during the first read).
- `_initialFetchInProgress` (a live binding) · `setInitialFetchInProgress(v)` · `addFetchedMonths(keys)` ·
  `clearFetchedMonth(key)` (it also re-arms the failure repaint) — for `calendar-initial-fetch.js`.
- **The access gate.** `setOverrideAccess(granted)` — a grant is a fresh start (every claim cleared, the
  generation advanced); revoking clears nothing. `hasOverrideAccess()` · `setOverrideAccessLostHandler(fn)`
  (injected, so this module never imports the access layer) · `accessGeneration()` (a refusal from an
  earlier grant must not re-lock a newer one).
- This module's two reads are the cache's only writers, and both clear the month shift-type memo; a new
  writer must clear it too, or the legend goes stale.

### `calendar-legend.js`
The month legend's two questions: which keys apply, and whether the legend shows at all. It imports
nothing (every collaborator is injected) and is tested by `calendar-legend.test.mjs`; its header lists
what an edit can break.
- `legendVisibility({ types, isDispatcher, displayMonth, easterMonth })` → element id → visible, for the
  five row-2 keys, their row, nights, Christmas and Easter (a computed month, never April).
- `onDispatcherRosterIn(member, year, month, resolve)` — the Night key, decided per DAY, so a scheduled
  move onto or off Dispatch moves it.
- `legendShown(display, isTeamViewMode)` → `'render'|'hide'|'stand-down'`. A withheld month hides it,
  `'stale'` shows it, and `'stand-down'` is not `'hide'`: Team View owns the element, so write nothing.
- `createLegend(deps)` → `{ update }`. The shown/hidden answer belongs to the UPDATE, not to a render,
  because a swipe commit updates the legend without rendering (`e2e/calendar.spec.js`).

### `calendar-data-state.js`
What the Calendar KNOWS about each month's overrides, and so what it may show. Pure with no imports,
tested by `calendar-data-state.test.mjs`. The invariant — cache absence is not evidence that no override
exists — and the four states are argued in the header (`CALENDAR_DATA.md` 1–2).
- `noteKnowledge(keys, k)` — monotonic: a late `cached` never walks back an `authoritative`.
- `forget(keys?)` — the one deliberate downgrade (access lost; a Try again).
- `knowledgeOf(key)` / `worstKnowledge(keys)` — a Team View week is as known as its less-known month, and
  an empty set is `unknown`.
- `decideDisplay(knowledge)` → `'render'|'stale'|'loading'|'unavailable'` · `showsRoster(display)` (a
  real roster is on screen for `render` and `stale`).
- `_reset()` — test seam.
- Written by `calendar-overrides.js` and `calendar-initial-fetch.js`; read by the renderer, Team View, the
  legend and the page-ready metric. A `cached` month draws its grid with no banner — the sync chip is the
  running commentary.

### `overtime-app.js` / `overtime-boot.js` / `overtime-data.js` / `overtime-format.js` / `overtime-clock.js` / `overtime-tips.js`
The Overtime availability page. **Paused:** `CONFIG.OVERTIME_ENABLED` is false, so the page says so to
everyone and the endpoints are not exported (`OVERTIME_AVAILABILITY.md` → Paused); the code and its
tests stay live. Feature design: `OVERTIME_AVAILABILITY.md`. Server: `functions/overtime.js`,
`functions/overtime-core.js`.

**`overtime-app.js`** — the coordinator: the access gate (a courtesy; the server is the boundary), the
member's form, the reviewer's workspace (`overtime-review-controller.js`), and a tab strip drawn only
once both surfaces are known to exist. `init()` is invoked by **`overtime-boot.js`** (CSP forbids an
inline call). Its header argues the two rules to keep: the planning horizon is drawn from the CALENDAR,
not Firestore, because "nobody created the window" leaves no trace; and only the newest read of a week
may paint. `wireDeadlineResync` re-reads state when the page becomes visible near a deadline and
rebuilds a form only when its phase has closed it. Loading, empty and failed are three different
screens.

**`overtime-data.js`** — every endpoint call (a fresh token, a timeout above the server's own) and the
corrected clock: `getMyOvertimeState` · `getOvertimeManagerOverview` · `createOvertimeWindow` ·
`withdrawOvertimeParticipant` · `submitOvertimeAvailability` · `loadWeekDetail` (the reviewer's direct
read of a week, revisions included; refuses a cache-answered snapshot) · `correctedNow()` (meaningful
once `getMyOvertimeState` has answered) · `myStateReadAt()` (the server's instant of that answer, so a
deadline that passed while the page was hidden is noticed).

**`overtime-clock.js`** — the decisions a member's own clock may make about a deadline, under one rule:
**the client never refuses what the server would accept.** `SUBMIT_GRACE_MS` · `DEADLINE_SYNC_WINDOW_MS`
· `clockOffset(serverNow, tSend, tReceive)` (round trip removed) · `submitDisposition` (inside the grace
band it answers `check-with-server`, never `closed`) · `shouldResyncClock(now, deadlines, readAt?)` ·
`canRestoreNow(initialDeadlineAt, withdrawnAtMs, nowMs, finalDeadlineAt?)` (true when it cannot tell,
false for a closed week; checked against its server twin by `overtime-parity.test.mjs`). It imports
nothing; `overtime-format.js` re-exports all six.

**`overtime-format.js`** — the pure words and time arithmetic both sides share; keep it Node-loadable.
*Dates*, in Europe/London: `shortDate` · `longDate` · `weekLabel` · `weekSpan` · `printedLabel` (carries
the year: it stamps paper) · `asAtLine` · `declaredAgo` · `receiptLine`. *The form's rules:*
`dayUnfinished` / `unfinishedDates` (the count and the day an error walks to come from one list) ·
`reconcileVerdict` · `conflictIsOurs` · `modesFor` (shortcuts only where an authoritative duty time
exists; one both-sides answer a day; an overnight duty withholds `after` and `before_after`) ·
`offersFullTwelve` · `shiftSpanMinutes` · `sameAnswer` · `answerAnchorStale` · `submitFailureCopy`.
*Answers:* `answerCopy` · `answerTone` · `isUnavailable` · `isAvailableAnswer` (not `!isUnavailable` —
they differ on a missing day) · `rosterBadge` · `deriveHistory`. *Reviewer:* `rowStateCopy` ·
`countsCopy` (never drops "no response") · `weekSummary` · `weekAvailabilitySummary` (the clipboard
text; every section named, an empty one says "nobody") · `reminderLine` · `isWithdrawn` / `withdrawnLine`
(the server holds a twin of the first; `overtime-parity.test.mjs` checks the copies agree AND are right).
It re-exports `deadlineLabel`, `phaseCopy`, `phaseChip`, `phaseTone` and `deadlineLines` from
`overtime-phase.js`, and the six clock exports.

**`overtime-tips.js`** — `CARD_TIPS` for the page's `?` panels, one panel per audience. Read them when
behaviour changes: prose about a feature fails no test.

### `overtime-form.js` / `overtime-roster.js`
The member's side of the Overtime page (paused — see the entry above). `overtime-form.js` renders one
week's seven-day form and owns the submit lifecycle; `overtime-roster.js` supplies the roster each day is
answered against. The rules they obey live in `overtime-format.js`, `overtime-answer.js` and on the
server.
- `renderWeekForm(host, win, memberName, { onSaved })` → `{ isDirty, setPhase, isSubmitting }` — the
  coordinator uses the handle to absorb a phase move without destroying a half-filled form, to ask before
  discarding answers, and to hold a release's reload. A draft lives in memory, never in `localStorage`.
- `loadRosterContext(memberName, dates)` — the member's own seven days, **scoped by
  `where('memberName','==',…)`**: the rules would return everyone's without it. `authoritative` or
  `error`, never `cached`, because the options it generates get submitted.
- `loadRosterForMembers(memberNames, dates)` — the reviewer's one unfiltered read of a week; never
  called from the member's side. A failed roster read does not fail the week (`rosterKnown`).
- `rosterBadge` — re-exported from `overtime-format.js`, where the reviewer's rows can reach it.
- **Rules the headers argue, which an edit must not undo:** no default answer and no copy from last
  week; Submit refuses on press and names the first unanswered day rather than sitting disabled; the
  client never refuses near a deadline; a timeout is reconciled, not reported — three outcomes, with the
  button disabled until the re-read decides; `nextDay` is derived from the two times; a chosen option is
  labelled from the ANSWER and an unchosen one from the roster, and `answerAnchorStale` says when the
  roster has moved; re-pressing the chosen mode keeps the saved answer; a saved legacy mode still
  renders; an unknown roster removes the shortcuts rather than guessing them.
- `overtime-roster.js` is deliberately not `calendar-overrides.js` (its header says why); it shares the
  display ladder (`resolveDayShift`) and the knowledge vocabulary, nothing else.
- Tested by `overtime-form.test.mjs` (the ladder below a timeout), `overtime-roster.test.mjs` (the scope
  clause, against a fake that applies the constraints it is given) and `e2e/overtime.spec.js` (including a
  chosen pill's computed colour). The day rows' state grammar is in `overtime.css`. A day's answer is about
  a duty STARTING that day: `OVERTIME_AVAILABILITY.md`.

### `links-import.js`
Turns somebody else's roster proposal, pasted as text, into a design the workspace can hold — the pure
half; the panel is in `links-design-library.js`. Tested by `links-import.test.mjs`.
- `parseCell` · `parseGrid` · `parseDesignImport` · `summariseImport` · `MAX_IMPORT_NAME`.
- **A trust boundary** (modelled on `paycalc-transfer.js`'s `validateBackup`): text becomes a design or a
  refusal, never a half-design, and an unreadable cell is refused by name, never defaulted to a rest day.
  Warnings are shown before the save. It computes no hours, coverage or verdict — the workspace's panels
  assess what it produces. The header has the rest.

### `overtime-manager.js`
The reviewer's workspace for one selected week — By day, Awaiting, the participant panels and the print
sheet — rendered from data handed in (paused — see the Overtime entry). It performs no reads
(`loadWeekDetail` in `overtime-data.js` does) and imports only DOM-free modules, so
`overtime-manager.test.mjs` drives it with a two-line fake DOM.
- `renderWeekDetail(host, win, data, { dates, now, grade?, onGrade?, day?, onDay?, onRefresh?, onAsk? })`
  — the single export; the surface is a pure function of `(data, state)`.
- **Rules its header and comments argue:** three sections per date — Available, Not available, No
  response — that never merge, an empty one still showing its heading; GRADE re-renders every count, DAY
  only hides rows; the grade is the reviewer's and survives a week switch (`overtime-review-controller.js`
  holds it), the day does not; withdrawn members leave the population BEFORE anything is counted; a
  count states a number, never a verdict (only zero is marked); an answer shows its age and what changed
  since the initial deadline; a member added after the freeze is marked, with a tolerance
  (`ADDED_LATER_TOLERANCE_MS`) so batch jitter marks nobody; `answerTone` gives the three sections three
  colours.
- **Participants:** `Stop asking` sits in `Who is being asked`, on every row; `Ask again` is refused per
  person once the initial deadline has passed (`canRestoreNow`); a CLOSED week's panels go read-only and
  past tense.
- **Print:** a call sheet that names its week, states its age (`asAtLine`), carries the grade scope
  (`.ot-print-scope`) and all seven days, with outlined chips (`overtime.css`).

### `functions/overtime.js`
The Overtime endpoints and their Firestore orchestration — the boundary (auth, transactions, batches,
HTTP); every rule is in `functions/overtime-core.js`. A factory, `buildOvertimeEndpoints(deps)`, that
`functions/index.js` calls; while Overtime is paused it exports only the purge (`OVERTIME_AVAILABILITY.md`
→ Paused). Tested by `overtime-endpoints.test.mjs`, which executes every handler.
- `createOvertimeWindow` — reviewer; `{ weekEnding, dryRun }` runs one code path with only the write
  conditional. One batch, refused rather than half-created; a duplicate returns the existing window.
- `autoCreateOvertimeWindows` — scheduled daily at `SCHEDULER_HOUR_LONDON` (London): creates every horizon
  week that has none through the same `createWindow`, stands down on a failed listing, and tops up every
  open window on every run.
- `getOvertimeManagerOverview` — reviewer: the planning horizon from the CALENDAR, then matched against
  Firestore, with derived counts and the stored milestones.
- `getMyOvertimeState` — the member's only read path; returns `serverNow`. A reviewer correctly receives
  `windows: []`, and a withdrawn member's week is dropped.
- `submitOvertimeAvailability` — the only member mutation, in one transaction. A no-op still records
  `lastMutationId`, a 409 carries the winning id, and `withdrawn` and `not-a-participant` are distinct
  refusals.
- `withdrawOvertimeParticipant` — reviewer: a flag, never a delete; restoring deletes the fields; a
  CLOSED week refuses.
- `purgeExpiredOvertimeWindows` — scheduled daily, an hour before the creator: revisions → heads →
  participants → parent, the parent LAST. It only counts until it arms itself (`purgeArmedAt`,
  `overtime-core.js`).
- Push: `notifyAsked` (one notice per member per run) and `sendInitialDeadlineReminders` (non-responders,
  on the deadline's morning) use `sendTargetedPush`, never `fanOutPush`; the `notify` dep is the test seam.
- **Identity is the token, never the body** (`memberNameFromClaims`, verified with `checkRevoked`).
  **Retention is enforced in the read endpoints**, not in the rules.

### `functions/doc-url-core.js`
Who may be handed a short-lived document URL, for which document, and for how long. No I/O and nothing
from `functions/node_modules`, so it runs in `test:hygiene`. Used by `functions/documents.js`
(`getDocumentUrl`); the design and the options refused: `AUTH_PLAN.md` §5.
- `DOC_KINDS` · `kindFromBody` · `resolveKind` — the caller names a KIND from a frozen allowlist, never a
  path: an endpoint that signs what it is told is an arbitrary read of the bucket.
- `mayReceiveDocumentUrl(claims)` — MIRRORS `firestore.rules` for `huddles`, `circulars` and
  `newsletters`, pinned to the rules text in both directions by `doc-url-core.test.mjs`; it may never be
  more permissive.
- `isSignablePathForKind(kind, path)` — binds the resolved path to that kind's own collection, because the
  Admin Storage API bypasses `storage.rules`.
- `SIGNED_URL_TTL_MS` · `signedUrlExpiry(nowMs)` — sized to outlive the Office viewer's server-side fetch,
  not just a tap.

### `functions/member-identity.js`
Which member a verified ID token speaks for, or none — the server copy of `isMember()` in
`firestore.rules`. Both are run against every roster name (`member-identity.test.mjs` and the rules suite).
- `memberNameFromClaims(claims)` → the name or `null`. A name is believed only for a PASSWORD sign-in
  whose email is the one that name derives to (`nameToEmail`) and which carries the server-set `member`
  claim. It returns the NAME, not a boolean, so no caller can check the binding and then read the
  unchecked field. Used by `functions/overtime.js`, `functions/doc-url-core.js` and
  `functions/documents.js`.
- `mustReclaim(user)` — an existing account at a roster email with NO custom claim must be taken back
  before `setupRosterAuth` stamps it (`functions/auth-endpoints.js`).

### `functions/london-clock.js`
An ISO calendar date, and the instant it names in London — machinery, not Overtime policy. **It requires
nothing, and that is asserted** (`london-clock.test.mjs`), which is what keeps `overtime-core.test.mjs`
in `test:hygiene`.
- `londonOffsetMinutes(utcMs)` (read from `Intl`, so the runtime's tz database is the authority) ·
  `londonTimestamp(iso, hour)` · `londonIsoDate(utcMs)` · `isValidIsoDate(iso)` · `isoDayOfWeek(iso)` ·
  `addDays(iso, days)`.
- The hours the depot chose (`londonNoonTimestamp`, `londonMidnightTimestamp`, `lastSchedulerRun`) stay
  with `overtime-core.js`, which re-exports these. The line: if changing it would change what the app
  promises somebody, it is not clock code.

### `functions/overtime-core.js`
Every rule Overtime has, with no I/O and no clock of its own (anything that needs "now" is given it).
It requires only `./london-clock`, so `overtime-core.test.mjs` runs in `test:hygiene`; the header names the
five things it protects. Feature design: `OVERTIME_AVAILABILITY.md`.
- **Policy:** `POLICY_VERSION` (stamped on every window) · `MILESTONE_OFFSETS` · `DEADLINE_HOUR_LONDON` ·
  `SCHEDULER_HOUR_LONDON` (must equal the creator's cron hour) · `ANSWERABLE_WEEKS` (the product decision)
  · `PLANNING_WEEKS` (arithmetic from it) · `MAX_PARTICIPANTS_PER_WINDOW` (one batch) · `AUDIENCES` ·
  `REMINDER_LOOKAHEAD_MS` · `PURGE_ARMS_AT` / `purgeArmedAt(nowMs)` (the purge only counts until then).
- **The London clock** — the feature's highest-risk code: one hour wide and silent when wrong.
  `londonNoonTimestamp` (the deadline) · `londonMidnightTimestamp` (retention), and the re-exported
  `londonOffsetMinutes` · `londonTimestamp` · `londonIsoDate` · `isValidIsoDate` · `isoDayOfWeek` · `addDays`.
  The two-pass solve in `londonTimestamp` is redundant at 00:00 and 12:00 and is kept for the next hour
  somebody adds.
- **Weeks and phases:** `isSaturday` · `weekDates` · `weekEndingFor` · `deriveMilestones` (once, at
  creation, and stored) · `phaseFor` / `isOpenPhase` (half-open: 12:00:00 belongs to the later phase) ·
  `validateWeekEnding` · `planningWeekEndings` · `weeksNeedingWindows` (the same filter as the Create
  button) · `windowRowState` (a missed week stays visible until its Saturday) · `lastSchedulerRun`.
- **Who was asked:** `isEligibleForWeek` · `selectParticipants` (narrows the generated list, never widens
  it; a `restricted` audience with no names selects nobody) · `canChangeParticipation` ·
  `canRestoreParticipant` · `isWithdrawn` · `isSafeDocId`.
- **Answers:** `AVAILABILITY_MODES` · `REQUEST_DAY_FIELDS` · `OPTIONAL_DAY_FIELDS` · `normaliseDay` /
  `normaliseDays` (refuse a partial week or an unknown field; derive `nextDay`) · `daysEqual` ·
  `decideSubmission(head, days, ifRevision)` → `create`, `append`, `noop` or `conflict` — **the no-op check
  comes before the conflict check**, so a timeout retry succeeds · `deriveHistory` · `revisionId`.
- **Notices:** `reminderDue` · `londonDeadlineLabel` · `askedNotice` · `reminderNotice` (the words are
  asserted through the real `buildPushPayload`).
- **Nothing here manufactures an answer:** no response is unknown, never "not available".

### `calendar-notices.js`
The Calendar page's one-time notices, in one place — a `/new-notice` for `index.html` lands here. The
notice HTML stays in `index.html`; which notices are wired and live: CLAUDE.md → "Current notices".
- `initCalendarNotices({ after })` — called once by `calendar-app.js`. Every notice waits for
  `calendarAccessReady` AND `after` (the forced set-password step), then 1,500 ms past the Huddle
  auto-open, and opens through `openNoticeIfClear`, never `open()`.
- **Every notice declares an audience**, checked after access by `_openWhenAudienceAllows(lb, audience,
  alsoWhen?, whenDecided?)` against `noticeAudienceAllows`; a refused notice is left unflagged. `alsoWhen`
  adds a condition only knowable then (whose Pay Calculator this is — `gradeForRole`); `whenDecided` stands
  a competing strip down (`yieldToInstallNotice`).
- Each notice is its own IIFE: an early `return` in a plain block would leave the function and silence
  every later notice. The order comes from `FOLLOWS` flags read at wiring time, so two notices never open on one load. A notice
  with a `STARTS` date is left unflagged before it, and an end is a DATE (`isNoticeExpired(day, 1)`), not a
  count from posting.
- No live notice declares `'signed-out'`, so the positive direction of the audience gate rests on a
  static contract in `calendar-notices.test.mjs` until one does (the header says more).

### `calendar-member.js`
Which member the Calendar shows, and the member picker.
- `getSelectedMemberIndex()` — the saved name, else this page's pick, else the signed-in member, else the
  default. A saved name no longer on the roster sets the stale flag and prefers the signed-in member over
  the default, so the picker and the grid name the same person.
- `takeStaleMemberName()` — one-shot; `renderCalendar` (or the Team View boot) shows the banner.
- `getCurrentMember()` · `getDefaultMemberIndex()` (`CONFIG.DEFAULT_MEMBER_NAME`).
- `saveSelectedMember(index)` — stores the name and keeps an in-memory copy, so a pick survives an iOS
  private-mode write that silently fails; `_resetSelectionFallbackForTest()` clears it.
- `isFirstRun()` — true only for a brand-new visitor (no saved member at load, none now, no session, no
  pick): the Calendar asks them to choose rather than showing somebody else's roster.
- `populateTeamMemberDropdown()` — grouped by role when more than one is present; a first run leads with
  "— Choose your name —". `validateTeamMembers()` → error strings.

### `calendar-renderer.js`
Builds the month grid and each day cell for `index.html`, and holds the pure helpers the day panel and
the tooltip share. The reasoning is beside each function.
- `buildCalendarContainer(month, year, { onDayDetail?, onRetryMonth?, checking?, member?, snapshot? })` —
  **may return a container with NO grid**: unless the month's read has settled it draws a wait or failure
  panel (`calendar-data-state.js`; `data-override-state` records the decision). The header is always
  built — it carries the month label and the sync chip. A month still loading on the member's own
  calendar is drawn from their stored copy, labelled "Checking for changes…"; a cached month is labelled
  "Saved copy — couldn't check for changes" with Try again, except while the first read runs (`checking`).
  Callers pass no `onRetryMonth` during that read. One delegated click opens the day panel on every
  pointer type.
- `setSnapshotSource(fn)` — where a loading month's stored copy comes from (set by `calendar-app.js`).
- `createCalendarHeader(...)` · `createDayCell(...)` · `dayCellParts(...)` → `{ forced, badgeWord,
  timeShown }` · `dayCellName({...})` — the cell and its accessible name come from one answer, and the
  name contains what the cell shows (WCAG 2.5.3) · `getSwipeDirection(...)`.
- For the day panel: `shiftWords(shift, member, derivedRdw, alwaysTime?)` (one ladder for the shift and
  the base it replaced; an unreadable value reads "Not recognised: …", never a Late shift) ·
  `splitShiftLine(text)` (keeps a time from breaking at its hyphen) · `dayMarkers({...})` (the cell's own
  icons; one source for the panel's chips and the tooltip's sentence) · `weekContext(member, date)` (`''`
  for a fixed line; resolved per date) · `changeProvenance(source, changedBy)` ("From the weekly roster"
  or "Last saved by …", never a claim of authorship).
- A cell carries raw `data-detail-*` values, never markup. "As rostered" is written only on a settled
  month, and never before the member's start date. Every cell resolves through `resolveDayShift`
  (`christmas-leave.js`).

### `calendar-huddle-viewer.js`
The Daily Huddle viewer on the Calendar — a full-bleed panel, not a lightbox (one of `overlay.js`'s three
exceptions). It opens only through the `#huddle` hash, from the drawer link and notification taps alike.
- `initHuddleViewer({ authReady, docAccess })` — subscribes to the latest Huddle
  (`subscribeToLatestHuddle`) only while the document gate is open (`calendar-doc-access.js`), drops the
  data when it shuts, and holds a tap made while locked until access arrives. A tap with nothing to show
  is answered ("No Daily Huddle has been uploaded yet", or "Couldn't load" with Try again); closing the
  message disarms the pending tap.
- **Two render paths — do not unify.** `htmlContent` (a DOCX converted server-side) renders inline,
  sanitised by the lazily loaded DOMPurify (`purify.es.mjs`; only `colspan` and `rowspan`, never `style`);
  a PDF, or a failed conversion, shows an in-overlay "📄 Open Huddle" button, whose tap is the gesture
  `window.open` needs, opening a short-lived URL minted BEFORE the click. Rationale:
  OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".
- `wrapTables(root)` — gives each table its own horizontal scroll box and marks the cells
  `firstColumnMask` says are really in column 1 (`.huddle-shift-col`). The CSS must also let the table be
  wide (`index.css`, `#huddleViewerBody table`).
- `_triggerAutoOpen(huddle)` — the internal open, a test seam.

### `huddle-table-grid.js`
Which cells of a Huddle table are physically in column 1 — what the sticky job column is selected by,
because `td:first-child` is not that answer in a table with rowspans. Pure with no imports; the header
holds the three rules an edit can break.
- `firstColumnMask(rows, { groupStarts? })` — one array per row of the cells that row WRITES, returned
  with `true` where a cell starts at column 0: the browser's own slot assignment. A row group ends every
  open span (`groupStarts`), `rowspan="0"` runs to the end of its group, and the answer is per cell.
- Only caller: `wrapTables` in `calendar-huddle-viewer.js`. Tested by `huddle-table-grid.test.mjs` and
  `e2e/pages.spec.js`.

### `calendar-doc-viewer.js`
The in-app viewer for the Weekly Retail Circular and the Marylebone Newsletter, reached only from a
`#circular` or `#newsletter` notification tap. A tap carries no user activation, so the viewer shows an
Open button — the gesture `window.open` needs — rather than opening the file itself. The drawer's links
open directly instead (`nav-panel.js`).
- `initDocViewer({ authReady, accessDecided, docAccess })` — the only export. Reads the latest document
  once per open (no subscription) and mints a short-lived URL (`fetchSignedDocumentUrl`) BEFORE the click,
  opening it through `resolveDocumentOpenUrl` with the stored URL as the fallback; a `.docx` goes through
  the Office Online viewer.
- A tap while the document gate is shut issues no read: it says what unlocks the document and is
  finished when access arrives. Until `accessDecided` settles, a shut gate reads "Loading…", not "enter
  the PIN".
- Every wait is bounded (`DOC_AUTH_WAIT_MS`, `DOC_FETCH_TIMEOUT_MS`) and a failure carries a focused
  "↻ Try again"; `_openSeq` discards a superseded or closed open. Tested by `calendar-doc-viewer.test.mjs`.

### `calendar-team-view.js`
Team Week View — the grade-wide week grid toggled from the Calendar header.
- `initTeamView({...deps})` → `{ toggleTeamView, isTeamViewMode, restoreTeamView, jumpToCurrentWeek,
  refreshFromCache, refetchShownWeek, isGridShown, isGridConfirmed }`. The coordinator injects the
  override cache, the shared `ensureOverridesCached`, member and render callbacks, and the history hooks.
- **Its overrides come from the SHARED month fetch**, never a fetcher of its own: a second authoritative
  reconciler racing the first evicts what it loaded (`CALENDAR_DATA.md` 6; `ensureTeamWeekCached` says
  why). `refreshFromCache` repaints from the cache with no read; `refetchShownWeek` re-reads released
  months when the page comes back into view.
- A week is only as known as its less-known month (`worstKnowledge`): an unknown or failed week shows a
  "Checking" or "Couldn't check" panel with Try again, and the chrome stays. A failed REFRESH keeps the
  last-good grid with no indicator, by decision (CLAUDE.md → Team Week View).
- Cells resolve through `resolveDayShift` (`christmas-leave.js`), the Calendar's own ladder.
- `weekStartForMonth(displayed, today)` — the week it opens on: today's on the current month, otherwise
  the week holding the 1st. Tested by `team-week-start.test.mjs`; the wiring (`getDisplayedMonth`) by
  `e2e/calendar.spec.js`.

### `admin-app.js`
Coordinator for `admin.html`: sign-in and session, the shared DOM handles, and the wiring between the
admin modules. `init()` is invoked by `admin-boot.js`.
- `alMember`, `sickMember`, `syncMemberDisplay` and `syncSickMemberDisplay` are declared in `init()` ABOVE
  the `fieldMember` change handler, which uses them before `initALSection()`/`initSickSection()` run. Do
  not move them into those init functions.
- The `fieldMember` and `fieldDate` handlers keep the AL, Absence and Change a Shift cards on one member
  (`_followMember`); "Recording for <name>" (`_syncMemberFor`) shows to managers and the admin only.
- The AL over-entitlement confirm bar calls `triggerConfirmedALSave()` (`admin-al.js`). The recorded-dates
  list is `admin-booked-periods.js`; this file wires it (`updateALBookedBox`, `updateSickBookedBox`,
  `deletePeriodOverrides`).
- Not here: the AL and absence save logic, the week grid, override list and bulk bar
  (`admin-overrides.js`), the roster upload, Huddle upload and account set-up (Operations), and the
  Notifications card (Settings).

### `settings-status.js`
What each Settings card's state MEANS — its chip, whether it opens itself, and the summary line at the
top. Pure and read-free, like `operations-attention.js`: each card reports as its own data lands, so the
summary cannot disagree with the card. Tested by `settings-status.test.mjs` (organised by false
reassurance and false alarm); the wiring by `e2e/settings.spec.js`.
- `CARD_ORDER` — password, work email, install, notifications: declared, so the to-do list does not
  reshuffle between loads. Pay data is deliberately absent; it has no wrong state.
- `shouldOpen(state)` — `action`, `blocked` and `error` open their card; `ok`, `unknown` and `n/a` do not.
- `summarise(states)` → `{ tone, headline, items }`. **Silence is not success:** a card that has not
  reported is `unknown`, which outranks every answer, and a failed read is `error` — never "all set".

### `settings-app.js`
Coordinator for `settings.html`, for every signed-in member. `init()` is invoked by `settings-boot.js`.
- The session key is shared with every page, so a member signed in elsewhere arrives signed in. Signed
  out, it mounts the shared sign-in overlay, whose `onSuccess` runs `initAuthorised()` in place (a reload
  only if that fails). The drawer is wired in `initAuthorised()`, not at module scope — the comment above
  `wireNavPanel` says why.
- `initApp()` wires the cards — Work email, Password, Notifications (`initHuddleNotifications`,
  `huddle.js`), Install and Pay Calculator Data — and each reports through `reportSetting` to the summary
  (`settings-status.js`).
- The Password card: `getPasswordStatus` drives the chip; a save validates with `validateNewPassword`
  (`auth-identity.js`, shared with `password-force.js`), re-authenticates, then writes with `setOwnPassword`
  under `settleOrTimeout`, so a slow write is never reported as a failure. A release's reload waits while
  a password save or any other write is in flight.

### `overlay.js`
The shared overlay plumbing: the scroll lock, Android Back, the keyboard rules, the canonical lightbox,
the in-app dialogs and the collapsible card. Imported by most pages and many feature modules.

**The canonical lifecycle.** Every `.lb-overlay` lightbox is built with `createLightbox`, never
hand-written in a page module. It owns focus save and restore, `.visible` → rAF → `.open`, the scroll
lock, Android Back, Escape, the Tab trap, backdrop and close-button close, and the **mandatory 500 ms
`transitionend` fallback** (iOS suppresses `transitionend` on a backgrounded tab; reduced motion finishes
synchronously). Close controls are `<button class="lb-close">`, never a `<span>`.

**Three exceptions, and the first two are one decision.** The drawer's `#navComingSoonLightbox` and
`#navNoticesLightbox` (App Notices) belong to `nav-panel.js` alone and hand-roll the lifecycle because
they share the drawer's history entry: never migrate either to `createLightbox`. Both are injected at
runtime, so `overlay-parity.test.mjs`'s scan of the served HTML cannot see them. The third is
`#huddleViewer`, a full-bleed panel with no backdrop close.

- `createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose, afterClose })` →
  `{ open, close }`. `close()` returns a Promise that resolves, with `afterClose`, once the close has
  LANDED — the fade done and its Back echo arrived. To act on a close, await it rather than a timer.
- `dismissOverlay(el, { onKey, focusReturn, afterClose, backHandler })` — the close routine, exported for
  the rare overlay built without `createLightbox`.
- `_pushOverlayState(handler)` / `_clearOverlayHistory(handler)` — Android Back on a LIFO stack: nested
  overlays each get an entry and Back closes only the topmost (`overlay-history.test.mjs`).
  `whenHistorySettled(fn)` runs `fn` once no Back echo of ours is outstanding, so a dialog opened from a
  close is not popped by it. `registerPopInterceptor(fn)` / `suppressNextPop()` serve an overlay with its
  own history (only the drawer).
- **Only the topmost overlay reacts to the keyboard:** `_isTopOverlay(close)` reads the Back stack and
  **fails open**. Its wiring is proved only by `e2e/links.spec.js` — delete the guard and every unit test
  stays green. `trapFocus(container, e)` wraps Tab, including from the panel itself.
- **`openNoticeIfClear(lightbox)`** — the ONLY way a one-time notice opens (the `new-notice` skill): false
  while `lb-open` is set, so the notice stays unflagged and takes its turn next load.
- `confirmDialog({ message, title?, confirmLabel?, cancelLabel?, danger?, onConfirm? })` →
  `Promise<boolean>` and `promptDialog({...})` → `Promise<string|null>` — app-drawn `confirm()` and
  `prompt()`. Async, so never inside a capture-phase navigation guard or a `beforeunload`; `onConfirm`
  runs inside the tap, for work that needs the gesture.
- `lockBodyScroll()` / `unlockBodyScroll()` — depth-counted and iOS-safe.
- `initCardCollapse(headerId, bodyId, chevronId, onToggle)` — the chevron is the focusable toggle, never
  a header that holds another button (WCAG `nested-interactive`).
- `openCardNamedByHash(cardId, bodyId, toggleId)` → boolean — opens the collapsed card the URL fragment
  names and keeps it in view while the page grows, until a real gesture. Call after `initCardCollapse`.

### `about-lightbox.js`
The shared About panel (`#iconLightbox`) on every app page.
- `initAboutLightbox({ appLabel, bugLinkId, getUserName, onOpen, printFn })` → `{ open, close }` or null —
  the version, the update status (`hasPendingUpdate`), the bug-report mailto, and the optional print
  button (through `print-guard.js`). **Store `.open`, never the object**, in the page's
  `openAboutLightbox`, so the drawer logo can open it.
- `wireHeaderLogo(onActivate?)` — the sub-page header logo's back-to-calendar wiring, idempotent; a page
  with unsaved work passes its own confirm-then-go. It is the only module allowed to wire the logo
  (`page-contract-parity.test.mjs`). The Calendar's header logo opens About instead.

### `tips-lightbox.js`
The shared per-card Tips panel (`#tipsLightbox`); each page keeps only its `CARD_TIPS` data.
- `initTipsLightbox(CARD_TIPS, { getIsAdmin })` — wires every `.btn-card-tips`, filters `adminOnly` and
  `staffOnly` entries at open time, names the dialog after the card, and runs the canonical lifecycle.
  The content shape is in the module header, pinned by `tips-content.test.mjs`.

### `login-overlay.js`
The one sign-in card for every protected page: every page signs in on the spot and none redirects
elsewhere to authenticate. It injects its own markup. Per-page ACCESS (admin-only Operations,
designer-only Links) stays with each coordinator, after sign-in.
- `initLoginOverlay({ pageLabel, onSuccess, host?, alternative?, notice?, presetName? })` — call only when
  signed out. By default a fixed modal (scroll lock, focus trap, Escape, "← Back to roster"); `host` mounts
  the SAME card inline with none of those (the Calendar's front door, `calendar-lock-cards.js`), and
  `alternative` replaces the back link. `notice` goes into the card's status line after the card is in
  the tree. `presetName` pre-selects grade and name through `getMembersForGrade`, dispatching `input`,
  and focuses the password. The typed password goes straight to `ensureNamedSession`: the server is the
  arbiter, and only a `credential` failure counts towards the three-strike client lockout. On success it
  writes the one-shot set-password marker (`PW_FORCE_PENDING_PREFIX`) and calls `onSuccess(name)`.
- `runNamedSignIn(deps)` — the DOM-free sign-in core (`login-overlay.test.mjs`). It time-boxes
  `ensureNamedSession` and saves the local session ONLY once auth genuinely resolves; otherwise it returns
  `{ ok: false, kind, error }`, `kind` being `timeout`, `ratelimit`, `transient`, `credential` or `storage`.
  A failure clears any local session except this member's own (`keepsLocalSession`). The history is
  LOGIN_INCIDENT.md.
- `dismissLoginOverlay()` — removes the overlay and unlocks scroll; safe to call unconditionally on a
  coordinator's authorised path, which runs in place.
- While a sign-in is in flight the back link is disabled and the status line escalates; `primeAuth()`
  warms Firebase Auth as the card mounts.
- **The reset request:** "Can't get in? Ask the admin to reset your password" is always on the card; two
  `credential` failures only raise its emphasis, and a change of name or a sign-in clears its status. It
  resets nothing — see the reset-request queue below.
- Importers: grep for it — the protected pages, `page-session.js`, and `calendar-lock-cards.js` (dynamic).

### `sw-register.js`
Service-worker registration and the update lifecycle, shared by every app page. The reasoning is beside
each branch.
- `registerServiceWorker({ beforeReload, bfcache, deferWhileVisible, isBusy })` — registers, activates a
  waiting worker, checks hourly while visible, and reloads on `controllerchange` (or calls
  `beforeReload`). **First-install guard:** `suppressNextClaim` is true only with no prior registration AND
  no controller, because keying on the controller alone misreads a hard reload; the listener is attached
  BEFORE `register()` and is never `{ once: true }`, so a declined reload still hears the next update.
  `deferWhileVisible` (the Calendar only) holds the reload until the page is hidden. `isBusy` answers a
  notification tap's `myb-busy?`, so a busy page is asked rather than navigated.
- `reloadForUpdate(reload?)` · `reloadWhileHidden(reload?)` · `reloadWhenNotBusy(isBusy, reload?)` — the
  three ways a release reloads; each stamps the release marker `perf-reporter.js` reads, at the moment
  the reload actually happens.
- `hasPendingUpdate()` — a newer release has claimed the page and its reload is being held (the About
  panel's "Update ready").
- `lazyImport(load)` — a lazy `import()` that reloads onto a newer release if it fails after one has
  claimed the page. Calendar-only callers, because a reload elsewhere could lose work.
- `_resetForTest()` — test seam. Tested by `sw-register.test.mjs`.
- Per page: the Calendar defers while visible, then `reloadWhileHidden`; Admin, Settings, Operations and
  Overtime use `reloadWhenNotBusy` with their own busy test; Links holds an update while a write is
  unconfirmed and otherwise asks when the design is dirty; Pay, Trains and New link take the default.

### `splash-watchdog.js`
A CLASSIC (non-module) recovery script for `index.html`, loaded with `<script defer>` so it runs even when
the ES-module graph fails to load. No imports or exports; guarded on `document`, so importing it in a test
does nothing.
- It watches the PAGE, not the splash. After `TIMEOUT_MS`, if the splash is still up — or has gone with
  nothing usable in its place (a lock card, a visible error banner, or a filled `#calendarDisplay`; the
  boot skeleton does not count) — it reloads once per launch (a `sessionStorage` guard), then shows its
  own panel with Reload and "Reset the app" (unregister every worker, delete every cache).
- Both halves of each check matter: the banner and the container are on every page load, so testing for
  their mere existence would disable the watchdog. Tested by `splash-watchdog.test.mjs`; precached like
  any app asset (`service-worker.js`).

### The reset-request queue
Not a module — the pieces a locked-out member's "ask the admin" request passes through, listed together
because the design only makes sense whole: PASSWORD_DESIGN.md §12 (the queue) and §14 (the admin push).
- `firebase-client.js` — `requestPasswordReset(member)` (sends **no auth token**: its caller cannot sign
  in), `getResetRequests()` and `clearResetRequest(member)`.
- `login-overlay.js` — the request button (above).
- `operations-app.js` — the Password Reset Requests card above Account status, and `DEEP_LINK_CARDS`
  (`#reset-requests`, which only ever opens the card).
- The endpoint, `requestPasswordReset` in `functions/auth-endpoints.js`, **resets nothing**: it records a
  row and pushes to the admin's devices through `sendTargetedPush` (`functions/push.js`), which fails
  closed and never falls back to everyone. It is one of the app's two public endpoints, and its bounds
  (the member name as document id, the server-owned member list, no free text, a repeat throttle,
  `maxInstances`) are argued there. The button's kill switch is `CONFIG.PASSWORD_RESET_REQUESTS`.

### `password-force.js`
The MANDATORY "set your own password" overlay (PASSWORD_DESIGN.md Phase 2), shown after a confirmed
sign-in to a member still on the surname default. It injects its own markup; its header argues why
blocking is safe.
- `initPasswordForce(member, { ready? })` → `Promise<boolean>` (did it show?) — fire-and-forget from a
  coordinator's authorised path, never on the sign-in path. `ready` is a session barrier where the caller
  has one to pass (Admin's `sessionReady`; the Calendar passes `ensureNamedSession`, because its boot
  confirms an identity without feeding the auth store), bounded by `STATUS_READ_TIMEOUT_MS`.
- `shouldForcePasswordSet({ flagOn, hasMarker, authStatus, migrated })` — the pure gate, tested by
  extracting it from source. **`authStatus` must be exactly `'named'`**: on the Calendar the user may be
  the shared PIN viewer, and on Pay a member can hold a local session whose Firebase sign-in failed;
  `updatePassword` succeeds for neither. A new status therefore defaults to not compelling.
- `withTimeout(promise, ms)` — only for calls that change NOTHING (a read, the idempotent re-auth), since
  it reports a timeout as a rejection. `settleOrTimeout(promise, ms)` → `ok`, `failed` or `pending` — for
  STATE-CHANGING calls, because a race stops waiting but does not cancel; Save stays disabled while
  `pending`. Both are shared with the Settings Password card.
- **Fails open twice:** before showing (a failed status read, a non-named identity, no marker), and after
  — a rate limit, a network failure or a timeout at once, or `ESCAPE_AFTER_FAILURES` failures of any kind,
  reveal "Continue for now", which stamps nothing.
- **Gated by a one-shot marker** (`PW_FORCE_PENDING_PREFIX`, `storage-keys.js`) that `login-overlay.js`
  writes on a confirmed sign-in. It is consumed even when the overlay declines, or it would ambush a member
  on an ordinary page load.
- Password rules: `validateNewPassword` (`auth-identity.js`), shared with Settings. Kill switch:
  `CONFIG.FORCE_PASSWORD_SET`, checked AFTER the marker is consumed so markers cannot pile up while it is
  off.
- The Calendar runs it on the `named` grant when the marker is present, and its notices queue behind it;
  `page-contract-parity.test.mjs` requires every coordinator that mounts the sign-in to run it.

### `session.js`
The shared session and sign-in module: the local session, the Firebase Auth sign-in that every protected page and the Calendar's member card go through, the staff-PIN checks, and the bridge that feeds the auth store (`auth-state.js`). The reasoning is beside the code; the invariants are `AUTH_AND_SESSIONS.md`.
- `AUTH_KEY` · `SESSION_MS` (the only session clock — there is no idle cutoff; owner decision, argued beside the constant) · `SESSION_VER` (bump to sign every device out).
- `getSession()` — a pure read. Passive expiry (a past or unreadable `expiry`, or a stale version) deletes the session and the Calendar snapshot but never signs Firebase out: it runs at module evaluation and would race the access decision. `saveSession(name)` → `false` when storage is blocked. `clearSession()` — the explicit sign-out: bumps the attempt generation, deletes both keys, signs Firebase out, dispatches `SIGN_OUT`.
- `getSurname(name)` — the surname default, via `normaliseSurname` (auth-identity.js). ⚠️ Changing it locks every member out.
- `ensureNamedSession(name, { retries?, delayMs?, password? })` → `Promise<boolean>` — what every page calls. Runs `ensureFirebaseSession`, retries only transient codes (never a rate limit or a stalled start-up), feeds the store, and on success runs `refreshClaimsIfStale(CONFIG.CLAIM_EPOCH)`. The named pages hand the result to `guardNamedSession` (page-session.js).
- `ensureFirebaseSession(name, _gen?, password?)` → `Promise<boolean>` — the sign-in itself; nothing calls it directly in production. Reuses a restored session only when it is this member's and nothing was typed; otherwise tries `credentialCandidatesFor` (the typed value first) or the surname default. A silent sign-in on a session older than the member's last admin reset (`probeResetAtMs` → `sessionPredatesReset`) is refused and ends the local session; an unconfirmed answer holds the sign-in and deletes nothing. A failure is `'none'` — no anonymous fallback, no account self-heal — so a wrong password fails closed. Bounded by `AUTH_READY_TIMEOUT_MS`; every shared write after an await is generation-guarded, so a superseded attempt publishes nothing.
- `terminalAuthEvent({ named, stalled, error })` — pure: `NAMED`; `TRANSIENT` for a stalled start-up or a transient code (nothing is known, so the page keeps its session); otherwise `NONE`. `isTransientAuthError(code)` — the retryable codes.
- `getFirebaseIdentity()` → `'named' | 'none'` · `firebaseSessionIsNamed()` — what the last attempt established; only this module and its tests read them. `getFirebaseAuthError()` — that attempt's error code, read by login-overlay.js, admin-auth.js and operations-app.js.
- `restoreFirstAuthUser(timeoutMs?)` — ground truth once the boot restore has had its turn; `null`, not a rejection, past `AUTH_RESTORE_TIMEOUT_MS`. Use `auth.currentUser || await restoreFirstAuthUser()`. `primeAuth()` — the login overlay starts that restore while the member types; latency only.
- `sessionReady` / `resolveSession(result)` — the page's one-shot "session settled" promise. The coordinator resolves it exactly once; feature modules await it.
- `refreshClaimsIfStale(epoch)` — one forced ID-token refresh per device per claim-epoch bump.
- `shedCalendarViewer()` — drops the shared PIN viewer before a member signs in. **Signing out BEFORE restoring member persistence is the security property** (`setPersistence` would move the viewer into IndexedDB; proven both ways in `experiments/viewer-persistence-proof/`); throws when it cannot confirm the viewer has gone (AUTH_AND_SESSIONS.md invariant 8).
- `reconcileExpiredIdentity({ preserveCalendarViewer? })` — signs out a named Firebase identity whose local session has gone. Every protected coordinator calls it at init. Only the pages that admit the PIN keep the viewer (the Calendar's `resolveAccess`, and `holdsStaffPin` elsewhere) — never make preserving it the default.
- `holdsStaffPin(budgetMs?)` — does this browser hold the station PIN, and keep it? For a page other than the Calendar whose policy admits the PIN (`admitsStaffPin`); a local member session answers `false`. Its budget, `ACCESS_DECISION_BUDGET_MS`, is shared with calendar-access.js's `resolveAccess`.
- `signOutStaffPin()` — the drawer's Lock on such a page; throws if the viewer is still current, and never touches a member.
- Imported by every protected coordinator and many feature modules; grep for the import rather than trusting a list. Tested by `session.test.mjs`.

### `auth-state-core.js`
The pure identity state machine (`AUTH_ARCHITECTURE.md` Track 1, Phase 1): no DOM, no Firebase, no storage. States are facts about who the user is; `login` and `forbidden` are decisions in `auth-policy.js`, never states.
- `AUTH_STATUSES` — `initialising` · `resolving` · `named` · `anonymous` · `signedOut` · `degraded` · `error`. `INITIAL_STATE` — `initialising`, no member.
- `reduceAuthState(state, event)` — `RESOLVE_START{member}`, `NAMED{member}`, `ANONYMOUS`, `NONE{error}` → `signedOut`, `TRANSIENT{error}` → `degraded` (member kept), `RETRY` (from `degraded` only), `FATAL{error}` → `error`, `SIGN_OUT`. Always a new frozen object; an unknown event returns the same state.
- Nothing dispatches `ANONYMOUS` or `FATAL` any more, so `anonymous` and `error` are unreachable; they stay on purpose (the header says why). Stale events are the shell's job (session.js's generation guard), not the reducer's.
- Tested by `auth-state-core.test.mjs`.

### `auth-state.js`
The auth store (Phase 2): the one identity state, reduced by `auth-state-core.js`. Only `session.js` dispatches into it, wrapped so a store error can never break a sign-in; everything else reads. It imports nothing but the core, which keeps `session.js → auth-state.js → auth-state-core.js` acyclic.
- `getAuthSnapshot()` — the current frozen state. `guardNamedSession` (page-session.js) and paycalc-app.js's soft-allow log read it through `requirePage(getAuthSnapshot(), page)`; password-force.js reads its `status`.
- `subscribeAuth(listener)` → unsubscribe — calls the listener at once, then on every change; a listener that throws is isolated. No production subscriber yet: the single-owner shell is future work.
- `dispatchAuth(event)` — reduce and notify; a transition that changes nothing notifies nobody. `_resetAuthStateForTest()` — test only.
- The store and `sessionReady` are driven by the same `ensureNamedSession` resolution, so they cannot disagree. Tested by `auth-state.test.mjs`; the bridge by `session.test.mjs`.

### `auth-policy.js`
The page-authorisation layer (Phase 3): may this identity be on this page? **Client UX only** — Firestore rules and the Functions' claim checks are the boundary, and the role check (a name in a `CONFIG` list) is an optimisation, never enforcement.
- `PAGE_POLICIES` — the per-page map: calendar public, plus the PIN; guides open; paycalc soft; admin and settings any named member; operations admin; links designer; overtime admin, manager or `overtimeBeta`; trains any named member, plus the PIN; newlink admin or `newlinkPreview`. `DECISIONS` — the five decision strings.
- `requirePageAuth(snapshot, policy, roles)` → `{ decision, reason }`, pure: `allow`; `soft-allow` (a soft page never blocks); `login` (signedOut, anonymous, error); `forbidden` (named, wrong role); `pending` (initialising, resolving, degraded — degraded grants nothing but can be retried).
- `rolesFor(member)` — the role flags from `CONFIG`. The client's `designer` deliberately differs from the server claim `linksDesigner`; do not wire it to the claim.
- `requirePage(snapshot, page)` — the coordinator convenience; fails CLOSED (named admin) on an unknown page, and uses `hasOwnProperty` so a name such as `toString` cannot match.
- `isOvertimeReviewer(member)` (admin or manager) and `canOpenOvertime(member)` (Overtime switched on, and a reviewer or a `CONFIG.OVERTIME_BETA` name). **Keep them separate and never widen the first to make the pill work**: whatever shows colleagues' declarations reads `isOvertimeReviewer` (`AUTH_AND_SESSIONS.md` invariant 14).
- `overtimeEnabled()` — the one client read of `CONFIG.OVERTIME_ENABLED` (paused: `OVERTIME_AVAILABILITY.md` → Paused); `__E2E.overtimeEnabled` is the browser suites' seam.
- `canOpenNewlink(member)` — admin or a `CONFIG.NEWLINK_PREVIEW` name; `newlink-config.test.mjs` holds it to `PAGE_POLICIES.newlink`.
- `admitsStaffPin(page)` — the policy's `staffPin` flag, the one answer to where the station PIN may go; `requirePageAuth` never sees the PIN. `page-contract-parity.test.mjs` refuses a coordinator that asks `holdsStaffPin` on a page this does not admit.
- Tested by `auth-policy.test.mjs`.

### `operations-app.js`
Coordinator for `operations.html` (admin only). Its only export is `init()`, run by `operations-boot.js`.
- Access: `requirePage` on the local session — `login` shows the shared in-place sign-in and re-enters `init()` on success; `forbidden` sends a non-admin to `admin.html`. Then `ensureNamedSession` → `resolveSession` → `guardNamedSession` (page-session.js), which asks for a sign-in again if the named session cannot be confirmed or is lost later.
- Holds a service-worker reload while a roster review, a parse, an upload or an unconfirmed write is in flight (`_opsBusy`).
- Wires the upload cards (Huddle, Circular, Newsletter, Weekly Roster), Staff Login Accounts (`initAuthSetup`), the Needs-attention strip (operations-attention.js) and the three reporting cards, each imported from its own module.
- Owns two cards: **Account status** (`initAccountStatus` — per member, the work email with Set/Edit/Remove and the password posture with a Reset for everyone; why everyone, and how a partial or timed-out reset is reported, is beside `doReset`) and **Password reset requests** (`initResetRequests` — refreshed on returning to the tab without re-opening a card the admin closed).
- `#reset-requests`, `#error-log` and `#login-accounts` open their card; `DEEP_LINK_CARDS` is the allowlist. Admin reads go through `withClaimRetry`.

### `operations-reports.js` / `operations-errors.js` / `operations-usage.js` / `operations-speed.js`
The three read-only reporting cards on `operations.html`, one module each, plus `operations-reports.js` for what they share. Each awaits `sessionReady`, reads under `withClaimRetry`, renders into its own card and touches no coordinator state.
- `operations-reports.js` owns no card: `_cardLoadError(content, message, retryFn)` (the "couldn't load + Try again" renderer every Operations card uses, operations-app.js included), `PAGE_META` and `OPEN_META` (labels for the Usage and App Speed cards; a page missing here renders as its raw id), `PRIVACY_FOOTER`, `_usageMonthLabel`, `_relativeTime`. **No re-export barrel**: the cards import from it, so a barrel re-exporting them is a cycle (`import-graph.test.mjs` refuses one).
- `initErrorLog({ onAttention, onWithdraw })` (operations-errors.js) — `clientErrors`, with Resolve all shown, per-row Resolve and Copy details, and a truncation note. `onAttention` must fire at every moment the header count changes, including the in-place refresh and the retry; `onWithdraw` tells the strip the count is unknown after a failed refresh.
- `initUsageCard()` (operations-usage.js) — page popularity and member-devices. Deduped per DEVICE, because the server never learns who, so the figures are a direction and not a headcount, and the card says so. Its private `_appendSignInSection` adds the exact unique sign-in counts (`getSignInStats`), detached and self-silencing: a failure removes only its own section, and a late answer never paints into a re-rendered card.
- `initPageSpeedCard()` (operations-speed.js) — App Speed from `getPerfStats` (the maths is perf-stats.js). The four rules every figure keeps — the big number says it is the QUICK share, nothing by colour alone, the explanation on screen, and `compactPct` never rounds to a lie — are in its header.

### `links-app.js`
Coordinator for `links.html`, the link-design workspace (designers only). It owns the grid, paint mode, the dialogs, the dirty state and the wiring; the rules live in the domain modules below it. The workspace's contract is `.claude/rules/links-design.md`.
- `init()` — the only export, run by `links-boot.js`. A non-designer goes to `admin.html`; a signed-out visitor gets the in-place sign-in; then `ensureNamedSession` → `guardNamedSession` (page-session.js).
- Firestore writes go only through `links-design-store.js` (`createDesignStore`) and, for the staffing setups, `links-target-sets-store.js` inside the generator panel. The one direct read is `loadDesigns`, because it needs `metadata.fromCache`.
- Wires `initLinksAnalysis`, `initLinksCompare` (compare state lives there; the coordinator only reads it or calls `resetCompare`), `createDesignHeader`, `createDesignLibrary` (import and the bin) and `createTargetPanel` (the target table). The Generate button stays here.
- All design maths is imported from `links-design.js`; never copy it back. `ROTATING_LINES` is imported, never written down (`links-rotation-parity.test.mjs`).
- Every path that would lose unsaved work asks first. Duplicate's wording is deliberately not "will be lost", because the copy carries the live patterns (comment beside `duplicateDesign`).
- A proposal opens with `activeDesignId` null and `activeProposalId` set, so no write path can send a proposal id to Firestore (`links-proposals.js`).
- The orientation lightbox (`#linksWelcomeLb`) opens once per device under `myb_links_welcome_seen`, never expires, and `#linksHowBtn` in the About panel reopens it. Printing opens every `<details>` first (`_preparePrint`), because CSS cannot.
- At its coordinator-ratchet cap: the next Links rule goes in a domain module.

### `links-analysis.js`
The read-only analysis on `links.html`: the Coverage heat map with its demand rows, the Design checks card, and the sticky summary strip in the grid card's save row. Render only — every figure comes from the pure modules (`links-design`, `links-fatigue`, `links-limits`, `links-window`, `links-demand`), and none of the coordinator's save, concurrency or dirty state is touched.
- `initLinksAnalysis({ getDesign, getBaseline?, isComparing? })` → `{ renderCoverageChart, renderDesignChecks, renderSummary }`. `getDesign` is a thunk for the live design or null; `getBaseline` gives today's link's fatigue profile, so a proposal's findings read against what the roster already scores; `isComparing` makes the strip name its design in compare mode. `links-app.js`'s `renderCoverageCard()` calls the chart, the window editor and the strip together.
- Design checks open with a triage block ("Needs fixing before review", "Worth discussing") that restates the red and amber rows below and computes nothing of its own; a clean design gets no tick. The sections stay grouped by SOURCE, because a section claiming a limit must name whose requirement it is (`.claude/rules/links-design.md` invariant 10).
- The strip shows lines undesigned, staffed hours with nobody on, fatigue factors present (never `standing`) and hours a week. It is not a score, and it recomputes rather than reading the other renderers' results, so render order cannot make it wrong.
- `NIGHT_FAMILY` must equal the `family` string `links-fatigue.js` stamps, or the night rollup stops matching.
- **Every class this module emits must exist in `links.css`**: `links-analysis.test.mjs` scans a prefix set and fails on an emitted family outside it. Tested by `links-analysis.test.mjs` (fake DOM).

### `links-compare-analysis.js`
What the difference between two Links designs MEANS, for compare mode. Pure; `links-compare.js` renders it. The four rules an edit can break are in the header.
- `compareDesigns(a, b, { lines })` → `{ windowsDiffer, service: { uncovered, busiest }, limits, fatigue: { present, changed, presentInBoth, unchanged, hoursAreFloor } }`, where `a` is the active design.
- Every figure is the single-design card's own function, called the same way (`summariseDemand` against each design's OWN window, `peakHours(...).byCars`, `assessHardLimits`, `assessFatigue`), so compare mode and the cards cannot report one design differently.
- The weekday busiest-hour row is the FEWEST on duty on any of Monday to Friday (`fewestOn` names the day), never Monday's alone. Fatigue rows pair on code AND title (MRSF is three rows under one code), and the caveats travel: `confirm`, `threshold`, `hoursAreFloor`.
- Scores nothing. Pinned by `links-compare-analysis.test.mjs` (real proposal sheets as fixtures) and `links-compare.test.mjs`.

### `links-compare.js`
Compare mode on `links.html`: two designs side by side, a strip of what differs, what the difference means, and a gold outline on differing cells.
- `initLinksCompare(deps)` → `{ toggleCompareMode, selectCompareDesign, renderCompare, isCompareMode, getCompareId, resetCompare }`. **The single owner of `compareMode` and `compareDesignId`**: the coordinator only reads them or calls `resetCompare()` (on delete, select and generator apply). It reads the designs through injected getters and never touches the save or concurrency baseline.
- `renderSummaryStrip` (private): cells and LINES that differ, then hours a week ex-Sunday (through `hmFromHours`, never a hand-rolled formatter), full weekends off, rest under 12 hours and ORR factors present. An unchanged figure still renders, muted, because "the same" must not look like "not measured". Nothing is scored. `renderAnalysis` (private) writes out `compareDesigns`.
- "Only the lines that differ" is a view: every row renders and `.compare-diff-only` hides the `.row-same` ones (a class, not `hidden` — `links.css` says why). The strip says its figures still cover every line; the filter is offered only when it would both hide something and leave something; leaving compare mode clears it, switching the compared design does not.
- The compare cells are `<span>`s, because they cannot be operated; the scrolling columns are reached by keyboard through their wrappers' `tabindex="0"` (`links.css`: never restore the buttons for it).
- The two columns scroll together, and an echo that changes nothing must not arm the guard (`initScrollSync`). Tested by `links-compare.test.mjs` (fake DOM).

### `links-tips.js`
`CARD_TIPS` for `links.html`'s four `?` panels (grid, coverage, checks, generator). Pure data, rendered through `initTipsLightbox`; the shape is pinned by `tips-content.test.mjs`. It imports `ROTATING_LINES` and `DEFAULT_MAX_RUN`, never a literal.
- The generator panel describes what the tool DOES and points at the Design checks for what it achieved — never a promise about the result. Its "The default table" section restates `links-default-targets.js`'s header, so a change to that table changes this. Neither rule can fail a test.

### `links-design.js`
The pure link-design maths: reading a shift, coverage, hours, the generator and the design checks. No DOM, no Firebase. **This entry is the export list** (`.claude/rules/links-design.md` defers to it); the rules an edit can break are in the module header.
- Constants: `DAYS` · `ROTATING_LINES`, the ONE declaration of the rotation length — never write the number down, anywhere (`links-rotation-parity.test.mjs`) · `MIN_REST_MINUTES` · `SPARE_WORKED_DAYS` (the duties a cover week works, Monday to Saturday) · `DEFAULT_MAX_RUN` (the design target for days in a row, read by the generator and the checks alike) · `CONTRACTED_HOURS_PER_WEEK` · `WAVE_SPAN_MINUTES` (the FF19 threshold, reused for waves).
- Reading a shift: `classifyShift` (reads the hour through the same strict parser as the coverage maths, so the two cannot disagree) · `normaliseCustomShift` (refuses a night start and any end past midnight — CEAs do not work nights; keep both bans) · `canonicaliseShift` / `normalisePatterns` (pad legacy times on load, so there is one time format) · `startMinutes` · `endMinutes` · `endMinutesAbs` (the ONE reading of a duty that runs past midnight) · `dutyMinutes` (re-exported by `links-fatigue.js`) · `dayClass`.
- Rest and runs: `isRest` (RD, OFF or empty; SPARE is not rest — the Links modules' one copy) · `isCoverWeek(row)` (SPARE Monday to Saturday; the Sunday is not asked) · `spareDrawsOnFour(i)` (a cover week's four are Monday to Saturday; its Sunday is overtime on top) · `runLengthsWhere(seq, counts, { requireMatch })` (the spare-week budget with the question as a parameter; every rule that counts a run uses it) · `workedRunLengths` (per start: the optimiser's gradient, never reported) · `worstCaseWorkedRun` (the worst case, a cover week counting four, never seven).
- Hours: `weeklyHours(patterns, lines)` → `{ exSunday, all, totalHours, exSundayHours, sundayHours, workingLines, coverLines, lines, duties, sundayDuties, unreadable, unreadableLines, complete, target }`: Sundays out, a cover week counted as a contracted week, the whole rotation as the divisor; `exSunday` is null, never 0, for an empty design; `complete` gates the tick, never the figure. `lineTotals(patterns, lines)` → `{ rows, daysAverage, daysLines }`, whose days divisor is the WORKING lines, unlike the hours beside it. `hmFromHours` is the one formatter for hours a week (it rounds total minutes first). `targetExSundayMinutes(slots)` is the duty a target table asks for, Sundays discarded, in minutes because the gate is an equality.
- Coverage: `calcCoverage` · `calcHourlyCoverage` (a duty past midnight counts on both days).
- Generator: `generateLink({ slots, spareLines, lines, settled, requireContract, requireRest })` → `{ patterns, mode, waves, reason, … }` tries settled weeks first (`groupIntoWaves`) with the rotating window as fallback, and REFUSES rather than ships — `short-hours` and `over-hours` (the targets must pay the contract exactly, with `askedMinutes`/`needMinutes`/`working` for the gap), `short-rest`, `no-rest`, `over-capacity`, plus the input refusals. `requireContract` and `requireRest` default on, and `links-contract.test.mjs` fails if `links-app.js` turns either off. `generatePatterns(opts)` is the patterns-only wrapper. `restBetween` / `repairShortRest` are the minimum-rest repair: a swap of two lines' duties within one day column, so no headcount, target or cover moves.
- Checks: `runDesignChecks(patterns, lines)` — unfilled lines, weekends off, short turnarounds, longest run, early and late balance. Its turnaround rest repeats `restBetween`'s expression: change the two together.
- Tested by `links-design.test.mjs`; the contract and rest gates by `links-contract.test.mjs`.

### `links-target-sets-store.js`
The Firestore half of the saved staffing setups: `createTargetSetStore(deps)` → `{ list, writeIfUnchanged }`, with every Firebase handle injected so it loads in Node. Used by `links-generator-targets.js`; the two rules are in the header.
- `list()` → `{ status: 'ready'|'error', sets }` — a read that fails is not an empty collection. What the picker may then say is `describeSetList` (`links-target-sets.js`).
- `writeIfUnchanged(set, payload)` — lands only on the version the picker showed (consent names a VERSION); a `null` payload deletes. Gone-already is success for a delete and a refusal for an overwrite, which would resurrect a set somebody deleted.
- Tested by `links-target-sets-store.test.mjs`, whose `onRead` seam runs a competing writer inside the transaction's window.

### `links-target-hours.js`
Does a generator target table pay the contract, and the words the card says it in. Pure; `links-generator-targets.js` renders the result. The three rules are in the header.
- `assessTargetHours(slots, { spareLines, totalLines })` → `{ workingLines, hoursPerLine, askedMinutes, neededMinutes, diffMinutes, unreadable, onTarget, empty }`. **`onTarget` is an EQUALITY** against the gate's own `targetExSundayMinutes` — never a tolerance — so the tick and `generateLink`'s refusal cannot disagree. An unreadable time is counted whether or not its row contributes, because the gate refuses on any.
- `targetHoursLines(a)` → `{ value, tone, note }` — the gap is stated as a TOTAL, never per line.
- `targetProvenanceNote({ fromMemory, differsFromDefault, setName })` → where the table came from, or null; it names the set when there is one.
- Sundays are out of the comparison, and the average divides by the whole rotation with a cover week counted as a contracted week, as the Design-checks row does. Tested by `links-target-hours.test.mjs`.

### `links-design-doc.js`
The SHAPE of a link design, in memory and in Firestore, and every conversion between the two. Pure. Its three rules are in the header: every shape carries `window`; everything arriving from Firestore is canonicalised and nothing in memory is re-normalised; the working copy deep-copies its patterns.
- Firestore → memory: `designFromDoc(id, data)` · `binEntryFromDoc(id, data)`, both through `normalisePatterns`.
- Memory → Firestore: `docPayload(design, { updatedBy, updatedAt })` emits exactly the five content keys. Every key a write carries must be in the `hasOnly` list `firestore.rules` enforces, or every save permission-denies on every device until the rules catch up.
- Memory → memory: `workingCopy(design)` · `binEntryFrom(entry, deletedBy)` · `restoredEntryFrom(entry, { updatedAt, updatedBy, revision })` · `deepCopyPatterns(patterns)`.
- `recordSave(entry, written, by, updatedAt, revision, savedAt?)` — after a save the live entry takes what was WRITTEN; a stampless save records a display-only `savedAt`, never read by the concurrency guard and never written to Firestore. `lastSavedLabel(updatedBy, when, now?)` — the line under Save, which names the day once the save is not today.
- `LEGACY_DOC_ID` (`'combined-28'`, a document id and not a length — the one-time migration's source).
- `LINK_26_FROM` · `PREVIOUS_LINK_LENGTH` · `isPre26Design(entry, lines?)` — a design drawn for the previous rotation, which `links-app.js` moves to Recently deleted (owner decision, 3 Oct 2026). All three conditions must hold: saved before `LINK_26_FROM`, nothing past the old length, and something drawn; an unresolved timestamp is never old.
- Tested by `links-design-doc.test.mjs`.

### `links-generator-targets.js`
The numbers the generator runs against, where they came from, and what may replace them: the DOM half of the generator card's target table. It keeps answering one question — are these the default, today's roster, this design's own memory or a colleague's saved setup, and have they changed since? The four rules that are easy to undo are in the header.
- `createTargetPanel({ getActiveDesignId, currentUser, isAdmin, sessionReady, buildShiftOptions, defaultSlotTime })` → `{ refreshForDesign, adoptUnsaved, getTable, totals }`. `getTable()` is LIVE; `adoptUnsaved()` moves a table tuned under the `unsaved` key onto the id a first save just gave the design; `totals` recomputes the totals Generate checks before it runs.
- `getActiveDesignId` is a GETTER and `currentUser`/`isAdmin` are values: the design id moves after the panel is built, the identity does not.
- Owns the "Saved staffing setups" row and its dialogs — Load copies a set and writes nothing, Save changes overwrites your own set after a confirm, "+ Save as new…" keeps your version of a colleague's — and the two reset buttons (`links-default-targets.js`, `links-seed.js`).
- Remembers each design's table in localStorage on every keystroke, stamped with its `source` and `APP_VERSION`. `loadGenTargets` retires a stamped `default` from an older version and an unstamped table equal to the seed or the default, and never an edited one.
- Does NOT own what a set is (`links-target-sets.js`), the Firestore half (`links-target-sets-store.js`), the verdict (`links-target-hours.js`) or the Generate button (the coordinator).

### `select-sheet.js`
The app's own dropdown. A native `<select>`'s popup is drawn by the OS, so every dropdown a reader reads opens this sheet instead; the `<select>` stays as the value holder, so consumers are untouched. The rules an enhancement can break are numbered contracts in `select-sheet-parity.test.mjs`; the reasoning is beside the code.
- `enhanceSelect(select, { title, placeholder, triggerClass?, createLightbox? })` → `refresh()`. Inserts a trigger (`#<id>Trigger`, wearing the select's own classes plus `.fieldpick`), takes the select out of the layout and the accessibility tree, and opens one shared `createLightbox` sheet of `.picker-opt` rows. The trigger mirrors the select's `hidden` and `disabled`, and repaints on `change`, on `input` and on a MutationObserver, because a rebuild, a disable or a selection made in code fires no `change`.
- `initSelectSheets(specs, { createLightbox? })` → each id's `refresh()`. A missing id is skipped; a select built after boot must be enhanced where it is built.
- `openOptionSheet({ title, groups, current, subtitle?, searchPlaceholder?, onPick, onPreview? })` — the same sheet for a caller that holds the value itself (the Links grid's cell editor). `onPick` fires once the close has LANDED, so a dialog opened from it is not popped by the Back echo; `onPreview` fires on the tap; neither fires on a dismissal.
- `readGroups(select)` (also the options parser for `openOptionSheet`; a `hidden` option is never offered) · `triggerLabel(select, placeholder?)` · `widestOptionLabel(select, placeholder?)` — the trigger is sized to the longest label, so it does not change width when the value does.
- `shouldOfferSearch(count)` · `optionMatches(option, query)` · `filterGroups(groups, query)` · `searchLabelFor(title)` — the filter on a long sheet: a substring of the label or its second line, case and accents folded; a group that keeps nothing is dropped, and no match is an empty list. The box never takes focus, and it is deliberately not `guide-search.js`.
- `createLightbox` is injected because `overlay.js` touches `window` at import. Tested by `select-sheet.test.mjs` and `select-sheet-pick.test.mjs`; coverage by `select-sheet-parity.test.mjs`; the wiring by `e2e/calendar.spec.js`.

### `select-sheet-parity.test.mjs`
The guard that every `<select>` the app ships is enhanced or native by a declared decision, and that the page CSS reaches the trigger. A missed select is invisible to every other lane: the closed control looks the same, the popup belongs to the platform, and `selectOption` drives both. The numbered contracts are the list, each with its reason in the file: the scan reads every construction site (page markup, `createElement` and JS template literals) and fails when it cannot; `NATIVE_BY_DECISION` carries a reason per row, and a stale row fails; an id rule needs a `#<id>Trigger` counterpart; a page whose enhanced selects carry no class names `.fieldpick`; nothing focuses an enhanced select; no `hidden` select is enhanced; a selection changed in code announces itself; a test reads the face, never the select; and a box that collapses is a containing block.

### `links-proposals.js`
The shortlisted designs for the new link, built into the workspace as read-only proposals rather than saved documents (owner decision, 3 Oct 2026). Pure data and helpers; the header names the current shortlist and how to re-copy it from the pack.
- `PROPOSALS` — `{ id, code, name, ref, patterns }`, copied cell for cell from the pack's `.json`, listed A to Z with no recommendation (owner, 5 Nov 2026). `name` is the title; `ref` is the code and grid fingerprint, kept apart so a phone shows the name untruncated.
- `PROPOSAL_PREFIX` · `isProposalId(id)` · `proposalById(id)` · `proposalCopyName(proposal, existing)` → "<name> — copy", numbered if taken, without the date or the fingerprint, which an edited grid no longer matches.
- **The one rule: a proposal id never reaches Firestore.** `links-app.js` opens one with `activeDesignId` null and `activeProposalId` set, so save, rename and delete treat it as unsaved and the first save creates a new design. Compare offers proposals beside saved designs; Generate while one is open builds a new unsaved design. A device left on a proposal that has since left the shortlist reopens its first saved design.
- Tested by `links-proposals.test.mjs`: the shortlist and its order, every line drawn, the contract and hard limits, and a faithful copy of each source grid.

### `links-shortlist.js`
"Keep only the shortlist": the admin's one deliberate press that moves every design last saved before the shortlist was settled to Recently deleted (owner, 2 Nov 2026). The shortlist itself is untouched, built in and read-only (`links-proposals.js`). Pure; the press is in `links-design-library.js`.
- `OLDER_BEFORE` (the start of 2 Nov 2026, UTC) · `isOlderDesign(entry)` — last saved before it; an unreadable save time is not older. A fixed date, so work saved later is never swept and a restored design (a new save time) is never offered again.
- `olderDesigns(designs)` · `canKeepOnlyShortlist({ isAdmin, designs })` — the ··· More row is the admin's while anything older remains, so it goes by itself once used.
- `keepOnlyShortlistMessage(older, { currentUser, dirty })` — the dialog, naming each design and who last saved it (up to `LISTED_IN_DIALOG`, the rest counted) and the shortlist it keeps, read from `PROPOSALS`. `keptOnlyShortlistLine(moved, failed)` — the receipt.
- **A press, never a move on page open** — the header has the three reasons. Each move goes through the store's `binIfStill`, which asks `isOlderDesign` again inside its transaction. Tested by `links-shortlist.test.mjs`; the press by `e2e/links-shortlist.spec.js`.

### `links-design-header.js`
The design masthead on `links.html`: which design is open, whose, whether it is saved, the Save buttons, the picker sheet and the ··· More sheet behind which every other verb lives. Every handle is injected — `createLightbox` included, because `overlay.js` touches `window` at import — so it loads in Node. The four rules an edit can break are in the header.
- `createDesignHeader(els, { onSelect, onRename }, { moreButton, sheet, picker, sheetActions })` → `{ render(state) }`, where `state` is `{ designs, activeId, design, dirty, saving?, canDelete?, currentUser, now?, proposals?, proposalId? }`. It paints the face, the picker list (rebuilt only when its content changes), the badge, the status, both Save buttons and the sheet's header. Every sheet action closes the sheet first and runs 500 ms later.
- `groupDesigns(designs, currentUser)` — "Last saved by you" first, then other savers alphabetically, newest first within each. Grouped by `updatedBy` (last saved by, not creator), and the headings say so.
- `saveButtonLabel({ saved, dirty, proposal? })` — `Save a copy…` (a proposal's working copy) · `Save as…` (no document yet) · `Save` · `Saved`. One place; call sites never write these.
- `statusCopy({ saved, dirty, saving?, updatedAt?, now?, proposal? })` → `{ tone, long, short }` — unsaved edits are never reported as saved.
- `lastSaveTime(entry)` — the DISPLAY reading of a last save, the newer of `updatedAt` and a device-recorded `savedAt`; the concurrency baseline stays `updatedAt`.
- `whoCopy({ saved, updatedBy, currentUser })` → `{ name, role }` · `proposeNewDesignName(currentUser, existing, now?)` → "<member> · 8 Sep", stepping past a clash · `toDate(v)`.
- Tested by `links-design-header.test.mjs`.

### `links-design-naming.js`
What a design or a staffing setup may be CALLED: one rule for new, import, duplicate, rename and save-a-setup-as-new. Pure; the reasons are in the header.
- `checkName(name, { existing, exceptId, noun })` → `{ ok, reason?, message? }`; the caller decides where the message appears.
- `nameConflict(name, existing, exceptId)` — the entry this name would be confused with, or null. **`exceptId` is load-bearing on rename**, or recapitalising your own design collides with itself.
- `nameKey(name)` — the comparison form: trimmed, internal whitespace folded but never removed, lower-cased. Never stored.
- `proposeCopyName(base, existing)` — "X copy", then "X copy 2"…, reserving room for the suffix BEFORE building the candidate, so a long name is never offered back unchanged or cut mid-suffix.
- `MAX_DESIGN_NAME` — the bound `firestore.rules` enforces.
- It refuses a duplicate rather than renaming one silently, case- and space-insensitively. What it guarantees is narrower than "no duplicates exist" — the header says why. Tested by `links-design-naming.test.mjs`.

### `rangers-guide.js` / `rangers-guide.css`
The Rangers & Rovers guide's script and stylesheet: the ranger and rover area passes staff accept or refuse at the gateline. A static page with no app modules and no Firebase. `rangers-guide.js` is deliberately a near-copy of `railcard-guide.js` — chip-bar scrolling and the sticky-header offsets, measured after the font loads — because that stack has already produced a real bug; only the card selectors differ. Print is `guide-print.js`, shared by every guide.
- The page's rules live in `.claude/rules/guide-pages.md` → "Rangers & Rovers guide": the Marylebone question first, evidence per product and per claim (a Conflict is not a stronger Draft), "usually no" with the near-misses as the point of the page, and no prices. Each product's evidence is a `GUIDE_SOURCES.md` row, held to the page by `guide-sources.test.mjs`.

### `links-seed.js`
The generator's roster seed: it reads the roster people actually work and turns it into shift-slot targets — the table behind "Copy staffing from today's roster", one button from the default. It MEASURES; `links-default-targets.js` DESIGNS. Pure; the reasoning is in the header.
- `rosterSeedLines()` → the lines sampled: the WHOLE main cycle and nothing else, its length read from `CONFIG.MAIN_ROSTER_WEEKS`, never a literal.
- `buildRosterTargets(sources = rosterSeedLines())` → `{ slots: [{ time, weekday, sat, sun }], spareLines }`, as fresh objects. The weekday figure is the BUSIEST Monday-to-Friday day for that time, spare is counted in whole LINES, and nothing is added to what it measures.
- **The seed samples exactly what the design represents.** The new link is the main roster widened and excludes the bilingual roster, so no bilingual line or time is sampled. Sources are a parameter defaulting to the real roster, so which lines are sampled and what is counted are tested apart.
- Tested by `links-seed.test.mjs`: line identity, no bilingual-only time ever seeded, and no bare numeric loop bound.

### `links-default-targets.js`
The table the generator starts from when a design has none: the duty table of Short Run, one of the owner's shortlist, which pays the contracted week exactly, so Generate works on a card nobody has touched. It DESIGNS where `links-seed.js` MEASURES, and the two are one button apart. Pure data plus one builder. The header has the arithmetic and the `docs/links-26/RULES.md` rules the table meets; `links-default-targets.test.mjs` pins each one.
- `buildDefaultTargets()` → `{ slots: [{ time, weekday, sat, sun }], spareLines }` — a FRESH mutable copy every call, because the generator card edits its table in place; the frozen table would make the first keystroke a silent no-op.
- `DEFAULT_COVER_WEEKS` (the third term of the contract equation, not an independent preference) · `OPENING_TURNS` · `CLOSING_TURNS` · `EVENING_TURNS_FROM_22` · `SATURDAY_CLOSING_TURNS` · `SATURDAY_TURNS` · `SUNDAY_TURNS` · `TARGET_DAYS_PER_WEEK` — the owner's figures, exported so the tests and the header read them rather than restating them.
- `DEFAULT_SHIFT_TIMES` — every time the table proposes, in order. `links-app.js` adds them to the cell dropdowns; the paint chips are the design's own times, falling back to these only for an empty design.
- `sameTargetTable(a, b)` — order-insensitive whole-table equality. `isSupersededMemory(remembered, rosterSeed)` — true when a remembered table equals the roster seed or the current default, by content alone, so an edited table is never discarded; the version-stamp route is `loadGenTargets` in `links-generator-targets.js`. The seed is passed in, so this module imports nothing.
- It is not a link. The panels below the grid assess what the generator makes of it.

### `links-target-sets.js`
Named, shared snapshots of the generator's target table (`linkTargetSets`), and who may overwrite one — because the owner's ask, "others can mess about but not lose my shift times set", cannot be kept per device. Pure; the caller injects `serverTimestamp()`.
- `targetSetFromDoc(id, data)` → a set or **null, never a half-set** — the trust boundary: a corrupt row refuses the whole document, and so does a missing `createdBy`.
- `targetSetPayload(table, createdBy, updatedBy, now)` — fresh copies; an overwrite keeps the EXISTING owner as `createdBy`.
- `canOverwriteTargetSet(set, userName, isAdmin)` — the creator or the admin. The client's copy of the rule, for the BUTTON; `firestore.rules` is the protection (creator or admin, `createdBy` pinned to the writer's own `name` claim and immutable), and `firestore.rules.test.mjs` asserts the server side of every case.
- `describeSetState(set, ctx)` — what the row SAYS and what it OFFERS. `describeSetList(status, sets)` — what the picker may claim about a list it might not have: loading, empty, rows or error. `usable` is false whenever the list is not known to be complete, and the error hint says the error does not mean the sets were deleted, without claiming they were not.
- `MAX_SET_NAME` · `MAX_SET_SLOTS` · `SPARE_WEEKS_CAP` · `targetSetProblem(table)` — the bounds the rules enforce, asked before a save so a refusal says why (`links-target-sets.test.mjs` pins them to `firestore.rules`). `sortTargetSets(sets)` — by name, case-insensitive, ties by id.
- Tested by `links-target-sets.test.mjs`; the rules by `firestore.rules.test.mjs`; the wiring by the `links sets:` e2e cases, signed in as a designer who is not the admin, because the admin's override is real.

### `links-limits.js`
The HARD limits: the ones a design meets or cannot be run. A separate module from `links-fatigue.js` on purpose — a hard limit is the opposite kind of statement from an advisory factor, so it has its own function, count and section, is red on a breach, and renders when passing too. Pure; the header holds whose limit this is, its withdrawn-2007 origin and the three rules every edit keeps.
- `MAX_CONSECUTIVE_WORKED_DAYS` · `assessHardLimits(patterns, lines)` → `{ checks, breaches, assessable }` — the WORST CASE (a cover week's four placed however the clerk chooses), and it fails to `unknown`, never to `ok`, so an empty or part-built design never reads as compliant.
- `POLICY_SOURCE_CONFIRMED` — the one switch every visible claim derives from; while it is `false` the limit reads as provisional everywhere. `LIMIT_CLAIM` — the heading wording, derived from it, which the Design checks card and compare mode both read.
- `CONTRACTED_DAYS_CEILING` · `contractedDaysPerYear(patterns, lines)` — the new link's contracted-days ceiling (`docs/links-26/RULES.md`): Monday-to-Saturday duties plus four days per cover week, over the rotation, scaled to a year. Assessed only once every line is drawn and only at `ROTATING_LINES`; its row reports the measurement and never says "cannot be run".
- Tested by `links-limits.test.mjs`.

### `links-fatigue.js`
The ORR good-practice fatigue factors (December 2021 guide: twenty-five rows in six families, read at source) assessed against a link design. Pure. **It reports factors PRESENT and never passes or fails a design**: the ORR says these are not prescriptive limits, and the dominant risk is false assurance. The header and the comment beside each row carry the reasoning.
- `assessFatigue(patterns, lines)` → `{ results, present, standing, confirmNeeded, hoursAreFloor }`; each result is `{ code, family, title, status, value?, threshold?, detail?, confirm? }`, `status` being `present` / `clear` / `standing` / `n/a`.
- The rules it is built from: `isRest` / `isWorked` (SPARE is worked; `isRest` is re-exported from `links-design.js`, as is `dutyMinutes`) · `isEarlyStart` · `isVeryEarlyStart` · `coversNightWindow` (exact interval overlap, never sampled) · `toSequence` · `longestRunBetween48hBreaks` (FF11: only two rest days together count as a break, so it can only overstate) · `longestWorkedRun` (delegates to `worstCaseWorkedRun`) · `longestRunOf` · `earlyBlocksWithShortRecovery` · `maxHoursInAny7Days` · `startTimeJumps` · `rotationDirection`.
- **Never hardcode a status**: a factor that cannot be computed gets no tick, and FF13 reads `runDesignChecks` so the two cannot disagree. NOT-APPLICABLE, CLEAR and STANDING are three different answers, and `standing` (a feature of the operation, such as FF2's 06:20 starts) is counted apart from `present`. Every rule laps the rotation.
- `family` names a group and never a verdict; `links-analysis.js`'s `NIGHT_FAMILY` must equal the night family's string.
- Only FF19 carries `confirm: true` (owner, 28 Sep 2026, on ORR's text: its reading is the owner's, more lenient than ORR's). FF18 is ORR's cadence factor, `standing` on any link with timed lines, with the week-to-week step from `scoreOrder` (`links-adjacency.js`) as extra information.
- Hours totals are a FLOOR, because SPARE carries no times. Read by `links-analysis.js`, the two compare modules and `links-app.js`'s `currentLinkBaseline()`. Tested by `links-fatigue.test.mjs`.

### `links-window.js`
The operating window of a link design — when Marylebone is staffed — so the heat map reads a design against the hours it has to cover, not against its own first and last duty, which hid missing cover at either end of the day. Pure. Stored as an optional `window` map on each `linkDesigns` document; a design saved without one reads as the default.
- `DEFAULT_WINDOW` (one row for Monday to Saturday, one for Sunday) · `WINDOW_ROWS` · `normaliseWindow` · `windowForDay` · `isHourStaffed` · `heatSpan` · `formatWindow` · `windowsDiffer` · `isDefaultWindow` · `isValidWindowRow` · `windowMinutes` · `rowMinutes` (a normalised row's span in minutes, the one conversion both coverage readings make) · `canonicaliseWindowTime`.
- **Per design, and compare mode diffs CELLS, not windows.** Anywhere two designs are shown together — the compare columns, the printed sheet — must state the window, and `windowsDiffer` flags a mismatch.
- `normaliseWindow` falls back PER ROW, never per field, so a stored start is never paired with a default end.
- The editor uses TEXT inputs, because Chromium draws `<input type="time">` in a 12-hour format even at en-GB; `canonicaliseWindowTime` pads.
- The window travels with the design everywhere, the bin included (`links-design-doc.js`). Tested by `links-window.test.mjs`; the wiring by `e2e/links.spec.js`.

### `links-demand.js`
The service a link design has to cover: trains per hour at Marylebone in the December 2026 timetable, so the heat map can set cover against service. Pure. Demand counts arrivals as well as departures, weighted by train length (owner, Aug 2026), and the movement count and the car count are both kept and never blended, because they disagree about the peak. It never scores a design. The header has the reasoning, how the lengths were derived and the traps in re-measuring.
- `DEC_2026_MOVEMENTS` (every movement, stored as TIMES so the window's boundary can be asked to the minute) · `DEC_2026_DEMAND` (the hourly profile, derived from the movements) · `DEC_2026_SOURCE` (the provenance shown under the heat map) · `DAY_CLASS_KEYS` · `DAY_CLASSES` · `DAY_LABEL`.
- `demandAt` · `peakCars` · `peakHours` · `demandBucket` · `movementsOutside` · `describeHours` · `describeMovements`.
- `summariseDemand({ profile, movements, hourly, days, windowFor })` splits a FINDING from a FACT — the anti-cry-wolf rule. `uncovered` (the station open, trains running, nobody on duty) is a finding, counted per day at hour resolution; `outside` (trains while the station is shut) is a neutral fact, per day class to the minute, split before and after.
- Rendered by `links-analysis.js` as rows in the same table as the cover, in `--cov-late` orange, a different hue from the cover ramp so the two rows do not read as one thing in one unit. Tested by `links-demand.test.mjs`; the wiring by `e2e/links.spec.js`.

### `links-adjacency.js`
What happens BETWEEN the lines: the order they sit in. You work line w one week and line w+1 the next, so the week-to-week movement of the working day, full and long weekends, and rest from Saturday into Sunday all live in the order. Pure; `links-app.js` applies it after Generate. The header carries the reasoning and the measured weights.
- `OBJECTIVES` (the switches on the generator card, in display order — the count is the array's) · `GENTLE_THRESHOLD_MINUTES` (the step that counts as a real change — ORR's FF19 figure) · `DEFAULT_BLOCK_TARGET` (weeks in a row on much the same shift, measured from the live roster).
- `lineStartProfile` (null, never zero, for a line with no times) · `weekStep` · `breakLength` (`days` and `given` apart, because Sunday is not contracted) · `boundaryRest` · `blockRuns` (a spare line is transparent) · `blockExcess` · `spareSpread` · `longestRunFor` (delegates to `worstCaseWorkedRun`) · `runExcess` (a gradient, never a statistic — never report it) · `scoreOrder` (every figure, whatever was optimised) · `cost` · `reorderLines` · `applyOrder`.
- **Reordering is free with respect to coverage** — permuting the rows leaves every day's cover unchanged, and a test asserts it — so the objectives compete only with each other. Switches, not a formula: an objective that is off contributes nothing, and all off returns the order untouched.
- **Two terms are constraints, not switches**: the even spread of cover weeks (weighted to dominate every switch, and filtered on) and rest across the week boundary (minimum rest is a gate the generator applies before the reorder, so the reorder must not undo it). `variety` stays on by default, because minimising the step alone produces long blocks of one shift.
- Deterministic per attempt: attempt 0 is the greedy start; later attempts are seeded shuffles (never `Math.random`), so "design 3" is the same design on every device. Tested by `links-adjacency.test.mjs`, which also fails if the waves are interleaved inside the generator (a won't-do; `links-design.js`'s header).

### `links-deletion.js`
The pure rules behind Recently deleted in the Links workspace: a soft delete (`deletedAt` and `deletedBy` on the document) that hides a design and keeps it until a designer removes it for good. **The bin is PERMANENT** (owner decision, 19 Sep 2026): nothing expires a design and there is no retention constant, which `doc-parity.test.mjs` pins, so no doc may promise a removal window.
- `isDeleted(data)` — tests for the KEY, not a usable timestamp, so a design binned on this device leaves its picker at once.
- `deletedLabel(data, nowMs)` — the design's AGE in the bin in calendar days ("Deleted 3 days ago"), never time remaining.
- `sortByDeleted(entries)` · `canSoftDelete(liveCount)` (counts LIVE designs, so a full bin cannot make the last design disposable) · `tsMillis(ts)` (null for a timestamp not yet resolved).
- The Firestore calls are `links-design-store.js`; the panel is `links-design-library.js`. Tested by `links-deletion.test.mjs`.

### `links-concurrency.js`
The pure co-editing rules for the Links workspace: is this save about to overwrite a colleague's work? No DOM, no Firebase, no timers; `links-design-store.js` applies them. Every bug this logic has had was a SILENT overwrite, which is why the rules live where they can be tested.
- `conflictOf(data, exists, { loadedRevision, loadedUpdatedAt, baselineUnknown, currentUser })` → the conflict to confirm (`{ by, at, rev }`) or null. Three paths: a REVISION mismatch (exact — the counter is computed inside the write's own transaction, and absent ≠ present in both directions); a timestamp mismatch; and an UNKNOWN baseline plus someone else's name, weaker but never "no conflict". Accepted limit: two devices under one display name never conflict-prompt on that last path.
- `baselineAfterWrite(millis, ok = true)` — a failed read-back flags the baseline UNKNOWN, never merely null. `baselineAfterCommit(revision)` — the baseline after a write whose revision is known. `baselineFromEntry(entry)` — the baseline for a design selected from the loaded list.
- `nextRevision(serverData)` — the revision a write should commit: monotonic, and never trusts a non-number.
- `canAdvanceBaseline(preTs, ourBaseline, preReadOk = true)` — a rename may move our baseline only when nothing changed underneath it; with a revision on both sides it compares those instead.
- Tested by `links-concurrency.test.mjs`, one case per historical bug; the read-back window end to end in `links-design-store.test.mjs`.

### `admin-boot.js` / `links-boot.js` / `operations-boot.js` / `paycalc-boot.js` / `settings-boot.js`
The page bootstraps: each imports `init` from its coordinator and calls it, and does nothing else. Both reasons are needed — CSP `script-src 'self'` blocks an inline `init()` in the page, and keeping the call out of the coordinator lets a test import `init` without running the page. The Overtime, Trains and New link boot files are the same shape and sit in their own pages' entries.

### `admin-range-booking.js`
The shared skeleton of the two date-range booking sections on `admin.html`: Annual Leave and Absence.
- `createRangeBookingSection(cfg)` → `{ updatePreview, saveBtn }` — wires one section by `cfg.prefix` (`al` / `sick`): the member dropdown (with the iOS optgroup fix), the preview guard chain (no member, no dates, a bad range), working-day counting through `isWorkingDate`, the date listeners, and the save → receipt → refresh flow, including the signed-out and unconfirmed-write messages.
- Each section's differences are injected: `validateRange`, `renderReady`, `successFeedback`/`successToast`, `beforePreview`/`afterDateChange`/`afterSave`/`onViewYearChange`, and the AL-only `onClick`, `project`, `swapQuestion` and `preSave`. It owns none of the leave rules: `admin-al.js` brings in the projection (`admin-al-projection.js`), the Spare sentence (`admin-al-spare-note.js`) and the swapped-day question (`al-swapped-days.js`); the Absence card supplies none of them, so its rest days are skipped silently.

### `admin-al.js`
The Annual Leave booking section on `admin.html`: a thin configuration of `createRangeBookingSection` (`admin-range-booking.js`).
- `initALSection(deps)` — the AL config: the range-length cap, the preview (with the Spare sentence), the swapped-day question, the projection of what the save will write, and the over-entitlement pre-save check that shows the confirm bar. DOM handles and callbacks arrive through `deps`, so nothing imports `admin-app.js` back.
- `triggerConfirmedALSave()` — called by the confirm bar in `admin-app.js` when the user accepts booking past the entitlement; it sets the flag and presses Save again. The flag is captured and reset at the top of every save, so an early return can never leave it set.

### `al-entitlement.js`
Which annual-leave days spend a member's entitlement, and where that leaves them: taken, booked, remaining. Pure. One module because the set of counted days used to be built by hand in four places that disagreed (the header has the story and the rules).
- `entitlementFor(member, year, overrides)` → `number|null` — the WHOLE allowance: `getALEntitlement` plus the Boxing Day day in lieu (`boxingDayLieuDays`). **The one door**: `christmas-leave.test.mjs` fails if any other module calls `getALEntitlement`. `null` (no entitlement on record) stays `null`.
- `consumesEntitlement(member, date, ovByDate?)` — does leave on this date cost a day? Never a Sunday; never Christmas Day or Boxing Day from 2026 (`isChristmasClosureDate`); otherwise what is UNDERNEATH decides — the override through `isContractedWorkOverride` (on an AL document, its `replacedType`, so a swapped-in day costs a day and a voluntary `rdw` does not), else the base shift. Both halves of the overage projection ask it.
- `countedAlDates({ overrides, member, year, exclude })` → `Set` — the AL days that spend `year`'s allowance, by the WINNING record and `leaveYearOf` it, so a January day moved back counts once, in the earlier year. `exclude` drops the dates a batch is about to rewrite.
- `alPosition({ overrides, member, year, todayStr })` → `{ entitlement, taken, booked, remaining }` — split at `todayStr`; `remaining` may be negative (over the limit); a null entitlement gives a null remaining.
- `leaveYearChoices({ overrides, member, todayStr })` — the January days the Admin panel may move between years, with both years' positions and `prevOpen`, the cap: "no more than the previous year has left".
- `dispatcherBreakdown({ member, year, overrides })` → `{ base, lieu, boxingDay, proRated } | null` — the parts of a Dispatcher's figure, never `entitlement - 22` (the test pins `base + lieu + boxingDay === entitlementFor(...)`). `entitlementNote({ member, year, overrides })` — the one line explaining an entitlement, shared by the Admin AL banner and the Calendar's leave panel.
- `winningEntriesOfType(overrides, memberName, type)` — resolve the winning record for each date FIRST, then ask its type; filtering the raw collection finds an old AL document under a newer shift.
- `isWorkingDate(memberObj, dateStr, ovByDate)` — will this day be WRITTEN as leave (Sunday → override → base); re-exported by `admin-overrides.js`. `consumesEntitlement` asks the other half, whether it COSTS a day.
- Tested by `al-entitlement.test.mjs` and `christmas-leave.test.mjs`. Grep for the import rather than trusting a list of callers.

### `christmas-leave.js`
Christmas Day and Boxing Day: who is on leave, what it costs, and the day in lieu (the owner's rules, 5 Nov 2026). Pure. **Derived, never stored**: the leave follows from the pattern and the date, so nothing is written to Firestore and anything recorded on the day wins. `getBaseShift` still makes both days a rest day for everybody (`isChristmasRD`); these rules sit on top, in their own module so `al-entitlement.js` can import them without a cycle. The header has the rules and the one door they cost.
- `CHRISTMAS_LEAVE_FROM_YEAR` — earlier Christmases keep showing Rest.
- `isChristmasLeaveDay(member, date)` — 25 or 26 December from 2026, not a Sunday, and the PATTERN (`getPatternShift`) had the member due at work: a shift or a spare day. Never before a start date.
- `isChristmasClosureDate(dateStr)` — either day from 2026, for anybody. Leave there never costs a day, so the booking flows neither ask about it nor write it, and every receipt names it.
- `boxingDayLieuDays(member, year, overrides)` → 0 or 1 — due at work on Boxing Day, and the WINNING record is a worked shift; it counts towards that Boxing Day's year. Counted once for a Dispatcher: 0 when Boxing Day is itself a bank holiday, which their bank-holiday rule has counted.
- `resolveDayShift(override, baseShift, sunday, christmasLeave)` → `resolveEffectiveShift`'s shape plus `christmasLeave` — the shared ladder with the leave on top, called by EVERY surface that draws a day (Calendar, Team Week, the month legend, Overtime's roster, Admin's week grid), so no two show a Christmas day differently.
- `isUncountedChristmasLeave(shift, dateStr, christmasLeave)` — is this leave never counted because it falls on Christmas? True for the leave shown from the pattern and for leave recorded on either day.
- `christmasLeaveDates({ member, year, overrides })` · `christmasLeaveByYear({ member, overrides, thisYear })` · `christmasLeaveLine(dates)` — the leave records' Christmas dates and their one line ("…: annual leave, not counted"). The records list exactly the dates the Calendar shows as Christmas leave, because both ask `resolveDayShift`; a delete is offered only for leave somebody recorded.
- Tested by `christmas-leave.test.mjs` and the `christmas` e2e cases in `calendar.spec.js` and `admin.spec.js`.

### `leave-year.js`
Which year's allowance a day of annual leave comes out of. Pure, with no imports. **Default by rule, exception by record** — the `replacedType` pattern: a day counts against its own year with no record at all, and a January day moved to the year before carries `leaveYear: <year − 1>`. The owner's three decisions (3 Nov 2026) are in the header.
- `LEAVE_YEAR_CHOICE` / `leaveYearChoiceEnabled()` — whether the app OFFERS the choice (on); `__E2E.leaveYearChoice` pins either state in the browser suites. **Counting honours a stored year whatever the switch says**, so turning it off never moves a day back.
- `LEAVE_YEAR_FROM` · `isValidLeaveYear(date, y)` — exactly the shape `firestore.rules` accepts (January, the year before, a whole number) · `carriedFrom(record, date)` → the earlier year or null · `leaveYearOf(o)` → the year a winning AL record counts towards.
- `nextLeaveYear(existing, newType, date)` — what a REWRITE carries: leave over moved leave keeps the year, anything that stops the day being leave drops it. Stamped by every write path; re-exported by `override-utils.js` beside `nextReplacedType`.
- `canChooseLeaveYear(date)` · `offeredJanuaries(todayStr)` · `carryLine({ year, carriedIn, carriedOut })` → the Calendar leave panel's one line about days crossing New Year, or null.
- Tested by `leave-year.test.mjs`.

### `admin-leave-year.js` / `admin-leave-year-save.js`
The Admin AL card's "Which year's allowance" panel, and the save behind it. It draws the answer from `leaveYearChoices` (al-entitlement.js) and decides neither which days are listed nor the cap.
- `initLeaveYearPanel({ getMember, hasAuthority, getOverrides, save, onSaved, … })` → `{ refresh }` — refreshed from `updateALBanner`, so the panel and the banner always show the same moment. Hidden while the switch is off, while the member's records are unread, and when nothing is listed. **A tap is the save**: no Save button and no staged state; a saving day's buttons are disabled.
- `leaveYearPanelHtml(groups, { busyDate })` — the pure markup, including the cap's disabled state and its one-line reason. `leftWords(n)` → "3 days left" / "2 over".
- `setLeaveYear({ memberName, date, leaveYear, changedBy })` — the ordinary manual write (delete-then-set onto the fixed id, `source: 'manual'`, carrying `replacedType`), **refused unless the day is still that leave on the server** (`assertStillLeave`), so a stale page cannot resurrect cancelled leave. Its own module because `admin-overrides.js` is at its ratchet cap.
- Tested by `admin-leave-year.test.mjs` (the panel) and `admin-overrides.test.mjs` (the save).

### `admin-al-year.js`
Which calendar year the Annual Leave figures on `admin.html` describe. Pure, with no imports, so the precedence can be tested without a page — the ORDER is the whole rule, and the order is what broke.
- `alFigureYear({ pickedFrom, pickerViewYear, shiftDate, today })` → `'YYYY'` — strongest first: the AL range's picked start date; the year the range picker is DISPLAYING, but only once it has crossed a year (`pickerViewYear` is null until then); the week open on Change a Shift; then today. The header says why the first two rungs must not be "tidied".
- Fed by `admin-rangepicker.js`'s `onViewYearChange` (through `admin-range-booking.js` and `admin-al.js`), read by `updateALBanner` in `admin-app.js`. Deliberately not wired on the Absence card, which states no per-year figure (`admin-sick.js`).

### `trains-app.js` / `trains-boot.js` / `trains-change.js` / `trains-stations.js` / `trains-render.js` / `trains-data.js` / `trains-tips.js` / `trains-grid-mirror.js`
The Trains page: what changes at Marylebone when the December 2026 timetable starts on 13 December, organised by the station a customer is going to. Every signed-in member's, and the station PIN's too (`auth-policy.js` → `staffPin`). The sign-in is the app's ordinary front door, not protection: the timetable is public and `trains-data.js` is served to anyone. The page reads no network, so once opened it works offline. Each module's header carries its reasoning.
- `trains-app.js` — `init()`, run by `trains-boot.js`. Decides access from the LOCAL session, as Operations does: with no member it asks `holdsStaffPin` (behind `admitsStaffPin('trains')`) before offering a sign-in, and the PIN gets the page with nobody signed in (no session to guard; the drawer's Lock instead of Sign out). It owns the page state and which view is on screen — What's changing, Stations, Where they stop — and the wiring: one delegated click handler, focus returned to the pressed control's new copy after a redraw, a history entry for a station opened from the list, and the overview folding from the second visit. `timetablePhase` is read fresh on every render, so a page left open over the change turns with it.
- `trains-change.js` — pure judgements about two timetables, with no clock (`today` is passed in). `alignTimes` (one route's two time lists, paired in order at the least total shift, unpaired beyond `MAX_SHIFT_MIN`) · `foldWeekdayVariants` · `compareRoutes` → `RouteChange[]`, which runs `relinkAcrossRoutes` (a train cut from one route and added to another within `MAX_REROUTE_MIN` is one rerouted train) · `LINES` (a line's onward stops fold into it) · `lineDepth` · `routeKey` · `routeName` · `daysLabel` · `changeLabel` (the one place the change words are written) · `timetablePhase` (every date decision the page makes) · `railwayToday` (before 03:00 it is still yesterday) · `serviceMinutes` (the railway day starts at 03:00) · `daysUntil` · `dateWords` (no date is typed into a sentence) · `parseTypedTime` (refuses rather than guesses) · `trainsNear` · `NEAR_WINDOW_MIN` · `PATTERN_HOURS` (the daytime window) · `JOURNEY_PLANNER_URL`.
- `trains-stations.js` — pure: the timetable seen from a station. Every time is where the passenger gets on (`boardingTime`) and every count is of one real day (`aRealDay`). `parseStops` · `stopsKnown` · `callsOf` · `lineOf` · `callingAt` · `endingAt` · `knowableWithoutStops` / `decemberKnown` (December is answered only when it can be known; otherwise `null` and the page says it is waiting) · `summarise` · `stationView` · `stationTrains` (which train becomes which is decided once, by `compareRoutes`, so the station card and the lookup cannot disagree) · `verdictFor` · `hourChanged` · `rateWords` · `hourWords` · `hourNote` · `minutesWords` · `stopChanges` · `busiestStations` · `matchStations` (the ways people type a station) · `headlineChanges` (one line per station, consequence first) · `lastTrains` · `stoppingGrid` · `orderStations` · `pairColumns` · `stationBands`.
- `trains-render.js` — the page's HTML as strings, pure: `renderHeadlines` · `renderStation` · `renderGrid` · `renderLookup` · `renderTotals` · `renderPicks` · `renderLastTrains` · `endWords` · `DAYTIME` (the window in words, from `PATTERN_HOURS`). Station names, never codes, and every dot and chip carries words, never colour alone.
- `trains-grid-mirror.js` — `syncGridMirror(host)`: a fixed, `aria-hidden` copy of the stopping grid's column heads while the real ones are off screen. Fixed rather than sticky, because every ancestor clips (the header says why).
- `trains-tips.js` — `CARD_TIPS`, the page's `?` panels, where its caveats live. Every date, window and threshold is read from the page's own modules, and every line must hold on both sides of the change; `tips-content.test.mjs` evaluates them with the real values.
- `trains-data.js` — GENERATED by `docs/timetable-dec26/tooling/build.py`; never hand-edit. `CHANGE_DATE` · `DEC_VALID_UNTIL` · `FURTHER_CHANGES_UNTIL` · `LEAF_FALL` · `SOURCES` · `STATIONS` · `STATION_ORDER` (the books' own order, never typed) · `TIMETABLES.{now,dec}.{SX,SO,SU}.{dep,arr}` as `[time, station, route, days, stops]` rows, where empty `stops` means NOT KNOWN, never "no stops". Public data only; the generator's inputs are never committed.

### `newlink-app.js` / `newlink-boot.js` / `newlink-config.js` / `newlink-data.js` / `newlink-render.js`
The new link page (v25.06; "December link" until v25.10) — the three shortlisted proposals for the new CEA link, which starts on 1 January 2027 (Common Ground, Even Step and Short Run since v25.36), presented EVENLY to the colleagues who will work it: A to Z, the same colour, and no recommendation anywhere (owner, 2 Nov 2026). A PREVIEW for now, for the admin and the names in `CONFIG.NEWLINK_PREVIEW` — S. Silva, the RMT rep who leads the change, since v25.33 (owner, 4 Nov 2026) — through `auth-policy` `newlink: role ['admin', 'newlinkPreview']`, `canOpenNewlink` and the pill flag `newlinkAudienceOnly`; signed-in only, never the station PIN. Short Run was shown to colleagues first and the other two were drawn up since, so the page leads with what has changed since, then what all three share, then a choice of six ways of working with the three against today for each — the pack's one-page sheet, made into a choice.
- `newlink-app.js` — `init()`, invoked by `newlink-boot.js`. The gate, session wiring, and the two choices — a way of working (`persona`: null → the six one-line answers, an id, or `'all'`) and the proposal whose weeks are drawn (A to Z, first by default). Redraws keep focus on the pressed control. Reads no network.
- `newlink-config.js` — the SETTINGS, one decision a line: `PHASE` (`'preview'` — the admin and `CONFIG.NEWLINK_PREVIEW`; the only value built — opening to colleagues needs an audience role in `auth-policy.js` and a matching pill flag first, and `newlink-config.test.mjs` refuses any other phase until then), `CLOSES` (`'YYYY-MM-DD'` or null → "a date to be agreed"), `AUDIENCE` (null → every CEA on the roster, until the 26 on the new link are decided) and `audienceNames()`, `PACK_BASE` (the Pages mirror's `docs/links-26/` — Firebase Hosting serves nothing under `docs/`), `STARTS` (`'2027-01-01'` — the link's own start, not the timetable's), `TIMETABLE_STARTS` (`'2026-12-13'`, test audit 7 Nov 2026 — the new timetable's first day, which the status line reads to say the timetable "comes first, in December" before it and "started in December" after; `newlink-config.test.mjs` pins it to `CHANGE_DATE` in `trains-data.js`, so the two pages cannot name different days), `CONTACT` (`'S. Silva'`, owner 2 Nov 2026 — every line naming a person is built from it), `CONTACT_ROLE` (`'the RMT rep'` — who leads the change, owner 4 Nov 2026; nothing on the page may suggest the admin is in charge of it, and how the choice is made is left deliberately vague), `HAVE_YOUR_SAY` (which names the contact and who leads the change, and no more). The page has no last line under the cards since v25.11 (owner: "not needed"); `CONTACT_LINE`, `PREPARED_BY` before v25.10, went with it.
- `newlink-data.js` — GENERATED by `docs/links-26/tooling/newlink-data.mjs`; never hand-edit. `COLUMNS` (Today, then the three A to Z), `CHANGES` (what has changed since Short Run was shown — drafts, each figure asserted), `GAINS` / `COSTS` (what all three give and cost everyone, asserted shared), `PERSONAS` (the sheet's six bands: `{ id, icon, chip, who, gist, rows: [{ label, cells: [{ text, best }] }] }`), `NOTES`, `PACK` (the colleague PDFs, with page counts read from the files). The generator reads `what-it-means-data.mjs` — the same module the one-page sheet prints from — so the app and the paper cannot disagree; `newlink-data.test.mjs` runs it in `--check` mode.
- `newlink-render.js` — pure HTML strings: `renderStatus`, `renderPreviewBanner` (`others` names who else can see the preview — "only you and S. Silva", "only you and the admin" — from `previewOthers` in the coordinator), `renderList`, `renderCommon`, `renderFigures` (a label row above four figures; each figure tied to its label and column by `headers`; the best of the three marked in green AND said), `figuresKey` (the key beneath one table — the green and "up to", each only where the table uses it), `renderPersonas`, `renderPersonaChips`, `renderWeeks` (26 numbered weeks, a cover week as one cell, a "not your roster" flag, never a date), `renderAllWeeks` (every proposal's weeks A to Z, the chosen one marked — newlink.css shows that one on a phone and all three side by side on a wide screen, so no proposal gets the first look there), `renderWeeksKey` (above the weeks; says Sunday is overtime), `renderWeeksTabs`, `renderPack`; `aToZ` (the proposals A to Z — the built-in list keeps the pack's order, the recommendation first, so the page sorts its own tiles, weeks and tabs, and the coordinator opens the first of them); helpers `closesWords` (refuses a rolled-over date), `startsWords` ("1 January 2027", or null so the status says nothing rather than something untrue), `dutyKind` (an early starts before 11:00 — the pack's line), `designName`, `ifYou`. No `title` attributes.
- **The boundary.** `newlink-boundary.test.mjs` walks the import graph from the Calendar (month, Team Week, day panel), the Pay Calculator and Admin, and fails if `links-proposals.js` or any `newlink-*` module is in reach — a proposal is never one call away from a member's own roster.

### `overtime-phase.js`
Where the week stands, in the MEMBER's terms — and the two deadlines that decide it (v23.84). Pure; imports only `date-format.js`.
- `phaseAt(win, nowMs)` → `INITIAL_OPEN` / `FINAL_OPEN` / `CLOSED` — the client twin of the server's `phaseFor` (pinned by `overtime-parity.test.mjs`). The reviewer workspace derives a week's phase with it, because the overview's rows carry none. `deadlineLabel(ms)` → "Tue 18 Aug · 12:00" (weekday first, spelled by `formatWeekdayDate(londonDate(ms))`). `phaseCopy(phase)` → the sentence (v20.70 rule: describes the member's own position, names no document they do not receive). `phaseChip(phase)` → 'Open' / 'Still open' / 'Closed'. `phaseTone(phase)` → `ok` / `warn` / `done`, the horizon's own classes, so the member's week band and the reviewer's week row colour one state one way. `deadlineLines(phase, initialAt, finalAt, openedAt?)` → both dates as `{ text, label, value, lead, warn? }`, `text` always `label + ' ' + value`; exactly one `lead`; the passed deadline turns "were due" and STAYS; only the FINAL_OPEN sentence carries `warn`, and the form head prints prose only when it warns. **A window OPENED after its first deadline** (`openedAt >= initialAt`, FINAL_OPEN) gets no "were due" line — it never had a first deadline for this member — but "Answer by" the final one as the lead, and a `warn` line saying planning has already started.
- **Why it is its own module.** Extracted when `overtime-format.js` hit its 1030-line ratchet a second time in three releases. That file formats ANSWERS; this one formats TIME. `deadlineLabel` came with the deadlines because a module that imports from its own re-exporter is a cycle. Everything is re-exported from `overtime-format.js` — the `isWorkingDate` pattern — so no import and no test moved.

### `overtime-answer.js`
The ONE place a day's answer is edited on the Overtime form (v23.87, from the external review of v23.85). Pure; no imports.
- `withMode(previous, mode, shift)` → a mode press, carrying forward what the new mode does not contradict (the same object back when the mode is unchanged — the v20.75 re-press rule). `withFullTwelve(previous, on)` → the willingness tick; a no-op on a day with no mode or on `unavailable`. `withRelease(previous, on)` → the Sunday-release request; ON a day with no answer yields `{ releaseRequested: true }` with NO mode, and OFF on such a day yields `undefined` — exactly unanswered again.
- **Why it is its own module.** A day carries three independent statements — the overtime mode, the willingness tick, the Sunday-release request — and the form edited them in three places, each knowing about some of the others. The review found the two that did not: the request wrote `{ mode: 'unavailable' }` under an unanswered day (the one answer this feature may never invent — invariants 1 and 2 — and the completeness check then stopped asking for the Sunday), and a mode change, or the bulk Not-available fill, dropped the request with nothing on screen to say so. Both are the same shape: a transition that forgets a field it was not asked to touch. So every transition is here and `overtime-answer.test.mjs` asks each one what else it changed.
- **Five rules, in the header.** The request is not an answer (a mode-less working answer is a state `dayUnfinished` reads as unfinished, so Submit refuses it and the server's mode-required schema is untouched); every mode keeps the request; `unavailable` alone drops the willingness tick (the server refuses that pairing); a flag off is DELETED, never stored `false` (or `sameAnswer` reports a saved form as changed for ever); nothing mutates.
- **The form's only job is the wiring** — `setAnswer(date, next)` puts the result back and deletes the day when `next` is `undefined`. `e2e/overtime.spec.js` proves the wiring in a browser: ticking the request leaves the Sunday among the days still to answer, and the request survives a mode press and the bulk fill.

### `overtime-sunday-release.js`
Asking to be taken off a Sunday you are ROSTERED to work (v23.81, owner). Pure — one predicate, one formatter, two strings.
- `offersSundayRelease(date, ctx)` → may this day offer the control? `releaseRequestLine(day)` → the reviewer's flag, or `''`. `SUNDAY_RELEASE_LABEL` / `SUNDAY_RELEASE_ASKED` — the member's two lines.
- **Why it is its own module.** Every other rule on the Overtime page is about OVERTIME: extra work a member is offering, when they can do it, how long they would go. This is about their CONTRACTED work, and it is a REQUEST, which nothing else there is. Two subjects in one file is how `overtime-format.js` reached a thousand lines.
- **The gap it closes.** Sundays are uncontracted for every grade, so leave and absence cannot be written on one (`SUNDAY_FORBIDDEN_TYPES`) — right, and what stops a Sunday costing somebody a day they do not owe. The consequence was that a fact the depot's workbook has always stated, a free-text tag in the Sunday row used on **52 of its 75 tagged Sundays**, had no representation in the app at all. The external review of v23.78 proposed a new non-entitlement absence type; **the owner's answer was a request through the form the member already fills in for that week** — no new kind of absence, and the fact lands where it is acted on.
- **Three conditions, and the third is the dangerous one.** A Sunday; rostered to WORK it (nothing to be taken off a rest day); and **the roster actually read**. A null context is a failed read, not a rest day, and offering there would invite a member to ask to be released from a duty that may not exist — the same class of error as offering "Available after 15:00" anchored to a shift nobody could read. Withholding on unknown is the direction every unknown resolves on that page. A context present but missing `isRest` is treated as rostered: the day WAS read, and nothing said it was rest.
- **It grants nothing**, and the wording is the whole of the promise — `OVERTIME_AVAILABILITY.md` invariant 14. The test asserts no surface says approved, granted, agreed, confirmed or accepted.
- Consumed by `overtime-form.js` (the control) and `overtime-manager.js` (the reviewer's flag, rendered BESIDE `answerCopy`, never merged into it — invariant 14). Stored as `releaseRequested` by `functions/overtime-core.js`, which shipped one release earlier so no client could outrun its server.

### `al-swapped-days.js`
Which days in an annual-leave booking need the SWAPPED-DAY question, and what to write when the answer is yes (v23.75). Pure — three functions, no DOM.
- `swapDecisionDates({ dates, memberObj, ovByDate })` → the dates needing an answer, ascending. `replacedTypeForSwap(existing, newType)` → the `replacedType` to record for a declared swap.
- `rangeWriteDates({ type, dates, memberObj, ovByDate, swappedDates })` → the dates `recordRangeOverrides` writes. An ASKED date is written only when answered swapped: the old filter was `isWorkingDate`, which reads the VALUE, so a rest day holding an absence passed it and took leave the admin had answered "Rest day — free" (review A2). Absence is never asked, so an absence range is unchanged.
- Reads THROUGH an absence as well as leave to what it replaced (`contractEvidence`, `override-utils.js`), so a swap already on record under an absence is not re-asked.
- **The defect it closes.** Leave on a base-roster REST day does not consume entitlement, which is right — it stops a stray booking and a declined overtime day costing somebody a day. The one exception is a member who **swapped** working days and booked the swapped-in day off, and the app's only record of that is `replacedType: 'shift'`, which until v23.75 could be set **only as a side effect** of writing AL over an existing `shift` override. So the answer existed and the question was never asked, and **the two booking paths decided it silently in opposite directions**: the AL range card SKIPPED rest days without writing anything, the week grid WROTE the leave but left it costing nothing. Neither said so. Found by the owner on 14 Sep 2026 only because the depot's workbook disagreed by three days.
- **The two rules the owner set, and they are both about the asking.** Ask ONLY when a day is actually affected — no rest days in the booking, no question, and the card behaves exactly as before. And a question that appears must be ANSWERED: no default, the save waits. A default is how this went wrong, and a visible default is still a default.
- **"Rest day" is not the whole test**, which is the subtle half. The question is meaningful only where the BASE ROSTER is what makes the day free, so it is never asked about a Sunday (uncontracted for every grade, cannot hold AL at all), an `rdw` day (voluntary work — asking there invites an admin to charge somebody for giving back overtime), or a day already carrying contracted work or a settled `replacedType`. That condition is read from the same helpers `consumesEntitlement` uses, so the two cannot drift.
- `replacedTypeForSwap` falls back to `'shift'` when there is nothing to carry forward, but **keeps a stronger existing record** — `spare_shift` and `other` are contracted work too and must not be flattened. Every value it can produce is inside the vocabulary `firestore.rules` validates `replacedType` against, which is what makes this need no rules change.
- Consumed by `admin-al.js` (the `swapQuestion` hook on `createRangeBookingSection`), `admin-overrides.js` (`recordRangeOverrides`'s `swappedDates`), `admin-al-projection.js` and `admin-week-editor.js`. **Deliberately not wired to the Absence card** — being off sick on a day you were not due to work is a different question, and not one this answers.

### `admin-al-projection.js`
What an Annual Leave booking WILL do, decided once and read by every surface (v23.79). Pure — three functions, no DOM, no Firestore.
- `willConsume({ member, date, ovByDate, swapped })` → does this one date cost a day? `projectAlBooking({ member, dates, ovByDate, swapAnswers })` → `{ asked, unanswered, consuming, freeWritten, skipped, answeredFree, writing, lieuLost, counts }`. `projectAlOverage({ member, memberName, overrides, consuming, exclude, after })` → the over-entitlement message, or `null`.
- **The allowance is the one AFTER the save** (6 Nov 2026, 72-hour review). Leave written over a worked Boxing Day takes back the day in lieu that work earned, and recording that work earns it, so a save could be costed against an allowance it was about to change: a false "1 day over", or no bar on a save that ended a day over. `overridesAfterSave(overrides, { memberName, writes, deleteIds })` builds the post-save list, `projectAlOverage` reads the allowance from `after` when given and also checks any year whose allowance the save LOWERS (7 Nov 2026 — a rising one raised a false bar for a member already over), and `projectAlBooking`'s `lieuLost` lets the range card's preview say the day in lieu goes. `lieuLost` is read off `entitlementFor` with and without the leave, so a Dispatcher's worked bank holiday counts as well as a worked Boxing Day; `lieuGoesWords(dates)` is the preview's sentence for them (Christmas Day and Boxing Day by name, any other bank holiday by its date).
- **The defect it closes** (external review of v23.78). v23.75 wired the swapped-day answer straight to the WRITE and left everything else reading the stored override map, which at that moment still says REST. So three layers could describe one save three ways: the PREVIEW said *"1 rest day skipped"* about a day Save was about to count; the WARNING projected the year's entitlement **without** that day, so a member with one day left could be booked two and never see the confirmation bar; the WRITE then recorded both, correctly, and left the balance negative. **The entitlement maths was right at every step** — each layer was asking a different question, and only the last one knew about the swap.
- **The rule is one line and it is the whole fix:** a day consumes entitlement if the admin has DECLARED it swapped, **or** if the record already says it is contracted work. Both halves are load-bearing — without the first a swapped day is invisible until it is written; without the second the week grid would re-ask what its own pending `shift` override has already answered.
- **Four sets, because four things can be true of a date** and the preview was wrong exactly where it collapsed them: `unanswered` (a question, and it blocks the save), `consuming`, `freeWritten` (an `rdw` day — written, but declining overtime is not leave), `skipped` (Sundays, and rest days answered "free"). **`skipped` may never contain a date from `consuming`** — nothing may call a day skipped when Save will count it.
- **`answeredFree` is a SUBSET of `skipped`, and it exists because the two halves are decided by different things** (v23.88, external review of v23.85). It holds the days the surface ASKED about and was told "rest day — free"; the rest of `skipped` is a rule about days nobody was asked about — a Sunday, or a rest day whose own record settles it. The week grid is a per-day edit, so it acts on the answer it asked for: it drops `answeredFree` from its batch and writes everything else it was told to. Reading `skipped` there would let a rule about RANGES decide what one deliberate row edit does. Until v23.88 the grid wrote that day as leave costing nothing while the AL card wrote no document at all — one answer, two meanings, and a Calendar showing AL on a day the manager had just called a genuine rest day.
- `projectAlOverage` takes the caller's `consuming` list rather than re-deriving it, which is the point: the range card builds it from `projectAlBooking`, the week grid from its batch plus each row's answer, and both therefore warn about exactly what they are about to write. A `null` entitlement skips the year rather than raising a bar against a figure the app does not have (v22.45) — the write still goes ahead.
- Consumed by `admin-al.js` (the `project` and `preSave` hooks) and `admin-al-week-save.js` (the week-grid save, called from `admin-app.js` as `planAlWeekSave`), which reads `consuming` for the over-entitlement bar AND `answeredFree` for what to write — one call, so the two cannot disagree. Tested by `admin-al-projection.test.mjs`, including the regression the review specified — one day remaining, one working day and one newly declared swapped rest day must raise the bar — and teeth-verified by two mutations.

### `admin-time-inputs.js`
The Admin week grid's time boxes, extracted from `admin-week-editor.js` at v24.64 (it stood one line
under its cap). Export: `initTimeInputs()` — attaches two delegated `document` listeners once per page
life: on `input`, reformat with `formatClockInput` (clock-input.js) and move focus on a REAL time
(row start → its end, `#bulkStart` → `#bulkEnd` — `24:00` also fills the box, and does not move on); on
`focusout`, settle the value with `finaliseClockInput` and flag one that fails `TIME_RE` with
`.input-error` and `aria-invalid`. The editor carried its own copy of the typing rule until this
extraction; it now uses the shared one, so the week grid and every other clock box cannot drift. The
`_formatting` re-entry guard is load-bearing on iOS Safari, where assigning `value` inside an `input`
listener fires another `input`.

### `admin-week-row-state.js`

The Admin week grid's per-ROW appearance, extracted from `admin-week-editor.js` at v23.98 — not
because the code changed, but because that file was AT its ratchet cap with zero headroom, and the
next change to the week grid would have had to choose an extraction under a hard stop. Under a hard
stop the cheapest cut wins, which is the failure this pre-empts.

**Two candidates were measured and the obvious one lost.** The bulk bar looks like the seam — its
own UI strip, its own `bulk*` ids, its own state — but moving it needs SEVEN injected dependencies
for 181 lines. A boundary that has to be told about seven things is a cut, not a boundary. This
cluster needs none: 129 lines importing `TYPES` and `setStatus` and nothing else, every function
taking a row element and reading the DOM beneath it. The proof it was clean: `setStatus` became
unused in the editor and moved here whole.

Names are unchanged, so every call site in the editor reads exactly as before.

- `_activateRow(row, checkbox, pills, startEl, endEl, type)` / `_deactivateRow(row, checkbox, pills, startEl, endEl)` — a row's two states. Deactivating clears `dataset.type`, which is what stages a DELETE of a saved doc — see the warning at its one bulk-bar call site.
- `_syncOtherRdwWarn(row)` — the "originally rostered" warning, shown only when the RDW tick is on for a day whose base roster is NOT a rest day.
- `_syncOtherSpareMode(row)` — Spare hides the RDW tick and the times; the other Other-family flavours restore them.
- `_syncOverwriteBadge(row)` — keeps the badge in step with the row's current state.
- `_syncAlSwap(row)` — the swapped-day question follows the row: shown for STAGED leave on a day `swapDecisionDates` asks about, hidden and its answer cleared otherwise. Called by `_activateRow`/`_deactivateRow`, so the pill, bulk apply, the checkbox and the bulk tick buttons share it (it lived in the pill handler alone, so bulk-applied leave on a rest day was refused at Save with the question hidden — review A6). A prefilled, untouched row is not asked. `_activateRow` also re-applies Spare mode when Other is re-selected with the Spare chip still on (review A18).

**Keep it dependency-free.** If something here starts needing the editor's state or its injected
services, the seam has moved and this is the wrong home for it.

### `admin-al-week-save.js`
What ONE week-grid save does about the annual leave in it (v23.91, external review of v23.89). Pure — one function, no DOM, no Firestore.
- `planAlWeekSave({ member, memberName, toSave, toDelete, ovByDate, swapAnswers, overrides })` → `{ toSave, skipped, overage }`. `toSave` is the batch to write, the SAME array when nothing was dropped; `skipped` the dates deliberately left alone, for the receipt; `overage` the confirmation message or `null`.
- **Why it is its own module.** `admin-al-projection.js` says what a DATE means; this says what a BATCH does with a set of them, and the sequence was twenty lines inside a 1,700-line `init()` behind the session guard — reachable only through a browser, and sitting in a file at 1,694 of a 1,700-line cap with two more Admin modules at theirs. The review named it as the extraction due before Admin gains any more logic.
- **Two orderings, and they are the testable part.** The answered-free drop happens BEFORE `exclude` is built — a day left alone overwrites nothing, so excluding it would hide a day of the member's existing leave from the entitlement check. And the bar reads the projection's `consuming`, never the batch: leave over an `rdw` rest day IS written (the member gave back overtime) and costs nothing, so counting the batch would raise a bar against a day nobody is charged for. Both are mutation-verified in `admin-al-week-save.test.mjs`.
- What stayed in `admin-app.js` is the DOM half: show the confirmation bar, or commit.

### `admin-al-spare-note.js`
The one sentence the Annual Leave booking preview says when a booked day's base shift is `SPARE` (v23.73). Pure — one function, no imports, no DOM.
- `spareShiftNote(spareCount, totalDays)` → plain text, or `''` when there is nothing to say. Three branches, because English has three: a one-day booking says **"This is a Spare day"** (there is no "these" to be one of), one Spare day inside a longer booking says **"1 of these days is a Spare day"**, and several say **"N of these days are Spare days"**.
- `countSpareDays(memberObj, dates, ovByDate)` → number — how many of the dates are STILL Spare: read through `resolveEffectiveShift`, so a Spare day a roster upload (or Change a Shift) has since assigned a shift is not counted, and a saved Spare override is. Sundays never count. It read the base roster alone until v24.44, which told the owner a day whose shift had been assigned was "not yet assigned".
- **A day is a day** (owner decision, 14 Sep 2026), and the note exists to SAY so — every branch ends "uses 1 day of annual leave". The text it replaced said a shift longer than seven hours "may use more than 1 AL day" and sent the reader to their manager. That was wrong on three counts: the app charges whole dates (`countedAlDates` returns a Set of them, `alPosition` subtracts their count); the depot workbook charges one day per Spare day in the register; and the sentence was an inversion of an older WEEK-level instruction ("for shifts over 7h, add RD corrections to reduce to 4 AL days") that pointed the other way and never applied to a single day. It asked a member to resolve a discrepancy the app had invented.
- **It carries 📋, the Spare badge, not ⚠** — this is information, not a caution. And it is **third person**: a manager books on somebody else's behalf from the same card, so "you're on standby" would address the wrong person half the time.
- **Why it is a module.** It was a template literal inside `renderReady` in `admin-al.js`, which imports Firebase through `admin-overrides.js`, so no Node test could render it — and none did. It pluralised `day` and nothing else, so it shipped as *"1 of these day is"* and *"2 of these days are an unconfirmed shift"* from v11.35 until the owner read the first off a phone at v23.72. The repo's own named blind spot, so the fix is a pure function with a unit test **and** an e2e that drives the real card (`e2e/admin.spec.js`) — reverting the literal fails the e2e, which is how the reproduction was confirmed.

### `admin-period-dates.js`
What a run of booked dates IS, and what it reads as. (v23.54.) Four pure functions extracted from a 1,600-line `init()` in `admin-app.js` — where no test could reach them — and already being handed OUT of that closure to `admin-booked-periods.js` as `isRestGap`, `addDays`, `fmtDate` and `fmtRange`. Code passed to another module as a set of named collaborators is that module's neighbour, not the coordinator's private business.
- `addDays(dateStr, n)` → ISO string; `formatDisplay(str)` → `"18 Mar 2026"` (moved from `admin-overrides.js`, which re-exports it); `fmtPeriodDate(d)` → `"Mon 15 Jun"`; `fmtPeriodRange(start, end)` → `"Mon 15 – Fri 19 Jun"` within one month, both months when it crosses one (otherwise the reader cannot date the start).
- `isRestGap(dateStr, memberObj)` — **the rule worth knowing: a gap is not the same as a day off.** It decides whether two bookings either side of a date are ONE period or TWO. A Sunday is always a gap (uncontracted for every grade, so leave is never recorded on one). A day the member's BASE roster gives them off is a gap for the same reason — they were not due to work it. **Anything else is not**, including a day whose base shift cannot be resolved, which is what a null member gives: absence of evidence must not read as a rest day.
- The two ways of being wrong are not symmetrical. Splitting wrongly shows a manager two short rows where one belonged; **merging wrongly states one unbroken run of leave across a day that was actually worked** — silent, and the box looks tidier than the truth. Tested by `admin-period-dates.test.mjs`, organised on exactly that asymmetry and teeth-verified by five mutations.

### `admin-booked-periods.js`
The **Recorded Annual Leave dates** and **Recorded absence dates** sub-cards on `admin.html` — one list of one shape, differing only in the type it filters and the colour of its count pill — and which YEAR of it is on screen (v23.09). Imports nothing; every DOM and data handle is injected, so the two decisions below are testable in Node.
- `splitAtYearEnd(periods, dateList)` — cuts every merged booking at each year end so no segment crosses 31 Dec → 1 Jan, recounting each segment's days from the booked **dates** (a bridged rest day is not leave). Every segment that is a piece of a longer booking carries `splitFrom`, which the row renders as *continues into next year* / *continued from previous year*. **Owner decision, v23.11**: the first cut filed a booking under the year it started in, and the owner's own 28 Dec → 1 Jan leave showed 1 January missing from the 2027 list — the year a member opens to see what leave they have in it.
- `bookedYears(segments)` → `['2026','2027']` — the years this member has bookings in, ascending. After the split, a segment's start year is every date's own year.
- `pickBookedYear({ pinned, preferred, years })` → a year **present in `years`**, or `null`. Precedence, and each rung answers a different question: a **pinned** tap outranks anything inferred; then **preferred**, the year the AL banner is describing (`admin-al-year.js`), so the list opens on the year you are already working in; then the **most recent year with data**, for a member whose bookings are all in the past. The safety property is the return type — every other outcome renders an empty list, and an empty list on this card reads as "nothing booked".
- `createBookedPeriods(deps)` → `{ render(cfg), resetPinned(), pin(boxId, year) }` — the DOM half. On the AL card `cfg.christmasFor(year)` lists that year's Christmas leave days, and is asked for every year on the list and for a pinned year — not only up to this year, or a later year's list (and a deep link to it) lost its Christmas row (6 Nov 2026). `resetPinned` is called by `admin-app.js` on a member change: a year chosen for the last person is not a choice about this one. `pin` chooses a year as if its chip were tapped — `admin-app.js` calls it for `?alYear=YYYY`, the Calendar leave panel's "View recorded leave" link (v24.46); a year with no bookings is ignored by `pickBookedYear`, so a link never opens an empty list.
- **Why it left the coordinator:** it grew a rule. The list was fine at four rows and unusable at fifteen — the owner's own card ran January 2026 to June 2027 in one scroll, with every month header repeating the year because nothing else said which one a row was in. `coordinator-ratchet.test.mjs` had already named this function as `admin-app.js`'s next extraction candidate.
- **It states no TOTAL.** The banner directly above owns the figures and this owns the dates — one fact, one home. Since v23.11 both cut on the date, so each year's list adds up to exactly what the banner counts for that year; the earlier reason for withholding a figure (the two would have disagreed by the days in a year-spanning booking) no longer applies, and the one-home reason stands on its own.
- Consumed by `admin-app.js` (`updateALBookedBox` / `updateSickBookedBox`); `admin-app.js` passes `preferredYear` from `alFigureYear` on the AL card only, matching `admin-sick.js`'s no-per-year-figure rule.

### `admin-sick.js`
Sick Days Recording section (extracted v9.93; thin config wrapper over `admin-range-booking.js` since v16.08).
- `initSickSection(deps)` — supplies the sick config to `createRangeBookingSection`: the 1-year cap (maternity / long-term absence) and the 🪑 preview. No entitlement check and no confirm bar (absence is not capped). **No per-year figure anywhere on the card** (checked behaviourally at v22.82, not assumed), which is why `admin-al-year.js`'s year ladder has no analogue here: the 1-year cap is measured from the picked start date, the preview is built from the picked dates, and the booked-absences box (`admin-booked-periods.js`) is handed no `preferredYear`, so it opens on the most recent year with an absence rather than following any picker — the year chips make which year is shown explicit without a figure being implied. The picker's `onViewYearChange` is therefore deliberately unwired on this card. Receives DOM handles and callbacks via `deps` to avoid circular imports.
- Imports `escapeHtml`, `parseISODate` from `roster-data.js`; `createRangeBookingSection` from `admin-range-booking.js`.

### `admin-overrides.js`
The Change a Shift coordinator: the save paths (`executeSave`, `recordRangeOverrides`), validation glue and `buildMemberDateMap`. The grid, list, cache and type table live in `admin-week-editor.js` / `admin-saved-changes.js` / `admin-override-store.js` / `admin-shift-types.js` (v21.38) and are RE-EXPORTED here so `admin-app.js` keeps one import site; the entries below that name them describe the re-export.
- `TYPES` — type metadata object (label, pill, fixed, fixedValue). `pill` is the short button label used in both the per-row grid and the bulk bar.
- `PILL_TYPES` — ordered array of type keys for both pill lists (`['annual_leave', 'shift', 'rdw', 'sick', 'correction', 'other']` — 6 since v15.57; `spare_shift` removed from the top row and demoted to a chip in the Other submenu). Single source of truth — `renderWeekGrid()` generates per-row pills from this; `admin-app.js` generates bulk-bar pills from this at init. Never duplicate the list. (v13.48; `training` added v15.37, renamed `other` v15.40 — `TYPES.other` is `timesOptional: true` (time inputs shown, blank = valid → pay defaults) and activating it reveals the per-row `.other-opts` sub-controls: flavour Train/Ind/Assess/Team + a 📋 **Spare** chip (v15.57 — picking Spare writes a `spare_shift`/'SPARE', NOT an 'other' day, and hides the RDW tick/times via `_syncOtherSpareMode`) + an RDW tick pre-ticked on rest-day bases; the save collector in admin-app.js composes the grammar `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`; `validateShiftRules` validates the time part of a timed training and skips untimed ones; Sunday training is blocked at pill/bulk/collect layers.)
- `initOverrides(opts)` — called once by `admin-app.js` after login; receives callbacks
- `renderWeekGrid()` — generates per-row type pills from `PILL_TYPES`
- `loadOverrides({ everyone?, member? })` / `ensureMemberLoaded(member)` / `renderTable()` — Saved Changes list. **Staged since v21.38**: the default read is `where('memberName','==',…)` for the selected member (no cap, no composite index); the capped whole-collection read runs only when the All-staff view asks, and once it has, later resyncs stay whole. A failed read offers **Retry**, not a page reload — a reload re-runs sign-in and every other card to recover from one dropped request, and discards staged week-grid edits
- `executeSave(toSave, toDelete = [], skipped = [], keptLeave = [])` — writes the staged overrides to Firestore. Each entry's `existingId` is RE-READ from the cache at save time (re-review R-A5): a range booking made while a row sat staged can have replaced that row's document, and deleting the stale id left the range's copy beside the new one
- `updateSaveBtn()` — exported so swipe carousel can call it
- `setSaveInFlight(on)` — re-exported from `admin-week-editor.js` (v24.26) so admin-app's Save handler can hold Save, and the sticky bar's two buttons, disabled across its own boot-load wait; a plain `disabled = true` was re-armed by the next keystroke's `updateSaveBtn`.
- `isSaveInFlight()` — re-exported from `admin-week-editor.js` (v24.38) for the leave/absence range cards, which share the page's one write lock
- State accessors: `getAllOverrides()` / `setAllOverrides()` / `removeFromCache(ids)` — `getAllOverrides()` used by `admin-al.js` (entitlement check). **`setAllOverrides` ASSERTS completeness** and grants full coverage; **`removeFromCache` drops rows and grants nothing** (v21.38). The period-delete path uses the second: routing a delete through the assertion made the cache claim it held every member the moment anybody deleted a booking, after which All staff would render one member's slice and call it everybody
- `recordRangeOverrides({ type, value, memberName, dates, changedBy, swappedDates? })` — shared batch-write helper called by `admin-range-booking.js` on behalf of both booking sections; filters out Sundays and RD days EXCEPT rest days declared swapped (`swappedDates`, v23.75), which it writes; writes Sunday RD corrections alongside AL/sick overrides, updates `_allOverrides` cache, and re-renders the week grid and override list
- `formatDisplay(str)` — shared date formatter (`YYYY-MM-DD` → `18 Mar 2026`); imported by `admin-range-booking.js` for the AL/absence range labels. Re-exported from `admin-period-dates.js`, where it has lived since the file reached its line cap
- `getEffectiveShift(memberName, dateISO, batch, toDelete = [])` / `validateShiftRules(...)` / `buildMemberDateMap(memberName)` (reads the module's `_allOverrides` cache filtered by member) — shift-resolution + validation helpers, covered by `admin-overrides.test.mjs`. **The RULES inside `validateShiftRules` moved to `admin-shift-rules.js` at v21.38** — this now resolves the adjacent days, asks `checkShiftRules`, and marks exactly the rows it is told failed
- `isWorkingDate(memberObj, dateStr, ovByDate)` — re-exported from `al-entitlement.js` (moved there v23.79); SINGLE SOURCE for the AL/absence "is this a working day" rule (Sunday→override→base). Used by recordRangeOverrides AND the AL/sick previews; previously reimplemented 4× and the previews had drifted from the save path (v16.06 unified + fixed).
- `whenOverridesReady()` — resolves once the FIRST `loadOverrides()` has SETTLED (success OR failure); the three write/validate paths await it so they never act on a cold cache (v16.85). `isOverrideCacheLoaded()` (v16.97, Finding #2) is the companion SUCCESS flag — but since **v21.38 the load is STAGED and the question a WRITE must ask is `hasOverrideAuthorityFor(member)`**, because the cache can be loaded and know nothing about the member on screen (`coversAllStaff()` answers the All-staff LIST's separate question). Rules + reasoning: `admin-override-coverage.js`. The older flag stays as the page-wide "has anything loaded" signal: `whenOverridesReady` resolving on failure (so the Save button never hangs) would let a write build from an EMPTY cache — duplicate overrides, an erased worked Sunday, a missed <12h rest gap — so `recordRangeOverrides` (throws `cache/load-failed`), `executeSave`, and the admin-app click handler additionally refuse when this is false. Latches true on a successful load or `setAllOverrides`; a later refresh failure keeps the last-good data. Tested by `admin-overrides.test.mjs`.
- Also exported (grid/bulk internals reused across the module and by `admin-app.js`): `resetTableMemberFilter()`, `updateWeekNavLabel()`, `buildWeekGridInto(container)`, `resetBulkPills()`, `_hasStagedEdits()` (true when any week-grid row holds a staged-but-unsaved add/change/removal — the background-refresh paths in both modules skip `renderWeekGrid()` while it's true so a refresh can't clobber staged rows)

### `admin-save-receipt.js`
What a save did, said day by day (v21.38). Pure.
- `buildSaveReceipt({ toSave, removed, memberName, formatDate, describe, skipped?, keptLeave? })` → `{ summary, lines }` — a day the save left alone (`skipped`) or whose existing leave stood (`keptLeave`) is named too
- One line per DATE, in date order — not per document and not grouped by kind, because a manager checks a receipt against their intention and their intention was a run of days
- A REMOVED day is named, not omitted: an absence in a receipt reads as the receipt being short, not as a change. Its old value is deliberately not repeated (it invites reading as the new one)
- `removed` must be captured BEFORE the batch commits — afterwards the rows are gone

### `slow-save.js`
Say so when a save is waiting for signal (v24.21). The watcher is pure (timers injected); the notice is one reference-counted live line.
- `watchSlowCommit(promise, { ms, onSlow, onDone, setTimer, clearTimer })` → the SAME promise. `onSlow` fires once if still unsettled after `ms`; `onDone` fires on settlement only if `onSlow` did
- `writesInFlight()` → how many wrapped writes are still waiting on the server, slow or not — plus one while `hasUnconfirmedWrite()` (claim-retry.js, v24.39), since an abandoned write has settled here but Firestore still holds it. Admin's service-worker `beforeReload` asks it and treats a pending write like unsaved changes: a range booking commits in chunks, and a reload between two strands the rest (review A13)
- `withSlowSaveNotice(promise)` — wraps an app write: after `SLOW_SAVE_MS` shows `#slowSaveNotice` (`role="status"`), hides it on settlement. Pass-through: the caller's receipt and error paths are unchanged
- `SLOW_SAVE_MS` (8000) · `SLOW_SAVE_TEXT` · `SLOW_SAVE_TEXT_BATCHED` (v24.23) — `withSlowSaveNotice(promise, { batched: true })` for a write that is one of several chunks: only the chunk in flight is held on the device, so the batched line asks the reader to KEEP THE PAGE OPEN rather than saying they can leave. The roster upload and long leave/absence ranges pass it. The notice's CSS lives in `shared.css` since v24.23 — the roster upload runs on Operations, which does not load `admin.css`
- **Why:** with `persistentLocalCache` a write lands on the phone first and `commit()` then waits for the server with no limit — on a weak signal the Save button sat on "Saving…" and read as a freeze
- `slowSaveText(batched)` · `SLOW_SAVE_TEXT_ONLINE` · `SLOW_SAVE_TEXT_BATCHED_ONLINE` (v24.54) — the notice names the SIGNAL only when `navigator.onLine === false`; otherwise it says the server has not confirmed yet. It is a timer and cannot know why a save is slow; an iPhone with full bars was told "Waiting for signal" on every save
- `SLOW_SAVE_EVENT` (v24.54; two phases v24.55) — a SLOW save dispatches `{ phase: 'slow' }` when it passes the threshold and `{ phase: 'done', ms, onlineWhenSlow, batched, ok }` when it settles. On `slow`, `error-reporter.js` starts timing a sign-in token (auth vs connection); on `done` it records the online-when-slow case with that token time (at most three a page session) in the Error Log as "Slow save (diagnostic)", so a device whose saves are slow with full signal leaves evidence. An event, not an import, to keep this module Firebase-free
- **It never says "saved"** (a held write can still be refused when it arrives) and **never re-enables the button** (every save mints new ids, so a second tap duplicates). Wired into all six admin override writes; `window.__E2E.slowSaveMs` is a test seam only

### `admin-shift-types.js`
The shift-type table (v21.38). Pure data, no imports — which is what lets every consumer read it without importing the coordinator back.
- `TYPES` — per-type metadata (label, pill, fixed, fixedValue)
- `PILL_TYPES` — the ONE ordered declaration of which pills exist; both pill rows are generated from it
- `WORKED_OVERRIDE_TYPES` — the types a Sunday RD-correction must never overwrite. Not the retired `allocated`/`overtime`/`swap`: no record is of them (owner, 7 Nov 2026 — Operations' count after the 4 Nov conversion read none left)
- `rowValueText(type, value)` → the text a Saved Changes row should print for the stored value, or `''` when printing it would only repeat the badge beside it (v23.76). The absence row read **“Absent  SICK”** and the leave row **“Annual Leave  AL”**; the first is worse than clutter, because `SICK` is a word this app does not put in front of staff (the reason for an absence is never stored) and it sat on the Admin page's list of everything ever recorded. The test is the same `fixed` flag that makes the value derivable, not a list of types to hide, so a type added later is handled by its own declaration. **It fails toward SHOWING** — an unknown type, or a value that disagrees with the fixed one it should have, is printed, because a row whose data contradicts its own type is exactly the row an admin needs to see.

### `admin-week-editor.js`
The seven-day grid and everything staged but not saved (v21.38, extracted from `admin-overrides.js`).
- `setSaveInFlight(on)` (v24.23) — `executeSave` sets it around its commit; while set, `updateSaveBtn` keeps Save AND the sticky bar's Save/Discard disabled — and the unsaved banner's "Discard and continue" (review A9: navigating mid-save let the landing save reset the new view's rows; `executeSave` now also resets and repaints only the view it saved). Before it, any keystroke re-armed Save mid-save, and Discard stayed live on a save that then landed anyway
- `isSaveInFlight()` (v24.38) — the same flag, read. The range cards refuse to start while it is set and hold it while they write: a range booking and a Change-a-Shift save on the same day each deleted the old record and each wrote a new one, leaving two
- `renderWeekGrid()` / `buildWeekGridInto(container, dateStr)` / `updateWeekNavLabel(dateStr)`
- `rosteredWords(baseShift)` (6 Nov 2026) — a base shift in the words a person reads: an Other day as its flavour's full word, with any time ("Training", not the raw `TRG`). The row warning about a rostered day uses it
- `updateSaveBtn()` / `resetBulkPills()` / `resetStagedRows()` (the row lifecycle after a save)
- `_hasStagedEdits()` — counts a staged ADD/CHANGE and a staged REMOVAL; counting only the first discarded un-ticked rows on a background refresh while the dirty flag stayed set
- Draws a LOADING state for a member whose slice has not arrived and a distinct FAILED state when their load stopped — seven base-roster days would be indistinguishable from a clear week
- Permissions, feedback and the dirty marker arrive via `initWeekEditor`
- **It holds Sunday enforcement layers 1 and 2** (CLAUDE.md → "Sundays are non-contracted"): the per-row pills for every `SUNDAY_FORBIDDEN_TYPES` entry are disabled with the reason in their accessible name, and the bulk sweep skips a ticked Sunday and says how many it dropped. `override-utils.test.mjs` pins that each layer MENTIONS every forbidden type, which is drift cover and not guard cover — the `.pill-<type>` strings live inside the `if`, so they survive its condition being deleted. The guards themselves are tested only by `e2e/admin.spec.js`, on a rendered row, because whether a pill is actually dead is not a fact any source scan or fake DOM can reach

### `admin-saved-changes.js`
The Saved Changes list, and un-recording (v21.38, extracted from `admin-overrides.js`).
- `renderTable()` / `resetTableMemberFilter()` + the month/member filters, the count chip and both delete paths
- **`coversAllStaff()` is asked at RENDER time**, not at the toggle: the toggle flips a flag and then starts a load, so a failed or in-flight load would otherwise leave a per-member cache labelled "(all staff)"
- Renderers and permissions arrive via `initSavedChanges`

### `admin-override-store.js`
The override cache, the reads that fill it, and the states they put on screen (v21.38 — split out when `admin-overrides.js` reached its ratchet cap).
- `initOverrideStore({ renderTable, renderWeekGrid, hasStagedEdits, onAfterLoad })` — the renderers are injected, never imported back (acyclic)
- `loadOverrides({ everyone?, member? })` / `ensureMemberLoaded(member)` — **the in-flight guard is keyed by the QUERY**: same key shares the flight, a different key CHAINS behind it. Sharing one flight across different queries meant a member selected mid-load was never fetched at all
- `getAllOverrides()` / `setAllOverrides()` (asserts completeness) / `removeFromCache(ids)` / `mutateCache(fn)` (rearranges rows, learns nothing)
- `OVERRIDES_QUERY_CAP` — the bound on the All-staff whole-collection read (fetched `+ 1` so a truncation is detected, never silent)
- `whenOverridesReady()` / `whenLoadSettled()` — the first is a ONE-SHOT latch answering only for the boot load; the second settles behind whatever load is running NOW, and both write paths (`executeSave`, `recordRangeOverrides`) await it after committing so a read that started earlier cannot land on top of the cache mutation and drop the day just saved from the list (wired v21.41 — it had been exported and called from nowhere, and this line claimed otherwise)
- `isOverrideCacheLoaded()` / `hasOverrideAuthorityFor(member)` (the write question) / `coversAllStaff()` (the list's question — true for a CAPPED read too) / `loadFailedFor(member)` / `isTruncated()`
- **A read served from the OFFLINE CACHE is a failed load** (v24.48, external review — `refuseCachedRead`). With `persistentLocalCache`, `getDocs` on a dead signal resolves from this device's cache, possibly EMPTY, and granting coverage from it let a save proceed believing the member had no bookings. It takes the failure path every surface already handles (failed week grid, Retry, save refusal) with an "offline" wording, and Retry fires itself on the `online` event
- `idsReplacedBy(memberName, date, winnerId)` / `withManualDuplicates(ids)` (v24.48) — what a MANUAL write of a day replaces (the winner and every manual record of the day, never the fixed id it lands on) and a delete widened by each manual day's duplicates, so a pre-v24.48 duplicate cannot resurface

- **A delete re-reads what it removes** (Oct 2026 production review): `findChangedSince(rows)` (server re-read, 20 at a time; an offline-cache answer throws), `staleDeleteVerdict(rowsOrIds)` → null or the line to show, `assertDeletable(rowsOrIds)` throws `DELETE_REFUSED` carrying that `line` — called inside the write of every override delete (`executeSave`'s cleared days, both Saved Changes controls, the period delete). `CHANGED_ELSEWHERE_LINE` / `UNCHECKED_DELETE_LINE` are the two refusals. Why: the cache never refreshes on its own and a manual record has one id per member and day, so a stale delete removed a colleague's newer edit. Saves stay last-writer-wins.
- **Moving a day between allowances checks first, too** (v25.18): `assertStillLeave(memberName, date, shown)` re-reads the shown record AND the fixed manual id, and throws a refusal carrying `LEAVE_YEAR_CHANGED_LINE` (the day changed, was cancelled, or a record the page never loaded sits on the fixed id) or `LEAVE_YEAR_UNCHECKED_LINE` (the server could not be asked). The save it guards rewrites the day as leave, so on a stale page it would bring cancelled leave back.

### `override-id.js`
The ONE document id a manual override is written to (v24.48, external review). Pure.
- `manualOverrideId(memberName, date)` → `'m_<date>_<encodeURIComponent(name)>'`. Two editors saving one day used to leave TWO records (each deleted the same loaded id, which Firestore accepts, and minted its own); a fixed id makes the second save land on the first one's document — last save wins, one record. Imports keep random ids, because an import and a manual record coexist by design. Used by `admin-overrides.js` (both write paths) and `admin-override-store.js`. Tested by `override-utils.test.mjs` and, as wired, `admin-overrides.test.mjs` → "two editors saving the same day"

### `admin-override-coverage.js`
What the Admin override cache actually knows (v21.38). Pure — no DOM, no Firebase, no imports.
- `emptyCoverage()` / `withMember(cov, member)` / `withAll(cov, { complete })` — the record (`clearedCoverage()`, a wrapper nothing called, was removed v24.51), never mutated in place. A CAPPED read (`complete: false`) sets `all: false` as well as `allPartial`: it replaced the cache, so an earlier complete read no longer describes it (re-review R-A6)
- `hasAuthorityFor(cov, member)` — the question every write gate asks. Full coverage is checked FIRST, so `all` genuinely means all
- `coversEveryone(cov)` — the All-staff view's separate question. Having read fifty members one at a time is NOT having read the collection
- `replaceMemberSlice(docs, member, fresh)` — a replace, not a merge: the read is authoritative for that member, so a document it omits has been deleted
- `mergeCappedRead(docs, fresh, members)` — the cache after a CAPPED collection read: keeps the individually-covered members' documents from BEYOND the cap (older than the read's oldest date), because `withAll({complete:false})` keeps those members authoritative and the wholesale replace used to drop their history (review A12)
- **An unfetched member and a member with no overrides produce the same empty slice**, which is why authority is answered from what was REQUESTED. Tested by `admin-override-coverage.test.mjs`

### `admin-shift-rules.js`
The two rules a shift change must not break — maximum length and minimum rest (v21.38, extracted from `validateShiftRules`). Pure: no DOM, no cache.
- `checkShiftRules({ toSave, isFixedType, resolveShift, baseShiftFor, formatDate, shiftDate })` → `{ errors, failedDates }` — it DECIDES, the caller PAINTS. `failedDates` is deduplicated so one row breaking both neighbours is marked once while both sentences are still said
- `constrainingTime(value, baseShiftFor)` — what an adjacent day constrains by; `null` means "does not constrain", which is not the same as "constrains by nothing" and is the difference between skipping a check and feeding NaN to it
- `MAX_SHIFT_MINS` / `MIN_REST_MINS` / `parseMinutes` / `effectiveEndMins` / `fmtHours`
- The adjacent day is resolved by an INJECTED function so the rule holds no cache — a missed rest gap and a cache that had not loaded are indistinguishable from inside, so the question is asked outward. Tested by `admin-shift-rules.test.mjs`

### `admin-deep-link.js`
Where a hash on `admin.html` actually lands (v22.91). Admin is a page of FOLDED cards, so arriving at `admin.html#something` only helps if the thing named is unfolded when you get there — which was true while every deep link named a whole card, and stopped being true when the Calendar's day panel gained a route to the **Recorded Annual Leave dates** box, a box inside a card with a fold of its own.
- `resolveDeepLink(hash, doc)` → `{ folds, scrollTo, settleOn }` or `null`. Returns WHICH folds to open, WHAT to scroll to now, and the id to finish on later. It opens nothing, because `openCollapsibleCard` in `admin-app.js` is what keeps `aria-expanded` in step and a second opener would be a second place to forget that. Taking `doc` is what lets the whole decision run against a fake document in Node.
- `NESTED_DEEP_LINKS` — an explicit map, not a guessed selector: these boxes do not share the card body's class (`.al-booked-body` against `.card-collapsible-body` — same mechanism, different padding), and a link that opens the WRONG fold is worse than one that opens none. Same shape as `DEEP_LINK_CARDS` on operations.html.
- `createDeepLinkLanding(win)` → `{ arrive(resolved), settle(boxId) }` — the SCROLLING half, and the one-shot state behind it (v23.02). Landing is what the module is named for, and unlike the folds there is no other authority over it to keep in step. `settle` is called by `_renderBookedPeriods` at the instant it un-hides a box, which is the one moment the box has a height — so no timer, no observer, no polling; and ONCE only, because the box re-renders on every member change, save and delete, and re-scrolling later would yank the page out from under somebody using the card.
- **A nested target scrolls to its CARD FIRST AND TO ITSELF LATER, and both halves matter.** The box carries `hidden` until its own async render un-hides it, so scrolling straight to it would aim at a zero-height element — hence the card as the immediate answer. But the card is not sufficient: the box sits below the banner, the member row, the range picker, the preview and the Save button, so landing at the top of the card leaves the thing the link NAMED off the bottom of the screen (reported 6 Sep 2026, with the folds already opening correctly).
- **AND THE SECOND SCROLL MUST CANCEL THE FIRST.** Two smooth scrolls a frame apart do not resolve to the later one: a box a short page cannot lift to the top clamps to the scroll maximum the page is *already* at, Chrome finds nothing to do, cancels nothing, and the card's animation finishes on top of it. Measured at 390×844 — the box landed at y=709 with its last 32px below the fold, with the correct scroll issued and ignored. An instant scroll to the current position first aborts the animation in flight. Nothing else in the estate can see this (every fold open, every aria state right, no assertion failing), so `e2e/admin.spec.js` asserts the box's BOTTOM EDGE — "did it scroll?" passes on the broken behaviour.
- The hash is decoded in a `try` and never fed to `querySelector`: a malformed hash (`#[`, `#%`) raises a SyntaxError there, which the in-place-login path catches into a reload, and the bad hash survives that reload and loops.

### `admin-rangepicker.js`
Inline date-range calendar widget — extracted from `admin-app.js` at v11.36.
- `buildRangePicker(prefix, { onViewYearChange? })` — builds a month grid with from/to selection, chip labels, and swipe navigation between months; returns `{ reset() }`
- `getDateRange(fromVal, toVal)` — pure: inclusive ISO date list for a range; `null` if reversed, `[]` if either input empty (v12.55). Covered by `admin-rangepicker.test.mjs`
- Imports `DAY_NAMES`, `MONTH_ABB`, `MONTH_NAMES`, `formatISO`, `parseISODate`, `SWIPE_THRESHOLD`, `SWIPE_VELOCITY` from `roster-data.js`
- Imported by `admin-range-booking.js` (the shared skeleton for both booking cards)

### `date-picker.js`
Brand-styled single-date picker — replaces the un-themable native `<input type="date">` glyph/popup with a modal calendar in the app's own visual language (v17.36). Used by the four Operations upload date fields (`huddleDate`, `circularDate`, `newsletterDate`, `rosterWeekEnding`), since v23.38 by Admin's week jump, and by Team View's week jump (`calendar-team-view.js`, lazy import).
- `initDatePickers(inputIds)` — progressive enhancement: each native `<input type="date">` stays in the DOM **hidden** as the value holder (so every consumer — `doc-upload.js` `.value`/`.max`/default-to-today, the roster card's Saturday-snap `change` listener — keeps working unchanged); the picker inserts a `.date-trigger` button and opens ONE shared modal calendar built on `createLightbox`. Selecting a day sets `input.value` + dispatches `input`+`change`, then a per-input `change` listener re-reads the (possibly consumer-normalised, e.g. Saturday-snapped) value into the trigger label. The trigger calls `openDatePicker`, so it inherits the bounds announcement below.
- `openDatePicker(input, { title? })` (v23.38) — open the shared calendar for any `<input type="date">`, building the overlay on first call. For a page that **already has its own trigger**: Admin's week-jump control is the week label ("8–14 Sep 2026"), which names a week rather than a date, so only that page can write it. `initDatePickers` is the case where this module supplies the trigger too, and now calls this. The `title` is passed rather than read off the input, because such a caller has moved the `aria-label` onto its own trigger and left the input `aria-hidden` — reading a dialog heading off a hidden element would work and would put the label in the wrong place.
- **`min`/`max` are read at OPEN time, so this dispatches `date-picker-opening` on the input first**, synchronously, giving the consumer its chance to refresh those bounds (v23.37). `doc-upload.js` listens: its cap is recomputed at init and on submit, and without this third moment a tab left open past midnight offered a grid whose real today was `dp-off`. **The dispatch lives in `openDatePicker`, not in `initDatePickers`'s click handler** where v23.37 put it — that was the only way in at the time, and leaving it there would have handed Admin's week jump, which supplies its own trigger, the very stale-`max` bug the same release fixed for Operations. A field with no cap has no listener and the event is a no-op; announcing rather than asking is what makes that safe.
- `monthCells(year, month, weekStart = 1)` — pure: a flat month grid (`null` padding + ISO day strings), no DOM; Monday-first by default, Sunday-first with `weekStart` 0. Covered by `date-picker.test.mjs`.
- `openDatePicker(input, { title, week })` — **`week: true` makes it a week picker** (polish round 2 — the "Jump to a week" pickers of Admin and Team View, whose weeks run Sunday–Saturday): Sunday-first, the chosen day's Sunday–Saturday week banded (`dp-inweek`), and the hovered/focused day's week banded (`dp-hoverweek`). Picking still sets one day. Off by default, so every other date field keeps its Monday-first single-day grid; the AL/Absence range picker is `admin-rangepicker.js` and is untouched.
- Modal (not inline) so it stays one line per card — an always-open calendar × 4 cards would bulk up the Operations stack. Imports `roster-data.js` (DAY_NAMES/MONTH_ABB/MONTH_NAMES/formatISO/parseISODate) + `overlay.js` (createLightbox). Called by `operations-app.js` after the card inits set the field defaults, by `admin-app.js` on the week label, and by `calendar-team-view.js` (lazily) on its week jump.
- **Its CSS is in `shared.css`, not a page stylesheet** (moved there v23.38). It sat in `operations.css` while only Operations used it; the moment Admin did, every `.dp-*` rule would silently not have applied and the calendar would have rendered as bare buttons in an unpainted box — the exact fault the module exists to fix, reached by putting a shared component's CSS on one page. `.date-trigger` moved with it: one module, one home.

### `date-format.js`
The app's OWN date vocabulary — ONE spelling of a date, everywhere the app writes one in words (v24.06). Pure; **imports nothing** — it owns `MONTH_ABB` and `DAY_NAMES` (exported here; `roster-data.js` re-exports them), so a module can take a date vocabulary without taking the roster: `paycalc-format.js`, `operations-reports.js` and `links-design-doc.js` were all roster-free before it.
- `formatDayMonth(d)` → `"18 Sep"` · `formatDayMonthYear(d)` → `"18 Sep 2026"` · `formatDayMonthYear2(d)` → `"18 Sep 26"` (the two-digit year is zero-padded — `"5 Jan 7"` reads as a date in the 7th of something) · `formatWeekdayDate(d, withYear?)` → `"Fri 18 Sep"` / `"Fri 18 Sep 2026"`. The year is OPT-IN, so a surface that needs it has to say so.
- `formatClock(d)` → `"14:23"` — `hourCycle: 'h23'` explicitly, so midnight is `00:00` and never `24:00`.
- **Why it exists.** `Intl` / `toLocaleDateString` with `month: 'short'` abbreviates September to FOUR letters in en-GB and every other month to three. Measured on Node 22, Chromium AND WebKit rather than assumed, so it reached every staff device — the Links print header, the Pay Calculator, the Settings work-email card and the Operations error log all said `"18 Sept"` on a screen the member reaches from a calendar saying `"18 Sep"`. It had already been found and fixed LOCALLY twice (Team View composed from `MONTH_ABB` by hand at v22.86; Overtime formatted through `Intl` and trimmed the result with `.replace(/\bSept\b/, 'Sep')`, in two places), which is the whole argument for one vocabulary rather than a third local fix. `month-vocabulary-parity.test.mjs` fails on a fourth.
- **`printedStamp(date, clock)`** → `"Printed Fri 18 Sep 2026 · 14:23"` — the provenance line all FIVE printable surfaces now close on (Calendar, Team View, Overtime, Links, Pay Calculator; the ROADMAP item listed four and missed the Pay Calculator). Overtime's shape is the one the other four adopted, not the reverse, because the argument was already written beside it: *a reviewer holding two printouts of the same week cannot tell which is the later one without the time*. The clock is PASSED IN rather than read off `date`, so a surface cannot silently acquire the wrong zone — there is no default to inherit.
- **`londonDate(at)` / `londonClock(at)`** — the zone shim, for a roster-office document that must read as London wall-clock whatever the device is set to. `londonDate` returns the London calendar date as a local Date **at noon**, and that is load-bearing: carrying the London TIME on it instead would put it back in reach of a DST gap (a device whose own spring-forward is at 01:00 cannot represent 01:30 locally, so the day could shift). It reads `formatToParts` NUMERICALLY, so the spelling divergence the module exists for cannot re-enter through the shim. `londonClock` is separate and formats through `Intl` in London, constructing no local Date at all.
- **`NO_DATE` (`'—'`) is what an unusable date renders as**, and every composer returns it rather than reading `getDate()` off an Invalid Date — which is the one behaviour the v24.06 sweep made WORSE before this guard ("NaN undefined NaN", against `toLocaleDateString`'s honest "Invalid Date"). Guarded in the composers rather than at the six call sites, three of which already tested for it and three of which did not. An em-dash rather than a blank, because "no date recorded" is a different and legitimate state several of these surfaces also have; the Calendar's AL lightbox already uses the em-dash the same way. A non-`Date` is refused identically, and the epoch is not — the check is for `NaN`, not for truthiness.
- **Not in scope: `functions/`.** Cloud Functions are CommonJS and cannot import a browser ES module, so `functions/overtime-core.js` keeps its own `MONTH_ABB_EN` — the same documented duplication as `normaliseSurname`. It is already correct and `overtime-core.test.mjs` pins its output.

### `huddle.js`
Huddle upload, push notification subscribe/unsubscribe, and Huddle card toggle.
- `initHuddleUpload(opts)` — called by `operations-app.js`; wires Huddle upload card + Huddle collapse toggle (admin-only)
- `initHuddleNotifications()` — called by `settings-app.js`; wires the Notifications card (all staff, settings page)
- Notifications card UI — subscribe/unsubscribe via `notif.js`, which owns the VAPID key and fingerprint re-subscription (the card reads state with `peekNotifState`, deliberately avoiding that side effect)
- Huddle upload: file validation, DOCX conversion via mammoth.js, upload to Firebase Storage via `uploadHuddle`
- Huddle card: collapse/expand toggle

### `doc-upload.js`
Shared Operations upload-card skeleton (v16.07). `initDocUploadCard(cfg)` owns file-pick → validate (type + 20 MB) → optional pre-upload `transform` → upload → feedback + the date cap; per-card config (accepted types, transform, `maxDateOffsetDays`, uploadFn, copy). Drives Circular + Newsletter (operations-app.js) and the Huddle (huddle.js, which passes its DOCX→HTML Mammoth transform). `isPdfFile(f)` + `isDocxFile(f)` exported as accept predicates; Circular/Newsletter accept both (PDF or Word .docx — no upload transform, v16.31; a Word doc later opens via the Office Online viewer rather than downloading, v16.45), the Huddle also converts DOCX→HTML. Imports only `roster-data.js` (formatISO) + `session.js` (sessionReady).
- **`MAX_UPLOAD_BYTES` is one of THREE declarations of the same limit** and the only one a member meets before the upload starts: the Cloud Functions' own `MAX_FILE_BYTES` (`functions/index.js`) and the `request.resource.size` cap in each of `storage.rules`' three upload blocks are the other two. They sit in three languages that cannot import one another, so they are kept in step by `upload-cap-parity.test.mjs`, which derives all three from source rather than restating the number. **A client cap ABOVE the rule's is the direction that costs something**: the card accepts the file, the admin waits out a full upload on whatever connection the station has, and Storage refuses on the last byte — reaching them as the card's generic failure, with no mention of size. The parity test also pins the "maximum 20 MB" sentence to the enforced figure, that being the only place an admin can read the limit at all.

### `admin-auth.js`
Staff Firebase Auth account setup (admin only) — and, since v22.53, what is actually wrong right now.
- `initAuthSetup({ currentIsAdmin, onAttention? })` — called once by `operations-app.js`
- Wires up the Staff Login Accounts card; calls `setupRosterAuth` Cloud Function
- Sends a fresh Firebase ID token (`getIdTokenResult(true)`) as the bearer token — no client-side secret since v9.88
- **The provisioning audit block (v22.53).** On load (and again after every run) it reads `getAccountSetupGaps` and states, above the controls, who has no login, whose claim is wrong and which leaver still has one. It is a READ and deliberately not a repair: an audit that quietly fixed what it found would make the gap invisible again, which is the state the feature exists to end. Three states that may never collapse into one another — gaps found · none found · **could not tell**; the third is why the response carries `refused`, and why a failed or refused check reports NOTHING to the Needs-attention strip (an unreported item is unknown to the strip, an absent one reads as nothing to do). `onAttention({setUp, leavers})` fires only when the audit answered. Tested by `admin-auth.test.mjs`

### `roster-cell-rules.js`
What a parsed roster cell **means** as an override (v22.17). Extracted from `admin-roster-upload.js` when the ratchet said so, and the ratchet was right: these are rules about meaning, not coordination.
- **Why its own module.** Two consumers — the review's state machine and the in-place entry control — and neither obvious home works. Not `override-utils.js`: these need `isSunday`, and `roster-data.js` already imports override-utils, so the import would be a cycle `import-graph.test.mjs` refuses. Not the entry control: the state machine would then import a widget. A module that imports both and is imported by neither resolves it.
- `normaliseCellValue(rawShift, baseShift, date)` → `{value, display, guarded}` (`guarded`: `'sunday'` | `'rest-day'` | null, which `guardCopy` reads) — the per-cell guards: the Sunday rewrite, the absence-or-AL-on-a-base-rest-day rewrite, and the `RDW|` display marker (`display` keeps it so the save writes `type: 'rdw'`; `value` is stripped so a re-import compares correctly against stored plain-time docs). **Every path that produces a value for the review goes through it** — the parsed cell, a picked reading, an entered shift — because two copies would eventually let one of them write a Sunday AL, the one thing the six-layer Sunday rule exists to prevent.
- `shiftValueToOverrideType(value, baseShift, date)` → override type id. Layer 4 of the Sunday rule.
- `isZeroLengthRange(value)` (moved here v22.18) — equal start/end is the one range shape always wrong here: every duration helper reads `end <= start` as an overnight wrap, so a zero-length range prices as TWENTY-FOUR HOURS. `end < start` is deliberately NOT caught — a genuine overnight shift is ordinary on this roster. It accepts the internal `RDW|` encoding as well as a bare time. Its home was always this module's subject (a per-cell guard); it sat in the coordinator because it was written before the coordinator had one. The AI_MAP entry for it also gave the wrong signature, `(s, e)`, for three releases.
- All three are re-exported by `admin-roster-upload.js`, so existing call sites and tests are unchanged.

### `roster-entry-control.js`
Answering an unreadable roster cell **where the question is asked** (v22.17).
- **Why it exists.** An unreadable cell with no candidate readings was a dead end: the row said "check the paper roster" and the only way to act was to finish the review, leave for the Admin page, and remember the person and the day. v22.16 briefly made it worse by routing every unmarked Sunday time into the same state; that rule was removed at v22.19 (its premise was false), but the control it prompted is a keeper and the review still meets genuinely unreadable cells — `SEE NATHAN` and `See CEM` both appear in the real Supervisor roster.
- `entryControlHtml(key, state, date)` — the type pills, the Other sub-controls, and, for Shift/RDW/Other, the two time boxes. Pills are generated from `PILL_TYPES` (the ONE declaration of which pills exist and in what order) so this control and Change a Shift cannot drift — including `other` since v22.50 (this bullet said it was dropped until v22.51, four releases after the pill arrived, which is the drift the module's own rule 1 exists to prevent). Sunday exclusions come from `isForbiddenOnSunday`, consulted rather than restated — that list has six numbered enforcement layers and a seventh copy is how one goes stale.
- **Both groups STATE their question, and both locks give their reason on screen** (v22.51). The control had `aria-label`s and nothing visible, so a sighted admin met six unlabelled buttons in a grey box and then, on picking Other, six more of equal rank — `What kind of day was it?` and `Which kind of Other day?` are what make the second read as a narrowing of the first, and `operations.css` nests the Other block behind a leaf-green rule in that family's own colour to say the same thing structurally. The two reasons a control is locked lived in `title` attributes, which no phone shows and every admin here is on one: a Sunday now names what it DOES allow (derived from `isForbiddenOnSunday` in the same call the pills make, so it cannot become a seventh copy of the list), and a disabled Rest-day-worked tick says it is automatic. The hint line now renders for EVERY picked type rather than only the timed ones, so choosing Annual Leave confirms itself instead of leaving the control silent.
- `commitEntry(state)` — composes through `manualCellValue` then `normaliseCellValue`, so an entered value passes exactly the guards a parsed one does.
- `patchEntryRow(rowEl, done)` — keeps the row honest between keystrokes. Its tag style (and the row's unreadable tint) comes from `unreadableTagClass` in `roster-review-states.js`, the same rule the render uses. The keystroke path deliberately does not re-render (that would destroy the input being typed into), and without this the row went on reading "Not saved · couldn't read" while the summary above had already counted the entry: the screen contradicted itself.
- **An OTHER day can now be entered here too** (v22.50, staff report). The pills excluded `other` because its value is a grammar — `FLAVOUR[" RDW"][" HH:MM-HH:MM"]` — and the control had no sub-controls for it; the note sent the admin to Change a Shift with a name and a date to remember, which is the dead end this whole control exists to remove. Picking **Other** now reveals flavour chips generated from `OTHER_FLAVOURS`, a Rest-day-worked tick (checked and disabled when the base shift is a rest day, as in the week editor) and OPTIONAL times, and the value is composed by `composeOtherValue` — the writer half of the grammar the week editor's save path already calls, so the two surfaces cannot disagree about what a Training day is. Spare is deliberately not offered: it is its own override type, not an Other flavour (owner decision). Sundays need no new guard — `other` is already in `SUNDAY_FORBIDDEN_TYPES`, so the pill disables itself.
- `entryClick(el, state)` (v22.50) — applies a click on any control INSIDE the editor (type pill, flavour chip, RDW tick) to the draft and commits it, returning whether it handled the element. It lives here rather than in the review's delegated handler because which sub-controls exist is this module's business — and because that coordinator sits at its ratchet cap.
- **`patchEntryRow` takes the state as a third argument** so the hint is decided by ONE function (`entryHint`) for every kind of draft. It used to pick between two constants, which was right while a draft was only ever a shift with two times and silently wrong the moment an Other day arrived: it runs after `redrawEntry` and overwrote a correct "choose the type of day" with "enter both times".
- `toggleEntry(rowEl, btn, key, state, open)` / `redrawEntry(rowEl, key, state)` / `isoFromKey(key)` (v22.50) — **the control opens, closes and re-draws IN PLACE; the review is never re-rendered around it.** Reported from the station: pressing the button opened the pills and threw the reader back to the top of a long review. `renderReviewTable` rebuilds every section and replaces the list container outright, so the document momentarily holds no rows, the scroll clamps to the shorter page, and the position is gone — measured at 390×844, scrollY 1286 → 462 on the button, and again on every pill after it. The keystroke path already knew this (see `patchEntryRow` above) and patched instead; these two paths did not, and were the only ones in the handler that still re-rendered. `toggleEntry` also owns the one thing only it knows: WHERE the control goes — after the whole pick group on a CONFLICT row offering readings, after the button itself on an UNREADABLE row — matching the render.
- **Leave or an absence ENTERED on a base rest day ASKS the swap question** (whole-app review, Oct 2026). `commitEntry` runs the entered value through `normaliseCellValue`, whose rest-day guard returns `RD` — so an admin who picked Annual Leave or Absent on a rest day saw the hint say it was saved while nothing was written, and the summary counted it. The control now asks "Was it a swapped working day?" (`.roster-entry-swap-btn`, the same two answers as the parsed GUARDED row): *Swapped* records the entry with `swapped: true`, which the save turns into `replacedType` via `replacedTypeForSwap`; *Rest day* records nothing and says so. Changing the type takes the answer back.
- `entryLeftAsRest(state)` — the entry was answered "rest day": the row reads *Not recorded*, carries no unreadable tint, and is not counted as an unanswered cell. The review's render, its patch path and its summary all ask this one function.
- **The times are TEXT, not `<input type="time">`.** That was written first and replaced on a measurement: Chromium renders it from the OS/browser format settings, so it showed `06:00 AM` / `02:00 PM` even with `navigator.language` forced to `en-GB`. Every other time on the page is 24-hour and the shift badges beside it read `13:30-21:00`. Text does not weaken the guard — `manualCellValue` requires `HH:MM` on both boxes, so a half-typed time produces no entry and writes nothing; it just has to SAY so, which is the hint under the boxes.

### `roster-alignment.js`
Is a roster read trustworthy, or is it a day out? (v22.16, external review.) Extracted from `admin-roster-upload.js`, which the ratchet had pushed 135 lines over its cap — and rightly, because this is a domain RULE, not coordination.
- **Why it is the important module in the import path.** The row read, `sundayScan` and `columnScan` all come from ONE model call looking at ONE PDF. They are not independent witnesses. When the model visually collapses the blank Sunday cell and repeats that positional mistake across all three channels, every server-side check AGREES with the wrong answer and a whole week is written onto the wrong days — silently, because a shifted week still looks like an ordinary roster. What this module compares against is not the model at all: it is the member's own rotating base pattern, which the PDF cannot influence.
- `detectShiftedRow` — MOVED to `roster-alignment.js` at v22.16. Old signature for reference: `detectShiftedRow(member, shifts, dates)` → `'left'｜'right'｜null` — correlates the parsed week against the base roster at offsets −1/0/+1; a ±1 alignment must beat the correct one by ≥3 days and score ≥5/7. Deliberately conservative: a member whose pattern looks similar on adjacent days scores the same at every offset and stays silent rather than false-alarm. (Unchanged in behaviour; moved.)
- `assessRosterAlignment(parsedResult)` → `{byMember, blocked, direction, suspects, geometryRefused}` — the CIRCUIT BREAKER. **Since v22.31 it also folds in `parsedResult.geometryRefused`** (the rows `functions/roster-geometry.js` refused because an AI day landed in a physically empty cell) as a third drift kind, `'geometry'`, filtered to names actually on the review: the row unticks and the refusal counts toward the threshold. A base-roster verdict keeps its direction; geometry has none, so `direction` is `null` when nothing directional contributed and the banner cannot claim one.
- `geometryCopy(geometry)` (v22.40) — did the PDF's own grid actually get consulted? Returns HTML for `partial` (states the arithmetic no row can state for itself) and `unavailable` — **including a response carrying no `geometry` field at all**, because absence must read as "did not run", never as "ran and agreed". `complete` returns `''`: on this surface no warning IS the good state. The server had reported `geometry.status` since v22.31 and no client read it, so a fail-open witness produced a review identical to one where the grid agreed with every cell (v22.39 external review). It unticks nothing — whether a missing second witness should also fail closed is an owner decision
- `driftCopy(drift, escapedName)` / `stopCopy(alignment, who)` (v22.31) — the per-row warning and the whole-read banner, as HTML. Moved here from the coordinator so a third kind of drift cannot silently wear the first two's words: `'geometry'` rendered "shifted a day later" until these existed. Tested alongside the verdict. Counts by DIRECTION, not by total: a parser that drops a leading blank moves every row the same way, so two members drifting opposite ways is noise. Fails OPEN on absent evidence — an empty or malformed result is never a refusal.
- `ALIGNMENT_BLOCK_THRESHOLD` (3) — one member can genuinely have an unusual week; two is a coincidence; three separate employees whose weeks all match their own base pattern shifted one day the same way, in one upload, is a parser failure. The per-member bar is already high, so three of those is not a near-miss.
- **What the verdict DOES**, in `admin-roster-upload.js`: a drifted member's rows start unticked; a blocked read unticks everyone, makes every tick inert, replaces the Save button with "Read the roster again", and is skipped by the save collector (`collectRosterWrites`). No per-row override and no "save anyway" — a systematic misread makes the whole read untrustworthy, including the rows that look unremarkable, which is exactly what a shifted row looks like where it happens to agree.
- Imports **no Firebase**, which is a second payoff: the detector loads in Node, so a test (unit and e2e alike) builds a shifted-week fixture from the real roster instead of hard-coding member names that go stale.
- Tested by `admin-roster-upload.test.mjs`; the wiring by `e2e/operations.spec.js`.

### `roster-review-states.js`
What state every cell of the roster review is in, and whether it is TICKED. (v23.52.) Extracted from `admin-roster-upload.js` the second time that file stood at **exactly** its ratchet cap with zero headroom — the first time the cap was raised; the seam was there on both occasions. It touches no DOM, holds no state, and every answer it gives is a decision that would be wrong if it were wrong, which is the ratchet's own definition of an EXTRACT. The file's cap came down 1300 → 1150 in the same commit.
- `computeCellStates(parsedResult, existingOverrides)` → `Map<"memberName|date", state>` — classifies each day **MATCH** (PDF equals base, nothing to do) / **DIFF** (PDF differs, propose it) / **CONFLICT** (a manual override differs from the PDF) / **COVERED** (an override already equals the PDF) / **REMOVE_IMPORT** (row matches base again, so DELETE the stale import and write nothing) / **UNREADABLE** (the `UNKNOWN|` sentinel). It also decides `chosen`, which is what a Save actually acts on.
- `guardCopy(guard, asks = false)` — why a **GUARDED** row recorded nothing, in the admin's own words (v23.97). Takes `'sunday' | 'rest-day' | null` (whatever `normaliseCellValue` reports as `guarded`) and returns one short phrase. Lives HERE rather than in the coordinator because `admin-roster-upload.js` imports Firebase from a CDN URL, so Node cannot load it and nothing in it is unit-testable; this is pure wording about a review state. Obeys the app's absence conventions — "Absent", never "sick", and never reads like an error, because nothing has gone wrong: a rule was applied and the row exists so the admin can judge whether it fits that day.
- `swapQuestionApplies(state)` → boolean — does this GUARDED row ask "was this a swapped working day?" (v24.42, owner). True only for absence or leave on a base REST day, never a Sunday, never on a read the circuit breaker refused. The rest-day guard is right for a real rest day and wrong for a swapped week, which only the reader of the roster knows — so it is ASKED, as leave on a rest day is at booking (v23.75), and never defaulted.
- `replacedFromState(state)` (v25.18) → what a write over the row's saved record must carry forward from it — `{ type, replacedType, leaveYear? }`, or null when nothing is saved there. ONE builder for the five save sites (four in `collectRosterWrites`, one in `guardedWrites`), which had each built the object by hand; the sixth field would have reached four of them.
- `guardedWrites(state, memberName, date)` (Oct 2026) — everything saving a GUARDED row writes: "swapped" REPLACES any previous import on the day, "rest day" REMOVES one, unanswered writes nothing. Pure so the save path is tested, not just the question; `collectRosterWrites` and the upload's counter both call it. An answered swap is itself a roster_import, so the next upload of the same PDF classifies it COVERED (`computeCellStates`) — it used to be a pre-ticked REMOVE_IMPORT that deleted confirmed leave.
- `collectRosterWrites(cellStates)` (test audit, 7 Nov 2026) → the list one Save writes, which the coordinator hands to `_saveOverrideBatches`. Moved out of the Save click handler, where — the coordinator importing Firebase from a CDN — nothing could run it, so a regex over its source was its only test and most of its rules had none. Per state: a ticked DIFF and a CONFLICT answered "Use new roster" write the DISPLAYED value (`displayShift`), never the parsed one; a ticked REMOVE_IMPORT deletes and writes nothing; UNREADABLE writes only once answered; GUARDED defers to `guardedWrites`. **THE HARD GATE comes first:** a cell from a refused read writes nothing whatever `chosen` says — unreachable from today's UI, because the inert ticks stop `chosen` changing, which is exactly why only a unit test can hold it. Every write carries `alsoDelete` (the day's other manual records, from `manualDupIds`), always a list.
- `guardedWriteValue(state)` → `'SICK' | 'AL' | null` — what a GUARDED row writes: the roster's own value, and only once answered "swapped". Unanswered or "rest day" writes nothing. The coordinator's counter and `collectRosterWrites` (through `guardedWrites`) both reach it, and the save stamps `replacedType` via `replacedTypeForSwap` — without it `isOverrideDisplaySuppressed` hides the absence on a rest-day base, so the answer would be written and then not shown.
- `guardedRowHtml({ key, s, dayName, dateStr, badgeHtml, esc })` → string — the GUARDED row's inner HTML: the day with its tag, then what the roster said, what is saved now, the reason, and the two answer buttons when it asks. Since v24.90 the tag rides in the day line and the badge has a line of its own — as three columns, a phone with large text drew the badge over the tag ("IOT RECORDED", owner's screenshot). Pure, so the markup is tested beside the rule; the coordinator redraws the whole row with it on an answer, and on Skip all, which takes an answer back (v24.90 — an answered swap is a write, and a skipped section is written nothing).
- **The default is never "write it" where anything is in doubt.** DIFF and REMOVE_IMPORT are pre-ticked; CONFLICT and UNREADABLE start `null`; a drifted member's rows — and every row of a read `assessRosterAlignment` has refused — start `false`. The verdict is taken ONCE here, because `chosen` is decided here: until v22.16 it was computed at render time under a banner while every change stayed ticked, and reporting is not refusing.
- **UNREADABLE (v15.30):** when `normaliseShift` (functions) can't parse a non-empty cell it returns a `UNKNOWN|<raw>` sentinel instead of defaulting to `RD` (which, when the base is also RD, silently dropped a real shift as a MATCH). The sentinel becomes a row that is surfaced in review, counted in the summary label, and **never written** — `chosen` stays `null` and the save path only writes DIFF/CONFLICT. Since v16.68 the server's `applyColumnScanCrossCheck` also emits it (`UNKNOWN|row or col? (PDF unclear)`) where the AI's row read and column re-read disagree without a provable one-day realignment; both readings are shown.
- **Resolving a flagged cell (v19.32).** It reads `parsedResult.choices` (the server's two candidate readings, keyed `memberName|date`) and attaches `options: [{value, display}]` to an UNREADABLE cell — but only when the two candidates survive `normaliseCellValue` as DIFFERENT values, so a pair that both collapse to RD (a Sunday AL, or AL on a base rest day) is not offered as a question with one answer. Every candidate goes through the SAME guards a parsed value does: **picking must never be a route to write what the parsed path would have refused.** `chosen` stays `null` until the admin picks, so leaving a row alone gives exactly the pre-v19.32 behaviour.
- **RDW-parity is part of COVERED.** A stored `{type:'shift','14:30-22:00'}` and an incoming `RDW|14:30-22:00` are equal on the bare time, so without the type check the overtime reclassification is dropped in silence — and it stuck as COVERED in the reverse direction too (v16.23). Sundays are EXCLUDED from that check on purpose: a worked Sunday is stored as `rdw` but arrives as a plain time, so requiring flag equality there would false-CONFLICT every Sunday on every re-upload.
- **A previous import and a manual entry are different things.** `isManual` (`source !== 'roster_import'`, absent source treated as manual) picks the branch. REMOVE_IMPORT exists because writing a fresh base-matching override — the pre-v16 behaviour — was redundant AND would MASK a later base-roster change, since an override always beats the base.
- `unreadableTagClass(state)` → `'act-read' | 'act-choice'` — the action tag's STYLE on an UNREADABLE row: "couldn't read" until something will be written (a picked reading, or a finished entry), the decision style once it will. Both row shapes — the garbled cell and the one offering two readings — call it from the render, the pick handler and `patchEntryRow`, so the identical words "Couldn't read" wear one style (polish round 2, owner-approved; the options row wore `act-choice` from the start before). Presentation only: it reads `chosen` and never sets it.
- `RDW_PREFIX` / `isRdwEncoded` / `stripRdw` / `UNKNOWN_PREFIX` / `isUnknownEncoded` / `stripUnknown` — the two review-only encodings, owned here and imported back by `admin-roster-upload.js` rather than copied. Neither ever reaches Firestore: the RDW-ness of a saved override lives in its `type`, and the UNKNOWN sentinel is never written at all.
- Imports **no Firebase**, so it loads in Node with no mocks. The assertions still reach it through the coordinator's re-export (`admin-roster-upload.test.mjs`) — moving that block to the hygiene lane is a separate change, because a test block relocated in the same commit as the code under it can lose a case with nothing to say so.

### `admin-roster-upload.js`
The Weekly Roster Upload pipeline. (v22.31: the drift banner and per-row warning WORDS moved to `roster-alignment.js` — `stopCopy`/`driftCopy` — beside the verdict they describe; this file shrank by 15 lines.)
- `initRosterUpload(opts)` — called by `operations-app.js` after session guard passes
- `PARSE_ABORT_MS` (test audit, 7 Nov 2026) — how long the parse request waits before aborting: 130s, above `parseRosterPDF`'s own 120s `timeoutSeconds`, as `fetch-timeout.js`'s table has always said. It was a 90s literal, so a slow parse about to succeed was reported as a failure. EXPORTED so `admin-roster-upload.test.mjs` can pin it to the server's figure, read from `functions/index.js`.
- `computeCellStates(parsedResult, existingOverrides)` — **MOVED to `roster-review-states.js` at v23.52** and re-exported from here, so every existing call site and test is unchanged. See that section for the states, the `chosen` default and the five invariants.
- `renderReviewTable()` — per-person card list. Presentation reworked v15.52: a plain-language **outcome summary** ("what Save will do" — updated / cleared / needs-your-choice / couldn't-read) above the list; each change row carries a **Save tick** (was a Save/Skip toggle button) + an action tag (Update / Clear old / Your choice / Not saved); conflicts are an inline **Keep yours / Use new roster** choice (was Manual / PDF) with no separate top conflict banner; the Save button shows a live count. State machine + `chosen` model unchanged.
- `shiftDisplay(value, date?)` / `manualShiftDisplay(value)` — badge display helpers, **EXPORTED (v18.85)**. `shiftDisplay` takes the date so a Sunday worked shift renders as RDW (the v18.74 display rule); `manualShiftDisplay` deliberately passes no date
- `shiftValueToOverrideType(value, baseShift, date)` — parsed value → override `type`; re-exported from `roster-cell-rules.js` (defined there since v22.17), so it stays unit-testable (`admin-roster-upload.test.mjs`). Maps the training grammar → `'other'`; Sunday AL/SICK/training → `'correction'` (the Sunday block).
- `_saveOverrideBatches(toWrite, currentUser)` — **EXPORTED (v15.69, the v15.48/v15.69 review fix)**. Writes the reviewed changes in ≤200-op chunks; **each chunk's batch is (re)built and committed INSIDE a `writeWithClaimRetry` thunk**, so a freshly-provisioned / claim-changed admin's stale ID token self-heals (permission-denied → force `getIdToken(true)` → retry once) — matching every other Admin write path. The batch is rebuilt per attempt because a `WriteBatch` can't be reused after a failed commit. Tested in `admin-roster-upload.test.mjs` (happy path, single-denial retry with a fresh batch, persistent-denial reject, non-auth no-retry, deleteOnly/replaceId ops).
- `fetchOverridesForWeek(dates)` — **module-scope + EXPORTED (for testing)**. Fetches the week's existing overrides for conflict classification; **fails closed** — on a read failure it throws a tagged `conflictReadFailed` error rather than returning `[]` (an empty result would silently misclassify existing overrides as absent).
- **"Download the original roster" — the button that did nothing for six releases** (added v22.16, fixed v22.52). Every failure message on this card ends in "check it against the PDF", and the file leaves the workflow the moment the parse returns, so the review offers it back. It was reported from the station as simply not working, and there were TWO independent defects stacked, each silent.
  - **The listener was destroyed by the clone.** The button was created with its own `addEventListener` and appended to `changeList`; the foot of `renderReviewTable` then does `changeList.cloneNode(true)` + `replaceChild` to reset the delegated handler without accumulating listeners — and **`cloneNode` does not copy event listeners**. The button in the live DOM was a listener-less copy. Nothing threw, nothing logged, and it looked perfect in a screenshot. It is DELEGATED now, which is what the file's own delegation comment already said every control here does: there was exactly one exception and the exception was the broken one.
  - **A `blob:` document inherits the page's CSP**, so `window.open(URL.createObjectURL(file))` was never going to work either — it would have surfaced the instant the first defect was fixed. Measured, not inferred: an inline script inside a blob document opened from operations.html is refused, and an `<embed>` appended inside one raises an `object-src` violation. The policy is `object-src 'none'`, and Chrome renders a navigated-to PDF by embedding it as a plugin in a wrapper document — so the wrapper is blocked and the tab paints blank, inside a document the app does not control, which is why no error reaches it. `noopener` is NOT involved: an HTML blob navigates identically with and without it (also measured), so removing it fixes nothing.
  - **The fix hands the file over rather than trying to display it** — `<a download>`, the idiom `paycalc-transfer-card.js` already uses, which `object-src` does not police. It lands the roster in the device's own PDF app, which on Android is where Chrome was sending it anyway. Loosening `object-src` to admit `blob:` was the alternative and was **declined** (owner, Sep 2026): a permanent relaxation of one of the higher-value CSP directives, on every page and both origins, for one convenience button.
  - **The old test asserted the button was VISIBLE**, and it was, throughout. That is the "rule tested, wiring not" failure CLAUDE.md names — the assertion that catches this is the one that takes delivery of the file, so `e2e/operations.spec.js` now awaits the `download` event and checks the filename and that bytes arrived. Teeth-verified by restoring the direct listener: the test fails.
- `detectShiftedRow` — **NOT here.** It moved to `roster-alignment.js` at v22.16 and this bullet went on describing it as exported from this file for thirty releases, alongside a second stale claim: that a flagged member gets a *warn-only* banner. v22.16 ended that — a suspect member's rows now start UNTICKED and three of them refuse the whole read. Corrected v23.52; see the `roster-alignment.js` section, which was right all along.

- `normaliseCellValue(rawShift, baseShift, date)` → `{ value, display, guarded }` (v19.32; defined in `roster-cell-rules.js` since v22.17) — the per-cell Sunday + base-rest-day guards and the `RDW|` display marker, extracted from `computeCellStates` when a SECOND consumer arrived: an unreadable cell whose two AI reads disagreed now offers both readings as a pick, and a picked value must pass the identical guards. Two copies would eventually let a pick write a Sunday AL — the one thing the Sunday layer exists to prevent. `value` is stripped (compares against stored plain-time docs, so re-imports don't churn); `display` keeps the marker (what gets SAVED).

### `paycalc-app.js`
Coordinator for `paycalc.html`. No pure pay maths, no period arithmetic here.
- **Exported `init()` wrap (Phase 4a.2, v14.67):** the whole body is `export function init()`, called by `paycalc-boot.js` (the page loads the boot file — CSP blocks an inline call). The local-identity gate (no local session → login overlay) early-`return`s instead of throwing; importing the module no longer auto-runs it.
- **SOFT auth (Phase 7, v14.66):** gate #1 (local-identity precondition) is intentionally NOT routed through `requirePage` — paycalc needs a local member to namespace its localStorage. The Firebase-confirmation path (`_initErrorReporting`) decides via `requirePage(getAuthSnapshot(), 'paycalc')`, which being `soft` returns only `allow`/`soft-allow`, never `login`, so the calculator is never blocked.
- `calculate()` — main calculation engine (calls paycalc-calc.js pure functions)
- `onPeriodChange()` — orchestrates all period-level updates; calls helpers from paycalc-periods.js and paycalc-settings.js
- `autosave()` — saves hours data per period to localStorage
- `_applyRosterSuggestion()` — roster pre-fill, imported from `paycalc-roster-hint.js` (whose private `_suggestIfBlank` it uses)
- HPP card, sticky take-home bar, back-pay card
- `_bpAmount` / `_bpPNum` — back pay state (v10.73). `calcBackPay` still returns `bpVarAmount` (the variable-pay portion of the lump), but the coordinator no longer stores it: it is **no longer fed into HPP** (v16.89 double-count fix — `calcHPP()` takes no back-pay arg; the whole-year settled-rate pricing already carries the award uplift)
- Imports `SK`, `periodKey`, `hppEstKey`, `hppActualKey`, `runMigrations` from `paycalc-migrations.js`; lightbox lifecycle delegated to `paycalc-lightboxes.js`. Back-pay maths (`calcBackPay`, `prefillBackPay`) delegated to `paycalc-backpay.js` — see that module's section
- Period select, prev/next, tax-year tabs: delegated to `paycalc-periods.js`
- Grade cache, settings save/load, rate/YTD fields: delegated to `paycalc-settings.js`

### `paycalc-result-headline.js`
Which figure is the headline, and what it is called (v22.56 — extracted from `calculate()`).
- `headlineLabels({hasActual, payday, bpThisPeriod, hppForPeriod, bpIsEstimate, hppIsEstimate})` → `{netLabel, stickyLabelHtml, stickyWords, bdBtnHtml}` (`stickyWords`: the strip's label as plain text — the take-home bar's name leads with it and the amount, v25.27) — PURE, so both branches' wording can be held side by side. The visible label and the accessible name are built from one branch deliberately: a screen-reader user and a sighted user must not disagree about whether the figure is confirmed.
- `renderResultHeadline({actual, net, payday, …})` — paints it. **Every shared target is written on BOTH paths**; that is the contract, because a target left unwritten keeps the previous render's value. `#summary` is the one exception (the estimate path leaves the ordinary rows to paycalc-breakdown.js) and is named rather than left to be noticed.
- The actuals gate stays with the CALLER — this module takes the resolved value, since who may see device-local payslip figures is a question about identity.
- `renderYtdLine(from)` — the Year to Date line under the figure (`#netYtdNudge`): shown with the date of the payslip `from` names, hidden and its date cleared for null. Written on every run, for the same reason as the headline. Whether it shows is `ytdUpdateFrom`'s rule, not this module's.
- `wireYtdLine()` — the line's button: opens the Year to Date card through its header (as the `#payslipCard` deep link does), scrolls to it and focuses `#ytdPay`.

### `paycalc-money-banner.js`
The two opt-in money banners on the result card (v22.56).
- `backPayBannerCopy({thisPeriod, amount, isEstimate, aprilYear})` · `hppBannerCopy({forPeriod, amount, isEstimate})` → `{text, note}` — PURE. `included` (the tick's own state) decides the sentence; availability only decides whether there is anything to offer. The notes differ on purpose: back pay always explains how to improve the estimate, HPP prompts only when opted in to a figure that is still an estimate — the one state with a next action.
- `paintBanner({rootId, textId, tickId, noteId, available, included, copy, tickYear?})` — hides by `display` and touches nothing else, so a hidden banner cannot reappear carrying the previous payslip's number.

### `paycalc-lightboxes.js`
Lightbox and overlay initialisation for `paycalc.html` — extracted from `paycalc-app.js` at v13.86.
- `initPaycalcLightboxes()` — initialises all five overlays; returns `{ openAboutLightbox, showYtdNotice }` so the nav-panel drawer logo can open the About panel
- **About panel** — `initAboutLightbox({ appLabel, getUserName })` with header logo wired as back-to-calendar button
- **Help lightbox** — `HELP_CONTENT`-driven; opened by any `.help-btn[data-help]` button
- **YTD notice** — one-time per device on `NOTICE_YTD_KEY` (`myb_pc_ytd_notice_2_shown`); archives via `archiveNotice()` on close; re-posted 28 Aug 2026 for one 90-day run, live until ~26 Nov 2026. It used to wait for the welcome lightbox, retired v19.36. Arriving at `#payslipCard` (the Calendar's Year to Date notice, v24.86) flags it seen and does not open it: the member has just read the same instruction, and opened it would cover the card the link opened
- **Decimal hours converter card** — `initCardCollapse` toggle; converts decimal hours to hr/min text on input
- Imports: `overlay.js`, `about-lightbox.js`, `paycalc-help.js`, `nav-panel.js`, `ls.js`, `paycalc-format.js`, `paycalc-migrations.js`, `paycalc-settings.js`, `status-text.js`

### `paycalc-periods.js`
Period arithmetic and select UI for `paycalc.html` (v13.80).
- `CONFIG` — period anchor, PERIOD_DAYS, PERIODS_PER_YR, FIRST/LAST_OFFSET, TAX_YEARS
- `getPeriods()` — returns the full period array; result is cached (avoids ~78 Date allocations per calculate())
- `currentPeriodNum()` — reads `#periodSelect` value
- `todaysPeriodNum()` — the period being earned TODAY (independent of the selected period); the
  back-pay accrual caps at it so a future selection can't accrue unworked weeks
- `buildBackPayPeriodSelect(minPNum = 0, maxPNum = Infinity)` — optional floor + ceiling so the back-pay paid-in dropdown only offers periods within the award's own tax year (prefillBackPay passes `48 + ty.first`, `48 + ty.last`)
- `buildYtdSourceSelect(ty)` (v17.98) — offers the tax year's PAID payslips (newest first) for the Year to Date card's "From which payslip?" source select — plus, from its cut-off, the payslip about to be paid (`ytdSourceOffered`)
- `periodLinkMissNote(askedFor, periods)` (whole-app review, Oct 2026) — the line `#periodLinkNote` shows when a `?payday=`/`?month=` deep link names a payslip the calculator does not carry, naming the date asked for and the range on offer. `buildPeriodSelect` fills it; it opened the current payslip silently before. '' when the link matched.
- `payslipMayBeInHand(p, now?)` (v24.87) — `p.cutoff <= now`: from its cut-off a payslip may be in the member's hand (it arrives before payday). ONE rule for the two surfaces that read a payslip the member holds: the Year to Date picker (`ytdSourceOffered` calls it) and the "Check against your payslip" box, which appeared only from payday until v24.87. Period dates sit at noon, so the turn comes midway through the cut-off day.
- `ytdSourceOffered(p, ty, now?)` / `ytdAutoSource(ty, now?)` (72-hour review) — payslips are issued BEFORE payday, so from the current period's cut-off its payslip may already be in hand and the picker offers it. The first-entry auto-anchor is the standing assumption (the payslip before today's, clamped into the year), which the member corrects by picking; a window that recorded nothing was tried and removed (it stamped a payslip LATE after payday)
- `ytdUpdateFrom({ p, ty, src, inUse, taxCode, now? })` — the payslip whose Year to Date figures the line under the take-home £ (`#netYtdNudge`, painted by `renderYtdLine`) asks for: the one before `p`, or null. Quiet on a paid payslip, the tax year's first, a W1/M1/X or NT code (read exactly as `computeTax` reads it), while the figures are in use (`inUse` = `computeTax`'s `usingCumulative`), when they come from `p` or later, and until that payslip can be in hand (`payslipMayBeInHand`)
- `hasBoxingDay(p)` / `hasBankHoliday(p)` — period content checks
- `CONDITIONAL_ROWS` — data-driven array: `{ condition, rows, fields }` — used by `updateBhRows`
- `updateBhRows(p)` — shows/hides BH input rows based on period content
- `buildPeriodSelect()` — populates the period `<select>`, handles URL params, calls `buildBackPayPeriodSelect()` internally; returns the current earning period number — caller must assign it to `_defaultPeriodNum` first, then call `onPeriodChange()` explicitly
- `buildBackPayPeriodSelect()` — populates back-pay period selectors
- `updateTyTabs()` — highlights the active tax-year tab
- `jumpToTaxYear(tyIndex, onPeriodChange)` / `prevPeriod(onPeriodChange)` / `nextPeriod(onPeriodChange)` — navigation; accept coordinator's `onPeriodChange` callback to avoid circular dependency
- `_setSelectPeriod(sel, pNum)` — internal `<select>` value setter (test-exposed; covered by `paycalc-periods.test.mjs`)
- `payslipPeriodNum(p)` — the number PRINTED on the payslip (weeks-into-year ×4, resets each April: April = P4 … 13 Feb 2026 = P48 … P52). Display-only; internal `p.num` unchanged
- **New-starter visibility clamp:** `computeEarliestVisiblePNum(member)` (pure) → the first period of a member's JOIN tax year; genuine new starters (a `startDate`, NOT a `noProRate` full-year return) are clamped so they only see "from this year onwards". `setEarliestVisiblePeriod(member)` stores it (coordinator calls it at init with `getLoggedMember()` — avoids a circular import), `getEarliestVisiblePNum()` reads it, `visiblePeriods()` filters `getPeriods()`, `isTaxYearVisible(ty)` gates the tax-year tabs. `buildPeriodSelect`/`buildBackPayPeriodSelect`/`prevPeriod`/`nextPeriod` all honour the clamp
- Imports `P_YR, TAX_YEARS, getTaxYearForOffset` from `paycalc-calc.js`; imports `bhsForYear` from `paycalc-roster-suggestions.js`

### `paycalc-settings.js`
Grade/contracted-hours helpers and settings persistence for `paycalc.html` (v13.80).
- `getGrade()` / `getContr()` — grade key and contracted hours from localStorage; result cached in `_gradeCache`
- `getLoggedMember()` — returns the logged-in member's `teamMembers` entry or null
- `getEffectiveContr(p)` / `getProRateFactor(p)` — pro-rated helpers (full period if `noProRate`)
- `getPensionDefault(pObj)` — period-aware pension default for the current grade, **and the one place the out-of-scheme answer is given** (v21.64): it returns 0 when `isPensionOptedOut(pObj)`, so the field default, `calculate()`'s fallback, the HPP non-premium estimate and the year summary inherit it from the function they already share rather than each asking separately. Every caller but two already passed a period, which is what let the v21.78 temporal fix land in one edit
- `isPensionOptedOut(pObj)` — was this member out of the RPS **on this payslip**? **Period-aware since v21.78** and that is the whole point (see `paycalc-pension.js`): as a bare boolean it made the default £0 for every payslip there has ever been, so a historical period storing `null` was rewritten retroactively — reproduced at £160.78 → £0.00 and £115.92 onto one take-home. No period in hand answers CONTRIBUTING, not "the latest state". A SEPARATE record from the amount: overloading £0 to mean "not a member" collides with the round trip's rule that a value equal to the period default stores as null, so an opted-out member's 0 would erase itself
- `getPensionTimeline()` / `savePensionTimeline(timeline)` — read/write `SK.pensionTimeline`, the member-level list of pension changes. Read fresh each time; a cached copy is how a Settings save and the next recompute come to disagree
- `buildPensionFromSelect(timeline)` — populates and SETS the "not in the scheme from which payslip?" control, the same shape as the student-loan cutover beside it. It sets the payslip already ON RECORD, not today's: defaulting a populated control back to the current payslip invites an accidental correction that silently moves months of pension. Stays visible once any change is recorded, so a rejoin has somewhere to name its payslip
- `periodDefaultPension(p)` — the £ a payslip's pension field would show with nothing typed: the period-aware scheme default × the joining-period pro-rate, to 2dp. The ONE source for a comparison or write that was hand-rolled at six sites (v18.46); moved here from the coordinator at v21.78 — both its inputs are in this module, and it is a pay RULE, which is what the coordinator ratchet asks to be moved out rather than capped
- `wirePensionControls({autosave})` (v21.78) — wires the tick and the "from which payslip" select, beside the rules they drive. **Order matters twice:** the date control is BUILT before the save (a first tick needs a payslip to date itself from, and `saveSettings` reads that control), and `saveSettings` runs a SECOND time after the field is rebuilt — without it, un-ticking left the member-level default at '0.00' behind a box reading "in the scheme" (v21.77)
- `gradeForRole(role)` → `'cea'|'ces'|null` (v21.78; **re-exported from `roster-data.js` since v24.86**, where the Calendar's Year to Date notice can ask it without loading this module) — the grade this app has confirmed rates for, or **null**. Written because the absence of a grade was indistinguishable from CEA: `getGrade()` returns `''` for anybody with no stored grade and every consumer falls back to `GRADES.cea`, so the ten Dispatchers and seven manager accounts could open the calculator and be handed a complete, polished estimate at somebody else's rate. `paycalc-app.js` refuses on a null (`_showUnsupportedRole`) rather than captioning a working form. Do not extend the map to a role until a real payslip has confirmed it
- `applyPensionOptOutUI()` — reflect that choice in `#pensionAmt` (disabled, £0.00). Disabled rather than hidden: the figure still answers "what came off my pay?", and hiding it makes the deduction unexplained rather than explained as nil
- `updateRateForPeriod(ty, p)` / `updateYtdForTaxYear(ty)` — load the period-aware rate (pre-award periods get the old rate) and YTD figures into form fields; called from coordinator's `onPeriodChange`. The rate field is **read-only** (grade-fixed, v17.87) with a "· pre-rise/current rate" label + `#rateStepNote` explaining the step
- `getStoredRateForYear(ty)` — the hourly rate for a tax year. Since v17.87 the rate is FIXED BY GRADE and no longer user-editable/stored, so this derives it purely from `AWARD_RATES` (the year's confirmed settled rate) → grade default (no localStorage). Used by `updateRateForPeriod`, the prior-year HPP estimate, and back-pay prefill. `saveSettings` persists NO rate now (removed the stale-saved-rate bug class); Grade + Tax Code + Pension are the editable settings
- `settingsKey(ty)` — per-tax-year localStorage key for the confirmed flag
- `saveSettings()` — persists all settings fields; does not set confirmed flag. Writes `SK.pensionOptOut` BEFORE the amount, because `getPensionDefault()` consults it and the amount's own fallback must see the state just chosen
- `confirmSettings(calculate)` — saves, marks confirmed, collapses card; calls `calculate` callback (passed by coordinator to avoid circular dep)
- `setSettingsCardOpen(open)` — programmatic open/close keeping `aria-expanded` in sync
- `loadSettings()` — loads persisted settings into form on page init
- Imports from `paycalc-calc.js`, `paycalc-periods.js`, `paycalc-migrations.js`, `session.js`, `roster-data.js`, `ls.js`, `paycalc-format.js`, `status-text.js`, `paycalc-pension.js`

### `paycalc-roster-hint.js`
Roster-assist hint bar UI, fill logic, and snap persistence for `paycalc.html` (v13.81).
- `HM_PAIRS` — the hour/minute field pairs the hint bar fills, declared once so the fill and the clear iterate the same list.
- `updateRosterHint()` — re-renders the hint bar based on current suggestion state
- `updateJoinerNotice(p)` — shows/hides the pro-rata joiner banner for joining periods
- `toggleRosterDays()` — expands/collapses the day-level breakdown in the hint bar
- `fillFromRoster(autosave)` — fills all blank hour fields from the current suggestion; calls `autosave()` then `updateRosterHint()`
- `fillCategoryFromRoster(cat, autosave)` — fills one category (sat/bh/sun/rdw/box) from suggestion; calls `autosave()` then `updateRosterHint()`
- `_applyRosterSuggestion(s, force, {clearZeros})` — applies a suggestion object to form fields; returns `{written, cleared}` category lists for the honest fill feedback (v21.67). `clearZeros` (v21.68): on an explicit Replace with FULLY-LOADED calendar data, a zero category clears a non-empty field — zero is the calendar's answer (a shift removed in admin), not an absence of information. Never set in the base-only state, where the missing record might be exactly the hours on screen; never set on the non-force path (the late-fetch re-apply)
- `clearRosterSuggestedAll()` — removes all `roster-suggested` CSS highlights
- `_restoreRosterSuggested(pNum)` — restores highlight state from snap on period load
- `snapKey(pNum)` — localStorage key for the snap of suggestion state for a period; exported so coordinator's `clearPeriod()` can call `lsDel(snapKey(pNum))`
- `_confBadge(cat, fromOv, estimateHours)` — the row's confidence chip. A row whose figure holds a DEFAULT says so ("Includes an 8h estimate — check" for an untimed Other rest day, "Includes a 7h estimate — check" for a bare Training day on a bank holiday, owner 7 Nov 2026) — exported so the wording is unit-tested, because an unflagged bank-holiday row carries no chip at all
- `renderRosterDayList(days)` (internal, not exported) — renders the per-day breakdown rows into the hint bar
- Imports from `paycalc-periods.js`, `paycalc-settings.js`, `paycalc-roster-suggestions.js`, `roster-data.js`, `ls.js`, `paycalc-migrations.js`, `paycalc-format.js`, `status-text.js`
- Does NOT import from `paycalc-app.js` (circular dependency avoided via callback parameters)

### `paycalc-hpp-schedule.js`
PURE payslip ↔ tax-year relation for the Holiday Pay Premium (v18.85). No DOM, no storage, **no imports at all** — the period grid and tax-year table are passed in, so it unit-tests in plain Node with no mocks.
- **The rule:** a tax year's premium is paid on the **first January payslip of the FOLLOWING tax year** — `ty.hppPaidJan` names a January that falls OUTSIDE `ty`'s own period window. That last clause is the trap.
- `periodsInTaxYear(ty, periods)` — the year's own 13 payslips, in payday order
- `hppPayslipForTaxYear(ty, periods)` — the payslip that CARRIES `ty`'s premium (searched across the whole grid); null when the grid doesn't reach that January yet
- `hppTaxYearForPayslip(p, periods, taxYears)` — the inverse: whose premium lands on `p`; null for any non-carrying payslip, and only the EARLIEST January payslip qualifies (a premium can never be added twice)
- `hppPaidInTaxYear(ty, periods, taxYears)` → `{ taxYear, payslip }` — the premium paid INSIDE `ty`'s window, which is always the PRIOR year's. This is the inversion "This tax year so far" got wrong
- **Why it exists:** the relation was hand-rolled as raw date comparisons in FOUR places in two directions, and one was wrong for the feature's whole life — `computeYearSoFar` searched for `hppPaidJan` among the tax year's OWN paydays (never matches), silently dropping every opted-in premium from the year-so-far totals while the result card added it (v18.84). Callers now ask this module instead of re-deriving. Consumed by `paycalc-app.js` (`calculate()`'s `_hppTy`), `paycalc-hpp.js` (`updatePriorHpp`'s January gate), `paycalc-year-card.js` and `paycalc-year-summary.js`
- Tested by `paycalc-hpp-schedule.test.mjs` — including the **round-trip invariant** (carrier → tax year → carrier). `TAX_YEARS` is IMPORTED from `paycalc-calc.js` (v18.91 — it was a hand-copy until then, so changing the real `hppPaidJan` left the suite green); the period grid is still mirrored locally, because `paycalc-periods.js` pulls in Firebase. What actually pins the v18.84 bug is the round trip plus `paycalc-year-summary.test.mjs`'s realistic January fixture — the two together, not the round trip alone

### `paycalc-hpp.js`
Holiday Pay Premium estimator and shared period decode helpers for `paycalc.html` (v13.81).
- `isDataEmpty(d)` — returns true if all hour fields in a persisted period object are zero/falsy; exported for coordinator's `updateSaveStatus` and for `paycalc-backpay.js`
- `_decodeHours(p, d)` — decodes raw period data into `{satHrs, bhHrs, bhOtHrs, otHrs, rdwHrs, sunHrs, boxHrs}` floats; exported for `paycalc-backpay.js`
- `_varPayForPeriod(p, d, rate)` — the HPP-accruing variable pay for one period (OT/RDW/Sun/Sat/BH/Boxing premiums). **Excludes contracted basic, peer pay, AND London Allowance** — London is a fixed allowance that does not accrue HPP (removed v17.23; see KNOWN_LIMITATIONS #3). Used by `calcHPP`, `updatePriorHpp`, and `paycalc-backpay.js`
- `calcHPP()` — renders the HPP estimate card (takes NO args since v16.89: back pay is deliberately not folded into HPP — the whole-year settled-rate pricing already carries the award uplift). **Amount-source aware (v18.32):** `'hours'` (default — the per-payslip estimator), `'ytd'` (a quick "extra pay so far this year" figure × 7.69%), or `'exact'` (a hand-entered figure). Whichever mode, the resulting figure is written to `hppEstKey(ty)`, so the January take-home add + prior-year rollover are unchanged. **Per-radio figures (v18.40, review item 4):** the hours estimate is computed in EVERY mode (the side-effect-free internal `_hoursEstimate`) and each amount-source radio shows its CURRENT £ (`_updateModeAmounts` → `#hppMode*Amt` spans; "≈" marks the two estimates, the member's exact figure shows plain) so the choice is informed — persistence stays strictly per-active-mode
- `hppFromYtdTaxable(taxablePayYtd, nonPremiumYtd)` — PURE: `max(0, taxable − nonPremium) × 4/52`. Isolates the premium portion of the Year to Date **Taxable Pay** (by removing expected basic + London − pension, computed by the internal `_expectedNonPremiumYtd`, which also removes `knownYtdLumps`) then takes 7.69%. The 'ytd' mode reads the Year to Date Figures card's `#ytdPay` and derives a ROUGH figure from it (v18.34 — replaced the v18.32 separate "extra pay" input); unit-tested
- `knownYtdLumps({covered, readSaved, rateFor, hppCarrier, priorHppAmount})` (72-hour review) — PURE: the non-premium lumps inside a Year to Date Taxable Pay figure the app holds exactly — peer-training pay (2h basic per day) and last year's Holiday Pay Premium once its January payslip is covered. The back-pay lump is deliberately NOT removed: its amount is not stored in compute mode, and only its basic/London share (a split the app does not hold) should come out
- `applyHppMode(mode?)` — reflect a mode into the DOM (tick its radio, show only the matching group). 'ytd' has no input of its own — it shows a note and reads the Year to Date card
- `saveHppState(ty)` / `restoreHppState(ty)` — persist / restore the card's mode + the exact-figure input, PER TAX YEAR (`hppModeKey`), mirroring the back-pay per-year blob; the coordinator restores before `calcHPP` reads the DOM on a period/year change
- `resolveHppForPeriod(actualRaw, estRaw)` — PURE: picks the HPP figure to add to the January take-home — a stored confirmed actual (`actualRaw`) wins over the estimate (`estRaw`); read by the coordinator's take-home add and the prior-year rollover
- `updatePriorHpp(ty)` — renders the prior-year actual HPP section
- Imports from `paycalc-calc.js`, `paycalc-periods.js`, `paycalc-settings.js`, `paycalc-migrations.js`, `roster-data.js`, `ls.js`, `paycalc-format.js`, `paycalc-hpp-schedule.js`

### `paycalc-fill-year.js` / `paycalc-year-card.js`
Fill this tax year from Calendar (v22.06).
- `paycalc-fill-year.js` (pure, Node-loadable — which forced two re-homings: `HM_PAIRS` and `isDataEmpty` → paycalc-format.js (the pure, DOM-free home — its only import is date-format.js), re-exported from paycalc-roster-hint.js / paycalc-hpp.js + paycalc-form-data.js so no importer changed): `fillablePeriods({periods, now, proRateFactor, readSaved})` (the same paid+employed+empty test the "Not entered yet" list uses; corrupt periods separated, never eligible) · `fillYearFromCalendar({periods, member, now, deps})` (sequential — the suggestion module keeps one override map per fetch; deps injected: fetchOverrides/suggest/readSaved/write; a non-'loaded' fetch state SKIPS the period — no base-only fills into invisible periods) · `fillYearReceipt(r, fd)` (dates by name, four line kinds, an explicit all-clear).
- `paycalc-year-card.js`: `initYearCard({afterFill})` (one delegated listener; afterFill = the coordinator reloading the visible form if filled, then recalculating) · `renderYearCard({ty, plan, pgLoan, slPaidOffFromP, bpLump})` — `_renderYearSoFar` moved from paycalc-app.js verbatim, plus the fill button beside "Not entered yet", the from-zero slim state, and the receipt block (kept per tax-year label until the year changes).
- **A fill that THROWS restores the control and says so (v23.71).** Everything on the success path restores the button by REPLACING it — `afterFill` recalculates, which re-renders the block — so the failure path had no restore at all: `fillYearFromCalendar` wraps only `fetchOverrides`, so a throw from `suggest`, `readSaved` or `write` rejected straight out of a click handler that returns no promise. Nothing on screen, and a permanently disabled button still reading "Filling from your calendar…". `_runFill`'s `catch` re-renders from `_lastArgs`, which is both the restore and the message. **The wording may never claim nothing was written** — the loop writes period by period, so a throw part-way leaves earlier periods genuinely filled; same rule as the range writer's `partialCommit`
- Tested by `paycalc-year-card.test.mjs` — which found that defect. `computeYearSoFar`, the period calendar, `readSavedPeriod` and the whole of `paycalc-fill-year.js` run REAL over an in-memory `localStorage`; only the two modules that reach Firebase and the hint bar are mocked

### `paycalc-year-summary.js`
"This tax year so far" for the Year to Date Figures card (v18.41 — review item 11).
- `computeYearSoFar(ty, opts)` — a headless re-run of the calculator over every PAID payslip of the tax year with saved hours: per payslip, decode (`_decodeHours`) → `computeGross` (period-aware rate + pro-rated London + the payslip's own saved pension, else the default) → non-cumulative `computeTax`/`computeNI`/`computeSL` (honouring the per-period `slSkip` AND the item-9 loan-repaid cutover via `opts.slPaidOffFromP`). Returns `{ entered, paid, total, taxable, tax, ni, sl, net, projectedNet, skipped, missing }` — `projectedNet` = recurring net ÷ entered × the employed periods, plus one-off lumps added once, deliberately labelled rough; corrupt periods are counted in `skipped`, never silently dropped. NO DOM — the caller passes the current tax-code/loan settings in `opts` (and an injectable `now` for tests)
- Rendered by `renderYearCard` (`paycalc-year-card.js`) into `#ytdYearSoFar` after every `calculate()`; hidden until at least one payslip of the year has hours
- Imports from `paycalc-calc.js`, `paycalc-periods.js`, `paycalc-hpp-schedule.js`, `paycalc-settings.js`, `paycalc-migrations.js`, `paycalc-hpp.js`
- Tested by `paycalc-year-summary.test.mjs` (mock harness mirrors `paycalc-hpp.test.mjs`; the money assertions mirror each payslip through the REAL calc engine)

### `paycalc-backpay.js`
Back-pay lump sum calculator for `paycalc.html` (v13.81).
- `_bpAwardTaxYear(fromPNum)` — tax year of the back-pay award (derived from "backdated from" period); exported for the coordinator and tests
- `prefillBackPay()` — pre-fills card inputs when the card opens / a new award year is first viewed; returns `calcBackPay()` result for coordinator to consume. On an award-year change it clears the previous year's figures, resets the opt-in tick, and applies the year's default mode (compute for the current award, enter-from-payslip for a prior one). For an **unconfirmed** award year it fills Old rate/London and leaves New blank for the % helper; a **confirmed** year's boxes are enforced+locked by calcBackPay (below)
- `calcBackPay()` — calculates the lump from the card inputs (compute mode: rate×hours accrual; manual mode: the typed payslip figure), renders results, returns `{ bpAmount, bpVarAmount, bpPNum, bpIsEstimate, bpIncluded }`; does NOT mutate coordinator state. For a CONFIRMED award it also ENFORCES the authoritative AWARD_RATES/TAX_YEARS figures into the Old→New boxes and locks exactly those (a figure not on record — e.g. CES 2025/26 old rate — leaves its box permanently editable; the lock never keys off box contents, v17.94). Toggles the `#bpEstimateNote` banner + "Pay rise %" visibility for an unconfirmed year, and hides the paid-in selector for a decided award (auto-set). Also writes the card-leading STORY strip (`#bpAwardScope`) on every exit path via `bpStoryHtml` (v18.39)
- `paidInPeriodNum(periods, awardFrom)` — PURE (v18.13): the number of the first period whose payday is on/after `awardFrom` — the payslip that carries a DECIDED award's backdated lump. Null for an undecided award / no qualifying period. `calcBackPay` (and prefill/restore) derive the paid-in through this for a decided award instead of trusting the persisted selector value, so an award-date MOVE (the 3.6% award 31 Jul → 28 Aug) can't leave the lump/"green box" on the old payslip. Unit-tested in `paycalc-periods.test.mjs`.
- `_accrueBackPayPeriod(i)` — PURE per-period back-pay arithmetic (no DOM/storage; unit-tested in `paycalc-periods.test.mjs`) → `{ backPay, varPay }`. `backPay` (the lump) = contracted + premium-bucket + peer + pro-rated London diffs. `varPay` (the HPP-accruing portion) = premiums ONLY — it EXCLUDES London (London does not accrue HPP, v17.23) and is currently unused downstream. calcBackPay maps DOM/storage to these numbers — do not re-inline the maths
- `awardWindowFactor(p, backdatedFrom, periodDays?)` / `_awardBackdateDate(awardTy)` — PURE (v21.79, VAL-PAY-001 settled). **How much of a period's SHIFT WINDOW the award actually covers**, 0…1. A period is 28 days of shifts paid six days after its cut-off, so the FIRST period of a tax year covers work done largely in MARCH — and the award is backdated to 1 April. The accrual counted it whole, and the app was **19% high**: £977.69 estimated against £821.68 paid on the real 28 Aug 2026 payslip. The London Allowance is what makes it checkable to the penny — a flat per-period uplift with no hours in it, so it isolates the window from everything else: 4/28 + 4 whole periods × £9.94 = **£41.18**, exactly the arrears inside that payslip's London line. Basic agrees to within £2.30 (0.5%). It scales the period's WHOLE accrual including premiums, deliberately: hours are stored per PERIOD with nothing finer to apportion, so inventing a weekly split from period totals would look more precise and be less true. Fails towards 1 (the old behaviour) with no backdate in hand, so a malformed tax-year label cannot zero somebody's lump. **That fail-open is also why the unit tests alone do not guard this** — a caller that stops passing the factor gets the default and the defect back, in silence, with every unit test green (measured). The wiring is guarded by the rendered £ in `e2e/paycalc.spec.js`, which is derivable by hand from the rates: five periods, the first at 4/28, basic + London only = £476.18 against the defect's £574.70
- `restoreBpState()` — restores the persisted card figures for the VIEWED award year from its own per-year blob (`bpKey(ty)` → `bp_state_<year>`, written by calcBackPay on every recompute), rebuilding the paid-in list for that year first so the saved selection applies. Returns true when a blob was applied — EVEN an all-blank one (a deliberate clear must stick). Called by the coordinator's `_syncBackPayForViewedYear()` on init AND every period change: true → recompute the saved figures; false (no saved state for this year) → prefill the DEFAULT (compute-estimate for the current award, enter-from-payslip for a prior one). The lump only JOINS the take-home when the opt-in tick (`#bpIncludeTick` mirrored by the banner `#bpBannerTick`, OFF by default, persisted as `inc`) is set AND its paid-in payslip is the one viewed (`_bpPNum === _pNum`)
- **Per-year viewing (v17.86):** the card follows the VIEWED payslip's award year (`_backdatedFromPNum` uses `currentPeriodNum` again), with per-year state keeping each year's tick/rates/mode/manual-amount apart (supersedes the v16.91 pin-to-today). `applyBpMode(mode?)` — exported; reflects the amount-source toggle (`bpMode` radios) into the DOM, showing `#bpComputeFields` (rate×hours accrual) or `#bpManualWrap` (`#bpManualAmt`, the actual figure from the payslip). `_defaultBpMode(ty)` → compute for the current award, manual (enter-from-payslip) for a prior/already-paid one
- `bpStoryHtml(o)` — PURE (v18.39, review item 5): the plain-English story leading the card — award shape (tense-aware, date-first payslip naming, backdated-to 1 April year from the label) + the member's figure per state (`computed` "roughly £X" / `manual` exact tense-aware / `manual-empty` prompt / `empty-window` / `no-figures` facts-only). Unit-tested in `paycalc-periods.test.mjs`; replaced the static award-scope line + the removed generic card explainer
- `raiseByPercent(oldVal, pct)` — pure; new value after a % rise (`oldVal × (1 + pct/100)`), 0 for non-positive inputs. Backs the coordinator's "Pay rise %" shortcut that fills the New rate/London from the Old figure (v15.62)
- Imports from `roster-data.js`, `paycalc-calc.js`, `paycalc-periods.js`, `paycalc-settings.js`, `paycalc-migrations.js`, `paycalc-hpp.js`, `paycalc-format.js`, `paycalc-backpay-state.js`, `status-text.js`, `ls.js`
- **Tested by `paycalc-backpay.test.mjs`** (v23.63) — the ASSEMBLY, not the rules. `calcBackPay` needs only `getElementById`, `querySelector` and localStorage, so a fake `document` drives the real function to its real return value: the priced window, the first period's fraction, the rate boxes being overwritten from the record, the paid-in gate on both modes, and the rows summing exactly to the headline. Expected figures are derived from `TAX_YEARS` + the pure accrual, never written down. Teeth-verified by ten mutations — and it records the three that CANNOT fail: the paid-in exclusion and the award-date stop are redundant with each other while every award has a payment date on record (removing both together fails six cases), and the tax-year fence and the `fromPNum` lower bound are both covered by `awardWindowFactor` returning 0 before the backdate

### `paycalc-format.js`
Pure date/currency formatters + time-input helpers shared by `paycalc-app.js` and `paycalc-backpay.js` (v14.06; time helpers added v17.74 / Section G). No DOM, no Firebase; its only import is `date-format.js`. Tested by `paycalc-format.test.mjs`.
- `fdList(dates, cap = 4)` — a run of dates as prose, truncated past `cap`.
- `fd(d)` — formats a Date as "1 Apr 26" (day + short month + 2-digit year)
- `fdShort(d)` — formats a Date as "1 Apr" (day + short month only)
- `fdLong(d)` — formats a Date as "1 Apr 2026" (day + short month + full year) — the payday / joined-on / printed-on long form; de-duplicated from ~8 inline `toLocaleDateString` copies across `paycalc-app`/`-backpay`/`-periods`/`-roster-hint` (v18.30). Same no-timeZone rationale as `fd`
- `fmt(n)` — formats a number as a currency string, e.g. "£1,234.56"
- `clampMinute(n)` — clamp a parsed minutes integer into [0, 59] (pure core of the hrs/mins field's `clampMins` DOM wrapper)
- `minutesFieldText(m)` — what a minutes box SHOWS for a value the app writes: two digits (`0` → "00", `5` → "05"), `null` → ''. Display only — every reader parses the box, so the stored period is unchanged. Used by the calendar fill (`paycalc-roster-hint.js`), `writeFormData` (non-zero only) and the coordinator's decimal split / Saturday cap
- `decimalToHM(val)` — split decimal hours → `{h, m}` with a 60→next-hour float guard (e.g. 7.999 → 8h 00m); returns null for negative/non-finite. The single source for the live "= 7h 30m" preview AND the on-blur "7.5 → 7 hrs 30 mins" split (was duplicated inline in `paycalc-app.js`)
- `HM_PAIRS` · `isDataEmpty(d)` — the hrs/mins field pairs and the "nothing entered" test, homed here for `paycalc-fill-year.js` (see that entry)

### `paycalc-breakdown.js`
The two PURE HTML builders for the pay-result card, extracted from `calculate()` in `paycalc-app.js` (v18.30, review item 20). `calculate()` used to interleave DOM reads, pay maths, and result-markup string-building; the markup now lives here, written + unit-testable independent of those phases. No DOM, no Firebase — only dependency is `fmt` from `paycalc-format.js`. Output is byte-identical to the old inline templates (a mechanical extraction, not a redesign). Each builder takes a plain params object whose field names match the caller's locals, so `paycalc-app.js`'s call site is a shorthand object literal. Tested by `paycalc-breakdown.test.mjs`.
- `fmtHrsMins(h)` — decimal hours → "Nh"/"Nh Mm" (the per-row hours label; was the inline `fh` in `calculate()`)
- `buildSummaryRows(d)` — the `#summary` estimate rows: Regular/Total pay → back pay → HPP → pension → tax → NI → Student Loan (`d.slLines`, pre-rendered) → estimated take-home
- `buildActualComparison({actual, estimate})` (v22.07) — the estimate-vs-payslip table: one row per payslip line the member typed (an absent figure is not a £0 claim; net alone renders nothing — the verdict line owns that case), difference signed actual−estimate, dash on an exact match, and it EXPLAINS NOTHING — cause words are banned by test. Inputs autosave into the period blob as `actualGross`/`actualTax`/`actualNi`/`actualPension` (paycalc-form-data — same null-when-blank rule as `actualNet`; none joins `isDataEmpty`), and `writeFormData` OPENS the disclosure when restoring saved figures so they never land in a closed section
- `buildActualCheck(actual, estimated, used?)` — the payslip-vs-estimate reconciliation line. `used` = `{ taxCode, recognised, pension, ytdFrom? }` the estimate APPLIED (`ytdFrom`, v24.89, only when the cumulative method ran: a large gap then names the payslip the Year to Date figures count from); when given, a gap over £2 names them first — and a code the engine does not recognise is named as unrecognised, with a zero-not-O hint where an O was typed, never as the code in use (v24.89) (v24.87 — the close band the code, before the Year to Date advice; the large band code and pension, before hours/absence/back pay). Only a plain letters-and-digits code is quoted, so nothing typed reaches the page as markup. `buildProvChips(d)` — the provisional-figure chips (`''` when there are none). Both pure, both cited by `.claude/rules/paycalc.md`.
- `buildBreakdownRows(d)` — the `#bdBody` full breakdown: one row per pay component present (Mon–Fri + London always; premiums/OT/RDW/training/adjustment/notes/extras guarded on > 0)

### `paycalc-form-data.js`
The per-period form ↔ saved-data **round trip** for `paycalc.html`, extracted from `paycalc-app.js` at v19.11.
- `emptyPeriodData()` — the saved-period schema. **Deliberately carries no `pension` key:** an absent key and an explicit `null` both mean "apply the period default" (`writeFormData` restores only when `!= null`), while a stored `0` survives as the genuine salary-sacrifice opt-out. Adding `pension: 0` here would re-introduce the pre-v16.84 defect for every cleared period.
- `readFormData({ adjNegative, periodDefaultPension })` — form → object, for autosave. Both dependencies are **injected** rather than imported: `adjNegative` because the ± sign is coordinator state (the sign button, the typed-negative handler and `clearPeriod` all mutate it), and `periodDefaultPension` because the v18.43 self-heal needs this period's default × pro-rate. Injection is what keeps the module testable with no coordinator state and no module mocks.
- `writeFormData(d)` → `{ adjNegative }` — object → form, for load/clear. **Returns** the sign the caller should adopt instead of writing a closure variable. The caller must call `clearRosterSuggestedAll()` FIRST (it used to be this function's opening statement); importing `paycalc-roster-hint.js` here would drag its seven-module graph into an otherwise document-only unit and force every test through mocks.
- **Why the module exists:** these ~70 lines produced four money-affecting defects in four releases, all the same shape — a value the form could legitimately hold being persisted as something it does not mean (blank pension → permanent £0, overstating take-home ~£147/period; garbage mid-edit doing the same at v16.84; `actualNet` repeating it at v18.42; the v18.43 default self-heal). Every one was fixed by adding a comment, because the logic sat inside a 1,963-line coordinator with no seam to test through. The bug class is a round-trip **asymmetry**, which a write→read→write test catches and a comment cannot. Tested by `paycalc-form-data.test.mjs`.
- `settingFieldsWrite(raw, formNow, fields)` (whole-app review, Nov 2026) — what a SETTINGS control (student loan, pension) may write into the viewed payslip's blob: the saved blob with ONLY the named fields replaced, or `null` when nothing is saved or it will not parse. The old path ran the whole autosave, which persisted the calendar's display-only suggestion as entered hours (invariant 11) and wrote a fresh blob over saved entries it could not read. `null` means write nothing.
- `pensionToStore(raw, periodDefaultPension)` (72-hour review) — THE rule for what a pension field's text is stored as: blank/garbage → null, a typed 0 kept, the period default (±0.005) → null so the payslip keeps following `PENSION_STEPS`. Shared by `readFormData` and `confirmSettings` (paycalc-settings.js), whose private `parseFloat(raw) || 0` froze the default onto a payslip and read a pasted "£151.86" as a £0 opt-out
- Imports: `paycalc-inputs.js` (hmPair/numVal), `roster-data.js` (parseSmartFloatOrNull)

### `paycalc-inputs.js`
The DOM-pure form-field input helpers extracted from `paycalc-app.js`'s `init()` (v18.60, review item 10 — continue focused coordinator extraction). They read/normalise the numbers a member types into the hours & figures fields, and own the live "= 7h 30m" decimal hint. They depend ONLY on `document` plus imported pure helpers (`parseSmartFloat`/`parseSmartFloatOrNull` from `roster-data.js`, `clampMinute`/`decimalToHM` from `paycalc-format.js`) — NO coordinator closure state — so they lift out of `init()` cleanly and are unit-testable in Node against a fake `document`. The event WIRING that USES them (`autoDecimalHours`, `onHhMm`) stays in `paycalc-app.js` because it closes over `calculate()`/`autosave()`/period state; it just calls these primitives. Tested by `paycalc-inputs.test.mjs`.
- `numVal(id)` — parse a field's value with `parseSmartFloat` (strips iOS smart-hyphens/quotes); missing element / empty → 0
- `numValOr(id, fallback)` — like `numVal` but returns `fallback` for an unparseable/empty value (NOT 0) — the signed Year-to-Date / pension fields need an explicit floor so a stray "." doesn't cascade £0/£NaN
- `intVal(id)` — non-negative integer read (`Math.max(0, parseInt || 0)`) for the hour/minute fields
- `hmPair(hId, mId)` → `{h, m}` (72-hour review) — an hrs/mins pair as whole hours + minutes, reading a DECIMAL still in the hours box ("7.5", not yet blurred) exactly as the blur split will write it (the minutes box replaced by the fraction). Read by `hhmmDec` and `readFormData`, so the live £, the autosave and the post-blur fields agree — parseInt's 7 used to be priced and stored until blur
- `hhmmDec(hId, mId)` — combine an hrs + mins field pair into decimal hours (via `hmPair`)
- `clampMins(mId)` — clamp an out-of-range minutes field into [0, 59], rewriting ONLY when out of range (preserves a typed "05")
- `_decHintEl(hId, make)` — find (or lazily create when `make`) the `.hhmm-dec-hint` element under an hours field's `.hhmm-wrap`; null when the markup is absent
- `decPreview(hId)` — write the live "= Nh Mm" hint while a decimal is being typed, hide it for a whole number
- `wireIosTap(el, action)` — guarded touch/click wiring for a control that is tapped while the soft keyboard is up (v21.66). iOS cancels the synthesised click when the tap dismisses the keyboard, so a bare click listener "doesn't always work" — measured first on the ± sign button, re-reported on the roster fill controls. Fires from `touchend` (the path iOS cannot cancel), suppresses/swallows the synthesised click so the action never runs twice, and gates on movement so a scroll flick ending on a full-width destructive button ("Replace with calendar values") is never a tap. Three call sites in paycalc-app.js: the fill button, the `#rosterRows` delegation, the ± sign button

### `paycalc-backpay-state.js`

Which **FIGURE** ends up in which back-pay box, and which of them the member may change (v19.93). Pure; tested by `paycalc-backpay-state.test.mjs`.

- `BP_FIELDS` (the saved-state schema — DOM id ↔ blob key), `readBpFields` / `bpFieldWrites` (the round trip), `resolveAuthoritativeRates`, `allRatesOnRecord`, `resolvePaidInPeriod`.
- **Why it exists.** `paycalc-backpay.js` was the ONLY module in the paycalc family with no test file of its own — four of its ten exports untested, including `calcBackPay`, which produces the lump sum. The per-period accrual was covered; the ASSEMBLY around it was not, and all five of its recorded defects live there. **Every one is the same shape: a money figure comes out wrong and nothing says so.** (It has a test file of its own since v23.63 — `paycalc-backpay.test.mjs` drives `calcBackPay` end to end; these three decisions stay extracted, because they are rules rather than wiring.)
- **Three rules that must survive an edit.** `bpFieldWrites` returns an entry for EVERY field — a blob silent about a field must BLANK it, not leave the last year's number (that is the clear-then-apply pair collapsed into one pass, so there is nothing left to keep in step). The lock decision never reads a box's contents, and a locked box is WRITTEN with its figure. And `resolvePaidInPeriod` must not return 0 while any candidate exists — the ORDER of its ladder is a judgement, never-zero is the safety property.

### `paycalc-pension.js`

**WHEN** a member was in the pension scheme, not merely **whether** (v21.78). Pure — no DOM, no storage, no imports; tested by `paycalc-pension.test.mjs`.

- `parsePensionTimeline(raw)`, `serialisePensionTimeline(timeline)`, `isOptedOutAt(timeline, pNum)`, `withPensionChange(timeline, pNum, out)`, `withOptOutStartAt(timeline, pNum)`, `withRejoinAt(timeline, pNum)`, `optOutStartsAt(timeline)`, `migrateLegacyOptOut(legacyOptedOut, firstPNumOfCurrentTaxYear)`.
- **The card makes two EDITS, not one boolean written twice (v21.80).** `withPensionChange` records a change AT a payslip, which is the wrong primitive for either control, and wiring it to both produced two silent failures in opposite directions — each of which corrected itself out of sight on the next reload, which is why a manual pass saw neither. Re-picking a LATER payslip did nothing at all (the earlier change still stood in front of it, so the select read one payslip and every figure used another); and un-ticking ERASED the spell rather than ending it, because the handler dated it to the spell's own start — so the rejoin this module exists for was unreachable from the page whose hint instructs the member to record one. `withOptOutStartAt` MOVES the current spell's start (a spell that has already ended is left alone — that is a NEW spell), `withRejoinAt` ENDS it at the payslip on screen, and naming the start payslip or an earlier one erases instead, which is the commoner action: undoing a tick while still looking at the payslip you ticked on. Both are idempotent — every keystroke in the pension field re-states the pair through `saveSettings`.
- **Why it exists.** v21.64 added "I'm not in the pension scheme" as a single boolean. The setting was right and the SHAPE was the money bug, found by external review and then reproduced: a 2025/26 payslip with real hours went from a £160.78 deduction to £0.00, and its take-home rose **£115.92**, because the member ticked a box in August 2026. Two individually-good designs collide — `readFormData` stores `null` when the pension equals the period default (so the period keeps healing as the app learns the real historic rates), and the opt-out made that default £0 for every payslip there has ever been. The Settings hint promised "payslips from when you WERE contributing keep their own amount"; that held only for the rare payslip carrying an explicitly-typed non-default figure.
- **Why a timeline and not a second date field.** UK auto-enrolment re-enrols opted-out staff roughly every three years, so "out from P56, back in from P95" is the expected shape within the life of this data, not a later refinement. A single "opted out from" field models the first event and then produces the same class of bug in reverse — un-ticking would hand the scheme default back to the months she genuinely was not contributing.
- **Three rules that must survive an edit.** An empty timeline means CONTRIBUTING (a parse failure, a cleared key and a member who never touched the setting all land on the answer that changes no stored figure). A payslip before the first change is never affected by it — the lookup takes the last change at or BEFORE the payslip and never falls back to the newest state. And `parsePensionTimeline` is a trust boundary that refuses WHOLE: a half-read timeline is a perfectly valid timeline that says something else, and it moves the boundary between contributing and not with nothing on screen changing.
- The consumer side is one function: `getPensionDefault(pObj)` in `paycalc-settings.js` (via the period-aware `isPensionOptedOut(pObj)`), which the field default, `calculate()`'s fallback, the HPP non-premium estimate and the year summary all already route through.

### `paycalc-inventory.js`
What a stored pay key **is**, and what a set of them adds up to (v22.14, external review). The one authority: `summarise` in `paycalc-transfer.js`, the card's itemised list and the damage preflight all ask it, so they cannot disagree about what a key means.
- **Why it exists.** `summarise` derived "N payslips across M tax years" from a hand-written regex naming five of the nine per-tax-year key types. It could not see `hpp_actual`, `hpp_inc`, `ytd_src` or `setup_<year>`, so a tax year known only by one of those was invisible — on the card whose entire job is to say what you are about to carry to a new phone. Nothing failed; the number was just smaller than the truth. That is this repo's recurring defect, *prose restating a fact that lives somewhere else*, so the answer is one classifier plus a parity test that drives the REAL key builders rather than a longer regex.
- `KEY_KINDS` — the ordered table: `test` on the key TAIL, member-facing `label`, and `structured` (the value is a JSON blob). Order matters: per-year forms sit above their member-level namesakes, because several kinds carry both (a pre-per-year key is still readable on any device that has not run its migration, and a backup taken there carries it). There is deliberately **no `perYear` flag** — `taxYearOf` answers that from the tail, and a second declaration of the same fact is the bug.
- `classifyPayKey(tail)` → `{kind, label, taxYear, period, structured}`. **An unrecognised key is `unknown`, never dropped and never guessed** — a backup from a later app version contains kinds this one has not heard of, and classification is for DESCRIBING, never for filtering.
- `describePayKey(tail)` — "payslip 16", "back pay 2026/27". A member is never shown a storage key.
- `inventoryOf(keys, prefix)` → `{periods, taxYears, groups, unknown, keys}`. `taxYears` is a sorted LIST, not a count: naming 2025/26 and 2026/27 answers "is my old year in here?", which "2" does not, and that is the question somebody opens this card to ask.
- `inventoryLines(inv)` — the inventory as lines a member reads, pure so the wording is testable without a DOM.
- `damagedEntries(entries, prefix)` — which STRUCTURED entries will not parse. **Only a kind declared `structured` is ever parsed**: `code` holds `1257L` and `rate` holds `21.49`, and parsing those would report every healthy device as corrupt. It **reports rather than refuses**, which is where it departs from the review that asked for it — a backup is routinely the member's only remaining copy, so refusing the whole file over one unparseable payslip hands them nothing, while the damage restores visibly and recoverably (`parseSavedPeriod` surfaces a corrupt period rather than dropping it, the standing no-silent-caps posture). A structurally wrong FILE is a different thing and is still refused outright by `validateBackup`.
- Tested by `paycalc-inventory.test.mjs` (part of `test:hygiene`), whose first contract scans the source tree for every `${pcPrefix()}…` builder and asserts each produces a recognised kind. It reads SOURCE rather than importing because two of the three key-building modules reach the gstatic SDK and cannot load in Node — and scanning is the stronger check anyway: it sees a builder in a module that does not exist yet.

### `paycalc-transfer.js`
The pay-data **backup format and import rules** (v19.16). Every function is pure — no localStorage, no files, no clipboard — because the import path decides whether to overwrite a member's entire pay history, so its rules have to be testable without a browser. The DOM half lives in `paycalc-transfer-card.js`.
- **Why it exists:** pay-calculator data lives in `localStorage`, which is per-**origin**. It therefore does not follow a member from `garethdavidmiller.github.io` to `myb-roster.web.app`, and does not survive a new phone or cleared browser data. Everything else the app holds is in Firestore and moves with the account; this is the one thing that deliberately does not (pay data is kept off the server — AUTH_ARCHITECTURE.md, the PAYSLIP_ACTUALS decision). A Firestore transfer doc was rejected for that reason, and an iframe/`postMessage` bridge because Chrome partitions storage by top-level site.
- `BACKUP_FORMAT` / `BACKUP_VERSION` — the blob's identity and schema version. A blob from a NEWER version is refused outright rather than half-understood.
- `selectBackupKeys(allKeys, prefix)` — a **prefix scan**, not an enumerated list: a hand-maintained list would silently drop any key type added later (the same failure mode as the SW precache list). `DEVICE_KEYS` are excluded — they describe the browser, not the member. Sorted, so an unchanged backup is byte-identical between runs.
- `summarise(keys, prefix)` → `{periods, taxYears, keys}` — stated in payslips and tax years, the units a member recognises. Since v22.14 it delegates to `inventoryOf` (see `paycalc-inventory.js` for the undercount it replaced). Its flat return shape is deliberate — it is written into every blob as `counts`, which app versions that do not exist yet will read.
- `buildBackup({entries, member, slug, appVersion, exportedAt, prefix})` — values are carried as **raw strings, never re-parsed**, so a backup survives a paycalc schema change it predates. Records the SOURCE `slug` so re-keying is unambiguous, and (v22.14) `dataGeneration` — the shape of the VALUES, which is a different question from `version`, the shape of the FILE, and has always moved independently of it. See `PAY_DATA_GENERATION` in `paycalc-migrations.js`.
- `validateBackup(text, {currentSlug})` → `{ok:false,error}` | `{ok:true,blob,unnamespaced,srcSlug,counts,inventory,damaged}` — `srcSlug` is the slug every rule CHECKED, and the card re-keys from it rather than re-reading `blob.slug`. **An "ownerless" blob whose keys name a member (`keyOwnerSlug`) is refused, and a present non-string slug is refused as damaged (72-hour review)** — stripping `slug` from another member's backup used to pass it as legacy and the REPLACE then wiped the importer's history. Returns a result rather than throwing, so each refusal renders in the member's own terms. **Fails closed on identity FIRST (v19.17):** an empty `currentSlug` refuses everything, before any other rule. Every rule here is about whose data this is, and the caller's namespace in that state is the bare `myb_pc_`, which spans EVERY member on a shared device — reachable when the session name is no longer on the roster (a leaver, a rename), since `getLoggedMember()` then returns null and the namespace never activates. Verified in a browser both ways. **The trust boundary:** a backup is a file the member obtained from somewhere, so restoring it must never be a way to write arbitrary localStorage — only the paycalc key shape, never a `DEVICE_KEYS` flag, only string values, and every key must sit under the slug the blob claims. **Identity rule = option A:** a backup belonging to a DIFFERENT member is refused ("Sign in as them to restore it") — staff share devices, which is precisely why the per-member namespacing exists. Legacy pre-namespacing data has no owner recorded; it is accepted but flagged `unnamespaced` so the caller must confirm. **Two content questions were added at v22.14** (the shape questions above all concern the file): a blob whose `dataGeneration` is NEWER than this app's is refused — the values would restore faithfully and then be silently misread — while an absent field means "no later than us", which is true of every backup predating it; and the **semantic preflight** returns `damaged`, naming the structured entries that will not parse, without refusing (see `damagedEntries`).
- `rekeyEntries(entries, fromSlug, toSlug)` — `myb_pc_ytd_pay_2026_27` cannot be split into slug + tail by inspection (is the slug `ytd`?), which is why the source slug is recorded rather than guessed.
- `backupFilename(member, isoDate)` — recognisable in a Downloads folder months later.
- Tested by `paycalc-transfer.test.mjs` (part of `test:hygiene`).
- **What keeps it correct as the pay calculator changes (v19.28).** This module carries whatever localStorage holds, so a new pay FEATURE needs no edit here — what breaks it is a change to key SHAPE, and both ways that happens are silent (an un-namespaced key is invisible to `selectBackupKeys`; a key tail outside `[A-Za-z0-9_]+` fails `KEY_RE` and is dropped while the member is told "Restored"). `paycalc-key-parity.test.mjs` guards the shape statically — the transfer tests here cannot, because they exercise the rules against keys they invent, never the app's real ones.

- `applyRestore({get,set,del,existing,entries})` → `{ok, reason?, restored}` (v19.84, external review P1) — the all-or-nothing REPLACE over a storage with no transactions. The previous inline ladder snapshotted only the keys that ALREADY EXISTED, so a rollback could not undo a key the backup had **created**: it left that key in place, checked the original keys, found them intact, and told the member **"nothing was changed"** over a pay history that had silently gained a period — the exact half-merged state the card's own comments call the worst outcome. The unit of work is now the **UNION** of what is there and what is arriving, and rolling back a creation means DELETING it. Second half: a surplus key that will not delete is a **failed replace**, not a success — `lsDel` swallows storage errors just as `lsSet` does, so the removals are read back too. The io is INJECTED rather than importing ls.js, because the only interesting cases need a storage that fails on demand, which a browser will not do to order.

### `paycalc-transfer-card.js`
The DOM half of the "Move Your Pay Data" card on `paycalc.html` (v19.16; renamed v19.18 — the original "Back up your pay data" collided with the "Pay Rise Back Pay" card two rows above it, and v19.19 shortened it further. The card serves two purposes and the title names only one, so the HINT carries the other and must keep leading with "Keep a copy") — file/clipboard plumbing and the confirmations before a restore. Owns no rule: every decision comes from `paycalc-transfer.js`.
- `initTransferCard()` — safe no-op when the page has no card. Renders the summary as an ITEMISED list (v22.14 — "On this device:" over `#ptInventory`; the old single line folded the pension history, back-pay figures, Year-to-Date totals and payslip comparison into "plus your settings", so a member could not tell whether the thing they cared about was in there), wires Download / Copy as text / Restore from a file / Restore from pasted text, and honours a `#payTransferCard` deep link from Settings through `overlay.js`'s `openCardNamedByHash` (v24.86 — the routine was written here at v21.50 and moved when the Year to Date card needed the same thing): it **expands** the card, because a bare fragment jump would land on a collapsed header, and holds it at the top of the screen while the calculator keeps laying out — which otherwise drifted the card from the top of the phone viewport down to y=681 of 844. The reasoning, including why the cancel is a gesture and not a scrollY delta, is in that helper's header.
- Every control is disabled when the member cannot be identified, the **paste pair included** — omitting it is what left the destructive path live (v19.17). `#payTransferCard` is also in `paycalc.css`'s print hide-list, like every other occasional card.
- **Restore is a REPLACE, never a merge** — a half-merged pay history is worse than either version. The ladder is: `validateBackup` → confirm if `unnamespaced` → confirm the replace (`danger`) → snapshot → **write** → **verify by reading back** → remove only the surplus → reload.
- **The replace dialog names BOTH sides** (v22.14). Until then it stated one count about the incoming file and nothing at all about the pay history being destroyed — which is the half the member is deciding about — and a payslip count described neither side, since a namespace also holds pension history, back-pay figures and Year-to-Date totals no payslip count mentions. Any damaged entries are named in the same dialog, before consent, and a backup with damage but nothing to replace gets a dialog of its own rather than being written silently.
- **Write FIRST, delete the surplus AFTER, and verify in between (v19.17).** The obvious order (wipe, then write) makes the common failure catastrophic: `lsSet` SWALLOWS a storage error (`ls.js`, for iOS private mode), so on a device that has stopped accepting writes the wipe succeeded, the write silently did nothing, and the member was told “Restored” as their pay history disappeared — measured in a browser. Because `lsSet` cannot report failure, a `try/catch` around it is dead code; reading the values back is the only way to know. A failed write now rolls back from the snapshot and changes nothing. Existing keys are **removed, not blanked**: a key set to `''` leaves a value the app would later try to parse (an empty period reads as corrupt, not absent), and a key the backup does not contain must genuinely disappear or the "replace" is a merge wearing a replace's label.
- localStorage cannot be written atomically, so a mid-write failure reports honestly ("stopped accepting data after N of M items") rather than claiming success.
- Imports: `ls.js`, `paycalc-migrations.js`, `paycalc-settings.js` (`getLoggedMember`), `roster-data.js`, `overlay.js` (`confirmDialog`), `paycalc-transfer.js`, `paycalc-inventory.js`.

### `paycalc-help.js`
Pure data module — help/tooltip text for the pay calculator (v11.40).
- `HELP_CONTENT` object with keys: `hours`, `settings`, `accuracy`, `hpp`, `backpay`
- Imports `TAX_YEARS` and `GRADES` from `paycalc-calc.js` for the figures in tip text
- No DOM, no Firebase — safe to import anywhere

### `paycalc-migrations.js`
- `hppIncKey(ty)` — the per-tax-year opt-in flag ('1' = the member ticked "add my HPP to the January take-home").
- `ytdSrcKey(ty)` — per-tax-year SOURCE payslip of the Year to Date figures (internal period num); anchors the cumulative tax method to source+1 (v17.98)
localStorage key constants and data migration logic for the pay calculator (v11.40).
- `SK` — object of top-level localStorage key strings, rebuilt in place when the namespace changes
- `pcPrefix()` — the active per-member key prefix (`myb_pc_` or `myb_pc_<slug>_`); every key builder and `SK` derives from it (v14.11)
- `PAY_DATA_GENERATION` (v22.14) — the GENERATION of the stored data, i.e. what shape the VALUES are in, as against `BACKUP_VERSION`'s question about the shape of the FILE. Every migration in this module changed values without touching the file format, so the two are genuinely different axes. A backup carries it because the only other available signal is the device's own one-shot migration flags — which describe the browser, are excluded from every backup, and would therefore say "already migrated" about data that has never been near this device. **Nothing consumes it yet, deliberately**: every live migration over backed-up keys is DATA-gated (`if (sl === 'postgrad')`, `if (timeline === null && flag)`) and so already re-runs correctly over restored values, while the device-flag-gated ones touch only legacy device-local keys no backup carries. It is recorded now so the first migration that is NOT data-gated has an honest anchor rather than inferring one from the app version string. Bump it when a migration changes what a stored value MEANS — not when a key is merely added.
- `setPaycalcNamespace(memberName)` — activate the per-member namespace (called from `runMigrations`); falsy name → unnamespaced legacy keys (v14.11). `paycalc-app.js` refuses (the unsupported-role card) BEFORE `runMigrations` when the session name is not on the roster, so the coordinator never reaches the falsy-name branch (72-hour review)
- `keyOwnerSlug(key)` → slug | null — the member a `myb_pc_<slug>_…` key belongs to, or null for genuinely unnamespaced legacy data. Exported (72-hour review) so `validateBackup` can refuse an "ownerless" backup whose keys name a member — the same test the ownership prompt has used since v14.27
- `periodKey(pNum)` — key builder for period data (takes period number)
- `parseSavedPeriod(raw)` (v16.66) — PURE saved-period JSON decoder → `{ data, error }`: null/empty → `{null,false}`, valid → `{obj,false}`, malformed → `{null,true}`. `readSavedPeriod(pNum)` composes `lsGet(periodKey(pNum))` + `parseSavedPeriod`. Single decoder shared by `paycalc-backpay.js` and `paycalc-hpp.js` so a corrupt saved period is SURFACED (a visible "couldn't read N periods — may be too low" note), never dropped silently (no-silent-caps). Tested by `paycalc-migrations.test.mjs`.
- `hppEstKey(ty)`, `hppActualKey(ty)`, `hppModeKey(ty)`, `ytdPayKey(ty)`, `ytdTaxKey(ty)` — key builders that take a tax-year object `ty` (with `.label` property, e.g. `'2025/26'`); `hppModeKey` holds the HPP amount-source state; `bpKey(ty)` — the back-pay card's per-tax-year autosave blob key
- `NOTICE_YTD_KEY` — device-level "Year to Date notice shown" flag (deliberately unnamespaced)
- `memberSlug(name)` — `'G. Miller'` → `'gmiller'`; the namespace segment builder (exported since v19.16 for `paycalc-transfer.js`, which needs the slug WITHOUT activating a namespace)
- `DEVICE_KEYS` — the unnamespaced device-level flags (migration guards, "seen this notice"). Exported since v19.16 so the backup path can exclude them: carrying `myb_pc_ns_migrated` onto a fresh device would suppress the legacy-ownership prompt on a device that genuinely needs it. Built from `_ACTIVE_DEVICE_KEYS` + `_RETIRED_DEVICE_KEYS`.
- `RETIRED_DEVICE_KEYS` (v19.37) — device flags the app no longer WRITES but which still sit on real devices. Deleting one outright was a live bug: retiring the welcome lightbox removed `myb_pc_pay_welcome_shown` at v19.36, so `_hasUnnamespacedPaycalcData` began reading that stale flag as unnamespaced member data and the "Is this your pay data?" prompt fired at members with no legacy data — worst for anyone who first used paycalc AFTER v14.11 namespacing, whose `myb_pc_ns_migrated` guard was never set because the prompt had never run. **Retiring a feature that owned a device flag means MOVING its key here, never deleting it.**
- `isActualsDev(member)` / `readPayslipActuals()` / `writePayslipActuals(map)` / `clearPayslipActuals()` — the developer-only device-local payslip-actuals overlay (gated to the developer account; data imported per-device, never served — see CLAUDE.md → Example payslips)
- `runMigrations({ getPeriods, getLoggedMember, getPensionDefault })` — runs all one-time data migrations, then migrates this member's shared data into their namespace and activates it; receives deps as params to avoid circular imports with `paycalc-app.js`
- `_migrateCeaKeys` — internal migration (old CEA keys → grade-neutral format)
- `hasPendingLegacyMigration(name)` / `resolveLegacyMigration(name, 'mine'|'fresh')` — shared-device ownership prompt (v14.25): `runMigrations` only activates the namespace; legacy/shared `myb_pc_*` data is claimed (`'mine'` moves it into the member segment) or discarded (`'fresh'`) only when the member resolves the `paycalc-lightboxes.js` prompt (✕ = decide later). Device-level keys (migration guards, "seen" flags) stay unnamespaced; the `myb_pc_ns_migrated` guard makes the prompt one-shot. Covered by `paycalc-migrations.test.mjs`

### `paycalc-calc.js`
Pure functions only — no DOM, no Firebase, no localStorage.
- All pay rate + statutory-threshold tables: `GRADES`, `TAX_YEARS`, and the per-tax-year maps `TAX_BY_YEAR`
  (PA/bands), `NI_BY_YEAR` (PT/UEL, weekly×4), `SL_BY_YEAR` (Student-Loan plan thresholds — **Plan 5 is
  absent from 2025/26**, not repayable until 6 Apr 2026), and `SCOTTISH_TAX_BY_YEAR` (6 bands).
- `computeSL(sacGross, plan, slByYear, skip)` — Student/Postgraduate Loan (v17.16 HMRC method: excess keeps
  its pence, only the FINAL deduction floors to £; penny-floored periodic threshold; verified against
  `PAYSLIP_ACTUALS.sl`). An undergraduate plan + a Postgraduate Loan repay together — the coordinator sums
  `computeSL(plan) + computeSL('postgrad')`.
- `computeTax(...)` handles the Scottish flat-rate codes `SD0`/`SD1`/`SD2`/`SD3` (intermediate/higher/advanced/top,
  v17.16) and applies the HMRC 50% overriding limit (PAYE reg 23) on both cumulative and non-cumulative paths.
  On the cumulative path it also returns `refund` — tax the recalculation says was over-collected —
  WITHOUT netting it into `tax` (72-hour review): the deduction stays £0 and the summary says a refund
  may be due, because a refund folded into take-home would let one mistyped Year to Date figure invent money.
- `AWARD_RATES` + `awardRatesFor(grade, tyLabel)` — authoritative per-grade, per-tax-year pay-award
  rates (`{ rate, pre }`: settled rate + the prior-year "old" rate; the mid-year applied-from date is
  NOT stored here — it is single-sourced from that year's `londonAllowFrom` via `awardFromForYear`).
  Payslip-confirmed (CEA 2024/25 = £20.06, applied 24 Oct 2025). Used by
  `paycalc-backpay.js` (any year's old→new award, independent of the mutable `GRADES` default) and by
  `getRateForPeriod()`. Add one entry per grade each April.
- `getRateForPeriod(p, grade, tyLabel, settledRate)` — the rate for a period, honouring a MID-YEAR
  award step: returns `pre` for periods paid before `from`, else the settled rate (mirrors
  `getLondonAllowanceForPeriod`). Loaded into the rate field by `updateRateForPeriod(ty, p)`, so the
  main calculator matches the real payslip for historic pre-award periods.
- `awardFromForYear(tyLabel)` — the date a year's award was applied (single-sourced from that
  year's `londonAllowFrom`; the date is NOT stored on `AWARD_RATES`). `isPreAwardPeriod(p, grade,
  tyLabel)` — the one shared predicate for "period paid before its award", used by `getRateForPeriod`,
  `updateRateForPeriod` and `confirmSettings` (paycalc-settings.js) and the period hint in
  `paycalc-app.js`; the back-pay accrual caps arrears with `awardFromForYear` directly.
- `computeGross()`, `computeTax()`, `computeNI()`, `computeSL()` — `computeTax` also returns `code` (the code as read: upper case, no spaces, 1257L for a blank or all-spaces box; v24.87) and `recognised` (v24.89): an unrecognised code ("OT" with a letter O, "1182") is priced on the default allowance, so the payslip check names it as unrecognised rather than quoting it as applied
- `P_YR` (13 four-weekly periods a year) · `getLondonAllowanceForPeriod(p, ty)` — the London Allowance for a period, honouring the year's mid-year `londonAllowFrom` cut-over
- `PENSION_STEPS` — the per-era employee pension defaults, newest-first, each era's payslip provenance in a comment beside it. **Cited in six other documents and absent from this map until v21.63**, which is exactly the gap this file exists to close. `getPensionForPeriod(grade, payday)` resolves a payday to its era — the figure `VAL-PAY-003` is about.
- `calcBandedTax(taxable, bands, scale = 1)` — the shared band walker; `scale` multiplies every band top, which is how cumulative PAYE prices period N. `getThresholds(yearLabel)` → that year's `{tax, scottishTax, ni, sl, londonAllow}` table.
- `calcProRateFactor(startDate, periodStart, periodCutoff)` → 0–1 — the joiner fraction of a period (1 = full, 0 = not yet started); cited by `.claude/rules/roster-data.md` for new starters.
- `proRateDays(startDate, periodStart, periodCutoff)` → `{daysEmployed, totalDays}` (72-hour review) — the two counts behind that fraction, taken between WALL-CLOCK readings so a period containing the spring clock change no longer loses a joiner a day. Shared with the joiner notice (`paycalc-roster-hint.js`), which prints them.
- `HPP_FRACTION` = 4/52 — the Holiday Pay Premium multiplier, confirmed by Chiltern payroll.
- `RATE_125` / `RATE_150` / `RATE_300` — the overtime multipliers, declared once so a rate is never a literal at a call site.
- `getTaxYearForOffset(offset)` / `taxYearForPeriod(p)` — the TAX_YEARS entry for a P48-relative offset, or (the nullable variant, v17.22) for a period object with the `TAX_YEARS[0]` fallback. `taxYearForPeriod` single-sources the `p ? getTaxYearForOffset(p.num - 48) : TAX_YEARS[0]` idiom (the `- 48` anchor + null fallback) that recurred across the coordinator, HPP, back-pay, and settings modules.
- `capHours({effContr,satHrs,bhHrs})` — the Saturday/BH-vs-contracted cap cascade, single-sourced (was inline in computeGross/_varPayForPeriod/_accrueBackPayPeriod).
- Edit here for: rate changes, tax year rollover, NI threshold changes, a new annual pay award
- Covered by `paycalc.test.mjs` — run tests after any change here

### `paycalc-roster-suggestions.js`
The roster-to-pay suggestion engine: the per-period override cache, the member-narrowed Firestore fetch, and the categorised Saturday / Sunday / bank holiday / BH overtime / RDW / overtime / Boxing Day totals the hint bar pre-fills. No DOM. The payroll rules it applies are `.claude/rules/paycalc.md` (invariants 9 and 11).
- `fetchOverridesForPeriod(p, memberName)` → `'loaded'` · `'base-only'` (the fetch failed) · `'cached'` (offline, answered by the device's persistent cache — treated as base-only, never as "no recorded changes") · `'cancelled'` (a newer period change superseded it, so it wrote nothing). One member's overrides for one period, on the `(memberName, date)` composite index.
- `resetOverrides(newState)` — clears the cache and bumps the fetch token before a new fetch, so a late fetch cannot write; called on every period change and by the year fill. `getOverridesFetchState()` → `checking` · `base-only` · `loaded`, for the badge.
- `getRosterSuggestion(p, member)` — the base roster merged with the cached overrides → the categorised totals and the day list, or null. The caller passes the member; no storage access.
- `BARE_TRAINING_DAY_MINS` — a pattern's bare Training day on a bank holiday is priced as the contracted day and flagged in `defaulted7h`, so the hint says it is an estimate.
- `bhsForYear(year)` — the year's bank holidays without 26 Dec (Boxing Day is priced separately at 3×); also used by `paycalc-periods.js`.
- Test seams: `_setOverridesForTest(map)`, `_addBhDateForTest(year, iso)`, `_removeBhDateForTest(year, iso)`. Tested by `paycalc-roster-suggestions.test.mjs`.

### `firebase-client.js`
The single Firebase initialisation point: every page imports `db`, `auth` and the SDK calls from here, never from the CDN. The SDK version appears here once, and a bump also moves `FIREBASE_SDK_VERSION` in `service-worker.js` (CLAUDE.md → Change impact). It cannot load in Node, because it imports the SDK from gstatic, so its rules live in the pure modules it imports and the factories it binds.
- **Firestore:** `db` (the persistent IndexedDB cache; the memory cache only if that throws — CLAUDE.md says do not revert to `getFirestore()`) · `COLLECTIONS`, the collection names, used instead of literals · re-exported `collection`, `query`, `where`, `orderBy`, `limit`, `getDocs`, `getDocsFromCache` (the local cache only, so no rule runs; rejects on a miss), `getDoc`, `onSnapshot`, `addDoc`, `setDoc`, `deleteDoc`, `doc`, `serverTimestamp`, `writeBatch`, `runTransaction`, `deleteField` · `isSafeStorageUrl` and `resolveDocumentOpenUrl` from `storage-utils.js`.
- **Auth:** `auth` (`initializeAuth`, not `getAuth` — the JSDoc says why), `signInWithEmailAndPassword`, `signInWithCustomToken` (the staff-PIN exchange), `signOut`, `onAuthStateChanged`, `updatePassword`, `reauthenticateWithCredential`, `EmailAuthProvider`, and `normaliseSurname` / `nameToEmail` from `auth-identity.js`.
- **The one boot restore:** `authBootstrap` → `{ user, persistence }` · `authReady`, its persistence mode, awaited before a sign-in · `currentUserAfterBoot(timeoutMs)`, a bounded wait that returns the LIVE `auth.currentUser`, never the boot snapshot · `restoreMemberPersistence()` (IndexedDB → localStorage → sessionStorage; rejects if none takes) · `setViewerPersistence()` (session-only, and it **rejects rather than falling back**, because every fallback lives longer). **The boot reads the restored user before it applies persistence, and the PIN viewer keeps session-only persistence**: `setPersistence` migrates the current user, so the member chain would carry the viewer into IndexedDB and past a browser close. `AUTH_AND_SESSIONS.md` invariant 8; pinned by `calendar-viewer-parity.test.mjs` Contract C.
- **Writes:** `withClaimRetry(fn)` runs a read or write thunk and, on a stale-claim `permission-denied` with a live user, refreshes the token and retries once (`runWithClaimRetry`, `claim-retry.js`); every request is wrapped in `abandonOnSignOut`, and a write thunk must build a fresh batch each call. `writeWithClaimRetry(fn)` is the same through `runGatedWrite`: once a write ends unconfirmed, no new write starts until reload. Every write uses it; reads use `withClaimRetry`.
- **Documents:** `uploadHuddle`, `uploadCircular`, `uploadNewsletter`, `getLatestCircular`, `getLatestNewsletter`, `subscribeToLatestHuddle`, bound from `buildDocumentClient` (`documents-client.js` owns the sequence). `fetchSignedDocumentUrl(kind)` → a short-lived url from `getDocumentUrl`, or `null` (signed out, refused, timed out). It never throws, because every caller falls back to the stored url; the rule is `document-url.js`.
- **Push:** `currentAuthUid()` · `savePushSubscription(sub)` (stamps `owner`; throws on a subscription with no keys, so the caller rolls back) · `deletePushSubscription(endpoint)` (throws `push/no-owner-session` when no owner is signed in; `releaseDevicePush` then drops the browser subscription).
- **Work email (`staffContact`):** `getStaffContact`, `saveStaffContact`, `deleteStaffContact`, `getAllStaffContacts` (admin).
- **Passwords (`passwordStatus`):** `getPasswordStatus`, `savePasswordSetAt`, `getAllPasswordStatus` (admin) · `probeResetAtMs(email, password, memberName, timeoutMs)` — the last admin reset, asked over REST BEFORE the SDK signs in, so nothing is stored until the check passes: ms (0 = never), `null` (unconfirmed), `'credential'` or `'throttled'` · `reauthenticateWithPassword(memberName, typed)` (the gated candidate ladder) · `setOwnPassword(memberName, newPassword)` → `{ statusRecorded }`, never rejecting on a stamp-only failure because the password has already changed · `resetMemberPassword(memberName, {revoke})` (a timeout says the reset may still have gone through).
- **Admin Functions:** `getSignInStats()` (four integers, no identity) and `getAccountSetupGaps()` (names, grouped by remedy; **`refused` is not "no gaps"** and must never render as one).
- **Reset queue:** `requestPasswordReset(memberName)` (public, sends no token; a timeout means "may have been sent") · `getResetRequests()` · `clearResetRequest(memberName)` (a gated write).
- **Error log and counters**, bound from `buildAnalyticsClient` (see `analytics-client.js`): `logClientError`, `getClientErrors`, `resolveClientError`, `recordPageView`, `recordActiveAccount`, `recordOriginUse`, `recordPerfSample`, `getPerfStats`, `getUsageStats`.

### `fetch-timeout.js`
The bound on every client call to a Cloud Function. The header holds both rules below and the per-endpoint budget table.
- `fetchWithTimeout(url, options, timeoutMs)` — `fetch` with a deadline that also covers the body read (`json`, `text` and the rest reject with our code when cut off), honouring a caller's own `signal`.
- `FETCH_TIMEOUT_CODE` / `isFetchTimeout(err)` — our bound fired. `FETCH_ABORTED_CODE` / `isFetchAborted(err)` — the caller cancelled, never our bound; when both fire, the timeout wins. `DEFAULT_FETCH_TIMEOUT_MS` — the budget for a caller that names none.
- `serverRefusal(err)` → `{ status, reason }` for a `Server responded 4xx: …` error (the body's JSON `error` sentence as the reason), else null. A refusal is an answer, so Operations' Reset shows it and offers no Retry.
- **A budget sits above the endpoint's own `timeoutSeconds`, never below.** **A timeout on a state-changing call does not mean it did not happen**: write callers say "may still have gone through", never "failed"; reads may say "failed".

### `error-reporter.js`
`initErrorReporter()`, the one export: `error` and `unhandledrejection` listeners that write filtered records, one per distinct message per page session, to `clientErrors` through `logClientError`. It never throws and never awaits. It also turns `slow-save.js`'s events into slow-save DIAGNOSTIC entries (only for a save that was slow while the device said it was online, at most three per page), with the sign-in token's timing that tells auth from the connection.
- **Never call it bare.** Without an auth context the rules refuse every write and the log looks healthy because it is broken. The call shapes are in the module header; the rule is `AUTH_AND_SESSIONS.md` invariant 13.
- The noise filters and the log's ordering are `client-errors.js`. Records surface on Operations → Error Log.

### `usage-reporter.js`
The anonymous usage recorder: it decides WHEN to count and leaves the I/O to `firebase-client.js`. Called once per page beside `initErrorReporter()`; fire-and-forget. The header argues each rule below.
- `recordUsage(page, signedIn?, selected?)` — a page view and, when a member can be named, that account's monthly and rolling-30-day counts plus the per-address counts (`_recordOrigin`: a visit, and separately an installed-app open). The dedup is on the device, in localStorage flags keyed by name, so the server only ever receives `+1`.
- `recordOpen(itemId, signedIn?)` — an undeduped "opened" count for a document or guide, in the page-view map. Ids are allowlisted in `firestore.rules`; a guide's id is its `NAV_GUIDES` `openId`, never matched from the href (`firestore-contract-parity.test.mjs`).
- **Only a SIGNED-IN admin is excluded.** `selected` (the Calendar's selection) is a dedup key and nothing else: an admin selection records the page view and no account. `signedIn` is always the signed-in name, never the selection.
- **A load the app reloaded itself for a release records nothing** (`loadFollowedRelease`, shared with `perf-reporter.js` because the marker can be read once).
- The rolling counts MOVE to the latest active day (`rollingMove`, `usage-stats.js`) rather than freezing.

### `usage-stats.js`
Pure date bucketing and aggregation for the usage counters — no DOM, no Firebase. Imported by `analytics-client.js` and `usage-reporter.js`; tested by `usage-stats.test.mjs`.
- `monthKey(d)` / `dayKey(d)` / `prevMonthKey(d)` — local-time `YYYY-MM` / `YYYY-MM-DD` keys; the previous month is safe across a year boundary.
- `shouldCountMonth(lastMonth, now)` — the per-month dedup. `rollingMove(lastMs, now, [windowDays])` → `{ add, remove }` or null: an account-device's one rolling count moves to today and leaves its old day while that is still in the window; null when today already holds it, so at most one write a day.
- `recentDayKeys(now, [days])` / `sumDailyWindow(daily, now, [days])` — the rolling window and its sum, never below zero · `staleDailyKeys(daily, now, [keepDays])` — buckets to prune · `orderPageCounts(counts)` → `[{page, count}]`, busiest first · `ROLLING_WINDOW_DAYS` / `DAILY_RETENTION_DAYS` — the defaults.
- Per-address counters: `originLabel(hostname)` → `'web'` · `'pages'` · `'fb'` · `'other'` (a stable label, never the hostname: a `.` in a map key is a field path) · `originKey(day, origin, [installed])` / `parseOriginKey(key)` (null for anything unparseable, so a stray key is never counted as a date) · `summariseOrigins(daily, now, [days])` → `[{origin, accounts, installed}]` — an account-device signal, not a headcount · `staleOriginKeys(daily, now, [keepDays])`, which also returns unparseable keys, so a bad writer cannot grow the document for ever.

### `perf-reporter.js`
The anonymous page-load latency recorder. Per load it records only what the App Speed card reads — `fcp`, `domReady`, `ready`, `readyUpdate`, `rosterSnapshot`, `loginTotal` — as bucketed counters through `recordPerfSample`, with install mode and connection class. No identity and no raw millisecond value is ever stored. The header argues every rule; `LATENCY.md` records what the retired metrics found.
- `recordPageLatency(page, identity?)` — once per page beside `recordUsage()`. An admin identity records nothing but still consumes both one-shot markers. The Calendar passes the signed-in member, never the selection.
- **A sample is time somebody spent waiting.** A reading counts only if the page was watched from the start of the load up to it (`_watched`), so a hidden release reload and a prerender record none of the ordinary metrics; `ready` and `rosterSnapshot` reached after `markAwaitingInput()` (a sign-in form or a lock card appeared) are dropped. `readyUpdate` times what the member waited for after a release reload.
- `markPageReady()` — the `ready` mark, stamped after the frame that shows the page; the first call wins, and a page that never marks reports no `ready` (it is never borrowed from `domReady`). `PAGE_READY_MARK` is the mark's name.
- `markMilestone('rosterSnapshot')` — the Calendar painting the member's own stored roster (`calendar-snapshot.js`).
- `markLoginStart()` / `clearLoginStart()` — the sign-in marker in sessionStorage: read once on the destination page, cleared on a failed sign-in or one that leads to no page. `loginTotal` ends at the `ready` mark.
- `loadFollowedRelease()` — did a release cause this load? Read once and remembered, because `recordUsage` (which skips such a load) reads it before this module does.
- Tested by `perf-reporter.test.mjs`, which asserts ABSENCE for loads that hide, start hidden, prerender or wait for typing.

### `perf-stats.js`
Pure latency maths for the speed pipeline — no DOM, no Firebase, no timing reads. Imported by `analytics-client.js`, `perf-reporter.js` and `operations-speed.js`; tested by `perf-stats.test.mjs`.
- Buckets and keys: `PERF_BUCKETS` · `bucketDuration(ms)` (null for a non-positive or non-finite value — skip the sample) · `perfSampleKey({version,page,metric,bucket,mode,conn})` / `parsePerfSampleKey(key)` (the version's dots become `_`, because a `.` in a map key is a field path) · `loginDurationBucket(t0, now, maxMs?)` / `LOGIN_MAX_MS` · `createPerfBatcher(write, arm)` (one merged write per month; it holds counts and no timers).
- Summaries: `SPEED_GROUPS` · `summarisePerf(samples, {metric})` · `summarisePerfBy(samples, {page, metric, dimension, minSamples, splitAt})` / `PERF_DIMENSIONS` (no version row crosses `splitAt`) · `perfVerdict(overall, kind?)` (thresholds and wording in its JSDoc) · `THIN_SAMPLE` (below it the verdict is withheld and the percentage still shown) · `shareLabel(part, whole)` / `compactPct(pct, count, total)` (a share never rounds to a lie) · `perfRecordFullness(samples)` (how near the month's record is to a Firestore document limit).
- Release-bounded reads: `EARLY_ROSTER` / `summariseEarlyRoster` / `EARLY_ROSTER_FROM` / `earlyRosterShareLabel(samples, {page})` · `UPDATE_OPENS` / `summariseUpdateOpens` / `UPDATE_OPENS_FROM` · `CLEAN_TIMINGS_FROM` / `shareMeasuredBefore(samples, from?)`. Each `…_FROM` names the first release whose recorder produced what it reads.
- **A stored count must be a count**: only a positive whole number under a million is read, because any signed-in session can write the values. **The three percentages always add to 100** (largest remainder).

### `auth-identity.js`
Pure account-identity helpers, no imports, unit-testable because `firebase-client.js` (which re-exports the first two) cannot load in Node. Tested by `auth-identity.test.mjs`.
- `normaliseSurname(fullName)` — everything after the first word, lowercased, non-letters stripped; `getSurname()` in `session.js` delegates to it. A deliberate CommonJS duplicate is `nameToPassword` in `functions/roster-parse-helpers.js`, held equal by `surname-parity.test.mjs` (which reads THIS file).
- `nameToEmail(fullName)` — the synthetic `initial.surname@myb-roster.local` account email. Identity-critical: a silent change could put two members on one account.
- `surnamePassword(fullName)` — the surname default, padded to six characters · `credentialCandidatesFor(fullName, typed)` — the typed value, then the surname default ONLY when the typed value normalises to the surname; that gate is what stops an ungated fallback signing in whatever is typed.
- `isPasswordMigrated(status)` — `passwordSetAt` present and no older than any `resetAt` · `MIN_PASSWORD_LENGTH` / `validateNewPassword(fullName, next, confirm)` — the chosen-password rules, shared by Settings and the forced overlay (`password-force.js`), so one surface cannot accept what the other refuses.
- `CREDENTIAL_REJECTION_CODES` / `isCredentialRejection(code)` — a DEFINITIVE credential rejection, so both password ladders (sign-in in `session.js`, and `reauthenticateWithPassword`) try the next candidate only on a real rejection and stop on a transient failure.
- `sessionPredatesReset(sessionCreatedMs, resetAtMs)` — refuse a SILENT re-sign-in on a session older than the last admin reset; an unknown reset time (`null`) refuses too · `resetAtFromRestDoc(status, body)`, `isRestCredentialRejection(status, body)`, `isRestThrottled(status, body)` — the three readings of the REST answers `probeResetAtMs` gets.

### `document-url.js`
Asks the server for a SHORT-LIVED document url and decides what a refusal means. Imports only `fetch-timeout.js`, so the rule is testable in Node (`document-url.test.mjs`); `fetchSignedDocumentUrl` in `firebase-client.js` adds the current user and token.
- `requestSignedDocumentUrl(kind, getToken, doFetch?)` → `{ url, expiresAt, fileType, storagePath }` or `null`. **It never throws, and `null` is not a failure**: every caller has the permanent `storageUrl`, and a 503, 403, 404, timeout or offline answer all mean "carry on the old way". A 200 with no usable url, or no readable expiry, is `null` too, so `undefined` never reaches `window.open`. `doFetch` is a test seam.
- `DOCUMENT_URL_ENDPOINT` · `DOCUMENT_URL_TIMEOUT_MS` — short on purpose: the tap already has a working url in hand.
- Which url opens, and whether the signed one is for the file on screen, is `resolveDocumentOpenUrl` (`storage-utils.js`).

### `functions/cell-day-rules.js`
What a roster cell MEANS, given the day of the week it sits in. CommonJS, requires nothing; required by `roster-parse-helpers.js`, `roster-prompt.js` and `roster-sunday-repair.js`. The import's contract is `.claude/rules/roster-import.md`.
- `isPhysicallyBlank(raw)` — a missing key, an empty string or the `BLANK` token · `blankCellMeaning(dayIndex, dayLabel)` — an EMPTY cell is `RD` on a Sunday (the uncontracted column) and an `UNKNOWN|…` review question Monday to Saturday. A per-cell normaliser cannot know which column it reads, so every caller asks this one function.
- `isNotAvailable(raw)` (`NA`, `N/A`, `N.A.`) · `isNotAvailableSunday(raw)` (`NS`) — the recognisers, matched on the WHOLE cell, so `NAT` and a time are untouched. Both codes are rest days on every day (an owner decision; the header has the history), recorded as `RD` by `normaliseShift`. The Sunday scan repair asks the same recognisers before anything is normalised, so the two cannot disagree about a spelling.
- `BLANK_CELL_TOKEN` · `NOT_AVAILABLE_TOKENS` · `NOT_AVAILABLE_SUNDAY_TOKENS` · `SUNDAY` — the tokens and the day index the predicates read.
- The blank rule's history stays in `buildSafeEntries`. Tested through the coordinator by `roster-parse-helpers.test.mjs`, and through the whole handler by `index-endpoints.test.mjs`.

### `storage-utils.js`
Pure Storage helpers, no imports, tested by `storage-utils.test.mjs` (the open rule's wiring by `calendar-doc-viewer.test.mjs`). `firebase-client.js` re-exports the first two below.
- `isSafeStorageUrl(url)` — **a security control**: HTTPS on a Firebase Storage host under one of THIS project's buckets, anchored so a look-alike bucket cannot match. Every document open passes through it.
- `resolveDocumentOpenUrl({ signed, stored, fileType, storagePath }, now?)` → `{ url, signed }` or null — the whole of which url a document opens with. It takes the short-lived signed url only when that is safe, more than `SIGNED_URL_MARGIN_MS` from expiry, and for the SAME file the caller holds (`storagePath`; a server that sends none is trusted, so the two halves deploy in either order); otherwise the stored url, checked the same way. A `.docx` is wrapped in the Office viewer after the choice, by the chosen url's own file type. Call it AT THE TAP; all three openers do.
- `officeViewerUrl(storageUrl)` — Microsoft's full-page Office viewer, so a Word document renders instead of downloading · `isDocxUpload(file)` — the upload's file-type test.
- `sixMonthCutoffISO(now)` — the retention cutoff, clamping a month-end day the target month lacks (31 Aug → 28 Feb), so `pruneOldDocs` never deletes early.
- `legacyDocPath(collectionName, dateId, fileType?)` — the pre-versioning fixed path, the ONE rule for both places that delete an old object · `versionedDocPath(collectionName, date, uploadId, fileType)` — must stay under the `{collection}/{date}-` prefix the server's Huddle prune sweeps · `uploadMimeType(fileType)` — the explicit upload Content-Type (Android mis-reports a .docx).

### `client-errors.js`
The pure rules of the client error log — no DOM, no Firebase. `error-reporter.js` uses the capture side, `analytics-client.js` the read side, and `operations-errors.js` uses `isDiagnosticEntry`. Tested by `client-errors.test.mjs` and `error-reporter.test.mjs`.
- `shouldReport(message, src, hostname)` — the noise filters. **Too broad is the dangerous direction**: it silently swallows real errors and the log looks healthy because it is broken, so every rule is pinned from both sides. `APP_SCRIPT_ORIGINS` — the CDNs the app's own code loads from; a crash there is real and is reported.
- `CLIENT_ERROR_RETENTION_MS` (counted from resolution, not from the error) · `isResolvedErrorExpired(rec, now, [retentionMs])` · `expiredResolvedIds(resolved, now, [retentionMs])`.
- `orderClientErrors(unresolved, resolved, now, [opts])` — every unresolved record first, newest first, then up to `resolvedLimit` recent resolved ones · `capUnresolvedErrors(fetchedUnresolved, cap)` → `{ shown, truncated }`: fetch `cap + 1`, and `truncated` only when the extra row came back.
- `DIAGNOSTIC_PREFIX` / `isDiagnosticEntry(e)` — a slow-save diagnostic: listed and resolvable, never counted as an error.

### `claim-retry.js`
The pure write-safety rules — no DOM, no Firebase; the caller injects every dependency. Imported by `firebase-client.js`, the write surfaces (Admin, Settings, Operations, Links, `documents-client.js`, `slow-save.js`) and, for `isAccessFailure`, the Calendar's fetches and `nav-panel.js`. Each function's JSDoc carries its reasoning. Tested by `claim-retry.test.mjs`.
- `runWithClaimRetry(fn, { retryCode, hasUser, refresh })` — on a stale-claim rejection with a user present, refresh once and retry once; a failed refresh re-throws the ORIGINAL error. `isClaimRetryable(err, retryCode, hasUser)` is its predicate. `fn` must build a fresh batch each call.
- `isAccessFailure(err)` — "not allowed to read that" (`permission-denied`, or the Calendar's `calendar-access-required`) rather than a poor connection. The two need different words: a retry prompt against a session that has gone is a loop the member cannot win.
- `abandonOnSignOut(request, { uid, watch })` / `SIGNED_OUT_CODE` — stop waiting once the account the request was made as has gone, because Firestore never settles that account's pending commit. **It ends the wait, not the write**, so every surface calls the outcome unconfirmed (`signedOutLine(what, whereToCheck)`), never "failed".
- `runGatedWrite(run)` / `hasUnconfirmedWrite()` / `UNCONFIRMED_CODE` / `UNCONFIRMED_LINE` / `unconfirmedWriteLine(err, what, whereToCheck)` / `_resetUnconfirmedWrites()` (test seam) — once a write on the page ends `SIGNED_OUT_CODE`, every later write is refused until reload, so a retry cannot write a second copy beside the one Firestore still holds. Reads are not gated. `writesInFlight()` (`slow-save.js`) counts it, and Operations and Links ask `hasUnconfirmedWrite()` so no automatic reload strands the held write.
- `saveFailureMessage(err)` — the Admin save's error line: unconfirmed, refused, or connection.
- `watchIdentityLoss({ uid, watch, stillLost, onLost, settleMs? })` — `onLost` once, when NOBODY has been signed in for `settleMs` and `stillLost()` agrees. Another account arriving is never a loss: Firebase shares one account across a browser's tabs. Wired through `guardNamedSession` (`page-session.js`).

### `page-session.js`
How a signed-in page leaves a session, and what it does when the session leaves it — the routines every protected page shares, so the per-page copies cannot differ again. The header says what each routine owns and the defects the copies had. Tested by `page-session.test.mjs`; the wiring by `page-contract-parity.test.mjs`.
- `warnOnUnload(isDirty)` — the browser's "Leave site?" while there is unsaved work; it stands down once a sign-out has been answered.
- `askBeforeSignOut(isDirty)` → the drawer's `beforeSignOut`: "Sign out anyway?" over unsaved work. It runs BEFORE anything is released, so a Cancel changes nothing.
- `askBeforeLeavingByDrawer(isDirty)` — a capture-phase guard on `.nav-panel a[href]`: over unsaved work it asks "Leave this page anyway?" and, on Leave, clicks the link again so the link's own listeners still run. A phone never shows the unload prompt, which was the only other guard. Used by `admin-app.js`; Links keeps its own guard.
- `signOutAndLeave({ to? })` — `clearSession()`, then `location.replace(to)`, or a reload when `to` is null, so the page leaves no history entry behind.
- `reloadIfRestoredForSomeoneElse()` — the first line of every coordinator: reload a back/forward-cache restore, or a page left open in another tab, unless the signed-in member matches both who the page was built for and who was signed in at `pagehide`.
- `guardNamedSession({ page, pageLabel, member, established, signIn? })` — once `established` settles: a login decision clears the session, resets the drawer and signs in; a PENDING one (Firebase's start-up stalled) shows the sign-in over a KEPT session and reloads once this member's identity lands; otherwise `watchIdentityLoss` offers the sign-in on a later loss. Used by every protected page except the Calendar (PIN) and the Pay Calculator (soft policy).
- `lateReloadAllowed(now)` / `LATE_RELOAD_GAP_MS` — at most one late-identity reload every two minutes per tab, because on a connection that never answers, the SDK emits the stored user about 30 s into every load.

### `guide-search.js` / `guide-index.js` / `nav-guide-search.js`
Cross-guide search in the drawer's Reference zone: a member knows a term, not which guide owns it. The three rules are numbered in `guide-search.js`'s header. Contracts: `guide-search.test.mjs` (the rules) and `guide-index-parity.test.mjs` (staleness, marker vocabulary, anchors, the legend rule, wiring).
- `guide-search.js` (pure, no imports) — `tokeniseText(text)`, the ONE tokeniser (the index generator imports it, so index and query cannot disagree), and `searchGuideIndex(index, query, {limit})` → ranked results: every token must match, the last as a prefix; a title hit outranks a body hit; a section is dropped when a card inside it matched; **`evidence` passes through verbatim**, never merged into a "worst" and never dropped.
- `guide-index.js` — `GUIDE_INDEX`, GENERATED by `npm run generate:guide-index` (`scripts/generate-guide-index.mjs`, sharing `scripts/guide-index-lib.mjs`); never hand-edit it. One unit per `h2` section with an id and per answer card, carrying the provisional evidence states the page declares through its marker classes; an element marked `data-gs-example` is dropped first (`.claude/rules/guide-pages.md`).
- `nav-guide-search.js` — `initGuideSearch({ guides })`, lazy-loaded with the index on the box's first focus; `guides` is the drawer's own `NAV_GUIDES`, passed in so the drawer keeps the single declaration. Result rows are ordinary `.nav-panel-link--guide` anchors with `data-open-id`, so the drawer's delegated handler gives them open-counting, `?from=` and the Back handling. Evidence shows as one chip per state (`EVIDENCE_LABELS`). Escape clears a non-empty box first.

### `operations-tips.js`
`CARD_TIPS` — the content of every `?` panel on `operations.html`, one entry per card, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins. Pure data, no imports; `operations-app.js` passes it to `initTipsLightbox`.

### `operations-attention.js`
The "Needs attention" strip on `operations.html`: an index of exceptional card states. Its three refusals are the header — it runs no reads (every count comes from the card that owns it), it does not exist when clean, and it owns no navigation (hash anchors into `DEEP_LINK_CARDS`). Pure half tested by `operations-attention.test.mjs`; the wiring by `e2e/operations.spec.js`.
- `ATTENTION_CATALOGUE` — the one declaration of what can need attention: id → emoji, deep-link hash, `short` label, `after` (the words after the count). Grouped by REMEDY: `accountSetup` is everything Set up accounts fixes; `accountLeavers` needs the confirmed disable sweep.
- `buildAttentionItems(reports)` — pure: the items to render, in catalogue order, each with `short` and `badge` (the visual pill, whose count is the same `.card-year-chip` the target card wears; `errors` shows the truncated "100+") and `text`, the accessible name BUILT FROM them so it contains the visible label (WCAG 2.5.3). A count of 0 renders nothing; an id never reported is ABSENT, because unknown is not clean.
- `createAttentionStrip({ container, onJump })` → `{ report(id, count, {truncated}), withdraw(id) }`. `report` THROWS on an unknown id; `withdraw` takes a count back to unknown when the card's reload fails.
- Fed by the reset-request refresh and the account-setup audit (`operations-app.js`) and the Error Log (`operations-errors.js`), at the moments the card header chips update, so the strip and the chips cannot disagree. A failed card load reports nothing.

### `nav-panel.js`
The slide-out drawer every app page carries: it injects the overlay and drawer, wires the burger (`#navMenuBtn`), and renders the footer (initials badge, notification bell, Sign out). The three zones and the rules each keeps are the module header and CLAUDE.md → "Nav panel"; the reasoning is beside the code. Tested by `nav-panel.test.mjs`. **At its line cap** (`coordinator-ratchet.test.mjs`).
- `initNavPanel({ currentPage, memberName, onSignOut, beforeSignOut, isAdmin, isLinksDesigner, canOpenOvertime, canOpenNewlink, onLogoClick, authReady, onLockCalendar, canReadDocuments })` — call once; a second call returns early (`burger.dataset.navPanelInit`). The four permission flags decide which `NAV_PAGES` pills appear (`adminOnly`, `linksDesignerOnly`, `overtimeAudienceOnly`, `newlinkAudienceOnly`); the current page is an inert `aria-current` pill, never omitted. `memberName` with `onSignOut` shows the footer. `onLogoClick` opens the page's About panel once the drawer's Back echo has landed. `onLockCalendar` (`{ isViewer, lock }`) is the PIN viewer's Lock row on the Calendar and Trains. `authReady` is awaited, bounded, before a document read; `canReadDocuments` is the Calendar's document gate.
- **Sign out runs in a fixed order**: `beforeSignOut` first (resolving `false` cancels), then `releaseDevicePush` (`notif.js`), then `onSignOut`. A cancel after the release would leave a signed-in device with no push record.
- `resetNavPanel()` — tears the drawer down (injected DOM, the burger's listeners, the guard, module state) so a later `initNavPanel` rebuilds it with a fresh identity; Admin's in-place re-sign-in uses it.
- `archiveNotice({ id, title, section, date, body })` — records a notice in the App Notices archive (`myb_app_notices`): deduped by id, the newest 50 kept, entries older than 180 days pruned. Call it in `onClose` for a close-only notice and in `onOpen` for one with a link. `isNoticeExpired(dateStr, days = 28)` — whether a "D Mon YYYY" posting date is older than `days` (the long window is 90). The pattern is the `/new-notice` skill.
- **The documents** (`_openLatestDoc`): refused at once when `canReadDocuments()` says no, before the blank tab opens; otherwise the tab opens on the gesture and is filled through `resolveDocumentOpenUrl`. When no tab comes back (a pop-up blocker, an iOS home-screen app) the tap hands over to the Calendar's in-app viewer through a hidden drawer link, so the unsaved-work question still runs.
- **The bell** reads `peekNotifState()` on every open (no Firestore write); the push logic is `notif.js`. A labelled full-width row has been tried and reverted twice (CLAUDE.md).
- **The drawer's two lightboxes** (Coming soon, App Notices) share the drawer's history entry, so they hand-roll `createLightbox`'s promises: a fallback beside `transitionend`, a close that runs ONCE, focus back to the burger, and key handlers that stand down under a higher `.lb-overlay` (`_overlayAbove`). `closePanelForNavigation()` closes the drawer without `history.back()` when a link navigates.
- Adding a guide is one `NAV_GUIDES` entry with an `openId`, plus that id in the `firestore.rules` analytics allowlist and in `OPEN_META` (`firestore-contract-parity.test.mjs` checks all three). Adding a live document is one `links` entry in `NAV_INFORMATION`; `comingSoon: true` renders a button that opens `#navComingSoonLightbox`.

### `notif.js`
The Web Push module: the client's one copy of the VAPID public key (it must match `functions/index.js`, and a mismatch is silent and permanent — CLAUDE.md → Change impact) and the subscription lifecycle. Imported by `nav-panel.js`, `calendar-notif-prompt.js`, `calendar-lock-cards.js`, `install-prompt.js`, `huddle.js` and `settings-app.js`. The states are `'on'` · `'off-default'` · `'off-lapsed'` · `'denied'` · `'unsupported'`. Tested by `notif.test.mjs`; the server side and a rotated endpoint are `.claude/rules/notifications.md`.
- `notifSupported()` — feature detection, including iOS's "only inside the installed app" · `isIOS()` — iOS and iPadOS, including iPadOS reporting as MacIntel with touch.
- `getNotifState()` — the state WITH side effects: the silent re-subscribe when the VAPID key changed, and a re-save of the server record, outside the 24-hour throttle, when the live endpoint or the signed-in uid differs from the one last saved. Run once per Calendar load (`calendar-notif-prompt.js`).
- `peekNotifState()` — the same answer, read-only; the drawer bell uses it on every open.
- `enableNotifications()` / `disableNotifications()` → the new state. A Disable records the choice on the device, so both reads answer `'off-default'` rather than `'off-lapsed'`; `notifOffByChoice()` reads it, and the Settings card reports Off rather than a to-do.
- `releaseDevicePush(timeoutMs?)` — at sign-out (after `beforeSignOut` agrees, before `onSignOut`) and at the Calendar's hand-over to the staff PIN: delete this device's `pushSubscriptions` record while still signed in, so targeted notices stop following the member onto a shared device. When the delete is refused, or still unconfirmed at the time box, it drops the BROWSER subscription instead, so the next send's 410 removes the record.

### `print-guard.js`
Can `window.print()` do anything here? In a home-screen web app on iPhone or iPad it silently does nothing (the header has the WebKit reference). Pure and import-free, so the guides and the app pages share one rule. Imported by `about-lightbox.js`, `calendar-app.js` (the `p` key), `links-app.js` and `guide-print.js`. Tested by `print-guard.test.mjs`; the entry points by `e2e/print.spec.js`.
- `printIsBlocked({ standalone? })` — true for `navigator.standalone === true`, whatever the iOS version: WebKit freezes the version in the user agent, so a version test never sees iOS 27. `display-mode: standalone` is not used, because it also matches an installed Android app, which prints.
- `printOrExplain({ print?, explain })` — the one entry every print control uses: print, or run `explain` and return false.
- `openInSafari(url?)` — opens the page in a new context, which from a home-screen app is Safari; call it inside a tap. `explainNoPrint(confirmDialog)` — the app pages' dialog, whose confirm is that tap; the dialog is passed in so this module stays import-free.
- `PRINT_UNAVAILABLE_TEXT`, `OPEN_IN_SAFARI_LABEL` — the one wording, shared by the guides' inline notice and the app's dialog.

### `clock-input.js`
The rules of a TEXT clock box — pure, no imports. Every time box in the app is text rather than `<input type="time">`, because Chromium draws that from the OS format settings (`06:00 AM` beside 24-hour badges); so nothing in the browser validates the value, and these rules do. Imported by `override-utils.js`, `overtime-form.js`, `admin-time-inputs.js`, `admin-roster-upload.js` and `links-app.js`. Tested by `clock-input.test.mjs`.
- `isClockTime(v)` — a REAL `HH:MM` clock time, the ONE definition. `24:00` is refused: a midnight finish is `00:00`, and an overnight range is end < start.
- `formatClockInput(raw)` — what the box shows after each keystroke: digits only, at most four, the colon after the hour (a phone keypad has none). Three digits become a dropped leading zero only when the first is 3 to 9 (`630` → `06:30`); a four-digit non-time is left for `isClockTime` to refuse.
- `finaliseClockInput(raw)` — what the box holds once it is LEFT: the keystroke rule plus the one reading it must defer, `240` → `02:40`, which shaped while typing would fill the box before the last 0 of `2400`. Called on `focusout` by `admin-time-inputs.js` and the roster review, and in the Links window editor's commit.
- The shapers never widen what `isClockTime` admits; it still judges the result.

### `override-utils.js`
The pure override rules shared by the Calendar, Team Week View, Admin and the pay engine: priority, the cache reconcile, the write shape, what an override says about the contract, the Other-day grammar and the Sunday rule. No DOM, no Firestore; each export's JSDoc carries its reasoning. Tested by `override-utils.test.mjs`. **At the 900-line threshold** of `coordinator-ratchet.test.mjs`, so extract before adding.
- **Display:** `resolveEffectiveShift(override, baseShift, sunday)` → `{ shift, rdwTime, derivedRdw }`, the ONE ladder for applying an override to the base shift; the month grid, Team Week View and the month legend all render from it (CLAUDE.md → Change impact). A timed `shift` on a Sunday displays as RDW. `isOverrideDisplaySuppressed(override, baseShift, sunday)` — the display half of the Sunday rule (layer 5): an absence on a Sunday or on a rest-day base (unless it replaced contracted work); leave or an Other day on a Sunday. `sunday` is a boolean so this module never imports `roster-data.js`, which would be a cycle.
- **Priority and the cache:** `shouldReplaceOverride(existing, incoming)` — manual beats import; within a class the newer `createdAt` wins · `tsToMillis(ts)` (a Timestamp, `{seconds}` or a `Date`) · `toOverrideRecord(data)` — the calendar cache's record shape · `collectOverrideRecords(snapshot)` — validate and collect a range snapshot; a malformed document is skipped and only its id is logged · `reconcileRangeIntoCache(cache, records, startStr, endStr, { authoritative? })` → whether the display changed: a server range query rebuilds each in-range winner from the snapshot alone and evicts what it omits; `authoritative: false` (a cache read) evicts nothing.
- **Writes:** `buildOverrideWrite(f, createdAt)` / `buildOverrideCacheRecord(id, f, createdAt)` — the one field shape the rules' `hasOnly()` accepts, for every save path: `replacedType` only when present, `leaveYear` only when the rules would accept it, and `note` still written as `''` (its JSDoc has the three-push order for retiring it) · `nextReplacedType(existing, newType)` — what a rewrite carries forward: inherit on the same type, chain through an absence · `nextLeaveYear` (re-exported from `leave-year.js`), the other thing a rewrite carries · `computePeriodDeleteIds(allOverrides, { type, memberName, start, end, isRestGap? })` — the ids to delete when an AL or absence range is re-saved, including its Sunday `correction` records; an edge Sunday's only when that booking wrote it (the same `createdAt`) · `mergeBookedPeriods(dateList, isRestGap, addDay)` — booked dates → contiguous periods across rest gaps.
- **The contract:** `CONTRACTED_WORK_TYPES` / `VOLUNTARY_WORK_TYPES` / `isContractedWorkOverride(ov)` → true, false or null (null: ask the base roster). **`rdw` is not contracted work** — charging leave for declined overtime is the bug this set exists to stop. `contractEvidence(ov)` — the override whose type answers that, unwrapping leave and a chained absence to their `replacedType` · `LEGACY_OVERRIDE_TYPES` — retired types that survive only as a historic `replacedType` and still classify · `isRestShift(shift)` — `RD` or `OFF`.
- **Other days** (OTHER_DAYS.md): `OTHER_FLAVOURS` (badge and full words; `hideBaseTime` for Meeting and Union) · `OTHER_RDW_DEFAULT_MINS` · `isOtherValue(v)` / `parseOtherValue(v)` / `composeOtherValue(f)` — the reader and the writer of `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`, side by side; the composer forces an explicit flavour, forces the RDW marker on a rest-day base and refuses a half-filled or equal pair of times · `resolveOtherPay(parsed, baseValue)` → `rdw` · `timed` · `as-base`, the one pay mapping (the display never resolves it). The CommonJS copy of the recognition grammar is `functions/roster-other-days.js`.
- **Sundays:** `SUNDAY_FORBIDDEN_TYPES` — the one list of types never written to a Sunday (CLAUDE.md → "Sundays are non-contracted" numbers the enforcement layers) · `isForbiddenOnSunday(type)` · `sundaySafeValue(value)` — the roster import's normaliser: leave or an absence becomes `RD`, and an Other day keeps its times as Sunday work · `isBeforeMemberStart(member, date)` — always call it; never inline the comparison.
- **The review's entry control:** `manualCellValue(type, from, to)` — a type and two real clock times → the parsed-roster value; `other` returns null, because the review composes it through `composeOtherValue`.

### `railcard-guide.js`
The Railcard guide's page behaviour — a classic `defer` script, because CSP forbids inline script. The ⤓ PDF button is `guide-print.js`'s, not this file's.
- Chip-bar navigation: smooth-scrolls to the section, moves focus to it and marks the chip `aria-current`.
- The sticky offsets: after `document.fonts.ready` (so the header is measured in Inter), the chip bar's `top` matches the header and every `.rc` and `.section` gets a `scrollMarginTop`; a `ResizeObserver` re-syncs when the header's height changes later.

### `fip-guide.js`
The FIP guide's behaviour — a classic `defer` script, all progressive enhancement: with JS off, every country is visible.
- **Country finder** (`#countrySearch`): `applyCountryFilter(raw)` filters the country cards and the A–Z jump chips against each card's whole text (a country, an operator or a train). The card set is `[id^="country-"]` and **its size is never written down**; `#booking-table` deliberately does not start `country-`, so a search cannot hide it.
- **Open on jump:** `openHashTarget()` opens the target `<details>` on load and on every `hashchange`, clearing the search first if it had hidden the target; a `.country-jump` click covers re-tapping the current country.
- **Sticky chip bar and scrollspy**, measured after `document.fonts.ready`, like the Railcard guide.
- **Print:** `expandAllForPrint` / `restoreAfterPrint` open every `<details>` for the print run and put them back (Chromium does not print a closed `<details>`'s body). Both are idempotent, and neither trusts its own event: the prepare also runs in the ⤓ button's capture-phase click and the restore on `visibilitychange`, because iOS sends no `beforeprint` or `afterprint` for AirPrint. It prints what is on screen — a filtered-out card stays hidden — and `describePrintScope(shown)` sets the button's `aria-label` to say which, starting with "PDF", the visible word (WCAG 2.5.3).
- **Print one country:** each card gets a `⤓ Print <country>` button. Printing one card is a CSS state (`body[data-print-country]` and a marker class), never a DOM edit, so an interrupted print cannot lose a country. A refusal from `guide-print.js` (`guide:print-refused`) puts the page back.

### `guide-print.js`
The ⤓ PDF button on every guide, and the FIP guide's per-country buttons — an ES module all five guides load. One delegated bubble-phase `click` listener for `.btn-print` and `.btn-print-country`, routed through `printOrExplain` (`print-guard.js`): it prints, or inserts the `#printUnavailable` notice under the header with an "Open in Safari" button and dispatches `guide:print-refused` so a page that prepared can undo it. It prepares nothing itself; the FIP guide's own handlers run first. No guide may keep a private print handler.

### `guide-back.js`
Points a guide's ← arrow at the page you came FROM — a classic `defer` script on all five guides, no exports. `nav-panel.js` appends `?from=<page>` when it opens a guide, and this rewrites the arrow's `href` and `aria-label` to match. `from` is resolved through the `DESTINATIONS` allowlist of the app's own pages and never used as a url, so a crafted value cannot make an off-site link; an unknown or absent `from` leaves the authored href alone. The allowlist is hand-kept, and `page-contract-parity.test.mjs` fails when a page is missing from it. The header says why the arrow needs retargeting at all.

### `ls.js`
Safe `localStorage` wrappers — iOS Safari's private mode throws on any access. **Never call `localStorage` directly** in the page coordinators (CLAUDE.md); use these. Tested by `ls-persist.test.mjs`.
- `lsGet(k)` / `lsSet(k, v)` / `lsDel(k)` — each call in a try/catch; the first failure logs one `console.warn`, the rest are silent. `lsSet` swallows a failed write ON PURPOSE: a preference that fails to save is not worth crashing a page over.
- `lsKeys()` — a snapshot of every key name (safe to delete while iterating); `[]` when storage is unavailable.
- **The checked writes**, for a caller about to DELETE the source: `lsSetVerified(k, v)` → boolean (writes, then reads the value back) · `lsMove(fromKey, toKey, value?)` → boolean (deletes the source only once the destination is verified) · `lsSetBothVerified(keyA, valueA, keyB, valueB)` → boolean (both keys or neither, and `false` even when the rollback itself fails). **Never delete source data until the destination has been read back** — an audit reproduced permanent loss from migrations that did. They are deliberately not the default: an ordinary preference write does not need the branch.
- `requestPersistentStorage(keyPrefix)` — asks, once per device and only once a key under `keyPrefix` exists, for this origin's storage to be durable rather than evictable; the Pay Calculator calls it with `pcPrefix()`. WebKit has no `navigator.storage`, so on iOS installing the app remains the only lever.

### `storage-keys.js`
The one spelling of every storage key read by MORE THAN ONE file, because a one-character typo loses data silently. A key one module uses stays local to it, and the Pay Calculator's namespace is `pcPrefix()` (`paycalc-migrations.js`), never here. `storage-key-parity.test.mjs` holds the shared keys to this file; each key's JSDoc names its writer and its readers.
- `SELECTED_MEMBER` · `VIEWED_MONTH` / `VIEWED_YEAR` (the Calendar month Admin hands back) · `TEAM_VIEW` · `CALENDAR_SNAPSHOT` (the member's stored roster; `clearSession()` deletes it at every sign-out, so a misspelling would leave shifts on a shared device) · `NOTIF_PROMPT_DONE` · `PW_FORCE_PENDING_PREFIX` (the one-shot set-password marker).
- `SW_UPDATE_RELOAD` — the one sessionStorage key: it describes one tab's journey, so it is read directly in a try/catch, not through `ls.js`. A drifted spelling would conceal itself — `readyUpdate` would never record, which reads as "no release has ever reloaded anybody".

### `status-text.js`
The leading glyph on a transient status message (`✓`, `⚠`, `✗`, `↻`), kept out of what a screen reader announces. The header argues the design.
- `setStatus(el, text)` — writes the message with the glyph inside an `aria-hidden` span, built from nodes and never `innerHTML` (the rest of the line often carries a name or an error). A missing `el` is a no-op. `el.textContent` still reads back exactly the string passed in, which is what let existing sites migrate untouched — know it before "simplifying" this.
- `splitStatusGlyph(text)` → `{ glyph, rest }` — only a glyph followed by a space is decoration; a bare glyph, or one running into a word, is left alone.
- `STATUS_GLYPHS` — the CLOSED vocabulary, longest first, so `⚠️` (U+26A0 U+FE0F) matches before the bare `⚠`.
- Buttons are out of scope: `✓ Resolve` is an accessible NAME. `status-text.test.mjs` tests the helper; `status-glyph-parity.test.mjs` stops a new status line being written the old way.

### `paycalc-sticky-total.js`
The bar that keeps the take-home figure on screen. `initPaycalcStickyTotal()` — safe when the elements are absent.
- Three inputs (whether the result figure is in view, whether a field is focused, where the visual viewport sits) and one output (whether `#stickyTotal` shows, and how far up it is translated). **No money, no period, no storage**: `calculate()` writes the figure and knows nothing of this module.
- Every guard fixes a reported iOS behaviour that headless tests cannot reproduce, which is why each carries its reasoning in the header: no `pagehide` disconnect, pinned above the keyboard rather than hidden behind it, the deferred `focusout` rebase, and a translate that composes with the desktop centring. Tested by `paycalc-sticky-total.test.mjs`.

### `admin-week-swipe.js`
The Admin week grid's swipe gesture and week arrows, which share one cooldown so a swipe and a press cannot both commit.
- `initAdminWeekSwipe({ weekGrid, fieldDate, prevWeekBtn, nextWeekBtn, canNavigate, onWeekCommitted, onSettled, shiftWeek })`.
- A pointer state machine and a carousel: it decides when a drag is a horizontal swipe (nothing starts until the intent is confirmed), builds the adjacent week panels, animates the commit and holds the cooldown. **It holds no business rule**: what a week change means stays in `admin-app.js` behind `onWeekCommitted` and `onSettled`, and whether the move may happen at all is `canNavigate`.
- Deliberately not shared with `calendar-swipe.js` (the header says why). Two rules from CLAUDE.md: Pointer Events, never Touch Events, and `setPointerCapture` on the GRID, not the clip.

### `overtime-review-controller.js`
The reviewer's side of `overtime.html`: the planning horizon, the week selection, the detail workspace, the grade and day lenses, the creation preview and the confirm bar. Overtime is paused — `docs/OVERTIME_AVAILABILITY.md` → Paused.
- `createReviewController({ el, esc, renderLoading, renderError, detailRefreshDebounceMs })` → `{ loadHorizon, selectWeek, wireConfirmBar, refreshSelectedIfStale }`. The four DOM helpers are the page's, injected.
- **The invariant it owns:** its eight pieces of state agree about which week is on screen, and with nothing else on the page — generation tickets so only the newest read paints, `selectedWeek` re-checked after every await, a grade lens that survives a week change and a day lens that does not. The header names each one.
- It renders through `overtime-manager.js` and reads through `overtime-data.js`; session, identity, tabs and the member's form stay with `overtime-app.js`.
- Tested by `overtime-review-controller.test.mjs`, the only kind of test that can choose which of two in-flight reads resolves last.

### `links-design-library.js`
The Links workspace's design LIBRARY — the import panel, the Recently deleted bin and Keep only the shortlist: managing the collection, apart from editing the open design. Every write goes through the design store, and every rule through its own module (`links-import.js`, `links-deletion.js`, `links-design-naming.js`, `links-shortlist.js`). Tested by `links-design-library.test.mjs`.
- `createDesignLibrary(ctx)` → `{ openImport, renderBinList, keepOnlyShortlist, binList, setBin, addToBin, upsertBin, trackBinMove }`; call once, after the store exists. `ctx` is deliberately small (`store`, `currentUser`, `getDesigns`, `addDesign`, `activate`, `isDirty`, `hasOpenDesign`, `renderPicker`, `refreshLists`, `actionStatus`, `getHeader`, `removeDesigns`): a split that passed the editor's state across would only move the coupling.
- It owns the bin list (read through `binList()`) and the automatic moves in flight (`trackBinMove`): a restore or purge waits for a pending move of the same design.
- `keepOnlyShortlist()` moves every older design to the bin with the store's `binIfStill`, which asks the rule again inside the transaction; `removeDesigns` then opens the next live design, or the first of the shortlist.
- Rename, duplicate and delete stay in `links-app.js`: each changes the open design's concurrency baseline or its unsaved state.

### `links-design-store.js`
The link-design collection's persistence lifecycle and its concurrency protocol. Every Firebase handle is injected (`links-app.js` passes `writeWithClaimRetry` as `withClaimRetry`), so the interleavings can be forced against a fake Firestore (`links-design-store.test.mjs`).
- `createDesignStore(deps)` → `{ loadAll, create, save, rename, softDelete, binIfStill, restore, purge }`. `softDelete(id, by)` → `{ queued }`, queued offline like save, rename and create; `binIfStill(id, by, stillMatches)` is the AUTOMATIC bin move — a transaction that asks the rule again, and fails offline rather than queueing.
- `isOfflineFailure(err, isOnlineCheck?)` — whether a failure was the absence of a server rather than a server saying no; the one test that admits the unserialised path.
- **The four rules**, argued in the header: 1. a read a write depends on happens INSIDE that write's transaction; 2. no weaker fallback while online — an online failure is reported, and the caller keeps its unsaved state; 3. the baseline advances only to a revision the store verified, else `baselineUnknown` makes the next save ask; 4. a queued offline write is started, not awaited, and never stamps a revision a colleague's online save could also produce.
- No DOM and no dialogs: a conflict comes back as `{ status: 'conflict', conflict }` and the workspace decides. Not a generic repository — it knows revisions, soft deletion and conflict results because those are Links concepts.

### `upload-commit.js`
What an AMBIGUOUS Firestore commit means after a document upload: `deadline-exceeded` can arrive after the server committed, and the live document has more than one writer.
- `resolveUploadCommit({ ourPath, oldPath, livePath, readable })` → `'committed'` (the live path is ours) · `'superseded'` (somebody else's — never overwrite it) · `'retry'` (unchanged, so nothing of ours landed) · `'ambiguous'` (the read failed). **A failed read is not permission to write**: `ambiguous` writes nothing and rolls nothing back, and the upload is reported unconfirmed. An orphaned file costs storage; a live document pointing at a deleted file 404s behind the staff button.
- `documents-client.js` asks it, and asks it again inside the compare-and-set retry. Tested by `upload-commit.test.mjs`.

### `doc-retention.js`
The six-month sweep behind Circular and Newsletter uploads — the browser's only destructive operation on shared data. Every Firebase handle is injected, so `doc-retention.test.mjs` replays the races against fakes.
- `pruneOldDocs(collectionName, excludeDate, storage, refFn, deleteObject, fs)` — run after each successful upload by `documents-client.js`. Firestore first and Storage only on success, so a partial failure leaves an invisible orphan rather than a dead link.
- **The clock must be the server's**: the cutoff comes from the just-written document's `uploadedAt`, and with no server time there is no sweep. **Delete only what you read**: each delete re-reads inside a transaction and stands down if the storage path has moved. Its right long-term home is a scheduled Cloud Function.

### `analytics-client.js`
The Firestore I/O behind the admin's two read-outs of the app itself — the client error log and the anonymous usage and speed counters. A factory with every handle injected, so it loads in Node (`analytics-client.test.mjs` runs it against a fake Firestore); `firebase-client.js` builds it once and re-exports each function. It decides nothing: ordering and retention are `client-errors.js`, windows and summaries `usage-stats.js` and `perf-stats.js`, and who counts is `usage-reporter.js`.
- `buildAnalyticsClient({ db, collections, fs, writeWithClaimRetry, appVersion })` → the nine functions below.
- `logClientError(data)` · `getClientErrors()` → `{ errors, truncated }` (it fetches one more unresolved record than it shows, so `truncated` is true only when more really exist; it also prunes expired resolved records) · `resolveClientError(id)` (a gated write).
- `recordPageView(pageId)` · `recordActiveAccount({ month, day, fromDay })` · `recordOriginUse({ day, origin, installed, countVisit, fromDay, fromPwaDay })` — increment-only counters; a rolling count is MOVED off `fromDay` in the same merged write · `getUsageStats()` — this and last month's page views, the account counts and the per-address counts, pruning stale daily buckets on the way.
- `recordPerfSample({ page, metric, bucket, mode, conn })` — batched into ONE merged write per open (`createPerfBatcher`), flushed a second after the first sample, then at idle, or at once on `pagehide` or hidden · `getPerfStats()` → `{ thisMonth, lastMonth }`, each `{ month, login, fcp, pages, ready, samples }`, for the App Speed card.
- **Two properties, in the header:** no identity in a counter, and telemetry never affects the app — every writer swallows its rejection, and every prune is wrapped so it cannot reject the read it rides on (the prunes use `FieldPath`, because a dotted `daily.<date>` path throws synchronously).

### `documents-client.js`
The three date-keyed document collections — Daily Huddle, Weekly Retail Circular, Marylebone Newsletter — and the upload sequence behind them. A factory with every Firebase handle injected, so it loads in Node and its failure orderings can be forced against fakes (`documents-client.test.mjs`); `firebase-client.js` builds it and re-exports each function. It owns the sequence; the decisions are `upload-commit.js` and `doc-retention.js`.
- `buildDocumentClient(deps)` → `{ uploadHuddle, uploadCircular, uploadNewsletter, getLatestCircular, getLatestNewsletter, subscribeToLatestHuddle }`. `deps`: `db`, `collections`, the Firestore functions (`fs`), `getStorageSdk`, `uploadBytesWithClaimRetry`, the path and type `utils` (`storage-utils.js`), `resolveUploadCommit`, `pruneOldDocs`, `guardCommit` (`abandonOnSignOut`: a commit abandoned at sign-out throws `upload/unconfirmed`, never a failure and never a rollback) and a test `sleep`.
- `assertFileSignature(file, expectedType)` — the magic-number check; it fails CLOSED on an unreadable or too-short file.
- **The one invariant: a live document never points at a file that is not there.** So the signature is checked first; the file goes to a VERSIONED path, so the old one stays readable until Firestore commits; the new object is rolled back only on a DEFINITE non-commit; an ambiguous commit is resolved by READING, retried only as a compare-and-set inside `runTransaction`, and left untouched when the read fails. The header argues each step.
- A Circular or Newsletter upload runs the six-month sweep (`pruneOldDocs`) after it commits. `getLatestCircular()` / `getLatestNewsletter()` treat a row with no `storageUrl` as absent. `subscribeToLatestHuddle(onData, onError)` is a live `onSnapshot`; CLAUDE.md says do not replace it with a one-time fetch.

### `firestore.rules`
The server-side Firestore security rules — the authority on access; what the fields mean is `docs/DATA_MODEL.md`. The header holds the audit table of what each identity gets from each collection: re-read it whenever an identity or capability is added, because every `request.auth != null` silently widens. Deployed by `deploy-rules.yml`. Verify a change with `npm run test:rules` and `firestore-contract-parity.test.mjs`; a field a client starts writing ships rules-first, in its own push (CLAUDE.md → Workflows).
- **Access needs a CLAIM, never a bare session**: `isMember()` (a password sign-in whose email is the one derived from its `name`, and whose server-set `member` claim matches) · `memberName()` (that `name`, else null) · `isCalendarViewer()` (the PIN's custom-token claim) · `isKnownIdentity()` (any of those, or admin). Anonymous grants nothing — `AUTH_AND_SESSIONS.md` invariant 9.
- `overrides` — read by a member, the admin or the PIN viewer. Writes are per-member isolation (`memberName()` equals the record's `memberName`, before and after) or an `admin`/`manager` claim, with the field shape and the type ↔ value pairs pinned. The claims are set by `setupRosterAuth` from the server-owned roster, never from a request.
- `huddles` / `circulars` / `newsletters` — read like `overrides` (closed behind the PIN or a password by owner decision); written by the admin only, shape-checked, and a `storagePath` must sit under its own collection.
- `linkDesigns` — read by a member or the admin, never the PIN viewer; written with the `linksDesigner` claim or admin, shape-checked, and deleted only once it is in the bin. `linkTargetSets` — the same read; created by a designer and changed only by its creator or the admin.
- `staffContact` — the owner or the admin. `passwordStatus` — read by the owner or the admin; the owner may write only `passwordSetAt`, at the server's time (`resetAt` is the Function's). `resetRequests` — admin read, server-only writes. `viewerAttempts` — server-only both ways. `overtimeWindows` — reviewer read (`admin`/`manager`), no client writes.
- `pushSubscriptions` — no client reads; a write needs a known identity and is refused to the PIN viewer (its uid is the same on every office PC); the `owner` must be the writer, and a delete is the owner's. `clientErrors` / `analytics` — written by any known identity (the counters carry no identity), read by the admin; the `analytics` counter ids are an allowlist.

### `storage.rules`
The Firebase Storage rules. `huddles/`, `circulars/` and `newsletters/` are read, written and deleted by the admin only, and a write must be at most 20 MB and a PDF or Word (.docx) file (`MAX_FILE_BYTES` in `functions/index.js` must match); every other path is denied. Nobody opens a file through these rules: the app opens a short-lived signed url (`getDocumentUrl`) or the stored tokenised download url, both of which bypass them, and `ingestHuddle` uses the Admin SDK. Verify with `npm run test:rules`.

### `index.css` / `admin.css` / `paycalc.css` / `operations.css` / `settings.css` / `links.css` / `overtime.css` / `trains.css` / `newlink.css`
Each app page's own stylesheet, loaded after `shared.css`. A visual change specific to one page goes here; anything two pages share goes in `shared.css`. Served from the service worker's version cache like the app's JS. Tokens, surfaces and the recipes are `.claude/rules/css-tokens.md`; a raw hex colour fails `css-hex-parity.test.mjs`.

### `guide-shell.css`
The shared chrome of the five guide pages, linked first on each: the sticky navy header (back button, title, ⤓ PDF), the chip bar, the footer back link, the print rules, the Inter `@font-face`, and the guides' own palette tokens (`--navy`, `--navy-dark`, `--navy-mid`, `--gold`) in its `:root`. Change guide chrome here once, never re-inlined into a page. The guides do not load `shared.css`. Full specification: `.claude/rules/guide-pages.md`.

### `guide-doc.css`
The shared styles of the two document-style guides (`staff-guide.html`, `paycalc-guide.html`), loaded between `guide-shell.css` and each page's own CSS: the 760px content wrapper, the two-column print layout, info, warning and tip boxes, numbered steps, data tables and callout banners. A change here reaches both guides, so check both in print preview.

### `staff-guide.css` / `paycalc-guide.css` / `railcard-guide.css` / `fip-guide.css` / `rangers-guide.css`
Each guide page's own stylesheet, linked after `guide-shell.css` (and after `guide-doc.css` on the two document guides). A visual change specific to one guide goes here; the rules per guide are `.claude/rules/guide-pages.md`.

### `purify.es.mjs`
Self-hosted DOMPurify, the vendored ES module that sanitises the Huddle's HTML; its version is the file's licence line. Lazy-imported by `calendar-huddle-viewer.js`, whose comment beside the import has the upgrade steps — including re-adding the `// @ts-nocheck` first line, which `tsc` needs because it follows the dynamic import. Precached by the service worker, so sanitising works offline.

### `shared.css`
The CSS every app page shares; the guides deliberately do not load it. It holds the `:root` tokens — colours, surfaces, motion, the type scale, and `--font-sans` with the self-hosted Inter `@font-face` — and the shared components: `.app-header` (every page but the Calendar, which has its own `.header`), the drawer and `.btn-burger`, the lightboxes, buttons, badges and pills, `.touch-only` (revealed only under `@media (pointer: coarse)`), and the shared `@media print` rules, which every new shift type, cell class or badge needs. **Never hardcode a hex colour**; `css-hex-parity.test.mjs` enforces it. Tokens, surfaces, motion and the control recipes: `.claude/rules/css-tokens.md`.
- `.app-header` is a flex row: the burger, then `.app-header-brand` (`flex: 1`, content centred, so the badge's width cannot crowd the title), then the badge.

### `service-worker.js`
The offline-first service worker. **The caching strategy and the update lifecycle are its header and CLAUDE.md → "Service worker caching"** — read those rather than a copy here. Tested by `sw-asset-check.test.mjs`. **At its line cap** (`coordinator-ratchet.test.mjs`).
- `APP_VERSION` names the cache and must equal `roster-data.js`'s: change both with `npm run bump`, never by hand. `FIREBASE_SDK_VERSION` must equal the SDK version `firebase-client.js` imports.
- A new served file goes in `NETWORK_FIRST_FILES` (the set served from this version's cache) AND in a precache list — `CORE_ASSETS`, or `SUPPLEMENTARY_ASSETS` for the guides — or it is never precached; `sw-asset-check.test.mjs` fails on a miss.
- `SAFE_NOTIFICATION_PAGES` — the pages a notification tap may open; a payload's path is re-based onto this install's own scope and its origin is never trusted. A new notifying feature's landing page joins it (`.claude/rules/notifications.md`).
- A document cache miss races the network against a cached fallback only when one exists; with nothing cached it waits for the network, and the synthesised offline page links back to its own path.
- `pushsubscriptionchange` re-subscribes with the key the old subscription carried, so this file holds no copy of the VAPID key; `notif.js` re-saves the server record.

### `roster-cycle-data.js`
The raw roster cycles — `weeklyRoster`, `bilingualRoster`, `fixedRoster`, `cesRoster`, `dispatcherRoster` — with no logic and no imports. Imported only by `roster-data.js`, which re-exports them; app code reads shifts through `getBaseShift`, never from a pattern directly. A cell is `RD`, `OFF`, `SPARE`, `AL`, `RDW`, `HH:MM-HH:MM` or, Monday to Saturday, a bare Other flavour (`fixedRoster[3]` is Training with no times); `validateRosterPatterns` in `roster-data.js` checks every pattern. **A fixed pattern is SHARED**: editing one member's line edits everyone on it.

### `roster-member-data.js`
The roster's PEOPLE and nothing else — `teamMembers`, one entry per member, no logic and no imports. Its length tracks headcount, which is why it is not in `roster-data.js` (whose size guard was crossing on hiring rather than on complexity). **Re-exported by `roster-data.js`**, where every consumer reads it, the generator and the classification test included. To add or remove somebody: `/new-starter` and `/leaver`.
- **It is world-readable**: both origins serve it with no session, PIN or token, so a field added here is published the moment it ships. The classification argument is on `teamMembers` in CLAUDE.md, and `public-data-classification.test.mjs` fails on an unclassified field; anything a stranger should not read belongs in Firestore behind a claim.
- The field reference is CLAUDE.md → "teamMembers fields"; the comment at the top of the file covers the core fields and `rosterChanges`.

### `functions/index.js`
The COMPOSITION ROOT of the Cloud Functions. **Its exports are the deploy surface** — Firebase discovers functions from them — and `functions-surface.test.mjs` pins every deployed name, failing on a drop or an unreviewed addition. It defines the shared infrastructure: the four `defineSecret` params, `VAPID_PUBLIC_KEY` (guarded by `sw-asset-check.test.mjs`; it must match `notif.js`), `STAFF_SITE_URL`, `ADMIN_FUNCTION_ORIGINS`, `readRawBody`, `nowInLondon`, the size caps and the commit-ambiguous code set. It keeps two endpoints and spreads in the rest from `buildDocumentEndpoints`, `buildAuthEndpoints` and `buildOvertimeEndpoints`, passing them that infrastructure so no domain owns a second copy of a guarded literal.
- `parseRosterPDF` — the admin's roster upload → the parsed week for review; it writes nothing. It stays here because `roster-prompt-parity.test.mjs` reads the PDF prompt from this file. The PDF-grid read (`roster-geometry.js`) is started and awaited, bounded, BEFORE the model call; a usable cell table picks the cell prompt (`roster-prompt.js`); the request settings are `MODEL_REQUEST`; and the geometry witness is applied LAST, after every model-side repair. The response carries `parsed`, `choices`, `missingMembers`, `geometry` and `geometryRefused`. The pipeline's contract is `.claude/rules/roster-import.md`.
- `unlockCalendarViewer` — the staff Calendar PIN exchange. Its handler source, secret binding and no-log rule are pinned to this file by `calendar-viewer-parity.test.mjs`; the rules it applies are `functions/calendar-viewer-auth.js`.
- Both handlers are EXECUTED by `index-endpoints.test.mjs`; `functions-surface.test.mjs` proves only that they exist.

### `index-endpoints.test.mjs`
Drives the two handlers `functions/index.js` keeps — `parseRosterPDF` and `unlockCalendarViewer` — for real: their rules were exemplary while nothing asked whether the handler calls them, in order, and acts on the answer (CLAUDE.md → "The rule tested, the wiring not"). Organised by what a wrong answer costs: every refusal of the roster parser asserts the MODEL WAS NOT ASKED, and the PIN tests cover the uncounted guess, both throttle ceilings, concurrent guesses, a rebuilt tampered viewer account and the minted token's single claim. It also pins `MODEL_REQUEST` through the real SDK against a local server. The fakes enter `require.cache` before `index.js` is required, and every fake RECORDS. Runs in `npm run test:functions`; its header names the mutations it was checked against.

### `functions/documents.js`
The document-and-notification domain. `buildDocumentEndpoints(deps)` — a factory taking the shared infrastructure from `index.js` (secrets, the VAPID public key, `STAFF_SITE_URL`, `readRawBody`, `nowInLondon`, the caps); `index.js` re-exports what it returns under the same names, and a handler not re-exported there does not exist to Firebase.
- `getDocumentUrl` — POST `{ kind }` with a bearer ID token → `{ url, expiresAt, fileType, storagePath }`, a short-lived signed url for the LATEST document of that kind. The caller names a KIND, never a path (`functions/doc-url-core.js`), and the door mirrors the `firestore.rules` read. A 503 is what a missing `roles/iam.serviceAccountTokenCreator` grant looks like (CLAUDE.md).
- `ingestHuddle` — Power Automate → Storage and Firestore: timing-safe bearer auth, base64 and file-signature checks, DOCX → HTML through a lazy `mammoth`, and a create-or-notify transaction; it awaits the three-month `pruneOldHuddles` before it responds.
- `onHuddleCreated` (the push for a manual admin upload; it skips `power-automate`, which `ingestHuddle` already notified) · `onCircularCreated` · `onNewsletterCreated` — `onDocumentCreated` triggers, each pushing its document-arrival notice through `buildPushPayload` and `fanOutPush`.
- `sendPayReminderNotification` (daily at 08:00 London; pushes on pay-cutoff Saturdays) · `sendTimetableReminder` (daily at 18:00 London; sends once, the evening before `TIMETABLE_CHANGE`, landing on `trains.html`).
- `HUDDLE_PUSH_PAUSED`, the Huddle push kill switch, lives here.

### `functions/auth-endpoints.js`
The account-and-credential domain. `buildAuthEndpoints(deps)` — the same factory pattern; the pure decisions it orchestrates are unit-tested in `roster-parse-helpers.js`. `unlockCalendarViewer` is deliberately NOT here (`index.js`).
- `setupRosterAuth` — creates the roster's Firebase Auth accounts and sets each tier's claims (`{admin,name,member}`, `{manager,name,member}` or `{name,member}`, plus `linksDesigner`; admin outranks manager). **The member and role lists are SERVER-OWNED** — `roster-members.json`, generated from `roster-data.js` and CI-locked — and never the request body, which carries only action flags. It fails closed on an empty config, unions the role-holders into the processed set so a leaver sweep can never disable one, and previews leavers by default (`removeOrphans`); `confirmOrphanRemoval` disables them, revokes their tokens and releases their push records. Re-run it after adding a manager or designer, so their claim lands.
- `resetMemberPassword` — the admin break-glass: resets a member to their surname default (`nameToPassword`), optionally revokes their refresh tokens, stamps `passwordStatus.resetAt`, and tells the MEMBER on their own devices (`sendTargetedPush`, to the uid the handler already holds; the payload never carries the password). `revoked`, `stamped` and `notified` are reported separately: the credential has already changed, so a later stage failing never reports the reset as failed.
- `requestPasswordReset` — one of the two public unauthenticated endpoints (with `unlockCalendarViewer`): records a locked-out member's request (the document id is the member's name, so the collection is bounded by the roster), throttled in a transaction, behind the `RESET_REQUESTS_ENABLED` kill switch, and tells the admin through `sendTargetedPush`.
- `getSignInStats` — admin-only: the exact unique sign-in counts from Firebase Auth's `lastSignInTime`, over the server-owned roster; four integers, no identity.
- `getAccountSetupGaps` — admin-only READ: who has no account, a disabled one or the wrong claims, and which roster-domain account is still enabled for a leaver. **It returns NAMES**, grouped by remedy (`setUp`, `leavers`); `summariseAccountGaps` makes every judgement, including the refusal when no roster account is visible at all.

### `functions/calendar-viewer-auth.js`
The PURE server rules behind the staff Calendar PIN — CommonJS, kept apart from `req`/`res` so they are testable (`calendar-viewer-auth.test.mjs`); the uid and claim agreement across the browser, CommonJS and `firestore.rules` is `calendar-viewer-parity.test.mjs`.
- Exports: `isValidPinShape` · `pinMatches(a, b)` · `sourceKeyFor` / `clientIpOf` · `throttleDecision` / `recordFailure` / `isThrottleStateStale` · `reserveAttempt` / `refundAttempt` · `viewerAccountTamper` / `isViewerAccount` · `viewerClaims()` (the one claim set the minted token carries) · `CALENDAR_VIEWER_UID` · `PIN_LENGTH` · `DEFAULT_THROTTLE` · `GLOBAL_SOURCE_KEY` / `GLOBAL_THROTTLE`.
- **The PIN is never learnt, stored, logged or returned** — no "which digit was wrong" and no input echo. **The throttle is sized against a real tension**: 10,000 combinations on one side, the whole station behind one corporate address on the other; read `DEFAULT_THROTTLE`'s comment before changing a number in either direction. The source key comes from the END of `x-forwarded-for`, which a caller can only prepend to.
- **Every attempt is charged BEFORE its compare**, in the transaction that checks the block (`reserveAttempt`), and a right PIN is refunded afterwards (`refundAttempt`), so concurrent guesses cannot all be compared uncounted; a refund to zero deletes the row, so the store cannot count usage. `viewerAccountTamper` names a shared account somebody linked a way in to (the unlock rebuilds it); `isViewerAccount` keeps Set up accounts and the leaver sweep off it.

### `functions/push.js`
The web-push TRANSPORT: how a payload reaches a phone, never what it says or when — that is `buildPushPayload` (`roster-parse-helpers.js`) and `.claude/rules/notifications.md`.
- `getWebPush()` (the lazy `web-push` require) · `setupWebPush(vapidPrivate, vapidPublic)` (once per instance) · `fanOutPush(payload, logTag)` — every subscribed device · `sendTargetedPush(payload, ownerUids, logTag)` — named uids only · `releasePushForOwner(uid)` — deletes the records one account owns, the leaver sweep's last step (an empty uid touches nothing) · `pushSendOptions(payload, timeoutMs)` / `PUSH_TTL_BY_TAG` — how long a push service may hold each feature's notice; a new feature adds its tag or gets a day.
- **`sendTargetedPush` fails CLOSED at every step**: no target uids → nothing sent; a record with no `owner` → skipped, never assumed; no matches → log and stop. There is deliberately no fall-back-to-everyone branch, because the notice that needs it is "N. Surname is locked out".
- Both senders skip any endpoint `isAllowedPushEndpoint` refuses, and delete a record only on a 404 or 410 (`shouldDeleteSubscription`), never on a 401.

### `functions/roster-geometry.js`
What the roster PDF's OWN GRID says about where each cell is, and the one refusal that follows: the only check in the import the model cannot influence, because the table's rules are DRAWN. CommonJS; the header holds the measurements, the hazards and the pdfjs brief. Tested by `roster-geometry.test.mjs` through the REAL pdfjs, on a PDF the test writes by hand.
- `extractRosterGeometry(pdfBytes, {loadPdfjs?})` → `{ available, reason?, rows, pagesRead, pagesRejected }` — the only code that touches pdfjs, dynamically imported. **It never throws**: `pdfjs-unavailable`, `unreadable-pdf`, `no-grid`, `no-text` and `work-budget` (a deadline checked between pages, keeping the pages already read) are each a fail-open reason.
- `rulesFromOperatorList(ops, OPS)` → `{ vx, hy }` — the stroked rules, clustered to 2px · `assignRunsToGrid({ items, vx, hy })` → rows of seven cells, or null unless the page has exactly `GRID_COLUMNS` vertical rules; the print footer and header furniture are filtered out.
- `matchGeometryRow(memberName, rows)` — exactly one row or null; a duplicated name is NO signal (`Vacant` appears three times on a real sheet).
- `applyGeometryWitness(safeEntries, geometry, dates)` → `{ status, refused, checked, total, unmatched }`. **An AI day the physical cell cannot support is REFUSED, not weighed**: a claim on an empty cell becomes `UNKNOWN|…` and the member's whole row is reported, so the review unticks it. It cannot see a fully occupied week, or an `RD` in an occupied cell.
- `geometryCoverage(stats, reviewedNames)` → `{ status, checked, total }` — recounted over the rows the admin will see, so an invented name cannot inflate the denominator.
- `awaitGeometryWithin(promise, ms?)` / `GEOMETRY_WAIT_BUDGET_MS` / `GEOMETRY_WORK_BUDGET_MS` / `settledGeometry` — the bound is on the WAIT, not the work; a timed-out wait fails open, and `settledGeometry` re-asks a `wait-timeout` (and only that) before the witness runs.
- **`pdfjs-dist` is pinned to v4**: this file reads `OPS.constructPath`'s argument shape, which pdfjs changed at 5.1.91, and on a later version every document reports `no-grid` with no error. The header is the brief for that rewrite. `_isClaim` and `_nameTokens` are test seams.

### `functions/roster-other-days.js`
What a roster cell reads as when it names an Other-family day — Training, Induction, Assessment, Team Day, Union course, Meeting (OTHER_DAYS.md). CommonJS, requires nothing; `normaliseShift` asks it before any time is read. A deliberate duplicate of the RECOGNITION side of the client grammar (`_OTHER_RE`, `override-utils.js`), because CommonJS cannot import a browser module.
- `OTHER_DAY_ALIASES` — the roster's words → the sentinel, an explicit table. **Each sentinel is also its own alias**, because the prompt asks the model to return the sentinel.
- `readOtherDayCell(s, workedRange)` → the canonical value, or null when the cell is not a clean Other-family cell: a bare flavour with an RDW marker on either side, or a MEETING with one time range in either order (`meetingWithTimes`). **A meeting is always a meeting** (owner decision); the other five keep the no-times rule.
- `namesMeeting(s)` — whether a cell names a meeting anywhere; `normaliseShift` sends such a cell to review rather than keep its time and drop the code.
- Tested by `roster-parse-helpers.test.mjs` (including that its sentinels equal the client's `OTHER_FLAVOURS`), through the handler by `index-endpoints.test.mjs`, and against the prompt by `roster-prompt-parity.test.mjs`.

### `functions/roster-sunday-repair.js`
Layer 1 of the day-drift defence, the Sunday-anchored repair, and what happens to a Sunday it could not repair. CommonJS; requires `cell-day-rules.js` and `roster-parse-helpers.js`, and only `functions/index.js` requires it. The contract is `.claude/rules/roster-import.md`.
- `applySundayScanCorrections(entries, sundayScan, hasSundayCol, dates)` → the DISPUTED members. Case A — the blank Sunday dropped and the row one day left — is right-shifted back only when the Saturday slot holds the blank-Saturday question `buildSafeEntries` writes; a Saturday reading `RD` is a printed rest code, so that row is disputed instead. Case B is a stripped RDW marker. A printed `OFF` Sunday is a rest day, never a Case A claim. A disputed row keeps its Sunday claim, because overwriting it with `RD` would erase the one value the geometry witness can refuse.
- `settleDisputedSundays(entries, disputed, geoStats, dates, sundayScan)` — AFTER the witness: a Sunday it refused is already a question; one the grid shows as occupied keeps the row read only when the scan saw a literally empty cell; anything the witness could not look at becomes `UNKNOWN|…` for review.
- The wiring is pinned by `index-endpoints.test.mjs`, the rules by `roster-parse-helpers.test.mjs`.

### `functions/roster-prompt.js`
The two roster-parse prompts, the ONE vocabulary they share, and how the model is asked. CommonJS; the header holds the phase-2 argument and its measurements. Tested by `roster-cell-read.test.mjs` (`test:functions`) and `roster-prompt-parity.test.mjs` (hygiene).
- `SHIFT_VOCABULARY` — the code table. **There is exactly one copy**: both prompts interpolate it, and `roster-prompt-parity.test.mjs` reads it here, holding every code the prompt names, and every value it tells the model to return, to what `normaliseShift` accepts.
- `buildCellTable(geometry, memberNames)` → `{ usable, reason, rows, matched, unmatched }` — the grid's cells for the members this roster covers. **All or nothing per document**: one member the grid misses falls the whole document back to the PDF path. `renderCellTable(rows)` — the table as the model sees it, JSON, each cell labelled with its day inside the row · `buildCellPrompt(rows)` — the phase-2 prompt: the day of every cell is already decided and is not the model's to change.
- `reviewBlankReadsOfFilledCells(safeEntries, parsedMembers, cellRows, dates)` — an EMPTY read of a cell the grid shows holding something other than a rest marker becomes a review cell naming what it holds · `reviewRestReadsOfEmptyCells(safeEntries, cellRows, dates)` — a rest day read for an EMPTY weekday cell becomes a review cell too (a blank Sunday is a rest day, so Sunday is left alone). Neither counts as a witness refusal or feeds the drift breaker.
- `MODEL_REQUEST` — the frozen request settings: the model, thinking as far off as the model allows, the effort and `max_tokens`. Its JSDoc says why each is set, and `index-endpoints.test.mjs` pins them through the real handler and SDK, because no stub raises the model's 400. `DECLINED_ERROR` — what the admin reads when the model declines; a decline is not an unreadable answer, and a retry cannot change it.
- `DAY_LABELS` — the day names the table and its review messages use. Wired in `functions/index.js`, where `cellTable.usable` picks the prompt.

### `functions/roster-parse-helpers.js`
Pure helpers for the Functions — no Firebase, no HTTP, no secrets — required across `functions/`. **Its `module.exports` block is the list**; the families are below. Tested by `roster-parse-helpers.test.mjs`. Read `.claude/rules/roster-import.md` before changing a parse helper.
- **Reading a roster:** `normaliseShift(raw)` — a model's cell → the app's value: times, the `RDW|HH:MM-HH:MM` pipe encoding (never strip `RDW` from the model's answer), the status codes (`NA` and `NS` → `RD`) and the Other days through `roster-other-days.js`; a non-empty cell it cannot read becomes `UNKNOWN|<raw>` · `buildWeekDates(weekEnding)` · `extractAIJson(text)` · `HEADER_TO_INDEX` / `headerToDayIndex(header)`, the one header resolver for every parse layer · `mapColumnHeadersToDates(headers, dates)` · `buildSafeEntries(parsedMembers, headers, dates)` — seeds a missing or empty day through `blankCellMeaning`, then normalises · `applyColumnScanCrossCheck(...)` (layer 2), `normaliseScanValue`, `reviewLabel`, `parseStrictIsoDate`, and `BLANK_CELL_TOKEN` / `isPhysicallyBlank` re-exported from `cell-day-rules.js`.
- **Files and dates:** `fileSignatureMatches(buffer, fileType)` — a PDF must start `%PDF`, a DOCX `PK` · `isPayCutoffDay(date)` — mirrors `isCutoffDate` in `roster-data.js`.
- **Credentials:** `nameToEmail(fullName)` / `nameToPassword(fullName)` — the CommonJS twins of `auth-identity.js` (`surname-parity.test.mjs`).
- **Push:** `NOTIFICATION_FEATURES` / `buildPushPayload(...)` — the only way a payload is built (`.claude/rules/notifications.md`) · `shouldDeleteSubscription(statusCode)` (410 or 404 only) · `isAllowedPushEndpoint(endpoint)` / `PUSH_SERVICE_HOSTS` — HTTPS, default port, no credentials, a known push-service host; anything else is skipped, never deleted, so a new browser's push service must be added here · `buildResetRequestNotice(member, pending)`.
- **Accounts:** `parseSetupActionFlags`, `resolveRosterAuthConfig`, `claimsForTier`, `computeOrphanLabels`, `summariseAccountGaps`, `shouldRecordResetRequest`, `shouldNotifyAdmin`, `summariseSignIns` — the decisions `auth-endpoints.js` orchestrates.

### `calendar-notif-prompt.js`
The Calendar's one-off notification prompt strip (`#notifPrompt`) and the silent subscription renewal for a device that already granted permission. The auth promise and the access-type reader are injected. Tested by `calendar-notif-prompt.test.mjs`.
- `initNotifPrompt({ authReady, getAccessType })` — permission granted → renew through `getNotifState()` and show nothing; never asked → show the strip once per device (`NOTIF_PROMPT_DONE`); denied → nothing. Both halves run for `named` access only and **never for the shared PIN viewer**, whose uid is the same on every office PC, so a renewal there would re-stamp a real member's subscription `owner`. It is gated on auth, not access, because re-subscribing is a Firestore write.
- Two orderings the header pins: `notifSupported()` before any read of `Notification.permission` (a plain iOS Safari tab has no `Notification`), and `requestPermission()` inside the tap before any `await` (WebKit refuses a request with no gesture).
- Wired by `calendar-app.js` before `initInstallPrompt`, which hides this strip when it shows its own; neither shows once the install notice has taken the visit (`installNoticeHasTheVisit`).

### `install-prompt.js`
The one-off "add the roster to your home screen" strip on the Calendar. It shares the notification prompt's markup and slot so the two can never appear together, and install outranks notifications because on iOS `notifSupported()` is false until the app is installed. The header carries the argument, and the limit it deliberately does not rescue. Tested by `install-route.test.mjs`.
- `initInstallPrompt({ accessReady, getAccessType })` — injected, as in `calendar-notif-prompt.js`.
- **The two platforms are different features.** Chromium fires `beforeinstallprompt` (single use; `preventDefault()` keeps it) → a real button. WebKit fires nothing, and the only route is Share → Add to Home Screen, so the strip gives instructions on the app's own judgement.
- **Three populations are never asked**: the shared PIN viewer (a station, not a person), anyone already in the installed app, and anyone on the Pages mirror — an offer there would create new installs on the address the app is leaving.
- **Mobile-only is a BEHAVIOUR, not a layout**: the width test runs before the event is captured, because `preventDefault()` suppresses Chrome's own promotion. The breakpoint is read from `--prompt-available` in `index.css`.
- **The install NOTICE** (`calendar-notices.js`) asks through it: `installRoute()` → null (a fine pointer, or the installed app) or `{ how: 'prompt'|'ios'|'menu', mirror }` (a touch screen is `(pointer: coarse)`, and `how` is never `'prompt'` on the mirror) · `promptInstall()` — spends the ONE held offer; call it first in a click handler · `yieldToInstallNotice()` — the strip and the notification ask leave the screen for the visit, unflagged · `installNoticeHasTheVisit()` — whether that has happened, which both strips check before showing · `retireInstallStrip()` — the member answered the notice, so the strip does not ask again.

### `text-scale.js`
How much larger than the stylesheet's sizes the phone actually draws its text, and the two-tier stamp the Calendar's control rows key on. Android's font and display scaling enlarges text and leaves the viewport alone, so no width query can reach the state where five buttons stop fitting — and the owner did not want two rows. Tested by `text-scale.test.mjs`; the probe itself in `e2e/calendar.spec.js`.
- `LARGE_FROM` / `LARGE_VALUE` · `COMPACT_FROM` / `COMPACT_VALUE` · `tierFor(scale)` → null · `'large'` · `'compact'` · `isCompact(scale)` · `measureTextScale(doc)` · `applyTextScale(doc)` (stamps `data-text-scale` on `<html>`).
- **The probe IS the measurement**: a hidden 16px element's rendered height is the scale, whatever the OS calls the setting. **It cannot throw** — `calendar-app.js` calls it at module scope, and every fallback returns a value that is never `'compact'`.
- `'large'` tightens the month heading row; `'compact'` tightens the action row as well. **Compact is the step BEFORE the wrap, never instead of it.**

### `calendar-doc-access.js`
May this Calendar read the documents? The Daily Huddle, Weekly Retail Circular and Marylebone Newsletter are visible only with the staff PIN or a password (an owner decision — CLAUDE.md). `firestore.rules` enforces that on the server; this makes the client honour it, because a read the local cache can answer never consults the rules. No imports. Tested by `calendar-doc-access.test.mjs`.
- `hasDocumentAccess()` · `setDocumentAccess(open)` (only a literal `true` opens it; subscribers hear once per CHANGE, never on a no-op) · `onDocumentAccess(fn)` → unsubscribe · `documentAccess` — the frozen `{ has, onChange }` handle the viewers take · `_resetDocumentAccessForTests()` (test seam).
- Opened by `calendar-app.js` on every grant (`onEveryGrant`) and shut on every access-lost path; a deliberate Lock reloads, so the default applies.
- **Subscribers, not just a flag**: the Huddle viewer's live subscription has to START when access arrives (a notification tap that met the PIN card opens the Huddle once the PIN is in), and a Circular tap made while locked is finished on unlock.
- Consumers: `calendar-huddle-viewer.js` and `calendar-doc-viewer.js` (`docAccess`), and `nav-panel.js` (`canReadDocuments`, which refuses before the blank tab opens). Every other page keeps the default, which is always open.

---

## What NOT to do

| Temptation | Why not |
|-----------|---------|
| Read `roster.data[week][day]` directly | Bypasses `startDate` suppression and the Christmas rules. Always use `getBaseShift()`. |
| Add DOM access to `paycalc-calc.js` | It must stay importable by the Node test runner. |
| Add DOM access to `paycalc-roster-suggestions.js` | It must stay free of circular dependencies with `paycalc-app.js`. |
| Hardcode hex colours | Use CSS variables — every colour lives in `:root` in `shared.css` (the guide pages: `guide-shell.css`'s own `:root`). `css-hex-parity.test.mjs` fails on a raw hex. |
| Import Firebase in `paycalc-calc.js` | Same reason as above — test-runner compatibility. |
| Use `alert()` | Use `console.error()` for developer errors; never show raw errors to staff. |
| Skip the version bump | Browsers will serve stale code. CLAUDE.md → "Version bumping". |

---

## Version bump checklist

The rules are CLAUDE.md → "Version bumping (MANDATORY on every change)". In short: `npm run bump <version>` (`scripts/bump-version.mjs`) updates the two runtime locations — `APP_VERSION` in `roster-data.js` (authoritative) and the `APP_VERSION` const that names the cache in `service-worker.js` — and neither is ever hand-edited. The step is exactly 0.01, and the version is bumped against `main`, not against the branch you started from.
