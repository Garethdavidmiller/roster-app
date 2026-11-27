---
paths:
  - "link-designer.html"
  - "link-designer.css"
  - "link-designer-*.js"
  - "test/link-designer-*.test.mjs"
---

# Link Designer — the rules

**This is the Link Designer's contract: what an editor must not break.** It holds the ten numbered
invariants and the decisions that are not changed without the owner, each with its reason in a line.
**How each part works, the measurements behind these rules and the layout notes are in
`docs/LINK_DESIGNER_REFERENCE.md`** — open the matching section before changing a feature.
`DECISIONS.md` → The new CEA link holds what the December 2026 plan settled, and `ROADMAP.md` →
The new CEA link what is still open. Most rules exist because something
shipped wrong once, and the module header beside the code says how: read it before changing a rule.

**The workspace builds and judges proposals. It decides nothing.** S. Silva, the RMT rep, leads the
December 2026 roster change and makes the final call (`DECISIONS.md` → The new CEA link, Who leads). Nothing
on the page, and nothing written here, may suggest that the owner or the admin decides which link
is used.

**PAUSED (owner, 27 Nov 2026), not deleted:** `CONFIG.LINK_DESIGNER_ENABLED` is `false`, so no menu offers the page and
`link-designer.html` is a "paused" note for everyone; the tests switch it back on and keep it working.
`docs/LINK_DESIGNER_REFERENCE.md` → Paused says what is off and how to bring it back.

**The `paths:` list above uses GLOBS, and must stay that way.** A list of filenames stops covering
the modules added after it, and nothing says so.

## Invariants

The short list, for someone about to change something. Each states WHAT must hold; the WHY is in
`docs/LINK_DESIGNER_REFERENCE.md`, or in the module header beside the code.

| # | Invariant | Where it lives |
|---|---|---|
| 1 | **The rotation length is declared once and stated nowhere else** — no literal in code, strings or markup (the parity test), and no comment or prose giving the CURRENT length as a fact (held by hand: the test strips comments, because a comment may record history — a dated release, a past length). A literal is one more copy waiting to drift. | `link-designer-design.js` (`ROTATING_LINES`) · `link-designer-rotation-parity.test.mjs` |
| 2 | **A hard limit and a fatigue factor are opposite kinds of statement.** Separate modules, separate counts, separate sections. Fatigue factors report what is PRESENT; they never pass or fail a design, and nothing here may read as a certificate. | `link-designer-limits.js` · `link-designer-fatigue.js` |
| 3 | **Every fatigue rule laps the rotation.** Somebody on the last line goes to the first next week. | `link-designer-fatigue.js` |
| 4 | **The generator REFUSES what it cannot repair.** Reporting a shortfall is not refusing it — a design that exists gets saved, compared, printed and taken into a room. | `link-designer-generate.js` (`repairShortRest`) · `link-designer-contract.test.mjs` |
| 5 | **A failed read-back flags the baseline UNKNOWN, never merely null.** Every co-editing bug here has been a SILENT overwrite of a colleague's work, discovered only on reopening. | `link-designer-design-store.js` · `link-designer-concurrency.js` |
| 6 | **An import becomes a design or a refusal, never a half-design.** An unreadable cell is refused BY NAME, never defaulted to a rest day — an import that "succeeds" four duties light reads as a lighter week, and every panel then reports confidently about it. A row of empty cells is an empty week IN ITS PLACE, never a line skipped: skipping one moved every later week up a line. | `link-designer-import.js` |
| 7 | **The days-worked divisor is the WORKING lines, not the rotation** — unlike the hours average beside it. | `link-designer-design.js` (`lineTotals`) |
| 8 | **Reordering is free with respect to coverage**, so the line-order objectives compete only with each other. | `link-designer-adjacency.js` |
| 9 | **A saved target set (a staffing setup) is refused whole or loaded whole**, and the client's ownership check only decides what is OFFERED — the rules are the protection. | `link-designer-target-sets.js` · `firestore.rules` |
| 10 | **Every class an analysis panel emits must exist in `link-designer.css`**, and any section claiming a limit must name whose requirement it is. | `link-designer-analysis.js` · `link-designer-analysis.test.mjs` |

## Where the detail is

| You are changing | Read first, in `docs/LINK_DESIGNER_REFERENCE.md` |
|---|---|
| a module's job, who may read or write, the bin | → The module set · Access control · Deletion — a permanent bin |
| the welcome panel, leaving with unsaved work, phone use | → The page |
| the Firestore shape, the masthead, compare, the grid, paint, the window, the heat map, the summary bar | → Design and save model |
| the Design checks card | → Design checks (The first half · Hard limits vs advisory factors · Fatigue factors · Hours a week) |
| Build a link | → The generator (and Line order — the objectives, for the reorder) |
| the rotation length, the shortlist, the binned designs | → Line numbering — the full rotation |
| saving, conflicts, the offline queue | → Concurrency and load safety |
| the printed sheet, the sticky headers | → Print · Sticky headers |

