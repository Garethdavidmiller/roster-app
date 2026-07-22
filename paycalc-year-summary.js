// @ts-check
/**
 * paycalc-year-summary.js — "This tax year so far" for the Year to Date Figures card
 * (v18.41 — review item 11).
 *
 * Owns: computeYearSoFar — a headless re-run of the calculator over every PAID payslip of a tax
 *   year that has saved hours, summing taxable pay / tax / NI / Student Loan / take-home, plus a
 *   deliberately-rough full-year projection. The coordinator (paycalc-app.js) renders the result
 *   into the Year to Date card (#ytdYearSoFar).
 * Does NOT own: any DOM (the caller passes the current loan/tax-code settings in `opts`), the
 *   per-period maths (all from paycalc-calc.js — the same functions calculate() uses, so the
 *   per-payslip figures here match what the calculator shows for that payslip), or persistence.
 * Edit here for: what the year-so-far summary counts and how it projects.
 * Do not edit here for: pay maths (paycalc-calc.js), the YTD source anchor (paycalc-app.js).
 *
 * Estimates are NON-CUMULATIVE per period (like the calculator's standard method), so the summed
 * tax can drift ~£1/period from payroll's cumulative figure — fine for a "so far" overview that
 * is labelled rough. Skipped (corrupt) periods are counted and surfaced by the caller, never
 * silently dropped (no-silent-caps).
 */

import {
  computeGross, computeTax, computeNI, computeSL, getThresholds,
  getRateForPeriod, getLondonAllowanceForPeriod,
} from './paycalc-calc.js';
import { getPeriods } from './paycalc-periods.js';
import {
  getGrade, getEffectiveContr, getProRateFactor, getStoredRateForYear, getPensionDefault,
} from './paycalc-settings.js';
import { readSavedPeriod } from './paycalc-migrations.js';
import { _decodeHours, isDataEmpty } from './paycalc-hpp.js';

/**
 * Sum the year's entered payslips into a so-far + projected view.
 *
 * @param {any} ty  Tax year object from CONFIG.TAX_YEARS.
 * @param {{ taxCode: string, plan: string, pgLoan: boolean, slPaidOffFromP?: number, now?: Date }} opts
 *   The member's CURRENT loan/tax-code settings (read from the DOM by the caller — this module
 *   touches no DOM). `slPaidOffFromP` is the loan-repaid cutover (p.num of the first payslip
 *   without a deduction, 0/absent = still repaying — item 9). `now` is injectable for tests.
 * @returns {{ entered: number, paid: number, total: number, taxable: number, tax: number,
 *             ni: number, sl: number, net: number, projectedNet: number, skipped: number,
 *             missing: Date[] }}
 *   entered — paid payslips with saved hours; paid — payslips whose payday has passed;
 *   total — the year's payslip count (the projection base); money fields — sums over `entered`;
 *   projectedNet — (net ÷ entered) × total, 0 when nothing is entered; skipped — corrupt periods;
 *   missing — paydays of PAID payslips with no saved hours (named on the card — item 2).
 */
export function computeYearSoFar(ty, opts) {
  const now         = opts.now || new Date();
  const grade       = getGrade();
  const settledRate = getStoredRateForYear(ty);
  const T           = getThresholds(ty.label);

  const yearPeriods = getPeriods().filter(/** @param {any} p */ p => {
    const o = p.num - 48;
    return o >= ty.first && o <= ty.last;
  });
  const paidPeriods = yearPeriods.filter(/** @param {any} p */ p => p.payday <= now);

  let entered = 0, taxable = 0, tax = 0, ni = 0, sl = 0, net = 0, skipped = 0;
  const missing = /** @type {Date[]} */ ([]);

  for (const p of paidPeriods) {
    try {
      const parsed = readSavedPeriod(p.num);
      if (parsed.error) { skipped++; console.warn('[PayCalc] Year-so-far corrupt period', p.num); continue; }
      if (!parsed.data || isDataEmpty(parsed.data)) { missing.push(p.payday); continue; }   // not entered — not an error
      const d = parsed.data;
      const h = _decodeHours(p, d);

      const proRate = getProRateFactor(p);
      // Same per-period engine as calculate(): period-aware rate (mid-year award step), pro-rated
      // London, the payslip's own saved pension (else the period default, pro-rated on a joining
      // period). _decodeHours names → computeGross names (ot→o, rdw→r, sun→s, box→b).
      const g = computeGross({
        rate:     getRateForPeriod(p, grade, ty.label, settledRate),
        effContr: getEffectiveContr(p),
        satHrs: h.satHrs, bhHrs: h.bhHrs, bhOtHrs: h.bhOtHrs,
        oHrs: h.otHrs, rHrs: h.rdwHrs, sHrs: h.sunHrs, bHrs: h.boxHrs,
        peerDays: d.peer || 0,
        london:   getLondonAllowanceForPeriod(p, ty) * proRate,
        otherAdj: parseFloat(String(d.otherAdj ?? 0)) || 0,
      });
      const pension  = d.pension != null ? (parseFloat(String(d.pension)) || 0) : getPensionDefault(p) * proRate;
      const sacGross = g.gross - pension;

      const pTax = computeTax(sacGross, opts.taxCode, T).tax;   // non-cumulative — see header note
      const pNi  = computeNI(sacGross, T.ni);
      // Loan legs mirror calculate(): the repaid cutover zeroes both from its payslip onward;
      // the period's own saved "not deducted" skip applies otherwise.
      const paidOff = !!(opts.slPaidOffFromP && p.num >= opts.slPaidOffFromP);
      const pSl = paidOff ? 0
        : computeSL(sacGross, opts.plan, T.sl, !!d.slSkip)
        + (opts.pgLoan ? computeSL(sacGross, 'postgrad', T.sl, !!d.slSkip) : 0);

      entered++;
      taxable += sacGross;
      tax     += pTax;
      ni      += pNi;
      sl      += pSl;
      net     += sacGross - pTax - pNi - pSl;
    } catch (e) {
      skipped++;
      console.warn('[PayCalc] Year-so-far skipped period', p.num, e);
    }
  }

  return {
    entered, paid: paidPeriods.length, total: yearPeriods.length,
    taxable, tax, ni, sl, net,
    projectedNet: entered > 0 ? (net / entered) * yearPeriods.length : 0,
    skipped, missing,
  };
}
