---
paths:
  - "links.html"
  - "links.css"
  - "links-*.js"
  - "links-*.test.mjs"
---

# Links workspace — full architecture

> **The `paths:` list above uses GLOBS, and must stay that way** (fixed Aug 2026). It enumerated five
> filenames from the extraction-programme era and had silently stopped covering **nine of the
> sixteen** Links files — every module added since (`links-analysis`, `-compare`, `-concurrency`,
> `-deletion`, `-fatigue`, `-boot`) plus their tests. Editing any of them did not surface this
> document, which is the one place the workspace's decisions are written down. Same failure as the
> enumerated class list fixed at v19.49 and the `selectBackupKeys` prefix scan: a hand-maintained
> list stops covering what arrives after it, and nothing says so. `paycalc.md` already globbed.

## What is in this file

A long file, loaded whole whenever a Links file is edited, so here is the shape of it. (This line
carried its own line count until the v20.54 docs sweep, by which point the figure was out by nearly
400 — a self-measurement is stale the next time anyone edits the file it measures, which is the same
rule `doc-parity.test.mjs` applies to suite sizes. Say what is in it, not how big it is.)

| Where | What |
|---|---|
| **The module set · Access control** | every module, and who may read/write a design |
| **Design and save model** | the Firestore shape, the grid, paint mode, the operating window, the heat map |
| **Design checks** | the two halves of the checks card — **hard limits** (meet or cannot run) above **fatigue factors** (advisory, never pass/fail) |
| **The generator** | what it is, its two constructions, the line-order objectives, the removed uplift control, its layout |
| **Page-wide review findings** | the v19.66 mobile gaps and blank-page work — about the PAGE, not the generator |
| **The rest** | line numbering, concurrency, print, sticky headers |

**Read the module header before changing any rule.** Most of what follows is a record of something
that shipped wrong once, and the reasoning is usually more load-bearing than the code it describes.

## The module set

The workspace is one coordinator over the pure/extracted modules below. Everything except `links-app.js`
is testable without a browser, which is deliberate — the coordinator is where the Firestore and DOM
state lives, and the rules that have historically produced bugs have been pulled out of it.

**The table is the count.** This sentence read "twelve" while the table under it listed thirteen:
`links-design-doc.js` was added at v19.94 and the prose was never swept, so the two disagreed for
the whole of v20. A number written beside the list it describes is a second copy of that list — see
`doc-parity.test.mjs`.

| Module | Owns |
|--------|------|
| `links-app.js` | coordinator: Firestore, grid, paint, picker, save/dirty state (+ `links-boot.js`, the CSP bootstrap) |
| `links-design.js` | the design maths — classification, coverage, the generator, `runDesignChecks`, `endMinutesAbs` |
| `links-fatigue.js` | the ORR p3 fatigue factors — ADVISORY, never pass/fail (v19.46) |
| `links-limits.js` | the HARD limits — meet them or the design cannot be run (v19.80; named `links-legal.js` until v19.91) |
| `links-window.js` | the staffed OPERATING WINDOW — when the station is open (v19.54) |
| `links-demand.js` | the SERVICE that window has to cover — trains per hour (v19.56) |
| `links-analysis.js` | the two read-only panels — Coverage heat map + Design checks — rendered from those pure results |
| `links-compare.js` | compare mode; sole owner of `compareMode`/`compareDesignId` |
| `links-concurrency.js` | the co-editing rules (three historical silent-overwrite bugs, one test each) |
| `links-deletion.js` | the soft-delete/restore/purge rules |
| `links-adjacency.js` | what happens BETWEEN the lines — the ORDER they sit in (v19.58) |
| `links-seed.js` | the generator's TARGET SEED — read the real roster, produce the starting targets (v19.92) |
| `links-design-doc.js` | the SHAPE of a design in memory and in Firestore, and every conversion between (v19.94) |

## Access control

