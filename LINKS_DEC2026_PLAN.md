# LINKS_DEC2026_PLAN.md — the Links workspace and the December 2026 timetable change

*Not version-stamped; not a runtime asset. Companion to `.claude/rules/links-design.md`, which stays
authoritative for how the workspace is built.*

> **"Dec 26" means the DECEMBER 2026 TIMETABLE CHANGE.** It is industry shorthand for a timetable
> change date, not for 26 December. This matters in this repo specifically: `roster-data.js` and
> `OTHER_PLAN.md` carry a separate rule about **Boxing Day (26 Dec)** never being a training day, and
> `isChristmasRD()` forces 25/26 December to rest days. The two are unrelated. Anywhere this document
> says Dec 2026 it means the timetable change; anywhere the code says 26 Dec it means Boxing Day.

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
| **SX** Mon–Fri | 311 (148 arr / 163 dep) | 1,758 | **Twin-peaked** — by movement 08:00 (23) and 17:00 (23); **by cars the evening wins**, 17:00 (140) / 18:00 (138) over 08:00 (127) | 00:01 → 23:57 |
| **SO** Saturday | 215 (105 / 110) | 1,270 | **Flat** — 13–15 per hour across 08:00–20:00; peak 10:00 on both measures | 00:10 → 23:57 |
| **Su** Sunday | 188 (91 / 97) | 1,063 | **Late-starting, evening-weighted** — nothing 01:00–07:00, peak 17:00 on both measures | 00:05 → 23:54 |

Hourly, both measures (arrivals + departures; hours 01–04 are empty on all three days and omitted):

