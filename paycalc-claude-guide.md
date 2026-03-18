# Claude Code Instructions — MYB Payday Calculator

## What this project is

This is the **payday calculator** for the MYB (Metrobus/Yeoman/Bicester?) Roster App — a
Progressive Web App used by Chiltern Railways Customer Experience Advisors (CEAs) and
supervisors to view their rotating shift rosters.

This repository contains the standalone payday calculator page. It **will be merged into the
main roster app** at a future point. Until then it lives here so the UI can be developed
independently. The golden rule is: **build as if it is already part of the roster app**.

---

## The parent app — context you must know

The roster app (`index.html` + `admin.html`) is a vanilla-JS PWA hosted on Firebase. There is
**no build step, no framework, no bundler**. External dependencies load from CDN only.

When this calculator is merged, the files will sit alongside the roster app files:

```
roster-app/
├── index.html          ← main calendar view
├── admin.html          ← staff self-service + admin portal
├── app.js              ← JS for index.html
├── admin-app.js        ← JS for admin.html
├── roster-data.js      ← shared data + utility functions  ← YOU IMPORT FROM THIS
├── firebase-client.js  ← Firebase init + Firestore helpers ← YOU IMPORT FROM THIS
├── shared.css          ← shared CSS variables + base styles ← YOU LINK TO THIS
├── service-worker.js
├── manifest.json
├── paycalc.html        ← your new file (HTML + CSS only, no inline JS)
└── paycalc.js          ← your new file (all JS for paycalc.html)
```

---

## Architecture — never deviate from these

| Rule | Reason |
|------|--------|
| **Vanilla JS only** | No React, Vue, or any library. No build step. Staff maintain this without a dev environment. |
| **No bundler** | External deps via CDN only. |
| **HTML+CSS in `.html`, all JS in `.js`** | Linting, caching, and readability all depend on this split. |
| **Import shared modules** — never duplicate them | `roster-data.js` already has all the payday maths. Importing avoids drift. |
| **Offline-first** | Firestore is an enhancement. Every Firestore call needs a silent fallback. Never block rendering waiting for Firestore. |
| **Mobile is primary** | All staff use this on Android phones. Test every change at 375px viewport width. |
| **No `alert()`** | Use `console.error()` for developer errors. No visible error text for recoverable failures. |
| **Pure functions where possible** | JSDoc on all exported functions. Meaningful variable names. Error handling on all async operations. |
| **CSS variables for all colours** | Defined in `:root` in `shared.css`. Never hardcode hex values in CSS or JS. |
| **Semantic HTML** | `<nav>`, `<header>`, `<main>` — screen readers depend on these landmarks. |

---

## File structure for this project

During standalone development:

```
paycalc-repo/
├── paycalc.html          ← page shell (HTML + CSS only; link to shared.css when merged)
├── paycalc.js            ← all JS for this page
├── shared.css            ← copy from roster-app for now; remove on merge (use the original)
├── roster-data.js        ← copy from roster-app for now; remove on merge (import the original)
├── firebase-client.js    ← copy from roster-app for now; remove on merge (import the original)
└── CLAUDE.md             ← this file
```

**Important:** When copying `roster-data.js` and `firebase-client.js` for local development, do
**not** modify them here. Any change to shared logic must be made in the roster-app repo.

---

## Brand design system — Chiltern Railways

### Colour variables (defined in `shared.css` `:root`)

These are the only colours you may use. Never write a hex value directly in a CSS rule.

```css
/* Brand */
--primary-blue:      #001e3c   /* Dark navy — headers, primary buttons, key UI chrome */
--primary-blue-dark: #00152a   /* Deeper navy — hover state for primary buttons */
--accent-gold:       #f5c800   /* Gold — today highlight, active states, badges */
--accent-gold-dark:  #e6bb00   /* Darker gold — hover on gold buttons */

/* Shift type colours (use in paycalc to match the calendar's shift coding) */
--green:             #43a047   /* Early shift text */
--green-light:       #e8f5e9   /* Early shift cell/pill background */
--orange:            #ff9800   /* Early shift badge accent */
--orange-light:      #fff3e0
--blue-sky:          #1565c0   /* Late shift */
--blue-light:        #e3f2fd
--purple:            #7b1fa2   /* Spare shift */
--purple-light:      #f3e5f5
--rdw:               #c2185b   /* RDW (rest day worked / overtime) — magenta */
--rdw-light:         #fce4ec
--rdw-text:          #880e4f   /* RDW text on light bg */
--al:                #00897b   /* Annual leave */
--al-light:          #e0f2f1
--sick:              #e53935   /* Sick day */
--sick-light:        #ffebee
--rest-day-bg:       #f9f9fb   /* Rest day cell background */
--charcoal:          #2d2d2d   /* Rest day badge */
--night:             #1a1a2e   /* Night shift badge */

/* Neutral */
--text-dark:         #333      /* Primary body text */
--text-mid:          #555      /* Secondary text, hints */
--text-light:        #999      /* Placeholder, metadata */
--border-light:      #e8e8e8   /* Card borders, dividers */
--border-mid:        #cccccc
--bg-light:          #f8f8f8   /* Card backgrounds */
--bg-faint:          #f5f5f5

/* Error */
--error-red:         #d32f2f
--error-bg:          #ffebee

/* Success */
--success-text:      #1b5e20
```

