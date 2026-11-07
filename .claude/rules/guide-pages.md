---
paths:
  - "guide*.*"
  - "*-guide.*"
  - "fip.*"
---

# Guide pages — full reference

> **The `paths:` list above uses GLOBS, and must stay that way.** An enumerated list of filenames
> falls behind (it once missed `guide-back.js`, so editing the file that owns the back arrow did not
> surface this document). Three globs cover every guide page, stylesheet and script, including any
> added later.

## Shared rules (all five guide pages)

> **Calm enough to use. Clear enough to learn. Detailed when needed.** The bar for a guide page
> (owner, 3 Sep 2026). A page that is glanceable and teaches nothing misses it, and so does one that
> explains everything at once.

- **Write for the colleague who has never heard the term** (owner, 3 Sep 2026). Many colleagues do
  not know what a FIP coupon is, or how to use a FIP card, and the guide's first job is to let them.
  Plain language, one idea per line, the term expanded on first sight, and the real-world anchor
  stated (what it looks like, where you get it, what the barrier or the payslip shows). If adding a
  fact makes the page harder for that reader to use, leave it out or move it down. The app-wide
  statement of this rule is CLAUDE.md → "Plain English that TEACHES".
- **Teach the mental model before the exceptions, once.** Many staff open a guide because they do not
  yet understand the *system* the rules belong to — what the thing is, when you would use it, what you
  physically hold or show, what it gives you, what it does not, and what you do next at Marylebone.
  Answer that near the top, in ordinary language beside the official term, and then let the individual
  cards stay glanceable rather than repeating the concept thirty times. **`fip-guide.html` is the
  worked example**: before either term is used in anger, a *"What do I need?"* table separates free
  travel (coupons) from discounted fares (the Card), and a *"What you get"* pair explains each. Judge
  a new guide against that opening. **The facts themselves stay governed by `GUIDE_SOURCES.md` and its
  evidence classes** — this rule is about STRUCTURE, and no definition may be improved into the guide
  without its source.
- **Searchability is not discoverability.** The drawer's cross-guide search only helps a reader who
  knows the words. Somebody who has never heard of an International Coupon cannot search for one. So a
  guide still owes its reader an orientation, conceptual headings and "you may also need…" signposting;
  search is for the reader who already knows what they want. Never close a discovery gap by pointing at
  the search box.
- **An example of a search is not an answer to it.** A search tip that names phrases to try puts those
  phrases into the cross-guide index as ordinary body text, and a body match scores the same wherever
  it appears — so the tip itself became the top hit for the phrase it suggested. Mark any such element
  `data-gs-example`, and `scripts/guide-index-lib.mjs` drops it before extracting; pinned by contract 6
  in `guide-index-parity.test.mjs`. The staleness contract cannot see this, because the index is
  perfectly TRUE of the page.
- Guide pages do **not** import the app's `shared.css` (nav panel / lightbox / login chrome they don't
  use). All five share `guide-shell.css`; the two **document-style** guides (`staff-guide.html`,
  `paycalc-guide.html`) additionally load `guide-doc.css` (the shared two-column print layout + 760px
  content wrapper) between the shell and their own CSS. Each page then has its own external CSS file
  (`staff-guide.css`, `paycalc-guide.css`, `railcard-guide.css`, `fip-guide.css`, `rangers-guide.css`).
  Do not add a `shared.css` import to any guide.
- **The two OLD guide URLs are still served, as redirect stubs.** `guide.html` → `staff-guide.html`
  and `fip.html` → `fip-guide.html`: `firebase.json` 301s both, but that covers only the canonical
  origin. The GitHub Pages mirror serves no redirect rules and is where most staff open the app, so
  the redirect is also written into the HTML, which both origins carry. The stubs hold no content, no
  script and no stylesheet, and they are NOT guides: they are declared as `REDIRECT_PAGES` in
  `scripts/app-pages.mjs`, and `page-contract-parity.test.mjs` gives them a contract of their own
  (`LEGACY_REDIRECTS`). **A future guide rename needs the same pair of things** — the Firebase
  redirect and the stub — or it breaks old links for the larger half of the staff.
