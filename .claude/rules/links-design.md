---
paths:
  - "links.html"
  - "links.css"
  - "links-*.js"
  - "links-*.test.mjs"
---

# Links workspace — full architecture

**This is the authoritative contract for the Links workspace.** Other documents link here rather
than restating grid, generator, coverage, fatigue, concurrency or deletion rules.
`LINKS_DEC2026_PLAN.md` holds the December 2026 project context. The reasoning behind most rules is
in the module header beside the code, and this file points there rather than copying it.

**The workspace builds and judges proposals. It decides nothing.** S. Silva, the RMT rep, leads the
December 2026 roster change and makes the final call (`LINKS_DEC2026_PLAN.md` → Who leads). Nothing
on the page, and nothing written here, may suggest that the owner or the admin decides which link
is used.

**The `paths:` list above uses GLOBS, and must stay that way.** A list of filenames stops covering
the modules added after it, and nothing says so.

**Read the module header before changing any rule.** Most rules here exist because something
shipped wrong once, and the header says how.

## What is in this file

| Where | What |
|---|---|
| **Invariants** | the short list, for someone about to change something |
| **The module set · Access control · Deletion** | every module, who may read or write a design, and the permanent bin |
| **The page** | the orientation panel, unsaved work, and use on a phone |
| **Design and save model** | the Firestore shape, the masthead, compare mode, the grid, paint mode, the operating window, the heat map, the summary bar, the empty states |
| **Design checks** | the first half, **hard limits** (meet or cannot run), **fatigue factors** (advisory, never pass/fail), and hours a week |
| **The generator** | the default table and the seed, the rest gate, saved setups, the two constructions, line order, Sunday, its copy and its layout |
| **The rest** | line numbering, concurrency, print, sticky headers |

## Invariants

The short list, for someone about to change something. Each states WHAT must hold; the WHY is below,
or in the module header beside the code.

| # | Invariant | Where it lives |
|---|---|---|
| 1 | **The rotation length is declared once and stated nowhere else** — no literal in code, strings or markup (the parity test), and no comment or prose giving the CURRENT length as a fact (held by hand: the test strips comments, because a comment may record history — a dated release, a past length). A literal is one more copy waiting to drift. | `links-design.js` (`ROTATING_LINES`) · `links-rotation-parity.test.mjs` |
| 2 | **A hard limit and a fatigue factor are opposite kinds of statement.** Separate modules, separate counts, separate sections. Fatigue factors report what is PRESENT; they never pass or fail a design, and nothing here may read as a certificate. | `links-limits.js` · `links-fatigue.js` |
| 3 | **Every fatigue rule laps the rotation.** Somebody on the last line goes to the first next week. | `links-fatigue.js` |
| 4 | **The generator REFUSES what it cannot repair.** Reporting a shortfall is not refusing it — a design that exists gets saved, compared, printed and taken into a room. | `links-design.js` (`repairShortRest`) · `links-contract.test.mjs` |
| 5 | **A failed read-back flags the baseline UNKNOWN, never merely null.** Every co-editing bug here has been a SILENT overwrite of a colleague's work, discovered only on reopening. | `links-design-store.js` · `links-concurrency.js` |
| 6 | **An import becomes a design or a refusal, never a half-design.** An unreadable cell is refused BY NAME, never defaulted to a rest day — an import that "succeeds" four duties light reads as a lighter week, and every panel then reports confidently about it. A row of empty cells is an empty week IN ITS PLACE, never a line skipped: skipping one moved every later week up a line. | `links-import.js` |
| 7 | **The days-worked divisor is the WORKING lines, not the rotation** — unlike the hours average beside it. | `links-design.js` (`lineTotals`) |
| 8 | **Reordering is free with respect to coverage**, so the line-order objectives compete only with each other. | `links-adjacency.js` |
| 9 | **A saved target set (a staffing setup) is refused whole or loaded whole**, and the client's ownership check only decides what is OFFERED — the rules are the protection. | `links-target-sets.js` · `firestore.rules` |
| 10 | **Every class an analysis panel emits must exist in `links.css`**, and any section claiming a limit must name whose requirement it is. | `links-analysis.js` · `links-analysis.test.mjs` |

## The module set

The workspace is one coordinator over the pure or extracted modules below. Everything except
`links-app.js` is testable without a browser, and that is deliberate: the rules that have produced
bugs were pulled out of the coordinator, which keeps most of the Firestore and DOM state (the design
library keeps its own). One-line routing is `FILE_INDEX.md`; the export lists are `AI_MAP.md`.
**The table is the count** — do not write a number beside it, because that is a second copy of the
list.

| Module | Owns |
|--------|------|
| `links-app.js` | coordinator: grid, paint, dialogs, dirty state. It makes no Firestore write of its own — designs go through `links-design-store.js` — and one direct read remains, `loadDesigns`, which needs `metadata.fromCache` (+ `links-boot.js`, the CSP bootstrap) |
| `links-design-store.js` | a design's PERSISTENCE lifecycle and the concurrency protocol — every design write, and the refresh's read (`createDesignStore`) |
| `links-design-library.js` | the import panel, the Recently deleted bin and its list, and Keep only the shortlist (`createDesignLibrary`). Rename, duplicate and delete stay in `links-app.js`, because they change the open design's baseline |
| `links-design-header.js` | the design MASTHEAD — which design, whose, saved? — the picker sheet, the Save buttons' label and the ··· More sheet |
| `links-design.js` | the design maths — classification, coverage, hours, the generator and its rest repair, `runDesignChecks`, `endMinutesAbs` |
| `links-fatigue.js` | the ORR p3 fatigue factors — ADVISORY, never pass/fail |
| `links-limits.js` | the HARD limits — meet them or the design cannot be run |
| `links-window.js` | the staffed OPERATING WINDOW — when the station is open |
| `links-demand.js` | the SERVICE that window has to cover — the December 2026 trains |
| `links-analysis.js` | the read-only panels — Coverage heat map, Design checks and the sticky summary strip — rendered from those pure results |
| `links-grid-input.js` | how the grid is OPERATED — one Tab stop and the arrow keys, a mouse stroke that paints every cell it crosses, the paint bar's height for the sticky header; what a cell MEANS stays in the coordinator |
| `links-compare.js` | compare mode; sole owner of `compareMode`/`compareDesignId` |
| `links-compare-analysis.js` | what the difference between two designs MEANS — cover, limits and fatigue for both (pure, `compareDesigns`) |
| `links-concurrency.js` | the pure co-editing rules (three historical silent-overwrite bugs, one test each) |
| `links-deletion.js` | the soft-delete rules: what counts as deleted, its label and order, and what a delete or a rename that found the design already gone says |
| `links-adjacency.js` | what happens BETWEEN the lines — the ORDER they sit in |
| `links-seed.js` | the roster SEED — read today's main cycle and produce a target table |
| `links-design-doc.js` | the SHAPE of a design in memory and in Firestore, and every conversion between them |
| `links-design-naming.js` | what a design or a staffing setup may be CALLED — one rule for new, import, duplicate and rename |
| `links-target-hours.js` | does a target table pay the contract, and the words the card says so in |
| `links-import.js` | somebody ELSE's proposal → a design, or a refusal — the TRUST BOUNDARY (invariant 6) |
| `links-target-sets.js` | named, shared SNAPSHOTS of the generator targets (staffing setups), and who may overwrite one (invariant 9) |
| `links-target-sets-store.js` | the Firestore half of those setups — reading the collection, and the one guarded write |
| `links-generator-targets.js` | the numbers the generator runs against, where they came from, and what may replace them; it writes a new setup itself |
| `links-default-targets.js` | the table the generator STARTS from — the duty table of Short Run, in the pack (built in until 8 Nov 2026); not measured from today's roster |
| `links-proposals.js` | the SHORTLISTED designs, built in as read-only proposals — a proposal id never reaches Firestore |
| `links-shortlist.js` | "Keep only the shortlist" — the admin's one press that moves every design last saved before `OLDER_BEFORE` to the bin; the built-in shortlist stays read-only |
| `links-tips.js` | `CARD_TIPS` for the page's `?` panels (pure data) |

## Access control

- The `NAV_PAGES` entry has `linksDesignerOnly: true`, and `initNavPanel({ isLinksDesigner })` drops
  the pill for anyone else. Every coordinator derives `isLinksDesigner` from `CONFIG.LINKS_DESIGNERS`;
  `links-app.js` passes `true`, because its page gate (`requirePage(…, 'links')`, `auth-policy.js`)
  has already decided — signed out gets the shared in-place sign-in, and a signed-in non-designer is
  sent to `admin.html`.
- **Granting access takes three steps, or the new designer can open the page and save nothing.**
  (1) Add the name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` — that decides what the nav and the
  page gate show, and nothing else. (2) Run `npm run generate:roster-members` in the same commit: the
  `linksDesigner` CLAIM comes from the server-owned `functions/roster-members.json`, and
  `sw-asset-check.test.mjs` fails if the two drift. (3) After the deploy, run **Operations → Set up
  accounts**, which is what mints the claim. Until then every save permission-denies: `writeWithClaimRetry`
  refreshes the token, and a refresh cannot invent a claim the server never set.
- **Server side, the real control:** `linkDesigns` writes need the `linksDesigner` or `admin` claim.
  Reads need a bound member identity or the admin (`isMember()`) — a session that has really signed in
  as a member, never merely `request.auth != null`, which an anonymous session satisfies. Reads are
  deliberately NOT gated on `linksDesigner`: a designer whose token predates the claim has to be able
  to LOAD the page for the write self-heal to get its chance. `linkTargetSets` reads the same way.

## Deletion — a permanent bin

- **Delete is a soft delete.** *Delete this design* writes `deletedAt`/`deletedBy` as a MERGE — a
  replace would push the deleting device's copy of `patterns` over the server's — inside a transaction
  that asks first. Over a design a colleague has already binned it writes nothing, so the bin keeps who
  deleted it; over one removed for good it writes nothing at all. Otherwise the design moves
  to **🗑 Recently deleted**. Restore clears both fields with `deleteField()`, bumps the revision and
  stamps `updatedAt`, so a restored design counts as saved now for every date rule below. The decisions
  are pure in `links-deletion.js`; the Firestore calls are `links-design-store.js`; the panel is
  `links-design-library.js`.
- **The bin is PERMANENT** (owner, 19 Sep 2026). Nothing expires a design, and the expiry machinery was
  deleted rather than left dormant; `links-deletion.js`'s header has the argument. **A countdown in copy
  is a promise**: show none. If expiry is ever wanted, it is a scheduled Cloud Function reading SERVER
  time, never a client clock (KNOWN_LIMITATIONS.md → Links).
- **`isDeleted` tests for the KEY, not a usable timestamp.** An unresolved `deletedAt` — what
  `serverTimestamp()` reads back as on the writing device — still counts as deleted, or the design
  sits in the picker on the device that just binned it.
- **Delete is disabled on an unsaved design, and on nothing else.** The last saved design can be
  deleted too (whole-app fix, Nov 2026 — links-app-23): the picker always carries the shortlisted
  proposals, so deleting it opens the first of them, as Keep only the shortlist does, and the line
  says so. The refusal it replaced (`canSoftDelete`) guarded an empty picker that can no longer occur.
- **A save against a design someone else deleted does not resurrect it.** The store reports
  `deleted-elsewhere` and `saveChanges` offers "Save mine as new" — an overwrite would undo a
  colleague's delete without either of them seeing it.
- **"Remove for good" re-reads the server inside a TRANSACTION** (the store's `purge`), so a design a
  colleague restored since the bin was opened is spared, and the bin says so and refreshes rather than
  offering a retry. `firestore.rules` also requires `deletedAt` for a hard delete, so a client with that
  bug can only fail.

## The page

### No beta marker (owner decision)

Owner decision, Aug 2026: the workspace is the tool the December 2026 proposals are built and judged
in, not a sketch, so it carries no beta marker. `.header-end` stays — it is the flex wrapper the page
badge lives in.

### The orientation panel

`#linksWelcomeLb` (`createLightbox`) holds the three things a newcomer cannot work out from the
screen: changes affect the link-design document only, never the live roster (best on a desktop or
tablet); the Design checks report which ORR fatigue factors a pattern features, and approve nothing;
designs are shared, and a deleted one stays in Recently deleted until someone removes it for good.
The reasoning is the comment above its block in `links-app.js`.

