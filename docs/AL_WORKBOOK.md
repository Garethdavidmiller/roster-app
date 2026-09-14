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

> ## ⚠️ ADD THE TABLE UP BEFORE YOU SEND IT — blocks LOSE the isolated day
>
> [14 Sep 2026] Grouping the days into blocks of absence is right, and it has its own failure mode:
> **a single day with nothing either side of it has no block to join, and drops out.**
> `F-Blackstock . R`'s **Sat 31 Jan** did exactly that — she worked the Friday, the Sunday after is
> a rostered shift with no tag, so the day stands alone, and it vanished between the extraction
> (which had all 25) and the table (which showed 24 + the over-quota day).
>
> **The total was stated correctly beside the table that contradicted it**, which is what makes
> this cheap to catch and embarrassing to miss. The check is one line:
>
> **Count the DISTINCT dates in the answer. The set must equal the grid days plus column E — not
> just the total, the SET.**
>
> Do it before sending, every time — the reader cannot perform it, because the grid total is not in
> front of them. Note the asymmetry too: a lost day makes the answer look TIDIER, since an isolated
> single day is the untidy row a summary wants to drop.
>
> **A TOTAL IS NOT ENOUGH, and this rule was written too weakly the first time** [14 Sep 2026]. It
> originally said "sum the deducted column", and that check then PASSED on a `Sumali . J` table
> which had **dropped 21 May and listed 23 Dec twice** — an omission and a duplicate net to zero, so
> the total still read 33 and the arithmetic confirmed an answer with two errors in it. Compare the
> SET of dates, and a duplicate is as visible as a gap. Both failures have now happened within an
> hour of each other, on consecutive members.

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
> **COUNTED IN FULL, 14 Sep 2026 — and the running tally it replaces was WRONG** [measured].
> Every free-text tag in the CEA block was extracted and classified against each person's own base
> roster. **All 75 of them**, not the handful belonging to whoever was asked about that afternoon:
>
> | The member's base roster that Sunday | Tags | Share |
> |---|---|---|
> | a NAMED SHIFT | 31 | 41% |
> | a SPARE day | 21 | 28% |
> | a REST day | 23 | 31% |
> | **contracted — named shift or spare** | **52** | **69%** |
>
> **The named-shift case is a MINORITY, and this file spent a day calling it a majority.** It was
> written as "the ordinary case" off 4 tags, then "a majority" (6 of 8), then "eight of fourteen",
> then "twelve of twenty-three" — four statements, each one drawn from the people who happened to
> be asked about, and each one chasing the last downward. The full count is 41%. **Every
> intermediate figure here was an artefact of the sample**, which is what a running tally built out
> of answered questions is worth when the question is a population question.
>
> **⚠️ THE CENSUS IS AGAINST THE PATTERN, NOT AGAINST WHAT WAS PUBLISHED — so a "named shift"
> here is not proof the person was rostered one.** [owner, 14 Sep 2026] Told that
> `F-Charles . C`'s 3 and 10 May and `Atrakimaviciene . L`'s 5 Jul were days I had failed to list,
> the owner's answer was that they are **"already on the roster"**. `getBaseShift` returns the
> member's ROTATING PATTERN; the roster the depot actually publishes each week can change any day
> of it, and the roster import writes those changes into the app as overrides. So a tag can sit on
> a pattern shift that the published week had already made a rest day — the person is off, the app
> shows it, and nothing is missing from anybody's answer.
>
> Two consequences, and the first is the one that bites:
>
> - **A tagged Sunday is NOT automatically a hole in the app.** Before reporting one as a day the
>   app structurally cannot hold, check whether the published roster already covers it. This file
>   has twice described tagged Sundays as invisible to the app; that is true only where the
>   published week really did roster the person a shift.
> - **The 31 "named shift" tags are an UPPER BOUND on the rostered case**, not a count of it. Some
>   number of them were changed on the published roster. The 23 rest-day tags are firmer — a
>   pattern rest day is rarely turned into work without an RDW — so if anything the true
>   named-shift share is **below** 41%, which moves the conclusion further in the direction it
>   already went.
>
> **Settling it needs the OVERRIDES, not the pattern**, which means reading Firestore rather than
> `roster-data.js`. That is the check to run the next time this is in front of somebody who can:
> resolve each of the 75 tag dates through `resolveEffectiveShift` with the override map loaded,
> and the census becomes exact. Until then, report the tag and the pattern, and say which it is.

