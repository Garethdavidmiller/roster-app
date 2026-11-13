---
paths:
  - "admin-roster-upload.*"
  - "roster-alignment.js"
  - "roster-cell-rules.*"
  - "roster-entry-control.js"
  - "roster-review-states.js"
  - "roster-geometry.test.mjs"
  - "roster-parse-helpers.test.mjs"
  - "roster-prompt-parity.test.mjs"
  - "functions/roster-*.js"
  - "roster-parse-helpers.js"
  - "roster-geometry.js"
  - "roster-prompt.js"
  - "roster-cell-read.test.mjs"
  - "functions/cell-day-rules.js"
  - "cell-day-rules.js"
  - "roster-other-days.js"
---

# Weekly roster import — the parse, and every defence against a wrong week

**This is the authoritative contract for the roster PDF import.** `CLAUDE.md` keeps the pipeline in
four lines and points here; the `paths:` list above loads this file whenever one of the import's
modules is opened.

> **The `paths:` list is deliberately BELT AND BRACES, and the duplicates are not an oversight.**
> Several of these files live under `functions/`, and whether the matcher reads a path or a basename
> has never been exercised for a subdirectory here. Getting it wrong is SILENT: nothing errors, the
> contract simply never loads. Both spellings are listed so one of them matches either way. **The
> real safety net is not the glob**: each of these modules names this file in its own header, so a
> reader who opens the code is told the contract exists even if nothing auto-loaded it.

Request/response format and the review pipeline: **`docs/OPERATIONS_REFERENCE.md`**. What the
geometry gate still cannot see: **`docs/KNOWN_LIMITATIONS.md`**.

## The pipeline

Admin uploads PDF → `parseRosterPDF` (model and its settings: `MODEL_REQUEST` in `functions/roster-prompt.js`) → JSON → review
UI → Firestore. Works for CEA/Bilingual, CES, and Dispatcher rosters.

**Critical:** `RDW|HH:MM-HH:MM` pipe encoding — the AI returns `"RDW HH:MM-HH:MM"`, normalised to a
pipe on the server (`normaliseShift`, `functions/roster-parse-helpers.js`) and stripped to a plain
time on save. **Do not strip `RDW` from the AI return value.**

**`source: 'roster_import'`** on all roster-upload overrides — used by `computeCellStates()` for
COVERED / DIFF / CONFLICT classification.

**The Save is checked against what the review LOADED (v25.92)** — `saveRosterWrites`,
`roster-import-save.js`, whose header carries the reasoning. Each part that DELETES a record is one
transaction, refused (nothing written, the days named) when a record it deletes changed after the
read; a part that only adds stays a plain batch, because a manual record outranks an import. A
refusal re-reads the week and redraws the review rather than closing it, and **every row the re-read
leaves unchanged keeps the admin's answers, Skip all included** (`carryReviewAnswers`, v25.94):
reset to their defaults, a second Save wrote rows the admin had unticked. **Do not mint the new
records' ids inside the transaction** — a re-run would write a second copy of every row — and do
not turn a deleting part back into a batch.

## The review

**An unreadable cell can be ANSWERED IN THE REVIEW.** Real rosters carry cells no parser will ever
read as a shift (the Supervisor sheet has `SEE NATHAN` and `See CEM`), so the row offers type pills —
generated from `PILL_TYPES`, so this control and Change a Shift cannot drift — plus 24-hour `HH:MM`
boxes for Shift/RDW. The composed value goes through `manualCellValue` (override-utils.js) and then
the SAME `normaliseCellValue` guards as any parsed value, so entering a value is never a route to
write something the parsed path would have refused. Sunday exclusions are read from
`isForbiddenOnSunday`, not restated. `other` is offered with the week editor's own flavour chips and
optional times (generated from `OTHER_FLAVOURS`, composed by `composeOtherValue`); Spare is the one
flavour not offered here. The control's own rules are in `roster-entry-control.js`'s header.

