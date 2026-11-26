# File index — what every file in the repo IS

*Split out of `CLAUDE.md` on 11 Sep 2026. Not version-stamped; not a runtime asset.*

**This is a LOOKUP TABLE, and that is why it is no longer in `CLAUDE.md`.** It answers one question —
*what is this file, and where does its reasoning live* — for every file in the repo. A session changing Pay
Calculator CSS does not need the roster parser, the Overtime endpoints and the FIP guide tests
described to it, and until this split every session paid for all of them on every task: the catalogue
was ~200,000 characters, 64% of a document loaded into every single session regardless of relevance.

**The discipline that governs it has not changed** — it is still a routing table, entries are still
capped, and it still may not accumulate release history. `doc-parity.test.mjs` enforces all of that
here exactly as it did in `CLAUDE.md`, and the rules themselves stay in `CLAUDE.md` → "Current file
structure", beside the three-homes table that explains them. Read that before adding an entry.
A row says what the file IS, what it owns and where its reasoning lives — nearly always the file's
own header — so an argument a row starts to need goes into that header first, and the row keeps the
pointer.
An export list is not a row's business either: `AI_MAP.md`'s generated export line is the record. Only
the five documents on the `CLAUDE.md · docs/AI_MAP.md · …` row are version-stamped, and no `.md` is a
runtime asset, so the document rows do not say so one by one.

**When you add, remove or rename a module you must update this file AND `docs/AI_MAP.md`, in the same
commit.** `npm run generate:file-index` does this file's half: it writes the new module's row from the opening
line of its header, among the rows it shares a name with, and takes out the row of a module that has gone. Improve
a written row's words by hand like any other; it is never rewritten. `githooks/pre-commit` checks both, and it now looks for a module here rather than in
`CLAUDE.md`. `AI_MAP.md` holds each module's purpose and pointers, and a generated export line (`npm run generate:ai-map`); this says only what a file is.