- Guide pages use **no inline `<script>` or `onclick` handlers** — Firebase Hosting CSP
  (`script-src 'self'`) blocks them. All guide JS is in external files: `guide-back.js` and
  `guide-print.js` (loaded by every guide), plus `railcard-guide.js`, `rangers-guide.js` and
  `fip-guide.js` (opens the target country `<details>` on jump/deep-link). **Only `guide-print.js`
  prints**: a second `window.print()` handler would open two sheets or bypass the iOS 27 guard.
- Back buttons link to `./` (not `./admin.html`) — guides are accessed from the nav panel;
  `paycalc-guide.html`'s links to `./paycalc.html`. **`guide-back.js` retargets that arrow at runtime**
  when the guide was opened from the nav drawer: `nav-panel.js` appends `?from=<page>` and the guide
  points `←` back at that page instead of its hardcoded default, because guide links navigate in the
  SAME tab. `from` is allowlisted against the app's own pages; an absent or unknown value leaves the
  authored href alone.

## Unified guide shell

All five guide pages share one chrome for consistent behaviour on iOS, Android, desktop and print.
The common chrome lives in **`guide-shell.css`** (linked by every one of them, before each page's
CSS). Edit the shell there once — do not re-inline it. `guide-shell.css` defines the shared brand
palette tokens (`--navy`, `--navy-dark`, `--navy-mid`, `--gold`) in its own `:root`; guide pages do
not redefine them.

**In `guide-shell.css` (shared — change once):**
- **Typeface:** the shared Inter `@font-face` (the same self-hosted `fonts/inter-latin.woff2` the app
  uses — SW-precached, CSP-clean) + the `--font-sans` token. Every guide body uses `var(--font-sans)`
  (railcard/fip/rangers in their own CSS; staff-guide/paycalc-guide via `guide-doc.css`) so the guides
  render the same brand typeface as the app.
- **Header:** full-bleed sticky navy `.page-header`, `align-items: center`, `top: 0`, with `←`
  `.btn-back` (left) · title `<h1>` + `.sub` · `⤓ PDF` `.btn-pdf` (right, `margin-left:auto`). Top
  padding `max(14px, env(safe-area-inset-top))` for the iOS notch. **3px gold bottom rule** — the
  navy-and-gold brand echo; it prints too (the header doubles as the railcard/fip/rangers print
  banner).
- **Chip bar and header alignment:** from 800px the chip bar's inline padding — and the header's, whose
  navy band stays full-bleed — is the 760px content column's own text edge, so the first chip and the
  `←` start, and `⤓ PDF` ends, where the text does. It restates the 760/16 pair the three page CSS
  files and `guide-doc.css` declare — change them together, with the railcard and rangers source
  banners' 728px (760 less its two 16px sides).
- **The `←` has one hover, gold, on every guide** (fine pointers only). Its selector outranks a page's
  own `a:hover`, which once turned it amber on navy.
- **Footer back link:** `.guide-back-link` is ONE recipe for railcard, rangers and FIP — centred,
  44px tall, "← Back to calendar" to `./`, the last element of `<main>`, hidden in print by the
  shell. Do not restyle it per page; `e2e/guides.spec.js` fails if the three diverge.
- **Chips:** desktop hover feedback (border-darken + soft shadow, colour-fade only — no transform) on
  the shared `.chip`, so a mouse gets an affordance as well as `:active`.
- **Print:** `.page-header { position: static; print-color-adjust: exact }`, and `.btn-back`,
  `.btn-pdf`, `.chip-bar`, `.guide-back-link` and `.print-unavailable` are hidden. railcard/fip/rangers
  print the sticky header as their title banner; on staff-guide/paycalc-guide the header is
  `.no-print`, so these rules are inert there (they print their own in-document `.guide-header` banner
  instead — `print-color-adjust: exact` on that banner stays inline).

**Still per-page in each page's own CSS file (keep aligned by eye):**
- **Background:** flat, edge-to-edge — `#f4f5f8` on the FIP, Railcard and Rangers guides, `#eef1f6`
  (`--page-bg`, `guide-doc.css`) on the Staff and Pay Calculator guides. No white "page" card.
