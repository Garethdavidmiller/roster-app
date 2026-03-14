# Claude Code Instructions — MYB Roster App

## Version bumping (MANDATORY on every change)

Always bump the version number before committing. Five places must stay in sync:

| File | Location | Example |
|------|----------|---------|
| `index.html` | Line 2 HTML comment | `<!-- MYB Roster Calendar - Version 4.55 -->` |
| `index.html` | `CONFIG.APP_VERSION = '...'` (~line 2159) | `CONFIG.APP_VERSION = '4.55';` |
| `index.html` | `import ... from './roster-data.js?v=...'` (~line 2147) | `roster-data.js?v=4.55` |
| `admin.html` | `const ADMIN_VERSION = '...'` (~line 2021) | `const ADMIN_VERSION = '4.55';` |
| `admin.html` | `import ... from './roster-data.js?v=...'` (~line 1751) | `roster-data.js?v=4.55` |

- Increment the patch number (e.g. 4.55 → 4.56) for every commit that touches app behaviour
- All five locations must show the same version number
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
├── index.html          ← main PWA app
├── admin.html          ← staff self-service and admin portal
├── roster-data.js      ← shared module: CONFIG, teamMembers, all roster data, utility functions
├── service-worker.js   ← v5.5
├── manifest.json       ← PWA manifest
└── icon-*.png          ← 6 sizes: 120, 152, 167, 180, 192, 512
```

**Service worker caching strategy (v5.5):**
- Network-first: `index.html`, `admin.html`, `roster-data.js` — must always be fresh
- Cache-first: all icons, `manifest.json` — stable assets

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

---

## Shift types

| Value | Badge | Meaning |
|-------|-------|---------|
| `'RD'` | 🏠 Rest | Rest day |
| `'OFF'` | 🏠 Rest | Off day — bilingual roster only, treated identically to RD |
| `'SPARE'` | 📋 Spare | On standby, shift not yet assigned |
| `'RDW'` | 💼 RDW | Rest day worked — overtime |
| `'AL'` | 🏖️ AL | Annual leave |
| `'HH:MM-HH:MM'` | ☀️ / 🌙 / 🌃 | Worked shift |

**Shift classification:**
- Early: 04:00–10:59 (`EARLY_START_THRESHOLD = 4`, `EARLY_SHIFT_THRESHOLD = 11`)
- Late: 11:00–20:59
- Night: 21:00–03:59 (`NIGHT_START_THRESHOLD = 21`)

**isWorkedDay:** Returns false for RD, OFF, SPARE, AL. True for everything else including RDW.

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
  permanentShift: 'early'  // Optional — forces all worked days to early or late badge
}
```

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
type         string     "spare_shift" | "overtime" | "rdw" | "swap" |
                        "annual_leave" | "correction"
value        string     "HH:MM-HH:MM" or "AL" or "RD"
note         string     Free text — use "" if none. Field must always be present.
createdAt    timestamp  Firestore server timestamp
```

**memberSettings** — per-member preferences (currently: Islamic marker toggle)

Override cache key format: `"memberName|YYYY-MM-DD"` (pipe separator)

### Authentication

Staff log in to admin.html with their name (dropdown) and surname as password (lowercase, no spaces or special characters). Example: `'G. Miller'` → `miller`. Sessions persist for 30 days via localStorage.

`ADMIN_NAME = 'G. Miller'` has elevated admin access beyond standard staff permissions.

Firebase SDK: currently v12.10.0. Check for the current version before any new Firebase work.

---

## Key rules

- **Offline first** — Firestore is an enhancement, not a dependency. Every Firestore call needs a silent fallback to the base roster. Never block rendering waiting for Firestore.
- **Mobile is primary** — all staff use this on Android phones. Test every change at 375px.
- **Print CSS** — any new shift type, cell class, or badge needs rules inside `@media print`.
- **No `alert()`** — use `console.error()` for developer errors. No visible error text for recoverable failures.
- **Code quality** — pure functions where possible, JSDoc on all functions, meaningful variable names, error handling on all async operations.
