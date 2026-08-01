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

Passenger movements at Marylebone — arrivals plus departures, ECS excluded:

| | Movements | Shape | First → last |
|---|---|---|---|
| **SX** Mon–Fri | 306 (147 arr / 159 dep) | **Twin-peaked** — 08:00 (23) and 17:00 (23) / 18:00 (22); trough 12:00–14:00 (14) | 00:01 → 23:57 |
| **SO** Saturday | 215 (105 / 110) | **Flat** — 13–15 per hour right across 08:00–20:00, peak 10:00 | 00:10 → 23:57 |
| **Su** Sunday | 188 (91 / 97) | **Late-starting, evening-weighted** — nothing 01:00–07:00, peak 17:00 (14) | 00:05 → 23:54 |

Hourly totals (arrivals + departures):

```
hour   00  05  06  07  08  09  10  11  12  13  14  15  16  17  18  19  20  21  22  23
SX      5   1  14  19  23  19  17  15  14  15  14  15  17  23  22  19  16  13  13  12
SO      1   1   4  10  13  14  15  14  13  11  12  12  14  14  12  11  13  12  11   8
Su      1   -   -   3   8  11  13  13  12  11  10  11  13  14  13  13  10  11  12   9
```

Three genuinely different shapes. The generator already separates Mon–Fri / Sat / Sun targets, so the
model fits — what changes is the distribution of duty start times inside the day, not the length of
the working day.

## The staffed window, and the one boundary that has to move

The CEA operating window is **Mon–Sat 06:20–23:55** and **Sunday 07:15–23:25** (owner, Aug 2026).
The railway day runs to the last train just past midnight; CEA duties finish at 23:55, so the
post-midnight departures are outside the link by design, not by oversight.

Measured against those real windows:

| | Inside window | Before | After |
|---|---|---|---|
| Mon–Fri | 295/306 — **96.4%** | 9: last trains 00:01–00:15, then 05:55 / 06:04 / 06:11 dep, 06:16 arr | 2 — both 23:57 |
| Saturday | 212/215 — **98.6%** | 2: 00:10 dep, 05:52 dep | 1 — 23:57 dep |
| **Sunday** | 182/188 — **96.8%** | 1: 00:05 dep | **5: 23:27 dep, 23:35 arr, 23:45 dep, 23:51 arr, 23:54 arr** |

**Mon–Sat needs no change.** The overhang is two minutes; the duty ends as the last train leaves.

**Sunday's finish looks ~30 minutes short.** A departure at 23:45 and three arrivals to 23:54 all fall
after the 23:25 finish. Sunday's *start* is fine — the first three Sunday departures are all at or
after 07:15. This is a business-requirement question for Nathan rather than a tool question, but the
proposals should answer it deliberately instead of inheriting it.

---

## The fatigue factors, against what the tool checks today

P3 lists **24 factors** in five families. `runDesignChecks` currently tests two things that map to
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

The gap is the point: Nathan will assess against this list, and the tool currently covers two of it.

---

## Work packages

### 1. Operating-window setting — **do first**

Store the window **on each design**, with app defaults of Mon–Sat 06:20–23:55 and Sun 07:15–23:25.

Per-design rather than global because a proposal may legitimately test a moved boundary — the Sunday
finish is the live example — and compare mode then shows two designs with different spans side by
side, which is the argument you would put to Nathan. It also travels with the design when printed, so
the sheet states the window it was designed to. Designs saved before this carry no such field and
fall back to the defaults, so nothing already saved changes.

Two rows (Mon–Sat, Sun) matches the operation as described. Saturday can split from Mon–Fri later if
it ever diverges; the generator already has three columns, so the plumbing exists.

**It is first because packages 2–4 all consume it.** Note it needs a `firestore.rules` allowlist
change — the same shape as the `deletedAt`/`deletedBy` pair added at v19.41 — so a rules deploy rides
alongside hosting.

*Done when:* the window is editable, persisted per design, shown on the Coverage card so the heat map
explains itself, printed on the sheet, and defaulted for existing designs.

### 2. Fatigue checks against p3 — **the headline**

Extend `runDesignChecks` to cover every factor in the table above that applies, each labelled with its
FF number, so a printed proposal is already annotated against the document it will be assessed with.

The maths belongs in `links-design.js` (pure, tested) — the module already holds the turnaround and
consecutive-run logic, and this is the same kind of reasoning over the same sequence.

Two design notes: the n/a factors should be *asserted* rather than silently omitted, so a design that
somehow acquires a night duty fails loudly; and the checks report factors **present**, not pass/fail
— the ORR framing is explicitly that these are not prescriptive limits, and a tool that renders them
as red/green would misrepresent the guidance.

*Done when:* every applicable factor is reported with its FF number, the inapplicable ones are
asserted, and each rule has a unit test.

### 3. Demand overlay on the coverage heat map

The heat map shows people on duty per hour against nothing. "Does this meet business requirements" is
precisely cover versus service, so overlay the movement profile.

**It must distinguish service the link deliberately does not staff from a genuine hole in the staffed
span** — otherwise hours 00 and 05 render as permanent uncovered demand on every design, the existing
"red 0 = a gap inside the working day" rule cries wolf, and the check gets ignored. Package 1 is what
makes that distinction expressible.

### 4. Timetable-driven generator targets

`buildRosterTargets()` seeds from the *current* roster, which is the wrong baseline for a timetable
change. Allow the targets to be driven by the new service instead — either a pasted per-hour demand
profile or a simplifier import.

### 5. Midnight-crossing guard — **correctness only, not priority**

`calcHourlyCoverage` clamps a duty's end to 24:00 when end ≤ start, and the turnaround check computes
`rest = (1440 − end) + start`. A duty ending 00:30 therefore reports ~23h of rest where the truth is
~11h, and its post-midnight hours vanish from the heat map. **Nothing in this work reaches it** —
duties end 23:55, so `end > start` always holds — but it is a real latent defect and cheap to guard
with a test. The 21:00–03:59 start ban in `normaliseCustomShift` is correct and should stay.

## Not building

**An automatic optimiser.** The generator produces a compliant skeleton; which duties fit the service
is a judgement for the two designers. The tool's job is to check and to show, not to decide.

## Open questions

1. **Does the Sunday finish move?** Five movements fall after 23:25, including a 23:45 departure. For
   Nathan.
2. **Does FF18 (rotating pattern of about a week) apply to a 28-line link?** Each person changes line
   weekly. Worth settling with Nathan before the checks assert anything about it.
3. **Should Saturday's window ever differ from Mon–Fri?** Currently identical; the setting can split
   them if the answer changes.
