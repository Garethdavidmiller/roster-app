# AI_MAP.md — Claude routing guide for MYB Roster

*Last updated: November 2026 — v25.90 · Updated every 0.10 version*

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
| The Calendar page's one-time notices (which are live: the new-notice skill → "Current notices") | `calendar-notices.js` |
| Calendar member selection — getSelectedMemberIndex, getCurrentMember, populateTeamMemberDropdown, validateTeamMembers | `calendar-member.js` |
| The phone's text scale, measured rather than asked, for the Calendar's control rows — LARGE_FROM, LARGE_VALUE, COMPACT_FROM, COMPACT_VALUE, tierFor, isCompact, measureTextScale, applyTextScale | `text-scale.js` |
| Calendar rendering — buildCalendarContainer, createCalendarHeader, createDayCell, dayCellParts, dayCellName, getSwipeDirection | `calendar-renderer.js` |
| The month legend — which keys apply, and whether it shows at all | `calendar-legend.js` |
| The document gate on the Calendar — may the Huddle, Circular and Newsletter be read (opened on the grant, shut on access lost) | `calendar-doc-access.js` |
| Whether Calendar access is HELD right now — the one copy the roster gate and the document gate both read | `calendar-access-state.js` |
| WHEN the Calendar page may draw — the start-up stage, the one wait for a swipe, the focus owed to the next grid | `calendar-redraw.js` |
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
| Document links card (ops page) — a new key for every stored Huddle, Circular and Newsletter file, so every old copy of a link stops working | `operations-doc-links.js` (the card) · `functions/documents.js` (`rotateDocumentLinks`, the endpoint) · `functions/doc-link-rotation.js` (the rules) |
| Links design workspace — the rotation design grid (`ROTATING_LINES` lines), paint mode, hourly coverage heat map, design checks, auto-generator UI | `links-app.js` + `links.html` + `links.css` |
| Link-design maths — shift classification, custom-time validation, coverage counting (per-type + hour-by-hour), rotating-window generator, design quality checks | `links-design.js` (pure — no DOM/Firebase; tested by `links-design.test.mjs`) · `runDesignChecks(patterns, rotatingLines)` returns `{ weekendsOff, weekendsOffPct, totalWeeks, unfilledLines, turnarounds, longestStretch, balance }` |
| Annual Leave Booking section | `admin-al.js` |
| Which AL days consume entitlement, and a member's taken/booked/remaining position | `al-entitlement.js` (pure — no DOM/Firebase; tested by `al-entitlement.test.mjs`) |
| CHRISTMAS LEAVE — who is shown on leave on 25/26 December, never counted, and the Boxing Day day in lieu | `christmas-leave.js` (pure; `christmas-leave.test.mjs`) · the whole allowance `entitlementFor` in `al-entitlement.js` |
| WHICH YEAR'S ALLOWANCE a day of annual leave comes out of — a January day may be moved to the year before | `leave-year.js` (pure, no imports; `leave-year.test.mjs`) · Admin panel `admin-leave-year.js` · its save `admin-leave-year-save.js` |
| WHICH YEAR the Admin AL figures describe, when four surfaces each imply one | `admin-al-year.js` (pure — no DOM/Firebase; tested by `admin-al-year.test.mjs`) |
| The recorded-DATES list on Admin, and which year of it is shown | `admin-booked-periods.js` (imports only `leave-year.js`; tested by `admin-booked-periods.test.mjs`) |
| Sick Days Recording section | `admin-sick.js` |
| Huddle upload (admin-only, operations page) | `huddle.js` → `initHuddleUpload` |
| Push notifications card (all staff, settings page) | `huddle.js` → `initHuddleNotifications` |
| Staff Firebase Auth account setup card | `admin-auth.js` |
| Change a Shift — week grid, override entry, bulk bar, save logic | `admin-week-editor.js` (week grid, bulk bar) · `admin-shift-types.js` (`PILL_TYPES`) · `admin-overrides.js` (save logic) |
| An Admin save or delete must not overwrite a colleague's newer edit — the checked commit, and what counts as changed | `admin-override-store.js` (`commitChecked`, `commitIfUnchanged`, `deleteIfUnchanged`) · `override-compare.js` (`sameOverrideRecord`) · `admin-week-row-state.js` (what each row showed) · `admin-own-write.js` (the page's OWN write is not a colleague's: the rows it touched follow it) · the weekly roster import's Save: `roster-import-save.js` (`saveRosterWrites`) |
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
| Cloud Functions — the composition root (`functions/index.js`); documents and the Huddle ingest (`functions/documents.js`), the Huddle's retention (`functions/huddle-retention.js`); accounts and the PIN (`functions/auth-endpoints.js`, `functions/calendar-viewer-auth.js`); push (`functions/push.js`) | `functions/index.js` |
| Railcard at-work reference — cards, GroupSave, season tickets, gateline checks | `railcard-guide.html` + `railcard-guide.css` |
| Print button for every guide, and the FIP per-country print buttons | `guide-print.js` |
| Guide back-arrow retarget (`?from=` → the page you came from, every guide) | `guide-back.js` |
| The "Jump to section" chip bar — jump, scrollspy, sticky offsets, a deep link landing below them (Railcard, Rangers, Staff and Pay Calculator guides) | `guide-chips.js` |
| An old guide address (`guide.html`, `fip.html`) keeping its `#fragment` and `?query` on the Pages mirror | `legacy-redirect.js` |
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
  `cesRoster` · `dispatcherRoster` · `FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS` (from `roster-cycle-data.js`) — world-readable (CLAUDE.md → teamMembers).
- **Base shifts.** `getBaseShift(member, date)` — **always use this, never read `roster.data`**; it
  applies start-date suppression, roster changes and the Christmas rule. `getPatternShift(member, date)`
  — the same lookup without the Christmas rule, for the Christmas leave rules only (`christmas-leave.js`).
  Both read a bank holiday on a fixed pattern that rests on them (`fixedRoster[4]`) as RD, so the
  Calendar, a Dispatcher's days in lieu and Christmas leave agree (v25.97).
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
  record — including a year before the member's `startDate`: test for it, because `null - taken - booked`
  is a number). Read the whole allowance through `entitlementFor` (`al-entitlement.js`), never this
  (`christmas-leave.test.mjs`). `dispatcherBaseAL(member, year)` — a Dispatcher's leave before days in
  lieu (the joining year's `proRatedAL`, else 22), the one base the allowance and `dispatcherBreakdown` share.
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
  while the first read runs) and shows the stale-member banner (`takeStaleMemberName`). A press the
  reader made calls it directly.
- **`redraw`** (`calendar-redraw.js`) decides WHEN anything else draws: every background repaint goes
  through `redraw.repaint(why)` and the name picker through `redraw.nameChanged()`, so neither lands
  under a swiping finger; the start-up stage (`reach` / `reached`) tells a first grant from a
  re-unlock and says when the "usable" timing may measure. `_repaintAfterMonthRead()` is the one
  callback every month read repaints through — one identity, because the read keeps its waiters by it.
  This file asks whether a gesture is live in one place only, the hand-over to the scheduler; its
  buttons and keys still stand down during a swipe's animation (`isSwipeCooldown`).
- `navigateToPaycalc(paydayStr)` — the one route to the calculator (`?payday=`) and its one gate,
  `personalActionsAllowed`; it returns whether it went, so a refused Enter falls through to the day
  panel. It never diverts to a sign-in: Pay signs in in place.
- `changeMonth(delta)` · `retryMonth(year, month)` (the month panel's Try again; it also withdraws a
  recorded sync failure) · `updateLegend()` (delegates to `calendar-legend.js`).
- **Access hooks** (`initCalendarAccess`): the grant itself opens the roster reads and the documents
  before either hook runs (`calendar-access.js`). `onEveryGrant` clears a viewer's stored copy and
  repaints a re-grant; `onGranted` runs once — the workspace, the claim sweep and the forced
  set-password step, which the notices queue behind. Both ways of losing access end in
  `handleAccessLost`, wired once at module scope beside the listener that clears the member's stored
  copy on a loss. This file writes neither gate.
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
- `persistViewedMonth()` — stores the position after each render; the CURRENT month is cleared
  rather than stored, so a month that has ended is never restored as though it had been browsed to.
- `watchLocalDate(onChange, env?)` → a stop function — fires when the device's local date turns (on
  resume, and at local midnight while open), so a PWA resumed next morning stops highlighting
  yesterday. A display on the month the old date fell in is moved to the new date's month first, so
  a page open over a month end shows the new month. Tested by `calendar-state.test.mjs`.
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
  the carousel's panels. One place asks it, `calendar-redraw.js`, which holds what has to wait.
- `isSwipeCooldown()` — true while a swipe animation runs; the buttons and keyboard wait for it.

### `calendar-al-lightbox.js`
The Calendar's annual-leave panel and its day-detail panel — the only place a touch user reads what a
day is. The reasoning sits beside each step, in `index.css` (layout) and in `index.html` (markup).
- `initCalendarLightboxes({ navigateToPaycalc })` → `{ openDayDetail, closeALLightbox }`.
- **Leave panel.** Reads the member's own `annual_leave` overrides (one member, to the end of next
  January) and counts them with `countedAlDates`, `entitlementFor` and `entitlementNote`
  (`al-entitlement.js`), adding the carry line (`leave-year.js`) and the Christmas line
  (`christmas-leave.js`). A last-known-good memo per member and year paints at once, labelled as the
  saved copy until a read confirms it; a refresh that fails, or that the offline cache answered, keeps it
  under "Saved copy — couldn't check for changes". On a first run (no name chosen) it shows nobody's
  figures and asks for a name. A `null` entitlement shows the em-dash state. The panel
  has its own year (‹ ›), opening on the Calendar's, and names whose leave it is (`#alLbWho`, and the
  dialog's own name) from the same member its figures are counted for — on every open, because the
  member picker moves under a page that is never reloaded.
- **Day panel.** Filled from the cell's `data-detail-*` attributes (`calendar-renderer.js` writes them):
  the date and roster week, the shift with its kind glyph, the change as two badges built from
  `shiftBadgeParts` with `textContent` (never markup from an attribute), who last saved it, "As rostered"
  only where the renderer earned it, the day markers as chips, and the leave-year and Christmas lines.
  Closing it after the grid was rebuilt behind it returns focus to the same day.
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
  "Updating…") when the month panel's Try again takes over; the chip also withdraws a failure itself
  once the month on screen has been confirmed since.
- Chip: hidden → "↻ Updating your shifts…" after 800 ms → "⚠ Couldn't update — try again" at the
  timeout. A press says "↻ Retrying…" for at most `RETRY_TIMEOUT_MS`, then gives the control back. The owed state is `_chipState`, not the DOM, and a `MutationObserver` puts the chip back
  whenever a header rebuild takes it away (beside `setChipState`).
- **Whose outcome is it** (`standing`, internal). The boot's read and each retry are ATTEMPTS, each
  under a read ticket; before acting on an outcome (a failure, either time limit, the cache's early
  paint) the first load asks: `'overtaken'` (a newer attempt began: touch nothing), `'superseded'` (the
  access it began under has gone: `standDown` — the chip goes, nothing is recorded, and the months are
  handed to whoever holds the Calendar now) or `'current'`. Whether a load has already SUCCEEDED
  (`_dataLoaded`) is asked separately, where a retry could follow one.
- Coming back into view, a bfcache restore and — while the page stays visible and holds access — every
  `STALE_MONTH_MS` release months older than that so they are re-read behind the grid
  (`releaseStaleMonths`, `CALENDAR_DATA.md` 18); a first load that failed over a saved copy owes those
  months a re-check on return (`oweRecheck`). Team View re-reads through `refetchTeamView`.

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
  including one after a re-lock, and first. `grant()` writes `calendar-access-state.js` BEFORE either
  hook and after the card has gone, so the roster reads and the documents are open when the first
  render runs — bundling the two hooks is the bug `grant()`'s comment describes. `paintBeforeDecision` shows the member's stored roster
  while the decision runs; `onAwaitingInput` hears when a card that needs typing goes up.
- `calendarAccessReady` — resolves on the first grant, never rejects. `calendarAuthReady` — when a
  WRITE can use the identity (today the same instant): writers await it, renderers the other.
- `getAccessType()` → `'named'|'viewer'|'none'` · `isViewerMode()`. Derived: the KIND this module
  granted, while the state says access is held — so it reads `none` the moment the state shuts, by
  whichever route.
- `unlockWithPin(pin, stillWanted?)` → `{ ok }` or `{ ok:false, kind, message }` — posts the PIN to
  `unlockCalendarViewer`, signs out anyone current (and refuses if that fails), switches to session-only
  persistence, signs in with the custom token and checks the claim before granting. The PIN is never
  stored, logged or held in module state. `stillWanted` is the card asking whether it is still on screen:
  asked after the waits, with a signed-in member, so an exchange left behind changes nothing (`superseded`).
- `lockCalendar()` — the drawer's Lock. Fails closed (throws if the viewer is still current) and reloads
  onto `#staff-pin`.
- `handleAccessLost()` — re-lock after a read refused because the session went: a member gets their own
  card, a viewer the PIN card. The ONE call for every route that loses access: it shuts the state
  first, so every gate is shut before a card goes up, and still owes the card when a refused month
  read has shut the state already.
- **Rules an edit can break:** the gate is structural — nothing is initialised while access is `none`,
  and `calendar-overrides.js` refuses reads on its own, because the local cache never consults the
  rules; sign the old identity out BEFORE changing persistence, and check the claim BEFORE granting; the
  boot's waits share one budget, `ACCESS_DECISION_BUDGET_MS` (`session.js`); a member is never sent to
  the PIN — a late-identity watcher keeps listening, and grants a staff-PIN session that restores late
  as the viewer, once its token carries the claim and never while the PIN card's own exchange runs; a
  held session tries a silent sign-in behind the skeleton for up to `SILENT_BEFORE_CARD_MS` before its
  card goes up; whichever recovery route grants
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
  `dismissSignInForm()` (on a grant: the come-back card's full-screen form, which is not in the slot —
  never the inline card, nor a form whose own sign-in is in flight) ·
  `resetUnlockFailures()` (on a grant) · `PIN_FIRST_HASH` (re-exported from `calendar-access-core.js`).
- `takePinFirst()` — was the PIN card asked for first (`#staff-pin`)? The boot asks once; the hash is
  removed whatever the decision, so a member never carries a station's bookmark into their Calendar.
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
`CALENDAR_DATA.md` 3–6, 16, 18 and 20 are its invariants.
- `rosterOverridesCache` — a `Map` keyed `"memberName|YYYY-MM-DD"`.
- **The read ticket — one rule for "is this answer still wanted?"** `issueReadTicket()` → `{ grant, seq }`,
  taken as a read is issued; `answerStillWanted(ticket, err?)` — only while the access it was issued
  under is still held (the same grant, not shut since), and never for a `READ_SUPERSEDED` failure. Once
  no, always no. Every outcome asks it first: a success, a failure, a time limit, a paint (here and in
  `calendar-initial-fetch.js`).
- `fetchOverridesForRange(startStr, endStr, ticket?)` — the authoritative server read, under its own
  ticket (`ensureOverridesCached` passes the one its month read was issued under). It reconciles each
  month slice only where no read issued LATER has written it (`_monthSlices`, a test seam). A snapshot the offline
  cache answered is merged additively and thrown as `SERVED_FROM_CACHE` (carrying `painted`, true only
  for a month this device once read whole — the `myb_cal_whole_months` record), so the month is recorded
  `cached` or `error` and released. An answer that lands after the access it was
  issued under has gone, or been replaced, commits NOTHING and is thrown as `READ_SUPERSEDED` — a
  caller stands down on it, and never records a success or reports a failure.
- `fetchOverridesForRangeFromCache(startStr, endStr, monthsWithRows?)` — phase 1: the local cache only,
  additive (never evicts), skipping months a server read owns; it names a month in `monthsWithRows`
  only where it held rows and this device once read it whole (a device with no record yet keeps the old
  rule); never throws, and paints nothing if access went while it was out.
- `ensureOverridesCached(year, month, renderFn)` — a no-op once the month is claimed; otherwise reads it,
  records what is now known, and calls back EVERY waiter when it settles (a caller arriving mid-read
  joins). A failure repaints once per claim, or it would be a fetch↔render loop — and always when it
  changes what the month is known to be, so a check that takes "current" away is drawn even after an
  overtaken failure spent that one repaint (found by `calendar-sequences.test.mjs`). A failed RE-check of a
  month this device holds the server's answer for keeps the grid as the labelled saved copy
  (`noteCheckFailed`) — only where no other answer has landed since the read was issued. A failure the
  ticket no longer wants (access gone since) records, repaints and reports nothing.
- `getShiftTypesInMonth(member, year, month, snapshot?)` — the legend's set (SPARE, RDW, AL, SICK, OTHER)
  through the shared `resolveDayShift`; memoised, except for a month drawn from the stored copy.
- `monthKey(year, month)` · `releaseStaleMonths(maxAgeMs, now?)` (releases settled months older than
  that — never one in flight, nothing during the first read — and hands back a saved-copy month whose
  last check failed, whatever its age, so its label clears on the next return that can check) ·
  `oweRecheck(keys)` (the first load's failure owes that re-check to its months drawn as a saved copy;
  a month with no copy is owed nothing).
- `_initialFetchInProgress` (a live binding) · `setInitialFetchInProgress(v)` · `addFetchedMonths(keys)` ·
  `clearFetchedMonth(key)` (it also re-arms the failure repaint) — for `calendar-initial-fetch.js`.
- **The access gate.** The answer is not kept here: every read asks `calendar-access-state.js`. This
  module LISTENS to it — a grant is a fresh start (every claim cleared), a shut clears no claim but
  forgets what every month was known to be — so both hold for every route. `hasOverrideAccess()` is
  the gate's read. It has no write of its own: the module's one write is a refused read SHUTTING the
  state as it notices, and nothing here can open it · `setOverrideAccessLostHandler(fn)` (injected, so
  this module never imports the access layer; the page passes `handleAccessLost`, which puts the card
  up). A ticket's grant number is the state's `grantNumber()`, compared only by `answerStillWanted`.
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
- `legendShown(display, isTeamViewMode, firstRun?)` → `'render'|'hide'|'stand-down'`. A withheld month
  hides it, and so does a first run (the prompt has no key); `'stale'` shows it, and `'stand-down'` is
  not `'hide'`: Team View owns the element, so write nothing.
- `createLegend(deps)` → `{ update }`. The shown/hidden answer belongs to the UPDATE, not to a render,
  because a swipe commit updates the legend without rendering (`e2e/calendar.spec.js`).

### `calendar-data-state.js`
What the Calendar KNOWS about each month's overrides, and so what it may show. Pure with no imports,
tested by `calendar-data-state.test.mjs`. The invariant — cache absence is not evidence that no override
exists — and the four states are argued in the header (`CALENDAR_DATA.md` 1–2).
- `noteKnowledge(keys, k)` — monotonic: a late `cached` never walks back an `authoritative`.
- `noteCheckFailed(keys)` — the newest check failed: `authoritative` → `cached`, nothing else moves. The
  caller owns the ordering (a failure older than the latest answer must not reach it).
- `forget(keys?)` — the other deliberate downgrade (access lost; a Try again).
- `knowledgeOf(key)` / `worstKnowledge(keys)` — a Team View week is as known as its less-known month, and
  an empty set is `unknown`.
- `decideDisplay(knowledge)` → `'render'|'stale'|'loading'|'unavailable'` · `showsRoster(display)` (a
  real roster is on screen for `render` and `stale`).
- `_reset()` — test seam.
- Written by `calendar-overrides.js` and `calendar-initial-fetch.js`; read by the renderer, Team View, the
  legend and the page-ready metric. A `cached` month draws its grid labelled "Saved copy — couldn't check
  for changes" with a Try again (not while the first check is still running, where the sync chip speaks
  alone); Team View draws a `cached` week exactly as a current one.

### `overtime-app.js` / `overtime-boot.js` / `overtime-data.js` / `overtime-format.js` / `overtime-clock.js` / `overtime-tips.js`
The Overtime availability page. **Paused:** `CONFIG.OVERTIME_ENABLED` is false, so the page says so to
everyone and the endpoints are not exported (`OVERTIME_AVAILABILITY.md` → Paused); the code and its
tests stay live. Feature design: `OVERTIME_AVAILABILITY.md`. Server: `functions/overtime.js`,
`functions/overtime-core.js`.

**`overtime-app.js`** — the coordinator: the access gate (a courtesy; the server is the boundary), the
member's form, the reviewer's workspace (`overtime-review-controller.js`), and a tab strip drawn only
once both surfaces are known to exist. `init()` is invoked by **`overtime-boot.js`** (CSP forbids an
inline call). The controller's header argues the two rules to keep: the planning horizon is drawn from the CALENDAR,
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
*Dates*, in Europe/London: `shortDate` · `longDate` · `weekLabel` · `weekSpan` · `weekDates` (a week's
seven ISO dates — the one client copy, for the form and the reviewer) · `printedLabel` (carries
the year: it stamps paper) · `asAtLine` · `declaredAgo` · `receiptLine`. *The form's rules:*
`dayUnfinished` / `unfinishedDates` (the count and the day an error walks to come from one list) ·
`reconcileVerdict` · `conflictIsOurs` · `writeOutcomeUnknown` (a timeout, a cut-off answer or a 5xx the
server did not name: re-read, never "failed" — every Overtime write asks it) · `modesFor` (shortcuts only where an authoritative duty time
exists; one both-sides answer a day; an overnight duty withholds `after` and `before_after`) ·
`offersFullTwelve` · `shiftSpanMinutes` · `sameAnswer` · `answerAnchorStale` · `submitFailureCopy`.
*Answers:* `answerCopy` · `answerTone` · `isUnavailable` · `isAvailableAnswer` (not `!isUnavailable` —
they differ on a missing day) · `rosterBadge` · `deriveHistory`. *Reviewer:* `rowStateCopy` ·
`countsCopy` (never drops "no response") · `weekAvailabilitySummary` (the clipboard
text; every section named, an empty one says "nobody"; it states its grade scope and "as at", as the
sheet does) · `gradeScopeLabel` (that scope line, shared with the printed sheet) · `reminderLine`
(from what the send reached, where the server recorded it) · `putBackWindow` (until when a Stop
asking pressed now can be undone — the restore rule's promise, in words) · `isWithdrawn` / `withdrawnLine`
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
  called from the member's side. A failed roster read does not fail the week: the roster comes back empty and each row's badge says "Roster unavailable".
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
- `renderWeekDetail(host, win, data, { dates, now, grade?, onGrade?, day?, onDay?, onRefresh?, onAsk?,
  refreshFailed?, printedAt? })` → `{ grade }` — the surface is a pure function of `(data, state)`;
  `refreshFailed` keeps a snapshot whose newer read did not arrive, and says so; the returned grade is
  the one it OPENED on (All grades when the carried grade is not in this week), which the card's chip counts.
- `stampPrinted(host, nowMs)` — restamps the sheet's "Printed …" line as it prints (`beforeprint`); iOS
  fires none for AirPrint, so there it keeps the paint's stamp.
- `refocus(host, attr, value)` → whether a successor was found — puts the keyboard on the control that
  replaced the one pressed (matched by value, so nothing needs escaping); `focusLost()` — focus fell to
  `<body>` rather than being moved on by the reader. Every press here repaints the workspace, so a chip,
  Refresh, and (in the controller) Stop asking, Ask again and the confirm bar's Cancel each hand the
  keyboard on rather than dropping it.
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
(`getDocumentUrl`) and `functions/doc-link-rotation.js` (`DOC_KINDS`, the three kinds it rotates);
the design and the options refused: `AUTH_PLAN.md` §5.
- `DOC_KINDS` · `kindFromBody` · `resolveKind` — the caller names a KIND from a frozen allowlist, never a
  path: an endpoint that signs what it is told is an arbitrary read of the bucket.
- `mayReceiveDocumentUrl(claims)` — MIRRORS `firestore.rules` for `huddles`, `circulars` and
  `newsletters`, pinned to the rules text in both directions by `doc-url-core.test.mjs`; it may never be
  more permissive.
- `isSignablePathForKind(kind, path)` — binds the resolved path to that kind's own collection, because the
  Admin Storage API bypasses `storage.rules`.
- `SIGNED_URL_TTL_MS` · `signedUrlExpiry(nowMs)` — sized to outlive the Office viewer's server-side fetch,
  not just a tap.

### `functions/doc-link-rotation.js`
A NEW key for the permanent download link of every stored Huddle, Circular and Newsletter file, so every old copy of the link stops opening it (`ARCHITECTURE.md` EXC-007). The bucket and Firestore are passed in, and it requires only `doc-url-core.js`, so `doc-link-rotation.test.mjs` runs in `test:hygiene`. Used by `rotateDocumentLinks` (`functions/documents.js`). Reasoning: its header.
- `rotateDocumentLinks({ bucket, db, rotate?, newKey, limit?, nowMs? })` → a report of counts and failures. A PREVIEW unless `rotate === true`. Per linked file: EXPAND (the new key beside the old) → MIGRATE (a transaction moves each record's `storageUrl`, only while it is still EXACTLY the link read) → CONTRACT (only the new key), so the stored link opens its file after every write. A file no record uses loses its key; nothing is ever deleted. Every file's keys are read FRESH, never from the listing (the header argues it); a record of a file in use whose stored link names a key that file no longer carries is counted in `recordsDeadLink`, and a run's MIGRATE gives it a working link like any other. The reads — the records, the file list, and a second read of the records before a run clears anything — finish before the first write and are the only place it throws, so a throw means nothing changed; a file whose keys cannot be read, and every failed write, is reported in `failed` (file and step) and the run goes on.
- **Two refusals keep it from breaking a link it was not asked to touch.** A file carrying a key that a stored link this cannot read names (another bucket name, another host, a record in the wrong folder) is HELD — counted in `held`, never written. And every key write is a compare-and-set (`ifGenerationMatch` + `ifMetagenerationMatch`): an upload or a second run landing mid-run gets a 412 — or a 404, for a file deleted mid-run — and is counted in `changedDuringRun`, never overwritten; so is a file whose every record somebody else rewrote mid-run.
- **An unused file may be an upload still in flight** (review, 13 Nov 2026). Both uploaders save the file, with its key, to a NEW path before any record names it, so an unused file loses its key only when it is at least `UNLINKED_MIN_AGE_MS` (a day) old — younger, or of unknown age, it keeps it and is counted in `unlinkedTooNew` — and only when the second read of the records, just before the first write, still finds no record naming it (otherwise `changedDuringRun`). The unused files are written first, straight after that read.
- **A refusal that was its own write is not a change.** Every key write goes through `writeKeys`, which reads a refused file back: the same object carrying exactly the keys this run wrote is counted as done, because the storage library retries a guarded write whose answer was lost and the retry is refused (412). The record transaction likewise counts a record already holding this run's new link as its own: Firestore re-runs a transaction whose commit answer was lost.
- `downloadUrl(bucketName, path, key)` · `pathOfDownloadUrl(url, bucketName)` · `keysOf(metadata)` · `TOKEN_KEY` — the link format, written and read in one place. `UNLINKED_MIN_AGE_MS` — how old an unused file must be to lose its key, and why that long: the header.

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
- `claimedByAnotherMember(user)` — the OTHER member an existing account's claims name, or `null` when
  the member they name derives to the account's own email (a respelling that still derives it is the
  same person; `{ admin: true }` names nobody). `setupRosterAuth` does not adopt such an account and
  `resetMemberPassword` refuses it (409).
- `unlinkOtherProviders(user)` — the `updateUser` field (`providersToUnlink`) that strips every sign-in
  method but the password from an account being taken back or re-enabled; `{}` when there is none.

### `functions/request-helpers.js`
The request plumbing every endpoint shares — one copy, because the five inline copies had drifted (a
Buffer body answered 400, a right PIN posted as a Buffer was charged as a guess, one gate wanted a
case-exact "Bearer "). Requires nothing at load time: `requireAdmin` requires `firebase-admin/auth`
when it runs, so the readers are tested in test:hygiene (`doc-url-core.test.mjs`).
- `jsonBodyOf(body, rawBody)` · `readJsonBody(req)` — the JSON body as an object whatever shape it
  arrived in (object, Buffer, string, or the raw bytes beside an empty body); anything unusable is `{}`.
- `bearerToken(req)` — the `Authorization: Bearer` token, the scheme in any case, or `''`.
- `requireAdmin(req, res, logTag?)` — no token is a 401 before anything is verified; otherwise
  `verifyIdToken(token, true)` (checkRevoked) and a strict `admin === true`. Answers 401/403 itself and
  returns null. Used by parseRosterPDF and the four admin account endpoints.

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
  creation, and stored) · `storedMilestones` (how every reader gets them back) · `toMillis` ·
  `phaseFor` / `isOpenPhase` (half-open: 12:00:00 belongs to the later phase) ·
  `validateWeekEnding` · `planningWeekEndings` · `weeksNeedingWindows` (the same filter as the Create
  button) · `windowRowState` (a missed week stays visible until its Saturday; a week past the
  roster's last year has its own state, `not-created-beyond-roster`) · `lastSchedulerRun`.
- **Who was asked:** `isEligibleForWeek` · `selectParticipants` (narrows the generated list, never widens
  it; a `restricted` audience with no names selects nobody) · `canChangeParticipation` ·
  `canRestoreParticipant` · `isWithdrawn` · `isSafeDocId`.
- **Answers:** `AVAILABILITY_MODES` · `REQUEST_DAY_FIELDS` · `OPTIONAL_DAY_FIELDS` · `normaliseDay` /
  `normaliseDays` (refuse a partial week or an unknown field; derive `nextDay`) · `daysEqual` ·
  `decideSubmission(head, days, ifRevision)` → `create`, `append`, `noop` or `conflict` — **the no-op check
  comes before the conflict check**, so a timeout retry succeeds · `publicHead` (what a member is shown
  of their own head) · `deriveHistory` · `revisionId`.
- **Notices:** `reminderDue` · `londonDeadlineLabel` · `askedNotice` · `reminderNotice` (the words are
  asserted through the real `buildPushPayload`).
- **Nothing here manufactures an answer:** no response is unknown, never "not available".

### `calendar-notices.js`
The Calendar page's one-time notices, in one place — a `/new-notice` for `index.html` lands here. The
notice HTML stays in `index.html`; which notices are wired and live: the new-notice skill → "Current notices".
- `initCalendarNotices({ after })` — called once by `calendar-app.js`. Every notice waits for
  `calendarAccessReady` AND `after` (the forced set-password step), then 1,500 ms past the Huddle
  auto-open, and opens through `openNoticeIfClear`, never `open()`.
- **Every notice declares an audience**, checked after access by `_openWhenAudienceAllows(lb, audience,
  alsoWhen?, whenDecided?)` against `noticeAudienceAllows`; a refused notice is left unflagged. `alsoWhen`
  adds a condition only knowable then (whose Pay Calculator this is — `gradeForRole`; whether the New link page would let them in — `canOpenNewlink`, auth-policy.js); `whenDecided` stands
  a competing strip down (`yieldToInstallNotice`).
- Each notice is its own IIFE: an early `return` in a plain block would leave the function and silence
  every later notice. The order comes from `FOLLOWS` flags read at wiring time, so two notices never open on one load; `FOLLOWS_PAY` and `FOLLOWS_INSTALL` wait only where that earlier notice is this member's or this device's to get. A notice
  with a `STARTS` date is left unflagged before it, and an end is a DATE (`isNoticeExpired(day, 1)`), not a
  count from posting.
- No live notice declares `'signed-out'`, so the positive direction of the audience gate rests on a
  static contract in `calendar-notices.test.mjs` until one does (the header says more).

### `calendar-member.js`
Which member the Calendar shows, and the member picker.
- `getSelectedMemberIndex()` — this page's selection: read once — the saved name, else the signed-in
  member, else the default (held only where it is not a first run) — and after that changed only by a
  pick on this page, so a key rewritten by Admin or another tab never moves the grid off the picker. A
  saved name no longer on the roster sets the stale flag and prefers the signed-in member over the
  default.
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
  refreshFromCache, refetchShownWeek, isGridShown }`. The coordinator injects the override cache, the
  shared `ensureOverridesCached` and the shared repaint a month read lands with (`onMonthRead`), member
  and render callbacks, and the history hooks.
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
- Its sign-in card explains the page (`ADMIN_SIGN_IN_ABOUT`, the Pay Calculator's arrangement): what Admin
  records, that it needs the reader's own sign-in because the staff PIN does not open it — Pay's clause
  word for word — and, for a shared screen, to sign out from the menu afterwards.
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
- `installNeed({ ios, installed, onMirror })` → `{ state, from }` — installing is a to-do (`action`) only
  for an iPhone in a browser, an offer (`n/a`) everywhere else. On the Pages mirror that iPhone is a to-do
  too, with steps that start at the main address (`from: 'main-address'`), since the app is never added
  from the mirror.
- `summarise(states)` → `{ tone, headline, items, ids, cards }`. **Silence is not success:** a card that has not
  reported is `unknown`, which outranks every answer, and a failed read is `error` — never "all set".
  `ids`/`cards` say which card each to-do is about, and its element id: the strip's items link there.

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
  (`auth-identity.js`, shared with `password-force.js`), re-authenticates, then writes with `changeOwnPassword`
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
- `closeOnBackdropTap(overlay, close)` — the backdrop rule `createLightbox` and the drawer's two lightboxes
  share: a press AND release on the overlay itself, so a text selection dragged out of the card is not a
  tap; a click made in code, with no press, still closes.
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
- `confirmDialog({ message, title?, confirmLabel?, cancelLabel?, danger?, onConfirm?, dismissResult? })` →
  `Promise<boolean>` and `promptDialog({...})` → `Promise<string|null>` — app-drawn `confirm()` and
  `prompt()`. Async, so never inside a capture-phase navigation guard or a `beforeunload`; `onConfirm`
  runs inside the tap, for work that needs the gesture. A dismissal (backdrop, Escape, Back) resolves
  `dismissResult`, false unless given; the first answer stands through the close fade.
- `confirmWithOption({ message, title?, confirmLabel?, cancelLabel?, danger?, option: { label, hint? } })` →
  `Promise<{ confirmed, option }>` — the same dialog with ONE unticked box (shared.css's drawn one, in a
  `<label>` row: `.dialog-option`), named by its label and described by its hint; focus opens on it.
  `option` is the box as it stood when the confirm button was pressed, and false on Cancel or any dismissal.
  A separate function, so `confirmDialog` still resolves a boolean. First caller: Operations → Reset's lost phone.
- `lockBodyScroll()` / `unlockBodyScroll()` — depth-counted and iOS-safe.
- `watchScrollFade(panel)` → stop function — toggles `.has-more` (the "more below" fade in shared.css)
  while a scrolling panel has content past its fold. Every lightbox gets it through `createLightbox`; the
  nav drawer's body is the one other caller (`nav-panel.js`), from open to close.
- `initCardCollapse` and `openCardNamedByHash` are **re-exported** from `card-collapse.js` (below), so
  every page imports them from here as before.

### `card-collapse.js`
A card's collapsible header and the deep link that opens a collapsed card by name. Moved out of
`overlay.js`, whose subject is overlays; `overlay.js` re-exports both functions, so no page's import
changed. No imports, and no browser global read at load. Tested by `card-collapse.test.mjs` (the deep link
and the re-export) and `overlay.test.mjs` (the toggle, through the re-export).
- `initCardCollapse(headerId, bodyId, chevronId, onToggle)` → `{ setOpen }` — the chevron is the focusable
  toggle, never a header that holds another button (WCAG `nested-interactive`); `setOpen` is the one
  place the open state is written, so `aria-expanded` and `.open` cannot disagree.
- `openCardNamedByHash(cardId, bodyId, toggleId)` → boolean — opens the collapsed card the URL fragment
  names through its toggle's own click, and keeps it at the top while the page GROWS (a `ResizeObserver`,
  never a timer), until the first real gesture or the watch's end. Call after `initCardCollapse`.

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
- `initLoginOverlay({ pageLabel, onSuccess, host?, alternative?, notice?, presetName?, about? })` — call only when
  signed out. By default a fixed modal (scroll lock, focus trap, Escape, "← Back to roster"); `host` mounts
  the SAME card inline with none of those (the Calendar's front door, `calendar-lock-cards.js`), and
  `alternative` replaces the back link. `notice` goes into the card's status line after the card is in
  the tree. `presetName` pre-selects grade and name through `getMembersForGrade`, dispatching `input`,
  and focuses the password. `about` (`LoginAbout`: lines, a relative guide link, a footnote) puts the page's own
  explanation under the subtitle and describes the dialog with it; its link is inert mid-sign-in, as Back is (the Pay
  Calculator's, `paycalc-role-card.js`). The typed password goes straight to `ensureNamedSession`: the server is the
  arbiter, and only a `credential` failure counts towards the three-strike client lockout. On success it
  writes the one-shot set-password marker (`PW_FORCE_PENDING_PREFIX`) and calls `onSuccess(name)`.
- `runNamedSignIn(deps)` — the DOM-free sign-in core (`login-overlay.test.mjs`). It time-boxes
  `ensureNamedSession` and saves the local session ONLY once auth genuinely resolves; otherwise it returns
  `{ ok: false, kind, error }`, `kind` being `timeout`, `ratelimit`, `transient`, `credential`, `other` or
  `storage`. `credential` only for a code `isCredentialRejection` (auth-identity.js) accepts — wrong password
  and no account share one sentence; any other refusal is `other`, never counted. A failure clears any local
  session except this member's own (`keepsLocalSession`). The history is LOGIN_INCIDENT.md.
- `signInDeps(name, typedPw)` — the core's dependencies for one attempt, as the card's submit builds them;
  exported so the unit suite drives that exact wiring through the real `session.js`.
- `dismissLoginOverlay()` — removes the card, and releases the scroll lock only if it was the modal one
  (an inline card never took it); safe to call unconditionally on a coordinator's authorised path.
- **When arriving ended the staff PIN** (v25.78): the modal card carries an empty status line from the
  start, so a notice written later is announced. `onStaffPinEnded` (staff-pin-ended.js) has it say that the PIN
  only opens the Calendar and Trains, so the roster is locked again, and points the way back — the link
  and Escape alike — at the Calendar's PIN box (`./#staff-pin`, `PIN_FIRST_HASH`). The inline card never
  asks: the Calendar never ends the PIN. The words and the landing are checked in `e2e/calendar-pin.spec.js`.