- **It opens on a device's first visit and never expires.** `isNoticeExpired` marks a notice seen
  without showing it — right for an announcement, wrong for orientation, whose audience is whoever
  arrives next. **Do not add an expiry.** It is gated on `myb_links_welcome_seen` (the older beta key is
  left on devices as an inert flag), and the announcement half is archived once, on the first close.
  A first-visit open goes through `openNoticeIfClear`.
- **`#linksHowBtn` reopens it, as a row in the About panel** beside 🔧 Operations and 🐛 Report a bug,
  sharing their class. It is not a control of its own: as one it read as foreign wherever it was tried,
  because no other page has a standalone help control. The header is no place for it either: its title
  takes whatever the burger and the page badge leave and ellipses at phone width, so a control there
  would come out of the title (`css-tokens.md` → "The sub-page header is a flex row").
- **It closes the About panel before opening.** Two overlays open together share one Escape, and the
  buried one is archived and flagged seen by someone who never read it.

### Every way of losing unsaved work asks first

While `dirty`, each of these asks before it acts: New blank design; switching design, opening a
proposal included; Import; Delete; Save a copy as…; Build the link (Generate) over a drawn design or an
edited proposal; Keep only the shortlist; leaving by a drawer link, the logo or the About panel's
Operations link (`beforeunload` covers the rest, where the browser shows it); signing out
(`askBeforeSignOut`, which also warns while a write may still be on its way); and reloading for an app
update. **A new path that replaces or discards the working copy joins this list, with its question.**
Anything that ends in `_activateDesign` is such a path.

**And the exits nothing can ask about keep a copy** (iPhone audit, Nov 2026): iOS discarding a hidden
page, a swipe back or away. While `dirty`, hiding the page keeps the working copy, its window and the
concurrency baseline it was edited against (`keepDraftWhenHidden`, page-session.js); the next load by
the SAME designer asks "Restore your unsaved changes from 14:20?" (`unsaved-draft.js`). Restore puts it
back UNSAVED on its own design, so a colleague's save since still meets "Someone else saved"; a design
gone from the list comes back as a new one; nothing is offered over a failed load. An answered leave or
sign-out keeps nothing — it was a discard. This is why the app-update question no longer says the work
"will be lost".

**Save a copy as… is worded differently, on purpose.** The copy is taken from the LIVE patterns, so
unsaved work goes INTO it and the original reverts to its last save; "changes will be lost" would warn
about the wrong outcome. The surprise to head off is the opposite one — duplicating to snapshot the
work and carrying on in the ORIGINAL. An e2e pins both halves, including that the lossy sentence is
not used. An answered question does not get the browser's own "Leave site?" as well.

### The workspace is used on a PHONE as well as a desktop (owner, Sep 2026)

A grid of every line by seven days, a generator with a slot table and two designs in compare mode all
read as desktop work. They are also done on a phone, so a change is not finished when it looks right
at 1280.

- **The paint chips are the primary control**, and on a coarse pointer they are `min-height: 30px` —
  gated on the POINTER, not the width (`css-tokens.md`).
- **A guard that walks every page has to reach each page's real working state.** The tap-target gate
  (`no control has a tap target under 24px`, `e2e/pages.spec.js`) seeds a design: Links with none
  renders the empty state, with no grid and no chips, and once passed by having nothing to measure.
- The page does not scroll sideways at 390px in any state, and compare mode stacks its two grids,
  each scrolling inside its own wrapper.
- **Accepted phone constraints** (KNOWN_LIMITATIONS.md → Links): below 768px the grid and the
  generator table lose their sticky headers (Sticky headers, below), and the sticky save row and the
  brush bar take a large share of the screen. Two further trims were costed and refused: hiding
  `.links-save-meta` below 1024px — who last saved a SHARED design, and when, is exactly what you want
  while editing on a phone — and shortening "staffed hours with trains and nobody on", which this file
  forbids softening.
- **Do not design against the iPhone SE** (owner, Sep 2026): no designer has a device that narrow, so a
  320px column in any measurement here is hypothetical.

## Design and save model

### Card order

Grid (the primary object) → Auto-generator (collapsed by default) → Coverage (the hourly heat map) →
Design checks. The generator sits under the grid because it is the main way to make a new design; New
blank design, Import and Save a copy as… are the others, and the shortlisted proposals are built in.

### Firestore model

`linkDesigns` is a collection of named design documents `{ name, patterns, window, revision,
updatedAt, updatedBy }`, plus `deletedAt`/`deletedBy` while binned, with auto-ids.

- **`docPayload` emits the five content keys; the store adds `revision`, the soft delete adds
  `deletedAt`/`deletedBy`, and every key must be in the rules' `hasOnly` list.** An extra key does not
  warn: every save permission-denies on every device until the rules catch up, and hosting and rules
  ship from one push through separate workflows with no ordering guarantee — so rules go first.
- **The legacy singleton `linkDesigns/combined-28`** (`LEGACY_DOC_ID`, no `name`) migrates to a named
  design only in a collection that has never held a design, live OR binned. It is never deleted, so
  that gate is all that keeps the migration one-time: never write to it, and never loosen the gate to
  "no live design", which re-migrates it every time the bin holds everything.

**Every doc ↔ object conversion is `links-design-doc.js`**, because a field left out at one site is not
an error — it is a design that quietly loses something. Its three rules:

- **Every shape carries `window`.** The heat map measures gaps against it, so a design that loses it is
  assessed against a span nobody chose.
- **Everything arriving FROM Firestore is canonicalised (`normalisePatterns`); nothing already in memory
  is re-normalised.** The asymmetry is deliberate.
- **The working copy DEEP copies its patterns.** The grid writes `patterns[pos][day]`, so a shallow copy
  would let an edit mutate the `designs[]` entry the concurrency baseline is compared against. It
  carries no `updatedAt`/`updatedBy` either: those describe the SAVED document.

### The masthead and the picker

`links-design-header.js`. Its header holds the four rules an edit can break: the picker is a sheet of
buttons, not a `<select>`; designs are grouped by LAST SAVER, your own first, newest first; an unsaved
design has no name until its first save; and the list is rebuilt only when its content changes.

- The heading-sized face is a button that opens the picker sheet: **Shortlisted proposals** first, then
  **Last saved by you**, then **Last saved by …** for each colleague. The labels say "last saved by",
  not "owned by", because a design moves group when a colleague saves it. The open design is tinted
  and ticked.
- **Both sheets (the picker and ··· More) are `createLightbox` dialogs of plain buttons; do not
  hand-roll either lifecycle.**
