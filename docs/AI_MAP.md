# AI_MAP.md — Claude routing guide for Marylebone Roster

*Last updated: November 2026 — v26.90 · Updated every 0.10 version*

Use this file to decide which source file to read or edit for a given task.
Read CLAUDE.md first for project identity, version bumping rules, and architecture constraints.

## What an entry holds

**What a module IS is its one line in `docs/FILE_INDEX.md`** — its purpose, the rule file or contract
that binds it, and the tests that guard it. This map holds the two things FILE_INDEX does not: the
**Quick decision table** below (task → file), and each module's **export list**, under its own `###`
heading, **generated** by `npm run generate:ai-map` from the code (`scripts/ai-map-lib.mjs`).
Never edit an export line by hand; `doc-parity.test.mjs` fails a stale one.

Until 25 Nov 2026 every entry also carried a hand-written card restating its FILE_INDEX row; the cards
went (git holds them), and every reference a card held that the row and the module's header lacked moved
into the row. **The reasoning is the module's own header and JSDoc**; release history is git log
(CLAUDE.md → "Current file structure", the three homes). The few entries that are not one module (the
reset-request queue, the rules files, the stylesheets) keep a short note, capped by `doc-parity.test.mjs`.

**Adding a module:** give it a FILE_INDEX row, add its `### \`name.js\`` heading under the section
below, and run `npm run generate:ai-map`.

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
| Calendar keyboard navigation, the page shortcuts and hover tooltip | `calendar-keyboard.js` |
| Calendar month/year jump picker (from the month heading) | `calendar-month-jump.js` |
| Calendar override cache | `calendar-overrides.js` |
| What the Calendar knows about each month, and so what it may show | `calendar-data-state.js` |
| The Calendar's access gate, the cards that stand in for it, and its pure rules | `calendar-access.js` · `calendar-lock-cards.js` · `calendar-lock-slot.js` · `calendar-access-core.js` |
| The member's own roster kept on the device, shown labelled before the sign-in check finishes | `calendar-snapshot.js` · `calendar-own-copy.js` (when it is shown and kept) |
| The Calendar page's one-time notices (which are live: the new-notice skill → "Current notices") | `calendar-notices.js` |
| Calendar member selection | `calendar-member.js` |
| The phone's text scale, measured rather than asked, for the Calendar's control rows | `text-scale.js` |
| Calendar rendering — the grid, the header and the day cells, and what a month shows (`monthOnScreen`) | `calendar-renderer.js` |
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
| Override priority, member start, rest shifts, the shared display ladder (`resolveEffectiveShift`), the Sunday rule, the training value grammar and its pay resolver | `override-utils.js` (the grammar and its pay resolver: `other-day.js`, re-exported) |
| Body scroll lock, overlay history, focus trap, the lightbox lifecycle, the in-app dialogs, card collapse | `overlay.js` (the Back stack: `overlay-history.js`; the Tab trap: `overlay-focus.js`; the scroll fade and pinned ✕: `overlay-panel-scroll.js`) |
| About panel content (version, update status, bug link, print button) | `about-lightbox.js` |
| Per-card ? tips lightbox lifecycle/renderer (content data stays per page) | `tips-lightbox.js` |
| The roster words, one line each ("Words used in the app"), and which ? panels link to them | `glossary.js` (shown by `tips-lightbox.js`) |
| Service worker registration + update lifecycle (every app page) | `sw-register.js` |
| Auth/session helpers — the local session and re-establishing Firebase on load | `session.js` |
| Admin portal UI, login, AL, sick, overrides, module wiring | `admin-app.js` (+ `admin-boot.js`) + `admin.html` |
| Settings page — Password, Work email, Notifications, Install, Pay Calculator data | `settings-app.js` + `settings.html` (Password: `settings-password-card.js`; Install: `settings-install-card.js`; `?` panels: `settings-tips.js`) |
| Nav-panel footer initials badge | `nav-panel-markup.js` + `avatarInitials`/`avatarHue` in `roster-data.js` |
| Operations page — Huddle upload, Roster upload, Staff Login Accounts | `operations-app.js` + `operations.html` (the Circular and Newsletter cards' configuration: `operations-doc-uploads.js`) |
| Error Log card (ops page) — uncaught error capture, the card, Copy for Claude | `error-reporter.js`, `firebase-client.js`, `client-errors.js` (ordering/retention policy), `operations-errors.js`, `operations.css` · the admin's phone told of new entries: `functions/error-log-notify.js` (the rules: `functions/error-log-notice.js`) |
| Usage card (ops page) — anonymous page popularity + active-account counts | `usage-reporter.js`, `firebase-client.js`, `usage-stats.js` (date/aggregation maths), `operations-usage.js`, `operations.css`, `firestore.rules` (`analytics`) |
| Document links card (ops page) — a new key for every stored Huddle, Circular and Newsletter file, so every old copy of a link stops working | `operations-doc-links.js` (the card) · `functions/documents.js` (`rotateDocumentLinks`, the endpoint) · `functions/doc-link-rotation.js` (the rules) |
| Annual leave sheet card (ops page) — the clerks' workbook checked against the app, day by day, and the leave it is missing added for the people the admin confirms | `operations-al-sheet.js` (the card) · `operations-al-save.js` (the Save's answers, confirmations, receipt and Undo) · `al-leave-file.js` (the leave file and its seal) · `al-leave-compare.js` (each day, by the app's own leave rules) · `al-leave-plan.js` (what a Save would write, and its log) · `al-leave-save.js` (the Save, the log and the Undo, against Firestore) · `al-leave-words.js` (every sentence) · the file is made in a session by `scripts/make-leave-file.mjs` · decisions `docs/DECISIONS.md` → The annual leave uploader |
| Links design workspace — the rotation design grid (`ROTATING_LINES` lines), paint mode, hourly coverage heat map, design checks, the generator (Build a link) | `links-app.js` + `links.html` + `links.css`; the grid `links-grid.js`, the paint bar `links-brush-bar.js`, the window editor `links-window-editor.js`, the Build press `links-build-button.js` |
| Link-design maths — shift classification, custom-time validation, coverage counting (per-type + hour-by-hour), the rest between two duties, design quality checks | `links-design.js` (pure — no DOM/Firebase, imports nothing; tested by `links-design.test.mjs`) |
| The link generator — the two constructions, the contract gate, the minimum-rest repair | `links-generate.js` (pure; imports its constants from `links-design.js`; tested by `links-design.test.mjs` and `links-contract.test.mjs`) |
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
| Navigation panel — burger menu, slide-out drawer, Information links, footer bell | `nav-panel.js` (what it lists: `nav-destinations.js`; its HTML: `nav-panel-markup.js`; its two lightboxes: `nav-drawer-lightboxes.js`; the document rows: `nav-latest-doc.js`; the bell: `nav-bell.js`; the Reference fold: `nav-guide-fold.js`) |
| Whether the ☰ menu offers the Marylebone Newsletter — only while its latest issue is under six weeks old | `newsletter-recency.js` (the Calendar asks once a load; the drawer reads the answer this device keeps) |
| Push notification subscribe/unsubscribe, VAPID key, notification state (shared) | `notif.js` |
| Firestore security rules — write isolation, field validation, admin bypass | `firestore.rules` |
| Shared CSS — colours, typography, badges, layout | `shared.css` |
| Service worker — caching strategy, version bump | `service-worker.js` |
| Firebase init and Firestore helpers | `firebase-client.js` |
| localStorage wrappers | `ls.js` |
| Cross-file localStorage key constants | `storage-keys.js` |
| Cloud Functions — the composition root (`functions/index.js`); documents (`functions/documents.js`), the Huddle ingest (`functions/huddle-ingest.js`), the Huddle's retention (`functions/huddle-retention.js`); accounts (`functions/auth-endpoints.js` with `functions/account-lifecycle.js` and the account rules `functions/account-rules.js`, the reset-request doorbell `functions/reset-request.js` and its rules `functions/reset-request-rules.js`, and the retired PIN's shared account, `functions/retired-viewer-account.js`); push (`functions/push.js`, its transport guards `functions/push-guards.js`, and what every payload looks like, `functions/push-notices.js`); the deploy region (`functions/region.js`, and the browser's address of every function, `function-url.js`); the pay reminder's audience (`functions/pay-reminder.js`), the one-off New link push (`functions/newlink-reminder.js`) and the admin's Error Log notification (`functions/error-log-notify.js`, its rules `functions/error-log-notice.js`) | `functions/index.js` |
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
- **Exports:** `APP_VERSION` · `CONFIG` · `teamMembers` · `isWorkedShift` · `gradeForRole` · `projectAnnualLeaveOverage` · `weeklyRoster` · `bilingualRoster` · `fixedRoster` · `cesRoster` · `dispatcherRoster` · `FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS` · `TIME_RE` · `DAY_NAMES` · `MONTH_ABB` · `MONTH_NAMES` · `TEAM_GRADES` · `SWIPE_THRESHOLD` · `SWIPE_VELOCITY` · `computeEaster` · `isSameDay` · `getBankHolidays` · `isBankHoliday` · `isChristmasDay` · `isEasterSunday` · `getPaydaysAndCutoffs` · `paydayForCutoff` · `isPayday` · `isCutoffDate` · `getSpecialDayBadges` · `validateRosterPatterns` · `SHIFT_TIME_REGEX` · `isChristmasRD` · `isEarlyShift` · `isNightShift` · `getShiftKind` · `SHIFT_KIND_LABELS` · `getShiftClass` · `shiftBadgeParts` · `getShiftBadge` · `resolveMemberRoster` · `getWeekNumberForDate` · `getRosterForMember` · `getBaseShift` · `getPatternShift` · `escapeHtml` · `parseSmartFloat` · `parseSmartFloatOrNull` · `avatarInitials` · `avatarHue` · `isValidEmail` · `isChilternWorkEmail` · `workEmailLocalPart` · `workEmailFrom` · `formatISO` · `parseISODate` · `isSunday` · `getMembersForGrade` · `signInMembers` · `isOtherStaff`

### `calendar-app.js`
- **Exports:** none

### `calendar-state.js`
- **Exports:** `BROWSED_MONTH_KEPT_MS` · `getDisplayMonth` · `getDisplayYear` · `setDisplayMonth` · `setDisplayYear` · `changeDisplay` · `addMonths` · `watchLocalDate` · `persistViewedMonth`

### `calendar-swipe.js`
- **Exports:** `isSwipeCooldown` · `isSwipeGestureActive` · `initSwipeHandler`

### `calendar-al-lightbox.js`
- **Exports:** `initCalendarLightboxes`

### `calendar-initial-fetch.js`
- **Exports:** `initInitialFetch`

### `calendar-keyboard.js`
- **Exports:** `initCalendarTooltip` · `initCalendarKeyboard` · `initCalendarShortcuts`

### `calendar-month-jump.js`
- **Exports:** `initMonthJump`

### `calendar-access.js`
- **Exports:** `calendarAccessReady` · `calendarAuthReady` · `_resetPageForTest` · `getAccessType` · `finishSignIn` · `handleAccessLost` · `initCalendarAccess`

### `calendar-lock-cards.js`
- **Exports:** `initLockCards` · `hideLockPanel` · `signInInFlight` · `afterSignInSettles` · `dismissSignInForm` · `showSignInPanel` · `SIGN_IN_UNAVAILABLE_LINE` · `showSignInUnavailable` · `showMemberPanel`

### `calendar-lock-slot.js`
- **Exports:** `mountLockCard` · `unmountLockCard` · `lockCardId` · `armSkeleton` · `showBootSkeleton` · `setWorkspaceHidden`

### `calendar-snapshot.js`
- **Exports:** `SNAPSHOT_VERSION` · `MAX_AGE_MS` · `MONTHS_BEFORE` · `MONTHS_AFTER` · `LEAVE_YEARS_AROUND` · `inWindow` · `clearSnapshot` · `readSnapshot` · `readLeaveBalance` · `saveLeaveBalance` · `sweepRetiredLeaveKeys` · `snapshotMonth` · `saveSnapshotMonths`

### `calendar-own-copy.js`
- **Exports:** `ownCopyWindow` · `ownMonthsToStore` · `createOwnCopy`

### `calendar-access-core.js`
- **Exports:** `CALENDAR_VIEWER_UID` · `CALENDAR_VIEWER_CLAIM` · `isViewerUser` · `noticeAudienceAllows` · `personalActionsAllowed` · `decideAccess`

### `calendar-overrides.js`
- **Exports:** `SERVED_FROM_CACHE` · `READ_SUPERSEDED` · `rosterOverridesCache` · `hasOverrideAccess` · `setOverrideAccessLostHandler` · `_initialFetchInProgress` · `setInitialFetchInProgress` · `addFetchedMonths` · `clearFetchedMonth` · `releaseStaleMonths` · `oweRecheck` · `monthKey` · `issueReadTicket` · `answerStillWanted` · `_monthSlices` · `fetchOverridesForRange` · `fetchOverridesForRangeFromCache` · `ensureOverridesCached` · `getShiftTypesInMonth`

### `calendar-legend.js`
- **Exports:** `legendVisibility` · `onDispatcherRosterIn` · `legendShown` · `createLegend`

### `calendar-data-state.js`
- **Exports:** `noteKnowledge` · `noteCheckFailed` · `forget` · `knowledgeOf` · `worstKnowledge` · `decideDisplay` · `showsRoster` · `_reset`

### `overtime-app.js` / `overtime-boot.js` / `overtime-data.js` / `overtime-format.js` / `overtime-clock.js` / `overtime-tips.js`
- **Exports of `overtime-app.js`:** `init`
- **Exports of `overtime-boot.js`:** none
- **Exports of `overtime-data.js`:** `correctedNow` · `myStateReadAt` · `getMyOvertimeState` · `getOvertimeManagerOverview` · `createOvertimeWindow` · `withdrawOvertimeParticipant` · `submitOvertimeAvailability` · `loadWeekDetail`
- **Exports of `overtime-format.js`:** `deadlineLabel` · `phaseCopy` · `phaseChip` · `phaseTone` · `deadlineLines` · `SUBMIT_GRACE_MS` · `DEADLINE_SYNC_WINDOW_MS` · `clockOffset` · `submitDisposition` · `shouldResyncClock` · `canRestoreNow` · `dayUnfinished` · `unfinishedDates` · `reconcileVerdict` · `writeOutcomeUnknown` · `conflictIsOurs` · `shiftSpanMinutes` · `sameAnswer` · `shortDate` · `longDate` · `weekLabel` · `weekSpan` · `weekDates` · `printedLabel` · `asAtLine` · `declaredAgo` · `receiptLine` · `rowStateCopy` · `countsCopy` · `modesFor` · `offersFullTwelve` · `submitFailureCopy` · `answerCopy` · `isWithdrawn` · `withdrawnLine` · `putBackWindow` · `isUnavailable` · `isAvailableAnswer` · `rosterBadge` · `answerAnchorStale` · `answerTone` · `deriveHistory` · `gradeScopeLabel` · `weekAvailabilitySummary` · `reminderLine`
- **Exports of `overtime-clock.js`:** `SUBMIT_GRACE_MS` · `DEADLINE_SYNC_WINDOW_MS` · `clockOffset` · `submitDisposition` · `shouldResyncClock` · `canRestoreNow`
- **Exports of `overtime-tips.js`:** `CARD_TIPS`

### `overtime-form.js` / `overtime-roster.js`
- **Exports of `overtime-form.js`:** `renderWeekForm`
- **Exports of `overtime-roster.js`:** `rosterBadge` · `loadRosterContext` · `loadRosterForMembers`

### `links-import.js`
- **Exports:** `MAX_IMPORT_NAME` · `parseCell` · `parseGrid` · `parseDesignImport` · `summariseImport`

### `overtime-manager.js`
- **Exports:** `renderWeekDetail` · `refocus` · `focusLost` · `stampPrinted`

### `functions/overtime.js`
- **Exports:** `buildOvertimeEndpoints`

### `functions/doc-url-core.js`
- **Exports:** `DOC_KINDS` · `kindFromBody` · `SIGNED_URL_TTL_MS` · `mayReceiveDocumentUrl` · `resolveKind` · `signedUrlExpiry` · `isSignablePathForKind`

### `functions/doc-link-rotation.js`
- **Exports:** `rotateDocumentLinks` · `downloadUrl` · `pathOfDownloadUrl` · `keysOf` · `TOKEN_KEY` · `UNLINKED_MIN_AGE_MS`

### `functions/member-identity.js`
- **Exports:** `memberNameFromClaims` · `mustReclaim` · `claimedByAnotherMember` · `unlinkOtherProviders`

### `functions/request-helpers.js`
- **Exports:** `jsonBodyOf` · `readJsonBody` · `headerText` · `bearerToken` · `requireAdmin` · `readRawBody`

### `functions/caught.js`
- **Exports:** `fieldsOf`

### `functions/region.js`
- **Exports:** `REGION`

### `functions/london-clock.js`
- **Exports:** `londonOffsetMinutes` · `londonTimestamp` · `londonIsoDate` · `isValidIsoDate` · `isoDayOfWeek` · `addDays`

### `functions/overtime-core.js`
- **Exports:** `POLICY_VERSION` · `MILESTONE_OFFSETS` · `DEADLINE_HOUR_LONDON` · `SCHEDULER_HOUR_LONDON` · `lastSchedulerRun` · `ANSWERABLE_WEEKS` · `PLANNING_WEEKS` · `MAX_PARTICIPANTS_PER_WINDOW` · `AUDIENCES` · `AVAILABILITY_MODES` · `REQUEST_DAY_FIELDS` · `OPTIONAL_DAY_FIELDS` · `londonOffsetMinutes` · `londonTimestamp` · `londonNoonTimestamp` · `londonMidnightTimestamp` · `londonIsoDate` · `isValidIsoDate` · `isoDayOfWeek` · `addDays` · `isSaturday` · `weekDates` · `weekEndingFor` · `deriveMilestones` · `storedMilestones` · `toMillis` · `phaseFor` · `isOpenPhase` · `canChangeParticipation` · `canRestoreParticipant` · `isWithdrawn` · `validateWeekEnding` · `planningWeekEndings` · `weeksNeedingWindows` · `windowRowState` · `isEligibleForWeek` · `selectParticipants` · `isSafeDocId` · `normaliseDay` · `normaliseDays` · `daysEqual` · `revisionId` · `decideSubmission` · `publicHead` · `deriveHistory` · `REMINDER_LOOKAHEAD_MS` · `reminderDue` · `londonDeadlineLabel` · `askedNotice` · `reminderNotice` · `PURGE_ARMS_AT` · `purgeArmedAt`

### `calendar-notices.js`
- **Exports:** `initCalendarNotices`

### `calendar-member.js`
- **Exports:** `takeStaleMemberName` · `getDefaultMemberIndex` · `isFirstRun` · `getSelectedMemberIndex` · `_resetSelectionFallbackForTest` · `saveSelectedMember` · `populateTeamMemberDropdown` · `getCurrentMember` · `validateTeamMembers`

### `calendar-renderer.js`
- **Exports:** `changeProvenance` · `shiftWords` · `splitShiftLine` · `dayMarkers` · `weekContext` · `createCalendarHeader` · `dayCellParts` · `dayCellName` · `createDayCell` · `getSwipeDirection` · `setSnapshotSource` · `monthOnScreen` · `buildCalendarContainer`

### `calendar-huddle-viewer.js`
- **Exports:** `wrapTables` · `initHuddleViewer`

### `huddle-table-grid.js`
- **Exports:** `firstColumnMask`

### `calendar-doc-viewer.js`
- **Exports:** `initDocViewer`

### `calendar-team-view.js`
- **Exports:** `weekStartForMonth` · `weekAfterDateChange` · `initTeamView`

### `calendar-tips.js`
- **Exports:** `CARD_TIPS`

### `admin-app.js`
- **Exports:** `init`

### `settings-status.js`
- **Exports:** `CARD_ORDER` · `shouldOpen` · `installNeed` · `summarise`

### `settings-app.js`
- **Exports:** `init`

### `settings-tips.js`
- **Exports:** `CARD_TIPS`

### `settings-password-card.js`
- **Exports:** `passwordSaving` · `initPasswordCard`

### `settings-install-card.js`
- **Exports:** `captureInstallOffer` · `initDeviceCard`

### `overlay.js`
- **Exports:** `initCardCollapse` · `openCardNamedByHash` · `_pushOverlayState` · `_isTopOverlay` · `_clearOverlayHistory` · `registerPopInterceptor` · `suppressNextPop` · `whenHistorySettled` · `followLinkOutOf` · `trapFocus` · `watchScrollFade` · `pinCloseButton` · `lockBodyScroll` · `unlockBodyScroll` · `openNoticeIfClear` · `dismissOverlay` · `closeOnBackdropTap` · `createLightbox` · `confirmDialog` · `confirmWithOption` · `promptDialog`

### `card-collapse.js`
- **Exports:** `initCardCollapse` · `openCardNamedByHash`

### `overlay-history.js`
- **Exports:** `_pushOverlayState` · `_isTopOverlay` · `_clearOverlayHistory` · `registerPopInterceptor` · `suppressNextPop` · `whenHistorySettled` · `followLinkOutOf`

### `overlay-focus.js`
- **Exports:** `trapFocus` · `_zOf` · `_highestOpenLayer` · `_guardFocus`

### `overlay-panel-scroll.js`
- **Exports:** `watchScrollFade` · `pinCloseButton`

### `about-lightbox.js`
- **Exports:** `initAboutLightbox` · `wireHeaderLogo`

### `glossary.js`
- **Exports:** `GLOSSARY` · `GLOSSARY_TITLE` · `mentionsGlossaryTerm`

### `tips-lightbox.js`
- **Exports:** `GLOSSARY_KEY` · `openGlossary` · `initTipsLightbox`

### `login-core.js`
- **Exports:** `SIGN_IN_GIVE_UP_MS` · `runNamedSignIn` · `isAboutLinkAllowed` · `resetRequestFailureLine` · `holdPasswordMarker` · `releasePasswordMarker` · `SHARED_SCREEN` · `signInAboutFor`

### `login-overlay.js`
- **Exports:** `runNamedSignIn` · `isAboutLinkAllowed` · `resetRequestFailureLine` · `sayStaffPinEndedIn` · `SIGN_IN_SLOW_LINE` · `signInDeps` · `dismissLoginOverlay` · `initLoginOverlay`

### `sw-register.js`
- **Exports:** `_resetForTest` · `hasPendingUpdate` · `lazyImport` · `reloadWhileHidden` · `reloadWhenNotBusy` · `reloadForUpdate` · `registerServiceWorker`

### `splash-watchdog.js`
- **Exports:** none

### The reset-request queue
Not a module — the pieces a locked-out member's "ask the admin" request passes through, listed together because the design only makes sense whole: PASSWORD_DESIGN.md §12 (the queue) and §14 (the admin push).
- `firebase-client.js` — `requestPasswordReset` (no auth token; its caller cannot sign in), `getResetRequests`, `clearResetRequest`.
- `login-overlay.js` — the request button; `CONFIG.PASSWORD_RESET_REQUESTS` is its kill switch.
- `operations-app.js` — the Password reset requests card and its `#reset-requests` deep link.
- `functions/reset-request.js` — the public endpoint, which resets nothing and pushes to the admin's devices only; its bounds are argued in its header.

### `password-force.js`
- **Exports:** `withTimeout` · `settleOrTimeout` · `shouldForcePasswordSet` · `initPasswordForce`

### `session.js`
- **Exports:** `shedCalendarViewer` · `terminalAuthEvent` · `AUTH_KEY` · `SESSION_MS` · `SESSION_VER` · `sessionReady` · `resolveSession` · `getFirebaseIdentity` · `firebaseSessionIsNamed` · `signedInAs` · `getFirebaseAuthError` · `AUTH_RESTORE_TIMEOUT_MS` · `restoreFirstAuthUser` · `primeAuth` · `ensureFirebaseSession` · `isTransientAuthError` · `ensureNamedSession` · `refreshClaimsIfStale` · `getSession` · `saveSession` · `clearSession` · `reconcileExpiredIdentity` · `releasePushForEndingHold` · `ACCESS_DECISION_BUDGET_MS`

### `viewer-shed.js`
- **Exports:** `shedCalendarViewer`

### `staff-pin-ended.js`
- **Exports:** `STAFF_PIN_ENDED_NOTICE` · `noteStaffPinEnded` · `forgetStaffPinEnded` · `sayStaffPinEndedIn` · `onStaffPinEnded`

### `silent-sign-in.js`
- **Exports:** `AUTH_RESTORE_TIMEOUT_MS` · `noDefaultKey` · `RESET_RECHECK_MS` · `planSilentAttempt` · `afterRecheck` · `remembersRefusal` · `SIGN_IN_CLOCK_SKEW_MS` · `sessionStartMs`

### `auth-state-core.js`
- **Exports:** `AUTH_STATUSES` · `INITIAL_STATE` · `reduceAuthState`

### `auth-state.js`
- **Exports:** `getAuthSnapshot` · `subscribeAuth` · `dispatchAuth` · `_resetAuthStateForTest`

### `auth-policy.js`
- **Exports:** `DECISIONS` · `PAGE_POLICIES` · `requirePageAuth` · `rolesFor` · `isOvertimeReviewer` · `canOpenOvertime` · `canOpenNewlink` · `navGatesFor` · `overtimeEnabled` · `requirePage`

### `operations-app.js`
- **Exports:** `init`

### `operations-reports.js` / `operations-errors.js` / `operations-usage.js` / `operations-speed.js`
- **Exports of `operations-reports.js`:** `PRIVACY_FOOTER` · `PAGE_META` · `OPEN_META` · `_cardLoadError` · `_usageMonthLabel` · `_relativeTime`
- **Exports of `operations-errors.js`:** `initErrorLog`
- **Exports of `operations-usage.js`:** `initUsageCard`
- **Exports of `operations-speed.js`:** `initPageSpeedCard`

### `links-app.js`
- **Exports:** `init`

### `links-analysis.js`
- **Exports:** `initLinksAnalysis`

### `links-compare-analysis.js`
- **Exports:** `compareDesigns`

### `links-compare.js`
- **Exports:** `COMPARE_ACTIVE_FALLBACK` · `initLinksCompare`

### `links-grid-input.js`
- **Exports:** `cellAfterKey` · `createGridInput` · `trackPaintBarHeight`

### `links-build-press.js`
- **Exports:** `overCapacityLine` · `refusalLine` · `buildConfirm` · `withSurplusLines` · `createBuildCounter` · `builtStatusLine`

### `links-today.js`
- **Exports:** `shiftOptionLists` · `currentLinkBaseline`

### `links-grid-cells.js`
- **Exports:** `DAY_LABELS` · `shiftLabel` · `cellName` · `emptyPattern` · `isUnfilledPattern` · `cellAriaName` · `editCellHtml` · `compareCellHtml` · `coverCellsHtml`

### `links-grid.js`
- **Exports:** `shiftOptionsHtml` · `totalCellsHtml` · `coverFootHtml` · `createDesignGrid`

### `links-brush-bar.js`
- **Exports:** `brushTimes` · `brushSig` · `createBrushBar`

### `links-window-editor.js`
- **Exports:** `createWindowEditor`

### `links-build-button.js`
- **Exports:** `STILL_LOADING` · `boxFigure` · `initBuildButton`

### `links-analyse.js`
- **Exports:** `readAgainstService` · `analyse`

### `links-print.js`
- **Exports:** `createPrintPrep`

### `newlink-tips.js`
- **Exports:** `CARD_TIPS`

### `links-tips.js`
- **Exports:** `DEFAULT_TABLE_FIGURES` · `CARD_TIPS`

### `links-design.js`
- **Exports:** `DAYS` · `ROTATING_LINES` · `MIN_REST_MINUTES` · `SPARE_WORKED_DAYS` · `isCoverWeek` · `spareDrawsOnFour` · `DEFAULT_MAX_RUN` · `WEEKENDS_OFF_AIM_PCT` · `worstCaseWorkedRun` · `runLengthsWhere` · `isRest` · `workedRunLengths` · `classifyShift` · `normaliseCustomShift` · `canonicaliseShift` · `normalisePatterns` · `startMinutes` · `endMinutes` · `endMinutesAbs` · `dutyMinutes` · `CONTRACTED_HOURS_PER_WEEK` · `hmFromHours` · `hoursFigure` · `weeklyHours` · `lineTotals` · `calcCoverage` · `dayClass` · `calcHourlyCoverage` · `restBetween` · `runDesignChecks`

### `links-generate.js`
- **Exports:** `generatePatterns` · `WAVE_SPAN_MINUTES` · `targetExSundayMinutes` · `groupIntoWaves` · `repairShortRest` · `generateLink`

### `links-target-sets-store.js`
- **Exports:** `createTargetSetStore`

### `links-target-hours.js`
- **Exports:** `assessTargetHours` · `targetHoursLines` · `targetProvenanceNote`

### `links-design-doc.js`
- **Exports:** `LEGACY_DOC_ID` · `LINK_26_FROM` · `PREVIOUS_LINK_LENGTH` · `isPre26Design` · `deepCopyPatterns` · `designFromDoc` · `binEntryFromDoc` · `docPayload` · `workingCopy` · `binEntryFrom` · `restoredEntryFrom` · `recordSave` · `lastSavedLabel`

### `links-design-load.js`
- **Exports:** `splitDesignDocs` · `binOldOnLoad` · `binOldOnRefresh` · `readCannotAnswer` · `migratesLegacy` · `byDesignName` · `designToOpen` · `emptyStateFor`

### `links-generator-targets.js`
- **Exports:** `CUSTOM_SHIFT_PROMPT` · `customShiftRefusal` · `createTargetPanel`

### `select-sheet.js`
- **Exports:** `readGroups` · `triggerLabel` · `widestOptionLabel` · `shouldOfferSearch` · `searchLabelFor` · `optionMatches` · `filterGroups` · `enhanceSelect` · `openOptionSheet` · `initSelectSheets`

### `select-sheet-parity.test.mjs`

### `links-proposals.js`
- **Exports:** `PROPOSAL_PREFIX` · `PROPOSALS` · `proposalDisplayName` · `PROPOSAL_NAMES` · `isProposalId` · `proposalById` · `proposalCopyName`

### `links-shortlist.js`
- **Exports:** `OLDER_BEFORE` · `LISTED_IN_DIALOG` · `isOlderDesign` · `olderDesigns` · `canKeepOnlyShortlist` · `keepOnlyShortlistMessage` · `keptOnlyShortlistLine`

### `links-design-header.js`
- **Exports:** `toDate` · `lastSaveTime` · `groupDesigns` · `saveButtonLabel` · `statusCopy` · `whoCopy` · `proposeNewDesignName` · `createDesignHeader`

### `links-design-naming.js`
- **Exports:** `MAX_DESIGN_NAME` · `nameKey` · `nameConflict` · `checkName` · `checkDesignName` · `proposeCopyName`

### `rangers-guide.css`
The Rangers & Rovers guide's stylesheet: the ranger and rover area passes staff accept or refuse at the gateline, drawn as a dialect of the Railcard guide. A static page with no app modules; its chip bar is `guide-chips.js` and its ⤓ PDF button `guide-print.js`. The page's rules are `.claude/rules/guide-pages.md` → "Rangers & Rovers guide"; each product's evidence is a `GUIDE_SOURCES.md` row, held to the page by `guide-sources.test.mjs`.

### `links-seed.js`
- **Exports:** `rosterSeedLines` · `buildRosterTargets`

### `links-default-targets.js`
- **Exports:** `DEFAULT_COVER_WEEKS` · `OPENING_TURNS` · `CLOSING_TURNS` · `EVENING_TURNS_FROM_22` · `SATURDAY_CLOSING_TURNS` · `SATURDAY_TURNS` · `SUNDAY_TURNS` · `TARGET_DAYS_PER_WEEK` · `DEFAULT_SHIFT_TIMES` · `sameTargetTable` · `isSupersededMemory` · `buildDefaultTargets`

### `links-target-sets.js`
- **Exports:** `MAX_SET_NAME` · `MAX_SET_SLOTS` · `SPARE_WEEKS_CAP` · `targetSetProblem` · `targetSetFromDoc` · `targetSetPayload` · `canOverwriteTargetSet` · `describeSetState` · `sortTargetSets` · `describeSetList`

### `links-limits.js`
- **Exports:** `MAX_CONSECUTIVE_WORKED_DAYS` · `POLICY_SOURCE_CONFIRMED` · `LIMIT_CLAIM` · `CONTRACTED_DAYS_CEILING` · `contractedDaysPerYear` · `contractedDaysFromCounts` · `assessHardLimits`

### `links-fatigue.js`
- **Exports:** `DAY_NAME` · `isRest` · `isWorked` · `dutyMinutes` · `isEarlyStart` · `isVeryEarlyStart` · `coversNightWindow` · `toSequence` · `longestRunBetween48hBreaks` · `longestWorkedRun` · `longestRunOf` · `earlyBlocksWithShortRecovery` · `maxHoursInAny7Days` · `COVER_DUTY_MINUTES` · `COVER_DUTY_WORDS` · `worstHoursInAny7Days` · `startTimeJumps` · `rotationDirection` · `assessFatigue`

### `links-window.js`
- **Exports:** `DEFAULT_WINDOW` · `WINDOW_ROWS` · `windowMinutes` · `rowMinutes` · `canonicaliseWindowTime` · `isValidWindowRow` · `windowEditRefusal` · `normaliseWindow` · `windowForDay` · `isHourStaffed` · `heatSpan` · `formatWindow` · `windowsDiffer` · `isDefaultWindow`

### `links-demand.js`
- **Exports:** `DEC_2026_SOURCE` · `DAY_CLASS_KEYS` · `DEC_2026_MOVEMENTS` · `DEC_2026_DEMAND` · `demandAt` · `peakCars` · `demandBucket` · `peakHours` · `DAY_LABEL` · `DAY_CLASSES` · `movementsOutside` · `dutySpans` · `summariseDemand` · `describeHours` · `describeMovements`

### `links-adjacency.js`
- **Exports:** `OBJECTIVES` · `GENTLE_THRESHOLD_MINUTES` · `DEFAULT_BLOCK_TARGET` · `lineStartProfile` · `weekStep` · `breakLength` · `boundaryRest` · `blockRuns` · `longestBlockOf` · `blockExcess` · `spareSpread` · `longestRunFor` · `runExcess` · `scoreOrder` · `cost` · `reorderLines` · `applyOrder`

### `links-deletion.js`
- **Exports:** `tsMillis` · `isDeleted` · `deletedLabel` · `sortByDeleted` · `deleteOutcomeLine` · `renameRefusedLine`

### `links-concurrency.js`
- **Exports:** `conflictOf` · `baselineAfterWrite` · `baselineAfterCommit` · `baselineFromEntry` · `nextRevision` · `canAdvanceBaseline` · `listRowSig` · `mergeListAnswer`

### `admin-tips.js`
- **Exports:** `CARD_TIPS`

### `admin-boot.js` / `links-boot.js` / `operations-boot.js` / `paycalc-boot.js` / `settings-boot.js`
- **Exports of `admin-boot.js`:** none
- **Exports of `links-boot.js`:** none
- **Exports of `operations-boot.js`:** none
- **Exports of `paycalc-boot.js`:** none
- **Exports of `settings-boot.js`:** none

### `admin-range-booking.js`
- **Exports:** `createRangeBookingSection`

### `admin-al.js`
- **Exports:** `triggerConfirmedALSave` · `initALSection`

### `al-contract.js`
- **Exports:** `allowanceRole` · `countsAsDispatcherBankHoliday` · `countDispatcherBankHolidaysWorked` · `dispatcherBaseAL` · `getALEntitlement`

### `al-entitlement.js`
- **Exports:** `entitlementFor` · `boxingDayLieuYear` · `boxingDayLieuSplit` · `lowersAllowance` · `consumesEntitlement` · `SPARE_WEEK_MAX_DAYS` · `spareUnderneath` · `rosteredSpareDay` · `spareWeekDays` · `costsWithoutSpareCap` · `countedAlDates` · `alPosition` · `balanceFace` · `leaveYearChoices` · `dispatcherBreakdown` · `entitlementNote` · `winningEntriesOfType` · `isWorkingDate`

### `al-leave-file.js`
- **Exports:** `LEAVE_FILE_FORMAT` · `LEAVE_FILE_VERSION` · `LEAVE_FILE_MAX_AGE_DAYS` · `LEAVE_FILE_MAX_BYTES` · `GRADES` · `FOUND_IN` · `NOT_IMPORTED_REASONS` · `canonicalJson` · `leaveFileDigest` · `sealLeaveFile` · `isRealIsoDate` · `isSundayIso` · `isChristmasIso` · `leaveFileAgeDays` · `londonDayOf` · `usedRow` · `personSums` · `readLeaveFile` · `validateLeaveFile` · `describeRefusal`

### `al-leave-compare.js`
- **Exports:** `DAY_STATES` · `NEEDS_A_LOOK` · `COUNT_KEYS` · `leaveRecordability` · `winnersByDate` · `comparePerson` · `compareLeaveFile`

### `al-leave-plan.js`
- **Exports:** `oldestSaveableYear` · `ANSWERS` · `LOG_MAX_DAYS` · `HELD_STATES` · `WRITE_KINDS` · `dayKey` · `parseDayKey` · `writableDate` · `questionsFor` · `planPerson` · `writesFor` · `saveTotals` · `recordsAfter` · `judgeUploads` · `saveRefusal` · `logLists` · `landedWrites` · `logFields` · `planUndo`

### `al-leave-save.js`
- **Exports:** `CACHED_READ` · `readMemberRecords` · `readUploadLogs` · `STORE_UNLOADED` · `preloadSaveStore` · `saveLeavePlans` · `newUploadLogId` · `writeUploadLog` · `pruneUploadLogs` · `undoUpload`

### `al-leave-words.js`
- **Exports:** `dayLabel` · `sheetWords` · `patternWords` · `drawnWords` · `appWords` · `figuresLine` · `personNotes` · `chipsFor` · `totalsEntries` · `reasonWords` · `CARD_WORDS` · `beyondHeadWords` · `checkedWords` · `overallWords` · `oldWords` · `unplacedWords` · `appOnlyWords` · `moreDaysWords` · `notComparedWords` · `ageWords` · `SAVE_WORDS` · `questionWords` · `confirmWords` · `afterWords` · `stillDiffersWords` · `unansweredWords` · `saveButtonWords` · `savingWords` · `refusalWords` · `receiptWords` · `leftFreeWords` · `lastSaveWords` · `undoConfirmWords` · `undoneWords`

### `christmas-leave.js`
- **Exports:** `CHRISTMAS_LEAVE_FROM_YEAR` · `isChristmasLeaveDay` · `isChristmasClosureDate` · `isUncountedChristmasLeave` · `allowanceForBoxingDay` · `boxingDayForAllowance` · `allowanceYearsOf` · `boxingDayLieuDays` · `resolveDayShift` · `christmasLeaveDates` · `christmasLeaveByYear` · `christmasLeaveLine`

### `leave-year.js`
- **Exports:** `LEAVE_YEAR_CHOICE` · `LEAVE_YEAR_FROM` · `leaveYearChoiceEnabled` · `isValidLeaveYear` · `carriedFrom` · `leaveYearOf` · `nextLeaveYear` · `canChooseLeaveYear` · `offeredJanuaries` · `carryLine`

### `admin-leave-year.js` / `admin-leave-year-save.js`
- **Exports of `admin-leave-year.js`:** `leftWords` · `leaveYearPanelHtml` · `initLeaveYearPanel`
- **Exports of `admin-leave-year-save.js`:** `setLeaveYear`

### `admin-al-year.js`
- **Exports:** `alFigureYear`

### `trains-app.js` / `trains-boot.js` / `trains-cards.js` / `trains-change.js` / `trains-stations.js` / `trains-weekdays.js` / `trains-verdict.js` / `trains-headlines.js` / `trains-render.js` / `trains-data.js` / `trains-tips.js` / `trains-grid-mirror.js` / `trains-status.js`
- **Exports of `trains-app.js`:** `init`
- **Exports of `trains-boot.js`:** none
- **Exports of `trains-cards.js`:** `DEC_STOPS_KNOWN` · `phase` · `LAST_STATION_KEY` · `renderOverview` · `renderChanges` · `renderPattern` · `renderStationPicks` · `renderLast` · `renderStationCard` · `amPmPending` · `renderLookup` · `setText` · `el`
- **Exports of `trains-change.js`:** `MAX_SHIFT_MIN` · `MAX_REROUTE_MIN` · `LINES` · `lineDepth` · `PATTERN_HOURS` · `serviceMinutes` · `routeKey` · `alignTimes` · `foldWeekdayVariants` · `restatePair` · `foldVariantsAt` · `compareRoutes` · `relinkAcrossRoutes` · `NEAR_WINDOW_MIN` · `trainsNear` · `parseTypedTime` · `railwayToday` · `daysUntil` · `minsWords` · `changeLabel` · `timetablePhase` · `dateWords` · `monthWords` · `holidaysWithin` · `daysLabel` · `routeName` · `JOURNEY_PLANNER_URL`
- **Exports of `trains-stations.js`:** `boardingTime` · `parseStops` · `stopsKnown` · `callsOf` · `lineOf` · `callingAt` · `endingAt` · `knowableWithoutStops` · `decemberKnown` · `summarise` · `stationView` · `stationTrains` · `stopChanges` · `busiestStations` · `matchStations` · `stationBands` · `stoppingGrid` · `orderStations` · `pairColumns` · `lastTrains`
- **Exports of `trains-weekdays.js`:** `WEEKDAYS` · `REAL_DAY` · `runsOn` · `daysCode` · `aRealDay` · `onWeekday` · `weekdayGroups` · `weekdayWords`
- **Exports of `trains-verdict.js`:** `EDGE_SHIFT_MIN` · `JOURNEY_SHIFT_MIN` · `verdictFor` · `balanceFacts` · `hourChanged` · `rateWords` · `sameRegularity` · `hourWords` · `hourNote` · `minutesWords` · `andList`
- **Exports of `trains-headlines.js`:** `headlineChanges`
- **Exports of `trains-render.js`:** `DAY_NAMES` · `DAYTIME` · `changesTitle` · `HEADLINES_SHOWN` · `partialStopsNote` · `leadWords` · `renderFurtherChanges` · `SIGN_IN_ABOUT` · `renderHeadlines` · `endWords` · `renderStation` · `renderGrid` · `renderTotals` · `renderPicks` · `renderLookup` · `renderLastTrains`
- **Exports of `trains-data.js`:** `CHANGE_DATE` · `FURTHER_CHANGES_UNTIL` · `DEC_VALID_UNTIL` · `LEAF_FALL` · `STATIONS` · `STATION_ORDER` · `TIMETABLES`
- **Exports of `trains-tips.js`:** `CARD_TIPS` · `tipsOn`
- **Exports of `trains-grid-mirror.js`:** `syncGridMirror`
- **Exports of `trains-status.js`:** `announce` · `statusLine` · `matchesLine`

### `overflow-hint.js`
- **Exports:** `watchOverflowHint`

### `newlink-app.js` / `newlink-boot.js` / `newlink-config.js` / `newlink-data.js` / `newlink-render.js`
- **Exports of `newlink-app.js`:** `init`
- **Exports of `newlink-boot.js`:** none
- **Exports of `newlink-config.js`:** `STARTS` · `TIMETABLE_STARTS` · `CONTACT` · `CONTACT_ROLE` · `CHOSEN` · `PHASE` · `CLOSES` · `AUDIENCE` · `audienceNames` · `PACK_BASE` · `HAVE_YOUR_SAY`
- **Exports of `newlink-data.js`:** `COLUMNS` · `CHANGES` · `GAINS` · `COSTS` · `DIFFERS` · `DIFFER_RULE` · `PERSONAS` · `NOTES` · `PACK`
- **Exports of `newlink-render.js`:** `designName` · `aToZ` · `closesWords` · `startsWords` · `statusPhase` · `statusHint` · `renderStatus` · `renderList` · `renderCommon` · `renderDiffers` · `ifYou` · `renderFigures` · `figuresKey` · `renderPersonas` · `renderPersonaChips` · `dutyKind` · `renderWeeks` · `renderAllWeeks` · `renderWeeksKey` · `renderWeeksTabs` · `fileRow` · `renderPack` · `glanceFile` · `personaStatus` · `weeksStatus` · `weeksTitle`

### `pdf-viewer.js` / `pdf-viewer-core.js`
- **Exports of `pdf-viewer.js`:** `initPdfViewer`
- **Exports of `pdf-viewer-core.js`:** `ZOOM_STEPS` · `MAX_DEVICE_PIXEL_RATIO` · `MAX_CANVAS_PIXELS` · `MAX_FIT_WIDTH` · `zoomAfter` · `zoomLabel` · `pageLayout` · `canOpenOutside` · `isPlainClick` · `classifyFailure` · `FAILURE_TEXT` · `failureAction` · `PAGE_FAILURE_TEXT` · `pageLabel` · `pagesLabel`

### `overtime-phase.js`
- **Exports:** `deadlineLabel` · `phaseAt` · `phaseCopy` · `phaseChip` · `phaseTone` · `deadlineLines`

### `overtime-answer.js`
- **Exports:** `withMode` · `withFullTwelve` · `withRelease`

### `overtime-sunday-release.js`
- **Exports:** `offersSundayRelease` · `SUNDAY_RELEASE_ASKED` · `SUNDAY_RELEASE_LABEL` · `releaseRequestLine`

### `al-swapped-days.js`
- **Exports:** `swapDecisionDates` · `replacedTypeForSwap` · `absenceHiddenDates` · `rangeWriteDates`

### `admin-al-projection.js`
- **Exports:** `projectAlBooking` · `yearShiftWords` · `rangeSundayCorrections` · `projectAbsenceRange` · `lieuGoesWords` · `overridesAfterSave` · `projectAlOverage`

### `admin-time-inputs.js`
- **Exports:** `initTimeInputs`

### `admin-day-pills.js`
- **Exports:** `restrictDayPills`

### `admin-week-row-state.js`
- **Exports:** `drawnRecords` · `drawnDays` · `rosteredWords` · `_syncOtherRdwWarn` · `_syncOtherSpareMode` · `_activateRow` · `_syncAlSwap` · `_syncOverwriteBadge` · `prefillRow` · `_deactivateRow` · `isStagedRow` · `readRowDraft` · `applyRowDraft` · `readWeekDraft` · `sendingEntries` · `keptWeekDraft` · `unsavedWeekDraft` · `applyWeekDraft`

### `admin-own-write.js`
- **Exports:** `initOwnWrite` · `ownWriteRowAction` · `syncWeekAfterOwnWrite` · `clearedDaysLine` · `withClearedDays`

### `admin-bulk-apply.js`
- **Exports:** `bulkApplyWaitingFor` · `bulkSkippedLine`

### `admin-week-collect.js`
- **Exports:** `collectWeekRows`

### `admin-al-week-save.js`
- **Exports:** `planAlWeekSave` · `planAlDelete`

### `admin-al-spare-note.js`
- **Exports:** `spareShiftNote` · `countSpareDays` · `spareDaysOf` · `spareWeekDaysOf`

### `admin-period-dates.js`
- **Exports:** `addDays` · `isRestGap` · `fmtPeriodDate` · `fmtPeriodRange` · `formatDisplay` · `namedDays`

### `admin-booked-periods.js`
- **Exports:** `periodDelete` · `splitAtYearEnd` · `bookedYears` · `pickBookedYear` · `createBookedPeriods`

### `admin-period-delete.js`
- **Exports:** `createPeriodDelete`

### `admin-confirm-bar.js`
- **Exports:** `createConfirmBar`

### `two-tap.js`
- **Exports:** `TWO_TAP_MIN_MS` · `twoTap` · `disarmConfirm`

### `feedback-line.js`
- **Exports:** `holdFeedback` · `fadeFeedback`

### `admin-sick.js`
- **Exports:** `initSickSection`

### `admin-overrides.js`
- **Exports:** `TYPES` · `PILL_TYPES` · `renderTable` · `resetTableMemberFilter` · `renderWeekGrid` · `buildWeekGridInto` · `updateWeekNavLabel` · `updateSaveBtn` · `resetBulkPills` · `_hasStagedEdits` · `setSaveInFlight` · `isSaveInFlight` · `sendingDays` · `NOT_ON_ROSTER_LINE` · `initOverrideStore` · `getAllOverrides` · `setAllOverrides` · `removeFromCache` · `whenOverridesReady` · `whenLoadSettled` · `isOverrideCacheLoaded` · `hasOverrideAuthorityFor` · `loadOverrides` · `ensureMemberLoaded` · `buildMemberDateMap` · `isWorkingDate` · `initOverrides` · `refusedLine` · `executeSave` · `getEffectiveShift` · `validateShiftRules` · `recordRangeOverrides` · `formatDisplay`

### `admin-save-receipt.js`
- **Exports:** `buildSaveReceipt`

### `slow-save.js`
- **Exports:** `SLOW_SAVE_MS` · `SLOW_SAVE_TEXT` · `SLOW_SAVE_TEXT_BATCHED` · `SLOW_SAVE_TEXT_ONLINE` · `SLOW_SAVE_TEXT_BATCHED_ONLINE` · `SLOW_SAVE_TEXT_UNHELD` · `SLOW_SAVE_TEXT_UNHELD_ONLINE` · `slowSaveText` · `SLOW_SAVE_EVENT` · `watchSlowCommit` · `trackHiddenTime` · `trackOwnWritesWaits` · `writesInFlight` · `withSlowSaveNotice`

### `admin-shift-types.js`
- **Exports:** `TYPES` · `PILL_TYPES` · `pillName` · `typePillHtml` · `WORKED_OVERRIDE_TYPES` · `rowValueText`

### `admin-week-editor.js`
- **Exports:** `rosteredWords` · `NOT_ON_ROSTER_LINE` · `initWeekEditor` · `_hasStagedEdits` · `resetStagedRows` · `updateWeekNavLabel` · `buildWeekGridInto` · `renderWeekGrid` · `setSaveInFlight` · `isSaveInFlight` · `sendingDays` · `updateSaveBtn` · `resetBulkPills`

### `admin-saved-changes.js`
- **Exports:** `initSavedChanges` · `resetTableMemberFilter` · `renderTable`

### `admin-override-store.js`
- **Exports:** `initOverrideStore` · `whenOverridesReady` · `isOverrideCacheLoaded` · `hasOverrideAuthorityFor` · `OVERRIDES_QUERY_CAP` · `getAllOverrides` · `mutateCache` · `coversAllStaff` · `loadFailedFor` · `isTruncated` · `setAllOverrides` · `idsReplacedBy` · `withManualDuplicates` · `deleteChunks` · `removeFromCache` · `whenLoadSettled` · `loadOverrides` · `CHANGED_ELSEWHERE_LINE` · `UNCHECKED_DELETE_LINE` · `staleDeleteVerdict` · `DELETE_REFUSED` · `deleteFailureLine` · `asShown` · `commitIfUnchanged` · `deleteIfUnchanged` · `commitChecked` · `LEAVE_YEAR_CHANGED_LINE` · `ensureMemberLoaded`

### `override-id.js`
- **Exports:** `manualOverrideId`

### `override-compare.js`
- **Exports:** `sameOverrideRecord` · `keptRecord` · `sameKeptRecord` · `overrideFromSnapshot`

### `admin-override-coverage.js`
- **Exports:** `emptyCoverage` · `withMember` · `withAll` · `hasAuthorityFor` · `coversEveryone` · `replaceMemberSlice` · `mergeCappedRead`

### `admin-shift-rules.js`
- **Exports:** `parseMinutes` · `effectiveEndMins` · `fmtHours` · `constrainingTime` · `checkShiftRules` · `isBoxingDay` · `christmasDayName` · `weekStepAllowed` · `linkableDate` · `checkDayRules`

### `admin-deep-link.js`
- **Exports:** `NESTED_DEEP_LINKS` · `resolveDeepLink` · `createDeepLinkLanding`

### `admin-rangepicker.js`
- **Exports:** `getDateRange` · `buildRangePicker`

### `date-picker.js`
- **Exports:** `monthCells` · `openDatePicker` · `initDatePickers`

### `date-format.js`
- **Exports:** `DAY_NAMES` · `DAY_NAMES_FULL` · `MONTH_ABB` · `MONTH_NAMES` · `NO_DATE` · `formatDayMonth` · `formatDayMonthYear` · `formatDayMonthYear2` · `formatWeekdayDate` · `printedStamp` · `londonClock` · `formatClock` · `londonDate`

### `huddle.js`
- **Exports:** `initHuddleUpload`

### `notif-card.js`
- **Exports:** `initNotificationsCard`

### `notif-card-core.js`
- **Exports:** `TIMETABLE_CHANGE` · `TIMETABLE_SEND_HOUR` · `timetableListed` · `homeScreenLabel` · `punctuateKinds` · `STILL_ASKING_LINE` · `ENABLE_FAILED_LINE` · `MAIN_ADDRESS` · `notifCardWords`

### `doc-upload.js`
- **Exports:** `hiddenByNewerLine` · `isPdfFile` · `isDocxFile` · `initDocUploadCard`

### `admin-auth.js`
- **Exports:** `initAuthSetup`

### `roster-cell-rules.js`
- **Exports:** `RDW_PREFIX` · `isRdwEncoded` · `stripRdw` · `UNKNOWN_PREFIX` · `isUnknownEncoded` · `stripUnknown` · `normaliseCellValue` · `shiftValueToOverrideType` · `isZeroLengthRange`

### `roster-entry-control.js`
- **Exports:** `entryControlHtml` · `isoFromKey` · `redrawEntry` · `toggleEntry` · `patchEntryRow` · `paintUnreadableRow` · `entryClick` · `commitEntry` · `entryLeftAsRest`

### `roster-alignment.js`
- **Exports:** `defaultWeekEnding` · `detectShiftedRow` · `ALIGNMENT_BLOCK_THRESHOLD` · `assessRosterAlignment` · `geometryCopy` · `driftCopy` · `stopCopy`

### `roster-review-states.js`
- **Exports:** `CHRISTMAS_NOTE` · `RDW_PREFIX` · `isRdwEncoded` · `stripRdw` · `UNKNOWN_PREFIX` · `isUnknownEncoded` · `stripUnknown` · `computeCellStates` · `guardCopy` · `swapQuestionApplies` · `guardedWriteValue` · `replacedFromState` · `guardedWrites` · `restOverRest` · `collectRosterWrites` · `reviewOutcome` · `outcomeHtml` · `personSummary` · `guardedRowHtml` · `unreadableTagClass` · `carryReviewAnswers`

### `roster-review-rows.js`
- **Exports:** `reviewRow`

### `admin-roster-upload.js`
- **Exports:** `normaliseCellValue` · `shiftValueToOverrideType` · `isZeroLengthRange` · `computeCellStates` · `PARSE_ABORT_MS` · `PARSE_EXPECTED_MS` · `parseFailureLine` · `statusFailureLine` · `shiftDisplay` · `manualShiftDisplay` · `_saveOverrideBatches` · `fetchOverridesForWeek` · `initRosterUpload`

### `roster-import-save.js`
- **Exports:** `IMPORT_CHANGED_CODE` · `UNSENT_SAVES_DETAIL` · `saveRosterWrites` · `refusalLine`

### `paycalc-app.js`
- **Exports:** `init`

### `paycalc-result-headline.js`
- **Exports:** `headlineLabels` · `renderResultHeadline` · `renderUnpricedPayslip` · `renderActualCheck` · `renderYtdLine` · `wireYtdLine`

### `paycalc-ytd-card.js`
- **Exports:** `ytdHasFigures` · `refreshYtdSrc` · `updateYtdNote` · `wireYtdCard`

### `paycalc-disclosures.js`
- **Exports:** `setDisclosure` · `toggleDisclosure` · `toggleHoursExtra` · `toggleHppNote` · `toggleBD` · `toggleDisclaimer`

### `paycalc-clear-confirm.js`
- **Exports:** `CLEAR_CONFIRM_MIN_MS` · `createClearConfirm`

### `paycalc-money-banner.js`
- **Exports:** `backPayBannerCopy` · `hppBannerCopy` · `paintBanner` · `wireBannerTicks`

### `paycalc-lightboxes.js`
- **Exports:** `initPaycalcAbout` · `initPaycalcLightboxes`

### `paycalc-periods.js`
- **Exports:** `CONFIG` · `getPeriods` · `periodByNum` · `payslipPeriodNum` · `computeEarliestVisiblePNum` · `payslipsShownTo` · `setEarliestVisiblePeriod` · `getEarliestVisiblePNum` · `visiblePeriods` · `isTaxYearVisible` · `todaysPeriodNum` · `currentPeriodNum` · `viewedPeriod` · `hasBoxingDay` · `bhsForYear` · `hasBankHoliday` · `CONDITIONAL_ROWS` · `updateBhRows` · `_setSelectPeriod` · `appendPayslipOptions` · `offerRecordedPayslip` · `periodLinkMissNote` · `periodPaidInMonth` · `buildPeriodSelect` · `payslipMayBeInHand` · `ytdSourceOffered` · `ytdAutoSource` · `ytdSourceToStamp` · `YTD_SRC_EARLY` · `ytdSourceAfterRetype` · `ytdAnchorStatus` · `buildYtdSourceSelect` · `buildBackPayPeriodSelect` · `updateTyTabs` · `jumpToTaxYear` · `prevPeriod` · `nextPeriod` · `ytdUpdateFrom`

### `paycalc-settings.js`
- **Exports:** `gradeForRole` · `getGradeSetting` · `gradeDaysFor` · `getContr` · `getLoggedMember` · `gradeToOffer` · `renderGradePrompt` · `isPeriodPriced` · `unpricedLineFor` · `getEffectiveContr` · `getProRateFactor` · `isPensionOptedOut` · `applyPensionOptOutUI` · `buildPensionFromSelect` · `periodDefaultPension` · `wirePensionControls` · `getPensionDefault` · `settledRate` · `settledRateFor` · `awardGrade` · `periodRate` · `settingsSummary` · `updateRateForPeriod` · `updateYtdForTaxYear` · `settingsKey` · `saveSettings` · `confirmSettings` · `setSettingsCardOpen` · `paintSettingsForYear` · `wireSettingsCard` · `loadSettings`

### `paycalc-grade-setting.js`
- **Exports:** `getGradeSetting` · `gradeDaysFor` · `isPeriodPriced` · `unpricedLineFor` · `getContr` · `getLoggedMember` · `gradeToOffer` · `renderGradePrompt` · `saveGradeSetting` · `loadGradeSetting`

### `paycalc-grade.js`
- **Exports:** `FROM_ROSTER` · `gradeDays` · `payslipPriced` · `byDays` · `settingFromLegacy` · `windowGrade` · `gradeSplitLine` · `rosterStretches` · `unpricedPayslipLine` · `rosterGradeLine` · `gradeChangeNote`

### `paycalc-roster-hint.js`
- **Exports:** `HM_PAIRS` · `_confBadge` · `snapKey` · `recordCalendarFigures` · `_restoreRosterSuggested` · `updateRosterHint` · `updateJoinerNotice` · `toggleRosterDays` · `clearRosterSuggestedAll` · `_applyRosterSuggestion` · `fillCategoryFromRoster` · `refreshFromCalendarInBackground` · `fillFromRoster`

### `paycalc-hpp-schedule.js`
- **Exports:** `periodsInTaxYear` · `hppPayslipForTaxYear` · `hppTaxYearForPayslip` · `hppPaidInTaxYear`

### `paycalc-hpp.js`
- **Exports:** `resolveHppForPeriod` · `_decodeHours` · `savedPeriodPension` · `_varPayForPeriod` · `hppFromYtdTaxable` · `knownYtdLumps` · `applyHppMode` · `readHppState` · `saveHppState` · `restoreHppState` · `calcHPP` · `priorHppToStore` · `commitPriorHppActual` · `premiumStillToEstimate` · `updatePriorHpp`

### `paycalc-fill-year.js` / `paycalc-year-card.js`
- **Exports of `paycalc-fill-year.js`:** `FETCH_TIMEOUT_MS` · `answerWithin` · `fillablePeriods` · `fillYearFromCalendar` · `fillYearReceipt`
- **Exports of `paycalc-year-card.js`:** `initYearCard` · `renderYearCard`

### `paycalc-year-summary.js`
- **Exports:** `computeYearSoFar`

### `paycalc-backpay.js`
- **Exports:** `_backdatedFromPNum` · `applyBpMode` · `_bpAwardTaxYear` · `prefillBackPay` · `restoreBpState` · `raiseByPercent` · `bpStoryHtml` · `calcBackPay` · `bpState` · `onBackPayChange` · `runCalcBackPay` · `applyBpRisePct` · `refreshBackPayCard` · `syncBackPayForViewedYear`

### `paycalc-backpay-accrual.js`
- **Exports:** `paidInPeriodNum` · `awardWindow` · `_awardBackdateDate` · `awardWindowFactor` · `_accrueBackPayPeriod` · `awardLumpNonPremium`

### `paycalc-format.js`
- **Exports:** `fd` · `fdShort` · `fdLong` · `fmt` · `fmtRate` · `fdList` · `clampMinute` · `minutesFieldText` · `decimalToHM` · `HM_PAIRS` · `isDataEmpty`

### `paycalc-breakdown.js`
- **Exports:** `taxCodeNotRecognised` · `fmtHrsMins` · `buildSummaryRows` · `buildLoanLines` · `ytdMisfitNote` · `buildBreakdownRows` · `buildActualCheck` · `buildActualComparison` · `buildProvChips` · `buildBreakBar`

### `paycalc-form-data.js`
- **Exports:** `emptyPeriodData` · `syncNoSpecialTick` · `pensionToStore` · `readFormData` · `settingFieldsWrite` · `writeFormData`

### `paycalc-inputs.js`
- **Exports:** `numVal` · `numValOr` · `intVal` · `hoursTextToHM` · `hmPair` · `hhmmDec` · `clampMins` · `_decHintEl` · `decimalHoursText` · `decPreview` · `paintTaxCodeWarning` · `commitFocusedField` · `wireIosTap`

### `paycalc-backpay-state.js`
- **Exports:** `BP_FIELDS` · `readBpFields` · `bpFieldWrites` · `resolveAuthoritativeRates` · `blobFitsGrade` · `allRatesOnRecord` · `resolvePaidInPeriod`

### `paycalc-pension.js`
- **Exports:** `parsePensionTimeline` · `serialisePensionTimeline` · `isOptedOutAt` · `withPensionChange` · `withOptOutStartAt` · `withRejoinAt` · `optOutStartsAt` · `migrateLegacyOptOut`

### `paycalc-inventory.js`
- **Exports:** `KEY_KINDS` · `classifyPayKey` · `describePayKey` · `inventoryOf` · `damagedEntries` · `inventoryLines` · `inventorySummary`

### `paycalc-transfer.js`
- **Exports:** `BACKUP_FORMAT` · `BACKUP_VERSION` · `selectBackupKeys` · `summarise` · `buildBackup` · `validateBackup` · `rekeyEntries` · `restoredLine` · `backupFilename` · `applyRestore`

### `paycalc-transfer-card.js`
- **Exports:** `initTransferCard`

### `paycalc-help.js`
- **Exports:** `HELP_CONTENT`

### `paycalc-migrations.js`
- **Exports:** `PAY_DATA_GENERATION` · `memberSlug` · `keyOwnerSlug` · `pcPrefix` · `SK` · `setPaycalcNamespace` · `periodKey` · `parseSavedPeriod` · `readSavedPeriod` · `hppEstKey` · `hppActualKey` · `hppIncKey` · `hppModeKey` · `bpKey` · `ytdPayKey` · `ytdSrcKey` · `ytdTaxKey` · `NOTICE_YTD_KEY` · `NOTICE_HPP_KEY` · `isActualsDev` · `readPayslipActuals` · `writePayslipActuals` · `clearPayslipActuals` · `DEVICE_KEYS` · `RETIRED_DEVICE_KEYS` · `hasPendingLegacyMigration` · `resolveLegacyMigration` · `runMigrations`

### `paycalc-calc.js`
- **Exports:** `P_YR` · `RATE_125` · `RATE_150` · `RATE_300` · `TAX_YEARS` · `TAX_BY_YEAR` · `NI_BY_YEAR` · `SL_BY_YEAR` · `SCOTTISH_TAX_BY_YEAR` · `GRADES` · `PENSION_STEPS` · `AWARD_RATES` · `awardRatesFor` · `awardFromForYear` · `isPreAwardPeriod` · `getRateForPeriod` · `HPP_FRACTION` · `takeHomePay` · `calcBandedTax` · `getTaxYearForOffset` · `taxYearForPeriod` · `periodInTaxYear` · `getThresholds` · `getLondonAllowanceForPeriod` · `getPensionForPeriod` · `calcProRateFactor` · `proRateDays` · `capHours` · `computeGross` · `payslipGross` · `readTaxCode` · `computeTax` · `computeNI` · `computeSL` · `pricePayslip` · `takeHomeInputs`

### `paycalc-roster-suggestions.js`
- **Exports:** `_setOverridesForTest` · `_addBhDateForTest` · `_removeBhDateForTest` · `resetOverrides` · `getOverridesFetchState` · `fetchOverridesForPeriod` · `getRosterSuggestion`

### `firebase-client.js`
- **Exports:** `db` · `collection` · `query` · `where` · `orderBy` · `limit` · `getDocs` · `getDocsFromCache` · `getDoc` · `getDocFromCache` · `onSnapshot` · `addDoc` · `setDoc` · `deleteDoc` · `doc` · `serverTimestamp` · `writeBatch` · `runTransaction` · `deleteField` · `COLLECTIONS` · `isSafeStorageUrl` · `resolveDocumentOpenUrl` · `auth` · `authBootstrap` · `authReady` · `currentUserAfterBoot` · `restoreMemberPersistence` · `signInWithEmailAndPassword` · `signOut` · `onAuthStateChanged` · `withClaimRetry` · `writeWithClaimRetry` · `whenOwnWritesSent` · `whenOwnWritesSentFor` · `VIEWER_WRITES_GRACE_MS` · `letViewerWritesGo` · `normaliseSurname` · `nameToEmail` · `uploadHuddle` · `uploadCircular` · `uploadNewsletter` · `getLatestCircular` · `getLatestNewsletter` · `getLatestHuddle` · `subscribeToLatestHuddle` · `currentAuthUid` · `savePushSubscription` · `deletePushSubscription` · `getStaffContact` · `saveStaffContact` · `deleteStaffContact` · `getAllStaffContacts` · `getPasswordStatus` · `probeResetAtMs` · `savePasswordSetAt` · `getAllPasswordStatus` · `reauthenticateWithPassword` · `changeOwnPassword` · `resetMemberPassword` · `getAccountSetupGaps` · `requestPasswordReset` · `fetchSignedDocumentUrl` · `getSignInStats` · `getResetRequests` · `clearResetRequest` · `logClientError` · `getClientErrors` · `resolveClientError` · `recordPageView` · `recordActiveAccount` · `recordOriginUse` · `recordPerfSample` · `getPerfStats` · `getUsageStats`

### `fetch-timeout.js`
- **Exports:** `FETCH_TIMEOUT_CODE` · `FETCH_ABORTED_CODE` · `DEFAULT_FETCH_TIMEOUT_MS` · `fetchWithTimeout` · `fetchBytesWhileArriving` · `isFetchTimeout` · `isFetchAborted` · `serverRefusal`

### `error-reporter.js`
- **Exports:** `initErrorReporter`

### `usage-reporter.js`
- **Exports:** `recordUsage` · `recordOpen`

### `usage-stats.js`
- **Exports:** `ROLLING_WINDOW_DAYS` · `DAILY_RETENTION_DAYS` · `monthKey` · `prevMonthKey` · `dayKey` · `shouldCountMonth` · `rollingMove` · `recentDayKeys` · `sumDailyWindow` · `orderPageCounts` · `staleDailyKeys` · `originLabel` · `originKey` · `parseOriginKey` · `summariseOrigins` · `staleOriginKeys`

### `perf-reporter.js`
- **Exports:** `markLoginStart` · `clearLoginStart` · `loadFollowedRelease` · `PAGE_READY_MARK` · `markAwaitingInput` · `markMilestone` · `markPageReady` · `recordPageLatency`

### `perf-stats.js`
- **Exports:** `PERF_BUCKETS` · `bucketDuration` · `perfSampleKey` · `parsePerfSampleKey` · `SPEED_GROUPS` · `summarisePerf` · `PERF_DIMENSIONS` · `summarisePerfBy` · `EARLY_ROSTER` · `summariseEarlyRoster` · `EARLY_ROSTER_FROM` · `shareLabel` · `compactPct` · `earlyRosterShareLabel` · `UPDATE_OPENS` · `UPDATE_OPENS_FROM` · `summariseUpdateOpens` · `CLEAN_TIMINGS_FROM` · `shareMeasuredBefore` · `perfRecordFullness` · `THIN_SAMPLE` · `perfVerdict` · `LOGIN_MAX_MS` · `loginDurationBucket` · `createPerfBatcher`

### `auth-identity.js`
- **Exports:** `normaliseSurname` · `nameToEmail` · `surnamePassword` · `credentialCandidatesFor` · `isPasswordMigrated` · `MIN_PASSWORD_LENGTH` · `validateNewPassword` · `newPasswordProblemField` · `passwordChangeFailure` · `isCredentialRejection` · `sessionPredatesReset` · `resetAtFromRestDoc` · `isRestThrottled` · `isRestCredentialRejection`

### `document-url.js`
- **Exports:** `DOCUMENT_URL_ENDPOINT` · `DOCUMENT_URL_TIMEOUT_MS` · `requestSignedDocumentUrl`

### `function-url.js`
- **Exports:** `FUNCTIONS_BASE` · `functionUrl`

### `functions/cell-day-rules.js`
- **Exports:** `BLANK_CELL_TOKEN` · `LONE_DASHES` · `BLANK_READINGS` · `NOT_AVAILABLE_TOKENS` · `NOT_AVAILABLE_SUNDAY_TOKENS` · `SUNDAY` · `isBlankReading` · `isLoneDash` · `isPhysicallyBlank` · `printsNothing` · `isNotAvailable` · `isNotAvailableSunday` · `blankCellMeaning`

### `storage-utils.js`
- **Exports:** `isSafeStorageUrl` · `isDocxUpload` · `officeViewerUrl` · `SIGNED_URL_MARGIN_MS` · `resolveDocumentOpenUrl` · `sixMonthCutoffISO` · `legacyDocPath` · `versionedDocPath` · `uploadMimeType`

### `client-errors.js`
- **Exports:** `APP_SCRIPT_ORIGINS` · `shouldReport` · `CLIENT_ERROR_RETENTION_MS` · `isResolvedErrorExpired` · `expiredResolvedIds` · `orderClientErrors` · `DIAGNOSTIC_PREFIX` · `isDiagnosticEntry` · `capUnresolvedErrors`

### `claim-retry.js`
- **Exports:** `isClaimRetryable` · `isAccessFailure` · `runWithClaimRetry` · `SIGNED_OUT_CODE` · `signedOutLine` · `UNCONFIRMED_CODE` · `UNCONFIRMED_LINE` · `hasUnconfirmedWrite` · `_resetUnconfirmedWrites` · `trackBackgroundWrite` · `backgroundWritesInFlight` · `runGatedWrite` · `unconfirmedWriteLine` · `OWN_WRITES_WAIT_MS` · `ownWritesSent` · `recordsClearOfOwnWrites` · `LEFTOVER_NOTE_MS` · `leftoverNote` · `ownWritesSentFor` · `watchOwnWritesWaits` · `saveFailureMessage` · `abandonOnSignOut` · `runWatchedClaimRetry` · `watchIdentityLoss`

### `page-session.js`
- **Exports:** `LEAVE_QUESTION` · `DISCARD_QUESTION` · `warnOnUnload` · `askBeforeLeavingByDrawer` · `leaveAfterAsking` · `LEAVE_ANSWERED` · `keepDraftWhenHidden` · `onReturnToPage` · `askBeforeSignOut` · `signOutAndLeave` · `reloadIfRestoredForSomeoneElse` · `rebaseRestoreGuard` · `lateReloadAllowed` · `LATE_IDENTITY_NOTICE` · `LATE_RELOAD_GAP_MS` · `SIGNED_OUT_NOTICE` · `guardNamedSession`

### `page-start.js`
- **Exports:** `startPage`

### `unsaved-draft.js`
- **Exports:** `DRAFT_PREFIX` · `DRAFT_MAX_AGE_MS` · `draftKey` · `encodeDraft` · `decodeDraft` · `restoreQuestion` · `draftBaseline` · `weekRestoredLine` · `createDraftSlot`

### `guide-search.js` / `guide-index.js` / `nav-guide-search.js`
- **Exports of `guide-search.js`:** `tokeniseText` · `searchGuideIndex`
- **Exports of `guide-index.js`:** `GUIDE_INDEX`
- **Exports of `nav-guide-search.js`:** `initGuideSearch`

### `operations-tips.js`
- **Exports:** `NEWSLETTER_CARD` · `CARD_TIPS`

### `operations-attention.js`
- **Exports:** `ATTENTION_CATALOGUE` · `attentionBadge` · `buildAttentionItems` · `reportLoginAccounts` · `withdrawLoginAccounts` · `createAttentionStrip`

### `operations-doc-links.js`
- **Exports:** `ROTATE_LINKS_URL` · `docLinksRequestInFlight` · `requestLinkRotation` · `describePreview` · `describeResult` · `checkFailure` · `runFailure` · `initDocLinksCard`

### `operations-reset.js`
- **Exports:** `LOST_PHONE` · `resetQuestion` · `resetFailure` · `resetOutcome`

### `operations-al-sheet.js`
- **Exports:** `alSheetBusy` · `alSheetUnsaved` · `initAlSheetCard`

### `operations-al-save.js`
- **Exports:** `alSaveWorking` · `alSaveUnsaved` · `forgetReview` · `finishPendingLog` · `createReview`

### `operations-doc-uploads.js`
- **Exports:** `initDocumentUploadCards`

### `nav-destinations.js`
- **Exports:** `NAV_PAGES` · `pageName` · `NAV_INFORMATION` · `NAV_GUIDES` · `SECTION_MODS` · `PILL_GATES` · `visiblePills`

### `nav-panel.js`
- **Exports:** `resetNavPanel` · `initNavPanel`

### `nav-panel-markup.js`
- **Exports:** `injectNavPanel`

### `nav-drawer-lightboxes.js`
- **Exports:** `FOCUS_DELAY_MS` · `createDrawerLightboxes`

### `nav-latest-doc.js`
- **Exports:** `createLatestDocOpener`

### `nav-bell.js`
- **Exports:** `wireNavBell`

### `nav-guide-fold.js`
- **Exports:** `wireGuideFold`

### `newsletter-recency.js`
- **Exports:** `NEWSLETTER_RECENT_DAYS` · `NEWSLETTER_LATEST_KEY` · `isRecentIssue` · `newsletterInMenu` · `recordLatestNewsletter` · `noteNewsletterUploaded` · `checkLatestNewsletter`

### `notice-archive.js`
- **Exports:** `noticeDateInFull` · `isNoticeExpired` · `archiveNotice` · `reviseArchivedNotice` · `readArchivedNotices`

### `notif.js`
- **Exports:** `notifOffByChoice` · `isIOS` · `isStandalonePWA` · `onPagesMirror` · `notifSupported` · `getNotifState` · `peekNotifState` · `enableNotifications` · `disableNotifications` · `releaseDevicePush`

### `print-guard.js`
- **Exports:** `PRINT_UNAVAILABLE_TEXT` · `OPEN_IN_SAFARI_LABEL` · `printIsBlocked` · `openInSafari` · `printOrExplain` · `explainNoPrint`

### `clock-input.js`
- **Exports:** `isClockTime` · `formatClockInput` · `finaliseClockInput` · `noteClockBoxBefore` · `shapeClockBox` · `shapeClockBoxInPlace` · `settleClockBox` · `clockTextStatus` · `readClockBox` · `timePairError` · `composeTimedValue`

### `override-utils.js`
- **Exports:** `nextLeaveYear` · `isRestShift` · `OTHER_FLAVOURS` · `OTHER_RDW_DEFAULT_MINS` · `isOtherValue` · `parseOtherValue` · `composeOtherValue` · `resolveOtherPay` · `LEGACY_OVERRIDE_TYPES` · `CONTRACTED_WORK_TYPES` · `VOLUNTARY_WORK_TYPES` · `isContractedWorkOverride` · `contractEvidence` · `isOverrideDisplaySuppressed` · `isChristmasOrBoxingDay` · `mergeBookedPeriods` · `tsToMillis` · `isBeforeMemberStart` · `toOverrideRecord` · `collectOverrideRecords` · `buildOverrideWrite` · `buildOverrideCacheRecord` · `nextReplacedType` · `shouldReplaceOverride` · `withOutrankedManualCopies` · `reconcileRangeIntoCache` · `computePeriodDeleteIds` · `resolveEffectiveShift` · `SUNDAY_FORBIDDEN_TYPES` · `isForbiddenOnSunday` · `manualCellValue` · `sundaySafeValue` · `chunkByWrites`

### `other-day.js`
- **Exports:** `isRestShift` · `OTHER_FLAVOURS` · `OTHER_RDW_DEFAULT_MINS` · `isOtherValue` · `parseOtherValue` · `composeOtherValue` · `resolveOtherPay`

### `guide-chips.js`
- **Exports:** none

### `fip-guide.js`
- **Exports:** none

### `guide-print.js`
- **Exports:** none

### `guide-back.js`
- **Exports:** none

### `legacy-redirect.js`
- **Exports:** none

### `ls.js`
- **Exports:** `lsGet` · `lsSet` · `lsDel` · `lsSetVerified` · `lsMove` · `lsDelVerified` · `lsSetBothVerified` · `lsAvailable` · `lsKeys` · `requestPersistentStorage`

### `storage-keys.js`
- **Exports:** `SELECTED_MEMBER` · `TEAM_VIEW` · `CALENDAR_SNAPSHOT` · `NOTIF_PROMPT_DONE` · `PW_FORCE_PENDING_PREFIX` · `SW_UPDATE_RELOAD`

### `status-text.js`
- **Exports:** `STATUS_GLYPHS` · `splitStatusGlyph` · `setStatus` · `speakAfterMount`

### `paycalc-sticky-total.js`
- **Exports:** `stickyBarShows` · `scrollToClearBar` · `initPaycalcStickyTotal`

### `paycalc-role-card.js`
- **Exports:** `PAYCALC_GUIDE_URL` · `unsupportedRoleCopy` · `paintRoleCard` · `PAYCALC_SIGN_IN_ABOUT`

### `admin-week-swipe.js`
- **Exports:** `initAdminWeekSwipe`

### `overtime-review-controller.js`
- **Exports:** `createReviewController`

### `links-design-library.js`
- **Exports:** `createDesignLibrary`

### `links-design-store.js`
- **Exports:** `isOfflineFailure` · `createDesignStore`

### `links-queued-saves.js`
- **Exports:** `createQueuedSaves` · `refusedMakeLine` · `stillUnsaved`

### `upload-commit.js`
- **Exports:** `resolveUploadCommit`

### `doc-retention.js`
- **Exports:** `pruneOldDocs`

### `analytics-client.js`
- **Exports:** `buildAnalyticsClient`

### `own-password.js`
- **Exports:** `buildPasswordClient` · `SAVE_TIMEOUT_MS` · `withTimeout` · `settleOrTimeout` · `runPasswordSave`

### `account-calls.js`
- **Exports:** `RESET_NOT_SENT` · `buildAccountCalls`

### `documents-client.js`
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

### `shared.css`
The CSS every app page shares (the guides load none of it): the `:root` tokens — colours, surfaces, motion, the type scale, and `--font-sans` with the self-hosted Inter — and the shared components, from `.app-header` and the drawer to the lightboxes, buttons, pills, `.touch-only` and the shared `@media print` rules. Never hardcode a hex colour (`css-hex-parity.test.mjs`). Tokens, surfaces, motion, the header and the control recipes: `.claude/rules/css-tokens.md`.

### `service-worker.js`
- **Exports:** none

### `roster-cycle-data.js`
- **Exports:** `weeklyRoster` · `bilingualRoster` · `fixedRoster` · `FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS` · `cesRoster` · `dispatcherRoster`

### `roster-member-data.js`
- **Exports:** `teamMembers`

### `pay-audience.js`
- **Exports:** `pricedGradeOn` · `heldPricedGrade` · `payCalculatorPrices` · `sentPayReminder`

### `roster-roles.js`
- **Exports:** `roleOn` · `rolesInRange`

### `functions/index.js`
- **Exports:** `sendNewlinkVoteReminderNotification` · `parseRosterPDF` · and every endpoint `buildDocumentEndpoints`, `buildAuthEndpoints` returns

### `index-endpoints.test.mjs`

### `functions/documents.js`
- **Exports:** `buildDocumentEndpoints`

### `functions/huddle-ingest.js`
- **Exports:** `buildIngestHuddle`

### `functions/newlink-reminder.js`
- **Exports:** `NEWLINK_VOTE_REMINDER_DAY` · `NEWLINK_VOTE_REMINDER_BODY` · `NEWLINK_VOTE_SEND_RECORD` · `newlinkReminderMembers` · `sendNewlinkVoteReminder` · `buildNewlinkVoteReminderNotification`

### `functions/pay-reminder.js`
- **Exports:** `PAY_REMINDER_GRADES` · `payReminderMembers` · `sendPayReminder` · `uidForMember`

### `functions/error-log-notify.js`
- **Exports:** `notifyAdminOfErrorLog`

### `functions/error-log-notice.js`
- **Exports:** `DIAGNOSTIC_PREFIX` · `NOTICE_GAP_MS` · `NOTICE_SCAN_LIMIT` · `isSlowSave` · `noticeDue` · `summariseNewEntries` · `noticeWords`

### `functions/huddle-retention.js`
- **Exports:** `pruneOldHuddles` · `sweepHuddleOrphans` · `HUDDLE_RETENTION_MONTHS` · `HUDDLE_ORPHAN_MIN_AGE_MS`

### `functions/auth-endpoints.js`
- **Exports:** `buildAuthEndpoints`

### `functions/account-reads.js`
- **Exports:** `buildAccountReadEndpoints` · `listAllUsers`

### `functions/admin-recipients.js`
- **Exports:** `enabledAdminUids` · `isMembersOwnAccount`

### `functions/account-rules.js`
- **Exports:** `parseSetupActionFlags` · `resolveRosterAuthConfig` · `claimsForTier` · `summariseSignIns` · `computeOrphanLabels` · `MANAGED_CLAIMS` · `summariseAccountGaps`

### `functions/account-lifecycle.js`
- **Exports:** `passwordWriteRefused` · `unwrittenResetAnswer` · `elevatedClaimsLost` · `ELEVATED_CLAIMS` · `disabledLeaverUids` · `sweepAgainstPreview`

### `functions/reset-request.js`
- **Exports:** `buildResetRequestEndpoint`

### `functions/reset-request-rules.js`
- **Exports:** `shouldRecordResetRequest` · `shouldNotifyAdmin` · `buildResetRequestNotice`

### `functions/retired-viewer-account.js`
- **Exports:** `CALENDAR_VIEWER_UID` · `isViewerAccount`

### `functions/push.js`
- **Exports:** `getWebPush` · `setupWebPush` · `sendTargetedPush` · `fanOutPush` · `releasePushForOwner` · `pushSendOptions` · `PUSH_TTL_BY_TAG`

### `functions/push-guards.js`
- **Exports:** `shouldDeleteSubscription` · `isAllowedPushEndpoint` · `PUSH_SERVICE_HOSTS`

### `functions/push-notices.js`
- **Exports:** `NOTIFICATION_FEATURES` · `PASSWORD_RESET_BODY` · `buildPushPayload`

### `functions/roster-geometry.js`
- **Exports:** `settledGeometry` · `GEOMETRY_WAIT_BUDGET_MS` · `GEOMETRY_WORK_BUDGET_MS` · `awaitGeometryWithin` · `GRID_COLUMNS` · `rulesFromOperatorList` · `assignRunsToGrid` · `readGridPage` · `extractRosterGeometry` · `matchGeometryRow` · `geometryCoverage` · `applyGeometryWitness` · `_isClaim` · `_nameTokens` · `_PATH_OP`

### `functions/roster-other-days.js`
- **Exports:** `OTHER_DAY_ALIASES` · `readOtherDayCell` · `meetingWithTimes` · `namesMeeting`

### `functions/roster-sunday-repair.js`
- **Exports:** `applySundayScanCorrections` · `settleDisputedSundays`

### `functions/roster-week-heading.js`
- **Exports:** `weekEndingsOnPage` · `checkSheetWeek`

### `functions/roster-prompt.js`
- **Exports:** `DAY_LABELS` · `SHIFT_VOCABULARY` · `buildCellTable` · `renderCellTable` · `buildCellPrompt` · `reviewBlankReadsOfFilledCells` · `reviewRestReadsOfEmptyCells` · `repeatedMembers` · `MODEL_REQUEST` · `DECLINED_ERROR`

### `functions/roster-parse-helpers.js`
- **Exports:** `normaliseShift` · `fileSignatureMatches` · `buildWeekDates` · `extractAIJson` · `HEADER_TO_INDEX` · `headerToDayIndex` · `mapColumnHeadersToDates` · `memberRows` · `buildSafeEntries` · `BLANK_CELL_TOKEN` · `isPhysicallyBlank` · `applyColumnScanCrossCheck` · `normaliseScanValue` · `reviewLabel` · `parseStrictIsoDate` · `isPayCutoffDay` · `nameToEmail` · `nameToPassword` · `surnameCore` · `NOTIFICATION_FEATURES` · `buildPushPayload`

### `calendar-notif-prompt.js`
- **Exports:** `initNotifPrompt`

### `install-prompt.js`
- **Exports:** `onPagesMirror` · `installRoute` · `promptInstall` · `yieldToInstallNotice` · `releaseInstallNoticeYield` · `retireInstallStrip` · `installNoticeHasTheVisit` · `initInstallPrompt`

### `text-scale.js`
- **Exports:** `LARGE_FROM` · `COMPACT_FROM` · `LARGE_VALUE` · `COMPACT_VALUE` · `tierFor` · `measureTextScale` · `applyTextScale`

### `calendar-doc-access.js`
- **Exports:** `hasDocumentAccess` · `onDocumentAccess` · `documentAccess` · `_clearDocumentSubscribersForTests`

### `calendar-access-state.js`
- **Exports:** `hasCalendarAccess` · `grantNumber` · `setCalendarAccess` · `onCalendarAccess`

### `calendar-redraw.js`
- **Exports:** `GESTURE_POLL_MS` · `START_STAGES` · `createRedrawScheduler`

### `calendar-drawer.js`
- **Exports:** `calendarDrawerOptions` · `wireCalendarDrawer` · `rewireCalendarDrawer`

## What not to do, and the version bump

Both are `CLAUDE.md`'s, which every session loads: "Architecture decisions — never change without discussion",
"Key rules" and "Version bumping (MANDATORY on every change)". A module's own "do not" lives in its header;
an import cycle is refused by `import-graph.test.mjs`.
