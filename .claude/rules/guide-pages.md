---
paths:
  - "guide*.*"
  - "*-guide.*"
  - "fip.*"
---

# Guide pages — full reference

> **The `paths:` list above uses GLOBS, and must stay that way.** It enumerated seventeen filenames
> and had already fallen behind: `guide-back.js` — loaded by every one of the five guides, and
> described three paragraphs below — was not on it, so editing the file that owns the back-arrow
> behaviour did not surface the document that specifies it. Exactly the failure
> `.claude/rules/links-design.md` records against its own list, which is why the fix is the same one.
> Three globs cover every guide page, every guide stylesheet and every guide script, including any
> added later.

## Shared rules (all FIVE guide pages)

- Guide pages do **not** import the app's `shared.css` (nav panel / lightbox / login chrome they don't use). All five share `guide-shell.css`; the two **document-style** guides (`staff-guide.html`, `paycalc-guide.html`) additionally load `guide-doc.css` (the shared two-column print layout + 760px content wrapper) between the shell and their own CSS. Each page then has its own external CSS file (`staff-guide.css`, `paycalc-guide.css`, `railcard-guide.css`, `fip-guide.css`, `rangers-guide.css`) — extracted from inline `<style>` blocks at v12.04. Do not add a `shared.css` import to any guide.
- Guide pages use **no inline `<script>` or `onclick` handlers** — Firebase Hosting CSP (`script-src 'self'`) blocks them. All guide JS is in external files: `railcard-guide.js` (v10.84), `guide-print.js` (v10.84, shared by `staff-guide.html`, `paycalc-guide.html` and `fip-guide.html`), `fip-guide.js` (v16.59, opens the target country `<details>` on jump/deep-link), and `guide-back.js` (v18.84, loaded by EVERY guide — the back-arrow retarget). Do not add inline scripts or `onclick` attributes.
- Back buttons on `railcard-guide.html` and `fip-guide.html` link to `./index.html` (not `./admin.html`) — guides are accessed from the nav panel. **`guide-back.js` retargets that arrow at runtime** when the guide was opened from the nav drawer: `nav-panel.js` appends `?from=<page>` and the guide points `←` back at that page instead of its hardcoded default. Needed since v18.81 made guide links navigate in the SAME tab (a new tab used to preserve the page you left). `from` is allowlisted against the app's own pages; an absent or unknown value leaves the authored href alone.

## Unified guide shell (v11.47)

