# MYB Roster — Ideas & Roadmap

Ideas that have been discussed, prototyped, or assessed but not yet shipped.
Each entry notes why it was held back and what would need to change to revisit it.

---

## Navigation

### Bottom navigation bar
**Status:** Prototyped at v7.66, reverted — felt like clutter at current scale

A fixed tab bar at the bottom of the screen on mobile with three items:
📅 Roster · 💷 Pay · 🔐 Admin

The active tab would be highlighted in gold; all three pages would share the
same bar via shared.css.

**Why it was held back:**
The app currently has three pages and the existing entry points (the Admin and
Pay buttons in the controls row, the back arrow on inner pages) are sufficient
for the current use pattern. Adding a persistent nav bar makes the screen feel
busier without a clear navigational payoff at three pages.

**When to revisit:**
- If a fourth or fifth page is added (e.g. a team schedule view, a notice board)
- If staff report not knowing how to get between pages
- If the controls row is simplified and loses the dedicated Pay/Admin buttons

**Implementation notes (already written, can be restored):**
- CSS lives in shared.css — `.bottom-nav`, `.bottom-nav-item`, `.bottom-nav-icon`
- Each page needs `<nav class="bottom-nav">` before `</body>` with the active item marked
- Body needs `padding-bottom: calc(64px + env(safe-area-inset-bottom))` on mobile only
- Hidden on desktop (≥768px) via `display: none` in the base rule; shown via
  `@media (max-width: 767px)` block
- Print: `display: none !important` already in the media query

---

## Calendar home screen

### Glanceable summary strip
**Status:** Prototyped at v7.66, reverted — adds clutter above the calendar

A horizontal scrolling row of four white pill chips below the controls,
shown only when logged in:

| Chip | Source | Notes |
|------|--------|-------|
| **Today** | Base roster + override cache | Offline-first; shows type or start time |
| **Next RD** | Base roster scan (90 days) | Override cache applied where available |
| **Leave left** | Firestore (async) | Shows "…" until loaded; fires once per member |
| **Payday** | `getPaydaysAndCutoffs()` | Offline; shows date + days remaining |

**Why it was held back:**
On a phone the calendar itself is the primary information — the strip adds a
layer of noise between the controls and the calendar grid. The same information
is already reachable (AL via the 🏖️ AL button; payday from the pay period
strip; today's shift from the calendar cell itself).

**When to revisit:**
- If staff on longer shifts want a "what am I doing today?" glance without
  scrolling to find today's cell
- If the pay period strip is removed (the strip was partly redundant with it)
- Consider putting it *inside* the controls card as a collapsed/expandable panel
  rather than between controls and calendar

**Implementation notes (already written, can be restored):**
- HTML: four `<div class="sc">` chips in `<div id="summaryStrip">` after `#payPeriodStrip`
- CSS: `.summary-strip` (flex, overflow-x: auto), `.sc`, `.sc-label`, `.sc-val`
- JS: `updateSummaryStrip()` in app.js — called from `renderCalendar()`
- The AL query is de-duplicated via `_summaryALFetched` flag, reset in `clearMemberCaches()`
- All data sources are already imported — no new dependencies needed

---

## Pay calculator

### Pay result hierarchy (shipped v7.67)
The period line and hint text under the £ figure were at 72% / 48% opacity
and 15px / 12px. Increased to 88% / 62% opacity and 16px / 13px.
No longer an open idea — done.

---

## Design assessment notes (April 2026)

A full design audit was run against a 10-point ChatGPT modernisation list.
Summary: the app is more mature than the generic advice implies. The real gap
was navigation (addressed partially by the Pay/Admin links added at v7.65).

Items from the list that are already solved:
- Shadows — already at 0 1px 4px / 10% opacity (minimal by modern standards)
- Motion — today-pulse, skeleton shimmer, spring lightbox, swipe transitions all exist
- Colour contrast — every shift colour audited and darkened to WCAG AA
- Touch target size, safe-area padding, reduced-motion — all handled
- Type hierarchy — 6-tier scale applied throughout

Items from the list that are not real problems for this app:
- "Glanceable layouts" — a UX principle, not an actionable change
- "Heavy cards / 2018 feel" — only an issue at very wide desktop viewports;
  the v7.62 desktop layout changes already addressed this
