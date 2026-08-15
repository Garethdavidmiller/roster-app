/**
 * Tests for admin-shift-rules.js — the maximum shift length and the minimum rest gap.
 *
 * These are the only two checks between a saved override and somebody being rostered a duty they
 * may not legally work, and until v21.38 they could only be exercised through a fake DOM, so in
 * practice they were exercised through the two cases somebody happened to think of.
 *
 * ORGANISED BY WHAT A WRONG ANSWER COSTS:
 *
 *   · MISSED — the save goes through and the roster is illegal. Nothing on screen says so, which is
 *     what makes it the serious direction.
 *   · FALSELY RAISED — a legal shift is refused. Visible, and it teaches an admin to distrust the
 *     check, which eventually costs the same thing.
 *
 * No mocks: the module reads no DOM and no cache — the adjacent day is resolved by an injected
 * function, which is what makes these cases writable at all.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { checkShiftRules, constrainingTime, effectiveEndMins, parseMinutes, fmtHours } from './admin-shift-rules.js';

/** A harness with no neighbours unless the test supplies them. */
function check(toSave, { shifts = {}, base = {} } = {}) {
    return checkShiftRules({
        toSave,
        isFixedType: t => t === 'annual_leave' || t === 'sick' || t === 'rdw',
        resolveShift: iso => shifts[iso] ?? '',
        baseShiftFor: iso => base[iso] ?? '',
        formatDate: iso => iso,
        shiftDate: (iso, delta) => {
            const d = new Date(iso + 'T00:00:00Z');
            d.setUTCDate(d.getUTCDate() + delta);
            return d.toISOString().slice(0, 10);
        },
    });
}

describe('a breach that must not be missed', () => {
    test('a shift longer than 12 hours is refused', () => {
        const { errors, failedDates } = check([{ date: '2026-06-15', value: '06:00-19:00', type: 'shift' }]);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /13h — max is 12h/);
        assert.deepEqual(failedDates, ['2026-06-15']);
    });

    test('too little rest AFTER the previous day is refused', () => {
        // Finishes 22:00, starts 07:00 → 9 hours.
        const { errors } = check([{ date: '2026-06-16', value: '07:00-15:00', type: 'shift' }],
            { shifts: { '2026-06-15': '14:00-22:00' } });
        assert.equal(errors.length, 1);
        assert.match(errors[0], /only 9h rest after/);
    });

    test('too little rest BEFORE the next day is refused', () => {
        const { errors } = check([{ date: '2026-06-15', value: '14:00-22:00', type: 'shift' }],
            { shifts: { '2026-06-16': '07:00-15:00' } });
        assert.equal(errors.length, 1);
        assert.match(errors[0], /only 9h rest before/);
    });

    test('a NIGHT shift is measured across midnight, not backwards', () => {
        // 21:00–05:00 is 8 hours. Read naively it is minus 16, which passes every check silently —
        // the one shape where an arithmetic slip hides a breach rather than inventing one.
        const { errors } = check([{ date: '2026-06-15', value: '21:00-05:00', type: 'shift' }]);
        assert.deepEqual(errors, [], 'an 8-hour night is legal');
        assert.equal(effectiveEndMins('21:00', '05:00'), 29 * 60);
    });

    test('a TIMED Other day still constrains the neighbour', () => {
        // `TRG 09:00-17:00` split naively on '-' yields NaN and skips every check on that day. That
        // reads as "no problem found", which is the failure this case exists for.
        const { errors } = check([{ date: '2026-06-16', value: '02:00-10:00', type: 'shift' }],
            { shifts: { '2026-06-15': 'TRG 09:00-17:00' } });
        assert.equal(errors.length, 1, 'the training day\'s real hours constrain the next morning');
        assert.match(errors[0], /rest after/);
    });

    test('an untimed Other day on a working day constrains by its BASE shift', () => {
        const { errors } = check([{ date: '2026-06-16', value: '02:00-10:00', type: 'shift' }],
            { shifts: { '2026-06-15': 'TRG' }, base: { '2026-06-15': '14:00-22:00' } });
        assert.equal(errors.length, 1, 'the member attends during their rostered hours');
    });

    test('a gap JUST under 12 hours is refused — the check is not approximately 12', () => {
        // Added after a mutation survived: widening the rule by a single hour (`< 12h` → `< 11h`)
        // passed the whole suite, because every rest case here was either a comfortable breach at
        // 9h or exactly legal at 12h, and nothing lived in between. A rule that is an hour out
        // reads as working and lets through the shifts nearest the limit — which are the ones the
        // limit exists for.
        const { errors } = check([{ date: '2026-06-16', value: '09:50-17:00', type: 'shift' }],
            { shifts: { '2026-06-15': '14:00-22:00' } });   // 22:00 → 09:50 = 11h50m
        assert.equal(errors.length, 1, '11h50m of rest is a breach');
        assert.match(errors[0], /11\.8h rest after/);
    });

    test('one row breaking BOTH neighbours says both things but is marked once', () => {
        // Finishes 04:00 on the 16th, works 14:00–22:00, and the 17th starts 07:00 — 10h before and
        // 9h after. (An earlier draft of this fixture could not breach the FORWARD gap at all: a day
        // ending at 10:00 leaves at least 14h before any next-day start, so the case was asserting
        // one error and passing for the wrong reason.)
        const { errors, failedDates } = check([{ date: '2026-06-16', value: '14:00-22:00', type: 'shift' }],
            { shifts: { '2026-06-15': '20:00-04:00', '2026-06-17': '07:00-15:00' } });
        assert.equal(errors.length, 2, 'both gaps are worth naming');
        assert.deepEqual(failedDates, ['2026-06-16'], 'the row is marked once, not twice');
    });
});

