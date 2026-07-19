---
paths:
  - "*.css"
---

# CSS token and surface rules

## Three-surface model (v11.55, updated v11.58)

Depth comes from three layered surfaces, defined in `shared.css :root`:

- **canvas** (`--surface-canvas` = navy `--primary-blue`) — the page `body` on every page
- **card** (`--surface` = `oklch(98% 0.004 250deg)`) — a barely-tinted off-white; cards "sit into" the canvas
- **sunken** (`--surface-sunken` = `oklch(96.3% 0.006 250deg)`) — more visibly cool-tinted off-white for recessed elements *inside* cards

Form fields rest on `--field-bg` (= sunken, 96.3% L) and **brighten to `white` on `:focus-visible`** — a "fills in when active" cue. **Focus rules use the literal value `white`, NOT `var(--surface)`** — focus must always reach the true white ceiling above the card surface.

Card backgrounds use `var(--surface)` (not hardcoded `white`); lightbox contents, buttons, day cells, and select options stay at `white` (they are Layer 2, raised above the card).

Disabled fields use `--field-bg-disabled` (a flatter, slightly darker NEUTRAL grey), kept deliberately distinct from the cool enabled tint so locked/disabled controls read as inert; admin's `#fieldMember:disabled` (locked-for-non-admins display box) intentionally uses `--field-bg`, not the disabled grey, so it reads as a normal field.

**Always set field fills with `background-color` (longhand)** — `<select>`s layer their dropdown arrow via `background-image`, which the `background` shorthand would wipe.

The navy canvas is intentional — do not switch the body to a light canvas.

## Motion vocabulary + unified press (v11.56)

One easing/duration vocabulary in `shared.css :root`:
- `--ease-standard` (general)
- `--ease-emphasized` (entrances)
- `--ease-spring` (overshoot)
- `--dur-fast` / `--dur-base`

Use these tokens, not inline `cubic-bezier(...)`.

