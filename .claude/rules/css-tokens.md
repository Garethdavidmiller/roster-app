---
paths:
  - "*.css"
---

# CSS token and surface rules

## Three-surface model

Depth comes from three layered surfaces, defined in `shared.css :root`:

- **canvas** (`--surface-canvas` = navy `--primary-blue`) — the page `body` on every page
- **card** (`--surface` = `oklch(98% 0.004 250deg)`) — a barely-tinted off-white; cards "sit into" the canvas
- **sunken** (`--surface-sunken` = `oklch(96.3% 0.006 250deg)`) — a more visibly cool-tinted off-white for recessed elements *inside* cards

**On the NAVY canvas the third rung is a white overlay, not an off-white fill** — `--on-navy-raised`
(white 9%), `--on-navy-hairline` (white 12%) and `--on-navy-raised-strong` (white 16%, the
pressed/hover rung above it), with `--on-navy-muted` (0.70) and `--on-navy-faint` (0.55) for text, all
in `shared.css :root` (a card surface would be a hole punched in the navy). The drawer's pills and the
calendar's install/notification prompt strips use them — never a local copy of the literals.

Form fields rest on `--field-bg` (= sunken, 96.3% L) and **brighten to `white` on `:focus-visible`** —
a "fills in when active" cue. **Focus rules use the literal value `white`, NOT `var(--surface)`** —
focus must always reach the true white ceiling above the card surface. Card backgrounds use
`var(--surface)` (not hardcoded `white`); lightbox contents, buttons, day cells and select options stay
at `white` (they are Layer 2, raised above the card).

Disabled fields use `--field-bg-disabled` (a flatter, slightly darker NEUTRAL grey), distinct from the
cool enabled tint so they read as inert; admin's `#fieldMember:disabled` (the locked-for-non-admins
display box) intentionally uses `--field-bg`, so it reads as a normal field.

**Always set field fills with `background-color` (longhand)** — `<select>`s layer their dropdown arrow
via `background-image`, which the `background` shorthand would wipe.

The navy canvas is intentional — do not switch the body to a light canvas.

## No dark mode — fixed light scheme, hard opt-out

The app has **no dark theme** and must not gain one implicitly: an OS/browser "force dark" flips the
off-white cards to grey while the navy stays put (a real staff report on a Samsung device). So the app
declares **`color-scheme: only light`** in `shared.css` (on `html`) AND as a
`<meta name="color-scheme" content="only light">` on every served page — every app page and every
guide, for which the meta is the only signal (they do not import `shared.css`). `only` forbids a
conforming browser from overriding the scheme. **Do not add a `prefers-color-scheme` rule or a dark
palette** without an explicit owner decision: a force-dark report is a device-side setting (Samsung
Internet / Chrome auto-dark / system force-dark) or a stale install that predates the opt-out — fixed
by updating the install — not an app bug to "fix" with a dark theme. **Samsung Internet is the one the
opt-out cannot reach** (confirmed 23 Oct 2026); the answer is per device, not in code —
KNOWN_LIMITATIONS.md → "Samsung Internet’s Dark mode repaints the app dark".

## Canonical card-header system

`shared.css` hosts ONE row-header system: `.card-header-toggle` (collapsible) / `.card-header--row`
(static) lay out a left `<div>` (title `h2` + `.hint`) against a right `.card-header-actions` cluster
(optional `.card-year-chip` context chip → Tips/Help `?` button → collapse arrow). `.card-year-chip`
names the card's tax year / balance / count even while collapsed (`:empty` hides it); `.field-eyebrow`
is the shared uppercase micro field label (GRADE, TAX CODE, …). Every card-bearing app page uses it
(`cardPageFiles` in `scripts/app-pages.mjs`); the calendar has no cards. The old
`.card-collapsible-header` is **retired**; only `.card-collapsible-body` (show/hide) and
`.collapse-chevron` remain.

- **Header context chips** go only where a card is often COLLAPSED and has one clear datum (Admin's
  leave chip, `2026: N left`, with `.al-left-chip` low/none recolours, and the Saved Changes count; Operations' Error
  Log and reset-request counts, `.errorlog-count-chip`, red; Settings, Overtime and Trains carry their
  own) — never on default-open cards.
- **Card titles are `h2` on every page, and every card title leads with an emoji** — both enforced by
  `card-header-parity.test.mjs`. There is no `h3` in the shared title selector, so a stray `h3` looks
  wrong at once (axe's heading-order rule is best-practice, not WCAG A/AA, so the gate would not see a
  broken outline).
- **No tile behind the emoji, and do not bring one back to "add colour"** (owner decision, confirmed by
  side-by-side screenshots; shared.css → "NO ICON TILE" has why). The page's colour goes on what you
  have CHOSEN instead (below).
