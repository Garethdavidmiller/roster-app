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
import { bookedYears, pickBookedYear, splitAtYearEnd } from './admin-booked-periods.js';

/** @param {string[]} starts */
const periods = starts => starts.map(s => ({ start: s, end: s, count: 1 }));

describe('bookedYears — the years a chip may exist for', () => {
    it('is ascending and deduped, so the chip row reads like a timeline', () => {
        assert.deepEqual(bookedYears(periods(['2027-06-21', '2026-01-01', '2026-08-13'])),
            ['2026', '2027']);
    });

    it('lists BOTH years of a booking cut at the year end — it is only ever fed split segments', () => {
        // 28 Dec 2026 → 1 Jan 2027 reaches this function as two segments, because the renderer runs
        // `splitAtYearEnd` first (v23.11, owner decision: a date appears in the year it FALLS in).
        // This case used to hand it the unsplit booking and assert `['2026']`, with a comment
        // defending the start-year rule the owner had overturned — it passed only because the
        // function is naive about input it no longer receives. Pinned the right way round.
        assert.deepEqual(bookedYears(splitAtYearEnd(
            [{ start: '2026-12-28', end: '2027-01-01', count: 5 }],
            ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'])),
            ['2026', '2027']);
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

describe('splitAtYearEnd — every date in the year it falls in, exactly once', () => {
    // The owner's own case: Mon 28 Dec 2026 → Fri 1 Jan 2027, a working week with no Sunday in it.
    const XMAS = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'];
    const merged = [{ start: '2026-12-28', end: '2027-01-01', count: 5 }];

    it('puts the January day under January\'s year — the shipped defect', () => {
        // Filed under 2026, a member opening 2027 to see their leave found no 1 January.
        const segs = splitAtYearEnd(merged, XMAS);
        assert.deepEqual(segs.map(s => [s.start, s.end, s.count]), [
            ['2026-12-28', '2026-12-31', 4],
            ['2027-01-01', '2027-01-01', 1],
        ]);
        assert.deepEqual(bookedYears(segs), ['2026', '2027']);
    });

    it('never shows a date twice, and never loses one at the boundary', () => {
        const segs = splitAtYearEnd(merged, XMAS);
        const total = segs.reduce((n, s) => n + s.count, 0);
        assert.equal(total, XMAS.length, 'the segments must account for every booked date once');
    });

    it('counts booked DATES per segment, not calendar days — a bridged rest day is not leave', () => {
        // Thu 31 Dec and Sat 2 Jan booked, Fri 1 Jan a rest day the merge bridged. Dividing the
        // parent count would be wrong in both segments; recounting from the dates is right.
        const dates = ['2026-12-30', '2026-12-31', '2027-01-02'];
        const segs = splitAtYearEnd([{ start: '2026-12-30', end: '2027-01-02', count: 3 }], dates);
        assert.deepEqual(segs.map(s => [s.start, s.end, s.count]), [
            ['2026-12-30', '2026-12-31', 2],
            ['2027-01-02', '2027-01-02', 1],
        ]);
    });

    it('marks both halves as pieces of one booking, so a lone 1 Jan can say where it came from', () => {
        const segs = splitAtYearEnd(merged, XMAS);
        assert.ok(segs.every(s => s.splitFrom === '2026-12-28' && s.splitTo === '2027-01-01'));
    });

    it('leaves a booking inside one year exactly as it came — no marker, no recount', () => {
        const p = { start: '2026-06-30', end: '2026-07-04', count: 5 };
        const [seg] = splitAtYearEnd([p], ['2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']);
        assert.equal(seg, p);
        assert.equal(seg.splitFrom, undefined);
    });

    it('cuts a booking that crosses two year ends into three', () => {
        const dates = ['2026-12-31', '2027-01-01', '2027-12-31', '2028-01-01'];
        const segs = splitAtYearEnd([{ start: '2026-12-31', end: '2028-01-01', count: 4 }], dates);
        assert.deepEqual(segs.map(s => s.start.slice(0, 4)), ['2026', '2027', '2028']);
    });
});