> **ASK "was the member DUE AT WORK", not "was a shift named".** SPARE is contracted — the person
> is expected at the station — so being away from one is being away from work exactly as a named
> shift is. That reading gives **69%, better than two in three**, and it is the one that answers
> the member's question. Keep the three-way split only for reconciling against the grid.
>
> **A tag can stand COMPLETELY ALONE, and a block can be missing one** [measured, 14 Sep 2026].
> `Tuck . N`'s **Sun 22 Mar** and `Romiah`'s (= `F-Blackstock . R`) **Sun 15 Mar** are both tagged
> with no grid day anywhere near them, in weeks of solid working shifts — one-day absences from a
> rostered Sunday that neither the app nor the grid can show. The mirror is just as common:
> Tuck's **Sun 6 Sep** and **Sun 15 Nov** are rostered and adjacent to leave and NOT tagged, and
> `F-Blackstock . R` has five rostered or spare Sundays touching her blocks (1 Feb, 28 Feb–1 Mar
> aside, 16 Aug, 6 Sep, 27 Dec) of which only some carry a tag. **Tagging is at the clerk's
> discretion and is not applied consistently.** An absent tag is silence, not evidence the person
> worked — §0 step 3 applies.
>
> The instruction is unchanged and is the point: **check the base roster every time**, because the
> tag itself tells you nothing about which kind it is — and only the contracted kinds (a named
> shift or a spare day) are days the member was away from actual work.
>
> **A tag can stand COMPLETELY ALONE, and a block can be missing one** [measured, 14 Sep 2026].
> `Tuck . N`'s **Sun 22 Mar** is tagged with no grid day anywhere near it — her nearest bookings
> are 9 Mar and 8 May — and every day from 18 to 23 Mar is a working shift, so the tag is a
> one-day absence from a rostered Sunday and nothing else. The mirror appears on the same person:
> **Sun 6 Sep** sits between a booked Sat 5 and a rest-day Mon 7, is rostered 07:15–15:45, and is
> NOT tagged; nor is **Sun 15 Nov**, straight after 13–14 Nov. Either she worked those Sundays, or
> the clerk tagged one block and not the others. **An absent tag is not evidence she worked** — it
> is silence, and §0 step 3 applies: say so rather than pick.
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
the same shape: Mylla, Irvine, Panchal and Miller hold all four slots. **TEN FOR TEN** as of
14 Sep — `F-Blackstock . R`'s `29/12` lands on a Tuesday whose four slots hold Davies, Reen, Mylla
and Silva, `Silva . S`'s own `02/01` on a Friday holding Mylla, Miller, Reen and F-Blackstock, and
`Sumali . J`'s `10/04` on a Friday holding Robson, Gherbi, Nsuala and Miller, and all THREE of
`Bibi . T`'s (`16/04` — Gherbi, Cooper, Nsuala, Langley; `19/08` — Mylla, Gherbi, F-Blackstock,
F-Charles; `20/08` — Atrakimaviciene, Gherbi, F-Blackstock, Cooper), and `Gherbi . T`'s `23/02` on a
Monday holding Mylla, Irvine, Panchal and Miller.
**Every over-quota date checked so far falls on a date whose four CEA slots are full, with no
exceptions.** That is as close to confirming the `[inferred]` meaning of column E as the file alone
can get; it still wants the owner's word.

> ## ✅ §0 CONFIRMED AGAINST THE APP'S OWN FIGURE — the first time, 14 Sep 2026
>
> Everything above was reasoning: column E is deducted, so an answer built from the grid alone is
> short by exactly those days. The owner then read `F-Blackstock . R`'s balance off the **app** and
> got **7 remaining** where the workbook says **6**.
>
> ```
> app:       32 allowance − 25 grid days                  = 7
> workbook:  32 allowance − (25 grid days + 1 over quota)  = 6
> ```
>
> **The gap is one day and it is the over-quota day** — `29/12`, exactly as the comment says, on a
> Tuesday whose four CEA slots are full. No other explanation fits: all 25 of her grid days land on
> contracted days, so the app counts all 25 and cannot be short for any other reason.
>
> **This is the failure mode §0 exists to prevent, caught from the other end.** It is not merely
> that an ANSWER is short — the APP is short too, permanently, because nothing ever writes the
> over-quota day into it. So:
>
> - **An over-quota day should be RECORDED in the app as annual leave**, not just mentioned in the
>   answer. Until it is, that member's balance stays one day generous for the rest of the year and
>   the discrepancy re-appears every time anybody checks.
> - **A one-day gap between the app and the sheet is column E until proved otherwise.** It is the
>   first thing to check, not the last, and it will usually be the whole difference.
> - **It is not a one-off.** `Silva . S` is the same case one member later — 19 grid days against a
>   column E of 1, so the app will read **13** where the sheet says 12, and the missing day is her
>   `02/01`. **Every member carrying a column-E value is in this state until somebody enters it**,
>   which as of 14 Sep is at least five people (Davies, Cooper, F-Charles, F-Blackstock, Silva).
>   Worth clearing in one pass rather than one question at a time.
> - Where the pattern makes the day a REST day, recording it hits the v23.75 swap question
>   (`al-swapped-days.js`) and the answer is that it was a working day taken as leave.

