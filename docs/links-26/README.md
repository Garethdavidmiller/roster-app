# Links — the new CEA link, 26 lines

**"links-26" means 26 lines, not 2026.** It is the 26-week rotation, and it follows `links-24`, the 24-line work it
replaced on 1 Oct 2026 (removed on 7 Nov 2026; `git show 924b9dbc:docs/links-24/README.md` reads it).

**Where it stands.** The new link is for everyone on the normal CEA contract — those on a CEA bilingual contract keep
their own links — and starts in January 2027, the day not yet set (owner, 8 Nov 2026). The pack holds 18 designs. Three
are the shortlist, A to Z: **Balanced V6**, **Level Crossing** and **Middle Ground**, drawn on 8 Nov 2026 for the design
target of no two closing weeks side by side, all three in `30-days-off/` (Balanced V6 in its subfolder `balanced/`).
Short Run, on the shortlist until then, is off it and stays in `proposals/`. **Nothing is decided**: the pack and the app
present the three evenly and recommend none, and the New link page says which was chosen only once a design is named in
`CHOSEN` in `newlink-config.js` (`null` today). S. Silva, the RMT rep, leads the change, and the pack is deliberately vague
about how the choice is made (owner, 4 Nov 2026): the process is recorded in `../DECISIONS.md` → The new CEA link, and a rebuild
adds nothing about who decides, votes or recommends.

The 24-line work is not wasted. The rules, the duty tables, the tooling and the designs all carry over. What has to
change is the arithmetic that depends on the number of lines.

**How the designs were reached is [`HISTORY.md`](HISTORY.md)**: every dated section, from Second Nature (1 Oct 2026) to
the shortlist at a glance (9 Nov 2026), with the notes that correct their figures. Its figures are as of each section's
date; the sheets, the decks and the New link page have the current ones. **A section named in italics or quotes below
(*Same Again*, "Set Fair", *The league reweighted*…) is one of HISTORY.md's**, unless it is a heading of this file.

## What is in this folder

The two link folders, `links-24` and `links-26`, shared one layout (2 Oct 2026, owner: "consistent naming"; `links-24` was
removed on 7 Nov 2026):