```
roster-app/
├── index.html              ← main PWA app (HTML + CSS only)
├── admin.html              ← staff self-service portal: AL booking, absence, override list
├── operations.html         ← admin-only Operations page: the Needs-attention strip, the document upload cards and links, the Roster upload, the Annual leave sheet, reset requests, account status, Staff Login Accounts, Error Log, Usage and App Speed
├── settings.html          ← the Settings STATUS page: Your account, This device, Your data — cards open by their state; what each state means is settings-status.js
├── paycalc.html            ← pay calculator (HTML + CSS only)
├── calendar-app.js         ← coordinator for index.html: event wiring, the Prev/Next/Today buttons, the access hooks, notification wiring. See also calendar-loading.spec.js, calendar-redraw.test.mjs.
├── calendar-state.js       ← display month/year state for index.html (getters/setters + persistViewedMonth). See also calendar-state.test.mjs.
├── calendar-swipe.js       ← Pointer Events swipe carousel for index.html: initSwipeHandler, isSwipeCooldown. See also calendar-swipe-redraw.spec.js.
├── calendar-al-lightbox.js ← the Calendar's annual-leave panel and day-detail panel (`initCalendarLightboxes`); every badge on the day panel comes from the grid's own authorities. Reasoning: its header. Tested by calendar-al-lightbox.test.mjs. See also lightbox-transform-parity.test.mjs, day-detail-explains.test.mjs.
├── calendar-initial-fetch.js ← the Calendar's initial three-month override read and the sync chip: two-phase, cache first then the server (AUTH_PLAN.md → E1). See also calendar-initial-fetch.test.mjs.
├── calendar-keyboard.js    ← keyboard navigation, the page shortcuts (`initCalendarShortcuts`: they press the page's own buttons) and the hover tooltip for index.html. See also calendar-keyboard.test.mjs, calendar-swipe-redraw.spec.js, calendar-day-detail.spec.js.
├── calendar-month-jump.js  ← the month/year jump picker opened from the month heading (`initMonthJump`). Tested by calendar-month-jump.test.mjs. See also calendar-access.spec.js.
├── calendar-access.js ← the Calendar's ACCESS GATE: the sign-in front door or the member's come-back card, `calendarAccessReady`; only a named member is granted, and its teardown signs a leftover staff-PIN session out. **Read its header first.** Tested by calendar-access.test.mjs. See also AUTH_AND_SESSIONS.md, calendar-access.spec.js.
├── calendar-lock-slot.js ← the ONE place a card can stand in for the Calendar grid, and the workspace it hides; at most one card, no decisions. Exercised through calendar-access.test.mjs and e2e/calendar-access.spec.js
├── calendar-lock-cards.js ← the cards that can stand where the Calendar goes (sign-in, its can't-load fallback, come-back): it DRAWS, `calendar-access.js` DECIDES. Its header
├── calendar-access-core.js ← the PURE rules behind the gate: the viewer identity (for the teardown), `decideAccess`, notice audiences (members only). **No client file shapes, sends or compares a PIN.** Tested by calendar-access-core.test.mjs. See also CALENDAR_DATA.md.
├── calendar-snapshot.js ← the member's OWN roster kept on this device so the Calendar opens instantly while sign-in is checked; bounded, deleted on any refusal. Tested by calendar-snapshot.test.mjs and e2e/calendar-access.spec.js
├── calendar-own-copy.js ← WHEN the Calendar shows and keeps that copy: the renderer's source, the paint before the grant, the save after a render, and which records are kept (`ownMonthsToStore`). Tested by calendar-own-copy.test.mjs and e2e/calendar-access.spec.js
├── calendar-data-state.js  ← what the Calendar KNOWS about a month's overrides, and so what it may SHOW. Pure; the four states: its header. Tested by calendar-data-state.test.mjs. See also CALENDAR_DATA.md.
├── calendar-legend.js ← the month legend: which keys apply and whether a legend applies at all. Reasoning: its header. Tested by calendar-legend.test.mjs
├── calendar-overrides.js   ← the Calendar's Firestore override cache: range fetches, the phase-1 cache read, the access gate, the read ticket and the write ordering — each rule argued beside its code. See also calendar-overrides.test.mjs.
├── calendar-notices.js     ← the Calendar page's one-time notices (`initCalendarNotices`); new index.html notices land here. Live ones: the new-notice skill
├── calendar-member.js      ← team member selection for index.html (dropdown, current member, stale-name handling). See also calendar-member.test.mjs.
├── calendar-renderer.js    ← calendar cell/grid building for index.html, what a month shows (`monthOnScreen`, which the legend asks too), plus the pure helpers the day panel reads back. See also calendar-renderer.test.mjs, calendar-day-detail.spec.js, calendar-loading.spec.js.
├── calendar-huddle-viewer.js    ← the Huddle viewer overlay (`#huddle`), including the per-table scroll boxes. See also calendar-huddle-viewer.test.mjs.
├── huddle-table-grid.js ← which Huddle cells are really in COLUMN 1, walking the grid as the browser does. Pure. Tested by huddle-table-grid.test.mjs. See also pages.spec.js.
├── calendar-doc-viewer.js  ← the Circular/Newsletter in-app viewer (`#circular` / `#newsletter`), separate from the Huddle viewer. See also calendar-doc-viewer.test.mjs.
├── nav-panel.js            ← the shared nav drawer's COORDINATOR: open/close, its one history entry, the delegated click, the Tab trap, sign-out, the reset; wires the five below. See also nav-panel.test.mjs, coordinator-ratchet.test.mjs.
├── nav-panel-markup.js     ← the drawer's HTML, drawn from what nav-destinations.js lists. See also nav-panel.test.mjs, firestore-contract-parity.test.mjs.
├── nav-drawer-lightboxes.js ← the drawer's info panel and App Notices, and the one lifecycle they share (never createLightbox). See also nav-panel.test.mjs.
├── nav-latest-doc.js       ← the drawer's Circular and Newsletter rows: open the latest issue in one tap. See also nav-panel.test.mjs.
├── nav-bell.js             ← the drawer footer's notification bell; the push logic is notif.js's. See also nav-bell.test.mjs.
├── nav-guide-fold.js       ← the drawer's Reference fold and the guide search's lazy load. See also nav-guide-fold.test.mjs, guide-index-parity.test.mjs.
├── nav-destinations.js     ← the drawer's destinations and pill gates as DATA; imports nothing
├── newsletter-recency.js   ← whether the ☰ menu offers the Marylebone Newsletter (latest issue under six weeks old). See also calendar-documents.spec.js, operations.spec.js.
├── notice-archive.js       ← the App Notices archive's rules and its never-throwing read. See also notice-archive.test.mjs.
├── guide-search.js         ← the PURE rules of cross-guide search, including the one tokeniser shared with the index generator. Tested by guide-search.test.mjs
├── guide-index.js          ← GENERATED cross-guide search index — do NOT hand-edit; `npm run generate:guide-index` with any guide-content change. Pinned by guide-index-parity.test.mjs
├── nav-guide-search.js     ← the drawer's guide search box, lazy-loaded with the index on first focus
├── install-prompt.js ← the one-off "add to home screen" strip on the Calendar, plus `installRoute`; never shown with the notification prompt. Its header. See also install-route.test.mjs.
├── calendar-notif-prompt.js ← the Calendar's one-off notification prompt and the silent subscription renewal; never for a leftover staff-PIN viewer. Its header. Tested by calendar-notif-prompt.test.mjs
├── calendar-doc-access.js ← whether this Calendar may read the DOCUMENTS (Huddle, Circular, Newsletter): the gate their viewers and drawer links consult, read from `calendar-access-state.js`. Its header. Tested by calendar-doc-access.test.mjs
├── calendar-access-state.js ← whether Calendar access is HELD right now — the one copy, with one write, read by both the roster gate and the document gate. Its header. Tested by calendar-access-state.test.mjs
├── calendar-redraw.js ← WHEN the Calendar page may draw and what its next draw owes (start-up stages, the swipe wait, owed focus); draws nothing. Its header. Tested by calendar-redraw.test.mjs. See also calendar-swipe-redraw.spec.js.
├── calendar-drawer.js ← the Calendar's menu for the saved session, and its rebuild after an in-place sign-in. Its header. Tested by calendar-drawer.test.mjs and e2e/calendar-access.spec.js
├── text-scale.js ← how much larger the phone draws text than the stylesheet asks, and the tier the Calendar's rows key on (`data-text-scale`). Its header. Tested by text-scale.test.mjs. See also calendar-phone-layout.spec.js.
├── notif.js                ← shared Web Push: support and state, enable/disable, sign-out release, and the platform reads (iOS, standalone, Pages mirror). See also notif.test.mjs.
├── select-sheet.js ← the app's OWN dropdown in place of the OS's; the native `<select>` stays as the value holder. The rules an edit can break: its header and select-sheet-parity.test.mjs. Tested by select-sheet.test.mjs and select-sheet-pick.test.mjs. See also calendar-member-picker.spec.js.
├── overlay.js              ← the overlay layer's front door: `createLightbox`, the scroll lock, `openNoticeIfClear` and the in-app confirm/prompt dialogs; re-exports the four below, so every import comes from here. See also overlay.test.mjs, overlay-history.test.mjs.
├── overlay-history.js      ← the Android Back stack, `whenHistorySettled` and `followLinkOutOf`; re-exported by overlay.js. Tested by overlay-history.test.mjs
├── overlay-focus.js        ← the Tab trap and the guard for focus moves no key reports; re-exported by overlay.js. See also overlay.test.mjs.
├── overlay-panel-scroll.js ← a scrolling panel's "more below" fade and its pinned ✕; re-exported by overlay.js. See also overlay.test.mjs.
├── card-collapse.js        ← a card's collapsible header and the deep link that opens a collapsed card by name; re-exported by overlay.js
├── date-picker.js          ← the brand-styled single-date picker over a hidden native `<input type="date">`. **Its CSS is in `shared.css`**
├── date-format.js          ← the app's OWN date vocabulary and month/day tables (roster-data.js re-exports `DAY_NAMES`, `MONTH_ABB` and `MONTH_NAMES`). Pure. Tested by date-format.test.mjs and month-vocabulary-parity.test.mjs
├── about-lightbox.js       ← the shared About panel, plus `wireHeaderLogo` — the only wiring of a sub-page's header logo. Used by every app page
├── tips-lightbox.js        ← the shared per-card Tips panel. See also tips-content.test.mjs.
├── glossary.js            ← "Words used in the app": the roster words, one line each, and which `?` panels link to them; shown in the page's Tips panel. See also glossary.test.mjs, e2e/glossary.spec.js.
├── login-overlay.js        ← the shared in-place sign-in overlay for every page that signs in, as a modal or inline (the Calendar's front door). Its header. See also auth.spec.js, calendar-access.spec.js.
├── login-core.js           ← the sign-in card's DOM-free rules, including the 30-second typed sign-in deadline (`SIGN_IN_GIVE_UP_MS`) and the set-password marker's hold; login-overlay.js re-exports them. Tested by login-overlay.test.mjs
├── password-force.js ← the MANDATORY "set your own password" overlay (PASSWORD_DESIGN.md Phase 2). **It FAILS OPEN** — its header says why. Tested by password-force.test.mjs and password-force-wiring.test.mjs. See also page-contract-parity.test.mjs.
├── session.js              ← shared auth/session: re-establishing the Firebase session, the pre-warm, the local session, and the named-vs-anonymous identity signals. See also coordinator-ratchet.test.mjs.
├── staff-pin-ended.js      ← whether arriving on this page signed out a leftover session of the retired staff PIN, and the one sentence that says so; transition plumbing. Its header. Tested by session.test.mjs and login-overlay.test.mjs. See also calendar-access.spec.js.
├── silent-sign-in.js      ← the RULES of the sign-in nobody typed (pure); session.js keeps the memory. Its header. Tested by session.test.mjs. See also AUTH_AND_SESSIONS.md.
├── viewer-shed.js         ← signs a leftover staff-PIN viewer out before a member signs in, in the order that keeps it out of long-lived storage. Its header. Tested by session.test.mjs
├── auth-state-core.js      ← the PURE identity state machine (AUTH_AND_SESSIONS.md → Architecture). Tested by auth-state-core.test.mjs
├── auth-state.js           ← the auth STORE over that reducer; session.js feeds it. AUTH_AND_SESSIONS.md → Architecture. See also auth-state.test.mjs, session.test.mjs.
├── auth-policy.js          ← page AUTHORISATION: the page policies and the drawer's pill gates. CLIENT UX only — the server rules are the boundary. See also AUTH_AND_SESSIONS.md, auth-policy.test.mjs, page-contract-parity.test.mjs.
├── sw-register.js          ← shared service-worker registration and update lifecycle. Reasoning beside each rule. Tested by sw-register.test.mjs
├── splash-watchdog.js      ← CLASSIC (non-module) recovery script for index.html, so it runs even when the module graph fails: one guarded reload, then a Reload / Reset-cache panel. Tested by splash-watchdog.test.mjs
├── error-reporter.js       ← the shared uncaught-error reporter, writing to Firestore `clientErrors`; its header has the four call shapes. See also error-reporter.test.mjs.
├── fetch-timeout.js ← the time bound on every Cloud Function call, and on a file read by silence. **A timed-out WRITE is never reported as not having happened.** Tested by fetch-timeout.test.mjs
├── usage-reporter.js ← the shared anonymous usage recorder (no identity stored). Tested by usage-reporter.test.mjs
├── usage-stats.js          ← pure usage maths behind the Usage card
├── perf-reporter.js        ← the shared anonymous latency recorder behind the App Speed card; only time somebody spent waiting is counted. See also perf-reporter.test.mjs.
├── perf-stats.js           ← pure latency maths behind the App Speed card
├── calendar-team-view.js        ← Team Week View; its overrides come from the SHARED month fetch, with no Firestore read of its own. See also CALENDAR_DATA.md, team-week-start.test.mjs, calendar-team-view.spec.js.
├── calendar-tips.js             ← CARD_TIPS for Team Week View's `?`, in the shared Tips panel (tips-lightbox.js). See also tips-content.test.mjs.
├── al-contract.js ← a member's CONTRACT leave allowance for a year; read it through `entitlementFor`. Pure; tested by al-entitlement.test.mjs
├── al-entitlement.js ← which annual-leave days consume entitlement and where that leaves a member — the ONE answer every surface asks. Its header. Pure; tested by al-entitlement.test.mjs
├── al-leave-file.js ← THE LEAVE FILE: the sealed contract between the session that reads the clerks' workbook and the Operations card. Pure; tested by al-leave-file.test.mjs
├── al-leave-compare.js ← the leave sheet beside the app, person by person and day by day, judged by the app's own rules; writes nothing. Pure; tested by al-leave-compare.test.mjs. See also operations.spec.js.
├── al-leave-plan.js ← what one Save of the Annual leave sheet writes, its upload log and Undo. Pure; tested by al-leave-plan.test.mjs
├── al-leave-save.js ← the Annual leave sheet's Save against Firestore, the upload log and the Undo. Tested by al-leave-save.test.mjs
├── al-leave-words.js ← every sentence the Annual leave sheet card says. Pure; tested by al-leave-words.test.mjs
├── christmas-leave.js ← Christmas Day and Boxing Day leave and the Boxing Day lieu day, derived, never stored; `resolveDayShift` is what every surface calls. Its header. Pure; tested by christmas-leave.test.mjs. See also CALENDAR_DATA.md, calendar-leave-panel.spec.js, admin-leave-records.spec.js.
├── leave-year.js ← WHICH YEAR'S ALLOWANCE a day of leave comes out of (a January day may carry `leaveYear`). Pure; tested by leave-year.test.mjs
├── admin-leave-year.js ← the Admin AL card's "Which year's allowance" panel; draws, decides nothing. Tested by admin-leave-year.test.mjs
├── admin-leave-year-save.js ← the save behind that panel, in one checked transaction. Tested in admin-overrides.test.mjs
├── admin-al-year.js ← WHICH YEAR the Admin AL figures describe. Pure; tested by admin-al-year.test.mjs
├── admin-al-projection.js ← WHAT AN AL BOOKING WILL DO, decided once for preview, warning and write. Its header. Tested by admin-al-projection.test.mjs. See also admin-overrides.test.mjs.
├── admin-week-row-state.js ← what a week-grid row looks like in each state, and a week's staged rows as draft data; works from the row element alone. See also admin-week-editor.test.mjs, admin-own-write.test.mjs, admin-overrides.test.mjs.
├── admin-day-pills.js ← which changes one week-grid day takes, refused at its pills (layer 1 of the Sunday rule). Its header. See also admin-day-pills.test.mjs.
├── admin-own-write.js ← what the page's own write does to the week on screen: only the touched days redraw. Its header
├── admin-bulk-apply.js ← what the week card's bulk Apply is waiting for, and the days it left alone; not a layer of the Sunday rule
├── admin-time-inputs.js ← the Admin week grid's time boxes. Its re-entry guard is load-bearing on iOS — the header says why. See also admin-week-grid.spec.js.
├── admin-week-collect.js ← what one press of the week grid's Save asks to write (Sunday rule layer 6). Its header. Tested by override-utils.test.mjs
├── admin-al-week-save.js ← what one week-grid save does about its annual leave, and the same for a Saved Changes delete. Its header. Pure; tested by admin-al-week-save.test.mjs
├── overtime-sunday-release.js ← asking to be taken off a rostered Sunday: a request that grants nothing. Pure; tested by overtime-sunday-release.test.mjs
├── overtime-phase.js ← where the Overtime week stands, in the member's terms (words for TIME); re-exported from overtime-format.js. Pinned by overtime-format.test.mjs. See also OVERTIME_AVAILABILITY.md.
├── overtime-answer.js ← the one place a day's answer is edited on the Overtime form. Its header. Pure; tested by overtime-answer.test.mjs. See also overtime.spec.js.
├── al-swapped-days.js ← which days in an AL booking need the swapped-day question, and the rest days an absence range leaves alone. Its header. Pure; tested by al-swapped-days.test.mjs and e2e/admin-rest-day-swap.spec.js
├── admin-al-spare-note.js ← the one sentence the AL booking preview says about Spare days. Pure; tested by admin-al-spare-note.test.mjs and e2e/admin-leave-spare.spec.js
├── admin-period-dates.js ← what a run of booked dates is and how it reads. **A gap is not a day off.** Pure; tested by admin-period-dates.test.mjs
├── admin-booked-periods.js ← the recorded-dates list on admin.html and which year of it is shown. Its header. Tested by admin-booked-periods.test.mjs
├── admin-period-delete.js ← a Recorded-dates row's ✕: what one period delete does, in order, every dependency injected. Its header. Tested by admin-period-delete.test.mjs
├── admin-confirm-bar.js ← the over-allowance question's bar on admin.html: whose question it is, and what Save anyway does. Its header. Tested by admin-confirm-bar.test.mjs
├── two-tap.js ← the two-tap destructive control (arm, then confirm), shared by Admin's lists and Operations. Its header. Tested by two-tap.test.mjs
├── feedback-line.js ← a feedback line's one fade, cancelled by every later write to it. Tested by two-tap.test.mjs
├── print-guard.js      ← whether `window.print()` can do anything here (it does nothing in an iOS home-screen app); every print control goes through `printOrExplain`. Tested by print-guard.test.mjs. See also print.spec.js.
├── clock-input.js      ← the rules of a TEXT clock box, shared by every page with one, and each box's memory of whether its digits are an EDIT. Tested by clock-input.test.mjs
├── override-utils.js   ← override, member-start and shift helpers, including `resolveEffectiveShift` (the override→display ladder); re-exports other-day.js. See also coordinator-ratchet.test.mjs.
├── other-day.js        ← the Other-day value grammar (`OTHER_FLAVOURS`, parse/compose) and how one pays (`resolveOtherPay`); `isRestShift`. Pure; tested by override-utils.test.mjs. See also firestore-contract-parity.test.mjs.
├── admin-app.js            ← coordinator for admin.html; its body is an exported `init()` run by admin-boot.js. See also coordinator-ratchet.test.mjs.
├── admin-tips.js           ← CARD_TIPS for admin.html's `?` panels. Pure data
├── admin-boot.js           ← two-line bootstrap for admin.html (CSP blocks inline module scripts)
├── operations-app.js       ← coordinator for operations.html: session guard, upload and account cards; body is `init()`, run by operations-boot.js. See also coordinator-ratchet.test.mjs.
├── operations-reports.js   ← what the Operations reporting cards SHARE; owns no card, and is not a re-export barrel (its header says why)
├── operations-errors.js    ← the Error Log card, with a no-silent-caps banner and a bug-report copy
├── operations-usage.js     ← the Usage card: page and document opens, active accounts, the exact sign-in figures
├── operations-speed.js     ← the App Speed card; the rules every figure keeps: its header
├── operations-attention.js ← the "Needs attention" strip on operations.html: an index of exceptional card states that runs no reads and owns no navigation. Tested by operations-attention.test.mjs and e2e/operations.spec.js
├── operations-reset.js     ← what Account status's Reset asks (incl. the lost-phone box) and every sentence about its answer. Pure; tested by operations-reset.test.mjs and e2e/operations.spec.js
├── operations-doc-links.js ← the Document links card (Check, then Replace) and the words of every outcome; the work is functions/doc-link-rotation.js. Tested by operations-doc-links.test.mjs and e2e/operations.spec.js
├── operations-al-sheet.js ← the Annual leave sheet card: a leave file in, each member's records read whole, every difference drawn as text; nothing kept. Driven by e2e/operations.spec.js
├── operations-al-save.js ← that card's Save: per-person confirmations, the receipt and the Undo. Driven by e2e/operations.spec.js
├── operations-doc-uploads.js ← the Circular and Newsletter upload cards' configuration; the card itself is doc-upload.js
├── operations-tips.js      ← CARD_TIPS for operations.html's `?` panels. Pure data. See also operations.spec.js.
├── operations-boot.js      ← two-line bootstrap for operations.html (CSP blocks inline module scripts)
├── settings-status.js ← what the Settings cards' states MEAN and which open; runs no reads. **Silence is not success.** Pure; tested by settings-status.test.mjs. See also settings.spec.js.
├── settings-app.js         ← coordinator for settings.html; body is `init()`, run by settings-boot.js; driven by e2e/settings.spec.js
├── settings-tips.js        ← CARD_TIPS for settings.html's `?` panels. Pure data. See also tips-content.test.mjs, settings-status.test.mjs.
├── settings-password-card.js ← the Settings Password card: migration status and the change-password form; `passwordSaving()` holds the reload and sign-out. Driven by e2e/settings.spec.js
├── settings-install-card.js ← the Settings Install card, and the hold on the browser's install offer from page start. Driven by e2e/settings.spec.js
├── settings-boot.js        ← two-line bootstrap for settings.html (CSP blocks inline module scripts)
├── huddle.js               ← the Daily Huddle manual upload card on Operations. See also dependency-pin-parity.test.mjs.
├── notif-card.js           ← the Settings Notifications card's wiring. Tested by notif-card.test.mjs. See also settings.spec.js.
├── notif-card-core.js      ← what that card SAYS for each device and state. Pure; tested by notif-card-core.test.mjs
├── doc-upload.js           ← the shared Operations upload-card skeleton (Huddle, Circular, Newsletter): pick, validate, optional transform, upload, feedback. See also doc-upload.test.mjs.
├── admin-auth.js ← Staff Login Accounts: the provisioning button and the read-only audit above it. Its header. Tested by admin-auth.test.mjs
├── admin-al.js             ← the Annual Leave Booking card: a config wrapper over admin-range-booking.js. See also admin-range-booking.test.mjs, admin-al-projection.test.mjs.
├── admin-sick.js           ← the Record Absence card: a config wrapper over admin-range-booking.js. See also admin-leave-booking.spec.js.
├── admin-range-booking.js  ← the shared skeleton of the two date-range booking cards. See also admin-range-booking.test.mjs.
├── admin-save-receipt.js ← what a save actually DID, day by day; a removed day is named, not omitted. Pure; tested by admin-save-receipt.test.mjs
├── slow-save.js ← the one line shown while a save waits for the server; never says "saved" (its header says why). Tested by slow-save.test.mjs and e2e/admin-saves.spec.js
├── admin-shift-types.js ← the shift-type table Change a Shift speaks. **`PILL_TYPES` is the ONE declaration of which pills exist and in what order.** Tested by admin-shift-types.test.mjs
├── admin-week-editor.js ← the seven-day grid, its pills, the bulk bar and everything staged but not saved. Its header. See also admin-week-editor.test.mjs, admin-week-grid.spec.js.
├── admin-saved-changes.js ← the Saved Changes list and both delete paths; it may not claim completeness it does not have. Its header. See also admin-saved-changes.test.mjs, admin-leave-records.spec.js, admin-saves.spec.js.
├── admin-override-store.js ← the Admin override cache, its staged reads and their on-screen states. Its header
├── override-id.js ← the ONE document id a manual override for a member and date is written to. Pure; its header. See also override-utils.test.mjs, admin-overrides.test.mjs.
├── override-compare.js ← whether the server's copy of a day is still the record the page showed. Pure; its header. See also admin-override-store.test.mjs, admin-roster-upload.test.mjs, admin-overrides.test.mjs, signed-in.spec.js.
├── admin-override-coverage.js ← what the Admin override cache KNOWS: authority comes from what was REQUESTED, never from the data. Pure; tested by admin-override-coverage.test.mjs
├── admin-shift-rules.js    ← shift-length, rest and day rules for Change a Shift; it decides, the caller paints. Its header. Tested by admin-shift-rules.test.mjs
├── admin-overrides.js      ← Change a Shift COORDINATION: the write paths, rule validation and the section wiring. See also admin-overrides.test.mjs.
├── admin-week-swipe.js ← the week-grid SWIPE on admin.html (Pointer Events; not shared with calendar-swipe.js). Covered by e2e/admin-week-grid.spec.js
├── admin-rangepicker.js    ← the inline date-range calendar. See also admin-rangepicker.test.mjs.
├── admin-deep-link.js ← where a hash on admin.html LANDS, including nested targets. Tested by admin-deep-link.test.mjs. See also admin-leave-booking.spec.js.
├── roster-alignment.js ← whether a roster read is trustworthy or a day out, judged against the member's own base pattern; and which week the form offers first. Its header. Tested by admin-roster-upload.test.mjs. See also operations.spec.js.
├── roster-cell-rules.js ← what a parsed roster cell MEANS as an override; every path producing a review value goes through it. Its header. Tested by roster-cell-rules.test.mjs
├── roster-entry-control.js ← answering an unreadable roster cell in place. Its header. See also admin-roster-upload.test.mjs, operations.spec.js.
├── roster-review-states.js ← the state of each roster-review cell, whether it is ticked, and what a Save writes. **Never "write it" where anything is in doubt.** Its header. See also admin-roster-upload.test.mjs.
├── roster-review-rows.js ← one roster review row's markup per cell state; draws `chosen`, never decides it. Pure; its header. Tested by admin-roster-upload.test.mjs
├── admin-roster-upload.js  ← Weekly Roster Upload COORDINATION: the review table, the file pick, the parse call and a refused Save. See also coordinator-ratchet.test.mjs.
├── roster-import-save.js   ← what one Save of the roster review writes, and its refusal line
├── paycalc-app.js          ← coordinator for paycalc.html (wiring, autosave, the result card); body is `init()`, run by paycalc-boot.js. See also the paycalc-*.spec.js files.
├── paycalc-boot.js         ← two-line bootstrap for paycalc.html (CSP blocks inline module scripts)
├── paycalc-sticky-total.js ← the bar that keeps the take-home figure on screen; every guard fixes a reported iOS behaviour (its header). See also paycalc-sticky-total.test.mjs, paycalc-hours-entry.spec.js, paycalc-layout.spec.js.
├── paycalc-role-card.js ← what the calculator says to somebody it will not price; who is refused is pay-audience.js. See also paycalc-role-card.test.mjs, paycalc-grades.spec.js.
├── paycalc-result-headline.js ← which figure is the pay result's headline and what it is called. **An actual is never called an estimate.** Tested by paycalc-result-headline.test.mjs
├── paycalc-ytd-card.js     ← the Year to Date card on the page; owns no rule. Tested by paycalc-ytd-card.test.mjs
├── paycalc-disclosures.js  ← the Pay page's button-and-panel disclosures. Tested by paycalc-disclosures.test.mjs
├── paycalc-clear-confirm.js ← the two-tap "Clear all entries": the arm, the countdown and which tap confirms. Tested by paycalc-clear-confirm.test.mjs. See also paycalc-entries.spec.js.
├── paycalc-money-banner.js ← the two opt-in money banners and their ticks and links; "Includes" only when the sum is in the figure. Tested by paycalc-money-banner.test.mjs. See also paycalc-backpay.spec.js.
├── paycalc-lightboxes.js   ← lightbox and About initialisation for paycalc.html. See also paycalc-layout.spec.js.
├── paycalc-periods.js      ← period arithmetic and the period select, and the Year to Date source rules. See also paycalc-periods.test.mjs.
├── paycalc-settings.js     ← each payslip's rate, contracted hours, the pension controls and settings persistence. See also paycalc-settings.test.mjs.
├── paycalc-grade-setting.js ← the member's grade setting on this device, whether a payslip can be priced, and what the page says about it. See also paycalc-grade-setting.test.mjs, paycalc-grade-wiring.test.mjs, paycalc-grades.spec.js.
├── paycalc-grade.js        ← which grade each of a payslip's days was worked under, and its words. Pure. See also paycalc-grade.test.mjs.
├── paycalc-roster-hint.js  ← the roster-assist hint bar and its fills. See also paycalc-roster-hint.test.mjs.
├── paycalc-hpp.js          ← the Holiday Pay Premium estimator and shared period helpers. See also paycalc-hpp.test.mjs.
├── paycalc-hpp-schedule.js ← the PURE payslip ↔ tax-year relation for Holiday Pay Premium. Tested by paycalc-hpp-schedule.test.mjs
├── paycalc-fill-year.js ← "Fill this tax year from your calendar" and the seven rules that make it safe (its header). Tested by paycalc-fill-year.test.mjs
├── paycalc-year-card.js ← the "This tax year so far" block and its fill control. Its header. Tested by paycalc-year-card.test.mjs
├── paycalc-year-summary.js ← the "This tax year so far" figures. Tested by paycalc-year-summary.test.mjs
├── paycalc-backpay.js      ← the back-pay lump-sum card. See also paycalc-backpay.test.mjs.
├── paycalc-backpay-accrual.js ← what a pay award owes, period by period. Pure. Tested through paycalc-backpay.test.mjs and paycalc-hpp.test.mjs
├── paycalc-backpay-state.js ← which figure ends up in which back-pay box, and which the member may change. Its header. Tested by paycalc-backpay-state.test.mjs
├── paycalc-pension.js ← WHEN a member was in the pension scheme; an empty timeline means contributing. Its header. Pure; tested by paycalc-pension.test.mjs
├── paycalc-format.js       ← shared pure paycalc formatters and time-input helpers. See also paycalc-format.test.mjs.
├── paycalc-breakdown.js    ← the PURE HTML builders for the pay-result card. Tested by paycalc-breakdown.test.mjs
├── paycalc-form-data.js ← the per-period form ↔ saved-data ROUND TRIP. Tested by paycalc-form-data.test.mjs
├── paycalc-inputs.js       ← the pay form's input helpers, free of coordinator state so they test against a fake `document`. Tested by paycalc-inputs.test.mjs
├── paycalc-inventory.js ← what a stored pay key IS and what a set of them adds up to — the one authority behind the backup summary and the damage preflight. Tested by paycalc-inventory.test.mjs
├── paycalc-transfer.js ← the pay-data BACKUP FORMAT and import rules; `validateBackup` is the TRUST BOUNDARY. Tested by paycalc-transfer.test.mjs. See also paycalc-key-parity.test.mjs.
├── paycalc-transfer-card.js ← the DOM half of the "Move Your Pay Data" card; restore REPLACES, never merges (its header says why)
├── paycalc-calc.js         ← pure pay maths: tax, NI, student loan, gross, the grades and tax years. See also paycalc-current-year.test.mjs.
├── paycalc-help.js         ← the Pay Calculator's `?` panel text. Pure data
├── paycalc-migrations.js   ← the paycalc storage keys, the migrations and the saved-period decoder (a corrupt period is surfaced, never dropped)
├── paycalc-roster-suggestions.js ← the roster pre-fill engine. See also paycalc-roster-suggestions.test.mjs.
├── roster-data.js          ← shared: `APP_VERSION`, `CONFIG`, the roster data and its utilities; `signInMembers()` is the one list of who can sign in. See also CALENDAR_DATA.md.
├── roster-cycle-data.js    ← raw roster cycle arrays, imported by roster-data.js only
├── roster-member-data.js ← the roster's PEOPLE (`teamMembers`), no logic; re-exported by roster-data.js. **World-readable** — the field-by-field argument is on `teamMembers`
├── pay-audience.js        ← WHO the Pay Calculator is for, by the role at the time; and who is SENT the pay reminder (`sentPayReminder`, the server's rule). Pure. Tested by pay-audience.test.mjs
├── roster-roles.js        ← a member's GRADE ON A DAY, from `role` and `roleHistory`. Pure, no imports. See also roster-data.test.mjs.
├── firebase-client.js      ← shared: Firebase init, `db` and the Firestore helpers. See also AUTH_AND_SESSIONS.md, firebase-client.test.mjs, calendar-viewer-parity.test.mjs.
├── auth-identity.js        ← pure account-identity helpers (`normaliseSurname`, the account email, password validation); surname-parity.test.mjs holds the functions copy to this file. See also auth-identity.test.mjs.
├── storage-utils.js        ← pure Storage helpers, including the download-URL allowlist (a security control); re-exported by firebase-client.js. See also storage-utils.test.mjs, calendar-doc-viewer.test.mjs.
├── document-url.js         ← asks `getDocumentUrl` for a SHORT-LIVED document URL; null means "use the stored URL". Never throws. See also document-url.test.mjs.
├── function-url.js         ← the ONE address of the Cloud Functions, `functionUrl(name)`; every name passed is checked against the deployed list (functions-surface.test.mjs). Pure
├── client-errors.js        ← the pure RULES of the client error log. **A filter too broad silently swallows real errors.**. See also error-reporter.test.mjs.
├── claim-retry.js          ← what a `permission-denied` means: retry once after a token refresh, or a refusal rather than a network fault (the one home). Tested by claim-retry.test.mjs. See also AUTH_AND_SESSIONS.md.
├── page-session.js         ← how a signed-in page LEAVES a session and what it does when the session leaves it, including the late-identity reload guard (`lateReloadAllowed`). Its header. Tested by page-session.test.mjs and page-contract-parity.test.mjs
├── page-start.js           ← the ONE start-up every card-opening page goes through (`startPage`, the Template Method): the Back guard, the decision at load AND after an in-place sign-in, the refusal, the session step. Its header. Tested by page-start.test.mjs and page-contract-parity.test.mjs
├── unsaved-draft.js        ← unsaved work kept for a page that goes without asking; offered on the next load, never applied silently. Its header. Tested in page-session.test.mjs
├── ls.js                   ← iOS-safe localStorage wrappers, including the two that refuse to leave a half state. See also ls-persist.test.mjs.
├── storage-keys.js         ← the single source for the CROSS-FILE storage keys. Pinned by storage-key-parity.test.mjs
├── status-text.js ← the leading glyph on a transient status message, and when a new live region speaks. Tested by status-text.test.mjs; kept by status-glyph-parity.test.mjs
├── upload-commit.js ← what an AMBIGUOUS Firestore commit means after a document upload — resolved by READING. Pure; tested by upload-commit.test.mjs
├── documents-client.js ← the date-keyed document collections and their upload sequence. **A live document must never point at a file that is not there.** Tested by documents-client.test.mjs. See also rules/pwa.md.
├── own-password.js ← re-authenticating with, and changing, the member's OWN password, and both surfaces' save sequence. Its header. Tested by firebase-client.test.mjs, password-force.test.mjs
├── account-calls.js ← the browser's side of three account endpoints; re-exported by firebase-client.js. Tested by firebase-client.test.mjs
├── analytics-client.js ← the Firestore I/O of the error log and the usage and speed counters; the decisions are elsewhere. Tested by analytics-client.test.mjs
├── doc-retention.js ← the six-month sweep behind Circular and Newsletter uploads — the browser's only destructive operation on shared data. Tested by doc-retention.test.mjs
├── index.css / admin.css / paycalc.css / operations.css / settings.css ← page-specific CSS
├── overtime.html           ← Overtime availability: one page for the member's form and the reviewer workspace (its header says why) — closed while `CONFIG.OVERTIME_ENABLED` is false (OVERTIME_AVAILABILITY.md → Paused)
├── overtime.css            ← CSS for overtime.html, built around the week row
├── overtime-app.js         ← coordinator for overtime.html: access gate, login, tabs and the planning horizon; body is `init()`, run by overtime-boot.js. See also overtime.spec.js.
├── overtime-boot.js        ← 2-line bootstrap for overtime.html (CSP blocks inline module scripts)
├── overtime-data.js        ← every call the Overtime page makes to the server, with timeouts and the reconcilable submission id
├── overtime-format.js      ← the PURE client side of Overtime in words. Tested by overtime-format.test.mjs
├── overtime-clock.js ← WHETHER an Overtime action is still allowed; the client never refuses what the server would accept. Tested by overtime-clock.test.mjs
├── overtime-form.js        ← the member's seven-day form: render, collect, submit, reconcile. Its header says what must not be "tidied". See also overtime-form.test.mjs, overtime-roster.test.mjs, overtime.spec.js, OVERTIME_AVAILABILITY.md.
├── overtime-review-controller.js ← the REVIEWER's side of overtime.html. Its header. See also OVERTIME_AVAILABILITY.md, overtime-review-controller.test.mjs.
├── overtime-manager.js     ← the reviewer's workspace for one week, rendered from data it is handed. **Available, Not available and No response never merge.**
├── overtime-roster.js      ← what people are actually rostered to do across an Overtime window, in one bounded read (not the Calendar's fetcher — its header)
├── overtime-tips.js        ← CARD_TIPS for overtime.html's `?` panels. Pure data
├── trains.html             ← Trains: what changes at Marylebone with the December 2026 timetable, for signed-in members. Reads no network — the timetables are a generated module
├── trains.css              ← CSS for trains.html; the grid's scroll box must stay `position: relative`
├── trains-app.js           ← coordinator for trains.html: the gate, session wiring and page state; body is `init()`, run by trains-boot.js
├── trains-cards.js         ← writes each card of trains.html from the page state; decides nothing. Proven by e2e/trains.spec.js
├── trains-boot.js          ← 2-line bootstrap for trains.html (CSP blocks inline module scripts)
├── trains-change.js        ← PURE: which December train is "the same train", the time lookup and the page's words by date. Its header. Tested by trains-change.test.mjs
├── trains-render.js        ← the Trains page's HTML as strings. Pure; escapes every name. Tested by trains-stations.test.mjs
├── trains-grid-mirror.js   ← the Trains grid's column heads kept in view (a fixed, aria-hidden mirror). Proven by e2e/trains.spec.js
├── trains-status.js       ← what a screen reader is told on trains.html: one short line per press. Proven by e2e/trains.spec.js
├── overflow-hint.js        ← a "swipe the table" line shown only while its table really scrolls sideways
├── trains-data.js          ← GENERATED by docs/timetable-dec26/tooling/build.py: both timetables and the issue's dates. **PUBLIC** — only what Chiltern prints for passengers
├── trains-stations.js      ← PURE: the timetable seen from a station. Tested by trains-stations.test.mjs
├── trains-weekdays.js      ← PURE: which weekdays a figure is true of. Tested by trains-stations.test.mjs
├── trains-verdict.js       ← PURE: a station's change in words. Tested by trains-stations.test.mjs
├── trains-headlines.js     ← PURE: the "what's changing" headlines. Tested by trains-stations.test.mjs
├── trains-tips.js          ← CARD_TIPS for trains.html's `?` panels, with the page's caveats and sources
├── newlink.html            ← the new link page: the three shortlisted proposals for the new CEA link (from January 2027), presented evenly, and the pack. Signed-in only, never the staff PIN
├── newlink.css             ← CSS for newlink.html
├── newlink-app.js          ← coordinator for newlink.html: the gate (`requirePage('newlink')`), session wiring and the two choices; decides nothing
├── newlink-boot.js         ← 2-line bootstrap for newlink.html (CSP blocks inline module scripts)
├── newlink-config.js       ← the new link page's SETTINGS, one decision a line, including `PACK_BASE` — the pack PDFs are served live from the Pages mirror's docs/links-26/
├── newlink-data.js         ← GENERATED by docs/links-26/tooling/newlink-data.mjs — the figures and pack list the new link page shows. Pinned by newlink-data.test.mjs
├── newlink-render.js       ← the new link page's HTML as strings, ordering the proposals A to Z itself. Pure; escapes everything
├── newlink-tips.js         ← CARD_TIPS for newlink.html's `?` panels. Pure data. See also tips-content.test.mjs
├── pdf-viewer.js           ← the in-app PDF viewer (`#pdfViewer`, newlink.html), drawing with PDF.js; why it exists is pdf-viewer-core.js's header. See also newlink.spec.js.
├── pdf-viewer-core.js      ← the PDF viewer's pure rules, including never offering to open a file inside an installed app's scope
├── links.html              ← the link design workspace (visible to `CONFIG.LINKS_DESIGNERS` only)
├── links.css               ← CSS for links.html
├── links-app.js            ← coordinator for links.html: the working copy and `dirty`, the save conversation and the wiring; no Firestore I/O of its own. Body is `init()`, run by links-boot.js. See also coordinator-ratchet.test.mjs.
├── links-boot.js           ← two-line bootstrap for links.html (CSP blocks inline module scripts)
├── links-design-library.js ← the design library's panels: import and the Recently deleted bin. Its header. See also links-design-library.test.mjs.
├── links-design-store.js ← the design collection's persistence lifecycle and concurrency protocol; the four rules it makes unwritable: its header. Tested by links-design-store.test.mjs
├── links-queued-saves.js ← the Links saves only this browser's queue holds until the server answers. Pure; the seven rules are its header
├── links-concurrency.js    ← the PURE co-editing rules for the Links workspace. Every bug here was a SILENT overwrite of a colleague's work. Tested by links-concurrency.test.mjs. See also links-design-store.test.mjs.
├── links-fatigue.js ← the ORR fatigue factors assessed against a design. **It reports factors PRESENT and never passes or fails a design.** Tested by links-fatigue.test.mjs
├── links-limits.js ← the HARD limits a design meets or does not — kept apart from links-fatigue.js on purpose (its header). Tested by links-limits.test.mjs
├── links-adjacency.js ← the ORDER the lines sit in, and its scoring. Its header. Tested by links-adjacency.test.mjs
├── links-demand.js ← the service a design has to cover (trains per hour at Marylebone); never scores a design. Tested by links-demand.test.mjs. See also links.spec.js.
├── links-window.js ← the OPERATING WINDOW of a design, stored per design. Tested by links-window.test.mjs. See also links.spec.js.
├── links-window-editor.js ← the staffed-window editor on the Coverage card; an edit goes back to the coordinator, which marks it dirty. Tested by links-window-editor.test.mjs and e2e/links.spec.js
├── links-deletion.js ← the PURE rules behind "Recently deleted". **The bin is PERMANENT** (owner decision; its header). Tested by links-deletion.test.mjs. See also doc-parity.test.mjs.
├── links-generator-targets.js ← the generator's target table on screen, its memory and provenance. Rule 4 in its header. Tested by links-generator-targets.test.mjs. See also links.spec.js.
├── links-design.js ← pure link-design maths, including `ROTATING_LINES` — the ONE declaration of the rotation length, and `restBetween`, the one reading of a turnaround. Imports nothing. **Read its header before touching the hours maths.** Tested by links-design.test.mjs
├── links-generate.js ← the link GENERATOR: `generateLink`, its two constructions, the contract gate and the minimum-rest repair; imports its constants from links-design.js. **Read its header before touching the generator.** Tested by links-design.test.mjs and links-contract.test.mjs
├── links-design-doc.js ← the SHAPE of a link design in memory and in Firestore, and every conversion between them. Its header. Tested by links-design-doc.test.mjs
├── links-design-load.js ← PURE: what a read of the design collection means, for the page load and the list refresh. Tested by links-design-load.test.mjs
├── links-design-naming.js ← what a design or staffing setup may be CALLED; a name clash is refused, never renamed silently. Tested by links-design-naming.test.mjs
├── links-proposals.js ← the SHORTLISTED designs, built in as read-only proposals, copied cell for cell from docs/links-26/30-days-off/ (and its balanced/ subfolder). Tested by links-proposals.test.mjs
├── links-shortlist.js ← "Keep only the shortlist": the admin's one-off bin of every older design. Pure; tested by links-shortlist.test.mjs and e2e/links-shortlist.spec.js
├── links-design-header.js ← the design MASTHEAD on links.html. Its header. Tested by links-design-header.test.mjs
├── links-seed.js ← the generator's ROSTER SEED: it MEASURES, `links-default-targets.js` DESIGNS. Tested by links-seed.test.mjs
├── links-target-sets.js ← SAVED SETS of generator targets; a corrupt document is refused whole. Tested by links-target-sets.test.mjs and firestore.rules.test.mjs. See also links.spec.js.
├── links-target-sets-store.js ← the Firestore half of the saved staffing sets. **A read that FAILS is not an empty collection.** Tested by links-target-sets-store.test.mjs
├── links-target-hours.js ← whether a generator target table pays the contract. Tested by links-target-hours.test.mjs
├── links-default-targets.js ← the table the generator STARTS from, against the December 2026 service. Its header. Tested by links-default-targets.test.mjs
├── links-import.js ← turning somebody else's roster proposal into a design — a TRUST BOUNDARY: a design or a refusal, never a half-design. Tested by links-import.test.mjs
├── links-analysis.js ← links.html's read-only analysis panels. Tested by links-analysis.test.mjs
├── links-compare-analysis.js ← compare mode's analysis for two designs. Pure; rendered by links-compare.js. See also links-compare.test.mjs.
├── links-compare.js        ← links.html compare mode; single source of truth for the compare state. Tested by links-compare.test.mjs
├── links-grid-input.js ← how the design grid is operated (keyboard, mouse strokes); what a cell means is links-grid.js's. Tested by links-grid-input.test.mjs and e2e/links.spec.js
├── links-print.js ← preparing the Links page for paper and putting it back (iOS sends no `afterprint`). Tested by links-print.test.mjs
├── links-analyse.js ← ONE reading of a Links design for every panel that reports on it. Pure; tested by links-analyse.test.mjs
├── links-grid-cells.js ← what one cell of a Links grid SAYS, and the cell markup. Pure; tested by links-grid-cells.test.mjs
├── links-grid.js ← the design grid on screen: drawing it or its empty state, what a cell press MEANS, the totals and the Cover footer. Tested by links-grid.test.mjs and e2e/links.spec.js
├── links-brush-bar.js ← the paint bar and the armed brush: its chips are the design's own times. Tested by links-brush-bar.test.mjs and e2e/links.spec.js
├── links-today.js ← what the Links workspace reads from today's roster. Pure; tested by links-today.test.mjs
├── links-build-press.js ← what the "Build the link" press says and remembers. Pure; tested by links-build-press.test.mjs
├── links-build-button.js ← the "Build the link" press end to end: generate, reorder, hand the design to the coordinator, hold the button still. Tested by links-build-button.test.mjs and e2e/links.spec.js
├── links-tips.js ← CARD_TIPS for links.html's `?` panels; its "The default table" section has to change with `links-default-targets.js`'s header
├── shared.css              ← CSS shared by every app page — NOT the guides
├── guide-shell.css         ← shared chrome for every guide page, including the Inter @font-face and `--font-sans`
├── guide-doc.css           ← shared styles for the two document-style guides (staff-guide.html, paycalc-guide.html)
├── staff-guide.css / paycalc-guide.css / fip-guide.css ← page-specific guide CSS
├── purify.es.mjs           ← self-hosted DOMPurify v3.4.18. Upgrade: `npm pack dompurify@<ver>`, extract purify.es.mjs
├── pdfjs/                  ← PDF.js, the legacy build, vendored for pdf-viewer.js in a folder named for its version; an upgrade is a NEW folder. dependency-pin-parity.test.mjs has the steps
├── service-worker.js       ← the single service worker for all pages; the cache name includes `APP_VERSION`. See also coordinator-ratchet.test.mjs.
├── manifest.json           ← PWA manifest for all pages
├── guide.html · fip.html ← the two LEGACY guide URLs, kept as redirect stubs (the Pages mirror serves no redirects); they go when the mirror does
├── legacy-redirect.js      ← the one script those stubs carry, keeping the #fragment and ?query. See also page-contract-parity.test.mjs, guides.spec.js.
├── staff-guide.html / paycalc-guide.html / railcard-guide.html / fip-guide.html / rangers-guide.html ← printable guides (via nav panel)
├── rangers-guide.css ← the Rangers & Rovers guide's stylesheet. **Neither validity attribute may be inferred from the other.** `.claude/rules/guide-pages.md`; evidence: GUIDE_SOURCES.md
├── railcard-guide.css      ← the Railcard guide's stylesheet. **The Network area ends at Banbury — do not "correct" it.** `.claude/rules/guide-pages.md`
├── guide-chips.js          ← the "Jump to section" chip bar on all five guides (classic script). See also page-contract-parity.test.mjs.
├── fip-guide.js                  ← JS for fip-guide.html: the country finder and print preparation (iOS fires no `beforeprint` for AirPrint)
├── guide-print.js          ← the shared ⤓ PDF button on every guide page, through print-guard.js
├── guide-back.js           ← the guides' back-arrow retarget; `from` must be one of the app's own pages
├── icon-*.png              ← 6 sizes: 120, 152, 167, 180, 192, 512 · icon-badge.png (monochrome notification badge, 96px)
├── fonts/
│   └── inter-latin.woff2   ← self-hosted Inter variable font (latin, wght 100–900)
├── CLAUDE.md · docs/AI_MAP.md · docs/OPERATIONS_REFERENCE.md · docs/KNOWN_LIMITATIONS.md · docs/ROADMAP.md ← the five VERSION-STAMPED docs (re-stamped every 0.10 milestone; enforced by `sw-asset-check.test.mjs`)
├── README.md ← the FRONT DOOR: which commands need nothing installed and which lanes need an install. States no counts; checked by doc-parity.test.mjs
├── docs/ ← every document except README.md and CLAUDE.md. `docs/**` is excluded from Firebase Hosting; the Pages mirror still serves it. `ARCHITECTURE.md` is the index; start there
│   ├── links-26/ ← the new CEA link, **26 lines**, from January 2027: `RULES.md`, `30-days-off/` (the shortlist's designs), `proposals/`, `presentations/` and `tooling/`; README.md is the current state, HISTORY.md the record. The New link page serves its pack PDFs live from here on the Pages mirror (`PACK_BASE`, newlink-config.js)
│   ├── timetable-dec26/ ← `tooling/` builds `trains-data.js` (the Trains page) from Chiltern's public December 2026 timetable PDFs, which are never committed; its README has the inputs and the method
│   ├── DECISIONS.md ← what has already been DECIDED, and why, so it is not re-argued. A closed decision whose trigger fires MOVES back to ROADMAP.md
│   ├── ARCHITECTURE.md ← the INDEX: which document is authoritative for each subject, the `EXC-*` table of current production exceptions, and the four status words
│   ├── MAINTENANCE_CALENDAR.md ← work with a DEADLINE whether or not anyone plans it, each with a warning point
│   ├── OWNER_GUIDE.md          ← the owner's plain-English guide to running the app: after a release, when something is wrong, the weekly, monthly and dated jobs, and where each answer lives
│   ├── LATENCY.md ← sign-in and Calendar START latency: what shipped, what was measured, and the decision rule — CLOSED
│   ├── VALIDATION_REGISTER.md ← what the app ALREADY ASSERTS on evidence nobody has checked, each row with a stable `VAL-*` id
│   ├── DATA_MODEL.md ← the FIRESTORE COLLECTIONS and what every field means; `firestore.rules` is the authority on access
│   ├── AL_WORKBOOK.md ← the roster clerks' annual-leave quota spreadsheet — a WORK IN PROGRESS. **Read §0 first**: `AL over depot quota` days are real leave, invisible in the calendar grid
│   ├── CALENDAR_DATA.md ← the Calendar's feature CONTRACT: what may be shown and when, each invariant routed to its module header
│   ├── AUTH_AND_SESSIONS.md ← the authentication feature CONTRACT: session, identity and claim, the invariants across them, and the architecture (two pure layers and a store); status lives in SECURITY_RELEASE_PLAN.md
│   ├── SECURITY_RELEASE_PLAN.md ← the security tracks' status: **the CANONICAL TRACK STATUS table** (update a stage there and nowhere else; `auth-plan-parity.test.mjs`), plus each track's ordering, decisions and lessons
│   ├── CREDENTIAL_LIFECYCLE.md ← POINTER: merged into PASSWORD_DESIGN.md (24 Nov 2026); maps its old §N to LN
│   ├── PASSWORD_DESIGN.md ← the chosen-password design (Track C, email deferred), and the credential lifecycle: how a credential is issued, recovered and retired, in order (L1–L10; **L7 is an OPEN owner decision**). Status: SECURITY_RELEASE_PLAN.md
│   ├── AUTH_PLAN.md ← Track E, full-app authentication, in its ONE home: what "behind authentication" can mean for static files on public hosting, and the E0–E6 phases, their order, risks and owner questions. Status: SECURITY_RELEASE_PLAN.md's table, whose Track E section points here
│   ├── AUTH_ARCHITECTURE.md     ← POINTER: folded into AUTH_AND_SESSIONS.md → Architecture (24 Nov 2026); the Track 1 phases are in git
│   ├── RECOVERY_RUNBOOK.md      ← the "break glass" backup, rollback and disaster-recovery runbook
│   ├── LINKS_REFERENCE.md ← the Links workspace in full: how each part works and the measurements behind its rules. The invariants are `.claude/rules/links-design.md`
│   ├── PAYCALC_REFERENCE.md ← the Pay Calculator in full: the pay FIGURES (their one home), the payroll mechanics, state and layout. The invariants are `.claude/rules/paycalc.md`
│   ├── BRASS_PLAN.md ← modelling BRASS (the RPS pension top-up) in the pay calculator; nothing ships until its owner questions are answered
│   ├── OVERTIME_AVAILABILITY.md ← the design record for Overtime Availability, holding only what no module header owns
│   ├── OTHER_DAYS.md            ← the "Other" day family: the numbered design decisions cited from code, and the Phase B checklist
│   ├── GUIDE_SOURCES.md         ← the source register for the operational guides; enforced by guide-sources.test.mjs
│   ├── A11Y_BASELINE.md         ← the accessibility gate's record (e2e/axe.spec.js): fixes, waivers and known items
│   ├── ANDROID_RELEASE_CHECKLIST.md ← the Android release pass no test here can run, on a real phone
│   └── IPHONE_RELEASE_CHECKLIST.md ← the iPhone release pass no test here can run, on real devices
├── experiments/
│   ├── firestore-offline-proof/ ← the proof AUTH_PLAN.md §4 asked for: the local Firestore cache serves reads the rules would deny. Not a CI gate
│   ├── auth-firestore-split-proof/ ← does taking Firestore off the auth path speed a saved sign-in? **No** — the wall is network. Not a CI gate
│   ├── roster-pdf-geometry/ ← does the roster PDF already contain the grid the AI reconstructs? **Yes**. Not a CI gate; needs `pdfjs-dist` pinned to v4
│   └── viewer-persistence-proof/ ← does the Calendar viewer die with the browser session? It did not; proven in real Chromium. Not a CI gate; pinned by calendar-viewer-parity Contract C
├── test-fixtures/
│   ├── firebase-sdk/ ← a RECORDING fake of the three Firebase SDK modules and the resolve hook that answers the CDN URLs with them; `state.mjs` records every write
│   ├── links-designs/ ← real Links grids kept UNCHANGED as fixtures for the compare tests, because the asserted figures are theirs
│   ├── xlsx-write.mjs ← a real .xlsx built at test time for the leave file's session script. Invented people only
│   ├── roster-pdf.mjs ← a real roster PDF built by hand, shared by roster-geometry.test.mjs and index-endpoints.test.mjs (its header says why one)
│   └── payslip-actuals.example.js ← the SHAPE of the pay-maths regression fixture, invented figures, never imported (a fallback would turn a skip into a green run)
├── .github/ ← `workflows/` (each says what it gates in its header), `actions/` and the PR template
├── .claude/ ← session tooling, never served: `rules/`, `skills/`, `hooks/` and `settings.json`
├── githooks/
│   └── pre-commit          ← the enforced pre-commit hook — see CLAUDE.md → "Same-commit rule"
├── robots.txt              ← staff-only and deliberately ALLOWS crawling (the control is `noindex`). **Do not change it to Disallow** — its comments say why
├── .nojekyll               ← empty marker that makes a branch-built GitHub Pages site skip Jekyll; see CLAUDE.md → Workflows
├── test/                   ← the Node unit suites (`npm test` and its lanes; `README.md` → "The test lanes"). Run from the repo root: `node [flags] scripts/run-tests.mjs test/<file>`. Each file addresses the repo through `REPO_ROOT_URL`, never its own folder
│   ├── nav-gates.test.mjs      ← the pills drawn against the pages `requirePage` admits, for every roster name and nobody. Part of test:hygiene
│   ├── notice-archive.test.mjs ← the archive's rules and what the App Notices panel reads back. Part of test:hygiene
│   ├── card-collapse.test.mjs  ← the deep link's behaviour and overlay.js's re-exports. Part of test:hygiene
│   ├── admin-day-pills.test.mjs ← each day's pills and chips over a fake row, and the grid's call. Part of test:hygiene
│   ├── admin-own-write.test.mjs ← the rule, the words and the sync over a fake grid. Part of test:hygiene
│   ├── admin-bulk-apply.test.mjs ← each reason, read off `SUNDAY_FORBIDDEN_TYPES` and `PILL_TYPES`. Part of test:hygiene
│   ├── overflow-hint.test.mjs  ← the overflow rule, the re-measure after a resize, and the no-ResizeObserver path. Part of test:hygiene
│   ├── links-design-doc.test.mjs ← the design-shape invariants, across every producer. Part of test:hygiene
│   ├── links-design-load.test.mjs ← the two design readers in sequence, the legacy migration and which design opens. Part of test:hygiene
│   ├── links-compare-analysis.test.mjs ← compare analysis on two real proposal sheets. Part of test:hygiene
│   ├── links-grid-input.test.mjs ← the grid's keyboard rule and a mouse stroke's bookkeeping. Part of test:hygiene
│   ├── links-grid.test.mjs / links-brush-bar.test.mjs / links-build-button.test.mjs / links-window-editor.test.mjs ← the grid's shift list, totals and footer; the paint bar's times; the Build press's box reading; the window editor through its listeners. Part of test:hygiene
│   ├── operations-attention.test.mjs ← the strip's pure decision, against claiming too little or too much. Part of test:hygiene
│   ├── operations-doc-links.test.mjs ← what Document links says and sends. Part of test:hygiene
│   ├── operations-reset.test.mjs ← every sentence Account status's Reset says, held to what the answer reports. Part of test:hygiene
│   ├── guide-search.test.mjs ← the pure search rules: laundered doubt, an unfindable answer, a doubled one. Part of test:hygiene
│   ├── guide-index-parity.test.mjs ← the generated index is TRUE of the guide pages, and its wiring. Part of test:hygiene
│   ├── override-utils.test.mjs            ← tests for override-utils.js
│   ├── print-guard.test.mjs               ← print-guard.js on every home-screen launch on an iPhone or iPad. Part of test:hygiene
│   ├── clock-input.test.mjs               ← the clock-box guard and shaper. Part of test:hygiene
│   ├── roster-data.test.mjs    ← tests for roster-data.js
│   ├── paycalc.test.mjs        ← tests for paycalc-calc.js
│   ├── paycalc-roster-suggestions.test.mjs ← (--experimental-test-module-mocks)
│   ├── roster-parse-helpers.test.mjs / links-design.test.mjs / admin-rangepicker.test.mjs / client-errors.test.mjs / usage-stats.test.mjs / perf-stats.test.mjs
│   ├── functions-surface.test.mjs ← pins functions/index.js's exports (the DEPLOY surface — a dropped re-export deletes a function). Runs in test:functions
│   ├── fetch-timeout.test.mjs ← the Cloud Function call bound, including somebody else's abort. Part of test:hygiene
│   ├── error-reporter.test.mjs ← the Error Log noise filters, each pinned from both sides. Part of test:hygiene
│   ├── error-reporter-wiring.test.mjs ← the reporter's WIRING through the real `initErrorReporter`. Part of test:unit
│   ├── ls-persist.test.mjs ← the durable-storage request and its gate. Part of test:hygiene
│   ├── storage-utils.test.mjs ← the pure Storage helpers, including the URL allowlist. Part of test:hygiene
│   ├── document-url.test.mjs  ← what a server answer means for a member opening a document. Part of test:hygiene
│   ├── auth-identity.test.mjs ← the account email derivation. Part of test:hygiene
│   ├── notif.test.mjs         ← notif.js (--experimental-test-module-mocks)
│   ├── notif-card-core.test.mjs ← the Notifications card's words for every device. Part of test:hygiene
│   ├── notif-card.test.mjs    ← the Notifications card's wiring through the real `initNotificationsCard`. Part of test:unit
│   ├── surname-parity.test.mjs ← the account identifier derivation stays in sync across the ESM/CommonJS boundary. Part of test:hygiene
│   ├── payday-cutoff-parity.test.mjs ← the server's cut-off rule reads the GENERATED cycle and agrees with roster-data.js's paydays. Part of test:hygiene
│   ├── import-graph.test.mjs   ← circular imports across all root ES modules
│   ├── slow-save.test.mjs ← the slow-save watcher; the wording never says saved. Part of test:hygiene
│   ├── admin-save-receipt.test.mjs ← a receipt that leaves something out or lists days out of order. Part of test:hygiene
│   ├── christmas-leave.test.mjs ← the Christmas rules against the real roster, and that only al-entitlement.js may call `getALEntitlement`. Part of test:hygiene
│   ├── al-leave-file.test.mjs ← a leave file refused for each way it can be wrong, and the seal. Invented people only. Part of test:hygiene
│   ├── al-leave-compare.test.mjs ← the sheet beside the app over invented people on real patterns. Part of test:hygiene
│   ├── leave-file-script.test.mjs ← the leave-file session script on a workbook built at test time. Invented people only. Part of test:hygiene
│   ├── leave-file-privacy.test.mjs ← A LEAVE FILE NEVER ENTERS THE TREE, by any route or name. Part of test:hygiene
│   ├── al-leave-plan.test.mjs ← what an Annual leave sheet Save writes, over invented people and the real comparison. Part of test:hygiene
│   ├── al-leave-save.test.mjs ← the Save, its log and its Undo on a transaction-faithful fake Firestore. Part of test:unit
│   ├── al-leave-words.test.mjs ← every sentence the Annual leave sheet card says, and that every code and state has words of its own. Part of test:hygiene
│   ├── al-entitlement.test.mjs ← a wrong AL figure in both directions, and the two answers agreeing. Part of test:hygiene
│   ├── leave-year.test.mjs ← which year's allowance a day comes out of, and the switch's shipped value. Part of test:hygiene
│   ├── admin-leave-year.test.mjs ← the Admin leave-year panel's markup and wiring. Part of test:hygiene
│   ├── admin-al-year.test.mjs ← which year the Admin AL figures state. Part of test:hygiene
│   ├── admin-booked-periods.test.mjs ← the booked-periods year selector and its precedence. Part of test:hygiene
│   ├── two-tap.test.mjs ← the two-tap control and a feedback line's fade, driven directly. Part of test:hygiene
│   ├── admin-confirm-bar.test.mjs ← the over-allowance bar: a card may hide only its own question. Part of test:hygiene
│   ├── admin-week-editor.test.mjs ← the week grid's three silent failures and the Save button agreeing with staged edits (--experimental-test-module-mocks)
│   ├── admin-saved-changes.test.mjs ← the Saved Changes controls, executed (--experimental-test-module-mocks)
│   ├── admin-period-delete.test.mjs ← a Recorded-dates delete through the real function, every dependency injected (--experimental-test-module-mocks)
│   ├── admin-range-booking.test.mjs ← the shared save path behind both booking cards
│   ├── admin-card-config.test.mjs ← what each booking card hands the shared factory. Part of test:unit
│   ├── paycalc-roster-hint.test.mjs ← "Fill from calendar" across its await: a payslip switched mid-fetch is written nothing
│   ├── paycalc-year-card.test.mjs ← the "This tax year so far" block and its bulk fill on a completed tax year
│   ├── paycalc-role-card.test.mjs ← the Pay page's refusal and sign-in wording. Part of test:hygiene
│   ├── paycalc-sticky-total.test.mjs ← the take-home bar's state machine against a hand-built DOM. Part of test:hygiene
│   ├── admin-override-store.test.mjs ← the Admin override store executed — the order its reads write the cache in (--experimental-test-module-mocks)
│   ├── admin-period-dates.test.mjs ← booked-date runs: merging across a worked day and splitting a real run. Part of test:hygiene
│   ├── admin-override-coverage.test.mjs ← the cache's authority answer, wrong in either direction. Part of test:hygiene
│   ├── touch-gate-parity.test.mjs ← **a touch-only test must run on every touch engine** (a skip is green). Part of test:hygiene
│   ├── hidden-member-visibility.test.mjs ← **a leaver is off the roster everywhere it is listed**, and every copy agrees. Part of test:hygiene
│   ├── team-week-start.test.mjs ← which week the team grid opens on. Part of test:hygiene
│   ├── admin-deep-link.test.mjs ← where an admin.html hash lands, and never throwing on a malformed one. Part of test:hygiene
│   ├── admin-shift-rules.test.mjs ← the maximum-length and minimum-rest checks at their boundaries. Part of test:hygiene
│   ├── admin-auth.test.mjs ← the provisioning audit as the card runs it: never a false all-clear
│   ├── admin-overrides.test.mjs ← Change a Shift's helpers and the two Sunday rules in `recordRangeOverrides` (--experimental-test-module-mocks)
│   ├── admin-roster-upload.test.mjs ← the parsed-value → override type mapping and the stale-claim batch retry (--experimental-test-module-mocks)
│   ├── newsletter-recency.test.mjs ← the Newsletter's six-week rule, the device's answer and the Calendar's check
│   ├── nav-panel.test.mjs      ← the drawer: guards, sign-out order, its lightboxes, Back, the document open (--experimental-test-module-mocks)
│   ├── nav-bell.test.mjs      ← the drawer's notification bell under racing answers
│   ├── nav-guide-fold.test.mjs ← the guide list following the Reference fold
│   ├── about-markup-parity.test.mjs ← every app page's About markup carries every id about-lightbox.js looks up. Part of test:hygiene
│   ├── sw-register.test.mjs    ← the service-worker registration and update reloads. Part of test:hygiene
│   ├── status-text.test.mjs ← the decorative-glyph rule from both sides. Part of test:hygiene
│   ├── status-glyph-parity.test.mjs ← the decorative-glyph rule across the tree. Part of test:hygiene
│   ├── storage-key-parity.test.mjs ← a cross-file storage key has ONE spelling. Part of test:hygiene
│   ├── settings-status.test.mjs ← the Settings summary: never false reassurance, never a false alarm. Part of test:hygiene
│   ├── roster-cell-rules.test.mjs ← the guards between "the PDF said X" and "we wrote Y". Part of test:hygiene
│   ├── huddle-table-grid.test.mjs ← the physical-column walk. Part of test:hygiene
│   ├── upload-commit.test.mjs ← the ambiguous-commit verdict. Part of test:hygiene
│   ├── documents-client.test.mjs ← the document upload sequence executed against fakes. Part of test:hygiene
│   ├── analytics-client.test.mjs ← the error log and counters executed against a fake Firestore. Part of test:hygiene
│   ├── doc-retention.test.mjs ← the six-month sweep with a competing writer slipped in. Part of test:hygiene
│   ├── sw-internals.test.mjs   ← service-worker.js's pure helpers, evaluated from the worker's own source. Part of test:hygiene
│   ├── sw-notification-tap.test.mjs   ← the worker's `notificationclick`, run as the real script. Part of test:hygiene
│   ├── sw-fetch-doc.test.mjs   ← the worker's document and JS/CSS fetch branches. Part of test:hygiene
│   ├── sw-lifecycle.test.mjs ← the worker's install and activate steps. Part of test:hygiene
│   ├── auth-init-parity.test.mjs ← Firebase Auth initialised with no popup/redirect resolver. Part of test:hygiene
│   ├── splash-watchdog.test.mjs ← the splash watchdog's recovery condition, from its real source. Part of test:hygiene
│   ├── session.test.mjs        ← session.js: the local session, the sign-in lifecycle and claim refresh (--experimental-test-module-mocks)
│   ├── login-overlay.test.mjs  ← the sign-in core commits the local session only after auth resolves (--experimental-test-module-mocks)
│   ├── auth-state-core.test.mjs ← the pure identity state machine. Part of test:hygiene
│   ├── auth-state.test.mjs     ← the auth store. Part of test:hygiene
│   ├── auth-policy.test.mjs    ← the page × status × role decision matrix, fail-closed on an unknown page. Part of test:hygiene
│   ├── select-sheet-pick.test.mjs ← WHEN a dropdown pick is applied. Part of test:hygiene
│   ├── select-sheet.test.mjs ← the app's own dropdown never shows a list that is not the select's. Part of test:hygiene
│   ├── select-sheet-parity.test.mjs ← **every `<select>` is enhanced, or native BY NAME with a reason**, and what an enhancement breaks. Part of test:hygiene
│   ├── native-surface-parity.test.mjs ← **the OS draws nothing the app can draw itself**. Part of test:hygiene
│   ├── overlay.test.mjs        ← the overlay helpers. Part of test:hygiene
│   ├── date-picker.test.mjs    ← the date picker's pure month grid. Part of test:hygiene
│   ├── date-format.test.mjs    ← the date composers against literal strings. Part of test:hygiene
│   ├── month-vocabulary-parity.test.mjs ← no shipped module asks a formatter for a month NAME. Part of test:hygiene
│   ├── overlay-parity.test.mjs ← the lightbox rules across every page. Part of test:hygiene
│   ├── overlay-history.test.mjs ← the Android-Back overlay history stack. Part of test:hygiene
│   ├── calendar-state.test.mjs / calendar-member.test.mjs / calendar-overrides.test.mjs ← the Calendar's state, member and override modules, including bounded reads (--experimental-test-module-mocks)
│   ├── calendar-renderer.test.mjs   ← the Calendar's cells and grid with the roster rules real (--experimental-test-module-mocks)
│   ├── calendar-initial-fetch.test.mjs ← the initial fetch, the sync chip and the two-phase load
│   ├── calendar-initial-fetch-midload.test.mjs ← back in view while the first load is out: a locked Calendar draws nothing (--experimental-test-module-mocks)
│   ├── paycalc-periods.test.mjs ← the pay periods and their helpers (--experimental-test-module-mocks)
│   ├── paycalc-hpp.test.mjs    ← the Holiday Pay Premium module (--experimental-test-module-mocks)
│   ├── paycalc-fill-year.test.mjs ← the bulk fill, by what it can destroy. Part of test:hygiene
│   ├── paycalc-hpp-schedule.test.mjs ← the Holiday Pay Premium payslip ↔ tax-year relation and its inverse. Part of test:hygiene
│   ├── paycalc-migrations.test.mjs ← the paycalc namespace and its one-shot migration (--experimental-test-module-mocks)
│   ├── paycalc-format.test.mjs ← the paycalc formatters, including the 60→next-hour guard. Part of test:hygiene
│   ├── paycalc-copy-parity.test.mjs ← the copy that decides where a member types a number. **The payslip prints a worked Sunday as "RDW Sun 1.5"** — Sunday Working, not Rest Day Working. Part of test:hygiene
│   ├── paycalc-result-headline.test.mjs ← never calling an estimate an actual. Part of test:hygiene
│   ├── paycalc-ytd-card.test.mjs ← the Year to Date card's note, chip and source anchor (--experimental-test-module-mocks)
│   ├── paycalc-disclosures.test.mjs ← every disclosure's `aria-expanded` and arrow in step with its panel. Part of test:hygiene
│   ├── pay-audience.test.mjs ← who the Pay Calculator admits, by the role at the time, and who is sent the pay reminder. Part of test:hygiene
│   ├── paycalc-money-banner.test.mjs ← the two money banners never overstating, and the take-home's lump rules behind them. Part of test:hygiene
│   ├── paycalc-clear-confirm.test.mjs ← the two-tap Clear: no delete nobody confirmed. Part of test:hygiene
│   ├── paycalc-breakdown.test.mjs ← the pay-result card builders. Part of test:hygiene
│   ├── paycalc-form-data.test.mjs ← the paycalc form round trip, a case per historical defect (--experimental-test-module-mocks)
│   ├── paycalc-backpay-state.test.mjs ← the back-pay boxes, a case per historical defect. Part of test:hygiene
│   ├── paycalc-backpay.test.mjs ← the back-pay lump sum assembled end to end, figures derived from the tax-year table
│   ├── paycalc-grade.test.mjs ← which grade a payslip's days were worked under. Part of test:hygiene
│   ├── paycalc-pension.test.mjs ← the pension timeline and its parse boundary. Part of test:hygiene
│   ├── paycalc-inventory.test.mjs ← the pay-key inventory in both directions, against every key builder in the tree. Part of test:hygiene
│   ├── paycalc-transfer.test.mjs ← the pay-data backup's trust boundary and round trip. Part of test:hygiene
│   ├── typecheck-scope.test.mjs ← what `npm run typecheck` covers, and the trigger for revisiting its gaps. Part of test:hygiene
│   ├── lint-scope.test.mjs ← each file linted in the environment it runs in. Skips without ESLint. Part of test:hygiene
│   ├── paycalc-notice-order.test.mjs ← the Year to Date notice opens last, through `openNoticeIfClear`. Part of test:hygiene
│   ├── paycalc-current-year.test.mjs ← **the tax year staff are actually being paid in**; fails loudly when a new tax year arrives, on purpose. Part of test:hygiene
│   ├── paycalc-key-parity.test.mjs ← localStorage key SHAPE, so the pay-data transfer stays complete. Part of test:hygiene
│   ├── links-design-library.test.mjs ← the Links import panel and bin through their listeners. Part of test:unit
│   ├── links-design-store.test.mjs ← the design store's concurrency protocol with a competing writer. Part of test:hygiene
│   ├── links-queued-saves.test.mjs ← which copy of a queued Links save is kept. Part of test:hygiene
│   ├── links-design-header.test.mjs ← the Links masthead: never "saved" over unseen edits. Part of test:hygiene
│   ├── links-import.test.mjs ← the design importer: a wrong claim is refused, never quietly shrunk. Part of test:hygiene
│   ├── links-contract.test.mjs ← the generator never produces a link that UNDERPAYS. Part of test:hygiene
│   ├── links-default-targets.test.mjs ← the default target table's literal against every claim made about it. Part of test:hygiene
│   ├── links-generator-targets.test.mjs ← the generator card's target table through its real listeners. Part of test:unit
│   ├── links-target-sets-store.test.mjs ← the saved sets' Firestore half: a failed read is never an empty collection. Part of test:hygiene
│   ├── links-target-sets.test.mjs ← saved target sets refused whole when corrupt, and the ownership answer; twins in firestore.rules.test.mjs. Part of test:hygiene
│   ├── links-target-hours.test.mjs ← the generator card's verdict, too kind or too harsh. Part of test:hygiene
│   ├── links-rotation-parity.test.mjs ← the rotation LENGTH is declared once and stated nowhere. Part of test:hygiene
│   ├── roster-prompt-parity.test.mjs ← the roster-parse PROMPT checked as code. Part of test:hygiene
│   ├── paycalc-inputs.test.mjs ← the pay form's input helpers. Part of test:hygiene
│   ├── paycalc-settings.test.mjs ← the money-critical rate and pension wrappers delegate correctly (--experimental-test-module-mocks)
│   ├── paycalc-grade-setting.test.mjs ← the grade setting loaded and saved through its real entry points (--experimental-test-module-mocks)
│   ├── paycalc-grade-wiring.test.mjs ← the dated grade through the settings module and the real period table (--experimental-test-module-mocks)
│   ├── usage-reporter.test.mjs ← the usage recorder's exclusions, gating and dedup (--experimental-test-module-mocks)
│   ├── perf-reporter.test.mjs ← the latency recorder's exclusions and the login marker (--experimental-test-module-mocks)
│   ├── doc-upload.test.mjs ← the upload card's type gate and flow with the real documents client (--experimental-test-module-mocks)
│   ├── operations-errors.test.mjs ← the Error Log card: overlapping reads paint only the newest (--experimental-test-module-mocks)
│   ├── firestore.rules.test.mjs ← the Firestore security rules over every collection, under the emulators (`npm run test:rules`); gates every PR and the rules deploy
│   ├── storage.rules.test.mjs  ← the Storage security rules, with `npm run test:rules`
│   ├── storage-rules-static.test.mjs ← the upload size cap is present in every Storage upload block. Part of test:hygiene
│   ├── rules-claim-gate.test.mjs ← every rule that asks for a session also requires a claim (AUTH_AND_SESSIONS 9). Part of test:hygiene
│   ├── upload-cap-parity.test.mjs ← the document-upload cap, declared in three languages, held equal. Part of test:hygiene
│   ├── dependency-pin-parity.test.mjs ← a library pinned in more than one place is ONE version (Mammoth, PDF.js). Part of test:hygiene
│   ├── sw-asset-check.test.mjs ← deployment hygiene: the SW asset lists, `APP_VERSION`, roster-members.json, the VAPID key in both places, the docs' stamps
│   ├── csp-hygiene.test.mjs    ← firebase.json's CSP permits every host the app contacts; its required host list is hand-maintained. Part of test:hygiene
│   ├── hosting-ignore-parity.test.mjs ← **tooling is not part of the served app**: the dot-directories in firebase.json's ignore list. Part of test:hygiene
│   ├── csp-meta-parity.test.mjs ← the RULE every page's generated `<meta>` CSP follows: the firebase.json header minus what a meta cannot carry. Part of test:hygiene
│   ├── generated-copies.test.mjs ← everything `npm run generate:copies` writes is committed as it would write it now. Part of test:hygiene
│   ├── file-index-generator.test.mjs ← `npm run generate:file-index` adds and removes module rows and touches nothing else; the real index needs nothing. Part of test:hygiene
│   ├── guide-sources.test.mjs ← GUIDE_SOURCES.md's structure and its two-way contract with the pages. Part of test:hygiene
│   ├── app-name-parity.test.mjs ← **"MYB" may name the STATION, never the SOFTWARE** ("Marylebone Roster"). Part of test:hygiene
│   ├── rdw-term-parity.test.mjs ← **RDW has one name on screen: "Rest Day Working"**. Part of test:hygiene
│   ├── uk-english-parity.test.mjs ← **the app speaks UK English**; its word list: its header. Part of test:hygiene
│   ├── welcome-email-parity.test.mjs ← the rules the welcome email's generated copies follow (grade, Pay Calculator section, phone fit). Part of test:hygiene
│   ├── al-copy-parity.test.mjs ← the Annual Leave help teaches the rule the save follows. Part of test:hygiene
│   ├── admin-al-week-save.test.mjs ← a week-grid save's annual leave. Part of test:hygiene
│   ├── card-header-parity.test.mjs ← the card-header conventions. Part of test:hygiene
│   ├── page-identity-parity.test.mjs ← page colour through `--page-accent`. Part of test:hygiene
│   ├── coordinator-ratchet.test.mjs ← **coordinators coordinate; domain modules decide** — a size RATCHET. Part of test:hygiene
│   ├── stylesheet-ratchet.test.mjs ← the stylesheet size ratchet
│   ├── public-data-classification.test.mjs ← **`roster-data.js` is served to anyone who asks**: every field needs a classification. Part of test:hygiene
│   ├── payroll-anonymity.test.mjs ← no roster NAME on the same line as a payroll term anywhere in the tracked tree (the mirror serves it). Its header
│   ├── doc-parity.test.mjs ← the documentation is CHECKED: routing, wiring, symbols, counts, and this tree's caps. Part of test:hygiene
│   ├── module-coverage-parity.test.mjs ← **is there a module nobody thought about at all?** Part of test:hygiene
│   ├── mutate-script.test.mjs ← `scripts/mutate.mjs`, run. Part of test:hygiene
│   ├── mutation-sweep-script.test.mjs ← `scripts/mutation-sweep.mjs`, run on scratch manifests, and the real manifest's `--check-only`: a stale entry fails here. Part of test:hygiene
│   ├── run-tests-script.test.mjs ← `scripts/run-tests.mjs`, run on scratch suites. Part of test:hygiene
│   ├── bump-version-script.test.mjs ← `scripts/bump-version.mjs`, run on a scratch copy. Part of test:hygiene
│   ├── refresh-visual-script.test.mjs ← `scripts/refresh-visual-baselines.mjs`, run in a scratch repository. Part of test:hygiene
│   ├── audit-deps-script.test.mjs ← `scripts/audit-functions-deps.sh`, run with a fake `npm`. Part of test:hygiene
│   ├── server-identity.test.mjs ← a Playwright run never tests another checkout's server. Part of test:hygiene
│   ├── runner-parity.test.mjs ← **an opt-in spec must not run in the behavioural lanes**
│   ├── firebase-client.test.mjs ← the Firestore and Auth I/O layer through the real module against the recording fake SDK
│   ├── auth-endpoints.test.mjs ← the account-and-credential handlers through the real code against fakes. Runs in test:functions
│   ├── account-lifecycle.test.mjs ← functions/account-lifecycle.js's pure rules at their edges. Runs in test:functions
│   ├── documents-endpoints.test.mjs ← the document domain's handlers executed: no double push, no silent non-push. Runs in test:functions
│   ├── push-transport.test.mjs ← the two push senders: **too wide is a leak, miscounted is a lie**. Runs in test:functions
│   ├── error-log-notify.test.mjs ← the Error Log notification's sender executed: the admin's devices only, once an hour. Runs in test:functions
│   ├── index-endpoints.test.mjs ← the composition root's handler executed: `parseRosterPDF`'s admin guard, its request and its answer. Runs in test:functions
│   ├── overtime-endpoints.test.mjs ← the Overtime endpoints executed against fakes. Runs in test:functions
│   ├── page-visibility-parity.test.mjs ← **`hidden` must actually hide** (an author `display:` out-specifies it). Part of test:hygiene
│   ├── pre-commit-parity.test.mjs ← the pre-commit hook can READ what it checks. Part of test:hygiene
│   ├── page-start.test.mjs   ← the start-up's ORDER: Back guard before any decision, the re-decision after an in-place sign-in, the reload with no session. Part of test:unit
│   ├── page-session.test.mjs ← the shared sign-out and session-loss routines, asserted as an ORDER, and the back/forward-cache guard. Part of test:unit
│   ├── page-contract-parity.test.mjs ← **a new app page joins EVERY contract, or fails here**. Part of test:hygiene
│   ├── overtime-data.test.mjs ← the Overtime clock and what a call says when it does not come back (--experimental-test-module-mocks)
│   ├── overtime-roster.test.mjs ← whose roster reached the member's device, and whether it was read at all (--experimental-test-module-mocks)
│   ├── overtime-form.test.mjs ← the member's Overtime form after a submission it cannot see (--experimental-test-module-mocks)
│   ├── overtime-review-controller.test.mjs ← which Overtime week is on screen when reads resolve out of order (--experimental-test-module-mocks)
│   ├── overtime-manager.test.mjs ← the reviewer's by-day view: **no response and not available never merge**. Part of test:hygiene
│   ├── overtime-parity.test.mjs ← the two copies of `deriveHistory` agree by behaviour. Part of test:hygiene
│   ├── overtime-format.test.mjs ← the Overtime client's words and its deadline clock. Part of test:hygiene
│   ├── overtime-clock.test.mjs ← overtime-clock.js's extraction: the same objects re-exported, no imports. Part of test:hygiene
│   ├── trains-assemble.test.mjs ← the timetable builder (`assemble.py`) joins a continued train only to its ONE continuation, run on synthetic books. Part of test:hygiene; skipped without python3
│   ├── trains-change.test.mjs ← what the Trains page says changes, against hand-checked facts from the printed books. Part of test:hygiene
│   ├── trains-stations.test.mjs ← the Trains page from a station, and its words. Part of test:hygiene
│   ├── newlink-data.test.mjs ← the new link page says what the pack says (the generator in `--check` mode)
│   ├── newlink-config.test.mjs ← the new link page's switch held to its gate and audience
│   ├── newlink-render.test.mjs ← every surface the new link page can show: evenly, not your roster, taught in place
│   ├── newlink-boundary.test.mjs ← a proposal never reaches a roster surface, by the real import graph
│   ├── pdf-viewer-core.test.mjs ← the PDF viewer's rules; the wiring is e2e/newlink.spec.js. Part of test:hygiene
│   ├── member-identity.test.mjs ← the server's name binding. Part of test:hygiene
│   ├── doc-url-core.test.mjs ← the short-lived document URL's rules, read against firestore.rules itself. Part of test:hygiene
│   ├── doc-link-rotation.test.mjs ← the document link rotation against write-logging fakes. Part of test:hygiene
│   ├── error-log-notice.test.mjs ← the Error Log notification's rules and words. Part of test:hygiene
│   ├── london-clock.test.mjs ← london-clock.js's extraction. Part of test:hygiene
│   ├── overtime-core.test.mjs ← the Overtime rules by the way each can be wrong unnoticed. Part of test:hygiene
│   ├── text-scale.test.mjs ← the compact-row decision both ways, and the probe's fallbacks. Part of test:hygiene
│   ├── calendar-controls-parity.test.mjs ← four static contracts on index.css's control rows. Part of test:hygiene
│   ├── day-detail-explains.test.mjs ← **if a symbol can appear in a CELL, the day panel explains it in FULL WORDS**. Part of test:hygiene
│   ├── calendar-snapshot.test.mjs ← every refusal of the own-roster copy. Part of test:hygiene
│   ├── calendar-own-copy.test.mjs ← which records the own-roster copy keeps, and when the Calendar offers it. Part of test:hygiene
│   ├── calendar-data-state.test.mjs ← showing too much or too little, which is why `cached` is its own state. Part of test:hygiene
│   ├── calendar-legend.test.mjs ← the legend by cost: never speaking for a month we have not got. Part of test:hygiene
│   ├── calendar-access-state.test.mjs ← the one copy of whether Calendar access is held, and that both gates agree
│   ├── calendar-sequences.test.mjs ← the Calendar's access, reads and redraws through thousands of seeded random event ORDERS; `CALENDAR_SEQUENCE_SEED` replays a failure (--experimental-test-module-mocks)
│   ├── calendar-redraw.test.mjs ← the four rules of when the Calendar may draw, against a test-owned clock
│   ├── calendar-drawer.test.mjs ← the Calendar's menu built and rebuilt for the session saved at the time
│   ├── calendar-doc-access.test.mjs ← the document gate defaults SHUT. Part of test:hygiene
│   ├── calendar-access-core.test.mjs ← the Calendar access decision as states the app can really be in. Part of test:hygiene
│   ├── calendar-access.test.mjs ← the gate's decision, cards, grant and loss, asserting ORDER; a leftover viewer session is never granted (--experimental-test-module-mocks)
│   ├── calendar-access-gate.test.mjs ← **no access, no override data** — the cache never consults the rules (--experimental-test-module-mocks)
│   ├── calendar-viewer-parity.test.mjs ← the retired PIN's static contracts: one viewer uid and claim across the boundary, no grant in the rules, no exchange or secret on the server, and the PIN never in the repository. Part of test:hygiene
│   ├── calendar-notices.test.mjs ← who a Calendar notice is addressed to, and whether it asks (--experimental-test-module-mocks)
│   ├── install-route.test.mjs ← the install notice's route through the real `installRoute()`
│   ├── calendar-doc-viewer.test.mjs ← the Circular/Newsletter in-app viewer (--experimental-test-module-mocks)
│   ├── calendar-huddle-viewer.test.mjs ← the Daily Huddle viewer and the document gate. Part of test:unit
│   ├── calendar-keyboard.test.mjs ← the Calendar's keyboard grammar and page shortcuts. Part of test:unit
│   ├── calendar-month-jump.test.mjs ← the month/year jump picker, and a lost grant stopping it. Part of test:unit
│   ├── calendar-notif-prompt.test.mjs ← the notification strip's two access rules. Part of test:unit
│   ├── page-css-parity.test.mjs ← a page may only use classes its OWN stylesheets define. Part of test:hygiene
│   ├── css-var-parity.test.mjs ← every `var(--x)` a page can reach is declared on that page. Part of test:hygiene
│   ├── css-hex-parity.test.mjs ← the "never hardcode hex" rule; the exemptions: its header. Part of test:hygiene
│   ├── firestore-contract-parity.test.mjs ← the client's lists match the literals `firestore.rules` restates
│   ├── focus-ring-parity.test.mjs ← the focus ring: tokens only, and an indicator wherever the outline is removed. Part of test:hygiene
│   ├── type-scale-parity.test.mjs ← the `--type-*` scale is the scale. Part of test:hygiene
│   ├── shadow-parity.test.mjs ← the box-shadow count may only come down. Part of test:hygiene
│   ├── lightbox-transform-parity.test.mjs ← **the lightbox entry animation must not be frozen by SPECIFICITY**. Part of test:hygiene
│   ├── chip-radius-parity.test.mjs ← a chip must not wear the lightbox/panel corner. Part of test:hygiene
│   ├── auth-plan-parity.test.mjs ← Track E written once: AUTH_PLAN.md's phase list whole, SECURITY_RELEASE_PLAN.md's Track E section kept a pointer, shipped versions agreeing with the status table; and the credential lifecycle's unadopted C5 route. Part of test:hygiene
│   ├── tips-content.test.mjs ← every page's tips and HELP_CONTENT in the shape their renderers require. Part of test:hygiene
│   ├── glossary.test.mjs ← the glossary's words, one line each, and the test that decides which panels link to it. Part of test:hygiene
│   ├── workflow-hygiene.test.mjs ← the CI workflows: pins, timeouts, concurrency and the job list
│   ├── guide-app-parity.test.mjs ← the Staff & Admin Guide against the app's own lists. Part of test:hygiene
│   ├── guide-colour-parity.test.mjs ← the guide palettes' contract with the app. Part of test:hygiene
│   ├── module-parse.test.mjs   ← every root JS module parses as an ES module (`node --check` misses ES-module syntax errors)
├── e2e/                    ← the Playwright smoke suite (`npm run test:e2e`): every page in headless Chromium with the Firebase SDK stubbed. NOT part of `npm test`; CSP header violations need `npm run test:csp`
│   ├── calendar-day-detail.spec.js ← the Calendar's day-detail panel: what a day is, what it changed from, its personal actions, one Back out
│   ├── calendar-documents.spec.js ← the Huddle, Circular and Newsletter buttons, drawer entries and viewers
│   ├── calendar-leave-panel.spec.js ← the Calendar's leave panel: its balance, year, links and Christmas leave
│   ├── calendar-team-view.spec.js ← Team Week View: the week it opens on, the week jump, its table and swipe hint
│   ├── calendar-loading.spec.js ← a month withheld until its records are known: the retry, the sync chip, the saved copy, the month kept across a reload
│   ├── calendar-swipe-redraw.spec.js ← the month swipe and the `redraw:` tests; focus kept across a rebuilt grid
│   ├── calendar-notices.spec.js ← the install strip and the Calendar's one-time notices, and their order
│   ├── calendar-drawer-guides.spec.js ← the drawer, guide links and guide search, the telemetry identity, the bug report
│   ├── calendar-member-picker.spec.js ← the name picker, a member gone from the list, and the iPhone focus and touch checks
│   ├── calendar-phone-layout.spec.js ← the Calendar at phone widths and under text scaling
│   ├── calendar-desktop.spec.js ← the Calendar's desktop audit (CAL1–CAL12) and its header from 768px
│   ├── calendar-helpers.js ← what more than one calendar-*.spec.js needs (not a spec)
│   ├── calendar-access.spec.js ← the Calendar's access gate in a real browser: no roster data in a locked DOM, and a leftover staff-PIN session signed out on every page. Its header
│   ├── auth.spec.js        ← the sign-in overlay and named-session enforcement on every authenticated page
│   ├── paycalc-page.spec.js ← the Pay Calculator's sign-in, period selector and picker, privacy note and desktop workspace
│   ├── paycalc-calendar-fill.spec.js ← figures from the calendar: the gold highlight, Fill this tax year, Fill and Replace
│   ├── paycalc-entries.spec.js ← entered hours and settings: what a settings change may save, the loan line, Clear all entries
│   ├── paycalc-ytd.spec.js ← the payslip check and the Year to Date figures
│   ├── paycalc-notices.spec.js ← the Pay notices and the Holiday Pay Premium, a joiner's included
│   ├── paycalc-backup.spec.js ← backup and restore, the share sheet, a browser that will not save
│   ├── paycalc-pension.spec.js ← the pension opt-out
│   ├── paycalc-backpay.spec.js ← the back-pay and premium lumps, the take-home £ and the loan rows
│   ├── paycalc-grades.spec.js ← grades and roles: the unsupported-role card, a manager, a promotion, a grade chosen by hand
│   ├── paycalc-layout.spec.js ← how the Pay page is drawn, and its desktop audit (PAY1–PAY12)
│   ├── paycalc-hours-entry.spec.js ← typing hours: decimal commas and minutes, the iPhone keypad, the Saturday hours
│   ├── paycalc-helpers.js ← what more than one paycalc-*.spec.js needs, the roster rows chosen by shape included (not a spec)
│   ├── paycalc-cards.spec.js ← the Pay Calculator's occasional cards against the rest of the page
│   ├── pages.spec.js       ← the browser tests that SPAN pages: every-page sweeps, the drawer, dialogs, the select sheet, large text. The `@a11y` `KNOWN_SMALL` baseline only shrinks
│   ├── every-page.spec.js  ← the release gate's iPhone check (deploy-hosting.yml's `safari` job): every page opens, every guide draws, every old address lands. Pages from scripts/app-pages.mjs
│   ├── admin-unsaved-work.spec.js ← Admin's staged work: leaving or signing out with edits, the kept draft, the week read again on return
│   ├── admin-leave-booking.spec.js ← booking leave and absence: the AL banner, the leave year, the leave picker, the preview
│   ├── admin-leave-spare.spec.js ← leave in a Spare week and what it costs
│   ├── admin-rest-day-swap.spec.js ← leave on a rest day: the swap question and what each answer writes
│   ├── admin-leave-records.spec.js ← the Recorded dates list by year, its deletes, and focus after one
│   ├── admin-saves.spec.js ← Admin's saves: the receipt, a slow or revoked save, a colleague's change refused, the page's own write
│   ├── admin-week-grid.spec.js ← the week grid: time boxes, the Sunday and Christmas rules, the bulk bar, its columns, the swipe and week jump
│   ├── admin-layout.spec.js ← how Admin is drawn: readable chips, the Unsaved bar, the desktop audit
│   ├── admin-helpers.js ← what more than one admin-*.spec.js needs (not a spec)
│   ├── clock-box-properties.spec.js ← a real text clock box under seeded random edit sequences: never a time nobody typed, never a caret thrown past a digit. Desktop projects only; its header
│   ├── links.spec.js       ← the Links workspace in a real browser (the shortlist's own row is links-shortlist.spec.js)
│   ├── operations.spec.js  ← Operations in a real browser
│   ├── al-sheet-fixture.js ← a sealed leave file built at test time; members chosen BY RULE, never typed by name
│   ├── settings.spec.js    ← Settings in a real browser
│   ├── guides.spec.js      ← the guide pages in a real browser
│   ├── glossary.spec.js    ← the glossary from the drawer and from a `?` panel's foot, in the page's own panel
│   ├── overtime.spec.js ← the Overtime page in a real browser: it boots, a reviewer gets no personal form, and the member form's three rules through the real submit path
│   ├── trains.spec.js ← the Trains page through its real coordinator — the wiring half of the trains-change and trains-stations tests
│   ├── newlink.spec.js ← the new link page through its real coordinator, including who is sent back
│   ├── links-shortlist.spec.js ← the Links "Keep only the shortlist" row pressed for real
│   ├── responsive.spec.js  ← desktop geometry at 1024–1440px, no horizontal overflow
│   ├── axe.spec.js         ← the accessibility gate (axe-core, WCAG A/AA), tagged `@a11y`, BLOCKING inside `npm run test:e2e`; baseline in A11Y_BASELINE.md
│   ├── csp.spec.js         ← the deployed-CSP proof (`npm run test:csp`): the Hosting emulator serves the real header and any violation fails. Excluded from the smoke run
│   ├── visual.spec.js ← visual-regression baselines (`npm run test:visual`). **Report-only in branch CI** — run it before merging a CSS change. Its header
│   ├── print.spec.js ← **paper as a product surface**: the only spec that sees the print stylesheet. Its header
│   ├── print-visual.spec.js ← **a picture of PAPER**: the real PDF's page 1 rasterised with poppler. Report-only visual lane; Chromium only
│   ├── visual-harness.js ← the determinism levers shared by the pixel specs, in one copy
│   ├── visual-webkit.spec.js ← **a small baseline set under Safari's engine** (the mobile month grid is deliberately absent — its header)
│   ├── live.spec.js ← **the DEPLOYMENT HEALTH CHECK** (`npm run test:live`, and `live-health.yml`): the real site on both origins. Gates nothing; playwright.live.mjs says why service workers are blocked
│   ├── forced-colors.spec.js ← **Windows High Contrast**, read from the painted PNG. Chromium only
│   ├── chosen-colour.spec.js ← a choice is PAINTED in the colour its rule names, on screen
│   ├── offline.spec.js     ← the offline-first paths with the network cut (`npm run test:offline` only)
│   ├── signed-in.spec.js ← **the app's REAL Firebase SDK, signed in** (`npm run test:signed-in` only): journeys on Android Chrome and iPhone Safari through the real rules and Functions on the emulators
│   ├── signed-in-fixtures.js ← that lane's page fixture: the real SDK against the emulators, every other Google request refused. Its header
│   ├── signed-in-env.mjs ← where that lane's emulators live, in one place
│   ├── signed-in-setup.mjs ← that lane's accounts, made through the real `setupRosterAuth`
│   ├── playwright.signed-in.mjs ← that lane's config, kept in e2e/ so it is not served (its header)
│   ├── visual-baselines/   ← committed baseline PNGs for visual.spec.js
│   ├── dev-server.mjs ← which static server a Playwright run talks to, and when reusing one is safe. Its header
│   ├── server-identity.mjs ← that `globalSetup`: a reused server must prove it is this checkout's, or the run stops
│   ├── touch-projects.js ← `TOUCH_PROJECTS`, in a file that imports nothing (its header says why)
│   ├── helpers.js          ← shared spec helpers
│   └── fixtures.js         ← hermetic Firebase: local stubs for the SDK; `writeBatch` RECORDS its payloads so a spec asserts what was written
├── playwright.config.mjs   ← Playwright config: the chromium and mobile-chrome smoke projects; its `testIgnore` is checked by runner-parity.test.mjs
├── playwright.csp.mjs      ← config for the deployed-CSP proof against the Hosting emulator
├── playwright.visual.mjs   ← config for the Chromium visual baselines (the report-only `visual` job)
├── playwright.visual-webkit.mjs ← config for the WebKit baseline set
├── playwright.live.mjs ← config for the deployment health check — no webServer; its header says why `serviceWorkers: 'block'` and `retries: 0`
├── playwright.offline.mjs  ← config for the offline proof; weekly, non-blocking, via `offline.yml`
├── playwright.webkit.mjs   ← the smoke suite under Safari's engine (`npm run test:webkit`), sharded in branch CI. The engine, not an iPhone: its header
├── package.json            ← dev dependencies only
├── .firebaserc · .gitignore · package-lock.json ← config: the default Firebase project, what must never be committed, and the root lockfile
├── eslint.config.js        ← flat ESLint config, each file linted in the environment it runs in (lint-scope.test.mjs)
├── scripts/
│   ├── app-pages.mjs             ← THE ONE LIST OF THE APP'S PAGES for the tests and tools; page-contract-parity.test.mjs checks the app's own lists against it
│   ├── run-tests.mjs             ← every `node --test` script runs through this, because a `describe` that throws while being built **exits 0**
│   ├── bump-version.mjs          ← `npm run bump <version>` — writes `APP_VERSION` in both runtime locations
│   ├── generate-roster-members.mjs ← `npm run generate:roster-members` — rebuilds functions/roster-members.json
│   ├── generate-guide-index.mjs    ← `npm run generate:guide-index` — rebuilds guide-index.js from the guide pages
│   ├── generate-ai-map.mjs         ← `npm run generate:ai-map` — rewrites the `- **Exports:**` line of every docs/AI_MAP.md entry from the module itself
│   ├── generate-copies.mjs         ← `npm run generate:copies` — WRITES the facts kept in more than one file from the one place each is edited; its header lists them
│   ├── generate-file-index.mjs     ← `npm run generate:file-index` — a row in this file for every module that has none (from its header), none for a script that has gone; every other row left as written
│   ├── audit-functions-deps.sh ← the Cloud Functions' production-dependency audit, for the deploy gate and the weekly monitor. Its header
│   ├── signed-in.mjs             ← `npm run test:signed-in`: a throwaway Firebase project, the emulators and the accounts, then Playwright. Writes nothing into the checkout
│   ├── test-lanes.mjs            ← which lane each Node suite runs in, read from its own `// @lane` line; `run-tests.mjs --lane` and `test-nodeps.mjs` ask it
│   ├── test-nodeps.mjs           ← `npm run test:nodeps` — every suite that needs nothing installed; its exclusions are the `functions` and `rules` lanes
│   ├── hosting-upload-check.mjs  ← refuses to publish anything to Hosting that git does not track (run by deploy-hosting.yml)
│   ├── make-leave-file.mjs       ← STAGE 1 of the leave uploader, run in a session on the clerks' workbook (DECISIONS.md → The annual leave uploader). Never run on a real workbook in CI
│   ├── xlsx-read.mjs             ← just enough .xlsx reading for that script; the workbook is untrusted
│   ├── mutate.mjs                ← break ONE line on purpose, run a command, put the file back — the tool CLAUDE.md requires before claiming a guard. Its header
│   ├── mutation-sweep.mjs        ← `npm run test:mutation`: every manifest entry through mutate.mjs, one table; fails on a survivor or a stale entry. Weekly in `mutation.yml`. Its header
│   ├── mutation-manifest.mjs     ← the WIRING lines that sweep breaks — money, access, naming — each with its narrowest test and what it would break. Its header
│   ├── refresh-visual-baselines.mjs ← `npm run test:visual:refresh` — updates only the failed visual baselines, or copies CI's render from the artifact. Its header
│   └── typecheck.mjs             ← `npm run typecheck`; with no local compiler it REFUSES rather than run an unpinned `npx tsc`
├── jsconfig.json               ← TypeScript config for `// @ts-check`; its `exclude` list is pinned by `typecheck-scope.test.mjs`
├── firebase.json           ← Firebase Hosting config: CSP headers, cache rules, redirects, emulator ports. **Change the CSP header, then `npm run generate:copies`** — it writes every page's `<meta>`
├── firestore.rules         ← Firestore security rules (deploy-rules.yml, gated by firestore.rules.test.mjs)
├── storage.rules / firestore.indexes.json ← Firebase Storage rules + Firestore composite indexes
├── generate-sri.mjs        ← dev utility: patches the Mammoth CDN SRI hash in huddle.js
└── functions/
    ├── index.js                  ← the COMPOSITION ROOT of the Cloud Functions: shared infrastructure, `parseRosterPDF`, and re-exports of the domain endpoints. **The exports ARE the deploy surface** (the deploy runs `--force`, so a dropped export is a deleted function); `functions-surface.test.mjs` pins them
    ├── documents.js               ← the DOCUMENT-AND-NOTIFICATION domain: the Huddle ingest, `getDocumentUrl`, `rotateDocumentLinks`, the create triggers and the schedules; a factory, so index.js keeps the shared literals
    ├── newlink-reminder.js        ← the one-off New link push before the vote: the New link page's audience only, targeted, failing closed; its 18:00 schedule, date-guarded to 26 Nov 2026, wired in index.js
    ├── pay-reminder.js            ← WHO the pay reminder reaches (CEA and CES members), as a targeted send that fails closed; documents.js decides WHEN
    ├── error-log-notify.js        ← the admin's Error Log notification, SENT to the admin's own devices only. Tested by error-log-notify.test.mjs
    ├── error-log-notice.js        ← the RULES of that notification, no I/O; the words are counts only. Tested by error-log-notice.test.mjs
    ├── huddle-ingest.js           ← the Power Automate Huddle upload: checks, the Storage write, new-arrival vs re-send, and whether to announce. Tested by documents-endpoints.test.mjs
    ├── huddle-retention.js        ← how long a Daily Huddle is kept and what its clean-up may delete. Tested through documents-endpoints.test.mjs
    ├── auth-endpoints.js          ← the ACCOUNT-AND-CREDENTIAL domain: setupRosterAuth, resetMemberPassword and the account reads
    ├── account-reads.js           ← the account domain's two admin READS, built by auth-endpoints.js. Tested by auth-endpoints.test.mjs
    ├── account-lifecycle.js       ← the pure rules at the edges of an account's life (Set up accounts, the admin reset). Tested by account-lifecycle.test.mjs and auth-endpoints.test.mjs
    ├── account-rules.js           ← the pure ACCOUNT rules: claim tiers, leaver orphans, the provisioning audit, the sign-in counts. Its header. Tested by roster-parse-helpers.test.mjs and auth-endpoints.test.mjs
    ├── reset-request.js           ← `requestPasswordReset`, the public doorbell a locked-out member rings: records a request, pushes to the admin's devices only. Tested by auth-endpoints.test.mjs
    ├── reset-request-rules.js     ← the reset-request queue's RULES: the throttle, the one-push-per-burst window, the notice's words. Pure. Tested by roster-parse-helpers.test.mjs and auth-endpoints.test.mjs
    ├── admin-recipients.js        ← WHO a notice for the admin may reach — one rule for every admin notice. See also auth-endpoints.test.mjs, documents-endpoints.test.mjs, overtime-endpoints.test.mjs.
    ├── push.js                    ← the web-push TRANSPORT: `fanOutPush` and `sendTargetedPush` (**fails closed, never falls back to everyone**); never what a payload says. See also push-transport.test.mjs.
    ├── push-guards.js             ← the push TRANSPORT guards: only to a real push service, and delete only a dead subscription. Pure. Tested by roster-parse-helpers.test.mjs and push-transport.test.mjs
    ├── push-notices.js            ← the push DESIGN LANGUAGE and `buildPushPayload`, the one builder (`.claude/rules/notifications.md`). Pure
    ├── roster-parse-helpers.js   ← pure roster-parse helpers, and the one server copy of the name → account derivation (`nameToEmail`, `nameToPassword`)
    ├── roster-geometry.js        ← what the roster PDF's OWN GRID says about where each cell is — the import's only witness that is not the model. Its header. Tested by roster-geometry.test.mjs
    ├── roster-sunday-repair.js   ← layer 1 of the day-drift defence: the Sunday-anchored repair. Tested by roster-parse-helpers.test.mjs + index-endpoints.test.mjs
    ├── roster-week-heading.js   ← the week the roster SAYS it is for, read from its printed heading; a sheet for another week is refused. Tested by roster-geometry.test.mjs + index-endpoints.test.mjs
    ├── roster-prompt.js          ← the two roster-parse prompts and the ONE code table they share. Its header. Tested by roster-cell-read.test.mjs + roster-prompt-parity.test.mjs
    ├── cell-day-rules.js   ← what a roster cell means given WHICH DAY it is in, one function per rule. See also roster-parse-helpers.test.mjs, index-endpoints.test.mjs.
    ├── roster-other-days.js   ← what a roster cell reads as when it names an Other-family day. Tested by roster-parse-helpers.test.mjs + index-endpoints.test.mjs
    ├── overtime.js                ← the OVERTIME domain's endpoints; retention is filtered here, not in the rules. Design: OVERTIME_AVAILABILITY.md
    ├── member-identity.js         ← which member a verified ID token speaks for, or none — the server twin of `isMember()`. Its header. See also member-identity.test.mjs.
    ├── request-helpers.js         ← the request plumbing every endpoint shares, in one copy. See also doc-url-core.test.mjs.
    ├── caught.js                  ← the fields a `catch` reads off a thrown value, typed for the `unknown` it is (`fieldsOf`). Requires nothing
    ├── region.js                  ← `REGION`, the one region every function deploys to; function-url.js is the browser's half. Requires nothing
    ├── web-push.d.ts              ← types for the part of `web-push` push.js calls (the package ships none); read only by the type-checker
    ├── jsconfig.json              ← the Functions' own strict type-check (`npm run typecheck` runs it beside the root one)
    ├── doc-url-core.js            ← who may be handed a document URL, for which document and for how long — a door that MIRRORS firestore.rules, taking a KIND, never a path. Design: AUTH_PLAN.md §5
    ├── doc-link-rotation.js       ← a new key for the permanent link of every stored document file, so old copies stop opening it (ARCHITECTURE.md EXC-007). Its header. See also doc-link-rotation.test.mjs.
    ├── london-clock.js            ← an ISO date and the instant it names in London. **Requires nothing**, which keeps overtime-core.test.mjs in the every-branch lane
    ├── overtime-core.js           ← every RULE Overtime Availability has, with no I/O. **The deadline hours are the highest-risk thing in the feature.** Design: OVERTIME_AVAILABILITY.md
    ├── retired-viewer-account.js  ← the retired staff PIN's shared account, recognised so Set up accounts, the leaver sweep, a reset and the notices never adopt it; deleted in the cleanup release. Its header
    ├── roster-members.json       ← generated from roster-data.js — do NOT hand-edit; `npm run generate:roster-members`. The server-owned name and role lists. CI-locked by sw-asset-check.test.mjs
    └── package.json
```
