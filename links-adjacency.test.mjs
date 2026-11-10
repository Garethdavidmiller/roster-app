import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    OBJECTIVES, GENTLE_THRESHOLD_MINUTES, DEFAULT_BLOCK_TARGET, lineStartProfile, weekStep,
    breakLength, boundaryRest, scoreOrder, cost, reorderLines, applyOrder,
    blockRuns, longestBlockOf, blockExcess, spareSpread, longestRunFor, runExcess,
} from './links-adjacency.js';
import { generatePatterns, generateLink, runDesignChecks, ROTATING_LINES, DEFAULT_MAX_RUN } from './links-design.js';
import { buildRosterTargets } from './links-seed.js';
import { buildDefaultTargets } from './links-default-targets.js';

/** A design with variety: several start times, spare weeks, and rest days. */
function design() {
    const waves = ['06:20-14:20', '07:00-15:00', '08:00-16:00', '11:00-19:00', '14:00-22:00', '15:55-23:55']
        .map(time => ({ time, weekday: 3, sat: 2, sun: 1 }));
    // `requireContract: false` for the same reason every construction fixture opts out (v20.99):
    // this table describes a rotation SHAPE — six waves, an even spread, enough worked days for the
    // break and turnaround maths to have something to measure — not a week's worth of work. It runs
    // well OVER the contracted week, which the generator has refused since v20.99, and trimming it
    // to fit would change which waves merge and how the lines block, i.e. the very things these
    // tests assert. The rule's own coverage lives in links-contract.test.mjs, including the static
    // guard that `links-app.js` never passes this flag.
    return generatePatterns({ slots: waves, spareLines: 4, lines: ROTATING_LINES, requireContract: false });
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

    test('every figure, counted by hand on four lines — and renumbering moves none of them', () => {
        // The search chooses an order by these figures and the status line reports them, through one
        // shared walk, so a miscount here is a wrong design AND a wrong report of it.
        //   1 → 2  Fri, Sat | Sun, Mon off      a four-day break, three contracted days given
        //   2 → 3  Sat | Sun, Mon off           three days, two given
        //   3 → 4  Sat | Sun off                two days, one given
        //   4 → 1  Sat 14:00-22:00 → Sun 06:00  no weekend, and 8 hours' rest
        // Start profiles 08:24, 09:00, 13:00 and 09:50, so the steps are 36, 240, 190 and 86 minutes.
        const late = '13:00-21:00';
        const p = {
            1: line({ sun: '06:00-14:00', fri: 'RD' }),
            2: line({ mon: 'RD' }),
            3: line({ mon: 'RD', tue: late, wed: late, thu: late, fri: late }),
            4: line({ sat: '14:00-22:00' }),
        };
        const order = ['1', '2', '3', '4'];
        const s = scoreOrder(p, order);
        assert.deepEqual(
            [s.gentleMean, s.gentleOver, s.gentleWorst, s.unmeasurable], [138, 2, 240, 0],
            'mean, steps over two hours, largest, unmeasurable');
        assert.deepEqual(
            [s.weekends, s.longWeekends, s.fourDayBreaks, s.contractedDaysGiven], [3, 2, 1, 3 + 2 + 1],
            'full weekends, long ones, four-day ones, contracted days given');
        assert.equal(s.shortBoundary, 1, 'the 8-hour Saturday-into-Sunday turnaround');
        assert.equal(scoreOrder(p, order, { minRestMinutes: 8 * 60 }).shortBoundary, 0, 'short means UNDER the minimum');
        assert.equal(scoreOrder(p, order, { minRestMinutes: 8 * 60 + 1 }).shortBoundary, 1);
        assert.deepEqual(s.blocks, [3, 1], 'longest first: 09:50, 08:24, 09:00 — then 13:00 alone');
        assert.equal(s.longestBlock, 3, '09:50 → 08:24 → 09:00');
        assert.equal(s.longestRun, 11, "line 4's Monday to Saturday, then line 1's Sunday to Thursday");
        assert.equal(scoreOrder(p, order, { maxRunTarget: 6 }).runExcess, 5 + 4 + 3 + 2 + 1,
            'that run of 11 counted from each of its starts, against 6');
        assert.deepEqual([s.spareExcess, s.spareMinGap, s.spareGaps], [0, 4, []]);
        // A step of exactly two hours is not MORE than two hours, ORR's FF19 figure.
        const pair = (/** @type {string} */ t) => ({ 1: only({ mon: '06:00-14:00' }), 2: only({ mon: t }) });
        assert.equal(scoreOrder(pair('08:00-16:00'), ['1', '2']).gentleOver, 0);
        assert.equal(scoreOrder(pair('08:01-16:01'), ['1', '2']).gentleOver, 2);

        // Every figure is a property of the CIRCLE — the optimiser's partition included, since the owner's
        // decision of 10 Nov 2026 (see `blockRuns`); it used to be walked from the first big step.
        for (const r of [['2', '3', '4', '1'], ['3', '4', '1', '2'], ['4', '1', '2', '3']]) {
            assert.deepEqual(scoreOrder(p, r), s, `renumbered from line ${r[0]}`);
        }
    });
});