| | What it is |
|---|---|
| `links-NN-proposals.zip` | everything for sharing, in one download — for links-26 built on demand by `tooling/pack.py` and never committed |
| `links-NN-rules.pdf` | the rules every proposal is judged against |
| `links-NN-summary.pdf` | every proposal against today's link, on one page — the shortlisted ones marked ★ |
| `links-26-shortlist.pdf` | the three shortlisted designs (Balanced V6, Level Crossing and Middle Ground, A to Z, since 8 Nov 2026) against each other and today, each with its edge and its costs and none recommended, on two pages (26 lines only; `tooling/shortlist-sheet.mjs`) |
| `links-26-other-designs.pdf` | every design off the shortlist beside the three: what each has and what it pays, A to Z folder by folder, on one page when it fits — fifteen rows since 9 Nov 2026 — and otherwise on two, split at the folders (26 lines only; written with the shortlist sheet by `tooling/shortlist-sheet.mjs`, since 7 Nov 2026, when it left the shortlist's page 2) |
| `links-26-what-it-means.pdf` | "What it means if you…": the three shortlisted designs against today for six kinds of colleague — earlies, lates, swaps, Sundays, no overtime, leave — on one page (26 lines only; `tooling/what-it-means-sheet.mjs`, since 1 Nov 2026) |
| `links-26-shortlist-at-a-glance.pdf` | "The shortlist at a glance": the three shortlisted designs beside today's link on one A4 page — what all three give and cost against today, the measures where they differ, and each one's edge and cost as the shortlist sheet gives them (26 lines only; `tooling/glance-sheet.mjs`, since 9 Nov 2026, audited the same day; in the zip and on the New link page since that evening) |
| `30-days-off/` | links-26 only, since 4 Nov 2026: the proposals where 14 days' leave buys 30 days off, as today, laid out as `proposals/` is, with a README of their own; still part of the pack, the league and the summary; since 7 Nov 2026 the Balanced designs, five since Balanced V5 was discarded on 9 Nov 2026, are in its subfolder `30-days-off/balanced/` (owner: "Put all the Balanced proposals in their own subfolder"), *Balanced* in the zip |
| `proposals/` | one design per three files: `<Name>-<CODE>-<fingerprint>.pdf` (the eight-page sheet), `<Name>-<CODE>.json` (the grid) and `<Name>-<CODE>-import.txt` (for the Links page). The fingerprint is the rota's own (`regenerate.mjs` hashes the cells), so a re-render that changes a cell renames the sheet — and for the three sheets the New link page serves, all in `30-days-off/`, changes a live URL: `newlink-data.mjs --check` (which `newlink-data.test.mjs` runs) fails until `newlink-data.mjs` is run again |
| `presentations/` | `<Name>-for-colleagues` and `<Name>-for-managers`, as `.pptx` and `.pdf`: Balanced V6's, Level Crossing's and Middle Ground's, the shortlist's since 8 Nov 2026 and the only ones in the zip; Short Run's, made for the shortlists before then and out of the zip since (In Step's, made with them, were deleted with it on 8 Nov 2026; Common Ground's and Even Step's went with the two designs on 9 Nov 2026, their PowerPoints kept in `tooling/deck-template/` as the decks the ones in use are built from); and Balanced V10's, Clockface's and Short Working's, drawn on 8 Nov 2026 beside the shortlist, not in the zip either |
| `tooling/` | the scripts that build and check all of the above; `tooling/results/` holds the committed search outputs, `tooling/reference-24/` the few 24-line files they still read (since 7 Nov 2026), and `tooling/deck-template/` the finished decks the presentations in use are built from (Common Ground's and Even Step's since 9 Nov 2026) |
| `RULES.md` | the rules in prose, with their sources and the open questions (26 lines only) |
| `README.md` | this reference — where the link stands, the layout, the rules and the tooling; the repository's working notes, not part of the pack (left out of the zip since 5 Nov 2026, owner) |
| `HISTORY.md` | the dated record of how the designs were reached, each section's figures as of its date (split from this file on 24 Nov 2026); not part of the pack either |

`NN` is the link's length in weeks. A proposal keeps its own name, because the code and fingerprint in it identify the
exact rota on a printout. Inside the zip, the files carry the same names as here.

**The New link page serves eight of these files, live.** The app's New link page lists them in `newlink-data.js`'s `PACK`
— the three shortlisted designs' colleague presentations and proposal sheets, the shortlist at a glance and the rules —
and opens them from the GitHub Pages mirror on both addresses (`PACK_BASE` in `newlink-config.js`; Firebase Hosting
serves nothing under `docs/`). So renaming, moving or deleting one of the eight breaks the page for every reader until
`newlink-data.mjs` is run again and the app released, and retiring the mirror breaks it outright.

## The rules — settled 1 Oct 2026

**`RULES.md` is the rule set for 26 lines.** It is the 24-line set with the owner's changes marked in it: 26 lines;
**5 cover weeks**, as evenly spread as 26 allows (gaps of 5, 5, 5, 5 and 6); and **219 contracted days a year or
fewer**, today's figure as a ceiling. Everything else is unchanged, fourteen on a Saturday included (still a flexible
rule).

What that means in numbers: 21 working lines, so the contract is **44,100** Monday-to-Saturday minutes a week; and the
ceiling allows **at most 89 Monday-to-Saturday duties, averaging at least about 8h 16m** (89 gives 218.6 days a year,
90 would give 220.6). With fourteen on a Saturday, that is about 15 a weekday. The working is in `RULES.md`.

## What carries over unchanged

- **The rules, in their three tiers,** with the changes above: the 3 hard limits (plus the 219-day ceiling, which is hard too), the 9 December staffing rules
  and the 3 flexible rules. See `RULES.md`.
- **The shift-time sets** of the strongest 24-line designs, as starting points:
  - **Familiar Nine** (`tooling/reference-24/Familiar-Nine-F9-24-K31s.json` since 7 Nov 2026): every rule met, 14 of 20 weeks on one turn.
  - **Right Away** (`git show 924b9dbc:docs/links-24/proposals/Right-Away-FR-24-F34s.json`).
  - **Silva Lining** (`git show 924b9dbc:docs/links-24/proposals/Silva-Lining-SL-24-Hs.json`, version H of its series): 14 times, no fatigue warnings, a
    9-hour cap.
