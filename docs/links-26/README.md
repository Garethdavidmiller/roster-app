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
   - **Late finishes.** The best weekday tables all had five people finishing after 23:00. Allowing only the three closers
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

**The presentations** (2 Oct 2026, owner: "use the Familiar Nine and Right Away presentations as a basis"):
`presentations/Second-Nature-for-colleagues` (15 slides) and `-for-managers` (10), as PowerPoint and PDF, and the same
pair for Second Wind (`Second-Wind-for-…`). They are the
Familiar Nine decks, the template Right Away's were made from too, with every word and figure that was Familiar Nine's
replaced and the design untouched. Unlike the 24-line decks, they are BUILT here: `tooling/second-nature-decks.py`
makes Second Nature's from the Familiar Nine files, and `tooling/second-wind-decks.py` makes Second Wind's from those,
changing only what differs between the two rotas (weekend spacing, rest-day breaks, one-turn weeks, the best leave
stretch, the weekly hours). Both refuse if a slide no longer holds the text they expect, and both compare only with
today's link.
- **Figures:** `node tooling/deck-check.mjs --print` gives every figure from the sheets' own counts.
  `tooling/leave.mjs` gives the four leave figures (Second Nature: 14 days' leave buys 28 days off at best, 23.4
  on average, 20 at worst, and four full weeks off takes 15; Second Wind: 27 at best, otherwise the same). It is the 24-line decks' leave method as code, and `--check` shows it
  reproduces their published figures for today and Familiar Nine exactly.
- **Checked:** `node tooling/deck-check.mjs` reads the finished decks back. All 102 table rows across the four decks agree with
  the sheets and the leave model, and none is left unchecked.

Rebuild after any change to the rota:

```
python3 docs/links-26/tooling/second-nature-decks.py && python3 docs/links-26/tooling/second-wind-decks.py \
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

**Full weekends off, per year (owner, 2 Oct 2026).** A longer rotation's larger count is not more weekends in a year, so
"7 in 26" against "4 in 20" made the reader divide. The sheets now say it per person per year, as late finishes and 06:20
starts already were:
- **page 1:** "About 14 full weekends off a year (today 10), 7 in 26 weeks, …";
- **page 2:** a "Full weekends off" row in *Each person's year, on average*, with the share of weeks (27%, today 20%);
  the rotation figure stays, relabelled "Full weekends off, in the rotation";
- **the summary:** under the count.

The weighted league scores weekends as a share of weeks for the same reason. The 24-line sheets were left as they
stood.

 `links-26-proposals.zip`, laid out as the 24-line pack
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