- **The emoji is the heading's FIRST element, `<span aria-hidden="true">`**
  (`card-header-parity.test.mjs` convention 3), and **a wrapped title hangs from it**: the h2 is a flex
  row (`align-items: baseline`, `gap: 0.25em`), so the emoji stays on the FIRST line and a second line
  starts under the words. ONLY where the emoji is the title's sole element — a title holding a second
  element ("Link design — `<span>`26`</span>` lines") stays inline (shared.css → "A WRAPPED TITLE HANGS
  FROM ITS EMOJI"). `e2e/pages.spec.js` → "a card title's emoji sits inside its title, on its first
  line, and a wrapped title hangs from it" measures all three on every card page at 360px.
- **The gap is a space, measured.** A space in Inter 700 at 14px is 3.19px; 0.25em is 3.5px. Pay's
  "🏖️ Holiday Pay Premium (HPP)" title fits one line at 375px with **2px** to spare (and wraps at
  360px), so a wider gap, a wider header chip or a bigger title size spends that line.
- **The header shares the card's surface**: `--surface` with a hairline beneath it, the title
  `--type-body` at 700 with `-0.01em` tracking and `text-wrap: balance`. The `?` Tips circle is 24px
  with `--type-small`, the size of the shared `.help-btn`, and keeps its 44px target.
- **Settings' status chips are coloured by their card's state** (`data-tone`), by the SAME
  declarations as the summary strip, so the two cannot disagree; notifications switched off on purpose
  report `'plain'`, not `ok` (settings.css → "THE CARD CHIPS WEAR THE STRIP'S COLOURS"). Pinned by
  `e2e/settings.spec.js`.

**Do not re-create page-local copies of these classes** — a page that keeps its own copy of the band
or the title size silently keeps the old look when the shared header changes, and nothing fails. A11y
invariant: the focusable collapse toggle is the ARROW/CHEVRON, never a header wrapping another button
— `initCardCollapse` enforces it, and the axe gate fails on violations.

## Motion vocabulary + unified press

One easing/duration vocabulary in `shared.css :root`: `--ease-standard` (general), `--ease-emphasized`
(entrances), `--ease-spring` (overshoot); `--dur-fast` (0.12s) / `--dur-med` (0.15s) / `--dur-base`
(0.2s) / `--dur-slow` (0.25s) / `--dur-slower` (0.3s — content reveals).

Use these tokens, not inline `cubic-bezier(...)` or a bare `ease`. Leaving the curve out (the CSS
default) is the app's common form and is allowed; `index.css` is held to the rule by
`calendar-controls-parity.test.mjs` 7.

**Two overlay corner families, both named:** compact DIALOGS use `--radius-xl` (20px) — the white
ones (month-jump, login, Tips, confirm/prompt, the Calendar's Circular/Newsletter viewer) and the
Calendar's team info, a compact see-through one; full navy GLASS SHEETS (About, notices, day detail,
AL) use `--radius-panel` (24px). The Pay Calculator's `?` help sheet is a see-through glass sheet at the
Tips' `--modal-standard` width — one width at every size (desktop audit, 7 Nov 2026).

**Within the glass family, four are SOLID:** the one-time notices, the About panel and the drawer's
App Notices and Coming Soon panels share one opaque navy sheet (`.notice-lb-content,
#iconLightboxContent, #navNoticesContent, #navComingSoonContent` in shared.css — a panel that wants it
joins the selector list, never copies it). Day detail and AL stay see-through: they look at something
still on screen. See-through, a notice's or About's contrast would depend on the page underneath (App
Notices' section labels measured 3.0–3.4:1 over Admin's light cards).

**An overlay never wears the card radius.** `--radius-lg` is `.card`'s radius, and sharing the card's
silhouette flattens the layering an overlay depends on (the name makes it look like a panel radius).
Pick a family — never `--radius-lg`. The Calendar's own panels are held to it by
`calendar-controls-parity.test.mjs` 8.

## Focus indicators — four tokens, one invisible system

No screenshot and no axe rule sees a focus ring, so a hand-written one drifts silently. The recipes
live in `shared.css :root` and **must be used, never restated**:

| Token | Value | Use |
|-------|-------|-----|
| `--focus-outline` | `2px solid var(--primary-blue)` | The default — light surfaces (cards, prose, fields) |
| `--focus-outline-gold` | `2px solid var(--accent-gold)` | The navy drawer and other dark surfaces only |
| `--focus-outline-light` | `2px solid rgba(255,255,255,.85)` | The darkest fills (burger, guide header, design chips) |
| `--focus-ring` | `0 0 0 4px var(--focus-ring-color)` | The 4px glow a FIELD adds beneath its outline |

Which outline is a **contrast** decision, not a taste one: gold on a light surface is ~1.5:1 and fails
the 3:1 focus-indicator floor — never use it there. **Every focusable field carries `--focus-ring`**,
including inputs inside modals, where keyboard users most need it. Measured: `e2e/pages.spec.js` →
"every focusable field wears the field ring when focused" reads every field's computed shadow on every
app page, cards open; the drawer's guide search is its one exemption, by name. **One field cannot wear
it on an iPhone, by engine:** WebKit draws no `box-shadow` on a `<select>` that keeps the platform's
face, as the Links generator's time boxes do on touch by decision (`links.css`, "THE CLOSED FACE IS THE
APP'S"); there the OUTLINE is the indicator (`e2e/links.spec.js` → "the generator's boxes and the
Import fields wear the app's field recipe"). The sweep cannot meet it: it runs on a fine pointer.

**Never leave a Tab stop with no indicator.** `outline: none` in a focus rule is legitimate only when a
`box-shadow` ring replaces it, or the element genuinely is not tabbable (`#hourlyRate` carries
`tabindex="-1"`). A `readOnly` input is still reachable — only `disabled` is not — so it needs its ring.
Enforced by `focus-ring-parity.test.mjs`, whose exemptions are a named list so a new suppression has
to be argued for. An `outline` in a BASE rule counts too: the selector needs a focus rule of its own,
or a `BASE_OUTLINE_DECORATIONS` entry saying why it is never a Tab stop.

**Every primary button** (calendar `.controls button`, paycalc `.btn-primary`/`.nav-pill`/`.ty-tab`,
admin `.btn-save`, settings/operations `.btn-action`, shared `#loginSubmit`) shares one press:
`:active { transform: scale(var(--press-scale)) }` with `transform` in its `transition`; `--press-scale`
is `0.97`, `1` under a single `@media (prefers-reduced-motion: reduce)` block — **not** a global
transition-killer, which would break the lightbox's `transitionend`-driven close. Nav-drawer
pills/links keep their opacity-based press — do not scale them.

## Chips — pill radius, and the weight tiers

**A chip never wears `--radius-xl`.** That token (20px) is for large lightbox/panel cards;
`--radius-pill` (999px) is for chips. On a short element the two are **indistinguishable** (CSS scales
radii that exceed the box height), which is why a wrong one goes unnoticed. `chip-radius-parity.test.mjs`
guards it, asserts the overlay family still uses `--radius-xl` so a sweep cannot overreach, and refuses
`--radius-xl` on anything but a listed dialog panel (`DIALOG_PANELS`), whatever a rule is called.

**The three weight tiers are real — do not flatten them.** Chip `font-weight` reads like drift until
you sort it:

| Weight | Tier | Examples |
|--------|------|----------|
| 800 | **identity** — the badge that names the page/period/figure | `.badge-page`, `.period-badge`, `.actual-badge`, `.lightbox-badge` |
| 700 | **standard** — most labelled chips | `.shift-badge`, `.notice-badge`, `.card-year-chip`, `.rate-badge`, `.type-pill-btn` |
| 600 | **quiet status** — a receipt or state, not a label to scan | `.sync-chip`, `.prov-chip`, `.roster-state-badge`, `.conf-badge` |

Unifying the weights would destroy the information. Match the tier when adding a chip.

**Padding is deliberately NOT unified** — mostly load-bearing: a calendar-cell shift badge must be
tiny, a nav pill must clear a 44px touch target. **Squarer chips stay squarer:** `.conf-badge` (3px),
`.source-pill` (8px) and `.list-type-pill` (`--radius`) read as "data tag, not pill"; rounding them
would change meaning, not tidy it.

## Corners — a field and the button under it share one

| Token | Value | Use |
|-------|-------|-----|
| `--radius-button` | 12px | every action button; a TAB is a button (`.ty-tab`, `.ot-tab`, Trains' `.tr-tab`, Team View's `.grade-tab`); a SHOW-MORE is a button (Pay's `.show-more-btn`, Trains' `.tr-more`); the Calendar's controls and Team View's arrows; the leave panel's two links (`.al-lb-link`); Admin's week navigation |
| `--radius-field` | `= --radius-button` | every text field, select and picker trigger that sits on a card |
| `--radius-xs` | 6px | dense inputs that sit in a ROW or a grid — the Links generator, the Operations email table, the navy member bar's picker |
| `--field-border` | `2px solid var(--border-mid)` | the field's edge |

Two corners a few pixels apart in one card, or a field on a fainter hairline than its neighbours, read
as assembled rather than designed — the thing a member types into must not look like a lighter kind
of control. A field that is the second half of another (Settings' `@chilternrailways.co.uk` suffix)
wears the same edge, or the join it exists to hide shows.

**Use the tokens, never a literal**, for a new field or button. Nothing tests this app-wide; where it
drifted it is pinned: the Calendar's two pairs of arrows (`calendar-controls-parity.test.mjs` 9), every
Trains tab (`e2e/trains.spec.js`), and every show-more button on Trains and Pay (`e2e/trains.spec.js`,
`e2e/paycalc.spec.js`). Trains' "Change station" and the grid's "Show every station" stay PILLS by
decision: they act rather than reveal (`trains.css` says why); the Trains test leaves them out by name.

## Overlay sizing — three sizes, one cap, one idiom

| Token | Value | Use |
|-------|-------|-----|
| `--modal-compact` | 300px | short panels with no form — About, coming-soon, App Notices |
| `--modal-standard` | 340px | a form or a list to read — login, one-time notices, Tips |
| `--modal-wide` | 380px | confirm/prompt dialogs, whose message needs the measure |
| `--modal-cap` | 90vw | the single viewport cap |

Always `width: min(var(--modal-*), var(--modal-cap))`. **Pick a size; do not invent a fourth width**
or a second idiom (`max-width: Npx; width: 100%`) — variation in overlay width and cap means nothing.
**Why 90vw:** it leaves the WIDEST overlay (the dialog) unchanged at phone width, where a clipped
message would matter most.

**Out of scope, deliberately:** the nav drawer (`min(260px, 72vw)` — a side panel, not a centred
modal) and the Calendar's page-local overlays in `index.css` — the glass day detail, AL and team info,
and the white Circular/Newsletter viewer (`min(420px, 88vw)`) — which size themselves.

## Spacing — `--space-*` is a card rhythm, NOT a general scale

`shared.css :root` defines `--space-2/3/4/5` (8/12/16/24px). In `shared.css` they name exactly two
things — the card-body padding and the nav-drawer gaps. `overtime.css` has adopted them throughout,
`trains.css` widely, and `links.css` and `admin.css` in a rule or two, so **changing a `--space-*`
value moves those pages too**. The app has no general spacing scale.

**A general spacing migration is a WON'T-DO, and the numbers are why** (measured across the app
stylesheets, padding/margin/gap only): only about a third of the spacing px literals match a token
value, and the most-used value, 10px, has no token — the rest is a long tail (6px, 4px, 14px, 2px,
5px, 20px, 3px, 7px …) that never followed a grid. Both moves are bad:

- **Migrate only exact matches** (what worked for typography) and two-thirds of the literals stay,
  *the most-used value included* — `var(--space-2)` beside a bare `10px` makes the tokens look
  arbitrary, a worse signal than today.
- **Impose a 4/8/12/16/24/32 grid** and pixels change on every page. "It would not noticeably alter
  the design" made the typography migration safe; it does not transfer here.

**Improve spacing per component, with screenshots** — not as a token sweep. A repeated off-scale value
that deserves a name gets its own token (the `--type-badge` precedent), never bent onto `--space-*`.

## Typography scale — shared `--type-*` tokens

One type scale in `shared.css :root`: `--type-micro` 10px · `--type-badge` 11px (badges and dense rows)
· `--type-small` 12px · `--type-label` 13px (dense row text) · `--type-body` 14px · `--type-button` 15px
(primary action buttons) · `--type-medium` 16px · `--type-large` 18px · `--type-xl` 24px.

The card pages (every page in `cardPageFiles`) use **identical sizes for the same conceptual
element**:
- `body` base → `--type-body`
- card-header `h2` → `--type-body` (14px/700, `-0.01em`, `text-wrap: balance`). **15px was measured and
  declined**: it tips paycalc's "🏖️ Holiday Pay Premium (HPP)" onto two lines at 375px, and that title
  may not be shortened (paycalc.md invariant 16).
- card `.hint` and form/eyebrow labels → `--type-small`
- inputs/selects → `--type-medium` (16px also stops iOS focus-zoom — **never go below 16px on a
  focusable field**; see "The 16px focusable-field rule" below)
- primary action buttons (`.btn-action`/`.btn-primary`/`.btn-save`) → `--type-button` (15px) — and Pay's
  "Fill from calendar" (`.fill-roster-btn`), whose longer label, "Replace with calendar values", fits
  one line from 360px and takes two balanced lines at 320px rather than clipping (`e2e/paycalc.spec.js`
  measures both)

**The guides read on the same three steps** (`--type-body`/`--type-label`/`--type-small`, restated in
`guide-shell.css`, screen only): `guide-pages.md` → "Three text sizes".

Genuinely distinct components (nav drawer pills, dense roster-review rows, badges, lightbox text) keep
their own sizes — they are not "the same element rendered differently"; a new card/field/button reuses
these. **`type-scale-parity.test.mjs` fails on any literal px font-size that duplicates a token value.**
"Keep their own sizes" means their own VALUES, not avoiding tokens: once a value has a name, use it.
`--type-badge` was minted *because* 11px was the most-repeated off-scale size — a repeated off-scale
value earns its OWN token, never an existing one. Genuinely off-scale sizes (9px, 20px, 22px …) remain
legal and unguarded.

**The scale deliberately ENDS at `--type-xl` — do not add a display step** (decided after measuring).
Every size above 24px (the desktop month heading, the splash title and the Usage stat figures, the
AL-lightbox balance, the HPP amount, the take-home figure) is a hero figure sized to its own container.
A token promises its sharers change together, and the only repeated value (28px) joins a brand splash
word and a statistic — a false coupling. Only a size repeated across genuinely the same element earns
a token.

## Self-hosted Inter typeface

`fonts/inter-latin.woff2` is served from origin, NOT the Google Fonts CDN. CSP is `font-src 'self'` — a
CDN would mean loosening it, and self-hosting keeps the app offline-first (the SW precaches the file)
with no third-party request. One variable woff2 (latin, wght 100–900) covers every weight.
`@font-face` and the `--font-sans` token in `:root` (the stack) are declared in `shared.css`, and again in
`guide-shell.css` for the guide pages, which do not import it; every page's `body` uses `var(--font-sans)`. Do not re-add a Google Fonts `<link>`.

**And every form control inherits it** — `button, input, select, textarea { font-family: inherit }` in
`shared.css` and `guide-shell.css` — because a control does not inherit the page's font: the browser
gives it its own (Arial on Windows). A class naming a face of its own still wins.

**Inter is the only typeface** (owner decision). A display face (Barlow Semi Condensed, for the hero £
and the month heading) was tried and reverted: the gain was modest, and Inter (a neo-grotesque, the
same family as the real Rail Alphabet) already fits the brand. Do not re-add a second face without a
fresh discussion.

## Brand colours

| Variable | Hex | Use |
|----------|-----|-----|
| `--primary-blue` | `#001e3c` | Dark navy — headers, buttons, day-header cells |
| `--primary-blue-dark` | `#00152a` | Deeper navy — hover states |
| `--accent-gold` | `#f5c800` | Gold — today cell, today button, active highlights |
| `--accent-gold-dark` | `#e6bb00` | Darker gold — hover on today button |

The hex column is the brand reference (and what the `<meta name="theme-color">` tags and
`guide-shell.css` use, since the guides do not import `shared.css`). `shared.css :root` expresses these
in `oklch()`, and the two `-dark` tokens are `color-mix(in oklch, …)` derived from their base. When
editing tokens, edit the `oklch`/`color-mix` values in `shared.css`, not these hex equivalents.

All colour values must be in CSS variables in `:root` — never hardcode hex (enforced by
`css-hex-parity.test.mjs`). **And a page-local token that mirrors an app colour must FORWARD it
(`var(--orange)`), not restate its value** — a restated copy drifts measurably from the token it
claims to mirror. `guide-colour-parity.test.mjs` asserts the forwarding for the Links workspace,
alongside the guides.

## The orange family — a deliberate split

"Orange" is several tokens with distinct duties, not drift — the bright orange cannot carry white text
at WCAG AA (2.15:1), so darker variants exist for those duties:

| Token | L | Duty |
|-------|---|------|
| `--orange` (bright) | 77% | Ambient/identity colour only: **Operations page identity** (nav pill, `#opsBadge`, ops notice badge), the paycalc Saturday pay badge's border, the admin correction pills |
| `--orange-deep` | 54% | Fill carrying **white text**: the admin `.pill-correction.active`, the overwrite badge's "⚠ Removing" state, and Pay's OT day chip (`--chip-ot-bg`) |
| `--orange-text` | 44% | Darkened orange **text on white / `--orange-light`**: `.badge-sat` text, `.pill-correction` idle text, and Pay's "From your calendar" warnings (the base-only badge, a differing row's total and arrow, the `.conf-possible` chips) — the analogue of `--rdw-text`/`--other-text`/`--absence-text` |
| `--early-cell` / `--early-cell-border` | = `--orange-light` / `--orange` | **Early-shift CALENDAR surfaces only** (month-grid cell tint + border, legend swatch, Team-View cell + key dot, print rule) — the original bright amber, possible because the cell has no white text (dark date number). Named tokens so it stays a one-line lever. |
| `--early-badge` | 57% | **☀️ Early BADGE fill only** (`.badge-early`, screen + print; white text). The BRIGHTEST true orange that still clears WCAG AA under white text — L57% at the original hue = **4.64:1** (owner: "closest to original"); above ~L57% white text fails (a brighter badge would need dark text). |

