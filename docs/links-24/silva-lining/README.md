# Silva Lining — a 24-line design series (1 Oct 2026)

**The record behind one proposal sheet.** Eight designs were explored in one session on 1 Oct 2026. The owner chose
**H** on the standing weighted league, and it became the proposal sheet **Silva Lining** (`../Silva-Lining-SL-24-H-7fc9745f.pdf`,
grid `../Silva-Lining-SL-24-H.json`). **The other seven were deleted** (owner), and so was this folder's copy of H, so
that its grid has one home. Every grid is in git history: the eight were last together at commit `4c8aedd` (PR #1567),
as `docs/links-24/silva-lining/silva-lining-<letter>.json`. This page keeps their figures, so the choice can be
followed without them.

The name is the owner's. Each letter is one step; a later letter is not always better, it
answers a different question.

## Where it started

**Polished Clean** (`../Polished-Clean-PC-24-EXT.json`), with three changes the owner asked for:
- two of its three weekday closers start at **15:45** (one 16:25 kept);
- the two short weekday earlies are merged into one time, **06:20–13:45**;
- **14 on duty every day Monday to Saturday** (15 on Tuesday), with **217–219 contracted days a year** to match
  Familiar Nine and today's link.

Every design here is exactly the contract: 85 Mon–Sat duties and 42,000 minutes, so **219 days a year**. The daily
staffing is 14 · 15 · 14 · 14 · 14 · 14 · 10, Monday to Sunday.

## The eight designs

Figures come from the sheets' own functions (`search/report.mjs`). Fatigue is the number of avoidable warnings in the
fixed duties, then the worst case once the cover weeks are placed. Fit is the match to the trains (weekday · Saturday ·
Sunday), where lower is better.

| | What changed | Fatigue | Full weekends off | Single rest days | Shift times | Fit |
|---|---|---|---|---|---|---|
| **A** | Polished Clean with the three changes above | 2 / 5 | 2 | 16 | 17 | 34.1 · 18.9 · 53.9 |
| **B** | A, lines reordered only | 0 / 1 | 5 | 13 | 17 | same as A |
| **C** | B, reordered further: fatigue 0 in every placement, and the 55-hour worst week down to 52.1 | 0 / 0 | 5 | 15 | 17 | same as A |
| **D** | C, reordered for more weeks on one shift time Monday to Friday (7 of 20) | 0 / 0 | 6 | 14 | 17 | same as A |
| **E** | One weekday set used every weekday (10 weeks on one time). **Rejected:** it needs a 14:45 weekday closer, too long a shift for a weekday | 0 / 0 | 6 | 11 | 18 | 24.8 · 18.9 · 53.9 |
| **F** | D with every weekday shift capped at 8h40 | 0 / 0 | 6 | 11 | 18 | 33.8 · 18.6 · 53.9 |
| **G** | E with every weekday shift capped at 8h40: the fourth weekday closer becomes 15:15, a third closer time | 0 / 0 | 6 | 11 | 17 | 24.2 · 19.8 · 53.9 |
| **H** | **Chosen — now the Silva Lining sheet.** A 9-hour cap, no 14:45 closer, and as few shift times as possible (13) | 0 / 0 | 6 | 11 | 13 | 29.8 · 16.4 · 53.2 |

**H in more detail.** Its longest shift is 9h00, its shortest rest 13h30, its worst week 52.1 hours, and it has 10
weeks on one turn Monday to Friday. Single rest days are 11, so 17 of 28 rest breaks are two days or more.

H uses these 13 times:

- **Weekday:** 06:20–13:45 ×2, 06:20–14:20, 06:20–14:50 ×2, 07:00–15:30, 12:00–21:00, 13:30–22:00, 14:00–22:30 ×3,
  15:45–23:55 ×2 and 16:25–23:55. Tuesday adds a third 06:20–14:50.
- **Saturday:** 06:20–14:20, 06:20–14:30 ×4, 06:20–14:50, 08:30–16:30, 13:30–22:00 ×2, 14:00–22:30 ×2 and
  15:45–23:55 ×3.
- **Sunday:** 07:15–15:45 ×4, 08:30–16:30, 14:00–22:30 and 14:30–23:25 ×4. The old 14:20–23:25 became 14:30.

The 12–13 one-turn versions of H were searched as well. Every one of them kept a "rest after early starts" fatigue
warning.

**For comparison, Familiar Nine:** 14 of 20 weeks on one turn, 2 single rest days, 16 times, fit 24.6 · 12.9 · 25.9,
and every rule met.

## How H was chosen

The standing weighted league, the one used to rank the proposal sheets (rules met 35, fatigue warnings 20, match to the
trains on the floor 20, full weekends off 10, familiar shift times 10, longest run 5; each column scored between the
best and worst in the set). Among the eight:

| | H | F | D | C | B | G | E | A |
|---|---|---|---|---|---|---|---|---|
| Score | **97.6** | 90.0 | 88.1 | 85.6 | 82.3 | 79.0 | 74.8 | 53.1 |

Today's link, on the same scale, would score 15.0. Among every proposal sheet as well, H scores 79.3 and comes fourth,
behind Familiar Nine (94.2), Right Away (89.7) and Full Overhaul (85.3). E and G also break the owner's shift rules
for this series (a 9-hour cap, and only the 15:45 and 16:25 weekday closers): E has a 14:45 closer of 9h10, G a 15:15
closer.

## Two things to know before reusing these

1. **Polished Clean's ticket office does not carry over.** Its office duties are its author's own, named by the sheet
   tooling against Polished Clean's fingerprint (`NAMED_OFFICE` in `../tooling/report-data.mjs`). A variant has a new
   fingerprint, so its office is measured the default way. Every design here meets 8 of the 9 December rules, and the
   one it fails is that office rule. The author's office would have to be written back in, and the Silva Lining sheet
   says so.
2. **There was an invalid H before this one.** An early version of the annealer could swap a whole cover line into a
   working slot, and then split a cover week across days. That produced an "H" with 193 contracted days and two split
   cover weeks. It was caught and thrown away, and `search/ff7.mjs` carries the fix: it never touches a cover (`SPARE`)
   cell. The H that became the sheet is the corrected one. All eight were checked again on 1 Oct 2026: 4 cover lines,
   none split, 219 days.

## The search scripts (`search/`)

These are kept as they were run, with paths made relative so they work from here. Run them from this folder. The
designs they read are no longer in it: give them a grid by path, or restore one from git (commit `4c8aedd`).
`ts9b.mjs` reads F by name, so it needs F restored first.

| Script | What it does |
|---|---|
| `report.mjs` | Prints one design's figures, using the same functions the sheets use. |
| `s14.mjs` | Searches for 14 on duty a day from Polished Clean's duties. |
| `ff7.mjs` | Reorders only, by swapping duties on the same day or swapping whole lines, to drive fatigue warnings to zero. Usage: `node search/ff7.mjs IN.json OUT.json SEED ITERS`. |
| `cap.mjs` | Caps weekday shifts at 8h40 and finds the lost minutes again. |
| `ts9b.mjs` | Uses a 9-hour cap and no 14:45 closer, keeping the fewest shift times (this is how H was made). |

All of them assume **24 lines**. See `../../links-26/README.md` for what that means for reuse.
