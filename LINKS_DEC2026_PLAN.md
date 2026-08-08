# LINKS_DEC2026_PLAN.md — the Links workspace and the December 2026 timetable change

*Not version-stamped; not a runtime asset. Companion to `.claude/rules/links-design.md`, which stays
authoritative for how the workspace is built.*

> **"Dec 26" means the DECEMBER 2026 TIMETABLE CHANGE.** It is industry shorthand for a timetable
> change date, not for 26 December. This matters in this repo specifically: `roster-data.js` and
> `OTHER_PLAN.md` carry a separate rule about **Boxing Day (26 Dec)** never being a training day, and
> `isChristmasRD()` forces 25/26 December to rest days. The two are unrelated. Anywhere this document
> says Dec 2026 it means the timetable change; anywhere the code says 26 Dec it means Boxing Day.

---

# 🗓 DECEMBER 2026 READINESS — read this first

*Added v19.97 (external review). Everything below this dashboard is the research and the
implementation record, and it is worth reading — but December 2026 is now a real approaching event,
and this document had no view that answered "are we ready, and what is stopping us?"*

**The tool is essentially built. What remains is decisions and a meeting.** Every outstanding row
below is owned by somebody other than the developer.

| Item | Status | Needed by | Blocker / owner |
|---|---|---|---|
| Timetable data (all three simplifiers) | ✅ Final — confirmed not provisional (owner, Aug 2026) | — | — |
| Existing roster baseline | ✅ Measured (corrected v19.79 — 9 / 8 consecutive days, not 15 / 14) | — | — |
| Operating-window setting | ✅ Shipped v19.54 | — | — |
| ORR fatigue factors (p3, 24 factors) | ✅ Shipped v19.46 (+ v19.48 / v19.69 corrections) | — | — |
| Demand overlay | ✅ Shipped v19.56 | — | — |
| Line-order objectives | ✅ Shipped v19.58–v19.60 | — | — |
| **Hard company limits — a controlled source** | ⚠️ **Cited to the policy, but the policy is not identified** | **Before management review** | **Gareth** — get the title, clause, staff group and effective date. Evidence class B required (ROADMAP.md → Evidence class) |
| **Sunday operating window** | ⚠️ **Decision needed** — five Dec-26 movements fall after the 23:25 finish, three of them arrivals | **Before proposals are frozen** | **Nathan** |
| **Business staffing requirement** | ⚠️ **Never formally stated.** "Coverage vs service" is an inference from the data, not something anyone said | **Before the final design** | **Management** |
| **FF18 reading — cadence or step?** | ⚠️ Unsettled; changes whether any proposal can clear it | **Before proposals are drawn** | **Nathan** (see Open question 2) |
| **Proposals A / B** | ❌ Not started | T−8 weeks | The four decisions above |
| **Management review meeting** | ❌ Not scheduled | T−6 weeks | **A date.** See below |

## The backwards plan — because the only immovable deadline is outside this repository

This document previously admitted *"the timing … is not known"*, and that was reasonable when it was
written. It is now **August 2026**, the target is **December 2026**, and a very sophisticated
technical project can still be rushed because nobody worked backwards from the date.

**T = the December 2026 timetable change date.** Pin T first — everything below is relative to it,
and T is a published industry date, not something to estimate.

| Milestone | Latest safe | For a mid-December T, that is roughly |
|---|---|---|
| Timetable source frozen | T−12 weeks | mid-September 2026 ✅ *(already done)* |
| The four decisions above settled | T−10 weeks | late September |
| First viable proposals | T−8 weeks | mid-October |
| Management review | T−6 weeks | end October |
| Adjusted proposals | T−4 weeks | mid-November |
| Operational sign-off | T−2 weeks | end November |
| Tool / data freeze | T−1 week | early December |

**These intervals are a starting proposal, not a commitment** — Gareth and Nathan should set the
real ones. The point is that a backwards plan exists at all: without one, the first hard date anyone
meets is the timetable change itself.

**If the room is booked before everything lands**, the useful minimum is unchanged: the baseline
table below, printed alongside the current link. That alone answers "where are we starting from",
which is the question a proposal is unreadable without.

---

## Why this exists

Nathan Sobers (Regional Manager, London Area) issued the three base simplifiers for the December 2026
timetable change and asked S. Silva and G. Miller to build CEA roster proposals for the wider team,
with dedicated days and a room booked. He will then assess the proposals against **business
requirements** and the **ORR good-practice fatigue factors** (p3 of *Good practice guidelines —
Fatigue Factors*, December 2021).

The Links workspace (`links.html`) is the tool those proposals will be built in. This document
records what the timetable actually demands, what the tool can and cannot currently do about it, and
the order the work should be done in.

## Sources

