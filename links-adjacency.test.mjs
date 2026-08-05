import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    OBJECTIVES, GENTLE_THRESHOLD_MINUTES, lineStartProfile, weekStep, breakLength,
    boundaryRest, scoreOrder, cost, reorderLines, applyOrder,
} from './links-adjacency.js';
import { generatePatterns } from './links-design.js';

/** A design with variety: several start times, spare weeks, and rest days. */
function design() {
    const waves = ['06:20-14:20', '07:00-15:00', '08:00-16:00', '11:00-19:00', '14:00-22:00', '15:55-23:55']
        .map(time => ({ time, weekday: 3, sat: 2, sun: 1 }));
    return generatePatterns({ slots: waves, spareLines: 4, lines: 28 });
}
// A WORKED base, so a fixture that overrides only Sat/Sun tests exactly Sat + Sun — with an
// all-rest base, Friday and Monday would silently be rest too and every break would read as four days.
const WORKED = { sun: 'RD', mon: '09:00-17:00', tue: '09:00-17:00', wed: '09:00-17:00',
    thu: '09:00-17:00', fri: '09:00-17:00', sat: 'RD' };
const line = (o) => ({ ...WORKED, ...o });
const RD = { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
/** ONLY the named days worked — for the start-profile tests, where extra worked days shift the mean. */
const only = (o) => ({ ...RD, ...o });

describe('lineStartProfile / weekStep', () => {
    test('averages the start times of the worked days', () => {
        assert.equal(lineStartProfile(only({ mon: '06:00-14:00', tue: '08:00-16:00' })), 7 * 60);
    });

    test('a SPARE line has NO profile — null, never zero', () => {
        // The trap this module exists to avoid: an optimiser that read "unmeasurable" as "no change"
        // would park spare weeks between the two harshest lines and report a beautiful number.
        const spare = { sun: 'SPARE', mon: 'SPARE', tue: 'SPARE', wed: 'SPARE', thu: 'SPARE', fri: 'SPARE', sat: 'SPARE' };
        assert.equal(lineStartProfile(spare), null);
        assert.equal(lineStartProfile(RD), null);
        assert.equal(weekStep(spare, only({ mon: '06:00-14:00' })), null);
        assert.equal(weekStep(only({ mon: '06:00-14:00' }), spare), null);
    });

    test('a step is signed — positive is later, the body-clock-friendly direction', () => {
        assert.equal(weekStep(only({ mon: '06:00-14:00' }), only({ mon: '10:00-18:00' })), 240);
        assert.equal(weekStep(only({ mon: '10:00-18:00' }), only({ mon: '06:00-14:00' })), -240);
    });
});

describe('breakLength — days off vs contracted days GIVEN', () => {
    test('Sat + Sun is a two-day break but only ONE contracted day', () => {
        // Sunday is not contracted (owner, Aug 2026), so not working it is the default rather than
        // something the design granted. A design that simply never rosters Sundays must not score as
        // generous with weekends while giving nothing away.
        assert.deepEqual(breakLength(line({}), line({})), { days: 2, given: 1 });
    });

    test('Friday and Monday each add a day AND a contracted day', () => {
        assert.deepEqual(breakLength(line({ fri: 'RD' }), line({ mon: 'RD' })), { days: 4, given: 3 });
        assert.deepEqual(breakLength(line({ fri: '06:00-14:00' }), line({ mon: 'RD' })), { days: 3, given: 2 });
    });

    test('a worked Saturday or Sunday means no weekend at all', () => {
        assert.deepEqual(breakLength(line({ sat: '06:00-14:00' }), line({})), { days: 0, given: 0 });
        assert.deepEqual(breakLength(line({}), line({ sun: '06:00-14:00' })), { days: 0, given: 0 });
    });

    test('SPARE is not rest — you are on cover and can be called for any shift', () => {
        assert.deepEqual(breakLength(line({ sat: 'SPARE' }), line({})), { days: 0, given: 0 });
        assert.deepEqual(breakLength(line({}), line({ sun: 'SPARE' })), { days: 0, given: 0 });
        // …and a SPARE Friday does not extend the break either.
        assert.deepEqual(breakLength(line({ fri: 'SPARE' }), line({})), { days: 2, given: 1 });
    });

    test('a fully-rest line either side gives the maximum four-day break', () => {
        assert.deepEqual(breakLength(RD, RD), { days: 4, given: 3 });
    });
});

describe('boundaryRest', () => {
    test('measures Saturday finish to Sunday start across the line boundary', () => {
        // 22:00 Sat → 06:00 Sun = 8 hours. This is the turnaround runDesignChecks cannot see from
        // inside one line: it exists only because of which line follows which.
        assert.equal(boundaryRest(line({ sat: '14:00-22:00' }), line({ sun: '06:00-14:00' })), 8 * 60);
    });

    test('null when either side is not a timed duty', () => {
        assert.equal(boundaryRest(line({ sat: 'RD' }), line({ sun: '06:00-14:00' })), null);
        assert.equal(boundaryRest(line({ sat: 'SPARE' }), line({ sun: '06:00-14:00' })), null);
    });
});

describe('scoreOrder', () => {
    test('reports every figure whatever was optimised for', () => {
        const p = design();
        const s = scoreOrder(p, Object.keys(p));
        for (const k of ['gentleMean', 'gentleOver', 'gentleWorst', 'unmeasurable',
            'weekends', 'longWeekends', 'fourDayBreaks', 'contractedDaysGiven', 'shortBoundary']) {
            assert.ok(k in s, `missing ${k}`);
        }
    });

    test('unmeasurable steps are counted SEPARATELY, never folded into the mean', () => {
        const p = design();
        const s = scoreOrder(p, Object.keys(p));
        // 4 spare weeks × 2 boundaries each = 8 steps that cannot be measured.
        assert.equal(s.unmeasurable, 8);
        assert.ok(s.gentleMean > 0, 'the mean is over the MEASURABLE steps only');
    });

    test('it laps the rotation — the last line steps to the first', () => {
        const p = { 1: only({ mon: '06:00-14:00' }), 2: only({ mon: '07:00-15:00' }), 3: only({ mon: '20:00-23:00' }) };
        const s = scoreOrder(p, ['1', '2', '3']);
        // 3 → 1 is a −14h step; without wrapping it would be invisible.
        assert.equal(s.gentleWorst, 14 * 60);
    });
});

describe('cost', () => {
    const s = { gentleMean: 100, gentleOver: 2, gentleWorst: 300, unmeasurable: 0,
        weekends: 5, longWeekends: 1, fourDayBreaks: 0, contractedDaysGiven: 6, shortBoundary: 3 };

    test('an objective that is OFF contributes nothing at all', () => {
        assert.equal(cost(s, {}), 0);
    });

    test('each switch adds only its own term', () => {
        assert.equal(cost(s, { gentle: true }), 100 + 2 * 60);
        assert.equal(cost(s, { weekends: true }), -5 * 120);
        assert.equal(cost(s, { turnarounds: true }), 3 * 600);
    });

    test('long weekends penalise the SHORTFALL only, never rewarding without limit', () => {
        // Rewarding every long weekend would spend the whole rest budget on a few lines. "Now and
        // again" is the requirement.
        assert.equal(cost(s, { longWeekends: true }, 4), (4 - 1) * 240);
        assert.equal(cost({ ...s, longWeekends: 9 }, { longWeekends: true }, 4), 0);
        assert.equal(cost({ ...s, longWeekends: 4 }, { longWeekends: true }, 4), 0);
    });
});

describe('reorderLines', () => {
    test('every switch OFF leaves the order untouched', () => {
        // Re-sorting by an empty objective set would hand back a different design for no stated
        // reason, which is worse than doing nothing.
        const p = design();
        const r = reorderLines(p, { on: {} });
        assert.deepEqual(r.order, Object.keys(p));
        assert.equal(r.changed, false);
        assert.deepEqual(r.after, r.before);
    });

    test('gentle ON reduces the week-to-week movement', () => {
        const p = design();
        const r = reorderLines(p, { on: { gentle: true } });
        assert.ok(r.after.gentleMean < r.before.gentleMean,
            `expected improvement, got ${r.before.gentleMean} → ${r.after.gentleMean}`);
        assert.ok(r.after.gentleOver <= r.before.gentleOver);
    });

    test('weekends ON increases full weekends off', () => {
        const p = design();
        const r = reorderLines(p, { on: { weekends: true } });
        assert.ok(r.after.weekends >= r.before.weekends);
    });

    test('it is DETERMINISTIC — the same design and switches give the same order', () => {
        // A designer must be able to re-run it and get their design back, and two designers
        // comparing notes must be comparing the same thing.
        const p = design();
        const a = reorderLines(p, { on: { gentle: true, weekends: true } });
        const b = reorderLines(p, { on: { gentle: true, weekends: true } });
        assert.deepEqual(a.order, b.order);
    });

    test('reordering is FREE with respect to coverage — the multiset per day is identical', () => {
        // This is the fact that makes the whole feature safe: daily coverage is "how many lines work
        // shift X on day D", and permuting the rows cannot change it. If this ever fails, the reorder
        // has started moving cells rather than rows.
        const p = design();
        const r = reorderLines(p, { on: { gentle: true, weekends: true, longWeekends: true, turnarounds: true } });
        const out = applyOrder(p, r.order);
        for (const d of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
            const before = Object.values(p).map(row => row[d]).sort();
            const after  = Object.values(out).map(row => row[d]).sort();
            assert.deepEqual(after, before, `coverage changed on ${d}`);
        }
    });

    test('a spare week is never used to hide a harsh transition', () => {
        // The optimiser cannot score an unmeasurable step as good, so it gains nothing by parking a
        // spare week between the two most distant lines. `unmeasurable` is fixed by how many spare
        // lines exist, not by where they sit.
        const p = design();
        const r = reorderLines(p, { on: { gentle: true } });
        assert.equal(r.after.unmeasurable, r.before.unmeasurable);
    });

    test('applyOrder renumbers 1..N and keeps every line', () => {
        const p = design();
        const out = applyOrder(p, reorderLines(p, { on: { gentle: true } }).order);
        assert.deepEqual(Object.keys(out), Object.keys(p));
        const before = Object.values(p).map(r => JSON.stringify(r)).sort();
        const after  = Object.values(out).map(r => JSON.stringify(r)).sort();
        assert.deepEqual(after, before, 'every line survives, only the order moved');
    });

    test('too few lines to reorder is a no-op, not a crash', () => {
        assert.equal(reorderLines({}, { on: { gentle: true } }).changed, false);
        assert.equal(reorderLines({ 1: line({}) }, { on: { gentle: true } }).changed, false);
    });
});

describe('OBJECTIVES', () => {
    test('every objective the cost function reads has a labelled switch', () => {
        // A term in `cost` with no switch would be permanently on and invisible.
        const s = { gentleMean: 10, gentleOver: 1, gentleWorst: 10, unmeasurable: 0, weekends: 1,
            longWeekends: 0, fourDayBreaks: 0, contractedDaysGiven: 1, shortBoundary: 1 };
        for (const o of OBJECTIVES) {
            assert.notEqual(cost(s, { [o.key]: true }), 0, `${o.key} has no effect on the cost`);
            assert.ok(o.label && o.label.length > 3, `${o.key} needs a human label`);
        }
    });

    test('the gentle threshold is the same 2h the successive-start factor uses', () => {
        assert.equal(GENTLE_THRESHOLD_MINUTES, 120);
    });
});
