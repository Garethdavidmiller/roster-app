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
| 5 | **Back pay is not fed into HPP.** Whole-year settled pricing already includes the award uplift, so adding the lump double-counts it. | `paycalc-hpp.js` |
| 6 | **London Allowance does not accrue HPP.** It is a fixed allowance paid every period, including while on leave. | `paycalc-hpp.js` (`_varPayForPeriod`) |
| 7 | **HPP is never pro-rated for a joiner.** It accrues on actual extras done, so a part-year lump is naturally lower without any scaling term. | `paycalc-hpp.js` (`_varPayForPeriod`, which carries no pro-rate term) · this file → *Members with `startDate`* |
| 8 | **The hourly rate is fixed by grade and never stored.** Deriving it removes the whole stale-saved-rate failure class. | `paycalc-settings.js` |
| 9 | **Sunday-on-BH: Sunday wins (`dow===0` before `isBH`). BH + RDW is additive.** | `paycalc-roster-suggestions.js` (the suggestion engine; `paycalc-calc.js` only prices the hours) |
| 10 | **`validateBackup` is the trust boundary, and restore is a REPLACE, never a merge.** A backup is a file from somewhere; these are pay figures, not approximations. | `paycalc-transfer.js` |
| 11 | **The roster-assist never infers an ambiguous category** (swap shifts, rest-day weekday overrides) — and **viewing a period never persists it**. | `paycalc-roster-suggestions.js` · `paycalc-app.js` |
| 12 | **A pension opt-out is DATED, and the date is EDITABLE in both directions.** It applies from the payslip the member named onwards and never earlier — a period storing `null` takes the period default, so a timeless flag rewrites history (measured: £115.92 onto one 2025/26 take-home). An empty or unreadable timeline means CONTRIBUTING. Correcting the date must MOVE the spell's start (`withOptOutStartAt`), and un-ticking must END the spell at the payslip on screen (`withRejoinAt`) — recording a raw change at a payslip silently swallows a forward correction and turns every rejoin into an erasure. | `paycalc-pension.js` |
| 13 | **A role with no confirmed rates gets no figure at all**, rather than a caption over somebody else's — and nothing sends such a member to the page either (the Calendar's notices ask the same function, `calendar-notices.js`). | `roster-data.js` → `gradeForRole` (re-exported by `paycalc-settings.js`) |
| 14 | **The first period of an award window is a FRACTION**, not a whole period — its shifts run back into March and the award starts 1 April. Counting it whole made the lump 19% high against a real payslip. The rule is unit-tested; the thing that can silently regress is `calcBackPay` PASSING it, so `paycalc-backpay.test.mjs` drives the real `calcBackPay` against a fake `document` and asserts the returned £, alongside the rendered £ in `e2e/paycalc.spec.js` ("the back-pay lump scales the first period"). | `paycalc-backpay.js` → `awardWindowFactor` |
| 15 | **What a pay key IS has ONE authority, and an unrecognised one is carried, never dropped.** `paycalc-inventory.js` classifies; the backup summary, the card's itemised list and the damage preflight all ask it. A hand-written list restating the key vocabulary silently under-reported tax years — and a backup states what it holds ITEMISED, because a payslip count describes neither side of a replace. | `paycalc-inventory.js` |
| 16 | **The HPP and back-pay card HEADERS are the app's passive teaching of two entitlements, and the only route that reaches a member who does not already know to go looking.** Their collapsed title + hint ("Paid once a year on a January payslip — look for the green note on that payslip") is where a colleague who has never heard of HPP learns it exists. The result banners that promote both are gated on a STORED estimate (`_hppAvailableHere`, `_bpAvailableHere`), which needs prior-year hours — so the member who most needs the teaching gets no banner. The Pay Calculator Guide has an `<h2>` for each, so the headers are not the only EXPLANATION — they are the only route that costs the reader nothing and asks nothing of them first: a member who has never heard of HPP has no reason to open a guide looking for it. Never hide, group or shorten these headers without an owner decision; the case that nearly did is DECISIONS.md → "More pay tools" … DECLINED, and the principle is CLAUDE.md → "Plain English that TEACHES". | `paycalc.html` (card headers) · `paycalc-app.js` (banner gates) |

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
values are payslip-confirmed for CEA, and no CES payslip history is on record): **£151.86** from the
28 Aug 2026 payslip (the award payslip) · £147.36 from 8 May 2026 · £154.77 from 29 Aug 2025 ·
£156.29 on the 1 Aug 2025 payslip (DERIVED from payslip totals, not read off a payslip — VAL-PAY-003;
correct it from the real line if ever read) · £160.78 up to the 4 Jul 2025 payslip.

**2026/27 is the 3.6% RMT award, payslip-confirmed on the 28 Aug 2026 payslip** (VAL-PAY-002).
**A pay award moves the PENSION too** — the contribution is a proportion of pensionable pay, so it
stepped £147.36 → £151.86 on the award payslip. When the next award lands, read the
`Smart RPS CR Scheme` line off that payslip and add a `PENSION_STEPS` step (MAINTENANCE_CALENDAR.md
carries it as a checklist row).

**How the step is applied.** The award applies automatically from its payslip: the hourly rate comes
from `GRADES` (current default) + `AWARD_RATES['2026/27']` (the authoritative per-year settled rate,
consulted by `getStoredRateForYear`), and the mid-year step — periods paid before 28 Aug 2026 still on
£20.74/£21.81 and London £276.16 — is applied by `getRateForPeriod`/`getLondonAllowanceForPeriod`,
keyed on `TAX_YEARS['2026/27'].londonAllowFrom`. The **arrears** back to 1 Apr 2026 remain the
**opt-in** back-pay lump (below), never auto-added to take-home.