### Typography scale

```css
--type-micro:  10px   /* tiny labels, badges */
--type-small:  12px   /* hints, metadata, secondary info */
--type-body:   14px   /* default body text */
--type-medium: 16px   /* form inputs */
--type-large:  18px   /* section headers */
--type-xl:     24px   /* page title */
```

Font stack (same as both existing pages):
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
```

### Elevation / shadow system

```css
--shadow-1: 0 1px 4px rgba(0,0,0,0.10)         /* cards, subtle lift */
--shadow-2: 0 2px 12px rgba(0,30,60,0.12)       /* header, containers */
--shadow-3: 0 8px 32px rgba(0,0,0,0.18)         /* modals, lightboxes */
```

### Border radius

```css
--radius-md: 12px   /* standard card corners, inputs */
--radius-lg: 14px   /* outer page containers, header card */
--radius-sm: 8px    /* buttons, pills, small elements (defined per-page, use 8px) */
```

---

## Component patterns — match these exactly

The app uses a consistent card + section pattern. Replicate it in paycalc.

### Page background
```css
body {
    background: var(--primary-blue);   /* navy page fill */
    font-family: -apple-system, ...;
    color: var(--text-dark);
    -webkit-font-smoothing: antialiased;
}
```

### Card (the main layout unit)
```html
<div class="card">
    <div class="card-header">
        <h2>Section Title</h2>
        <span class="hint">Short description of what this section does</span>
    </div>
    <div class="card-body">
        <!-- content -->
    </div>
</div>
```
```css
.card {
    background: white;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-1);
    margin-bottom: 16px;
    overflow: hidden;
}
.card-header {
    padding: 16px 16px 12px;
    border-bottom: 1px solid var(--border-light);
}
.card-header h2 {
    font-size: 17px;
    font-weight: 700;
    color: var(--primary-blue);
}
.hint {
    font-size: var(--type-small);
    color: var(--text-light);
    display: block;
    margin-top: 2px;
}
.card-body {
    padding: 12px 16px;
}
```

### Primary button
```html
<button class="btn-primary">Calculate</button>
```
```css
.btn-primary {
    display: block;
    width: 100%;
    padding: 11px 16px;
    background: var(--primary-blue);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
}
@media (hover: hover) and (pointer: fine) {
    .btn-primary:hover { background: var(--primary-blue-dark); }
}
.btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }
```

### Page header (top of page, same style as existing pages)
```html
<header class="app-header">
    <span class="app-icon" ...><!-- icon --></span>
    <h1>Pay Calculator</h1>
</header>
```
```css
.app-header {
    background: var(--bg-light);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    margin-bottom: 16px;
}
.app-header h1 {
    font-size: 20px;
    font-weight: 800;
    color: var(--primary-blue);
}
```

### Feedback / status messages
```html
<div class="feedback" role="status" aria-live="polite"></div>
```
```css
.feedback        { font-size: 13px; margin-top: 8px; }
.feedback--ok    { color: var(--success-text); }
.feedback--err   { color: var(--error-red); }
```
Do **not** use `min-height` on empty feedback elements — it creates unwanted whitespace.

### Data rows (summary lines, breakdowns)
```html
<div class="data-row">
    <span class="data-label">Early shifts</span>
    <span class="data-value">6</span>
