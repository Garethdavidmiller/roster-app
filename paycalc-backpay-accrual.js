// @ts-check
/**
 * paycalc-backpay-accrual.js — what a pay award owes, period by period. PURE: no DOM, no storage.
 *
 * Owns: the award arithmetic — `_accrueBackPayPeriod` (one period's arrears), `awardWindowFactor`
 *   (the April fraction of the first period), `_awardBackdateDate` (1 April), `paidInPeriodNum`
 *   (the payslip a decided award lands on) — and `awardLumpNonPremium`, the share of that lump that
 *   is basic and London Allowance rather than premium pay.
 * Does NOT own: the back-pay CARD (paycalc-backpay.js, which re-exports all of this), or which
 *   figure sits in which box (paycalc-backpay-state.js).
 *
 * WHY IT IS A MODULE OF ITS OWN (moved from paycalc-backpay.js, Nov 2026). The Holiday Pay
 * Premium's rough Year to Date estimate has to take the lump's non-premium share OUT of a member's
 * Taxable Pay (owner, 10 Nov 2026), and it must reuse this arithmetic rather than keep a second copy
 * of it. paycalc-backpay.js already imports paycalc-hpp.js, so the premium module could not import
 * the card without a cycle. The arithmetic never needed the card; this is the seam.
 */

import { RATE_125, RATE_150, RATE_300, capHours } from './paycalc-calc.js';
import { CONFIG as PERIOD_CONFIG } from './paycalc-periods.js';
import { allRatesOnRecord } from './paycalc-backpay-state.js';

// ── PAID-IN PERIOD (pure) ─────────────────────────────────────────────────────

/**
 * The paid-in payslip period for a DECIDED award: the number of the FIRST period whose payday is
 * on/after the award-application date — the payslip that actually carries the backdated lump. PURE
 * (DOM callers pass `getPeriods()` + `awardFromForYear(label)`), so it is unit-testable. Extracted
 * v18.13 after an award-date MOVE (the 3.6% award, 31 Jul → 28 Aug) left a stale saved paid-in
 * pinning the lump to the old payslip — this locks the derivation so a future date move is caught by
 * a test, not by a member noticing the "green box" on the wrong payslip. Returns null for an
 * undecided award (no date) or when no period qualifies.
 * @param {Array<{num:number, payday:Date}>} periods  - ascending by payday, as getPeriods() returns
 * @param {Date|null|undefined} awardFrom
 * @returns {number|null}
 */
export function paidInPeriodNum(periods, awardFrom) {
  if (!awardFrom) return null;
  const p = periods.find(/** @param {any} x */ x => x.payday >= awardFrom);
  return p ? p.num : null;
}

// ── THE AWARD WINDOW ──────────────────────────────────────────────────────────

/**
 * 1 April of an award tax year — the date Chiltern backdates a pay award TO.
 *
 * Noon, deliberately: every period date in this app is noon (inherited from `ANCHOR_DATE`),
 * so a noon-to-noon subtraction is a whole number of days regardless of British Summer Time. A
 * midnight date here would make the day count off by a fraction across the March DST change, which
 * is exactly the period this is used on.
 *
 * @param {{label: string}} awardTy a TAX_YEARS entry — '2026/27' → 1 Apr 2026
 * @returns {Date|null}
 */
export function _awardBackdateDate(awardTy) {
  const year = parseInt(String(awardTy?.label || '').slice(0, 4), 10);
  return Number.isFinite(year) ? new Date(year, 3, 1, 12, 0, 0) : null;
}