**When the NEXT award is announced:** add its tax year to `TAX_YEARS` with `rateUnconfirmed: true`
and reset `PENDING_AWARD_PCT` (`paycalc-backpay.js` — dormant while no award is pending) to the
announced figure. When its payslip lands: bump `GRADES.rate` + labels, set the year's
`AWARD_RATES.rate`, add the following year with `pre` = this rate, set the year's
`londonAllow`/`londonAllowPre`/`londonAllowFrom` on `TAX_YEARS`, drop `rateUnconfirmed`, and add the
`PENSION_STEPS` step from the award payslip.

**Members with `startDate`:** for the joining period, `calcProRateFactor` scales contracted hours,
London Allowance and the pension default; all later periods use standard amounts automatically.
**HPP is NOT pro-rated by any factor, and must not be** (owner-confirmed Jul 2026): HPP accrues
purely on the actual extras done (overtime / RDW / Saturday / Sunday / BH / Boxing premiums), so a
joiner's lump is naturally lower because they did fewer extras after joining. That is exactly what
`_varPayForPeriod` does — it has no pro-rate term. Do not re-introduce a joiner pro-rate factor into
the HPP base.

**HPP amount source — three modes.** The current-year HPP figure can come from `'hours'` (default —
the per-payslip `calcHPP` estimator), `'ytd'` (a **rough estimate derived from the Year to Date card's
Taxable Pay** — no input of its own) or `'exact'` (a figure the member types into `#hppExactAmt`).
`_hppMode()` reads the radio; `calcHPP` branches on it, **writing the resulting figure to
`hppEstKey(ty)` in every mode** — so the January take-home add and the prior-year rollover (both read
`hppEstKey` via `resolveHppForPeriod`) are unchanged, and the opt-in include-tick still gates it.
State is **per tax year** (`hppModeKey(ty)`): `saveHppState`/`restoreHppState` persist the mode + the
exact input, and the coordinator restores in `onPeriodChange` BEFORE `loadPeriodData`'s `calculate()`
runs.
- **'ytd' reads `#ytdPay` (Taxable Pay) directly.** Taxable Pay is ALL pay, so
  `_expectedNonPremiumYtd(ty)` subtracts expected basic + London − pension over the covered periods
  (to the `ytdSrcKey` source, else `todaysPeriodNum`) and `hppFromYtdTaxable` takes 7.69% of what is
  left. **`_expectedNonPremiumYtd` pro-rates ALL non-premium components by `getProRateFactor(p)`** —
  London and pension as well as basic — mirroring `calculate()` (London ×`_proRateFactor`, pension
  ×`getProRateFactor`) and the real payslip; at full value, every pre-start period of a mid-year joiner
  would add phantom "London − pension" pay and bias the estimate low. Locked by a joiner ytd-mode e2e
  in `e2e/paycalc.spec.js`. Deliberately labelled **rough** (hours mode is more accurate). Editing the
  Year to Date card re-runs `calculate()` → `calcHPP`, so HPP follows it. `hppFromYtdTaxable` is pure
  and unit-tested.
- **Each amount-source radio shows its CURRENT £** (`.hpp-mode-amt` spans, written by
  `_updateModeAmounts` on every `calcHPP` run), so the choice is informed. The hours estimate is
  computed in EVERY mode by the side-effect-free `_hoursEstimate` (no persistence — only the active
  mode writes `hppEstKey`). "≈" marks the two estimates; the member's own figure shows plain; a source
  with nothing to offer shows nothing.
- **Empty paydays are NAMED:** the HPP partial hint, the year-so-far block and the back-pay compute
  notice each list the PAID payslips still missing hours (`fdList` in `paycalc-format.js` — capped at
  4 + "and N more", pure and tested; a future payslip is never "missing").
- **Pre-employment payslips are EXCLUDED:** the HPP window (`_hoursEstimate`) and the back-pay
  `_basicOnly` list both skip a period ENTIRELY before a mid-year joiner's start via
  `getProRateFactor(p) === 0` (0 only for a fully pre-start period; 1 for `noProRate` secondment
  returns and for members with no `startDate`, so it never over-reaches). The £ is unchanged — those
  periods contribute £0 either way; only the count and the list. Locked by the joiner e2e in
  `e2e/paycalc.spec.js`. HPP's all-paid-entered state says "You're up to date"; back-pay's wording
  notes those payslips accrued basic-rate arrears only.
- **The HPP basis splits paid vs upcoming:** when entered periods include FUTURE payslips
  (calendar-filled ahead of time) the count reads "N paid and M upcoming payslips entered" (`paidCount`
  in `_hoursEstimate`), matching the Year to Date card's "N of N paid" frame.
- **The prior-year confirm input is GATED:** `#priorHppActualInput` is disabled until the January
  payslip carrying the premium exists (the first January payday of the due year has passed), with an
  "Unlocks when your January ⟨year⟩ payslip arrives" hint — EXCEPT when a stored actual already exists,
  which always keeps the input enabled (the repair path: a wrong figure must never be locked in). Its
  placeholder is an example figure ("e.g. 1,843.01"), never the zero-like "0.00".

**Not in the pension scheme — a TIMELINE, not a flag.** A member who has opted out of or withdrawn
from the RPS ticks `#pensionOptOutCheck` in Settings **and names the first payslip with no
deduction** (`#pensionOptOutFrom`, the same shape as the student-loan cutover below it).
`SK.pensionTimeline` holds the changes; `paycalc-pension.js` holds the rules;
`getPensionDefault(pObj)` returns 0 only from the payslip named onwards. That single function is the
whole mechanism — the field default and `calculate()`'s fallback (via `periodDefaultPension`), the
HPP non-premium estimate and the year summary all route through it.
- **Why it is dated:** `readFormData` stores `null` when the pension equals the period default (so a
  period keeps healing as the app learns the real historic rates), so an undated flag makes that
  default £0 for **every payslip there has ever been** — measured on a 2025/26 payslip, £160.78 →
  £0.00 and take-home up £115.92.
