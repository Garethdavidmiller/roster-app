---
paths:
  - "roster-data.js"
  - "roster-cycle-data.js"
  - "roster-member-data.js"
  - "roster-roles.js"
---

# roster-data.js — key invariants

## Adding a new team member

Always invoke `/new-starter` — it has the full checklist, including:
- `proRatedAL` is TRANSCRIBED from the roster clerk's workbook, never calculated (a formula was wrong for every mid-year starter — see the skill).
- The mandatory `npm run generate:roster-members` step — **for every new member, Management included**. The generated file holds several unrelated things (the Overtime and `MAX_YEAR` copies too); the two a new starter depends on are the AI parsing names (CEA/CES/Dispatcher — skip it and their shifts are silently excluded from every roster PDF import) and the **server-owned auth lists** `activeMembers` + `roles.admin`/`manager`/`designer`, which `setupRosterAuth` trusts instead of the client `CONFIG`. Skip it for a manager and the account provisions with no claim, so every write on a member's behalf permission-denies.

`startDate` must be `new Date(year, month-1, day)` — **midnight local, no time component**. A time component breaks `calcProRateFactor`.

## rosterChanges

`rosterChanges` entries must be **sorted ascending by `from`**. `resolveMemberRoster(member, date)` picks the latest entry whose `from` ≤ date whatever the order, but the sort is still the rule, and `roster-data.test.mjs` fails an unsorted array.

