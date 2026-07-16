---
paths:
  - "links.html"
  - "links.css"
  - "links-app.js"
  - "links-design.js"
  - "links-design.test.mjs"
---

# Links workspace — full architecture

## Access control

- `NAV_PAGES` entry has `linksDesignerOnly: true`. `initNavPanel({ isLinksDesigner })` filters it out for non-designers.
- Each page passes `isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(member)`. `links-app.js` passes `isLinksDesigner: true` (page already guards non-designers, redirecting to `admin.html`).
- To grant access: add name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` — every page derives `isLinksDesigner` from that list. Current designers: `'G. Miller'`, `'S. Silva'`.

## Beta marker + first-visit notice (v12.33)

**Header:** a gold-OUTLINE `.beta-chip` ("Beta") sits beside the solid-gold "🔗 Links" `.badge-page` inside a `.header-end` flex wrapper — outline vs solid keeps them as secondary + primary tags. A slow `beta-sheen` sweep animates it (disabled under `prefers-reduced-motion`).

**First-visit lightbox:** `#betaLightbox` follows the canonical `createLightbox` lifecycle — shown once, gated on `lsGet('myb_links_beta_seen')` set on close. Uses `.notice-badge notice-badge--links` (purple) and `.lightbox-app-name` (scoped to 17px within `.notice-lb-content`); no per-notice CSS in `links.css`.

## Design and save model (v12.09, redesigned v12.39–v12.43, multi-design v12.46–v12.47)

### Card order (v12.46)
Grid (primary object) → Auto-generator (collapsed by default) → Coverage (hourly heat map) → Design checks. The generator sits directly beneath the grid because it is the only way to create a new design.

### Firestore model (multi-design, v12.46)
`linkDesigns` is a **collection** of named design documents `{ name, patterns, updatedAt, updatedBy }` with auto-IDs. The legacy singleton `linkDesigns/combined-28` (no `name` field) is auto-migrated to a named design ("Design 1") on first load and thereafter ignored — never write to it.

A picker strip switches designs: **+ New** (blank), **⎘ Duplicate** (forks the LIVE in-memory patterns, unsaved edits included), **✎ Rename**, **✕ Delete** (disabled on the last design). Designs sort by name; the active design id persists via `lsGet('myb_links_active_design')`. Picker chips are a `<div>` wrapping separate `<button>`s — **buttons must not nest**.

### Compare mode (v12.46)
With ≥2 designs, shows two read-only grids side-by-side (≥1024px) or stacked, with a gold-outline diff on differing cells. Each compare column keeps `overflow-x:auto` even on desktop. The main grid stays **rendered** in compare mode — hidden on screen only (`body.links-compare-on` + `@media screen`) so print always outputs the active design. A print-only `#printDesignName` label names the printed sheet.

### patterns data shape
`patterns` is `{ "1"–"28": { sun, mon, tue, wed, thu, fri, sat } }` (each value a shift string, `"SPARE"`, or `"RD"`). **Position keys:** always `String(pos)` (`"1"`–`"28"`), never `Number`.

Staff names were removed at v12.39 — the design is patterns-only ("Line 1", "Line 2"…); who goes on which line is decided after patterns are agreed. Legacy `meta` in old docs is ignored on load and dropped on next save.

### Pure-maths module
All design maths live in `links-design.js` (no DOM, no Firebase; tested by `links-design.test.mjs`) — `classifyShift`, `normaliseCustomShift`, `calcCoverage`, `calcHourlyCoverage`, `generatePatterns`, `runDesignChecks`, `dayClass`. `links-app.js` imports these; do not duplicate them back into the app file.

### Save and dirty flag
Single dirty flag + one `linksSaveBtn` / `saveChanges()`. Grid clicks are **delegated** on `#linksGridBodyRows` — do NOT call `renderGrid()` from inside `saveChanges()`.

**Unsaved-changes guard:** `beforeunload` + explicit `confirm()` on sign-out, logo navigation, and a capture-phase click guard on nav-drawer links (mobile browsers suppress `beforeunload` dialogs).

### Paint mode (v12.39)
A brush chip bar above the grid (`#brushBar`) — clicking a chip arms that shift; clicking grid cells then applies it directly (no dropdown); clicking the armed chip again or pressing Escape disarms. With no brush armed, a cell click opens the dropdown as before. `.shift-cell-btn` and `.brush-chip` set `touch-action: manipulation` — paint mode is rapid tapping, which otherwise triggers double-tap zoom on iOS/Android.

### Night shifts
**CEAs do not work night shifts (confirmed by Gareth June 2026)** — night times are never offered in any dropdown or brush chip. `normaliseCustomShift()` rejects starts between 21:00 and 03:59; do not re-add a Night option. `classifyShift`'s `night` return is defensive only (legacy/imported data).