- **Why a timeline rather than one date:** auto-enrolment re-enrols opted-out staff about every three
  years, so a rejoin is expected, and a single "opted out from" field would produce the same bug in
  reverse. Invariant 12 above; the rules and their reasoning are in `paycalc-pension.js`.

**A grade this app has no confirmed rates for REFUSES.** `gradeForRole(role)` returns null for
anything but CEA/CES, and `paycalc-app.js` then withholds the calculator behind a card naming the gap
— never a complete, polished estimate at somebody else's rate. **Do not invent Dispatcher values** —
the rates and contractual terms are not on record. **A session name the roster does not hold refuses
the same way**: a leaver or a renamed member keeps a valid local session, and pricing them would fall
back to CEA rates in the bare shared `myb_pc_` namespace.

**The card's words are written for its reader** (`paycalc-role-card.js`, owner, 7 Nov 2026): a
Dispatcher is told their pay is not covered *yet* and will be added once Dispatcher rates are
confirmed — never a date; a manager is told who it is for, with nothing promised; each says what the
calculator does and links its guide, because the page's own guide link goes with the calculator. The
page's **sign-in card** carries the same explanation (login-overlay.js → `about`), including that the
staff PIN does not open it — worded for everyone, because this page signs the PIN out moments after it
arrives. **The two are one door**: the refusal wears the sign-in card's panel (`.pc-role-card` joins the
shared do-this-first recipe), its "What it does" box and its "← Back to roster", centred over the page on
desktop rather than parked in the work columns — `e2e/paycalc.spec.js` pins the width and the centring.

`saveSettings` guards the pension default on joining periods — it writes `getPensionDefault(curP)`
(full rate), not the field value (pro-rated). Without this guard, saving Settings on the joining
period corrupts the default for later periods.

The **roster-assist hint bar** pre-fills Sat/Sun/BH/Boxing Day/RDW hours from the base roster +
Firestore overrides. Standard weekday hours are not pre-filled. Pre-filled fields turn gold.
- **Viewing never persists:** the background fetch's auto-apply is DISPLAY-ONLY — the suggestion shows
  gold and feeds the live estimate (`_applyRosterSuggestion` + `calculate()`, no `autosave()`), but is
  NOT written to the period blob. Persistence needs an explicit action: typing anything into the period
  (autosave picks up the gold values too — implicit acceptance) or the "Fill from calendar" buttons.
  Otherwise merely VIEWING a period with special shifts would mark it "entered" for HPP, year-so-far and
  back-pay counts.
- **Only the server's answer is "recorded changes loaded":** offline, Firestore's persistent cache
  answers `getDocs` instead of throwing — possibly with nothing — so `fetchOverridesForPeriod` returns
  `'cached'` and leaves the state `base-only` (⚠ badge; the single Fill neither applies nor clears on
  it; the year fill names the period unreached, and gives up on a fetch after 15s).
- **The single Fill re-checks that the payslip on screen is still the one it fetched for** before
  writing, so switching payslip mid-fetch cannot write one payslip's calendar into the next.

## Payroll rules — do not change without confirmation

**Statutory deductions — HMRC methods, corrected against real payslips.**
- **Student/Postgraduate Loan rounding (`computeSL`):** subtract the pay-period threshold (annual ÷ 13,
  floored to the nearest **penny**) from earnings, apply the recovery rate to the **full excess (pence
  included)**, then floor the **deduction** to a whole pound — the deduction is the ONLY figure rounded
  to £. **Do NOT floor the excess to a whole pound before the rate**: it produced £213 on the reference
  P2 payslip where the correct figure is £214. Locked by the `PAYSLIP_ACTUALS.sl` regression in
  `paycalc.test.mjs`.
- **Plan 5** is NOT repayable in 2025/26 (repayments begin 6 Apr 2026) — absent from
  `SL_BY_YEAR['2025/26']`, present in 2026/27. `computeSL` returns 0 for a plan5 selection on a 2025/26
  period; the UI disables it for that year.
- **One undergraduate plan + a Postgraduate Loan can apply together** — the UI is a plan `<select>`
  (None/1/2/4/5) plus a separate Postgraduate Loan yes/no; the coordinator sums
  `computeSL(plan) + computeSL('postgrad')`. HMRC deducts both independently.
- **Scottish flat-rate codes:** `SD0`→intermediate 21% (`bands[2]`), `SD1`→higher 42% (`bands[3]`),
  `SD2`→advanced 45% (`bands[4]`), `SD3`→top 48% (`bands[5]`). rUK has no D2/D3.
- **An over-collected cumulative year is REPORTED, never netted.** Real cumulative PAYE refunds it (a
  new starter off an emergency code, a code raised mid-year). `computeTax` keeps the deduction at £0
  and returns the over-collection as `refund`; the summary's Income Tax row says a refund of about £X
  may be due and is not in the estimate. It is not netted into take-home because a single mistyped
  Year to Date figure would then invent money.
- **50% overriding limit (`computeTax`, PAYE reg 23) — K CODES ONLY:** the tax deducted in a period can
  never exceed 50% of the period's taxable pay, on both the cumulative and non-cumulative paths. For
  every other code the cumulative path is bounded by the period's pay instead — a deduction never
  exceeds what is paid.
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

  **A resumption (ON → OFF → ON) is expressible, but only per payslip.** `slPaidOff` is monotonic, so it
  CANNOT model a gap — using it would zero the resumed payslips too. Tick `slSkip` on each payslip in
  the gap instead. **A range/bulk editor was considered and REJECTED (owner, Jul 2026):** the capability
  already exists in tested code, a gated one-person control would be a permanently unexercised branch,
  and the tedium is a one-time cost to the one member who understands it versus a permanent control
  for everyone who does not. Do not add one without a second member hitting this.