- Beside the face: the initials badge and "Last saved by", the status pill (`statusCopy`), ONE primary
  Save, and **··· More** — Save a copy as…, Rename, Compare with…, New blank design, Import from a
  spreadsheet, Keep only the shortlist (the admin's, while an older design exists), Recently deleted
  (only when the bin holds something) and Delete this design (disabled on an unsaved design). Rename
  also has its own ✎ beside the face.
- **A design fresh from the generator has NO NAME until its first save**: the face reads "Untitled
  design" and the button "Save as…", whose prompt pre-fills `proposeNewDesignName`. `saveButtonLabel`
  owns the button's words; do not write them at the call sites.
- The open design or proposal persists via `lsGet('myb_links_active_design')`.
- Compare-with still uses chips (`#compareChips`) — a `<div>` wrapping separate `<button>`s. **Buttons
  must not nest.**

### Compare mode

**The strip above the grids does the comparison; the grids evidence it.** It states how many cells
differ and **across how many lines** — eighteen cells on one line and eighteen across six are
different proposals — then the figures a choice turns on: hours a week excluding Sunday, full weekends
off, rest under 12 hours, and ORR factors present. Each comes from the same pure function the
single-design panels call, so the two views cannot report one design two ways, and **it scores
nothing** — `A → B`, and the reader decides.

- **An UNCHANGED figure still renders, muted.** Showing only what moved would leave "identical"
  indistinguishable from "not measured", this app's most repeated defect.
- **"Show only the lines that differ" hides rows and changes no figure.** While it is on, the strip says
  that every figure still covers the whole design.
- **Under the strip, what the difference MEANS** (`compareDesigns` in `links-compare-analysis.js`,
  rendered by `renderAnalysis`): against the service (hours with trains and nobody on, each design read
  against its OWN window, and people on at each day's busiest hour), the hard limits, and the fatigue
  factors (the findings that change; the ones whose figure moved; the ones present in both, named; the
  rest counted). Nothing is scored, and nothing may be stated more strongly than the Design checks card
  states it: the **weekday** busiest-hour row is the FEWEST on duty across Mon–Fri, naming the day; a
  moved factor carries its threshold, its "(definition to confirm)" flag and a floor note where hours
  are a floor; and the limit heading is `LIMIT_CLAIM`, derived from `POLICY_SOURCE_CONFIRMED`, never
  typed. A window edit made in compare mode re-renders it.
- **The compare cells are `<span>`, not `<button>`.** They cannot be operated (`.links-grid--compare`
  sets `pointer-events: none`), and as buttons they announced hundreds of dead controls to a screen
  reader. The class stays; it carries the shift colouring.
- **Both windows are always stated** — compare diffs cells, not windows (The staffed operating window,
  below).
- With two or more designs: two read-only grids side by side from 1024px and stacked below, gold
  outlines on differing cells, and the two columns kept on the same day as either scrolls. The outline
  is the DARK gold, `--gold-text`, at 5.4:1 or more on every cell fill: the brand gold measured
  1.2–1.4:1, under the 3:1 a marker needs. Each column keeps `overflow-x: auto`. The main grid stays **rendered** in compare mode, hidden on screen only
  (`body.links-compare-on` inside `@media screen`), so print always outputs the active design;
  `#printDesignName` names the sheet.

### patterns data shape

`patterns` is `{ "1"…"<ROTATING_LINES>": { sun, mon, tue, wed, thu, fri, sat } }`, each value a shift
string, `"SPARE"` or `"RD"`. **Position keys are always `String(pos)`, never `Number`.**

Designs are patterns only ("Line 1", "Line 2"…): who works which line is decided after the patterns are
agreed. A legacy `meta` field is ignored on load and dropped on the next save.

### The design maths

All design maths live in `links-design.js` — no DOM, no Firebase and **no imports at all**, not even
`roster-data.js`, so it loads anywhere. That is why `classifyShift`'s Early/Late/Night boundaries are
literals, tied to CONFIG by a parity test in `links-design.test.mjs`. `links-app.js` imports the maths;
**do not duplicate any of it back into the coordinator.** The export list is `AI_MAP.md`'s, not this
file's.

### Save and dirty flag

One `dirty` flag and one `saveChanges()`, reached from TWO buttons — `#linksSaveBtnTop` in the
masthead and `#linksSaveBtn` in the sticky row — which share one label and one state, so a designer
deep in the grid never scrolls to save. Grid clicks are **delegated** on `#linksGridBodyRows`; do NOT
call `renderGrid()` from inside `saveChanges()`.

**Leaving with unsaved work:** `beforeunload` (`warnOnUnload`), plus the shared async `confirmDialog`
on sign-out and the header logo, and `askBeforeLeavingByDrawer` (page-session.js) on the drawer's links
and the About panel's, Operations among them — mobile browsers suppress `beforeunload` dialogs. The
dialog is async, so it calls `preventDefault()` first and, on "Leave", clicks the link again with itself
stood aside, so the drawer's own handling still runs (a guide learns `?from=links.html`).

**An app update waits** (`beforeReload` in `links-app.js`): while a write's outcome is unknown it is
held outright, and with unsaved changes it asks first (AUTH_AND_SESSIONS 22) — saying the work is
kept, because the reload's hide keeps the copy above.

### Aesthetic conventions

- **A brush chip shows BOTH times, on two lines, exactly like the grid cell it paints.** Several shifts
  share a start time, so start-only chips are pairs of identical chips that paint different shifts. Do
  not "tidy" this back to one time. A chip's accessible name is `cellName`'s — what it shows, then what
  it stands for.
- **The masthead is always visible**, even with no designs: the empty state points at the ··· More
  sheet, where New blank design and Recently deleted live.
- **`.design-chips` (now only the compare-with picker) uses `min-width: min-content`, not `0`** — `0`
  lets a flex item shrink below its own `nowrap` contents.
- **An overlay panel takes its surface from an id rule or a modifier class.** `.lb-content` alone is
  only transform, scroll and cursor, and a panel with the bare class renders as a transparent box. The
  Recently deleted panel has a visual baseline because behaviour tests cannot see this.
- **Row actions reuse `.dialog-btn` + `.dialog-btn-confirm`/`-cancel`** from shared.css, which brings
  the 44px target and the press feedback with them.
- **The Design checks card is a long list, so it needs structure, not just rows.** `.check-section-head`
  carries a hairline rule and the section's headline counts at the far end
  (`N present · N standing · N to confirm · N clear · N not applicable`), so nobody has to tally icons;
  `.check-code` is a fixed-width tag, so the FF codes align down the left edge for cross-referencing the
  ORR's own list;
  and `.check-family` names the ORR's families, with the factors in number order within each. The
  counts keep `present` and `standing` apart — an unavoidable characteristic of the operation is not a
  finding about the design — and `clear` and `not applicable` apart (NOT-APPLICABLE ≠ CLEAR, under
  Fatigue factors below).
- **`.check-code` is a fixed `width`, never `min-width`.** A minimum let a wider code push its title out
  of line. CSS cannot stop a code outgrowing the width, so `links-analysis.test.mjs` asserts that none
  does, and that the declaration is still `width`.
- **The "nothing to report" disclosure's body carries a left rule.** The panel groups by family and then
  splits by status, so a family can render its heading twice, and without a nesting cue the second
  reads as a repeat. The print block resets the rule and the indent, because print flattens the
  disclosure.
- **The status is carried on the LEFT EDGE** — a 3px edge in the full-strength token — as well as by the
  faint fill, which alone left rows readable only by their glyph. It changes no semantics: a fatigue
  factor that is present wears amber, never the red edge.
- **The sticky summary strip names its design in compare mode, and only there.** Every figure comes
  from the ACTIVE design, and with two grids on screen an unlabelled strip reads as a verdict on the
  comparison. `initLinksAnalysis` takes an `isComparing` thunk, and the neutral `.sum-chip--who`
  carries **no status tint** — a coloured chip would read as one more finding. Naming the design was
  chosen over hiding the strip: a designer comparing options still wants live analysis of the one they
  are editing.
- **Compare columns carry the same right-edge cue as the single grid.** Each column is a
  `.links-grid-wrapper`, so on a phone it wears the same `local`/`scroll` gradient. Its cells are
  transparent, so the shade shows through them at the visible end of a column while more remains, and
  that shade is the cue. The `local` layer masks it once the column's end is reached, and the gold
  outlines stay intact. Rendered with and without the gradient, 10 November 2026.

### Paint mode

A brush chip bar above the grid (`#brushBar`): clicking a chip arms that shift, and clicking cells then
applies it directly; clicking the armed chip again, or Escape, disarms. With no brush armed, a cell
click opens the app's own shift sheet over the cell (`openCellEdit` → `openOptionSheet`), never a
native `<select>`. With a MOUSE, pressing a cell and dragging paints every cell the stroke crosses;
touch and pen keep tap-to-paint, because a finger on a phone scrolls the grid. From the keyboard the
grid is ONE Tab stop and the arrow keys move between cells, and an edit repaints the cell's button in
place so focus stays on it. The rules are `links-grid-input.js`'s header. `.shift-cell-btn` and
`.brush-chip` set `touch-action: manipulation`: painting is rapid tapping, which otherwise triggers
double-tap zoom.

**The chips are the times THIS DESIGN is made of** (`brushTimes`), never a fixed list. A fixed list
painted shifts the design did not contain and could not paint the ones it did, and still looked as if
it worked. An imported proposal paints in its own times and a roster-seeded design in the roster's.
The armed brush is unioned in, so a chip cannot vanish mid-paint, and the bar re-renders after a paint
only when its SIGNATURE changes, because `applyShift` fires once per cell during a drag. A design with
one distinct time correctly gets a one-chip bar. Pinned by
`links: every paint chip is a shift the design actually contains`, in both directions.

### Night shifts

- **CEAs do not work night shifts (confirmed by Gareth, June 2026).** No night time is offered in any
  picker or brush chip. `normaliseCustomShift()` rejects a start between 21:00 and 03:59 **and any
  wrapping (past-midnight) end**; do not re-add a Night option and do not relax either guard.
  `classifyShift` returns `night` for anything it cannot read, and the grid footer shows that as an
  `N:` count — a visible "something here is wrong" flag. Never map it to `rd`, which hides it.
- **A duty that runs past midnight is read in ONE place, `endMinutesAbs`**, and `dutyMinutes` sits
  beside it (`links-fatigue.js` re-exports it). The heat map counts such a duty on both days, Saturday
  spilling round to Sunday. Only legacy or imported data can reach this, which is why it must stay
  correct: nothing else exercises it.
- **Shift lists:** `EARLY_SHIFTS`/`LATE_SHIFTS` are derived at load from the MAIN roster
  (`weeklyRoster`) only — never a static list, and never the bilingual roster, whose times no line in
  this design can work. The cell sheet's options (`EARLY_OPTIONS`/`LATE_OPTIONS`) add
  `DEFAULT_SHIFT_TIMES`; the brush bar uses the design's own times. **Custom…** is validated by
  `normaliseCustomShift()`.

### The staffed operating window

Stored on each design as `window` (`{monSat,sun}:{start,end}`), defaulting to `DEFAULT_WINDOW`. The rules
are the pure `links-window.js`; the coordinator owns only the editor on the Coverage card and the
Firestore field. An edit marks the design dirty, because the window is part of the proposal.

**It exists so the heat map can see missing cover at the ends of the day.** Span and gaps come from the
window, not from the first and last worked hour, which hid an unstaffed evening entirely. An hour
outside it renders `heat-closed` (hatched, inert): a shut station is not a hole in the cover and must
never look like one.

- **Compare mode diffs CELLS, not windows.** Both column headers state the window, `windowsDiffer`
  flags a mismatch, and the printed masthead states it too. Never render a comparison without them, or
  a per-design window becomes a way to make an unfair comparison look fair.
- **`normaliseWindow` falls back per ROW, never per FIELD.** A good Sunday survives a corrupt Mon–Sat;
  a stored start is never paired with a default end, which would invent a window nobody chose and print
  it as deliberate.
- **TEXT inputs, not `<input type="time">`.** Chromium renders that widget in the OS's 12-hour format
  even at en-GB. `canonicaliseWindowTime` pads.
- **A design carries its window through the BIN**, or a restore hands back the default and the next save
  writes it over the boundary the design was built to.
- **`renderCoverageCard()` renders the chart AND the editor**, in one call — one card, so no path can
  refresh one without the other.
- **`.win-editor[hidden] { display: none }` is mandatory.** An author `display` rule beats the `hidden`
  attribute, and a probe that reads `el.hidden` cannot see that.
- **The window is stated once on screen**, by the editor's own fields under a "Staffed window" eyebrow;
  a second line repeating the times reads as a second, possibly different, fact. On paper the editor is
  hidden and the masthead states the window. The reset control reuses `.btn-text-link`.
- **An invalid pair is refused, not coerced**, and the refusal is written AFTER the repaint, because
  `paint()` rewrites the status line from the stored window.

### Coverage heat map and the December service

The Coverage card is an hour-by-hour table (`calcHourlyCoverage`): rows are days, columns the hours of
the staffed window, cells the on-duty headcount in `heat-b0`–`heat-b5` tints of `--cov-early`, scaled to
the week's peak. A red `0` inside the window is a gap; spares have their own `SP` column; the grid's
`tfoot` keeps per-day `E:/L:/SP:` counts. The station is staffed in **waves** (open, morning build,
middles, afternoons, close) — do not revert to per-type stacked bars.

**Beneath it, the demand rows** (`links-demand.js`) — the December 2026 service, one row per day class,
in the **same table**, so cover and service are compared column by column. Rules that are easy to undo:

- **A different hue is load-bearing.** Demand is `--cov-late` orange against the cover's `--cov-early`
  blue: two rows in two different units (people, cars), and in one colour the eye reads the darker as
  more of the same.
- **Separate scales, stated.** Each half is shaded against its own peak, and the note says to compare
  shapes, not depth of colour.
- **Never score the design** — no "covers N% of demand". Show, do not decide.
- **The finding/fact split is the anti-cry-wolf rule.** `uncovered` (open, trains running, nobody on) is
  a finding and renders red. `outside` (trains while the station is shut) is a neutral fact: the last
  trains and the first departure fall outside the window on every design, and flagging them would teach
  the reader to skip the row.
- **Ask the boundary question to the MINUTE, never by the hour.** A window that closes at 23:25 makes
  hour 23 "staffed", and an hourly test reports the movements after 23:25 as covered — the one live
  finding the feature exists for. Cover is asked to the minute as well: each train is checked against
  `dutySpans`, who is on duty at that minute, so a gap inside a staffed hour is a finding although its
  cell still counts the people on for the rest of the hour, and the card's note says so.
  `summariseDemand` takes the window in minutes and the duty spans, never the hourly cells, so the
  hourly question cannot be asked by accident.
- The `dem-shut` marker comes from the same summary the prose reads, so a marked cell and a named
  movement cannot disagree. It marks the opening hour too, where trains run before the station opens.

### The sticky summary bar

The grid card's save row is `position: sticky; bottom: 0` and carries live figures and a jump link
(`.sum-jump`, "Full analysis ↓"), because the analysis cards sit screens below the grid, and without it
an edit's effect was out of sight.

- **Which figures, and why not others:** lines still undesigned (nothing else matters until it is
  zero), staffed hours with trains and nobody on duty, fatigue factors **present**, and hours a week
  excluding Sunday. `standing` is deliberately excluded: an edit cannot improve it, and a number the
  designer is driving down must not ask them to chase the unchaseable. **It is not a score.**
- **A chip may not report one of two counts.** `summariseDemand` returns `uncovered` beside `outside`,
  and `assessFatigue` returns `present` beside `standing`. The strip never claims full cover, only that
  no STAFFED hour is uncovered, and never says "no fatigue factors" while standing ones exist (pinned in
  `links-analysis.test.mjs`).
- **`renderSummary` recomputes rather than reading the other renderers' results.** That duplicates
  WORK, not LOGIC — each figure still comes from the one function that owns it — and it buys
  order-independence: shared state would make the strip silently wrong whenever the renderers ran in a
  different order.
- **`sticky` needs no scroll container**, because `.card` is `overflow: clip`, which does not create one.
  **The bar can cover the last grid lines while it is pinned** — a sticky element keeps its flow
  position only once it comes to rest — but only in passing: every line reaches full view at some scroll
  position. So add no bottom padding, and do not restore the old claim that it can never cover the last
  row (`links.css` has the measurement). The bottom inset is `env(safe-area-inset-bottom)`, for Safari's
  tab bar and the iPhone's home indicator.

### Empty and failed states

- **An empty card says what it is waiting FOR, and the one that can act carries the actions.** The grid
  card's empty state offers "Go to Auto-generate" (a real `.btn-save`), "Open a shortlisted proposal"
  and "Start with a blank grid"; nothing is opened for you. The two analysis cards get
  `.links-empty-panel` (centred, with a minimum height), because there is nothing to analyse.
- **"Go to Auto-generate" scrolls; it does not generate.** Building from an empty card produces a design
  nobody chose. It opens the card through `_openGenerator`, which keeps the chevron and ARIA in step.
- **The empty checks panel must not wear a green tick** (it shows `📋`): a tick in an empty checks card
  reads as "checks passed" before a single check has run.
- **A load FAILURE is not "you have not made one yet".** On `loadFailed`, `renderGrid` swaps the title and
  hides the actions: inviting someone whose designs did not load to make a new one is how a connection
  blip becomes a duplicate design.
- **Until the first read answers, the page is LOADING, not empty** (whole-app fix, Nov 2026). The grid
  card says "Loading your designs…" with no actions, the picker and ··· More are disabled, and Build
  says to wait: the load replaces the working copy when it lands, so a design made before it would
  vanish unasked. A CACHED answer with no live design in it is the failed state, never "No designs
  yet". The failed state carries **Try again**, because an installed app has no reload.
- **The card header hint is state-dependent** (`_setGridHint`), so it never describes a grid and a
  paint bar that are not on screen.
- **`links-analysis.js` must MIRROR the empty-panel markup** that `links.html` ships, because that branch
  replaces the whole card body.

## Design checks

### The first half

`runDesignChecks(patterns, ROTATING_LINES)`:

- **Unfilled lines** — an all-rest line is *not yet designed*, never a vacancy
- Weekends off (Saturday of line w + Sunday of line w+1, wrapping)
- Short turnarounds (under `MIN_REST_MINUTES` between consecutive timed shifts, round the whole circular
  rotation)
- Longest run of consecutive worked days (`worstCaseWorkedRun`)
- Early/late balance

with the hours row beside them (`weeklyHours`; Hours a week, below). Plain-English traffic-light rows,
completeness first, updated live on every edit. Every line rotates and is checked.

**The triage block above the rows** ("Needs fixing before review" / "Worth discussing") is the card's
hierarchy, ADDED rather than substituted: the sections below stay grouped by SOURCE — this app's
checks, the company limits, the ORR's factors, today's link — because invariant 10 needs every limit to
name whose it is. Each triage line names its source, and the block computes nothing of its own, so it
cannot disagree with the rows. **Nothing to fix is said out loud, never as a tick**: "Nothing found that
has to be fixed — the rows below say what was checked".

### Hard limits vs advisory factors

The reasoning lives in `links-limits.js`'s header: why a hard limit is a different kind of statement
and so a separate module; whose the run limit is (Chiltern's roster limit — its origin, the
post-Clapham Hidden standard, was withdrawn in 2007, so it is cited as an origin and never as a current
industry rule); "13 consecutive days" against the historic "13 shifts in 14 days"; and
`POLICY_SOURCE_CONFIRMED` as the one switch that sets the strength of every rendered claim. What a
designer needs before opening it:

- **A hard limit either is or is not met** — own function, own count, own section ("Company limits"),
  red on a breach, and it renders when PASSING too, because "checked and met" must be visible on the
  sheet. An advisory factor reports presence and never passes or fails a design (invariant 2). The hard
  limits are `MAX_CONSECUTIVE_WORKED_DAYS` and the contracted-days ceiling (Line numbering, below).
- **Their evidence is class C, and the sheet says so.** Until a controlled Chiltern source is cited,
  `POLICY_SOURCE_CONFIRMED` stays `false`, every surface stating a limit carries the provisional wording,
  and the rows report the measurement, never "cannot be run". `ROADMAP.md` → Evidence class explains the
  gate; `VALIDATION_REGISTER.md` and `KNOWN_LIMITATIONS.md` track the citation.
- **Never hardcode a status.** A hardcoded green tick once sat directly beneath the amber finding it
  duplicated.
- **Do not promote another limit from recall.** Maximum turn length, minimum rest between turns and a
  weekly ceiling are already computed and rendered as advisory ORR rows; making one a hard limit is a
  rendering change plus a confirmed figure and source. Minimum rest is already a generator gate (The
  generator, below).

### Fatigue factors — ORR good practice, p3

The second half of the card, from `links-fatigue.js`. It exists because the December 2026 proposals
will be **assessed** against the ORR's list (25 rows in six families), and its header holds the account
of every rule — read it before changing one. What governs it:

- **It reports factors PRESENT. It never passes or fails a design.** The ORR states these are not
  prescriptive limits, so red/green would misrepresent the guidance being quoted. Amber
  (`.check-warn-row`), never `.check-bad` red.
- **The dominant risk is FALSE ASSURANCE**, not a missing rule — a design showing nothing and being read
  as approved. So CLEAR and NOT-APPLICABLE report themselves too: silence must never be the same shape
  as compliance. **Never hardcode a status**: FF13 reads `runDesignChecks`, so it cannot disagree with
  the short-turnaround row it duplicates.
- **NOT-APPLICABLE ≠ CLEAR, and STANDING ≠ PRESENT.** A factor true of every 06:20 duty (FF2) is a
  property of the operation: `standing`, counted separately, because adding it to the findings would
  claim the designer could have avoided it.
- **Only FF19 carries `confirm: true`**, rendered "(definition to confirm)". On 28 Sep 2026 the owner
  checked the once-unsettled rows against ORR's *Managing rail staff fatigue* (Aug 2024): MRSF's 7×8h
  reads eight hours or more; FF17 is ORR's own definition (a shift starting earlier than the last,
  7.68); FF18 is ORR's cadence reading. FF19 keeps the flag on purpose: "a rest day resets it" is the
  owner's reading, more lenient than ORR's wording ("consecutive duties", 7.71) — on the strict wording
  every link with early and late weeks has FF19, so it would stop telling designs apart — and the flag
  is how an assessing manager sees that the reading is not ORR's.
- **FF18 is ORR's CADENCE factor; the STEP is extra information.** A weekly link changes shift type about
  once a week by construction, so the row is `standing` on every link with a timed line, and `n/a` only
  when no line carries a time. Its detail states the typical weekly move, the largest, and how many
  boundaries move by more than `GENTLE_THRESHOLD_MINUTES` (ORR's own FF19 figure, single-sourced so the
  chip and the sentence cannot drift), from `scoreOrder` over lines 1…lines — never the keys a design
  happens to carry. **Do not turn it `present` above some figure**: the ORR gives no FF18 threshold, and
  inventing one is the pass/fail rendering this panel forbids. The live main roster's step — typically
  4h 0m, largest 8h 46m, 9 of 20 boundaries over two hours — is the baseline to quote. Measure the
  default with `docs/links-26/tooling/default-baseline.mjs`, and quote any step figure with the
  switches and target set it was measured on.
- **Every rule laps the rotation** (invariant 3): a block straddling the last line → line 1 must be
  measured whole (`earlyBlocksWithShortRecovery` once cut it in half and reported nothing).
- **FF11 is not the consecutive-worked-days check it resembles.** It counts shifts between two-day
  breaks: a single rest day is not counted as a 48-hour break (two together always are), so FF11 can
  only overstate, and a rotation with no two-day break at all returns every worked day.
- **Hours totals are a FLOOR when the design has a spare day**: SPARE carries no times, so a standby
  day adds no hours (`hoursAreFloor`, true only then), and the panel says so. With no spare day the
  totals are exact, and the panel does not call them a floor.

**A cover week is an unknown, not a no.** Every rule that counts a RUN measures it with
`runLengthsWhere` — `workedRunLengths`'s spare-week budget with the question as a parameter — and never
with a plain scan: a spare day has no times, fails any predicate, and a plain scan reads it as a break.
Two bounds keep that honest: **`SPARE_WORKED_DAYS` duties a week, never seven**, because seven fuses the
blocks either side; and **extend, never create** (`requireMatch`) — a cover week may lengthen a run of,
say, 12-hour duties, and never make one out of unknowns. Where the worst case and the certain figure
differ, the row states both.

**A spare week is four duties of seven, from Monday to Saturday** (owner; `SPARE_WORKED_DAYS`,
`spareDrawsOnFour`). It is marked SPARE on all seven days because the person is cover; four is what
they work, and its Sunday can be worked as overtime on top (owner, 31 Oct 2026: *"Although people could
be rostered for RDW on a Sunday cover week. The 4 days can only be the contractual days which are
Monday to Saturday"*). So a worst case takes the four placed as badly as they can be, plus the Sunday.
**Counting all seven is not "the safe direction".** It fuses the blocks either side into one phantom
run (it read the live main cycle at 15 against a true 9), a reader who knows the real link then
discounts the row, and the next design that genuinely passes the company limit is hidden by that
discount.

`worstCaseWorkedRun` in `links-design.js` is the ONE reading of a run; `longestWorkedRun`
(`links-fatigue.js`), `longestRunFor` (`links-adjacency.js`) and the hard limit all delegate to it.
Four things that are easy to get wrong, each with a test:

- **Two ADJACENT spare weeks legitimately chain** — the first week's four at its end, then the second's
  Sunday as overtime and its four from the Monday. The bilingual roster's spare weeks (lines 1 and 8 of
  8) wrap into each other this way. Do not clamp the answer.
- **FF11 handles a spare week differently.** Its rest days need not be adjacent, so in the worst case —
  its Sunday worked — it supplies NO 48-hour break while still supplying five shifts. Its four, the
  Sunday and no reset is the honest ceiling.
- **A spare duty after a real 48-hour break RESETS the count**, exactly as a worked one does.
- **The FF11 budget is keyed on the UNMODDED index**, so the second lap — which exists to measure a run
  wrapping the cycle end — gets a fresh spare week of its own.

**The owner's design target is below the company limit, not at it:** ideally a new base link would not
carry even 7 consecutive worked days. `DEFAULT_MAX_RUN` is that target, read by the run-cap switch and
by the "Longest run" row alike. Between the target and the limit the panel reports the SAME figure
twice, amber and green, so **each row says which threshold it was measured against**: the amber row
carries `(design target: no more than DEFAULT_MAX_RUN)` and says in its sub-line that this is an aim,
not a limit; the hard-limit row states its own figure and source. Pinned by a test whose fixture lands
in that band.

**The `clear` and `n/a` rows are collapsed behind a disclosure**, and that must not weaken "silence is
not compliance": the counts stay in the always-visible heading (`clear` and `not applicable` among
them, each counted as itself), the disclosure is labelled with what is inside, and CLEAR and
NOT-APPLICABLE keep their own icons and wording inside it.
What is hidden is the PROSE, never the fact of the check; `present` and `standing` always render inline.
The night-family rollup belongs INSIDE the disclosure, or the heading and the label count different
things.