describe('blockRuns — how many weeks in a row on much the same shift', () => {
    const at = (/** @type {string} */ t) => only({ mon: t, tue: t, wed: t, thu: t, fri: t });
    const rota = (/** @type {string[]} */ times) =>
        Object.fromEntries(times.map((t, i) => [String(i + 1), t === 'SP'
            ? { sun: 'SPARE', mon: 'SPARE', tue: 'SPARE', wed: 'SPARE', thu: 'SPARE', fri: 'SPARE', sat: 'SPARE' }
            : at(t)]));
    const runs = (/** @type {string[]} */ times) => {
        const p = rota(times);
        return blockRuns(p, Object.keys(p));
    };

    test('counts consecutive lines within the 2h band, lapping the rotation', () => {
        // Four mornings and two afternoons. The mornings are only contiguous BECAUSE the walk laps
        // (lines 5, 6, 1, 2) — without the lap this would read as two blocks of two.
        assert.deepEqual(runs(['06:00-14:00', '07:00-15:00', '15:00-23:00', '16:00-23:30',
            '06:30-14:30', '07:30-15:30']), [4, 2]);
    });

    test('a SPARE line is TRANSPARENT — it neither breaks a block nor counts towards one', () => {
        // The flattering reading would let a cover week split an 11-week block into two of five and
        // report the maximum as five. A cover week interrupts, but it does not change what you go
        // back to the week after.
        assert.deepEqual(runs(['06:00-14:00', '06:30-14:30', 'SP', '07:00-15:00', '15:00-23:00']), [3, 1]);
    });

    test('a whole rotation inside one band is ONE block, not a partition artefact', () => {
        assert.deepEqual(runs(['06:00-14:00', '06:30-14:30', '07:00-15:00', '07:30-15:30']), [4]);
        const p = rota(['06:00-14:00', '06:30-14:30', '07:00-15:00', '07:30-15:30']);
        assert.equal(longestBlockOf(p, Object.keys(p)), 4);
    });

    // ── THE REPORTED FIGURE IS A PROPERTY OF THE CIRCLE (whole-app review, Nov 2026) ──────────────
    // `blockRuns` walks from the first step over two hours in the order it is given, so where the
    // walk starts decides the partition. The figure a designer is told — `longestBlock`, on the
    // generator's status line — asks from every line instead.
    test('renumbering the rotation cannot move the longest block', () => {
        // Weeks starting 06:20, 08:30, 07:15, 09:30: blocks of 1 and 3 numbered this way, 1, 1 and 2
        // numbered from the 09:30 line, by the old reading. Lines 2–4 sit within 2h of 08:30 either way.
        const times = ['06:20-14:20', '08:30-17:00', '07:15-15:45', '09:30-18:00'];
        for (let s = 0; s < times.length; s++) {
            const p = rota([...times.slice(s), ...times.slice(0, s)]);
            assert.equal(scoreOrder(p, Object.keys(p)).longestBlock, 3, `numbered from line ${s + 1}`);
        }
        // …and on seeded random rotations, every cyclic renumbering gives one figure.
        let seed = 26;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const T = ['06:20-14:20', '07:15-15:45', '08:30-17:00', '09:30-18:00', '11:00-19:30', '13:30-22:00', '15:25-23:55', 'SP'];
        for (let i = 0; i < 60; i++) {
            const base = Array.from({ length: 12 }, () => T[Math.floor(rnd() * T.length)]);
            const seen = new Set();
            for (let s = 0; s < base.length; s++) {
                const p = rota([...base.slice(s), ...base.slice(0, s)]);
                seen.add(scoreOrder(p, Object.keys(p)).longestBlock);
            }
            assert.equal(seen.size, 1, `${base.join(' ')} reads ${[...seen].join(' or ')}`);
        }
    });

    test('a gradual drift is measured as the stretches it holds, not as one block', () => {
        // 06:00 → 12:00 → 06:00 in 90-minute steps: no single step is over two hours, so the
        // optimiser's walk has no boundary to start at. The longest stretch within 2h of its own
        // first week is the four around the peak: 10:30, 12:00, 10:30, 09:00.
        const p = rota(['06:00-14:00', '07:30-15:30', '09:00-17:00', '10:30-18:30', '12:00-20:00',
            '10:30-18:30', '09:00-17:00', '07:30-15:30']);
        assert.equal(longestBlockOf(p, Object.keys(p)), 4);
        assert.equal(scoreOrder(p, Object.keys(p)).longestBlock, 4);
    });

    test('the optimiser charges the block the figure names — a block that starts mid-wave included', () => {
        // A stretch can start at a line that follows its predecessor by less than two hours: 15:20,
        // 15:25, then 13:50, 13:10, 13:30, 15:15 — the last four are within 2h of 13:50. The old
        // partition began at the first big step, cut that block in two and never charged it, while the
        // status line reported it (the default, every switch on, at attempt 1).
        const p = rota(['15:20-23:50', '15:25-23:55', '13:50-22:20', '13:10-21:40', '13:30-22:00',
            '15:15-23:45', '06:20-14:20', '06:30-14:30']);
        const k = Object.keys(p);
        assert.equal(Math.max(...blockRuns(p, k)), 4, 'the partition the optimiser charges sees four in a row');
        assert.equal(scoreOrder(p, k).longestBlock, 4);
    });

    // ── THE OPTIMISER'S PARTITION IS A PROPERTY OF THE CIRCLE TOO (owner, 10 Nov 2026) ─────────────
    // It was walked from the first step over two hours in the order given, so `variety` charged one
    // rotation two ways depending on which line was numbered 1, and a gradual drift as one long block.
    test('renumbering the rotation cannot move the partition, and its longest block is the reported one', () => {
        let seed = 10;
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        const T = ['06:20-14:20', '07:15-15:45', '08:30-17:00', '09:30-18:00', '11:00-19:30', '13:30-22:00', '15:25-23:55', 'SP'];
        let differedBefore = 0;
        for (let i = 0; i < 80; i++) {
            const base = Array.from({ length: 12 }, () => T[Math.floor(rnd() * T.length)]);
            const seen = new Set();
            for (let s = 0; s < base.length; s++) {
                const p = rota([...base.slice(s), ...base.slice(0, s)]);
                const k = Object.keys(p);
                const b = blockRuns(p, k);
                seen.add(b.join(','));
                if (b.length) assert.equal(b[0], longestBlockOf(p, k), `${base.join(' ')}: the charged and the reported block differ`);
                assert.deepEqual(b, [...b].sort((x, y) => y - x), `${base.join(' ')}: the partition is not longest first`);
            }
            assert.equal(seen.size, 1, `${base.join(' ')} partitions ${[...seen].join(' or ')}`);
            if (base.some((t, j) => t !== base[(j + 1) % base.length])) differedBefore++;
        }
        assert.ok(differedBefore > 40, 'premise: the rotations tried are not all one shift');
    });

    test('a gradual drift is charged as the stretches it holds, not as one long block', () => {
        // 06:00 → 12:00 → 06:00 in 90-minute steps: no step over two hours, so the old walk had nowhere
        // to start and charged all eight weeks as one block.
        const p = rota(['06:00-14:00', '07:30-15:30', '09:00-17:00', '10:30-18:30', '12:00-20:00',
            '10:30-18:30', '09:00-17:00', '07:30-15:30']);
        const b = blockRuns(p, Object.keys(p));
        assert.equal(b[0], 4, 'the four round the peak');
        assert.equal(b.reduce((x, y) => x + y, 0), 8, 'every week in exactly one block');
    });

    test('the excess is summed over every over-long block, not just the worst', () => {
        // A flat "longest block" gives the optimiser no gradient: two 8-week blocks score the same
        // as one, so fixing either looks free and it fixes neither.
        assert.equal(blockExcess([8, 4, 2], 3), 5 + 1);
        assert.equal(blockExcess([3, 2, 1], 3), 0);
    });

    test('the default target is the live roster\'s own figure', () => {
        assert.equal(DEFAULT_BLOCK_TARGET, 3);
    });

    test('the RAW generated design blocks badly — the reorder is what fixes it, not the generator', () => {
        // Pinning the division of labour, because interleaving the waves inside the generator was
        // tried at v19.60 and reverted: it took the raw output from 11 blocks to 2 but introduced
        // short turnarounds (a late wave's 23:55 Saturday beside a morning wave's 06:20 Sunday) and
        // cost two long weekends, while the reorder reaches a longest block of 3 either way.
        //
        // So the generator owns the SHAPE and `links-adjacency` owns the ORDER, and this test fails
        // if someone re-adds an interleave here — which would look like an improvement in isolation.
        const p = design();
        const s = scoreOrder(p, Object.keys(p));
        assert.ok(s.longestBlock > DEFAULT_BLOCK_TARGET,
            'if the raw generator is already varied, the interleave is back — read the note in links-design.js');
    });
});

