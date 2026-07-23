# AI_MAP.md — Claude routing guide for MYB Roster

*Last updated: July 2026 — v18.70 · Updated every 0.10 version*

Use this file to decide which source file to read or edit for a given task.
Read CLAUDE.md first for project identity, version bumping rules, and architecture constraints.

---

## Quick decision table

| Task | Primary file(s) |
|------|----------------|
| Roster logic, team members, bank holidays, pay periods | `roster-data.js` |
| Raw roster cycle patterns (weeklyRoster, cesRoster, etc.) | `roster-cycle-data.js` |
| Calendar UI coordinator — event wiring, month navigation, Team Week View, notifications | `calendar-app.js` |
| Calendar display state — getDisplayMonth/Year, setDisplayMonth/Year, changeDisplay, persistViewedMonth | `calendar-state.js` |
| Calendar swipe carousel — initSwipeHandler, isSwipeCooldown | `calendar-swipe.js` |
| Calendar AL lightbox + day-detail lightbox — initCalendarLightboxes | `calendar-al-lightbox.js` |
| Calendar initial 3-month fetch + sync chip — initInitialFetch | `calendar-initial-fetch.js` |
| Calendar keyboard nav + hover tooltip — initCalendarKeyboard, initCalendarTooltip | `calendar-keyboard.js` |
| Calendar override cache — rosterOverridesCache, fetchOverridesForRange, ensureOverridesCached, getShiftTypesInMonth | `calendar-overrides.js` |
| Calendar member selection — getSelectedMemberIndex, getCurrentMember, populateTeamMemberDropdown, validateTeamMembers | `calendar-member.js` |
| Calendar rendering — buildCalendarContainer, createCalendarHeader, createDayCell, getSwipeDirection | `calendar-renderer.js` |
| Huddle viewer overlay, _triggerAutoOpen, hashchange, subscription | `calendar-huddle-viewer.js` |
| Circular/Newsletter in-app viewer (#circular/#newsletter notification deep link) | `calendar-doc-viewer.js` |
| Team Week View — initTeamView (grid, navigation, Firestore fetch, toggle) | `calendar-team-view.js` |
| Override priority, member-start, rest-shift helpers — tsToMillis, shouldReplaceOverride, reconcileRangeIntoCache (authoritative range refresh), isBeforeMemberStart, isRestShift, isOverrideDisplaySuppressed, resolveEffectiveShift (shared display ladder), computePeriodDeleteIds; training value grammar + pay resolver | `override-utils.js` |
| Body scroll lock, overlay history, focus trap, lightbox lifecycle, card collapse (lockBodyScroll, trapFocus, createLightbox, initCardCollapse, etc.) | `overlay.js` |
| About panel content (version, update status, bug link, print button) | `about-lightbox.js` |
| Per-card ? tips lightbox lifecycle/renderer (content data stays per page) | `tips-lightbox.js` |
| Service worker registration + update lifecycle (all six app pages) | `sw-register.js` |
| Auth/session helpers (AUTH_KEY, getSession, saveSession, clearSession, ensureFirebaseSession) | `session.js` |
| Admin portal UI, login, AL, sick, overrides, module wiring | `admin-app.js` (+ `admin-boot.js`) + `admin.html` |
| Settings page — Notifications, Work Email | `settings-app.js` + `settings.html` |
| Nav-panel footer initials badge | `nav-panel.js` + `avatarInitials`/`avatarHue` in `roster-data.js` |
| Operations page — Huddle upload, Roster upload, Staff Login Accounts | `operations-app.js` + `operations.html` |
| Error Log card (ops page) — uncaught error capture, ops card display, Copy for Claude | `error-reporter.js`, `firebase-client.js` (logClientError/getClientErrors/resolveClientError), `client-errors.js` (ordering/retention policy), `operations-app.js`, `operations.css` |
| Usage card (ops page) — anonymous page popularity + active-account counts | `usage-reporter.js` (recordUsage per page), `firebase-client.js` (recordPageView/recordActiveAccount/getUsageStats), `usage-stats.js` (date/aggregation maths), `operations-app.js`, `operations.css`, `firestore.rules` (`analytics`) |
| Links design workspace — 28-line design grid, paint mode, hourly coverage heat map, design checks, auto-generator UI | `links-app.js` + `links.html` + `links.css` |
| Link-design maths — shift classification, custom-time validation, coverage counting (per-type + hour-by-hour), rotating-window generator, design quality checks | `links-design.js` (pure — no DOM/Firebase; tested by `links-design.test.mjs`) · `runDesignChecks(patterns, rotatingLines)` returns `{ weekendsOff, weekendsOffPct, totalWeeks, unfilledLines, turnarounds, longestStretch, balance }` |
| Annual Leave Booking section | `admin-al.js` |
| Sick Days Recording section | `admin-sick.js` |
| Huddle upload (admin-only, operations page) | `huddle.js` → `initHuddleUpload` |
| Push notifications card (all staff, settings page) | `huddle.js` → `initHuddleNotifications` |
| Staff Firebase Auth account setup card | `admin-auth.js` |
| Change a Shift — week grid, override entry, bulk bar, save logic | `admin-overrides.js` |
| Inline date-range calendar widget (AL and Sick date pickers) | `admin-rangepicker.js` |
| Roster PDF upload, review pipeline, cell state logic | `admin-roster-upload.js` |
| Roster PDF parsing (Cloud Function) | `functions/index.js` + `functions/roster-parse-helpers.js` |
| Pay calculator coordinator — calculate(), autosave, HPP, back-pay | `paycalc-app.js` + `paycalc.html` |
| Pay calculator lightboxes — About, Help, Welcome, YTD notice, decimal converter | `paycalc-lightboxes.js` |
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
| Cross-file localStorage key constants (SELECTED_MEMBER + legacy alias, VIEWED_MONTH/YEAR) | `storage-keys.js` |
| Push notifications, Huddle ingest, auth setup | `functions/index.js` |
| Railcard at-work reference — cards, GroupSave, season tickets, gateline checks | `railcard-guide.html` + `railcard-guide.js` + `railcard-guide.css` |
| Print button for guide.html and paycalc-guide.html | `guide-print.js` |
| Shared guide chrome — header, back/PDF buttons, print banner (all 4 guides) | `guide-shell.css` |
| Page-specific styles for guide.html | `guide.css` |
| Page-specific styles for paycalc-guide.html | `paycalc-guide.css` |
| FIP travel guide — country reference; jump links open the target section | `fip.html` + `fip.js` + `fip.css` |
| HTML sanitisation for Huddle viewer (self-hosted) | `purify.es.mjs` |

---

## File responsibilities in plain English

### `roster-data.js`
The single source of truth for all roster data.
- `APP_VERSION` — **always bump here first**
- `teamMembers` array — names, roles, roster types, start dates
- `getBaseShift(member, date)` — **always use this, never read roster.data directly**
- `getBankHolidays(year)` — algorithmic UK bank holiday list
- `getPaydaysAndCutoffs(year)`, `isPayday()`, `isCutoffDate()`, `paydayForCutoff(cutoffIso)` (the ISO payday paired with a cutoff, or null — single source for the calendar's payday-cell navigation)
- `parseSmartFloat(str)` — number parse that strips iOS smart hyphens/curly quotes first; single source for paycalc `numVal()` and the HPP rate read in `paycalc-hpp.js`
- `resolveMemberRoster(member, date)` — applies `rosterChanges` (latest `from` ≤ date wins); the basis for `getBaseShift`/`getWeekNumberForDate`. Never special-case rosterType at a call site — go through this.
- `getWeekNumberForDate(date, member)` · `getALEntitlement(member, year, overrides = [])` (the third param feeds the dispatcher BH-lieu count) · `projectAnnualLeaveOverage({ name, year, existingALDates, newALDates, entitlement })` (over-entitlement headline/detail, or null) · `getMembersForGrade(grade)` · `isSunday(dateStr)`
- `avatarInitials(name)` / `avatarHue(name)` — initials + stable per-name colour for the nav-panel footer badge (called directly in `nav-panel.js`; no fetch/storage)
- `escapeHtml(s)` / `formatISO(date)` / `isValidEmail(s)` — shared string/date/validation utilities used app-wide
- `isChilternWorkEmail(s)` — true only for a valid email on the `CONFIG.WORK_EMAIL_DOMAIN` (`chilternrailways.co.uk`) domain; the client-side mirror of the staffContact firestore.rules domain check (v14.97). Used by settings/operations/admin work-email save paths
- `CONFIG` (incl. `ADMIN_NAMES`, `LINKS_DESIGNERS`, `MIN_YEAR`/`MAX_YEAR`, payday anchors) and the re-exported raw roster arrays from `roster-cycle-data.js`. (`MILLER_ACTUALS` was moved OUT to `test-fixtures/miller-actuals.js` at v14.68 — privacy; see ARCHITECTURE_PLAN.md → MILLER_ACTUALS.)
- (This module exports ~50 symbols — the above are the cross-referenced, load-bearing ones; see the file for the full list.)
### `calendar-app.js`
Coordinator for `index.html`. Delegates state, swipe, rendering, override cache, and member selection to sub-modules.
- `changeMonth(delta)` — thin wrapper: calls `changeDisplay()` then `dismissSwipeHint()`
- `navigateToPaycalc(paydayStr)` — payday/cutoff cell click helper; checks session then navigates
- `renderCalendar()` — calls `buildCalendarContainer` + `ensureOverridesCached`; shows stale-member banner via `takeStaleMemberName()`
- `updateLegend()` — shows/hides Spare/RDW/AL/Sick/Night/Christmas/Easter legend items
- AL + day-detail lightboxes DELEGATED to `calendar-al-lightbox.js` (`initCalendarLightboxes()` — `loadALStats` lives there); month-jump picker, About lightbox wiring stay here
- Sync chip state machine + initial 3-month Firestore fetch DELEGATED to `calendar-initial-fetch.js` (`initInitialFetch({ isTeamViewMode, renderCalendar })`)
- Team Week View toggle, notification prompt, keyboard shortcuts, SW registration
- Calls `initSwipeHandler()`, `initHuddleViewer()`

### `calendar-state.js`
Display month/year state for `index.html` — extracted from `calendar-app.js` at v13.83.
- `getDisplayMonth()` / `getDisplayYear()` — current display position getters
- `setDisplayMonth(m)` / `setDisplayYear(y)` — direct setters (used by today-button and month-jump picker)
- `changeDisplay(delta)` — pure state change with boundary clamping; no DOM side-effects
- `persistViewedMonth()` — writes current position to `localStorage` after each navigation
- Runs `restoreViewedMonth()` IIFE at module load (skips future months)

### `calendar-swipe.js`
Pointer Events swipe carousel for `index.html` — extracted from `calendar-app.js` at v13.83.
- `initSwipeHandler({ isTeamViewMode, changeMonth, renderCalendar, updateLegend, navigateToPaycalc, openDayDetail })` — wires all pointer events on `#calendarDisplay`
- `isSwipeCooldown()` — returns true while a swipe animation is in flight; coordinator uses this to suppress button clicks
- Adjacent panels built in `pointerdown` (not `pointermove`) to avoid mid-swipe jank; setPointerCapture deferred to `pointermove` (iOS Safari fix)
- RAF-throttled transform writes; haptic feedback on threshold cross

### `calendar-al-lightbox.js`
AL lightbox and day-detail lightbox for `index.html` — extracted from `calendar-app.js` at v13.86.
- `initCalendarLightboxes()` — initialises both lightboxes; returns `{ openDayDetail, closeALLightbox }`
- AL lightbox fetches the current member's `annual_leave` overrides from Firestore on open (member-narrowed query since v18.23 — uses the deployed `(memberName, date)` composite index; the old date-only query downloaded every member's year and was the slow-load cause), computes taken/booked/remaining against `getALEntitlement()`; Dispatcher breakdown shown when applicable. Last-known-good stats memo per member+year (`myb_al_stats_*`, v18.23): painted instantly on open, refreshed by the fetch, kept silently on a failed refresh (team-view failure model) — getDocs is server-first, so without the memo every open waited a full round-trip on '…'
- Day-detail lightbox surfaces shift label, extras, and override note on touch devices (mirrors hover tooltip content set by `calendar-renderer.js` as `data-detail-*` attributes)
- Imports: `overlay.js`, `calendar-member.js`, `calendar-state.js`, `firebase-client.js`, `roster-data.js`

### `calendar-initial-fetch.js`
Initial 3-month Firestore fetch and sync-chip UI for `index.html` — extracted from `calendar-app.js` at v13.86.
- `initInitialFetch({ isTeamViewMode, renderCalendar, renderTeamView? })` — kicks off a 3-month date-range query (prev/cur/next), manages the sync chip state machine (hidden → "↻ Updating…" after 800ms → "⚠ Couldn't update" on 10s timeout), handles retry, and wires the `visibilitychange` guard for iOS background suspension. On success it renders whichever view is ACTIVE: `renderTeamView` (v18.21 — team view's cache-only repaint) when `isTeamViewMode()`, else `renderCalendar`
- Pre-marks all three months as fetched before awaiting to prevent competing per-month fetches from `ensureOverridesCached()` during the initial load
- Imports: `calendar-overrides.js`, `roster-data.js`

### `calendar-keyboard.js`
Keyboard navigation and hover tooltip for `index.html` — extracted from `calendar-app.js` at v13.86.
- `initCalendarTooltip()` — no-op on touch/pointer-coarse devices; creates a single floating `#calTooltip` div, repositions it on `mousemove`; reads `data-tooltip` set per cell by `buildCalendarContainer()`
- `initCalendarKeyboard({ navigateToPaycalc, openDayDetail })` — arrow-key cell navigation (roving tabindex), PageUp/Down month jump, Enter/Space cell activation (payday → paycalc, cutoff → paycalc, other → day-detail lightbox)
- Imports: `calendar-swipe.js` (isSwipeCooldown), `roster-data.js` (paydayForCutoff, formatISO)

### `calendar-overrides.js`
Firestore override cache for `index.html` — extracted from `calendar-app.js` at v13.82.
- `rosterOverridesCache` — exported `Map` keyed `"memberName|YYYY-MM-DD"`; imported by `calendar-renderer.js` for cell rendering and by the coordinator
- `fetchOverridesForRange(startStr, endStr)` — Firestore date-range query; populates cache, warns on duplicates, clears `shiftTypesMonthCache`
- `ensureOverridesCached(year, month, renderFn)` — no-op if already fetched; fires background fetch then calls `renderFn()` on success (coordinator provides callback with teamView + member-change guards)
- `getShiftTypesInMonth(member, year, month)` — memoised `Set<string>` of shift types appearing in a month; used by `updateLegend()`
- `clearShiftTypesCache()` — invalidate that memo; callers writing straight into `rosterOverridesCache` (Team Week View's fetch) must call it or the month legend serves a stale type set (v15.22)
- `monthKey(year, month)` — `"YYYY-MM"` key string for the `fetchedMonths` Set
- `_initialFetchInProgress` — exported live binding; coordinator reads it to skip competing fetches during the initial 3-month load
- `setInitialFetchInProgress(v)`, `addFetchedMonths(keys)`, `clearFetchedMonth(key)` — setters called by `calendar-initial-fetch.js` (the initial 3-month fetch module)

### `calendar-member.js`
Team member selection for `index.html` — extracted from `calendar-app.js` at v13.82.
- `getSelectedMemberIndex()` — resolves saved name → index; sets `_staleMemberName` flag if name no longer in roster; auto-selects from session if no saved preference
- `takeStaleMemberName()` — consume-and-clear accessor for the stale-name flag; called by `renderCalendar()` to show a one-time banner
- `getCurrentMember()` — returns the resolved `teamMembers` entry for the selected index
- `saveSelectedMember(index)` — persists selection by name to localStorage via `lsSet`; also records an in-memory `_selectedIndexFallback` so a pick survives an iOS-private-mode `lsSet` no-op (v15.14)
- `isFirstRun()` — true only for a brand-new visitor (no saved member AND no session AND no in-memory pick); distinct from the stale-member case. `calendar-app.js` shows a "choose your name" prompt instead of the default member's roster, and `populateTeamMemberDropdown()` leads with a `— Choose your name —` placeholder (Onboarding H1, v15.11). The in-memory backstop (v15.14) keeps the prompt cleared and the picked member resolved even when the localStorage write silently fails (private mode), avoiding a first-run dead-end; `_resetSelectionFallbackForTest()` clears it for unit tests
- `getDefaultMemberIndex()` — resolves `CONFIG.DEFAULT_MEMBER_NAME` to an index at runtime
- `populateTeamMemberDropdown()` — builds flat or optgroup `<select>` depending on number of distinct roles
- `validateTeamMembers()` — checks team member object shape; returns error string array

### `calendar-renderer.js`
Calendar cell and grid building for `index.html` — extracted from `calendar-app.js` at v13.82.
- `buildCalendarContainer(month, year, opts)` — builds and returns a fully-populated `calendar-container` div. `opts = { navigateToPaycalc?, onDayDetail? }` callbacks avoid importing the coordinator. Reads `rosterOverridesCache` from `calendar-overrides.js` and calls `getCurrentMember()` from `calendar-member.js`.
- `createCalendarHeader(firstWeekNum, lastWeekNum, weekPrefix, month, year)` — pure; returns HTML string for the month/week header
- `createDayCell(date, shift, permanentShift, isWorkedDay, rdwTime)` — pure; returns HTML string for a single day cell's interior
- `getSwipeDirection(startX, startY, endX, endY, elapsed)` — pure math; returns `'left'`, `'right'`, or `null`

### `calendar-huddle-viewer.js`
Huddle viewer overlay — extracted from `calendar-app.js` at v11.40. Only export is `initHuddleViewer()` (the old `applyHuddleButtonState()` export was removed at v12.57 — the `#huddleBtn` it updated no longer exists; the viewer is opened solely via the `#huddle` hash).
- `initHuddleViewer()` — sets up the viewer overlay, subscribes to Firestore via `subscribeToLatestHuddle`, wires the `#huddle` hash handler (used by both the nav-panel "Daily Huddle" link and notification taps)
- `sanitiseHtml(html)` — internal; DOMPurify sanitisation for DOCX huddles
- `_triggerAutoOpen(huddle)` — **two content types, do not unify:** HTML huddles render inline; PDF/DOCX huddles render an in-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`) because a `#huddle`-hash open carries no user activation — a direct `window.open`/`location.href` would be pop-up-blocked or knock the PWA out of standalone. Full rationale: OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".

### `calendar-doc-viewer.js`
In-app viewer for the Weekly Retail Circular and Marylebone Newsletter, opened from a `#circular`/`#newsletter` notification deep link (the `onCircularCreated`/`onNewsletterCreated` Cloud Function triggers fan out the push). Only export is `initDocViewer()`.
- The viewer mirrors the Huddle's PDF path: a centred `createLightbox` card showing the feature title + an "Open" button (a real gesture → `window.open`, popup-safe; `isSafeStorageUrl`-guarded). A PDF opens by its own URL; a Word (.docx) document opens via `officeViewerUrl` (Office Online viewer) so it renders with images instead of downloading (v16.45). Empty/error states show a short message.
- One-shot fetch (`getLatestCircular`/`getLatestNewsletter`) on open — no persistent subscription (unlike the Huddle, which needs live state for its button). Reached **only from a `#circular`/`#newsletter` notification tap** (no in-page user gesture → must route through the in-app Open button, like the Huddle's PDF path). The ☰ nav-drawer links open **directly** in a new tab (one tap, `nav-panel.js`: a PDF by its own URL, a Word doc via the Office Online viewer) — a notification can't, which is the whole reason this viewer exists (v14.57).
- A `_openSeq` fetch token (v17.21) discards a superseded fetch so two rapid notification taps can't render a doc/title mismatch.

### `calendar-team-view.js`
Team Week View for `index.html` — the grade-wide week grid toggled from the calendar header.
- Only export is `initTeamView({...deps})` → the coordinator passes the override cache, member/render callbacks, and DOM hooks; returns `{ toggleTeamView, isTeamViewMode, restoreTeamView, jumpToCurrentWeek, refreshFromCache }` for `calendar-app.js` to wire up. `refreshFromCache` (v18.21) repaints the grid from the already-populated shared cache with NO re-fetch — called by the initial 3-month fetch's success path via `initInitialFetch`'s `renderTeamView` dep, closing the early-team-view stand-down (the initial fetch rendered nothing in team view, then the week fetch found the cache already matching its snapshot and skipped its own re-render — a permanently base-roster grid, deterministic on boot-into-team-view because IndexedDB persistence makes the 3-month read win). Everything else (grade state `currentTeamGrade`, week navigation clamped to `CONFIG.MIN_YEAR`/`MAX_YEAR`, `fetchTeamWeekOverrides` with its week-start fetch token, `getTeamCellDisplay` via the shared `resolveEffectiveShift`) is internal.
- Failure model: a week fetch reconciles only on a successful snapshot (via `reconcileRangeIntoCache`), stale results are discarded by the fetch token, and a failed refresh silently keeps the last-good grid — deliberately NO freshness indicator (CLAUDE.md → Team Week View, "minimal-noise app").

### `admin-app.js`
Login, session management, shared DOM handles, and the glue that wires all admin modules together.
- Login flow, Firebase Auth sign-in/out, session state
- `alMember`, `sickMember`, `syncMemberDisplay`, `syncSickMemberDisplay` — declared here (module scope) because the `fieldMember` change handler references them before `admin-al.js` / `admin-sick.js` init runs
- `fieldMember` change handler, `fieldDate` change handler — keep AL/sick/overrides in sync
- AL over-entitlement confirm bar (`alConfirmBar`) — calls `triggerConfirmedALSave()` from `admin-al.js` for the AL booking path
- Booked-period helpers (`_renderBookedPeriods`, `deletePeriodOverrides`, `updateALBookedBox`, `updateSickBookedBox`)
- Calls `initALSection()`, `initSickSection()`, `initOverrides()` to initialise all sections
- Does **not** contain AL save logic, sick save logic, week grid, override list, bulk bar, roster review pipeline, Huddle upload, auth setup, Notifications card, or Cultural Calendar — those are in sub-modules. Huddle upload, roster upload, and staff auth setup moved to `operations-app.js` at v10.99. Notifications moved to `settings-app.js` at v11.06.

### `settings-app.js`
Coordinator for `settings.html` (all logged-in staff, v11.06).
- **Exported `init()` wrap (Phase 4a.2, v17.09):** the coordinator body is `export function init()`, invoked by `settings-boot.js` (the page loads the boot file — CSP `script-src 'self'` blocks an inline call). Importing this module no longer auto-runs it, so a test can drive `init()` with mocked deps. The last of the five write coordinators to get the seam.
- Shared session: uses `AUTH_KEY = 'myb_admin_session'` (same key as `admin-app.js`) — a user signed in on admin.html arrives at settings.html without re-authenticating
- Session check at module top: if authenticated → `ensureFirebaseSession(name)` in background + `initApp()`; else → `initLoginOverlay()`
- `initLoginOverlay()` — same grade/name/password flow as admin; on success calls `saveSession()` + `location.reload()`
- `initApp()` — calls `initNavPanel`, collapsible card wiring, `initHuddleNotifications()`, work email card init, `initPasswordCard()`, tips/icon lightboxes, SW registration
- `initPasswordCard()` — the **Password** card (v18.63, PASSWORD_PLAN.md). Renders a status chip + nudge from `getPasswordStatus(member)` (surname-default vs self-set), and on save validates the new password (≥8 chars, `new === confirm`, and rejects a value that normalises to the member's own surname so they can't "set" the default), re-authenticates via `reauthenticateWithPassword(member, current)`, calls `setOwnPassword(member, next)`, then refreshes the chip/nudge. Owner-only; never touches other members' docs.

### `overlay.js`
Shared overlay helpers — singleton module, imported by every page that shows a modal overlay (v11.40).
- `lockBodyScroll()` / `unlockBodyScroll()` — freezes body scroll position when an overlay opens; restores on close. Handles iOS Safari bounce-scroll.

**Canonical `.lb-overlay` lightbox lifecycle (standardised v11.50, factored into `createLightbox` v12.50)** — when adding any lightbox, call `createLightbox(...)`; do NOT hand-write the open/close shape in a page module. Exceptions: `#navComingSoonLightbox` (owned by nav-panel.js, shares the drawer's history entry) and `#huddleViewer` (full-bleed panel, not a lightbox). Full rationale in CLAUDE.md → "Canonical lightbox lifecycle".
- `createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose })` — returns `{ open, close }`. Implements focus save/restore, `.visible` → rAF `.open` + focus, scroll lock, Android Back, Escape, and the Tab focus trap. Backdrop and closeBtn click-to-close are wired automatically (v12.50).
- `_pushOverlayState(closeHandler)` / `_clearOverlayHistory()` — Android back-button support, backed by a **LIFO stack** (v15.69): each open pushes its own `{ mybOverlay: true }` entry and stacks `closeHandler`, so NESTED overlays (a lightbox opened over Team Week View) each get an entry and Back closes only the topmost — the lower one keeps its entry and closes on the next Back. Before v15.69 it was a single slot: the second overlay clobbered the first's registration, so after closing the top one the lower overlay was left open with no entry and Back then left the page. `_pushOverlayState` is idempotent per handler (a double-open won't stack a duplicate). Button close pops the top entry via `history.back()`; the echoed `popstate` is absorbed (`_suppressPops`), and a `_clearOverlayHistory()` call from inside a Back-invoked handler (team-view toggle, lightbox dismiss) is a no-op (`_handlingPop`) so it can't cascade-close the lower overlay. Single module-level `popstate` listener. Tested by `overlay-history.test.mjs`.
- `trapFocus(container, e)` — call from a lightbox keydown handler; traps Tab/Shift+Tab within the container's focusable elements. No-op if key is not Tab. (createLightbox calls this internally.)
- `dismissOverlay(el, { onKey, focusReturn, afterClose, backHandler })` — the shared close routine `createLightbox` uses: removes `.open`, restores focus synchronously, then removes `.visible` + `unlockBodyScroll()` on `transitionend` with a mandatory 500ms `setTimeout` fallback (iOS suppresses `transitionend` on a backgrounded tab). Exported for the rare overlay that isn't built via `createLightbox`.
- `registerPopInterceptor(fn)` / `suppressNextPop()` — popstate plumbing for an overlay with its OWN history handling (currently only `nav-panel.js`, the drawer): an interceptor gets first refusal on a Back pop; `suppressNextPop()` absorbs the echoed popstate from a programmatic `history.back()` so it can't reach the overlay stack.
- `initCardCollapse(headerId, bodyId, chevronId, onToggle)` — wires a collapsible card header. Safe to call early; no-op if elements not found. **v17.50:** the focusable toggle is the **chevron/arrow** (`role="button"` + `aria-expanded`/`aria-controls` + an `aria-label` from the heading), NOT the whole header — a header can contain a Tips/Help `<button>`, and making the header the toggle nested one interactive control in another (WCAG `nested-interactive`). The header stays non-interactive with a mouse-only click that ignores nested controls; the no-chevron case falls back to header-as-toggle. Fixed the axe gate's `nested-interactive` findings.
- `confirmDialog({ message, title?, confirmLabel?, cancelLabel?, danger? })` → `Promise<boolean>` and `promptDialog({ message, title?, defaultValue?, placeholder?, maxLength?, confirmLabel?, cancelLabel? })` → `Promise<string|null>` (v17.60) — in-app replacements for the browser-native `confirm()`/`prompt()`, so those reads carry the app's design language instead of raw OS chrome. Build a `.dialog-overlay` DOM node on the fly and run it through `createLightbox` (inheriting focus trap, Escape, Android Back, scroll lock, transitionend fallback); resolve on the user's choice and remove the node on close. **Async by nature — cannot stand in for a synchronous `confirm()` inside a capture-phase navigation guard (which must `preventDefault()` inline) or a `beforeunload` handler**; for a nav guard, intercept-always then navigate when the Promise resolves true (see `links-app.js`), and keep `beforeunload` native. Consumed by `links-app.js` (which replaced all 16 native `confirm()`/`prompt()` calls) and `settings-app.js` (the work-email remove confirm). Styled by `.dialog-*` in `shared.css`.
- Imported by: `calendar-app.js`, `admin-app.js`, `paycalc-app.js`, `operations-app.js`, `settings-app.js`, `links-app.js`, `nav-panel.js`

### `about-lightbox.js`
Shared About panel for `#iconLightbox` on all six app pages (v12.50).
- `initAboutLightbox({ appLabel, bugLinkId, getUserName, onOpen, printFn })` — returns `{ open, close }` or null if the page has no `#iconLightbox`. Owns the version line, the SW "up to date / update available" status, the pre-filled bug-report mailto, and the optional `#lightboxPrintBtn` (close → wait for exit transition → print; `printFn` overrides `window.print()` — the calendar passes a landscape variant for team view).
- Each page assigns the returned `open` to its module-level `openAboutLightbox` so the nav-drawer logo can open it. Header-logo wiring (back-to-calendar on sub-pages, About on the calendar) stays per-page.

### `tips-lightbox.js`
Shared per-card Tips panel for `#tipsLightbox` (v12.50).
- `initTipsLightbox(CARD_TIPS, { getIsAdmin })` — wires every `.btn-card-tips` button, renders sections/items (filtering `adminOnly`/`staffOnly` entries via `getIsAdmin`, read at open time), updates the dialog `aria-label` to the card title, and runs the canonical lifecycle.
- Pages own only their `CARD_TIPS` content data. Imported by `admin-app.js`, `operations-app.js`, `settings-app.js`, `links-app.js`.

### `login-overlay.js`
Shared **in-place** sign-in overlay for every protected page (v14.45). Replaces the duplicated login code in admin/settings and the redirect-to-admin pattern on operations/links/paycalc — every page now signs in on the spot, none redirect elsewhere to authenticate.
- `initLoginOverlay({ pageLabel, onSuccess })` — call only when NOT signed in. Injects the overlay markup (like `nav-panel.js`), populates the grade dropdown (CEA/CES/Dispatcher/Management) and the name dropdown via `getMembersForGrade`, restores the last-used grade (`myb_login_grade`), shows a disabled "Signing in…" button, then delegates the auth decision to `runNamedSignIn`. **Chosen-password (v18.63):** the overlay no longer gates on the surname locally — it passes the raw typed password straight to `ensureNamedSession(name, { password })` (a member may have set their own), so the server is the single arbiter; the 3-strike 30s client rate-limit now trips only on a genuine `kind === 'credential'` rejection (a timeout/transient/storage failure doesn't burn a strike), and a success resets the counter. On `{ ok: true }` it shows a brief "Signed in — opening {pageLabel}…" confirmation then calls `onSuccess(name)` (typically `() => location.reload()`); on `{ ok: false }` it restores the button and shows the returned error.
- **Login latency/UX (v14.79–80):** calls `primeAuth()` (session.js) on mount to pre-warm Firebase Auth while the user types; while a sign-in is genuinely in flight it disables the "← Back to roster" link (`_signingIn` flag → `preventDefault` + `.login-back--busy`, cleared in `finally`) so a mid-submit tap can't re-open the half-signed-in escape route the v14.75 fix closed; and a `#loginStatus` line escalates ("Checking your sign-in…" → at 1.5s "Still checking your secure session…" → at 4s "Still working — … app update or … weak signal.") so a multi-second wait reads as progress, not a freeze. Timers cleared on settle.
- `runNamedSignIn(deps)` — the **DOM-free, exported, tested** sign-in core (`login-overlay.test.mjs`). Time-boxes `ensureNamedSession` (8s `withTimeout`) and commits the local session (`saveSession`) **ONLY after auth genuinely resolves** — on timeout/throw, or enforce-on + not-named, it writes NO session, `clearSession()`s, and returns an error message. This is the v14.75 fix for the "half signed-in"/login-freeze class (saving the session before auth completed let the app honour a session the overlay never finished). **Returns `{ ok, error?, kind? }` (v18.63)** where `kind ∈ 'timeout'|'ratelimit'|'transient'|'credential'|'storage'` — the caller uses `kind` to decide whether to burn a rate-limit strike (only `'credential'`) and which message to show; the credential message points a member who's forgotten a self-set password at the admin reset. See LOGIN_INCIDENT.md.
- Per-page ACCESS control (admin-only Operations, designer-only Links) stays in each coordinator, applied after sign-in — the overlay itself lists every grade.
- `dismissLoginOverlay()` — **in-place sign-in (Phase 9, v14.81–83).** Removes the `#loginOverlay` element + `unlockBodyScroll()`; no-op when no overlay is mounted (so it is safe to call unconditionally on a coordinator's authorised path). `CONFIG.INPLACE_LOGIN` is a **per-page object** (`{ operations, links, paycalc, admin, settings }`, all default false) — each coordinator reads ONLY its own key, so the rollout has a small blast radius (enable one page at a time). When a page's key is **on**, it initialises in place instead of `reload()`: the init()-wrapped ones (operations/links/paycalc) pass `onSuccess: () => init()` (the authorised body never ran on the login pass, so re-entering runs it exactly once); the branch-style ones (admin/settings) extract their signed-in body into an `initAuthorised()` that refreshes the now-`let` identity vars from the just-saved session, calls `dismissLoginOverlay()`, runs the body, and wires the nav (deferred past sign-in so it renders once with the signed-in identity — no `refreshNavIdentity` needed). All skip `resolveSession(false)` on the in-place login pass so the one-shot `sessionReady` isn't poisoned, and fall back to `reload()` if init throws. Key **off** (default) = today's reload, unchanged. Not the B1 risk class — it only changes post-sign-in rendering, never whether auth succeeds. See ARCHITECTURE_PLAN.md → "Phase 9".
- Imported by `admin-app.js`, `settings-app.js`, `operations-app.js`, `links-app.js`, `paycalc-app.js`.

### `sw-register.js`
Shared service worker registration + update lifecycle (v12.28). All six app pages import this instead of duplicating the register/activate/reload pattern.
- `registerServiceWorker({ beforeReload, bfcache })` — registers `./service-worker.js`, activates any waiting worker immediately, sets up an hourly update-check via `visibilitychange`. On `controllerchange`, calls `beforeReload()` if provided, otherwise `window.location.reload()`. `bfcache: true` adds `pagehide`/`pageshow` handlers (used by `calendar-app.js` only).
- **First-install guard (v16.09):** `hadController` is captured before registering; the controllerchange fired by the first install's `clients.claim()` (uncontrolled → controlled) is swallowed — the page was just loaded from the network so it already IS the newest version. Pre-v16.09 this reloaded every brand-new device (the old `registration.waiting && controller` guard only suppressed the redundant SKIP_WAITING *message*, not the reload — the SW self-activates via install-time `skipWaiting()` regardless).
- **No `{once:true}` (v16.09):** the controllerchange listener stays armed so a `beforeReload` that declines (links' `confirm()` → Cancel) still receives the NEXT update's event; the default path double-reload is guarded by a `reloadFired` flag instead. Tested by `sw-register.test.mjs` (test:hygiene).
- Per-page variants: `calendar-app.js` — 500ms reload delay + bfcache; `admin-app.js` — defers reload if `hasUnsavedChanges()`; `links-app.js` — shows `confirm()` if the design is dirty; others — plain reload.

### `splash-watchdog.js`
CLASSIC (non-module) launch-recovery script for index.html only (v16.18). Loaded via `<script defer src="./splash-watchdog.js">` — deliberately NOT `type="module"`, so it is independent of the ES-module graph and runs even when that graph fails to load. The launch splash (`#splash`) is otherwise removed ONLY by calendar-app.js (on first render or in its own catch), so a failed module load (broken gstatic SDK import, corrupt/mixed/stale SW cache, any broken module) would leave the splash up forever with no recovery.
- After `TIMEOUT_MS` (20s) with `#splash` still in the DOM: (1) one **guarded** auto-reload — `sessionStorage['myb_splash_reloaded']` ensures at most one per launch (no loop); skipped if sessionStorage is unavailable; picks up a freshly-deployed SW and re-runs the module load. (2) On the next stuck detection (flag already set): a self-contained recovery panel (inline styles, textContent only) with **Reload** and **Reset the app** (unregister every SW + delete every cache, then reload — fixes a stale/broken cache without the user finding OS storage settings).
- Runtime-only: the whole IIFE is guarded on `typeof document !== 'undefined'`, so importing it in tests (module-parse) is a no-op and schedules no timer.
- No imports/exports. Registered in service-worker.js NETWORK_FIRST_FILES + CORE_ASSETS like any app asset.

### `session.js`
Shared auth/session module — canonical source for session logic (v11.40).
- Constants: `AUTH_KEY`, `SESSION_MS` (30 days absolute), `IDLE_MS` (7 days inactivity), `SESSION_VER`
- `getSurname(name)` — derives Firebase Auth password from display name
- `getSession()` / `saveSession(name)` / `clearSession()` — session object accessors. **Passive expiry** (the absolute-expiry / version-stale / idle branches of `getSession()`) only clears the localStorage key — it does **NOT** sign Firebase out, because `getSession()` runs synchronously at module eval on the calendar and an async signout would race `calendarAuthReady`'s `currentUser` check (v14.34). **`clearSession()`** is the explicit user-logout path and DOES call `firebaseSignOut(auth)`, so local and Firebase state align on a deliberate logout.
- `ensureFirebaseSession(name, _gen?, password?)` — re-establishes Firebase Auth on every page load; waits for `onAuthStateChanged`, signs in if no existing session, self-heals a missing account via `createUserWithEmailAndPassword`, else falls back to an anonymous session. Returns `Promise<boolean>` (true if any session is active). Called only by the write pages — the calendar uses its own anonymous `calendarAuthReady` bootstrap. **Chosen-password sign-in (v18.63, PASSWORD_PLAN.md):** the optional `password` is the value the user actually typed; sign-in tries `credentialCandidatesFor(name, password)` in order (typed value first, surname default as a fallback only when the typed value normalises to the surname), so a self-set password and the legacy surname both work. A pure **credential rejection** (`auth/wrong-password`/`invalid-credential`/`invalid-login-credentials`/`user-not-found`, via `_isCredentialRejection`) never falls back to an anonymous session **regardless of the flag** (§3.3 — a wrong password must fail closed, not silently downgrade); only a NON-credential failure (network etc.) is eligible for the flag-gated anonymous fallback. When no `password` is passed the surname default is used (page-load re-establishment). **B1.1 (v14.40; now ENABLED, v14.98):** the self-heal create and the anonymous fallback are gated behind `CONFIG.ENFORCE_NAMED_SESSION`, which is now **on**. With it on (the current state) neither runs, and a failed named sign-in returns `false`/`'none'` so the page can prompt a re-login. Flipping the flag back to **false** restores the old self-heal/anonymous-fallback behaviour — the one-line kill-switch. See SECURITY_RELEASE_PLAN.md → "Appendix: B1 detailed scope".
- `primeAuth()` — **login latency pre-warm (v14.80).** Called once when the login overlay mounts. Kicks off `authReady` + the first `onAuthStateChanged` restore in the background and caches that promise; `ensureFirebaseSession` consumes it **once** instead of starting the restore itself, so the IndexedDB restore overlaps the user's typing and the sign-in click pays only for the network sign-in. Best-effort, idempotent, side-effect-free — on failure or when not primed (e.g. tests) `ensureFirebaseSession` does a fresh restore, so there is **no** behaviour or security change, only latency overlap.
- `getFirebaseIdentity()` → `'named' | 'anonymous' | 'none'` · `firebaseSessionIsNamed()` → boolean · `getFirebaseAuthError()` → error code. **B0** (SECURITY_RELEASE_PLAN.md): expose whether `ensureFirebaseSession` established the member's own named account or only the anonymous fallback. `firebaseSessionIsNamed()` is the signal per-member write isolation (B2) will depend on — the anonymous fallback satisfies `request.auth != null` today but carries no `name` claim. **Observability only — no behaviour change in B0.** (v14.39)
- `ensureNamedSession(name, opts?)` → `Promise<boolean>` · `isTransientAuthError(code)` → boolean. **B1.2** (v14.41; now ENABLED, v14.98): the write pages call `ensureNamedSession` instead of `ensureFirebaseSession`. `opts` accepts `{ retries?, delayMs?, password? }` — the `password` (v18.63) is threaded to both `ensureFirebaseSession` attempts so the typed-password candidate ladder is used. With `CONFIG.ENFORCE_NAMED_SESSION` **on** (the current state), a failed named sign-in is retried a couple of times only for transient (connectivity) errors, then returns whether the member's own named session is active — admin/settings re-show the login overlay, operations/links clear + redirect to admin, paycalc soft-logs (never blocks). Flipping the flag **off** makes it return `ensureFirebaseSession`'s result unchanged (anonymous fallback counts) — identical-to-legacy behaviour, the kill-switch. See SECURITY_RELEASE_PLAN.md → "Appendix: B1 detailed scope".
- `refreshClaimsIfStale(epoch)` — the B3 CLAIM_EPOCH sweep: force-refreshes the Firebase ID token once per device when `CONFIG.CLAIM_EPOCH` exceeds the device's stored `myb_claim_epoch`, so newly-set custom claims reach every active session. Covered by `session.test.mjs`.
- `reconcileExpiredIdentity()` → `Promise<void>` (v17.00, Finding #9) — the coordinated post-`authReady` teardown for a Firebase identity that OUTLIVED its local session: `getSession()` clears only localStorage on passive expiry, so a lingering NAMED/admin/manager/designer identity keeps real Firestore write privileges. If the restored user is NAMED but `getSession()` is null, it signs out; anonymous identities and any valid local session are left alone. Login-safe: snapshots `_authGen` and stands down if a login/logout started meanwhile. **Resolves the restored user first** (`auth.currentUser || restoreFirstAuthUser()`, v17.19) — `authReady` only sets persistence, so reading `currentUser` alone would MISS a cold restore. Called by the calendar's `calendarAuthReady` (before the anon bootstrap) AND, as of v17.19 (item 7), by **all five protected coordinators** (admin/settings/operations/links/paycalc) at init — so a direct deep-link to a protected page tears the identity down immediately, not only on the next calendar open/login. Covered by `session.test.mjs` (incl. cold-restoration tests).
- `restoreFirstAuthUser()` → `Promise<any>` (exported v17.22) — resolves the first `onAuthStateChanged` emission (the IndexedDB session restore) once. Shared by `ensureFirebaseSession`, `reconcileExpiredIdentity`, `primeAuth`, and `admin-auth.js` (which previously hand-rolled its own copy — a divergence that once let a cold-restore fix miss it). Callers wanting the fast path use `auth.currentUser || await restoreFirstAuthUser()`.
- `sessionReady` — module-level `Promise<boolean>` that resolves once the page coordinator calls `resolveSession()`. Feature modules `await sessionReady` instead of reading `window._mybSession`. (v13.74)
- `resolveSession(result)` — fulfils `sessionReady`; pass the return value of `ensureFirebaseSession()` (a `Promise<boolean>`) on the auth path, or `false` on the non-auth path. Call exactly once per page-load from the page coordinator. (v13.74)
- `window._mybAuthError` — set on `ensureFirebaseSession()` failure; surfaced by `admin-auth.js` for diagnostics. Stores the primary Firebase error code, or `"${primaryCode} + anon:${anonCode}"` if the anonymous-sign-in fallback also failed.
- Imported by: `admin-app.js`, `settings-app.js`, `operations-app.js`, `paycalc-app.js`, `links-app.js` (v12.49 / v13.74)

### `auth-state-core.js`
The PURE identity state machine — `ARCHITECTURE_PLAN.md` Track 1, **Phase 1** (v14.58). No DOM, no Firebase, no localStorage, no redirects: only `reduceAuthState(state, event) → state` + `INITIAL_STATE` + `AUTH_STATUSES`. **Now live** (since the v14.98 B1 re-enable) — consumed via the store (`auth-state.js`) → the 5 write coordinators; `session.js` is the adapter that translates real Firebase/localStorage signals into events (it FEEDS the store, still owning the Firebase lifecycle). This module owns ONLY the status-determination logic (formerly scattered across `ensureFirebaseSession`'s `_fbIdentity` writes).
- States (identity facts, never page-auth outcomes): `initialising` / `resolving` / `named` / `anonymous` / `signedOut` / `degraded` / `error`. `needsLogin`/`forbidden` are policy outcomes (Phase 3), deliberately not states.
- Events: `RESOLVE_START{member}` (member null = anonymous bootstrap), `NAMED{member}`, `ANONYMOUS`, `NONE{error}`→signedOut, `TRANSIENT{error}`→degraded (member preserved), `RETRY` (degraded→resolving only; no-op otherwise), `FATAL{error}`→error, `SIGN_OUT`→signedOut. Unknown event → state unchanged. Every result is a new frozen object; never mutates prev.
- Maps 1:1 onto the Phase-0 characterisation outcomes (`session.test.mjs`). Tested by `auth-state-core.test.mjs` (24 tests).

### `auth-state.js`
The auth STORE — `ARCHITECTURE_PLAN.md` Track 1, **Phase 2** (v14.59). Holds the single identity state (reduced by `auth-state-core.js`) and exposes `getAuthSnapshot()`, `subscribeAuth(listener)` (immediate call + on-change; listener errors isolated), `dispatchAuth(event)`, and `_resetAuthStateForTest()` (test-only). Imports **only** `auth-state-core.js` — NOT `session.js` or `firebase-client.js` — so the graph stays acyclic (`session.js → auth-state.js → auth-state-core.js`).
- **The shell-adapter role is fulfilled by the existing `session.js`**, which FEEDS this store (reusing the proven auth path rather than re-wrapping Firebase). `ensureNamedSession` dispatches `RESOLVE_START` → (retry: `TRANSIENT`/`RETRY`) → a terminal `NAMED`/`ANONYMOUS`/`NONE`/`FATAL` from the B0 signals; `clearSession` dispatches `SIGN_OUT`. Every feed is wrapped (`_feedAuth`) so a store error can never break auth.
- **Phase 2 store + Phase 3 policy are NOW CONSUMED** (since B1 re-enable, v14.98): the 5 write coordinators read the store at init via `getAuthSnapshot()` + `requirePage()` (active when `ENFORCE_NAMED_SESSION` is on). `sessionReady` is still untouched and session.js still owns the Firebase lifecycle; the store + `sessionReady` are both driven by the same `ensureNamedSession` resolution (so they cannot diverge). The full single-owner shell (live subscriptions, `sessionReady` re-routed onto the store) is still future. Bridge tested in `session.test.mjs` ("auth-store bridge (Phase 2)"); store tested in `auth-state.test.mjs`.

### `auth-policy.js`
The page-AUTHORISATION layer — `ARCHITECTURE_PLAN.md` Track 1, **Phase 3** (v14.60). Authentication ("who are you?") is the store; this answers the separate "is this identity allowed on THIS page?". **CLIENT UX only — Firestore Rules + Functions claim checks are the real boundary** (the role check here, name ∈ CONFIG.ADMIN_NAMES/MANAGER_NAMES/LINKS_DESIGNERS, is an optimisation, never enforcement).
- `PAGE_POLICIES` — declarative per-page map, grounded in the coordinators' actual gates: operations = admin-only (managers redirected), links = designer-only, admin/settings = any named user (the admin/manager split gates ACTIONS not page access), paycalc = soft (never blocked), calendar = public/anonymous, guides = open. `DECISIONS` — the frozen list of the five valid decision strings.
- `requirePageAuth(snapshot, policy, roles)` → `{ decision, reason }` — PURE. Decisions: `allow` / `soft-allow` (paycalc local-first) / `login` (terminal no-named: signedOut/anonymous/error) / `forbidden` (named but wrong role) / `pending` (initialising/resolving/degraded — degraded grants no authority but is retryable, so "pending" not "login"). `rolesFor(member)` derives role flags from CONFIG; `requirePage(snapshot, page)` is the coordinator convenience (fails CLOSED on an unknown page). The read-vs-write distinction is an ACTION-level concern for a later phase (the policy keys can grow `page→page.action` without touching the reducer). NOW CONSUMED by the 5 write coordinators (the `requirePage` access gate, active when `ENFORCE_NAMED_SESSION` is on). 42 tests in `auth-policy.test.mjs`.

### `operations-app.js`
Coordinator for `operations.html` (admin-only, v10.99).
- **Exported `init()` wrap (ARCHITECTURE_PLAN.md Phase 4a.2, v14.65):** the whole coordinator body is `export function init()`, called by `operations-boot.js` (the page loads the boot file, not this module directly — CSP `script-src 'self'` blocks an inline call). The former top-level `throw`s on the login/forbidden gate became early `return`s. Importing this module no longer auto-runs it, so a test can drive `init()` with mocked deps. First coordinator to get the wrap.
- **Page-access via the policy layer (ARCHITECTURE_PLAN.md Phase 4a, v14.61):** the access gate routes through `requirePage({ status: currentUser ? 'named' : 'signedOut', member }, 'operations')` from `auth-policy.js` — `login` → overlay, `forbidden` → redirect to `admin.html`, `allow` → proceed — and the B1 enforcement decides via `requirePage(getAuthSnapshot(), 'operations') === 'login'`. **First coordinator to consume the new store + policy.** Behaviour-preserving (the local-derived snapshot keeps today's optimistic render; the existing e2e passes unchanged). Optimistic admin reads (4b, v14.62) wrap the admin-gated read cards in `withClaimRetry()` (force token refresh + retry once on stale-claim `permission-denied`; the shared firebase-client helper — was the byte-identical local `adminReadWithRetry`, consolidated v17.08).
- Session guard (legacy description): reads the shared `myb_admin_session` localStorage key via `getSession()` from `session.js`; the redirect/login decision is the `requirePage` outcome above
- Calls `ensureFirebaseSession(name)` from `session.js` to re-establish Firebase Auth on page load
- Calls `initHuddleUpload()`, `initRosterUpload()`, `initAuthSetup()`, `initNavPanel({ isAdmin: true })`, and the three reporting cards `initErrorLog()`/`initUsageCard()`/`initPageSpeedCard()` (imported from `operations-reports.js` since v17.46 — was inline)
- **Account status card** `initAccountStatus()` (v18.63; **merged with the former Work Email Progress card v18.65**) — the single per-member account-admin table. Joins `getAllStaffContacts` + `getAllPasswordStatus` (both admin-only reads, under `withClaimRetry`), a grade filter (All / CEA / CES / Dispatcher / Management), a two-count summary ("N/M have a work email · N/M set their own password"), and one stacked block per member: **work email** (address + inline Set/Edit/Remove via `saveStaffContact`/`deleteStaffContact`) and **password** posture (🔑 Own password / Surname default). A **Reset** button shows ONLY for a migrated member (a surname-default account has nothing to reset to); it opens a `confirmDialog` then calls `resetMemberPassword(name, { revoke: true })` (admin break-glass → surname default + refresh-token revoke), then re-reads status and re-renders (Reset then drops off). "Migrated" = `passwordSetAt` present AND `≥ resetAt`. Fails to `_cardLoadError` with a retry. Reuses the `email-*` form/filter CSS + the `acct-*` row CSS.
- Owns icon lightbox, tips lightbox, and collapsible card wiring for the operations cards

### `operations-reports.js`
The three read-only reporting cards on `operations.html` — **Error Log**, **Usage**, **App Speed** — extracted from `operations-app.js` at v17.46 (that coordinator was ~1300 lines; these ~540 lines were a clean, self-contained slice).
- `initErrorLog()` — clientErrors card: resolve-all toolbar, per-row Resolve + Copy-for-Claude, truncation banner, in-place refresh (all via `getClientErrors`/`resolveClientError` under `withClaimRetry`).
- `initUsageCard()` — page-popularity + active-account bars (`getUsageStats`, month/rolling window).
- `initPageSpeedCard()` — Project-0 latency journeys (`getPerfStats`, `SPEED_GROUPS`/`perfVerdict` from `perf-stats.js`).
- `_cardLoadError(content, message, retryFn)` — the shared "card failed to load + ↻ Try again" renderer; **exported back** to `operations-app.js` (its Account-status card uses it). One-directional dependency (`operations-app.js` → `operations-reports.js`), no import cycle.
- Each function awaits `sessionReady`, reads Firestore, and renders into its card by id — **no coordinator state**, so the extraction needed no dependency-threading. Imports only `session.js`, `firebase-client.js`, `perf-stats.js`, `roster-data.js` (escapeHtml).

### `operations-boot.js`
2-line bootstrap for `operations.html` (Phase 4a.2, v14.65). Imports `init` from `operations-app.js` and calls it. Exists because CSP `script-src 'self'` blocks an inline `init()` call, and because keeping the call out of the coordinator lets a test `import { init }` without auto-running the page. No logic of its own.

### `links-boot.js`
2-line bootstrap for `links.html` (Phase 4a.2, v14.67). Imports `init` from `links-app.js` and calls it. Same rationale as `operations-boot.js` (CSP + testability). No logic of its own.

### `links-app.js`
Coordinator for `links.html` — the 28-line link-design workspace (designer-only; see `.claude/rules/links-design.md` for the full architecture: grid/paint/generator/coverage/checks/concurrency/print).
- Only export is `init()` (Phase 4a.2) — early-return access gate (designer via `requirePage`, else redirect), no top-level throw.
- Owns: the multi-design Firestore collection (`linkDesigns`) load/save (atomic `runTransaction` save + offline getDoc fallback, `writeWithClaimRetry`, the v17.18 `baselineUnknown` guard), the design picker (new/duplicate/rename/delete), delegated grid clicks + paint mode, compare mode, the generator UI, the unsaved-changes guards (beforeunload + capture-phase nav-link guard + logo/ops-link confirms), and the beta first-visit notice.
- All pure design maths is imported from `links-design.js` — never duplicated back here.
- The two read-only analysis panels (Coverage heat map + Design quality checks) are rendered by `links-analysis.js`, wired via `initLinksAnalysis({ getDesign: () => design })`.
- Compare mode is `links-compare.js`, wired via `const compare = initLinksCompare({ getDesigns, getActiveDesignId, getDesign, renderDesignPicker, renderGrid, renderBrushBar, dearmBrush, emptyPattern, isUnfilledPattern, shiftLabel })`. It OWNS `compareMode`/`compareDesignId` — the coordinator only calls `compare.isCompareMode()`/`getCompareId()` (reads) or `resetCompare()` (delete/select/generator-apply) or `renderCompare()`.

### `links-analysis.js`
The two read-only analysis panels on `links.html`, extracted from `links-app.js` (v17.70, extraction programme) as the cleanest first slice: both are pure render-from-a-pure-result — the maths already lives in `links-design.js`, so they only read the CURRENT design's patterns and write to their own container, carrying none of the coordinator's save/concurrency/dirty state.
- `initLinksAnalysis({ getDesign })` → `{ renderCoverageChart, renderDesignChecks }`. `getDesign` is a thunk for the live active design (or null); the coordinator calls the two renderers on every pattern change, exactly as before. Imports `DAYS`/`calcHourlyCoverage`/`runDesignChecks` from `links-design.js`; DOM containers `#coverageHeatmap`/`#coverageEmptyMsg`/`#checksContent`. Tested by `links-analysis.test.mjs` (fake DOM).

### `links-compare.js`
Compare mode on `links.html` — two saved designs side by side with a gold-outline `.cell-diff` on differing cells. Extracted from `links-app.js` (v17.71, extraction programme).
- **SINGLE SOURCE OF TRUTH for `compareMode` + `compareDesignId`** — links-app.js no longer stores them, so the coordinator and this module can never disagree. The coordinator only calls `compare.isCompareMode()`/`getCompareId()` (reads, e.g. in `renderDesignPicker`/`renderBrushBar`/`renderGrid`), `compare.resetCompare()` (on design delete/select and generator-apply), or `compare.renderCompare()`.
- `initLinksCompare(deps)` → `{ toggleCompareMode, selectCompareDesign, renderCompare, isCompareMode, getCompareId, resetCompare }`. Reads the design collection READ-ONLY via injected getters (`getDesigns`/`getActiveDesignId`/`getDesign`) and never touches the save/concurrency baseline — the safety property that makes it a safe slice. Imports `escapeHtml` (roster-data) + `DAYS`/`classifyShift`/`calcCoverage` (links-design). Tested by `links-compare.test.mjs` (fake DOM).

### `links-design.js`
Pure link-design maths (no DOM, no Firebase; tested by `links-design.test.mjs`).
- `classifyShift(shift)` / `normaliseCustomShift(raw)` (rejects night starts 21:00–03:59 — CEAs don't work nights) / `startMinutes` / `endMinutes` / `dayClass(d)`
- `calcCoverage(patterns, totalPos = 28)` / `calcHourlyCoverage(patterns, totalPos = 28)` — per-day and hour-by-hour on-duty counts for the Coverage heat map
- `generatePatterns({ slots, spare, lines = 28 })` — the slot-based rotating-window generator (the only way to create a new design)
- `runDesignChecks(patterns, rotatingLines = 28)` — unfilled lines, weekends off, short turnarounds (`MIN_REST_MINUTES` 12h), longest run, early/late balance
- Constants: `DAYS`, `MIN_REST_MINUTES`

### `paycalc-boot.js`
2-line bootstrap for `paycalc.html` (Phase 4a.2, v14.67). Imports `init` from `paycalc-app.js` and calls it. Same rationale as `operations-boot.js` (CSP + testability). No logic of its own.

### `admin-range-booking.js`
Shared skeleton for the two admin.html date-range booking sections (AL + sick), which were near-identical before v16.08.
- `createRangeBookingSection(cfg)` — wires one section: element lookup by `cfg.prefix` (`al`/`sick`), dropdown population (incl. the iOS optgroup fix), the shared preview guard chain (no member / no dates / bad range), rest-day counting via `isWorkingDate`, the from/to change listeners, and the whole save→feedback→refresh flow incl. the `auth/session-expired` vs generic error split. Returns `{ updatePreview, saveBtn }`.
- Per-section differences are injected as config/hooks: `validateRange(dates)` (60-day vs 1-year), `renderReady(ctx)` (the 🏖️/🪑 innerHTML), `successFeedback`/`successToast`, `beforePreview`/`afterDateChange`/`afterSave` refresh hooks, and the AL-only `onClick` (confirm-flag reset) + `preSave(ctx)` (over-entitlement check → confirm bar). It does NOT own the AL entitlement maths or the spare warning — those live in `admin-al.js` and are passed in via the hooks.
- Imports `teamMembers` from `roster-data.js`; `recordRangeOverrides`, `formatDisplay`, `buildMemberDateMap`, `isWorkingDate` from `admin-overrides.js`; `buildRangePicker`, `getDateRange` from `admin-rangepicker.js`.

### `admin-al.js`
Annual Leave Booking section (extracted v9.93; thin config wrapper over `admin-range-booking.js` since v16.08).
- `initALSection(deps)` — supplies the AL config to `createRangeBookingSection`: the 60-day cap, the 🏖️ preview with the CEA/CES spare-shift warning, and the over-entitlement pre-save check that drives the confirm bar. Receives DOM handles and callbacks via `deps` to avoid circular imports.
- `triggerConfirmedALSave()` — called by the confirm bar in `admin-app.js` when the user accepts booking over their AL entitlement; sets internal flag and re-fires the save button (`_alSaveBtnRef`, captured from the factory return).
- Imports `getALEntitlement`, `getBaseShift`, `isSunday`, `escapeHtml` from `roster-data.js`; `getAllOverrides`, `isWorkingDate`, `buildMemberDateMap` from `admin-overrides.js`; `createRangeBookingSection` from `admin-range-booking.js`.

### `admin-sick.js`
Sick Days Recording section (extracted v9.93; thin config wrapper over `admin-range-booking.js` since v16.08).
- `initSickSection(deps)` — supplies the sick config to `createRangeBookingSection`: the 1-year cap (maternity / long-term absence) and the 🪑 preview. No entitlement check and no confirm bar (absence is not capped). Receives DOM handles and callbacks via `deps` to avoid circular imports.
- Imports `escapeHtml` from `roster-data.js`; `createRangeBookingSection` from `admin-range-booking.js`.

### `admin-overrides.js`
The Change a Shift module. Owns the week grid and override list entirely.
- `TYPES` — type metadata object (label, pill, fixed, fixedValue). `pill` is the short button label used in both the per-row grid and the bulk bar.
- `PILL_TYPES` — ordered array of type keys for both pill lists (`['annual_leave', 'shift', 'rdw', 'sick', 'correction', 'other']` — 6 since v15.57; `spare_shift` removed from the top row and demoted to a chip in the Other submenu). Single source of truth — `renderWeekGrid()` generates per-row pills from this; `admin-app.js` generates bulk-bar pills from this at init. Never duplicate the list. (v13.48; `training` added v15.37 — `TYPES.training` is `timesOptional: true` (time inputs shown, blank = valid → pay defaults) and activating it reveals the per-row `.other-opts` sub-controls: flavour Train/Ind/Assess/Team + a 📋 **Spare** chip (v15.57 — picking Spare writes a `spare_shift`/'SPARE', NOT an 'other' day, and hides the RDW tick/times via `_syncOtherSpareMode`) + an RDW tick pre-ticked on rest-day bases; the save collector in admin-app.js composes the grammar `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`; `validateShiftRules` validates the time part of a timed training and skips untimed ones; Sunday training is blocked at pill/bulk/collect layers.)
- `initOverrides(opts)` — called once by `admin-app.js` after login; receives callbacks
- `renderWeekGrid()` — generates per-row type pills from `PILL_TYPES`
- `loadOverrides()` / `renderTable()` — Saved Changes list
- `executeSave()` — writes override to Firestore
- `updateSaveBtn()` — exported so swipe carousel can call it
- State accessors: `getAllOverrides()` / `setAllOverrides()` — `getAllOverrides()` used by `admin-al.js` (entitlement check)
- `recordRangeOverrides({ type, value, memberName, dates, changedBy })` — shared batch-write helper called by `admin-range-booking.js` on behalf of both booking sections; filters out Sundays and RD days, writes Sunday RD corrections alongside AL/sick overrides, updates `_allOverrides` cache, and re-renders the week grid and override list
- `formatDisplay(str)` — shared date formatter (`YYYY-MM-DD` → `18 Mar 2026`); imported by `admin-range-booking.js` for the AL/absence range labels
- `getEffectiveShift(memberName, dateISO, batch, toDelete = [])` / `validateShiftRules(...)` / `buildMemberDateMap(memberName)` (reads the module's `_allOverrides` cache filtered by member) — shift-resolution + validation helpers, covered by `admin-overrides.test.mjs`
- `isWorkingDate(memberObj, dateStr, ovByDate)` — SINGLE SOURCE for the AL/absence "is this a working day" rule (Sunday→override→base). Used by recordRangeOverrides AND the AL/sick previews; previously reimplemented 4× and the previews had drifted from the save path (v16.06 unified + fixed).
- `whenOverridesReady()` — resolves once the FIRST `loadOverrides()` has SETTLED (success OR failure); the three write/validate paths await it so they never act on a cold cache (v16.85). `isOverrideCacheLoaded()` (v16.97, Finding #2) is the companion SUCCESS flag: `whenOverridesReady` resolving on failure (so the Save button never hangs) would let a write build from an EMPTY cache — duplicate overrides, an erased worked Sunday, a missed <12h rest gap — so `recordRangeOverrides` (throws `cache/load-failed`), `executeSave`, and the admin-app click handler additionally refuse when this is false. Latches true on a successful load or `setAllOverrides`; a later refresh failure keeps the last-good data. Tested by `admin-overrides.test.mjs`.
- Also exported (grid/bulk internals reused across the module and by `admin-app.js`): `resetTableMemberFilter()`, `updateWeekNavLabel()`, `buildWeekGridInto(container)`, `resetBulkPills()`, `_hasStagedEdits()` (true when any week-grid row holds a staged-but-unsaved add/change/removal — the background-refresh paths in both modules skip `renderWeekGrid()` while it's true so a refresh can't clobber staged rows)

### `admin-rangepicker.js`
Inline date-range calendar widget — extracted from `admin-app.js` at v11.36.
- `buildRangePicker(prefix)` — builds a month grid with from/to selection, chip labels, and swipe navigation between months; returns `{ reset() }`
- `getDateRange(fromVal, toVal)` — pure: inclusive ISO date list for a range; `null` if reversed, `[]` if either input empty (v12.55). Covered by `admin-rangepicker.test.mjs`
- Imports `DAY_NAMES`, `MONTH_ABB`, `MONTH_NAMES`, `formatISO`, `SWIPE_THRESHOLD`, `SWIPE_VELOCITY` from `roster-data.js`
- Imported directly by `admin-al.js` and `admin-sick.js` (no longer goes through `admin-app.js`)

### `date-picker.js`
Brand-styled single-date picker for the four Operations upload date fields (`huddleDate`, `circularDate`, `newsletterDate`, `rosterWeekEnding`) — replaces the un-themable native `<input type="date">` glyph/popup with a modal calendar in the app's own visual language (v17.36).
- `initDatePickers(inputIds)` — progressive enhancement: each native `<input type="date">` stays in the DOM **hidden** as the value holder (so every consumer — `doc-upload.js` `.value`/`.max`/default-to-today, the roster card's Saturday-snap `change` listener — keeps working unchanged); the picker inserts a `.date-trigger` button and opens ONE shared modal calendar built on `createLightbox`. Selecting a day sets `input.value` + dispatches `input`+`change`, then a per-input `change` listener re-reads the (possibly consumer-normalised, e.g. Saturday-snapped) value into the trigger label. Reads `input.min`/`input.max` to disable out-of-range days.
- `monthCells(year, month)` — pure: a Monday-first flat month grid (`null` padding + ISO day strings), no DOM. Covered by `date-picker.test.mjs`.
- Modal (not inline) so it stays one line per card — an always-open calendar × 4 cards would bulk up the Operations stack. Imports `roster-data.js` (DAY_NAMES/MONTH_ABB/MONTH_NAMES/formatISO/parseISODate) + `overlay.js` (createLightbox). Called by `operations-app.js` after the card inits set the field defaults.

### `huddle.js`
Huddle upload, push notification subscribe/unsubscribe, and Huddle card toggle.
- `initHuddleUpload(opts)` — called by `operations-app.js`; wires Huddle upload card + Huddle collapse toggle (admin-only)
- `initHuddleNotifications()` — called by `settings-app.js`; wires the Notifications card (all staff, settings page)
- Notifications card: VAPID key handling, fingerprint-based re-subscription on key rotation
- Huddle upload: file validation, DOCX conversion via mammoth.js, upload to Firebase Storage via `uploadHuddle`
- Huddle card: collapse/expand toggle

### `doc-upload.js`
Shared Operations upload-card skeleton (v16.07). `initDocUploadCard(cfg)` owns file-pick → validate (type + 20 MB) → optional pre-upload `transform` → upload → feedback + the date cap; per-card config (accepted types, transform, `maxDateOffsetDays`, uploadFn, copy). Drives Circular + Newsletter (operations-app.js) and the Huddle (huddle.js, which passes its DOCX→HTML Mammoth transform). `isPdfFile(f)` + `isDocxFile(f)` exported as accept predicates; Circular/Newsletter accept both (PDF or Word .docx — no upload transform, v16.31; a Word doc later opens via the Office Online viewer rather than downloading, v16.45), the Huddle also converts DOCX→HTML. Imports only `roster-data.js` (formatISO) + `session.js` (sessionReady).

### `admin-email-check.js`
The one-time work-email confirmation overlay, extracted from admin-app.js (v16.41) as a self-contained feature module. Imports only `ls.js`, `firebase-client.js` (getStaffContact/saveStaffContact), `roster-data.js` (CONFIG/isValidEmail/isChilternWorkEmail), `overlay.js` (lock/unlockBodyScroll), `session.js` (sessionReady), plus the `#emailCheckOverlay` DOM — no admin-app coupling.
- `initEmailCheck(member)` — awaits `sessionReady`, then runs the check. Called fire-and-forget on every authenticated admin page load.
- `_runEmailCheck` — the promise-based overlay engine: prompts ONLY when a fresh-login `myb_email_check_pending_<member>` marker is present (set by admin-app.js's login onSuccess) AND the member is DUE (`_emailCheckDue`: ≥ 3 months since `myb_email_check_done_<member>`, or never/legacy). 4s-timeboxed `getStaffContact`; confirm vs add/edit views; focus-trap; mandatory (no close); stamps `myb_email_check_done` on dismiss. The pure-add screen also offers a soft "I'll add this later" (D2) that closes WITHOUT stamping, so it re-prompts next fresh login.
- `isEmailCheckDue(rawStamp, now, intervalMs?)` + `EMAIL_CHECK_INTERVAL_MS` (v16.66) — PURE cadence decision extracted from `_emailCheckDue` (which now delegates to it): due when never confirmed, a legacy/junk stamp (pre-v14.77 `'1'` or any sub-`1e12`-ms value), or `now − last ≥ intervalMs`. Storage/DOM-free so the legacy heuristic is unit-tested by `admin-email-check.test.mjs`.

### `admin-auth.js`
Staff Firebase Auth account setup (admin only).
- `initAuthSetup(opts)` — called once by `operations-app.js`
- Wires up the Staff Login Accounts card; calls `setupRosterAuth` Cloud Function
- Sends a fresh Firebase ID token (`getIdTokenResult(true)`) as the bearer token — no client-side secret since v9.88

### `admin-roster-upload.js`
The Weekly Roster Upload pipeline.
- `initRosterUpload(opts)` — called by `operations-app.js` after session guard passes
- `computeCellStates(parsedResult, existingOverrides)` — classifies each day: MATCH / DIFF / CONFLICT / COVERED / REMOVE_IMPORT / UNREADABLE. **Module-scope + EXPORTED (v16.37)** so the state machine is unit-testable (`admin-roster-upload.test.mjs`), like its sibling `shiftValueToOverrideType`.
- `renderReviewTable()` — per-person card list. Presentation reworked v15.52: a plain-language **outcome summary** ("what Save will do" — updated / cleared / needs-your-choice / couldn't-read) above the list; each change row carries a **Save tick** (was a Save/Skip toggle button) + an action tag (Update / Clear old / Your choice / Not saved); conflicts are an inline **Keep yours / Use new roster** choice (was Manual / PDF) with no separate top conflict banner; the Save button shows a live count. State machine + `chosen` model unchanged.
- `shiftDisplay()` — badge display helper (module scope)
- `shiftValueToOverrideType(value, baseShift, date)` — parsed value → override `type`; **module-scope + EXPORTED (v15.34)** so it is unit-testable (`admin-roster-upload.test.mjs`). Maps the training grammar → `'other'`; Sunday AL/SICK/training → `'correction'` (the Sunday block).
- `_saveOverrideBatches(toWrite, currentUser)` — **EXPORTED (v15.69, the v15.48/v15.69 review fix)**. Writes the reviewed changes in ≤200-op chunks; **each chunk's batch is (re)built and committed INSIDE a `writeWithClaimRetry` thunk**, so a freshly-provisioned / claim-changed admin's stale ID token self-heals (permission-denied → force `getIdToken(true)` → retry once) — matching every other Admin write path. The batch is rebuilt per attempt because a `WriteBatch` can't be reused after a failed commit. Tested in `admin-roster-upload.test.mjs` (happy path, single-denial retry with a fresh batch, persistent-denial reject, non-auth no-retry, deleteOnly/replaceId ops).
- `fetchOverridesForWeek(dates)` — **module-scope + EXPORTED (for testing)**. Fetches the week's existing overrides for conflict classification; **fails closed** — on a read failure it throws a tagged `conflictReadFailed` error rather than returning `[]` (an empty result would silently misclassify existing overrides as absent).
- **UNREADABLE (v15.30):** when `normaliseShift` (functions) can't parse a non-empty cell it returns a `UNKNOWN|<raw>` sentinel instead of defaulting to `RD` (which, when the base is also RD, silently dropped a real shift as a MATCH). `computeCellStates` maps the sentinel to a skip-only `UNREADABLE` row — surfaced in review, counted in the summary label, but never written (the save path only writes DIFF/CONFLICT). The admin fixes the source PDF and re-uploads, or records the shift manually. Since v16.68 the server's `applyColumnScanCrossCheck` also emits this sentinel (`UNKNOWN|row or col? (PDF unclear)`) for any cell where the AI's row read and column re-read disagree without a provable one-day realignment — both readings shown to the admin.
- `detectShiftedRow(member, shifts, dates)` — **pure + EXPORTED (v16.68)**, the AI-independent day-drift detector: correlates the parsed week against the member's OWN base roster at offsets −1/0/+1 (`getBaseShift`); returns `'left'`/`'right'` when a ±1 alignment beats the correct one by ≥3 matches (and scores ≥5/7), else `null`. UNKNOWN cells carry no signal; fixed-pattern (uniform) weeks can't trip it (all offsets score alike). `renderReviewTable` shows a warn-only "these days may be one day out" banner (`role=alert`, `.roster-shift-warning`) on a flagged member's section — catches the residual case where BOTH server-side AI reads (row + column) misread identically, since the base pattern doesn't come from the AI at all. Tested in `admin-roster-upload.test.mjs`.

### `paycalc-app.js`
Coordinator for `paycalc.html`. No pure pay maths, no period arithmetic here.
- **Exported `init()` wrap (Phase 4a.2, v14.67):** the whole body is `export function init()`, called by `paycalc-boot.js` (the page loads the boot file — CSP blocks an inline call). The local-identity gate (no local session → login overlay) early-`return`s instead of throwing; importing the module no longer auto-runs it.
- **SOFT auth (Phase 7, v14.66):** gate #1 (local-identity precondition) is intentionally NOT routed through `requirePage` — paycalc needs a local member to namespace its localStorage. The Firebase-confirmation path (`_initErrorReporting`) decides via `requirePage(getAuthSnapshot(), 'paycalc')`, which being `soft` returns only `allow`/`soft-allow`, never `login`, so the calculator is never blocked.
- `calculate()` — main calculation engine (calls paycalc-calc.js pure functions)
- `onPeriodChange()` — orchestrates all period-level updates; calls helpers from paycalc-periods.js and paycalc-settings.js
- `autosave()` — saves hours data per period to localStorage
- `_suggestIfBlank()` / `_applyRosterSuggestion()` — roster pre-fill helpers
- HPP card, sticky take-home bar, back-pay card
- `_bpAmount` / `_bpVarAmount` / `_bpPNum` — back pay state (v10.73): `_bpVarAmount` holds the variable-pay portion of the lump. It is **no longer fed into HPP** (v16.89 double-count fix — `calcHPP()` takes no back-pay arg; the whole-year settled-rate pricing already carries the award uplift), so `calcBackPay` still returns it but the coordinator ignores it
- Imports `SK`, `periodKey`, `hppEstKey`, `hppActualKey`, `runMigrations` from `paycalc-migrations.js`; lightbox lifecycle delegated to `paycalc-lightboxes.js`. Back-pay maths (`calcBackPay`, `prefillBackPay`) delegated to `paycalc-backpay.js` — see that module's section
- Period select, prev/next, tax-year tabs: delegated to `paycalc-periods.js`
- Grade cache, settings save/load, rate/YTD fields: delegated to `paycalc-settings.js`

### `paycalc-lightboxes.js`
Lightbox and overlay initialisation for `paycalc.html` — extracted from `paycalc-app.js` at v13.86.
- `initPaycalcLightboxes()` — initialises all five overlays; returns `{ openAboutLightbox }` so the nav-panel drawer logo can open the About panel
- **About panel** — `initAboutLightbox({ appLabel, getUserName })` with header logo wired as back-to-calendar button
- **Help lightbox** — `HELP_CONTENT`-driven; opened by any `.help-btn[data-help]` button
- **Welcome lightbox** — first-visit; gated on `WELCOME_KEY = 'myb_pc_pay_welcome_shown'`; populates grade badge on open; closes and sets flag on dismiss
- **YTD notice** — shown once after welcome has been dismissed; archives via `archiveNotice()` on close; 90-day expiry gate
- **Decimal hours converter card** — `initCardCollapse` toggle; converts decimal hours to hr/min text on input
- Imports: `overlay.js`, `about-lightbox.js`, `paycalc-help.js`, `nav-panel.js`, `ls.js`, `paycalc-calc.js`, `paycalc-migrations.js`, `paycalc-settings.js`

### `paycalc-periods.js`
Period arithmetic and select UI for `paycalc.html` (v13.80).
- `CONFIG` — period anchor, PERIOD_DAYS, PERIODS_PER_YR, FIRST/LAST_OFFSET, TAX_YEARS
- `getPeriods()` — returns the full period array; result is cached (avoids ~78 Date allocations per calculate())
- `currentPeriodNum()` — reads `#periodSelect` value
- `todaysPeriodNum()` — the period being earned TODAY (independent of the selected period); the
  back-pay accrual caps at it so a future selection can't accrue unworked weeks
- `buildBackPayPeriodSelect(minPNum?)` — optional floor so the back-pay paid-in dropdown only offers
  periods from the award's April onward (prefillBackPay passes `48 + ty.first`)
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
- `getPensionDefault(pObj)` — period-aware pension default for the current grade
- `updateRateForPeriod(ty, p)` / `updateYtdForTaxYear(ty)` — load the period-aware rate (pre-award periods get the old rate) and YTD figures into form fields; called from coordinator's `onPeriodChange`. The rate field is **read-only** (grade-fixed, v17.87) with a "· pre-rise/current rate" label + `#rateStepNote` explaining the step
- `getStoredRateForYear(ty)` — the hourly rate for a tax year. Since v17.87 the rate is FIXED BY GRADE and no longer user-editable/stored, so this derives it purely from `AWARD_RATES` (the year's confirmed settled rate) → grade default (no localStorage). Used by `updateRateForPeriod`, the prior-year HPP estimate, and back-pay prefill. `saveSettings` persists NO rate now (removed the stale-saved-rate bug class); Grade + Tax Code + Pension are the editable settings
- `settingsKey(ty)` — per-tax-year localStorage key for the confirmed flag
- `saveSettings()` — persists all settings fields; does not set confirmed flag
- `confirmSettings(calculate)` — saves, marks confirmed, collapses card; calls `calculate` callback (passed by coordinator to avoid circular dep)
- `setSettingsCardOpen(open)` — programmatic open/close keeping `aria-expanded` in sync
- `loadSettings()` — loads persisted settings into form on page init
- Imports from `paycalc-calc.js`, `paycalc-periods.js`, `paycalc-migrations.js`, `session.js`, `roster-data.js`, `ls.js`

### `paycalc-roster-hint.js`
Roster-assist hint bar UI, fill logic, and snap persistence for `paycalc.html` (v13.81).
- `updateRosterHint()` — re-renders the hint bar based on current suggestion state
- `updateJoinerNotice(p)` — shows/hides the pro-rata joiner banner for joining periods
- `toggleRosterDays()` — expands/collapses the day-level breakdown in the hint bar
- `fillFromRoster(autosave)` — fills all blank hour fields from the current suggestion; calls `autosave()` then `updateRosterHint()`
- `fillCategoryFromRoster(cat, autosave)` — fills one category (sat/bh/sun/rdw/box) from suggestion; calls `autosave()` then `updateRosterHint()`
- `_applyRosterSuggestion(s, force)` — internal: applies a suggestion object to form fields
- `clearRosterSuggestedAll()` — removes all `roster-suggested` CSS highlights
- `_restoreRosterSuggested(pNum)` — restores highlight state from snap on period load
- `snapKey(pNum)` — localStorage key for the snap of suggestion state for a period; exported so coordinator's `clearPeriod()` can call `lsDel(snapKey(pNum))`
- `renderRosterDayList(s)` — renders the per-day breakdown rows into the hint bar
- Imports from `paycalc-periods.js`, `paycalc-settings.js`, `paycalc-roster-suggestions.js`, `roster-data.js`, `ls.js`
- Does NOT import from `paycalc-app.js` (circular dependency avoided via callback parameters)

### `paycalc-hpp.js`
Holiday Pay Premium estimator and shared period decode helpers for `paycalc.html` (v13.81).
- `isDataEmpty(d)` — returns true if all hour fields in a persisted period object are zero/falsy; exported for coordinator's `updateSaveStatus` and for `paycalc-backpay.js`
- `_decodeHours(p, d)` — decodes raw period data into `{satHrs, bhHrs, bhOtHrs, otHrs, rdwHrs, sunHrs, boxHrs}` floats; exported for `paycalc-backpay.js`
- `_varPayForPeriod(p, d, rate)` — the HPP-accruing variable pay for one period (OT/RDW/Sun/Sat/BH/Boxing premiums). **Excludes contracted basic, peer pay, AND London Allowance** — London is a fixed allowance that does not accrue HPP (removed v17.23; see KNOWN_LIMITATIONS #3). Used by `calcHPP`, `updatePriorHpp`, and `paycalc-backpay.js`
- `calcHPP()` — renders the HPP estimate card (takes NO args since v16.89: back pay is deliberately not folded into HPP — the whole-year settled-rate pricing already carries the award uplift). **Amount-source aware (v18.32):** `'hours'` (default — the per-payslip estimator), `'ytd'` (a quick "extra pay so far this year" figure × 7.69%), or `'exact'` (a hand-entered figure). Whichever mode, the resulting figure is written to `hppEstKey(ty)`, so the January take-home add + prior-year rollover are unchanged. **Per-radio figures (v18.40, review item 4):** the hours estimate is computed in EVERY mode (the side-effect-free internal `_hoursEstimate`) and each amount-source radio shows its CURRENT £ (`_updateModeAmounts` → `#hppMode*Amt` spans; "≈" marks the two estimates, the member's exact figure shows plain) so the choice is informed — persistence stays strictly per-active-mode
- `hppFromYtdTaxable(taxablePayYtd, nonPremiumYtd)` — PURE: `max(0, taxable − nonPremium) × 4/52`. Isolates the premium portion of the Year to Date **Taxable Pay** (by removing expected basic + London − pension, computed by the internal `_expectedNonPremiumYtd`) then takes 7.69%. The 'ytd' mode reads the Year to Date Figures card's `#ytdPay` and derives a ROUGH figure from it (v18.34 — replaced the v18.32 separate "extra pay" input); unit-tested
- `applyHppMode(mode?)` — reflect a mode into the DOM (tick its radio, show only the matching group). 'ytd' has no input of its own — it shows a note and reads the Year to Date card
- `saveHppState(ty)` / `restoreHppState(ty)` — persist / restore the card's mode + the exact-figure input, PER TAX YEAR (`hppModeKey`), mirroring the back-pay per-year blob; the coordinator restores before `calcHPP` reads the DOM on a period/year change
- `updatePriorHpp(ty)` — renders the prior-year actual HPP section
- Imports from `paycalc-calc.js`, `paycalc-periods.js`, `paycalc-settings.js`, `paycalc-migrations.js`, `roster-data.js`, `ls.js`

### `paycalc-year-summary.js`
"This tax year so far" for the Year to Date Figures card (v18.41 — review item 11).
- `computeYearSoFar(ty, opts)` — a headless re-run of the calculator over every PAID payslip of the tax year with saved hours: per payslip, decode (`_decodeHours`) → `computeGross` (period-aware rate + pro-rated London + the payslip's own saved pension, else the default) → non-cumulative `computeTax`/`computeNI`/`computeSL` (honouring the per-period `slSkip` AND the item-9 loan-repaid cutover via `opts.slPaidOffFromP`). Returns `{ entered, paid, total, taxable, tax, ni, sl, net, projectedNet, skipped }` — `projectedNet` = (net ÷ entered) × the year's payslip count, deliberately labelled rough; corrupt periods are counted in `skipped`, never silently dropped. NO DOM — the caller passes the current tax-code/loan settings in `opts` (and an injectable `now` for tests)
- Rendered by the coordinator's `_renderYearSoFar` into `#ytdYearSoFar` after every `calculate()`; hidden until at least one payslip of the year has hours
- Imports from `paycalc-calc.js`, `paycalc-periods.js`, `paycalc-settings.js`, `paycalc-migrations.js`, `paycalc-hpp.js`
- Tested by `paycalc-year-summary.test.mjs` (mock harness mirrors `paycalc-hpp.test.mjs`; the money assertions mirror each payslip through the REAL calc engine)

### `paycalc-backpay.js`
Back-pay lump sum calculator for `paycalc.html` (v13.81).
- `_bpAwardTaxYear(fromPNum)` — tax year of the back-pay award (derived from "backdated from" period); exported for the coordinator and tests
- `prefillBackPay()` — pre-fills card inputs when the card opens / a new award year is first viewed; returns `calcBackPay()` result for coordinator to consume. On an award-year change it clears the previous year's figures, resets the opt-in tick, and applies the year's default mode (compute for the current award, enter-from-payslip for a prior one). For an **unconfirmed** award year it fills Old rate/London and leaves New blank for the % helper; a **confirmed** year's boxes are enforced+locked by calcBackPay (below)
- `calcBackPay()` — calculates the lump from the card inputs (compute mode: rate×hours accrual; manual mode: the typed payslip figure), renders results, returns `{ bpAmount, bpVarAmount, bpPNum, bpIsEstimate, bpIncluded }`; does NOT mutate coordinator state. For a CONFIRMED award it also ENFORCES the authoritative AWARD_RATES/TAX_YEARS figures into the Old→New boxes and locks exactly those (a figure not on record — e.g. CES 2025/26 old rate — leaves its box permanently editable; the lock never keys off box contents, v17.94). Toggles the `#bpEstimateNote` banner + "Pay rise %" visibility for an unconfirmed year, and hides the paid-in selector for a decided award (auto-set). Also writes the card-leading STORY strip (`#bpAwardScope`) on every exit path via `bpStoryHtml` (v18.39)
- `paidInPeriodNum(periods, awardFrom)` — PURE (v18.13): the number of the first period whose payday is on/after `awardFrom` — the payslip that carries a DECIDED award's backdated lump. Null for an undecided award / no qualifying period. `calcBackPay` (and prefill/restore) derive the paid-in through this for a decided award instead of trusting the persisted selector value, so an award-date MOVE (the 3.6% award 31 Jul → 28 Aug) can't leave the lump/"green box" on the old payslip. Unit-tested in `paycalc-periods.test.mjs`.
- `_accrueBackPayPeriod(i)` — PURE per-period back-pay arithmetic (no DOM/storage; unit-tested in `paycalc-periods.test.mjs`) → `{ backPay, varPay }`. `backPay` (the lump) = contracted + premium-bucket + peer + pro-rated London diffs. `varPay` (the HPP-accruing portion) = premiums ONLY — it EXCLUDES London (London does not accrue HPP, v17.23) and is currently unused downstream. calcBackPay maps DOM/storage to these numbers — do not re-inline the maths
- `restoreBpState()` — restores the persisted card figures for the VIEWED award year from its own per-year blob (`bpKey(ty)` → `bp_state_<year>`, written by calcBackPay on every recompute), rebuilding the paid-in list for that year first so the saved selection applies. Returns true when a blob was applied — EVEN an all-blank one (a deliberate clear must stick). Called by the coordinator's `_syncBackPayForViewedYear()` on init AND every period change: true → recompute the saved figures; false (no saved state for this year) → prefill the DEFAULT (compute-estimate for the current award, enter-from-payslip for a prior one). The lump only JOINS the take-home when the opt-in tick (`#bpIncludeTick` mirrored by the banner `#bpBannerTick`, OFF by default, persisted as `inc`) is set AND its paid-in payslip is the one viewed (`_bpPNum === _pNum`)
- **Per-year viewing (v17.86):** the card follows the VIEWED payslip's award year (`_backdatedFromPNum` uses `currentPeriodNum` again), with per-year state keeping each year's tick/rates/mode/manual-amount apart (supersedes the v16.91 pin-to-today). `applyBpMode(mode?)` — exported; reflects the amount-source toggle (`bpMode` radios) into the DOM, showing `#bpComputeFields` (rate×hours accrual) or `#bpManualWrap` (`#bpManualAmt`, the actual figure from the payslip). `_defaultBpMode(ty)` → compute for the current award, manual (enter-from-payslip) for a prior/already-paid one
- `bpStoryHtml(o)` — PURE (v18.39, review item 5): the plain-English story leading the card — award shape (tense-aware, date-first payslip naming, backdated-to 1 April year from the label) + the member's figure per state (`computed` "roughly £X" / `manual` exact tense-aware / `manual-empty` prompt / `empty-window` / `no-figures` facts-only). Unit-tested in `paycalc-periods.test.mjs`; replaced the static award-scope line + the removed generic card explainer
- `raiseByPercent(oldVal, pct)` — pure; new value after a % rise (`oldVal × (1 + pct/100)`), 0 for non-positive inputs. Backs the coordinator's "Pay rise %" shortcut that fills the New rate/London from the Old figure (v15.62)
- Imports from `paycalc-calc.js`, `paycalc-periods.js`, `paycalc-settings.js`, `paycalc-migrations.js`, `paycalc-hpp.js`, `paycalc-format.js`, `ls.js`

### `paycalc-format.js`
Pure date/currency formatters + time-input helpers shared by `paycalc-app.js` and `paycalc-backpay.js` (v14.06; time helpers added v17.74 / Section G). No DOM, no Firebase. Tested by `paycalc-format.test.mjs`.
- `fd(d)` — formats a Date as "1 Apr 26" (day + short month + 2-digit year)
- `fdShort(d)` — formats a Date as "1 Apr" (day + short month only)
- `fdLong(d)` — formats a Date as "1 Apr 2026" (day + short month + full year) — the payday / joined-on / printed-on long form; de-duplicated from ~8 inline `toLocaleDateString` copies across `paycalc-app`/`-backpay`/`-periods`/`-roster-hint` (v18.30). Same no-timeZone rationale as `fd`
- `fmt(n)` — formats a number as a currency string, e.g. "£1,234.56"
- `clampMinute(n)` — clamp a parsed minutes integer into [0, 59] (pure core of the hrs/mins field's `clampMins` DOM wrapper)
- `decimalToHM(val)` — split decimal hours → `{h, m}` with a 60→next-hour float guard (e.g. 7.999 → 8h 00m); returns null for negative/non-finite. The single source for the live "= 7h 30m" preview AND the on-blur "7.5 → 7 hrs 30 mins" split (was duplicated inline in `paycalc-app.js`)

### `paycalc-breakdown.js`
The two PURE HTML builders for the pay-result card, extracted from `calculate()` in `paycalc-app.js` (v18.30, review item 20). `calculate()` used to interleave DOM reads, pay maths, and result-markup string-building; the markup now lives here, written + unit-testable independent of those phases. No DOM, no Firebase — only dependency is `fmt` from `paycalc-format.js`. Output is byte-identical to the old inline templates (a mechanical extraction, not a redesign). Each builder takes a plain params object whose field names match the caller's locals, so `paycalc-app.js`'s call site is a shorthand object literal. Tested by `paycalc-breakdown.test.mjs`.
- `fmtHrsMins(h)` — decimal hours → "Nh"/"Nh Mm" (the per-row hours label; was the inline `fh` in `calculate()`)
- `buildSummaryRows(d)` — the `#summary` estimate rows: Regular/Total pay → back pay → HPP → pension → tax → NI → Student Loan (`d.slLines`, pre-rendered) → estimated take-home
- `buildBreakdownRows(d)` — the `#bdBody` full breakdown: one row per pay component present (Mon–Fri + London always; premiums/OT/RDW/training/adjustment/notes/extras guarded on > 0)

### `paycalc-inputs.js`
The DOM-pure form-field input helpers extracted from `paycalc-app.js`'s `init()` (v18.60, review item 10 — continue focused coordinator extraction). They read/normalise the numbers a member types into the hours & figures fields, and own the live "= 7h 30m" decimal hint. They depend ONLY on `document` plus imported pure helpers (`parseSmartFloat`/`parseSmartFloatOrNull` from `roster-data.js`, `clampMinute`/`decimalToHM` from `paycalc-format.js`) — NO coordinator closure state — so they lift out of `init()` cleanly and are unit-testable in Node against a fake `document`. The event WIRING that USES them (`autoDecimalHours`, `onHhMm`) stays in `paycalc-app.js` because it closes over `calculate()`/`autosave()`/period state; it just calls these primitives. Tested by `paycalc-inputs.test.mjs`.
- `numVal(id)` — parse a field's value with `parseSmartFloat` (strips iOS smart-hyphens/quotes); missing element / empty → 0
- `numValOr(id, fallback)` — like `numVal` but returns `fallback` for an unparseable/empty value (NOT 0) — the signed Year-to-Date / pension fields need an explicit floor so a stray "." doesn't cascade £0/£NaN
- `intVal(id)` — non-negative integer read (`Math.max(0, parseInt || 0)`) for the hour/minute fields
- `hhmmDec(hId, mId)` — combine an hrs + mins field pair into decimal hours
- `clampMins(mId)` — clamp an out-of-range minutes field into [0, 59], rewriting ONLY when out of range (preserves a typed "05")
- `_decHintEl(hId, make)` — find (or lazily create when `make`) the `.hhmm-dec-hint` element under an hours field's `.hhmm-wrap`; null when the markup is absent
- `decPreview(hId)` — write the live "= Nh Mm" hint while a decimal is being typed, hide it for a whole number

### `paycalc-help.js`
Pure data module — help/tooltip text for the pay calculator (v11.40).
- `HELP_CONTENT` object with keys: `hours`, `settings`, `accuracy`, `hpp`, `backpay`
- Imports `TAX_YEARS` from `paycalc-calc.js` for the London Allowance figure in tip text
- No DOM, no Firebase — safe to import anywhere

### `paycalc-migrations.js`
- `ytdSrcKey(ty)` — per-tax-year SOURCE payslip of the Year to Date figures (internal period num); anchors the cumulative tax method to source+1 (v17.98)
localStorage key constants and data migration logic for the pay calculator (v11.40).
- `SK` — object of top-level localStorage key strings, rebuilt in place when the namespace changes
- `pcPrefix()` — the active per-member key prefix (`myb_pc_` or `myb_pc_<slug>_`); every key builder and `SK` derives from it (v14.11)
- `setPaycalcNamespace(memberName)` — activate the per-member namespace (called from `runMigrations`); falsy name → unnamespaced legacy keys (v14.11)
- `periodKey(pNum)` — key builder for period data (takes period number)
- `parseSavedPeriod(raw)` (v16.66) — PURE saved-period JSON decoder → `{ data, error }`: null/empty → `{null,false}`, valid → `{obj,false}`, malformed → `{null,true}`. `readSavedPeriod(pNum)` composes `lsGet(periodKey(pNum))` + `parseSavedPeriod`. Single decoder shared by `paycalc-backpay.js` and `paycalc-hpp.js` so a corrupt saved period is SURFACED (a visible "couldn't read N periods — may be too low" note), never dropped silently (no-silent-caps). Tested by `paycalc-migrations.test.mjs`.
- `hppEstKey(ty)`, `hppActualKey(ty)`, `ytdPayKey(ty)`, `ytdTaxKey(ty)` — key builders that take a tax-year object `ty` (with `.label` property, e.g. `'2025/26'`); `bpKey()` — the back-pay card's autosave blob key
- `NOTICE_YTD_KEY` — device-level "Year to Date notice shown" flag (deliberately unnamespaced)
- `isActualsDev(member)` / `readPayslipActuals()` / `writePayslipActuals(map)` / `clearPayslipActuals()` — the developer-only device-local payslip-actuals overlay (gated to `G. Miller`; data imported per-device, never served — see CLAUDE.md → Example payslips)
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
  `MILLER_ACTUALS.sl`). An undergraduate plan + a Postgraduate Loan repay together — the coordinator sums
  `computeSL(plan) + computeSL('postgrad')`.
- `computeTax(...)` handles the Scottish flat-rate codes `SD0`/`SD1`/`SD2`/`SD3` (intermediate/higher/advanced/top,
  v17.16) and applies the HMRC 50% overriding limit (PAYE reg 23) on both cumulative and non-cumulative paths.
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
  tyLabel)` — the one shared predicate for "period paid before its award", used by `getRateForPeriod`
  and `saveSettings`'s persist guard, and by the back-pay accrual to cap arrears at the award date.
- `computeGross()`, `computeTax()`, `computeNI()`, `computeSL()`
- `getTaxYearForOffset(offset)` / `taxYearForPeriod(p)` — the TAX_YEARS entry for a P48-relative offset, or (the nullable variant, v17.22) for a period object with the `TAX_YEARS[0]` fallback. `taxYearForPeriod` single-sources the `p ? getTaxYearForOffset(p.num - 48) : TAX_YEARS[0]` idiom (the `- 48` anchor + null fallback) that recurred across the coordinator, HPP, back-pay, and settings modules.
- `capHours({effContr,satHrs,bhHrs})` — the Saturday/BH-vs-contracted cap cascade, single-sourced (was inline in computeGross/_varPayForPeriod/_accrueBackPayPeriod).
- Edit here for: rate changes, tax year rollover, NI threshold changes, a new annual pay award
- Covered by `paycalc.test.mjs` — run tests after any change here

### `paycalc-roster-suggestions.js`
Owns the override cache and the suggestion engine. No DOM access.
- Private state: `_overridesByDate`, `_overrideFetchToken`, `_overridesFetchState`
- `resetOverrides(newState)` — called by `onPeriodChange` on every period switch
- `fetchOverridesForPeriod(p, memberName)` — async Firestore fetch, returns Promise. Member-narrowed query (v18.24 — `where('memberName','==',…)` + the 28-day date range) using the `(memberName ASC, date ASC)` composite index; previously date-range-only + client-side member filter (the over-broad-read anti-pattern the AL-stats fix retired)
- `getRosterSuggestion(p, member)` — merges base roster + overrides, returns categorised totals; member is passed by caller (no localStorage access)
- `getOverridesFetchState()` — returns the current async-fetch state (`checking`/`base-only`/`loaded`) for the suggestion UI
- `bhsForYear(year)` — bank-holiday date set for a year; also imported by `paycalc-periods.js`
- `_setOverridesForTest(map)` / `_addBhDateForTest(d)` / `_removeBhDateForTest(d)` — test-only hooks to inject overrides / adjust the BH set without Firestore
- Edit here for: overtime split rules, BH detection logic, override fetch behaviour
- Covered by `paycalc-roster-suggestions.test.mjs` — run with `node --experimental-test-module-mocks --test paycalc-roster-suggestions.test.mjs`

### `firebase-client.js`
Single Firestore initialisation point — import `db` and Firestore helpers from here, never from the Firebase CDN directly.
- `db` — initialised with `persistentLocalCache()` so all queries are backed by IndexedDB offline storage
- `COLLECTIONS` — frozen object mapping logical names to Firestore collection strings (`circulars`, `newsletters`, `clientErrors`, etc.). Use this instead of bare string literals to prevent typo-silent failures.
- Standard exports re-exported: `collection`, `query`, `where`, `orderBy`, `limit`, `getDocs`, `getDoc`, `addDoc`, `setDoc`, `deleteDoc`, `doc`, `serverTimestamp`, `writeBatch`, `runTransaction` (v17.02 — the links-app.js concurrency transaction), `onSnapshot`
- `assertFileSignature(file, expectedType)` (module-internal; not exported) — magic-byte guard called at the top of `uploadHuddle` and `_uploadDoc` before any Storage write: rejects a renamed non-PDF/DOCX (browser uploads otherwise trust only the extension/MIME). Mirrors the server-side `fileSignatureMatches` in `functions/roster-parse-helpers.js` (PDF `%PDF-`, DOCX `PK\x03\x04`). **Fails open** on a read error (never blocks a genuine upload); throws `Error('SIGNATURE_MISMATCH')` only on a positive mismatch, which the upload UIs surface as a specific "not a valid PDF/Word document" message.
- `uploadHuddle(date, file, uploadedBy, htmlContent = null)` — transactional manual-upload path (mirrors the Cloud Function ingest + circular/newsletter `_uploadDoc`): verifies the file signature, then writes a **versioned** Storage object `huddles/{date}-{uploadId}.{ext}`, records its path in the `storagePath` field, writes the `huddles/{date}` Firestore doc, then deletes the previous object only after the commit (rolls the new object back on failure) so a re-upload never orphans the old file. `htmlContent` is the converted HTML for DOCX uploads (null for PDFs). Browser delete requires the admin-delete `/huddles` Storage rule (v14.29). Age-based pruning is handled server-side by `pruneOldHuddles()` (3-month), not here.
- `subscribeToLatestHuddle(onData, onError)` — real-time `onSnapshot` listener; returns an unsubscribe function. Used by `calendar-huddle-viewer.js` (initialised from `calendar-app.js`) to keep the Huddle viewer content live without a page refresh. Logs a `console.warn` if a huddle document is missing its `storageUrl` (data integrity signal).
- `savePushSubscription` / `deletePushSubscription` — Web Push subscription management. `deletePushSubscription` guards against empty endpoint (no-ops silently).
- `auth`, `authReady`, `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `signInAnonymously`, `signOut`, `onAuthStateChanged`, `updatePassword`, `reauthenticateWithCredential`, `EmailAuthProvider`, `nameToEmail`, `normaliseSurname` — Firebase Auth (`authReady` resolves once `onAuthStateChanged` has fired the first time; `normaliseSurname` is the shared surname→password derivation that `getSurname()` in `session.js` delegates to; `updatePassword`/`reauthenticateWithCredential`/`EmailAuthProvider` back the self-service password change, v18.63)
- `getPasswordStatus(memberName)` / `savePasswordSetAt(memberName)` / `getAllPasswordStatus()` / `reauthenticateWithPassword(memberName, typed)` / `setOwnPassword(memberName, newPassword)` / `resetMemberPassword(memberName, {revoke})` — `passwordStatus` collection + password change/reset (v18.63, PASSWORD_PLAN.md Track C). `getPasswordStatus`/`savePasswordSetAt` are owner-scoped (Settings → Password); `getAllPasswordStatus` is the admin-only all-docs read for the Operations Account-status card; `reauthenticateWithPassword` re-authenticates the current user by trying `credentialCandidatesFor` (so a member on the surname default can confirm with their surname); `setOwnPassword` calls `updatePassword` then stamps `passwordSetAt` — the stamp is best-effort and returns `{ statusRecorded }`, NEVER rejecting on a stamp-only failure (the password already changed; rejecting would mis-report "password change failed" and strand the user on a now-invalid old password); `resetMemberPassword` POSTs to the admin-only `resetMemberPassword` Cloud Function with the caller's ID token (server resets the member to their surname default, optionally revokes their refresh tokens, and stamps `resetAt`)
- `withClaimRetry(fn)` (renamed from `writeWithClaimRetry` v17.08; the old name is kept as a back-compat alias for the write call sites) — runs a Firestore thunk (READ or WRITE) and, on a stale-claim `permission-denied` with a live user, force-refreshes the ID token (`getIdToken(true)`) once and retries once (SECURITY_RELEASE_PLAN.md → B3 hardening, v15.18). A write thunk must rebuild its batch each call (a `WriteBatch` can't be re-committed). Used by `recordRangeOverrides`/`executeSave`/`_saveOverrideBatches`/`links-app.js` (writes) and by `operations-app.js`'s four admin-gated read cards (v17.08 — was the byte-identical local `adminReadWithRetry`).
- `getStaffContact(memberName)` / `saveStaffContact(memberName, workEmail)` / `deleteStaffContact(memberName)` / `getAllStaffContacts()` — `staffContact` collection; singular helpers called from `settings-app.js`; `getAllStaffContacts` called from `operations-app.js`
- `logClientError(data)` / `getClientErrors()` / `resolveClientError(id)` — `clientErrors` collection (v13.31); `logClientError` called from `error-reporter.js`, read/resolve called from `operations-app.js`. Ordering/retention policy delegated to `client-errors.js` (v13.48). `getClientErrors()` returns `{ errors, truncated }` — the index-free (no-`orderBy`) unresolved query fetches `CAP + 1` and `truncated` is true only when the extra row comes back (i.e. > 100 actually exist, not exactly 100), so the Error Log card shows a "showing the first 100" banner instead of silently hiding the rest (no-silent-caps; v15.69).
- `recordPageView(pageId)` / `recordActiveAccount({month, day})` / `getUsageStats()` — anonymous `analytics` usage counters (v14.14). `recordPageView`/`recordActiveAccount` are increment-only fire-and-forget, called from `usage-reporter.js`; `getUsageStats` reads THIS + LAST month page-view docs + the active-account doc (and prunes stale daily buckets) for the `operations-app.js` Usage card (page popularity has a This/Last-month toggle; accounts keep this-month + rolling-30). Date/aggregation maths delegated to `usage-stats.js` (incl. `prevMonthKey`). No member identity is stored — uniqueness is deduped client-side in `usage-reporter.js`, and admin (developer) loads are excluded at write time (v14.95).
- `recordPerfSample({page, metric, bucket, mode, conn})` — anonymous page-load latency counter (Project 0, v14.89), increment-only fire-and-forget into `analytics/perf_<YYYY-MM>.samples[<key>]`. Called from `perf-reporter.js`; the key is built by `perf-stats.perfSampleKey` from `APP_VERSION` + the dimensions (all non-identifying — no member, no raw ms).
- `getPerfStats()` — admin-only read for the Operations "App speed" card (v14.90; two journeys v14.92; FCP + month-over-month v14.95): reads THIS + LAST month `analytics/perf_<YYYY-MM>` and returns `{ thisMonth, lastMonth }`, each `{ month, login, fcp, pages }` — plain-language `summarisePerf` summaries for the `loginTotal`, `fcp` and `domReady` metrics. The card render (`initPageSpeedCard` in `operations-app.js`) has a This/Last-month toggle and shows "🔑 Signing in" + "📄 Opening pages" as two milestones (✨ First appears = fcp, ✅ Fully ready = domReady) with both bars per page; bucketing/verdict maths is the pure `perf-stats.js` module.
- `uploadCircular(date, file, uploadedBy)` — writes the file (PDF or Word .docx) to `circulars/{date}-{uploadId}.{ext}` in Firebase Storage (versioned path; old file deleted after Firestore commit succeeds) and upserts the `circulars/{date}` Firestore doc (includes `storagePath` field for cleanup tracking); also fire-and-forget prunes documents older than 6 months via `_pruneOldDocs()` after each upload; called from `operations-app.js` (v13.58, versioned path v13.99)
- `getLatestCircular()` — queries `circulars` collection, returns latest doc's data (with `storageUrl`) or null; called from `nav-panel.js` (☰ direct open) and `calendar-doc-viewer.js` (notification-tap viewer) (v13.58)
- `uploadNewsletter(date, file, uploadedBy)` — writes the file (PDF or Word .docx) to `newsletters/{date}-{uploadId}.{ext}` in Firebase Storage (versioned path; old file deleted after Firestore commit succeeds) and upserts the `newsletters/{date}` Firestore doc (includes `storagePath` field for cleanup tracking); also fire-and-forget prunes documents older than 6 months via `_pruneOldDocs()` after each upload; called from `operations-app.js` (v13.59, versioned path v13.99)
- `getLatestNewsletter()` — queries `newsletters` collection, returns latest doc's data (with `storageUrl`) or null; called from `nav-panel.js` (☰ direct open) and `calendar-doc-viewer.js` (notification-tap viewer) (v13.59)

### `error-reporter.js`
Shared uncaught-error reporter (v13.31). Only export is `initErrorReporter()` — installs `window.onerror` + `unhandledrejection` listeners that write capped, deduped records to the Firestore `clientErrors` collection via `logClientError` (fire-and-forget; never throws, never blocks). **Requires an auth context** — the three canonical call patterns (calendar after `calendarAuthReady`; `sessionReady.then(...)` on the four session pages; paycalc's `afterAuth`) are pinned in CLAUDE.md → `initErrorReporter()` call pattern. Records surface on the Operations → Error Log card.

### `usage-reporter.js`
Anonymous usage recorder (v14.14) — the usage analogue of `error-reporter.js`. `recordUsage(page, member?, identity?)`: records an anonymous page-view counter, and (when a signed-in member is passed) counts that account toward the active-account metric, deduped client-side via localStorage flags keyed by member name (`myb_usage_m_*`, `myb_usage_d30_*`) so the server only ever receives `increment(1)` and never learns who was active. **Records nothing when `identity` (defaults to `member`) is in `CONFIG.ADMIN_NAMES`** — the developer's own test loads are excluded so figures reflect real staff (v14.95); the anonymous calendar passes its selected member as `identity` while leaving `member` null. Called once per page from each coordinator at the same point as `initErrorReporter()`. Imports the I/O from `firebase-client.js`, the dedup maths from `usage-stats.js`, `lsGet`/`lsSet` from `ls.js`, and `CONFIG` from `roster-data.js`. Fire-and-forget — never throws.

- `recordOpen(itemId, identity?)` (v18.20) — anonymous "opened" counter for documents/guides, sharing the pv_ counts map and the admin exclusion; ids `huddle`/`circular`/`newsletter`/`guide-railcard`/`guide-fip` (allowlisted in firestore.rules). No dedup — every open counts. Called from `nav-panel.js` (drawer doc opens + guide-link taps; identity = `usageIdentity` opt, the calendar passes its selected member), `calendar-huddle-viewer.js` (viewer auto-open), `calendar-doc-viewer.js` (notification-tap Open button). Rendered by the Usage card's "Documents & guides — opens" group.

### `usage-stats.js`
Pure date-bucketing + aggregation for the usage analytics — no DOM, no Firebase. Imported by `firebase-client.js` and `usage-reporter.js`; tested by `usage-stats.test.mjs`.
- `monthKey(d)` / `dayKey(d)` — "YYYY-MM" / "YYYY-MM-DD" local-time keys
- `shouldCountMonth(lastMonth, now)` / `shouldCountRolling(lastMs, now, [windowDays])` — client-side dedup decisions (per calendar month / per rolling 30 days)
- `recentDayKeys(now, [days])` / `sumDailyWindow(daily, now, [days])` — the rolling-window day keys and their summed counts ("active in last 30 days")
- `prevMonthKey(d)` — "YYYY-MM" for the calendar month before `d` (year-boundary safe); the "last month" comparison window for the Operations cards
- `orderPageCounts(counts)` — page-view counts → `[{page, count}]` sorted desc then page-name asc
- `staleDailyKeys(daily, now, [keepDays])` — daily buckets outside the retention window, for pruning
- Constants `ROLLING_WINDOW_DAYS` (30) and `DAILY_RETENTION_DAYS` — the default rolling-window and daily-bucket retention sizes the functions above fall back to

### `perf-reporter.js`
Anonymous page-load latency recorder (Project 0 instrumentation, v14.89; FCP + admin-exclusion v14.95) — the performance analogue of `usage-reporter.js`. `recordPageLatency(page, identity?)`: reads the browser's `PerformanceNavigationTiming` entry, buckets `responseEnd` (metric `ttfb`) and `domContentLoadedEventEnd` (metric `domReady`), **plus First Contentful Paint (metric `fcp`, from the Paint Timing API — when the page first "appears", via `getEntriesByType('paint')` with a `PerformanceObserver` fallback for a late paint)**, and writes an anonymous bucketed counter via `firebase-client.recordPerfSample` for each. Reads non-identifying env dimensions (PWA display mode, connection class). **When `identity` is an admin (the developer), nothing is recorded** — but the one-shot login marker is still consumed so it can't mis-time a later load. Called once per page from each coordinator at the same point as `recordUsage()`/`initErrorReporter()` (so the write satisfies `request.auth != null`). Imports `CONFIG` from `roster-data.js`. Fire-and-forget — never throws, never blocks. **No member identity and no raw millisecond value is ever stored** — only coarse buckets.
- **Login-to-usable timing (v14.92):** `markLoginStart()` (called by `login-overlay.js` when a sign-in begins) stores `Date.now()` in `sessionStorage['myb_perf_login_t0']` — it survives the post-login reload (same tab). On the destination page `recordPageLatency` reads it once (cleared on read), recency-guards it via `perf-stats.loginDurationBucket` (an abandoned marker >2 min is ignored), and records a `loginTotal` bucket under the synthetic page id `'login'` (login speed is ONE number, not split by destination, so it never pollutes a real page's stats). `clearLoginStart()` drops the marker on a FAILED sign-in. This is the metric that *proves* the in-place-login win — login times move from "A moment" into "Quick" when `INPLACE_LOGIN` is flipped on. All `sessionStorage` access is wrapped (iOS private mode throws).

### `perf-stats.js`
Pure latency maths for the perf pipeline — no DOM, no Firebase, no timing reads. Imported by `firebase-client.js` and `perf-reporter.js`; tested by `perf-stats.test.mjs`.
- `PERF_BUCKETS` — the five coarse, map-key-safe duration buckets (`lt500ms` … `over8s`)
- `bucketDuration(ms)` — ms → a bucket id, or `null` for a non-finite/negative value (skip the sample)
- `perfSampleKey({version,page,metric,bucket,mode,conn})` / `parsePerfSampleKey(key)` — the pipe-joined Firestore map key and its inverse (sanitises the version's dots → `_`, since a `.` is a Firestore field-path hazard in a map key)
- `SPEED_GROUPS` — the three plain-language bands (`quick`/`ok`/`slow`) the buckets roll up into, with labels + tone, for the Operations "App speed" card
- `summarisePerf(samples, {metric})` — rolls the raw samples into overall + per-page quick/ok/slow band counts (and percentages) for one metric; `perfVerdict(overall, kind?)` — a one-line plain-English verdict + status tone, with `kind: 'pages'|'login'` copy. `loginDurationBucket(t0, now, maxMs?)` — buckets a login-to-usable span from the sign-in marker, null if missing/invalid/stale (`LOGIN_MAX_MS` = 2 min). All pure, tested.

### `auth-identity.js`
Pure account-identity helpers extracted from `firebase-client.js` (v16.50) so they're unit-testable — firebase-client can't be imported in a Node test (it statically imports the Firebase SDK from the gstatic CDN). No imports of its own. `normaliseSurname(fullName)` — the shared surname→Firebase-Auth derivation (everything after the first word, lowercased, non-alpha stripped; the ≥6-char password padding is applied elsewhere) that `getSurname()` in `session.js` delegates to; `nameToEmail(fullName)` — the synthetic account email `initial.surname@myb-roster.local` (IDENTITY-CRITICAL: a silent regression could collapse two members onto one account). `firebase-client.js` re-exports both so existing importers (session.js) are unaffected. A deliberate duplicate of the surname core lives in `functions/roster-parse-helpers.js` (CommonJS can't import a browser ES module); `surname-parity.test.mjs` reads THIS file for its source-equivalence check. **Chosen-password support (v18.63, PASSWORD_PLAN.md):** `surnamePassword(fullName)` — the full surname *default password* (normaliseSurname padded to ≥6 chars), the single source both `session.js` and the sign-in candidate ladder use; `credentialCandidatesFor(fullName, typed)` — the ordered list of passwords sign-in should try: the raw typed value first, and (only when the typed value normalises to exactly the member's surname) the surname default as a fallback, so a member still on the default can type their surname in any case/spacing and a member with a self-set password isn't offered the surname when they typed something else. Pure, no I/O. Tested by `auth-identity.test.mjs`.

### `storage-utils.js`
Pure Storage helpers extracted from `firebase-client.js` (v16.32) so they're unit-testable — firebase-client can't be imported in a Node test because it statically imports the Firebase SDK from the gstatic CDN. No imports of its own. `isSafeStorageUrl(url)` — the download-URL allowlist (a SECURITY control: HTTPS + a firebasestorage/GCS host under one of THIS project's buckets, trailing-slash-anchored so a look-alike bucket can't match) guarding every Huddle/Circular/Newsletter open button; `isDocxUpload(file)` — upload file-type detect (extension OR the docx MIME, matching the accept predicates); `officeViewerUrl(storageUrl)` (v16.45) — wraps a download URL in Microsoft's Office Online full-page viewer (`view.aspx`) so a Word (.docx) circular/newsletter OPENS and renders with images instead of downloading (a browser can't display a raw .docx); `sixMonthCutoffISO(now)` (v16.50) — the month-underflow-safe "YYYY-MM-DD" retention cutoff 6 months before `now`, clamping a month-end day the target month lacks (31 Aug → 28 Feb, not 3 Mar) so `_pruneOldDocs` can't prematurely delete circulars/newsletters. `firebase-client.js` re-exports `isSafeStorageUrl` + `officeViewerUrl` so existing importers are unaffected and uses `isDocxUpload` + `sixMonthCutoffISO` internally. Tested by `storage-utils.test.mjs`.

### `client-errors.js`
Pure error-log ordering and retention logic — no DOM, no Firebase. Imported by `firebase-client.js` only.
- `CLIENT_ERROR_RETENTION_MS` — 90-day retention window constant (measured from resolution, not error time)
- `isResolvedErrorExpired(rec, now, [retentionMs])` — true if a resolved record is past the retention window; records with no `resolvedAt` are never expired
- `expiredResolvedIds(resolved, now, [retentionMs])` — IDs of resolved records that should be pruned
- `orderClientErrors(unresolved, resolved, now, [opts])` — ordered list for the Error Log card: all unresolved first (newest-first), then up to `resolvedLimit` (default 30) recent resolved records. Unresolved records are always prioritised — within expected operational volume (< 100 unresolved at once) resolved backlogs cannot displace them.
- `capUnresolvedErrors(fetchedUnresolved, cap)` → `{ shown, truncated }` (v18.28) — the over-fetch→display split extracted from `getClientErrors`: fetch `cap + 1`, show the first `cap`, `truncated` only when the extra row came back (no-silent-caps)
- Tested by `client-errors.test.mjs` (no mocks, runs in `test:hygiene`)

### `claim-retry.js`
Pure stale-claim self-heal runner — no DOM, no Firebase. Imported by `firebase-client.js` only (v18.28). Extracted so the security-critical write-retry decision is unit-testable in Node (firebase-client.js can't load in a test — it pulls the gstatic SDK).
- `isClaimRetryable(err, retryCode, hasUser)` — true iff `err.code === retryCode` AND a user is present
- `runWithClaimRetry(fn, { retryCode, hasUser, refresh })` — run `fn`; on a retryable stale-claim rejection with a user, force `refresh()` then retry ONCE; a failed refresh re-throws the ORIGINAL error (never masks an auth denial with a connectivity error); at most one retry. `fn` must build a fresh WriteBatch each call. `firebase-client.js`'s `withClaimRetry` (`permission-denied`) and `_uploadBytesWithClaimRetry` (`storage/unauthorized`) inject the Firebase auth deps.
- Tested by `claim-retry.test.mjs` (no mocks, runs in `test:hygiene`)

### `nav-panel.js`
Shared slide-out navigation panel — imported by all six app pages.
- `initNavPanel({ currentPage, memberName, onSignOut, isAdmin, isLinksDesigner, onLogoClick })` — injects overlay + drawer HTML, wires burger button, manages open/close. `memberName` displays in footer; `onSignOut` callback wires the Sign out button (omit both to hide footer).
  - **Double-init guard:** checks `burger.dataset.navPanelInit` at the top — returns early if already initialised. Safe to call on every page render.
- `resetNavPanel()` (v15.19) — tears down an initialised panel (removes injected DOM, clone-replaces the burger to drop its listeners, clears the guard + module state) so a later `initNavPanel()` rebuilds it with a fresh identity. Used on admin's in-place B1-teardown path, where the drawer was optimistically wired with a stale identity before the session was cleared and re-entered as a different user.
  - `isAdmin: true` enables the Operations pill (hidden from non-admins). `isLinksDesigner: true` enables the Links pill.
  - `onLogoClick` — called when the drawer brand button is tapped; each page passes `() => openAboutLightbox?.()` to open the About lightbox.
- `NAV_PAGES` — page navigation destinations (Calendar / Admin / Pay / Operations / Links); admin-only and links-designer-only pills filtered by flags. Current page omitted from the pill row.
- `NAV_INFORMATION` — flat always-open Information section: Workplace (Daily Huddle, Weekly Retail Circular, Marylebone Newsletter, App Notices). An entry with `comingSoon: true` (instead of `url`) renders as a `<button>` that opens the injected `#navComingSoonLightbox` placeholder. Separate from `NAV_PAGES` pills and the `NAV_GUIDES` collapsed submenu (Staff Guide, Pay Guide, Railcard Guide, FIP Guide — toggled by `#navGuidesToggle`, v11.21).
- `archiveNotice({ id, title, section, date, body })` — writes a dismissed notice to `localStorage('myb_app_notices')`, deduped by `id`. Entries older than 180 days are pruned automatically on each write. Call in `onClose` (close-only notices) or `onOpen` (notices with a CTA, since the user may navigate away before closing).
- `isNoticeExpired(dateStr, days = 28)` — returns `true` if the notice's posting date ("D Mon YYYY") is older than `days`. Two standard windows: **28 days** (short — time-bound prompts) and **90 days** (long — tax-year/seasonal notices). Use to silently skip stale notices on a new device: `if (isNoticeExpired(DATE)) { ... }` or `if (isNoticeExpired(DATE, 90)) { ... }`.
- Sign-out footer (v10.59): shown only when `onSignOut` is supplied. Each page passes its own sign-out logic as a callback — nav-panel.js only calls it.
- Notification bell (v10.61; compact icon form re-affirmed v16.75): a compact 🔔/🔕 icon button (`.nav-panel-bell`) in the footer row next to Sign out, rendered only when signed in AND `notifSupported()` (from `notif.js`) is true. Refreshes on every panel open via `peekNotifState()` (read-only — no Firestore write per open, v11.49); tap toggles via `enable/disableNotifications()` and keeps the panel open (a 🔄 glyph while resolving/toggling). `denied` is a no-op tap whose state is carried by the aria-label. A labelled full-width row was tried and reverted twice (v13.19, v16.75) — the settings.html Notifications card is the canonical surface. This file owns only the bell UI — all push logic is in `notif.js`.
- Initials badge (v12.22): 26px circle (`#navPanelAvatar`) before the member name in the footer. Painted with `avatarInitials(memberName)` and `avatarHue(memberName)` from `roster-data.js` — no fetch, no cache, no event listeners. Profile photo feature removed at v12.22; spec in ROADMAP.md.
- **`_docFetching` tap-guard (v13.63):** module-level `let _docFetching = false` prevents a duplicate concurrent Firestore fetch if the Weekly Retail Circular or Marylebone Newsletter link is tapped repeatedly before the first response arrives; set to `true` at the start of each fetch, reset to `false` in `.finally()`. `_openLatestDoc` opens the latest doc in a new tab: a PDF by its own URL, a Word (.docx) doc via `officeViewerUrl` (Office Online viewer) so it renders with images instead of downloading (v16.45).
- Android back-button pattern: pushes `{ mybNavPanel: true }` history state on open; closes on popstate. `closePanelForNavigation()` (visual-only, no `history.back()`) is used for link/sign-out clicks to avoid racing hash navigation.
- **Focus trap (v10.69):** a `document` keydown listener (active only while `_panelOpen`) cycles Tab/Shift+Tab within the panel's focusable elements. Escape closes the panel.
- **Coming-soon lightbox (v10.69):** `_csReturnFocus` captures `document.activeElement` before opening; restores focus after the close transition completes. Keydown listener (`_onComingSoonKey`) is always removed at the start of `_closeComingSoon()` — not inside `transitionend` — so it never leaks even if the transition is skipped.
- **`transitionend` fallback in `_closeComingSoon()` (v10.74):** A `setTimeout(done, 400)` fires alongside the `transitionend` listener. Whichever fires first calls `done()` and clears the other — prevents body scroll staying locked on iOS or when `prefers-reduced-motion` suppresses the CSS transition entirely.
- Adding a new guide = one `links` entry in `NAV_INFORMATION`. No other changes needed.

### `notif.js`
Shared Web Push module — single source of truth for the VAPID key and subscription lifecycle. Imported by `nav-panel.js`.
- `notifSupported()` — feature detection incl. the iOS "must be a Home Screen PWA" rule
- `isIOS()` — iOS/iPadOS detection (incl. iPadOS reporting as MacIntel + touch); exported for callers that need the platform signal alone
- `getNotifState()` — async → `'on'|'off-default'|'off-lapsed'|'denied'|'unsupported'`; **also** does the silent VAPID-rotation re-subscribe + Firestore save (side effects). Called once on app load from `calendar-app.js`.
- `peekNotifState()` — async, same return values but **read-only** (no Firestore write, no migration). Use for UI that re-reads often — the nav-panel bell uses this so opening the drawer doesn't write to Firestore (v11.49).
- `enableNotifications()` — async; subscribe + Firestore save → returns `Promise<'on'|'off-default'|'off-lapsed'|'denied'|'unsupported'>`
- `disableNotifications()` — async; unsubscribe + Firestore delete
- Imports `savePushSubscription`/`deletePushSubscription` from `firebase-client.js`, `lsGet`/`lsSet` from `ls.js`
- `calendar-app.js` and `huddle.js` both import from `notif.js` (v10.79). VAPID key and subscribe/unsubscribe logic live in one place — if you change them, change only `notif.js`.

### `override-utils.js`
Override priority, member-start, and shift-classification helpers — shared by `calendar-app.js`, `calendar-team-view.js`, and admin modules.
- `tsToMillis(ts)` — converts Firestore Timestamp or `{seconds}` object to milliseconds
- `shouldReplaceOverride(existing, incoming)` — priority logic: manual beats import; newer wins within same class
- `reconcileRangeIntoCache(cache, records, startStr, endStr)` (v16.96) — the **authoritative** date-range refresh used by BOTH override fetch paths (`fetchOverridesForRange` in calendar-overrides.js and `fetchTeamWeekOverrides` in calendar-team-view.js). A range query is the single source of truth for its dates, so it rebuilds each in-range key's winner from the SNAPSHOT RECORDS ALONE (deduped by `shouldReplaceOverride`), evicts in-range keys the snapshot omits (genuine deletes), and stores each fresh winner — never merging against the possibly-stale cache. Returns whether any in-range slot's DISPLAY changed (added/removed/type/value/note), which team-view uses to gate its re-render. Replaced `foldOverrideIntoCache` (v16.96): the per-doc merge kept a deleted higher-priority manual alive when only a lower-priority import remained (the import couldn't out-rank the cached manual, yet the key was "seen" so the deletion pass skipped it — the v16.95 review's Finding #1). Pure; tested by `override-utils.test.mjs`.
- `collectOverrideRecords(snapshot)` (v17.13) — the SINGLE collector both cache feeders use to turn a Firestore range-query snapshot into `reconcileRangeIntoCache`'s `records` array (validate `memberName`/`date`/`value`, map through `toOverrideRecord`). Previously inlined in BOTH `fetchOverridesForRange` (calendar-overrides.js) and `fetchTeamWeekOverrides` (calendar-team-view.js), so the required-field validation could drift. Malformed docs are skipped and only the doc **id** is logged (never the doc body — it can carry a member name / free-text note). Tested by `override-utils.test.mjs`.
- `isBeforeMemberStart(member, date)` — returns true if `date` is before the member's `startDate`; used to suppress overrides before a member joined. Always call this — never inline the date comparison.
- `isRestShift(shift)` — returns true if the shift is `'RD'` or `'OFF'`. Use everywhere instead of repeating the two-value check. Imported by `admin-al.js`, `admin-sick.js`, `admin-overrides.js`, `admin-app.js`.
- `isOverrideDisplaySuppressed(override, baseShift, sunday)` (v16.37) — **SINGLE SOURCE** for the calendar display-suppression rule (CLAUDE.md "Sundays are non-contracted", layer 5): true when an override must NOT replace the base shift (a `sick` on a rest-day/Sunday base; `annual_leave`/`other` on a Sunday). Called by `resolveEffectiveShift` (below); also takes `sunday` as a boolean (callers pass `isSunday(dateStr)`) to avoid a roster-data import cycle. Tested by `override-utils.test.mjs`.
- `resolveEffectiveShift(override, baseShift, sunday)` (v16.48) — **SINGLE SOURCE** for the whole "apply a Firestore override onto the base shift" display ladder, returning `{ shift, rdwTime, derivedRdw, note }`. Extracted so the THREE consumers that each re-implemented it — `calendar-renderer.js` (month grid), `calendar-team-view.js` (`getTeamCellDisplay`), and `getShiftTypesInMonth` (calendar-overrides.js month legend) — render from one resolution and can never disagree (they drifted once: the Sunday-AL bug fixed v16.37 only extracted the suppression *predicate*, not the ladder). `shift` = base when there's no/suppressed override, `'RDW'` for an rdw override (its time in `rdwTime`, replacing the old team-view `'RDW|time'` string form), the raw Other grammar value for a parseable `other`, else `override.value`. `derivedRdw`/`rdwTime` carry the Other-day hours-slot logic (actual time → 'RDW' → base shift time → ''). Pure (no DOM/Firestore/roster lookup); caller passes the already-fetched override (or `null` before member start). Tested by `override-utils.test.mjs`.
- `computePeriodDeleteIds(allOverrides, { type, memberName, start, end })` (v14.24) — returns the override doc IDs to delete when re-saving an AL/absence range, including overlapping Sunday `correction/RD` overrides, so a re-save can't leave a stale Sunday correction behind. Pure; used by the admin save paths.
- `mergeBookedPeriods(dateList, isRestGap, addDay)` — folds a sorted AL/absence date list into contiguous booked periods, bridging rest-day gaps via the injected `isRestGap`; used by `admin-app.js` for the booked-periods display.
- `buildOverrideWrite(f, createdAt)` / `buildOverrideCacheRecord(id, f, createdAt)` — the paired override write-shape + cache-record builders (one field-shape source for Firestore batch writes and the in-memory cache); used by `admin-overrides.js` and `admin-roster-upload.js` save paths.
- **"Other" family (v15.34; renamed from training→other v15.40, Team Day added v15.51, Union course added v18.56, Meeting added v18.61, OTHER_PLAN.md — flavours Training/Induction/Assessment/Team Day/Union/Meeting):** `OTHER_FLAVOURS` (TRG/IND/ASSESS/TEAM/UNION/MEET → badge word `Train`/`Ind`/`Assess`/`Team`/`Union`/`Meet` + full word `Training`/`Induction`/`Assessment`/`Team Day`/`Union`/`Meeting`; the roster's multi-word "Team Day" and "Union course" labels + the "MTG" meeting code collapse to the `TEAM`/`UNION`/`MEET` sentinels in the parser), `OTHER_RDW_DEFAULT_MINS` (480 — the 8h rest-day default (family-wide)), `isOtherValue(v)` / `parseOtherValue(v)` (the value grammar `FLAVOUR[" RDW"][" HH:MM-HH:MM"]` — client single source; a deliberate recognition-grammar duplicate lives in `functions/roster-parse-helpers.js`), and `resolveOtherPay(parsed, baseValue)` — THE pay mapping in one place: `{mode:'rdw', mins}` (explicit RDW flag or rest-day base; actual times or the 8h default) | `{mode:'timed', time}` (rostered day with actual times — engine applies the base-cap + excess→OT split) | `{mode:'as-base'}` (pay exactly as the base shift). Display deliberately does NOT resolve — it shows the 🏷️ badge (leaf-green family).
- Covered by `override-utils.test.mjs`

### `railcard-guide.js`
Interactive behaviours for `railcard-guide.html` (extracted v10.84 — CSP compliance).
- Print / Save as PDF button (`#savePdfBtn`)
- Chip-bar click navigation (smooth scroll to target section)
- Offset calculation runs after `document.fonts.ready` (v12.58; falls back to `requestAnimationFrame`) so the sticky `.page-header` height is measured with Inter applied — sets `.chip-bar` `top` to match it, then `scrollMarginTop` on every `.rc` and `.section` so sticky bars don't overlap anchored content

### `fip.js`
Interactive behaviour for `fip.html` (v16.59 — CSP compliance; plain `defer` script, no modules).
- Opens the target country `<details>` when navigated to, so a jump link / deep link lands on an **open** section instead of a collapsed one (C1). Native `<details>` with the `id` on the element itself don't auto-expand on anchor-scroll.
- `openHashTarget()` on first load (deep link) and on every `hashchange`; a `.country-jump` click handler also covers re-tapping the already-current country (which fires no `hashchange`). All idempotent.

### `guide-print.js`
Shared print button handler for `guide.html` and `paycalc-guide.html` (extracted v10.84 — CSP compliance).
- Wires `click → window.print()` on `.btn-print` in whichever guide page loads it
- No modules; plain script with `defer`

### `ls.js`
Safe localStorage wrappers for all app pages (iOS Safari private mode compatibility).
- `lsGet(k)`, `lsSet(k, v)`, `lsDel(k)` — wrap every `localStorage` call in try/catch
- `lsKeys()` — snapshot of all key names via the `length`/`key(i)` enumeration (safe to delete while iterating); returns `[]` when storage is unavailable (v14.11)
- On the first failure, emits a single `console.warn` (visible in DevTools) — subsequent failures are silent
- **Never call `localStorage` directly** in `calendar-app.js`, `admin-app.js`, or `paycalc-app.js` — always use these wrappers

### `storage-keys.js`
Single source for the CROSS-FILE localStorage key names (v16.81) — a shared key must have ONE spelling.
- `SELECTED_MEMBER` (`myb_roster_selected_member`) + `SELECTED_MEMBER_LEGACY` (`adminLastMember`, the pre-rename alias still read as a fallback) — shared by `calendar-member.js` and `admin-app.js`
- `VIEWED_MONTH` / `VIEWED_YEAR` — shared by `calendar-state.js` and `admin-app.js` (the "open calendar on the month I was editing" hand-off)
- Per-module and paycalc-namespaced keys deliberately stay local to their modules — only keys read by MORE THAN ONE file live here.

### `firestore.rules`
Server-side Firestore security rules — deployed via `firebase deploy --only firestore:rules`.
- `overrides` create/update: **per-member isolation (B3 strict 3-tier, shipped v16.29; was B2 permissive, v14.53)** — `request.auth.token.name == request.resource.data.memberName || token.admin == true || token.manager == true`. The legacy/anonymous `!('name' in token)` no-name escape branch has been **removed** in B3, so a token with no `name` claim can no longer write; stale tokens self-heal via `writeWithClaimRetry` (`CONFIG.CLAIM_EPOCH = 2`). Required fields: `date`, `memberName`, `type`, `value`, `note`, `source`; `date` bounded to a real `YYYY-MM-DD` (month 01-12, day 01-31); `source` must be `'manual'` or `'roster_import'`; type↔value consistency enforced (timed types `shift`/`rdw` require `HH:MM-HH:MM`; `spare_shift` → `'SPARE'`; `annual_leave` → `'AL'`; `correction` → `'RD'`; `sick` → `'SICK'`). History (the v10.72→v10.94 outage): KNOWN_LIMITATIONS.md task #2.
- `overrides` delete: same **strict 3-tier** check (no no-name escape, v16.29) against the existing doc's `memberName` (was any authenticated user before v14.53).
- Custom claims set by `setupRosterAuth`: `{ admin: true, name }` for the admin list (`CONFIG.ADMIN_NAMES = ['G. Miller']`), `{ manager: true, name }` for the manager list (`CONFIG.MANAGER_NAMES`), `{ name }` for everyone else. **B4 (v16.30): these lists are SERVER-OWNED** — read from `roster-members.json` (generated from `roster-data.js`), NOT the client payload, so a tampered request can't self-promote a tier (admin outranks manager; `setCustomUserClaims` replaces all claims so a demoted member loses the elevated claim on the next run). The admin bypass is essential for roster upload (writes overrides for all members); the manager bypass lets managers edit staff data on behalf without master-admin powers.
- `huddles` read: open (`allow read;`) — `calendar-app.js` (index.html) reads huddles without a Firebase Auth session; requiring auth broke notification auto-open on fresh first visits (v10.76).
- `huddles` write (Firestore): requires auth + `admin == true`; `hasOnly` enforces no extra fields; `uploadedAt` must be a timestamp; optional `htmlContent` capped at 250 000 chars (v10.83+).
- `staffContact` read: owner (`request.auth.token.name == memberName`, where `memberName` is the document ID) or admin; write: owner or admin, and requires the `name` JWT claim (set by `setupRosterAuth`) so anonymous fallback sessions cannot write (v12.68).
- `pushSubscriptions` create/update: requires auth (`request.auth != null`) + required fields `endpoint`, `keys.p256dh`, `keys.auth`; delete: any authenticated session (`request.auth != null` — no per-owner check; documented as a hardening gap in ROADMAP's deferred backlog).
- `clientErrors` write: any authenticated session; read/update/delete: admin only; shape-validated (v13.31).
- `circulars` / `newsletters` read: open (no auth — `calendar-app.js` has no session, matches Huddle model); write: admin only (v13.58/v13.59).
- `linkDesigns` read: open to any authenticated session. Write: **`token.linksDesigner == true || token.admin == true`** (H2, shipped v16.29), and create/update are **shape-validated** (v17.02, Finding #12): `hasOnly(['name','patterns','updatedAt','updatedBy'])` + `name` string 1–100, `patterns` map, `updatedAt` timestamp, `updatedBy` string ≤100 (delete has no body). The `linksDesigner` claim is set by `setupRosterAuth` from `CONFIG.LINKS_DESIGNERS`; `links-app.js` wraps `linkDesigns` writes in `writeWithClaimRetry` (stale-token self-heal) and saves via an atomic `runTransaction` (v17.02, Finding #13 — closes the co-designer check-then-act clobber; falls back to a queued setDoc offline). Before v16.29 any authenticated identity could write any Links design.

### `storage.rules`
Firebase Storage security rules.
- `huddles/{fileName}` read: requires auth.
- `huddles/{fileName}` write: requires auth + `admin == true` + size < 20 MB + MIME type PDF or DOCX (v10.83). Cloud Function (ingestHuddle) uses Admin SDK — bypasses rules, unaffected. This rule is essential for the manual admin upload path in `huddle.js`.
- `circulars/{fileName}` / `newsletters/{fileName}` read: requires auth (`request.auth != null`), same as huddles — actual file access is via the tokenised bearer download URL, which bypasses these rules. (The open-read "matches Huddle model" applies to the **Firestore** metadata docs, not the Storage files.) Write: requires auth + `admin == true` + size ≤ 20 MB + MIME type PDF or DOCX (v13.58/v13.59; Word .docx allowed since v16.31).
- All other paths: denied.

### `index.css` / `admin.css` / `paycalc.css` / `operations.css` / `settings.css` / `links.css`
Page-specific CSS for each page — extracted from inline `<style>` blocks (index/admin/paycalc at v11.41; operations/settings at v12.01; links arrived with the page at v12.07).
- Edit here for any visual change that is specific to one page
- All are stale-while-revalidate in the service worker (v16.10 — same strategy and freshness lifecycle as their HTML and the app JS)

### `guide-shell.css`
Shared chrome for the four guide pages (`guide.html`, `paycalc-guide.html`, `railcard-guide.html`, `fip.html`) — added v11.48.
- Holds common header/back-button/PDF-button/print rules and defines shared brand palette tokens (`--navy`, `--navy-dark`, `--navy-mid`, `--gold`) in its own `:root` (v11.85) — guide pages no longer define these themselves
- This is the one place to change guide chrome — do not re-inline it into the pages
- NOT the app's `shared.css` (which the guides deliberately don't import) — see CLAUDE.md "Unified guide shell"

### `guide-doc.css`
Shared styles for the two document-style guides (`guide.html`, `paycalc-guide.html`) — loaded between `guide-shell.css` and page CSS in those two pages. NOT linked by `railcard-guide.html` or `fip.html`.
- Two-column print layout, info/warning/tip boxes, numbered steps, data tables, callout banners
- Changes here affect both the Staff & Admin Guide and the Pay Calculator Guide simultaneously; check both in print preview before committing

### `guide.css` / `paycalc-guide.css` / `railcard-guide.css` / `fip.css`
Page-specific CSS for each guide page — extracted from inline `<style>` blocks at v12.04.
- Edit the corresponding file for any visual change specific to that guide page
- All four are stale-while-revalidate in the service worker (v16.10 — same strategy and freshness lifecycle as their HTML and the app JS)
- Linked after `guide-shell.css` in each guide's `<head>`

### `purify.es.mjs`
Self-hosted DOMPurify ES module (v3.4.12) — extracted from CDN at v12.04.
- Imported by `calendar-huddle-viewer.js` for Huddle HTML sanitisation
- To upgrade: `npm pack dompurify@<ver>`, extract `package/dist/purify.es.mjs`, replace this file, update version comment in `calendar-huddle-viewer.js`
- Precached by the service worker (stale-while-revalidate, like all app JS)

### `shared.css`
All CSS shared across all six app pages (index, admin, paycalc, operations, settings, links).
- CSS custom properties (`--primary-blue`, `--accent-gold`, etc.) — **never hardcode hex**
- Typography scale, badge/pill variants, button types
- `touch-only` class — hidden by default, revealed on `@media (pointer: coarse)` (touch devices)
- `@media print` rules — every shift type needs a print rule
- `.app-header` (v10.66): `display: grid; grid-template-columns: 1fr auto 1fr` — true centring regardless of burger/badge width asymmetry. Used by `admin.html` and `paycalc.html` (calendar uses a different `.header`).
- `.app-header-brand` (v10.66): flex wrapper (`display: flex; align-items: center; gap: 10px; justify-content: center`) holding the icon `<img>` and `<h1>`. Lives in the `auto` centre column.
- `.btn-burger` (v10.68): `justify-self: start` — pins burger to the left edge of its `1fr` column in the grid context. Ignored in flex contexts (e.g. the calendar header).
- `.huddle-open-btn` / `.huddle-open-prompt` (v10.71): styles for the in-overlay "📄 Open Huddle" button shown when a notification tap opens a PDF huddle. Defined in `index.html` `<style>` block (not shared.css — huddle viewer is index.html-only).

### `service-worker.js`
- Add any new JS/CSS/HTML file to both `NETWORK_FIRST_FILES` and `CORE_ASSETS`
- Version string must match `APP_VERSION` in `roster-data.js`
- Strategies (v16.10): HTML + JS/CSS stale-while-revalidate from the version-pinned cache (JS/CSS revalidate once per SW lifetime; HTML revalidates via the navigation-preload response; HTML cache-miss → network-first with the 2s cache-fallback race); gstatic Firebase SDK cache-first from `myb-roster-sdk-v{FIREBASE_SDK_VERSION}` (constant must match firebase-client.js — enforced by sw-asset-check.test.mjs); icons/fonts/manifest cache-first
- Update lifecycle: install = skipWaiting only; activate = claim + navigationPreload.enable; warm-up detached, batched 8-way, skip-if-cached, `__precache-complete` marker; old app + SDK caches swept only after a complete warm-up

### `roster-cycle-data.js`
Raw roster cycle arrays only — `weeklyRoster`, `bilingualRoster`, `fixedRoster`, `cesRoster`, `dispatcherRoster`. Imported by `roster-data.js` only. Edit here when the actual cycle patterns change (very rare). Do not import this file directly from app code — always go through `roster-data.js`.

### `functions/index.js`
Five Cloud Functions (Firebase-dependent shell — pure logic lives in `roster-parse-helpers.js`):
- `ingestHuddle` — Power Automate → Firebase Storage + Firestore; sends push fan-out; awaits `pruneOldHuddles()` (3-month retention) before responding
- `onHuddleCreated` — Firestore `onDocumentCreated` trigger; fires the push fan-out for **manual** admin uploads (skips `uploadedBy === 'power-automate'`, which `ingestHuddle` already notified, to avoid double-notifying)
- `parseRosterPDF` — admin upload → Claude AI → parsed shifts JSON
- `setupRosterAuth` — creates Firebase Auth accounts for all roster members; sets custom claims per tier (`{admin,name}` / `{manager,name}` / `{name}` + additive `linksDesigner`; admin outranks manager). **B4 (v16.30): the member + admin/manager/designer lists are SERVER-OWNED** — read from `roster-members.json` (generated from `roster-data.js`, CI-locked), not the request body; the body carries only action flags. Fails closed on empty admin/members config; role-holders are unioned into the processed set so a leaver sweep can never disable one. Leaver removal is dry-run by default (`removeOrphans` previews `orphansToDisable`; `confirmOrphanRemoval` disables + revokes refresh tokens). Re-run after adding a manager/designer so their claim lands
- `sendPayReminderNotification` — scheduled (daily 08:00 London); on pay-cutoff Saturdays pushes a Pay Calculator reminder
- Internal helper `pruneOldHuddles(excludeDate)` — deletes huddle Firestore docs + Storage objects older than `HUDDLE_RETENTION_MONTHS` (3); best-effort, awaited inside `ingestHuddle`

### `functions/roster-parse-helpers.js`
Pure helper functions — no Firebase, no HTTP, no secrets. Fully testable with Node's built-in test runner.
- `normaliseShift(raw)` — AI shift value → canonical app format (time, RDW pipe encoding, keywords)
- `buildWeekDates(weekEnding)` — Saturday ISO date → 7-date array Sun–Sat
- `extractAIJson(text)` — strips preamble/fences from AI response, returns parsed object
- `HEADER_TO_INDEX` — day-name → week-index map (0 = Sunday)
- `headerToDayIndex(header)` (v17.13) — resolves a raw AI header (trim + lowercase + `HEADER_TO_INDEX` lookup with a 3-char fallback) to a 0–6 index or `undefined`. SINGLE source for the three parse layers that resolve headers (`mapColumnHeadersToDates`, `buildSafeEntries`, `applyColumnScanCrossCheck`). Tested by `roster-parse-helpers.test.mjs`.
- `mapColumnHeadersToDates(headers, dates)` — returns `{ columnDates, error }` — validates and maps AI column headers to ISO dates
- `buildSafeEntries(parsedMembers, headers, dates)` — fills missing AI day keys with 'RD', normalises values
- `applySundayScanCorrections(entries, sundayScan, hasSundayCol, dates)` — fixes blank-Sunday misreads (Case A) and RDW stripping (Case B)
- `huddleDayLabel(huddleDate, nowLondon)` — "Today's" / "Tomorrow's" / "Thursday's"
- `isPayCutoffDay(date)` — mirrors isCutoffDate() from roster-data.js
- `nameToEmail(fullName)` / `nameToPassword(fullName)` — Firebase Auth credential derivation
- `fileSignatureMatches(buffer, fileType)` (v14.24) — magic-byte/file-signature check: verifies an uploaded buffer's leading bytes match its declared type (PDF `%PDF`, DOCX ZIP `PK`) before processing, so a mislabelled or hostile upload is rejected early
- Covered by `roster-parse-helpers.test.mjs`

---

## What NOT to do

| Temptation | Why not |
|-----------|---------|
| Read `roster.data[week][day]` directly | Bypasses `startDate` suppression and Christmas rules. Always use `getBaseShift()`. |
| Add DOM access to `paycalc-calc.js` | It must stay importable by the Node test runner. |
| Add DOM access to `paycalc-roster-suggestions.js` | It must stay free of circular deps with `paycalc-app.js`. |
| Hardcode hex colours | Use CSS variables — every colour lives in `:root` in `shared.css`. |
| Import Firebase in `paycalc-calc.js` | Same reason as above — test-runner compatibility. |
| Use `alert()` | Use `console.error()` for dev errors; never show raw errors to staff. |
| Skip the version bump | Browsers will serve stale JS. Bump all places listed in `CLAUDE.md`. |

---

## Version bump checklist

See `CLAUDE.md` → "Version bumping (MANDATORY on every change)". 2 runtime locations (roster-data.js APP_VERSION + service-worker.js const; the 7 comment stamps were dropped v16.81); authoritative source is `APP_VERSION` in `roster-data.js`.
