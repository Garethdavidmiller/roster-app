/**
 * leave-year.test.mjs — which year's allowance a January leave day comes out of (v25.18).
 * Run: node scripts/run-tests.mjs leave-year.test.mjs   (part of `npm run test:hygiene`)
 *
 * Organised by what a wrong answer COSTS. Reading a stored year the rules would never accept moves a
 * day of leave between two people's-worth of figures on the strength of a malformed record; dropping
 * the year on a rewrite quietly puts a moved day back on its own year, which is the defect the owner
 * was told this release would not have ("a re-save must keep the marker"); and offering the choice
 * outside January would let a member spend last year's allowance on any day of the year.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    LEAVE_YEAR_CHOICE, LEAVE_YEAR_FROM, leaveYearChoiceEnabled, isValidLeaveYear, carriedFrom,
    leaveYearOf, nextLeaveYear, canChooseLeaveYear, offeredJanuaries, carryLine,
} from './leave-year.js';

const AL = (over = {}) => ({ date: '2027-01-05', type: 'annual_leave', value: 'AL', ...over });

describe('the shape the rules accept, and nothing wider', () => {
    test('January, and exactly the year before', () => {
        assert.equal(isValidLeaveYear('2027-01-01', 2026), true);
        assert.equal(isValidLeaveYear('2027-01-31', 2026), true);
    });
    test('outside January it is never valid — 31 December and 1 February alike', () => {
        assert.equal(isValidLeaveYear('2026-12-31', 2025), false);
        assert.equal(isValidLeaveYear('2027-02-01', 2026), false);
    });
    test('its own year, two years back, or a year ahead are refused', () => {
        assert.equal(isValidLeaveYear('2027-01-05', 2027), false);
        assert.equal(isValidLeaveYear('2027-01-05', 2025), false);
        assert.equal(isValidLeaveYear('2027-01-05', 2028), false);
    });
    test('a string, a fraction, null and an impossible date are refused', () => {
        assert.equal(isValidLeaveYear('2027-01-05', '2026'), false);
        assert.equal(isValidLeaveYear('2027-01-05', 2026.5), false);
        assert.equal(isValidLeaveYear('2027-01-05', null), false);
        assert.equal(isValidLeaveYear('2027-01-32', 2026), false);
        assert.equal(isValidLeaveYear(undefined, 2026), false);
    });
});

describe('reading a record', () => {
    test('a moved January leave day comes out of the year before', () => {
        assert.equal(carriedFrom(AL({ leaveYear: 2026 }), '2027-01-05'), 2026);
        assert.equal(leaveYearOf(AL({ leaveYear: 2026 })), 2026);
    });
    test('with no year stored, a day counts against its own year — the default needs no record', () => {
        assert.equal(carriedFrom(AL(), '2027-01-05'), null);
        assert.equal(leaveYearOf(AL()), 2027);
        assert.equal(leaveYearOf(AL({ date: '2026-07-14' })), 2026);
    });
    test('a year the rules could never have stored is ignored, not trusted', () => {
        assert.equal(leaveYearOf(AL({ leaveYear: 2025 })), 2027);
        assert.equal(leaveYearOf(AL({ date: '2027-02-02', leaveYear: 2026 })), 2027);
        assert.equal(leaveYearOf(AL({ leaveYear: '2026' })), 2027);
    });
    test('only annual leave carries it — an absence with a stray year is its own year', () => {
        assert.equal(carriedFrom({ type: 'sick', leaveYear: 2026 }, '2027-01-05'), null);
        assert.equal(carriedFrom(null, '2027-01-05'), null);
    });
});

describe('a rewrite keeps the choice while the day stays leave', () => {
    test('leave over moved leave carries the year — a re-save cannot put it back', () => {
        assert.equal(nextLeaveYear(AL({ leaveYear: 2026 }), 'annual_leave', '2027-01-05'), 2026);
    });
    test('the day stops being leave: the choice goes with it', () => {
        assert.equal(nextLeaveYear(AL({ leaveYear: 2026 }), 'shift', '2027-01-05'), null);
        assert.equal(nextLeaveYear(AL({ leaveYear: 2026 }), 'sick', '2027-01-05'), null);
    });
    test('leave written over something else starts from the default — a new booking is a new decision', () => {
        assert.equal(nextLeaveYear({ type: 'sick', leaveYear: 2026 }, 'annual_leave', '2027-01-05'), null);
        assert.equal(nextLeaveYear(null, 'annual_leave', '2027-01-05'), null);
    });
});

describe('where the choice is offered', () => {
    test('a January day from 2027, never earlier and never outside January', () => {
        assert.equal(LEAVE_YEAR_FROM, 2027);
        assert.equal(canChooseLeaveYear('2027-01-04'), true);
        assert.equal(canChooseLeaveYear('2026-01-05'), false);
        assert.equal(canChooseLeaveYear('2027-02-01'), false);
    });
    test('this year\'s January and next year\'s — this one stays open after January ends', () => {
        assert.deepEqual(offeredJanuaries('2026-11-03'), [2027]);
        assert.deepEqual(offeredJanuaries('2027-01-10'), [2027, 2028]);
        assert.deepEqual(offeredJanuaries('2027-06-30'), [2027, 2028]);
        assert.deepEqual(offeredJanuaries('2028-01-02'), [2028, 2029]);
        assert.deepEqual(offeredJanuaries('2025-12-01'), []);
    });
    test('the switch is ON (v25.19, after the rules went live), and the test seam pins either state', () => {
        // It shipped OFF at v25.18 because the rules accepting the field had to deploy first (backend
        // first); v25.19 turned it on. This assertion is what turning it off again would change.
        assert.equal(LEAVE_YEAR_CHOICE, true);
        const g = /** @type {any} */ (globalThis);
        const was = g.__E2E;
        try {
            delete g.__E2E;
            assert.equal(leaveYearChoiceEnabled(), true);
            g.__E2E = { leaveYearChoice: false };
            assert.equal(leaveYearChoiceEnabled(), false);
            g.__E2E = { leaveYearChoice: 'no' };
            assert.equal(leaveYearChoiceEnabled(), true, 'only a real boolean overrides the constant');
        } finally {
            if (was === undefined) delete g.__E2E; else g.__E2E = was;
        }
    });
});

describe('the Calendar leave panel\'s line across New Year', () => {
    test('nothing crosses: no line at all', () => {
        assert.equal(carryLine({ year: 2026, carriedIn: 0, carriedOut: 0 }), null);
    });
    test('in, out, and both — singular and plural', () => {
        assert.equal(carryLine({ year: 2026, carriedIn: 2, carriedOut: 0 }), 'Includes 2 days in January 2027.');
        assert.equal(carryLine({ year: 2026, carriedIn: 1, carriedOut: 0 }), 'Includes 1 day in January 2027.');
        assert.equal(carryLine({ year: 2027, carriedIn: 0, carriedOut: 1 }), '1 day in January comes out of 2026’s allowance.');
        assert.equal(carryLine({ year: 2027, carriedIn: 0, carriedOut: 3 }), '3 days in January come out of 2026’s allowance.');
        assert.equal(carryLine({ year: 2027, carriedIn: 1, carriedOut: 2 }),
            'Includes 1 day in January 2028. 2 days in January come out of 2026’s allowance.');
    });
});
