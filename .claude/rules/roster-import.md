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
---

# Weekly roster import — the parse, and every defence against a wrong week

**This is the authoritative contract for the roster PDF import.** It was `CLAUDE.md`'s "Weekly
Roster Upload" section until 15 Sep 2026, and it was moved for the reason the file tree was moved
before it: it is 8,000 characters of parser reasoning that only a session touching the import needs,
and `CLAUDE.md` is loaded into EVERY session. The `paths:` list above brings it back the moment
anybody opens one of these files. `CLAUDE.md` keeps the pipeline in four lines and points here.

> **The `paths:` list is deliberately BELT AND BRACES, and the duplicates are not an oversight.**
> Two of these files live under `functions/`, and no other rules file in this repo globs into a
> subdirectory — so whether the matcher reads a path or a basename has never been exercised here.
> Getting it wrong is SILENT: nothing errors, the contract simply never loads, and somebody edits
> the parser without it. Both spellings are listed so one of them matches either way. **The real
> safety net is not the glob**: each of these modules names this file in its own header, so a
> reader who opens the code is told the contract exists even if nothing auto-loaded it.

Request/response format and the review pipeline: **`docs/OPERATIONS_REFERENCE.md`**. What the
geometry gate still cannot see: **`docs/KNOWN_LIMITATIONS.md`**.

## The pipeline

Admin uploads PDF → `parseRosterPDF` (model in `functions/index.js` `CLAUDE_MODEL`) → JSON → review
UI → Firestore. Works for CEA/Bilingual, CES, and Dispatcher rosters.

**Critical:** `RDW|HH:MM-HH:MM` pipe encoding — the AI returns `"RDW HH:MM-HH:MM"`, normalised to a
pipe in review and stripped to a plain time on save. **Do not strip `RDW` from the AI return value.**

**`source: 'roster_import'`** on all roster-upload overrides — used by `computeCellStates()` for
COVERED / DIFF / CONFLICT classification.

## The review

**An unreadable cell can be ANSWERED IN THE REVIEW (v22.17).** It used to be a dead end: the row said "check the paper roster" and the only way to act was to finish the review, leave for the Admin page, and remember the person and the day. v22.16 briefly made it worse by routing every unmarked Sunday time into the same state; that rule went at v22.19 (false premise), but the control it prompted is a keeper — the real Supervisor roster contains `SEE NATHAN` and `See CEM`, which no parser will ever read as a shift. The row now offers type pills — generated from `PILL_TYPES`, so this control and Change a Shift cannot drift — plus 24-hour `HH:MM` boxes for Shift/RDW. The composed value goes through `manualCellValue` (override-utils.js) and then the SAME `normaliseCellValue` guards as any parsed value, so entering a value is never a route to write something the parsed path would have refused. Sunday exclusions are read from `isForbiddenOnSunday`, not restated. **`other` is deliberately unsupported** — its grammar needs the week editor's flavour chips — and the control says so rather than offering a pill that does nothing.

### The `UNKNOWN|<raw>` sentinel

**A day the guards REFUSE to record is SHOWN, not hidden — the `GUARDED` row (v23.97).** Leave or an absence on a base REST day, and anything on a Sunday, is normalised to `RD` by `normaliseCellValue` BEFORE `computeCellStates` picks a state — so the cell compared equal to base and came out `MATCH`, whose own definition is "PDF matches base roster, nothing to do", and whose rows are never rendered. The PDF said leave; the admin saw nothing at all for that day. **The write behaviour was right and is unchanged** (the v16.19 overpay guard: full-pay absence applies only to days the member was rostered to WORK). What was wrong is that the app ANSWERED a question it asks a manager out loud everywhere else — `AL on a rest day is ASKED about, never defaulted` (v23.75) — purely because the fact arrived by PDF. A `GUARDED` row carries no tick, writes nothing, is excluded from the person's pending badge, and says which guard fired (`normaliseCellValue` returns `guarded`, so the reason is derived once rather than re-inferred at the call site).

**`UNKNOWN|<raw>` sentinel (v15.30):** a non-empty cell `normaliseShift` can't parse is NOT defaulted to `RD` (which, when the base is also RD, silently dropped a real shift as a MATCH). It returns `UNKNOWN|<raw>`; `computeCellStates` maps it to an **UNREADABLE** review row. Since **v19.32** that row is no longer skip-ONLY: where the server sent two candidate readings (`choices`) and they survive normalisation as genuinely different values, the row offers them as a CONFLICT-style pick plus a **Skip** button, and a picked value IS written. Unpicked is still the default and still writes nothing, so a row left alone behaves exactly as it did before. Empty/blank cells still → `RD`.

## Day drift — a week written onto the wrong days

