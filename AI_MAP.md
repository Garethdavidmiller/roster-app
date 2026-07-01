# AI_MAP.md — Claude routing guide for MYB Roster

*Last updated: July 2026 — v15.10 · Updated every 0.10 version*

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
| Override priority, member-start, rest-shift helpers — tsToMillis, shouldReplaceOverride, isBeforeMemberStart, isRestShift, computePeriodDeleteIds | `override-utils.js` |
| Body scroll lock, overlay history, focus trap, lightbox lifecycle, card collapse (lockBodyScroll, trapFocus, createLightbox, initCardCollapse, etc.) | `overlay.js` |
| About panel content (version, update status, bug link, print button) | `about-lightbox.js` |
| Per-card ? tips lightbox lifecycle/renderer (content data stays per page) | `tips-lightbox.js` |
| Service worker registration + update lifecycle (all six app pages) | `sw-register.js` |
| Auth/session helpers (AUTH_KEY, getSession, saveSession, clearSession, ensureFirebaseSession) | `session.js` |
| Admin portal UI, login, AL, sick, overrides, module wiring | `admin-app.js` + `admin.html` |
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
| Push notifications, Huddle ingest, auth setup | `functions/index.js` |
| Railcard at-work reference — cards, GroupSave, season tickets, gateline checks | `railcard-guide.html` + `railcard-guide.js` + `railcard-guide.css` |
| Print button for guide.html and paycalc-guide.html | `guide-print.js` |
| Shared guide chrome — header, back/PDF buttons, print banner (all 4 guides) | `guide-shell.css` |
| Page-specific styles for guide.html | `guide.css` |
| Page-specific styles for paycalc-guide.html | `paycalc-guide.css` |
| Page-specific styles for fip.html | `fip.css` |
| HTML sanitisation for Huddle viewer (self-hosted) | `purify.es.mjs` |

---

## File responsibilities in plain English

### `roster-data.js`
The single source of truth for all roster data.
- `APP_VERSION` — **always bump here first**
- `teamMembers` array — names, roles, roster types, start dates
- `getBaseShift(member, date)` — **always use this, never read roster.data directly**
- `getBankHolidays(year)` — algorithmic UK bank holiday list
- `getPaydaysAndCutoffs(year)`, `isPayday()`, `isCutoffDate()`
- `parseSmartFloat(str)` — number parse that strips iOS smart hyphens/curly quotes first; single source for paycalc `numVal()` and the HPP rate read in `paycalc-hpp.js`
- `resolveMemberRoster(member, date)` — applies `rosterChanges` (latest `from` ≤ date wins); the basis for `getBaseShift`/`getWeekNumberForDate`. Never special-case rosterType at a call site — go through this.
- `getWeekNumberForDate(member, date)` · `getALEntitlement(member, year)` · `getMembersForGrade(grade)` · `isSunday(dateStr)`
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
- AL lightbox (loadALStats), day-detail lightbox, month-jump picker, About lightbox wiring
- Sync chip state machine (hidden → `↻ Updating…` → silent remove on success / `⚠ Couldn't update` on timeout)
- Initial 3-month Firestore fetch IIFE — calls `setInitialFetchInProgress`, `addFetchedMonths`, `fetchOverridesForRange`
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
- AL lightbox fetches the current member's `annual_leave` overrides from Firestore on open, computes taken/booked/remaining against `getALEntitlement()`; Dispatcher breakdown shown when applicable
- Day-detail lightbox surfaces shift label, extras, and override note on touch devices (mirrors hover tooltip content set by `calendar-renderer.js` as `data-detail-*` attributes)
- Imports: `overlay.js`, `calendar-member.js`, `calendar-state.js`, `firebase-client.js`, `roster-data.js`

### `calendar-initial-fetch.js`
Initial 3-month Firestore fetch and sync-chip UI for `index.html` — extracted from `calendar-app.js` at v13.86.
- `initInitialFetch({ isTeamViewMode, renderCalendar })` — kicks off a 3-month date-range query (prev/cur/next), manages the sync chip state machine (hidden → "↻ Updating…" after 800ms → "⚠ Couldn't update" on 10s timeout), handles retry, and wires the `visibilitychange` guard for iOS background suspension
- Pre-marks all three months as fetched before awaiting to prevent competing per-month fetches from `ensureOverridesCached()` during the initial load
- Imports: `calendar-overrides.js`, `roster-data.js`

### `calendar-keyboard.js`
Keyboard navigation and hover tooltip for `index.html` — extracted from `calendar-app.js` at v13.86.
- `initCalendarTooltip()` — no-op on touch/pointer-coarse devices; creates a single floating `#calTooltip` div, repositions it on `mousemove`; reads `data-tooltip` set per cell by `buildCalendarContainer()`
- `initCalendarKeyboard({ navigateToPaycalc, openDayDetail })` — arrow-key cell navigation (roving tabindex), PageUp/Down month jump, Enter/Space cell activation (payday → paycalc, cutoff → paycalc, other → day-detail lightbox)
- Imports: `calendar-swipe.js` (isSwipeCooldown), `roster-data.js` (getPaydaysAndCutoffs, formatISO)

### `calendar-overrides.js`
Firestore override cache for `index.html` — extracted from `calendar-app.js` at v13.82.
- `rosterOverridesCache` — exported `Map` keyed `"memberName|YYYY-MM-DD"`; imported by `calendar-renderer.js` for cell rendering and by the coordinator
- `fetchOverridesForRange(startStr, endStr)` — Firestore date-range query; populates cache, warns on duplicates, clears `shiftTypesMonthCache`
- `ensureOverridesCached(year, month, renderFn)` — no-op if already fetched; fires background fetch then calls `renderFn()` on success (coordinator provides callback with teamView + member-change guards)
- `getShiftTypesInMonth(member, year, month)` — memoised `Set<string>` of shift types appearing in a month; used by `updateLegend()`
- `monthKey(year, month)` — `"YYYY-MM"` key string for the `fetchedMonths` Set
- `_initialFetchInProgress` — exported live binding; coordinator reads it to skip competing fetches during the initial 3-month load
- `setInitialFetchInProgress(v)`, `addFetchedMonths(keys)`, `clearFetchedMonth(key)` — setters called by the coordinator's initial IIFE

