# Claude Code Instructions — MYB Roster App

## Project identity — read this first

| Property | Value |
|----------|-------|
| GitHub repository | `Garethdavidmiller/roster-app` |
| Firebase project ID | `myb-roster` |
| Firebase project region | `europe-west2` (London) |
| Current app version | `7.91` (check `roster-data.js` — `APP_VERSION` is the authoritative source) |
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

---

## Version bumping (MANDATORY on every change)

**As of v6.63:** JS is now in separate files. You need to update **twenty** places:

| File | Location | Example |
|------|----------|---------|
| `roster-data.js` | `export const APP_VERSION = '...'` | `APP_VERSION = '4.95'` ← **primary source** |
| `service-worker.js` | Line 1 comment | `// MYB Roster — Service Worker v4.95` |
| `service-worker.js` | `const APP_VERSION = '...'` | `APP_VERSION = '4.95'` ← must match |
| `index.html` | Line 2 HTML comment | `<!-- MYB Roster Calendar - Version 4.95 -->` |
| `index.html` | `<script src="./app.js?v=...">` | `app.js?v=4.95` |
| `index.html` | `<link rel="stylesheet" href="./shared.css?v=...">` | `shared.css?v=4.95` |
| `index.html` | `<link rel="manifest" href="manifest.json?v=...">` | `manifest.json?v=4.95` |
| `admin.html` | Line 2 HTML comment | `<!-- MYB Roster Admin v4.95 -->` |
| `admin.html` | `<script src="./admin-app.js?v=...">` | `admin-app.js?v=4.95` |
| `admin.html` | `<link rel="stylesheet" href="./shared.css?v=...">` | `shared.css?v=4.95` |
| `admin.html` | `<link rel="manifest" href="manifest.json?v=...">` | `manifest.json?v=4.95` |
| `app.js` | `import ... from './roster-data.js?v=...'` | `roster-data.js?v=4.95` |
| `app.js` | `import ... from './firebase-client.js?v=...'` | `firebase-client.js?v=4.95` |
| `admin-app.js` | `import ... from './roster-data.js?v=...'` | `roster-data.js?v=4.95` |
| `admin-app.js` | `import ... from './firebase-client.js?v=...'` | `firebase-client.js?v=4.95` |
| `paycalc.html` | Line 2 HTML comment | `<!-- MYB Roster — Pay Calculator v4.95 -->` |
| `paycalc.html` | `<script src="./paycalc.js?v=...">` | `paycalc.js?v=4.95` |
| `paycalc.html` | `<link rel="stylesheet" href="./shared.css?v=...">` | `shared.css?v=4.95` |
| `paycalc.html` | `<link rel="manifest" href="./pay-manifest.json?v=...">` | `pay-manifest.json?v=4.95` |
| `paycalc.js` | `import ... from './roster-data.js?v=...'` | `roster-data.js?v=4.95` |

`CONFIG.APP_VERSION` and `ADMIN_VERSION` read from `CONFIG.APP_VERSION` which is set inside `roster-data.js` — no manual update needed for those.

- Increment the patch number for every commit that touches app behaviour
- The `?v=` cache-busting strings **must** be updated manually (browsers use them to bust the module cache)
- Tell the user the new version number in your reply after committing

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
├── paycalc.js              ← all JavaScript for paycalc.html
├── roster-data.js          ← shared module: APP_VERSION, CONFIG, teamMembers, all roster data, utility functions
├── firebase-client.js      ← shared module: Firebase init (one place), exports db + all Firestore functions
├── shared.css              ← CSS shared by all three pages
├── service-worker.js       ← single SW for all pages; cache name includes app version, e.g. myb-roster-v7.68
├── manifest.json           ← PWA manifest for main app (index.html + admin.html)
├── pay-manifest.json       ← PWA manifest for pay calculator (paycalc.html)
├── paycalc-guide.html      ← printable pay calculator reference guide (linked from pay calculator about lightbox)
├── fip.html                ← FIP European travel guide for staff (linked from admin.html)
├── guide.html              ← printable staff + admin quick guide (update at major versions: v7, v8 …)
├── icon-*.png              ← 6 sizes: 120, 152, 167, 180, 192, 512
└── functions/
    ├── index.js            ← Firebase Cloud Functions: ingestHuddle + parseRosterPDF + setupRosterAuth
    └── package.json        ← Node 20; firebase-admin, firebase-functions, @anthropic-ai/sdk