describe('cost', () => {
    const s = { gentleMean: 100, gentleOver: 2, gentleWorst: 300, unmeasurable: 0,
        weekends: 5, longWeekends: 1, fourDayBreaks: 0, contractedDaysGiven: 6, shortBoundary: 0,
        blocks: [8, 4, 2], longestBlock: 8,
        longestRun: 9, runExcess: 12, spareExcess: 0, spareMinGap: 4, spareGaps: [5, 5, 5, 4, 5] };

    test('a SWITCH that is off contributes nothing at all', () => {
        assert.equal(cost(s, {}), 0);
    });

    test('each switch adds only its own term', () => {
        assert.equal(cost(s, { gentle: true }), 100 + 2 * 60);
        assert.equal(cost(s, { weekends: true }), -5 * 120);
        assert.equal(cost(s, { maxRun: true }), 12 * 40);
    });

    test('REST ACROSS THE WEEK BOUNDARY is charged with every switch off — a gate, not an objective', () => {
        // It was a switch until v25.06. Minimum rest is a GATE the generator applies before the
        // reorder (v21.11), so a switch that let the reorder ignore it was a switch for undoing the
        // gate: unticked, 45 of 64 switch-and-attempt combinations on the default design came back
        // with a Saturday finish under 12 hours before the next line's Sunday start.
        assert.equal(cost({ ...s, shortBoundary: 3 }, {}), 3 * 600);
        assert.ok(!OBJECTIVES.some(o => /** @type {string} */ (o.key) === 'turnarounds'),
            'a checkbox that turns off minimum rest is back — the generator refuses short rest, and so must the reorder');
    });

    test('the SPARE SPREAD is charged with every switch off — it is a constraint, not an objective', () => {
        // The one term that is not a switch (v20.02). `generateLink` spreads the cover weeks evenly
        // around the wheel and the reorder used to undo that, because clustering them happened to
        // help the objectives it WAS told about — measured, it took FF11 from 9 to 14 on the
        // generator's own output. Every other term here is a preference somebody might not want;
        // "cluster the spare weeks" is not a design anyone asks for.
        assert.equal(cost({ ...s, spareExcess: 3 }, {}), 3 * 3000);

        // IT MUST OUTBID WHAT A SWITCH CAN ACTUALLY PAY, NOT ITS PER-UNIT WEIGHT.
        //
        // This assertion used to compare ONE unit of spread against ONE unit of block excess (500
        // against 400) and conclude the priority was settled. It was not: these terms accumulate,
        // and a design carrying two units of block excess bid 800 — so `variety` won, and the
        // shipped default came back with the cover weeks unevenly spread. The per-unit test passed
        // throughout. Comparing rates between terms that accumulate at different rates is the whole
        // mistake, and asserting it that way is what made it look answered.
        //
        // So the comparison is one unit of spread against EVERY switch getting one unit
        // worse at once — the marginal weights read back through `cost` itself rather than restated
        // here, so a re-weighted objective is caught instead of silently agreeing with a copy.
        const flat = { ...s, spareExcess: 0, blocks: [1], longestBlock: 1, gentleMean: 0,
            gentleOver: 0, weekends: 4, longWeekends: 4, shortBoundary: 0, runExcess: 0 };
        /** One unit worse on exactly the named objective, everything else held flat. */
        const worseBy = { variety: { blocks: [2], longestBlock: 2 }, maxRun: { runExcess: 1 },
            gentle: { gentleOver: 1 }, weekends: { weekends: 3 },
            longWeekends: { longWeekends: 3 } };
        const everySwitchOneUnitWorse = OBJECTIVES.reduce((total, o) => total
            + cost({ ...flat, ...worseBy[o.key] }, { [o.key]: true })
            - cost(flat, { [o.key]: true }), 0);

        const oneClustered = cost({ ...flat, spareExcess: 1 }, {}) - cost(flat, {});
        assert.ok(oneClustered > everySwitchOneUnitWorse,
            `one unevenly-placed cover week (${oneClustered}) must outweigh every objective `
            + `slipping a unit at once (${everySwitchOneUnitWorse}) — otherwise the optimiser trades `
            + 'the spread away, the one move here that makes a design worse than the one it was handed');

        // AND THAT IS STILL ONLY NECESSARY, NOT SUFFICIENT — the switches accumulate without limit,
        // so no fixed margin proves the spread always wins. The guarantee is empirical and lives in
        // 'a REAL generated design comes back evenly spread, whatever the switches'. This assertion
        // catches a re-weighting; that one catches the behaviour. Do not delete either for the other.
    });

    test('a scorecard without the new fields costs a number, not NaN', () => {
        // `cost` is exported and takes a plain object, so a caller (or an older stored scorecard)
        // can arrive without `spareExcess`/`runExcess`. Unguarded these produced NaN, which silently
        // makes EVERY order compare equal and turns the optimiser into a no-op that still reports
        // `changed`. Fail loud is not available here; a defined zero is.
        const bare = { gentleMean: 10, gentleOver: 0, weekends: 1, longWeekends: 1, shortBoundary: 0,
            blocks: [2], longestBlock: 2 };
        assert.equal(cost(/** @type {any} */ (bare), {}), 0);
        assert.ok(Number.isFinite(cost(/** @type {any} */ (bare), { maxRun: true, variety: true })));
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
        const r = reorderLines(p, { on: { gentle: true, weekends: true, longWeekends: true } });
        const out = applyOrder(p, r.order);
        for (const d of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
            const before = Object.values(p).map(row => row[d]).sort();
            const after  = Object.values(out).map(row => row[d]).sort();
            assert.deepEqual(after, before, `coverage changed on ${d}`);
        }
    });

    test('gentle ALONE re-blocks the rotation, and variety is what stops it', () => {
        // The v19.59 shape fix settled each week and then laid the waves out in solid blocks, so a
        // person got 11 straight weeks of mornings and 11 of afternoons — "a bit excessive and would
        // be unpopular" (owner). Turning gentle on made it worse, because the smallest possible
        // week-to-week step is no step at all: minimising it IS a block. The generator now deals the
        // waves interleaved, but the reorder can undo that, so this pins BOTH halves.
        const p = design();
        const gentleOnly = reorderLines(p, { on: { gentle: true } });
        const withVariety = reorderLines(p, { on: { gentle: true, variety: true } });
        assert.ok(gentleOnly.after.longestBlock > withVariety.after.longestBlock,
            `gentle alone gave ${gentleOnly.after.longestBlock}, with variety ${withVariety.after.longestBlock}`);
        assert.ok(withVariety.after.longestBlock <= DEFAULT_BLOCK_TARGET,
            `longest block ${withVariety.after.longestBlock} exceeds the target ${DEFAULT_BLOCK_TARGET}`);
    });

    test('variety costs week-to-week movement, and the scorecard says so', () => {
        // The two are opposite ends of one dial. The tool's job is to show the price, not to hide it
        // — `scoreOrder` reports both figures whichever was optimised for.
        const p = design();
        const gentleOnly = reorderLines(p, { on: { gentle: true } });
        const withVariety = reorderLines(p, { on: { gentle: true, variety: true } });
        assert.ok(withVariety.after.gentleMean >= gentleOnly.after.gentleMean,
            'variety cannot be free — it must cost some week-to-week movement');
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
        // A term in `cost` with no switch would be permanently on and invisible — except the two that
        // are on purpose (the spare spread, and rest across the week boundary), which the
        // objectives note on the generator card states in words because they have no checkbox.
        const s = { gentleMean: 10, gentleOver: 1, gentleWorst: 10, unmeasurable: 0, weekends: 1,
            longWeekends: 0, fourDayBreaks: 0, contractedDaysGiven: 1, shortBoundary: 1,
            blocks: [9], longestBlock: 9,
            longestRun: 9, runExcess: 8, spareExcess: 0, spareMinGap: 4, spareGaps: [5, 5] };
        for (const o of OBJECTIVES) {
            assert.notEqual(cost(s, { [o.key]: true }), 0, `${o.key} has no effect on the cost`);
            assert.ok(o.label && o.label.length > 3, `${o.key} needs a human label`);
        }
        // …and the fixture must EXERCISE every term, or a switch wired to a field the scorecard
        // happens not to carry would pass by scoring 0 twice. `maxRun` was added at v20.02 and this
        // fixture had no `runExcess`, so it failed here rather than silently — which is the test
        // doing its job, and worth keeping true for the next one.
        for (const o of OBJECTIVES) {
            assert.notEqual(cost(s, { [o.key]: true }), cost(s, {}),
                `${o.key} scores the same on and off — the fixture does not exercise its term`);
        }
    });

    test('the gentle threshold is the same 2h the successive-start factor uses', () => {
        assert.equal(GENTLE_THRESHOLD_MINUTES, 120);
    });
});