</div>
```
```css
.data-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-light);
    font-size: var(--type-body);
}
.data-row:last-child { border-bottom: none; }
.data-label { color: var(--text-mid); }
.data-value { font-weight: 600; color: var(--text-dark); }
```

---

## The payday data layer — what already exists in roster-data.js

**Do not rebuild any of this.** Import from `roster-data.js`.

### Constants in CONFIG
```javascript
CONFIG.PAYDAY_INTERVAL_DAYS  // 28 — pay cycle is every 4 weeks
CONFIG.FIRST_PAYDAY          // Date object — Feb 13, 2026 (anchor for all calculations)
CONFIG.MIN_YEAR              // earliest year the app supports
CONFIG.MAX_YEAR              // latest year the app supports
```

### Functions you can import

```javascript
import {
    CONFIG,
    getPaydaysAndCutoffs,   // (year) → { paydays: Date[], cutoffs: Date[] }
    isPayday,               // (date) → boolean
    isCutoffDate,           // (date) → boolean
    isSameDay,              // (date1, date2) → boolean — safe date comparison
    formatISO,              // (date) → "YYYY-MM-DD"
    getBankHolidays,        // (year) → Date[]
    isBankHoliday,          // (date) → boolean
    getWeekNumberForDate,   // (date, member) → roster week number for that member
    getRosterForMember,     // (member) → the member's full roster object
    getBaseShift,           // (member, date) → shift string e.g. "06:00-13:00" or "RD"
    isEarlyShift,           // (timeStr) → boolean
    isNightShift,           // (timeStr) → boolean
    getShiftClass,          // (timeStr) → "early" | "late" | "night"
    getShiftBadge,          // (timeStr, sep?) → HTML badge string
    getALEntitlement,       // (member, year, overrides?) → { total, used, remaining }
    teamMembers,            // array of all staff — { name, currentWeek, rosterType, role, ... }
    DAY_NAMES,              // ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    DAY_KEYS,               // ['sun','mon','tue','wed','thu','fri','sat']
    MONTH_ABB,              // ['Jan','Feb',...]
    SHIFT_TIME_REGEX,       // validates "HH:MM-HH:MM" format
    escapeHtml,             // (str) → HTML-safe string — use whenever rendering user/Firestore data
} from './roster-data.js?v=CURRENT_VERSION';
```

### How getPaydaysAndCutoffs works
```javascript
const { paydays, cutoffs } = getPaydaysAndCutoffs(2026);
// paydays  → array of Date objects, one per pay Friday in 2026
// cutoffs  → array of Date objects, each is the Saturday before the corresponding payday
// Both arrays are always the same length and in ascending date order
// Paydays are adjusted backwards if they fall on a bank holiday
```

### What a pay period looks like
```
Cutoff Saturday  →  Payday Friday (28 days later)
     ↑                      ↑
Start of period        End of period / payment date
```
The **pay period** is the block of shifts worked between cutoff+1 and the next cutoff (inclusive).
Hours worked in that window are what gets paid on the corresponding payday.

---

## Firestore data — what the calculator needs

All shift data lives in the `overrides` Firestore collection. The base roster comes from
`roster-data.js`. To get a staff member's actual shift on any date:

1. Call `getBaseShift(member, date)` → the scheduled shift from the rotating roster
2. Check Firestore `overrides` for a document matching `{ memberName, date }` → if one exists,
   its `value` field overrides the base shift

Both `app.js` and `admin-app.js` do this already — look at how they build the calendar to see
the pattern in full. Key Firestore functions (all in `firebase-client.js`):

```javascript
import { getOverridesForMember } from './firebase-client.js?v=CURRENT_VERSION';
// Returns all override documents for a member as an array
// Cache key format: "memberName|YYYY-MM-DD"
```

### Override document shape
```
date        "YYYY-MM-DD"
memberName  must match teamMembers[n].name exactly (case and punctuation)
type        "spare_shift" | "overtime" | "rdw" | "swap" | "annual_leave" |
            "correction" | "sick"
