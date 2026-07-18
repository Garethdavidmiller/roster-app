# A11Y_FINDINGS.md — accessibility gate baseline

`e2e/axe.spec.js` runs the [axe-core](https://github.com/dequelabs/axe-core) engine against one
fully-rendered state of every page (WCAG 2.0/2.1 A + AA). It is the app's first automated
accessibility coverage — closing the gap the v17.45 audit flagged. Run it with **`npm run test:a11y`**.

It is a **floor**: axe catches the machine-checkable ~third of real issues (labels, names, contrast,
ARIA, duplicate ids). It does not replace a manual screen-reader pass.

## Current status — NOT yet blocking

The gate is tagged `@a11y` and **excluded from `npm run test:e2e`** (via `--grep-invert`), so it does
not yet block CI. It currently reports two rule types of **pre-existing** debt (below). Once each is
fixed or consciously waived, drop the `--grep-invert @a11y` from `test:e2e` so the gate blocks — and
add a global waiver (with a reason) in `axe.spec.js` for anything deliberately accepted.

## Findings (baseline, Jul 2026 — reviewed against the app at v17.49)

### 1. `nested-interactive` (SERIOUS) — every collapsible card, all 5 signed-in pages + paycalc

`initCardCollapse` (overlay.js) sets `role="button"` + `tabindex="0"` on each
`.card-collapsible-header`, but the header contains a nested real `<button class="btn-card-tips">?</button>`
(the Tips button). An interactive element must not wrap another — screen readers and keyboard users
get an ambiguous focus/activation target.

- **Scope:** shared pattern → admin, paycalc, operations, settings, links (every card header with a
  Tips button).
- **Recommendation: FIX (shared refactor).** The correct disclosure-widget shape is: the header is a
  plain container; a dedicated inner `<button>` is the collapse toggle (wrapping the heading text +
  chevron); the Tips button is a **sibling** of that toggle, not nested inside it. Touches
  `initCardCollapse` + every card header's markup — real regression surface (collapse behaviour,
  Tips buttons, keyboard), so do it as its own reviewed change, not a drive-by.

### 2. `color-contrast` (SERIOUS) — calendar, paycalc, guides

Muted text / badges whose contrast is below the 4.5:1 AA threshold. Flagged elements include:
calendar `#alBtn` / `#payBtn` and other-month day numbers; paycalc badges (`#paycalcBadge`,
`#badge-sat`, `#badge-ot`); guide `.guide-footer`, railcard `.rc-cost` / `.rc-lbl`, shift badges
(`.sb-early` / `.sb-al`), FIP `.not-fip-name`.

- **Recommendation: TRIAGE then FIX the genuine near-misses.** Measure each flagged element's real
  ratio; nudge the token darker where it is a true miss (a 4.3:1 grey → darker grey is invisible to
  most users but clears AA). Some may be intentional low-emphasis decoration on non-essential text —
  waive those explicitly. **Design-token territory** (`shared.css` / guide CSS, oklch tokens, the
  "never hardcode hex" rule) — affects the whole app's look, so verify with screenshots and keep the
  brand palette. Not a blind auto-fix.

## Waived rules

None yet. When a rule is consciously accepted, add it to `GLOBAL_WAIVERS` (or a page-local waiver) in
`axe.spec.js` **with a one-line reason**, and record it here.

## Promotion path

1. Fix `nested-interactive` (shared collapse refactor).
2. Triage + fix the genuine `color-contrast` misses; waive any intentional low-emphasis text.
3. Re-run `npm run test:a11y` → green.
4. Remove `--grep-invert @a11y` from `test:e2e` so the gate blocks; consider adding it to `npm run check`.