**Chiltern Saturday payroll:** rostered Saturday → `sat` (1.25×); Saturday-on-RD → `rdw` bucket —
staff use the RDW field, not the Saturday field. Confirmed by Gareth May 2026. Tests assert this.

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
shift** even if training runs short. **Sundays and Boxing Day (26 Dec) can never be training days**
(confirmed by Gareth Jul 2026) — so the `Boxing Day → box (3×)` routing above is a defensive fallback
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
2026).** `paycalc-backpay.js`: **the award is always backdated to the April period** of the award tax
year — Chiltern's pay anniversary. There is **no "backdated from" selector** (it always resolved to
1 April, so the choice was noise); `_backdatedFromPNum()` computes it internally as
`48 + awardTy.first` and is the single source for both the accrual window's lower bound and the award
tax year. Do not re-add a user-facing "backdated from" field.

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
on the 24 Oct 2025 payslip — the same date as `londonAllowFrom`).
- **The card FOLLOWS the viewed payslip's award year:** `_backdatedFromPNum()`/`prefillBackPay()`
  derive the award from `currentPeriodNum()` (the viewed period), so viewing a 2025/26 payslip shows
  the 2025/26 award. State is **per tax year** — `bpKey(ty)` → `myb_pc_<slug>_bp_state_<year>`, e.g.
  `…_bp_state_2026_27` (mirrors `hppIncKey`) — so each year's rates, mode, manual amount, paid-in and
  tick persist independently (saved in `calcBackPay`, restored by `restoreBpState()` at init), and the
  include-tick never resets on a year switch. The coordinator's `_syncBackPayForViewedYear()` runs on
  EVERY period change, not only while the card is open, so the banner and take-home reflect whichever
  payslip is on screen; the lump joins take-home only when `_bpPNum === _pNum` (its paid-in payslip is
  the one viewed).
- **Amount source toggle (`bpMode`):** each year can COMPUTE the lump from your hours (the rate×hours
  accrual) or ENTER the actual figure from your payslip (`#bpManualAmt`). The **current award defaults
  to compute** (it is an estimate); a **prior/already-paid award defaults to enter-from-payslip**
  (`_defaultBpMode`) — the actual figure is on the payslip and needs none of that year's old hours.
  `applyBpMode()` toggles which field group shows (`#bpComputeFields` vs `#bpManualWrap`).
- **The paid-in list is bounded to the award's own tax year**
  (`buildBackPayPeriodSelect(48+ty.first, 48+ty.last)` — a payslip before the award's April cannot
  carry its lump), so a cross-year selection cannot survive a switch; a stale selection is filtered
  out and re-defaults. Default = the **real payment period** for a settled award (the first payday ≥
  `awardFromForYear`), else the **next payday** (`todaysPeriodNum()`, not the selected period) — so a
  historic lump lands where it really landed and that period's estimate matches the actual payslip.
- **A DECIDED award sets its paid-in automatically** (owner: "that should be automatic"): when the
  award's payment date is on record (`awardFromForYear(ty.label)`) the "which payslip carries this
  lump?" selector is HIDDEN and set for the member (the notice still names the payslip); it shows only
  for an as-yet-undecided future award.
- **A CONFIRMED award's rates are enforced and locked from the record** (`!ty.rateUnconfirmed`):
  `calcBackPay` WRITES the `AWARD_RATES`/`TAX_YEARS` figure into each compute-mode box whose figure is
  on record and locks exactly those. The lock never keys off box contents (that trapped a member's
  first keystroke and froze stale restored values), and a figure NOT on record (the CES 2025/26
  award's old rate) leaves its box permanently editable so compute mode can be completed by hand. The
  "Pay rise %" helper (`#bpRisePctField`) shows only for an unconfirmed future award. Manual
  (enter-from-payslip) mode is unaffected.
- **The rates come from `AWARD_RATES`, never the mutable `GRADES` default**, so confirming a later
  award can never corrupt an earlier award's "old" rate. `prefillBackPay` fills OLD = `award.pre` (the
  prior-year rate); for a **settled** year it also fills NEW = `award.rate`; for an **unconfirmed** year
  it leaves NEW to the `PENDING_AWARD_PCT` estimate, which the coordinator's `_applyBpRisePct()` turns
  into the New rate/London (the `#bpEstimateNote` banner makes the estimate framing explicit). A
  grade/year with no recorded `pre` leaves the OLD box blank — never guessed. `#bpAwardScope` names the
  year on the card.
- **The award-application date is single-sourced** as the year's `londonAllowFrom` (read via
  `awardFromForYear(tyLabel)` — NOT stored on `AWARD_RATES`), and `isPreAwardPeriod(p, grade, tyLabel)`
  is the one shared predicate — used by `getRateForPeriod` and `confirmSettings` (`paycalc-settings.js`),
  and through `periodRate` there, the one answer to "what rate was this payslip paid at", by both the
  rate field (`updateRateForPeriod`) and the Settings summary in `paycalc-app.js`.
- **Accrual correctness:** `calcBackPay` (a) stops at `awardFromForYear` for a settled award — periods
  paid on/after it were already on the new rate and owe £0; (b) caps at `todaysPeriodNum()` (today, not
  the SELECTED period) so a future selection cannot accrue unworked weeks; (c) **excludes the paid-in
  period itself** — `_capPNum = Math.min(bpPNum ? bpPNum - 1 : Infinity, todaysPeriodNum())` — because in
  the month the lump is paid you are already on the NEW rate; and (d) **re-prefills the rate boxes when
  the award year changes** (`_lastAwardYear` reset in `prefillBackPay`, and `onPeriodChange` refreshes
  the card while open), so one year's estimate never lingers under another year's label.
