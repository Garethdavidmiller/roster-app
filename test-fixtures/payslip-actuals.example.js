// @ts-check
/**
 * test-fixtures/payslip-actuals.example.js — THE SHAPE OF THE PAY-MATHS REGRESSION FIXTURE.
 *
 * ── THIS FILE IS NEVER LOADED BY A TEST, AND THAT IS THE POINT ──────────────────────────────────
 *
 * The figures below are INVENTED. They are here so a reader can see what the real fixture looks
 * like, and so `paycalc.test.mjs`'s skip message points at something concrete. Nothing imports it.
 *
 * Wiring it up as a fallback would be the worst of both worlds: the suite would go green, the run
 * would report the payslip regression as passing, and what it would actually have proved is that
 * the calculator agrees with numbers this repo made up. A skipped test says "not verified here".
 * A passing test against invented data says "verified" and is wrong. Leave it unimported.
 *
 * ── WHY THE REAL ONE IS NOT IN THE TREE (v23.70, owner decision) ────────────────────────────────
 *
 * The real file is thirteen of a named colleague's actual payslips — Taxable Pay, tax, National
 * Insurance, Student Loan, take-home. `firebase.json` has excluded `test-fixtures/**` since v14.68,
 * but that governs ONE of the app's two origins: the GitHub Pages mirror publishes the repository
 * root with no ignore list, so the file was live there (measured — HTTP 200 on the mirror against a
 * 404 on Firebase Hosting). An ignore list cannot express a decision for an origin that does not
 * read it. A gitignore can, because it keeps the bytes out of the repository both origins serve.
 *
 * History is deliberately NOT rewritten (owner decision, same day): the figures remain in commits
 * up to v23.70, and in `roster-data.js` before v14.68. Removing them from the tree stops the live
 * serving from the next deploy; scrubbing history would rewrite every SHA on `main`, break existing
 * clones and stale every commit link in these documents, and would not recall what GitHub has
 * already served. Recorded in KNOWN_LIMITATIONS.md rather than quietly accepted.
 *
 * ── WHAT THE REAL FIXTURE BUYS, AND WHY IT IS NOT SYNTHESISED ───────────────────────────────────
 *
 * These are HMRC-processed payslips, and that is the whole of their value: the suite asserts our
 * tax, NI and Student Loan match figures a payroll system actually produced. Invented numbers prove
 * only that the calculator agrees with itself. That is why the answer here was to move the file
 * rather than to fabricate a replacement — the verification is real, and it now runs where the data
 * legitimately lives instead of everywhere.
 *
 * ── TO RESTORE IT ──────────────────────────────────────────────────────────────────────────────
 *
 * Copy this file to `test-fixtures/payslip-actuals.local.js` and replace every row with figures
 * read off real payslips. `*.local.js` is gitignored, so it cannot be committed by accident.
 * `paycalc.test.mjs` picks it up on the next run and the payslip block stops skipping.
 *
 * Keyed by payday, ISO. `gross` is the payslip's **"Taxable Pay"** line — post-pension, not gross
 * pay; the names come from `.claude/rules/paycalc.md` → payslip line names, and matching them
 * exactly is the point. `varPay` is the period's premium (non-basic, non-London) pay, which is what
 * the Holiday Pay Premium accrues on.
 */

/** INVENTED. Not imported anywhere. See the header before changing that. */
export const PAYSLIP_ACTUALS_EXAMPLE = {
    '2025-04-11': { gross: 4000.00, tax: 700.00, ni: 230.00, sl: 190.00, net: 2880.00, varPay: 1500.00 },
    '2025-05-09': { gross: 4100.00, tax: 720.00, ni: 232.00, sl: 195.00, net: 2953.00, varPay: 1600.00 },
    // …one row per payday in the tax year.
};
