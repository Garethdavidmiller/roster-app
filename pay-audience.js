// @ts-check
/**
 * pay-audience.js — WHO the Pay Calculator is for: the one answer to "would it price this member?"
 *
 * THE ROLE AT THE TIME (owner decision, 16 Nov 2026). The calculator prices each payslip at the grade
 * held on its days (`roleHistory`, roster-roles.js), so whether a member is its audience is a question
 * about DATES, not about `role` — the grade NOW. A CES promoted into management on 22 Nov keeps their
 * CES payslips, the premiums and back pay those payslips earned, and the January Holiday Pay Premium
 * built on them; asking `gradeForRole(member.role)` turned them away from all of it the day the
 * promotion was released. Each PAYSLIP is still refused when a day of it falls under a role with no
 * confirmed rates (paycalc-grade.js → `gradeDays`, `payslipPriced`): admitting the member guesses
 * nothing.
 *
 * ONE FUNCTION, TWO SPANS, AND WHY THEY DIFFER. `payCalculatorPrices(member, { periods, today })`:
 *   - the Pay page passes the payslips it can show — the member is admitted when any EMPLOYED day of
 *     them, or today, falls under a grade with rates;
 *   - the Calendar's notices pass nothing, so only TODAY counts: they invite a member to work on the
 *     payslip being earned, and a member whose priced payslips are all behind them is not who they
 *     are for.
 * Today is in both, so a member the Calendar sends to the page is one the page admits — the
 * direction paycalc.md invariant 13 cares about ("nothing sends such a member to the page"). The
 * page may admit somebody the Calendar does not invite; it never refuses somebody it sent.
 * `pay-audience.test.mjs` sweeps the roster and invented members for that one-way agreement.
 *
 * Its own module because the Calendar must ask this without loading the Pay Calculator's module graph
 * (the reason `gradeForRole` lives in roster-data.js). Pure: no DOM, no storage. It asks the page
 * policy (auth-policy.js), which every roster page loads already.
 */

import { gradeForRole, isOtherStaff } from './roster-data.js';
import { roleOn, rolesInRange } from './roster-roles.js';
import { PAGE_POLICIES, requirePageAuth } from './auth-policy.js';

/**
 * True when the member's grade on `date` is one the Pay Calculator has confirmed rates for.
 * @param {any} member  teamMembers entry, or null
 * @param {Date} date
 * @returns {boolean}
 */
export function pricedGradeOn(member, date) {
    return !!member && !!gradeForRole(roleOn(member, date));
}

/**
 * True when the member held a grade with confirmed rates on ANY day from `start` to `end`, both
 * inclusive — counting only days they were employed: a day before a `startDate` is nobody's grade
 * (a `noProRate` secondment return was employed throughout, so theirs all count).
 * @param {any} member  teamMembers entry, or null
 * @param {Date} start @param {Date} end
 * @returns {boolean}
 */
export function heldPricedGrade(member, start, end) {
    if (!member || !(start instanceof Date) || !(end instanceof Date)) return false;
    const joined = member.startDate instanceof Date && !member.noProRate ? member.startDate : null;
    const from = joined && joined > start ? joined : start;
    return rolesInRange(member, from, end).some(r => !!gradeForRole(r.role));
}

/**
 * Would the Pay Calculator price this member? Yes when they hold a priced grade TODAY, or held one on
 * any day of the payslips passed in (`{ start, cutoff }` each — the page's visible payslips). A name
 * the roster does not hold (null) is never priced.
 *
 * THE PAGE POLICY DECIDES FIRST (24 Nov 2026). An "Other Staff" login is refused the Pay page by
 * `PAGE_POLICIES.paycalc` (auth-policy.js, rule 1b) and has no Pay pill — but a row moved to Other
 * Staff from a priced grade keeps that grade in `roleHistory`, which priced its old payslips while the
 * policy said refuse. So the policy is asked here, with the row's own flag, and wins: the page, the
 * Calendar's notices and Settings' Pay card then give one answer.
 * @param {any} member  teamMembers entry, or null
 * @param {{ periods?: Array<{ start: Date, cutoff: Date }>, today?: Date }} [o]
 * @returns {boolean}
 */
export function payCalculatorPrices(member, { periods = [], today = new Date() } = {}) {
    if (!member) return false;
    if (requirePageAuth({ status: 'named', member: member.name }, PAGE_POLICIES.paycalc,
        { otherStaff: isOtherStaff(member) }).decision === 'forbidden') return false;
    if (pricedGradeOn(member, today)) return true;
    if (!periods.length) return false;
    return heldPricedGrade(member, periods[0].start, periods[periods.length - 1].cutoff);
}
