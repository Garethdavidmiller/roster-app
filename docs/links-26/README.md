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

## Where the code assumes 24

**The app itself.** `ROTATING_LINES = 24` in `links-design.js` is the Links workspace's one declaration of the
rotation length. Changing it to 26 is an **app release**: it needs a version bump, the static fallbacks that
`links-rotation-parity.test.mjs` names, and a re-measure. Its header records the last two moves (28 → 22 → 24).
Until it changes, the Links page lays out 24 lines.

**The 24-line tooling** (`../links-24/tooling/`, `../links-24/silva-lining/search/`). The line count is written into
these files:

| File | Where |
|---|---|
| `anneal.mjs` | `LINES = 24`, and the cover lines `SPARE = {1, 7, 13, 19}` — five covers at 26 lines |
| `render.mjs` | the import text (`length: 24`), the `k <= 24` loops, and "in 24" in the page text |
| `report-data.mjs` | the default `lines = 24` in `weekdayFit` and `weekdayFloorFit` |
| `final.mjs`, `deck-check.mjs` | `assess(p, 24)` and `figures(p, 24, …)` |
| the Silva Lining scripts | `assess(p, 24)` and `h55Worst(p, 24)` |
| `fresh.mjs`, `report-data.mjs` | the cover-spacing check (`L[0] + 24`) and the count of four in the cover rule |

**Most of the other 24s in that tooling are hours of the day**, such as `new Array(24)` and `24 * 60`. Leave those
alone.

**Suggested route.** Copy the tooling into `links-26/tooling/` rather than editing `links-24/` in place, so the
24-line pack can still be rebuilt exactly. Then, in the copy, replace every line-count literal with one constant.
`links-design.js` is the model for that: it states the number once and fails a test if it is written down anywhere
else.
