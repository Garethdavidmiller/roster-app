import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEC_2026_DEMAND, DEC_2026_MOVEMENTS, DEC_2026_SOURCE, demandAt, peakCars, demandBucket,
    movementsOutside, summariseDemand, describeHours, describeMovements,
} from './links-demand.js';
import { DAYS } from './links-design.js';

/**
 * The profile is measured data, so the tests that matter most are the ones that would catch it
 * being TRANSCRIBED wrong — a plausible-looking table nobody can check by eye. Totals and peaks are
 * pinned against the figures in LINKS_DEC2026_PLAN.md, which is where the measurement is written up.
 */
describe('DEC_2026_DEMAND — the measured profile', () => {
    const sum = (a) => a.reduce((x, y) => x + y, 0);

    test('totals match the published measurement', () => {
        assert.equal(sum(DEC_2026_DEMAND.weekday.mv), 311);
        assert.equal(sum(DEC_2026_DEMAND.weekday.cars), 1758);
        assert.equal(sum(DEC_2026_DEMAND.sat.mv), 215);
        assert.equal(sum(DEC_2026_DEMAND.sat.cars), 1270);
        assert.equal(sum(DEC_2026_DEMAND.sun.mv), 188);
        assert.equal(sum(DEC_2026_DEMAND.sun.cars), 1063);
    });

    test('every day class carries 24 hours of both figures', () => {
        for (const cls of ['weekday', 'sat', 'sun']) {
            assert.equal(DEC_2026_DEMAND[cls].mv.length, 24, cls);
            assert.equal(DEC_2026_DEMAND[cls].cars.length, 24, cls);
        }
    });

    test('an hour with movements always carries cars, and vice versa', () => {
        // A zero in one and not the other means a transcription slip, and it would render as either
        // an invisible busy hour or a shaded empty one.
        for (const cls of ['weekday', 'sat', 'sun']) {
            for (let h = 0; h < 24; h++) {
                assert.equal(
                    DEC_2026_DEMAND[cls].mv[h] === 0, DEC_2026_DEMAND[cls].cars[h] === 0,
                    `${cls} ${h}`,
                );
            }
        }
    });

    test('mean train length is plausible on every populated hour (3–9 cars)', () => {
        // Max CAO runs 3 to 9. A mean outside that range means movements and cars have drifted apart.
        for (const cls of ['weekday', 'sat', 'sun']) {
            for (let h = 0; h < 24; h++) {
                const mv = DEC_2026_DEMAND[cls].mv[h];
                if (!mv) continue;
                const mean = DEC_2026_DEMAND[cls].cars[h] / mv;
                assert.ok(mean >= 3 && mean <= 9, `${cls} ${h}: mean ${mean.toFixed(1)} cars`);
            }
        }
    });

    test('the weekday peak MOVES when weighted by cars — 08:00 by movement, 17:00 by cars', () => {
        // This is the finding the two-figure design exists to preserve. If a future edit blends them
        // into one number, or re-measures without the weighting, this is what notices.
        const mv = DEC_2026_DEMAND.weekday.mv, cars = DEC_2026_DEMAND.weekday.cars;
        assert.equal(mv.indexOf(Math.max(...mv)), 8);
        assert.equal(cars.indexOf(Math.max(...cars)), 17);
    });

    test('Saturday and Sunday agree with themselves on both measures', () => {
        for (const cls of ['sat', 'sun']) {
            const mv = DEC_2026_DEMAND[cls].mv, cars = DEC_2026_DEMAND[cls].cars;
            assert.equal(mv.indexOf(Math.max(...mv)), cars.indexOf(Math.max(...cars)), cls);
        }
    });

    test('the source is labelled provisional — the weekday file is not marked final', () => {
        assert.equal(DEC_2026_SOURCE.provisional, true);
        assert.match(DEC_2026_SOURCE.detail, /ECS excluded/i);
    });
});

