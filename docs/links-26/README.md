# Links — December 2026, 26 lines

**From 1 Oct 2026 the December 2026 link is 26 lines, not 24.** Everything drawn for 24 lines is kept, unchanged, in
`../links-24/`, both for reference and in case the 24-line link comes back. This folder is for the work from here on.

The 24-line work is not wasted. The rules, the duty tables, the tooling and the designs all carry over. What has to
change is the arithmetic that depends on the number of lines.

## What is in this folder

The two link folders, `links-24` and `links-26`, share one layout (2 Oct 2026, owner: "consistent naming"):

| | What it is |
|---|---|
| `links-NN-proposals.zip` | everything for sharing, in one download |
| `links-NN-rules.pdf` | the rules every proposal is judged against |
| `links-NN-summary.pdf` | every proposal against today's link, on one page |
| `proposals/` | one design per three files: `<Name>-<CODE>-<fingerprint>.pdf` (the eight-page sheet), `<Name>-<CODE>.json` (the grid) and `<Name>-<CODE>-import.txt` (for the Links page) |
| `presentations/` | `<Name>-for-colleagues` and `<Name>-for-managers`, as `.pptx` and `.pdf` |
| `tooling/` | the scripts that build and check all of the above; `tooling/results/` holds the committed search outputs |
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

- **The rules, in their three tiers,** with the changes above: the 3 hard limits, the 9 December staffing rules
  and the 3 flexible rules. See `RULES.md`.
- **The shift-time sets** of the strongest 24-line designs, as starting points:
  - **Familiar Nine** (`../links-24/Familiar-Nine-F9-24-K31s.json`): every rule met, 14 of 20 weeks on one turn.
  - **Right Away** (`../links-24/Right-Away-FR-24-F34s.json`).
  - **Silva Lining** (`../links-24/Silva-Lining-SL-24-Hs.json`, version H of its series): 14 times, no fatigue warnings, a
    9-hour cap.
- **The judging.** Every figure comes from the app's own Links modules, which take the line count as a parameter.

## The tooling (`tooling/`, set up 1 Oct 2026)

The 24-line pipeline, copied and set to 26 lines. **`tooling/link.mjs` states the link once**: 26 lines, 5 cover weeks
(default lines 1, 6, 11, 16, 21), 21 working lines, the 44,100-minute contract, the 219-day ceiling, and the headcounts the
tables are built to (15 a weekday, 14 on a Saturday, 10 on a Sunday). Every script reads those from there; none writes
the number down. The 24-line tooling stays untouched in `../links-24/tooling/`, so that pack can still be rebuilt exactly.

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
| 1 · duty table | `final-table.mjs` | the best table for one day, by fit to the trains, under every rule; a proof unless `ANNEAL=1` |
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
| | `rules-sheet.mjs`, `summary-sheet.mjs` | the rules reference (`../links-26-rules.pdf`) and the one-page summary (`../links-26-summary.pdf`) |

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
TOP=1 MODE=rules node grow-from-24.mjs results/second-nature-table.json /tmp/sn ../../links-24/Silva-Lining-SL-24-Hs.json
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

**The presentations** (2 Oct 2026, owner: "use the Familiar Nine and Right Away presentations as a basis"; **cut to
the shortlist 3 Oct 2026**, owner: "only keep the shortlist's presentations, delete the rest"): `presentations/` holds a
colleague deck (15 slides) and a manager deck (10), as PowerPoint and PDF, for **Second Edition, Even Keel and Short
Run** only. They are the Familiar Nine decks, the template Right Away's were made from too, with every word and figure
that was Familiar Nine's replaced and the design untouched. Unlike the 24-line decks, they are BUILT here, in two steps:
`tooling/second-nature-decks.py` makes Second Nature's decks from the Familiar Nine files into `tooling/deck-template/`
(gitignored — Second Nature's decks are the template every shipped deck is built from, and since 3 Oct are not shipped
themselves; Second Wind's and Second Sight's decks and their builders were deleted the same day); then
`tooling/second-edition-decks.py` makes Second Edition's from that template, changing only what differs (the weekend
spacing, no week mixing earlies and lates, the rest-day breaks, the one-turn weeks, the weekly hours — its leave figures
are Second Nature's exactly); `tooling/even-keel-decks.py` makes Even Keel's, which change more because it sits on
Second Gear's table (the shift-time list, 44 late finishes with four to the close on a Saturday, the run, the rest and
the fit chart); and `tooling/short-run-decks.py` makes Short Run's by applying Second Edition's edits and then its own
— the run (5 on the fixed rota, up to 6 when a cover week falls badly, said both ways), the weekly hours and the pitch
lines. Every builder refuses if a slide no longer holds the text it expects, and every deck compares only with today's
link.
- **Figures:** `node tooling/deck-check.mjs --print` gives every figure from the sheets' own counts.
  `tooling/leave.mjs` gives the four leave figures (all three shortlisted designs: 14 days' leave buys 28 days off at
  best, 23.4 on average, 20 at worst, and four full weeks off takes 15; today 30 · 23.4 · 19 · 14). It is the 24-line
  decks' leave method as code, and `--check` shows it reproduces their published figures for today and Familiar Nine
  exactly.
