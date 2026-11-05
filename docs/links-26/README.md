# Links — the new CEA link, 26 lines

**The new link starts on 1 January 2027** (owner, 2 Nov 2026): the timetable changes in December, and the link follows.
Until then this folder called it "the December 2026 link", and the dated sections below keep the name they were written
with; *The new link starts on 1 January 2027* at the end says what changed. The "December 2026 rules" keep their name,
because they are the new timetable's.

**From 1 Oct 2026 the new link is 26 lines, not 24.** Everything drawn for 24 lines is kept in `../links-24/` — the
grids unchanged, the sheets re-rendered once (2 Oct 2026, for the per-year weekends line) — both for reference and in case the 24-line link comes back. This folder is for the work from here on.

The 24-line work is not wasted. The rules, the duty tables, the tooling and the designs all carry over. What has to
change is the arithmetic that depends on the number of lines.

**Worst cases dated before 31 Oct 2026 put a cover week's Sunday inside its four duties.** The owner settled that day
that the four are Monday to Saturday and the Sunday is overtime on top, which put a day on most worst cases — "5 (up to
6)" days in a row became "5 (up to 7)". The sections below keep the figures they were written with; the sheets, the
decks and *A cover week's four are Monday to Saturday* have the current ones.

**League scores dated before 31 Oct 2026 are on the weighting the league had then.** The owner reweighted it that day —
long earlies and the closing shift counted, the fit by days, the 55-hour cover week in the worst case — and made the
reweighted one the main league, keeping the one before it as the alternative (`OLD_READINGS=1` rebuilds it). The
sections below keep the scores they were written with; the shortlist sheet and *The league reweighted* have both.

**Main-league scores dated 31 Oct to 3 Nov 2026 count each design's Sunday duties in familiar shift times.** The owner
took them out on 3 Nov, which put Even Step first again (`FAM_SUNDAY=1` rebuilds the scores before). *Familiar shift
times count the Monday-to-Saturday duties only* has both.

**The pack is deliberately vague about how the choice is made** (owner, 4 Nov 2026: "It is deliberately vague"). S. Silva
leads the change, as the RMT rep, and nothing in the pack may give the impression that the developer is in charge of it.
So a rebuild adds nothing about who decides, votes or recommends — the process is recorded in
`../LINKS_DEC2026_PLAN.md`'s dashboard, and stays there. What the decks and sheets already say on it was left as it is on
4 Nov, while feedback is still changing the proposals: the colleague decks' "Tell us what worries you" slide, the
proposal sheets' line about the roster office and a union rep, and the "recommended" marks on the manager decks and
the shortlist, summary and "What it means" sheets. The owner doubts most of it needs saying, so the next rebuild is
the time to ask whether it should go.

## What is in this folder

The two link folders, `links-24` and `links-26`, share one layout (2 Oct 2026, owner: "consistent naming"):

| | What it is |
|---|---|
| `links-NN-proposals.zip` | everything for sharing, in one download |
| `links-NN-rules.pdf` | the rules every proposal is judged against |
| `links-NN-summary.pdf` | every proposal against today's link, on one page — the shortlisted ones marked ★ |
| `links-26-shortlist.pdf` | the three shortlisted designs (Even Step, In Step and Short Run, since 31 Oct 2026) against each other and today, with a recommendation, on two pages (26 lines only; `tooling/shortlist-sheet.mjs`) |
| `links-26-what-it-means.pdf` | "What it means if you…": the three shortlisted designs against today for six kinds of colleague — earlies, lates, swaps, Sundays, no overtime, leave — on one page (26 lines only; `tooling/what-it-means-sheet.mjs`, since 1 Nov 2026) |
| `proposals/` | one design per three files: `<Name>-<CODE>-<fingerprint>.pdf` (the eight-page sheet), `<Name>-<CODE>.json` (the grid) and `<Name>-<CODE>-import.txt` (for the Links page) |
| `presentations/` | `<Name>-for-colleagues` and `<Name>-for-managers`, as `.pptx` and `.pdf` |
| `tooling/` | the scripts that build and check all of the above; `tooling/results/` holds the committed search outputs |
| `RULES.md` | the rules in prose, with their sources and the open questions (26 lines only) |
| `README.md` | this record |

`NN` is the link's length in weeks. A proposal keeps its own name, because the code and fingerprint in it identify the
exact rota on a printout. Inside the zip, the files carry the same names as here.

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
  - **Familiar Nine** (`../links-24/proposals/Familiar-Nine-F9-24-K31s.json`): every rule met, 14 of 20 weeks on one turn.
  - **Right Away** (`../links-24/proposals/Right-Away-FR-24-F34s.json`).
  - **Silva Lining** (`../links-24/proposals/Silva-Lining-SL-24-Hs.json`, version H of its series): 14 times, no fatigue warnings, a
    9-hour cap.
- **The judging.** Every figure comes from the app's own Links modules, which take the line count as a parameter.

## The tooling (`tooling/`, set up 1 Oct 2026)

The 24-line pipeline, copied and set to 26 lines. **`tooling/link.mjs` states the link once**: 26 lines, 5 cover weeks
(default lines 1, 6, 11, 16, 21), 21 working lines, the 44,100-minute contract, the 219-day ceiling, and the headcounts the
tables are built to (15 a weekday, 14 on a Saturday, 10 on a Sunday). The sheets, the decks and the checks read those
from there; the search and solver scripts (`skeleton.mjs`, `skeleton-start.mjs`, `exact-*.py`, `short-earlies.mjs`)
carry their own copy of the link's shape, so a change of length is that edit and theirs (`link.mjs` says so). The
24-line tooling is in `../links-24/tooling/`, changed only for the per-year weekends line of 2 Oct 2026, so that pack can
still be rebuilt.

**What it checks, beyond the 24-line set** (`RULES.md`):
- **Cover weeks:** five, with gaps differing by one line at most (`coverSpread`). It is a flexible rule, as before.
- **The days ceiling is a HARD limit.** `assess()` (`report-data.mjs`) adds it to the hard-limit checks, so a design
  over 219 contracted days a year "cannot be run as it stands" on page 1. On page 6 it shares the contract card:
  "35h a week · 218.6 contracted days a year, 219 at most".
- **No waivers and no named offices** are carried over from 24 lines (`fresh.mjs`, `report-data.mjs`).

**The scripts kept** are the ones the Familiar Nine / Right Away method uses. The one-off searches for particular
24-line designs stay in `links-24` only.

| Stage | Script | What it does |
|---|---|---|
| 1 · duty table | `final-table.mjs` | the best table for one day, by fit to the trains, under every rule; a proof unless `ANNEAL=1`; `OPENERS_MIN=` and `FIXED_FREE=1` (a third duty on a ticket-office time) since "In Step" |
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
| check | `check.mjs` | the self-check: settings agree, the test rota recounts independently, and each 26-line rule fails when its condition is broken (`node tooling/check.mjs`) |
| 3 · sheets | `supplied.mjs` via `regenerate.mjs` | the eight-page sheet for a grid; add the design to `SUPPLIED` |
| | `rules-sheet.mjs`, `summary-sheet.mjs`, `shortlist-sheet.mjs` | the rules reference (`../links-26-rules.pdf`), the one-page summary (`../links-26-summary.pdf`) and the two-page shortlist sheet (`../links-26-shortlist.pdf`) |
| | `what-it-means-sheet.mjs` | the one-page "What it means if you…" sheet (`../links-26-what-it-means.pdf`). It lays out and prints `what-it-means-data.mjs`, which reads the colleague decks' slide 5 and its notes back, so it runs after `deck-polish.py` and before `pack.py` (step 4) |
| | `what-it-means-data.mjs` | the sheet's figures and asserted sentences, split out of it unchanged (2 Nov 2026) so the app's New link page reads the same ones; imported, never run |
| | `newlink-data.mjs` | writes the app's `newlink-data.js` — the New link page's figures, sentences and pack list — from `what-it-means-data.mjs`; `--check` is what `newlink-data.test.mjs` runs. After `what-it-means-sheet.mjs` (step 4) |
| 4 · decks and pack | `second-nature-decks.py` → `short-run-decks.py` (applying `second-edition-decks.py`'s edits), `in-step-decks.py`, `even-step-decks.py` → `deck-polish.py` (+ `rota-strip.mjs`); `deck-check.mjs`; `what-it-means-sheet.mjs`; `pack.py` | the presentations, built from a Second Nature template that is not shipped and then polished in place; the checker that reads every deck row back against the sheets; the one-page sheet that reads the decks' pay figures back; the zip, which refuses a sheet older than the decks |
| league | `league.mjs` | the weighted league on the factors the sheets compare, long earlies and the closing shift among them since 31 Oct 2026 — not the block length, nor the shortlist sheet's early finishes and new Saturday times (`REF_IN_RANGE=1`; `DROP=fam`; `RUN_FIXED=1`; `WEIGHTS=` for other weights, such as the 24-line work's six-factor league; `OLD_READINGS=1` for the weighting before 31 Oct, kept as the alternative, with any of them) — the owner's weights, a judgement not a measurement (see *The league reweighted*) |
| blocks | `blocks.mjs` | the longest block of earlies or lates on the fixed rota, and up to how long if the cover weeks beside it go the same way — the one source for that figure on every sheet, the shortlist, the summary and the decks |
| rest-day layout | `skeleton.mjs`, `skeleton-start.mjs`, `space-polish.mjs`, `leave.mjs` | the layout search, laying a duty table onto a layout, the polish under floors, and the leave model (see "Second Edition") |
| options | `short-earlies.mjs` | every way to keep a 13:35 or 13:45 every weekday with today's times and a 16:00 closer: 2,250 `final-table.mjs` searches (`SCAN=1`; their results are committed, `results/short-earlies-scan.txt`) and every whole week paying the contract (see "Today's link on 26 lines") |
| fatigue values | `factors-like.mjs` | every fatigue factor's own value, on the fixed duties and in the worst case, against a reference grid; exits 1 if any is worse (`space-polish.mjs`'s `FACTORS_LIKE` holds a search to the same comparison) |
| whole rota, exact | `exact-rota.py` | the whole rota — which line works which duty on which day — as one model for OR-Tools CP-SAT (`pip install ortools`), every rule the sheets apply counted as the app counts it; `OBJ=` what to improve, `HINT=` a valid rota to start from, `FIX=` checks a rota against the model, `SKELETON=` (and `FAMILY=1`) holds a rota's rest days (and its early and late weeks) so only the times are chosen (see "Closing Time, improved" and "In Step") |

**Double-checked on 1 Oct 2026** (owner: "double check that the 26 line link tooling is optimal"):
- **No 24-line default leaks through.** The app functions that default to 24 lines (`runDesignChecks`, `assessFatigue`,
  `assessHardLimits`, `weeklyHours`, `toSequence`…) are given the line count by every caller in this folder, and pass it on
  to each other internally.
- **The figures recount.** `check.mjs` counts the test rota again from its cells alone, and every figure agrees: minutes,
  days a year, cover lines and the number on duty each day.
- **Each new rule bites.** Each is broken on purpose (`scripts/mutate.mjs` on its decisive line), and `check.mjs` then
  fails:
  - one duty too many, and also one duty too many at exactly the contract's minutes, is over the ceiling;
  - a cover week moved one line breaks the even spread;
  - a duty 15 minutes shorter breaks the contract.
- **The sheets show the breach where it happens.** A design over the ceiling is "cannot be run" on page 1, and on page 6
  the contract card is ✕ even when the hours are exact.
- **The summary counts it.** Its "cannot be run" flag counts the contract and the ceiling as well as rest and days in a
  row, and days a year are printed to one decimal: 218.6, not a rounded 219 that reads the same as today's figure.

**Proven working end to end on 1 Oct 2026** with a throwaway table (not a proposal), using Familiar Nine's settings:
- **Duty table:** a weekday of 15 duties and 7,440 minutes, found by the quick search (`ANNEAL=1`, not a proof; an exhaustive run was started and then stopped, because it scored the
  ticket office the old way and this table is only a test); a Saturday of 14 at 6,900, proven, every time
  already worked today; a Sunday of 10. Together that is 44,100 Monday-to-Saturday minutes over 89 duties, exactly the
  contract at the 219-day ceiling (218.6).
- **Rota and sheet:** a 2.5-minute rota search on that table (`MODE=rules`, 40,000 steps × 2 restarts, seed 7) placed
  it on 26 lines, and its eight-page sheet rendered with every figure and word at 26 lines. Page 3's word list is set
  tighter, by measurement, when the extra rows push it towards the footer.

**What the test rota shows** (`tooling/results/test-rota.json`, from `tooling/results/test-table.json`). It is
a pipeline check, not a proposal: nobody has looked at it as a rota. But it meets **all 9 December rules and all 3
flexible rules**, with these figures:
- no fatigue warnings, at most 6 days in a row, shortest rest 14h 05m;
- 6 full weekends off, 13 of 21 weeks on one turn;
- 218.6 contracted days a year;
- cover weeks at 1, 6, 11, 16 and 21.

Its weak spot is 7 single rest days. So the 26-line rules can be met, and comfortably.

