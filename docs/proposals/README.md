# Link proposals — December 2026

The CEA link proposals drawn for the December 2026 timetable change, each a PDF with its own
**identity** so it can be named in a room: a name, a code that says how it was built, and a
fingerprint of the exact cells so a printout can never be confused with a variant. The same
identity is in every page footer. Both were built and judged by the app's own Links modules
(`runDesignChecks`, `assessFatigue`, `assessHardLimits`, `scoreOrder`, `weeklyHours`) at v23.29,
and every figure in a PDF is computed from the cells it shows — nothing is typed.

| Proposal | Code · fingerprint | What it is | Factors present | Longest run | Weekends off |
|---|---|---|---|---|---|
| **Same Turns** | `ST-24-B7 · d15e1b74` | Today's 20-line link widened to 24 in today's own shift times and week shapes | 1 (FF19, one jump) | 6 | 6 in 24 |
| **By the Book** | `BB-24-D7 · 0f14abce` | The workspace's December duty table (the owner's rules in table form), the rotation searched for the ORR factors | **0** | 6 | 6 in 24 |
| **Quarter To** | `QT-24-Q34 · 70cf9874` | *Same Turns* with the weekday closer at 15:45 and no duty over 8h40 — the two 06:20 openers run on to Saturday's own opening times to keep the contract, so the closer is the only time nobody works today | **0** | 6 | 6 in 24 |
| **Eight Forty** | `EF-24-E21 · 0cf19f56` | *By the Book* with no duty over 8h40 — the December table re-solved under the same rules with the ceiling at 8h40 (its earlies had run to 9h30), then the rotation searched for the ORR factors as *By the Book* was | **0** | 6 | 6 in 24 |
| **By the Book 2** | `B2-24-G21 · 02f3c005` | *Eight Forty* with **the ticket office written in** — two `14:00-22:30` a day Mon–Sat and two `13:30-22:00` on Sunday, fixed before the search; demand fit ahead of the count of times. Saturday's fit is the best in the folder (8.1), Sunday's the price (35.8) | **0** | 6 | 5 in 24 |
| **Weekday Lates** | `WL-24-EXT · a52ec588` | **Supplied as a Word table**, not searched — weekday lates at 16:25, Saturdays left alone | 5, or **4 as rostered** | 9 | 6 in 24 |
| **Fifteen Turns** | `FT-24-EXT · 9a028392` | **Supplied as a grid**, not searched — the shortest turn table yet and a perfect cover spread, but **it does not clear two gates** | 7 | 9 | 2 in 24 |
| **Fifteen Turns Repaired** | `FT-24-R21 · b76bf9e1` | The same design with both gates **repaired** and the rotation re-searched — every duty, headcount and coverage hour unchanged | **1** | 6 | 6 in 24 |
| **Weekday Lates 2** | `WL2-24-R21 · 33f70893` | Weekday Lates with the `08:30–17:00` turns re-timed into the evening to cover the 17:00 peak, then re-searched | **1** | 6 | 6 in 24 |
| **Weekday Lates 3** | `WL3-24-F7 · a6234195` | The same evening fix with **weeks 13–17 kept exactly as written**, then searched fatigue-first | **1** (FF19, at its floor) | 6 | 4 in 24 |
| **Weekday Lates 4** | `WL4-24-F7 · f0d403d6` | The same evening fix again, with **weeks 14–17 kept in order on their own line numbers** — week 13 the one that moves | **1** (FF19, at its floor) | 7 | 6 in 24 |
| **Weeks 17-18 Swapped** | `WS-24-EXT · 0bebb675` | **Supplied as a grid**, not searched — cover week moved to 18, midday turn at `12:00–20:30`. Clears every hard gate; not yet shape-searched | 5 | 9 | 6 in 24 |
| **Targeted Fatigue Redo** | `TF-24-EXT · 8eef9a13` | **Supplied as a grid**, not searched — *Weeks 17-18 Swapped* re-ordered BY HAND to cut fatigue. Same duties, same days, identical coverage; MRSF cleared, FF11 depends on how a cover week is worked | 4, or **3 as rostered** | 9 | 5 in 24 |
| **Three Mondays** | `TM-24-EXT · fe90c0b8` | **Supplied as a grid**, not searched — the *Targeted Fatigue Redo* with three Monday duties rotated. Breaks the eight-day run across weeks 14–15; the binding figures are elsewhere and do not move | 4, or **3 as rostered** | 9 | 5 in 24 |
| **Cover at Seventeen** | `C17-24-EXT · edc1b731` | **Supplied as a grid**, not searched — *Three Mondays* with lines 17 and 18 swapped back, so the cover week returns to 17. **FF11 clears** for the first time in this line | **3** (on both readings) | 9 | 5 in 24 |
| **Saturday Four** | `S4-24-EXT · 481ba9ed` | *Cover at Seventeen* with **Saturday rebuilt** on its own minute budget — nine turns down to four, six start times down to three, weighted to the late for Wembley. The first duty change in this line | **3** (on both readings) | 9 | 5 in 24 |
| **Clean Final** | `CF-24-EXT · 6d21169b` | **Supplied as a Word table**, not searched — the Weekday Lates line revised again: the 9h10 Saturday closer shortened to 8h40 and the cover week back at 17 | 3 | 9 | 4 in 24 |
| **Clean Final Tuned** | `CFT-24-M3 · ae1a15bd` | *Clean Final* with **three cells retimed** and nothing else — Saturday's demand fit 28.5→20.5 and Sunday's 62.4→44.9, every headcount, cover week and contracted hour unchanged | 3 | 9 | 4 in 24 |
| **Clean Final Ten** | `TN-24-R7 · 84b60df9` | *Clean Final Tuned* with **a tenth Sunday duty added** (`15:25–23:25`) and the wheel then **reordered, whole weeks only** — Sunday's fit 44.9→35.3, ten on a Sunday met, every week pattern intact | **2** | 6 | 5 in 24 |

The four searched proposals — *Same Turns*, *By the Book*, *Quarter To*, *Eight Forty* — clear every hard rule — Chiltern's 13-day limit, twelve hours between duties, the exact
35-hour contracted week — and meet the December staffing shape (four to open, three through to
the close and four on a Saturday, five still on at 22:00, fourteen on a Saturday, ten on a Sunday,
four cover weeks at lines 1, 7, 13, 19). They differ on exactly one thing, and it is a people
question rather than a rules one: *Same Turns* keeps 15 turns people already work and does not meet
the late-shorter-than-early lever; *By the Book* meets every rule and none of its 19 turns is a
time anyone works today. Each PDF states this on its page 6. **The two 12 Sep proposals are comparison examples, not base rules** (owner, 13 Sep 2026): the 15:45
closer and the 8h40 cap are briefs to set beside *Same Turns* and *By the Book*, and neither changes the
December rules the workspace pins in `links-default-targets.js`. *Quarter To* (12 Sep 2026) is *Same Turns*
with two things asked for — the closer at 15:45, nothing over 8h40 — and it clears every fatigue factor
where *Same Turns* has one present; its open question is the cap's reach, since Saturday's 14:45–23:55
(9h10) and Sunday's 14:30–23:25 (8h55) are today's own turns carried over unchanged, and shortening
Saturday's closer leaves 7,004 minutes a weekday that no table of today's turns reaches. *Eight Forty*
(12 Sep 2026) is *By the Book* under the cap, and the cap is not a trim there: 14 duties paying 7,000
minutes average 8h20, so a ceiling twenty minutes above the mean forces every long early to 8h30–8h40 and
every late to 7h45–8h25, and the owner's late-shorter-than-early lever shrinks to five minutes at the
boundary. Two of *By the Book*'s pins gave way to arithmetic and the PDF says so on page 6: a Saturday
cannot average its earlies more than 24 minutes longer than its lates (this table has 20; the rule asks
30), and four distinct opener finishes cost twelve off-quarter times against *By the Book*'s three. Its
weekday demand fit (75.3) is the worst of the four; its rotation matches *By the Book* and *Quarter To* on
every rule figure.