- **Content width:** `max-width: 760px`, centred. For `staff-guide.html`/`paycalc-guide.html` the
  760px wrapper **and** the two-column `.cols` print grid live in the shared **`guide-doc.css`** (not
  the page's own file); `railcard-guide.html`/`fip-guide.html`/`rangers-guide.html` set their own 760px
  single-column width in their page CSS.
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
  before `guide-print.js` prints.

## Source governance — GUIDE_SOURCES.md

High-risk guide claims (anything that could mis-sell/refuse a ticket, invalidate a journey, or
mis-state pay) are registered in **`GUIDE_SOURCES.md`** with their authoritative source, review
dates, and a **National / Local / Tip / Fact** classification. `guide-sources.test.mjs` enforces
that register structurally (part of `npm run test:hygiene`) — every row must keep its source, its
`Reviewed`/`Next` dates (Next strictly after Reviewed), and a valid class.

- **Before changing a high-risk claim**, update its register row (Source + `Reviewed`), then the guide.
- **Block ↔ source linkage:** each high-risk railcard/fip block carries a
  `data-guide-source="<register-id>"` attribute wiring it to its register row. `guide-sources.test.mjs`
  enforces both directions — an attribute pointing at a missing row fails, and a railcard/fip row with
  no anchoring block fails. Adding a high-risk row therefore means anchoring it in the HTML (and
  removing a block means removing or re-homing its row). The attribute is inert (no CSS/JS reads it),
  so it needs no version bump. A block may cite multiple rows (space-separated).
- The **National vs Local** flag is the anti-drift control: it is what stops a Marylebone shortcut
  being restated as a universal national rule (see the three-layer format below).
- The test is a **structural** guard, NOT a date tripwire (a today-driven failure would break unrelated
  commits). Review cadence is manual, driven by the `Next` column — re-check a section when its month
  arrives; full pass at least yearly (railcards each spring; tax before 6 April).

## What adding a guide page touches

Adding a guide is not "write a page". Every place below knows the guide list, and most fail loudly —
which is the good case. Listed so the work is estimated honestly; each row was checked against the
code.

| # | File | What |
|---|---|---|
| 0 | `scripts/app-pages.mjs` | a `GUIDE_PAGES` entry — `page-contract-parity.test.mjs` fails on an undeclared page — then `npm run generate:guide-index` (`guide-index-parity.test.mjs` checks it) |
| 1 | `nav-panel.js` | `NAV_GUIDES` entry — icon, label, url, **`openId`** |
| 2 | `firestore.rules` | analytics counter id, in **two** places (the `hasOnly` allowlist and the per-id int check) |
| 3 | `firestore-contract-parity.test.mjs` | asserts `NAV_GUIDES` openIds match the rules list, both ways |
| 4 | `service-worker.js` | precache: `.html` + `.css` (+ `.js` if any) |
| 5 | `sw-asset-check.test.mjs` | asset-list parity, and the `noindex` meta contract |
| 6 | `csp-meta-parity.test.mjs` | the page's `<meta http-equiv="Content-Security-Policy">` must mirror the header |
| 7 | the page itself | `noindex` meta + `color-scheme: only light` meta |
| 8 | `e2e/axe.spec.js` | accessibility scan (blocking gate) |
| 9 | `e2e/csp.spec.js` | deployed-CSP proof |
| 10 | `e2e/calendar.spec.js` | each guide records its **own** open id, driven through the real drawer |
| 11 | `GUIDE_SOURCES.md` | a register row per high-risk claim |
| 12 | `guide-sources.test.mjs` | the two-way `data-guide-source` contract — a row with no block fails, and vice versa |
| 13 | `guide-shell.css` | nothing to change, but confirm nothing new is needed |
| 14 | `guide-back.js` | already generic; confirm the new page is in scope |
| 15 | `e2e/visual.spec.js` + baselines | every guide is baselined — the document-style pair at desktop 900, the other three at mobile 390; pick the width that shows the new page's densest state |
| 16 | `.claude/rules/guide-pages.md` | its `paths:` globs **and** its per-guide section (this file) |
| 17 | `docs/FILE_INDEX.md` + `docs/AI_MAP.md` | the file catalogue, same-commit rule |

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
- **Photo-check is a table, not prose.** The `.photo-table` inside check step 3 gives colour-coded rows by card type. Distinguish physical vs digital explicitly.
- **Selling essentials live in gotchas.** Minimum-fare mechanic, First Class eligibility per card, season-ticket exceptions. Do not move these to card rows.
- **Three-layer breakdown for "varies by route" time rules.** Where a card's Mon–Fri cutoff is really a *local shortcut* for a national "morning-peak, off-peak-varies-by-route" rule, the card carries a `.rc-layers` block of three labelled rows instead of a `.rc-chiltern` prose note — `.rc-layer-lbl official` (navy: the national rule) / `local` (amber: Chiltern's directional Off-Peak rule, set out in the "Marylebone mornings" panel — never a clock time) / `check` (red: what the retail system confirms). The page intro teaches the model once, with `.tl-tag` chips. **Applied ONLY to the genuinely-varies cards — Family & Friends and Senior.** Do NOT blanket every card with it: cards whose time IS fixed (Network 10:00, Gold Card 04:30–09:29) keep the simple note, and three layers everywhere would wreck the glanceable one-card scan the guide depends on. This is the durable fix for a local shortcut masquerading as a universal rule.

