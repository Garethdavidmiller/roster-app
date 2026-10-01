# Link proposals — December 2026

> **Where things stand (1 Oct 2026) — read this first.** Everything below this box is a dated record, oldest decisions
> first; where an older section disagrees with this box, this box is current.
> - **10 proposals**, each an eight-page sheet compared **only with today's link**; the one-page summary is the only place
>   they sit side by side. A work-in-progress pack, not a decision pack.
> - **Three tiers of rule:** 3 hard limits (a rota that breaks one cannot be run), the 9 December staffing rules (scored
>   on every sheet), and 3 flexible rules (14 on a Saturday, evenly spread cover weeks, 15:45 weekday closers) that never
>   appear on a sheet and may appear in a presentation.
> - **One basis for runs and fatigue warnings:** the fixed duties first, the cover weeks left out for the proposal and
>   today's link alike; the worst place a cover week's four duties could fall is given beside it as "up to", and that
>   worst case includes the 55-hour week four 8-hour cover duties can make. Hard limits are tested at the worst case.
> - **The match to the trains is a score**, lower is closer, and is put in words as a score ("a score about half of
>   today's") — never as "half as far off", which read as half as many people out of place.
> - **Today's link:** 4 of the 9 rules; 4 avoidable fatigue warnings in the fixed duties (up to 5); 7 days in a row (up to 9).
> - **Rules met, of 9:** All Clear, Clean Sweep, Familiar Nine, Full Overhaul, Right Away 9 · Fifteen Turns 6, and it
>   breaks the 12-hour hard limit · Weekday Lates 5 · Anchored Lines, Evening Peak 4 · Polished Clean 4, with the ticket
>   office pairs rule waived for it (owner, 30 Sep 2026) and its office measured on its author's own duties.
> - **Presentations:** Familiar Nine and Right Away, for colleagues and for managers. Their figures are typed into the
>   slides by hand (the build scripts are not in this repository), so `node tooling/deck-check.mjs` compares every
>   figure in their two summary tables with the same counts the sheets print — run it after any change to a rota or to a
>   deck, before the decks go anywhere.
> - **Still open:** the staffing levels, the 24-person link and the Sunday cover were confirmed **verbally** (29 Sep
>   2026); the written source of the 13-day limit; FF19's reading of a rest day. Any change to the first regenerates
>   every sheet (`node tooling/regenerate.mjs`).

The CEA link proposals drawn for the December 2026 timetable change, each a PDF with its own
**identity** so it can be named in a room: a name, a code that says how it was built, and a
fingerprint of the exact cells so a printout can never be confused with a variant. The same
identity is in every page footer. All 10 were judged by the app's own Links modules
(`runDesignChecks`, `assessFatigue`, `assessHardLimits`, `scoreOrder`, `weeklyHours`) — the
searched families built by them too — and every figure in a PDF is computed from the cells it shows —
nothing is typed.

**The sheets are the plain edition, second version (30 Sep 2026)** — eight pages each, **written for a manager first**
(owner, 30 Sep 2026: *"the proposal sheet is predominantly for managers"*; earlier, that a busy manager must not be
overloaded — *"it needs to be easy to understand"*). They speak *about* staff, never *to* them, and name no audience on any page. **Page 1** is the
whole proposal:
- an *In short* sentence built from the page's own lists (the verdict, the two biggest gains and trade-offs for staff);
- **"For discussion, not a decision"** in the body text, with what is still to settle (which link, who starts where);
- a **What it takes** line: the people (24, 4 more than today), the cover weeks, and the Sunday overtime — people on duty,
  and hours across the whole link each week — against today and against the 10 the rules ask for;
- four *Can it work?* tiles (the nine December rules, the hard limits, avoidable fatigue warnings (since 1 Oct 2026 on the fixed
  duties, with the worst cover-week placement as "up to"), and the match to the trains with each day's figure against today's);
- a red box naming every rule or limit broken;
- under *What it would mean for staff*, **every** concern, and the **five** strongest positives with "More detail on
  page 2" (external review: ten positives against four concerns read as a sales pitch, and a count of the rest read as
  keeping score). The shortest rest and the
  fatigue count keep their places among the five when they apply; every positive left off is a page-2 row. A concern
  is never left off.

**Three readability fixes (30 Sep 2026, owner).** (1) The match to the trains is always given in words beside the
number — "about half as far off as today", reworded on 1 Oct 2026 as a score, "a score about half of today's" — on page 1's tile, page 2's row and page 5's answer (`offWords` in
`tooling/plain.mjs`: a ratio of the two figures, nearest simple fraction). (2) Every length of time is written one way,
"13h 35m": page 2 wrote "13h35", which also reads as a clock time, while page 6 wrote "13h 35m" for the same figure.
(3) Page 7 leads each fatigue row with its plain name ("Too little rest after a run of early starts"); the ORR code,
wording and category follow in small print.

**A second pass, same day (owner, after asking whether the new version was weaker than the first).** It was not weaker in
content, but a comparison showed page 1 set about 6% smaller, the "for discussion, not a decision" line demoted to the
masthead's small print, and the shortest rest and fatigue count reduced to a tile's small print. All three were my
choices, not the reviews'. So the four staff tiles left page 1 — every figure on them is a page-2 row, and each is now a
bullet — which gave the space back: the type is at the first edition's size again (median 12.8pt), the caveat is in the
body, and the two points are bullets.

**Page 2** sets every figure against today's link in five named groups (staffing, working pattern, shifts, each person's
year, fatigue and the rules). **Pages 3–7** are the workings, each opening with its answer: the rota; shift times (new,
kept and dropped) and **the shape of a week** (rest breaks of two days or more, single rest days and those beside a cover
week, weeks by days worked, working weeks with a Sunday); staffing through the day; the rules; and the fatigue checks,
with their source (the ORR's *Fatigue Factors*, December 2021, 21 patterns, plus 4 MRSF checks). **Page 8**, *Can I trust
these numbers?*, says which figures are exact, which are a guide, what no rota can say, and how each one is worked out.
**One colour meaning on every page:** green ✓ meets a rule or is better on something the rules, the limits or the fatigue
guidance aim for; amber ▲ is worse on one of those; red ✕ is a rule or limit broken; no colour is a difference for
colleagues to weigh. On the fatigue page ⚠ marks a pattern present. The symbol is always printed beside the colour,
because the sheets are printed in black and white. "Tiring patterns" is now "fatigue warnings" everywhere, the Familiar
Nine decks included.

**Nothing the first plain edition said was dropped.** The second version was first published with four regressions,
caught by a sentence-by-sentence comparison with the first before it was accepted: the positives and concerns were capped
at three or four on a page that calls itself the whole proposal (up to four concerns hidden, fatigue findings among them);
the *What does it take?* tile (people, cover weeks, Sunday overtime) was gone; page 4's *shape of a week* table was cut to
the rows page 2 carries; and page 7 had lost its source citation, page 8 several of its definitions (the handover, the Sunday leave rule, how the match and the start-time rows are worked out, and what the shortest gap cannot show). All are back, and the same
comparison now finds only rewordings. **Today's link is the only comparison**: no sheet, and not the rules sheet, names,
counts or ranks another proposal — the one-page summary is where they sit side by side, for the owner. Rendered by
`tooling/plain.mjs`; `TECH=1 node regenerate.mjs` renders the technical sheet instead, with its comparisons removed by
`tooling/solo.mjs`. Every claim on pages 1–2 is judged shift by shift, never on an average. The first plain edition
(29 Sep 2026) passed five independent checks; this one was re-checked by an independent recount of every page-2 row,
every page-1 tile and verdict, the *What it takes* line and the *shape of a week* table against the rotas (0 mismatches
across the 9 sheets), and a footer-overlap check on every page.

**Three tiers of rule (30 Sep 2026, owner).** *"Those three rules should stay in the background as flexible rules. So
we now have hard rules, soft rules which are explicitly mentioned and these flexible rules which can be in the
presentation but not in the proposals."*

| Tier | Which | Designed to | Proposal sheets | Presentations | Rules sheet |
|---|---|---|---|---|---|
| **Hard limits** | 12 hours' rest · 13 days in a row · the exact contract | yes | stated, met or the rota cannot run | yes | yes |
| **Soft rules** | the nine December 2026 staffing rules (`sheetRules`) | yes | stated and scored, "N of 9" | yes | yes |
| **Flexible rules** | 14 on a Saturday · four evenly spread cover weeks · weekday closers from 15:45 (`flexibleRules`) | yes — every search, solver and judge reads `currentRules`, which holds all eleven rows (the nine soft rules and three flexible ones, with Saturday and Sunday sharing a row) | **never mentioned** | may be mentioned | named as their own tier (page 2) |

Saturday's fourteen shared `currentRules`' row with Sunday's ten, which is a **soft** rule: on the sheets it stands on
its own as "Ten on a Sunday". The facts behind the flexible rules are on every sheet as facts — the Saturday headcount,
the cover-week lines and their spacing, every closing shift's start — just never as rules. The per-design waivers
(`WAIVERS` in `tooling/fresh.mjs`) hold one entry: *Polished Clean* is not held to the ticket office pairs rule (owner,
30 Sep 2026), which its sheet and the summary report as waived, never as a failure. Soft rules met, of nine: *All Clear*, *Clean
Sweep*, *Familiar Nine*, *Full Overhaul* and *Right Away* 9; *Fifteen Turns* 6 (and it still breaks two hard limits);
*Weekday Lates* 5; *Evening Peak* and *Anchored Lines* 4; *Polished Clean* 4, and the ticket office pairs waived; today's link 4. Flexible rules met, of three (not shown on any sheet): *All Clear*, *Familiar Nine* and *Right Away* 3; *Clean Sweep* 2 (not the 15:45 closer); *Fifteen Turns* 1 (the cover-week spacing) and *Full Overhaul* 1 (Saturday's fourteen); *Weekday Lates*, *Evening Peak*, *Anchored Lines* and *Polished Clean* 0 — "designed to" is what the tooling checks by default, not a claim that every proposal was built to all three. The Familiar Nine decks say 9 of 9, and — being
a presentation — that it meets all three flexible rules too.

