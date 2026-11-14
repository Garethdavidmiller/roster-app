# Annual leave uploader — plan of record

*Written 14 November 2026 against v26.09 · reviewed (draft 2) · **Phases 0 and 1 BUILT in v26.11, check
only**; Phase 2 not started, and decided only after Phase 1 has been used (decision 1, §10)*

**How to read this.** Part 1 is the plan, and Part 2 the review of its first draft: three separate
reviews, what each found, and what changed because of it. **§10 records the owner's decisions and
§12 what the build changed from the plan** — read §12 before trusting a detail in §3–§4, because the
modules are the authority on what was built: the format is `al-leave-file.js`, the comparison
`al-leave-compare.js`, the card `operations-al-sheet.js`, the session's method
`scripts/make-leave-file.mjs`, each in its own header. The plan names nobody: every person in an
example is invented, because this repository is public and the Pages mirror serves it.

---

# Part 1 — The plan

## 1. What you asked for

You upload the clerks' annual-leave workbook here, in a Claude session. Claude reads it, as it did
today, and produces a clean, simple **leave file**. You upload the leave file into the app, on **its
own card on Operations** (your decision, 14 Nov 2026). The app compares the file with what it
already holds, shows you the differences, and on your say-so records the changes, the way the weekly
roster uploader does.

## 2. The shape: two stages, and a contract between them

```
Clerks' workbook ──► Stage 1: a session ──► leave file ──► Stage 2: the app ──► leave records
 messy, 23 sheets,     Claude and you           strict,       compare, review,
 12 known defects      settle every question    simple        checked save
```

**Stage 1 does all the judgement; Stage 2 does all the writing.** The leave file between them is a
*contract*: a format so strict that the app can refuse anything that does not fit it exactly.

The pattern has a name: an **anti-corruption layer**, a translation step that stops a messy outside
system's quirks leaking into yours. Nobody here can change the workbook, and `docs/AL_WORKBOOK.md`
lists twelve ways it goes silently wrong. Without the layer, every one of those would become code in
the app.

**Three ways it could have been built:**

| Option | Why not |
|---|---|
| The app reads the `.xlsx` itself | It needs a spreadsheet library in the browser, which the no-build rule makes a discuss-first decision. And every quirk becomes app code that must be right with nobody watching: misspelt names, first-name Sunday tags, dates hidden in comments. |
| A Cloud Function asks Claude to read it, as the roster PDF is read | The roster import needed four layers of defence to stop one model read putting a week on the wrong days. The workbook's ambiguities need a person's answer, not a better prompt. |
| **Chosen: a session makes the file; the app checks and writes** | The judgement happens where a person can answer questions. The app's part is small, strict and testable. The raw workbook, which covers every Chiltern location and has comments about named people, never reaches the app's servers. |

**`AL_WORKBOOK.md` §11 set three conditions before any uploader. Stated honestly:**

1. *A stable identity join.* Met, by a name map that persists between sessions (§3.4). The leave
   file carries only the app's own names, and an unknown name stops the file being made.
2. *The over-quota column readable without a human.* **Not met: deliberately waived.** A human stays
   in the loop instead. The session reads the column, and anything it cannot place becomes a
   question for you.
3. *A decision about what an import would DO.* This plan is that decision. The phasing (§8) ships
   the safe half, compare and report, before anything writes.

## 3. Stage 1 — making the leave file

### 3.1 What you do

1. In a session, upload the workbook **and the last leave file you made**. That earlier file holds
   the name map (§3.4). Then ask for a new leave file.
2. Answer any questions: a name it cannot match, or a comment it cannot place.
3. Receive two files in the chat: the **leave file** (`.json`) for the app, and a **day-by-day PDF**
   of the same content, for you to read. Save both to your phone. Keep the latest leave file and
   delete older ones.

### 3.2 What the session does

It follows `AL_WORKBOOK.md`, which is the method:

- It hashes the file. It reads the clerks' last save and **who** made it (§1): if somebody other than
  a clerk saved it last, the date says less, and the file records that.
- It chooses the calendar sheet **by its first date**, never by its name, so next year's copy cannot
  be read as this year's.
- It reads the grid by grade block, column E's comments (scoped to the totals sheet, §6), Sunday
  tags (first names resolved by slot column, §7), misspellings (§8 defect 9), duplicate rows, people
  with no totals row, and joiners' pro-rating (§5).
- It **refuses rather than guesses**. A question it cannot settle is put to you, and the file is not
  made until it is answered.

### 3.3 One format module, shared by both stages

The leave file's rules live in **one JavaScript module**. It is used by the Stage 1 script, written
in Node and reading the `.xlsx` with Node's own zip support, so no new dependency. It is also used
by the app's card. One module means the two stages can never disagree about what a valid file is,
or how its digest is worked out. No CI lane runs Python, so a Python script would have been a second
implementation nobody tested against the first. The module ships first, in Phase 0, so the format
has a real reader from day one.

### 3.4 The name map persists, and is an input, never a guess

