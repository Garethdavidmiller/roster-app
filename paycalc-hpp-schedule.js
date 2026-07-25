// @ts-check
/**
 * paycalc-hpp-schedule.js — WHICH payslip carries WHICH tax year's Holiday Pay Premium (v18.85).
 *
 * Owns: the payslip ↔ tax-year relation for HPP, and nothing else. Pure — no DOM, no storage, no
 *   imports at all: the caller passes the period grid and the tax-year table in, so this is
 *   unit-testable in plain Node with no mocks.
 * Does NOT own: the HPP AMOUNT (paycalc-hpp.js estimates it, resolveHppForPeriod picks
 *   actual-vs-estimate), the opt-in tick, or any rendering.
 *
 * WHY THIS EXISTS. The rule is easy to state and easy to get subtly wrong:
 *
 *   A tax year's Holiday Pay Premium is paid on the FIRST JANUARY PAYSLIP OF THE FOLLOWING TAX
 *   YEAR — `ty.hppPaidJan` is a January that falls OUTSIDE `ty`'s own period window.
 *
 * That last clause is the trap. Before v18.85 the relation was hand-rolled as raw date comparisons
 * in four places, in two different directions, and one of them was wrong for the whole life of the
 * feature: `computeYearSoFar` searched for `hppPaidJan` among the tax year's OWN paydays, which can
 * never match, so an opted-in premium was silently dropped from "This tax year so far" while the
 * result card added it (fixed v18.84). Two independent derivations of one rule is what let those
 * surfaces disagree, so the rule now lives here once and the callers ask it questions.
 *
 * The two directions are inverses, and `paycalc-hpp-schedule.test.mjs` asserts they agree against
 * the REAL tax-year table — the check that would have caught the v18.84 bug before it shipped.
 */

/**
 * The periods belonging to a tax year's own window (its 13 payslips).
 * @param {{ first: number, last: number }} ty  Tax year from CONFIG.TAX_YEARS.
 * @param {Array<{ num: number, payday: Date }>} periods  The full grid (getPeriods()).
 * @returns {Array<{ num: number, payday: Date }>} in payday order.
 */
export function periodsInTaxYear(ty, periods) {
    if (!ty || !Array.isArray(periods)) return [];
    return periods.filter(p => {
        const o = p.num - 48;
        return o >= ty.first && o <= ty.last;
    });
}

/**
 * The payslip that CARRIES a tax year's premium — the first January payday of `ty.hppPaidJan`.
 * Searched across the WHOLE grid, not `ty`'s own window: that January belongs to the NEXT tax year.
 *
 * Returns null when the grid doesn't reach that far (e.g. asking 2026/27 for its January 2028
 * payslip before the grid is extended at the April rollover) — callers treat that as "not yet".
 *
 * @param {{ hppPaidJan?: number }} ty
 * @param {Array<{ num: number, payday: Date }>} periods
 * @returns {{ num: number, payday: Date }|null}
 */
export function hppPayslipForTaxYear(ty, periods) {
    if (!ty || !ty.hppPaidJan || !Array.isArray(periods)) return null;
    // `.find` gives the FIRST match in grid order, so a (currently impossible) January holding two
    // paydays still resolves to one payslip — the premium can never be added twice.
    return periods.find(p => p.payday.getFullYear() === ty.hppPaidJan && p.payday.getMonth() === 0) || null;
}

/**
 * The tax year whose premium lands on `p` — the inverse of hppPayslipForTaxYear.
 * Null for any payslip that isn't an HPP-carrying January one (i.e. almost every payslip).
 *
 * @param {{ num: number, payday: Date }|null|undefined} p  The payslip being viewed.
 * @param {Array<{ num: number, payday: Date }>} periods
 * @param {Array<{ hppPaidJan?: number }>} taxYears  CONFIG.TAX_YEARS.
 * @returns {any|null} the tax year object, or null.
 */
export function hppTaxYearForPayslip(p, periods, taxYears) {
    if (!p || !p.payday || !Array.isArray(taxYears)) return null;
    if (p.payday.getMonth() !== 0) return null;                 // only a January payslip carries HPP
    const year = p.payday.getFullYear();
    const ty = taxYears.find(t => t.hppPaidJan === year);
    if (!ty) return null;
    // Guard the two-Januaries-in-one-window case: only the EARLIEST January payslip carries it.
    const carrier = hppPayslipForTaxYear(ty, periods);
    return (!carrier || carrier.num === p.num) ? ty : null;
}

/**
 * The tax year whose premium is paid INSIDE `ty`'s own window — i.e. whose lump lands on one of
 * `ty`'s 13 payslips. That is the PRIOR tax year, never `ty` itself (whose premium is paid a year
 * later), which is exactly the inversion "This tax year so far" got wrong before v18.84.
 *
 * @param {{ first: number, last: number }} ty  The tax year being summarised.
 * @param {Array<{ num: number, payday: Date }>} periods
 * @param {Array<{ hppPaidJan?: number }>} taxYears
 * @returns {{ taxYear: any, payslip: { num: number, payday: Date } }|null}
 *   The premium's OWN tax year plus the payslip inside `ty` that carries it; null if `ty`'s window
 *   holds no January payslip, or no tax year claims that January.
 */
export function hppPaidInTaxYear(ty, periods, taxYears) {
    const jan = periodsInTaxYear(ty, periods).find(p => p.payday.getMonth() === 0);
    if (!jan) return null;
    const taxYear = hppTaxYearForPayslip(jan, periods, taxYears);
    return taxYear ? { taxYear, payslip: jan } : null;
}