- `isAboutLinkAllowed(href)` — PURE: whether an `about` link may go on the card — a same-origin relative
  path (`./…`) only, never an absolute, protocol-relative or `javascript:` URL. `fillAbout` drops a refused
  link silently, so the rule is unit-tested rather than read (`login-overlay.test.mjs`).
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
  own panel — an alertdialog named by its title, focus on Reload — with Reload and "Reset the app"
  (unregisters THIS app's worker, matched by its script URL, and deletes only its `myb-roster*` caches).
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
- The endpoint, `requestPasswordReset` in `functions/reset-request.js`, **resets nothing**: it records a
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
- `ensureNamedSession(name, { retries?, delayMs?, password? })` → `Promise<boolean>` — what every page calls. Runs `ensureFirebaseSession`, retries only transient codes (never a rate limit or a stalled start-up), feeds the store, and on success runs `refreshClaimsIfStale(CONFIG.CLAIM_EPOCH)`. The named pages hand the result to `guardNamedSession` (page-session.js).
- `ensureFirebaseSession(name, _gen?, password?)` → `Promise<boolean>` — the sign-in itself; nothing calls it directly in production. Reuses a restored session only when it is this member's and nothing was typed; otherwise tries `credentialCandidatesFor` (the typed value first) or the surname default. A silent sign-in on a session older than the member's last admin reset (`probeResetAtMs` → `sessionPredatesReset`) is refused and ends the local session; an unconfirmed answer holds the sign-in and deletes nothing. A failure is `'none'` — no anonymous fallback, no account self-heal — so a wrong password fails closed. Bounded by `AUTH_READY_TIMEOUT_MS`; every shared write after an await is generation-guarded, so a superseded attempt publishes nothing.
- `terminalAuthEvent({ named, stalled, error })` — pure: `NAMED`; `TRANSIENT` for a stalled start-up or a transient code (nothing is known, so the page keeps its session); otherwise `NONE`. `isTransientAuthError(code)` — the retryable codes.
- `getFirebaseIdentity()` → `'named' | 'none'` · `firebaseSessionIsNamed()` — what the last attempt established; only this module and its tests read them. `getFirebaseAuthError()` — that attempt's error code, read by login-overlay.js, admin-auth.js and operations-app.js.
- `restoreFirstAuthUser(timeoutMs?)` — ground truth once the boot restore has had its turn; `null`, not a rejection, past `AUTH_RESTORE_TIMEOUT_MS`. Use `auth.currentUser || await restoreFirstAuthUser()`. `primeAuth()` — the login overlay starts that restore while the member types; latency only.
- `sessionReady` / `resolveSession(result)` — the page's one-shot "session settled" promise. The coordinator resolves it exactly once; feature modules await it.
- `refreshClaimsIfStale(epoch)` — one forced ID-token refresh per device per claim-epoch bump.
- `shedCalendarViewer()` — drops the shared PIN viewer before a member signs in. **Signing out BEFORE restoring member persistence is the security property** (`setPersistence` would move the viewer into IndexedDB; proven both ways in `experiments/viewer-persistence-proof/`); throws when it cannot confirm the viewer has gone (AUTH_AND_SESSIONS.md invariant 8).
- `reconcileExpiredIdentity({ preserveCalendarViewer? })` — signs out a named Firebase identity whose local session has gone. Every protected coordinator calls it at init. Only the pages that admit the PIN keep the viewer (the Calendar's `resolveAccess`, and `holdsStaffPin` elsewhere) — never make preserving it the default.
- `holdsStaffPin(budgetMs?, onLateViewer?)` — does this browser hold the station PIN, and keep it? For a page other than the Calendar whose policy admits the PIN (`admitsStaffPin`); a local member session answers `false`. Its budget, `ACCESS_DECISION_BUDGET_MS`, is shared with calendar-access.js's `resolveAccess`. `onLateViewer` runs once for a PIN session that restores after a `false` — never once a sign-in or sign-out has begun since.
- `authGeneration()` — the sign-in/sign-out generation every attempt bumps: a watcher armed at one value stands down once it moves (the Calendar's late PIN grant, `holdsStaffPin`'s).
- `signOutStaffPin()` — the drawer's Lock on such a page; throws if the viewer is still current, and never touches a member.
- Imported by every protected coordinator and many feature modules; grep for the import rather than trusting a list. Tested by `session.test.mjs`.

### `staff-pin-ended.js`
Whether arriving on THIS page ended the shared staff PIN, and who is waiting to hear it — so the page's sign-in card can say why the roster is locked again (AUTH_AND_SESSIONS 24). A module of its own because session.js was at its size cap (coordinator-ratchet.test.mjs), and this is one subject a Node test can hold.
- `noteStaffPinEnded()` — records it and tells each listener already waiting, once; one that throws does not stop the rest. ONE caller: `reconcileExpiredIdentity` (session.js), and only once its sign-out of the viewer has landed — never a Lock, a member's expired identity, or a sign-out that failed.
- `onStaffPinEnded(fn)` → unsubscribe — runs `fn` once: when the teardown lands, or on a microtask if it already has (sticky for the page's life). Unsubscribing cancels a call already queued. Its one reader is the sign-in card (`login-overlay.js`).
- Imports nothing. Tested through the real teardown by `session.test.mjs`.

### `silent-sign-in.js`
The rules of the sign-in nobody typed — a page load re-establishing the identity behind a 60-day local session with the surname default. Pure: no storage, no Firebase, no clock of its own; `ensureFirebaseSession` (session.js) reads and writes the memory and hands the time in. The reasoning (the station NAT's shared rate limit, the six-hourly reset recheck) is its header.
- `noDefaultKey(name)` — the per-member memory key: WHEN this device last saw the surname refused, or asked about a reset.
- `RESET_RECHECK_MS` — how often a flagged device still asks whether an admin reset ended its session (AUTH_AND_SESSIONS 23).
- `planSilentAttempt({ surname, stored, now, unansweredThisAttempt })` → `{ candidates, recheck, held }` — the surname unless remembered refused or a recheck is due; `held` when a recheck already asked in this attempt got no answer.
- `afterRecheck(resetAt)` → `{ note, stop, unanswered }` — what a recheck's probe answer does to the memory and the attempt.
- `remembersRefusal(code)` — a definitive rejection of the surname is remembered; never `auth/user-not-found`.
- Imports only `auth-identity.js`. Tested by `session.test.mjs`, alone and through the real sign-in.

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
- `PAGE_POLICIES` — the per-page map: calendar public, plus the PIN; guides open; paycalc soft; admin and settings any named member; operations admin; links designer; overtime admin, manager or `overtimeBeta`; trains any named member, plus the PIN; newlink admin, `newlinkPreview` or `newlinkAudience`. `DECISIONS` — the five decision strings.
- `requirePageAuth(snapshot, policy, roles)` → `{ decision, reason }`, pure: `allow`; `soft-allow` (a soft page never blocks); `login` (signedOut, anonymous, error); `forbidden` (named, wrong role); `pending` (initialising, resolving, degraded — degraded grants nothing but can be retried).
- `rolesFor(member)` — the role flags from `CONFIG`. The client's `designer` deliberately differs from the server claim `linksDesigner`; do not wire it to the claim.
- `requirePage(snapshot, page)` — the coordinator convenience; fails CLOSED (named admin) on an unknown page, and uses `hasOwnProperty` so a name such as `toString` cannot match.
- `isOvertimeReviewer(member)` (admin or manager) and `canOpenOvertime(member)` (Overtime switched on, and a reviewer or a `CONFIG.OVERTIME_BETA` name). **Keep them separate and never widen the first to make the pill work**: whatever shows colleagues' declarations reads `isOvertimeReviewer` (`AUTH_AND_SESSIONS.md` invariant 14).
- `overtimeEnabled()` — the one client read of `CONFIG.OVERTIME_ENABLED` (paused: `OVERTIME_AVAILABILITY.md` → Paused); `__E2E.overtimeEnabled` is the browser suites' seam.
- `canOpenNewlink(member)` — admin, a `CONFIG.NEWLINK_PREVIEW` name, or `newlinkAudience` (a normal CEA contract — `role` CEA, no `bilingualContract`, not hidden — or a `CONFIG.MANAGER_NAMES` name; open since v25.60). Written here because `newlink-boundary.test.mjs` keeps `newlink-config.js` out of this module; `newlink-config.test.mjs` holds the role to `audienceNames()` and the managers for every name, and the function to `PAGE_POLICIES.newlink`.
- `admitsStaffPin(page)` — the policy's `staffPin` flag, the one answer to where the station PIN may go; `requirePageAuth` never sees the PIN. `page-contract-parity.test.mjs` refuses a coordinator that asks `holdsStaffPin` on a page this does not admit.
- Tested by `auth-policy.test.mjs`.

### `operations-app.js`
Coordinator for `operations.html` (admin only). Its only export is `init()`, run by `operations-boot.js`.
- Access: `requirePage` on the local session — `login` shows the shared in-place sign-in and re-enters `init()` on success; `forbidden` sends a non-admin to `admin.html`. Then `ensureNamedSession` → `resolveSession` → `guardNamedSession` (page-session.js), which asks for a sign-in again if the named session cannot be confirmed or is lost later.
- Holds a service-worker reload while a roster review, a parse, an upload, an unconfirmed write or a Document links check or run is in flight (`_opsBusy`).
- Wires the upload cards (Huddle, Circular, Newsletter, Weekly Roster), Document links (`initDocLinksCard`, handed overlay.js's `confirmDialog`), Staff Login Accounts (`initAuthSetup`), the Needs-attention strip (operations-attention.js) and the three reporting cards, each imported from its own module.
- Owns two cards: **Account status** (`initAccountStatus` — per member, the work email with Set/Edit/Remove and the password posture with a Reset for everyone; why everyone is beside `buildRow`, and every word the Reset asks and says is `operations-reset.js`'s) and **Password reset requests** (`initResetRequests` — refreshed on returning to the tab without re-opening a card the admin closed).
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
- Wires `initLinksAnalysis`, `initLinksCompare` (compare state lives there; the coordinator only reads it or calls `resetCompare`), `createDesignHeader`, `createDesignLibrary` (import and the bin), `createTargetPanel` (the target table) and `createGridInput` (the grid's keyboard, clicks and mouse strokes). The Generate button stays here.
- All design maths is imported from `links-design.js`; never copy it back. `ROTATING_LINES` is imported, never written down (`links-rotation-parity.test.mjs`).
- Every path that would lose unsaved work asks first. Duplicate's wording is deliberately not "will be lost", because the copy carries the live patterns (comment beside `duplicateDesign`).
- A proposal opens with `activeDesignId` null and `activeProposalId` set, so no write path can send a proposal id to Firestore (`links-proposals.js`).
- The orientation lightbox (`#linksWelcomeLb`) opens once per device under `myb_links_welcome_seen`, never expires, and `#linksHowBtn` in the About panel reopens it. Printing opens every `<details>` first (`_preparePrint`), because CSS cannot.
- Capped by `coordinator-ratchet.test.mjs`, whose latest raise of this cap is argued beside it; the next
  Links rule still goes in a domain module.

### `links-analysis.js`
The read-only analysis on `links.html`: the Coverage heat map with its demand rows, the Design checks card, and the sticky summary strip in the grid card's save row. Render only — every figure comes from the pure modules (`links-design`, `links-fatigue`, `links-limits`, `links-window`, `links-demand`), and none of the coordinator's save, concurrency or dirty state is touched.
- `initLinksAnalysis({ getDesign, getBaseline?, isComparing? })` → `{ renderCoverageChart, renderDesignChecks, renderSummary }`. `getDesign` is a thunk for the live design or null; `getBaseline` gives today's link's fatigue profile, so a proposal's findings read against what the roster already scores; `isComparing` makes the strip name its design in compare mode. `links-app.js`'s `renderCoverageCard()` calls the chart, the window editor and the strip together.
- Design checks open with a triage block ("Needs fixing before review", "Worth discussing") that restates the red and amber rows below and computes nothing of its own; a clean design gets no tick. The sections stay grouped by SOURCE, because a section claiming a limit must name whose requirement it is (`.claude/rules/links-design.md` invariant 10).
- The strip shows lines undesigned, staffed hours with trains and nobody on, fatigue factors present (never `standing`) and hours a week. It is not a score, and it recomputes rather than reading the other renderers' results, so render order cannot make it wrong.
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
- `initLinksCompare(deps)` → `{ toggleCompareMode, selectCompareDesign, renderCompare, isCompareMode, getCompareId, resetCompare }`. **The single owner of `compareMode` and `compareDesignId`**: the coordinator only reads them or calls `resetCompare()` (on delete, select and generator apply). It reads the designs through injected getters and never touches the save or concurrency baseline. A compared design gone from the list ends compare mode, grid re-rendered.
- `COMPARE_ACTIVE_FALLBACK` — what compare mode calls the active design while it is unnamed; the sticky strip reads it too, so its name chip matches the column.
- `renderSummaryStrip` (private): cells and LINES that differ, then hours a week ex-Sunday (through `hmFromHours`, never a hand-rolled formatter), full weekends off, rest under 12 hours and ORR factors present. An unchanged figure still renders, muted, because "the same" must not look like "not measured". Nothing is scored. `renderAnalysis` (private) writes out `compareDesigns`.
- "Only the lines that differ" is a view: every row renders and `.compare-diff-only` hides the `.row-same` ones (a class, not `hidden` — `links.css` says why). The strip says its figures still cover every line; the filter is offered only when it would both hide something and leave something; leaving compare mode clears it, switching the compared design does not.
- The compare cells are `<span>`s, because they cannot be operated; the scrolling columns are reached by keyboard through their wrappers' `tabindex="0"` (`links.css`: never restore the buttons for it).
- The two columns scroll together, and an echo that changes nothing must not arm the guard (`initScrollSync`). Tested by `links-compare.test.mjs` (fake DOM).

### `links-grid-input.js`
How the design grid on `links.html` is operated. `links-app.js` keeps what a cell MEANS — paint it with the armed brush, or open the shift sheet over it; this decides which cell an input lands on, and keeps focus where a keyboard user left it. The reasoning is in the header.
- `cellAfterKey(key, at, { lines, days, ctrl })` → the next `{ pos, day }`, or null for a key the grid does not own. Pure: the arrows stop at the edges; Home and End go to either end of the line, and with Ctrl to either end of the grid.
- `createGridInput(tbody, { lines, days, ready, armed, paint, edit })` → `{ render(html) }`. Delegated to the body: ONE Tab stop among the cells (a roving tabindex) that the arrows move; a click paints or edits; a MOUSE stroke paints every cell it crosses and owns the click that ends it, while touch and pen keep tap-to-paint. `render` keeps the Tab stop, and keyboard focus, across a re-render.
- `trackPaintBarHeight(bar, table)` — publishes the paint bar's height as `--brush-bar-h`, so the day header sticks beneath the sticky bar (`links.css`).
- Focus survives an edit only because `applyShift` repaints the cell's button in place (`repaintCellBtn`). Tested by `links-grid-input.test.mjs`; the wiring by `e2e/links.spec.js`.

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
- `list()` → `{ status: 'ready'|'error', sets, fromCache? }` — a read that fails is not an empty collection, and nor is an EMPTY answer from the cache, which offline may never have held the collection. What the picker may then say is `describeSetList` (`links-target-sets.js`).
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
- `enhanceSelect(select, { title, placeholder, triggerClass?, searchLabel?, createLightbox? })` → `refresh()`. Inserts a trigger (`#<id>Trigger`, wearing the select's own classes plus `.fieldpick`), takes the select out of the layout and the accessibility tree, and opens one shared `createLightbox` sheet of `.picker-opt` rows. The trigger mirrors the select's `hidden` and `disabled`, and repaints on `change`, on `input` and on a MutationObserver, because a rebuild, a disable or a selection made in code fires no `change`.
- `initSelectSheets(specs, { createLightbox? })` → each id's `refresh()`; a spec is `{ id, title, placeholder?, searchLabel? }`. A missing id is skipped; a select built after boot must be enhanced where it is built.
- `openOptionSheet({ title, groups, current, subtitle?, searchPlaceholder?, searchLabel?, onPick, onPreview? })` — the same sheet for a caller that holds the value itself (the Links grid's cell editor). `onPick` fires once the close has LANDED, so a dialog opened from it is not popped by the Back echo; `onPreview` fires on the tap; neither fires on a dismissal.
- `readGroups(select)` (also the options parser for `openOptionSheet`; a `hidden` option is never offered) · `triggerLabel(select, placeholder?)` · `widestOptionLabel(select, placeholder?)` — the trigger is sized to the longest label, so it does not change width when the value does.
- `shouldOfferSearch(count)` · `optionMatches(option, query)` · `filterGroups(groups, query)` · `searchLabelFor(title)` — the filter on a long sheet: a substring of the label or its second line, case and accents folded; a group that keeps nothing is dropped, and no match is an empty list. The box never takes focus, and it is deliberately not `guide-search.js`. Its name is the caller's `searchLabel`, else `searchLabelFor`: a title of plain words is welded on (an instruction keeps its noun), anything else — a question — is just "Search".
- `createLightbox` is injected because `overlay.js` touches `window` at import. Tested by `select-sheet.test.mjs` and `select-sheet-pick.test.mjs`; coverage by `select-sheet-parity.test.mjs`; the wiring by `e2e/calendar.spec.js`.

### `select-sheet-parity.test.mjs`
The guard that every `<select>` the app ships is enhanced or native by a declared decision, and that the page CSS reaches the trigger. A missed select is invisible to every other lane: the closed control looks the same, the popup belongs to the platform, and `selectOption` drives both. The numbered contracts are the list, each with its reason in the file: the scan reads every construction site (page markup, `createElement` and JS template literals) and fails when it cannot; `NATIVE_BY_DECISION` carries a reason per row, and a stale row fails; an id rule needs a `#<id>Trigger` counterpart; a page whose enhanced selects carry no class names `.fieldpick`; nothing focuses an enhanced select; no `hidden` select is enhanced; a selection changed in code announces itself; a test reads the face, never the select; and a box that collapses is a containing block.

### `links-proposals.js`
The shortlisted designs for the new link, built into the workspace as read-only proposals rather than saved documents (owner decision, 3 Oct 2026). Pure data and helpers; the header names the current shortlist and how to re-copy it from the pack.
- `PROPOSALS` — `{ id, code, name, ref, patterns }`, copied cell for cell from the pack's `.json`, listed A to Z with no recommendation (owner, 5 Nov 2026): Balanced V6, Level Crossing and Middle Ground since 8 Nov 2026. `name` is the title; `ref` is the code and grid fingerprint, kept apart so a phone shows the name untruncated.
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
- `createDesignHeader(els, { onSelect, onRename }, { moreButton, sheet, picker, sheetActions })` → `{ render(state), viaSheet(fn) }`, where `state` is `{ designs, activeId, design, dirty, saving?, currentUser, now?, proposals?, proposalId?, queued? }`. It paints the face, the picker list (rebuilt only when its content changes), the badge, the status, both Save buttons and the sheet's header. A sheet action — a picker row, a ··· More row, or a function passed to `viaSheet` (the library's bin and Keep only the shortlist rows) — closes its sheet and runs once that close has landed, and only the first per opening runs.
- `groupDesigns(designs, currentUser)` — "Last saved by you" first, then other savers alphabetically, newest first within each. Grouped by `updatedBy` (last saved by, not creator), and the headings say so.
- `saveButtonLabel({ saved, dirty, proposal? })` — `Save a copy…` (a proposal's working copy) · `Save as…` (no document yet) · `Save` · `Saved`. One place; call sites never write these.
- `statusCopy({ saved, dirty, saving?, updatedAt?, now?, proposal?, queued? })` → `{ tone, long, short }` — unsaved edits are never reported as saved, and a write still only in this browser's queue (`queued`, from the render state) says "Saved in this browser".
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

### `rangers-guide.css`
The Rangers & Rovers guide's stylesheet: the ranger and rover area passes staff accept or refuse at the gateline. A static page with no app modules and no Firebase; its chip bar is `guide-chips.js` and its ⤓ PDF button `guide-print.js`, both shared with other guides.
- The page's rules live in `.claude/rules/guide-pages.md` → "Rangers & Rovers guide": the Marylebone question first, evidence per product and per claim (a Conflict is not a stronger Draft), "usually no" with the near-misses as the point of the page, and no prices. Each product's evidence is a `GUIDE_SOURCES.md` row, held to the page by `guide-sources.test.mjs`.

### `links-seed.js`
The generator's roster seed: it reads the roster people actually work and turns it into shift-slot targets — the table behind "Copy staffing from today's roster", one button from the default. It MEASURES; `links-default-targets.js` DESIGNS. Pure; the reasoning is in the header.
- `rosterSeedLines()` → the lines sampled: the WHOLE main cycle and nothing else, its length read from `CONFIG.MAIN_ROSTER_WEEKS`, never a literal.
- `buildRosterTargets(sources = rosterSeedLines())` → `{ slots: [{ time, weekday, sat, sun }], spareLines }`, as fresh objects. The weekday figure is the BUSIEST Monday-to-Friday day for that time, spare is counted in whole LINES, and nothing is added to what it measures.
- **The seed samples exactly what the design represents.** The new link is the main roster widened and excludes the bilingual roster, so no bilingual line or time is sampled. Sources are a parameter defaulting to the real roster, so which lines are sampled and what is counted are tested apart.
- Tested by `links-seed.test.mjs`: line identity, no bilingual-only time ever seeded, and no bare numeric loop bound.

### `links-default-targets.js`
The table the generator starts from when a design has none: the duty table of Short Run, in the pack and on the owner's shortlist until 8 Nov 2026, which pays the contracted week exactly, so Generate works on a card nobody has touched. It DESIGNS where `links-seed.js` MEASURES, and the two are one button apart. Pure data plus one builder. The header has the arithmetic and the `docs/links-26/RULES.md` rules the table meets; `links-default-targets.test.mjs` pins each one.
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
- `assessFatigue(patterns, lines)` → `{ results, present, standing, confirmNeeded, hoursAreFloor }`
  (`hoursAreFloor` is true only when the rotation holds a SPARE day); each result is `{ code, family, title, status, value?, threshold?, detail?, confirm? }`, `status` being `present` / `clear` / `standing` / `n/a`.
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
- `dutySpans(patterns, lines)` — who is on duty to the MINUTE: each day's duties as closed `[start, end]` spans, read as `calcHourlyCoverage` reads them (a past-midnight tail lands on the next day), and a test holds the two together hour by hour.
- `summariseDemand({ movements, spans, days, windowFor })` splits a FINDING from a FACT — the anti-cry-wolf rule. `uncovered` (the station open, a train running, nobody on duty at that minute) is a finding, asked train by train against `dutySpans` and reported per day by clock hour, so a gap inside an hour is seen; `outside` (trains while the station is shut) is a neutral fact, per day class to the minute, split before and after.
- Rendered by `links-analysis.js` as rows in the same table as the cover, in `--cov-late` orange, a different hue from the cover ramp so the two rows do not read as one thing in one unit. Tested by `links-demand.test.mjs`; the wiring by `e2e/links.spec.js`.

### `links-adjacency.js`
What happens BETWEEN the lines: the order they sit in. You work line w one week and line w+1 the next, so the week-to-week movement of the working day, full and long weekends, and rest from Saturday into Sunday all live in the order. Pure; `links-app.js` applies it after Generate. The header carries the reasoning and the measured weights.
- `OBJECTIVES` (the switches on the generator card, in display order — the count is the array's) · `GENTLE_THRESHOLD_MINUTES` (the step that counts as a real change — ORR's FF19 figure) · `DEFAULT_BLOCK_TARGET` (weeks in a row on much the same shift, measured from the live roster).
- `lineStartProfile` (null, never zero, for a line with no times) · `weekStep` · `breakLength` (`days` and `given` apart, because Sunday is not contracted) · `boundaryRest` · `blockRuns` (the optimiser's partition, read round the circle from every line and listed longest first — the reading with the longest blocks, so renumbering cannot change what `variety` charges; a spare line is transparent) · `longestBlockOf` (the REPORTED longest block — always `blockRuns`' first entry) · `blockExcess` · `spareSpread` · `longestRunFor` (delegates to `worstCaseWorkedRun`) · `runExcess` (a gradient, never a statistic — never report it) · `scoreOrder` (every figure, whatever was optimised) · `cost` · `reorderLines` · `applyOrder`.
- **Reordering is free with respect to coverage** — permuting the rows leaves every day's cover unchanged, and a test asserts it — so the objectives compete only with each other. Switches, not a formula: an objective that is off contributes nothing, and all off returns the order untouched.
- **Two terms are constraints, not switches**: the even spread of cover weeks (weighted to dominate every switch, and filtered on) and rest across the week boundary (minimum rest is a gate the generator applies before the reorder, so the reorder must not undo it). `variety` stays on by default, because minimising the step alone produces long blocks of one shift.
- Deterministic per attempt: attempt 0 is the greedy start; later attempts are seeded shuffles (never `Math.random`), so "design 3" is the same design on every device. Tested by `links-adjacency.test.mjs`, which also fails if the waves are interleaved inside the generator (a won't-do; `links-design.js`'s header).

### `links-deletion.js`
The pure rules behind Recently deleted in the Links workspace: a soft delete (`deletedAt` and `deletedBy` on the document) that hides a design and keeps it until a designer removes it for good. **The bin is PERMANENT** (owner decision, 19 Sep 2026): nothing expires a design and there is no retention constant, which `doc-parity.test.mjs` pins, so no doc may promise a removal window.
- `isDeleted(data)` — tests for the KEY, not a usable timestamp, so a design binned on this device leaves its picker at once.
- `deletedLabel(data, nowMs)` — the design's AGE in the bin in calendar days ("Deleted 3 days ago"), never time remaining.
- `sortByDeleted(entries)` · `tsMillis(ts)` (null for a timestamp not yet resolved). Nothing here refuses to bin the last saved design: a shortlisted proposal opens in its place.
- `deleteOutcomeLine(found, name, deletedData?)` — what a delete found, in words: ours, a colleague's earlier delete (named), or removed for good · `renameRefusedLine(name, deletedData)` — why a rename of a design no longer live did not happen.
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
- `createRangeBookingSection(cfg)` → `{ updatePreview, saveBtn }` — wires one section by `cfg.prefix` (`al` / `sick`): the member dropdown (the remembered member set through its options, so one no longer listed leaves it as it was), the preview guard chain (no member, no dates, a bad range), working-day counting through `isWorkingDate`, the date listeners, and the save → receipt → refresh flow, including the signed-out and unconfirmed-write messages; a range a colleague's change refused names its days, and one stopped part-way says whether a colleague's change (`DELETE_REFUSED`) or the connection stopped it. A change staged in Change a Shift on a day the booking wrote is cleared, and named in the receipt (`clearedDaysLine`) — on a part-done stop too. The preview and the Save click read one plan; the click refuses while the member's records are unread, and asks — never skips — a rest day that newly needs the question. Worked Sundays set as rest days are named in the preview and the receipt.
- Each section's differences are injected: `validateRange`, `renderReady`, `successFeedback`/`successToast`, `beforePreview`/`afterDateChange`/`afterSave`/`onViewYearChange`, and the AL-only `onClick`, `project`, `swapQuestion` and `preSave`. It owns none of the leave rules: `admin-al.js` brings in the projection (`admin-al-projection.js`), the Spare sentence (`admin-al-spare-note.js`) and the swapped-day question (`al-swapped-days.js`); the Absence card supplies none of them, so its rest days are skipped silently.

### `admin-al.js`
The Annual Leave booking section on `admin.html`: a thin configuration of `createRangeBookingSection` (`admin-range-booking.js`).
- `initALSection(deps)` — the AL config: the range-length cap, the preview (with the Spare sentence), the swapped-day question, the projection of what the save will write, and the over-entitlement pre-save check that shows the confirm bar. DOM handles and callbacks arrive through `deps`, so nothing imports `admin-app.js` back.
- `triggerConfirmedALSave()` — called by the confirm bar in `admin-app.js` when the user accepts booking past the entitlement; it sets the flag and presses Save again. The flag is captured and reset at the top of every save, so an early return can never leave it set.

### `al-entitlement.js`
Which annual-leave days spend a member's entitlement, and where that leaves them: taken, booked, remaining. Pure. One module because the set of counted days used to be built by hand in four places that disagreed (the header has the story and the rules).
- `entitlementFor(member, year, overrides)` → `number|null` — the WHOLE allowance: `getALEntitlement` plus the Boxing Day day in lieu (`boxingDayLieuDays`). **The one door**: `christmas-leave.test.mjs` fails if any other module calls `getALEntitlement`. `null` (no entitlement on record) stays `null`.
- `consumesEntitlement(member, date, ovByDate?)` — does leave on this date cost a day? Never a Sunday; never Christmas Day or Boxing Day from 2026 (`isChristmasClosureDate`); otherwise what is UNDERNEATH decides — the override through `isContractedWorkOverride`, given the day's base (on an AL document, its `replacedType`, so a swapped-in day costs a day and a voluntary `rdw` does not, nor an Other day or a Spare turn on a base rest day — owner, 10 Nov 2026), else the base shift. Both halves of the overage projection ask it.
- `countedAlDates({ overrides, member, year, exclude })` → `Set` — the AL days that spend `year`'s allowance, by the WINNING record and `leaveYearOf` it, so a January day moved back counts once, in the earlier year. `exclude` drops the dates a batch is about to rewrite.
- `alPosition({ overrides, member, year, todayStr })` → `{ entitlement, taken, booked, remaining }` — split at `todayStr`; `remaining` may be negative (over the limit); a null entitlement gives a null remaining.
- `leaveYearChoices({ overrides, member, todayStr })` — the January days the Admin panel may move between years, with both years' positions and `prevOpen`, the cap: "no more than the previous year has left".
- `dispatcherBreakdown({ member, year, overrides })` → `{ base, lieu, boxingDay, proRated } | null` — the parts of a Dispatcher's figure, never `entitlement - 22` (the test pins `base + lieu + boxingDay === entitlementFor(...)`). `entitlementNote({ member, year, overrides })` — the one line explaining an entitlement, shared by the Admin AL banner and the Calendar's leave panel.
- `winningEntriesOfType(overrides, memberName, type)` — resolve the winning record for each date FIRST, then ask its type; filtering the raw collection finds an old AL document under a newer shift.
- `isWorkingDate(memberObj, dateStr, ovByDate?)` — will this day be WRITTEN as leave (Sunday → override → base; no map means no override); re-exported by `admin-overrides.js`. `consumesEntitlement` asks the other half, whether it COSTS a day.
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
- `setLeaveYear({ memberName, date, leaveYear, changedBy })` — the ordinary manual write (delete-then-set onto the fixed id, `source: 'manual'`, carrying `replacedType` and the note from the SERVER's copy), **checked and written in ONE transaction** (`commitIfUnchanged`, v25.89): refused unless the day is still, on the server, exactly the leave shown and the fixed id holds nothing the page did not load — so neither a stale page nor a shift saved mid-move is turned back into leave. A re-run after a commit whose answer was lost reads this move's own write, which `alreadyDone` recognises (this editor's leave, the chosen year, everything replaced gone) — so a move that saved never reports "nothing was saved". Returns the day when a change staged on it in Change a Shift was cleared (`syncWeekAfterOwnWrite`), which the panel names. Its own module because `admin-overrides.js` is at its ratchet cap.
- Tested by `admin-leave-year.test.mjs` (the panel) and `admin-overrides.test.mjs` (the save).

### `admin-al-year.js`
Which calendar year the Annual Leave figures on `admin.html` describe. Pure, with no imports, so the precedence can be tested without a page — the ORDER is the whole rule, and the order is what broke.
- `alFigureYear({ pickedFrom, pickerViewYear, shiftDate, today })` → `'YYYY'` — strongest first: the AL range's picked start date; the year the range picker is DISPLAYING, but only once it has crossed a year (`pickerViewYear` is null until then); the week open on Change a Shift; then today. The header says why the first two rungs must not be "tidied".
- Fed by `admin-rangepicker.js`'s `onViewYearChange` (through `admin-range-booking.js` and `admin-al.js`), read by `updateALBanner` in `admin-app.js`. Deliberately not wired on the Absence card, which states no per-year figure (`admin-sick.js`).

### `trains-app.js` / `trains-boot.js` / `trains-change.js` / `trains-stations.js` / `trains-render.js` / `trains-data.js` / `trains-tips.js` / `trains-grid-mirror.js`
The Trains page: what changes at Marylebone when the December 2026 timetable starts on 13 December, organised by the station a customer is going to. Every signed-in member's, and the station PIN's too (`auth-policy.js` → `staffPin`). The sign-in is the app's ordinary front door, not protection: the timetable is public and `trains-data.js` is served to anyone. The page reads no network, so once opened it works offline. Each module's header carries its reasoning.
- `trains-app.js` — `init()`, run by `trains-boot.js`. Decides access from the LOCAL session, as Operations does: with no member it asks `holdsStaffPin` (behind `admitsStaffPin('trains')`) before offering a sign-in, and the PIN gets the page with nobody signed in (no session to guard; the drawer's Lock instead of Sign out). It owns the page state and which view is on screen — What's changing, Stations, Where they stop — and the wiring: one delegated click handler, focus returned to the pressed control's new copy after a redraw, a history entry for a station opened from the list, and the overview folding from the second visit. `timetablePhase` is read fresh on every render, so a page left open over the change turns with it.
- `trains-change.js` — pure judgements about two timetables, with no clock (`today` is passed in). `alignTimes` (one route's two time lists, paired in order at the least total shift, unpaired beyond `MAX_SHIFT_MIN`) · `foldWeekdayVariants` · `compareRoutes` → `RouteChange[]`, which runs `relinkAcrossRoutes` (a train cut from one route and added to another within `MAX_REROUTE_MIN` is one rerouted train) · `LINES` (a line's onward stops fold into it) · `lineDepth` · `routeKey` · `routeName` · `daysLabel` · `changeLabel` (the one place the change words are written) · `timetablePhase` (every date decision the page makes) · `railwayToday` (before 03:00 it is still yesterday) · `serviceMinutes` (the railway day starts at 03:00) · `daysUntil` · `dateWords` (no date is typed into a sentence) · `holidaysWithin` · `parseTypedTime` (refuses rather than guesses) · `trainsNear` · `NEAR_WINDOW_MIN` · `PATTERN_HOURS` (the daytime window) · `JOURNEY_PLANNER_URL`.
- `trains-stations.js` — pure: the timetable seen from a station. Every time is where the passenger gets on (`boardingTime`) and every count is of one real day (`aRealDay`). `parseStops` · `stopsKnown` · `callsOf` · `lineOf` · `callingAt` · `endingAt` · `knowableWithoutStops` / `decemberKnown` (December is answered only when it can be known; otherwise `null` and the page says it is waiting) · `summarise` · `stationView` · `stationTrains` (which train becomes which is decided once, by `compareRoutes`, so the station card and the lookup cannot disagree) · `verdictFor` · `hourChanged` · `rateWords` · `hourWords` · `hourNote` · `minutesWords` · `stopChanges` · `busiestStations` · `matchStations` (the ways people type a station) · `headlineChanges` (one line per station, consequence first) · `lastTrains` · `stoppingGrid` · `orderStations` · `pairColumns` · `stationBands`.
- `trains-render.js` — the page's HTML as strings, pure: `renderHeadlines` · `renderStation` · `renderGrid` · `renderLookup` · `renderTotals` · `renderPicks` · `renderLastTrains` · `endWords` · `DAYTIME` (the window in words, from `PATTERN_HOURS`) · `DAY_NAMES` · `changesTitle` (every name of the changes view, in the tense of the change) · `leadWords` · `renderFurtherChanges` · `SIGN_IN_ABOUT` (the sign-in card's way in for the staff PIN). Station names, never codes, and every dot and chip carries words, never colour alone.
- `trains-grid-mirror.js` — `syncGridMirror(host)`: a fixed, `aria-hidden` copy of the stopping grid's column heads while the real ones are off screen. Fixed rather than sticky, because every ancestor clips (the header says why). It also watches the grid's swipe line (`.tr-grid-swipe`, drawn `hidden`) through `overflow-hint.js`.
- `trains-tips.js` — `CARD_TIPS`, the page's `?` panels, where its caveats live. Every date, window and threshold is read from the page's own modules, and every line must hold on both sides of the change; `tips-content.test.mjs` evaluates them with the real values.
- `trains-data.js` — GENERATED by `docs/timetable-dec26/tooling/build.py`; never hand-edit. `CHANGE_DATE` · `DEC_VALID_UNTIL` · `FURTHER_CHANGES_UNTIL` · `LEAF_FALL` · `STATIONS` · `STATION_ORDER` (the books' own order, never typed) · `TIMETABLES.{now,dec}.{SX,SO,SU}.{dep,arr}` as `[time, station, route, days, stops]` rows, where empty `stops` means NOT KNOWN, never "no stops". Public data only; the generator's inputs are never committed.

### `overflow-hint.js`
A "swipe the table" line that is true: shown only while its table really scrolls sideways. Shared by Team view's week (`calendar-team-view.js`, through `watchHintFit`) and the Trains stopping grid (`trains-grid-mirror.js`). The line's words, its place and its retirement after a swipe stay with each page; whether it is a touch line at all is `touch-only`'s.
- `watchOverflowHint(wrap, hint)` → the `ResizeObserver`, for the caller to disconnect when the table goes, or `null` (nothing to watch, or no `ResizeObserver`: measured once). Sets `hint.hidden` at once, so the line never arrives showing, and again a frame after the box or its table changes size. A page's line needs its own `[hidden] { display: none }` rule, because `.touch-only` sets `display`.

### `newlink-app.js` / `newlink-boot.js` / `newlink-config.js` / `newlink-data.js` / `newlink-render.js`
The New link page (`newlink.html`): the three shortlisted proposals for the new CEA link, which starts in January 2027 (the day not yet set), shown evenly to the colleagues who will work it — A to Z, one colour, no recommendation. S. Silva, the RMT rep, leads the change; the admin built the page and is in charge of neither the change nor the choice, so nothing on it may suggest the admin decides, recommends or collects views (`newlink-config.js` header → WHO IS IN CHARGE). `PHASE` is `'open'` since v25.60 (owner, 9 Nov 2026): everyone on a normal CEA contract and the managers, with the admin and `CONFIG.NEWLINK_PREVIEW`, who had it alone while it was `'preview'` — through `auth-policy.js` `newlink` (role `['admin', 'newlinkPreview', 'newlinkAudience']`), `canOpenNewlink` and the pill flag `newlinkAudienceOnly`; signed in only, never the station PIN. Why the page is laid out as it is: `newlink-app.js` header.
- `newlink-app.js` — `init()`, called by `newlink-boot.js` (the CSP shim; no logic there). Owns the gate (anyone outside the audience is told who the page is for, never sent away — its header), the session wiring, the PDF viewer's wiring (a file in the pack card or under "Where they differ" opens on the page) and the two choices: a way of working (`persona`: null for the six one-line answers, an id, or `'all'`) and the proposal whose weeks are drawn (the first A to Z by default). A redraw keeps focus on the pressed control. Reads no network.
- `newlink-config.js` — one decision a line: `CHOSEN` (the design chosen, by its name on the page, or null — the one line that switches the page to 'decided'; `newlink-config.test.mjs` refuses a name not on the shortlist), `PHASE` (`'open'` since v25.60, `'preview'` before, `'decided'` FOLLOWING from `CHOSEN`; `newlink-config.test.mjs` holds it to the policy admitting `newlinkAudience`), `CLOSES` (null reads "a date to be agreed"), `AUDIENCE` (null means everyone on a normal CEA contract until the 26 are decided — the contract, `bilingualContract`, not the line; a CEA bilingual contract keeps its own links) and `audienceNames()`, `PACK_BASE` (the Pages mirror's `docs/links-26/`; Firebase Hosting serves nothing under `docs/`), `STARTS` (the link's start, not the timetable's), `TIMETABLE_STARTS` (pinned to `CHANGE_DATE` in `trains-data.js` by that test), `CONTACT` and `CONTACT_ROLE` (every line naming a person is built from them), `HAVE_YOUR_SAY` (says who leads the change, and no more).
- `newlink-data.js` — GENERATED by `docs/links-26/tooling/newlink-data.mjs` from the module the one-page sheet prints from; never hand-edit. `COLUMNS` (Today, then the three A to Z), `CHANGES`, `GAINS` / `COSTS`, `DIFFERS` (`{ design, better, worse }` — each one's edge and cost against the other two, the at-a-glance sheet's points by its 5% rule, from `docs/links-26/tooling/edge-cost.mjs`, which the sheet reads too) and `DIFFER_RULE` (that rule, and that a count of points is not a score), `PERSONAS` (`{ id, icon, chip, who, gist, rows }`), `NOTES`, `PACK` (the colleague PDFs, with page counts). `newlink-data.test.mjs` runs the generator in `--check` mode.
- `newlink-render.js` — every word of HTML, as pure functions; its header states the page's three rules (evenly, not your roster, teach in place). `statusPhase` (where the page's story is: 'decided' once `CHOSEN` names one of the shortlist — any other name is refused — 'open' before the link's start, and 'waiting' from the start with nothing chosen, when the page stops asking for views and says only who will confirm the outcome) · `statusHint` ("For discussion, not a decision" while open, nothing otherwise) · `renderStatus` (its tense follows `today`; "Have your say" only while open), `renderList`, `renderCommon`, `renderDiffers` ("Where they differ": each proposal A to Z in the same two panels `renderCommon` draws, the rule beneath, and the one-page comparison as a `fileRow`), `renderFigures` + `figuresKey` (the best of the three is marked in green AND said), `renderPersonas`, `renderPersonaChips`, `renderWeeks` (numbered weeks, a cover week as one cell, a "not your roster" flag, never a date), `renderAllWeeks`, `renderWeeksKey`, `renderWeeksTabs`, `renderPack`, `fileRow` (one pack file as a row to press — the ONE builder, so a file offered anywhere on the page looks and opens the same). Helpers: `aToZ` (every list of the three passes through it, whatever order it arrives in), `designName`, `closesWords` / `startsWords` (a malformed or rolled-over date reads as unset), `dutyKind` (an early starts before 11:00), `ifYou`. No `title` attributes.
- **The boundary:** `newlink-boundary.test.mjs` walks the import graph from the Calendar, the Pay Calculator and Admin, and fails if `links-proposals.js` or any `newlink-*` module is in reach.

### `pdf-viewer.js` / `pdf-viewer-core.js`
The in-app PDF viewer: a full-screen panel with a ✕ that draws a PDF's pages with PDF.js (vendored in `pdfjs/`, the legacy build), so a document opens INSIDE the app and closes back to it. Built for the New link pack (owner, 10 Nov 2026): opened as links, its PDFs left an app installed from the github.io address on the PDF with no way back on an iPhone — in-scope links open in the app's own window, which has no Back and no toolbar. The owner chose this over serving the pack from Firebase as well. The reasoning is `pdf-viewer-core.js`'s header; the three things easy to get wrong are `pdf-viewer.js`'s.
- `pdf-viewer.js` — `initPdfViewer()` → `{ open({ url, title, kicker?, pages? }) }`, or null on a page without the `#pdfViewer` markup (only newlink.html carries it). The lifecycle is `createLightbox` (focus, scroll lock, Escape, Android Back, Tab trap), not a hand-rolled exception. Loads PDF.js by URL on first use and keeps it; a failed load is forgotten so Try again really tries. Fetches the file with `fetchWithTimeout`, draws only the pages within a screen of view (an IntersectionObserver frees the rest), redraws on zoom and on a resize, and reads each page's words into a visually hidden line for a screen reader. A page that cannot be drawn (PDF.js refuses it, or the browser gives its canvas no memory) says so in its own box, with a Try again for that page alone; a zoom or a resize clears it too, and it is never retried on its own, because a page PDF.js cannot draw would fail again in a loop. Closing aborts the download, cancels drawing and destroys the document; every await re-checks it still belongs to the load on screen. `isEvalSupported: false`, or PDF.js trips the CSP.
- `pdf-viewer-core.js` — pure, tested in Node. `ZOOM_STEPS` (1, 1.5, 2, 3 × fit-width), `zoomAfter(current, ±1)`, `zoomLabel`; `pageLayout({ pageWidth, pageHeight, boxWidth, zoom, dpr, maxPixels })` → CSS and canvas sizes and PDF.js's `scale`, under `MAX_DEVICE_PIXEL_RATIO` (2), `MAX_CANVAS_PIXELS` (3 MP a page) and `MAX_FIT_WIDTH` (960px at 1×); `canOpenOutside({ fileUrl, pageUrl, standalone })` — the "Open the PDF on its own" rule: always in a browser tab, in an installed app only when the file is outside its scope (never the trap); `isPlainClick(event)` — a modified click is the browser's; `classifyFailure({ online, status, timedOut, networkError })` → `connection` / `gone` / `broken`, worded by `FAILURE_TEXT`; `PAGE_FAILURE_TEXT`, one page's own; `pageLabel`, `pagesLabel`.
- **Two app-wide rules it brought:** the CSP's `connect-src` names the mirror (the pack is read from there on both addresses), and the service worker passes anything under `docs/` straight to the network — it used to keep a pack file for the life of a release.

### `overtime-phase.js`
Where the Overtime week stands in the MEMBER's terms, and the two deadlines that decide it. Pure; imports only `date-format.js`. Every export is re-exported from `overtime-format.js`, so callers import it from there.
- `phaseAt(win, nowMs)` → `INITIAL_OPEN` / `FINAL_OPEN` / `CLOSED` — the client twin of `phaseFor` in `functions/overtime-core.js` (`overtime-parity.test.mjs`). The reviewer workspace derives a week's phase with it, because the overview's rows carry none.
- `deadlineLabel(ms)` → "Tue 18 Aug · 12:00", in London wall-clock time. `phaseCopy(phase)` → the sentence; `phaseChip(phase)` → 'Open' / 'Still open' / 'Closed'; `phaseTone(phase)` → `ok` / `warn` / `done`, the horizon's own classes, so the member's band and the reviewer's row colour one state one way.
- `deadlineLines(phase, initialAt, finalAt, openedAt?)` → the form head's lines as `{ text, label, value, lead, warn? }`: `text` is always `label + ' ' + value`, exactly one `lead`, a passed deadline turns "were due" and stays, only the FINAL_OPEN sentence carries `warn`, and a form opened after its first deadline names only the final one.
- **No line names a document the member does not receive, and none is a countdown** (`phaseCopy`'s JSDoc). Each function's JSDoc carries its own reasoning.

### `overtime-answer.js`
The ONE place a day's answer is edited on the Overtime form. Pure; no imports. A day carries three independent statements — the overtime mode, the willingness tick (`fullTwelve`) and the Sunday-release request (`releaseRequested`) — and every transition between them is here, so `overtime-answer.test.mjs` can ask each one what else it changed.
- `withMode(previous, mode, shift)` — a mode press, keeping whatever the new mode does not contradict (the same object back when the mode is unchanged). `withFullTwelve(previous, on)` — a no-op on a day with no mode or on `unavailable`. `withRelease(previous, on)` — on a day with no answer gives `{ releaseRequested: true }` with NO mode; off on such a day gives `undefined`, exactly unanswered again.
- **Five rules, numbered in the header:** the request is not an answer (a mode-less answer is unfinished, so Submit refuses it); every mode keeps the request; `unavailable` alone drops the willingness tick; a flag off is DELETED, never stored `false`; nothing mutates.
- The form only wires it — `setAnswer(date, next)` puts the result back and deletes the day on `undefined` — and `e2e/overtime.spec.js` proves that wiring.

### `overtime-sunday-release.js`
Asking to be taken off a Sunday you are ROSTERED to work. Pure: one predicate, one formatter, two strings. Its own module because it is about contracted work and is a request, where everything else on the page is about overtime; why the app needs it at all (leave cannot be written on a Sunday, so the workbook's Sunday tags had no home) is in the header.
- `offersSundayRelease(date, ctx)` — only on a Sunday, rostered to work, with the roster actually READ: a null context is a failed read, not a rest day, so nothing is offered. A context that was read but carries no `isRest` counts as rostered.
- `releaseRequestLine(day)` — the reviewer's flag, or `''`; `overtime-manager.js` renders it BESIDE the answer, never merged into it. `SUNDAY_RELEASE_LABEL` / `SUNDAY_RELEASE_ASKED` — the member's two lines.
- **It grants nothing** — no override, no roster change, no leave — and no surface may word it as agreed (`docs/OVERTIME_AVAILABILITY.md` invariant 14). The control is in `overtime-form.js`; `functions/overtime-core.js` stores it as `releaseRequested`.

### `al-swapped-days.js`
Which days in an annual-leave booking need the SWAPPED-DAY question, and what to write when the answer is yes. Pure, no DOM. Leave on a base-roster rest day costs nothing unless the member swapped a working day onto it, which only the person booking knows — so both booking surfaces ASK, only when a day is affected, and never default; both rules are the owner's (.claude/rules/admin.md → "AL on a rest day is ASKED about"). The defect it closes, and why "rest day" is not the whole test: the header.
- `swapDecisionDates({ dates, memberObj, ovByDate })` → the dates needing an answer, ascending. Never a Sunday, a day before the member's start date (nothing is written there), Christmas Day or Boxing Day (leave there costs nothing whatever the answer), or a day whose record already settles the contract question — read through leave and an absence to what they replaced (`contractEvidence`), with the helpers `consumesEntitlement` uses, so the two cannot drift. **Pass `ovByDate`**: without it a settled day is asked again.
- `replacedTypeForSwap(existing, newType)` → the `replacedType` for a declared swap: `'shift'`, unless the record already names work contracted even on a rest day (a retired `swap` or `allocated`), which it keeps; an Other day or a Spare turn gives way to `'shift'`, as `rdw` does, because on a rest day neither costs a day (owner, 10 Nov 2026). Every value is in the vocabulary `firestore.rules` validates.
- `rangeWriteDates({ type, dates, memberObj, ovByDate, swappedDates })` → the dates `recordRangeOverrides` writes: an asked date only when answered swapped ("Rest day — free" writes nothing), every other date by `isWorkingDate`; never a date before the member's start date, for either type. Absence is never asked, so an absence range is unchanged.
- Consumed by `admin-al.js` (the `swapQuestion` hook — leave only, and the reason is beside it), `admin-overrides.js`, `admin-al-projection.js`, `admin-al-week-save.js`, `admin-week-editor.js` and `admin-roster-upload.js`.

### `admin-al-projection.js`
What an Annual Leave booking WILL do, decided once so the preview, the over-entitlement warning and the write cannot disagree. Pure — no DOM, no Firestore. The defect it closes, and why both booking surfaces ask this one module: the header.
- `willConsume({ member, date, ovByDate, swapped })` — does one date cost a day? It does when the admin has DECLARED it swapped, or the record already says it is contracted work (`consumesEntitlement`); both halves are load-bearing.
- `projectAlBooking({ member, dates, ovByDate, swapAnswers })` → `{ asked, unanswered, consuming, freeWritten, skipped, answeredFree, christmas, writing, lieuLost, counts }`. `unanswered` blocks the save. `skipped` may never hold a date from `consuming`, and holds every date before the member's start date, as `rangeWriteDates` writes none. `answeredFree` is the part of `skipped` that is an ANSWER ("rest day — free", plus Christmas Day and Boxing Day with no work recorded, listed in `christmas`); the week grid drops exactly that from its batch. `lieuLost` is leave written over work that earned a day in lieu (a worked Boxing Day, a Dispatcher's worked bank holiday), found by asking `entitlementFor` with and without the leave.
- `lieuGoesWords(dates)` — the preview's sentence for `lieuLost`: Christmas Day and Boxing Day by name, another bank holiday by its date.
- `rangeSundayCorrections({ dates, memberObj, ovByDate })` → the worked Sundays a range booking (leave OR absence) sets as rest days — `recordRangeOverrides`'s Sunday rule, stated here so both range cards' previews and receipts name them; the writer writes them only beside a day of the booking. Pinned to the writer by `admin-overrides.test.mjs`.
- `overridesAfterSave(overrides, { memberName, writes, deleteIds })` — the overrides as they will stand after the save, because a save can move the allowance as well as spend it.
- `projectAlOverage({ member, memberName, overrides, consuming, exclude, after })` → the over-entitlement message, or `null`. It takes the caller's `consuming` rather than re-deriving it; reads the allowance from `after` when given and also checks any year whose allowance the save LOWERS; charges a January day already moved to last year's allowance to that year; and skips a year with a `null` entitlement (the write still goes ahead).
- Consumed by `admin-al.js` (the `project` and `preSave` hooks) and `admin-al-week-save.js`. Tested by `admin-al-projection.test.mjs`.

### `admin-time-inputs.js`
The Admin week grid's time boxes. `initTimeInputs()` attaches two delegated `document` listeners once per page life: on `input`, reformat with `formatClockInput` (`clock-input.js`) and, once the box holds a real time (`TIME_RE`), move focus from a row's start to its end, or from `#bulkStart` to `#bulkEnd`; on `focusout`, settle the value with `finaliseClockInput` and flag a failure with `.input-error` and `aria-invalid`. The typing rules are `clock-input.js`'s and are never restated here. **The `_formatting` re-entry guard is load-bearing on iOS Safari**, where assigning `value` inside an `input` listener fires another `input`.

### `admin-week-row-state.js`
A week-grid ROW's appearance in each of its states: on and off, drawn from its saved record (remembered by row, for the save to compare with), and the four things that follow its type — the RDW warning, Spare mode, the swapped-day question and the overwrite badge. It imports only `TYPES`, `parseOtherValue`/`OTHER_FLAVOURS` and `setStatus`, and every function takes a row — or, for a week's draft and its drawn records, the grid — and reads the DOM beneath it. **Keep it dependency-free**: if something here needs the editor's state or its injected services, the seam has moved (header, including why the bulk bar was not the seam).
- `_activateRow(row, checkbox, pills, startEl, endEl, type)` / `_deactivateRow(row, checkbox, pills, startEl, endEl)` — a row's two states. Deactivating clears `dataset.type`, which stages a DELETE of a saved record; `_bulkDeselectRow` in `admin-week-editor.js` explains why an untouched saved row must not be deactivated.
- `rosteredWords(baseShift)` — a base shift as a manager reads it in the row's warning ("Training", "Spare", or the times), never the raw code; re-exported by `admin-week-editor.js`.
- `drawnRecords(grid)` — id → the saved record each row was DRAWN from (`prefillRow` remembers it, by row). What a staged removal is compared with (`executeSave`): a read landing under staged edits refreshes the cache but not the grid, so the cache can hold a colleague's record newer than the one its row shows. `drawnDays(grid)` (v25.90) — date → the record each row was drawn from, or null for a row drawn from nothing: what a day the save WRITES is compared with; a date with no row is absent, so "showed nothing" and "not on screen" stay different answers.
- `prefillRow(row, existing)` — the row as its saved record, from a clean row (so it also puts back an edit): the type, an Other day's flavour, RDW tick and times read through its grammar, Spare under Other; marked `prefilled-existing` (untouched, so not staged) and UNTICKED — a tick is only ever the manager's choice of a day for Apply, and unticking a saved day puts it back rather than deleting it (owner, 10 Nov 2026).
- `_syncOtherRdwWarn(row)` — the "originally rostered" warning, only while the RDW tick is on for a day whose base roster is not a rest day.
- `_syncOtherSpareMode(row)` — Spare hides the RDW tick and the times; the other Other flavours bring them back. `_activateRow` re-applies it when Other is chosen again with the Spare chip still on.
- `_syncAlSwap(row)` — the swapped-day question follows the row on every path that changes it (pill, bulk apply, checkbox, bulk tick buttons): shown for staged leave on a day `swapDecisionDates` asks about, hidden and its answer cleared otherwise. A saved, untouched row is not asked.
- `_syncOverwriteBadge(row)` — "✓ Saved" / "⚠ Updating" / "⚠ Removing", through `setStatus`, so the glyph stays `aria-hidden`.
- `isStagedRow(row)` — the ONE test of a staged row: a type that is not the untouched prefill, or a prefilled row with its type taken away (a staged delete). `_hasStagedEdits` (`admin-week-editor.js`) asks it of the grid.
- `readRowDraft(row)` / `applyRowDraft(row, d)` — a row's staged state as data (type, times, Other flavour and RDW tick, swapped-day answer, or a removal), and back again through `_activateRow` / `_deactivateRow`; `applyRowDraft` returns false, touching nothing, when the row can no longer take it. A new per-row control a save reads must be added to both.
- `readWeekDraft(grid, was)` / `applyWeekDraft(grid, rows, was)` → `{ put, left }` — a week's staged rows for `unsaved-draft.js`, each carrying `was` (the saved record it was edited over); a row is put back only while that record is unchanged, and the rest come back in `left`.
- `unsavedWeekDraft(data, recordOn, stillHeld)` (v25.97) — what is still unsaved in a draft kept mid-save, or null: a row whose day now holds exactly what the save was sending (`sending`, from `sendingDays`), or whose deleted record is gone, has landed; every other row is still work, whatever became of the save. Pure.
- `sendingEntries(toSave, toDelete, removedRows, member)` → `SendingDay[]` (v25.97) — what a save sends, one entry a day: `{ member, date, type, value }` per day it writes, `{ member, date, removeId }` per record it deletes; a deleted id with no known row names no day and is left out. Pure.
- `keptWeekDraft(rows, sending, member)` → `{ rows, sending? }` (v25.97) — a week as a draft keeps it: its staged rows, plus the part of the save in flight that is `member`'s, and no `sending` at all when there is none. Pure.

### `admin-own-write.js`
What a write the Admin page makes ITSELF does to Change a Shift's week — a Saved Changes or Recorded dates delete, a leave or absence range (or the part that landed), a leave-year move; not the week's own save, which redraws the week. The grid's functions arrive through `initOwnWrite`, so it loads in Node. **Only the days the write touched**: with nothing staged the week is redrawn as before; otherwise a touched day's row is swapped for the row a fresh draw makes, and only when its record changed. Every other row keeps the record it was drawn from, which keeps a colleague's change refused at Save (header).
- `initOwnWrite({ build, redraw, recount, hasStagedEdits, markChanged })` — from `initOverrides`: `buildWeekGridInto`, `renderWeekGrid`, `updateSaveBtn`, `_hasStagedEdits`, and the page's `markChanged`.
- `ownWriteRowAction({ drawn, now, staged })` → `'keep' | 'redraw' | 'clear'` — pure. A staged change on a day the write changed is CLEARED, never saved over the day as it now stands; a staged removal whose record is already gone is simply redrawn.
- `syncWeekAfterOwnWrite(rows)` → the days whose staged change it cleared. Called once the cache holds the write's result, by `admin-saved-changes.js` (as `onOwnWrite`), `recordRangeOverrides` (also part-done), `setLeaveYear` and `admin-app.js`'s Recorded dates delete. Clearing runs `markChanged`, which drops the over-allowance bar's captured batch.
- `clearedDaysLine(dates)` / `withClearedDays(text, dates)` — what the card that made the write says: "Your unsaved change to Mon 24 Aug in Change a Shift was cleared, because that day has just changed. Set it again if you still want it."
- Tested by `admin-own-write.test.mjs` and, through each writer, `admin-saved-changes.test.mjs`, `admin-overrides.test.mjs` and `e2e/admin.spec.js`.

### `admin-bulk-apply.js`
What the week card's "Apply to ticked days" is waiting for, as the sentence the line under it says. Pure: it imports only `isForbiddenOnSunday` (override-utils.js, so `SUNDAY_FORBIDDEN_TYPES` is consulted, never restated) and `isSunday`. **Not a layer of the Sunday rule** — the apply still skips a Sunday row itself (layer 2); this only stops Apply being offered when nothing could apply (owner, 8 Nov 2026).
- `bulkApplyWaitingFor(tickedDates, type, leftAlone?)` → `''` when Apply can act; otherwise, in order: "Tick at least one day and choose a type" / "Tick the days to apply it to" / "Choose a type for the ticked day(s)" / "Sunday isn’t a contracted day — tick a working day" (every ticked day a Sunday, and a type a Sunday refuses) / a sentence when every other ticked day is one `leftAlone(date)` names — `'rest'` (Absent on a rest day, owner 10 Nov 2026) or `'start'` (before the member's start date). `_updateBulkSelCount` (admin-week-editor.js) greys Apply out on any non-empty answer and writes it into `#bulkApplyHint`; `_leftAloneBy` there supplies `leftAlone`.
- `bulkSkippedLine(applied, skipped, fmt)` — the line Apply leaves: "Set N days — …", naming each day it left alone, in the Absence card's and the roster import's words for a rest day.

### `admin-al-week-save.js`
What ONE week-grid save does about the annual leave in it. Pure — no DOM, no Firestore. `admin-al-projection.js` says what a date means, this says what a batch does with a set of them, and `admin-app.js` keeps the DOM half (show the confirmation bar, or commit).
- `planAlWeekSave({ member, memberName, toSave, toDelete, ovByDate, swapAnswers, overrides })` → `{ toSave, skipped, keptLeave, unanswered, overage }`. `toSave` is the batch to write (the same array when nothing was dropped); `skipped` the days answered "rest day — free", which the receipt names; `keptLeave` those of them still holding leave, so the receipt does not call them clear; `unanswered` rest days withheld from the batch, which the caller must refuse and name; `overage` the confirmation message or `null` — checked even with no leave in the batch, because deleting a worked Boxing Day takes back its day in lieu.
- **Two orderings are load-bearing** (header; mutation-tested in `admin-al-week-save.test.mjs`): the answered-free drop comes before `exclude` is built, and the bar reads the projection's `consuming`, never the batch.

### `admin-al-spare-note.js`
The one sentence the Annual Leave booking preview says about Spare days. Pure; a module of its own so the wording is unit-tested, because the template literal it replaced was ungrammatical for months with nothing able to read it (header).
- `spareShiftNote(spareCount, totalDays)` → plain text, or `''`; three branches, because English has three: "This is a Spare day" (a one-day booking), "1 of these days is a Spare day", "N of these days are Spare days".
- `countSpareDays(memberObj, dates, ovByDate)` → how many dates are STILL Spare, read through `resolveEffectiveShift` (a Spare day since given a shift is not counted; a saved Spare override is), and COST a day by `consumesEntitlement` — so never a Sunday, 25/26 December or a Spare turn saved on a base rest day, which is free (owner, 10 Nov 2026).
- **A day is a day** (owner decision): every branch ends "uses 1 day of annual leave", and nothing may suggest a Spare day costs more. It carries 📋, never ⚠ (information, not a caution), and is in the third person, because a manager books for somebody else from the same card. Tested by `admin-al-spare-note.test.mjs` and, wired, by `e2e/admin.spec.js`.

### `admin-period-dates.js`
What a run of booked dates is, and what it reads as: the pure helpers the Recorded-dates lists are built from (`admin-booked-periods.js` takes them as injected handles), plus `formatDisplay`.
- `addDays(dateStr, n)` → ISO string. `fmtPeriodDate(d)` → "Mon 15 Jun"; `fmtPeriodRange(start, end)` → "Mon 15 – Fri 19 Jun", naming both months when a range crosses one. `formatDisplay(str)` → "18 Mar 2026" (re-exported by `admin-overrides.js`). `namedDays(dates)` (v25.90) → the days a refused save names: "Tue 16 Jun", "… and Wed 17 Jun", past three the first two and a count, "a day in this save" for none.
- `isRestGap(dateStr, memberObj)` — **a gap is not the same as a day off.** It decides whether bookings either side of a date are one period or two: a Sunday is always a gap, a base-roster rest day is a gap, and anything else is not — including a day whose base shift cannot be resolved. Merging wrongly claims leave across a worked day; splitting wrongly only shows two short rows (header). Tested by `admin-period-dates.test.mjs`.

### `admin-booked-periods.js`
The **Recorded Annual Leave dates** and **Recorded Absence dates** sub-cards on `admin.html` — one renderer for two lists that differ only in the type they filter and the colour of their count pill — and which YEAR of the list is on screen. Imports only `leave-year.js` (which imports nothing); every other handle is injected, so the decisions are testable in Node. Why it left the coordinator, and the owner's year-end rule: the header.
- `splitAtYearEnd(periods, dateList)` — cuts every merged booking at each year end so each date sits in its own year, recounting each segment from the booked dates (a bridged rest day is not leave); a piece of a longer booking carries `splitFrom` / `splitTo`, so its row can say it continues.
- `bookedYears(segments)` → the years with bookings, ascending.
- `pickBookedYear({ pinned, preferred, years })` → a tapped year, then the AL banner's year, then the latest year with data. It only ever returns a year IN `years`, or `null`: an empty list on this card reads as "nothing booked".
- `createBookedPeriods(deps)` → `{ render(cfg), resetPinned(), pin(boxId, year) }`. On the AL card `cfg.consumes` is the entitlement rule, so the list and the banner count one way, and `cfg.christmas` / `cfg.christmasFor(year)` add a year's Christmas leave as an uncounted row for any year on screen. `resetPinned` runs on a member change; `pin` serves `?alYear=YYYY`, the Calendar leave panel's link.
- A row's ✕ deletes from its first listed date to its last, widened to uncounted leave on rest days at either edge (never past a Sunday or the year end), and hands focus on after a delete. A January day moved to the previous year's allowance is marked on its row, and that year's list names it in a closing line.
- `armConfirm(btn, armedText, idleText, armedName?)` / `disarmConfirm(btn, idleText)` — the two-tap destructive control, one disarm timer per control (never while it is `disabled`, i.e. in flight); `holdFeedback(el)` / `fadeFeedback(el, idleClass, ms)` — one fade per feedback line, cancelled by every later write. Shared with `admin-saved-changes.js` and `admin-range-booking.js`.
- **It states no total**: the banner above owns the figures and this owns the dates.
- Consumed by `admin-app.js` (`updateALBookedBox` / `updateSickBookedBox`), which passes `preferredYear` on the AL card only.

### `admin-sick.js`
The Record Absence card on `admin.html`: a thin config over `createRangeBookingSection` (`admin-range-booking.js`). `initSickSection(deps)` supplies the one-year range cap (maternity, long-term absence) and the 🪑 preview, and returns `{ updateSickPreview }` for a member change. No entitlement check, no confirm bar and no swapped-day question: absence is not capped. **Nothing on the card is scoped to a year**, which is why the range picker's `onViewYearChange` is deliberately not wired here and the recorded-absences box is given no `preferredYear` (header). DOM handles and callbacks arrive through `deps`, to avoid circular imports.

### `admin-overrides.js`
The Change a Shift coordinator: the two save paths, the validation glue and `buildMemberDateMap`. The grid, the list, the cache and the type table live in `admin-week-editor.js`, `admin-saved-changes.js`, `admin-override-store.js` and `admin-shift-types.js`, and are RE-EXPORTED here so `admin-app.js` and the tests keep one import site.
- `initOverrides(opts)` — called once by `admin-app.js` after sign-in; wires the editor, the list, the store and the own-write sync (`initOwnWrite`, `admin-own-write.js`), injecting the renderers so the graph stays acyclic. Identity is re-assigned on every call; the once-only wiring guards live with the listeners.
- `executeSave(toSave, toDelete = [], skipped = [], keptLeave = [])` — writes the staged rows. It re-reads each `existingId` from the cache at save time, refuses unless `hasOverrideAuthorityFor` holds for every member the batch touches, writes each day to its fixed `manualOverrideId`, and commits the whole save — writes and removals — through `commitChecked` (`admin-override-store.js`): online, ONE transaction in which each day it writes must still hold what its row showed (`drawnDays`; a day with no row on screen, the cache's winning record) and each removal the record its row DREW (`drawnRecords`; the cache only for a copy no row drew), refused whole with the changed days named (`namedDays`); offline, a save that only writes is a batch held on the device, unchecked, and one that removes waits for the server. It reports a per-day receipt (`buildSaveReceipt`) — even when nothing was written.
- `recordRangeOverrides({ type, value, memberName, dates, changedBy, swappedDates? })` — the batch writer behind both range cards (`admin-range-booking.js`). It writes the dates `rangeWriteDates` chooses, adds a Sunday RD correction where a worked base Sunday sits in the range (never over a `WORKED_OVERRIDE_TYPES` record), commits in chunks under Firestore's batch cap — each chunk through `commitChecked` since v25.90, so each day must still hold what the page had for it, or the chunk is refused naming the days — and tags a failure after an earlier chunk committed as `partialCommit`. Throws `cache/load-failed` without authority for the member. Returns `{ workingCount, sundayCount, cleared }`: the week follows the booked days (`syncWeekAfterOwnWrite`), and `cleared` names a change staged on one of them that it cleared — on a part-done failure as `err.cleared`, once what landed is in the cache.
- `buildMemberDateMap(memberName)` — the winning cached record per date for one member. `getEffectiveShift(...)` / `validateShiftRules(...)` — resolve the neighbouring days and mark the rows `checkShiftRules` (`admin-shift-rules.js`) says failed.
- Re-exports, each described in its home module's entry: `TYPES`, `PILL_TYPES`; `renderWeekGrid`, `buildWeekGridInto`, `updateWeekNavLabel`, `updateSaveBtn`, `resetBulkPills`, `_hasStagedEdits`, `setSaveInFlight`, `isSaveInFlight`, `sendingDays`; `renderTable`, `resetTableMemberFilter`; `initOverrideStore`, `getAllOverrides`, `setAllOverrides`, `removeFromCache`, `whenOverridesReady`, `whenLoadSettled`, `isOverrideCacheLoaded`, `hasOverrideAuthorityFor`, `loadOverrides`, `ensureMemberLoaded`; `isWorkingDate` (`al-entitlement.js`); `formatDisplay` (`admin-period-dates.js`).
- **Write invariants**, each argued beside its line: both writers wait for the boot load and then for any load in flight (`whenLoadSettled`), and merge their new records into the cache BY ID; the writes are rebuilt from nothing on every run (`fill`), because a `writeWithClaimRetry` retry and a transaction Firestore runs again both call it afresh; `swapped` and `existingId` are stripped before the write, because a stray key fails `hasOnly()` in `firestore.rules`. Tested by `admin-overrides.test.mjs`.

### `admin-save-receipt.js`
What a save did, said day by day. Pure. `buildSaveReceipt({ toSave, removed, memberName, formatDate, describe, skipped?, keptLeave? })` → `{ summary, lines }`: one line per DATE in date order, because a manager checks a receipt against a run of days, not a list of documents. A removed day is named as removed, never omitted, and a removal the cache could not resolve is still counted. A day deliberately left alone (`skipped`) is named and not counted — in different words when leave still stands on it (`keptLeave`), and when it is Christmas Day or Boxing Day. `removed` must be captured BEFORE the batch commits. Tested by `admin-save-receipt.test.mjs`.

### `slow-save.js`
Say so when a save is waiting on the server. With `persistentLocalCache` a write lands on the device first and `commit()` then waits for the server with no limit, so on a weak signal the Save button read as frozen (header). The watcher is pure (timers injected); the notice is one reference-counted live line, styled in `shared.css` because Operations uses it too.
- `watchSlowCommit(promise, { ms, onSlow, onDone, setTimer, clearTimer })` → the SAME promise; `onSlow` fires once if it is still unsettled after `ms`, and `onDone` fires on settlement only if `onSlow` did.
- `withSlowSaveNotice(promise, { batched?, held? })` — wraps an app write: after `SLOW_SAVE_MS` it shows `#slowSaveNotice` (`role="status"`) and hides it on settlement, leaving the caller's receipt and error paths untouched. `batched: true` marks one of several chunks, whose line asks the reader to keep the page open; `held: false` marks a TRANSACTION, which no device holds (v25.89), and asks the same.
- `slowSaveText(batched, held = true)` — `SLOW_SAVE_TEXT` / `SLOW_SAVE_TEXT_BATCHED` / `SLOW_SAVE_TEXT_UNHELD` when `navigator.onLine === false`, otherwise `SLOW_SAVE_TEXT_ONLINE` / `SLOW_SAVE_TEXT_BATCHED_ONLINE` / `SLOW_SAVE_TEXT_UNHELD_ONLINE`; a batched write wins, then an unheld one. It is a timer and cannot know why a save is slow, so it names the signal only when the browser reports being offline, and it never tells a transaction it is "held on this device".
- `writesInFlight()` — wrapped writes still waiting, plus `backgroundWritesInFlight()`, plus one while `hasUnconfirmedWrite()` (`claim-retry.js`). Read by the service-worker reload guards of Admin, Settings and Operations, by Admin's re-read on return, and by `askBeforeSignOut` (`page-session.js`).
- `SLOW_SAVE_EVENT` — `{ phase: 'slow', batched }` at the threshold and `{ phase: 'done', ms, hiddenMs, onlineWhenSlow, batched, ok }` on settlement, both with the save's `id`; `error-reporter.js` listens and logs the slow-while-online case. An event rather than an import, so this module stays Firebase-free.
- `trackHiddenTime({ isHidden, subscribe, now })` → `{ stop() }` — a stopwatch for the time the page spends hidden, from the start of each wrapped save to its settlement: `stop()` returns the milliseconds, or `null` when the browser cannot say (never a 0 that would read as "on screen"). An installed iPhone app is frozen while hidden and the clock runs on, so this is what separates a phone's wait from the connection's (v25.87; the header says why it counts to its own stop rather than waiting for the event back).
- **It never says "saved"** (a held write can still be refused) **and never gives the button back** (a second tap repeats a write that is still held). `window.__E2E.slowSaveMs` is a test seam only. Wraps the Admin override writes and deletes, the leave-year save, the roster upload, the Settings work-email card, and Operations' own writes (a work email, a cleared reset request, a resolved error).

### `admin-shift-types.js`
The shift-type table the Change a Shift surface is built from: pure data, no imports, so every consumer can read it without importing the coordinator back.
- `TYPES` — per-type metadata (`label`, `pill`, `fixed`, `fixedValue`; `other` adds `timesOptional`). No row exists for the retired `allocated` / `overtime` / `swap`.
- `PILL_TYPES` — the ONE ordered declaration of which pills exist. Both pill rows are generated from it — the week editor's per-row pills and `admin-app.js`'s bulk bar — and neither may restate it. Spare is reached through the Other submenu but stays its own `spare_shift` type.
- `WORKED_OVERRIDE_TYPES` — the types a Sunday RD correction must never overwrite. The retired types are not in it, because no record of them remains (owner, 7 Nov 2026; the comment beside it).
- `rowValueText(type, value)` → what a Saved Changes row prints for a stored value, or `''` where it would only repeat the badge (so "Absent" never sits beside "SICK"). It fails toward SHOWING: an unknown type, or a value that disagrees with its type's fixed value, is printed.

### `admin-week-editor.js`
The seven-day Change a Shift grid, its pills, the bulk bar and everything staged but not saved; it ends where `executeSave` begins. Permissions, feedback, the dirty marker and `memberDateMap` arrive through `initWeekEditor`, which keeps it out of a cycle with the coordinator. Why staged edits count both ways, and why an unread member draws a loading or a failed state rather than seven base-roster days: the header.
- `initWeekEditor(deps)` — re-assigns identity on every call; attaches the delegated listeners (the bulk bar, `initTimeInputs`) once per page life, because a second attach makes one tap of a two-tap control both arm and execute.
- `renderWeekGrid()` / `buildWeekGridInto(container, dateStr)` (the swipe carousel uses it to build a neighbour) / `updateWeekNavLabel(dateStr)` (the label is also the week jump's accessible name).
- `updateSaveBtn()` — the Save button, the sticky bar and the inline "You're about to…" preview, from the staged rows. `resetBulkPills()` · `resetStagedRows()` (after a save that wrote nothing; a save that wrote redraws the week as saved).
- `setSaveInFlight(on, { grid, sending })` / `isSaveInFlight()` — the page's ONE write lock: while it is set, Save, the sticky bar's Save and Discard, and the unsaved banner's "Discard and continue" stay disabled, and the range cards refuse to start (`admin-range-booking.js` says why). `grid` — the week's own save — also holds the grid and the bulk bar `inert` until it lands, because it redraws the week then and a change made in the wait would be thrown away. `sending` — what that save sends (`sendingEntries`) — is held until it settles.
- `sendingDays()` (v25.97) — what the week's save in flight is sending, or null between saves (a range booking sends none). `admin-app.js` keeps it with a draft taken mid-save (`keptWeekDraft`), so the next load offers back only what did not land (`unsavedWeekDraft`; `unsaved-draft.js` rule 6).
- `_hasStagedEdits()` — a staged add or change AND a staged removal; background refreshes skip `renderWeekGrid()` while it is true, and the page's own writes then redraw only the days they touched (`admin-own-write.js`).
- **It holds Sunday enforcement layers 1 and 2** (CLAUDE.md → "Sundays are non-contracted"): the per-row pills for every forbidden type are disabled with the reason in their accessible name, and the bulk sweep skips a ticked Sunday and says how many it dropped. `override-utils.test.mjs` only pins that each layer names every forbidden type; whether a pill is really dead is tested by `e2e/admin.spec.js`, on a rendered row.

### `admin-saved-changes.js`
The Saved Changes list, and un-recording. `initSavedChanges(deps)` takes the permissions and `onOwnWrite` — the week's own-write sync, handed the rows each delete removed (`admin-own-write.js`; injected, so no cycle with the coordinator) — and wires its delegated listeners once per page life. A change staged on a deleted day is cleared, and named on the list's line, which then does not fade. `renderTable()` draws the list with its month and member filters and its count chip; `resetTableMemberFilter()` clears the All-staff toggle on a member change. Both delete paths — a row's two-tap ✕, and the bulk delete of ticked rows — compare and delete in ONE transaction (`deleteIfUnchanged`, the rows captured at the press by `asShown`); a bulk delete goes in chunks that never split a day from the older copies it hides (`deleteChunks`), is pre-checked whole when it takes more than one, says an unconfirmed outcome first (a sign-out ends the wait, not the write) and otherwise reports a part-done stop as part done, and names any older copies of a day removed alongside. **`coversAllStaff()` is asked at RENDER time**, not at the toggle, so a per-member cache is never labelled "(all staff)" (header).

### `admin-override-store.js`
The Admin override cache, the reads that fill it, and the states they put on screen. The renderers arrive through `initOverrideStore({ renderTable, renderWeekGrid, hasStagedEdits, onAfterLoad })`, never imported back. The header names the three things silent when wrong: the in-flight guard is keyed by the QUERY, a capped collection read never covers a write, and waiting and stuck are different states.
- `loadOverrides({ everyone?, member? })` — STAGED: the selected member first (`where('memberName','==',…)`, no cap, no index), the whole collection only when All staff asks, and once it has, later resyncs stay whole. The same query shares a flight; a different one CHAINS behind it. A read served from the offline cache is a FAILED load (`refuseCachedRead`), handled by the failed week grid, Retry (which also fires itself on `online`) and the save refusal. Every read waits for `sessionReady` first. `ensureMemberLoaded(member)` — a no-op, resolved at once, when the member is already covered.
- `getAllOverrides()` · `setAllOverrides(arr)` (ASSERTS completeness, so grants full coverage — a TEST SEAM: no app caller) · `removeFromCache(ids)` (drops rows, grants nothing — every delete) · `mutateCache(fn)` (rearranges rows, learns nothing — the post-write updates).
- `whenOverridesReady()` — a one-shot latch for the BOOT load, resolving on failure too, so Save never hangs. `whenLoadSettled()` — settles behind whatever load runs NOW; every save path awaits it after committing, so an earlier read cannot drop the day just saved.
- `hasOverrideAuthorityFor(member)` — the question every write gate asks (the rules: `admin-override-coverage.js`). `isOverrideCacheLoaded()` — the page-wide "has anything loaded" flag, which no write gate asks — a TEST SEAM: no app caller. `coversAllStaff()` — the All-staff LIST's question, true for a capped read too. `loadFailedFor(member)` · `isTruncated()` · `OVERRIDES_QUERY_CAP` (the whole-collection read's bound, fetched `+ 1` so a truncation is detected).
- `idsReplacedBy(memberName, date, winnerId)` — what a manual write of a day replaces: the winner and every manual record of the day, never the fixed id it lands on. `withManualDuplicates(ids)` — a delete widened by the manual duplicates each id outranks, so an old duplicate cannot resurface.
- **Every guarded write is ONE transaction:** `commitIfUnchanged(items, write, { mustExist?, mustBeAbsent?, line?, alreadyDone? })` → `{ done, latest }` reads each of `items` (a row as shown, or an id looked up in the cache) and of `mustBeAbsent`, and refuses — `DELETE_REFUSED` with `line` and the changed `dates`, nothing written — unless each is still the record the page showed (`sameOverrideRecord`, `override-compare.js`) or, where it showed nothing, nothing. A document already gone is no difference unless in `mustExist`; an id in `mustBeAbsent` must hold nothing, whatever the cache has under it; `line` may be a function of the dates. Only then does `write(tx, latest)` add the writes. Firestore re-runs it when anything it read changes before the commit, and after a commit whose answer was lost — when `alreadyDone(latest)` says the server already holds the result, nothing more is written and `done` is true.
- **Deletes:** `deleteIfUnchanged(items)` — the delete behind a row's or a period's ✕ and each bulk-delete chunk (a week-grid save's removals go through `commitChecked`); `asShown(ids)` captures the rows at the press; `deleteChunks(picked, size)` splits a bulk delete without ever parting a day from the older copies it hides. `findChangedSince(rows)` / `staleDeleteVerdict(items)` are the bulk delete's whole-list PRE-check, outside any transaction. `CHANGED_ELSEWHERE_LINE` / `UNCHECKED_DELETE_LINE` are the refusals.
- **An ordinary save is checked too, whenever the server can be asked:** `commitChecked(write, { shownFor, removed?, line, holdOffline? })` → `{ checked, done }` runs `write` once against a recorder to learn every document the save sets and deletes, then commits it through `commitIfUnchanged`: what it deletes, and `removed`, must still be what the page holds, and each day it sets must still hold the record `shownFor` says the page showed (`mustExist`) and nothing at the day's fixed id unless that is it (`mustBeAbsent`); a lost answer is recognised as the save's own records (`done`). Offline (`navigator.onLine === false`), or when the transaction ends `unavailable` / `deadline-exceeded`, it is a batch held on the device, unchecked (`checked: false`) — unless `holdOffline: false` (a save that removes a day), which never becomes a batch. The week grid's save and each chunk of a range booking commit through it.
- **So is the leave-year move** (`admin-leave-year-save.js`, whose entry has the rest): `commitIfUnchanged` with the record shown as `mustExist`, refusing with `LEAVE_YEAR_CHANGED_LINE`.
- Tested by `admin-override-store.test.mjs` and, through the writers, `admin-overrides.test.mjs`.

### `override-id.js`
The ONE document id a manual override is written to. Pure. `manualOverrideId(memberName, date)` → `'m_<date>_<encodeURIComponent(name)>'`, so two editors saving one day land on the same document (one record) instead of leaving two — and since v25.90 the second is refused whenever it can check the server (`commitChecked`, `admin-override-store.js`). Roster imports keep random ids, because an import and a manual record coexist by design (header). Used by `admin-overrides.js`, `admin-override-store.js` and `admin-leave-year-save.js`; tested by `override-utils.test.mjs` and, wired, by `admin-overrides.test.mjs` ("two editors saving the same day").

### `override-compare.js`
Is the server's copy of a day still the record this page showed? Pure. `sameOverrideRecord(was, now)` compares `memberName`, `date`, `type`, `value`, `note`, `source`, `replacedType` and `leaveYear` (absent ≡ empty), the `createdAt` revision — except on the page's own optimistic copy, whose stamp is the device's clock — and `changedBy` where the page has one; any difference in these reads as changed, and so does a missing record on either side. It is the question every guarded Admin write asks inside its transaction (`commitIfUnchanged`, `admin-override-store.js`) — a delete, an ordinary save through `commitChecked`, the leave-year move — and the bulk delete's pre-check (`findChangedSince`). `overrideFromSnapshot(d)` is how a record read OUTSIDE a transaction is held — Admin's two list reads and the import's week read (`fetchOverridesForWeek`): a document this device has written but not yet sent (`metadata.hasPendingWrites`) has no server stamp, so it is stamped as the page's own copy (a `Date`, the SDK's estimate), or the check refused the member's own record once the save landed (v25.96, found on the real SDK). Tested by `override-utils.test.mjs`, and wired by `admin-override-store.test.mjs` (block 8b), `admin-roster-upload.test.mjs`, `admin-overrides.test.mjs` and the signed-in lane's "back online" journey.

### `admin-override-coverage.js`
What the Admin override cache actually KNOWS. Pure — no DOM, no Firebase, no imports. An unfetched member and a member with no overrides produce the same empty slice, so authority is answered from what was REQUESTED, never from the data (header, which also argues why the scope is a member and not a date window).
- `emptyCoverage()` / `withMember(cov, member)` / `withAll(cov, { complete })` — build the record, never in place. A CAPPED read (`complete: false`) clears `all` and sets `allPartial`: it replaced the cache, so an earlier complete read no longer describes it.
- `hasAuthorityFor(cov, member)` — the question every write gate asks; full coverage is checked first. `coversEveryone(cov)` — the All-staff view's separate question: fifty members read one at a time is not the collection.
- `replaceMemberSlice(docs, member, fresh)` — a replace, not a merge: the read is authoritative for that member, so a document it omits has been deleted. `mergeCappedRead(docs, fresh, members)` — after a capped read, keeps the individually covered members' documents from beyond the cap.
- Tested by `admin-override-coverage.test.mjs`.

### `admin-shift-rules.js`
The two rules a shift change must not break — maximum length and minimum rest — and the days that take no change at all. Pure: it DECIDES, and the caller (`validateShiftRules`, `admin-overrides.js`) PAINTS.
- `checkShiftRules({ toSave, isFixedType, resolveShift, baseShiftFor, formatDate, shiftDate })` → `{ errors, failedDates }`; `failedDates` is deduplicated, so a row breaking both neighbours is marked once while both sentences are still said. The neighbouring day comes from the INJECTED `resolveShift`, because a missed rest gap and an unloaded cache look identical from inside.
- `constrainingTime(value, baseShiftFor)` — what an adjacent day constrains by; `null` means "does not constrain", which is not "constrains by nothing". An Other day has three cases (timed, untimed RDW, untimed on the base shift), set out in the header.
- `checkDayRules({ toSave, member, formatDate })` → `{ errors, failedDates }` — the days that take no change at all: before the member's start date (the Calendar never shows it) and an Other day on Boxing Day (owner, Jul 2026). The Save's backstop, run by `admin-app.js` AFTER the collector; the grid refuses both at the pills first. `isBoxingDay(iso)`.
- `weekStepAllowed(iso, days)` — may the week grid move that far? Never further outside `CONFIG.MIN_YEAR`–`MAX_YEAR`, always back towards them; asked by the arrows' disabled state (`updateWeekNavLabel`), `shiftWeek` and the swipe's adjacent panel. `linkableDate(s)` — a `?date=` that is a real day inside those years.
- `MAX_SHIFT_MINS` / `MIN_REST_MINS` · `parseMinutes` · `effectiveEndMins` · `fmtHours`. Tested by `admin-shift-rules.test.mjs`.

### `admin-deep-link.js`
Where a hash on `admin.html` lands. Admin is a page of folded cards, so a link helps only if what it names is unfolded on arrival — and the Recorded Annual Leave dates box is a fold inside a fold. The header numbers three things not to "tidy".
- `resolveDeepLink(hash, doc)` → `{ folds, scrollTo, settleOn }` or `null` — which folds to open, what to scroll to now, and the id to finish on later. It opens nothing: `openCollapsibleCard` in `admin-app.js` keeps `aria-expanded` in step. The hash is decoded in a `try` and never handed to `querySelector`, where a malformed hash throws and the reload it causes loops.
- `NESTED_DEEP_LINKS` — an explicit map, not a guessed selector, because a link that opens the WRONG fold is worse than none.
- `createDeepLinkLanding(win)` → `{ arrive(resolved), settle(boxId) }` — the scrolling. A nested target scrolls to its card first and to itself once its render gives it a height (`settle`, from the booked-dates renderer's `onRendered`), once only, and the second scroll cancels the first with an instant scroll to where the page already is. `e2e/admin.spec.js` asserts the box's bottom edge, because "did it scroll?" passes on the broken behaviour.

### `admin-rangepicker.js`
The inline date-range calendar both range cards use, through `admin-range-booking.js`.
- `buildRangePicker(prefix, { onViewYearChange? })` — a swipeable month grid wired to the hidden `#{prefix}From` / `#{prefix}To` inputs, with chip labels and a clear button; returns `{ reset({ keepView? }) }` — `keepView`, which a save passes, clears the range but leaves the month on screen. `onViewYearChange` fires when the DISPLAYED month crosses into another year, never on build. Its arrows, keys and swipe move only between `CONFIG.MIN_YEAR` and `MAX_YEAR`, as the Calendar's. A swipe turns the month past `SWIPE_THRESHOLD` or `SWIPE_VELOCITY`, and month names come from `MONTH_NAMES` (all `roster-data.js`). Pointer capture is on the grid, never the clip (CLAUDE.md → architecture decisions).
- `getDateRange(fromVal, toVal)` — pure: the inclusive ISO date list; `null` when reversed, `[]` when either input is empty. Tested by `admin-rangepicker.test.mjs`.

### `date-picker.js`
The app's own single-date picker, replacing the native `<input type="date">` popup the app cannot style. Used by the four Operations upload date fields, Admin's week jump and Team View's week jump (`calendar-team-view.js`, loaded lazily). Built on `createLightbox`; its CSS (`.dp-*`, `.date-trigger`) is in `shared.css`, because three pages use it.
- `initDatePickers(inputIds)` — progressive enhancement: each input stays in the DOM, hidden, as the value holder (so `doc-upload.js` and the roster card's Saturday snap work unchanged), and a `.date-trigger` button opens ONE shared modal calendar. A pick sets `input.value` and dispatches `input` and `change`; the label is re-read afterwards, so a consumer's normalisation shows through.
- `openDatePicker(input, { title?, week? })` — opens the calendar for any date input, for a page with its own trigger. `title` is passed rather than read off the input, because such a caller has moved the `aria-label` to its trigger. `week: true` gives a Sunday-first week picker with the chosen and hovered weeks banded; picking still sets one day. It dispatches `date-picker-opening` FIRST, synchronously, so a consumer can refresh `min` / `max` before they are read (why here and not in the click handler: the comment beside it).
- `monthCells(year, month, weekStart = 1)` — pure: a flat month grid (`null` padding, then ISO days), Monday-first by default. Tested by `date-picker.test.mjs`.

### `date-format.js`
ONE spelling of a date, everywhere the app writes one in words. Pure, and imports NOTHING, so a module can take a date vocabulary without taking the roster. `Intl` with `month: 'short'` spells September "Sept" in en-GB on every engine the app runs on, which put "18 Sept" beside the calendar's "18 Sep" (header; `month-vocabulary-parity.test.mjs` fails on a new local fix).
- `DAY_NAMES` / `MONTH_ABB` — the name tables, owned here and re-exported by `roster-data.js`.
- `formatDayMonth(d)` → "18 Sep" · `formatDayMonthYear(d)` → "18 Sep 2026" · `formatDayMonthYear2(d)` → "18 Sep 26" (the year zero-padded) · `formatWeekdayDate(d, withYear?)` → "Fri 18 Sep" (the year is opt-in) · `formatClock(d)` → "14:23" (`hourCycle: 'h23'`, so midnight is never "24:00").
- `printedStamp(date, clock)` → "Printed Fri 18 Sep 2026 · 14:23", the provenance line every printable surface closes on. The clock is PASSED IN, so a surface cannot inherit the wrong zone.
- `londonDate(at)` / `londonClock(at)` — the zone shim for a roster-office document that must read as London wall-clock. `londonDate` returns the London date as a local Date at NOON (a London time on it would be in reach of a DST gap); `londonClock` formats through `Intl` in London and builds no local Date.
- `NO_DATE` (`'—'`) — what every composer returns for an unusable date, never "NaN undefined NaN"; an em dash rather than a blank, because "no date recorded" is a different, legitimate state.

### `huddle.js`
The Daily Huddle upload card (Operations, admin only) and the Notifications card (Settings, all staff).
- `initHuddleUpload({ currentIsAdmin, currentUser })` — called by `operations-app.js`; reveals the card for an admin and wires it through `initDocUploadCard` with the Huddle's differences: PDF or Word, a date cap of tomorrow (it is sent the evening before), and a Mammoth DOCX→HTML transform loaded once from an SRI-pinned CDN. A converter that will not load is not fatal — the file uploads without inline HTML, like a PDF; only a parse failure aborts. The inline-HTML cap matches the server's (`upload-cap-parity.test.mjs`).
- `initHuddleNotifications({ onState? })` — called by `settings-app.js`; the subscribe and unsubscribe card, through `notif.js`, which owns the VAPID key and the fingerprint re-subscription. The card reads state with `peekNotifState`, deliberately avoiding that side effect, reports it through `onState` so Settings can show a header chip without restating this module's words, and returns the card's collapse handle.

### `doc-upload.js`
The shared skeleton of the Operations document upload cards: the Weekly Retail Circular and the Marylebone Newsletter (`operations-app.js`) and the Daily Huddle (`huddle.js`). `initDocUploadCard(cfg)` owns pick → validate (type and size) → an optional pre-upload `transform` → upload → feedback, and the date cap (today, or today plus `maxDateOffsetDays`), recomputed on every submit and whenever the date picker opens, because a tab left open overnight would otherwise upload under yesterday's date and overwrite that day's document. `isPdfFile(f)` / `isDocxFile(f)` are the accept predicates (a `.docx` is matched by its extension, because Android often reports one as a ZIP).
- One upload at a time per card — the picker is disabled and a stray pick or press is ignored until the answer. The upload runs through `runGatedWrite` and a sign-out is worded by `unconfirmedWriteLine` (optional `whereToCheck`); `successMsg` is handed the date as app copy spells it (`10 Nov 2026`).
- **`MAX_UPLOAD_BYTES` is one of THREE declarations of the upload size limit**, with `MAX_FILE_BYTES` in `functions/index.js` and the cap in each of `storage.rules`' upload blocks. `upload-cap-parity.test.mjs` derives all three from source and pins the card's "maximum" sentence to them; its header says why a client cap above the rules' is the costly direction.

### `admin-auth.js`
The Staff Login Accounts card on Operations (admin only). `initAuthSetup({ currentIsAdmin, onAttention?, onWithdraw? })` — called once by `operations-app.js`. Its button calls the `setupRosterAuth` Cloud Function with a fresh ID token (`getIdTokenResult(true)`) as the bearer — no client secret — and the member and role lists are server-owned.
- **The provisioning audit.** On load and after every run it reads `getAccountSetupGaps` and states, above the controls, who has no login, whose claim is wrong and which leaver can still sign in. It is a READ and deliberately not a repair, because an audit that fixed what it found would make the gap invisible again. Three states that never collapse into one another: gaps found · none found · **could not tell** (a refusal, a failed call, or a reply missing either list). `onAttention({ setUp, leavers })` fires only when the audit answered, because the Needs-attention strip reads an unreported item as unknown and an absent one as nothing to do; `onWithdraw` fires whenever a check could not tell, so a count an earlier answer reported goes back to unknown with it. Tested by `admin-auth.test.mjs`.

### `roster-cell-rules.js`
What a parsed roster cell MEANS as an override. Its own module because the review's state machine and the entry control both need it and both obvious homes form a cycle (header). Its three rules are re-exported by `admin-roster-upload.js`. The import's whole contract: `.claude/rules/roster-import.md`.
- `normaliseCellValue(rawShift, baseShift, date)` → `{ value, display, guarded }` — the per-cell guards: the Sunday rewrite, leave or an absence on a base rest day rewritten to `RD`, and the `RDW|` marker (`display` keeps it, so the save writes `type: 'rdw'`; `value` is stripped, so a re-import compares equal to a stored plain time). `guarded` names the guard that moved the value — `'sunday'`, `'sunday-other'` (a training or meeting day on a Sunday), `'rest-day'` or null — so the review can say so. **Every path that produces a value for the review goes through it** — a parsed cell, a picked reading, an entered shift — or one of them would eventually write a Sunday AL.
- `shiftValueToOverrideType(value, date)` → the override `type`; layer 4 of the Sunday rule (a value the Sunday rewrite turns to RD becomes a `correction`; a timed Other day on a Sunday is `rdw`). The base shift is not an argument (no caller's value was ever read); anything but an ISO date in `date` throws, so a stale three-argument call cannot silently lose the Sunday rule.
- `isZeroLengthRange(value)` — equal start and end, the one range shape always wrong here, since every duration helper reads it as 24 hours. `end < start` is NOT caught: an overnight shift is ordinary. Accepts the `RDW|` encoding.
- `RDW_PREFIX` / `isRdwEncoded` / `stripRdw` / `UNKNOWN_PREFIX` / `isUnknownEncoded` / `stripUnknown` — the two review-only encodings, defined HERE once because this is the module all three import modules can reach without a cycle (they were three copies). `roster-review-states.js` re-exports them.

### `roster-entry-control.js`
Answering an UNREADABLE roster cell where the question is asked, so a cell like `SEE NATHAN` is not a dead end that sends the admin to another page with a name and a date to remember. The header holds the three rules — the pills come from `PILL_TYPES` (Other included, its chips from `OTHER_FLAVOURS` and its value from `composeOtherValue`; Spare is not offered), Sunday exclusions are read from `isForbiddenOnSunday`, and an entry passes the guards a parsed value passes — and why the times are text boxes rather than `<input type="time">`.
- `entryControlHtml(key, state, date)` — the type pills, the Other sub-controls and the two time boxes, with both questions stated on screen and the reason for each lock written in the row.
- `commitEntry(state)` — composes through `manualCellValue`, then `normaliseCellValue`. Leave or an absence entered on a base rest day ASKS "Was it a swapped working day?": only "Swapped" records it (`swapped: true`, which the save turns into `replacedType`), and changing the type takes the answer back. On 25/26 December nothing is asked and nothing recorded (the app's Christmas leave decides). `entryLeftAsRest(state)` — answered "rest day", or leave entered on 25/26 December: the row reads *Not recorded* and is not counted as unanswered.
- `entryClick(el, state)` — applies a click inside the control (pill, flavour chip, RDW tick, swap answer) to the draft and commits it; returns whether it handled the element.
- `toggleEntry(rowEl, btn, key, state, open)` / `redrawEntry(rowEl, key, state)` / `isoFromKey(key)` — the control opens, closes and redraws IN PLACE, because re-rendering the review threw the reader back to the top of a long list; a redraw puts focus back on the control that was pressed. `patchEntryRow(rowEl, done, state)` keeps the row's tag and hint honest between keystrokes, taking its tag style from `unreadableTagClass` (`roster-review-states.js`).
- `paintUnreadableRow(rowEl, state)` — paints EVERY control of an unreadable row from its state by the render's rules (a reading lit when picked, Skip when nothing is chosen, the enter button when the entry is the answer; a closed editor leaves the row). The entry press, the keystroke, a picked reading, Skip and Skip all all call it, because four partial patches let the lit buttons drift from what Save writes.

### `roster-alignment.js`
Is a roster read trustworthy, or is it a day out? Evidence about the import that does NOT come from the model, and the only such check drawn from the member's own pattern (the PDF's grid and its printed week are the others): the row read, `sundayScan` and `columnScan` are one model call on one PDF and can agree on the same misread, while this compares each parsed week with the member's own base pattern, which the PDF cannot influence (header; `.claude/rules/roster-import.md` → Day drift). It imports no Firebase, so a test can build a shifted week from the real roster.
- `detectShiftedRow(member, shifts, dates)` → `'left'` | `'right'` | null — correlates the week at offsets −1 / 0 / +1. A ±1 alignment must beat offset 0 by at least 3 days and score at least 5 of 7, so a member whose pattern looks alike on adjacent days stays silent.
- `assessRosterAlignment(parsedResult)` → `{ byMember, blocked, direction, suspects, geometryRefused }` — the CIRCUIT BREAKER. It folds in the rows `functions/roster-geometry.js` refused (`'geometry'`, counted only for names on the review), counts by DIRECTION, blocks at `ALIGNMENT_BLOCK_THRESHOLD` members (the reasoning is beside it), and gives `direction` null when nothing directional contributed. It fails OPEN on absent evidence.
- `defaultWeekEnding(now)` → the week ending the upload form offers first, by LONDON date (owner, 10 Nov 2026): from Thursday the following week — the one a Thursday release covers — and Sunday to Wednesday the week in progress, a Saturday keeping the next Saturday; so Thursday to the next Wednesday offer one week. A whole week out is invisible to the ±1 detector, which is why the default is decided here.
- `driftCopy(drift, escapedName)` / `stopCopy(alignment, who)` — the per-row warning and the whole-read banner, beside the verdict so a new kind of drift cannot wear another's words. `geometryCopy(geometry)` — says when the PDF's own grid was not consulted, including a response with no `geometry` field; `complete` says nothing. It unticks nothing: whether a missing witness should fail closed is an owner decision.
- **What the verdict does** (`roster-review-states.js` and the coordinator): a drifted member's rows start unticked; a blocked read makes every tick inert, replaces Save with "Read the roster again", and is skipped by `collectRosterWrites`. No per-row override and no "save anyway". Tested by `admin-roster-upload.test.mjs`; the wiring by `e2e/operations.spec.js`.

### `roster-review-states.js`
What state every cell of the roster review is in, and whether it is TICKED — the decisions behind what a Save writes. Pure and Firebase-free; the coordinator re-exports `computeCellStates`, and its tests still reach it there. The header numbers the five things an edit can silently break; the import's contract is `.claude/rules/roster-import.md`.
- `computeCellStates(parsedResult, existingOverrides)` → `Map<"memberName|date", state>`: **MATCH** (the PDF equals the base roster and nothing is saved) · **DIFF** (propose it) · **CONFLICT** (a manual override differs) · **COVERED** (a saved override already equals the PDF — RDW-ness included, except on a Sunday) · **REMOVE_IMPORT** (the row matches the base roster again: delete the stale import, write nothing) · **UNREADABLE** (the `UNKNOWN|` sentinel, carrying `options` when the server's two readings survive `normaliseCellValue` as different values) · **GUARDED** (the guards refused the day: shown and explained, never written unasked). It decides `chosen`: DIFF and REMOVE_IMPORT start ticked, CONFLICT and UNREADABLE `null`, and a drifted member's rows and every row of a read `assessRosterAlignment` refused `false` — and so does every row on 25 or 26 December from 2026 (`christmas: true`), which the app's Christmas leave decides: unticked, the row says so (`CHRISTMAS_NOTE`), and nothing there is asked.
- `collectRosterWrites(cellStates)` → the list one Save writes, handed to `_saveOverrideBatches`. A refused read writes nothing whatever `chosen` says (the hard gate, unreachable from today's UI, which is why only a unit test holds it); DIFF and CONFLICT-"Use new roster" write the DISPLAYED value; UNREADABLE writes only once answered; every write carries `alsoDelete`, every other record of the day (`otherRecordIds` — older manual copies and import copies alike).
- `reviewOutcome(cellStates, answeredWithNothing?)` → the counts the summary and the Save button show, taken FROM `collectRosterWrites` so the button cannot promise a different number from the one Save writes; `answeredWithNothing` is the entry control's `entryLeftAsRest`, passed in because this module must not import the widget. `outcomeHtml(outcome)` → the summary's markup, or '' when there is nothing to say.
- `carryReviewAnswers(answered, before, fresh, skipped?)` → `{ states, changed }` (v25.94): after a refused Save, every row the fresh read computes EXACTLY as the first read did (the whole row, compared field by field) keeps the admin's answers (`chosen`, `preSkip`, `entered`, `draft`); only a changed row starts from its default. Skip all is a person's, so it is handed back: their ticks are restored and the coordinator presses Skip all again after the redraw.
- GUARDED rows: `guardCopy(guard, asks, christmas)` — the reason in the admin's words (`'sunday'`, `'sunday-other'`, `'rest-day'`, and the Christmas leave on 25/26 December), never reading as an error. `swapQuestionApplies(state)` — only leave or an absence on a base REST day, never a Sunday, never on a refused read, never on 25/26 December. `guardedWriteValue(state)` → `'SICK'` | `'AL'` | null — written only once answered "swapped". `guardedWrites(state, memberName, date)` — "swapped" replaces a previous import, "rest day" removes one, unanswered writes nothing. `guardedRowHtml({ key, s, dayName, dateStr, badgeHtml, esc })` — the row's markup.
- `replacedFromState(state)` → what a write over the row's saved record carries forward (`type`, `replacedType`, `leaveYear`): one builder for every save site. `restOverRest(value, baseShift)` — an answer of a rest day on a day the base already rests: the collector writes nothing new there (it clears what the day held) and the entry control says so. An UNREADABLE cell one of whose readings is leave or an absence on a base rest day offers no picks, so the guard's "Rest" is never a button. `unreadableTagClass(state)` → `'act-read'` | `'act-choice'`, presentation only.
- `RDW_PREFIX` / `isRdwEncoded` / `stripRdw` / `UNKNOWN_PREFIX` / `isUnknownEncoded` / `stripUnknown` — the two review-only encodings, RE-EXPORTED from `roster-cell-rules.js`, where they are defined. Neither reaches Firestore: RDW-ness lives in a saved override's `type`, and the sentinel is never written.

### `admin-roster-upload.js`
The Weekly Roster Upload coordinator on Operations: pick a file → `parseRosterPDF` → review → batched write. It reads the page, calls the Cloud Function and paints; every rule it applies is in `roster-review-states.js`, `roster-cell-rules.js`, `roster-alignment.js` or `roster-entry-control.js`. Read `.claude/rules/roster-import.md` first.
- `initRosterUpload({ currentUser, currentIsAdmin, parseUrl, getIdToken })` — called by `operations-app.js` after the session guard (a `loadOverrides` it is still handed is ignored: Operations has no Saved Changes list to refresh). It draws the review (an outcome summary of what Save will do, a Save tick per change, "Keep yours / Use new roster" on a conflict) and wires it with ONE delegated listener: the list is cloned at the end of each render to drop old listeners, and `cloneNode` does not copy listeners, so a control with its own `addEventListener` silently stops working.
- `PARSE_ABORT_MS` — how long the browser waits for the parse, above the server's own `timeoutSeconds` as `fetch-timeout.js`'s table says; `admin-roster-upload.test.mjs` pins it to the server's figure. The bound covers the reply's BODY as well as its headers. `statusFailureLine(status)` — the words for a refusal whose body carries none (the platform's gateway timeout, not the handler's JSON), so no failure reads "contact support".
- `fetchOverridesForWeek(dates)` — the week's existing overrides, for classification. **Fails closed**: a failed or offline-cache read throws a tagged `conflictReadFailed` error rather than returning `[]`, which would misclassify every existing override as absent.
- `_saveOverrideBatches` — `saveRosterWrites` (`roster-import-save.js`), re-exported under its old name for the suites that drive it. The review's Save hands it the records the review loaded (`_shown`, by id). **A refused Save** (`IMPORT_CHANGED_CODE`: a record it would delete changed after the read) re-reads the week and redraws the review, so the changed days show as they are — no second read of the PDF; a failed re-read closes the review.
- `shiftDisplay(value, date?)` — the badge for one value; a worked Sunday time renders as RDW. `manualShiftDisplay(s)` — a stored manual value, with the RDW badge restored from the override's `type`.
- Re-exports `normaliseCellValue`, `shiftValueToOverrideType` and `isZeroLengthRange` (`roster-cell-rules.js`) and `computeCellStates` (`roster-review-states.js`), so existing call sites and tests are unchanged.
- **The review offers the original PDF as a DOWNLOAD** (`<a download>`), never a `blob:` tab: that document inherits the page's `object-src 'none'`, so Chrome painted it blank, and admitting `blob:` was declined (the comment beside the button). `e2e/operations.spec.js` takes delivery of the file.

### `roster-import-save.js`
What one Save of the weekly roster review writes (v25.92). Pure of the DOM; firebase-client.js for the writes. The reasoning is its header.
- `saveRosterWrites(toWrite, currentUser, shown?)` → how many rows were refused as zero-length. Parts of at most ~450 operations, each inside `writeWithClaimRetry`. **A part that deletes is ONE transaction** that re-reads each record it deletes (`replaceId`, `alsoDelete`) and refuses — writing nothing — unless each is still the record in `shown` (`sameOverrideRecord`) or already gone; a record `shown` lacks is refused, never deleted on trust. **A part that only adds is a batch**, as before: a manual record outranks an import, so an added record cannot hide a colleague's day. New ids are minted ONCE per part, so a transaction re-run writes the same documents. Throws `{ code: IMPORT_CHANGED_CODE, days, savedEarlier }` for a refusal; marks `partialCommit` when earlier parts landed or a deleting part never reached the server. **A deleting part first waits for this device's own queued saves** (`whenOwnWritesSent`, v25.95); one that gives up throws `{ code: 'unavailable', unsent: true }` with `UNSENT_SAVES_DETAIL` as its message, NOT `partialCommit` on the first part, because no transaction started.
- `IMPORT_CHANGED_CODE` · `refusalLine(days, { savedEarlier?, redrawn? })` — the words for a refusal, naming each day (up to four, then "and N more") · `UNSENT_SAVES_DETAIL` — what the admin reads after "Couldn't save — " when the wait gave up.

### `paycalc-app.js`
The Pay Calculator coordinator for `paycalc.html`: no pay maths and no period arithmetic. `init()` is called by `paycalc-boot.js` (CSP blocks an inline call). The pay rules are `.claude/rules/paycalc.md`.
- **The gates, in order.** A signed-out visitor gets the in-place sign-in, which says what the page is and that the staff PIN does not open it (`PAYCALC_SIGN_IN_ABOUT`) — deliberately not `requirePage`, because the page needs a local member to namespace its storage; the Firebase-confirmation path (`_initErrorReporting`) does ask `requirePage(…, 'paycalc')`, which is `soft` and never blocks the calculator. A member whose role has no confirmed rates (`gradeForRole` is null), or whose session name is not on the roster, gets a card naming the gap instead of a calculator (`_showUnsupportedRole`), before anything can render a figure; its words are written for its reader by `paycalc-role-card.js`.
- Internal to `init()`: `calculate()` (the engine, over `paycalc-calc.js`), `onPeriodChange()`, `autosave()`, and the back-pay state `_bpAmount` / `_bpPNum` — the lump joins the take-home only when its tick is on and its paid-in payslip is the one viewed.
- Delegates periods to `paycalc-periods.js`, settings to `paycalc-settings.js`, the hint bar to `paycalc-roster-hint.js`, HPP to `paycalc-hpp.js`, back pay to `paycalc-backpay.js`, the form round trip to `paycalc-form-data.js`, the headline and banners to `paycalc-result-headline.js` and `paycalc-money-banner.js`, the result markup to `paycalc-breakdown.js`, and the overlays to `paycalc-lightboxes.js`.

### `paycalc-result-headline.js`
Which figure is the headline, and what it is called. Two branches — a confirmed payslip figure or the estimate — write the same six targets, and a target left unwritten keeps the last render's value under the other branch's label (header).
- `headlineLabels({ hasActual, payday, bpThisPeriod, hppForPeriod, bpIsEstimate, hppIsEstimate })` → `{ netLabel, stickyLabelHtml, stickyWords, bdBtnHtml }` — PURE, every word in one place, so both branches can be asserted side by side. The visible label and the accessible name come from one branch, so a screen-reader user and a sighted one cannot disagree about whether the figure is confirmed. `stickyWords` is the strip's label as plain text, which leads the take-home bar's name.
- `renderResultHeadline({ actual, net, payday, … })` — paints it, writing every shared target on BOTH paths (`#summary` is the named exception: the estimate path leaves its rows to `paycalc-breakdown.js`).
- The actuals gate stays with the CALLER: who may see device-local payslip figures is a question about identity.
- `renderYtdLine(from)` — the Year to Date line under the figure (`#netYtdNudge`): shown with the date of the payslip `from` names; hidden, its date cleared, for null. Written on every run, like the headline. Whether it shows is `ytdUpdateFrom`'s rule (`paycalc-periods.js`).
- `wireYtdLine()` — the line's button: opens the Year to Date card through its header (as the `#payslipCard` deep link does), scrolls to it and focuses `#ytdPay`.

### `paycalc-money-banner.js`
The two opt-in money banners on the result card, back pay and Holiday Pay Premium. **A banner may say "Includes" only when the sum is in the figure above it**, and a figure not yet confirmed says so on both paths (header).
- `backPayBannerCopy({ thisPeriod, amount, isEstimate, aprilYear, fromPayslip? })` · `hppBannerCopy({ forPeriod, amount, isEstimate })` → `{ text, note }` — PURE. The tick's own state decides the sentence; availability only decides whether there is anything to offer. The notes differ on purpose: back pay says how to improve a lump worked out from hours (never one typed from the payslip, `fromPayslip`), while HPP prompts only when opted in to a figure that is still an estimate.
- `paintBanner({ rootId, textId, tickId, noteId, available, included, copy, tickYear? })` — hides by `display` and touches nothing else, so a hidden banner cannot come back carrying the previous payslip's number. The arithmetic gate behind the words is guarded by the rendered £ in `e2e/paycalc.spec.js`.

### `paycalc-lightboxes.js`
The overlays on `paycalc.html`. `initPaycalcLightboxes()` returns `{ openAboutLightbox, showYtdNotice }`: the drawer logo opens About, and the coordinator calls `showYtdNotice` LAST, after anything else the page may open.
- **About** (`initAboutLightbox`, with the header logo wired back to the calendar) · **Help** (`HELP_CONTENT`, opened by any `.help-btn[data-help]`) · the **decimal hours converter** card.
- **The Year to Date notice** — one-time per device on `NOTICE_YTD_KEY`, opened only through `openNoticeIfClear`, and never in front of the ownership prompt or the forced set-password overlay. Arriving at `#payslipCard` (from the Calendar's Year to Date notice) marks it seen without opening it. Its run and expiry: CLAUDE.md → One-time notice pattern.
- **The data-ownership prompt** — legacy unnamespaced pay data is claimed ("mine"), discarded ("fresh") or left for later (✕), through `resolveLegacyMigration`.
- **The device-local payslip actuals import** — the developer account only (`isActualsDev`); the figures are never served.

### `paycalc-periods.js`
Period arithmetic and the period select for `paycalc.html`. `p.num` is an INTERNAL, monotonic id (the anchor payday is 48), never the number printed on the payslip, so storage and maths key off `p.num` only (the comment above `CONFIG`).
- `CONFIG` — the anchor, `PERIOD_DAYS`, `PERIODS_PER_YR`, `FIRST_OFFSET` / `LAST_OFFSET` and `TAX_YEARS`, with the April rollover checklist beside it. `getPeriods()` — every period (`{ payday, start, cutoff, num }`, dates at noon), cached. `payslipPeriodNum(p)` — the PRINTED number (weeks into the tax year, ×4), display only.
- `currentPeriodNum()` — the selected period. `todaysPeriodNum()` — the period being earned today, whatever is selected; the back-pay accrual caps at it.
- **The new-starter clamp:** `computeEarliestVisiblePNum(member)` (pure) → the first period of a genuine joiner's join tax year (not a `noProRate` return); `setEarliestVisiblePeriod(member)` stores it (the coordinator passes the member, avoiding a circular import), and with it the first payslip the member was employed for, which the Year to Date rules below keep to; `getEarliestVisiblePNum()`, `visiblePeriods()` and `isTaxYearVisible(ty)` read it. The selects, the navigation and the tax-year tabs all honour it.
- `hasBoxingDay(p)` / `hasBankHoliday(p)` · `CONDITIONAL_ROWS` (condition → rows → fields; a new conditional row is one entry) · `updateBhRows(p)`, which iterates it.
- `buildPeriodSelect()` — fills the period select, honouring `?payday=` / `?month=`, and returns the period being earned (the ● anchor), which the caller stores as `_defaultPeriodNum` before calling `onPeriodChange()` itself. `periodLinkMissNote(askedFor, periods)` — what `#periodLinkNote` says when a link names a payslip the calculator does not carry. `periodPaidInMonth(periods, year, month, now)` — the payslip a `?month=` link means: the one PAID in that month (the Calendar's 💷 Pay button; in a two-payday month the first still to be paid, else the later), or null. `buildBackPayPeriodSelect(minPNum, maxPNum)` — the paid-in select, bounded to the award's own tax year. `appendPayslipOptions(sel, periods, { currentPNum? })` — the one builder of every payslip list on the page (these three, the pension opt-out and the student-loan stop): grouped under "Tax year 2026/27" headings in every list, date first, the printed number as the cross-check.
- `payslipMayBeInHand(p, now?)` — from its cut-off a payslip may be in the member's hand (it arrives before payday): the one rule for the Year to Date picker and the "Check against your payslip" box. `ytdSourceOffered(p, ty, now?, firstPNum?)` / `ytdAutoSource(ty, now?)` / `buildYtdSourceSelect(ty)` — the Year to Date card's "From which payslip?" select and its first-entry stamp, never a payslip from before a joiner started. `ytdSourceToStamp(raw, hasFigures, ty, now?, firstPNum?)` — the source to record on load for figures that never had one, or null; a recorded `'0'` (a deliberate un-anchor) is never re-stamped. `ytdSourceAfterRetype(raw, { p, ty, now?, firstPNum? })` — figures typed in again over an OLDER recorded source move to the payslip the take-home line names (the same rule as `ytdUpdateFrom`), or null. `ytdAnchorStatus({ p, ty, src, hasFigures, inUse, taxCode, now?, firstPNum? })` → `{ note, noteLive, chip, chipLive }` — the card's note and header chip; "in use" is `computeTax`'s `usingCumulative`, handed over by `calculate()` on every run, and figures not in use on the payslip after the source say why.
- `updateTyTabs()` · `jumpToTaxYear(tyIndex, onPeriodChange)` / `prevPeriod(onPeriodChange)` / `nextPeriod(onPeriodChange)` — navigation, taking the coordinator's callback to avoid a circular import. `_setSelectPeriod(sel, pNum)` — an internal setter, exported for tests.
- `ytdUpdateFrom({ p, ty, src, inUse, taxCode, recognised?, now?, firstPNum? })` — the payslip whose Year to Date figures the take-home's line asks for (the one before `p`), or null: quiet on a paid payslip, the tax year's first, a W1/M1/X or NT code (read as `computeTax` reads it), a code `computeTax` does not recognise, while the figures are in use (`inUse` = `computeTax`'s `usingCumulative`) or come from `p` or later, for a payslip from before the member started, and until that payslip can be in hand. Painted by `renderYtdLine`.

### `paycalc-settings.js`
Grade, contracted hours, the pension controls and Settings persistence for `paycalc.html`. The rate and pension rules are `.claude/rules/paycalc.md` (invariants 8, 12 and 13).
- `getGrade()` / `getContr()` — grade key and contracted hours, cached. `getLoggedMember()` — the session's `teamMembers` entry, or null. `getEffectiveContr(p)` / `getProRateFactor(p)` — pro-rated for a joining period (full when `noProRate`).
- `gradeForRole(role)` — re-exported from `roster-data.js`, whose JSDoc carries the reasoning: the grade this app has confirmed rates for, or **null**, on which `paycalc-app.js` refuses rather than pricing somebody at another grade's rate.
- **The grade prompt** (owner, 10 Nov 2026). `gradeToOffer(stored, role, kept)` — pure: the roster's grade to offer when it differs from the saved one, or null (nothing saved yet, no confirmed rates, the two agree, or the member already kept their own grade over THIS roster grade — `SK.gradeKept`). `renderGradePrompt(mayShow)` — paints `#gradePrompt`; `loadSettings` is the only caller that may RAISE it, and `saveSettings` only hides it once the two agree. "Use" sets `#gradeSelect` and dispatches `change`, so the page's own grade-change path re-prices it; "Keep" stores the declined grade. Either answer is replaced by one focused line saying what happened.
- **The pension.** `getPensionDefault(pObj)` — the period-aware default, and the ONE place the out-of-scheme answer is applied (0 only from the payslip the member named), so the field, `calculate()`, the HPP estimate and the year summary agree. `isPensionOptedOut(pObj)` — out of the scheme ON THIS PAYSLIP; with no period in hand it answers contributing. `getPensionTimeline()` / `savePensionTimeline(timeline)` — `SK.pensionTimeline`, read fresh each time. `periodDefaultPension(p)` — the £ a payslip's pension field shows with nothing typed (the default × the joiner pro-rate, to 2dp), the one source for those comparisons. `buildPensionFromSelect(timeline)` — the "not in the scheme from which payslip?" control, set to the payslip ON RECORD, not today's. `applyPensionOptOutUI(pObj)` — disables `#pensionAmt` at £0.00 for a payslip outside the scheme (disabled, never hidden). `wirePensionControls({ autosave })` — the tick and the select; the order inside the handler matters twice (its JSDoc).
- **The rate.** `getStoredRateForYear(ty)` — fixed by grade from `AWARD_RATES`, never stored. `periodRate(ty, p?)` → `{ rate, preAward }` — the rate a payslip was PAID at (a pre-award payslip gets the old one): the one answer for the read-only field, which `updateRateForPeriod(ty, p)` loads, and the Settings card's collapsed summary. `updateYtdForTaxYear(ty)` — the Year to Date figures.
- `settingsKey(ty)` (the per-year confirmed flag) · `saveSettings()` (records the pension change; it stores no pension amount — each payslip keeps its own through the form, and one with none takes its period default — and a loan-stop select with nothing chosen never overwrites the record) · `confirmSettings(calculate)` · `setSettingsCardOpen(open)` (a close hands focus inside the card to its arrow) · `loadSettings()`.
- `wireSettingsCard({ openCardNamedByHash })` — from 1024px moves the card after Hours IN THE DOM, so Tab follows the decided desktop order (CSS `order` moves paint, not focus); and opens the card from the setup banner's `#settingsCard` link (and that fragment), focus on the grade. The helper is injected: overlay.js cannot load in Node.

### `paycalc-roster-hint.js`
The roster-assist hint bar on `paycalc.html`: render, fill, and the snapshot of what was suggested. The suggestion engine is `paycalc-roster-suggestions.js`; viewing a period never persists a suggestion, and the engine never infers an ambiguous category (`.claude/rules/paycalc.md` invariant 11). It takes `autosave` as a parameter rather than importing the coordinator.
- `updateRosterHint()` — re-renders the bar from the current suggestion. `toggleRosterDays()` — the day-by-day list. `updateJoinerNotice(p)` — the pro-rata banner for a joining period.
- `fillFromRoster(autosave)` / `fillCategoryFromRoster(cat, autosave)` — fill every category, or the one tapped, OVERWRITING what is there (an explicit tap), then save and re-render. The whole fill first retries a recorded-changes fetch that had not loaded, and writes nothing if the payslip on screen changed during that wait.
- `_applyRosterSuggestion(s, force, { clearZeros })` → `{ written, cleared }`, the categories behind the fill's feedback. `clearZeros` — on an explicit fill with fully loaded data a zero clears a field, because zero is the calendar's answer; never in the base-only state, and never on the background re-apply.
- `clearRosterSuggestedAll()` · `_restoreRosterSuggested(pNum)` · `snapKey(pNum)` (the snapshot's key, exported so the coordinator's `clearPeriod()` can delete it). The snapshot describes the SAVED payslip: the background refresh on view never moves the entry of a saved figure, and `recordCalendarFigures(pNum)` — for a caller that has just saved a period — re-records it from the gold boxes at their saved values.
- `_confBadge(cat, fromOv, estimateHours)` — a row's confidence chip. A figure that holds a DEFAULT says so ("Includes an Nh estimate — check"), and it is exported so that wording is tested.
- `HM_PAIRS` — the hour/minute field pairs, re-exported from `paycalc-format.js`.

### `paycalc-hpp-schedule.js`
WHICH payslip carries WHICH tax year's Holiday Pay Premium. Pure — no DOM, no storage, no imports; the period grid and the tax-year table are passed in. **The rule:** a tax year's premium is paid on the FIRST January payslip of the FOLLOWING tax year, so `ty.hppPaidJan` falls OUTSIDE `ty`'s own window — the trap that four hand-rolled copies fell into (`.claude/rules/paycalc.md` invariant 4; the header).
- `periodsInTaxYear(ty, periods)` — the year's own payslips, in payday order. `hppPayslipForTaxYear(ty, periods)` — the payslip that carries `ty`'s premium, or null while the grid does not reach that January. `hppTaxYearForPayslip(p, periods, taxYears)` — the inverse; only the EARLIEST January payslip qualifies, so a premium is never added twice. `hppPaidInTaxYear(ty, periods, taxYears)` → `{ taxYear, payslip }` — the premium paid INSIDE `ty`'s window, which is always the prior year's.
- Consumed by `paycalc-app.js`, `paycalc-hpp.js`, `paycalc-year-card.js` and `paycalc-year-summary.js`. Tested by `paycalc-hpp-schedule.test.mjs`, which runs the carrier → tax year → carrier round trip against the REAL `TAX_YEARS`.

### `paycalc-hpp.js`
The Holiday Pay Premium card, and the period decoders it shares with back pay. The HPP rules — the three amount sources, what accrues and what never feeds in — are `.claude/rules/paycalc.md` (invariants 5 to 7, and the HPP paragraph).
- `calcHPP()` — renders the card and writes the active mode's figure to `hppEstKey(ty)`, so the January take-home add and the prior-year rollover read one place. Modes: `'hours'` (the per-payslip estimate, computed in every mode so each option shows its £), `'ytd'` (a rough figure from the Year to Date card's Taxable Pay) and `'exact'` (a typed figure). It takes no back-pay argument: back pay is never fed into HPP.
- `applyHppMode(mode?)` · `saveHppState(ty)` / `restoreHppState(ty)` — the mode and the exact input, per tax year (`hppModeKey`); the coordinator restores before `calcHPP` reads the DOM. `readHppState(ty)` — that saved choice read TOTALLY: any stored value that is not a plain object is "no choice", flagged `damaged`.
- `resolveHppForPeriod(actualRaw, estRaw)` — PURE: a stored confirmed actual, even £0, beats the estimate. `updatePriorHpp(ty)` — the prior-year section, stating what last year's figure was built from (that year's saved amount source); its confirm input stays locked until the January payslip carrying the premium can be in hand (`payslipMayBeInHand`, from its cut-off), unless an actual is already stored. `priorHppToStore(raw)` — PURE: what a typed premium is stored as (a clean 2dp figure; blank or garbage clears; 0 is a confirmed figure). `commitPriorHppActual(ty, raw)` — stores it against the viewed year's PRIOR year and repaints; the caller commits on `change`, never per keystroke.
- `_decodeHours(p, d)` — a saved period's hours as floats (text read as the figure it is). `_varPayForPeriod(p, d, rate)` — the HPP-accruing variable pay: premiums only, never contracted basic, peer pay or London Allowance, and never pro-rated for a joiner. Both are shared with `paycalc-backpay.js`. `savedPeriodPension(p, d, factor)` — the pension a SAVED payslip is priced with, as the result card prices the box (opt-out spell 0, own figure floored at £0, else the pro-rated default); shared with `paycalc-year-summary.js`.
- `hppFromYtdTaxable(taxablePayYtd, nonPremiumYtd)` — PURE: the premium portion of a Year to Date Taxable Pay figure, × `HPP_FRACTION`. `knownYtdLumps({ covered, readSaved, rateFor, hppCarrier, priorHppAmount, awardCarrier?, awardNonPremium? })` — PURE: the lumps the app knows exactly, removed first — peer-training pay, last year's premium once its January payslip is covered, and the back-pay lump's basic and London arrears once the award payslip is covered (its premium share stays in; owner, 10 Nov 2026).
- `isDataEmpty(d)` — re-exported from `paycalc-format.js`.

### `paycalc-fill-year.js` / `paycalc-year-card.js`
"Fill these from your calendar" and the "This tax year so far" card, a card of its own in the sidebar beside the Year to Date card.
- `paycalc-fill-year.js` — pure orchestration over INJECTED deps, so it runs in Node; its header numbers the seven rules that make a bulk write safe: never a period with entered data, never a corrupt one, no base-only fills (a period whose recorded-changes fetch fails is skipped and named), every fill marked like a single fill, the payslip's own figures kept, a receipt that counts only verified writes, and eligibility re-asked after each fetch. `fillablePeriods({ periods, now, proRateFactor, readSaved })` → `{ fillable, corrupt }`, by the same paid + employed + empty test the "Not entered yet" list uses. `fillYearFromCalendar({ periods, member, now, deps })` — sequential, because the suggestion module keeps one override map per fetch; a fetch that does not answer within its timeout is named unreached. `answerWithin(promise, ms)` → the answer or `'timeout'`, and `FETCH_TIMEOUT_MS` (15 s) — the one bound on every fetch a fill waits on, the card's re-fetch afterwards included. `fillYearReceipt(r, fd)` — the receipt: dates by name, and an explicit all-clear.
- `paycalc-year-card.js` — `initYearCard({ afterFill, fetchTimeoutMs })` (one delegated listener; `afterFill` is the coordinator reloading the visible form and recalculating; `fetchTimeoutMs` is for tests) · `renderYearCard({ ty, plan, pgLoan, slPaidOffFromP, bpLump })` — the year-so-far block, the fill button beside "Not entered yet" (drawn disabled while a fill runs), a slim state while nothing READABLE is entered, the projection only while payslips remain, and the receipt until the year changes. Focus survives the rebuild, and the end of a fill focuses its receipt unless the member has moved on to another field. **A fill that throws restores the button and says so**, and may never claim nothing was written, because the loop writes period by period (the comment in `_runFill`).
- `HM_PAIRS` and `isDataEmpty` live in `paycalc-format.js` so the pure module can reach them. Tested by `paycalc-fill-year.test.mjs` and `paycalc-year-card.test.mjs`.

### `paycalc-year-summary.js`
"This tax year so far". `computeYearSoFar(ty, opts)` re-runs the calculator headlessly over every PAID payslip of the year that has saved hours — `_decodeHours` → `computeGross` (the period-aware rate, pro-rated London, the payslip's own saved pension or the default) → non-cumulative `computeTax` / `computeNI` / `computeSL` (honouring each period's `slSkip` and the loan cutover) — and returns `{ entered, paid, total, employed, taxable, tax, ni, sl, net, projectedNet, skipped, missing }`. `projectedNet` is labelled rough, and corrupt periods are counted in `skipped`, never dropped. No DOM: the caller passes the tax code and loan settings in `opts` (and `now`, for tests). Rendered by `renderYearCard`. Tested by `paycalc-year-summary.test.mjs` against the REAL engine.

### `paycalc-backpay.js`
The back-pay card: the lump owed for a pay award backdated to 1 April. Every rule — the 1 April backdate, the paid-in payslip excluded, per-year state, the opt-in tick, locked confirmed rates — is `.claude/rules/paycalc.md` → Back-pay; the three figure decisions are `paycalc-backpay-state.js`.
- `calcBackPay()` → `{ bpAmount, bpVarAmount, bpPNum, bpIsEstimate, bpIncluded }` — computes the lump from the card (compute mode: the rate × hours accrual; manual: the payslip's figure), renders it, writes the story strip (`bpStoryHtml`) on every exit, and WRITES and locks each rate on record. It does not touch coordinator state.
- `prefillBackPay()` — fills the card when it opens or a new award year is first viewed; a year change clears the previous year's figures and the tick. `restoreBpState()` — restores the viewed award year's saved figures (`bpKey(ty)`); true even for an all-blank blob, because a deliberate clear must stick. `applyBpMode(mode?)` — compute, or enter from the payslip.
- PURE: `bpStoryHtml(o)`; `raiseByPercent(oldVal, pct)`. The award arithmetic is re-exported from `paycalc-backpay-accrual.js`, so its importers are unchanged.
- `_bpAwardTaxYear(fromPNum)` / `_backdatedFromPNum()` — the award tax year, and its April period; there is no user-facing "backdated from" control.
- Tested by `paycalc-backpay.test.mjs`, which drives the real `calcBackPay` against a fake `document`; the pure helpers by `paycalc-periods.test.mjs`.

### `paycalc-backpay-accrual.js`
What a pay award owes, period by period — PURE, no DOM. A module of its own so the HPP Year to Date estimate can reuse the card's arithmetic: `paycalc-backpay.js` imports `paycalc-hpp.js`, so the premium module could not import the card without a cycle. Re-exported by `paycalc-backpay.js`.
- `_accrueBackPayPeriod(i)` → `{ backPay, varPay }` (`varPay`, the HPP-accruing part, excludes London); `awardWindowFactor(p, backdatedFrom, periodDays?)` — the year's first period counts as a FRACTION (`.claude/rules/paycalc.md` invariant 14); `_awardBackdateDate(awardTy)` — 1 April of the award year, at noon; `paidInPeriodNum(periods, awardFrom)` — the payslip that carries a decided award.
- `awardLumpNonPremium({ window, auth, backdate, effContr, proRateFactor, peerDays })` — the lump's basic and London arrears, every rate from the record; null when a rate is not on record, which the caller labels instead of guessing (owner, 10 Nov 2026).

### `paycalc-format.js`
Pure formatters and field helpers shared by the paycalc modules; its only import is `date-format.js`, so it loads in Node. Tested by `paycalc-format.test.mjs`.
- `fd(d)` → "18 Sep 26" · `fdShort(d)` → "18 Sep" · `fdLong(d)` → "18 Sep 2026" — the app's own vocabulary, read off the device's local calendar (period dates are local values, not instants). `fdList(dates, cap = 4)` — a run of dates as prose, truncated past `cap`. `fmt(n)` → "£1,234.56".
- `clampMinute(n)` — into [0, 59]. `minutesFieldText(m)` — what a minutes box SHOWS for a value the app writes ("05"), display only. `decimalToHM(val)` → `{ h, m }`, carrying 60 minutes into the hour (7.999 → 8h 00m); null for a negative or non-finite value.
- `HM_PAIRS` · `isDataEmpty(d)` — the hrs/mins field pairs and the "nothing entered" test, homed here so `paycalc-fill-year.js` can reach them; re-exported by `paycalc-roster-hint.js`, `paycalc-hpp.js` and `paycalc-form-data.js`.

### `paycalc-breakdown.js`
The pure HTML builders for the pay-result card, so its markup is testable apart from `calculate()`'s DOM and maths. Each takes a plain object whose fields match the caller's locals. Tested by `paycalc-breakdown.test.mjs`.
- `buildSummaryRows(d)` — the `#summary` estimate rows, from Regular/Total pay to the take-home. `buildBreakdownRows(d)` — the `#bdBody` full breakdown, a row per component present. `fmtHrsMins(h)` — the per-row hours label.
- `buildLoanLines(d)` — the summary's Student Loan and Postgraduate Loan rows, which never leave a £0 unexplained (under the threshold, under £1, Plan 5 not yet repayable, stopped, skipped); thresholds penny-floored as `computeSL` floors them. `buildBreakBar(d)` → `{ bar, legend }` or null — the share-of-pay bar, with no £0 share drawn and nothing without pay.
- `buildActualComparison({ actual, estimate })` — the estimate-against-payslip table: a row per line the member typed (an absent figure is not a £0 claim), the difference signed, and it EXPLAINS NOTHING — cause words are banned by test. Its pay row is the payslip's Taxable Pay, set against the estimate's pay after the pension.
- `buildActualCheck(actual, estimated, used?)` — the "Check against your payslip" verdict. A gap names THIS estimate's own settings first: `used` is what it applied (the tax code, whether the engine recognised it, the pension, and the payslip the Year to Date figures count from), and only a plain letters-and-digits code is quoted. Never red. `buildProvChips(d)` — the provisional-figure chips, `''` when there are none. The full rules: `.claude/rules/paycalc.md` → "Check against your payslip".
- `taxCodeNotRecognised(code)` → `{ row, field }` — the words for a code `computeTax` does not recognise (priced on the standard 1257L allowance): `row` under the Income Tax figure (`buildSummaryRows` adds it when told `taxCodeRecognised: false`), `field` for the Tax Code box's warning. A hint fits the slip (a letter O for a zero; numbers with no letter); a code is quoted only when plain.

### `paycalc-form-data.js`
The per-period form ↔ saved-data ROUND TRIP. These lines produced four money-affecting defects of one shape — a value the form could hold being persisted as something it does not mean — so the round trip is a module with a write → read → write test (`paycalc-form-data.test.mjs`; `.claude/rules/paycalc.md` invariant 2; the header lists the four).
- `emptyPeriodData()` — the saved-period schema. **It carries no `pension` key, on purpose**: absent and null both mean "apply the period default", while a stored `0` is a genuine salary-sacrifice opt-out.
- `readFormData({ adjNegative, periodDefaultPension })` — form → object, for autosave. Both inputs are INJECTED, so the module needs no coordinator state and no mocks. `writeFormData(d)` → `{ adjNegative }` — object → form; the caller adopts the returned sign, and must call `clearRosterSuggestedAll()` first.
- `pensionToStore(raw, periodDefaultPension)` — THE rule for what a pension field's text is stored as: blank or garbage → null, a typed 0 kept, the period default (±0.005) → null, so the payslip keeps following `PENSION_STEPS`. Shared with `confirmSettings`.
- `settingFieldsWrite(raw, formNow, fields)` — what a Settings control may write into the viewed payslip's blob: the saved blob with ONLY the named fields replaced, or `null` (write nothing) when nothing is saved or the blob will not parse.
- `isDataEmpty` — re-exported from `paycalc-format.js`.

### `paycalc-inputs.js`
The field readers for `paycalc.html`'s hours and figures, and the live "= 7h 30m" hint. They depend only on `document` and pure helpers, so they test in Node against a fake document (`paycalc-inputs.test.mjs`); the event wiring that uses them stays in the coordinator.
- `numVal(id)` — `parseSmartFloat`, which strips iOS smart hyphens and quotes; missing or empty → 0. `numValOr(id, fallback)` — `fallback` for an unparseable value (through `parseSmartFloatOrNull`, which does not floor garbage to 0), so a stray "." cannot cascade £NaN. `intVal(id)` — a non-negative integer.
- `hoursTextToHM(raw)` → `{ h, m }` or null — PURE: what an hours box holding more than whole hours means, a decimal ("7.5", "7,5") or a clock time ("7:30"); the ONE reader behind the price, the live hint and the blur split. `hmPair(hId, mId)` → `{ h, m }` — reads the hours box through it exactly as the blur split will write it, so the live £, the autosave and the post-blur fields agree. `hhmmDec(hId, mId)` — decimal hours, through `hmPair`. `clampMins(mId)` — rewrites only an out-of-range minutes value, so a typed "05" survives.
- `_decHintEl(hId, make)` / `decPreview(hId)` — the decimal hint under an hours field.
- `decimalHoursText(raw)` — PURE: the Decimal Hours Converter card's answer ("7 hrs 30 mins", or "–" for a blank or unreadable box), reading a decimal comma as the point like every other box.
- `wireIosTap(el, action, { releaseFocus })` — touch-and-click wiring for a control tapped while the soft keyboard is up, where iOS cancels the click: it fires from `touchend`, suppresses a duplicate click within a time window, and treats a moved touch as a scroll (the destructive "Replace with calendar values" row). `releaseFocus` lets go of the field in hand BEFORE acting, because the guard also cancels the tap's focus move — on for the period arrows, the peer stepper, Save settings and the take-home bar; off for the ± sign button. Its JSDoc gives each rule's reason.
- `commitFocusedField()` — blurs the focused input, textarea or select (never a button), so what it commits on leaving lands now: `releaseFocus`, and the coordinator when the page is hidden (the prior-year Holiday Pay Premium commits only on `change`).
- `paintTaxCodeWarning({ code, recognised })` — the Tax Code box's warning for a code the engine does not recognise, built on first need and named by the box's `aria-describedby`; held back while the box has focus (every code is briefly unrecognised as it is typed), so the coordinator recalculates on `blur`.

### `paycalc-backpay-state.js`
Which FIGURE ends up in which back-pay box, and which of them the member may change — the three decisions every recorded back-pay defect sat in, taken out of `calcBackPay` so they are unit-tested (`paycalc-backpay-state.test.mjs`; the header lists the five defects).
- `BP_FIELDS` (the saved-state schema, DOM id ↔ blob key) · `readBpFields` / `bpFieldWrites` (the round trip) · `resolveAuthoritativeRates` · `allRatesOnRecord` · `resolvePaidInPeriod` · `blobFitsGrade` (was a saved blob written under the grade now in force — else a box with no record for it is blanked).
- **Three rules:** `bpFieldWrites` returns an entry for EVERY field, so a blob silent about a field blanks it. The lock never reads a box's contents, and a locked box is WRITTEN with its recorded figure. `resolvePaidInPeriod` never returns 0 while any candidate exists — the order of its ladder is a judgement, and never-zero is the safety property.

### `paycalc-pension.js`
WHEN a member was in the pension scheme, not merely WHETHER: a timeline of changes, because a single opt-out flag rewrote the pension on every payslip there has ever been, and auto-enrolment makes a rejoin the expected shape (header; `.claude/rules/paycalc.md` invariant 12). Pure — no DOM, storage or imports. Tested by `paycalc-pension.test.mjs`.
- `parsePensionTimeline(raw)` — the TRUST BOUNDARY: it refuses WHOLE, never in part. `serialisePensionTimeline(timeline)`. `isOptedOutAt(timeline, pNum)` — the last change at or before the payslip; none, or no payslip, means contributing.
- `withPensionChange(timeline, pNum, out)` — the primitive: a change AT a payslip, collapsing redundant changes and keeping later ones. The card makes two EDITS rather than one boolean written twice: `withOptOutStartAt(timeline, pNum)` MOVES the current spell's start (a spell already ended is left alone), and `withRejoinAt(timeline, pNum)` ENDS it at the payslip on screen (naming the start or earlier erases it, which is undoing a tick). Both are idempotent. `optOutStartsAt(timeline)` — the current spell's start, for the select.
- `migrateLegacyOptOut(legacyOptedOut, firstPNumOfCurrentTaxYear)` — the old boolean becomes a spell from the current tax year's first payslip; it only ever moves a figure away from a wrongly imposed £0.
- **Three rules:** an empty timeline means CONTRIBUTING; a payslip before the first change is never affected by it; the parser refuses whole. The consumer is `getPensionDefault(pObj)`, in `paycalc-settings.js`.

### `paycalc-inventory.js`
What a stored pay key IS, and what a set of them adds up to — the ONE classifier the backup summary, the card's itemised list and the damage preflight all ask, so they cannot disagree (`.claude/rules/paycalc.md` invariant 15). The header has the undercount it replaced and its three rules.
- `KEY_KINDS` — the ordered table: `test` on the key TAIL, a member-facing `label`, and `structured` when the value is JSON. Per-year forms sit above their member-level namesakes, and there is deliberately no `perYear` flag.
- `classifyPayKey(tail)` → `{ kind, label, taxYear, period, structured }` — **an unrecognised key is `unknown`, never dropped and never guessed**: classification DESCRIBES and never filters. `describePayKey(tail)` — "payslip 16", "back pay 2026/27"; a member never sees a storage key.
- `inventoryOf(keys, prefix)` → `{ periods, taxYears, groups, unknown, keys }`, with `taxYears` a sorted LIST, because "is my old year in here?" is the question. `inventoryLines(inv)` — the inventory as lines, pure so the wording is tested.
- `damagedEntries(entries, prefix)` — which STRUCTURED entries will not parse into the object or list their reader expects (`null` or a bare number counts as damaged; only a kind declared `structured` is parsed). It REPORTS rather than refuses, because a backup is often the member's only copy.
- Tested by `paycalc-inventory.test.mjs`, which scans the source for every `${pcPrefix()}…` builder and asserts each produces a known kind.

### `paycalc-transfer.js`
The pay-data BACKUP FORMAT and its import rules. Pay data lives in `localStorage`, which is per origin, so it does not follow a member between the two addresses or to a new phone, and it is kept off the server by decision (header). Every function is pure, because the import decides whether a member's whole pay history is overwritten. The DOM half is `paycalc-transfer-card.js`; the contract is `.claude/rules/paycalc.md` invariant 10.
- `BACKUP_FORMAT` / `BACKUP_VERSION` — the blob's identity and its file schema; a newer version is refused outright.
- `selectBackupKeys(allKeys, prefix)` — a PREFIX SCAN, never a list, minus `DEVICE_KEYS`, sorted. `summarise(keys, prefix)` → `{ periods, taxYears, keys }` through `inventoryOf`; the flat shape stays because it is written into every blob as `counts`.
- `buildBackup({ entries, member, slug, appVersion, exportedAt, prefix })` — values carried as RAW strings, never re-parsed, with the source `slug` and `dataGeneration` (`PAY_DATA_GENERATION`) recorded.
- `validateBackup(text, { currentSlug })` → `{ ok: false, error }` | `{ ok: true, blob, unnamespaced, srcSlug, counts, inventory, damaged }` — the TRUST BOUNDARY, returning a result rather than throwing. It fails closed on identity FIRST (an empty `currentSlug` refuses everything); refuses another member's backup ("sign in as them"; a name the roster does not hold, such as a former one, is told to contact the admin instead), an "ownerless" blob whose keys name an owner (a member's slug, `keyOwnerSlug`, or any key shaped `<name>_<one of our keys>`), a non-string slug, a newer `dataGeneration`, and anything that is not a pay key with a string value; and flags pre-namespacing data `unnamespaced` for the caller to confirm.
- `rekeyEntries(entries, fromSlug, toSlug)` — re-keys from the recorded slug, never a guessed one. `backupFilename(member, when)` — dated by the device's own calendar when given a `Date`.
- `applyRestore({ get, set, del, existing, entries })` → `{ ok, reason?, restored }` — the all-or-nothing REPLACE over a storage with no transactions: the unit of work is the UNION of what is there and what arrives; it writes first, verifies, then deletes the surplus and reads the deletions back. Storage is INJECTED, so a storage that fails on demand tests every path (`paycalc-transfer.test.mjs`). Key SHAPE is guarded by `paycalc-key-parity.test.mjs`.

### `paycalc-transfer-card.js`
The DOM half of the "Move Your Pay Data" card: file and clipboard plumbing, and the confirmations before a restore. It owns no rule; every decision is `paycalc-transfer.js`'s. Its header says why the title must not begin "Back up" (it read as back pay) and why the hint must keep leading with "Keep a copy".
- `initTransferCard()` — a safe no-op without the card. It shows an ITEMISED inventory ("On this device:"), read again whenever the card opens and, while it is open, after any entry elsewhere on the page; wires Download, Copy as text, Restore from a file and Restore from pasted text, and honours a `#payTransferCard` link from Settings through `openCardNamedByHash` (`overlay.js`), which expands the card and holds it at the top while the page lays out.
- **Every control is disabled when the member cannot be identified, the paste pair included.**
- **A restore is a REPLACE, never a merge**: `validateBackup` → a confirm if `unnamespaced` → a `danger` confirm naming BOTH sides (what arrives and what it replaces, damaged entries included) → `applyRestore` → reload. A failure part-way says how far it got rather than claiming success.

### `paycalc-help.js`
`HELP_CONTENT` — the pay calculator's help-panel text, keyed by each `.help-btn`'s `data-help` (`hours`, `settings`, `accuracy`, `hpp`, `backpay`); a tip may carry `<strong>`. Pure data: it imports `TAX_YEARS` and `GRADES` from `paycalc-calc.js` for the rate and London Allowance figures in its tips, so those are never typed.

### `paycalc-migrations.js`
The pay calculator's storage keys and its one-time data migrations. Every per-member key carries `pcPrefix()`, and device-level flags never do (`.claude/rules/paycalc.md` invariant 3).
- `pcPrefix()` — the active prefix (`myb_pc_` or `myb_pc_<slug>_`), which every builder and `SK` derive from. `setPaycalcNamespace(memberName)` — activates it (called from `runMigrations`; the coordinator refuses a name that is not on the roster before then, so the page never reaches the falsy-name branch). `memberSlug(name)` — a name's namespace segment (lower case, letters and digits only), for `paycalc-transfer.js`, which needs a slug without activating it. `keyOwnerSlug(key)` → the member a key belongs to — including a slug the roster no longer names (a renamed or removed member), whose keys are never claimable — or null for unnamespaced legacy data.
- `SK` — the member-level key strings, rebuilt in place on a namespace change. Builders: `periodKey(pNum)`, and per tax year `hppEstKey(ty)`, `hppActualKey(ty)`, `hppIncKey(ty)` (the "add my HPP to January" tick), `hppModeKey(ty)`, `bpKey(ty)` (the back-pay card's blob), `ytdPayKey(ty)`, `ytdTaxKey(ty)` and `ytdSrcKey(ty)` (the Year to Date source payslip, which anchors the cumulative method to the payslip after it).
- `parseSavedPeriod(raw)` → `{ data, error }` — PURE: a corrupt period is SURFACED, never dropped. `readSavedPeriod(pNum)` composes it with `lsGet(periodKey(pNum))`.
- `DEVICE_KEYS` — the unnamespaced device flags, excluded from every backup. `RETIRED_DEVICE_KEYS` — flags nothing writes any more but which still sit on devices: **retiring a feature that owned a device flag means MOVING its key here, never deleting it**, or the stale flag reads as member data and fires the ownership prompt. `NOTICE_YTD_KEY` — the Year to Date notice's device flag.
- `PAY_DATA_GENERATION` — what shape the stored VALUES are in, as against `BACKUP_VERSION`, the file. Nothing consumes it yet, deliberately; bump it when a migration changes what a stored value MEANS (header).
- `runMigrations({ getPeriods, getLoggedMember, getPensionDefault })` — the one-time migrations, then this member's namespace (its deps are passed in to avoid a cycle). `hasPendingLegacyMigration(name)` / `resolveLegacyMigration(name, 'mine'|'fresh')` — legacy shared data is never claimed silently: the prompt in `paycalc-lightboxes.js` asks, and `myb_pc_ns_migrated` makes it one-shot.
- `isActualsDev(member)` / `readPayslipActuals()` / `writePayslipActuals(map)` / `clearPayslipActuals()` — the developer-only device-local payslip actuals, never served.

### `paycalc-calc.js`
The pay maths: pure functions and the rate and threshold tables — no DOM, no Firebase, no browser globals. Every rate, allowance and pension figure, and how to add the next award or tax year, is `.claude/rules/paycalc.md` (the next-award steps are also beside `TAX_YEARS`). Covered by `paycalc.test.mjs`, `paycalc-current-year.test.mjs` and, on the owner's checkout, the real-payslip lane (`npm run test:payslip-local`).
- Tables: `GRADES` (the current default rate and contracted hours) · `TAX_YEARS` (each year's window, `hppPaidJan`, London Allowance and its mid-year `londonAllowFrom` step) · `TAX_BY_YEAR` · `NI_BY_YEAR` (weekly × 4) · `SL_BY_YEAR` · `SCOTTISH_TAX_BY_YEAR` · `PENSION_STEPS` (the per-era employee pension defaults, newest first, each era's provenance beside it) · `AWARD_RATES` (per grade and tax year, `{ rate, pre }` — the authoritative settled and prior rates).
- Constants: `P_YR` (four-weekly periods a year) · `RATE_125` / `RATE_150` / `RATE_300` (so a rate is never a literal at a call site) · `HPP_FRACTION` (the premium multiplier, confirmed by Chiltern payroll).
- The award step: `awardRatesFor(grade, tyLabel)` · `awardFromForYear(tyLabel)` — the date a year's award was applied, single-sourced from that year's `londonAllowFrom` and never stored on `AWARD_RATES` · `isPreAwardPeriod(p, grade, tyLabel)` — the one shared "paid before its award" predicate · `getRateForPeriod(p, grade, tyLabel, settledRate)` · `getLondonAllowanceForPeriod(p, ty)` · `getPensionForPeriod(grade, payday)`.
- Periods and joiners: `getTaxYearForOffset(offset)` / `taxYearForPeriod(p)` (the `- 48` anchor and the null fallback in one place) · `getThresholds(yearLabel)` · `calcProRateFactor(startDate, periodStart, periodCutoff)` → 0 to 1 · `proRateDays(…)` → `{ daysEmployed, totalDays }`, counted between wall-clock readings so a period holding the clock change costs nobody a day · `capHours({ effContr, satHrs, bhHrs })` — the Saturday and bank-holiday caps against contracted hours, single-sourced.
- The engine: `computeGross(i)` · `calcBandedTax(taxable, bands, scale = 1)` (the band walker; `scale` is how cumulative PAYE prices period N) · `computeTax(sacGross, taxCode, t, { ytdPay, ytdTax, periodN, otherDeductions })` — the Scottish flat-rate codes, the 50% limit for K codes, the cumulative method only with BOTH Year to Date figures and bounded by what NI and loans (`otherDeductions`) leave of the pay, rounded DOWN to the penny (HMRC's tax-table routines), and `code`, `recognised`, `refund` and `payLimited` reported, a refund never netted into take-home · `computeNI(sacGross, ni)` — each band to the penny by reg 12(1)(b) (a halfpenny or less disregarded, read off the third decimal place) · `computeSL(sacGross, plan, slByYear, skip)` (HMRC's method: only the final deduction is floored to £; the caller sums an undergraduate plan and a Postgraduate Loan) · `takeHomePay({ gross, pension, tax, ni, sl })` → `{ afterPension, net }` — the summary's arithmetic, each figure to the penny as `fmt` shows it, so its rows add up to the take-home. Each method is `.claude/rules/paycalc.md` → Payroll rules.

### `paycalc-roster-suggestions.js`
The roster-to-pay suggestion engine: the per-period override cache, the member-narrowed Firestore fetch, and the categorised Saturday / Sunday / bank holiday / BH overtime / RDW / overtime / Boxing Day totals the hint bar pre-fills. No DOM. The payroll rules it applies are `.claude/rules/paycalc.md` (invariants 9 and 11).
- `fetchOverridesForPeriod(p, memberName)` → `'loaded'` · `'base-only'` (the fetch failed) · `'cached'` (offline, answered by the device's persistent cache — treated as base-only, never as "no recorded changes") · `'cancelled'` (a newer period change superseded it, so it wrote nothing). One member's overrides for one period, on the `(memberName, date)` composite index.
- `resetOverrides(newState)` — clears the cache and bumps the fetch token before a new fetch, so a late fetch cannot write; called on every period change and by the year fill. `getOverridesFetchState(p)` → `checking` · `base-only` · `loaded` for THAT payslip — each answer is kept under the payslip it is for, so the year fill's fetches never stand in for the one on screen; with no payslip, whatever the last fetch left.
- `getRosterSuggestion(p, member)` — the base roster merged with that payslip's cached overrides → the categorised totals and the day list, or null. The caller passes the member; no storage access.
- `BARE_TRAINING_DAY_MINS` — a pattern's bare Training day on a bank holiday is priced as the contracted day and flagged in `defaulted7h`, so the hint says it is an estimate.
- `bhsForYear(year)` — the year's bank holidays without 26 Dec (Boxing Day is priced separately at 3×); also used by `paycalc-periods.js`.
- Test seams: `_setOverridesForTest(map)`, `_addBhDateForTest(year, iso)`, `_removeBhDateForTest(year, iso)`. Tested by `paycalc-roster-suggestions.test.mjs`.

### `firebase-client.js`
The single Firebase initialisation point: every page imports `db`, `auth` and the SDK calls from here, never from the CDN. The SDK version appears here once, and a bump also moves `FIREBASE_SDK_VERSION` in `service-worker.js` (CLAUDE.md → Change impact). It cannot load in Node, because it imports the SDK from gstatic, so its rules live in the pure modules it imports and the factories it binds.
- **Firestore:** `db` (the persistent IndexedDB cache; the memory cache only if that throws — CLAUDE.md says do not revert to `getFirestore()`) · `COLLECTIONS`, the collection names, used instead of literals · re-exported `collection`, `query`, `where`, `orderBy`, `limit`, `getDocs`, `getDocsFromCache` (the local cache only, so no rule runs; rejects on a miss), `getDoc`, `getDocFromCache` (one document from the cache: a recorded deletion reads as not existing, a miss rejects — the Links store's offline consult), `onSnapshot`, `addDoc`, `setDoc`, `deleteDoc`, `doc`, `serverTimestamp`, `writeBatch`, `runTransaction`, `deleteField` · `isSafeStorageUrl` and `resolveDocumentOpenUrl` from `storage-utils.js`.
- **Auth:** `auth` (`initializeAuth`, not `getAuth` — the JSDoc says why), `signInWithEmailAndPassword`, `signInWithCustomToken` (the staff-PIN exchange), `signOut`, `onAuthStateChanged`, and `normaliseSurname` / `nameToEmail` from `auth-identity.js`.
- **The one boot restore:** `authBootstrap` → `{ user, persistence }` · `authReady`, its persistence mode, awaited before a sign-in · `currentUserAfterBoot(timeoutMs)`, a bounded wait that returns the LIVE `auth.currentUser`, never the boot snapshot · `restoreMemberPersistence()` (IndexedDB → localStorage → sessionStorage; rejects if none takes) · `setViewerPersistence()` (session-only, and it **rejects rather than falling back**, because every fallback lives longer). **The boot reads the restored user before it applies persistence, and the PIN viewer keeps session-only persistence**: `setPersistence` migrates the current user, so the member chain would carry the viewer into IndexedDB and past a browser close. `AUTH_AND_SESSIONS.md` invariant 8; pinned by `calendar-viewer-parity.test.mjs` Contract C.
- **Writes:** `withClaimRetry(fn)` runs a read or write thunk and, on a stale-claim `permission-denied` with a live user, refreshes the token and retries once (`runWithClaimRetry`, `claim-retry.js`); every request is wrapped in `abandonOnSignOut` (its thunk rule is `claim-retry.js`'s). `writeWithClaimRetry(fn)` is the same through `runGatedWrite`: once a write ends unconfirmed, no new write starts until reload. Every write uses it; reads use `withClaimRetry`. `whenOwnWritesSent(ms?)` — has this device's queue reached the server? Every checked transaction asks first (`claim-retry.js`).
- **Documents:** `uploadHuddle`, `uploadCircular`, `uploadNewsletter`, `getLatestCircular`, `getLatestNewsletter`, `subscribeToLatestHuddle`, bound from `buildDocumentClient` (`documents-client.js` owns the sequence). `fetchSignedDocumentUrl(kind)` → a short-lived url from `getDocumentUrl`, or `null` (signed out, refused, timed out). It never throws, because every caller falls back to the stored url; the rule is `document-url.js`.
- **Push:** `currentAuthUid()` · `savePushSubscription(sub)` (stamps `owner`; throws on a subscription with no keys, so the caller rolls back) · `deletePushSubscription(endpoint)` (throws `push/no-owner-session` when no owner is signed in; `releaseDevicePush` then drops the browser subscription).
- **Work email (`staffContact`):** `getStaffContact`, `saveStaffContact`, `deleteStaffContact`, `getAllStaffContacts` (admin).
- **Passwords (`passwordStatus`):** `getPasswordStatus`, `savePasswordSetAt`, `getAllPasswordStatus` (admin) · `probeResetAtMs(email, password, memberName, timeoutMs)` — the last admin reset, asked over REST BEFORE the SDK signs in, so nothing is stored until the check passes: ms (0 = never), `null` (unconfirmed), `'credential'` or `'throttled'` · `reauthenticateWithPassword` and `changeOwnPassword`, bound from `buildPasswordClient` (see `own-password.js`) · `resetMemberPassword(memberName, opts?)` — always signs the member out elsewhere (a timeout says the reset may still have gone through); `{ lostDevice: true }` for a lost or stolen phone.
- **Admin Functions:** `getSignInStats()` (four integers, no identity) and `getAccountSetupGaps()` (names, grouped by remedy; **`refused` is not "no gaps"** and must never render as one).
- **Reset queue:** `requestPasswordReset(memberName)` (public, sends no token; a timeout means "may have been sent") · `getResetRequests()` · `clearResetRequest(memberName)` (a gated write).
- **Error log and counters**, bound from `buildAnalyticsClient` (see `analytics-client.js`): `logClientError`, `getClientErrors`, `resolveClientError`, `recordPageView`, `recordActiveAccount`, `recordOriginUse`, `recordPerfSample`, `getPerfStats`, `getUsageStats`.

### `fetch-timeout.js`
The bound on every client call to a Cloud Function. The header holds both rules below and the per-endpoint budget table.
- `fetchWithTimeout(url, options, timeoutMs)` — `fetch` with a deadline that also covers the body read (`json`, `text` and the rest reject with our code when cut off), honouring a caller's own `signal` until the body has been read.
- `FETCH_TIMEOUT_CODE` / `isFetchTimeout(err)` — our bound fired. `FETCH_ABORTED_CODE` / `isFetchAborted(err)` — the caller cancelled, never our bound; when both fire, the timeout wins. `DEFAULT_FETCH_TIMEOUT_MS` — the budget for a caller that names none.
- `serverRefusal(err)` → `{ status, reason }` for a `Server responded 4xx: …` error (the body's JSON `error` sentence as the reason), else null. A refusal is an answer, so Operations' Reset shows it and offers no Retry.
- **A budget sits above the endpoint's own `timeoutSeconds`, never below.** **A timeout on a state-changing call does not mean it did not happen**: write callers say "may still have gone through", never "failed"; reads may say "failed".

### `error-reporter.js`
`initErrorReporter()`, the one export: `error` and `unhandledrejection` listeners that write filtered records, one per distinct message per page session, to `clientErrors` through `logClientError`. It never throws and never awaits. It also turns `slow-save.js`'s events into slow-save DIAGNOSTIC entries (only for a save that was slow while the device said it was online, at most three per page), with how much of the wait the app spent in the background (a frozen phone, not the connection) and the sign-in token's timing that tells auth from the connection.
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
- `normaliseSurname(fullName)` — everything after the first word, lowercased, non-letters stripped; behind every account email and surname default, so ⚠️ changing it locks every member out (the header says what a change needs). Its letters-only half is the private `lettersOnly`, the one copy the typed-surname gate and the surname block also use. A deliberate CommonJS duplicate is `surnameCore` in `functions/roster-parse-helpers.js`, held equal by `surname-parity.test.mjs` (which reads THIS file).
- `nameToEmail(fullName)` — the synthetic `initial.surname@myb-roster.local` account email. Identity-critical: a silent change could put two members on one account.
- `surnamePassword(fullName)` — the surname default, padded to six characters · `credentialCandidatesFor(fullName, typed)` — the typed value, then the surname default ONLY when the typed value normalises to the surname; that gate is what stops an ungated fallback signing in whatever is typed.
- `isPasswordMigrated(status)` — `passwordSetAt` present and no older than any `resetAt` · `MIN_PASSWORD_LENGTH` / `validateNewPassword(fullName, next, confirm)` — the chosen-password rules, shared by Settings and the forced overlay (`password-force.js`), so one surface cannot accept what the other refuses. `newPasswordProblemField(next, confirm)` — which box a refusal is about, so the caret goes there · `passwordChangeFailure(code, reauthed)` → `{ message, focus, escape? }` — one ladder for a failed change on both surfaces, by cause and then by stage (never "incorrect" once re-authentication succeeded); `escape` marks what no retyping gets past, where the forced change offers its way out.
- `isCredentialRejection(code)` — a DEFINITIVE credential rejection (the codes are a module-private set), so both password ladders (sign-in in `session.js`, and `reauthenticateWithPassword`) try the next candidate only on a real rejection and stop on a transient failure.
- `sessionPredatesReset(sessionCreatedMs, resetAtMs)` — refuse a SILENT re-sign-in on a session older than the last admin reset; an unknown reset time (`null`) refuses too · `resetAtFromRestDoc(status, body)`, `isRestCredentialRejection(status, body)`, `isRestThrottled(status, body)` — the three readings of the REST answers `probeResetAtMs` gets.

### `document-url.js`
Asks the server for a SHORT-LIVED document url and decides what a refusal means. Imports only `fetch-timeout.js`, so the rule is testable in Node (`document-url.test.mjs`); `fetchSignedDocumentUrl` in `firebase-client.js` adds the current user and token.
- `requestSignedDocumentUrl(kind, getToken, doFetch?)` → `{ url, expiresAt, fileType, storagePath }` or `null`. **It never throws, and `null` is not a failure**: every caller has the permanent `storageUrl`, and a 503, 403, 404, timeout or offline answer all mean "carry on the old way". A 200 with no usable url, or no readable expiry, is `null` too, so `undefined` never reaches `window.open`. `doFetch` is a test seam.
- `DOCUMENT_URL_ENDPOINT` · `DOCUMENT_URL_TIMEOUT_MS` — short on purpose: the tap already has a working url in hand.
- Which url opens, and whether the signed one is for the file on screen, is `resolveDocumentOpenUrl` (`storage-utils.js`).

### `functions/cell-day-rules.js`
What a roster cell MEANS, given the day of the week it sits in. CommonJS, requires nothing; required by `roster-parse-helpers.js`, `roster-prompt.js` and `roster-sunday-repair.js`. The import's contract is `.claude/rules/roster-import.md`.
- `isBlankReading(raw)` — a reading that says the cell was EMPTY: no answer, or one of `BLANK_READINGS` (nothing, `BLANK`, `EMPTY`, a lone dash), the one list the row read and both scans share · `isPhysicallyBlank(raw)` — the same less the dash, which the PDF grid sees as ink (`settleDisputedSundays`) · `blankCellMeaning(dayIndex, dayLabel)` — an EMPTY cell is `RD` on a Sunday (the uncontracted column) and an `UNKNOWN|…` review question Monday to Saturday. A per-cell normaliser cannot know which column it reads, so every caller asks this one function.
- `isNotAvailable(raw)` (`NA`, `N/A`, `N.A.`) · `isNotAvailableSunday(raw)` (`NS`) — the recognisers, matched on the WHOLE cell, so `NAT` and a time are untouched. Both codes are rest days on every day (an owner decision; the header has the history), recorded as `RD` by `normaliseShift`. The Sunday scan repair asks the same recognisers before anything is normalised, so the two cannot disagree about a spelling.
- `BLANK_CELL_TOKEN` · `BLANK_READINGS` · `NOT_AVAILABLE_TOKENS` · `NOT_AVAILABLE_SUNDAY_TOKENS` · `SUNDAY` — the tokens and the day index the predicates read.
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
- `runGatedWrite(run)` / `hasUnconfirmedWrite()` / `UNCONFIRMED_CODE` / `UNCONFIRMED_LINE` / `unconfirmedWriteLine(err, what, whereToCheck)` / `_resetUnconfirmedWrites()` (test seam) — once a write on the page ends `SIGNED_OUT_CODE`, every later write is refused until reload, so a retry cannot write a second copy beside the one Firestore still holds. Reads are not gated. `writesInFlight()` (`slow-save.js`) counts it, and Operations and Links ask `hasUnconfirmedWrite()` so no automatic reload strands the held write. `trackBackgroundWrite(p)` / `backgroundWritesInFlight()` — a write no page started (the "own password" record `changeOwnPassword` makes), counted until it settles so every page's update reload waits for it, with no notice on screen.
- `saveFailureMessage(err)` — the Admin save's error line: unconfirmed, refused, or connection.
- `ownWritesSent(waitForPendingWrites, ms?)` → true once this device's queued writes have reached the server, false when `OWN_WRITES_WAIT_MS` (8 s) passes first; a rejection (the account changed) is passed on. Every checked write asks first (`whenOwnWritesSent`, `firebase-client.js`), because a transaction reads the server and a save made offline is not there yet (v25.95).
- `watchIdentityLoss({ uid, watch, stillLost, onLost, settleMs? })` — `onLost` once, when NOBODY has been signed in for `settleMs` and `stillLost()` agrees. Another account arriving is never a loss: Firebase shares one account across a browser's tabs. Wired through `guardNamedSession` (`page-session.js`).

### `page-session.js`
How a signed-in page leaves a session, and what it does when the session leaves it — the routines every protected page shares, so the per-page copies cannot differ again. The header says what each routine owns and the defects the copies had. Tested by `page-session.test.mjs`; the wiring by `page-contract-parity.test.mjs`.
- `warnOnUnload(isDirty)` — the browser's "Leave site?" while there is unsaved work; it stands down once a sign-out has been answered.
- `askBeforeSignOut(isDirty)` → the drawer's `beforeSignOut`: "Sign out anyway?" over unsaved work. It runs BEFORE anything is released, so a Cancel changes nothing.
- `askBeforeLeavingByDrawer(isDirty)` — a capture-phase guard on the links of the drawer (`.nav-panel`) AND the About panel (`#iconLightbox`): over unsaved work it asks "Leave this page anyway?" and, on Leave, clicks the link again so the link's own listeners still run. A fragment-only link, `mailto:` (Report a bug) and `_blank` never ask. A phone never shows the unload prompt, which was the only other guard. Used by `admin-app.js` and `overtime-app.js`; Links keeps its own guard (`page-contract-parity.test.mjs` names the exemption).
- `keepDraftWhenHidden(isDirty, { keep, forget })` — on `visibilitychange` to hidden and on `pagehide`: dirty → `keep()`, clean → `forget()`, and an ANSWERED leave or sign-out forgets too (it was a discard). The trigger for `unsaved-draft.js`; used by Admin and Links.
- `onReturnToPage(afterMs, fn)` — `fn(awayMs)` when the page is shown again after at least `afterMs` hidden (wall clock, from the hide; a back/forward-cache return counts). An installed app is not reloaded on reopen. Admin re-reads its week after five minutes; New link redraws its status.
- `signOutAndLeave({ to? })` — `clearSession()`, then `location.replace(to)`, or a reload when `to` is null, so the page leaves no history entry behind.
- `reloadIfRestoredForSomeoneElse()` — the first line of every coordinator: reload a back/forward-cache restore, or a page left open in another tab, unless the signed-in member matches both who the page was built for and who was signed in at `pagehide`.
- `guardNamedSession({ page, pageLabel, member, established, signIn? })` — once `established` settles: a login decision clears the session, resets the drawer and signs in; a PENDING one (Firebase's start-up stalled) shows the sign-in over a KEPT session and reloads once this member's identity lands; otherwise `watchIdentityLoss` offers the sign-in on a later loss. Used by every protected page except the Calendar (PIN) and the Pay Calculator (soft policy).
- `lateReloadAllowed(now)` / `LATE_RELOAD_GAP_MS` — at most one late-identity reload every two minutes per tab, because on a connection that never answers, the SDK emits the stored user about 30 s into every load.

### `unsaved-draft.js`
A copy of unsaved work, kept on this device for the exits nothing can ask about (iOS discards a hidden page, a swipe back asks nothing) and offered on the next load. Imports only `ls.js` and `date-format.js`. The six rules — never applied silently, never across members, it mirrors the unsaved state at the last hide, a day then gone, a draft is work and not a decision, and work a save has since landed is not unsaved — are its header. Written by `keepDraftWhenHidden` (`page-session.js`); used by `admin-app.js` and `links-app.js`. Tested in `page-session.test.mjs`.
- `createDraftSlot({ page, by, now?, usable? })` → `{ peek, keep(scope, data), forget, offer({ ask, apply, unsaved? }) }` — one page's slot for the signed-in member. `unsaved(draft)` (v25.97) takes out what has since landed; null deletes the draft with no question (`'saved'`), and a hook that throws leaves the whole draft to be asked about. `usable(data)` is the page's test of a draft it can put back WHOLE (Links: a grid; Admin: rows); one that fails is neither offered nor kept. `forget` never deletes an earlier page life's draft that has not been answered; `offer` asks through the page's `confirmDialog` ("Restore your unsaved changes from 14:20?", Restore / Discard), and a Restore whose `apply` returns false or throws keeps the draft — as does a question dismissed unanswered (`'unanswered'`), which the next load asks again.
- `draftKey(page, by)` / `DRAFT_PREFIX` / `DRAFT_MAX_AGE_MS` — `myb_draft_<page>_<URI-encoded name>`, and the day after which a draft is neither offered nor kept.
- `encodeDraft(draft)` / `decodeDraft(raw, { page, by, now })` — the stored shape, and what may be offered: null for another member or page, another version, malformed, older than a day or dated in the future.
- `restoreQuestion(savedAt, now)` — the 24-hour question, with "yesterday" when it is.
- `draftBaseline(raw)` — a Links draft's concurrency baseline read back: anything unusable is UNKNOWN, never "no baseline" (links-design.md invariant 5), so a colleague's save since still asks.
- `savedSignature(record)` — `id|type|value` of the saved record an Admin row was edited over; a restored row must still find it. `weekRestoredLine(put, left)` — what Admin says after a restore, naming the days left as saved.

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
- `attentionBadge(count, truncated)` — pure: the ONE spelling of a count, worn by the strip's badge and the Error Log's header chip alike, so the two cannot disagree. A truncated count is a floor ("2+", "0+" when no error was among the entries loaded); empty means known clean.
- `buildAttentionItems(reports)` — pure: the items to render, in catalogue order, each with `short` and `badge` (the visual pill, whose count is the same `.card-year-chip` the target card wears, spelled by `attentionBadge`) and `text`, the accessible name BUILT FROM them so it contains the visible label (WCAG 2.5.3). A count of 0 renders nothing; an id never reported is ABSENT, because unknown is not clean.
- `createAttentionStrip({ container, onJump })` → `{ report(id, count, {truncated}), withdraw(id), unchecked(id) }`. `report` and `unchecked` THROW on an unknown id; `withdraw` takes a count back to unknown when the card's reload fails; `unchecked` keeps the item and says "couldn’t check" in a neutral colour (`.attn-count--unchecked`), for the reset queue only.
- Fed by the reset-request refresh and the account-setup audit (`operations-app.js`) and the Error Log (`operations-errors.js`), at the moments the card header chips update, so the strip and the chips cannot disagree. A failed card load reports nothing — except the reset queue's, which says "couldn’t check" (owner, 10 Nov 2026: its card stays closed, so an absent item read as nothing outstanding).

### `operations-doc-links.js`
The Document links card on `operations.html` (owner, 12 Nov 2026 — `ARCHITECTURE.md` EXC-007). The server does the work (`functions/doc-link-rotation.js`); this card asks for it in a safe order and reports it honestly. Pure apart from `initDocLinksCard` and the count it keeps: the wording and the request are `operations-doc-links.test.mjs`, the wiring `e2e/operations.spec.js`.
- `ROTATE_LINKS_URL` · `requestLinkRotation({ rotate, getToken, fetchFn? })` — POST to `rotateDocumentLinks`; the body says `rotate: true` only for `true` itself, and the client waits past the server's 300 s, so it never gives up on a run still finishing. A sign-in token that cannot be had is thrown marked as NEVER SENT.
- `describePreview(report)` → `{ lines, canReplace }` / `describeResult(report)` → `{ lines, ok }` (`ok`: nothing failed) — the lines the card shows, or `null` for an answer it cannot read (malformed, or for the other kind of request) — never "nothing to replace". Replace is offered only for files in use or older files still carrying a key. A preview with nothing to offer and files it could not check leads with that and asks for another check, never "no file has a link that still works". Unused files from the last day (`unlinkedTooNew`) are named in both and never offered. A document whose stored link no longer opens its file (`recordsDeadLink`) is named in the preview, with what it means for staff (nothing, until the app's fresh link cannot be had) and that Replace mends it; its file is always one in use, so Replace is already offered. An older server's report lacks either newer count (read as none — Functions and Hosting deploy in parallel), and a malformed one is unreadable. A run that changed nothing does not begin "Done."; a held file is named in both, so nobody takes it for replaced.
- `checkFailure(err)` — a check changes nothing, so it names the refusal or the connection. `runFailure(err)` — "nothing was changed" only for a refusal (a 4xx other than a 408), the endpoint's own 503 carrying `changed: false`, or a request that never left; the platform sends 503s of its own, and a failed fetch may have left, so anything else is unknown, with the safe next step (running it twice is safe). In both, a platform page (a 404 before the function is deployed) is shown as its status, never as the page.
- `initDocLinksCard({ auth, askToConfirm, fetchFn? })` — Check (a preview) → Replace (behind `askToConfirm`, overlay.js's `confirmDialog`, passed in because overlay.js touches `window` as it loads). Replace stays after a run that failed on a file, or whose answer was lost or unreadable, so the retry is one press away; otherwise it goes, and a file changed mid-run is finished by checking again.
- `docLinksRequestInFlight()` — true while a check or a run waits for its answer, counted from the token to the answer (v25.92). Operations holds an update's reload on it (`_opsBusy`): a run can take minutes, and its report is the only record of what it did — a check made after a run reads exactly like one made before it.

### `operations-reset.js`
What Operations → Account status → **Reset** asks, and every sentence it says about the answer (not the reset-request queue). Pure — it imports only `fetch-timeout.js` — so every combination of stages is `operations-reset.test.mjs`, and it is driven on the real page, outcome by outcome, by `e2e/operations.spec.js`; the coordinator keeps the row's button and the re-read after a reset.
- `LOST_PHONE` · `resetQuestion(name)` — `confirmWithOption`'s options: the question, and an UNTICKED "Their phone is lost or stolen" box whose hint says what ticking it changes. Ticked, the request asks for `lostDevice: true`: no notice (it would land on the lost phone's lock screen), and every push record the member owns deleted (sign-in audit D1/A1).
- `resetFailure(name, err)` → `{ retry, note }` — a timeout may have landed, so no Retry and no "failed"; a refusal names its reason, no Retry; the endpoint's own 503 or 500 sentence is shown as written (the 500's may say it is not known whether the password changed), beside Retry; markup is never shown as a reason.
- `resetOutcome(name, result, { lostDevice })` → `{ title, message }` or `null` — built from the stages the answer reports: a sign-out that failed (the password change still ends those sign-ins within the hour, so "reset again to sign them out now"), an account taken back, a lost-phone reset (signed out, notifications off on every device or not, no notice sent — tell them yourself), a ticked box an older server ignored (the step did not run — reset again with the box ticked), and a member no notice reached (`notified: false`, whether or not the sign-out worked). `null` when the row's "Reset ✓" says it all.

### `nav-panel.js`
The slide-out drawer every app page carries: it injects the overlay and drawer, wires the burger (`#navMenuBtn`), and renders the footer (initials badge, notification bell, Sign out). The three zones and the rules each keeps are the module header and .claude/rules/nav-drawer.md; the reasoning is beside the code. Tested by `nav-panel.test.mjs`. Capped by `coordinator-ratchet.test.mjs`.
- `initNavPanel({ currentPage, memberName, onSignOut, beforeSignOut, isAdmin, isLinksDesigner, canOpenOvertime, canOpenNewlink, onLogoClick, authReady, onLockCalendar, canReadDocuments })` — call once; a second call returns early (`burger.dataset.navPanelInit`). The four permission flags decide which `NAV_PAGES` pills appear (`adminOnly`, `linksDesignerOnly`, `overtimeAudienceOnly`, `newlinkAudienceOnly`); the current page is an inert `aria-current` pill, never omitted. `memberName` with `onSignOut` shows the footer. `onLogoClick` opens the page's About panel once the drawer's Back echo has landed. `onLockCalendar` (`{ isViewer, lock }`) is the PIN viewer's Lock row on the Calendar and Trains. `authReady` is awaited, bounded, before a document read; `canReadDocuments` is the Calendar's document gate.
- **Sign out runs in a fixed order**: `beforeSignOut` first (resolving `false` cancels), then `releaseDevicePush` (`notif.js`), then `onSignOut`. A cancel after the release would leave a signed-in device with no push record.
- `resetNavPanel()` — tears the drawer down (injected DOM, the burger's listeners, the guard, module state) so a later `initNavPanel` rebuilds it with a fresh identity; Admin's in-place re-sign-in uses it.
- `archiveNotice` and `isNoticeExpired` are **re-exported** from `notice-archive.js` (below), so every page that archives a notice imports them from here. The App Notices panel renders the archive (`readArchivedNotices`) and colours each section from `SECTION_MODS`, which stays here.

### `notice-archive.js`
The App Notices archive's rules: what a seen notice leaves behind, for how long, and when a notice is too old to show. Moved out of `nav-panel.js` (the seam `coordinator-ratchet.test.mjs` named); `nav-panel.js` re-exports the two calls the pages make. Imports only `ls.js`. Tested by `notice-archive.test.mjs`, and through the re-export by `nav-panel.test.mjs`.
- `archiveNotice({ id, title, section, date, body })` — records a notice in the archive (`myb_app_notices`): deduped by id, the newest 50 kept, entries older than 180 days pruned, a legacy record without `archivedAt` migrated rather than dropped. Call it in `onClose` for a close-only notice and in `onOpen` for one with a link. The pattern is the `/new-notice` skill.
- `isNoticeExpired(dateStr, days = 28)` — whether a "D Mon YYYY" posting date is older than `days` (the long window is 90), counted from that day's local midnight.
- `readArchivedNotices()` → the archive, newest first; never throws — unreadable storage or a non-list reads as empty.
- **The documents** (`_openLatestDoc`): refused at once when `canReadDocuments()` says no, before the blank tab opens; otherwise the tab opens on the gesture and is filled through `resolveDocumentOpenUrl`. When no tab comes back (a pop-up blocker, an iOS home-screen app) the tap hands over to the Calendar's in-app viewer through a hidden drawer link, so the unsaved-work question still runs.
- **The bell** reads `peekNotifState()` on every open (no Firestore write); the push logic is `notif.js`. A labelled full-width row has been tried and reverted twice (CLAUDE.md).
- **The drawer's two lightboxes** (Coming soon, App Notices) share the drawer's history entry, so they hand-roll `createLightbox`'s promises: a fallback beside `transitionend`, a close that runs ONCE, focus back to the burger, and key handlers that stand down under a higher `.lb-overlay` (`_overlayAbove`). App Notices' Tab cycles TWO stops, the ✕ and `#navNoticesList` (it scrolls under a still heading, so the keyboard must reach it — v25.61). `closePanelForNavigation()` closes the drawer without `history.back()` only when a link takes this page elsewhere, where `location.replace` overwrites the drawer's entry; a `./#…` hash on the Calendar, a new-tab click and the "you are here" pill pop the entry instead (`closePanel`), and a pop that lands on the drawer's own entry — a dialog's above it or above App Notices — is not the drawer's.
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
- **The contract:** `CONTRACTED_WORK_TYPES` / `VOLUNTARY_WORK_TYPES` / `isContractedWorkOverride(ov, baseShift?)` → true, false or null (null: ask the base roster). **`rdw` is not contracted work** — charging leave for declined overtime is the bug this set exists to stop — **and on a base rest day nor are `other` and `spare_shift`**, when a leave path passes the base (owner, 10 Nov 2026: "Free, like plain RDW"). `contractEvidence(ov)` — the override whose type answers that, unwrapping leave and a chained absence to their `replacedType` · `LEGACY_OVERRIDE_TYPES` — retired types that survive only as a historic `replacedType` and still classify · `isRestShift(shift)` — `RD` or `OFF`.
- **Other days** (OTHER_DAYS.md): `OTHER_FLAVOURS` (badge and full words; `hideBaseTime` for Meeting and Union) · `OTHER_RDW_DEFAULT_MINS` · `isOtherValue(v)` / `parseOtherValue(v)` / `composeOtherValue(f)` — the reader and the writer of `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`, side by side; the composer forces an explicit flavour, forces the RDW marker on a rest-day base and refuses a half-filled or equal pair of times · `resolveOtherPay(parsed, baseValue)` → `rdw` · `timed` · `as-base`, the one pay mapping (the display never resolves it). The CommonJS copy of the recognition grammar is `functions/roster-other-days.js`.
- **Sundays:** `SUNDAY_FORBIDDEN_TYPES` — the one list of types never written to a Sunday (CLAUDE.md → "Sundays are non-contracted" numbers the enforcement layers) · `isForbiddenOnSunday(type)` · `sundaySafeValue(value)` — the roster import's normaliser: leave or an absence becomes `RD`, and an Other day keeps its times as Sunday work · `isBeforeMemberStart(member, date)` — always call it; never inline the comparison.
- **The review's entry control:** `manualCellValue(type, from, to)` — a type and two real clock times → the parsed-roster value; `other` returns null, because the review composes it through `composeOtherValue`.
- **Batching:** `chunkByWrites(items, writesFor, { max, keepWithPrevious })` — splits override writes into batches under Firestore's 500-write cap, counting writes rather than items; the range booking keeps a Sunday correction in the batch of the day before it.

### `guide-chips.js`
The "Jump to section" chip bar on four guides — Railcard, Rangers & Rovers, the Staff & Admin Guide and the Pay Calculator Guide. A classic `defer` script, no exports, because CSP forbids inline script and the guides load no modules of their own; one file for all four (it was `railcard-guide.js` and `rangers-guide.js`, identical but for comments). The ⤓ PDF button is `guide-print.js`'s and the ← arrow `guide-back.js`'s. `page-contract-parity.test.mjs` requires every guide to carry a bar and exactly one script driving it, and every chip to lead to an id in `<main>`.
- **The jump:** a chip scrolls to its section (instantly under Reduce Motion), lands focus on it and marks itself current.
- **The scrollspy** (`measureSpy`, `currentChip`): on a page read top to bottom, the last chipped section whose start has passed the sticky stack — a section headed inside a `.guide-header` banner starts at the banner (`sectionStart`), where a jump or a link puts it. It runs only while the chipped sections read top to bottom (`oneColumn`, measured from where they are): the two document guides set two columns from 641px, where two sections share a line and no position can say which is being read, so there a chip is current only after a jump or a link to it.
- **A jump's chip holds** while its section stays where the jump put it (`heldTop`) — even at the bottom of a page, where the one-column rule would light the last chip — but only if the jump ARRIVED (`jumpArrived`): a reader who stopped it halfway is not at that section. The SECTION is watched, not the scroll position, because a resize reflows the page without scrolling it.
- **A link holds the same way:** a `#fragment` opened fresh lights the chip of the section it lands in (`chipFor` — a card's or a sub-heading's section too) from the first paint, through the landing; when the landing ends (`endLanding`) it holds on a tap's terms if its target is on screen. A reload, Back/Forward or a hash changed in place holds nothing.
- **The sticky offsets** (`adjustScrollOffsets`): after `document.fonts.ready`, the bar's `top` matches the measured header and every id in `<main>` gets a `scrollMarginTop` clearing header and bar; a heading inside a `.guide-header` banner clears with its banner. A `ResizeObserver` on the header AND the bar re-syncs: a bar that wraps (from 641px, in a window at least 600px tall) gains or loses a row with no change to the header.
- **Deep-link landing:** until the page has loaded and measured with its fonts, or the reader touches, clicks, wheels or types, each measurement re-scrolls a `#fragment` target left under the sticky stack (`keepLandingClear`); a reload or Back/Forward keeps its restored position.

### `fip-guide.js`
The FIP guide's behaviour — a classic `defer` script, all progressive enhancement: with JS off, every country is visible.
- **Country finder** (`#countrySearch`): `applyCountryFilter(raw)` filters the country cards and the A–Z jump chips against each card's whole text (a country, an operator or a train). The card set is `[id^="country-"]` and **its size is never written down**; `#booking-table` deliberately does not start `country-`, so a search cannot hide it.
- **Open on jump:** `openHashTarget()` opens the target `<details>` on load and on every `hashchange`, clearing the search first if it had hidden the target; a `.country-jump` click covers re-tapping the current country.
- **Sticky chip bar and scrollspy**, measured after `document.fonts.ready` and again whenever the header or the bar changes size (a `ResizeObserver` on both, as in `guide-chips.js`), and the same deep-link landing as `guide-chips.js`.
- **Print:** `expandAllForPrint` / `restoreAfterPrint` open every `<details>` for the print run and put them back (Chromium does not print a closed `<details>`'s body). Both are idempotent, and neither trusts its own event: the prepare also runs in the ⤓ button's capture-phase click and the restore on `visibilitychange`, because iOS sends no `beforeprint` or `afterprint` for AirPrint. It prints what is on screen — a filtered-out card stays hidden — and `describePrintScope(shown)` sets the button's `aria-label` to say which, starting with "PDF", the visible word (WCAG 2.5.3).
- **Print one country:** each card gets a `⤓ Print <country>` button. Printing one card is a CSS state (`body[data-print-country]` and a marker class), never a DOM edit, so an interrupted print cannot lose a country. A refusal from `guide-print.js` (`guide:print-refused`) puts the page back.

### `guide-print.js`
The ⤓ PDF button on every guide, and the FIP guide's per-country buttons — an ES module all five guides load. One delegated bubble-phase `click` listener for `.btn-print` and `.btn-print-country`, routed through `printOrExplain` (`print-guard.js`): it prints, or inserts the `#printUnavailable` notice under the header with an "Open in Safari" button and dispatches `guide:print-refused` so a page that prepared can undo it. It prepares nothing itself; the FIP guide's own handlers run first. No guide may keep a private print handler.

### `guide-back.js`
Points a guide's ← arrow at the page you came FROM — a classic `defer` script on all five guides, no exports. `nav-panel.js` appends `?from=<page>` when it opens a guide, and this rewrites the arrow's `href` and `aria-label` to match. `from` is resolved through the `DESTINATIONS` allowlist of the app's own pages and never used as a url, so a crafted value cannot make an off-site link; an unknown or absent `from` leaves the authored href alone. The allowlist is hand-kept, and `page-contract-parity.test.mjs` fails when a page is missing from it. The header says why the arrow needs retargeting at all. It measures nothing: every guide has a chip bar, and its sticky stack is measured by `guide-chips.js` or `fip-guide.js`.

### `legacy-redirect.js`
The one script the two legacy guide addresses (`guide.html`, `fip.html` — `REDIRECT_PAGES`) carry: a classic script, no exports, owner decision of 10 Nov 2026. Firebase's 301 keeps a bookmark's `#fragment` and `?query`; the Pages mirror serves no redirects, so there the stub's meta refresh was the redirect and dropped both. This goes to the stub's own `<link rel="canonical">` with both kept, by `location.replace`, so Back does not return to the stub. The meta refresh stays as the no-script fallback; it cannot overtake this (measured on Chromium and WebKit — the header says how). `page-contract-parity.test.mjs` allows a stub this one script, as a classic script after its canonical link, and nothing else; `e2e/guides.spec.js` follows an old address to its country and its back arrow.

### `ls.js`
Safe `localStorage` wrappers — iOS Safari's private mode throws on any access. **Never call `localStorage` directly** in the page coordinators (CLAUDE.md); use these. Tested by `ls-persist.test.mjs`.
- `lsGet(k)` / `lsSet(k, v)` / `lsDel(k)` — each call in a try/catch; the first failure logs one `console.warn`, the rest are silent. `lsSet` swallows a failed write ON PURPOSE: a preference that fails to save is not worth crashing a page over.
- `lsKeys()` — a snapshot of every key name (safe to delete while iterating); `[]` when storage is unavailable.
- `lsAvailable()` — will this browser SAVE? A probe write that reads back, then removed; never cached. A write rather than a read because storage can read and still refuse writes (a full quota), which is when a page renders and keeps nothing. The Pay Calculator asks it before promising "Saved automatically as you type".
- **The checked writes**, for a caller about to DELETE the source: `lsSetVerified(k, v)` → boolean (writes, then reads the value back) · `lsMove(fromKey, toKey, value?)` → boolean (deletes the source only once the destination is verified) · `lsSetBothVerified(keyA, valueA, keyB, valueB)` → boolean (both keys or neither, and `false` even when the rollback itself fails). **Never delete source data until the destination has been read back** — an audit reproduced permanent loss from migrations that did. They are deliberately not the default: an ordinary preference write does not need the branch.
- `requestPersistentStorage(keyPrefix)` — once a key under `keyPrefix` exists, asks for this origin's storage to be durable rather than evictable; a grant ends it, and a refusal is asked again once for each lever (running installed, notifications allowed) that has started to hold since — Chrome and Safari never prompt, and Firefox remembers its own answer. The Pay Calculator calls it with `pcPrefix()`. Safari has the API from 17; whether it grants in a tab is unmeasured (KNOWN_LIMITATIONS).

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
- Three inputs (whether the result figure is in view, whether a field is focused, where the visual viewport sits) and two outputs (whether `#stickyTotal` shows and how far up it is translated, and a scroll that clears the box being typed in). **No money, no period, no storage**: `calculate()` writes the figure and knows nothing of this module.
- `stickyBarShows({ inLayoutView, keyboardUp, figure, visual })` — PURE, the whole show/hide decision: the observer's answer with the keyboard down; with it up, whether the £ overlaps the VISUAL viewport (the keys cover the layout viewport without shrinking it, so the observer called a £ behind them "in view").
- `scrollToClearBar({ field, visual, barHeight })` — PURE: how far to scroll so the focused box sits above the bar pinned over the keys, never pushing its top out of view. Applied once per focus, so a member's own scroll is not fought.
- Every guard fixes a reported iOS behaviour that headless tests cannot reproduce, which is why each carries its reasoning in the header: no `pagehide` disconnect, pinned above the keyboard rather than hidden behind it, the deferred `focusout` rebase, and a translate that composes with the desktop centring. The bar's tap goes through `wireIosTap`. Tested by `paycalc-sticky-total.test.mjs`, and on a page (with a stand-in visualViewport) by `e2e/paycalc.spec.js`.

### `paycalc-role-card.js`
What the Pay Calculator says to somebody it will not price, and on its sign-in card. **Words only** — the coordinator still decides who is refused (`gradeForRole`) and hides the calculator.
- `unsupportedRoleCopy(role)` — PURE: `{ title, what, why }` for a Dispatcher (not covered YET; added once Dispatcher rates are confirmed — never a date), a manager (who it is for; nothing promised), any other role (the general refusal, ask the admin) and a name the roster no longer holds (`what: null`).
- `paintRoleCard(member, doc?)` — writes those three slots of `#unsupportedGradeBanner`, and hides the whole "What it does" box (`#unsupportedGradeAbout` — heading, sentence and guide link) where there is no explanation. The card wears the sign-in card's panel (shared.css → `.pc-role-card` joins the do-this-first recipe) and its `.login-about` box, so the page's two refusals look like one door.
- `PAYCALC_SIGN_IN_ABOUT` — the sign-in card's `about` (login-overlay.js): what it does, both grades in full, that the staff PIN does not open it (worded for everyone — this page signs the PIN out on arrival), the guide link and the shared-screen footnote. `PAYCALC_GUIDE_URL` — the guide, which needs no sign-in.
- Tested by `paycalc-role-card.test.mjs` (the properties of each message) and `e2e/paycalc.spec.js` (each card on the page).

### `admin-week-swipe.js`
The Admin week grid's swipe gesture and week arrows, which share one cooldown so a swipe and a press cannot both commit.
- `initAdminWeekSwipe({ weekGrid, fieldDate, prevWeekBtn, nextWeekBtn, canNavigate, onWeekCommitted, onSettled, shiftWeek })`.
- A pointer state machine and a carousel: it decides when a drag is a horizontal swipe (nothing starts until the intent is confirmed), builds the adjacent week panels, animates the commit and holds the cooldown. **It holds no business rule**: what a week change means stays in `admin-app.js` behind `onWeekCommitted` and `onSettled`, and whether the move may happen at all is `canNavigate`.
- Deliberately not shared with `calendar-swipe.js` (the header says why). Two rules: Pointer Events, never Touch Events (CLAUDE.md), and `setPointerCapture` on the GRID, not the clip (`.claude/rules/admin.md`).

### `overtime-review-controller.js`
The reviewer's side of `overtime.html`: the planning horizon, the week selection, the detail workspace, the grade and day lenses, the creation preview and the confirm bar. Overtime is paused — `docs/OVERTIME_AVAILABILITY.md` → Paused.
- `createReviewController({ el, esc, renderLoading, renderError, detailRefreshDebounceMs })` → `{ loadHorizon, selectWeek, wireConfirmBar, refreshIfStale, standDown }`. `refreshIfStale` re-reads the week AND the horizon, on one debounce; `standDown({ clear })` is the page saying the reviewer's side has left the screen — a tab switch takes the confirm bar down and disarms Create, and a lost session (`clear`) also empties both cards, so nothing prints from behind the sign-in. The four DOM helpers are the page's, injected.
- **The invariant it owns:** its state agrees about which week is on screen, and with nothing else on the page — generation tickets so only the newest read paints, `selectedWeek` re-checked after every await, a grade lens that survives a week change and a day lens that does not. The header names each one.
- It renders through `overtime-manager.js` and reads through `overtime-data.js`; session, identity, tabs and the member's form stay with `overtime-app.js`.
- Tested by `overtime-review-controller.test.mjs`, the only kind of test that can choose which of two in-flight reads resolves last.

### `links-design-library.js`
The Links workspace's design LIBRARY — the import panel, the Recently deleted bin and Keep only the shortlist: managing the collection, apart from editing the open design. Every write goes through the design store, and every rule through its own module (`links-import.js`, `links-deletion.js`, `links-design-naming.js`, `links-shortlist.js`). Tested by `links-design-library.test.mjs`.
- `createDesignLibrary(ctx)` → `{ openImport, renderBinList, keepOnlyShortlist, binList, setBin, addToBin, upsertBin, trackBinMove }`; call once, after the store exists. `ctx` is deliberately small (`store`, `currentUser`, `getDesigns`, `addDesign`, `activate`, `isDirty`, `hasOpenDesign`, `renderPicker`, `refreshLists`, `actionStatus`, `getHeader`, `removeDesigns`, `markQueued` (an import queued in this browser, for the masthead's pill), and the optional `activeId`, without which Keep only the shortlist warns about unsaved work whenever there is any): a split that passed the editor's state across would only move the coupling.
- It owns the bin list (read through `binList()`) and the automatic moves in flight (`trackBinMove`): a restore or purge waits for a pending move of the same design.
- `keepOnlyShortlist()` moves every older design to the bin with the store's `binIfStill`, which asks the rule again inside the transaction; `removeDesigns` then opens the next live design, or the first of the shortlist.
- Rename, duplicate and delete stay in `links-app.js`: each changes the open design's concurrency baseline or its unsaved state.

### `links-design-store.js`
The link-design collection's persistence lifecycle and its concurrency protocol. Every Firebase handle is injected (`links-app.js` passes `writeWithClaimRetry` as `withClaimRetry` and `whenOwnWritesSent` as `ownWritesSent`), so the interleavings can be forced against a fake Firestore (`links-design-store.test.mjs`).
- `createDesignStore(deps)` → `{ loadAll, create, save, rename, softDelete, binIfStill, restore, purge }`. The optional `deps.getDocFromCache` lets the offline consult tell a design the cache knows was deleted from one it never held. `create(payload)` names its document first (`doc(col)`), queues it offline, and online gives the server `SLOW_SAVE_MS` to answer before it returns `queued: true` with its id. `softDelete(id, by)` → `{ queued, status: 'deleted'|'already-deleted'|'gone', deletedData? }` — online a transaction that writes only over a live design, queued offline like save, rename and create; `rename` throws an error with `code: 'deleted-elsewhere'` (and `deletedData`) for a design binned or removed elsewhere; `binIfStill(id, by, stillMatches)` is the AUTOMATIC bin move — a transaction that asks the rule again, and fails offline rather than queueing.
- `isOfflineFailure(err, isOfflineNow?)` — whether a failure was the absence of a server rather than a server saying no; the one test that admits the unserialised path. The page's own refusals — the unconfirmed-write gate's and a sign-out mid-write — are never offline, whatever the browser says.
- **The five rules**, argued in the header: 1. a read a write depends on happens INSIDE that write's transaction; 2. no weaker fallback while online — an online failure is reported, and the caller keeps its unsaved state; 3. the baseline advances only to a revision the store verified, else `baselineUnknown` makes the next save ask; 4. a queued offline write is started, not awaited, and never stamps a revision a colleague's online save could also produce; 5. every transaction waits for this device's own queued writes first (`runTx`) — one that has not drained in time fails `unavailable`, so a save, rename or delete queues behind them and a restore, purge or automatic bin is refused. `ownWritesSent` is required: the factory throws without it.
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
- `logClientError(data)` · `getClientErrors()` → `{ errors, truncated, resolvedTruncated }` (each list fetches one more than it shows, so a flag is true only when more really exist; expired resolved records are pruned through a read of their own, by `resolvedAt`) · `resolveClientError(id)` (a gated write).
- `recordPageView(pageId)` · `recordActiveAccount({ month, day, fromDay })` · `recordOriginUse({ day, origin, installed, countVisit, fromDay, fromPwaDay })` — increment-only counters; a rolling count is MOVED off `fromDay` in the same merged write · `getUsageStats()` — this and last month's page views, the account counts and the per-address counts, pruning stale daily buckets on the way.
- `recordPerfSample({ page, metric, bucket, mode, conn })` — batched into ONE merged write per open (`createPerfBatcher`), flushed a second after the first sample, then at idle, or at once on `pagehide` or hidden · `getPerfStats()` → `{ thisMonth, lastMonth }`, each `{ month, login, fcp, pages, ready, samples }`, for the App Speed card.
- **Two properties, in the header:** no identity in a counter, and telemetry never affects the app — every writer swallows its rejection, and every prune is wrapped so it cannot reject the read it rides on (the prunes use `FieldPath`, because a dotted `daily.<date>` path throws synchronously).

### `own-password.js`
Re-authenticating with, and changing, the signed-in member's OWN password — the two calls Settings → Password and the forced change (`password-force.js`) make. A factory with every Firebase handle injected, so it loads in Node; `firebase-client.js` builds it once and re-exports both functions under their old names. The two properties an edit can break are its header.
- `buildPasswordClient({ auth, reauthenticateWithCredential, EmailAuthProvider, updatePassword, savePasswordSetAt, trackBackgroundWrite })` → the two functions below. `auth.currentUser` is read at call time.
- `reauthenticateWithPassword(memberName, typed)` — the sign-in's gated candidate ladder (`credentialCandidatesFor`): the next candidate only on a DEFINITIVE rejection, never behind a transient failure.
- `changeOwnPassword(memberName, newPassword)` → `{ stamp }` — resolves once the password HAS changed (the half to time); the `passwordSetAt` stamp settles `false` rather than rejecting, and is counted until it lands (`trackBackgroundWrite`).
- Tested through the real `firebase-client.js` by `firebase-client.test.mjs`.

### `documents-client.js`
The three date-keyed document collections — Daily Huddle, Weekly Retail Circular, Marylebone Newsletter — and the upload sequence behind them. A factory with every Firebase handle injected, so it loads in Node and its failure orderings can be forced against fakes (`documents-client.test.mjs`); `firebase-client.js` builds it and re-exports each function. It owns the sequence; the decisions are `upload-commit.js` and `doc-retention.js`.
- `buildDocumentClient(deps)` → `{ uploadHuddle, uploadCircular, uploadNewsletter, getLatestCircular, getLatestNewsletter, subscribeToLatestHuddle }`. `deps`: `db`, `collections`, the Firestore functions (`fs`), `getStorageSdk`, `uploadBytesWithClaimRetry`, the path and type `utils` (`storage-utils.js`), `resolveUploadCommit`, `pruneOldDocs`, `guardCommit` (`abandonOnSignOut`: a commit abandoned at sign-out keeps `SIGNED_OUT_CODE` — never a failure and never a rollback; a retriable final error is reported `upload/unconfirmed`) and a test `sleep`.
- `assertFileSignature(file, expectedType)` — the magic-number check; it fails CLOSED on an unreadable or too-short file.
- **The one invariant: a live document never points at a file that is not there.** So the signature is checked first; the file goes to a VERSIONED path, so the old one stays readable until Firestore commits; the new object is rolled back only on a DEFINITE non-commit; an ambiguous commit is resolved by READING, retried only as a compare-and-set inside `runTransaction` (which writes nothing over a record already naming our path, whatever its link), and left untouched when the read fails. The header argues each step, and why the SDK's own re-send of the first `setDoc` after a lost acknowledgement is not guarded.
- A Circular or Newsletter upload runs the six-month sweep (`pruneOldDocs`) after it commits. `getLatestCircular()` / `getLatestNewsletter()` treat a row with no `storageUrl` as absent. `subscribeToLatestHuddle(onData, onError)` is a live `onSnapshot`; CLAUDE.md says do not replace it with a one-time fetch.

### `firestore.rules`
The server-side Firestore security rules — the authority on access; what the fields mean is `docs/DATA_MODEL.md`. The header holds the audit table of what each identity gets from each collection: re-read it whenever an identity or capability is added, because every `request.auth != null` silently widens. Deployed by `deploy-rules.yml`. Verify a change with `npm run test:rules` and `firestore-contract-parity.test.mjs`; a field a client starts writing ships rules-first, in its own push (CLAUDE.md → Workflows).
- **Access needs a CLAIM, never a bare session**: `isMember()` (a password sign-in whose email is the one derived from its `name`, and whose server-set `member` claim matches) · `memberName()` (that `name`, else null) · `isCalendarViewer()` (the PIN's custom-token claim) · `isKnownIdentity()` (any of those, or admin). Anonymous grants nothing — `AUTH_AND_SESSIONS.md` invariant 9.
- `overrides` — read by a member, the admin or the PIN viewer. Writes are per-member isolation (`memberName()` equals the record's `memberName`, before and after) or an `admin`/`manager` claim, with the field shape and the type ↔ value pairs pinned. The claims are set by `setupRosterAuth` from the server-owned roster, never from a request.
- `huddles` / `circulars` / `newsletters` — read like `overrides` (closed behind the PIN or a password by owner decision); written by the admin only, shape-checked, and a `storagePath` must sit under its own collection, and `uploadedAt` is the server's clock.
- `linkDesigns` — read by a member or the admin, never the PIN viewer; written with the `linksDesigner` claim or admin, shape-checked, and deleted only once it is in the bin. `linkTargetSets` — the same read; created by a designer and changed only by its creator or the admin.
- `staffContact` — the owner or the admin. `passwordStatus` — read by the owner or the admin; the owner may write only `passwordSetAt`, at the server's time (`resetAt` is the Function's). `resetRequests` — admin read, server-only writes. `viewerAttempts` — server-only both ways. `overtimeWindows` — reviewer read (`admin`/`manager`), no client writes.
- `pushSubscriptions` — no client reads; a write needs a known identity and is refused to the PIN viewer (its uid is the same on every office PC); the `owner` must be the writer, and a delete needs a known identity and is the owner's (or a legacy owner-less record's, or a no-op on one already gone). `clientErrors` / `analytics` — written by any known identity (the counters carry no identity), read by the admin; the `analytics` page-view ids are an allowlist (`pvCountIds`) judged against what a write adds or changes, and a `pv_`/`perf_` month must be the present one or one either side.

### `storage.rules`
The Firebase Storage rules. `huddles/`, `circulars/` and `newsletters/` are read, written and deleted by the admin only, and a write must be at most 20 MB and a PDF or Word (.docx) file (`MAX_FILE_BYTES` in `functions/index.js` must match); every other path is denied. Nobody opens a file through these rules: the app opens a short-lived signed url (`getDocumentUrl`) or the stored tokenised download url, both of which bypass them, and `ingestHuddle` uses the Admin SDK. Verify with `npm run test:rules`.

### `index.css` / `admin.css` / `paycalc.css` / `operations.css` / `settings.css` / `links.css` / `overtime.css` / `trains.css` / `newlink.css`
Each app page's own stylesheet, loaded after `shared.css`. A visual change specific to one page goes here; anything two pages share goes in `shared.css`. Served from the service worker's version cache like the app's JS. Tokens, surfaces and the recipes are `.claude/rules/css-tokens.md`; a raw hex colour fails `css-hex-parity.test.mjs`.

### `guide-shell.css`
The shared chrome of the five guide pages, linked first on each: the sticky navy header (back button, title, ⤓ PDF), the chip bar (its chosen chip gold), the one section heading (`h2`) and the one link style all five use, the footer back link, the print rules, the Inter `@font-face`, and the guides' own palette tokens (`--navy`, `--navy-dark`, `--navy-mid`, `--gold`) in its `:root`. Change guide chrome here once, never re-inlined into a page. The guides do not load `shared.css`. Full specification: `.claude/rules/guide-pages.md`.

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
- `SAFE_NOTIFICATION_PAGES` — the pages a notification tap may open; a payload's path is re-based onto this install's own scope and its origin is never trusted. A new notifying feature's landing page joins it. It matches `.claude/rules/notifications.md` → Deep link entry for entry; `sw-asset-check.test.mjs` checks both directions.
- A document cache miss races the network against a cached fallback only when one exists; with nothing cached it waits for the network, and the synthesised offline page names the page asked for and has a Try again button that reloads (keeping a notification's #fragment). Every app page and guide falls back only to itself (the [keyword, page] table); only an unknown page falls back to the Calendar. A held page is served with no network request, and Navigation Preload is turned off on activate. Anything under `docs/` is left to the browser.
- `pushsubscriptionchange` re-subscribes with the key the old subscription carried, so this file holds no copy of the VAPID key; `notif.js` re-saves the server record.

### `roster-cycle-data.js`
The raw roster cycles — `weeklyRoster`, `bilingualRoster`, `fixedRoster`, `cesRoster`, `dispatcherRoster` — and `FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS` (v25.97: the fixed patterns on which a bank holiday is a rest day; `fixedRoster[4]`, the placeholder line, is the one), with no logic and no imports. Imported only by `roster-data.js`, which re-exports them; app code reads shifts through `getBaseShift`, never from a pattern directly. A cell is `RD`, `OFF`, `SPARE`, `AL`, `RDW`, `HH:MM-HH:MM` or, Monday to Saturday, a bare Other flavour (`fixedRoster[3]` is Training with no times); `validateRosterPatterns` in `roster-data.js` checks every pattern. **A fixed pattern is SHARED**: editing one member's line edits everyone on it.

### `roster-member-data.js`
The roster's PEOPLE and nothing else — `teamMembers`, one entry per member, no logic and no imports. Its length tracks headcount, which is why it is not in `roster-data.js` (whose size guard was crossing on hiring rather than on complexity). **Re-exported by `roster-data.js`**, where every consumer reads it, the generator and the classification test included. To add or remove somebody: `/new-starter` and `/leaver`.
- **It is world-readable**: both origins serve it with no session, PIN or token, so a field added here is published the moment it ships. The classification argument is on `teamMembers` in CLAUDE.md, and `public-data-classification.test.mjs` fails on an unclassified field; anything a stranger should not read belongs in Firestore behind a claim.
- The field reference is `.claude/rules/roster-data.md` (CLAUDE.md → "teamMembers fields" keeps what every area needs); the comment at the top of the file covers the core fields and `rosterChanges`.

### `functions/index.js`
The COMPOSITION ROOT of the Cloud Functions. **Its exports are the deploy surface** — Firebase discovers functions from them — and `functions-surface.test.mjs` pins every deployed name, failing on a drop or an unreviewed addition. It defines the shared infrastructure: the four `defineSecret` params, `VAPID_PUBLIC_KEY` (guarded by `sw-asset-check.test.mjs`; it must match `notif.js`), `STAFF_SITE_URL`, `ADMIN_FUNCTION_ORIGINS`, `readRawBody`, `nowInLondon`, the size caps and the commit-ambiguous code set. It keeps two endpoints and spreads in the rest from `buildDocumentEndpoints`, `buildAuthEndpoints` and `buildOvertimeEndpoints`, passing them that infrastructure so no domain owns a second copy of a guarded literal.
- `parseRosterPDF` — the admin's roster upload → the parsed week for review; it writes nothing. It stays here because `roster-prompt-parity.test.mjs` reads the PDF prompt from this file. The PDF-grid read (`roster-geometry.js`) is started and awaited, bounded, BEFORE the model call; a usable cell table picks the cell prompt (`roster-prompt.js`); a sheet whose printed week is not the week chosen is answered 409 (`roster-week-heading.js`); the request settings are `MODEL_REQUEST`; and the geometry witness is applied LAST, after every model-side repair. The model call carries one deadline, `PARSE_MODEL_DEADLINE_MS` from the request's arrival. A 4xx refusal other than 408/409/429 is reported as a refusal, not an outage. The response carries `parsed`, `choices`, `missingMembers`, `duplicateMembers`, `geometry` and `geometryRefused`. The pipeline's contract is `.claude/rules/roster-import.md`.
- `unlockCalendarViewer` — the staff Calendar PIN exchange. Its handler source, secret binding and no-log rule are pinned to this file by `calendar-viewer-parity.test.mjs`; the rules it applies are `functions/calendar-viewer-auth.js`.
- Both handlers are EXECUTED by `index-endpoints.test.mjs`; `functions-surface.test.mjs` proves only that they exist.

### `index-endpoints.test.mjs`
Drives the two handlers `functions/index.js` keeps — `parseRosterPDF` and `unlockCalendarViewer` — for real: their rules were exemplary while nothing asked whether the handler calls them, in order, and acts on the answer (CLAUDE.md → "The rule tested, the wiring not"). Organised by what a wrong answer costs: every refusal of the roster parser asserts the MODEL WAS NOT ASKED, and the PIN tests cover the uncounted guess, both throttle ceilings, concurrent guesses, a rebuilt tampered viewer account and the minted token's single claim. It also pins `MODEL_REQUEST` through the real SDK against a local server. The fakes enter `require.cache` before `index.js` is required, and every fake RECORDS. Runs in `npm run test:functions`; its header names the mutations it was checked against.

### `functions/documents.js`
The document-and-notification domain. `buildDocumentEndpoints(deps)` — a factory taking the shared infrastructure from `index.js` (secrets, the VAPID public key, `STAFF_SITE_URL`, `ADMIN_FUNCTION_ORIGINS`, `readRawBody`, `nowInLondon`, `isRetriableFirestoreError`, the caps, and `rosterMembers`, the server-owned roster the pay reminder reads its audience from); `index.js` re-exports what it returns under the same names, and a handler not re-exported there does not exist to Firebase.
- `getDocumentUrl` — POST `{ kind }` with a bearer ID token → `{ url, expiresAt, fileType, storagePath }`, a short-lived signed url for the LATEST document of that kind. The caller names a KIND, never a path (`functions/doc-url-core.js`), and the door mirrors the `firestore.rules` read. A 503 is what a missing `roles/iam.serviceAccountTokenCreator` grant looks like (CLAUDE.md).
- `rotateDocumentLinks` — admin-only POST: a preview unless the body says `rotate: true`; the work is `functions/doc-link-rotation.js`. A read failure is a 503 with `changed: false`, and only that body may say nothing changed — the platform sends 503s of its own, possibly halfway through the writes.
- `ingestHuddle` — Power Automate → Storage and Firestore: timing-safe bearer auth, base64 and file-signature checks, DOCX → HTML through a lazy `mammoth`, and the metadata written in a transaction. A re-run of that transaction after a lost commit answer that finds its own path writes nothing — Document links may have moved the record's link meanwhile — and answers what the committing attempt saw, so a first upload is still announced. It declares 512 MiB, refuses a date after London's tomorrow, keeps a .docx over `MAX_DOCX_CONVERT_BYTES` as a file, and announces a first upload or the replacement of a HAND upload — only when it is the latest Huddle. It awaits the three-month `pruneOldHuddles` (`functions/huddle-retention.js`) before it responds; a failed prune never fails the upload.
- `onHuddleCreated` (the push for a manual admin upload; it skips `power-automate`, which `ingestHuddle` already notified) · `onCircularCreated` · `onNewsletterCreated` — `onDocumentCreated` triggers, each pushing its document-arrival notice through `buildPushPayload` and `fanOutPush`; each announces only when its document is the LATEST of its kind (`isLatestOfKind`; a failed read still announces).
- `sendPayReminderNotification` (daily at 08:00 London; on pay-cutoff Saturdays it calls `sendPayReminder`, `functions/pay-reminder.js`) · `sendTimetableReminder` (daily at 18:00 London; sends once, the evening before `TIMETABLE_CHANGE`, landing on `trains.html`).
- `HUDDLE_PUSH_PAUSED`, the Huddle push kill switch, lives here.

### `functions/pay-reminder.js`
WHO the pay reminder reaches: CEA and CES members only (owner decision, 10 Nov 2026), because the Pay Calculator prices only the grades `gradeForRole` knows and turns everybody else away. The schedule that decides WHEN stays in `documents.js`.
- `PAY_REMINDER_GRADES` — the server roster keys addressed (`cea`, `ces`), spelt as `gradeForRole` answers. `documents-endpoints.test.mjs` takes its expected audience from `gradeForRole` itself, so a newly priced grade fails a test rather than silently missing its members.
- `payReminderMembers(roster)` — the names, from the server-owned `roster-members.json`, never a request; a missing grade list is logged, not guessed.
- `sendPayReminder({ payday, roster, vapidPrivate, vapidPublic, STAFF_SITE_URL })` — resolves each name to its account uid (refusing the shared PIN account, skipping any failed lookup) and sends through `sendTargetedPush`, which fails closed: no uids, nothing sent — never everyone. Returns the subscriptions that accepted it.

### `functions/huddle-retention.js`
How long a Daily Huddle is kept, and what its clean-up may delete. It owns no endpoint; `ingestHuddle` (`documents.js`) awaits it at the end of every upload, passing Firestore, the bucket and `nowInLondon` in, so the module requires no Firebase SDK.
- `pruneOldHuddles(excludeDate, { db, bucket, nowInLondon })` — deletes Huddles older than `HUDDLE_RETENTION_MONTHS` (3), London dates, month-end clamped. **Only what it selected** (v25.89, external review): each document is re-read in a transaction and left alone if a replacement moved its `storagePath`, then only THAT version's object is deleted, by name and only under `huddles/<date>`. The old prefix sweep after the delete took a replacement upload's file and left its document pointing at nothing.
- `sweepHuddleOrphans(bucket, db, date, nowMs)` — the rest of a pruned date: an object goes only when it is older than `HUDDLE_ORPHAN_MIN_AGE_MS` (a day — no upload in flight is that old) AND the date's document, read after listing, does not name it. An unknown age is kept.
Tested through the ingest by `documents-endpoints.test.mjs` ("the retention sweep …"), including uploads landing mid-sweep.

### `functions/auth-endpoints.js`
The account-and-credential domain. `buildAuthEndpoints(deps)` — the same factory pattern; the pure decisions it orchestrates are unit-tested in `roster-parse-helpers.js`. `unlockCalendarViewer` is deliberately NOT here (`index.js`).
- `setupRosterAuth` — creates the roster's Firebase Auth accounts and sets each tier's claims (`{admin,name,member}`, `{manager,name,member}` or `{name,member}`, plus `linksDesigner`; admin outranks manager). **The member and role lists are SERVER-OWNED** — `roster-members.json`, generated from `roster-data.js` and CI-locked — and never the request body, which carries only action flags. It fails closed on an empty config, unions the role-holders into the processed set so a leaver sweep can never disable one, and previews leavers by default (`removeOrphans`); `confirmOrphanRemoval` disables them, revokes their tokens and releases their push records — and, on every confirmed run, releases those of the leavers already disabled (`disabledLeaverPushRemoved` counts them; they are not listed as newly disabled). An account claimed for ANOTHER member is never adopted (reported in `failed`). A NEW account is stamped (`resetAt`) before it is created, and only one the account list (`getUsers`) does not hold; no answer or no stamp creates nothing for that name. A DISABLED account is re-enabled only after the reset an admin reset does (stamp, surname default, sessions revoked; the previous holder's push records released, best effort), and is named in `reclaimed`. Re-run it after adding a manager or designer, so their claim lands. An account it takes admin, manager or linksDesigner from is signed out of every device at once and named in `demoted` (a failed sign-out is in `failed`); the same tier or a higher one never is.
- `resetMemberPassword` — the admin break-glass: stamps `passwordStatus.resetAt` FIRST (no stamp, no reset: a 503 with nothing changed; a password write Auth REFUSES puts the stamp back, one whose outcome is unknown keeps it — `functions/account-lifecycle.js`), resets the member to their surname default (`nameToPassword`), revokes their refresh tokens on every reset, refuses (409) an account claimed for another member or linked to the PIN account, and tells the MEMBER on their own devices (`sendTargetedPush`, to the uid the handler already holds; the payload never carries the password). `revoked` and `notified` are reported separately; `stamped` is always true. The credential has already changed by then, so a later stage failing never reports the reset as failed. `lostDevice: true` (strictly the boolean) is the lost-or-stolen-phone reset: no notice, and every push record the account owns is deleted (`releasePushForOwner`) as a fourth stage, answered as `pushReleased: <count>` or `pushReleaseFailed: true`.
- `requestPasswordReset` — built by `functions/reset-request.js` and returned with the rest. Its server-side kill switch, `RESET_REQUESTS_ENABLED`, stays in this file and is handed in.
- `getSignInStats` — admin-only: the exact unique sign-in counts from Firebase Auth's `lastSignInTime`, over the server-owned roster; four integers, no identity.
- `getAccountSetupGaps` — admin-only READ: who has no account (`no-account`), no claim at all (`unstamped` — an account Set up accounts will TAKE BACK), a disabled one (`disabled`) or the wrong claims (`claims`), and which roster-domain account is still enabled for a leaver. **It returns NAMES**, grouped by remedy (`setUp`, `leavers`); `summariseAccountGaps` makes every judgement, including the refusal when no roster account is visible at all.

### `functions/account-lifecycle.js`
The pure rules Set up accounts and the admin reset apply at the edges of an account's life (sign-in audit, Nov 2026). Requires only `roster-parse-helpers.js`; tested by `account-lifecycle.test.mjs` and, through the real handlers, `auth-endpoints.test.mjs`. `auth-endpoints.js` is the orchestration; the reasoning is the header.
- `passwordWriteRefused(err)` — whether an error from a password write PROVES nothing changed: an ALLOWLIST (the SDK's argument checks, `auth/invalid-password`, `auth/user-not-found`). Anything else is an unknown outcome, because `updateUser` writes and then reads the account back. A refusal puts the reset stamp back (`restoreResetAt`, pinned to its own stamp's write time); an unknown outcome keeps it, the safe direction.
- `unwrittenResetAnswer(member, err, { restored })` → `{ status, error }` — 409 (404 for a missing account) and "Nothing was changed" only when refused AND restored; a refusal whose restore failed says the password did not change but the reset is still recorded; an unknown outcome is a 500 that says resetting again is safe.
- `elevatedClaimsLost(before, after)` / `ELEVATED_CLAIMS` — which of `admin`, `manager`, `linksDesigner` a re-stamp takes away (only `true` counts as held; manager → admin is a rise, not a loss). `setupRosterAuth` revokes such an account's refresh tokens once the new claims are on, so every `checkRevoked` endpoint refuses the old tier at once, and names it in `demoted`.
- `disabledLeaverUids(users, activeEmails)` — the leaver accounts ALREADY disabled, judged by `computeOrphanLabels` as if enabled, so it is exactly the sweep's own filter (never a current member, never the shared PIN account). Every confirmed sweep releases their push records again: a phone whose token outlived the sweep can save its record anew.

### `functions/reset-request.js`
The public reset-request doorbell, split out of `auth-endpoints.js` whole; its header says why and what stayed behind. `buildResetRequestEndpoint(deps)` — the same factory pattern, called by `buildAuthEndpoints`, which passes the kill switch in as `enabled` (only `true` opens the door).
- `requestPasswordReset` — one of the two public unauthenticated endpoints (with `unlockCalendarViewer`): records a locked-out member's request (the document id is the member's name, so the collection is bounded by the roster), throttled in a transaction, and tells the admin through `sendTargetedPush`. Every answer to a valid name waits for `RESET_REQUEST_ANSWER_FLOOR_MS` (3 s), so a throttled repeat cannot be told from a recorded request by its timing. One push per burst is decided by a claim taken in a two-attempt transaction; a push that reached nobody is tried once more. The admin push has its own shorter bound (`ADMIN_NOTIFY_SEND_TIMEOUT_MS`), and its `notifiedAt` stamp is an `update()`, which never re-creates a cleared row.
- Tested through the real handler by `auth-endpoints.test.mjs`; the throttle, the coalescing window and the notice's words are `roster-parse-helpers.js`'s.

### `functions/calendar-viewer-auth.js`
The PURE server rules behind the staff Calendar PIN — CommonJS, kept apart from `req`/`res` so they are testable (`calendar-viewer-auth.test.mjs`); the uid and claim agreement across the browser, CommonJS and `firestore.rules` is `calendar-viewer-parity.test.mjs`.
- Exports: `isValidPinShape` · `pinMatches(a, b)` · `sourceKeyFor` / `clientIpOf` · `throttleDecision` / `recordFailure` / `isThrottleStateStale` · `reserveAttempt` / `refundAttempt` · `viewerAccountTamper` / `isViewerAccount` · `viewerClaims()` (the one claim set the minted token carries) · `CALENDAR_VIEWER_UID` · `PIN_LENGTH` · `DEFAULT_THROTTLE` · `GLOBAL_SOURCE_KEY` / `GLOBAL_THROTTLE`.
- **The PIN is never learnt, stored, logged or returned** — no "which digit was wrong" and no input echo. **The throttle is sized against a real tension**: 10,000 combinations on one side, the whole station behind one corporate address on the other; read `DEFAULT_THROTTLE`'s comment before changing a number in either direction. The source key comes from the END of `x-forwarded-for`, which a caller can only prepend to.
- **Every attempt is charged BEFORE its compare**, in the transaction that checks the block (`reserveAttempt`), and a right PIN is refunded afterwards (`refundAttempt`), so concurrent guesses cannot all be compared uncounted; a refund to zero deletes the row, so the store cannot count usage. `viewerAccountTamper` names a shared account somebody linked a way in to (the unlock rebuilds it); `isViewerAccount` keeps Set up accounts and the leaver sweep off it.

### `functions/push.js`
The web-push TRANSPORT: how a payload reaches a phone, never what it says or when — that is `buildPushPayload` (`roster-parse-helpers.js`) and `.claude/rules/notifications.md`.
- `getWebPush()` (the lazy `web-push` require) · `setupWebPush(vapidPrivate, vapidPublic)` (once per instance) · `fanOutPush(payload, logTag)` — every subscribed device · `sendTargetedPush(payload, ownerUids, logTag, { timeoutMs }?)` — named uids only, an optional SHORTER per-send deadline for a caller that must answer quickly · `releasePushForOwner(uid)` — deletes the records one account owns, the leaver sweep's last step (an empty uid touches nothing) · `pushSendOptions(payload, timeoutMs)` / `PUSH_TTL_BY_TAG` — how long a push service may hold each feature's notice; a new feature adds its tag or gets a day.
- **`sendTargetedPush` fails CLOSED at every step**: no target uids → nothing sent; a record with no `owner` → skipped, never assumed; no matches → log and stop. There is deliberately no fall-back-to-everyone branch, because the notice that needs it is "N. Surname is locked out".
- Both senders skip any endpoint `isAllowedPushEndpoint` refuses, and delete a record only on a 404 or 410 (`shouldDeleteSubscription`), never on a 401.

### `functions/roster-geometry.js`
What the roster PDF's OWN GRID says about where each cell is, and the one refusal that follows: the only check in the import the model cannot influence, because the table's rules are DRAWN. CommonJS; the header holds the measurements, the hazards and the pdfjs brief. Tested by `roster-geometry.test.mjs` through the REAL pdfjs, on a PDF the test writes by hand.
- `extractRosterGeometry(pdfBytes, {loadPdfjs?})` → `{ available, reason?, rows, pagesRead, pagesRejected, weekEndings }` — the only code that touches pdfjs, dynamically imported; `weekEndings` is the sheet's own printed week, from every page with text (`roster-week-heading.js`). **It never throws**: `pdfjs-unavailable`, `unreadable-pdf`, `no-grid`, `no-text`, `work-budget` (a deadline checked between pages, keeping the pages already read) and `no-rows` (a grid read that placed no member row) are each a fail-open reason.
- `rulesFromOperatorList(ops, OPS)` → `{ vx, hy }` — the stroked rules, clustered to 2px · `assignRunsToGrid({ items, vx, hy })` → rows of seven cells, or null unless the page has exactly `GRID_COLUMNS` vertical rules; the print footer and header furniture are filtered out.
- `matchGeometryRow(memberName, rows)` — exactly one row or null; a duplicated name is NO signal (`Vacant` appears three times on a real sheet).
- `applyGeometryWitness(safeEntries, geometry, dates)` → `{ status, refused, checked, total, unmatched }`. **An AI day the physical cell cannot support is REFUSED, not weighed**: a claim on an empty cell becomes `UNKNOWN|…` and the member's whole row is reported, so the review unticks it. It cannot see a fully occupied week, or an `RD` in an occupied cell.
- `geometryCoverage(stats, reviewedNames)` → `{ status, checked, total }` — recounted over the rows the admin will see, so an invented name cannot inflate the denominator.
- `awaitGeometryWithin(promise, ms?)` / `GEOMETRY_WAIT_BUDGET_MS` / `GEOMETRY_WORK_BUDGET_MS` / `settledGeometry` — the bound is on the WAIT, not the work; a timed-out wait fails open, and `settledGeometry` re-asks a `wait-timeout` (and only that) before the witness runs.
- **`pdfjs-dist` is pinned to 6.5.438** (v25.91): `rulesFromOperatorList` reads the 5.4.394+ path data (`PATH_OP`, codes the library does not export) and skips exactly what a PDF `re` becomes (`isRectangleOp` — a box drawn by hand is still read, unless it is drawn in a `re`'s own corner order), after dropping the close pdfjs writes into a path painted with `s`, `b` or `b*` (v25.94 — kept, it made a rule look like a zero-width `re` and a `re` look like four rules), and a change of encoding makes every document `no-grid` with no error, which only the real-pdfjs tests catch. The adapter asks for `useWasm: false`. `_isClaim`, `_nameTokens` and `_PATH_OP` are test seams.

### `functions/roster-other-days.js`
What a roster cell reads as when it names an Other-family day — Training, Induction, Assessment, Team Day, Union course, Meeting (OTHER_DAYS.md). CommonJS, requires nothing; `normaliseShift` asks it before any time is read. A deliberate duplicate of the RECOGNITION side of the client grammar (`_OTHER_RE`, `override-utils.js`), because CommonJS cannot import a browser module.
- `OTHER_DAY_ALIASES` — the roster's words → the sentinel, an explicit table. **Each sentinel is also its own alias**, because the prompt asks the model to return the sentinel.
- `readOtherDayCell(s, workedRange)` → the canonical value, or null when the cell is not a clean Other-family cell: a bare flavour with an RDW marker on either side, or a MEETING with one time range in either order (`meetingWithTimes`). **A meeting is always a meeting** (owner decision); the other five keep the no-times rule.
- `namesMeeting(s)` — whether a cell names a meeting anywhere; `normaliseShift` sends such a cell to review rather than keep its time and drop the code.
- Tested by `roster-parse-helpers.test.mjs` (including that its sentinels equal the client's `OTHER_FLAVOURS`), through the handler by `index-endpoints.test.mjs`, and against the prompt by `roster-prompt-parity.test.mjs`.

### `functions/roster-sunday-repair.js`
Layer 1 of the day-drift defence, the Sunday-anchored repair, and what happens to a Sunday it could not repair. CommonJS; requires `cell-day-rules.js` and `roster-parse-helpers.js`, and only `functions/index.js` requires it. The contract is `.claude/rules/roster-import.md`.
- `applySundayScanCorrections(entries, sundayScan, hasSundayCol, dates, choices?)` → the DISPUTED members. Case A — the blank Sunday dropped and the row one day left — is right-shifted back only when the Saturday slot holds the blank-Saturday question `buildSafeEntries` writes, and only on a Sunday claim the row read made (a cross-check question there is judged by its pick, and a shifted row takes its picks with it); a Saturday reading `RD` is a printed rest code, so that row is disputed instead. Case B is a stripped RDW marker. A printed `OFF` Sunday is a rest day, never a Case A claim. A disputed row keeps its Sunday claim, because overwriting it with `RD` would erase the one value the geometry witness can refuse.
- `settleDisputedSundays(entries, disputed, geoStats, dates, sundayScan)` — AFTER the witness: a Sunday it refused is already a question; one the grid shows as occupied keeps the row read only when the scan saw a literally empty cell; anything the witness could not look at becomes `UNKNOWN|…` for review.
- The wiring is pinned by `index-endpoints.test.mjs`, the rules by `roster-parse-helpers.test.mjs`.

### `functions/roster-week-heading.js`
The week the roster SAYS it is for, and the refusal when that is not the week chosen on the upload form: a WHOLE week out, which the day-drift layers cannot see, caught from the PDF's own printed text with no model involved. CommonJS; requires `london-clock.js` only. The contract is `.claude/rules/roster-import.md` (day drift, layer 4).
- `weekEndingsOnPage(runs)` → `[{ printed, iso }]` — every `Week Ending: DD/MM/YYYY` one page's text runs carry, the label and the date joined when they are two runs on one line (the measured layout); `iso` is null unless the date is a real Saturday. Only that form is read, so the footer's `Print Date:` is never taken for the week. `extractRosterGeometry` gathers these from every page with text, grid or not.
- `checkSheetWeek(geometry, weekEnding)` → `{ status: 'match'|'mismatch'|'unread', note, message?, sheetWeek? }`. A heading naming another Saturday is a `mismatch`, with a message naming both weeks; `parseRosterPDF` answers it 409 before the model is called, or once the grid read settles when its early wait gave up. No usable heading is `unread`: the read goes on and the `note` is logged. Never a guess either way.
- Tested by `roster-geometry.test.mjs` (synthetic runs, and a synthetic PDF through the real pdfjs) and, through the handler, `index-endpoints.test.mjs`.

### `functions/roster-prompt.js`
The two roster-parse prompts, the ONE vocabulary they share, and how the model is asked. CommonJS; the header holds the phase-2 argument and its measurements. Tested by `roster-cell-read.test.mjs` (`test:functions`) and `roster-prompt-parity.test.mjs` (hygiene).
- `SHIFT_VOCABULARY` — the code table. **There is exactly one copy**: both prompts interpolate it, and `roster-prompt-parity.test.mjs` reads it here, holding every code the prompt names, and every value it tells the model to return, to what `normaliseShift` accepts.
- `buildCellTable(geometry, memberNames)` → `{ usable, reason, rows, matched, unmatched }` — the grid's cells for the members this roster covers. **All or nothing per document**: one member the grid misses falls the whole document back to the PDF path. `renderCellTable(rows)` — the table as the model sees it, JSON, each cell labelled with its day inside the row · `buildCellPrompt(rows)` — the phase-2 prompt: the day of every cell is already decided and is not the model's to change.
- `reviewBlankReadsOfFilledCells(safeEntries, parsedMembers, cellRows, dates)` — an EMPTY read of a cell the grid shows holding something other than a rest marker becomes a review cell naming what it holds · `reviewRestReadsOfEmptyCells(safeEntries, cellRows, dates)` — a rest day read for an EMPTY weekday cell becomes a review cell too (a blank Sunday is a rest day, so Sunday is left alone). Neither counts as a witness refusal or feeds the drift breaker.
- `repeatedMembers(parsedMembers, names)` → the members of `names`, in its order, that the model listed more than once. It is asked of `memberRows`, so these are exactly the names `buildSafeEntries` skipped a row for. `parseRosterPDF` passes `relevantNames`, the list `missingMembers` is judged against, and sends the answer as `duplicateMembers`. Tested through the handler by `index-endpoints.test.mjs`.
- `MODEL_REQUEST` — the frozen request settings: the model, thinking as far off as the model allows, the effort and `max_tokens`. Its JSDoc says why each is set, and `index-endpoints.test.mjs` pins them through the real handler and SDK, because no stub raises the model's 400. `DECLINED_ERROR` — what the admin reads when the model declines; a decline is not an unreadable answer, and a retry cannot change it.
- `DAY_LABELS` — the day names the table and its review messages use. Wired in `functions/index.js`, where `cellTable.usable` picks the prompt.

### `functions/roster-parse-helpers.js`
Pure helpers for the Functions — no Firebase, no HTTP, no secrets — required across `functions/`. **Its `module.exports` block is the list**; the families are below. Tested by `roster-parse-helpers.test.mjs`. Read `.claude/rules/roster-import.md` before changing a parse helper.
- **Reading a roster:** `normaliseShift(raw, { quiet? })` — a model's cell → the app's value: times, the `RDW|HH:MM-HH:MM` pipe encoding (never strip `RDW` from the model's answer), the status codes (`NA` and `NS` → `RD`) and the Other days through `roster-other-days.js`; a non-empty cell it cannot read becomes `UNKNOWN|<raw>`; `quiet` classifies without logging · `buildWeekDates(weekEnding)` · `extractAIJson(text)` · `HEADER_TO_INDEX` / `headerToDayIndex(header)`, the one header resolver for every parse layer · `mapColumnHeadersToDates(headers, dates)` · `memberRows(parsedMembers)` — which row speaks for a member the model named twice: the first that says anything · `buildSafeEntries(parsedMembers, headers, dates)` — seeds a missing or empty day through `blankCellMeaning`, then normalises · `applyColumnScanCrossCheck(...)` (layer 2), `normaliseScanValue`, `reviewLabel`, `parseStrictIsoDate`, and `BLANK_CELL_TOKEN` / `isPhysicallyBlank` re-exported from `cell-day-rules.js`.
- **Files and dates:** `fileSignatureMatches(buffer, fileType)` — a PDF must start `%PDF`, a DOCX `PK` · `isPayCutoffDay(date)` — mirrors `isCutoffDate` in `roster-data.js`.
- **Credentials:** `nameToEmail(fullName)` / `nameToPassword(fullName)` — the CommonJS twins of `auth-identity.js`, both built on `surnameCore(fullName)`, this side's one copy of the surname rule (`surname-parity.test.mjs`).
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
May this Calendar read the documents? The Daily Huddle, Weekly Retail Circular and Marylebone Newsletter are visible only with the staff PIN or a password (an owner decision — CLAUDE.md). `firestore.rules` enforces that on the server; this makes the client honour it, because a read the local cache can answer never consults the rules. It keeps no answer of its own and cannot change the one there is: it imports the read and the listen from `calendar-access-state.js`, and nothing else. Tested by `calendar-doc-access.test.mjs`.
- `hasDocumentAccess()` · `onDocumentAccess(fn)` → unsubscribe (told once per CHANGE, never on a no-op) · `documentAccess` — the frozen `{ has, onChange }` handle the viewers take · `_clearDocumentSubscribersForTests()` (test seam: it drops the subscribers and shuts nothing).
- Opens and shuts with the roster reads, by construction: a grant (`calendar-access.js`) and every way of losing access write the one state. A deliberate Lock reloads, so the default applies.
- **Subscribers, not just a flag**: the Huddle viewer's live subscription has to START when access arrives (a notification tap that met the PIN card opens the Huddle once the PIN is in), and a Circular tap made while locked is finished on unlock.
- Consumers: `calendar-huddle-viewer.js` and `calendar-doc-viewer.js` (`docAccess`), and `nav-panel.js` (`canReadDocuments`, which refuses before the blank tab opens). Every other page keeps the default, which is always open.

### `calendar-access-state.js`
Is Calendar access held right now? The ONE copy. `calendar-access.js` writes it (`grant`, `handleAccessLost`), and the roster gate shuts it where a read is refused because access has gone; the roster gate (`calendar-overrides.js`) and the document gate (`calendar-doc-access.js`) read it, so no route that loses access can shut one and leave the other. No imports. Tested by `calendar-access-state.test.mjs`.
- `hasCalendarAccess()` · `grantNumber()` (advanced on every grant; a read's ticket carries it) · `setCalendarAccess(open)` — THE ONE WRITE, under ONE name and with one argument · `onCalendarAccess(fn)` → unsubscribe; `fn({ open, changed })` hears every write.
- **Three properties:** shut as loaded; only a literal `true` opens; written BEFORE anyone is told, so no listener reads through a gate in the old position and listeners need no order among themselves.
- **Every `true` is a grant**, even over a Calendar already open: the roster reads start afresh on every grant, the documents are told only when the answer changes.
- **A new thing that must follow access reads or listens here.** It does not get a copy, and no gate gets a writer of its own: a second name reads as a narrower act than it is ("shut the documents" would lock the whole Calendar). `calendar-access-state.test.mjs` counts every call of the write as written — one grant and one shut in the access layer, one shut in the roster gate, none anywhere else.

### `calendar-redraw.js`
When may the Calendar page draw, and what does its next draw owe? One scheduler, created once by `calendar-app.js`, which hands it the swipe's answer, the surface on screen and the two draws. It decides when and on which surface; it draws nothing. No imports; the clock is handed in. Tested by `calendar-redraw.test.mjs` and the `redraw:` tests in `e2e/calendar.spec.js`.
- `createRedrawScheduler({ gestureLive, teamViewOn, drawCalendar, drawTeam, saveName, nameApplied, setTimer? })` → `reach(stage)` · `reached(stage)` · `repaint(why)` · `nameChanged()` · `focusWanted({ onCell, nowhere })` · `focusSettled(wanted, given)` · `owed()`. Also `GESTURE_POLL_MS` (60) and `START_STAGES`.
- **Start-up is a sequence, forward only:** `shell` (the page has loaded) → `workspace` (the first grant) → `surface` (the boot has drawn the Calendar or Team View). A re-lock does not go back.
- **Four rules:** never while a gesture is live (v16.23); ONE wait, and what is owed is settled together — a held repaint and a held change of name are one draw; the surface is asked when the work runs, so nothing is painted into Team View (v16.21) and the name is still saved; nothing is repainted before the workspace exists.
- **The focus debt:** a draw that replaces a focused day cell gives the new grid's anchor the focus, and a panel with no day cells owes it to the grid that follows — while focus is still nowhere.
- **A new thing that must wait for the gesture joins the one wait.** It does not get a timer of its own; `calendar-redraw.test.mjs` fails when `calendar-app.js` asks whether a gesture is live anywhere but the hand-over.

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
