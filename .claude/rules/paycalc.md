---
paths:
  - "paycalc.html"
  - "paycalc-*.js"
  - "paycalc.css"
  - "test/paycalc.test.mjs"
  - "test/paycalc-*.test.mjs"
  - "e2e/paycalc*.spec.js"
  - "e2e/paycalc-helpers.js"
---

# Pay calculator — the rules

**This is the Pay Calculator's contract: what an editor must not break.** It holds the numbered
invariants, the payroll and design decisions that are not changed without the owner, the payslip's
own line names, and the real-payslip regression net. **The pay figures — grade rates, London
Allowance, pension steps, award dates — and the mechanics behind each card are in
`docs/PAYCALC_REFERENCE.md`, which is now their one home**; open it before changing a figure or a
card's behaviour. Unverified pay claims are `VAL-PAY-*` rows in `VALIDATION_REGISTER.md`, cited by ID.

## Invariants

If you are about to change how a figure reaches the screen, one of these is probably the thing you
are about to break. Each states WHAT must hold; the WHY is in `docs/PAYCALC_REFERENCE.md` or the
module header.

| # | Invariant | Where it lives |
|---|---|---|
| # | Invariant | Where it lives |
|---|---|---|
| 1 | **A figure not on record is never guessed.** A blank box the member can complete beats an inferred number that looks authoritative — the rate lock keys off the RECORD, never off box contents. | `paycalc-backpay-state.js` · `paycalc-calc.js` (`AWARD_RATES`) |
| 2 | **The form ↔ saved-data round trip is symmetric.** Write → read → write must return the same thing. Four money-affecting defects in a row were all an asymmetry here. | `paycalc-form-data.js` |
| 3 | **Every per-member key carries `pcPrefix()`; device flags never do.** And a retired device flag stays DECLARED — deleting one reclassifies it as member data and fires the ownership prompt at people who have none. | `paycalc-migrations.js` |
| 4 | **A tax year's holiday premium is paid on the FIRST JANUARY PAYSLIP OF THE FOLLOWING YEAR** — outside that year's own window. Four hand-rolled copies got this wrong; there is now one. | `paycalc-hpp-schedule.js` |
| 5 | **Back pay is not fed into HPP.** Whole-year settled pricing already includes the award uplift, so adding the lump double-counts it. Pinned on the real path by `paycalc-backpay.test.mjs` ("a computed, ticked and saved lump leaves the premium estimate exactly where the hours put it") and `e2e/paycalc-cards.spec.js` ("ticking the back-pay lump into the take-home leaves the holiday premium estimate alone"). | `paycalc-hpp.js` |
| 6 | **London Allowance does not accrue HPP.** It is a fixed allowance paid every period, including while on leave. | `paycalc-hpp.js` (`_varPayForPeriod`) |
| 7 | **HPP is never pro-rated for a joiner.** It accrues on actual extras done, so a part-year lump is naturally lower without any scaling term. | `paycalc-hpp.js` (`_varPayForPeriod`, which carries no pro-rate term) · `PAYCALC_REFERENCE.md` → *Members with `startDate`* |
| 8 | **The hourly rate is fixed by grade and never stored.** Deriving it removes the whole stale-saved-rate failure class. | `paycalc-settings.js` |
| 9 | **Sunday-on-BH: Sunday wins (`dow===0` before `isBH`). BH + RDW is additive.** | `paycalc-roster-suggestions.js` (the suggestion engine; `paycalc-calc.js` only prices the hours) |
| 10 | **`validateBackup` is the trust boundary, and restore is a REPLACE, never a merge.** A backup is a file from somewhere; these are pay figures, not approximations. | `paycalc-transfer.js` |
| 11 | **The roster-assist never infers an ambiguous category** (swap shifts, rest-day weekday overrides) — and **viewing a period never persists it**. The settled exceptions are a plain `shift` on a rest-day SATURDAY or BANK HOLIDAY: the record's type decides, and it prices as a moved day, never RDW or Bank Holiday Overtime (owner, 19 and 20 Nov 2026 — *Chiltern Saturday payroll*, under Payroll rules below). | `paycalc-roster-suggestions.js` · `paycalc-app.js` |
| 12 | **A pension opt-out is DATED, and the date is EDITABLE in both directions.** It applies from the payslip the member named onwards and never earlier — a period storing `null` takes the period default, so a timeless flag rewrites history (measured: £115.92 onto one 2025/26 take-home). An empty or unreadable timeline means CONTRIBUTING. Correcting the date must MOVE the spell's start (`withOptOutStartAt`), and un-ticking must END the spell at the payslip on screen (`withRejoinAt`) — recording a raw change at a payslip silently swallows a forward correction and turns every rejoin into an erasure. A start moved to or before an earlier rejoin is refused (`withOptOutStartAt` returns the timeline unchanged), so a spell that has already ENDED is left alone. | `paycalc-pension.js` |
| 13 | **A role with no confirmed rates gets no figure at all**, rather than a caption over somebody else's — and nothing sends such a member to the page either (the Calendar's notices ask the same function, `calendar-notices.js`). **It is the role AT THE TIME** (owner, 16 Nov 2026): a member is admitted when they held a priced grade on any day of the payslips the page shows, or today, and each payslip with a day under a role with no rates shows NO figure (`unpricedPayslipLine`) — never CEA's rate in its place, on any surface. | `roster-data.js` → `gradeForRole` · `pay-audience.js` → `payCalculatorPrices` · `paycalc-grade.js` → `payslipPriced` · `functions/pay-reminder.js` (the pay reminder push goes to CEA and CES members only — owner, 10 Nov 2026) |
| 14 | **The first period of an award window is a FRACTION**, not a whole period — its shifts run back into March and the award starts 1 April. Counting it whole made the lump 19% high against a real payslip. The rule is unit-tested; the thing that can silently regress is `calcBackPay` PASSING it, so `paycalc-backpay.test.mjs` drives the real `calcBackPay` against a fake `document` and asserts the returned £, alongside the rendered £ in `e2e/paycalc-backpay.spec.js` ("the back-pay lump scales the first period"). | `paycalc-backpay-accrual.js` → `awardWindowFactor` |
| 15 | **What a pay key IS has ONE authority, and an unrecognised one is carried, never dropped.** `paycalc-inventory.js` classifies; the backup summary, the card's itemised list and the damage preflight all ask it. A hand-written list restating the key vocabulary silently under-reported tax years — and a backup states what it holds ITEMISED, because a payslip count describes neither side of a replace. | `paycalc-inventory.js` |
| 16 | **The HPP and back-pay card HEADERS are the app's passive teaching of two entitlements, and the only route that reaches a member who does not already know to go looking.** Their collapsed title + hint ("Paid once a year on a January payslip — look for the green note on that payslip") is where a colleague who has never heard of HPP learns it exists. The result banners that promote both are gated on a STORED estimate (`_hppAvailableHere`, `_bpAvailableHere`), which needs prior-year hours — so the member who most needs the teaching gets no banner. The Pay Calculator Guide has an `<h2>` for each, so the headers are not the only EXPLANATION — they are the only route that costs the reader nothing and asks nothing of them first: a member who has never heard of HPP has no reason to open a guide looking for it. Never hide, group or shorten these headers without an owner decision; the case that nearly did is DECISIONS.md → "More pay tools" … DECLINED, and the principle is CLAUDE.md → "Plain English that TEACHES". | `paycalc.html` (card headers) · `paycalc-app.js` (banner gates) |
| 17 | **A payslip is priced at the grade held on its days** (owner, 13 Nov 2026). The roster dates a grade (`roleHistory`), so a promotion re-prices nothing before it; a payslip that SPANS one is each grade's rate weighted by its days, UNROUNDED — `calculate()` asks `periodRate`, never the field's two decimals, which would leave 140 contracted hours 45p short of 35 at one rate and 105 at the other. A grade chosen by hand covers WHOLE payslips from the one the member names, and only the roster's own dates split one. A member who never changed grade is priced to the last binary digit as before (`byDays` hands back the shared figure itself). The back-pay card prices ONE grade, so a promotion dated inside an award's backdated months fails a data test before it can be priced. By days is the owner's reading, not yet a payslip's: VAL-PAY-005 holds it open until the real one settles it. | `paycalc-grade.js` · `paycalc-settings.js` (`periodRate`, `settledRateFor`, `awardGrade`) · `paycalc-grade.test.mjs` · `paycalc-grade-wiring.test.mjs` |
| 18 | **Year to Date figures are used only when they FIT the tax code** (owner, 15 Nov 2026; both directions from 21 Nov). Tax Paid more than £2 over OR under what the code takes, worked out over the year, by the payslip the figures came from did not come from that code worked out the normal way: the payslip is then taxed ON ITS OWN and the line under Income Tax shows both figures. Over the code read as £0 tax and "a refund may be due"; under it charged the whole year's "shortfall" on the next payslip — most often a Settings code with less tax-free pay than the payslip's, or figures filed one payslip early. K codes are checked only over: the 50% limit leaves their Tax Paid short by design. | `paycalc-calc.js` → `computeTax` (`ytdMisfit`) · `paycalc.test.mjs` ("must fit the tax code") · `e2e/paycalc-ytd.spec.js` ("cannot come from the tax code") |

