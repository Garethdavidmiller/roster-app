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

## Brand colours

| Variable | Hex | Use |
|----------|-----|-----|
| `--primary-blue` | `#001e3c` | Dark navy — headers, buttons, day-header cells |
| `--primary-blue-dark` | `#00152a` | Deeper navy — hover states |
| `--accent-gold` | `#f5c800` | Gold — today cell, today button, active highlights |
| `--accent-gold-dark` | `#e6bb00` | Darker gold — hover on today button |

The hex column is the brand reference (and is what the `<meta name="theme-color">` tags and `guide-shell.css` use, since the guides don't import `shared.css`). The live `:root` definitions in `shared.css` express these in `oklch()` — and `--primary-blue-dark` / `--accent-gold-dark` are now `color-mix(in oklch, …)` expressions derived from their base token, not static hex. When editing tokens, edit the `oklch`/`color-mix` values in `shared.css`, not these hex equivalents.

All colour values must be in CSS variables in `:root` — never hardcode hex.

## Dark (navy) nav drawer + scoped tokens (v11.54)

The whole drawer is one continuous navy surface (`--nav-surface` = `--primary-blue`), matching the page header and the navy login overlay so the three read as one family. A set of **drawer-scoped tokens** on `.nav-panel`:
- `--nav-raised` / `--nav-raised-strong` — white-overlay chips & hover fills
- `--nav-text` / `--nav-text-muted` (0.70) / `--nav-text-faint` (0.55)
- `--nav-border` (0.12)

These are the on-navy equivalents of the global `--text-*` / `--border-light` / `--bg-faint` neutrals. Alpha values are tuned for WCAG AA on navy (0.70 ≈ 7:1, 0.55 ≈ 5:1). Head and footer are separated from the scrolling body by hairline `--nav-border` borders, not by a colour change.

**Pills:** Calendar (gold), Pay (green), Operations (orange) keep their solid fills; the **Admin pill** uses `--nav-raised` with gold text (not navy-fill, which would vanish on navy). Sign-out and the blocked-bell hint mix `--error-red` 65% with white to clear AA on the dark footer. Do not revert the drawer to a white body.
