---
paths:
  - "paycalc.html"
  - "paycalc-*.js"
  - "paycalc.css"
  - "paycalc.test.mjs"
  - "paycalc-*.test.mjs"
---

# Pay calculator — full reference

**This is the authoritative contract for the Pay Calculator, and the one home for its pay figures**
(grade rates, London Allowance, pension defaults, award dates). Other documents link here rather
than restating rates, payroll rules, storage keys or layout. Unverified pay claims are `VAL-PAY-*`
rows in `VALIDATION_REGISTER.md` and are cited by ID, never re-argued.

## Invariants

If you are about to change how a figure reaches the screen, one of these is probably the thing you
are about to break. Each states WHAT must hold; the WHY is below, or in the module header.

| # | Invariant | Where it lives |
|---|---|---|
| 1 | **A figure not on record is never guessed.** A blank box the member can complete beats an inferred number that looks authoritative — the rate lock keys off the RECORD, never off box contents. | `paycalc-backpay-state.js` · `paycalc-calc.js` (`AWARD_RATES`) |
| 2 | **The form ↔ saved-data round trip is symmetric.** Write → read → write must return the same thing. Four money-affecting defects in a row were all an asymmetry here. | `paycalc-form-data.js` |
| 3 | **Every per-member key carries `pcPrefix()`; device flags never do.** And a retired device flag stays DECLARED — deleting one reclassifies it as member data and fires the ownership prompt at people who have none. | `paycalc-migrations.js` |
| 4 | **A tax year's holiday premium is paid on the FIRST JANUARY PAYSLIP OF THE FOLLOWING YEAR** — outside that year's own window. Four hand-rolled copies got this wrong; there is now one. | `paycalc-hpp-schedule.js` |
| 5 | **Back pay is not fed into HPP.** Whole-year settled pricing already includes the award uplift, so adding the lump double-counts it. Pinned on the real path by `paycalc-backpay.test.mjs` ("a computed, ticked and saved lump leaves the premium estimate exactly where the hours put it") and `e2e/paycalc-cards.spec.js` ("ticking the back-pay lump into the take-home leaves the holiday premium estimate alone"). | `paycalc-hpp.js` |
| 6 | **London Allowance does not accrue HPP.** It is a fixed allowance paid every period, including while on leave. | `paycalc-hpp.js` (`_varPayForPeriod`) |
| 7 | **HPP is never pro-rated for a joiner.** It accrues on actual extras done, so a part-year lump is naturally lower without any scaling term. | `paycalc-hpp.js` (`_varPayForPeriod`, which carries no pro-rate term) · this file → *Members with `startDate`* |
| 8 | **The hourly rate is fixed by grade and never stored.** Deriving it removes the whole stale-saved-rate failure class. | `paycalc-settings.js` |
| 9 | **Sunday-on-BH: Sunday wins (`dow===0` before `isBH`). BH + RDW is additive.** | `paycalc-roster-suggestions.js` (the suggestion engine; `paycalc-calc.js` only prices the hours) |
| 10 | **`validateBackup` is the trust boundary, and restore is a REPLACE, never a merge.** A backup is a file from somewhere; these are pay figures, not approximations. | `paycalc-transfer.js` |
| 11 | **The roster-assist never infers an ambiguous category** (swap shifts, rest-day weekday overrides) — and **viewing a period never persists it**. The settled exceptions are a plain `shift` on a rest-day SATURDAY or BANK HOLIDAY: the record's type decides, and it prices as a moved day, never RDW or Bank Holiday Overtime (owner, 19 and 20 Nov 2026 — *Chiltern Saturday payroll*, below). | `paycalc-roster-suggestions.js` · `paycalc-app.js` |
| 12 | **A pension opt-out is DATED, and the date is EDITABLE in both directions.** It applies from the payslip the member named onwards and never earlier — a period storing `null` takes the period default, so a timeless flag rewrites history (measured: £115.92 onto one 2025/26 take-home). An empty or unreadable timeline means CONTRIBUTING. Correcting the date must MOVE the spell's start (`withOptOutStartAt`), and un-ticking must END the spell at the payslip on screen (`withRejoinAt`) — recording a raw change at a payslip silently swallows a forward correction and turns every rejoin into an erasure. A start moved to or before an earlier rejoin is refused (`withOptOutStartAt` returns the timeline unchanged), so a spell that has already ENDED is left alone. | `paycalc-pension.js` |
| 13 | **A role with no confirmed rates gets no figure at all**, rather than a caption over somebody else's — and nothing sends such a member to the page either (the Calendar's notices ask the same function, `calendar-notices.js`). **It is the role AT THE TIME** (owner, 16 Nov 2026): a member is admitted when they held a priced grade on any day of the payslips the page shows, or today, and each payslip with a day under a role with no rates shows NO figure (`unpricedPayslipLine`) — never CEA's rate in its place, on any surface. | `roster-data.js` → `gradeForRole` · `pay-audience.js` → `payCalculatorPrices` · `paycalc-grade.js` → `payslipPriced` · `functions/pay-reminder.js` (the pay reminder push goes to CEA and CES members only — owner, 10 Nov 2026) |
| 14 | **The first period of an award window is a FRACTION**, not a whole period — its shifts run back into March and the award starts 1 April. Counting it whole made the lump 19% high against a real payslip. The rule is unit-tested; the thing that can silently regress is `calcBackPay` PASSING it, so `paycalc-backpay.test.mjs` drives the real `calcBackPay` against a fake `document` and asserts the returned £, alongside the rendered £ in `e2e/paycalc.spec.js` ("the back-pay lump scales the first period"). | `paycalc-backpay-accrual.js` → `awardWindowFactor` |
| 15 | **What a pay key IS has ONE authority, and an unrecognised one is carried, never dropped.** `paycalc-inventory.js` classifies; the backup summary, the card's itemised list and the damage preflight all ask it. A hand-written list restating the key vocabulary silently under-reported tax years — and a backup states what it holds ITEMISED, because a payslip count describes neither side of a replace. | `paycalc-inventory.js` |
| 16 | **The HPP and back-pay card HEADERS are the app's passive teaching of two entitlements, and the only route that reaches a member who does not already know to go looking.** Their collapsed title + hint ("Paid once a year on a January payslip — look for the green note on that payslip") is where a colleague who has never heard of HPP learns it exists. The result banners that promote both are gated on a STORED estimate (`_hppAvailableHere`, `_bpAvailableHere`), which needs prior-year hours — so the member who most needs the teaching gets no banner. The Pay Calculator Guide has an `<h2>` for each, so the headers are not the only EXPLANATION — they are the only route that costs the reader nothing and asks nothing of them first: a member who has never heard of HPP has no reason to open a guide looking for it. Never hide, group or shorten these headers without an owner decision; the case that nearly did is DECISIONS.md → "More pay tools" … DECLINED, and the principle is CLAUDE.md → "Plain English that TEACHES". | `paycalc.html` (card headers) · `paycalc-app.js` (banner gates) |
| 17 | **A payslip is priced at the grade held on its days** (owner, 13 Nov 2026). The roster dates a grade (`roleHistory`), so a promotion re-prices nothing before it; a payslip that SPANS one is each grade's rate weighted by its days, UNROUNDED — `calculate()` asks `periodRate`, never the field's two decimals, which would leave 140 contracted hours 45p short of 35 at one rate and 105 at the other. A grade chosen by hand covers WHOLE payslips from the one the member names, and only the roster's own dates split one. A member who never changed grade is priced to the last binary digit as before (`byDays` hands back the shared figure itself). The back-pay card prices ONE grade, so a promotion dated inside an award's backdated months fails a data test before it can be priced. By days is the owner's reading, not yet a payslip's: VAL-PAY-005 holds it open until the real one settles it. | `paycalc-grade.js` · `paycalc-settings.js` (`periodRate`, `settledRateFor`, `awardGrade`) · `paycalc-grade.test.mjs` · `paycalc-grade-wiring.test.mjs` |
| 18 | **Year to Date figures are used only when they FIT the tax code** (owner, 15 Nov 2026; both directions from 21 Nov). Tax Paid more than £2 over OR under what the code takes, worked out over the year, by the payslip the figures came from did not come from that code worked out the normal way: the payslip is then taxed ON ITS OWN and the line under Income Tax shows both figures. Over the code read as £0 tax and "a refund may be due"; under it charged the whole year's "shortfall" on the next payslip — most often a Settings code with less tax-free pay than the payslip's, or figures filed one payslip early. K codes are checked only over: the 50% limit leaves their Tax Paid short by design. | `paycalc-calc.js` → `computeTax` (`ytdMisfit`) · `paycalc.test.mjs` ("must fit the tax code") · `e2e/paycalc.spec.js` ("cannot come from the tax code") |

Unverified assumptions behind these figures are in `VALIDATION_REGISTER.md`, not here; the back-pay
accrual and the 28 Aug 2026 award step were settled against a real payslip and are in that file's
*Closed* section.

## Current rates — the pay figures

Primarily **manual-entry**. Staff enter hours; the calculator computes tax, NI, pension and
take-home. **Grades supported: CEA and CES.** Dispatcher is not supported — its rates are not
confirmed.