All five guide pages share one chrome for consistent behaviour on iOS, Android, desktop, and print. The common chrome lives in **`guide-shell.css`** (linked by every one of them, before each page's CSS). Edit the shell there once — do not re-inline it. As of v11.85, `guide-shell.css` defines the shared brand palette tokens (`--navy`, `--navy-dark`, `--navy-mid`, `--gold`) in its own `:root` — guide pages no longer redefine these themselves.

**In `guide-shell.css` (shared — change once):**
- **Typeface (v18.79):** the shared Inter `@font-face` (same self-hosted `fonts/inter-latin.woff2` the app uses — SW-precached, CSP-clean) + the `--font-sans` token. Every guide body uses `var(--font-sans)` (railcard/fip in their own CSS; guide/paycalc-guide via `guide-doc.css`) so the guides render the SAME brand typeface as the app — before this they fell back to the system stack and read subtly off-brand.
- **Header:** full-bleed sticky navy `.page-header`, `align-items: center`, `top: 0`, with `←` `.btn-back` (left) · title `<h1>` + `.sub` · `⤓ PDF` `.btn-pdf` (right, `margin-left:auto`). Top padding `max(14px, env(safe-area-inset-top))` for the iOS notch. **3px gold bottom rule (v18.79)** — the navy-and-gold brand echo; prints too (the header doubles as the railcard/fip print banner).
- **Chips (v18.79):** desktop hover feedback (border-darken + soft shadow, colour-fade only — no transform) on the shared `.chip`; previously chips only reacted on `:active`, so a mouse got no affordance.
- **Print:** `.page-header { position: static; print-color-adjust: exact }` and `.btn-back, .btn-pdf { display: none }`. railcard/fip print the sticky header as their title banner; on guide/paycalc the header is `.no-print` so these rules are inert there (they print their own in-document `.guide-header` banner instead — `print-color-adjust: exact` on that banner stays inline).

**Still per-page in each page's own CSS file (keep aligned by eye):**
- **Background:** flat `#f4f5f8` edge-to-edge. No white "page" card.
- **Content width:** `max-width: 760px`, centred. For `staff-guide.html`/`paycalc-guide.html` the 760px wrapper **and** the two-column `.cols` print grid live in the shared **`guide-doc.css`** (not the page's own file); `railcard-guide.html`/`fip-guide.html` set their own 760px single-column width in their page CSS.
- **Safe-area:** side insets `max(16px, env(safe-area-inset-*))` on the content wrapper; bottom `max(40px, env(safe-area-inset-bottom))`.
- **PDF button markup:** `<button id="savePdfBtn" class="btn-print btn-pdf">⤓ PDF</button>`. Wired by `guide-print.js` (`.btn-print`) on guide/paycalc/fip; `railcard-guide.js` wires `#savePdfBtn` itself because it also owns the chip-bar.

## Source governance — GUIDE_SOURCES.md (v17.50)

High-risk guide claims (anything that could mis-sell/refuse a ticket, invalidate a journey, or
mis-state pay) are registered in **`GUIDE_SOURCES.md`** with their authoritative source, review
dates, and a **National / Local / Tip / Fact** classification. `guide-sources.test.mjs` enforces
that register structurally (part of `npm run test:hygiene`) — every row must keep its source, its
`Reviewed`/`Next` dates (Next strictly after Reviewed), and a valid class, so the content-assurance
gap the v17.45 audit flagged can't silently reopen.

- **Before changing a high-risk claim**, update its register row (Source + `Reviewed`), then the guide.
- **Block ↔ source linkage (v17.59):** each high-risk railcard/fip block carries a
  `data-guide-source="<register-id>"` attribute wiring it to its register row. `guide-sources.test.mjs`
  enforces both directions — an attribute pointing at a missing row fails, and a railcard/fip row with
  no anchoring block fails. Adding a high-risk row therefore means anchoring it in the HTML (and
  removing a block means removing/re-homing its row). The attribute is inert (no CSS/JS reads it), so
  it needs no version bump. A block may cite multiple rows (space-separated).
- The **National vs Local** flag is the anti-drift control: it is what stops a Marylebone shortcut
  being restated as a universal national rule (the root cause of the v17.45 railcard errors — see the
  three-layer format below).
- The test is a **structural** guard, NOT a date tripwire (a today-driven failure would break unrelated
  commits). Review cadence is manual, driven by the `Next` column — re-check a section when its month
  arrives; full pass ≥ yearly (railcards each spring; tax before 6 April).

## What adding a guide page touches

Adding a guide is not "write a page". Seventeen places know how many guides there are, and most fail
loudly — which is the good case. Listed so the work is estimated honestly.

**This arrived here from `RANGERS_ROVERS_PLAN.md` when that plan was retired (2 Sep 2026).** It was
written for the FIFTH guide and every row was checked against the code rather than assumed — which
is exactly why it outlived the plan that produced it. A checklist for adding a guide belongs beside
the rules for writing one, not in the history of the page that happened to need it first; filed as
history it would have been invisible to whoever adds a sixth.

| # | File | What |
|---|---|---|
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
| 12 | `guide-sources.test.mjs` | the two-way `data-guide-source` contract — a row with no block fails, and vice-versa |
| 13 | `guide-shell.css` | nothing to change, but confirm nothing new is needed |
| 14 | `guide-back.js` | already generic; confirm the new page is in scope |
| 15 | `e2e/visual.spec.js` + baselines | the four static guides are baselined; a fifth should be |
| 16 | `.claude/rules/guide-pages.md` | its `paths:` globs **and** its per-guide section (this file) |
| 17 | `CLAUDE.md` + `AI_MAP.md` | file structure, same-commit rule |

Every row above was checked against the code, not assumed: `firestore-contract-parity.test.mjs`
reads `NAV_GUIDES` and the rules allowlist and compares them **both ways**; `e2e/calendar.spec.js`
drives each guide's drawer link and asserts the id it records; each guide page carries three
`noindex`/`color-scheme` metas; and the four guides that existed when this was written were visually baselined (two at
desktop 900, two at mobile 390 — pick the width that shows this page's densest state). The Rangers
guide has since joined them at mobile 390.

Note #10 and #12 specifically: the analytics open-id mapping has already produced a real defect class
(a substring match filed every Pay Calculator Guide open under the Staff Guide), and the register's
two-way contract is what stops a high-risk claim losing its source.

---

---

## Railcard guide

`railcard-guide.html` is an at-work quick reference for staff at the **gateline** and **ticket office**. Not a customer-facing page — judge every decision against "can a staff member glance at this mid-transaction and get the right answer fast?"

**Design principles — do not change without discussion:**
- **"For dummies" clarity over completeness.** Plain language; no jargon. If adding a fact makes the page harder to scan, leave it out.
- **Glanceable card layout.** One card per railcard. Rows: Save / When / Who (only where genuinely needed).
- **Colour stripe = Mon–Fri time rule only.** Green = any time. Amber = morning restriction. Red = Network (strictest). Do not repurpose these colours.
- **£ / ⊘ tokens in the When row.** £ = travel allowed, minimum fare applies. ⊘ = no discount before the cutoff. Both symbols defined in the key strip — keep both.
- **Weekend banner is deliberately simple.** Morning/min-fare limits usually don't apply at weekends — does NOT say all restrictions lift. Do not broaden it back.
- **Chiltern-specific callouts** (`rc-chiltern`) are amber banners inside the card — keep them.
- **Photo-check is a table, not prose.** The `.photo-table` inside check step 3 gives colour-coded rows by card type. Distinguish physical vs digital explicitly.
- **Selling essentials live in gotchas.** Minimum-fare mechanic, First Class eligibility per card, season-ticket exceptions. Do not move these to card rows.
- **Three-layer breakdown for "varies by route" time rules (v17.48).** Where a card's Mon–Fri cutoff is really a *local shortcut* for a national "morning-peak, off-peak-varies-by-route" rule, the card replaces its `.rc-chiltern` prose note with a `.rc-layers` block of three labelled rows — `.rc-layer-lbl official` (navy: the national rule) / `local` (amber: the Marylebone cutoff staff use) / `check` (red: what the retail system confirms). A single `.time-explainer` box near the top teaches the model once (with `.tl-tag` chips). **Applied ONLY to the genuinely-varies cards — Family & Friends, Senior, GroupSave.** Do NOT blanket every card with it: cards whose time IS fixed (Network 10:00, Gold Card 04:30–09:29) keep the simple note, and adding three layers everywhere would wreck the glanceable one-card scan the guide depends on. This is the durable fix for the root cause the v17.45 audit flagged (a local shortcut masquerading as a universal rule).

**What to care about:**
- Factual accuracy per card — verify against nationalrail.co.uk before changing any rule.
- Min-fare amounts (£12/£13) and the July/August waiver list (16-25, HM Forces, Veterans waived; 26-30 not waived) — reviewed annually; re-check each spring.
- Senior Railcard Chiltern note — must say "journeys within the Network area" not "all Marylebone services"; through journeys to Birmingham are different.
- Family & Friends — morning-peak restriction is on Network-area journeys only, not the whole card.
- Two Together photocard — **confirmed** (Jul 2026 research against the official Two Together T&Cs): a physically-printed Two Together Railcard bought at a station is issued with a **separate Two Together Photocard** (carrying both holders' photos) that must be carried and presented alongside the card, and both named holders must travel together. The guide wording was strengthened accordingly (was deliberately softened while unverified). Digital cards have no separate photocard.

**What not to flag as defects:**
- No JS modules — static page, intentional.
- Sticky header + sticky chip bar eating vertical space on small phones — acceptable trade-off.
- A–Z order with numeric cards first — intentional.

## FIP guide

`fip-guide.html` is a low-frequency educational reference — not a core workflow. Judge it as an
article-like reference page. Do not flag reference-page format as a design defect. Care about
factual accuracy, source links, mobile layout, and the navy/gold palette.

**Evidence is PER CARD, and there is deliberately no page-wide "last checked" date** (v20.25,
tightened v20.31). The page used to carry one — "these country cards were last reviewed Jul 2026" —
and a single date standing in for thirty-odd separate claims can only ever be wrong in one of two
directions: stale, or, the moment one card is re-verified, an over-claim covering every card nobody
looked at. Each country and ferry card therefore shows its own `✓ Checked <Mon> <Year> against Rail
Staff Travel` line and cites its own `data-guide-source` row. `guide-sources.test.mjs` enforces
three things: the date shown equals its register row's `Reviewed`; **every** country/ferry card
carries a line *and* an anchor; and the finder note makes no page-wide claim.

**Absence of a marker is a statement, so it must never be an accident.** The page tells readers an
undated card has not been re-verified. Between v20.25 and v20.30 the audit ran a card at a time and
eleven fully-sourced cards ended up with no line purely because of which pass had touched them — so
they were telling staff to trust them less than they deserved. Nothing rendered wrong, nothing
threw, and no behavioural test could see it; that is why the invariant is now structural.

**The country audit's standing rules** (established across v20.25–v20.32, all thirty-odd cards read
against their live Rail Staff Travel country page):

- **Never soften an unsourced claim — remove it.** Four survived years of review by sounding
  plausible: Denmark refusing SJ/Snälltåget night trains, Czech "ARRIVA vlaky and Trilex", Croatia
  bookable "via Trainseurope", Romania's "trains are slow". None is in the source.
- **But "I could not find it" is NOT "it is not published"** — the rule above has a failure mode, and
  v20.32 hit it hard enough to need an external review to catch. The guide's long-standing "you
  generally qualify after 12 months' service" was struck out, and the register was made to say the
  rule appeared in **no** RST source and must not be reinstated. It is published — plainly, under
  "When am I eligible for FIP cards and International Coupons?" on `/rst/faqs.html`, a page nobody
  had fetched. Three pages had been read *in full*, the term grepped across them, and an absence
  concluded from their silence. **A citation framework proves a claim has a source; it can never
  prove the search was complete**, so "nobody publishes this" is the one conclusion this register
  cannot safely reach on its own. Before recording an absence, enumerate the site's pages (the RST
  nav lists them) rather than the pages you happen to have open — and prefer "we could not find X"
  in the register over "X does not exist". Corrected v20.34; pinned by a test in
  `guide-sources.test.mjs` because it has now been wrong twice, in opposite directions.
- **"Private operator" is not the test for FIP validity** (v20.34, same review). The mental model the
  guide taught — private/low-cost operators are outside FIP — is wrong in both directions and the
  country audit itself disproved it: GySEV, Euskotren, the five Polish regionals and Switzerland's
  BLS are all in FIP. The operative rule is **check the undertaking**, with Italo/OUIGO/RegioJet/Leo
  Express as examples rather than as a category.
- **A country is not an undertaking.** Hungary has two (MÁV and GySEV), so does Spain (RENFE and
  Euskotren), Bosnia (ŽRS and ŽFBH) and Ireland (CIÉ and NIR); Poland has six. A card naming one
  operator reads as though the country has one, and coupons do not transfer between them.
- **Say which direction a rule bites.** Several countries treat the coupon and the FIP Card
  differently and it goes both ways — Denmark and the Netherlands favour the coupon, Czechia
  charges a supplement to a *leisure* coupon only.
- **Record a stated absence as an absence.** RST publishes no child-fare ages for Lithuania and no
  Swedish/Finnish undertaking exists; a blank reads as "no restriction".

**The booking-reach table** (`#booking-table`, v20.31) is the page's only table. It stacks below
560px via `data-label` generated content, and carries explicit `role="table"/"row"/"cell"` because
`display: block` strips a table's semantics from the accessibility tree. It must stay invisible to
the country finder, which selects `[id^="country-"]` — an id starting `country-` would let a search
hide the table that answers the question about that country.


### The Marylebone operational overhaul (v20.38)

The guide answered *"what are the Railcard rules?"*. It now answers *"somebody has shown me this
ticket at Marylebone — what actually matters?"*, and the difference is **three questions the old
page collapsed into one**:

| | Question | Whose rule |
|---|---|---|
| **A** | does the **discount** apply at this time? | the Railcard's |
| **B** | is the **ticket** valid on this train at all? | the ticket's |
| **C** | if something is wrong, what do we **do**? | Chiltern's |

Collapsing A into B produced the old legend — *"£ = travel OK, but a minimum fare applies"* — which
reads as though a Railcard settles whether somebody may travel. It does not; it settles the price.
Collapsing B into A produced invented Marylebone times (`~10:00`, `~09:30`) on Family & Friends and
Senior, which have **no Railcard time of their own at all**.

**Three kinds of morning rule, and they must stay visibly different.** No limit (16-17, Disabled) ·
minimum fare, which is *not* a ban (16-25, 26-30, HM Forces, Veterans) · fixed Railcard cutoff
(Two Together and Gold 09:30, Network 10:00) · follows-the-ticket (F&F, Senior, GroupSave). Rendering
the last kind with a clock time is what invented the shortcuts; `guide-sources.test.mjs` now fails on
an `around HH:MM` in those three cards.

**The Marylebone morning panel replaces the invented times with the real rule.** Deleting the local
layer would have left the fare-controlled cards saying nothing actionable, so instead the page prints
what those cards should have pointed at all along: Chiltern's own Off-Peak restriction, which is
**directional** — inbound must arrive after 10:00; outbound south of Banbury cannot depart
04:29–08:30; outbound to **Banbury and north has no morning restriction**. It is styled as a ticket
rule, not a railcard card, and says twice that the retail system is the authority.

### The Network boundary: how a "correction" turned out to be the error

The guide said the Network Railcard area ended after Banbury/Kings Sutton and was not valid for
Leamington, Warwick, Solihull or Birmingham. v20.38 set out to correct that, concluded the area
**does** reach Birmingham, rewrote the card, rewrote Family & Friends, Senior and the Gold
comparison to match, and pinned the new claim with a regression test.

**The original text was right.** It was caught because the owner asked *"surely it only goes up to
Banbury?"*

**The bad reasoning:** the railcard's area map has a machine-readable **station index**, and that
index lists Birmingham Moor Street and Snow Hill. But the map is the *London & the South East rail
services* map with the railcard area drawn on it as an overlay, so the index is the **map's** index,
not the boundary — a caveat that was identified, written down in the handback, and then leaned past
because the inference was convenient. The disproof is one line: **the same index lists Bristol,
Taunton, Weston-super-Mare and Exeter.**

**How it was actually settled.** The boundary IS in the PDF: a **41-vertex filled polygon**, drawn
immediately before the six `NETWORK RAILCARD AREA` labels, extractable from the content stream. Run
point-in-polygon against a rendered copy of the map and it gives a clean answer — **Banbury inside
and on the edge (it is the boundary station); Kings Sutton, Bicester, Oxford, Marylebone and Reading
inside; Leamington Spa, Warwick, Solihull, Coventry and Birmingham outside.** Bristol tests outside
too, which is the method checking itself against the very index that produced the error.

**Two lessons, and the second is the one that generalises.**

*Direction of failure.* "Not valid past Banbury" refuses valid tickets; "valid to Birmingham" accepts
invalid ones. On a revenue-facing page the second is worse, so a claim that loosens a restriction
needs **more** evidence than one that tightens it, not the same amount.

*A convenient inference is not evidence.* The caveat was already recorded; what failed was letting a
tidy conclusion outrank it. When a source nearly answers the question, state what it actually
establishes and mark the rest unsettled — and when the owner's operational knowledge contradicts a
fresh inference, the inference is the thing to re-examine first.

### The other error that shipped

**"16-17 Saver is digital only, a physical one is not genuine."** The official conditions describe a
physical Saver in six clauses. Both formats are genuine; the real constraint is that it is **not sold
at stations**. Pinned and teeth-verified, along with the removal of the 28-day forgotten-Railcard
deadline (Chiltern's Charter says one claim per 12 months and states no deadline) and of every
appearance-based check.

### Never ask staff to judge how somebody looks

`age looks right`, `eligibility looks right` and the physical-card row telling staff to check that a
Disabled Persons holder's *"age/eligibility looks right"* are **removed, not softened**. The rule is
wrong on four products — 16-25 and 26-30 both stay valid past their upper age (the terms say so
verbatim), the Saver will from 17 August 2026, and Family & Friends keeps discounting a child who
turns 16 mid-card — and on the Disabled Persons Railcard it asks for a judgement no gateline should
make. **The card is the evidence.** The guard also requires the page to say so positively: dropping
the instruction silently would leave the habit in place.

### Two suspected conflicts that were investigated and found NOT to be conflicts

Both were a clause read outside its scope, and recording either would have logged a dispute that does
not exist — sending the next reader to re-read a page that already agrees.

- **Gold Card First Class.** The generic ticket-conditions text reads *"…Network Railcard: 1/3 off and
  Senior Railcard: 1/3 off **on Standard**. Other discount cards: Gold Cards: 1/3 off…"*. **"on
  Standard" binds to Senior**; Gold sits in a separate sentence with no class qualifier, and its own
  page says Standard *and* First twice.
- **Chiltern's "£13 at all times".** Read alone it contradicts RDG's Mon–Fri minimum. Its table's own
  preamble is *"Restrictions listed below are applicable Monday–Friday (excluding bank holidays)"*.

**Check the scope of a clause before recording a Conflict.** Two of the three candidates in this
audit dissolved on that check.

### Network easements exist, and none of them is ours

The railcard publishes a list of ~86 origin stations that may use the discount before 10:00 on a
named service. **No Chiltern service and no Marylebone-route station is on it** — the one "Oxford"
row is a *Great Western* service to Paddington. So the guide says 10:00 has no exception here, which
is more useful than "easements may apply": the latter invites a staff member to wonder whether one
applies at this gateline.

### A correction callout may quote the old wrong wording — if it negates it

`.rc-correction` blocks are the one place the banned phrasing may appear, because a staff member who
learned "not valid past Banbury" from this page needs to be told in those words that it was wrong.
The "must not say" guards therefore skip those blocks — and a separate test fails if any correction
block lacks an explicit negation, so the class cannot become somewhere to park a live claim. The
exemption is **earned, not granted by the class name**.

## Rangers & Rovers guide (v20.05)

`rangers-guide.html` — the ranger and rover area passes staff accept or refuse at the gateline. A
sibling of the railcard guide and deliberately a **dialect of it**, not a new language: the colour
stripe (green = any time, amber = a morning bar), the `⊘` token, the card/row rhythm and the amber
Chiltern callout mean here exactly what they mean there. The two pages are read by the same people
minutes apart; a second vocabulary would slow both down.

### It answers the MARYLEBONE question first (v20.37)

The page used to lead with "is Chiltern a participating operator?" and print that as each card's
primary status. That is the wrong question at this gateline, and the page proved it: the **West
Midlands Day Ranger** read `On us? ✓ Yes` while being unusable at Marylebone — its area stops at
Leamington Spa. The staff member had to open the card and read four rows down to find that out, at a
barrier, with somebody waiting.

So every card now carries **two states, and neither can be inferred from the other**:

| Attribute | Values | Rendered as |
|---|---|---|
| `data-myb-validity` | `yes` · `no` · `conflict` · `unconfirmed` | `.myb-status` badge in the left half of `.rr-status-grid` |
| `data-chiltern-validity` | `yes` · `no` · `conflict` · `unconfirmed` | `.ch-status` badge in the right half |

**`unconfirmed` is not a milder `conflict`, and the badge proves how easily that is forgotten.** The
page has said since v20.10 that a Conflict is not a stronger Draft — and the badges shipped, *in the
release that wrote the two-dimension rule down*, with the Shakespeare card reading `⚠ Conflict` over
a product that has **no readable page at all**. The rule had only ever been enforced on the card
pill, and the badge is what a reader now looks at. So: `conflict` takes RED (matching
`pill-conflict`), `unconfirmed` takes AMBER (matching `pill-draft`), and
`guide-sources.test.mjs` fails if an unconfirmed product wears a conflict badge **or** if the two are
styled identically. Red beside the red `⊘ Not valid` is deliberate — those two are separated by the
word and the `⚠`/`⊘` token, never by hue.

`✓ Area only` on the Chiltern side is the whole point of the split: a real ticket on our network that
is no use from London. **The three top-level sections are that pair**, not a product taxonomy —
*Valid at Marylebone* → *Valid on Chiltern but not at Marylebone* → *Not valid on Chiltern at all* —
so the answer is the section heading and the badges only confirm it.

`guide-sources.test.mjs` pins this: both attributes declared on every card, values constrained,
Marylebone never merely copied from Chiltern, an `MYB ✓` obliged to state its scope, and each status
carried by **words** as well as colour. The failure mode is silent — a wrong badge renders perfectly —
and it is the exact defect this restructure was commissioned to fix.

### Evidence is per CLAIM, not per card (v20.37)

Two products carried a whole-card `Conflict` for a disagreement affecting one line of them
(Shakespeare's break of journey; who operates the Thames 7-Day area). That is the page-wide banner's
failure one level down: a reader cannot tell which line is doubtful, so they distrust the eight facts
that are sound or miss the one that is not. A disputed claim now takes its **own** `data-guide-source`
id and its own `.rr-unresolved` callout, and the card keeps whatever state its own sourcing earned.
The register test accepts a card-level marker **or** a claim-level one.

The same pass split `rr-shakespeare` into `-core` (**Draft** — no current page exists, which is an
absence, not a disagreement) and `-boj` (**Conflict**), and `rr-thames-7` into `-geography`
(**National** — settled) and `-operator` (**Conflict**).

### State a BOUNDARY, not a station list (v20.37)

Four cards named "its Chiltern stations" as an exhaustive set. That is a claim about the
**intersection** of the ticket's area with Chiltern's network, and only the first of those two is
sourceable from the product page — so the lists were wrong in both directions at once (the West
Midlands pair omitted eight Chiltern-served stations; Oxfordshire and Thames 7-Day omitted **Oxford**,
which is in both areas and which we call at). What the applicable-station list *does* prove is where
the area **stops**, which is the only part a Marylebone gateline acts on. Prefer "reaches Leamington
Spa and stops — Banbury is outside it" over any enumeration. Name a station individually only for a
genuine near-miss whose neighbour differs: *Bicester Village but not Bicester North*, *Oxford but not
Oxford Parkway*.

### A rule that belongs to a CLASS does not go on one card (v20.37)

"A Rover may not be issued more than 3 days ahead (5 by telesales/internet)" sat on the All Line Rover
card under a ✓ pill. It is true, but it is on the **Rover ticket pages** (`he7`, `s37`) and not on
that promotion page at all — so the card claimed a class rule as its own, the register cited a page
that does not state it, and a reader holding a Heart of England Rover learned nothing. It is now one
entry in "How to check one" (`rr-advance-sale`), cited where it was read, and explicitly scoped to
Rovers — the `ce1` Discoverer page carries a different limit. Ask of any new fact: *is this true of
this product, or of its class?*

**Its evidence state is PER PRODUCT, and there are three of them** (v20.10, owner). It shipped at
v20.05 entirely Draft — content assembled from public summaries, because the National Rail pages are
unreachable from the build environment. The owner has since checked the products directly against
the live pages (Aug 2026), and keeping the page-wide banner after that was misleading in the *other*
direction: eight well-sourced products and two contradictory ones presented as equally uncertain, so
a reader could no longer tell which was which.

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
Chiltern; the older TR3/TR7 formal page says GWR only — and the 3-Day promotion lists GWR only, so
the two durations must never be merged into one card). Report both readings and say what to do
meanwhile.

**The `✓ checked` pill's green is DARKER than the page's `--green` token, and that is measured.**
The token on its own 10% tint comes to **4.49:1** — under the AA floor by 0.01. The axe gate caught
it; nobody reviewing the page would have. It is the clearest case for keeping that gate blocking:
a contrast miss this small is invisible and just as failing as a large one. Re-measure if either
value moves.

`guide-sources.test.mjs` enforces all of it: the class set, a per-class card marker on every anchored
block, a banner that names every state actually present, and — because a classification with no
reasoning is unactionable — that every Conflict row's claim text describes **both** readings.

**To settle a product:** re-check it at source *and* in the retail system, then flip its row and drop
its marker. The banner goes when the last provisional row does.

**Design decisions** (argued here since the plan was retired, when `RANGERS_ROVERS_PLAN.md` was retired into
`ROADMAP_HISTORY.md` (2 Sep 2026); the reasoning below was always written out in this file rather than merely
cited, which is what made the plan safe to retire):

- **It leads with "usually no" — but the five are a SHORTLIST, never a rule of exclusion** (v20.08,
  external review). ~90 products exist nationally and a handful touch Chiltern, so a page that opens
  with a long list makes the common case slow and the rare case ambiguous — a staff member who cannot
  find the ticket in their hand cannot tell *not valid* from *not listed*. That is still the right
  layout. What shipped with it was an inference: "if it is not one of these five, the answer is
  almost certainly no", and the review named three more products reported to reach us. Of the two
  failures available at a gateline, refusing a valid pass is the worse one and the only one this page
  can cause. **Not on the list means CHECK.** Step 1 of "How to check one" routes there, and the
  three reported products are named under `#rr-reported` with **no rules attached** — a card states
  days, area, time bars and break of journey, and each is a rule a passenger could be refused travel
  by, i.e. exactly what the A/B evidence gate covers.
- **An unresolved rule is rendered as unresolved, and it does not wear the amber Chiltern callout**
  (`.rr-unresolved`, red). Amber means "here is the local answer no national page gives" — something
  to act on. A rule whose published wording contradicts itself is the opposite. Two live cases: the
  Shakespeare Explorer break of journey, and which operators the Cotswolds Discoverer names (the
  Chiltern answer there does not depend on it, so the refusal stands and the list is not quoted).
- **The near-misses section is the point of the page**, not an appendix. Cotswolds Discoverer and
  Freedom of Severn & Solent both reach stations on our map and are not valid on us; saying so quickly
  is the answer no national page gives.
- **No prices, ever.** Re-set annually and three-way variable; a stale one is a mis-sell. Deliberately
  stricter than the railcard guide's two min-fare figures.
- **The date box gets the `.gotcha`.** It is the only ranger/rover rule a gateline can enforce by
  looking, and the one most likely to be unknown.
- **A list of things we have NOT checked must not wear the "valid" tick** (`.quick-list--unchecked`,
  v20.09). The three reported-but-unwritten-up products reused `.quick-list`, which draws a green ✓ —
  the token the key strip at the top of the page defines as *valid on Chiltern* — directly beneath a
  paragraph saying there is not enough behind them to state a rule. On a page whose entire risk model
  is not over-claiming, the marker was making the claim the prose refused to. They now carry an amber
  `?`, the same token their own heading uses.