**The By the Book family was withdrawn (29 Sep 2026, owner).** *By the Book* (`BB-24-D7 · 0f14abce`), *Eight Forty*
(`EF-24-E21 · 0cf19f56`) and *Office Written In* (`B2-24-G21 · 02f3c005`) — the rules-first family, meeting 4 to 5 of
the eleven December rules — are no longer in the folder, the pack or the summary: 28 sheets became 25. Their search
candidates stay in `tooling/results/` and `final.mjs` keeps their code, so any of them can be rebuilt (the note above
`SEARCHED` in `tooling/regenerate.mjs` says how), and git history holds the sheets as shipped. The dated sections below
still describe them, as history. No other sheet changed. The plain edition never names another proposal in its text; the one strap line that did (Full Overhaul's, which named Weekday Lates) was rewritten in the 30 Sep 2026 accuracy check.

**Three more withdrawn (29 Sep 2026, owner: "we have better options").** *Weeks 17-18 Swapped* (`WS-24-EXT · 0bebb675`),
*Targeted Fatigue Redo* (`TF-24-EXT · 8eef9a13`) and *Three Mondays* (`TM-24-EXT · fe90c0b8`) — three hand edits on one line
of the Weekday Lates family, meeting 3 of the 11 rules each — are gone from the folder, the pack and the summary, with their
source grids: 25 sheets became 22. *Cover at Seventeen* and *Saturday Four*, built further down the same line, stay; neither
sheet changed, because the plain edition never names the design it came from. Git history holds all three.

**And two more (29 Sep 2026, owner).** *Frozen Block* (`WL3-24-F7 · a6234195`) and *Tenth Sunday* (`TN-24-R7 · 84b60df9`) —
both supplied tables with small hand edits and a computer re-ordering of the weeks, meeting 4 and 3 of the rules — are gone
with their source grids: 22 sheets became 20. *Anchored Lines*, whose technical edition listed Frozen Block as a comparison,
is unchanged. Git history holds both. Then *Short Closer* (`CF-24-EXT · 6d21169b`, a supplied Word table, 3 of the rules):
19 sheets; and *Light Retime* (`CFT-24-M3 · ae1a15bd`, Short Closer with three cells retimed, 4 of the rules): 18 sheets.
Then the **Same Turns family** (owner, 29 Sep 2026): *Same Turns* (`ST-24-B7 · d15e1b74`), *Quarter To*
(`QT-24-Q34 · 70cf9874`) and *Weekend Capped* (`Q2-24-W21 · 7ea671d5`) — today's link widened to 24 in today's own times,
then with the 15:45 closer and the 8h40 cap, meeting 8 to 9 of the rules — are gone from the folder, the pack and the
summary: **15 sheets**. As with By the Book, their search candidates stay in `tooling/results/` and `final.mjs` keeps
their code (the note above `SEARCHED` says how to rebuild one); git history holds the sheets. *Pinned Turns* and *Round
Times*, which also start from today's roster but were built fresh to the owner's brief of 25 Sep, stay and did not change.
Then three supplied tables (owner, 29 Sep 2026): *Polished Clean* (`PC-24-EXT · 12424ed2`, 2 of the rules), *Cover at
Seventeen* (`C17-24-EXT · edc1b731`, 4) and *Saturday Four* (`S4-24-EXT · 481ba9ed`, 4): **12 sheets**. Polished Clean's
grid stays as `tooling/polished-clean.json`, because *Clean Sweep* is counted from it and its solver (`exact/pc.py`) reads
it; Clean Sweep's sheet did not change. The other two grids are gone; git history holds all three sheets.
Then *Just Enough* (`JE-24-M29 · 49717d70`, 11 rules, three fatigue findings) and *Gates Mended* (`FT-24-R21 · b76bf9e1`,
6 rules) (owner, 29 Sep 2026): **10 sheets**. Both grids stay in `tooling/` — Just Enough is the exact solver's 29-change
answer that *All Clear* is the zero-finding end of, and Gates Mended's shift times are part of the solver's allowed pool
(`exact/common.py` now reads `tooling/fifteen-turns-repaired.json`), so All Clear stays reproducible. No sheet changed.
Then the **Running Repair family** was added the same evening — *Running Repair* and *Full Overhaul*: **12 sheets**.
Then the **Pinned Turns family** (owner, 30 Sep 2026): *Pinned Turns* (`PT-24-P34 · dae6292e`) and *Round Times*
(`P2-24-N13 · 33a78cbe`), both built to the owner's brief of 25 Sep and meeting 9 of the 11 rules: **10 sheets**. As with the
other searched families, their candidates stay in `tooling/results/` and `final.mjs` keeps their code; both grids are also
kept unchanged in `test-fixtures/links-designs/`, because the Links compare tests assert figures that are theirs.
Then *Running Repair* (`RR-24-M34 · 621165eb`, the family's 34-change member with four tiring patterns; owner, 30 Sep 2026):
**9 sheets**. *Full Overhaul*, the same duty mix with no tiring pattern, stays and did not change; the family section below
still describes both, and its commands rebuild Running Repair exactly.
Then *Polished Clean* (`PC-24-EXT · 12424ed2`) was **restored** (owner, 30 Sep 2026), from the grid kept in
`tooling/polished-clean.json`, and rendered in the plain edition v2 like every other sheet: **10 sheets**. The owner set
the ticket office pairs rule aside for it alone (`WAIVERS` in `tooling/fresh.mjs`); it meets 4 of the other eight soft
rules (3 until its author named its office, below). Its page 5 sets the *Good to know* notes a touch tighter (`p5notes--dense` in `tooling/plain.mjs`), because it
carries both long notes — the partly-rostered office and Sunday's last trains — and the list otherwise ran into the footer.
No other sheet changed. Its screenshot check the same day found one defect shared by **every** sheet: on page 4, *The shape
of a week*'s "working weeks by days worked" figure did not wrap and ran into the next column. It now wraps between counts
(never inside one), the columns are rebalanced and the table sits a little tighter, so every sheet's page 4 clears its
footer. No figure changed on any sheet. Polished Clean's page-1 waiver line also says which days its office pairs are
rostered (Thu and Fri), rather than repeating page 6's day-group value.

**Polished Clean's own ticket office (1 Oct 2026, owner, from its author).** The design's author confirmed which duties
run the office: Monday to Friday earlies at 06:20 and 07:00 (her "7:30" is the 07:00–15:30 — her Word table, checked cell
for cell against `PC-24-EXT · 12424ed2`, has no 07:30 start) with a 13:30 and a 14:00 taking over; Saturday two
06:20–14:30s, then 13:30 and 14:00; Sunday 07:15 and 08:30, then one late from 14:20, as today. `NAMED_OFFICE` in
`tooling/report-data.mjs` holds it, keyed by the fingerprint so it can never reach another grid, and the floor, the match
figures, the two-on-the-floor rule and the office handover are now measured on those duties instead of the plan's posts
assumed. It moved Polished Clean's figures and nothing else's: two on the floor at every moment is now met (fewest
2 · 2 · 2, was 3 · 0 · 2 — Saturday's 0 came from the assumed posts), so it meets **4 of the 9** soft rules plus the waived
one; the floor follows the trains 35.9 · 52.9 · 69.6 (was 38.7 · 51.4 · 74.1); the office handover is 60 minutes at its
shortest (Saturday). Its sheet says so on pages 1, 2, 5, 6 and 8 (the `namedOffice…` keys in `polished-clean.meta.json`).

**One basis for runs and fatigue warnings (1 Oct 2026, owner: "you were highlighting worst case on cover-week placement for
days in a row — now you are just doing worst possible with cover week. Isn't that misleading?").** It was: page 1's tile
said "N avoidable warnings **in the fixed duties**" while N was the worst place a cover week's four duties could fall,
and the decks set the proposals' fixed-rota figures against today's worst case. Every sheet now LEADS with the duties the
rota fixes — the cover weeks left out, for the proposal and today's link alike (`fixedView` in `tooling/report-data.mjs`)
— and states the worst placement beside it as "up to": page 1 (the hard-limit and fatigue tiles, the staff bullets),
page 2 (the two rows, now "…, fixed duties"), page 3's summary line, page 6's run card, page 7 (the head card and every row
of the table, worst case on the line beneath) and the summary's two columns. Hard limits are still TESTED at the worst
case: a limit must hold wherever the clerk puts the four. On the fixed duties today's link has **4** avoidable warnings
(up to 5) and **7** days in a row (up to 9); the proposals, fixed (worst): All Clear 0 (0) and 6 (9) · Familiar Nine 0 (0)
and 6 (6) · Full Overhaul 0 (0) and 7 (8) · Right Away 0 (0) and 6 (6) · Clean Sweep 2 (3) and 6 (9) · Fifteen Turns 6 (7)
and 7 (9) · Weekday Lates 4 (5) and 7 (9) · Anchored Lines 1 (1) and 7 (7) · Evening Peak 1 (1) and 6 (6) · Polished Clean
2 (4) and 6 (9). The four presentations were corrected to match — today's link 4 (up to 5) warnings and 7 (up to 9) days
in a row, where they had said 5 and 9 against the proposals' fixed-rota 0 and 6 — by editing the PowerPoint files
directly (the pptxgenjs build scripts live outside this repository) and re-exporting the PDFs. The index table below keeps
its worst-case figures, as labelled.

**Shorthand tightened after an external review (1 Oct 2026).** The review found nothing numerically misleading but some
true figures framed more strongly than the calculation behind them. Already right before it (the reviewer had an earlier
copy): "contracted days", "Sunday work stays overtime", Familiar Nine's "8 of 16 shift times you already work", "in the
fixed rota" on every fatigue figure, and the yearly-figures note on the pay and late-finish slides. Changed: "no extra
hours" → "no extra **contracted** hours" (colleague slide 2); every "never fewer than three on the floor" / "fewest ever
on the floor" → "**rostered** on the floor" (it is the rota, not sickness or disruption); the late-finish trade-off
says "on the fixed rota"; Familiar Nine's strap says "more than half its duties at times people already work" (54 of 94
duties, 57%), not "most". Not done: a page-6 line naming the three flexible rules — the owner's decision of 30 Sep 2026 is
that they never appear on a proposal sheet (the manager decks name them).
**An accuracy audit of every sheet and deck (1 Oct 2026, owner: "deep think, look for misleading information").** Every
figure was recounted and was right; what changed was wording, one missing worst case and some attribution.
- **The 55-hour week a worked cover week can make is now in the worst case.** The app's 55-hour row counts a cover week as
  no hours, so "up to N if a cover week falls badly" missed it. `h55Worst` in `tooling/report-data.mjs` works the four
  duties as 8-hour shifts in every placement; where that crosses 55 the "up to" count gains one (`worstPresent` in
  `folderStats`): All Clear 0 (up to 1), Full Overhaul 0 (1), Anchored Lines 1 (2), Clean Sweep 2 (4), Polished Clean 2
  (5). Page 1 lists it as a concern, not as a caveat on a positive; page 7's 55-hour row shows the figure.
- **Match figures are scores, not distances.** "About half as far off as today" read as half as many people out of place;
  the figure is a sum of squared differences, so the sheets and the Right Away decks now say "a score about half of
  today's".
- **Cadence from unrounded figures** — rounding each side first turned a 2.6 difference into 3.
- **Labels:** "the floor follows the trains" (it is the floor that is matched), "fixed duties" on the rest gap,
  "Sundays counted" on six-day weeks, "confirmed verbally, 29 Sep 2026", cover-week gaps without "evenly" (a flexible
  rule, which never appears on a sheet), page 8's cover-week and rest cards rewritten to the one fixed-duty basis, FF13
  marked where it is also the broken 12-hour hard limit (and no longer listed twice on page 1).
- **The floor rule says when** its minimum first occurs ("fewest 2 · 2 · 2 — first at Mon 13:45, Sat 14:30, Sun 07:15").
- **Summary:** a proposal that breaks a hard limit is marked ✕ and sorted last (Fifteen Turns); "1 waived", not "+1".
- **Rules sheet:** today's fatigue column on the fixed duties with "up to", like every sheet; FF2's early is "05:00 to
  06:59" — the ORR's list says "between 05:00 and 07:00", and Managing Rail Staff Fatigue, Appendix E, makes 07:00 a day
  shift, which is how the app counts it (settled: Familiar Nine and Right Away keep no FF2/FF15 finding from a 07:00 start).
- **Decks:** "more people on duty with you, all day" was false at some hours (Right Away has fewer than today at 13:00 on
  Tue/Thu/Fri and 14:00 on Sunday; Familiar Nine at 16:00 Tue/Thu/Fri) — now "more people rostered every day, at the open
  and the close". The late finishes were credited wholly to the December rules; three to the close accounts for about 6.5
  of the ~20 extra a year each once spread over 24 people (15 closers a week today → 21 required; the designs have 27), so
  the slides and notes now say "only partly from the December rules". "Contract paid exactly" → "rostered exactly, on
  average"; "more weekends" → "more full weekends off" (notes add the four more Saturdays a year); four weeks' leave "15
  days at best"; a cover week "at most 4 days of leave"; Sunday 23:25 is "agreed practice (settled 28 Sep 2026)", not
  "will remain so"; "confirmed" → "confirmed verbally (29 Sep 2026)"; today's link "four in the fixed rota (up to five)".
**A screenshot polish pass (1 Oct 2026, owner).** Every page of every sheet, the summary, the rules sheet and every
slide was rendered and looked at; no figure changed. Sheets (`tooling/plain.mjs`, `render.mjs`): page 1's four "Can it
work?" tiles had two accents (a gold side bar under the status bar) and now have one; every top-barred card is square on
its barred side, so the bar no longer bends into the corners; no paragraph ends on a lone word (`text-wrap: pretty`); a
"·" separator never starts a line; clock ranges are written 06:20–14:25 on every page (page 4 used a hyphen); page 2's
day keys ("weekday · Sat · Sun") sit on a line of their own under the question instead of wrapping a word off it; page
6's rules table and limit cards are set larger to use the third of the page they left empty, and its two blank "what
the rule asks" cells are filled; page 1 shares any spare room as a little extra space between its sections. Summary: an
"up to" note under a good figure is grey, not green. Rules sheet: the basics flow down two columns instead of floating
in uneven gaps. Decks: five taglines that left one word on a second line now fit on one, the leave-table label no
longer wraps, and the two half-empty slides ("Why the link has to change", "The honest trade-offs") use the slide.
The Links compare test that used Short Closer as its
real-design fixture now uses *Weekday Lates*, which has the same shape (tiring patterns present in both at different figures).

**Page 5 and the ticket office, redrawn (29 Sep 2026).** Page 5's three tables are one grid — each hour in the same place
down the page — drawn as a heatmap, with today's block on a grey bar and the proposal's on gold; its notes say in plain
words that one of each ticket-office pair helps on the floor at the quiet ends, and that Sunday evening is the one change
from today (one person in the office today, two in the December rules). Page 8 and a new page 2 row say the same. No
figure changed: 22 of 22 fingerprints hold and the independent recount finds no mismatch.

**The December Sunday office plan (29 Sep 2026, owner, with Familiar Nine as the example).** One Sunday early is on the
floor until 09:00, as before. The two lates are now on the floor from the start of their shift until 15:00, then both in the
office, handing over for at least 30 minutes before the earlies leave; one goes back to the floor from 18:00 to the end of
the shift, as a whole person. This replaces the reading that one late split the whole shift, counted as half a person.
**Today's link keeps today's Sunday** (one office late, a 14:30–23:25 closer). Only Sunday figures moved, no rota changed,
and every fingerprint holds. The Sunday floor fit moved on every proposal — Right Away 28.9 → 35.4, Just Enough 34.9 → 42.1,
Familiar Nine 31.3 → 42.8 (the managers' deck chart updated to match) — and twelve designs now meet "at least two on the
floor at every moment", the second late back on the floor from 18:00 covering the thin Sunday evening: Pinned Turns, Round
Times, Quarter To and Weekend Capped 8 → 9 rules; Same Turns 7 → 8; Fifteen Turns and Gates Mended 5 → 6; Weekday Lates
4 → 5; Anchored Lines, Cover at Seventeen, Evening Peak and Frozen Block 3 → 4. The handover rule now reads "20 in the
ticket office (30 on a Sunday)", the Sunday overlap counted from 15:00. Code: `officeHelpers` in `tooling/report-data.mjs`
(model `'today'` keeps today's Sunday), and the exact solver's floor rule in `tooling/exact/model.py`.

**Right Away and Familiar Nine, a better Sunday (29 Sep 2026, owner-approved).** Under the December Sunday office plan
the Sunday table was searched again, exhaustively (`SUN_PLAN=1 CLS=sun node final-table.mjs`, every legal table of 8–9h
quarter-hour duties and every office pair, at every cap on shift times and with today's times in the pool): one table is
best whatever the constraints — `07:15-15:30 x4 · 09:00-18:00 x1 · 14:30-22:30 x2 · 15:15-23:25 x3`, the office lates now
joining the floor only half an hour before 15:00. Both designs take it in **three Sunday cells** and nothing else:
*Right Away* `FR-24-F34s · 745e98b0` (09:15–18:15 → 09:00–18:00, the lates 13:30 → 14:30) and *Familiar Nine*
`F9-24-K31s · 598a1294` (08:30–16:30 → 09:00–18:00, the lates 14:00 → 14:30). Sunday floor fit 35.4 → **26.4** and
42.8 → **26.4**; every rule, limit and fatigue check unchanged (all 9 soft rules and all 3 flexible ones, 0 findings, run 6, 6 weekends). Familiar Nine's
one cost is familiarity — 8 of its 16 times are worked today, was 9 of 15 — and both presentations are updated to match.
Right Away now ships as a grid (`tooling/right-away.json`); `final.mjs` still rebuilds the searched `FR-24-F34o` it came from.

**How to read this file.** The paragraphs above describe the pack as it is now. Every dated section below is the
project's history, kept as the record: where one describes a ten-page sheet, 23 designs or a page 9 comparison, it
is describing an earlier edition.

**Everything in one download:** `December-2026-Link-Proposals.zip` (30 Sep 2026) — the one-page summary, the
rules, both presentations, all 10 sheets and their import files, with a *Read me first* note. It is a SNAPSHOT: a
re-render of the sheets does not update it, so rebuild it after one.

**The one-page summary:** `Proposals-Summary.pdf` (*Proposals at a glance.pdf* in the zip) — every proposal against today's link on one A4 page, rendered by
`tooling/summary-sheet.mjs` from `folderStats` and the same JSON rotations (the script's header comment states each column's formula).

**The presentations:** `presentations/` — for *Familiar Nine* and *Right Away* (added 30 Sep 2026, built on the Familiar
Nine decks as a template), one for colleagues (15 slides; Right Away 16, its new shift times given a slide of their own) and one for managers (10) each, as PowerPoint and PDF
(29 Sep 2026; corrected 30 Sep 2026). Right Away's pair had its own independent recount of every slide and note. Built with pptxgenjs outside this repository, so their figures
were typed in from counts of the rotas in this folder and checked against an independent recount — unlike the sheets,
nothing recalculates them. They are copies, so a change to a sheet does not
reach them. Two of their inputs are not on any sheet, so they are recorded here:
- *The leave figures* (colleague decks: 14 days' leave buys at best 28 days off, 23.6 on average, 20 at worst; four
  full weeks off costs 15 days — the same for both, which share their pattern of rest days; today 30 · 23.4 · 19 · 14). Walk the rotation day by day from every possible first day
  of leave, and count the days off in a row before a 15th day of leave would be needed. A Monday-to-Saturday working
  day costs one day of leave; a rest day and a Sunday (overtime, not contracted) cost none; a cover week costs at most
  four, its first four Monday-to-Saturday days in the stretch. Best, average and worst are over every first day.
  "Four full weeks" is the least leave for 28 days in a row starting on a Sunday.
- *Saturday pay.* A rostered Saturday is paid at time and a quarter (1.25×), the Marylebone Roster pay calculator's
  own rule (`.claude/rules/paycalc.md`); it is a pay rule, not something the rota shows.

**The rules on their own:** `December-2026-Rules.pdf` — the hard limits, the nine soft December 2026 rules the sheets score, and the three flexible rules as their own tier, the
fatigue factors and the open questions, on two pages, from the same code the sheets are judged by.

**Reading this file.** Sections dated before 28 Sep 2026 describe the sheets and rules of their day — page
numbers, what each page held, the rule set and the fit measure. The sheets as they are now are the plain edition v2 described at the top of
this file, and every sheet is scored against the nine soft December 2026 rules (`sheetRules`); the three flexible
rules are designed to but never shown on a sheet. Figures in the older sections use the definitions of their day: fits moved to duty minutes on 24 Sep
and to the floor on 28 Sep.

| Proposal | Code · fingerprint | What it is | Fatigue findings (worst cover-week placement) | Longest run (worst) | Weekends off |
|---|---|---|---|---|---|
| **Right Away** | `FR-24-F34s · 745e98b0` (was `FR-24-F34o · be01f0db`) | **The owner's final rules of 28 Sep 2026**: the ticket office rostered as fixed pairs of identical turns and **not counted as floor cover**, every weekday closer 15:45, the headcounts as minimums, at least two on the floor at every moment, 15-minute handovers (20 in the office), Sunday duties 8h–9h, no more shift times than today — each day enumerated to a proof for the fit of the **floor** as it was measured when it was built; on the sheets' current measure (the office's second person helping at the quiet ends, and the exact edges of each hour) its floor fit is 26.5 weekday, 14.6 Saturday, 26.4 Sunday — 21.7 / 10.5 / 25.9 with everyone counted (the Sunday figures since the 30 Sep 2026 Sunday retime above), the folder's best weekday, 17 turns in the week against today's 18, the rotation fatigue-first and its week order then improved (28 Sep 2026: 14 of 20 weeks on one shift time, heaviest week 41h50) | **0** | 6 | 6 in 24 |
| **Familiar Nine** | `F9-24-K31s · 598a1294` (was `F9-24-K31 · c450951c`) | **Right Away's rules with two more aims (28 Sep 2026)**: no duty over nine hours, and the shift times people already work wherever they cost little fit — 8 of its 16 times are worked today (9 of 15 before the Sunday retime; Right Away 5 of 17), the longest duty 9h00 (9h30), the weekday table proven; Right Away's week structure carried over and polished until no figure was worse than Right Away's (14 of 20 weeks on one shift time, shortest rest 14h20), for a looser weekday and Saturday fit: 27.7 · 15.0 · 26.4 against 26.5 · 14.6 · 26.4 — the Sunday retime gave both the same Sunday | **0** | 6 | 6 in 24 |
| **All Clear** | `AC-24-M41 · 094fd369` | ***Fifteen Turns* with the fewest cells changed that meet every rule with no fatigue finding at all (28 Sep 2026)** — **41**, proven the minimum; the other end of *Just Enough*'s trade, twelve more changes for three fewer findings. Cover weeks untouched; its price is Sunday's fit | **0** | 9 | 2 in 24 |
| **Clean Sweep** | `CS-24-M34 · 92366924` | ***Polished Clean* with the fewest cells changed that meet the rules, its 16:25 weekday closers kept by the owner's allowance (28 Sep 2026)** — **34**, proven the minimum, 22 of them from spreading the cover weeks evenly (1, 7, 13, 19); among those, the fewest fatigue findings (three, proven — none new). All 9 soft rules; of the three flexible rules it meets two — its weekday closers start at 16:25, not 15:45 | 3 | 9 | 2 in 24 |
| **Full Overhaul** | `FO-24-M49 · bb9b6c24` | ***Running Repair*'s duty mix with no tiring pattern at all (29 Sep 2026)** — the same fit, 27.0 · 12.3 · 26.4, in the fewest changes that allow no finding, **49**, proven for the mix. All 9 soft rules; of the three flexible rules only 14 on a Saturday — its closers start at 16:25 and its cover weeks are not evenly spread | **0** | 8 | 3 in 24 |
| **Polished Clean** | `PC-24-EXT · 12424ed2` | **Supplied as a one-page Word table (28 Sep 2026), restored 30 Sep 2026** — weekday closers from 16:25, twelve on a Saturday, cover weeks at lines 1, 7, 12 and 17; 4 of the 9 soft rules, the ticket office pairs rule waived for it by the owner | 4 | 9 | 2 in 24 |
| **Weekday Lates** | `WL-24-EXT · a52ec588` | **Supplied as a Word table**, not searched — weekday lates at 16:25, Saturdays left alone | 5, or **4 as rostered** | 9 | 6 in 24 |
| **Fifteen Turns** | `FT-24-EXT · 9a028392` | **Supplied as a grid**, not searched — fifteen turns and cover weeks evenly spread, but **it does not clear two gates** | 7 | 9 | 2 in 24 |
| **Evening Peak** | `WL2-24-R21 · 33f70893` | Weekday Lates with eight of its nine `08:30–17:00` turns re-timed into the evening to cover the 17:00 peak, then re-searched | **1** | 6 | 6 in 24 |
| **Anchored Lines** | `WL4-24-F7 · f0d403d6` | The same evening fix again, with **weeks 14–17 kept in order on their own line numbers** — week 13 the one that moves | **1** (FF19 at 2, the fewest found) | 7 | 6 in 24 |

**Renamed 28 Sep 2026** (owner: *give them distinctive names*). Eleven sheets had become numbered
sequels or near-twins — three "Clean Final"s, three "Weekday Lates" after the first, a "2" on three
families, and "Final Rules" beside "Clean Final". Each now has a name that says what is different about
it and shares no word with another renamed sheet. **The codes and fingerprints did not change**, so a
printout made before the rename still matches its design. The sheets no longer mention a former name; the
table below is where the old names are kept. *Right Away* was named for being catchy rather than descriptive (owner, the
same day, after a few hours as *Floor First*): it is the dispatch call that sends a train on its way.

| Now | Was | Code |
|---|---|---|
| **Office Written In** | By the Book 2 | `B2-24-G21` |
| **Weekend Capped** | Quarter To 2 | `Q2-24-W21` |
| **Round Times** | Pinned Turns 2 | `P2-24-N13` |
| **Right Away** | Final Rules, then Floor First | `FR-24-F34o` (`FR-24-F34` until 28 Sep 2026) |
| **Evening Peak** | Weekday Lates 2 | `WL2-24-R21` |
| **Frozen Block** | Weekday Lates 3 | `WL3-24-F7` |
| **Anchored Lines** | Weekday Lates 4 | `WL4-24-F7` |
| **Gates Mended** | Fifteen Turns Repaired | `FT-24-R21` |
| **Short Closer** | Clean Final | `CF-24-EXT` |
| **Light Retime** | Clean Final Tuned | `CFT-24-M3` |
| **Tenth Sunday** | Clean Final Ten | `TN-24-R7` |

**The ticket office, on every sheet (28 Sep 2026).** The office is not floor cover, and the owner confirmed
it is staffed **today exactly as in the plan** Monday to Saturday — two `06:20-14:20` and two `14:00-22:30` on
a weekday, two `06:20-14:50` and two `14:30-22:00` on a Saturday. **Sunday is the one difference:** today it
has two earlies (two of the `07:15-15:45`s) and **one** late — one of the three `14:30-23:25` closers, in the
office until it shuts at 22:30 and on the floor for the last hour — where the plan has two identical earlies
and two identical lates, the lates finishing 22:30 when the office shuts (the rule fixes the pairs and the 22:30 finish, not
the times; Familiar Nine and Right Away use `07:15-15:30` and `14:30-22:30`, and `13:30-22:30` was an earlier pinned turn). Every sheet now makes that explicit wherever it compares with
today: page 6 splits both today and the proposal into *everyone*, *of whom ticket office* and *of whom on the
floor*; page 5's headcount table carries the office posts (4 · 4 · 3 today, 4 · 4 · 4 planned); the fit
figures on pages 1, 2 and 3 and the alternatives table on page 9 carry a floor fit beside the overall one.
(Superseded 28 Sep 2026: the managers' edition leads with the floor fit on pages 1 and 2, and page 9 is now
*Where it stands among the N*, N the number of sheets in the folder — see that section.)
Only *Right Away* named its office turns; for every other design the plan's posts are **assumed** to be
staffed from its duties, and its floor is everyone on duty less those posts — the sheet says so beside the
figures. One model in `tooling/report-data.mjs` (`OFFICE`, `officeSplit`) feeds every sheet.

*(Superseded 28 Sep 2026: this table counts the office as never on the floor. Every sheet now counts the second
office person while they help at the quiet ends, and uses each design's own rostered office pairs — the current
figures are in* The ticket office's second person on the floor, *below.)*

| Sheet | Code | Weekday, everyone | Floor: weekday · Saturday · Sunday |
|---|---|---|---|
| **Right Away** | `FR-24-F34o` | 21.9 | 20.4 · 11.6 · 19.2 |
| Pinned Turns | `PT-24-P34` | 32.1 | 30.9 · 31.7 · 58.1 |
| By the Book | `BB-24-D7` | 30.8 | 31.9 · 9.7 · 30.9 |
| Round Times | `P2-24-N13` | 33.8 | 33.1 · 30.8 · 58.1 |
| Fifteen Turns | `FT-24-EXT` | 30.7 | 33.3 · 47.3 · 39.3 |
| Gates Mended | `FT-24-R21` | 30.7 | 33.3 · 45.4 · 39.3 |
| Cover at Seventeen | `C17-24-EXT` | 34.4 | 37.2 · 19 · 67.9 |
| Light Retime | `CFT-24-M3` | 34.4 | 37.2 · 31.1 · 47 |
| Saturday Four | `S4-24-EXT` | 34.4 | 37.2 · 30.7 · 67.9 |
| Short Closer | `CF-24-EXT` | 34.4 | 37.2 · 46.3 · 67.9 |
| Targeted Fatigue Redo | `TF-24-EXT` | 34.4 | 37.2 · 19 · 67.9 |
| Tenth Sunday | `TN-24-R7` | 34.4 | 37.2 · 31.1 · 47 |
| Three Mondays | `TM-24-EXT` | 34.4 | 37.2 · 19 · 67.9 |
| Weeks 17-18 Swapped | `WS-24-EXT` | 34.4 | 37.2 · 19 · 67.9 |
| Anchored Lines | `WL4-24-F7` | 34.2 | 38.1 · 19 · 67.9 |
| Frozen Block | `WL3-24-F7` | 34.2 | 38.1 · 19 · 67.9 |
| Weekday Lates | `WL-24-EXT` | 38.3 | 41.4 · 19 · 67.9 |
| Evening Peak | `WL2-24-R21` | 35.3 | 41.9 · 19 · 67.9 |
| Quarter To | `QT-24-Q34` | 46.2 | 54.9 · 48.7 · 100.9 |
| Weekend Capped | `Q2-24-W21` | 46.2 | 54.9 · 30.9 · 65.7 |
| Same Turns | `ST-24-B7` | 46.3 | 57.5 · 48.7 · 100.9 |
| Office Written In | `B2-24-G21` | 67.9 | 96.6 · 12.7 · 69.1 |
| Eight Forty | `EF-24-E21` | 70.4 | 100 · 23.4 · 19.8 |
| *Today's 20-line link* | — | 51.1 | 68.8 · 68.7 · 72.5 |

The floor is where the designs separate: taking four office people out of a day that follows the trains
changes little, and out of a flat day it leaves a floor that follows them less well still. Today's floor
reads 68.8 on a weekday against 51.1 for everyone on duty.

The first four searched proposals — *Same Turns*, *By the Book*, *Quarter To*, *Eight Forty* (of nine searched design prefixes; *Office Written In*, *Weekend Capped*, *Pinned Turns*, *Round Times* and *Right Away* have their own sections below) — clear every hard rule — Chiltern's 13-day limit, twelve hours between duties, the exact
35-hour contracted week — and meet the December staffing shape (four to open, three through to
the close and four on a Saturday, five still on at 22:00, fourteen on a Saturday, ten on a Sunday,
four cover weeks at lines 1, 7, 13, 19). They differ on exactly one thing, and it is a people
question rather than a rules one: *Same Turns* keeps 15 turns people already work and does not meet
the late-shorter-than-early lever; *By the Book* meets every rule and none of its 19 turns is a
time anyone works today. Each PDF states this on its page 7. (Superseded 28 Sep 2026: that was the
rule set of its day. Against the eleven December 2026 rules of the managers' edition, *By the Book* and
*Eight Forty* meet 5, *Same Turns* 7 and *Quarter To* 8.) **The two 12 Sep proposals are comparison examples, not base rules** (owner, 13 Sep 2026): the 15:45
closer and the 8h40 cap are briefs to set beside *Same Turns* and *By the Book*, and neither changes the
December rules the workspace pins in `links-default-targets.js`. *Quarter To* (12 Sep 2026) is *Same Turns*
with two things asked for — the closer at 15:45, nothing over 8h40 — and it clears every fatigue factor
where *Same Turns* has one present; its open question was the cap's reach, since Saturday's 14:45–23:55
(9h10) and Sunday's 14:30–23:25 (8h55) are today's own turns carried over unchanged, and shortening
Saturday's closer leaves 7,004 minutes a weekday that no table of today's turns reaches. *Weekend Capped*
(24 Sep 2026) answers it — the weekend searched again rather than trimmed; see its own section below. *Eight Forty*
(12 Sep 2026) is *By the Book* under the cap, and the cap is not a trim there: 14 duties paying 7,000
minutes average 8h20, so a ceiling twenty minutes above the mean forces every long early to 8h30–8h40 and
every late to 7h45–8h25, and the owner's late-shorter-than-early lever shrinks to five minutes at the
boundary. Two of *By the Book*'s pins gave way to arithmetic and the PDF says so on page 7: a Saturday
cannot average its earlies more than 24 minutes longer than its lates (this table has 20; the rule asks
30), and four distinct opener finishes cost twelve off-quarter times against *By the Book*'s three. Its
weekday demand fit (75.3) is the worst of the four; its rotation matches *By the Book* and *Quarter To* on
every rule figure.

**Office Written In** (`B2-24-G21 · 02f3c005`) is *Eight Forty* with **the ticket office written in**: two
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
| demand fit (lower is better) | **67.9** (Eight Forty 70.4) | **8.1** (16.2) | **35.8** (20.9) |
| distinct turns · starts · finishes | 11 · 7 · 9 | 12 · 9 · 9 | 9 · 5 · 7 |
| minutes | 7,000 | 7,000 | 4,780 (Eight Forty 4,820) |
| longest duty | 8h40 | 8h40 | 8h40 |

Saturday is the clear win — a fit of 8.1, level with *By the Book*'s for the best in this folder (8.117 against 8.112 before rounding), and the two 14:00 starts
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
under 12 hours, 11 of 20 weeks on a single turn (09:00 split; 11:00 since 28 Sep: 13). The other three carry one factor (FF19 at 3, 4 and 5)
in exchange for a sixth weekend off, and the family's documented pick — rules first, weekends after —
takes the zero. That puts *Office Written In* level with *By the Book* and *Eight Forty* on the ORR panel,
with two matching late turns rostered every day of the week. (Superseded 28 Sep 2026: the December 2026
rules ask the ticket office for two identical earlies as well as two lates, and a Sunday late to 22:30 —
`13:30-22:00` ends before the office shuts — so against those rules the office is not met on any day.)

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
against Thu 7,780, though Mon–Sat still totals exactly 42,000. (Superseded 28 Sep 2026: the December 2026
rule is four cover weeks, evenly spread; four it has, and what it misses now is the spacing — lines 1, 7,
12 and 17.)

**Fifteen Turns is the first proposal here that is NOT runnable as drawn**, and it is listed anyway
because a refused design is evidence too. Two gates: one rest of **11h15** (line 7's Saturday
12:00–20:00 into line 8's Sunday 07:15–15:45) and **60 minutes over** the contracted week — Mon–Sat
totals 42,060 minutes against 20 × 35h = 42,000, and the contract is an equality rather than a floor.
Both are refusals in the workspace, not findings. What it does well: **fifteen distinct turns**, level
with *Same Turns* (*Quarter To* already had 13, and *Round Times* 14 and *Weekend Capped* 11 came later),
cover weeks **evenly spread at 6, 6, 6, 6**, as on every design searched from its own duty table, and a week-to-week step of
2h16 (*Eight Forty*, *Right Away*, *Pinned Turns* and *Office Written In* are gentler). It is worth
keeping as the shape to aim at once those two are repaired.

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
target of 7, not merely the 13-day limit), weekends off 2→6, one-turn weeks 12→16 (09:00 split; 11:00 since 28 Sep: 12→15), and fatigue
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

**Evening Peak** (`WL2-24-R21 · 33f70893`) answers a gap the owner found in Weekday Lates: nine
duties ran `08:30–17:00` and all nine finished at the same moment, so weekday cover fell from eight
to ten people at 16:00 to **six** from 17:00 on Monday and Tuesday (seven to nine the other days) — at the hour the December curve peaks (≈140 cars against
105 at 16:00). Cover was falling as demand rose. Line 9's week moved to `12:30–21:00` and line 16's
Mon–Wed to `14:00–22:30`; both replacements are 8h30, the same length as the turn they replace, so the
contracted week is still paid to the minute and both lines stay one-turn weeks. Then the shape was
re-searched. **The 17:00 hour goes 6, 6, 7, 9, 8 → 8, 8, 9, 10, 9** Monday to Friday (the same through
to 21:00) and **the 08:00 hour falls 7, 9, 8, 7, 8 → 5, 7, 6, 6, 7** (the same through to 11:00) — at a fixed 35-hour week an hour added to the evening comes from somewhere, and both
directions are on its pages. Monday morning at five is the thinnest point and the thing to weigh.

**Frozen Block** answers "protect weeks 13–17 and get the factors to zero". Zero was not
reached: the survivor is **FF19**, successive start times varying by more than two hours inside a
block of consecutive working days. Three is the fewest three seeds found, down from seven; two is the
fewest any run on this evening fix has found (*Anchored Lines*). Everything else cleared. *(Corrected
28 Sep 2026: this said zero was unreachable by arithmetic — that crossing from early weeks to late
weeks is by definition a jump, so two was the floor. FF19 counts only within a block of working days,
and a rest day breaks the chain: *By the Book*, *Quarter To*, *Eight Forty*, *Office Written In*,
*Pinned Turns*, *Round Times* and *Right Away* all mix early and late weeks and score zero on it.)*

**The five weeks are kept to the letter and MOVED**: 13, 14, 15, 16 and 17 are now lines 21, 3, 6,
24 and 1, every one unedited. That move is what made it possible. Week 13 works Tue–Sat and week 14
Sun–Mon, so pinned adjacent they form one 58.9-hour seven-day window that nothing else in the grid
can break and MRSF's 55-hour row can never clear; separated, it drops to 51.1. **If those weeks must
also stay at lines 13–17, the floor is two factors, not one** — that is a property of the block, not
a limit of the search, and `optimise.mjs`'s `FREEZE_POS` switch is what distinguishes the two
readings of "protect". **There is a third reading, and *Anchored Lines* is it** (22 Sep 2026):
hold the four weeks that *can* be held at their own line numbers and let week 13 — the one end of
the offending join — move on its own. That keeps one factor and the line numbers both.

**What protecting them cost is stated rather than glossed:** full weekends off are **4 in 24** here
against 6 in Weekday Lates, because the search had five fewer weeks to arrange around. And week 16
holds three of the nine `08:30–17:00` turns, so the evening fill came from line 9's week and line 6's
Friday alone — 17:00 reaches 7, 7, 8, 10, 10 where Evening Peak, free to move week 16, reached
8, 8, 9, 10, 9.

**Anchored Lines** (`WL4-24-F7 · f0d403d6`) answers what *Frozen Block* left open. The owner
asked whether weeks 13–17 could stay **in order, on their own line numbers**, rather than kept to the
letter and scattered. All five cannot, for the reason above: the 13→14 join is a 58.9-hour seven-day
window lying wholly inside those two weeks, so nothing outside them can break it. **Four of the five
can.** Weeks 14, 15, 16 and 17 sit at lines 14, 15, 16 and 17 — not a day, not a time, not a line
number altered — and week 13 is the only one that moves, to line 4, unedited. One factor present,
FF19 at two (the fewest found), worst seven-day window 54.7h, six full weekends off.

**The block's position was enumerated, not searched.** Cover weeks are pinned at lines 1, 7, 12 and
17, and week 17 *is* one of them — a cover week is blank — so "14, 15, 16, 17 in order" means the
three working weeks sitting immediately before some cover week. On a 24-line wheel that is four
placements and no more, so all four were run at three seeds each rather than left to the annealer to
stumble on. Twelve runs, every one clearing every hard limit and each with FF19 present (2 to 7); the placement that keeps the weeks on
their own numbers is the one printed. `tooling/wl4-run.mjs` is that driver.

**The price is the run, and it is structural: 7 consecutive days against 6** on every searched or
re-searched design here (nine of the supplied designs, whose line order was never searched, reach 9).
Week 14 works Fri–Sat and week 15 Sun–Thu, so holding those two in order is seven straight days
whatever the rest of the wheel does. It is not a breach — FF11 allows 13 consecutive, and the "more
than 7 consecutive 8h shifts" row needs more than seven — but it is the one figure this design
cannot match the others on, and its PDF says so on its own page rather than in a footnote.

**What the line numbers cost is one weekend.** Of the twelve runs, the block on lines 22, 23 and 24
reached **7 full weekends off** against this design's 6 — a weekend against the line numbers, which
is the room's call rather than the search's. Both are in the PDF's alternatives table and both grids
are committed (`tooling/weekday-lates-4-alt-blockmoved.json`, and `-alt-floor.json` for the third
placement that also reaches FF19 at two, at one fewer weekend).

**Coverage is identical to Frozen Block's** — every quarter-hour of the whole week, asserted
rather than argued, because both start from the same grid and `optimise.mjs`'s two moves leave each
day's duty multiset exactly as it was. 17:00 still reaches 7, 7, 8, 10, 10 Monday to Friday.
Ordering the weeks costs the run and a weekend; it costs nothing in cover.

**Weeks 17-18 Swapped** is supplied rather than searched, and its duty table matches **none** of the
others here — it is its own design, not a rearrangement of one. It clears every hard gate (35h to the
minute, no rest under 12 hours, no hard-limit breach, worst-case run 9 inside the 13-day limit), and
its re-timed midday turn already lifts the evening to 7, 7, 8, 10, 9 across Monday to Friday.

What it carries is advisory and unusually heavy: **five factors present, with FF11 at 16** — the
highest of any design assessed here, against 14 for Weekday Lates and 9–12 for the searched ones —
and **MRSF at 60.6 hours**. Only **6 of its 20 working lines are a single turn**, so most weeks ask
somebody to hold more than one start time, which is what drives FF19 to seven.

**None of that requires a duty to change.** Every one is a property of which week sits beside which,
and on the two designs already run through `optimise.mjs` the same work took the factors to one —
from seven on *Fifteen Turns*, from five on *Weekday Lates* (as *Evening Peak*) — and the run from nine to six with the coverage curve asserted identical. Its cover spread is also
one line out (7, 6, 5, 6); that search never moves a cover week, so evening it out is a separate edit
*(corrected 28 Sep 2026: this said the search fixes it for free)*. It is listed un-searched deliberately,
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
which week sits beside which; a line-order search by `optimise.mjs` of similar tables in this line
(*Evening Peak*, *Anchored Lines*) reaches one factor and a six-or-seven-day run with the coverage curve
untouched, but this exact duty table has not been searched in the folder. It is listed as supplied,
deliberately, so the hand-made baseline stays on the record. *(Corrected 28 Sep 2026: this said the
search reaches one factor "on this exact duty table"; no such search is committed.)*

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

**Three hand edits have taken this line from five factors present to four.** A line-order search of a
similar table (*Anchored Lines*) reaches one; this exact table has not been searched in the folder. That has been the unfinished question since *Weeks 17-18 Swapped* and it has not
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
throughout. A line-order search of a similar table (*Anchored Lines*) reaches **one**, with a seven-day
run, FF19 at two and half the weeks on a single turn (09:00 split; 11:00 since 28 Sep: 9 of 20); this
exact table has not been searched in the folder. *(Corrected 28 Sep 2026: this read as a search of this
design's own duty table, which is not committed; the figures were Anchored Lines'.)*

**Saturday Four** (`S4-24-EXT · 481ba9ed`) is the fifth revision and **the first to change a duty rather
than the order of the weeks** — on Saturday, and on Saturday alone. Against *Cover at Seventeen*, **zero
cells outside the Saturday column differ**, Saturday still carries 12 people and still pays 5,895 minutes,
so Mon–Sat is 42,000 to the minute exactly as before. The contract could not move, because the budget the
search was given was the one Saturday already had.

**Nine turns become four, and six start times become three:** `06:20-14:45` ×5, `09:30-16:30` ×1, and 15:15
starting BOTH late turns — `15:15-22:30` ×2 and `15:15-23:55` ×4. Finishes fall 7 → 4. The thinnest
fully-covered hour rises **3.0 → 4.75 people**, and the longest Saturday duty falls **9h10 → 8h40**, bringing
Saturday under the cap the rest of this folder works to.

**Two owner rules are built into the search pool rather than applied afterwards.** In the 21:00–23:00 band the
only legal finish is **22:30**, because that is when the ticket office closes — an earlier draft of this table
put two turns at 22:15, fifteen minutes short of a real handover, which is exactly the sort of time a search
invents and a station cannot use. And the demand TARGET for 15:00–23:00 is lifted 15% for **Wembley**:
Chiltern serves Wembley Stadium out of Marylebone, and an event fills trains the measured curve already
counts, so the curve understates those hours. The traffic row printed on page 6 is still the measured one.

**The fit, both ways:** against the measured curve alone it is **12.6** where its parent *Cover at
Seventeen*'s Saturday is 20.7 (today's link 45.7); against the Wembley-weighted target **11.8** where the
parent's is 26.6 (today's 42.4). The weight is deliberately gentle — it
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

(Superseded 28 Sep 2026 for the paragraph below: the headcounts are now minimums, so five at the open meets
"at least four", and the close asks "at least three" on a Saturday too, which the parent's three already met
— so no December rule changed hands here; the arithmetic it describes still holds.) **One December rule is now met that was not** —
four through to the close, against three. **One cannot be:**
the rule asks four at the open and Saturday still has five. That is arithmetic, not a search failure — no
table of 12 duties paying 5,895 minutes from that pool puts four at the open *and* four at the close, at any
evening floor. Four at the open needs a different Saturday headcount or minutes moved in from a weekday,
and both were outside what this revision was allowed to touch.

**What it cost:** the worst rolling seven-day total rises 53.1 → 53.5 hours, still well under 55. Every other
figure is unchanged. Saturday's headcount is still **12 against the December shape's fourteen**, and that is
the real limit on how much shape Saturday can carry: 5,895 minutes over a 17h35 day is a mean of 5.6 people,
so there is little headroom to build a peak whatever the table.

**Short Closer** is the third supplied design and a further revision of the *Weekday Lates* line. It was
transcribed from a Word table and **checksummed before anything was built on it**: all 24 rows agree with
the Weekly Total the document states for each, and Monday to Saturday comes to exactly 42,000 minutes.
The checksum is worth recording because it looked wrong first — nine rows disagreed, and the nine were
precisely the rows carrying a Sunday duty, which is the proof that the document's Weekly Total column is
Mon–Sat rather than Mon–Sun. Re-checksummed on that basis, all 24 agree.

**Light Retime** asks the smallest question available: *what is the fewest changes that fit December
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
on its pages rather than in a footnote**: Sunday now closes with four where the shape asks three (superseded
28 Sep 2026: three is now a minimum, so four meets it) (22:00
was Sunday's deepest shortfall, so the rule and the measured demand disagree there and the move sides with
the demand), and line 8's Friday-into-Saturday turnaround falls from 15h00 to **12h30**, the tightest rest
in the design and half an hour above the floor — an 11:30 start would hold 13h00 and give back 2.75 points.

**What it does not touch is now the biggest remaining question: Thursday, at 48.8.** It is also the
heaviest day by minutes (7,780 against Monday's 6,225), and those are the same fact. That is a weekday-table
question, not a three-cell one.

**Tenth Sunday** answers the next ask: *give it a tenth Sunday shift, fit demand better, and improve
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
week pattern in *Light Retime* is still here unedited (except the one that gained the Sunday cell — the
parent's week 24, now line 5); 17 of the 20 working weeks change line number, and 7 lines stay put
(working weeks 9, 15 and 16, and the four cover weeks).
Result: factors present **3 → 2**, longest run **9 → 6**, full weekends off 4 → 5, worst seven-day
window 51.6h → 50.9h, tightest rest 12h30. Coverage, headcounts and the contract are invariant by
construction and asserted by the script; the day multisets are exactly *Light Retime*'s plus the one Sunday
cell. `RULES=1 LINES_ONLY=1 node optimise.mjs cea-clean-final-ten-start.json 20000 2 7` reproduces the
grid byte-for-byte (checked), which is what the `R7` in the code says.

**Two other answers were measured and both are committed**, because the PDF names them in its
alternatives table. `tooling/clean-final-ten-alt-fewswaps.json` is the *smallest* reorder that reaches
two factors — a greedy four whole-line swaps, 17 lines untouched — and it shows what small costs: the
run stays at 8, weekends fall to 3, and the 55-hour window sits at 54.7, eighteen minutes from the line.
`tooling/clean-final-ten-alt-full.json` is the full search with duties free to move between weeks: one
factor (FF19 at 4), six weekends, **13 of 20 weeks a single turn** (09:00 split; 11:00 since 28 Sep: 12) — and 19 of the 20 working weeks
rewritten. *Tenth Sunday* is the middle of those three.

**What it costs, stated on its own pages.** Sunday now closes with five where the shape asks three (the
parent already closed with four; a `15:20–23:20` turn keeps it at four for 0.6 of fit; superseded 28 Sep
2026: three is now a minimum, so five meets it). Seventeen line
numbers move, and a line number is what a member knows. The week that gains the Sunday works a late
into three earlies across one rest day — legal by 30h55, and the one week whose *shape* a member would
notice. FF15 sits exactly on its threshold of 4. And nothing the parent left open is answered here:
Saturday's 5/3 open and close (superseded 28 Sep 2026: as minimums both are met), 12 on a Saturday, 4.35
days, Thursday at 48.8.

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
sheet uses; Thursday is still the worst weekday, at 48.8 rather than 60.8. Each of *Short Closer*, *Light Retime* and *Tenth Sunday* was
regenerated after both fixes.

## The decision frame — page 2 of every sheet (24 Sep 2026)

*(Superseded 28 Sep 2026: this describes the sheets of 24 Sep — the page numbers, the comparison against one
design, the December headcounts "met of four" and the glossary under the grid have all moved or changed. The
sheets as they are now: The managers' edition, below.)*

An external comment, accepted by the owner: the calculation was already exhaustive; what the sheets
lacked was **decision structure, an evidence hierarchy, staff validation and a plain statement of
uncertainty**. The ORR's guidance treats its factor list as one input to be triangulated, never as the
answer — and the sheets' page 8 said so in a footnote while every tile above it invited a reader to
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
Where a word is used, it is now explained: a page guide at the top of page 3; the eight roster words
(link, line, turn, rest day, cover week, Sunday, the contract, a one-turn week) under the grid on page
3; how to read the heat chart and what the fit figure is, in one sentence each, on page 6; what the
ORR list is and what ⚠ present actually means, above the fatigue table on page 8, with each factor's
family shown as a chip; "in plain terms" above the method on page 9, one version for a searched design
and one for a supplied one; and what the fingerprint is, on page 10 where the cells are. Polish: zebra
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
hand-edited designs it was not: *Cover at Seventeen*'s cover in the 13:00 hour runs **8, 10, 11, 11, 10**
across the week, and the sheet printed one line. Today's own link differs too (Mon/Wed against Tue/Thu/Fri).

Six sites carried it, and all six are fixed the same way — **by distinct pattern, never by average**:

- **Page 6, the hour-by-hour chart** — one row per distinct weekday pattern, labelled by the days it covers
  (`Proposed Mon`, `Today Tue · Thu · Fri`). A design whose weekdays are identical still prints one row,
  now honestly labelled `Mon–Fri`; nothing is averaged away. (Superseded 28 Sep 2026: a design with one
  weekday pattern now labels its row `Proposed`.)
- **Page 5, the Monday-to-Friday headcount** — a range where the days differ (`13–16`).
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

**Checked on every run row, on all 23 designs: FF11 is the only one where the ceiling and the worst
block placement differ.** The longest-run figure, the 12-consecutive-days row, the 7×8h row and FF15
give the same worst case under both, which the hard-limits row on page 7 now says out loud rather than
leaving to be assumed. *Placing* the block well is another matter: on 14 sheets the placement also moves
the longest run, the 8-hour run, FF15 or the 55-hour row, and the managers' edition names each such row
on pages 3 and 8. *(Corrected 28 Sep 2026: this said "all thirteen designs", and read as though
placement moved nothing else.)* On
**three** designs FF11 differs either side of the threshold (recounted across all 23, 28 Sep 2026):

| | worst case | as rostered |
|---|---|---|
| Weekday Lates | **14** — present | **10** — clear |
| Targeted Fatigue Redo | **15** — present | **12** — clear |
| Three Mondays | **15** — present | **12** — clear |
| Fifteen Turns | 14 — present | 14 — present |
| Weeks 17-18 Swapped | 16 — present | 16 — present |
| every other design | 9–13 — clear | 8–13 — clear |

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

**The code**: design prefix (`ST` / `BB` / `QT` / `EF` / `B2` / `Q2` / `PT` / `P2` / `FR`) · rotation length · duty table (`A`/`B` today's times, `D` the
December default, `Q`/`R` table B with the closer at 15:45 and the two 06:20 openers run on to keep the
contract — `Q` to 14:00 and 14:50, Saturday's own opening times; `R` to 14:30; `E` the December rules
re-solved with no duty over 8h40, `tooling/eight-forty-table.json`; `G` *Eight Forty* with the ticket
office written in, `tooling/by-the-book-2-table.json`; `W` *Quarter To* with the weekend searched again
under the cap, `tooling/quarter-to-2-table.json`; `P` the owner's 25 Sep brief,
`tooling/pinned-turns-table.json`; `N` those pins with every other time on the quarter hour,
`tooling/pinned-turns-2-table.json`; `F` the owner's final rules of 28 Sep, `tooling/final-rules-table.json`) · search seed. A trailing `p` (`BB-24-D21p`) is the rules-only run with no
week-coherence term, kept as a comparator. A trailing `o` (`FR-24-F34o`) is that seed's rotation with its
week order improved afterwards by `order-polish.mjs` — the same duties on every day. `F9-24-K31` is table `K` — the final rules with no duty over 9h and
today's times preferred (`tooling/familiar-nine-table.json`) — at `rota-polish.mjs` seed 31. The fingerprint is the first eight hex characters of
SHA-256 over the 24 × 7 cells in line order. `TN-24-R7` is a reorder: `R7` is `optimise.mjs`'s seed in rules mode (`RULES=1`). `FT-24-R21`'s `R21` is
its seed in the default mode — *Gates Mended* predates the rules switch, and `node optimise.mjs
fifteen-fixed.json 60000 4 21` without `RULES` reproduces `fifteen-turns-repaired.json` (checked 28 Sep
2026; this said the same reading as `TN-24-R7`).
`CFT-24-M3`'s **`M3` is a move count, not a seed** — three
retimed cells — and it is spelled that way because a two-character suffix in this scheme otherwise reads as a
search seed, which would be a claim this design cannot support. The `F7` of `WL3-24-F7` and `WL4-24-F7` is
not the `F` table above: it is the frozen-weeks search at seed 7 (`tooling/weekday-lates-3.meta.json` lists
its alternatives as `F21` and `F34`, "same rules, seed 21 / 34").

The sheets group the prefixes into **five families** (`FAMILY` in `tooling/fresh.mjs`): *Same Turns* (`ST`, `QT`,
`Q2`) · *Pinned Turns* (`PT`, `P2`) · *Right Away* (`FR`, `F9`) · *Fifteen Turns* (`FT`, and the exact solver's
`JE` and `AC`, both built from it) · *Weekday Lates* (every other prefix, `PC` and `CS` included). There were six
until 29 Sep 2026, when the *By the Book* family (`BB`, `EF`, `B2`) was withdrawn.

**Evidence class**: the 24-line length, the four cover weeks and the December headcounts are
owner-relayed figures with no document behind them (class C — `docs/KNOWN_LIMITATIONS.md` → Links),
and the 13-day limit's policy citation is outstanding. No PDF is a recommendation; each says so.

## One fit, on minutes — and what a second pass over the sheets found (24 Sep 2026)

The owner asked whether the sheets could be improved and what was missing. Two things were wrong before
anything was missing.

**Page 5 typed four of its headcounts.** The "Changed — the December headcount" table computed its first
three rows from the cells and carried the next four as literals — `4 → 4 unchanged`, `2 → 3`, `2 → 4 four on
a Saturday`, `4 → 5` — on every sheet, under a masthead that says *figures on this page are computed, not
typed*. On *Cover at Seventeen* it said Saturday closes with four while page 7, correctly, said three. The
rows are now computed per day class (`weekday range · Sat · Sun`, today and proposed) by `headcounts()` in
`tooling/report-data.mjs`, and the last column names the days that miss the rule rather than asserting it.

**There were two demand-fit measures, and they disagreed on a direction.** `fit.mjs`, which chose every
searched table, measures cover in duty MINUTES per hour. `supplied.mjs` and `final.mjs` each carried a copy
of the same formula fed with `calcHourlyCoverage`, which counts a HEAD in every hour a duty touches — a 06:20
start is a whole person in the 06:00 hour, a 23:55 finish a whole person at 23:00 — and that is exactly where
these designs differ. On heads, *Light Retime*'s three retimes made Sunday **worse** (88.2 → 93.2); on
minutes they made it **better** (62.4 → 44.9), which is the figure that family's narrative was written on
while its weekday figures beside it were on heads. One definition now, `weekdayFit` and `dayFit` in
`report-data.mjs`, on minutes, and both renderers call it. **Every `Wk fit` on every sheet moved**: *Cover at
Seventeen* 42.1 → 34.4, *Same Turns* 58.5 → 46.3, *By the Book* 41.1 → 30.8, today's link 56 → 44.7 — and that last figure was itself
wrong, corrected to **51.1** the next day (*A recomputation of every sheet*, below). The
ordering between designs did not change on any sheet checked. *Saturday Four*'s own 11.8 in its section
above is `sat-table.mjs`'s search score, Wembley-weighted; on the shared measure its Saturday reads 12.6 on
page 6. (Corrected 28 Sep 2026: this said "the 11.4 / 11.8 … stay as written". Only the 11.8 is the
Wembley-weighted score; the 11.4 did not reproduce, and that section now reads 12.6, with the parent's and
today's figures told apart.)

**What was added, all computed, none of it typed:**

- **Page 6 — a `fit` column** on every cover row, today's and proposed, per day and per distinct weekday, so
  the figure the searches were run on is beside the chart it describes rather than on a different page as a
  weekday mean.
- **Page 7 — the tightest rest and where it falls** on the 12-hour row (`13h 35m — line 20 Fri 16:25-23:55
  into Sat 13:30-22:00`), with today's beside it. `0 rests under 12h` told a reader nothing about a design
  half an hour from the floor; *Light Retime*'s 12h30 was in this file and on no page.
- **Page 4 — three things on the grid.** A **Turns** column (distinct clock times in the week, Sunday
  included; the page 1 one-turn tile line by line, and the count in the footer). A **Minutes** row (duty
  minutes per day, Mon–Sat summed to the 42,000 the contract is paid in — figures *Short Closer*'s note had
  to carry in prose). And on a hand-edited design, **the cells that differ from its parent outlined**, with
  the count in the legend: `Changed against Three Mondays (TM-24-EXT) — 14 cells on 2 lines`. The parent is
  named in the design's `meta.json`; only local edits carry one (TF, TM, C17, S4, WS, CF, CFT), because a
  re-searched or reordered child differs on most of the grid and outlining a hundred cells says nothing.
- **Page 9 — the alternatives table runs full width** under the two text columns. In the right-hand column
  its design names wrapped to six lines each.
- **Provenance** — page 1 and page 10 state the app version whose modules produced the figures
  (`Marylebone Roster v24.21`), because the rule modules change between releases and a sheet in a drawer
  should say which ones judged it.
- `tooling/regenerate.mjs` now **ships** each render's PDF, JSON and import block into this folder under the
  folder's names; that was a hand-typed copy per proposal, which is how a folder ends up with a PDF from one
  render and a JSON from another. **It had already happened**: the first shipped run rewrote
  `Evening-Peak-WL2-24-R21.json` and its import block, which until then held *Gates Mended*'s
  grid under Evening Peak's name — the PDF was right, the two files beside it were not.
- The page 6 "Reading it" callout on the searched families said its Saturday-weighting and two-peaks
  sentences twice; once now.

**Every fingerprint is unchanged**, checked by `regenerate.mjs --check` after the pass: these are changes
to what the sheets say about the cells, not to the cells. (That check then covered only the supplied
designs — until 25 Sep `--check` fingerprinted nothing for the eight searched proposals, see the tooling
section. It verifies all 23 now.)

**A check of that pass, the same day, found six defects — two of them its own.** All fixed, all 19
sheets regenerated, fingerprints unchanged.

- **The grid footer contradicted page 1 on every sheet.** The Turns column counted the whole week's
  clock times, so its footer said Same Turns had 4 one-turn weeks where page 1, 3 and 7 say 18 of 20.
  The column now counts Monday-to-Friday clock times, and the bold mark and footer use the page 1
  tile's own definition from `feel()`: one clock time Mon–Fri, and every worked day an early or every
  worked day a late. (The split was 09:00 until the managers' edition's second accuracy check moved it to
  11:00, the sheets' own definition of an early; `LEGACY=1` keeps 09:00.)
- **Page 5 said "all already on today's roster" on 14 sheets** whose page 1 counted 5 to 13 new
  times; the label only branched for the searched families. It is computed from the new-times count
  on every family now.
- **Content ran under the footer on seven pages** by 4 to 17px — a page can be inside the height gate
  and still do that, because the footer is absolutely positioned. `shots.mjs` now measures the footer
  gap as well as the height, and the cover masthead, tiles, headings and the design-figures table
  gave back the room.
- **Weekday Lates' page 7 still said the shape asks for five cover weeks.** That was `supplied.mjs`'s
  default open-questions text — Weekday Lates' own prose, with its own figures, which any supplied
  design without a meta file would have inherited as its own. The default is computed now (the
  December rows the design fails, and the Sunday window), and Weekday Lates keeps its prose in a meta
  file of its own.
- **The 12-hour row said "the search here never produced one"** on eight designs that were never
  searched. A supplied design's row now says it was checked, not generated.
- **The searched sheets said "Prepared 8 September" while citing v24.21.** `meta.date` is when the
  design was prepared and is stated as that; when a sheet is re-rendered on a later day it now says
  so beside it. Every supplied design carries its preparation date in its meta file, so a re-render
  never re-dates it. (Superseded 28 Sep 2026: every sheet now says "Prepared 28 September 2026", and the
  date a design was first made is the identity panel's *Created*.)

Two were left as decisions and then taken (24 Sep 2026, owner: "do your suggestions"):

- **Page 8 named a person** (the manager who would assess against this list) in a folder the Pages mirror serves.
  It now says what the eyebrow already says — this is the list the link is assessed against — and
  names nobody. (The draft email that carried the name in its title was deleted on 28 Sep 2026, owner.)
- **Two pick sentences were typed literals.** Same Turns' ("Two candidates tied on every rule; the fit
  decided it") and By the Book's ("All four candidates … full weekends off decided it (6 against 5) …
  the coherence term cost … nothing") were strings in `render.mjs`, true on the day they were written
  and checked by nothing after it. Every searched family now reads `pickSentence` from `final.mjs`,
  which compares the winner with the runner-up rule by rule; By the Book's "what the coherence term
  cost" is read from the rules-only row beside it. Same Turns' sentence now carries the fit figures
  (46.3 against 63.7), which the literal did not.
- **And a third the re-render exposed:** Same Turns' method page compared its two tables with typed
  figures — "57.7 today, 58.5 here … A 69.5" — which were heads-per-hour numbers from before the one
  fit on minutes. It reads 46.3 and 63.7 from the same rows the alternatives table prints, and today's
  figure — 44.7 here as first written, **51.1** since 25 Sep — from the 20-line link itself. Office Written In's
  "against Eight Forty's 70.4, 16.4 and 20.9" was read from `eight-forty-table.json` the same way; the 16.4
  was that file's Wembley-weighted search score, and since 25 Sep the three are read from *Eight Forty*'s
  own cells (70.4, **16.2**, 20.9). No fingerprint moved.

## Office Written In with fewer shift times — measured, not built (24 Sep 2026)

The owner asked whether *Office Written In* could carry fewer shift times. The first pass settled that each
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
(8.1 → 11.8 — behind only the folder's two 8.1 Saturdays, *By the Book*'s and the committed one above; *Eight Forty*'s is 16.2). No sheet was built from
it: a proposal needs the rotation searched again (`MODE=rules node anneal.mjs` on a new table), and a
gain of two turns did not look like it earned four seeded runs without the owner seeing the numbers
first. The Saturday is in the folder if it does.

## Weekend Capped — Saturday and Sunday genuinely rebuilt (24 Sep 2026)

*Quarter To* is the only one of the folder's three cases for keeping today's times with no fatigue factor
present, and its page 7 carried its
own weakest point: the 8h40 cap it is named for reached the weekday only. Saturday's 14:45–23:55 (9h10)
and Sunday's 14:30–23:25 (8h55) were *Same Turns*' tables carried over, and the sheet said that reaching
the weekend "is a different proposal". The owner asked for that proposal, with the weekend
**genuinely rebuilt** rather than trimmed to the cap.

**What "rebuilt" means here** (`tooling/weekend-table.mjs`). Saturday's 14 duties still pay 7,100 minutes
(the Q weekday pays 6,980 and Monday to Saturday is an equality at 42,000), with four at the 06:20 open,
four through to 23:55 and exactly five on after 22:00, as the sheets' rule rows read the December
headcounts. Sunday's ten keep four at 07:15 and three to 23:25 and pay between 5,100 and 5,145 —
Sunday sits outside the contract, and *Quarter To*'s pays 5,145. Every duty is 7h–8h40. Starts and
finishes are the quarter hours **plus every clock time somebody works today** (13:35, 14:50 …), no :05 or
:10 but the window's own, nothing finishing in the hour before the close unless it is a closer, and an
evening finish only when the ticket office closes — 22:30 on a Saturday (owner, 22 Sep 2026), 22:00 on a
Sunday. The thinnest fully-covered hour may not fall below today's.

**The pick is *Quarter To*'s own order, with one guard.** Fewest turns nobody works today, then demand fit
against the December 2026 timetable curve, then fewer distinct turns — but only among tables **at least as
even as the day *Quarter To* inherited** (its Saturday 32.7, its Sunday 80.6, read from `best-Q-34`, never
typed). A weekend rebuilt "under the cap" that followed the timetable worse than the one it replaced
would not be a rebuild. Every table made only of known turns is enumerated exhaustively, then every
table with exactly one new turn, and a seeded search covers the rest; the first version of the
exhaustive pass had a pruning bug that hid most of the known-only space and reported zero where there
are 81, which is why the pass now prints its own count.

| Day | picked | new turns | fit | *Quarter To*'s | today's | pays |
|---|---|---|---|---|---|---|
| Saturday | `06:20-14:00 ×1 · 06:20-14:50 ×3 · 07:15-15:45 ×2 · 08:00-16:30 ×1 · 11:00-19:30 ×1 · 13:00-21:00 ×1 · 14:00-22:30 ×1 · 15:15-23:55 ×4` | **0** | **23.1** | 32.7 | 45.7 | 7,100 |
| Sunday | `07:15-15:45 ×4 · 11:00-19:30 ×1 · 13:30-22:00 ×2 · 14:45-23:25 ×3` | 1 (the capped closer) | **61.4** | 80.6 | 65.9 | 5,130 |

The Saturday is built entirely from times people work today — 07:15–15:45 and 13:00–21:00 are Sunday's
turns, 15:15–23:55 the weekday closer — and follows the Saturday curve better than *Quarter To*'s and far
better than today's. The Sunday closer cannot be a known turn under the cap (today's 14:30–23:25 is 8h55),
so one new time was the floor, and the search found it: 14:45–23:25, fifteen minutes later. The rotation
was then annealed on the assembled table exactly as *Quarter To* was (`MODE=feel`, table `W`), and the
picker's order chose seed 21 of eight (7, 13, 21, 34, 41, 55, 68, 89 — the first four all carried at least
one factor where *Quarter To* has none, seed 34 two (FF15 and FF19), so four more were run; every one of the
eight carries FF19, which makes it a property of the table rather than of a seed, and seeds 34 and 41 carry
FF15 as well): no rest under 12h, a longest run of 6, six full
weekends off, one fatigue factor present (FF19, one week-to-week jump of more than two hours — *Same
Turns* has the same one), and **every one of the 20 working weeks a single turn**, which no other sheet
in the folder manages. Nine of its eleven times are worked today; the two that are not are the 15:45 closer and the
Sunday closer.

**One question the search raised rather than settled**, on the sheet's page 7. Today's Saturday works
two 14:30–22:00 turns, and the ticket-office rule excludes a 22:00 Saturday finish. Admit it
(`ALLOW_TODAY_ENDS=1`) and a Saturday of **fit 14.4**, still entirely in today's times, exists
(`06:20-14:00 ×1 · 06:20-14:20 ×1 · 06:20-14:50 ×2 · 07:15-15:45 ×2 · 08:00-16:30 ×1 · 13:30-22:00 ×2 ·
14:00-22:30 ×1 · 15:15-23:55 ×4`). Whether 22:00 is a Saturday handover point is the room's to say; the
run is in `tooling/q2-sat-today-ends.txt` and the table is rebuilt in a minute either way.

## Pinned Turns — the owner's brief of 25 September 2026, from today's roster (25 Sep 2026)

The brief, verbatim in substance: *start with today's roster; Monday to Friday the 23:55 finishes start
15:45, no shift over 8h40, at least three openers work 06:20–14:20 and two lates work 14:00–22:30; on a
Saturday two openers work 06:20 until at least 14:20 and one late 14:00–22:30; on a Sunday one duty
works 13:00–21:30; these replace the ticket-office pins; adhere to the other rules; do the deepest
search possible to fit the demand for each day; minimise fatigue factors.*

**How it was read.** The pins are hard and the search may not move them. "At least three" openers at
06:20–14:20 and "one" Sunday 13:00–21:30 are minimums — the search may add a second where fit prefers
it, and on Sunday it did. The 8h40 cap is stated for Monday to Friday and applied to every day (the two
weekend sheets before this one did the same; `HI=550` on `brief-table.mjs` measures what lifting it on a
weekend day would buy). "Late turns slightly shorter than earlies" **cannot be met by construction** — the
brief pins an 8h30 late beside 8h00 openers — so its row reads not met and is not a finding against the
search. An evening finish is allowed only when the ticket office closes: 22:00 or 22:30 on a weekday
(both worked today), 22:30 on a Saturday (owner, 22 Sep 2026), 21:30 on a Sunday (the brief's own pin).

**The search** (`tooling/brief-table.mjs`) fixes the pins, then places the remaining duties — six on a
weekday (one opener's finish and five middles), thirteen on a Saturday, nine on a Sunday — from today's
clock times and the quarter hour, under every other rule: four at the open, the closers, exactly five on
after 22:00 Monday to Saturday, 7h–8h40, no :05 or :10, nothing finishing in the hour before the close
unless it closes, nothing starting in the forty minutes after the open, and the thinnest fully-covered
hour never below today's. The pick is the brief's: demand fit first, then fewer turns nobody works today,
then fewer distinct turns. Every table made only of known turns is enumerated, then every table with one
new turn, then a seeded search over the whole pool.

**The minutes were searched too.** Five weekdays and a Saturday must pay exactly 42,000, so the weekday
total W and the Saturday total S are one choice, not two. A quick sweep of every split from W = 6,945 to
7,050 (15 seconds a point, no exhaustive passes) found six feasible splits; each was then searched in
full and scored by 5 × weekday fit + Saturday fit:

| W (weekday) | S (Saturday) | weekday fit | Saturday fit | 5 × wk + sat | new turns wk / sat |
|---|---|---|---|---|---|
| 6,960 | 7,200 | 33.1 | 28.1 | 193.6 | 2 / 3 |
| **6,970** | **7,150** | **33.8** | **23.4** | **192.4** | **3 / 1** |
| 6,975 | 7,125 | 34.6 | 22.0 | 195.0 | 3 / 4 |
| 6,985 | 7,075 | 35.0 | 18.8 | 193.8 | 3 / 5 |
| 6,990 | 7,050 | 35.4 | 18.8 | 195.8 | 2 / 4 |
| 7,000 | 7,000 | 36.2 | 15.9 | 196.9 | 3 / 1 |

The weekday fits best when it pays least and Saturday when it pays least, and they cannot both pay
least: the frontier is flat within a few points and 6,970 / 7,150 stands at the top of it with the fewest
new Saturday turns. The tables:

| Day | table | fit | today's | *Weekend Capped*'s | new turns |
|---|---|---|---|---|---|
| Weekday (6,970) | `06:20-14:00 ×1 · 06:20-14:20 ×3 · 07:00-15:40 ×3 · 13:30-22:00 ×2 · 14:00-22:30 ×2 · 15:45-23:55 ×3` | **32.1** | 50.0–55.8 | 46.2 | 07:00-15:40, 15:45-23:55 |
| Saturday (7,150) | `06:20-14:50 ×4 · 07:15-15:45 ×2 · 08:00-16:30 ×1 · 09:30-18:00 ×1 · 13:00-21:00 ×1 · 14:00-22:30 ×1 · 15:15-23:55 ×4` | **23.4** | 45.7 | 23.1 | 09:30-18:00 |
| Sunday (5,100) | `07:15-15:15 ×1 · 07:15-15:45 ×3 · 09:15-17:45 ×1 · 13:00-21:30 ×2 · 14:45-23:25 ×3` | **62.4** | 65.9 | 61.4 | 07:15-15:15, 09:15-17:45, 13:00-21:30, 14:45-23:25 |

The weekday is where the brief pays: 32.1 against *Weekend Capped*'s 46.2, because the three 07:00–15:40
middles and the two 13:30–22:00 lates put people where the two weekday peaks are, which today's 08:00
and 14:00 turns do not.

**"Would it be better if you could move one or two turn times?"** (owner, later the same day — not the
ticket-office pins, not the number of openers or closers). Tried twice. The first reading let the brief's
own weekday times float — closers at 15:15 would take the weekday fit to about 32.4, and 06:20–14:00
openers with them to about 30.9 — and the owner ruled that the 15:45 closer and the 06:20–14:20 openers
were set for a reason and stay (`MOVE=` on `brief-table.mjs` keeps the measurement; nothing is built on
it). The second reading moved only turns that are NOT pinned, and the one move the search could not make
by itself was OFF the quarter-hour grid: `FINE=n` lets at most n turns take any legal five-minute time.
One move is worth it — the three 07:00–15:30 middles become **07:00–15:40** — and it frees the fourth
opener to be today's 06:20–14:00: weekday fit **33.8 → 32.1**, the weekday's new times three → two, at
the same 6,970 / 7,150 split. Saturday gains nothing at that split; Sunday would gain 62.4 → 59.7 but
only for two moves and five new times, so it was not taken. The table above is the moved one. Saturday is close to *Weekend Capped*'s (23.4 against 23.1) and Sunday is within a point of it — with the
Sunday pin taking a turn the fit would rather have placed at 13:30.

**The rotation was searched in both of the anneal's modes**, four seeds each: fatigue-first (a present
factor costs more than any feel term) and like-today. Fatigue-first cleared **every factor on all four
seeds**; like-today kept one or two on every seed. So the family is the fatigue-first run, and the best
like-today result is a labelled row on page 9 for comparison. The pick among the four is seed 34 (six
full weekends off, the search's own lowest score): `PT-24-P34 · dae6292e` — no rest under 12h, a longest
run of 6, six full weekends off, **zero fatigue factors present**, 14 of 20 working weeks a single turn (09:00 split; 11:00 since 28 Sep: 12),
and 9 of its 16 times worked today. Beside *Weekend Capped*: a weekday fit of 32.1 against 46.2 and no
factor against one, paid for in familiarity — seven new times against two — and in a Sunday that the
pin makes marginally less even than the one searched freely. (The sheet first shipped as `931e5bfd` on
the on-grid table at 33.8, with 15 one-turn weeks and 8 of 16 times today's; the moved table replaced
it the same day, re-annealed in both modes with the same result — fatigue-first clears every factor on
all four seeds, like-today keeps one or two.)

## Round Times — the same pins, every other time on the quarter hour (25 Sep 2026)

The owner's second question of the day, after reading *Pinned Turns*' fit: *what if you can rewrite the
rest of the times apart from the pinned turns — but they must start and finish on non-confusing times;
follow the rest of the rules; deepest, maximum-effort search.*

**How it was read.** The pins stand exactly as briefed and are the only times the search may not touch.
"Non-confusing" is read as the **quarter hour**: every other duty starts and finishes on :00, :15, :30
or :45, or at the window's own instant (06:20 open, 23:55 close; 07:15 and 23:25 on a Sunday). The one
further time allowed is the owner's own pinned turn **06:20–14:20**, which any day may use as an opener —
a time the brief itself set cannot be a confusing one. **Familiarity is not a criterion**: *Pinned Turns*
drew its pool from today's clock times as well as the quarter hour, which is how it came to work 06:20–14:50
(a turn people work today) and, by one five-minute move, 07:00–15:40 (a turn nobody works today); this sheet
draws on neither. **A sensible number of shift times, not too complex** (owner, the same afternoon, on
seeing a nine-turn Saturday): no day may work more distinct turns than *Pinned Turns* does on that day —
6 on a weekday, 7 on a Saturday, 5 on a Sunday (today's roster works 8 / 6 / 4) — and under that cap the
pick is demand fit, then fewer distinct turns, then fewer distinct starts and finishes. The cap is a hard
rule in the enumeration rather than a preference, because the bound has to be taken against the best
table UNDER it — as a preference, a seven-turn Saturday could be pruned by the nine-turn table it would
have beaten. Every other rule is *Pinned Turns*': four at the open, three through to the close (four on a
Saturday), exactly five on after 22:00 Monday to Saturday, 7h–8h40, nothing finishing in the hour
before the close unless it closes, an evening finish only when the ticket office does, the thinnest
fully-covered hour never below today's.

**The one time off the grid is arithmetic, not taste.** Five weekdays and a Saturday pay exactly 42,000
minutes (20 lines × 35h). On a pure quarter-hour grid every opener from 06:20 and every closer to 23:55
is ten minutes off a multiple of fifteen, and every middle turn is a multiple — so a weekday pays
10 mod 15, a Saturday 5 mod 15, and **no pair (W, S) balances; the contract is unreachable**. *Pinned
Turns* balanced it with its 07:00–15:40, a turn nobody works today. Here one Saturday opener on the pinned 06:20–14:20 (8h00,
a multiple of fifteen where the quarter-hour openers are not) takes the Saturday to 10 mod 15 and closes
it. That is why the pinned turn is in the pool, and why the Saturday table has exactly one of them.

**The search** (`tooling/quarter-table.mjs`) is **exhaustive on every day, with a proof**, where
*Pinned Turns*' was a sample over the whole pool. Every opener multiset × every closer multiset × every
middle multiset paying the exact remainder is enumerated, with a branch-and-bound on the fit: an hour
already over its traffic share can only get further over as duties are added, so the squared gaps of
the over-covered hours are a lower bound on the finished fit, and a partial table whose bound already
beats the incumbent is abandoned. A simulated anneal with restarts supplies the incumbent first and is
the calibration — on every day it reached the enumerated optimum on every restart:

| Day | opener × closer sets | feasible tables (`BOUND=0`, every one visited) | anneal restarts at the optimum | best fit |
|---|---|---|---|---|
| Weekday (6,970) | 8 × 1 | 1,838,306 | 6 of 6 | **33.8** |
| Saturday (7,150) | 215 × 210 = 45,150 | 2,184,885 (uncapped — the seven-turn cap was a bounded run, below) | 8 of 8 (uncapped) | **22.9** under the cap; 21.3 at nine turns |
| Sunday (5,100–5,145) | 210 × 84 = 17,640 | 2,561 | 6 of 6 | **62.4** |

The bounded runs finish far fewer tables (738,954 weekday, 1,654,092 Saturday uncapped, and 31,239 Saturday
under the seven-turn cap — `tooling/p2-sat.txt`, the run the sheet ships) because the bound
abandons a partial table the moment its over-covered hours alone are worse than the incumbent; the
unbounded runs were made so the size of each space could be stated rather than the size the bound let
through. The Saturday anneal cannot construct a capped table at all — its calibration is the uncapped
run, same pool, same rules — so under the cap the enumeration stands alone, which is what a proof is for.

**The split was searched too**, as *Pinned Turns*' was, and this time every point is a proof rather than
a sample. The grid can pay a weekday at 10 mod 15 (a quarter-hour fourth opener) or 0 mod 15 (the fourth
opener on 06:20–14:20); every such W from 6,940 to 7,000 was solved, S = 42,000 − 5W, and the pair with
the lowest 5 × weekday fit + Saturday fit kept:

| W (weekday) | S (Saturday) | weekday fit | Saturday fit | 5 × wk + sat |
|---|---|---|---|---|
| 6,940 | 7,300 | 31.8 | — no Saturday pays it (the cap allows 7,220) | — |
| 6,945 | 7,275 | 32.4 | — | — |
| 6,955 | 7,225 | 32.8 | — | — |
| 6,960 | 7,200 | 33.1 | — proven: none (two 06:20–14:20 openers are needed for the arithmetic, and then no five middles reach the remainder) | — |
| **6,970** | **7,150** | **33.8** | **22.9** under the cap (21.3 uncapped) | **191.9** |
| 6,975 | 7,125 | — no weekday pays it (five middles would average over 8h30) | 20.2 | — |
| 6,985 | 7,075 | 35.0 | 17.6 uncapped | 192.6 at best |
| 6,990 | 7,050 | — | 16.7 | — |
| 7,000 | 7,000 | 36.2 | 14.7 uncapped | 195.7 at best |

The weekday fits better as it pays less and so does Saturday, and the contract lets them not both: the three
feasible splits sit within five points and 6,970 / 7,150 — *Pinned Turns*' own split — stands at the
top, and the cap cannot change that (the other two splits lose by more than the cap costs even with
their Saturdays uncapped). The tables, beside *Pinned Turns*':

| Day | table | fit | *Pinned Turns*' | today's | new turns |
|---|---|---|---|---|---|
| Weekday (6,970) | `06:20-14:20 ×3 · 06:20-14:30 ×1 · 07:00-15:30 ×3 · 13:30-22:00 ×2 · 14:00-22:30 ×2 · 15:45-23:55 ×3` | **33.8** | 32.1 | 50.0–55.8 | 06:20-14:30, 07:00-15:30, 15:45-23:55 |
| Saturday (7,150) | `06:20-14:20 ×1 · 06:20-15:00 ×3 · 07:00-15:30 ×2 · 09:15-17:45 ×2 · 13:00-21:00 ×1 · 14:00-22:30 ×1 · 15:15-23:55 ×4` | **22.9** | 23.4 | 45.7 | 06:20-15:00, 07:00-15:30, 09:15-17:45 |
| Sunday (5,100) | `07:15-15:15 ×1 · 07:15-15:45 ×3 · 09:15-17:45 ×1 · 13:00-21:30 ×2 · 14:45-23:25 ×3` | **62.4** | 62.4 | 65.9 | 07:15-15:15, 09:15-17:45, 13:00-21:30, 14:45-23:25 |

**What the grid cost and bought.** The weekday gives back 1.7 of fit — *Pinned Turns*' 07:00–15:40 was
worth exactly that, and it is the one weekday time that sheet has off the quarter hour. Saturday gains
half a point at the same seven turns, and of its three turns nobody works today one, 07:00–15:30, is
the weekday's own — so the week holds fourteen distinct turns against *Pinned Turns*' sixteen. Sunday is the same table: *Pinned Turns*' Sunday was
already on the quarter hour, and the enumeration shows nothing on the grid beats it under the
13:00–21:30 pin. **The Saturday ladder, every rung proven** (`tooling/p2-sat-unbounded.txt`): 6 turns →
26.2 · **7 → 22.9** · 8 → 21.7 · 9 → 21.3 · 10 → 21.7 · 11 → 22.1. The best-fitting Saturday of all has
nine distinct turns (`06:20-14:20 ×1 · 06:20-14:45 ×2 · 06:20-15:00 ×1 · 07:00-15:30 ×2 · 08:15-16:45 ×1 ·
09:30-18:00 ×1 · 12:30-21:00 ×1 · 14:00-22:30 ×1 · 15:15-23:55 ×4`, sixteen clock times against the
seven-turn table's thirteen); the cap costs 1.6 of fit for two fewer shift times to hold, and today's six
would cost 3.3 more. Sunday at today's four turns would read 68.2 against 62.4. The sheet ships the
capped tables and states the ladder on its page 7.

**The rotation was searched in both of the anneal's modes**, four seeds each, exactly as *Pinned Turns*'
was, and with the same outcome: fatigue-first cleared **every factor on all four seeds**; like-today kept
one (FF19) on every seed. So the family is the fatigue-first run and the best like-today result is a
labelled row on page 9. The pick among the four is seed 13 (six full weekends off, one hybrid week — two on the 11:00 split used since 28 Sep; seed
7 scores lower on the search's own objective but leaves only four weekends off): `P2-24-N13 · 33a78cbe`
— no rest under 12h, a longest run of 6, six full weekends off, **zero fatigue factors present**, 16 of
20 working weeks a single turn (09:00 split; 11:00 since 28 Sep: 15), fourteen distinct turns in the week (*Pinned Turns* has sixteen, today's
roster eighteen), and 6 of its 14 times worked today. Beside *Pinned Turns*: the same rules result, a
weekday fit 1.7 worse and a Saturday half a point better, every unpinned time on the quarter hour, two
fewer shift times to hold.

## Right Away — the owner's final rules, the ticket office kept off the floor (28 Sep 2026)

The owner's final set of rules, given over 27–28 September after reading the league table of every
design against them. **Hard:** Chiltern's 13-day limit, twelve hours between duties, the exact 35-hour
week (Sunday outside it), 14 on a Saturday and 10 on a Sunday, four cover weeks. **Fixed turns, exact
counts:** Monday to Friday two `06:20-14:20` and two `14:00-22:30`; Saturday two `06:20-14:50` and two
`14:30-22:00`; Sunday two identical earlies from 07:15 and two identical lates to 22:30, for a ticket
office open 07:15–22:30. **Every weekday closer starts 15:45** (today's 15:15). **Everything else is
demand based, and demand matching is important** — with these soft rules around it:

- the headcounts are **minimums**, never marked down for more: at least four at the open, at least three
  at the close (Saturday included), at least five on at 22:00, every day;
- **the fixed pairs are the ticket office and are not floor cover**, and at least two people are on the
  floor at every moment — the first Sunday found without that rule left one person on the floor from
  14:20 to 15:15;
- a **15-minute handover** to each closer (on a Sunday every floor opener stays 15 minutes past the last
  closer's start) and **20 minutes** between the two ticket-office pairs;
- Sunday duties **8h to 9h** (every other day 7h to 9h30), Sunday free to use up to six shift times;
- no more shift times than today (18 in the week); Saturday **evenly balanced to demand**, not leant late
  for events; "nothing finishes in the hour before the close" dropped.

**How it was built.** `tooling/final-table.mjs` fixes the pairs and the 15:45 closers, then enumerates
every remaining table on the five-minute grid (quarter-hour starts, or the window's own instants) with a
branch-and-bound on the fit **of the floor** — the office's minutes taken out of the cover before the
share-of-traffic measure is applied. Each day is a proof, not a sample. The split was swept as before —
5W + S = 42,000 — and every point proven (floor fit, weekday / Saturday):

| W (weekday) | S (Saturday) | weekday floor fit | Saturday floor fit | note |
|---|---|---|---|---|
| 6,960 | 7,200 | 20.2 | 12.9 | |
| **6,970** | **7,150** | **20.4** | **11.6** | this sheet |
| 6,975 | 7,125 | 20.6 | 10.8 | a fast re-run (28 Sep) finds this weekday with 8 turns and 12 clock times; the "fifteen shift times" first written here did not reproduce |
| 6,990 | 7,050 | 20.9 | 9.2 | |

The sheet takes the weekday's side of that trade by a little; the room may prefer Saturday's, and every
other row is one command away. The tables (`tooling/final-rules-table.json`):

| Day | table | floor fit | fit with the office | today's floor fit | today's, everyone on duty |
|---|---|---|---|---|---|
| Weekday (6,970) | `06:20-13:45 ×1 · 06:20-14:20 ×2 (office) · 06:20-14:30 ×1 · 06:20-15:45 ×1 · 07:00-16:15 ×2 · 14:00-21:00 ×1 · 14:00-22:30 ×2 (office) · 15:45-23:55 ×4` | **20.4** | 21.9 | 68.8 | 50.0–55.8 |
| Saturday (7,150) | `06:20-14:50 ×2 (office) · 06:20-15:30 ×3 · 07:15-16:45 ×2 · 14:30-22:00 ×2 (office) · 14:45-22:45 ×1 · 15:45-23:55 ×4` | **11.6** | 12.2 | 68.7 | 45.7 |
| Sunday (5,070) | `07:15-15:30 ×4 (two of them the office) · 09:15-18:15 ×1 · 13:30-22:30 ×2 (office) · 15:15-23:25 ×3` | **19.2** | 33.6 | 72.5 | 65.9 |

Everyone on duty: 5 / 5 / 4 at the open, 4 / 4 / 3 at the close, 6 / 5 / 5 on at 22:00, never fewer than
three on the floor on a weekday or Saturday and two on a Sunday. **The fit with the office counted is
always looser than the floor's**, because the office is staffed to its opening hours rather than to the
trains — and the fit is a measure of shape, not level, so a person added to a quiet hour worsens it
while nobody is worse off. Read it beside the heads, never alone.

**The rotation** was searched fatigue-first (`MODE=rules`, table F, 100,000 steps × 5 restarts, seeds
7 13 21 34). Three seeds cleared every factor; seed 34 has the most full weekends off of those three:
`FR-24-F34 · 03a59c77` — no rest under 12h (tightest 14h05), a longest run of 6, six full weekends off,
**zero fatigue factors present**, 11 of 20 working weeks a single turn, a typical week-to-week step of
1h50, and **17 distinct turns in the week against today's 18** — 5 of them worked today.

**The week order, improved (28 Sep 2026) — the sheet is now `FR-24-F34o · be01f0db`.** `tooling/order-polish.mjs`
searched onward from seed 34's rotation with same-day swaps and whole-line swaps only, so every day's duties — the
eleven rules, the fit, the 17 shift times and the 35-hour average — are exactly as before. It refuses any move that
would make a figure worse than seed 34's: a fatigue factor present or any fatigue figure higher, a heavier or lighter
week, a bigger week-to-week move, more single rest days, a longer run of weeks on one turn, a week of 3 or 6 days.
Two earlier attempts without those guards looked better on paper and were not: one reached 16 one-turn weeks by
pushing FF11 to 13, at the threshold; one by splitting rest days into nine singles and adding a six-day week. The
result, against seed 34: **14 of 20 weeks on one shift time (11)**, heaviest Mon–Sat week **41h50 (46h55)**, the
most hours in any seven days **52.8 (53.5)**, FF11 **8 (9)**, the rotation **11 backward / 13 forward (14 / 14)**,
a week-to-week step of 1h46 (1h50); rest, run, weekends off, single rest days and every rule unchanged. It is a
candidate in `results/` like the seeds (`best-RF-34o.json`, `o` for the order), and `final.mjs` picks it by the
same rule as every seed: it ties seed 34 on every rule and on fit, and wins on the search's own score, 12,660
against 12,700. Seed 34's rotation remains in `results/` and is the runner-up on page 9.

**The sheet shows the cover three ways** on page 6 — everyone on duty, of whom the ticket office, of
whom the floor, each with its own fit — which is the only way to read a table whose fixed pairs sit
across the day's quietest hours by design.

**What it does not model.** The owner has since said the second office person helps on the floor at the
quiet ends (the morning one until 08:00, 09:00 on a Sunday; the evening one from 19:30; on a Sunday the
evening one splits their time). `final-table.mjs` now does that by default; this sheet was built with it
off, as the rules stood when it was asked for, and a table built with it on would be a different proposal.

## The ticket office's second person on the floor (28 Sep 2026)

**The owner's rule, now in every sheet:** one of each ticket-office pair helps on the floor at the quiet ends — the
morning one from the open until 08:00 (09:00 on a Sunday), the evening one from 19:30 to the end of their office shift;
on a Sunday evening they split their time between the office and the floor, counted as **half a person**. Until this,
the sheets counted the office as never on the floor, and no sheet said a word about the help. `report-data.mjs` now
applies the rule once (`officeHelpers`, `OFFICE_HELP_TEXT`) and every figure follows it:

- **The floor fit** (pages 1, 2, 6 and 9): the office's minutes are taken out and the helpers' minutes put back, the
  Sunday evening one at half.
- **"At least two on the floor at every moment"** (page 7): the helper counts as a whole person while helping; the
  Sunday half-person never counts towards the minimum, which counts heads.
- **Page 6's rows** move the helper from the office row to the floor row in the hours they help.
- **Each design's own office pairs** are taken out, not always the plan's posts. That was wrong only for a Sunday
  office late that starts other than 13:30 — none shipped until *Familiar Nine*, whose Sunday lates are 14:00–22:30.
- **The words**: page 2's fit note, page 6's office paragraph and reading note, the glossary, page 7's floor-rule
  note, page 9's legend and the rules sheet each say it in one line.

**What moved.** No proposal's rule count changed. **Today's link now meets 4 of the 11 rules, not 3**: its only
one-person moment was early on a Sunday, which the morning helper now covers. The fits move the other way for the
proposals built to leave the office off the floor — *Right Away*'s floor fit goes 20.4 · 11.6 · 19.2 → 26.1 · 16.2 ·
31.2, because it already staffed the quiet ends as though nobody helped — and today's weekday improves, 68.8 → 52.5,
because its office pairs really do add floor at both ends. The ranking by weekday floor fit barely moves; on
Saturday *By the Book* (11.8) now leads *Right Away*. The current figures, from the sheets' own code — restated on 28 Sep 2026 on the exact hour edges (see *An external
review*, below), and ordered by rules met, then weekday floor fit:

| Sheet | Code | Floor: weekday · Saturday · Sunday | Fewest on the floor | Rules met |
|---|---|---|---|---|
| **Right Away** | `FR-24-F34o` | 26.5 · 14.6 · 28.9 | 4 · 3 · 2 | 11 |
| **Familiar Nine** | `F9-24-K31` | 27.7 · 15 · 31.3 | 3 · 3 · 3 | 11 |
| **All Clear** | `AC-24-M41` | 42.1 · 37.8 · 77.5 | 3 · 3 · 2 | 11 |
| Clean Sweep | `CS-24-M34` | 34.6 · 40 · 53.5 | 2 · 3 · 3 | 10 |
| Pinned Turns | `PT-24-P34` | 35.8 · 21.5 · 60.8 | 2 · 3 · 1 | 8 |
| Round Times | `P2-24-N13` | 37.8 · 22 · 60.8 | 2 · 3 · 1 | 8 |
| Quarter To | `QT-24-Q34` | 49.7 · 43.7 · 93.9 | 3 · 3 · 1 | 8 |
| Weekend Capped | `Q2-24-W21` | 49.7 · 21.9 · 73.4 | 3 · 3 · 1 | 8 |
| Same Turns | `ST-24-B7` | 52 · 43.7 · 93.9 | 3 · 3 · 1 | 7 |
| Fifteen Turns | `FT-24-EXT` | 38.4 · 44.8 · 49 | 2 · 2 · 1 | 5 |
| Gates Mended | `FT-24-R21` | 38.4 · 42 · 49 | 2 · 2 · 1 | 5 |
| Saturday Four | `S4-24-EXT` | 38.5 · 35.8 · 64.8 | 3 · 0 · 1 | 4 |
| Weekday Lates | `WL-24-EXT` | 40.4 · 20.7 · 64.8 | 3 · 3 · 1 | 4 |
| Cover at Seventeen | `C17-24-EXT` | 38.5 · 20.7 · 64.8 | 3 · 3 · 1 | 3 |
| Anchored Lines | `WL4-24-F7` | 41.1 · 20.7 · 64.8 | 3 · 3 · 1 | 3 |
| Evening Peak | `WL2-24-R21` | 47.6 · 20.7 · 64.8 | 2 · 3 · 1 | 3 |
| Polished Clean | `PC-24-EXT` | 38.7 · 51.4 · 72.4 | 3 · 0 · 2 | 2 |
| *Today's 20-line link* | — | 52 · 65.9 · 71.7 | 2 · 2 · 2 | 4 |

*(29 Sep 2026: the By the Book family's three rows — 5, 5 and 4 rules — removed with the family; later the same day
Weeks 17-18 Swapped, Targeted Fatigue Redo and Three Mondays, 3 each.)*

## Familiar Nine — no duty over nine hours, and the times people know (28 Sep 2026)

`F9-24-K31 · c450951c`. The owner's pick from the option sweep (below): Right Away's rules with two more aims —
**no duty over nine hours**, and **the shift times people already work, wherever they cost little fit**.

**The table (`K`, `tooling/familiar-nine-table.json`)** is `final-table.mjs` with `HI=540` (nine hours), `TODAY=1`
(today's own clock times in the pool) and `NEWPEN=2` — every time nobody works today costs 2 on the fit, the rate at
which the new times roughly halve. The weekday is **proven** (22.5 million tables, 10m45s); Saturday and Sunday are
enumerated. It was built with the office off the floor, as Right Away's was, and scored better under the helper
rule than the same aims built with the helper on (27.8 · 16.6 · 33.8 against 28.3 · 16.1 · 31.0 on the fit as then measured, with 9 of its 15
times known against 8 of 16). **9 of its 15 times are worked today** (Right Away: 5 of 17), the longest duty is
**9h00** (9h30), and the thinnest Sunday floor is **3** (2).

**The rotation** was not re-searched from scratch: a fresh anneal on a new table did not get back to Right Away's
quality in the time given (6–7 single rest days where Right Away has 2, a factor present). Instead
`carry-order.mjs` laid each day's new duties onto Right Away's lines in the same order — an early stays the nearest
early, a closer a closer — and `rota-polish.mjs` then improved the week order, refusing to count any result worse
than its reference on rest, fatigue, rest days, runs, weekends, one-turn weeks or the heaviest week: first against
seed 34's Right Away, then against the improved Right Away. Result, against Right Away (`FR-24-F34o`): shortest rest
**14h20** (14h05), 14 of 20 weeks on one shift time (14), heaviest Mon–Sat week **41h45** (41h50), most hours in any
seven days **51.3** (52.8), FF11 8 (8), six weekends off, two single rest days, 0 fatigue factors, all 11 rules. The
price is fit: 27.7 · 15.0 · 31.3 against 26.5 · 14.6 · 28.9 on the sheets' current measure (27.8 · 16.6 · 33.8 against
26.1 · 16.2 · 31.2 when it was built) — still about half of today's weekday figure, 52.0.

**The option sweep behind it** (28 Sep 2026, scratch — only the pick shipped): 16 table variants, each with Right
Away's structure carried on and polished (4 seeds each), and 6 built with the office helping. Familiar times cost
almost nothing at a light penalty (`NEWPEN=1`: 9 new times, fit 21.0 · 11.7 · 19.2 before the helper rule); a
nine-hour cap costs about a point a day; an 8h40 cap cannot pay Saturday at the current hours split and costs more
elsewhere; fewer shift times are nearly free on a weekday and costly on a Saturday; tables built with the office
helping, or with fewer times, relied on Saturday's office lates finishing at 22:00 and failed the 22:00 rule until
`AT22_STRICT` was added. No variant reached seven weekends off. The strongest familiarity (only 4 new times) costs
30.5 · 19.8 · 33.8 and is the alternative if the room prefers it.

**Reproduce it** (from `tooling/`; each step's output is exactly the shipped grid's):

```
H="TO_EARLY_HELP=0 TO_LATE_HELP=1440 TO_LATE_SHARE=0"
env $H HI=540 TODAY=1 NEWPEN=2 CLS=weekday TOTAL=6970 MAX_TURNS=8 BEST0=26.3 OUT=k-wk.json node final-table.mjs   # proof, ~11 min
env $H HI=540 TODAY=1 NEWPEN=2 CLS=sat TOTAL=7150 MAX_TURNS=6 OUT=k-sat.json node final-table.mjs
env $H HI=540 TODAY=1 NEWPEN=2 CLS=sun MAX_TURNS=6 OUT=k-sun.json node final-table.mjs
# flatten each day's { duties: [[time, n], …] } to a list of times, then:
CAP=540 PIN_WK="06:20-14:20x2,14:00-22:30x2" PIN_SAT="06:20-14:50x2,14:30-22:00x2" PIN_SUN="07:15-15:30x2,14:00-22:30x2" AT22_FLOOR=1 node assemble-table.mjs familiar-nine-table.json k-wk.flat.json k-sat.flat.json k-sun.flat.json
node carry-order.mjs familiar-nine-table.json c0.json ../Right-Away-FR-24-F34o.json
REST_CAP=1 node rota-polish.mjs c0.json c1.json 21 100000 results/best-RF-34.json
REST_CAP=1 node rota-polish.mjs c1.json familiar-nine.json 31 120000 ../Right-Away-FR-24-F34o.json   # → c450951c
node regenerate.mjs --only=F9
```

## Just Enough — Fifteen Turns with the fewest changes that meet every rule (28 Sep 2026)

`JE-24-M29 · 49717d70`. The owner's brief: *redo Fifteen Turns with the minimum number of changes to follow the hard
and soft rules and minimise fatigue factors — search all possible combinations*, then *minimise the number of changes
if possible*. So the order is **changes first, fatigue factors second**, and both are **proven**, not searched for.

**What counts as a change.** One cell — one line on one day — that differs from *Fifteen Turns* (`FT-24-EXT`). A
retimed duty, a duty becoming a rest day and a rest day becoming a duty each count one. The shift times allowed are
the ones already in use: *Fifteen Turns'*, *Gates Mended*'s, today's link's and the ticket office's plan times (32
in all), so the answer introduces no time nobody has seen. The cover weeks may not move (they already meet the
cover rule).

**The answer: 29, and no fewer is possible.** Why, in plain terms — the rules force most of it:

| Changes | Why they are needed |
|---|---|
| 15 | **Every weekday closer at 15:45.** *Fifteen Turns* has three 16:25 closers every weekday; at least three must close, and each must be a 15:45. Twelve 16:25s simply move to 15:45; three closers are made on other lines (line 1 Fri, line 11 Wed and Thu) where moving one in place would break a rest or a run |
| 6 | **The ticket office, weekdays** — a second 06:20–14:20 every weekday (line 11 Mon and Tue, line 19 Wed, line 17 Thu and Fri) and a second Friday 14:00–22:30 (line 11) |
| 4 | **Saturday** — two 14:30–22:00 office lates (lines 5 and 13); line 7's 12:00–20:00 becomes the 06:20–14:50 that line 5 gave up, **which also clears the 11h15 rest** into line 8's Sunday; and line 15 works Saturday 16:25–23:55, the **fourteenth person** and a fifth still on at 22:00 |
| 2 | **Sunday** — lines 13 and 17 go from 14:00–22:00 to 14:00–22:30: the office's late pair, and five on at 22:00 |
| 2 | **The contract.** The 15:45 closers add ten hours a week and Saturday's fourteenth person another seven and a half; the contract is exactly 42,000 minutes Monday to Saturday, so two weekday duties become rest days (line 3 Mon, line 17 Wed) |

The lower bound can be seen by hand. The rules force 26 cells (15 closers, 6 weekday office, 2 Saturday office, 1
Saturday headcount, 2 Sunday office), and even arranged as thriftily as possible those 26 leave Monday to Saturday at
least 840 minutes over the contract. A retime between the times allowed saves at most 90 minutes, so two more cells
must be duties removed outright. The 11h15 rest then needs a 29th: the only two cells that touch it are one of the
four Sunday openers the open rule needs and a Saturday duty, and removing either loses a rule, so one of them has to
be retimed. The solver proves the 29 outright.

**The trade between changes and fatigue factors**, every row from the solver (`tooling/exact/frontier.py`,
`fewest.py`); *proven* means the solver finished with a proof, not a time-out:

| Fatigue factors present | Fewest cells changed |
|---|---|
| 7 (*Fifteen Turns* as drawn) | — it breaks two hard limits and meets 5 of 11 rules |
| 3 | **29 — proven** (this proposal) |
| 2 | at least 31 (33 found) |
| 1 | at least 32 (40 found) |
| 0 | **41 — proven** (*All Clear*, below) |

So the fewest-changes answer keeps three factors, all three already in *Fifteen Turns* (a block of early starts
without two rest days after, FF8b; a 58-hour seven days, MRSF; start times moving more than two hours inside a
working block, FF19); clearing them costs twelve more cells. *Fifteen Turns'* other four — FF11, FF15, the 8-hour
run and the 11h15 rest (FF13) — are gone.

**Choosing among the 29-change versions.** Many tie on 29 changes and three factors, so the choice was made in a
fixed order, each stage holding the ones before it: the most full weekends off (**two**, as *Fifteen Turns* —
proven the most possible); then the **smallest changes** — the sum over the changed cells of how far the start and
finish move, a rest day ⇄ duty counted as a whole duty, so a 16:25 closer moving to 15:45 is small and a closer
becoming an early is large (proven the smallest possible); then the fewest two-hour start-time jumps (8), early
blocks without rest (7), the lightest heaviest week (58h, as *Fifteen Turns*), the shortest longest run (9, proven)
and the most one-turn weeks (9). A first attempt skipped the weekend and size stages and came back worse on both —
one weekend off and a Sunday fit of 80 — which is why they come first.

**Against *Fifteen Turns*:** all 11 rules (5), three hard limits met (two broken), three factors (seven), shortest rest
14h05 (11h15), two weekends off (two), longest run 9 (9), floor fit weekday 34.3 (38.4) and Sunday 34.9 (49.0) but
Saturday 51.4 (44.8) — the two office lates are earlier than the turns they replace — and 9 of 20 weeks on one shift
time (12). **Thirteen of the twenty working lines change**; the other seven are exactly as drawn.

**How the proof is trusted.** The solver (Google OR-Tools CP-SAT, `pip install ortools`) is given every rule as a
constraint, written the way the app's code measures it. Two independent checks stand between it and the sheets:
`evaluator.py` re-implements the eleven rules, the three limits and the nine fatigue factors that can occur here,
and `check_evaluator.py` compares it with the sheets' own code (`jsjudge.mjs`, which calls `currentRules`,
`assessFatigue`, `runDesignChecks` and `assessHardLimits`) on every shipped design and random edits of each —
**1,224 grids, 0 disagreements**, every factor seen present (the rarest 31 times). `check_model.py` then pins the solver
to test grids and asks it, rule by rule and factor by factor, whether each passes — **224 grids, 0 disagreements**,
every rule seen both passing and failing, including runs into and out of a cover week. Every grid the solver
returned was re-judged by the sheets' own code before it was used.

**Reproduce it** (from `tooling/exact/`; the proven numbers reproduce exactly — with four solver threads the grid
chosen among exact ties can differ run to run, so the shipped grid is `tooling/just-enough.json`):

```
pip install ortools
python3 check_evaluator.py 3 50                      # 1,224 grids against the sheets' code: 0 mismatches
python3 frontier.py 1200 8,7,6,5,4,3,2,1,0           # fewest changes at each factor budget → front-f<N>.json
python3 fewest.py 0 3600 front-f0.json zero.json     # 0 factors: 41, proven (a hint speeds the proof)
python3 tiebreak.py 29 3 just-enough.json 600 front-f3.json wk,size,jumps,ff8,h,run,one
python3 check_model.py just-enough.json              # 224 grids, the solver's reading against the evaluator: 0 mismatches
cd .. && node regenerate.mjs --only=JE
```

The 0-factor end of the trade is now a proposal of its own, *All Clear* (below).

## All Clear — Fifteen Turns with no fatigue finding, in the fewest changes (28 Sep 2026)

`AC-24-M41 · 094fd369`. The owner: *make the zero-factor version a sheet too*. It is the bottom row of *Just Enough*'s
trade table — **every rule met, no fatigue factor present, in the fewest cells changed from *Fifteen Turns*: 41,
proven** — tie-broken and shipped as a proposal of its own. Same allowed times as *Just Enough*, cover weeks untouched.

**What the 41 are** (counted from the grid, `tooling/all-clear.json`):

| Changes | What |
|---|---|
| 16 | **The weekday closers** — fourteen 16:25s move in place to 15:45, one closer is made on line 15's Monday off, and line 21's Monday closer becomes a rest day |
| 12 | **The ticket office's pairs** — 06:20–14:20 and 14:00–22:30 every weekday, 06:20–14:50 and 14:30–22:00 on Saturday, the second Sunday late to 22:30 |
| 8 | **The contract and the rest pattern** — seven duties become rest days and one rest day a duty (line 23's Saturday, a closer) |
| 5 | **Friday and Saturday retimes** — for Saturday's five after 22:00, and start times that no longer jump two hours inside a block |

**Against *Just Enough* and *Fifteen Turns*:** all 11 rules (11 · 5), three hard limits met (met · two broken), **no
fatigue finding** (three · seven), shortest rest 14h05 (14h05 · 11h15), two weekends off (two · two), longest run 9
(9 · 9), 10 of 20 weeks on one shift time (9 · 12), 16 shift times (15 · 15), floor fit **42.1 · 37.8 · 77.5**
(*Just Enough* 34.3 · 51.4 · 34.9; *Fifteen Turns* 38.4 · 44.8 · 49.0). **The price is Sunday**: clearing the findings moves line 9's Sunday
10:00–18:30 off and puts a 14:00–22:30 on line 5, so Sunday's floor follows the trains less closely than *Fifteen
Turns*' and than today's link (71.7). Saturday improves; the weekday is a little worse than either.

**How it was chosen among the 41-change versions:** the *Just Enough* order, run 30 minutes then 15 a stage (a container
restart cut the first run after two stages; `tiebreak.py` now takes `FIXED=` to resume): the most weekends off (at
least one fixed; two found), the smallest changes (17,770), the lightest busiest seven days (54h30), the shortest run (9)
and the most one-turn weeks (10). **Only the 41 and the 0 are proven**; every tie-break figure here is the best found
in the time given — the solver's bounds were not closed.

**Reproduce it** (from `tooling/exact/`):

```
python3 fewest.py 0 3600 front-f0.json zero.json         # 0 factors: 41 changes, proven (as for Just Enough, above)
python3 tiebreak.py 41 0 all-clear.json 1800 zero.json wk,size,h,run,one
cd .. && node regenerate.mjs --only=AC
```

## The Running Repair family — Weekday Lates, retimed so its fits compete with the best (29 Sep 2026)

The owner's brief, in three steps on the same day. **First:** take *Weekday Lates* (`WL-24-EXT`) and make the fewest
changes that meet every December rule, with three rules waived for this family only — **weekday closers may start at
16:25** as well as 15:45, **twelve on a Saturday** instead of fourteen, and **the cover weeks anywhere so long as no two are
side by side** (the even-spacing rule waived; the owner called it "a wildcard set") — no more than Weekday Lates' 18 shift
times, one version with no more than four tiring patterns and one with none. **Second**, on seeing the answer (11 changes,
but a Sunday fit of 112): *"increase the number of changes to hit a lower Sunday figure."* **Third:** *"the fit scores need
to be competitive with the top proposals."* So the family's aim became: **floor fit level with Right Away and Familiar
Nine on every day, in the fewest changes that allow it.**

**Why the fewest changes alone could not do it.** At 11 changes every Sunday cell the rules force is already spent on the
ticket office's pairs, so 112 is the best Sunday there is (proven, `exact/fitstage.py` with every Sunday line-up
tabulated). The shift-time pool mattered too: the exact solver had been given Fifteen Turns', Weekday Lates' and today's
times, and none of the Saturday times that make the best sheets fit; with them (`WIDE=1` — every time any sheet in the
folder uses, still at most 18 in the week) Saturday can follow the trains as closely as anything in the folder.

**How it was made — three stages, each reproducible from `tooling/exact/`:**

1. **The duty mix.** `mixsa.mjs` searches how many of each shift time every day carries, from Running Repair's first
   answer, for the fewest cells that must change so that the floor fit is at most **27 on a weekday, 15 on a Saturday and
   27 on a Sunday** — Right Away's and Familiar Nine's level — with every day's December rows passing, Monday to Saturday
   exactly 42,000 minutes (each move is paired with one that keeps the contract exact) and no more than 18 times.
   `dayfast.mjs` scores a day the way the sheets do; `check_dayfast.mjs` checks it against `report-data.mjs` on random grids
   (300 of 300 agree). Three seeds; the best mix needed **32 edits** and fits **27.0 · 12.3 · 26.4** (`rr-mix.json`).
   Looser targets cost less: Pinned Turns' level (36 · 22 · 40) takes 16 edits, 30 · 20 · 30 takes 23.
2. **The rota for that mix.** `tiebreak.py` with `MIX=rr-mix.json` builds the grid in the fewest cell changes that give
   that mix and meet every rule: **34** with at most four tiring patterns, **49** with none — both proven for the mix (the
   other two seeds' mixes need 35 and 36, 50 and 52).
3. **The tie-break**, every stage proven: fewest tiring patterns, shift times, longest run, most weekends off, **fewest
   single rest days and six-day weeks** (two stages added for this family — the two shapes page 1 flags against today),
   the lightest busiest seven days, fewest start-time jumps and early blocks without rest, the smallest changes, the most
   one-turn weeks.

**Running Repair** `RR-24-M34 · 621165eb` — 34 changes (27 retimes, 5 rest days become duties, 2 duties become rest
days); floor fit **27.0 · 12.3 · 26.4** (Right Away 26.5 · 14.6 · 26.4; Weekday Lates 40.4 · 20.7 · 69.0); 9 of 11 rules
met and the other two waived (the cover weeks stay at 1, 7, 12, 17, and the closers at 16:25 — Saturday has 14, so that
waiver is not used); four tiring patterns (FF8b, FF11, MRSF55, FF19; Weekday Lates has five); shortest rest 12h20,
longest run 9, five weekends off, 8 single rest days, 6 six-day weeks, 4 one-turn weeks, 18 shift times of which 10 are
worked today.

**Full Overhaul** `FO-24-M49 · bb9b6c24` — the same duty mix, so the same floor fit, **27.0 · 12.3 · 26.4**, built with
**no tiring pattern at all**: 49 changes, proven the fewest for the mix. 9 of 11 rules met and the other two waived, as
Running Repair; shortest rest 13h00, longest run 8, three weekends off, 11 single rest days, 5 six-day weeks, 5 one-turn
weeks, 18 shift times of which 10 are worked today. Its tie-break was run 10 minutes a stage: the shift times, the
start-time jumps and the early blocks are proven (18, none, none); the run, weekends, single rest days, six-day weeks,
busiest seven days, size of the changes and one-turn weeks are the best found in that time.

**What is not proven.** The duty mix is the best of three seeded searches, not a proof: a mix needing fewer edits may
exist. The changes for the mix are proven for both sheets; Running Repair's tie-break is proven at every stage, Full
Overhaul's at the stages named above.

**Reproduce it** (from `tooling/exact/`):

```
E="BASE=../../Weekday-Lates-WL-24-EXT.json SPARES=1,7,12,17 CLOSERS=15:45-23:55,16:25-23:55 SATMIN=12 TMAX=18 WIDE=1"
env $E python3 mixspec.py                                                   # wl-spec.json
START=rr-final.json node mixsa.mjs 27 15 27 300000 1 rr-mix.json           # the duty mix (rr-final: the 11-change answer)
env $E MIX=rr-mix.json python3 tiebreak.py 34 4 rr3-final.json 300 rr-final.json factors,times,run,wk,singles,six,h,jumps,ff8,size,one
env $E MIX=rr-mix.json python3 tiebreak.py 49 0 fo3-final.json 600 rr3-final.json times,run,wk,singles,six,h,jumps,ff8,size,one
cd .. && node regenerate.mjs --only=FO   # Running Repair's sheet was withdrawn 30 Sep: restore its SUPPLIED entry to re-render it
```

## Clean Sweep — Polished Clean with the fewest changes, its 16:25 closers kept (28 Sep 2026)

`CS-24-M34 · 92366924`. The owner's brief, on *Polished Clean* (`PC-24-EXT`, supplied the same day as a one-page Word
table): make it a sheet, then give it the *Just Enough* treatment — **the fewest changes that meet the rules, then the
fewest fatigue findings** — with one allowance: **the weekday closers may stay at 16:25** (the closer rule accepts
15:45–23:55 or 16:25–23:55). So the sheet shows **10 of 11** rules: the one it does not meet is the 15:45 closer, by the
owner's choice, and page 1 and page 7 say so (`waived` in `clean-sweep.meta.json`). *Polished Clean* as drawn meets 2.

**The answer: 34 changes, and no fewer is possible.** Almost all of it is the cover weeks. The rules need them evenly
spread — every six lines — and *Polished Clean* has them at 1, 7, 12 and 17. There are six even spacings; the solver
was run on each, and once with the cover weeks where drawn:

| Cover weeks at | Fewest changes |
|---|---|
| **1, 7, 13, 19** | **34 — proven** (this proposal) |
| 6, 12, 18, 24 | 45 |
| 5, 11, 17, 23 | 47 |
| 3, 9, 15, 21 | 58 |
| 2, 8, 14, 20 · 4, 10, 16, 22 | 59 |
| 1, 7, 12, 17 (as drawn — the cover rule then fails) | 12 |

So the even spread costs 22 of the 34, because a cover week that moves takes its line's seven days with it: lines
12, 13, 17 and 19 change completely, and the solver used those four lines to give the ticket office its early and
late pairs every day. The other **6**: lines 16 and 20 work Saturday lates where they had a rest day (Saturday's 13th
and 14th people — line 20 the office's 14:30–22:00, line 16 a 14:30–23:25 that keeps five on after 22:00); line
24's Saturday opener becomes the office's 06:20–14:50; line 3's Sunday becomes a 07:15 opener (four at Sunday's
open); and line 18's Monday and Tuesday become the office's 06:20–14:20 and a rest day, which keeps the contract
exact. **Nine lines change**; the other fifteen are exactly as drawn.

**Fatigue findings: three, proven the fewest at 34** — FF8b (early blocks without two rest days after), FF15 (more
than four earlies in a row, in the worst case of a cover week) and FF19 (start times jumping over two hours inside a
working block), all already in *Polished Clean* (which also has FF11). The choice among the 34-change, 3-finding
versions was made in the *Just Enough* order: most weekends off (**2**, as drawn — proven), smallest changes (proven),
fewest two-hour jumps (8), fewest early blocks without rest (6, proven), the lightest busiest seven days (at most 50h30 in any seven — proven), the
shortest longest run (**9**, proven given the choices above) and the most one-turn weeks (6).

**Against *Polished Clean*:** 10 rules (2), three hard limits met (met), three findings (four), shortest rest 13h50
(13h50), two weekends off (two), longest run 9 (9), floor fit **34.6 · 40.0 · 53.5** (38.7 · 51.4 · 72.4) — better on
every day — 14 on a Saturday and 10 on a Sunday (12 and 10), the office rostered in pairs every day (no day), 18 shift
times (19).

**Reproduce it** (from `tooling/exact/`):

```
python3 pc.py 1800 0,1,2,3,4,5,asdrawn        # the fewest changes for each spacing of the cover weeks
python3 pcf.py 34 1,7,13,19 1800 pc-0.json pc-34-minf.json      # the fewest findings at 34 changes: 3, proven
BASE=../../Polished-Clean-PC-24-EXT.json SPARES=1,7,13,19 CLOSERS=15:45-23:55,16:25-23:55 \
  python3 tiebreak.py 34 3 clean-sweep.json 600 pc-34-minf.json wk,size,jumps,ff8,h,run,one
cd .. && node regenerate.mjs --only=CS
```

The shipped grid is `tooling/clean-sweep.json`; exact ties can resolve differently with four solver threads.

## An external review, the exact fit, and the settled fatigue definitions (28 Sep 2026)

An outside reviewer read the v24.36 pack end to end. Each point was checked against the code before it was acted
on; the ones that held were adopted, and the one that no longer held was not.

**Adopted.**

- **The demand fit counts the trains inside the window, exactly.** The first and last hour of a day used to take
  the hour's carriage total *pro rata* — Sunday's 23:00 hour counted 25/60 of all its traffic because the window
  closes at 23:25. Every movement is known to the minute, and the edges are where designs differ, so each hour now
  counts only the movements inside the staffed window (`dayFit`, `report-data.mjs`). Middle hours are unchanged;
  Sunday moved most. The reviewer's own recomputation — *Right Away* 26.5 · 14.6 · 28.9, *Familiar Nine*
  27.7 · 15.0 · 31.3, today 52.0 · 65.9 · 71.7 — is now what the sheets print, to the decimal. **No finalist changed
  places**; the current-figures table (in *The ticket office's second person on the floor*, above) is restated on
  this measure.
- **Headcounts count who is on duty at that moment**, not whose shift is *spelled* 06:20 or 23:55: a 06:15 start is
  present at the open, a 16:00–00:05 is present at the close. No shipped design moved, since all of them keep to the
  window; it stops a future import being under-counted by its spelling.
- **"23" where there were 24 sheets** — the stale counts in the README and a tooling comment are corrected, and the
  counts elsewhere are computed.
- **The README's Right Away figures** were the fit it was *built* against (office off the floor, the old edges);
  the table row now gives the current figures and says which is which.
- **"0 design-specific fatigue findings, plus 2 standing factors"**, not "0 factors". See FF18, below.
- **"11 of 11 current working rules"**, not "December 2026 rules met": the rules were given verbally and were not
  yet in writing, and the sheets said so where the count appears. *(29 Sep 2026: the owner confirmed the staffing
  levels, the 24-person link and the Sunday cover verbally; the sheets and the rules sheet now say "confirmed
  verbally", and the rules sheet no longer lists getting them in writing as an open question.)*
- **The Sunday caveat on page 1** — adopted, then withdrawn the same day, because the owner **settled the question**:
  **no duty runs past 23:25 on a Sunday; that is agreed practice and will remain so** (28 Sep 2026). The five later
  movements (the last at 23:54) are now stated as a settled fact beside the Sunday figures and on the rules sheet, not
  as an open question, and no sheet carries the amber chip. Nothing re-solves: every design already stops at 23:25.
- **Page 9 is grouped by rules met, then fewest fatigue findings, then alphabetical** — it never claimed to rank by
  fit, and now says so, so nobody reads a fit ranking into the order.

**Not adopted: "FF17's definition is pending."** It was, when the pack was written; it is not now. The ORR's
*Managing rail staff fatigue* (Aug 2024) states it at 7.67–7.68: rotation should run forward (earlies → lates),
not backward. That is exactly what `links-fatigue.js` measures, so FF17 is settled and carries no flag.

**The fatigue definitions, settled with the owner the same day** (`links-fatigue.js`, rules sheet page 2):

| Factor | Reading | Source |
|---|---|---|
| MRSF 7×8h | "an 8h shift" is **eight hours or more** | The ORR lists "more than 7 consecutive 8h shifts" (7.65) but does not define 8h; the owner's decision |
| FF17 backward rotation | forward rotation is the good practice | ORR 7.67–7.68 — settled |
| FF18 rotating about weekly | the ORR's cadence reading: a rotation that changes shift type about once a week | ORR 7.68 — settled, and **standing** (below) |
| FF19 start times varying over 2h | **a rest day resets** the comparison | The owner's reading. The ORR speaks of successive start times varying by more than two hours and of avoiding consecutive duties with large variations (7.71), but does not say whether a rest day breaks the succession; if it does not, every link has FF19. **The one definition still flagged to confirm** |

**FF18 is a standing factor, recorded and not counted** (owner, 28 Sep 2026). The ORR prefers a two-day or a
three-week rotation to one that changes about once a week (7.68). Every weekly link does that by construction —
today's included — so FF18 would be "present" in every proposal and could never tell two designs apart. It is now
treated as FF2 always was (every 06:20 open is an early start): **shown on page 8 of every sheet with a one-line
explainer, marked ● standing, and left out of the count** on pages 1, 2, 3 and 9 and in the folder ranking. The
rules sheet says the same beside both rows. A design is never credited for "clearing" a factor no weekly link can
clear, and never charged for one it cannot avoid.

## The shape of a sheet — headline, how to read it, then the depth (25 Sep 2026)

*(Superseded 28 Sep 2026: page 1's tiles, the "x of 4" December shape, the lineage on page 9 and the method
pages belong to the 25 Sep sheets. The sheets as they are now: The managers' edition, below.)*

The owner's brief for the format: *headline analysis, deep analysis, but for dummies.* Ten pages now,
in three layers a reader can stop after at any point:

1. **Page 1 — the answer.** Five questions in the order a manager asks them, each a tile with the
   figure, today's beside it and the folder's best: *Can it be run?* (the hard limits) · *Does it meet
   the December shape?* (headcount rules met, x of 4) · *How tiring is it?* (factors present, advisory)
   · *Does it follow the trains?* (the demand fit) · *Is it familiar?* (times worked today). Then the
   secondary tiles, "What this is" and "What it is not". The lineage moved to page 9.
2. **Page 2 — how to read the numbers.** One block per figure: what it measures in a sentence, how
   it is built, **a drawn scale with this sheet, today's link and the best and worst of the other
   sheets marked on it**, what it does not tell you, and where on the sheet it appears. The anchors
   are computed at render time from the shipped rotations (`folderStats()` in `report-data.mjs`), so
   "best in the folder" is a fact that moves when a sheet lands, never a claim typed on the day. The
   fatigue scale is deliberately neutral — never red or green — because the ORR list reports what is
   present and does not pass or fail a design.
3. **Pages 3 to 10 — the depth**, as before: the decision frame, the grid, the week and duty table,
   cover by the hour, the checks, the fatigue factors, the method and the paste block. Every cross-
   reference in the sheets and in this file moved by one page.

## A recomputation of every sheet (25 Sep 2026)

A reviewer recomputed the sheets from the shipped JSON. Every claim below was re-checked before anything
changed; each fix is in the generator, not the PDF; all 22 sheets were re-rendered; no fingerprint moved.

- **Today's weekday fit was wrong on every sheet, and it was the figure every proposal is read against.**
  Both renderers padded the 20-line link to 24 lines by repeating lines 1–4 — five cover weeks, and four
  working weeks counted twice — and scored that: **44.7**. The link itself scores **51.1**, on the same
  definition as every proposal's *Wk fit*: the fit of the AVERAGE Monday-to-Friday cover (not Tuesday alone,
  and not a mean of five daily fits). *Pinned Turns*' page 7 printed a third figure, Tuesday alone (50.0).
  There is now one: `wkFit` in `assess()`, the rotation's own lines, for today and for every design. The
  consequence is the one worth reading: on weekdays **20 of the 22 proposals follow the trains more closely
  than today's link**, among them *Same Turns* (46.3), *Quarter To* (46.2) and *Weekend Capped* (46.2), which
  the padded figure had reading as worse than today. The two exceptions are *Eight Forty* (70.4) and *Office
  Written In* (67.9), worse than today on either figure.
  Same Turns' method page now words its comparison from the figures ("more evenly than today's roster").
- **Page 1 said "It clears every rule the tool can check" on every sheet**, *Fifteen Turns* included, whose
  own tile says *Not as it stands*. The sentence is derived now, and names what fails (one rest under 12
  hours, 60 minutes over the contract). Page 7's contract row was a hardcoded tick on the same sheet; it is
  derived from minutes too, and `contractExact` no longer uses a rounded-hours tolerance.
- **"Saturday is the best table in the folder"** (*Office Written In*) was typed and false — *By the Book*'s
  Saturday is 8.112 against 8.117. The sentence is computed from the folder and says "level with".
- ***Eight Forty*'s Saturday was quoted at 16.4** on *Office Written In*'s page 7 and here; its own sheet says
  16.2. `table-book.mjs` wrote its SEARCH objective — Saturday 17:00–22:00 weighted 1.25× for events — into
  the record's `fit`. It now writes the shared measure as `fit` and the weighted one as `searchFit`, the
  committed `eight-forty-table.json` was recomputed from its own slots the same way (the weighted figures
  reproduce the old ones exactly, which is the check), and *Office Written In* reads *Eight Forty*'s fits from
  its cells.
- **"One of the two cases for keeping today's times"** — there are three (*Same Turns*, *Quarter To*,
  *Weekend Capped*). Page 3 counts them from the folder, and each comparator's reason is a property it has
  rather than "the strongest case": *Quarter To* is the only one of the three with no factor present; *By
  the Book* is the rules-first sheet whose weekday follows the trains most closely.
- **The folder anchors on page 2 counted *Weeks 17-18 Swapped* among "the other sheets"**: names read back
  from filenames lose the hyphen. Matched by code now.
- **"4 weekends in 20; a 24-line link with six is the same one weekend in four"** — 4 in 20 is one in five.
  Computed now.
- **The fit explanation** said a score near 25 means about one percentage point per hour. The score is a sum
  over the day's 18 hours, so the typical hourly gap is √(score ÷ 18): about 1.2 points at 25. Page 2 now
  states that rule and applies it to this sheet and today's link.
- README corrections from the same pass: *Office Written In*'s distinct turns (12 and 9, not 11 and 8), *Pinned
  Turns*' off-quarter turns and where they came from, *Weekend Capped*'s seeds (seed 34 carries two factors),
  *Round Times*'s capped Saturday count (a bounded run), its `MAX_TURNS=7` reproduction, and what
  `regenerate.mjs --check` checks.

## Files

| File | Use |
|---|---|
| `<Name>-<code>-<fingerprint>.pdf` | the proposal, 8 pages A4 (the plain edition) — **force-added** (`git add -f`), because `.gitignore` ignores every `*.pdf` in the tree |
| `<Name>-<code>-import.txt` | line number then Sunday–Saturday, tab-separated — paste into **Links → Import** |
| `<Name>-<code>.json` | the same rotation in the app's own `{ name, patterns }` shape — also importable |
| `December-2026-Rules.pdf` | **the rules on their own** (28 Sep 2026), two pages A4, force-added like the sheets: the three hard limits, the nine soft December 2026 rules the sheets score and the three flexible rules, with what each asks exactly, today's link against each and how many of the proposals meet it, the fatigue factors with how many proposals each is present in, the preferences, and the questions still open. Rendered by `tooling/rules-sheet.mjs` from `currentRules`, `assessFatigue` and `folderStats` — the code the sheets use — and by every full `regenerate.mjs` run, so it cannot drift from them |

Every import form is verified against `links-import.js` (24 lines, no warnings). Importing one
makes the workspace's Design checks, hard limits, fatigue factors and coverage cards restate those
figures from its PDF. The demand fits, the ticket office / floor split and the rule count are
not in the workspace; they come only from `tooling/report-data.mjs`.

## The managers' edition (28 Sep 2026)

*(Superseded 29 Sep 2026 by the plain edition — eight pages, compared with today's link only; see the top of this file. Kept as the record of how the ten-page sheet was built and checked.)*

The managers have seen none of these proposals, and meet all 28 at once. So every sheet is now written for a
first-time reader: it answers **one question** — *is this better than today's link, and does it meet the December
2026 rules?* — against **one rule set**, in plain English, with no reference to how it was derived, which brief it
answered or which sheet came before it. **No figure changed**; the words around them did.

- **One rule set: eleven rows to design to — nine soft rules scored on the sheets and three flexible rules (Saturday and Sunday share one row, so 9 + 3 makes eleven rows), since 30 Sep 2026** (`currentRules` and `sheetRules`, `tooling/report-data.mjs`), read from each design's cells: at
  least four at the open, three at the close and five at 22:00 on every day; 10 on a Sunday; the ticket office
  as two early and two late identical turns every day; at least two on the floor at every moment; 15-minute
  handovers (20 in the office); Sunday duties 8h–9h; no more shift times than today. Five of the ten sheets meet
  all nine; today's link meets 4. (The design set also holds 14 on a Saturday, four evenly spread cover
  weeks and a 15:45 start for every weekday closer; the flexible rules — designed to, never on a proposal sheet; see the note near the top.)
- **The 22:00 rule, confirmed by the owner (28 Sep 2026):** somebody finishing **at** 22:00 does **not** count
  towards the five — only people still on duty after 22:00 do — and the rule applies **every day, Sunday
  included**. Both are how every sheet already checked it, so no figure moved. (The 22 Sep reading earlier in
  this file, where a pinned 22:00 finish counted, is superseded.)
- **The floor comes first.** Page 1's "Does it follow the trains?" and page 2's scale measure how the people on
  the floor — ticket office out — follow the trains; the everyone-on-duty figure sits beside it.
- **Page 1** carries an *At a glance* table, today's link against the proposal, which is also the headline set
  for the PowerPoint on each shortlisted design.
- **Page 7** shades every rule not met; *Still to settle* is a short list.
- **Page 9** is *Where it stands among the N* (the folder's count, computed at render): every proposal on the same figures, today's link at the foot.
- **Plain English**: no "cells" (page 10 says "days", page 6 "square"); "turn" only on page 4, beside the
  glossary that defines it (the grid's Turns column and its legend), in "one-turn week", and in the plain
  phrase "every line in turn" (the duty table's header reads "Shift time", the office rule "identical
  shifts"); no "evidence class C", "citation outstanding", "RDW", "proxy", "folder" or "owner"; the fit is explained as *an hour that carries a tenth of the trains should have
  about a tenth of the staff*.

- **A review pass over all 230 pages** (five readers, one per group of sheets) then fixed what a first-time
  reader trips on: page 1's *At a glance* shades better cells green and worse amber; page 5's duty table labels
  its two halves *Today's link* and *Proposed*; page 7 shows today's link beside the proposal on every rule;
  times read "8h 10m", never "8.17h"; "early" and "late" are defined at 11:00 everywhere except FF2 and
  FF15, which use the ORR's 05:00–07:00 early start; and no sheet says how
  it was made — neither "found by computer search" nor "drawn by hand".
- **An accuracy check** (28 Sep 2026) recounted every sheet from its rota with code written separately from the
  renderer: the page-1 and page-9 figures, every grid cell, colour and total on page 4, every duty-table row
  on page 5, every hour-by-hour row on page 6, the rule values on page 7 and the page-10 paste block. It also
  read every hand-written claim. The figures were right. The words around them were not always: the
  rules-not-met chip was nested in the fatigue chip, page 3 quoted the December Saturday/Sunday rule (on the 14 sheets
  short of 14 and 10) with
  the design's own counts, "does not depend on how a cover week is placed" was untrue on nine sheets (*Cover
  at Seventeen*, *Fifteen Turns*, *Light Retime*, *Saturday Four*, *Short Closer*, *Targeted Fatigue Redo*,
  *Three Mondays*, *Weekday Lates* and *Weeks 17-18 Swapped*, whose longest run falls from 9 to between 6 and
  8 with the placement), six straps misdescribed their rota and were rewritten (*Frozen Block*, *Gates
  Mended*, *Office Written In*, *Pinned Turns*, *Quarter To*, *Targeted Fatigue Redo*; a second check
  rewrote two more, *Light Retime* and *Three Mondays*), and nothing mentioned Saturday Four's half-hour with one person on duty
  (now a "thin moment" line on page 7, raised automatically for any day that drops below three).
- **A second accuracy check** (28 Sep 2026) read all 23 sheets again with fresh readers and different
  groupings, and checked this README, `docs/LINKS_DEC2026_PLAN.md` and the one-line descriptions. The
  figures still recounted clean. It found and fixed:
  - **The handover rule was scored unevenly.** A design with ticket-office pairs on two days passed on
    those two alone, while one with none failed. The office overlap is now measured the way the floor is
    — the rostered pairs where a design has them, the plan's posts where it does not — and the value says
    when posts are assumed. *Fifteen Turns*, *Gates Mended* and *Weekend Capped* each meet one more rule;
    none meets fewer.
  - **Page 8 said cover-week placement changed nothing** on sheets where it moves the run, the 8-hour run
    or FF15; it now names each such row with its "placed well" figure, and page 3 does the same.
  - **One-turn weeks and "mixing early and late"** now use the same 11:00 split, so a week can no
    longer count as both.
  - **Page 10 claimed the app shows the fingerprint** and restates every figure. It shows neither the
    fingerprint nor the fits, the office/floor split or the rules count, which come from `tooling/`.
  - **"The ORR lists 25"** — it is 21 ORR factors and 4 rail-industry (MRSF) checks.
  - Smaller: page 5's office row now says on which days the pairs are rostered; the *At a glance* fit row
    is shaded only when all three days agree; page 3 names a weekday or Saturday floor fit worse than
    today's, not only Sunday's; *Eight Forty* and *Office Written In*'s long duty tables are split in two
    so they no longer run under the footer; two more one-line descriptions (*Light Retime*, *Three
    Mondays*) now describe their own rota.
- **Family and first-created date** sit in the identity panel on page 1 (`FAMILY` and `FIRST` in `fresh.mjs`) —
  deliberately small, as a finding aid when presenting, not a history.

Everything lives in `tooling/fresh.mjs` — a one-line description per design (what it *is*), the page words built
from its figures, and a last plain-English pass over the finished page. `LEGACY=1 node regenerate.mjs` renders
the previous edition.

**Checks before shipping**, all run for this edition: `node regenerate.mjs --check` (23 fingerprints unchanged at the time; it checks every registered sheet, and prints the count);
every PDF exactly ten pages with its footers in order; a text scan of every page except page 9 for history and
jargon words, which finds none.

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
mv best-[A-Z]*.json results/               # after EVERY anneal.mjs run below too: it writes best-*.json to the current directory, and final.mjs and regenerate.mjs read results/
PROPOSAL=ST node final.mjs results/best-A-*.json results/best-B-*.json           # pick, assess, render
PROPOSAL=BB EXTRA=results/best-RDpure-21.json node final.mjs results/best-RD-*.json
PROPOSAL=QT node final.mjs results/best-Q-*.json results/best-R-*.json
PROPOSAL=EF node final.mjs results/best-RE-*.json
node wl4-run.mjs                      # Anchored Lines: all four placements of the 14-17 block x 3 seeds (12 runs)
RULES=1 LINES_ONLY=1 node optimise.mjs <design>.json 20000 2 7   # reorder WHOLE WEEKS only, fatigue-first (Tenth Sunday)
node supplied.mjs <design>.json "<Name>" "<strap>" <CODE>   # render a SUPPLIED or DERIVED design (no search to describe)
node shots.mjs <rendered>.html       # A4 page screenshots + a height check against the printable page
CAP=520 PIN_N=2 PIN_MIN=1020 PIN="14:00-22:30x2" AT22_FLOOR=1 CLS=sat node place-structures.mjs
                                     # a day table by placing EVERY enumerated length structure (Office Written In)
CAP=520 PIN_N=2 PIN_MIN=1020 PIN="14:00-22:30x2" AT22_FLOOR=1 CLS=sat PICK=share SHARE=b2-weekday.json node place-structures.mjs
                                     # the same Saturday, preferring turns the weekday already works ("fewer shift times")
AT22_FLOOR=1 node assemble-table.mjs by-the-book-2-table.json b2-weekday.json b2-sat.json b2-sun.json
MODE=rules node anneal.mjs G 100000 5 7    # Office Written In family: table G, seeds 7 13 21 34
PROPOSAL=B2 node final.mjs results/best-RG-*.json
CLS=sat node weekend-table.mjs > q2-sat.txt; CLS=sun node weekend-table.mjs > q2-sun.txt
                                     # Weekend Capped: Saturday and Sunday searched again under the cap, in Quarter To's spirit
                                     # (the JSON line at the end of each is the day file; ALLOW_TODAY_ENDS=1 admits today's 22:00 Saturday finish)
PINS=none CAP=520 node assemble-table.mjs quarter-to-2-table.json q2-weekday.json q2-sat.json q2-sun.json
MODE=feel  node anneal.mjs W 100000 5 7    # Weekend Capped family: table W, seeds 7 13 21 34 41 55 68 89
PROPOSAL=Q2 node final.mjs results/best-W-*.json
CLS=weekday TOTAL=6970 FINE=1 node brief-table.mjs   # Pinned Turns (the shipped weekday, pt-weekday.txt): a day to the owner's 25 Sep brief, the rest fitted (CLS=sat TOTAL=42000-5W; CLS=sun)
                                     # the split W is swept 6,945..7,050 with MS=15000 EXHAUSTIVE=0 and picked by 5 x weekday fit + Saturday fit
PIN_WK="06:20-14:20x3,14:00-22:30x2,15:45-23:55x3" PIN_SAT="14:00-22:30x1" PIN_SUN="13:00-21:30x1" CAP=520 node assemble-table.mjs pinned-turns-table.json pt-weekday.json pt-sat.json pt-sun.json
MODE=rules node anneal.mjs P 100000 5 7    # Pinned Turns: table P in BOTH modes (MODE=feel too), seeds 7 13 21 34; the mode with fewer factors is kept
PROPOSAL=PT node final.mjs results/best-RP-*.json   # or best-P-*.json if like-today carried fewer factors
CLS=weekday TOTAL=6970 node quarter-table.mjs   # Round Times: the same pins, every other time on the quarter hour, enumerated to a proof
                                     # (CLS=sat TOTAL=7150 MAX_TURNS=7 — without the cap it returns the nine-turn 21.3; CLS=sun TOTAL_MIN=5100 TOTAL_MAX=5145; BOUND=0 counts every feasible table; the JSON line is the day file)
PIN_WK="06:20-14:20x3,14:00-22:30x2,15:45-23:55x3" PIN_SAT="14:00-22:30x1" PIN_SUN="13:00-21:30x1" CAP=520 COUNTS_JSON=… EXTRA_JSON=… node assemble-table.mjs pinned-turns-2-table.json p2-weekday.json p2-sat.json p2-sun.json
MODE=rules node anneal.mjs N 100000 5 7    # Round Times: table N in BOTH modes (MODE=feel too), seeds 7 13 21 34, as P
PROPOSAL=P2 node final.mjs results/best-RN-*.json
H="TO_EARLY_HELP=0 TO_LATE_HELP=1440 TO_LATE_SHARE=0"   # Right Away: the ticket office kept entirely off the floor (the default now lends it at the quiet ends)
env $H CLS=weekday TOTAL=6970 MAX_TURNS=8 BEST0=20.5 OUT=fr-weekday.json node final-table.mjs   # the owner's final rules, the floor fitted, enumerated to a proof (~22 min, 33.2 million tables; BEST0 seeds the bound)
env $H CLS=sat TOTAL=7150 MAX_TURNS=6 OUT=fr-sat.json node final-table.mjs   # ~16s; CLS=sun MAX_TURNS=6 OUT=fr-sun.json ~5s (Sunday's total is searched, 4,800–5,300); ANNEAL=1 for a fast sweep of W
CAP=570 PIN_WK="06:20-14:20x2,14:00-22:30x2" PIN_SAT="06:20-14:50x2,14:30-22:00x2" PIN_SUN="07:15-15:30x2,13:30-22:30x2" AT22_FLOOR=1 node assemble-table.mjs final-rules-table.json fr-weekday.json fr-sat.json fr-sun.json
MODE=rules node anneal.mjs F 100000 5 7    # Right Away: table F, fatigue-first, seeds 7 13 21 34
MODE=rules node order-polish.mjs results/best-RF-34.json results/best-RF-34o.json 1 60000 34o   # Right Away's week order improved from seed 34 (be01f0db); MODE must match
PROPOSAL=FR node final.mjs results/best-RF-*.json
CAP=510 COUNT=1 node table-book.mjs  # how many length structures a cap admits, WITHOUT searching -- a zero is a proof
node regenerate.mjs --check           # every proposal's shipped JSON (and a supplied design's source grid) fingerprinted, without rendering
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
*Office Written In* sits at 8h40.

`regenerate.mjs` holds every proposal's build arguments as data, so a change to `render.mjs` or
`report-data.mjs` can be applied to all of them with one command. It was written because the twelve
build commands existed only in shell history and a README block covering four of them, and the other
eight had to be recovered by reading the name and strap back out of the rendered HTML — which works
until somebody deletes an HTML file. It refuses to finish if a fingerprint moves: the same grid in
must give the same eight hex characters out, because a proposal's identity is its cells and a
printout that has been in a room must go on matching its name. `--check` fingerprints the cells without
rendering: each supplied design's source grid, and every proposal's shipped `<Name>-<CODE>.json`. Until
25 Sep 2026 it printed `ok` for the eight searched proposals after counting their candidate files and
fingerprinting nothing; re-deriving a searched PICK still needs the full run, because `final.mjs` renders.
*(While writing it: `quarter-two.json` and its meta held the FIFTEEN TURNS grid, not Quarter To — a
working name that outlived its design. Renamed to `fifteen-turns.json`; Quarter To is searched and has
no supplied grid.)*

`anneal.mjs` is the search: every move keeps each day's duties exactly as the table says (a swap
between two lines on one day, or two whole lines changing places), so coverage, contract and
headcounts are true by construction and only the shape is searched. `final.mjs` picks by rules
first (rest, run, factors present, weekends off), then weekday demand fit, then the search's own
score; offers the winner to the app's `reorderLines`; and writes the PDF, the import text and the
JSON. A seed reproduces its grid exactly on any machine. `results/` holds the seed outputs every
searched PDF was picked from.

The rendered `.html` files are not committed (they are regenerated by `final.mjs`, and an HTML file
in the repo root's web tree is a served page).

**Served, by the mirror only.** The repo root is the web root. `firebase.json` already ignores
`docs/**`, so nothing in this folder is in the Hosting bundle — but the GitHub Pages mirror serves the
whole tree regardless, `.txt`, `.json`, `.mjs` and PDF alike. Nothing in them is new information (the
base roster is public by the classification in `AUTH_PLAN.md` §2), so this is untidy rather than
unsafe.
