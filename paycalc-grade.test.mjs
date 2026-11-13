// Tests for paycalc-grade.js — which grade each of a payslip's days was worked under.
// Run: node scripts/run-tests.mjs paycalc-grade.test.mjs
//
// Organised by the ways a wrong answer here costs a member money, not by function:
//
//   RE-PRICING THE PAST is the defect this module exists to end. The calculator held ONE grade, so a
//   promotion re-priced every payslip a member had ever had at the new grade's rates — and a
//   payslip that spanned the change was right for neither side.
//
//   MOVING A FIGURE THAT WAS RIGHT is what a careless fix produces: a member who never changed
//   grade must be priced exactly as before, to the last binary digit, and a grade somebody chose
//   by hand must not be silently replaced by the roster's.
//
// These are the pure rules, on hand-built payslips whose dates are the real ones (the wiring suite,
// paycalc-grade-wiring.test.mjs, checks them against the real period table and drives the same
// three payslips through the settings module that prices them).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    FROM_ROSTER, gradeDays, byDays, settingFromLegacy, windowGrade, gradeSplitLine,
    rosterStretches, rosterGradeLine, gradeChangeNote,
} from './paycalc-grade.js';
import { AWARD_RATES, GRADES } from './paycalc-calc.js';
import { teamMembers, gradeForRole } from './roster-data.js';

/** A payslip as getPeriods() builds it: 28 days, start to cutoff, paid six days after. */
const period = (/** @type {number} */ num, /** @type {Date} */ start) => ({
    num, start,
    cutoff: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 27),
    payday: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 33),
});
// The three payslips around the promotion dated Sun 22 Nov 2026 (paid 20 Nov, 18 Dec, 15 Jan).
const BEFORE = period(58, new Date(2026, 9, 18));    // 18 Oct – 14 Nov 2026
const ACROSS = period(59, new Date(2026, 10, 15));   // 15 Nov – 12 Dec 2026
const AFTER  = period(60, new Date(2026, 11, 13));   // 13 Dec 2026 – 9 Jan 2027

const ROSTER = { grade: FROM_ROSTER, from: 0 };
/** A synthetic row promoted on the same day as the real one, so a rule is tested apart from the data. */
const promotedRow = { name: 'Test Promoted', role: 'CES', roleHistory: [{ role: 'CEA', until: new Date(2026, 10, 21) }] };
const steadyRow   = { name: 'Test Steady', role: 'CEA' };
/** The 2026/27 settled rates, read off the award table rather than typed. */
const rate2627 = (/** @type {string} */ g) => /** @type {any} */ (AWARD_RATES)[g]['2026/27'].rate;

describe('re-pricing the past — a promotion prices each payslip at the grade held on its days', () => {
    test('the payslip before the change is all CEA, the one across it is split by days, the one after is all CES', () => {
        assert.deepEqual(gradeDays(promotedRow, BEFORE, ROSTER), [{ grade: 'cea', days: 28 }]);
        assert.deepEqual(gradeDays(promotedRow, ACROSS, ROSTER), [{ grade: 'cea', days: 7 }, { grade: 'ces', days: 21 }]);
        assert.deepEqual(gradeDays(promotedRow, AFTER,  ROSTER), [{ grade: 'ces', days: 28 }]);
    });

    test('the payslip across the change is the two rates weighted by their days, unrounded', () => {
        const parts = gradeDays(promotedRow, ACROSS, ROSTER);
        const blend = /** @type {number} */ (byDays(parts, rate2627));
        assert.ok(Math.abs(blend - (7 * rate2627('cea') + 21 * rate2627('ces')) / 28) < 1e-12);
        // Today's figures, written out: what a reader checks against the real payslip.
        assert.equal(blend.toFixed(4), '22.3225');
        // For the contracted hours that is EXACTLY each day at its own grade: 35h at £21.49 and 105h
        // at £22.60. Priced at the field's 2-decimal rounding (£22.32) it would be 45p short.
        const contracted = Math.round(blend * GRADES.ces.contr * 100) / 100;
        assert.equal(contracted, Math.round((35 * rate2627('cea') + 105 * rate2627('ces')) * 100) / 100);
        assert.equal(contracted, 3125.15);
        assert.notEqual(Math.round(Number(blend.toFixed(2)) * 140 * 100) / 100, contracted,
            'premise: the 2-decimal rate does NOT give the same pay — which is why calculate() must not read the field');
    });

    test('THE REAL ROW: the roster promotes it on Sun 22 Nov 2026, and the three payslips price as above', () => {
        const row = teamMembers.find(m => m.name === 'K. Jedlinski');
        assert.ok(row, 'the promoted row is on the roster');
        assert.deepEqual(gradeDays(row, BEFORE, ROSTER), [{ grade: 'cea', days: 28 }]);
        assert.deepEqual(gradeDays(row, ACROSS, ROSTER), [{ grade: 'cea', days: 7 }, { grade: 'ces', days: 21 }]);
        assert.deepEqual(gradeDays(row, AFTER,  ROSTER), [{ grade: 'ces', days: 28 }]);
    });

    test('a day under a role with no rates is never priced as something else', () => {
        // The real manager row: a CES until Sat 21 Nov 2026, then a role this calculator has no
        // rates for. The page refuses that member before anything is priced; here, the payslip
        // across the change has no figure at all rather than a guessed one.
        const row = teamMembers.find(m => m.name === 'W. Cummings');
        assert.ok(row, 'the row is on the roster');
        const parts = gradeDays(row, ACROSS, ROSTER);
        assert.deepEqual(parts, [{ grade: 'ces', days: 7 }, { grade: null, days: 21 }]);
        assert.equal(byDays(parts, rate2627), null);
        assert.equal(gradeSplitLine({ parts, rateOf: rate2627, start: ACROSS.start, today: new Date(2026, 10, 13) }), '');
    });
});