Matching a sheet row to an app member is mostly mechanical: `Surname . I` against `I. Surname`.
**The exceptions are personal facts.** `AL_WORKBOOK.md` §7 withholds them on purpose: initials that
differ, misspellings, a person known by another name. So the map is never committed. Two reasons it
must still persist:

- **Determinism.** Two sessions must make the same file from the same workbook. A session that
  "asks you again" in a fresh container can be answered differently.
- **The leave file is itself a complete map**: every person in it carries both spellings. So the
  previous leave file is the input that carries the map forward. The script refuses to run without
  it, or without an explicit "first run" flag, which makes it ask about every match that is not
  mechanical. The file it makes records the hash of the map it used, the script's commit and the app
  version.

### 3.5 The leave file format

*Draft 2's sketch. The built format differs in three places (§12), and `al-leave-file.js` is its authority.*

One JSON file per upload, e.g. `leave-2026-as-of-2026-11-06.leave.json`. With invented people:

```json
{
  "format": "myb-annual-leave",
  "version": 1,
  "year": 2026,
  "source": {
    "sha256": "482bd886…",
    "firstDate": "2026-01-01",
    "lastDate": "2027-01-02",
    "clerksLastSaved": "2026-11-06T14:07:00Z",
    "lastSavedByClerk": true
  },
  "made": { "on": "2026-11-14", "script": "<commit>", "appVersion": "26.09", "nameMap": "<sha256>" },
  "people": [
    {
      "name": "A. Example",
      "grade": "CEA",
      "sheetRows": [
        { "row": 12, "spelt": "Example . A", "used": true },
        { "row": 31, "spelt": "Example . A", "used": false, "why": "duplicate-identical" }
      ],
      "coverage": { "from": "2026-01-01", "to": "2027-01-02", "complete": true },
      "printed": { "carriedForward": 0, "allowance": 32, "used": 30, "columnE": 1, "remaining": 1 },
      "columnE": { "datedDays": 1, "joinerReduction": 0, "lump": 0, "unexplained": 0 },
      "corrected": { "remaining": 1, "because": [] }
    }
  ],
  "days": [
    { "name": "A. Example", "date": "2026-02-06", "kind": "leave", "foundIn": "grid", "countedBySheet": true },
    { "name": "A. Example", "date": "2026-02-24", "kind": "leave", "foundIn": "column-e", "countedBySheet": true },
    { "name": "A. Example", "date": "2026-03-01", "kind": "sunday-tag", "foundIn": "grid-tag", "countedBySheet": false },
    { "name": "A. Example", "date": "2027-01-02", "kind": "leave", "foundIn": "grid", "countedBySheet": true, "leaveYear": 2026 }
  ],
  "absentFromWorkbook": ["B. Example"],
  "notImported": [{ "name": "C. Example", "reason": "leaver" }],
  "digest": "sha256:…"
}
```

**The rules the format holds:**