// ── THE COVER WEEKS MUST STAY SPREAD, WHATEVER ELSE THE REORDER IS DOING (v20.02) ───────────────
//
// `generateLink` reserves whole spare lines and spreads them evenly around the wheel. The reorder
// then ran over that with no objective that cared — and clustering them HELPED the objectives it did
// care about, so it clustered them. Measured on the live seed at 24 lines / 5 spare: the generator
// placed them at 1, 6, 11, 15, 20 (gaps 5, 5, 5, 4, 5) and the reorder returned 1, 4, 5, 12, 16
// (gaps 9, 3, 1, 7, 4) with two ADJACENT. Two adjacent spare weeks chain — the first week's four
// duties at its end, the second's four at its start — which took FF11 from 9 to 14, past the
// threshold the fatigue panel reports against, with nothing on screen to say the order had done it.
describe('spare spread', () => {
    /** A design with `spares` cover weeks placed evenly among `lines` lines. */
    const spread = (lines, spares) => {
        /** @type {Record<string, any>} */ const p = {};
        const every = Math.round(lines / spares);
        for (let i = 1; i <= lines; i++) {
            p[String(i)] = (i - 1) % every === 0
                ? line({ sun: 'SPARE', mon: 'SPARE', tue: 'SPARE', wed: 'SPARE', thu: 'SPARE', fri: 'SPARE', sat: 'SPARE' })
                : line({});
        }
        return p;
    };

    test('an even spread scores zero excess; clustering scores more the tighter it is', () => {
        const p = spread(20, 4);
        const keys = Object.keys(p).sort((a, b) => Number(a) - Number(b));
        assert.equal(spareSpread(p, keys).excess, 0, 'the even placement must be the free one');

        // Move one cover week next to another: adjacency is the worst case and must cost most.
        const clustered = [...keys];
        const spareIdx = keys.filter(k => p[k].mon === 'SPARE');
        const moved = clustered.splice(clustered.indexOf(spareIdx[2]), 1)[0];
        clustered.splice(clustered.indexOf(spareIdx[0]) + 1, 0, moved);
        assert.ok(spareSpread(p, clustered).excess > 0, 'an adjacency must cost something');
        assert.equal(spareSpread(p, clustered).minGap, 1);
    });

    test('a cover week whose Sunday is a rest day is still a cover week', () => {
        // Whole-app review, Oct 2026 — the one rule `isCoverWeek` states for the whole workspace.
        const p = spread(20, 4);
        const keys = Object.keys(p).sort((a, b) => Number(a) - Number(b));
        p['1'] = { ...p['1'], sun: 'RD' };
        assert.equal(spareSpread(p, keys).gaps.length, 4, 'all four cover weeks are seen');
    });

    test('fewer than two cover weeks has nothing to spread', () => {
        assert.equal(spareSpread(spread(10, 1), Object.keys(spread(10, 1))).excess, 0);
        assert.equal(spareSpread({}, []).excess, 0);
    });

    test('the reorder does not cluster cover weeks that arrived spread', () => {
        // The regression itself, driven through the real optimiser with the switches that caused it.
        const p = spread(20, 4);
        const before = spareSpread(p, Object.keys(p).sort((a, b) => Number(a) - Number(b)));
        const r = reorderLines(p, { on: { gentle: true, weekends: true, longWeekends: true } });
        const after = spareSpread(p, r.order);
        assert.equal(before.excess, 0, 'premise: they started spread');
        assert.equal(after.excess, 0,
            `the reorder clustered the cover weeks — gaps ${after.gaps.join(',')}. They are the one `
            + 'thing the generator guarantees and the reorder must not undo.');
        assert.ok(after.minGap > 1, 'no two cover weeks may end up adjacent');
    });

    // THE TEST ABOVE PASSED ON THE CODE THAT SHIPPED THE BUG THIS ONE IS FOR.
    //
    // Its fixture is `line({})` repeated — every working line identical — so the optimiser has
    // nothing to tell them apart and any order is as good as any other. It pins that an even spread
    // is not actively destroyed. It cannot see the case that matters: a REAL design, where the
    // objectives have something to gain by moving a cover week, and the spread has to WIN that.
    //
    // At the original weight of 500 it did not. `variety` accumulates 400 per unit of block excess,
    // so two units outbid one unit of spread, and the shipped default came back 7,6,5,6 where
    // 6,6,6,6 was reachable. These are the three shapes that measured non-zero then — the shipped
    // 24/4 with everything on, and the two that were worst — driven through the real generator and
    // the real optimiser rather than a fixture standing in for them.
    test('a REAL generated design comes back evenly spread, whatever the switches', () => {
        const { slots } = buildRosterTargets();
        const every = Object.fromEntries(OBJECTIVES.map(o => [o.key, true]));

        for (const [lines, spareLines] of [[24, 4], [20, 4], [24, 6]]) {
            // `requireContract: false`: since v20.98 the generator refuses targets that cannot pay the
            // contracted week, and the roster seed cannot at this rotation. These tests are about the
            // ORDER of the lines, which is free with respect to hours — see links-contract.test.mjs.
            const gen = generateLink({ slots, lines, spareLines , requireContract: false });
            assert.ok(gen?.patterns, `premise: ${lines}/${spareLines} produces a design at all`);

            for (const [label, on] of [['every switch on', every], ['variety alone', { variety: true }]]) {
                const r = reorderLines(gen.patterns, { on, maxRunTarget: DEFAULT_MAX_RUN });
                const after = spareSpread(applyOrder(gen.patterns, r.order),
                    r.order.map((_, i) => String(i + 1)));
                const where = `${lines} lines / ${spareLines} cover weeks, ${label}`;
                // Reachable for EVERY shape, because spareSpread targets floor(lines / spares) —
                // gaps as equal as the rotation allows are then always at or above it. So this is a
                // constraint the optimiser can always satisfy, never a residual it is chasing.
                assert.equal(after.excess, 0,
                    `${where}: cover weeks came back uneven — gaps ${after.gaps.join(',')}`);
                assert.ok(after.minGap > 1, `${where}: two cover weeks ended up adjacent`);
            }
        }
    });
});