**Rules:** never put white text on `--orange` (use `--orange-deep`/`--early-badge`); never use
`--orange` as text on a light surface (use `--orange-text`). The Early **badge** is the max-brightness
white-text orange — do not lighten it further. The Early cell, the Operations accent and the paycalc
Saturday pay badge share the one bright orange; the badge keeps its own token because white text caps
its lightness well below the cell's.

## Dark (navy) nav drawer + scoped tokens

The whole drawer is one continuous navy surface (`--nav-surface` = `--primary-blue`), matching the page
header and the navy login overlay so the three read as one family. **Drawer-scoped tokens** on
`.nav-panel` (that explicitness is a documented decision), each FORWARDING a global on-navy token
(Three-surface model), so the on-navy depth re-tones from one place:
- `--nav-raised` / `--nav-raised-strong` — white-overlay chips & hover fills
- `--nav-text` / `--nav-text-muted` (0.70) / `--nav-text-faint` (0.55)
- `--nav-border` (0.12)

These are the on-navy equivalents of the global `--text-*` / `--border-light` / `--bg-faint`
neutrals. Alpha values are tuned for WCAG AA on navy (0.70 ≈ 7:1, 0.55 ≈ 5:1). Head and footer are
separated from the scrolling body by hairline `--nav-border` borders, not by a colour change.