describe('demandAt', () => {
    test('maps every weekday key to the weekday curve', () => {
        for (const d of ['mon', 'tue', 'wed', 'thu', 'fri']) {
            assert.deepEqual(demandAt(DEC_2026_DEMAND, d, 17), { mv: 23, cars: 140 });
        }
    });

    test('Saturday and Sunday have their own curves', () => {
        assert.deepEqual(demandAt(DEC_2026_DEMAND, 'sat', 17), { mv: 14, cars: 82 });
        assert.deepEqual(demandAt(DEC_2026_DEMAND, 'sun', 17), { mv: 14, cars: 78 });
    });

    test('Sunday has no service before 07:00 — the shape the window has to respect', () => {
        for (let h = 1; h <= 6; h++) assert.deepEqual(demandAt(DEC_2026_DEMAND, 'sun', h), { mv: 0, cars: 0 });
        assert.equal(demandAt(DEC_2026_DEMAND, 'sun', 7).mv, 3);
    });

    test('returns zeroes rather than throwing on junk — a missing figure must not kill the card', () => {
        assert.deepEqual(demandAt(DEC_2026_DEMAND, 'nope', 12), { mv: 0, cars: 0 });
        assert.deepEqual(demandAt(DEC_2026_DEMAND, 'mon', 24), { mv: 0, cars: 0 });
        assert.deepEqual(demandAt(DEC_2026_DEMAND, 'mon', -1), { mv: 0, cars: 0 });
        assert.deepEqual(demandAt(DEC_2026_DEMAND, 'mon', 1.5), { mv: 0, cars: 0 });
        assert.deepEqual(demandAt(null, 'mon', 12), { mv: 0, cars: 0 });
    });
});

describe('peakCars / demandBucket', () => {
    test('peak is the busiest single hour across all three day classes', () => {
        assert.equal(peakCars(DEC_2026_DEMAND), 140);   // weekday 17:00
    });

    test('peak of an empty or absent profile is 0, not NaN', () => {
        assert.equal(peakCars(null), 0);
        assert.equal(peakCars({}), 0);
    });

    test('any non-zero demand reaches at least bucket 1', () => {
        // One 3-car train is a quiet hour, not a closed one. b0 is reserved for genuinely nothing.
        assert.equal(demandBucket(1, 140), 1);
        assert.equal(demandBucket(5, 140), 1);
        assert.equal(demandBucket(140, 140), 5);
    });

    test('zero demand is bucket 0, and a zero peak cannot divide', () => {
        assert.equal(demandBucket(0, 140), 0);
        assert.equal(demandBucket(10, 0), 0);
        assert.equal(demandBucket(-3, 140), 0);
    });
});

