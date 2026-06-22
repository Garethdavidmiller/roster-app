# AI_MAP.md — Claude routing guide for MYB Roster

*Last updated: June 2026 — v13.30 · Updated every 0.10 version*

Use this file to decide which source file to read or edit for a given task.
Read CLAUDE.md first for project identity, version bumping rules, and architecture constraints.

---

## Quick decision table

| Task | Primary file(s) |
|------|----------------|
| Roster logic, team members, bank holidays, pay periods | `roster-data.js` |
| Raw roster cycle patterns (weeklyRoster, cesRoster, etc.) | `roster-cycle-data.js` |
| Calendar UI, month view, swipe, shift display | `calendar-app.js` |
| Huddle viewer overlay, _triggerAutoOpen, hashchange, subscription | `app-huddle-viewer.js` |
| Team Week View — grid, navigation, Firestore fetch, toggle | `app-team-view.js` |
| Override priority, member-start, rest-shift helpers — tsToMillis, shouldReplaceOverride, isBeforeMemberStart, isRestShift | `app-override-utils.js` |
| Body scroll lock, overlay history, focus trap, lightbox lifecycle, card collapse (lockBodyScroll, trapFocus, createLightbox, initCardCollapse, etc.) | `overlay.js` |
| About panel content (version, update status, bug link, print button) | `about-lightbox.js` |
| Per-card ? tips lightbox lifecycle/renderer (content data stays per page) | `tips-lightbox.js` |
| Service worker registration + update lifecycle (all six app pages) | `sw-register.js` |
| Auth/session helpers (AUTH_KEY, getSession, saveSession, clearSession, ensureFirebaseSession) | `session.js` |
| Admin portal UI, login, AL, sick, overrides, module wiring | `admin-app.js` + `admin.html` |
| Settings page — Notifications, Work Email | `settings-app.js` + `settings.html` |
| Nav-panel footer initials badge | `nav-panel.js` + `avatarInitials`/`avatarHue` in `roster-data.js` |
| Operations page — Huddle upload, Roster upload, Staff Login Accounts | `operations-app.js` + `operations.html` |
| Error Log card (ops page) — uncaught error capture, ops card display, Copy for Claude | `error-reporter.js`, `firebase-client.js` (logClientError/getClientErrors/resolveClientError), `operations-app.js`, `operations.css` |
| Links design workspace — 28-line design grid, paint mode, hourly coverage heat map, design checks, auto-generator UI | `links-app.js` + `links.html` + `links.css` |
| Link-design maths — shift classification, custom-time validation, coverage counting (per-type + hour-by-hour), rotating-window generator, design quality checks | `links-design.js` (pure — no DOM/Firebase; tested by `links-design.test.mjs`) |
| Annual Leave Booking section | `admin-al.js` |
| Sick Days Recording section | `admin-sick.js` |
| Huddle upload (admin-only, operations page) | `huddle.js` → `initHuddleUpload` |
| Push notifications card (all staff, settings page) | `huddle.js` → `initHuddleNotifications` |
| Staff Firebase Auth account setup card | `admin-auth.js` |
| Change a Shift — week grid, override entry, bulk bar, save logic | `admin-overrides.js` |
| Inline date-range calendar widget (AL and Sick date pickers) | `admin-rangepicker.js` |
| Roster PDF upload, review pipeline, cell state logic | `admin-roster-upload.js` |
| Roster PDF parsing (Cloud Function) | `functions/index.js` + `functions/roster-parse-helpers.js` |
| Pay calculator UI, period select, form, settings, HPP | `paycalc-app.js` + `paycalc.html` |
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
| localStorage wrappers (lsGet, lsSet, lsDel) | `ls.js` |
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
### `calendar-app.js`
Everything that touches `index.html` at runtime.
- Calendar render, month carousel, swipe gestures
- Override cache for the calendar view (`rosterOverridesCache`)
- Team Week View toggle
- Notification/push subscription wiring
- Sync chip state machine
- `navigateToPaycalc(paydayStr)` — shared helper for payday/cutoff cell clicks; checks session then navigates
- Calls `initHuddleViewer()` from `app-huddle-viewer.js`