- **The judging.** Every figure comes from the app's own Links modules, which take the line count as a parameter.

## The tooling (`tooling/`, set up 1 Oct 2026)

The 24-line pipeline, copied and set to 26 lines. **`tooling/link.mjs` states the link once**: 26 lines, 5 cover weeks
(default lines 1, 6, 11, 16, 21), 21 working lines, the 44,100-minute contract, the 219-day ceiling, and the headcounts the
tables are built to (15 a weekday, 14 on a Saturday, 10 on a Sunday). The sheets, the decks and the checks read those
from there; the search and solver scripts (`skeleton.mjs`, `skeleton-start.mjs`, `exact-*.py`, `short-earlies.mjs`)
carry their own copy of the link's shape, so a change of length is that edit and theirs (`link.mjs` says so). The
24-line tooling was in `../links-24/tooling/`, changed only for the per-year weekends line of 2 Oct 2026, until it went
with that folder on 7 Nov 2026; two of its modules live on in `tooling/reference-24/`, for the league's Familiar Nine row.

**What it checks, beyond the 24-line set** (`RULES.md`):
- **Cover weeks:** five, with gaps differing by one line at most (`coverSpread`). It is a flexible rule, as before.
- **The days ceiling is a HARD limit.** `assess()` (`report-data.mjs`) adds it to the hard-limit checks, so a design
  over 219 contracted days a year "cannot be run as it stands" on page 1. On page 6 it shares the contract card:
  "35h a week · 218.6 contracted days a year, 219 at most".
- **No waivers and no named offices** are carried over from 24 lines (`fresh.mjs`, `report-data.mjs`).

**The scripts kept** are the ones the Familiar Nine / Right Away method uses. The one-off searches for particular
24-line designs stayed in `links-24` only, and went with it on 7 Nov 2026.