**What to care about:**
- Factual accuracy per card — verify against nationalrail.co.uk before changing any rule.
- Min-fare amounts (£12/£13) and the July/August waiver list (16-25, HM Forces, Veterans waived; 26-30 not waived) — reviewed annually; re-check each spring.
- Senior Railcard Chiltern note — must say "journeys within the Network area", not "all Marylebone services"; through journeys to Birmingham are different.
- Family & Friends — the morning-peak restriction is on Network-area journeys only, not the whole card.
- Two Together photocard — **confirmed** against the official Two Together T&Cs: a physically printed Two Together Railcard bought at a station is issued with a **separate Two Together Photocard** (carrying both holders' photos) that must be carried and presented alongside the card, and both named holders must travel together. Digital cards have no separate photocard.

**What not to flag as defects:**
- No JS modules — static page, intentional.
- Sticky header + sticky chip bar eating vertical space on small phones — an accepted trade-off.
- A–Z order with numeric cards first — intentional.

### The page answers the Marylebone question: three questions, kept apart

The guide answers *"somebody has shown me this ticket at Marylebone — what actually matters?"*, and
that is **three questions that must not be collapsed into one**:

| | Question | Whose rule |
|---|---|---|
| **A** | does the **discount** apply at this time? | the Railcard's |
| **B** | is the **ticket** valid on this train at all? | the ticket's |
| **C** | if something is wrong, what do we **do**? | Chiltern's |

Collapsing A into B produces a legend like *"£ = travel OK, but a minimum fare applies"*, which reads
as though a Railcard settles whether somebody may travel. It does not; it settles the price.
Collapsing B into A invents Marylebone times (`~10:00`, `~09:30`) on Family & Friends and Senior,
which have **no Railcard time of their own at all**.

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
— **not from the map's station index**, which is the index of the whole *London & the South East*
map the area is drawn on, and also lists Bristol, Taunton, Weston-super-Mare and Exeter. A
"correction" that read the index as the boundary, extending the area to Birmingham, was wrong, and
was caught by the owner's operational knowledge. Two rules came out of it:

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
- **Chiltern's "£13 at all times".** Read alone it contradicts RDG's Mon–Fri minimum. Its table's own
  preamble is *"Restrictions listed below are applicable Monday–Friday (excluding bank holidays)"*.

### A correction callout may quote the old wrong wording — if it negates it

`.rc-correction` blocks are the one place the banned phrasing may appear, because a staff member who
learned "not valid past Banbury" from this page needs to be told in those words that it was wrong.
The "must not say" guards therefore skip those blocks — and a separate test fails if any correction
block lacks an explicit negation, so the class cannot become somewhere to park a live claim. The
exemption is **earned, not granted by the class name**.

## FIP guide

`fip-guide.html` is a low-frequency educational reference — not a core workflow. Judge it as an
article-like reference page. Do not flag reference-page format as a design defect. Care about
factual accuracy, source links, mobile layout, and the navy/gold palette.

**Evidence is PER CARD, and there is deliberately no page-wide "last checked" date.** A single date
standing in for thirty-odd separate claims can only ever be wrong in one of two directions: stale, or,
the moment one card is re-verified, an over-claim covering every card nobody looked at. Each country
and ferry card therefore shows its own `✓ Checked <Mon> <Year> against Rail Staff Travel` line and
cites its own `data-guide-source` row. `guide-sources.test.mjs` enforces three things: the date shown
equals its register row's `Reviewed`; **every** country/ferry card carries a line *and* an anchor; and
the finder note makes no page-wide claim.

**Absence of a marker is a statement, so it must never be an accident.** The page tells readers an
undated card has not been re-verified, so a fully sourced card with no line tells staff to trust it
less than it deserves — and nothing renders wrong or throws. That is why the invariant is structural.

**The country audit's standing rules** (every card was read against its live Rail Staff Travel
country page):