describe('summariseDemand — the finding/fact split', () => {
    /** Cover of `n` people in every hour of `hours`, on every day. */
    const cover = (hours, n = 2) => Object.fromEntries(DAYS.map(d => [d, {
        hours: Array.from({ length: 24 }, (_, h) => (hours.includes(h) ? n : 0)),
    }]));
    /** The whole day staffed — every hour open. */
    const openAll = () => ({ start: 0, end: 24 * 60 });
    /** The real Mon–Sat window: 06:20 to 23:55. */
    const w0620 = () => ({ start: 6 * 60 + 20, end: 23 * 60 + 55 });
    /** The real per-day windows: Mon–Sat 06:20–23:55, Sun 07:15–23:25. */
    const realWindow = (d) => (d === 'sun'
        ? { start: 7 * 60 + 15, end: 23 * 60 + 25 }
        : { start: 6 * 60 + 20, end: 23 * 60 + 55 });

    test('a staffed hour with trains and nobody on duty is a FINDING', () => {
        const r = summariseDemand({
            profile: DEC_2026_DEMAND, movements: DEC_2026_MOVEMENTS, hourly: cover([]), days: DAYS, windowFor: openAll,
        });
        assert.ok(r.uncovered.length > 0);
        assert.equal(r.outside.length, 0);
        assert.ok(r.uncoveredCars > 0);
    });

    test('service when the station is shut is a FACT, never a finding', () => {
        // The last trains and the 05:5x first departure are outside every real window. If they
        // leaked into `uncovered` they would flag every design that will ever exist, and the row
        // would be learned-ignored — taking the genuine finding with it.
        const r = summariseDemand({
            profile: DEC_2026_DEMAND, movements: DEC_2026_MOVEMENTS, hourly: cover([]), days: DAYS, windowFor: w0620,
        });
        assert.ok(r.outside.length > 0);
        assert.ok(r.outside.every(e => e.t < 6 * 60 + 20 || e.t > 23 * 60 + 55));
        assert.ok(r.uncovered.every(e => e.hour >= 6));
        assert.ok(r.outsideCars > 0);
    });

    test('outside is counted once per day CLASS — a weekday 00:01 is one fact, not five', () => {
        // It depends only on the service and the window, never on the design. Reporting it per day
        // would list the permanent, unmovable cases five times over and bury the entries that are
        // actually about a boundary someone could move.
        const r = summariseDemand({
            profile: DEC_2026_DEMAND, movements: DEC_2026_MOVEMENTS, hourly: cover([]), days: DAYS, windowFor: w0620,
        });
        assert.deepEqual([...new Set(r.outside.map(e => e.label))].sort(), ['Mon–Fri', 'Sat', 'Sun']);
        assert.equal(r.outside.filter(e => e.label === 'Mon–Fri' && e.t === 1).length, 2);  // two 00:01 deps
        // …while uncovered stays per day, because a hole on five days IS five times the problem.
        assert.equal(r.uncovered.filter(e => e.hour === 12).length, 7);
    });

    test('every outside entry carries the label the reader sees', () => {
        const r = summariseDemand({
            profile: DEC_2026_DEMAND, movements: DEC_2026_MOVEMENTS, hourly: cover([]), days: DAYS, windowFor: w0620,
        });
        for (const e of r.outside) assert.ok(['Mon–Fri', 'Sat', 'Sun'].includes(e.label), e.label);
    });

    test('an hour with cover is neither', () => {
        const allHours = Array.from({ length: 24 }, (_, h) => h);
        const r = summariseDemand({
            profile: DEC_2026_DEMAND, movements: DEC_2026_MOVEMENTS, hourly: cover(allHours), days: DAYS, windowFor: openAll,
        });
        assert.equal(r.uncovered.length, 0);
        assert.equal(r.outside.length, 0);
    });

    test('cover in an UNSTAFFED hour does not cancel the outside fact', () => {
        // Someone rostered outside the window is an anomaly in its own right; the service then is
        // still service the link does not officially staff, and the figure must say so.
        const r = summariseDemand({
            profile: DEC_2026_DEMAND, movements: DEC_2026_MOVEMENTS, hourly: cover([0], 3), days: DAYS, windowFor: w0620,
        });
        assert.ok(r.outside.some(e => e.t < 60));
    });

    test('an hour with NO trains is silent whether staffed or not', () => {
        // 02:00–04:00 is empty on every day. A staffed hour with no service is not a hole.
        const r = summariseDemand({
            profile: DEC_2026_DEMAND, movements: DEC_2026_MOVEMENTS, hourly: cover([]), days: DAYS, windowFor: openAll,
        });
        for (const h of [2, 3, 4]) {
            assert.ok(!r.uncovered.some(e => e.hour === h), `hour ${h} should be silent`);
            assert.ok(!r.outside.some(e => Math.floor(e.t / 60) === h), `hour ${h} should be silent`);
        }
    });

    test('THE LIVE SUNDAY CASE: the real 23:25 finish leaves five movements outside', () => {
        // This is the finding the whole feature exists to surface, and the FIRST implementation
        // could not see it. The window was tested an HOUR at a time, and 23:25 means the 23:00 hour
        // is partly staffed — so an hourly test called it covered and all five movements vanished.
        // The unit test passed too, because it used a synthetic `h <= 22` Sunday rather than the
        // real window. It now runs against the REAL boundary, to the minute.
        const allHours = Array.from({ length: 24 }, (_, h) => h);
        const r = summariseDemand({
            profile: DEC_2026_DEMAND, movements: DEC_2026_MOVEMENTS, hourly: cover(allHours), days: DAYS, windowFor: realWindow,
        });
        const late = r.outside.filter(e => e.label === 'Sun' && e.t > 23 * 60 + 25);
        assert.equal(late.length, 5, 'the plan records exactly five Sunday movements after 23:25');
        assert.deepEqual(late.map(e => `${Math.floor(e.t / 60)}:${String(e.t % 60).padStart(2, '0')} ${e.isArr ? 'arr' : 'dep'}`),
            ['23:27 dep', '23:35 arr', '23:45 dep', '23:51 arr', '23:54 arr']);
        // THREE of the five are arrivals — which is why the answer to open question 1 strengthens
        // the Sunday case rather than weakening it. An earlier draft assumed only departures needed
        // a CEA, which would have cut this from five movements to two.
        assert.equal(late.filter(e => e.isArr).length, 3);

        // Mon–Sat is a different story and the panel must not blur them together: the 23:55 finish
        // is overhung by exactly two minutes — two weekday movements and one Saturday one, all at
        // 23:57 — which the plan calls "no change needed", against Sunday's half hour. A summary
        // that reported only a combined total would make those two look like the same problem.
        const lateMonSat = r.outside.filter(e => e.label !== 'Sun' && e.t > 23 * 60 + 55);
        assert.equal(lateMonSat.length, 3);
        assert.ok(lateMonSat.every(e => e.t === 23 * 60 + 57));
    });

    test('totals equal the sum of their own entries', () => {
        const r = summariseDemand({
            profile: DEC_2026_DEMAND, movements: DEC_2026_MOVEMENTS, hourly: cover([8, 9, 10]), days: DAYS, windowFor: w0620,
        });
        assert.equal(r.uncoveredCars, r.uncovered.reduce((a, e) => a + e.cars, 0));
        assert.equal(r.uncoveredMv, r.uncovered.reduce((a, e) => a + e.mv, 0));
        assert.equal(r.outsideCars, r.outside.reduce((a, e) => a + e.cars, 0));
        assert.equal(r.outsideMv, r.outside.length);   // one movement each, by construction
    });

    test('survives an hourly map missing days entirely', () => {
        const r = summariseDemand({
            profile: DEC_2026_DEMAND, movements: DEC_2026_MOVEMENTS, hourly: {}, days: DAYS, windowFor: openAll,
        });
        assert.ok(r.uncovered.length > 0);   // absent cover reads as zero cover, not as a crash
    });
});

