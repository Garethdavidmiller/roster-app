// al-swapped-days.test.mjs — which days need the swap question, and what gets written.
//
// The rule this protects is the one the owner set on 14 Sep 2026: ASK ONLY WHEN A DAY IS AFFECTED,
// and when you ask, require an answer. The "only when affected" half is what this file can test —
// the "require an answer" half is a save-path property and lives in the e2e.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapDecisionDates, replacedTypeForSwap, rangeWriteDates } from './al-swapped-days.js';
import { teamMembers, getBaseShift, parseISODate, formatISO } from './roster-data.js';
import { isRestShift } from './override-utils.js';
import { projectAlBooking } from './admin-al-projection.js';

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
    // A retired contracted type is a stronger record than the reconstruction, and keeps its name.
    assert.equal(replacedTypeForSwap({ type: 'annual_leave', replacedType: 'swap' }, 'annual_leave'), 'swap');
    assert.equal(replacedTypeForSwap({ type: 'annual_leave', replacedType: 'allocated' }, 'annual_leave'), 'allocated');
});

// A declared swap is always on a base REST day — only a rest day is asked about — and there an Other day
// or a Spare turn is rest-day working, so leave over it is free (owner, 10 Nov 2026: "Free, like plain
// RDW"). This kept `other` and `spare_shift` until then; carried now, the swap the admin declared would
// cost nothing. They go the way `rdw` always went: the declared swap is recorded as `shift`.
test('a declared swap over a rest-day Other day or Spare turn is recorded as `shift`, as over RDW', () => {
    assert.equal(replacedTypeForSwap({ type: 'spare_shift', value: 'SPARE' }, 'annual_leave'), 'shift');
    assert.equal(replacedTypeForSwap({ type: 'other', value: 'TRG RDW' }, 'annual_leave'), 'shift');
    assert.equal(replacedTypeForSwap({ type: 'rdw', value: '09:00-17:00' }, 'annual_leave'), 'shift');
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

test('Christmas Day and Boxing Day are never asked about from 2026 — the answer is fixed (v25.37)', () => {
    // Leave there costs nothing whatever the answer, so the question could change nothing; and a
    // member due at work already HAS the leave, shown from the roster (christmas-leave.js).
    assert.deepEqual(swapDecisionDates({ dates: ['2026-12-25', '2026-12-26'], memberObj: MEMBER, ovByDate: null }), []);
    // Before 2026 they are rest days like any other, asked about exactly as they always were.
    assert.deepEqual(swapDecisionDates({ dates: ['2025-12-25', '2025-12-26'], memberObj: MEMBER, ovByDate: null }),
        ['2025-12-25', '2025-12-26']);
});

// ── NOTHING BEFORE THE START DATE (whole-app check, 10 Nov 2026 — the range card's twin of admin-1-11) ──
// Before a member's start date the base roster reads as rest, so the AL card asked "swapped or free?"
// about days they had not yet joined for, and "swapped" wrote leave the Calendar never shows and the
// allowance counted. Such a day is never asked about and never written, and the booking's projection
// skips it too, so the preview counts what the save writes.
const JOINER = teamMembers.find(m => m.name === 'K. Jedlinski');
const PRE  = ['2026-05-30', '2026-06-01', '2026-06-02'];
const POST = ['2026-06-03', '2026-06-04', '2026-06-05'];
/** A shift recorded before the start date — what a roster import could leave there. */
const PRE_SHIFT = new Map([[PRE[2], { type: 'shift', value: '06:00-14:00' }]]);

test('premise: the joiner starts on 3 Jun 2026, and the roster reads every day before it as rest', () => {
    assert.ok(JOINER?.startDate, 'K. Jedlinski must be on the roster with a start date');
    assert.equal(formatISO(JOINER.startDate), POST[0]);
    for (const d of PRE) assert.ok(isRestShift(getBaseShift(JOINER, parseISODate(d))), `${d} must read as rest`);
    for (const d of POST) assert.ok(!isRestShift(getBaseShift(JOINER, parseISODate(d))), `${d} must be a working day`);
});

test('a day before the start date is never asked about', () => {
    assert.deepEqual(swapDecisionDates({ dates: [...PRE, ...POST], memberObj: JOINER, ovByDate: null }), []);
});

test('a day before the start date is never written — not on a "swapped" answer, nor over a shift recorded there', () => {
    const args = { type: 'annual_leave', dates: [...PRE, ...POST], memberObj: JOINER, ovByDate: PRE_SHIFT, swappedDates: PRE };
    assert.deepEqual(rangeWriteDates(args), POST);
    assert.deepEqual(rangeWriteDates({ ...args, type: 'sick' }), POST, 'an absence range writes nothing there either');
});

test('the booking projection writes and counts exactly what the range writer writes', () => {
    const dates = [...PRE, ...POST];
    const p = projectAlBooking({ member: JOINER, dates, ovByDate: PRE_SHIFT, swapAnswers: new Map(PRE.map(d => [d, true])) });
    assert.deepEqual(p.writing, rangeWriteDates({ type: 'annual_leave', dates, memberObj: JOINER, ovByDate: PRE_SHIFT, swappedDates: PRE }));
    assert.deepEqual(p.consuming, POST, 'the preview and the allowance check count no day before the start');
});
