---
paths:
  - "guide*.*"
  - "*-guide.*"
  - "fip.*"
---

# Guide pages — full reference

> **The `paths:` list above uses GLOBS, and must stay that way.** An enumerated list of filenames
> falls behind (it once missed `guide-back.js`); three globs cover every guide page, stylesheet and
> script, including any added later.

## Shared rules (all five guide pages)

> **Calm enough to use. Clear enough to learn. Detailed when needed.** The bar for a guide page
> (owner, 3 Sep 2026). A page that is glanceable and teaches nothing misses it, and so does one that
> explains everything at once.

- **Write for the colleague who has never heard the term** (owner, 3 Sep 2026; the app-wide rule is
  CLAUDE.md → "Plain English that TEACHES"). Many colleagues do not know what a FIP coupon is, or how to
  use a FIP card, and the guide's first job is to let them: plain language, the term expanded on first
  sight, and the real-world anchor stated (what it looks like, where you get it, what the barrier or
  the payslip shows). **And short** (owner, 12 Nov 2026: "Keep the clarity and for dummies nature of
  the guides. Plain English"): one idea per sentence, and a new fact goes in by tightening the words
  around it, not by adding a paragraph. If a fact makes the page harder for that reader to use, leave
  it out or move it down. On the Staff & Admin Guide that is also a print rule: it prints one sheet per
  guide with a few pixels to spare (`staff-guide.css`, the print block).
- **Teach the mental model before the exceptions, once.** Answer near the top, in ordinary language
  beside the official term, what the thing is, when you would use it, what you physically hold or show,
  what it gives you, what it does not, and what you do next at Marylebone — so the cards stay
  glanceable rather than repeating the concept thirty times. **`fip-guide.html` is the worked
  example**: a *"What do I need?"* table separates free travel (coupons) from discounted fares (the
  Card), and a *"What you get"* pair explains each. Judge a new guide against that opening. **The facts
  stay governed by `GUIDE_SOURCES.md` and its evidence classes** — this rule is about STRUCTURE, and no
  definition may be improved into the guide without its source.
- **Searchability is not discoverability** (CLAUDE.md, same heading). A guide still owes its reader an
  orientation, conceptual headings and "you may also need…" signposting; never close a discovery gap by
  pointing at the search box.
- **An example of a search is not an answer to it.** A search tip naming phrases to try puts them into
  the cross-guide index as body text, so the tip became the top hit for the phrase it suggested. Mark
  any such element `data-gs-example`; `scripts/guide-index-lib.mjs` drops it before extracting (contract
  6 in `guide-index-parity.test.mjs`). The staleness contract cannot see this: the index is TRUE of
  the page.
- **A guide that lists something the app keeps in one place is held to it.**
  `guide-app-parity.test.mjs` reads the app's own lists (the menu in `nav-destinations.js`, the Admin
  type buttons in `admin-shift-types.js`) and fails on the guide line that disagrees, in both directions.
  (Its staff PIN check went with the PIN, 23 Nov 2026.) A new
  list a guide restates gets a check there, not a reminder.
- **Draw an app control as the app draws it.** A reader matches the page to the screen by sight, so
  a depicted control wears the real one's colours AND shape: the Staff Guide's five Calendar buttons
  are rounded rectangles at the real corner's proportion (not pills, a shift badge's shape), and the
  Pay Calculator Guide's rates are the Pay page's own rate badges, each in its row's colours.
  `e2e/guides.spec.js` reads both off the real pages and compares them.
- Guide pages do **not** import the app's `shared.css` (nav panel / lightbox / login chrome they don't
  use). All five share `guide-shell.css`; the two **document-style** guides (`staff-guide.html`,
  `paycalc-guide.html`) additionally load `guide-doc.css` (the shared two-column print layout + 760px
  content wrapper) between the shell and their own CSS. Each page then has its own external CSS file
  (`staff-guide.css`, `paycalc-guide.css`, `railcard-guide.css`, `fip-guide.css`, `rangers-guide.css`).
  Do not add a `shared.css` import to any guide.
- **The two OLD guide URLs are still served, as redirect stubs**: `guide.html` → `staff-guide.html`,
  `fip.html` → `fip-guide.html`. `firebase.json` 301s both on the canonical origin only; the GitHub
  Pages mirror (where most staff open the app) serves no redirects, so the redirect is also in the
  HTML. No content, no stylesheet, ONE script — the shared `legacy-redirect.js` (owner, 10 Nov 2026),
  which keeps a bookmark's `#country` and `?from=`, with a meta refresh as the no-script fallback. They
  are NOT guides: `REDIRECT_PAGES` in `scripts/app-pages.mjs`, with their own contract
  (`LEGACY_REDIRECTS`, `page-contract-parity.test.mjs`). **A future guide rename needs the same pair** —
  the Firebase redirect and the stub — or it breaks old links for the larger half of the staff.
- Guide pages use **no inline `<script>` or `onclick` handlers** — Firebase Hosting CSP
  (`script-src 'self'`) blocks them. All guide JS is in external files, and every guide loads the same
  three: `guide-back.js`, `guide-print.js` and the chip bar's `guide-chips.js`. The FIP guide alone
  loads a fourth, `fip-guide.js`, AFTER `guide-chips.js`: its country finder, the opening of a country's
  `<details>` on a jump or deep link, and its print preparation. **Every guide has a chip bar and
  `guide-chips.js` alone drives it**: nothing else measures a guide's sticky stack, and a second copy
  would bind every chip twice. `fip-guide.js` carried one until Nov 2026, held to the shared one by four
  exact strings; it carries none now, and `guide-chips.js` is wrapped in a function so the two scripts
  share no globals. `page-contract-parity.test.mjs` requires all of it: the three tags on every guide,
  the FIP guide's order, no chip-bar calls in `fip-guide.js`, no top-level code in `guide-chips.js`,
  and a `#savePdfBtn.btn-print`. **Only `guide-print.js` prints**: a second `window.print()` handler
  would open two sheets or bypass the iOS 27 guard.
