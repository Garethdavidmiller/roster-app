// @ts-check
// @lane hygiene
/**
 * team-overlap.test.mjs — "Who's on with me?" (team-overlap.js): which colleagues' duties overlap a
 * member's shift, for how long, and in what order. Pure arithmetic, so every rule in the module's header
 * is pinned at its boundary here: the midnight crossing, the previous day's overnight, the member's own
 * overnight meeting tomorrow's earlies, touching ends, and the order. Part of test:hygiene.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shiftSpan, workedTimes, clockAt, rangeText, whoIsOnWith, DAY_MINUTES } from '../team-overlap.js';

describe('shiftSpan: a shift as minutes from its own midnight', () => {
    test('an ordinary day shift', () => {
        assert.deepEqual(shiftSpan('06:00-15:00'), { start: 360, end: 900 });
    });
    test('rule 1: a shift whose end is before its start runs into the next day', () => {
        assert.deepEqual(shiftSpan('22:00-06:00'), { start: 1320, end: DAY_MINUTES + 360 });
    });
    test('an end equal to the start is a full day, not nothing', () => {
        assert.deepEqual(shiftSpan('06:00-06:00'), { start: 360, end: DAY_MINUTES + 360 });
    });
    test('a one-digit hour reads as the shift time it is', () => {
        assert.deepEqual(shiftSpan('6:30-14:00'), { start: 390, end: 840 });
    });
    test('anything that is not a shift time is null', () => {
        for (const v of ['RD', 'AL', 'SICK', '', null, undefined, 'TRG 09:00-17:00', '25:00-26:00']) {
            assert.equal(shiftSpan(/** @type {any} */ (v)), null, String(v));
        }
    });
});

describe('workedTimes: the times of a resolved day, or none', () => {
    test('a timed shift is its own times', () => {
        assert.equal(workedTimes({ shift: '14:00-22:30' }), '14:00-22:30');
    });
    test('Rest Day Working takes the recorded time, and without one has no times', () => {
        assert.equal(workedTimes({ shift: 'RDW', rdwTime: '07:00-15:00' }), '07:00-15:00');
        assert.equal(workedTimes({ shift: 'RDW', rdwTime: '' }), null);
    });
    test('an Other day counts with the time it carries, and not without one', () => {
        assert.equal(workedTimes({ shift: 'TRG 09:00-17:00' }), '09:00-17:00');
        assert.equal(workedTimes({ shift: 'TRG RDW 09:00-17:00' }), '09:00-17:00');
        assert.equal(workedTimes({ shift: 'MEET' }), null);
    });
    test('rest, spare, leave and an absence are never worked', () => {
        for (const shift of ['RD', 'OFF', 'SPARE', 'AL', 'SICK']) assert.equal(workedTimes({ shift }), null, shift);
    });
});

describe('the clock text', () => {
    test('clockAt wraps past midnight onto the 24-hour clock', () => {
        assert.equal(clockAt(0), '00:00');
        assert.equal(clockAt(DAY_MINUTES + 75), '01:15');
        assert.equal(clockAt(-60), '23:00');
    });
    test('rangeText writes two-digit hours and an en dash', () => {
        assert.equal(rangeText('6:00-14:00'), '06:00–14:00');
        assert.equal(rangeText('22:00-06:00'), '22:00–06:00');
    });
});