**A member the model lists twice keeps ONE row, and the review names them.** `memberRows`
(`functions/roster-parse-helpers.js`) keeps the first row that is not empty, as the grid matcher does
(`soleOccupied`: a real Dispatch sheet prints an empty placeholder row above the member's real one),
and `buildSafeEntries` skips the rest. `parseRosterPDF` sends each such member as `duplicateMembers`
(`repeatedMembers`, `functions/roster-prompt.js`, judged against the same names `missingMembers` is),
and the review gives each one a line asking the admin to check them against the PDF.

### A day the guards REFUSE to record is SHOWN — the `GUARDED` row

Leave or an absence on a base REST day, and anything on a Sunday, is normalised to `RD` by
`normaliseCellValue` BEFORE `computeCellStates` picks a state, so without this row the cell compares
equal to base, comes out `MATCH` ("nothing to do") and is never rendered — the PDF said leave and the
admin would see nothing. **The write behaviour is right**: the overpay guard means full-pay absence
applies only to days the member was rostered to WORK. What the row prevents is the app silently
ANSWERING a question it asks a manager out loud everywhere else (`AL on a rest day is ASKED about,
never defaulted`) just because the fact arrived by PDF.

- A `GUARDED` row carries no tick, writes nothing, is excluded from the person's pending badge, and
  says which guard fired (`normaliseCellValue` returns `guarded`, so the reason is derived once rather
  than re-inferred at the call site).
- **A rest-day row ASKS** (owner: "why can't I enter the correct shift there?") — "Was it a swapped
  working day?" with *Swapped — record it* / *Rest day — leave it*. Only "swapped" writes, and it
  writes the roster's own `SICK`/`AL` stamped `replacedType` via `replacedTypeForSwap`, because
  without that stamp `isOverrideDisplaySuppressed` hides an absence on a rest-day base.
- **"Rest day — leave it" writes nothing new, but removes an earlier record on that day**, because the
  PDF now says it is not a working day (`guardedWrites`, `deleteOnly`).
- **Unanswered writes nothing** — asked, never defaulted — and **Skip all takes an answer back** (an
  answered swap is a write, so a skipped section must not still write it).
- Sundays and breaker-refused reads ask nothing, and nor do 25 and 26 December from 2026: the app's
  Christmas leave decides those days, so their rows start unticked and say so (owner, 10 Nov 2026).
- **Do not point this row at Change a Shift**: there a bare absence on a base rest day is hidden
  unless a swapped-in shift is saved first.

### The `UNKNOWN|<raw>` sentinel

A non-empty cell `normaliseShift` cannot parse is NOT defaulted to `RD` — when the base is also RD,
that silently dropped a real shift as a MATCH. It returns `UNKNOWN|<raw>`, and `computeCellStates`
maps it to an **UNREADABLE** review row.

- Where the server sent two candidate readings (`choices`) that survive normalisation as genuinely
  different values, the row offers them as a CONFLICT-style pick plus a **Skip** button, and a picked
  value IS written.
- **Two readings that write the SAME hours worked are one answer**, offered as a single pick (a
  Sunday's `MEET 10:00-14:00` beside `10:00-14:00`). A lone rest day is not offered — written on a
  rostered Sunday it takes the shift away — and a Sunday training or meeting reading is never offered.
- Unpicked is the default and writes nothing.
- A reading of leave or an absence on a base REST day is not offered at all (the guard would show it
  as "Rest"): the row shows what was read, and the entry below asks the swapped-day question. A rest
  day picked or entered over a base rest day writes nothing new, only clearing what the day held
  (`restOverRest`; whole-app fix, Nov 2026).
- An EMPTY cell — nothing, `BLANK`, `EMPTY` or a lone dash (`BLANK_READINGS`, the one list every read
  shares) — is decided by the DAY (`blankCellMeaning`): `RD` on a Sunday, an UNREADABLE review row
  Monday to Saturday (below).

## Day drift — a week written onto the wrong days

**Day-drift defence — four layers; a week must never be silently written onto the wrong days.** The
only entry point for a ONE-day shift is the AI's visual ROW read (date assignment is deterministic:
day-name keys → server dates), and layers 1–3 guard it. A WHOLE week out enters through the week
chosen on the form instead, and only layer 4 can see it.

1. **`applySundayScanCorrections`** (`functions/roster-sunday-repair.js`) — the Sunday-anchored Case
   A/B repair. Its clean right-shift needs an EMPTY Saturday slot, and **only the blank-Saturday
   question counts as empty** (`BLANK_SATURDAY`): a Saturday reading `RD` is a rest code somebody
   printed (and `NA`/`NS` read as `RD`), so counting it would right-shift a correctly read week whose
   Sunday the scan mistook for blank, with nothing flagged. That case is disputed instead. The
   partial branch never overwrites the Sunday claim: it leaves it for the geometry witness, and
   `settleDisputedSundays` sends it to review afterwards if the witness could not look. And the claim
   must be the ROW READ's own: where the column cross-check has left a question on the Sunday, its
   pick's row reading decides, so a question whose row reading was a rest day moves nothing (rule 3 in
   the module's header).
2. **`applyColumnScanCrossCheck`** (`functions/roster-parse-helpers.js`) — the prompt demands a
   second, column-by-column read (`columnScan`, generalising `sundayScan` to all 7 columns) and every
   cell is cross-checked row-vs-column:
   - agreement → keep;
   - a disagreement that realigns exactly under a one-day SUFFIX shift anchored at the first
     disagreeing day (a dropped blank shifts only the tail after it), with ≥2 disagreements and ≥5
     signalled days → deterministic repair (two-source consensus); the cell the shift vacates takes
     the day's blank meaning when the scan saw it empty or read nothing there — Monday to Saturday a
     question, never a rest day;
   - a **Rest ↔ Absence** disagreement (one read is `SICK` — a positive OD/HA/SC/ML/CL absence code;
     **SN is not one**: it is sickness on a day not booked to work and reads as RD — the other a rest
     day, and not a Sunday) → **records the absence** (`SICK`), because dropping a real absence is the
     dangerous SILENT failure (the person appears to be working) whereas a false absence is visible
     and correctable, and an absence code is not hallucinated on a blank cell;
   - any OTHER disagreement → `UNKNOWN|<app-language readings>? (PDF unclear)` — the UNREADABLE state
     carrying BOTH readings, offered as a pick (above). The readings use staff-facing terms —
     "Absent", never "sick".

   Fails open when `columnScan` is absent.
3. **`detectShiftedRow`** (`roster-alignment.js`, client) — the AI-independent signal: the parsed
   week is correlated against the member's OWN base roster at offsets −1/0/+1; if a ±1 alignment beats
   offset 0 by ≥3 matches (and scores ≥5/7), the row is suspect.
4. **`checkSheetWeek`** (`functions/roster-week-heading.js`) — the sheet's OWN week, and **it does
   not depend on the model**: it reads the PDF's text layer, never a reply. Layers 1–3 compare a day
   with its neighbours, so a sheet for a different week, read perfectly, passes all three. The
   roster prints its week (`Week Ending: DD/MM/YYYY`, on page 1 above the grid; the footer's Print
   Date is never read). The grid read collects every such heading, and `parseRosterPDF` refuses the
   WHOLE read with a 409 when one names a week other than the one chosen, with a message naming both
   weeks that the admin sees as written: before the model is called, or, when the early wait on the
   grid read gave up, once it settles (as `settledGeometry` re-asks for the witness, below), and
   either way before anything is written. **It never guesses**: no heading read (no text layer, a
   layout without one, a date that is not a Saturday) fails open and is logged, as the geometry
   witness does (owner, 10 Nov 2026).

**THE FIRST THREE "LAYERS" ARE NOT THREE WITNESSES.** Layers 1 and 2 both come from ONE model call
looking at ONE PDF — so when it visually collapses the blank Sunday cell and repeats that positional
mistake across the row read, `sundayScan` AND `columnScan`, every server-side check agrees with the
wrong answer and a whole week is written onto the wrong days. Nothing errors. Pinned by the
"consistently shifted read" block in `roster-parse-helpers.test.mjs`. Of the three, layer 3 is the
only genuinely independent evidence, so it must never be warn-only above a fully-ticked list:

- **A suspect member's rows start UNTICKED** (`computeCellStates` owns the decision, so the save path
  inherits it).