**Printing must open every `<details>`, and CSS cannot do it**: Chromium hides a closed disclosure's
content through an internal slot no author rule reaches. `_preparePrint` opens them — from the Print
button before `window.print()`, and on `beforeprint`, idempotently — and `_restoreAfterPrint` closes them
on `afterprint` and again when the page becomes visible, because Safari fires neither event for
AirPrint. The printed sheet goes to the assessing manager, and dropping completed checks from it is the
false-assurance failure this panel exists to prevent.

**Today's link, for comparison** (`currentLinkBaseline`, passed as `getBaseline`): measured over the MAIN
cycle (`weeklyRoster`) at its own length. Never splice two cycles into one rotation — the join itself
reports a run neither roster has. No bilingual row: the design does not replace the bilingual roster.

### Hours a week

`weeklyHours` in `links-design.js` answers the first question anybody asks of a roster — does it give
people their contracted hours? — in the Design-checks row, the sticky summary chip, the grid's per-line
totals footer and the compare strip. The generator card's own row predicts the gate instead (below).

**Two rules, and each "simplifies" into a plausible wrong answer:**

- **Sundays come out.** Sunday is not contracted for any grade (`SUNDAY_FORBIDDEN_TYPES` in
  `override-utils.js` is the app-wide declaration), so a Sunday duty sits on top of the contract, and
  folding it in reports contracted hours using time that is not contracted. It flatters. Both figures
  are returned; only `exSunday` is comparable to `CONTRACTED_HOURS_PER_WEEK`.
