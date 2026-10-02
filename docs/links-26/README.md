# Links — December 2026, 26 lines

**From 1 Oct 2026 the December 2026 link is 26 lines, not 24.** Everything drawn for 24 lines is kept, unchanged, in
`../links-24/`, both for reference and in case the 24-line link comes back. This folder is for the work from here on.

The 24-line work is not wasted. The rules, the duty tables, the tooling and the designs all carry over. What has to
change is the arithmetic that depends on the number of lines.

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
| | `rules-sheet.mjs`, `summary-sheet.mjs` | the rules reference (`../December-2026-Rules.pdf`) and the one-page summary |

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

**What the test rota shows** (`tooling/results/test-rota-RT26-7.json`, from `tooling/results/test-table.json`). It is
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

**`Second-Nature-SN-26-F2-a52d0f20.pdf`** (grid `Second-Nature-SN-26-F2.json`). The owner asked for a roster built
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
`presentations/Second-Nature-for-colleagues` (15 slides) and `-for-managers` (10), as PowerPoint and PDF. They are the
Familiar Nine decks, the template Right Away's were made from too, with every word and figure that was Familiar Nine's
replaced and the design untouched. Unlike the 24-line decks, they are BUILT here: `tooling/second-nature-decks.py`
makes both from the Familiar Nine files, and refuses if a slide no longer holds the text it expects.
- **Figures:** `node tooling/deck-check.mjs --print` gives every figure from the sheets' own counts.
  `tooling/leave.mjs` gives the four leave figures (14 days' leave buys 28 days off at best, 23.4 on average, 20 at
  worst; four full weeks off takes 15). It is the 24-line decks' leave method as code, and `--check` shows it
  reproduces their published figures for today and Familiar Nine exactly.
- **Checked:** `node tooling/deck-check.mjs` reads the finished decks back. All 51 table rows agree with the sheet and
  the leave model, and none is left unchecked.

Rebuild after any change to the rota:

```
python3 docs/links-26/tooling/second-nature-decks.py && node docs/links-26/tooling/deck-check.mjs
```

Then export the PDFs (LibreOffice). Two things the decks say that the sheet does not show directly:
- **Late finishes:** 42 a year is the minimum, because only the three closers the rules require finish after 23:00.
- **Weekends off:** they can be up to ten weeks apart (today seven); the managers' deck lists it as a worry.

**Still 24 in the app.** `ROTATING_LINES = 24` in `links-design.js` is the Links page's own line count. It moves to 26 as
its own app release (owner, 1 Oct 2026). Until then the tooling passes 26 to every app function explicitly, and the
Links page itself still lays out 24 lines.