- **`assessRosterAlignment` refuses the WHOLE read** when `ALIGNMENT_BLOCK_THRESHOLD` members drift
  the same DIRECTION (a geometry refusal counts whichever way the others lean) — a batch signature is a
  parser failure, not several people changing their week at once. No per-row override and no "save
  anyway": ticks are inert, conflict choices are inert, the Save button is removed, and the save
  collector (`collectRosterWrites`) skips every blocked cell.
- **Do not send an unmarked plain-time Sunday to review, or require an RDW marker on one.** Real
  rosters never mark a worked Sunday (measured: 21 worked Sundays across the CEA, Supervisor and
  Dispatch sheets, none marked, while all 10 RDW markers sat on Mon–Sat) — RDW means *a rest day being
  worked*, and Sunday work is inherently overtime. Such a rule also blinds the drift breaker exactly
  where its strongest evidence is: on a left-shifted row the Sunday cell holds Monday's real value,
  which matches the base roster at +1.
- **A blank cell is an answer on SUNDAY and a question everywhere else.** Mon–Sat unworked days are
  stated explicitly on every roster type — `RD`, `AL`, `SC`, `SN`, `OD`, `HA`, `ML`, `CL`, `NA` — so a
  blank there is a cell nobody read, not a rest day. The measured case is a person who appears on a
  second roster and works only its Saturday: writing RD across their Mon–Fri would overwrite what
  their primary roster's import had just written. The rule is applied at BOTH sites in
  `buildSafeEntries` (a day whose header the model never listed, and a header listed with nothing in
  it); fixing one alone fixes nothing. **On a row whose Monday to Saturday were ALL unread, the review
  treats the Sunday as a question too** (decided default, Nov 2026 — `computeCellStates`), so that
  member's blank Sunday is never pre-ticked as a rest day.
