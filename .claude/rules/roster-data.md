---
paths:
  - "roster-data.js"
  - "roster-cycle-data.js"
  - "roster-member-data.js"
---

# roster-data.js — key invariants

## Adding a new team member

Always invoke `/new-starter` — it has the full checklist including:
- `proRatedAL` is TRANSCRIBED from the roster clerk's workbook, never calculated (the old formula was wrong for every mid-year starter — see the skill)
- The mandatory `npm run generate:roster-members` step — **for every new member, Management included**. The file holds two unrelated things: the AI parsing names (CEA/CES/Dispatcher — skip it and their shifts are silently excluded from every roster PDF import) and the **server-owned auth lists** `activeMembers` + `roles.admin`/`manager`/`designer`, which `setupRosterAuth` trusts instead of the client `CONFIG` — skip it for a manager and the account provisions with no claim, so every write on a member's behalf permission-denies

`startDate` must be `new Date(year, month-1, day)` — **midnight local, no time component**. A time component breaks `calcProRateFactor`.

## rosterChanges

`rosterChanges` entries must be **sorted ascending by `from`**. `resolveMemberRoster(member, date)` picks the latest entry whose `from` ≤ date — unsorted arrays return wrong results silently.

**A `rosterChanges` entry's `currentWeek` is REFERENCE-ANCHORED, not "the week on the `from` date"** (gotcha confirmed Jul 2026, K. Jedlinski trace). For a rotating target (`main`/`bilingual`/`ces`/`dispatcher`), `getWeekNumberForDate` derives the week from the TARGET type's own reference Sunday — `CONFIG.MAIN_ROSTER_REFERENCE_DATE` (8 Feb 2026) for `main`, `BILINGUAL_`/`CES_ROSTER_REFERENCE_DATE` (15 Feb 2026), `DISPATCHER_ROSTER_REFERENCE_DATE` (1 Feb 2026) — plus the whole-week offset — so `currentWeek` has the **same meaning as a member's base `currentWeek`**: the rotation row *at the reference Sunday*, NOT the row on the transition date. This is only invisible when `from` is a whole-cycle multiple of weeks from the reference Sunday (K. Jedlinski's 28 Jun 2026 is exactly 20 weeks from the main reference Sunday → the value reproduces itself). If you author a transition whose `from` is **off-cycle** and pick `currentWeek` meaning "the week starting on `from`", the roster silently shifts by `weeksDiff mod cycleLength`. Always give `currentWeek` as the reference-anchored value (compute it the same way you'd set a base `currentWeek`). For a **fixed** target, `currentWeek` instead selects the `fixedRoster` pattern (1/2), no anchoring involved.

## APP_VERSION

`APP_VERSION` here is the **primary source** — `npm run bump <version>` updates it and the service-worker.js cache const (the 2 runtime locations; the 7 comment stamps were dropped v16.81). Do not edit either by hand.