> **A COLUMN-E CELL CAN HOLD SEVERAL DATES, AS A COMMENT THREAD** [measured, 14 Sep 2026].
> `Bibi . T`'s E14 is **3**, and the comment is a thread: the body reads `16/04` and two REPLIES add
> `20/08` and `19.08`. **Read the replies, not just the body** — taking the first line alone would
> have found one date for a cell worth three, and the answer would have been two days short with
> nothing to show for it.
>
> **And the punctuation varies inside one thread.** That third reply is `19.08`, with a full stop
> where the other two use a slash. Same `DD/MM` order, different separator, in the same cell. Any
> mechanical read of these comments must accept both; a human reading them will not notice.

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

> ## ⚠️ THREE TAGS CARRY A FIRST NAME AND NOTHING ELSE — and a surname scan misses them entirely
>
> [measured, 14 Sep 2026] Of the 75 free-text Sunday tags in the CEA block, **three names appear as
> a bare first name with no surname and no initial**: `N/A Romiah`, `N/A Csherrice`, `N/A Loreta`.
> Every mechanical scan this file has recommended matches on the SURNAME, so all five of those
> tags were invisible to it, and **two answers given on 14 Sep were short because of it** —
> C. Francisco-Charles (3 and 10 May) and L. Atrakimaviciene (5 Jul).
>
> | Tag | Dates | Who, and the evidence |
> |---|---|---|
> | `Romiah` | 25 Jan, 1 Mar, 15 Mar, 2 Aug, 30 Aug | `F-Blackstock . R`. The other R on the roster, `Frimpong . R`, is tagged **by surname** (`N/A R Frimpong`, 15 Feb), and three of the five sit exactly where F-Blackstock's leave is — 1 Mar into her 2 Mar day, 2 Aug into her 3 Aug, 30 Aug into her 31 Aug–5 Sep |
> | `Csherrice` | 3 May, 10 May | `F-Charles . C`. **Same SLOT COLUMN** as her bookings either side — slot D on Fri 1 and Mon 4 May, slot D again on Sat 9 and the Sunday between |
> | `Loreta` | 5 Jul | `Atrakimaviciene . L`. Dead centre of her 3–9 Jul block and in her slot column (D) throughout |
>
> **⚠️ A SHORT SURNAME SUBSTRING-MATCHES PLACE NAMES** [14 Sep 2026]. Sweeping the workbook for
> `'reen'` reported hits on `South Bucks Totals` and `South Bucks Calendar`, which looked like
> `Reen . C` working at a second location — a significant finding if true. It is
> **"Beaconsfield & Seer Green"**. Checked before reporting; it would have been a confident,
> completely wrong claim. **Confirm any cross-sheet hit by reading the actual cell**, and remember
> the workbook holds every Chiltern location, not just Marylebone.
>
> **The slot column is the identifier, not the text.** That is the technique to use when a tag
> cannot be read: a leave block holds ONE slot letter for its whole run, so the Sunday cell in that
> same column belongs to whoever holds the days either side. It resolved all three here.
>
> Two more spellings that break an exact match: **`Sumali . J` is also written `Sumaili . J`**
> within the same sheet (12 and 19 Jul against 14 Jun), and one cell reads **`N/A L Springer NA`**
> with the state repeated. **Match loosely, then confirm by slot column.**
>
> ## ⚠️ A REVERSED TAG READS AS A BOOKING — measured, by catching a scan out
>
> [14 Sep 2026] `Irvine . D`'s Sun 9 Aug cell reads **`D Irvine N/A`**, name before state. A scan
> that tells a tag from a booking by testing `startswith("N/A")` — which is what this file's own
> examples encourage — files it as a **booked day**, and the answer gains a day the member never
> took, **on a Sunday**, the one day that cannot hold annual leave. It happened in this session.
>
> `Okeke . M`'s 4 Oct tag (`M Okeke N/A`) is the same shape, recorded above as a curiosity; this is
> it doing damage. **Test for the state ANYWHERE in the cell, not at the start** — and cross-check
> the count against the row's `COUNTIF`, which looks for the exact `Surname . I` string and is
> therefore immune: it correctly counted 32 while the scan said 33.
>
> **And a cell can hold whitespace that is neither empty nor a value** — slot E on that same
> 9 Aug row contains twenty spaces. `is None` does not catch it; strip before testing.

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
5. **Carry-forward is not used AT ALL on the live sheet.** [corrected, 14 Sep 2026 — this said
   "barely used … only one row"] Column C of `New Marylebone Totals` is empty for **every one of
   its 47 rows**. The c/f values that do exist — twelve of them, up to 13 days — are all on the
   **2021** sheet (defect 7), which is what the earlier reading had half-seen. So the question §9
   raises is sharper than it looked: the depot HAS tracked carry-forward historically and the
   current register does not, and **the app has no concept of it either**.