- `NAV_PAGES` entry has `linksDesignerOnly: true`. `initNavPanel({ isLinksDesigner })` filters it out for non-designers.
- Each page passes `isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(member)`. `links-app.js` passes `isLinksDesigner: true` (page already guards non-designers, redirecting to `admin.html`).
- To grant access: add name to `CONFIG.LINKS_DESIGNERS` in `roster-data.js` — every page derives `isLinksDesigner` from that list. Current designers: `'G. Miller'`, `'S. Silva'`, `'M. Robson'`.
- **Two more steps, or the new designer can open the page and not save a thing.** The client list only decides what the nav and the page gate show; the `linksDesigner` CLAIM comes from the server-owned `functions/roster-members.json`. So (1) run `npm run generate:roster-members` in the same commit — `sw-asset-check.test.mjs` fails the build if it drifts — and (2) after deploy, run **Operations → Set up accounts**, which is what actually mints the claim. Until then every save permission-denies (`writeWithClaimRetry` refreshes the token, but a refresh can't invent a claim the server never set).
- **Server-side (the real control):** `linkDesigns` writes require the `linksDesigner` or `admin` claim (H2, v16.29). **Reads require a `name` claim** (v19.39) — a session that has actually signed in as a member. The previous `request.auth != null` was intended as "any signed-in member", but the calendar signs every visitor in anonymously, so it admitted anyone who could open the app URL. Reads are deliberately NOT gated on `linksDesigner`: a designer whose token predates that claim has to be able to LOAD the page for the write self-heal (`writeWithClaimRetry`) to get its chance to run.
- **Delete is a soft delete (v19.41).** `✕` writes `deletedAt`/`deletedBy` (a MERGE write — a replace would push the deleting device's copy of `patterns` over the server's) and the design moves to **🗑 Recently deleted**, where it stays until somebody removes it by hand. `SOFT_DELETE_RETENTION_DAYS` (30) is now **DORMANT — it drives nothing, and nothing says it to a user**. Automatic purging was suspended at v19.86 (no client-side age check survives a device clock running 30 days fast), and at **v19.96** the last visible copy quoting it went too: the row label counted down to "removed for good in N days" **in the same dialog** as the panel intro reading "Nothing is deleted automatically" — one screen, two mutually exclusive explanations (external review P2). The real behaviour is SAFER than the promise was, which makes it a trust problem rather than a data-loss one; a designer who believed the countdown might reasonably have hurried, or written the work off. (This bullet said "then purged on load" until v19.94, contradicting the first-visit notice two sections below.) Restore clears both fields with `deleteField()`. All the decisions are pure and tested in `links-deletion.js`; the coordinator owns only the Firestore calls and the panel. Notes that matter when changing this:
  - **`isDeleted` and `isPurgeable` are not mirrors.** An unresolved `deletedAt` — what `serverTimestamp()` reads back as on the writing device — is DELETED but never PURGEABLE. Both directions are load-bearing and both have tests.
  - **A save against a design someone else deleted does not resurrect it.** `saveChanges` detects the deletion in the transaction and offers "Save mine as new" instead — an overwrite there would be one designer undoing another's delete without ever seeing it.
  - **A hard delete re-reads the server inside a TRANSACTION** (v19.84, external review P1).
    "Remove for good" used to call `deleteDoc` on the strength of the list loaded when the bin was
    opened — so if a colleague restored a design in the meantime, pressing that button on the now
    stale row **permanently destroyed a live design somebody had deliberately rescued**. The
    auto-expiry sweep two functions away already carried a comment explaining why that is unsafe;
    the manual path, which is the likelier of the two (a human on a stale list beats a sweep landing
    in the same window), ignored it. On `design-restored` the bin says so and reloads rather than
    offering a retry. `firestore.rules` now also requires `deletedAt` to be present for a hard
    delete, so a future client with the same bug can only fail — the rules test that asserted a
    designer *could* hard-delete a live design was asserting the hole.
  - **Do not reconnect the 30 days to visible copy until the age comes from the SERVER** (a scheduled Cloud Function). A countdown is a promise, and this one went on being displayed for ten versions after the thing that would have honoured it was switched off. See KNOWN_LIMITATIONS.md → Links.

## The beta marker — REMOVED v19.50

The header carried a gold-OUTLINE `.beta-chip` ("Beta") beside the "🔗 Links" `.badge-page` from
v12.33, with a finite `beta-sheen` sweep (v18.31). Owner decision, Aug 2026: the workspace is the
tool the December 2026 proposals will actually be built in, so it is no longer being announced as a
sketch. The chip, its keyframes and the reduced-motion override are gone; `.header-end` stays, since
it is the flex wrapper the page badge lives in.

## First-visit notice (rewritten v19.51)

`#linksWelcomeLb` — one-time, `createLightbox`, gated on `myb_links_welcome_seen`, **14-day expiry**
(owner, Aug 2026; the skill's default is 28). It replaced the v12.33 beta notice, whose lead
paragraph — "this is an early beta… the finished version will look quite different" — described a
page that stopped existing at v19.50. Only the paragraph that was still true survived; it now sits
with two more, chosen for what a first-time visitor could otherwise get **wrong**:

1. Changes affect the link-design document only, never the live roster. Desktop or tablet.
2. The Design checks report which ORR fatigue factors a pattern **features** — they do not pass or
   fail a design and nothing here approves one. (The panel says this too; a designer who reads only
   the first screen should still not be able to mistake a clean panel for an approval.)
3. Designs are shared, and a deleted one stays in the bin until someone removes it (v19.86 — it used to promise 30 days; the row labels stopped promising it at v19.96).

**It took a NEW storage key.** Reusing `myb_links_beta_seen` would have meant every current designer
— all three of whom closed the beta notice months ago — never saw the replacement, which is the whole
point of bringing it back. The e2e specs seed the new key; the old one is left on devices as an inert
flag.

**Know what expiry does before setting one.** `isNoticeExpired` marks the notice seen *without
showing it*, so from ~16 Aug 2026 this lightbox is dead code on any device that had not already
opened the page. That is correct for an announcement — and it is why both of the app's previous
notices sat silently inert. CLAUDE.md's notice table now carries a Status column so that state is
visible rather than inferred.

## Design and save model (v12.09, redesigned v12.39–v12.43, multi-design v12.46–v12.47)

### Card order (v12.46)
Grid (primary object) → Auto-generator (collapsed by default) → Coverage (hourly heat map) → Design checks. The generator sits directly beneath the grid because it is the only way to create a new design.

### Firestore model (multi-design, v12.46)
`linkDesigns` is a **collection** of named design documents `{ name, patterns, window, updatedAt, updatedBy }` with auto-IDs. The legacy singleton `linkDesigns/combined-28` (no `name` field) is auto-migrated to a named design ("Design 1") on first load and thereafter ignored — never write to it.

**Every doc ↔ object conversion is `links-design-doc.js`** (v19.94). Eleven sites in the coordinator
built these by hand in four shapes, two of them near-identical copies of the same write payload, and
a field left out of one site is not an error — it is a design that quietly loses something. That has
happened twice:

- **v19.55** — the bin kept `patterns` but not `window`, so a restore handed back a design wearing
  the app default and the next save wrote that default over the moved boundary it was built to. The
  proposal still looked fine; it was simply no longer the proposal.
- **v19.94, found by this extraction** — the `combined-28` migration was the ONLY read path that
  skipped `normalisePatterns`, into memory *and* into the new document, so an unpadded
  `"6:00-14:00"` was persisted uncanonicalised: counted in the day totals while `startMinutes`
  returned null, i.e. invisible in the heat map and exempt from every turnaround check, for good. Of
  every document in the collection that is the one **guaranteed** to be legacy, and it was the one
  that skipped the legacy handling. It also wrote no `window`. It survived because it is gated on
  `named.length === 0` — it runs once, for one document, on a visit nobody watches.

Three rules the module exists to hold:

- **Every shape carries `window`.** It is what the heat map measures gaps against, so a design that
  loses it is assessed against a span nobody chose.
- **Everything arriving FROM Firestore is canonicalised; nothing already in memory is re-normalised.**
  The asymmetry is deliberate and is why this was a design job rather than a sweep.
- **The working copy DEEP copies its patterns.** The grid writes `patterns[pos][day]`, so a shallow
  copy would let an edit mutate the `designs[]` entry the concurrency baseline is compared against.

`docPayload` emits exactly the five keys `firestore.rules` allows. An extra key does not warn — every
save permission-denies, on every device, until the rules catch up, and hosting and rules ship from
the same push through separate workflows with no ordering guarantee.

A picker strip switches designs: **+ New** (blank), **⎘ Duplicate** (forks the LIVE in-memory patterns, unsaved edits included), **✎ Rename**, **✕ Delete** (disabled on the last design). Designs sort by name; the active design id persists via `lsGet('myb_links_active_design')`. Picker chips are a `<div>` wrapping separate `<button>`s — **buttons must not nest**.

### Compare mode (v12.46)
With ≥2 designs, shows two read-only grids side-by-side (≥1024px) or stacked, with a gold-outline diff on differing cells. Each compare column keeps `overflow-x:auto` even on desktop. The main grid stays **rendered** in compare mode — hidden on screen only (`body.links-compare-on` + `@media screen`) so print always outputs the active design. A print-only `#printDesignName` label names the printed sheet.

### patterns data shape
`patterns` is `{ "1"–"<ROTATING_LINES>": { sun, mon, tue, wed, thu, fri, sat } }` (each value a shift string, `"SPARE"`, or `"RD"`). **Position keys:** always `String(pos)`, never `Number`.

Staff names were removed at v12.39 — the design is patterns-only ("Line 1", "Line 2"…); who goes on which line is decided after patterns are agreed. Legacy `meta` in old docs is ignored on load and dropped on next save.

### Pure-maths module
All design maths live in `links-design.js` (no DOM, no Firebase; tested by `links-design.test.mjs`). `links-app.js` imports them; **do not duplicate them back into the app file.**

**The export list lives in `AI_MAP.md`, not here.** This paragraph used to carry its own copy and it had gone stale — missing `worstCaseWorkedRun`, `SPARE_WORKED_DAYS`, `canonicaliseShift`, `normalisePatterns` and `ROTATING_LINES`, all of which are load-bearing and several of which have their own rules further down this file. CLAUDE.md names AI_MAP as the authoritative export list; a second copy in a second file is a list nobody updates and everybody half-trusts.

### Save and dirty flag
Single dirty flag + one `linksSaveBtn` / `saveChanges()`. Grid clicks are **delegated** on `#linksGridBodyRows` — do NOT call `renderGrid()` from inside `saveChanges()`.

**Unsaved-changes guard:** `beforeunload` + explicit `confirm()` on sign-out, logo navigation, and a capture-phase click guard on nav-drawer links (mobile browsers suppress `beforeunload` dialogs).

### Aesthetic conventions (v19.43 polish pass)

- **A brush chip shows BOTH times, on two lines, exactly like the grid cell it paints.** It showed the start only until v19.43, and the roster has five distinct shifts starting 06:20, three starting 08:00 and so on — so the bar rendered as seven pairs of visually identical chips that paint different shifts, with the start time in `title` and `aria-label` too. Nothing anywhere disambiguated them. Do not "tidy" this back to a single time.
- **The picker strip is always visible**, even with no designs: the empty state tells you to tap `+ New`, which lives inside it, and the bin button lives there too.
- **`.design-chips` uses `min-width: min-content`, not `0`.** `0` lets a flex item shrink below its own contents, and the chips are `nowrap` — at 390px the box collapsed to 50px while the active chip stayed ~120px and its ✎ ✕ painted on top of "+ New".
- **Overlay panels take their surface from an id rule or a modifier class** — `.lb-content` alone is only transform/scroll/cursor. The Recently-deleted panel shipped at v19.41 with the bare class and rendered as a transparent box (heading and prose in navy on the dimmed backdrop). It now joins the compact-dialog family, and `e2e/visual.spec.js` has a baseline for it, because behaviour tests cannot see this.
- **Row actions reuse `.dialog-btn` + `.dialog-btn-confirm`/`-cancel`** from shared.css rather than a page-local recipe — that brings the 44px touch target and press feedback with them.
- **The Design checks card is a 30-row list, so it needs structure, not just rows** (v19.49). Three things carry it, and each replaced something that read as noise: `.check-section-head` gains a **hairline rule** and its **headline counts** at the far end (`3 present · 2 standing · 3 to confirm`) — a small uppercase label alone was not enough weight to break a ribbon of same-height rows, and the reader should not have to tally 24 icons to get the summary; `.check-code` is a **fixed-width tag** so the FF numbers align down the left edge (they were `.check-note`, the faintest thing in the row, running inline with the title and vanishing into wrapped prose on mobile — cross-referencing the ORR's own p3 list is the panel's whole job); and `.check-family` names the ORR's **families**, without which the code column read as shuffled. The factors are also ordered by number **within** each family. Counts keep `present` and `standing` separate — an unavoidable characteristic of the operation is not a finding about the design, and one combined total would say it was.
- **The Design-checks card carries a three-part rhythm, and each part has been broken once**
  (v20.00 pass). `.check-code` is a **fixed `width`, never `min-width`** — 44px aligned the tags'
  own left edges while `MRSF` and `FF8b` overflowed it, so the TITLES after them wandered over 20px
  (measured 221–241px at 1440) down a 30-row list. A fixed width buys alignment at the cost of a
  ceiling that CSS does not enforce, so `links-analysis.test.mjs` asserts no rendered code exceeds
  it *and* that the declaration is still `width`. And the "nothing to report" disclosure's body
  carries a **left rule**: the panel groups by ORR family then splits by status, so three families —
  Time of day, Recovery time, Cumulative — legitimately render a heading twice, and without a
  nesting cue the second set reads as a repeat rather than a continuation. The print block resets
  both the rule and the indent, because print flattens the disclosure entirely.
- **The sticky summary strip names its design in compare mode, and only there** (v20.00). Every
  figure in it comes from the ACTIVE design; with two grids on screen an unlabelled
  "N lines designed · All service covered · N fatigue factors" reads as a verdict on the
  comparison. `initLinksAnalysis` takes an `isComparing` thunk (the coordinator forwards
  `compare.isCompareMode()`), and a neutral `.sum-chip--who` leads the row. It carries **no status
  tint** deliberately — a fourth coloured chip would read as a fourth finding. Naming the design was
  chosen over hiding the strip: a designer comparing options still wants live analysis of the one
  they are editing.
- **Accepted, not fixed:** each compare column keeps `overflow-x: auto` with no scroll affordance, so at 1280px both grids clip mid-column with nothing indicating they scroll. Adding a fade would fight the gold diff outline; the alternative is a narrower cell, which hurts the primary (single-design) view. Revisit only with a real complaint.

### Paint mode (v12.39)
A brush chip bar above the grid (`#brushBar`) — clicking a chip arms that shift; clicking grid cells then applies it directly (no dropdown); clicking the armed chip again or pressing Escape disarms. With no brush armed, a cell click opens the dropdown as before. `.shift-cell-btn` and `.brush-chip` set `touch-action: manipulation` — paint mode is rapid tapping, which otherwise triggers double-tap zoom on iOS/Android.

### Night shifts
**CEAs do not work night shifts (confirmed by Gareth June 2026)** — night times are never offered in any dropdown or brush chip. `normaliseCustomShift()` rejects starts between 21:00 and 03:59 **and any wrapping (past-midnight) end**; do not re-add a Night option and do not relax either guard. `classifyShift`'s `night` return is defensive only (legacy/imported data).

**A duty that does run past midnight is read in ONE place — `endMinutesAbs`** (v19.47). Before it, `calcHourlyCoverage` and `runDesignChecks` each carried their own inline expression and both erred the same way, towards *safer than the truth*: the heat map clamped the end to 24:00 and simply lost the post-midnight hours, and the turnaround check computed `(1440 − end) + start`, so a 00:30 finish before an 06:20 start reported ~26h of rest instead of 5h50 — the most dangerous turnaround the module can express, scored as compliant. The heat map now counts such a duty on **both** days (Sat spills round to Sun) and `links-fatigue.js`'s `dutyMinutes` delegates here. This is only reachable through legacy/imported data — the same route `canonicaliseShift` exists for — which is exactly why it is worth keeping correct: nothing exercises it, so nothing would tell you.

**Shift option lists:** `EARLY_SHIFTS` / `LATE_SHIFTS` derived from `weeklyRoster` + `bilingualRoster` at module load — never a static list. **Custom time…** validated by `normaliseCustomShift()`.

### The staffed operating window (v19.54)

Stored on each design as `window` (`{monSat,sun}:{start,end}`), defaulting to Mon–Sat 06:20–23:55 ·
Sun 07:15–23:25. All the rules are the pure `links-window.js`; the coordinator owns only the editor
on the Coverage card and the Firestore field.

**It exists because the heat map could not see missing cover at the ends of the day.** The span ran
first-worked-hour → last-worked-hour and a gap had to fall strictly between them, so a design where
everybody finishes at 14:20 — leaving the station unstaffed to the 23:55 close — showed **no gaps at
all**. It now shows 71. Span and gaps both come from the window; an hour outside it renders
`heat-closed` (hatched, inert) because a shut station is not a hole in the cover and must never look
like one.

Three rules that are easy to undo by accident:

- **Compare mode diffs CELLS, not windows.** Two designs built to different spans would read as like
  for like — the per-design override becoming a way to make an unfair comparison look fair. Both
  column headers state the window and `windowsDiffer` flags a mismatch; the printed masthead states
  it too. Never render a comparison without them.
- **`normaliseWindow` falls back per ROW, never per FIELD.** A good Sunday survives a corrupt
  Mon–Sat; a stored start is never paired with a default end, because that invents a window nobody
  chose and then prints it as deliberate.
- **TEXT inputs, not `<input type="time">`.** Chromium renders that widget in the OS's 12-hour
  format *even at en-GB* (measured in both locales), which would put "11:55 PM" beside a grid, heat
  map and window line all reading 23:55. `canonicaliseWindowTime` does the padding.

Three things the v19.55 pass fixed, all found by driving the page rather than reading it:

- **A design carries its window through the BIN.** The bin kept patterns but not the window, so a
  restore handed back a design wearing the app default — and the next save wrote that default
  straight over the moved boundary it was actually built to. Same class as the v19.41 restore bugs.
- **`renderCoverageCard()` renders the chart AND the editor**, in one call. They are one card, and
  as two calls every site had to remember both. The generator — the only way to create a design —
  refreshed the chart through `renderGrid` but never painted the editor, so a designer's very first
  link had no visible window control until they reloaded.
- **`.win-editor[hidden] { display: none }` is mandatory, not tidiness.** An author `display` rule
  beats the `hidden` attribute's UA `display:none`, so the editor rendered on a page with no design
  at all. Missed on the first pass because the probe read `el.hidden` — the property, correctly
  true — instead of what the browser actually painted.

The window is stated **once** on screen: by the editor's own fields, under a "Staffed window"
eyebrow. A prose line repeating the same two times 20px below it was removed — duplication like
that reads as a second, possibly different, fact. On paper the editor is hidden and the print
masthead carries it. The reset control reuses `.btn-text-link`, this stylesheet's existing small
text button, rather than a second link-button recipe.

An invalid pair (finish at or before start) is **refused, not coerced** — and the refusal message is
written AFTER the repaint, because `paint()` rewrites the status line from the stored window and
would otherwise wipe it in the same tick, leaving the field to appear to revert for no stated reason.

### Coverage heat map (v12.40; demand overlay v19.56)

The Coverage card renders an **hour-by-hour table** (`calcHourlyCoverage`) — rows = days, columns = hours spanning the staffed window, cell = on-duty headcount, intensity buckets `heat-b0`–`heat-b5` (color-mix tints of `--cov-early`, scaled to the week's peak).

The station is staffed in **waves** (opens ~06:20, morning build 07:00–08:30, middles 11:00–12:00, afternoons 13:30–14:30, closes 15:00+) — do not revert to per-type stacked bars. A red `0` inside the staffed window marks a coverage gap; spares get their own `SP` column. The grid `tfoot` keeps compact per-day `E:/L:/SP:` counts.

**Beneath it, three DEMAND rows** (`links-demand.js`) — the December 2026 service, one row per day class, in the **same table** so a reader comparing cover against service is comparing columns rather than fighting two horizontal scrolls. Rules that are easy to undo:

- **A different hue is load-bearing.** Demand uses `--cov-late` orange against the cover's `--cov-early` blue. Two rows of the same colour in one table mean two different things in two different units (people · cars), and the eye reads the darker one as more of the same.
- **Separate scales, stated.** Each half is shaded against its own peak; the note tells the reader to compare shapes, not depth of colour.
- **Never score the design.** No "covers N% of demand". Same principle as the fatigue panel — show, do not decide.
- **The finding/fact split is the anti-cry-wolf rule.** `uncovered` (open, trains running, nobody on) is a finding and renders red. `outside` (trains when the station is shut) is a neutral fact: the last trains and the 05:5x first departure are outside the window on **every** design there has ever been, so flagging them would fire forever and teach the reader to skip the row.
- **Ask the boundary question to the MINUTE, never by the hour.** This shipped broken once. Sunday closes at 23:25, so `isHourStaffed('sun', 23)` is TRUE and an hour-level test reported the five post-23:25 movements as fully covered — the one live finding the feature exists for, invisible in it, with a green unit test that used a synthetic whole-hour window. `summariseDemand` takes the window in **minutes**, and the profile stores **times**, not hourly buckets, precisely so the hourly question cannot be asked by accident.
- The `dem-shut` cell marker comes from the same summary the prose reads, so a marked cell and a named movement can never disagree. It marks hour 06 as well as hour 23 — three weekday trains run before the 06:20 opening.

### The sticky summary bar (v19.57)

The grid card's save row is `position: sticky; bottom: 0` and carries three live figures plus a jump
link. **It exists because the feedback loop was broken by distance**: the grid card is ~1,400px tall
and the Coverage and Design-checks cards start ~1,600px and ~2,300px below the fold (measured at
1440×900), so editing meant paint a cell → scroll two screens → read → scroll two screens back. The
analysis already updated live; you could not see it happen.

- **Which three, and why not others.** Lines still undesigned (nothing else matters until it is zero),
  staffed hours with trains and nobody on duty, and fatigue factors **present**. `standing` is
  deliberately excluded — an unavoidable characteristic of the operation is not something an edit can
  improve, and putting it in a number the designer is trying to drive down tells them to chase the
  unchaseable. It is **not a score**, for the same reason the panels it summarises are not.
- **`renderSummary` recomputes rather than reading the other renderers' results.** Duplicated WORK,
  not duplicated LOGIC — each figure still comes from the one pure function that owns it — bought in
  exchange for order-independence. Shared state would make the strip silently wrong whenever a caller
  ran the three renderers in a different order, which renders fine and tells nobody.
- `sticky` works here without a scroll container because the card uses `overflow: clip` at ≥1024px
  (chosen for the sticky `thead` precisely because it does NOT create one). The bar keeps its place in
  flow, so it can never cover the last grid row.

### Design checks (v12.39, completeness added v12.41; fatigue factors added v19.46; quiet rows collapsed v19.57)

The card has **two halves**. The first is `runDesignChecks(patterns, ROTATING_LINES)`:
- **Unfilled lines** (any line that is entirely rest days is *not yet designed*, not a vacancy)
- Weekends off (Sat of line w + Sun of line w+1, wrapping)
- Short turnarounds (<12 h rest between consecutive timed shifts across the full circular rotation)
- Longest consecutive-worked-days run
- Early/late balance

Renders plain-English traffic-light rows (completeness first); updates live on every cell edit / generate. Every line rotates and is checked.

### Hard limits vs advisory factors — and why the module is no longer called "legal" (v19.91)

`links-limits.js` (`assessHardLimits` → `HardLimitCheck[]`) renders in its own section **above** the
ORR factors, in red on a breach, and **whether it passes or fails** — the printed sheet goes to the
assessing manager, so "checked and met" has to be on it.

**The 13-consecutive-day limit is CHILTERN's, carried in company policy** (owner, Aug 2026). Its
ORIGIN is the working-hours standard the industry adopted after the **Hidden report** into the
Clapham Junction crash of 12 December 1988.

**And that industry standard was WITHDRAWN in 2007** (v19.96, external review P1). The ORR's current
fatigue guidance says the post-Clapham limits were based heavily on what was operationally
achievable at the time rather than on fatigue science, that the group standard carrying them was
withdrawn, and that it now expects duty holders to run a risk-based fatigue management system and
set their own company standards. RAIB's London Bridge report says the same — historic, superseded,
retained only where an individual operator chooses to keep them alongside legal requirements and
local agreements.

Chiltern is such an operator, which is what makes the row defensible: **a company limit with a named
historic origin**. What it is NOT is "the current industry limit" — the claim the panel made from
v19.90 to v19.95 under the heading "Industry limits · Hidden report — must be met". That is the one
failure mode a citation is meant to prevent. A manager who takes the invitation and goes to check it
finds a nineteen-year-old withdrawn standard, and is then entitled to discount every other number on
the sheet.

Four attributions now, each corrected in turn:

| | Said | Wrong because |
|---|---|---|
| v19.80 | "the UK railway legal maximum" | unsubstantiable; printed "cannot be run" in red |
| v19.85 | "Chiltern company limit" | true and safe, but understated the provenance |
| v19.90 | "Hidden report", industry limit | right source, **wrong tense** — presented as current |
| v19.96 | Chiltern policy, Hidden origin | whose limit it is, and where the number came from |

**The tense is now pinned by tests, in FOUR places**, because the v19.90 wording passed every
assertion that existed: it named a real, dated, checkable document. `links-limits.test.mjs` requires
a row naming Hidden to also mark it historic, and forbids any row claiming the limit is
industry-wide today. `links-analysis.test.mjs` pins the **rendered section heading** — which made
the strongest claim on the page, is written as a separate hardcoded string in a different file from
the `basis` it is supposed to agree with, and had no test at all.

**And the fourth was added at v20.00, after the v19.96 sweep turned out to have missed a copy.**
A `.check-sub` on the "Longest run" row — in `links-analysis.js` itself, two rows above the corrected
one — still read *"The Hidden limit is 13."* Neither existing guard could see it, for a reason worth
stating rather than patching around: **both were scoped to where the claim had last been found.**
One reads the objects `assessHardLimits` returns; the other walks sections whose heading claims
something must be met. The stray copy was a plain advisory row making no such claim, so it sat
outside both. The new guard is scoped to the **whole rendered panel**: anywhere the sheet says
"Hidden" the sentence must mark the standard historic, and the 13 may never be attributed to Hidden
as though Hidden still imposed it. Measured limit, recorded in the test: the unit is a sentence, so
one marker satisfies every mention inside it — what it catches is a mention with no marker anywhere
near it, which is what a stray second copy looks like.

**"13 consecutive days" vs the historic "13 shifts in 14 days."** The historic formulation is the
rolling one; this module measures the longest consecutive run. For a one-duty-per-day roster the two
are equivalent in both directions (a maximum run of 13 forces a rest day into every 14-day window;
14 consecutive worked days is 14 shifts in 14 days), and Marylebone CEAs work at most one duty a
day. It is written down because it is an ASSUMPTION, not an identity, and it would fail silently.

**Anything else rendered as "must be met" needs evidence too, and that is now enforced generically**
(v19.97, external review recommendation 5). `links-analysis.test.mjs` requires every section heading
claiming a limit must be met to name whose requirement it is, and every row under it to carry a
source. It is applied to what the panel RENDERS, not to the one section that exists — the three
limits in the table below are already computed and waiting to be promoted, and each could otherwise
land as a bare number in red on a manager's sheet.

⚠️ **The exact policy citation is still OUTSTANDING** — title, clause, which staff group it covers,
and its effective/review date. See KNOWN_LIMITATIONS.md → Links.

### And until it arrives, the sheet says so — `POLICY_SOURCE_CONFIRMED` (v20.08, external review P1)

The fifth correction, and the first one that is not about the wording. ROADMAP.md's evidence gate:
*anything rendered to a manager as "must be met" requires class A or B*. This limit is class **C** —
the owner's account of practice — and the panel said "must be met" over a row printing *"It cannot
be run as drawn."* in red. The app was breaking its own rule in the loudest place it has.

**What changed is the CLAIM, not the check.** The number, the separate module, the section above the
ORR factors, the red on a breach and the render-when-passing are all untouched — demoting any of
those would be answering a sourcing problem with a safety one. What the sheet now says is what is
actually known:

| | Unconfirmed (today) | Confirmed |
|---|---|---|
| Heading | `Configured Chiltern limit — policy source outstanding` | `Chiltern roster policy — must be met` |
| Prose on a breach | reaches N, above the 13 configured here — *confirm the policy before treating that as a decision* | …*It cannot be run as drawn.* |
| `basis` | `Chiltern roster policy, citation outstanding — …` | `Chiltern roster policy — …` |

**`POLICY_SOURCE_CONFIRMED` in `links-limits.js` is the one home of that judgement, and every string
above is DERIVED from it.** That is the structural half, and it is the lesson of the four
attributions in the table earlier: each was corrected by editing prose in two or three files, and
each left a copy behind somewhere nobody was looking. Tests in `links-limits.test.mjs` and
`links-analysis.test.mjs` read the same flag and fail in **both** directions — flag false with the
heading asserting, and flag true with the heading still hedging — so **the day the citation arrives
is a test failure, not an edit somebody has to remember**. Closing it is: put the reference in
`CONFIRMED_BASIS`, flip the flag, run `npm test`.

`data-claim="limit"` on the section head is the tests' anchor. The guard has been re-anchored twice
now — position (broke when a section was added above it, v20.04) and then the phrase "must be met"
(which stopped existing at v20.08, because that phrase was the finding) — and both times the anchor
was the thing under test. A declared marker is not.

**THE OTHER LIMITS IN THAT FAMILY ARE NOT IMPLEMENTED YET, AND THE APP ALREADY COMPUTES THEM.**
This is the most useful thing to know about this section. The post-Clapham set was a family — a
maximum turn of duty, a minimum rest between turns, a weekly ceiling, and the 13 consecutive days —
and only the last is rendered as a hard limit. The others are measured today but shown as *advisory ORR factors*:

| Limit in the Hidden family | Already computed by | Currently rendered as |
|---|---|---|
| Max consecutive days (13) | `assessHardLimits` | **hard limit** ✅ |
| Min rest between turns | `runDesignChecks().turnarounds` (`MIN_REST_MINUTES`, 12h) | FF13, advisory amber |
| Max length of a turn | `dutyMinutes` (FF5 threshold, 12h) | FF5, advisory amber |
| Max hours in a rolling week | `maxHoursInAny7Days` | MRSF row at 55h, advisory amber |

Promoting them is a rendering change plus the confirmed figures — the maths exists. **Do not do it
from recall.** The whole reason this section is three paragraphs long is that a number was once put
on a sheet for an assessing manager with nothing behind it, and it took an external review to unwind.
Get the figures from the policy document, then move the rows and let `links-limits.test.mjs`'s
evidence contract check the citations. Note the weekly row would need its basis deciding too: 55h is
the MRSF's threshold, which is a different source from Hidden's.

**The module was renamed from `links-legal.js` at v19.91** (external review): the visible wording had
been corrected but `LegalCheck` / `assessLegalLimits` / "legal check" comments survived, and a module
called "legal" invites the next maintainer to put the stronger claim back into the UI. The names are
now `links-limits.js` / `assessHardLimits` / `HardLimitCheck`.

**And the rest of that terminology went at v19.96** — the rename had left "legal ceiling" / "legal
check" / "a LEGAL ceiling on the UK railway" in test prose, CSS comments, e2e variable names and
four documents including this one. That matters more than tidiness for exactly the reason the rename
happened: someone grepping the codebase would have found a dozen assertions that the rule is legal,
and reasonably restored the stronger UI wording. The words that remain here are quoted history, and
are labelled as such. The word "legal" survives elsewhere in the repo in unrelated senses (legal
characters in a key, an override that is legal on a Sunday) — those are correct and stay.

**Every hard limit must cite evidence, and that is enforced generically** — not just for the one
limit that exists today. `links-limits.test.mjs` asserts, in every state, that each check's `basis`
is present, names a SOURCE rather than a person or a placeholder (`owner, Aug 2026` is the literal
string the rule rejects — it was the real value until v19.90), carries a date or a document noun,
and that the title quotes the number it was measured against. The lesson behind that generality: all
three attributions were fixed by editing strings, and every test passed each time, because the suite
described the limit rather than the standard it had to meet.

### Fatigue factors — ORR good practice, p3 (v19.46)

The second half of the card, from `links-fatigue.js`. It exists because the December 2026 proposals
will be **assessed** against that list (`LINKS_DEC2026_PLAN.md`), and `runDesignChecks` covered two
of its 24 factors — though **the panel renders 23**, a discrepancy standing since v19.46 and recorded in `KNOWN_LIMITATIONS.md` → Links; check the ORR source before "fixing" either number. Read the module header before changing any rule; the four things that govern it:

- **It reports factors PRESENT. It never passes or fails a design.** The ORR states these are not
  prescriptive limits, so red/green would misrepresent the guidance being quoted. Amber
  (`.check-warn-row`), never `.check-bad` red.
- **The dominant risk is FALSE ASSURANCE**, not a missing rule — a design showing nothing and being
  read as approved. So CLEAR and NOT-APPLICABLE report themselves too: silence must never be the
  same shape as compliance. **Never hardcode a status.** FF13's was hardcoded `clear` for one
  version and put a green tick directly beneath the amber short-turnaround row it is the same
  finding as; it now reads from `runDesignChecks`, so the two cannot disagree.
- **NOT-APPLICABLE ≠ CLEAR, and STANDING ≠ PRESENT.** FF4 called itself "not applicable" while FF3
  was counting the very same duties (fixed v19.48). And FF2 fires on every 06:20 duty, so it is a
  property of the operation — marked `standing` and counted separately, because adding it to the
  findings total would claim the designer could have avoided it.
- **Three definitions are unsettled** (FF17, FF18, FF19) and carry `confirm: true`, rendered as
  "(definition to confirm)". FF18's reading is the one still worth settling with the assessing
  manager *before* the proposals are drawn: on the weekly CADENCE alone no design can avoid it, and
  that belongs in the justify/minimise/control conversation rather than on a checklist.
- **FF18 measures the STEP, and its status is derived** (v19.69). It reported a hardcoded `standing`
  from v19.46 to v19.68 — the "never hardcode a status" rule above, broken for the second time —
  because the factor was originally read as being about the cadence, which is true of every link and
  so made the row informationless. The owner corrected the reading (Aug 2026): the concern is **how
  far the working day moves at each step**, which is a design choice and, since v19.58, measurable.
  The row now reads `scoreOrder` from `links-adjacency.js` and states the typical weekly move, the
  largest, and how many boundaries exceed 2h. **Live main roster: 4h 0m typical / 8h 46m worst /
  9 of 20 over** — quote that as the baseline; the generator's default measures ~1h 35m.
  Two things not to "tidy": the status stays **`standing`** whenever the step is measurable rather
  than turning `present` above some figure — the ORR gives no FF18 threshold, and inventing one is
  the pass/fail rendering this panel forbids — and it derives to **`n/a`** for a design with no timed
  lines, which is the real branch a hardcoded status could not express. The 2h figure is the ORR's
  own FF19 threshold, single-sourced from `GENTLE_THRESHOLD_MINUTES` so the chip and the sentence
  cannot drift from what was actually counted.

Two things about the rules themselves that are easy to get wrong, both caught by their own tests:
**FF11 is not the consecutive-worked-days check it resembles** (a single rest day is not a 48h break,
and a rotation with no 48h break at all returns every worked day, not the sequence length); and
**every rule laps the rotation** — `earlyBlocksWithShortRecovery` was the one that did not, so a
block straddling the last line → line 1 was cut in half and reported as nothing.

Hours totals are a **floor**: SPARE carries no times, so a standby day contributes zero.

**A SPARE WEEK IS FOUR DUTIES OF SEVEN, NOT SEVEN** (v19.79, owner). You are marked SPARE on all
seven days because you are available for cover; four is what you work, unless a Sunday or another
RDW is added on top. Both run checks — `runDesignChecks`'s longest worked stretch and FF11 — counted
all seven, and the comment justified it as "over-reporting is the safe direction for a fatigue
check".

It is not, and the live roster is the proof. A 7/7 spare week **bridges** the blocks either side of
it and fuses them into one phantom run, so the main cycle reported **15** consecutive worked days
against a true ceiling of **9**, and the bilingual **14** against **8**. Four duties cannot fill a
week, so there is always a rest day inside it and a run can take at most four of its days.

**13 consecutive days is Chiltern's roster limit** (derived from the post-Clapham Hidden standard,
which was itself withdrawn in 2007 — see the hard-limits section above) — so a check reporting 15 is not
cautious, it reports a breach that does not exist on the roster people are working today. Anyone
who knows the real link discounts the row, and the next design that genuinely goes past 13 is
hidden by that discount. Over-reporting is only "safe" while nothing is riding on the number.

`worstCaseWorkedRun` in `links-design.js` is the ONE reading; `longestWorkedRun` here delegates to
it. Four things that are easy to get wrong, each with a test:

- **Two ADJACENT spare weeks legitimately chain to eight** — the first week's four duties at its
  end, the second's four at its start. That is the bilingual roster, whose spare weeks are lines 1
  and 8 of 8 and so wrap into each other. Do not clamp the answer to four.
- **FF11 is a different question and needs its own handling.** A spare week's three rest days need
  not be adjacent, so in the worst case it supplies **no 48h break at all** while still supplying
  four shifts. Counting the week as a break would deflate the figure; counting seven shifts inflated
  it. Four, and no reset, is the honest ceiling — which is why the main cycle now reads 12 (clear)
  and the bilingual 15 (over), where both used to read 15.
- **A spare duty following a real 48h break must RESET the count.** The first version of the SPARE
  branch incremented without honouring the reset the worked branch does, and ran straight through a
  genuine break: bilingual reported 23 against a true 15. It was caught by walking the roster by
  hand, because the wrong answer was entirely plausible.
- **The FF11 budget is keyed on the UNMODDED index**, so the second lap gets its own. That lap
  exists to measure a run wrapping the cycle end, and next time round the wheel it genuinely is a
  fresh spare week; sharing the budget silently truncates exactly the run the lap is for.

**Owner's design target is below the 13-day limit, not at it:** ideally a new base link would not
carry even **7** consecutive worked days. The live main roster's non-spare blocks reach exactly 7;
the generator's reach 6.

**Between 8 and 13 the panel reports the SAME figure twice, amber and green — and each row must say
which threshold it was measured against** (v20.00). `runDesignChecks`'s "Longest run" row is judged
against the design target of 7; the hard-limit row 60px below is judged against Chiltern's 13. That
is two different questions and both answers are useful, but unlabelled they read as the panel
contradicting itself — which is the FF13 defect of v19.48 (a hardcoded green tick directly beneath
the amber row it duplicated) arriving in a new form. The amber row now carries
`(design target: no more than 7)` and says in its sub-line that this is an aim rather than a limit;
the green row already stated its 13 and its source. Pinned by a test using a fixture that lands
deliberately in that band.

**The `clear` and `n/a` rows are collapsed behind a disclosure** (v19.57). The card measured 1,799px —
24 rows of which 16 said nothing had happened, so the 8 real findings were diluted five to one in a
card taller than the grid it describes. It is now 1,134px. **This must not be allowed to weaken the
"silence is not compliance" rule**, and three things keep it honest: the counts stay in the
always-visible section heading (with `clear` now among them, which it was not before); the disclosure
is labelled with what is inside; and CLEAR and NOT-APPLICABLE keep their separate icons and wording
inside it. What is hidden is the PROSE, never the fact of the check. `present` and `standing` always
render inline.

Two things that had to be right and were not on the first attempt: the **night-family rollup belongs
INSIDE the disclosure** (outside it, the heading counted 17 clear while the label said 10 — both true,
impossible to reconcile by looking), and **printing must force every `<details>` open**. CSS cannot do
the latter: Chromium hides a closed disclosure's content through an internal slot no author rule
reaches, so a `@media print` override still printed 13 of 24 rows. `links-app.js` opens them on
`beforeprint` and closes them on `afterprint`. The printed sheet goes to the assessing manager, so
silently dropping 17 completed checks from it would be the precise false-assurance failure this panel
exists to prevent.

`links-app.js` also passes a `getBaseline` thunk so the panel can show what **today's** link scores.
It is computed over `weeklyRoster` (20 lines) and `bilingualRoster` (8) **at their own lengths** —
splicing them into one rotation reports a longest run of 19, which is a property of the join and
not of either roster.

> **Section order (v19.94).** Everything about the auto-generator now sits together: what it is,
> how it builds, how the lines get ordered, the control that was removed, then how the card looks.
> The layout notes used to come **160 lines before the generator itself**, with two page-wide review
> sections in between — so the first thing a reader met about the generator was the polish history of
> a card they had not been introduced to. Nothing here was rewritten; the blocks were moved.

### Auto-generator (v12.39, slot-based v12.40; whole spare WEEKS v19.58)
**The only way to create a new design** (v12.43). Targets are a LIST of shift slots — one row per distinct start time, each with separate **Mon–Fri / Sat / Sun** headcounts — plus **one** number: how many whole lines are spare weeks.

**SPARE IS A WHOLE WEEK, NOT A SCATTER OF DAYS** (owner, Aug 2026). A spare line is spare on all seven days: you are cover, you work four days of that week, and you can be put on any range of shifts. The real roster is built this way — main lines **1, 7, 12, 17** are `SPARE` on every day, bilingual **1 and 8**, and there is not one scattered spare day anywhere in it.

The previous model took a per-day-class spare HEADCOUNT and fed it to the rotating window as one more segment. Because the window slides daily, that gave each person spare on some days and a timed duty on others. **The daily SP headcount came out right, which is why it went unnoticed** — the total was correct and the distribution was wrong. `spareLines` whole lines are now reserved and spread evenly around the wheel, and the rotation is built over the remainder; daily targets are still met exactly, and every day shows the same SP count, as the real roster does.

Two consequences worth knowing. The targets are validated against the **working** lines (`lines − spareLines`), so a total that fits the rotation can still be refused. And a spare week counts as **four** worked days in the run checks, not seven — see *A spare week is four duties of seven* under Design checks.

> **This paragraph said SEVEN until v19.94, and it was the pre-v19.79 rule.** The correction > was made in the Design-checks section and never carried back here, so the file argued with > itself 280 lines apart — and this copy also repeated the reasoning v19.79 specifically > overturned ("over-reporting a run is the safe direction for a fatigue check"). It is not: > a 7/7 spare week fuses the blocks either side of it, which reported the live main roster at > 15 consecutive days against a true 9. A reader arriving at the generator first would have > taken away the rule the tool no longer follows.

The table is **seeded from the current roster** on page load via `buildRosterTargets()`. **One rule governs what it samples: the seed must sample exactly what the design represents.** That rule has now been applied twice, in opposite directions, and both failures were silent.

- **v19.59 — the sample was too NARROW.** It took main's 20 weeks plus only the two bilingual weeks the two bilingual members happen to sit on, then applied that 22-line sample to a 28-line design. Bilingual weeks 1 and 8 are the SPARE ones and were never sampled, so the seeded spare count came back as **4** where the combined roster had **6** (main 1/7/12/17 + bilingual 1/8) — two whole lines of standby cover missing by default. Fixed by taking both cycles in full: which weeks two people sit on today is a fact about staffing, not about the roster's shape.
- **v19.98 — the sample became too WIDE.** The design is the main roster widened and excludes the bilingual roster entirely, so seeding from it would target **ten shift times no line in the design can work** (all ten bilingual times are bilingual-only — zero overlap with main's 18). The seed reads the main cycle and nothing else: **18 slots**, measuring **4 spare weeks** (main 1/7/12/17).
- **v20.01/02 — the length change is not visible in the sampling, and that is the design working.** The rotation went 22 → 24; the SLOTS are an observation about the roster and do not care how long the design is. A fifth spare week WAS added to the seed at v20.01 (`EXTRA_SPARE_WEEKS`) and removed at v20.02: the FF11 finding it was meant to relieve turned out to be the line-order optimiser clustering the cover weeks (below), so the reason went and the uplift went with it. The constant was deleted rather than set to zero — a knob that drives nothing is the `SOFT_DELETE_RETENTION_DAYS` mistake — and a designer who wants five types 5 into the box. **The seed reports what it measures, and nothing else.**

**The 4 is a coincidence and the tests treat it as one.** It read 4 before v19.59 for the wrong reason — the under-sample happened to drop exactly the two bilingual spare weeks — and reads 4 now for the right one. `links-seed.test.mjs` therefore checks line IDENTITY and asserts no bilingual-only shift time is ever seeded, rather than resting on the figure.

**It lives in `links-seed.js` and has unit tests** (v19.92). Until then this paragraph ended: *"Pinned by an e2e that drives `↺ Reset targets from current roster`, because the seed lives in the coordinator and a unit test would be checking its own copy of it."* That was true and entirely self-inflicted — the function was already pure, with no DOM, no Firestore and no coordinator state; it was simply not exported, so there was nothing else for a test to check. Exported, there is. The e2e stays (it proves the BUTTON reaches the seed, which a unit test cannot), but it is no longer the only cover.

Two things the extraction fixed rather than merely moved. The cycle lengths were the literals `20` and `8` while `CONFIG.MAIN_ROSTER_WEEKS`/`BILINGUAL_ROSTER_WEEKS` held the same two numbers — so a roster that changed length would have left the seed reading a **prefix** of it, under-counting slots and spare lines in exactly the v19.59 shape, silently; they are read from CONFIG now and a static assertion bans a bare numeric loop bound coming back. And `buildRosterTargets` takes its sources as an argument **defaulting to `rosterSeedLines()`**, so which-lines-get-sampled is testable separately from what-is-counted while the default remains the real roster — injecting the sources from the call site would have moved the v19.59 bug back out of reach instead of closing it.

Weekday count = the **busiest** Mon–Fri day for that time (some shifts only run Tue/Thu/Fri), and the generator then staffs all five weekdays at that level. Deliberate — under-staffing a day is the worse error — but the real roster varies Mon to Fri, so the column header says `busiest day`.

### The December 2026 uplift — BUILT AND REMOVED (v19.78 → v19.83)

An "increase every target by N%" control on the generator, scaling the target table in place.
Shipped at v19.78 and **removed at v19.83 on the owner's decision: "over complicates it."**

Recorded rather than deleted silently, because the measurement behind it is still true and someone
will propose it again. If it ever returns, two things must come with it:

- **Round the day-class TOTAL, not each slot.** The targets are mostly 1s and 2s, so `round(1 x 1.15)`
  is 1 — measured against the real roster seed, per-slot rounding made **every uplift from 0% to 15%
  byte-identical** (104 duties, unchanged). A designer typing 10% would see a control that appeared
  broken. Largest-remainder on the total gives 16 -> 17 at +5%.
- **A slot at 0 for a day class stays 0.** Zero is not a small number: it means that shift does not
  run that day.

**The finding the control was built to surface does not go away with it**, and is the part worth
keeping — see `LINKS_DEC2026_PLAN.md`. 22 working lines x 7 days is 154 day-slots, so every extra
duty comes out of a rest day: at +25% rest days fall to 1.14 per line, and above ~+37% the targets
do not fit the rotation at all. A service increase cannot be absorbed by making the existing lines
denser — the link has to get bigger, which means more staff. That is an argument to take into the
room, not a control to put on a page.

### The two constructions (v19.59)

`generateLink({ slots, spareLines, lines })` tries **settled weeks** first and falls back to the original **rotating window**. Which one ran is REPORTED in the status line, never silent — they give visibly different designs. `generatePatterns` is the thin wrapper returning patterns only; it keeps the old signature because every existing caller and test is written against it.

**1. Settled weeks (default).** Slots are grouped into WAVES — starts within `WAVE_SPAN_MINUTES` (2h, the same threshold FF19 uses) — each wave gets a contiguous BLOCK of lines sized by the duty it carries, and slides its own window inside that block. **A line therefore never leaves its wave**: its start can move 06:20 → 07:15, never 06:20 → 15:25.

Measured against the real roster, the old construction was giving people a week nobody at Marylebone has ever worked:

| | within-week start spread | lines above 4h | FF19 |
|---|---|---|---|
| Real main roster (20 lines) | 3h44 | 7 of 16 | 6 |
| Generated, rotating (old) | **8h09** | **22 of 22** | **27** |
| Generated, settled (v19.59) | **1h33** | **0 of 22** | **2** |

The tool reports FF19 and its own generator was the thing inflating it ~5×. Days worked per line now matches the real roster's distribution (3–6, clustered at 5).

Waves rather than exact times, deliberately: per-TIME blocks are infeasible here — the seed produces more distinct times than there are working lines, and several are weekend-only — and waves are also what the real roster does (line 3 works 06:20-14:20 midweek and 06:20-14:00 on the Saturday).

Three things that were wrong on the way and are each pinned by a test:

- **A wave too small to fund a line is merged into its nearer neighbour.** The two 08:30 weekend-only slots formed their own wave, so one whole line existed to work Sat and Sun and nothing else — days per line came out 2 to 6 where the old construction ran 3 to 6. A shape improvement paid for with an unfair link is not an improvement. Merging widens a wave past 2h (06:20…08:30 is 2h10) and the panel then counts that movement, which is the right way round.
- **A lap is spread ACROSS the week, never front-loaded.** `base + (i < rem)` strides lap a 3-line block by Tuesday and then hold the window still to Saturday, so the same lines work all four of those days and one caught two a week. `floor((i+1)·n/7) − floor(i·n/7)` shares it out exactly.
- **The fairness test is comparative, not an absolute floor.** "Nobody under 3 days" is a fact about the TARGETS, not the construction — it would pass or fail on the fixture.

**2. Rotating window (fallback).** The wheel: a window of consecutive lines slides forward a few lines a day, one lap per week, slots ordered latest-start at front.

Its documented promise — *"a person's week only moves later, never a late finish then an early start; asserted by tests"* — **was not true**. Positions are read mod `working`, so every line wraps front-to-back once a week and that wrap IS the step; it lands on a rest day only while the targets leave lines resting. At full staffing it produced **27** short turnarounds, `15:15-23:55` into `06:20-14:20` — **6h25** rest. The test that "asserted" it staffed 13 of 24 lines, where the wrap always fell on RD.

Strides are no longer near-equal: each day's is capped at `working − (next day's total)`, exactly the condition for a wrapping line to be resting the following day, and the lap is distributed in proportion to those caps. When the caps cannot fund a lap the targets leave under one rest day per line per week — the generator **refuses** (`reason: 'no-rest'`, with its own message) rather than shipping the phantom guarantee. Settled weeks survive those same targets, because a line staying in one wave costs nothing in body-clock movement.

Daily targets are met exactly by both; any day-class total > the working lines is rejected. The generator writes every line.

**Do not add back** `buildDefaultDesign`, `initFromRosters`, or `resetFromRosters` — those paths were removed at v12.43 because they copied raw roster patterns verbatim, leaving the lines past the roster's own length as all-RD blanks. The generator produces a complete rotation.

### Line ORDER — the six objectives (v19.58; `variety` added v19.60, `maxRun` v20.02)

> **`variety` and `gentle` are opposite ends of one dial, and `variety` must stay ON by default.**
> Minimising the week-to-week step, taken to its limit, IS a long block of the same shift — the
> smallest possible step is no step at all. Between v19.59 and v19.60 the generator settled each week
> and then laid the waves out contiguously, so a person got **11 straight weeks of mornings and 11 of
> afternoons**; turning `gentle` on did not move it. The owner's verdict was "a bit
> excessive and would be unpopular", and the live roster's longest run on much the same shift is
> **3** (bilingual 2), which is `DEFAULT_BLOCK_TARGET`.
>
> `variety` is weighted as a **constraint** rather than a preference (excess × 400 against gentle's
> raw minutes), so the optimiser alternates but alternates by the smallest step available — early →
> middles → late rather than early → late. Measured on the roster seed: block 3, week-to-week 95 min,
> 8 weekends off, 0 short turnarounds. **With `variety` off: block 11 — the generator's own raw
> output, unchanged.**
>
> **THE BLOCK FIGURE HERE WAS 8, IN BOTH PLACES, AND IT WAS WRONG** (measured and corrected v19.94,
> in a doc-vs-code audit). Every variety-off configuration gives **11**:
>
> | Switches | Longest block |
> |---|---|
> | raw generator output, no reorder | 11 |
> | everything off (leave the order alone) | 11 |
> | `gentle` only | **11** |
> | all on EXCEPT `variety` | **11** |
> | `variety` only | 3 |
> | `variety` + `gentle` | 3 |
> | all on — the shipped default | 3 |
>
> Two things follow. **`variety` is the only switch with any lever on block length at all** — it goes
> straight to 3, and nothing else moves the number off the generator's own 11. And **`gentle` alone
> does not lengthen blocks**, which is a weaker claim than "opposite ends of one dial" implies: the
> generator's raw output is already the long-block case, so gentle has no headroom to make it worse.
> The dial framing is still the right way to think about the two — minimising the step, taken to its
> limit, IS a long block — but the measured evidence for it is the 3-versus-11 gap, not a gentle-only
> figure.
>
> Note where the 8 sat: directly beneath a callout warning **"Do not quote a step figure without
> saying which switches were on."** That discipline was applied to the STEP figure at v19.65 and not
> to the BLOCK figure in the same box, which is how an unattributed number survived four releases
> next to the rule against it.
>
> **`blockRuns` treats a SPARE line as transparent** — neither breaking a block nor counting towards
> one. A cover week interrupts, but it does not change what you go back to; counting it as a break
> would let four spare weeks hide a 20-week block behind a reported maximum of 4.
>
> **Interleaving the waves inside the generator is a WON'T-DO** — tried and reverted at v19.60, with
> the numbers in `links-design.js`'s own comment. It fixes the raw block length but introduces short
> turnarounds and costs two long weekends. The generator owns the SHAPE; this module owns the ORDER.

### The spare spread is a CONSTRAINT, not a switch (v20.02)

`generateLink` reserves whole spare lines and **spreads them evenly around the wheel**. The reorder
then ran over the top of that with no objective that cared — and clustering cover weeks *helped* the
objectives it did care about, so it clustered them. Measured on the live seed at 24 lines / 5 spare:
the generator placed them at 1, 6, 11, 15, 20 (gaps 5, 5, 5, 4, 5) and the reorder returned
1, 4, 5, 12, 16 (gaps 9, 3, 1, 7, 4) with **two adjacent**.

Two adjacent spare weeks chain — the first week's four duties at its end, the second's four at its
start — so this took **FF11 from 9 to 14** on the generator's own output, past the threshold the
fatigue panel reports against, with nothing on screen to say the ORDER had done it. The v20.01 note
that "every configuration with 5 spare weeks trips FF11" was measuring this bug, not the spare count.

`spareSpread` is therefore charged **unconditionally**. Every other term here is a preference a
designer may not want; an even spread of cover is a property the generator already guarantees, and no
one asks for a design that clusters it. It is the only term that can make the result **worse than
what the reorder was handed**, rather than merely less good.

**It was first written at the wrong weight, and the reason is worth carrying** — caught before release, in the same version, so 500 never reached a device. It was chosen as
"above `variety`'s 400" — true per unit, and not the question. These terms *accumulate*: two units of
block excess bid 800, so `variety` won, and the default came back with cover-week gaps of
7, 6, 5, 6 where 6, 6, 6, 6 was available. The unit test asserting the priority compared one unit
against one unit and passed throughout. **Comparing rates between terms that accumulate at different
rates is the mistake**, and writing the assertion that way is what made it look settled.

The weight is now **3000**, chosen by measuring 16 design shapes (20/22/24/28 lines × 3/4/5/6 cover
weeks), each reordered with every switch on and with `variety` alone — 32 runs, total excess against
a perfect spread:

| w=500 | w=800 | w=1200 | w=1500 | w=2000 | w=3000 | w=5000 |
|---|---|---|---|---|---|---|
| 10 | 7 | 8 | 7 | **0** | **0** | **0** |

The dominating plateau begins at 2000 and nothing above it behaves differently; 3000 sits one step
inside rather than on its edge. Everything below is a local outcome, not a rule — 800 and 1200 look
almost as good in total and still leave whole shapes uneven. The cost is real and small: 273
worked-day run-length across those 32 runs against 267 at w=500, about a fifth of a day per design.

Two properties that make this safe to treat as a constraint at all:

- **Excess 0 is always reachable**, because `spareSpread` targets `floor(lines / spares)` — gaps as
  equal as the rotation allows are then always at or above it. A dominating weight over an
  *unreachable* target would set the optimiser chasing a residual it can never clear.
- **The chaining harm was already prevented at 500** — zero adjacencies in all 32 runs, at every
  weight tried. What the higher weight buys is the last of the evenness, which is what was asked for.

**It has no checkbox, so the objectives note has to say it** (v20.03). Every other term on that card
is a trade the designer chooses and the status line prices; this one is applied on their behalf and
moves rows for a reason nothing on screen explains. A card whose whole argument is "the result says
what each cost" cannot carry an unnamed term. The sentence in `.gen-obj-note` — *"Cover weeks are
always kept evenly spaced around the rotation — that one is not optional, because two cover weeks
side by side run into one long stretch"* — is load-bearing copy, not filler; do not trim it as
redundant with this file, which designers do not read.

Two tests, and neither replaces the other: one asserts 3000 outweighs all six switches slipping a
unit each (1060 in total, read back through `cost` rather than restated), which catches a
re-weighting; the other drives a **real generated design** through the real optimiser and asserts the
spread survives, which catches the behaviour. The first is necessary and **not sufficient** — the
switches accumulate without limit, so no fixed margin proves the spread always wins, and 1500 passes
it while still leaving designs uneven.

### Hours a week — the totals the panel did not have (v20.04)

The Design-checks card reported weekends off, rest between shifts, longest run and shift balance —
every one of which describes the SHAPE of a week, and none of which says how much of it is work. So
the most basic question anybody asks of a roster, *does it give people their contracted hours?*, had
no answer anywhere in the tool. `weeklyHours` in `links-design.js` answers it, and it is rendered in
three places: the Design-checks row, the generator's totals row (where the targets are being typed,
which is where you want to know), and the sticky summary chip.

**Two exclusions, and each one "simplifies" into a plausible wrong answer:**

- **Sundays come out.** Sunday is not contracted for any grade here — the rule is enforced in five
  places across the app. A Sunday duty is therefore work sitting on top of the contract, and folding
  it into the weekly figure reports a design as delivering contracted hours using time that is not
  contracted. It **flatters**. Both figures are returned; only `exSunday` is comparable to 35.
- **The denominator is the WORKING lines.** A cover week carries no times, so dividing by all the
  lines charges the average with weeks of zero and reports a week nobody works. It **deflates**.

**The measure is validated against the roster itself**: the live main cycle's 16 working lines come
to **exactly 35.00** hours a week. That is the check on the check, and it is a test — a design judged
by a broken yardstick is worse than one judged by none, because it looks like an answer.

**What it found immediately.** The seeded 24-line design comes to **28h 51m** — six hours a week
short — because the same duties are spread over 20 working lines instead of 16. That is the
arithmetic consequence of widening a link without adding work, it is the central fact about the
December 2026 proposal, and nothing on the page had ever shown it. Whether the new timetable's extra
service fills the gap is the question to take into the room.

A threshold IS defensible here, unlike the ORR factors: 35 is the contract, not guidance, so short is
short. Half an hour of slack absorbs minute-level rounding. Never render it red — a target that does
not yet total 35h is a work in progress.

### The generator intro must not restate a guarantee (v20.04)

The card's opening paragraph promised *"start times only move later through each person's week —
never a late finish followed by an early start"*. That was written for the rotating construction, was
found FALSE at v19.59 (positions are read mod `working`, so every line wraps front-to-back once a
week — 27 short turnarounds at full staffing), and the generator was changed to **refuse** rather than
ship it. The default has not been that construction since v19.59 either. The copy survived all of it,
and the page contradicted itself in two places at once: the paragraph promised start times only move
later while the Design-checks card below reported **"Backward rotating pattern — 25 backward /
7 forward"** on the very design it had just produced. A designer who believed the promise had no
reason to read the row. **Describe what the generator does and point at the checks for what it
achieved.**

### The sixth switch: most shifts in a row (v20.02)

A box on the objectives, default **6** — `DEFAULT_MAX_RUN` in `links-design.js`, which the Design
checks panel reads too, so the generator's aim and the panel's threshold are one number. They were 6
and 7 in different files until v20.02.

Three things that are easy to get wrong, each with a test:

- **A spare week counts as FOUR worked days.** `longestRunFor` delegates to `worstCaseWorkedRun`
  rather than re-deriving it. Counting seven is what reported the live main roster at 15 consecutive
  days against a true 9, and it is the mistake anything measuring runs repeats first.
- **The gradient sums excess over every START; it does not penalise the maximum.** A maximum is a
  plateau — almost every pair swap leaves it unchanged — and measured, the optimiser stalled at 8
  where a random search found 6. Summing makes a long run cost many times over (a 14 also shows up
  as a 13, a 12, …), which is the same shape `blockExcess` already uses. **`runExcess` is a gradient,
  never a statistic** — do not report it or any total derived from it.
- **The weight was chosen by measurement and the measurement is the interesting part.** With
  everything else on: 40 gives run 8 / FF11 11 / 7 weekends; 100, 150 and 300 all give run 7 but take
  FF11 to **14** and weekends down to 5, then 4. Pushing the cap harder makes the design worse on the
  factor the panel actually reports, because shortening a run of worked days and creating a 48-hour
  break are not the same thing. So it is a firm preference, not a near-absolute like `variety`.

**With the switch on alone the reorder reaches 6; with the full set on it reaches 8, and the status
line says so.** A box that names a target the design silently misses is the phantom guarantee this
module has already shipped once — the rotating construction's documented "a person's week only moves
later", which was untrue for a year.

`links-adjacency.js`, applied by the generator through six switches. A whole class of the design's
quality lives in which line follows which, because you work line w one week and line w+1 the next:
the week-to-week movement of your working day (the FF18 question), whether Saturday off is followed
by Sunday off, whether that extends to three or four days, and whether Saturday's finish runs into
Sunday's start.

**Reordering is FREE with respect to coverage, and that fact is what makes the feature safe.** Daily
coverage is "how many lines work shift X on day D"; permuting the rows leaves that multiset
identical. So these objectives cannot cost a single person's cover — they compete only with EACH
OTHER, over the one scarce resource of line adjacency. There is a test asserting the multiset is
unchanged; if it ever fails, the reorder has started moving cells rather than rows.

**Switches, not a formula** (owner, Aug 2026). Turning one on takes freedom from the rest, so the
tool's job is to let you turn each on and SHOW what it cost — `scoreOrder` returns all the figures
whatever you optimised for, and the generator's status line reports before→after. A blended score
would hide the trade. Measured on a generated design: gentle-only takes week-to-week movement from
42 to 9 minutes but drops weekends off from 10 to 9.

> **The all-on figure that used to sit here — "all four on gives 14 minutes and 12 weekends" — is
> gone** (corrected v19.65). It was measured at v19.58, before `variety` existed, and it contradicted
> the box above, which measures the shipped default at **95 min / 8 weekends** on the roster seed.
> Both were presented as "all switches on", so this file said two different things about the one
> configuration a designer actually gets — and named four switches when there are five.
>
> **The 9-minute gentle-only figure is the one to be careful with.** It is real, and it is *not* what
> the tool does by default: `variety` deliberately spends that step to cap the block length. Quoting
> it as the delivered FF18 answer would overstate the tool by an order of magnitude, in exactly the
> conversation where the number matters. If you re-measure, record **which switches were on and on
> which target set** — a step figure without both cannot be checked or reproduced.

**Everything off means leave it alone** — the order comes back untouched rather than re-sorted by
whatever was left.

Two rules that are easy to undo:

- **A spare week must not read as a gentle transition.** A spare line carries no times, so the step
  across it cannot be measured — and an optimiser scoring "unmeasurable" as "no change" would learn
  to park spare weeks between the two harshest lines and report a beautiful number. Unmeasurable
  steps are counted and reported SEPARATELY, never folded into the mean.
- **Days off and contracted days GIVEN are two different answers.** Sunday is not contracted, so
  Sat + Sun off is a two-day break but only one contracted day. Rolled into one number, a design
  that simply never rosters Sundays would score as generous while giving nothing away. `breakLength`
  returns both; `days` is right for fatigue, `given` is right for judging the design.

**Deterministic per attempt** (v20.07 — was flatly deterministic, which made Generate a dead end:
pressing it again returned the identical design, and a designer could never ask "is there another
arrangement?" without changing a target they did not want to change — the owner's report). The 2-opt
is a local search, so where it STARTS decides where it lands:

- **Attempt 0** starts from the greedy order — byte-identical to the old behaviour, so the measured
  figures in the docs still describe the first press, and the two e2e assertions on the first-press
  status text stay true.
- **Attempt N ≥ 1** starts from three seeded shuffles (mulberry32 on the attempt number — never
  `Math.random`, never the clock) and keeps the best by cost. Different attempts land in different
  local minima: measured on the live seed, attempts 0–7 produced seven distinct designs, several
  better than attempt 0 on individual figures (attempt 2: week-to-week 110 min against 156 at the
  same longest run).

What the old rule was FOR — reproducibility — survives: same design, switches and attempt number
give the same order on any device, so "design 3" means the same design to two designers comparing
notes, and a variant is recoverable by reloading and pressing Generate the same number of times.
The status line names the design, tracks the best-so-far on the ticked objectives, and says how to
get a superseded best back.

**The even cover spread is a FILTER on candidates, not only a weight** — and that distinction was
measured, not theorised: attempt 6's three starts all converged into minima with gaps 6,7,6,5. The
w=3000 weight makes unevenness expensive, but a local search can only pay a price it can find a
path away from. A candidate that breaks the spread is not a worse candidate — it is not a candidate;
if all three fail, the attempt falls back to the canonical design and the status line admits the
duplicate rather than renumbering it. Teeth-verified three ways (attempt-blind seed, dropped
filter, `Math.random` in place of the PRNG).

Greedy nearest-neighbour then a bounded 2-opt; not optimal and does not claim to be.

### Sunday is not contracted, and the generator does not model it

Sundays appear on the roster as agreed **RDW** — overtime by agreement, not contracted hours — but
`dayClass` returns `'sun'` and that is the entire extent of it. Nothing in the generator,
`runDesignChecks` or `links-fatigue.js` treats a Sunday duty as voluntary. Mostly harmless (the cover
still has to be found, and an hour worked is an hour worked for fatigue), but two readings change:
the Sunday column is cover you HOPE to fill rather than cover you can require, and "weekends off"
counts a Sunday you were never going to work. The generator table labels the column `RDW` for the
first; `links-adjacency.js` splits days-off from contracted-days-given for the second.

**A spare week's four days come from Mon–Sat.** The Sunday of a spare week stays RDW if the roster
clerk gives it, on top of the four — it is not one of them. All seven days are still marked SPARE,
which is what the real roster does and what "available for cover" means, but a reader should not take
the four out of seven.

### Generator layout — the v19.61 polish pass

Measured at 390px and 1280px, not eyeballed. Five things, and the first is a bug rather than polish:

- **The iOS focus-zoom guard had never worked.** Full account in `css-tokens.md` → "The 16px
  focusable-field rule is now MEASURED". The override now sits at the END of `links.css`, after the
  base rule it has to beat, and an e2e measures the computed size on a real coarse pointer.
- **Touch targets.** On a coarse pointer the fields were 28px, the row ✕ 20px and the two text
  links 15px. All now ≥40/44px. The app's rule is that density is gated on `pointer: fine` — a wide
  touch screen still needs the target spacing.
- **The SHIFT TIME column is sticky on mobile.** At 390px the table is 443px inside a 306px wrapper:
  131px hidden, which is the whole **Sunday** column and the ✕. Sunday is a required INPUT, so this
  is not the same call as compare mode's accepted clipping of a read-only view. Sticky identifies the
  row while you type AND makes the scroll self-evident, and a right-edge shadow (pure CSS,
  `local`/`scroll` gradients — no scroll listener) says there is more. **Every sticky cell needs an
  OPAQUE fill:** the spare row's own background is `color-mix(gold 10%, transparent)` — 90%
  see-through — so the caption sat there with the scrolled column showing through it, which reads as
  a fault, not a feature. And `white-space: nowrap` had to go: fine in a cell that sizes to content,
  but in a sticky one it just overflows the fill.
- **The form uses the FULL card width on desktop — the 660px cap is HISTORY** (v19.82, owner:
  "still not using the full width"; this bullet described the cap as current until v20.54, arguing
  the opposite of the shipped CSS). The v19.61 cap reasoned that widening "puts a 90px shift time in
  a 477px cell" — misapplied, because the shift time is a `<select>` that stretches to fill its
  cell, which reads as a control rather than as gap; capping the select instead looked WORSE
  (190px of void inside a bordered cell). What SURVIVES from that era is the one-left-edge rule:
  the intro keeps a 72ch reading measure pinned to the same left edge (`margin-inline: 0`, never
  centred), and the left-edge e2e still measures all five parts. The full reasoning lives beside
  the rule in `links.css` ("THE FORM USES THE FULL CARD").
- **The generate feedback is written beside the BUTTON, and the button is held still** (v20.54).
  The canonical status lives in the grid card's sticky save row — a full card above the Generate
  button, and measured after a real press it sat 448px above the viewport at 1280×900 and 569px at
  390×844, so the whole v20.07 explore-loop voice (design numbering, best-so-far, how to get a
  variant back) was invisible from the one place it is read; `aria-live` meant screen-reader users
  were the only ones getting it. `#genStatus` mirrors the same text under the button (aria-hidden —
  one announcement is enough). And on the FIRST generate the grid card above grows ~1,500px, which
  used to strand the viewport mid-grid with the button and feedback both off-screen: the handler
  now re-anchors the scroll so the button stays where the finger is. Both pinned by an e2e.
- **The objective labels.** Two of the five carry an inline number, and at 390px the tail wrapped
  flush with the CHECKBOX, reading as a sixth objective. The label text is now one `<span>` (a flex
  item) so it wraps as a block, and the numeric clause has its own line — a 40px-tall field cannot
  sit inside a sentence in a 260px column. **Grid was tried here and is wrong**: every child of a
  grid container becomes an item, so the number box left its sentence and dropped into the
  checkbox's column.
- **The objectives are OPTION ROWS, not bare checkboxes** (v19.63, owner: "the toggle switches and
  associated writing look unstyled" — they were). They shipped at v19.58 as five native checkboxes
  with text beside them, which is exactly what paycalc's `.bp-mode-opt`/`.hpp-mode-opt` was built to
  replace; that rule's own comment reads *"the design system instead of two bare browser radios
  floating in space"*. `.gen-obj` now mirrors it: a bordered row, navy border + a brighter fill
  + a subtle lift via `:has(input:checked)`, an 18px `accent-color` box (20px on a coarse pointer),
  and the focus ring on the ROW rather than the box, because the row is what you are choosing. Same
  2px border in both states so toggling one causes no reflow, and `.gen-obj + .gen-obj` spaces them —
  two adjacent checked rows with no gap read as one tall box with a line through it. A `<legend>`
  inside a flex container lays out unpredictably across engines, so the gap is a sibling margin, not
  a flex `gap` on the fieldset. **Do not re-create a page-local variant of this** — if the option-row
  treatment needs to change, change it with paycalc's.
- **ON is the BRIGHTER row, and check that against the SUBSTRATE** (v19.65, staff report: "everything
  doesn't quite look right"). The v19.63 row above shipped its two fills the wrong way round —
  resting `white`, checked `--bg-faint` — copied from paycalc without noticing the substrate differs.
  Measured: this fieldset is `--surface-sunken` (L 96.3%), so a checked row at `--bg-faint` (97.0%)
  sat **0.7% above its own background** and dissolved into it, while an unchecked row at white sat
  3.7% above. With all five on — the default — every row was panel-coloured inside a navy outline, so
  the card read as five empty boxes and the one state the fill exists to show was the one you could
  not see. Switching an option ON also made it 3% **dimmer**, inverting the app's three-surface cue
  (css-tokens.md: a control brightens to white when it becomes active). Paycalc is deliberately left
  alone: its options sit on a `--surface` CARD (98%) and are a two-option radio group where exactly
  one is ever checked, so the border carries the state and the fill is only a whisper. The
  `.gen-obj-num` field lost its `background-color: white` override in the same pass — that was
  reasoned from the old checked fill, and it both flattened the row and killed the app-wide
  "field brightens to white on focus" cue, since a field already at white cannot brighten.
- **A number and the words that qualify it are ONE unbreakable group** (v19.65). "at most [3] weeks
  the same" was three loose flex children in a ~190px column and overflowed by ~8px, so at 360px —
  the reported device — it wrapped and left "weeks the same" alone under "at most", reading as a
  separate statement. Neither lever that would normally fix it is available: 360px is the design
  target, and 16px/40px is the iOS-zoom + touch-target floor for the box. So the clause was shortened
  to "at most [3] weeks" (the noun is in the title directly above) and the box + its unit wrapped in
  `.gen-obj-numctl`, an `inline-flex` that cannot come apart. Both are belt-and-braces; either alone
  fixes today's render.
- **The generator now has pixel coverage** (v19.64): `links-generator.png` (desktop, three objectives
  on and two off) and `links-objectives-narrow.png` (390px, where the rows stack). It had none
  before, because the card is collapsed in the workspace baseline — so four consecutive releases
  reshaped it with only hand-read screenshots watching, on the surface where this page's layout bugs
  actually happen. **But note the two things it CANNOT see, both established by measurement**
  (v19.65): near-white fill changes fall under `threshold: 0.15` (that is what hid the inverted
  state), and the visual project is FINE-pointer only, so the 56×40 coarse box that caused the clause
  to fragment never appears in a baseline at all. Both are asserted in code instead — the fill
  direction beside the desktop shot in `visual.spec.js`, the clause on **mobile-chrome** in
  `pages.spec.js` at 360px. Do not move the clause test into the visual suite: measured at 390, 360
  and 300 there, it passes on the broken markup.
  **The checked-row treatment is asserted in COMPUTED STYLE, not left to the pixels**, and that split
  is not belt-and-braces: `--bg-faint` is `oklch(97%)` against white, a 3% step, far under the
  suite's `threshold: 0.15` per-pixel sensitivity — deleting the fill AND the shadow left the
  screenshot passing (teeth-verified). The baseline catches composition; the style assertion catches
  on-versus-off. Keep both.

## Page-wide review findings (v19.66)

Both sections below are about the PAGE, not the generator — they sat between the generator's
layout notes and the generator itself, which is why neither read as belonging to anything.

### Known MOBILE gaps on this page — measured, not yet decided (v19.66)

The v19.66 review captured desktop and mobile but was **read** desktop-first, and the mobile
in-use page was not examined until afterwards. Three things it found at 390×844, all measured,
none fixed — recorded so they are not re-discovered as new:

- **The grid loses its day headers.** `.links-grid-wrapper` is `overflow-x: auto` below 1024px, so
  by the spec rule above it is a scroll container in both axes and its sticky `thead` is inert —
  the same trap as the generator table. Scrolling lines 9–27 there is no LINE/SUN/MON header on
  screen at all, and the grid is **43% off-screen horizontally** (592px of table in a 338px
  wrapper), so position cannot disambiguate the column either. On the page's primary object this
  is the most serious of the three.
- **The sticky save row takes 146px of an 844px viewport — 17%**, permanently: two buttons, a
  provenance line, and the summary chips wrapped onto two rows.
- **The brush bar is 239px** — 26 chips over seven rows before the grid begins.

None is a regression; all three predate v19.66. The fixes are not free (the first needs a nested
scrollbox; the other two need something to give), so they are a conversation rather than a sweep.

### The blank page, and three fixes that came out of screenshotting it (v19.66)

The page had been polished repeatedly **in use** and never looked at **empty**. Measured at 1280px
with no designs saved, the three cards came to **160px / 117px / 117px** — each a white slab holding
one 12px grey sentence pinned to the left edge. That is what a new designer sees first, and it read
as three empty boxes rather than a page waiting to be used.

- **An empty card says what it is waiting FOR, and the one that can act carries the action.** The
  grid card gets a centred icon + title + sentence + a real `.btn-save` primary ("Go to
  Auto-generate") and a text link ("Start with a blank grid"). Left-aligned, the old sentence sat
  ~700px from the "+ New" button it was telling you to press. The two analysis cards get
  `.links-empty-panel` — centred, `min-height: 132px` — because they can offer nothing: there is
  nothing to analyse.
- **The primary action SCROLLS; it does not generate.** Firing the generator from an empty card
  would build against whatever the roster seed happened to hold, which is a design nobody chose.
- **The empty checks panel must not wear a green tick.** It was `✅` (the card's own emoji) for one
  iteration — a tick centred in an empty checks card reads as "checks passed", the exact
  false-assurance failure that card exists to prevent, and it would be claiming it before a single
  check had run. `📋` instead.
- **A load FAILURE is not "you have not made one yet".** `renderGrid` swaps the title and hides the
  actions on `loadFailed`: telling someone whose designs exist but did not load that they have none,
  and inviting them to generate a new one, is how a connection blip becomes a duplicate design.
- **The card header hint is state-dependent.** It said "Tap any shift cell to change it. Use the
  Paint bar…" in a state with no grid and no paint bar on screen. Both strings live in
  `_setGridHint` so they cannot drift.
- **`links-analysis.js` must MIRROR the empty-panel markup** its card ships in `links.html` — that
  branch replaces the whole card body, so the bare `<p>` it used to write silently undid the empty
  state on the first re-render.

Two more from the same pass, both in-use surfaces:

- **The generator card has ONE left edge, whatever width the form is** — the durable rule from a
  pass whose specific answer was later reversed. v19.66 capped the form at 660px and centred it;
  v19.67 found centring the form ALONE left the card with two left edges (intro 122→778 against
  everything else at 310→970 — nearly the same width 188px apart, which reads as a mistake rather
  than as hierarchy); **v19.82 then removed the cap entirely** (owner: "still not using the full
  width" — the current design, recorded in `links.css`). This bullet described the 660px-centred
  era as current until v20.54. What survives every reversal: **anything added to this card must
  join the one column**; an e2e measures all five left edges and names the offender, because a
  whole-card baseline just re-records whatever the alignment happens to be.
- **The target table keeps its column headers — at ≥768px ONLY** (`position: sticky` on
  `thead th`). They scrolled away after the first six rows, leaving three unlabelled number columns
  — and Mon–Fri, Sat and Sun are three different commitments (Sunday is not even contracted), so
  typing into the wrong one is a real error with nothing to catch it.
  **Below 768px the declaration is inert, and that is a CSS constraint rather than a decision.**
  `sticky` resolves against the nearest scroll container; the narrow wrapper sets `overflow-x: auto`
  to scroll the 443px table inside a 306px card, and per spec the other axis then computes to `auto`
  as well (measured at 390px). The wrapper becomes a vertical scroll container as tall as its own
  content, so the header sticks to a box that never scrolls. **Do not "fix" it with
  `overflow-y: visible`** — that is the exact declaration the spec overrides, so it would read as
  correct and change nothing, which is this file's most frequently repeated failure. Making it work
  on a phone needs a `max-height` and therefore a nested scrollbox around the primary creation path:
  a UX decision, not a tidy-up. Both facts are pinned by an e2e that runs at both widths.
- **The Design-checks status is carried on the LEFT EDGE, not by the fill alone.** At 8–10% of a hue
  against white the four fills land within a couple of percent of each other, so 30 rows rendered as
  one ribbon with the status readable only from a 13px glyph. A 3px edge in the full-strength token
  makes them scannable. **It changes no semantics and must not**: a fatigue factor that is present
  still wears amber and never the red edge.

### Line numbering — the full rotation (v12.42; length changed v19.98)

Every line rotates and **every one must carry a real worked pattern** — in the rotation everyone
passes through every line, so a "vacancy" is a missing *person*, not a missing *pattern*.

**`ROTATING_LINES` in `links-design.js` is the ONE declaration of the length, and it is now 24.**

It was 28 = the main 20-week cycle + the bilingual 8, because the design modelled both as one
rotation. The December 2026 plan changed (owner, Aug 2026): the new link **does not include the
bilingual roster at all** — not its lines, not its shift times, not its work. It is the CEA/main
roster **widened from 20** to increase staffing, and it carries **5 spare weeks** against the
roster's 4.

**The length moved twice: 22 at v19.98, corrected to 24 at v20.01** (owner — the earlier figure was
misremembered). Evidence class **C** for both (owner-confirmed practice, no document behind either).

**Everything derives from the constant — do not write the number down again.** That is not a style
preference; it is the whole content of the v19.98 change:

- `links-compare.js` held its OWN `const TOTAL_POS = 28`, missed by the v19.38 sweep that was
  supposed to end the copies, because it was extracted from the coordinator afterwards and took the
  literal with it. It would have rendered 28 rows beside a 22-row grid, silently.
- Roughly **fifteen** copies lived in PROSE — the grid card's title, the empty state, four tips
  entries, the generator's totals, its Apply confirm, `max` attributes in the markup. Every one
  renders perfectly while describing a link that does not exist.

**And v20.01 is the proof that it worked.** 28 → 22 was that sweep; 22 → 24 was this one constant,
four static fallbacks `links-rotation-parity.test.mjs` named on the first run, and a re-measure. If a
number can change once it can change twice, and the second time is what finds out whether it was
really centralised. Static markup that cannot interpolate uses a `.js-rotating-lines` span stamped at
init; the guard fails on a literal even when the literal is right today.

**Designs saved against the OLD length are left exactly as they are.** A 28-line design still in
Firestore renders its first 24 rows, is analysed over 24, and — because `workingCopy` deep-copies the
whole patterns object — saves all 28 back. Trimming on load would destroy six lines of somebody's
work on a page visit (the v19.84 stale-hard-delete class); trimming on save would do it at the moment
they least expect it. So the fact is put on screen instead: `#linksOverLengthNotice` names the two
lengths, says the surplus rows are neither shown nor counted but are still stored, and suggests
building the new link fresh. Deleting the old designs is the owner's call to make deliberately.

**C. Reen is NOT a special case:** the link is designed as a full rotation so it still works if she
ever leaves; her adjusted fixed shifts are applied as overrides on the base roster. The old
`FIXED_POS` / `fixed-link-separator` / `fixed-cell` model and the earlier `VACANT_FROM` placeholders
model were both removed (v12.41 dropped vacant; v12.42 dropped fixed). Every row is a normal
editable rotating row.

The grid flags an all-rest line with an amber line-number cell (`.row-unfilled`); the Design checks "Lines not yet designed" row lists them until filled.

### Concurrency & load safety (v12.37; atomic v17.02)
`saveChanges()` writes via an **atomic Firestore transaction** (`runTransaction`) that reads the doc's `updatedAt` and writes in one step — closing the old getDoc-then-setDoc check-then-act window where a co-designer's save between our read and write was silently clobbered (Finding #13). On a baseline mismatch the transaction throws `concurrent-edit`; a `confirm()` names who saved and when, and on overwrite a plain (unconditional) `setDoc` replaces it. Transactions need connectivity, so **offline / any transaction failure falls back to the previous getDoc-check + queued `setDoc`** (persistentLocalCache syncs it) — offline-first preserved. The mismatch check (`conflictOf`) and the confirm are shared by both paths so they can't drift. A failed load sets `loadFailed` — empty state shows an error.

**Baseline-unknown guard (v17.18):** after a successful save, `saveChanges()` re-reads the doc to re-arm the concurrency baseline (`loadedUpdatedAt`). If that read-back FAILS (brief blip), the catch now sets `baselineUnknown = true` (mirroring the transaction path) — leaving it `false` meant the NEXT save saw neither a known timestamp nor an unknown-baseline flag, so a co-editor's intervening save could be overwritten with no conflict prompt. Residual accepted limit: two devices under the SAME display name (`updatedBy` equal) still won't conflict-prompt — inherent to identifying editors by name.

### Print (v12.37; reviewed v19.45)
A4 landscape grid + coverage + checks; generator, brush bar, picker, save row, tips and chevrons hidden.

**The whole rotation must land on ONE sheet** — you cannot judge a rotation split across
two pages. That is a measured constraint, not a preference: A4 landscape at 1cm margins gives
**718px** of printable height, and at the old 26px rows and 28 lines the grid card came to **903px**,
so it always broke (the CSS comment claimed it fitted "or close to"). Rows are now 21px, the cell
line-height 1.15, and the grid card's own header is dropped in print — the masthead names the sheet
— which brought 28 lines to **703px**, against 718. **At 24 lines it measures 619px** (v20.01), so
the headroom is currently ~99px rather than the ~15px the 28-line era had.

**Do not read that as slack.** The 21px row and the dropped header were both bought to fit 28, and
the budget is ~21px per line: the sheet takes 28 today and 4 fewer is where the room came from. If
the rotation grows again, or the cell font or the masthead changes, RE-MEASURE — the constraint is
the 718px, not any of these figures.

**There is a Print button** (`#linksPrintBtn`, v19.62) in the sticky save row beside Save changes —
outlined, because two filled buttons would compete and saving is the one that matters. All of the
print machinery above had existed since v12.37 with **no way to reach it but the browser menu**,
which an installed PWA often does not expose at all. It only calls `window.print()`, so it goes
through the same `beforeprint` path as the menu item rather than duplicating any of it. The save row
is already in the print hide-list, so the button costs the sheet nothing (measured: grid card 703px
with and without, against the 718px printable height).

**The masthead carries provenance — and must say when that provenance does not describe the sheet.**
`#printDesignName` names the design, who last saved it and when, and the date it was printed (stamped
on `beforeprint`, so a page left open for a week cannot print a stale date). **The provenance line
reads the SAVED Firestore doc while the grid prints the LIVE in-memory patterns**, so with unsaved
edits those are two different designs and a sheet showing your changes would carry somebody else's
"Last saved by". It appends **"· includes unsaved changes"** when `dirty` (v19.62). Printing a work
in progress is a reasonable thing to want, so this states the fact rather than blocking the print —
but do not remove it: this sheet goes to the assessing manager, and a misattributed proposal is the
same false-assurance failure the fatigue panel is built around. Pinned by an e2e that prints clean,
then edits and prints again. Before v19.45 it printed the design name alone: the save row that carries
"last saved by X" is hidden in print, so a circulated sheet had no way to say which version it was.
Coverage and Design checks keep their card headers — they are separate sections a reader needs
named.

### Sticky day headers (v12.37)
At ≥1024px `.links-grid-wrapper` drops `overflow-x` and `.card` uses `overflow: clip` (not `hidden`) — both load-bearing for the sticky `thead`.