- **Back buttons** link to `./` (not `./admin.html`) — guides are accessed from the nav panel;
  `paycalc-guide.html`'s links to `./paycalc.html`. **`guide-back.js` retargets that arrow at runtime**
  when the guide was opened from the nav drawer: `nav-panel.js` appends `?from=<page>` and `←` points
  back at that page, because guide links navigate in the SAME tab. `from` is allowlisted against the
  app's own pages; an absent or unknown value leaves the authored href alone. The footer
  `.guide-back-link` follows it too. **Where the page before is the one named** (same origin and path,
  by `document.referrer`), both call `history.back()` instead of linking, so Admin → drawer → guide → ←
  leaves no second Admin over the guide for the phone's Back to land on; the href stays the fallback
  (no referrer, no history, or a move within the guide since it loaded). `guide-back.js` has the why.

## Unified guide shell

All five guide pages share one chrome for consistent behaviour on iOS, Android, desktop and print.
It lives in **`guide-shell.css`** (linked by every guide, before each page's CSS) — edit it there once,
do not re-inline it. `guide-shell.css` defines the whole shared guide palette in its own `:root` —
the brand tokens (`--navy`, `--navy-dark`, `--navy-mid`, `--gold`), the status fills and borders, the
greys, `--white` and `--shadow-card` — with the Railcard guide's values (owner, 22 Nov 2026), plus the
source banner (`.source-banner`, `.draft-title`). Guide pages do not redefine them; the two document
guides keep their own four greys on purpose, and `--bg` means the page background on every guide. Each
"ONE …" rule below has its reasoning in the matching `guide-shell.css` block.

**In `guide-shell.css` (shared — change once):**
- **Typeface:** the app's self-hosted Inter (`@font-face` + `--font-sans`; css-tokens.md → "Self-hosted
  Inter typeface"). Every guide body uses `var(--font-sans)` (railcard/fip/rangers in their own CSS;
  staff-guide/paycalc-guide via `guide-doc.css`), and every form control inherits it
  (`button, input, select, textarea { font-family: inherit }`), because a control does not take the
  page's font by itself.
- **Header:** full-bleed sticky navy `.page-header` (`top: 0`): `←` `.btn-back` (left) · title `<h1>` +
  `.sub` · `⤓ PDF` `.btn-pdf` (right, `margin-left:auto`). Top padding
  `max(14px, env(safe-area-inset-top))` for the iOS notch. **3px gold bottom rule** — the navy-and-gold
  brand echo; it prints too (the header doubles as the railcard/fip/rangers print banner).
- **Chip bar and header alignment:** from 800px the chip bar's inline padding — and the header's, whose
  navy band stays full-bleed — is the 760px content column's own text edge, so the first chip and the
  `←` start, and `⤓ PDF` ends, where the text does. It restates the 760/16 pair the three page CSS
  files and `guide-doc.css` declare — change them together, with the railcard and rangers source
  banners' 728px (760 less its two 16px sides).
- **The `←` has one hover, gold, on every guide** (fine pointers only), at a specificity no page's own
  `a:hover` reaches.
- **Footer back link:** `.guide-back-link` is ONE recipe for railcard, rangers and FIP — centred, 44px
  tall, authored "← Back to calendar" to `./` and retargeted by `guide-back.js` with the header's `←`
  (opened from Admin it reads "← Back to Admin"; owner, Nov 2026), the last element of `<main>`,
  hidden in print — with ONE hover
  (navy words, gold underline) at (0,2,0). Do not restyle it per page; `e2e/guides.spec.js` fails if the
  three diverge.
- **Chips:** desktop hover feedback on the shared `.chip` (border-darken + soft shadow, colour-fade
  only — no transform), so a mouse gets an affordance as well as `:active`.