6. **An over-quota comment with no value beside it.** [measured, 14 Sep 2026] `Sumali . J` (row 17)
   carries the comment `10/04` on E17, but **E17 itself is empty**. Excel reads the blank as zero, so
   `=F17-(G17+E17)` computes 32 − (32 + 0) = **0 remaining** and nothing errors — where the comment
   implies 33 days against 32, i.e. **−1**. The row therefore hides that this person is already over
   their entitlement. It is the mirror of defect 4: there the date is lost and the deduction stands;
   here the date survives and the deduction is missing. **Read the comment even when the cell is
   blank** — a blank E is not evidence of no over-quota day.

   **CONFIRMED, not merely suspected** [measured, 14 Sep 2026]: **Fri 10 Apr 2026 is a real
   over-quota day.** It is a working day on her roster (08:00–16:30), it sits in the middle of her
   4–11 Apr absence, and that Friday's four CEA slots hold Robson, Gherbi, Nsuala and Miller —
   full, exactly like the five other over-quota dates. **E17 should read 1**, and her true position
   is 33 days against 32.

   **Her row is the worst case this file has: THREE systems, THREE answers, none of them right
   together.**

   | Source | Says | Why |
   |---|---|---|
   | the workbook's formula | **0** | `=F17-(G17+E17)` with E17 blank |
   | the comment | **−1** | 33 days used against 32 |
   | the app | **2** | it counts 30, refusing two rest-day bookings (below) |

   **And the spelling scare was checked and is clear.** The name appears as both `Sumali . J` and
   `Sumaili . J` in this workbook, which would break `COUNTIF` silently if it reached the grid —
   **all 32 grid cells say `Sumali . J`**; only the 14 Jun free-text tag says `Sumaili`. The formula
   is not dropping days. Worth re-checking if anybody edits the grid, because nothing would say so.
7. **THERE ARE TWO MARYLEBONE REGISTERS IN THIS FILE, AND THE STALE ONE IS FROM 2021.**
   [measured, 14 Sep 2026] `Marylebone Totals` / `Marylebone Calendar` / `Marylebone Block` are a
   **2021** register — the calendar's dates run 1 Jan 2021 to 1 Jan 2022 — left in the workbook
   beside the live `New Marylebone *` sheets. A name search therefore returns **two totals rows for
   one person**, and nothing on the row says which year it is:

   | `Langley . S` | Used | Remaining |
   |---|---|---|
   | `New Marylebone Totals` (2026) | 23 | 9 |
   | `Marylebone Totals` (2021) | **0** | **32** |

   **The stale row is entirely plausible** — same `Surname . I` format, same 32 allowance, `MYB CSA`
   beside it — so there is no tell except the sheet name. Its header differs slightly
   (`AL over allocation`, not `AL over depot quota`; it also has `Location` and `Role` columns), and
   it carries ten `Unused . 1`…`Unused . 10` placeholder rows. Only **20 of 51 names** appear on
   both sheets, which is why this stayed hidden: most people asked about in Sep 2026 had not joined
   in 2021.

   **Always name the sheet.** Every figure in this document is from `New Marylebone Totals` and
   `New Marylebone Calendar`; a script that iterates `wb.worksheets` looking for a surname will find
   the 2021 one too, and §6 already warns about exactly this class of error for the threaded
   comments.


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
| **Employee of the Month** | **BOTH may show less entitlement** | **One extra AL day per award** [owner, 14 Sep 2026]. Neither system holds it: the workbook's allowance column reads a flat 32 for every CEA, and `getALEntitlement` returns a flat 32 too. **PARKED at the owner's request** — see below. |
| **Leavers** | app may show a stale row | A leaver is `hidden` in the app but keeps their workbook row and figures. |

### Employee of the Month — one extra day, held nowhere [owner, 14 Sep 2026] — **PARKED**

> **Do not act on this section.** The owner raised it and said explicitly: *"We will revisit that
> thought another day."* It is recorded so the next session starts from the fact rather than
> rediscovering it, not because anything is waiting to be built.

**The fact:** the Employee of the Month gets **one extra day of annual leave**.

**Why it matters more than it sounds.** It changes what a NEGATIVE remaining means. Three rows
currently sit at −1 — `Sumali . J`, `Haque . J` and `Reen . C` — and this file has been treating
that as an overdraw, an error, or an unrecorded carry-forward. **A person with one award has an
entitlement of 33, so taking 33 days is exactly correct and the −1 is an artefact of an allowance
column that cannot express it.** That is a completely different conclusion from "this person has
taken more leave than they are owed", and it is the kind of thing that should never be guessed at
in front of a member.

**Neither system can hold it today:**