**Pills:** every page pill wears its page's solid colour — Calendar gold, Pay green, Operations orange,
Links purple, Trains raspberry, New link teal, Overtime `--ot`, Settings indigo. The **Admin pill** uses
`--nav-raised` with gold text (not a navy fill, which would vanish on navy). Sign-out mixes
`--error-red` 65% with white to clear AA on the dark footer. Do not revert the drawer to a white body.

### A page is one colour and one emoji wherever it is named

Three surfaces name a page: its **header badge**, its **drawer pill**, and the badge in its **About
panel**. They must agree: the drawer is the map, and the badge is where the map says you have arrived.

- **Admin is navy with gold text everywhere.** On the navy header that is the drawer's answer: the
  raised on-navy rung, gold text and a 1.5px gold inset ring (`#adminBadge`, admin.css).
- **The badge glyph is the drawer pill's emoji**, character for character (variation selector
  included) — never a text symbol (£, ⚙, ⏱) in its place.
- **About-badge text in a bright identity colour uses its `-text` token.** Brand gold on its own 15%
  tint is 1.49:1 and bright orange 1.93:1; `--gold-text` and `--orange-text` exist for exactly this.
  Guarded by `e2e/axe.spec.js` → "About lightbox open (<page>)", which scans every signed-in page's
  panel opened from the drawer logo (the Calendar's own About scan never sees a page badge: it is
  hidden outside Team Week View).

