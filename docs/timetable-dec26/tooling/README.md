# December 2026 timetable — the Trains page's data

Generates `trains-data.js` (repository root), which the Trains page (`trains.html`) compares.

## Inputs — never committed

| Input | What | Where from |
|---|---|---|
| `met.pdf` | Today's timetable, Marylebone – Aylesbury via Amersham (table 1) | Chiltern Railways' public timetable PDF, valid until 12 December 2026 |
| `main.pdf` | Today's timetable, the main line — Oxford, Birmingham, Aylesbury via High Wycombe (table 2) | Chiltern Railways' public timetable PDF, valid until 12 December 2026 |
| `met-dec26.pdf` | December's table 1 | Chiltern Railways' public timetable PDF, valid 13 December 2026 – 15 May 2027 |
| `main-dec26.pdf` | December's table 2 | Chiltern Railways' public timetable PDF, valid 13 December 2026 – 15 May 2027 |
| `sx.xlsx` / `so.xlsx` / `su.xlsx` | FALLBACK ONLY — the roster office's December 2026 Marylebone simplifiers | the roster office |

The December PDFs are the "Full Timetable PDF" of each line on Chiltern's website. Each table states
its own validity, one line per kind of day: weekdays from Monday 14 December, Saturdays from
Saturday 19 December, Sundays from Sunday 13 December. None of them mentions Christmas, so the page
does not either; its general caveat (check the journey planner) covers it.

The `.gitignore` here refuses all of them. The spreadsheets hold lengths, platforms, unit diagrams
and empty-stock moves: internal detail the public repository must not carry. The generator drops
every one of those fields, so the committed module holds only what a passenger timetable prints.

## Run

`pdftotext` (poppler) is needed, and `openpyxl` for the simplifier fallback. From the repository
root, with the inputs in a scratch folder `$IN`:

```
python3 -I docs/timetable-dec26/tooling/pdfparse.py $IN/met.pdf        $IN/met-cols.json
python3 -I docs/timetable-dec26/tooling/pdfparse.py $IN/main.pdf       $IN/main-cols.json
python3 -I docs/timetable-dec26/tooling/assemble.py $IN/met-cols.json  $IN/main-cols.json $IN/now.json
python3 -I docs/timetable-dec26/tooling/pdfparse.py $IN/met-dec26.pdf  $IN/met-dec-cols.json
python3 -I docs/timetable-dec26/tooling/pdfparse.py $IN/main-dec26.pdf $IN/main-dec-cols.json
python3 -I docs/timetable-dec26/tooling/assemble.py $IN/met-dec-cols.json $IN/main-dec-cols.json $IN/dec.json
python3 -I docs/timetable-dec26/tooling/build.py    $IN/now.json $IN/dec.json trains-data.js
```

The same two scripts read both issues of the books unchanged. For the fallback, replace the
December lines with
`python3 -I docs/timetable-dec26/tooling/simplifier.py $IN/sx.xlsx $IN/so.xlsx $IN/su.xlsx $IN/dec.json`;
`build.py` tells the two outputs apart by their shape.

Then `node --test trains-change.test.mjs trains-stations.test.mjs`. The last block of the first
holds the generated tables to facts checked by hand against the printed books — the departure
counts, the 10:36 to Banbury running on to Birmingham, where December's 10:36 stops, the weekday
basic hour. **If one of those moves, check the books before you change the test**: a new issue of
the books legitimately moves them, and a parser regression looks the same.

## What each step knows

- **`pdfparse.py`** reads the PDF's word positions. Every column position is derived from the
  `Operator` label of each block, because the two books are laid out at different offsets — a
  hard-coded position read the Met book and found nothing at all in the main-line one. Each column
  also records its block's **station rows in printed order** (`rows`): the one place the geography
  is written down — which branch follows which junction — and the source of `STATION_ORDER`.
- **`assemble.py`** joins a train continued across pages (`e` → `f`), keeps Chiltern trains that
  start or end at Marylebone, and folds a train printed in both books into one. A Mondays-and-Fridays
  and a not-Mondays-and-Fridays copy of the same train together run every weekday. It also keeps
  each train's **stops with times** (`timed_stops`): leaving Marylebone, the ARRIVAL at each stop
  (the first of a printed arr/dep pair); coming in, the DEPARTURE (the last). The Stations view's
  journey times and the basic-hour grid read these. Its output is `{ trains, order }`: the trains,
  and each book's station order (`row_order`, outward direction, longest block first).
- **`simplifier.py`** (fallback) reads the spreadsheets' arrival and departure columns. `+` in a
  time, and a class-5 headcode, mark empty stock.
- **`build.py`** writes each row as `[time, end, route, days, stops]`. From the books, a train in
  the main-line book or carrying the `H` note is the Aylesbury train via High Wycombe; from the
  simplifier, the route is read from the headcode and joined portions (`OXF RP` / `OXF FP`) are
  merged — its header says how. `STATION_ORDER` is the main-line book's rows, then the Amersham
  book's, a station in both (Aylesbury) taking its Amersham-book place — so every column of the
  basic hour reads downwards in travel order — and only stations some kept train calls at. A row
  only December's book prints goes after the row that precedes it there.

## December from the books (v24.80)

Until Chiltern published its December books, December came from the simplifier: a working document
with no calling points, compared against a public one. Two things changed when the books arrived,
and both are reasons the books are the right source:

- **Every December train has its stops**, so every station is answered in full. Before, a station
  trains run THROUGH could compare only the trains that end there, or said it was waiting
  (`decemberKnown` in `trains-stations.js` — still the rule for a stopless source).
- **Like-for-like times.** Measured against the books, every Amersham-line arrival into Marylebone
  was 3 minutes later in public than in the simplifier, the published weekday evening peak was
  reshuffled from the draft, and weekdays gained a train (157 → 158). Saturdays and Sundays matched
  the simplifier but for one Saturday train.

## Updating when a new issue arrives

Re-run every step, then update `SOURCES` in `build.py` to the new issue's validity, and
`CHANGE_DATE` if the timetable change moves. `CHANGE_DATE` is the first day of the new timetable.
`FURTHER_CHANGES_UNTIL` is the last day of any changes Chiltern says it will still make after that
(its timetable page said 10 January 2027 for this issue, with "significant changes over the Christmas
and New Year period"); until then the page says Christmas and New Year are not on it. Read it off
Chiltern's timetable page for each issue — the books do not carry it.