**A `rosterChanges` entry's `currentWeek` is REFERENCE-ANCHORED, not "the week on the `from` date".** For a rotating target (`main`/`bilingual`/`ces`/`dispatcher`), `getWeekNumberForDate` derives the week from the TARGET type's own reference Sunday — `CONFIG.MAIN_ROSTER_REFERENCE_DATE` (8 Feb 2026) for `main`, `BILINGUAL_`/`CES_ROSTER_REFERENCE_DATE` (15 Feb 2026), `DISPATCHER_ROSTER_REFERENCE_DATE` (1 Feb 2026) — plus the whole-week offset, so `currentWeek` has the **same meaning as a member's base `currentWeek`**: the rotation row *at the reference Sunday*, NOT the row on the transition date. The difference is invisible only when `from` is a whole number of cycles from the reference Sunday (K. Jedlinski's 28 Jun 2026 is exactly 20 weeks from the main reference Sunday, so the value reproduces itself). Author an **off-cycle** `from` with `currentWeek` meaning "the week starting on `from`" and the roster silently shifts by `weeksDiff mod cycleLength`. Always give the reference-anchored value — compute it the way you would set a base `currentWeek`. For a **fixed** target, `currentWeek` instead selects the `fixedRoster` pattern (1/2/3/4 — 3 is training with no times, a bare `TRG` Mon–Fri; 4 is pattern 2's hours on a placeholder line that RESTS ON BANK HOLIDAYS, `FIXED_PATTERNS_RESTING_ON_BANK_HOLIDAYS`), with no anchoring.

**A NEW base roster is a new table, never an edit.** A pattern has no start date — `getBaseShift` reads one table for every date — so editing a week, a cycle length or a reference Sunday in place redraws every day already worked. Bring a new link in as its own roster type and move each member onto it with a dated `rosterChanges` entry (`roster-cycle-data.js`'s header; the steps are OPERATIONS_REFERENCE.md → "When the new link starts"). End a temporary move by ADDING an entry, never by deleting one, which redraws every date since the move. `roster-data.test.mjs` pins every existing week.

## APP_VERSION

`APP_VERSION` here is the **primary source**. `npm run bump <version>` updates it and the service-worker.js cache const — the two runtime locations. Do not edit either by hand.

## Member fields, `rosterChanges` and the cycles

`CLAUDE.md` → *teamMembers fields* keeps what every area needs: the table is WORLD-READABLE, so a
field added here is published the moment it ships (`public-data-classification.test.mjs` fails on an
unclassified field), and the AL entitlement rules, which Admin, the Calendar and the Pay Calculator
all read. The field reference is here, beside the data.

```javascript
{
  name: 'N. Surname',      // MUST match Firestore memberName exactly
  currentWeek: 3,
  rosterType: 'main',      // 'main' | 'bilingual' | 'fixed' | 'ces' | 'dispatcher'
  role: 'CEA',             // 'CEA' | 'CES' | 'Dispatcher' | 'Management' — the grade NOW
  roleHistory: [{ role: 'CEA', until: new Date(2026, 10, 21) }], // Optional — earlier grades, each with
                           // its LAST day (midnight local, inclusive), oldest first; read through
                           // roleOn / rolesInRange (roster-roles.js). Never deleted (OPERATIONS_REFERENCE → A member changes grade)
  hidden: false,           // Optional — hides from dropdown
  managerOnly: false,      // Optional — login-only manager/clerk account (Management group); hidden from the calendar member selector, has no roster of its own
  permanentShift: 'early', // Optional — forces early/late badge on all worked days
  bilingualContract: true, // Optional — this CEA holds a BILINGUAL CONTRACT: 34 days' leave, not 32.
                           // The CONTRACT, not the line. A plain CEA is routinely placed on a bilingual
                           // line until a CEA one frees up, so `rosterType` cannot stand in for this.
  startDate: new Date(2026, 3, 20), // Optional — midnight local time: new Date(year, month-1, day)
  noProRate: true,                  // Optional — set for secondment returns: startDate suppresses pre-return shifts but pay and AL are full-year (no pro-rating in paycalc; joiner banner hidden)
  proRatedAL: { 2026: 23 }, // Optional — the joining year's entitlement (a Dispatcher's lieu days are still added)
  rosterChanges: [{ from: new Date(2026, 6, 1), rosterType: 'ces', currentWeek: 4 }] // Optional — scheduled roster moves
}
```

**What a `rosterChanges` entry means.** Date-driven roster transitions for a member who changes
rosterType/link mid-life (e.g. a new starter on a temporary `fixed` pattern who later joins a
rotating link). Each entry is `{ from: Date, rosterType, currentWeek }`; from `from` (midnight,
**inclusive**) onward the member follows that rosterType/currentWeek instead of the base fields, and
the latest entry whose `from` ≤ date wins. Resolved by `resolveMemberRoster(member, date)` in
`roster-data.js`; `getBaseShift` and `getWeekNumberForDate` apply it automatically, so **no call site
needs special handling**. The base `rosterType`/`currentWeek` describe the member *before* the first
change. `startDate` (join-date RD suppression) is independent and still applies.

**An absence is a record, never a pattern.** However long somebody is away, record it as Absent days
in Admin's Absence card (`admin-sick.js` takes a range of up to a year, so a longer absence is
recorded again before the first range runs out) — never as a `rosterChanges` entry, a `hidden` flag,
a later `startDate` or an edit to a pattern. Three reasons. This table is world-readable, so a pattern
changed because of an absence tells anyone on the internet, while Absent days stay behind a sign-in
or the staff PIN and never carry a reason (CLAUDE.md → the absence emoji). A pattern edit shows those
days as something else — rest days, or a line that is not theirs — so the Calendar and Team Week no
longer show an absence at all. And a `rosterChanges` entry is never deleted (above), so the absence
would stay published, in the file and its history, after the person is back.

### Roster cycles

| Type | Cycle |
|------|-------|
| main | `CONFIG.MAIN_ROSTER_WEEKS` weeks (`weeklyRoster`) |
| bilingual | `CONFIG.BILINGUAL_ROSTER_WEEKS` weeks (`bilingualRoster`) |
| ces | `CONFIG.CES_ROSTER_WEEKS` weeks (`cesRoster`) |
| dispatcher | `CONFIG.DISPATCHER_ROSTER_WEEKS` weeks (`dispatcherRoster`) |
| fixed | no rotation — `currentWeek` selects which pattern in `fixedRoster` the member sits on; the patterns are described in the comment above `fixedRoster` in `roster-cycle-data.js`, and who sits on each is `roster-member-data.js` |

**A fixed pattern is SHARED, so editing one member's hours there edits everyone on that line.** Never
write a cycle's length down: it is the constant's, and the Links seed reads the same constants.
