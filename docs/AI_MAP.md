# AI_MAP.md — Claude routing guide for MYB Roster

*Last updated: November 2026 — v26.50 · Updated every 0.10 version*

Use this file to decide which source file to read or edit for a given task.
Read CLAUDE.md first for project identity, version bumping rules, and architecture constraints.

## What an entry holds

An entry is a routing card: what the module is FOR, in a sentence or three, and where its rules live —
the rule file or contract that binds it and the tests that guard it. Then one line of its exports.

- **The purpose is written by hand.** It says enough to decide whether this is the file to open.
- **The export line is generated** — `npm run generate:ai-map` writes `- **Exports:**` from the code
  (`scripts/ai-map-lib.mjs`), and `doc-parity.test.mjs` fails a stale one. Never edit it by hand; run
  the script after changing a module's exports or adding an entry.
- **The reasoning is not here.** Invariants, the why, "never do X because Y", what an export returns:
  the module's own header and JSDoc, where an editor is already looking and where it cannot drift from
  the code. Release history is git log (CLAUDE.md → "Current file structure", the three homes). An
  entry that restates its module is a second copy, and the second copy is the one that goes wrong.

`doc-parity.test.mjs` also checks that every module has its own `###` entry, that a
"`symbol` in `file.js`" claim is true, that a backticked name the source no longer holds is marked as
gone, and that no card outgrows its cap.

---

## Quick decision table