- **Pure maths:** the per-period arithmetic is `_accrueBackPayPeriod` (pure, unit-tested in
  `paycalc-periods.test.mjs`) — `calcBackPay` only maps DOM/storage to numbers and renders. Do not
  re-inline the arithmetic. The empty state renders in the **notice** element; an inverted Old/New pair
  shows `#bpOrderWarn` instead of silently blanking; the paid-in notice is past-tense for a payday
  already gone.
- **Tax-year chip:** the back-pay, HPP AND Year to Date card headers each carry a `.card-year-chip`
  (`#bpYearChip` / `#hppYearChip` / `#ytdYearChip`) naming the tax year the card is for — set in
  `onPeriodChange` (all three follow the viewed period's tax year), so it is clear which year you are
  editing even while collapsed. The chip shows the COMPACT form ("26/27"); the tax-year TABS keep the
  full "2026/27". **The longest title ("🏖️ Holiday Pay Premium (HPP)") fits one line at 375px with
  2px to spare** (it wraps at 360px, as it always has), so a wider chip, a wider header gap or a bigger
  title size will tip it — measure at 375px before landing one (`shared.css`, beside
  `.card-header h2`).

**The back-pay card says each fact ONCE** (owner's phone-screenshot review), all owned by
`calcBackPay`:
1. **A fully confirmed award collapses the two Old→New rate rows into one compact read-only
   `#bpRatesLine`** ("🔒 On record — hourly rate £A → £B · London Allowance £C → £D per period"). The
   boxes (`#bpRateField`/`#bpLondonField`) stay in the DOM hidden — they remain `calcBackPay`'s value
   store — and SHOW whenever any figure is NOT on record, so hand-completion still works.
2. The hero basis then reads "N periods backdated at the rates on record" — the rates are never stated
   twice 100px apart.
3. **The notice does not restate the paid-in payslip** whenever `bpP` is set (the story strip and hero
   eyebrow already name it, date-first + P-number) — it carries only the taxed-in-full fact (+ the
   missing-hours line).
4. **"Enter the amount from your payslip" is DISABLED until the paid-in payslip exists**
   (`payday < now`): there is no printed figure to copy from a future payslip. A restored manual
   selection for a still-future payslip falls back to compute (`applyBpMode('compute')`, with the
   persisted state healed by `_saveBpState`). A prior/paid award keeps manual enabled and as default.

Voice: the amount-source questions on BOTH cards read "Where should this figure / this year's
estimate come from?" with second-person option labels ("your hours", "your payslip") — never
"we"/"my".

**The STORY leads the back-pay card** ("lead with the story, not the controls"). `calcBackPay`
rewrites the `#bpAwardScope` strip on EVERY recompute via the pure `bpStoryHtml()` (exported,
unit-tested in `paycalc-periods.test.mjs`): one or two plain-English sentences stating the award's
shape (which award, paid from which payslip date-first, backdated to which 1 April) plus this member's
figure ("Yours is roughly £X" in compute mode — always "roughly", it is an hours-derived estimate; the
exact £, tense-aware, in manual mode; a prompt or empty-window line otherwise). Every prefill path
ends in `calcBackPay()`, which owns the strip, so the £ can never go stale. The controls below (mode
toggle, rate boxes) are the mechanics, not the message — do not re-add a static explainer above the
story.

**Back-pay estimate is AUTOMATIC, inclusion is OPT-IN (owner decision).** At init the coordinator calls
`restoreBpState()`: **true** (a same-year saved blob exists — even all-blank, which is a deliberate
clear that must stick) → recompute the saved figures; **false** (no saved state: first visit, or an
award year with no blob yet) → `_refreshBackPayCard()` computes the DEFAULT estimate with the card
closed. **The lump only JOINS take-home when the member ticks "Add this lump sum to this payslip's
take-home estimate" (`#bpIncludeTick`, in the paid-in wrap) — OFF by default (owner, Jul 2026).** The
tick is persisted in the bp blob (`inc`) and returned by `calcBackPay` as `bpIncluded`; the
coordinator gates the gross addition (`_bpThisPeriod`) on it.
- **The gate is guarded by the RENDERED £, paired with the banner sentence** (`e2e/paycalc.spec.js` →
  "the back-pay lump joins take-home ONLY when the tick is on", and its Holiday Pay Premium twin):
  `paycalc-money-banner.test.mjs` pins the words against the `included` flag it is handed, so only a
  browser can catch an arithmetic gate that has stopped reading the same flag — the figure gaining the
  lump while the banner beneath it still reads "not added to this estimate".
- **The lump is deliberately NOT added into the HPP estimate** (invariant 5). `calcHPP` prices every
  period of the year at the SETTLED (post-award) rate via `getStoredRateForYear`, so a pre-award
  period's variable pay is already valued at the new rate — which *includes* the award uplift. The
  lump's variable portion is that same uplift, so feeding it in as well double-counts it (by
  `bpVarAmount × 7.69%`). Whether Chiltern pays one combined HPP or a separate HPP on the lump, the
  TOTAL is every period's variable pay at the new rate × 7.69%, exactly what the new-rate pricing
  produces. `calcHPP()` takes no back-pay argument (`calcBackPay` still returns `bpVarAmount`, unused).
  Do not re-thread back pay into HPP without switching the whole-year pricing to period-aware rates —
  rejected, because it made the estimate shift with the viewed period.
- **London Allowance does NOT accrue HPP** (invariant 6, owner-confirmed):
  `_varPayForPeriod` adds no London, so the HPP base is the genuinely variable premiums only
  (OT/RDW/Sun/Sat/BH/Boxing). The back-pay lump still pays London arrears (in `backPay`), but
  `_accrueBackPayPeriod`'s `varPay` (the HPP-accruing portion) excludes London too.
- **The result banner on the paid-in period has two states:** ticked → "✓ Includes [estimated] back
  pay lump sum of £X"; computed but unticked → "ℹ️ … could land on this payslip — not added to this
  estimate" ("will land" once the award is confirmed; with the view-card link), so the estimate stays
  discoverable without inflating anyone's figure uninvited. Both carry a second line
  (`.bp-banner-note`, owner request Jul 2026): "For the best estimate, fill in your hours on each
  payslip back to 1 April <award year>." (`paycalc-money-banner.js`) — the year derives from the award
  tax-year label, so it rolls forward untouched. Every surface labels an unconfirmed award via
  `_bpIsEstimate`. Once the award is confirmed the same flow computes the REAL lump (settled prefill +
  real payment period) with plain labels — still opt-in.

**The main calculator honours the mid-year rate step too.** A pay award is backdated to 1 April but
PAID from a mid-year date, so periods paid before that date were paid at the prior year's rate.
`getRateForPeriod(p, grade, tyLabel, settledRate)` in `paycalc-calc.js` returns
`AWARD_RATES[grade][ty].pre` for a period whose `payday < from`, else the settled rate — mirroring
`getLondonAllowanceForPeriod`. `updateRateForPeriod(ty, p)` loads this period-aware rate into the
**read-only** `hourlyRate` field, labelled "· pre-rise rate", "· post-rise rate" (a pre-award period
whose earlier rate is not on record) or "· current rate", with a plain-language `#rateStepNote`
explaining the step; since `calculate()` reads the field, a pre-24-Oct-2025 CEA period computes at
£20.06 and matches the real payslip.
- **The hourly rate is FIXED BY GRADE and never user-editable or stored** (owner: "those should be
  fixed to the role"; invariant 8). `getStoredRateForYear` derives it purely from
  `AWARD_RATES`/`GRADES` (no localStorage), and `saveSettings` persists no rate. **Grade, Tax Code and
  Pension remain the editable settings.**
- **The pension steps are modelled the same way:** `PENSION_STEPS` in `paycalc-calc.js` (newest-first,
  null-from floor; walked by `getPensionForPeriod`) — the figures are in "Current rates" above.
  `readFormData` stores `null` when the pension field equals the period default, so touched periods
  keep self-healing.

`calcBackPay` is DOM-driven — verify RENDERING changes with a screenshot — but **its three figure
decisions live in `paycalc-backpay-state.js` and are unit-tested**, because every recorded defect in
this family sat in the assembly rather than the accrual (state that lost the lump on reload, a year
switch that left the previous year's rate in a box, a missing paid-in that dropped the lump to £0 with
no visible control to fix it, and the rate locks). Three rules to keep:

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
payslip to check). The 50% overriding limit applies to **K codes only** (HMRC's rule).

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
full-height navy void.
- **`.pc-work`** wraps `[settingsCard, period-controls, hoursCard]`. With both wrappers sharing one
  grid row, **neither column's height can inflate the other's internal spacing** — the shorter column
  simply ends, and the residual gap falls to that column's bottom. (A sidebar that SPANS the left
  items' rows makes grid distribute its excess height across the spanned tracks, opening a navy void
  mid-page.) On desktop it is a flex column ordered period band, Hours, then Settings — and the
  order is IN THE DOM there (`wireSettingsCard`, paycalc-settings.js, moves the card after Hours from
  1024px and back below it), because CSS `order` moves the paint and not the Tab order. The `order`
  rules stay, agreeing with the DOM, for the paint before that script runs.
- **`.pc-side`** (in `paycalc.html`) wraps `[result-card, ytdYearSoFar, payslipCard, hppCard,
  backPayCard, decimalConverterCard, payTransferCard]`. Both wrappers are `display: contents` by
  DEFAULT, so on **mobile** they vanish and the cards stack in DOM order (Settings → period → Hours →
  Result → year-so-far → Year to Date → the four occasional cards). At ≥1024px each becomes
  `display: flex; flex-direction: column; gap: 16px`.
- **The result is NOT `position: sticky`.** It is a static flex child; the `#stickyTotal` fixed bottom
  bar keeps the take-home £ visible while scrolling, and no sticky card shares a column.
- **Margin resets:** `.pc-work > *` / `.pc-side > * { margin-bottom: 0 }` — the flex `gap` owns the
  spacing. These class-level resets genuinely win (equal specificity to the cards'
  `margin-bottom: 16px`, later in the file), unlike a `main > *` reset, which silently LOSES to
  class-carrying items; the result is one consistent 16px card rhythm.
- **Residual void:** the always-open left cards are taller than the collapsed sidebar, so a modest gap
  remains at the **bottom-right** (below the last occasional card) — deliberately the least prominent
  spot. All-expanded flips the imbalance to a bottom-**left** gap (rare) — never mid-page. Verify
  layout changes with a **rendered screenshot** (Playwright at 1366/1440), not just the geometry e2e.

**Sticky take-home bar (`#stickyTotal`)** — a fixed bottom bar on **all widths** (desktop capped to
`--content-max-width`, centred, rounded top corners, an `--on-navy-hairline` edge, and its label
beside the £ rather than 760px from it). `html { scroll-padding-bottom }` keeps a control reached with
Tab clear of it, and its own focus ring is the light token. It shows when the £ figure is off screen —
an `IntersectionObserver` on `#netDisplay` decides, except with a phone's keyboard up, when the VISUAL
viewport does (the keys cover the layout viewport without shrinking it, so the observer called a £
behind them "in view"): `stickyBarShows` in `paycalc-sticky-total.js`, which also scrolls the field
being typed in clear of the bar once per focus (`scrollToClearBar`). `body.sticky-active` adds bottom
padding. The bar is the **sole** keep-the-£-visible mechanism on every width.

**Desktop card placement** — explicit grid-row placement (mobile DOM order is untouched — every rule
lives inside `@media (min-width:1024px)`): rows 1–2 the banners and privacy note (cols 1–2 — the
privacy note is FIRST-VISIT ONLY, and a rule in paycalc.css pulls the workspace up by one gap when it
is hidden, because an empty grid row still takes its row-gap; the same line leads the `.disclaimer`
note at the foot of the page on every visit) · row 3 `.pc-work` (cols 1–2) and `.pc-side` (col 3) ·
`.guide-footer-link` row 4 · `.disclaimer` row 5. `align-self:start` on the work cards and the
sidebar, so an expanding accordion never stretches its neighbour. The occasional cards stack in the
col-3 sidebar — never 2-up in the work columns, which re-creates voids whenever a tall expanded card
sits beside a short one.

## State management

**`_clearState` object** (`paycalc-app.js`) — groups all state for the two-tap destructive clear
action so it resets atomically. Includes `countdownTimer` for the live countdown in the button label.

**`CONDITIONAL_ROWS`** (`paycalc-periods.js`, beside `updateBhRows(p)`, which iterates it) — a
data-driven array: condition → row IDs → field IDs. Adding a conditional row means one array entry,
not new show/hide logic.

**Per-member localStorage namespacing** — all per-member paycalc keys are prefixed with a member
segment (`myb_pc_<slug>_…`) so two staff sharing a browser cannot read each other's pay data.
`pcPrefix()` in `paycalc-migrations.js` is the single source of the prefix; `SK` and every key builder
derive from it. `setPaycalcNamespace()` is invoked once from `runMigrations` (before `loadSettings`) to
activate the member's namespace. Pre-existing shared/legacy data is **not** silently claimed —
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

- **On any checkout but the owner's the payslip regression SKIPS, loudly and by name** —
  `paycalc.test.mjs` says which assertions did not run, because a loop over an absent fixture would
  otherwise register nothing and report a smaller green number that reads exactly like a passing one.
- **ABSENT is a skip; BROKEN is a failure.** Presence is read off the FILESYSTEM rather than inferred
  from an error code (`ERR_MODULE_NOT_FOUND` is also what a missing import INSIDE the fixture raises),
  the import runs with no catch, and a fixture that imports but exports nothing usable fails too — so
  a malformed fixture can never downgrade the comparison to a silent skip on the one machine holding
  the data.
- **`test-fixtures/payslip-actuals.example.js` documents the shape and is never imported**: a green
  run against invented figures would report the regression as PASSING while proving only that the
  calculator agrees with itself.
- **When changing pay maths (tax, NI, thresholds, variable pay), run `npm run test:payslip-local`** —
  it requires the fixture and FAILS if it is missing, so a pay-maths release has one command whose
  green means the real comparison actually ran. Use `paycalc-hpp.test.mjs` for `_varPayForPeriod`
  regressions.
- **Be precise about what that green MEANS: all thirteen payslips are 2025/26, a year that has
  ended.** A change to the **2026/27** personal allowance once left the whole estate green. The
  current year is locked by **`paycalc-current-year.test.mjs`**, built on the FREEZE rather than on a
  tautology: 2025/26 is payslip-verified and the Westminster freeze runs to Apr 2031, so the
  equalities it asserts carry real-payslip evidence into the current year. The two genuinely uprated
  sets (Scottish Starter/Basic, the five SL3 thresholds) are literals with their source named — a
  change-detector, not a truth-oracle, and its header says so.
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
| Rest Day Worked | `RDW 1.25` | 1.25× |
| Rest Day Worked — Sunday | `RDW Sun 1.5` | 1.5× |
| Boxing Day | `Bank Holiday Overtime 3.0` | 3.0× |
| Holiday Pay Premium (annual January lump) | `Holiday Pay Premium` | 7.69% (4/52) of variable pay |
| Peer training | shows as **extra basic pay** (no distinct line) | basic |

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
payslip the two totals were copied from (`ytdSrcKey(ty)`, a "From which payslip?" select auto-stamped
to the latest PAID payslip on first entry, correctable).
- **Payslips are issued before payday**, so from the current payslip's cut-off the picker also offers
  it (`ytdSourceOffered`): a member copying from it picks it, and an anchor one payslip early would
  count its pay twice. The first-entry stamp keeps the standing rule (`ytdAutoSource`); do not replace
  it with a window that records NOTHING until the member picks — a member who never picked would be
  stamped one payslip LATE on the first open after payday.
- **The cumulative PAYE method in `calculate()` engages ONLY on the payslip immediately after the
  source** (`p.num === src + 1`); any other payslip nulls the Year to Date inputs and falls back to the
  standard non-cumulative method. **That guard is one line and its regression is silent on screen**,
  because `_updateYtdNote` derives the chip and the note from the same rule independently — without it
  the header says "not in use" over a figure that is using them. `e2e/paycalc.spec.js` → "Year to Date
  figures sharpen ONLY the payslip after their source" asserts the two together, probing the figures by
  their EFFECT (clear the boxes; the £ must move on source + 1 and must not move anywhere else).
- Legacy figures with no recorded source are stamped on load with the app's old standing assumption
  (the payslip before today's, clamped into the year), so a maintained member's next-payslip estimate
  is unchanged — outside the cut-off-to-payday window above, where nothing is guessed.
- **`#ytdUptoNote`** states the position per payslip ("✓ … sharpen this payslip's estimate" / "uses
  the standard method — update from P__") and is EMPTY (hidden via `:empty`) while no source is
  recorded, because the header hint, field labels and select label already carry the copy-and-pick
  instruction. The source select's placeholder is the short "— choose a payslip —"; the two £ inputs
  carry example-figure placeholders ("e.g. 21,758.94"), never the zero-like "0.00".
- **The January-HPP pointer is PERIOD-GATED:** `#ytdJanHppHint` ("This is the January payslip your
  Holiday Pay Premium lands on — enter the confirmed figure…") is unhidden by `calculate()` ONLY while
  the viewed payslip is the January one that carries HPP (the same `_hppTy` match that gates the HPP
  take-home add); the year-round version is in the card's `?` help.
- `buildYtdSourceSelect(ty)` (paycalc-periods.js) offers the year's paid payslips, newest first (plus,
  from its cut-off, the one about to be paid).
- **Header status chip:** `#ytdStatusChip` in the card header shows the in-use state even while the
  card is collapsed — green "✓ in use" when the figures sharpen the viewed payslip, neutral "not in
  use" otherwise, hidden when there is nothing to report (no figures, no source, or the year's first
  payslip). Written by `_updateYtdNote` alongside the note, so every path that refreshes one refreshes
  both.

**The take-home asks for the latest figures, because they change on every payslip (owner, 7 Nov
2026).** A one-off notice cannot keep a monthly figure current, so `#netYtdNudge` under the take-home
£ says *"For a closer tax figure, copy the Year to Date figures from your ⟨date⟩ payslip. Add them"*
wherever copying them would change the estimate on screen. The rule is `ytdUpdateFrom`
(paycalc-periods.js); `renderYtdLine` writes it on every `calculate()` run, and `wireYtdLine`'s button
opens the card at `#ytdPay`. It is quiet:
- on a payslip already paid — the year keeps ONE pair of figures, so asking for an older payslip's
  would undo the estimate the member is waiting on;
- on the tax year's first payslip, where Year to Date starts again;
- for a W1/M1/X or NT code, which the figures cannot change — read exactly as `computeTax` reads the
  code, and cross-checked against `computeTax` over twenty codes in `paycalc-periods.test.mjs`;
- while the figures are in use (`inUse` is `computeTax`'s `usingCumulative`, so one figure, or an
  unreadable one, is not in use) or come from this payslip or a later one;
- until the payslip to copy from can be in hand (`payslipMayBeInHand`, from its cut-off);
- beside a confirmed payslip on the developer's device, which is no estimate.

The card's hint asks for the tax code to be checked against the same payslip, for the reason in the
"Check against your payslip" paragraph below: with the wrong code the figures make the estimate worse.

**"This tax year so far":** `#ytdYearSoFar` (a standalone `.pc-side` child) sums the year's ENTERED
payslips — `computeYearSoFar(ty, opts)` in **`paycalc-year-summary.js`** re-runs the same engine
headlessly per paid payslip with saved hours (decode → `computeGross` with period-aware
rate/London/pension → non-cumulative `computeTax`/`computeNI`/`computeSL`, honouring the per-period
`slSkip` and the stopped-deductions cutover) → taxable/tax/NI/SL/take-home totals + a projection
(net ÷ entered × the year's payslip count, deliberately labelled rough). Rendered by `renderYearCard`
in `paycalc-year-card.js` after every `calculate()`; hidden until a payslip has hours; corrupt periods
surface a "may be too low" warning (no silent caps). Unit-tested by `paycalc-year-summary.test.mjs`
(assertions mirror each payslip through the REAL calc engine).

**Provenance chips:** `#provChips` on the result hero names what fed THIS number —
`✓ Cumulative tax · from your ⟨payday⟩ payslip` (neutral), `+ £X back pay` / `+ £X Holiday Pay
Premium` (gold — money ADDED to the total), `📅 Hours from calendar` (any `.roster-suggested` field
present). Built by the pure `buildProvChips` (`paycalc-breakdown.js`, tested); written by `calculate()`
on every recompute; EMPTY (`:empty` hides the row) on a normal payslip — chips appear only when
noteworthy. The back-pay/HPP *banners* remain the opt-in OFFER surfaces; a chip is the compact receipt
once a figure is IN.

**"Check against your payslip":** the result card's foot carries a £ input (`#actualNetInput`) where
the member types the take-home printed on the real payslip.
- **It appears from the payslip's CUT-OFF**, not its payday — `payslipMayBeInHand` in
  `paycalc-periods.js`, the same rule the Year to Date picker uses, because a payslip arrives before it
  pays and that is when a member compares it.
- The pure `buildActualCheck(actual, estimated, used)` in `paycalc-breakdown.js` (tested) renders a
  calm verdict — exact match / within £2 ("the expected rounding from payroll's cumulative tax
  method") / ≤£25 close / larger. NEVER red — a mismatch is information, not an error.
- **A gap names THIS estimate's own settings first:** the close band the tax code, then the Year to
  Date card; the large band the tax code AND the pension, then hours, absence, back pay and
  corrections. `used` is what the estimate APPLIED — `computeTax`'s reported `code` and the pension
  deducted — so the line states facts about its inputs and guesses nothing about the payslip. **The tax
  code goes before the Year to Date advice deliberately:** with a wrong code, Year to Date figures make
  the NEXT estimate worse, not better, because the cumulative method applies the wrong allowance to the
  whole year at once (measured on a real payslip: £23.20 out without them, £207.60 with them).
- **A code the engine does not recognise is never quoted as applied:** "OT" typed for a payslip's 0T,
  or "1182" with no letter, is priced on the default allowance, so `computeTax` reports
  `recognised: false` and the line says the code is not recognised (with a zero-not-O hint) instead of
  "this estimate uses tax code OT".
- **Where Year to Date figures are in use, a large gap also names the payslip they count from**
  (`used.ytdFrom`, passed only when the cumulative method ran): between cut-off and payday the
  first-entry stamp is the latest PAID payslip while the member may be copying from the next, which
  counts that payslip's pay twice.
- The figure persists in the period blob (`actualNet`, null-when-blank like pension) and is
  deliberately EXCLUDED from `isDataEmpty`, so a period holding only this figure never counts as
  "entered" for HPP or the year so far.
