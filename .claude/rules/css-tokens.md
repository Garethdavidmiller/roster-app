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

## No dark mode — fixed light scheme, hard opt-out (v17.16 meta; strengthened v18.10)

The app has **no dark theme** and must not gain one implicitly. The design is a fixed navy
canvas with **off-white cards** (`--surface`, above), so an OS/browser "force dark" that inverts
light surfaces mangles it — the off-white cards flip to grey while the navy stays put (a real
staff report, Jul 2026, on a Samsung device). To opt out of algorithmic darkening the app declares
**`color-scheme: only light`** in `shared.css` (on `html`) AND as a `<meta name="color-scheme"
content="only light">` on every served page (all six app pages + all four guides — the guides don't
import `shared.css`, so the meta is their only signal). The `only` keyword (v18.10, was plain
`light`) forbids a conforming browser from overriding the scheme. **Do not add a
`prefers-color-scheme` rule or a dark palette** without an explicit owner decision — there is none
anywhere in the codebase by design, and a force-dark report is a device-side setting (Samsung
Internet / Chrome auto-dark / system force-dark), not an app bug to "fix" with a dark theme. A
stale cached copy predating v17.16 (no opt-out at all) is the other cause — resolved by updating
the install, not by code.

## Canonical card-header system (v18.16 — the admin parity pass)

`shared.css` hosts ONE row-header system, promoted verbatim from paycalc (the v17.95–v18.07
polish generation): `.card-header-toggle` (collapsible) / `.card-header--row` (static) lay out a
left `<div>` (title `h2` + `.hint`) against a right `.card-header-actions` cluster (optional
`.card-year-chip` context chip → Tips/Help `?` button → collapse arrow). `.card-year-chip` names
the card's tax year / balance / count even while collapsed (`:empty` hides it); `.field-eyebrow`
is the shared uppercase micro field label (GRADE, TAX CODE, …). **Used by ALL six app pages** (paycalc + admin v18.16; operations + settings + links v18.17). The
old `.card-collapsible-header` grid header is **retired** — only the shared `.card-collapsible-body`
(show/hide) and `.collapse-chevron` remain. Header context chips currently: `AL left: N` on admin
(`.al-left-chip` low/none recolours) and the Saved Changes count; the Error Log unresolved count on
operations (`.errorlog-count-chip`, red). Chips are added only where a card is often COLLAPSED and
has one clear datum — not on default-open cards (settings/links analysis got structural migration,
no chips). **Card titles are `h2` on every page, and every card title leads with an emoji** (v18.86). Both are
enforced by `card-header-parity.test.mjs` — they had each drifted unnoticed: operations.html marked
all nine of its cards up as `h3` (shared.css styled `h2, h3` identically, so it looked right while
the page's heading outline ran h1 → h3 with no h2 — axe's heading-order rule is tagged
best-practice, not WCAG A/AA, so the a11y gate never saw it), and "Change a Shift" was the only
card header in the app without a leading emoji. The `h3` half of the shared selector was removed so
a stray `h3` now looks wrong immediately rather than hiding.

**Do not re-create page-local copies of these classes** — that split is exactly how the
header systems drifted apart pre-v18.16. A11y invariant (v17.50): the focusable collapse toggle is
the ARROW/CHEVRON, never a header wrapping another button — `initCardCollapse` enforces it, the axe
gate fails on violations.

## Motion vocabulary + unified press (v11.56)

One easing/duration vocabulary in `shared.css :root`:
- `--ease-standard` (general)
- `--ease-emphasized` (entrances)
- `--ease-spring` (overshoot)
- `--dur-fast` (0.12s) / `--dur-med` (0.15s) / `--dur-base` (0.2s) / `--dur-slow` (0.25s) /
  `--dur-slower` (0.3s — content reveals; added v18.87 because the scale stopped at 0.25s, so every
  reveal hardcoded its own longer value and they drifted to 0.3/0.35/0.4s)

Use these tokens, not inline `cubic-bezier(...)` or a bare `ease`.

**Two overlay corner families, both named** (v18.87): compact white DIALOGS (month-jump, team info,
login, work-email check, Tips, confirm/prompt) use `--radius-xl` (20px); full navy GLASS SHEETS
(About, notices, day detail, AL) use `--radius-panel` (24px). The difference is deliberate, but only
the dialog side had a name — the six glass panels each restated `border-radius: 24px`, so the rule
lived nowhere. No pixels moved.

**An overlay never wears the card radius** (v18.90). The v18.87 pass above described two families
while the code had three: four white panels (`#loginCard`, `#emailCheckContent`,
`#tipsLightboxContent`, `.dialog-lb-content`) sat on `--radius-lg`, which is the radius `.card` uses
on every page. A token hides that in a way a literal wouldn't — `--radius-lg` reads like it belongs
to a large panel, and `.dialog-lb-content` even carried a comment claiming it matched "the
modal-picker panel family", though no picker sets it. Sharing a silhouette with the card underneath
flattens the layering an overlay depends on. All four now sit on `--radius-xl`, so the two-family
description is true of the code. When adding an overlay, pick a family — never `--radius-lg`.

