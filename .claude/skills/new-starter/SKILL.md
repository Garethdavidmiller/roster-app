---
name: new-starter
description: Full checklist for onboarding a new staff member. Invoke this skill when the user asks to add a new starter, new team member, or new employee.
---

# New starter checklist

Run through every step in order. Do not skip steps.

## Step 1 — `roster-data.js` (always required)

- [ ] Add entry to `teamMembers` with `name`, `currentWeek`, `rosterType`, `role` — plus any optional fields that apply (`hidden`, `managerOnly`, `permanentShift`, `noProRate`, `rosterChanges`; see CLAUDE.md → teamMembers fields)
- [ ] If joining mid-year: add `startDate: new Date(year, month-1, day)` — **midnight only, no time component**
- [ ] If joining mid-year: add `proRatedAL: { year: N }` — formula: `⌈(daysRemainingInYear / 365) × entitlement⌉`
  - Count from start date inclusive to 31 Dec inclusive
  - CEA entitlement = 32 days; CES = 34 days; **Dispatcher = 22** — and the formula DOES apply to a Dispatcher, against that base. This said "do not use this formula" until 3 Sep 2026, which was wrong in a way worth knowing: the recorded value for the one live mid-year Dispatcher is exactly what the formula gives on 22, so the caution described nothing anybody had done.
  - **Do not add lieu days into `proRatedAL`.** A Dispatcher earns one per bank holiday worked, and since v22.50 `getALEntitlement` adds them on top of the pro-rated base automatically. Baking them in would count them twice.
  - Example: May 5 start (CEA) → 241 days → ⌈241/365 × 32⌉ = 22

## Step 2 — Firebase Auth (always required)

- [ ] Admin → Operations → Staff Login Accounts → **Set up accounts** (creates the login)
- [ ] Confirm password convention in `OPERATIONS_REFERENCE.md`
- [ ] **Record their work email** — Operations → Account status → Set. Nothing prompts for this any more: the login overlay that used to ask was retired at v19.30 once every existing member was registered, so a new starter's email is now only ever added here (or by them in Settings → Work Email). Miss it and the account simply has no email on file, silently — the Account status table's Email column is where you'd notice.

## Step 2b — Regenerate `functions/roster-members.json` (ALWAYS — including Management)

- [ ] Run `npm run generate:roster-members` — regenerates `functions/roster-members.json` from `roster-data.js`. **In the same commit as the `roster-data.js` change**; the sync is verified by `sw-asset-check.test.mjs`.

That file carries **two** unrelated things, which is why this step is unconditional (it said "CEA / CES / Dispatcher only — not Management" until v21.45, and that was wrong in the one direction that costs an outage):

| What | Who it affects | What breaks if you skip it |
|---|---|---|
| the AI parsing name lists | CEA / CES / Dispatcher | the member's shifts are silently excluded from every roster PDF import |
| the **server-owned auth lists** — `activeMembers` and `roles.admin`/`manager`/`designer` | **everyone, Management included** | `setupRosterAuth` trusts THIS file, not the client's `CONFIG`, so the account is provisioned without its claim. A new manager can sign in, sees the pages, and every write on another member's behalf permission-denies |

## Step 2c — Managers only: provision the claim

- [ ] Deploy first — `setupRosterAuth` reads the DEPLOYED `roster-members.json`, so running Set up accounts before the functions deploy stamps the old list
- [ ] Then Operations → **Set up accounts**, which creates the account AND sets the `manager` claim
- [ ] The claim lands in the token, so an ALREADY-signed-in manager keeps a stale one until it refreshes. Writes self-heal through `writeWithClaimRetry` (permission-denied → force refresh → retry once), so this resolves itself — but a brand-new account has nothing to self-heal from until Set up accounts has run

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

**Upload their final roster PDF before you do it.** `hidden: true` also removes them from the
`cea`/`ces`/`dispatcher` name lists the roster parser matches rows against, so a PDF covering their
last days, uploaded afterwards, reports them under `missingMembers` — the same advisory a genuine
absence produces. The week imports looking complete with nobody on their line.

Regenerate `functions/roster-members.json` in the same commit (`npm run generate:roster-members`).
Overtime needs separate action per open week — the population is frozen when a week opens. Full
procedure: `docs/OPERATIONS_REFERENCE.md` → "Removing a staff member".