### `app-huddle-viewer.js`
Huddle viewer overlay — extracted from `calendar-app.js` at v11.40. Only export is `initHuddleViewer()` (the old `applyHuddleButtonState()` export was removed at v12.57 — the `#huddleBtn` it updated no longer exists; the viewer is opened solely via the `#huddle` hash).
- `initHuddleViewer()` — sets up the viewer overlay, subscribes to Firestore via `subscribeToLatestHuddle`, wires the `#huddle` hash handler (used by both the nav-panel "Daily Huddle" link and notification taps)
- `sanitiseHtml(html)` — internal; DOMPurify sanitisation for DOCX huddles
- `_triggerAutoOpen(huddle)` — **two content types, do not unify:** HTML huddles render inline; PDF/DOCX huddles render an in-overlay "📄 Open Huddle" button (`#huddleOpenFileBtn`) because a `#huddle`-hash open carries no user activation — a direct `window.open`/`location.href` would be pop-up-blocked or knock the PWA out of standalone. Full rationale: OPERATIONS_REFERENCE.md → "Huddle notification tap behaviour".

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

### `sw-register.js`
Shared service worker registration + update lifecycle (v12.28). All six app pages import this instead of duplicating the register/activate/reload pattern.
- `registerServiceWorker({ beforeReload, bfcache })` — registers `./service-worker.js`, activates any waiting worker immediately, sets up an hourly update-check via `visibilitychange`. On `controllerchange`, calls `beforeReload()` if provided, otherwise `window.location.reload()`. `bfcache: true` adds `pagehide`/`pageshow` handlers (used by `calendar-app.js` only).
- Per-page variants: `calendar-app.js` — 500ms reload delay + bfcache; `admin-app.js` — defers reload if `hasUnsavedChanges()`; `links-app.js` — shows `confirm()` if the design is dirty; others — plain reload.

### `session.js`
Shared auth/session module — canonical source for session logic (v11.40).
- Constants: `AUTH_KEY`, `SESSION_MS` (30 days), `SESSION_VER`
- `getSurname(name)` — derives Firebase Auth password from display name
- `getSession()` / `saveSession(name)` / `clearSession()` — localStorage wrappers for the session object
- `ensureFirebaseSession(name)` — re-establishes Firebase Auth on every page load; waits for `onAuthStateChanged`, signs in if no existing session, self-heals a missing account via `createUserWithEmailAndPassword`. Returns `Promise<boolean>`.
- Imported by: `admin-app.js`, `settings-app.js`, `operations-app.js`, `paycalc-app.js` (v12.49 — getSession/clearSession only, so paycalc enforces session expiry and refreshes the idle clock like every other page)

### `operations-app.js`
Coordinator for `operations.html` (admin-only, v10.99).
- Session guard: reads the shared `myb_admin_session` localStorage key via `getSession()` from `session.js`; redirects to `admin.html` if not authenticated or not in `CONFIG.ADMIN_NAMES`
- Calls `ensureFirebaseSession(name)` from `session.js` to re-establish Firebase Auth on page load
- Calls `initHuddleUpload()`, `initRosterUpload()`, `initAuthSetup()`, `initNavPanel({ isAdmin: true })`; runs `initErrorLog()` IIFE (Error Log card, v13.31)
- Work Email Progress card (v13.30) shows per-grade breakdown (All / CEA / CES / Dispatcher filter) of who has and hasn't added a work email — "Added (N)" green chips + "Still to add (N)" grey chips
- Owns icon lightbox, tips lightbox, and collapsible card wiring for the operations cards

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
- `initOverrides(opts)` — called once by `admin-app.js` after login; receives callbacks
- `renderWeekGrid()` — generates per-row type pills (must stay in sync with `admin.html` bulk bar)
- `loadOverrides()` / `renderTable()` — Saved Changes list
- `executeSave()` — writes override to Firestore
- `updateSaveBtn()` — exported so swipe carousel can call it
- State accessors: `getAllOverrides()` / `setAllOverrides()` — used by `admin-al.js` and `admin-sick.js`
- `recordRangeOverrides({ type, value, memberName, dates, changedBy })` — shared batch-write helper used by both `admin-al.js` and `admin-sick.js`; filters out Sundays and RD days, writes Sunday RD corrections alongside AL/sick overrides, updates `_allOverrides` cache, and re-renders the week grid and override list

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
UI layer for `paycalc.html`. No pure pay maths here.
- Period select, form read/write, autosave
- `onPeriodChange()` — orchestrates all period-level updates
- `_suggestIfBlank()` / `_applyRosterSuggestion()` — pre-fill helpers
- Settings card, HPP card, sticky take-home bar
- `getLoggedMember()`, `getEffectiveContr(p)` — session/period helpers
- `_bpAmount` / `_bpVarAmount` / `_bpPNum` — back pay state (v10.73): `_bpVarAmount` holds the variable-pay portion (overtime, RDW, Sunday, BH, London Allowance uplifts) so `calcHPP()` can include it in the HPP accumulator for the paid-in period
- `calcBackPay()` — computes both total and variable portions from saved period data by category; mirrors `_varPayForPeriod()` but applied to `rateDiff` instead of `rate`
- Imports `HELP_CONTENT` from `paycalc-help.js`; imports `SK`, `periodKey`, `hppEstKey`, `hppActualKey`, `ytdPayKey`, `ytdTaxKey`, `runMigrations` from `paycalc-migrations.js`