## Access control

- **Granting a designer access takes three steps, or they can open the page and save nothing**:
  the name in `CONFIG.LINKS_DESIGNERS`; `npm run generate:roster-members` in the same commit (the
  `linksDesigner` CLAIM comes from `functions/roster-members.json`); then, after the deploy,
  **Operations → Set up accounts**, which mints the claim.
- **The rules are the control**: `linkDesigns` writes need the `linksDesigner` or `admin` claim; reads
  need a bound member (`isMember()`), never a bare `request.auth != null`, and are deliberately NOT
  gated on `linksDesigner`, so a designer whose token predates the claim can load the page and self-heal.
- **"Last saved by" and "deleted by" are the writer's, at the server's time** (owner, 22 Nov 2026). A
  new write path stamps `currentUser` and `serverTimestamp()`, or neither (`linkStampIsWriters`).

## Deletion — a permanent bin

- **The bin is PERMANENT** (owner, 19 Sep 2026): nothing expires a design, and **a countdown in copy is
  a promise — show none**. If expiry is ever wanted, it is a scheduled Cloud Function on SERVER time.
- **Delete is a soft-delete MERGE inside a transaction**; a save against a design someone else deleted
  never resurrects it (`deleted-elsewhere`, "Save mine as new"); "Remove for good" re-reads the server
  in a transaction, and the rules require `deletedAt` for a hard delete.
- **`isDeleted` tests for the KEY**, not a usable timestamp — an unresolved `deletedAt` is still deleted.

## The page

- **No beta marker** (owner, Aug 2026): this is the tool the December 2026 proposals are built and
  judged in, not a sketch.
- **The orientation panel opens on a device's first visit and NEVER expires** — its audience is
  whoever arrives next. **Do not add an expiry.** `#linksHowBtn` reopens it from the About panel, not
  from a control of its own, and it closes the About panel before opening (two overlays share one
  Escape).
- **The workspace is used on a PHONE as well as a desktop** (owner, Sep 2026): a change is not finished
  when it looks right at 1280. The page never scrolls sideways at 390px; `.link-designer-save-meta` stays on a
  phone (who last saved a shared design is what an editor needs); **do not design against the iPhone
  SE** (owner, Sep 2026). A guard that walks every page has to seed a design, or Link Designer has nothing to
  measure.

### Every way of losing unsaved work asks first

While `dirty`, everything that replaces or discards the working copy asks before it acts — the list
is the reference's section of this name. **A new path that does so joins the list, with its
question**; anything that ends in `_activateDesign` is such a path. The exits nothing can ask about
(iOS discarding a page, a swipe away) keep a copy for the same designer to restore
(`unsaved-draft.js`). **Save a copy as… is worded differently on purpose**: its copy takes the unsaved
work, so "changes will be lost" would warn about the wrong outcome.

## Design and save model

- **Every key `docPayload` emits must be in the rules' `hasOnly` list, and the rules ship FIRST** — an
  extra key permission-denies every save on every device until they catch up.
- **The legacy singleton `linkDesigns/combined-28` is never written to**, and its migration gate ("a
  collection that has never held a design, live OR binned") is never loosened to "no live design".
- **Every doc ↔ object conversion is `link-designer-design-doc.js`**: every shape carries `window`; only what
  arrives from Firestore is normalised; the working copy DEEP copies its patterns.
- **`link-designer-design.js` imports nothing at all**, so the maths loads anywhere; the generator
  (`link-designer-generate.js`) imports from it, never the other way. **`restBetween` is the one reading of a
  rest**, and nothing of the maths is duplicated back into the coordinator.
- **Position keys are always `String(pos)`, never `Number`.**
- **CEAs do not work night shifts** (Gareth, June 2026): no night time is offered anywhere, and
  `normaliseCustomShift()` rejects a night start and any wrapping end — do not relax either. An
  unreadable shift classifies as `night`, a visible flag; **never map it to `rd`**, which hides it.
- **The paint chips are the times THIS design is made of** (`brushTimes`), and **a chip shows BOTH
  times** on two lines, exactly like the cell it paints — several shifts share a start time.
- **Spare and night wear the app's colours** (owner, 22 Nov 2026): spare is the Calendar's purple,
  night its dark wash; the fills stay translucent so the scroll cue shows through.
- **Compare mode scores nothing** — `A → B`, and the reader decides. An unchanged figure still renders,
  muted, because "identical" must not look like "not measured". **It diffs cells, not windows, so both
  windows are always stated.**
- **The staffed window**: TEXT inputs, never `<input type="time">` (Chromium shows 12-hour time);
  `normaliseWindow` falls back per ROW, never per field; an invalid pair is refused, not coerced; a
  design carries its window through the bin.
- **The heat map never scores the design**, and asks the boundary question to the MINUTE, never by the
  hour. `uncovered` (open, trains, nobody on) is a red finding; `outside` (trains while shut) is a
  neutral fact — the anti-cry-wolf rule.
- **The sticky summary bar is not a score**: it leaves out `standing`, which an edit cannot improve,
  never reports one of two paired counts, and never reads another renderer's result (`analyse` is the
  one reading).

