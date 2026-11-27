// @ts-check
// @lane hygiene
/**
 * admin-day-change.test.mjs — Change a Shift's before → after for a staged day (admin-day-change.js, owner,
 * 27 Nov 2026). The page path, preview and receipt together, is e2e/admin-saves.spec.js.
 * Run: node scripts/run-tests.mjs test/admin-day-change.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagedDayChanges } from '../admin-day-change.js';

/** A week grid holding the rows given, as the editor stamps them. @param {Record<string, Record<string, string>>} rows */
const grid = (rows) => ({
    querySelector: (/** @type {string} */ sel) => {
        const date = /data-date="([^"]+)"/.exec(sel)?.[1] ?? '';
        return rows[date] ? { dataset: rows[date] } : null;
    },
});

test('a staged day says what it shows now and what it becomes, as the Calendar would draw both', () => {
    const g = grid({ '2026-12-01': { nowShows: '06:20-14:20', baseShift: '06:20-14:20', xmasDue: '' },
                     '2026-12-02': { nowShows: 'RD', baseShift: 'RD', xmasDue: '' } });
    const changes = stagedDayChanges(/** @type {any} */ (g), [
        { date: '2026-12-01', type: 'shift', value: '14:30-22:30' },
        { date: '2026-12-02', type: 'annual_leave', value: 'AL' },
    ]);
    assert.equal(changes.get('2026-12-01'), '06:20–14:20 → 14:30–22:30');
    assert.equal(changes.get('2026-12-02'), 'Rest day → Annual leave');
});

test('a change that leaves the day looking the same, or a row the grid did not draw, has no line', () => {
    const g = grid({ '2026-12-01': { nowShows: '06:20-14:20', baseShift: '06:20-14:20', xmasDue: '' } });
    const changes = stagedDayChanges(/** @type {any} */ (g), [
        { date: '2026-12-01', type: 'shift', value: '06:20-14:20' },
        { date: '2026-12-09', type: 'shift', value: '06:20-14:20' },
    ]);
    assert.equal(changes.size, 0);
});