/**
 * How much of a period's SHIFT WINDOW falls on or after the award's backdate — 0…1 (v21.79).
 *
 * ── WHY THIS EXISTS: THE APP WAS 19% HIGH ───────────────────────────────────────────────────────
 *
 * A period is 28 days of SHIFTS paid six days after its cut-off, so the first period of a tax year
 * covers work done largely in MARCH. The award is backdated to 1 April, and the accrual used to
 * include that whole period — charging the rise against three weeks of work the award does not
 * cover.
 *
 * Measured against the real 28 Aug 2026 payslip (VAL-PAY-001, settled): the app estimated £977.69
 * where payroll paid £821.68. The first period in the window (paid 10 Apr 2026, shifts 8 Mar –
 * 4 Apr) is only 4 days in scope, and the app counted all 28.
 *
 * ── THE EVIDENCE THAT THIS IS THE RIGHT SHAPE ───────────────────────────────────────────────────
 *
 * The London Allowance settles it exactly. Its uplift is a flat £9.94 a period with no hours in it,
 * so it isolates the WINDOW from everything else: 4/28 + 4 whole periods × £9.94 = £41.18, and the
 * arrears inside that payslip's London line are £41.18 to the penny. The basic component agrees to
 * within £2.30 (0.5%) and the premiums to within a few pounds — close enough for a figure the card
 * calls "roughly", and the residual is payroll's own daily rounding, not a different rule.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────────
 *
 * It scales the period's WHOLE accrual, premiums included, even though payroll paid the premiums of
 * the part-week ending 4 April in full. Splitting premiums by week is impossible here: hours are
 * stored per PERIOD, not per week, so there is nothing finer to apportion. The approximation costs
 * a few pounds on one period a year and is stated as an estimate; inventing a weekly split from
 * period totals would look more precise and be less true.
 *
 * It also MULTIPLIES with a joiner's pro-rate rather than taking the longer of the two. Both are
 * suffixes of the same period — employment starts mid-period and runs to the end, and so does the
 * award window — so the exact answer is the shorter suffix, not the product, and the product
 * under-counts. It is left as a product because reaching `min` from here means unpicking the
 * pro-rate already baked into `effContr`, and no member can currently hit it: the earliest start
 * date on the roster is 20 Apr 2026, well clear of the one period a year where the two overlap.
 * Fix it properly if a March joiner ever appears, and not before.
 *
 * @param {{start?: Date, cutoff?: Date}} p a period from getPeriods()
 * @param {Date|null} backdatedFrom
 * @param {number} [periodDays]
 * @returns {number} 0 (wholly before the award) … 1 (wholly inside it)
 */
export function awardWindowFactor(p, backdatedFrom, periodDays = PERIOD_CONFIG.PERIOD_DAYS) {
  // No backdate in hand → change nothing. Failing towards the OLD behaviour keeps a missing or
  // malformed tax-year label from silently zeroing somebody's whole lump.
  if (!p?.start || !p?.cutoff || !backdatedFrom) return 1;
  if (p.start  >= backdatedFrom) return 1;   // the ordinary case: every period but the first
  if (p.cutoff <  backdatedFrom) return 0;   // wholly before the award — owes nothing
  const DAY  = 86400000;
  const days = Math.round((p.cutoff.getTime() - backdatedFrom.getTime()) / DAY) + 1;  // inclusive
  return Math.max(0, Math.min(1, days / periodDays));
}

// ── ONE PERIOD'S ARREARS ──────────────────────────────────────────────────────

/**
 * PURE per-period back-pay arithmetic — no DOM, no storage. Extracted from calcBackPay so the
 * money maths is unit-testable (paycalc-periods.test.mjs); calcBackPay maps DOM/storage to these
 * numbers and renders. Mirrors calculate()'s hour capping: Saturday hours cap at contracted,
 * bank-holiday hours cap at the remaining normal hours.
 *
 * PRECONDITION: rateDiff/londonDiff are ≥ 0 (calcBackPay zeroes an invalid pair before calling).
 *
 * backPay = contracted basic diff + premium-bucket diffs + peer diff + pro-rated London diff.
 * varPay  = the HPP-accruing portion — premium buckets only (contracted basic, peer pay and the
 *           London diff are excluded, mirroring _varPayForPeriod).
 *
 * @param {{ effContr: number, proRateFactor: number, peer?: number, rateDiff: number, londonDiff: number,
 *           windowFactor?: number,
 *           hours: { satHrs?: number, bhHrs?: number, bhOtHrs?: number, otHrs?: number,
 *                    rdwHrs?: number, sunHrs?: number, boxHrs?: number } }} i
 * @returns {{ backPay: number, varPay: number }}
 */