| Stage | Script | What it does |
|---|---|---|
| 1 · duty table | `final-table.mjs` | the best table for one day, by fit to the trains, under every rule; a proof unless `ANNEAL=1`; `OPENERS_MIN=` and `FIXED_FREE=1` (a third duty on a ticket-office time) since "In Step"; `KNOWN=` (with `NEWPEN=`, a cost for every time not in a given list, so a Saturday or a Sunday can be built on the weekday's times) and `EARLIES=` (exactly that many duties starting before 11:00, the split a layout's early and late weeks need) since "Set Fair"; `EARLY_HANDOVER=1` (no early finishing between 15:00 and 16:00, so none leaves as the weekday closers come on) since "Crossover" |
| | `assemble-table.mjs` | three days' tables into one duty table (weekday · Saturday · Sunday) |
| 2 · rota | `anneal.mjs` | arranges a table on the 26 lines; `TABLE=<table.json>`, `MODE=rules` for fatigue first |
| | `carry-order.mjs` | lays a table onto an existing rota's week structure (how Familiar Nine borrowed Right Away's) |
| | `grow-from-24.mjs` | the same idea across line counts: grows a 24-line rota's weeks to 26 (one week added where the table needs it, a fifth cover week) and lays the table on, trying every insertion point and offset |
| | `anneal-from.mjs` | `anneal.mjs`'s search, started from a given rota rather than at random, so a carried structure is improved, not thrown away |
| | `rota-polish.mjs`, `order-polish.mjs` | reorder only (same-day and whole-line swaps), never worse than a reference; `ISO_W=` in `rota-polish.mjs` also rewards fewer single rest days |
| | `exact-floor.py`, `exact-skeletons.py` | the exact solver (`pip install pulp`): the proven floor on single rest days for a rest-day layout, and the same model as a generator of skeletons for `skeleton-start.mjs` (Short Run came from it) |
| | `today-plus.mjs` | today's link kept week for week, with six weeks added round it (26 Oct; see *Same Again*) |
| | `keep-early.mjs` | what putting short earlies back into a design costs: every placement of the swaps, each scored with the sheet's own functions (26 Oct; see *The early finishes*) |
| | `exact/` (`pip install ortools`) | the fewest cells to change in a design so it meets every rule: `fewest.py`, `prove.py` to prove that figure, `tiebreak.py` and `quality.py` to choose among ties or hold a design's own figures, and `check_model.py` with `judge.mjs` to hold the model to the sheets' own code (26 Oct; see *Little and Often*). It predates the 31 Oct ruling on the 55-hour worst case |
| | `candidates.mjs` | prints each candidate rota's sheet figures on one line, to choose between them |
| | `solo.mjs` | the solo edition of a proposal sheet: every comparison with the other proposals taken out (page 9, the best and worst ticks, the "of the others" notes, the family row), so each design is set against today's link alone (29 Sep 2026); throws if an anchor it removes is missing. `render.mjs` imports it; never run |
| check | `check.mjs` | the self-check: settings agree, the test rota recounts independently, and each 26-line rule fails when its condition is broken (`node tooling/check.mjs`) |
| 3 · sheets | `supplied.mjs` via `regenerate.mjs` | the eight-page sheet for a grid; add the design to `SUPPLIED` |
| | `rules-sheet.mjs`, `summary-sheet.mjs`, `shortlist-sheet.mjs` | the rules reference (`../links-26-rules.pdf`), the one-page summary (`../links-26-summary.pdf`) and the two-page shortlist sheet (`../links-26-shortlist.pdf`) |
| | `what-it-means-sheet.mjs` | the one-page "What it means if you…" sheet (`../links-26-what-it-means.pdf`). It lays out and prints `what-it-means-data.mjs`, which reads the colleague decks' slide 5 and its notes back, so it runs after `deck-polish.py` and before `pack.py` (step 4) |
| | `what-it-means-data.mjs` | the sheet's figures and asserted sentences, split out of it unchanged (2 Nov 2026) so the app's New link page reads the same ones; imported, never run |
| | `newlink-data.mjs` | writes the app's `newlink-data.js` — the New link page's figures, sentences and pack list, and its "Where they differ" points — from `what-it-means-data.mjs` and `edge-cost.mjs`; `--check` is what `newlink-data.test.mjs` runs. After `what-it-means-sheet.mjs` (step 4) |
| | `glance-sheet.mjs` | the one-page "The shortlist at a glance" (`../links-26-shortlist-at-a-glance.pdf`, 9 Nov 2026), from `what-it-means-data.mjs`, `edge-cost.mjs` and the grids; every line on it is asserted. After `what-it-means-sheet.mjs` (step 4) |
| | `edge-cost.mjs` | each shortlisted design's edge and cost against the other two: a figure more than 5% (`MARGIN`) better, or worse, than both of the others, each fact asserted. The New link page's "Where they differ" card words every fact; the at-a-glance sheet's cards word only their own, because three facts are the page's alone (`pageOnly`, `sheet: false`: `fewestSundaysLost`, `weakestWeekdayFit` and `fiveAtWeekdayOpen`, since v26.55). Each side asserts it through `wordsExactly(name, side, keys, who)` — `who` is `'page'` by default and `'sheet'` from `glance-sheet.mjs` — so the PDF and the page never contradict each other (12 Nov 2026). Imported, never run |
| 4 · decks and pack | `second-nature-decks.py` → `short-run-decks.py` (applying `second-edition-decks.py`'s edits), `in-step-decks.py`, `even-step-decks.py` → `deck-polish.py` (+ `rota-strip.mjs`) → `common-ground-decks.py` → `deck-marks.py`; `shortlist-decks.py`; `relay-decks.py`; `deck-check.mjs`; `what-it-means-sheet.mjs`; `pack.py` | the presentations, built from a Second Nature template that is not shipped and then polished in place; Common Ground's, rewritten from Even Step's finished pair; the ✓ and ▲ beside every green and amber figure, run last (5 Nov 2026); the shortlist's of 8 Nov 2026, rewritten from Common Ground's finished pair and marked as they are built; Clockface's and Short Working's, rewritten the same way from Even Step's and Short Run's; the checker that reads every deck row back against the sheets and refuses an unmarked colour; the one-page sheet that reads the decks' pay figures back; the zip, which refuses a sheet older than the decks, and reads the league's leader and its lead for the read-me as the shortlist sheet does (8 Nov 2026) |
| league | `league.mjs` | the weighted league on the factors the sheets compare, long earlies and the closing shift among them since 31 Oct 2026 — not the block length, nor the shortlist sheet's early finishes and new Saturday times (`REF_IN_RANGE=1`; `DROP=fam`; `RUN_FIXED=1`; `WEIGHTS=` for other weights, such as the 24-line work's six-factor league; `OLD_READINGS=1` for the weighting before 31 Oct, kept as the alternative, with any of them; `FAM_SUNDAY=1` for the main league with the Sunday duties counted in familiar shift times, as it was read before 3 Nov; `EXTRA=Name=<grid.json>;…` scores a candidate beside the pack's proposals, inside the range and ranked, before anything is rendered, since "Set Fair") — the owner's weights, a judgement not a measurement (see *The league reweighted*) |
| blocks | `blocks.mjs` | the longest block of earlies or lates on the fixed rota, and up to how long if the cover weeks beside it go the same way — the one source for that figure on every sheet, the shortlist, the summary and the decks |
| rest-day layout | `skeleton.mjs`, `skeleton-start.mjs`, `space-polish.mjs`, `leave.mjs` | the layout search, laying a duty table onto a layout, the polish under floors, and the leave model (see "Second Edition") |
| | `skeleton-from.mjs` | reads a finished rota's rest days and early and late weeks back as a skeleton, so another table's times can be laid on the same weeks (26 Oct; see "Today's link on 26 lines") |
| times pool | `half-hour-pool.mjs` | prints the start and finish times on the hour or the half hour, with the fixed opens, closes and office times, for `final-table.mjs`'s `POOL_ONLY=` (4 Nov; see "Common Ground") |
| options | `short-earlies.mjs` | every way to keep a 13:35 or 13:45 every weekday with today's times and a 16:00 closer: 2,250 `final-table.mjs` searches (`SCAN=1`; their results are committed, `results/short-earlies-scan.txt`) and every whole week paying the contract (see "Today's link on 26 lines") |
| today's figures | `fingerprint.mjs` | prints today's 20-line main roster in numbers — hours, the design checks, the hard limits, fatigue, adjacency, the shift times used each day, each line's days and the daily headcount — what its "feel" is, for a design to be read against (`node tooling/fingerprint.mjs`). Not a design's fingerprint: that is `regenerate.mjs`'s hash of the cells |
| fatigue values | `factors-like.mjs` | every fatigue factor's own value, on the fixed duties and in the worst case, against a reference grid; exits 1 if any is worse (`space-polish.mjs`'s `FACTORS_LIKE` holds a search to the same comparison) |
| whole rota, exact | `exact-rota.py` | the whole rota — which line works which duty on which day — as one model for OR-Tools CP-SAT (`pip install ortools`), every rule the sheets apply counted as the app counts it; `OBJ=` what to improve, `HINT=` a valid rota to start from, `FIX=` checks a rota against the model, `SKELETON=` (and `FAMILY=1`) holds a rota's rest days (and its early and late weeks) so only the times are chosen, `MIXED=` allows that many weeks mixing earlies and lates, with `BF=`/`BW=` holding the runs of all-early or all-late weeks, `H55=` holds the 55-hour worst case with every cover week placed every way (until then checked only afterwards), `SKELETON_FREE=` chooses some lines' rest days again on a held layout, and `OBJ=gentle` keeps the hardest weeks apart, with `GENTLE_STARTS=15:45 GENTLE_SHARED=0` the closing weeks alone (see "Closing Time, improved", "In Step", "Middle Ground", "Balanced V7", "Set Fair" and "Level Crossing") |
| rest days with a leave rule | `leave-layouts.py` | the rest days alone for CP-SAT, with what 14 days' leave buys as a rule (`LV_BEST=`, `LV_WORST=`, `LV_FOUR=`), for `exact-rota.py`'s `SKELETON=` to lay a table's times on; `FRIOFF=1` keeps the Friday before every cover week off (no 55-hour week however the cover weeks fall), `HINT=` to climb from a valid layout, `FIX=` to check one (see "Quarter Past Relaid") |

