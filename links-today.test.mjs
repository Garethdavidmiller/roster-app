// @ts-check
/**
 * links-today.test.mjs — what the Links workspace reads from today's roster (links-today.js).
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs links-today.test.mjs   (part of `npm run test:unit`)
 *
 * The fatigue factors are MOCKED here, for the two things the baseline promises and a real run cannot
 * show: that each factor is quoted at ITS OWN row's threshold, never a typed one (the mock moves both
 * thresholds, as a rule change would), and that today's link is measured ONCE per roster however often
 * the panel asks (it ran on every painted cell). This replaces an e2e that patched links-fatigue.js on
 * the wire to the same end.
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

/** Every call the mocked assessFatigue receives. @type {Array<{patterns: any, lines: number}>} */
const calls = [];
let fail = false;
mock.module('./links-fatigue.js', {
    namedExports: {
        assessFatigue: (/** @type {any} */ patterns, /** @type {number} */ lines) => {
            calls.push({ patterns, lines });
            if (fail) throw new Error('boom');
            return { present: 7, results: [
                { code: 'FF11', status: 'n/a', value: 99, threshold: 99 },
                { code: 'FF11', status: 'present', value: 15, threshold: 12 },
                { code: 'FF15', status: 'clear', value: 2, threshold: 3 },
            ] };
        },
    },
});

const { shiftOptionLists, currentLinkBaseline } = await import('./links-today.js');
const { weeklyRoster } = await import('./roster-data.js');
const { DEFAULT_SHIFT_TIMES } = await import('./links-default-targets.js');

describe('today\'s link, for comparison', () => {
    test('each factor at its OWN threshold, the cycle\'s measured length, and what it is the link of', () => {
        const cycle = { a: { mon: '06:20-14:20' }, b: { mon: 'RD' }, c: { mon: 'RD' } };
        const base = currentLinkBaseline(cycle);
        assert.equal(base?.summary, "Today's link already features 7 of these factors on the main 3-line cycle — the link a new design would replace.");
        assert.match(base?.detail ?? '', /^Longest run without a two-day break: 15, against FF11's 12\. Longest run of consecutive early starts: 2, against FF15's 3\./);
        assert.equal(calls.at(-1)?.lines, 3, 'measured at its own length');
        assert.deepEqual(Object.keys(calls.at(-1)?.patterns), ['1', '2', '3'], 'numbered as the rotation is, in order');
    });
    test('measured ONCE per roster, however often it is asked', () => {
        const cycle = { a: { mon: 'RD' } };
        const before = calls.length;
        const first = currentLinkBaseline(cycle);
        for (let i = 0; i < 5; i++) assert.equal(currentLinkBaseline(cycle), first);
        assert.equal(calls.length - before, 1);
    });
    test('the default is today\'s MAIN roster, at its own length', () => {
        currentLinkBaseline();
        assert.equal(calls.at(-1)?.lines, Object.keys(weeklyRoster).length);
    });
    test('a baseline that cannot be measured is null — the row is left out, never shown wrong — and not retried', () => {
        fail = true;
        const cycle = { a: { mon: 'RD' } };
        const before = calls.length;
        assert.equal(currentLinkBaseline(cycle), null);
        assert.equal(currentLinkBaseline(cycle), null);
        assert.equal(calls.length - before, 1);
        fail = false;
    });
});

describe('the shift times offered', () => {
    test('the roster\'s own times, split early and late, sorted, with no rest, spare or night', () => {
        const { early, late } = shiftOptionLists({ w1: { mon: '14:00-22:00', tue: '06:20-14:20', wed: 'RD', thu: 'SPARE', fri: 'OFF', sat: '06:20-14:20', sun: '' } }, []);
        assert.deepEqual(early, ['06:20-14:20']);
        assert.deepEqual(late, ['14:00-22:00']);
    });
    test('the cell sheet adds the default table\'s, the paint bar\'s source excluded', () => {
        const { early, earlyOptions, lateOptions } = shiftOptionLists({ w1: { mon: '06:20-14:20' } }, ['07:00-15:00', '15:55-23:55']);
        assert.deepEqual(early, ['06:20-14:20'], 'the roster list is the roster\'s alone');
        assert.deepEqual(earlyOptions, ['06:20-14:20', '07:00-15:00']);
        assert.deepEqual(lateOptions, ['15:55-23:55']);
    });
    test('by default: today\'s main roster, and every default time offered in the sheet', () => {
        const { earlyOptions, lateOptions } = shiftOptionLists();
        for (const t of DEFAULT_SHIFT_TIMES) assert.ok([...earlyOptions, ...lateOptions].includes(t), t);
    });
});