## Focus indicators — four tokens, one invisible system (v18.99)

Focus is the app's only design system you cannot see in a screenshot: a ring is drawn solely while a
keyboard user is on the element. So the visual baselines can't catch drift in it, and axe has no rule
for indicator quality either. Predictably, the recipes had become ~80 hand-written literals across
the seven app stylesheets. They now live in `shared.css :root` and **must be used, never restated**:

| Token | Value | Use |
|-------|-------|-----|
| `--focus-outline` | `2px solid var(--primary-blue)` | The default — light surfaces (cards, prose, fields) |
| `--focus-outline-gold` | `2px solid var(--accent-gold)` | The navy drawer and other dark surfaces only |
| `--focus-outline-light` | `2px solid rgba(255,255,255,.85)` | The darkest fills (burger, guide header, design chips) |
| `--focus-ring` | `0 0 0 4px var(--focus-ring-color)` | The 4px glow a FIELD adds beneath its outline |

Which outline is a **contrast** decision, not a taste one: gold on a light surface is ~1.5:1 and
fails the 3:1 focus-indicator floor — never use it there. **Every focusable field carries
`--focus-ring`**; the shared `promptDialog` input was the one exception (`outline: none` and nothing
in its place) until v18.87 — the weakest indicator in the app, inside a modal, where keyboard users
most need it.

**Never leave a Tab stop with no indicator.** `outline: none` in a focus rule is legitimate only when
a `box-shadow` ring replaces it, or the element genuinely is not tabbable (`#hourlyRate` carries
`tabindex="-1"`). The back-pay locked rate boxes failed this until v18.99 — the JS sets `readOnly`,
not `disabled`, so four reachable inputs showed nothing at all on focus. Both halves are enforced by
`focus-ring-parity.test.mjs`, which keeps the exemptions in a named list so a new suppression has to
be argued for rather than merely typed.

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

All colour values must be in CSS variables in `:root` — never hardcode hex. **And a page-local
token that mirrors an app colour must FORWARD it (`var(--orange)`), not restate its hex** (v18.86):
`links.css` carried its own copies of the Early/Late colours labelled "app early"/"app late" which
had drifted measurably from the tokens they claimed to mirror (early 10% darker and 13° off hue,
late 6% lighter and 11.5° off) once `shared.css` moved to `oklch()`. `guide-colour-parity.test.mjs`
now asserts the forwarding for the Links workspace, alongside the guides.

## The orange family — a deliberate three-token split (v17.55–57)

"Orange" is intentionally THREE tokens with distinct duties. This is not drift — the bright
orange cannot carry white text at WCAG AA (2.15:1), so darker variants exist for those duties:

| Token | L | Duty |
|-------|---|------|
| `--orange` (bright) | 77% | Ambient/identity colour only, never under white text: **Operations page identity** (nav pill, `#opsBadge`, ops notice badge), the paycalc Saturday pay badge's border, the admin overwrite-pending / correction pills |
| `--orange-deep` | 54% | Fill carrying **white text**: the admin `.pill-correction.active` only (was also the Early badge until v17.84) |
| `--orange-text` | 44% | Darkened orange **text on white / `--orange-light`**: `.badge-sat` text, `.pill-correction` idle text — the orange-family analogue of `--rdw-text`/`--other-text`/`--absence-text` |
| `--early-cell` / `--early-cell-border` | = `--orange` | **Early-shift CALENDAR surfaces only** (month-grid cell tint + border, legend swatch, Team-View cell + key dot, print rule). **Restored to the ORIGINAL bright amber at v17.88** (alias `--orange-light` / `--orange`) after the v17.80 softening was tried and reverted — the cell has no white-text rule (dark date number), so it can be the full bright orange. Kept as named tokens so it stays a one-line lever. |
| `--early-badge` | 57% | **☀️ Early BADGE fill only** (`.badge-early`, screen + print; white text). The BRIGHTEST true-orange that still clears WCAG AA under white text — L57% at the original hue = **4.64:1** (v17.88, owner: "closest to original"). This is the accessible ceiling; above ~L57% white text fails (a brighter badge would need dark text). |

**Rules:** never put white text on `--orange` (use `--orange-deep`/`--early-badge`); never use
`--orange` as text on a light surface (use `--orange-text`). The Early **badge** (`--early-badge`) is
the max-brightness white-text orange (L57%, at the AA line — do not lighten further).