| File | What it is |
|------|-----------|
| `Dec_26_10_of_13_SX_MYB_Simplifier.xlsx` | Marylebone arrivals + departures, **Mondays–Fridays** |
| `Dec_26_SO_MYB_Simplifier__Final.xlsx` | Marylebone arrivals + departures, **Saturdays only** |
| `Dec_26_Su_MYB_Simplifier__Final.xlsx` | Marylebone arrivals + departures, **Sundays** |
| `goodpracticeguidelinesfatiguefactors.pdf` | ORR, Dec 2021. The factor list is **p3** |

Each simplifier is one sheet (`MYB`): arrivals (train, origin departure, arrival at MYB, platform)
against departures (train, departure from MYB, destination, max CAO, diagrams). Headcodes beginning
`5` are empty-stock moves and are excluded from every count below.

---

## What the timetable demands (measured, not estimated)

**Demand = arrivals *and* departures, weighted by the length of the train** (owner, Aug 2026 —
this settles what was open question 1). Both halves matter: an arrival is a full detrain and an
departure is a dispatch, and a 9-car train is not the same job as a 3-car one either way.

Passenger movements at Marylebone — ECS excluded:

| | Movements | Cars | Shape | First → last |
|---|---|---|---|---|
| **SX** Mon–Fri | 311 (148 arr / 163 dep) | 1,756 | **Twin-peaked** — by movement 08:00 (23) and 17:00 (23); **by cars the evening wins**, 17:00 (140) / 18:00 (138) over 08:00 (127) | 00:01 → 23:57 |
| **SO** Saturday | 215 (105 / 110) | 1,266 | **Flat** — 13–15 per hour across 08:00–20:00; peak 10:00 on both measures | 00:10 → 23:57 |
| **Su** Sunday | 188 (91 / 97) | 1,059 | **Late-starting, evening-weighted** — nothing 01:00–07:00, peak 17:00 on both measures | 00:05 → 23:54 |

Hourly, both measures (arrivals + departures; hours 01–04 are empty on all three days and omitted):

```
hour        00  05  06  07  08  09  10  11  12  13  14  15  16  17  18  19  20  21  22  23
SX  movements 5   1  14  19  23  22  17  15  14  15  14  15  18  23  23  19  16  13  13  12
SX  cars     27   5  69 107 127 122  95  85  75  84  79  87 105 140 138 107  90  73  75  66
SO  movements 1   1   4  10  13  14  15  14  13  11  12  12  14  14  12  11  13  12  11   8
SO  cars      4   6  24  58  75  81  92  88  77  64  68  72  84  82  67  64  79  78  62  41
Su  movements 1   -   -   3   8  11  13  13  12  11  10  11  13  14  13  13  10  11  12   9
Su  cars      5   -   -  15  45  65  71  74  71  61  55  64  69  78  73  75  52  71  65  50
```

Three genuinely different shapes. The generator already separates Mon–Fri / Sat / Sun targets, so the
model fits — what changes is the distribution of duty start times inside the day, not the length of
the working day.

**Weighting by cars changes the weekday answer.** On movement count the morning and evening peaks tie
at 23; on cars the evening is 10% heavier (140 v 127) and the peak *hour* moves from 08:00 to 17:00.
The evening also stays high for longer — 17:00 and 18:00 are both above 135 cars, whereas 08:00 has a
single hour at that level. A design that staffs the two peaks equally is therefore under-covering the
one that matters more. Saturday and Sunday are unaffected: both measures agree on their peak hour.

**Where the length figures come from, and the one gap.** `Max CAO` (train length in cars, 3–9) is
present on **every** departure. An arrival and a departure on the same spreadsheet row share a
platform and a unit — the arrival turns round into that departure — so the row's `Max CAO` is the
arrival's length too; that covers 85–89% of arrivals directly. The `Unit Diag.` column recovers a
further handful by matching the diagram to a length recorded elsewhere in the sheet. That leaves
**21 SX / 11 SO / 10 Su arrivals with no length recorded anywhere**, counted at the day's mean
(6 cars) rather than dropped.

**A recovered length is capped at 9, the route maximum.** Where a cell listed two unit diagrams the
recovery summed them — right in principle, since the arrival splits into two departures — but it
produced three impossible values (11, 13 and 13 cars) against a `Max CAO` that never exceeds 9 in
the authoritative data. Capping them costs 10 cars across 4,081, and the peak hours are unchanged
except that Saturday's 10:00/11:00 tie by cars resolves to 10:00, matching its movement peak.

> **Do not default an unresolved arrival downward.** These are mostly trains that terminate and go
> empty to stabling, so nobody re-boards — arguably a *heavier* CEA job than a turnround, not a
> lighter one. Counting them at zero would quietly delete the workload the tool exists to show.

**Two corrections to the earlier figures in this plan.** First, five SX cells store their time as an
Excel serial fraction (`0.4034…` = 09:41) rather than as text, and the first parse dropped them —
three at 09:00, one at 16:00, one at 18:00. The SX totals are therefore **311, not 306**. Second,
`+` in a time (`05+46`) marks an **ECS** move, without exception: all 53 `+` movements carry a `5x`
headcode and all 306 `:` movements carry `1x`/`2x`. That rule is what the ECS exclusion rests on, and
it is worth restating because a parser that treats `+` as a separator silently inflates the weekday
day by 53 movements of work nobody does.