export function _accrueBackPayPeriod(i) {
  const { satHrs = 0, bhHrs = 0, bhOtHrs = 0, otHrs = 0, rdwHrs = 0, sunHrs = 0, boxHrs = 0 } = i.hours || {};
  const { satCapped, bhCapped } = capHours({ effContr: i.effContr, satHrs, bhHrs });
  const premium =
    satCapped * i.rateDiff * (RATE_125 - 1) +
    bhCapped  * i.rateDiff * (RATE_125 - 1) +
    bhOtHrs   * i.rateDiff * RATE_125       +
    otHrs     * i.rateDiff * RATE_125       +
    rdwHrs    * i.rateDiff * RATE_125       +
    sunHrs    * i.rateDiff * RATE_150       +
    boxHrs    * i.rateDiff * RATE_300;
  const londonPart = i.londonDiff * i.proRateFactor;
  // The AWARD WINDOW scales the whole period (v21.79) — see awardWindowFactor. Defaults to 1, so a
  // caller that does not pass it behaves exactly as before.
  const w = i.windowFactor == null ? 1 : i.windowFactor;
  return {
    // backPay = the whole lump (basic + premium + peer + London arrears are all owed).
    // varPay = the HPP-ACCRUING portion only — premiums, NOT London (London doesn't accrue HPP;
    // see paycalc-hpp.js _varPayForPeriod). Currently unused (v16.89 stopped feeding it into HPP),
    // but kept correct so a future re-wire can't reintroduce the London-in-HPP bug.
    backPay: (i.effContr * i.rateDiff + premium + (i.peer || 0) * 2 * i.rateDiff + londonPart) * w,
    varPay:  premium * w,
  };
}

// ── THE LUMP'S NON-PREMIUM SHARE ──────────────────────────────────────────────

/**
 * The share of a decided award's back-pay lump that is NOT premium pay: the basic arrears on
 * contracted hours and peer-training days, and the London Allowance arrears, each scaled by the
 * award window — every rate from the RECORD, never from the card's boxes (owner, 10 Nov 2026).
 *
 * The rough Year to Date estimate of the Holiday Pay Premium takes 7.69% of whatever premium pay is
 * inside a Taxable Pay figure, and once the payslip carrying the lump is covered, the lump is inside
 * it too. Its premium arrears are premium pay and stay in; this is what comes out. It is the card's
 * own accrual with no hours in it — the premium terms are exactly the ones that need hours — summed
 * from penny-rounded rows as the card sums them, so for a member with no premium pay it equals the
 * card's lump to the penny.
 *
 * Returns null when any rate it needs is not on record (the CES 2025/26 award's old rate): a figure
 * not on record is never guessed (invariant 1), and the caller says the estimate may include it.
 *
 * @param {{ window: any[], auth: Record<string, number|null>, backdate: Date|null,
 *           effContr: (p: any) => number, proRateFactor: (p: any) => number, peerDays: (p: any) => number }} a
 *   `window` — the award's own payslips paid before it was applied; `auth` — resolveAuthoritativeRates.
 * @returns {number|null}
 */
export function awardLumpNonPremium({ window, auth, backdate, effContr, proRateFactor, peerDays }) {
  if (!allRatesOnRecord(auth)) return null;
  const rateDiff   = /** @type {number} */ (auth.newRateInput) - /** @type {number} */ (auth.oldRate);
  const londonDiff = /** @type {number} */ (auth.newLondon) - /** @type {number} */ (auth.oldLondon);
  if (!(rateDiff >= 0) || !(londonDiff >= 0)) return null;   // _accrueBackPayPeriod's precondition
  let sum = 0;
  for (const p of window) {
    const { backPay } = _accrueBackPayPeriod({
      effContr: effContr(p), proRateFactor: proRateFactor(p), peer: peerDays(p),
      rateDiff, londonDiff, windowFactor: awardWindowFactor(p, backdate), hours: {},
    });
    if (backPay > 0) sum += Math.round(backPay * 100) / 100;
  }
  return sum;
}