describe('movementsOutside', () => {
    test('splits before and after the boundary, exclusive of the boundary itself', () => {
        const mv = [[100, 4, 0], [200, 5, 1], [300, 6, 0]];
        const r = movementsOutside(mv, 200, 200);
        assert.deepEqual(r.before.map(e => e.t), [100]);
        assert.deepEqual(r.after.map(e => e.t), [300]);
    });

    test('a movement exactly ON the window edge is inside it', () => {
        // The station is staffed AT 06:20; a 06:20 departure is covered. Off-by-one here would put a
        // real movement on the wrong side of a business argument.
        assert.equal(movementsOutside([[380, 5, 0]], 380, 1435).before.length, 0);
        assert.equal(movementsOutside([[1435, 5, 0]], 380, 1435).after.length, 0);
    });

    test('carries the length and the arr/dep flag through', () => {
        const r = movementsOutside([[10, 7, 1]], 100, 200);
        assert.deepEqual(r.before, [{ t: 10, cars: 7, isArr: true }]);
    });

    test('empty or absent movements give empty lists, not a throw', () => {
        assert.deepEqual(movementsOutside(undefined, 0, 100), { before: [], after: [] });
        assert.deepEqual(movementsOutside([], 0, 100), { before: [], after: [] });
    });
});

describe('describeMovements', () => {
    test('names each movement to the minute, with arr/dep', () => {
        assert.equal(
            describeMovements([{ label: 'Sun', t: 1407, cars: 5, isArr: false },
                { label: 'Sun', t: 1415, cars: 4, isArr: true }]),
            'Sun 23:27 dep, Sun 23:35 arr',
        );
    });

    test('caps and counts the remainder', () => {
        const e = Array.from({ length: 7 }, (_, i) => ({ day: 'sun', t: 60 + i, cars: 5, isArr: false }));
        assert.match(describeMovements(e, 2), /\+5 more$/);
    });

    test('empty in, empty out', () => {
        assert.equal(describeMovements([]), '');
    });
});

describe('describeHours', () => {
    test('names the hours, capped, with a remainder', () => {
        const e = [
            { day: 'sun', hour: 23 }, { day: 'mon', hour: 0 },
            { day: 'tue', hour: 5 }, { day: 'wed', hour: 5 }, { day: 'thu', hour: 5 },
        ];
        assert.equal(describeHours(e, 2), 'Sun 23:00, Mon 00:00, +3 more');
        assert.equal(describeHours(e.slice(0, 2)), 'Sun 23:00, Mon 00:00');
    });

    test("an entry's own label wins over its representative day", () => {
        // A per-day-class fact must not read as being about Monday in particular.
        assert.equal(describeHours([{ label: 'Mon–Fri', day: 'mon', hour: 0 }]), 'Mon–Fri 00:00');
    });

    test('pads the hour so the list aligns with the grid headings', () => {
        assert.equal(describeHours([{ day: 'sat', hour: 6 }]), 'Sat 06:00');
    });

    test('empty in, empty out', () => {
        assert.equal(describeHours([]), '');
    });
});