- **A cover week counts as a full contracted week, and the divisor is the whole rotation** (owner). A
  cover week carries no stored times, but it is somebody's paid, contracted week. Only the mean is the
  contract — individual lines vary widely — and an UNFILLED line is zero hours and rightly drags the mean
  down.

**The measure is validated against the roster itself**: the live main cycle comes to exactly the
contracted week, and that is a test. A design judged by a broken yardstick is worse than one judged by
none, because it looks like an answer.

**The generator REFUSES a table that does not pay that mean EXACTLY** (owner): `short-hours` and
`over-hours`, each carrying the size of the gap and naming its own remedies, which are opposites, so
the two messages can never merge into one with a sign in it. The check is on the TARGETS: the duty a
table asks for and the working lines are fixed, and every construction places exactly those duties on
those lines, so no arrangement can rescue a wrong table.

- **A surplus is not a lesser fault.** A link IS the contracted week, and a permanent surplus commits
  the rotation to overtime nobody declared or agreed.
- **An equality over whole duties is sometimes unsatisfiable.** A set of duty lengths that cannot sum to
  the total has no valid table, and the generator refuses everything until a duty changes length or the
  cover-week count moves. That is the rule working: `links-contract.test.mjs` asserts the case with both
  its neighbours, and a tolerance would bring back designs that are quietly a few hours out.
- **`requireContract` defaults ON.** Only the construction tests pass `false`, and
  `links-contract.test.mjs` fails if `links-app.js` ever does.

**A threshold IS defensible here, unlike the ORR factors**: the contract is a contract, not guidance.
The Design-checks ROW keeps its half-hour of slack and never turns red, because it describes a design
being edited; the GENERATOR is exact, because it decides whether to create something.

**The generator card's "Hours a week" row predicts the gate, so it is exact too** (`assessTargetHours` in
`links-target-hours.js`, on the gate's own `targetExSundayMinutes`): a tick kinder than the gate is a
promise the next press breaks. It states the gap as a TOTAL, never per line — divided by the whole
rotation, an hour of missing duty reads as two minutes and makes a refusal look like rounding.

