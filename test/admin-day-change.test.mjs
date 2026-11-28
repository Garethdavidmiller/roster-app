// @ts-check
// @lane hygiene
/**
 * admin-day-change.test.mjs — Change a Shift's before → after for a staged day (admin-day-change.js, owner,
 * 27 Nov 2026). The page path, preview and receipt together, is e2e/admin-saves.spec.js.
 * Run: node scripts/run-tests.mjs test/admin-day-change.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagedDayChanges, nowShows, shownValue } from '../admin-day-change.js';
import { dayWords } from '../admin-save-receipt.js';

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

// ── A DAY WITH HOURS SAYS THEM ───────────────────────────────────────────────────────────────────
// Rest Day Working resolves to the bare 'RDW' with its hours in `rdwTime`, so a line read off `.shift` alone said
// "Rest day → RDW" where the Calendar draws the hours. Both halves keep them: the row's stamp and the staged change.
test('Rest Day Working says its hours, before and after', () => {
    const g = grid({ '2026-12-02': { nowShows: nowShows(null, 'RD', '2026-12-02', false), baseShift: 'RD', xmasDue: '' },
                     '2026-12-03': { nowShows: nowShows({ type: 'rdw', value: '13:30-21:00' }, 'RD', '2026-12-03', false),
                                     baseShift: 'RD', xmasDue: '' } });
    const changes = stagedDayChanges(/** @type {any} */ (g), [
        { date: '2026-12-02', type: 'rdw', value: '09:00-17:00' },
        { date: '2026-12-03', type: 'annual_leave', value: 'AL' },
    ], new Map());
    assert.equal(changes.get('2026-12-02'), 'Rest day → RDW 09:00–17:00');
    assert.equal(changes.get('2026-12-03'), 'RDW 13:30–21:00 → Annual leave');
});

test('a timed shift on a Sunday is drawn as RDW with its hours, and says so', () => {
    // 6 Dec 2026 is a Sunday: the Calendar draws an old timed `shift` there as Rest Day Working.
    assert.equal(dayWords(nowShows({ type: 'shift', value: '09:00-17:00' }, 'RD', '2026-12-06', false)), 'RDW 09:00–17:00');
});

test('an Other day with no hours of its own says what the Calendar puts beneath its badge', () => {
    // On a worked day the slot is the base shift's time; on a rest day it is RDW; a Meeting shows no base time.
    assert.equal(dayWords(nowShows({ type: 'other', value: 'TRG' }, '06:20-14:20', '2026-12-01', false)), 'Training 06:20–14:20');
    assert.equal(dayWords(nowShows({ type: 'other', value: 'TRG' }, 'RD', '2026-12-02', false)), 'Training RDW');
    assert.equal(dayWords(nowShows({ type: 'other', value: 'TRG RDW' }, 'RD', '2026-12-02', false)), 'Training RDW');
    assert.equal(dayWords(nowShows({ type: 'other', value: 'MEET' }, '06:20-14:20', '2026-12-01', false)), 'Meeting');
    assert.equal(dayWords(nowShows({ type: 'other', value: 'TRG 09:00-17:00' }, '06:20-14:20', '2026-12-01', false)),
        'Training 09:00–17:00');
    assert.equal(shownValue({ shift: '06:20-14:20', rdwTime: '' }), '06:20-14:20');
});

// ── AN ABSENCE OVER A SWAPPED-IN DAY IS DRAWN ABSENT ───────────────────────────────────────────
// The save writes the `replacedType` it carries from the record it replaces, and the Calendar shows an absence on a
// rest day only with a contracted one. The line resolves the record the save WRITES, so it says what will be drawn.
test('an absence over a swapped-in shift, an Other day or a Spare turn on a rest day says Absent', () => {
    const under = new Map([
        ['2026-12-02', { id: 'a', type: 'shift', value: '06:20-14:20' }],
        ['2026-12-03', { id: 'b', type: 'other', value: 'TRG RDW' }],
        ['2026-12-04', { id: 'c', type: 'spare_shift', value: 'SPARE' }],
    ]);
    /** @type {Record<string, Record<string, string>>} */ const rows = {};
    for (const [date, rec] of under) rows[date] = { nowShows: nowShows(rec, 'RD', date, false), baseShift: 'RD', xmasDue: '' };
    rows['2026-12-05'] = { nowShows: nowShows(null, 'RD', '2026-12-05', false), baseShift: 'RD', xmasDue: '' };
    const changes = stagedDayChanges(/** @type {any} */ (grid(rows)),
        ['2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05'].map(date => ({ date, type: 'sick', value: 'SICK' })), under);
    assert.equal(changes.get('2026-12-02'), '06:20–14:20 → Absent');
    assert.equal(changes.get('2026-12-03'), 'Training RDW → Absent');
    assert.equal(changes.get('2026-12-04'), 'Spare → Absent');
    // A plain rest day: the absence is hidden there, so the day goes on looking the same, and has no line.
    assert.equal(changes.has('2026-12-05'), false);
});
