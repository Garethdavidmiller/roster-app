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

The four searched proposals — *Same Turns*, *By the Book*, *Quarter To*, *Eight Forty* — clear every hard rule — Chiltern's 13-day limit, twelve hours between duties, the exact
35-hour contracted week — and meet the December staffing shape (four to open, three through to
the close and four on a Saturday, five still on at 22:00, fourteen on a Saturday, ten on a Sunday,
four cover weeks at lines 1, 7, 13, 19). They differ on exactly one thing, and it is a people
question rather than a rules one: *Same Turns* keeps 15 turns people already work and does not meet
the late-shorter-than-early lever; *By the Book* meets every rule and none of its 19 turns is a
time anyone works today. Each PDF states this on its page 5. **The two 12 Sep proposals are comparison examples, not base rules** (owner, 13 Sep 2026): the 15:45
closer and the 8h40 cap are briefs to set beside *Same Turns* and *By the Book*, and neither changes the
December rules the workspace pins in `links-default-targets.js`. *Quarter To* (12 Sep 2026) is *Same Turns*
with two things asked for — the closer at 15:45, nothing over 8h40 — and it clears every fatigue factor
where *Same Turns* has one present; its open question is the cap's reach, since Saturday's 14:45–23:55
(9h10) and Sunday's 14:30–23:25 (8h55) are today's own turns carried over unchanged, and shortening
Saturday's closer leaves 7,004 minutes a weekday that no table of today's turns reaches. *Eight Forty*
(12 Sep 2026) is *By the Book* under the cap, and the cap is not a trim there: 14 duties paying 7,000
minutes average 8h20, so a ceiling twenty minutes above the mean forces every long early to 8h30–8h40 and
every late to 7h45–8h25, and the owner's late-shorter-than-early lever shrinks to five minutes at the
boundary. Two of *By the Book*'s pins gave way to arithmetic and the PDF says so on page 5: a Saturday
cannot average its earlies more than 24 minutes longer than its lates (this table has 20; the rule asks
30), and four distinct opener finishes cost twelve off-quarter times against *By the Book*'s three. Its
weekday demand fit (75.3) is the worst of the four; its rotation matches *By the Book* and *Quarter To* on
every rule figure.

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
both, which the hard-limits row on page 5 now says out loud rather than leaving to be assumed. On
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
SHA-256 over the 24 × 7 cells in line order.

**Evidence class**: the 24-line length, the four cover weeks and the December headcounts are
owner-relayed figures with no document behind them (class C — `docs/KNOWN_LIMITATIONS.md` → Links),
and the 13-day limit's policy citation is outstanding. Neither PDF is a recommendation; both say so.

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
node shots.mjs <rendered>.html       # A4 page screenshots + a height check against the printable page
node regenerate.mjs --check           # every proposal's fingerprint, without rendering
node regenerate.mjs                  # re-render EVERY sheet from the same inputs that produced it
```

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
