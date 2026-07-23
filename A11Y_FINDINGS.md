# A11Y_FINDINGS.md — accessibility gate baseline

`e2e/axe.spec.js` runs the [axe-core](https://github.com/dequelabs/axe-core) engine against one
fully-rendered state of every page (WCAG 2.0/2.1 A + AA). It is the app's first automated
accessibility coverage — closing the gap the v17.45 audit flagged. Run it with **`npm run test:a11y`**.

It is a **floor**: axe catches the machine-checkable ~third of real issues (labels, names, contrast,
ARIA, duplicate ids). It does not replace a manual screen-reader pass.

## Current status — ✅ GREEN + BLOCKING (v17.52)

All 10 pages pass on both projects (Desktop Chrome + Pixel 5). **Both findings are resolved**
(`nested-interactive` v17.50, `color-contrast` v17.51–52), so the gate is now part of
`npm run test:e2e` — a new WCAG A/AA violation fails the suite. `npm run test:a11y` runs it
standalone (chromium). One documented per-page exclusion remains (calendar `.other-month`; see #2).

## Findings (baseline, Jul 2026 — reviewed against the app at v17.49)

### 1. `nested-interactive` (SERIOUS) — ✅ FIXED (v17.50)

`initCardCollapse` (overlay.js) used to set `role="button"` + `tabindex="0"` on the whole
`.card-collapsible-header`, but a header contains a nested real `<button class="btn-card-tips">?</button>`
(Tips / paycalc Help) — an interactive control wrapping another (ambiguous focus/activation).

**Fix (shared, one place):** `initCardCollapse` now makes the **chevron/arrow** the focusable toggle
(`role="button"` + `aria-expanded`/`aria-controls` + an `aria-label` from the card heading) and leaves
the header **non-interactive**. The header keeps a mouse-only click convenience that ignores clicks on
any nested control (so the Tips/Help "?" no longer falls through and toggles the card). The no-chevron
case falls back to the original header-as-toggle. Chevron/arrow gained `cursor` + a `:focus-visible`
ring (shared.css / paycalc.css). Verified: axe reports **0** `nested-interactive`; overlay.test.mjs
green; e2e green. No visual change to the cards.

### 2. `color-contrast` (SERIOUS) — calendar, paycalc, guides

Muted text / badges whose contrast is below the 4.5:1 AA threshold. Flagged elements include:
calendar `#alBtn` / `#payBtn` and other-month day numbers; paycalc badges (`#paycalcBadge`,
`#badge-sat`, `#badge-ot`); guide `.guide-footer`, railcard `.rc-cost` / `.rc-lbl`, shift badges
(`.sb-early` / `.sb-al`), FIP `.not-fip-name`.

### 2. `color-contrast` (SERIOUS) — ✅ FIXED (v17.51–52)

- **Guides (v17.51):** darkened the muted grey tokens (`--light` #888 → #6b6b6b / #666, guide footer
  #7c8794 → #5a6472), deepened the legend swatches, and removed the FIP "not-FIP" `opacity: 0.45`
  wash (opacity can't meet AA — the ✗ NO tag + a muted name colour carry "not available" instead).
- **Calendar + paycalc + admin (v17.52):** deepened the shared shift/pay tokens just enough to clear
  white-text AA (`--green`, `--al`, `--ot`, `--success-green`) while keeping the hue, and switched
  the badges that can't (orange `.badge-early`/`.badge-sat`, admin's gold "today" text) to **navy
  text on the colour tint** — the tint + border keep each badge's identity. (v17.56 aesthetic
  revision, owner-approved: `.badge-sat` moved from navy to the new `--orange-text` — a darkened
  64.1°-hue orange that clears AA on `--orange-light` — restoring Saturday's category colour-coding
  to match the OT/Peer badges, whose text kept their category colour.) Screenshotted: no brand
  drift. Also fixed the `aria-allowed-attr` regression this surfaced (`setSettingsCardOpen` was
  setting `aria-expanded` on the now-non-interactive paycalc header — moved it to the arrow control).
- **Documented exclusion:** the calendar's faint **other-month day numbers** are `aria-hidden`
  decorative context (darkening them defeats the "not this month" cue for zero SR benefit), so they
  are `.exclude('.other-month')`d in the calendar scan — a targeted exclusion, not a rule waiver.

## Functional-emoji screen-reader treatment (H1, v17.75)

An audit of every emoji RENDERED to users (shift badges, markers, headings, buttons, nav) checked
each against WCAG: emoji that duplicate adjacent text should be `aria-hidden`; an emoji that is the
sole label of a control/marker needs an accessible name. **Result: the app already had a strong,
consistent convention** (shift badges wrap the glyph in `aria-hidden`; every emoji-only button —
📍/☰/✕/✎/🔔 — carries an `aria-label`; the calendar day cell's `aria-label` carries payday/cut-off
so the CSS `::before` markers are correctly decorative). **No P1 (control-unusable) findings.**

Fixed this pass:
- **P2 (real correctness gain):** the "Change a Shift" per-day badge (`admin-overrides.js`
  `renderWeekGrid`) conveyed Bank Holiday / Payday / Cut-off by emoji + `title` only — `title`
  isn't reliably announced (esp. mobile SR), and the meaning wasn't in the row's visible text.
  Now `role="img" aria-label="<title>"`.
- **P3 convention gaps** (emoji duplicated visible text but wasn't hidden — brought back in line
  with the app's own pattern): nav-drawer link + guide builders (`nav-panel.js`); paycalc card
  sub-headings (`.h-title` ×8); admin `.al-booked-title` ×2; `admin-overrides.js` overwrite-badge
  ⚠ + the Spare 📋 flavour button; index.html action buttons (🖨️ Print, 📖 guide, 🐛 Report a bug,
  💷 View pay estimate, 🔔 notify).

These are aria-tree-only changes (glyphs still render — visual baselines byte-identical). **Deferred
(P3, low return):** the ~dozens of transient status strings that prefix `textContent` with ✓/⚠/✗/ℹ️
in `aria-live` regions — the glyph arguably reinforces the status, and hiding it needs a span
restructure at each site; best done later via one shared `setStatus(el, glyph, text)` helper.

## Known pre-existing (not gate-caught, low priority)

- **Stale `aria-expanded` on programmatically-opened cards — ✅ RESOLVED (v18.68).** A few
  coordinators opened a collapsible card/disclosure by adding the `.open` class directly (the
  auto-open / deep-link paths) without updating `aria-expanded`, so an auto-opened card reported
  `aria-expanded="false"` until the first manual toggle self-corrected. All such paths now keep the
  control's ARIA state in step: `admin-app.js` via its `openCollapsibleCard(body, chevron)` helper,
  `links-app.js`'s generator auto-expand sets `aria-expanded` alongside `.open`, `paycalc-settings.js
  setSettingsCardOpen` mirrors `initCardCollapse`, and the paycalc "more options" auto-expand
  (`loadPeriodData`) now routes through the shared `_setDisclosure(btnId, bodyId, open, …)` (which
  `_toggleDisclosure` also delegates to) instead of a class-only `.open`. The axe gate can't catch
  this class (it scans a settled state), so it's guarded by convention, not the gate.

## Waived rules

No blanket rule waivers. One targeted per-page **element exclusion**: calendar `.other-month` (faint,
`aria-hidden` adjacent-month day numbers — see #2). When accepting anything else, add a `GLOBAL_WAIVERS`
entry or a page `exclude` in `axe.spec.js` **with a one-line reason**, and record it here.

## Promotion path — ✅ COMPLETE

1. ~~Fix `nested-interactive`~~ ✅ v17.50. 2. ~~Fix `color-contrast`~~ ✅ v17.51–52.
3. ~~Green on both projects~~ ✅. 4. ~~Make it block (`test:e2e` includes `@a11y`)~~ ✅ v17.52.
5. ~~Wire more rendered STATES per page beyond the one settled snapshot~~ ✅ — forced transient
states (sync-chip, active pills) v17.57; **open-overlay states (H2, v17.75): the login overlay,
the nav drawer open, and the About lightbox open** — each a full interactive surface (focus trap,
buttons, headings) the settled scans can't reach. All axe-clean.
**CI gate — ✅ in place.** The axe `@a11y` spec runs as part of `npm run test:e2e`, and the `smoke`
job in `.github/workflows/e2e.yml` runs `npm run test:e2e` on every branch/PR — so a new WCAG A/AA
violation fails CI, not just the local run. (A dedicated standalone `test:a11y` CI job would only add
attribution clarity — the gate itself is already blocking through `smoke`.)
