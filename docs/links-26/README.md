# Links — December 2026, 26 lines

**From 1 Oct 2026 the December 2026 link is 26 lines, not 24.** Everything drawn for 24 lines is kept, unchanged, in
`../links-24/`, both for reference and in case the 24-line link comes back. This folder is for the work from here on.

The 24-line work is not wasted. The rules, the duty tables, the tooling and the designs all carry over. What has to
change is the arithmetic that depends on the number of lines.

## Settle these first

Each of these changes every design, so it is worth having the answer before drawing anything:

| Question | What 24 lines assumed |
|---|---|
| How many of the 26 are **cover weeks** (for leave and sickness)? | 4 (one in 6) |
| How many on duty each day, Monday to Saturday? | 14, with 15 on Tuesday in the latest designs |
| Is **Sunday** still covered by overtime, and with how many? | 10 on duty, all as overtime |
| Do the **contracted hours** stay at 35 a week? | 35 |
| Is the target still **217–219 contracted days a year**? | 217–219, to match Familiar Nine and today |

## The arithmetic that changes

With **W** working lines (26 less the cover weeks), the Monday-to-Saturday duties must add up to the contract
exactly:

- **Contract minutes** = W × 35 h × 60 = **W × 2,100**. At 24 lines this was 20 × 2,100 = 42,000.
- **Days a year** = (Mon–Sat duties + 4 × cover weeks) ÷ 26 × 365 ÷ 7.

*Worked example, if cover stays at 4.* W = 22, so the contract is 46,200 minutes. About **93 duties** gives 218.6 days
a year, at an average of 8h17. At 24 lines the equivalent was 85 duties, 219.4 days and 8h14. That makes about 8 more
Monday-to-Saturday duties to place, which is more than one extra person a day.

## What carries over unchanged

- **The rules, in their three tiers.** That is the 3 hard limits, the 9 December staffing rules and the 3 flexible
  rules. See `../links-24/README.md` and `../LINKS_DEC2026_PLAN.md`.
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
| `anneal.mjs` | `LINES = 24`, and the cover lines `SPARE = {1, 7, 13, 19}` |
| `render.mjs` | the import text (`length: 24`), the `k <= 24` loops, and "in 24" in the page text |
| `report-data.mjs` | the default `lines = 24` in `weekdayFit` and `weekdayFloorFit` |
| `final.mjs`, `deck-check.mjs` | `assess(p, 24)` and `figures(p, 24, …)` |
| the Silva Lining scripts | `assess(p, 24)` and `h55Worst(p, 24)` |
| `fresh.mjs` | the cover-spacing check (`L[0] + 24`) |

**Most of the other 24s in that tooling are hours of the day**, such as `new Array(24)` and `24 * 60`. Leave those
alone.

**Suggested route.** Copy the tooling into `links-26/tooling/` rather than editing `links-24/` in place, so the
24-line pack can still be rebuilt exactly. Then, in the copy, replace every line-count literal with one constant.
`links-design.js` is the model for that: it states the number once and fails a test if it is written down anywhere
else.