- **`NA` and `NS` are REST DAYS, on every day** (owner, 6 Nov 2026: "NA and NS should be treated as
  rest days on the roster uploader", Sundays included). `normaliseShift` records both as `RD` beside
  `SN`, so `buildSafeEntries`, the column cross-check and the grid read's rest test all get the same
  answer; the tests pin all seven days, because earlier answers differed by day (history in
  `functions/cell-day-rules.js`, whose recognisers — `N/A`, `N.A.` — the Sunday scan repair also asks).
  **Weeks imported between 24 Sep and 6 Nov 2026 hold their NA days as Absent**, and nothing stored
  says which absences those were (the reason is never stored), so they change only when that week's
  roster is uploaded again.
- **A MEETING IS ALWAYS A MEETING** (owner, 6 Nov 2026: "MTG should always be other (with the meeting
  flavour)"). `MEET` is its own alias beside `MTG` and `MEETING` (the prompt asks the model to return
  `MEET`); a meeting keeps its times in either order (`MEET 10:00-14:00`, `MEET RDW 10:00-14:00` — the
  client grammar's optional range, which a meeting's `hideBaseTime` was built to show); and a cell
  naming a meeting that cannot be read cleanly goes to review, never to a plain shift. The reasoning
  is in `functions/roster-other-days.js`.