describe('a refusal that must not be raised', () => {
    test('exactly 12 hours of rest is legal — the boundary is not a breach', () => {
        const { errors } = check([{ date: '2026-06-16', value: '10:00-18:00', type: 'shift' }],
            { shifts: { '2026-06-15': '14:00-22:00' } });
        assert.deepEqual(errors, [], '22:00 → 10:00 is exactly 12h');
    });

    test('exactly 12 hours long is legal', () => {
        const { errors } = check([{ date: '2026-06-15', value: '07:00-19:00', type: 'shift' }]);
        assert.deepEqual(errors, []);
    });

    test('a fixed-value type is never time-checked', () => {
        // AL/absence/RDW carry 'AL', 'SICK', 'RDW' — not times. Checking them would compare
        // nonsense and could only ever produce a false refusal.
        const { errors } = check([{ date: '2026-06-15', value: 'AL', type: 'annual_leave' }]);
        assert.deepEqual(errors, []);
    });

    test('an untimed Other day on a REST day is exempt', () => {
        // Its hours are genuinely unknowable here, so constraining by anything would be invention.
        const { errors } = check([{ date: '2026-06-16', value: '02:00-10:00', type: 'shift' }],
            { shifts: { '2026-06-15': 'TRG RDW' } });
        assert.deepEqual(errors, []);
    });

    test('an untimed Other day whose base is a rest day is exempt', () => {
        const { errors } = check([{ date: '2026-06-16', value: '02:00-10:00', type: 'shift' }],
            { shifts: { '2026-06-15': 'TRG' }, base: { '2026-06-15': 'RD' } });
        assert.deepEqual(errors, []);
    });

    test('a rest day next door constrains nothing', () => {
        const { errors } = check([{ date: '2026-06-16', value: '02:00-10:00', type: 'shift' }],
            { shifts: { '2026-06-15': 'RD' } });
        assert.deepEqual(errors, []);
    });

    test('an over-long shift reports ONCE, not once per neighbour too', () => {
        const { errors } = check([{ date: '2026-06-16', value: '02:00-19:00', type: 'shift' }],
            { shifts: { '2026-06-15': '14:00-22:00' } });
        assert.equal(errors.length, 1, 'the length is the finding; piling on rest gaps buries it');
        assert.match(errors[0], /max is 12h/);
    });
});

describe('the pieces', () => {
    test('constrainingTime returns null rather than an empty string', () => {
        // "Does not constrain" and "constrains by nothing" are different answers, and only one of
        // them can be safely fed to a split('-').
        assert.equal(constrainingTime('RD', () => ''), null);
        assert.equal(constrainingTime('TRG RDW', () => ''), null);
        assert.equal(constrainingTime('07:00-15:00', () => ''), '07:00-15:00');
    });

    test('the base shift is resolved LAZILY, only when an untimed Other day needs it', () => {
        let asked = 0;
        constrainingTime('07:00-15:00', () => { asked++; return ''; });
        assert.equal(asked, 0, 'a plain shift must not trigger a base-roster lookup');
        constrainingTime('TRG', () => { asked++; return '09:00-17:00'; });
        assert.equal(asked, 1);
    });

    test('parseMinutes and fmtHours round-trip the forms the messages use', () => {
        assert.equal(parseMinutes('07:30'), 450);
        assert.equal(fmtHours(720), '12h');
        assert.equal(fmtHours(570), '9.5h');
    });
});