**Hourly rate** (`GRADES` holds the current default; `AWARD_RATES` holds each tax year's settled
rate and the rate paid before that year's award):

| Grade | Before the 2025/26 award | 2025/26 (paid from the 24 Oct 2025 payslip) | 2026/27 (paid from the 28 Aug 2026 payslip) |
|-------|--------------------------|---------------------------------------------|---------------------------------------------|
| CEA | £20.06/hr | £20.74/hr | **£21.49/hr** |
| CES | not on record (VAL-PAY-004) | £21.81/hr | **£22.60/hr** |

Both grades: **140 contracted hours per period**.

**London Allowance** (per period, `TAX_YEARS`): £267.08 → **£276.16** from the 24 Oct 2025 payslip
→ **£286.10** from the 28 Aug 2026 payslip.

**Pension default** (`Smart RPS CR Scheme`, `PENSION_STEPS`, shared by both grades — the recorded
values are payslip-confirmed for CEA, and no CES payslip history is on record, so a CES payslip
starts at the CEA figure: a stand-in, kept rather than left blank because no figure would be further
out, and SAID beside the pension box on every payslip worked as a CES, which asks for the payslip's
own — VAL-PAY-007; `applyPensionOptOutUI`, `paycalc-settings.js`): **£151.86** from the
28 Aug 2026 payslip (the award payslip) · **£150.74 on the 31 Jul 2026 payslip**, printed as two lines,
£113.90 + £36.84 · £147.36 from 8 May 2026 · £154.77 from 29 Aug 2025 · £156.29 on the 1 Aug 2025
payslip (DERIVED from payslip totals, not read off a payslip — VAL-PAY-003; correct it from the real
line if ever read) · £160.78 up to the 4 Jul 2025 payslip. Every step from £154.77 on was re-read
from twelve payslips, 19 Dec 2025 to 23 Oct 2026, on 10 Nov 2026, and each matches.

**2026/27 is the 3.6% RMT award, payslip-confirmed on the 28 Aug 2026 payslip** (VAL-PAY-002).
**A pay award moves the PENSION too** — the contribution is a proportion of pensionable pay — **and
the step can begin INSIDE the payslip before the award payslip.** The 2026/27 rise reached the
pension three weeks into the 31 Jul 2026 period: that payslip prints £113.90 (21 days at the new
£151.86) and £36.84 (7 days at the old £147.36), and the calculator holds one figure per payslip,
so it carries their total. When the next award lands, read the `Smart RPS CR Scheme` lines off the
award payslip AND the one before it, and add the `PENSION_STEPS` steps (MAINTENANCE_CALENDAR.md
carries it as a checklist row).

**How the step is applied.** The award applies automatically from its payslip: the hourly rate comes
from `GRADES` (current default) + `AWARD_RATES['2026/27']` (the authoritative per-year settled rate,
consulted per grade by `settledRate`), and the mid-year step — periods paid before 28 Aug 2026 still on
£20.74/£21.81 and London £276.16 — is applied by `getRateForPeriod`/`getLondonAllowanceForPeriod`,
keyed on `TAX_YEARS['2026/27'].londonAllowFrom`. The **arrears** back to 1 Apr 2026 remain the
**opt-in** back-pay lump (below), never auto-added to take-home.

**When the NEXT award is announced:** add its tax year to `TAX_YEARS` with `rateUnconfirmed: true`
and add the announced figure to `PENDING_AWARD_PCT` under that year's label (`paycalc-backpay.js` —
empty while no award is pending). When its payslip lands: bump `GRADES.rate`, set the year's
`AWARD_RATES.rate`, add the following year with `pre` = this rate, set the year's
`londonAllow`/`londonAllowPre`/`londonAllowFrom` on `TAX_YEARS`, drop `rateUnconfirmed`, and add the
`PENSION_STEPS` step from the award payslip.

**The tax year rollover — 2027/28, live before Sun 7 Mar 2027** (its first payslip's shifts start
then; MAINTENANCE_CALENDAR.md carries the date). By hand, all in `paycalc-calc.js`, and the test that
catches each miss:
1. **A `TAX_YEARS` row**: `first` = the last year's `last` + 1, `last` = `first` + 12, `hppPaidJan` the
   January after it ends, `londonAllow` the current figure, NO `rateUnconfirmed`, no award fields. The
   period selector follows it (`LAST_OFFSET` reads the last row). **Nothing fails if the row is never
   added** — the calendar row is the only reminder. A wrong `first`/`last` or `hppPaidJan`:
   `paycalc-hpp-schedule.test.mjs` (13 payslips a year, no overlap, the first January after).
2. **The four threshold tables** (`TAX_BY_YEAR`, `NI_BY_YEAR`, `SL_BY_YEAR`, `SCOTTISH_TAX_BY_YEAR`),
   read from GOV.UK's employer tables, never copied forward: `paycalc-current-year.test.mjs` →
   "every configured tax year has an entry in all four tables"; and its `CURRENT` must move to the
   new year ("CURRENT is the newest tax year"), with the Scottish and loan literals re-read there.
3. **Not at the rollover:** `AWARD_RATES`, `GRADES`, `PENSION_STEPS` and `PENDING_AWARD_PCT` move with
   the AWARD (above); until then the year prices at the current settled rate. The legacy-migration
   year is a fixed label (`paycalc-migrations.js`), and a payslip outside the table reads as its
   NEAREST year (`getTaxYearForOffset`), so neither moves with the table.

**Members with `startDate`:** for the joining period, `calcProRateFactor` scales contracted hours,
London Allowance and the pension default; all later periods use standard amounts automatically.
**HPP is NOT pro-rated by any factor, and must not be** (owner-confirmed Jul 2026; invariant 7): it
accrues on the extras actually done (overtime / RDW / Saturday / Sunday / BH / Boxing premiums), and
`_varPayForPeriod` has no pro-rate term. Do not re-introduce a joiner pro-rate factor into the HPP base.

