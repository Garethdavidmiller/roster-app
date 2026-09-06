---
name: new-starter
description: Full checklist for onboarding a new staff member. Invoke this skill when the user asks to add a new starter, new team member, or new employee.
---

# New starter checklist

Run through every step in order. Do not skip steps.

## Step 1 — `roster-data.js` (always required)

- [ ] Add entry to `teamMembers` with `name`, `currentWeek`, `rosterType`, `role` — plus any optional fields that apply (`hidden`, `managerOnly`, `permanentShift`, `noProRate`, `rosterChanges`; see CLAUDE.md → teamMembers fields)
- [ ] If joining mid-year: add `startDate: new Date(year, month-1, day)` — **midnight only, no time component**
- [ ] If joining mid-year: add `proRatedAL: { year: N }` — **ASK THE ROSTER CLERK AND TRANSCRIBE. Do not calculate it.**
  - The clerk's annual leave workbook (`Customer Service Annual Leave <year>.xlsx` → the Marylebone Totals sheet, `AL allowance` column) is the AUTHORITY for this figure (owner, 6 Sep 2026). It is a contractual number the roster office agrees and payroll works to; this app transcribes it.
  - **This step used to carry a formula, `⌈(daysRemainingInYear / 365) × entitlement⌉`, and it produced the wrong answer for every mid-year starter in the roster.** Measured 6 Sep 2026 against the clerk's book: Toth 12 vs 11, Jedlinski 19 vs 18, Davies 22 vs 20, Okeke 23 vs 24. Its own worked example was Davies. Two of those are a rounding difference the formula could in principle be fixed for; the others are not reachable by ANY formula from the fields in `roster-data.js` — Okeke had prior AGENCY service, so his `startDate` is when he joined the payroll and not when his entitlement began accruing. A figure that depends on facts this app does not hold cannot be derived here, and a plausible derivation is worse than no derivation because nothing fails when it is wrong.
  - A rough day-count is fine as a SANITY CHECK — if the clerk's figure is wildly off what you expect, ask — but the clerk's number is what goes in the file.
  - **Do not add lieu days into `proRatedAL`.** A Dispatcher earns one per bank holiday worked, and since v22.50 `getALEntitlement` adds them on top of the pro-rated base automatically. Baking them in would count them twice. (Check the clerk has not already included them either.)
  - Record WHY beside the entry whenever the figure is not what a day-count would suggest — Okeke's line is the model. The next reader's instinct is to "correct" it back to the formula, and that silently takes days off somebody.

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

## Step 4 — verify it actually took (v22.53)

- [ ] Operations → Staff Login Accounts → read the block above the button

It should say **“Everyone on the roster has a login, and no leaver still has one.”** If step 2, 2b
or 2c was missed, it names the person and says which: *no account*, *account disabled*, or *wrong
permissions* — and the **Needs attention** strip at the top of the page carries the item until it is
fixed. Every one of those three is otherwise **silent**: the new starter appears correctly on every
screen in the app and finds out when they try to sign in, and a manager without their claim signs in
fine and then permission-denies on every write for somebody else.

If the block says it *couldn’t check*, that is neither answer. Retry it; do not read it as done.

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

**Use `/leaver`.** The full ordered procedure lives there — it is six steps, two of which do damage
in the wrong order, and it stopped fitting in a footnote here.

The one line worth carrying in both places, because it is the step people get wrong and it belongs
to *this* skill's subject too: **upload their final roster PDF BEFORE setting `hidden: true`.**
`hidden` also drops them from the parser's name lists, so a later import reports their row as
`missingMembers` — the same advisory a genuine absence produces.