- **The chosen chip is GOLD with navy words, on all five guides** (owner, 12 Nov 2026 — picked from
  three, with screenshots: navy, each guide in its app page's colour, or gold on every guide). Navy is
  the app's colour for a button that DOES something, and three of the five guides belong to no page.
  A press is gold too, so a tap shows one colour. Giving one guide its app page's colour is a fresh
  decision, not a tidy-up. **Under Windows High Contrast it is RINGED** (13 Nov 2026; 2px `Highlight`,
  `6px double` when focused). Pinned by `e2e/guides.spec.js` → "the chosen section chip is gold with
  navy words", `native-surface-parity.test.mjs` contract 14 and `e2e/forced-colors.spec.js` → "a guide:
  the chosen section chip".
- **One section heading on all five guides** (the owner's "must be consistent with the rest of the
  app"): ONE rule on `h2` — navy words, a gold dash before, a hairline after that keeps 24px when a
  heading wraps — and a page sets only its margins. The element is the selector because every guide
  `<h2>` is a section heading (`scripts/guide-index-lib.mjs` refuses one with no id). Dash and hairline
  are BORDERS, so paper keeps them. `e2e/guides.spec.js` → "every guide draws its section headings the
  same way" also measures the hairline against its ground (an invisible one passed every other check);
  `--rule` is its own token for that reason — never point it at a page ground.
- **One link on all five guides:** the app's prose link — navy at 600, an underline tinted from the
  link's own colour, gold under a mouse. Never amber under a mouse (on the Railcard guide amber means a
  morning rule).
- **Three text sizes, on screen only** (owner, 16 Nov 2026 — 14px picked over 13px): the app's own steps
  under its own names in guide-shell.css's `:root` — `--type-body` 14px for reading (paragraphs, lists,
  steps), `--type-label` 13px for anything dense (boxes and callouts, card rows, tables, keys),
  `--type-small` 12px for sources, sub-lines and footers. Reading text is in the text colour, not the
  grey. **Each page applies them in ONE `@media screen` block at the end of its own CSS**, so a printed
  sheet keeps the sizes it was composed at (the Staff Guide still prints on one sheet); a new size rule
  goes in that block, never in the base rule above the print block. Labels, pills and tags, card names
  and figures, the app's drawn badges (`.sb`, `.pay-rate`) and the controls keep their own sizes —
  `KEEPS_ITS_OWN_SIZE` in `e2e/guides.spec.js`; "every word on … is in one of the app's three sizes on
  screen" fails on anything else, and "every printed sheet keeps its own" reads a sample on paper.
  **Bigger words raise a block's narrowest width**: so the Staff Guide's Shift Types middle column may
  break a long word (`overflow-wrap: anywhere`), and the tips stack as the badge key does, under ONE
  rule after both grids' own (`staff-guide.css` has the measurements). Pinned by "enlarged text does not
  widen the column past a phone", at 375, 360 and 320px. Measure a size change at 1.5× on 320–412px.
  **And nothing runs past a phone's edge on any guide** — no box and no word, because a word wider than
  its box overflows it without moving the box. A status badge (the Rangers guide's "✓ National Rail
  checked · Aug 2026") wraps its own words only when it alone is wider than the column: a 1em corner,
  so two lines make a rounded rectangle rather than a bubble; `&nbsp;` keeping a month with its year and
  the "·" with the word before it; and the key's badges never shrinking (their rows are flex rows).
  FIP's "Amsterdam/Rotterdam/Antwerp" takes ONE `<wbr>`, after "Rotterdam/". **A `<wbr>` is not a last
  resort**: line-wrapping uses it wherever it helps, and five of them re-broke the Eurostar sentence at
  the default size on a 320px phone. Pinned by "<guide>: enlarged text runs nothing past a phone's
  edge" (all five, at 375, 360 and 320px under 1.5× and 320px under 1.3×) and "rangers: a status badge
  keeps to one line at the ordinary size, and wraps cleanly under large text".
- **One sub-heading:** on screen an `<h3>` is the app's card title (body size, 700, navy, `-0.01em`); its
  paper size stays in the page's print block. The Railcard's and Rangers' card names are headings by
  ARIA, not `<h3>`s, so it does not reach them. Pinned by "a sub-heading on screen is the app's card
  title", which builds the app's card title on the Pay page and compares.
- **One top gap:** `--guide-top` (20px) from the bottom of the header and chips to a guide's first
  line, on all five, at every width. Pinned by "every guide starts its first line the same space below
  the header and chips", at 390 and 1280px.
- **The chip bar's hold** (`guide-chips.js` header has the argument, on all five guides). On the
  document guides' two columns (from 641px) no scroll position says which section is being read, so a
  chip is lit only by a jump or a link to it, until the reader moves ON (the SECTION moving, so a
  reflow lets go too); on one column the bar follows the reader. **A link holds its chip the way a tap
  does**: a `#fragment` link lights the chip of the section it lands in (a card's or sub-heading's
  section too) from the first paint, through the landing, until the reader moves on. A reload,
  Back/Forward or a hash changed in place holds nothing. A section headed inside a navy banner (the
  Staff Guide's Admin Guide) starts at its banner, for the bar as for the landing. **A tap's jump is
  judged when it ENDS** — at `scrollend` where the browser has it; the 1.5 s timer judges only where it
  does not (run everywhere, it judged a slow jump in flight and let the chip go, Nov 2026).
  `e2e/guides.spec.js` proves it in a browser: "a jump is judged when it ends…" pauses the page's
  clock mid-jump on the Pay Calculator and FIP guides, and the FIP test waits out a slow jump. A test
  that taps a chip waits for `scrollend` (`jumpTo`), never a set time.
- **A bar too long for its window WRAPS** from 641px in a window at least 600px tall, and from 1024px at
  any height — a desktop bar hides its scrollbar, so a chip past the edge would never be found, and a
  window snapped to half a laptop screen is 683–768px wide (`guide-shell.css` has the figures). The page
  scripts watch the bar's own size as well as the header's: a wrapping bar gains or loses a row with no
  change to the header. Chip labels are short forms of their headings, "Holiday Pay Premium" spelt out.
  guide-doc.css draws the bar on `--page-bg`, the page's own ground.
- **With no script the chip bar is not sticky** (`@media (scripting: none)`): its `top` is the script's
  measurement, no single fallback fits every header, and the chips do nothing without script either.
- **Print:** `.page-header` goes `position: static` with `print-color-adjust: exact`; `.btn-back`,
  `.btn-pdf`, `.chip-bar`, `.guide-back-link` and `.print-unavailable` are hidden. railcard/fip/rangers
  print the sticky header as their title banner; staff-guide/paycalc-guide mark it `.no-print` and print
  their own in-document `.guide-header` banner (its `print-color-adjust: exact` stays inline).

**Still per-page in each page's own CSS file (keep aligned by eye):**
- **Background:** flat, edge-to-edge — `#f4f5f8` on the FIP, Railcard and Rangers guides, `#eef1f6`
  (`--page-bg`, `guide-doc.css`) on the Staff and Pay Calculator guides. No white "page" card. Apart on
  purpose: the Railcard's Marylebone panel and the Rangers guide's quick answer are tinted exactly
  `#eef1f6`, so one ground for all five would erase them, and the two shades are a hair apart.
- **Card corner:** 12px on every guide's cards; a box nested in a card keeps a smaller one.
- **The Pay Calculator Guide's rate cards are one column on screen** and two on paper: two to a row
  left each card about 120px of text, on a phone and in the desktop's half-page column alike (a
  description ran to nine lines); A4 has the width for two.
- **Content width:** `max-width: 760px`, centred — in the shared **`guide-doc.css`** for the two
  document guides (with the two-column `.cols` print grid), in each page's own CSS for railcard, FIP and
  rangers (single column).
- **Reading measure:** from 1024px (screen only) the railcard, rangers and FIP guides hold a paragraph
  or note to 64ch — the low end of the app's 64–72ch (`css-tokens.md` → "Reading measure"); 68ch
  measured 102 characters a line on CI's render, over the e2e's 100. Boxes, tables, cards and rows
  keep the column. The document guides need none: their two-column `.cols` already halves the line.
- **Safe-area:** side insets `max(16px, env(safe-area-inset-*))` on the content wrapper; bottom
  `max(40px, env(safe-area-inset-bottom))`.
- **PDF button markup:** `<button id="savePdfBtn" class="btn-print btn-pdf" type="button"
  aria-label="PDF — save or print this guide">⤓ PDF</button>`. Wired by `guide-print.js`
  (`.btn-print`) on all five guides. No page script prints from it, but `fip-guide.js` adds a
  capture-phase click listener on the same button that prepares the page (expands every country)
  before `guide-print.js` prints. **A search prints its cards and the key rules, not the book**
  (owner, 18 Nov 2026): with a filter showing cards, `body[data-print-filtered]` keeps only the
  matching countries and the sections marked `.fip-filter-print` (the countries heading, What to
  carry, Important to know). The PDF button's label and the count line say so.

## Source governance — GUIDE_SOURCES.md

High-risk guide claims (anything that could mis-sell/refuse a ticket, invalidate a journey, or
mis-state pay) are registered in **`GUIDE_SOURCES.md`** with their authoritative source, review
dates, and a **National / Local / Tip / Fact** classification. `guide-sources.test.mjs` enforces
that register structurally (part of `npm run test:hygiene`) — every row must keep its source, its
`Reviewed`/`Next` dates (Next strictly after Reviewed), and a valid class.

- **Before changing a high-risk claim**, update its register row (Source + `Reviewed`), then the guide.
- **Block ↔ source linkage:** each high-risk Railcard, Rangers or FIP block carries a
  `data-guide-source="<register-id>"` attribute (several space-separated ids allowed).
  `guide-sources.test.mjs` enforces both directions — an attribute on ANY guide (it reads every
  `GUIDE_PAGES` entry) pointing at a missing row, or at another guide's, fails, and a Railcard, Rangers
  or FIP row with no anchoring block fails — so adding a row means anchoring it in the HTML,
  and removing a block means removing or re-homing its row. The attribute is inert (no CSS/JS reads
  it), so it needs no version bump.
- The **National vs Local** flag is the anti-drift control: it stops a Marylebone shortcut being
  restated as a universal national rule (see the three-layer format below).
- The test is a **structural** guard, NOT a date tripwire (a today-driven failure would break unrelated
  commits). Review cadence is manual, driven by the `Next` column — re-check a section when its month
  arrives; full pass at least yearly (railcards each spring; tax before 6 April).

## What adding a guide page touches

Every place below knows the guide list, and most fail loudly — the good case. Listed so the work is
estimated honestly; each row was checked against the code. The last column says which: **enforced**
(a test fails until it is done) or **remembered** (nothing fails; this table is the reminder).

| # | File | What | |
|---|---|---|---|
| 0 | `scripts/app-pages.mjs` | a `GUIDE_PAGES` entry — `page-contract-parity.test.mjs` fails on an undeclared page — with its `documentStyle` and `column`, each checked against the page; then `npm run generate:guide-index` (`guide-index-parity.test.mjs` checks it). The browser suites (`e2e/guides.spec.js`, `print.spec.js`, `pages.spec.js`) and `guide-sources.test.mjs` loop over this list, so the new guide joins them with no edit there | enforced |
| 1 | `nav-destinations.js` | `NAV_GUIDES` entry — icon, label, url, **`openId`** | enforced (#3) |
| 2 | `firestore.rules` | analytics counter id, in **two** places (the `pvCountIds()` list and the per-id int check) | enforced (#3) |
| 3 | `firestore-contract-parity.test.mjs` | asserts `NAV_GUIDES` openIds match the rules list, both ways | — |
| 4 | `service-worker.js` | precache: `.html` + `.css` (+ `.js` if any) | enforced (#5) |
| 5 | `sw-asset-check.test.mjs` | asset-list parity, and the `noindex` meta contract | — |
| 6 | `csp-meta-parity.test.mjs` | the page's `<meta http-equiv="Content-Security-Policy">` must mirror the header | enforced |
| 7 | the page itself | `noindex` meta + `color-scheme: only light` meta; a chip bar; the three script tags — `guide-back.js`, `guide-print.js` (a module) and `guide-chips.js` — once each; and `#savePdfBtn.btn-print` | enforced (#5, `page-contract-parity.test.mjs`) |
| 8 | `e2e/axe.spec.js` | accessibility scan (blocking gate) | enforced (reads `GUIDE_PAGES`) |
| 9 | `e2e/csp.spec.js` | deployed-CSP proof | enforced (reads `GUIDE_PAGES`) |
| 10 | `e2e/calendar.spec.js` | each guide records its **own** open id, driven through the real drawer | remembered |
| 11 | `GUIDE_SOURCES.md` | a register row per high-risk claim | remembered |
| 12 | `guide-sources.test.mjs` | the two-way `data-guide-source` contract. It reads every guide from `GUIDE_PAGES`, so a block on the new page citing a missing row fails at once; for its OWN rows to need anchoring, add its Guide value to `ANCHORED` and the register's `GUIDES` | enforced; `ANCHORED` remembered |
| 13 | `scripts/guide-index-lib.mjs` | if the guide has CARDS that should be search results of their own, a `CARD_RULES` entry (a tag, an id pattern and a class, in any attribute order), and a line in `guide-index-parity.test.mjs` contract 10 (or 9) so every card is checked to be a unit | remembered |
| 14 | `guide-shell.css` | nothing to change, but confirm nothing new is needed | remembered |
| 15 | `guide-back.js` | already generic: the `←` and, on a card guide, the footer `.guide-back-link` both follow `?from=` | — |
| 16 | `e2e/visual.spec.js` + baselines | every guide is baselined — the document-style pair at desktop 900, the other three at mobile 390; pick the width that shows the new page's densest state | enforced (`page-contract-parity.test.mjs`) |
| 17 | `.claude/rules/guide-pages.md` | its `paths:` globs **and** its per-guide section (this file) | remembered |
| 18 | `docs/FILE_INDEX.md` + `docs/AI_MAP.md` | the file catalogue, same-commit rule | enforced for a new `.js` module (pre-commit, `doc-parity.test.mjs`); the page and stylesheet lines remembered |

Note #10 and #12 specifically: the analytics open-id mapping has already produced a real defect class
(a substring match filed every Pay Calculator Guide open under the Staff Guide), and the register's
two-way contract is what stops a high-risk claim losing its source.

---

## Railcard guide

`railcard-guide.html` is an at-work quick reference for staff at the **gateline** and **ticket
office**. Not a customer-facing page — judge every decision against "can a staff member glance at
this mid-transaction and get the right answer fast?"

**Design principles — do not change without discussion:**
- **"For dummies" clarity over completeness.** Plain language; no jargon. If adding a fact makes the page harder to scan, leave it out.
- **Glanceable card layout.** One card per railcard. Rows: Save / When / Who (only where genuinely needed).
- **Colour stripe = Mon–Fri time rule only.** Green = any time. Amber = morning restriction. Red = Network (strictest). Do not repurpose these colours.
- **£ / ⊘ tokens in the When row.** £ = the discount still applies, subject to a minimum fare. ⊘ = the discount is not available yet. Both symbols are defined in the key strip (with ↳, follows the ticket's own Off-Peak rule) — keep both.
- **Weekend banner is deliberately simple.** Morning/min-fare limits usually don't apply at weekends — it does NOT say all restrictions lift. Do not broaden it back.
- **Chiltern-specific callouts** (`rc-chiltern`) are amber banners inside the card — keep them.
- **Photo-check is a table, not prose.** The `.photo-table`, in its own block after the six check steps, gives colour-coded rows by card type. Distinguish physical vs digital explicitly.
- **Selling essentials live in gotchas.** Minimum-fare mechanic, First Class eligibility per card, season-ticket exceptions. Do not move these to card rows.
- **Three-layer breakdown for "varies by route" time rules** — the durable fix for a local shortcut masquerading as a universal rule. Where a card's Mon–Fri cutoff is really a *local shortcut* for a national "morning-peak, off-peak-varies-by-route" rule, the card carries a `.rc-layers` block of three labelled rows instead of a `.rc-chiltern` prose note: `.rc-layer-lbl official` (navy: the national rule) / `local` (amber: Chiltern's directional Off-Peak rule, set out in the "Marylebone mornings" panel — never a clock time) / `check` (red: what the retail system confirms). A Chiltern-only rule wears the one `.tl-tag local` chip ("Marylebone"), explained in the source banner and worn by the Marylebone mornings panel. **Applied ONLY to the genuinely-varies cards — Family & Friends and Senior.** Cards whose time IS fixed (Network 10:00, Gold Card 04:30–09:29) keep the simple note; three layers everywhere would wreck the glanceable one-card scan.

**What to care about:**
- Factual accuracy per card — verify against nationalrail.co.uk before changing any rule.
- Min-fare amounts (£12/£13) and the July/August waiver list (16-25, HM Forces, Veterans waived; 26-30 not waived) — reviewed annually; re-check each spring.
- Senior Railcard Chiltern note — must say "journeys within the Network area", not "all Marylebone services"; through journeys to Birmingham are different.
- Family & Friends — the morning-peak restriction is on Network-area journeys only, not the whole card.
- Two Together photocard — **confirmed** against the official Two Together T&Cs: a physically printed Two Together Railcard bought at a station is issued with a **separate Two Together Photocard** (carrying both holders' photos) that must be carried and presented alongside the card, and both named holders must travel together. Digital cards have no separate photocard.

**What not to flag as defects:**
- No Firebase and no app state — intentional. The page loads the shared `guide-chips.js` (chip bar,
  scrollspy, deep-link landing), `guide-back.js` and `guide-print.js`. `guide-print.js` is a module,
  and its one import is the self-contained print guard (`print-guard.js`).
- Sticky header + sticky chip bar eating vertical space on small phones — an accepted trade-off.
- A–Z order with numeric cards first — intentional.
- **"If in doubt, ask your supervisor"** (this footer and the Rangers guide's) — deliberate: in the middle of a
  transaction at the gateline the person to ask is the supervisor on shift, a real role in that moment, not
  "your manager", CLAUDE.md's contact for rota and leave questions (whole-app check, Nov 2026).

### The page answers the Marylebone question: three questions, kept apart

The guide answers *"somebody has shown me this ticket at Marylebone — what actually matters?"*, and
that is **three questions that must not be collapsed into one**:

| | Question | Whose rule |
|---|---|---|
| **A** | does the **discount** apply at this time? | the Railcard's |
| **B** | is the **ticket** valid on this train at all? | the ticket's |
| **C** | if something is wrong, what do we **do**? | Chiltern's |

Collapsing A into B produces a legend like *"£ = travel OK, but a minimum fare applies"*, which reads
as though a Railcard settles whether somebody may travel; it settles the price. Collapsing B into A
invents Marylebone times (`~10:00`, `~09:30`) on Family & Friends and Senior, which have **no Railcard
time of their own at all**.

**The morning rules come in kinds that must stay visibly different:** no limit (16-17, Disabled) ·
a minimum fare, which is *not* a ban (16-25, 26-30, HM Forces, Veterans) · a fixed Railcard cutoff
(Two Together and Gold 09:30, Network 10:00) · follows-the-ticket (F&F, Senior, GroupSave). Rendering
the last kind with a clock time is what invents the shortcuts; `guide-sources.test.mjs` fails on an
`around HH:MM` in those three cards.

**The Marylebone morning panel states the real rule instead of a time.** Chiltern's own Off-Peak
restriction is **directional** — inbound must arrive after 10:00; outbound south of Banbury cannot
depart 04:29–08:30; outbound to **Banbury and north has no morning restriction**. It is styled as a
ticket rule, not a railcard card, and says twice that the retail system is the authority.

### The Network boundary is Banbury

The Network Railcard area ends at **Banbury (the boundary station)**: Kings Sutton, Bicester, Oxford,
Marylebone and Reading are inside; Leamington Spa, Warwick, Solihull, Coventry and Birmingham are
outside. It was settled from the boundary polygon in the railcard's own area-map PDF (a 41-vertex
filled shape drawn immediately before the six `NETWORK RAILCARD AREA` labels, tested point-in-polygon)
— **not from the map's station index**, which indexes the whole *London & the South East* map and also
lists Bristol, Taunton, Weston-super-Mare and Exeter. **Re-checked on the June 2026 map (22 Nov 2026)**
the same way: there the shape has 45 vertices and the labels are drawn as outlines, so they cannot be
searched as text — find the shape by its fill and its position before the outlined letters, and place
stations by their own markers. Banbury is still inside, on the edge (`GUIDE_SOURCES.md` → `rc-network-map`). A "correction" that read the index as the
boundary, extending the area to Birmingham, was wrong, and was caught by the owner's operational
knowledge. Two rules came out of it:

- **Direction of failure.** "Not valid past Banbury" refuses valid tickets; "valid to Birmingham"
  accepts invalid ones. On a revenue-facing page the second is worse, so a claim that loosens a
  restriction needs **more** evidence than one that tightens it, not the same amount.
- **A convenient inference is not evidence.** When a source nearly answers the question, state what
  it actually establishes and mark the rest unsettled — and when the owner's operational knowledge
  contradicts a fresh inference, the inference is the thing to re-examine first.

### Facts that are pinned — do not reintroduce the old claims

- **The 16-17 Saver exists in physical form too.** Both formats are genuine; the real constraint is
  that it is **not sold at stations**.
- **No 28-day deadline for a forgotten Railcard.** Chiltern's Charter allows one claim per 12 months
  and states no deadline.
- **Network easements do not apply here.** The railcard's list of origin stations that may use the
  discount before 10:00 on a named service has **no Chiltern service and no Marylebone-route station**
  on it (its one "Oxford" row is a *Great Western* service to Paddington). So the guide says 10:00 has
  no exception here, which is more useful than "easements may apply".

### Never ask staff to judge how somebody looks

`age looks right`, `eligibility looks right` and any instruction to check that a holder's
"age/eligibility looks right" are **removed, not softened**. The rule is wrong on four products —
16-25, 26-30 and the 16-17 Saver all stay valid past their upper age (the terms say so), and Family &
Friends keeps discounting a child who turns 16 mid-card — and on the Disabled Persons Railcard it
asks for a judgement no gateline should make. **The card is the evidence.** The guard also requires
the page to say so positively: dropping the instruction silently would leave the habit in place.

### Check the scope of a clause before recording a Conflict

A clause read outside its scope looks like a dispute that does not exist, and recording it sends the
next reader to re-read a page that already agrees. Two such non-conflicts, kept so they are not
"found" again:

- **Gold Card First Class.** The generic ticket-conditions text reads *"…Network Railcard: 1/3 off and
  Senior Railcard: 1/3 off **on Standard**. Other discount cards: Gold Cards: 1/3 off…"*. **"on
  Standard" binds to Senior**; Gold sits in a separate sentence with no class qualifier, and its own
  page says Standard *and* First twice.
- **Chiltern's £13 minimum.** Chiltern's railcard table once read "£13 at all times", which looked like
  a conflict with RDG's Mon–Fri minimum until its preamble was read: *"Restrictions listed below are
  applicable Monday–Friday (excluding bank holidays)"*. Re-read on 10 November 2026, the Network row
  itself now says "Mon-Fri" (`GUIDE_SOURCES.md` → `rc-myb-restrictions`).

### A correction callout may quote the old wrong wording — if it negates it

`.rc-correction` blocks are the one place the banned phrasing may appear, because a staff member who
learned "not valid past Banbury" from this page needs to be told in those words that it was wrong.
The "must not say" guards therefore skip those blocks — and a separate test fails if any correction
block lacks an explicit negation, so the class cannot become somewhere to park a live claim. The
exemption is **earned, not granted by the class name**.

**And the rule comes first, the history after it** (review, 15 Nov 2026), so a reader at the gateline
never meets the wrong rule before the right one. Each box that tells of this guide's past wording — a
correction or an unsourced note alike — opens with the rule as its label, and the history follows on
a line of its own under a dated label (`<br><span class="ct-label">Changed Aug 2026:</span>`, the
page's existing two-label shape). The history is **not collapsed**: it is for the member who learned
the old rule here, and a note they must open to find out it changed is one they will not open.
`guide-sources.test.mjs` → "a box that tells of this guide's old wording leads with the rule, and its
history follows". When the history lines may go altogether is an open owner question.

## FIP guide

`fip-guide.html` is a low-frequency educational reference — not a core workflow. Judge it as an
article-like reference page. Do not flag reference-page format as a design defect. Care about
factual accuracy, source links, mobile layout, and the navy/gold palette.

**Evidence is PER CARD, and there is deliberately no page-wide "last checked" date** — one date for
thirty-odd claims is either stale or, once one card is re-verified, an over-claim for every other.
Each country and ferry card shows its own `✓ Checked <Mon> <Year> against Rail Staff Travel` line and
cites its own `data-guide-source` row. `guide-sources.test.mjs` enforces that the date shown is the
oldest `Reviewed` of the rows the card cites (as it does for the Railcard and Rangers guides' pills —
a newer one claims a review nobody did), that **every** country/ferry card carries a line *and* an anchor, and that the finder
note makes no page-wide claim. **Absence of a marker is a statement** (the page says an undated card
is not re-verified), so it must never be an accident — which is why the invariant is structural.

**The country audit's standing rules** (every card was read against its live Rail Staff Travel
country page):

- **Never soften an unsourced claim — remove it.** Claims that survived by sounding plausible and are
  not in the source, and must not return without one: Denmark refusing SJ/Snälltåget night trains,
  Czech "ARRIVA vlaky and Trilex", Croatia bookable "via Trainseurope", Romania's "trains are slow".
- **But "I could not find it" is NOT "it is not published."** A citation framework proves a claim has
  a source; it can never prove the search was complete, so "nobody publishes this" is the one
  conclusion the register cannot safely reach on its own. Before recording an absence, enumerate the
  site's pages (the RST nav lists them) rather than the pages you happen to have open, and prefer "we
  could not find X" in the register over "X does not exist". (The "you generally qualify after 12
  months' service" rule was once struck out this way; it is published, under "When am I eligible for
  FIP cards and International Coupons?" on `/rst/faqs.html`, and `guide-sources.test.mjs` pins it.)
- **"Private operator" is not the test for FIP validity.** GySEV, Euskotren, the five Polish
  regionals and Switzerland's BLS are all in FIP. The operative rule is **check the undertaking**, with
  Italo/OUIGO/RegioJet/Leo Express as examples rather than as a category.
- **A country is not an undertaking.** Hungary has two (MÁV and GySEV), so does Spain (RENFE and
  Euskotren), Bosnia (ŽRS and ŽFBH) and Ireland (CIÉ and NIR); Poland has six. A card naming one
  operator reads as though the country has one, and coupons do not transfer between them.
- **Say which direction a rule bites.** Several countries treat the coupon and the FIP Card
  differently and it goes both ways — Denmark and the Netherlands favour the coupon, Czechia charges a
  supplement to a *leisure* coupon only.
- **Record a stated absence as an absence.** RST publishes no child-fare ages for Lithuania and no
  Swedish/Finnish undertaking exists; a blank reads as "no restriction".
- **A source that gives two answers is a `Conflict`, on the claim.** The page's first is the
  Vilnius–Riga train (owner, 10 Nov 2026): RST's Lithuania page lists it as a reservation route and
  excludes the Vilnius–Tallinn line it starts. It has its own row, `fip-vilnius-riga`, and on the
  Lithuania and Latvia cards a `.fip-unresolved` callout (a red EDGE and label — a red box here means
  "not valid", which is an answer), so the cards' settled lines keep their own state. A page with a
  Conflict also carries the amber `.source-banner` above the chip bar, naming it; both are required by
  `guide-sources.test.mjs`, and both go when the row is settled.
- **Name the operators the source names as outside FIP.** Where a country page lists "Non FIP
  operators", the card's "⚠ Other operators — FIP not valid" box gives that list as the page gives it,
  with its own register row, so a member planning a trip learns which trains in that country their
  coupon will not cover. A list the page calls not exhaustive is said to be not exhaustive.

**Its controls are the app's.** The country finder is the app's field — sunken, a 2px edge, the 12px
corner, white with a soft ring while you are in it; the chips under it are the guide bar's chip; and
the "What you get" emoji lead their titles with no tile, as on every app card. Its notes keep their
FULL OUTLINE, deliberately, where every other guide's note has a coloured left edge: on this page an
edge marks an unresolved source (`.fip-unresolved`), so an edged box would read as one. They take the
guide family's amber and info blue, and the source banner the Railcard and Rangers banner's amber.
`e2e/guides.spec.js` → "the finder is the app's field, the chips under it are the bar's, and no tile sits
behind an emoji".

**The booking-reach table** (`#booking-table`) is the page's only table. It stacks below 560px via
`data-label` generated content, and carries explicit `role="table"/"row"/"cell"` because
`display: block` strips a table's semantics from the accessibility tree. It must stay invisible to
the country finder, which selects `[id^="country-"]` — an id starting `country-` would let a search
hide the table that answers the question about that country.

## Rangers & Rovers guide

`rangers-guide.html` — the ranger and rover area passes staff accept or refuse at the gateline. A
sibling of the railcard guide and deliberately a **dialect of it**, not a new language: the colour
stripe (green = any time, amber = a morning bar), the `⊘` token, the card/row rhythm and the amber
Chiltern callout mean here exactly what they mean there, because the same people read both minutes
apart. **It also LOOKS like it**: the Railcard's card (white, shadowed, a 4px stripe, the 12px corner)
and amber Chiltern note with its amber edge. `e2e/guides.spec.js` → "the Rangers guide draws its cards
and its Chiltern note as the Railcard guide does" compares the two pages' computed card and note.

### It answers the MARYLEBONE question first

"Is Chiltern a participating operator?" is the wrong primary question at this gateline: a product can
be valid on Chiltern and unusable at Marylebone (the **West Midlands Day Ranger**'s area stops at
Leamington Spa). So every card carries **two states, and neither can be inferred from the other**:

| Attribute | Values | Rendered as |
|---|---|---|
| `data-myb-validity` | `yes` · `no` · `conflict` · `unconfirmed` | `.myb-status` badge in the left half of `.rr-status-grid` |
| `data-chiltern-validity` | `yes` · `no` · `conflict` · `unconfirmed` | `.ch-status` badge in the right half |

**`unconfirmed` is not a milder `conflict`.** `conflict` takes RED (matching `pill-conflict`),
`unconfirmed` takes AMBER (matching `pill-draft`), and `guide-sources.test.mjs` fails if an
unconfirmed product wears a conflict badge **or** if the two are styled identically. Red beside the
red `⊘ Not valid` is deliberate — those two are separated by the word and the `⚠`/`⊘` token, never by
hue.

`✓ Area only` on the Chiltern side is the whole point of the split: a real ticket on our network that
is no use from London. **The three top-level sections are that pair**, not a product taxonomy —
*Valid at Marylebone* → *Valid on Chiltern but not at Marylebone* → *Not valid on Chiltern at all* —
so the answer is the section heading and the badges only confirm it.

`guide-sources.test.mjs` pins this: both attributes declared on every card, values constrained,
Marylebone never merely copied from Chiltern, an `MYB ✓` obliged to state its scope, and each status
carried by **words** as well as colour. The failure mode is silent — a wrong badge renders perfectly.

### Evidence is per CLAIM, not per card

A whole-card `Conflict` for a disagreement affecting one line makes a reader distrust the facts that
are sound or miss the one that is not. A disputed claim takes its **own** `data-guide-source` id and
its own `.rr-unresolved` callout, and the card keeps whatever state its own sourcing earned. The
register test accepts a card-level marker **or** a claim-level one. The live split claims are
`rr-shakespeare-core` / `rr-shakespeare-boj` and `rr-thames-7-geography` / `rr-thames-7-operator`
(`GUIDE_SOURCES.md` holds their current classes).

### State a BOUNDARY, not a station list

A list of "its Chiltern stations" is a claim about the **intersection** of the ticket's area with
Chiltern's network, and only the first of those two is sourceable from the product page — such lists
went wrong in both directions at once. What the applicable-station list *does* prove is where the area
**stops**, which is the only part a Marylebone gateline acts on. Prefer "reaches Leamington Spa and
stops — Banbury is outside it" over any enumeration. Name a station individually only for a genuine
near-miss whose neighbour differs: *Bicester Village but not Bicester North*, *Oxford but not Oxford
Parkway*.

### A rule that belongs to a CLASS does not go on one card

"A Rover may not be issued more than 3 days ahead (5 by telesales/internet)" is on the **Rover ticket
pages** (`he7`, `s37`), not on any one promotion page — so it is one entry in "How to check one"
(`rr-advance-sale`), cited where it was read, and explicitly scoped to Rovers (the `ce1` Discoverer
page carries a different limit). Ask of any new fact: *is this true of this product, or of its
class?*

### Evidence state is PER PRODUCT, and there are three of them (owner)

| Status | Pill | Card marker | Register class |
|---|---|---|---|
| Read at source, states what the source states | `✓ National Rail checked · Aug 2026` (green) | — | `National` |
| Read at source, and the source will not settle it | `⚠ Source conflict · check retail system` (red) | `.rr-card--conflict` | `Conflict` |
| Not yet read at source | `Draft · source not yet verified` (amber) | `.rr-card--draft` | `Draft` |

**A Conflict is not a stronger Draft, and they must never share a marker.** Draft means nobody has
looked; Conflict means somebody did and the publisher contradicts itself. Re-reading fixes the first
and cannot fix the second — a staff member sent back to a page already read learns nothing and loses
time at a gateline. Conflict takes RED because red is already this page's *stop* token (the near-miss
stripe, `.tok-no`): right for *stop and check*, wrong for *nobody has looked yet*.

**Never resolve a conflict by picking the likelier reading.** Both live cases refuse somebody either
way: Shakespeare Explorer's break of journey (`rr-shakespeare-boj` — National Rail's description
permits it, the detailed conditions on the same page do not) and whether Chiltern is an operator on
the Thames Rover **7 Day** (`rr-thames-7-operator` — the current 7-Day promotion lists Chiltern; the
older TR3/TR7 formal page says GWR only; the Marylebone answer is a clean no either way). The 3-Day
promotion lists GWR only, so the two durations must never be merged into one card. Report both
readings and say what to do meanwhile.

**The `✓ checked` pill's green is DARKER than the page's `--green` token, and that is measured** — the
token on its own 10% tint is 4.49:1, under the AA floor (the comment beside `.pill-checked` in
`rangers-guide.css` has the figures). Re-measure if either value moves.

`guide-sources.test.mjs` enforces all of it: the class set, a per-class card marker on every anchored
block, a banner that names every state actually present, and — because a classification with no
reasoning is unactionable — that every Conflict row's claim text describes **both** readings.

**To settle a product:** re-check it at source *and* in the retail system, then flip its row and drop
its marker. The banner goes when the last provisional row does.

### Design decisions

- **It leads with "usually no" — but the products listed are a SHORTLIST, never a rule of
  exclusion.** ~90 products exist nationally and a handful touch Chiltern, so opening with a long list
  makes the common case slow and the rare case ambiguous. But refusing a valid pass is the worse
  gateline failure, and the only one this page can cause. **Not on the list means CHECK** — the page
  says so where a reader who scrolled past the top meets it (`#rr-reported`, "Anything else — check,
  don't refuse"). A product reported to reach us becomes a full card, never a bare list entry: a card
  states days, area, time bars and break of journey, each a rule a passenger could be refused by.
- **An unresolved rule is rendered as unresolved, and it does not wear the amber Chiltern callout**
  (`.rr-unresolved`, red). Amber means "here is the local answer no national page gives" — something
  to act on; a rule whose published wording contradicts itself is the opposite. The two live cases are
  the conflicts above.
- **The near-misses section is the point of the page**, not an appendix. Cotswolds Discoverer and
  Freedom of Severn & Solent both reach stations on our map and are not valid on us; saying so quickly
  is the answer no national page gives.
- **No prices, ever.** Re-set annually and three-way variable; a stale one is a mis-sell. Deliberately
  stricter than the railcard guide's two min-fare figures.
- **The date box gets the `.gotcha`.** It is the only ranger/rover rule a gateline can enforce by
  looking, and the one most likely to be unknown.
- **A list of things we have NOT checked must not wear the "valid" tick.** The green ✓ is the token
  the key strip defines as *valid on Chiltern*, so putting it on unchecked products makes the claim the
  prose refuses to. Any such list that comes back needs its own neutral marker.