| Task | Primary file(s) |
|------|----------------|
| Roster logic, team members, bank holidays, pay periods | `roster-data.js` |
| Raw roster cycle patterns | `roster-cycle-data.js` |
| The roster's people (`teamMembers`) | `roster-member-data.js` (re-exported by `roster-data.js`) |
| Calendar coordinator — event wiring, month navigation, the access hooks | `calendar-app.js` |
| Calendar display month and year, and the browsed month kept across a reload | `calendar-state.js` |
| Calendar swipe carousel | `calendar-swipe.js` |
| Calendar annual-leave panel and day-detail panel | `calendar-al-lightbox.js` |
| Calendar first three-month read and the sync chip | `calendar-initial-fetch.js` |
| Calendar keyboard navigation and hover tooltip | `calendar-keyboard.js` |
| Calendar override cache | `calendar-overrides.js` |
| What the Calendar knows about each month, and so what it may show | `calendar-data-state.js` |
| The Calendar's access gate, the cards that stand in for it, and its pure rules | `calendar-access.js` · `calendar-lock-cards.js` · `calendar-lock-slot.js` · `calendar-access-core.js` |
| The member's own roster kept on the device, shown labelled before the sign-in check finishes | `calendar-snapshot.js` |
| The Calendar page's one-time notices (which are live: the new-notice skill → "Current notices") | `calendar-notices.js` |
| Calendar member selection | `calendar-member.js` |
| The phone's text scale, measured rather than asked, for the Calendar's control rows | `text-scale.js` |
| Calendar rendering — the grid, the header and the day cells | `calendar-renderer.js` |
| The month legend — which keys apply, and whether it shows at all | `calendar-legend.js` |
| The document gate on the Calendar — may the Huddle, Circular and Newsletter be read (opened on the grant, shut on access lost) | `calendar-doc-access.js` |
| Whether Calendar access is HELD right now — the one copy the roster gate and the document gate both read | `calendar-access-state.js` |
| WHEN the Calendar page may draw — the start-up stage, the one wait for a swipe, the focus owed to the next grid | `calendar-redraw.js` |
| The Calendar's menu — built for the saved session, and rebuilt in place for whoever signs in | `calendar-drawer.js` |
| The notification prompt strip and silent renewal on the Calendar (never on the shared PIN viewer) | `calendar-notif-prompt.js` |
| The install strip on the Calendar, and the route the install notice asks of it | `install-prompt.js` |
| Daily Huddle viewer — the `#huddle` hash, the subscription, the two render paths, the per-table scroll boxes (wrapTables) | `calendar-huddle-viewer.js` |
| Which Huddle cells are physically in column 1 (`firstColumnMask`), for the sticky job column | `huddle-table-grid.js` |
| Circular/Newsletter in-app viewer (#circular/#newsletter notification deep link) | `calendar-doc-viewer.js` |
| Team Week View, and which week it opens on | `calendar-team-view.js` |
| Override priority, member start, rest shifts, the shared display ladder (`resolveEffectiveShift`), the Sunday rule, the training value grammar and its pay resolver | `override-utils.js` |
| Body scroll lock, overlay history, focus trap, the lightbox lifecycle, the in-app dialogs, card collapse | `overlay.js` |
| About panel content (version, update status, bug link, print button) | `about-lightbox.js` |
| Per-card ? tips lightbox lifecycle/renderer (content data stays per page) | `tips-lightbox.js` |
| Service worker registration + update lifecycle (every app page) | `sw-register.js` |
| Auth/session helpers — the local session and re-establishing Firebase on load | `session.js` |
| Admin portal UI, login, AL, sick, overrides, module wiring | `admin-app.js` (+ `admin-boot.js`) + `admin.html` |
| Settings page — Password, Work email, Notifications, Install, Pay Calculator data | `settings-app.js` + `settings.html` |
| Nav-panel footer initials badge | `nav-panel.js` + `avatarInitials`/`avatarHue` in `roster-data.js` |
| Operations page — Huddle upload, Roster upload, Staff Login Accounts | `operations-app.js` + `operations.html` (the Circular and Newsletter cards' configuration: `operations-doc-uploads.js`) |
| Error Log card (ops page) — uncaught error capture, the card, Copy for Claude | `error-reporter.js`, `firebase-client.js`, `client-errors.js` (ordering/retention policy), `operations-errors.js`, `operations.css` · the admin's phone told of new entries: `functions/error-log-notify.js` (the rules: `functions/error-log-notice.js`) |
| Usage card (ops page) — anonymous page popularity + active-account counts | `usage-reporter.js`, `firebase-client.js`, `usage-stats.js` (date/aggregation maths), `operations-usage.js`, `operations.css`, `firestore.rules` (`analytics`) |
| Document links card (ops page) — a new key for every stored Huddle, Circular and Newsletter file, so every old copy of a link stops working | `operations-doc-links.js` (the card) · `functions/documents.js` (`rotateDocumentLinks`, the endpoint) · `functions/doc-link-rotation.js` (the rules) |
| Annual leave sheet card (ops page) — the clerks' workbook checked against the app, day by day, and the leave it is missing added for the people the admin confirms | `operations-al-sheet.js` (the card) · `operations-al-save.js` (the Save's answers, confirmations, receipt and Undo) · `al-leave-file.js` (the leave file and its seal) · `al-leave-compare.js` (each day, by the app's own leave rules) · `al-leave-plan.js` (what a Save would write, and its log) · `al-leave-save.js` (the Save, the log and the Undo, against Firestore) · `al-leave-words.js` (every sentence) · the file is made in a session by `scripts/make-leave-file.mjs` · plan of record `docs/AL_UPLOADER_PLAN.md` |
| Links design workspace — the rotation design grid (`ROTATING_LINES` lines), paint mode, hourly coverage heat map, design checks, the generator (Build a link) | `links-app.js` + `links.html` + `links.css` |
| Link-design maths — shift classification, custom-time validation, coverage counting (per-type + hour-by-hour), rotating-window generator, design quality checks | `links-design.js` (pure — no DOM/Firebase; tested by `links-design.test.mjs`) |
| Annual Leave Booking section | `admin-al.js` |
| Which AL days consume entitlement, and a member's taken/booked/remaining position | `al-entitlement.js` (pure — no DOM/Firebase; tested by `al-entitlement.test.mjs`) |
| CHRISTMAS LEAVE — who is shown on leave on 25/26 December, never counted, and the Boxing Day day in lieu | `christmas-leave.js` (pure; `christmas-leave.test.mjs`) · the whole allowance `entitlementFor` in `al-entitlement.js` |
| WHICH YEAR'S ALLOWANCE a day of annual leave comes out of — a January day may be moved to the year before | `leave-year.js` (pure, no imports; `leave-year.test.mjs`) · Admin panel `admin-leave-year.js` · its save `admin-leave-year-save.js` |
| WHICH YEAR the Admin AL figures describe, when four surfaces each imply one | `admin-al-year.js` (pure — no DOM/Firebase; tested by `admin-al-year.test.mjs`) |
| The recorded-DATES list on Admin, and which year of it is shown | `admin-booked-periods.js` (imports only `leave-year.js`; tested by `admin-booked-periods.test.mjs`) |
| Sick Days Recording section | `admin-sick.js` |
| Huddle upload (admin-only, operations page) | `huddle.js` → `initHuddleUpload` |
| Push notifications card (all staff, settings page) — its wiring / its words | `notif-card.js` → `initNotificationsCard` / `notif-card-core.js` |
| Staff Firebase Auth account setup card | `admin-auth.js` |
| Change a Shift — week grid, override entry, bulk bar, save logic | `admin-week-editor.js` (week grid, bulk bar) · `admin-shift-types.js` (`PILL_TYPES`) · `admin-week-collect.js` (what a Save asks to write) · `admin-overrides.js` (save logic) |
| An Admin save or delete must not overwrite a colleague's newer edit — the checked commit, and what counts as changed | `admin-override-store.js` · `override-compare.js` · `admin-week-row-state.js` (what each row showed) · `admin-own-write.js` (the page's OWN write is not a colleague's: the rows it touched follow it) · the weekly roster import's Save: `roster-import-save.js` (`saveRosterWrites`) |
| Inline date-range calendar widget (AL and Sick date pickers) | `admin-rangepicker.js` |
| Roster PDF upload, review pipeline, cell state logic | `admin-roster-upload.js` |
| Roster PDF parsing (Cloud Function) | `functions/index.js` (`parseRosterPDF`) + `functions/roster-parse-helpers.js` + `functions/roster-prompt.js` |
| Pay calculator coordinator — calculate(), autosave, HPP, back-pay | `paycalc-app.js` + `paycalc.html` |
| Pay calculator lightboxes — About, the `?` panels' wiring, YTD notice, decimal converter | `paycalc-lightboxes.js` |
| Pay calculator period arithmetic, select UI, nav | `paycalc-periods.js` |
| Pay calculator grade helpers, settings save/load | `paycalc-settings.js` |
| Roster-assist hint bar UI, fill logic, snap persistence | `paycalc-roster-hint.js` |
| Holiday Pay Premium estimator, shared period decode helpers | `paycalc-hpp.js` |
| Back-pay lump sum calculator | `paycalc-backpay.js` |
| Shared date/currency formatters (pure) | `paycalc-format.js` |
| Result-card HTML builders (pure) — summary + breakdown | `paycalc-breakdown.js` |
| Pay calculator `?` panel text | `paycalc-help.js` |
| Pay calculator localStorage keys and data migrations | `paycalc-migrations.js` |
| Pay maths — tax, NI, gross, thresholds, student loan | `paycalc-calc.js` |
| Pre-fill suggestion engine, override fetch, BH detection | `paycalc-roster-suggestions.js` |
| Navigation panel — burger menu, slide-out drawer, Information links, footer bell | `nav-panel.js` (what it lists: `nav-destinations.js`) |
| Whether the ☰ menu offers the Marylebone Newsletter — only while its latest issue is under six weeks old | `newsletter-recency.js` (the Calendar asks once a load; the drawer and the staff-PIN line read the answer this device keeps) |
| Push notification subscribe/unsubscribe, VAPID key, notification state (shared) | `notif.js` |
| Firestore security rules — write isolation, field validation, admin bypass | `firestore.rules` |
| Shared CSS — colours, typography, badges, layout | `shared.css` |
| Service worker — caching strategy, version bump | `service-worker.js` |
| Firebase init and Firestore helpers | `firebase-client.js` |
| localStorage wrappers | `ls.js` |
| Cross-file localStorage key constants | `storage-keys.js` |
| Cloud Functions — the composition root (`functions/index.js`); documents (`functions/documents.js`), the Huddle ingest (`functions/huddle-ingest.js`), the Huddle's retention (`functions/huddle-retention.js`); accounts and the PIN (`functions/auth-endpoints.js` with `functions/account-lifecycle.js`, the reset-request doorbell `functions/reset-request.js`, and the PIN's `functions/calendar-viewer-auth.js`); push (`functions/push.js`, and what every payload looks like, `functions/push-notices.js`); the pay reminder's audience (`functions/pay-reminder.js`) and the admin's Error Log notification (`functions/error-log-notify.js`, its rules `functions/error-log-notice.js`) | `functions/index.js` |
| Railcard at-work reference — cards, GroupSave, season tickets, gateline checks | `railcard-guide.html` + `railcard-guide.css` |
| Print button for every guide, and the FIP per-country print buttons | `guide-print.js` |
| Guide back-arrow retarget (`?from=` → the page you came from, every guide) | `guide-back.js` |
| The "Jump to section" chip bar — jump, scrollspy, sticky offsets, a deep link landing below them (all five guides) | `guide-chips.js` |
| An old guide address (`guide.html`, `fip.html`) keeping its `#fragment` and `?query` on the Pages mirror | `legacy-redirect.js` |
| Shared guide chrome — header, back/PDF buttons, print banner (every guide) | `guide-shell.css` |
| Page-specific styles for staff-guide.html | `staff-guide.css` |
| Page-specific styles for paycalc-guide.html | `paycalc-guide.css` |
| FIP travel guide — country reference; jump links open the target section | `fip-guide.html` + `fip-guide.js` + `fip-guide.css` |
| HTML sanitisation for Huddle viewer (self-hosted) | `purify.es.mjs` |

---

## File responsibilities in plain English

### `roster-data.js`
The roster's single source of truth: `APP_VERSION` (changed only by `npm run bump`), `CONFIG` (cycles, years, paydays, role lists, feature switches — several mirrored to the server, so `npm run generate:roster-members` in the same commit), the re-exported people and cycle patterns, and every base-shift, date and shift-classification helper. Read a base shift through `getBaseShift`, never the pattern tables (CLAUDE.md). Rules: `.claude/rules/roster-data.md`; `CALENDAR_DATA.md` 8. Tested by `roster-data.test.mjs`.
- **Exports:** `APP_VERSION` · `CONFIG` · `teamMembers` · `isWorkedShift` · `gradeForRole` · `projectAnnualLeaveOverage` · `weeklyRoster` · `bilingualRoster` · `fixedRoster` · `cesRoster` · `dispatcherRoster` · `FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS` · `TIME_RE` · `DAY_NAMES` · `MONTH_ABB` · `MONTH_NAMES` · `TEAM_GRADES` · `SWIPE_THRESHOLD` · `SWIPE_VELOCITY` · `computeEaster` · `isSameDay` · `getBankHolidays` · `isBankHoliday` · `isChristmasDay` · `isEasterSunday` · `getPaydaysAndCutoffs` · `paydayForCutoff` · `isPayday` · `isCutoffDate` · `getSpecialDayBadges` · `validateRosterPatterns` · `SHIFT_TIME_REGEX` · `isChristmasRD` · `isEarlyShift` · `isNightShift` · `getShiftKind` · `getShiftClass` · `shiftBadgeParts` · `getShiftBadge` · `resolveMemberRoster` · `getWeekNumberForDate` · `getRosterForMember` · `getBaseShift` · `getPatternShift` · `escapeHtml` · `parseSmartFloat` · `parseSmartFloatOrNull` · `avatarInitials` · `avatarHue` · `isValidEmail` · `isChilternWorkEmail` · `workEmailLocalPart` · `workEmailFrom` · `formatISO` · `parseISODate` · `isSunday` · `getMembersForGrade`

### `calendar-app.js`
Coordinator for `index.html`, exporting nothing: it wires the Calendar's modules and owns what is left — month navigation, `renderCalendar` and the first-run prompt, the month-jump picker, About, the access hooks and the member's own-roster copy. `navigateToPaycalc` is the one route to the calculator and its one gate; every background repaint goes through `calendar-redraw.js`. Rules: `.claude/rules/calendar.md`; `CALENDAR_DATA.md`. Tested by `e2e/calendar.spec.js` and `calendar-redraw.test.mjs`.
- **Exports:** none

### `calendar-state.js`
Which month the Calendar shows and when it moves by itself: the display month and year, the one clamped month arithmetic (`addMonths`, shared with the swipe carousel), the month a load opens on (a `?date=` link, else a month browsed in the last `BROWSED_MONTH_KEPT_MS`, else today's), and `watchLocalDate`, which moves the month when the date turns. No DOM. Tested by `calendar-state.test.mjs`.
- **Exports:** `BROWSED_MONTH_KEPT_MS` · `getDisplayMonth` · `getDisplayYear` · `setDisplayMonth` · `setDisplayYear` · `changeDisplay` · `addMonths` · `watchLocalDate` · `persistViewedMonth`

### `calendar-swipe.js`
The Pointer Events month carousel on `#calendarDisplay`; the design notes (panels built on `pointerdown`, capture deferred for iOS, no left-edge guard) are in the module. Background redraws must wait on `isSwipeGestureActive`, asked only by `calendar-redraw.js`; buttons and keys wait on `isSwipeCooldown`. Rules: `.claude/rules/calendar.md`. Tested through the swipe tests in `e2e/calendar.spec.js`.
- **Exports:** `isSwipeCooldown` · `isSwipeGestureActive` · `initSwipeHandler`

### `calendar-al-lightbox.js`
The Calendar's Annual Leave panel and its day-detail panel — the only place a touch user reads what a day is. The leave panel counts the shown member's leave through `al-entitlement.js`; the day panel is filled from the cell's `data-detail-*` attributes with badges from `shiftBadgeParts`, and offers its two personal actions only where `personalActionsAllowed` agrees. CLAUDE.md → Change impact. Tested by the `day detail:` block of `e2e/calendar.spec.js`, `lightbox-transform-parity.test.mjs` and `day-detail-explains.test.mjs`.
- **Exports:** `initCalendarLightboxes`

### `calendar-initial-fetch.js`
The Calendar's first three-month override read and the sync chip: phase 1 paints from the local Firestore cache, phase 2 waits for `authReady` and runs the authoritative read (`AUTH_PLAN.md` → E1). Every outcome first asks whose it is (`standing`), and stale months are re-read on return and while the page stays in view. Rules: `.claude/rules/calendar.md` (the sync chip, the read ticket); `CALENDAR_DATA.md` 10, 18. Tested by `calendar-initial-fetch.test.mjs`.
- **Exports:** `initInitialFetch`

### `calendar-keyboard.js`
Keyboard navigation and the hover tooltip for the month grid: a roving tabindex on the arrows, PageUp/Down for months, and Enter/Space, which tries the pay jump and falls through to the day panel when it is refused. On the stored copy painted before the grant only the arrows work. The tooltip is for fine pointers only. Tested by `calendar-keyboard.test.mjs` and `e2e/calendar.spec.js`.
- **Exports:** `initCalendarTooltip` · `initCalendarKeyboard`

### `calendar-access.js`
The Calendar's access gate: it decides at boot, shows the right card, exchanges the staff PIN for a session-only viewer identity, and re-locks. It writes the one access state (`calendar-access-state.js`) in `grant` and in `handleAccessLost`, the one call for every route that loses access; its header holds the design and the rules an edit can break. Invariants: `CALENDAR_DATA.md` 3, 4, 11, 12 and `AUTH_AND_SESSIONS.md` 7–10, 17–20; running the PIN: OPERATIONS_REFERENCE.md → "Staff PIN access for the Calendar". Tested by `calendar-access.test.mjs` and `e2e/calendar-pin.spec.js`.
- **Exports:** `calendarAccessReady` · `calendarAuthReady` · `_resetPageForTest` · `getAccessType` · `isViewerMode` · `unlockWithPin` · `lockCalendar` · `finishSignIn` · `handleAccessLost` · `initCalendarAccess`

### `calendar-lock-cards.js`
The three cards that can stand where the Calendar goes — the member sign-in card (the front door), the staff-PIN card and the member's come-back card — with their wiring and the unlock backoff. They DRAW; `calendar-access.js` DECIDES and keeps the security properties, and hands its collaborators in through `initLockCards`. The header lists the four things an edit can silently break. Tested through `calendar-access.test.mjs` and `e2e/calendar-pin.spec.js`.
- **Exports:** `PIN_FIRST_HASH` · `initLockCards` · `resetUnlockFailures` · `takePinFirst` · `hideLockPanel` · `signInInFlight` · `afterSignInSettles` · `dismissSignInForm` · `showLockPanel` · `showSignInPanel` · `showMemberPanel`

### `calendar-lock-slot.js`
The one place on the Calendar page where a card stands in for the grid, at most one at a time: mounting and unmounting it (`mountLockCard` replaces, never stacks), the boot skeleton and its timer, and hiding the workspace the card stands in for (`setWorkspaceHidden`). It decides nothing; `calendar-access.js` does. Tested through `calendar-access.test.mjs`.
- **Exports:** `mountLockCard` · `unmountLockCard` · `lockCardId` · `armSkeleton` · `showBootSkeleton` · `setWorkspaceHidden`

### `calendar-snapshot.js`
The member's own roster, kept on the device so the Calendar shows it, labelled, while the sign-in check runs — and the Annual Leave panel's saved balance, in the same copy. Storage only and synchronous; never a source of truth, and deleted at every sign-out, PIN unlock and lost grant. The rules it keeps are in its header. `CALENDAR_DATA.md` 17. Tested by `calendar-snapshot.test.mjs`.
- **Exports:** `SNAPSHOT_VERSION` · `MAX_AGE_MS` · `MONTHS_BEFORE` · `MONTHS_AFTER` · `LEAVE_YEARS_AROUND` · `inWindow` · `clearSnapshot` · `readSnapshot` · `readLeaveBalance` · `saveLeaveBalance` · `sweepRetiredLeaveKeys` · `snapshotMonth` · `saveSnapshotMonths`

### `calendar-access-core.js`
The pure rules of Calendar access — no DOM, no Firebase, no storage: `decideAccess` (named beats viewer, anything missing is `none`), the PIN's shape and failure words (no client file ever compares the PIN), the notice audience rule and `personalActionsAllowed` (`CALENDAR_DATA.md` 14). Tested by `calendar-access-core.test.mjs`.
- **Exports:** `CALENDAR_VIEWER_UID` · `CALENDAR_VIEWER_CLAIM` · `PIN_LENGTH` · `PIN_FIRST_HASH` · `isViewerUser` · `noticeAudienceAllows` · `personalActionsAllowed` · `decideAccess` · `normalisePin` · `isCompletePin` · `classifyUnlockFailure` · `attemptBackoffMs`

### `calendar-overrides.js`
The Calendar's override cache (`rosterOverridesCache`) and every read that fills it. It refuses any read without Calendar access — the second gate, because a cache hit never consults the rules — asks each outcome its read ticket (`answerStillWanted`), and orders the cache writes per month; its two reads are the cache's only writers. Rules: `.claude/rules/calendar.md`; `CALENDAR_DATA.md` 3–6, 16, 18, 20. Tested by `calendar-overrides.test.mjs` and `calendar-sequences.test.mjs`.
- **Exports:** `SERVED_FROM_CACHE` · `READ_SUPERSEDED` · `rosterOverridesCache` · `hasOverrideAccess` · `setOverrideAccessLostHandler` · `_initialFetchInProgress` · `setInitialFetchInProgress` · `addFetchedMonths` · `clearFetchedMonth` · `releaseStaleMonths` · `oweRecheck` · `monthKey` · `issueReadTicket` · `answerStillWanted` · `_monthSlices` · `fetchOverridesForRange` · `fetchOverridesForRangeFromCache` · `ensureOverridesCached` · `getShiftTypesInMonth`

### `calendar-legend.js`
The month legend's two questions: which keys apply (`legendVisibility`) and whether the legend shows at all (`legendShown`, asked on every legend update, not on a render). It imports nothing; its header lists what an edit can break. Tested by `calendar-legend.test.mjs` and the swipe case in `e2e/calendar.spec.js`.
- **Exports:** `legendVisibility` · `onDispatcherRosterIn` · `legendShown` · `createLegend`

### `calendar-data-state.js`
What the Calendar KNOWS about each month's overrides, and so what it may show: four knowledge states, `decideDisplay`, and the two deliberate downgrades. Pure with no imports. Cache absence is not evidence that no override exists (`CALENDAR_DATA.md` 1–2). Tested by `calendar-data-state.test.mjs`.
- **Exports:** `noteKnowledge` · `noteCheckFailed` · `forget` · `knowledgeOf` · `worstKnowledge` · `decideDisplay` · `showsRoster` · `_reset`

### `overtime-app.js` / `overtime-boot.js` / `overtime-data.js` / `overtime-format.js` / `overtime-clock.js` / `overtime-tips.js`
The Overtime availability page — **paused**: `CONFIG.OVERTIME_ENABLED` is false, so the page says so to everyone and the endpoints are not exported, while the code and its tests stay live (`OVERTIME_AVAILABILITY.md` → Paused). Feature design: `OVERTIME_AVAILABILITY.md`; server: `functions/overtime.js`, `functions/overtime-core.js`.
- `overtime-app.js` — the coordinator: the access gate (a courtesy; the server is the boundary), the member's forms and the tab strip. The reviewer's side is `overtime-review-controller.js`.
- `overtime-boot.js` — calls `init()`, because CSP forbids an inline call.
- `overtime-data.js` — every endpoint call (a fresh token, a timeout above the server's) and the corrected clock.
- `overtime-clock.js` — what a member's own clock may decide about a deadline: the client never refuses what the server would accept.
- `overtime-format.js` — the pure words and time arithmetic both sides share; keep it Node-loadable. Re-exports the clock.
- `overtime-tips.js` — `CARD_TIPS` for the `?` panels; reread them when behaviour changes.
Tested by `overtime-format.test.mjs`, `overtime-clock.test.mjs`, `overtime-parity.test.mjs` and `e2e/overtime.spec.js`.
- **Exports of `overtime-app.js`:** `init`
- **Exports of `overtime-boot.js`:** none
- **Exports of `overtime-data.js`:** `correctedNow` · `myStateReadAt` · `getMyOvertimeState` · `getOvertimeManagerOverview` · `createOvertimeWindow` · `withdrawOvertimeParticipant` · `submitOvertimeAvailability` · `loadWeekDetail`
- **Exports of `overtime-format.js`:** `deadlineLabel` · `phaseCopy` · `phaseChip` · `phaseTone` · `deadlineLines` · `SUBMIT_GRACE_MS` · `DEADLINE_SYNC_WINDOW_MS` · `clockOffset` · `submitDisposition` · `shouldResyncClock` · `canRestoreNow` · `dayUnfinished` · `unfinishedDates` · `reconcileVerdict` · `writeOutcomeUnknown` · `conflictIsOurs` · `shiftSpanMinutes` · `sameAnswer` · `shortDate` · `longDate` · `weekLabel` · `weekSpan` · `weekDates` · `printedLabel` · `asAtLine` · `declaredAgo` · `receiptLine` · `rowStateCopy` · `countsCopy` · `modesFor` · `offersFullTwelve` · `submitFailureCopy` · `answerCopy` · `isWithdrawn` · `withdrawnLine` · `putBackWindow` · `isUnavailable` · `isAvailableAnswer` · `rosterBadge` · `answerAnchorStale` · `answerTone` · `deriveHistory` · `gradeScopeLabel` · `weekAvailabilitySummary` · `reminderLine`
- **Exports of `overtime-clock.js`:** `SUBMIT_GRACE_MS` · `DEADLINE_SYNC_WINDOW_MS` · `clockOffset` · `submitDisposition` · `shouldResyncClock` · `canRestoreNow`
- **Exports of `overtime-tips.js`:** `CARD_TIPS`

### `overtime-form.js` / `overtime-roster.js`
The member's side of the Overtime page (paused — see the entry above).
- `overtime-form.js` — one week's seven-day form and its submit lifecycle; its header names the three things easy to "tidy" that must not be. Tested by `overtime-form.test.mjs`.
- `overtime-roster.js` — the roster each day is answered against, `authoritative` or `error` and never `cached`; deliberately not `calendar-overrides.js` (its header says why). Tested by `overtime-roster.test.mjs`.
Both by `e2e/overtime.spec.js`. A day's answer is about a duty STARTING that day: `OVERTIME_AVAILABILITY.md`.
- **Exports of `overtime-form.js`:** `renderWeekForm`
- **Exports of `overtime-roster.js`:** `rosterBadge` · `loadRosterContext` · `loadRosterForMembers`

### `links-import.js`
Turns somebody else's roster proposal, pasted as text, into a design the Links workspace can hold — the pure half; the panel is `links-design-library.js`. A trust boundary: a design or a refusal, never a half-design (`.claude/rules/links-design.md` invariant 6). Tested by `links-import.test.mjs`.
- **Exports:** `MAX_IMPORT_NAME` · `parseCell` · `parseGrid` · `parseDesignImport` · `summariseImport`

### `overtime-manager.js`
The reviewer's workspace for one selected Overtime week (paused — see the Overtime entry): By day, Awaiting, the participant panels and the print sheet, drawn as a pure function of the data handed in. It performs no reads (`loadWeekDetail` in `overtime-data.js` does) and imports no Firebase. Its header argues the three sections that never merge and the two lenses. Tested by `overtime-manager.test.mjs` with a two-line fake DOM.
- **Exports:** `renderWeekDetail` · `refocus` · `focusLost` · `stampPrinted`

### `functions/overtime.js`
The Overtime endpoints and their Firestore orchestration — the boundary (auth, transactions, batches, HTTP); every rule is in `functions/overtime-core.js`. A factory, `buildOvertimeEndpoints`, called by `functions/index.js`, which exports only the purge while Overtime is paused (`OVERTIME_AVAILABILITY.md` → Paused). Identity is the token, never the body; retention is enforced in the read endpoints; every push is targeted. Tested by `overtime-endpoints.test.mjs`.
- **Exports:** `buildOvertimeEndpoints`

### `functions/doc-url-core.js`
Who may be handed a short-lived document URL, for which document, and for how long: `mayReceiveDocumentUrl` mirrors `firestore.rules` and may never be more permissive, the caller names a KIND and never a path, and the signed path is bound to that kind's collection. No I/O. Design: `AUTH_PLAN.md` §5. Tested by `doc-url-core.test.mjs`.
- **Exports:** `DOC_KINDS` · `kindFromBody` · `SIGNED_URL_TTL_MS` · `mayReceiveDocumentUrl` · `resolveKind` · `signedUrlExpiry` · `isSignablePathForKind`

### `functions/doc-link-rotation.js`
Gives every stored Huddle, Circular and Newsletter file a new download-link key, so every old copy of the link stops opening it (`ARCHITECTURE.md` EXC-007), behind `rotateDocumentLinks` in `functions/documents.js`. A preview unless asked; expand → migrate → contract per file, every write a compare-and-set. Its header argues each refusal. Tested by `doc-link-rotation.test.mjs`.
- **Exports:** `rotateDocumentLinks` · `downloadUrl` · `pathOfDownloadUrl` · `keysOf` · `TOKEN_KEY` · `UNLINKED_MIN_AGE_MS`

### `functions/member-identity.js`
Which member a verified ID token speaks for, or none — the server copy of `isMember()` in `firestore.rules`. `memberNameFromClaims` returns the name, never a boolean, so no caller can check the binding and then read the unchecked field. Also the account checks `setupRosterAuth` and `resetMemberPassword` make before taking an account back. Tested against every roster name by `member-identity.test.mjs` and the rules suite.
- **Exports:** `memberNameFromClaims` · `mustReclaim` · `claimedByAnotherMember` · `unlinkOtherProviders`

### `functions/request-helpers.js`
The request plumbing every endpoint shares, in one copy: the JSON body reader, the bearer token, the admin gate (`requireAdmin`) and the capped raw upload body. It requires nothing at load time, so the readers are tested in test:hygiene (`doc-url-core.test.mjs`).
- **Exports:** `jsonBodyOf` · `readJsonBody` · `bearerToken` · `requireAdmin` · `readRawBody`

### `functions/london-clock.js`
An ISO calendar date, and the instant it names in London — machinery, not Overtime policy; the hours the depot chose stay in `functions/overtime-core.js`, which re-exports these. It requires nothing, and `london-clock.test.mjs` asserts it, which keeps `overtime-core.test.mjs` in test:hygiene.
- **Exports:** `londonOffsetMinutes` · `londonTimestamp` · `londonIsoDate` · `isValidIsoDate` · `isoDayOfWeek` · `addDays`

### `functions/overtime-core.js`
Every rule Overtime has, with no I/O and no clock of its own: the London deadline clock, frozen milestones, who was asked, the submission decision and the notice words. Its header names the five things it protects; nothing here manufactures an answer. It requires only `./london-clock`, so `overtime-core.test.mjs` runs in test:hygiene. Design: `OVERTIME_AVAILABILITY.md`.
- **Exports:** `POLICY_VERSION` · `MILESTONE_OFFSETS` · `DEADLINE_HOUR_LONDON` · `SCHEDULER_HOUR_LONDON` · `lastSchedulerRun` · `ANSWERABLE_WEEKS` · `PLANNING_WEEKS` · `MAX_PARTICIPANTS_PER_WINDOW` · `AUDIENCES` · `AVAILABILITY_MODES` · `REQUEST_DAY_FIELDS` · `OPTIONAL_DAY_FIELDS` · `londonOffsetMinutes` · `londonTimestamp` · `londonNoonTimestamp` · `londonMidnightTimestamp` · `londonIsoDate` · `isValidIsoDate` · `isoDayOfWeek` · `addDays` · `isSaturday` · `weekDates` · `weekEndingFor` · `deriveMilestones` · `storedMilestones` · `toMillis` · `phaseFor` · `isOpenPhase` · `canChangeParticipation` · `canRestoreParticipant` · `isWithdrawn` · `validateWeekEnding` · `planningWeekEndings` · `weeksNeedingWindows` · `windowRowState` · `isEligibleForWeek` · `selectParticipants` · `isSafeDocId` · `normaliseDay` · `normaliseDays` · `daysEqual` · `revisionId` · `decideSubmission` · `publicHead` · `deriveHistory` · `REMINDER_LOOKAHEAD_MS` · `reminderDue` · `londonDeadlineLabel` · `askedNotice` · `reminderNotice` · `PURGE_ARMS_AT` · `purgeArmedAt`

### `calendar-notices.js`
The Calendar page's one-time notices, in one place — a `/new-notice` for `index.html` lands here; the markup stays in `index.html`, and which notices are live is the new-notice skill → "Current notices". Every notice declares an audience, waits for access, and opens through `openNoticeIfClear`; the header and each notice's comments carry the ordering rules. Tested by `calendar-notices.test.mjs`.
- **Exports:** `initCalendarNotices`

### `calendar-member.js`
Which member the Calendar shows, and the member picker: this page's own selection (read once, then moved only by a pick here), the first-run test, the stale-name flag behind the removed-member banner, and the roster table's shape checks. `.claude/rules/calendar.md`. Tested by `calendar-member.test.mjs`.
- **Exports:** `takeStaleMemberName` · `getDefaultMemberIndex` · `isFirstRun` · `getSelectedMemberIndex` · `_resetSelectionFallbackForTest` · `saveSelectedMember` · `populateTeamMemberDropdown` · `getCurrentMember` · `validateTeamMembers`

### `calendar-renderer.js`
Builds the month grid and each day cell for `index.html`, and holds the pure helpers the day panel and the tooltip share. `buildCalendarContainer` may return a container with no grid: unless the month's read has settled it draws a wait or failure panel (`calendar-data-state.js`). A cell carries raw `data-detail-*` values, never markup, and every cell resolves through `resolveDayShift`. Tested by `calendar-renderer.test.mjs` and `e2e/calendar.spec.js`.
- **Exports:** `changeProvenance` · `shiftWords` · `splitShiftLine` · `dayMarkers` · `weekContext` · `createCalendarHeader` · `dayCellParts` · `dayCellName` · `createDayCell` · `getSwipeDirection` · `setSnapshotSource` · `buildCalendarContainer`

### `calendar-huddle-viewer.js`
The Daily Huddle viewer on the Calendar — a full-bleed panel, not a lightbox, opened only through the `#huddle` hash, and only while the document gate is open (`calendar-doc-access.js`). Two render paths, never unified: a converted DOCX inline, sanitised by DOMPurify, or an "Open Huddle" button whose tap is the gesture `window.open` needs. Rationale: OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour". Tested by `calendar-huddle-viewer.test.mjs`.
- **Exports:** `wrapTables` · `initHuddleViewer`

### `huddle-table-grid.js`
Which cells of a Huddle table are physically in column 1 — what the viewer's sticky job column is selected by, because `td:first-child` is not that answer in a table with rowspans. Pure, no imports; its only caller is `wrapTables` in `calendar-huddle-viewer.js`, and the header holds the three rules an edit can break. Tested by `huddle-table-grid.test.mjs` and `e2e/pages.spec.js`.
- **Exports:** `firstColumnMask`

### `calendar-doc-viewer.js`
The Calendar's in-app viewer for the Weekly Retail Circular and the Marylebone Newsletter, opened by a `#circular` / `#newsletter` deep link. It offers an Open button rather than opening the file, because a notification tap carries no gesture; a locked tap issues no read and is finished when access arrives. The Huddle has its own viewer (`calendar-huddle-viewer.js`). Tested by `calendar-doc-viewer.test.mjs`.
- **Exports:** `initDocViewer`

### `calendar-team-view.js`
Team Week View — the grade-wide week grid toggled from the Calendar header: its state, render, week navigation and which week it opens on or follows. Its overrides come from the shared month fetch, never a fetcher of its own (`CALENDAR_DATA.md` 6). Bound by `.claude/rules/calendar.md` → Team Week View. Tested by `team-week-start.test.mjs` and `e2e/calendar.spec.js`.
- **Exports:** `weekStartForMonth` · `weekAfterDateChange` · `initTeamView`

### `admin-app.js`
Coordinator for `admin.html`: sign-in and session, the member bar and week navigation, the Change a Shift Save, the AL banner and recorded-dates wiring, and initialising every card's module. Not here: the week grid (`admin-week-editor.js`), what a Save collects from it (`admin-week-collect.js`), what a save writes (`admin-overrides.js`), the AL and Absence cards. Bound by `.claude/rules/admin.md`; capped by `coordinator-ratchet.test.mjs`.
- **Exports:** `init`

### `settings-status.js`
What each Settings card's state MEANS — its chip, whether it opens itself, and the summary line at the top — for `settings-app.js`, which reports each card as its data lands. Pure and read-free, like `operations-attention.js`; its rule is that silence is not success. Tested by `settings-status.test.mjs`; the wiring by `e2e/settings.spec.js`.
- **Exports:** `CARD_ORDER` · `shouldOpen` · `installNeed` · `summarise`

### `settings-app.js`
Coordinator for `settings.html`, for every signed-in member: the sign-in, the drawer, and the cards — Work email, Password, Notifications, Install and Pay Calculator Data — each reporting its state to `settings-status.js`. It holds an update's reload while a save is on its way. Wiring tested by `e2e/settings.spec.js`.
- **Exports:** `init`

### `overlay.js`
The shared overlay layer: the scroll lock, Android Back's LIFO stack, the topmost-only keyboard rule, the canonical lightbox (`createLightbox` — every lightbox, with three exceptions named in its JSDoc), the app-drawn confirm and prompt dialogs, and `openNoticeIfClear` for one-time notices. Re-exports `card-collapse.js`. Bound by CLAUDE.md → Canonical lightbox lifecycle and `.claude/rules/nav-drawer.md`. Tested by `overlay.test.mjs`, `overlay-history.test.mjs`, `overlay-parity.test.mjs` and `e2e/links.spec.js`.
- **Exports:** `initCardCollapse` · `openCardNamedByHash` · `lockBodyScroll` · `unlockBodyScroll` · `_pushOverlayState` · `_isTopOverlay` · `openNoticeIfClear` · `dismissOverlay` · `_clearOverlayHistory` · `registerPopInterceptor` · `suppressNextPop` · `whenHistorySettled` · `followLinkOutOf` · `trapFocus` · `closeOnBackdropTap` · `watchScrollFade` · `pinCloseButton` · `createLightbox` · `confirmDialog` · `confirmWithOption` · `promptDialog`

### `card-collapse.js`
A card's collapsible header, and the deep link that opens a collapsed card by name (`#<cardId>`). `overlay.js` re-exports both, so pages import them from there. No imports, no browser global read at load. Tested by `card-collapse.test.mjs` and `overlay.test.mjs`.
- **Exports:** `initCardCollapse` · `openCardNamedByHash`

### `about-lightbox.js`
The About panel (`#iconLightbox`) on every app page — version, update status, bug report, optional print — and `wireHeaderLogo`, a sub-page header logo's way back to the Calendar. A page stores the returned `.open`, never the object. Bound by `.claude/rules/nav-drawer.md`; the logo wiring by `page-contract-parity.test.mjs`, and the ids every page's panel carries by `about-markup-parity.test.mjs`.
- **Exports:** `initAboutLightbox` · `wireHeaderLogo`

### `tips-lightbox.js`
The shared per-card Tips panel (`#tipsLightbox`) behind every `?` button; each page keeps only its `CARD_TIPS` data (the Pay Calculator's is `HELP_CONTENT`, on its `.help-btn` buttons). The content shape is in the header, pinned by `tips-content.test.mjs`.
- **Exports:** `initTipsLightbox`

### `login-core.js`
The sign-in card's DOM-free rules — one sign-in attempt (`runNamedSignIn`), which links the card's explanation may carry, the explanation itself for a page that passes none (`signInAboutFor`), and what a failed reset request says. `login-overlay.js` re-exports the other three, so callers and `login-overlay.test.mjs` reach them there.
- **Exports:** `runNamedSignIn` · `isAboutLinkAllowed` · `resetRequestFailureLine` · `signInAboutFor`

### `login-overlay.js`
The one sign-in card for every protected page, a modal by default and mounted inline as the Calendar's front door; no page redirects elsewhere to authenticate. It owns the card, the wrong-password lockout, the reset-request button and the staff-PIN-ended notice; per-page access stays with each coordinator. Bound by `.claude/rules/sessions.md`. Tested by `login-overlay.test.mjs`, `e2e/auth.spec.js` and `e2e/calendar-pin.spec.js`.
- **Exports:** `runNamedSignIn` · `isAboutLinkAllowed` · `resetRequestFailureLine` · `sayStaffPinEndedIn` · `signInDeps` · `dismissLoginOverlay` · `initLoginOverlay`

### `sw-register.js`
Service-worker registration and the update lifecycle for every app page: the first-install guard, the hourly check, and the reload paths each page chooses — none of which reloads while a write no page started is on its way. Bound by `.claude/rules/pwa.md`. Tested by `sw-register.test.mjs`.
- **Exports:** `_resetForTest` · `hasPendingUpdate` · `lazyImport` · `reloadWhileHidden` · `reloadWhenNotBusy` · `reloadForUpdate` · `registerServiceWorker`

### `splash-watchdog.js`
A classic, non-module recovery script for `index.html`, so it runs when the module graph fails to load: if nothing usable is on screen after its timeout it reloads once, then offers Reload and a scoped "Reset the app". Precached by `service-worker.js`. Tested by `splash-watchdog.test.mjs`.
- **Exports:** none

### The reset-request queue
Not a module — the pieces a locked-out member's "ask the admin" request passes through, listed together because the design only makes sense whole: PASSWORD_DESIGN.md §12 (the queue) and §14 (the admin push).
- `firebase-client.js` — `requestPasswordReset` (no auth token; its caller cannot sign in), `getResetRequests`, `clearResetRequest`.
- `login-overlay.js` — the request button; `CONFIG.PASSWORD_RESET_REQUESTS` is its kill switch.
- `operations-app.js` — the Password reset requests card and its `#reset-requests` deep link.
- `functions/reset-request.js` — the public endpoint, which resets nothing and pushes to the admin's devices only; its bounds are argued in its header.

### `password-force.js`
The mandatory "set your own password" overlay (PASSWORD_DESIGN.md Phase 2), run after a confirmed sign-in for a member still on the surname default, gated by a one-shot marker and failing open before and after showing. It re-exports the two deadline helpers, now `own-password.js`'s, for the sign-in card. Every coordinator that mounts the sign-in runs it (`page-contract-parity.test.mjs`). Tested by `password-force.test.mjs`.
- **Exports:** `withTimeout` · `settleOrTimeout` · `shouldForcePasswordSet` · `initPasswordForce`

### `session.js`
The one local session and the Firebase sign-in every protected page and the Calendar's member card go through, the expired-identity teardown, the staff-PIN checks for pages that admit the PIN, and the bridge that feeds the auth store. The contract is `AUTH_AND_SESSIONS.md`; the working notes `.claude/rules/sessions.md`. Capped by `coordinator-ratchet.test.mjs`. Tested by `session.test.mjs`.
- **Exports:** `shedCalendarViewer` · `terminalAuthEvent` · `AUTH_KEY` · `SESSION_MS` · `SESSION_VER` · `sessionReady` · `resolveSession` · `authGeneration` · `getFirebaseIdentity` · `firebaseSessionIsNamed` · `getFirebaseAuthError` · `AUTH_RESTORE_TIMEOUT_MS` · `restoreFirstAuthUser` · `primeAuth` · `ensureFirebaseSession` · `isTransientAuthError` · `ensureNamedSession` · `refreshClaimsIfStale` · `getSession` · `saveSession` · `clearSession` · `reconcileExpiredIdentity` · `releasePushForEndingHold` · `ACCESS_DECISION_BUDGET_MS` · `holdsStaffPin` · `staffPinIsCurrent` · `signOutStaffPin`

### `viewer-shed.js`
Signs the shared Calendar viewer out before a member signs in, in the one order that keeps it out of long-lived storage (`AUTH_AND_SESSIONS.md` 8). `session.js` is its one caller and re-exports `shedCalendarViewer`. Tested through `session.js` by `session.test.mjs`.
- **Exports:** `shedCalendarViewer`

### `staff-pin-ended.js`
Whether arriving on THIS page ended the shared staff PIN, who is waiting to hear it, and the one sentence said when it has — on the sign-in card, or in the body of a page with none (`AUTH_AND_SESSIONS.md` 24). Tested through the real teardown by `session.test.mjs`, and on the pages by `e2e/calendar-pin.spec.js`.
- **Exports:** `STAFF_PIN_ENDED_NOTICE` · `BACK_TO_PIN` · `noteStaffPinEnded` · `forgetStaffPinEnded` · `takeStaffPinEndedMark` · `sayStaffPinEndedIn` · `onStaffPinEnded`

### `silent-sign-in.js`
The rules of the sign-in nobody typed — what a page load may try for a member whose local session has no Firebase identity behind it, the six-hourly reset recheck (`AUTH_AND_SESSIONS.md` 23), and when a session began, plus the one bound on how long Firebase may take (`AUTH_RESTORE_TIMEOUT_MS`). Pure; `session.js` reads and writes the memory. Tested by `session.test.mjs`.
- **Exports:** `AUTH_RESTORE_TIMEOUT_MS` · `noDefaultKey` · `RESET_RECHECK_MS` · `planSilentAttempt` · `afterRecheck` · `remembersRefusal` · `SIGN_IN_CLOCK_SKEW_MS` · `sessionStartMs`

### `auth-state-core.js`
The pure identity state machine (AUTH_ARCHITECTURE.md Track 1, Phase 1): who the user is, never what a page decides (that is `auth-policy.js`). Tested by `auth-state-core.test.mjs`.
- **Exports:** `AUTH_STATUSES` · `INITIAL_STATE` · `reduceAuthState`

### `auth-state.js`
The auth store: the one identity state, reduced by `auth-state-core.js`. Only `session.js` dispatches into it; everything else reads a snapshot. Tested by `auth-state.test.mjs`; the bridge by `session.test.mjs`.
- **Exports:** `getAuthSnapshot` · `subscribeAuth` · `dispatchAuth` · `_resetAuthStateForTest`

### `auth-policy.js`
Page authorisation — may this identity be on this page? — from one policy map, and the one answer to where the staff PIN may go. Client UX only: Firestore rules and the Functions' claim checks are the boundary. Holds `isOvertimeReviewer` and `canOpenOvertime` apart (`AUTH_AND_SESSIONS.md` 14), and answers the drawer's pill gates for every page (`navGatesFor`). Tested by `auth-policy.test.mjs`, `newlink-config.test.mjs`, `nav-gates.test.mjs` and `page-contract-parity.test.mjs`.
- **Exports:** `DECISIONS` · `PAGE_POLICIES` · `admitsStaffPin` · `requirePageAuth` · `rolesFor` · `isOvertimeReviewer` · `canOpenOvertime` · `canOpenNewlink` · `navGatesFor` · `overtimeEnabled` · `requirePage`

### `operations-app.js`
Coordinator for `operations.html` (admin only): the access gate, the session, the deep-linked cards, the update hold while work is in flight, and the wiring of every Operations card. Owns two cards itself, Account status and Password reset requests. Capped by `coordinator-ratchet.test.mjs`.
- **Exports:** `init`

### `operations-reports.js` / `operations-errors.js` / `operations-usage.js` / `operations-speed.js`
The three read-only reporting cards on `operations.html`, one module each, and what they share. Each awaits `sessionReady`, reads under `withClaimRetry` and touches no coordinator state.
- `operations-reports.js` — the shared failure-and-retry renderer, page labels and privacy footer; no re-export barrel (`import-graph.test.mjs`).
- `operations-errors.js` — the Error Log card, which feeds the Needs-attention strip.
- `operations-usage.js` — page and device usage, and the exact sign-in counts.
- `operations-speed.js` — App Speed; the maths is `perf-stats.js`.
- **Exports of `operations-reports.js`:** `PRIVACY_FOOTER` · `PAGE_META` · `OPEN_META` · `_cardLoadError` · `_usageMonthLabel` · `_relativeTime`
- **Exports of `operations-errors.js`:** `initErrorLog`
- **Exports of `operations-usage.js`:** `initUsageCard`
- **Exports of `operations-speed.js`:** `initPageSpeedCard`

### `links-app.js`
Coordinator for `links.html`, the link-design workspace (designers only): the page gate, the working copy and its dirty state, what a grid cell means, every path that can discard unsaved work, the Build press and the wiring of the domain modules. The contract is `.claude/rules/links-design.md`. Capped by `coordinator-ratchet.test.mjs`; the next Links rule goes in a domain module.
- **Exports:** `init`

### `links-analysis.js`
The read-only analysis on `links.html` — the Coverage heat map with its demand rows, the Design checks card and the sticky summary strip — rendered from the pure modules' results. `.claude/rules/links-design.md` invariant 10. Tested by `links-analysis.test.mjs`.
- **Exports:** `initLinksAnalysis`

### `links-compare-analysis.js`
What the difference between two Links designs MEANS, for compare mode; pure, and rendered by `links-compare.js`. It scores nothing, and the header holds its four rules. Tested by `links-compare-analysis.test.mjs` and `links-compare.test.mjs`.
- **Exports:** `compareDesigns`

### `links-compare.js`
Compare mode on `links.html`: two designs side by side, a strip of what differs, what the difference means, and a gold outline on differing cells. The single owner of the compare state. `.claude/rules/links-design.md` → Compare mode. Tested by `links-compare.test.mjs`.
- **Exports:** `COMPARE_ACTIVE_FALLBACK` · `initLinksCompare`

### `links-grid-input.js`
How the design grid on `links.html` is operated — one Tab stop and the arrow keys, a mouse stroke that paints every cell it crosses — while `links-app.js` keeps what a cell means. Tested by `links-grid-input.test.mjs`; the wiring by `e2e/links.spec.js`.
- **Exports:** `cellAfterKey` · `createGridInput` · `trackPaintBarHeight`

### `links-build-press.js`
What the Build press on `links.html` says and remembers: why a table was refused, the question before a build replaces a design, the line it reports and which build of these inputs it is. Pure; the press itself (the confirm, the held button, the scroll anchor) stays in `links-app.js`. Tested by `links-build-press.test.mjs`.
- **Exports:** `overCapacityLine` · `refusalLine` · `buildConfirm` · `withSurplusLines` · `createBuildCounter` · `builtStatusLine`

### `links-today.js`
What `links.html` reads from today's roster: the shift times its cell sheet offers (the main roster's, never the bilingual one's) and today's link measured against the fatigue factors for the Design checks card's comparison — once per roster, each factor at its own threshold. Pure; tested by `links-today.test.mjs`.
- **Exports:** `shiftOptionLists` · `currentLinkBaseline`

### `links-grid-cells.js`
What one cell of a Links grid says — its label, its accessible name, and the markup the editable grid, the compare grids and their cover rows are drawn from — so a name fixed once reaches every grid. Pure; tested by `links-grid-cells.test.mjs`.
- **Exports:** `DAY_LABELS` · `shiftLabel` · `cellName` · `emptyPattern` · `isUnfilledPattern` · `cellAriaName` · `editCellHtml` · `compareCellHtml` · `coverCellsHtml`

### `links-analyse.js`
One reading of a Links design, shared by the Coverage card, the Design checks, the summary strip and compare mode: `analyse` keys it on the design's CONTENT and computes each part once, on first ask; `readAgainstService` reads a design against the December 2026 service on its own window. Pure; tested by `links-analyse.test.mjs`.
- **Exports:** `readAgainstService` · `analyse`

### `links-print.js`
Preparing `links.html` for paper and putting it back: every disclosure opened, the masthead stamped on every prepare, and the print ended by `afterprint`, the page becoming visible or the reader's next touch, key or scroll, since iOS AirPrint sends no `afterprint`. Tested by `links-print.test.mjs`.
- **Exports:** `createPrintPrep`

### `links-tips.js`
`CARD_TIPS` for `links.html`'s `?` panels: pure data, rendered by `tips-lightbox.js`, shape pinned by `tips-content.test.mjs`. Its generator panel restates `links-default-targets.js`'s header, and no test can see that rule.
- **Exports:** `DEFAULT_TABLE_FIGURES` · `CARD_TIPS`

### `links-design.js`
The pure link-design maths — reading a shift, coverage, hours, the generator and its rest repair, and the design checks — with no DOM, no Firebase and no imports. `ROTATING_LINES` is the one declaration of the rotation length. `.claude/rules/links-design.md` defers its export list to this entry. Tested by `links-design.test.mjs` and `links-contract.test.mjs`.
- **Exports:** `DAYS` · `ROTATING_LINES` · `MIN_REST_MINUTES` · `SPARE_WORKED_DAYS` · `isCoverWeek` · `spareDrawsOnFour` · `DEFAULT_MAX_RUN` · `WEEKENDS_OFF_AIM_PCT` · `worstCaseWorkedRun` · `runLengthsWhere` · `isRest` · `workedRunLengths` · `classifyShift` · `normaliseCustomShift` · `canonicaliseShift` · `normalisePatterns` · `startMinutes` · `endMinutes` · `endMinutesAbs` · `dutyMinutes` · `CONTRACTED_HOURS_PER_WEEK` · `hmFromHours` · `hoursFigure` · `weeklyHours` · `lineTotals` · `calcCoverage` · `dayClass` · `calcHourlyCoverage` · `generatePatterns` · `WAVE_SPAN_MINUTES` · `targetExSundayMinutes` · `groupIntoWaves` · `restBetween` · `repairShortRest` · `generateLink` · `runDesignChecks`

### `links-target-sets-store.js`
The Firestore half of the saved staffing setups, with every Firebase handle injected so it loads in Node; used by `links-generator-targets.js`. Its two rules are in the header. Tested by `links-target-sets-store.test.mjs`.
- **Exports:** `createTargetSetStore`

### `links-target-hours.js`
Does a generator target table pay the contract — exactly, as the generator's gate does — and the words the card says it in. Pure; `links-generator-targets.js` renders it, and the header holds its three rules. Tested by `links-target-hours.test.mjs`.
- **Exports:** `assessTargetHours` · `targetHoursLines` · `targetProvenanceNote`

### `links-design-doc.js`
The shape of a link design in memory and in Firestore, and every conversion between the two, plus which designs were drawn for the previous rotation. Pure; its three rules are in the header. `.claude/rules/links-design.md` → Firestore model. Tested by `links-design-doc.test.mjs`.
- **Exports:** `LEGACY_DOC_ID` · `LINK_26_FROM` · `PREVIOUS_LINK_LENGTH` · `isPre26Design` · `deepCopyPatterns` · `designFromDoc` · `binEntryFromDoc` · `docPayload` · `workingCopy` · `binEntryFrom` · `restoredEntryFrom` · `recordSave` · `lastSavedLabel`

### `links-design-load.js`
What a read of the design collection means — which designs are live, which binned, which old-length ones move to the bin, whether a cached answer can be trusted, whether the legacy grid migrates, the list's one order and which design opens. Pure; ONE rule for the page load and the list refresh, which differ only in their bin predicate. Tested by `links-design-load.test.mjs`.
- **Exports:** `splitDesignDocs` · `binOldOnLoad` · `binOldOnRefresh` · `readCannotAnswer` · `migratesLegacy` · `byDesignName` · `designToOpen`

### `links-generator-targets.js`
The generator card's target table: the numbers Generate runs against, where they came from (the default, today's roster, this design's own memory or a saved staffing setup) and what may replace them, including the "Saved staffing setups" row and the two reset buttons. The four rules easy to undo are in its header. Bound by `.claude/rules/links-design.md` → The default table and the roster seed, and Saved staffing setups. Tested by `links-generator-targets.test.mjs` and the `links sets:` cases in `e2e/links.spec.js`.
- **Exports:** `customShiftRefusal` · `createTargetPanel`

### `select-sheet.js`
The app's own dropdown: every `<select>` a reader reads opens this sheet instead of the OS popup, and the `<select>` stays as the value holder, so consumers are untouched. `enhanceSelect` backs a real select; `openOptionSheet` is the same sheet for a caller that holds the value itself (the Links cell editor). Bound by CLAUDE.md → "No native `<select>` POPUP". Tested by `select-sheet.test.mjs` and `select-sheet-pick.test.mjs`; coverage by `select-sheet-parity.test.mjs`; the wiring by `e2e/calendar.spec.js`.
- **Exports:** `readGroups` · `triggerLabel` · `widestOptionLabel` · `shouldOfferSearch` · `searchLabelFor` · `optionMatches` · `filterGroups` · `enhanceSelect` · `openOptionSheet` · `initSelectSheets`

### `select-sheet-parity.test.mjs`
The guard that every `<select>` the app ships is enhanced, or native by a declared decision (`NATIVE_BY_DECISION`, a reason per row), and that page CSS reaches the trigger that replaced it. A missed select is invisible to every other lane, so this static scan is the only check. The numbered contracts, each with the fix it asks for, are the file's own tests.

### `links-proposals.js`
The shortlisted designs for the new link, built into the workspace as read-only proposals rather than saved documents (owner, 3 Oct 2026), and the name each one is shown by. The one rule: a proposal id never reaches Firestore. Pure; the header names the current shortlist and how to re-copy it from the pack. Bound by `.claude/rules/links-design.md` → Line numbering. Tested by `links-proposals.test.mjs`.
- **Exports:** `PROPOSAL_PREFIX` · `PROPOSALS` · `proposalDisplayName` · `PROPOSAL_NAMES` · `isProposalId` · `proposalById` · `proposalCopyName`

### `links-shortlist.js`
"Keep only the shortlist": the admin's one deliberate press that moves every design last saved before `OLDER_BEFORE` to Recently deleted (owner, 2 Nov 2026); the built-in shortlist is untouched. Pure; the press is in `links-design-library.js`, and the header gives the three reasons it is a press and never a move on page open. Tested by `links-shortlist.test.mjs`; the press by `e2e/links-shortlist.spec.js`.
- **Exports:** `OLDER_BEFORE` · `LISTED_IN_DIALOG` · `isOlderDesign` · `olderDesigns` · `canKeepOnlyShortlist` · `keepOnlyShortlistMessage` · `keptOnlyShortlistLine`

### `links-design-header.js`
The design masthead on `links.html`: which design is open, whose, whether it is saved, the Save buttons, the picker sheet and the ··· More sheet behind which every other verb lives. Every handle is injected, so it loads in Node; the four rules an edit can break are in its header. Bound by `.claude/rules/links-design.md` → The masthead and the picker. Tested by `links-design-header.test.mjs`.
- **Exports:** `toDate` · `lastSaveTime` · `groupDesigns` · `saveButtonLabel` · `statusCopy` · `whoCopy` · `proposeNewDesignName` · `createDesignHeader`

### `links-design-naming.js`
What a design or a staffing setup may be CALLED: one rule for new, import, duplicate, rename and save-a-setup-as-new, refusing a duplicate case- and space-insensitively rather than renaming it silently. Pure; the header says why what it guarantees is narrower than "no duplicates exist". Tested by `links-design-naming.test.mjs`.
- **Exports:** `MAX_DESIGN_NAME` · `nameKey` · `nameConflict` · `checkName` · `checkDesignName` · `proposeCopyName`

### `rangers-guide.css`
The Rangers & Rovers guide's stylesheet: the ranger and rover area passes staff accept or refuse at the gateline, drawn as a dialect of the Railcard guide. A static page with no app modules; its chip bar is `guide-chips.js` and its ⤓ PDF button `guide-print.js`. The page's rules are `.claude/rules/guide-pages.md` → "Rangers & Rovers guide"; each product's evidence is a `GUIDE_SOURCES.md` row, held to the page by `guide-sources.test.mjs`.

### `links-seed.js`
The generator's roster seed, behind "Copy staffing from today's roster": it reads the whole main cycle (and only that) and MEASURES it into shift-slot targets, where `links-default-targets.js` DESIGNS. Pure; the header has the rule that the seed samples exactly what the design represents. Bound by `.claude/rules/links-design.md` → The default table and the roster seed. Tested by `links-seed.test.mjs`.
- **Exports:** `rosterSeedLines` · `buildRosterTargets`

### `links-default-targets.js`
The table the generator starts from when a design has none: Short Run's duty table, which pays the contracted week exactly, so Generate works on an untouched card. It DESIGNS where `links-seed.js` MEASURES; it is not a link. The owner's figures are exported constants the tests read; the header has the arithmetic and the `docs/links-26/RULES.md` rules it meets. Tested by `links-default-targets.test.mjs`.
- **Exports:** `DEFAULT_COVER_WEEKS` · `OPENING_TURNS` · `CLOSING_TURNS` · `EVENING_TURNS_FROM_22` · `SATURDAY_CLOSING_TURNS` · `SATURDAY_TURNS` · `SUNDAY_TURNS` · `TARGET_DAYS_PER_WEEK` · `DEFAULT_SHIFT_TIMES` · `sameTargetTable` · `isSupersededMemory` · `buildDefaultTargets`

### `links-target-sets.js`
Named, shared snapshots of the generator's target table (`linkTargetSets`, staffing setups), and who may overwrite one: the creator or the admin. Pure. The client's ownership check only decides what the button offers; `firestore.rules` is the protection, and a corrupt document is refused whole (invariant 9 of `.claude/rules/links-design.md`). Tested by `links-target-sets.test.mjs`; the rules by `firestore.rules.test.mjs`; the wiring by the `links sets:` cases in `e2e/links.spec.js`.
- **Exports:** `MAX_SET_NAME` · `MAX_SET_SLOTS` · `SPARE_WEEKS_CAP` · `targetSetProblem` · `targetSetFromDoc` · `targetSetPayload` · `canOverwriteTargetSet` · `describeSetState` · `sortTargetSets` · `describeSetList`

### `links-limits.js`
The HARD limits a link design meets or cannot be run — the consecutive-days run limit and the contracted-days ceiling — kept apart from the advisory fatigue factors on purpose. It fails to `unknown`, never to `ok`, and `POLICY_SOURCE_CONFIRMED` is the one switch every visible claim derives from. Pure; the header holds whose limit this is and the three rules every edit keeps. Bound by `.claude/rules/links-design.md` invariant 2 and → Hard limits vs advisory factors. Tested by `links-limits.test.mjs`.
- **Exports:** `MAX_CONSECUTIVE_WORKED_DAYS` · `POLICY_SOURCE_CONFIRMED` · `LIMIT_CLAIM` · `CONTRACTED_DAYS_CEILING` · `contractedDaysPerYear` · `contractedDaysFromCounts` · `assessHardLimits`

### `links-fatigue.js`
The ORR good-practice fatigue factors (December 2021 guide) assessed against a link design. Pure. It reports factors PRESENT and never passes or fails a design, and every rule laps the rotation; the header and the comment beside each row carry the reasoning. Bound by `.claude/rules/links-design.md` invariants 2–3 and → Fatigue factors. Tested by `links-fatigue.test.mjs`.
- **Exports:** `DAY_NAME` · `isRest` · `isWorked` · `dutyMinutes` · `isEarlyStart` · `isVeryEarlyStart` · `coversNightWindow` · `toSequence` · `longestRunBetween48hBreaks` · `longestWorkedRun` · `longestRunOf` · `earlyBlocksWithShortRecovery` · `maxHoursInAny7Days` · `COVER_DUTY_MINUTES` · `COVER_DUTY_WORDS` · `worstHoursInAny7Days` · `startTimeJumps` · `rotationDirection` · `assessFatigue`

### `links-window.js`
The staffed operating window of a link design, so the heat map reads a design against the hours the station is open rather than against its own first and last duty. Pure; stored per design as `window`, and a design without one reads as `DEFAULT_WINDOW`. Bound by `.claude/rules/links-design.md` → The staffed operating window. Tested by `links-window.test.mjs`; the wiring by `e2e/links.spec.js`.
- **Exports:** `DEFAULT_WINDOW` · `WINDOW_ROWS` · `windowMinutes` · `rowMinutes` · `canonicaliseWindowTime` · `isValidWindowRow` · `windowEditRefusal` · `normaliseWindow` · `windowForDay` · `isHourStaffed` · `heatSpan` · `formatWindow` · `windowsDiffer` · `isDefaultWindow`

### `links-demand.js`
The service a link design has to cover: every December 2026 train movement at Marylebone, so the heat map can set cover against service. Pure, and it never scores a design; a gap with trains and nobody on is a finding, trains while the station is shut a neutral fact. The header has how the demand was measured and the traps in re-measuring. Bound by `.claude/rules/links-design.md` → Coverage heat map and the December service. Tested by `links-demand.test.mjs`; the wiring by `e2e/links.spec.js`.
- **Exports:** `DEC_2026_SOURCE` · `DAY_CLASS_KEYS` · `DEC_2026_MOVEMENTS` · `DEC_2026_DEMAND` · `demandAt` · `peakCars` · `demandBucket` · `peakHours` · `DAY_LABEL` · `DAY_CLASSES` · `movementsOutside` · `dutySpans` · `summariseDemand` · `describeHours` · `describeMovements`

### `links-adjacency.js`
What happens BETWEEN the lines: the order they sit in, and the line-order objectives the generator card switches on and off, plus the two constraints that are not switches. Reordering is free with respect to coverage. Pure; the header carries the reasoning and the measured weights. Bound by `.claude/rules/links-design.md` invariant 8 and → Line order. Tested by `links-adjacency.test.mjs`, which also pins `longestBlockOf` (the reported block) to `blockRuns`' first entry (the charged one).
- **Exports:** `OBJECTIVES` · `GENTLE_THRESHOLD_MINUTES` · `DEFAULT_BLOCK_TARGET` · `lineStartProfile` · `weekStep` · `breakLength` · `boundaryRest` · `blockRuns` · `longestBlockOf` · `blockExcess` · `spareSpread` · `longestRunFor` · `runExcess` · `scoreOrder` · `cost` · `reorderLines` · `applyOrder`

### `links-deletion.js`
The pure rules behind Recently deleted in the Links workspace: what counts as a soft-deleted design, its label and order, and what a delete or a rename that found the design already gone says. The bin is permanent (owner, 19 Sep 2026); the Firestore calls are `links-design-store.js`, the panel `links-design-library.js`. Bound by `.claude/rules/links-design.md` → Deletion. Tested by `links-deletion.test.mjs`; `doc-parity.test.mjs` refuses any doc that promises a removal window.
- **Exports:** `tsMillis` · `isDeleted` · `deletedLabel` · `sortByDeleted` · `deleteOutcomeLine` · `renameRefusedLine`

### `links-concurrency.js`
The pure co-editing rules for the Links workspace: is this save about to overwrite a colleague's work, and what baseline the next save compares against. No DOM, no Firebase; `links-design-store.js` applies them. Bound by `.claude/rules/links-design.md` invariant 5 and → Concurrency and load safety. Tested by `links-concurrency.test.mjs`, one case per historical bug; the read-back window end to end in `links-design-store.test.mjs`.
- **Exports:** `conflictOf` · `baselineAfterWrite` · `baselineAfterCommit` · `baselineFromEntry` · `nextRevision` · `canAdvanceBaseline` · `listRowSig` · `mergeListAnswer`

### `admin-tips.js`
The content of every `?` panel on `admin.html` (`CARD_TIPS`), in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins. Pure data; `admin-app.js` hands it to `initTipsLightbox`, and `al-copy-parity.test.mjs` reads its Annual Leave entry.
- **Exports:** `CARD_TIPS`

### `admin-boot.js` / `links-boot.js` / `operations-boot.js` / `paycalc-boot.js` / `settings-boot.js`
The page bootstraps, each one import and one call; their shared header gives the two reasons the call is not inline or in the coordinator. The Overtime, Trains and New link boot files are the same shape and sit in their own pages' entries.
- `admin-boot.js` — `admin.html` → `admin-app.js`.
- `links-boot.js` — `links.html` → `links-app.js`.
- `operations-boot.js` — `operations.html` → `operations-app.js`.
- `paycalc-boot.js` — `paycalc.html` → `paycalc-app.js`.
- `settings-boot.js` — `settings.html` → `settings-app.js`.
- **Exports of `admin-boot.js`:** none
- **Exports of `links-boot.js`:** none
- **Exports of `operations-boot.js`:** none
- **Exports of `paycalc-boot.js`:** none
- **Exports of `settings-boot.js`:** none

### `admin-range-booking.js`
The shared skeleton of the two date-range booking cards on `admin.html`, Annual Leave and Absence: the member, the preview guard chain, working-day counting, and the checked save with its receipt and failure lines. Each card's differences arrive as hooks; it owns none of the leave rules. Bound by `.claude/rules/admin.md` → "AL on a rest day is ASKED about" and "Every save of a day is CHECKED". Tested by `admin-range-booking.test.mjs`.
- **Exports:** `createRangeBookingSection`

### `admin-al.js`
The Annual Leave booking card on `admin.html`: a thin configuration of `createRangeBookingSection` (`admin-range-booking.js`) that brings the range cap, the Spare sentence, the swapped-day question, the projection and the over-entitlement confirm bar to it. Bound by `.claude/rules/admin.md` → "AL on a rest day is ASKED about". Tested through `admin-range-booking.test.mjs` and `admin-al-projection.test.mjs`.
- **Exports:** `triggerConfirmedALSave` · `initALSection`

### `al-contract.js`
A member's CONTRACT leave allowance for a year: the grade that decides it ("role at the time", owner, 16 Nov 2026), its figure, and a Dispatcher's days in lieu for bank holidays worked; `null` when none is on record. Never read directly: the whole allowance is `entitlementFor` (`al-entitlement.js`), and `christmas-leave.test.mjs` fails on any other caller. The rules are in its header and CLAUDE.md → AL entitlement. Tested by `al-entitlement.test.mjs` and `roster-data.test.mjs`.
- **Exports:** `allowanceRole` · `countsAsDispatcherBankHoliday` · `countDispatcherBankHolidaysWorked` · `dispatcherBaseAL` · `getALEntitlement`

### `al-entitlement.js`
Which annual-leave days spend a member's allowance (a CEA's or CES's Spare week at most `SPARE_WEEK_MAX_DAYS`), and where that leaves them — taken, booked, remaining — plus `entitlementFor`, the one door to the whole allowance. Pure; one module so the Admin banner, the booking checks and the Calendar's leave panel cannot disagree, and the header has the rules. Bound by CLAUDE.md → AL entitlement and `.claude/rules/admin.md`. Tested by `al-entitlement.test.mjs` and `christmas-leave.test.mjs`.
- **Exports:** `entitlementFor` · `lowersAllowance` · `consumesEntitlement` · `SPARE_WEEK_MAX_DAYS` · `spareUnderneath` · `rosteredSpareDay` · `spareWeekDays` · `costsWithoutSpareCap` · `countedAlDates` · `alPosition` · `leaveYearChoices` · `dispatcherBreakdown` · `entitlementNote` · `winningEntriesOfType` · `isWorkingDate`

### `al-leave-file.js`
The leave file: the one contract between Stage 1 (`scripts/make-leave-file.mjs`, a session reading the clerks' workbook) and Stage 2 (the Operations card) — what a valid file is, and the seal that proves it is the file that was made (docs/AL_UPLOADER_PLAN.md §3). Pure, with no app import, so it loads in Node and the browser; refusals are returned, never thrown. Tested by `al-leave-file.test.mjs`.
- **Exports:** `LEAVE_FILE_FORMAT` · `LEAVE_FILE_VERSION` · `LEAVE_FILE_MAX_AGE_DAYS` · `LEAVE_FILE_MAX_BYTES` · `GRADES` · `FOUND_IN` · `NOT_IMPORTED_REASONS` · `canonicalJson` · `leaveFileDigest` · `sealLeaveFile` · `isRealIsoDate` · `isSundayIso` · `isChristmasIso` · `leaveFileAgeDays` · `londonDayOf` · `usedRow` · `personSums` · `readLeaveFile` · `validateLeaveFile` · `describeRefusal`

### `al-leave-compare.js`
The clerks' leave sheet beside the app, person by person and day by day — Phase 1 of the uploader, which decides and writes nothing (AL_WORKBOOK.md §11). Every judgement is the app's own rule, never a restatement, and "agree" means the figures agree. Pure. Tested by `al-leave-compare.test.mjs`; driven on Operations by `e2e/operations.spec.js`.
- **Exports:** `DAY_STATES` · `NEEDS_A_LOOK` · `COUNT_KEYS` · `leaveRecordability` · `winnersByDate` · `comparePerson` · `compareLeaveFile`

### `al-leave-plan.js`
What one Save of the Annual leave sheet would write, what its upload log says, and what an Undo of it may take back — Phase 2b of the uploader (docs/AL_UPLOADER_PLAN.md §4.5–4.10). Pure: it starts from the comparison and writes only three kinds of day, never on a Sunday or 25/26 December. The writer is `al-leave-save.js`. Tested by `al-leave-plan.test.mjs`.
- **Exports:** `oldestSaveableYear` · `ANSWERS` · `LOG_MAX_DAYS` · `HELD_STATES` · `WRITE_KINDS` · `dayKey` · `parseDayKey` · `writableDate` · `questionsFor` · `planPerson` · `writesFor` · `saveTotals` · `recordsAfter` · `judgeUploads` · `saveRefusal` · `logLists` · `landedWrites` · `logFields` · `planUndo`

### `al-leave-save.js`
The Annual leave sheet's Save, its upload log and its Undo, against Firestore — Phase 2b of the uploader (docs/AL_UPLOADER_PLAN.md §4.9–4.10). WHAT is written is `al-leave-plan.js`'s; this sends it, every part checked through `commitChecked`, nothing held offline, and reads back what landed. The card is `operations-al-save.js`. Tested by `al-leave-save.test.mjs`.
- **Exports:** `CACHED_READ` · `readMemberRecords` · `readUploadLogs` · `STORE_UNLOADED` · `preloadSaveStore` · `saveLeavePlans` · `newUploadLogId` · `writeUploadLog` · `pruneUploadLogs` · `undoUpload`

### `al-leave-words.js`
Every sentence the Annual leave sheet card and its Save say (`operations-al-sheet.js`, `operations-al-save.js`). Pure: the comparison decides each day and this only says it — what the sheet says, then what the Calendar draws, as facts and never as one side being wrong. Tested by `al-leave-words.test.mjs`.
- **Exports:** `dayLabel` · `sheetWords` · `patternWords` · `drawnWords` · `appWords` · `figuresLine` · `personNotes` · `chipsFor` · `totalsEntries` · `reasonWords` · `CARD_WORDS` · `beyondHeadWords` · `checkedWords` · `overallWords` · `oldWords` · `unplacedWords` · `appOnlyWords` · `moreDaysWords` · `notComparedWords` · `ageWords` · `SAVE_WORDS` · `questionWords` · `confirmWords` · `afterWords` · `stillDiffersWords` · `unansweredWords` · `saveButtonWords` · `savingWords` · `refusalWords` · `receiptWords` · `leftFreeWords` · `lastSaveWords` · `undoConfirmWords` · `undoneWords`

### `christmas-leave.js`
Christmas Day and Boxing Day from 2026: who is on leave, what it costs, and the day in lieu for a worked Boxing Day (the owner's rules, 5 Nov 2026). Pure, derived and never stored; `resolveDayShift` is what every surface that draws a day calls. Bound by CLAUDE.md → `isChristmasRD()` and CALENDAR_DATA.md 19. Tested by `christmas-leave.test.mjs` and the `christmas` e2e cases in `calendar.spec.js` and `admin.spec.js`.
- **Exports:** `CHRISTMAS_LEAVE_FROM_YEAR` · `isChristmasLeaveDay` · `isChristmasClosureDate` · `isUncountedChristmasLeave` · `allowanceForBoxingDay` · `boxingDayForAllowance` · `allowanceYearsOf` · `boxingDayLieuDays` · `resolveDayShift` · `christmasLeaveDates` · `christmasLeaveByYear` · `christmasLeaveLine`

### `leave-year.js`
Which year's allowance a day of annual leave comes out of: its own year by rule, the year before for a January day whose record carries `leaveYear`. Pure, with no imports; the owner's three decisions (3 Nov 2026) and why counting ignores the offer switch are in its header. Tested by `leave-year.test.mjs`.
- **Exports:** `LEAVE_YEAR_CHOICE` · `LEAVE_YEAR_FROM` · `leaveYearChoiceEnabled` · `isValidLeaveYear` · `carriedFrom` · `leaveYearOf` · `nextLeaveYear` · `canChooseLeaveYear` · `offeredJanuaries` · `carryLine`

### `admin-leave-year.js` / `admin-leave-year-save.js`
The Admin Annual Leave card's "Which year's allowance" panel and the save behind it. The panel draws `leaveYearChoices` (`al-entitlement.js`) and decides neither which days are listed nor the cap; the rules are `leave-year.js`.
- `admin-leave-year.js` — the panel: a tap is the save, with no Save button. Tested by `admin-leave-year.test.mjs`.
- `admin-leave-year-save.js` — the move: one checked transaction, so a stale page never writes a changed day back into leave. Tested by `admin-overrides.test.mjs`.
- **Exports of `admin-leave-year.js`:** `leftWords` · `leaveYearPanelHtml` · `initLeaveYearPanel`
- **Exports of `admin-leave-year-save.js`:** `setLeaveYear`

### `admin-al-year.js`
Which calendar year the Annual Leave figures on `admin.html` describe: the precedence between the places the page implies a year — a picked start date, the range picker's view once it has crossed a year, the Change a Shift week, then today. Pure and import-free so the order can be tested; the header says which two rungs must not be "tidied". Read by `updateALBanner` in `admin-app.js`; deliberately not wired on the Absence card (`admin-sick.js` header). Tested by `admin-al-year.test.mjs`.
- **Exports:** `alFigureYear`

### `trains-app.js` / `trains-boot.js` / `trains-cards.js` / `trains-change.js` / `trains-stations.js` / `trains-weekdays.js` / `trains-verdict.js` / `trains-headlines.js` / `trains-render.js` / `trains-data.js` / `trains-tips.js` / `trains-grid-mirror.js` / `trains-status.js`
The Trains page (`trains.html`): what changes at Marylebone when the December 2026 timetable starts, organised by station. Open to every signed-in member and to the station PIN (`auth-policy.js` → `staffPin`; AUTH_AND_SESSIONS.md 24); it reads no network. Tested by `trains-change.test.mjs`, `trains-stations.test.mjs`, `tips-content.test.mjs` and `e2e/trains.spec.js`.
- `trains-app.js` — the coordinator: the access gate, the page state and its wiring. `trains-boot.js` is its CSP shim.
- `trains-cards.js` — paints each card from the page state.
- `trains-change.js` — pure judgements about two timetables: alignment, `timetablePhase`, the railway day.
- `trains-stations.js` — pure: the timetable seen from one station.
- `trains-weekdays.js` — pure: which weekdays a figure is true of.
- `trains-verdict.js` — pure: a station's change in words.
- `trains-headlines.js` — pure: the "what's changing" list.
- `trains-render.js` — the page's HTML as strings.
- `trains-grid-mirror.js` — the grid's heads kept in view; `trains-status.js` — the line a screen reader hears.
- `trains-tips.js` — the `?` panels and their caveats.
- `trains-data.js` — GENERATED by `docs/timetable-dec26/tooling/build.py`; never hand-edit.
- **Exports of `trains-app.js`:** `init`
- **Exports of `trains-boot.js`:** none
- **Exports of `trains-cards.js`:** `DEC_STOPS_KNOWN` · `phase` · `LAST_STATION_KEY` · `renderOverview` · `renderChanges` · `renderPattern` · `renderStationPicks` · `renderLast` · `renderStationCard` · `amPmPending` · `renderLookup` · `setText` · `el`
- **Exports of `trains-change.js`:** `MAX_SHIFT_MIN` · `MAX_REROUTE_MIN` · `LINES` · `lineDepth` · `PATTERN_HOURS` · `serviceMinutes` · `routeKey` · `alignTimes` · `foldWeekdayVariants` · `compareRoutes` · `relinkAcrossRoutes` · `NEAR_WINDOW_MIN` · `trainsNear` · `parseTypedTime` · `railwayToday` · `daysUntil` · `minsWords` · `changeLabel` · `timetablePhase` · `dateWords` · `monthWords` · `holidaysWithin` · `daysLabel` · `routeName` · `JOURNEY_PLANNER_URL`
- **Exports of `trains-stations.js`:** `boardingTime` · `parseStops` · `stopsKnown` · `callsOf` · `lineOf` · `callingAt` · `endingAt` · `knowableWithoutStops` · `decemberKnown` · `summarise` · `stationView` · `stationTrains` · `stopChanges` · `busiestStations` · `matchStations` · `stationBands` · `stoppingGrid` · `orderStations` · `pairColumns` · `lastTrains`
- **Exports of `trains-weekdays.js`:** `WEEKDAYS` · `REAL_DAY` · `runsOn` · `daysCode` · `aRealDay` · `onWeekday` · `weekdayGroups` · `weekdayWords`
- **Exports of `trains-verdict.js`:** `EDGE_SHIFT_MIN` · `JOURNEY_SHIFT_MIN` · `verdictFor` · `balanceFacts` · `hourChanged` · `rateWords` · `sameRegularity` · `hourWords` · `hourNote` · `minutesWords` · `andList`
- **Exports of `trains-headlines.js`:** `headlineChanges`
- **Exports of `trains-render.js`:** `DAY_NAMES` · `DAYTIME` · `changesTitle` · `leadWords` · `renderFurtherChanges` · `SIGN_IN_ABOUT` · `renderHeadlines` · `endWords` · `renderStation` · `renderGrid` · `renderTotals` · `renderPicks` · `renderLookup` · `renderLastTrains`
- **Exports of `trains-data.js`:** `CHANGE_DATE` · `FURTHER_CHANGES_UNTIL` · `DEC_VALID_UNTIL` · `LEAF_FALL` · `STATIONS` · `STATION_ORDER` · `TIMETABLES`
- **Exports of `trains-tips.js`:** `CARD_TIPS` · `tipsOn`
- **Exports of `trains-grid-mirror.js`:** `syncGridMirror`
- **Exports of `trains-status.js`:** `announce` · `statusLine` · `matchesLine`

### `overflow-hint.js`
A "swipe the table" line that is true: shown only while its table really scrolls sideways, measured as the table is drawn and again whenever the box or the table changes size. Shared by Team view's week (`calendar-team-view.js`) and the Trains stopping grid (`trains-grid-mirror.js`); the line's words and place stay with each page. Tested by `overflow-hint.test.mjs`.
- **Exports:** `watchOverflowHint`

### `newlink-app.js` / `newlink-boot.js` / `newlink-config.js` / `newlink-data.js` / `newlink-render.js`
The New link page (`newlink.html`): the three shortlisted proposals for the new CEA link, shown evenly to the colleagues who will work it — A to Z, one colour, no recommendation. Nothing on it may suggest the admin decides, recommends or collects views (`newlink-config.js` header → WHO IS IN CHARGE). Signed in only, never the station PIN, through the `auth-policy.js` `newlink` policy and `canOpenNewlink`. Tested by `newlink-config.test.mjs`, `newlink-data.test.mjs`, `newlink-render.test.mjs`, `newlink-boundary.test.mjs` (no proposal reaches a roster surface) and `e2e/newlink.spec.js`.
- `newlink-app.js` — the coordinator: the gate, the session, the PDF viewer's wiring and the two choices. `newlink-boot.js` is its CSP shim.
- `newlink-config.js` — the page's decisions, one a line: `CHOSEN`, `PHASE`, the audience, the dates and the contact.
- `newlink-data.js` — GENERATED by `docs/links-26/tooling/newlink-data.mjs`; never hand-edit.
- `newlink-render.js` — every word of HTML, as pure functions; its header states the page's three rules.
- **Exports of `newlink-app.js`:** `init`
- **Exports of `newlink-boot.js`:** none
- **Exports of `newlink-config.js`:** `STARTS` · `TIMETABLE_STARTS` · `CONTACT` · `CONTACT_ROLE` · `CHOSEN` · `PHASE` · `CLOSES` · `AUDIENCE` · `audienceNames` · `PACK_BASE` · `HAVE_YOUR_SAY`
- **Exports of `newlink-data.js`:** `COLUMNS` · `CHANGES` · `GAINS` · `COSTS` · `DIFFERS` · `DIFFER_RULE` · `PERSONAS` · `NOTES` · `PACK`
- **Exports of `newlink-render.js`:** `designName` · `aToZ` · `closesWords` · `startsWords` · `statusPhase` · `statusHint` · `renderStatus` · `renderList` · `renderCommon` · `renderDiffers` · `ifYou` · `renderFigures` · `figuresKey` · `renderPersonas` · `renderPersonaChips` · `dutyKind` · `renderWeeks` · `renderAllWeeks` · `renderWeeksKey` · `renderWeeksTabs` · `fileRow` · `renderPack` · `glanceFile` · `personaStatus` · `weeksStatus` · `weeksTitle`

### `pdf-viewer.js` / `pdf-viewer-core.js`
The in-app PDF viewer: a full-screen panel with a ✕ that draws a PDF's pages with the vendored PDF.js, so a document opens inside the app and closes back to it — built for the New link pack, whose PDFs left an installed iPhone app with no way back (`pdf-viewer-core.js` header). Tested by `pdf-viewer-core.test.mjs` and `e2e/newlink.spec.js`.
- `pdf-viewer.js` — the panel on `createLightbox`, loading PDF.js, fetching and drawing the pages; its header names the three things easy to get wrong.
- `pdf-viewer-core.js` — the pure rules: page sizes, zoom steps, when a file may open outside the app (`canOpenOutside`), and what a failure says and its button does.
- **Exports of `pdf-viewer.js`:** `initPdfViewer`
- **Exports of `pdf-viewer-core.js`:** `ZOOM_STEPS` · `MAX_DEVICE_PIXEL_RATIO` · `MAX_CANVAS_PIXELS` · `MAX_FIT_WIDTH` · `zoomAfter` · `zoomLabel` · `pageLayout` · `canOpenOutside` · `isPlainClick` · `classifyFailure` · `FAILURE_TEXT` · `failureAction` · `PAGE_FAILURE_TEXT` · `pageLabel` · `pagesLabel`

### `overtime-phase.js`
Where the Overtime week stands in the member's terms, and the two deadlines that decide it: the phase, its sentence, chip and tone, and the form head's deadline lines. Pure. Everything but `phaseAt` is re-exported from `overtime-format.js`; `phaseAt` is the client twin of the server's `phaseFor` (`functions/overtime-core.js`). Overtime is paused (OVERTIME_AVAILABILITY.md). Tested by `overtime-format.test.mjs` and `overtime-parity.test.mjs`.
- **Exports:** `deadlineLabel` · `phaseAt` · `phaseCopy` · `phaseChip` · `phaseTone` · `deadlineLines`

### `overtime-answer.js`
The ONE place a day's answer is edited on the Overtime form: every transition between the overtime mode, the willingness tick (`fullTwelve`) and the Sunday-release request (`releaseRequested`), pure, so each can be asked what else it changed. The five rules are numbered in the header. Tested by `overtime-answer.test.mjs`; the form's wiring by `e2e/overtime.spec.js`.
- **Exports:** `withMode` · `withFullTwelve` · `withRelease`

### `overtime-sunday-release.js`
Asking to be taken off a Sunday you are ROSTERED to work — a request about contracted work, apart from everything else on the Overtime page, which is about overtime. It grants nothing, and no surface may word it as agreed (OVERTIME_AVAILABILITY.md invariant 14). Tested by `overtime-sunday-release.test.mjs`.
- **Exports:** `offersSundayRelease` · `SUNDAY_RELEASE_ASKED` · `SUNDAY_RELEASE_LABEL` · `releaseRequestLine`

### `al-swapped-days.js`
Which days in an annual-leave booking need the swapped-day question, and what to write when the answer is yes — the one rule both booking surfaces and the roster import's Save read. Also the range writer's filter for both cards (`rangeWriteDates`), including the rest days an absence range leaves as they are because an absence would hide what they hold (`absenceHiddenDates`). Bound by `.claude/rules/admin.md` → "AL on a rest day is ASKED about, never defaulted"; the header says why "rest day" is not the whole test. Tested by `al-swapped-days.test.mjs`.
- **Exports:** `swapDecisionDates` · `replacedTypeForSwap` · `absenceHiddenDates` · `rangeWriteDates`

### `admin-al-projection.js`
What an Annual Leave booking WILL do, decided once so the preview, the over-entitlement warning and the write cannot disagree — for the AL range card, the week grid, the Absence card's allowance check and the leave sheet check. Pure. Also home to the range cards' Sunday rule (`rangeSundayCorrections`), stated here so a preview can name the days the writer will set. Bound by `.claude/rules/admin.md` → "AL on a rest day is ASKED about"; the allowance is read through `entitlementFor` (CLAUDE.md → AL entitlement). Tested by `admin-al-projection.test.mjs` and `admin-overrides.test.mjs`.
- **Exports:** `willConsume` · `projectAlBooking` · `rangeSundayCorrections` · `projectAbsenceRange` · `lieuGoesWords` · `overridesAfterSave` · `projectAlOverage`

### `admin-time-inputs.js`
The Admin week grid's time boxes: two delegated `document` listeners that format each keystroke through `clock-input.js`, move focus once a time is complete, and flag an unfinished or impossible time. The typing rules are `clock-input.js`'s (CLAUDE.md → 3-digit time input); the `_formatting` re-entry guard is load-bearing on iOS Safari (header). Exercised by `e2e/admin.spec.js`.
- **Exports:** `initTimeInputs`

### `admin-day-pills.js`
Which changes one week-grid day takes, refused at its pills with the reason in each control's accessible name: a Sunday (layer 1 of CLAUDE.md → "Sundays are non-contracted"), Boxing Day, Christmas Day, and a day before the member's start date. On a Sunday the Other pill offers Spare alone; neither Christmas day can be an Other day or a Spare turn, so both days' Other pill is off (owner, Nov 2026; header). Tested by `admin-day-pills.test.mjs`.
- **Exports:** `restrictDayPills`

### `admin-week-row-state.js`
A week-grid row's appearance in each of its states: on and off, drawn from its saved record (and remembered, for the save to compare with), the four things that follow its type, a pill held on only to remove a record saved before the day refused its type, and a row's and a week's staged state as data for a kept draft. Dependency-free by design: the header says when the seam has moved. Tested through `admin-week-editor.test.mjs`, `admin-own-write.test.mjs` and `admin-overrides.test.mjs`.
- **Exports:** `drawnRecords` · `drawnDays` · `rosteredWords` · `_syncOtherRdwWarn` · `_syncOtherSpareMode` · `_activateRow` · `_syncAlSwap` · `_syncOverwriteBadge` · `prefillRow` · `_deactivateRow` · `isStagedRow` · `readRowDraft` · `applyRowDraft` · `readWeekDraft` · `sendingEntries` · `keptWeekDraft` · `unsavedWeekDraft` · `applyWeekDraft`

### `admin-own-write.js`
What a write the Admin page makes ITSELF — a Saved Changes or Recorded dates delete, a leave or absence range, a leave-year move — does to Change a Shift's week: only the touched days' rows follow it, and a change staged on such a day is cleared and named, never saved over it. Bound by `.claude/rules/admin.md` → "Every save of a day is CHECKED". Tested by `admin-own-write.test.mjs` and, through each writer, `admin-saved-changes.test.mjs`, `admin-overrides.test.mjs` and `e2e/admin.spec.js`.
- **Exports:** `initOwnWrite` · `ownWriteRowAction` · `syncWeekAfterOwnWrite` · `clearedDaysLine` · `withClearedDays`

### `admin-bulk-apply.js`
What the week card's "Apply to ticked days" is waiting for, as the line under it says, and the line Apply leaves naming each day it left alone. Pure; it consults `SUNDAY_FORBIDDEN_TYPES` through `isForbiddenOnSunday`, never restating it, and is NOT a layer of the Sunday rule (header). Tested by `admin-bulk-apply.test.mjs`.
- **Exports:** `bulkApplyWaitingFor` · `bulkSkippedLine`

### `admin-week-collect.js`
What one press of the week grid's Save asks to write, read from the grid's rows: the batch, the saved records the grid has unset, the swapped-day answers and why a row cannot be saved, each refused row marked. It reads no cache and writes nothing; `admin-al-week-save.js` then decides what the batch means for annual leave. The Sunday answers (CLAUDE.md, layer 6) are in the header. Tested by `override-utils.test.mjs`.
- **Exports:** `collectWeekRows`

### `admin-al-week-save.js`
What ONE week-grid save does about the annual leave in it — the batch to write, the days left alone, an unanswered rest day withheld, and the over-allowance message — and the same question for a delete from Saved Changes (`planAlDelete`). Pure; `admin-al-projection.js` says what a date means, this what a batch does with them. The two load-bearing orderings are in the header. Tested by `admin-al-week-save.test.mjs`.
- **Exports:** `planAlWeekSave` · `planAlDelete`

### `admin-al-spare-note.js`
The one sentence the Annual Leave booking preview says about Spare days, and the days that are still Spare and cost a day. A day is a day (owner decision): a Spare day costs one, and a CEA's or CES's Spare week at most four, which the note then says (header). Tested by `admin-al-spare-note.test.mjs` and, wired, by `e2e/admin.spec.js`.
- **Exports:** `spareShiftNote` · `countSpareDays` · `spareDaysOf` · `spareWeekDaysOf`

### `admin-period-dates.js`
What a run of booked dates is and what it reads as: the pure helpers the Recorded-dates lists are built from, the names a refused save gives its days (`namedDays`), and `formatDisplay`. The rule worth knowing — a gap is not the same as a day off (`isRestGap`) — is in the header. Tested by `admin-period-dates.test.mjs`.
- **Exports:** `addDays` · `isRestGap` · `fmtPeriodDate` · `fmtPeriodRange` · `formatDisplay` · `namedDays`

### `admin-booked-periods.js`
The Recorded Annual Leave dates and Recorded Absence dates sub-cards on `admin.html` — one renderer for both lists — and which YEAR of the list is on screen; also what a row's ✕ deletes (`periodDelete`) and the two-tap ✕ and feedback fade it shares with Saved Changes, the range cards and Operations' work-email Remove. It states no total: the AL banner owns the figures. The owner's year-end rule is in the header. Tested by `admin-booked-periods.test.mjs`.
- **Exports:** `periodDelete` · `TWO_TAP_MIN_MS` · `twoTap` · `disarmConfirm` · `holdFeedback` · `fadeFeedback` · `splitAtYearEnd` · `bookedYears` · `pickBookedYear` · `createBookedPeriods`

### `admin-sick.js`
The Record Absence card on `admin.html`: a thin config over `createRangeBookingSection` (`admin-range-booking.js`) with the one-year range cap and the 🪑 preview. Absence is not capped and never asks the swapped-day question, but over a day whose work earned a day in lieu it lowers the leave allowance, so the card names those days and raises the shared over-allowance bar (`projectAbsenceRange`). A rest day holding Rest Day Working or free leave is left as it is, and named in the preview and the receipt, because an absence there would never show. Nothing on it is scoped to a year (header). Exercised by `e2e/admin.spec.js`.
- **Exports:** `initSickSection`

### `admin-overrides.js`
The Change a Shift coordinator: the two save paths — the week grid's `executeSave` and the range cards' `recordRangeOverrides` — the shift-rule glue and `buildMemberDateMap`. The grid, list, cache and type table live in their own modules and are re-exported here for one import site. Every save is checked through `commitChecked` (`.claude/rules/admin.md` → "Every save of a day is CHECKED"), the range writer holds the Sunday RD-correction rule ("Sunday RD corrections"), and each write invariant is argued beside its line. Tested by `admin-overrides.test.mjs`.
- **Exports:** `TYPES` · `PILL_TYPES` · `renderTable` · `resetTableMemberFilter` · `renderWeekGrid` · `buildWeekGridInto` · `updateWeekNavLabel` · `updateSaveBtn` · `resetBulkPills` · `_hasStagedEdits` · `setSaveInFlight` · `isSaveInFlight` · `sendingDays` · `NOT_ON_ROSTER_LINE` · `initOverrideStore` · `getAllOverrides` · `setAllOverrides` · `removeFromCache` · `whenOverridesReady` · `whenLoadSettled` · `isOverrideCacheLoaded` · `hasOverrideAuthorityFor` · `loadOverrides` · `ensureMemberLoaded` · `buildMemberDateMap` · `isWorkingDate` · `initOverrides` · `refusedLine` · `executeSave` · `getEffectiveShift` · `validateShiftRules` · `recordRangeOverrides` · `formatDisplay`

### `admin-save-receipt.js`
What a save did, said day by day: one line per date, in date order, because a manager checks a receipt against a run of days. A removed day is named, never omitted, and a day deliberately left alone is named and not counted. Pure. Tested by `admin-save-receipt.test.mjs`.
- **Exports:** `buildSaveReceipt`

### `slow-save.js`
Say so when a save is waiting on the server: one reference-counted live line after `SLOW_SAVE_MS`, worded for a held write, a batched one or a transaction, and a count of writes still in flight for the pages' reload and sign-out guards. It never says "saved" and never gives the button back (header). Wraps the Admin, Settings and Operations writes; its notice is styled in `shared.css`. Tested by `slow-save.test.mjs`.
- **Exports:** `SLOW_SAVE_MS` · `SLOW_SAVE_TEXT` · `SLOW_SAVE_TEXT_BATCHED` · `SLOW_SAVE_TEXT_ONLINE` · `SLOW_SAVE_TEXT_BATCHED_ONLINE` · `SLOW_SAVE_TEXT_UNHELD` · `SLOW_SAVE_TEXT_UNHELD_ONLINE` · `slowSaveText` · `SLOW_SAVE_EVENT` · `watchSlowCommit` · `trackHiddenTime` · `trackOwnWritesWaits` · `writesInFlight` · `withSlowSaveNotice`

### `admin-shift-types.js`
The shift-type table the Change a Shift surface is built from: `TYPES`, `PILL_TYPES` (the ONE ordered list of pills — `.claude/rules/admin.md` → "Type pills in admin"), the one pill button both pill rows draw (`typePillHtml`, named in full by `pillName` while its label stays short), `WORKED_OVERRIDE_TYPES` and what a Saved Changes row prints for a value. Pure data in its own module so no consumer imports the coordinator back (header). Tested by `admin-shift-types.test.mjs`.
- **Exports:** `TYPES` · `PILL_TYPES` · `pillName` · `typePillHtml` · `WORKED_OVERRIDE_TYPES` · `rowValueText`

### `admin-week-editor.js`
The seven-day Change a Shift grid, its pills, the bulk bar and everything staged but not yet saved; it ends where `executeSave` begins. Also the page's one write lock (`setSaveInFlight`), and it holds Sunday enforcement layers 1 and 2 (CLAUDE.md → "Sundays are non-contracted"). Why staged edits count both ways, and why an unread member draws a loading or failed state: the header. Tested by `admin-week-editor.test.mjs` and `e2e/admin.spec.js`.
- **Exports:** `rosteredWords` · `NOT_ON_ROSTER_LINE` · `initWeekEditor` · `_hasStagedEdits` · `resetStagedRows` · `updateWeekNavLabel` · `buildWeekGridInto` · `renderWeekGrid` · `setSaveInFlight` · `isSaveInFlight` · `sendingDays` · `updateSaveBtn` · `resetBulkPills`

### `admin-saved-changes.js`
The Saved Changes list on `admin.html` and un-recording from it: the list with its month and member filters, a row's two-tap ✕ and the bulk delete of ticked rows, each compared and deleted in one transaction (`admin-override-store.js`). The one invariant — it never claims completeness it does not have — and why a delete that lowers an allowance asks first: the header. Tested by `admin-saved-changes.test.mjs` and `e2e/admin.spec.js`.
- **Exports:** `initSavedChanges` · `resetTableMemberFilter` · `renderTable`

### `admin-override-store.js`
The Admin override cache, the staged reads that fill it, the states they put on screen, and every guarded write's ONE transaction: `commitIfUnchanged`, the deletes behind it, and `commitChecked` for an ordinary save. Bound by `.claude/rules/admin.md` → "Every save of a day is CHECKED"; the header names the three things silent when wrong. Tested by `admin-override-store.test.mjs` and, through the writers, `admin-overrides.test.mjs` and `e2e/admin.spec.js`.
- **Exports:** `initOverrideStore` · `whenOverridesReady` · `isOverrideCacheLoaded` · `hasOverrideAuthorityFor` · `OVERRIDES_QUERY_CAP` · `getAllOverrides` · `mutateCache` · `coversAllStaff` · `loadFailedFor` · `isTruncated` · `setAllOverrides` · `idsReplacedBy` · `withManualDuplicates` · `deleteChunks` · `removeFromCache` · `whenLoadSettled` · `loadOverrides` · `CHANGED_ELSEWHERE_LINE` · `UNCHECKED_DELETE_LINE` · `staleDeleteVerdict` · `DELETE_REFUSED` · `asShown` · `commitIfUnchanged` · `deleteIfUnchanged` · `commitChecked` · `LEAVE_YEAR_CHANGED_LINE` · `ensureMemberLoaded`

### `override-id.js`
The ONE document id a manual override is written to (`manualOverrideId`), so two editors saving one day land on the same document instead of leaving two. Roster imports keep random ids by design (header). Pure. Tested by `override-utils.test.mjs` and, wired, by `admin-overrides.test.mjs` ("two editors saving the same day").
- **Exports:** `manualOverrideId`

### `override-compare.js`
Is the server's copy of a day still the record this page showed? The one rule every guarded Admin write asks (`sameOverrideRecord`), the same rule for a record an unsaved-work draft keeps (`keptRecord` / `sameKeptRecord`), and how a record read outside a transaction is held (`overrideFromSnapshot`). Pure; fails toward "changed". Tested by `override-utils.test.mjs`, and wired by `admin-override-store.test.mjs`, `admin-roster-upload.test.mjs`, `admin-overrides.test.mjs` and `e2e/signed-in.spec.js`.
- **Exports:** `sameOverrideRecord` · `keptRecord` · `sameKeptRecord` · `overrideFromSnapshot`

### `admin-override-coverage.js`
What the Admin override cache actually KNOWS: a coverage record of which members, or the whole collection, have been read. An unfetched member and one with no overrides give the same empty slice, so every write gate asks about a member (`hasAuthorityFor`), never about the load. Pure, no imports. Tested by `admin-override-coverage.test.mjs`.
- **Exports:** `emptyCoverage` · `withMember` · `withAll` · `hasAuthorityFor` · `coversEveryone` · `replaceMemberSlice` · `mergeCappedRead`

### `admin-shift-rules.js`
The two rules a staged shift change must not break, maximum length and minimum rest, plus the days that take no change at all (before the member's start date; an Other day on Christmas Day or Boxing Day; a Spare turn on Christmas Day or Boxing Day) and the configured years the week grid may move within. Pure: it DECIDES and returns the sentences and the failed dates; the caller (`validateShiftRules` in `admin-overrides.js`, and `admin-app.js`'s Save) PAINTS. Tested by `admin-shift-rules.test.mjs`.
- **Exports:** `parseMinutes` · `effectiveEndMins` · `fmtHours` · `constrainingTime` · `checkShiftRules` · `isBoxingDay` · `christmasDayName` · `weekStepAllowed` · `linkableDate` · `checkDayRules`

### `admin-deep-link.js`
Where a hash on `admin.html` lands: which folds to open (including the Recorded Annual Leave dates box, a fold inside a card) and the two-stage scroll that finishes on it. It decides; `openCollapsibleCard` in `admin-app.js` opens. The header numbers three things not to "tidy". Tested by `admin-deep-link.test.mjs`; the landing by `e2e/admin.spec.js`, which asserts the box's bottom edge.
- **Exports:** `NESTED_DEEP_LINKS` · `resolveDeepLink` · `createDeepLinkLanding`

### `admin-rangepicker.js`
The inline date-range calendar the AL and Absence range cards are built on (through `admin-range-booking.js`): a swipeable month grid that moves only within the configured years, wired to hidden From/To inputs, plus the pure `getDateRange`. Bound by `.claude/rules/admin.md` (the clear button; pointer capture on the grid, never the clip). Tested by `admin-rangepicker.test.mjs`.
- **Exports:** `getDateRange` · `buildRangePicker`

### `date-picker.js`
The app's own single-date picker, replacing the native date popup the app cannot style. `initDatePickers` enhances the Operations upload date fields (the input stays, hidden, as the value holder); `openDatePicker` serves a page with its own trigger, as Admin's and Team View's week jump do, with a Sunday-first week mode. Built on `createLightbox`; its CSS is in `shared.css`. Tested by `date-picker.test.mjs`.
- **Exports:** `monthCells` · `openDatePicker` · `initDatePickers`

### `date-format.js`
ONE spelling of a date in words, everywhere the app writes one: the name tables (re-exported by `roster-data.js`), the composers, the "Printed …" stamp and the London zone shim, because `Intl`'s short month spells September "Sept". Pure, and imports nothing. Tested by `date-format.test.mjs`; `month-vocabulary-parity.test.mjs` fails on a new local fix.
- **Exports:** `DAY_NAMES` · `MONTH_ABB` · `MONTH_NAMES` · `NO_DATE` · `formatDayMonth` · `formatDayMonthYear` · `formatDayMonthYear2` · `formatWeekdayDate` · `printedStamp` · `londonClock` · `formatClock` · `londonDate`

### `huddle.js`
The Daily Huddle upload on Operations (admin only), wired through `initDocUploadCard` with the Huddle's differences (PDF or Word, a date cap of tomorrow, a Mammoth DOCX→HTML transform). Guarded by `upload-cap-parity.test.mjs` (the inline-HTML cap) and `dependency-pin-parity.test.mjs` (the Mammoth version, which the CSP names). The Settings Notifications card left it for `notif-card.js` (22 Nov 2026).
- **Exports:** `initHuddleUpload`

### `notif-card.js`
The Settings Notifications card's wiring, through `notif.js`: when it reads (on open; on coming back to the page, a back/forward-cache restore, a permission change and `myb:notif-changed`), the once-per-open re-registration when the session is ready, and Enable (which waits for the session, and gives the button back if the browser's question never settles) and Disable. The words are `notif-card-core.js`'s. Tested by `notif-card.test.mjs`; the page by `e2e/settings.spec.js`.
- **Exports:** `initNotificationsCard`

### `notif-card-core.js`
What the Settings Notifications card says, for every device and state (`notifCardWords`): the chip and state it reports to the summary, its status line, which button, the platform's own route back from blocked, and whether the card lists what it sends. Also the client copy of the timetable change's date (pinned to `functions/documents.js`), the installed app's label read from the page, and the list's separators. Pure. Tested by `notif-card-core.test.mjs`.
- **Exports:** `TIMETABLE_CHANGE` · `TIMETABLE_SEND_HOUR` · `timetableListed` · `homeScreenLabel` · `punctuateKinds` · `STILL_ASKING_LINE` · `ENABLE_FAILED_LINE` · `notifCardWords`

### `doc-upload.js`
The shared skeleton of the three Operations document upload cards: the Weekly Retail Circular and the Marylebone Newsletter (`operations-doc-uploads.js`) and the Daily Huddle (`huddle.js`). Pick → validate → optional transform → upload → receipt, one upload at a time per card, a date cap recomputed whenever it is read, and a write gated like any other (AUTH_AND_SESSIONS 22). `MAX_UPLOAD_BYTES` is one of three declarations of the size limit. Tested by `doc-upload.test.mjs` and `upload-cap-parity.test.mjs`.
- **Exports:** `hiddenByNewerLine` · `isPdfFile` · `isDocxFile` · `initDocUploadCard`

### `admin-auth.js`
The Staff Login Accounts card on Operations (admin only): the Set up accounts button, which calls `setupRosterAuth` with a fresh ID token, and the provisioning audit above it, a READ of `getAccountSetupGaps` naming who has no login, the wrong permissions, an account Set up accounts will not take over, or is a leaver still able to sign in. It never collapses "could not tell" into "none found". Tested by `admin-auth.test.mjs`.
- **Exports:** `initAuthSetup`

### `roster-cell-rules.js`
What a parsed roster cell MEANS as an override: the per-cell guards (`normaliseCellValue`, which every path producing a review value goes through), the value-to-type mapping (layer 4 of the Sunday rule), the zero-length check, and the `RDW|` / `UNKNOWN|` review encodings, defined once here because it is the module every import module can reach without a cycle. Contract: `.claude/rules/roster-import.md`. Tested by `roster-cell-rules.test.mjs`.
- **Exports:** `RDW_PREFIX` · `isRdwEncoded` · `stripRdw` · `UNKNOWN_PREFIX` · `isUnknownEncoded` · `stripUnknown` · `normaliseCellValue` · `shiftValueToOverrideType` · `isZeroLengthRange`

### `roster-entry-control.js`
Answering an UNREADABLE roster cell inside the review, with a type-pill and times editor under the row, so a cell like `SEE NATHAN` is not a dead end. The header holds its three rules (pills from `PILL_TYPES`, Sunday exclusions read from `isForbiddenOnSunday`, an entry passes the guards a parsed value passes) and why the times are text boxes. Contract: `.claude/rules/roster-import.md`. Tested by `admin-roster-upload.test.mjs` and `e2e/operations.spec.js`.
- **Exports:** `entryControlHtml` · `isoFromKey` · `redrawEntry` · `toggleEntry` · `patchEntryRow` · `paintUnreadableRow` · `entryClick` · `commitEntry` · `entryLeftAsRest`

### `roster-alignment.js`
Is a roster read trustworthy, or a day out? The import's one drift check that does not come from the model: each parsed week against the member's own base pattern (`detectShiftedRow`), folded with the PDF grid's refusals into the whole-read circuit breaker (`assessRosterAlignment`). Also the week the upload form offers first, and the warning words beside the verdict. Contract: `.claude/rules/roster-import.md` → Day drift. Tested by `admin-roster-upload.test.mjs`; the wiring by `e2e/operations.spec.js`.
- **Exports:** `defaultWeekEnding` · `detectShiftedRow` · `ALIGNMENT_BLOCK_THRESHOLD` · `assessRosterAlignment` · `geometryCopy` · `driftCopy` · `stopCopy`

### `roster-review-states.js`
What state every cell of the roster review is in and whether it starts ticked, the decisions behind what a Save writes; what one Save writes and says (`collectRosterWrites`, `reviewOutcome`); the GUARDED row's question and words; and which answers survive a refused Save (`carryReviewAnswers`). Pure and Firebase-free; the header numbers the five things an edit can silently break. Contract: `.claude/rules/roster-import.md`. Tested by `admin-roster-upload.test.mjs`.
- **Exports:** `CHRISTMAS_NOTE` · `RDW_PREFIX` · `isRdwEncoded` · `stripRdw` · `UNKNOWN_PREFIX` · `isUnknownEncoded` · `stripUnknown` · `computeCellStates` · `guardCopy` · `swapQuestionApplies` · `guardedWriteValue` · `replacedFromState` · `guardedWrites` · `restOverRest` · `collectRosterWrites` · `reviewOutcome` · `outcomeHtml` · `guardedRowHtml` · `unreadableTagClass` · `carryReviewAnswers`

### `admin-roster-upload.js`
The Weekly Roster Upload coordinator on Operations: pick a file → `parseRosterPDF` → review → save. It reads the page, calls the Cloud Function and paints; every rule it applies lives in `roster-review-states.js`, `roster-cell-rules.js`, `roster-alignment.js`, `roster-entry-control.js` and `roster-import-save.js`. Read `.claude/rules/roster-import.md` first. Its size is held by `coordinator-ratchet.test.mjs`. Tested by `admin-roster-upload.test.mjs` and `e2e/operations.spec.js`.
- **Exports:** `normaliseCellValue` · `shiftValueToOverrideType` · `isZeroLengthRange` · `computeCellStates` · `PARSE_ABORT_MS` · `statusFailureLine` · `shiftDisplay` · `manualShiftDisplay` · `_saveOverrideBatches` · `fetchOverridesForWeek` · `initRosterUpload`

### `roster-import-save.js`
What one Save of the weekly roster review writes. A part that DELETES is one transaction, checked against the records the review loaded, which refuses and names the days if one changed; a part that only adds is a batch. Pure of the DOM; the header carries the reasoning. Contract: `.claude/rules/roster-import.md`. Tested by `admin-roster-upload.test.mjs` and `e2e/operations.spec.js`.
- **Exports:** `IMPORT_CHANGED_CODE` · `UNSENT_SAVES_DETAIL` · `saveRosterWrites` · `refusalLine`

### `paycalc-app.js`
The Pay Calculator coordinator for `paycalc.html`: the gates (the in-place sign-in, then the refusal card for a member with no priced grade), `calculate()`, period changes, autosave and the wiring. No pay maths and no period arithmetic; those are in the modules it imports. `init()` is called by `paycalc-boot.js`. Bound by `.claude/rules/paycalc.md` (invariants 11, 13 and 16); its size is held by `coordinator-ratchet.test.mjs`. Tested by `e2e/paycalc.spec.js`.
- **Exports:** `init`

### `paycalc-result-headline.js`
Which figure the result card's headline shows and what it is called. A confirmed payslip figure and the estimate are two branches writing the same targets, so every target is written on both paths. Also the words under and around the figure: the Year to Date line, a payslip with no figure, and "Check against your payslip". Words only, never the money. Tested by `paycalc-result-headline.test.mjs`.
- **Exports:** `headlineLabels` · `renderResultHeadline` · `renderUnpricedPayslip` · `renderActualCheck` · `renderYtdLine` · `wireYtdLine`

### `paycalc-ytd-card.js`
The Year to Date card's anchor on the page: its "From which payslip?" select, its note and its header chip. It carries `paycalc-periods.js`'s answers to the DOM and owns no rule. Bound by `.claude/rules/paycalc.md` → "Year to Date figures are ANCHORED". Tested by `paycalc-ytd-card.test.mjs`.
- **Exports:** `ytdHasFigures` · `refreshYtdSrc` · `updateYtdNote`

### `paycalc-disclosures.js`
The Pay page's button-and-panel disclosures on ONE open/close core, so `aria-expanded` and the arrow follow the panel on a click and on a programmatic open alike. The disclaimer's More/Less, which has no panel, keeps its own. Tested by `paycalc-disclosures.test.mjs`.
- **Exports:** `setDisclosure` · `toggleDisclosure` · `toggleHoursExtra` · `toggleHppNote` · `toggleBD` · `toggleDisclaimer`

### `paycalc-money-banner.js`
The two opt-in money banners on the result card, back pay and the Holiday Pay Premium: their words in three states (pure) and the one painter. A banner may say "Includes" only when the sum is in the figure above it (header). Tested by `paycalc-money-banner.test.mjs`; the arithmetic gate behind the words by the rendered £ in `e2e/paycalc.spec.js` (`.claude/rules/paycalc.md` → Back-pay).
- **Exports:** `backPayBannerCopy` · `hppBannerCopy` · `paintBanner`

### `paycalc-lightboxes.js`
The overlays on `paycalc.html`: About, the `?` panels' wiring (the shared Tips panel), the decimal hours converter, the data-ownership prompt (`.claude/rules/paycalc.md` invariant 3), the developer-only payslip actuals import, and the page's two one-time notices, Year to Date and then the Holiday Pay Premium, opened LAST through one deferred opener (`showPayNotice`). The About panel and the header logo are also their own call (`initPaycalcAbout`), which the unsupported-role card makes too. Tested by `paycalc-notice-order.test.mjs`; the refusal card's chrome by `e2e/paycalc.spec.js`.
- **Exports:** `initPaycalcAbout` · `initPaycalcLightboxes`

### `paycalc-periods.js`
Period arithmetic and the payslip lists for `paycalc.html`: the period grid (`p.num` is an internal id, never the printed number), the new-starter clamp, the one builder of every payslip list, deep links by payday or month, navigation, and the Year to Date source rules: which payslip may be in hand, offered, stamped, in use, or asked for. Rules: `.claude/rules/paycalc.md` → New-starter visibility clamp and "Year to Date figures are ANCHORED". Tested by `paycalc-periods.test.mjs`.
- **Exports:** `CONFIG` · `getPeriods` · `payslipPeriodNum` · `computeEarliestVisiblePNum` · `setEarliestVisiblePeriod` · `getEarliestVisiblePNum` · `visiblePeriods` · `isTaxYearVisible` · `todaysPeriodNum` · `currentPeriodNum` · `hasBoxingDay` · `bhsForYear` · `hasBankHoliday` · `CONDITIONAL_ROWS` · `updateBhRows` · `_setSelectPeriod` · `appendPayslipOptions` · `offerRecordedPayslip` · `periodLinkMissNote` · `periodPaidInMonth` · `buildPeriodSelect` · `payslipMayBeInHand` · `ytdSourceOffered` · `ytdAutoSource` · `ytdSourceToStamp` · `ytdSourceAfterRetype` · `ytdAnchorStatus` · `buildYtdSourceSelect` · `buildBackPayPeriodSelect` · `updateTyTabs` · `jumpToTaxYear` · `prevPeriod` · `nextPeriod` · `ytdUpdateFrom`

### `paycalc-settings.js`
Each payslip's rate, contracted hours and pension, and Settings save/load: the one answer to the rate a payslip was paid at (`periodRate`), the one place the pension opt-out is applied (`getPensionDefault`), the pension controls, and the Settings card's desktop place and deep link. It re-exports the grade setting's readers from `paycalc-grade-setting.js`. Rules: `.claude/rules/paycalc.md` invariants 8, 12, 13 and 17. Tested by `paycalc-settings.test.mjs`.
- **Exports:** `gradeForRole` · `getGradeSetting` · `gradeDaysFor` · `getContr` · `getLoggedMember` · `gradeToOffer` · `renderGradePrompt` · `isPeriodPriced` · `unpricedLineFor` · `getEffectiveContr` · `getProRateFactor` · `isPensionOptedOut` · `applyPensionOptOutUI` · `buildPensionFromSelect` · `periodDefaultPension` · `wirePensionControls` · `getPensionDefault` · `settledRate` · `settledRateFor` · `awardGrade` · `periodRate` · `settingsSummary` · `updateRateForPeriod` · `updateYtdForTaxYear` · `settingsKey` · `saveSettings` · `confirmSettings` · `setSettingsCardOpen` · `wireSettingsCard` · `loadSettings`

### `paycalc-grade-setting.js`
The member's GRADE SETTING on this device (the roster's dated grades by default, or a grade chosen by hand from a payslip on) and the page's grade controls: the Grade box and its "from which payslip?", the grade prompt, the roster's line and the one-time note. It applies `paycalc-grade.js`'s rules and never imports `paycalc-settings.js`, which re-exports its readers. Rule: `.claude/rules/paycalc.md` invariant 17. Tested by `paycalc-grade-setting.test.mjs`, `paycalc-grade-wiring.test.mjs` and `e2e/paycalc.spec.js`.
- **Exports:** `getGradeSetting` · `gradeDaysFor` · `isPeriodPriced` · `unpricedLineFor` · `getContr` · `getLoggedMember` · `gradeToOffer` · `renderGradePrompt` · `saveGradeSetting` · `loadGradeSetting`

### `paycalc-grade.js`
Which grade each of a payslip's days was worked under, from the roster's dated grades, and the words that go with it. By days, not by shifts (owner, 13 Nov 2026), and a role with no rates is never priced as another. Pure: no DOM, no storage. Rules: `.claude/rules/paycalc.md` invariants 13 and 17. Tested by `paycalc-grade.test.mjs` and `paycalc-grade-wiring.test.mjs`.
- **Exports:** `FROM_ROSTER` · `gradeDays` · `payslipPriced` · `byDays` · `settingFromLegacy` · `windowGrade` · `gradeSplitLine` · `rosterStretches` · `unpricedPayslipLine` · `rosterGradeLine` · `gradeChangeNote`

### `paycalc-roster-hint.js`
The roster-assist hint bar on `paycalc.html`: rendering the suggestion, the Fill buttons that write it (overwriting, as an explicit tap), and the snapshot of which saved figures came from the calendar. The suggestion engine is `paycalc-roster-suggestions.js`; viewing a period never persists a suggestion (`.claude/rules/paycalc.md` invariant 11). Tested by `paycalc-roster-hint.test.mjs`.
- **Exports:** `HM_PAIRS` · `_confBadge` · `snapKey` · `recordCalendarFigures` · `_restoreRosterSuggested` · `updateRosterHint` · `updateJoinerNotice` · `toggleRosterDays` · `clearRosterSuggestedAll` · `_applyRosterSuggestion` · `fillCategoryFromRoster` · `refreshFromCalendarInBackground` · `fillFromRoster`

### `paycalc-hpp-schedule.js`
WHICH payslip carries WHICH tax year's Holiday Pay Premium (the first January payslip of the FOLLOWING tax year, outside the year's own window), answered in both directions, once. Pure, no imports: the grid and the tax-year table are passed in. Rule: `.claude/rules/paycalc.md` invariant 4. Tested by `paycalc-hpp-schedule.test.mjs` against the real `TAX_YEARS`.
- **Exports:** `periodsInTaxYear` · `hppPayslipForTaxYear` · `hppTaxYearForPayslip` · `hppPaidInTaxYear`

### `paycalc-hpp.js`
The Holiday Pay Premium card (this year's figure from three amount sources, last year's figure and its confirmation) and the saved-payslip readers it shares with back pay and the year summary. Back pay is never fed into the premium, London Allowance accrues none, and a joiner is never pro-rated. Rules: `.claude/rules/paycalc.md` invariants 5 to 7 and → "HPP amount source". Tested by `paycalc-hpp.test.mjs`.
- **Exports:** `resolveHppForPeriod` · `_decodeHours` · `savedPeriodPension` · `_varPayForPeriod` · `hppFromYtdTaxable` · `knownYtdLumps` · `applyHppMode` · `readHppState` · `saveHppState` · `restoreHppState` · `calcHPP` · `priorHppToStore` · `commitPriorHppActual` · `premiumStillToEstimate` · `updatePriorHpp`

### `paycalc-fill-year.js` / `paycalc-year-card.js`
"Fill these from your calendar" and the "This tax year so far" card in the sidebar.
- `paycalc-fill-year.js`: the bulk fill as pure orchestration over injected deps, and the seven rules (its header) that make a bulk write onto pay data safe. Tested by `paycalc-fill-year.test.mjs`.
- `paycalc-year-card.js`: renders the year-so-far block and the fill button beside "Not entered yet", and sequences a fill; it owns no rule. Tested by `paycalc-year-card.test.mjs`.
- **Exports of `paycalc-fill-year.js`:** `FETCH_TIMEOUT_MS` · `answerWithin` · `fillablePeriods` · `fillYearFromCalendar` · `fillYearReceipt`
- **Exports of `paycalc-year-card.js`:** `initYearCard` · `renderYearCard`

### `paycalc-year-summary.js`
"This tax year so far": `computeYearSoFar` re-runs the calculator headlessly over every PAID payslip of a tax year that has saved hours, each rounded as the result card shows it, plus a projection labelled rough. No DOM; rendered by `renderYearCard` (`paycalc-year-card.js`). Tested by `paycalc-year-summary.test.mjs` against the REAL engine.
- **Exports:** `computeYearSoFar`

### `paycalc-backpay.js`
The back-pay card: the lump owed for a pay award backdated to 1 April, computed from the member's hours or entered from the payslip, kept per tax year and opt-in to the take-home; it also holds the card's state as the take-home reads it (`bpState`). Every rule is `.claude/rules/paycalc.md` → Back-pay (and invariants 1, 5 and 14); the three figure decisions are `paycalc-backpay-state.js`, the award arithmetic `paycalc-backpay-accrual.js`. Tested by `paycalc-backpay.test.mjs`, which drives the real `calcBackPay` against a fake `document`.
- **Exports:** `_backdatedFromPNum` · `applyBpMode` · `_bpAwardTaxYear` · `prefillBackPay` · `restoreBpState` · `raiseByPercent` · `bpStoryHtml` · `calcBackPay` · `bpState` · `onBackPayChange` · `runCalcBackPay` · `applyBpRisePct` · `refreshBackPayCard` · `syncBackPayForViewedYear`

### `paycalc-backpay-accrual.js`
What a pay award owes, period by period — pure, no DOM: one period's arrears, the April fraction of an award's first period (`awardWindowFactor`), and the share of the lump that is not premium pay. A module of its own so the Holiday Pay Premium's Year to Date estimate (`paycalc-hpp.js`) reuses the card's arithmetic without an import cycle. Bound by `.claude/rules/paycalc.md` invariants 1 and 14; tested by `paycalc-backpay.test.mjs`, `paycalc-periods.test.mjs` and `paycalc-hpp.test.mjs`.
- **Exports:** `paidInPeriodNum` · `awardWindow` · `_awardBackdateDate` · `awardWindowFactor` · `_accrueBackPayPeriod` · `awardLumpNonPremium`

### `paycalc-format.js`
The pay calculator's shared formatters and field helpers: dates in the app's own words, read off the device's calendar; money and hourly rates; minutes; and the hours/minutes field pairs with the "nothing entered" test. Pure, and its only import is `date-format.js`, so every paycalc module can reach it from Node. Tested by `paycalc-format.test.mjs`.
- **Exports:** `fd` · `fdShort` · `fdLong` · `fmt` · `fmtRate` · `fdList` · `clampMinute` · `minutesFieldText` · `decimalToHM` · `HM_PAIRS` · `isDataEmpty`

### `paycalc-breakdown.js`
The pure HTML builders for the pay-result card — the summary rows, the full breakdown, the loan lines, the share-of-pay bar, the provenance chips and the two payslip checks (the verdict, and the line-by-line comparison) — so the markup is testable apart from `calculate()`'s DOM and maths. What the payslip check may say is `.claude/rules/paycalc.md` → "Check against your payslip" and invariant 18. Tested by `paycalc-breakdown.test.mjs`.
- **Exports:** `taxCodeNotRecognised` · `fmtHrsMins` · `buildSummaryRows` · `buildLoanLines` · `ytdMisfitNote` · `buildBreakdownRows` · `buildActualCheck` · `buildActualComparison` · `buildProvChips` · `buildBreakBar`

### `paycalc-form-data.js`
The per-period form ↔ saved-data round trip: the saved-period schema, form → object for autosave, object → form for a load, and the one rule for what a pension field's text is stored as. A module of its own so a write → read → write test holds it symmetric — `.claude/rules/paycalc.md` invariant 2; the header lists the defects that asymmetry caused. Tested by `paycalc-form-data.test.mjs`.
- **Exports:** `emptyPeriodData` · `syncNoSpecialTick` · `pensionToStore` · `readFormData` · `settingFieldsWrite` · `writeFormData`

### `paycalc-inputs.js`
The field readers for `paycalc.html`'s hours and figures: the one reader of what an hours box holds (a decimal, a decimal comma or a clock time), the live "= 7h 30m" hint, the Decimal Hours Converter's answer, the Tax Code box's warning, and `wireIosTap` for a control tapped while the iPhone keyboard is up. They need only `document`, so they test in Node against a fake one (`paycalc-inputs.test.mjs`); the event wiring stays in `paycalc-app.js`.
- **Exports:** `numVal` · `numValOr` · `intVal` · `hoursTextToHM` · `hmPair` · `hhmmDec` · `clampMins` · `_decHintEl` · `decimalHoursText` · `decPreview` · `paintTaxCodeWarning` · `commitFocusedField` · `wireIosTap`

### `paycalc-backpay-state.js`
Which figure ends up in which back-pay box, and which boxes the member may change: the saved blob's fields and round trip, which rates are on record (so locked, and written), whether a saved blob fits the grade now in force, and which payslip the lump is paid in. Taken out of `calcBackPay` so `.claude/rules/paycalc.md` invariant 1 and the back-pay section's "Three rules to keep" are unit-tested (`paycalc-backpay-state.test.mjs`); the header lists the defects.
- **Exports:** `BP_FIELDS` · `readBpFields` · `bpFieldWrites` · `resolveAuthoritativeRates` · `blobFitsGrade` · `allRatesOnRecord` · `resolvePaidInPeriod`

### `paycalc-pension.js`
WHEN a member was in the pension scheme, as a timeline of changes rather than a flag: reading it (the trust boundary, refused whole), whether a payslip falls in an opt-out spell, the two edits the Settings control makes (moving a spell's start, ending it at a rejoin), and the one-time migration from the old boolean. Pure — no DOM, storage or imports; its consumer is `getPensionDefault` in `paycalc-settings.js`. Bound by `.claude/rules/paycalc.md` invariant 12; tested by `paycalc-pension.test.mjs`.
- **Exports:** `parsePensionTimeline` · `serialisePensionTimeline` · `isOptedOutAt` · `withPensionChange` · `withOptOutStartAt` · `withRejoinAt` · `optOutStartsAt` · `migrateLegacyOptOut`

### `paycalc-inventory.js`
What a stored pay key IS, and what a set of them adds up to — the ONE classifier the backup summary, the transfer card's itemised list, Settings' Pay Calculator Data line and the damage preflight all ask, so they cannot disagree. An unrecognised key is described as unknown, never dropped. Bound by `.claude/rules/paycalc.md` invariant 15; tested by `paycalc-inventory.test.mjs`, which scans the tree for every `pcPrefix()` key builder and requires each to land on a known kind.
- **Exports:** `KEY_KINDS` · `classifyPayKey` · `describePayKey` · `inventoryOf` · `damagedEntries` · `inventoryLines` · `inventorySummary`

### `paycalc-transfer.js`
The pay-data backup format and its import rules. Pay data lives only in this browser's `localStorage` — per address, and kept off the server by decision — so this is how it moves to the other address or a new phone. Pure, because the import decides whether a member's whole pay history is overwritten: key selection, the validation ladder (`validateBackup`, the trust boundary), re-keying and the all-or-nothing replace. The DOM half is `paycalc-transfer-card.js`. Bound by `.claude/rules/paycalc.md` invariant 10; tested by `paycalc-transfer.test.mjs`, key shape by `paycalc-key-parity.test.mjs`.
- **Exports:** `BACKUP_FORMAT` · `BACKUP_VERSION` · `selectBackupKeys` · `summarise` · `buildBackup` · `validateBackup` · `rekeyEntries` · `restoredLine` · `backupFilename` · `applyRestore`

### `paycalc-transfer-card.js`
The DOM half of the "Move Your Pay Data" card: the itemised list of what is on this device, Download, Copy, the two Restores, the file and clipboard plumbing, and the confirmations before a restore. It owns no rule; every decision is `paycalc-transfer.js`'s. Its header says why the title must not begin "Back up", why the hint leads with "Keep a copy", and why a restore writes first and every control is disabled for a member who cannot be identified (`.claude/rules/paycalc.md` invariant 10).
- **Exports:** `initTransferCard`

### `paycalc-help.js`
The pay calculator's help-panel text, keyed by each `.help-btn`'s `data-help`. Pure data; the rates, London Allowance and contracted hours in its tips are read from `paycalc-calc.js`, so no figure is typed here.
- **Exports:** `HELP_CONTENT`

### `paycalc-migrations.js`
The pay calculator's storage keys and its one-time data migrations: the per-member prefix every key is built from, the key builders, the device-level flags (retired ones included, which stay declared), both halves of the legacy-data ownership prompt, and the developer-only payslip actuals. Every per-member key carries `pcPrefix()` and device flags never do — `.claude/rules/paycalc.md` invariant 3. Tested by `paycalc-migrations.test.mjs` and `paycalc-key-parity.test.mjs`.
- **Exports:** `PAY_DATA_GENERATION` · `memberSlug` · `keyOwnerSlug` · `pcPrefix` · `SK` · `setPaycalcNamespace` · `periodKey` · `parseSavedPeriod` · `readSavedPeriod` · `hppEstKey` · `hppActualKey` · `hppIncKey` · `hppModeKey` · `bpKey` · `ytdPayKey` · `ytdSrcKey` · `ytdTaxKey` · `NOTICE_YTD_KEY` · `NOTICE_HPP_KEY` · `isActualsDev` · `readPayslipActuals` · `writePayslipActuals` · `clearPayslipActuals` · `DEVICE_KEYS` · `RETIRED_DEVICE_KEYS` · `hasPendingLegacyMigration` · `resolveLegacyMigration` · `runMigrations`

### `paycalc-calc.js`
The pay maths: the rate, threshold, pension and award tables, and the pure engine — gross pay, income tax (with the one tax-code reader), National Insurance, student loans and the take-home, priced by the one pipeline the payslip and the year so far share (`pricePayslip`) — with no DOM, Firebase or browser globals. Every figure, every payroll rule and the steps for the next award or tax year are `.claude/rules/paycalc.md` ("Current rates", "Payroll rules"). Tested by `paycalc.test.mjs`, `paycalc-current-year.test.mjs` and, on the owner's checkout, `npm run test:payslip-local`.
- **Exports:** `P_YR` · `RATE_125` · `RATE_150` · `RATE_300` · `TAX_YEARS` · `TAX_BY_YEAR` · `NI_BY_YEAR` · `SL_BY_YEAR` · `SCOTTISH_TAX_BY_YEAR` · `GRADES` · `PENSION_STEPS` · `AWARD_RATES` · `awardRatesFor` · `awardFromForYear` · `isPreAwardPeriod` · `getRateForPeriod` · `HPP_FRACTION` · `takeHomePay` · `calcBandedTax` · `getTaxYearForOffset` · `taxYearForPeriod` · `getThresholds` · `getLondonAllowanceForPeriod` · `getPensionForPeriod` · `calcProRateFactor` · `proRateDays` · `capHours` · `computeGross` · `readTaxCode` · `computeTax` · `computeNI` · `computeSL` · `pricePayslip`

### `paycalc-roster-suggestions.js`
The roster-to-pay suggestion engine behind the hint bar: one member's recorded changes for a payslip, fetched and kept per payslip, merged with the base roster into the Saturday / Sunday / bank holiday / overtime / RDW / Boxing Day totals the bar pre-fills. No DOM. Its payroll rules are `.claude/rules/paycalc.md` invariants 9 and 11 and "Payroll rules"; tested by `paycalc-roster-suggestions.test.mjs`.
- **Exports:** `_setOverridesForTest` · `_addBhDateForTest` · `_removeBhDateForTest` · `resetOverrides` · `getOverridesFetchState` · `fetchOverridesForPeriod` · `getRosterSuggestion`

### `firebase-client.js`
The single Firebase initialisation point: every page takes `db`, `auth` and the SDK calls from here, never from the CDN, so the SDK version appears once (a bump also moves `FIREBASE_SDK_VERSION` in `service-worker.js` — CLAUDE.md → Change impact). It cannot load in Node, so its rules live in the pure modules and factories it binds — `claim-retry.js` for every write, `documents-client.js`, `account-calls.js`, `analytics-client.js` among them. Boot persistence: `AUTH_AND_SESSIONS.md` 8; the persistent cache: `.claude/rules/pwa.md`. Tested by `firebase-client.test.mjs` and `calendar-viewer-parity.test.mjs`.
- **Exports:** `db` · `collection` · `query` · `where` · `orderBy` · `limit` · `getDocs` · `getDocsFromCache` · `getDoc` · `getDocFromCache` · `onSnapshot` · `addDoc` · `setDoc` · `deleteDoc` · `doc` · `serverTimestamp` · `writeBatch` · `runTransaction` · `deleteField` · `COLLECTIONS` · `isSafeStorageUrl` · `resolveDocumentOpenUrl` · `auth` · `authBootstrap` · `authReady` · `currentUserAfterBoot` · `restoreMemberPersistence` · `setViewerPersistence` · `signInWithEmailAndPassword` · `signInWithCustomToken` · `signOut` · `onAuthStateChanged` · `withClaimRetry` · `writeWithClaimRetry` · `whenOwnWritesSent` · `VIEWER_WRITES_GRACE_MS` · `letViewerWritesGo` · `normaliseSurname` · `nameToEmail` · `uploadHuddle` · `uploadCircular` · `uploadNewsletter` · `getLatestCircular` · `getLatestNewsletter` · `getLatestHuddle` · `subscribeToLatestHuddle` · `currentAuthUid` · `savePushSubscription` · `deletePushSubscription` · `getStaffContact` · `saveStaffContact` · `deleteStaffContact` · `getAllStaffContacts` · `getPasswordStatus` · `probeResetAtMs` · `savePasswordSetAt` · `getAllPasswordStatus` · `reauthenticateWithPassword` · `changeOwnPassword` · `resetMemberPassword` · `getAccountSetupGaps` · `requestPasswordReset` · `fetchSignedDocumentUrl` · `getSignInStats` · `getResetRequests` · `clearResetRequest` · `logClientError` · `getClientErrors` · `resolveClientError` · `recordPageView` · `recordActiveAccount` · `recordOriginUse` · `recordPerfSample` · `getPerfStats` · `getUsageStats`

### `fetch-timeout.js`
The bound on every client call to a Cloud Function: `fetch` with a deadline that also covers the body read, a separate code for a caller's own cancel, and `serverRefusal` for a 4xx that is an answer rather than a fault. The header holds the per-endpoint budgets and the two rules every caller keeps: a budget sits above the endpoint's own `timeoutSeconds`, and a timeout on a state-changing call does not mean it did not happen — a write says "may still have gone through", never "failed". Tested by `fetch-timeout.test.mjs`.
- **Exports:** `FETCH_TIMEOUT_CODE` · `FETCH_ABORTED_CODE` · `DEFAULT_FETCH_TIMEOUT_MS` · `fetchWithTimeout` · `fetchBytesWhileArriving` · `isFetchTimeout` · `isFetchAborted` · `serverRefusal`

### `error-reporter.js`
The capture side of the client error log: `error` and `unhandledrejection` listeners that write each distinct message once per page to `clientErrors`, and a capped diagnostic entry for a save that was slow while the device said it was online. Never call `initErrorReporter()` bare — with no auth context every write is refused and the log looks healthy because it is broken; the four call shapes are its header, the rule `AUTH_AND_SESSIONS.md` 13. Filters: `client-errors.js`. Tested by `error-reporter.test.mjs`.
- **Exports:** `initErrorReporter`

### `usage-reporter.js`
The anonymous usage recorder: it decides WHEN to count a page view, an account active this month and over a rolling 30 days, which address and whether from the installed app, and a document or guide opened — and leaves the I/O to `firebase-client.js`. The dedup stays on the device, so the server only receives `+1`. Called once per page beside `initErrorReporter()`. Its header argues each rule: only a signed-in admin is left out, a selection is a dedup key and nothing else, a release reload is not a visit. Tested by `usage-reporter.test.mjs`.
- **Exports:** `recordUsage` · `recordOpen`

### `usage-stats.js`
Pure date bucketing and aggregation for the usage counters: month and day keys, the per-month dedup, the rolling count that moves to the latest active day, the window sums and prunes, page ordering, and the per-address counters' labels and keys. No DOM, no Firebase, and no identity in any value. Tested by `usage-stats.test.mjs`.
- **Exports:** `ROLLING_WINDOW_DAYS` · `DAILY_RETENTION_DAYS` · `monthKey` · `prevMonthKey` · `dayKey` · `shouldCountMonth` · `rollingMove` · `recentDayKeys` · `sumDailyWindow` · `orderPageCounts` · `staleDailyKeys` · `originLabel` · `originKey` · `parseOriginKey` · `summariseOrigins` · `staleOriginKeys`

### `perf-reporter.js`
The anonymous page-load latency recorder: per load, only the timings the App Speed card reads, as bucketed counters with install mode and connection class — no identity and no raw millisecond value. A sample is time somebody spent waiting: a load nobody watched records none, and time spent typing never counts. The header argues each rule, and `LATENCY.md` holds what the retired metrics found. Also the `ready` and milestone marks, the sign-in marker, and `loadFollowedRelease`, shared with `usage-reporter.js` because the release marker can be read only once. Tested by `perf-reporter.test.mjs`.
- **Exports:** `markLoginStart` · `clearLoginStart` · `loadFollowedRelease` · `PAGE_READY_MARK` · `markAwaitingInput` · `markMilestone` · `markPageReady` · `recordPageLatency`

### `perf-stats.js`
Pure latency maths for the speed pipeline: the duration buckets and sample keys, the merged monthly write, the three speed bands (whose percentages always add to 100), the breakdowns by version, install mode and connection, the verdict and its thin-sample rule, the release-bounded readings, and how full the month's record is. No DOM, Firebase or timing reads. A stored count is read only if a real counter could hold it, because any signed-in session can write the values. Tested by `perf-stats.test.mjs`.
- **Exports:** `PERF_BUCKETS` · `bucketDuration` · `perfSampleKey` · `parsePerfSampleKey` · `SPEED_GROUPS` · `summarisePerf` · `PERF_DIMENSIONS` · `summarisePerfBy` · `EARLY_ROSTER` · `summariseEarlyRoster` · `EARLY_ROSTER_FROM` · `shareLabel` · `compactPct` · `earlyRosterShareLabel` · `UPDATE_OPENS` · `UPDATE_OPENS_FROM` · `summariseUpdateOpens` · `CLEAN_TIMINGS_FROM` · `shareMeasuredBefore` · `perfRecordFullness` · `THIN_SAMPLE` · `perfVerdict` · `LOGIN_MAX_MS` · `loginDurationBucket` · `createPerfBatcher`

### `auth-identity.js`
Pure account-identity helpers with no imports: the surname and synthetic email every account is built from, the surname default, the passwords a sign-in tries, the chosen-password rules and failure wording shared by Settings and the forced change, and the reset checks a silent re-sign-in asks. ⚠️ Changing `normaliseSurname` locks every member out — the header says what a change needs (`AUTH_AND_SESSIONS.md` 12), and `surname-parity.test.mjs` holds the Functions copy equal. Tested by `auth-identity.test.mjs`.
- **Exports:** `normaliseSurname` · `nameToEmail` · `surnamePassword` · `credentialCandidatesFor` · `isPasswordMigrated` · `MIN_PASSWORD_LENGTH` · `validateNewPassword` · `newPasswordProblemField` · `passwordChangeFailure` · `isCredentialRejection` · `sessionPredatesReset` · `resetAtFromRestDoc` · `isRestThrottled` · `isRestCredentialRejection`

### `document-url.js`
Asks the server for a SHORT-LIVED document url and decides what a refusal means: it never throws, and `null` is not a failure — every caller has the permanent stored url, so a 503, 403, 404, timeout or offline answer means "carry on the old way". Imports only `fetch-timeout.js`, so the rule tests in Node (`document-url.test.mjs`); `fetchSignedDocumentUrl` in `firebase-client.js` adds the token. Which url actually opens is `resolveDocumentOpenUrl` (`storage-utils.js`). AUTH_PLAN.md §5.
- **Exports:** `DOCUMENT_URL_ENDPOINT` · `DOCUMENT_URL_TIMEOUT_MS` · `requestSignedDocumentUrl`

### `functions/cell-day-rules.js`
What a roster cell MEANS, given the day of the week it sits in: the one list of readings that say a cell was empty, an empty cell as `RD` on a Sunday and a review question Monday to Saturday, and the whole-cell recognisers for the not-available codes (rest days on every day, by owner decision). CommonJS, requires nothing; required by the parser, prompt, Sunday-repair and geometry modules. Bound by `.claude/rules/roster-import.md`; tested by `roster-parse-helpers.test.mjs` and `index-endpoints.test.mjs`.
- **Exports:** `BLANK_CELL_TOKEN` · `LONE_DASHES` · `BLANK_READINGS` · `NOT_AVAILABLE_TOKENS` · `NOT_AVAILABLE_SUNDAY_TOKENS` · `SUNDAY` · `isBlankReading` · `isLoneDash` · `isPhysicallyBlank` · `printsNothing` · `isNotAvailable` · `isNotAvailableSunday` · `blankCellMeaning`

### `storage-utils.js`
Pure Storage helpers with no imports: `isSafeStorageUrl`, the download-url allowlist every document open passes (a security control); `resolveDocumentOpenUrl`, the whole decision of which url a document opens with, made at the tap; the Office-viewer wrap for a `.docx`; the six-month retention cutoff; and the Storage path and upload-type helpers the deletes and the server's prune rely on. Tested by `storage-utils.test.mjs`, the open rule's wiring by `calendar-doc-viewer.test.mjs`.
- **Exports:** `isSafeStorageUrl` · `isDocxUpload` · `officeViewerUrl` · `SIGNED_URL_MARGIN_MS` · `resolveDocumentOpenUrl` · `sixMonthCutoffISO` · `legacyDocPath` · `versionedDocPath` · `uploadMimeType`

### `client-errors.js`
The pure rules of the client error log: the noise filters (too broad is the dangerous direction — it hides real errors and the log looks healthy), retention counted from resolution, the Error Log's ordering and its no-silent-cap truncation, and the slow-save diagnostic that is listed but never counted as an error. Used by `error-reporter.js`, `analytics-client.js` and `operations-errors.js`. Tested by `client-errors.test.mjs`, and by `error-reporter.test.mjs`, which pins every filter from both sides.
- **Exports:** `APP_SCRIPT_ORIGINS` · `shouldReport` · `CLIENT_ERROR_RETENTION_MS` · `isResolvedErrorExpired` · `expiredResolvedIds` · `orderClientErrors` · `DIAGNOSTIC_PREFIX` · `isDiagnosticEntry` · `capUnresolvedErrors`

### `claim-retry.js`
The pure write-safety rules, every dependency injected: one refresh-and-retry for a stale-claim refusal, never sent as another account; the wait abandoned when the account goes, which ends the wait and not the write, so the outcome is called unconfirmed; the gate that refuses new writes once one ends unconfirmed; the wait for this device's queued writes before a checked write, and how each one ended (`watchOwnWritesWaits`, read by the slow-save diagnostic); the background-write count every update reload waits for; and the watch for a session that has gone. Bound by `AUTH_AND_SESSIONS.md` 5, 21 and 22; tested by `claim-retry.test.mjs`.
- **Exports:** `isClaimRetryable` · `isAccessFailure` · `runWithClaimRetry` · `SIGNED_OUT_CODE` · `signedOutLine` · `UNCONFIRMED_CODE` · `UNCONFIRMED_LINE` · `hasUnconfirmedWrite` · `_resetUnconfirmedWrites` · `trackBackgroundWrite` · `backgroundWritesInFlight` · `runGatedWrite` · `unconfirmedWriteLine` · `OWN_WRITES_WAIT_MS` · `ownWritesSent` · `watchOwnWritesWaits` · `saveFailureMessage` · `abandonOnSignOut` · `runWatchedClaimRetry` · `watchIdentityLoss`

### `page-session.js`
How a signed-in page leaves a session, and what it does when the session leaves it — the routines every protected page shares, so the per-page copies cannot differ again: the questions before unsaved work is left, the draft kept when the page is hidden, a sign-out that leaves no history entry, the reload when a restored or other-tab page belongs to somebody else, and `guardNamedSession`'s sign-in when the page's session cannot be confirmed or goes later. The header says what each routine owns. Tested by `page-session.test.mjs`; the wiring by `page-contract-parity.test.mjs`.
- **Exports:** `LEAVE_QUESTION` · `DISCARD_QUESTION` · `warnOnUnload` · `askBeforeLeavingByDrawer` · `leaveAfterAsking` · `LEAVE_ANSWERED` · `keepDraftWhenHidden` · `onReturnToPage` · `askBeforeSignOut` · `signOutAndLeave` · `reloadIfRestoredForSomeoneElse` · `rebaseRestoreGuard` · `lateReloadAllowed` · `LATE_RELOAD_GAP_MS` · `SIGNED_OUT_NOTICE` · `guardNamedSession`

### `unsaved-draft.js`
A copy of unsaved work, kept on this device for the exits nothing can ask about (iOS discards a hidden page; a swipe back asks nothing) and offered to the same member on the next load. Its six rules are the header: never applied silently, never across members, a mirror of the unsaved state at the last hide that deletes only its own copy, a day then gone, a draft is work and not a decision, and work a save has since landed is not unsaved. Written through `keepDraftWhenHidden` (`page-session.js`); used by Admin and Links. Tested in `page-session.test.mjs`.
- **Exports:** `DRAFT_PREFIX` · `DRAFT_MAX_AGE_MS` · `draftKey` · `encodeDraft` · `decodeDraft` · `restoreQuestion` · `draftBaseline` · `weekRestoredLine` · `createDraftSlot`

### `guide-search.js` / `guide-index.js` / `nav-guide-search.js`
Cross-guide search in the drawer's Reference zone: a member knows a term, not which guide owns it. The three rules — evidence passes through verbatim, one shared tokeniser, a card beats its own section — are numbered in `guide-search.js`'s header. Tested by `guide-search.test.mjs` (the rules) and `guide-index-parity.test.mjs` (staleness, marker vocabulary, anchors, wiring).
- `guide-search.js` — the pure rules: the one tokeniser, which the index generator imports, and the ranked search.
- `guide-index.js` — `GUIDE_INDEX`, GENERATED from the guide pages by `npm run generate:guide-index` (`scripts/guide-index-lib.mjs`); never hand-edit it. What a page may mark for it: `.claude/rules/guide-pages.md`.
- `nav-guide-search.js` — the search box, lazy-loaded with the index on its first focus. Result rows are ordinary drawer guide links, so the drawer's own handler counts opens and handles Back; evidence shows as one chip per state.
- **Exports of `guide-search.js`:** `tokeniseText` · `searchGuideIndex`
- **Exports of `guide-index.js`:** `GUIDE_INDEX`
- **Exports of `nav-guide-search.js`:** `initGuideSearch`

### `operations-tips.js`
`CARD_TIPS` — the content of every `?` panel on `operations.html`, in the shape `tips-lightbox.js` renders and `tips-content.test.mjs` pins; `operations-app.js` hands it to `initTipsLightbox`. Also `NEWSLETTER_CARD`, the Newsletter upload's receipt and sign-out words, which ask `isRecentIssue` (`newsletter-recency.js`) of the date just uploaded because the ☰ menu offers an issue for six weeks. `e2e/operations.spec.js` pins both answers.
- **Exports:** `NEWSLETTER_CARD` · `CARD_TIPS`

### `operations-attention.js`
The "Needs attention" strip at the top of `operations.html`: an index of exceptional card states, fed by the cards that own the data (`operations-app.js`, `operations-errors.js`). Its three refusals — no reads, absent when clean, no navigation of its own — and the one "couldn’t check" exception are its header; `ATTENTION_CATALOGUE` is the one declaration of what can need attention, and `attentionBadge` the one spelling of a count. Pure half tested by `operations-attention.test.mjs`; the wiring by `e2e/operations.spec.js`.
- **Exports:** `ATTENTION_CATALOGUE` · `attentionBadge` · `buildAttentionItems` · `reportLoginAccounts` · `withdrawLoginAccounts` · `createAttentionStrip`

### `operations-pin-lockout.js`
The staff PIN's station-wide block, on Operations (owner, Nov 2026): a line on Staff Login Accounts and the strip's `pinLockout` item, while a block runs or one began in the last day. It runs no read — the fact rides on the audit's answer — and says times and counts only; its three states, and why an absent answer is unknown, are its header. Wired by `admin-auth.js`, which redraws the line when `lockoutChangesAt` says. Tested by `operations-pin-lockout.test.mjs` and `admin-auth.test.mjs`.
- **Exports:** `readLockout` · `lockoutWords` · `lockoutChangesAt` · `renderLockoutLine` · `lockoutCount`

### `operations-doc-links.js`
The Document links card on `operations.html` (owner, 12 Nov 2026 — `ARCHITECTURE.md` EXC-007): Check asks `rotateDocumentLinks` for a preview, Replace runs it behind a confirm, and every answer is reported honestly — done, not run, or not known. The server does the work (`functions/doc-link-rotation.js`); `docLinksRequestInFlight` holds an update's reload while an answer is awaited. The three outcomes, the older server's missing counts and the dead-link wording are its header. Wording and request tested by `operations-doc-links.test.mjs`, the wiring by `e2e/operations.spec.js`.
- **Exports:** `ROTATE_LINKS_URL` · `docLinksRequestInFlight` · `requestLinkRotation` · `describePreview` · `describeResult` · `checkFailure` · `runFailure` · `initDocLinksCard`

### `operations-reset.js`
What Operations → Account status → **Reset** asks, and every sentence it says about the answer — not the reset-request queue. Pure, so every combination of stages is checked without a page; `operations-app.js` keeps the row's button, the request and the re-read. The lost-phone box, the report built from the stages the server reports, and what a failure may claim are its header. Tested by `operations-reset.test.mjs`, and driven outcome by outcome on the real page by `e2e/operations.spec.js`.
- **Exports:** `LOST_PHONE` · `resetQuestion` · `resetFailure` · `resetOutcome`

### `operations-al-sheet.js`
The Annual leave sheet card on `operations.html` (docs/AL_UPLOADER_PLAN.md, Phases 1 and 2b): a leave file in, the app's own records beside it, every difference on screen, and each person handed to the Save (`operations-al-save.js`). The file's seal is `al-leave-file.js`'s, each day's verdict `al-leave-compare.js`'s, the reads `al-leave-save.js`'s and every word `al-leave-words.js`'s; this module reads, wires and draws. Why a cached read stops the check, why the answer on screen is always for the input on screen, and what `alSheetBusy` and `alSheetUnsaved` hold back are its header. Driven by `e2e/operations.spec.js`.
- **Exports:** `alSheetBusy` · `alSheetUnsaved` · `initAlSheetCard`

### `operations-al-save.js`
The Annual leave sheet's Save on Operations (docs/AL_UPLOADER_PLAN.md §4.7–4.10): the rest-day answers, a confirmation per person with their figures after, the Save button, the receipt and the Undo. WHAT is written is `al-leave-plan.js`'s and sending it `al-leave-save.js`'s. Its header holds the rules: nothing saved for a person nobody confirmed, answers that outlive any new check, a Save that sent nothing changes nothing, an unrecorded Save finished by the next check, and nothing kept on the device. Driven by `e2e/operations.spec.js`.
- **Exports:** `alSaveWorking` · `alSaveUnsaved` · `forgetReview` · `finishPendingLog` · `createReview`

### `operations-doc-uploads.js`
What the Weekly Retail Circular and Marylebone Newsletter upload cards on `operations.html` are configured with. The picker, the checks, the upload, the one-at-a-time lock and every outcome's words are `doc-upload.js`'s; why the two configurations left `operations-app.js` is its header.
- **Exports:** `initDocumentUploadCards`

### `nav-destinations.js`
Where the drawer can take you, as DATA: the page pills (`NAV_PAGES`), the Latest documents (`NAV_INFORMATION`), the Reference guides (`NAV_GUIDES`), the App Notices section colours (`SECTION_MODS`), the gate each pill flag reads (`PILL_GATES`) and the one pill filter (`visiblePills`). Imports nothing, so the tests IMPORT the lists rather than reading them out of `nav-panel.js` as text; the header says why. The gate values come from `navGatesFor` (`auth-policy.js`). Tested by `nav-gates.test.mjs`, and read by the parity tests that hold the guides, the page colours and the analytics ids to it.
- **Exports:** `NAV_PAGES` · `NAV_INFORMATION` · `NAV_GUIDES` · `SECTION_MODS` · `PILL_GATES` · `visiblePills`

### `nav-panel.js`
The slide-out drawer every app page carries: it injects the overlay and drawer, wires the burger (`#navMenuBtn`), and renders the footer (initials badge, notification bell, Sign out). What it lists is `nav-destinations.js`'s; its decisions — the three zones, pills filtered rather than refused, sign-out's order, the bell, App Notices and the drawer's one history entry shared by its two lightboxes (one lifecycle, `_drawerLightbox`) — are `.claude/rules/nav-drawer.md`; the reasoning is the header and beside the code. Tested by `nav-panel.test.mjs`, `nav-bell.test.mjs` and `nav-guide-fold.test.mjs`; capped by `coordinator-ratchet.test.mjs`.
- **Exports:** `resetNavPanel` · `initNavPanel`

### `newsletter-recency.js`
Whether the ☰ menu offers the Marylebone Newsletter: only while its latest issue is under six weeks old (owner, 14 Nov 2026). The Calendar asks once per load and the latest issue's date is kept on the device for every page; the rule, and why only the Calendar asks, are its header. Pure apart from `ls.js` — the read is handed in. Tested by `newsletter-recency.test.mjs`; the wiring by `e2e/calendar.spec.js` and `e2e/operations.spec.js`.
- **Exports:** `NEWSLETTER_RECENT_DAYS` · `NEWSLETTER_LATEST_KEY` · `isRecentIssue` · `newsletterInMenu` · `recordLatestNewsletter` · `noteNewsletterUploaded` · `checkLatestNewsletter`

### `notice-archive.js`
The App Notices archive's rules: what a seen one-time notice leaves behind on this device, for how long, and when a notice is too old to show. The drawer only renders it; the pages that archive a notice import the two calls from here, and the pattern for using them is the `/new-notice` skill. Imports only `ls.js`. Tested by `notice-archive.test.mjs`.
- **Exports:** `isNoticeExpired` · `archiveNotice` · `readArchivedNotices`

### `notif.js`
The Web Push module: the client's one copy of the VAPID public key — it must match `functions/index.js`, and a mismatch is silent and permanent (CLAUDE.md → Change impact) — and the subscription lifecycle: the state the bell and the Settings card show, enable and disable, and `releaseDevicePush` at a sign-out. Which reads have side effects and why a deliberate Off is not a lapse are its header and each export's JSDoc. Tested by `notif.test.mjs`; the server side, a rotated endpoint and the fingerprint migration are `.claude/rules/notifications.md`.
- **Exports:** `notifOffByChoice` · `isIOS` · `isStandalonePWA` · `onPagesMirror` · `notifSupported` · `getNotifState` · `peekNotifState` · `enableNotifications` · `disableNotifications` · `releaseDevicePush`

### `print-guard.js`
Can `window.print()` do anything here, and what to say when it cannot: in a home-screen web app on iPhone or iPad it silently does nothing. Pure and import-free, so the guides and the app pages share one rule and one wording; every print control goes through `printOrExplain`. The WebKit reference, and why no iOS version is read, are its header. Tested by `print-guard.test.mjs`; the entry points by `e2e/print.spec.js`.
- **Exports:** `PRINT_UNAVAILABLE_TEXT` · `OPEN_IN_SAFARI_LABEL` · `printIsBlocked` · `openInSafari` · `printOrExplain` · `explainNoPrint`

### `clock-input.js`
The rules of a TEXT clock box — what counts as a time, what the box shows while one is typed, and what it holds once it is left. Pure, no imports. Every time box in the app is text rather than `<input type="time">`, because Chromium draws that from the OS format settings, so nothing in the browser validates the value and these rules do; one rule for every box (CLAUDE.md → 3-digit time input), and one rule for a filled-in pair of times, which a Shift's and an Other day's writers share. Tested by `clock-input.test.mjs`.
- **Exports:** `isClockTime` · `formatClockInput` · `finaliseClockInput` · `timePairError` · `composeTimedValue`

### `override-utils.js`
The pure override rules shared by the Calendar, Team Week View, Admin and the pay engine: `resolveEffectiveShift`, the ONE ladder every display draws a day from (CLAUDE.md → Change impact); priority and the cache reconcile; the one write shape the rules' `hasOnly()` accepts; what an override says about the contract; the Other-day grammar (OTHER_DAYS.md); and the Sunday rule (`SUNDAY_FORBIDDEN_TYPES` — CLAUDE.md → "Sundays are non-contracted" numbers its layers). Each export's JSDoc carries its reasoning. Tested by `override-utils.test.mjs`; at its `coordinator-ratchet.test.mjs` cap, so extract before adding.
- **Exports:** `nextLeaveYear` · `isRestShift` · `LEGACY_OVERRIDE_TYPES` · `CONTRACTED_WORK_TYPES` · `VOLUNTARY_WORK_TYPES` · `isContractedWorkOverride` · `contractEvidence` · `isOverrideDisplaySuppressed` · `isChristmasOrBoxingDay` · `mergeBookedPeriods` · `tsToMillis` · `isBeforeMemberStart` · `toOverrideRecord` · `collectOverrideRecords` · `buildOverrideWrite` · `buildOverrideCacheRecord` · `nextReplacedType` · `shouldReplaceOverride` · `withOutrankedManualCopies` · `reconcileRangeIntoCache` · `computePeriodDeleteIds` · `OTHER_FLAVOURS` · `OTHER_RDW_DEFAULT_MINS` · `isOtherValue` · `parseOtherValue` · `composeOtherValue` · `resolveOtherPay` · `resolveEffectiveShift` · `SUNDAY_FORBIDDEN_TYPES` · `isForbiddenOnSunday` · `manualCellValue` · `sundaySafeValue` · `chunkByWrites`

### `guide-chips.js`
The "Jump to section" chip bar on all five guides: the jump, the scrollspy, the sticky stack and the deep-link landing. A classic `defer` script with no exports, one copy for all five, wrapped in a function so it shares no globals with `fip-guide.js`; its header and block comments carry each rule. The ⤓ PDF button is `guide-print.js`'s and the ← arrow `guide-back.js`'s. `page-contract-parity.test.mjs` requires every guide to load it once, chips that lead to an id in `<main>`, and no copy of the bar in `fip-guide.js`.
- **Exports:** none

### `fip-guide.js`
The FIP guide's behaviour — a classic `defer` script, all progressive enhancement (with JS off every country is visible): the country finder, opening a country's `<details>` on a jump or deep link, and print — the whole guide as on screen, or one country — prepared so it survives an engine that sends no print events. Loaded after `guide-chips.js`, which draws this guide's chip bar as it does every guide's. Each block's comment carries its rules; the page's own decisions are `.claude/rules/guide-pages.md` → FIP guide. Printing itself is `guide-print.js`'s.
- **Exports:** none

### `guide-print.js`
The ⤓ PDF button on every guide, and the FIP guide's per-country buttons — an ES module all five guides load. One delegated listener routes each press through `printOrExplain` (`print-guard.js`): print, or show the "Open in Safari" notice and tell a page that prepared to undo it. It prepares nothing itself. Only this file prints (`.claude/rules/guide-pages.md`).
- **Exports:** none

### `guide-back.js`
Points a guide's ← arrow at the page you came FROM — a classic `defer` script on all five guides, no exports. `nav-panel.js` appends `?from=<page>`; this resolves it through an allowlist of the app's own pages, never as a url, and leaves the authored href alone otherwise. Why the arrow needs retargeting, and why the hand-kept allowlist is pinned by `page-contract-parity.test.mjs`, are its header. It measures nothing: the sticky stack is `guide-chips.js`'s.
- **Exports:** none

### `legacy-redirect.js`
The one script the two legacy guide addresses (`guide.html`, `fip.html` — `REDIRECT_PAGES`) carry (owner, 10 Nov 2026): on the Pages mirror, which serves no redirects, it goes to the stub's canonical link with the `#fragment` and `?query` kept, replacing the history entry. A classic script, no exports; the meta refresh stays as the no-script fallback, and its header says why it cannot overtake. `page-contract-parity.test.mjs` holds each stub to this one script; `e2e/guides.spec.js` follows an old address to its country and back arrow.
- **Exports:** none

### `ls.js`
Safe `localStorage` wrappers, because iOS Safari's private mode throws on any access — never call `localStorage` directly in a page coordinator (CLAUDE.md). Also the checked writes for a caller about to delete its source, and the request for durable storage. Tested by `ls-persist.test.mjs`.
- **Exports:** `lsGet` · `lsSet` · `lsDel` · `lsSetVerified` · `lsMove` · `lsSetBothVerified` · `lsAvailable` · `lsKeys` · `requestPersistentStorage`

### `storage-keys.js`
The one spelling of every storage key read by MORE THAN ONE file, because a one-character typo loses data silently. A key one module uses stays local to it, and the Pay Calculator's namespace is `pcPrefix()` (`paycalc-migrations.js`), never here. Each key's JSDoc names its writer and its readers, and says why the one sessionStorage key bypasses `ls.js`. `storage-key-parity.test.mjs` holds the shared keys to this file.
- **Exports:** `SELECTED_MEMBER` · `TEAM_VIEW` · `CALENDAR_SNAPSHOT` · `NOTIF_PROMPT_DONE` · `PW_FORCE_PENDING_PREFIX` · `SW_UPDATE_RELOAD`

### `status-text.js`
The leading glyph on a transient status message (`✓`, `⚠`, `✗`, `↻`), kept out of what a screen reader announces — `setStatus` for every status line, from a closed vocabulary — and `speakAfterMount`, which writes into a newly mounted live region only once the browser has drawn it, so the line is heard. The header argues both, including why `el.textContent` still reads back the string passed in and why buttons are out of scope. Tested by `status-text.test.mjs`; `status-glyph-parity.test.mjs` stops a status line being written the old way.
- **Exports:** `STATUS_GLYPHS` · `splitStatusGlyph` · `setStatus` · `speakAfterMount`

### `paycalc-sticky-total.js`
The bar that keeps the Pay Calculator's take-home figure on screen, above the iOS keyboard included. No money, no period, no storage: `calculate()` writes the figure and knows nothing of this module. The show/hide and clear-the-field decisions are pure, and every guard — each the fix to a reported iOS behaviour no headless test reproduces — carries its reasoning in the header. Tested by `paycalc-sticky-total.test.mjs`, and on a page with a stand-in visualViewport by `e2e/paycalc.spec.js`.
- **Exports:** `stickyBarShows` · `scrollToClearBar` · `initPaycalcStickyTotal`

### `paycalc-role-card.js`
What the Pay Calculator says to somebody it will not price, and on its sign-in card. **Words only** — the coordinator still decides who is refused and hides the calculator. Why the words differ by reader (a Dispatcher, a manager, a name the roster no longer holds), and how the sign-in card speaks of the staff PIN, are its header (`.claude/rules/paycalc.md` invariant 13). Tested by `paycalc-role-card.test.mjs` (each message's properties) and `e2e/paycalc.spec.js` (each card on the page).
- **Exports:** `PAYCALC_GUIDE_URL` · `unsupportedRoleCopy` · `paintRoleCard` · `PAYCALC_SIGN_IN_ABOUT`

### `admin-week-swipe.js`
The Admin week grid's swipe gesture and week arrows, which share one cooldown so a swipe and a press cannot both commit: a pointer state machine and a carousel holding no business rule — what a week change means stays in `admin-app.js` behind its callbacks. Why it is not shared with `calendar-swipe.js`, and its two standing rules (Pointer Events, never Touch Events — CLAUDE.md; `setPointerCapture` on the grid — `.claude/rules/admin.md`), are its header. Driven by `e2e/admin.spec.js`.
- **Exports:** `initAdminWeekSwipe`

### `overtime-review-controller.js`
The reviewer's side of `overtime.html`: the planning horizon, the week selection, the detail workspace, the grade and day lenses, the creation preview and the confirm bar. The invariant it owns — its state agrees about which week is on screen, and with nothing else on the page — and each piece of state that keeps it are its header. It renders through `overtime-manager.js` and reads through `overtime-data.js`; session, identity, tabs and the member's form stay with `overtime-app.js`. Overtime is paused (`docs/OVERTIME_AVAILABILITY.md` → Paused). Tested by `overtime-review-controller.test.mjs`.
- **Exports:** `createReviewController`

### `links-design-library.js`
The Links workspace's design LIBRARY — the import panel, the Recently deleted bin and Keep only the shortlist: managing the collection, apart from editing the open design. Every write goes through the design store and every rule through its own module; the small context it takes, and why rename, duplicate and delete stay in `links-app.js`, are its header (`.claude/rules/links-design.md` → The module set, Deletion). Tested by `links-design-library.test.mjs`.
- **Exports:** `createDesignLibrary`

### `links-design-store.js`
The link-design collection's persistence lifecycle and its concurrency protocol: every design write, and the refresh's read. Every Firebase handle is injected, so the interleavings can be forced against a fake Firestore. Its six rules — reads inside the write's transaction, no weaker fallback online, only a verified baseline, queued writes that never collide, a transaction that waits for this device's own queue, and a queued save that says how it ended — are its header (`.claude/rules/links-design.md` → Concurrency, invariant 5). No DOM and no dialogs: a conflict comes back and the workspace decides. Tested by `links-design-store.test.mjs`.
- **Exports:** `isOfflineFailure` · `createDesignStore`

### `links-queued-saves.js`
The Links saves only THIS BROWSER's queue holds until the server answers: which copy is kept as the unsaved-work draft, on which baseline, whether an answer still counts, and whether the server ever made the design. Pure — no DOM, no Firebase, no storage; `links-app.js` owns what the page shows. Its seven rules are its header (`.claude/rules/links-design.md` → Concurrency, store rule 6). Tested by `links-queued-saves.test.mjs`, end to end in `e2e/links.spec.js`.
- **Exports:** `createQueuedSaves` · `refusedMakeLine` · `stillUnsaved`

### `upload-commit.js`
What an AMBIGUOUS Firestore commit means after a document upload: `deadline-exceeded` can arrive after the server committed, and the live document has more than one writer. One pure verdict, `resolveUploadCommit`, resolved by READING — and a failed read is never permission to write. The race it closes and why an orphaned file is the cheaper outcome are its header. Asked by `documents-client.js`; tested by `upload-commit.test.mjs`.
- **Exports:** `resolveUploadCommit`

### `doc-retention.js`
The six-month sweep behind Circular and Newsletter uploads — the browser's only destructive operation on shared data, run by `documents-client.js` after each upload. Its two rules are its header: the clock must be the server's, and delete only what you read; its right long-term home is a scheduled Cloud Function. Every Firebase handle is injected, so `doc-retention.test.mjs` replays the races against fakes.
- **Exports:** `pruneOldDocs`

### `analytics-client.js`
The Firestore I/O behind the admin's two read-outs of the app itself — the client error log and the anonymous usage and speed counters. A factory with every handle injected, so it loads in Node; `firebase-client.js` builds it once and re-exports each function. It decides nothing: ordering and retention are `client-errors.js`, windows and summaries `usage-stats.js` and `perf-stats.js`, and who counts is `usage-reporter.js`. Its header holds three properties: no identity in a counter, telemetry never affects the app, and prunes cut off by the server's clock. Tested by `analytics-client.test.mjs` against a fake Firestore.
- **Exports:** `buildAnalyticsClient`

### `own-password.js`
Re-authenticating with, and changing, the signed-in member's OWN password — the two calls Settings → Password and the forced change (`password-force.js`) make. A factory with every Firebase handle injected, so it loads in Node; `firebase-client.js` builds it once and re-exports both. The properties an edit can break — the candidate ladder that stops on a transient failure, a changed password never reported as unchanged, and nothing sent unless the signed-in account is the page member's own — are its header. It also holds the save sequence both password surfaces run (`runPasswordSave`: re-auth, then a separately timed, counted write that may answer "pending") and the one `SAVE_TIMEOUT_MS`. Tested through the real `firebase-client.js` by `firebase-client.test.mjs`, the sequence by `password-force.test.mjs`.
- **Exports:** `buildPasswordClient` · `SAVE_TIMEOUT_MS` · `withTimeout` · `settleOrTimeout` · `runPasswordSave`

### `account-calls.js`
The browser's side of three ACCOUNT endpoints — the admin's Reset, the provisioning audit (which also carries the staff PIN lockout) and the locked-out member's reset request. A factory with `auth` injected, so it makes no import cycle; `firebase-client.js` builds it once and re-exports the three. Its one rule: a deadline above each endpoint's own, and a WRITE that times out says it may still have happened. Tested through the real `firebase-client.js` by `firebase-client.test.mjs`.
- **Exports:** `RESET_NOT_SENT` · `buildAccountCalls`

### `documents-client.js`
The three date-keyed document collections — Daily Huddle, Weekly Retail Circular, Marylebone Newsletter — and the upload sequence behind them. A factory with every Firebase handle injected, so its failure orderings can be forced against fakes; `firebase-client.js` builds it and re-exports each function. It owns the sequence, and the decisions are `upload-commit.js`'s and `doc-retention.js`'s. Its one invariant — a live document never points at a file that is not there — and each step that keeps it are its header. The Huddle listener stays a live `onSnapshot` (`.claude/rules/pwa.md`). Tested by `documents-client.test.mjs`.
- **Exports:** `assertFileSignature` · `buildDocumentClient`

### `firestore.rules`
The server-side Firestore security rules, and the authority on access (what the fields mean is `docs/DATA_MODEL.md`). Every access asks a CLAIM, never a bare session — `AUTH_AND_SESSIONS.md` 9, held by `rules-claim-gate.test.mjs` — and the header's audit table says what each identity gets from each collection: re-read it whenever an identity is added. Deployed by `deploy-rules.yml`; a field a client starts writing ships rules-first (CLAUDE.md → Workflows). Verify with `npm run test:rules` and `firestore-contract-parity.test.mjs`.

### `storage.rules`
The Firebase Storage rules for the three document folders — `huddles/`, `circulars/`, `newsletters/` — admin-only to read, write and delete, at most 20 MB (`MAX_FILE_BYTES` in `functions/index.js` must match) and PDF or Word only; every other path is denied. Staff never open a file through these rules: the short-lived signed url and the stored url both bypass them. Verify with `npm run test:rules`.

### `index.css` / `admin.css` / `paycalc.css` / `operations.css` / `settings.css` / `links.css` / `overtime.css` / `trains.css` / `newlink.css`
Each app page's own stylesheet, linked after `shared.css`: a visual change specific to one page goes here, and anything two pages share goes in `shared.css`. Served from the service worker's version cache like the app's JS. Tokens, surfaces and the recipes are `.claude/rules/css-tokens.md`; a raw hex colour fails `css-hex-parity.test.mjs`.

### `guide-shell.css`
The shared chrome of the five guide pages, linked first on each: the sticky header, the chip bar, the section heading and link style, the footer, the print rules, the Inter `@font-face` and the guides' palette tokens. Change guide chrome here once. The guides do not load `shared.css`, so a rule added only there never reaches them. Full specification: `.claude/rules/guide-pages.md`.

### `guide-doc.css`
The shared styles of the two document-style guides (`staff-guide.html`, `paycalc-guide.html`), loaded between `guide-shell.css` and each page's own CSS: the content wrapper, the two-column print layout, the boxes, numbered steps and tables. A change reaches both guides, so check both in print preview.

### `staff-guide.css` / `paycalc-guide.css` / `railcard-guide.css` / `fip-guide.css` / `rangers-guide.css`
Each guide page's own stylesheet, linked after `guide-shell.css` (and after `guide-doc.css` on the two document guides). A visual change specific to one guide goes here; the rules per guide are `.claude/rules/guide-pages.md`.

### `purify.es.mjs`
Self-hosted DOMPurify, vendored — replaced on an upgrade, never edited — which sanitises the Huddle's HTML; its version is its licence line. Lazy-imported by `calendar-huddle-viewer.js`, whose comment beside the import has the upgrade steps (re-adding the `// @ts-nocheck` first line among them). Precached by the service worker, so sanitising works offline.

### `shared.css`
The CSS every app page shares (the guides load none of it): the `:root` tokens — colours, surfaces, motion, the type scale, and `--font-sans` with the self-hosted Inter — and the shared components, from `.app-header` and the drawer to the lightboxes, buttons, pills, `.touch-only` and the shared `@media print` rules. Never hardcode a hex colour (`css-hex-parity.test.mjs`). Tokens, surfaces, motion, the header and the control recipes: `.claude/rules/css-tokens.md`.

### `service-worker.js`
The offline-first service worker: the version-named cache, the update lifecycle, the offline fallback and the notification tap. The caching strategy is its header and `.claude/rules/pwa.md`; the deep-link allowlist, `SAFE_NOTIFICATION_PAGES`, is `.claude/rules/notifications.md` → Deep link. `APP_VERSION` is written only by `npm run bump`. Tested by `sw-asset-check.test.mjs`; line-capped in `coordinator-ratchet.test.mjs`.
- **Exports:** none

### `roster-cycle-data.js`
The raw roster cycles — `weeklyRoster`, `bilingualRoster`, `fixedRoster`, `cesRoster`, `dispatcherRoster` — and `FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS`: pure data, no imports, re-exported by `roster-data.js`. App code reads a shift through `getBaseShift`, never from a pattern, and `validateRosterPatterns` in `roster-data.js` checks every cell. A pattern has no start date and a fixed pattern is shared, so read `.claude/rules/roster-data.md` before editing one; `roster-data.test.mjs` pins every week.
- **Exports:** `weeklyRoster` · `bilingualRoster` · `fixedRoster` · `FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS` · `cesRoster` · `dispatcherRoster`

### `roster-member-data.js`
The roster's PEOPLE — `teamMembers`, one entry per member, no logic and no imports — in a file of its own because its length tracks headcount. Re-exported by `roster-data.js`, where every consumer reads it. **World-readable**: a field added here is published the moment it ships, and `public-data-classification.test.mjs` fails on an unclassified one. Field reference: `.claude/rules/roster-data.md`; adding or removing somebody: `/new-starter`, `/leaver`.
- **Exports:** `teamMembers`

### `pay-audience.js`
WHO the Pay Calculator is for, judged by the grade held AT THE TIME (owner, 16 Nov 2026), so a member promoted out of a priced grade keeps the payslips they earned in it. Pure, and its own module so the Calendar's notices can ask without loading the Pay Calculator. Bound by `.claude/rules/paycalc.md` invariant 13; tested by `pay-audience.test.mjs`.
- **Exports:** `pricedGradeOn` · `heldPricedGrade` · `payCalculatorPrices`

### `roster-roles.js`
A member's GRADE ON A DAY: `role` is the grade now, and `roleHistory` dates the grades held before it. Pure, no imports, and the one reader of the pair — asked by the Pay Calculator, which prices each payslip by the grades over its days, and by the leave allowance (`allowanceRole`, `al-contract.js`). The procedure is OPERATIONS_REFERENCE.md → "A member changes grade"; tested against the real rows in `roster-data.test.mjs` ("A GRADE ON A DAY").
- **Exports:** `roleOn` · `rolesInRange`

### `functions/index.js`
The COMPOSITION ROOT of the Cloud Functions: its exports are the deploy surface, pinned by `functions-surface.test.mjs`. It holds the shared infrastructure every domain builder is handed — the secrets, `VAPID_PUBLIC_KEY` (which must match `notif.js`), `STAFF_SITE_URL`, `ADMIN_FUNCTION_ORIGINS`, the size caps — and keeps two endpoints of its own: `parseRosterPDF` (contract `.claude/rules/roster-import.md`) and `unlockCalendarViewer` (its rules are `functions/calendar-viewer-auth.js`). Both are executed by `index-endpoints.test.mjs`.
- **Exports:** `parseRosterPDF` · `unlockCalendarViewer` · and every endpoint `buildDocumentEndpoints`, `buildAuthEndpoints` returns

### `index-endpoints.test.mjs`
Drives the two handlers `functions/index.js` keeps — `parseRosterPDF` and `unlockCalendarViewer` — for real, so the wiring is tested and not only the rules (CLAUDE.md → "The rule tested, the wiring not"). The fakes enter `require.cache` before `index.js` is required, every fake records, and the blocks are organised by what a wrong answer costs; its header names the mutations it was checked against. Runs in `npm run test:functions`.

### `functions/documents.js`
The document-and-notification domain, built by `buildDocumentEndpoints` from the infrastructure `index.js` hands it: `getDocumentUrl` (the short-lived document url — the caller names a kind, never a path), `rotateDocumentLinks`, `ingestHuddle` (built from `huddle-ingest.js`), the three document-arrival triggers, and the scheduled pay, timetable and Error Log notices. `HUDDLE_PUSH_PAUSED` lives here. Every notice follows `.claude/rules/notifications.md`; tested by `documents-endpoints.test.mjs`.
- **Exports:** `buildDocumentEndpoints`

### `functions/huddle-ingest.js`
`ingestHuddle`, the Daily Huddle upload from Power Automate, server to server (bearer `HUDDLE_SECRET`): it checks the file, converts a DOCX to HTML, stores it, writes the record in a transaction, announces a new latest Huddle, and awaits the three-month prune (`huddle-retention.js`). Built by `documents.js`, which keeps the latest-of-kind question and the Huddle send beside `HUDDLE_PUSH_PAUSED`. Tested by `documents-endpoints.test.mjs`.
- **Exports:** `buildIngestHuddle`

### `functions/pay-reminder.js`
WHO the pay reminder reaches — CEA and CES members only (owner decision, 10 Nov 2026), the grades the Pay Calculator prices — and the targeted send, which fails closed. The audience comes from the server-owned roster, never a request; the schedule that decides WHEN stays in `documents.js`. Tested by `documents-endpoints.test.mjs`, which takes its expected audience from `gradeForRole`.
- **Exports:** `PAY_REMINDER_GRADES` · `payReminderMembers` · `sendPayReminder`

### `functions/error-log-notify.js`
The admin's Error Log notification, SENT: run every fifteen minutes by `sendErrorLogNotification` (`documents.js`), it reads its record in `errorLogNotice`, counts what is new and tells the admin's devices only (`admin-recipients.js`). The header says why it is a schedule rather than a trigger, and what the record holds; the rules are `error-log-notice.js`. Tested by `error-log-notify.test.mjs`.
- **Exports:** `notifyAdminOfErrorLog`

### `functions/error-log-notice.js`
The RULES of the admin's Error Log notification — which entries count as new, what the notice says (counts only: a push renders on a lock screen) and when one may be sent. Pure, no Firebase; the header lists the six rules. The sender is `error-log-notify.js`. Tested by `error-log-notice.test.mjs` in the no-install lane, the words through the real `buildPushPayload`.
- **Exports:** `DIAGNOSTIC_PREFIX` · `NOTICE_GAP_MS` · `NOTICE_SCAN_LIMIT` · `isSlowSave` · `noticeDue` · `summariseNewEntries` · `noticeWords`

### `functions/huddle-retention.js`
How long a Daily Huddle is kept (`HUDDLE_RETENTION_MONTHS`) and what its clean-up may delete: only what it selected, and an orphan only when it is old and unnamed. It owns no endpoint; `ingestHuddle` awaits it at the end of every upload, handing in Firestore, the bucket and the London clock. Tested through the ingest by `documents-endpoints.test.mjs`, uploads landing mid-sweep included.
- **Exports:** `pruneOldHuddles` · `sweepHuddleOrphans` · `HUDDLE_RETENTION_MONTHS` · `HUDDLE_ORPHAN_MIN_AGE_MS`

### `functions/auth-endpoints.js`
The account-and-credential domain, built by `buildAuthEndpoints`: `setupRosterAuth` (accounts and claim tiers from the server-owned roster, and the leaver sweep) and `resetMemberPassword` (the admin break-glass, each stage reported on its own). It also builds the reset-request doorbell (`reset-request.js`; its kill switch `RESET_REQUESTS_ENABLED` stays here) and the two admin reads (`account-reads.js`). The pure decisions are `roster-parse-helpers.js`, `member-identity.js` and `account-lifecycle.js`. Contract `docs/AUTH_AND_SESSIONS.md`; tested by `auth-endpoints.test.mjs`.
- **Exports:** `buildAuthEndpoints`

### `functions/account-reads.js`
The account domain's two admin READS, which change nothing: `getSignInStats` (four integers, no identity) and `getAccountSetupGaps` (NAMES, grouped by remedy, and the staff PIN's lockout). Also `listAllUsers`, the one account-list loop the leaver sweep shares. Built by `buildAuthEndpoints`; the judgements are `summariseSignIns` and `summariseAccountGaps`. Tested through the handlers by `auth-endpoints.test.mjs`.
- **Exports:** `buildAccountReadEndpoints` · `listAllUsers`

### `functions/admin-recipients.js`
WHO a notice for the admin may reach — one rule for the reset-request doorbell, the Error Log notice and the PIN lockout notice: each admin name's own account, enabled and carrying the `admin` claim, and nobody in its place. Tested through its three senders (`auth-endpoints.test.mjs`, `error-log-notify.test.mjs`, `pin-lockout.test.mjs`).
- **Exports:** `enabledAdminUids`

### `functions/account-lifecycle.js`
The pure rules Set up accounts and the admin reset apply at the edges of an account's life: whether a failed password write proves nothing changed and what the admin is then told, which elevated claims a re-stamp takes away, and which leavers are already disabled. The header carries the reasoning; `auth-endpoints.js` is the orchestration. Tested by `account-lifecycle.test.mjs` and, through the real handlers, `auth-endpoints.test.mjs`.
- **Exports:** `passwordWriteRefused` · `unwrittenResetAnswer` · `elevatedClaimsLost` · `ELEVATED_CLAIMS` · `disabledLeaverUids` · `sweepAgainstPreview`

### `functions/reset-request.js`
`requestPasswordReset`, the public doorbell a locked-out member rings — one of the two unauthenticated endpoints: it records the request, never resets anything, and tells the admin's devices only. Built by `buildAuthEndpoints`, which hands in the kill switch. The header says how the abuse surface is bounded; the throttle, the coalescing window and the notice's words are `roster-parse-helpers.js`'s. Tested through the real handler by `auth-endpoints.test.mjs`.
- **Exports:** `buildResetRequestEndpoint`

### `functions/calendar-viewer-auth.js`
The PURE server rules behind the staff Calendar PIN, kept apart from `req`/`res` so they can be tested: the PIN compare, the throttle (read `DEFAULT_THROTTLE`'s comment before changing a number), charging an attempt before its compare, the guards on the shared viewer account, and the station-wide lockout record. The PIN is never learnt, stored, logged or returned. Tested by `calendar-viewer-auth.test.mjs`; the uid and claim agreement across the browser, CommonJS and `firestore.rules` is `calendar-viewer-parity.test.mjs`.
- **Exports:** `CALENDAR_VIEWER_UID` · `PIN_LENGTH` · `DEFAULT_THROTTLE` · `GLOBAL_SOURCE_KEY` · `GLOBAL_THROTTLE` · `isValidPinShape` · `pinMatches` · `sourceKeyFor` · `clientIpOf` · `throttleDecision` · `recordFailure` · `reserveAttempt` · `refundAttempt` · `isThrottleStateStale` · `viewerClaims` · `viewerAccountTamper` · `isViewerAccount` · `LOCKOUT_RECORD_KEY` · `LOCKOUT_ALERT_GAP_MS` · `LOCKOUT_RECENT_MS` · `noteGlobalBlock` · `lockoutSummary` · `lockoutNoticeWords`

### `functions/pin-lockout.js`
The staff-PIN throttle store's upkeep after a wrong PIN, and telling the admin when the station-wide block trips: the time-boxed sweep, the lockout record (`viewerAttempts/_lockout-record`) and the once-a-day notice. Best-effort throughout — nothing here may change the 401. Every rule it asks is `calendar-viewer-auth.js`'s. Tested by `pin-lockout.test.mjs` and, through the handler, `index-endpoints.test.mjs`.
- **Exports:** `LOCKOUT_NOTICE_BUDGET_MS` · `SWEEP_BUDGET_MS` · `sweepExpiredThrottleRows` · `buildPinLockoutNotifier` · `noteStationBlock` · `readPinLockout`

### `functions/push.js`
The web-push TRANSPORT: how a payload reaches a phone, never what it says or when (`buildPushPayload` in `push-notices.js`; `.claude/rules/notifications.md`). The two senders — `fanOutPush` to every device, and `sendTargetedPush`, which fails closed — each feature's TTL, the dead-subscription clean-up, and `releasePushForOwner`. Tested by `push-transport.test.mjs`.
- **Exports:** `getWebPush` · `setupWebPush` · `sendTargetedPush` · `fanOutPush` · `releasePushForOwner` · `pushSendOptions` · `PUSH_TTL_BY_TAG`

### `functions/push-notices.js`
The push notification DESIGN LANGUAGE (`.claude/rules/notifications.md`): `NOTIFICATION_FEATURES`, one row per notifying feature, and `buildPushPayload`, the only way a payload is built. Pure. `roster-parse-helpers.js` re-exports both for the older senders; a new sender imports from here. Tested through the re-export by `roster-parse-helpers.test.mjs`, and by every handler test that sends a push.
- **Exports:** `NOTIFICATION_FEATURES` · `buildPushPayload`

### `functions/roster-geometry.js`
What the roster PDF's OWN GRID says about where each cell is, and the one refusal that follows — the only check in the import the model cannot influence. The only code that touches pdfjs, which is pinned exactly (the header says why, and what a version change breaks silently); it never throws, failing open with a reason. Contract `.claude/rules/roster-import.md`; tested by `roster-geometry.test.mjs` through the REAL pdfjs.
- **Exports:** `settledGeometry` · `GEOMETRY_WAIT_BUDGET_MS` · `GEOMETRY_WORK_BUDGET_MS` · `awaitGeometryWithin` · `GRID_COLUMNS` · `rulesFromOperatorList` · `assignRunsToGrid` · `readGridPage` · `extractRosterGeometry` · `matchGeometryRow` · `geometryCoverage` · `applyGeometryWitness` · `_isClaim` · `_nameTokens` · `_PATH_OP`

### `functions/roster-other-days.js`
What a roster cell reads as when it names an Other-family day (OTHER_DAYS.md): the recognition side of the client grammar, duplicated because CommonJS cannot import a browser module, and asked by `normaliseShift` before any time is read. A meeting is always a meeting, times and all (owner decision). Contract `.claude/rules/roster-import.md`; tested by `roster-parse-helpers.test.mjs`, `index-endpoints.test.mjs` and `roster-prompt-parity.test.mjs`.
- **Exports:** `OTHER_DAY_ALIASES` · `readOtherDayCell` · `meetingWithTimes` · `namesMeeting`

### `functions/roster-sunday-repair.js`
Layer 1 of the day-drift defence — the Sunday-anchored repair (`applySundayScanCorrections`) — and what becomes of a Sunday it could not repair (`settleDisputedSundays`). The header carries the three rules the review left behind. Contract `.claude/rules/roster-import.md`; the wiring is pinned by `index-endpoints.test.mjs`, the rules by `roster-parse-helpers.test.mjs`.
- **Exports:** `applySundayScanCorrections` · `settleDisputedSundays`

### `functions/roster-week-heading.js`
Layer 4 of the day-drift defence: the week the roster's own printed text SAYS it is for, and the 409 when that is not the week chosen on the upload form — no model involved, and never a guess either way. Contract `.claude/rules/roster-import.md`; tested by `roster-geometry.test.mjs` and, through the handler, `index-endpoints.test.mjs`.
- **Exports:** `weekEndingsOnPage` · `checkSheetWeek`

### `functions/roster-prompt.js`
The two roster-parse prompts, the ONE code table they share (`SHIFT_VOCABULARY`), and how the model is asked (`MODEL_REQUEST`). It builds the phase-2 cell table — all or nothing per document — and the two review rules for an empty read of a filled cell and a rest read of an empty one. Contract `.claude/rules/roster-import.md`; tested by `roster-cell-read.test.mjs` and `roster-prompt-parity.test.mjs`.
- **Exports:** `DAY_LABELS` · `SHIFT_VOCABULARY` · `buildCellTable` · `renderCellTable` · `buildCellPrompt` · `reviewBlankReadsOfFilledCells` · `reviewRestReadsOfEmptyCells` · `repeatedMembers` · `MODEL_REQUEST` · `DECLINED_ERROR`

### `functions/roster-parse-helpers.js`
Pure helpers for the Functions — no Firebase, no HTTP, no secrets — required across `functions/`: reading a roster cell (`normaliseShift`) and the parse layers, file signatures, the CommonJS credential twins of `auth-identity.js`, the push guards and the account decisions. Its `module.exports` block is the list. Read `.claude/rules/roster-import.md` before changing a parse helper. Line-capped; tested by `roster-parse-helpers.test.mjs`.
- **Exports:** `shouldDeleteSubscription` · `isAllowedPushEndpoint` · `PUSH_SERVICE_HOSTS` · `normaliseShift` · `fileSignatureMatches` · `buildWeekDates` · `extractAIJson` · `HEADER_TO_INDEX` · `headerToDayIndex` · `mapColumnHeadersToDates` · `memberRows` · `buildSafeEntries` · `BLANK_CELL_TOKEN` · `isPhysicallyBlank` · `applyColumnScanCrossCheck` · `normaliseScanValue` · `reviewLabel` · `parseStrictIsoDate` · `isPayCutoffDay` · `nameToEmail` · `nameToPassword` · `surnameCore` · `NOTIFICATION_FEATURES` · `buildPushPayload` · `parseSetupActionFlags` · `resolveRosterAuthConfig` · `claimsForTier` · `computeOrphanLabels` · `summariseAccountGaps` · `shouldRecordResetRequest` · `buildResetRequestNotice` · `shouldNotifyAdmin` · `summariseSignIns`

### `calendar-notif-prompt.js`
The Calendar's one-off notification prompt strip (`#notifPrompt`) and the silent renewal for a device that already granted permission — for a named session only, never the shared PIN viewer. The header pins the two orderings an edit must keep. Wired by `calendar-app.js` before `install-prompt.js`, which outranks it. Decisions: `.claude/rules/calendar.md`; tested by `calendar-notif-prompt.test.mjs`.
- **Exports:** `initNotifPrompt`

### `install-prompt.js`
The one-off "add the roster to your home screen" strip on the Calendar, and what the install notice asks through (`installRoute`, `promptInstall`). It shares the notification strip's slot and outranks it, and it is never offered to the PIN viewer, inside the installed app or on the Pages mirror; the header argues each, and the limit it deliberately does not rescue. Tested by `install-route.test.mjs`.
- **Exports:** `installRoute` · `promptInstall` · `yieldToInstallNotice` · `releaseInstallNoticeYield` · `retireInstallStrip` · `installNoticeHasTheVisit` · `initInstallPrompt`

### `text-scale.js`
How much larger than the stylesheet's sizes the phone draws its text — Android's text scaling, which no width query can see — and the two-tier `data-text-scale` stamp the Calendar's control rows key on. It cannot throw: `calendar-app.js` calls it at module scope. Tested by `text-scale.test.mjs`; the probe itself in `e2e/calendar.spec.js`.
- **Exports:** `LARGE_FROM` · `COMPACT_FROM` · `LARGE_VALUE` · `COMPACT_VALUE` · `tierFor` · `measureTextScale` · `applyTextScale`

### `calendar-doc-access.js`
May this Calendar read the three documents? They are behind the staff PIN or a password (owner decision), and this makes the client honour it, because a read the local cache can answer never consults the rules. It keeps no answer of its own — it reads and listens to `calendar-access-state.js` — and tells its subscribers only when the answer changes. Tested by `calendar-doc-access.test.mjs`.
- **Exports:** `hasDocumentAccess` · `onDocumentAccess` · `documentAccess` · `_clearDocumentSubscribersForTests`

### `calendar-access-state.js`
Is Calendar access held right now? The ONE copy: written only by `calendar-access.js` and the roster gate, read by the roster gate and the document gate, so no route that loses access can shut one and leave the other. No imports. Decisions: `.claude/rules/calendar.md`; tested by `calendar-access-state.test.mjs`, which counts every call of the write.
- **Exports:** `hasCalendarAccess` · `grantNumber` · `setCalendarAccess` · `onCalendarAccess`

### `calendar-redraw.js`
WHEN the Calendar page may draw, and what its next draw owes: one scheduler, created by `calendar-app.js`, that decides when and on which surface — the start-up stages, the one wait for a swipe, the focus owed to the next grid — and draws nothing itself. Decisions: `.claude/rules/calendar.md`; tested by `calendar-redraw.test.mjs` and the `redraw:` tests in `e2e/calendar.spec.js`.
- **Exports:** `GESTURE_POLL_MS` · `START_STAGES` · `createRedrawScheduler`

### `calendar-drawer.js`
The Calendar's menu (the shared drawer), built for the SAVED session — never the picked name — when it is built, and able to be built again for whoever is signed in now, with the same page hooks. The rebuild runs when a lock card's sign-in is granted without a reload (`finishSignIn`, through the page's `onSignedInInPlace`). Tested by `calendar-drawer.test.mjs` and the menu-rebuild test in `e2e/calendar-pin.spec.js`.
- **Exports:** `calendarDrawerOptions` · `wireCalendarDrawer` · `rewireCalendarDrawer`

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