- The workbook's **AL allowance** column is a flat 32 for every CEA row measured.
- The app's `getALEntitlement` returns a flat 32 for a CEA, with `proRatedAL[year]` the only
  adjustment it accepts, and that is for a joining year rather than an award.

**It is the same SHAPE as carry-forward** (the row above), and the two should be thought about
together when this is picked up: both are real, owner-known adjustments to an individual's
entitlement that neither the sheet nor the app has anywhere to put. Up to twelve awards a year
across the depot is not a rounding error.

**What would need deciding, when it IS revisited:** whether the award is recorded per member and
per year, whether it carries the CEA/CES/Dispatcher base or sits on top of it, and whether the
workbook or the app is the system of record — because if the allowance column starts reading 33 for
some people, every reconciliation in this document has to read it rather than assume the grade
default.

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
9. **`Sumali . J`'s E17 should read 1** — §8.6's defect is now confirmed (the `10/04` comment names
   a real over-quota day), so the cell is simply missing its value and her row understates by one.
   Is that a correction for the clerks to make in the workbook? Until it is made, her Remaining
   reads 0 where the true figure is −1.
10. **Is anybody tracking the people at −1?** Three now — `Sumali . J`, `Haque . J` and `Reen . C`
   — read as having taken more than their entitlement. **A LIKELY EXPLANATION ARRIVED 14 Sep 2026
   and is PARKED:** Employee of the Month earns one extra day, which no allowance column can
   express, so a person with an award is entitled to 33 and the −1 is an artefact rather than an
   overdraw (§9). Do not describe any of these three as over their entitlement until it is
   settled.
