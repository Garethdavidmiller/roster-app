# The rules — a 6-line bilingual link

**Set on 27 November 2026, by the owner.** Every 6-line option for the bilingual link is judged against this one list,
and `tooling/check.mjs` checks each option against it; `tooling/rules.mjs` is the same rules as arithmetic, and each
rule there names its number here. The station's hours and the fatigue assessment are the ones the CEA link uses
(`../links-26/RULES.md`), so where a rule below borrows one it says so.

## Facts the rules start from

- **The bilingual contract is being phased out.** No new ones are added, and bilingual cover is not needed at all times.
- **Today's link is 8 lines** (`bilingualRoster` in `roster-cycle-data.js`): 6 with fixed duties and 2 cover weeks. Its
  duties start at 07:00 or later and finish before the close, except Saturday's 14:25–23:55 and Sunday's 15:25–23:25.
- **A weekend is a line's Saturday and the next line's Sunday**, because the roster week starts on a Sunday. A cover
  week's Sunday is not rostered, so it counts as off; a cover week's own Saturday depends on what that week is given.

## The rules every option keeps

| | Rule |
|---|---|
| R1 | **4 days and 35 hours, Monday to Saturday, on every line.** Not an average: every week. The owner's view is that losing this would be the biggest reason to reject anything new. A Sunday is rest-day working on top. |
| R2 | **6 lines: 5 with fixed duties and 1 cover week.** A cover week is four contracted duties, Monday to Saturday, placed by the roster clerk; its Sunday can be worked as overtime, and every worst case counts it as worked. |
| R3 | **The quarter-hour rule.** Every duty starts and finishes on :00, :15, :30 or :45, unless it opens the station (06:20, or 07:15 on a Sunday) or closes it (23:55, or 23:25 on a Sunday). A duty that opens or closes keeps the station's own times at both ends, as the CEAs' 06:20–14:20 does. |
| R4 | **Duty times.** A duty starts at 07:00 or later (the wildcard's openings at 06:20, W1). A weekday duty finishes by 23:30: bilingual duties do not close on a weekday. Saturday may close, at 23:55. A Sunday duty is 8 to 9 hours (`../links-26/RULES.md`, S8) and finishes by the 23:25 close. |
| R5 | **Weekends.** Each person works 1 Saturday in 2, as today, and 1 Sunday in 3: two bilingual colleagues on every Sunday, as today, one early and one late. With 6 people that is more Sundays each than today's 1 in 4, and the owner chose it over 1 in 6. |
| R6 | **Fatigue.** No fatigue risk factor present in the app's assessment (`links-fatigue.js`, the CEA link's). At least 12 hours between duties, and no more than 13 days worked in a row in the worst case. |
| R7 | **Cover through the day.** Every day from Monday to Saturday has an early and a bilingual colleague until at least 23:30, as today. Monday to Friday each has 3 or 4 on, not counting cover. |

## The three options

| | Rule |
|---|---|
| A1 | **Option A stays as close to today as it can.** Today's lines 2 and 4 are kept unchanged, and the rest are built from today's duties. |
| B1 | **Option B gives whole weekends off without losing weekend work.** The same Saturdays and Sundays as Option A, the working ones paired into two weekends of both days. |
| B2 | **Option B has a 07:00 start every day, Monday to Saturday**, as today has. |
| W1 | **The wildcard is Option B with every 07:00 start opening the station at 06:20 instead**, each duty its length kept. |
| W2 | **As the incentive for the earlier starts, each Sunday is an hour longer**: 9 hours instead of 8. |
| W3 | **The wildcard keeps every rule too.** Option B is accepted only when its wildcard does, so the two are a matched pair. |

## What the numbers count

- **Weekend extra pay**, in hours of basic pay: a rostered Saturday's hours sit inside the 35 and are paid a quarter more;
  a Sunday is rest-day working at time and a half on top. So one Sunday hour is worth six Saturday hours.
- **Per year** means for one person: a figure for the rotation times 52 weeks over its number of lines, rounded.
- **Duty times not on today's roster** count each distinct time once, whichever day it falls on.

## The search

`tooling/search.mjs` looks for options inside these rules and prefers, in this order of weight: fewer duty times not
on today's roster, fewer distinct times, no lone rest day between two working days, steady weeks (no line mixing
earlies and lates more than four hours apart), more shifts' rest from the 13-shift limit, and Friday-to-Sunday breaks.
For Option A it also prefers cells equal to today's; for Option B, no more 07:00 starts than one a day.

**Tried and set aside (27 November 2026):** both of Option B's working weekends in the daytime (`search.mjs B-daytime`).
It keeps every rule but R5's late Sunday, and leaves nobody bilingual after 16:00 on a Sunday and one colleague on each
weekday evening.