**Early calendar cell = the original bright `--orange` (v17.88).** The v17.80 "softer amber" cell was
tried and reverted; `--early-cell` / `--early-cell-border` now alias `--orange-light` / `--orange`, so
the Early cell, the Operations accent, and the paycalc Saturday pay badge all share the one bright
orange again. The tokens are kept (rather than pointing index.css back at `--orange`) so the Early
cell remains a single-line change if it's ever retuned. The **badge** keeps its own `--early-badge`
token because white text caps its lightness (L57%) well below the L77% cell.

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
  day-cards (it no longer needs a wide table). **Settings** is a special case: it's two tiny
  single-field cards, so rather than a wide band it uses **one centred ~600px single column,
  cards stacked** (v18.59 — the v15.90 860px two-column grid read as sparse/half-empty on
  desktop, per the review). It does not route through `--content-max-width`. When adding a
  page, route its desktop `max-width` through one of these tokens (Settings excepted).

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
**Paycalc resolved its void** (v16.12→v16.14 rail, replaced at **v16.67**; single shared row
**v18.47**): a three-column desktop grid whose workspace is ONE grid row holding two wrappers —
`.pc-work` (period band + Hours + Settings, spanning the two wide work columns) and the col-3
**sidebar** `.pc-side` (result + the four occasional cards). Both are `display:contents` on
mobile / flex columns on desktop. The v16.14 version put ONLY the result (a sticky rail) in
col 3, leaving the rest of that column a full-height navy void — the desktop "it's a mess"
report; the v16.67 fix stacked the occasional cards under the (now non-sticky) result, with the
`#stickyTotal` bottom bar keeping the £ visible. v18.47 then closed the remaining
**expanded-sidebar void**: the sidebar used to SPAN the left items' three grid rows, so an
all-expanded sidebar taller than the left column made grid distribute the excess across the
spanned tracks — inflating the period-band row into a mid-page navy gap. One shared row means
neither column can inflate the other; a modest residual gap sits at the shorter column's
BOTTOM only. operations has no equivalent card to relocate, so its left-column void stands
(admin's was mitigated — above).

**Empirically re-confirmed (v17.73, Section B / F-VIS-1 review).** The operations void was
re-examined with rendered desktop screenshots at 1024/1280/1440, and the one zero-mobile-regression
card move was prototyped: relocating the **Weekly Roster** card (the boundary card — last-left ↔
first-right) to the bottom of the left column keeps the mobile source order **identical** and the
roster upload FORM fits the narrow (~340px) column fine. BUT the render proved the move does **not
eliminate** the void — it merely **relocates** it (a tall expanded card on either side leaves navy
below the shorter column; with Roster on the left, an expanded Roster makes the *right* column the
short one). This is the general truth of any two-column collapsible layout: static card placement
can only move a void, not remove it (only masonry — still not baseline — or a single column would).
Combined with the roster-review table wanting the wide column and the e2e column-assignment guard,
the reorder is **net-negative**, so operations is **left as-is** (this is not un-reviewed drift —
it's the tested conclusion). The composition of all these surfaces (incl. the voids) is now **locked
by the visual-regression baselines** (`e2e/visual.spec.js`, `npm run test:visual`), so any future
change to it is caught rather than shipping silently.

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

**Box-shadows are deliberately NOT routed through `--shadow-1/2/3`** (reviewed v17.58): ~120
hand-rolled `rgba()` shadows exist with varied values; forcing them onto the three presets would
visibly restyle depth across the app — a redesign, not hygiene. Use the `--shadow-*` tokens for NEW
shadows; leave existing ones unless intentionally redesigning that surface.

## Density is a POINTER-vs-TOUCH decision, not a width one (v18.89)

Admin's day row was 69px tall at 390px *and* at 1280px — the label stacked ("Sun" over "19 Jul")
and the padding was sized for a thumb, so seven rows put ~480px of largely empty card into the
page's primary control. Desktop now gets a one-line label and trimmed padding under
`@media (min-width: 1024px) and (pointer: fine)`: the row drops to 52px and the card loses 179px.
**Gate density on `pointer: fine`, not on width alone** — a wide touch screen still needs the
44px-target spacing. And note the second-order win: shortening the tall column shrinks the
accepted two-column void, which card *reordering* can only relocate (above). Height is a lever
the void discussion never considered.

## Prose is left-aligned once it passes ~2 lines (v18.89)

Overlay body copy (`.notice-body`, `.lightbox-privacy`, paycalc's `.welcome-desc`) used to be
centred. Centred text is fine for a line or two and works against the reader beyond that — every
line starts at a different x, so the eye has to re-find each one, and these run 3–5 lines. The
badge/title/date **masthead stays centred**; only the prose is left-aligned, which is the
arrangement the About panel already used. The `new-notice` skill template carries the same rule so
future notices inherit it.

**A button under a field matches the field.** Settings capped `.btn-action` at 280px on desktop —
exactly half the 536px field above it and sharing its left edge, so every card ended with a 256px
gutter. Full width is what the login overlay and the mobile layout already do.