### `paycalc-help.js`
Pure data module — help/tooltip text for the pay calculator (v11.40).
- `HELP_CONTENT` object with keys: `hours`, `settings`, `accuracy`, `hpp`, `backpay`
- Imports `TAX_YEARS` from `paycalc-calc.js` for the London Allowance figure in tip text
- No DOM, no Firebase — safe to import anywhere

### `paycalc-migrations.js`
localStorage key constants and data migration logic for the pay calculator (v11.40).
- `SK` — object of top-level localStorage key strings
- `periodKey(pNum)` — key builder for period data (takes period number)
- `hppEstKey(ty)`, `hppActualKey(ty)`, `ytdPayKey(ty)`, `ytdTaxKey(ty)` — key builders that take a tax-year object `ty` (with `.label` property, e.g. `'2025/26'`)
- `runMigrations({ getPeriods, getLoggedMember, getPensionDefault })` — runs all one-time data migrations; receives deps as params to avoid circular imports with `paycalc-app.js`
- `_migrateCeaKeys` — internal migration (old CEA keys → grade-neutral format)

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
- `uploadHuddle(date, file, uploadedBy, htmlContent = null)` — writes to Firebase Storage + Firestore `huddles` collection; `htmlContent` is the converted HTML string for DOCX uploads (null for PDFs)
- `subscribeToLatestHuddle(onData, onError)` — real-time `onSnapshot` listener; returns an unsubscribe function. Used by `calendar-app.js` to keep the Huddle button live without a page refresh. Logs a `console.warn` if a huddle document is missing its `storageUrl` (data integrity signal).
- `savePushSubscription` / `deletePushSubscription` — Web Push subscription management. `deletePushSubscription` guards against empty endpoint (no-ops silently).
- `auth`, `signInWithEmailAndPassword`, `signOut`, `nameToEmail` — Firebase Auth
- `getStaffContact(memberName)` / `saveStaffContact(memberName, workEmail)` / `deleteStaffContact(memberName)` / `getAllStaffContacts()` — `staffContact` collection; singular helpers called from `settings-app.js`; `getAllStaffContacts` called from `operations-app.js`
- `logClientError(data)` / `getClientErrors()` / `resolveClientError(id)` — `clientErrors` collection (v13.31); `logClientError` called from `error-reporter.js`, read/resolve called from `operations-app.js`

### `nav-panel.js`
Shared slide-out navigation panel — imported by all six app pages.
- `initNavPanel({ currentPage, memberName, onSignOut, isAdmin, isLinksDesigner, onLogoClick })` — injects overlay + drawer HTML, wires burger button, manages open/close. `memberName` displays in footer; `onSignOut` callback wires the Sign out button (omit both to hide footer).
  - **Double-init guard:** checks `burger.dataset.navPanelInit` at the top — returns early if already initialised. Safe to call on every page render.
  - `isAdmin: true` enables the Operations pill (hidden from non-admins). `isLinksDesigner: true` enables the Links pill.
  - `onLogoClick` — called when the drawer brand button is tapped; each page passes `() => openAboutLightbox?.()` to open the About lightbox.
