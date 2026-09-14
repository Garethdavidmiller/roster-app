---
name: al-workbook
description: Read the depot annual-leave workbook (the roster clerks' Excel quota spreadsheet) before answering anything from it. Invoke this skill whenever an annual-leave workbook or leave spreadsheet is uploaded, whenever asked what leave somebody has taken or booked, whenever asked to reconcile the app against the spreadsheet, or whenever a question mentions AL allowance, days remaining, over-quota days or the depot quota.
---

# The depot annual-leave workbook

**Read `docs/AL_WORKBOOK.md` §0 BEFORE you answer anything. Not after.**

That file is the accumulated understanding of a spreadsheet this repo does not own and cannot
change. This skill is the trigger and the loop; the knowledge is all in there, and restating it here
would give it a second home to drift from.

## Why this skill exists at all

The rule in §0 has now been broken **twice, on the same person, by two different sessions**
(8 Sep and 14 Sep 2026 — J. Davies, reported as 19 days when the answer was 20). Both times the
document already contained the rule. Both times the session answered from the spreadsheet directly
and read the document afterwards, when corrected.

So the failure is not a missing fact. It is **answering before reading**, and the only fix that has
ever worked for that is reading first.

## The loop, in order

1. **Read `docs/AL_WORKBOOK.md`** — §0 (the rule that must not be got wrong) and §5 (the over-quota
   column) at minimum. §6 if you are going to read the file mechanically.
2. **Answer the question**, following §0's four steps. The over-quota days are part of the answer,
   not a footnote.
3. **Say what you could not establish.** An unexplained figure is a question for the owner (§10),
   not something to resolve by picking the likelier reading.
4. **Point out what you noticed** even when it was not asked — a duplicate row, a figure that moved,
   a person in one system and not the other. §8 is a list of defects found exactly this way.
5. **Write the learnings back into `docs/AL_WORKBOOK.md`, in this session, before you finish.**
   Update the section, turn an `[inferred]` into a `[measured]`, strike an answered open question,
   and add a row to §12. An answer that stays in the chat is lost, and the next session re-asks it.

## What this skill will not do

It will not summarise §0 for you. A summary here would be a fourth copy of a rule that already
exists in the document, the file index and the architecture index — and the one thing every failure
so far has in common is a session working from a shorter version of it.