describe('moving a figure that was right — one grade is priced exactly as before', () => {
    test('a member who never changed grade has one grade on every payslip, for every row on the roster', () => {
        let checked = 0;
        for (const m of teamMembers.filter(x => !x.roleHistory?.length && gradeForRole(x.role))) {
            for (let n = 0; n < 40; n++) {
                const p = period(40 + n, new Date(2025, 2, 16 + 28 * n));
                assert.deepEqual(gradeDays(m, p, ROSTER), [{ grade: gradeForRole(m.role), days: 28 }], `${m.name}, payslip ${p.num}`);
                checked++;
            }
        }
        assert.ok(checked > 400, `premise: the sweep reached the roster (${checked} payslips)`);
    });

    test('byDays hands back the shared figure ITSELF, not a recomputation of it', () => {
        // 0.45 is a figure binary arithmetic cannot carry exactly: weighting it by days and dividing
        // again does not come back to it. A member who never changed grade must not move by that much.
        const v = 0.45;
        assert.notEqual((7 * v + 21 * v) / 28, v, 'premise: recomputing moves the figure');
        assert.equal(byDays([{ grade: 'cea', days: 7 }, { grade: 'ces', days: 21 }], () => v), v);
        assert.equal(byDays([{ grade: 'cea', days: 28 }], () => 21.49), 21.49);
    });

    test('byDays has no figure without days, and none when any day has none', () => {
        assert.equal(byDays([], () => 1), null);
        assert.equal(byDays([{ grade: 'cea', days: 0 }], () => 1), null);
        assert.equal(byDays([{ grade: 'cea', days: 7 }, { grade: 'ces', days: 21 }], g => (g === 'ces' ? null : 1)), null);
        assert.equal(byDays([{ grade: 'cea', days: 28 }], () => NaN), null);
    });
});

describe('a grade chosen by hand covers whole payslips, from the one it names', () => {
    const chosen = { grade: 'ces', from: 59 };
    test('payslips from its first are the chosen grade whole; earlier ones follow the roster', () => {
        assert.deepEqual(gradeDays(steadyRow, BEFORE, chosen), [{ grade: 'cea', days: 28 }], 'before it: the roster');
        assert.deepEqual(gradeDays(steadyRow, ACROSS, chosen), [{ grade: 'ces', days: 28 }]);
        assert.deepEqual(gradeDays(steadyRow, AFTER,  chosen), [{ grade: 'ces', days: 28 }]);
        // Only the roster's own dates split a payslip; a chosen grade never does.
        assert.deepEqual(gradeDays(promotedRow, ACROSS, { grade: 'cea', from: 59 }), [{ grade: 'cea', days: 28 }]);
    });
    test('a grade saved before grades had dates (from 0) covers every payslip — exactly what it did', () => {
        assert.deepEqual(gradeDays(promotedRow, AFTER, { grade: 'cea', from: 0 }), [{ grade: 'cea', days: 28 }]);
    });
    test('it needs no member, and no dates on the payslip', () => {
        assert.deepEqual(gradeDays(null, ACROSS, chosen), [{ grade: 'ces', days: 28 }]);
        assert.deepEqual(gradeDays(null, { payday: ACROSS.payday }, { grade: 'cea', from: 0 }), [{ grade: 'cea', days: 28 }]);
    });
    test('a value that is not a grade is the roster\'s to decide, and the roster needs a member and dates', () => {
        assert.deepEqual(gradeDays(steadyRow, BEFORE, { grade: 'dispatcher', from: 0 }), [{ grade: 'cea', days: 28 }]);
        assert.deepEqual(gradeDays(null, BEFORE, ROSTER), []);
        assert.deepEqual(gradeDays(steadyRow, { payday: BEFORE.payday }, ROSTER), []);
        assert.deepEqual(gradeDays(steadyRow, null, ROSTER), []);
    });
});