**Commands** (from `tooling/`; the `H=` settings are Familiar Nine's office handling — see `../links-24/README.md`):

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

## Second Nature — the first 26-line design (1 Oct 2026; withdrawn 3 Nov 2026)

**Withdrawn from the pack on 3 Nov 2026** (*Four designs withdrawn*, below): its sheet, grid and import file left `proposals/`, the summary and the pack. Its grid (`second-nature.json`) and searches stay in `tooling/`, and this section stays as the record.

Formerly **`proposals/Second-Nature-SN-26-F2-a52d0f20.pdf`** (grid `proposals/Second-Nature-SN-26-F2.json`). The owner asked for a roster built
"the same way as Familiar Nine" and for every possibility to be tried; the name is Claude's, chosen for a link built
around the shift times people already work. It meets **all 9 December rules and all 3 flexible rules**, every hard
limit, and has **no avoidable fatigue warnings**, even with a cover week placed as badly as it can be. Against today's link:

- **7 full weekends off in 26** (today 4 in 20), and never more than 6 days in a row (today 7);
- **shortest rest 14h 20m** (today 12h 30m), and no duty over 9 hours;
- **15 of 21 working weeks on one shift time**, Monday to Friday, and 4 single rest days (today 4);
- **15 shift times** (today 18), 9 of them already worked today, 6 new;
- **218.6 contracted days a year**, under the 219 ceiling, and the 35-hour week exactly;
- **42 late finishes a year each** (today 39). That is the fewest the rules allow on 26 lines: three people must close
  every day (S2), each finishing after 23:00, so 21 a week across 26 lines is 42 a year.

**How it was built.** In two stages, as Familiar Nine was.

1. **The duty table.** `final-table.mjs` searched each day with Familiar Nine's settings (`HI=540 TODAY=1 NEWPEN=2
   AT22_STRICT=1`):
   - four weekday/Saturday splits of the 44,100 minutes (7,465/6,775 · 7,440/6,900 · 7,415/7,025 · 7,390/7,150);
   - both ticket-office settings (Familiar Nine's office-off-the-floor, and the plan the sheets use);
   - three Sunday options (`SUN_PLAN=1`, at `NEWPEN` 2, 6 and 20).

   Every combination met every per-day rule, so they were scored on the sheet's own measures and the standing league,
   using the rota-free part only (the match to the trains and the familiar times).

   Two findings decided the table:
   - **The Sunday.** Paying 15 minutes for today's own Sunday opener, 07:15–15:45, instead of a new 07:15–15:30 scores
     better on the league: one more familiar time outweighs a slightly worse Sunday fit (26.4 to 29.0).
   - **Late finishes.** The best weekday tables all had four people finishing after 23:00. Allowing only the three closers
     to finish after 22:30 (`CLOSERS_MAX=3 MID_END_MAX=1350`) cut late finishes from 52 a year to 42, for a fit 0.3
     worse.

   The tables are in `tooling/results/second-nature-{weekday,sat,sun,table}.json`.
2. **The rota.** There is no 26-line rota to borrow a week structure from, as Familiar Nine borrowed Right Away's. So
   `grow-from-24.mjs` grew the 24-line ones instead: one Monday-to-Friday week is added (each weekday is one duty short
   at 24 lines) and a fifth cover week, at every insertion point and every rotation offset. 16 searches were run,
   from those grown starts (Familiar Nine, Right Away, Silva Lining) and from random ones. The best were searched again
   at a lower temperature and polished, with no figure allowed to get worse. Silva Lining's weeks gave the best result.

**Rebuild it** (from `tooling/`; every step is deterministic, and this reproduces the shipped grid exactly):

```
TOP=1 MODE=rules node grow-from-24.mjs results/second-nature-table.json /tmp/sn ../../links-24/proposals/Silva-Lining-SL-24-Hs.json
MODE=rules node anneal-from.mjs /tmp/sn-Si0.json /tmp/sn-a.json 5 60000 1500
MODE=rules node anneal-from.mjs /tmp/sn-a.json /tmp/sn-b.json 1 60000 500
REST_CAP=1 ISO_W=500 node rota-polish.mjs /tmp/sn-b.json second-nature.json 2 120000 /tmp/sn-b.json
node regenerate.mjs                     # the sheet; --check confirms the fingerprint a52d0f20
```

**The other finalists**, for the record. All meet every rule, with no fatigue warnings and 7 full weekends off:

| | One-turn weeks | Single rest days | Shortest rest | Late finishes a year |
|---|---|---|---|---|
| **Second Nature** | **15** | 4 | **14h 20m** | **42** |
| Same table, other polish | 11 | **3** | 14h 05m | 42 |
| Same table, Second Nature's first week order | 17 | 4 | 13h 00m | 42 |
| The first table (four weekday closers) | 14 | **3** | 14h 05m | 52 |

It was chosen for the balance. Four more weeks on one turn are worth one more single rest day, and the shortest rest
is the best of the four.

**The presentations** (2 Oct 2026, owner: "use the Familiar Nine and Right Away presentations as a basis"; **cut to the
shortlist 3 Oct 2026**, owner: "only keep the shortlist's presentations, delete the rest"): `presentations/` holds a
colleague deck (15 slides) and a manager deck (10), as PowerPoint and PDF, for the three shortlisted designs, **Even
Step, In Step and Short Run**. The shortlist has moved under them: Second Edition, Even Keel and Short Run on 3 Oct;
Closing Time added on 30 Oct, with its decks; In Step's decks built the same evening while it was off the shortlist; the
cut to In Step and Short Run later that day, when the decks of Second Edition, Even Keel and Closing Time were removed
under the 3 Oct rule (they are in git history) and two of their builders with them (below, "The shortlist cut to two");
and Even Step added on 31 Oct, recommended (below, "Even Step"). They are the
Familiar Nine decks, the template Right Away's were made from too, with every word and figure that was Familiar Nine's
replaced and the design untouched. Unlike the 24-line decks, they are BUILT here: `tooling/second-nature-decks.py` makes
Second Nature's decks from the Familiar Nine files into `tooling/deck-template/` (gitignored — Second Nature's decks are
the template every shipped deck is built from, and since 3 Oct are not shipped themselves);
`tooling/second-edition-decks.py` holds Second Edition's edits to that template (the weekend spacing, no week mixing
earlies and lates, the rest-day breaks, the one-turn weeks, the weekly hours — its leave figures are Second Nature's
exactly), and since 30 Oct builds no decks of its own; `tooling/short-run-decks.py` makes Short Run's by applying those
edits and then its own — the run (5 on the fixed rota, up to 6 when a cover week falls badly, said both ways), the
weekly hours and the pitch lines; `tooling/in-step-decks.py` makes In Step's by applying Second Edition's and Short
Run's edits and then its own, refusing if any Short Run fact that is not In Step's survives; and
`tooling/even-step-decks.py` makes Even Step's by applying In Step's whole chain and then its own, refusing if any In
Step fact that is not Even Step's survives, or any sentence of In Step's builder that names In Step. **Then
`tooling/deck-polish.py` runs over every shipped deck** (3 Oct 2026, the reader's critique): the four-weeks-off leave
cost said early and on the trade-offs slide, full weekends off per year first, days a year as 218.6 against 219.0, the
one-turn row and the fit slide saying what they count, slide 10 turned into a picture of the 26 weeks
(`tooling/rota-strip.mjs`, from the grid), and the manager "Why" slide split into what every link here gives, what this
one adds and what it costs. A second pass the same day (owner: "are they missing anything?") made the late-finish slide
say the rise after 22:00 as well as after 23:00, the shift-length slide name the early turns that get longer, the "Will
I work more?" slide give the weekly range, and the manager deck carry the Sunday overtime hours and the two open points.
Every builder and the polish refuse if a slide no longer holds the text they expect, and every deck compares only with
today's link.
- **Figures:** `node tooling/deck-check.mjs --print` gives every figure from the sheets' own counts. `tooling/leave.mjs`
  gives the four leave figures (all three shortlisted designs: 14 days' leave buys 28 days off at best, 23.4 on average,
  20 at worst, and four full weeks off takes 15; today 30 · 23.4 · 19 · 14). It is the 24-line decks' leave method as
  code, and `--check` shows it reproduces their published figures for today and Familiar Nine exactly.
- **Checked:** `node tooling/deck-check.mjs` reads the finished decks back. Every table row across the six decks
  agrees with the sheets and the leave model, and none is left unchecked (it prints the count).

Rebuild after any change to the rota:

```
python3 docs/links-26/tooling/second-nature-decks.py && python3 docs/links-26/tooling/short-run-decks.py \
  && python3 docs/links-26/tooling/in-step-decks.py && python3 docs/links-26/tooling/even-step-decks.py \
  && python3 docs/links-26/tooling/deck-polish.py && node docs/links-26/tooling/deck-check.mjs
```

Then export the PDFs (LibreOffice), then `node docs/links-26/tooling/what-it-means-sheet.mjs` (it reads the decks, so it
comes after them), `node docs/links-26/tooling/newlink-data.mjs` (the app page's copy of the same figures — the build
fails until it is run) and `python3 docs/links-26/tooling/pack.py` (which refuses that sheet if it is older than the decks).

`deck-polish.py` polishes every design's decks, and refuses a deck it has already polished; `deck-polish.py "In Step"`
polishes one design's freshly built pair. Then export the PDFs (LibreOffice). Three things the decks say that the
sheet does not show directly:
- **Late finishes:** 42 a year is the minimum, because only the three closers the rules require finish after 23:00.
- **Weekends off:** every shipped deck's design has them never more than five weeks apart, and says so; today's are up
  to seven apart.
- **Finishes at 22:00 or later, per person:** 94 a year in all three shortlisted designs, 78 today. The sheet shows who is
  still on at 22:00 instead (7 · 5 · 5 on all three, today 4 · 2 · 3), so a deck slide that says its figures are all on the
  sheet quotes that one.

## Second Wind — Second Nature with the weekends spread (2 Oct 2026; withdrawn 3 Nov 2026)

**Withdrawn from the pack on 3 Nov 2026** (*Four designs withdrawn*, below): its sheet, grid and import file left `proposals/`, the summary and the pack. Its grid (`second-wind.json`) stays in `tooling/`, and this section stays as the record.

An external review rated Second Nature "remarkably strong ... about 9.2/10 as a first draft", and asked for one more pass
before calling it finished. Its priorities, in order:
1. keep every rule, no fatigue warning, 6 days in a row at most, the 14h 20m rest, the 42 late finishes, the shift times;
2. spread the full weekends, which can be ten weeks apart;
3. fewer single rest days (4; Familiar Nine has 2);
4. a lighter heaviest week (43h 40m);
5. the cover weeks kept at 1, 6, 11, 16 and 21.

Every figure it quoted checks out against the rotas.

**What was found.** Only the ORDER was searched. Every move swaps duties between weeks or swaps whole weeks, so each
day's duties, and with them priorities 1 and 5, cannot change.

- **The weekends.** 14 Saturday duties on 21 working weeks leave exactly 7 Saturdays off, so seven is also the most. A
  full weekend cannot start in a cover week or the week before one, which leaves 16 of the 26 weeks that can. The
  closest seven of those can be is **five weeks apart**, the best possible.
- **The revision reaches it, and ships as Second Wind** (owner, 2 Oct 2026: "give it a different name and add it alongside
Second Nature ... the same family"). Formerly `proposals/Second-Wind-SW-26-F1-4bec8d8e.pdf`, grid `tooling/second-wind.json`.
  Against Second Nature:

| | Second Nature | **Second Wind** | Familiar Nine (24) | Today |
|---|---|---|---|---|
| Longest gap between full weekends | 10 weeks | **5** (the best possible) | 7 | 7 |
| Single rest days | 4 (1 beside a cover week) | 4 (none beside one) | 2 | 4 |
| Heaviest Mon–Sat week | 43h 40m | **42h 30m** | 41h 45m | 43h 50m |
| Worst rolling 7 days | 52.2h | 51.5h | 51.3h | 60.8h |
| Weeks on one turn | 15 of 21 | **16 of 21** | 14 of 20 | 7 of 16 |
| Weeks mixing earlies and lates | **2 of 21** | 4 of 21 | 3 of 20 | 7 of 16 |
| Start-time change, week to week | **1h 28m** | 2h 01m | 1h 44m | 4h 00m |
| Leave: best · average · worst (14 days) | 28 · 23.4 · 20 | 27 · 23.4 · 20 | 28 · 23.6 · 20 | 30 · 23.4 · 19 |

  Unchanged: 9/9 rules, no fatigue warnings, 6 days in a row, 14h 20m, 42 late finishes, 15 shift times, 218.6 days.

- **Single rest days stayed at 4.** No rota with the weekends spread got below it. The only rotas found with 3 had a
  shorter rest or a fatigue factor; one with 2 mixed weeks and the weekends spread had 6 single rest days.
- **The cost is stability.** Mixed weeks went from 2 to 4, and the week-to-week move from 1h 28m to 2h 01m. Both are
  still far better than today and close to Familiar Nine. So both are put forward, and Second Nature is unchanged.
- **Same family.** Both are in the Second Nature family (`FAMILY` in `tooling/fresh.mjs`); Second Nature's was listed
  as Silva Lining until then, the design its weeks were grown from. The family is header metadata the plain sheets do
  not print, so no sheet changed.
- **The summary shows the difference.** Its "Full weekends off" column now gives the longest wait as well, "at most N
  weeks apart". Without it, the two designs read identically on the summary.

**How it was found** (from `tooling/`):
- `anneal.mjs` gained terms that are off by default, so every earlier run reproduces: `GAP_W` (the weekend gap),
  `ISO_X` (single rest days), `DAYS_X` (3- and 6-day weeks) and `HEAVY_W`/`HEAVY_CAP` (hours over a cap).
- `space-polish.mjs` reorders a rota towards the review's priorities. Each floor is a cost while searching and a floor
  on what is kept, so nothing it writes is worse than its floors on any of them. When it keeps nothing, it names the
  floors its closest rota missed and saves that rota beside its output.
- `candidates.mjs` now prints the weekend gap.

The search:
- **Random-start search:** 8 runs. Best was seed 29 (`GAP_W=4000 ISO_X=4000 DAYS_X=30000 HEAVY_W=20000 HEAVY_CAP=43.67`).
- **Polishing:** gave `results/second-wind-start.json`. That was made by an earlier version of `space-polish.mjs`,
  so it is committed rather than rebuilt.
- **The two last steps** rebuild Second Wind exactly:

```
REST_MIN=860 WKENDS_MIN=7 ONE_MIN=15 HEAVY_MAX=43.67 STEP_MAX=130 ISO_MAX=4 GAP_MAX=6 MIXED_MAX=2 LEAVE_WORST_MIN=20 \
  node space-polish.mjs results/second-wind-start.json /tmp/r7.json 7 400000          # keeps nothing; writes /tmp/r7.closest.json
REST_MIN=860 WKENDS_MIN=7 ONE_MIN=16 HEAVY_MAX=42.5 STEP_MAX=128 ISO_MAX=4 GAP_MAX=5 MIXED_MAX=4 LEAVE_WORST_MIN=20 \
  node space-polish.mjs /tmp/r7.closest.json second-wind.json 1 300000
```

## Second Sight — a fresh search with the weekends spread from the start (2 Oct 2026; withdrawn 3 Nov 2026)

**Withdrawn from the pack on 3 Nov 2026** (*Four designs withdrawn*, below): its sheet, grid and import file left `proposals/`, the summary and the pack. Its grid (`second-sight.json`) stays in `tooling/`, and this section stays as the record.

The owner asked to start the search again "from a different angle", the way Familiar Nine was started: every rule, plus
one flexible aim, that full weekends off are four weeks apart or as spread out as possible. With 14 on a Saturday there
are seven full weekends, and the closest seven can be is five weeks apart (above), so that is the target. Eight
weekends, never more than four apart, would need 13 on a Saturday; the owner kept 14.

- **Same duty table.** Table F, Second Nature's, so the rules, shift times, late finishes and staffing are the same as
  Second Nature's and Second Wind's. Only the order of the weeks is new.
- **The search.** 16 random-start runs of `anneal.mjs` with the gap capped at five from the outset (`GAP_CAP=5`), and
  single rest days, mixed weeks, the week-to-week move, six-day weeks and the heaviest week costed. Every run reached the
  gap of five.
- **The polish.** Each start was polished with floors taken from Second Nature and Second Wind's figures, plus a chosen cap
  of three mixed weeks (Second Nature has two, Second Wind four): shortest rest
  14h 20m, seven weekends at most five weeks apart, at least 15 one-turn weeks, at most 4 single rest days, at most 3
  mixed weeks, the heaviest week at most 43h 40m, 20 days off from 14 days' leave at worst, and no fatigue warning. The
  best of them, seed 111, met every floor but one: it has 5 single rest days, not 4.
- **Put forward as its own design** (owner, 2 Oct 2026: "turn start 111 into its own proposal sheet with its own name,
  but continue the search"). Formerly `proposals/Second-Sight-SS-26-F1-3c6aac4d.pdf`, grid `tooling/second-sight.json`, in the
  Second Nature family. Its presentations followed the same day (owner, on the recommendation that it was then the
  strongest of the six) and were deleted on 3 Oct 2026 with Second Nature's and Second Wind's, when the owner kept only
  the shortlist's (Second Edition, Even Keel, Short Run).

| | Second Nature | Second Wind | **Second Sight** | Today |
|---|---|---|---|---|
| Longest gap between full weekends | 10 weeks | 5 | **5** | 7 |
| Weeks mixing earlies and lates | 2 | 4 | **0** | 7 of 16 |
| Single rest days | 4 | 4 | **5** | 4 |
| Heaviest Monday–Saturday week | 43h 40m | 42h 30m | **42h 00m** | 43h 50m |
| Start-time change, week to week | 1h 28m | 2h 01m | **1h 55m** | 4h 00m |
| Weeks on one shift time | 15 of 21 | 16 of 21 | **16 of 21** | 7 of 16 |
| Shortest rest | 14h 20m | 14h 20m | **14h 20m** | 12h 30m |
| Leave: best · average · worst (14 days) | 28 · 23.4 · 20 | 27 · 23.4 · 20 | **28 · 23.4 · 20** | 30 · 23.4 · 19 |
| Avoidable fatigue warnings, fixed duties | 0 | 0 | **0** | 4 |

**How to rebuild it** (from `tooling/`). The anneal run is committed as `results/second-sight-start.json`, as Second
Wind's start is. It came from:

```
MODE=rules GAP_CAP=5 GAP_CAP_W=60000 GAP_W=1500 ISO_X=6000 MIX_X=5000 STEP_X=30 DAYS_X=30000 HEAVY_W=20000 HEAVY_CAP=43.67 \
  TABLE=results/second-nature-table.json node anneal.mjs A6000 100000 3 111
```

The polish keeps nothing, because single rest days stay at 5, and writes the closest rota beside its output. That
closest rota is Second Sight:

```
FATIGUE_SOFT=1 REST_MIN=860 WKENDS_MIN=7 GAP_MAX=5 ONE_MIN=15 ISO_MAX=4 MIXED_MAX=3 HEAVY_MAX=43.67 STEP_MAX=121 \
  LEAVE_WORST_MIN=20 node space-polish.mjs results/second-sight-start.json /tmp/ss.json 1 300000   # → /tmp/ss.closest.json
```

## Second Look and Second Gear — the same restart, on two variations of the duty table (2 Oct 2026; Second Gear withdrawn 3 Nov 2026)

**Withdrawn from the pack on 3 Nov 2026** (*Four designs withdrawn*, below): Second Gear's sheet, grid and import file left `proposals/`, the summary and the pack; Second Look stays. Its grid (`second-gear.json`) stays in `tooling/`, and this section stays as the record.

The restart did not stop at Second Nature's table. Five variations of it were built (`assemble-table.mjs`, the same
pins and nine-hour cap) and searched the same way: G1, G2 and G3 keep the 42 late finishes a year, H1 and H2 cost 44.
Every search reached the weekend gap of five. Two rotas, and only two, then met **every** floor, four single rest days
included, and both were put forward (owner, 2 Oct 2026: "create sheets for both please with new names too"):

- **Second Look** (`SL-26-G3` · `7095fdda`), table G3: Second Nature's with the Saturday 08:00-16:30 pair moved to
  07:15-15:45. It keeps the 42 late finishes and has 14 shift times, one fewer.
- **Second Gear** (`SG-26-H1` · `8d61e5c3`), table H1: different weekday and Saturday times. It has the lightest weeks
  and the longest minimum rest between shifts, and never more than five days in a row on the fixed duties, for two more late finishes a year
  and one more new shift time.

| | Second Wind | Second Sight | **Second Look** | **Second Gear** | Today |
|---|---|---|---|---|---|
| Longest gap between full weekends | 5 | 5 | **5** | **5** | 7 |
| Single rest days | 4 | 5 | **4** | **4** | 4 |
| Weeks mixing earlies and lates | 4 | 0 | **1** | **2** | 7 of 16 |
| Heaviest Monday–Saturday week | 42h 30m | 42h 00m | **43h 40m** | **41h 30m** | 43h 50m |
| Start-time change, week to week | 2h 01m | 1h 55m | **1h 30m** | **1h 25m** | 4h 00m |
| Weeks on one shift time | 16 of 21 | 16 of 21 | **15 of 21** | **16 of 21** | 7 of 16 |
| Shortest rest | 14h 20m | 14h 20m | **14h 20m** | **14h 35m** | 12h 30m |
| Leave: best · average · worst (14 days) | 27 · 23.4 · 20 | 28 · 23.4 · 20 | **27 · 23.4 · 20** | **28 · 23.4 · 20** | 30 · 23.4 · 19 |
| Late finishes a year | 42 | 42 | **42** | **44** | 39 |
| Shift times (new) | 15 (6) | 15 (6) | **14 (6)** | **15 (7)** | 18 |
| Saturday fit to the trains (lower is better) | 12.7 | 12.7 | **15.2** | **14.5** | 65.9 |

The rest of the restart, for the record: G1's best kept a shorter rest (14h 05m), five single rest days and a worse
leave figure; G2's kept six single rest days; H2's kept a fatigue factor; and the rotas that reached four single rest days on Second Nature's own table all kept
a fatigue factor (FF19, start times moving more than two hours inside a run of days).

**How to rebuild them** (from `tooling/`). The tables and the anneal runs are committed (`results/second-look-table.json`,
`results/second-gear-table.json`, `results/second-look-start.json`, `results/second-gear-start.json`). The runs came from:

```
MODE=rules GAP_CAP=5 GAP_CAP_W=60000 GAP_W=1500 ISO_X=6000 MIX_X=5000 STEP_X=30 DAYS_X=30000 HEAVY_W=20000 HEAVY_CAP=43.67 \
  TABLE=results/second-look-table.json node anneal.mjs G3 100000 3 113
MODE=rules GAP_CAP=5 GAP_CAP_W=60000 GAP_W=1500 ISO_X=6000 MIX_X=5000 STEP_X=30 DAYS_X=30000 HEAVY_W=20000 HEAVY_CAP=43.67 \
  TABLE=results/second-gear-table.json node anneal.mjs H1 100000 3 105
```

and the polish, with Second Sight's floors, keeps each grid exactly. Second Look's was run in the second polish round,
which pushed harder on single rest days (`ISO_W=1e5`, 400,000 steps):

```
F="FATIGUE_SOFT=1 REST_MIN=860 WKENDS_MIN=7 GAP_MAX=5 ONE_MIN=15 ISO_MAX=4 MIXED_MAX=3 HEAVY_MAX=43.67 STEP_MAX=121 LEAVE_WORST_MIN=20"
env $F ISO_W=1e5 node space-polish.mjs results/second-look-start.json second-look.json 1 400000
env $F node space-polish.mjs results/second-gear-start.json second-gear.json 1 300000
```

## Quiet Friday — what if the ceiling were 217 days? (2 Oct 2026; withdrawn 3 Oct 2026)

The owner asked: "What if we said 217 was the maximum working days per year. Keep the rest of the rules. What is
possible? Try every possibility." With five cover weeks, 217 allows **88 Monday-to-Saturday duties**, one fewer than the
219-day designs' 89 (RULES.md's own table: 88 duties is 216.6 days). Taking that one duty out can be done four ways,
and the 9-hour cap on duties (a design choice, not a rule: the rules limit only Sunday duties) decides most of them.
The fixed ticket-office and closing duties leave little room to lengthen the rest.

| | Weekday · Saturday | Days | Rules | What the search found |
|---|---|---|---|---|
| A | 15 · 13 | 216.6 | breaks flexible F1 (14 on a Saturday) | 13 on a Saturday leaves 8 Saturdays off, so 8 full weekends; tables fit (Saturday 26.8–27.6), but every rota kept a fatigue factor (early runs, or start times moving over two hours) |
| B | 14 · 14 | 214.6 | all kept | only with weekday duties to 9h 30m, and then every weekday fits at 48.1 (Second Nature's weekday as that search measured it: 29.3; its shipped sheet, on the current measure, says 29.1) |
| B2 | 14 · 16 | 216.6 | all kept | 9-hour cap kept, but 16 Saturday duties leave 5 full weekends |
| **C** | **15 Mon–Thu, 14 Fri** · 14 | **216.6** | **all kept** | **Quiet Friday** |

**C, with Friday the short day** (owner: "Friday is the quietest day"; today's link already rosters 11–12 by day). The
Friday table was searched from the times the week already works plus at most two new ones, because the rule of no more
shift times than today (18) counts the whole week: `final-table.mjs` gained `POOL_ONLY=`, and `anneal.mjs` a per-day
column so one weekday can take its own counts. Friday's best adds one new time, 13:30–22:30 (fit 40.0, 17 times in the
week). Of 15 rota searches on options A and C, one rota met every floor of the restart.

**Withdrawn on 3 Oct 2026** (owner: "we can remove Quiet Friday from the proposals"): its sheet, grid and import file
have left `proposals/`, the summary and the pack. The grid, its tables and its start stay in `tooling/` and `results/`, and
the section below is kept as the record of what 217 days costs.

**Quiet Friday** (`QF-26-C1` · `daf8f3c9`), its own family, formerly `proposals/Quiet-Friday-QF-26-C1-daf8f3c9.pdf`, grid
`tooling/quiet-friday.json`. At 216.6 days it is inside today's 219 ceiling too, so it sits with the others and is
judged by the same rules; its strap says it was built to 217.

| | Second Wind | **Quiet Friday** | Today |
|---|---|---|---|
| Contracted days a year | 218.6 | **216.6** | 219.0 |
| On duty: Mon–Thu · Fri · Sat · Sun | 15 · 15 · 14 · 10 | **15 · 14 · 14 · 10** | 11–12 · 12 · 10 · 8 |
| Longest gap between full weekends (7 in 26) | 5 | **5** | 7 (4 in 20) |
| Single rest days | 4 | **4** | 4 |
| Weeks mixing earlies and lates | 4 | **3** | 7 of 16 |
| Heaviest Monday–Saturday week | 42h 30m | **41h 30m** | 43h 50m |
| Start-time change, week to week | 2h 01m | **1h 36m** | 4h 00m |
| Shortest rest | 14h 20m | **14h 20m** | 12h 30m |
| Late finishes a year | 42 | **46** | 39 |
| Shift times (new) | 15 (6) | **17 (10)** | 18 |
| Leave: best · average · worst (14 days) · four weeks off | 27 · 23.4 · 20 · 15 | **27 · 23.6 · 20 · 16** | 30 · 23.4 · 19 · 14 |
| Fit to the trains: weekday · Saturday · Sunday | 29.1 · 12.7 · 29.0 | **30.1 · 15.5 · 29.0** | 52.0 · 65.9 · 71.7 |

The costs of 217 are the four extra late finishes (the Saturday that makes the minutes work has two 14:30–23:30 duties),
the new times and a slightly weaker Saturday.

**How to rebuild it** (from `tooling/`). The day tables, the assembled table and the anneal run are committed
(`results/quiet-friday-{friday,sat,table,start}.json`; the weekday and Sunday are Second Nature's). The days came from:

```
X="HI=540 TODAY=1 NEWPEN=2 AT22_STRICT=1"
env $X CLS=sat N=14 TOTAL=7200 MAX_TURNS=6 OUT=sat.json node final-table.mjs
env $X CLS=weekday N=14 TOTAL=7140 MAX_TURNS=8 CLOSERS_MAX=3 MID_END_MAX=1350 \
  POOL_ONLY=<the week's 16 times>,13:30-22:30 OUT=friday.json node final-table.mjs
```

The table is `assemble-table.mjs` on Second Nature's weekday, that Saturday and Second Nature's Sunday, with the Friday
written as its own `fri` column. Then:

```
DAYS_CEILING=217 MODE=rules GAP_CAP=5 GAP_CAP_W=60000 GAP_W=1500 ISO_X=4000 MIX_X=3000 STEP_X=20 DAYS_X=30000 \
  HEAVY_W=20000 HEAVY_CAP=43.67 TABLE=results/quiet-friday-table.json node anneal.mjs C1f 100000 3 5
F="DAYS_CEILING=217 FATIGUE_SOFT=1 REST_MIN=860 WKENDS_MIN=7 GAP_MAX=5 ONE_MIN=15 ISO_MAX=4 MIXED_MAX=3 HEAVY_MAX=43.67 STEP_MAX=121 LEAVE_WORST_MIN=20"
env $F node space-polish.mjs results/quiet-friday-start.json /tmp/qf1.json 1 300000          # keeps nothing → /tmp/qf1.closest.json
env $F ISO_W=1e5 node space-polish.mjs /tmp/qf1.closest.json quiet-friday.json 2 400000
```

## Second Edition — stronger than any of them, from a rest-day skeleton (2 Oct 2026)

The owner asked for "a stronger roster than any we have done so far", back at 219 days. The table sweep settled first
that Second Nature's duty table cannot be bettered (harder on familiarity costs fit, harder on fit costs new times, the
other split costs both), so the gain had to come from the ORDER of the weeks — and sixteen more random-start searches
with every cost raised found nothing that had, at once, the weekends five apart, four single rest days, no mixed week and
no fatigue factor. Every near-miss failed on the same two factors: **FF8b** (a block of two or more 06:20 starts must be
followed by two rest days, and a 07:00 after the block does not help) and **FF19** (an early Saturday into a late Sunday
with no rest between is a jump of eight hours).

**So the rest-day layout was searched on its own** (`tooling/skeleton.mjs`, its header has the full rule list): every
working line a week of worked and rest cells and one family, shift times set aside, under every rule a finished rota
must meet — the weekends, the runs with a cover week placed badly, a rest day at every change of family, FF8b, the
SUPPLY of 07:00 and 08:00 duties that an early run needs to keep its 06:20 blocks legal (two a weekday, two a Saturday),
the Sunday 09:00, and `leave.mjs`'s figures. Two findings:

| Rules kept | Fewest single rest days |
|---|---|
| all | **4** |
| mixed weeks allowed freely | 4 — so the families are not the cause |
| weekends any distance apart | 1–3 (Familiar Nine's 2 came from here) |
| a cover week's four duties not counted in the run | 1 — the cause |
| the cover-week worst case allowed to reach 7 · 8 days | 3 · 1 |

The 4 comes from two rules meeting: weekends never more than five apart push each full weekend up against a cover week,
and "never more than 6 days in a row even with the cover week's duties placed as badly as they can be" then leaves a
lone rest day beside it. Second Wind, Second Look and Second Gear were already at that floor. (If the clerk's worst case
were allowed to reach 7 days — today's link is 7, up to 9 — a rota could have 3; that trade is the owner's and was not
taken.)

**Then the times.** `tooling/skeleton-start.mjs` lays the duty table onto the skeleton with the 07:00 and 08:00 duties
where the supply rule needs them, and `space-polish.mjs` searches the times in four passes: first with fatigue as a cost
(`FATIGUE_SOFT=1`, now with a slope — it used to count factors present, so three FF19 jumps cost the same as one and no
run could climb down), then with fatigue refused outright, the heaviest week brought to 42h 00m, and the leave figures
held (`LEAVE_BEST_MIN`, `LEAVE_FOUR_MAX`, new). `LOCK_REST=1` (new) can hold the rest days still; the passes that won
did not need it. Without it the polish may move rest days and families, and it did: the finished rota differs from
`skeleton-27.json` in 18 worked/rest cells and six lines' families, so the skeleton is where the search started, not a
description of the result; the weekend, single-rest-day and run floors were held throughout.

**Second Edition** (`SE-26-F1` · `dea6417f`), Second Nature family, `proposals/Second-Edition-SE-26-F1-dea6417f.pdf`, grid
`tooling/second-edition.json`. Better than or equal to Second Nature, Second Wind and Second Sight on every line of the table below (Second Gear's five-day run, 14h 35m rest and 41h 30m week, and Second Look's fourteen times, are not in it):

| | Second Nature | Second Wind | Second Sight | **Second Edition** | Today |
|---|---|---|---|---|---|
| Longest gap between full weekends | 10 | 5 | 5 | **5** | 7 |
| Single rest days | 4 | 4 | 5 | **4** | 4 |
| Weeks mixing earlies and lates | 2 | 4 | 0 | **0** | 7 of 16 |
| Weeks on one shift time | 15 of 21 | 16 | 16 | **18 of 21** | 7 of 16 |
| Rest-day breaks of two days or more | 21 of 25 | 22 of 26 | 21 of 26 | **22 of 26** | 13 of 17 |
| Heaviest Monday–Saturday week | 43h 40m | 42h 30m | 42h 00m | **42h 00m** | 43h 50m |
| Start-time change, week to week | 1h 28m | 2h 01m | 1h 55m | **1h 01m** | 4h 00m |
| Leave: best · average · worst · four weeks | 28 · 23.4 · 20 · 15 | 27 · 23.4 · 20 · 15 | 28 · 23.4 · 20 · 15 | **28 · 23.4 · 20 · 15** | 30 · 23.4 · 19 · 14 |

  Unchanged, the table's: 9/9 rules, 3/3 flexible, no fatigue warning, 6 days in a row, 14h 20m, 42 late finishes,
  15 shift times (6 new), 218.6 days.

**How to rebuild it** (from `tooling/`; `results/skeleton-27.json` is the skeleton, and the first command remakes it
exactly):

```
MIXED_MAX=0 CHG_W=0.5 node skeleton.mjs 27 2000000 5          # → skel8-27-g5-c6-m0.json = results/skeleton-27.json
node skeleton-start.mjs results/skeleton-27.json /tmp/se0.json 1
F="REST_MIN=860 WKENDS_MIN=7 GAP_MAX=5 ONE_MIN=16 ISO_MAX=4 MIXED_MAX=0 STEP_MAX=121 LEAVE_WORST_MIN=20 ISO_W=1e5 MIX_W=4e4"
env $F FATIGUE_SOFT=1 HEAVY_MAX=42.5 node space-polish.mjs /tmp/se0.json /tmp/se1.json 1 400000   # keeps nothing → /tmp/se1.closest.json
env $F FATIGUE_SOFT=1 HEAVY_MAX=42.5 node space-polish.mjs /tmp/se1.closest.json /tmp/se2.json 2 500000
env $F HEAVY_MAX=42 node space-polish.mjs /tmp/se2.json /tmp/se3.json 1 500000
env $F HEAVY_MAX=42 LEAVE_BEST_MIN=28 LEAVE_FOUR_MAX=15 node space-polish.mjs /tmp/se3.json second-edition.json 2 500000
```

## Fine Tune — Second Gear refined by an outside reviewer (3 Oct 2026)

An outside reviewer supplied a reordering of Second Gear's weeks (their candidate `SGR-26-C1`), with their search
source, an independent recount and its result; all four are kept, unchanged, in `tooling/external/second-gear-refined/`.
Their review asked for the app's own checker to be run before it was treated as a proposal. It was:

- their "original" grid is byte-for-byte Second Gear, and the candidate has exactly the same duties on every day, so
  the staffing rules, shift times, late finishes, cover weeks and days a year are Second Gear's by construction;
- the sheet's checks: 9/9 rules, 3/3 flexible, every hard limit, no fatigue factor fixed or with a cover week placed
  badly, longest run 5 (6 with a cover week), shortest rest 14h 35m, weekends at most five weeks apart;
- every figure they reported agrees with the app's own count, the leave figures included (28 · 23.4 · 20 · 15).

Put forward as **Fine Tune** (`FT-26-H1` · `9a7393d3`, owner: "give it its own name"), Second Nature family,
`proposals/Fine-Tune-FT-26-H1-9a7393d3.pdf`, grid `tooling/fine-tune.json`. Against Second Gear it has one mixed week
instead of two and a week-to-week step of 1h 09m instead of 1h 25m, and nothing worse. The grid is the source, as for
the other supplied designs: their search is time-budgeted, so a re-run need not reproduce it.

## Even Keel — a second Second Gear refinement; Five-Day Flow not shipped (3 Oct 2026)

The reviewer behind Fine Tune sent a second pack (`tooling/external/roster-search-results-2/`, kept unchanged) with two
candidates and the same caveat: the app's own checker had not been run. It was, and gave two different answers.

- **Second Gear Refinement 2 (`SGR-26-C2`) passes everything** and was unused, so it ships as **Even Keel**
  (`EK-26-H1` · `8e9a1bcf`, Second Nature family). Their Second Gear grid is ours byte for byte, and the candidate has
  exactly its duties every day: 9/9 rules, 3/3 flexible, every hard limit, no fatigue factor fixed or with a cover week
  placed badly, rest 14h 35m, weekends at most five apart. Against Fine Tune it has **18 of 21 weeks on one shift
  time** (Fine Tune 16) for a slightly larger week-to-week step (1h 16m, against 1h 09m); one mixed week each, and the
  same leave (28 · 23.4 · 20 · 15).
- **Five-Day Flow (`FDF-26-C1`, a reordering of Second Sight) was not shipped.** Two things its own verifier did not
  see: a **fatigue factor in the worst case** (FF15 — with a cover week's four duties placed badly, five early shifts
  in a row; their verifier checks only the fixed duties, and every proposal here is held to none in the worst case
  too), and **5 single rest days, not 4** (their count leaves out a lone rest day beside a cover week; the sheets count
  it). Its strengths — no mixed week, a week-to-week step of 40 minutes — are real and are on record here.

## Short Run — Second Edition with no run over five days (3 Oct 2026)

The last targeted search, from an outside suggestion: take the four improvements still being asked of the two strongest
proposals, search for each with the app's own checking code, keep only candidates that pass everything, and say for each
whether it was **proved impossible under these constraints** or **not found within the search time**. One of the four
was found, and ships as **Short Run** (`SR-26-F1` · `618348d6`, Second Nature family,
`proposals/Short-Run-SR-26-F1-618348d6.pdf`, grid `tooling/short-run.json`).

| Asked for | Answer | How |
|---|---|---|
| Second Edition with no run over **five** days | **Found — Short Run** | an exact-solver skeleton laid with Second Edition's duties and polished through every check |
| Even Keel with no mixed week | **Not found** | its table laid on Second Edition's skeleton kept two FF19 start-time jumps through four soft polishes (two of them 600,000 moves); laid on the six exact skeletons it failed at the start every time |
| a 19th one-turn week (either table) | **Not found** | six polishes of 500,000 moves, three on each table, every one stopping at 18 — each "closest" rota was the shipped one |
| three single rest days | **Proved impossible** | the exact solver's floor is four, with every rule that bears on the layout and with shift times set aside, so no choice of times can get under it |

**Short Run against Second Edition.** The same duty table, so the same fit (29.1 · 12.7 · 29.0), the same fifteen times
(nine worked today) and the same 42 late finishes. The same 9/9 rules, 3/3 flexible, every hard limit, no fatigue factor
fixed or in the worst case, rest 14h 20m, 7 full weekends never more than five apart (gaps 1 5 5 1 5 5 4), four single
rest days, no mixed week, 18 of 21 weeks on one shift time, leave 28 · 20 · 15, 218.6 days. **The one gain: no run over
five days** (Second Edition's longest is six; the worst case with a cover week placed badly is six for both). **The
costs:** the heaviest week is 42h 30m (Second Edition 42h 00m), the lightest 24h 30m (25h 30m), the week-to-week step
1h 13m (1h 01m). It keeps Second Edition's duty table and most of its figures, takes the fixed run from six days to five, and pays with
the heaviest and lightest weeks and the step above — enough of a difference to be given a name rather than folded into
Second Edition's notes. Its presentations
(`presentations/Short-Run-for-colleagues` and `-for-managers`, built by `tooling/short-run-decks.py`) lead with the run and
say both figures for it, five on the fixed rota and up to six with a cover week placed badly, where Second Edition's say six.

**How it was found — the exact solver.** `skeleton.mjs` is an annealer: sixteen seeds asked for a pure-week skeleton with
no run over five days all ended with five or more single rest days, which looked like a floor and was not one.
`tooling/exact-floor.py` states the same rest-day layout as an integer programme (pulp + CBC) and SOLVES it: rows of 4
or 5 duties, the day counts, 7 full weekends never more than GAP apart, no run over the limit with a cover week's four
duties placed as badly as they can be, and single rest days counted exactly as the sheets count them. Its floors, each
proved optimal rather than searched:

| Layout rules | Single rest days, at least |
|---|---|
| weekends at most 5 apart, run ≤ 6 | **4** |
| weekends at most 5 apart, run ≤ **5** | **4** |
| weekends at most 6 apart, run ≤ 6 | 3 |
| weekends any distance apart | 1 |
| + the family rules (pure weeks, early counts, a rest day at every change, no single rest day after an early), run ≤ 6 | 4 |
| + the family rules, run ≤ 5 | 4 |

The first four agree with the annealer's own floor table under "Second Edition" above, which is the check on the model.
The last row is what the annealer had missed: a pure-week layout with no run over five and four single rest days exists.
`tooling/exact-skeletons.py` is the same model turned into a generator — each solve must hit four, ties go to the fewest
family changes, and a no-good cut makes the next layout differ in at least ten cells. It wrote six skeletons; each was
laid with Second Edition's table and with Even Keel's (`skeleton-start.mjs`, `TABLE=`) and sent through Second Edition's
own chain (two soft polishes, then hard). **Only the second skeleton, with Second Edition's table, came through**
(`results/skeleton-run5.json`): 16 one-turn weeks at 41h 00m. As with Second Edition, the polish moved rest days on the
way (the finished rota differs from the skeleton in 22 cells and six lines' families) while the run, single-rest-day and
weekend floors held. Two further polishes, with everything else held, took it to
17 at 42h 00m and to 18 at 42h 30m; four seeds asked for 18 at 42h 00m found none, so the 42h 30m is what ships — the 42h
cap was a floor carried over from Second Edition, not a rule: no rule sets a weekly maximum, only the 35-hour average, and
the searches' own ceiling of 43h 40m is Second Nature's heaviest week, not a limit.

**What "proved" means here, and where it stops.** The three-single-rest-day answer is a real proof: the solver's rules are
a RELAXATION of the full set (times are not in it), so anything it cannot do, no rota can. The run-five answer is proved the
other way, by the rota existing. The solver's family rules are slightly stricter than the sheets' (it forbids a single rest
day after ANY early, where FF8b is about blocks of 06:20s) and it does not carry the 07:00 supply or the leave figures, so a
"4" from the family-rule rows says a layout exists on paper, not that it will take the times — five of the six did not.

**How to rebuild it** (from `tooling/`; the solver needs `pip install pulp`):

```
python3 exact-skeletons.py 5 4 6 10 /tmp/sk          # six skeletons; /tmp/sk/skel-2.json = results/skeleton-run5.json
node skeleton-start.mjs results/skeleton-run5.json /tmp/sr0.json 1
F="REST_MIN=860 WKENDS_MIN=7 GAP_MAX=5 ONE_MIN=16 ISO_MAX=4 MIXED_MAX=0 STEP_MAX=121 LEAVE_WORST_MIN=20 ISO_W=1e5 MIX_W=4e4 FIXED_RUN_MAX=5"
env $F FATIGUE_SOFT=1 HEAVY_MAX=42.5 node space-polish.mjs /tmp/sr0.json /tmp/sr1.json 1 400000   # keeps nothing → /tmp/sr1.closest.json
env $F FATIGUE_SOFT=1 HEAVY_MAX=42.5 node space-polish.mjs /tmp/sr1.closest.json /tmp/sr2.json 2 500000
env $F HEAVY_MAX=42 node space-polish.mjs /tmp/sr2.json /tmp/sr3.json 1 500000                   # 16 one-turn weeks, 41h 00m
G="REST_MIN=860 WKENDS_MIN=7 GAP_MAX=5 ISO_MAX=4 MIXED_MAX=0 STEP_MAX=121 LEAVE_WORST_MIN=20 LEAVE_BEST_MIN=28 LEAVE_FOUR_MAX=15 HEAVY_MAX=42 FIXED_RUN_MAX=5 ISO_W=1e5 MIX_W=4e4"
env $G ONE_MIN=17 node space-polish.mjs /tmp/sr3.json /tmp/sr4.json 1 500000                      # 17, 42h 00m
env $G ONE_MIN=18 node space-polish.mjs /tmp/sr3.json /tmp/sr5.json 2 500000                      # keeps nothing → /tmp/sr5.closest.json = short-run.json
```

The exact solver is not deterministic across CBC versions, so the first command may write the six in another order or
find different ones; `results/skeleton-run5.json` is the one that worked, and the chain from it is deterministic.

## Long Break — four weeks off for 14 days' leave, as today (3 Oct 2026)

Every 26-line design before this one needed **15** days' leave for four full weeks off, where today's link needs 14 — the
one line on the leave slide where every proposal was worse than today. The owner asked whether 14 was possible at all,
then asked for the search ("run the 14 day leave search"). It was, and it ships as **Long Break** (`LB-26-F1` ·
`c193b37e`, Second Nature family, `proposals/Long-Break-LB-26-F1-c193b37e.pdf`, grid `tooling/long-break.json`).

**What the exact solver said first.** `exact-floor.py`'s layout model with one constraint added — somewhere in the wheel,
28 days from a Sunday must cost at most 14 days' leave — and the single rest days minimised:

| Layout rules, four weeks off for 14 days | Single rest days, fewest found |
|---|---|
| structural rules only, run ≤ 6 | 4 |
| + the family rules, run ≤ 6 | 5 |
| + the family rules, run ≤ 5 | 5 |

**These are the fewest the solver found, not proven floors.** With the leave constraint added, none of these solves finished
inside its time limit, and CBC reports "Optimal" for the best layout it holds when the clock runs out — a first solve of the
middle row said 7, a re-run with a longer limit said 5, and the last row read 6 until an independent re-solve found 5 (the
scripts now print whether a result was proven or timed out). What IS established: the structural row agrees with the
proven floor of 4 without the leave constraint, and a layout with five single rest days exists, because Long Break is one.
So the 14 is not forced out by the link's shape; its price, as far as the solver can see, is one more single rest day than
the four every shortlisted design has. Rebuild a row with `FOUR=14 [LIMIT=1800] python3 exact-floor.py 5 6 [fam]`.

**How it was built.** `FOUR=14 python3 exact-skeletons.py 6 5 4 10` — the generator with the four-weeks constraint, at
most five single rest days, no run over six. It wrote one skeleton before its second solve ran out of time
(`results/skeleton-leave14.json`). Laid with Second Edition's table and sent through the soft → soft → hard chain with
`LEAVE_FOUR_MAX=14` held as a floor throughout, it came through with every check clear; laid with Even Keel's table it
failed at the start, as on every exact skeleton so far. Three further polishes with everything held — asking for 17
one-turn weeks, for 18, and for a step under 1h 30m — kept nothing; the closest rota from the first of them, every floor
held but the 17th one-turn week and the step two minutes gentler than the chain's, is the rota shipped (the rebuild
block's last line).

**Long Break against Second Edition** (same duty table, so the same fit, times, late finishes, closers, headcounts and
218.6 days): 9/9 rules, 3/3 flexible, every hard limit, no fatigue factor fixed or in the worst case, rest 14h 20m,
7 full weekends never more than five apart (gaps 5 1 5 5 5 1 4), no run over six, no mixed week, heaviest week 42h 00m,
lightest 24h 30m. **The gains:** four full weeks off for **14** days' leave (Second Edition 15, today 14), and the best
14-day stretch **29** days off (28; today 30); the worst stays 20 and the average is 23.5 (23.4). **The costs:** **five** single
rest days (four), **16 of 21** weeks on one shift time (18), and a week-to-week step of **1h 44m** (1h 01m). In the
weighted league of that day (`node tooling/league.mjs`, ten designs) it sat fourth, under Second Edition, Short Run and Even Keel and above Fine Tune — the leave gain was
worth three points there and the one-turn, step and single-rest-day costs took back four. With the three designs of
26 Oct in the league it is seventh, the ten keeping their order among themselves (eighth since In Step joined it on 30 Oct).

**How to rebuild it** (from `tooling/`; the solver needs `pip install pulp`):

```
FOUR=14 python3 exact-skeletons.py 6 5 4 10 /tmp/lb          # /tmp/lb/skel-1.json = results/skeleton-leave14.json
node skeleton-start.mjs results/skeleton-leave14.json /tmp/lb0.json 1
F="REST_MIN=860 WKENDS_MIN=7 GAP_MAX=5 ONE_MIN=16 ISO_MAX=5 MIXED_MAX=0 STEP_MAX=121 LEAVE_WORST_MIN=20 LEAVE_FOUR_MAX=14 ISO_W=1e5 MIX_W=4e4"
env $F FATIGUE_SOFT=1 HEAVY_MAX=42.5 node space-polish.mjs /tmp/lb0.json /tmp/lb1.json 1 400000
env $F FATIGUE_SOFT=1 HEAVY_MAX=42.5 node space-polish.mjs /tmp/lb1.json /tmp/lb2.json 2 500000
env $F HEAVY_MAX=42 node space-polish.mjs /tmp/lb2.json /tmp/lb3.json 1 500000                  # every check clear, step 1h 46m
env $F HEAVY_MAX=42 LEAVE_BEST_MIN=29 ONE_MIN=17 node space-polish.mjs /tmp/lb3.json /tmp/lb4.json 1 500000   # keeps nothing → /tmp/lb4.closest.json = long-break.json
```

The same caveat as Short Run's: the generator is not deterministic across CBC versions, and the polish moves rest days
after the lay, so the skeleton is where the search started.

## The shortlist sheet (3 Oct 2026)

Owner: "a two page analysis sheet comparing the three — snappy but evidence led, choose one if you like one, compare to
the existing roster too." `links-26-shortlist.pdf`, built by `tooling/shortlist-sheet.mjs`: what Second Edition, Short
Run and Even Keel share, where they differ (the best of the three on each line marked), each one's edge, the same three
against today's link, the costs all three carry against today, and a recommendation — Short Run, with the reasons and
with the two conditions under which the other two are the better choice; since 4 Oct 2026 page 1 ends with a four-row
choice guide (priority → design, Long Break included as the leave-first option outside the shortlist) in place of the
account of how the designs were found, which is this README's job. **Every figure is computed by the same functions the
proposal sheets use** (`assess`, `personal`, `leave`, `scoreOrder`); the prose is the judgement this README records
under each design. (On 30 Oct 2026 it was rewritten for four, with a five-row guide and every sentence that compares them asserted
— below; later that day for two, In Step and Short Run, recommending In Step — "The shortlist cut to two".) Rebuild with `node tooling/shortlist-sheet.mjs` after any change to any grid, since it reads every design
and the league, and read it again — a sentence that names a figure ("a half hour on one week") is computed too, but one
that names a reason is not.

**A second outside review of the pack (4 Oct 2026), six points, all taken:** the leave cost joins page 1 of every
proposal sheet (a concern, "Four full weeks off, Sunday to Saturday, needs 15 days' leave (today 14)", and a row in the
Working pattern table — a second row, what 14 days buys at best and worst, was dropped for room — until then no proposal sheet carried the leave figures at all; they were in the decks and the shortlist only);
Second Edition's manager Why slide names its own edge, the 1h 01m week-to-week step, where it had named the 18-of-21
one-turn weeks all three share, with the step's definition in the notes; the shortlist's opening no longer calls Long
Break "the one design that buys something new"; its recommendation says what it weights rather than what a colleague
should feel ("thirty minutes once in 26 weeks is not" and "Short Run's fallback" are gone); Even Keel's strap says
"never less than 14h 35m between shifts" — 14h 35m is its SHORTEST gap, and "the longest rest" both misread as a maximum
and ranked it against designs a sheet reader never sees; and the search-process paragraph left the shortlist for the
choice guide above.

**A screenshot polish of everything in the pack (4 Oct 2026, owner: "aesthetic polish everything in the links 26
zip file using screenshots").** Four visual reviews read every page and slide (the three shortlisted sheets, the other
seven, the 75 slides, and the shortlist, summary, rules and read-me) and the fixes went into the generators, never
into a file by hand. The one finding that mattered beyond looks: **every proposal sheet was being printed 2–3 % too
small, and by different amounts**, because Chromium shrinks the whole document to fit when any element is wider
than the printable 711 px — the page-3 grid (`min-width: 62px` a day cell), the page-3 stat strip on four designs,
and page 5's table were each over. At the true width pages 2, 3, 4 and 8 were over-full and have been re-fitted;
the footer now sits at the identical height on all ten (`pdftotext -bbox`, pages 1 and 6). **After any sheet
change, compare the footer position of two sheets** — a shrink is invisible on one sheet alone. The rest, in brief:
every table slide of the decks is one component (one row height and pitch, one set of columns, the banner in one
place), the week strip draws a run of weekends as one bar and carries a weekend across the row break with an arrow
tip, the shortlist's page-2 table repeats a shared figure under each design instead of a merged cell in the gutter,
the shortlist and rules pages are a fixed height so their footers do not float, the summary gained the family's
running footer, the read-me is wrapped by code to 78 columns, and no table cell or list item ends on a lone word
(the tidy pass in `plain.mjs`, `shortlist-sheet.mjs` and `rules-sheet.mjs`).

**The longest block of earlies or lates (5 Oct 2026, owner).** Every week of a 26-line design is all earlies, all
lates or a cover week, where today's link mixes the two inside 7 of its 16 working weeks. The flip side of fewer switches
is that a colleague who prefers one kind waits longer for it to come round. The figure is a RANGE, because a cover
week's four duties are placed later: on the fixed rota every design's longest block is 4 or 5 weeks (today 2), but if
the cover weeks beside a block are given the same kind it runs to 6 to 9 on most designs (8 on Quiet Friday) and to **12 on Even Keel,
Fine Tune and Second Gear**, whose two blocks of lates sit either side of one cover week (Long Break 9; today 3).
`tooling/blocks.mjs` computes it once, and it now appears as a page-2 row and a page-1 concern on every sheet, a row in
the shortlist's comparison (since 30 Oct, the two-design sheet's page-2 prose), a line under "Weeks on one turn" in the summary, and in the decks' week-strip banner and
notes. Until this, the decks quoted only the fixed-rota figure ("the longest run of one kind is 5 weeks of lates"),
which broke the pack's own "5 (up to 6)" convention for days in a row. **The shortlist and rules sheets now refuse to
print a page whose content runs into its footer** — their pages are a fixed height, so an over-full page was HIDDEN, not
pushed onto a third page, and this change first hid the shortlist's last choice-guide row and closing line. The guard
measures at the print width under print media; measured at screen width it passed the broken page.

## Today's link on 26 lines — every way to keep a 13:35 or 13:45 every weekday (26 Oct 2026)

**The brief** (owner, 26 Oct 2026): "Can you take the original 20 link roster. Keep either the 13.35 or 13.45 finish
or both. Expand it to 26 lines, 5 cover weeks, 1600 closing shift start, meet all the rules and match or improve on the
fatigue factors in short run." Then: "Check every possibility. We need to maintain at least one weekday 13.35 or 13.45
finish per day."

**How it was read**, so each reading can be overruled:
- **Today's shift TIMES, not today's week order.** Today's 20 weeks carry four fatigue factors on the fixed duties
  (FF8b, FF15, the 55-hour week at 60h 48m, six FF19 start-time jumps) and a run of seven days; matching Short Run's
  none meant rebuilding the weeks, so today's times were kept and its order was not. Every duty below is one of today's
  18 times unless it says otherwise.
- **"1600 closing shift start"**: every weekday closer is 16:00–23:55 (today 15:15–23:55), in place of the flexible
  rule's 15:45. Whether Saturday's closer moves too (today 14:45–23:55) is the one open question, so both answers are built.
  Sunday cannot: the close is 23:25 and a Sunday duty must be 8 to 9 hours, so its closers start at 15:15, the latest
  quarter hour that allows (today 14:30).
- **"All the rules"**: the three hard limits and the 219-day ceiling, the nine December rules, and the flexible rules
  bar the 15:45 closer, which the brief replaces.
- **"Match or improve on the fatigue factors in Short Run"**: no factor present on the fixed duties or in the worst
  case, and every factor's own value no worse than Short Run's (`factors-like.mjs`, below, prints them side by side).

**The arithmetic.** With today's times, a 16:00 closer and nothing else finishing after 22:30, a weekday pays at most
7,485 minutes (the four ticket-office duties, three closers at 7h 55m, and eight more at 8h 30m) and a Saturday 6,855:
5 × 7,485 + 6,855 = 44,280, **180 minutes over the 44,100 the contract needs**. A 13:45 costs 65 minutes against the
8h 30m early it replaces on a weekday (the 8-hour 06:20–14:20s are the ticket office, fixed), a 13:35 75; a Saturday
can take up to three at 35, 35 and 65 (measured: the best Saturday with one, two or three pays 6,820, 6,785 and
6,720). So the week holds **at most three, and at most one of them on a weekday**, where today's has ten. **One on
every weekday leaves the week 145 minutes short** (5 × 7,420 + 6,855 = 43,955). Every way of keeping them is a way of
finding those 145 minutes.

**Every possibility.** `final-table.mjs` built the best-fitting day table at every total, 5 minutes apart, under each
way of finding the minutes — 2,250 searches, each exhaustive (`REQUIRE` and `LATE_MAX`, added for this, make a weekday
carry a 13:35 or 13:45 and count its late finishes) — and every whole week of five weekday tables (up to three
different ones) and a Saturday paying exactly 44,100 was scored: 5.66 million weeks, 5.12 million inside the 18-time
rule. The ways, with the best week found for each:

| Way of finding the 145 minutes | Saturday closers | Times nobody works today¹ | 13:35/13:45 a week | Finishes after 23:00 a year² | Demand fit, weekday · Saturday³ |
|---|---|---|---|---|---|
| Saturday's closers stay at today's 14:45 | 14:45 ×3 | none | 5 (a 13:35 each weekday) | 42 | 37.1 · 17.4 |
| Saturday's closers at 15:15, today's weekday closer, four of them | 15:15 ×4 | none | 5 | 44 | 37.8 · 14.2 |
| 16:00 every day, and seven more 23:25 finishes a week (today's Sunday 14:30–23:25, on weekdays and Saturday) | 16:00 ×3 | none | 5 | 56 | 32.7 · 12.3 |
| 16:00 every day, and today's 13:30–22:00 half an hour longer | 16:00 ×3 | 13:30–22:30 | 6 | 42 | 36.7 · 9.7 |
| 16:00 every day, and today's 07:15–15:45 and 13:30–22:00 each half an hour longer | 16:00 ×3 | 07:15–16:15, 13:30–22:30 | **10 — a 13:35 and a 13:45 every weekday, as today** | 42 | 31.2 · 12.1 |
| mixtures of these: Saturday closers at two times, a few 23:25s beside a longer duty, a different table on different weekdays | | | | | they trade between the rows above |

¹ Beyond the 16:00 weekday closer (the brief) and the Sunday 15:15 (above), which every row has. ² Per person, closers
included (Short Run 42, today 39). ³ Lower is closer to the December demand; this is the day-table search's own figure
(`short-earlies.mjs`), and the sheets measure a whole rota slightly differently, so the built designs' figures below are
the sheets'.

**Three of them built**, the Home Grown family — the first row, which keeps every one of today's times, and the two
16:00-every-day rows that add no late finish. Each uses one table on all five weekdays, so Monday to Friday work the
same duties and a week can sit on one shift time (a different table on different weekdays buys under two points of fit,
for more shift times). **All three work the same weeks** — Home Grown's rest days, weekends and leave, with Closing
Time's and Both Ways' duties laid on them (below) — so they differ only in their shift times. Their duties
(`results/home-grown-table.json`, `closing-time-26oct-table.json`, `both-ways-table.json`; `closing-time-table.json` holds
Closing Time's current table), Sunday the same in all three:
today's times bar the 15:15 closer, 07:15–15:45 ×4, 08:00–16:30, 14:00–22:30 ×2, 15:15–23:25 ×3. (Closing Time's
08:00–16:30 became today's 08:30–16:30 on 27 Oct and its weeks were searched again, and on 30 Oct it took Short Run's
Sunday: "Closing Time, improved", below.
This section records the three as built on 26 Oct.)

| | Monday to Friday, each day | Saturday |
|---|---|---|
| **Home Grown** `HG-26-T1` · `7d41fafb` | 06:20–13:35 · 06:20–14:20 ×2 · 06:20–14:50 ×2 · 07:15–15:45 ×2 · 11:00–19:30 · 13:30–22:00 ×2 · 14:00–22:30 ×2 · 16:00–23:55 ×3 | 06:20–14:20 ×3 · 06:20–14:50 ×2 · 07:15–15:45 · 08:00–16:30 · 14:00–22:30 ×2 · 14:30–22:00 ×2 · 14:45–23:55 ×3 |
| **Closing Time** `CT-26-T2` · `57429cc4` (`77a235bc` since 30 Oct) | 06:20–13:45 · 06:20–14:00 · 06:20–14:20 ×2 · 06:20–14:50 · 07:15–15:45 ×2 · 13:30–22:30 ×3 · 14:00–22:30 ×2 · 16:00–23:55 ×3 | 06:20–13:45 · 06:20–14:00 · 06:20–14:50 ×2 · 07:15–15:45 · 08:00–16:30 ×2 · 14:00–22:30 ×2 · 14:30–22:00 ×2 · 16:00–23:55 ×3 |
| **Both Ways** `BW-26-T3` · `7a513d87` | 06:20–13:35 · 06:20–13:45 · 06:20–14:20 ×2 · 06:20–14:50 · 07:00–16:00 ×2 · 12:00–20:00 · 13:30–22:30 ×2 · 14:00–22:30 ×2 · 16:00–23:55 ×3 | 06:20–14:00 · 06:20–14:20 · 06:20–14:50 ×2 · 07:00–16:00 ×3 · 14:00–22:30 ×2 · 14:30–22:00 ×2 · 16:00–23:55 ×3 |

**Both Ways uses 07:00–16:00, not the 07:15–16:15 of its row above.** The same nine hours, but a 07:15–16:15 followed
the next morning by a 06:20 leaves 14h 05m, and an early run needs its 07:00-or-later duties placed among the 06:20s
(a block of 06:20s must end in two rest days, FF8b), so the first rotas kept three such gaps however they were
searched. 07:00–16:00 is Short Run's own duty, leaves exactly 14h 20m, and is not an early start in the ORR's sense
(05:00–06:59). It fits the weekday better (30.5 against 31.2) and the Saturday worse (16.2 against 12.1).

| | Home Grown | Closing Time, 26 Oct (`57429cc4`; later versions below) | Both Ways | Short Run | Today's link (20 weeks) |
|---|---|---|---|---|---|
| Saturday's closers | 14:45 ×3, as today | 16:00 ×3 | 16:00 ×3 | 15:15 ×3 | 14:45 ×2 |
| 13:35 or 13:45 finishes a week | 5, a 13:35 every weekday | 6, a 13:45 every weekday and Saturday | 10, a 13:35 and a 13:45 every weekday | none | 10 |
| Shift times (new) | 12 (2) | 11 (3) | 14 (4) | 15 (6) | 18 |
| December rules met | 9 of 9 | 9 of 9 | 9 of 9 | 9 of 9 | 4 of 9 |
| Hard limits and the contract | met | met | met | met | met |
| Contracted days a year (ceiling 219) | 218.6 | 218.6 | 218.6 | 218.6 | 219.0 |
| Fatigue factors present, fixed duties · worst case | 0 · 0 | 0 · 0 | 0 · 0 | 0 · 0 | 4 · 5 |
| Every factor's value against Short Run's (`factors-like.mjs`) | none worse | none worse | none worse | — | — |
| Most hours in any 7 days | 50h 30m | 51h 30m | 50h 18m | 51h 42m | 60h 48m |
| Most days in a row | 5 (up to 6) | 5 (up to 6) | 5 (up to 6) | 5 (up to 6) | 7 (up to 9) |
| Shortest rest between shifts | 14h 35m | 14h 35m | 14h 20m | 14h 20m | 12h 30m |
| Full weekends off | 7 in 26, at most 5 weeks apart | same | same | same | 4 in 20, up to 7 apart |
| Single rest days · weeks mixing earlies and lates | 4 · 0 | 4 · 0 | 4 · 0 | 4 · 0 | 4 · 7 |
| Weeks on one shift time | 16 of 21 | 16 of 21 | 16 of 21 | 18 of 21 | 7 of 16 |
| Longest block of earlies or lates | 5 (up to 7) | 5 (up to 7) | 5 (up to 7) | 5 (up to 7) | 2 (up to 3) |
| Heaviest · lightest week, Monday to Saturday | 42h 30m · 24h 55m | 41h 30m · 27h 00m | 40h 55m · 24h 00m | 42h 30m · 24h 30m | 43h 50m · 25h 10m |
| Week-to-week change of start | 1h 25m | 1h 20m | 1h 40m | 1h 13m | 4h 00m |
| 14 days' leave: best · average · worst · four full weeks | 28 · 23.4 · 20 · 15 | same | same | same | 30 · 23.4 · 19 · 14 |
| Finishes after 23:00, each a year | 42 | 42 | 42 | 42 | 39 |
| Fit to the trains, weekday · Saturday · Sunday | 36.8 · 15.5 · 48.6 | 36.4 · 8.7 · 48.6 | 30.2 · 15.2 · 48.6 | 29.1 · 12.7 · 29.0 | 52.0 · 65.9 · 71.7 |

**What that says.** All three meet the brief: every rule, every hard limit, no fatigue factor on the fixed duties or
in the worst case, and on each factor's own value — the longest run without a 48-hour break, the most hours in seven
days, backward against forward steps, the rest — Short Run's figure or better; the busiest seven days are lighter in
all three. They also match Short Run on the run, the weekends, the single rest days, the mixed weeks, the blocks of
earlies and lates, the leave and the late finishes, and Home Grown and Closing Time give a longer shortest rest.
**What keeping the short finishes costs**: two fewer weeks on one shift time (16 against 18), because a single 13:35 a
day cannot be one person's for the week — five 06:20 starts in a row is itself a fatigue factor (FF15) — and a larger
week-to-week change (1h 20m to 1h 40m against 1h 13m; a last polish asked for Short Run's figure with everything else
held and kept nothing). Both were what the polishes could reach rather than what the rules allow: on 27 Oct an exact
model of the whole rota took Closing Time to 17 weeks on one shift time and a 1h 11m change (below). Sunday keeps
today's times bar the closer, so its fit (48.6) is far better than today's but not Short Run's, which adds two Sunday
times nobody works today (09:00–18:00, 14:30–22:30). The 15:45 closer, the flexible
rule the brief replaces, is the one flexible rule all three miss; a proposal sheet does not show flexible rules.

**In the weighted league** (`REF_IN_RANGE=1 node league.mjs`, which now reads every design in `regenerate.mjs` instead
of a typed list of ten — the list had not been kept up, so none of the three would have been in it) Closing Time is
third on 86.0, Both Ways fifth on 85.8 and Home Grown sixth on 85.5, behind Second Edition (87.2) and Short Run (86.5);
the original ten keep their order among themselves. Against Short Run each loses most on fit to the trains, 2.0 to 2.7
points (the league averages weekday, Saturday and Sunday, and most of the gap is their Sunday, which keeps today's
times), and 1.1 on weeks on one shift time; each gains most on familiar shift times, 1.4 to 2.8, and Closing Time and
Both Ways on the heaviest week. `JSON=<file>` (new) writes the whole table, which is how it was published as a page.
(Those are the 26 Oct figures. Improved on 27 and 30 Oct, Closing Time is first — below — until In Step joins the league.)

**In every version of the league** (27 Oct 2026, owner: "give me all versions marking which designs are new"): the
usual table; the proposals alone setting each factor's best and worst (no `REF_IN_RANGE`); familiar shift times left
out (`DROP=fam`); the run read on the fixed rota (`RUN_FIXED=1`); and the 24-line work's six-factor league
(`WEIGHTS=met:35,fat:20,fit:20,wkends:10,fam:10,run:5` — new — with the proposals setting the scale, as it was used there):

| | Usual | Proposals set the scale | Without familiar times | Run on the fixed rota | Six-factor |
|---|---|---|---|---|---|
| Closing Time with Short Run's Sunday (30 Oct, below) | **1st · 87.2** | **1st · 90.2** | 2nd · 91.3 | **1st · 87.2** | 7th · 90.5 |
| Closing Time, 27 Oct | 1st · 87.3 | 3rd · 86.9 | 5th · 89.7 | 1st · 87.3 | 11th · 84.2 |
| Closing Time as built (26 Oct) | 3rd · 86.0 | 4th · 83.1 | 7th · 88.6 | 2nd · 86.0 | 11th · 81.2 |
| Both Ways | 5th · 85.8 | 10th · 79.4 | 8th · 88.5 | 4th · 85.8 | 12th · 80.6 |
| Home Grown | 6th · 85.5 | 7th · 81.2 | 10th · 86.7 | 6th · 85.5 | 13th · 80.0 |
| first, without the improved Closing Times | Second Edition 87.2 | Second Edition 89.7 | Second Edition 91.5 | Short Run 86.5 | six tied on 92.2 |

(Neither improved Closing Time moves another design's score: their figures sit inside every factor's range, so they
only move the others' places. On 30 Oct Closing Time's 87.22 leads Second Edition's 87.18 by a whisker.)

*(Superseded later on 30 Oct by In Step, which is first in all five versions. With it in the league Closing Time is
second in the usual table, where the proposals set the scale and with the run on the fixed rota, third without
familiar times and eighth in the six-factor league; Long Break is eighth in the usual table; and In Step's closer fit
widens that factor's range, so the six on Second Nature's duty table tie on 90.75 in the six-factor league, not 92.2 —
"In Step" and "The shortlist cut to two", below.)*

Two factors moved the three of them. As built on 26 Oct their fit to the trains was the weakest of the thirteen (31.2
to 33.6, against 23.6 to 24.4) and their familiar shift times the best (71% to 83% of their times today's, against 53%
to 60%). With today's link in the range, as usual, that fit gap is a fifth to a quarter of a range today's link
stretches to 63.2, and costs 2 to 3 points; with the proposals alone setting it, Home Grown's fit is the bottom of the
range and the gap costs 8.4 to all 11. Leaving familiarity out takes away the one factor they led on. Closing Time has
since closed most of its gap — 24.7 on 30 Oct, with Short Run's Sunday, at 62% familiar — which is why it now leads
the version where the proposals set the scale and is second without familiar times. Reading the run on the fixed rota
lifts all three, because their longest run there is five, where six of the other ten have six. The six-factor league
barely separates the 26-line proposals: all thirteen meet every rule, carry no fatigue warning, have the same share of
full weekends and a worst-case run of six, so fit (20) and familiarity (10) decide it alone, and the six on Second
Nature's duty table (Second Nature, Second Wind, Second Sight, Second Edition, Short Run, Long Break — the same duties
every day, checked) tie on 92.2.

**How they were built.** Home Grown's table was laid on Short Run's rest-day skeleton (`results/skeleton-run5.json`)
by `skeleton-start.mjs`, with three settings added for these tables: a weekday with a column of its own, the late
line's single weekday duty (`NOON` — Home Grown's 11:00, Both Ways' 12:00) with Saturday off where a Saturday late
would be a start-time jump of more than two hours, and the Sunday early that is not a 07:15 (`SUN_EXTRA`). Its times
were searched by `space-polish.mjs` in two passes: fatigue as a cost with Short Run's floors a little lowered, then
Short Run's floors — the shortest rest 14h 20m, leave 28 · 20 · 15, no run over five on the fixed duties, seven
weekends at most five apart, four single rest days, no mixed week. **Closing Time and Both Ways were then laid on
Home Grown's weeks** — `skeleton-from.mjs` (new) reads a finished rota's rest days and families back as a skeleton —
and only their times searched, the rest days held (`LOCK_REST=1`), with two settings new to `space-polish.mjs`:
**`FACTORS_LIKE=short-run.json`**, every fatigue factor's value no worse than Short Run's on both views, and
**`REST_SLOPE=1`**, every gap under the 14h 20m floor a cost, not only the tightest (with six gaps of 14h 05m, mending
five of them used to score nothing). Laid on Short Run's skeleton directly, as Home Grown was, both came through
every floor too, but with a block of late weeks running to 11 or 12 with the cover weeks beside it; on Home Grown's
weeks all three have Short Run's 5 (up to 7). Home Grown met every factor value without the setting, which
`factors-like.mjs` (new) confirms for all three. Second Edition's skeleton came through the first pass for all three
tables and kept nothing at Short Run's floors; Long Break's has a run of six by design.

**How to rebuild them** (from `tooling/`; each chain is deterministic, and each was re-run from these commands to the
same fingerprint):

```
A="REST_MIN=815 WKENDS_MIN=7 GAP_MAX=5 ISO_MAX=4 MIXED_MAX=0 LEAVE_WORST_MIN=19 LEAVE_FOUR_MAX=15 ISO_W=1e5 MIX_W=4e4 FIXED_RUN_MAX=5 FATIGUE_SOFT=1 HEAVY_MAX=42.5"
B="REST_MIN=860 WKENDS_MIN=7 GAP_MAX=5 ISO_MAX=4 MIXED_MAX=0 LEAVE_WORST_MIN=20 LEAVE_BEST_MIN=28 LEAVE_FOUR_MAX=15 ISO_W=1e5 MIX_W=4e4 FIXED_RUN_MAX=5 HEAVY_MAX=42.5 STEP_MAX=121 FATIGUE_SOFT=1"
L="$B REST_SLOPE=1 FACTORS_LIKE=short-run.json LOCK_REST=1 ONE_MIN=0"
# Home Grown
TABLE=results/home-grown-table.json NOON=11:00-19:30 NOON_SAT=off SUN_EXTRA=08:00-16:30 node skeleton-start.mjs results/skeleton-run5.json /tmp/hg0.json 1
env $A node space-polish.mjs /tmp/hg0.json /tmp/hg1.json 11 300000
env $B node space-polish.mjs /tmp/hg1.json /tmp/hg2.json 21 500000                 # = home-grown.json (7d41fafb)
# Closing Time and Both Ways, on Home Grown's weeks
node skeleton-from.mjs home-grown.json /tmp/hg-weeks.json
TABLE=results/closing-time-26oct-table.json SUN_EXTRA=08:00-16:30 node skeleton-start.mjs /tmp/hg-weeks.json /tmp/ct0.json 1
env $L node space-polish.mjs /tmp/ct0.json /tmp/ct1.json 62 400000                # the 26 Oct grid (57429cc4); 27 Oct: "Closing Time, improved"
TABLE=results/both-ways-table.json NOON=12:00-20:00 SUN_EXTRA=08:00-16:30 node skeleton-start.mjs /tmp/hg-weeks.json /tmp/bw0.json 1
env $L node space-polish.mjs /tmp/bw0.json /tmp/bw1.json 71 400000                # = both-ways.json (7a513d87)
node factors-like.mjs short-run.json home-grown.json closing-time.json both-ways.json   # every value Short Run's or better
node short-earlies.mjs                                                                    # the possibilities table above
```

`skeleton-start.mjs` warns once for Home Grown's weeks ("an early run ending at a single rest day", line 2): its own
supply rule cannot read a run the polish made legal another way, and the search clears it.

## A second session's work of 26–27 Oct, carried into main (1 Nov 2026)

The same day as the section above, a second working session took three questions of its own:
- what keeping an early finish costs;
- today's link kept week for week;
- a 26-week Word roster the owner supplied.

Its work stayed on its own branch, `claude/app-logo-gleam-removal-lxza1q` (last commit `1068533`, 27 Oct). It was
carried into main on 1 Nov, on the owner's word to keep it as a record. The three sections that follow are its
write-ups as it left them, corrected only where main has moved on.
- **Carried over:**
  - the write-ups;
  - `tooling/keep-early.mjs`, `tooling/today-plus.mjs`, and the repair solver in `tooling/exact/`;
  - the ten grids in `tooling/results/` that the write-ups name.
- **Not carried over:** its changes to three colleague decks, `deck-polish.py`, `deck-check.mjs` and the zip. Main had
  overtaken them, as the first section says.
- **Its figures are those of 26–27 Oct.** The 31 Oct rulings came later, and the notes at the top of this file say what
  they change.
- **Checked on main, 1 Nov:**
  - `keep-early.mjs` reproduces its recorded grids exactly;
  - `today-plus.mjs` runs;
  - the two research sheets no longer render, because the renderer now refuses a page that runs over;
  - the solver's own check agrees with main's sheets on everything but the 55-hour worst case (end of *Little and
    Often*).

## The early finishes, and what keeping one costs (26 Oct 2026)

Owner: "Do you think it will be easy to sell to the others when we are losing the 13.35 and 13.45 finishes. It is just
this was needed to shorten the lates." **All three designs then shortlisted (Second Edition, Short Run and Even Keel)
lose them.** Today's two weekday floor openers, 06:20–13:35 and 06:20–13:45 (about 26 a year each), become 06:20–14:50
in Second Edition and Short Run, and 06:20–14:00 or 14:50 in Even Keel. That is arithmetic, not one design's choice.
The contract fixes the week's total (44,100
minutes) and the 219-day ceiling fixes the number of shifts, so the average shift is at least 8h 16m (today 8h 14m),
and the time taken off the lates has to go on the earlies:

| Monday to Saturday | Today | Second Edition, Short Run | Even Keel |
|---|---|---|---|
| Average early | 7h 59m | 8h 26m | 8h 19m |
| Average late | 8h 29m | 8h 06m | 8h 12m |
| Weekday 06:20 floor early ends | 13:35 · 13:45 | 14:50 | 14:00 · 14:50 |
| Earlies finishing before 14:00, each a year | 26 | 0 | 0 |

**The decks were changed to say so, on that session's branch, and the change was not carried into main.** Slide 6 ("Will
my shifts be longer?") answered with the closers only, and the trade-offs slide did not list the early finishes. So
slides 6 and 13 of the three colleague decks were rewritten to say the 13:35 and 13:45 go, and what keeping one costs.
The rewrite was `deck-polish.py`'s `early_finishes`, vouched for by `deck-check.mjs`'s `floorEarly`, in commit
`1e21df5`. By 1 Nov main had overtaken it:
- Even Keel's and Second Edition's decks left the pack on 30 Oct;
- two of today's three shortlisted designs, In Step and Even Step, keep a 13:45 every weekday;
- Short Run still has none.

**What keeping one costs, tested** (`tooling/keep-early.mjs`). Each 13:45 is paid for the same day, minute for minute, so
the week's total and the number of shifts do not move:
- **Second Edition and Short Run:** a 06:20–14:50 becomes 06:20–13:45, and a 15:00–22:30 becomes 13:55–22:30, 65 minutes
  each way. 13:55 is off the quarter-hour grid the table searches used, but it is the only start that balances to the
  minute. The on-grid alternative is 06:20–13:35 with a 13:45–22:30 late; tested for one a weekday on Short Run, it
  gives the same figures as one 13:45.
- **Even Keel:** its 06:20–14:00 becomes 06:20–13:45, and a 14:45–22:30 becomes 14:30–22:30.

The script tries every placement on the rota and scores each with the sheet's own functions:

| Kept | Rules | Fatigue warnings | One-turn weeks | Shift times | Heaviest week | Average early · late | Before 14:00, a year each |
|---|---|---|---|---|---|---|---|
| Short Run as it is | 9/9 · 3/3 | 0 | 18 of 21 | 15 | 42h 30m | 8h 26m · 8h 06m | 0 |
| Short Run, one 13:45 a weekday | 9/9 · 3/3 | 0 | 17 | 17 | 41h 50m | 8h 19m · 8h 13m | 10 |
| Short Run, two a weekday (today's number) | 9/9 · 3/3 | 0, in all 243 placements | 18 | 16 | 42h 30m | 8h 11m · 8h 20m | 20 |
| Second Edition, one a weekday | 9/9 · 3/3 | 0 | 18 | 17 | 43h 00m | 8h 19m · 8h 13m | 10 |
| Second Edition, two a weekday | 9/9 · 3/3 | 1 (FF17, backward rotation) in every one of the 243 placements | – | – | – | – | – |
| Even Keel, its 14:00 made 13:45 | 9/9 · 3/3 | 0 | 18 | 15 | 41h 30m | 8h 17m · 8h 14m | 10 |

Everything else holds in each row: the hard limits, the weekends (7 in 26, at most five apart), the runs, the shortest
rest, 218.6 days a year, the late finishes and the fit. **So the price of the early finishes is exactly the lates that
pay for them.** In Short Run, two 13:45s a weekday (today's number) cost three things:
- both 15:00–22:30 lates become 13:55–22:30;
- lates average 8h 20m, still 9 minutes under today's;
- one more shift time.

Nothing else on the sheet changes. This is a choice to put to colleagues, not a change made here. The shortlisted grids,
their sheets and the built-in proposals are untouched. The four kept grids are in `tooling/results/keep-1345-*.json`.

From `tooling/` (one per weekday is searched within one extra mixed week, two per weekday in full):

```
node keep-early.mjs short-run.json 06:20-14:50 06:20-13:45 15:00-22:30 13:55-22:30 1 1 results/keep-1345-short-run-x1.json
node keep-early.mjs short-run.json 06:20-14:50 06:20-13:45 15:00-22:30 13:55-22:30 2 9 results/keep-1345-short-run-x2.json
node keep-early.mjs second-edition.json 06:20-14:50 06:20-13:45 15:00-22:30 13:55-22:30 1 1 results/keep-1345-second-edition-x1.json
node keep-early.mjs second-edition.json 06:20-14:50 06:20-13:45 15:00-22:30 13:55-22:30 2 9    # every placement: FF17
node keep-early.mjs even-keel.json 06:20-14:00 06:20-13:45 14:45-22:30 14:30-22:30 1 9 results/keep-1345-even-keel-x1.json
```

Re-run on main on 1 Nov 2026, the Short Run and Even Keel one-a-weekday commands reproduce their recorded grids exactly.

## Same Again — today's link kept, with six weeks added (26 Oct 2026)

Owner: "Can you take the existing roster and add the extra weeks whilst minimising the fatigue factors in those
weeks", and then, asked:
- 26 weeks: five working weeks and one cover week added;
- no more than 219 days a year;
- the December staffing rules met where that costs no fatigue.

**Today's twenty weeks are not touched.** Every one keeps its shifts, and they stay in their order round the rotation.
`tooling/today-plus.mjs` chooses where the six new weeks go and what the five working ones hold:
- the cover weeks on lines 1, 6, 11, 16 and 21 (gaps 5, 5, 5, 5, 6), which leaves 4,424 ways to place the six;
- only shift times worked today, so the link keeps today's 18 (rule S9);
- exactly 5 × 35 hours Monday to Saturday in 21 duties (218.6 days a year).

It minimises, in this order:
1. hard-limit breaches;
2. fatigue instances in or touching a new week;
3. fatigue factors present;
4. every fatigue instance anywhere (inserting a week can break one of today's);
5. December rules failed;
6. the shape of the week: single rest days, full weekends off, one shift time and one kind of turn per new week,
   each time on the kind of day it is worked today, no week heavier or lighter than today's.

It took four rounds:
- **Round 1, cell by cell:** 8 of 9 rules, but scrappy weeks with 12 single rest days.
- **Round 2:** the week's shape added to the cost.
- **Round 3:** a polish from the best results.
- **Round 4:** whole-week moves (a week redrawn on one familiar time in one step).

Two weightings show the trade: `MODE=staff`, where the December rules come before the week's shape, and `MODE=tidy`,
where the shape can outweigh a rule. Two `MODE=both` polishes of the staff result found nothing tidier that keeps
every rule.

| | Today | **Same Again** (staff) | Same Again Tidy | Short Run |
|---|---|---|---|---|
| December rules met | 4 of 9 | **9 of 9** | 7 of 9 | 9 of 9 |
| Fatigue warnings, fixed duties (up to) | 4 (5) | **3 (5)** | 3 (5) | 0 (0) |
| Fatigue instances in or touching a new week | — | **0** | 0 | — |
| Full weekends off a year (longest wait) | 10 (7 weeks) | 8 (13 weeks) | 12 (8 weeks) | 14 (5 weeks) |
| Finishing at 23:00 or later, a year each | 39 | 48 | 44 | 42 |
| Earlies finishing before 14:00, a year each | 26 | 26 | 28 | 0 |
| Shift times · new ones to learn | 18 · — | 18 · 0 | 18 · 0 | 15 · 6 |
| Four full weeks off | 14 days' leave | 14 | 14 | 15 |
| Most days in a row, fixed (cover week badly) | 7 (9) | 7 (10) | 7 (10) | 5 (6) |
| Single rest days · weeks on one turn | 4 · 7 of 16 | 5 · 9 of 21 | 7 · 10 of 21 | 4 · 18 of 21 |
| Fit to the trains, weekday (lower is closer) | 52.0 | 45.3 | 45.4 | 29.1 |
| Weighted league (`REF_IN_RANGE=1`, both added to the proposals) | 23.3 | 41.2 | 38.9 | 87.7 |

**On the weighted league, Same Again is the better of the two, and both sit far below the shortlist** (owner's
question, 26 Oct 2026: "What is the best one of these new ones"). The two missed December rules cost Same Again Tidy
more than its weekends earn back. Against the shortlist, keeping today's twenty weeks keeps today's weaknesses:
- fit to the trains, weekends above all (68.8 against Short Run's 23.6, lower closer);
- 4 fatigue warnings in the worst case, where the shortlist has none;
- a 12h 30m shortest rest;
- fewer full weekends;
- a third of the weeks mixing earlies and lates.

Only the familiar shift times and the 14-day four-week leave score better.

**What it buys:**
- every December staffing rule;
- one fewer fatigue factor than today: the two 55-hour weeks are gone, because new weeks were placed between today's
  weeks 4 and 5 and 13 and 14;
- nothing new to learn: the same times, the 13:35 and 13:45 kept, four weeks off still 14 days' leave.

**What it costs:**
- fewer full weekends off (8 a year against 10, up to 13 weeks apart);
- nine more late finishes a year each, which is what the third closer every day costs;
- two six-day weeks;
- a worst case of 10 days in a row, where today's is 9.

The tidy version shows the other side: two rules short, and every new week reads like one of today's.

**Not in the pack.** These are search results for the owner to look at, not shortlisted proposals. The grids are
`tooling/results/same-again.json` and `same-again-tidy.json`, each with a `.meta.json`. A sheet renders with
`supplied.mjs` (`OUT=` sets where; below). On page 5 the closing note spills onto a ninth page; that wants fitting
before either joins the pack, which would also take an entry in `regenerate.mjs`'s `SUPPLIED`, the summary and
`pack.py`. The renderer now refuses a page that runs onto another sheet. So on main (1 Nov) the sheet command below
stops at page 5, 1,044px against the 1,032 that fit, instead of printing a ninth page.

From `tooling/`:

```
MODE=staff node today-plus.mjs 150000 2 202 /tmp/a.json                      # round 4, the staff search
MODE=tidy START=<a round-3 result> TEMP=30000 node today-plus.mjs 120000 2 203 /tmp/b.json
OUT=/tmp/Same-Again.pdf node supplied.mjs results/same-again.json "Same Again" "<strap>" SA-26-S1
```

The search is seeded but its rounds were chained by hand from the best results, so the grids in `results/` are the
record, not a single command.

## Little and Often — a 26-week Word roster, read and compared (26 Oct 2026)

Owner, uploading a 26-week Word roster headed *Customer Experience Ambassador*, with no names on it: "Can you name and
analyse this against our other examples".

**How it was read.** Cell by cell into the app's shape, with nothing changed and nothing searched:
- each COVER week is a whole cover week, on lines 1, 7, 12, 17 and 22;
- every time is as written;
- every week's Monday-to-Saturday hours match the table's own *Weekly Total* column, and the 26 weeks total 910 hours,
  35 a week.

The grid is `tooling/results/little-and-often.json`, with a `.meta.json`. The Word file itself is not committed.

**Why the name.** What sets it apart is shorter shifts on more days:
- it averages 7h 59m a duty, Monday to Saturday, where every other design here averages 8h 14m or 8h 16m;
- so the contract takes 92 duties in its 21 working weeks, where the ceiling allows 89;
- that is 224.6 contracted days a year.

Code `LO-26-EXT` (EXT for a supplied design, as in the 24-line set), fingerprint `3318d083`.

**What it does with the times:**
- weekday closers run 16:25–23:55, 7h 30m, where the proposals start them at 15:45;
- the 06:20–13:35 and 06:20–13:45 earlies stay: between them 26 a year for each person, as today;
- it has 20 shift times. Eleven are new: 06:20–14:25, 06:20–14:30, 07:00–14:00, 07:00–15:30, 08:30–17:00, 10:30–19:00,
  12:00–20:30, 13:30–21:30, 14:20–23:25, 14:30–22:30 and 16:25–23:55;
- it drops nine of today's, among them both Saturday ticket-office times, 06:20–14:50 and 14:30–22:00.

| | Today | **Little and Often** | Same Again | Short Run | Second Edition | Even Keel | Long Break |
|---|---|---|---|---|---|---|---|
| December rules met (· flexible, of 3) | 4 of 9 | **3 of 9 · 1** | 9 of 9 · 2 | 9 of 9 · 3 | 9 of 9 · 3 | 9 of 9 · 3 | 9 of 9 · 3 |
| Contracted days a year (ceiling 219) | 219.0 | **224.6** | 218.6 | 218.6 | 218.6 | 218.6 | 218.6 |
| Fatigue warnings, fixed duties (up to) | 4 (5) | **2 (6)** | 3 (5) | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| Full weekends off a year (longest wait) | 10 (7 weeks) | **4 (16 weeks)** | 8 (13) | 14 (5) | 14 (5) | 14 (5) | 14 (5) |
| Most days in a row, fixed (cover week badly) | 7 (9) | **6 (9)** | 7 (10) | 5 (6) | 6 (6) | 5 (6) | 6 (6) |
| Shortest rest | 12h 30m | **13h 50m** | 12h 30m | 14h 20m | 14h 20m | 14h 35m | 14h 20m |
| Single rest days · weeks on one turn | 4 · 7 of 16 | **18 · 8 of 21** | 5 · 9 | 4 · 18 | 4 · 18 | 4 · 18 | 5 · 16 |
| Six-day weeks, Sunday included | 1 | **5** | 2 | 0 | 0 | 0 | 0 |
| Heaviest week, Monday to Saturday | 43h 50m | **45h 30m** | 43h 50m | 42h 30m | 42h 00m | 41h 30m | 42h 00m |
| Finishing at 23:00 or later, a year each | 39 | **46** | 48 | 42 | 42 | 44 | 42 |
| Earlies finishing before 14:00, a year each | 26 | **26** | 26 | 0 | 0 | 0 | 0 |
| Shift times · new ones to learn | 18 · — | **20 · 11** | 18 · 0 | 15 · 6 | 15 · 6 | 15 · 7 | 15 · 6 |
| Fit to the trains, weekday · Sat · Sun (lower is closer) | 52.0 · 65.9 · 71.7 | **34.7 · 51.4 · 74.1** | 45.3 · 78.8 · 82.3 | 29.1 · 12.7 · 29.0 | 29.1 · 12.7 · 29.0 | 29.4 · 14.5 · 29.0 | 29.1 · 12.7 · 29.0 |
| Weighted league (`REF_IN_RANGE=1`, as the Same Again table) | 23.3 | **12.3** | 41.2 | 87.7 | 88.5 | 87.4 | 87.2 |

Little and Often is scored on the range the Same Again table already uses, so no other score moves. That gives it the
same figure as adding it to the range: where it sets a new worst it scores 0 either way.

**It cannot be run as it stands.** Two hard-limit checks fail, and both are the same fact: 224.6 contracted days a year
against the 219 ceiling. Getting under it means three fewer duties across the 21 working weeks, so some shifts get
longer. That is the trade the early finishes face (above): a shorter shift is paid for with a longer one.

**December rules, 3 of 9** (today 4):
- Sunday opens with three at 07:15, where the rule asks for four, and has four on at 22:00, where it asks for five.
- The ticket office's identical pairs are rostered on no day; today has them Monday to Saturday.
- At 14:30 on a Saturday only four are on duty in the whole station. The earlies have gone at 14:25 and 14:30, and the
  15:15 closers are not yet in. With the ticket office's posts taken out, the sheet counts nobody on the floor.
- One Sunday duty, 14:20–23:25, is 9h 05m; the most allowed is 9h.
- 20 shift times, against today's 18.

Of the three flexible rules it meets the cover spread. It has 12 on a Saturday (14 asked) and closers from 16:25
(15:45 asked).

**Where it beats today:**
- the weekday and Saturday fit to the trains: 34.7 and 51.4, against 52.0 and 65.9 (Sunday 74.1, against 71.7);
- two fatigue warnings in the fixed duties, against four;
- a 13h 50m shortest rest (today 12h 30m), and at most six days in a row (today seven);
- shorter closing shifts.

**Where it costs most:**
- 4 full weekends off a year (today 10, the shortlist 14), up to 16 weeks apart;
- 18 single rest days, where every other design has 4 or 5;
- 8 of 21 weeks on one turn, against the shortlist's 18;
- five six-day weeks, and a 45h 30m week (line 9: five 16:25 closers and a Saturday late);
- 11 new shift times;
- up to 6 fatigue warnings if a cover week falls badly: five factors and a 55-hour week, against today's 5.

**On the weighted league it comes last, at 12.3:** below today's link (23.3), Same Again (41.2) and the shortlist (87
to 89). Its gains over today are real but small: the fit, the rest, and fewer weeks mixing earlies and lates. It scores
nothing on the factors that carry most of the weight: the December rules, the worst-case fatigue warnings, the
weekends, familiar shift times, weeks on one turn and single rest days. Today's familiar times and weekends are what
keep today above it.

**Not in the pack.** Like Same Again, it is a design to look at, not a proposal. Its sheet renders with `supplied.mjs`
(below), but runs to 11 pages, not 8:
- three pages run over;
- on one of them, *What changes, in numbers*, the last line sits under the footer.

The template was sized for the shortlist, and this design has more trade-offs and shift times to list. That wants
fitting before it could join the pack. On main (1 Nov) the renderer refuses it at the first page that runs over (pages
1, 4 and 5 are over), so the command below stops rather than print.

From `tooling/`:

```
OUT=/tmp/Little-and-Often.pdf node supplied.mjs results/little-and-often.json "Little and Often" "<strap>" LO-26-EXT
```

**Two repairs of it were withdrawn** (owner, 27 Oct 2026). *Often Enough* (the fewest changes that meet every rule: 42,
proven) and *Fair Enough* (77 changes, with today's weekends and 14 weeks on one turn) were made with `tooling/exact/`
on 26 Oct. Neither came near the shortlist on the weighted league (50.8 and 74.3). The early finishes Fair Enough kept
are available in the shortlist itself, as the kept-13:45 versions above show. Both repairs, their grids and their
working are in that session's branch history at `12a6b20`, which main does not contain.

**The solver after the 31 Oct ruling.** `tooling/exact/` was written against the sheets of 26 Oct. `check_model.py` was
run on 1 Nov with Little and Often as the base, Often Enough as the solution and 20 test grids:
- **On that session's own code:** no mismatches.
- **On main's:** it agrees on every rule and every fatigue factor but one, the 55-hour worst case (H55W). Since 31 Oct
  the sheets count a cover week's Sunday as worked on top, and the model does not.

So the solver's figures stand as of 26 Oct. Before it is used again, H55W needs adding to `model.py`.

## Closing Time, improved — every possibility tried (27 Oct 2026)

**The question** (owner, 27 Oct 2026): "closing time can't be improved any further? try every possibility if you
haven't already". Closing Time keeps its brief — a 16:00 closer Monday to Saturday, a 13:45 every weekday, today's
times and one more, every rule, every fatigue factor's value Short Run's or better — and nothing it already had was
allowed to get worse. Three figures improved; nothing else could be found.

**What changed** (`CT-26-T2` · **`78e18900`**, was `57429cc4`):
- **Sunday's 08:00–16:30 is today's 08:30–16:30** — the best-fitting Sunday from today's times;
- **17 weeks on one shift time**, where it had 16;
- **a week-to-week change of 1h 11m**, where it had 1h 20m (Short Run 1h 13m, Second Edition 1h 01m).
The last two came from a new exact model of the whole rota (`tooling/exact-rota.py`, below): four rest days moved, and
46 of the 99 duties a week changed time. In the usual league Closing Time goes from third (86.0) to **first (87.3)**, above
Second Edition (87.2) and Short Run (86.5); every version is in the table under "In every version of the league".

| | Closing Time, 27 Oct | Closing Time, 26 Oct | Short Run |
|---|---|---|---|
| Weeks on one shift time | **17 of 21** | 16 of 21 | 18 of 21 |
| Week-to-week change of start | **1h 11m** | 1h 20m | 1h 13m |
| Fit to the trains, weekday · Saturday · Sunday | 36.4 · 8.7 · **45.3** | 36.4 · 8.7 · 48.6 | 29.1 · 12.7 · 29.0 |
| Shift times (new) | 12 (3) — the twelfth is today's 08:30–16:30 | 11 (3) | 15 (6) |
| Shortest rest · heaviest week · lightest week | 14h 35m · 41h 30m · 27h 00m | the same | 14h 20m · 42h 30m · 24h 30m |
| Everything else on the sheet | the same as 26 Oct: 9 of 9 rules, no fatigue factor fixed or worst case and every value Short Run's or better (`factors-like.mjs`), 51h 30m in any seven days, 5 days in a row (up to 6), 7 weekends at most 5 weeks apart, 4 single rest days, no mixed week, block 5 (up to 7), leave 28 · 23.4 · 20 · 15, 42 finishes after 23:00, 218.6 days | | |

**What was tried, and what came of it:**

| Where | How | What it found |
|---|---|---|
| The weekday and Saturday duties | `short-earlies.mjs`'s scan, which is exhaustive: Closing Time's way of finding the minutes (16:00 every day, 13:30–22:30 the only new time, no extra late finish, one table Monday to Friday) holds exactly three whole weeks | Closing Time's fits best. The other two were built: **B** (a 13:35 every weekday and Saturday, an 11:00–19:30) reaches 18 one-turn weeks with every rule, but at a 2h 40m step, and every B rota found has a 42h 30m week — 85.0 to 85.3 in the league; **C** (a 13:45 with the 11:00–19:30) kept a mixed week and a fatigue factor on Home Grown's weeks, and the exact model found no rota for it from scratch |
| The Sunday, today's times | `final-table.mjs`, every Sunday from today's times and the 15:15 closer — 29 tables | **08:30–16:30** for 08:00–16:30: 47.6 against 50.9 on the search's own measure, 45.3 against 48.6 on the sheets'. Kept to Closing Time's own eleven times, the best is 50.2 |
| The Sunday, new times allowed | the same search, every quarter hour | one new time 36.8, two (Short Run's Sunday: 09:00–18:00, 14:30–22:30) 29.0, three 26.4 — each costs as much in familiar times as it gains in fit — measured on the 16-week rota, where the swap is clean: 86.6, 86.7 and 86.4 against its 86.8 — so none is taken; it is the owner's call if fit matters more — and on 30 Oct the owner took Short Run's, below. (On the 17-week rota the Sunday early's line, line 2, works the Monday: a 09:00–18:00 there leaves 13h 15m before its 07:15, under the rota's 14h 35m, so it would need a fresh search. On 30 Oct it went on line 7, whose Monday is a rest day, by hand) |
| The weeks: order, rest days and times | `space-polish.mjs` with the rest days free (four seeds asking for a 17th one-turn week; one each for the step, the leave and the heaviest week), then `exact-rota.py` | the polishes: a 1h 17m step and nothing else. The exact model: **17 one-turn weeks and 1h 11m** (1h 08m if it stays at 16) |
| An 18th week on one shift time | `exact-rota.py`, every rule, from the 17-week rota: 20 minutes on two cores, then 40 on four | not found; the most the solver could rule out was a 21st |
| One visible early/late switch | `exact-rota.py OBJ=chg`, climbing from the 17-week rota, then again allowing 16 weeks — Closing Time has two switches between working weeks, and each costs the step about half an hour | not found: it stays at two |
| The heaviest week under 41h 30m; four weeks off for 14 days' leave; a best stretch of 29; a shortest rest of 15h | `exact-rota.py`, each as an objective climbing from the 17-week rota with every other figure held (`OBJ=heavy`, `four`, `best`, `rest`), 10 minutes each | none found: the heaviest week stays 41h 30m, four weeks 15 days' leave, the cheapest 29 days 15, and the rests under 15h came down from seven to six but not to none, so the shortest stays 14h 35m. Four weeks for 14 days is the Long Break question: the solver has found it only with a fifth single rest day, which costs more in the league (single rest days weigh 4) than the leave gains (1) |

**Read "not found" as a search that came back empty, not a proof.** The exact model can prove a bound, and proved
nothing useful here: its upper bound never came below 20 one-turn weeks (21 is every working week). **One lesson cost an hour and is
worth keeping:** asked to require 17 one-turn weeks outright, from a rota with 16, the solver found nothing in ten
minutes on every variant tried; asked to maximise them from the same valid rota, it found 17 inside ten minutes on
every variant. A floor the starting rota does not meet leaves the solver to find its own first rota, which is the hard
part — so start from a rota that meets every rule and let the objective climb (`HINT=`, `OBJ=`).

**The exact model** (`tooling/exact-rota.py`, `pip install ortools`). It states the whole rota — which line works
which duty on which day — to Google's CP-SAT solver, with every rule the sheets apply, each counted the way the app's
own module counts it (the header lists them). `FIX=` checks a rota against it: Closing Time old and new, and Short
Run, are each feasible with their own figures. It reaches where a polish cannot, because a polish improves by small
swaps and so finds what is near where it started. Without the rules on backward rotation, FF11, leave and the step it
finds 18 one-turn weeks for Closing Time in half a minute — and that rota has FF17 present, a 3h 38m step and 16 days'
leave for four weeks, which is what those rules are there to stop. **CP-SAT's parallel search is not reproducible**:
two runs of one command differ, and so did two of its "deterministic" interleaved mode, so the grid is committed and
the commands below are how it was found, not a byte-for-byte rebuild.

**How it was found** (from `tooling/`; the 26 Oct chain above first, which ends at `/tmp/ct1.json` = `57429cc4`):

```
node -e 'const f=require("fs"),j=JSON.parse(f.readFileSync("/tmp/ct1.json","utf8"));for(const k in j.patterns)if(j.patterns[k].sun==="08:00-16:30")j.patterns[k].sun="08:30-16:30";f.writeFileSync("/tmp/ct2.json",JSON.stringify(j))'
T=results/closing-time-27oct-table.json
HINT=/tmp/ct2.json ONE_MIN=16 LIGHT=1620 OBJ=step python3 exact-rota.py $T /tmp/ct3.json 600              # 16 one-turn weeks, step 1h 08m
HINT=/tmp/ct3.json OBJ=one WORKERS=2 python3 exact-rota.py $T /tmp/ct4.json 600                           # 17, step 1h 11m
HINT=/tmp/ct4.json ONE_MIN=17 LIGHT=1620 OBJ=step WORKERS=2 python3 exact-rota.py $T /tmp/ct5.json 1200   # 17, 1h 11m: the 27 Oct grid (78e18900)
```

`LIGHT=1620` holds the lightest Monday-to-Saturday week at 27h 00m, Closing Time's own: the first step search, without
it, reached 1h 12m by letting one week fall to 25h 30m. The 08:30 Sunday would have lifted Home Grown (85.5 to 86.0) and
Both Ways (85.8 to 86.1) as they stand; neither is changed here.

**Short Run's Sunday (30 Oct 2026).** Asked which design was best with the 13:45 finish and the closer's start time set
aside (owner: "the closer being shorter is what matters, whether it is 1545 or 1600 doesn't matter"), the answer was
Closing Time by a whisker, with one real weakness: its Sunday. Hour by hour against the trains, all of the Sunday gap
to Short Run sat in three hours — five on the floor at 14:00, when the ticket office's 14:00 lates help out until 15:00
and the trains want four; three at 17:00, the busiest Sunday hour, once the 08:30–16:30 had gone home; and a little too
much at 08:00. Short Run's two Sunday times answer exactly those, so they were laid on (owner: "make the changes to
closing time"), by hand, no search needed: line 7's Sunday 07:15–15:45 became the **09:00–18:00** (its Monday is a rest
day and its Saturday a cover week, so nothing either side of it moves), line 2's 08:30–16:30 became a 07:15–15:45, and
the two Sunday office lates moved from 14:00 to **14:30–22:30**. `CT-26-T2` · **`77a235bc`**:

| | Closing Time now | Closing Time, 27 Oct | Short Run |
|---|---|---|---|
| Fit to the trains, weekday · Saturday · Sunday | 36.4 · 8.7 · **29.0** | 36.4 · 8.7 · 45.3 | 29.1 · 12.7 · 29.0 |
| Most hours in any seven days | **51h 00m** | 51h 30m | 51h 42m |
| Week-to-week change of start | **1h 10m** | 1h 11m | 1h 13m |
| Shift times (new) | 13 (5) — 09:00–18:00 and 14:30–22:30 are Short Run's | 12 (3) | 15 (6) |
| Everything else | as on 27 Oct: 17 of 21 weeks on one shift time, rest 14h 35m, 41h 30m · 27h 00m, every rule, no fatigue factor and every value Short Run's or better | | |

Searches from it (`exact-rota.py OBJ=both`, ten minutes, and the same from the 09:00–18:00 alone) found nothing more. In
the league it is first in three of the five versions and second in a fourth (until In Step, which is first in all five) — the table under "In every version of the
league" — where the 27 Oct version was first in two. Against Short Run it is better or equal on every factor the league
scores but the weekday fit (one more on the floor from 20:00 to 22:00, when it is quiet; the peaks are covered alike)
and one week on one shift time (17 against 18). **Outside the league it pays twice** (30 Oct review — this sentence said
"everything"): ten more finishes a year at 22:00 or later (104 against 94; three weekday 13:30 lates run to 22:30), and
four at the Saturday open rather than five, the rule's minimum. The 09:00–18:00 alone was tried first: Sunday 36.8 and
87.1 in the usual league, a time nobody works today costing as much as the fit it bought, until the 14:30 lates took the
Sunday the rest of the way.

```
node -e 'const f=require("fs"),j=JSON.parse(f.readFileSync("/tmp/ct5.json","utf8")),p=j.patterns;p["7"].sun="09:00-18:00";p["2"].sun="07:15-15:45";for(const k in p)if(p[k].sun==="14:00-22:30")p[k].sun="14:30-22:30";f.writeFileSync("/tmp/ct6.json",JSON.stringify(j))'
#   = closing-time.json (77a235bc), from the committed 27 Oct grid as well as from /tmp/ct5.json
FIX=closing-time.json python3 exact-rota.py results/closing-time-table.json /tmp/check.json 60     # the committed grid against the model
node factors-like.mjs short-run.json closing-time.json                                                # every value Short Run's or better
```

*(Closing Time's decks and `closing-time-decks.py` were removed later on 30 Oct, when the shortlist was cut to two; both are
in git history. What follows is the record of them.)* **Presentations (30 Oct 2026**, owner: "create the manager and colleague presentations, compare them to existing designs
and then deep review them, then run aesthetic polish over the proposal and the presentations").
`presentations/Closing-Time-for-colleagues` and `-for-managers`, built by `tooling/closing-time-decks.py` on Short Run's
decks, which share Closing Time's weeks in everything the decks say about them: the run, the weekends, the rest-day
breaks, the leave, the 42 finishes after 23:00 and the Sunday. What they say differently: the 16:00 closer Monday to
Saturday (7h 55m; today 8h 40m and 9h 10m), 13 shift times with 8 worked today, the weekday 13:30 late running to 22:30
(104 finishes a year at 22:00 or later; today 78, Short Run 94), rest 14h 35m, weeks of 27h 00m to 41h 30m, 17 weeks on
one shift time, four at the Saturday open, and the fit chart (36.4 · 8.7 · 29.0). It joined the shortlist the same day
(below), so its manager "Why" slide is the shortlist's own, and its notes say it meets two of the three flexible rules:
its brief moved the 15:45 closer to 16:00. **Checked:** `deck-check.mjs` reads its 51 table rows back against the sheets
(204 across the eight decks, none disagreeing); the validator passes both; and the shortlisted designs' decks, rebuilt
through the changed polish, are identical in every slide (only the strip's anti-aliasing and the chart workbook's
timestamps differ, so they were not re-committed). **The review changed four things.** The 13:30–22:30 is how the week
keeps a 13:45 every weekday as well as the 16:00 closer, not what pays for the closer alone (with today's times and a
16:00 closer the week has 180 minutes to spare; the 13:45s make it 145 short). The weekday fit gap left is the morning
and evening peaks as well as 20:00 to 22:00, not "mostly the evening". The trade-offs slide quotes only figures the
sheet prints, because it says it does. And two banners and a card were reworded so no line breaks inside a duration ("8h
| 30m") or a time, checked by wrapping every text box with Inter's metrics at full width and three per cent narrower.
**The proposal sheet** was reviewed page by page and left for the owner's word: what could be tidier (a part-filled row
of new-time cards on page 4, page 1's two staff panels of different heights, the closing-shift row filling its cells on
page 2) belongs to the shared renderer, and changing it re-renders all thirteen sheets, which then carry the new date
(this said they would be stamped "re-rendered"; a sheet in this folder says "Prepared" and the day it was rendered). Two
were changed the same day, below.

**Closing Time joins the shortlist (30 Oct 2026**, owner: "Can we add closing time to the shortlist? And do the
necessary work"). The shortlist is `SHORTLIST` in `tooling/fresh.mjs`, and everything else now reads it from there — the
summary's ★ and its count, the shortlist sheet, the decks' polish and the pack's read-me (the last two parse it, being
Python; each used to say "three" in its own words). **The recommendation stays Short Run**: the owner shortlisted
Closing Time and did not move the recommendation, and the shortlist sheet's own priorities — days in a row, weekends,
one shift time a week, late finishes — favour Short Run narrowly (one more week on one turn, ten fewer finishes a year
at 22:00 or later), where the weighted league favours Closing Time narrowly (87.2 against 86.5); the sheet says both.
**The shortlist sheet was rewritten for four, and every sentence it rests on is now asserted** (`shared`, `claim` in
`shortlist-sheet.mjs`): Closing Time broke two that had been true of three — all three flexible rules, every closer 30
to 45 minutes shorter — and both had been read off Second Edition alone, so they would have gone on printing for all
four. The same checks found two claims that were already wrong with three: Second Look's fourteen shift times were its
"specific advantage", and Closing Time has thirteen; and "the rest give something up for nothing the three lack" missed
Second Look, Second Nature, Second Sight and Second Wind keeping blocks of earlies or lates a week shorter. The page-2
paragraph now names what each other design keeps, and the sheet refuses to print if a design's list changes. Even Keel's
edge became a fourth person to the Saturday close (its lightest heaviest week and most rest are Closing Time's too); the
comparison table gained the weekday and Saturday closers and the 22:00 finishes, and lost the worst-case run and
Sunday's closer and fit, now shared lines, which with five value columns squeezed the labels to a word a line. **The
decks:** every manager "Why" slide now says what all four give, and its first line drops the flexible rules, since
Closing Time's brief swapped one; the colleague decks' leave notes say all four are worse than today on four weeks off.
All eight decks — two for each shortlisted design — were rebuilt and re-exported with them. **The app:** Closing Time is built into the Links
designer beside the other three from v25.01 (`links-proposals.js`, copied cell for cell from `proposals/`). *(Superseded
later the same day: the shortlist was cut to In Step and Short Run, with In Step recommended — "The shortlist cut to two",
below.)*

**The sheets tidied (30 Oct 2026**, owner: "do the necessary work and sheet tidy ups"). Two of the three were changed in
`plain.mjs`, with a third found on the way, and all thirteen sheets and the rules sheet re-rendered; `regenerate.mjs
--check` passes, so no fingerprint moved. **Page 4:** the new times to learn fill every row they start — up to three in
a row, four as two pairs, five or six three to a row, more four to a row, the last row's cards sharing its width. The
fixed grid (three columns, four for seven or eight times) had left one card beside two empty cells (Both Ways) or an
empty cell at the end (Home Grown, Closing Time and the three seven-time designs), and four across wrapped "weekdays and
Saturdays" in half of Both Ways' cards. **Page 2:** today's closing-shift triple (8h 40m · 9h 10m · 8h 55m) ran 5px into
its cell's padding on every sheet. The columns are now 27 · 18.2 · 20.3 · 34.5% (were 28 · 17 · 20 · 35), measured on
all thirteen: both triples sit about 3px inside the padding, no row re-wraps, and the floor above the footer is 26px
against the 24px minimum (34.5% is the narrowest the words column can be; at 34% Second Nature's weekends row wraps).
**Page 6, and the rules sheet:** the ticket-office rule broke "14:00–" from "22:30" at a line end on every sheet, and
the rules sheet "06:20–" from "14:20". A clock range is now one unit on both, held in a no-wrap span — not the invisible
word joiner the fractions use, which would sit inside every range a reader searches for or copies (tried first: Short
Run's PDF text carried 47 of them). A scan of every range on every page finds none broken. **The shortlist sheet**,
found in the review: its footer, four designs and a date, broke inside a name ("Closing | Time") and inside the date,
and now breaks only between its items; and its fit row, ranked on weekday plus Saturday, went bold as a whole for Second
Edition and Short Run, whose Saturday (12.7) is not the best of the four — each figure is now marked on its own, Closing
Time's 8.7 included. **Page 1 was left as it is.** Its two staff panels, and the four tiles above them, end where their
own content does by a decision of 4 October ("a card is as tall as its own content", `plain.mjs`): stretched to match,
the shorter list would carry an empty band, which reads as something missing.

**The review (30 Oct 2026**, owner: "review all work done in the last 24 hours"). Three independent reviews read the
day's work: the app change, every figure and claim against the data, and the tooling code. Every table figure in the
sheets and decks recomputed exactly, and so did every league score; what they found was in the prose, and in guards that
did not check what they said. **Fixed:** the shortlist sheet's page 1 called leave "the one exception" where page 2
lists four shared costs; two dozen of its comparing sentences were unasserted, despite its header, and several numbers
in them were typed ("two", "a seventh") — all are now asserted or read, a difference printed as a length must be
positive, and a range of closers is refused; Even Keel's and Short Run's manager decks said each "adds" something
another shortlisted design has (Even Keel's heaviest week and rest are Closing Time's too), so each line now names the
design's own edge, as the shortlist sheet does, and is refused if another design shares it; `deck-polish.py` checks its
three "all four" lines against every design's figures (`deck-check.mjs --print` now gives the rules met and the weekend
gap); `closing-time-decks.py` checks its typed shift-time lists and figures against the grid, and refuses another
design's name before its rename, where it used to scan for names after the rename had removed them; slide 12 of every
colleague deck said more people at the open and the close, which no shortlisted design has at the Sunday close, and
slide 13 quoted leave stretches the sheet does not print under a banner saying it does; the renderers' stylesheet
exclusion consumed the bracket it needed to see; `pack.py` checks the two read-me sentences that name shortlist members;
the app's proposal test could skip, and four doc lines were stale. **Left for the owner:** Closing Time's own sheet
names its late finishes after 23:00 (42, the rules' minimum) but not its 104 at 22:00 or later — every sheet counts a
late finish from 23:00, and the shortlist sheet and decks give the 22:00 figure; and the sheets word the fit as a
fraction from a fixed list ("about two-thirds" for Closing Time's 0.70, "a tenth" for 0.13) where the decks' notes say
"seven-tenths" and "an eighth" — changing the list re-renders all thirteen sheets.

## In Step — Closing Time's weeks, five at every opening and a closer fit to the trains (30 Oct 2026)

*(This section records In Step as it was made, off the shortlist. Later the same day the owner cut the shortlist to In
Step and Short Run and In Step became the recommendation, which changed its read-me paragraph, its "Why" slide and its
place in `deck-polish.py` — "The shortlist cut to two", below. Its long earlies, which this section's costs list leaves
out, are counted there too: 42 a year each over 8h 30m, where Closing Time has 2.)*

**The question** (owner, 30 Oct 2026): "Closing time can't be improved to fix the Saturday open or fit the trains better
on a weekday?" — and, once the answer turned out to be a different set of times: "Best to give this option a new name
to avoid confusion". So Closing Time is unchanged, and the answer is a design of its own: **In Step** (`IS-26-T4` ·
**`8d9239f3`**). It keeps Closing Time's weeks — the same rest days, and every week still all earlies or all lates — and
searches the times again. Five people are on at every opening from Monday to Saturday, the weekday fit to the trains is
Short Run's within a whisker, and every figure the sheets compared then holds or improves on Closing Time's except
the six small ones listed below under "What it costs" — but one they did not compare got much worse: earlies over
8h 30m, 42 a year each against Closing Time's 2 (shifts over 8h 30m, 42 against 32).

| | In Step | Closing Time | Short Run |
|---|---|---|---|
| Fit to the trains, weekday · Saturday · Sunday | **29.8** · 9.6 · 29.0 | 36.4 · **8.7** · 29.0 | 29.1 · 12.7 · 29.0 |
| On at the open, weekday · Saturday · Sunday | **5 · 5 · 4** | 5 · 4 · 4 | 5 · 5 · 4 |
| Still on at 22:00, weekday · Saturday · Sunday | 7 · 5 · 5 | 8 · 5 · 5 | 7 · 5 · 5 |
| The closer, Monday to Saturday | 15:45, 8h 10m | **16:00, 7h 55m** | 15:45 weekdays, 15:15 Saturday (8h 40m) |
| A short finish | 13:45 every weekday, 13:35 Saturday | 13:45 every weekday and Saturday | none |
| Weeks on one shift time | **18 of 21** | 17 of 21 | 18 of 21 |
| Week-to-week change of start | 1h 13m | **1h 10m** | 1h 13m |
| Heaviest · lightest week | **41h 05m** · 25h 30m | 41h 30m · **27h 00m** | 42h 30m · 24h 30m |
| Most hours in any seven days | **50h 00m** | 51h 00m | 51h 42m |
| Shortest rest | 14h 35m | 14h 35m | 14h 20m |
| Shift times (new) | 15 (6) | **13 (5)** | 15 (6) |
| A year each: finishes 22:01–22:59 · hours on duty after 20:00 | **48 · 290** | 58 · 315 | 48 · 290 |
| Everything else on the sheet | the same as Closing Time: 9 of 9 rules, no fatigue factor fixed or worst case, 5 days in a row (up to 6), 7 weekends at most 5 weeks apart, 4 single rest days, no mixed week, leave 28 · 20 · 15, 42 finishes after 23:00, 218.6 days | | |

**Why Closing Time could not do it with its own times.** Its weakness on a weekday is an extra person on the quiet
20:00–22:00 floor, and those three 13:30–22:30s are where it found its minutes: with a 16:00 closer, today's times pay
the contract with only 180 minutes a week to spare, and a 13:45 every weekday leaves the week 145 short (the arithmetic
under "Today's link on 26 lines"). The owner had already set the closer's start aside ("whether it is 1545 or 1600
doesn't matter"). A 15:45 closer is 45 minutes a day longer across the three closers, 270 a week, which pays for the
13:45 without the nine-hour lates. Kept at 16:00, the closers allow as close a weekday (29.8) on Closing Time's weeks
only by giving up the 13:45 and adding two more new shift times; with a 13:45 the weekday is 31.0 at best.

**Why five at the Saturday open had never come up.** `final-table.mjs` read the owner's "keep 06:20–14:50 x2" as
exactly two, so a third 06:20–14:50 on the floor beside the ticket office's pair was never offered, though today's
Saturday works exactly that. `FIXED_FREE=1` now allows it, and `OPENERS_MIN=5` asks for five at the open; both are off
by default, so every earlier table rebuilds as it was. Closing Time itself can have five at the Saturday open by
swapping two Saturday duties (line 2's 08:00–16:30 for an 06:20–14:50, line 20's 07:15–15:45 for the 08:00–16:30), for
2.2 points of Saturday fit (8.7 to 10.9); it would score 86.9 that way, and is not changed.

**What shaped the times.** Two of Closing Time's rules decide which tables can be worked on its weeks, and each
removed a time the plain search wanted:
- **the 14h 35m shortest rest**: an early finishing after 15:45 cannot be followed by an 06:20 start the next morning,
  so Short Run's 07:00–16:00 (14h 20m to an 06:20) became **07:00–15:45** and the longer opener **06:20–15:15**, both new;
- **no start more than two hours from the day before's (FF19)**: today's 11:00–19:30 is more than two hours from every
  other late start, so whoever works it must work it every day of a block that rest days close off, and Closing Time's
  rest days have no such blocks to give; today's **12:00–20:00**, two hours from 14:00, takes its place.

**How it was found.** `final-table.mjs` built the best weekday and Saturday table, exhaustively, on a pool of 35 shift
times (today's, the closer, and the candidates the faster `ANNEAL=1` search kept choosing), for every weekday total from
7,440 to 7,480 minutes with the Saturday paying the rest, at several rates of the familiarity penalty, with 15:45 and with
16:00 closers. Each pair of tables was laid on Closing Time's rest days and early and late weeks by `exact-rota.py`
(`SKELETON=`, `FAMILY=1`, new), which proves in seconds whether a table can be worked there and how many weeks it can
keep on one shift time. The best that can be laid is the one in the table above (7,455 a weekday, 6,825 on Saturday).
Then, with Closing Time's figures held — its FF17 margin of three, 51 hours in any seven days, its heaviest week — the
model gave it 18 weeks on one shift time, proven the most those weeks allow, and then the smallest step with those 18,
also proven:

```
POOL=06:20-13:35,06:20-13:45,06:20-14:00,06:20-14:20,06:20-14:50,07:15-15:45,08:00-16:30,08:30-16:30,12:00-20:00,13:00-21:00,13:30-21:00,13:30-22:00,14:00-22:30,14:30-22:00,14:30-23:25,13:30-22:30,13:45-22:30,14:30-22:30,14:15-22:30,14:45-22:30,06:20-15:15,06:20-15:20,13:00-22:00,12:00-21:00,06:20-14:30,15:00-22:30,07:00-15:45,07:00-15:30,07:00-15:15,06:20-14:15,12:30-20:15,12:45-20:15,12:30-20:30,12:30-21:00,15:45-23:55
COMMON="TODAY=1 AT22_STRICT=1 MID_END_MAX=1350 HI=540 NEWPEN=1 OPENERS_MIN=5"
env $COMMON CLS=weekday WK_CLOSER=15:45-23:55 CLOSERS_MAX=3 TOTAL=7455 POOL_ONLY=$POOL node final-table.mjs   # fit 30.1 on its own measure
env $COMMON CLS=sat FIXED_FREE=1 TOTAL=6825 POOL_ONLY=$POOL node final-table.mjs                             # fit 11.6 on its own measure
T=results/in-step-table.json   # the two tables, with Short Run's Sunday
LIGHT=1530 FF17=-3 H7=3060 SKELETON=closing-time.json FAMILY=1 OBJ=one python3 exact-rota.py $T /tmp/is1.json 60                       # 18, proven
ONE_MIN=18 LIGHT=1530 FF17=-3 H7=3060 SKELETON=closing-time.json FAMILY=1 HINT=/tmp/is1.json OBJ=step python3 exact-rota.py $T /tmp/is2.json 300   # 1h 13m, proven: the grid (8d9239f3)
```

As with Closing Time, CP-SAT's parallel search is not reproducible, so the grid is committed (`tooling/in-step.json`)
and `FIX=in-step.json` checks it against the model. Of the sheets' fatigue figures (`factors-like.mjs`) only FF2 is
above Closing Time's: 30 early starts in the rotation where it has 29 — Short Run's figure, and what a fifth person at
the Saturday open costs; FF2 is a standing factor, recorded and not counted.

**What it costs against Closing Time:** a Saturday fit of 9.6 against 8.7, the price of the fifth person at the open
(Short Run's is 12.7); FF2's standing count of 30 against 29, for the same reason; a sixth new shift time (15 times,
6 new, against 13 and 5 — familiar share 60% against 62%); a week-to-week change of 1h 13m against 1h 10m; a lightest
week of 25h 30m against 27h 00m, because Closing Time's rest days have a late week of three duties and the table has no
nine-hour late; and the closer starts at 15:45, a quarter of an hour longer than Closing Time's.

**What else was tried:**

| What | How | What came of it |
|---|---|---|
| Laying the new tables without Closing Time's weeks | `exact-rota.py` from Closing Time's grid as a hint, rest days free, 12 minutes each on two tables | no rota at all: a hint that does not fit the table leaves the solver to build a first rota alone |
| Short Run's 07:00–16:00, or today's 11:00–19:30 | the same tables on Closing Time's weeks | cannot be worked there (the rest and FF19, above) |
| 16:00 closers kept | the same searches with `WK_CLOSER=16:00-23:55`, with and without a 13:35 or 13:45 required (`REQUIRE=`) | a 29.8 weekday only with no short finish and eight new shift times (three-day fit 23.2); with a 13:45, a weekday of 31.0 and a three-day fit of 23.6 at best — In Step's is 22.8 |
| 19 weeks on one shift time | `FF17=-1` | possible only with Closing Time's FF17 margin given up, and not with the 25h 30m lightest week held |
| 17 weeks on one shift time | `ONE_MIN=17 OBJ=step` | a 1h 09m step; 87.9 in the usual league against 88.4 for 18 and 1h 13m |
| The rest days freed | `exact-rota.py` from In Step without `SKELETON`, 10 minutes each for the weeks on one turn and the step | neither moved |

**In the league** In Step is first in every version (usual 88.4 · proposals setting the scale 93.1 · without familiar
times 92.8 · run on the fixed rota 88.4 · six-factor 92.2). With it in the range, the usual
league reads Closing Time 87.2, Second Edition 87.1, Short Run 86.4, Even Keel 85.8: its fit is a new best, which
widens that factor's range and takes 0.05 to 0.06 off every other score, and changes no other design's place. Against the
four shortlisted designs it keeps two things none of them has, the closest fit to the trains (the three days' scores
added together) and the lightest heaviest week, and is worse than all four on nothing the shortlist sheet compares: the
only design outside the shortlist that is. Two qualifications came out of the presentations' review (below): weighted by
the days of a week, Short Run's and Second Edition's fit are a shade closer (26.7 against 26.8); and In Step has more
weekday earlies over 8h 30m than any design here, a measure the sheet does not compare. The shortlist sheet says so
in one sentence (asserted, as its others are). In Step is not on the shortlist, which is the owner's call, and the
recommendation is unchanged; it is not built into the app. Its presentations followed the same evening (below). *(Later
that evening the owner cut the shortlist to In Step and Short Run, and In Step became the recommendation and was built
into the app at v25.02 — "The shortlist cut to two", below.)*

**Two tooling fixes it needed.** The one-page summary did not fit fourteen proposals: the footer went to a second
sheet. It now prints, counts its pages and steps the scale down a point at a time until it prints on one (93% at
fourteen), and refuses to ship two. And the pack's read-me gains a paragraph for In Step, refused if In Step is ever
shortlisted, since the paragraph says it is not.

**Presentations (30 Oct 2026**, owner: "Create presentations for instep. Deep review after completion. Compare the
presentation to the one for short run, don't miss anything. Then deep aesthetic polish using screenshots").
`presentations/In-Step-for-colleagues` and `-for-managers`, built by `tooling/in-step-decks.py` on Short Run's decks. In
everything the decks say, In Step is Short Run but for five things, and the first build changed only those: the Saturday
closer starts at 15:45 like the weekday's (8h 10m, today 9h 10m), so every closing shift is 30 to 60 minutes shorter;
the shift times are as many (15, 9 worked today) but not the same — today's 13:45 kept every weekday, today's 13:35 on a
Saturday, two new weekday earlies (06:20–15:15 and 07:00–15:45, longer than any early today, which slide 6's notes now
say); the rest is 14h 35m; the weeks run from 25h 30m to 41h 05m; and the fit chart reads 29.8 · 9.6 · 29.0. In Step is
not on the shortlist, so its manager "Why" slide says what it shares with the four shortlisted links, what it adds
(today's 13:45 with five at the Saturday open, and no week over 41h 05m, both checked against all four) and what it
costs (its weekday earlies, to 8h 55m). `deck-polish.py` lists it in `OFF_SHORTLIST` and refuses a deck for a design
that is neither shortlisted nor listed there; `deck-check.mjs --print` gains the Saturday and Sunday fit, which that
check needs.

**Compared with Short Run's, part by part:** the same 107 and 80 parts, the same layout, sizes and colours on every
slide, the 26-week strip byte-for-byte Closing Time's (the same weeks), and every difference in the words one of the
five, or a sentence reworded because it read wrongly with the new name ("today or in In Step"). The first build had
dropped three things of Short Run's that are true of In Step too — slide 8's "the full list is on the slide", the reason
late finishes cannot go lower, and today's heaviest week beside In Step's — and they were put back. **Checked:**
`deck-check.mjs` reads In Step's 51 table rows back (255 across the ten decks, none disagreeing); `in-step-decks.py`
checks its typed time lists, figures and fit fractions against the grid before it builds, and refuses Short Run text,
another design's name and any "in In Step"; eight mutations, one per new guard, each stopped the build; the shortlisted
decks rebuilt through the changed polish are identical in every slide, note and chart (only their chart workbooks'
timestamps moved, so they were not re-committed); the validator passes both. **Reviewed** by a second reader working
from the grids, who found nine things. Seven were In Step's own and are fixed. The "Why" slide had claimed "the closest
fit to the trains overall", which holds only with the three days' scores added together — weighted by the days of a
week, Short Run's and Second Edition's are a shade closer (26.7 against 26.8), and on weekdays alone three of the four
are — so the slide now gives what is In Step's alone among the five, and the notes give the fit all three ways. Its
costs line had been Closing Time's (94 finishes at 22:00 or later is three of the four's too); In Step's own cost is its
longer weekday earlies — 06:20–15:15 and 07:00–15:45, about 40 a year each, where today none is over 8h 30m and no
shortlisted link has more than 20 — which now leads that line, the managers' worry list, the colleagues' trade-offs card
on new times and slide 6's notes. The times line counts the new times that shorten one of today's lates (three,
computed: "several" hid that the rest are earlies). Slide 2's "Saturdays: 1 hour" read as though Sunday's cut were the
tile's 30 minutes (it is 45), so it says "up to 1 hour"; slide 8, which lists eight lines for six new times, says where
a time recurs; and the managers' notes say In Step is not on the shortlist and what it gives up against Closing Time
(closers a quarter of an hour longer, a sixth new time, a Saturday fit of 9.6 against 8.7, a lightest week of 25h 30m
against 27h 00m). Four new checks guard those sentences, and each stopped the build when broken. The other two are not
the decks' alone. Three small points are the template's, in every deck, and were left: "about two minutes longer" is 1.4
minutes Monday to Saturday; the "weeks on one turn" label does not say what a turn is; and the managers' fatigue notes
say one sentence twice. And the sheets word In Step's fit as "three-fifths" and "a tenth" of today's where the decks say
"a little over half" and "about a seventh" (0.57 and 0.15): the fraction-list difference already left for the owner's
word. **Polish:** every slide was rendered beside Short Run's. Nothing In Step adds sits near an edge; the five lines
the wrap check flags at three per cent narrower are the template's, the same in every deck, and each breaks where it
should in the render.

## The shortlist cut to two — In Step recommended (30 Oct 2026)

*(The next day Even Step, In Step's weeks without its long earlies, joined the shortlist and became the recommendation —
"Even Step", below. This section records the two-design shortlist as it was.)*

Owner, the same evening: "Only do the shortlist for instep and short run. Deep review the links 26 pack to change
anything", then "accuracy check everything in links 26", and on which to recommend: "I need you to have a deep think
from all angles about which to recommend". `SHORTLIST` in `tooling/fresh.mjs` is `['In Step', 'Short Run']`, and a new
`RECOMMENDED` beside it names **In Step**; the shortlist sheet and the pack's read-me read both, and refuse a
recommendation that is not on the shortlist.

**Why In Step, and why only narrowly.** The two are one design in most of what a colleague feels: five days in a row on
the fixed rota (up to seven when a cover week falls badly — six until the 31 Oct ruling), seven full weekends off in 26 never more than five weeks
apart, 18 of 21 weeks on one shift time, 42 finishes a year each at 23:00 or later and 94 at 22:00 or later, the same
leave (28 · 23.4 · 20 · 15), the same 1h 13m week-to-week step, fifteen shift times with nine worked today, all nine
December rules and all three flexible ones, and the same Sunday. Where they differ, In Step has every closer Monday to
Saturday at 8h 10m where Short Run's Saturday one is 8h 40m (today 9h 10m), more even weeks, Monday to Saturday (25h 30m to 41h 05m against 24h 30m to 42h 30m), the longer shortest rest (14h 35m against 14h 20m), the better Saturday fit (9.6
against 12.7; the three days' scores added, 68.4 against 70.8), and today's 13:45 kept every weekday — 12 early finishes
before 14:00 a year each, where Short Run has none (today 26). That last is what the 26 Oct brief asked for, and Short
Run, built before it, does not have. Short Run has the fewer long days: 22 earlies a year each over 8h 30m against In
Step's 42 (20 against 40 on weekdays), Short Run's all 9h 00m and In Step's mostly 8h 45m and 8h 55m, so about 11.0
hours a year each beyond 8h 30m against 14.3; 28 shifts over 8h 30m against 42 (today 39); the closer weekday fit (29.1
against 29.8); and nothing new on a Saturday, where In Step's closer is a new time. Counted day by day across a week the
two fit the trains alike (26.7 and 26.8).

On the priorities the shortlist sheet names — days in a row, weekends, one shift time a week, late finishes and the
closing shift — the first four are level and the fifth is In Step's. In Step also leads the weighted league (usual
87.4), where Short Run is fourth on 85.4, behind Closing Time (86.2) and Second Edition (86.1) — figures since the 31 Oct
ruling, which took a point off every design but Second Look and moved none of these four; before it they were 88.4,
86.4, 87.2 and 87.1, and In Step led all five versions, where it now leads four (the last section). But the
league scores neither the closing shift nor long earlies, and In Step has the most long earlies of any design here:
weighted above about 4.3 — between the 4 the league gives single rest days and the 5 it gives late finishes — they would
put Short Run ahead of In Step (computed over the range the league itself uses: the proposals, today's link and Familiar
Nine). Weighted above about 1.35, a quarter of what late finishes get, they would put Closing Time, which has 2 a year,
first of all fourteen; it is off the shortlist by the owner's choice. So the recommendation is In Step, and the sheet
says in the same place that it is close, and which to choose if long days matter more. If the colleagues consulted say
the 8h 45m and 8h 55m weekday earlies are the thing they mind most, that is the case for Short Run.

**What changed.** *The shortlist sheet* was rewritten for two: what both share (asserted line by line), only the
measures where they differ — with four the sheets did not compare before: earlies over 8h 30m, any shift over 8h 30m,
earlies finishing before 14:00 and new times on a Saturday — each one's edge, a guide naming the strongest design
outside the shortlist for each other priority, then against today, why these two and not the other twelve (what each
other design keeps that neither has, checked design by design), the costs both share, the recommendation, and the league
weight at which it would turn, computed. *The summary* stars the two. *The presentations:* Second Edition's, Even Keel's
and Closing Time's decks (twelve files) were removed under the 3 Oct rule, with `even-keel-decks.py` and
`closing-time-decks.py`; `second-edition-decks.py` keeps only the edits Short Run's builder applies. Both remaining
pairs were rebuilt: the managers' "Why" slide says what both give, what this one adds against the other (each line
refused if the other has it) and what it costs against today; each design's managers' notes set it beside the other,
with the figures checked against the grids before a deck is built. *The pack's read-me* takes the recommendation from
`RECOMMENDED`, so its twenty-minute read is now `In-Step-for-managers.pdf`. *The app* (v25.02) builds in In Step and
Short Run only (`links-proposals.js`), and a test holds that list to `SHORTLIST`, in order; the generator's default
table is unchanged — it was always Second Edition's duty table, which is Short Run's exactly.

**The accuracy check (30 Oct 2026).** Four reviewers, working read-only and each recomputing one part of the pack from
the grids with code of their own: the shortlist sheet, summary and read-me; the four decks; this README and RULES.md;
the fourteen proposal sheets, their import files and the rules sheet. Every figure on the sheets, the summary, the rules
sheet and the decks recounted exactly, the fit scores and the league totals included, and every import file and
fingerprint matched its grid. What they found was in the words, and in one comparison in RULES.md:

- **The shortlist sheet** said Even Keel and Second Gear kept "nothing the two lack" while its own table showed them —
and Fine Tune and Home Grown — with fewer long days than either. Its "keeps" and "pays" are now read on every measure
the table compares, and the paragraph names each design's costs on the five priorities it states (Long Break's six days
in a row and Home Grown's 9h 10m Saturday closer were missing). Its recommendation said In Step's costs lay "outside
those measures" while page 1 compared them; it now names every figure where the two differ, on its side, and refuses to
print otherwise. The guide gains the fewest long days of all (Home Grown); the shared costs gain the long days; the
league paragraph says Short Run is fourth and that the league scores neither the closing shift nor long earlies; In
Step's card no longer claims five at every opening, which Short Run has too; the week figures say Monday to Saturday;
and "today's weekdays have two" to the close reads Monday to Saturday, as today's Saturday has two as well. Every new
sentence is asserted, and four of the assertions were each broken once to see the sheet refuse.

- **The decks** said the yearly figures depend on which line you start on — false on 26 weeks, where a year is exactly
two turns; Short Run's never named its own 9-hour weekday early as a cost; "about 40 a year each" was 20 each, 40 in
all; the ceiling was "agreed" on 1 October where the rest of the pack says "set"; the managers' notes each left out one
cost against the other; and two notes said one thing twice. All fixed, the costs circle on the "Why" slide is amber as
the worries are, and three new build checks were each broken once to see the build refuse.

- **The proposal sheets** said the Links page "re-runs every check here" (it re-runs the limits, the fatigue checks, the
weekends, the hours and the hourly staffing, not the December rules or the yearly figures) and that "somebody's own year
depends on which week they start on"; their date line said no figure is typed, though each tagline is; three taglines
gave Monday-to-Saturday weeks as weeks and three the fixed duties' rest as all rest; Home Grown's hid its second new
time; Second Nature's 10-week wait between weekends read as reassurance on page 2; and In Step's Saturday fit was "a
tenth" of today's where it is a seventh. All fourteen sheets were re-rendered and no fingerprint moved. The rules
sheet's floor rule gained its Sunday arrangement, and the read-me the corrections that apply to it.

- **This README and RULES.md** had moved 24-line paths (the Second Nature rebuild command among them), a "none writes
the number down" the search scripts disprove, a "24-line sheets left as they stood" the 24-line README contradicts, a
"85 duties at 8h 14m" that was Silva Lining's alone, RULES.md's app paragraph a release behind, and history that read as
current (the league placements before In Step, the four-design shortlist sheet, Closing Time's decks). Each now says
what is true or points on.

**Left for the owner — settled 31 Oct 2026.** Two questions were left here: whether full weekends off and the fit to
the trains should be shaded green while the rules sheet called them preferences "for staff to say, not the app", and
whether a cover week's Sunday is one of its four duties. The owner answered both the next day; the next section says
how, and what moved.

## A cover week's four are Monday to Saturday — the owner's two answers (31 Oct 2026)

Asked the two questions above, the owner answered: *"1. They are both positives aren't they? 2. Although people could be
rostered for rdw on a Sunday cover week. The 4 days can only be the contractual days which are Monday to saturday."*

**1 · Full weekends off and the fit to the trains are gains, so the green stays.** It was the rules sheet's wording
that was wrong. Its Preferences now say they are not rules and not scored, that the first two and the last — fewer days
in a row, more full weekends off, a closer fit to the trains — are gains a proposal sheet marks green where a design
beats today's link, and that how much each matters is for staff to say. Page 2's colour key now counts "a plain gain
such as full weekends off or the fit to the trains" among what green means (the read-me's, short of room, "a plain gain
such as full weekends off"), which is what those rows — and the leave and closing-shift rows — were already shaded
for. No shading changed.

**2 · The four are contracted days, Monday to Saturday; the Sunday is overtime on top.** The app's own rules said so
already (`.claude/rules/links-design.md`: "a spare week's four days come from Mon–Sat"); its run checks did not, and let
one of the four fall on the Sunday. They now count a cover week's Sunday as worked in the worst case without spending the
four (`spareDrawsOnFour`, app v25.03), FF11 included, and the cover-placement reading here follows: the four as a block
from Monday, Tuesday or Wednesday, the Sunday worked at worst and left off at best. What moved, all computed and no
fingerprint among them:

- **Most days in a row at worst: 6 → 7 on thirteen of the fourteen designs, both shortlisted ones included.** A line
ending on two worked days, then the Sunday's overtime and the four from the Monday. Second Look alone stays at 6. The
fixed rota is unchanged (In Step and Short Run 5), today's link stays at 9, and the 13-day limit is met everywhere.
- **FF11, the longest stretch without a two-day break: one more everywhere** — 12 on the designs (Second Nature 11), 13 on
today's link; clear throughout, the factor being *more than* 13. The two MRSF run rows move by one too (13 designs on the
12-day row, ten on the 8-hour one) and stay clear.
- **The 55-hour row's worst case crosses 55 on thirteen designs** (55.7–57.5; In Step 56.3, Short Run 56.8), with the
four and the Sunday's overtime worked as 8-hour duties after a busy line; before, none passed 53.5. Those sheets now say
avoidable fatigue warnings are 0 on the fixed rota, **up to 1** if a cover week falls badly. Second Look stays at 52.2.
- **Where the clerk places the four, and whether the Sunday is worked, moves FF11 from 9 to 12** on both shortlisted
designs: worked together with the Sunday off gives the 9. Page 7 and page 8 used to set "worked together" (9) against
"spread out" (11); with the Sunday worked the four together reach the app's 12 as well, so the sheets now give the worst
and say what the best takes.
- **The league:** usual In Step 87.4, Closing Time 86.2, Second Edition 86.1, Short Run 85.4 — each loses one point on the
run, as does every design but Second Look, so the order holds except that Second Look and Second Wind swap 12th and 13th.
The other versions: proposals setting the scale, In Step first (90.0); without familiar times, first (91.7); run on the
fixed rota, unchanged and first (88.4). **In the six-factor league Second Look is now first, 88.3 to In Step's 87.2**: it
gives the run 5 points scored across the proposals alone, and Second Look's six is now nobody else's. So In Step leads
four of the five versions, not all five. The long-early weights at which the order would turn are unchanged, since In
Step, Short Run and Closing Time each lost the same point, and **the recommendation stands**.
- **The live rosters in the app:** the main cycle stays at 9 days in a row and FF11 goes 12 → 13; the bilingual goes 8 → 9,
its two cover weeks wrapping into each other through the second's Sunday.
- **In the app**, the shortlisted proposals' Design checks now read 7 consecutive days at worst, over the 6-day design
target, so that row is amber where it was green — an aim, not a limit, as the row itself says.

**Found on the way, and fixed.** The cover-placement reading turned a placed cover week into typed sentinel duties,
which the app's scanners could not tell from real ones — so a cover week alone could make a run, against the app's own
rule that it may extend a run but not create one. While the four could include the Sunday that run was four, which no
threshold here exceeds; with the Sunday worked it is five early starts, over FF15's four, on designs whose early starts
never run past four. A placement now keeps its worked days SPARE and the app's own `requireMatch` applies.

**What changed.** The app: `links-design.js` (`spareDrawsOnFour`, used by `runLengthsWhere`), `links-fatigue.js` (FF11,
and one shared sentence for what a cover week adds), `links-limits.js` and `links-analysis.js` (what a cover week is,
in words), the tests (two new, four mutations each caught) and the rules file. The tooling: `cover-placement.mjs`,
`report-data.mjs` (`h55Worst`, which `fresh.mjs` now calls rather than keeping a copy), `fresh.mjs`, `render.mjs`,
`plain.mjs`, `rules-sheet.mjs`, `summary-sheet.mjs`, `shortlist-sheet.mjs` (its run claim, Second Look's new edge, and a
worst-case fatigue count that now includes the 55-hour week, as every other sheet's "up to" does — it had said "no
avoidable fatigue warning" beside the summary's "up to 1"), the two deck builders, `deck-polish.py` and `deck-check.mjs`
(the decks' fatigue cells now read "0 (up to 1)", the managers' "Why" line says "no avoidable fatigue warning, fixed
rota", and the notes to the fatigue slides say what the 1 is, refused if it is ever anything but the 55-hour week) and
`pack.py`; every sheet, all four decks and the pack re-rendered.

## Even Step — In Step's weeks, nothing over 8h 30m Monday to Saturday, recommended (31 Oct 2026)

**The question** (owner, 31 Oct 2026): "The only unpopular thing I see about instep is the length of the main early
shift. I will find that hard to sell to colleagues. What are the possible solutions? Deep think". Three answers were
tested on In Step's own weeks. Of the third, which brought the closer back to 15:30: "1530 closer is not a big enough
change from 1515. 1545 is the minimum", and then "Only for weekdays". Of the first: "Do your suggestions", which meant
build it as In Step was built, recommend it and put it to colleagues next to In Step. The owner named it **Even Step**
(`ES-26-T5` · **`d1921b7a`**). Asked whether Short Run should stay on the shortlist: "Yes, keep all three".

**Why In Step has long earlies.** The 26-line rules need 44,100 Monday-to-Saturday minutes a week, and the 219-day
ceiling allows at most 89 duties, so every 26-line design's average duty is 8h 16m (today's link: 8h 14m). The long day
cannot be removed, only moved between duties. Today it sits on the closers, 8h 40m every weekday and 9h 10m on a
Saturday: 31 shifts a year each over 8h 30m, and no early over it. In Step moved it to the earlies. Its closers are
8h 10m, its floor lates 8h 00m and a 13:45 stays every weekday, and four long earlies a day pay for that: 06:20–15:15
(8h 55m) and 07:00–15:45 (8h 45m), 40 a year each. No rule forced them; the search chose them for a slightly closer fit
to the trains.

**What it is.** In Step's duty table with five time changes, laid again on In Step's own weeks: the same rest days, cover
weeks and early and late weeks, line by line (`even-step-decks.py` checks that against the grids before it builds). The
changes are to the table — what is worked each day; the rota placed the times afresh, so most lines' weeks read
differently from In Step's (only one of the 21 working lines is unchanged, and 14 of the 21 closers fall on other
line-days).

| In Step | Even Step | How many |
|---|---|---|
| 06:20–15:15 (8h 55m) | 06:20–14:50 (8h 30m) | 2 each weekday |
| 07:00–15:45 (8h 45m) | 07:15–15:45 (8h 30m) | 2 each weekday |
| 14:30–22:30 (8h 00m) | 14:00–22:30 (8h 30m), beside the office pair's own two | 2 each weekday |
| 12:00–20:00 (8h 00m) | 12:15–20:30 (8h 15m) | 1 each weekday |
| 06:20–13:35, Saturday | 06:20–14:00, Saturday | 1 |

The table's closers and Sunday duties are In Step's exactly. Every early Monday to Saturday is now one of today's times
(06:20–13:45, 06:20–14:00, 06:20–14:20, 06:20–14:50, 07:15–15:45, 08:00–16:30) — though 06:20–14:50 and 07:15–15:45,
worked on Even Step's weekdays, are worked today only on a Saturday and a Sunday — and the 13:45 stays every weekday. Five
times are new: the 15:45 closer, the 12:15–20:30, and the Sunday's three, which all three shortlisted designs share. The
time In Step put on its earlies (15 and 25 minutes over 8h 30m) is on Even Step's lates instead: they average 8h 27m,
closers aside, near today's 8h 30m, where In Step's average 8h 12m. That is the trade: for the floor lates it gives up the owner's v21.10 preference
for lates shorter than most earlies (lates are the turns booked around and refused), which the closers, at 8h 10m, keep.

| | Even Step | In Step | Short Run |
|---|---|---|---|
| Shifts over 8h 30m, Monday to Saturday, each a year (today 31) | **0** | 40 | 26 |
| Earlies over 8h 30m, Monday to Saturday, each a year (today 0) | **0** | 40 | 20 |
| Weekday lates, closers aside, on average (today 8h 30m) | 8h 27m | 8h 12m | **8h 00m** |
| Fit to the trains, weekday · Saturday · Sunday | 32.6 · 10.0 · 29.0 | 29.8 · **9.6** · 29.0 | **29.1** · 12.7 · 29.0 |
| Week-to-week change of start | 1h 31m | **1h 13m** | **1h 13m** |
| Heaviest · lightest week, Monday to Saturday | 41h 30m · **25h 30m** | **41h 05m** · **25h 30m** | 42h 30m · 24h 30m |
| Shortest rest | **14h 35m** | **14h 35m** | 14h 20m |
| The closer, Monday to Saturday | **15:45, 8h 10m** | **15:45, 8h 10m** | 15:45 weekdays, 15:15 Saturday (8h 40m) |
| Earlies finishing before 14:00, each a year (today 26) | 10 | **12** | 0 |
| Shift times (new) | **13 (5)** | 15 (6) | 15 (6) |
| The 55-hour week a badly placed cover week can make | 56.8 | **56.3** | 56.8 |
| Everything else on the sheet | the same on all three: 9 of 9 rules and all three flexible ones, no fatigue factor on the fixed rota (up to 1 at worst, the 55-hour week), 5 days in a row (up to 7), 7 weekends at most 5 weeks apart, 4 single rest days, no mixed week, 18 of 21 weeks on one shift time, leave 28 · 23.4 · 20 · 15, 42 finishes after 23:00 and 94 at 22:00 or later, 218.6 days | | |

On the fatigue factors (`factors-like.mjs`, In Step as the reference) every finding is In Step's; the figures differ in
four places: the 55-hour worst case (56.8 against 56.3), the hours in any seven days on the fixed duties (49.7 against
50.0), FF17's counts (9 backward and 12 forward against 10 and 13, the same margin of three) and FF18's step, how far
the start time moves from one week to the next (typically 1h 31m against 1h 13m).

**How it was found.** `final-table.mjs`, exhaustively, on a pool of 45 shift times: In Step's, with every time over 8h 30m
left out (`HI=510`), no late starting between 11:00 and 11:59 (on these weeks a start there is more than two hours from
the 14:00 lates beside it, FF19, as In Step's section found for 11:00–19:30) and no closer before 15:45. The two tables
reproduce exactly:

```
POOL=06:20-13:35,06:20-13:45,06:20-14:00,06:20-14:20,06:20-14:50,07:15-15:45,08:00-16:30,08:30-16:30,12:00-20:00,13:00-21:00,13:30-21:00,13:30-22:00,14:00-22:30,14:30-22:00,14:30-22:30,14:15-22:30,14:45-22:30,06:20-14:30,15:00-22:30,07:00-15:30,07:00-15:15,06:20-14:15,12:30-20:15,12:45-20:15,12:30-20:30,12:30-21:00,15:45-23:55,06:20-14:45,07:00-15:00,07:30-16:00,07:45-16:15,08:00-16:15,12:00-20:15,12:00-20:30,12:15-20:30,12:15-20:45,12:30-20:45,13:00-21:15,13:00-21:30,13:15-21:30,13:15-21:45,13:30-21:45,14:00-22:15,14:15-22:15,16:00-23:55
COMMON="TODAY=1 AT22_STRICT=1 MID_END_MAX=1350 HI=510 NEWPEN=1 OPENERS_MIN=5"
env $COMMON CLS=weekday WK_CLOSER=15:45-23:55 CLOSERS_MAX=3 FIXED_FREE=1 REQUIRE='06:20-13:45|06:20-13:35' TOTAL=7450 POOL_ONLY=$POOL node final-table.mjs   # fit 32.9 on its own measure
env $COMMON CLS=sat FIXED_FREE=1 TOTAL=6850 POOL_ONLY=$POOL node final-table.mjs                                                                       # fit 12 on its own measure
T=results/even-step-table.json   # the two tables, with In Step's Sunday
LIGHT=1530 FF17=-3 H7=3060 SKELETON=closing-time.json FAMILY=1 OBJ=one python3 exact-rota.py $T /tmp/es1.json 120                         # 18, proven
ONE_MIN=18 LIGHT=1530 FF17=-3 H7=3060 SKELETON=closing-time.json FAMILY=1 HINT=/tmp/es1.json OBJ=step python3 exact-rota.py $T /tmp/es2.json 300   # 1h 31m, proven: the grid (d1921b7a)
```

The weekday totals from 7,400 to 7,500 minutes, in fives, were each searched with the Saturday paying the rest, and the
tables ranked on the sheets' own fit (`report-data.mjs`'s `officeSplit`, the plan's ticket office), which differs a
little from `final-table.mjs`'s own. The closest pairs were laid on In Step's weeks (`SKELETON=closing-time.json
FAMILY=1`, which holds Closing Time's rest days and early and late weeks, In Step's too) under the limits In Step was laid
under — an FF17 margin of three, at most 51 hours in any seven days (Closing Time's figure; In Step's is 50.0), a lightest
week of at least 25h 30m. Only 7,450 a weekday with 6,850 on Saturday
kept In Step's 18 weeks on one shift time (7,435 and 7,445 kept 17, both proven), and with those 18 the smallest step is
1h 31m, also proven. CP-SAT's parallel search is not
reproducible, so the grid is committed (`tooling/even-step.json`) and
`FIX=even-step.json ONE_MIN=18 OBJ=step … exact-rota.py results/even-step-table.json` checks it against the model
(OPTIMAL, 1h 31m, in under a second).

**What else was tried:**

| What | What came of it |
|---|---|
| Halfway: only 06:20–15:15 goes, 07:00–15:45 stays | a closer fit (30.2 · 10.0) and a 1h 15m step, but still 20 long earlies a year each and 17 weeks on one shift time; 86.0 in the usual league |
| The closer back to 15:30, every day (8h 25m) | the best fit of the three answers (29.3 · 9.9) and 18 weeks on one shift time, with no long earlies, for a 42h 30m heaviest week; ruled out by the owner, 15:30 being too close to today's 15:15 |
| The first two answers as first built, with a 15:30 Saturday closer | allowed again once the minimum was weekdays only, but they scored lower (85.6 to 85.9) |
| A smaller step | 1h 10m, smaller than In Step's, with 17 weeks on one shift time; 86.4 against 86.6, not shipped |
| Moving the minutes to Saturday | each weekday minute costs five Saturday ones: 35 a weekday takes the Saturday fit from 9.6 to 12.6 |
| More, shorter duties | one more duty a week is two more contracted days a year for everyone, over the 219 ceiling |
| Four or six cover weeks | the average duty still comes out at about 8h 15m |

**The closer rule, reworded** (F3, `RULES.md`). It read "every weekday closer starts at 15:45", and the check behind it
accepted exactly 15:45, which flagged Closing Time's 16:00, a closer the owner had already accepted ("whether it is 1545
or 1600 doesn't matter"). It now reads **15:45 or later, on a weekday**: `report-data.mjs`'s flexible rule, the rules
sheet and `links-default-targets.test.mjs` (mutated to 15:30 to see it fail) all say so, and Closing Time meets all three
flexible rules. Saturday's closer is not covered, so Short Run's 15:15 Saturday closer stands. The decks' managers' notes
and the pack's read-me say "15:45 or later" too, and no proposal sheet's figure moved.

**In the league, as it was weighted when Even Step was built** (`OLD_READINGS=1` now; since *The league reweighted*,
below, Even Step is first in the main league) Even Step is second in four of the five versions: usual 86.6 behind In
Step's 87.4; with the proposals setting the scale 87.9 against 90.1; without familiar times 90.7 against 91.7; with the
run scored on the fixed rota 87.6 against 88.4. In the six-factor league it is third, 85.8, behind Second Look (88.3)
and In Step (87.2), a shade ahead of six designs tied at 85.7, Second Edition and Short Run among them. Adding it moved
no other design's score in the usual league. That weighting scored neither the closing shift nor long days, and Even
Step's weekday fit and step were where it lost its point: counted even as lightly as the league's lightest factor, In Step's
long earlies would put Even Step first of all fifteen (`shortlist-sheet.mjs` computed the weight at which the order
turns, from the league's own range, until the league counted long earlies itself).

**The shortlist of three, Even Step recommended.** `SHORTLIST` in `tooling/fresh.mjs` is `['Even Step', 'In Step',
'Short Run']` and `RECOMMENDED` is Even Step. The case, as the shortlist sheet puts it: In Step's weeks without the long
earlies. On what weighs most here the three are level (days in a row, weekends, weeks on one shift time, late finishes,
the leave); Even Step has In Step's closers, and Monday to Saturday no shift over 8h 30m and every early one of today's times,
and the fewest shift times of the three; its costs are the longest weekday lates of the three, the weakest weekday fit,
the biggest step and, as on In Step, a new Saturday time (the closer). With the owner's worry being the long earlies, the consultation
becomes one question about the same weeks: long earlies and short lates, or nothing over 8h 30m? If colleagues say the
lates are what they mind, In Step stands; Short Run has the shortest weekday lates and the closest weekday fit, for an
8h 40m Saturday closer and heavier weeks.

**What changed.** *The proposal sheet* (`proposals/Even-Step-ES-26-T5-d1921b7a.pdf`, with its grid and import file),
from `tooling/even-step.json` and `even-step.meta.json` through `regenerate.mjs`; `fresh.mjs` gives its strap, family and
date. *The shortlist sheet* was rewritten for three: the measures where they differ now include the weekday lates on
average (In Step's card had said "lates from 8h 00m", which made it look the short-lates design while Short Run's are
shorter, 8h 00m on average with a 7h 30m late; caught in this release's own review, and the card, the guide and the
choices were corrected, each asserted); each one's edge; the guide; the recommendation, every figure in its place
(asserted row by row); and the league's turning weight (since replaced by both weightings' orders, asserted —
*The league reweighted*). *The summary* stars three. *The rules sheet* and `RULES.md` carry
the reworded closer rule. *The presentations* (below). *The pack's read-me* gains a paragraph for Even Step, refused unless
it is shortlisted and recommended, and its twenty-minute read is now `Even-Step-for-managers.pdf`. *The app* (v25.04)
builds in Even Step first, then In Step and Short Run (`links-proposals.js`), and a test now holds the first to
`RECOMMENDED` as well as the list to `SHORTLIST`; the shortlist e2e opens Even Step.

**Presentations (31 Oct 2026).** `presentations/Even-Step-for-colleagues` and `-for-managers`, built by
`tooling/even-step-decks.py` on In Step's decks (Second Edition's, Short Run's and In Step's edits, then its own). In
everything the decks say, Even Step is In Step but for: the shift times (13, 8 worked today, 5 new; the lists on slide
8, the pitch tile, the trade-offs card, the table on slide 14), nothing over 8h 30m Monday to Saturday (the pitch line,
slide 6's takeaway and notes, the managers' welcome list), the weekly range (to 41h 30m), the fit chart (32.6 · 10.0 ·
29.0) and the 55-hour worst case (56.8). Its managers' "Why" slide gives what all three give, what Even Step adds — no
shift over 8h 30m Monday to Saturday and every early one of today's times, checked against both others — and what it
costs against today (two more Saturdays a year each, and the leave); its notes set it beside both others, the lates
first. The builder refuses In Step's own facts if any survive (its earlies, its times, its week, its fit) and any
sentence of In Step's builder that still names In Step, and it checks every typed figure against the grids first,
including that Even Step's weeks are In Step's, line by line. *In Step's and Short Run's decks* were rebuilt for a
shortlist of three: "all three shortlisted" on the "Why" slide; each one's "adds" line rewritten for what is still its own
among three (In Step's today's 13:45 and 8h 10m Saturday closer are Even Step's too, so it now gives its lightest heaviest
week and its Saturday fit; Short Run's "half the long earlies" is not true beside Even Step's none, so it gives its
weekday fit and nothing new on a Saturday); each design's managers' notes set it beside both others, the lates included,
and each builder checks the new figures. `deck-polish.py` now handles a design whose shifts Monday to Saturday all sit
within today's longest early (slide 6 says so rather than "the longest early turn goes from 8h 30m to 9h 00m", true only
of the Sunday 09:00–18:00), and a costs line for a design with no long earlies. **Checked:** `deck-check.mjs` reads 153
table rows back across the six decks, none disagreeing; the validator passes all six; every slide Even Step changes was
rendered and read, and two takeaways that broke a duration across a line ("8h" / "30m") were fixed with a no-break space
and a shorter line. In Step's and Short Run's decks differ from the committed ones only in those lines and in the
template's wording of the closer rule, now "15:45 or later". **Reviewed** by a second reader recomputing from the grids,
who confirmed the figures and found eleven things in the words, all fixed: a slide-6 note that said nothing else gets
longer, where the other shifts must (four of seven weekday earlies are 8h 30m, today two of six); "every early is one of
today's times" without "Monday to Saturday" (the Sunday 09:00–18:00 is a new early); known times that today are worked on
other days, now named; the shortlist's one-turn line, which set the combined measure (one time and no switch) against
"one shift time" alone; "the fewest shift times", "the best Saturday fit" and "the shortest lates" without "of the three"
or "weekday"; In Step's "light weeks", now "steady hours" (its weekly range is the narrowest; its lightest week is not
the lightest); Short Run's long shifts counted
with the Sunday where every other figure is Monday to Saturday; "pairs or longer" where every other break is two days;
and in this section the "five time changes", which are the table's, not the rota's. Each new sentence on the sheet is
asserted, and each in the decks checked against the grids. It also found one fault that predates this release, from
v25.03: fourteen of the fifteen proposal sheets printed nine pages, their footers counting eight. Page 7 ran 133px past
the A4 page because the 55-hour row's worst case had been spelt out in full ("if a cover week is worked as four 8-hour
duties and a Sunday's overtime"), which widened its column and wrapped every pattern title. It now reads as every other
row's worst case does ("if a cover week falls badly"; the notes beneath the table say how it is made), all fifteen print
eight pages again, and `render.mjs` refuses to print a page taller than the sheet (shown to refuse the long form: page 7,
1,165px against 1,032).

## The league reweighted — long earlies and the closing shift counted, the old weighting kept (31 Oct 2026)

The owner asked "Are we weighting correctly in the tables?", then "Use your weights and fix the league", and then "Keep
the old leagues as alternatives, but this should now be the main one". **Why it needed fixing.** Weighted as it was, 74
of the league's 100 points went to factors on which the three shortlisted designs score exactly the same, and neither of
the two things that decide between them scored at all: the length of the earlies (the owner's worry about In Step) and
the closing shift (the shortlist sheet's own priority, and the shift the colleague decks call the one people dislike
most). The three were ordered by margins under a point on the 26 points left — fit, shortest rest, step, heaviest week,
familiar times — and the shortlist sheet had to work out, outside the league, the weight at which long earlies would
turn its order.

**Four changes** (`league.mjs`'s header has the reasoning beside the code):

| | What | Weight |
|---|---|---|
| Long earlies | earlies over 8h 30m, Monday to Saturday, a year each — the shortlist sheet's own count, which it asserts equal for all fifteen designs | 5, as late finishes |
| The closing shift | the average length of the Monday-to-Saturday closing duties, weighted by how many are worked | 3 |
| The fit by days | the weekday's fit counted five times, as five days of the week. It was the mean of the three day types, so a Saturday counted as much as five weekdays | fit's 11, unchanged |
| The 55-hour cover week | counted in the fatigue worst case, as every sheet's "up to 1" counts it; the league had scored it as nothing, under a label that says worst case | fatigue's 11, unchanged |

The other weights are unchanged. The two new ones take the total to 108, and every weight is rescaled to 100, as `DROP=`
does (rules met 25 becomes 23.1, and so on). The league counts long EARLIES, not every long shift: today's long shifts
are its 8h 45m closers, which every design shortens and the closing-shift factor scores. What the new readings give:
long earlies a year each, none on Even Step, Closing Time and Home Grown (or today's link), 10 on Even Keel, Fine Tune
and Second Gear, 20 on the six on Second Nature's duty table and on Second Look, 26 on Both Ways, 32.5 on Familiar Nine
and 40 on In Step; closing shifts from 7h 55m (Closing Time, Both Ways) to 8h 16m (Even Keel, Fine Tune, Second Gear,
Familiar Nine), In Step and Even Step 8h 10m, today 8h 45m; and a 55-hour week possible with a cover week placed badly
on every design but Second Look, whose worst week is 52.2 hours.

**The main league** (`REF_IN_RANGE=1 node league.mjs`), and the same table weighted as before (`OLD_READINGS=1`):

| Design | Main league | Weighted as before |
|---|---|---|
| ★ Even Step | **1st · 84.0** | 2nd · 86.6 |
| Closing Time | 2nd · 83.8 | 3rd · 86.2 |
| Home Grown | 3rd · 82.5 | 8th · 84.5 |
| Second Edition | 4th · 81.5 | 4th · 86.1 |
| Even Keel | 5th · 81.4 | 6th · 84.8 |
| Both Ways | 6th · 81.3 | 7th · 84.7 |
| ★ Short Run | 7th · 80.9 | 5th · 85.4 |
| ★ In Step | 8th · 80.5 | **1st · 87.4** |
| Fine Tune | 9th · 80.5 | 10th · 83.8 |
| Long Break | 10th · 79.9 | 9th · 84.3 |
| Second Gear | 11th · 79.8 | 11th · 83.1 |
| Second Look | 12th · 79.7 | 13th · 81.9 |
| Second Sight | 13th · 78.5 | 12th · 82.8 |
| Second Wind | 14th · 77.2 | 14th · 81.4 |
| Second Nature | 15th · 72.5 | 15th · 76.4 |

★ shortlisted. In Step's 80.51 and Fine Tune's 80.49 round alike. Unranked, for reference: Familiar Nine 71.9 (77.1
before), today's link 19.4 (16.0).

**What moved it.** Even Step goes first, a fifth of a point ahead of Closing Time. Of the factors the two differ on, it
gains 0.8 on the fit by days and 0.5 on weeks on one shift time, and loses 0.8 on the closing shift (Closing Time's
closers are 7h 55m against its 8h 10m) and 0.3 on the step. In Step goes from first to eighth: with the most long
earlies of any design, 40 a year each, it scores none of their 4.6 points, which Even Step scores in full and Short Run
half of. Home Grown, with no long earlies and the shortest closers after Closing Time and Both Ways, rises from eighth to
third, although its fit by days is the weakest of all fifteen. The recommendation does not change: Even Step was
recommended for what a colleague feels, before the league counted it, and the league now agrees.

**Every version, both ways** — the versions of *In every version of the league*, above:

| Main league | Usual | Proposals set the scale | Without familiar times | Run on the fixed rota | Six-factor |
|---|---|---|---|---|---|
| Even Step | **1st · 84.0** | 2nd · 75.2 | **1st · 87.5** | **1st · 84.9** | 12th · 62.9 |
| In Step | 8th · 80.5 | 3rd · 74.0 | 8th · 84.1 | 7th · 81.4 | 8th · 67.1 |
| Short Run | 7th · 80.9 | 6th · 71.5 | 6th · 84.5 | 6th · 81.8 | tied 2nd · 67.2 |
| first | Even Step 84.0 | Second Look 75.5 | Even Step 87.5 | Even Step 84.9 | Second Look 90.4 |

| Weighted as before | Usual | Proposals set the scale | Without familiar times | Run on the fixed rota | Six-factor |
|---|---|---|---|---|---|
| Even Step | 2nd · 86.6 | 2nd · 87.9 | 2nd · 90.7 | 2nd · 87.6 | 3rd · 85.8 |
| In Step | **1st · 87.4** | **1st · 90.1** | **1st · 91.7** | **1st · 88.4** | 2nd · 87.2 |
| Short Run | 5th · 85.4 | 5th · 84.7 | 6th · 89.6 | 4th · 86.4 | tied 4th · 85.7 |
| first | In Step 87.4 | In Step 90.1 | In Step 91.7 | In Step 88.4 | Second Look 88.3 |

**Where Second Look leads, and why.** It is the one design whose worst case has no 55-hour week, and the two versions in
which only the proposals set the scale have nothing between that one warning and none: Second Look takes the whole
fatigue weight and every other design nothing. That is 10.2 points where the proposals set the scale — Second Look 75.5,
Even Step 75.2 — and 20 in the six-factor league, where Second Look scores 90.4 and the next six tie on 67.2 (Second
Nature, Second Wind, Second Sight, Second Edition, Short Run, Long Break), In Step 67.1 and Even Step 62.9. With today's
link in the range, as in the usual table, the same difference is worth 2.0. The difference is real — Second Look's
worst week is 52.2 hours, every other design's 55.7 to 57.5 — but a scale with nothing else in it turns one warning into
a fifth of the league. The six-factor league weighted as before is how the 24-line work read it: there Second Look is
first on 88.3, In Step second on 87.2 and Even Step third on 85.8, a shade ahead of six tied on 85.7.

**The shortlist sheet** runs both. Its claims assert the main league's order (Even Step first, under a point ahead of
Closing Time; Short Run seventh, In Step eighth) and the one before it (In Step first, under a point ahead of Even
Step), that only the main league counts long earlies and the closing shift, and that its long earlies are the sheet's
own count for every design; `league.mjs`'s JSON now says which weighting it holds (`oldReadings`), and the sheet refuses
the wrong one. The turning-weight sum is gone, since the league counts long earlies itself. Its paragraph now reads:
"In the pack's weighted league (the owner's weights, which count long earlies and the closing shift since 31 October)
Even Step is first of the fifteen, on 84.0, just ahead of Closing Time (83.8); Short Run is seventh and In Step eighth.
Weighted as it was before, In Step led, under a point ahead of Even Step (87.4 against 86.6)."

**Changed:** `league.mjs` (the four readings; `OLD_READINGS=1`; `oldReadings` in the JSON; a first line saying which
weighting is printed); `shortlist-sheet.mjs` and `links-26-shortlist.pdf`; this README (the note at the top, the tooling
row, the dates on Even Step's league paragraph); the pack, rebuilt. No proposal sheet, deck, summary or app file reads the
league, so none changed; the scores in earlier sections are the weighting they were written with, and
`OLD_READINGS=1` rebuilds them.

## The accuracy and consistency review — sheets, shortlist and decks (31 Oct 2026)

Owner: *"look at all the proposals and presentations and check for accuracy and consistency, using screenshots for
aesthetic polish on all"*, and *"redo the shortlist and comparison sheet"*. Four independent reviews read the fifteen
sheets, the shortlist, the rules and the six decks against the grids. Everything below was fixed at its source, and
every new figure is computed or asserted, never typed.

**The proposal sheets (all fifteen re-rendered).**
- Page 2 gains **"Shifts over 8h 30m, Mon–Sat"** under *Each person's year* (Even Step 0, today 31). It was the measure
  that separates the shortlist, and it appeared only in a hand-typed description. Page 1 names it as a gain or a concern.
  A gain ranks just after the closing shifts: page 1 shows five positives, two of them pinned (the shortest rest and the
  fatigue count, owner), so it takes the last open place only where the closers do not. A concern is never capped.
- Wording: "four complete weeks **in a row**", "(today **up to** 7)" for the weekend gap, the cover-week run row, the
  55-hour row's 8-hour-duty assumption, and the fingerprint described as worked out.
- Three wrapped rows were tightened so page 2 fits every sheet. The renderer still refuses a page that spills.
- Second Nature's one-line description says "three to the close", not "the closing rule".
- `regenerate.mjs`'s straps had drifted from the printed ones (fresh.mjs `STRAPS`) in six places. They now match, and a
  drifted one fails the run (mutated: it does).

**The shortlist sheet, redone.** Page 1's shared list now holds only what is level with or better than today. The longer
blocks (5 weeks, up to 7; today 2, up to 3) and the lost three- and four-day breaks (today five of 17, about 13 a year
each) moved to page 2's shared costs, each asserted. Even Step's edge is "no long days, **Monday to Saturday**", since its
Sunday early is 9 hours. The Leave cost says what 14 days buys and carries the three figures the "against today" table
used to repeat. Short Run's new times are spelled out, Second Sight's fifth single rest day is named and asserted, and
the choice guide gives Short Run's long earlies as "20 a year each over 8h 30m".

**The decks (all six rebuilt).**
- **Pay, slide 5.** The takeaway said "plus about two more Saturdays at time and a quarter" and nothing about the Sundays.
  It now gives both, computed from the grids with the Pay Calculator's own rate and premiums (`paycalc-calc.js`). The
  line is refused unless the Sundays outweigh the Saturdays (mutated: it is). The notes show the sum, each figure to one
  decimal so the subtraction on the page checks:

  | Each person, a year | Saturday hours | Sunday hours | Saturday premium | Sunday overtime | Net, full share of Sundays |
  |---|---|---|---|---|---|
  | Today | 213.2 | 177.4 | | | |
  | Even Step | 228.3 | 167.0 | +3.8 h | −15.7 h | −11.9 h, about £250 |
  | In Step | 227.5 | 167.0 | +3.6 h | −15.7 h | −12.1 h, about £250 |
  | Short Run | 230.0 | 167.0 | +4.2 h | −15.7 h | −11.5 h, about £250 |

- **Notes.** Slide 3 names all nine rules (the handovers and the 8–9-hour Sundays were missing). Slide 8 says which
  known times move day, generated for In Step and Short Run; Even Step's typed sentence is checked against the same
  computation (mutated: it fails). Slide 9 says the breaks as they are: two days and four single days, none longer; today
  five of three or four days. It also gives today's one-shift-time count beside the design's.
- **Slide 9's row** is "Weeks on one shift time, Monday to Friday". "No early–late switch" was true of all 21 weeks, not
  the 18 counted.
- **Slide 10's strip** draws one bar per full weekend, with a gap where two meet (`rota-strip.mjs`). The 4 Oct merge
  showed seven weekends as fewer bars, and the note admitting that is gone.
- **Slide 13's new-times card** names every new time, including the Sunday 09:00–18:00. A new time of no named kind
  stops the build.
- **Managers' decks.**
  - Slide 3's notes describe the Sunday office as the model has it (`OFFICE_HELP_TEXT`, read and checked).
  - Slide 7 says In Step's edge is "no **Mon–Sat** week over 41h 05m".
  - The weekly hours in notes 7 and 8 are said to be Monday to Saturday.
  - Short Run's notes 7 add its 14h 20m shortest rest.
  - In Step's notes 7 no longer say Even Step has "none over 8h 30m", and introduce Closing Time as another design in the
    pack.
  - Slide 8 says "four weeks off **in a row**".

**Other fixes.** `RULES.md` gave four changes; it has five (F3, the weekday closers, added 31 Oct), and the app builds in
the three shortlisted designs. This README's Even Step section gave three places where its factors differ from In Step's;
there are four (FF18's step). The pack read-me now asks colleagues to read pages 1 and 2 before the rota.

**Left as it is, on purpose.**
- "The 55-hour week" was kept here as the pack's name for the guideline. The external review below asked for the
  precise wording, and it was changed everywhere at once, which was the reason given for keeping it.
- The five-positive cap on page 1 is unchanged.

**Checked:** `deck-check.mjs` 153 rows agree, none unchecked; `regenerate.mjs --check` and `check.mjs` pass; every
changed slide and page was screenshotted. That screenshot pass caught three things, each fixed: In Step's card running
out of its box, "8h | 15m" breaking across a line, and a lone "14" on the managers' slide 8.

**Changed:**
- tooling: `plain.mjs`, `fresh.mjs`, `render.mjs`, `regenerate.mjs`, `shortlist-sheet.mjs`, `pack.py`,
  `deck-polish.py`, `deck-check.mjs`, `rota-strip.mjs`
- outputs: the fifteen sheets, the shortlist, the six decks and their PDFs, the pack
- docs: `RULES.md` and this README

## An external review: four wording changes, no figure changed (31 Oct 2026)

An outside reviewer checked the pack independently and prefers Even Step overall: "the best balance for colleagues", then
In Step, then Short Run. They found "no material numerical discrepancy". Their own recounts agree with the pack:
- all 2,730 printed roster cells match their import files, and all 15 fingerprints match;
- every proposal totals 44,100 Monday–Saturday duty minutes;
- the staffing counts, office pairs, floor minimums, handovers and Sunday duty lengths meet the stated rules;
- the rest gaps, days in a row, weekends, shift lengths, weekly hours and leave figures agree;
- the six PowerPoints match their PDFs in visible text, and the pay arithmetic supports "about £250 a year less".

They asked for four statements to be more precise. Each is now said as asked, everywhere it appeared:
- **"A year is exactly two turns"** becomes **"52 weeks are exactly two turns"**: two turns are 364 days. This is on
  sheet page 8, and in the colleagues' notes for slides 5 and 7.
- **"A 55-hour week"** becomes **"more than 55 hours in seven days"**, and the factor is named **"more than 55 hours in
  any seven-day period"**. That is the app's own title for it (`links-fatigue.js`, MRSF): a rolling seven days, not a
  calendar week. Changed on sheet pages 1, 2 and 7, the shortlist's page 1, and the colleagues' notes 12 and managers'
  notes 6. The 8-hour-duty assumption behind 56.3 to 56.8 hours was already disclosed and stays.
- **Managers' slide 9** says the December rules and the Sunday cover were **"confirmed verbally"**. The 26 people are
  **"decided"**: the slide first said "set 1 October", and the owner had the date taken off, as office detail nobody
  needs on a slide. The notes keep the date, and add that the verbal confirmations are worth having in writing before
  a link is chosen.
- **Slide 5's pay line** now says it is premium and overtime pay, and gross: "No: basic pay stays the same. Premium and
  overtime pay come to about £250 a year less, gross, if you work your share of Sundays." Its notes give the three
  assumptions: the CEA rate of £21.49, a full share of the Sunday overtime, and the fixed duties only.

The fifth point, the distinction between no counted avoidable warnings and an approved fatigue assessment, is already
made on page 7 ("guidance, not a pass or fail") and in the managers' notes 6 ("this is not a fatigue risk assessment").
It stays as it is. The confirmations the reviewer lists as outstanding are the ones the pack already lists as open: the
staffing assumptions in writing, the 13-day rule's written source, and the FF19 reading.

**Found while checking it.** The longer fatigue wording made page 2's last row three lines. On thirteen sheets, "The
workings" line then ran 6px under the footer rule. The page stayed exactly 1,032px, so the renderer's height check passed
it, and only a screenshot showed it. The row now reads "up to 1 (today 5) if a cover week falls badly: over 55 hours in
seven days — guidance, page 7", two lines again. `render.mjs` also refuses any page whose text runs under its footer,
measured after its own tightening passes. Mutated: putting back the three-line wording, the render stops at "page 2,
6px".

**Changed:**
- tooling: `plain.mjs`, `render.mjs`, `shortlist-sheet.mjs`, `deck-polish.py`
- outputs: the fifteen sheets, the shortlist, the six decks and their PDFs, the pack

## The managers' decks reviewed — clarity, consistency and screenshots (1 Nov 2026)

The owner asked for the three managers' decks to be reviewed for clarity, then for consistency, then polished from
screenshots. Two independent reviews read the decks against the rotas, the sheets and the colleague decks. Their
findings were checked before any was taken: every figure they quoted was recomputed. One fact drove most of the changes:
**a deck's PDF carries the slides and no speaker notes**. So anything a manager must not miss is now on a slide: which
design is recommended, that this is not a fatigue risk assessment, what the brackets mean, and the costs colleagues will
be shown.

**On the slides:**
- **Slide 1.** In Step's and Short Run's decks say "one of three shortlisted" and that Even Step is the recommended
  design. Even Step's says it is the recommended one.
- **Slides 2, 6, 7 and 8.** "Fixed rota" becomes **"cover weeks aside"**. "Fixed rota" read as the station's fixed lines.
  Slide 2's bar now says what each design is for, not the line all three shared.
- **Slide 3.** Every row now states its rule: "At the open, at least 4", "Still on duty at 22:00, at least 5" (the
  rule's own name on the rules sheet), and so on.
- **Slide 4.** The subtitle names the measure ("fit to the trains") that slides 7 and 8 refer to. The bar is now one
  sentence for all three decks: a threshold had given Even Step a different sentence for a difference the chart shows
  anyway.
- **Slide 5.** Cover weeks are shown as a share, **"5 of 26 (19%)" against "4 of 20 (20%)"**, not "1 in 5.2". The
  Sunday overtime figure is said to be the whole link's.
- **Slide 6.** The subtitle says **"not a fatigue risk assessment"**. The row is now "Longest shift, any day", because
  two of the three 9-hour shifts are the Sunday early. The bar says what the brackets are: the worst case, if a cover
  week falls badly.
- **Slide 7.** Each "This one adds" and "This one costs" line is checked against the other two designs.
  - Short Run's cost now names its nine-hour weekday earlies. Seen side by side, only In Step's long earlies were
    named, though Short Run's are the longer.
  - In Step's "most early finishes" now says "of the three". Slide 8 lists fewer early finishes than today as a worry,
    and the two lines must not read as a contradiction.
  - The shift-times line no longer puts a tick beside the new times.
  - The shared costs are each said against today.
- **Slide 8.** The two lists are in one form on all three decks: one line each, with "(today X)" beside every figure.
  - The worries are the six on the colleague deck's trade-offs slide, plus the pay figure and (In Step and Short Run)
    the long weekday earlies.
  - The welcome list gains the longer rest and the floor staffing, as the colleague deck's slides 7 and 12 show them.
  - The scope is said once, in the subtitle: per person, a year, cover weeks aside.
- **Slide 9.**
  - The ask is on the slide: the rules are worth having in writing before a link is chosen, and the proposal has not
    yet been seen by the roster office or a union rep.
  - The two open points are said in words, not as "FF19".
  - The dates are in the notes only.
- **Slide 10.** The fingerprint is shown beside the code, as on the sheets.

**In the notes.** The notes are rewritten to be read aloud, in the same order on all three decks. The dates and history
are kept to notes 9. Repeated sentences are gone: the days a year had been said three times. Every figure is computed,
and the notes no longer give an exact count where a rounded one is said aloud ("44,100 minutes" is gone).

**Found in the screenshots.**
- At 13pt, slide 8's lists ran off the bottom of their cards. They are now 12pt, start 0.08in higher, and have one line
  per item. Each item was measured against Inter's own metrics before the rebuild.
- Four slide-7 lines wrapped onto a second line, and slide 8's bar left "both." alone on its second line.
- Slide 2's fatigue tile ran to two lines. That broke the rule that every tile's sub-caption is one line, which keeps
  the four tiles level. It now says "cover weeks aside", next to the hours tile's "Mon–Sat average". Today's 4 is on
  slide 6, because one line holds the qualifier or the comparison, not both.

**Not taken.**
- Slide 6 keeps its green figures, which mean "better than today". What was misread was the brackets, and the bar now
  explains them.
- The "Why Even Step?" titles, "code" on slide 1 and slide 4's title stay as they are.
- The colleague decks were outside this review, and every part of the rebuilt colleague decks was compared with the
  committed ones and found identical. The one term they shared with the managers' decks was changed afterwards: see
  the next section.

**Checks.** `deck-polish.py` refuses to print a claim the grids do not bear out. New checks:
- each slide-8 worry is a cost against today, and each welcome is a gain;
- Short Run's long earlies are all nine hours;
- the notes say where today's 13:45 is kept every weekday, and it is kept there;
- Even Step's Sunday 09:00–18:00 is its only shift over 8h 30m;
- Even Step has the fewest shift times and the furthest week-to-week move;
- Short Run has the heaviest week;
- slide 3's levels are met.

Four of these were tested with `scripts/mutate.mjs`, and each stopped the build with its own message.
`deck-check.mjs` reads the renamed rows: 153 rows agree.

**Changed:**
- tooling: `deck-polish.py`, `deck-check.mjs`
- outputs: the three managers' decks and their PDFs, the pack

## "Cover weeks aside" in the colleague decks too (1 Nov 2026)

The colleague decks said "fixed rota" in 12 places each: 5 on slides and 7 in the notes. They defined the term only in
notes 2, which a PDF does not carry. That is the term the managers' review replaced, because it reads as the station's
fixed lines, and the app has a roster type called "fixed". The owner agreed to align the colleague decks with the
managers' decks.

- **On the slides,** slides 2 and 9 now say "never more than five days in a row, cover weeks aside". Slides 12 and 14
  have the row "Avoidable fatigue warnings, cover weeks aside", the same label as the managers' slide 6.
- **In the notes,** the term is said the way a presenter would say it aloud. Notes 2 defines it where the presenter
  first meets it: "When a slide says 'cover weeks aside', it means the other 21 weeks, whose shifts are set." Notes 7
  says that the yearly figures and the 14h 35m shortest gap leave the cover weeks out.
- **Slide 9's bar** keeps "five days in a row" together. The line used to break as "in a / row", the same break the
  old wording had.
- `deck-polish.py` writes the new wording where it creates these sentences, and rewords the builders' own sentences once
  each. A deck that still says "fixed rota" is refused. Mutated: with one rewording deleted, the build stops and names
  the notes page.
- The managers' decks' content is unchanged; only a timestamp inside an embedded chart differed, so they were not
  rebuilt into this change.

**Still saying "fixed rota", outside the decks:** the one-line description under Short Run's name on its own sheet
("No run over five days on the fixed rota…"). Changing it means re-rendering that sheet, so it is left as it is until
the owner decides. The shortlist sheet used to say it too; it changed in the next section, when it was re-rendered for
another reason. Short Run's line changed on 1 Nov 2026, in the fifth review's follow-up, below.

**Changed:**
- tooling: `deck-polish.py`, `deck-check.mjs`
- outputs: the three colleague decks and their PDFs, the pack

## A third outside review: the pay condition back, and four readability changes (1 Nov 2026)

The reviewer scored the pack 8.5/10 for appearance and found no new numerical discrepancy. They also found no text
outside a page and no mismatch between a deck and its PDF. They still prefer Even Step. They found one qualification
missing, and suggested five readability changes. All six were taken, as follows.

- **The pay line on managers' slide 8 had lost its condition.** The previous pass shortened it to fit one line, and it
  became "About £250 less premium and overtime, gross". The condition, that the person works their full share of
  Sundays, was left only in the speaker notes, which the PDF does not carry. It now reads "Premium and overtime pay:
  about £250 less, gross, with a full share of Sundays". That was this session's error, not a calculation error.
- **Managers' slide 8 was the busiest slide in the pack: 16 points at 12pt.** The previous pass had added every cost on
  the colleague trade-offs slide, and shrunk the text to make them fit. The slide now has five good points and six
  worries at 13pt, and notes 8 name the rest.
  - The five good points: weekends off, days in a row, one shift time a week, shorter closers, and either the longest
    shift (Even Step) or how many shift times are already worked (In Step, Short Run).
  - The six worries: late finishes, early finishes, runs of earlies or lates, leave, pay, and either Even Step's two
    more Saturdays or In Step's and Short Run's long weekday earlies. In those two decks, the Saturdays stay in slide
    7's bar.
  - Every two-line item was laid out with no-break spaces, so a line never splits inside "(today 39)" or a duration.
- **Colleagues' slide 8, the shift times, was small for a room.** The times people already work are now in two columns
  at 18pt, up from 10.5pt. Each new time is one row at 13pt: the day, the time, and what it is. The notes are the
  builders' own, shortened by a fixed set of rules, and a note no rule covers stops the build.
  - The first attempt used tab stops. LibreOffice ignored them and used its own default spacing, which wrapped "07:15–"
    away from "15:45" and ran a note into its time. The screenshot showed it, and the columns are now separate text
    boxes, which line up the same way in both programs.
- **Colleagues' slide 14** stays as a reference to leave on screen. Its notes now say not to read it row by row: take
  the rows people ask about, or else the three that carry the case.
- **Shortlist page 2.** The 15-line paragraph on the other twelve designs is now a seven-row table: each design, and its
  main trade-off. The full detail is on each design's own sheet and on the summary.
  - A first version kept every detail in three columns, and ran 100px off the page. The sheet's overflow check refused
    it, and the reviewer's suggested "main trade-off" form is the one that fits.
  - Page 1's two "fixed rota" phrases became "cover weeks aside" in the same re-render.
- **The summary** is now described in the pack's read-me as a reference: read it on screen, zoomed in, or print it at A3.

**Checks.** `deck-polish.py` now refuses a managers' slide 8 with more than six points in a column. It also refuses a
new-time note that no rule shortens. Both were mutated with `scripts/mutate.mjs`, and each stopped the build with its
own message. `deck-check.mjs`: 153 rows agree. Only the intended parts of each deck changed. In the managers' decks
that is slide 8 and notes 8, plus a timestamp inside the embedded chart workbook. In the colleague decks it is slide 8
and notes 14.

**Changed:**
- tooling: `deck-polish.py`, `shortlist-sheet.mjs`, `pack.py`
- outputs: the six decks and their PDFs, the shortlist sheet, the pack

## A fourth outside review: one pass for simplicity (1 Nov 2026)

The reviewer's follow-up corrected their own earlier verdict. "Essentially finished" had been about accuracy and
completeness, and was too generous about simplicity. The story was still clear, but a few slides had become more
complete at the expense of the aim: plain English, low cognitive load, and only the caveats needed on screen. Their
point was information density, not visual design: "an orderly slide can still contain too much". They asked for one
focused pass, and for no deck to be rebuilt and no detail removed from the supporting pack. This session agreed. Each
review had added something true to a slide, and together they had made some slides harder to read.

- **Managers' slide 8: three gains and three costs.** Each is a bold plain-English headline ("More weekends off") with
  its figure underneath in grey ("14 full weekends a year, not 10"), so the slide can be read from the headlines alone.
  - Even Step's costs are late finishes, leave and pay. In Step's and Short Run's swap leave for their longer weekday
    earlies, the cost their colleagues will notice; leave stays in slide 7's bar.
  - The pay line keeps its Sunday condition.
  - Notes 8 name everything else.
- **The bars on managers' slides 5 and 7** now give the message without the figures. "Six more people, the same
  35-hour week — and Sundays are still worked as overtime." "What all three cost: more late finishes, two more
  Saturdays a year, a day more leave for four weeks off." The figures moved to notes 5 and 7.
- **Colleagues' slide 8** keeps the times people already work, which can be taken in at a glance. The new times are
  now three plain lines: closers start later (by how much, on which days), the new weekday times, and Sundays.
  - Notes 8 list every new time with what it is, for reference.
  - A word joiner after each time's dash stops a time breaking across two lines; "15:00– / 22:30" had done so.
- **Colleagues' slide 14** says its message before the figures: "Same hours and days, shorter closers, more weekends
  off, fewer days in a row".
  - The three rows behind that message stay bold, and the rest are set in regular weight, so the eye lands on them first.
  - The bar used to repeat the message. It now names the costs: "more late finishes and longer runs of earlies or
    lates".
- **Caveats** stay only where a claim would mislead without one:
  - the pay line's Sunday condition;
  - "cover weeks aside" beside days in a row and the fatigue warnings;
  - "not a fatigue risk assessment";
  - what the brackets on slide 6 mean.
- **Left as they are:**
  - Managers' slide 3: each row's rule threshold is what that slide is for.
  - Every other colleague slide: the reviewer found them mostly successful.
  - The sheets: the full comparison lives there.

**Checks.** Three things now stop the build:
- colleague slide 8's three lines failing to name every new time (or cover it as a closer) or naming a time that is
  not new;
- slide 14's subtitle or bar no longer being true of its design;
- slide 8's gains and costs no longer being gains and costs against today.

The first two were mutated with `scripts/mutate.mjs`, and each stopped the build with its own message.
`deck-check.mjs`: 153 rows agree. Only the intended parts changed:
- managers' decks: slides 5, 7 and 8 and their notes, plus the embedded chart's timestamp;
- colleague decks: slides 8 and 14 and notes 8.

**Changed:**
- tooling: `deck-polish.py`
- outputs: the six decks and their PDFs, the pack

## A fifth outside review and its follow-up: two words, the read-me, slide 9 (1 Nov 2026)

The reviewer rated the revised presentation design 9/10, found no new accuracy regression, and advised against another
broad rewrite. They made one wording point: Even Step's "weakest weekday fit" was accurate, because it means of the
three, but "could sound more alarming than intended", and "slightly weaker weekday fit than the other two" gives the
size better. Its fit is 32.6, against In Step's 29.8 and Short Run's 29.1, where today's is 52.0.

Their follow-up recommended "one final navigation edit, a small adjustment to slide 9, and selective terminology
changes where they improve understanding". They advised against reworking all 15 sheets to remove every "fixed
duties". This session agreed with all of it.

- **"A slightly weaker weekday fit".** Managers' slide 7 used to say "This one costs: longest weekday lates (8h 27m on
  average), weakest weekday fit". It now says "This one costs: lates near today's 8h 30m, and a slightly weaker weekday
  fit". Notes 7 say the same. So do the shortlist sheet's Even Step card, its case on page 2 and its "Choose Even
  Step" line.
  - Both words claim a size, so both are checked, in `deck-polish.py` and as `claim()`s in `shortlist-sheet.mjs`.
  - "Near today's" means within ten minutes of today's weekday lates.
  - "Slightly" means behind the best of the other two by under a tenth of today's score.
  - The older claim that it is the weakest of the three stays as well.
- **The read-me puts the route first.** In the reviewer's words: "The history interrupts the route into the pack. A
  new reader needs the current recommendation, what they are being asked to decide, and which file to open." It now
  runs in this order:
  - the recommendation, in the shortlist sheet's words, without figures of its own;
  - what managers and colleagues are asked;
  - where each starts. Colleagues start with their presentation; the proposal sheet and its rota follow, as the
    reviewer advised;
  - what is still open;
  - what each folder holds.

  How the shortlist came about now comes last, opening with the first shortlist (3 October). The header lost "set on
  1 October 2026", the office detail the owner took off slide 9. Every file the route names starts a line of its own,
  and no folder's name is split by a wrap.
- **Managers' slide 9** had "Still open: …" as the line under "Then: who starts on which line", though it concerns
  other matters. Each row now describes only its own topic:
  - "which link we use" says "After colleagues' views";
  - "who starts on which line" says "Decided after the link is chosen".

  The two open points moved to the bar under the rows: "Still open: where the 13-day limit is written; how one fatigue
  check treats a rest day." Before, the bar said the order of the two decisions, which the rows now say themselves.
- **Terminology, selectively.** The last "fixed rota" printed anywhere in the pack was the line under Short Run's name
  on its own sheet. It now says "No run over five days outside the cover weeks". "Fixed duties" stays on the sheets,
  because, as the reviewer put it, it names the duties being measured, while "cover weeks aside" describes an exclusion.
  - Re-rendering Short Run's sheet changed only that line and its date. Its JSON and import file are byte-identical,
    and its pages 2 to 8 are identical pixel for pixel.
- **Left as they are,** as the reviewer advised:
  - managers' slide 3, five aligned staffing comparisons;
  - colleagues' slide 14, a reference slide;
  - the rest of managers' slide 7, six points of one line each.

**Checks.** `pack.py` now refuses to build the read-me in four cases:
- the shortlist sheet stops saying the case the read-me repeats;
- the colleague presentation the route points to is not in the pack;
- a file the route names is not on a line of its own;
- a folder's name is split across two lines.

Each was mutated with `scripts/mutate.mjs`, and each stopped the build with its own message. The last needed two runs,
because today's text happens to put no folder name at a line end:
- with the wrap narrowed to 76 columns and names left unprotected, the check caught "4 Proposal sheets" split;
- at the same width with names protected, nothing split.

The four size checks were mutated too, and each stopped its build: "near" and "slightly", in the decks and on the
shortlist. `deck-check.mjs`: 153 rows agree. Only the intended parts changed:
- managers' decks: slide 9 in all three, and slide 7 and notes 7 in Even Step's, plus the embedded chart's timestamp;
- colleague decks: nothing;
- sheets: the shortlist's three phrases, and the line under Short Run's name.

**Changed:**
- tooling: `deck-polish.py`, `shortlist-sheet.mjs`, `pack.py`, `fresh.mjs`, `regenerate.mjs`
- outputs: the three managers' decks and their PDFs, the shortlist sheet, Short Run's sheet, the pack

## An aesthetic and consistency polish of the whole pack, from screenshots (1 Nov 2026)

The owner asked for "aesthetic polish and aesthetic consistency polish" of the entire pack, double-checked with screenshots.

**How it was done.**
- Every page was rendered: 75 slides, 120 sheet pages, the summary, the shortlist and the rules.
- Contact sheets put the same page of every design side by side, so a design whose page differed stood out.
- Three reviewers worked in parallel: one on the decks, one on the sheets, and one on the summary, shortlist, rules and read-me. That third reviewer also compared the document types against each other.
- They reported 63 findings, each with a cropped screenshot. Every one was checked against its crop before anything changed.
- After the fixes, all 200 pages were rendered again and compared pixel for pixel with the first set: 170 changed, none appeared or went.
- A fourth reviewer then looked only for anything the polish had made worse. Nothing overflowed, was clipped or touched a footer, but it found nine things, each settled below:
  - on page 6 of every sheet, each ✓ or ✕ sat an em left of its figure;
  - six designs' page 1 split "Sat 10.0 / (65.9)", and seven others had split "Sun 29.0 / (71.7)" since before the polish;
  - page 2's key stranded the ✕ chip from "red:" on eleven sheets, two of them new with the polish;
  - the rules sheet split "rest- / day", "ticket- / office" and its list of cover-week gaps;
  - managers' slide 4's chart axis had become too faint to see on a projector;
  - three side effects of the layout changes, kept with reasons (Declined).
- After each round of fixes, the pack was rendered again and compared pixel for pixel with the round before. Only the pages meant to change had changed.

**What changed: the proposal sheets** (`plain.mjs`, `render.mjs`; all 15 re-rendered)
- **Page 1:** the four "Can it work?" tiles, and the two staff boxes, now share their row's height. **This reverses a call made twice before.** The third polish pass (4 Oct) let each card size to its own text, and the 30 Oct review kept that ("Page 1 was left as it is"), because a stretched card's empty band "reads as something missing". Side by side on screenshots of all fifteen, though, four tile bottoms and two box bottoms at different heights were the most visible untidiness in the sheets. That is a row of parallel answers, where one bottom line is the convention. The cost is real and accepted: the first tile, "9 of 9 rules met", is now about two-fifths empty.
- **Page 1's spacing:** holding every figure whole (Line breaks, below) cost tile 4 a line on thirteen designs, and so the row of tiles it sets. Six designs' staff boxes came to 2 mm off the footer rule. So the two headings now sit 12px below what they follow, not 16, and the boxes 9px under theirs, not 12. Page 1 now ends 4px lower than before on thirteen designs; In Step's ends 11px higher, and Closing Time's where it did.
- **Page 6:** the limit cards still size to their text. One holds a paragraph and the others a line each, so stretched they would be two-thirds empty.
- **Page 4:**
  - The new shift times sit three to a row, under the three figures above them. They had been 2-up, 3+2, 4+3 or 3+3, depending on the design.
  - The shift-time table's two column groups both read from the left, and its headings no longer wrap.
  - Its changed cells keep their row's stripe.
  - Its rows take the page's spare room, as page 6's already did, so the page no longer ends a fifth of the way above its footer.
- **Page 7:** the columns have set widths, so the table sits the same on all fifteen. Second Look's longer text had pushed its columns 21 mm right.
- **Marks:** a ✓, ✕ or ● that starts a cell on pages 6 and 7 hangs, so a second line starts under the words. So does the status line under each page 6 limit card.
  - The first try had a fault, which the fourth reviewer found. Indentation is inherited, and the mark is a box of its own, so it took the hang a second time and sat an em to the left of its figure. The mark now resets it, as the rules sheet's mark always has.
  - The space after the mark went too: the mark's box is the gap, and with the space kept, a second line started one space left of the first word.
- **Colour keys:** the keys in the page 2 and page 7 headers show each mark on a white chip, in its own colour. Before, the marks were white, so the reader was told the colours and never shown them.
  - A no-break space did not hold a chip to its word, because Chromium breaks after an inline box anyway. Each chip and its word now sit in a no-wrap span.
  - Red holds "a rule" too, so page 2's key wraps the same way on all fifteen sheets.
- **Type and colour:**
  - Every section heading is one size.
  - "For discussion, not a decision." is navy, so red means only a broken rule.
  - Page 2's green column no longer alternates between two tints with the stripes.
  - Words in a figures cell ("one-turn weeks", "3-day") lose tabular figures' wide hyphen.
- **Line breaks:** a figure keeps what it belongs to, in text only:
  - a label with its figure: "(today 52.0)", "limit 12h";
  - a figure with the one it is compared with: "Sat 10.0 (65.9)";
  - a bracketed note, "(definition to confirm)", and "not a breach" in page 7's key;
  - a day with its time: "Fri 07:15–15:45";
  - a range: "30 to 60", "18 of 21";
  - a count with its unit: "44,100 minutes", "46 a year";
  - a date: "1 October 2026";
  - a day range: "Mon–Sat".

  A unit does not join a range ("7 in 26 weeks" can wrap before "weeks"). Chained together, the first attempt made runs long enough to push page 1's staff boxes into the footer.
- **Dates and titles:** "Prepared" uses the pack's date form, "1 Nov 2026". Each PDF's title names its design, so fifteen open sheets no longer show fifteen identical browser tabs.

**What changed: the rules, the shortlist, the summary and the read-me**
- **Rules** (`rules-sheet.mjs`):
  - Ticks and crosses are the sheets' marks, coloured on the mark alone; the crosses were brown, and coloured the whole value.
  - The rule column is wider, so "No more than 13 days worked in a row" is one line.
  - A hyphenated word ("rest-day", "ticket-office", "Monday-to-Friday") and the list of cover-week gaps are never split. The narrower middle column had split them.
  - "exactly 35h" is "exactly 35h 00m".
  - Page 2's fatigue column reads from the left, and its sub-lines are the documents' grey, not the decks' blue-grey.
  - The five preferences each open with a bold phrase and a full stop.
  - Page 2 ended 1 mm above its footer and now ends 7 mm above it.
- **Shortlist** (`shortlist-sheet.mjs`):
  - It has the family band and footer: "Links designer" in the eyebrow, a Prepared line, and the footer's section capitalised. The date moved out of the footer.
  - Figures are centred, as on the sheets and the summary, and the fit row is at the table's size.
  - Each label uses "Mon–Sat" and each sentence uses "Monday to Saturday".
  - The "Why" table's names fit on one line, which gives page 2 back 8 mm.
  - Even Step's card carries a "★ recommended" tab on its green rule.
- **Summary** (`summary-sheet.mjs`): it was the one document without the family's look. It now has:
  - the navy band, with its lead line as the band's sub-line;
  - the light-grey headers in small capitals and striped rows;
  - every row's first line on one baseline;
  - the shortlist star under the name;
  - footnotes in two columns;
  - the documents' greys and green, read from the app's own stylesheet.

  It prints at 89%, against 90% before.
- **Read-me** (`pack.py`):
  - A design's name, a date and a version number are never split by a wrap.
  - A spaced dash never starts a line, where it read as a bullet.
  - The colour key is two columns, and the files the route names are indented.
  - Page ranges read "pages 1 and 2".
  - The title is underlined.
  - The file has Windows line endings, because a Notepad older than Windows 10 version 1809 shows Unix ones as a single line.

**What changed: the decks** (`deck-polish.py`, in a new `family_polish` step shared by all three designs)
- **Line breaks:** five takeaway bars, managers' slide 8 and Short Run's colleague slide 13 no longer split a phrase across lines ("costs 15 / days' leave", "if a / cover week", "(today 26 a year / each)").
- **Colleagues' slide 8:** the "You work these today" tick is green, like every other tick, instead of white on gold.
- **Colleagues' slide 13:** the six cards have even 0.125in gutters. They were 0.2in between the columns and 0.08in between the rows.
- **Managers' slide 2:** the four cards span the margins on the colleagues' 0.15in gutters.
- **Managers' slide 9:** the circles are 0.4in instead of 0.5in, and each detail sits nearer its own title. The circles had sat 0.1in apart, so a detail line read as belonging to the item below.
- **Managers' slide 4:** the chart legend uses the deck's slate rather than black. The axis line was first set to the tables' outline grey, which the regression check found too faint to see on a projector (1.3:1 against white). It is the deck's slate too, darker than the grey it replaced.
- **Navy slides:** the cover and closing slides use the 0.5in margin of every other slide, the cover's footer sits on the closing slide's line, and both closing lists share one indent.

**Declined, with reasons.**
- **Colleagues' slides 4 and 5:** the three-row tables keep their larger type. They were set a size up on 31 Oct to fill a five-row band, and at standard size the taller rows look half empty.
- **Managers' slide 7:** the takeaway bar keeps its break after the comma, which leaves each line a whole item.
- **Even Step's slide 8:** its cards stay top-aligned, so the geometry is identical across the three designs.
- **The slide 10 strip:** it stays an image.
- **Other decks findings:** the remaining small spacing and type-size findings were left as they are, because they reflect what each slide holds.
- **Shortlist page 2:** the "Why" table has no header row, because its heading introduces it and the page has no line to spare.
- **Brand mark:** the decks keep their flat mark; the documents keep the app icon.
- **Page 4's grid**, raised by the regression check as a decision rather than a fault: the new times stay three to a row.
  - Both Ways' four cards sit 3+1 rather than 2+2, and three designs' seven sit 3+3+1 rather than 4+3.
  - One card width on every sheet, under the three figures above, was the point of the change.
- **Two page 7 rows** gained a line (Closing Time's FF11 and Second Look's FF19), because the columns now have set widths. Both now wrap as the other designs' do.

**Checks.**
- **A guard that had been missing.** Chromium prints a page that is wider than the paper shrunk to fit, every page of it. The sheets' stylesheet said so, but nothing checked it.
  - During this pass, a fixed-layout page 7 table let one cell's words run 4px past its column. All eight pages printed slightly smaller, with a stray line under every footer, while every other check stayed green.
  - `render.mjs` now refuses a page wider than the 711px print width. With the fixed layout put back, it stopped the render and named page 7, 4px over.
  - The rules and shortlist guards check width as well as height.
- **The regression fixes changed only what they meant to.**
  - Rendered again and compared pixel for pixel with the commit before them, only these changed: pages 1, 2 and 7 of each sheet, both rules pages, and slide 4 of the three managers' decks.
  - The shortlist and summary were rendered again and match pixel for pixel.
  - Every page's space above its footer is as it was, except page 1 (above).
- **Unchanged content.**
  - The re-render changed no fingerprint (`regenerate.mjs --check`).
  - No sheet's JSON or import file changed by a byte.
  - Every sheet is still eight pages.
  - `deck-check.mjs`: 153 rows agree.
  - `npm test`: 2,278 tests, 0 failures.

**Changed:**
- tooling: `plain.mjs`, `render.mjs`, `rules-sheet.mjs`, `shortlist-sheet.mjs`, `summary-sheet.mjs`, `deck-polish.py`, `pack.py`
- outputs: all 15 proposal sheets, the rules, the shortlist, the summary, the six decks and their PDFs, the pack

## What it means for you — earlies and lates, swaps, and a one-page sheet (1 Nov 2026)

The owner rated the pack and asked for three changes: the average early and late on the colleagues' slide 6; swaps on the pay slide, saying plainly that its £250 assumes no swap overtime; and a one-page "What it means if you…" sheet. Then an accuracy check, a deep review, and an aesthetic and consistency review from screenshots.

**1. Slide 6 of the colleague decks: where the closers' time goes.**
- The slide said every closer is shorter and the average two minutes longer. It left the reader to work out that the difference lands on the earlies, which is the one thing someone who prefers earlies needs to know.
- "Longest shift anywhere" gave way to the average early and the average late, Monday to Saturday. The average shift moved below them, as the two averages it is made of. Nothing is lost: the bar says nothing runs over 9 hours, and the Saturday closer row shows today's 9h 10m.
- Today against Even Step / In Step / Short Run: the average early 7h 59m against 8h 13m / 8h 21m / 8h 26m; the average late 8h 29m against 8h 18m / 8h 10m / 8h 06m. The notes add that each person works about 84 earlies and 94 lates a year, Monday to Saturday, against about 88 of each today.
- The subtitle now reads "Closing shifts get shorter, earlies longer — the average goes up about two minutes". A design whose earlies stopped being longer, or whose lates stopped being shorter, would stop the polish.
- Six rows go into the band five rows take: `balance_tables` respaces a six-row table as it does the short ones, so the table ends where every other comparison slide's does.

**2. Slide 5: swaps, and what the £250 leaves out.**
- Two rows. "A late against an early, same day, on average": today 32 min longer; Even Step 5 min longer, In Step 11 and Short Run 20 min shorter. "Finishing at 13:35 or 13:45 — each, a year": 26; 10, 12, none. Those are the short earlies people swap for a long late. They are also the only earlies that finish before 14:00, so this is the same count slide 13 and the shortlist sheet give, and `deck-polish.py` refuses the slide if the two ever part.
- The subtitle says why the rows are on a pay slide: "Basic pay follows your contracted hours — and a swap for a late earns less overtime". The bar ends "That assumes no swap overtime." Both are on the slide, so a reader of the PDF sees them; the notes are not exported.
- The notes price the swaps. Today, swapping every 13:35 or 13:45 early for that day's longest late adds about 34h 40m a year, roughly £930 gross at time and a quarter. On Even Step it adds 10h 50m (£290), on In Step 13h 20m (£360), on Short Run nothing. Each figure is the most those particular swaps could make, it needs a partner for every swap, and it assumes the extra time is paid at time and a quarter, as "Overtime 1.25" on a payslip. (The Pay Calculator suggests that line for a changed shift longer than the rostered one, in `paycalc-roster-suggestions.js`, and a shorter one takes nothing away; whether payroll pays a swap that way is the assumption.)
- The managers' slide 8 says "for a full share of Sundays, swaps aside", and its notes say the same as the colleagues': the £250 assumes no swap overtime, and on average a swap for a late pays less on every link.

**3. A one-page sheet: "What it means if you…"** (`what-it-means-sheet.mjs` → `links-26-what-it-means.pdf`, in 1 Summary)
- It covers six kinds of colleague, from the owner's persona questions: someone who prefers earlies, prefers lates, swaps earlies for lates for the overtime, works their share of Sundays and no other overtime, works no overtime at all, or saves leave for long breaks. A last band shows what everyone gains.
- Every figure is the decks' own (`deck-check.mjs --print`) or counted from the grids. The Sunday £ is read back off each colleague deck's slide 5 and must match. Every "in short" line is asserted, so a design that stops fitting one stops the sheet.
- Long Break is named as the alternative for saving leave, with its cost: four weeks off for 14 days, as today, but it is not shortlisted, and it has six days in a row.
- The bold green marks the best of the three for that kind of colleague, on rows where "best" is plain. The swap totals are left unmarked: they rank only the 13:35 and 13:45 swaps, and counting every swap, Even Step adds more than In Step. So are the average late and the late finishes, which a late-lover who swaps reads the other way, and the weeks in a run, which suit one reader and not another.
- The read-me's colleague route ends on the sheet, and its 1 Summary entry describes it.

**How the new figures are worked out.** `personal()` in `plain.mjs` gains `you`, per person per year:
- earlies and lates (a start before 11:00, or from 11:00 on), Monday to Saturday, and their average lengths;
- the same-day swap: each early against the mean length of that weekday's lates across the link, the lates someone could swap into on that day;
- the 13:35 and 13:45 finishes, counted whether or not their day has a late, and what swapping each one for that day's longest late would add.
`deck-check.mjs` reads the new rows back against them: 162 rows agree, where 153 did. It refuses a same-day swap that rounds to nothing, rather than print "0 min longer".

**Not every swap (the external review).** The first version of the sheet said "Swaps pay much less on every link … In Step keeps the most, Short Run none". Its figures cover one kind of swap only: every 13:35 or 13:45 early swapped for that day's longest late. Short Run still has, for one, a Monday 06:20–14:20 (8 hours) beside a 14:00–22:30 (8½ hours), so swapping those adds 30 minutes, and every link has swaps like it, adding 10 to 60 minutes. "Short Run none" would mislead someone who swaps other duties. The band now reads "Swapping the shortest earlies brings less overtime than today on every link. In Step keeps the most from its 13:35 or 13:45 finishes; Short Run has none of those finishes. Other swaps may still add paid time." The last sentence is asserted too: every link must have, on some day Monday to Saturday, an early other than a 13:35 or 13:45 and a longer late. The notes say the figure is "the most these particular short-early swaps could make", where they said "the most a swapper could make". The colleague slide 5 notes and the managers' notes 8 were narrowed the same way.

**The accuracy check** recomputed every new figure from the raw rotas with its own code, and every number and every bold-green mark agreed. Besides the two swap sentences above, it found:
- the leave band dropped the "Sunday to Saturday" the other sheets carry, so "a day more leave for four weeks off" seemed to contradict the next row, where 14 days' leave buys 28 days off in a row. A four weeks from a Wednesday costs 14 days on every link; only Sunday to Saturday costs 15. Both the band and the row now say Sunday to Saturday;
- "every one a time worked today" (Even Step's earlies): 07:15–15:45 is worked today only on a Sunday, so the sheet now uses the pack's own phrase, "one of today's times".
It also confirmed that the same-day swap figure does not depend on how it is averaged: every reasonable definition gives the same order and direction, and only today's 32 moves (29 to 37).

**The deep review** read every new sentence, the code and the wiring. What it found, and what was done:
- **A regression the checks could not see.** `deck-check.mjs` gained a second `sunHours` key, and in an object literal the later one silently wins. So the managers' notes 5 printed "167.00 of overtime each Sunday against 177.45" where they had said "83h 30m … against 68h 15m". `deck-check` reads tables, not notes, and ESLint ignores this folder, so nothing caught it. Of the four new keys, nothing read three, and the fourth was the clash, so all four went, from `figures()` and from `personal().you`. The notes are back to 83h 30m against 68h 15m. `deck-polish.py` now refuses a Sunday-hours figure that is not hours and minutes, and the comment above the new keys warns against a repeat.
- **Slide 5's row did not say what it measured.** "Swapping an early for a late, on average — 32 min longer" left the reader to supply "your day is" and "and that is paid", and "11 min shorter" invited "swaps now lose me pay". The row is now "A late against an early, same day, on average", as the sheet says it, and the new subtitle says why it is on a pay slide (above).
- **Two "average lates".** Slide 6 and the sheet's average late includes the closers. The shortlist sheet's "weekday lates" leaves them out, which is why it calls Even Step's lates near today's. The sheet's row now says "closers included", and both the sheet's notes and slide 6's notes say how the two differ.
- **Slide 6's notes:** "84 earlies and 94 lates against 88 of each" came straight after "slightly fewer, slightly longer shifts" and added up to more. The counts are the fixed duties, and the cover weeks make up the rest: about 40 days a year against about 42 today. The notes now say both. Even Step's notes no longer say twice that the closers' time goes onto the other shifts.
- **What an early- or late-lover notices most** was missing from the sheet: runs of one kind of up to 5 weeks, 7 with the cover weeks, against today's 2 and 3. That is now a row, with a word in each band's line.
- **Long Break's cost:** six days in a row, as the shortlist sheet pairs it.
- **Unchecked words:** five comparing words had no `claim()`: "two more Saturdays", "shorter Sundays", "a little better off", "closest to today's" and "the only earlies that finish before 14:00". Five claims guarded nothing printed. Every printed comparison now has a claim, and no claim stands without one. The swap £ is read back off the decks' notes as the Sunday £ is off slide 5, because it is worked out twice, in JavaScript and in Python.
- **The read-me:** the sheet's title was split across two lines, which the read-me's own no-split rule now covers. "Work Sundays or none" reads better as "work your share of Sundays or no overtime at all". The paragraph on how the figures are worked out names the new sheet. `pack.py` refuses a sheet older than the colleague decks it reads, and the rebuild order above says the sheet comes after the decks.
- **Smaller points:** `balance_tables` now refuses any table row that runs into the takeaway bar, whatever the table's size. The managers' notes 8 give the early finishes once, not twice. The sheet says the Pay Calculator "estimates a payslip".

**Declined:** relabelling slide 5's row "Finishing before 14:00". The owner asked about the 13:35 and 13:45 finishes in those words, and the times say which earlies they are. The notes bridge the two names, and the polish refuses the slide if the counts ever differ.

**The aesthetic review and the aesthetic consistency review**, both from screenshots, the changed slides beside their neighbours and the new sheet beside the pack's other sheets. They found the slides clean and consistent. Slides 5 and 6 are laid out identically on all three decks, and their table top, bottom, row-gap ratio and bar match slides 4, 7, 11 and 12. Slide 6's six rows are 0.33 in against 0.40 in and not cramped, and the managers' slide 8 line fits its card. The sheet's masthead, table header, striping, figures, bold green and footer match the shortlist sheet's. What changed:
- **Slide 5's two new rows are amber,** where they were navy. The deck colours a worse-than-today count amber (slide 7's late finishes), and slide 13 lists fewer early finishes as a cost. Both rows are worse than today on every link, which the polish checks. Saturdays and Sundays stay navy, since on a pay slide they cut both ways.
- **The sheet's swap band is unranked, and says so.** Its only green had been Even Step's "5 min longer", beside a line naming In Step: the colour pointed one way and the text the other. The notes now say "The swap rows are not ranked: which link suits a swapper depends on which swaps they make."
- **The average late is ranked again,** shorter better, as on the shortlist sheet and slide 6, so the green agrees with "Short Run's are the shortest on average". The key now says "marks the clear best of the three".
- **One name:** the footer says "What it means for you", as the eyebrow does, and its left side says what is on the page. The band headings are the family's 14px. Short Run's empty swap cells both say "none". No design's name, and no payslip line, splits across a line ("Long / Break" and "Overtime / 1.25" did).
- The page keeps 9px above its footer after all of it.

**Declined:**
- Slide 6's average shift turned navy, as a small move: the slide's notes say to be upfront about those two minutes, so it stays amber.
- Renaming the 13:35 and 13:45 count "before 14:00", on the slide or the sheet (above).
- Larger notes text. On paper it is the shortlist's size. On a phone every line of an A4 page needs zooming, so a font change would not fix that, and the page has no room for it.
- Repeating the column names on every band. Tried: it was busier, wrapped a heading and ran over the page.
- Re-centring the rows a pixel lower. The shortlist sheet shares the CSS, so it would be both sheets or neither.
- A new eyebrow. The slot names the document, as "The shortlist" does on its sheet.

**Changed:**
- tooling: `plain.mjs`, `deck-check.mjs`, `deck-polish.py`, `what-it-means-sheet.mjs` (new), `pack.py`
- outputs: the six decks and their PDFs, `links-26-what-it-means.pdf` (new), the pack
- this README: the folder and tooling tables and the rebuild order

## The December link page in the app — the shortlist for the colleagues who will work it (2 Nov 2026)

The owner had begun presenting Short Run to colleagues a week before, then drew up In Step and Even Step from what they
said, and asked whether a page in the app presenting the shortlist would be a good idea. It is built as `newlink.html`
(app v25.06), an **admin-only preview**: the owner sees exactly what colleagues will, under a banner saying nobody else
can. The owner's answers that shaped it, 2 Nov 2026:

| Question | Answer |
|---|---|
| Who is it for? | "The exact 26 on the new link" — not decided yet, so every CEA on the roster stands in (`newlink-config.js` `AUDIENCE`) |
| Show the recommendation? | "No, three evenly" — A to Z, the same colour, nothing on the page names one |
| When do views close? | "Not set yet" — the page says "a date to be agreed" (`CLOSES`) |
| The station PIN? | "No, signed-in only" |
| What has changed since Short Run was shown? | "Draft them; I'll correct" — five lines, each figure asserted |
| The date Short Run was shown? | "Leave the date off" — "since Short Run was shown" |

**What it shows, in order:** what the page is (nothing decided, the three names); what has changed since Short Run was
shown; what all three give and cost everyone; "What it means if you…" — the one-page sheet's six bands as a choice, a
sentence then the figures, the best of the three in green for that person; each proposal's 26 weeks, flagged "a
proposal — not your roster", numbered and never dated; how to have your say; and the colleague pack.

**The figures are this folder's, not the app's.** `what-it-means-sheet.mjs` was split, unchanged — its HTML
byte-identical before and after — into `what-it-means-data.mjs` (the figures and every asserted sentence) and the
sheet that prints them. `newlink-data.mjs` reads the same module and writes the app's `newlink-data.js`, and
`newlink-data.test.mjs` runs it in `--check` mode, so a figure that moves here without the app's copy being rewritten
fails the build. The weeks come from `links-proposals.js`, already pinned to `proposals/`.

**The pack it offers** is a colleague's: the three presentations, the three proposal sheets and the rules. Not the
shortlist sheet or the one-page sheet, both of which name the recommendation, and not the managers' decks. Firebase
Hosting serves nothing under `docs/`, so the links go to the GitHub Pages mirror, which does.

**Drafts for the owner to correct:** the five "what has changed" lines (`newlink-data.mjs`), "Have your say" and the
prepared-by line (`newlink-config.js`). One of the five is history rather than a figure: that the most days in a row
with a cover week placed badly was 6 when Short Run was shown and is 7 since the 31 Oct ruling (this README's opening).

**The page's words differ from the sheet's in four places, on purpose** (the improvements review, 2 Nov 2026). On the
page "the link" is the one that changes in December, so the sheet's "on every link" reads "on all three"; Long Break,
never shortlisted and never shown there, is "a design"; and the two swap rows say "a year", as the page's other labels
do. `newlink-data.mjs` applies them (`REWORD`) and stops if any of them no longer finds its words, so a sentence
changed here cannot reach the page unadapted. The sheet keeps its own wording.

**Not built yet:** opening the page. It needs an audience role in `auth-policy.js` and a matching pill flag, which
`page-contract-parity` moves together; until then `newlink-config.test.mjs` refuses any phase but `'preview'`.

## The new link starts on 1 January 2027, and S. Silva is its contact (2 Nov 2026)

The owner: *"Whilst the new timetable will start in December, the new cea link design will be from January 1st. Also,
Sara Silva (S. Silva) is the primary contact for it not me."* Asked how far the pack should follow, the owner chose
**"Fix the date and rename it"**: every sheet says the link starts on 1 January 2027, and the titles and footers call it
the new CEA link instead of the December 2026 link. What stays is everything that belongs to the timetable: the nine
December 2026 rules, the December trains the cover is measured against, and the December plan for the Sunday office.

**The pack.**
- **The 15 proposal sheets:** the masthead reads *Proposed New CEA Link*, and its line beneath *How this rota would
  work from 1 January 2027, and how it compares with today's link* (`render.mjs`, `fresh.mjs`). The text of every page
  was compared before and after: only those two lines and the Prepared date moved, and no fingerprint did.
- **The summary:** *New CEA link proposals — at a glance*. **The shortlist and "What it means if you…":** their file
  titles, which a PDF viewer shows; neither page named the link's date. **The rules sheet** is unchanged — it is the
  timetable's rules, and was left as committed.
- **The six decks** (`deck-polish.py` → `link_date`): every footer reads *new CEA link proposal*, and so does each file's
  own title. The colleagues' cover reads *Our new link — what changes for you, in plain English*, above *A proposal for
  discussion · CEA link from 1 January 2027 · …*; slide 3 keeps *A new timetable in December 2026* and now says *the new
  link follows from 1 January 2027*; its notes say the timetable changes in December and the link starts on 1 January
  2027. The managers' cover reads *The recommended new CEA link* (or *One of three shortlisted new CEA links*), with
  *from 1 January 2027* on the line beneath, and the notes to slide 9, which keep the dates, gain the start date. The
  polish counts every replacement and refuses a deck that still names the December 2026 link anywhere.
- **The read-me:** *NEW CEA LINK PROPOSALS*, and *Marylebone CEA link from 1 January 2027*. The rule of 1 Nov — no date
  for when the 26 lines were set, which is office detail — is kept; the start date is the one a reader needs.
- **Checked:** `deck-check.mjs` reads 162 rows back and all agree; the only text that moved in any deck is the above
  (each deck's text compared before and after); the covers, slide 3 and the footer band of every slide of one deck of
  each kind were looked at as pictures. The first cover line for the managers' decks that are not the
  recommendation, *… · Even Step is the recommended design*, wrapped its last word onto a line of its own once the date
  was in, so it reads *… · Even Step is recommended*.

**The contact.** Nothing in the pack names a contact, so nothing there changes. The app's page (below) names S. Silva.

**The app (v25.10).** The page is renamed *New link* — the nav pill, title, badge and heading — and says the new link
starts on 1 January 2027, with the timetable first, in December. *Have your say* tells colleagues to talk to S. Silva or
their manager (`newlink-config.js`: `STARTS`, `CONTACT`). The page's last line named her as the contact too, until the owner
saw it on a phone the same afternoon: *"The wording at the very bottom is not needed"* — it went at v25.11. The Links
page's 219-day row gave its basis as *Chiltern December 2026 link rules*; it now reads *Chiltern rules for the new link*.

**The plan's dates.** `../LINKS_DEC2026_PLAN.md` counts back from the timetable, so its deadlines are about three weeks
earlier than the link itself needs; it says so, and keeps them.

## Clean Slate and Next Step — shift times chosen afresh, and Even Step with three retimed (3 Nov 2026)

**The question** (owner, 2 Nov 2026): *"If you were creating a roster links proposal where today's shift times were not
a league weighting factor but the rest of the rules must apply. Please create that proposal. Check every possibility.
The closer shift must start at 15.45 or later and you must have at least 30 13:45 opener finishes and no shift above 9
hours. These are weekday extra rules."* Then *"There should only be 2 per weekday"*, and *"8 hours 30 openers maximum
on a weekday."* It was an idea, kept out of the repo and the pack until the owner chose otherwise (below).

**Clean Sheet, not shipped.** Two 06:20–13:45 finishes every weekday leave the rest of the contract's 44,100
Monday-to-Saturday minutes to the other duties, and the best tables met it only with two 9-hour lates every weekday.
With today's times given no weight it led the league; the owner judged it did not look as good as what the pack had.

**Clean Slate** (`CS-26-N2` · **`dc175c36`**). The second brief: *"do the same idea with only 10 1345 finish
openers"* — one 06:20–13:45 a weekday, ten a year each, and no other weekday opener finishing before 14:00. With one
short early a day instead of two, nothing has to go over 8h 30m from Monday to Saturday.
- **The search.** 200 `final-table.mjs` searches scored 13.4 million candidate tables. The weekday ran every total from
  7,300 to 7,640 minutes under six settings: earlies at most 8h 30m, or only the openers (later earlies to 9h); nothing
  over 8h 30m at all; closers from 15:45 or from 16:00. The Saturday ran inside start bands (earlies by 08:20, lates
  from 12:30), and the Sunday came from an exhaustive Sunday search. The best 16 tables were laid on the twelve distinct sets of
  weeks among the proposals: 192 layouts, 48 of them feasible.
- **What it found.** The weekday came out as Even Step's with three shifts moved: one 07:15–15:45 becomes 06:20–14:50,
  and two of the floor's 14:00–22:30 become 14:15–22:45. The Saturday is its own. The Sunday is the shortlist's, with
  its four 07:15 openers ending at 15:30 rather than 15:45; S7 still holds, since each stays until 15 minutes after the
  last closer arrives.

| Day | Clean Slate's duties |
|---|---|
| Weekday (7,450 minutes) | 06:20–13:45, 06:20–14:20 ×2, 06:20–14:50 ×3, 07:15–15:45, 12:15–20:30, 14:00–22:30 ×2, 14:15–22:45 ×2, 15:45–23:55 ×3 |
| Saturday (6,850) | 06:20–13:30, 06:20–14:50 ×3, 07:00–15:30, 08:00–16:30 ×2, 14:30–22:00 ×2, 14:30–22:45 ×2, 15:45–23:55 ×3 |
| Sunday (4,950) | the shortlist's ten duties, its four 07:15 openers ending at 15:30 |

- **The weeks** are Home Grown's: its rest days and its early and late weeks held while `exact-rota.py` chose every
  time, the most weeks on one shift time first, then the gentlest week-to-week change, under In Step's limits
  (`SKELETON=home-grown.json FAMILY=1 LIGHT=1530 FF17=-3 H7=3060 OBJ=both`): 19 weeks on one shift time, a 1h 21m change.
- **How far it is proven.** The weekday at 7,450 minutes was searched exhaustively (`final-table.mjs` without `ANNEAL`:
  257,727 feasible tables, 126 seconds). Its best on its own measure is worse on the sheets' (26.83 against 26.61, over
  the week) and lays with a 1h 23m change of start against 1h 21m, so the weekday stands. The Saturday was then searched
  exhaustively too, bounded at Clean Slate's own (the anneal's settings: earlies by 08:20, lates from 12:30, earlies at
  most 8h 30m, nothing over 9 hours). A first run did not finish in 25 minutes; given two hours it did: 128,732,758
  feasible tables in 1h 58m, and the best is Clean Slate's own Saturday, duty for duty. No Saturday under those settings
  fits better on the search's measure.

**Next Step** (`NS-26-T6` · **`d53e1533`**). Asked whether Clean Slate would then be the best proposal, the answer was
no: it costs ten new shift times, four of them on a Saturday, and three quarters of its closer fit to the trains,
counted over the week, comes from the three weekday shifts above. Next Step is Even Step's table with only those three
changed; its Saturday and Sunday are Even Step's. Laid on Home Grown's weeks the same way, it has 18 weeks on one shift
time and a 1h 18m change of start; on Even Step's own weeks (`SKELETON=closing-time.json`) the same table gives 17 and
1h 14m, proven. Every figure the New link page shows colleagues is Even Step's (all 24 rows checked).

The owner then asked whether familiar times should not weigh far less than fatigue, rest and the fit to the trains:
*"familiar times are a nice to have, but fatigue factors, rest, fit to trains etc should weigh much more heavily
shouldn't they?"* Under every weighting tried with familiarity counting less, the order was Clean Slate, Next Step,
Even Step. Asked what to add to the pack, the owner chose both, with the shortlist, the recommendation and the New link
page left as they were.

**How they compare.** The same on all three: 9 of 9 rules and all three flexible ones; no fatigue factor on the fixed
rota, up to 1 at worst (the 55-hour week a badly placed cover week can make: 56.8, 56.3 and 56.7 hours); 5 days in a
row, up to 7; 7 full weekends at most 5 weeks apart; 4 single rest days; no mixed week; the closers, 8h 10m every day;
weeks of 41h 30m at most and 25h 30m at least; a 14h 35m shortest rest; 14 days' leave buying 28 days off at best and
20 at worst, and 15 days' leave for four weeks off; 42 finishes a year at 23:00 or later and 94 at 22:00 or later; 218.6
days.

| | Even Step | Next Step | Clean Slate |
|---|---|---|---|
| Shifts over 8h 30m, Monday to Saturday, each a year (today 31) | 0 | 0 | 0 |
| Fit to the trains, weekday · Saturday · Sunday (0 = exact) | 32.6 · 10.0 · 29.0 | 30.3 · 10.0 · 29.0 | **30.3 · 8.4 · 26.4** |
| Weeks on one shift time, of 21 | 18 | 18 | **19** |
| Week-to-week change of start | 1h 31m | **1h 18m** | 1h 21m |
| Shift times (new) | **13 (5)** | 14 (6) | 17 (10) |
| New shift times on a Saturday | **1** | **1** | 4 |
| Earlies finishing before 14:00, each a year (today 26) | 10 | 10 | **12** |
| Starting at 06:20, each a year (today 62) | 60 | 70 | 68 |
| Its weeks | In Step's | Home Grown's | Home Grown's |

Familiar times aside, Next Step and Clean Slate are each as good as Even Step or better on every measure the shortlist
sheet weighs designs by, but one: Even Step has fewer 06:20 starts, 60 a year each against 70 and 68. Against Next
Step, that and one fewer new shift time are all Even Step keeps.

**The leagues** (17 designs; score, then place):

| Version | Next Step | Even Step | Clean Slate | First, if another |
|---|---|---|---|---|
| Main | **84.5 · 1st** | 84.1 · 2nd | 83.6 · 4th | |
| Main, the proposals setting the scale | **77.0 · 1st** | 75.1 · 4th | 76.6 · 3rd | |
| Main, without familiar times | 87.8 · 2nd | 87.0 · 3rd | **88.5 · 1st** | |
| Main, the run on the fixed rota | **85.4 · 1st** | 85.1 · 2nd | 84.5 · 4th | |
| Main, six-factor | 67.4 · 9th | 64.7 · 14th | 65.0 · 13th | Second Look, 92.7 |
| Weighted as before | 86.5 · 3rd | 86.5 · 2nd | 85.7 · 6th | In Step, 87.4 |
| — the proposals setting the scale | 87.7 · 3rd | 87.0 · 4th | 87.9 · 2nd | In Step, 89.1 |
| — without familiar times | 90.3 · 3rd | 89.8 · 4th | **91.1 · 1st** | |
| — the run on the fixed rota | 87.5 · 3rd | 87.5 · 2nd | 86.7 · 5th | In Step, 88.4 |
| — six-factor | 86.4 · 3rd | 86.2 · 10th | 85.0 · 11th | Second Look, 89.2 |

**The pack.**
- `regenerate.mjs` lists both in `SUPPLIED`, after Even Step, so each ships its sheet, grid and import file in
  `proposals/` and `pack.py` packs them. `fresh.mjs` has their one-line descriptions, Clean Slate as a family of its
  own (its table was searched afresh, not from Second Nature's or today's) and Next Step in Home Grown's, and both
  first drawn on 3 Nov.
- `final-table.mjs` gained seven switches, every one off unless set, so every committed search runs as before:
  `EARLY_HI` and `OPENER_HI` (caps on the earlies and on the 06:20 openers), `EARLY_START_MAX` and `LATE_START_MIN` (the
  start bands), `ONLY_REQUIRED_EARLY_FINISH` (no opener finishing before 14:00 but the required ones), `WK_CLOSER_MIN`
  (closers from a time, not one fixed closer) and `REQUIRE_MAX` (at most so many of the required times); `TOPN_OUT`
  writes the best tables found.
- **The proposal sheets.** `plain.mjs` sets a page 4 with ten or more new times six, five or four to a row, whichever
  leaves no box alone, so Clean Slate's ten fit; no earlier design has ten. The fifteen other sheets were re-rendered and
  only their Prepared date moved, so the committed files stand; so did the rules sheet's.
- **The summary** lists seventeen.
- **The shortlist sheet** keeps its three and the recommendation. Four things it said were true of fifteen designs and
  not of seventeen, and changed (`shortlist-sheet.mjs`'s header has the reasons):
  - Closing Time has "a closer Saturday fit", no longer "the best": Clean Slate's is the best of all.
  - The recommendation says Even Step is alone **of the three** with no shift over 8h 30m Monday to Saturday; Clean
    Slate and Next Step have none either.
  - The league paragraph puts Even Step second of seventeen, between Next Step (84.5) and Closing Time (84.0).
  - Both pages say the three were shortlisted (on 31 Oct 2026, the day Even Step joined) before the two came, where they
    said the three "balance best what weighs most here".

  Page 2's table has a row for each, dated. To keep page 2 on its page, "a new Saturday time, its closer" reads "a new
  Saturday closer", the league paragraph is shorter, and the alternatives' rows are a pixel tighter.
- **The read-me** names the two as coming after the shortlist, gives them a paragraph in *How the shortlist came
  about*, and says Even Step is alone of the three with no long shift.
- **Not changed:** the decks and "What it means if you…" (the shortlist's three), and the app: the New link page and the
  Links designer's built-in examples are the shortlist's.

**For the owner.** Next Step is first in the main league, and in three of its five versions, and is Even Step with a closer
weekday fit and a gentler change of start for one more new shift time and more 06:20 starts. Whether it joins the
shortlist, or takes the recommendation, is the owner's decision; nothing here assumes either.

## UK English, the decks included (3 Nov 2026)

The owner: *"Can you use UK English when communicating with me and throughout the app please".* The words already were:
the text of all 27 PDFs in this folder, read back, holds no American spelling. The six decks were not, underneath. Their
template tagged every run of text US English — 2,704 runs across the six — so PowerPoint spell-checked British spelling as
American and a screen reader would have read the slides in an American voice; each deck PDF carried `/Lang(en-US)` from
the same source.
- **The decks** now tag every run `en-GB`, and each PDF says `/Lang(en-GB)`; nothing else in them changed
  (`deck-check.mjs`: 162 rows agree, before and after).
- **`deck-polish.py`** writes the runs it adds as `en-GB`, as `second-nature-decks.py` now does, and a final step
  (`uk_language`) converts whatever a template still carries; `polish()` refuses a deck with a US tag left.
- **"What it means if you…"** was re-rendered against the converted decks to check it still agrees with them. It does, and
  only its date moved, so the committed sheet stands.
- **The app's side** — every page now declares `<html lang="en-GB">`, and `uk-english-parity.test.mjs` keeps American
  spelling out of the pages, the Cloud Functions and the scripts in this folder — is v25.17's.

## Four designs withdrawn — Second Nature, Second Wind, Second Sight and Second Gear (3 Nov 2026)

Asked whether any proposal was now too weak to stay in the pack, the analysis found three weak by every test and a
fourth on the border. The owner: *"Remove the four weak proposals please and reengineer the pack"*. No design was beaten by
another on every measure, so this was a judgement; the evidence it rests on:

| Design | Main league, of 17 | What it had that others did not | What matched it otherwise |
|---|---|---|---|
| Second Nature (`SN-26-F2` · `a52d0f20`) | 17th, and last in 8 of the 10 league tables | blocks a week shorter: at most 6 weeks of earlies, or of lates, against 7 (Second Look has it too) | Second Edition: as good on every measure but that, and better on six — full weekends at most 5 weeks apart, not 10; a 42h 00m heaviest week, not 43h 40m; 18 weeks on one shift time, not 15; a gentler change of start, fewer mixed weeks and a lower 55-hour worst case |
| Second Wind (`SW-26-F1` · `4bec8d8e`) | 16th | the same | Second Edition and Short Run: better on seven, among them the change of start (1h 01m and 1h 13m, against 2h 01m) |
| Second Sight (`SS-26-F1` · `3c6aac4d`) | 15th | the same | Second Edition and Long Break: better on five; it had a fifth single rest day and a 22h 30m lightest week |
| Second Gear (`SG-26-H1` · `8d61e5c3`) | 12th | a lighter lightest week, 25h 30m against 24h 30m | Even Keel: 18 weeks on one shift time, not 16, a gentler change of start (1h 16m, not 1h 25m) and fewer mixed weeks; its fourth person at the Saturday close is Even Keel's and Fine Tune's too |

The one league that ranked the first three well was the six-factor one (Second Nature 2nd, Second Wind 3rd, Second Sight
4th, all far behind Second Look), which leaves out long days, the closers, weeks on one shift time and the change of start:
where they were weakest.

**What changed.**
- Their sheets, grids and import files left `proposals/`. `regenerate.mjs` no longer lists them, with a comment saying how
  to restore one, and `fresh.mjs` drops their descriptions, families and dates. Their grids stay in `tooling/`
  (`second-nature.json` and the rest), their searches in `results/`, and their sections above as the record. The family
  keeps the name Second Nature: it is named for where its designs started, and six of them still start there.
- **The summary** lists thirteen, and fits at 93% where seventeen needed 82%.
- **The shortlist sheet** compares the three with "the other ten". Its alternatives table lost the four from two rows, and
  Second Look's row now names what it alone has, no 55-hour week at all, however the cover weeks fall, where it had named
  the shorter blocks it shared with three of them. The guide's fourth-at-the-close row lost Second Gear. The shortlist
  and the recommendation stand.
- **The read-me** counts thirteen candidate links and names the four, saying why they went.
- **The zip** holds 45 files, not 53.
- **The leagues, on thirteen.** The main league's scale is set by today's link and Familiar Nine, so its scores did not
  move: Next Step 84.5, Even Step 84.1, Closing Time 84.0, then Clean Slate; Short Run is 9th and In Step 11th. Weighted
  as before, In Step still leads (87.4, Even Step 86.5). Without familiar times Clean Slate leads (88.5), Next Step second;
  the six-factor league is Second Look's, with Second Edition and Short Run next.
- **Nothing else named them.** The other thirteen sheets, the six decks (every slide and every speaker note) and "What it
  means if you…" were read for the four names and none was found; "What it means" and the New link page were re-checked
  against the thirteen and are unchanged.

## Familiar shift times count the Monday-to-Saturday duties only (3 Nov 2026)

The owner asked whether the Sundays are the same on the current shortlist and the planned one, and then said *"Familiar
shift times shouldn't apply to Sunday in the league"*. Across those six the Sundays are all but the same: the same ten
weeks and the same ten duties (four 07:15–15:45, one 09:00–18:00, two 14:30–22:30 and three 15:15–23:25), bar Clean
Slate, whose four openers end at 15:30. Only which week each time falls in differs. Across the pack every design has ten
Sunday duties: ten designs on exactly those times, Clean Slate on its 15:30 openers, and Both Ways and Home Grown on
today's 08:00–16:30 and 14:00–22:30 in place of the 09:00–18:00 and 14:30–22:30. And Sunday is overtime, not a
contracted day. Counted in, a design's Sunday duties moved its familiar share by an amount that said nothing about its
Monday to Saturday.

**What changed.** Only `league.mjs`, whose header has the reasoning. The factor is now the share of a design's
Monday-to-Saturday shift times that are one of today's times. A time worked only on the design's Sunday is left out,
whether new or familiar. "Today's times" is unchanged: any time today's link works, Sunday included. So a weekday
07:15–15:45, worked today only on a Sunday, still counts as familiar, as this folder has always called it "one of
today's times". Taking today's Sundays out as well would have made it new on the eight designs that work it on a
weekday; that was not asked, so it was not done. The weight is unchanged (6 of 108). The league weighted before 31 Oct
reads familiar times as it always did (`OLD_READINGS=1`), and `FAM_SUNDAY=1` rebuilds the main league as it was read
from 31 Oct to 3 Nov. Both were checked to reproduce their earlier output exactly.

**The main league** (`REF_IN_RANGE=1 node league.mjs`), before and after:

| Design | Familiar shift times, before → after | Before | After |
|---|---|---|---|
| ★ Even Step | 8 of 13 → 8 of 10 | 2nd · 84.1 | **1st · 85.4** |
| Next Step | 8 of 14 → 8 of 11 | 1st · 84.5 | 2nd · 85.2 |
| Closing Time | 8 of 13 → 8 of 10 | 3rd · 84.0 | 3rd · 85.2 |
| Clean Slate | 7 of 17 → 7 of 13 | 4th · 83.6 | 4th · 83.6 |
| Home Grown | 10 of 12 → 10 of 11 | 5th · 82.4 | 5th · 82.8 |
| Second Edition | 9 of 15 → 8 of 11 | 6th · 81.7 | 6th · 82.2 |
| Even Keel | 8 of 15 → 8 of 12 | 7th · 81.7 | 7th · 82.1 |
| ★ Short Run | 9 of 15 → 8 of 11 | 9th · 81.1 | 8th · 81.6 |
| Fine Tune | 8 of 15 → 8 of 12 | 10th · 80.9 | 9th · 81.3 |
| Second Look | 8 of 14 → 8 of 11 | 13th · 80.2 | 10th · 80.9 |
| Both Ways | 10 of 14 → 8 of 11 | 8th · 81.4 | 11th · 80.8 |
| Long Break | 9 of 15 → 8 of 11 | 12th · 80.2 | 12th · 80.7 |
| ★ In Step | 9 of 15 → 8 of 12 | 11th · 80.7 | 13th · 80.5 |

★ shortlisted. Next Step's 85.220 and Closing Time's 85.215 round alike; Even Step leads them by 0.14. Unranked, for
reference: Familiar Nine 70.4 (69.7 before), today's link 16.7. The points are read across the range, so a design whose
share rose less than the others' can lose points. Both Ways and In Step did. Their shares rose least (Both Ways from 71%
to 73%, In Step from 60% to 67%), partly because one or two of today's times that they work only on a Sunday no longer
count. Weighted as before, nothing moved: In Step 87.4, Even Step 86.5.

**What moved with it.**
- **The shortlist sheet's "judgement" paragraph** now reads Even Step first, just ahead of Next Step and Closing Time,
  level on 85.2, with Short Run eighth and In Step thirteenth. Its claim pins that order and the two level to a tenth.
  The paragraph's note on the weights became "as revised on 31 Oct and 3 Nov 2026": the longer wording ran page 2 11 px
  into its footer, and the sheet refused to print it.
- **The zip** is no longer committed (the same day, owner: "build it on demand"); `tooling/pack.py` builds it with
  the new sheet and this README.
- **Nothing else reads the league.** The summary, the proposal sheets, the decks and "What it means if you…" are
  unchanged, as are the shortlist and the recommendation.

## Fair Share — Next Step with an even Sunday (4 Nov 2026)

**The question** (owner, 4 Nov 2026), of Next Step: could its Sunday duties be balanced, since its Sunday earlies are
longer than its lates and so pay more; and *"is it possible at all to have a period where 14 days buys you 30 days
annual leave (Sundays can be made not available)"*. The first became **Fair Share** (`FS-26-T7` · **`ccf27576`**). It
is in the pack, not on the shortlist; the shortlist, the recommendation and the New link page are unchanged. The second
is under *The leave question*, below.

**Why Next Step's Sunday pays unevenly.** Its ten Sunday duties are the shortlist's. The earlies are four 07:15–15:45
openers (8h 30m) and the 09:00–18:00 (9h); the lates are two ticket-office 14:30–22:30 (8h) and three 15:15–23:25
closers (8h 10m). An early averages 8h 36m and a late 8h 06m. Sunday is paid at time and a half, £32.24 an hour at the
CEA rate, so an early paid about £16 more than a late on average, and up to £32 (the 9-hour early against an 8-hour
late).

**What the rules leave room for.** A Sunday must open with four at 07:15 and close with three at 23:25 (S1, S2), every
duty 8 to 9 hours (S8), and each opener stays until 15 minutes after the last closer arrives (S7). So an opener and a
closer together come to at least 16h 25m: today's 15:15–23:25 closers (8h 10m) hold every opener to 8h 15m or more,
and every duty exactly 8h 15m needs the closers moved to 15:10–23:25. Each band below was laid on Next Step's weeks with only the Sunday cells retimed; every
one meets 9 of 9 rules and the three flexible ones, with no hard-limit breach and no fatigue factor added.

| Sunday duties | Early against late, on average | Sunday fit (0 = exact; Next Step 29.0) |
|---|---|---|
| **8h 10m or 8h 15m, today's 15:15–23:25 closers kept — Fair Share** | **3 minutes apart** | **33.3** |
| every one 8h 15m, the closers at 15:10–23:25 | equal | 34.5 |
| every one 8h 20m | equal | 38.0 |
| 8h 25m or 8h 30m, the openers kept | 3 minutes apart | 45.1 |
| every one 8h 30m | equal | 47.7 |

Fair Share's is the Sunday search's best with every duty 8h 10m to 8h 15m (`final-table.mjs`, `CLS=sun LO=490
HI=495`), whose times are the quarter hour and the day's own instants. Off the quarter hour, 09:00–17:10 and
14:20–22:30 fit a little better, 32.5, for a tenth of a point in the main league (85.1 against 85.0). Levelling up to
8h 30m pays more but fits the trains far worse, and scores 84.5.

**Fair Share** is Next Step's weeks, unchanged (`next-step.json`, `d53e1533`), with seven Sunday cells retimed — the
openers on lines 2, 10, 12 and 17 to 07:15–15:30, the 09:00–18:00 on line 7 to 09:00–17:15, and the ticket-office
lates on lines 22 and 24 to 14:15–22:30 — and the closers kept (`fair-share.json`; the duty table is
`results/fair-share-table.json`). Its sheet outlines the seven.

| | Next Step | Fair Share |
|---|---|---|
| Sunday duties | 07:15–15:45 ×4, 09:00–18:00, 14:30–22:30 ×2, 15:15–23:25 ×3 | 07:15–15:30 ×4, 09:00–17:15, 14:15–22:30 ×2, 15:15–23:25 ×3 |
| Sunday early against late | 8h 36m against 8h 06m: about £16 more, up to £32 | 8h 15m against 8h 12m: within £2.69 |
| Sunday duty minutes | 5,010 | 4,935 |
| Shifts over 8h 30m on any day, each a year | 2, the 9-hour Sunday early | **0**, the only design in the pack |
| Fit to the trains, Sunday (0 = exact) | **29.0** | 33.3 |
| Shift times (new) | **14 (6)** | 15 (7) |

The cost of the even Sunday is that the earlies come down to meet the lates: a full share of Sundays, 20 a year, is
2h 30m shorter a year, about £81. Everything else is Next Step's: 9 of 9 rules and the three flexible ones; no fatigue
factor on the fixed rota, up to 1 at worst (a 56.3-hour week); 18 weeks of 21 on one shift time; a 1h 18m change of
start; 5 days in a row, up to 7; 7 full weekends at most 5 weeks apart; 4 single rest days; no mixed week; weeks of
41h 30m at most and 25h 30m at least; a 14h 35m shortest rest; 14 days' leave buying 28 days off at best and 20 at
worst, and 15 for four weeks off; 42 finishes a year at 23:00 or later; 218.6 days.

**The leagues** (14 designs; score, then place):

| Version | Fair Share | Next Step | Even Step | First, if another |
|---|---|---|---|---|
| Main | 85.0 · 4th | 85.2 · 2nd | **85.4 · 1st** | |
| Main, the proposals setting the scale | 76.7 · 2nd | **77.4 · 1st** | 75.8 · 4th | |
| Main, without familiar times | 87.6 · 3rd | 87.8 · 2nd | 87.0 · 4th | Clean Slate, 88.5 |
| Main, the run on the fixed rota | 85.9 · 4th | 86.1 · 2nd | **86.3 · 1st** | |
| Main, six-factor | 67.3 · 7th | 68.7 · 5th | 67.0 · 10th | Second Look, 94.0 |
| Main, Sunday duties in familiar times (as read 31 Oct to 3 Nov) | 83.9 · 4th | **84.5 · 1st** | 84.1 · 2nd | |
| Weighted as before | 85.7 · 6th | 86.5 · 3rd | 86.5 · 2nd | In Step, 87.4 |
| — the proposals setting the scale | 85.5 · 6th | 87.4 · 3rd | 86.4 · 4th | In Step, 88.9 |
| — without familiar times | 89.9 · 4th | 90.3 · 3rd | 89.8 · 5th | Clean Slate, 91.1 |
| — the run on the fixed rota | 86.7 · 5th | 87.5 · 3rd | 87.5 · 2nd | In Step, 88.4 |
| — six-factor | 83.1 · 12th | 86.4 · 3rd | 86.2 · 7th | Second Look, 89.2 |

Fair Share is below Next Step in every version, by 0.2 to 3.3 points. In the main league and its variants the whole
gap is the Sunday fit; where Sunday duties count in familiar times (weighted as before, and as read 31 Oct to 3 Nov),
its three new Sunday times cost it too. The leagues count long earlies and the closing shift Monday to Saturday only,
so the 9-hour Sunday early it removes scores nothing, and pay is not a factor. It falls furthest weighted as before,
where the fit is the mean of the three day types and the Sunday counts as much as the five weekdays: twelfth in that
six-factor league. No other design's score moved in any version; the designs below it each went down a place.

**The leave question.** `leave.mjs` counts a Monday-to-Saturday working day as one day of leave and a rest day or a
Sunday as none, as asked, with a cover week's four duties at most four. On that count today's link buys 30 days off
for 14 days' leave at best, and the designs in the pack 27 to 29 (Long Break 29, Second Look 27, the rest 28).
`exact-rota.py` was asked, on Fair Share's duties, for a stretch of 30 days costing 14 (`BEST_LEN=30`, a switch added
for it: the `best` objective priced 29 days), relaxing a little more each time, and then to win back what that cost:

| Run | Asked for | Held | 14 days' leave buys, at best |
|---|---|---|---|
| a | the cheapest 30 days (`OBJ=best`) | Fair Share's 18 weeks on one shift time, its change of start and its 25h 30m lightest week; 4 single rest days | 28 days (30 cost 16) |
| b | the same | Fair Share's lightest week; 5 single rest days, the weeks on one shift time and the change of start let go | 28 (30 cost 15) |
| c | the same | 6 single rest days, a lightest week of 24 hours | **30** |
| d | the most weeks on one shift time (`OBJ=one`) | 30 days for 14 (`LV_BEST=30`) and the rest as run c | 30 |
| e | the gentlest change of start (`OBJ=step`) | as run d, with four weeks off for 14 (`LV_FOUR=14`) and 16 weeks on one shift time | 30 |

Each run started from the one before (`HINT=`; run a from Fair Share), with `FF17=-3 H7=3060` throughout. Run c bought
the 30 days with the weeks, 11 of 21 on one shift time; run d took them back to 16 for a 1h 43m change of start; run
e, ten minutes, made the change of start 1h 16m.

**Run e is the answer: yes, on Fair Share's duties** (`results/fair-share-leave30.json`; `FIX=` with `LV_BEST=30
LV_FOUR=14 ONE_MIN=16` confirms it against the model). 14 days' leave buys 30 days off at best and four weeks off for
14, as today; no other 26-line grid here buys 30 but Same Again Tidy, two rules short. Its duties are Fair Share's, so
its shift times, fit and pay are too. What it costs, against Fair Share: 16 weeks of 21 on one shift time, not 18;
6 single rest days, not 4; a 25h 10m lightest week, not 25h 30m; and a 56.7-hour week at worst, not 56.3. Its change
of start is a little gentler, 1h 16m against 1h 18m. The rest is Fair Share's: 9 of 9 rules and the three flexible
ones; no fatigue factor on the fixed rota; 5 days in a row, up to 7; 7 full weekends at most 5 weeks apart; at most 5
weeks in a row of earlies or of lates, 7 with the cover weeks beside them; no mixed week; a 14h 35m shortest rest; a 41h 30m heaviest week; 20 days at worst. In the main league
it would be fifth of fifteen (84.2), just below Fair Share; weighted as before, twelfth. It is a search result for the
owner to look at, not a design in the pack: it has no name, sheet or import file.

**The pack.**
- `regenerate.mjs` lists Fair Share in `SUPPLIED` after Next Step, so it ships its sheet, grid and import file in
  `proposals/`; `fresh.mjs` has its one-line description, Home Grown's family (as Next Step) and 4 Nov 2026 as first
  drawn. Its sheet names Next Step as its parent and says why it was drawn (`fair-share.meta.json`).
- **The summary** lists fourteen, scaled to 91% to fit its page.
- **The shortlist sheet** keeps its three and the recommendation. Fair Share is read into its late joiners and has its
  row on page 2. Three sentences that were true of the pack without it now say who shares them: no shift over 8h 30m
  Monday to Saturday is Even Step's, Clean Slate's, Fair Share's and Next Step's; no early over 8h 30m on any day is
  Home Grown's and Fair Share's; and Even Step has the fewest long days but Fair Share's none. To keep page 2 on its
  page, Fair Share's row is one line and the note under *Against today's link* moved into that heading, as page 1's
  headings carry theirs.
- **The read-me** names the three that came after the shortlist, Clean Slate, Fair Share and Next Step, and says what
  Fair Share is.
- **Not changed:** the decks, "What it means if you…", the New link page and the Links designer's built-in examples
  (the shortlist's three).

## Common Ground — today's link taken to 26 weeks, on the owner's brief (4 Nov 2026)

**The brief** (owner, 4 Nov 2026): *"Can you take the original 20 week roster and expand it to 26 weeks. Eliminate the
13.35 finish on Monday to Friday. Start the closing shifts at 1600. Keep the 13.45 and 14.20 shifts as the opening shift
finish times. Make Sunday shifts fairly even. We need to be able to use 14 days AL to buy 30 days off. Try where possible
to start/finish on a half hour apart from the open and close. And try and get as close as possible to the shortlisted
proposals on all the metrics."* Then, one at a time, on the versions it was shown: *"Also 8 hours 30 as the maximum Monday
to Friday shift time"*; *"Change the closing shift to 1545"* and *"Maximum 9 hour shifts on sat and sun"*; and *"give this
new proposal a better name and create the sheet and put it in the pack"*. It is **Common Ground** (`CG-26-T8` ·
**`e02c295f`**): what colleagues know from today's link — its shift times where the rules allow, the 13:45, and 14 days'
leave buying 30 days off — on weeks that meet every rule. It is in the pack, not on the shortlist; the shortlist, the
recommendation, the decks and the New link page are unchanged.

**How it was read**, so each reading can be overruled:
- **Today's shift times, not today's weeks**, as on 26 Oct (*Today's link on 26 lines*, above): today's twenty weeks
  carry four fatigue factors on the fixed duties and a run of seven, so its times are carried and the weeks rebuilt.
- **The openers** finish at 13:45 or 14:20 every day, Saturday included, but for the Saturday ticket office's
  06:20–14:50, which rule S5 fixes. No duty finishes at 13:35.
- **The closers** are 15:45–23:55 Monday to Saturday. Sunday's start at 15:15: Sunday closes at 23:25 and every Sunday
  duty is 8 to 9 hours (S8), so a 15:45 start would be 7h 40m; 15:15 also fits the Sunday trains better than 15:00 (30.5
  against 35.2 on the search's own figure).
- **A fairly even Sunday**: every Sunday duty 8h to 8h 30m.
- **The half hour**: every start and finish on the hour or the half hour, but the opens (06:20, Sunday 07:15), the
  closes (23:55, Sunday 23:25), the closers, the 13:45 and 14:20 openers and the Saturday office's 14:50.
  `half-hour-pool.mjs`, new, prints those times for `final-table.mjs`'s `POOL_ONLY=`.
- **The caps**: nothing over 8h 30m Monday to Friday or 9 hours at the weekend, and no early over 8h 30m on any day.
- **"As close as possible to the shortlist on all the metrics"**: every factor the league scores and every row of the
  sheets, against Even Step, In Step and Short Run.

**The arithmetic.** Openers finishing by 14:20 and nothing over 8h 30m on a weekday leave the contract little room. On
15:45 closers a weekday pays at most 7,435 minutes with its 13:45 (the ticket office's four, two floor openers, three
closers and six duties of 8h 30m), and a Saturday at most 7,050 with nothing over 9 hours, so the week needs at least
7,410 a weekday. The only split the search finds that pays the 44,100 is **7,435 each weekday and 6,925 on Saturday**,
two of whose duties are 9 hours: 13:30–22:30, today's 13:30–22:00 half an hour longer. On the brief's first closer,
16:00–23:55, a weekday with a 13:45 paid at most 7,390 and no Saturday under the caps could make up the rest: the 13:45
could not have been kept.

**Its duties** (`results/common-ground-table.json`; each day exhaustive, commands below):

| | Shift times | Longest |
|---|---|---|
| Monday to Friday, each (7,435 minutes) | 06:20–13:45 · 06:20–14:20 ×3 · 07:00–15:30 ×3 · 11:00–19:30 · 14:00–22:30 ×4 · 15:45–23:55 ×3 | 8h 30m |
| Saturday (6,925) | 06:20–13:45 · 06:20–14:20 · 06:20–14:50 ×2 · 07:00–15:30 · 08:00–16:30 ×2 · 13:30–22:30 ×2 · 14:30–22:00 ×2 · 15:45–23:55 ×3 | 9h |
| Sunday (4,920) | 07:15–15:30 ×4 · 09:00–17:30 · 14:30–22:30 ×2 · 15:15–23:25 ×3 | 8h 30m |

Fourteen shift times against today's 18, seven of them today's: 70% of the Monday-to-Saturday times are worked today.
`NEWPEN=1` keeps today's 11:00–19:30 where 11:30–20:00 fits the weekday a little better (31.6 against 32.4, the search's
own figure); the familiar time is worth a point in the main league (84.0 against 83.0).

**Its weeks** are those of the 30-for-14 grid, `results/fair-share-leave30.json` (*The leave question*, above): its rest
days and its early and late weeks held, the solver choosing only the times, so its leave figures are that grid's. Of the
layouts on those weeks it has the most weeks on one shift time, then the gentlest change of start, with no week under
25h 30m. CP-SAT need not return the same layout twice, so the grid is committed and `FIX=` checks it against the model:

```
cd docs/links-26/tooling
P=$(node half-hour-pool.mjs weekday); CLS=weekday TOTAL=7435 FIXED_FREE=1 POOL_ONLY=$P WK_CLOSER=15:45-23:55 REQUIRE=06:20-13:45 REQUIRE_MAX=2 ONLY_REQUIRED_EARLY_FINISH=1 OPENER_HI=480 EARLY_HI=510 HI=510 LATE_MAX=0 AT22_STRICT=1 EARLY_START_MAX=09:00 LATE_START_MIN=11:00 TODAY=1 NEWPEN=1 node final-table.mjs
P=$(node half-hour-pool.mjs sat); CLS=sat TOTAL=6925 POOL_ONLY=$P EARLY_HI=510 HI=540 LATE_MAX=0 AT22_STRICT=1 EARLY_START_MAX=09:00 LATE_START_MIN=11:30 TODAY=1 NEWPEN=1 node final-table.mjs
P=$(node half-hour-pool.mjs sun); CLS=sun SUN_PLAN=1 POOL_ONLY=$P LO=480 HI=510 node final-table.mjs
SKELETON=results/fair-share-leave30.json FAMILY=1 OBJ=both LV_BEST=30 BEST_LEN=30 ISO=6 HEAVY=2550 LIGHT=1530 python3 exact-rota.py results/common-ground-table.json /tmp/cg.json 200
FIX=common-ground.json LV_BEST=30 BEST_LEN=30 LV_FOUR=14 ISO=6 HEAVY=2550 LIGHT=1530 ONE_MIN=19 python3 exact-rota.py results/common-ground-table.json /tmp/fix.json 60
```

**Against the shortlist:**

| | Common Ground | Even Step | In Step | Short Run |
|---|---|---|---|---|
| December rules · flexible rules | 9 of 9 · 3 of 3 | 9 · 3 | 9 · 3 | 9 · 3 |
| Fit to the trains, by days (0 = exact) | 29.0 | 28.9 | 26.8 | 26.7 |
| Fatigue factors, fixed duties · at worst | 0 · up to 1 | 0 · up to 1 | 0 · up to 1 | 0 · up to 1 |
| Shortest rest | 14h 35m | 14h 35m | 14h 35m | 14h 20m |
| Most days in a row, at worst · full weekends | 7 · 7 | 7 · 7 | 7 · 7 | 7 · 7 |
| Single rest days | 6 | **4** | **4** | **4** |
| Weeks on one shift time | **19 of 21** | 18 | 18 | 18 |
| Change of start, week to week | **1h 12m** | 1h 31m | 1h 13m | 1h 13m |
| Heaviest · lightest week | 42h 30m · 25h 30m | 41h 30m · 25h 30m | 41h 05m · 25h 30m | 42h 30m · 24h 30m |
| Late finishes a year | 42 | 42 | 42 | 42 |
| Familiar shift times, Monday to Saturday | 70% | **80%** | 67% | 73% |
| 14 days' leave buys, at best · four weeks off cost | **30 days · 14** | 28 · 15 | 28 · 15 | 28 · 15 |
| Earlies over 8h 30m, Monday to Saturday, a year | 0 | 0 | 40 | 20 |
| Closing shift, Monday to Saturday average | 8h 10m | 8h 10m | 8h 10m | 8h 15m |

It is ahead of all three on the weeks on one shift time, the change of start and the leave; level with or ahead of them
on the rules, fatigue, rests, runs, weekends, late finishes, long earlies and the closing shift; and behind on three: 6
single rest days against their 4, the price of 30 days for 14 (*The leave question*: on Fair Share's duties, 4 or 5 single
rest days bought 28 at best); 70% familiar times against Even Step's 80% and Short Run's 73% (In Step 67%); and a 42h 30m
heaviest week, Short Run's, against Even Step's 41h 30m and In Step's 41h 05m. Its fit is level with Even Step's, behind
In Step's and Short Run's.

**The leagues** (15 designs; score, then place):

| Version | Common Ground | Even Step | In Step | Short Run | First, if another |
|---|---|---|---|---|---|
| Main | 84.0 · 6th | **85.8 · 1st** | 80.9 · 15th | 82.0 · 10th | |
| Main, the proposals setting the scale | 73.2 · 7th | 75.6 · 4th | 73.0 · 8th | 71.4 · 10th | Next Step, 77.3 |
| Main, without familiar times | 86.9 · 6th | 87.5 · 4th | 84.0 · 11th | 84.4 · 10th | Clean Slate, 88.9 |
| Main, the run on the fixed rota | 84.9 · 6th | **86.7 · 1st** | 81.8 · 13th | 82.9 · 9th | |
| Main, six-factor | 64.0 · 12th | 67.0 · 10th | 68.0 · 6th | 69.8 · joint 3rd | Second Look, 94.0 |
| Main, Sunday duties in familiar times (as read 31 Oct to 3 Nov) | 82.9 · 6th | 84.6 · 2nd | 81.1 · 13th | 81.5 · 11th | Next Step, 84.9 |
| Weighted as before | 85.2 · 10th | 87.0 · joint 2nd | **87.8 · 1st** | 85.8 · 8th | |
| — the proposals setting the scale | 83.6 · 8th | 86.3 · 4th | **88.7 · 1st** | 83.4 · 9th | |
| — without familiar times | 89.6 · 8th | 90.3 · joint 5th | 91.4 · 2nd | 89.2 · 10th | Clean Slate, 91.6 |
| — the run on the fixed rota | 86.2 · 9th | 88.0 · joint 2nd | **88.8 · 1st** | 86.8 · 7th | |
| — six-factor | 83.2 · 12th | 86.2 · 7th | 87.6 · 2nd | 86.3 · joint 5th | Second Look, 89.2 |

Sixth in the main league, a thousandth of a point behind Clean Slate, as in the run on the fixed rota, and above two of
the three shortlisted. The 1.8 points between it and Even Step are its single rest days, familiar times and heaviest
week (1.9, 1.2 and 1.0), less 2.3 it gains on leave, weeks on one shift time and the change of start. It is lowest in
the six-factor leagues, where the fit carries 20 points of 100 and leave, single rest days and the change of start none,
and with the old weighting, which counts neither long earlies nor the closing shift.

**What its joining moved.** Unlike Fair Share, it moves the other designs' scores: it widens two factors' ranges, the
most single rest days (6, where the most had been 5) and the best leave (30 days for 14, where the best had been Long
Break's 29). Every other design gains 0.4 to 0.8 where today's link and Familiar Nine are in the range, and between −0.2
and +1.7 where the proposals alone set it; the six-factor versions score neither factor and do not move. The shortlist's
three keep their order in every version. Long Break passes Both Ways in the main league, without familiar times and
weighted as before; with the proposals setting the scale it passes Both Ways and Even Keel, and weighted as before with
the proposals setting the scale it passes Home Grown, while Second Look passes Fine Tune. The tables in the sections
above keep the scores of their day.

**The versions it came through**, each joining the league alone (none is in the pack):
- the first brief, with 16:00 closers and two 9-hour weekday lates (13:30–22:30) to pay the contract: 83.8, 6th;
- with nothing over 8h 30m Monday to Friday, still on 16:00 closers: the 13:45 had to go and Saturday took two 9½-hour
  lates: 83.2, 7th;
- Common Ground's own duties on 11:30–20:00 in place of today's 11:00–19:30, whose heaviest week can be 41h 30m: 83.0;
  with its Saturday's 9 hours in earlies (07:30–16:30) in place of lates: 81.8 to 83.2.

**The pack.**
- `regenerate.mjs` lists Common Ground in `SUPPLIED` after Fair Share, so it ships its sheet, grid and import file in
  `proposals/`; `fresh.mjs` has its one-line description, Home Grown's family (it starts from today's link) and
  4 Nov 2026 as first drawn. Its sheet says how it was drawn (`common-ground.meta.json`).
- **The summary** lists fifteen, scaled to 89% to fit its page.
- **The shortlist sheet** keeps its three and the recommendation. Common Ground is read into its late joiners and has
  its row on page 2. Four sentences changed with it: no early over 8h 30m on any day is now Common Ground's too, beside
  Fair Share's and Home Grown's; Clean Slate's most weeks on one shift time are joint with Common Ground's; the guide's
  *Four weeks off for 14 days' leave, as today* names Common Ground, the stronger in the league, as it does Long Break;
  and the leave paragraph, which named Long Break alone and was typed, now says Common Ground and Long Break keep four
  weeks for 14 and Common Ground alone 30 days, with a claim that pins it. Page 1's lead says *before four more joined
  (page 2)* where it named them, and page 2's alternatives table gives each row half a pixel less, both to keep their
  pages.
- **The read-me** names the four that came after the shortlist and says what Common Ground is.
- **Not changed:** the decks, "What it means if you…", the New link page and the Links designer's built-in examples.

## Middle Ground — the shift times varied from week to week (5 Nov 2026)

**The ask** (owner, 5 Nov 2026, of Common Ground): *"I like common ground but there are too many early and late weeks in
a row, which makes it more difficult to swap with colleagues"*; *"Can we make it as good but solve that issue"*; and
*"or another way keep the weeks but rather than all closers bunched together and openers bunch together, make it gently
change the shift times between weeks"*. Shown as Good Turn, it was renamed: *"Can you rename good turn as Middle Ground
and add it to the pack please. Also, the proposal description headlines should not reference other proposals"*. It is
**Middle Ground** (`MG-26-T8` · **`573c7287`**), in the pack and not on the shortlist; the shortlist, the recommendation,
the decks and the New link page are unchanged.

**Shorter runs of earlies and lates were tried first.** On Common Ground's rest days no layout of its duties keeps runs
of earlies or lates to three weeks or fewer: with `SKELETON=common-ground.json` and no `FAMILY`, `exact-rota.py` proves
`BLOCK=3` and `BLOCK=2` infeasible in a second, because each day's earlies and lates have to fall on the lines that work
that day. With the rest days free as well, and 30 days off for 14 and every other rule kept, it found no rota in 500
seconds at either length (not a proof); of the 100 single swaps of two Common Ground weeks of one kind, 98 broke a rule.
Runs of five are not Common Ground's alone: every design in the pack has them but Second Look (4, up to 6).

**What changed.** Common Ground's rest days and its early and late weeks are held, and only which week works which time
is chosen again — `exact-rota.py`'s new `OBJ=gentle`: first the fewest neighbouring weeks that both start at 06:20, or
both at 15:45, on the same weekday; then the fewest week-to-week moves of over two hours; then the fewest neighbours
sharing any other weekday start; then the gentlest change of start, with at least 18 weeks on one shift time. 35 cells on
12 lines differ from Common Ground. Each day's duties do not move, so neither do the fit to the trains or the contract.
The most common weekday start of each week (lines 1, 6, 11, 16 and 21 are the cover weeks):

| Lines | Common Ground | Middle Ground |
|---|---|---|
| 2–5 | 07:00 · 11:00 · 14:00 · 14:00 | 07:00 · 11:00 · 15:45 · 14:00 |
| 7–10 | 07:00 · 06:20 · 06:20 · 06:20 | 07:00 · 06:20 · 07:00 · 06:20 |
| 12–15 | 06:20 · 14:00 · 14:00 · 14:00 | 06:20 · 14:00 · 15:45 · 14:00 |
| 17–20 | 06:20 · 07:00 · 06:20 · 07:00 | 06:20 · 07:00 · 06:20 · 06:20 |
| 22–26 | 14:00 · 15:45 · 15:45 · 15:45 · 15:45 | 15:45 · 14:00 · 15:45 · 14:00 · 14:00 |

```
cd docs/links-26/tooling
SKELETON=common-ground.json FAMILY=1 OBJ=gentle ONE_MIN=18 LV_BEST=30 BEST_LEN=30 LV_FOUR=14 ISO=6 HEAVY=2550 LIGHT=1530 python3 exact-rota.py results/common-ground-table.json /tmp/mg.json 240
FIX=middle-ground.json SKELETON=common-ground.json FAMILY=1 OBJ=gentle ONE_MIN=18 LV_BEST=30 BEST_LEN=30 LV_FOUR=14 ISO=6 HEAVY=2550 LIGHT=1530 python3 exact-rota.py results/common-ground-table.json /tmp/fix.json 60
```

The first returns a layout as good as Middle Ground on every term, not always the same cells (CP-SAT can return either),
so the grid is committed and the second checks it: OPTIMAL, on the same objective.

**Against Common Ground and the shortlist:**

| | Middle Ground | Common Ground | Even Step | In Step | Short Run |
|---|---|---|---|---|---|
| Closing weeks in a row, at most | **1** | 4 | 2 | 3 | 3 |
| 06:20 weeks in a row, at most | **1** | 3 | 4 | 4 | 3 |
| Weeks on one shift time | 18 of 21 | **19** | 18 | 18 | 18 |
| Change of start, week to week | 1h 41m | **1h 12m** | 1h 31m | 1h 13m | 1h 13m |
| Longest block of earlies or lates | 5 (up to 7) | 5 (up to 7) | 5 (up to 7) | 5 (up to 7) | 5 (up to 7) |
| 14 days' leave buys, at best · four weeks off cost | **30 days · 14** | **30 · 14** | 28 · 15 | 28 · 15 | 28 · 15 |
| Single rest days | 6 | 6 | **4** | **4** | **4** |
| Fit to the trains, by days (0 = exact) | 29.0 | 29.0 | 28.9 | 26.8 | 26.7 |

(The run rows read each week by its most common Monday-to-Friday duty: a closing week finishes at the close, 23:55.) It
is the only design in the pack where neither two closing weeks nor two 06:20 weeks fall side by side. The rest is
Common Ground's: all 9 December rules and the three flexible ones, no fatigue factor on the fixed duties, a 14h 35m
shortest rest, seven days in a row at worst, 7 full weekends, a 42h 30m heaviest and 25h 30m lightest week, the late
finishes, the closing shift and the familiar times. What it pays for the spread is one week fewer on one shift time
and a larger change of start.

**The leagues** (16 designs; score, then place):

| Version | Middle Ground | Common Ground | Even Step | In Step | Short Run | First, if another |
|---|---|---|---|---|---|---|
| Main | 83.1 · 8th | 84.0 · joint 5th | **85.8 · 1st** | 80.9 · 16th | 82.0 · 11th | |
| Main, the proposals setting the scale | 70.2 · 11th | 73.2 · 7th | 75.6 · 4th | 73.0 · 8th | 71.4 · 10th | Next Step, 77.3 |
| Main, without familiar times | 85.9 · 7th | 86.9 · 6th | 87.5 · 4th | 84.0 · 12th | 84.4 · 11th | Clean Slate, 88.9 |
| Main, the run on the fixed rota | 84.0 · 8th | 84.9 · joint 5th | **86.7 · 1st** | 81.8 · 14th | 82.9 · 10th | |
| Main, six-factor | 64.0 · joint 12th | 64.0 · joint 12th | 67.0 · 10th | 68.0 · 6th | 69.8 · joint 2nd | Second Look, 94.0 |
| Main, Sunday duties in familiar times | 82.0 · 10th | 82.9 · 6th | 84.6 · 2nd | 81.1 · 14th | 81.5 · 12th | Next Step, 84.9 |
| Weighted as before | 84.2 · 15th | 85.2 · 10th | 87.0 · joint 2nd | **87.8 · 1st** | 85.8 · 8th | |
| — the proposals setting the scale | 80.3 · 10th | 83.6 · 8th | 86.3 · 4th | **88.7 · 1st** | 83.4 · 9th | |
| — without familiar times | 88.6 · 11th | 89.6 · 8th | 90.3 · joint 4th | 91.4 · 2nd | 89.2 · 10th | Clean Slate, 91.6 |
| — the run on the fixed rota | 85.2 · 14th | 86.2 · 9th | 88.0 · joint 2nd | **88.8 · 1st** | 86.8 · 7th | |
| — six-factor | 83.2 · joint 12th | 83.2 · joint 12th | 86.2 · 7th | 87.6 · 2nd | 86.3 · joint 4th | Second Look, 89.2 |

Eighth in the main league, 0.9 below Common Ground: one week fewer on one shift time (0.47) and the larger change of
start (0.45). No league scores how far apart the same shift times fall, and a small change of start — which keeping
alike weeks together gives — scores in a design's favour, so the spread costs points everywhere it is counted and gains
none. Joining moves no other design's score in any version: it widens no factor's range.

**The headlines** (owner, 5 Nov 2026: *"the proposal description headlines should not reference other proposals"*). The
one-line description under each design's name now says what the design is to somebody who has not read the one it came
from. Next Step's read *"Even Step with three weekday shifts retimed for the trains: no shift over 8h 30m Monday to
Saturday and a 13:45 finish every weekday"* and is *"Weekday shifts timed to the trains, with no shift over 8h 30m Monday
to Saturday and a 13:45 finish every weekday"*; Fair Share's read *"Next Step with an even Sunday: every Sunday duty 8h 10m
or 8h 15m, so an early and a late pay within a few pounds"* and is *"An even Sunday — every Sunday duty 8h 10m or 8h 15m,
so an early and a late pay within a few pounds — and no shift over 8h 30m on any day"*. Middle Ground's names no other
design. `regenerate.mjs` refuses a strap that names another design in the pack (mutated with `scripts/mutate.mjs`: a strap
naming Even Step fails). The comparisons — the shortlist sheet's page 2 and the read-me — still set designs beside one
another, which is what they are for.

**The pack.**
- `regenerate.mjs` lists Middle Ground in `SUPPLIED` after Common Ground, so it ships its sheet, grid and import file in
  `proposals/`; `fresh.mjs` has its one-line description, Home Grown's family and 5 Nov 2026 as first drawn. Its sheet
  says how it was drawn (`middle-ground.meta.json`). `exact-rota.py` has `OBJ=gentle`.
- **Three sheets were re-rendered:** Middle Ground's, and Next Step's and Fair Share's for their headlines. The others
  were re-rendered too and differed only in their date, so they were left as they were.
- **The summary** lists sixteen, scaled to 85% to fit its page.
- **The shortlist sheet** keeps its three and the recommendation. Middle Ground is read into its late joiners and has its
  row on page 2. Four sentences that named Common Ground alone now name both: 14 days' leave buying 30 days off; four
  weeks off for 14, with Long Break; no early over 8h 30m on any day; and the guide's *Four weeks off for 14 days' leave,
  as today*, which reads *Common Ground · also Middle Ground and Long Break* — the longer wording widened its column and
  wrapped two other rows. Common Ground's row lost its "alone", and a claim pins Middle Ground's "no two closing weeks
  together". Page 2 kept its page with a pixel off each heading's top margin and the callout's, and list items 1.5px
  apart where they were 3.
- **The read-me** names the five that came after the shortlist and says what Middle Ground is.
- **Not changed:** the decks, "What it means if you…", the New link page (`newlink-data.js` is current) and the Links
  designer's built-in examples.

## Notes for the whole set

**Full weekends off, per year (owner, 2 Oct 2026).** A longer rotation's larger count is not more weekends in a year, so
"7 in 26" against "4 in 20" made the reader divide. The sheets now say it per person per year, as late finishes and 06:20
starts already were:
- **page 1:** "About 14 full weekends off a year (today 10), 7 in 26 weeks, …";
- **page 2:** a "Full weekends off" row in *Each person's year, on average*, with the share of weeks (27%, today 20%);
  the rotation figure stays, relabelled "Full weekends off, in the rotation";
- **the summary:** under the count.

The weighted league scores weekends as a share of weeks for the same reason. The 24-line sheets gained the same per-year line the same day, their one change since that folder was frozen
(`../links-24/README.md`).

**Everything in one download:** `links-26-proposals.zip`, built on demand by `tooling/pack.py` and **not committed**
(owner, 3 Nov 2026 — each committed copy added ~15 MB to the repository's history, sixteen times by then; the
repository ignores `*.zip`, so run the script and send the file). It is laid out as the 24-line pack
(`../links-24/links-24-proposals.zip`) was:
1. a *Read me first* note;
2. the one-page summary, and the two-page shortlist sheet;
3. the rules;
4. the presentations;
5. every proposal sheet;
6. the import files;
7. the technical notes (`RULES.md` and this README).

`tooling/pack.py` builds it from this folder, every design in `regenerate.mjs`'s `SUPPLIED` list included, and stops
if a file is missing. The 24-line pack was zipped by hand, so it went stale after a re-render; this one is rebuilt by
running `python3 docs/links-26/tooling/pack.py` after any re-render.

**26 in the app since v24.47 (3 Oct 2026).** `ROTATING_LINES = 26` in `links-design.js`: the Links page lays out 26
lines, so the import files in the pack paste straight in and the page re-runs every check on them; the shortlisted
designs are built into that page as examples (three from v24.47, Closing Time from v25.01, In Step and Short Run from v25.02, and from v25.04 the three on the shortlist now, Even Step first), copied cell for cell from `proposals/` (`links-proposals.js` says so, and
says to re-copy if one changes). The tooling still
passes 26 to every app function explicitly — harmless now, and it keeps the sheets' line count stated in one place
(`tooling/link.mjs`) rather than inherited. Until that release the page was on 24 lines and refused the files; the
read-me said so, and now says the opposite.
