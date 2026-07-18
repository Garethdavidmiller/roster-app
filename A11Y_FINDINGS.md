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
  text on the colour tint** — the tint + border keep each badge's identity. Screenshotted: no brand
  drift. Also fixed the `aria-allowed-attr` regression this surfaced (`setSettingsCardOpen` was
  setting `aria-expanded` on the now-non-interactive paycalc header — moved it to the arrow control).
- **Documented exclusion:** the calendar's faint **other-month day numbers** are `aria-hidden`
  decorative context (darkening them defeats the "not this month" cue for zero SR benefit), so they
  are `.exclude('.other-month')`d in the calendar scan — a targeted exclusion, not a rule waiver.

## Waived rules

No blanket rule waivers. One targeted per-page **element exclusion**: calendar `.other-month` (faint,
`aria-hidden` adjacent-month day numbers — see #2). When accepting anything else, add a `GLOBAL_WAIVERS`
entry or a page `exclude` in `axe.spec.js` **with a one-line reason**, and record it here.

## Promotion path — ✅ COMPLETE

1. ~~Fix `nested-interactive`~~ ✅ v17.50. 2. ~~Fix `color-contrast`~~ ✅ v17.51–52.
3. ~~Green on both projects~~ ✅. 4. ~~Make it block (`test:e2e` includes `@a11y`)~~ ✅ v17.52.
Optional next: add `npm run test:e2e` (or a dedicated `test:a11y`) to a CI workflow gate; wire more
rendered STATES per page (e.g. an open lightbox, an error state) beyond the one snapshot each.