### Empty and failed states

An empty card says what it is waiting FOR; "Go to Build a link" scrolls, it does not generate; the
empty checks panel wears no green tick. **A load FAILURE is not "you have not made one yet"**, and
**until the first read answers, the page is LOADING, not empty** — a design made before the load lands
would vanish unasked. The failed state carries **Try again**, because an installed app has no reload.

## Design checks

- **A hard limit either is or is not met; a fatigue factor reports presence and never passes or fails
  a design** (invariant 2). Fatigue rows are amber, never `.check-bad` red.
- **`POLICY_SOURCE_CONFIRMED` stays `false` until a controlled Chiltern source is cited**: every limit
  is stated provisionally, and a row reports the measurement, never "cannot be run". **Never hardcode a
  status**, and **do not promote another limit from recall**.
- **The dominant risk is FALSE ASSURANCE**: CLEAR and NOT-APPLICABLE report themselves, NOT-APPLICABLE
  ≠ CLEAR, STANDING ≠ PRESENT, and the collapsed rows hide prose, never the fact of a check. **Printing
  opens every `<details>`** (`createPrintPrep`): the sheet goes to the assessing manager.
- **Only FF19 carries "(definition to confirm)"**, on purpose: "a rest day resets it" is the owner's
  reading (28 Sep 2026), more lenient than ORR's wording, and the flag is how an assessor sees that.
  **Do not turn FF18 `present` above some figure** — the ORR gives no threshold.
- **A cover week is an unknown, not a no.** Every run is measured with `runLengthsWhere`, never a plain
  scan, and **a spare week is four duties of seven, Monday to Saturday, plus a Sunday that can be
  worked as overtime** (owner, 31 Oct 2026; `SPARE_WORKED_DAYS`). Counting all seven is not "the safe
  direction": it read the live main cycle at 15 against a true 9. `worstCaseWorkedRun` is the ONE
  reading of a run.
- **The 55-hour row is never CLEAR while the worst case crosses 55** (17 Nov 2026).
- **The owner's design target is below the company limit, not at it** (`DEFAULT_MAX_RUN`), so each row
  says which threshold it was measured against.
- **Hours a week: Sundays come out**, because Sunday is not contracted, and **a cover week counts as a
  full contracted week over the whole rotation** (owner). The days-worked divisor is the working lines
  (invariant 7).
- **The generator REFUSES a table that does not pay the contracted mean EXACTLY** (owner): a surplus is
  not a lesser fault, an unsatisfiable equality is the rule working, and `requireContract` defaults ON
  — `link-designer-contract.test.mjs` fails if the page ever passes `false`.

## The generator

- **Spare is a whole week, not a scatter of days** (owner, Aug 2026), as the real roster is built.
- **Two seed buttons, two questions**: Short Run's duty table (`link-designer-default-targets.js`) and today's
  roster. Neither label may say "reset" without saying to WHAT. **Which design's duties the generator
  starts from is the owner's question**, not a side effect of the shortlist. **The seed samples the
  whole MAIN cycle only** — never the bilingual roster, never only the weeks people sit on today.
