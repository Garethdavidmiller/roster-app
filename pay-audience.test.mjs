// @ts-check
/**
 * pay-audience.test.mjs — who the Pay Calculator is for, by the role AT THE TIME (pay-audience.js).
 * Run: node scripts/run-tests.mjs pay-audience.test.mjs   (part of `npm run test:hygiene`)
 *
 * @nodeps-safe — runs on a bare checkout with nothing installed.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 * TURNING AWAY A MEMBER THE PAGE CAN PRICE. A CES promoted into management keeps every CES payslip,
 * the premium and back pay they earned, and the January Holiday Pay Premium built on them; asking
 * the grade NOW refused all of it the day the promotion was released.
 *
 * ADMITTING A MEMBER IT CANNOT PRICE AT ALL — a Dispatcher, a manager who never held a priced grade.
 * Each payslip is refused on its own once admitted, but a page of refusals is the refusal card done
 * badly.
 *
 * SENDING A MEMBER TO A PAGE THAT REFUSES THEM. The Calendar asks the same function over TODAY; the
 * page over its payslips AND today. The one-way agreement is swept over the roster and every day of
 * two tax years.
 *
 * The people here are INVENTED. The roster is read only for the sweep, which names nobody.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { payCalculatorPrices, heldPricedGrade, pricedGradeOn } from './pay-audience.js';
import { teamMembers } from './roster-data.js';

/** Two 28-day payslips either side of a Sat 21 Nov 2026 promotion, as the page's grid draws them. */
const P_BEFORE = { start: new Date(2026, 9, 18), cutoff: new Date(2026, 10, 14) };   // paid 20 Nov
const P_ACROSS = { start: new Date(2026, 10, 15), cutoff: new Date(2026, 11, 12) };  // paid 18 Dec
const PAGE = [P_BEFORE, P_ACROSS];

const PROMOTED_MANAGER = { name: 'Test Promoted Manager', role: 'Management',
    roleHistory: [{ role: 'CES', until: new Date(2026, 10, 21) }] };
const ALWAYS_MANAGER   = { name: 'Test Manager', role: 'Management' };
const DISPATCHER       = { name: 'Test Dispatcher', role: 'Dispatcher' };
const PROMOTED_FROM_DISPATCH = { name: 'Test Promoted Dispatcher', role: 'CEA',
    roleHistory: [{ role: 'Dispatcher', until: new Date(2026, 10, 21) }] };

describe('turning away a member the page can price', () => {
    test('a CES promoted into management is admitted — after the promotion as well as before it', () => {
        for (const today of [new Date(2026, 10, 16), new Date(2026, 10, 22), new Date(2027, 1, 1)]) {
            assert.equal(payCalculatorPrices(PROMOTED_MANAGER, { periods: PAGE, today }), true, today.toDateString());
        }
    });
    test('a member promoted INTO a priced grade is admitted on the first day of it', () => {
        assert.equal(payCalculatorPrices(PROMOTED_FROM_DISPATCH, { periods: [P_BEFORE], today: new Date(2026, 10, 22) }), true);
    });
    test('a CEA or a CES with no history is admitted with no payslips at all — today is enough', () => {
        assert.equal(payCalculatorPrices({ name: 'Test CEA', role: 'CEA' }), true);
        assert.equal(payCalculatorPrices({ name: 'Test CES', role: 'CES' }), true);
    });
    test('heldPricedGrade finds a single priced day at either end of the span', () => {
        assert.equal(heldPricedGrade(PROMOTED_MANAGER, new Date(2026, 10, 21), new Date(2026, 11, 31)), true, 'its last CES day');
        assert.equal(heldPricedGrade(PROMOTED_FROM_DISPATCH, new Date(2026, 9, 1), new Date(2026, 10, 22)), true, 'its first CEA day');
    });
});

describe('admitting a member it cannot price at all', () => {
    test('a Dispatcher and a manager who never held a priced grade are refused, whatever the span', () => {
        for (const m of [DISPATCHER, ALWAYS_MANAGER]) {
            assert.equal(payCalculatorPrices(m, { periods: PAGE, today: new Date(2026, 10, 16) }), false, m.name);
        }
    });
    test('a promoted manager is refused once every payslip on the page is after the promotion', () => {
        assert.equal(payCalculatorPrices(PROMOTED_MANAGER, { periods: [P_ACROSS].map(p => ({ ...p, start: new Date(2026, 10, 22) })), today: new Date(2027, 0, 5) }), false);
    });
    test('a day before a startDate is nobody\'s grade — but a noProRate return was employed throughout', () => {
        const joiner = { name: 'Test Joiner', role: 'Management', startDate: new Date(2026, 10, 25),
            roleHistory: [{ role: 'CES', until: new Date(2026, 10, 21) }] };
        assert.equal(heldPricedGrade(joiner, P_BEFORE.start, P_ACROSS.cutoff), false, 'every CES day predates the start');
        assert.equal(heldPricedGrade({ ...joiner, noProRate: true }, P_BEFORE.start, P_ACROSS.cutoff), true);
    });
    test('a name the roster does not hold is never priced', () => {
        assert.equal(payCalculatorPrices(null, { periods: PAGE }), false);
        assert.equal(pricedGradeOn(null, new Date()), false);
        assert.equal(heldPricedGrade(null, P_BEFORE.start, P_BEFORE.cutoff), false);
    });
});

describe('sending a member to a page that refuses them', () => {
    test('the Calendar asks TODAY only: a promoted manager is invited until the promotion and not after', () => {
        assert.equal(payCalculatorPrices(PROMOTED_MANAGER, { today: new Date(2026, 10, 21) }), true);
        assert.equal(payCalculatorPrices(PROMOTED_MANAGER, { today: new Date(2026, 10, 22) }), false);
    });
    test('over the roster and every day of two tax years: whoever the Calendar invites, the page admits', () => {
        let invited = 0;
        for (const m of [...teamMembers, PROMOTED_MANAGER, ALWAYS_MANAGER, DISPATCHER, PROMOTED_FROM_DISPATCH]) {
            for (let d = new Date(2025, 3, 1); d <= new Date(2027, 3, 1); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) {
                if (!payCalculatorPrices(m, { today: d })) continue;
                invited++;
                // The page's span is any set of payslips; with none at all it still asks today.
                assert.equal(payCalculatorPrices(m, { periods: [], today: d }), true, `${m.name} on ${d.toDateString()}`);
                assert.equal(payCalculatorPrices(m, { periods: PAGE, today: d }), true, `${m.name} on ${d.toDateString()}`);
            }
        }
        assert.ok(invited > 1000, `premise: the sweep invited somebody (${invited})`);
    });
});
