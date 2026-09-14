# AL_WORKBOOK.md — the depot annual-leave workbook

*Started 8 Sep 2026. Not version-stamped; not a runtime asset.*

**Reached by `/al-workbook`**, which is the trigger that should bring you here when the workbook is uploaded or somebody's leave is asked about. The skill holds no knowledge of its own — it exists because §0 was broken twice by sessions that had this file and read it too late.

> ## ⚠️ THIS IS A WORK IN PROGRESS, NOT A SPECIFICATION
>
> **Nothing here is a definitive reading of the workbook.** It is what one session worked out by
> reading the file for an afternoon, and the owner has confirmed almost none of it. Several
> statements below will turn out to be wrong. Treat every one as a starting point to be checked
> against the file in front of you, never as a fact you can quote back.
>
> **It is meant to get better every time the workbook is uploaded.** The owner uploads it into a
> session, asks questions of it, and the answers to those questions are what turns an
> `[inferred]` into a `[measured]` and closes an open question. **That improvement only happens if
> the session does it** — so:
>
> - **Ask.** When something does not add up, or an assumption is load-bearing and unconfirmed,
>   put the question to the owner rather than picking the likelier reading and moving on.
> - **Point things out.** A duplicate row, a person in one system and not the other, a figure that
>   changed since last time — say so, even when it was not what was asked.
> - **Write it back HERE, in the same session.** An answer that stays in the chat is lost; the
>   next session re-asks it. Update the section, strike the open question, move the marker.
> - **Record what changed** in §12, so the owner can see the understanding growing.

**Evidence markers, used on every claim:** **[measured]** = read out of the file this session or a
previous one. **[inferred]** = the best reading of measured facts, and NOT confirmed by the owner.
**[unknown]** = neither, and stated as unknown rather than guessed.

---

## 0 · THE RULE THAT MUST NOT BE GOT WRONG

**When asked for a person's annual leave, the over-quota days are part of the answer.**

A day recorded in the `AL over depot quota` column is real annual leave. The person is off work, it
is deducted from their entitlement, and it is **invisible in the calendar grid** — so any answer
built only from the grid is short by exactly those days and reads as complete. That has already
happened once (J. Davies, 8 Sep 2026: nineteen days reported where the true figure was twenty, with
Christmas Eve missing from the middle of a block).

So, before answering any question about somebody's leave:

1. **Read their column E first**, not last, and read its threaded comment for the dates (§5, §6).
2. **List the over-quota days alongside the grid days**, in date order, marked as over-quota — never
   as a footnote, and never merely as a total.
3. If column E has a value whose comment cannot be read, or does not name dates, **say so in the
   answer**. An unexplained deduction is a question for the owner, not a rounding error.
4. **Give the days the person is actually away**, marking which ones cost entitlement — Sundays and
   Closed days sit inside blocks and cost nothing, but leaving them out hands the reader a gap that
   does not exist in their life (§4).

---

## 1 · What the workbook actually is

It is **the depot's leave-quota grid**, not a leave register. Chiltern limits how many people may be
off on any one day at any one location, and the workbook's job is to allocate those slots. Counting
how much leave somebody has taken is a *by-product* of that allocation — which is the single most
important thing to understand about it, and the source of every discrepancy in §9.

It covers the whole Chiltern estate (West Midlands, Warwickshire, Oxfordshire, Bi-Ox, South Bucks,
North Bucks and Marylebone). **Only the Marylebone sheets are ours.** [measured]

It is maintained by the roster clerks, not by the app. The threaded comments are signed by
**Howard Croft** and **Charlotte Smith** [measured] — Croft is on the app roster as a Management
account; Smith is not on it at all.

---

## 2 · Which sheets to read — and the decoy

| Sheet | Use it? | What it is |
|---|---|---|
| **`New Marylebone Calendar`** | ✅ **yes** | The 2026 quota grid. Runs 1 Jan 2026 → 2 Jan 2027, one row per date. [measured] |
| **`New Marylebone Totals`** | ✅ **yes** | One row per person: allowance, used, remaining. [measured] |
| `Marylebone Calendar` | ❌ **no** | **A 2021 sheet.** Its dates begin 1 Jan 2021 and it holds people who have long left. It is the single easiest mistake to make in this workbook, because the name looks more canonical than the one you want. [measured] |
| `Marylebone Totals` | ❌ no | The 2021 counterpart. Its over-quota column is headed **"AL over allocation"** — the older wording, and useful corroboration of what the column means. [measured] |
| `Marylebone Block` | ⚠️ barely examined | A per-person Week 1–4 grid, same four-state legend. Purpose still not established [unknown] — but it names each person's LINE in the column beside them (`Boyle . A` → `MYB CSA`) [measured, 14 Sep 2026], and it carries the same duplicate rows the totals sheet does. |
| Every other location's sheets | ❌ no | Other depots. |

---

## 3 · How one person's figure is built

Each row of `New Marylebone Totals` is:

| Col | Header | Source |
|---|---|---|
| A | Role | typed — `CEA` · `BLCEA` · `CES` · `DISP`. **`BLCEA` is the LINE, not the CONTRACT** [measured, 14 Sep 2026]: `Cooper . I` is `BLCEA` here with an allowance of **32**, and the app has them as a plain CEA with `bilingualContract: false` — which agrees. Read as a contract it predicts 34 (CLAUDE.md's bilingual entitlement) and reports a false disagreement against a workbook that is right. A plain CEA is routinely placed on a bilingual line until a CEA one frees up, so this column cannot answer the entitlement question; `bilingualContract` in the app can. **Corroborated across ALL SEVEN `BLCEA` rows, 14 Sep 2026** — five carry an allowance of 32 (Springer, Cooper, Panchal, Miller, Mylla) and two carry 34 (Gherbi, Irvine), and that split matches `bilingualContract` in the app exactly, 7/7. So the workbook and the app agree on who holds the contract; it is the ROLE COLUMN that does not answer the question. |
| B | Name | typed — `Surname . I` (see §7) |
| C | c/f previous year | typed |
| D | AL allowance | typed |
| E | **AL over depot quota** | **typed** — see §5 |
| F | Total | `=C+D` |
| G | Used | `=COUNTIF('New Marylebone Calendar'!<range>,"<name>")` |
| H | Remaining | `=F-(G+E)` |

**The formula that surprises people is H.** Remaining is *not* allowance minus used. Column E is
deducted as well:

```
Remaining = (c/f + allowance) − (days found in the grid + days recorded over quota)
```

**The COUNTIF range differs by grade**, because each grade has its own block of slot columns
[measured]:

| Grade block | Calendar columns | Slots per day |
|---|---|---|
| CEA and Bilingual CEA | **C–F** | 4 |
| CES | **G–H** | 2 |
| Dispatchers | **I–J** | 2 |

Never count a name across the whole sheet — a CES name inside the CEA block would be somebody
else's row, and the reverse would double-count.

---

## 4 · The grid, and the four cell states

Every cell in a grade block is one slot on one date, holding a name or one of four states.
`Available` · `Pending` · `N/A` · `Closed` are listed as a legend at the top of each block.
[measured]

Two states matter when counting:

- **`Closed`** — the slot does not exist that day. Christmas Day and Boxing Day are Closed right
  across every block. [measured]
- **`N/A`** — not bookable. **Sundays are the big one:** Sunday rows carry no slots, and where a
  person's leave block spans a Sunday the clerk writes their name into the cell as free text —
  `N/A J Davies`, `N/A S Silva` — so the block reads continuously on the page. [measured]

**Those free-text Sunday tags are never counted, and must never be counted.** `COUNTIF` looks for
the exact `Surname . I` form, so `N/A J Davies` does not match. That is correct and it agrees with
the app: Sundays are uncontracted, and the app refuses an AL override on one (`SUNDAY_FORBIDDEN_TYPES`
in `override-utils.js`).

**But they still belong in an answer.** When listing somebody's leave, give the days they are
*away*, marking which are deducted — a member reading "27 Jun, then 29 Jun–2 Jul" has been handed a
gap that does not exist in their life. This was got wrong once (8 Sep 2026) and is worth not
repeating.

> **A Sunday tag does not always sit INSIDE a block, and the day is not always a rest day.**
> [measured, 14 Sep 2026] Both halves of the sentence above can fail at once. `Panchal . A` is
> tagged `N/A A Panchal` on **Sun 15 Feb 2026**, which **opens** his absence — the next grid day is
> Mon 16 Feb, and there is nothing before it — and his base roster has him **rostered to work that
> Sunday, 07:15–15:45**. He was away from a real shift.
>
> That is a reconciliation trap pointing the opposite way from the over-quota one. Over-quota days
> are leave the GRID cannot show; this is a day the **APP** cannot show — `SUNDAY_FORBIDDEN_TYPES`
> refuses an AL override on any Sunday, so the app will display a rostered Sunday shift with
> nothing recorded against it while the workbook says the person was off. Neither side is wrong;
> they are answering different questions, and a straight date-for-date comparison will report a
> discrepancy that is not one.
>
> **COMMON, BUT NOT A RULE — and the first version of this note overstated it** [measured,
> 14 Sep 2026]. `Mylla . O` carries three Sunday tags — 11 Jan, 9 Aug, 27 Dec — and all three fall
> on days she was ROSTERED to work, with 11 Jan opening its block exactly as Panchal's 15 Feb does.
> On those four this note said the rostered case was "the ordinary" one and a rest-day tag "the
> variant". `Haque . J`'s four tags then split: **two rostered (11 Jan, 22 Mar), one on a SPARE
> Sunday (15 Mar), one on a rest day (29 Mar)**, and `Okeke . M`'s six split **two rostered (20 Sep, 20 Dec), one spare (4 Oct), three rest
> days**. **Eight of fourteen** measured tags sit on a rostered shift,
> a bare majority that has FALLEN at every new person. Treat the two kinds as roughly equally
> likely and do not guess. The claim has been revised twice in one day — "the ordinary case" (4
> tags) → "a majority" (8) → this (14) — each time forced by the next person looked at. That is
> what a generalisation drawn from one member is worth.
>
> The instruction is unchanged and is the point: **check the base roster every time**, because the
> tag itself tells you nothing about which kind it is — and only the rostered kind is a day the
> member was away from actual work.
>
> So: **do not assume a tagged Sunday is a rest day, and do not assume it is mid-block.** Check the
> base roster. Where the person was rostered, say they were away from a shift and that it cost no
> entitlement — do not silently drop it because the app has no way to hold it.

---

## 5 · "AL over depot quota" — the column that is not in the grid

*These days go in the answer. §0 is the rule; this is the mechanism.*

**What it is [inferred, strongly]:** annual leave that was **granted on a day the quota was already
full**, so there was no slot to write the name in. It is deducted from Remaining without ever
appearing in the calendar.

**Where the dates live — and the trap.** Each column-E value carries a **threaded comment naming the
date(s)**. The comment count matches the value in every case checked. [measured]

> **`openpyxl` DOES show these — the earlier note here was wrong.** [measured, 14 Sep 2026,
> openpyxl 3.1.5] `cell.comment.text` returns Excel's legacy placeholder *and then the body*, as
> `…Learn more: <url>\n\nComment:\n    24/12`, with any replies appended as `Reply:\n    …`.
> Checked against `xl/threadedComments/` for all sixteen column-E comments on the totals sheet: the
> text matches, including the multi-date and reply cases. So a one-liner scan is enough to FIND the
> dates, and §6's XML route is the cross-check rather than the only way in.
>
> The original claim ("returns only the placeholder") is what produced a confident, wrong "there is
> no explanation anywhere in the workbook" on 8 Sep. Keep the lesson, drop the mechanism: **the
> danger was answering without looking, not the library.**

**Worked example — J. Davies, 2026.** Allowance 20, grid days 19, over-quota 1, remaining 0.
Their comment reads `24/12`, and the grid says why:

| Thu 24 Dec 2026 | slot C | D | E | F |
|---|---|---|---|---|
| | Reen . C | Sumali . J | Silva . S | Okeke . M |

All four CEA slots taken. Davies is booked 22 and 23 Dec, then 28 and 29 Dec — Christmas Eve sits in
the middle of one continuous absence and was granted as a fifth person, over quota. Their year is
**20 days: 19 in the grid + 24 Dec.**

**The exception to the pattern.** One value is a lump with no dates: a comment reading
`A/L FROM PRE JUNE 2026` [measured]. So column E is *also* used for a balance carried in from
elsewhere. Read the comment before assuming the value means over-quota days.

**A second worked example, and it corroborates the first.** [measured, 14 Sep 2026] `Cooper . I`'s
comment reads `19/08`. On Wed 19 Aug 2026 the four CEA slots hold Mylla, Gherbi, F-Blackstock and
F-Charles — full, exactly as on Davies's 24 Dec. `F-Charles . C`'s own over-quota day, `24/02`, is
the same shape: Mylla, Irvine, Panchal and Miller hold all four slots. **Three for three**, which is
as close to confirming the `[inferred]` meaning of column E as the file alone can get; it still
wants the owner's word.

**Nothing in the grid marks an over-quota day.** It is only in column E and its comment. Do not go
hunting for a fifth name on a date — there isn't one.

---

## 6 · Reading it mechanically

```python
import openpyxl
wb  = openpyxl.load_workbook(path, data_only=True)   # values
wbf = openpyxl.load_workbook(path)                   # formulas — needed for the COUNTIF ranges
```

Threaded comments (the part `openpyxl` hides):

```python
import glob, zipfile, xml.etree.ElementTree as ET
# unzip 'xl/threadedComments/*' and 'xl/persons/*' out of the .xlsx first
persons = {p.get('id'): p.get('displayName')
           for f in glob.glob('xl/persons/*.xml') for p in ET.parse(f).getroot()}
for fn in glob.glob('xl/threadedComments/*.xml'):
    for c in ET.parse(fn).getroot():
        print(c.get('ref'), persons.get(c.get('personId')), ''.join(c.itertext()).strip())
```

There is one comment file per sheet and they are **not** named after the sheet.

> **SCOPE THEM TO THE SHEET, OR THE WORKBOOK WILL INVENT LEAVE.** [measured, 14 Sep 2026] Reading
> every `threadedComment*.xml` into one dict keyed by cell ref merges all 23 sheets, and the CALENDAR
> sheets carry hundreds of their own comments in the same columns. `E22` then came back as
> `['24/12', '27/02']` — which reads as two over-quota days for J. Davies against a column value of
> **1**, and would have put a day of leave in February that nobody took. Scoped properly,
> `Totals!E22` is `['24/12']` alone; the `27/02` belongs to a calendar sheet.
>
> The reliable mapping is through the relationships, not by guessing from the refs:
> `xl/workbook.xml` + `xl/_rels/workbook.xml.rels` give sheet NAME → `sheetN.xml`, and
> `xl/worksheets/_rels/sheetN.xml.rels` names that sheet's `threadedCommentM.xml`. For this upload
> the totals sheet is `sheet22.xml` → `threadedComment15.xml`, but do not hardcode that — it is a
> property of the file, not of the workbook.

---

## 7 · Names — the workbook's form vs the app's

The workbook writes **`Surname . I`**; the app writes **`I. Surname`**. Match on
(initial, surname), case-insensitively — and know the exceptions, because a naive match silently
drops people.

**Surnames the workbook shortens** [measured]:

| Workbook | App |
|---|---|
| `F-Charles . C` | `C. Francisco-Charles` |
| `F-Blackstock . R` | `R. Forrester-Blackstock` |
| `Sumali . J` | `J. Sumaili` (spelling differs too) |

**Initials that disagree** — first name vs known-as, or an error; not established [unknown]:

| Workbook | App | Grid days 2026 |
|---|---|---|
| `Lloyd . K` | `P. Lloyd` | 19 |
| `Murray . T` | `A. Murray` | 15 |
| `Boyle . A` | `S. Boyle` | 0 | **SAME PERSON — owner-confirmed, 14 Sep 2026.** The zero is real and explained (long-term sickness, see §9), which settles the identity: the row is hers and only the INITIAL disagrees. That makes a known-as/legal-first-name difference the likeliest reading for the other two rows here as well, rather than an error. |

**Management accounts are absent from the workbook, correctly** — they hold no roster line, so they
have no quota slots. Do not read their absence as a gap.

**The free-text Sunday tags are not a name source.** They are typed by hand and drift wildly —
first-name-only forms, nicknames, and misspellings all appear. Use them to *locate* a Sunday inside
a block, never to identify a person. **The WORD ORDER varies too** [measured, 14 Sep 2026]:
`Okeke . M`'s 4 Oct tag reads `M Okeke N/A`, where every other tag puts `N/A` first. A mechanical
scan must not assume the `N/A <name>` shape — match the surname anywhere in the cell.

---

## 8 · Known defects in the workbook itself

Every one of these is silent, and every one has been seen. [measured]

1. **Duplicate person rows.** Some people appear twice in `New Marylebone Totals` with *different*
   figures — one pair differs by exactly the over-quota day, so the two rows report a different
   Remaining for the same person. One pair also spans grades (a CES listed once as CEA with zero
   days, evidently stale). **Always check whether a name appears more than once before quoting a
   figure.**

   **TWO pairs, and they look pasted rather than mistyped** [measured, 14 Sep 2026]. `Boyle . A` is
   also duplicated, at **rows 9 and 18** — both 32/0/32, so harmless today and easy to miss. What
   makes the shape worth recording is that **both pairs are the same two names, consecutive, in both
   places**: rows 9–10 are `Boyle . A` then `F-Charles . C`, and rows 18–19 are `Boyle . A` then
   `F-Charles . C` again. Two independent typos would not land in the same order twice. Treat a
   duplicate as a sign that a BLOCK was copied, and check the rows either side of it rather than the
   one name you were asked about.

   **AND IT SPANS SHEETS** [measured, 14 Sep 2026]. `Boyle . A` is duplicated on `Marylebone Block`
   too, at rows 10 and 19 — the same relative positions as her totals rows 9 and 18, offset by that
   sheet's extra header. So the duplication is structural to the workbook rather than a slip on one
   tab, which is the strongest reason yet to check neighbours rather than the single name asked
   about.

   **The over-quota pair, named** [measured, 14 Sep 2026]: `F-Charles . C` is at **row 10 and row
   19**. Both are CEA, both allowance 32, and both count the same 28 grid days through an identical
   `COUNTIF`. Row 10 carries column E = 1 with the comment `24/02` and reports **3 remaining**; row
   19 has an empty column E and reports **4**. **Row 10 is the correct one** — row 19 is the same
   person missing their over-quota day, so it overstates the balance by exactly one. Neither row is
   marked, and nothing in the sheet says which is live. A reader going top-down lands on the right
   one by luck; a search lands on whichever matches first.
2. **Two people are at MINUS ONE.** [measured, 14 Sep 2026] `Haque . J` and `Reen . C` both show
   33 days used against a 32 allowance, so Remaining reads `-1`. The formula is behaving — `F-(G+E)`
   is not clamped, and the app's own `alPosition` deliberately reports a negative rather than
   clamping too — but it means the grid holds a day neither of them had. Not investigated; it may be
   a genuine over-booking the clerks allowed, or a name in one cell too many.

2. **A person in the workbook who is not on the app roster** — `Barnard . M`, with real 2026
   bookings (1–5 Jun) and a matching name on the 2021 sheet. See §10.
3. **An off-by-one COUNTIF range.** Two rows count `G2:H367` where their neighbours count
   `G2:H368`. Harmless today — the excluded row is 2 Jan 2027 and is `Closed` — but it is the sort
   of thing that becomes wrong when the sheet is extended.
4. **The over-quota column is hand-typed.** It cannot be derived, checked or recomputed from
   anything else in the file. If the comment is missing, the date is gone.
5. **Carry-forward is barely used.** Only one row carries a c/f value, and it is on a row that looks
   stale. **The app has no concept of carry-forward at all** — see §9.
6. **An over-quota comment with no value beside it.** [measured, 14 Sep 2026] `Sumali . J` (row 17)
   carries the comment `10/04` on E17, but **E17 itself is empty**. Excel reads the blank as zero, so
   `=F17-(G17+E17)` computes 32 − (32 + 0) = **0 remaining** and nothing errors — where the comment
   implies 33 days against 32, i.e. **−1**. The row therefore hides that this person is already over
   their entitlement. It is the mirror of defect 4: there the date is lost and the deduction stands;
   here the date survives and the deduction is missing. **Read the comment even when the cell is
   blank** — a blank E is not evidence of no over-quota day.

---

## 9 · Where the app and the workbook legitimately disagree

The app counts AL from **Firestore overrides**; the workbook counts from **quota slots plus a
hand-typed column**. They are measuring different things, so equality is not the test — *explained*
difference is.

| Difference | Direction | Why |
|---|---|---|
| **Over-quota days** | app shows **more** remaining | The day is real leave but exists only in column E. The app cannot know about it unless somebody records it in Change a Shift. |
| **Sundays inside a block** | agree (both exclude) | Both refuse leave on an uncontracted day. |
| **Carry-forward** | app shows **less** entitlement | `getALEntitlement` has no c/f input. **This stops being theoretical in January 2027, and the row that will do it is already visible** [owner-confirmed, 14 Sep 2026]: `Boyle . A` has been off sick all year and has an untouched 32 of 32. Leave that could not be taken because of long-term sickness is normally carried over, so column C on her 2027 row is the c/f value this has been waiting for — at which point the app will state an entitlement lower than the workbook's for as long as the carry-over lasts. Worth deciding BEFORE it appears rather than discovering it as a discrepancy. |
| **Pro-rated joining year** | should agree | The workbook's allowance for a joiner should equal the app's `proRatedAL[2026]`. Check it — this is the cheapest real check in the whole reconciliation. |
| **Dispatcher lieu days** | check | The app adds one lieu day per bank holiday worked. Whether the workbook's allowance for a Dispatcher already includes them is **[unknown]**. |
| **A SWAPPED working day booked off** | app shows **more** remaining | **The commonest real cause, ANSWERED BY THE OWNER 14 Sep 2026** — see below. |
| **Leavers** | app may show a stale row | A leaver is `hidden` in the app but keeps their workbook row and figures. |

### A rest-day AL booking is usually a SWAP, and the app can hold it

**The case.** `F-Charles . C` has three grid days — 4 Apr, 27 Apr, 23 Jul 2026 — that are REST DAYS
on her base roster. **A CHECK RUN WITHOUT THE OVERRIDE MAP SAID THE APP WOULD READ 6 REMAINING
AGAINST THE WORKBOOK'S 3. THAT WAS WRONG — the app reads 4**, because all three days already
carry the swap underneath them and already count. `consumesEntitlement(member, date, ovByDate)`
says so in its own signature: *"Omit [ovByDate] only where there genuinely are none to hand —
without it a swapped-in day reads as a rest day."* Passing `null` manufactures the very
discrepancy this section is about, so **never diagnose a rest-day difference without the map**. The owner's answer: *"she moved her shift days around, hence those 3 days as
AL, which would otherwise be on rest days."* The workbook is right. She swapped her working days and
then booked the swapped-in day off, which is real leave on a day her base roster calls rest.

**The app already models this exactly** — `override-utils.js` carries the owner's own confirmation
from 26 Aug 2026 (VAL-AL-001): *annual leave reaches a rest day ONLY where a member has swapped
working days and then books the swapped-in day off, which is `shift`.* An `annual_leave` doc carries
`replacedType`, the only surviving record of what it covered, and a `replacedType` of `shift` makes
the day count. **So this is a DATA gap, not a defect**: the swap was never recorded in the app, so
there is nothing under the AL to say the day was contracted.

**Her three dates needed no fixing.** The two-write recipe below is for a swap that was never
recorded at all; hers were. Keep it for the next case.

**Fixing such a date takes two writes, and the ORDER is the whole thing** [measured through
`nextReplacedType` + `consumesEntitlement`, 14 Sep 2026]:

| State | `replacedType` | Counts? |
|---|---|---|
| AL alone, on a rest-day base (what is on record now) | `null` | **no** |
| …then record her swapped-in SHIFT on that date | `'annual_leave'` | yes |
| …then record the AL again, over that shift | `'shift'` | **yes** ✓ |

Recording only the AL again changes nothing; recording only the shift leaves the day showing as
worked. **Shift first, then AL.**

**WHAT THE ONE-DAY GAP ACTUALLY WAS** [measured, 14 Sep 2026, from the app's own recorded-dates
card]. The app holds **28** days for her and reads **4 remaining**; the workbook holds 28 grid days
**plus the 24 Feb over-quota day** and reads **3**. The whole difference is `24/02` — §0's rule,
landing exactly where §0 says it will: invisible in the grid, present only in column E, and absent
from the app because nobody recorded it. Recording AL on 24 Feb (a working day for her, 15:15–23:55)
takes the app to 29 used and 3 remaining, and the two systems agree.

**AND A DIFFERENCE THAT CANCELS ITSELF OUT, WHICH IS WORSE.** Rendering the workbook's 28 dates
through the card's own merger does NOT reproduce the app's May: the workbook gives `Fri 1 May` +
`Mon 4 – Thu 14 May`, the app shows one `Fri 1 – Wed 13 May, 9 DAYS`. The only date set that
reproduces the app's card exactly has **Sat 2 May and no Thu 14 May** — so the app holds 2 May, the
workbook holds 14 May, both count 9 days in May, and **every total on both sides agrees while two
dates disagree**. Nothing flags it, in either system. This is the case §9's own reconciliation pass
was written for: **report the DATES, never a count** — a count cannot see this, and a count is what
everybody compares.

**And it generalises**: any member who swaps days and books the swapped-in day off is under-counted
by the app until the swap is recorded. That is worth knowing before reading any app-vs-workbook
difference as an error.

### The monthly reconciliation pass — suggested shape

1. Read `New Marylebone Totals` rows; flag duplicate names before anything else.
2. Map names to the app roster (§7); report anybody unmatched in either direction.
3. For each person: workbook allowance vs `getALEntitlement`/`proRatedAL` — allowance disagreements
   are the ones worth chasing, because they are wrong all year.
4. For each person: workbook grid days + column E vs the app's recorded AL days.
5. Report the **dates** that differ, never a count. A count cannot be acted on; a date can.

---

## 10 · Open questions for the owner

Answer any of these and strike it from this list rather than answering it again — and **ask them**
when the workbook is next uploaded, rather than waiting to be volunteered an answer. Several of
them change what a figure MEANS, so an unanswered one is not a tidiness problem.

1. **`Barnard . M`** has 2026 bookings but is not on the app roster. Current staff member missing
   from the app, a leaver whose row was left behind, or somebody at another location?
2. **The initial mismatches** in §7 (`Lloyd . K`/`P. Lloyd`, `Murray . T`/`A. Murray`,
   `Boyle . A`/`S. Boyle`) — first name vs known-as, or workbook errors?
3. **Duplicate rows** — is one of each pair authoritative, or is that just untidiness to be ignored?
4. **Dispatcher allowance** — does the workbook figure already include lieu days for bank holidays
   worked, or is it the base only?
5. **Carry-forward** — is c/f in use for 2027, and should the app model it?
6. **`Marylebone Block`** — what is the Week 1–4 grid for?
7. **Column E** — is "granted when the quota was full" the right description, and is the
   pre-June lump a separate, deliberate use of the same column?
8. **Who owns the file** — is the copy uploaded here always current, and does anybody edit it
   besides the roster clerks?

---

## 11 · If this ever becomes an uploader

Not committed to, and deliberately not designed here. Three things would have to be true first, and
none of them is true today:

- **A stable identity join.** §7's exceptions are hand-knowledge. An importer that silently fails to
  match a name would under-report somebody's leave, which is exactly the class of silent error this
  repo treats as the dangerous one.
- **The over-quota column readable without a human.** Its dates are in free-text comments in two
  different formats (`24/12`, `19.08`, and a prose lump). A parser that cannot read one must refuse
  the row by name, never default it — the `validateBackup` / `parseDesignImport` posture.
- **A decision about what an import would DO.** Reconcile-and-report is a very different feature
  from write-overrides-into-Firestore, and only the first is obviously safe: the workbook is a quota
  allocation, and a day in it is not always a day the app should record.

Until then this is a session-time analysis, and this document is what makes that repeatable.

---

## 12 · What has been learnt, and when

Add a row every time the workbook is uploaded and something is established, corrected or refused.
This is the record of the file getting better; an upload that taught nothing is worth a row saying so.

| Date | What changed | Prompted by |
|---|---|---|
| 8 Sep 2026 | First pass. The quota-grid framing, the 2021 decoy sheet, the Remaining formula, the per-grade COUNTIF ranges, the Sunday free-text tags, the name mapping and the workbook's own defects — all `[measured]`. The meaning of `AL over depot quota` recorded as `[inferred]`. | Owner asked for M. Robson's and then J. Davies's 2026 leave |
| 8 Sep 2026 | **Correction.** An earlier answer reported J. Davies's leave from the grid alone and omitted his over-quota day. §0 exists because of it. | Owner: "You need to provide the full list of days even if it is out of quota" |
| 8 Sep 2026 | **Correction.** Column E's dates were reported as living nowhere, on the strength of `openpyxl` returning Excel's placeholder for a threaded comment. They are in `xl/threadedComments/`. | Owner: "I need that J. Davies issue explaining more clearly" |
| 14 Sep 2026 | **§0 was broken again, by a session that had not read this file.** J. Davies reported as 19 days from the grid alone — the same person, the same missing 24 Dec, six days after §0 was written to prevent exactly it. The rule was sound; it was never consulted. **Read §0 before answering, not after being corrected.** | Owner: "Remember to look for those hidden days in future. We have an area in an md file for this kind of information" |
| 14 Sep 2026 | **Correction to §5.** `openpyxl` DOES return threaded-comment text (3.1.5), verified against the XML for all sixteen totals-sheet comments. The old note sent readers down the zip route as the only option and implied the dates were unreachable without it. | Re-deriving Davies's over-quota day from scratch |
| 14 Sep 2026 | **New trap recorded (§6).** Threaded comments keyed by cell ref across all sheets conflate them: `E22` merged the totals row with a calendar sheet and produced a second, non-existent over-quota date (`27/02`). Caught before it reached an answer. Reliable sheet→comment-file mapping via the `_rels` added. | Same |
| 14 Sep 2026 | **New workbook defect (§8.6).** `Sumali . J` has an over-quota comment (`10/04`) with an EMPTY column E, so the deduction never happens and Remaining reads 0 where it should read −1. | Auditing every column-E comment against its value |
| 14 Sep 2026 | **`/al-workbook` created**, because the knowledge being written down was not enough on its own: §0 was broken twice by sessions that had this file and read it late. The skill is the TRIGGER — it fires on an upload or a leave question and sends the reader here. It deliberately summarises nothing. | Owner: "claude really needs to read that area of the md file … We also need to add learnings to that file" |
| 14 Sep 2026 | **§3's Role column resolved: `BLCEA` is the LINE, not the CONTRACT.** `Cooper . I` is `BLCEA` with a 32 allowance, and the app has them as a plain CEA with `bilingualContract: false`. The two AGREE. Reading the column as a contract would predict 34 and report a false disagreement — the first reconciliation trap that makes a correct workbook look wrong. | Owner asked for I. Cooper's 2026 leave |
| 14 Sep 2026 | **First answer given through the skill, and it worked as designed.** I. Cooper: column E read FIRST, `19/08` found, and it sits INSIDE the 18–21 Aug block — the Davies shape again (an answer from the grid alone would have read "Tue 18 Aug, then Thu 20 – Fri 21 Aug"). 21 deducted of 32, 11 remaining, matching the sheet's own formula. A Sunday tag on 19 Apr also resolved a gap that looked real: 17–19 Apr are all rest days, so 13–22 Apr is ONE ten-day absence. | Same |
| 14 Sep 2026 | **§4 extended: a Sunday tag can OPEN a block, and can fall on a day the person was ROSTERED TO WORK.** `Panchal . A` is tagged on Sun 15 Feb 2026, which starts his absence, and his base roster has him on 07:15–15:45 that day. Because the app refuses an AL override on any Sunday, this is a day the WORKBOOK can hold and the APP structurally cannot — the mirror of the over-quota trap, and a date-for-date comparison reports it as a discrepancy when it is not. | Owner asked for A. Panchal's 2026 leave |
| 14 Sep 2026 | **Two members have nothing booked in the remainder of the year while the grid is busy.** I. Cooper's last day is 30 Sep with 11 remaining; A. Panchal's is 1 Aug with 9 remaining. The CEA block carries bookings on 68 dates from 1 Oct onward, so the clerks have not simply stopped filling it in. Put to the owner as a question (§0 step 3) rather than resolved — the app may hold bookings the workbook has not caught up with. **Unanswered.** | Owner: "Are his future booked days not on there?" |
| 14 Sep 2026 | **§8.1's duplicate pair named: `F-Charles . C`, rows 10 and 19.** Row 10 carries the over-quota day and reports 3 remaining; row 19 omits it and reports 4. Row 10 is correct. Also **§5's mechanism now has three worked examples** — Davies 24/12, Cooper 19/08 and F-Charles 24/02 all land on a date whose four CEA slots are full. | Owner asked for C. Francisco-Charles's 2026 leave |
| 14 Sep 2026 | **§3's `BLCEA` rule corroborated 7/7, not 1/1.** Five BLCEA rows carry a 32 allowance and two carry 34, and the split matches `bilingualContract` in the app exactly. The workbook and the app AGREE on who holds a bilingual contract; it is the Role column that cannot answer it. | Owner: "The workbook says C. Francisco-Charles only has 3 AL days remaining?" |
| 14 Sep 2026 | **A SECOND duplicate pair (`Boyle . A`, rows 9 and 18), and the shape of both.** The same two names appear consecutively in both places — `Boyle . A` then `F-Charles . C` at 9–10 and again at 18–19 — which reads as a copied block rather than two typos. Also recorded: `Haque . J` and `Reen . C` both sit at **−1**, 33 used against 32. | Same |
| 14 Sep 2026 | **The rest-day mismatch has a second, bigger instance.** Three of F-Charles's 28 grid days (4 Apr, 27 Apr, 23 Jul) are rest days on her current base roster, so `consumesEntitlement` refuses them and the app will say 6 remaining where the workbook says 3. SPARE days are NOT affected — `isRestShift` is RD/OFF only, so all seven of her spare-day bookings count on both sides. **ANSWERED the same day** — she swapped her working days and booked the swapped-in days off, so the workbook is right and the app is missing the swap. See §9. | Same |
| 14 Sep 2026 | **ANSWERED: a rest-day AL booking is usually a SWAP, and the app can hold it.** Owner: *"she moved her shift days around."* `override-utils.js` already carries this rule from 26 Aug (VAL-AL-001) — an AL doc's `replacedType` of `shift` makes the day count — so the 6-vs-3 gap is missing swap DATA, not a defect. The two-write fix and its order are now in §9, measured rather than assumed. | Owner, on C. Francisco-Charles's 3 remaining |
| 14 Sep 2026 | **The Sunday-tag finding goes from ONE instance to FOUR, and changes status.** `Mylla . O`'s three tags (11 Jan, 9 Aug, 27 Dec) ALL fall on days she was rostered to work, and 11 Jan opens its block. §4 recorded this as an exception off a single Panchal case; on four instances it looks like the ordinary shape, with a tagged Sunday that is genuinely a rest day as the variant. Her figures are otherwise clean: one row, column E empty AND no comment (checked for the §8.6 shape), 32 of 32 used, 0 remaining, and all 32 consume in the app. | Owner asked for O. Mylla's 2026 leave |
| 14 Sep 2026 | **`Boyle . A` has NO leave anywhere in the 2026 grid** — zero mentions in any grade block, in any spelling, with column E empty and uncommented on both her rows. 0 of 32 used in mid-September. Three readings, none settled: she has genuinely booked nothing; a fixed-line person's leave is not recorded here (she moved off the rotating link to the Mon–Fri 09:00–16:00 line on 28 Jun 2026); or **§7's open question bites and `Boyle . A` is not `S. Boyle` at all**, in which case the app's S. Boyle has no row and the zero means nothing. The never-used row makes the third reading likelier than it looked. **RESOLVED the same day — owner: "She has been off sick all year so this makes sense."** Reading 1, and it settles §7's identity question as a by-product: the row IS hers, only the initial is wrong. It also promotes §9's carry-forward row from theoretical to a dated prediction. | Owner asked for S. Boyle's 2026 leave |
| 14 Sep 2026 | **The duplicate-block theory confirmed across SHEETS.** `Boyle . A` is doubled on `Marylebone Block` at rows 10 and 19, the same relative positions as her totals rows 9 and 18. Structural, not a slip on one tab. Also the first fact about that sheet: it names each person's line (`MYB CSA`). | Same |
| 14 Sep 2026 | **Carry-forward stops being theoretical in Jan 2027, and the row is already identifiable.** S. Boyle's untouched 32 of 32 after a year of sickness is exactly the c/f case §9 said it was waiting for. `getALEntitlement` takes no c/f input, so from her 2027 row the app will understate her entitlement for as long as the carry-over lasts. Better decided before it appears than met as a discrepancy. | Owner: "She has been off sick all year" |
| 14 Sep 2026 | **CORRECTION: the Sunday-tag pattern was overstated the same day it was written.** Off Mylla's 3/3 plus Panchal it was recorded as "the ordinary case". `Haque . J`'s four tags split two rostered, one spare, one rest day — six of eight overall, a majority not a rule. The instruction (check the base roster every time) is unchanged; the claim around it is now the size of its evidence. | Owner asked for J. Haque's 2026 leave |
| 14 Sep 2026 | **`Haque . J`'s −1 is REAL, and the obvious explanation was tested and disproved.** `COUNTIF` counts CELLS, so a name written twice on one date would inflate the total without a day being taken — but her 33 cells are 33 DISTINCT dates. Allowance agrees with the app at 32 and column C is empty, so she has genuinely taken 33 of 32 and the sheet reports it unclamped. For the clerks: a day granted over entitlement, or a 2025 carry-forward never entered in column C. **Unresolved.** Her empty autumn, unlike Cooper's and Panchal's, is explained by having nothing left. | Same |
| 14 Sep 2026 | **The Sunday-tag ratio revised a SECOND time, to 8 of 14.** `Okeke . M`'s six tags are only two rostered. "Ordinary case" (4 tags) → "majority" (8) → "bare majority" (14) in one day, each revision forced by the next person looked at. Kept as a caution about generalising from one member; the instruction (check the base roster) is what has held. | Owner asked for M. Okeke's 2026 leave |
| 14 Sep 2026 | **A clean positive for §9's pro-rata check, and a new tag variant.** `Okeke . M` joined 20 Apr 2026 and the workbook's allowance of 24 matches the app's `proRatedAL[2026]` exactly — the check §9 calls the cheapest real one, passing on the first joiner it has been run against. Her 4 Oct tag reverses the usual `N/A <name>` order. | Same |
| 14 Sep 2026 | **CORRECTION, and a trap worth more than the case.** This file briefly said the app would read 6 remaining for F-Charles against the workbook's 3. It reads **4**: her three rest-day bookings already carry the swap and already count. The wrong figure came from calling `consumesEntitlement` with `ovByDate = null`, which the function's own docstring warns against — passing null MANUFACTURES a rest-day discrepancy. Never diagnose one without the override map. | Owner: "Still saying 4 remaining" |
| 14 Sep 2026 | **The real one-day gap is `24/02`, and a second difference that cancels out.** App 28 days / 4 remaining vs workbook 29 / 3 — the whole gap is the over-quota day, exactly as §0 predicts. Separately, rendering the workbook's dates through the card's own merger proves the app holds **Sat 2 May** and the workbook holds **Thu 14 May**: nine days each, every total agreeing, two dates wrong somewhere. The argument for reporting DATES rather than counts, made by a live example. | Same |
