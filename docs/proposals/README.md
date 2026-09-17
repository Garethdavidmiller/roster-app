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
| **Weekday Lates** | `WL-24-EXT · a52ec588` | **Supplied as a Word table**, not searched — weekday lates at 16:25, Saturdays left alone | 5 (as today's link) | 9 | 6 in 24 |
| **Fifteen Turns** | `FT-24-EXT · 9a028392` | **Supplied as a grid**, not searched — the shortest turn table yet and a perfect cover spread, but **it does not clear two gates** | 7 | 9 | 2 in 24 |
| **Fifteen Turns Repaired** | `FT-24-R21 · b76bf9e1` | The same design with both gates **repaired** and the rotation re-searched — every duty, headcount and coverage hour unchanged | **1** | 6 | 6 in 24 |
| **Weekday Lates 2** | `WL2-24-R21 · 33f70893` | Weekday Lates with the `08:30–17:00` turns re-timed into the evening to cover the 17:00 peak, then re-searched | **1** | 6 | 6 in 24 |
| **Weekday Lates 3** | `WL3-24-F7 · a6234195` | The same evening fix with **weeks 13–17 kept exactly as written**, then searched fatigue-first | **1** (FF19, at its floor) | 6 | 4 in 24 |

Both clear every hard rule — Chiltern's 13-day limit, twelve hours between duties, the exact
35-hour contracted week — and meet the December staffing shape (four to open, three through to
the close and four on a Saturday, five still on at 22:00, fourteen on a Saturday, ten on a Sunday,
four cover weeks at lines 1, 7, 13, 19). They differ on exactly one thing, and it is a people
question rather than a rules one: *Same Turns* keeps 15 turns people already work and does not meet
the late-shorter-than-early lever; *By the Book* meets every rule and none of its 19 turns is a
time anyone works today. Each PDF states this on its page 5.

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
readings of "protect".

**What protecting them cost is stated rather than glossed:** full weekends off are **4 in 24** here
against 6 in Weekday Lates, because the search had five fewer weeks to arrange around. And week 16
holds three of the nine `08:30–17:00` turns, so the evening fill came from line 9's week and line 6's
Friday alone — 17:00 reaches 7, 7, 8, 10, 10 where Weekday Lates 2, free to move week 16, reached
8, 8, 9, 10, 9.

**The code**: family (`ST` / `BB`) · rotation length · duty table (`A`/`B` today's times, `D` the
December default) · search seed. A trailing `p` (`BB-24-D21p`) is the rules-only run with no
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

Both import forms are verified against `links-import.js` (24 lines, no warnings). Importing one
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
PROPOSAL=ST node final.mjs results/best-A-*.json results/best-B-*.json           # pick, assess, render
PROPOSAL=BB EXTRA=results/best-RDpure-21.json node final.mjs results/best-RD-*.json
node shots.mjs <rendered>.html       # A4 page screenshots + a height check against the printable page
```

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