- **Dates are full ISO dates.** Their range is the sheet's own grid, which runs **into the next
  January** (`AL_WORKBOOK.md` §2: to 2 Jan 2027). A next-January day that the sheet charges to this
  year carries `leaveYear` (the app's per-day carry-over, which its rules already accept). A
  `leaveYear` already on an app record is kept, and one is never invented.
- **Names are the app's own.** `sheetRows` records every row the sheet has for a person, which one
  was used and why. A single row number could not express the three duplicate pairs (§8 defect 6).
- **Column E is split into its parts**, because one number hides six different things: dated
  over-quota days, a joiner's reduction, the pre-June lump, an unexplained remainder, a value with no
  comment, and a comment with no value.
- **Every day says where it was found and whether the sheet counts it** (`foundIn`, `countedBySheet`).
  Three kinds:
  - `leave` is a day the app may record.
  - `sunday-tag` is a free-text Sunday tag. It is never leave.
  - `sunday-counted` is a plain name in a Sunday cell. The sheet counts it, but the app cannot hold
    it (§4).
- **The file says what it covers.** Each person has a `coverage`. `absentFromWorkbook` lists app
  members with no row, and `notImported` lists people left out, each with a reason code from a fixed
  list. There is no free text to render.
- **The app re-checks the sums itself**, against the sheet's own printed figures:
  - grid days found = the printed Used;
  - dated column-E days, plus its other parts = the printed column E;
  - carried forward + allowance − (Used + column E) = the printed Remaining.

  A day dropped in Stage 1 then fails in Stage 2. It does not pass because Stage 1 marked its own
  work.
- **`digest`** is SHA-256 over one canonical form of everything except the digest itself: sorted
  keys, no spaces, UTF-8. The form is defined in the shared module and pinned by a shared test
  vector. It catches a file edited by hand. Corrections go back through a session.

### 3.6 Privacy, enforced rather than promised

The leave file is personal data: names against dates of leave. The repository is public, and the
Pages mirror serves every committed file.

- **The script never writes inside the repository.** Its output goes to the session's scratch
  space, then to you.
- **`.gitignore`** gains `*.leave.json` and `*.local.json`, each with a guard test. A test also
  fails if any tracked file contains `"format": "myb-annual-leave"`.
- **Tests use invented people and invented dates.** The synthetic workbook is built when the tests
  run (`.xlsx` is ignored), and its figures are invented too. Real joiner dates would identify a real
  joiner, because `roster-member-data.js` already quotes one. The card's tests pass the reader an
  invented member table, so no real name is ever needed.
- **The copies the file leaves, named:** the chat itself, the phone's Files or Downloads, any cloud
  backup of them, and the clipboard if you paste. Delete superseded files. The app keeps nothing of
  the file.
- **No error quotes the file.** A JSON parse error carries a slice of its input, and the error log
  keeps 300 characters of any uncaught error (`error-reporter.js`). So every refusal is caught and
  returned, never thrown.

## 4. Stage 2 — the card on Operations

### 4.1 Where, and who

**Its own card on Operations, "Annual leave upload"**, separate from the weekly roster upload.
Operations is admin-only (`auth-policy.js`), so only you can use it.

`operations-app.js` is at its size cap (837 of 837 lines, `coordinator-ratchet.test.mjs`). So the
card lives in its own modules and the page only wires it in, which means first moving a few lines
out of `operations-app.js`. That is part of the work, not a surprise.

### 4.2 Getting the file in

- **A file picker that accepts the file on both phones.** Android may grey out a `.json` the phone
  thinks is plain text, so the picker's `accept` is widened.
- **A paste box as the fallback**, as the Pay Calculator's restore has.
- Tests set the file directly and so skip the phone's picker, so this is **checked by hand on a real
  iPhone and a real Android phone** before Phase 1 is called done.

### 4.3 Reading the file: refuse by name, never default

The posture of `validateBackup` (`paycalc-transfer.js`) and `parseDesignImport` (`links-import.js`):
anything that does not fit is refused, and the refusal says exactly what and where.

- `format`, `version` and `year` are recognised, and the digest is recomputed and matches.
- Every name in `days` is someone the app can record leave for: in `teamMembers`, not `hidden`, not
  `managerOnly`, and with an allowance on record. Anybody else belongs in `notImported`.
- Every date is real and in range, with one entry per person per date. There is no Sunday leave,
  and nothing on 25 or 26 December.
- The sums in §3.5 hold for every person.
- **Refusals are returned, never thrown** (§3.6).

### 4.4 Reading what the app holds

- **One read per member, covering every date** (`where('memberName','==',…)`). That is the scope
  Admin settled on (`admin-override-coverage.js`: "WHY THE SCOPE IS A MEMBER AND NOT A DATE
  WINDOW"). A date window would miss the next January's carried days, the Sundays either side of New
  Year, and the bank holidays a Dispatcher's allowance depends on.
- **A read served from the phone's offline cache is a failed read.** Offline, Firestore does not
  fail: it answers from the cache, which can be partial or empty (`refuseCachedRead`,
  `admin-override-store.js`). The review does not open on one.
- Rows are built with `overrideFromSnapshot`, so a record this device has saved but not yet sent is
  read as its own copy.

### 4.5 Deciding each day: the range card's own answer, never a restatement

Each person's days are classified by **`projectAlBooking` (`admin-al-projection.js`), the same pure
function the Admin AL card uses**. A test pins that, for the same dates and records, the uploader and
the range card agree. The uploader adds only what is specific to an upload. It always looks at **the
record that wins the day**, resolved first.

| What the app holds that day | Uploader |
|---|---|
| Nothing, and the pattern has them working | **Add leave**: proposed, and confirmed per person (§4.6) |
| Leave that counts as the sheet counts it | **Already right**: nothing |
| Leave on a rest day that the app treats as free, which the sheet charges | **Ask** "Was it a swapped working day?", as Admin asks again. Swapped: the record is rewritten with `replacedType: 'shift'`. Unanswered: nothing |
| Nothing, on a rest day | **Ask** the same question. Unanswered: nothing |
| A shift, an Absent day or a correction | **Conflict**: both shown, unticked. Ticking replaces it with leave, and keeps `replacedType`, so a swapped-in day still costs a day |
| RDW, an Other day or a Spare turn | **Conflict**, unticked. *Here the uploader deliberately differs from the range card*, which writes free leave over these inside a range a person chose. In an upload nobody chose the day, and overwriting a worked RDW removes evidence of pay |
| Before the member's start date | Nothing, ever |
| A Sunday | Never leave. No Sunday corrections before Phase 3 (§4.11) |

**App-only leave** is leave in the app on a date the sheet does not have. It comes from a separate
pass over the person's records, because a loop over the file's dates can never find it. It is shown
and never ticked. Removal is out of scope (§4.10).

### 4.6 Leave cancelled in the app must not come back

**The workbook is always older than the upload, and a deletion leaves no record.** If a manager
cancels a day of leave in the app after the clerks' last save, the sheet still shows that day, and a
ticked "Add leave" would put it straight back. Admin's own code names this hazard for a stale page:
"RESURRECT leave cancelled on another device since". There are three defences, used together:

1. **An upload log.** This is one small admin-only collection (proposed name `alUploads`), with one
   document per Save. It holds the clerks' last-save time, the file's hash, and the person-and-date
   pairs the Save brought into line. On the next upload, a sheet day that the log says was brought
   in, and that the app no longer holds, was **removed in the app since**. It is shown as such and
   left unticked. A day that is new on the sheet is proposed. The log is also **where each uploaded
   day records where it came from**, without changing the leave records themselves.
2. **Older files are refused.** A file whose clerks' save is older than one already uploaded is
   refused by name ("you uploaded a newer copy, saved 6 Nov, on 14 Nov"). The same file again is
   allowed: what its last Save wrote shows as already right, so a Save that stopped half way is
   finished by uploading it again.
3. **Confirmation per person, not one "Accept all".** Each person's additions are confirmed on their
   own row, with the file's age in plain view ("the clerks last saved this 8 days ago"). A file
   older than a limit you choose asks you to get a fresh copy first (decision 4).

The first upload has no log, so its exposure is the days between the clerks' save and the upload.
That is what the age display and the limit are for.

### 4.7 The per-person check

For each person, side by side:

- **the sheet**: its printed figures, and the corrected figure where its own total misses a day;
- **the app now** (`alPosition`);
- **the app after this Save**.

The "after" projection must carry `replacedType` and `leaveYear` on the days it writes.
`overridesAfterSave` drops both today, which would show a swapped rest day as free.

When "after" will not equal the sheet, the row says why: a rest day left free, an undated over-quota
day, carried January days, a Boxing Day day in lieu, a Dispatcher's bank-holiday lieu day lost to
leave, or the sheet counting a Sunday.

### 4.8 The review screen, on a phone

- At the top: the file's age, and counts (*n to add, n to answer, n conflicts, n already right*).
- **Needs your answer** comes first: conflicts, rest days, and days removed in the app since the
  last upload.
- Then one row per person, with their figures, their counts and a **Confirm** for their additions.
  Tap a row to see the days. Nothing is saved for a person whose row is not confirmed.
- The Save button names what it will do: *Save 412 days for 37 people*.
- **Nothing of a half-answered review is kept on the device**, because it is personal data. Leaving
  the page asks first, and **an app update waits** while the review is open or a Save is running: the
  card joins `_opsBusy` in `operations-app.js`.

### 4.9 Saving

The same discipline as every other save (`.claude/rules/admin.md` → "Every save of a day is
CHECKED"), with one difference from the roster import that matters:

- **Every part is checked, additions included.** The roster import may add in plain batches only
  because its records take random ids and lose to manual ones (`roster-import-save.js`). The uploader
  writes **manual records at fixed ids** (`m_<date>_<name>`), exactly as the Admin AL card does. So a
  plain-batch add would silently replace whatever a manager saved there after the review loaded.
- **The checked commit.** Each day must still hold what the review loaded, and each fixed id must
  hold nothing the review did not see. `commitChecked` looks records up in Admin's page cache, which
  Operations never fills. So the uploader either passes every record it touches as a row (supported
  today), or `commitChecked` gets a small, tested change to take the page's own lookup. Either way,
  Admin's saves keep their behaviour, and Admin's existing tests are the proof.
- **Offline, the Save is refused, not held.** A held batch cannot be checked.
- **The records are written with `buildOverrideWrite`**: `source: 'manual'`, `changedBy` your name.
  `replacedType` is carried by `nextReplacedType`, or by `replacedTypeForSwap` for an answered swap.
  `leaveYear` is carried by `nextLeaveYear`, or comes from the file for a next-January day. Older
  manual copies of a day are deleted with it, as Admin's `idsReplacedBy` does. **No rules change is
  needed for any of this.**
- **Chunked per person**, under Firestore's limit of 500 writes (`chunkByWrites`, 450).
- **A refusal keeps your answers.** The roster import learned this the hard way: its answers reset to
  their defaults, and "a second Save wrote rows the admin had unticked" (`carryReviewAnswers`). Only
  the days that changed are asked again.
- **Before the receipt says what was saved, the app reads again.** A part that ended with no answer
  from the server may still have landed. The upload log is written last, from that re-read.

### 4.10 Undo, and why removal is not planned

**Undo covers additions only**: the leave days this Save created, each removed only if it is
unchanged since. It cannot honestly cover a replaced record. The rules stamp a fresh `createdAt` and
`changedBy` on any rewrite, so a "restored" absence would be a new record claiming to be the old one.

**Removing app-only leave is not planned.** Every way of deciding it is weak:

- `createdAt` is the last write, not when the leave was booked.
- A person with undated over-quota days or carried days cannot be judged from dates.
- Removing leave stamped `replacedType: 'shift'` destroys the only record of a swap.
- A removed day that a roster import wrote comes back, ticked, on that week's next import.

Leave the sheet lacks is shown, and removed by hand in Admin if it should go.

### 4.11 Phase 3: Sunday corrections, and the weekly roster import afterwards

- **Sunday corrections follow the range card's rule, never the clerks' tags.** Admin corrects a
  worked Sunday only inside a range it writes, and in the same commit. A standalone correction
  "would SILENTLY erase a worked … Sunday" (`admin-overrides.js`), and the shared server timestamp is
  how a later period delete recognises the booking's edge Sunday (`computePeriodDeleteIds`). So in
  Phase 3 the uploader would:
  - group the leave days it writes into blocks (`mergeBookedPeriods`);
  - correct the worked Sundays inside those blocks;
  - keep each correction in its leave's batch (`chunkByWrites`'s `keepWithPrevious`).

  Tags are shown beside a Sunday as evidence, and never acted on alone. A past correction also takes
  that Sunday's hours out of the Pay Calculator's "Fill from calendar".
- **The weekly roster import afterwards.** Uploaded leave is a manual record. So a later roster PDF
  that agrees is COVERED, and one that disagrees is a CONFLICT that defaults to keeping the leave,
  exactly as for leave booked by hand. Stale workbook leave would then beat a newer published roster
  by default. With the upload log, the roster review could say where the leave came from, and default
  to the roster for workbook days. That changes the roster import's contract
  (`.claude/rules/roster-import.md`), so it is your decision (decision 8), not a default.

## 5. The rules it obeys, and the code that already says each one

| Rule | Where it lives |
|---|---|
| No leave on a Sunday, ever | `SUNDAY_FORBIDDEN_TYPES` (`override-utils.js`). The uploader becomes the **seventh** enforcement layer, appended to CLAUDE.md's list and never renumbered |
| Leave on a rest day is asked about, never defaulted | `swapDecisionDates`, `replacedTypeForSwap` (`al-swapped-days.js`), through `projectAlBooking` |
| Nothing before a start date | `isBeforeMemberStart`. Note that it takes a `Date`, while `consumesEntitlement` takes an ISO string, so the two are easy to mix up |
| Christmas Day and Boxing Day belong to the app's Christmas leave | `christmas-leave.js` |
| What a day costs | `consumesEntitlement`, `alPosition` (`al-entitlement.js`), with the winner resolved first |
| A save is checked against what the page loaded | `commitChecked` / `commitIfUnchanged` (`admin-override-store.js`) |
| A read from the offline cache is not a read | `refuseCachedRead` (`admin-override-store.js`) |
| A refusal keeps the admin's answers | `carryReviewAnswers` (the roster import's pattern) |

## 6. What it deliberately does not do

- **Change anyone's allowance.** Allowances are code (`proRatedAL`), transcribed in a session. A
  mismatch is reported, not fixed.
- **Read the raw workbook.**
- **Remove leave**, or replace anything you have not ticked.
- **Guess** a name, a date or a year.
- **Write for leavers, managers, or anybody not in the app.**
- **Write the `note` field.** It stays empty, by your earlier decision, which was taken for
  data-protection reasons.
- **Write any Sunday record before Phase 3.**

## 7. Testing

- **The shared format module**: the shared digest test vector; every refusal; the sums in §3.5.
- **The Stage 1 script**, against a synthetic workbook built at test time with invented people,
  dates and figures:
  - each defect in `AL_WORKBOOK.md` §8;
  - the next-January days;
  - duplicates;
  - the six parts of column E;
  - a plain-name Sunday;
  - the same input always producing the same output, given the same map and date.
- **The card's pure modules**, each pinned by deleting a guard with `scripts/mutate.mjs` and watching
  a test fail:
  - every state in §4.5, and agreement with `projectAlBooking`;
  - the per-person check, including a swapped rest day in the "after" figures;
  - the upload-log rules in §4.6;
  - the Save plan and its chunking.
- **The entry point, not only the helpers.** End to end on Operations, on desktop Chrome, Android
  Chrome and iPhone Safari: upload, answer, Save, then the leave appears on the Calendar and in Admin.
  Plus:
  - a colleague's edit on an ADD day between review and Save (refused);
  - a Save refused offline;
  - a read served from the cache (refused);
  - a refusal that keeps the earlier answers;
  - the same file twice (nothing written the second time);
  - an older file (refused).
- **What happens after an upload**: a roster import run afterwards; an Admin period delete; leave on
  a Dispatcher's bank holiday; a 2027 file with carried days.
- **A real-SDK journey in the signed-in lane**, because the checked Save is a transaction.
- **By hand, once per phase**: the file picker on a real iPhone and a real Android phone.

## 8. Rollout: each phase useful on its own

| Phase | What ships | What you can do |
|---|---|---|
| **0** | The shared format module, the Stage 1 script, the privacy guards. No app change | Get a leave file and the day-by-day PDF from any session. Check the app by eye, as today |
| **1** | The card reads the file and shows every difference, per person. **No Save button** | See exactly where the app and the sheet disagree, in the app. This is `AL_WORKBOOK.md` §11's "reconcile-and-report", the half that was always safe |
| **2a** | The upload log: rules, data model and rules tests, **in its own push before anything writes to it** (CLAUDE.md → backend-first) | Nothing yet. It must be live first |
| **2b** | Save for additions and answered rest days: checked, confirmed per person, with undo, receipt and log | Bring the app up to date from the sheet |
| **3** | Ticked conflicts, Sunday corrections, and the roster review naming workbook leave | Settle the rest |

Each phase is its own release: version bump, tests, PR and your "Merge". **You can stop after Phase
1.** After the first big catch-up, most uploads will change a handful of days, which Admin's AL card
handles well by hand. Phase 2 earns its keep on that first catch-up (about 200 days booked from today
on the 6 Nov copy) and on over-quota days.

**Questions in `AL_WORKBOOK.md` §10 that block a phase:**

- Phase 2b: Q3 (are duplicate rows ever different?) and Q7 (what column E means).
- The older-file refusal: Q8 (does anyone besides the clerks save the file?).

## 9. Rough size

Counted in working sessions, and rough:

| Phase | Sessions |
|---|---|
| 0 | two to three |
| 1 | four to five, including the room made in `operations-app.js` |
| 2a | one |
| 2b | four to five |
| 3 | two to four |

That is about three weeks of sessions in all, against draft 1's one week. The difference is almost
entirely the review below.

## 10. Decisions (owner, 14 November 2026)

The owner answered "do your suggestions": each recommendation below was taken, and one more was
added.

| # | Question | Decision |
|---|---|---|
| 1 | Go ahead with Phase 0 and Phase 1 (no app writes), and decide on Phase 2 after using Phase 1? | **Yes.** Phases 0 and 1 built (v26.11). Phase 2 approved on 14 Nov 2026; 2a built (v26.11) |
| 2 | The name map: carried forward in the latest leave file, or a private repository? | **The leave file carries it** (`nameMap`), and the next session reads it back |
| 3 | Is the workbook the authority for which days are booked? | **Yes, for adding — never for removing** |
| 4 | Age limit for the clerks' copy | **14 days** (`LEAVE_FILE_MAX_AGE_DAYS`). On the Phase 1 card it is a warning, because a check cannot do harm; Phase 2 is where it would stop a save |
| 5 | Leavers' past leave | **Skip** (listed under "not compared", never written) |
| 6 | A hand-edited leave file | **Refuse** (the seal, `changed-since-made`) |
| 7 | How often to upload | **Whenever a copy comes**, with the age limit as the backstop |
| 8 | Phase 3: should the roster review prefer the published roster over workbook leave? | **Decided when Phase 3 comes** |
| — | Removing leave from the app because the sheet lacks it | **Not planned** (§4.10) — the owner confirmed it |

## 11. Risks

| Risk | Answer |
|---|---|
| A name matched to the wrong person | The persistent map is an explicit input; the file carries app names only; unknown names are refused |
| A day put in the wrong year | Full ISO dates; next-January days carry `leaveYear`; ambiguous dates are questions |
| A colleague's newer edit overwritten | Every part checked, additions included; offline refused |
| Leave cancelled in the app brought back | The upload log, older files refused, confirmation per person, the age limit |
| Leave deleted that was real | Removal is not planned |
| Free leave charged, or charged leave freed | `projectAlBooking`'s own answer; rest days asked; `replacedType` carried |
| A half-finished Save | Re-read before the receipt; the same file finishes it; answers kept |
| A day dropped while the file was being made | The app re-checks every person's sums against the sheet's own printed figures |
| Personal data leaking | Nothing in the repository (ignore rules and a guard test); no error quotes the file; nothing kept by the app |

---

## 12. What was built, and what changed from the plan

**Phase 0** (v26.11): `al-leave-file.js` (the format, the seal, every refusal, the sums the sheet's
own figures must agree with), `scripts/make-leave-file.mjs` with `scripts/xlsx-read.mjs` (the session's
method, which asks rather than guesses, and refuses to write inside the repository), and the privacy
guards (`.gitignore`'s `*.leave.json` and `*.local.json`, `leave-file-privacy.test.mjs`). Measured on
the 6 Nov copy, the script reproduces the hand reading of 14 Nov exactly — the same 1,247 (person, date,
kind) entries — and two runs make byte-identical files.

**Phase 1** (v26.11): the **Annual leave sheet** card on Operations (`operations-al-sheet.js`, its words
`al-leave-words.js`, its rules `al-leave-compare.js`). No Save. Each member's records are read whole;
a read answered from this device's cache stops the whole check; nothing is kept; an update's reload
waits while the answer is on screen.

**Changed from draft 2, each for a reason found while building:**

| Plan said | Built | Why |
|---|---|---|
| A `coverage` block per person | **Dropped** | Redundant: `source.firstDate`/`lastDate` say what the sheet covers for everybody, and `absentFromWorkbook` and `notImported` say who it does not |
| `made.nameMap` holds the map's hash | **The map itself is in the file** (`nameMap`) | Decision 2: the file carries it, so a hash of something kept elsewhere had nothing to point at |
| A Sunday tag placed by its neighbouring cells when its text does not name anybody | **Only by its text, or an answer**; the neighbours become evidence in the question | Measured on the 6 Nov copy: the same person on both sides agrees with the text 20 times in 21, a person on one side only 51 times in 83 — too weak to decide on its own (AL_WORKBOOK.md §7) |
| Which duplicate row, and which January, carried forward like the names | **Asked again on each new copy** | They are keyed by row and cell, which move between copies; a carried answer could land on the wrong row |
| App-only leave: every leave record the sheet lacks | **Not a record no surface shows** — leave on a Sunday, or before a start date | Listing one put somebody under "Needs a look" for a record nobody could find |
| A record before a start date judged by its type | **"Before the start date", whatever is stored** | Every surface hides it, and Admin refuses to save one |
| An allowance difference shown in the figures | **Its own chip and summary line** | A person can need a look for that alone, and a closed row with no chip did not say why |
| "Agree" when no day differs | **"Agree" only when the two FIGURES agree**: undated over-quota days, leave the app takes from this year after the sheet ends, and a day before the start date are reasons of their own, and a safety net catches a gap nothing names | Review, 14 Nov 2026: two different figures on one closed row were filed under "Agree" |
| The carry-over flagged as an allowance difference and "other year" days | **Explained**: as many moved-back January days as the sheet carries forward are "carried", matched by count | AL_WORKBOOK.md §9 calls it an explained difference: both leave the same figure |
| The swap question on every free day | **Only where the Admin leave card asks it** (`projectAlBooking`) | Leave its record already settled — over RDW, a correction, an Other day or a Spare turn — was asked about, which Admin never does |
| A day's words from its stored record | **From what the Calendar draws** (`resolveDayShift`) | Leave or an absence on a Sunday, or an absence on a rest day, read as if it were on screen |

**Stage 1 after its review** (14 Nov 2026). Each of these produced a file and exited 0 without a word;
each now asks, refuses, or reads correctly, with a test that failed before the fix:

- **Asks:** an early-January `DD/MM` that no date beside it settles (`24/12 02/01`); two rows with the
  same figures but different comments.
- **Refuses:** a person-like totals row whose Used is not one COUNTIF of the calendar; a START entry
  carrying a second date. Both need the workbook to change, so neither can be answered.
- **Reads correctly:** a full stop makes a date only between two-digit parts (`1.5 DAYS` was 1 May);
  Excel's legacy copy of a thread is split back into its entries; a one-word Sunday tag is matched only
  within its own grade block.
- **The reader** refuses malformed XML where it stands (an unclosed comment rescanned the part
  quadratically), duplicate zip entries, and an entry that inflates past its cap.
- **The command line** refuses an output inside ANY git checkout or worktree, a path with `..`, a day
  list not ending `.csv`, and an output that names an input or the other output.
- **The format's** own lookups take own entries only, and an unforeseen validator fault is a refusal,
  never a throw.
- **The order** is by code unit, so the seal no longer depends on the session's locale.

Re-run on the 6 Nov copy: the same file, except `made` and the seal. One new question (an early-January
date, `AL_WORKBOOK.md` §5) was answered from the evidence.

**Phase 2a** (v26.11): the upload log, `alUploads`. Its rules, its entry in `DATA_MODEL.md` and 11 rules
tests, in a release with nothing that writes it (CLAUDE.md → backend-first). What it settled that §4.6
left open:

- **The file is named twice.** `fileDigest` is the leave file's seal, which covers the name answers too;
  `workbookSha256` is the clerks' copy itself, which is what somebody holding the `.xlsx` can check.
- **Two lists, not one.** `inLine` is every sheet day the app held as leave once the Save was done, the
  days it added and those already right; it is what stops cancelled leave coming back. `added` is only
  what the Save created, the one thing an undo may remove (§4.10).
- **An undo is recorded, never a deletion of the log**: `undoneAt`, `undoneBy` and `undone`, once.
  Deleting the log would forget the clerks' save time too, and an older copy could then be uploaded over
  a newer one.
- **A create sent again is refused.** When a create's answer is lost, the SDK sends it again and it
  arrives as an update, which only an undo may be. So the Save writes its log in a transaction that
  reads first; a rules test shows both.
- **`clerksLastSaved` is never null in a log**, though a leave file may say null: a copy of unknown age
  cannot be ordered against another, so the Save refuses one.
- **Mutation:** each of the 28 guard lines fails a test when broken. Three `is string` checks placed
  before a `matches()` were removed, because `matches()` on any other type already refuses the write.

**Still open before Phase 2b:** `AL_WORKBOOK.md` §10 Q3 (are duplicate rows ever different?) and Q7 (what
column E means); Q8 (does anyone besides the clerks save the file?) before the older-file refusal is
relied on.

# Part 2 — The review of draft 1

## How it was reviewed

Draft 1 was reviewed three times:

- **My own adversarial pass.**
- **An independent reviewer who checked every claim against the app's code.**
- **An independent reviewer who checked the workbook stage, the privacy and the phone workflow.**

Neither independent reviewer saw my reasoning, only the draft and the files. **Every finding was
checked against the code or the guide before it changed the plan.**

## What the review found, and what changed

| # | Finding | Severity | Found by | What changed |
|---|---|---|---|---|
| 1 | "A part that only adds is a plain batch" was copied from the roster import, where it is safe only because import records take random ids. The uploader writes **fixed ids**, so a plain batch would silently overwrite a manager's newer change. That breaks the rule "do not turn an online save back into a plain batch" | High | Code reviewer | §4.9: every part checked, additions included; offline refused |
| 2 | **Leave cancelled in the app comes back.** The workbook is always older than the upload, and a deletion leaves no trace, so a ticked "Add leave" resurrects it. That includes uploading an older file after a newer one | High | Code reviewer, and me | §4.6: an upload log, older files refused, confirmation per person, an age limit |
| 3 | **Draft 1's day table restated Admin's rules, and got three wrong.** It treated free rest-day leave as "already right" when the sheet charges it. It read "settled, and free" as "nothing written" (the range card writes there). And it had no state for an absence on a rest day | High | Code reviewer | §4.5: classification by `projectAlBooking` itself, with a test that the two agree |
| 4 | **Nothing stopped the leave file being committed.** It was not ignored, and the anonymity test would not catch its fields | High | Workflow reviewer | §3.6: ignore rules, a guard test, invented test data |
| 5 | **January broke the format.** The sheet's grid and its formulas run into the next January, which draft 1 banned. Column C (carry-forward) was missing, so some rows could not be reconciled | High | Workflow reviewer, and me | §3.5: next-January days with `leaveYear`; `carriedForward`; sheet chosen by first date |
| 6 | **Cancellations and gaps could not be told apart**, and nothing recorded which leave came from the workbook | High | Workflow reviewer | §3.5: `coverage` and `absentFromWorkbook`; §4.6: the upload log records where each day came from |
| 7 | Reads were planned "per person or per month". A date window misses carried January days, and **offline reads succeed from the cache** instead of failing | Medium | Code reviewer | §4.4: one read per member, every date; cache reads refused |
| 8 | The "after this save" figures would undercount, because the projection drops `replacedType` | Medium | Code reviewer | §4.7 |
| 9 | Sunday corrections were driven by the clerks' tags, which are the weakest evidence in the workbook, and that is not what Admin does | Medium | Both reviewers | §4.11: Admin's own rule, moved to Phase 3; tags shown only as evidence |
| 10 | "Undo" would also delete the absence a ticked conflict replaced, and a replaced record cannot be faithfully restored. "Newer" and "older" read the last write, not the booking date | Medium | Code reviewer, and me | §4.10: undo covers additions only; removal not planned |
| 11 | "Upload the same file again" would reset every answer, which is the roster import's old bug | Medium | Code reviewer | §4.9: answers kept across a refusal; a re-read before the receipt |
| 12 | Column E, duplicate rows and the self-marked `checks` were under-specified | Medium | Workflow reviewer | §3.5: column E split, `sheetRows`, `foundIn` and `countedBySheet`, and sums the app re-checks |
| 13 | Two sessions could make different files from the same workbook, because the name map did not persist. A Python script would also have been a second, untested copy of the format | Medium | Workflow reviewer, and me | §3.3 and §3.4: one shared Node module; the map carried forward as an explicit input |
| 14 | Getting the file onto a phone was not planned. Android may grey out a `.json`, and tests skip the picker | Medium | Workflow reviewer | §4.2: a wider `accept`, a paste box, and a check by hand on both phones |
| 15 | Phase 0 had no reader, so the format would be fixed before anything used it | Medium | Workflow reviewer | §8: the shared module ships in Phase 0 |
| 16 | **Draft 1 named a colleague** in an example, and quoted a real first-name tag | Medium | Workflow reviewer | Every name removed; all examples invented |
| 17 | An app update could reload the page mid-review, and an error could copy names into the error log | Medium | Me, and the code reviewer | §4.8: the card joins `_opsBusy`; §3.6 and §4.3: refusals returned, never thrown |
| 18 | `operations-app.js` is at its size cap, so the card cannot simply be added | Low | Code reviewer | §4.1 and §9: the room is planned |
| 19 | The first-run uploads change hundreds of days, but later ones a handful | Low | Me | §8: you can stop after Phase 1 |

## Findings not taken, and why

- **Record where each day came from in the override's `note` field.** It needs no rules change, but
  `note` is empty by your decision, taken for data-protection reasons (`docs/DATA_MODEL.md`). Reusing
  it would bring back a removed feature, and block the planned removal of the field. The upload log
  records it instead.
- **A new `source` value for uploaded leave.** It is possible, but it needs a rules change, and every
  reader of `source` would have to learn it. The upload log gives the same information without
  touching the leave records. It can be revisited in Phase 3.
- *Partly taken:* one reviewer said draft 1 "pinned an invented" initial mismatch on a real person.
  The mismatch is real (the row was checked), but the point stands. A public document must not carry
  it, so every name has gone.

## What all three reviews agreed the plan got right

- The two-stage shape: judgement in the session, writing in the app.
- Refusing by name and never defaulting.
- Shipping compare-and-report before anything writes.
- Reusing the existing rules rather than inventing new ones.
- Treating over-quota days as leave, and leaving allowances alone.
- Keeping the raw workbook off the app's servers.