**By the Book 2** (`B2-24-G21 · 02f3c005`) is *Eight Forty* with **the ticket office written in**: two
`14:00-22:30` turns every day Monday to Saturday and two `13:30-22:00` on a Sunday, fixed before anything
else was searched (owner, 22 Sep 2026). Same 8h40 ceiling, same December rules, and **demand fit ahead of
the count of distinct times** — the owner's ordering, and the search's pick order.

**What the pinned turns did to the rules, stated rather than smoothed over.** An 8h30 late duty demands,
under By the Book's ordering pin, that *every other early be longer than 8h30* — and an 8h40 ceiling
cannot give four distinct openers above 8h30. That is the whole reason *Eight Forty*'s longest late is
8h25. So the two ticket-office turns are treated as an operational GIVEN: enumerated around
(`PIN_N`/`PIN_MIN` on `table-book.mjs`), and outside the early-versus-late comparison, while every other
rule — headcount, window, the :05/:10 grid, the cover curve — still counts them. Two further pins were
read differently for them and both readings are on the sheet: *"five still on at 22:00"* is a **floor**
(four Saturday closers plus the pair make six by arithmetic, and the rule exists so the evening is not
thin, which six does not offend), and a pinned turn finishing **at** 22:00 counts as on at 22:00 (two
people working to the hour are what the rule is for) while design duties keep the strict reading, so
*Eight Forty*'s own Saturday assesses exactly as before.

**The table, and what fit-first bought:**

| | weekday | Saturday | Sunday |
|---|---|---|---|
| demand fit (lower is better) | **67.9** (Eight Forty 70.4) | **8.1** (16.4) | **35.8** (20.9) |
| distinct turns · starts · finishes | 11 · 7 · 9 | 11 · 9 · 9 | 8 · 5 · 7 |
| minutes | 7,000 | 7,000 | 4,780 (Eight Forty 4,820) |
| longest duty | 8h40 | 8h40 | 8h40 |

Saturday is the clear win — a fit of 8.1 is the best of any table in this folder, and the two 14:00 starts
land on the Wembley afternoon. **Sunday is the clear cost**, and it should be read as one: the pair sits
across Sunday's quietest afternoon hours, so the fit is worse than *Eight Forty*'s by a wide margin, and
Sunday pays 40 fewer minutes than that table did. The weekday is a shade better on fit and identical on
the count of times. The 8h30 cap the owner first asked for is **impossible** under these rules — that
finding is in the tooling section below — which is why this sits at 8h40.

**How the table was found, and why not the way Eight Forty's was.** `table-book.mjs`'s own anneal
walks lengths and start times together; at a tight cap or with two duties pinned it cannot find tables
that provably exist (it reported "no feasible weekday table" at 8h35 and 8h30, where direct placement
finds one at 8h30). `place-structures.mjs` enumerates every legal set of LENGTHS and places each one —
139,017 weekday structures with the pins out, of which 12 placed feasibly; 18,616 Saturday, 931 placed;
24,942 Sunday at its total, 3,601 placed. `assemble-table.mjs` writes the record the anneal and the
renderer read. Then the rotation was searched fatigue-first exactly as *By the Book* and *Eight Forty*
were: `MODE=rules node anneal.mjs G 100000 5 <seed>`, seeds 7, 13, 21 and 34.

**The rotation.** Four seeds; seed 21 is the one kept, and it is the only one of the four that clears
every fatigue factor — **zero present, FF19 at 0**, longest run 6, worst seven-day total 51.9h, no rest
under 12 hours, 11 of 20 weeks on a single turn. The other three carry one factor (FF19 at 3, 4 and 5)
in exchange for a sixth weekend off, and the family's documented pick — rules first, weekends after —
takes the zero. That puts *By the Book 2* level with *By the Book* and *Eight Forty* on the ORR panel,
with the ticket office rostered on every day of the week.

**What it did not do:** the whole-rotation count of distinct times is **26, the same as *Eight Forty***.
Fit-first bought Saturday and cost Sunday; it did not shrink the vocabulary, and the sheet says so.

**`EXT` is not a search code.** *Weekday Lates* arrived from outside the workspace as a Word table and
was assessed here; there is no table variant, no seed and nothing to reproduce, which is what the `EXT`
suffix says and what its method page states instead of claiming a search. Everything else is identical —
the same modules judge it, and its PDF's figures are computed from its own cells like the other two.
**It clears every hard gate** (35h to the minute, no rest under 12h, longest run 9 against the 13-day
limit, no unstaffed hour in the window) and **13 of its 18 turns are times people already work** — the
other five (`07:00-15:30`, `08:00-16:00`, `08:30-17:00`, `10:30-19:00`, `16:25-23:55`) are new.
*(Corrected 17 Sep 2026: this said "every one of its 18 turns", on the strength of a page-1 tile that
read `distinctTimes of T.distinctTimes` — this design's turn COUNT over today's — under the caption
"shift times are today's". The two counts were both 18, so the tile printed "18 of 18" and the claim
looked checked. It was the same shape as the hardcoded badge row: true by coincidence. The tile now
counts the actual intersection, and every PDF here has been re-rendered.)*
Three things it does not meet, each stated on its own pages rather than omitted: lates run longer than
earlies, it carries four cover weeks rather than five, and its weekdays are not equal — Mon 6,225 minutes
against Thu 7,780, though Mon–Sat still totals exactly 42,000.

