// @ts-check
// @lane hygiene
/**
 * pay-audience.test.mjs — who the Pay Calculator is for, by the role AT THE TIME (pay-audience.js).
 * Run: node scripts/run-tests.mjs test/pay-audience.test.mjs   (part of `npm run test:hygiene`)
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
import { payCalculatorPrices, heldPricedGrade, pricedGradeOn, sentPayReminder } from '../pay-audience.js';
import { buildRosterMembers } from '../scripts/generate-roster-members.mjs';
import { teamMembers } from '../roster-data.js';
import { PAGE_POLICIES, requirePageAuth } from '../auth-policy.js';

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

// THE PAGE POLICY DECIDES (review, 24 Nov 2026). An Other Staff login is refused the Pay page by its
// policy (auth-policy.js, rule 1b), but a row moved there from a priced grade keeps that grade in
// `roleHistory` — and was priced, while its drawer hid Pay and the policy said refuse.
const MOVED_TO_OTHER_STAFF = { name: 'Test Moved Colleague', role: 'Other Staff', otherStaff: true, hidden: true,
    roleHistory: [{ role: 'CEA', until: new Date(2026, 9, 1) }] };

describe('the page policy and the pay audience give one answer', () => {
    test('an Other Staff row with an earlier priced grade is not priced, over any span', () => {
        assert.equal(payCalculatorPrices(MOVED_TO_OTHER_STAFF, { periods: PAGE, today: new Date(2026, 8, 1) }), false,
            'not even while the CEA grade is today\'s');
        assert.equal(payCalculatorPrices(MOVED_TO_OTHER_STAFF, { periods: PAGE, today: new Date(2026, 10, 16) }), false);
        assert.equal(heldPricedGrade(MOVED_TO_OTHER_STAFF, P_BEFORE.start, P_ACROSS.cutoff), false,
            'premise held the other way: its CEA days are before the span');
        assert.equal(heldPricedGrade(MOVED_TO_OTHER_STAFF, new Date(2026, 8, 1), P_ACROSS.cutoff), true,
            'premise: the row does hold a priced grade on some days');
    });
    test('over the roster and invented rows: whoever is priced, the page policy admits', () => {
        const span = [{ start: new Date(2025, 2, 9), cutoff: new Date(2027, 2, 6) }];
        for (const m of [...teamMembers, MOVED_TO_OTHER_STAFF, PROMOTED_MANAGER, PROMOTED_FROM_DISPATCH]) {
            if (!payCalculatorPrices(m, { periods: span, today: new Date(2026, 10, 16) })) continue;
            const d = requirePageAuth({ status: 'named', member: m.name }, PAGE_POLICIES.paycalc, { otherStaff: m.otherStaff === true });
            assert.notEqual(d.decision, 'forbidden', m.name);
        }
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

// ── WHO IS SENT THE PAY REMINDER — ONE RULE, THE SERVER'S (owner, 26 Nov 2026) ─────────────────────────
// The Calendar's strip and the Settings card both promise the reminder through `sentPayReminder`; the server
// sends it to the names on its `cea` and `ces` lists, which scripts/generate-roster-members.mjs writes from
// the same table. Held equal for every row on the roster, both ways, reported by row and shape — never by name.
describe('sentPayReminder is the server\'s own list', () => {
    const server = buildRosterMembers();
    const sentTo = new Set([...server.cea, ...server.ces]);
    test('premise: the server sends it to somebody, and not to everybody', () => {
        assert.ok(sentTo.size > 0);
        assert.ok(sentTo.size < teamMembers.length);
    });
    test('every row on the roster is promised it exactly where the generator\'s lists send it', () => {
        const wrong = teamMembers.map((m, i) => [m, i]).filter(([m]) => sentPayReminder(m) !== sentTo.has(/** @type {any} */ (m).name))
            .map(([m, i]) => `row ${i} (${/** @type {any} */ (m).role}${/** @type {any} */ (m).hidden ? ', hidden' : ''}${/** @type {any} */ (m).managerOnly ? ', login only' : ''})`);
        assert.deepEqual(wrong, [], 'the app and the server disagree about who is sent the pay reminder');
    });
    test('nobody, a hidden leaver, a login-only row and a grade without rates are never promised it', () => {
        assert.equal(sentPayReminder(null), false);
        assert.equal(sentPayReminder({ name: 'Test Leaver', role: 'CEA', hidden: true }), false);
        assert.equal(sentPayReminder({ name: 'Test Login', role: 'CES', managerOnly: true }), false);
        assert.equal(sentPayReminder(DISPATCHER), false);
        assert.equal(sentPayReminder(PROMOTED_MANAGER), false, 'the RECORDED role, as the server reads it — not the grade held today');
        assert.equal(sentPayReminder({ name: 'Test CEA', role: 'CEA' }), true);
    });
});