- **Checked:** `node tooling/deck-check.mjs` reads the finished decks back. Every table row across the six decks agrees
  with the sheets and the leave model, and none is left unchecked (it prints the count).

Rebuild after any change to the rota:

```
python3 docs/links-26/tooling/second-nature-decks.py && python3 docs/links-26/tooling/second-edition-decks.py \
  && python3 docs/links-26/tooling/even-keel-decks.py && python3 docs/links-26/tooling/short-run-decks.py \
  && node docs/links-26/tooling/deck-check.mjs
```

Then export the PDFs (LibreOffice). Two things the decks say that the sheet does not show directly:
- **Late finishes:** 42 a year is the minimum, because only the three closers the rules require finish after 23:00.
- **Weekends off:** Second Nature's can be up to ten weeks apart (today seven), and its managers' deck lists that as a
  worry; Second Wind's are never more than five apart, which its decks give as a strength.

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
  and the longest rest, and never more than five days in a row on the fixed duties, for two more late finishes a year
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
| B | 14 · 14 | 214.6 | all kept | only with weekday duties to 9h 30m, and then every weekday fits at 48.1 (Second Nature: 29.3) |
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
`tooling/second-edition.json`. Better than or equal to every earlier design on every line the sheets compare:

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
1h 13m (1h 01m). On the sheets' own comparison lines it equals Second Edition everywhere and beats it on the run, which
is why it was given a name rather than folded into Second Edition's notes. Its presentations
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

## Notes for the whole set

**Full weekends off, per year (owner, 2 Oct 2026).** A longer rotation's larger count is not more weekends in a year, so
"7 in 26" against "4 in 20" made the reader divide. The sheets now say it per person per year, as late finishes and 06:20
starts already were:
- **page 1:** "About 14 full weekends off a year (today 10), 7 in 26 weeks, …";
- **page 2:** a "Full weekends off" row in *Each person's year, on average*, with the share of weeks (27%, today 20%);
  the rotation figure stays, relabelled "Full weekends off, in the rotation";
- **the summary:** under the count.

The weighted league scores weekends as a share of weeks for the same reason. The 24-line sheets were left as they
stood.

**Everything in one download:** `links-26-proposals.zip`, laid out as the 24-line pack
(`../links-24/links-24-proposals.zip`) was:
1. a *Read me first* note;
2. the one-page summary;
3. the rules;
4. the presentations;
5. every proposal sheet;
6. the import files;
7. the technical notes (`RULES.md` and this README).

`tooling/pack.py` builds it from this folder, every design in `regenerate.mjs`'s `SUPPLIED` list included, and stops
if a file is missing. The 24-line pack was zipped by hand, so it went stale after a re-render; this one is rebuilt by
running `python3 docs/links-26/tooling/pack.py` after any re-render. Its *Read me first* says the import files are
refused by the Links page until that page moves to 26 lines.

**Still 24 in the app.** `ROTATING_LINES = 24` in `links-design.js` is the Links page's own line count. It moves to 26 as
its own app release (owner, 1 Oct 2026). Until then the tooling passes 26 to every app function explicitly, and the
Links page itself still lays out 24 lines.