value       "HH:MM-HH:MM" | "AL" | "RD" | "SICK"
note        string (always present, use "" if none)
createdAt   Firestore server timestamp
```

### Shift type meanings (for pay calculation logic)
```
"RD"              Rest day — not worked, not paid extra
"OFF"             Off day (bilingual roster) — same as RD
"SPARE"           Standby — on call, shift not yet assigned
"RDW"             Rest day worked — overtime, paid at a premium rate
"AL"              Annual leave
"SICK"            Sick day
"HH:MM-HH:MM"    Worked shift — counts as a working day
```

`isWorkedDay`: returns false for RD, OFF, SPARE, AL, SICK. Returns true for everything else
including RDW.

Early/late/night classification thresholds:
- Early: start time 04:00–10:59
- Late:  start time 11:00–20:59
- Night: start time 21:00–03:59

---

## What the calculator UI should show

Based on the product roadmap:

**Primary view — current pay period**
- Which pay period is currently active (e.g. "Period ending Fri 10 Apr 2026")
- Days into the period / days remaining
- Breakdown of shift types worked so far: early / late / night / RDW / AL / sick / spare
- Count of worked days vs rest days

**Secondary view — historical periods**
- Select a previous pay period from a dropdown
- Same breakdown for that period

**How to identify the current pay period:**
```javascript
const today = new Date();
const { paydays, cutoffs } = getPaydaysAndCutoffs(today.getFullYear());
// Find the next payday on or after today → that's the end of the current period
// The corresponding cutoff is the start of the current period
```

The calculator is **read-only** — no writes to Firestore. It only reads base roster data and
Firestore overrides, then presents a summary.

---

## Authentication — how to identify the logged-in user

The roster app uses a simple localStorage session. The same session is readable here:

```javascript
const currentUser = localStorage.getItem('rosterUser'); // "G. Miller" — matches teamMembers[n].name exactly
// Returns null if not logged in
```

If `currentUser` is null, show a prompt to log in via `admin.html` first, or include an
inline login form using the same pattern (name dropdown + surname password).

The login function is in `admin-app.js` — do not duplicate it. If a login form is needed,
import the logic or redirect to `admin.html`.

---

## Version bumping — how it will work after merge

The parent repo requires 13 version string updates per commit. After merge, `paycalc.html`
and `paycalc.js` will add **two new rows** to that table:

| File | Location |
|------|----------|
| `paycalc.html` | Line 2 HTML comment + `<script src="./paycalc.js?v=...">` + `<link rel="stylesheet" href="./shared.css?v=...">` |
| `paycalc.js` | `import ... from './roster-data.js?v=...'` + `import ... from './firebase-client.js?v=...'` |

During standalone development in this repo, keep a version number consistent across:
- A comment at the top of `paycalc.html`
- A comment at the top of `paycalc.js`
- The `?v=` import strings
- Increment it on every commit that changes behaviour

---

## Service worker — what to add after merge

After merging into the parent repo, add both files to `service-worker.js`:

**Network-first list** (must always be fresh — roster data changes):
```javascript
'./paycalc.html',
'./paycalc.js',
```

**ASSETS_TO_CACHE** (preloaded on install):
```javascript
'./paycalc.html',
'./paycalc.js',
```

---

## Print CSS

Any new shift type, cell class, or badge introduced in this page needs rules inside
`@media print`. At minimum:

```css
@media print {
    .card { box-shadow: none; border: 1px solid #ccc; break-inside: avoid; }
    .btn-primary { display: none; }
    /* add shift colour overrides if needed */
}
```

---

## Accessibility rules

- All interactive elements must be keyboard-accessible
- Use `aria-live="polite"` on any element that updates dynamically (totals, feedback messages)
- Use `role="status"` on feedback divs
- Never suppress focus rings with `outline: none` — use `:focus-visible` instead
- Colour contrast: all text must meet WCAG AA (4.5:1 for normal text, 3:1 for large/bold)
- The existing shift colours in `shared.css` have all been audited for contrast — use them

---

## Key questions for Gareth before building the UI

1. **Pay rates** — does the calculator need to show £ amounts, or just counts of shift types?
   If £ amounts: what is the standard day rate, the night premium, and the RDW rate?
2. **Overtime threshold** — is there a contracted hours figure per period that triggers a
   different pay rate once exceeded?
3. **Spare shifts** — are SPARE days paid at full rate or a lower standby rate?
4. **Login requirement** — should the calculator be accessible without logging in (showing a
   generic view), or always require a logged-in user?
5. **Historical depth** — how many previous pay periods should be selectable?

---

## How this app was built — working with Gareth

Gareth built the roster app through extended collaboration with Claude.ai. He has strong
operational knowledge of railway rostering and is actively learning software development.
Every session is both a development session and a teaching session.

- **Explain decisions** — not just what, but why, what the alternative was, and what it enables
- **Plain language first** — explain new concepts before showing implementation
- **Name the pattern** — if using a design pattern, name it and say why it fits
- **Flag trade-offs** — briefly note what the other option was and why this was chosen
- **Never assume prior knowledge** of cloud services, authentication patterns, or backend concepts

The goal is that Gareth understands the codebase, not just that the codebase works.