```

**Service worker caching strategy:**
- Network-first: `index.html`, `admin.html`, `app.js`, `admin-app.js`, `paycalc.html`, `paycalc.js`, `roster-data.js`, `firebase-client.js`, `shared.css` — must always be fresh
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
| Two separate type pill lists in admin | Per-row pills are generated by `renderWeekGrid()` in `admin-app.js` (JS template string, line ~782). Bulk bar pills are in `admin.html` (static HTML, line ~2215). **Both lists must be kept in sync.** Adding a new type requires updating both. The order must also match. Current order: AL · Spare · Shift · RDW · Absence · Rest Day |
| **`AL` pill label must stay as `AL`** | The pills are compact by design — mobile layout requires short labels. `AL` is the standard Chiltern abbreviation staff already know from their rosters. Do not expand to "Annual Leave" without discussing the layout impact first. |
| **`🪑` is the absence emoji — do not change to `🤒` or any illness-specific icon** | Absence covers sickness, childcare, bereavement, and any other reason. Using 🤒 (sick face) would imply illness, which is a GDPR concern — the reason for absence is deliberately never stored. The neutral chair emoji was chosen for this reason. **Always ask Gareth before changing the absence icon.** |
| `_staleMemberName` flag in `app.js` | When `getSelectedMemberIndex()` cannot find a saved name in `teamMembers`, it sets `_staleMemberName` to the old name, removes it from localStorage, and falls back to the default member. `renderCalendar()` checks this flag on its next run and shows a dismissible banner: "{name} is no longer in the roster — now showing {new name}'s calendar." The flag is cleared after the banner fires to avoid repeat shows. |
| Sync chip state machine in `app.js` | The chip follows: hidden → (800ms delay) → "↻ Updating your shifts…" → "✓ Up to date" (auto-removes after 1.5s) or "⚠ Couldn't update — tap to retry" (stays visible, 10s timeout). Never show raw error messages to staff. CSS classes: `sync-chip-ok` (green) / `sync-chip-error` (red, underlined, clickable). |
| `_clearState` object in `paycalc.js` | Replaces the old `_clearPending` / `_clearTimer` pair. Adds `countdownTimer` for a live countdown in the button label ("Tap again to confirm (3)"). Pattern: one object groups all state for a two-tap destructive action so the state is easy to reset atomically. |
| `CONDITIONAL_ROWS` in `paycalc.js` | Data-driven array that maps a condition function → row IDs → field IDs. `updateBhRows(p)` iterates it to show/hide bank holiday rows and clear their values. Adding future conditional rows means adding one entry to the array, not writing new show/hide logic. |

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
| `getRosterSuggestion(period)` | `paycalc.js` — reads the logged-in member from localStorage, calls `getBaseShift` for each day in the period window, returns counts of Saturday/Sunday/BH/Boxing Day shifts. Used by the "Fill from roster →" hint bar in the Hours card. Also reads Firestore overrides (via `fetchOverrideSpecialDaysForPeriod`) to detect RDW and updated shifts when online. |
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

**#14 — Authentication is client-side only.** The localStorage session can be forged via DevTools. Firebase Auth is partially implemented (v7.61 — see "Firebase Auth migration" section below), but the Firestore security rules haven't been deployed yet. Completing the migration requires running `setupRosterAuth` then deploying the updated rules. **Do not deploy the rules before accounts exist** — all Firestore writes will fail and the app will break for everyone.

**Override cache architecture (v7.84–7.91):** `rosterOverridesCache` in `app.js` is keyed `"memberName|date"` and stores overrides for ALL members — it is never cleared on member switch. `fetchOverridesForRange()` uses priority-based deduplication: `source: 'manual'` always beats `source: 'roster_import'`; same-source entries keep the newer `createdAt`. A `console.warn` is logged whenever a duplicate is detected — check DevTools Console if overrides still appear inconsistently. Swipe navigation calls `ensureOverridesCached()` after the animation completes (v7.86) so adjacent months are fetched even after a member switch clears `fetchedMonths`. Delete stale duplicate Firestore documents in the Firebase Console to clean up at source.

### 🟡 UX decisions on hold (needs discussion before implementing)

- **Admin button label** — The 🔒 Admin button implies manager-only access, but all staff need it to record their own AL and enable notifications. Consider renaming (e.g. "My Shifts") or splitting into separate staff and admin entry points. Requires discussion about branding and URL structure before changing.
- **Shift type count** — The admin type selector has 8 types. RDW/Overtime/Swap/Allocated are subtly different and create cognitive load for infrequent users. Consider whether any can be merged or renamed for clarity. Requires discussion about operational use before changing.

### 🟢 UX ideas — explored but held back

- **Bottom navigation bar** — Persistent fixed tab bar (📅 Roster · 💷 Pay · 🔐 Admin) on mobile. Prototyped at v7.66, reverted — felt like clutter at current scale. Reassessed: this is the single highest-return UX improvement available — the app currently has no persistent navigation between its three pages, which makes it feel like three separate apps. Approach: sticky bottom bar on mobile (≤600px), top nav strip on desktop. See ROADMAP.md → "UX experiments" for implementation notes.
- **Glanceable summary strip** — Four chips on the calendar home screen: This week's shifts / Next RD / Leave remaining / Next payday. Prototyped at v7.66, reverted — adds visual noise between controls and calendar. The data is already computed; the question is presentation. Consider implementing as a collapsible strip or integrating into the month header rather than inserting between controls and grid.

---

## Huddle ingest — automated briefing upload

### What it does

The daily Huddle briefing arrives as an email with a PDF or DOCX attachment. A Power Automate flow detects it, extracts the file, and calls a Firebase Cloud Function (`ingestHuddle`) which stores the file in Firebase Storage and writes a metadata record to Firestore. This mirrors what admin staff would otherwise do manually through admin.html.

### Files

| File | Purpose |
|------|---------|
| `functions/index.js` | Three Cloud Functions: `ingestHuddle` (Power Automate upload), `parseRosterPDF` (AI roster parser), `sendHuddlePushNotifications` (fan-out Web Push on new Huddle) |
| `functions/package.json` | Node 20; `firebase-admin`, `firebase-functions`, `@anthropic-ai/sdk` as dependencies |

### Firebase Storage

Files are stored at: `huddles/YYYY-MM-DD.pdf` or `huddles/YYYY-MM-DD.docx`

Each file is uploaded with a custom `firebaseStorageDownloadTokens` metadata field so a stable direct download URL is available immediately after upload.

Download URL format:
```
https://firebasestorage.googleapis.com/v0/b/{bucket}/o/huddles%2FYYYY-MM-DD.pdf?alt=media&token={uuid}
```

### Firestore — `huddles` collection

Document ID = `YYYY-MM-DD` (the London date of the huddle).

```
date        string     "YYYY-MM-DD"
storageUrl  string     Full Firebase Storage download URL (with token)
fileType    string     "pdf" | "docx"
uploadedAt  timestamp  Firestore server timestamp
uploadedBy  string     "power-automate" (hardcoded — identifies automated uploads)
```

### Cloud Function — `ingestHuddle`

- **Region:** `europe-west2` (London)
- **Auth:** `Authorization: Bearer <HUDDLE_SECRET>` — secret stored in Firebase Secret Manager, accessed via `defineSecret('HUDDLE_SECRET')`
- **Method:** POST only

**Request format** (this is critical — do not change without updating the Power Automate flow):

```
Headers:
  Authorization:      Bearer <secret>
  Content-Type:       text/plain
  X-Huddle-Date:      YYYY-MM-DD
  X-Huddle-Filename:  original-name.pdf   (or .docx)