**Still not used: platform occupancy.** The `Plat.` column spans platforms 1–6 plus `1T`–`6T` variants
and `W`. Concurrent platform use is arguably closer again to what drives CEA *headcount* — two trains
on one platform is not the same job as two trains on two platforms — and nothing here computes it.
Recorded as a known limitation of the demand curve, not as a blocker.

**Resolved: all three simplifiers are final** (owner, Aug 2026 — open question 4). `SO` and `Su` are
named `__Final`; `SX` is named `10_of_13` and is not, which is why this was flagged — the weekday
profile drives most of the design. The naming is not the status: the content of the measured file is
settled. The file name stays on screen in `DEC_2026_SOURCE` regardless, because "final" means *this
file* is settled — if a later weekday file ever supersedes it, every figure here has to be
re-measured from that file rather than assumed to carry over.

## What actually drives CEA headcount (owner, Aug 2026)

Not the trains, mostly. The station rosters **posts** — ticket office, gateline, passenger assist,
lost property (daytime Mon–Fri only) — plus **extras to cover breaks**. A post is a continuous
commitment: the gateline needs someone on it whether the hour carries 23 movements or 5. So a large
part of the headcount is flat across the operating window and does not follow the train curve at all.

**The existing link already covers all of that**, which is why the existing link is the baseline for
December 2026 rather than something to be rebuilt from the timetable. See package 4.

**So the measured service above is EVIDENCE, not a target.** It is what the coverage overlay shows a
designer so they can judge whether cover looks right; it is not a number the tool turns into staffing.
There is no CEA-per-train ratio written down anywhere, and the tool must not invent one.
## The staffed window, and the one boundary that has to move

The CEA operating window is **Mon–Sat 06:20–23:55** and **Sunday 07:15–23:25** (owner, Aug 2026).
The railway day runs to the last train just past midnight; CEA duties finish at 23:55, so the
post-midnight departures are outside the link by design, not by oversight.

Measured against those real windows:

| | Inside window | Before | After |
|---|---|---|---|
| Mon–Fri | 300/311 — **96.5%** | 9: last trains 00:01–00:15, then 05:55 / 06:04 / 06:11 dep, 06:16 arr | 2 — both 23:57 |
| Saturday | 212/215 — **98.6%** | 2: 00:10 dep, 05:52 dep | 1 — 23:57 dep |
| **Sunday** | 182/188 — **96.8%** | 1: 00:05 dep | **5: 23:27 dep, 23:35 arr, 23:45 dep, 23:51 arr, 23:54 arr** |

**Mon–Sat needs no change.** The overhang is two minutes; the duty ends as the last train leaves.

**Sunday's finish looks ~30 minutes short.** A departure at 23:45 and three arrivals to 23:54 all fall
after the 23:25 finish. Sunday's *start* is fine — the first three Sunday departures are all at or
after 07:15. This is a business-requirement question for Nathan rather than a tool question, but the
proposals should answer it deliberately instead of inheriting it.

---

## The fatigue factors, against what the tool checked — the gap that package 2 closed

> **This table is the ORIGINAL gap analysis, kept as the record of WHY package 2 was built.** Its
> "Checked today?" column describes the tool **before v19.46**; every row in it now reads yes. Do not
> read it as current state — `links-fatigue.js` covers every applicable factor and asserts the
> inapplicable ones. It is left here because the argument for the work is more useful than a table
> of ticks, and because the "Applies to a CEA rotating link?" column is still the live judgement.

P3 lists **24 factors** in five families. `runDesignChecks` tested two things that map to
them, and CEAs work no nights, which makes a large part of the list inapplicable:

| Factor | Applies to a CEA rotating link? | Checked today? |
|--------|--------------------------------|----------------|
| FF2 early start 05:00–07:00 | **Yes** — every 06:20 duty is an FF2 early | No |
| FF15 >4 consecutive early shifts in a rotating pattern | **Yes** | No |
| FF8b <2 days rest after a block of consecutive early starts | **Yes** | No |
| FF19 successive start times vary by >2h | **Yes** | No |
| FF17 backward rotating pattern | **Yes** — the generator builds forward; a check would prove it | No |
| FF18 rotating pattern of about a week | **Probably** — the link moves one line per week; worth asking Nathan | No |
| FF11 >13 consecutive shifts without a 48h break | Yes | Partially — "longest run" is related but is not this |
| FF13 <12h rest in any 24h | Yes | **Yes** — the short-turnaround check |
| FF5 / FF7 duty over 12h (day) / over 10h (early) | Yes | No |
| FF10 >4 consecutive 12h day shifts · MRSF >12 consecutive day shifts · >7 consecutive 8h shifts · >55h in any 7 days | Yes | No |
| FF1, FF3, FF4, FF6, FF8, FF9, FF12, FF14, FF16, FF20, MRSF permanent-pattern rules | **No** — all night-shift or pre-05:00 rules | n/a, but a check should assert they stay n/a |