- **Minimum rest is a GATE, not a finding** (owner: an 11h 45m gap "would never be allowed by
  Chiltern"): `repairShortRest` repairs a breach by swapping duties within a day column and refuses
  only what it cannot repair (invariant 4). Whole spare weeks are never touched. `requireRest`, like
  `requireContract`, is for construction fixtures only.
- **Saved staffing setups belong to their creator or the admin, and the rules enforce it** (invariant
  9); consent names a version, and a failed read is not an empty list.
- **Which construction ran is REPORTED, never silent.** Do not add back `buildDefaultDesign`,
  `initFromRosters` or `resetFromRosters`. **Interleaving the waves inside the generator is a
  WON'T-DO** (measured): the generator owns the SHAPE, `link-designer-adjacency.js` the ORDER.
- **Line order: switches, not a formula** (owner, Aug 2026) — each switch shows what it cost, and
  everything off leaves the order alone. **`variety` stays ON by default** (the owner called months of
  mornings "a bit excessive and would be unpopular"). A spare week is never a gentle transition.
  **Deterministic per attempt: never `Math.random`, never the clock.** Never quote a step or block figure
  without the switches and target set it was measured on.
- **The spare spread and the week-boundary rest are CONSTRAINTS, not switches**, charged in every
  configuration and filtered on; `.gen-obj-note` says so, and that copy is load-bearing.
- **Sunday is not contracted, and the generator does not model it**: the Sunday column is RDW cover
  you hope to fill. A cover week IS Mon–Sat SPARE (`isCoverWeek`); its Sunday is not asked about.

### No uplift control (owner decision)

An "increase every target by N%" control was built and removed: *"over complicates it."* If one is
ever proposed again it must **round the day-class TOTAL, not each slot** (largest remainder), or small
uplifts change nothing, and **a slot at 0 stays 0** — zero means that shift does not run that day.

### The generator intro must not restate a guarantee

**Describe what the generator does, and point at the checks for what it achieved.** The card opens with
ONE `.link-designer-desc` sentence (an e2e measures it); everything else is the `?` panel, `link-designer-tips.js`.

### Generator layout

The measured rules are the reference's "Generator layout". The ones most easily undone: the iOS
focus-zoom guard comes AFTER the rule it beats; every sticky cell needs an OPAQUE fill; the card has
ONE left edge; **do not "fix" the narrow table header with `overflow-y: visible`**; the objectives are
option rows shared with paycalc's — **do not re-create a page-local variant** — and ON is the BRIGHTER
row against the sunken fieldset.

## Line numbering — the full rotation

- **Every line rotates and carries a real worked pattern**: a vacancy is a missing person, not a
  missing pattern.
- **`ROTATING_LINES` is the ONE declaration of the length** (invariant 1) — do not write the number
  down, and do not give the current length as a fact in a comment or prose. The length and the
  cover-week count came from the owner (1 Oct 2026); the rules every design is judged against are
  `docs/links-26/RULES.md`. **The new link does not include the bilingual roster at all** (owner).
- **The shortlist is built in and read-only** (owner, 3 Oct 2026), listed A to Z with no
  recommendation (owner, 5 Nov 2026); a proposal id never reaches Firestore. **Keep only the shortlist**
  (owner, 2 Nov 2026) is one deliberate press by the admin, never a move on page open.
- **Designs drawn for the previous length go to Recently deleted** (owner, 3 Oct 2026), each move a
  transaction that re-asks the rule; **designs saved against an older, longer length keep their
  surplus lines** — trimming on load or on save destroys work.
- **A member on fixed hours is NOT a special case.** Do not add back the fixed-position or
  vacant-placeholder models.

## Concurrency and load safety

**Every design write goes through `link-designer-design-store.js`**, whose header owns its six rules: a read a
write depends on happens INSIDE the transaction; no weaker fallback while online; the baseline
advances only to a verified revision (invariant 5); a queued write is started, not awaited; every
transaction waits for this device's own queued writes and is handed the design's own record
(`runTx([ref], …)`); a queued save says how it ended.

- **Consent is per VERSION**, and **"Saving" is PER DESIGN** (`savingKeys`).
- **A queued save does not say "✓ Saved"** — it says it is saved in this browser, without the success
  colour, and its copy is kept until the server confirms it. A refused first save made NOTHING, so it
  never reads "Saved".
- **`dirty` clears only if nothing was edited while the save was in flight.**
- **Accepted limit**: two devices under the same display name do not conflict-prompt with the baseline
  unknown.

## Print

- **The whole rotation lands on ONE A4 landscape sheet** — re-measure if the rotation, the cell font or
  the masthead changes. **The grid card does NOT get `break-inside: avoid`**; coverage and the triage
  block do.
- **The masthead says "· includes unsaved changes" when the sheet is not the saved design** — the sheet
  goes to the assessing manager; do not remove it.
- In a home-screen app on iOS `window.print()` does nothing, so Print goes through `printOrExplain`.

## Sticky headers

- **The grid's day header sticks from 768px up only**, and keeping it over restoring the scroll
  container is the owner's decision (KNOWN_LIMITATIONS.md → Link Designer).
- **`.card` is `overflow: clip`, not `hidden`** — `clip` creates no scroll container, which the sticky
  header and the sticky save row both need.