- **Never soften an unsourced claim — remove it.** Claims that survived by sounding plausible and are
  not in the source, and must not return without one: Denmark refusing SJ/Snälltåget night trains,
  Czech "ARRIVA vlaky and Trilex", Croatia bookable "via Trainseurope", Romania's "trains are slow".
- **But "I could not find it" is NOT "it is not published."** A citation framework proves a claim has
  a source; it can never prove the search was complete, so "nobody publishes this" is the one
  conclusion this register cannot safely reach on its own. Before recording an absence, enumerate the
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

**The booking-reach table** (`#booking-table`) is the page's only table. It stacks below 560px via
`data-label` generated content, and carries explicit `role="table"/"row"/"cell"` because
`display: block` strips a table's semantics from the accessibility tree. It must stay invisible to
the country finder, which selects `[id^="country-"]` — an id starting `country-` would let a search
hide the table that answers the question about that country.

## Rangers & Rovers guide

`rangers-guide.html` — the ranger and rover area passes staff accept or refuse at the gateline. A
sibling of the railcard guide and deliberately a **dialect of it**, not a new language: the colour
stripe (green = any time, amber = a morning bar), the `⊘` token, the card/row rhythm and the amber
Chiltern callout mean here exactly what they mean there. The two pages are read by the same people
minutes apart; a second vocabulary would slow both down.

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
and cannot fix the second — a staff member sent back to a page that has already been read learns
nothing and loses time at a gateline. Conflict takes RED because red is already this page's *stop*
token (the near-miss stripe, `.tok-no`), which is right for *stop and check* and wrong for *nobody
has looked yet*.

**Never resolve a conflict by picking the likelier reading.** Both live cases refuse somebody either
way: Shakespeare Explorer's break of journey (National Rail's description permits it, the detailed
conditions on the same page do not) and Thames Rover **7 Day** (the current 7-Day promotion lists
Chiltern; the older TR3/TR7 formal page says GWR only — and the 3-Day promotion lists GWR only, so the
two durations must never be merged into one card). Report both readings and say what to do meanwhile.

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
  exclusion.** ~90 products exist nationally and a handful touch Chiltern, so a page that opens with a
  long list makes the common case slow and the rare case ambiguous. But of the two failures available
  at a gateline, refusing a valid pass is the worse one and the only one this page can cause. **Not on
  the list means CHECK** — the page says so where a reader who scrolled past the top meets it
  (`#rr-reported`, "Anything else — check, don't refuse"). A product reported to reach us becomes a
  full card, never a bare list entry: a card states days, area, time bars and break of journey, each a
  rule a passenger could be refused travel by.
- **An unresolved rule is rendered as unresolved, and it does not wear the amber Chiltern callout**
  (`.rr-unresolved`, red). Amber means "here is the local answer no national page gives" — something
  to act on. A rule whose published wording contradicts itself is the opposite. Two live cases: the
  Shakespeare Explorer break of journey (`rr-shakespeare-boj`), and whether Chiltern is an operator on
  the Thames Rover 7 Day (`rr-thames-7-operator` — the Marylebone answer is a clean no either way).
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