Unverified assumptions behind these figures are in `VALIDATION_REGISTER.md`, not here; the back-pay
accrual and the 28 Aug 2026 award step were settled against a real payslip and are in that file's
*Closed* section.

## Where the detail is

| You are changing | Read first, in `docs/PAYCALC_REFERENCE.md` |
|---|---|
| a rate, the London Allowance, a pension step, an award | → Current rates — the pay figures · When the NEXT award is announced · The tax year rollover |
| the Holiday Pay Premium card | → The Holiday Pay Premium — the amount source · Members with `startDate` |
| the back-pay card, the mid-year rate step | → Back pay · THE FIRST PERIOD IS A FRACTION · The mid-year rate step in the main calculator · The back-pay assembly — three rules |
| the pension opt-out | → Not in the pension scheme — a TIMELINE, not a flag |
| grades, the refusal card, a promotion | → Grades — who is priced, and at which grade |
| the roster-assist, Fill from calendar | → The roster-assist hint bar · Paydays, cut-offs and the roster-assist |
| tax, NI, student loans, premium days | → Payroll rules — the detail · Deductions STOP from a specific payslip · Premium days, absence and Other days |
| the Year to Date card, the year so far, the payslip check, how a payslip is named | → Year to Date, the year so far and the payslip check · Payslip identity — dates first, and a month's payslip |
| the desktop grid, the sticky bar, storage keys | → Layout decisions · State management · New-starter visibility clamp |

