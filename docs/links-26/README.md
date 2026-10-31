# Links — December 2026, 26 lines

**From 1 Oct 2026 the December 2026 link is 26 lines, not 24.** Everything drawn for 24 lines is kept in `../links-24/` — the
grids unchanged, the sheets re-rendered once (2 Oct 2026, for the per-year weekends line) — both for reference and in case the 24-line link comes back. This folder is for the work from here on.

The 24-line work is not wasted. The rules, the duty tables, the tooling and the designs all carry over. What has to
change is the arithmetic that depends on the number of lines.

**Worst cases dated before 31 Oct 2026 put a cover week's Sunday inside its four duties.** The owner settled that day
that the four are Monday to Saturday and the Sunday is overtime on top, which put a day on most worst cases — "5 (up to
6)" days in a row became "5 (up to 7)". The sections below keep the figures they were written with; the sheets, the
decks and the last section have the current ones (*A cover week's four are Monday to Saturday*).

## What is in this folder

The two link folders, `links-24` and `links-26`, share one layout (2 Oct 2026, owner: "consistent naming"):

| | What it is |
|---|---|
| `links-NN-proposals.zip` | everything for sharing, in one download |
| `links-NN-rules.pdf` | the rules every proposal is judged against |
| `links-NN-summary.pdf` | every proposal against today's link, on one page — the shortlisted ones marked ★ |
| `links-26-shortlist.pdf` | the three shortlisted designs (Even Step, In Step and Short Run, since 31 Oct 2026) against each other and today, with a recommendation, on two pages (26 lines only; `tooling/shortlist-sheet.mjs`) |
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
| | `candidates.mjs` | prints each candidate rota's sheet figures on one line, to choose between them |
| check | `check.mjs` | the self-check: settings agree, the test rota recounts independently, and each 26-line rule fails when its condition is broken (`node tooling/check.mjs`) |
| 3 · sheets | `supplied.mjs` via `regenerate.mjs` | the eight-page sheet for a grid; add the design to `SUPPLIED` |
| | `rules-sheet.mjs`, `summary-sheet.mjs`, `shortlist-sheet.mjs` | the rules reference (`../links-26-rules.pdf`), the one-page summary (`../links-26-summary.pdf`) and the two-page shortlist sheet (`../links-26-shortlist.pdf`) |
| 4 · decks and pack | `second-nature-decks.py` → `short-run-decks.py` (applying `second-edition-decks.py`'s edits), `in-step-decks.py`, `even-step-decks.py` → `deck-polish.py` (+ `rota-strip.mjs`); `deck-check.mjs`; `pack.py` | the presentations, built from a Second Nature template that is not shipped and then polished in place; the checker that reads every deck row back against the sheets; the zip |
| league | `league.mjs` | the weighted league on most of the factors the sheets compare — not the block length, nor the shortlist sheet's long days, early finishes and new Saturday times (`REF_IN_RANGE=1`; `DROP=fam`; `RUN_FIXED=1`; `WEIGHTS=` for other weights, such as the 24-line work's six-factor league) — the owner's weights, a judgement not a measurement |
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

## Second Nature — the first 26-line design (1 Oct 2026)

**`proposals/Second-Nature-SN-26-F2-a52d0f20.pdf`** (grid `proposals/Second-Nature-SN-26-F2.json`). The owner asked for a roster built
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

`deck-polish.py` polishes every design's decks, and refuses a deck it has already polished; `deck-polish.py "In Step"`
polishes one design's freshly built pair. Then export the PDFs (LibreOffice). Three things the decks say that the
sheet does not show directly:
- **Late finishes:** 42 a year is the minimum, because only the three closers the rules require finish after 23:00.
- **Weekends off:** every shipped deck's design has them never more than five weeks apart, and says so; today's are up
  to seven apart.
- **Finishes at 22:00 or later, per person:** 94 a year in all three shortlisted designs, 78 today. The sheet shows who is
  still on at 22:00 instead (7 · 5 · 5 on all three, today 4 · 2 · 3), so a deck slide that says its figures are all on the
  sheet quotes that one.

## Second Wind — Second Nature with the weekends spread (2 Oct 2026)

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
Second Nature ... the same family"). `proposals/Second-Wind-SW-26-F1-4bec8d8e.pdf`, grid `tooling/second-wind.json`.
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

## Second Sight — a fresh search with the weekends spread from the start (2 Oct 2026)

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
  but continue the search"). `proposals/Second-Sight-SS-26-F1-3c6aac4d.pdf`, grid `tooling/second-sight.json`, in the
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

## Second Look and Second Gear — the same restart, on two variations of the duty table (2 Oct 2026)

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
three places: the 55-hour worst case (56.8 against 56.3), the hours in any seven days on the fixed duties (49.7 against
50.0) and FF17's counts (9 backward and 12 forward against 10 and 13, the same margin of three).

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

**In the league** Even Step is second in four of the five versions: usual 86.6 behind In Step's 87.4; with the
proposals setting the scale 87.9 against 90.1; without familiar times 90.7 against 91.7; with the run scored on the fixed
rota 87.6 against 88.4. In the six-factor league it is third, 85.8, behind Second Look (88.3) and In Step (87.2), a
shade ahead of six designs tied at 85.7, Second Edition and Short Run among them. Adding it moved no other design's score in the usual league. The
league scores neither the closing shift nor long days, and its weekday fit and step are where Even Step loses its
point: counted even as lightly as the league's lightest factor, In Step's long earlies would put Even Step first of all
fifteen (`shortlist-sheet.mjs` computes the weight at which the order turns, from the league's own range).

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
(asserted row by row); and the league's turning weight. *The summary* stars three. *The rules sheet* and `RULES.md` carry
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

**Everything in one download:** `links-26-proposals.zip`, laid out as the 24-line pack
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