describe('whoIsOnWith', () => {
    test('the owner\'s own example: 14:00–22:30 with 06:00–15:00 is together 14:00–15:00', () => {
        const { together, alsoWorking } = whoIsOnWith('14:00-22:30', [{ key: 'A', day: '06:00-15:00', worksDay: true }]);
        assert.equal(together.length, 1);
        assert.deepEqual(together[0].spans.map(s => [s.day, s.from, s.to]), [[0, '14:00', '15:00']]);
        assert.equal(together[0].minutes, 60);
        assert.deepEqual(alsoWorking, []);
    });

    test('rule 4: touching ends are NOT together, and the colleague is only "also working"', () => {
        const { together, alsoWorking } = whoIsOnWith('14:00-22:00', [{ key: 'A', day: '06:00-14:00', worksDay: true }]);
        assert.deepEqual(together, []);
        assert.deepEqual(alsoWorking, ['A']);
    });

    test('no overlap at all: also working, never together', () => {
        const { together, alsoWorking } = whoIsOnWith('06:00-12:00', [{ key: 'A', day: '15:00-23:00', worksDay: true }]);
        assert.deepEqual(together, []);
        assert.deepEqual(alsoWorking, ['A']);
    });

    test('somebody not working that day is in neither list', () => {
        const { together, alsoWorking } = whoIsOnWith('06:00-12:00', [{ key: 'A', worksDay: false }]);
        assert.deepEqual(together, []);
        assert.deepEqual(alsoWorking, []);
    });

    test('rule 2: a colleague\'s overnight from the DAY BEFORE overlaps this morning, attributed to that day', () => {
        const { together, alsoWorking } = whoIsOnWith('05:00-13:00', [{ key: 'N', prev: '22:00-06:00', worksDay: false }]);
        assert.equal(together.length, 1, 'the previous night\'s shift was not read');
        assert.deepEqual(together[0].spans.map(s => [s.day, s.time, s.from, s.to]), [[-1, '22:00-06:00', '05:00', '06:00']]);
        assert.deepEqual(alsoWorking, []);
    });

    test('rule 2 needs the midnight crossing: yesterday\'s day shift never overlaps today', () => {
        const { together } = whoIsOnWith('05:00-13:00', [{ key: 'D', prev: '04:00-12:00' }]);
        assert.deepEqual(together, []);
    });

    test('rule 1: the member\'s own midnight crossing overlaps a colleague\'s late finish on the same day', () => {
        const { together } = whoIsOnWith('21:00-05:00', [{ key: 'L', day: '15:00-23:00', worksDay: true }]);
        assert.deepEqual(together[0].spans.map(s => [s.day, s.from, s.to]), [[0, '21:00', '23:00']]);
    });

    test('rule 1: two overnights overlap across midnight, and the stretch reads on the clock', () => {
        const { together } = whoIsOnWith('22:00-06:00', [{ key: 'X', day: '23:00-07:00', worksDay: true }]);
        assert.deepEqual(together[0].spans.map(s => [s.from, s.to]), [['23:00', '06:00']]);
        assert.equal(together[0].minutes, 7 * 60);
    });

    test('rule 3: the member\'s own overnight meets the NEXT day\'s early, attributed to that day', () => {
        const { together, alsoWorking } = whoIsOnWith('21:00-05:00', [{ key: 'E', next: '04:00-12:00', worksDay: false }]);
        assert.equal(together.length, 1, 'the next day\'s early was not read');
        assert.deepEqual(together[0].spans.map(s => [s.day, s.from, s.to]), [[1, '04:00', '05:00']]);
        assert.deepEqual(alsoWorking, []);
    });

    test('rule 3 needs the midnight crossing: tomorrow\'s early never meets a shift that ends today', () => {
        const { together } = whoIsOnWith('14:00-22:00', [{ key: 'E', next: '04:00-12:00' }]);
        assert.deepEqual(together, []);
    });

    test('two stretches with one colleague are both listed, earliest first, and their minutes add', () => {
        const { together } = whoIsOnWith('05:00-23:00', [{ key: 'B', prev: '22:00-06:00', day: '20:00-04:00', worksDay: true }]);
        assert.deepEqual(together[0].spans.map(s => [s.day, s.from, s.to]), [[-1, '05:00', '06:00'], [0, '20:00', '23:00']]);
        assert.equal(together[0].minutes, 4 * 60);
    });

    test('rule 5: longest together first, a tie to whoever joins first, then the order given', () => {
        const { together } = whoIsOnWith('14:00-22:30', [
            { key: 'short',      day: '06:00-15:00', worksDay: true },   // 1h, from 14:00
            { key: 'long',       day: '13:00-21:00', worksDay: true },   // 7h
            { key: 'tie-later',  day: '20:30-23:00', worksDay: true },   // 2h, from 20:30
            { key: 'tie-first',  day: '12:00-16:00', worksDay: true },   // 2h, from 14:00
            { key: 'tie-first2', day: '12:00-16:00', worksDay: true },   // 2h, from 14:00 — after tie-first, as given
        ]);
        assert.deepEqual(together.map(t => t.key), ['long', 'tie-first', 'tie-first2', 'tie-later', 'short']);
    });

    test('a member with no shift times has nobody on with them', () => {
        assert.deepEqual(whoIsOnWith('RD', [{ key: 'A', day: '06:00-15:00', worksDay: true }]), { together: [], alsoWorking: [] });
    });
});