**A page's colour is declared ONCE** — three tokens in its own stylesheet's top-level `:root`:
`--page-accent` (the colour), `--page-accent-ink` (text on it) and `--page-accent-text` (the colour as
text on a pale tint of itself). The header badge, the About badge, a picker sheet's current row and
every chosen control read them; no page rule colours a badge. Admin declares gold like the rest; only
its header badge is worn differently (navy, gold ring), by decision. `page-identity-parity.test.mjs`
requires the trio on every card page, refuses a page rule that colours a badge, and checks each page's
colour against its drawer pill — the two hand-written places this identity lives.

**Whatever you have chosen wears the page's colour** (owner, with screenshots). A chosen tab, segment,
chip or toggle fills with `--page-accent`, its text `--page-accent-ink`, and carries nothing else — no
gold underline, no darker edge. A raised control keeps its siblings' `--shadow-1`; colour alone marks
the choice, so one screen never shows two colours for one idea.
- **Navy is for a button that DOES something** (Save, View-as-an-action, Answer). No chosen fill is
  navy, exceptions included — otherwise a selected tab and an action button look alike.
- **A choice with a MEANING keeps its meaning's colour** — admin's shift-type pills and Other flavours,
  leave's swapped-day answer, Operations' enter (green) and skip (grey), Overtime's yes and no. Each is
  named, with its reason, in `page-identity-parity.test.mjs` → `MEANING`.
- **A tick box, a radio and the option row built round one keep their own recipe** — the box's mark
  carries the state (`.gen-obj`, `.bp-mode-opt`/`.hpp-mode-opt`). A RING on a coloured chip is a marker,
  not a fill (Links' armed brush), and stays navy.
- **Small text inside a chosen fill is re-measured on the new colour** — a tint of white that passes on
  navy can fail on a lighter accent. Every ink-on-accent pair is AA: 5.19:1 (New link's teal, the
  lowest) to 10.5:1 (gold).
- **Hover never repaints a chosen control.** Every hover rule on a choosable control either excludes
  the chosen state (`:not([aria-pressed="true"])`, `:not(.active)`, `:not(.is-current)`) or loses to the
  chosen rule on order at equal specificity — check it: `.picker-opt:hover:not(:disabled)` is (0,3,0)
  and beats `.is-current` at (0,2,0). Pinned by `e2e/links.spec.js` → "links compare: the filter hides
  the identical lines" and "links: editing a grid cell uses the app sheet".
- **A control that turns DARK when chosen animates its text with its fill** — the rule "A colour may
  not transition independently of the ground behind it", below. `e2e/axe.spec.js` → `scan()` waits for
  running CSS transitions, so no scan can catch this: it is checked by reading the `transition` line.
- **A chosen style must be one the code can reach.** Before adding a chosen rule, find the line that
  adds the class or attribute — a toggle that swaps its words instead of a class never wears it.

`page-identity-parity.test.mjs` refuses a chosen fill that does not read `--page-accent` unless it is
in `MEANING`, refuses navy on any chosen fill, and fails on a `MEANING` entry whose rule has gone.
**It can only see a choice spelled the way its `CHOSEN` pattern reads** (the aria states and the
listed classes, in the test): a new spelling joins the pattern in the same commit, or its control goes
unseen. The walk skips a
`::before`/`::after`: today's dot on a chosen date is drawn ON the control, and is not its fill.

**The last navy choices took the page's colour** (owner: "do all your suggestions", 3 Nov 2026, with
before-and-after screenshots):
- **The date pickers.** The chosen day is the page's colour with its ink; a chosen WEEK a 20% tint
  across the row with the day a full-colour disc on it (a gradient, so `background-color` reads
  transparent); a hovered week 10%. Admin's range picker: full colour on the two ends, 20% between,
  10%/30% while being drawn. Today's dot takes the ink on a chosen day, or a gold dot vanishes on
  Admin's gold. Their focus rings are `--focus-outline` — gold is ~1.5:1 on the white panel.
- **Trains' chosen timetable column** keeps its light tint (the times must stay readable), with the
  page's raspberry underline on its heading; in `MEANING`.
- **Operations' hand-entry type pills wear ADMIN'S type colours**, type by type (idle: the type's text
  colour on its outline; chosen: its fill under white), so a chosen AL matches Change a Shift.
  `page-identity-parity.test.mjs` test 5 compares the two restated mappings.
- **The swapped-day answer is leave's colour everywhere** (`--al-deep`, Admin's `.al-swap-btn`) — one
  question about annual leave, one colour on both pages.

`e2e/chosen-colour.spec.js` reads each painted colour against the token resolved on the same page,
because a static check cannot see a rule that LOSES — a later rule, a more specific one or a hover.

**Under Windows High Contrast every chosen control is ringed.** A forced-colours theme repaints every
fill as `Canvas`, so a chosen tab, chip or date would paint like its neighbour. ONE rule in shared.css
("A CHOSEN CONTROL IN A FORCED-COLOURS THEME", which carries the reasoning) draws a 2px `Highlight`
outline on anything pressable whose aria state (pressed, selected, checked, current) or chosen class
says so; focused, `6px double Highlight` at −2px — chosen ring inside, focus ring outside
(`e2e/forced-colors.spec.js` → "Pay: a chosen tab that takes keyboard focus shows it"). Do not add a
page-level copy: `native-surface-parity.test.mjs` contract 14 refuses one and refuses a brand token in
any forced-colours block; `e2e/forced-colors.spec.js` proves the painting by removing the outline and
counting what changed. **The guides are the one second home**: they load none of `shared.css`, so
`guide-shell.css` rings their chosen section chip the same way (13 Nov 2026), and contract 14 holds it
to the ring and the focus pair rather than refusing it.

## Desktop layout — content width + reading measure

**Two content-width tokens, single-sourced in `shared.css :root` — never hardcode a page width:**
- `--page-max-width` (1400px) — **calendar only**: its 7-column month grid and the Team Week View
  matrix genuinely use the space.
