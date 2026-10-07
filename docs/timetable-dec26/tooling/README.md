# December 2026 timetable — the Trains page's data

Generates `trains-data.js` (repository root), which the Trains page (`trains.html`) compares.

## Inputs — never committed

| Input | What | Where from |
|---|---|---|
| `met.pdf` | Current timetable, Marylebone – Aylesbury via Amersham | Chiltern Railways' public timetable PDF |
| `main.pdf` | Current timetable, the main line (Oxford, Birmingham, Aylesbury via High Wycombe) | Chiltern Railways' public timetable PDF |
| `sx.xlsx` / `so.xlsx` / `su.xlsx` | December 2026 Marylebone simplifiers — weekdays, Saturdays, Sundays | the roster office |

The `.gitignore` here refuses all of them. The spreadsheets hold lengths, platforms, unit diagrams
and empty-stock moves: internal detail the public repository must not carry. The generator drops
every one of those fields, so the committed module holds only what a passenger timetable prints.

## Run

`pdftotext` (poppler) and `openpyxl` are needed. From the repository root, with the inputs in a
scratch folder `$IN`:

```
python3 -I docs/timetable-dec26/tooling/pdfparse.py   $IN/met.pdf  $IN/met-cols.json
python3 -I docs/timetable-dec26/tooling/pdfparse.py   $IN/main.pdf $IN/main-cols.json
python3 -I docs/timetable-dec26/tooling/assemble.py   $IN/met-cols.json $IN/main-cols.json $IN/now.json
python3 -I docs/timetable-dec26/tooling/simplifier.py $IN/sx.xlsx $IN/so.xlsx $IN/su.xlsx $IN/dec.json
python3 -I docs/timetable-dec26/tooling/build.py      $IN/now.json $IN/dec.json trains-data.js
```

Then `node --test trains-change.test.mjs`. Its last block holds the generated tables to facts
checked by hand against the printed books — the departure counts, the 10:36 to Banbury running on
to Birmingham, the weekday basic hour. **If one of those moves, check the books before you change
the test**: a new simplifier issue legitimately moves them, and a parser regression looks the same.

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
- **`simplifier.py`** reads the spreadsheets' arrival and departure columns. `+` in a time, and a
  class-5 headcode, mark empty stock.
- **`build.py`** keeps passenger trains, merges joined portions (`OXF RP` / `OXF FP` are one
  train), and reads the Aylesbury route from the headcode — its header says how. It writes each row
  as `[time, end, route, days, stops]`; `stops` is `''` for every December row, because the
  simplifier carries no calling points. `STATION_ORDER` is the main-line book's rows, then the
  Amersham book's, a station in both (Aylesbury) taking its Amersham-book place — so every column
  of the basic hour reads downwards in travel order — and only stations some kept train calls at.

## When Chiltern's December books are published

They hold December's stops, which the page is waiting for: until then a station that trains pass
THROUGH says December is "not published yet" (`decemberKnown` in `trains-stations.js`). Download the
December PDFs for both lines, run `pdfparse.py` and `assemble.py` on them as for today's, and
teach `build.py` to fill each December row's `stops` from that output (matched on the Marylebone
time and end). Every station then answers by itself — no page change is needed.

## Updating when a new simplifier arrives

Re-run all five steps, then update `SOURCES` in `build.py` if the issue changed (the weekday plan
is a draft at the time of writing). The `CHANGE_DATE` there is the first day of the new timetable.