describe('settingFromLegacy — a grade saved before grades had dates', () => {
    test('a grade the roster gives the member hands over to the roster — the promoted member\'s case', () => {
        assert.deepEqual(settingFromLegacy({ saved: 'cea', kept: null, rosterGrades: ['cea', 'ces'], firstNum: 37 }), { grade: FROM_ROSTER, from: 0 });
        assert.deepEqual(settingFromLegacy({ saved: 'cea', kept: null, rosterGrades: ['cea'], firstNum: 37 }), { grade: FROM_ROSTER, from: 0 });
    });
    test('a grade the member KEPT over the roster\'s stays theirs, from the first payslip they can see', () => {
        assert.deepEqual(settingFromLegacy({ saved: 'cea', kept: 'ces', rosterGrades: ['cea', 'ces'], firstNum: 37 }), { grade: 'cea', from: 37 });
    });
    test('a grade the roster never gives them stays, covering every payslip they can see', () => {
        assert.deepEqual(settingFromLegacy({ saved: 'ces', kept: null, rosterGrades: ['cea'], firstNum: 50 }), { grade: 'ces', from: 50 });
    });
    test('nothing saved, or nothing usable, is the roster\'s', () => {
        for (const saved of [null, undefined, '', 'roster', 'manager']) {
            assert.deepEqual(settingFromLegacy({ saved, kept: null, rosterGrades: ['cea'], firstNum: 37 }), { grade: FROM_ROSTER, from: 0 }, String(saved));
        }
    });
});

describe('windowGrade — the back-pay card prices one grade', () => {
    test('one grade across the window is that grade', () => {
        assert.deepEqual(windowGrade([{ grade: 'cea', days: 28 }, { grade: 'cea', days: 28 }]), { grade: 'cea', mixed: false });
    });
    test('a window across a change is priced at the grade held at its end, and says so', () => {
        assert.deepEqual(windowGrade([{ grade: 'cea', days: 7 }, { grade: 'ces', days: 21 }]), { grade: 'ces', mixed: true });
    });
    test('no priced days is no grade', () => {
        assert.deepEqual(windowGrade([]), { grade: null, mixed: false });
        assert.deepEqual(windowGrade([{ grade: null, days: 28 }]), { grade: null, mixed: false });
    });
});

describe('the line the changeover payslip carries under its rate', () => {
    const parts = [{ grade: 'cea', days: 7 }, { grade: 'ces', days: 21 }];
    const line = (/** @type {Date} */ today) => gradeSplitLine({ parts, rateOf: rate2627, start: ACROSS.start, today });
    test('before the day: "changes"', () => {
        assert.equal(line(new Date(2026, 10, 13)),
            'Your grade changes on Sun 22 Nov 2026, part-way through this payslip: 7 days at the CEA rate (£21.49/hr) '
            + 'and 21 at the CES rate (£22.60/hr), so its hours are priced at £22.32/hr — the two rates weighted by their days.');
    });
    test('on the day and after it: "changed"', () => {
        assert.match(line(new Date(2026, 10, 22)), /^Your grade changed on Sun 22 Nov 2026, part-way/);
        assert.match(line(new Date(2027, 0, 5)), /^Your grade changed on Sun 22 Nov 2026, part-way/);
    });
    test('a payslip on one grade carries no line', () => {
        assert.equal(gradeSplitLine({ parts: [{ grade: 'ces', days: 28 }], rateOf: rate2627, start: AFTER.start, today: new Date() }), '');
    });
    test('two changes in one payslip name no date, because one date would be wrong', () => {
        const three = [{ grade: 'cea', days: 7 }, { grade: 'ces', days: 14 }, { grade: 'cea', days: 7 }];
        const text = gradeSplitLine({ parts: three, rateOf: rate2627, start: ACROSS.start, today: new Date(2026, 10, 13) });
        assert.match(text, /^Your grade changed more than once during this payslip: 7 days at the CEA rate \(£21\.49\/hr\), 14 at the CES rate \(£22\.60\/hr\) and 7 at the CEA rate/);
        assert.match(text, /— the rates weighted by their days\.$/);
    });
});