**Day-drift defence (v16.68) — three layers; a one-day shift can no longer be silently written.** The only entry point for a shifted row is the AI's visual ROW read (date assignment is deterministic: day-name keys → server dates). Layers: (1) `applySundayScanCorrections` — the original Sunday-anchored Case A/B repair; (2) **`applyColumnScanCrossCheck`** (`functions/roster-parse-helpers.js`) — the prompt now demands a second, column-by-column read (`columnScan`, generalising `sundayScan` to all 7 columns) and every cell is cross-checked row-vs-column: agreement → keep; a disagreement that realigns exactly under a one-day SUFFIX shift anchored at the first disagreeing day (a dropped blank shifts only the tail after it) with ≥2 disagreements and ≥5 signalled days → deterministic repair (two-source consensus); a **Rest ↔ Absence** disagreement (one read is `SICK` — a positive OD/HA/SC/ML/CL absence code; **SN is not one**, it is sickness on a day not booked to work and reads as RD — the other a rest day, and not a Sunday) → **records the absence** (`SICK`), because dropping a real absence is the dangerous SILENT failure (the person appears to be working) whereas a false absence is visible + correctable, and an absence code isn't hallucinated on a blank cell; any OTHER disagreement → the cell becomes `UNKNOWN|<app-language readings>? (PDF unclear)` — the skip-only UNREADABLE review state carrying BOTH readings (the readings use staff-facing terms — "Absent", never "sick"). Fails open when `columnScan` is absent. (3) **`detectShiftedRow`** (`roster-alignment.js`, client) — the AI-independent signal: the parsed week is correlated against the member's OWN base roster at offsets −1/0/+1; if a ±1 alignment beats offset 0 by ≥3 matches (and scores ≥5/7), the row is suspect.

**THE THREE "LAYERS" ARE NOT THREE WITNESSES, AND v22.16 STOPPED PRETENDING THEY WERE.** Layers 1 and 2 both come from ONE model call looking at ONE PDF — so when it visually collapses the blank Sunday cell and repeats that positional mistake across the row read, `sundayScan` AND `columnScan`, every server-side check agrees with the wrong answer and a whole week is written onto the wrong days. Nothing errors. Reproduced, and pinned by the "consistently shifted read" block in `roster-parse-helpers.test.mjs`. Layer 3 is the only genuinely independent evidence, and it was **warn-only above a fully-ticked list** — so the default action on a misread week was to save it. Now:

- **A suspect member's rows start UNTICKED** (`computeCellStates` owns the decision, so the save path inherits it).
- **`assessRosterAlignment` refuses the WHOLE read** when `ALIGNMENT_BLOCK_THRESHOLD` (3) members drift the same DIRECTION — a batch signature is a parser failure, not several people changing their week at once. No per-row override and no "save anyway": ticks are inert, conflict choices are inert, the Save button is removed, and the save loop skips every blocked cell.
- ~~An unmarked plain-time Sunday is never promoted to RDW~~ — **REMOVED at v22.19, premise disproved.** It assumed a genuinely worked Sunday carries an RDW marker on the paper roster. Three real rosters say otherwise: **21 worked Sundays across the CEA, Supervisor and Dispatch sheets, not one marked, while all 10 RDW markers sit on Mon–Sat.** RDW means *a rest day being worked*; Sunday is uncontracted, so its work is inherently overtime and the sheet never labels it. The rule would have sent all 21 to review — and, worse, it **fed the client's own circuit breaker an UNKNOWN exactly where the strongest drift evidence was**: on a left-shifted row the Sunday cell holds Monday's real value, which matches the base roster at +1. Measured over the whole roster, blinding it loses 2 of 14 detections, and the batch threshold is 3.
- **A blank cell is an answer on SUNDAY and a question everywhere else** (v22.19, replacing the flat "missing key → RD"). Mon–Sat unworked days are stated explicitly on every roster type — `RD`, `AL`, `SC`, `SN`, `OD`, `HA`, `ML`, `CL`, `NA` — so a blank there is not a rest day, it is a cell nobody read. Measured over 50 member rows: 24 blank Sundays, and 5 blank Mon–Sat cells, all five belonging to ONE person who appears on a second roster and works only its Saturday — a case that wants an admin rather than a default, since writing RD across their Mon–Fri would overwrite what their primary roster's import had just written. The rule is applied at BOTH sites in `buildSafeEntries` (a day whose header the model never listed, and a header listed with nothing in it); it was `'RD'` at both, so fixing one would have fixed nothing.
- **The review offers the original PDF**, because every message above ends in "check it against the PDF" and the file had left the workflow at parse time.

## Phase 2 — the grid ASSIGNS the day, so nothing can shift it (v24.04)

**The witness below is a check on an answer the model is still free to get wrong. This removes the
freedom.** When the PDF's drawn grid can place every member the roster type covers, the cells are
extracted by coordinate and the model is handed them already separated (`functions/roster-prompt.js`
→ `buildCellTable` / `buildCellPrompt`). It never assigns a day, so a row cannot shift — there is no
step at which anything could shift it. `sundayScan` and `columnScan` are not asked for, because they
exist to cross-check a day assignment nobody is making.

**Why phase 1 was not enough, measured on three REAL rosters (WE 26/09/2026, all three types):** the
witness refuses only **19 of 47** simulated one-day-left misreads. **23 of those 47 rows work all
seven days**, so a shifted claim never lands in an empty cell and there is nothing to contradict. The
other 60% pass silently, and no tuning changes that — it is what a witness can see.

