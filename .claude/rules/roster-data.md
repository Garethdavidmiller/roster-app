---
paths:
  - "roster-data.js"
  - "roster-cycle-data.js"
  - "roster-member-data.js"
---

# roster-data.js — key invariants

## Adding a new team member

Always invoke `/new-starter` — it has the full checklist, including:
- `proRatedAL` is TRANSCRIBED from the roster clerk's workbook, never calculated (a formula was wrong for every mid-year starter — see the skill).
- The mandatory `npm run generate:roster-members` step — **for every new member, Management included**. The generated file holds several unrelated things (the Overtime and `MAX_YEAR` copies too); the two a new starter depends on are the AI parsing names (CEA/CES/Dispatcher — skip it and their shifts are silently excluded from every roster PDF import) and the **server-owned auth lists** `activeMembers` + `roles.admin`/`manager`/`designer`, which `setupRosterAuth` trusts instead of the client `CONFIG`. Skip it for a manager and the account provisions with no claim, so every write on a member's behalf permission-denies.

`startDate` must be `new Date(year, month-1, day)` — **midnight local, no time component**. A time component breaks `calcProRateFactor`.

## rosterChanges

`rosterChanges` entries must be **sorted ascending by `from`**. `resolveMemberRoster(member, date)` picks the latest entry whose `from` ≤ date whatever the order, but the sort is still the rule, and `roster-data.test.mjs` fails an unsorted array.

**A `rosterChanges` entry's `currentWeek` is REFERENCE-ANCHORED, not "the week on the `from` date".** For a rotating target (`main`/`bilingual`/`ces`/`dispatcher`), `getWeekNumberForDate` derives the week from the TARGET type's own reference Sunday — `CONFIG.MAIN_ROSTER_REFERENCE_DATE` (8 Feb 2026) for `main`, `BILINGUAL_`/`CES_ROSTER_REFERENCE_DATE` (15 Feb 2026), `DISPATCHER_ROSTER_REFERENCE_DATE` (1 Feb 2026) — plus the whole-week offset, so `currentWeek` has the **same meaning as a member's base `currentWeek`**: the rotation row *at the reference Sunday*, NOT the row on the transition date. The difference is invisible only when `from` is a whole number of cycles from the reference Sunday (K. Jedlinski's 28 Jun 2026 is exactly 20 weeks from the main reference Sunday, so the value reproduces itself). Author an **off-cycle** `from` with `currentWeek` meaning "the week starting on `from`" and the roster silently shifts by `weeksDiff mod cycleLength`. Always give the reference-anchored value — compute it the way you would set a base `currentWeek`. For a **fixed** target, `currentWeek` instead selects the `fixedRoster` pattern (1/2/3 — 3 is training with no times, a bare `TRG` Mon–Fri), with no anchoring.

## APP_VERSION

`APP_VERSION` here is the **primary source**. `npm run bump <version>` updates it and the service-worker.js cache const — the two runtime locations. Do not edit either by hand.