**Per-line totals, and the two divisors.** Three read-only columns to the right of Saturday — hours
Mon–Sat, hours across all seven days, and days worked Mon–Sat — with the rotation averages in the footer.
The HOURS averages are `weeklyHours`, so the page cannot state a design's hours two ways. The DAYS
average divides by the WORKING lines (invariant 7), because a cover week does not record which days it
works; that is also how `TARGET_DAYS_PER_WEEK` is derived, so the measured figure is comparable with the
target. Both divisors are printed on screen. A cover week's hours show as the contracted week, muted and
italic, because that is a convention rather than a reading; its days are a dash — unknown, not none. A
total that is a FLOOR (a duty on the line could not be read) is orange and ends in "+", so it is not
told by its colour alone; the "+" is silent where the cell's label already says it. The
`.tot-legend` line under the grid says what each style means, the floor included ("so the total is a
floor, marked “+”"). Rules in `lineTotals`; pinned by
`links-design.test.mjs`.

## The generator

### What it is

**The main way to create a design**; New blank design, Import and the built-in proposals are the
others. Its targets are a LIST of shift slots — one row per shift time, each with separate
**Mon–Fri / Sat / Sun** headcounts — plus **one** number: how many whole lines are spare weeks.

**Spare is a whole week, not a scatter of days** (owner, Aug 2026). A spare line is spare on all seven
days: the person is cover, works four days of it, and can be put on any range of shifts. The real roster
is built this way — main lines 1, 7, 12 and 17, bilingual 1 and 8 — and has no scattered spare day
anywhere. `spareLines` whole lines are reserved and spread evenly round the wheel, and the rotation is
built over the rest; daily targets are still met exactly. A per-day spare headcount fed to the sliding
window got the daily total right and the distribution wrong, which is why it went unnoticed. The
targets are validated against the WORKING lines (`lines − spareLines`), so a total that fits the
rotation can still be refused.

### The default table and the roster seed

Two buttons, for two questions: *↺ Use the Dec 2026 staffing* and *↺ Copy staffing from
today's roster*. A proposal wants both — design tomorrow, measure today. **Neither label may say
"reset" without saying to WHAT**: with two of them, that word alone is the one thing a designer cannot
act on.

- **The default** (`links-default-targets.js`) is Short Run's duty table. It pays the contract exactly,
  so Generate works on a card nobody has touched, and it meets the rules every design at this length is
  judged against, `docs/links-26/RULES.md` (`links-default-targets.test.mjs` pins each one). Meeting
  them is the floor for being worth discussing, not evidence of being right. **It is not a link**: the
  generator arranges the duties its own way, not as Short Run does, so read the panels before anyone
  takes a printout into a room. Its cover-week count, `DEFAULT_COVER_WEEKS`, is a term in its contract
  equation: change it only together with the duty table. **Short Run left the shortlist on 8 Nov 2026**
  and the table did not move with it: the three drawn that day staff the same duties each day (15 every
  weekday, 14 on a Saturday, 10 on a Sunday) at other times, so it still fits them, and which design's
  duties the generator starts from is the owner's question, not a side effect of the shortlist.
- **The roster seed** (`buildRosterTargets` in `links-seed.js`) MEASURES today's link, so the contract
  gate refuses it with the gap named: today's duties pay fewer working lines than the design has.
  **It must sample exactly what the design represents** — the whole MAIN cycle, through
  `rosterSeedLines()`, and nothing else. Never only the weeks people happen to sit on today, which is a
  fact about staffing, not about the roster's shape; and never the bilingual roster, whose times no line
  in this design can work. The cycle length comes from `CONFIG.MAIN_ROSTER_WEEKS`, never a literal (a
  static assertion bans one), so a cycle that changes length is still read whole. `buildRosterTargets`
  takes its sources as an argument defaulting to `rosterSeedLines()`, so which lines are sampled is
  testable apart from what is counted. `links-seed.test.mjs` checks line IDENTITY and that no
  bilingual-only time is ever seeded, rather than resting on a figure; an e2e still drives the button,
  which proves the BUTTON reaches the seed, something a unit test cannot. The weekday count is the
  **busiest** Mon–Fri day for each time — under-staffing a day is the worse error, and the generator
  staffs all five at that level — so the column header says `busiest day`.
- **The seed reports what it measures, and nothing else.** It carries no uplift, and a knob that drives
  nothing is deleted, never set to zero; a designer who wants another spare week types it into the box.
- **A remembered table does not outlive a changed default.** Each design's working table is remembered
  on the device (`links-generator-targets.js`; four rules in its header). `isSupersededMemory`
  discards a memory equal to the roster seed or to the current default, compared by content, so a table
  a designer edited is never discarded; a kept memory that differs from the default carries a
  provenance note until it is touched, and a version stamp retires an old default without touching
  anything a designer edited.

### Minimum rest is a GATE, not a finding

Owner: *"It keeps offering me a gap of 11 hours 45 minutes between a shift. That would never be allowed
by Chiltern."* A minimum rest period is a condition of a design being runnable — the same class of
statement as the contract — so the generator **repairs** a breach and refuses only what it cannot
repair (`short-rest`, naming the shortest remaining gap). Invariant 4: reporting it afterwards is not
refusing it.

- **The repair (`repairShortRest`) swaps two lines' duties within one day column.** That day's headcount
  on every shift time is unchanged, so the targets, the contract, the heat map and the demand fit are
  untouched by construction rather than by re-checking. Timed↔timed swaps come first (both lines keep
  their days worked), timed↔rest only if none fixes it. **Whole spare weeks are never touched**: a duty
  swapped into one turns a cover week into a working week with six spare days. A swap is accepted only
  when **all four** adjacencies it can affect come out legal, or the repair walks the breach onto
  another line and reads as success.
- **`requireRest` is the opt-out**, for construction fixtures that staff every line every day;
  `links-contract.test.mjs` fails if `links-app.js` ever passes it, exactly as for `requireContract`.
- **The reorder runs after the gate, so it is held to it too**: rest across the week boundary is
  charged and filtered on in every configuration (Line order, below).

### Saved staffing setups

The generator card's "Saved staffing setups" row holds named snapshots of the target table, shared
between the designers in Firestore (`linkTargetSets`), because the promise they exist for — owner:
*"I want others to be able to mess about but not lose my shift times set"* — cannot be kept per device.

- **Use setup** copies one into the working table, asking first if the table has been changed; keeping
  a changed version means **+ Save as new…**.
- **Overwriting or deleting a setup belongs to its creator or the admin**, and `firestore.rules`
  enforces that, not the disabled button, which only reports it (invariant 9). `createdBy` is pinned to
  the writer's own name on create and cannot change on update.
- **Consent names a version**: a setup changed while a confirm sat open is not overwritten or deleted
  (`writeIfUnchanged`, `links-target-sets-store.js`). **A failed read is not an empty list**: the row
  never says there are no setups when it could not find out.
- Rules: `links-target-sets.js`; the panel: `links-generator-targets.js`. The e2e seat is M. Robson,
  deliberately — the admin's override is real, so ownership must be tested from a seat without one.
  The real designer list has been the owner alone since 9 Nov 2026, so the spec gives that seat a
  list of its own (`withLinksDesigners`, `e2e/fixtures.js`).

### The two constructions

`generateLink({ slots, spareLines, lines })` tries **settled weeks** first and falls back to the
**rotating window**. Which one ran is REPORTED in the status line, never silent, because they give
visibly different designs. `generatePatterns` is the thin wrapper that returns the patterns only, kept
for the callers and tests written against it. The reasoning and the measurements are the comment above
the two constructions in `links-design.js`.

1. **Settled weeks (default).** Slots are grouped into WAVES — starts within `WAVE_SPAN_MINUTES`, the
   FF19 threshold — and each wave gets a contiguous BLOCK of lines sized by its duty, sliding its own
   window inside that block. **A line never leaves its wave**: its start can move 06:20 → 07:15, never
   06:20 → 15:25. The real roster hands out WEEKS this way; the old construction gave everyone a week
   nobody at Marylebone has worked, and inflated the very FF19 the tool reports. Waves rather than exact
   times, because a block per time needs more lines than exist. Three things, each pinned by a test:
   - **A wave too small to fund a line merges into its nearer neighbour**, or one whole line exists to
     work two days a week. A shape improvement paid for with an unfair link is not an improvement.
   - **A lap is spread ACROSS the week, never front-loaded** (`floor((i+1)·n/7) − floor(i·n/7)`).
   - **The fairness test is comparative, not an absolute floor**: "nobody under 3 days" is a fact about
     the targets, not the construction.
2. **Rotating window (fallback).** A window of consecutive lines slides round the wheel, one lap a week.
   Positions are read mod `working`, so every line wraps front-to-back once a week, and that wrap IS a
   late-finish-to-early-start step unless it lands on a rest day. So each day's stride is capped at
   `working − (next day's total)`, and when the caps cannot fund a lap the generator **refuses**
   (`no-rest`) rather than ship the phantom guarantee that "a person's week only moves later".

Daily targets are met exactly by both, a day-class total over the working lines is refused
(`over-capacity`), and the generator writes every line. **Do not add back** `buildDefaultDesign`,
`initFromRosters` or `resetFromRosters` — removed because they copied raw roster patterns verbatim and
left the lines past the roster's own length blank. **Interleaving the waves inside the generator is a
WON'T-DO** (tried and reverted; the numbers are in `links-design.js`): it fixes the raw block length
but puts a late wave's 23:55 Saturday beside a morning wave's 06:20 Sunday. The generator owns the
SHAPE; `links-adjacency.js` owns the ORDER.

### Line order — the objectives

`links-adjacency.js` reorders the generated lines through **five switches and two constraints**
(`OBJECTIVES`, `cost`, `reorderLines`); its header holds the reasoning and the measurements. You work
line w one week and line w+1 the next, so a whole class of a design's quality lives in which line
follows which: how far your working day moves from week to week (the FF18 question), whether Saturday
off is followed by Sunday off, whether that stretches to three or four days, and whether Saturday's
finish runs into Sunday's start.

- **Reordering is FREE with respect to coverage** (invariant 8): permuting rows leaves "how many lines
  work shift X on day D" identical, so the objectives compete only with EACH OTHER. A test asserts the
  multiset is unchanged; if it ever fails, the reorder has started moving cells rather than rows.
- **Switches, not a formula** (owner, Aug 2026). Turning one on takes freedom from the rest, so the tool
  lets you turn each on and SHOWS what it cost: `scoreOrder` returns every figure whatever you optimised
  for, and the status line reports before → after. A blended score would hide the trade. **Everything
  off means leave the order alone.**
- **A spare week must not read as a gentle transition.** A spare line carries no times, so the step
  across it is UNMEASURABLE and is counted and reported separately — never as "no change", or the
  optimiser learns to park spare weeks between the two harshest lines and report a beautiful number.
- **Days off and contracted days GIVEN are different answers** (`breakLength` returns `days` and
  `given`). Sunday is not contracted, so Saturday + Sunday off is a two-day break but one contracted day.
  `days` is right for fatigue, `given` for judging the design.
- **`variety` and `gentle` are opposite ends of one dial, and `variety` must stay ON by default.**
  Minimising the step, taken to its limit, IS a long block of one shift; with `variety` off a person
  gets months of mornings, which the owner called "a bit excessive and would be unpopular". `variety` is
  the only switch with any lever on block length. It is weighted as a constraint, so the optimiser
  alternates by the smallest step available (early → middles → late) towards `DEFAULT_BLOCK_TARGET`,
  the live roster's own longest run on much the same shift. `blockRuns` treats a SPARE line as
  transparent, because counting a cover week as a break would let four spare weeks hide a 20-week block.
- **Most shifts in a row (`maxRun`)** aims at `DEFAULT_MAX_RUN`, the same number the "Longest run" row
  reads. `longestRunFor` counts a spare week as four worked days by delegating to `worstCaseWorkedRun`;
  counting seven is the mistake anything measuring runs repeats first.
  **`runExcess` is a gradient, never a statistic**: it sums the excess over every start, because a
  maximum is a plateau a 2-opt cannot climb. Do not report it, or any total derived from it. **Its
  weight is a firm preference, not a near-absolute**: reaching the target with every switch on costs
  three or four full weekends off across the rotation (the FF11 figures across weights are search
  noise, not a property of the weight). Which matters more is a judgement about conditions for the
  room, not a tuning exercise, so leave the weight alone unless that answer comes back
  (`LINKS_DEC2026_PLAN.md` → the run cap; KNOWN_LIMITATIONS.md). With the switch on alone the reorder
  reaches the target; with the full set it may not, **and the status line says what it reached** — a
  box naming a target the design silently misses is the phantom guarantee again.
- **The spare spread is a constraint, not a switch** — the next section.
- **Rest across the week boundary is a constraint too.** The reorder must never put a Saturday finish
  less than `MIN_REST_MINUTES` before the next line's Sunday start. As a switch, unticking it undid the
  generator's rest gate; it is charged in every configuration, at the old switch's weight so the shipped
  default is unchanged, and FILTERED on, because a weight can always be outbid.

**Deterministic per attempt.** The 2-opt is a local search, so where it starts decides where it lands.
Attempt 0 starts from the greedy order, so the first press is canonical; pressing Generate again on
unchanged inputs moves to the next attempt, which keeps the best of three seeded shuffles (mulberry32 on
the attempt number — **never `Math.random`, never the clock**), and any change of input goes back to
attempt 0. So "design 3" means the same design on every device, and a variant is recovered by pressing
Generate the same number of times. The status line names the design, tracks the best so far on the
ticked objectives, and says how to get a superseded best back. **The even cover spread and the boundary
rest are FILTERS on the candidates as well as weights**: a local search can only pay a price it can find
a path away from. If all three starts fail, the attempt falls back to the canonical design and the
status line admits the duplicate rather than renumbering it.

Greedy nearest-neighbour, then a bounded 2-opt; not optimal, and it does not claim to be. **Do not quote
a step or block figure without saying which switches were on and on which target set** — a figure
without both cannot be checked or reproduced, and a gentle-only step overstates what the default
delivers, in exactly the conversation where the number matters.

### The spare spread is a CONSTRAINT, not a switch

`generateLink` reserves whole spare lines and spreads them evenly round the wheel. A reorder with no
objective that cared clustered them — clustering helped the objectives it did care about — and **two
adjacent spare weeks chain into one long run** (the first's four at its end, the second's Sunday and
four at its start): a fatigue finding of the tool's own making, with nothing on screen to say the ORDER
had done it. So `spareSpread` is charged **unconditionally**. It is the only term that can make the
result worse than what the reorder was handed, rather than merely less good.

- **Its weight must DOMINATE, not merely lead.** These terms ACCUMULATE: a weight above `variety`'s per
  unit was still outbid by two units of block excess. **Comparing per-unit weights between terms that
  accumulate at different rates is the mistake**, and a test comparing one unit against one unit is what
  made it look settled. The weight sits one step inside the measured dominating plateau; `cost`'s
  comment has the measurement.
- **It is safe as a constraint because excess 0 is always reachable**: `spareSpread` targets
  `floor(lines / spares)`, which gaps as equal as the rotation allows always meet. A dominating weight
  over an unreachable target would chase a residual it can never clear.
- **Two tests, and neither replaces the other.** One asserts the weight outweighs every switch slipping
  a unit at once (read back through `cost`), which catches a re-weighting; the other drives a real
  generated design through the real optimiser and asserts the spread survives, which catches the
  behaviour. The first is necessary and not sufficient — the switches accumulate without limit.
- **It has no checkbox, so `.gen-obj-note` says it**, with the boundary rest: *"Two things are not
  optional: cover weeks stay evenly spaced around the rotation, because two side by side run into one
  long stretch; and no order is used that leaves less than 12 hours between a Saturday finish and the
  next line's Sunday start."* That is load-bearing copy: a card whose argument is "the result says what
  each one cost" cannot carry an unnamed term. Do not trim it as redundant with this file, which
  designers do not read.

### No uplift control (owner decision)

An "increase every target by N%" control was built and then removed on the owner's decision:
*"over complicates it."* If one is ever proposed again, two things must come with it:

- **Round the day-class TOTAL, not each slot** (largest remainder). The targets are mostly 1s and 2s,
  so rounding each slot leaves small uplifts byte-identical, and the control appears broken.
- **A slot at 0 for a day class stays 0.** Zero is not a small number: it means that shift does not run
  that day.

**The finding it was built to surface still stands** (`LINKS_DEC2026_PLAN.md`): every extra duty comes
out of a rest day, so a service increase cannot be absorbed by making the existing lines denser — the
link has to get bigger, which means more staff. That is an argument to take into the room, not a
control to put on a page.

### Sunday is not contracted, and the generator does not model it

Sundays appear on the roster as agreed **RDW** — overtime by agreement, not contracted hours — but
`dayClass` returning `'sun'` is the whole of it: nothing in the generator, `runDesignChecks` or
`links-fatigue.js` treats a Sunday duty as voluntary. Mostly harmless (the cover still has to be found,
and an hour worked is an hour worked for fatigue), but two readings change: the Sunday column is cover
you HOPE to fill, which is why the table labels it `RDW`; and "weekends off" counts a Sunday nobody was
going to work, which is why `links-adjacency.js` splits days off from contracted days given.

- **A cover week IS Mon–Sat SPARE; its Sunday is not asked about** (`isCoverWeek` in `links-design.js`,
  read by the hours, the per-line totals, the contracted-days ceiling, the spare spread and the roster
  seed). A cover week written with its Sunday as a rest day is still a cover week.
- **A spare week's four days come from Monday to Saturday.** Its Sunday stays RDW if the roster clerk
  gives it, on top of the four (`spareDrawsOnFour`; the owner's words are under Fatigue factors). All
  seven days are still marked SPARE, which is what "available for cover" means.

### The generator intro must not restate a guarantee

The card once promised *"start times only move later through each person's week — never a late finish
followed by an early start"*, a promise the rotating construction never kept, so the page contradicted
itself: the Design checks below reported a backward-rotating pattern on the design the paragraph had
just described. **Describe what the generator does, and point at the checks for what it achieved.** The
rule governs both places the generator is described:

- **The card opens with ONE `.links-desc` sentence.** The desktop left-edge e2e measures it, so keep
  exactly one.
- **Everything else is the `?` panel** — the "The default table" section of `links-tips.js`, whose "no
  promise about the result" item points at the checks. Keep the panel beside the module it describes:
  help text is prose, checked only by someone who knows the feature.

### Generator layout

Measured at 390px and 1280px, not eyeballed. The reasoning for each rule is beside it in `links.css` (the
"Generator polish" block).

- **The iOS focus-zoom guard must come AFTER the rule it beats.** The coarse-pointer block that sets the
  generator's fields to `--type-medium` sits after the base `.gen-input, .gen-select` rule; placed
  above it at equal specificity, it did nothing. `e2e/pages.spec.js` measures the computed size on a
  real coarse pointer (`css-tokens.md` → "The 16px focusable-field rule is MEASURED").
- **Touch targets:** on a coarse pointer the fields are at least 40px tall and the row ✕ and the text
  links 44px. Density is gated on `pointer: fine`, never on width.
- **The SHIFT TIME column is sticky below 768px**, where the table scrolls inside its card and hides the
  Sunday column and the ✕. Sticky identifies the row while you type and makes the scroll self-evident,
  with a right-edge shadow (pure CSS, `local`/`scroll` gradients, no scroll listener). **Every sticky
  cell needs an OPAQUE fill** — the spare row's own tint is mostly transparent — and a sticky cell takes
  no `white-space: nowrap`, which just overflows the fill.
- **The form uses the FULL card width on desktop** (owner: "still not using the full width"). Capping
  it, or capping the shift-time select instead, looked worse. **The card has ONE left edge**: the intro
  keeps a 72ch reading measure pinned to that edge (`margin-inline: 0`, never centred), and anything
  added to the card joins the one column. `links: the generator card lines up on one left edge at
  desktop width` measures every part and names the offender, which a whole-card baseline cannot.
- **The target table's column headers stick from 768px up, and only there.** Below it, the wrapper's
  `overflow-x: auto` makes the other axis compute to `auto` too, so the header sticks to a box that never
  scrolls. **Do not "fix" it with `overflow-y: visible`** — that is the declaration the spec overrides,
  so it reads as correct and changes nothing. Making it work on a phone needs a `max-height`, and so a
  nested scrollbox round the primary creation path: a UX decision, not a tidy-up. An e2e pins both
  widths.
- **The generate feedback is written beside the BUTTON** (`#genStatus`, `aria-hidden`; the sticky save
  row's copy carries the `aria-live`, and one announcement is enough), and **the button is held still**:
  the first generate grows the grid card above by a whole grid, so the handler re-anchors the scroll to
  keep the button under the finger. Both pinned by an e2e.
- **The objective labels:** the label text is ONE `<span>` (a flex item), so it wraps as a block, and a
  numeric clause has its own line. **Grid is wrong here**: every child becomes an item, and the number
  box drops into the checkbox's column. **A number and the words that qualify it are one unbreakable
  group** (`.gen-obj-numctl`, `inline-flex`), or at 360px — the design target, with 16px/40px the floor
  for the box — the unit wraps away and reads as a separate statement.
- **The objectives are OPTION ROWS** (`.gen-obj`), mirroring paycalc's `.bp-mode-opt`/`.hpp-mode-opt`: a
  bordered row with a navy border, a brighter fill and a lift via `:has(input:checked)`, the shared
  app-drawn checkbox (never sized or tinted locally — `css-tokens.md`), and the focus ring on the ROW,
  because the row is what you are choosing. The same 2px border in both states, so toggling causes no
  reflow; `.gen-obj + .gen-obj` spaces them with a sibling margin, because a `<legend>` in a flex
  container lays out unpredictably. **Do not re-create a page-local variant**; change it with
  paycalc's.
- **ON is the BRIGHTER row — check that against the SUBSTRATE.** This fieldset is `--surface-sunken`, so a
  checked row is white and an unchecked one a step below it. The other way round, copied from paycalc
  (whose options sit on a `--surface` card), the default — every switch on — read as five empty boxes,
  and switching an option on made it dimmer, inverting the three-surface cue. `.gen-obj-num` takes no
  `background-color: white` override, or the field cannot brighten on focus.
- **Pixel coverage, and its two blind spots.** `links-generator.png` and `links-objectives-narrow.png`
  are the baselines, but a near-white fill change falls under the visual threshold, and the visual project
  is fine-pointer only, so the coarse box never appears in one. So the checked-row treatment is asserted
  in COMPUTED STYLE beside the desktop shot (`e2e/visual.spec.js`) — deleting the fill and the shadow
  left the screenshot passing — and the clause is tested on **mobile-chrome** in `e2e/links.spec.js` at
  360px. Do not move the clause test into the visual suite, where it passes on broken markup. Keep both.

## Line numbering — the full rotation

Every line rotates, and **every one must carry a real worked pattern**: everyone passes through every
line, so a "vacancy" is a missing *person*, not a missing *pattern*. The grid flags an all-rest line with
an amber line-number cell (`.row-unfilled`), and "Lines not yet designed" lists them until they are
filled.

**`ROTATING_LINES` in `links-design.js` is the ONE declaration of the length** (invariant 1).
**Everything derives from it — do not write the number down again** in code, a string, markup or a
`max` attribute, and do not give the current length as a fact in a comment or prose: name
`ROTATING_LINES` instead. Static markup that cannot interpolate uses a `.js-rotating-lines` span stamped
at init, and the numeric `max` attributes are stamped too. `links-rotation-parity.test.mjs` fails on a
literal in the code, strings or markup of the Links modules and `links.html` even when it is right
today. It strips comments on purpose — a comment may RECORD HISTORY, a dated release or a past length
("28 → 22 → 24 → 26"), and that history is often the most useful thing in it — so the comment half of
the rule is held by hand, as is this file, which the test does not read.

**The length and the cover-week count came from the owner on 1 Oct 2026** (the default's cover weeks are
`DEFAULT_COVER_WEEKS`), and the rules every design at this length is judged against are
`docs/links-26/RULES.md`. The new link is the CEA (main) roster **widened** to increase staffing, and
**does not include the bilingual roster at all** — not its lines, not its shift times, not its work
(owner). Evidence class **C**: owner-confirmed practice, with no document behind it.

- **The contracted-days ceiling is a hard limit too** — `CONTRACTED_DAYS_CEILING` and
  `contractedDaysPerYear` in `links-limits.js`: `(Mon–Sat duties + SPARE_WORKED_DAYS × cover weeks) ÷
  lines × 365 ÷ 7`. It is assessed only once every line is drawn and only at `ROTATING_LINES`, with the
  run limit's evidence discipline: a measurement, never "cannot be run", while no company policy
  document backs it.
- **The shortlist is built in, and read-only** (owner decision, 3 Oct 2026: read-only proposals, not
  saved documents). `PROPOSALS` in `links-proposals.js` holds the current shortlist, listed A to Z with
  no recommendation (owner, 5 Nov 2026). Copy a design cell for cell from the pack and keep its printed
  name; `links-proposals.test.mjs` says whether the copy is faithful and meets the hard limits. A proposal
  opens from its own group at the top of the picker as an UNSAVED working copy (`activeDesignId` null,
  `activeProposalId` set), so save, rename and delete all treat it as new: the first save asks for a name
  (`proposalCopyName`, "<name> — copy") and creates a design, and a proposal id never reaches Firestore.
  Compare offers them. Generate while one is open builds a NEW unsaved design beside it, never over it.
  A workspace with nothing saved keeps its empty state, which offers "Open a shortlisted proposal" —
  nothing is opened for you.
- **Keep only the shortlist** (owner, 2 Nov 2026: *"Put the new shortlist proposals as the saved options
  in the links designer. Remove the older ones"* — and then *"The shortlist should be read only"*). The
  ··· More sheet offers the admin one press that moves every design last saved before `OLDER_BEFORE` to
  Recently deleted, after a dialog naming each one and who last saved it. Each move is `binIfStill`,
  which asks the rule again inside its transaction, so a design saved since the dialog opened is spared.
  **The shortlist is not touched**, and the row disappears once nothing older is left. **It is one
  deliberate press, not a move on page open**: "older" is every saved design, whoever saved it, so an
  automatic move would name the first device to open the page as having deleted everyone else's work,
  and would act on every page load that meets an old design, the test suite included. Reasoning:
  `links-shortlist.js`.
- **Designs drawn for the previous length go to Recently deleted** (owner decision, 3 Oct 2026).
  `isPre26Design` in `links-design-doc.js` needs ALL THREE: last saved before `LINK_26_FROM` — the START of
  the release day, UTC, because the end would bin a design begun on the new page that day — so a design
  saved or RESTORED since is never moved again; nothing drawn past `PREVIOUS_LINK_LENGTH`; and something
  drawn within it, so a blank design is left alone. `_splitDocs` shows them in the bin at once, and the
  empty state and the status line say so at once (on release day the list is usually empty, and the save
  row that carries status is hidden with it). `_binPre26` then moves each one through `store.binIfStill` —
  a TRANSACTION that re-asks the rule (a design it skips is shown live again) and fails offline rather
  than queueing a write that lands days later. A CACHED read moves nothing and claims nothing moved. A
  restore or purge of a design whose move is still in flight waits for it (`trackBinMove` in
  `links-design-library.js`), or it would meet a not-yet-deleted design and report that "someone else"
  restored it.
- **Designs saved against the OLD length — a longer one — are left as they are.** They keep their surplus
  lines in Firestore: trimming on load destroys work on a page visit, and trimming on save does it at the
  worst possible moment. `#linksOverLengthNotice` says the surplus rows are neither shown nor counted but
  are kept, and every rule reads only lines 1…`ROTATING_LINES`, never the keys a design carries. Keep only
  the shortlist is the way to bin them.

**C. Reen is NOT a special case**: the link is designed as a full rotation so it still works if she
ever leaves, and her adjusted fixed shifts are applied as overrides on the base roster. The fixed-position
model (`FIXED_POS`, `fixed-link-separator`, `fixed-cell`) and the vacant-placeholder model
(`VACANT_FROM`) were both removed; do not add them back. Every row is a normal, editable, rotating row.

## Concurrency and load safety

**Every design write goes through `links-design-store.js`** (`createDesignStore`, with the Firebase
handles injected by `links-app.js`); the coordinator makes none of its own. The store's header is the
authority on the reasoning, and owns four rules:

1. **A read that a write depends on happens INSIDE the write's transaction**, not before it, so the
   decision is true at commit.
2. **No weaker fallback while online.** Only a failure `isOfflineFailure` recognises may take the queued
   path (after consulting the cached document for a deletion or conflict); an online transaction failure
   is reported, and the unsaved state is kept.
3. **The baseline (`revision`) advances only to a revision the store verified.** Anything else sets
   `baselineUnknown`, so the next save asks (invariant 5).
4. **A queued (offline) write is started, not awaited, and never stamps a revision a colleague's online
   save could also produce** (`queueWrite`, `queuedRevision`) — a save, a rename, a create (named with an
   auto-id `doc(col)` so that it can be queued) and a soft delete alike.

A conflict comes back as `{ status: 'conflict', conflict }`, and `links-app.js` decides whether to ask,
overwrite or fork — the store never asks. A design deleted elsewhere, binned or removed for good, comes
back as `deleted-elsewhere` — a save's status, a rename's thrown error — and neither recreates it nor
renames it in the bin. A rename on a stale baseline writes the name and the revision but not
`updatedBy`, or the next conflict dialog names you as the person whose version
you are about to replace. The pure comparison rules (`conflictOf`, the baseline helpers) are
`links-concurrency.js`. A failed load sets `loadFailed`, and the empty state says so. The store's
rules are pinned in `links-design-store.test.mjs`, the comparison rules in `links-concurrency.test.mjs`.

The workspace's own rules, in `saveChanges`:

- **Consent is per VERSION.** "Replace their changes" names the one version the dialog showed; if
  somebody saves while it is open, the store refuses, and the question is asked again about the new
  version (a bounded number of times). Declining offers "Save mine as new", worded like the conflict
  dialog it answers — "That version" for your own name, "Their" otherwise.
- **"Saving" is PER DESIGN** (`savingKeys` — by id, or `'unsaved'` for any first save, never the design
  object). A write that cannot finish must not lock every other design's Save, and a window edit or a
  generator apply that replaces the object mid-save must not let a second press create a second design.
- **A queued save does not say "✓ Saved".** It says *Saved in this browser — it uploads the next time
  Links is open here with a connection*, without the success colour (iPhone audit, Nov 2026: "when
  you're back online" promised an upload a closed page cannot make). It still clears `dirty`: the write is in the device's
  persistent queue, a re-save would only queue a duplicate, and a leave-page warning would claim work is
  at risk that is not. Nor does the masthead's pill say "Saved": while a design's last write — a save,
  a new design, a copy or an import — is only in this browser's queue, it reads "Saved in this browser". An online
  create the server has not answered within `SLOW_SAVE_MS` is queued the same way.
- **`dirty` clears only if nothing was edited while the save was in flight**, and the payload recorded is
  the one actually WRITTEN, window and revision included.
- **A save that finds its design deleted drops it from the live list even when the page has moved on**
  to another design; only the conversation is skipped.
- **An online save that cannot confirm its outcome** (a sign-out mid-save) says to check, and the work
  stays unsaved (`unconfirmedWriteLine`).

**Residual accepted limit** (`conflictOf`'s header): with the baseline unknown, two devices under the
SAME display name (`updatedBy` equal) do not conflict-prompt — inherent to identifying editors by name.

## Print

A4 landscape: the grid, coverage and checks. The generator, brush bar, picker, save row, tips, chevrons
and the window editor are hidden.

- **The whole rotation must land on ONE sheet** — a rotation split across two pages cannot be judged.
  The constraint is A4 landscape's printable height at 1cm margins (718px), not any row size: rows are
  21px, the cell text 8px at line-height 1.15, and the grid card's own header is dropped because the
  masthead names the sheet. `links: the print button prints, and a work-in-progress sheet says so`
  asserts that the grid card fits under print media. If the rotation, the cell font or the masthead
  changes, re-measure.
- **The coverage card and the checks card's triage block must not straddle a sheet**
  (`break-inside: avoid`). Split, the heat map put Sunday on a different piece of paper, and the triage
  list arrived without its heading. **The GRID card deliberately does NOT get that rule**, and the e2e
  pins its absence: it is the sheet the masthead belongs to and starts page 1, and a rule that could push
  it to page 2 works against the one-sheet constraint.
- **A screen measurement cannot see any of this.** On screen the page is one continuous column; print is
  its own render, and the only way to review it is to produce the document.
- **The Print button** (`#linksPrintBtn`) sits in the sticky save row, outlined, because two filled buttons
  would compete and saving is the one that matters; the save row is hidden on paper, so it costs the
  sheet nothing. It goes through `printOrExplain` (`print-guard.js`): in a home-screen app on iOS
  `window.print()` does nothing, so the tap explains and offers Safari. It prepares the sheet itself
  before printing (`_preparePrint`, the function `beforeprint` also calls) rather than relying on the
  event.
- **The masthead carries provenance, and must say when that provenance does not describe the sheet.**
  `#printDesignName` names the design, who last saved it and when (a proposal: its ref, "built into the
  app"), the staffed window (marked "(moved)" when it is not the default), and the date and time printed,
  stamped at print time so a page left open for a week cannot print a stale date. **The provenance reads
  the SAVED document while the grid prints the LIVE patterns**, so with unsaved edits the masthead
  appends **"· includes unsaved changes"**. Printing a work in progress is reasonable, so this states the
  fact rather than blocking the print — but do not remove it: the sheet goes to the assessing manager,
  and a misattributed proposal is the same false-assurance failure the fatigue panel is built around.
  Pinned by an e2e that prints clean, then edits and prints again.
- Coverage and Design checks keep their card headers on paper: they are separate sections a reader needs
  named.

## Sticky headers

- **The grid's day header sticks from 768px up.** Below that the table really does overflow, so the
  wrapper is `overflow-x: auto`, which makes it a scroll container and leaves the sticky `thead` inert
  (an accepted phone constraint, KNOWN_LIMITATIONS.md → Links). From 768px the table fits, the wrapper is
  `overflow-x: visible`, and the header sticks. It fits there only because, below 1024px, the totals'
  names and the days note may wrap (`links.css` has the measurements). At large Android text it still
  clips the last totals column at the narrow end of that band, and keeping the sticky header against
  restoring the scroll container is the owner's decision (KNOWN_LIMITATIONS.md → Links). Do not add a
  `max-height` without resetting it at that breakpoint and in `@media print`, where a clipped sheet is
  silent on screen.
- **The paint bar sticks above the day header from 768px on a fine pointer**, and the header sticks
  beneath it at the bar's measured height (`--brush-bar-h`), so the lower lines can be painted without
  scrolling back up. Not on a phone, where the bar is already counted as a cost to the screen.
- **`.card` is `overflow: clip`, not `hidden`.** `clip` keeps the rounded corners without creating a
  scroll container, which both the sticky `thead` and the sticky save row need.
