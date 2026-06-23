---
name: new-starter
description: Full checklist for onboarding a new staff member. Invoke this skill when the user asks to add a new starter, new team member, or new employee.
---

# New starter checklist

Run through every step in order. Do not skip steps.

## Step 1 — `roster-data.js` (always required)

- [ ] Add entry to `teamMembers` with `name`, `currentWeek`, `rosterType`, `role`, `flags`
- [ ] If joining mid-year: add `startDate: new Date(year, month-1, day)` — **midnight only, no time component**
- [ ] If joining mid-year: add `proRatedAL: { year: N }` — formula: `⌈(daysRemainingInYear / 365) × entitlement⌉`
  - Count from start date inclusive to 31 Dec inclusive
  - CEA entitlement = 32 days; CES = 34 days; Dispatcher = **do not use this formula** — Dispatcher AL is dynamic (22 + bank-holidays-worked, calculated by `getALEntitlement`); set `proRatedAL` for a mid-year Dispatcher only after computing the correct value for their joining year
  - Example: May 5 start (CEA) → 241 days → ⌈241/365 × 32⌉ = 22

## Step 2 — Firebase Auth (always required)

- [ ] Admin → Operations → Staff Login Accounts → **Set up accounts** (creates the login)
- [ ] Confirm password convention in `OPERATIONS_REFERENCE.md`

## Step 2b — Regenerate `functions/roster-members.json` (CEA / CES / Dispatcher only — not Management)

- [ ] Run `npm run generate:roster-members` — regenerates `functions/roster-members.json` from `roster-data.js` so the weekly roster PDF parser knows the new name. Without this, the staff member's shifts are silently excluded from every roster import. The sync is verified by `sw-asset-check.test.mjs` test 4.

## Step 3 — Pay calculator verification (mid-year joiners only)

- [ ] Log in as the new member, open pay calculator, check the joining period shows the info banner and correct pro-rated contracted hours
- [ ] Joining period = the pay period whose cutoff is on or after the start date
- [ ] Expected pro-rated hours = `Math.round(140 × daysEmployed / totalDays)` where totalDays = cutoff − prevCutoff and daysEmployed = `Math.round((cutoff − startDate) / msPerDay) + 1`

**That's everything** — calendar display, team view, override eligibility, roster-assist pre-fill, and all subsequent pay periods are automatic.

---

## Mid-year joiner — field reference

| Field | Example | Purpose |
|-------|---------|---------|
| `startDate` | `new Date(2026, 3, 20)` | Midnight local time — no hours argument. `getBaseShift` returns `'RD'` before this. Scales hours, London Allowance, pension, HPP for the joining period. |
| `proRatedAL` | `{ 2026: 23 }` | Override AL entitlement for joining year only. Standard entitlement resumes next year. |

## Formula invariant — do not break

`calcProRateFactor` in `paycalc-calc.js`:
```
raw          = (periodCutoff_noon − startDate_midnight) / msPerDay   // always X.5
daysEmployed = Math.round(raw) + 1                                    // rounds .5 up
factor       = daysEmployed / totalDays
```
`startDate` must be midnight local. A time component breaks the formula. Verified against M. Okeke May 8 2026 payslip (50% factor, London Allowance £138.08 ✓).

## Removing a staff member

Set `hidden: true` on the `teamMembers` entry, then run Set up accounts → "Disable accounts for leavers" in Admin → Operations.