### `calendar-member.js`
Team member selection for `index.html` — extracted from `calendar-app.js` at v13.82.
- `getSelectedMemberIndex()` — resolves saved name → index; sets `_staleMemberName` flag if name no longer in roster; auto-selects from session if no saved preference
- `takeStaleMemberName()` — consume-and-clear accessor for the stale-name flag; called by `renderCalendar()` to show a one-time banner
- `getCurrentMember()` — returns the resolved `teamMembers` entry for the selected index
- `saveSelectedMember(index)` — persists selection by name to localStorage via `lsSet`
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
- Both documents are always PDFs, so the viewer mirrors the Huddle's PDF path: a centred `createLightbox` card showing the feature title + an "Open" button (a real gesture → `window.open`, popup-safe; `isSafeStorageUrl`-guarded). Empty/error states show a short message.
- One-shot fetch (`getLatestCircular`/`getLatestNewsletter`) on open — no persistent subscription (unlike the Huddle, which needs live state for its button). Reached **only from a `#circular`/`#newsletter` notification tap** (no in-page user gesture → must route through the in-app Open button, like the Huddle's PDF path). The ☰ nav-drawer links open the PDF **directly** in a new tab (one tap, `nav-panel.js`) — a notification can't, which is the whole reason this viewer exists (v14.57).

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
- Shared session: uses `AUTH_KEY = 'myb_admin_session'` (same key as `admin-app.js`) — a user signed in on admin.html arrives at settings.html without re-authenticating
- Session check at module top: if authenticated → `ensureFirebaseSession(name)` in background + `initApp()`; else → `initLoginOverlay()`
- `initLoginOverlay()` — same grade/name/password flow as admin; on success calls `saveSession()` + `location.reload()`
- `initApp()` — calls `initNavPanel`, collapsible card wiring, `initHuddleNotifications()`, work email card init, tips/icon lightboxes, SW registration

### `overlay.js`
Shared overlay helpers — singleton module, imported by every page that shows a modal overlay (v11.40).
- `lockBodyScroll()` / `unlockBodyScroll()` — freezes body scroll position when an overlay opens; restores on close. Handles iOS Safari bounce-scroll.

**Canonical `.lb-overlay` lightbox lifecycle (standardised v11.50, factored into `createLightbox` v12.50)** — when adding any lightbox, call `createLightbox(...)`; do NOT hand-write the open/close shape in a page module. Exceptions: `#navComingSoonLightbox` (owned by nav-panel.js, shares the drawer's history entry) and `#huddleViewer` (full-bleed panel, not a lightbox). Full rationale in CLAUDE.md → "Canonical lightbox lifecycle".
- `createLightbox({ overlay, content, closeBtn, initialFocus, onOpen, onClose })` — returns `{ open, close }`. Implements focus save/restore, `.visible` → rAF `.open` + focus, scroll lock, Android Back, Escape, and the Tab focus trap. Backdrop and closeBtn click-to-close are wired automatically (v12.50).
- `_pushOverlayState(closeHandler)` / `_clearOverlayHistory()` — Android back-button support: pushes `{ mybOverlay: true }` history state on overlay open; registers `closeHandler` to fire on `popstate`. Module-level `popstate` listener is registered once (singleton) — multiple overlays on the same page are safe.
- `trapFocus(container, e)` — call from a lightbox keydown handler; traps Tab/Shift+Tab within the container's focusable elements. No-op if key is not Tab. (createLightbox calls this internally.)
- `dismissOverlay(overlay, { onClose })` — the shared close routine `createLightbox` uses: removes `.open`, restores focus synchronously, then removes `.visible` + `unlockBodyScroll()` on `transitionend` with a mandatory 500ms `setTimeout` fallback (iOS suppresses `transitionend` on a backgrounded tab). Exported for the rare overlay that isn't built via `createLightbox`.
- `initCardCollapse(headerId, bodyId, chevronId, onToggle)` — wires a collapsible card header. Safe to call early; no-op if elements not found.
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
- `initLoginOverlay({ pageLabel, onSuccess })` — call only when NOT signed in. Injects the overlay markup (like `nav-panel.js`), populates the grade dropdown (CEA/CES/Dispatcher/Management) and the name dropdown via `getMembersForGrade`, restores the last-used grade (`myb_login_grade`), checks the surname password locally, runs the client-side 3-strike 30s rate-limit, shows a disabled "Signing in…" button, then delegates the auth decision to `runNamedSignIn`. On `{ ok: true }` it shows a brief "Signed in — opening {pageLabel}…" confirmation then calls `onSuccess(name)` (typically `() => location.reload()`); on `{ ok: false }` it restores the button and shows the returned error.
- **Login latency/UX (v14.79–80):** calls `primeAuth()` (session.js) on mount to pre-warm Firebase Auth while the user types; while a sign-in is genuinely in flight it disables the "← Back to roster" link (`_signingIn` flag → `preventDefault` + `.login-back--busy`, cleared in `finally`) so a mid-submit tap can't re-open the half-signed-in escape route the v14.75 fix closed; and a `#loginStatus` line escalates ("Checking your sign-in…" → at 1.5s "Still checking your secure session…" → at 4s "Still working — … app update or … weak signal.") so a multi-second wait reads as progress, not a freeze. Timers cleared on settle.
- `runNamedSignIn(deps)` — the **DOM-free, exported, tested** sign-in core (`login-overlay.test.mjs`). Time-boxes `ensureNamedSession` (8s `withTimeout`) and commits the local session (`saveSession`) **ONLY after auth genuinely resolves** — on timeout/throw, or enforce-on + not-named, it writes NO session, `clearSession()`s, and returns a transient/persistent error message. This is the v14.75 fix for the "half signed-in"/login-freeze class (saving the session before auth completed let the app honour a session the overlay never finished). See LOGIN_INCIDENT.md.
- Per-page ACCESS control (admin-only Operations, designer-only Links) stays in each coordinator, applied after sign-in — the overlay itself lists every grade.
- `dismissLoginOverlay()` — **in-place sign-in (Phase 9, v14.81–83).** Removes the `#loginOverlay` element + `unlockBodyScroll()`; no-op when no overlay is mounted (so it is safe to call unconditionally on a coordinator's authorised path). `CONFIG.INPLACE_LOGIN` is a **per-page object** (`{ operations, links, paycalc, admin, settings }`, all default false) — each coordinator reads ONLY its own key, so the rollout has a small blast radius (enable one page at a time). When a page's key is **on**, it initialises in place instead of `reload()`: the init()-wrapped ones (operations/links/paycalc) pass `onSuccess: () => init()` (the authorised body never ran on the login pass, so re-entering runs it exactly once); the branch-style ones (admin/settings) extract their signed-in body into an `initAuthorised()` that refreshes the now-`let` identity vars from the just-saved session, calls `dismissLoginOverlay()`, runs the body, and wires the nav (deferred past sign-in so it renders once with the signed-in identity — no `refreshNavIdentity` needed). All skip `resolveSession(false)` on the in-place login pass so the one-shot `sessionReady` isn't poisoned, and fall back to `reload()` if init throws. Key **off** (default) = today's reload, unchanged. Not the B1 risk class — it only changes post-sign-in rendering, never whether auth succeeds. See ARCHITECTURE_PLAN.md → "Phase 9".
- Imported by `admin-app.js`, `settings-app.js`, `operations-app.js`, `links-app.js`, `paycalc-app.js`.

### `sw-register.js`
Shared service worker registration + update lifecycle (v12.28). All six app pages import this instead of duplicating the register/activate/reload pattern.
- `registerServiceWorker({ beforeReload, bfcache })` — registers `./service-worker.js`, activates any waiting worker immediately, sets up an hourly update-check via `visibilitychange`. On `controllerchange`, calls `beforeReload()` if provided, otherwise `window.location.reload()`. `bfcache: true` adds `pagehide`/`pageshow` handlers (used by `calendar-app.js` only).
- Per-page variants: `calendar-app.js` — 500ms reload delay + bfcache; `admin-app.js` — defers reload if `hasUnsavedChanges()`; `links-app.js` — shows `confirm()` if the design is dirty; others — plain reload.

### `session.js`
Shared auth/session module — canonical source for session logic (v11.40).
- Constants: `AUTH_KEY`, `SESSION_MS` (30 days absolute), `IDLE_MS` (7 days inactivity), `SESSION_VER`
- `getSurname(name)` — derives Firebase Auth password from display name
- `getSession()` / `saveSession(name)` / `clearSession()` — session object accessors. **Passive expiry** (the absolute-expiry / version-stale / idle branches of `getSession()`) only clears the localStorage key — it does **NOT** sign Firebase out, because `getSession()` runs synchronously at module eval on the calendar and an async signout would race `calendarAuthReady`'s `currentUser` check (v14.34). **`clearSession()`** is the explicit user-logout path and DOES call `firebaseSignOut(auth)`, so local and Firebase state align on a deliberate logout.
- `ensureFirebaseSession(name)` — re-establishes Firebase Auth on every page load; waits for `onAuthStateChanged`, signs in if no existing session, self-heals a missing account via `createUserWithEmailAndPassword`, else falls back to an anonymous session. Returns `Promise<boolean>` (true if any session is active). Called only by the write pages — the calendar uses its own anonymous `calendarAuthReady` bootstrap. **B1.1 (v14.40; now ENABLED, v14.98):** the self-heal create and the anonymous fallback are gated behind `CONFIG.ENFORCE_NAMED_SESSION`, which is now **on**. With it on (the current state) neither runs, and a failed named sign-in returns `false`/`'none'` so the page can prompt a re-login. Flipping the flag back to **false** restores the old self-heal/anonymous-fallback behaviour — the one-line kill-switch. See SECURITY_RELEASE_PLAN.md → "Appendix: B1 detailed scope".
- `primeAuth()` — **login latency pre-warm (v14.80).** Called once when the login overlay mounts. Kicks off `authReady` + the first `onAuthStateChanged` restore in the background and caches that promise; `ensureFirebaseSession` consumes it **once** instead of starting the restore itself, so the IndexedDB restore overlaps the user's typing and the sign-in click pays only for the network sign-in. Best-effort, idempotent, side-effect-free — on failure or when not primed (e.g. tests) `ensureFirebaseSession` does a fresh restore, so there is **no** behaviour or security change, only latency overlap.
- `getFirebaseIdentity()` → `'named' | 'anonymous' | 'none'` · `firebaseSessionIsNamed()` → boolean · `getFirebaseAuthError()` → error code. **B0** (SECURITY_RELEASE_PLAN.md): expose whether `ensureFirebaseSession` established the member's own named account or only the anonymous fallback. `firebaseSessionIsNamed()` is the signal per-member write isolation (B2) will depend on — the anonymous fallback satisfies `request.auth != null` today but carries no `name` claim. **Observability only — no behaviour change in B0.** (v14.39)
- `ensureNamedSession(name, opts?)` → `Promise<boolean>` · `isTransientAuthError(code)` → boolean. **B1.2** (v14.41; now ENABLED, v14.98): the write pages call `ensureNamedSession` instead of `ensureFirebaseSession`. With `CONFIG.ENFORCE_NAMED_SESSION` **on** (the current state), a failed named sign-in is retried a couple of times only for transient (connectivity) errors, then returns whether the member's own named session is active — admin/settings re-show the login overlay, operations/links clear + redirect to admin, paycalc soft-logs (never blocks). Flipping the flag **off** makes it return `ensureFirebaseSession`'s result unchanged (anonymous fallback counts) — identical-to-legacy behaviour, the kill-switch. See SECURITY_RELEASE_PLAN.md → "Appendix: B1 detailed scope".
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
The auth STORE — `ARCHITECTURE_PLAN.md` Track 1, **Phase 2** (v14.59). Holds the single identity state (reduced by `auth-state-core.js`) and exposes `getAuthSnapshot()`, `subscribeAuth(listener)` (immediate call + on-change; listener errors isolated), `dispatchAuth(event)`, and `_resetAuthState()` (test-only). Imports **only** `auth-state-core.js` — NOT `session.js` or `firebase-client.js` — so the graph stays acyclic (`session.js → auth-state.js → auth-state-core.js`).
- **The shell-adapter role is fulfilled by the existing `session.js`**, which FEEDS this store (reusing the proven auth path rather than re-wrapping Firebase). `ensureNamedSession` dispatches `RESOLVE_START` → (retry: `TRANSIENT`/`RETRY`) → a terminal `NAMED`/`ANONYMOUS`/`NONE`/`FATAL` from the B0 signals; `clearSession` dispatches `SIGN_OUT`. Every feed is wrapped (`_feedAuth`) so a store error can never break auth.
- **Phase 2 store + Phase 3 policy are NOW CONSUMED** (since B1 re-enable, v14.98): the 5 write coordinators read the store at init via `getAuthSnapshot()` + `requirePage()` (active when `ENFORCE_NAMED_SESSION` is on). `sessionReady` is still untouched and session.js still owns the Firebase lifecycle; the store + `sessionReady` are both driven by the same `ensureNamedSession` resolution (so they cannot diverge). The full single-owner shell (live subscriptions, `sessionReady` re-routed onto the store) is still future. Bridge tested in `session.test.mjs` ("auth-store bridge (Phase 2)"); store tested in `auth-state.test.mjs`.

### `auth-policy.js`
The page-AUTHORISATION layer — `ARCHITECTURE_PLAN.md` Track 1, **Phase 3** (v14.60). Authentication ("who are you?") is the store; this answers the separate "is this identity allowed on THIS page?". **CLIENT UX only — Firestore Rules + Functions claim checks are the real boundary** (the role check here, name ∈ CONFIG.ADMIN_NAMES/MANAGER_NAMES/LINKS_DESIGNERS, is an optimisation, never enforcement).
- `PAGE_POLICIES` — declarative per-page map, grounded in the coordinators' actual gates: operations = admin-only (managers redirected), links = designer-only, admin/settings = any named user (the admin/manager split gates ACTIONS not page access), paycalc = soft (never blocked), calendar = public/anonymous, guides = open.
- `requirePageAuth(snapshot, policy, roles)` → `{ decision, reason }` — PURE. Decisions: `allow` / `soft-allow` (paycalc local-first) / `login` (terminal no-named: signedOut/anonymous/error) / `forbidden` (named but wrong role) / `pending` (initialising/resolving/degraded — degraded grants no authority but is retryable, so "pending" not "login"). `rolesFor(member)` derives role flags from CONFIG; `requirePage(snapshot, page)` is the coordinator convenience (fails CLOSED on an unknown page). The read-vs-write distinction is an ACTION-level concern for a later phase (the policy keys can grow `page→page.action` without touching the reducer). NOW CONSUMED by the 5 write coordinators (the `requirePage` access gate, active when `ENFORCE_NAMED_SESSION` is on). 42 tests in `auth-policy.test.mjs`.

### `operations-app.js`
Coordinator for `operations.html` (admin-only, v10.99).
- **Exported `init()` wrap (ARCHITECTURE_PLAN.md Phase 4a.2, v14.65):** the whole coordinator body is `export function init()`, called by `operations-boot.js` (the page loads the boot file, not this module directly — CSP `script-src 'self'` blocks an inline call). The former top-level `throw`s on the login/forbidden gate became early `return`s. Importing this module no longer auto-runs it, so a test can drive `init()` with mocked deps. First coordinator to get the wrap.
- **Page-access via the policy layer (ARCHITECTURE_PLAN.md Phase 4a, v14.61):** the access gate routes through `requirePage({ status: currentUser ? 'named' : 'signedOut', member }, 'operations')` from `auth-policy.js` — `login` → overlay, `forbidden` → redirect to `admin.html`, `allow` → proceed — and the B1 enforcement decides via `requirePage(getAuthSnapshot(), 'operations') === 'login'`. **First coordinator to consume the new store + policy.** Behaviour-preserving (the local-derived snapshot keeps today's optimistic render; the existing e2e passes unchanged). Optimistic admin reads (4b, v14.62) wrap the three admin-gated read cards in `adminReadWithRetry()` (force token refresh + retry once on stale-claim `permission-denied`).
- Session guard (legacy description): reads the shared `myb_admin_session` localStorage key via `getSession()` from `session.js`; the redirect/login decision is the `requirePage` outcome above
- Calls `ensureFirebaseSession(name)` from `session.js` to re-establish Firebase Auth on page load
- Calls `initHuddleUpload()`, `initRosterUpload()`, `initAuthSetup()`, `initNavPanel({ isAdmin: true })`; runs `initErrorLog()` IIFE (Error Log card, v13.31)
- Work Email Progress card (v13.30) shows per-grade breakdown (All / CEA / CES / Dispatcher filter) of who has and hasn't added a work email — "Added (N)" green chips + "Still to add (N)" grey chips
- Owns icon lightbox, tips lightbox, and collapsible card wiring for the operations cards

### `operations-boot.js`
2-line bootstrap for `operations.html` (Phase 4a.2, v14.65). Imports `init` from `operations-app.js` and calls it. Exists because CSP `script-src 'self'` blocks an inline `init()` call, and because keeping the call out of the coordinator lets a test `import { init }` without auto-running the page. No logic of its own.

### `links-boot.js`
2-line bootstrap for `links.html` (Phase 4a.2, v14.67). Imports `init` from `links-app.js` and calls it. Same rationale as `operations-boot.js` (CSP + testability). No logic of its own.

### `paycalc-boot.js`
2-line bootstrap for `paycalc.html` (Phase 4a.2, v14.67). Imports `init` from `paycalc-app.js` and calls it. Same rationale as `operations-boot.js` (CSP + testability). No logic of its own.

### `admin-al.js`
Annual Leave Booking section (extracted v9.93).
- `initALSection(deps)` — sets up date picker, preview, entitlement check, and Firestore save. Receives DOM handles and callbacks via `deps` to avoid circular imports.
- `triggerConfirmedALSave()` — called by the confirm bar in `admin-app.js` when the user accepts booking over their AL entitlement; sets internal flag and re-fires the save button.
- Imports `teamMembers`, `getALEntitlement`, `getBaseShift`, `formatISO`, `isSunday`, `escapeHtml` from `roster-data.js`; `getAllOverrides`, `recordRangeOverrides`, `formatDisplay` from `admin-overrides.js`; `buildRangePicker` from `admin-rangepicker.js`.

### `admin-sick.js`
Sick Days Recording section (extracted v9.93).
- `initSickSection(deps)` — sets up date picker, preview, and Firestore save. Receives DOM handles and callbacks via `deps` to avoid circular imports.
- Imports `teamMembers`, `getBaseShift`, `formatISO`, `isSunday`, `escapeHtml` from `roster-data.js`; `getAllOverrides`, `recordRangeOverrides`, `formatDisplay` from `admin-overrides.js`; `buildRangePicker` from `admin-rangepicker.js`. No `lsSet` or `confirmNavigate` needed — the sick section has no member-change handler.

### `admin-overrides.js`
The Change a Shift module. Owns the week grid and override list entirely.
- `TYPES` — type metadata object (label, pill, fixed, fixedValue). `pill` is the short button label used in both the per-row grid and the bulk bar.
- `PILL_TYPES` — ordered array of type keys for both pill lists (`['annual_leave', 'spare_shift', 'shift', 'rdw', 'sick', 'correction']`). Single source of truth — `renderWeekGrid()` generates per-row pills from this; `admin-app.js` generates bulk-bar pills from this at init. Never duplicate the list. (v13.48)
- `initOverrides(opts)` — called once by `admin-app.js` after login; receives callbacks
- `renderWeekGrid()` — generates per-row type pills from `PILL_TYPES`
- `loadOverrides()` / `renderTable()` — Saved Changes list
- `executeSave()` — writes override to Firestore
- `updateSaveBtn()` — exported so swipe carousel can call it
- State accessors: `getAllOverrides()` / `setAllOverrides()` — used by `admin-al.js` and `admin-sick.js`
- `recordRangeOverrides({ type, value, memberName, dates, changedBy })` — shared batch-write helper used by both `admin-al.js` and `admin-sick.js`; filters out Sundays and RD days, writes Sunday RD corrections alongside AL/sick overrides, updates `_allOverrides` cache, and re-renders the week grid and override list
- `formatDisplay(value, type)` — shared shift/override display formatter; imported by `admin-al.js` and `admin-sick.js`
- `getEffectiveShift(member, date, overrides)` / `validateShiftRules(...)` / `buildMemberDateMap(overrides)` — pure shift-resolution + validation helpers, covered by `admin-overrides.test.mjs`
- Also exported (grid/bulk internals reused across the module and by `admin-app.js`): `resetTableMemberFilter()`, `updateWeekNavLabel()`, `buildWeekGridInto(container)`, `resetBulkPills()`

### `admin-rangepicker.js`
Inline date-range calendar widget — extracted from `admin-app.js` at v11.36.
- `buildRangePicker(prefix)` — builds a month grid with from/to selection, chip labels, and swipe navigation between months; returns `{ reset() }`
- `getDateRange(fromVal, toVal)` — pure: inclusive ISO date list for a range; `null` if reversed, `[]` if either input empty (v12.55). Covered by `admin-rangepicker.test.mjs`
- Imports `DAY_NAMES`, `MONTH_ABB`, `MONTH_NAMES`, `formatISO`, `SWIPE_THRESHOLD`, `SWIPE_VELOCITY` from `roster-data.js`
- Imported directly by `admin-al.js` and `admin-sick.js` (no longer goes through `admin-app.js`)

### `huddle.js`
Huddle upload, push notification subscribe/unsubscribe, and Huddle card toggle.
- `initHuddleUpload(opts)` — called by `operations-app.js`; wires Huddle upload card + Huddle collapse toggle (admin-only)
- `initHuddleNotifications()` — called by `settings-app.js`; wires the Notifications card (all staff, settings page)
- Notifications card: VAPID key handling, fingerprint-based re-subscription on key rotation
- Huddle upload: file validation, DOCX conversion via mammoth.js, upload to Firebase Storage via `uploadHuddle`
- Huddle card: collapse/expand toggle

### `admin-auth.js`
Staff Firebase Auth account setup (admin only).
- `initAuthSetup(opts)` — called once by `operations-app.js`
- Wires up the Staff Login Accounts card; calls `setupRosterAuth` Cloud Function
- Sends a fresh Firebase ID token (`getIdTokenResult(true)`) as the bearer token — no client-side secret since v9.88

### `admin-roster-upload.js`
The Weekly Roster Upload pipeline.
- `initRosterUpload(opts)` — called by `operations-app.js` after session guard passes
- `computeCellStates()` — classifies each day: MATCH / DIFF / CONFLICT / COVERED
- `renderReviewTable()` — per-person card list with approve/skip
- `shiftDisplay()`, `shiftValueToOverrideType()` — display and type helpers

### `paycalc-app.js`
Coordinator for `paycalc.html`. No pure pay maths, no period arithmetic here.
- **Exported `init()` wrap (Phase 4a.2, v14.67):** the whole body is `export function init()`, called by `paycalc-boot.js` (the page loads the boot file — CSP blocks an inline call). The local-identity gate (no local session → login overlay) early-`return`s instead of throwing; importing the module no longer auto-runs it.
- **SOFT auth (Phase 7, v14.66):** gate #1 (local-identity precondition) is intentionally NOT routed through `requirePage` — paycalc needs a local member to namespace its localStorage. The Firebase-confirmation path (`_initErrorReporting`) decides via `requirePage(getAuthSnapshot(), 'paycalc')`, which being `soft` returns only `allow`/`soft-allow`, never `login`, so the calculator is never blocked.
- `calculate()` — main calculation engine (calls paycalc-calc.js pure functions)
- `onPeriodChange()` — orchestrates all period-level updates; calls helpers from paycalc-periods.js and paycalc-settings.js
- `autosave()` — saves hours data per period to localStorage
- `_suggestIfBlank()` / `_applyRosterSuggestion()` — roster pre-fill helpers
- HPP card, sticky take-home bar, back-pay card
- `_bpAmount` / `_bpVarAmount` / `_bpPNum` — back pay state (v10.73): `_bpVarAmount` holds the variable-pay portion (overtime, RDW, Sunday, BH, London Allowance uplifts) so `calcHPP()` can include it in the HPP accumulator for the paid-in period
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
- `hasBoxingDay(p)` / `hasBankHoliday(p)` — period content checks
- `CONDITIONAL_ROWS` — data-driven array: `{ condition, rows, fields }` — used by `updateBhRows`
- `updateBhRows(p)` — shows/hides BH input rows based on period content
- `buildPeriodSelect()` — populates the period `<select>`, handles URL params, calls `buildBackPayPeriodSelect()` internally; returns the current earning period number — caller must assign it to `_defaultPeriodNum` first, then call `onPeriodChange()` explicitly
- `buildBackPayPeriodSelect()` — populates back-pay period selectors
- `updateTyTabs()` — highlights the active tax-year tab
- `jumpToTaxYear(tyIndex, onPeriodChange)` / `prevPeriod(onPeriodChange)` / `nextPeriod(onPeriodChange)` — navigation; accept coordinator's `onPeriodChange` callback to avoid circular dependency
- `_setSelectPeriod(sel, pNum)` — internal `<select>` value setter (test-exposed; covered by `paycalc-periods.test.mjs`)
- Imports `P_YR, TAX_YEARS, getTaxYearForOffset` from `paycalc-calc.js`; imports `bhsForYear` from `paycalc-roster-suggestions.js`

### `paycalc-settings.js`
Grade/contracted-hours helpers and settings persistence for `paycalc.html` (v13.80).
- `getGrade()` / `getContr()` — grade key and contracted hours from localStorage; result cached in `_gradeCache`
- `getLoggedMember()` — returns the logged-in member's `teamMembers` entry or null
- `getEffectiveContr(p)` / `getProRateFactor(p)` — pro-rated helpers (full period if `noProRate`)
- `getPensionDefault(pObj)` — period-aware pension default for the current grade
- `updateRateForPeriod(ty)` / `updateYtdForTaxYear(ty)` — load stored rate and YTD figures into form fields; called from coordinator's `onPeriodChange`
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
- `_varPayForPeriod(p, d, rate)` — variable pay for one period (excludes contracted basic and peer pay); used internally by `calcHPP`
- `calcHPP(bpVarAmount, bpPNum)` — renders the HPP estimate card; receives coordinator's back-pay state as parameters to avoid importing coordinator state
- `updatePriorHpp(ty)` — renders the prior-year actual HPP section
- Imports from `paycalc-calc.js`, `paycalc-periods.js`, `paycalc-settings.js`, `paycalc-migrations.js`, `roster-data.js`, `ls.js`

### `paycalc-backpay.js`
Back-pay lump sum calculator for `paycalc.html` (v13.81).
- `_bpAwardTaxYear(fromPNum)` — tax year of the back-pay award (derived from "backdated from" period); exported for coordinator's `applyNewRate()`
- `prefillBackPay()` — pre-fills card inputs (London Allowance defaults, April selector) when the card opens; returns `calcBackPay()` result for coordinator to consume
- `calcBackPay()` — calculates lump sum from card inputs, renders results, returns `{ bpAmount, bpVarAmount, bpPNum }`; does NOT mutate coordinator state — caller applies the returned values
- Imports from `paycalc-calc.js`, `paycalc-periods.js`, `paycalc-settings.js`, `paycalc-migrations.js`, `paycalc-hpp.js`, `paycalc-format.js`, `ls.js`

### `paycalc-format.js`
Pure date/currency formatters shared by `paycalc-app.js` and `paycalc-backpay.js` (v14.06). No DOM, no Firebase.
- `fd(d)` — formats a Date as "1 Apr '26" (day + short month + 2-digit year, Europe/London)
- `fdShort(d)` — formats a Date as "1 Apr" (day + short month only)
- `fmt(n)` — formats a number as a currency string, e.g. "£1,234.56"

### `paycalc-help.js`
Pure data module — help/tooltip text for the pay calculator (v11.40).
- `HELP_CONTENT` object with keys: `hours`, `settings`, `accuracy`, `hpp`, `backpay`
- Imports `TAX_YEARS` from `paycalc-calc.js` for the London Allowance figure in tip text
- No DOM, no Firebase — safe to import anywhere

### `paycalc-migrations.js`
localStorage key constants and data migration logic for the pay calculator (v11.40).
- `SK` — object of top-level localStorage key strings, rebuilt in place when the namespace changes
- `pcPrefix()` — the active per-member key prefix (`myb_pc_` or `myb_pc_<slug>_`); every key builder and `SK` derives from it (v14.11)
- `setPaycalcNamespace(memberName)` — activate the per-member namespace (called from `runMigrations`); falsy name → unnamespaced legacy keys (v14.11)
- `periodKey(pNum)` — key builder for period data (takes period number)
- `hppEstKey(ty)`, `hppActualKey(ty)`, `ytdPayKey(ty)`, `ytdTaxKey(ty)` — key builders that take a tax-year object `ty` (with `.label` property, e.g. `'2025/26'`)
- `runMigrations({ getPeriods, getLoggedMember, getPensionDefault })` — runs all one-time data migrations, then migrates this member's shared data into their namespace and activates it; receives deps as params to avoid circular imports with `paycalc-app.js`
- `_migrateCeaKeys` — internal migration (old CEA keys → grade-neutral format)
- `hasPendingLegacyMigration(name)` / `resolveLegacyMigration(name, 'mine'|'fresh')` — shared-device ownership prompt (v14.25): `runMigrations` only activates the namespace; legacy/shared `myb_pc_*` data is claimed (`'mine'` moves it into the member segment) or discarded (`'fresh'`) only when the member resolves the `paycalc-lightboxes.js` prompt (✕ = decide later). Device-level keys (migration guards, "seen" flags) stay unnamespaced; the `myb_pc_ns_migrated` guard makes the prompt one-shot. Covered by `paycalc-migrations.test.mjs`

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
- `getOverridesFetchState()` — returns the current async-fetch state (`idle`/`loading`/`done`/`error`) for the suggestion UI
- `bhsForYear(year)` — bank-holiday date set for a year; also imported by `paycalc-periods.js`
- `_setOverridesForTest(map)` / `_addBhDateForTest(d)` / `_removeBhDateForTest(d)` — test-only hooks to inject overrides / adjust the BH set without Firestore
- Edit here for: overtime split rules, BH detection logic, override fetch behaviour
- Covered by `paycalc-roster-suggestions.test.mjs` — run with `node --experimental-test-module-mocks --test paycalc-roster-suggestions.test.mjs`

### `firebase-client.js`
Single Firestore initialisation point — import `db` and Firestore helpers from here, never from the Firebase CDN directly.
- `db` — initialised with `persistentLocalCache()` so all queries are backed by IndexedDB offline storage
- `COLLECTIONS` — frozen object mapping logical names to Firestore collection strings (`circulars`, `newsletters`, `clientErrors`, etc.). Use this instead of bare string literals to prevent typo-silent failures.
- Standard exports re-exported: `collection`, `query`, `where`, `orderBy`, `limit`, `getDocs`, `getDoc`, `addDoc`, `setDoc`, `deleteDoc`, `doc`, `serverTimestamp`, `writeBatch`, `onSnapshot`
- `assertFileSignature(file, expectedType)` — magic-byte guard called at the top of `uploadHuddle` and `_uploadPdf` before any Storage write: rejects a renamed non-PDF/DOCX (browser uploads otherwise trust only the extension/MIME). Mirrors the server-side `fileSignatureMatches` in `functions/roster-parse-helpers.js` (PDF `%PDF-`, DOCX `PK\x03\x04`). **Fails open** on a read error (never blocks a genuine upload); throws `Error('SIGNATURE_MISMATCH')` only on a positive mismatch, which the upload UIs surface as a specific "not a valid PDF/Word document" message.
- `uploadHuddle(date, file, uploadedBy, htmlContent = null)` — transactional manual-upload path (mirrors the Cloud Function ingest + circular/newsletter `_uploadPdf`): verifies the file signature, then writes a **versioned** Storage object `huddles/{date}-{uploadId}.{ext}`, records its path in the `storagePath` field, writes the `huddles/{date}` Firestore doc, then deletes the previous object only after the commit (rolls the new object back on failure) so a re-upload never orphans the old file. `htmlContent` is the converted HTML for DOCX uploads (null for PDFs). Browser delete requires the admin-delete `/huddles` Storage rule (v14.29). Age-based pruning is handled server-side by `pruneOldHuddles()` (3-month), not here.
- `subscribeToLatestHuddle(onData, onError)` — real-time `onSnapshot` listener; returns an unsubscribe function. Used by `calendar-huddle-viewer.js` (initialised from `calendar-app.js`) to keep the Huddle viewer content live without a page refresh. Logs a `console.warn` if a huddle document is missing its `storageUrl` (data integrity signal).
- `savePushSubscription` / `deletePushSubscription` — Web Push subscription management. `deletePushSubscription` guards against empty endpoint (no-ops silently).
- `auth`, `authReady`, `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`, `signInAnonymously`, `signOut`, `onAuthStateChanged`, `nameToEmail`, `normaliseSurname` — Firebase Auth (`authReady` resolves once `onAuthStateChanged` has fired the first time; `normaliseSurname` is the shared surname→password derivation that `getSurname()` in `session.js` delegates to)
- `getStaffContact(memberName)` / `saveStaffContact(memberName, workEmail)` / `deleteStaffContact(memberName)` / `getAllStaffContacts()` — `staffContact` collection; singular helpers called from `settings-app.js`; `getAllStaffContacts` called from `operations-app.js`
- `logClientError(data)` / `getClientErrors()` / `resolveClientError(id)` — `clientErrors` collection (v13.31); `logClientError` called from `error-reporter.js`, read/resolve called from `operations-app.js`. Ordering/retention policy delegated to `client-errors.js` (v13.48).
- `recordPageView(pageId)` / `recordActiveAccount({month, day})` / `getUsageStats()` — anonymous `analytics` usage counters (v14.14). `recordPageView`/`recordActiveAccount` are increment-only fire-and-forget, called from `usage-reporter.js`; `getUsageStats` reads THIS + LAST month page-view docs + the active-account doc (and prunes stale daily buckets) for the `operations-app.js` Usage card (page popularity has a This/Last-month toggle; accounts keep this-month + rolling-30). Date/aggregation maths delegated to `usage-stats.js` (incl. `prevMonthKey`). No member identity is stored — uniqueness is deduped client-side in `usage-reporter.js`, and admin (developer) loads are excluded at write time (v14.95).
- `recordPerfSample({page, metric, bucket, mode, conn})` — anonymous page-load latency counter (Project 0, v14.89), increment-only fire-and-forget into `analytics/perf_<YYYY-MM>.samples[<key>]`. Called from `perf-reporter.js`; the key is built by `perf-stats.perfSampleKey` from `APP_VERSION` + the dimensions (all non-identifying — no member, no raw ms).
- `getPerfStats()` — admin-only read for the Operations "App speed" card (v14.90; two journeys v14.92; FCP + month-over-month v14.95): reads THIS + LAST month `analytics/perf_<YYYY-MM>` and returns `{ thisMonth, lastMonth }`, each `{ month, login, fcp, pages }` — plain-language `summarisePerf` summaries for the `loginTotal`, `fcp` and `domReady` metrics. The card render (`initPageSpeedCard` in `operations-app.js`) has a This/Last-month toggle and shows "🔑 Signing in" + "📄 Opening pages" as two milestones (✨ First appears = fcp, ✅ Fully ready = domReady) with both bars per page; bucketing/verdict maths is the pure `perf-stats.js` module.
- `uploadCircular(date, file, uploadedBy)` — writes PDF to `circulars/{date}-{uploadId}.pdf` in Firebase Storage (versioned path; old file deleted after Firestore commit succeeds) and upserts the `circulars/{date}` Firestore doc (includes `storagePath` field for cleanup tracking); also fire-and-forget prunes documents older than 6 months via `_pruneOldDocs()` after each upload; called from `operations-app.js` (v13.58, versioned path v13.99)
- `getLatestCircular()` — queries `circulars` collection, returns latest doc's data (with `storageUrl`) or null; called from `nav-panel.js` (☰ direct open) and `calendar-doc-viewer.js` (notification-tap viewer) (v13.58)
- `uploadNewsletter(date, file, uploadedBy)` — writes PDF to `newsletters/{date}-{uploadId}.pdf` in Firebase Storage (versioned path; old file deleted after Firestore commit succeeds) and upserts the `newsletters/{date}` Firestore doc (includes `storagePath` field for cleanup tracking); also fire-and-forget prunes documents older than 6 months via `_pruneOldDocs()` after each upload; called from `operations-app.js` (v13.59, versioned path v13.99)
- `getLatestNewsletter()` — queries `newsletters` collection, returns latest doc's data (with `storageUrl`) or null; called from `nav-panel.js` (☰ direct open) and `calendar-doc-viewer.js` (notification-tap viewer) (v13.59)

### `usage-reporter.js`
Anonymous usage recorder (v14.14) — the usage analogue of `error-reporter.js`. `recordUsage(page, member?, identity?)`: records an anonymous page-view counter, and (when a signed-in member is passed) counts that account toward the active-account metric, deduped client-side via localStorage flags keyed by member name (`myb_usage_m_*`, `myb_usage_d30_*`) so the server only ever receives `increment(1)` and never learns who was active. **Records nothing when `identity` (defaults to `member`) is in `CONFIG.ADMIN_NAMES`** — the developer's own test loads are excluded so figures reflect real staff (v14.95); the anonymous calendar passes its selected member as `identity` while leaving `member` null. Called once per page from each coordinator at the same point as `initErrorReporter()`. Imports the I/O from `firebase-client.js`, the dedup maths from `usage-stats.js`, `lsGet`/`lsSet` from `ls.js`, and `CONFIG` from `roster-data.js`. Fire-and-forget — never throws.

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

### `client-errors.js`
Pure error-log ordering and retention logic — no DOM, no Firebase. Imported by `firebase-client.js` only.
- `CLIENT_ERROR_RETENTION_MS` — 90-day retention window constant (measured from resolution, not error time)
- `isResolvedErrorExpired(rec, now, [retentionMs])` — true if a resolved record is past the retention window; records with no `resolvedAt` are never expired
- `expiredResolvedIds(resolved, now, [retentionMs])` — IDs of resolved records that should be pruned
- `orderClientErrors(unresolved, resolved, now, [opts])` — ordered list for the Error Log card: all unresolved first (newest-first), then up to `resolvedLimit` (default 30) recent resolved records. Unresolved records are always prioritised — within expected operational volume (< 100 unresolved at once) resolved backlogs cannot displace them.
- Tested by `client-errors.test.mjs` (no mocks, runs in `test:hygiene`)

### `nav-panel.js`
Shared slide-out navigation panel — imported by all six app pages.
- `initNavPanel({ currentPage, memberName, onSignOut, isAdmin, isLinksDesigner, onLogoClick })` — injects overlay + drawer HTML, wires burger button, manages open/close. `memberName` displays in footer; `onSignOut` callback wires the Sign out button (omit both to hide footer).
  - **Double-init guard:** checks `burger.dataset.navPanelInit` at the top — returns early if already initialised. Safe to call on every page render.
  - `isAdmin: true` enables the Operations pill (hidden from non-admins). `isLinksDesigner: true` enables the Links pill.
  - `onLogoClick` — called when the drawer brand button is tapped; each page passes `() => openAboutLightbox?.()` to open the About lightbox.
- `NAV_PAGES` — page navigation destinations (Calendar / Admin / Pay / Operations / Links); admin-only and links-designer-only pills filtered by flags. Current page omitted from the pill row.
- `NAV_INFORMATION` — flat always-open Information section: Workplace (Daily Huddle, Weekly Retail Circular, Marylebone Newsletter, App Notices). An entry with `comingSoon: true` (instead of `url`) renders as a `<button>` that opens the injected `#navComingSoonLightbox` placeholder. Separate from `NAV_PAGES` pills and the `NAV_GUIDES` collapsed submenu (Staff Guide, Pay Guide, Railcard Guide, FIP Guide — toggled by `#navGuidesToggle`, v11.21).
- `archiveNotice({ id, title, section, date, body })` — writes a dismissed notice to `localStorage('myb_app_notices')`, deduped by `id`. Entries older than 180 days are pruned automatically on each write. Call in `onClose` (close-only notices) or `onOpen` (notices with a CTA, since the user may navigate away before closing).
- `isNoticeExpired(dateStr, days = 28)` — returns `true` if the notice's posting date ("D Mon YYYY") is older than `days`. Two standard windows: **28 days** (short — time-bound prompts) and **90 days** (long — tax-year/seasonal notices). Use to silently skip stale notices on a new device: `if (isNoticeExpired(DATE)) { ... }` or `if (isNoticeExpired(DATE, 90)) { ... }`.
- Sign-out footer (v10.59): shown only when `onSignOut` is supplied. Each page passes its own sign-out logic as a callback — nav-panel.js only calls it.
- Notification bell (v10.61): footer 🔔/🔕 toggle, rendered only when `notifSupported()` (from `notif.js`) is true. Refreshes on every panel open via `peekNotifState()` (read-only — no Firestore write per open, v11.49); tap toggles via `enable/disableNotifications()` and keeps the panel open. `denied` state shows an inline "change in browser settings" hint. This file owns only the bell UI — all push logic is in `notif.js`.
- Initials badge (v12.22): 26px circle (`#navPanelAvatar`) before the member name in the footer. Painted with `avatarInitials(memberName)` and `avatarHue(memberName)` from `roster-data.js` — no fetch, no cache, no event listeners. Profile photo feature removed at v12.22; spec in ROADMAP.md.
- **`_docFetching` tap-guard (v13.63):** module-level `let _docFetching = false` prevents a duplicate concurrent Firestore fetch if the Weekly Retail Circular or Marylebone Newsletter link is tapped repeatedly before the first response arrives; set to `true` at the start of each fetch, reset to `false` in `.finally()`.
- Android back-button pattern: pushes `{ mybNavPanel: true }` history state on open; closes on popstate. `closePanelForNavigation()` (visual-only, no `history.back()`) is used for link/sign-out clicks to avoid racing hash navigation.
- **Focus trap (v10.69):** a `document` keydown listener (active only while `_panelOpen`) cycles Tab/Shift+Tab within the panel's focusable elements. Escape closes the panel.
- **Coming-soon lightbox (v10.69):** `_csReturnFocus` captures `document.activeElement` before opening; restores focus after the close transition completes. Keydown listener (`_onComingSoonKey`) is always removed at the start of `_closeComingSoon()` — not inside `transitionend` — so it never leaks even if the transition is skipped.
- **`transitionend` fallback in `_closeComingSoon()` (v10.74):** A `setTimeout(done, 400)` fires alongside the `transitionend` listener. Whichever fires first calls `done()` and clears the other — prevents body scroll staying locked on iOS or when `prefers-reduced-motion` suppresses the CSS transition entirely.
- Adding a new guide = one `links` entry in `NAV_INFORMATION`. No other changes needed.

### `notif.js`
Shared Web Push module — single source of truth for the VAPID key and subscription lifecycle. Imported by `nav-panel.js`.
- `notifSupported()` — feature detection incl. the iOS "must be a Home Screen PWA" rule
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
- `isBeforeMemberStart(member, date)` — returns true if `date` is before the member's `startDate`; used to suppress overrides before a member joined. Always call this — never inline the date comparison.
- `isRestShift(shift)` — returns true if the shift is `'RD'` or `'OFF'`. Use everywhere instead of repeating the two-value check. Imported by `admin-al.js`, `admin-sick.js`, `admin-overrides.js`, `admin-app.js`.
- `computePeriodDeleteIds(allOverrides, { type, memberName, start, end })` (v14.24) — returns the override doc IDs to delete when re-saving an AL/absence range, including overlapping Sunday `correction/RD` overrides, so a re-save can't leave a stale Sunday correction behind. Pure; used by the admin save paths.
- Covered by `override-utils.test.mjs`

### `railcard-guide.js`
Interactive behaviours for `railcard-guide.html` (extracted v10.84 — CSP compliance).
- Print / Save as PDF button (`#savePdfBtn`)
- Chip-bar click navigation (smooth scroll to target section)
- Offset calculation runs after `document.fonts.ready` (v12.58; falls back to `requestAnimationFrame`) so the sticky `.page-header` height is measured with Inter applied — sets `.chip-bar` `top` to match it, then `scrollMarginTop` on every `.rc` and `.section` so sticky bars don't overlap anchored content

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

### `firestore.rules`
Server-side Firestore security rules — deployed via `firebase deploy --only firestore:rules`.
- `overrides` create/update: **per-member isolation (B2, permissive 3-tier, v14.53)** — `request.auth.token.name == request.resource.data.memberName || token.admin == true || token.manager == true || !('name' in token)` (the last branch is the legacy/anonymous escape, dropped in B3). Required fields: `date`, `memberName`, `type`, `value`, `note`, `source`; `date` bounded to a real `YYYY-MM-DD` (month 01-12, day 01-31); `source` must be `'manual'` or `'roster_import'`; type↔value consistency enforced (timed types `shift`/`rdw` require `HH:MM-HH:MM`; `spare_shift` → `'SPARE'`; `annual_leave` → `'AL'`; `correction` → `'RD'`; `sick` → `'SICK'`). History (the v10.72→v10.94 outage): KNOWN_LIMITATIONS.md task #2.
- `overrides` delete: same 3-tier check against the existing doc's `memberName` (was any authenticated user before v14.53).
- Custom claims set by `setupRosterAuth`: `{ admin: true, name }` for `adminMembers` (`CONFIG.ADMIN_NAMES = ['G. Miller']`), `{ manager: true, name }` for `managerMembers` (`CONFIG.MANAGER_NAMES`, sent by the admin client), `{ name }` for everyone else (admin outranks manager; `setCustomUserClaims` replaces all claims so a demoted member loses the elevated claim on the next run). The admin bypass is essential for roster upload (writes overrides for all members); the manager bypass lets managers edit staff data on behalf without master-admin powers.
- `huddles` read: open (`allow read;`) — `calendar-app.js` (index.html) reads huddles without a Firebase Auth session; requiring auth broke notification auto-open on fresh first visits (v10.76).
- `huddles` write (Firestore): requires auth + `admin == true`; `hasOnly` enforces no extra fields; `uploadedAt` must be a timestamp; optional `htmlContent` capped at 250 000 chars (v10.83+).
- `staffContact` read: owner (`request.auth.token.name == memberName`, where `memberName` is the document ID) or admin; write: owner or admin, and requires the `name` JWT claim (set by `setupRosterAuth`) so anonymous fallback sessions cannot write (v12.68).
- `pushSubscriptions` create/update: requires auth (`request.auth != null`) + required fields `endpoint`, `keys.p256dh`, `keys.auth`; delete: any authenticated session (`request.auth != null` — no per-owner check; documented as a hardening gap in ROADMAP's deferred backlog).
- `clientErrors` write: any authenticated session; read/update/delete: admin only; shape-validated (v13.31).
- `circulars` / `newsletters` read: open (no auth — `calendar-app.js` has no session, matches Huddle model); write: admin only (v13.58/v13.59).

### `storage.rules`
Firebase Storage security rules.
- `huddles/{fileName}` read: requires auth.
- `huddles/{fileName}` write: requires auth + `admin == true` + size < 20 MB + MIME type PDF or DOCX (v10.83). Cloud Function (ingestHuddle) uses Admin SDK — bypasses rules, unaffected. This rule is essential for the manual admin upload path in `huddle.js`.
- `circulars/{fileName}` / `newsletters/{fileName}` read: open (no auth — matches Huddle model). Write: requires auth + `admin == true` + size ≤ 20 MB + MIME type `application/pdf` (v13.58/v13.59).
- All other paths: denied.

### `index.css` / `admin.css` / `paycalc.css` / `operations.css` / `settings.css` / `links.css`
Page-specific CSS for each page — extracted from inline `<style>` blocks (index/admin/paycalc at v11.41; operations/settings at v12.01; links arrived with the page at v12.07).
- Edit here for any visual change that is specific to one page
- All are network-first in the service worker (same freshness guarantee as their HTML)

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
- All four are network-first in the service worker (same freshness guarantee as their HTML)
- Linked after `guide-shell.css` in each guide's `<head>`

### `purify.es.mjs`
Self-hosted DOMPurify ES module (v3.4.8) — extracted from CDN at v12.04.
- Imported by `calendar-huddle-viewer.js` for Huddle HTML sanitisation
- To upgrade: `npm pack dompurify@<ver>`, extract `package/dist/purify.es.mjs`, replace this file, update version comment in `calendar-huddle-viewer.js`
- Precached by the service worker (network-first)

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

### `roster-cycle-data.js`
Raw roster cycle arrays only — `weeklyRoster`, `bilingualRoster`, `fixedRoster`, `cesRoster`, `dispatcherRoster`. Imported by `roster-data.js` only. Edit here when the actual cycle patterns change (very rare). Do not import this file directly from app code — always go through `roster-data.js`.

### `functions/index.js`
Five Cloud Functions (Firebase-dependent shell — pure logic lives in `roster-parse-helpers.js`):
- `ingestHuddle` — Power Automate → Firebase Storage + Firestore; sends push fan-out; awaits `pruneOldHuddles()` (3-month retention) before responding
- `onHuddleCreated` — Firestore `onDocumentCreated` trigger; fires the push fan-out for **manual** admin uploads (skips `uploadedBy === 'power-automate'`, which `ingestHuddle` already notified, to avoid double-notifying)
- `parseRosterPDF` — admin upload → Claude AI → parsed shifts JSON
- `setupRosterAuth` — creates Firebase Auth accounts for all roster members; sets custom claims per tier from the `adminMembers`/`managerMembers` lists in the request body (`{admin,name}` / `{manager,name}` / `{name}`; admin outranks manager). Re-run after adding a manager so their `manager` claim (B2) lands
- `sendPayReminderNotification` — scheduled (daily 08:00 London); on pay-cutoff Saturdays pushes a Pay Calculator reminder
- Internal helper `pruneOldHuddles(excludeDate)` — deletes huddle Firestore docs + Storage objects older than `HUDDLE_RETENTION_MONTHS` (3); best-effort, awaited inside `ingestHuddle`

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

See `CLAUDE.md` → "Version bumping (MANDATORY on every change)". 9 edit locations (8 files); authoritative source is `APP_VERSION` in `roster-data.js`.
