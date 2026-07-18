# A11Y_FINDINGS.md — accessibility gate baseline

`e2e/axe.spec.js` runs the [axe-core](https://github.com/dequelabs/axe-core) engine against one
fully-rendered state of every page (WCAG 2.0/2.1 A + AA). It is the app's first automated
accessibility coverage — closing the gap the v17.45 audit flagged. Run it with **`npm run test:a11y`**.

It is a **floor**: axe catches the machine-checkable ~third of real issues (labels, names, contrast,
ARIA, duplicate ids). It does not replace a manual screen-reader pass.

## Current status — NOT yet blocking

The gate is tagged `@a11y` and **excluded from `npm run test:e2e`** (via `--grep-invert`), so it does
not yet block CI. **`nested-interactive` is now fixed (v17.50)** — operations, settings and links pass
clean. The remaining failures are all **`color-contrast`** (below). Once that is resolved or
consciously waived, drop the `--grep-invert @a11y` from `test:e2e` so the gate blocks — and add a
global waiver (with a reason) in `axe.spec.js` for anything deliberately accepted.

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

- **Guides — ✅ FIXED (v17.51).** Darkened the muted grey tokens (`--light` #888 → #6b6b6b / #666,
  guide footer #7c8794 → #5a6472), deepened the guide legend swatches (`--sb-early`/`--sb-al`), and
  removed the FIP "not-FIP" `opacity: 0.45` wash (opacity dimming can't meet AA — the ✗ NO tag +
  a muted name colour carry the "not available" signal instead). All 4 guide pages pass axe.
- **Calendar + paycalc — still open (semantic brand colours).** The remaining misses are white text
  on the shared shift/pay colours (`--orange`/`--green`/`--al` at oklch lightness that fails white
  text), plus tinted badges. Fixing means deepening those shared tokens (app-wide visual change) or
  switching badge text to dark — **design-token territory**, so do it with screenshots and keep the
  brand hues. The calendar's faint **other-month day numbers** are `aria-hidden` decorative context
  (darkening them defeats the "not this month" cue) — exclude those from the scan, don't darken.

## Waived rules

None yet. When a rule is consciously accepted, add it to `GLOBAL_WAIVERS` (or a page-local waiver) in
`axe.spec.js` **with a one-line reason**, and record it here.

## Promotion path

1. ~~Fix `nested-interactive` (shared collapse refactor).~~ ✅ done (v17.50).
2. Triage + fix the genuine `color-contrast` misses; waive any intentional low-emphasis text.
3. Re-run `npm run test:a11y` → green.
4. Remove `--grep-invert @a11y` from `test:e2e` so the gate blocks; consider adding it to `npm run check`.