- `NAV_PAGES` — page navigation destinations (Calendar / Admin / Pay / Operations / Links); admin-only and links-designer-only pills filtered by flags. Current page omitted from the pill row.
- `NAV_INFORMATION` — flat always-open Information section: Workplace (Daily Huddle, Weekly Retail Circular) + Guides (Staff Guide, Pay Guide, Railcard Guide, FIP Guide via `NAV_GUIDES` collapsed submenu, v11.21). An entry with `comingSoon: true` (instead of `url`) renders as a `<button>` that opens the injected `#navComingSoonLightbox` placeholder.
- Sign-out footer (v10.59): shown only when `onSignOut` is supplied. Each page passes its own sign-out logic as a callback — nav-panel.js only calls it.
- Notification bell (v10.61): footer 🔔/🔕 toggle, rendered only when `notifSupported()` (from `notif.js`) is true. Refreshes on every panel open via `peekNotifState()` (read-only — no Firestore write per open, v11.49); tap toggles via `enable/disableNotifications()` and keeps the panel open. `denied` state shows an inline "change in browser settings" hint. This file owns only the bell UI — all push logic is in `notif.js`.
- Initials badge (v12.22): 26px circle (`#navPanelAvatar`) before the member name in the footer. Painted with `avatarInitials(memberName)` and `avatarHue(memberName)` from `roster-data.js` — no fetch, no cache, no event listeners. Profile photo feature removed at v12.22; spec in ROADMAP.md.
- Nationality flags (v10.64): imports `teamMembers` from `roster-data.js`, looks up the logged-in member by exact name, renders their optional `flags` array (max 2 emoji) between the name and the bell. Set via `textContent`. Windows detection (v10.65) uses `navigator.userAgentData?.platform ?? navigator.platform` (modern API with legacy fallback) — flags are skipped on Windows where flag emoji render as two-letter codes.
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

### `app-override-utils.js`
Override priority, member-start, and shift-classification helpers — shared by `calendar-app.js`, `app-team-view.js`, and admin modules.
- `tsToMillis(ts)` — converts Firestore Timestamp or `{seconds}` object to milliseconds
- `shouldReplaceOverride(existing, incoming)` — priority logic: manual beats import; newer wins within same class
- `isBeforeMemberStart(member, date)` — returns true if `date` is before the member's `startDate`; used to suppress overrides before a member joined. Always call this — never inline the date comparison.
- `isRestShift(shift)` — returns true if the shift is `'RD'` or `'OFF'`. Use everywhere instead of repeating the two-value check. Imported by `admin-al.js`, `admin-sick.js`, `admin-overrides.js`, `admin-app.js`.
- Covered by `app.test.mjs`

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
- On the first failure, emits a single `console.warn` (visible in DevTools) — subsequent failures are silent
- **Never call `localStorage` directly** in `calendar-app.js`, `admin-app.js`, or `paycalc-app.js` — always use these wrappers

### `firestore.rules`
Server-side Firestore security rules — deployed via `firebase deploy --only firestore:rules`.
- `overrides` create/update: `memberName == request.auth.token.name || admin == true`; required fields: `date`, `memberName`, `type`, `value`, `note`, `source`; `source` must be `'manual'` or `'roster_import'` (v10.72)
- `overrides` delete: `resource.data.memberName == request.auth.token.name || admin == true`
- Admin custom claim (`request.auth.token.admin == true`) is set by `setupRosterAuth` Cloud Function with `adminMembers=['G. Miller']`. The admin bypass is essential for roster upload (G. Miller writes overrides for all team members).
- `huddles` read: open (`allow read;`) — `calendar-app.js` (index.html) reads huddles without a Firebase Auth session; requiring auth broke notification auto-open on fresh first visits (v10.76).
- `huddles` write (Firestore): requires auth + `admin == true` (v10.83). Cloud Function writes use Admin SDK (bypasses rules). Browser writes (manual admin upload) must come from an authenticated admin session.

### `storage.rules`
Firebase Storage security rules.
- `huddles/{fileName}` read: requires auth.
- `huddles/{fileName}` write: requires auth + `admin == true` + size < 20 MB + MIME type PDF or DOCX (v10.83). Cloud Function (ingestHuddle) uses Admin SDK — bypasses rules, unaffected. This rule is essential for the manual admin upload path in `huddle.js`.
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

### `guide.css` / `paycalc-guide.css` / `railcard-guide.css` / `fip.css`
Page-specific CSS for each guide page — extracted from inline `<style>` blocks at v12.04.
- Edit the corresponding file for any visual change specific to that guide page
- All four are network-first in the service worker (same freshness guarantee as their HTML)
- Linked after `guide-shell.css` in each guide's `<head>`

### `purify.es.mjs`
Self-hosted DOMPurify ES module (v3.4.8) — extracted from CDN at v12.04.
- Imported by `app-huddle-viewer.js` for Huddle HTML sanitisation
- To upgrade: `npm pack dompurify@<ver>`, extract `package/dist/purify.es.mjs`, replace this file, update version comment in `app-huddle-viewer.js`
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
- Covered by `roster-parse-helpers.test.mjs` (78 tests)

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