**ALL OR NOTHING, PER DOCUMENT.** `buildCellTable` returns `usable: false` unless the grid places
every name in `relevantNames` (already scoped by roster type). A member the grid missed would arrive
with no cells, and "no cells" is indistinguishable from "a week of blanks" by the time it reaches
`buildSafeEntries` — so one miss falls the WHOLE document back to the PDF path, which still has the
witness, the cross-checks and the breaker. Mixing two reads of one document, half by coordinate and
half by the model's eye, with nothing on the review saying which row came from which, is the one
shape that must not ship. **An earlier draft gated on `activeMembers` and could never have been
satisfied** — that list spans all three roster types plus seven `hidden` Management accounts.

**The geometry read moved onto the critical path**, and that is the cost: it used to run free inside
the model's latency. Measured under a second per document against a ~15s model call.

**And moving it nearly cost the phase-1 witness, which is the bug worth remembering** (v24.05). The
first cut reused the pre-model result for the witness further down, on the reasoning that the promise
had settled. It has not settled when the early wait TIMED OUT — `awaitGeometryWithin` is a
`Promise.race`, so the extraction is still running and the caller holds a fail-open object. Before
phase 2 the only await came after the model call, so a slow extraction had the model's whole latency
plus the budget; after, it had the budget alone, and a PDF that overran it lost BOTH the geometry
path and the witness. `settledGeometry` re-asks on `wait-timeout` and ONLY on that — every other
fail-open reason (`no-grid`, `pdfjs-unavailable`, `no-text`, `work-budget`, `threw`) is a settled
answer, and re-asking those would spend the whole budget again on every ordinary fallback.

**A member legitimately absent from one week's sheet turns the geometry path OFF for that upload.**
`parseRosterPDF` already treats an absent member as advisory (`missingMembers`) — a leaver, a starter
not yet on the rota, somebody printed elsewhere — but the gate cannot tell that apart from "the grid
missed a row that IS on the page". It takes the safe reading. So phase 2 can go quiet for a roster
type and nothing will look broken; the coordinator logs which path it took, with the reason and the
unmatched count, on every parse. Read that line first.

**The cell table is JSON, one object per member, and that is a safety property.** A roster cell
legitimately contains a pipe (`06:00-14:00 | CEA 1` is one cell's two printed lines), so a delimited
table would draw its structure and its data from the same alphabet. As JSON the framing and the
escaping are one mechanism, and a cell carrying newlines or quotes cannot forge a row or a day —
pinned by the injection block in `roster-cell-read.test.mjs`.

**What the real files settled about LINES.** Every one of the **55 distinct values appearing on a
non-first line of a cell is a DUTY code** (`CEA 10`, `SUP 1`, `Dispatch`, `Shadow Nights`). No status
code sits on a second line — because a non-worked day has no time line above its code, so under the
grid a leave cell is a ONE-LINE cell. The line-position defect that `roster-prompt-parity` exists for
does not get caught here; it stops existing. The rule that follows is by CONTENT — drop what looks
like a duty code, normalise what remains — never "take the first line", which is the same positional
reasoning that failed before.

**ONE code table, and both prompts interpolate it.** `SHIFT_VOCABULARY` moved out of
`functions/index.js` into `roster-prompt.js`; two prompts with two copies would leave one unguarded,
which is exactly the rot `roster-prompt-parity.test.mjs` was written for. That test now reads the
table there, asserts both prompts use it, and checks the direction nobody was checking: **every code
the PROMPT names must be accepted by `normaliseShift` or waived by name.** Four are waived, each with
a reason — `NA`/`N/A`/`NS` (the prompt asks the model for `RD` directly) and `GER` (Gerrards Cross, a
LOCATION marker, where the model's reordering does real work: the parser reads `06:00-12:00 GER` but
not `GER 06:00-12:00`).

## The geometry gate — the one independent witness

**The strong witness is now IN the pipeline (v22.31, `functions/roster-geometry.js` — ROADMAP "Roster import" phase 1).** The roster's table rules are DRAWN in the PDF, at nine fixed x positions on every content page of every roster type measured, and assigning each text run by coordinate places every cell — on the row that drifts, not one text object sits in the Sunday column. `parseRosterPDF` reads that grid in parallel with the model call and applies it as the FINAL gate, after the column cross-check and the Sunday corrections: **an AI day landing in a physically EMPTY cell is refused, not weighed** — the cell becomes UNREADABLE and the row comes back as `geometryRefused`, which `roster-alignment.js` treats exactly like a base-roster drift (unticked; three trip the breaker). Zero false refusals on the corpus. It fails open everywhere and says so (`geometry.status`), and it cannot see a fully occupied week or an `RD` in an occupied cell — those are phases 2 and 3, and KNOWN_LIMITATIONS says so. `pdfjs-dist@4.10.38` is now a dependency of `functions/` (server-side; the fourth vetted library — the owner's call to keep, and one line to remove).