**The tooling was double-checked and proven end to end on 1 Oct 2026**, on a throwaway test rota
(`tooling/results/test-rota.json`, a pipeline check and not a proposal): *The tooling double-checked and proven end to
end*, the first section of HISTORY.md, has what was checked, how each new rule was made to fail, and the figures.

**Commands** (from `tooling/`; the `H=` settings are Familiar Nine's office handling — see the links-24 README's
*Familiar Nine*, `git show 924b9dbc:docs/links-24/README.md`):

```
H="TO_EARLY_HELP=0 TO_LATE_HELP=1440 TO_LATE_SHARE=0"
env $H HI=540 TODAY=1 NEWPEN=2 AT22_STRICT=1 CLS=weekday MAX_TURNS=8 ANNEAL=1 OUT=wk.json node final-table.mjs
env $H HI=540 TODAY=1 NEWPEN=2 AT22_STRICT=1 CLS=sat MAX_TURNS=6 OUT=sat.json node final-table.mjs     # TOTAL=6900 by default
env $H HI=540 TODAY=1 NEWPEN=2 AT22_STRICT=1 CLS=sun MAX_TURNS=6 OUT=sun.json node final-table.mjs
# flatten each day's { duties: [[time, n], …] } to a list of times, then:
CAP=540 PIN_WK="06:20-14:20x2,14:00-22:30x2" PIN_SAT="06:20-14:50x2,14:30-22:00x2" PIN_SUN="07:15-15:30x2,14:00-22:30x2" AT22_FLOOR=1 \
  node assemble-table.mjs table.json wk.flat.json sat.flat.json sun.flat.json
MODE=rules TABLE=table.json node anneal.mjs <label> 100000 5 7        # writes best-R<label>-7.json
node supplied.mjs <grid.json> "<Name>" "<strap>" <XX-26-CODE>       # or list it in regenerate.mjs's SUPPLIED
node rules-sheet.mjs
```