- `--content-max-width` (1100px) — **every other page**: forms and prose stay a comfortable width and
  the app does not re-lay-out on every desktop hop.

**There are no exceptions**: shrinking a PAGE to fix one wide FIELD moves the burger, brand and badge
inward, so the chrome re-lays-out between pages. **Route every new page's desktop `max-width` through
one of these two tokens**, and if the content does not fill the band, **make the content fill it** — do
not shrink the page back. Two ways, both in the app:

- **Columnise.** Settings uses admin's wide-main + narrow-side pair; admin, operations and paycalc all
  answer a wide band of small cards with columns.
- **Let the ROW absorb the width.** Overtime's seven-day form and admin's Change-a-Shift week (a day, a
  roster badge, a run of pills) both go horizontal at 1024px, the badge in a fixed column so it aligns
  down the week.

**Capping the inner panel is NOT a third way:** a capped, left-aligned form inside the 1100px band puts
a navy void down the right; a narrow column only reads as deliberate when it is the whole page.

**Reading measure:** on desktop, full-width **prose** (card descriptions/`.hint`, disclaimers, notes,
generator intro) is capped with `max-width: ~64–72ch` at the `min-width: 1024px` breakpoint so text does
not run past the ~75ch comfortable ceiling. Forms, tables, grids and data-viz keep the full column;
data-viz bar charts (`.usage-bars`/`.speed-rows`) are capped (~540px) so bars stay comparable.
- **A `ch` is not a character** (measured 14 Nov 2026): it is the width of a zero, about 1.3 average
  characters in Inter, so 64–72ch holds about 80–94 characters a line. Left as written (owner, 14 Nov
  2026): narrowing to a literal ~75 characters (about 56ch) adds roughly a line to every capped
  paragraph on a short laptop window. DECISIONS.md holds what would reopen it.

**Accepted constraint — two-column voids.** admin and operations use an explicit-grid two-column
desktop layout whose row order keeps the SAME source order a good mobile stack, so the shorter column
shows a navy void (operations' left upload stack). Inherent without masonry (not yet
baseline-supported), and **deliberately left as-is** — reordering would regress the mobile stack, and
**static card placement can only MOVE a void, never remove it** (tested on operations at
1024/1280/1440: moving the Weekly Roster card only moved the gap).
- **Admin** carries "Saved Changes" (`#overridesCard`) in the sticky `.col-side` right column, under
  Absence, where it fills the column as it grows; mobile order is unchanged (col-side stacks after
  col-main), and a smaller gap remains bottom-right when the right-column cards are all collapsed.
- **Paycalc** solves it with one shared grid row: paycalc.md → "Layout decisions" (Desktop workspace).
- The composition, voids included, is **locked by the visual-regression baselines**
  (`e2e/visual.spec.js`, `npm run test:visual`).

## Accepted colour overloads — reviewed and closed

These cross-concept colour shares were **reviewed with the owner and accepted** — do not re-flag or
"fix" them: colour is never the sole carrier of meaning (every badge has a label + emoji, WCAG 1.4.1),
the colliding surfaces are rarely co-visible, and new hues would cost more than they gain.

- **paycalc pay badges deliberately borrow the roster's shift colours** — Saturday Early orange,
  Sunday Late blue, Bank Holiday the AL teal; the labels carry the meaning.
- **`--purple` = Spare shift AND the Links page identity** — Links is visible to the members of
  `CONFIG.LINKS_DESIGNERS` only, so the pairing is effectively never co-visible for ordinary staff.
- **`--blue-sky` = Late shift AND assorted admin accents** (source pill, overwrite-active) — labelled,
  low co-visibility.

**Box-shadows are deliberately NOT routed through `--shadow-1/2/3`**: the app stylesheets
(`shadow-parity.test.mjs` reads them from `scripts/app-pages.mjs`) carry **27** hand-rolled `rgba()` shadows with varied values,
and forcing them onto the three presets would visibly restyle depth across the app — a redesign, not
hygiene. Use the `--shadow-*` tokens for NEW shadows; leave existing ones unless intentionally
redesigning that surface. **The figure is measured, not remembered** — `shadow-parity.test.mjs` fails
if this sentence disagrees with the stylesheets or a new one-off is added (a ratchet: migrate one to a
token and bring the number down). It counts hand-rolled recipes only — not shadows on the presets,
focus rings on their own tokens, or `none`. The guide stylesheets are out of scope: they do not load
`shared.css`, so there is no token to route to.

## Density is a POINTER-vs-TOUCH decision, not a width one

Admin's day row is sized for a thumb, which on a desktop puts a tall, largely empty card into the
page's primary control. Desktop gets a one-line label and trimmed padding under
`@media (min-width: 1024px) and (pointer: fine)` (the row drops from 69px to 52px). **Gate density on
`pointer: fine`, not on width alone** — a wide touch screen still needs the 44px-target spacing. And
shortening the tall column shrinks the accepted two-column void, which card *reordering* can only
relocate: height is a lever the void discussion should consider.

## A card has ONE left edge, and a header shares its rows' template

Both rules come from measuring the admin page; a breach of either is what "assembled rather than
designed" looks like.

**One left edge.** Every block on a card shares the content width. A cap that merely stops centring
fixes the left edge and opens a gutter on the right, so that row is the only block that stops short.
**A gutter on both sides reads as deliberate; a gutter on one side reads as unfinished.** Where a
control genuinely should not stretch, cap the CONTROL and let its row span (`.week-date-wrap`, not
`.week-nav`) — and a hint that explains a button is capped with it, or their centres drift apart.

**`auto` in two grids is two different widths.** Separate grids that both declare `auto` size it to
each one's own content, so a header's column drifts out of step with the column it labels.
**A header and the rows it labels must share explicit tracks.** `--wg-base-col` is declared once and
used by every template *and* by the badge's own `min-width`, so the three cannot drift. Pinned by
`e2e/admin.spec.js` → "the week-grid header and its rows share ONE column template, at every width",
which compares the COMPUTED templates — static CSS cannot see this, because the stylesheet says the same
thing in both places.

**Where a value column is right-aligned, give every chip in it one width**, or the left edge is ragged,
plus `font-variant-numeric: tabular-nums` — without it `1` is narrower than `4` and the times jitter.
Size from the widest MEASURED variant: 🦉 has a wider advance than ☀️ or 🌙.

## A grid track is only as narrow as its widest child ALLOWS