## Payroll rules — do not change without confirmation

Each is one line here; how it works, and the measurement behind it, is the reference's matching
section.

**Statutory deductions — HMRC methods, corrected against real payslips.**
- **Student and Postgraduate Loan (`computeSL`): only the DEDUCTION is floored to a whole pound** —
  never the excess before the rate, which gave £213 on the reference P2 payslip where the real figure
  is £214 (`PAYSLIP_ACTUALS.sl` in `paycalc.test.mjs`).
- **National Insurance is rounded to the penny band by band; income tax is rounded DOWN to the
  penny**; the take-home is the summary's rows subtracted as shown (`takeHomePay`), so they add up.
- **Plan 5 is not repayable in 2025/26**; one undergraduate plan and a Postgraduate Loan can apply
  together, summed.
- **`readTaxCode` is the ONE reader of a tax code** — W1, M1, X and a payslip's printed variants;
  "NC" is not HMRC's marker and stays unrecognised.
- **Year to Date figures must FIT the code, or they are not used** — more than £2 over or under
  (`YTD_FIT_TOLERANCE`) prices the payslip on its own (owner, 15 Nov 2026; under from 21 Nov;
  invariant 18).
- **An over-collected cumulative year that fits its code is REPORTED, never netted** — one mistyped
  Year to Date figure would otherwise invent money.
- **The 50% overriding limit is for K codes ONLY**; every other code is bounded by what the period's
  pay leaves (`payLimited`).
- **Cumulative PAYE needs BOTH Year to Date figures, and `0` is a figure** — weakening the `&&` charged
  more than twice the true deduction on the 13 Feb 2026 fixture payslip.
- **Deductions STOP from a specific payslip**, never by setting the plan to None, which strips earlier
  payslips too. **The wording is the observable fact, never "repaid in full"**: a loan moved to direct
  debit stops being deducted with a balance still owed. A gap (on, off, on) is the per-payslip `slSkip`;
  **a range or bulk editor was REJECTED (owner, Jul 2026)** — do not add one until a second member
  needs it.

**Premium days.**
- **Chiltern Saturday payroll: the RECORD's type decides, never the base roster alone** (owner,
  19 Nov 2026). On a rest-day Saturday an `rdw` record is RDW; a plain `shift` is a working day moved
  there and pays as a rostered Saturday inside the contracted hours. **A rest-day bank holiday follows
  the same rule** (owner, 20 Nov 2026).