**Shift option lists:** `EARLY_SHIFTS` / `LATE_SHIFTS` derived from `weeklyRoster` + `bilingualRoster` at module load — never a static list. **Custom time…** validated by `normaliseCustomShift()`.

### Coverage heat map (v12.40)
The Coverage card renders an **hour-by-hour table** (`calcHourlyCoverage`) — rows = days, columns = hours spanning the staffed day, cell = on-duty headcount, intensity buckets `heat-b0`–`heat-b5` (color-mix tints of `--cov-early`, scaled to the week's peak).

The station is staffed in **waves** (opens ~06:20, morning build 07:00–08:30, middles 11:00–12:00, afternoons 13:30–14:30, closes 15:00+) — do not revert to per-type stacked bars. A red `0` inside a day's staffed span marks a coverage gap; spares get their own `SP` column. The grid `tfoot` keeps compact per-day `E:/L:/SP:` counts.

### Design checks (v12.39, completeness added v12.41)
`runDesignChecks(patterns, 28)` checks:
- **Unfilled lines** (any line that is entirely rest days is *not yet designed*, not a vacancy)
- Weekends off (Sat of line w + Sun of line w+1, wrapping)
- Short turnarounds (<12 h rest between consecutive timed shifts across the full circular rotation)
- Longest consecutive-worked-days run
- Early/late balance

Renders plain-English traffic-light rows (completeness first); updates live on every cell edit / generate. All 28 lines rotate and are checked.

### Auto-generator (v12.39, slot-based v12.40)
**The only way to create a new design** (v12.43). Targets are a LIST of shift slots — one row per distinct start time, each with separate **Mon–Fri / Sat / Sun** headcounts — plus a spare row.

The table is **seeded from the current roster** on page load via `buildRosterTargets()` (main 20 weeks + the 2 BL lines; weekday count = busiest Mon–Fri day); `↺ Reset targets from current roster` re-seeds.

`generatePatterns({ slots, spare, lines: 28 })` uses a rotating-window construction: window slides forward completing one lap per week; within the window slots are ordered latest-start at front, earliest at back, spare in the middle — so each person's week only moves later (never a late finish then early start; asserted by tests). Daily targets are met exactly; any day-class total > 28 is rejected. Generator writes all 28 lines.

**Do not add back** `buildDefaultDesign`, `initFromRosters`, or `resetFromRosters` — those paths were removed at v12.43 because they copied raw 22-line roster patterns leaving lines 23–28 as all-RD blanks. The generator produces a complete 28-line rotation.

### Line numbering (full 28-line rotation, v12.42)
All 28 lines rotate and **every one must carry a real worked pattern** — in the rotation everyone passes through every line, so a "vacancy" is a missing *person*, not a missing *pattern*. `ROTATING_LINES = 28`.

**C. Reen is NOT a special case:** the link is designed as full 28 so it still works if she ever leaves; her adjusted fixed shifts are applied as overrides on the base roster. The old `FIXED_POS` / `fixed-link-separator` / `fixed-cell` model and the earlier `VACANT_FROM` placeholders model were both removed (v12.41 dropped vacant; v12.42 dropped fixed). All 28 rows are normal editable rotating rows.

The grid flags an all-rest line with an amber line-number cell (`.row-unfilled`); the Design checks "Lines not yet designed" row lists them until filled.

### Concurrency & load safety (v12.37; atomic v17.02)
`saveChanges()` writes via an **atomic Firestore transaction** (`runTransaction`) that reads the doc's `updatedAt` and writes in one step — closing the old getDoc-then-setDoc check-then-act window where a co-designer's save between our read and write was silently clobbered (Finding #13). On a baseline mismatch the transaction throws `concurrent-edit`; a `confirm()` names who saved and when, and on overwrite a plain (unconditional) `setDoc` replaces it. Transactions need connectivity, so **offline / any transaction failure falls back to the previous getDoc-check + queued `setDoc`** (persistentLocalCache syncs it) — offline-first preserved. The mismatch check (`conflictOf`) and the confirm are shared by both paths so they can't drift. A failed load sets `loadFailed` — empty state shows an error.

**Baseline-unknown guard (v17.18):** after a successful save, `saveChanges()` re-reads the doc to re-arm the concurrency baseline (`loadedUpdatedAt`). If that read-back FAILS (brief blip), the catch now sets `baselineUnknown = true` (mirroring the transaction path) — leaving it `false` meant the NEXT save saw neither a known timestamp nor an unknown-baseline flag, so a co-editor's intervening save could be overwritten with no conflict prompt. Residual accepted limit: two devices under the SAME display name (`updatedBy` equal) still won't conflict-prompt — inherent to identifying editors by name.

### Print (v12.37)
A4 landscape grid + coverage + checks; generator and brush bar hidden.

### Sticky day headers (v12.37)
At ≥1024px `.links-grid-wrapper` drops `overflow-x` and `.card` uses `overflow: clip` (not `hidden`) — both load-bearing for the sticky `thead`.