11. **`Sumali . J`'s 13 and 14 May** are rest days on her rotating pattern, so the app refuses them
   while the workbook counts them. Swapped working days (the F-Charles case), or did the published
   roster that week differ from the pattern? **The workbook CANNOT answer this** [measured,
   14 Sep 2026]: both cells hold a plain `Sumali . J` in slot F, identical to 11 and 12 May, same
   fill, no comment, no marker — the tail of one continuous run from 8 to 14 May. **The sheet has
   no concept of a rest day**; it allocates quota slots, and a slot is a slot. So nothing in it
   looks wrong, and the evidence has to come from the published roster for that week or from her.
   **The two answers are materially different:** a swap means the sheet is right and she really is
   at 33 of 32; genuine rest days mean the clerks deducted two days that cost her nothing and she
   is at 31, with a day in hand rather than an overdraw. **Worth asking of the other −1 rows too**
   — the same mechanism could explain any of them.

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
| 14 Sep 2026 | **The Sunday-tag ratio revised a THIRD time, and the question behind it changed.** `Tuck . N` carries **nine** tags, the most of anyone — four on a named shift, two on a SPARE Sunday, three on rest days — taking the running count to 12 of 23 on a named shift. Counting SPARE as what it is (a contracted day the member was expected at the station) gives **16 of 23**, which is the figure that actually answers "was she away from work" and is the one that has NOT fallen with each new person. §4 now reports the contracted reading and keeps the three-way split for grid reconciliation. | Owner asked for N. Tuck's 2026 leave |
| 14 Sep 2026 | **A Sunday tag can stand completely alone — and a block can be missing one.** Her **Sun 22 Mar** tag has no grid day near it (nearest 9 Mar and 8 May) and sits in a week of solid working shifts: a one-day absence from a rostered Sunday, invisible to the app and to the grid alike. The mirror is on the same person — **Sun 6 Sep** (rostered, between a booked Sat and a rest-day Mon) and **Sun 15 Nov** (rostered, straight after 13–14 Nov) are both untagged. Recorded as §0 step 3 rather than resolved: an absent tag is silence, not evidence she worked. **Unresolved.** | Same |
| 14 Sep 2026 | **A completely clean reconciliation, which is worth logging precisely because nothing was wrong.** N. Tuck: one totals row, column E empty AND uncommented, 26 grid cells on 26 distinct dates, 26 of 32 used, 6 remaining — and all 26 land on contracted days, so `consumesEntitlement` agrees with the sheet day for day with no swap data needed. The first member of the nine looked at today with no duplicate row, no over-quota day, no −1 and no rest-day gap. | Same |
| 14 Sep 2026 | **THE SUNDAY-TAG RATIO, COUNTED IN FULL — and every earlier figure in this file was wrong.** All 75 CEA-block tags classified against each member's own base roster: **31 named shift (41%), 21 spare (28%), 23 rest day (31%)**; contracted = **52 of 75, 69%**. The named-shift case is a MINORITY. Four successive statements here ("the ordinary case", "a majority", "eight of fourteen", "twelve of twenty-three") were all artefacts of asking about whoever the owner happened to raise that day. **A population question is not answerable from a running tally of answered questions**, and the lesson is worth more than the ratio. | Owner asked for R. Forester-Blackstock's 2026 leave |
| 14 Sep 2026 | **OWNER CORRECTION: the census measures the PATTERN, not the published roster.** Told that F-Charles's 3/10 May and Atrakimaviciene's 5 Jul were missing from their answers, the owner replied they are *"already on the roster"* — `getBaseShift` returns the rotating pattern, and the week the depot publishes can change any day of it, with the roster import writing that into the app. So a tag on a pattern shift may be a day the app already shows as off, and **31 named-shift tags is an upper bound rather than a count**. Recorded against §4 with the exact check that would settle it (resolve each tag date through `resolveEffectiveShift` with the overrides loaded). It moves the conclusion further in the direction it already went. | Owner: "The last two away things are already on the roster" |
| 14 Sep 2026 | **§0 CONFIRMED AGAINST THE APP, and it is worse than a short answer.** Owner read `F-Blackstock . R` off the app as **7 remaining** against the workbook's 6. The gap is exactly one day and it is her over-quota `29/12` — all 25 grid days consume, so nothing else can explain it. The consequence now recorded in §5: an over-quota day should be **RECORDED in the app**, or that member's balance stays a day generous for the rest of the year and the discrepancy returns every time anybody looks. **A one-day app-vs-sheet gap is column E until proved otherwise.** | Owner: "I have 7 remaining for Romiah, where is the other booked day" |
| 14 Sep 2026 | **A DAY WAS LOST BETWEEN THE EXTRACTION AND THE TABLE — owner caught it.** `F-Blackstock . R`'s **Sat 31 Jan** stands alone (Friday worked, Sunday rostered and untagged), so it had no block to join and fell out of the grouped answer while the stated total, 26, stayed right. §4 now carries the check: **sum the deducted column and it must equal grid days + column E**. The reader cannot perform it, and the asymmetry is that losing a day makes the answer look TIDIER — an isolated single day is exactly the row a summary wants to drop. | Owner: "Where is the 31st of Jan is your original list you gave to me?" |
| 14 Sep 2026 | **TWO MARYLEBONE REGISTERS IN ONE FILE — the stale one is 2021.** `S. Langley` has a totals row on each, reading 23 used / 9 remaining on the live sheet and **0 used / 32 remaining** on `Marylebone Totals`, whose calendar runs 1 Jan 2021 – 1 Jan 2022. The stale row is indistinguishable from a live one without looking at the sheet name. Recorded as §8 defect 7. It also **corrects defect 5**: c/f is not "barely used", it is used on **none** of the live sheet's 47 rows, while twelve 2021 rows carry one — so §9's carry-forward question is sharper than it read (the depot has tracked it, the current register does not, and neither does the app). | Owner asked for S. Langley's 2026 leave |
| 14 Sep 2026 | **§5 is FIVE for five, and the app-is-short case is not a one-off.** `Silva . S`'s `02/01` lands on a Friday whose four CEA slots hold Mylla, Miller, Reen and F-Blackstock. Her 19 grid days against a column E of 1 mean **the app will read 13 where the sheet says 12** — the second instance of the gap F-Blackstock's 7-vs-6 exposed, one member later. Recorded in §5: every member carrying a column-E value is in this state until it is entered, which is at least five people. Her own figures otherwise reconcile exactly: 19 distinct dates, all contracted, 20 of 32 used, 12 remaining. Also the longest absence seen yet — **16–28 Jun, thirteen continuous days for six deductions**, which is the case for giving days AWAY rather than a count. | Owner asked for S. Silva's 2026 leave |
| 14 Sep 2026 | **§8.6 CONFIRMED — `Sumali . J`'s `10/04` is a real over-quota day**, and two new §10 questions raised from it. A working day for her, mid-absence, on a Friday whose four CEA slots are full (Robson, Gherbi, Nsuala, Miller): the same shape as the other five, so **§5 is six for six** and **E17 should read 1**. Her row is the file's worst case — the formula says 0, the comment says −1, and the app says 2, because two of her booked days (**13 and 14 May**) are rest days on her pattern and `consumesEntitlement` refuses them. The `Sumali`/`Sumaili` spelling was checked for silent COUNTIF loss and is CLEAR: all 32 grid cells use one spelling, only a tag uses the other. Third person at −1, with Haque and Reen. | Owner asked for J. Sumaili's 2026 leave |
| 14 Sep 2026 | **THE WORKBOOK CANNOT SETTLE A REST-DAY BOOKING, and that is structural.** Asked what `Sumali . J`'s 13–14 May actually show, the answer is: a plain booking in slot F, identical to the days either side, no marker of any kind — the tail of one run from 8 to 14 May. The sheet allocates QUOTA SLOTS and has no concept of a rest day, so a rest-day booking is invisible in it by design and nothing looks wrong. Recorded against §10.11 with what turns on it: a swap means she is genuinely at 33 of 32; genuine rest days mean two days were deducted that cost her nothing and she is at 31 with a day in hand. **The same mechanism could explain any of the three −1 rows.** Also noted: Sun 10 May carries no tag for her although her block runs through it — more evidence that a missing tag means nothing. | Owner: "But the 13th and 14th of May are showing what in the spreadsheet?" |
| 14 Sep 2026 | **THE CHECK ADDED AN HOUR EARLIER WAS ITSELF TOO WEAK — owner caught it.** §4 said "sum the deducted column", and that passed on a `Sumali . J` table that had **dropped 21 May and duplicated 23 Dec**: an omission and a duplicate cancel, so the total read 33 and the arithmetic endorsed an answer containing two errors. The rule is now **compare the SET of distinct dates**, under which a duplicate is as visible as a gap. Two failures of the same family in one hour, on consecutive members — and the second was caught by the reader, not the check. | Owner: "Why do you have 20th and 21st of May in one table and only 20th of May in the other?" |
| 14 Sep 2026 | **OWNER FACT, PARKED: Employee of the Month earns ONE EXTRA AL DAY.** Neither system holds it — the workbook's allowance column is a flat 32 for every CEA and `getALEntitlement` returns a flat 32 too. **It may explain the −1 rows**: a person with an award is entitled to 33, so taking 33 is correct and the negative is an artefact of a column that cannot express the award, not an overdraw. Recorded in §9 beside carry-forward, which is the same shape — a real, owner-known entitlement adjustment with nowhere to live. Explicitly **not actioned**: *"We will revisit that thought another day."* | Owner, unprompted, on the −1 rows |
| 14 Sep 2026 | **A COLUMN-E CELL CAN HOLD SEVERAL DATES, AS A COMMENT THREAD — and the separator varies inside it.** `Bibi . T`'s E14 is 3, and its comment body reads `16/04` with two REPLIES adding `20/08` and `19.08` — note the full stop in the third. Reading the body alone would have found one date for a cell worth three. All three verified full on the day (nine for nine overall), so the app will read **3** against the sheet's 0, the largest of these gaps yet. Recorded in §5. Her own row reconciles exactly: 29 grid days, 3 over quota, 32 of 32, 0 remaining, none on a rest day. One Sunday tag all year despite heavy leave, with rostered Sundays 11 and 18 Oct sitting inside her October block untagged. | Owner asked for T. Bibi's 2026 leave |
| 14 Sep 2026 | **A SECOND COMPLETELY CLEAN ROW, and the longest absence in the file.** `Nsuala . T`: one totals row, no 2021 row, column E empty AND uncommented, one consistent spelling, 29 grid days on 29 distinct dates, all on contracted days — so the app agrees at 3 remaining with nothing to reconcile and no swap question. Her **7–20 Apr is fourteen continuous days for eight days' leave**, the longest run yet, bracketed by rest days and spanning two tagged Sundays. She is also the first member whose tags are **all on non-working days** (three rest, one spare, none on a named shift) — an example of the 59% the full census says is the majority case. | Owner asked for T. Nsuala's 2026 leave |
| 14 Sep 2026 | **A REVERSED TAG READ AS A BOOKING — caught in this session, on `Irvine . D`.** Her Sun 9 Aug cell is `D Irvine N/A`, name before state, so a `startswith("N/A")` test filed it as a 33rd booked day — adding a day she never took, on the one weekday that cannot hold AL. `Okeke . M`'s 4 Oct tag is the same shape and was logged as a curiosity; this is it doing damage. §7 now says to test for the state ANYWHERE in the cell and to cross-check against the row's `COUNTIF`, which is immune (it correctly said 32). Also found there: a cell holding **twenty spaces**, which `is None` does not catch. | Owner asked for D. Irvine's 2026 leave |
| 14 Sep 2026 | **THE BILINGUAL CHECK IS NOW COMPLETE — both members, both systems, agreed.** `bilingualContract: true` is set on exactly two people in the app (`D. Irvine`, `T. Gherbi`), and BOTH carry `BLCEA` with a **34** allowance in the workbook. That is the whole bilingual population, so §3's rule is as tested as it can be. | Owner asked for T. Gherbi's 2026 leave |
| 14 Sep 2026 | **THE FIRST ROW WHERE APP AND SHEET AGREE ON A NEGATIVE — and the cleanest test of the award question.** `Reen . C` is on the fixed Mon–Fri 12:00–19:00 line, so all 33 of her grid days are working days and every weekend is already a rest day. Column E empty AND uncommented, no duplicate row, no rest-day booking, no missing tag: the app will read −1 too. **There is no bookkeeping explanation available for her**, which makes her the sharpest case for §9's parked Employee-of-the-Month question — either she holds an extra day or she is genuinely one over. Her 15–31 Dec is **seventeen continuous days**, the longest in the file. She has no Sunday tags at all, which is RATIONAL on a Mon–Fri line (the tag exists to bridge an N/A Sunday row) rather than another instance of the discretionary tagging. | Owner asked for C. Reen's 2026 leave |
| 14 Sep 2026 | **THE PRO-RATA CHECK PASSES A SECOND TIME, on a JOINER WITH A ROSTER CHANGE.** `Jedlinski . K`'s workbook allowance is **18**, and the app's `proRatedAL[2026]` is 18 — she started 3 Jun 2026 and also carries a `rosterChanges` entry moving her off the fixed Mon–Fri line to the main link on 28 Jun. §9 calls this the cheapest real check in the reconciliation; it has now passed on both joiners it has been run against (Okeke 24, Jedlinski 18). Her row is otherwise clean: 4 grid days, all working days, column E empty and uncommented, app agrees at 14. | Owner asked for K. Jedlinski's 2026 leave |
| 14 Sep 2026 | **A THIRD LARGE UNUSED BALANCE, and the starkest.** She has taken **4 of 18** — one six-day absence in late August — with under four months of the year left. Same shape as `Cooper . I` (11 left) and `Panchal . A` (9 left), which §12 logged as unanswered, but proportionally much worse: under a quarter of a PRO-RATED allowance used. Worth putting to the owner as a group rather than one at a time. | Same |
| 14 Sep 2026 | **A SHORT SURNAME SUBSTRING-MATCHES A PLACE NAME.** Sweeping for `'reen'` reported `Reen . C` on the South Bucks sheets — which would have meant a member appearing at a second location. It is **"Beaconsfield & Seer Green"**. Caught by reading the cell before reporting it; §7 now says to confirm every cross-sheet hit that way, and notes that this workbook covers every Chiltern location rather than Marylebone alone. | Same |
| 14 Sep 2026 | **§5 reaches TEN for ten, and a SEVENTH member the app is generous for.** `Gherbi . T`'s `23/02` lands on a Monday whose four CEA slots hold Mylla, Irvine, Panchal and Miller. Her 30 grid days are all contracted, so the app will read **4** against the sheet's 3. Running total of column-E days missing from the app: **nine, across seven members** (Davies, Cooper, F-Charles, F-Blackstock, Silva, Bibi×3, Gherbi). Four more untagged Sundays sit inside or beside her leave (22 Feb, 5 Apr, 12 Apr, 16 Aug), consistent with the census finding that tagging is discretionary. | Same |
| 14 Sep 2026 | **A clean positive for the BLCEA rule, and a third clean row.** `Irvine . D` is `BLCEA` with an allowance of **34**, and the app returns 34 for her because `bilingualContract: true` — §3's rule holding on another member. No over-quota day, no duplicate row, no 2021 row, 32 grid days all on contracted days, so the app agrees at 2 remaining. Her **7–21 Jun is fifteen continuous days for seven days' leave**, the longest absence in the file, displacing Nsuala's fourteen. | Same |
| 14 Sep 2026 | **S. Langley reconciles exactly.** 23 grid days on 23 distinct dates, column E empty AND uncommented, 9 of 32 remaining, all 23 on contracted days so the app agrees with no swap data. Four tags, three on a named shift and one on a spare. Her 24 Jul – 2 Aug absence is **ten continuous days** carrying only six deductions — the longest run yet seen, and a good illustration of why the answer gives days AWAY and marks which cost entitlement. | Same |
| 14 Sep 2026 | **THREE TAGS CARRY A BARE FIRST NAME, and two answers given today were SHORT because of it.** `Romiah` (= `F-Blackstock . R`), `Csherrice` (= `F-Charles . C`) and `Loreta` (= `Atrakimaviciene . L`) appear with no surname and no initial, so every surname scan this file recommends missed them: **C. Francisco-Charles was away 3 and 10 May and L. Atrakimaviciene on 5 Jul**, and neither was listed. Resolved by SLOT COLUMN — a leave block keeps one slot letter, so the Sunday cell in that column belongs to whoever holds the days either side. `Romiah` is additionally pinned by `Frimpong . R` being tagged by surname. Also found: `Sumali . J` / `Sumaili . J` in one sheet, and `N/A L Springer NA`. | Same |
| 14 Sep 2026 | **§5's mechanism is now FOUR for four.** `F-Blackstock . R`'s `29/12` lands on a Tue 29 Dec whose four CEA slots are full (Davies, Reen, Mylla, Silva) — the Davies / Cooper / F-Charles shape again. Her own figures reconcile exactly: one totals row, 25 grid days on 25 distinct dates, +1 over quota, 26 of 32 used, 6 remaining, and all 26 on contracted days so the app agrees day for day. | Same |
