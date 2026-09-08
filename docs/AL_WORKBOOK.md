# AL_WORKBOOK.md — the depot annual-leave workbook

*Started 8 Sep 2026. Not version-stamped; not a runtime asset.*

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
| `Marylebone Block` | ⚠️ unexamined | A per-person Week 1–4 grid, same four-state legend. Purpose not established. [unknown] |
| Every other location's sheets | ❌ no | Other depots. |

---

## 3 · How one person's figure is built

Each row of `New Marylebone Totals` is:

| Col | Header | Source |
|---|---|---|
| A | Role | typed — `CEA` · `BLCEA` · `CES` · `DISP` |
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

---

## 5 · "AL over depot quota" — the column that is not in the grid

*These days go in the answer. §0 is the rule; this is the mechanism.*

**What it is [inferred, strongly]:** annual leave that was **granted on a day the quota was already
full**, so there was no slot to write the name in. It is deducted from Remaining without ever
appearing in the calendar.

**Where the dates live — and the trap.** Each column-E value carries a **threaded comment naming the
date(s)**. The comment count matches the value in every case checked. [measured]

> **`openpyxl` does not show these.** `cell.comment.text` returns Excel's legacy placeholder
> ("Your version of Excel allows you to read this threaded comment…"). The real text is in
> `xl/threadedComments/*.xml` inside the .xlsx. See §6 for the recipe. **Not knowing this produced a
> confident, wrong "there is no explanation anywhere in the workbook".**

**Worked example — J. Davies, 2026.** Allowance 20, grid days 19, over-quota 1, remaining 0.
His comment reads `24/12`, and the grid says why:

| Thu 24 Dec 2026 | slot C | D | E | F |
|---|---|---|---|---|
| | Reen . C | Sumali . J | Silva . S | Okeke . M |

All four CEA slots taken. Davies is booked 22 and 23 Dec, then 28 and 29 Dec — Christmas Eve sits in
the middle of one continuous absence and was granted as a fifth person, over quota. His year is
**20 days: 19 in the grid + 24 Dec.**

**The exception to the pattern.** One value is a lump with no dates: a comment reading
`A/L FROM PRE JUNE 2026` [measured]. So column E is *also* used for a balance carried in from
elsewhere. Read the comment before assuming the value means over-quota days.

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

There is one comment file per sheet and they are **not** named after the sheet. Identify the totals
sheet's file by the cell refs it contains (column E rows in the 6–75 range).

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
| `Boyle . A` | `S. Boyle` | 0 |

**Management accounts are absent from the workbook, correctly** — they hold no roster line, so they
have no quota slots. Do not read their absence as a gap.

**The free-text Sunday tags are not a name source.** They are typed by hand and drift wildly —
first-name-only forms, nicknames, and misspellings all appear. Use them to *locate* a Sunday inside
a block, never to identify a person.

---

## 8 · Known defects in the workbook itself

Every one of these is silent, and every one has been seen. [measured]

1. **Duplicate person rows.** Some people appear twice in `New Marylebone Totals` with *different*
   figures — one pair differs by exactly the over-quota day, so the two rows report a different
   Remaining for the same person. One pair also spans grades (a CES listed once as CEA with zero
   days, evidently stale). **Always check whether a name appears more than once before quoting a
   figure.**
2. **A person in the workbook who is not on the app roster** — `Barnard . M`, with real 2026
   bookings (1–5 Jun) and a matching name on the 2021 sheet. See §10.
3. **An off-by-one COUNTIF range.** Two rows count `G2:H367` where their neighbours count
   `G2:H368`. Harmless today — the excluded row is 2 Jan 2027 and is `Closed` — but it is the sort
   of thing that becomes wrong when the sheet is extended.
4. **The over-quota column is hand-typed.** It cannot be derived, checked or recomputed from
   anything else in the file. If the comment is missing, the date is gone.
5. **Carry-forward is barely used.** Only one row carries a c/f value, and it is on a row that looks
   stale. **The app has no concept of carry-forward at all** — see §9.

---

## 9 · Where the app and the workbook legitimately disagree

The app counts AL from **Firestore overrides**; the workbook counts from **quota slots plus a
hand-typed column**. They are measuring different things, so equality is not the test — *explained*
difference is.

| Difference | Direction | Why |
|---|---|---|
| **Over-quota days** | app shows **more** remaining | The day is real leave but exists only in column E. The app cannot know about it unless somebody records it in Change a Shift. |
| **Sundays inside a block** | agree (both exclude) | Both refuse leave on an uncontracted day. |
| **Carry-forward** | app shows **less** entitlement | `getALEntitlement` has no c/f input. Currently near-theoretical; it stops being so the moment a c/f value appears on a live row. |
| **Pro-rated joining year** | should agree | The workbook's allowance for a joiner should equal the app's `proRatedAL[2026]`. Check it — this is the cheapest real check in the whole reconciliation. |
| **Dispatcher lieu days** | check | The app adds one lieu day per bank holiday worked. Whether the workbook's allowance for a Dispatcher already includes them is **[unknown]**. |
| **Leavers** | app may show a stale row | A leaver is `hidden` in the app but keeps their workbook row and figures. |

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
