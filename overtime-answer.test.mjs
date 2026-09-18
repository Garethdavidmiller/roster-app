/**
 * overtime-answer.test.mjs — the working copy's transitions on the Overtime form.
 * Run: node --test overtime-answer.test.mjs   (part of `npm run test:hygiene`)
 *
 * Three independent statements share one answer object — the overtime mode, the willingness tick
 * and the Sunday-release request — and an external review of v23.85 found two transitions that
 * forgot one of the others: the request created a "Not available" the member never gave, and a mode
 * change dropped the request. Every case here is a pair of statements and the transition between
 * them, asked "what did you touch that you were not asked to?"
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { withMode, withFullTwelve, withRelease } from './overtime-answer.js';
import { dayUnfinished } from './overtime-format.js';

const SHIFT = { start: '07:00', end: '15:00' };
const MODES = ['unavailable', 'all_day', 'twelve_hours', 'before', 'after', 'before_after', 'custom'];

describe('the Sunday-release request stands alone (review of v23.85, bug 1)', () => {
    test('asking alone does NOT answer the overtime question — the day stays unfinished', () => {
        const a = withRelease(undefined, true);
        assert.deepEqual(a, { releaseRequested: true });
        assert.equal(a.mode, undefined, 'no mode was invented');
        assert.equal(dayUnfinished(a), true, 'the completeness check must still count this Sunday');
    });

    test('and it never becomes "unavailable" underneath — the one answer this feature may not invent', () => {
        const a = withRelease(undefined, true);
        assert.notEqual(a.mode, 'unavailable');
        // The old code's exact shape, pinned as the thing that must not come back.
        assert.notDeepEqual(a, { mode: 'unavailable', releaseRequested: true });
    });

    test('unticking a request-only day returns the day to exactly unanswered', () => {
        assert.equal(withRelease({ releaseRequested: true }, false), undefined);
    });

    test('unticking leaves the availability answer untouched', () => {
        const before = { mode: 'after', from: '15:00', fullTwelve: true, releaseRequested: true };
        assert.deepEqual(withRelease(before, false), { mode: 'after', from: '15:00', fullTwelve: true });
    });

    test('ticking on an answered day adds only the flag', () => {
        const before = { mode: 'before', until: '07:00' };
        assert.deepEqual(withRelease(before, true), { mode: 'before', until: '07:00', releaseRequested: true });
        assert.deepEqual(before, { mode: 'before', until: '07:00' }, 'the previous object is not mutated');
    });

    test('a flag is deleted, never stored false (the saved shape has no false)', () => {
        const off = withRelease({ mode: 'all_day', releaseRequested: true }, false);
        assert.equal(Object.prototype.hasOwnProperty.call(off, 'releaseRequested'), false);
    });

    test('idempotent: ticking a ticked day, or unticking an unticked one, returns the same object', () => {
        const on = { mode: 'all_day', releaseRequested: true };
        assert.equal(withRelease(on, true), on);
        const off = { mode: 'all_day' };
        assert.equal(withRelease(off, false), off);
    });
});

describe('a mode change keeps the request (review of v23.85, bug 2)', () => {
    test('EVERY mode, including "not available", carries the request forward', () => {
        for (const mode of MODES) {
            const next = withMode({ releaseRequested: true }, mode, SHIFT);
            assert.equal(next.mode, mode);
            assert.equal(next.releaseRequested, true, `${mode} dropped the request`);
        }
    });

    test('choosing a mode on a request-only day completes it without losing the request', () => {
        const next = withMode({ releaseRequested: true }, 'after', SHIFT);
        assert.deepEqual(next, { mode: 'after', from: '15:00', releaseRequested: true });
        assert.equal(dayUnfinished(next), false);
    });

    test('the bulk "Mark all seven days Not available" is a mode change per day — same rule', () => {
        // The form applies withMode('unavailable') to each day; a staged Sunday request must survive.
        const days = { sun: { releaseRequested: true }, mon: { mode: 'all_day' }, tue: undefined };
        const after = Object.fromEntries(Object.entries(days).map(([d, a]) => [d, withMode(a, 'unavailable', SHIFT)]));
        assert.deepEqual(after.sun, { mode: 'unavailable', releaseRequested: true });
        assert.deepEqual(after.mon, { mode: 'unavailable' });
        assert.deepEqual(after.tue, { mode: 'unavailable' });
    });

    test('a day WITHOUT a request gains none from a mode change', () => {
        for (const mode of MODES) {
            const next = withMode({ mode: 'all_day' }, mode, SHIFT);
            assert.equal(Object.prototype.hasOwnProperty.call(next, 'releaseRequested'), false, mode);
        }
    });
});

describe('the willingness tick — the rider that DOES die with "not available" (v21.24 rule, kept)', () => {
    test('survives every available mode', () => {
        for (const mode of MODES.filter(m => m !== 'unavailable')) {
            assert.equal(withMode({ mode: 'all_day', fullTwelve: true }, mode, SHIFT).fullTwelve, true, mode);
        }
    });

    test('is dropped by "not available" — the server refuses the pairing — while the request is kept', () => {
        const next = withMode({ mode: 'all_day', fullTwelve: true, releaseRequested: true }, 'unavailable', SHIFT);
        assert.deepEqual(next, { mode: 'unavailable', releaseRequested: true });
    });

    test('cannot be set on a day with no mode, or on "not available"', () => {
        const none = { releaseRequested: true };
        assert.equal(withFullTwelve(none, true), none);
        const no = { mode: 'unavailable' };
        assert.equal(withFullTwelve(no, true), no);
    });

    test('set and unset leave the request alone', () => {
        const on = withFullTwelve({ mode: 'all_day', releaseRequested: true }, true);
        assert.deepEqual(on, { mode: 'all_day', releaseRequested: true, fullTwelve: true });
        assert.deepEqual(withFullTwelve(on, false), { mode: 'all_day', releaseRequested: true });
    });
});

describe('withMode keeps its v20.75 rule: re-pressing the selected mode returns the saved answer verbatim', () => {
    test('the same object comes back, for every mode', () => {
        for (const mode of MODES) {
            const prev = withMode(undefined, mode, SHIFT);
            assert.equal(withMode(prev, mode, { start: '12:00', end: '20:00' }), prev,
                `${mode} was rebuilt from the current roster instead of kept`);
        }
    });

    test('the anchored modes seed their boundary from the roster; custom starts empty', () => {
        assert.deepEqual(withMode(undefined, 'before', SHIFT), { mode: 'before', until: '07:00' });
        assert.deepEqual(withMode(undefined, 'after', SHIFT), { mode: 'after', from: '15:00' });
        assert.deepEqual(withMode(undefined, 'before_after', SHIFT), { mode: 'before_after', until: '07:00', from: '15:00' });
        assert.deepEqual(withMode(undefined, 'custom', SHIFT), { mode: 'custom', start: '', end: '', nextDay: false });
        assert.deepEqual(withMode(undefined, 'before', null), { mode: 'before', until: '' });
    });
});