The gap was the point: Nathan assesses against this list, and the tool covered two of it. Closed at
v19.46 — see package 2 below for what the building actually found.

### The checks card now has TWO halves, and the difference matters in the room (v19.80–v19.94)

Everything above is the **advisory** half — the ORR's p3 factors, which the ORR is explicit are *not*
prescriptive limits. That half reports what a design features and never passes or fails it.

Sitting **above** it is a second, smaller section from `links-limits.js`: the **hard limits**, which a
design either meets or cannot be run. It renders in red on a breach, and it renders whether it passes
or fails — a passing limit has to be visible on the sheet that goes to Nathan, not hidden behind a
disclosure. Today it holds one check: **no more than 13 consecutive worked days**.

**Where that 13 comes from, since the question will be asked.** The Hidden report into the Clapham
Junction crash of 12 December 1988, whose working-hours recommendations the industry adopted as
standards; at Chiltern they are carried in **company policy** (owner, Aug 2026). It is not
legislation, and the app is careful never to say it is — that claim was made in error at v19.80 and
took an external review to unwind.

**Three more limits in that family exist and the tool does not yet treat them as limits.** They are measured
already; they are simply rendered as advisory ORR rows:

| Limit in the Hidden family | Measured by | Shown today as |
|---|---|---|
| Max consecutive days (13) | `assessHardLimits` | **hard limit** |
| Min rest between turns | the short-turnaround check (12h) | FF13, advisory |
| Max length of a turn | duty length (12h) | FF5, advisory |
| Max hours in a rolling week | `maxHoursInAny7Days` | MRSF row at 55h, advisory |

Worth settling before the proposals are drawn, because it changes how a reader weighs those rows: a
figure in the advisory half invites a justify/minimise/control conversation, while the same figure in
the hard half ends one. The blocker is the confirmed figures from the policy document, not the code.

## Baseline: what the CURRENT link scores (review pass)

The first draft proposed fatigue checks without ever running the existing checks against the existing
link. That was the wrong order — you cannot read a proposal's numbers without knowing what today's
pattern scores, and Nathan will inevitably ask. Measured by running `runDesignChecks` over the live
`weeklyRoster` and `bilingualRoster`:

| Cycle | Lines | Longest worked stretch | FF11 — longest run between 48h breaks | Short turnarounds (<12h) | Weekends off |
|-------|-------|------------------------|----------------------------------------|--------------------------|--------------|
| Main | 20 | **9 days** | **12 shifts** — clear | **0** | 4/20 (20%) |
| Bilingual | 8 | **8 days** | **15 shifts** — over | **0** | 0/8 |

> **These figures were 15 / 14 / 15 / 15 until v19.79, and they were wrong.** The tool counted a
> SPARE week as seven worked days. A spare week is **four** duties of seven (owner, Aug 2026) — you
> are marked spare on all seven because you are available for cover, but four is what you work — so
> the week always contains a rest day and can never fuse the blocks either side of it. Counting it
> 7/7 did exactly that, and inflated both cycles by six days.
>
> The direction is what makes it serious rather than untidy. **13 consecutive days is the Hidden
> limit** — from the inquiry into the Clapham Junction crash of 1988, adopted industry-wide and, at
> Chiltern, carried in company policy (owner, Aug 2026) — so a check reporting 15 was not erring on
> the safe side: it reported
> a breach that does not exist, on the roster people are working right now. Anyone who knows the
> real link would have discounted the row — and the next design that genuinely does go past 13
> would have been hidden by that discount. Both figures above are now the WORST CASE over every
> placement of each spare week's four duties, which is the number that can be defended in the room.

**Those first two columns are DIFFERENT measures, and the corrected figures make the gap wider,
not narrower.** A single rest day is not a 48h break, so it does not reset the FF11 count — the
main cycle's 9-day worked stretch sits inside a 12-shift FF11 run, and the bilingual's 8-day
stretch inside a 15-shift one. Quote the **FF11 column** when the subject is FF11; that is the one
being read against the guidance. Quote the worked-stretch column when the subject is consecutive
days on duty.

Two things fall out of that, and both matter more than anything else in this document:

1. **The BILINGUAL cycle exceeds FF11; the main cycle does not.** 15 shifts against 12. That is a
   different statement from the one this document carried until v19.79 ("both cycles, at 15 shifts
   each"), and a more useful one: it names where the problem actually is. A standby day IS a duty
   and counts, but a spare WEEK is four of them, not seven. Read any FF11 finding in a proposal
   against 12 for main and 15 for bilingual, never against zero.
   **The bilingual 15 is a worst case with a structural cause worth knowing:** its two spare weeks
   are lines 1 and 8 of 8, so they wrap into each other, and a spare week's three rest days need
   not be adjacent — so in the worst arrangement neither week supplies a 48h break while both still
   supply duties.
2. **Zero short turnarounds on either cycle.** The existing link never places a timed late immediately
   before a timed early — the same "start times only move later" principle the generator encodes. The
   FF13 check is therefore silent on live data, which is a good sign for the check rather than a
   worrying one: it is not crying wolf today, so when it does fire in a proposal it will mean
   something.

**A caution about how that was measured.** Splicing the 20 main lines and the 8 bilingual lines into
one 28-line sequence returns a longest stretch of **19** — an artefact of joining two unrelated
rotations end to end, not a property of either. The number above is per real cycle. The tool will
happily compute a stretch across any 28 lines it is given, so a 28-line design is only meaningful once
those 28 lines genuinely are one rotation. In the new design they will be; in the baseline they are
not.

## What the generator produces, measured against the real seed

Re-measured v19.75 against the actual roster seed (28 slot rows, 6 spare lines) rather than a
hand-built target set, because every earlier figure in this section was taken from a reconstruction
and through a construction that stopped being the default at v19.59.

| | live main roster (20 lines) | generated, settled (default) | generated, rotating (fallback) |
|---|---|---|---|
| days per line | 3–7, clustered at 5 | 3–7, clustered at 5 | 3–7, clustered at 5 |
| longest run | 9 days | **9 days** | 10 days |
| FF11 (shifts between 48h breaks) | 12 | **12** | 16 |
| short turnarounds | 0 | **0** | **0** |
| weekends off | 4/20 (20%) | 7/28 (25%) | 6/28 (21%) |

*(The 7s in the days-per-line row are spare weeks — a spare line is marked SPARE on all seven days.
It is four DUTIES, and the run figures above count it that way; the days-per-line row is counting
marked days, which is a different question. The live roster has four spare weeks, the seed six.)*

**The generator's output is indistinguishable from the real roster on the measures that matter**, and
matches it exactly on the two that would be dangerous to get wrong: zero short turnarounds, and an
FF11 of 12 against the live main roster's 12. It does not IMPROVE the longest run — 9 days, the same
as today's link — which is a property of the targets, not of the construction. Note the fallback
construction is measurably WORSE on both (10 days, FF11 16), which is one more reason the status
line names which one produced a design.

**The owner's target is below the 13-day limit, not at it** (Aug 2026): ideally a new base link
would not carry even **7** consecutive worked days. The live main roster's non-spare blocks reach
exactly 7; the generator's reach 6. So the aspiration is already within reach of the tool, and the
9-day worst cases above are entirely made of a spare week's four duties landing against a block.

**Correctness, verified rather than assumed** (v19.75). Against the real seed, both constructions:

- meet every day's total **exactly** — Sun 10, Mon–Fri 16, Sat 14, matching the seed;
- staff every individual shift TIME at exactly the right level on every day, not merely the totals;
- fill all 28 lines, none blank;
- produce **0** short turnarounds;
- and reordering for the line-order objectives leaves the daily coverage multiset **identical**,
  which is the safety property the whole objectives feature rests on.

The generator also **refuses** rather than degrading when the targets exceed capacity — see the
capacity table under package 4, which is where that stops being a curiosity and starts being the
argument.

## Work packages

Ordered **2 → 1 → 3 → 4 → 5**: the fatigue checks carry the most value and depend on nothing, and
the operating window is what unblocks the overlay and the generator targets. The numbering is kept
from the first draft so the review correction under package 1 stays legible.

**Status:** 2 shipped v19.46 (with the baseline), 5 shipped v19.47, 1 shipped v19.54, 3 shipped
v19.56. Only **4** remains — and it is now FULLY unblocked: open question 1 was answered in Aug 2026 (arrivals and
departures, weighted by train length), package 3 has already put that profile in the tool, and open
question 4 was answered in Aug 2026 (all three simplifiers are final), which was the last thing
holding it — building an importer against a timetable about to be reissued would have been wasted.

### 1. Operating-window setting — ✅ **SHIPPED v19.54**

`links-window.js` + `links-window.test.mjs`. The window is editable on the Coverage card, persisted
per design, shown above the heat map, stated on both compare column headers and on the printed
sheet, and defaulted for every design saved before it.

**The reason turned out to be stronger than this plan recorded.** The heat map derived its own span
from the design — first worked hour to last — and flagged a gap only strictly *between* them. So
missing cover at either END of the day was invisible: the span simply shrank to fit and those hours
left the table. Measured on a 28-line design where everybody finishes at 14:20, leaving the station
unstaffed until the 23:55 close: **zero gaps flagged**. It now flags **71**. The window did not just
make the demand overlay expressible — it fixed a blind spot in the check that already existed.

Two things worth knowing before changing it: `normaliseWindow` falls back per ROW but never per
FIELD (pairing a stored start with a default end would invent a window nobody chose and then print
it as deliberate), and the editor uses TEXT inputs because Chromium renders `<input type="time">` in
the OS's 12-hour format **even at en-GB** — measured — which would have put "11:55 PM" beside a grid
reading 23:55.

<details><summary>Original scope</summary>


Store the window **on each design**, with app defaults of Mon–Sat 06:20–23:55 and Sun 07:15–23:25.

Per-design rather than global because a proposal may legitimately test a moved boundary — the Sunday
finish is the live example — and compare mode then shows two designs with different spans side by
side, which is the argument you would put to Nathan. It also travels with the design when printed, so
the sheet states the window it was designed to. Designs saved before this carry no such field and
fall back to the defaults, so nothing already saved changes.

Two rows (Mon–Sat, Sun) matches the operation as described. Saturday can split from Mon–Fri later if
it ever diverges; the generator already has three columns, so the plumbing exists.

**The trap in making it per-design:** compare mode highlights differing *cells*, not differing
*windows*, so two designs built to different spans would compare as though they were like for like.
If the window is per-design, compare mode has to show it in both column headers, and the printed sheet
has to state it. Otherwise the override becomes a way to make an unfair comparison look fair.

**Correction (review pass).** The first draft of this plan put this package first, on the claim that
"packages 2–4 all consume it". That is wrong. Package 2 does not touch it at all: FF2 needs start
times, FF5/FF7 need durations, and FF15/FF8b/FF19/FF17 need the day sequence — none of them need to
know when the station is staffed. Only the demand overlay (3) and the generator targets (4) consume
the window. With the false dependency removed there is nothing holding package 2 back, and package 2
is the one Nathan will actually assess against, so it goes first.

Note it needs a `firestore.rules` allowlist change — the same shape as the `deletedAt`/`deletedBy`
pair added at v19.41 — so a rules deploy rides alongside hosting.

*Done when:* the window is editable, persisted per design, shown on the Coverage card so the heat map
explains itself, printed on the sheet, and defaulted for existing designs.

</details>

### 2. Fatigue checks against p3 — ✅ **SHIPPED v19.46**

`links-fatigue.js` + `links-fatigue.test.mjs`, rendered in the Design checks card. The baseline
below ships with it. What it found on the live link the day it landed is recorded in "Baseline"
above; the two design notes that survived contact are that FF11 needed its own rule (a single rest
day is not a 48h break) and that a rotation with **no** 48h break anywhere has to report every
worked day rather than the sequence length — the first implementation returned the length, counting
rest days as shifts, and its own test caught it.

Still open from this package: FF17/FF18/FF19 render with "(definition to confirm)" until Nathan
settles them.

<details><summary>Original scope</summary>


Extend `runDesignChecks` to cover every factor in the table above that applies, each labelled with its
FF number, so a printed proposal is already annotated against the document it will be assessed with.

The maths belongs in `links-design.js` (pure, tested) — the module already holds the turnaround and
consecutive-run logic, and this is the same kind of reasoning over the same sequence.

Three design notes, the third added in the review pass and the most important of the three:

- The n/a factors should be *asserted* rather than silently omitted, so a design that somehow acquires
  a night duty fails loudly.
- The checks report factors **present**, not pass/fail — the ORR framing is explicitly that these are
  not prescriptive limits, and a tool that renders them red/green would misrepresent the guidance.
- **Separate standing characteristics from design-specific findings.** FF2 fires on *every* 06:20
  duty, so on this link it is a property of the operation, not a signal about a proposal — and a check
  that flags half the rotation on every design is the same cry-wolf failure this plan warns about for
  the demand overlay. Present the unavoidable factors as a stated characteristic with a count; reserve
  the per-design findings for the factors a designer can actually change (FF15, FF8b, FF19, FF11, the
  duty-length and weekly-hours rules).

**Liability posture — state this in the UI, not just here.** These checks are an aid to two designers,
not a fatigue risk assessment. The greatest risk in this package is not a missing check but a design
that shows no findings and is read as approved: false assurance on a safety-adjacent matter is worse
than no tool at all. Nothing in the output should read as a certificate, and the ORR's own escalation
— justify, minimise, then assess and control — is the frame to present findings in.

*Done when:* every applicable factor is reported with its FF number, the inapplicable ones are
asserted, and each rule has a unit test.

</details>

### 3. Demand overlay on the coverage heat map — ✅ **SHIPPED v19.56**

`links-demand.js` + `links-demand.test.mjs`. Three demand rows sit under the cover in the same
table, one per day class, shaded in orange against their own peak — cars per hour, arrivals plus
departures, per the answer to open question 1. The note names the disagreement between the two
measures (08:00 by movement, 17:00 by cars), states the uncovered staffed hours as a finding, states
the movements outside the window as a fact, and carries the timetable's provenance.

**It shipped broken once, and the failure is worth keeping.** The first implementation held HOURLY
buckets and asked the window an hourly question. The Sunday finish is **23:25**, so "is hour 23
staffed" is true — and the five movements after it, the one live finding in this whole plan, were
reported as fully covered. Every unit test passed: one of them was written with a synthetic
`h <= 22` Sunday window rather than the real one, so it agreed with the bug. It was caught by
rendering the actual page and reading the actual sentence.

The fix stores movement TIMES rather than hourly buckets — and derives the hourly curve from them,
so the shading and the boundary check cannot describe different timetables. That also made the
mirror-image finding visible at the other end of the day: **three weekday trains (06:04, 06:11,
06:16) run in the hour before the 06:20 opening** — the ones the overlay can mark, since they share
an hour cell with the opening. A fourth, the 05:55 departure, is earlier still and sits in an hour
the heat map does not draw at all; the window table above counts all four. Quote four, not three,
if the subject is how much of the morning falls outside the link.

### 4. More people, same shape — ❌ **WON'T-DO (owner, Aug 2026: "over complicates it")**

A control was built at v19.78 — "increase every target by N%" on the generator, scaling the seeded
target table in place — and **removed at v19.83**. The uplift figure was never supplied, and on
reflection the tool did not need to own this: the targets are hand-editable, so a designer who knows
the number can simply type it.

**The measurement behind it stands, and it is the part that matters.** It is not a feature request,
it is the argument to take into the room:

> 22 working lines × 7 days = **154 day-slots per cycle**. Every extra duty comes out of a rest day.

| uplift | duties | rest days | rest days per line |
|---|---|---|---|
| 0% (today) | 104 | 50 | 2.27 |
| +20% | 107 | 47 | 2.14 |
| +25% | 129 | 25 | **1.14** |
| ~+37% and up | — | — | **refused: over capacity** |

**A service increase of any size cannot be absorbed by making the existing lines denser — the link
has to get bigger, which means more staff.** The generator refuses outright above ~+37% (28 people
needed on a weekday against 22 working lines), so the tool fails loudly rather than quietly producing
something unworkable.

*(The run-length column that used to sit in this table has been dropped: it was measured before
v19.79 corrected the spare-week reading and overstated by about six. The shape of the finding — every
extra duty costs a rest day — is unaffected, and is what the table is for.)*

If a percentage control is ever proposed again, `.claude/rules/links-design.md` records the two rules
it must carry, both of which cost a release to learn.

### 5. Midnight-crossing guard — ✅ **SHIPPED v19.47**

`endMinutesAbs` in `links-design.js` is now the one reading of a duty that runs past midnight, and
both callers use it: the heat map counts a wrapping duty on **both** days (Saturday spilling round to
Sunday) instead of dropping its post-midnight hours, and the turnaround check lets that duty eat into
the rest that follows it. `links-fatigue.js`'s `dutyMinutes` delegates to it rather than keeping a
third copy.

What the two defects had in common is the part worth remembering: **both erred towards *safer than
the truth*.** The heat map lost hours from the artefact whose entire job is showing where cover is
thin, and the turnaround check reported ~26h of rest for a 00:30 finish before an 06:20 start — 5h50
in reality — so the most dangerous turnaround the module can express was the one it called compliant.

Still unreachable from the CEA link (duties finish 23:55) and the `normaliseCustomShift` ban on a
wrapping value stays — it is the input boundary, not a duplicate of this. Reachable only through
legacy/imported data, the same route `canonicaliseShift` exists for.

## Not building

**An automatic optimiser.** The generator produces a compliant skeleton; which duties fit the service
is a judgement for the two designers. The tool's job is to check and to show, not to decide.

**Compare mode carrying its own analysis.** Compare shows two grids with a gold cell diff; the
Coverage and Design-checks cards below still describe only the ACTIVE design. So the reason you would
compare two proposals — their cover against the service, their fatigue findings — is the one thing
compare mode does not do, and the cell diff tells you *where* they differ rather than *what that
means*. **Deliberately deferred, not rejected:** it is a real gap, but it is a feature rather than a
polish item, and it should be built once there are two real proposals to compare, instead of against
a guess about what the comparison ought to say. (Related, and already recorded as accepted: at 1440px
both compare columns clip before Saturday, so Saturday cannot be compared without scrolling each
column on its own.)

**The generator's 28 near-identical rows.** Seeded from the current roster it renders 28 shift rows ×
3 columns = 84 number fields, most of them zero, so reshaping one part of the day means finding one
row among 28 similar time dropdowns. Left alone on purpose: package 4 would have changed where those targets
come from, and re-designing the table before that lands would mean doing it twice. (It said 25/75
until v19.65; the seed takes every distinct worked time across all 28 roster lines, and
`.claude/rules/links-design.md` already said 28 — the two docs simply disagreed.)

## Open questions

Ordered by how much they change if the answer is unexpected.

1. ~~**What actually drives CEA workload?**~~ — **ANSWERED (owner, Aug 2026): arrivals as well as
   departures, weighted by the length of those trains.** Computed and recorded in "What the timetable
   demands" above; it moves the weekday peak from 08:00 to 17:00, which is a material change to what
   packages 3 and 4 are built against. Platform occupancy remains uncomputed — a known limitation of
   the curve rather than an open question, since the signal that was going to be settled has been.
2. **FF18 still needs raising early — but the earlier framing here was wrong** (owner correction,
   Aug 2026). This plan previously said the factor was "unavoidable by construction" because a
   28-line link moves everyone one line per week by design. That reads the factor as being about the
   weekly *cadence*, when the concern it names is the **size of the step**: what makes a weekly
   rotation hard is your working day jumping, and a rotation where consecutive lines sit close
   together asks far less of the body clock than one where they do not. The cadence is fixed; the
   step is a design choice, and a real one.

   Two consequences. First, it is still worth settling with Nathan before the proposals are drawn —
   if the factor is read as cadence-only then no proposal can avoid it, and that belongs in the
   justify/minimise/control conversation rather than a checklist. Second, the step is now
   **measurable and tunable**: `links-adjacency.js` (v19.58) scores the week-to-week movement across
   the whole rotation and the generator can order the lines to minimise it, behind a switch.

   **Do not quote a step figure without saying which switches were on** (corrected v19.65). This
   paragraph said "took the mean step from 42 minutes to 9", which is `gentle` **alone** and is not
   what the tool does by default. Since v19.60 `variety` is also on, and it deliberately spends that
   step to cap how long anyone sits on the same shift — the change made after 11-week blocks were
   judged "excessive and would be unpopular". The delivered default measures **95 min** on the roster
   seed. Nine minutes is achievable and is a real answer to FF18; it is just not the one the tool
   gives you unless you turn variety off and accept blocks of 8+. Offering the 9 in the room would
   overstate the tool by an order of magnitude.

   **The panel row now reads from that measurement** (v19.69; it reported a hardcoded `standing`
   from v19.46, breaking the module's own "never hardcode a status" rule for the second time after
   FF13 at v19.48). It states the typical weekly move, the largest, and how many boundaries exceed
   two hours. **On the live main roster: typically 4h 0m a week, largest 8h 46m, 9 of 20 boundaries
   over 2h** — the baseline to read any proposal's figure against, and the number to take into the
   conversation below. For comparison the generator's shipped default measures ~1h 35m.

   The STATUS deliberately stays `standing` whenever the step is measurable rather than turning
   `present` above some figure: the ORR gives no threshold for FF18, so inventing one would be the
   pass/fail rendering this panel must never produce. The derived branch is `n/a`, for a design with
   no timed lines at all — a row that cannot be computed does not get to claim anything.
3. **Does the Sunday finish move?** Five movements fall after 23:25 — and the answer to question 1
   **strengthens** this rather than weakening it. The earlier draft noted the case would drop from
   five movements to two if arrivals needed no CEA; arrivals do count, so all five stand: 23:27 dep,
   23:35 arr, 23:45 dep, 23:51 arr, 23:54 arr. Three of those five are arrivals full of people
   getting off at an unstaffed terminus.
4. ~~**Is the weekday simplifier final?**~~ — **ANSWERED (owner, Aug 2026): yes, all three are final.**
   The `10_of_13` naming on the weekday file is not a status. This unblocked package 4, which had no
   business being built against a timetable about to be reissued. `DEC_2026_SOURCE.provisional` is
   cleared and the coverage card no longer says "(provisional)".
5. **Should Saturday's window ever differ from Mon–Fri?** Currently identical; the setting can split
   them if the answer changes.

## What this plan does not know

Recorded so the gaps are visible rather than implied:

- **The CURRENT timetable.** Every service figure in this document is December 2026; today's is not
  measured anywhere. Recorded as a gap, **not** a blocker on package 4 — that framing was corrected
  by the owner: the tool already holds today's STAFFING, and the uplift is a figure the business
  states rather than one derived from two timetables. See "The shape is KEPT; only the numbers grow".
- **Whether "coverage vs service" is the business requirement at all.** It is an inference from the
  data available, not something Nathan stated. He said business requirements and fatigue guidelines;
  the fatigue half is documented on p3, the business half is not written down anywhere here.
  Partly softened by the posts steer above — the requirement is now known to be posts + relief +
  a train-driven remainder — but nobody has confirmed that is what the proposals will be judged on.
- ~~**What CEAs actually do at Marylebone hour by hour**~~ — **PARTLY ANSWERED (owner, Aug 2026), and
  it changes the demand model.** See "Demand is POSTS, not trains" below. The remaining unknowns are
  the numbers, not the structure.
- **Whether other grades cover the window's edges.** The 05:55 first departure and the post-midnight
  last trains sit outside the CEA link; something covers them, and knowing what would settle whether
  the Sunday finish is really a gap.
- **The timing — now partly addressed.** No package here was sized against the "See Nathan" days,
  because their date is not known. That is still true of the MEETING date, but the readiness
  dashboard at the top of this file now carries a backwards plan from the timetable change itself
  (T−12 … T−1), so the absence of one fixed date no longer means the absence of any dates. **Pin T,
  then set the real intervals with Nathan.** If the room is booked before everything lands, the
  useful minimum is unchanged: the baseline table above printed alongside the current link.