// ── THE RUN CAP (v20.02) ────────────────────────────────────────────────────────────────────────
describe('maxRun', () => {
    test('a spare week counts as FOUR worked days and its Sunday, not seven', () => {
        // The single most repeatable mistake in this app — counting 7 reported the live main roster
        // at 15 consecutive days against a true 9. `longestRunFor` delegates to `worstCaseWorkedRun`
        // rather than re-deriving it, and this pins that it still does.
        /** @type {Record<string, any>} */ const p = {};
        const S = { sun: 'SPARE', mon: 'SPARE', tue: 'SPARE', wed: 'SPARE', thu: 'SPARE', fri: 'SPARE', sat: 'SPARE' };
        const R = { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        p['1'] = line(S); p['2'] = line(R);
        assert.equal(longestRunFor(p, ['1', '2']), 5, 'one cover week alone is its Sunday and four duties');
        p['2'] = line(S);
        assert.equal(longestRunFor(p, ['1', '2']), 9, 'two adjacent cover weeks legitimately chain');
    });

    test('the gradient is SUPERLINEAR in run length — that is what makes it climbable', () => {
        // A maximum is a plateau: almost every pair swap leaves it unchanged, so the optimiser has
        // nothing to follow. Measured before this was summed, it stalled at 8 on the live seed where
        // a random search found 6.
        //
        // Summing over every START is what fixes it: a run of 14 also shows up as a 13 from the next
        // day, a 12 from the one after, and so on, so a long run is charged many times over. The
        // property to pin is that DISPROPORTION — a run twice as far over the target must cost far
        // more than twice as much, or a swap that shortens one long run looks no better than one
        // that shortens a short one.
        const W = '09:00-17:00';
        const worked = { sun: W, mon: W, tue: W, wed: W, thu: W, fri: W, sat: W };
        const rest = { sun: 'RD', mon: 'RD', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
        const runOf = (/** @type {number} */ workedLines) => {
            /** @type {Record<string, any>} */ const p = {};
            for (let i = 1; i <= workedLines; i++) p[String(i)] = line(worked);
            p[String(workedLines + 1)] = line(rest);
            return { p, keys: Object.keys(p) };
        };
        const one = runOf(1), two = runOf(2);
        assert.equal(longestRunFor(one.p, one.keys), 7);
        assert.equal(longestRunFor(two.p, two.keys), 14);

        const e1 = runExcess(one.p, one.keys, 6);   // one start over target
        const e2 = runExcess(two.p, two.keys, 6);   // eight starts over target, by 1..8
        assert.equal(e1, 1);
        assert.equal(e2, 36, '8+7+6+5+4+3+2+1');
        assert.ok(e2 > e1 * 8, 'doubling the run must cost far more than double — the disproportion IS the gradient');

        // And nothing at or under the target costs anything, so the optimiser stops once the cap is
        // met rather than trading other objectives away to minimise a number nobody asked to shrink.
        assert.equal(runExcess(one.p, one.keys, 7), 0);
        assert.equal(runExcess(one.p, one.keys, 14), 0);
    });

    test('switching it on shortens the longest run', () => {
        const p = design();
        const before = longestRunFor(p, Object.keys(p).sort((a, b) => Number(a) - Number(b)));
        const r = reorderLines(p, { on: { maxRun: true }, maxRunTarget: 6 });
        assert.ok(r.after.longestRun <= before,
            `expected no worse, got ${before} → ${r.after.longestRun}`);
    });

    test('on its own it aims at the target it is GIVEN, and leaves an order that already meets it', () => {
        // On the shipped default design. The search scores candidates through its own call, so a
        // target that reached `scoreOrder` but not the search would still report correctly while
        // choosing an order for some other number.
        const t = buildDefaultTargets();
        const p = generateLink({ slots: t.slots, spareLines: t.spareLines, lines: ROTATING_LINES }).patterns;
        const keys = Object.keys(p).sort((a, b) => Number(a) - Number(b));
        const handed = scoreOrder(p, keys).longestRun;
        assert.ok(handed > 8, `premise: the order as generated has a run the cap can shorten (${handed})`);
        for (const target of [6, 7, 8]) {
            const r = reorderLines(p, { on: { maxRun: true }, maxRunTarget: target });
            assert.ok(r.after.longestRun <= target, `asked for ${target}, reached ${r.after.longestRun}`);
        }
        // "No more than N", not "as few as possible": nothing to gain, so nothing moves.
        assert.equal(reorderLines(p, { on: { maxRun: true }, maxRunTarget: handed }).changed, false);
    });
});

// ── ATTEMPTS — deterministic per press, not per se (v20.07) ─────────────────────────────────────
//
// The reorder was flatly deterministic, which made the Generate button a dead end: pressing it
// again returned the identical design (the owner's report). Attempts keep what the determinism was
// FOR — reproducibility — while letting repeat presses explore: the seed is the attempt number,
// never the clock or Math.random, so "design 3" is the same design on every device.
describe('reorderLines attempts', () => {
    const { slots } = buildRosterTargets();
    const real = generateLink({ slots, lines: ROTATING_LINES, spareLines: 4 , requireContract: false }).patterns;
    const every = Object.fromEntries(OBJECTIVES.map(o => [o.key, true]));
    const run = (attempt) => reorderLines(real, { on: every, maxRunTarget: DEFAULT_MAX_RUN, attempt });

    test('the same attempt always returns the same order — a variant is recoverable', () => {
        for (const a of [0, 2, 5]) {
            assert.deepEqual(run(a).order, run(a).order, `attempt ${a} must be reproducible`);
        }
    });

    test('an omitted attempt is attempt 0, the canonical design every doc figure was measured on', () => {
        assert.deepEqual(
            reorderLines(real, { on: every, maxRunTarget: DEFAULT_MAX_RUN }).order,
            run(0).order);
    });

    test('advancing the attempt actually explores — different designs, not the same one renumbered', () => {
        // Measured on the live seed before pinning: attempts 0–4 produce five distinct orders.
        // ≥ 4 is asserted rather than 5 to leave room for the constraint filter's legitimate
        // fallback (attempt 6 on this seed collapses to design 1, and says so in the UI) without
        // ever letting "explore" degrade to renumbering one design.
        const seen = new Set([0, 1, 2, 3, 4].map(a => run(a).order.join(',')));
        assert.ok(seen.size >= 4, `expected ≥4 distinct orders across attempts 0–4, got ${seen.size}`);
    });

    test('NO attempt may break the even cover spread — a candidate that does is not a candidate', () => {
        // The teeth for the filter, and it is not hypothetical: before the filter existed, attempt
        // 6's three seeded starts all converged into minima with gaps 6,7,6,5 — the w=3000 weight
        // made unevenness expensive, but a local search can only pay a price it can find a path
        // away from. The filter drops such candidates and falls back to the canonical design; this
        // sweep covers attempt 6 specifically so removing the filter fails here, not on a phone.
        for (let a = 0; a <= 7; a++) {
            const r = run(a);
            const p = applyOrder(real, r.order);
            const sp = spareSpread(p, r.order.map((_, i) => String(i + 1)));
            assert.equal(sp.excess, 0, `attempt ${a}: cover weeks uneven — gaps ${sp.gaps.join(',')}`);
            assert.ok(sp.minGap > 1, `attempt ${a}: two cover weeks adjacent`);
        }
    });

    test('the spread is a FILTER as well as a weight — a start the search cannot repair is refused', () => {
        // The sweep above passes on the weight alone at this rotation length: the 2-opt finds an even
        // spread every time, so deleting the filter changed nothing it could see (whole-app review,
        // Nov 2026). With no improvement passes a shuffled start is scored as it lies, and a random
        // arrangement of the cover weeks is almost never even, so only the filter can keep the
        // promise. Each refused attempt falls back to the canonical design, and says so (`attempt` 0).
        let fellBack = 0;
        for (let a = 1; a <= 6; a++) {
            const r = reorderLines(real, { on: every, maxRunTarget: DEFAULT_MAX_RUN, attempt: a, passes: 0 });
            if (r.attempt === 0) fellBack++;
            const p = applyOrder(real, r.order);
            const sp = spareSpread(p, r.order.map((_, i) => String(i + 1)));
            assert.equal(sp.excess, 0, `attempt ${a}, no passes: cover weeks uneven — gaps ${sp.gaps.join(',')}`);
        }
        assert.ok(fellBack > 0, 'premise: some attempt had no even start, so the filter is what decided it');
    });
});

// ── MINIMUM REST SURVIVES THE REORDER (v25.06) ──────────────────────────────────────────────────
// The generator repairs every short turnaround and REFUSES what it cannot repair — a gate since
// v21.11 — and only THEN does the reorder choose which line follows which. With the old "Rest across
// the week boundary" switch unticked, nothing stopped it putting a 23:55 Saturday finish in front of
// a 07:15 Sunday start. Asserted through `runDesignChecks`, the check the Design checks card shows,
// on the generator's real output rather than on a scorecard field.
describe('minimum rest survives the reorder', () => {
    const { slots, spareLines } = buildDefaultTargets();
    const real = generateLink({ slots, spareLines, lines: ROTATING_LINES }).patterns;
    const breaches = (/** @type {string[]} */ order) => runDesignChecks(applyOrder(real, order)).turnarounds
        .map(t => `${t.fromLine}${t.fromDay}→${t.toLine}${t.toDay} ${t.restMinutes}min`);

    test('premise: the generator hands over a design with no short turnaround', () => {
        assert.deepEqual(breaches(Object.keys(real)), []);
    });

    test('no switch, and no attempt, brings one back', () => {
        // Every single switch plus two pairs, attempts 0–2: before v25.06 every one of these
        // configurations produced a breach somewhere in that range.
        const configs = [...OBJECTIVES.map(o => ({ [o.key]: true })),
            { variety: true, gentle: true }, { weekends: true, longWeekends: true }];
        let handedBack = 0;
        for (const on of configs) {
            for (let attempt = 0; attempt <= 2; attempt++) {
                const r = reorderLines(real, { on, attempt });
                assert.deepEqual(breaches(r.order), [], `${Object.keys(on).join(' + ')}, attempt ${attempt}`);
                if (!r.changed) handedBack++;
            }
        }
        // AND IT IS REACHED BY REORDERING, NOT BY GIVING UP. The filter alone would also pass the
        // assertion above — by handing back the generator's own order, objectives ignored. The rest
        // term in `cost` is what lets the search find a rested order instead. Measured: one of these
        // 21 runs comes back as handed (long weekends alone, attempt 0, where the greedy already
        // agrees with the generator); with the rest term made conditional again, seven do.
        assert.ok(handedBack <= 2, `${handedBack} of 21 runs came back as handed — the search is giving up, not resting`);
    });

    test('a weight can be outbid, so the rest rule is a FILTER as well — and the order it was handed is kept', () => {
        // Two waves, every late line finishing 23:55 on Saturday and every early line starting
        // 06:20 on Sunday, so any late→early step is a short turnaround. Handed as eight earlies
        // then eight lates — one short step, at the wrap — `variety` would happily alternate them in
        // threes for three short steps, because two units of block excess outbid one turnaround.
        // The filter refuses that, and attempt 0 failing it keeps the order handed rather than
        // shipping the breach (which the line before v25.06 did).
        const wk = (/** @type {string} */ t) => ({ sun: t, mon: t, tue: t, wed: t, thu: t, fri: 'RD', sat: t });
        /** @type {Record<string, any>} */ const p = {};
        for (let i = 1; i <= 16; i++) p[String(i)] = wk(i <= 8 ? '06:20-14:20' : '15:55-23:55');
        assert.equal(scoreOrder(p, Object.keys(p)).shortBoundary, 1, 'premise: one short step, at the wrap');
        for (let attempt = 0; attempt <= 2; attempt++) {
            const r = reorderLines(p, { on: { variety: true }, attempt });
            assert.ok(r.after.shortBoundary <= 1,
                `attempt ${attempt}: ${r.after.shortBoundary} short steps — more than the design was handed`);
            assert.deepEqual(r.order, Object.keys(p), `attempt ${attempt}: the handed order is kept`);
        }
    });

    test('the minimum is the generator\'s own MIN_REST_MINUTES — no Links module that applies or states it types it', () => {
        // The day the constant moves, a typed copy keeps the old figure: the reorder would filter on
        // it and could put back a Saturday-into-Sunday turnaround the generator's gate had repaired,
        // and the panels would state a minimum nobody applies (links-analysis-14). Both are 720
        // today, so no behaviour can tell them apart, which is why this reads the source. Comments
        // may quote the figure; code may not. FF5, FF10 and FF13 keep "12h" in links-fatigue.js:
        // they quote the ORR's sheet, not the company minimum, so that module is not read here.
        for (const f of ['links-adjacency.js', 'links-analysis.js', 'links-compare.js']) {
            const code = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|\s)\/\/.*$/gm, '$1');
            assert.doesNotMatch(code, /\b12\s*\*\s*60\b|\b720\b|\b12 hours\b|\b12h\b/, `${f} writes the minimum rest down`);
        }
    });
});