**HPP amount source — three modes.** The current-year HPP figure can come from `'hours'` (default —
the per-payslip `calcHPP` estimator), `'ytd'` (a **rough estimate derived from the Year to Date card's
Taxable Pay** — no input of its own) or `'exact'` (a figure the member types into `#hppExactAmt`).
`_hppMode()` reads the radio; `calcHPP` branches on it, **writing the resulting figure to
`hppEstKey(ty)` in every mode** — so the January take-home add and the prior-year rollover (both read
`hppEstKey` via `resolveHppForPeriod`) are unchanged, and the opt-in include-tick still gates it.
State is **per tax year** (`hppModeKey(ty)`): `saveHppState`/`restoreHppState` persist the mode + the
exact input, and the coordinator restores in `onPeriodChange` BEFORE `loadPeriodData`'s `calculate()`
runs.
- **'ytd' reads `#ytdPay` (Taxable Pay) directly** and `hppFromYtdTaxable` (pure, unit-tested) takes
  7.69% of what is left after `_expectedNonPremiumYtd(ty)` subtracts expected basic + London − pension
  over the covered periods (to the `ytdSrcKey` source, else the last PAID payslip) and the lumps the
  app knows exactly (`knownYtdLumps`: peer-training pay, last year's premium, and the back-pay lump's
  basic and London arrears via `awardLumpNonPremium` — its premium share stays in). **What the record cannot split is SAID on the card, never guessed out**: a year whose old
  rate is not on record (CES 2025/26 — "may include back pay", owner, 10 Nov 2026), a premium no tax year on record claims
  (16 Jan 2026 carries 2024/25's — "may be a little high"), and a year ON record with no figure stored
  for its premium (2025/26's, paid 15 Jan 2027). The doc comments of `knownYtdLumps` and
  `_expectedNonPremiumYtd` hold the reasoning. The line says what the figure covers ("up to your …
  payslip"), and that a part-year figure for a year that has ended may be low.
  **`_expectedNonPremiumYtd` pro-rates ALL non-premium components by `getProRateFactor(p)`** —
  London and pension as well as basic, mirroring `calculate()` (why: the comment in its loop). Locked
  by a joiner ytd-mode e2e in `e2e/paycalc.spec.js`. Deliberately labelled **rough** (hours mode is
  more accurate). Editing the Year to Date card re-runs `calculate()` → `calcHPP`, so HPP follows it.
- **The 2025/26 premium, paid in January 2027, has no hours here** — the calculator did not exist
  that year. The Pay page's second notice (`hpp_2526`, 16 Nov 2026 – 8 Jan 2027, owner 16 Nov 2026)
  sends a member whose premium is still to estimate (`premiumStillToEstimate`, whose doc comment says
  what counts as done) to the 'ytd' route: the Taxable Pay on the LAST 2025/26 payslip (13 Mar 2026),
  whose Year to Date box holds the whole year. It ends the day before that January payslip can be in
  hand. The notice, the order and the tests: the new-notice skill's table.
- **Last year's block works a premium out from its hours only while that year's source IS its hours**
  (`updatePriorHpp`, 17 Nov 2026). A year whose member chose 'exact' or 'ytd' and has nothing in it
  yet shows £– and asks for that source's figure: an hours figure stored there was read back under
  the member's choice ("Your figure — Entered by you"), counted as done, and taken to the January
  payslip (invariant 1).
- **Each amount-source radio shows its CURRENT £** (`_updateModeAmounts`; "≈" marks the two
  estimates, the member's own figure shows plain, a source with nothing shows nothing). The hours
  estimate is computed in EVERY mode by the side-effect-free `_hoursEstimate` — only the active mode
  writes `hppEstKey`.
- **Empty paydays are NAMED:** the HPP partial hint, the year-so-far block and the back-pay compute
  notice each list the PAID payslips still missing hours (`fdList` in `paycalc-format.js` — capped at
  4 + "and N more", pure and tested; a future payslip is never "missing").
- **Pre-employment payslips are EXCLUDED:** the HPP window (`_hoursEstimate`) and the back-pay
  `_basicOnly` list both skip a period ENTIRELY before a mid-year joiner's start via
  `getProRateFactor(p) === 0` (0 only for a fully pre-start period; 1 for `noProRate` secondment
  returns and for members with no `startDate`). The £ is unchanged; only the count and the list.
  Locked by the joiner e2e in `e2e/paycalc.spec.js`. HPP's all-paid-entered state says "You're up to
  date"; back-pay's wording notes those payslips accrued basic-rate arrears only.
- **The HPP basis splits paid vs upcoming:** "N paid and M upcoming payslips entered" (`paidCount`
  in `_hoursEstimate`), matching the Year to Date card's "N of N paid" frame.
- **The prior-year confirm input is GATED:** `#priorHppActualInput` is disabled until the January
  payslip carrying the premium can be in hand (`payslipMayBeInHand`), with an "Unlocks when your
  January ⟨year⟩ payslip arrives" hint — EXCEPT when anything is stored, which always keeps it enabled
  (a wrong figure must never be locked in). Its placeholder is an example figure ("e.g. 1,843.01"),
  never the zero-like "0.00".

**Not in the pension scheme — a TIMELINE, not a flag.** A member who has opted out of or withdrawn
from the RPS ticks `#pensionOptOutCheck` in Settings **and names the first payslip with no
deduction** (`#pensionOptOutFrom`, the same shape as the student-loan cutover below it).
`SK.pensionTimeline` holds the changes; `paycalc-pension.js` holds the rules;
`getPensionDefault(pObj)` returns 0 only from the payslip named onwards. That single function is the
whole mechanism — the field default and `calculate()`'s fallback (via `periodDefaultPension`), the
HPP non-premium estimate and the year summary all route through it. **Why it is dated** (an undated
flag zeroed every historic payslip's default — £160.78 → £0.00 on a 2025/26 payslip) **and why a
timeline rather than one date** (auto-enrolment re-enrols opted-out staff about every three years):
invariant 12, and the header of `paycalc-pension.js`, which holds the rules. Inside a spell the
pension box is locked at £0.00, and a figure the member typed on that payslip stays dormant behind
it: every save keeps it as stored (`readFormData`'s `savedPension`, and Save settings), so
correcting the date brings it back.

**A grade this app has no confirmed rates for REFUSES.** `gradeForRole(role)` returns null for
anything but CEA/CES. A member who held neither on any day of the payslips the page shows, or today
(`payCalculatorPrices`, `pay-audience.js`), is shown a card naming the gap instead of the calculator
(invariant 13 — by the role AT THE TIME). A CES promoted into management keeps the CES payslips; for
each payslip with a day under the new role the result card says why and names the nearest payslip it can estimate
(`unpricedLineFor`), the year so far leaves it out and says so, the premium estimate skips it, the
rough Year to Date premium refuses a figure covering it, and back pay refuses an award whose months
were all under it (`awardGrade` → null). A grade chosen by hand does not price such a day either. The
Calendar's notices ask the same function over TODAY alone. **Do not invent Dispatcher values** — the rates and contractual terms are not on record. **A session name the roster does not hold refuses
the same way**: a leaver or a renamed member keeps a valid local session, and pricing them would fall
back to CEA rates in the bare shared `myb_pc_` namespace.

**Each payslip is priced at the grade held on its days** (owner, 13 Nov 2026; invariant 17). The
Grade setting is **From the roster** by default (`gradeDays` → `rolesInRange`), and a payslip across a
promotion is priced by days — paid 18 Dec 2026, 7 days as a CEA and 21 as a CES is (7 × £21.49 + 21 ×
£22.60) / 28 = £22.3225 an hour, which `#rateStepNote` explains in one line. Why by days, why premium
hours are an estimate on the same weighting, and the setting's shape: the header of
`paycalc-grade.js`. VALIDATION_REGISTER.md holds the check against the real 18 Dec payslip.
- **A grade chosen by hand** (CEA or CES, for acting up or a roster row not yet corrected) covers WHOLE
  payslips from the one `#gradeFrom` names (`SK.gradeFrom`); earlier ones follow the roster. A FIRST
  choice starts from the payslip on screen, as the pension tick's date does (`saveGradeSetting`).
- **A roster grade that differs from a CHOSEN one is ASKED about, never applied** (owner, 10 Nov
  2026): one line at the top (`gradeToOffer` / `renderGradePrompt`), for the payslip on screen
  (`rosterRolesOnScreen`), quiet while the chosen grade is any grade held on its days. "Keep" is
  remembered in `SK.gradeKept`; "Use" sets the Grade box to **From the roster** through its own change
  handler, so everything a grade touches re-prices as for a hand-picked one (`gradeToOffer`'s doc
  comment says when nothing is asked).
- **A device's grade saved before grades had dates is converted ONCE** (`settingFromLegacy`, in
  `loadSettings`): one the roster itself gives the member hands over to the roster, dates and all; one
  they KEPT over the roster's, or one the roster never gives them, stays theirs from the first payslip
  they can see. Until then it reads as covering every payslip — exactly what it did.
- **Settings says what the roster says** (`#gradeRosterLine`: "The roster lists you as CEA until
  21 Nov 2026, then CES from 22 Nov 2026."), and **a change of grade on the roster is said once**
  (`#gradeNote`, `SK.gradeNote` keyed by the change's first day): each payslip is priced at the grade
  held while it was worked, so there is nothing for the member to change.
- **Back pay is priced at the grade of the months the award covers** (`awardGrade`), never the
  payslip on screen's: a member promoted after an award was paid is owed it at the grade they earned it
  under. The Holiday Pay Premium prices each payslip at its own grade's settled rate (`settledRateFor`).

**The card's words are written for its reader** (owner, 7 Nov 2026): a Dispatcher is told their pay
is not covered *yet* — never a date; a manager is told who it is for, with nothing promised. Each
version, and the page's **sign-in card** (login-overlay.js → `about`, including that the staff PIN
does not open it), is argued in the header of `paycalc-role-card.js`. **The two are one door**: the refusal wears the sign-in card's panel (`.pc-role-card` joins the
shared do-this-first recipe), its "What it does" box and its "← Back to roster", centred over the page on
desktop rather than parked in the work columns — `e2e/paycalc.spec.js` pins the width and the centring.

`saveSettings` stores no member-level pension: each payslip keeps its own figure through the form
round trip, and a payslip with none takes its period default (`periodDefaultPension`, pro-rated on a
joining period).

The **roster-assist hint bar** pre-fills Sat/Sun/BH/Boxing Day/RDW hours from the base roster +
Firestore overrides. Standard weekday hours are not pre-filled. Pre-filled fields turn gold.
- **Viewing never persists:** the background fetch's auto-apply is DISPLAY-ONLY — the suggestion shows
  gold and feeds the live estimate (`_applyRosterSuggestion` + `calculate()`, no `autosave()`), but is
  NOT written to the period blob, nor to its calendar snapshot (invariant 11 — a snapshot written on a
  look was pay data on a new phone; the next save records the gold pairs it saved,
  `recordCalendarFigures`). Persistence needs an explicit action: typing anything
  into the period (autosave picks up the gold values too — implicit acceptance) or the "Fill from
  calendar" buttons — or merely VIEWING a period would mark it "entered" for HPP, year-so-far and
  back-pay counts.
- **Only the server's answer is "recorded changes loaded":** offline, the persistent cache answers
  instead of throwing, so `fetchOverridesForPeriod` returns `'cached'`, treated as `base-only` (⚠
  badge; the single Fill neither applies nor clears on it; the year fill names the period unreached,
  and gives up on a fetch after 15s — `paycalc-fill-year.js`, rule 3).
- **A gold figure the calendar no longer gives is taken off, on COMPLETE data only** (20 Nov 2026,
  `_calendarOwns`, `paycalc-roster-hint.js`): when a record moves box (the Saturday and bank holiday
  rules above), a payslip filled before keeps the old box's gold figure while the new box fills — the
  same hours twice. A pair the calendar filled and nobody touched (every filled box gold) is cleared
  when the calendar's answer for it is now nothing, in any category and on the background refresh too
  (display-only there, like the fill). A hand-typed figure is never gold, so `CLEARABLE_CATS` still
  guards it. `e2e/paycalc.spec.js` → "a calendar figure that moves box".
- **The single Fill re-checks that the payslip on screen is still the one it fetched for** before
  writing (the comment after its await in `paycalc-roster-hint.js`).
- **A payslip with no special-rate hours is entered when it says so** (18 Nov 2026). Every hours box is
  a special rate and basic pay needs nothing typed, so such a payslip saved only zeros, which read as
  empty — a Monday-to-Friday line stayed "Not entered yet" all year. `noSpecialHours` in the period
  blob counts as entered (`isDataEmpty`), set by the Hours card's "No special-rate hours on this
  payslip" tick or by "Fill these from your calendar" on the calendar's COMPLETE answer (`'loaded'`
  only, never cached, base-only or timed out — `paycalc-fill-year.js`). **Hours supersede it**: it is
  stored only beside none (`readFormData`), and the tick hides and clears while any special-rate hours
  are on screen, typed or gold (`syncNoSpecialTick`, `paycalc-form-data.js`).

## Paydays, cut-offs and the roster-assist

Binds this page and the Calendar's 💷 / ✂️ markers.

| Component | Location |
|-----------|----------|
| `getPaydaysAndCutoffs(year)` | `roster-data.js` |
| `isPayday(date)` / `isCutoffDate(date)` | `roster-data.js` |
| 💷 / ✂️ calendar markers | `calendar-renderer.js` — `.payday` / `.cutoff` CSS classes |
| `getRosterSuggestion(p, member)` | `paycalc-roster-suggestions.js` — counts Sat/Sun/BH/Boxing Day/RDW, and **never infers an ambiguous category** (swap shifts, rest-day weekday overrides) — a permanent policy, invariant 11, with its Saturday and bank holiday exceptions |
| `getEffectiveContr(p)` | `paycalc-settings.js` — contracted hours, pro-rated if member has `startDate` in the period |
| Reference guide | `paycalc-guide.html` |

## Payroll rules — do not change without confirmation

**Statutory deductions — HMRC methods, corrected against real payslips.**
- **Student/Postgraduate Loan rounding (`computeSL`):** subtract the pay-period threshold (annual ÷ 13,
  floored to the nearest **penny**) from earnings, apply the recovery rate to the **full excess (pence
  included)**, then floor the **deduction** to a whole pound — the deduction is the ONLY figure rounded
  to £. **Do NOT floor the excess to a whole pound before the rate**: it produced £213 on the reference
  P2 payslip where the correct figure is £214. Locked by the `PAYSLIP_ACTUALS.sl` regression in
  `paycalc.test.mjs`.
- **National Insurance is rounded to whole pennies, band by band** (reg 12(1)(b): a halfpenny or less
  is disregarded, read off the third decimal place — 5 or less rounds down, 6 or more rounds up). Each
  band is rounded, then the bands are added. **Income tax is rounded DOWN to the penny** (HMRC's
  tax-table routines). The take-home is the summary's rows subtracted as shown (`takeHomePay`), so the
  rows always add up. The rules and their sources are in `paycalc-calc.js`, beside `takeHomePay`.
- **Plan 5** is NOT repayable in 2025/26 (repayments begin 6 Apr 2026) — absent from
  `SL_BY_YEAR['2025/26']`, so `computeSL` returns 0 there and the UI disables it for that year.
- **One undergraduate plan + a Postgraduate Loan can apply together** — the UI is a plan `<select>`
  (None/1/2/4/5) plus a separate Postgraduate Loan yes/no; the coordinator sums
  `computeSL(plan) + computeSL('postgrad')`. HMRC deducts both independently.
- **Scottish flat-rate codes:** `SD0`→intermediate 21% (`bands[2]`), `SD1`→higher 42% (`bands[3]`),
  `SD2`→advanced 45% (`bands[4]`), `SD3`→top 48% (`bands[5]`). rUK has no D2/D3.
- **A week 1 / month 1 code is read however a payslip prints it** (15 Nov 2026). `readTaxCode`
  (`paycalc-calc.js`) is the ONE reader of a tax code — `computeTax` prices with it and the Year to Date
  rules in `paycalc-periods.js` ask it — and it takes HMRC's W1, M1 or X and a payslip's Wk1, Mth1,
  "Week 1/Month 1", a slash or brackets. "NC" is not HMRC's marker and is not
  guessed at: it stays unrecognised. The Tax Code box's hint asks for the marker and says what it means.
- **Year to Date figures must FIT the code, or they are not used** (owner, 15 Nov 2026; invariant 18).
  `computeTax` checks first that the Tax Paid is what the code takes on the Taxable Pay by the payslip
  the figures came from (period N − 1) — real payslips land within 25p; more than **£2** over
  (`YTD_FIT_TOLERANCE`) means a payroll taxing each payslip ON ITS OWN (a week 1 / month 1 basis a
  payslip may print as nothing more than "1257L"), a code changed since, or a mistyped figure; more
  than £2 UNDER (owner, 21 Nov 2026) means a code in Your Settings with less tax-free pay than the
  payslip's, figures filed against the wrong payslip, or a code lowered since. The
  payslip is then priced on its own (the standard method) and `ytdMisfit: { expected, paid }` goes to the summary, whose Income Tax line names
  both figures and says a code that has just changed may bring some back; the Year to Date card says
  "they don't fit your tax code", its chip reads "not in use", and the take-home's line does not ask
  for the same figures again.
  - **Why it exists, why both directions, why K codes only over, and why period 1 is not compared:**
    invariant 18 and the comment at the check in `computeTax`. With figures that fit, the cumulative
    method alone produces an over-collection only on a payslip paying less than its share of the
    allowance, where the standard method takes nil too.
  - **The costs, accepted by the owner:** a member who types a code raised since the payslip the
    figures came from gets the standard figure, with the line saying payroll may give some back,
    rather than the refund itself; and one whose code was LOWERED since gets the standard figure with
    the line saying payroll may take more (21 Nov 2026), rather than the collection itself.
  - **A flat-rate code (BR, D0, D1, the Scottish flat rates) can never be moved by figures that fit**,
    so the take-home's line never asks for them there (`ytdUpdateFrom`), as for NT.
- **An over-collected cumulative year that FITS its code is REPORTED, never netted.** Real cumulative
  PAYE refunds it — with figures that fit, a short-paid payslip. `computeTax` keeps the deduction at £0
  and returns the over-collection as `refund`; the summary's Income Tax row says a refund of about £X
  may be due and is not in the estimate. It is not netted into take-home because a single mistyped
  Year to Date figure would then invent money.
- **50% overriding limit (`computeTax`, PAYE reg 23) — K CODES ONLY:** the tax deducted in a period can
  never exceed 50% of the period's taxable pay, on both the cumulative and non-cumulative paths. For
  every other code the cumulative path is bounded by what the period's pay leaves after National
  Insurance and student loans — the deductions together never exceed what is paid, and the Income Tax
  row says to check Year to Date figures that ask for more (`payLimited`).
- **Cumulative PAYE needs BOTH Year to Date figures, and `0` is a figure** (`computeTax`'s
  `ytdPay != null && ytdTax != null`). `calculate()` reads the two boxes independently, so "Taxable Pay
  typed, Tax Paid still blank" is an ordinary mid-typing state; weakening the `&&` runs the recalc
  against a £0 tax-collected position and charges the whole year in one period, bounded only by the
  period's pay (by the 50% limit for a K code) — measured on the 13 Feb 2026 fixture payslip at more
  than twice the true deduction. Pinned by `paycalc.test.mjs` → "a half-filled Year to Date pair never
  engages the cumulative method", both directions plus the typed-£0 control.
- **Deductions STOP from a specific payslip:** earlier payslips keep theirs, so they still reconcile
  (setting the plan to None would wrongly strip them too). The `#slPaidOffFrom` select in Settings
  (visible only when a loan is active) records the **first payslip with no deduction** (p.num,
  member-level `SK.slPaidOff` — once-ever, NOT per tax year); `calculate()` zeroes BOTH loan legs for
  `p.num >=` it, the summary row reads "Student Loan — not deducted from your ⟨date⟩ payslip
  onwards", and the cutover outranks the per-period `slSkip`. It applies to both loans together.

  **The wording is the OBSERVABLE fact, never "repaid in full".** Being moved to DIRECT DEBIT for the
  final chunk is the Student Loans Company's normal endgame, so "stopped being deducted but NOT
  repaid" is a common end state, and a "repaid in full" label would assert something untrue on the
  control such a member reaches for first. The label is "Student loan stopped being deducted?".

  **THE MODEL IS TIMELESS; THE FACT IS TIME-VARYING.** The plan (`SK.sl`/`SK.pgLoan`) is
  MEMBER-LEVEL, so selecting it prices a deduction into *every* payslip that has hours — including
  earlier tax years. That makes "I turned the loan on this month and it changed my past payslips" the
  expected behaviour rather than a bug. The escape hatches are the one-way cutover above, and the
  **per-period `slSkip`** ("Student loan was not deducted this period", under Hours → Unusual
  deductions or corrections), which is the truth-bearing field and is honoured by `calculate()` AND
  `computeYearSoFar`.

  **That a plan applies to every payslip is said where it applies** (review, 15 Nov 2026): in the
  Settings block shown only once a loan is chosen (`#slEveryPayslip`, the condition that also puts
  this tick under Hours), naming the tick by its label, and in the ? panel's Student loan tip — not
  under the plan box, which every first visit reads. `paycalc-copy-parity.test.mjs` holds the words
  to the page's own labels; `e2e/paycalc.spec.js` → "the loan's every-payslip line shows only once a
  loan is chosen" holds the showing.

  **A resumption (ON → OFF → ON) is expressible, but only per payslip.** `slPaidOff` is monotonic, so it
  CANNOT model a gap — using it would zero the resumed payslips too. Tick `slSkip` on each payslip in
  the gap instead. **A range/bulk editor was considered and REJECTED (owner, Jul 2026):** the capability
  already exists in tested code, a gated one-person control would be a permanently unexercised branch,
  and the tedium is a one-time cost to the one member who understands it versus a permanent control
  for everyone who does not. Do not add one without a second member hitting this.

**Chiltern Saturday payroll:** rostered Saturday → `sat` (1.25×); a Saturday off worked as RDW → `rdw`
bucket — staff use the RDW field, not the Saturday field (confirmed by Gareth May 2026). **The RECORD's
type decides which, never the base roster alone** (owner, 19 Nov 2026): on a rest-day Saturday a record
of type `rdw` (Admin's RDW pill, the roster's RDW marker) is RDW, and a plain `shift` is a working day
MOVED there — a weekday swapped for the Saturday — and pays as a rostered Saturday inside the
contracted hours. Pricing every shift on a Saturday off as RDW put a swapped day on top of the
contracted hours, about a day's basic pay too high. Tests assert both. **A rest-day BANK HOLIDAY
follows the same rule** (owner, 20 Nov 2026): a plain `shift` there is "Bank Holiday Rostered 1.25",
inside the contracted hours; an `rdw` record is "Bank Holiday Overtime 1.25", on top.

**Chiltern Sunday-on-BH: Sunday wins (1.5×)** — the `dow === 0` check is before `isBH` in the
suggestion engine. Confirmed by Gareth May 2026.

**Boxing Day (26 Dec) is always 3× — even on a weekend.** The 3× rate attaches to the literal
26 December, whatever weekday it falls on; it is *not* moved to the substitute bank holiday. In the
suggestion engine the `isBoxing` (26 Dec) check runs **before** both the Sunday (`dow === 0` → 1.5×)
and Saturday (`dow === 6` → 1.25×) branches, so a worked 26 Dec always lands in the `box` bucket. The
substitute bank holiday (e.g. Mon 28 Dec 2026) is a normal BH → `Bank Holiday Rostered 1.25`, not
Boxing Day. Confirmed by Gareth Jul 2026. Tests assert both the Saturday (2026-12-26) and Sunday
(2027-12-26) cases in `paycalc-roster-suggestions.test.mjs`.

**BH + `rdw` override is additive, not replacement** — an `rdw` override on a worked BH day adds hours
to `bhOt`; base hours stay in `bh`. Do not change to "override replaces base" without specific
confirmation.

**Absence is FULL PAY and pays as the day underneath (owner, Jul 2026).** A `sick` override (incl.
the roster codes **HA** = hospital appointment, **OD** = paid absence / long-term sick marking,
**SC** = sick on a day booked to work, **ML** = maternity leave and **CL** = compassionate leave — all
normalised to `SICK` at upload; **SN** is sick on a day NOT booked to work and normalises to `RD`, not
`SICK`) resolves to the BASE shift in the suggestion engine: a rostered Saturday/BH keeps its premium
at base hours; a weekday contributes nothing extra (basic pay covers it); a base REST day contributes
NOTHING — the overpay guard for blanket Mon–Fri "OD" weeks marked on long-term sick members (the
upload also normalises absence-on-rest-day to RD so it is never even written, and a re-upload
REMOVE_IMPORTs stale ones). Absence can never land on a Sunday. **AL is deliberately NOT
full-pay-resolved** — it still suppresses the day; leave pay is payroll's own mechanism. Tests assert
all of this in `paycalc-roster-suggestions.test.mjs`.

**Training / Induction / Assessment / Team Day pays as the day underneath (OTHER_DAYS.md, confirmed
by Gareth Jul 2026).** A `training` override is the ONLY override that falls back to the base instead
of replacing it — resolved solely via `resolveOtherPay` in `override-utils.js` (never inline the
mapping): weekday → contracted basic (nothing suggested); rostered Sat/BH/Boxing → that day's premium
bucket at base hours; actual times on a rostered day → base-cap + excess→Overtime (BH over-run →
`bhOt`, matching "Bank Holiday Overtime 1.25"); **`TRG RDW` (training rest-day) → RDW bucket, 8h
default** (`OTHER_RDW_DEFAULT_MINS`) that the member adjusts — an RDW day is all-RDW, never split into
overtime — and the minutes ROUTE BY DAY exactly like a plain rdw override: **Boxing Day → `box` (3×),
a bank holiday → `bhOt`, anything else → `rdw`**; a rest-day base without the RDW flag still resolves
to rdw (belt and braces — as-base would pay £0). A member is **never paid less than their rostered
shift** even if training runs short. **Sundays, Christmas Day and Boxing Day can never be training days**
(confirmed by Gareth: Boxing Day Jul 2026, Christmas Day 21 Nov 2026) — so the `Boxing Day → box (3×)` routing above is a defensive fallback
for a case that does not occur in practice. Tests assert all of this in
`paycalc-roster-suggestions.test.mjs`.

**A Training day from the PATTERN has no times, and on a bank holiday it is the 7-hour day (owner,
7 Nov 2026).** Fixed pattern 3 is a bare `TRG` Monday to Friday — a trainee's weeks — and the engine
prices only a timed day, so a bank holiday inside those weeks would suggest no "Bank Holiday Rostered"
hours where the 09:00–16:00 line it stands for suggests 7. It suggests 7 (`BARE_TRAINING_DAY_MINS`),
flagged in `defaulted7h` so the hint row says "Includes a 7h estimate — check" — invariant 1: a
default is never dressed as a record. Absence, or an untimed Other day recorded on top, pays as the
day underneath and gets the same. A weekday needs nothing (contracted basic pay), and no pattern has a
bare Training Saturday; one there would still suggest nothing, so add it here first if one is ever
wanted.

**Back-pay lump sum — always backdated to 1 April, paid-in month EXCLUDED (confirmed by Gareth Jul
2026).** **The award is always backdated to the April period** of the award tax year — Chiltern's
pay anniversary — computed by `_backdatedFromPNum()` (`paycalc-backpay.js`), the single source for the
accrual window's lower bound and the award tax year. **Do not re-add a user-facing "backdated from"
field** — it always resolved to 1 April, so the choice was noise.

**THE FIRST PERIOD IS A FRACTION (VAL-PAY-001, settled against the real payslip).** A period is 28 days
of SHIFTS paid six days after its cut-off, so the first period of a tax year covers work done largely
in **March** — and the award is backdated to **1 April**. Counted whole, the accrual was 19% high
(£977.69 against £821.68 actually paid). `awardWindowFactor(p, backdatedFrom)` scales that period's
whole accrual to the days on or after 1 April (4/28 for 2026/27); every later period returns 1. The
London Allowance proves it — a flat per-period uplift with no hours in it, so it isolates the window:
4/28 + 4 × £9.94 = £41.18, exactly the arrears inside that payslip's London line. Premiums are scaled
by the same factor even though payroll paid the part-week's premiums in full: hours are stored per
PERIOD with nothing finer to apportion, and inventing a weekly split from period totals would look
more precise and be less true.

**Back-pay is per tax year — one award per year, each with its own old→new rates.** A pay rise happens
once a year, backdated to 1 April, and is usually PAID mid-year as a lump when agreed (2025/26 landed
on the 24 Oct 2025 payslip — the same date as `londonAllowFrom`). The reasons behind the mechanics
below are in the comments of `prefillBackPay`, `restoreBpState` and `calcBackPay` (`paycalc-backpay.js`).
- **The card FOLLOWS the viewed payslip's award year** (`currentPeriodNum()`), and its state is **per
  tax year** — `bpKey(ty)` → `myb_pc_<slug>_bp_state_<year>` (mirrors `hppIncKey`) — so each year's
  rates, mode, manual amount, paid-in and tick persist independently and the include-tick never resets
  on a year switch. Saved in `calcBackPay` only once the member has changed that year's card, or once
  that year already has a saved blob — **viewing alone writes nothing** — and restored by
  `restoreBpState()` at init. `syncBackPayForViewedYear()` (`paycalc-backpay.js`) runs on EVERY period
  change, not only while the card is open; the lump joins take-home only when `_bpPNum === _pNum`.
- **Amount source toggle (`bpMode`):** COMPUTE the lump from your hours or ENTER the figure from your
  payslip (`#bpManualAmt`). The **current award defaults to compute**; a **prior/already-paid award
  defaults to enter-from-payslip** (`_defaultBpMode`). `applyBpMode()` toggles `#bpComputeFields` /
  `#bpManualWrap`.
- **The paid-in list is bounded to the award's own tax year**
  (`buildBackPayPeriodSelect(48+ty.first, 48+ty.last)`), so a cross-year selection cannot survive a
  switch. Default = the **real payment period** for a settled award (the first payday ≥
  `awardFromForYear`), else the **next payday** (`todaysPeriodNum()`, not the selected period).
- **A DECIDED award sets its paid-in automatically** (owner: "that should be automatic"): with its
  payment date on record (`awardFromForYear(ty.label)`) the "which payslip carries this lump?" selector
  is HIDDEN and set for the member; it shows only for an as-yet-undecided future award.
- **A CONFIRMED award's rates are enforced and locked from the record** (`!ty.rateUnconfirmed`):
  `calcBackPay` WRITES the `AWARD_RATES`/`TAX_YEARS` figure into each compute-mode box whose figure is
  on record and locks exactly those (the lock rules: the three below). A figure NOT on record (the CES
  2025/26 award's old rate) leaves its box permanently editable. The "Pay rise %" helper
  (`#bpRisePctField`) shows only for an unconfirmed future award. Manual mode is unaffected.
- **The rates come from `AWARD_RATES`, never the mutable `GRADES` default**, so confirming a later
  award can never corrupt an earlier award's "old" rate. `prefillBackPay` fills OLD = `award.pre`, and
  NEW = `award.rate` for a **settled** year, else the `PENDING_AWARD_PCT` estimate (`applyBpRisePct()`,
  framed by `#bpEstimateNote`). A grade/year with no recorded `pre` leaves the OLD box blank — never
  guessed.
- **The award-application date is single-sourced** as the year's `londonAllowFrom` (read via
  `awardFromForYear(tyLabel)` — NOT stored on `AWARD_RATES`), and `isPreAwardPeriod(p, grade, tyLabel)`
  is the one shared predicate — called by `getRateForPeriod` and by `periodRate` (`paycalc-settings.js`),
  the one answer to "what rate was this payslip paid at", which `calculate()`, the rate field
  (`updateRateForPeriod`) and the Settings summary (`settingsSummary`, `paycalc-settings.js` — repainted
  by `confirmSettings`) all read.
- **Accrual correctness** (each reason is beside its line in `calcBackPay`/`prefillBackPay`): (a) stop
  at `awardFromForYear` for a settled award — periods paid on/after it owe £0; (b) cap at
  `todaysPeriodNum()` (today, not the SELECTED period); (c) **exclude the paid-in period itself**
  (`_capPNum = Math.min(bpPNum ? bpPNum - 1 : Infinity, todaysPeriodNum())`) — that month is already on
  the NEW rate; (d) **re-prefill the rate boxes when the award year changes** (`_lastAwardYear`), so one
  year's estimate never lingers under another year's label.
- **Pure maths:** the per-period arithmetic is `_accrueBackPayPeriod` (pure, unit-tested in
  `paycalc-periods.test.mjs`) — `calcBackPay` only maps DOM/storage to numbers and renders. Do not
  re-inline the arithmetic. The empty state renders in the **notice** element; an inverted Old/New pair
  shows `#bpOrderWarn` instead of silently blanking; the paid-in notice is past-tense for a payday gone.
- **Tax-year chip:** the back-pay, HPP AND Year to Date card headers each carry a `.card-year-chip`
  (`#bpYearChip` / `#hppYearChip` / `#ytdYearChip`), set in `onPeriodChange` from the viewed period's
  tax year, in the COMPACT form ("26/27"); the tax-year TABS keep the full "2026/27". **The longest
  title ("🏖️ Holiday Pay Premium (HPP)") fits one line at 375px with 2px to spare** — measure at 375px
  before widening the chip, the header gap or the title (`shared.css`, beside `.card-header h2`;
  css-tokens.md → card-header system).

**The back-pay card says each fact ONCE** (owner's phone-screenshot review), all owned by
`calcBackPay` (its comments say why at each step):
1. **A fully confirmed award collapses the two Old→New rate rows into one compact read-only
   `#bpRatesLine`** ("🔒 On record — hourly rate £A → £B · London Allowance £C → £D per period"). The
   boxes (`#bpRateField`/`#bpLondonField`) stay in the DOM hidden — they remain `calcBackPay`'s value
   store — and SHOW whenever any figure is NOT on record, so hand-completion still works.
2. The hero basis then reads "N periods backdated at the rates on record" — the rates are never stated
   twice.
3. **The notice does not restate the paid-in payslip** whenever `bpP` is set (the story strip and hero
   eyebrow already name it, date-first + P-number) — only the taxed-in-full fact (+ the missing-hours
   line).
4. **"Enter the amount from your payslip" is DISABLED until the paid-in payslip can be in hand**
   (`payslipMayBeInHand`). A restored manual selection for a still-future payslip falls back to
   compute (`applyBpMode('compute')`, the persisted state healed by `_saveBpState`). A prior/paid award
   keeps manual enabled and as default.

Voice: the amount-source questions on BOTH cards read "Where should this figure / this year's
estimate come from?" with second-person option labels ("your hours", "your payslip") — never
"we"/"my".

**The STORY leads the back-pay card** ("lead with the story, not the controls"). `calcBackPay`
rewrites the `#bpAwardScope` strip on EVERY exit path via the pure `bpStoryHtml()` (exported,
unit-tested in `paycalc-periods.test.mjs`; its doc comment lists the states), so the £ can never go
stale. In compute mode the figure is always "roughly £X" — an hours-derived estimate. **Do not re-add
a static explainer above the story**: the controls below are the mechanics, not the message.

**Back-pay estimate is AUTOMATIC, inclusion is OPT-IN (owner decision).** At init the coordinator calls
`restoreBpState()`: **true** (a same-year saved blob exists — even all-blank, which is a deliberate
clear that must stick) → recompute the saved figures; **false** → `refreshBackPayCard()` computes
the DEFAULT estimate with the card closed. **The lump only JOINS take-home when the member ticks "Add
this lump sum to this payslip's take-home estimate" (`#bpIncludeTick`, in the paid-in wrap) — OFF by
default (owner, Jul 2026).** The tick is persisted in the bp blob (`inc`) and returned by
`calcBackPay` as `bpIncluded`; the coordinator gates the gross addition (`_bpThisPeriod`) on it.
- **The gate is guarded by the RENDERED £, paired with the banner sentence** (`e2e/paycalc.spec.js` →
  "the back-pay lump joins take-home ONLY when the tick is on", and its Holiday Pay Premium twin):
  `paycalc-money-banner.test.mjs` pins the words against the `included` flag it is handed, so only a
  browser can catch an arithmetic gate that has stopped reading the same flag — the figure gaining the
  lump while the banner beneath it still reads "not added to this estimate".
- **The lump is deliberately NOT added into the HPP estimate** (invariant 5; the double count is
  argued in `calcHPP`'s header, `paycalc-hpp.js`): every period is priced at its SETTLED rate
  (`settledRateFor`, each payslip at its own grade's — invariant 17), which already includes the award
  uplift. Whether Chiltern pays one combined HPP or a separate HPP on the lump, the TOTAL is every
  period's variable pay at the new rate × 7.69%. `calcHPP()` takes no back-pay argument (`calcBackPay`
  still returns `bpVarAmount`, unused). Do not re-thread back pay into HPP without switching the
  whole-year pricing to period-aware rates — rejected, because it made the estimate shift with the
  viewed period.
- **London Allowance does NOT accrue HPP** (invariant 6, owner-confirmed): the back-pay lump still
  pays London arrears (in `backPay`), but `_accrueBackPayPeriod`'s `varPay` (the HPP-accruing portion)
  excludes London too.
- **The result banner on the paid-in period** — ticked "✓ Includes [estimated] back pay lump sum of
  £X", unticked "ℹ️ … could land on this payslip — not added to this estimate" ("will land" once the
  award is confirmed, "is on this payslip" once that payslip may be in hand) — keeps the estimate
  discoverable without inflating anyone's figure uninvited.
  Its words, its three states and the rule that "Includes" only ever describes a sum in the figure
  are `paycalc-money-banner.js`'s header. The second line (`.bp-banner-note`, owner request Jul
  2026): "For the best estimate, fill in your hours on each payslip back to 1 April <award year>." —
  none for a lump typed from the payslip. Every surface labels an unconfirmed award via
  `_bpIsEstimate`; once confirmed the same flow computes the REAL lump with plain labels — still
  opt-in.

**The main calculator honours the mid-year rate step too** — `getRateForPeriod` (`paycalc-calc.js`;
its doc comment says why and when it returns the settled rate) returns `AWARD_RATES[grade][ty].pre` for
a period whose `payday < from`, mirroring `getLondonAllowanceForPeriod`. `updateRateForPeriod(ty, p)` loads this period-aware rate into the
**read-only** `hourlyRate` field, labelled "· pre-rise rate", "· post-rise rate" (a pre-award period
whose earlier rate is not on record) or "· current rate", with a plain-language `#rateStepNote`
explaining the step; `calculate()` asks `periodRate` for the same figure, unrounded, so a
pre-24-Oct-2025 CEA period computes at £20.06 and matches the real payslip.
- **The hourly rate is FIXED BY GRADE and never user-editable or stored** (owner: "those should be
  fixed to the role"; invariant 8). `settledRate(grade, ty)` derives it purely from
  `AWARD_RATES`/`GRADES` (no localStorage), and `saveSettings` persists no rate. **Grade, Tax Code and
  Pension remain the editable settings.**
- **The pension steps are modelled the same way:** `PENSION_STEPS` in `paycalc-calc.js` (newest-first,
  null-from floor; walked by `getPensionForPeriod`) — the figures are in "Current rates" above.
  `readFormData` stores `null` for a pension equal to the period default, so touched periods keep
  self-healing (`paycalc-pension.js` header).

`calcBackPay` is DOM-driven — verify RENDERING changes with a screenshot — but **its three figure
decisions live in `paycalc-backpay-state.js` and are unit-tested**, because every recorded defect in
this family sat in the assembly rather than the accrual (the five are listed in that module's
header). Three rules to keep:

- **`bpFieldWrites` returns an entry for EVERY field in `BP_FIELDS`.** One pass, one schema — two
  hand-written lists that have to agree (a clear loop, then the sets) are how one year's old rate leaks
  into another's box.
- **The lock decision never reads a box's contents, and a locked box is WRITTEN with its recorded
  figure.** A lock keyed on contents freezes a half-typed fragment, or a stale restored value behind a
  padlock, which reads to the member as the app confirming it.
- **`resolvePaidInPeriod` must not return 0 while any candidate exists.** The ladder's ORDER is a
  judgement (a decided award derives and ignores what was saved, because a saved value can pin the lump
  to a payslip the award has moved off); never-zero is the safety property — and it holds in
  `restoreBpState` too, including a decided award whose payday falls beyond the generated period list.

## Tax-free pay: (code × 10) + 9 on the Year to Date path ONLY (measured)

HMRC grants the TOP of a code's £10 band (1257L = £12,579). `computeTax` applies the 9 on the
CUMULATIVE path (Year to Date figures entered) and NOT on the one-period estimate, and that split is
what the thirteen real 2025/26 payslips say: cumulative without it ran high every period (worst £3.75
by March) and with it lands within 25p (held by a 30p test in the payslip lane); the one-period
estimate matches 9 of 13 to the penny without it and only 7 with it. **Do not "make them consistent"
in either direction** — both directions were mutated and both fail. K codes are untouched (no K-code
payslip to check).

The **"Any other payslip adjustment"** box is added to pay and taxed (owner decision, Oct 2026): an
expense refund does not belong in it, and the row and the guide say so.

## New-starter visibility clamp

A member who **only started this tax year** should not see earlier tax years in the calculator —
"from this year onwards". `computeEarliestVisiblePNum(member)` in `paycalc-periods.js` returns the first
period of the member's **join tax year**; `setEarliestVisiblePeriod(getLoggedMember())` is called once
at init (before the tabs + period select are built), and `visiblePeriods()` / `isTaxYearVisible()` gate
the period `<select>`, the back-pay paid-in select, prev/next navigation, and the tax-year tabs.
**Tax-year granularity** (whole prior years are hidden, not individual pre-start periods). **Excluded
from the clamp:** members with no `startDate` (long-serving) and **`noProRate` secondment returns**
(full-year pay — they *were* employed in the prior year). `paycalc-periods.js` cannot import
`getLoggedMember` (circular), so the coordinator passes the member in. Covered by
`paycalc-periods.test.mjs`.

## Layout decisions

**`paycalc.html` desktop grid on `<main>`, not `.app`** — CSS grid applies to direct children only, so
declare it on `main { display: grid }`. `.app` only holds max-width.

**Desktop workspace layout (owner-approved "fill column 3")** — at ≥1024px paycalc is a
**three-column** grid whose workspace is **ONE grid row** holding two wrappers: `.pc-work` spans the
two wide work columns (`grid-column: 1 / 3`, ~650px so forms wrap far less — the real scroll-reduction
lever) and `.pc-side` is the **col-3 sidebar** stacking the **result card, the standalone year-so-far
card and the occasional cards**. Putting ONLY the result in col 3 leaves the rest of that column a
full-height navy void. The CSS half of each rule below is commented in `paycalc.css` (the ≥1024px
block) and `paycalc.html` (above `.pc-work`).
- **`.pc-work`** wraps `[setupBanner, gradePrompt, gradeNote, privacyNoteTop, settingsCard,
  period-controls, hoursCard]` — **the notes that head the page are its first children**, so a hidden note takes no gap and a shown one is as wide as the cards beneath it. With both
  wrappers sharing one grid row, **neither column's height can inflate the other's internal spacing**
  — the shorter column simply ends. (A sidebar that SPANS the left items' rows opens a navy void
  mid-page.) On desktop it is a flex column ordered period band, Hours, then Settings — and the order
  is IN THE DOM there (`wireSettingsCard`, paycalc-settings.js), because CSS `order` moves the paint
  and not the Tab order. The `order` rules stay, agreeing with the DOM, for the paint before that
  script runs.
- **`.pc-side`** (in `paycalc.html`) wraps `[result-card, ytdYearSoFar, payslipCard, hppCard,
  backPayCard, decimalConverterCard, payTransferCard]`. Below 1024px neither wrapper moves anything
  (`.pc-side` is `display: contents`, `.pc-work` a plain block — paycalc.css says why), so on
  **mobile** the cards stack in DOM order (the notes → Settings → period → Hours → Result →
  year-so-far → Year to Date → the four occasional cards). At ≥1024px each becomes
  `display: flex; flex-direction: column; gap: 16px`.
- **The result is NOT `position: sticky`.** The `#stickyTotal` fixed bottom bar keeps the take-home £
  visible while scrolling, and no sticky card shares a column.
- **Margin resets:** `.pc-work > *` / `.pc-side > * { margin-bottom: 0 }` — the flex `gap` owns the
  spacing; a `main > *` reset silently LOSES to class-carrying items.
- **Residual void:** a modest gap remains at the **bottom-right** (below the last occasional card) —
  deliberately the least prominent spot; all-expanded flips it to a bottom-**left** gap (rare) — never
  mid-page. Verify layout changes with a **rendered screenshot** (Playwright at 1366/1440), not just
  the geometry e2e.

**Sticky take-home bar (`#stickyTotal`)** — a fixed bottom bar on **all widths** (desktop capped to
`--content-max-width`, centred, rounded top corners, an `--on-navy-hairline` edge, and its label
beside the £ rather than 760px from it). `html { scroll-padding-bottom }` keeps a control reached with
Tab clear of it, and its own focus ring is the light token. It shows when the £ figure is off screen —
an `IntersectionObserver` on `#netDisplay` decides, except with a phone's keyboard up, when the VISUAL
viewport does: `stickyBarShows` in `paycalc-sticky-total.js`, which also scrolls the field being typed
in clear of the bar once per focus (`scrollToClearBar`); its header lists the iOS guards. `body.sticky-active` adds bottom
padding. The bar is the **sole** keep-the-£-visible mechanism on every width.

**Desktop card placement** — explicit grid-row placement (mobile DOM order is untouched — every rule
lives inside `@media (min-width:1024px)`): row 1 `.pc-work` (cols 1–2, the notes at its head — the
privacy note is FIRST-VISIT ONLY; the same line leads the `.disclaimer` note at the foot of the page on
every visit) and `.pc-side` (col 3), so the take-home is level with whatever heads the work column ·
`.guide-footer-link` row 2 · `.disclaimer` row 3 · the refusal card alone in row 1 across all three
columns, when everything else is hidden. **Never give a note a grid row of its own again**: an
empty row still takes its row-gap, and an unplaced one is auto-placed into a single column. `e2e/paycalc.spec.js` pins both halves — "a
hidden setup banner or privacy note leaves no gap behind it" and "the grade note spans the work
columns". `align-self:start` on the work cards and the
sidebar, so an expanding accordion never stretches its neighbour. The occasional cards stack in the
col-3 sidebar — never 2-up in the work columns, which re-creates voids whenever a tall expanded card
sits beside a short one.

## State management

**`_clearState` object** (`paycalc-app.js`) — groups all state for the two-tap destructive clear
action so it resets atomically. Includes `countdownTimer` for the live countdown in the button label,
and `armedAt`: a confirming tap within 500 ms of arming (`CLEAR_CONFIRM_MIN_MS`) is ignored as part
of the same gesture.

**`CONDITIONAL_ROWS`** (`paycalc-periods.js`, beside `updateBhRows(p)`, which iterates it) — a
data-driven array: condition → row IDs → field IDs. It holds the bank holiday rows alone: the Boxing
Day row is shown and hidden BY HAND in `onPeriodChange` (`paycalc-app.js`, beside the Boxing Day
banner it toggles too). A new conditional row can be one entry here, unless it carries something else
to toggle, as Boxing Day does.

**Per-member localStorage namespacing** (invariant 3) — all per-member paycalc keys are prefixed with a
member segment (`myb_pc_<slug>_…`) so two staff sharing a browser cannot read each other's pay data;
`pcPrefix()` is the single source (`paycalc-migrations.js`, "PER-MEMBER NAMESPACING", says how it is
activated). Pre-existing shared/legacy data is **not** silently claimed —
`hasPendingLegacyMigration()` detects it and `paycalc-lightboxes.js` prompts the member (mine → move /
fresh → discard / ✕ → decide later); `resolveLegacyMigration()` applies the choice and sets the
`myb_pc_ns_migrated` guard. Device-level flags (migration guards, "seen this notice",
`myb_pc_ns_migrated`) stay unnamespaced — see `DEVICE_KEYS`. Never build a paycalc key without
`pcPrefix()`/`SK`.

## Example payslips — the real-payslip regression net

**The pay-maths regression net is thirteen REAL payslips, and they are not in the repository.**
`test-fixtures/payslip-actuals.local.js` is gitignored (`*.local.js`): `firebase.json`'s
`test-fixtures/**` exclusion governs Firebase Hosting only, and the GitHub Pages mirror serves the repo
root obeying no ignore list (measured: 200 on the mirror, 404 on the canonical origin), so keeping the
bytes out is the only rule both origins obey. `sw-asset-check.test.mjs` guards the `.gitignore` line
itself. History was deliberately not rewritten — see KNOWN_LIMITATIONS.md.

- **On any checkout but the owner's the payslip regression SKIPS, loudly and by name; ABSENT is a
  skip, BROKEN is a failure** (presence is read off the filesystem, never inferred from an error
  code); and **`test-fixtures/payslip-actuals.example.js` documents the shape and is never imported**.
  Each rule, with the failure it prevents, is in the header of `paycalc.test.mjs`.
- **When changing pay maths (tax, NI, thresholds, variable pay), run `npm run test:payslip-local`** —
  it requires the fixture and FAILS if it is missing, so a pay-maths release has one command whose
  green means the real comparison actually ran. Use `paycalc-hpp.test.mjs` for `_varPayForPeriod`
  regressions.
- **Be precise about what that green MEANS: all thirteen payslips are 2025/26, a year that has
  ended.** The current year is locked by **`paycalc-current-year.test.mjs`**, built on the FREEZE
  (to Apr 2031) rather than on a tautology; its header holds the measurement that prompted it and
  why its uprated literals are a change-detector, not a truth-oracle.
- A **device-local** actuals overlay is developer-only: `paycalc-app.js` reads `readPayslipActuals()`
  from localStorage, gated by `isActualsDev` to the developer account, imported per device and never
  served. Full reasoning: AUTH_ARCHITECTURE.md → PAYSLIP_ACTUALS.

## Payslip line names — match these EXACTLY (source of truth)

**Principle:** the pay calculator is only useful if staff can find each figure on their actual
Chiltern payslip. So every "Shows as … on your payslip" pointer, field label and notice MUST use the
payslip's own wording verbatim — never a paraphrase. The authoritative source is the real payslip; the
figures used by the regression tests live in the gitignored `test-fixtures/payslip-actuals.local.js`
(`gross` = the payslip's **"Taxable Pay"** line). When the calculator gains a new pay item, find its
exact payslip line name first and quote it.

| In-app item | Exact payslip line name | Rate |
|-------------|-------------------------|------|
| Pension contribution | `Smart RPS CR Scheme` | — |
| Year-to-date pay figure (for accurate tax) | `Taxable Pay` (in the **Year to Date** box, at the **bottom left** of a Chiltern payslip — owner, 22 Oct 2026) | — |
| Year-to-date tax figure | `Tax Paid` (in the same **Year to Date** box, bottom left) | — |
| London Allowance | `London Allowance` | fixed |
| Saturday (rostered) | `Ord Basic Pay @1.25` | 1.25× |
| Bank Holiday worked (rostered) | `Bank Holiday Rostered 1.25` | 1.25× |
| Bank Holiday overtime | `Bank Holiday Overtime 1.25` | 1.25× |
| Overtime | `Overtime 1.25` | 1.25× |
| Rest Day Working | `RDW 1.25` | 1.25× |
| Rest Day Working — Sunday | `RDW Sun 1.5` | 1.5× |
| Boxing Day | `Bank Holiday Overtime 3.0` | 3.0× |
| Holiday Pay Premium (annual January lump) | `Holiday Pay Premium` | 7.69% (4/52) of variable pay |
| Peer training | shows as **extra basic pay** (no distinct line) | basic |
| The payslip comparison's pay row ("Compare more payslip lines") | `Taxable Pay` — this payslip's, after the pension, set against the summary's "Pay after pension deduction" | — |

**Date-first payslip identity (owner: "staff don't remember period numbers, they remember
paydates").** Every user-facing reference to a payslip LEADS with its payday and keeps the printed
P-number as the secondary cross-check (it matches the number printed on the payslip): the period
selector reads "Paid 3 Jul 2026 · P16", the Settings chip shows the payday, notes say "your 31 Jul
payslip (P20)", the pension label "for the 3 Jul payslip", breakdown rows date-first. The gold
`#periodBadge` P-chip beside the date strip stays (the date is adjacent; the badge IS the
cross-check). Internal `p.num` keys and `payslipPeriodNum()` are unchanged — display order only.

**A month means the payslip PAID in it (owner, 10 Nov 2026).** The Calendar's 💷 Pay button sends
`?month=`, and `periodPaidInMonth` opens the payslip whose payday is in that month — the 💷 in its
grid — never the one whose shifts cover it, which is usually paid the month after (in November 2026
that opened the 18 Dec payslip before the 20 Nov one had paid). In the one two-payday month a year it
is the first still to be paid, else the later. The drawer's Pay pill, with no month, still opens the
payslip being earned (the ● one).

**Year to Date:** always spell it out as "Year to Date" (never bare "YTD") and call the two figures
exactly `Taxable Pay` / `Tax Paid` — NOT "Gross Pay" (the Year to Date figure is taxable pay,
post-pension, not gross). Do not invent friendlier names for these — the whole point is that they
match the payslip box.

**Year to Date figures are ANCHORED to their source payslip (owner request).** The card records which
payslip the two totals were copied from (`ytdSrcKey(ty)`, a correctable "From which payslip?" select).
The stamp, the re-type move and the picker are four functions in `paycalc-periods.js` whose doc
comments carry the reasoning — `ytdAutoSource` (first entry: the latest PAID payslip),
`ytdSourceToStamp` (legacy figures), `ytdSourceAfterRetype` (figures typed in again over an older
source move to the payslip the take-home line names — never when typed into empty boxes, nor over a
payslip picked in the select on this visit) and `ytdSourceOffered` (from the current payslip's
cut-off the picker offers it too, because payslips are issued before payday).
- **Do not replace the first-entry stamp with a window that records NOTHING until the member picks**
  — a member who never picked would be stamped one payslip LATE on the first open after payday.
- **The cumulative PAYE method in `calculate()` engages ONLY on the payslip immediately after the
  source** (`p.num === src + 1`); any other payslip nulls the Year to Date inputs and falls back to the
  standard non-cumulative method. **That guard is one line and its regression is quiet on screen**:
  the chip and the note follow `computeTax`'s `usingCumulative`, so without it they call the figures
  "in use" on every payslip, beside a £ priced on stale totals. `e2e/paycalc.spec.js` → "Year to Date
  figures sharpen ONLY the payslip after their source" asserts the two together, probing the figures by
  their EFFECT (clear the boxes; the £ must move on source + 1 and must not move anywhere else).
- **`#ytdUptoNote` and `#ytdStatusChip`** (the header chip, readable while the card is collapsed:
  green "✓ in use", neutral "not in use", hidden with nothing to report) are written together by
  `updateYtdNote` (`paycalc-ytd-card.js`) from `ytdAnchorStatus`, whose doc comment says when each is empty and why — "in
  use" is what `computeTax` DID, never what the boxes hold. The source select's placeholder is the
  short "— choose a payslip —"; the two £ inputs carry example-figure placeholders ("e.g.
  21,758.94"), never the zero-like "0.00".
- **The January-HPP pointer is PERIOD-GATED:** `#ytdJanHppHint` ("This is the January payslip your
  Holiday Pay Premium lands on — enter the confirmed figure…") is unhidden by `calculate()` ONLY while
  the viewed payslip is the January one that carries HPP (the same `_hppTy` match that gates the HPP
  take-home add), and only where the HPP card's box can take the figure: the member was employed in
  that tax year (`isTaxYearVisible`), and the payslip may be in hand (`payslipMayBeInHand`) or a
  confirmed figure is stored. The year-round version is in the card's `?` help.
- `buildYtdSourceSelect(ty)` (paycalc-periods.js) offers the year's paid payslips, newest first (plus,
  from its cut-off, the one about to be paid), never one from before a mid-year joiner started.

**The take-home asks for the latest figures, because they change on every payslip (owner, 7 Nov
2026).** A one-off notice cannot keep a monthly figure current, so `#netYtdNudge` under the take-home
£ says *"For a closer tax figure, copy the Year to Date figures from your ⟨date⟩ payslip. Add them"*
wherever copying them would change the estimate on screen. The rule is `ytdUpdateFrom`
(paycalc-periods.js); `renderYtdLine` writes it on every `calculate()` run, and `wireYtdLine`'s button
opens the card at `#ytdPay`. **When it stays quiet, and why, is listed in `ytdUpdateFrom`'s doc
comment**: a paid payslip, the year's first, a week 1 / month 1 or NT code, a misfit (invariant 18),
an unrecognised code, a pre-start payslip, figures already in use or from this payslip or later, and
until the payslip to copy from can be in hand. Its code reading is `readTaxCode`, cross-checked
against `computeTax` over every code in `paycalc-periods.test.mjs`. It is also quiet beside a
confirmed payslip on the developer's device, which is no estimate.

The card's hint asks for the tax code to be checked against the same payslip, for the reason in the
"Check against your payslip" paragraph below: with the wrong code the figures make the estimate worse.

**"This tax year so far":** `#ytdYearSoFar` (a standalone `.pc-side` child) sums the year's ENTERED
payslips — `computeYearSoFar(ty, opts)` in **`paycalc-year-summary.js`** (its header says what it
re-runs and why) re-runs the same engine headlessly per paid payslip, non-cumulative, honouring the
per-period `slSkip` and the stopped-deductions cutover, each payslip rounded as the result card shows
it (`takeHomePay`), plus a projection deliberately labelled rough. Rendered by `renderYearCard`
(`paycalc-year-card.js`) after every `calculate()`; hidden until a payslip has hours; corrupt
periods surface a "may be too low" warning (no silent caps). Unit-tested by
`paycalc-year-summary.test.mjs` through the REAL calc engine.

**Provenance chips:** `#provChips` on the result hero names what fed THIS number (the chips are listed
in `buildProvChips`'s doc comment, `paycalc-breakdown.js`): cumulative tax neutral, a lump ADDED gold.
EMPTY (`:empty` hides the row) on a normal payslip. The back-pay/HPP *banners* remain the opt-in
OFFER surfaces; a chip is the compact receipt once a figure is IN.

**"Check against your payslip":** the result card's foot carries a £ input (`#actualNetInput`) where
the member types the take-home printed on the real payslip.
- **It appears from the payslip's CUT-OFF**, not its payday — `payslipMayBeInHand` in
  `paycalc-periods.js`, the same rule the Year to Date picker uses, because a payslip arrives before it
  pays and that is when a member compares it.
- The pure `buildActualCheck(actual, estimated, used)` in `paycalc-breakdown.js` (tested) renders a
  calm verdict — exact match / within £2 / ≤£25 close / larger. NEVER red — a mismatch is information,
  not an error. Its doc comment holds the bands and these rules, each with its measured case:
  **a gap names THIS estimate's own settings first** (`used` — the code `computeTax` read and the
  pension deducted — never a guess about the payslip), **the tax code goes before the Year to Date
  advice deliberately** (with a wrong code those figures make the next estimate WORSE: £23.20 out
  without them, £207.60 with them), **a code the engine does not recognise is never quoted as
  applied** (`recognised: false`), and where Year to Date figures are in use **a large gap also names
  the payslip they count from** (`used.ytdFrom`).
- The figure persists in the period blob (`actualNet`, null-when-blank like pension) and is
  deliberately EXCLUDED from `isDataEmpty`, so a period holding only this figure never counts as
  "entered" for HPP or the year so far.
