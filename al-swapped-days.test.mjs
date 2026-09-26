// al-swapped-days.test.mjs — which days need the swap question, and what gets written.
//
// The rule this protects is the one the owner set on 14 Sep 2026: ASK ONLY WHEN A DAY IS AFFECTED,
// and when you ask, require an answer. The "only when affected" half is what this file can test —
// the "require an answer" half is a save-path property and lives in the e2e.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapDecisionDates, replacedTypeForSwap, rangeWriteDates } from './al-swapped-days.js';
import { teamMembers, getBaseShift, parseISODate } from './roster-data.js';
import { isRestShift } from './override-utils.js';

const MEMBER = teamMembers.find(m => m.name === 'C. Francisco-Charles');

// The dates are asserted to BE what the test needs before they are used, so a roster edit that
// moves her line fails loudly here instead of quietly emptying every case below.
const REST    = ['2026-04-04', '2026-04-27', '2026-07-23'];
const WORKING = ['2026-02-24', '2026-04-28', '2026-05-01'];

test('the premise: the fixture dates really are rest and working days on her line', () => {
    assert.ok(MEMBER, 'C. Francisco-Charles must be on the roster');
    for (const d of REST) {
        assert.ok(isRestShift(getBaseShift(MEMBER, parseISODate(d))), `${d} must be a REST day`);
    }
    for (const d of WORKING) {
        assert.ok(!isRestShift(getBaseShift(MEMBER, parseISODate(d))), `${d} must be a WORKING day`);
    }
});

test('only rest-day bases are asked about — working days never are', () => {
    assert.deepEqual(
        swapDecisionDates({ dates: [...WORKING, ...REST], memberObj: MEMBER, ovByDate: null }),
        [...REST].sort(),
    );
});

test('no rest days in the booking → no question at all (the owner\'s rule 1)', () => {
    assert.deepEqual(swapDecisionDates({ dates: WORKING, memberObj: MEMBER, ovByDate: null }), []);
});

test('a Sunday is never asked about — it cannot hold annual leave', () => {
    // 2026-04-05 and 2026-04-26 are Sundays.
    const out = swapDecisionDates({ dates: ['2026-04-05', '2026-04-26'], memberObj: MEMBER, ovByDate: null });
    assert.deepEqual(out, []);
});

test('a day already recorded as swapped is NOT asked again', () => {
    const ov = new Map([['2026-04-04', { type: 'annual_leave', replacedType: 'shift' }]]);
    const out = swapDecisionDates({ dates: REST, memberObj: MEMBER, ovByDate: ov });
    assert.ok(!out.includes('2026-04-04'), 'a settled day must not re-open the question');
    assert.deepEqual(out, ['2026-04-27', '2026-07-23']);
});

test('an absence already carrying a swap is NOT asked again (review A2)', () => {
    // swap → absence → leave: the absence doc holds `replacedType: 'shift'`, which the AL written
    // over it inherits. Asking again offered a "free" answer the write could not honour.
    const ov = new Map([['2026-04-04', { type: 'sick', value: 'SICK', replacedType: 'shift' }]]);
    assert.deepEqual(swapDecisionDates({ dates: ['2026-04-04'], memberObj: MEMBER, ovByDate: ov }), []);
    const plain = new Map([['2026-04-04', { type: 'sick', value: 'SICK' }]]);
    assert.deepEqual(swapDecisionDates({ dates: ['2026-04-04'], memberObj: MEMBER, ovByDate: plain }),
        ['2026-04-04'], 'an absence with no chain says nothing about the contract, so the question stands');
});

test('an RDW day is never asked about — declining overtime is not leave', () => {
    // The dangerous one: asking here invites an admin to charge somebody for giving back overtime.
    const ov = new Map([['2026-04-27', { type: 'rdw', value: '09:00-17:00' }]]);
    assert.deepEqual(swapDecisionDates({ dates: ['2026-04-27'], memberObj: MEMBER, ovByDate: ov }), []);
});

test('a day already carrying a shift override is not asked about — it already counts', () => {
    const ov = new Map([['2026-04-04', { type: 'shift', value: '06:20-13:35' }]]);
    assert.deepEqual(swapDecisionDates({ dates: ['2026-04-04'], memberObj: MEMBER, ovByDate: ov }), []);
});

test('no member, or no dates, asks nothing rather than throwing', () => {
    assert.deepEqual(swapDecisionDates({ dates: REST, memberObj: null, ovByDate: null }), []);
    assert.deepEqual(swapDecisionDates({ dates: [], memberObj: MEMBER, ovByDate: null }), []);
    assert.deepEqual(swapDecisionDates({ dates: /** @type {any} */ (null), memberObj: MEMBER }), []);
});

test('duplicates collapse and the order is ascending', () => {
    const out = swapDecisionDates({ dates: ['2026-07-23', '2026-04-04', '2026-04-04'], memberObj: MEMBER, ovByDate: null });
    assert.deepEqual(out, ['2026-04-04', '2026-07-23']);
});

test('a declared swap writes `shift` when there is nothing to carry forward', () => {
    assert.equal(replacedTypeForSwap(null, 'annual_leave'), 'shift');
    assert.equal(replacedTypeForSwap({ type: 'annual_leave', replacedType: null }, 'annual_leave'), 'shift');
});

test('a stronger existing record is kept, not flattened to `shift`', () => {
    // `spare_shift` and `other` are contracted work too, and a reconstruction must not lose which.
    assert.equal(replacedTypeForSwap({ type: 'spare_shift', value: 'SPARE' }, 'annual_leave'), 'spare_shift');
    assert.equal(replacedTypeForSwap({ type: 'other', value: 'TRG' }, 'annual_leave'), 'other');
});

test('every value it can write is one the Firestore rules accept', () => {
    // The rules validate `replacedType` against a fixed vocabulary; a value outside it is refused at
    // write time, which would surface as a permission error on somebody's leave booking.
    const ALLOWED = new Set(['spare_shift', 'shift', 'rdw', 'annual_leave', 'correction', 'sick', 'other', 'allocated', 'overtime', 'swap']);
    for (const existing of [null, { type: 'shift' }, { type: 'spare_shift' }, { type: 'other' }, { type: 'rdw' }, { type: 'sick' }, { type: 'correction' }, { type: 'annual_leave', replacedType: 'shift' }]) {
        assert.ok(ALLOWED.has(replacedTypeForSwap(existing, 'annual_leave')),
            `replacedTypeForSwap(${JSON.stringify(existing)}) produced a value the rules would refuse`);
    }
});

test('a range writes an ASKED rest day only when answered swapped — even one holding an absence (review A2)', () => {
    const sick = new Map([[REST[0], { type: 'sick', value: 'SICK' }]]);
    const args = { type: 'annual_leave', dates: [WORKING[0], REST[0], REST[1]], memberObj: MEMBER, ovByDate: sick };
    assert.deepEqual(rangeWriteDates(args), [WORKING[0]], '"free" (unanswered-as-swapped) writes nothing on the rest days');
    assert.deepEqual(rangeWriteDates({ ...args, swappedDates: [REST[0]] }), [WORKING[0], REST[0]]);
    assert.deepEqual(rangeWriteDates({ ...args, type: 'sick' }), [WORKING[0], REST[0]],
        'absence is never asked: a rest day already holding one is rewritten as before');
    assert.deepEqual(rangeWriteDates({ ...args, memberObj: null }), []);
});