```
hour        00  05  06  07  08  09  10  11  12  13  14  15  16  17  18  19  20  21  22  23
SX  movements 5   1  14  19  23  22  17  15  14  15  14  15  18  23  23  19  16  13  13  12
SX  cars     27   5  69 107 127 122  97  85  75  84  79  87 105 140 138 107  90  73  75  66
SO  movements 1   1   4  10  13  14  15  14  13  11  12  12  14  14  12  11  13  12  11   8
SO  cars      4   6  24  58  75  81  92  92  77  64  68  72  84  82  67  64  79  78  62  41
Su  movements 1   -   -   3   8  11  13  13  12  11  10  11  13  14  13  13  10  11  12   9
Su  cars      5   -   -  15  45  69  71  74  71  61  55  64  69  78  73  75  52  71  65  50
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
(5.6–6.0 cars) rather than dropped.

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

**Also unresolved: the weekday file may not be final.** `SO` and `Su` are both named `__Final`; the
`SX` file is named `10_of_13` and is not. The weekday profile drives most of the design, so it is
worth confirming its status before building against it.

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

## Baseline: what the CURRENT link scores (review pass)

The first draft proposed fatigue checks without ever running the existing checks against the existing
link. That was the wrong order — you cannot read a proposal's numbers without knowing what today's
pattern scores, and Nathan will inevitably ask. Measured by running `runDesignChecks` over the live
`weeklyRoster` and `bilingualRoster`:

| Cycle | Lines | Longest worked stretch | FF11 — longest run between 48h breaks | Short turnarounds (<12h) | Weekends off |
|-------|-------|------------------------|----------------------------------------|--------------------------|--------------|
| Main | 20 | 15 days | **15 shifts** | **0** | 4/20 (20%) |
| Bilingual | 8 | 14 days | **15 shifts** | **0** | 0/8 |

**Those first two columns are DIFFERENT measures and the bilingual cycle is where they diverge.**
The first draft of this table had only "longest worked stretch" and the paragraph below it called
the 15 and 14 an FF11 result. They are not: a single rest day is not a 48h break, so it does not
reset the FF11 count, and the bilingual cycle's 14-day stretch sits inside a 15-shift FF11 run.
Corrected Aug 2026 against the shipped rule. Quote the FF11 column when the subject is FF11 — that is
the one Nathan will be reading against the guidance.

Two things fall out of that, and both matter more than anything else in this document:

1. **The current link already exceeds FF11** (">13 consecutive shifts without a 48h break") on both
   cycles, at **15 shifts each**. SPARE counts as worked, correctly — a standby day is a duty. So the
   proposals do not start from a clean sheet, and any FF11 finding in a new design should be read
   against 15, not against zero. This is the single most useful number to have in the room.
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

## The generator already scores better than the live link

Also checked in the review pass, because the plan assumed a twin-peaked weekday might be beyond the
rotating-window construction. It is not. Given a deliberately twin-peaked target set (heavy 06:20 and
07:00, light middle, heavy 14:00 and 15:25) `generatePatterns` returns 28 filled lines with:

**longest stretch 6 days · 0 short turnarounds · 15/28 weekends off (54%)**

against the live link's 15 days and 20%. So the generator is a good starting point for the Dec 2026
work rather than something to be fought, and no work is needed to make it express the new shape.


---

## Work packages

Ordered **2 → 1 → 3 → 4 → 5**: the fatigue checks carry the most value and depend on nothing, and
the operating window is what unblocks the overlay and the generator targets. The numbering is kept
from the first draft so the review correction under package 1 stays legible.

**Status:** 2 shipped v19.46 (with the baseline), 5 shipped v19.47, 1 shipped v19.54. That leaves
3 and 4, and **both are now unblocked** — open question 1 was answered in Aug 2026 (arrivals and
departures, weighted by train length) and package 1 supplied the staffed window that lets the overlay
tell "we do not staff this hour" apart from "we have a hole here".

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

### 3. Demand overlay on the coverage heat map

The heat map shows people on duty per hour against nothing. "Does this meet business requirements" is
precisely cover versus service, so overlay the demand profile — **cars per hour, arrivals plus
departures**, per the answer to open question 1.

**It must distinguish service the link deliberately does not staff from a genuine hole in the staffed
span** — otherwise hours 00 and 05 render as permanent uncovered demand on every design, the existing
"red 0 = a gap inside the working day" rule cries wolf, and the check gets ignored. Package 1 is what
makes that distinction expressible.

**Show cars, but keep the movement count visible.** They disagree on the weekday peak hour (08:00 by
movement, 17:00 by cars) and that disagreement is information — a designer looking at a single blended
number cannot see it. Two figures per hour, one curve drawn.

### 4. Timetable-driven generator targets

`buildRosterTargets()` seeds from the *current* roster, which is the wrong baseline for a timetable
change. Allow the targets to be driven by the new service instead — either a pasted per-hour demand
profile or a simplifier import.

**Record which simplifier version the targets came from.** These are "base" files and will be revised;
`SX` is not even marked final. A design built against a superseded timetable with nothing on it to say
so is the same defect class as the undated printed sheet fixed at v19.45 — the data was right when it
was made and there is no way to tell later.

**If a simplifier import is built, the two parsing traps above are the spec.** A `+` time is ECS and
must be excluded; a time may arrive as an Excel serial fraction rather than text and must still be
read. Both failed silently in this plan's own first pass — one inflating the day by 53 movements, the
other losing 5 — and neither raised an error. An importer that gets them wrong produces a demand curve
that looks entirely plausible.

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

## Open questions

Ordered by how much they change if the answer is unexpected.

1. ~~**What actually drives CEA workload?**~~ — **ANSWERED (owner, Aug 2026): arrivals as well as
   departures, weighted by the length of those trains.** Computed and recorded in "What the timetable
   demands" above; it moves the weekday peak from 08:00 to 17:00, which is a material change to what
   packages 3 and 4 are built against. Platform occupancy remains uncomputed — a known limitation of
   the curve rather than an open question, since the signal that was going to be settled has been.
2. **FF18 may be unavoidable by construction, and that needs raising early.** "Rotating pattern of
   about a week" describes a 28-line link exactly: each person changes line weekly, by design. If it
   counts, then no proposal can avoid it and it belongs in the justify/minimise/control conversation
   with Nathan rather than in a checklist — which is a very different conversation to have *before*
   the proposals are drawn than after. It also means the tool should state it as a property of the
   link concept, not flag it per design.
3. **Does the Sunday finish move?** Five movements fall after 23:25 — and the answer to question 1
   **strengthens** this rather than weakening it. The earlier draft noted the case would drop from
   five movements to two if arrivals needed no CEA; arrivals do count, so all five stand: 23:27 dep,
   23:35 arr, 23:45 dep, 23:51 arr, 23:54 arr. Three of those five are arrivals full of people
   getting off at an unstaffed terminus.
4. **Is the weekday simplifier final?** `SO`/`Su` are named `__Final`; `SX` is `10_of_13` and is not.
5. **Should Saturday's window ever differ from Mon–Fri?** Currently identical; the setting can split
   them if the answer changes.

## What this plan does not know

Recorded so the gaps are visible rather than implied:

- **Whether "coverage vs service" is the business requirement at all.** It is an inference from the
  data available, not something Nathan stated. He said business requirements and fatigue guidelines;
  the fatigue half is documented on p3, the business half is not written down anywhere here.
- **What CEAs actually do at Marylebone hour by hour** — dispatch, gateline, assistance, revenue —
  and therefore which of those the movement profile is even a proxy for.
- **Whether other grades cover the window's edges.** The 05:55 first departure and the post-midnight
  last trains sit outside the CEA link; something covers them, and knowing what would settle whether
  the Sunday finish is really a gap.
- **The timing.** No package here is sized against the "See Nathan" days, because their date is not
  known. If the room is booked before package 2 lands, the useful minimum is the baseline table above
  printed alongside the current link — that alone answers "where are we starting from".