- **Sunday-on-BH: Sunday wins** (`dow === 0` before `isBH`; Gareth, May 2026). **BH + `rdw` is
  additive**, never a replacement.
- **Boxing Day (the literal 26 December) is always 3×, even on a weekend** — its check runs before the
  Sunday and Saturday branches; the substitute bank holiday is an ordinary BH (Gareth, Jul 2026).
- **Absence is FULL PAY and pays as the day underneath** (owner, Jul 2026): a base rest day under
  absence contributes NOTHING (the overpay guard for blanket "OD" weeks). **AL is deliberately not
  resolved this way.**
- **Training and the other Other days pay as the day underneath**, only through `resolveOtherPay`
  (`other-day.js`) — never inline the mapping. A member is never paid less than the rostered shift.
  **Sundays, Christmas Day and Boxing Day are never training days** (Gareth: Jul 2026 and 21 Nov 2026),
  so a legacy one there prices as the day underneath and earns no day in lieu (owner, 25 Nov 2026).
- **A bare pattern `TRG` on a bank holiday suggests the 7-hour day** (`BARE_TRAINING_DAY_MINS`,
  owner, 7 Nov 2026), flagged `defaulted7h` so the hint says it is an estimate (invariant 1).

**Back pay.**
- **Always backdated to 1 April; the paid-in month is EXCLUDED** (Gareth, Jul 2026). `_backdatedFromPNum`
  is the single source. **Do not re-add a "backdated from" field** — it always resolved to 1 April.
- **The first period of an award window is a fraction** (invariant 14) — the measured case is the
  reference's "THE FIRST PERIOD IS A FRACTION".
- **The estimate is automatic; joining the take-home is OPT-IN, off by default** (owner, Jul 2026).
  `takeHomeInputs` gates it on the tick and on the paid-in payslip being the one on screen; the
  rendered £ is pinned beside the banner sentence, because only a browser sees the two disagree.
- **The back-pay card says each fact once, and the STORY leads it** (`bpStoryHtml`). Do not re-add a
  static explainer above the story.
- **A decided award sets its paid-in payslip automatically, and a confirmed award's rates are locked
  from the record** — never from a box's contents (`paycalc-backpay-state.js`).

**Rates and allowances.**
- **The hourly rate is fixed by grade and never stored** (owner: "those should be fixed to the role";
  invariant 8). Grade, Tax Code and Pension are the editable settings.
- **Do not invent Dispatcher values** — its rates and contractual terms are not on record; a grade with
  no confirmed rates refuses (invariant 13), and the refusal is worded for its reader (owner,
  7 Nov 2026; `paycalc-role-card.js`).
- **A roster grade that differs from a CHOSEN one is ASKED about, never applied** (owner, 10 Nov 2026).
- **The pay figures change only on evidence class B** — a real payslip or a confirmed award, never a
  rumoured figure (`MAINTENANCE_CALENDAR.md`). A pay award moves the pension too, so read the
  `Smart RPS CR Scheme` lines off the award payslip AND the one before it.

## Tax-free pay: (code × 10) + 9 on the Year to Date path ONLY (measured)

HMRC grants the TOP of a code's £10 band (1257L = £12,579). `computeTax` applies the 9 on the
CUMULATIVE path (Year to Date figures entered) and NOT on the one-period estimate, because that is
what the thirteen real 2025/26 payslips say: cumulative without it ran high every period (worst £3.75
by March) and with it lands within 25p (held by a 30p test in the payslip lane); the one-period
estimate matches 9 of 13 to the penny without it and only 7 with it. **Do not "make them consistent"
in either direction** — both directions were mutated and both fail. K codes are untouched (no K-code
payslip to check).

The **"Any other payslip adjustment"** box is added to pay and taxed (owner decision, Oct 2026): an
expense refund does not belong in it, and the row and the guide say so.

## Design decisions — do not change without the owner

- **The HPP and back-pay card headers stay as they are** (invariant 16).
- **Viewing a payslip never saves it** (invariant 11). The roster-assist's gold figures are
  display-only until the member acts: typing anything into the period saves them with it (implicit
  acceptance), as do the "Fill from calendar" buttons.