**Every primary button** (calendar `.controls button`, paycalc `.btn-primary`/`.nav-pill`/`.ty-tab`, admin `.btn-save`, settings/operations `.btn-action`, shared `#loginSubmit`) shares one tactile press: `:active { transform: scale(var(--press-scale)) }` with `transform` in its `transition`. `--press-scale` is `0.97`, overridden to `1` under a single `@media (prefers-reduced-motion: reduce)` block — so the press becomes a no-op for reduced-motion users **without** a global transition-killer (which would break the lightbox's `transitionend`-driven close).

Nav-drawer pills/links keep their opacity-based press (the flat-drawer aesthetic) — do not scale them.

## Typography scale — shared `--type-*` tokens (standardised v11.77–v11.79)

One type scale in `shared.css :root`:
- `--type-micro` 10px
- `--type-small` 12px
- `--type-label` 13px (card headers, dense row text)
- `--type-body` 14px
- `--type-button` 15px (primary action buttons)
- `--type-medium` 16px
- `--type-large` 18px
- `--type-xl` 24px

The four sub-pages (admin, paycalc, operations, settings) use **identical sizes for the same conceptual element**:
- `body` base → `--type-body`
- card-header `h2` → `--type-label` (13px/700)
- card `.hint` → `--type-small`
- form/eyebrow labels → `--type-small`
- inputs/selects → `--type-medium` (16px also stops iOS focus-zoom — **never go below 16px on a focusable field**)
- primary action buttons (`.btn-action`/`.btn-primary`/`.btn-save`) → `--type-button` (15px)

Genuinely distinct components (nav drawer pills, dense roster-review rows, badges, lightbox text) keep their own sizes — they are not "the same element rendered differently", so do not force them onto the shared values. When adding a card/field/button to any sub-page, reuse these sizes rather than inventing new ones.

## Self-hosted Inter typeface (v11.53)

`fonts/inter-latin.woff2` is served from origin, NOT Google Fonts CDN. CSP is `font-src 'self'` — a CDN would mean loosening it, and self-hosting keeps the app offline-first (SW precaches the file) with no third-party request. One variable woff2 (latin, wght 100–900) covers every weight.

`@font-face` lives in `shared.css`; `--font-sans` token in `:root` is the single place the stack is defined; every page's `body` uses `var(--font-sans)`. Do not re-add a Google Fonts `<link>`.


**Inter is the only typeface.** A display face (Barlow Semi Condensed, hero £ + month heading)
was tried at v16.73 and reverted at v16.74 — owner decision: the character gain was modest, and
Inter (a neo-grotesque, same family as the real Rail Alphabet) already fits the brand. Don't
re-add a second face without a fresh discussion.

## Brand colours

| Variable | Hex | Use |
|----------|-----|-----|
| `--primary-blue` | `#001e3c` | Dark navy — headers, buttons, day-header cells |
| `--primary-blue-dark` | `#00152a` | Deeper navy — hover states |
| `--accent-gold` | `#f5c800` | Gold — today cell, today button, active highlights |
| `--accent-gold-dark` | `#e6bb00` | Darker gold — hover on today button |

The hex column is the brand reference (and is what the `<meta name="theme-color">` tags and `guide-shell.css` use, since the guides don't import `shared.css`). The live `:root` definitions in `shared.css` express these in `oklch()` — and `--primary-blue-dark` / `--accent-gold-dark` are now `color-mix(in oklch, …)` expressions derived from their base token, not static hex. When editing tokens, edit the `oklch`/`color-mix` values in `shared.css`, not these hex equivalents.

All colour values must be in CSS variables in `:root` — never hardcode hex.

## The orange family — a deliberate three-token split (v17.55–57)

"Orange" is intentionally THREE tokens with distinct duties. This is not drift — the bright
orange cannot carry white text at WCAG AA (2.15:1), so darker variants exist for those duties:

| Token | L | Duty |
|-------|---|------|
| `--orange` (bright) | 77% | Ambient/identity colour only, never under white text: the Early calendar-cell tint + border, month-legend/Team-View key, **Operations page identity** (nav pill, `#opsBadge`), the Saturday badge's border, the admin overwrite-pending badge (idle) |
| `--orange-deep` | 54% | Fills that carry **white text**: `.badge-early` (screen + print), `.pill-correction.active` |
| `--orange-text` | 44% | Darkened orange **text on white / `--orange-light`**: `.badge-sat` text, `.pill-correction` idle text — the orange-family analogue of `--rdw-text`/`--other-text`/`--absence-text` |

**Rules:** never put white text on `--orange` (use `--orange-deep`); never use `--orange` as text
on a light surface (use `--orange-text`). The Early **cell** stays bright (owner decision v17.56:
the current calendar design is kept) while the Early **badge** is deep — that lightness split is
accepted and intentional, matching the badge family's 45–54% L fills.

## Dark (navy) nav drawer + scoped tokens (v11.54)

The whole drawer is one continuous navy surface (`--nav-surface` = `--primary-blue`), matching the page header and the navy login overlay so the three read as one family. A set of **drawer-scoped tokens** on `.nav-panel`:
- `--nav-raised` / `--nav-raised-strong` — white-overlay chips & hover fills
- `--nav-text` / `--nav-text-muted` (0.70) / `--nav-text-faint` (0.55)
- `--nav-border` (0.12)

These are the on-navy equivalents of the global `--text-*` / `--border-light` / `--bg-faint` neutrals. Alpha values are tuned for WCAG AA on navy (0.70 ≈ 7:1, 0.55 ≈ 5:1). Head and footer are separated from the scrolling body by hairline `--nav-border` borders, not by a colour change.

**Pills:** Calendar (gold), Pay (green), Operations (orange) keep their solid fills; the **Admin pill** uses `--nav-raised` with gold text (not navy-fill, which would vanish on navy). Sign-out and the blocked-bell hint mix `--error-red` 65% with white to clear AA on the dark footer. Do not revert the drawer to a white body.

## Desktop layout — content width + reading measure (v15.90)

**Two content-width tokens, single-sourced in `shared.css :root` — never hardcode a page width:**
- `--page-max-width` (1400px) — **calendar only**. Its 7-column month grid and the Team Week
  View matrix genuinely use the horizontal space.
- `--content-max-width` (1100px) — **every other page** (admin, paycalc, operations, settings,
  links). Keeps forms and prose a comfortable width and stops the app re-laying-out ~300px on
  every desktop hop. Admin joined this group at v15.90 once its week grid became vertical
  day-cards (it no longer needs a wide table). **Settings** caps narrower still (860px in
  `settings.css`) — it's two tiny single-field cards, so the full band left them stretched.
  When adding a page, route its desktop `max-width` through one of these tokens.

**Reading measure:** on desktop, full-width **prose** (card descriptions/`.hint`, disclaimers,
notes, generator intro) is capped with `max-width: ~64–72ch` at the `min-width: 1024px`
breakpoint so text doesn't run past the ~75ch comfortable ceiling. Forms, tables, grids and
data-viz keep the full column width — only prose gets the measure cap. Data-viz bar charts
(`.usage-bars`/`.speed-rows`) are capped (~540px) so bars stay a comparable, scannable length.

**Accepted constraint — two-column voids.** admin and operations use an explicit-grid
two-column desktop layout whose row order is fixed so the SAME source order can give a good
mobile stack. Because column heights differ, the shorter column shows a navy void
(operations' left upload stack). This is inherent to preserving the mobile source order
without a masonry layout (not yet baseline-supported); it is a cosmetic gap on a secondary
(desktop) surface and is **deliberately left as-is** — do not "fix" it by reordering, which
would regress the mobile stack. (Reviewed v15.90 desktop UX pass.)
**Admin mitigated its right-column void** (v16.72): the "Saved Changes" card (`#overridesCard`)
was moved OUT of the left column (it used to stack under the tall Change-a-Shift card via
`#overridesCard { grid-column: 1 }`) and INTO the sticky `.col-side` right column, where it
stacks under Absence and fills the column (it grows with content / when expanded). Mobile
order is unchanged (col-side contents still stack after col-main). A smaller residual gap
remains at the bottom-right when the right-column cards are all collapsed — mirroring paycalc.
**Paycalc resolved its void** (v16.12→v16.14 rail, replaced at **v16.67**): a three-column
desktop grid where Hours + Settings span the two wide work columns (wide → short) and a col-3
**sidebar** (`.pc-side`, `display:contents` on mobile / flex column on desktop) stacks the result
card + the four occasional cards, so column 3 is FILLED. The v16.14 version put ONLY the result
(a sticky rail) in col 3, leaving the rest of that column a full-height navy void — the desktop
"it's a mess" report; owner-approved "fill column 3" fix stacks the occasional cards under the
(now non-sticky) result, with the `#stickyTotal` bottom bar keeping the £ visible. A modest
residual gap (left cards inherently taller) sits at the bottom-right. operations has no
equivalent card to relocate, so its left-column void stands (admin's was mitigated — above).

## Accepted colour overloads — reviewed and closed (v17.58)

A colours review traced every semantic colour across all surfaces and found these cross-concept
shares. All were **reviewed with the owner and accepted** — do not re-flag or "fix" them: the app
never uses colour as the sole carrier of meaning (every badge has a label + emoji, per WCAG 1.4.1),
the colliding surfaces are rarely co-visible, and adding new hues to separate them would cost more
than the purity gain.

- **paycalc pay badges deliberately borrow the roster's shift colours** — Saturday wears Early
  orange, Sunday wears Late blue, and the Bank-Holiday badge wears the AL teal. The rate-chip
  labels carry the meaning; the colours tie the pay categories to the roster's visual language.
- **`--purple` = Spare shift AND the Links page identity** — Links is visible to two designers
  only, so the pairing is effectively never co-visible for ordinary staff.
- **`--blue-sky` = Late shift AND assorted admin accents** (source pill, overwrite-active) — same
  rationale: labelled, low co-visibility.
