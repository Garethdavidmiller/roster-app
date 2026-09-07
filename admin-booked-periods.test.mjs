// @ts-check
/**
 * admin-booked-periods.test.mjs — WHICH YEAR OF SOMEBODY'S LEAVE IS ON SCREEN.
 *
 * Organised by what a wrong answer COSTS, because the two directions are not close to symmetrical.
 *
 *   · SHOWING A YEAR WITH NO BOOKINGS is silent and it lies. The chips render, a year is selected,
 *     the list under it is empty — and an empty Recorded Annual Leave dates card reads as "nothing
 *     recorded for this person". That is v23.08's false statement reached from the other direction:
 *     there the card went quiet over a read that failed, here it would go quiet over a year that
 *     simply has nothing in it, and neither is distinguishable on screen from a member with no
 *     leave. Every case below that pins the RETURN VALUE INTO `years` is guarding that.
 *   · CHOOSING AN UNHELPFUL BUT REAL YEAR costs one tap. It is worth getting right — landing on the
 *     year you are already working in is the difference between a selector you never touch and one
 *     you always do — but nothing is misstated while you do it.
 *
 * A per-function suite would pass on exactly the code that produces the first: `pickBookedYear` is
 * trivially right about every year it is HANDED, and the defect is handing it one that is not there.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bookedYears, pickBookedYear } from './admin-booked-periods.js';

/** @param {string[]} starts */
const periods = starts => starts.map(s => ({ start: s, end: s, count: 1 }));

describe('bookedYears — the years a chip may exist for', () => {
    it('is ascending and deduped, so the chip row reads like a timeline', () => {
        assert.deepEqual(bookedYears(periods(['2027-06-21', '2026-01-01', '2026-08-13'])),
            ['2026', '2027']);
    });

    it('keys a YEAR-SPANNING booking to the year it STARTS in, and lists it once', () => {
        // 28 Dec 2026 → 1 Jan 2027 is one booking a person made once. Two chips would present it as
        // two, and filing it under 2027 would hide it from the year they booked it in.
        assert.deepEqual(bookedYears([{ start: '2026-12-28', end: '2027-01-01', count: 5 }]),
            ['2026']);
    });

    it('survives the shapes a cache can actually hand it', () => {
        // Not defensive programming for its own sake: an override document with no date reaches
        // this list from the roster importer, and a crash here takes the whole Admin card down.
        assert.deepEqual(bookedYears([]), []);
        assert.deepEqual(bookedYears(/** @type {any} */ (null)), []);
        assert.deepEqual(bookedYears(/** @type {any} */ ([null, {}, { start: '' }, { start: 5 }])), []);
    });
});

describe('pickBookedYear — showing a year that is not there is the expensive answer', () => {
    it('NEVER returns a year outside the list, whatever it was asked for', () => {
        // The one property that matters. A pinned or preferred year that has no bookings must not
        // survive — it renders an empty list, which reads as "this member has no leave recorded".
        const years = ['2026'];
        assert.equal(pickBookedYear({ pinned: '2031', preferred: '2030', years }), '2026');
        assert.equal(pickBookedYear({ pinned: null, preferred: '2027', years }), '2026');
    });

    it('returns null rather than a year when there are no bookings at all', () => {
        // null is what makes the caller HIDE the box. Any string here would show a chip row over
        // an empty list — a card claiming a year it has nothing to say about.
        assert.equal(pickBookedYear({ pinned: '2026', preferred: '2026', years: [] }), null);
    });

    it('a tapped chip outranks the year the rest of the card is discussing', () => {
        // Otherwise the next re-render — a save, a delete, the date picker moving — silently
        // throws the reader back to the banner's year while they are reading another one.
        assert.equal(pickBookedYear({ pinned: '2027', preferred: '2026', years: ['2026', '2027'] }),
            '2027');
    });

    it('with nothing pinned, follows the year the banner is describing', () => {
        assert.equal(pickBookedYear({ pinned: null, preferred: '2026', years: ['2025', '2026', '2027'] }),
            '2026');
    });

    it('falls back to the MOST RECENT year, not the first', () => {
        // A leaver, or a member whose leave is all historic: neither the pin nor the banner's year
        // exists in the data. Oldest-first would open the card on 2024 for somebody with a 2027
        // booking, which is the year they are least likely to want.
        assert.equal(pickBookedYear({ pinned: null, preferred: '2029', years: ['2024', '2025', '2027'] }),
            '2027');
    });

    it('ignores a non-string pin rather than treating it as a choice', () => {
        assert.equal(pickBookedYear({ pinned: /** @type {any} */ (2027), preferred: '2026', years: ['2026', '2027'] }),
            '2026');
    });
});