- **A payslip is named by its payday first** (owner: "staff don't remember period numbers, they
  remember paydates"), with the printed P-number as the cross-check: "Paid 3 Jul 2026 · P16". Internal
  `p.num` keys are unchanged (the reference's "Payslip identity").
- **A month means the payslip PAID in it** (owner, 10 Nov 2026): the Calendar's 💷 Pay button opens the
  payslip whose payday is in that month (`periodPaidInMonth`).
- **Year to Date figures are anchored to the payslip they came from** (owner request). Do not replace
  the first-entry stamp with one that records NOTHING until the member picks; figures typed before any
  payslip of that year can be in hand are `YTD_SRC_EARLY`, never nothing.
- **The cumulative method engages ONLY on the payslip straight after the source** (`takeHomeInputs`,
  rule 5). **That guard is one line and its regression is quiet on screen** — the chip and the note
  follow what `computeTax` did — so `e2e/paycalc-ytd.spec.js` probes it by its effect on the £.
- **The take-home asks for the latest Year to Date figures wherever copying them would change the
  estimate** (owner, 7 Nov 2026; `ytdUpdateFrom` says when it stays quiet).
- **"Check against your payslip" is NEVER red** (`buildActualCheck`): a mismatch is information, and
  a gap names this estimate's own settings first, the tax code before the Year to Date advice.
- **A new starter sees only the tax years from their joining year** (`computeEarliestVisiblePNum`);
  members with no `startDate` and `noProRate` secondment returns are excluded.
- **Every per-member key goes through `pcPrefix()`/`SK`** (invariant 3); shared legacy data is never
  claimed silently — the member is asked.

## Layout decisions

The mechanics and the measurements are the reference's "Layout decisions"; the CSS half of each rule
is commented in `paycalc.css` (the ≥1024px block).

- **Desktop workspace layout (owner-approved "fill column 3"): the grid is declared on `<main>`, not
  `.app`**, and the workspace is ONE grid row holding two wrappers — `.pc-work` across the two work
  columns and `.pc-side` in column 3 — so neither column's height can open a void in the other.
- **Never give a note a grid row of its own**: an empty row still takes its row-gap. The notes are
  `.pc-work`'s first children (`e2e/paycalc-layout.spec.js`).
- **The occasional cards stack in the column-3 sidebar, never 2-up in the work columns.**
- **The result card is NOT sticky**; `#stickyTotal`, the fixed bottom bar, is the sole
  keep-the-£-visible mechanism on every width.
- **Below 1024px nothing moves**: the cards stack in DOM order, and on desktop the work column's order
  is in the DOM too, because CSS `order` moves the paint and not the Tab order.
- Verify a layout change with a rendered screenshot at 1366 and 1440, not only the geometry e2e.

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

**Year to Date:** always spell it out as "Year to Date" (never bare "YTD") and call the two figures
exactly `Taxable Pay` / `Tax Paid` — NOT "Gross Pay" (the Year to Date figure is taxable pay,
post-pension, not gross). Do not invent friendlier names for these — the whole point is that they
match the payslip box.

## Example payslips — the real-payslip regression net

**The pay-maths regression net is thirteen REAL 2025/26 payslips, and they are not in the
repository.** `test-fixtures/payslip-actuals.local.js` is gitignored (`*.local.js`): Firebase
Hosting's `test-fixtures/**` exclusion does not bind the GitHub Pages mirror, which serves the repo
root (measured: 200 on the mirror, 404 on the canonical origin), so keeping the bytes out is the only
rule both origins obey. `sw-asset-check.test.mjs` guards the `.gitignore` line; the history left in
git is `KNOWN_LIMITATIONS.md` → "Real payslip figures stay in git HISTORY".

- **On any other checkout the regression SKIPS, loudly and by name; ABSENT is a skip, BROKEN is a
  failure** (presence is read off the filesystem, never inferred from an error code), and `test-fixtures/payslip-actuals.example.js` documents the shape and is never imported
  (the header of `paycalc.test.mjs`).
- **Before changing pay maths (tax, NI, thresholds, variable pay), run `npm run test:payslip-local`**,
  which FAILS without the fixture, so its green means the real comparison ran. `_varPayForPeriod`
  regressions: `paycalc-hpp.test.mjs`.
- **That green covers a year that has ended.** The current year is locked by
  `paycalc-current-year.test.mjs`, built on the freeze (to Apr 2031); its header says why its
  uprated literals are a change-detector, not a truth-oracle.
- The **device-local** actuals overlay is developer-only: `paycalc-app.js` reads `readPayslipActuals()`
  from localStorage, gated by `isActualsDev`, imported per device and never served.
