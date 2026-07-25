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
  getRateForPeriod, getLondonAllowanceForPeriod, TAX_YEARS,
} from './paycalc-calc.js';
import { getPeriods } from './paycalc-periods.js';
import { periodsInTaxYear, hppPaidInTaxYear } from './paycalc-hpp-schedule.js';
import {
  getGrade, getEffectiveContr, getProRateFactor, getStoredRateForYear, getPensionDefault,
} from './paycalc-settings.js';
import { readSavedPeriod } from './paycalc-migrations.js';
import { _decodeHours, isDataEmpty } from './paycalc-hpp.js';

/**
 * Sum the year's entered payslips into a so-far + projected view.
 *
 * @param {any} ty  Tax year object from CONFIG.TAX_YEARS.
 * @param {{ taxCode: string, plan: string, pgLoan: boolean, slPaidOffFromP?: number, now?: Date,
 *   bpLump?: {pNum: number, amount: number}|null, hppLump?: {amount: number}|null }} opts
 *   The member's CURRENT loan/tax-code settings (read from the DOM by the caller — this module
 *   touches no DOM). `bpLump`/`hppLump` are the OPT-IN lumps the caller is adding to the result
 *   card's take-home (only passed when the include-tick is on): a back-pay lump on payslip
 *   `bpLump.pNum`, and the Holiday Pay Premium on the tax year's first January payslip. Each is
 *   GROSS and folded into that payslip's gross before pension/tax/NI/SL — exactly as calculate()
 *   does — so the two surfaces agree; the projection adds the one-off lumps ONCE (never
 *   extrapolated across the year). `slPaidOffFromP` is the loan-repaid cutover (p.num of the first payslip
 *   without a deduction, 0/absent = still repaying — item 9). `now` is injectable for tests.
 * @returns {{ entered: number, paid: number, total: number, taxable: number, tax: number,
 *             ni: number, sl: number, net: number, projectedNet: number, skipped: number,
 *             missing: Date[] }}
 *   entered — paid payslips with saved hours; paid — payslips whose payday has passed AND that the
 *   member was employed for (a mid-year joiner's pre-start periods are excluded — v18.84);
 *   total — the year's payslip count; money fields — sums over `entered`;
 *   projectedNet — (recurring net ÷ entered) × employed periods + lumps, 0 when nothing is entered;
 *   skipped — corrupt periods; missing — paydays of PAID payslips with no saved hours (item 2).
 */
export function computeYearSoFar(ty, opts) {
  const now         = opts.now || new Date();
  const grade       = getGrade();
  const settledRate = getStoredRateForYear(ty);
  const T           = getThresholds(ty.label);

  const allPeriods  = getPeriods();
  const yearPeriods = periodsInTaxYear(ty, allPeriods);
  // PAID and EMPLOYED. A period falling entirely before a mid-year joiner's start date contributes
  // £0 and was never theirs to fill in, so counting it in the denominator and NAMING it under "Not
  // entered yet" told a joiner to enter payslips from before they worked here — the same defect
  // v18.54 fixed for the HPP and back-pay cards, missed on this one (v18.84). getProRateFactor is 0
  // ONLY for a fully pre-start period (1 for long-servers and noProRate secondment returns), so this
  // is a no-op for everyone else; employedPeriods below already applied it, so the two now agree.
  const paidPeriods = yearPeriods.filter(/** @param {any} p */ p => p.payday <= now && getProRateFactor(p) > 0);
  // Periods the member is actually EMPLOYED for this tax year — the annual projection extrapolates
  // over these, not all 13. Same pre-start test as paidPeriods above: without it a joiner's
  // full-year take-home was over-projected by multiplying the per-payslip average by 13.
  const employedPeriods = yearPeriods.filter(/** @param {any} p */ p => getProRateFactor(p) > 0).length;

  // Which payslip inside this tax year carries an HPP lump. ASK paycalc-hpp-schedule.js — do not
  // re-derive it here (v18.91). v18.84 fixed this line in place by deleting a broken year test
  // (`p.payday.getFullYear() === ty.hppPaidJan` compared this year's paydays against a January
  // beyond its own last period, so it could never match and every opt-in lump was silently dropped),
  // and v18.85 then extracted the relation into a shared module "so the callers ask it questions"
  // — but migrated the three sites that were already RIGHT and left this one, the only one that had
  // ever been wrong, still hand-rolling. The bare `.find(month === 0)` it was left with validates
  // nothing: it would place a lump on a January payslip that no tax year claims. Only the caller's
  // guard kept that unreachable. hppPaidInTaxYear returns null in exactly that case.
  const hppJanNum = opts.hppLump
    ? (hppPaidInTaxYear(ty, allPeriods, TAX_YEARS)?.payslip.num ?? 0)
    : 0;

  let entered = 0, taxable = 0, tax = 0, ni = 0, sl = 0, net = 0, skipped = 0;
  // Recurring (hours-only) take-home drives the projection; the one-off lumps are added to it
  // ONCE below, never extrapolated across the year.
  let netRecurring = 0, lumpNet = 0;
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

      // Opt-in lumps the caller is adding to the result card's take-home for this same payslip —
      // fold into gross BEFORE pension/tax/NI/SL exactly as calculate() does (grossWithBp). At most
      // one bp payslip + one HPP (January) payslip per year.
      const lumpGross = ((opts.bpLump && opts.bpLump.pNum === p.num) ? opts.bpLump.amount : 0)
                      + ((hppJanNum && hppJanNum === p.num && opts.hppLump) ? opts.hppLump.amount : 0);

      /** Net take-home for a given gross-before-pension (mirrors calculate(): pension-sacrifice,
       *  then non-cumulative tax + NI + SL with the repaid cutover / per-period skip). */
      const netFor = (/** @type {number} */ grossBeforePension) => {
        const sacGross = Math.max(0, grossBeforePension - pension);
        const pTax = computeTax(sacGross, opts.taxCode, T).tax;   // non-cumulative — see header note
        const pNi  = computeNI(sacGross, T.ni);
        const paidOff = !!(opts.slPaidOffFromP && p.num >= opts.slPaidOffFromP);
        const pSl = paidOff ? 0
          : computeSL(sacGross, opts.plan, T.sl, !!d.slSkip)
          + (opts.pgLoan ? computeSL(sacGross, 'postgrad', T.sl, !!d.slSkip) : 0);
        return { sacGross, pTax, pNi, pSl, pNet: sacGross - pTax - pNi - pSl };
      };

      const base = netFor(g.gross);
      const full = lumpGross > 0 ? netFor(g.gross + lumpGross) : base;

      entered++;
      // The "so far" rows reflect the lump (faithful to the result card); the projection uses the
      // recurring hours-only net so a one-off lump can't inflate the extrapolated year.
      taxable += full.sacGross;
      tax     += full.pTax;
      ni      += full.pNi;
      sl      += full.pSl;
      net     += full.pNet;
      netRecurring += base.pNet;
      lumpNet      += full.pNet - base.pNet;
    } catch (e) {
      skipped++;
      console.warn('[PayCalc] Year-so-far skipped period', p.num, e);
    }
  }

  return {
    entered, paid: paidPeriods.length, total: yearPeriods.length,
    taxable, tax, ni, sl, net,
    // Recurring pay extrapolated over employed periods + the one-off lumps added ONCE.
    projectedNet: entered > 0 ? (netRecurring / entered) * employedPeriods + lumpNet : 0,
    skipped, missing,
  };
}