Body:
  Raw base64-encoded file content — plain text, no JSON wrapper
```

**Why plain-text body instead of JSON?**
Power Automate's `@{body('...')?['contentBytes']}` template substitution in a JSON body has a practical size limit and silently truncates large base64 strings (a 190 KB PDF produces a ~256,000-char base64 string). Putting the file in the raw body as `text/plain` bypasses this entirely. Metadata goes in custom headers instead.

**Body reading:** The function reads `req.rawBody` first (Firebase Functions runtime provides this); falls back to streaming the request if rawBody is unavailable. Never use an Express body-parser — it consumes the stream before the function can read it.

**File type detection:** Based on the `X-Huddle-Filename` header extension (`.docx` → DOCX; anything else → PDF). Never rely on `Content-Type` from Power Automate as it sends `text/plain` for both.

**Deploying the function:**

Gareth's GitHub repo is **online-only** — he does not have a local clone. All deploys happen via GitHub Actions. To trigger a deploy of the Cloud Function, commit a change to any file under `functions/` and push to `main`. The workflow (`.github/workflows/deploy-functions.yml`) runs automatically.

If the workflow shows "Skipped (No changes detected)" it means Firebase compared the deployed function hash with the local build and found no difference — this is normal and means the function is already up to date.

For first-time secret setup (must be done once from a machine with `firebase-tools` installed, or via the Firebase Console):
```bash
firebase login
firebase use myb-roster
firebase functions:secrets:set HUDDLE_SECRET   # paste a strong random UUID when prompted
cd functions && npm install
```

The `HUDDLE_SECRET` must exist in **two places**:
1. Firebase Secret Manager (so the Cloud Function can read it at runtime)
2. GitHub Actions secrets (not directly used by the function, but useful to have the same value documented)

**Generating a secret:**
```
node -e "console.log(require('crypto').randomUUID())"
```

**Finding secrets in Firebase Console:**
In Firebase Console, go to the project → Build → Functions → then look for "Secret Manager" in the left nav (it may be under Google Cloud Console → Security → Secret Manager for project `myb-roster`). The secret is named `HUDDLE_SECRET`.

### Power Automate flow — "huddle ingest"

The flow is built in Power Automate (Microsoft 365). Gareth's organisation provides access. The HTTP connector used is the **HTTP** (Premium) connector — not "Send an HTTP request (Office 365)".

**Trigger:** "When a new email arrives (V3)" on the Huddle mailbox, filtered to emails with attachments.

**Overall structure:**

```
Trigger: new email with attachment
│
├── Compose: London_time
│   convertTimeZone(triggerOutputs()?['body/receivedDateTime'],
│                   'UTC', 'GMT Standard Time', 'yyyy-MM-dd')
│
├── Set variable: huddleDate  ← outputs('London_time')
│
└── Condition: is it after noon? (to avoid duplicate early-morning emails)
    │
    ├── YES branch (afternoon/main email):
    │   ├── Filter array: filter_array_1
    │   │   From: triggerOutputs()?['body/attachments']
    │   │   Condition: item()?['contentType']  is equal to  application/pdf
    │   │             (LEFT = expression tab; RIGHT = value tab)
    │   │
    │   ├── Compose: attachment
    │   │   body('filter_array_1')[0]?['contentBytes']
    │   │
    │   └── HTTP action (Premium)
    │       Method: POST
    │       URI: https://europe-west2-myb-roster.cloudfunctions.net/ingestHuddle
    │         (URI goes in value tab, NOT expression tab)
    │       Headers:
    │         Authorization  →  Bearer <paste secret here>  (value tab)
    │         Content-Type   →  text/plain                  (value tab)
    │         X-Huddle-Date  →  @{variables('huddleDate')}  (value tab, @{} syntax)
    │         X-Huddle-Filename → @{body('filter_array_1')[0]?['name']}  (value tab)
    │       Body: @{outputs('attachment')}  (value tab, @{} syntax — NOT expression tab)
    │
    └── NO branch (morning/DOCX email):
        ├── Filter array: filter_array_2
        │   From: triggerOutputs()?['body/attachments']
        │   Condition: item()?['contentType']  is equal to
        │     application/vnd.openxmlformats-officedocument.wordprocessingml.document
        │             (LEFT = expression tab; RIGHT = value tab)
        │
        ├── Compose: attachment
        │   body('filter_array_2')[0]?['contentBytes']
        │
        └── HTTP action (Premium)
            (same structure as YES branch but references filter_array_2 and filter_array_2's name)
```

### Critical Power Automate gotchas — read carefully

**1. Expression tab vs value tab**
Power Automate input fields have two modes: "Expression" (for dynamic functions/variables) and "Value" (for static text). Getting this wrong silently breaks the flow:

| What you're entering | Which tab |
|---------------------|-----------|
| `item()?['contentType']` — left side of filter condition | Expression |
| `application/pdf` — right side of filter condition | Value |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` — right side of DOCX filter | Value |
| `body('filter_array_1')[0]?['contentBytes']` — Compose source | Expression |
| The Cloud Function URL | Value |
| `Bearer <secret>` — Authorization header value | Value |
| `text/plain` — Content-Type header value | Value |
| `@{variables('huddleDate')}` — X-Huddle-Date header value | Value (the @{} syntax works in value tab) |
| `@{body('filter_array_1')[0]?['name']}` — X-Huddle-Filename | Value |
| `@{outputs('attachment')}` — HTTP body | Value |

**2. Filter array returning empty — the most common failure**
If `body('filter_array_1')[0]` or `body('filter_array_2')[0]` throws "array index 0 cannot be selected from empty array", the filter returned nothing. Check:
- Left side of condition is on the **expression** tab (if on value tab it compares literal string `"item()?['contentType']"` which never matches)
- Right side MIME type has no typos — the DOCX one is 71 characters and easy to mistype
- "From" field references `triggerOutputs()?['body/attachments']` directly — not a previous filter's output

**3. London timezone**
The Compose action that calculates the huddle date must be named `London_time` (underscore, not space). Power Automate action names with spaces are accessible via expressions but cause `InvalidTemplate` errors in some contexts. Always use underscores in action names.

Expression used:
```
convertTimeZone(triggerOutputs()?['body/receivedDateTime'], 'UTC', 'GMT Standard Time', 'yyyy-MM-dd')
```
Note: `'GMT Standard Time'` has spaces — `'GMTStandardTime'` (no spaces) is invalid.

**4. `@{}` syntax in value tab**
To reference a dynamic value in a header or body field while on the **value tab**, use `@{expression}` syntax — for example `@{variables('huddleDate')}`. Do not switch to expression tab for this; the @{} wrapper is how Power Automate interpolates expressions inside value-tab strings.

**5. HTTP action references**
The HTTP action body cannot reference a Compose action by name inside the action's own "inputs" scope. Always use a separate Compose action to prepare the value first, then reference it as `@{outputs('attachment')}` in the HTTP body.

### Power Automate flow — condition logic

The flow sends Huddle emails to the correct branch based on when they arrive:
- **Yes branch (after noon):** Assumed to be the main/final PDF version. Filters for `application/pdf`.
- **No branch (before noon):** Assumed to be the morning DOCX draft. Filters for the full DOCX MIME type.

The condition expression checks the received time in London timezone:
```
greater(int(formatDateTime(outputs('London_time'), 'HH')), 12)
```

### Firestore Security Rules — `huddles` collection

The `huddles` collection is written only by the Cloud Function (server-side, authenticated via service account — bypasses Security Rules). The Security Rules for client-side reads should be:

```
match /huddles/{docId} {
  allow read: if true;   // all authenticated staff can read huddle links
  allow write: if false; // writes only via Cloud Function (server-side)
}
```

If `allow write: if false` blocks the Cloud Function, that is a misconfiguration — the Admin SDK bypasses Security Rules entirely. Client-side writes (from the browser) are correctly blocked.

### Current status

- ✅ Cloud Function `ingestHuddle` deployed and live
- ✅ PDF and DOCX upload via Power Automate — working end to end
- ✅ Push notifications live (v6.11) — VAPID keys configured, Cloud Function `sendHuddlePushNotifications` deployed. Staff subscribed via admin.html receive a notification when a new Huddle is ingested.
- ✅ Power Automate flow redesigned (v6.x): condition now only sets `huddleDate` (today vs tomorrow for afternoon emails). A single Filter Array after the condition accepts both `.pdf` and `.docx` using an OR expression on file extension. One HTTP action sends whichever attachment arrived — no time-based PDF/DOCX branching.
- ✅ DOCX huddles open correctly in the `📋 Huddle` button (v6.95) — `fileType` field from Firestore used to construct the correct download URL.
- ⏳ Huddle viewer history in admin.html — not yet built. Firestore `huddles` collection is populated and ready; the staff-facing `📋 Huddle` button in index.html already shows the latest huddle.

### Next steps for huddle viewer UI

When building the viewer in admin.html:
- Query the `huddles` Firestore collection, order by `date` descending
- Display date, file type badge, and a download link using `storageUrl`
- The `storageUrl` already contains the access token — open directly in a new tab
- Admin-only section (check `CONFIG.ADMIN_NAMES.includes(currentUser)`)
- Follow the existing file pattern — JS stays in `admin-app.js`, HTML/CSS in `admin.html`

---

## Weekly Roster Upload

### What it does

Admin uploads the weekly PDF roster. A Cloud Function (`parseRosterPDF`) passes the PDF directly to Claude AI, which reads the table and returns each person's shifts as JSON. The app then compares those shifts against the base roster and any existing Firestore overrides, shows a per-person review UI, and saves only the changes the admin approves.

### Files

| File | Role |
|------|------|
| `functions/index.js` | `parseRosterPDF` Cloud Function — receives PDF, calls Claude AI, returns parsed shifts |
| `admin-app.js` | Upload form, `computeCellStates()`, `renderReviewTable()`, `shiftDisplay()`, `shiftValueToOverrideType()` |
| `admin.html` | Weekly Roster card (admin-only, collapsible) |

### Cloud Function — `parseRosterPDF`

- **Region:** `europe-west2` (London)
- **Auth:** `Authorization: Bearer <ROSTER_SECRET>`
- **Method:** POST only
- **AI model:** `claude-haiku-4-5-20251001`, `max_tokens: 8192`
- **Why direct PDF input:** The PDF is passed as a `type: 'document'` content block, not extracted text. Text extraction (pdf-parse) destroys the table column structure and causes day-column misalignment. Claude reads the visual layout directly.

**Request format:**

```
Headers:
  Authorization:   Bearer <ROSTER_SECRET>
  Content-Type:    text/plain
  X-Week-Ending:   YYYY-MM-DD  (must be a Saturday — validated server-side)
  X-Roster-Type:   cea | ces | dispatcher

Body:
  Raw base64-encoded PDF content (same pattern as ingestHuddle)
```

**Response format:**

```json
{
  "weekEnding": "2026-04-05",
  "rosterType": "cea",
  "dates": ["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"],
  "parsed": [
    {
      "memberName": "G. Miller",
      "shifts": {
        "2026-03-30": "RD",
        "2026-03-31": "06:00-14:00",
        "2026-04-01": "RDW|14:30-22:00",
        ...
      }
    }
  ]
}
```

### Critical encoding convention — `RDW|HH:MM-HH:MM`

The roster PDF marks RDW cells as e.g. `"14:30-22:00 RDW"`. The AI is instructed to return `"RDW HH:MM-HH:MM"`. `normaliseShift()` in `functions/index.js` converts this to `"RDW|HH:MM-HH:MM"` — the pipe-encoded internal format.

**Why this matters:** The previous approach stripped the RDW keyword and inferred it from `baseShift === 'RD'`. That failed on SPARE weeks (`baseShift = 'SPARE'`). The pipe encoding carries the RDW flag explicitly regardless of base shift.

The `|` prefix is stripped before saving to Firestore — the stored value is always the plain time string (`"14:30-22:00"`), with `type: 'rdw'` carrying the meaning. The encoding only exists inside the review pipeline.

### AI prompt key rules (do not weaken these without testing)

- RDW cells: AI returns `"RDW HH:MM-HH:MM"` — **never strip RDW from the return value**
- Blank/absent Sunday cells: return `"RD"` — do not copy Monday's shift
- Duty/diagram codes on a second line in the same cell (e.g. `"CEA 16"`, `"CEA 18"`) — **ignore entirely**, only the first line contains the shift value
- `"N/A"`, `"NA"`, `"NS"` all mean RD on any day
- `"AL"`, `"A/L"`, `"A.L."` all mean annual leave — return `"AL"`

### Review pipeline (admin-app.js)

```
parsedResult (from Cloud Function)
        ↓
computeCellStates(parsedResult, existingOverrides)
  — classifies each day:
    MATCH    = PDF matches base roster, nothing to do
    DIFF     = PDF differs from base roster, needs saving
    CONFLICT = manual override already exists but differs from PDF
    COVERED  = manual override already matches PDF, nothing to do
        ↓
renderReviewTable() — per-person card list
  shiftDisplay(shiftStr, baseShift)
    — detects "RDW|" prefix → shows 💼 RDW badge + time
    — falls back to baseShift==='RD' detection for plain times
        ↓
Apply approved changes:
  shiftValueToOverrideType(value, baseShift) → Firestore type field
  Strip "RDW|" prefix → save plain time as value
  source: 'roster_import' on all saved docs
    (distinguishes auto-applied from hand-entered overrides)
```

### Cell state — `source` field

Overrides saved by the roster upload have `source: 'roster_import'`. In `computeCellStates`, a previous import is compared against the new PDF value:
- If the new PDF **matches** the previous import → `COVERED` (no re-approval needed)
- If the new PDF **differs** from the previous import → `DIFF` (re-approve only the changed shifts)

Only overrides with no `source` field (or any other value) are treated as manual and trigger the `CONFLICT` state.

### Current status

- ✅ Cloud Function deployed and live
- ✅ PDF parsing via Claude AI — working end to end for CEA/Bilingual, CES, Dispatcher rosters
- ✅ Review UI — per-person card list with approve/skip per day, conflict detection
- ✅ RDW detection on both RD and SPARE base shifts
- ✅ AL, Sick, Spare, RD correction all correctly mapped to override types

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

## Firebase Auth migration (v7.61 — two-phase rollout)

### What was done (v7.61)

Firebase Auth is now wired into the app, but the Firestore security rules haven't been deployed yet. The implementation is intentionally non-breaking — existing localStorage sessions continue to work exactly as before.

**Changes in v7.61:**

- **`firebase-client.js`**: Added Firebase Auth SDK import. Exports `auth`, `signInWithEmailAndPassword`, `signOut`, and `nameToEmail(fullName)`.
- **`admin-app.js`**: After a successful localStorage login, also calls `signInWithEmailAndPassword` with the Firebase Auth email and password (fire-and-forget — silently ignored if the account doesn't exist yet). Sign-out also calls Firebase `signOut`.
- **`functions/index.js`**: New `setupRosterAuth` Cloud Function creates Firebase Auth accounts for all roster members (idempotent — safe to re-run).
- **`firestore.rules`**: Updated to require `request.auth != null` for all writes and deletes. **Not yet deployed** — see deployment steps below.

### Email and password convention

| Display name | Firebase email | Firebase password |
|---|---|---|
| G. Miller | g.miller@myb-roster.local | miller |
| C. Francisco-Charles | c.franciscocharles@myb-roster.local | franciscocharles |
| L. Atrakimaviciene | l.atrakimaviciene@myb-roster.local | atrakimaviciene |

Function: `nameToEmail(name)` in `firebase-client.js` and `nameToEmail(name)` / `nameToPassword(name)` in `functions/index.js` — both must stay in sync with `getSurname()` in `admin-app.js`.

The `@myb-roster.local` domain is synthetic — these are not real email addresses. Firebase Auth accepts them as valid email format.

### Phase 2 — completing the migration

Run this once after the v7.61 Cloud Functions deploy has finished:

```bash
curl -X POST \
  -H "Authorization: Bearer <ROSTER_SECRET>" \
  https://europe-west2-myb-roster.cloudfunctions.net/setupRosterAuth
```

The response will list `created`, `skipped`, and `failed` accounts. Once `failed` is empty, deploy the updated Firestore rules:

```bash
firebase deploy --only firestore:rules
```

**Do not deploy the rules before running `setupRosterAuth`** — if staff accounts don't exist in Firebase Auth, all Firestore writes will fail and the app will break for everyone.

### Adding a new staff member

When a new team member is added to `teamMembers` in `roster-data.js`:
1. Add their name to `ROSTER_MEMBERS` in `functions/index.js` (same array used by `setupRosterAuth`).
2. Re-run `setupRosterAuth` (idempotent — existing accounts are skipped).
3. The new account is ready immediately. No Firestore rule change needed.

---

## Pay calculator — current reality (v7.91+)

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

---
