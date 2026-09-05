// @ts-check
/**
 * test-fixtures/miller-actuals.js — G. Miller's real 2025/26 payslip figures.
 *
 * MOVED HERE from roster-data.js at v14.68 (ARCHITECTURE_PLAN.md → "MILLER_ACTUALS",
 * Option A). In a no-build app every served JS file is publicly fetchable, so keeping
 * real payslip figures in a production module was a (small) privacy exposure. This
 * directory is excluded from Firebase Hosting (see firebase.json `ignore` →
 * `test-fixtures/**`).
 *
 * **IT IS STILL SERVED, AND THIS NOTE USED TO SAY OTHERWISE** (corrected v22.81, external
 * review). "The data is no longer served to anyone" was true of ONE of the app's two origins.
 * The GitHub Pages mirror publishes the repository root, so this file is live there — measured,
 * HTTP 200, against a 404 on Firebase Hosting. `firebase.json`'s ignore list governs one origin
 * and cannot express a decision for the other, which is the same asymmetry the `<meta>` CSP
 * exists for. The exposure is a recorded owner decision (CLAUDE.md and ARCHITECTURE_PLAN.md both
 * state it correctly); what was wrong was this file telling its next reader the question was
 * already closed.
 *
 * WHY IT IS NOT SIMPLY SYNTHESISED. These are real HMRC-processed payslips, and that is the
 * whole of their value: the suite asserts our tax/NI/SL match figures a payroll system actually
 * produced. Invented numbers would only prove the calculator agrees with itself. Removing the
 * exposure therefore costs a real verification property rather than being free — the trade is
 * ARCHITECTURE_PLAN.md's to record, not this file's to pre-empt.
 *
 * Sole consumer is `paycalc.test.mjs`, which asserts the calculator's computed tax/NI
 * stays within payslip tolerance of these actuals (the pay-maths regression net). The
 * former in-app "Actual Take-Home" comparison feature (gated to G. Miller) was removed
 * in the same change — the test suite already validates the maths against these figures.
 *
 * gross = post-pension taxable pay (matches the "Taxable Pay" line on the payslip).
 * Keyed by ISO payday date.
 */
export const MILLER_ACTUALS = {
    '2025-04-11': { gross: 4260.01, tax:  736.80, ni: 239.90, sl: 202.00, net: 3081.35, varPay: 1612.73 },
    '2025-05-09': { gross: 4382.88, tax:  786.00, ni: 242.32, sl: 214.00, net: 3140.56, varPay: 1735.59 },
    '2025-06-06': { gross: 4340.23, tax:  769.34, ni: 241.46, sl: 210.00, net: 3119.71, varPay: 1692.94 },
    '2025-07-04': { gross: 4883.78, tax:  986.40, ni: 252.33, sl: 259.12, net: 3386.05, varPay: 2236.49 },
    '2025-08-01': { gross: 4441.60, tax:  809.71, ni: 243.49, sl: 219.00, net: 3169.51, varPay: 1789.82 },
    '2025-08-29': { gross: 5145.55, tax: 1090.80, ni: 257.57, sl: 282.00, net: 3515.18, varPay: 2492.25 },
    '2025-09-26': { gross: 4810.43, tax:  957.20, ni: 250.87, sl:   0,    net: 3602.36, varPay: 2157.13 },
    '2025-10-24': { gross: 5477.49, tax: 1224.00, ni: 264.21, sl:   0,    net: 3989.28, varPay: 2137.60 },
    '2025-11-21': { gross: 4756.74, tax:  935.60, ni: 249.79, sl:   0,    net: 3571.35, varPay: 2007.92 },
    '2025-12-19': { gross: 5245.44, tax: 1131.20, ni: 259.71, sl:   0,    net: 3854.67, varPay: 2496.61 },
    '2026-01-16': { gross: 5048.39, tax: 1052.40, ni: 255.63, sl:   0,    net: 3740.36, varPay: 2195.89 },
    '2026-02-13': { gross: 5188.84, tax: 1108.40, ni: 258.44, sl:   0,    net: 3822.00, varPay: 2440.02 },
    '2026-03-13': { gross: 4572.71, tax:  862.00, ni: 246.11, sl:   0,    net: 3464.60, varPay: 1823.89 },
};