**Every grid that lays out page-level content declares `minmax(0, …)` tracks, and its items get
`min-width: 0`.** A track with no declared size — including the implicit single column of a
`display: grid` with no `grid-template-columns` — takes an automatic minimum of **min-content**, so one
child that will not shrink widens the *track*, and every sibling sharing it stretches to match.

**The symptom is the whole screen shaved down its right edge** (the page never scrolls, so it does not
read as overflow): on `admin.html` one wide week-grid cell widened the outer `.container` grid, and
`overflow-x: clip` cut everything off. It survives review because **at the default text size everything
fits**, and **Android's font/display scaling enlarges fonts and leaves the viewport alone**, so no
width query or narrower test viewport reaches the state (a narrower viewport fires media queries the
phone does not: a different layout, not a smaller one).

Found twice — `.selectors` (its comment carries the reasoning) and `.container`. Pinned by the `@layout`
tests in `e2e/pages.spec.js`, which create the scaled-text condition because nothing else can see it.

## Prose is left-aligned once it passes ~2 lines

Centred text is fine for a line or two and works against the reader beyond that — every line starts at
a different x. Overlay body copy (`.notice-body`) is left-aligned; the badge/title/date **masthead stays
centred**, as the About panel does. (`.lightbox-privacy` stays centred: its one use is a one-line note
on the Pay Calculator.) The `new-notice` skill template carries the same rule.

**A link in prose** — an explainer or a Tips panel — is navy at 600 with a 2px underline offset
(`#tipsLightboxContent a, .card-explainer a`, in `shared.css`), as the guides' links are — never the
browser's own blue/purple.

## Screen-reader-only text is one utility, `!important` throughout

`.visually-hidden` is the shared "read out, never seen" rule; `.sr-only` is the same rule under a
second name (new markup takes `.visually-hidden`). Every declaration is `!important`, because an
element rule outranks a class: Admin's `input[type="text"] { width: 100% … }` once gave the sign-in
card's hidden username a full-width box, and the sign-in sheet scrolled sideways. Do not drop the
`!important`s; the reasoning is beside it in `shared.css`.

## The 16px focusable-field rule is MEASURED, not assumed

iOS force-zooms the page when you focus a field smaller than 16px. **Reading the CSS cannot confirm
the rule holds**, because both ways it fails are cascade outcomes: a `@media (pointer: coarse)`
override declared BEFORE its base rule at equal specificity loses to it, and a field with no override
simply inherits a small size.

So `e2e/pages.spec.js` → "no focusable field falls below 16px on a touch device" scans every
`input`/`select`/`textarea` on every app page (from `scripts/app-pages.mjs`) on **mobile-chrome** (a real
coarse pointer), every collapsible forced open, and asserts the COMPUTED size. Checkboxes, radios and
file inputs are excluded — none opens a keyboard.

**When you scope a size to a pointer — `coarse` OR `fine` — put the override AFTER the base rule** (or
raise its specificity) and let a test confirm it. The same trap catches density rules placed beside
their block by subject; and moving a block can leave its closing brace behind and swallow the rest of
the stylesheet — print rules included — into a media query. **Measure the COMPUTED value**: both were
found by tests, neither by reading.

## A page may only use classes its own stylesheets define

A class defined only in another page's stylesheet renders unstyled on this page — browser-default size
and colour, no line-height — and nothing throws, warns or fails a behavioural test. A class used by two
pages belongs in `shared.css` (as `.card-explainer` does). `page-css-parity.test.mjs` fails on exactly
that cross-page borrowing, and is deliberately **not** a general "every class exists somewhere" check
(its header says why).

**A button under a field matches the field** — full width, as the login overlay and the mobile layout
already do. A button capped narrower than the field above it leaves every card ending with a gutter.

## The picker chevrons are tokens

`--caret-chevron` in `shared.css :root` is the down-chevron every control that opens a picker wears —
`.fieldpick` triggers, Team View's and Admin's week labels, the Calendar's month-jump selects, the member
bars' pickers — and `--caret-chevron-small` is its 12×7, lighter-stroked twin for the plain selects
(Admin, Operations, the sign-in card). Each is a `url("data:image/svg+xml;…")`, and **the navy lives
inside the SVG's own `stroke`, where no token can reach it** — which is why each is declared once.
Never write the SVG inline at a call site; a copy is where one site diverges unnoticed.

A consumer sizes it in `em` so it tracks its label under OS text scaling, and keeps it low-contrast
where the label must still read as the label rather than a third control (Admin's and Team View's week
labels, between two arrow buttons, say so in their own comments). Two identical controls never wear
different marks — what opens from both is a picker.

## Checkboxes and radios — app-drawn, one recipe

`accent-color` only tints the OS's checkbox and radio (box, tick, press and animation stay the
platform's, and Android's and iOS's differ), so the app draws them. The recipe and the reason for each
rule below live in `shared.css` under "NATIVE CONTROLS THE APP DRAWS". A page must keep:

- **Never set `width`, `height` or `accent-color` on a checkbox/radio** — the size is the recipe's,
  20px, 22px under a coarse pointer (the ROW is the touch target). Enforced by
  `native-surface-parity.test.mjs`.
- **Recolour through `--check-fill` / `--check-border`** (`.other-rdw-label input { --check-fill:
  var(--other) }`); restating the box to change its colour forks the recipe.
- **The ring goes on the box — unless the ROW is what is chosen**: option rows (`.gen-obj`,
  `.bp-mode-opt`, `.hpp-mode-opt`) ring the row via `:has(input:focus-visible)` and suppress the box's
  own, or a keyboard user sees two rings 10px apart (named in `focus-ring-parity.test.mjs`'s
  `NO_INDICATOR_EXEMPT`).
- **The tick is a `clip-path`, not a glyph** (a glyph renders in whatever font the platform substitutes).
- **`hidden` still hides**: `display: inline-grid` out-specifies the UA `[hidden]` rule, so
  `input[type="checkbox"][hidden] { display: none }` is restated beside it.
- **It prints**: the checked fill is a background, so it carries `print-color-adjust: exact`.
- **It states itself in a FORCED-COLOURS theme**: the fill and tick are backgrounds, forced to
  `Canvas`, so the `@media (forced-colors: active)` block restates them in system colours
  (`Highlight`/`HighlightText`, `GrayText` for disabled, `opacity: 1` because opacity is NOT forced).
  **A `var(--…)` in that block defeats it.** Pinned by `native-surface-parity.test.mjs` contract 13
  (shape) and `e2e/forced-colors.spec.js` (painting).

