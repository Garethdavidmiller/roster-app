/**
 * Tests for admin-save-receipt.js — what a save says it did.
 *
 * The receipt exists because a COUNT cannot answer the question a manager has after pressing Save
 * ("did I change the days I meant to?"), so the tests are about whether the list can be trusted to
 * answer it. Two ways it fails:
 *
 *   · IT LEAVES SOMETHING OUT — a removed day silently absent reads as a shorter change, not as a
 *     missing line. This is the direction that matters: the reader has no way to notice.
 *   · IT IS IN AN ORDER NOBODY CHECKS IN — a manager checks against their intention, and their
 *     intention was a run of dates. Any other order makes them do the sorting.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSaveReceipt } from './admin-save-receipt.js';

const fmt = iso => iso.slice(8) + '/' + iso.slice(5, 7);
const describeEntry = e => (e.value ? `${e.type} ${e.value}` : e.type);
const build = (toSave, removed = []) => buildSaveReceipt({
    toSave, removed, memberName: 'G. Miller', formatDate: fmt, describe: describeEntry,
});

describe('nothing is left out', () => {
    test('every saved day gets a line', () => {
        const { lines } = build([
            { date: '2026-07-13', type: 'annual_leave', value: 'AL' },
            { date: '2026-07-14', type: 'annual_leave', value: 'AL' },
        ]);
        assert.equal(lines.length, 2);
    });

    test('a REMOVED day is named, not omitted', () => {
        // The whole point. An absence in a receipt is not readable as a change — it is readable as
        // the receipt being short, and the reader cannot tell which.
        const { lines } = build([], [{ date: '2026-07-15', value: '07:00-15:00' }]);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /removed/);
    });

    test('saves and removals appear in ONE list', () => {
        const { lines } = build(
            [{ date: '2026-07-13', type: 'shift', value: '07:00-15:00' }],
            [{ date: '2026-07-14' }],
        );
        assert.equal(lines.length, 2, 'a save that both adds and removes must show both');
    });

    test('the headline counts both, and agrees with the list', () => {
        const { summary, lines } = build(
            [{ date: '2026-07-13', type: 'shift', value: '07:00-15:00' }],
            [{ date: '2026-07-14' }],
        );
        assert.match(summary, /2 changes saved for G\. Miller/);
        assert.equal(lines.length, 2, 'a headline that disagrees with its own list is worse than neither');
    });

    test('one change reads as one change', () => {
        const { summary } = build([{ date: '2026-07-13', type: 'sick', value: 'SICK' }]);
        assert.match(summary, /^1 change saved/, 'not "1 changes"');
    });
});

describe('the order a manager checks in', () => {
    test('lines are in DATE order regardless of the order they were staged', () => {
        const { lines } = build([
            { date: '2026-07-16', type: 'shift', value: 'c' },
            { date: '2026-07-13', type: 'shift', value: 'a' },
            { date: '2026-07-15', type: 'shift', value: 'b' },
        ]);
        assert.deepEqual(lines.map(l => l.slice(0, 2)), ['13', '15', '16']);
    });

    test('a removal sorts among the saves, not after them', () => {
        // Grouping by kind would make a manager reassemble the week in their head — the one thing
        // the receipt exists to save them.
        const { lines } = build(
            [{ date: '2026-07-13', type: 'shift', value: 'a' }, { date: '2026-07-15', type: 'shift', value: 'b' }],
            [{ date: '2026-07-14' }],
        );
        assert.match(lines[1], /^14.*removed/, 'the removed 14th belongs between the 13th and the 15th');
    });
});

describe('what a line says', () => {
    test('a day says what it now IS', () => {
        const { lines } = build([{ date: '2026-07-13', type: 'shift', value: '07:00-15:00' }]);
        assert.match(lines[0], /13\/07 — shift 07:00-15:00/);
    });

    test('a removed line does not repeat the old value', () => {
        // Naming what it used to be invites reading it as what it now is.
        const { lines } = build([], [{ date: '2026-07-15', value: '07:00-15:00' }]);
        assert.doesNotMatch(lines[0], /07:00/);
    });

    test('a removal the cache could not resolve is still counted and still named', () => {
        // The caller looks each deleted id up in the cache and can miss — a staged delete can
        // outlive a capped collection read that trimmed the row. Dropping it took the day off the
        // list AND out of the count, so a pure-deletion save could report "0 changes saved" over
        // documents that were genuinely deleted. The receipt may say it does not know WHICH day; it
        // may not say nothing happened.
        const { summary, lines } = build([], [null]);
        assert.match(summary, /^1 change saved/);
        assert.equal(lines.length, 1);
        assert.match(lines[0], /removed/);
    });

    test('an unresolved removal sorts LAST rather than throwing on a missing date', () => {
        const { lines } = build([{ date: '2026-07-13', type: 'shift', value: 'a' }], [null]);
        assert.equal(lines.length, 2);
        assert.match(lines[0], /^13/, 'the dated line comes first');
    });

    test('an empty save produces an empty list rather than a fabricated line', () => {
        const { lines, summary } = build([], []);
        assert.deepEqual(lines, []);
        assert.match(summary, /^0 changes/);
    });
});