- **A Sunday refuses a training or meeting day AS AN OTHER DAY** (owner: "You can't have training or a
  meeting on a Sunday"). A bare Sunday training or meeting day is a GUARDED row on EVERY Sunday, under
  its own reason (`sunday-other`): nothing is written, whatever the base, a saved record or an earlier
  import says, and the day stays as it is — never a ticked DIFF or a CONFLICT whose "use new roster"
  turns a worked day into rest. **One printed WITH TIMES is somebody working those hours on a Sunday**
  and is recorded as rest-day working at its times (`sundaySafeValue`); never turn it into `RD`, which
  dropped it on a rest Sunday, deleted it on a re-upload, and pre-ticked a correction that turned a
  worked rostered Sunday into rest. The other Other flavours keep the no-times rule; written
  time-first they still import as a plain shift — a known gap nobody has asked to close.
- **The review offers the original PDF**, because every message above ends in "check it against the
  PDF".

## Phase 2 — the grid ASSIGNS the day, so nothing can shift it

**The geometry witness (below) checks an answer the model is still free to get wrong. Phase 2 removes
the freedom.** When the PDF's drawn grid can place every member the roster type covers, the cells are
extracted by coordinate and the model is handed them already separated (`functions/roster-prompt.js`
→ `buildCellTable` / `buildCellPrompt`). It never assigns a day, so a row cannot shift. `sundayScan`
and `columnScan` are not asked for, because they exist to cross-check a day assignment nobody is
making.

**Why the witness alone is not enough** (measured on three real rosters, WE 26/09/2026, all three
types): it refuses only 19 of 47 simulated one-day-left misreads. 23 of those 47 rows work all seven
days, so a shifted claim never lands in an empty cell and there is nothing to contradict. No tuning
changes that — it is what a witness can see.

**ALL OR NOTHING, PER DOCUMENT.** `buildCellTable` returns `usable: false` unless the grid places
every name in `relevantNames` (already scoped by roster type). A member the grid missed would arrive
with no cells, and "no cells" is indistinguishable from "a week of blanks" by the time it reaches
`buildSafeEntries` — so one miss falls the WHOLE document back to the PDF path, which still has the
witness, the cross-checks and the breaker. Mixing two reads of one document, half by coordinate and
half by the model's eye, with nothing on the review saying which row came from which, is the one
shape that must not ship. **Gate on `relevantNames`, never on `activeMembers`**: that list spans all
three roster types plus the hidden Management accounts, so it could never be satisfied.

**The geometry read is on the critical path** — measured under a second per document against a ~15s
model call; that is the cost of the guarantee.

**`settledGeometry` re-asks on `wait-timeout` and ONLY on that.** `awaitGeometryWithin` is a
`Promise.race`: when the early wait times out, the extraction is still running and the caller holds a
fail-open object, so reusing it for the witness would lose BOTH the geometry path and the witness on a
slow PDF. Every other fail-open reason (`no-grid`, `no-rows`, `pdfjs-unavailable`, `unreadable-pdf`,
`no-text`, `work-budget`, `threw`) is a settled answer, and re-asking those would spend the whole budget again on
every ordinary fallback. The full reasoning is beside `settledGeometry` in `functions/roster-geometry.js`.

**A member legitimately absent from one week's sheet turns the geometry path OFF for that upload.**
`parseRosterPDF` treats an absent member as advisory (`missingMembers`) — a leaver, a starter not yet
on the rota, somebody printed elsewhere — but the gate cannot tell that apart from "the grid missed a
row that IS on the page", and takes the safe reading. So phase 2 can go quiet for a roster type with
nothing looking broken; the coordinator logs which path it took, with the reason and the unmatched
count, on every parse. Read that line first.

**An EMPTY read of a FILLED cell is a question, not the day's default.** `buildSafeEntries` resolves a
blank by the day — a rest day on Sunday — which is right when nobody knows what the cell held. On this
path the server does, so `reviewBlankReadsOfFilledCells` (`roster-prompt.js`) sends such a cell to the
review naming its printed text; otherwise a worked Sunday the model reported as BLANK becomes `RD`,
matches the base Sunday and is never shown, and the witness cannot see it because `RD` is not a claim.
A cell that SAYS rest is left alone, and the rule feeds nothing to the drift breaker.

**And a REST DAY read for an EMPTY weekday cell is a question too** (`reviewRestReadsOfEmptyCells`,
beside it). Monday to Saturday a blank is never a rest day, and a model that answered `RD` for it
would otherwise be believed, because the witness refuses only claims — the second-roster case above:
`RD` across a Monday to Friday, written over the primary roster's import, with nothing on the review.
Sunday is left alone (a blank Sunday IS a rest day), and like its twin the rule feeds nothing to the
drift breaker.

**The cell table is JSON, one object per member, and that is a safety property.** A roster cell
legitimately contains a pipe (`06:00-14:00 | CEA 1` is one cell's two printed lines), so a delimited
table would draw its structure and its data from the same alphabet. As JSON the framing and the
escaping are one mechanism, and a cell carrying newlines or quotes cannot forge a row or a day —
pinned by the injection block in `roster-cell-read.test.mjs`.

**LINES are read by CONTENT, never by position.** On the real files every value on a non-first line
of a cell is a DUTY code (`CEA 10`, `SUP 1`, `Dispatch`, `Shadow Nights`); no status code sits on a
second line, because a non-worked day has no time line above its code. So the rule is: drop what
looks like a duty code, normalise what remains — never "take the first line", which is the same
positional reasoning that failed before.

**ONE code table, and both prompts interpolate it.** `SHIFT_VOCABULARY` lives in `roster-prompt.js`;
two prompts with two copies would leave one unguarded. `roster-prompt-parity.test.mjs` reads the
table there, asserts both prompts use it, and checks both directions of every prompt row, multi-word
rows included: **every code the PROMPT names must be accepted by `normaliseShift` or waived by name**,
and **every value the prompt tells the model to RETURN must be one `normaliseShift` accepts**. One code
is waived, with its reason — `GER` (Gerrards Cross, a LOCATION marker, where the model's reordering
does real work: the parser reads `06:00-12:00 GER` but not `GER 06:00-12:00`).

## The geometry gate — the one independent witness

`functions/roster-geometry.js` (ROADMAP "Roster import" phase 1). The roster's table rules are DRAWN
in the PDF, at nine fixed x positions on every content page of every roster type measured, and
assigning each text run by coordinate places every cell — on the row that drifts, not one text object
sits in the Sunday column. `parseRosterPDF` reads that grid before the model call (phase 2 needs its
cells) and applies it as the FINAL gate, after the column cross-check and the Sunday corrections: **an AI day
landing in a physically EMPTY cell is refused, not weighed** — the cell becomes UNREADABLE and the row
comes back as `geometryRefused`, which `roster-alignment.js` treats exactly like a base-roster drift
(unticked, and counted toward the breaker). Zero false refusals on the corpus. It fails open
everywhere and says so (`geometry.status`), and it cannot see a fully occupied week or an `RD` in an
occupied cell — those are phases 2 and 3, and KNOWN_LIMITATIONS says so. `pdfjs-dist@6.5.438` (v25.91) is a
dependency of `functions/` (server-side; the fourth vetted library — the owner's call to keep, and one
line to remove). Never pin it below 6.5.438, and run the real-pdfjs tests before moving it: the module
header of `functions/roster-geometry.js` says why for both. **The move to 6.x was proven on synthetic
pages only** (no real roster was to hand, 13 Nov 2026), and v25.91 misread every path painted with
`s`, `b` or `b*` until v25.94 — at worst a row highlight that emptied a Sunday cell, a worked Sunday
dropped with nothing on the review. Against v4 on thirty-five drawings it now reads the same rows on
all but three — rows as closed boxes in a `re`'s own corner order, and a rule closed before its
stroke (`m l h S`, `m l h s`) — and on those it reads no grid rather than a different one. So if an
import's review says "The extra PDF layout check couldn't run for this file", read that roster's
operator list before assuming the file is at fault.