The same principle covers three more surfaces: no `title` attributes (DECISIONS.md → Tooltips); no OS
resize grip on the textareas (`resize: none; field-sizing: content` — the box grows to a cap; Safari,
with no `field-sizing` yet, keeps its rows and scrolls); and every scrollbar is the app's thin trackless
bar (`scrollbar-width`/`scrollbar-color` on `*`, plus the `::-webkit-scrollbar` pair for older WebKit,
which an engine honouring the standard pair ignores).

## The six the first audit missed

Found by going through **every control type the markup actually ships**. Four are drawn only by engines
the deploy gate does not render in, so a static guard, not a screenshot, holds them. Each recipe's
reasoning is beside it in `shared.css`:

- **Edge's `::-ms-reveal` / `::-ms-clear`, Safari's `::-webkit-credentials-auto-fill-button`** —
  suppressed: all three land in the corner `.login-pw-toggle` occupies (the field reserves 62px), and
  the station PC is Windows; Settings offers a third route in its "Show passwords" tick.
  **`::-webkit-strong-password-auto-fill-button` is deliberately NOT suppressed** — a keychain
  password is a platform feature the app has no alternative to.
- **Autofill's repaint** — an `!important` inset box-shadow covers Chrome's and Safari's yellow on the
  sign-in overlay and the Settings account card (the UA background is itself `!important`). **The
  `:focus-visible` half must restate `--focus-ring`**, or the field loses its only focus indicator.
- **`::selection`** — one rule, `color-mix(in srgb, var(--accent-gold) 35%, transparent)`, that **sets
  no `color`**, so one tint serves both surface families: 10.2:1 for dark text on a card, 7.3:1 for
  white on the navy drawer (measured).
- **`::placeholder`** — `--text-light` with `opacity: 1` (Firefox adds its own opacity). 5.4:1 on
  `--field-bg`, 6.0:1 on the focused white.
- **`caret-color`** — `--primary-blue` on `input, textarea, select`, **bare, where every skin rule in
  `shared.css` carries the two `:not()`s**: `input:not([type="checkbox"]):not([type="radio"])` is
  (0,2,1), which BEATS `.nav-gs-input` at (0,1,0) and would paint navy over the drawer's gold caret.
- **Dictionary underlines** — `spellcheck="false"` on `<body>`, once per served page: no field takes
  prose (hours, minutes, rates, money, times, a tax code, names, an address), and it inherits to
  fields built in JS. The two legacy redirect stubs have no fields and are
  exempt by name.

**The guides load none of the app's stylesheets**, so `guide-shell.css` restates the scrollbar (own
`--scroll-thumb` token) and `::selection`, `::placeholder` and `caret-color` (own `--placeholder`
token): a rule added only to `shared.css` reaches every app page and none of the guides.

## `opacity` on a group is a contrast bug waiting to be found

Recessing a group of rows or values with `opacity` — a "was" value, the not-chosen half of a conflict,
a row set aside, every row of a refused read — failed WCAG AA every time it was measured on the
Operations roster review (1.76–4.11:1 against a floor of 4.5).

**It is structural, not a colour mistake:** a fade multiplies contrast, and the tightest badge, Early
at **4.65:1**, clears AA by 0.15, so no opacity quietens it and keeps it legible (`operations.css` → the
dims note).

**The rule.** If a reader still has to READ it, do not fade it. Say "secondary", "not chosen" or "set
aside" with something that costs no contrast:

| Meaning | Say it with |
|---|---|
| secondary / earlier value | a smaller type step, and the arrow or label already beside it |
| not the chosen option | `text-decoration: line-through` |
| set aside, still re-selectable | the **sunken** surface (three-surface model above) + the control's own off state |
| not actionable at all | remove the affordance — hide the action tag, not the content |

**The one exemption, and it is narrow.** WCAG 1.4.3 exempts an *inactive* user-interface component, so
a control whose clicks are genuinely refused may keep a dim (`.roster-blocked .roster-tick`). A row the
reader can re-select is not inactive, and gets no exemption.

**A colour may not transition independently of the ground behind it.** Easing `color` but not
`background` leaves the text mid-grey (or new white words on the old pale ground) for the length of the
transition — Chromium finished the ease before the a11y scan sampled it; WebKit in CI did not. Put
both in the same `transition`, or neither.

**A replacement cue must REACH every element it is meant to mark.** `text-decoration` does not inherit
into an atomic inline box, so `line-through` on a row never reaches a `display: inline-flex`
`.shift-badge` inside it. And a cue declared beside its state can lose to a later rule at equal
specificity (`.roster-change-conflict`/`.roster-change-unreadable`). **Assert the cue against every
element type the surface can produce**, not the one your fixture renders; `e2e/operations.spec.js` does
that for both.

**And do not assume a scanner sees a fade:** axe reports *nothing* for rows at `opacity: .35`, so
`e2e/axe.spec.js` checks the mechanism directly (`faded()`), exempting only a natively `disabled`
control and the one refused-read tick (`docs/A11Y_BASELINE.md`).

## The sub-page header is a flex row

**`.app-header` — the sub-page header in `shared.css` — is a FLEX row**, not a grid: the burger, then
`.app-header-brand` (`flex: 1`, content centred) holding the logo and title, then the page badge. The
brand takes all the space between burger and badge, so the two never overlap whatever the badge's
width, and the title ellipses rather than wraps. But centred in that leftover space the brand sat
16–43px left of the page centre, differently on each page, **so from 1024px the brand is centred on
the HEADER** (absolute, `left: 50%`), as the Calendar's title is, and the badge holds the right edge
(laptop polish, 13 Nov 2026); every page's header shares one band, and the name keeps 45px or more from ☰ and the badge even at double text
size. **Below 1024px keep the flex rule**: a header can be far narrower there, and centred, 1.6× text
ran the name into the badge. Pinned by `e2e/pages.spec.js` → "from 1024px the app's name sits at the
window's centre" and its below-1024 sibling.

The Calendar's full-bleed `.header` (`index.css`) is separate, but **from 768px up it draws the same
header** (height, logo, gap, title, top edge, burger position); only the width differs
(`--page-max-width`). Below 768px, and on a phone held on its side, the Calendar keeps its own compact
header — asked and **kept as it is** (owner, 8 Nov 2026), so do not re-propose matching it there.
Pinned by `e2e/calendar.spec.js` → "from 768px the Calendar's header is every other page's header",
which compares the computed metrics with Settings' at 768, 800 and 1366px.
