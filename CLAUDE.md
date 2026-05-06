# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Current app version | `8.62` (check `roster-data.js` — `APP_VERSION` is the authoritative source) |
| Hosted URL | Deployed to Firebase Hosting via GitHub Actions on push to `main` |
| Cloud Function URLs | `https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle` — Huddle auto-upload (Power Automate) |
| | `https://europe-west2-myb-roster.cloudfunctions.net/parseRosterPDF` — Weekly roster PDF parser (admin page) |
| | `https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth` — One-time Firebase Auth account creation (POST with ROSTER_SECRET) |
| Development branch convention | `claude/<description>-<sessionId>` — always push to this branch, never directly to `main` |

**GitHub Actions secrets required** (Settings → Secrets and variables → Actions):

| Secret name | What it is |
|-------------|-----------|
| `FIREBASE_SERVICE_ACCOUNT` | Full JSON of a Firebase service account key with Functions deploy permissions |
| `HUDDLE_SECRET` | Bearer token Power Automate sends to `ingestHuddle` — must also be in Firebase Secret Manager: `firebase functions:secrets:set HUDDLE_SECRET` |
| `ROSTER_SECRET` | Bearer token the admin page sends to `parseRosterPDF` — must also be in Firebase Secret Manager: `firebase functions:secrets:set ROSTER_SECRET`. **⚠ The current value is hardcoded in `admin-app.js` (visible in page source — known limitation, see issue #14). Rotate it if the function is ever abused.** |
| `ANTHROPIC_API_KEY` | API key for Claude AI (used by `parseRosterPDF` to read the roster PDF) — Firebase Secret Manager only, not needed in GitHub Actions: `firebase functions:secrets:set ANTHROPIC_API_KEY` |
| `VAPID_PUBLIC_KEY` | Web Push public key for Huddle push notifications — Firebase Secret Manager only: `firebase functions:secrets:set VAPID_PUBLIC_KEY` |
| `VAPID_PRIVATE_KEY` | Web Push private key — Firebase Secret Manager only: `firebase functions:secrets:set VAPID_PRIVATE_KEY` |

**GitHub Actions workflows:**
- `.github/workflows/deploy-functions.yml` — triggers on push to `main` when any file under `functions/` changes, or manually via `workflow_dispatch`. Deploys Cloud Functions only (not the PWA). Exit code from Firebase CLI is treated as success if the only error text is "cleanup policy" (a benign GCP Artifact Registry warning).
- `.github/workflows/deploy-hosting.yml` — triggers on push to `main` when any PWA file changes (excludes `functions/`, `firestore.rules`, `*.md`, `.github/**`), or manually via `workflow_dispatch`. Deploys Firebase Hosting only (not Cloud Functions). Added v8.14 — was missing before, meaning live PWA files were stale after merges.

---

## Version bumping (MANDATORY on every change)

**As of v8.62:** JS is split across multiple modules. You need to update **all** of these:

| File | Location | Note |
|------|----------|------|
| `roster-data.js` | `export const APP_VERSION = '...'` | **primary source** |
| `roster-data.js` | `import ... from './roster-cycle-data.js?v=...'` | |
| `service-worker.js` | Line 1 comment | |
| `service-worker.js` | `const APP_VERSION = '...'` | must match roster-data.js |
| `index.html` | Line 2 HTML comment | |
| `index.html` | `app.js?v=`, `shared.css?v=`, `manifest.json?v=` | 3 places |
| `admin.html` | Line 2 HTML comment | |
| `admin.html` | `admin-app.js?v=`, `shared.css?v=`, `manifest.json?v=` | 3 places |
| `paycalc.html` | Line 2 HTML comment | |
| `paycalc.html` | `paycalc.js?v=`, `shared.css?v=`, `pay-manifest.json?v=` | 3 places |
| `app.js` | `roster-data.js?v=`, `firebase-client.js?v=` | 2 places |
| `admin-app.js` | `roster-data.js?v=`, `firebase-client.js?v=`, `admin-roster-upload.js?v=`, `admin-overrides.js?v=` | 4 places |
| `admin-overrides.js` | `roster-data.js?v=`, `firebase-client.js?v=` | 2 places |
| `admin-roster-upload.js` | `roster-data.js?v=`, `firebase-client.js?v=` | 2 places |
| `paycalc.js` | `roster-data.js?v=`, `paycalc-calc.js?v=`, `paycalc-roster-suggestions.js?v=` | 3 places |
| `paycalc-roster-suggestions.js` | `roster-data.js?v=`, `firebase-client.js?v=` | 2 places |

**Tip:** `grep -rn "?v=<old>" *.js *.html` finds every stale reference in one command.

`CONFIG.APP_VERSION` and `ADMIN_VERSION` read from `CONFIG.APP_VERSION` which is set inside `roster-data.js` — no manual update needed for those.

- Increment the patch number for every commit that touches app behaviour
- The `?v=` cache-busting strings **must** be updated manually (browsers use them to bust the module cache)
- Tell the user the new version number in your reply after committing

**CLAUDE.md update policy:** This file is updated every **0.10 version** (e.g. 7.90 → 8.00), not on every patch release. The version shown in "Project identity" above will routinely lag the live app by a few patch numbers — this is intentional, not documentation drift. Always treat `APP_VERSION` in `roster-data.js` as the authoritative version. Update CLAUDE.md between those checkpoints only if there is a major behavioural change: new pay grade, auth/Firestore model change, service worker strategy change, new page or module going to production, or a data model change.

**Same-commit rule:** Any commit that adds, removes, or renames a JS module must also update the file structure in `CLAUDE.md` and the routing table in `AI_MAP.md` in the **same commit**. The pre-commit hook (`githooks/pre-commit`) enforces this — it blocks commits where a root `.js` file is not listed in both docs. To activate after a fresh clone: `git config core.hooksPath githooks`.

---

## How to work with the owner

Gareth built this app through extended collaboration with Claude.ai. He has strong operational knowledge of railway rostering and is actively learning software development. Every session is both a development session and a teaching session.

- **Explain decisions** — not just what, but why, what the alternative was, and what it enables
- **Plain language first** — explain new concepts before showing implementation
- **Name the pattern** — if using a design pattern, name it and say why it fits
- **Flag trade-offs** — briefly note what the other option was and why this was chosen
- **Never assume prior knowledge** of cloud services, authentication patterns, or backend concepts

The goal is that Gareth understands the codebase, not just that the codebase works.

---

## Current file structure

```
roster-app/
├── index.html              ← main PWA app (HTML + CSS only)
├── admin.html              ← staff self-service and admin portal (HTML + CSS only)
├── paycalc.html            ← pay calculator (HTML + CSS only)
├── app.js                  ← all JavaScript for index.html
├── admin-app.js            ← all JavaScript for admin.html
├── admin-overrides.js      ← Change a Shift module: week grid, bulk bar, override list, save logic, utilities
├── admin-roster-upload.js  ← Weekly Roster Upload pipeline: computeCellStates, renderReviewTable, shiftDisplay
├── paycalc.js              ← all JavaScript for paycalc.html (UI, DOM, period logic)
├── paycalc-calc.js         ← pure pay math module (no DOM/Firebase): tax, NI, SL, gross, thresholds. Imported by paycalc.js and paycalc.test.mjs
├── paycalc-roster-suggestions.js ← roster pre-fill engine: getRosterSuggestion, fetchOverridesForPeriod
├── roster-data.js          ← shared module: APP_VERSION, CONFIG, teamMembers, all roster data, utility functions
├── roster-cycle-data.js    ← raw roster cycle arrays (weeklyRoster, bilingualRoster, cesRoster, etc.) — imported by roster-data.js only
├── firebase-client.js      ← shared module: Firebase init (one place), exports db + all Firestore functions
├── shared.css              ← CSS shared by all three pages
├── service-worker.js       ← single SW for all pages; cache name includes app version, e.g. myb-roster-v8.62
├── manifest.json           ← PWA manifest for main app (index.html + admin.html)
├── pay-manifest.json       ← PWA manifest for pay calculator (paycalc.html)
├── paycalc-guide.html      ← printable pay calculator reference guide (linked from pay calculator about lightbox)
├── fip.html                ← FIP European travel guide for staff (linked from admin.html)
├── guide.html              ← printable staff + admin quick guide (update at major versions: v7, v8 …)
├── icon-*.png              ← 6 sizes: 120, 152, 167, 180, 192, 512
├── CLAUDE.md               ← architectural rules and context for Claude sessions (this file)
├── OPERATIONS_REFERENCE.md ← Power Automate flow, Cloud Function request formats, Firebase Auth detail
├── AI_MAP.md               ← routing guide: which file to read/edit for a given task
├── KNOWN_LIMITATIONS.md    ← intentional constraints and deferred decisions
├── ROADMAP.md              ← product history, future ideas, reverted experiments
└── functions/
    ├── index.js            ← Firebase Cloud Functions: ingestHuddle + parseRosterPDF + setupRosterAuth
    └── package.json        ← Node 20; firebase-admin, firebase-functions, @anthropic-ai/sdk
```

**Service worker caching strategy:**
- Network-first: `index.html`, `admin.html`, `app.js`, `admin-app.js`, `admin-overrides.js`, `admin-roster-upload.js`, `paycalc.html`, `paycalc.js`, `paycalc-calc.js`, `paycalc-roster-suggestions.js`, `roster-data.js`, `firebase-client.js`, `shared.css` — must always be fresh
- Cache-first: icons (cached individually), `manifest.json`, `pay-manifest.json` — stable assets
- Cache name format: `myb-roster-v{APP_VERSION}` — any version bump automatically invalidates the old cache
- One SW (`service-worker.js`) covers all three pages.

---

## Brand colours — Chiltern Railways

| Variable | Hex | Use |
|----------|-----|-----|
| `--primary-blue` | `#001e3c` | Dark navy — headers, buttons, day-header cells |
| `--primary-blue-dark` | `#00152a` | Deeper navy — hover states |
| `--accent-gold` | `#f5c800` | Gold — today cell, today button, active highlights |
| `--accent-gold-dark` | `#e6bb00` | Darker gold — hover on today button |

The current scheme is navy and gold. All colour values must be assigned to CSS variables in `:root` — never hardcode hex values in CSS rules.

---

## Architecture decisions — never change without discussion

| Decision | Reason |
|----------|--------|
| No framework (vanilla JS) | No build step, easy to understand and modify. Do not introduce React, Vue, or any library beyond Firebase. |
| No bundler | External dependencies load from CDN only. |
| Pointer Events API for swipe | Handles mobile touch, desktop mouse, and trackpad in one handler. Do not revert to Touch Events. |
| `aria-live` for month announcements | Programmatic `.focus()` on the month heading caused flex container reflow — confirmed mobile layout bug. Do not switch. |
| `Math.ceil()` on carousel panel width | Eliminates sub-pixel rendering seam on high-DPI screens. Do not remove. |
| CSS variables for all colours | Defined in `:root`. Never hardcode hex values anywhere in CSS or JS. |
| Semantic elements (`<nav>`, `<header>`, `<main>`) | Screen readers depend on these landmarks. Do not revert to `<div>`. |
| Network-first service worker for app files | Ensures staff always receive roster updates on next open. |
| `isChristmasRD()` applied before Firestore overrides | Forces Dec 25 and Dec 26 to RD first; Firestore can then override Dec 26 to RDW for overtime. Never reorder this. |
| `getBaseShift(member, date)` must be used for all base shift lookups | Direct access to `roster.data[week][day]` bypasses `startDate` suppression, Christmas rules, and any future base-shift logic. `buildCalendarContainer` used direct access until v6.28 — M. Okeke showed roster shifts before her start date as a result. Always call `getBaseShift()`, never read `roster.data` directly. |
| Two separate type pill lists in admin | Per-row pills are generated by `renderWeekGrid()` in `admin-overrides.js`. Bulk bar pills are in `admin.html` (static HTML, line ~2215). **Both lists must be kept in sync.** Adding a new type requires updating both. The order must also match. Current order: AL · Spare · Shift · RDW · Absence · Rest Day |
| **`AL` pill label must stay as `AL`** | The pills are compact by design — mobile layout requires short labels. `AL` is the standard Chiltern abbreviation staff already know from their rosters. Do not expand to "Annual Leave" without discussing the layout impact first. |
| **`🪑` is the absence emoji — do not change to `🤒` or any illness-specific icon** | Absence covers sickness, childcare, bereavement, and any other reason. Using 🤒 (sick face) would imply illness, which is a GDPR concern — the reason for absence is deliberately never stored. The neutral chair emoji was chosen for this reason. **Always ask Gareth before changing the absence icon.** |
| `_staleMemberName` flag in `app.js` | When `getSelectedMemberIndex()` cannot find a saved name in `teamMembers`, it sets `_staleMemberName` to the old name, removes it from localStorage, and falls back to the default member. `renderCalendar()` checks this flag on its next run and shows a dismissible banner: "{name} is no longer in the roster — now showing {new name}'s calendar." The flag is cleared after the banner fires to avoid repeat shows. |
| Sync chip state machine in `app.js` | The chip follows: hidden → (800ms delay) → "↻ Updating your shifts…" → "✓ Up to date" (auto-removes after 1.5s) or "⚠ Couldn't update — tap to retry" (stays visible, 10s timeout). Never show raw error messages to staff. CSS classes: `sync-chip-ok` (green) / `sync-chip-error` (red, underlined, clickable). |
| `_clearState` object in `paycalc.js` | Replaces the old `_clearPending` / `_clearTimer` pair. Adds `countdownTimer` for a live countdown in the button label ("Tap again to confirm (3)"). Pattern: one object groups all state for a two-tap destructive action so the state is easy to reset atomically. |
| `CONDITIONAL_ROWS` in `paycalc.js` | Data-driven array that maps a condition function → row IDs → field IDs. `updateBhRows(p)` iterates it to show/hide bank holiday rows and clear their values. Adding future conditional rows means adding one entry to the array, not writing new show/hide logic. |
| `touch-only` CSS class in `shared.css` | Elements with this class are hidden on pointer-fine (mouse/trackpad) devices via `@media (hover: hover) and (pointer: fine)`. Use it for any UI that only makes sense on touch screens — swipe tips, swipe hints, etc. Do not use inline display:none; apply the class instead so the rule is centralised. |
| `window.matchMedia('(pointer: coarse)')` guard in `initSwipeHint()` | The swipe month-change hint is only shown on touch devices. Without this guard it appeared on desktop. Always add this check before showing any gesture-tutorial UI. |
| VAPID fingerprint migration in `app.js` and `admin-app.js` | When the VAPID public key is rotated, existing push subscriptions become invalid (HTTP 401 from the push service). Both pages store the first 12 chars of the current VAPID public key in `localStorage('myb_vapid_ver')`. On load, if the stored fingerprint doesn't match the hardcoded key, the page silently unsubscribes → re-subscribes → updates the fingerprint. This is transparent to staff. The Cloud Function also treats 401 the same as 410/404 (stale subscription — delete the document). |
| One-off notification prompt (`#notifPrompt`) in `index.html` | A small strip between `</nav>` and the pay-period strip appears once per device when `Notification.permission` is neither `'granted'` nor `'denied'` and `localStorage('myb_notif_prompt_done')` is unset. Enable button requests permission; × dismisses permanently. Both actions set the flag. The prompt never re-appears. Do not move it below the calendar — it must be visible without scrolling. |
| PWA shortcuts in `manifest.json` | Three long-press shortcuts: Calendar (`index.html`), Pay (`paycalc.html`), Admin (`admin.html`). Max 4 shortcuts per Android spec. Changes require the app to be reinstalled (or the manifest to be refreshed) before taking effect — existing installs see old shortcuts until they reinstall. |
| Sticky take-home bar (`#stickyTotal`) in `paycalc.html` | Fixed bar at bottom of viewport on mobile (hidden ≥1040px). Appears via `IntersectionObserver` when the `.result-card` scrolls off-screen. Tapping scrolls smoothly to the result card. `body.sticky-active` adds bottom padding to prevent content being hidden behind the bar. |
| 3-digit time input auto-correction in `admin-overrides.js` | When a time input is blurred, raw digits are extracted and if length is 3 and `parseInt(raw.slice(0,2)) > 23`, a leading `'0'` is prepended before formatting. Without this, typing `"630"` produced `"63:0"` (invalid). |
| Range picker clear button (`.rp-clear`) | A ✕ button appears inside the date range picker when any date is selected. It resets both `from` and `to` dates and hides itself. Built into `buildRangePicker()` in `admin-app.js`. |
| Team Week View (`👥 Team` button) | Available to all logged-in staff (v8.40 — admin-only gate removed at v8.40; was admin-only v8.22–v8.39). Toggle managed by `toggleTeamView()`, `teamViewMode` flag, and `applyTeamViewChrome()`. Week runs Sun–Sat (Chiltern convention) via `getSunday(date)`. Grade state (`currentTeamGrade`) persists across re-renders. `fetchTeamWeekOverrides(weekStart, weekEnd, fetchToken)` uses the week-start timestamp as a token — results whose token no longer matches `currentTeamWeekStart` are discarded, preventing stale Firestore data from overwriting the UI after rapid navigation. Grade-tabs row uses CSS grid (`1fr auto 1fr`) so the grade tabs stay centred regardless of how many utility buttons (📋 / ?) sit on the right. |

---

## Payday calculator — integrated (v6.50)

The pay calculator is a fully integrated page of the app. It lives at `paycalc.html` / `paycalc.js`, shares `shared.css`, imports `APP_VERSION` and pay-period helpers from `roster-data.js`, and is covered by the single `service-worker.js`.

| Component | Location |
|-----------|----------|
| `getPaydaysAndCutoffs(year)` | `roster-data.js` — returns `{ paydays[], cutoffs[] }` for any year |
| `isPayday(date)` / `isCutoffDate(date)` | `roster-data.js` — boolean helpers |
| `FIRST_PAYDAY`, `PAYDAY_INTERVAL_DAYS` | `CONFIG` in `roster-data.js` |
| 💷 / ✂️ calendar markers | `app.js` — `.payday` and `.cutoff` CSS classes applied per cell |
| Tests | `roster-data.test.mjs` — payday and cutoff tests passing |
| UI | `paycalc.html` + `paycalc.js` — reads base roster and Firestore overrides, shows shift breakdown per pay period |
| PWA manifest | `pay-manifest.json` — separate manifest so the calculator can be installed independently |
| `getRosterSuggestion(period)` | `paycalc-roster-suggestions.js` — reads base roster + Firestore overrides, counts Sat/Sun/BH/Boxing Day/RDW shifts. Used by the "Fill from roster →" hint bar. |
| `fetchOverridesForPeriod(p, memberName)` | `paycalc-roster-suggestions.js` — fetches Firestore overrides for a pay period window. |
| `getLoggedMember()` | `paycalc.js` — returns the `teamMembers` entry for the session user, or null. |
| `getEffectiveContr(p)` | `paycalc.js` — returns contracted hours for the period, pro-rated if the member has a `startDate` that falls within it. Full contracted hours otherwise. Used by `calculate()`, HPP loop, and Saturday cap. |
| Reference guide | `paycalc-guide.html` — printable/linkable pay calculator reference (linked from the about lightbox, added v6.64) |

---

## Shift types

| Value | Badge | Meaning |
|-------|-------|---------|
| `'RD'` | 🏠 Rest | Rest day |
| `'OFF'` | 🏠 Rest | Off day — bilingual roster only, treated identically to RD |
| `'SPARE'` | 📋 Spare | On standby, shift not yet assigned |
| `'HH:MM-HH:MM'` (type `shift`) | 📅 Shift (via Early/Late/Night badge) | Confirmed working shift — covers spare-week confirmations, changed shift times, and swaps. Stored as time string; calendar shows ☀️/🌙/🦉 based on time. Legacy types `allocated`, `overtime`, `swap` still exist in older data; displayed with original labels; editing re-saves as `shift`. |
| `'RDW'` | 💼 RDW | Rest day worked — overtime |
| `'AL'` | 🏖️ AL | Annual leave |
| `'SICK'` | 🤒 Sick | Sick day — recorded via override, shown in calendar and summary |
| `'HH:MM-HH:MM'` | ☀️ / 🌙 / 🌃 | Worked shift |

**Shift classification:**
- Early: 04:00–10:59 (`EARLY_START_THRESHOLD = 4`, `EARLY_SHIFT_THRESHOLD = 11`)
- Late: 11:00–20:59
- Night: 21:00–03:59 (`NIGHT_START_THRESHOLD = 21`)

**isWorkedDay:** Returns false for RD, OFF, SPARE, AL, SICK. True for everything else including RDW.

---

## Roster data structure

### teamMembers fields

```javascript
{
  name: 'G. Miller',       // Display name — MUST match Firestore memberName exactly
  currentWeek: 3,          // Current roster week number
  rosterType: 'main',      // 'main' | 'bilingual' | 'fixed' | 'ces' | 'dispatcher'
  role: 'CEA',             // 'CEA' | 'CES' | 'Dispatcher'
  hidden: false,           // Optional — hides from dropdown (vacancies, leavers)
  permanentShift: 'early', // Optional — forces all worked days to early or late badge
  startDate: new Date(2026, 3, 20), // Optional — getBaseShift returns 'RD' for all dates before this. Use midnight local time: new Date(year, month-1, day)
  proRatedAL: { 2026: 23 } // Optional — overrides getALEntitlement for specific years. Use for joiners who start part-way through the year. From the following year, standard entitlement applies automatically.
}
```

**AL entitlement by role** (returned by `getALEntitlement(member, year)` in `roster-data.js`):

| Role / roster type | Days |
|--------------------|------|
| CEA (main, bilingual, fixed) | 32 days/year |
| CES (`ces`) | 34 days/year |
| C. Reen (`fixed`) | 34 days/year |
| Dispatcher (`dispatcher`) | 22 base days + 1 lieu day per bank holiday actually worked that year (dynamic — checked via `countDispatcherBankHolidaysWorked(member, year)` which counts bank holidays where `getBaseShift` returns a worked shift) |

`proRatedAL[year]` overrides the above for joiners. From the year after joining, the standard entitlement resumes automatically.

### Roster types

| Type | Cycle | Notes |
|------|-------|-------|
| main | 20 weeks | Core CEA roster |
| bilingual | 8 weeks | Bilingual CEAs |
| fixed | 1 week | C. Reen, Mon–Fri 12:00–19:00 |
| ces | 10 weeks | CES Supervisors |
| dispatcher | 10 weeks | Dispatchers |

### Firestore collections

**overrides** — shift overrides entered by staff or admin

```
date         string     "YYYY-MM-DD"
memberName   string     Must match teamMembers[n].name exactly — including
                        capitalisation and punctuation. One character mismatch
                        means overrides silently fail to appear.
type         string     "spare_shift" | "shift" | "rdw" | "annual_leave" | "correction" | "sick"
                        Legacy values (still in data, no longer creatable via UI):
                        "allocated" | "overtime" | "swap" — displayed with original labels
                        in Saved Changes; editing any of these re-saves as "shift"
value        string     "HH:MM-HH:MM" for spare_shift/shift/rdw;
                        "AL" for annual_leave; "RD" for correction; "SICK" for sick
note         string     Free text — use "" if none. Field must always be present.
createdAt    timestamp  Firestore server timestamp
```

**memberSettings** — per-member preferences

```
memberName   string     Must match teamMembers[n].name exactly
faithCalendar string    'islamic' | 'hindu' | 'chinese' | 'jamaican' |
                        'congolese' | 'portuguese' | 'none'
                        Controls which cultural calendar badges appear in
                        the user's calendar view.
```

Override cache key format: `"memberName|YYYY-MM-DD"` (pipe separator)

### Authentication

Staff log in to admin.html with their name (dropdown) and surname as password (lowercase, no spaces or special characters). Example: `'G. Miller'` → `miller`. Sessions persist for 30 days via localStorage.

`CONFIG.ADMIN_NAMES = ['G. Miller']` — an array in `roster-data.js`. Members in this array have elevated admin access. To add another admin, add their name to the array (must match `teamMembers[n].name` exactly).

Firebase SDK: currently v12.10.0. Check for the current version before any new Firebase work.

---

## Key rules

- **Offline first** — Firestore is an enhancement, not a dependency. Every Firestore call needs a silent fallback to the base roster. Never block rendering waiting for Firestore.
- **Mobile is primary** — all staff use this on Android phones. Test every change at 375px.
- **Print CSS** — any new shift type, cell class, or badge needs rules inside `@media print`.
- **No `alert()`** — use `console.error()` for developer errors. No visible error text for recoverable failures.
- **Code quality** — pure functions where possible, JSDoc on all functions, meaningful variable names, error handling on all async operations.

---

## Known issues & deferred work

### 🟠 High priority

**ROSTER_SECRET exposed in page source** — The bearer token for `parseRosterPDF` is currently hardcoded as a constant in `admin-app.js` (visible in browser DevTools). Deferred as a known limitation. The correct long-term fix is to gate the Cloud Function on Firebase Auth custom claims (`request.auth.token.admin == true`) rather than a shared secret. Do not rotate the secret without also updating the hardcoded value and redeploying.

**#14 — localStorage session can be forged for UI access.** DevTools can modify `myb_admin_session` to impersonate another user or gain the admin UI. However, since v7.94 the Firestore security rules are deployed and require a real Firebase Auth session (`request.auth != null`) for all writes — so a forged localStorage session can read the UI but cannot write to Firestore. Practical risk is low for a small known team.

**Override cache architecture (v7.84–7.91):** `rosterOverridesCache` in `app.js` is keyed `"memberName|date"` and stores overrides for ALL members — it is never cleared on member switch. `fetchOverridesForRange()` uses priority-based deduplication: `source: 'manual'` always beats `source: 'roster_import'`; same-source entries keep the newer `createdAt`. A `console.warn` is logged whenever a duplicate is detected — check DevTools Console if overrides still appear inconsistently. Swipe navigation calls `ensureOverridesCached()` after the animation completes (v7.86) so adjacent months are fetched even after a member switch clears `fetchedMonths`. Delete stale duplicate Firestore documents in the Firebase Console to clean up at source.

### 🟡 UX decisions on hold (needs discussion before implementing)

- **Admin button label** — The 🔒 Admin button implies manager-only access, but all staff need it to record their own AL and enable notifications. Consider renaming (e.g. "My Shifts") or splitting into separate staff and admin entry points. Requires discussion about branding and URL structure before changing.
- **Shift type count** — The admin type selector has 8 types. RDW/Overtime/Swap/Allocated are subtly different and create cognitive load for infrequent users. Consider whether any can be merged or renamed for clarity. Requires discussion about operational use before changing.

### 🟢 UX ideas — explored but held back

- **Bottom navigation bar** — Persistent fixed tab bar (📅 Roster · 💷 Pay · 🔐 Admin) on mobile. Prototyped at v7.66, reverted — felt like clutter at current scale. The app has no persistent in-page navigation between its three pages (Calendar, Pay, Admin), which makes it feel like three separate apps. Team Week View (v8.22) is in-page navigation within the calendar — it does not address cross-page navigation. Approach if revisited: sticky bottom bar on mobile (≤600px), top nav strip on desktop. PWA shortcuts (long-press app icon) already provide Calendar / Pay / Admin — this would be the in-app equivalent.
- **Glanceable summary strip** — Four chips on the calendar home screen: This week's shifts / Next RD / Leave remaining / Next payday. Prototyped at v7.66, reverted — adds visual noise between controls and calendar. The data is already computed; the question is presentation. Consider implementing as a collapsible strip or integrating into the month header rather than inserting between controls and grid. Of the four chips, "Next payday" and "Next RD" are highest value — consider just those two.
- **Pay result text hierarchy** — The £ amount on the pay result card is already 52px. The supporting text ("Estimated take-home", period dates) is small and grey. Slightly larger supporting text (13–14px, medium grey rather than faint) would improve scannability without a full redesign. Very low effort.

---

## Huddle ingest — automated briefing upload

Daily Huddle PDF/DOCX arrives by email → Power Automate flow → `ingestHuddle` Cloud Function (`europe-west2`) → Firebase Storage (`huddles/YYYY-MM-DD.{ext}`) + Firestore `huddles` collection (doc ID = date, fields: `date`, `storageUrl`, `fileType`, `uploadedAt`, `uploadedBy`). Push notification sent to subscribed staff on each ingest.

All working end-to-end. Pending: Huddle viewer history UI in admin.html (Firestore data is ready, UI not yet built — query `huddles` descending by `date`, show date + file type + `storageUrl` link, admin-only).

Full Power Automate flow diagram, request format, gotchas, secret setup, and Security Rules: see `OPERATIONS_REFERENCE.md`.

---

## Weekly Roster Upload

Admin uploads weekly PDF → `parseRosterPDF` Cloud Function (`europe-west2`, `claude-haiku-4-5-20251001`) → Claude AI reads the table → JSON of shifts → review UI → admin approves → saved to Firestore. All working for CEA/Bilingual, CES, and Dispatcher rosters.

| File | Role |
|------|------|
| `functions/index.js` | `parseRosterPDF` Cloud Function |
| `admin-roster-upload.js` | Upload form, `computeCellStates()`, `renderReviewTable()`, `shiftDisplay()`, `shiftValueToOverrideType()` |
| `admin.html` | Weekly Roster card (admin-only, collapsible) |

**Critical: `RDW|HH:MM-HH:MM` pipe encoding** — RDW shifts come back from the AI as `"RDW HH:MM-HH:MM"`, normalised to `"RDW|HH:MM-HH:MM"` in the review pipeline, then stripped to a plain time string when saved to Firestore (`type: 'rdw'`). Do not strip `RDW` from the AI return value — it is the only reliable RDW signal on SPARE-week days.

**`source: 'roster_import'`** — All roster-upload overrides carry this field. `computeCellStates()` uses it to show `COVERED` (unchanged re-upload), `DIFF` (changed), or `CONFLICT` (conflicts with a hand-entered override).

Full request/response format, AI prompt rules, and review pipeline: see `OPERATIONS_REFERENCE.md`.

---

## Annual maintenance reminder — cultural calendar data

**15 lunar/lunisolar calendar datasets need updating each year** (typically in November/December before the new year begins):

| Calendar | Datasets to update |
|----------|--------------------|
| Islamic  | Ramadan, Eid al-Fitr, Eid al-Adha, Islamic New Year, Mawlid |
| Hindu    | Holi, Navratri, Dussehra, Diwali, Raksha Bandhan |
| Chinese  | New Year, Lantern Festival, Qingming, Dragon Boat, Mid-Autumn |

Jamaican, Congolese, and Portuguese calendars are **rule-based** (fixed-date or Easter-relative) and auto-compute — no annual update needed.

**Sources:** islamicfinder.org · drikpanchang.com (London timezone) · chinesenewyear.net

`warnIfCulturalCalendarMissingYear()` in `roster-data.js` logs a console warning automatically if any of these datasets are missing data for the current year.

---

## Firebase Auth (complete — v7.94)

Firebase Auth accounts exist for all staff. Firestore security rules are deployed and require `request.auth != null` for all writes. `admin-app.js` signs in via Firebase Auth after each localStorage login — the localStorage session controls UI access, Firebase Auth controls Firestore write access.

**Adding a new staff member:** Add to `teamMembers` in `roster-data.js`, then open admin.html → **Staff Login Accounts** → **Set up accounts** — existing accounts are skipped, only the new one is created.

**Removing a staff member:** Set `hidden: true` in `teamMembers`, run **Set up accounts** with "Disable accounts for leavers" ticked. Firebase Auth account disabled; Firestore data preserved.

Email/password convention: see `OPERATIONS_REFERENCE.md`.

---

## Pay calculator — current reality (v8.21+)

The pay calculator is primarily **manual-entry**. Staff enter their hours, and the calculator computes tax, NI, pension, and take-home pay.

**Grades supported:** CEA and CES. Dispatch is not yet supported — rates not confirmed.

| Grade | 2025/26 rate | Contracted hrs | Pension | London Allowance |
|-------|-------------|----------------|---------|-----------------|
| CEA   | £20.74/hr   | 140/period     | £154.77 | £276.16         |
| CES   | £21.81/hr   | 140/period     | £154.77 | £276.16         |

2026/27 rates: not yet confirmed for either grade — update `GRADES` in `paycalc.js` when announced.

Grade is auto-detected from the logged-in member's `role` field on first visit. CES staff get CES pre-selected; CEA is the default. Staff can change grade in Settings. All rate fallbacks (in `saveSettings`, `calculate`, HPP accumulation) use the selected grade default — never hardcoded CEA.

**Members with a `startDate`:** If a member started mid-period, `getEffectiveContr(p)` pro-rates their contracted hours. A notice banner in the Hours card explains the adjustment. Subsequent full periods use the full 140 hours automatically.

The **roster-assist hint bar** ("Fill from roster →") is a convenience feature, not a data pipeline:
- Reads **base roster** (`roster-data.js`) plus Firestore overrides (via `fetchOverrideSpecialDaysForPeriod`) for the current period — works offline on base roster, improves with overrides when online
- Counts Saturday, Sunday, bank holiday, Boxing Day, and RDW shifts and pre-fills those hours fields
- Does **not** fill standard weekday hours — staff enter those manually
- Pre-filled fields turn gold; editing them removes the highlight

The calculator is **not** a payslip replacement — it estimates take-home pay based on staff-entered data. Actual payslips from Chiltern may differ due to adjustments, arrears, and deductions not captured here.

**Sticky take-home bar (v8.13):** On mobile a fixed bar at the bottom of the screen shows the estimated take-home amount when the result card has scrolled off screen. Implemented with `IntersectionObserver` in `paycalc.js`. Hidden on desktop (≥1040px). Tapping the bar scrolls to the result card.

---

## FIP guide — positioning and review criteria

The FIP guide (`fip.html`) lives inside the Admin / Tools area. It is **not** a core daily-use workflow like the Calendar, Pay Calculator, or Change a Shift flow.

**Purpose:**
- Educational and reference sheet for staff European travel facilities (FIP Card and coupons)
- Helps staff understand and make better use of FIP, which is currently underused
- Designed for occasional use — someone planning a trip, not someone opening the app every day

**How to judge it in reviews:**
Judge `fip.html` as a **low-frequency educational reference page**, not as a core workflow or dashboard. It is correct and intentional that it feels more article-like than the main app pages. Do not flag its reference-page nature as a design defect.

Still care about:
- Factual accuracy of FIP rules and fares
- Clear "last checked" date in the header
- RDG/RST source links visible and correct
- Warnings about exceptions (private operators, coupons not valid on specific trains)
- Readable mobile layout
- Basic visual consistency with the rest of the app (shared CSS, navy/gold palette)

Do not require:
- Dashboard-style layout density matching Calendar or Pay Calculator
- The same level of Firestore/data integration as the core workflows
- Heavy interactivity — collapsible country cards are sufficient

**Design guidance:**
- May feel more like a reference guide than a main app screen — this is correct
- Does not need a two-column desktop layout like the pay calculator
- Keep "last checked" and source links visible because FIP rules change frequently
- Avoid overconfident wording on country-specific rules — use "check RDG/RST before booking" where details may change