**The split between weekdays and Saturday is a choice.** Five weekdays and a Saturday must make 44,100 minutes. The
default is 7,440 a weekday and 6,900 on a Saturday; sweep it with `TOTAL=` as the 24-line work did. ANNEAL=1 found no
Saturday at 6,900; the exhaustive search (the default) did, in 92 seconds.

## Rebuilding the pack

After a change to any grid, or to `render.mjs` or `report-data.mjs`, in this order — each step reads what the one before
it wrote:
1. **The sheets**, from `tooling/`: `node regenerate.mjs` (every proposal sheet, then the rules sheet; `--check` only
   checks that no fingerprint moved and writes nothing), `node summary-sheet.mjs` and `node shortlist-sheet.mjs` (the
   shortlist sheet and the other designs' sheet).
2. **The presentations in use**: `python3 docs/links-26/tooling/shortlist-decks.py` (the shortlist's three pairs and
   Balanced V10's, from Common Ground's finished pair in `tooling/deck-template/`) and
   `python3 docs/links-26/tooling/relay-decks.py` (Clockface's and Short Working's), then
   `node docs/links-26/tooling/deck-check.mjs`, then the PDFs exported beside them with LibreOffice (the command is in
   `shortlist-decks.py`'s header). The older chain that built the earlier shortlists' decks, from `second-nature-decks.py`
   to `deck-marks.py`, is HISTORY.md → "Second Nature", *Rebuild after any change to the rota*.
3. **The sheets that read the decks back**: `node docs/links-26/tooling/what-it-means-sheet.mjs`, then
   `node docs/links-26/tooling/glance-sheet.mjs` (both with Playwright's Chromium).
4. **The app's copy**: `node docs/links-26/tooling/newlink-data.mjs`, which writes `newlink-data.js`. It counts the pages
   of the files the New link page serves, so it runs after every PDF; until it has, `newlink-data.test.mjs` fails.
   `newlink-data.js` is a served app file, so committing it is a release, with a version bump.
5. **The zip**: `python3 docs/links-26/tooling/pack.py`, from the repository root. It refuses a sheet older than the
   decks it reads, and the zip is never committed.

## The league

**`REF_IN_RANGE=1 node league.mjs`**, from `tooling/`, is the main league: the weighting for the design target since
8 Nov 2026 (the closing weeks, the switches between earlies and lates and the opening shifts counted, the December rules
and the contracted days as gates, fatigue warnings shown apart), with today's link and Familiar Nine inside the ranges and still unranked. It is the reading
`pack.py` takes for the read-me, and the one the 30-day folder's table quotes. **Plain `node league.mjs` is a
different reading**: the proposals alone set the ranges, so its scores and places differ (on 24 Nov 2026 Level Crossing
is first at 78.7 with `REF_IN_RANGE=1`, and third at 73.2 without). `LEAGUE=31oct` gives the league as weighted from
31 Oct to 8 Nov 2026 and `OLD_READINGS=1` the one before 31 Oct; `JSON=<file>` writes the whole table; the other switches
are in the tooling table above and `league.mjs`'s header. The weights are the owner's, a judgement and not a
measurement: HISTORY.md → "The league reweighted for the design target".

## Notes for the whole set

**Full weekends off, per year (owner, 2 Oct 2026).** A longer rotation's larger count is not more weekends in a year, so
"7 in 26" against "4 in 20" made the reader divide. The sheets now say it per person per year, as late finishes and 06:20
starts already were:
- **page 1:** "About 14 full weekends off a year (today 10), 7 in 26 weeks, …";
- **page 2:** a "Full weekends off" row in *Each person's year, on average*, with the share of weeks (27%, today 20%);
  the rotation figure stays, relabelled "Full weekends off, in the rotation";
- **the summary:** under the count.

The weighted league scores weekends as a share of weeks for the same reason. The 24-line sheets gained the same per-year line the same day, their one change since that folder was frozen
(`git show 924b9dbc:docs/links-24/README.md`).

**Everything in one download:** `links-26-proposals.zip`, built on demand by `tooling/pack.py` and **not committed**
(owner, 3 Nov 2026 — each committed copy added ~15 MB to the repository's history, sixteen times by then; the
repository ignores `*.zip`, so run the script and send the file). It is laid out as the 24-line pack
(`git show 924b9dbc:docs/links-24/links-24-proposals.zip`) was:
1. a *Read me first* note;
2. the one-page summary, the two-page shortlist sheet, the one-page "What it means if you…" sheet and, since 9 Nov 2026,
   the one-page "The shortlist at a glance";
3. the rules;
4. the presentations of the shortlisted designs (Balanced V6's, Level Crossing's and Middle Ground's since 8 Nov 2026: HISTORY.md → *The shortlist's presentations*);
5. every proposal sheet;
6. the import files;
7. the technical notes: `RULES.md`. This README was in them until 5 Nov 2026, and stays in the repository (owner: "Leave
   it out of the pack").

`tooling/pack.py` builds it from this folder, every design in `regenerate.mjs`'s `SUPPLIED` list included, and stops
if a file is missing. The 24-line pack was zipped by hand, so it went stale after a re-render; this one is rebuilt by
running `python3 docs/links-26/tooling/pack.py` after any re-render.

**26 in the app since v24.47 (3 Oct 2026).** `ROTATING_LINES = 26` in `links-design.js`: the Links page lays out 26
lines, so the import files in the pack paste straight in and the page re-runs every check on them; the shortlisted
designs are built into that page as examples (three from v24.47, Closing Time from v25.01, In Step and Short Run from v25.02, Even Step, In Step and Short Run from v25.04, Common Ground, Even Step and Short Run from v25.36, and from v25.52 the three on the shortlist now, A to Z), copied cell for cell from `30-days-off/`, Balanced V6's from its subfolder `balanced/` (`links-proposals.js` says so, and
says to re-copy if one changes). The tooling still
passes 26 to every app function explicitly — harmless now, and it keeps the sheets' line count stated in one place
(`tooling/link.mjs`) rather than inherited. Until that release the page was on 24 lines and refused the files; the
read-me said so, and now says the opposite.