describe('what the roster says, in words — the line under the Grade box', () => {
    const YEAR = [new Date(2026, 3, 1), new Date(2027, 2, 31)];
    test('a promotion is two stretches, each with its first and last day', () => {
        const s = rosterStretches(promotedRow, YEAR[0], YEAR[1]);
        assert.deepEqual(s.map(x => [x.role, x.grade, x.from.toDateString(), x.until.toDateString()]), [
            ['CEA', 'cea', new Date(2026, 3, 1).toDateString(), new Date(2026, 10, 21).toDateString()],
            ['CES', 'ces', new Date(2026, 10, 22).toDateString(), new Date(2027, 2, 31).toDateString()],
        ]);
        assert.equal(rosterGradeLine(s), 'The roster lists you as CEA until 21 Nov 2026, then CES from 22 Nov 2026.');
    });
    test('no change in the span is one grade, without dates', () => {
        assert.equal(rosterGradeLine(rosterStretches(steadyRow, YEAR[0], YEAR[1])), 'The roster lists you as CEA.');
    });
    test('nobody, or no span, is nothing to say', () => {
        assert.deepEqual(rosterStretches(null, YEAR[0], YEAR[1]), []);
        assert.equal(rosterGradeLine([]), '');
    });
});

describe('the one-time note — a change of grade on the roster needs nothing doing', () => {
    const stretches = rosterStretches(promotedRow, new Date(2025, 2, 16), new Date(2027, 2, 31));
    test('before the day it says the grade changes, with the day; after it, that it changed', () => {
        assert.deepEqual(gradeChangeNote(stretches, new Date(2026, 10, 13)), {
            key: '2026-11-22',
            text: 'Your grade on the roster changes from CEA to CES on Sun 22 Nov 2026. Each payslip is priced at the '
                + 'grade you held while you worked it, so there is nothing for you to change.',
        });
        assert.match(/** @type {any} */ (gradeChangeNote(stretches, new Date(2026, 10, 23))).text, /^Your grade on the roster changed from CEA to CES/);
    });
    test('no change, nothing to say', () => {
        assert.equal(gradeChangeNote(rosterStretches(steadyRow, new Date(2025, 2, 16), new Date(2027, 2, 31)), new Date()), null);
    });
    test('a move to a role this calculator does not price is not announced here — the page refuses that member', () => {
        const toManager = { role: 'Management', roleHistory: [{ role: 'CES', until: new Date(2026, 10, 21) }] };
        assert.equal(gradeChangeNote(rosterStretches(toManager, new Date(2026, 3, 1), new Date(2027, 2, 31)), new Date()), null);
    });
    test('with two changes in view, the LATER one is announced, under its own key', () => {
        const twice = { role: 'CEA', roleHistory: [{ role: 'CEA', until: new Date(2026, 5, 6) }, { role: 'CES', until: new Date(2026, 10, 21) }] };
        const note = gradeChangeNote(rosterStretches(twice, new Date(2026, 3, 1), new Date(2027, 2, 31)), new Date(2026, 11, 1));
        assert.equal(note?.key, '2026-11-22');
        assert.match(String(note?.text), /changed from CES to CEA on Sun 22 Nov 2026/);
    });
});

describe('THE DATA — a grade the roster dates is one this calculator can price', () => {
    test('a member the page prices held only grades it prices: no day of theirs is ever guessed', () => {
        // A day under a role with no rates has no figure (byDays), so the payslip it falls in would
        // have none either. The page refuses a member whose CURRENT role has no rates; this keeps
        // the earlier ones honest too. A CEA who was a Dispatcher, say, needs a decision about how
        // those days are priced before the row records it.
        for (const m of teamMembers.filter(x => gradeForRole(x.role) && x.roleHistory?.length)) {
            for (const held of m.roleHistory) {
                assert.ok(gradeForRole(held.role), `${m.name} was a ${held.role} until ${held.until.toDateString()} — this calculator has no rates for it`);
            }
        }
    });
});