**Fifteen Turns is the first proposal here that is NOT runnable as drawn**, and it is listed anyway
because a refused design is evidence too. Two gates: one rest of **11h15** (line 7's Saturday
12:00–20:00 into line 8's Sunday 07:15–15:45) and **60 minutes over** the contracted week — Mon–Sat
totals 42,060 minutes against 20 × 35h = 42,000, and the contract is an equality rather than a floor.
Both are refusals in the workspace, not findings. What it does better than anything else: **fifteen
distinct turns** (against 18 and 19), cover weeks **perfectly even at 6, 6, 6, 6**, and a week-to-week
step of 2h16. It is worth keeping as the shape to aim at once those two are repaired.

**It also found a real defect in this tooling.** Page 1's badge row was hardcoded to
`0 hard-limit breaches` / `0 rests under 12h` / *"exactly the contract"*, and the first four proposals
all happened to satisfy every one — so a green tick was indistinguishable from a checked one. This
design does not, and the page asserted both gates it fails as met. Every chip is now derived, the
surplus is computed from MINUTES (`exSunday` is rounded to 2dp, and 0.01h is 14 minutes on a 24-line
rotation), and the 12-hour row goes amber when it is breached. Re-checked: the other four still read
*exactly the contract*, at 0 minutes each.

**Repairing Fifteen Turns took one duty.** `12:00–20:00` on line 7's Saturday is the only place that
turn appears anywhere in the rotation, and it sat in BOTH failures; shortening it to `12:00–19:00`
removes exactly the 60 surplus minutes and lifts the 11h15 rest to 12h15. Saturday cover at 19:00
goes from seven to six and nothing else in the table moves.

Then the SHAPE was searched and the staffing was not — `tooling/optimise.mjs`, whose only two moves
(swap two lines' duty within one day column, swap two whole lines) leave each day's multiset of
duties exactly as it was. Coverage, headcounts, the duty table and the contracted week are therefore
invariant **by construction**, and the script asserts all three rather than trusting the argument;
the hour-by-hour heat map is identical to the design as supplied. Result: run 9→6 (inside the design
target of 7, not merely the 13-day limit), weekends off 2→6, one-turn weeks 12→16, and fatigue
factors present **7→1**.

It deliberately does NOT reuse `anneal.mjs`'s `evaluate`, which fixes the cover weeks at lines 1, 7,
13 and 19: this design has them at 6, 12, 18, 24, and scoring it with the wrong spare set reads four
cover weeks as working lines. The WEIGHTS are anneal's, unchanged; only the working set is derived.

**Four seeds gave four answers and the lowest score was not taken.** All four clear every hard gate
and all four keep the coverage curve identical, so the choice was between advisory outcomes rather
than safety. Seed 34 scores lowest on the blended objective (a gentler 2h21 step) and seed 7 gives a
seventh weekend off; **seed 21 is the only one that also clears FF15**, leaving one factor present,
and that is the one kept — fewer factors present is what the ORR panel reports and what a reader
acts on. All four are in that PDF's own alternatives table with what each costs.

**Weekday Lates 2** (`WL2-24-R21 · 33f70893`) answers a gap the owner found in Weekday Lates: nine
duties ran `08:30–17:00` and all nine finished at the same moment, so weekday cover fell from eight
to ten people at 16:00 to **six** from 17:00 — at the hour the December curve peaks (≈140 cars against
110 at 16:00). Cover was falling as demand rose. Line 9's week moved to `12:30–21:00` and line 16's
Mon–Wed to `14:00–22:30`; both replacements are 8h30, the same length as the turn they replace, so the
contracted week is still paid to the minute and both lines stay one-turn weeks. Then the shape was
re-searched. **17:00–21:00 goes 6, 6, 7, 9, 8 → 8, 8, 9, 10, 9** and **08:00–11:00 falls 7, 9, 8, 7, 8
→ 5, 7, 6, 6, 7** — at a fixed 35-hour week an hour added to the evening comes from somewhere, and both
directions are on its pages. Monday morning at five is the thinnest point and the thing to weigh.

**Weekday Lates 3** answers "protect weeks 13–17 and get the factors to zero". Zero is not
reachable, and the reason is arithmetic rather than effort: the survivor is **FF19**, successive
start times varying by more than two hours, and **no rotation containing both early and late weeks
can score zero on it** — going round the cycle you must cross from earlies to lates and back, and
each crossing is by definition a jump over two hours. Two is the floor for this mix of turns; three
is the fewest three seeds found, down from seven. Everything else cleared.

**The five weeks are kept to the letter and MOVED**: 13, 14, 15, 16 and 17 are now lines 21, 3, 6,
24 and 1, every one unedited. That move is what made it possible. Week 13 works Tue–Sat and week 14
Sun–Mon, so pinned adjacent they form one 58.9-hour seven-day window that nothing else in the grid
can break and MRSF's 55-hour row can never clear; separated, it drops to 51.1. **If those weeks must
also stay at lines 13–17, the floor is two factors, not one** — that is a property of the block, not
a limit of the search, and `optimise.mjs`'s `FREEZE_POS` switch is what distinguishes the two
readings of "protect". **There is a third reading, and *Weekday Lates 4* is it** (22 Sep 2026):
hold the four weeks that *can* be held at their own line numbers and let week 13 — the one end of
the offending join — move on its own. That keeps one factor and the line numbers both.

**What protecting them cost is stated rather than glossed:** full weekends off are **4 in 24** here
against 6 in Weekday Lates, because the search had five fewer weeks to arrange around. And week 16
holds three of the nine `08:30–17:00` turns, so the evening fill came from line 9's week and line 6's
Friday alone — 17:00 reaches 7, 7, 8, 10, 10 where Weekday Lates 2, free to move week 16, reached
8, 8, 9, 10, 9.

**Weekday Lates 4** (`WL4-24-F7 · f0d403d6`) answers what *Weekday Lates 3* left open. The owner
asked whether weeks 13–17 could stay **in order, on their own line numbers**, rather than kept to the
letter and scattered. All five cannot, for the reason above: the 13→14 join is a 58.9-hour seven-day
window lying wholly inside those two weeks, so nothing outside them can break it. **Four of the five
can.** Weeks 14, 15, 16 and 17 sit at lines 14, 15, 16 and 17 — not a day, not a time, not a line
number altered — and week 13 is the only one that moves, to line 4, unedited. One factor present,
FF19 at its floor of two, worst seven-day window 54.7h, six full weekends off.

**The block's position was enumerated, not searched.** Cover weeks are pinned at lines 1, 7, 12 and
17, and week 17 *is* one of them — a cover week is blank — so "14, 15, 16, 17 in order" means the
three working weeks sitting immediately before some cover week. On a 24-line wheel that is four
placements and no more, so all four were run at three seeds each rather than left to the annealer to
stumble on. Twelve runs, every one clearing every threshold; the placement that keeps the weeks on
their own numbers is the one printed. `tooling/wl4-run.mjs` is that driver.

**The price is the run, and it is structural: 7 consecutive days against 6** everywhere else here.
Week 14 works Fri–Sat and week 15 Sun–Thu, so holding those two in order is seven straight days
whatever the rest of the wheel does. It is not a breach — FF11 allows 13 consecutive, and the "more
than 7 consecutive 8h shifts" row needs more than seven — but it is the one figure this design
cannot match the others on, and its PDF says so on its own page rather than in a footnote.

**What the line numbers cost is one weekend.** Of the twelve runs, the block on lines 22, 23 and 24
reached **7 full weekends off** against this design's 6 — a weekend against the line numbers, which
is the room's call rather than the search's. Both are in the PDF's alternatives table and both grids
are committed (`tooling/weekday-lates-4-alt-blockmoved.json`, and `-alt-floor.json` for the third
placement that also reaches FF19's floor at one fewer weekend).

**Coverage is identical to Weekday Lates 3's** — every quarter-hour of the whole week, asserted
rather than argued, because both start from the same grid and `optimise.mjs`'s two moves leave each
day's duty multiset exactly as it was. 17:00 still reaches 7, 7, 8, 10, 10 Monday to Friday.
Ordering the weeks costs the run and a weekend; it costs nothing in cover.

**Weeks 17-18 Swapped** is supplied rather than searched, and its duty table matches **none** of the
others here — it is its own design, not a rearrangement of one. It clears every hard gate (35h to the
minute, no rest under 12 hours, no hard-limit breach, worst-case run 9 inside the 13-day limit), and
its re-timed midday turn already lifts the evening to 7, 7, 8, 10, 9 across Monday to Friday.

What it carries is advisory and unusually heavy: **five factors present, with FF11 at 16** — the
highest of any design assessed here, against 14 for Weekday Lates and 10–11 for the searched ones —
and **MRSF at 60.6 hours**. Only **6 of its 20 working lines are a single turn**, so most weeks ask
somebody to hold more than one start time, which is what drives FF19 to seven.

**None of that requires a duty to change.** Every one is a property of which week sits beside which,
and on the two designs already run through `optimise.mjs` the same work took the factors from five to
one and the run from nine to six with the coverage curve asserted identical. Its cover spread is also
one line out (7, 6, 5, 6), which that search fixes for free. It is listed un-searched deliberately,
so the baseline it was supplied at stays on the record.

**Targeted Fatigue Redo** (`TF-24-EXT · 8eef9a13`) is that same design re-ordered **by hand**, as a
series of named same-day duty swaps each argued in its own document. Its central claim — that every
duty moved stays on the same weekday, so the shifts available on each day are preserved — was checked
and **holds exactly**: each day's duty multiset is identical to *Weeks 17-18 Swapped*'s, and so is the
hour-by-hour coverage curve at every quarter-hour of the week. The contract checksums too: Mon–Sat is
42,000 minutes against 20 working lines × 35h, and all 24 of the document's own stated weekly totals
match their cells to the minute.

**It set out to clear two flags. One cleared outright; the other turned out to depend on something
the link does not decide.** The worst seven-day total falls from **60.6 hours to 54.7**, under the
55-hour row — the document's estimate of "about 54h40" is right. The second is the interesting one.
It reports the run "dropping from about 15 duties to 9", and there are three different measures in
that sentence. **9** is the longest run of consecutive worked DAYS, correct and inside the 13-day
limit. **FF11 counts shifts between 48-hour breaks, and a single rest day is not one** — on that
measure this design is at **15 in the worst case**, over the threshold of 13, but **12 as rostered**,
under it. The whole difference is the cover week; see the section below. Factors fall five to four
(three as rostered), but not uniformly — FF19 rises 7 to 8, full weekends off fall 6 to 5, and
single-turn weeks fall 6 of 20 to 4.

**It is the clearest case yet for the paragraph above.** Everything still flagged is a property of
which week sits beside which; on this exact duty table the same work done by `optimise.mjs` reaches
one factor and a six-or-seven-day run with the coverage curve untouched. It is listed as supplied,
deliberately, so the hand-made baseline stays on the record beside the searched result.

**Three Mondays** (`TM-24-EXT · fe90c0b8`) is the third hand edit in that same line, and it is
**three cells, all on Monday**: line 15's `06:20-13:45` becomes a rest day, line 16's Monday moves
from `08:30-17:00` to `06:20-13:45`, and line 23's rest day becomes `08:30-17:00`. A rotation returns
every duty it takes, so Monday's staffing is untouched — 13 on duty and 5 still on at 16:20, before
and after — and the full-week coverage curve is identical, as it has been across all three edits.

**It did exactly what it said, and the headline figures did not move.** Both are true, and the gap is
the thing to read. The document sets out to break an eight-day run across weeks 14 and 15: the stretch
beginning line 14 Friday was **8 days** and is now **3**, and the worst rolling seven-day window moved
off that spot as well, from line 14 Friday to line 19 Tuesday, falling from **54.7 hours to 53.1**.
That is a real gain for whoever works those weeks. But the longest possible run is still **9 days**, at
cover week 1 running into line 2, and FF11 is still **15** in the worst case — the same fifteen shifts
at lines 17 to 20, byte-identical, untouched by the edit. **The design was corrected where the problem
was noticed rather than where the worst case lives**, and that distinction is the one these sheets
exist to make visible.

**What it cost:** FF19 rises 8 to 9, and single-turn weeks fall from 4 of 20 to 2 — lines 16 and 23
each now hold two start times where one of them held one.

**Three hand edits have taken this line from five factors present to four.** On the same duty table the
search reaches one. That has been the unfinished question since *Weeks 17-18 Swapped* and it has not
changed.

**Cover at Seventeen** (`C17-24-EXT · edc1b731`) is the fourth revision and the one that worked. It is
**a single whole-line swap**: lines 17 and 18 exchange contents, so the cover week returns to **17** and
week 18 takes the Sunday `10:30-19:00`, the Monday `16:25-23:55`, the two rest days and the
Thursday–Saturday early block that 17 had been holding. It is the **reverse of the change that started
this line** — *Weeks 17-18 Swapped* moved the cover week from 17 to 18, three hand edits were built on
top, and this puts that one thing back and keeps all three.

**FF11 clears.** Across four revisions it has gone **16 → 15 → 15 → 13**, and the threshold is "more than
13". It is **11 as rostered**. The longest run of duties of eight hours or more falls **7 → 5** and FF15
**7 → 6**, so factors present fall to **three** — and for the first time the count is the same on *both*
readings of a cover week, so this design no longer depends on how the clerk places one.

**Why one swap did what three rounds of same-day moves could not.** The fifteen-shift block those
revisions kept failing to break ran lines 17 to 20, and every edit was made inside weeks 14, 15, 16 and
23 — never inside the block. Moving the cover week to 17 puts a guaranteed break at its head. The
binding block is now the wrap point instead, line 24 into cover week 1 into line 2, and it is **exactly
13**: a knife edge, not a margin.

**What it cost:** FF19 rises 9 to 10, the highest in this line, and the cover weeks are less evenly
spread — gaps of **6, 5, 5, 8** against 6, 5, 6, 7.

**The comparison still has not changed.** Four hand edits, five factors down to three, coverage untouched
throughout. The search reaches **one**, with a six-or-seven-day run, FF19 at two and half the weeks on a
single turn.

**Saturday Four** (`S4-24-EXT · 481ba9ed`) is the fifth revision and **the first to change a duty rather
than the order of the weeks** — on Saturday, and on Saturday alone. Against *Cover at Seventeen*, **zero
cells outside the Saturday column differ**, Saturday still carries 12 people and still pays 5,895 minutes,
so Mon–Sat is 42,000 to the minute exactly as before. The contract could not move, because the budget the
search was given was the one Saturday already had.

**Nine turns become four, and six start times become three:** `06:20-14:45` ×5, `09:30-16:30` ×1, and 15:15
starting BOTH late turns — `15:15-22:30` ×2 and `15:15-23:55` ×4. Finishes fall 7 → 4. The thinnest
fully-covered hour rises **3.0 → 4.7 people**, and the longest Saturday duty falls **9h10 → 8h40**, bringing
Saturday under the cap the rest of this folder works to.

**Two owner rules are built into the search pool rather than applied afterwards.** In the 21:00–23:00 band the
only legal finish is **22:30**, because that is when the ticket office closes — an earlier draft of this table
put two turns at 22:15, fifteen minutes short of a real handover, which is exactly the sort of time a search
invents and a station cannot use. And the demand TARGET for 15:00–23:00 is lifted 15% for **Wembley**:
Chiltern serves Wembley Stadium out of Marylebone, and an event fills trains the measured curve already
counts, so the curve understates those hours. The traffic row printed on page 5 is still the measured one.

**The fit, both ways:** against the measured curve alone it is **11.4** where today's Saturday is 20.7;
against the Wembley-weighted target **11.8** where today's is 32.8. The weight is deliberately gentle — it
buys half a person at 16:00 and half at 22:00, paid for by half at 08:00 and half at 09:00. A heavier one was
tried and rejected: at 1.25 it buys a whole person at 16:00 and gives a whole one back at 09:00, where the
curve reads 81 cars. **1.10, 1.15 and 1.20 all return this same table**, so the answer does not balance on the
knob.

**How it was found.** Every multiset of 12 duties paying exactly 5,895 minutes, from a pool of quarter-hour
starts and finishes plus the 06:20 open and 23:55 close, each duty 7h00–8h40 — about 130 million tables
from a SEEDED search, so it reproduces, scored on demand fit with fewer turns as the tie-break and a floor
under the thinnest hour so nothing could be won by hollowing out the evening (`tooling/sat-table.mjs`). Then
which line holds which Saturday duty was searched exhaustively under the 12-hour rest rule: 90 assignments
clear it, and the best of those on the fatigue figures is the one printed (`tooling/sat-assign.mjs`).

**One December rule is now met that was not** — four through to the close, against three. **One cannot be:**
the rule asks four at the open and Saturday still has five. That is arithmetic, not a search failure — no
table of 12 duties paying 5,895 minutes from that pool puts four at the open *and* four at the close, at any
evening floor. Four at the open needs a different Saturday headcount or minutes moved in from a weekday,
and both were outside what this revision was allowed to touch.

**What it cost:** the worst rolling seven-day total rises 53.1 → 53.5 hours, still well under 55. Every other
figure is unchanged. Saturday's headcount is still **12 against the December shape's fourteen**, and that is
the real limit on how much shape Saturday can carry: 5,895 minutes over a 17h35 day is a mean of 5.6 people,
so there is little headroom to build a peak whatever the table.

**Clean Final** is the third supplied design and a further revision of the *Weekday Lates* line. It was
transcribed from a Word table and **checksummed before anything was built on it**: all 24 rows agree with
the Weekly Total the document states for each, and Monday to Saturday comes to exactly 42,000 minutes.
The checksum is worth recording because it looked wrong first — nine rows disagreed, and the nine were
precisely the rows carrying a Sunday duty, which is the proof that the document's Weekly Total column is
Mon–Sat rather than Mon–Sun. Re-checksummed on that basis, all 24 agree.

**Clean Final Tuned** asks the smallest question available: *what is the fewest changes that fit December
better?* The parent's misfit is not spread evenly — measured hour by hour it scores **Mon 28.4 · Tue 43.6 ·
Wed 42.3 · Thu 48.8 · Fri 31.0 · Sat 28.5 · Sun 62.4**, and Sunday alone carries more than any weekday.
So rather than re-search the link, every individual cell was tested against every retime of ±4 hours and
the best taken, three times over:

| | Move | Buys |
|---|---|---|
| 1 | line 21 Sunday `13:30–22:00` → `14:55–23:25` | Sunday 62.4 → 47.6 — breaks the 14:00 bulge where all nine were on at once, and fills the 22:00 shortfall |
| 2 | line 8 Saturday `13:30–21:00` → `11:00–18:30` | Saturday 28.5 → 20.5 — fills the 10:00–12:00 dip |
| 3 | line 20 Sunday `08:30–16:30` → `07:15–15:15` | Sunday 47.6 → 44.9 — **and takes Sunday's open from three people to four, which is the December rule met** |

**Three cells out of 168, and everything else is invariant by construction rather than by re-checking**:
each move keeps its duty's length to the minute, so the Monday-to-Saturday total, every line's 35h, both
headcounts, the four cover weeks, the longest run and the fatigue count *cannot* change. The search was
also refused any move that took the tightest rest anywhere below 12h30, moved a day's open or close, or
produced a :05 or :10 time.

**Where it stops is the interesting part.** A fourth move was available and was rejected: it bought 2.6
points of fit by taking Sunday's open back from four people to three — handing back the rule move 3 had
just met. The best fourth move that breaks no rule is worth 2.0, against move 1's 14.8. **Two costs are
on its pages rather than in a footnote**: Sunday now closes with four where the shape asks three (22:00
was Sunday's deepest shortfall, so the rule and the measured demand disagree there and the move sides with
the demand), and line 8's Friday-into-Saturday turnaround falls from 15h00 to **12h30**, the tightest rest
in the design and half an hour above the floor — an 11:30 start would hold 13h00 and give back 2.7 points.

**What it does not touch is now the biggest remaining question: Thursday, at 48.8.** It is also the
heaviest day by minutes (7,780 against Monday's 6,225), and those are the same fact. That is a weekday-table
question, not a three-cell one.

**Clean Final Ten** answers the next ask: *give it a tenth Sunday shift, fit demand better, and improve
the fatigue factors*. The first two are one cell. Every placement of a tenth Sunday duty was measured
— every line with a Sunday rest day, every start on the five-minute grid, four lengths, 1,771 placements
clearing a 12h30 rest — and the curve is unambiguous: an evening turn, **`15:25–23:25`**, takes Sunday's
misfit from 44.9 to **35.3** and meets the December headcount of ten. **But on the parent's line order
that turn trips a factor wherever it goes**: a worked Sunday joins the week before to the week after,
so either FF11 (more than 13 shifts without a 48-hour break) or the 55-hour week appears. Only two lines
could take *any* Sunday duty without a new factor, and both placements made the fit worse.

So the third ask decided the method: **the wheel was reordered, whole weeks only** — `optimise.mjs`
gained a `LINES_ONLY=1` switch that restricts it to swapping entire lines, which is the smallest edit
that can move a fatigue factor because the factors are properties of which week follows which. Every
week pattern in *Tuned* is still here unedited (except the one that gained the Sunday cell — the
parent's week 24, now line 5); 16 of the 20 working weeks change line number and 7 lines stay put.
Result: factors present **3 → 2**, longest run **9 → 6**, full weekends off 4 → 5, worst seven-day
window 51.6h → 50.9h, tightest rest 12h30. Coverage, headcounts and the contract are invariant by
construction and asserted by the script; the day multisets are exactly *Tuned*'s plus the one Sunday
cell. `RULES=1 LINES_ONLY=1 node optimise.mjs cea-clean-final-ten-start.json 20000 2 7` reproduces the
grid byte-for-byte (checked), which is what the `R7` in the code says.

**Two other answers were measured and both are committed**, because the PDF names them in its
alternatives table. `tooling/clean-final-ten-alt-fewswaps.json` is the *smallest* reorder that reaches
two factors — a greedy four whole-line swaps, 17 lines untouched — and it shows what small costs: the
run stays at 8, weekends fall to 3, and the 55-hour window sits at 54.7, eighteen minutes from the line.
`tooling/clean-final-ten-alt-full.json` is the full search with duties free to move between weeks: one
factor (FF19 at 4), six weekends, **13 of 20 weeks a single turn** — and 19 of the 20 working weeks
rewritten. *Clean Final Ten* is the middle of those three.

**What it costs, stated on its own pages.** Sunday now closes with five where the shape asks three (the
parent already closed with four; a `15:20–23:20` turn keeps it at four for 0.6 of fit). Sixteen line
numbers move, and a line number is what a member knows. The week that gains the Sunday works a late
into three earlies across one rest day — legal by 30h55, and the one week whose *shape* a member would
notice. FF15 sits exactly on its threshold of 4. And nothing the parent left open is answered here:
Saturday's 5/3 open and close, 12 on a Saturday, 4.35 days, Thursday at 48.8.

**Two corrections to this tooling came out of building it**, both of the same shape — a sentence that read
as checked and was not. `supplied.mjs` rendered the stock *"two candidates tied on every rule; the fit
decided it"* under the alternatives table of a design whose whole method page says **there were no
candidates**; supplied and derived designs now get a truthful default that also explains why the Score
column is blank. And `render.mjs` headed the open questions *"Two things to settle before it is frozen"*
while every proposal it rendered listed four or five; the heading is now overridable and its default
carries no count. A heading that miscounts the list under it is the kind of small untruth a reader checks
once and then stops trusting the rest for.

**The caveat this paragraph used to carry is closed, and the figures above were restated.** When these
three were built, every sheet's *Wk fit* column scored **Tuesday alone** — exact for the searched families,
whose weekdays are uniform, and misleading for supplied designs like these, whose five weekdays range from
28.4 to 48.8. Fixed the same day (*Weekdays are not one day*, below). The weekday figures in this section
were also first written on a different measure from the Saturday and Sunday ones beside them — heads
touching an hour rather than duty minutes, see *One fit, on minutes* — and now read on the one measure every
sheet uses; Thursday is still the worst weekday, at 48.8 rather than 60.8. Every Clean Final sheet was
regenerated after both fixes.

## The decision frame — page 2 of every sheet (24 Sep 2026)

An external comment, accepted by the owner: the calculation was already exhaustive; what the sheets
lacked was **decision structure, an evidence hierarchy, staff validation and a plain statement of
uncertainty**. The ORR's guidance treats its factor list as one input to be triangulated, never as the
answer — and the sheets' page 7 said so in a footnote while every tile above it invited a reader to
count factors. So every sheet now carries a page **before** the figures, and every later page moved up
one (nine pages; the README's page references were updated with them).

The page has five parts, and every number on it is computed from the design's own cells:

- **The question** this design answers, framed per family, and the ONE design it is read against —
  Same Turns and Quarter To against By the Book; the rules family against Quarter To; the hand-built
  line against both searched answers and, within the line, its own parent. Not against all nineteen.
- **The criteria in three tiers.** Hard, which a design meets or cannot be run (12h rest, the 13-day
  limit, the exact contract), with this design's pass or fail. Soft, which the room weighs (December
  headcounts met of four, factors present, demand fit, times worked today, weekends). Preference,
  which is staff's to state and not the tool's (early against late, the new times, the longest duty).
- **How much each figure can bear** — a table grading every figure the later pages rely on: the cell
  arithmetic is firm; the 13-day threshold is firm in figure and unconfirmed in source; the December
  headcounts are provisional (owner-relayed, class C); the fatigue count is advisory only, with the
  number of factors still "definition to confirm" stated; the demand fit is indicative; the familiarity
  count is firm but a proxy; and a search score is **not to be weighed**.
- **What no page here can tell you** — staff acceptability of the new times (named), how the roster
  clerk places a cover week (the one thing that moves the 48-hour-break figure, both readings shown),
  leave and sickness cover, Wembley event days, and — where it is true — that Sunday's fit is worse
  than today's.
- **Before it is frozen** — the lines that hold the times nobody works today, named, so the people who
  would work those weeks read them first; the cover-week question to the roster office; the source of
  the 13-day limit. "Only then does the factor count mean anything."

**A plain-English pass went with it** (owner: "a clarity and for-dummies pass, with some aesthetic polish").
Where a word is used, it is now explained: a page guide at the top of page 2; the eight roster words
(link, line, turn, rest day, cover week, Sunday, the contract, a one-turn week) under the grid on page
3; how to read the heat chart and what the fit figure is, in one sentence each, on page 5; what the
ORR list is and what ⚠ present actually means, above the fatigue table on page 7, with each factor's
family shown as a chip; "in plain terms" above the method on page 8, one version for a searched design
and one for a supplied one; and what the fingerprint is, on page 9 where the cells are. Polish: zebra
striping on the reading tables, a coloured top edge per criteria tier, and the December 2026 timetable
named in full wherever the sheets said a bare "December".

A design's `meta.json` may override any part of it under `frame` (`question`, `stands`, `cannot`,
`read`, `family`); none does yet — the family framing was checked against all nineteen and holds. The
one thing the page deliberately does not do is add a number: a composite score would make the problem
it exists to answer worse.

## Weekdays are not one day

**Every sheet's "Monday to Friday" figures read Tuesday** until 24 Sep 2026, when the owner asked why a
design whose weekdays differ was shown one weekday row. For the four searched families that shortcut was
exact — every weekday works the same duty table, so Tuesday *is* the week. For the eleven supplied and
hand-edited designs it was not: *Cover at Seventeen*'s midday cover runs **6, 8, 11, 11, 10** across the
week, and the sheet printed one line. Today's own link differs too (Mon/Wed against Tue/Thu/Fri).

Six sites carried it, and all six are fixed the same way — **by distinct pattern, never by average**:

- **Page 5, the hour-by-hour chart** — one row per distinct weekday pattern, labelled by the days it covers
  (`Proposed Mon`, `Today Tue · Thu · Fri`). A design whose weekdays are identical still prints one row,
  now honestly labelled `Mon–Fri`; nothing is averaged away.
- **Page 4, the Monday-to-Friday headcount** — a range where the days differ (`13–16`).
- **The three December rule rows** (four at the open, three to the close, five at 22:00) — a range across
  the weekdays, and the **worst** weekday decides the tick.
- **The weekday demand-fit score** (`Wk fit` in every alternatives table) — now the fit of the AVERAGE
  weekday. This is the one figure that MOVES on the hand-edited sheets, because Tuesday was never
  representative of them; the searched families' figures are unchanged by THIS fix, since their five
  weekdays are one. (Later the same day every `Wk fit` moved again, for a different reason — *One fit, on
  minutes*, below.)

Every fingerprint is unchanged by this: it is a change to what the sheets say about the cells, not to the
cells.

## The two readings of a cover week

**Every sheet here now prints two answers on one row, and the gap between them is a question for the
roster office rather than a mark against a design.**

A cover week is `SPARE` on all seven days and worked on **four** of them — the roster clerk places
them, and the link does not say which four. So every run-based rule has a range rather than an
answer, and the app's own modules report the top of it: a cover day counts towards a run, capped at
four a week, and never supplies a break.

**That ceiling is correct and it is reachable.** Enumerated, 22 Sep 2026: of the **35** ways to place
four duties in seven days, exactly **10** leave no two rest days together — and those 10 are
precisely the placements that reproduce the app's figure. It is not an over-count; the pre-v19.79
behaviour (a cover week as seven worked days) was, and this is what replaced it.

**But it needs the week SPLIT.** Work the four together, which is what a cover week looks like on the
roster, and the three rest days are necessarily together too — so the week always supplies a
48-hour break and can never BRIDGE the blocks either side of it. That is the *as rostered* figure.

**Checked on every run row, on all thirteen designs: FF11 is the only one where the two differ.** The
longest-run figure, the 12-consecutive-days row, the 7×8h row and FF15 give the same answer under
both, which the hard-limits row on page 6 now says out loud rather than leaving to be assumed. On
**two** designs FF11 differs either side of the threshold:

| | worst case | as rostered |
|---|---|---|
| Weekday Lates | **14** — present | **10** — clear |
| Targeted Fatigue Redo | **15** — present | **12** — clear |
| Fifteen Turns | 14 — present | 14 — present |
| Weeks 17-18 Swapped | 16 — present | 16 — present |
| every other design | 9–12 — clear | 9–11 — clear |

The last two breach on **either** reading, so nothing about cover-week placement rescues them —
*Weeks 17-18 Swapped*'s 16 contains no cover week at all.

**The row's colour still follows the ceiling**, deliberately: a reader who takes one number from the
cell takes the cautious one. Printing only the ceiling would flag designs that are clear as rostered;
printing only the block reading is the false-assurance failure `links-fatigue.js` names as its own
dominant risk. `tooling/cover-placement.mjs` carries the argument and does the arithmetic, running
the app's own scanners over a grid whose cover weeks have been materialised — it decides what a
cover day IS, and never what a run is.

**Open, and it is the owner's to answer:** does the roster clerk ever split a cover week day-on-day-off?
If never, the block reading is the real one and the ceiling is a footnote.

**The code**: family (`ST` / `BB` / `QT` / `EF`) · rotation length · duty table (`A`/`B` today's times, `D` the
December default, `Q`/`R` table B with the closer at 15:45 and the two 06:20 openers run on to keep the
contract — `Q` to 14:00 and 14:50, Saturday's own opening times; `R` to 14:30; `E` the December rules
re-solved with no duty over 8h40, `tooling/eight-forty-table.json`) · search seed. A trailing `p` (`BB-24-D21p`) is the rules-only run with no
week-coherence term, kept as a comparator. The fingerprint is the first eight hex characters of
SHA-256 over the 24 × 7 cells in line order. `TN-24-R7` is a reorder: `R7` is `optimise.mjs`'s seed in rules mode, the same reading as `FT-24-R21`.
`CFT-24-M3`'s **`M3` is a move count, not a seed** — three
retimed cells — and it is spelled that way because a two-character suffix in this scheme otherwise reads as a
search seed, which would be a claim this design cannot support.

**Evidence class**: the 24-line length, the four cover weeks and the December headcounts are
owner-relayed figures with no document behind them (class C — `docs/KNOWN_LIMITATIONS.md` → Links),
and the 13-day limit's policy citation is outstanding. Neither PDF is a recommendation; both say so.

## One fit, on minutes — and what a second pass over the sheets found (24 Sep 2026)

The owner asked whether the sheets could be improved and what was missing. Two things were wrong before
anything was missing.

**Page 4 typed four of its headcounts.** The "Changed — the December headcount" table computed its first
three rows from the cells and carried the next four as literals — `4 → 4 unchanged`, `2 → 3`, `2 → 4 four on
a Saturday`, `4 → 5` — on every sheet, under a masthead that says *figures on this page are computed, not
typed*. On *Cover at Seventeen* it said Saturday closes with four while page 6, correctly, said three. The
rows are now computed per day class (`weekday range · Sat · Sun`, today and proposed) by `headcounts()` in
`tooling/report-data.mjs`, and the last column names the days that miss the rule rather than asserting it.

**There were two demand-fit measures, and they disagreed on a direction.** `fit.mjs`, which chose every
searched table, measures cover in duty MINUTES per hour. `supplied.mjs` and `final.mjs` each carried a copy
of the same formula fed with `calcHourlyCoverage`, which counts a HEAD in every hour a duty touches — a 06:20
start is a whole person in the 06:00 hour, a 23:55 finish a whole person at 23:00 — and that is exactly where
these designs differ. On heads, *Clean Final Tuned*'s three retimes made Sunday **worse** (88.2 → 93.2); on
minutes they made it **better** (62.4 → 44.9), which is the figure the Clean Final narrative was written on
while its weekday figures beside it were on heads. One definition now, `weekdayFit` and `dayFit` in
`report-data.mjs`, on minutes, and both renderers call it. **Every `Wk fit` on every sheet moved**: *Cover at
Seventeen* 42.1 → 34.4, *Same Turns* 58.5 → 46.3, *By the Book* 41.1 → 30.8, today's link 56 → 44.7. The
ordering between designs did not change on any sheet checked. *Saturday Four*'s own 11.4 / 11.8 in its section
above are `sat-table.mjs`'s search score, Wembley-weighted, and stay as written; on the shared measure its
Saturday reads 12.6 on page 5.

**What was added, all computed, none of it typed:**

- **Page 5 — a `fit` column** on every cover row, today's and proposed, per day and per distinct weekday, so
  the figure the searches were run on is beside the chart it describes rather than on a different page as a
  weekday mean.
- **Page 6 — the tightest rest and where it falls** on the 12-hour row (`13h 35m — line 20 Fri 16:25-23:55
  into Sat 13:30-22:00`), with today's beside it. `0 rests under 12h` told a reader nothing about a design
  half an hour from the floor; *Clean Final Tuned*'s 12h30 was in this file and on no page.
- **Page 3 — three things on the grid.** A **Turns** column (distinct clock times in the week, Sunday
  included; the page 1 one-turn tile line by line, and the count in the footer). A **Minutes** row (duty
  minutes per day, Mon–Sat summed to the 42,000 the contract is paid in — figures *Clean Final*'s note had
  to carry in prose). And on a hand-edited design, **the cells that differ from its parent outlined**, with
  the count in the legend: `Changed against Three Mondays (TM-24-EXT) — 14 cells on 2 lines`. The parent is
  named in the design's `meta.json`; only local edits carry one (TF, TM, C17, S4, WS, CF, CFT), because a
  re-searched or reordered child differs on most of the grid and outlining a hundred cells says nothing.
- **Page 8 — the alternatives table runs full width** under the two text columns. In the right-hand column
  its design names wrapped to six lines each.
- **Provenance** — page 1 and page 9 state the app version whose modules produced the figures
  (`Marylebone Roster v24.21`), because the rule modules change between releases and a sheet in a drawer
  should say which ones judged it.
- `tooling/regenerate.mjs` now **ships** each render's PDF, JSON and import block into this folder under the
  folder's names; that was a hand-typed copy per proposal, which is how a folder ends up with a PDF from one
  render and a JSON from another. **It had already happened**: the first shipped run rewrote
  `Weekday-Lates-2-WL2-24-R21.json` and its import block, which until then held *Fifteen Turns Repaired*'s
  grid under Weekday Lates 2's name — the PDF was right, the two files beside it were not.
- The page 5 "Reading it" callout on the searched families said its Saturday-weighting and two-peaks
  sentences twice; once now.

**Every fingerprint is unchanged**, checked by `regenerate.mjs --check` after the pass: these are changes
to what the sheets say about the cells, not to the cells.

**A check of that pass, the same day, found six defects — two of them its own.** All fixed, all 19
sheets regenerated, fingerprints unchanged.

- **The grid footer contradicted page 1 on every sheet.** The Turns column counted the whole week's
  clock times, so its footer said Same Turns had 4 one-turn weeks where page 1, 3 and 7 say 18 of 20.
  The column now counts Monday-to-Friday clock times, and the bold mark and footer use the page 1
  tile's own definition from `feel()`: one clock time Mon–Fri and one early-or-late family across
  every worked day.
- **Page 4 said "all already on today's roster" on 14 sheets** whose page 1 counted 5 to 13 new
  times; the label only branched for the searched families. It is computed from the new-times count
  on every family now.
- **Content ran under the footer on seven pages** by 4 to 17px — a page can be inside the height gate
  and still do that, because the footer is absolutely positioned. `shots.mjs` now measures the footer
  gap as well as the height, and the cover masthead, tiles, headings and the design-figures table
  gave back the room.
- **Weekday Lates' page 6 still said the shape asks for five cover weeks.** That was `supplied.mjs`'s
  default open-questions text — Weekday Lates' own prose, with its own figures, which any supplied
  design without a meta file would have inherited as its own. The default is computed now (the
  December rows the design fails, and the Sunday window), and Weekday Lates keeps its prose in a meta
  file of its own.
- **The 12-hour row said "the search here never produced one"** on eight designs that were never
  searched. A supplied design's row now says it was checked, not generated.
- **The searched sheets said "Prepared 8 September" while citing v24.21.** `meta.date` is when the
  design was prepared and is stated as that; when a sheet is re-rendered on a later day it now says
  so beside it. Every supplied design carries its preparation date in its meta file, so a re-render
  never re-dates it.

Two were left as decisions and then taken (24 Sep 2026, owner: "do your suggestions"):

- **Page 7 named a person** ("Nathan assesses against this list") in a folder the Pages mirror serves.
  It now says what the eyebrow already says — this is the list the link is assessed against — and
  names nobody. (`Email-to-Nathan.md` still carries the name in its title; it is a draft email, and
  renaming it is a separate call.)
- **Two pick sentences were typed literals.** Same Turns' ("Two candidates tied on every rule; the fit
  decided it") and By the Book's ("All four candidates … full weekends off decided it (6 against 5) …
  the coherence term cost … nothing") were strings in `render.mjs`, true on the day they were written
  and checked by nothing after it. Every searched family now reads `pickSentence` from `final.mjs`,
  which compares the winner with the runner-up rule by rule; By the Book's "what the coherence term
  cost" is read from the rules-only row beside it. Same Turns' sentence now carries the fit figures
  (46.3 against 63.7), which the literal did not.
- **And a third the re-render exposed:** Same Turns' method page compared its two tables with typed
  figures — "57.7 today, 58.5 here … A 69.5" — which were heads-per-hour numbers from before the one
  fit on minutes. It reads 44.7, 46.3 and 63.7 from the same rows the alternatives table prints. By
  the Book 2's "against Eight Forty's 70.4, 16.4 and 20.9" is read from `eight-forty-table.json` the
  same way. No fingerprint moved.

## By the Book 2 with fewer shift times — measured, not built (24 Sep 2026)

The owner asked whether *By the Book 2* could carry fewer shift times. The first pass settled that each
day's own ceiling is already at its floor: the weekday fails at six starts and the Sunday at four, with
"too many starts" the binding miss both times. The rotation holds 26 distinct turns, and the reason is
not any one day — it is that Saturday shares the weekday's window and yet brings 6 turns of its own.

So `place-structures.mjs` gained a third pick, `PICK=share`, which prefers turns a named day already
works (`SHARE=b2-weekday.json`), then the day's own count, then fit — and records the best table under
all three orderings in one pass, so the trade is read off one run. The run reproduces the committed
Saturday under `fit` exactly, which is the regression check. What it found:

| Saturday picked by | turns of its own | shared with the weekday | Saturday fit | rotation turns | rotation clock times | off the quarter hour |
|---|---|---|---|---|---|---|
| fit (committed, `b2-sat.json`) | 6 of 12 | 6 | 8.1 | 26 | 31 | 16 |
| share (`b2-sat-share.json`) | 4 of 12 | 8 | 11.8 | 24 | 30 | 15 |

Eight shared is the ceiling by arithmetic, not a search limit: the weekday has four openers, three
closers and the pinned pair, so a Saturday of four openers and four closers can reuse at most those
eight, and its fourth closer and its middles are new whatever happens. The lever is therefore worth
**two turns and one clock time across the whole rotation**, and it costs Saturday a third of its fit
(8.1 → 11.8 — still the best Saturday in the folder; *Eight Forty*'s is 16.4). No sheet was built from
it: a proposal needs the rotation searched again (`MODE=rules node anneal.mjs` on a new table), and a
gain of two turns did not look like it earned four seeded runs without the owner seeing the numbers
first. The Saturday is in the folder if it does.

## Files

| File | Use |
|---|---|
| `<Name>-<code>-<fingerprint>.pdf` | the proposal, 8 pages A4 — **force-added** (`git add -f`), because `.gitignore` ignores every `*.pdf` in the tree |
| `<Name>-<code>-import.txt` | line number then Sunday–Saturday, tab-separated — paste into **Links → Import** |
| `<Name>-<code>.json` | the same rotation in the app's own `{ name, patterns }` shape — also importable |

Every import form is verified against `links-import.js` (24 lines, no warnings). Importing one
makes the workspace's Design checks, hard limits, fatigue factors and coverage cards restate every
figure in its PDF.

## Reproducing or extending them — `tooling/`

Node scripts, driven from this directory, importing the app's modules by relative path. No install
is needed for the search; rendering needs the root `npm ci` (Playwright's Chromium).

```
cd docs/proposals/tooling
node table.mjs                       # every December table in today's times that pays 42,000 min exactly (81)
node fit.mjs                         # candidate day tables against the Dec 2026 demand curve
MODE=feel  node anneal.mjs B 60000 4 7     # Same Turns family: table B, 60k steps x 4 restarts, seed 7 → best-B-7.json
MODE=rules node anneal.mjs D 60000 4 7     # By the Book family: the December default table, fatigue-first
node table-late.mjs                        # the 15:45-closer tables: none from today's turns alone; 42 under the 8h40 cap
MODE=feel  node anneal.mjs Q 100000 5 7    # Quarter To family: tables Q and R, seeds 7 13 21 34
node table-book.mjs 300000 10 7            # Eight Forty's table: the December rules under an 8h40 cap → eight-forty-table.json
MODE=rules node anneal.mjs E 100000 5 7    # Eight Forty family: table E, seeds 7 13 21 34
PROPOSAL=ST node final.mjs results/best-A-*.json results/best-B-*.json           # pick, assess, render
PROPOSAL=BB EXTRA=results/best-RDpure-21.json node final.mjs results/best-RD-*.json
PROPOSAL=QT node final.mjs results/best-Q-*.json results/best-R-*.json
PROPOSAL=EF node final.mjs results/best-RE-*.json
node wl4-run.mjs                      # Weekday Lates 4: all four placements of the 14-17 block x 3 seeds (12 runs)
RULES=1 LINES_ONLY=1 node optimise.mjs <design>.json 20000 2 7   # reorder WHOLE WEEKS only, fatigue-first (Clean Final Ten)
node supplied.mjs <design>.json "<Name>" "<strap>" <CODE>   # render a SUPPLIED or DERIVED design (no search to describe)
node shots.mjs <rendered>.html       # A4 page screenshots + a height check against the printable page
CAP=520 PIN_N=2 PIN_MIN=1020 PIN="14:00-22:30x2" AT22_FLOOR=1 CLS=sat node place-structures.mjs
                                     # a day table by placing EVERY enumerated length structure (By the Book 2)
CAP=520 PIN_N=2 PIN_MIN=1020 PIN="14:00-22:30x2" AT22_FLOOR=1 CLS=sat PICK=share SHARE=b2-weekday.json node place-structures.mjs
                                     # the same Saturday, preferring turns the weekday already works ("fewer shift times")
node assemble-table.mjs by-the-book-2-table.json b2-weekday.json b2-sat.json b2-sun.json
MODE=rules node anneal.mjs G 100000 5 7    # By the Book 2 family: table G, seeds 7 13 21 34
PROPOSAL=B2 node final.mjs results/best-RG-*.json
CLS=sat node weekend-table.mjs > q2-sat.txt; CLS=sun node weekend-table.mjs > q2-sun.txt
                                     # Quarter To 2: Saturday and Sunday searched again under the cap, in Quarter To's spirit
                                     # (the JSON line at the end of each is the day file; ALLOW_TODAY_ENDS=1 admits today's 22:00 Saturday finish)
PINS=none CAP=520 node assemble-table.mjs quarter-to-2-table.json q2-weekday.json q2-sat.json q2-sun.json
MODE=feel  node anneal.mjs W 100000 5 7    # Quarter To 2 family: table W, seeds 7 13 21 34
PROPOSAL=Q2 node final.mjs results/best-W-*.json
CAP=510 COUNT=1 node table-book.mjs  # how many length structures a cap admits, WITHOUT searching -- a zero is a proof
node regenerate.mjs --check           # every proposal's fingerprint, without rendering
node regenerate.mjs                  # re-render EVERY sheet from the same inputs that produced it
```

**`table-book.mjs`'s own search is unreliable at a tight cap, and that matters because its failure reads
like impossibility** (22 Sep 2026). It anneals over lengths and start times together; at By the Book's
9h30 or Eight Forty's 8h40 the space is enormous and it finds an answer easily. Tighten the cap and the
space collapses — measured by enumeration, `COUNT=1`:

| max shift | weekday | Saturday | Sunday |
|---|---|---|---|
| 8h40 | 540,737 | 84,116 | 9,651 |
| 8h35 | 13,925 | 1,083 | 363 |
| **8h30** | **62** | **1** | **1** |

At 8h35 and 8h30 the anneal reports "no feasible weekday table"; `place-structures.mjs` — enumerate every
legal set of LENGTHS, then place each one, since inside a structure the only freedom is where the middles
start — finds one at 8h30. So the old answer was *"we could not find one"*, not *"there is not one"*, and
only the second belongs in a document. What it then establishes: **8h30 is impossible under these rules**,
as a proof rather than a failure to find — Saturday has exactly one set of lengths at that cap and it
cannot meet the Saturday evening rules. The reason is arithmetic and has nothing to do with a minimum
shift: a weekday pays 7,000 minutes across 14 duties, so the mean duty is 8h20 whatever else is true, and a
cap of 8h30 leaves 140 minutes of headroom across the whole day. 8h35 clears only by giving up most of the
late-shorter-than-early margin (weekday 23 against a pin of 30, Saturday 10 against 20), which is why
*By the Book 2* sits at 8h40.

`regenerate.mjs` holds every proposal's build arguments as data, so a change to `render.mjs` or
`report-data.mjs` can be applied to all of them with one command. It was written because the twelve
build commands existed only in shell history and a README block covering four of them, and the other
eight had to be recovered by reading the name and strap back out of the rendered HTML — which works
until somebody deletes an HTML file. It refuses to finish if a fingerprint moves: the same grid in
must give the same eight hex characters out, because a proposal's identity is its cells and a
printout that has been in a room must go on matching its name. `--check` does that and nothing else.
*(While writing it: `quarter-two.json` and its meta held the FIFTEEN TURNS grid, not Quarter To — a
working name that outlived its design. Renamed to `fifteen-turns.json`; Quarter To is searched and has
no supplied grid.)*

`anneal.mjs` is the search: every move keeps each day's duties exactly as the table says (a swap
between two lines on one day, or two whole lines changing places), so coverage, contract and
headcounts are true by construction and only the shape is searched. `final.mjs` picks by rules
first (rest, run, factors present, weekends off), then weekday demand fit, then the search's own
score; offers the winner to the app's `reorderLines`; and writes the PDF, the import text and the
JSON. A seed reproduces its grid exactly on any machine. `results/` holds the seed outputs the two
PDFs were picked from.

The rendered `.html` files are not committed (they are regenerated by `final.mjs`, and an HTML file
in the repo root's web tree is a served page).

**Served, deliberately.** The repo root is the web root. `firebase.json` excludes `**/*.pdf` and
`**/*.md`, so the PDFs and this README are not in the Hosting bundle — but the `.txt`, `.json` and
`.mjs` files here are, and the GitHub Pages mirror serves the whole tree regardless. Nothing in them
is new information (the base roster is public by the classification in `AUTH_PLAN.md` §2), so this is
untidy rather than unsafe. Adding `docs/**` to the Hosting ignore list is the tidy fix; it counts as
a served-file change and so waits for the next runtime version bump rather than forcing one here.
