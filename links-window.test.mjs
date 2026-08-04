/**
 * links-window.test.mjs — the operating window of a link design (LINKS_DEC2026_PLAN package 1).
 * Run: node --test links-window.test.mjs   (part of `npm run test:hygiene`)
 *
 * The weight here is on the two things that decide whether the feature helps or misleads:
 *  · `normaliseWindow` is the trust boundary for a stored value, and its fallback must never
 *    INVENT a window — a half-default row would look deliberate on a printed sheet;
 *  · `windowsDiffer` is what stops compare mode presenting two different spans as like-for-like,
 *    which is the one way this feature could make an unfair comparison look fair.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_WINDOW, WINDOW_ROWS, windowMinutes, isValidWindowRow, normaliseWindow,
    windowForDay, isHourStaffed, heatSpan, formatWindow, windowsDiffer, isDefaultWindow,
} from './links-window.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

describe('windowMinutes / isValidWindowRow', () => {
    test('reads a real time of day', () => {
        assert.equal(windowMinutes('06:20'), 6 * 60 + 20);
        assert.equal(windowMinutes('23:55'), 23 * 60 + 55);
        assert.equal(windowMinutes('00:00'), 0);
        assert.equal(windowMinutes('6:20'), 380, 'an unpadded hour is still a time');
    });
    test('rejects anything that is not one', () => {
        for (const v of ['24:00', '06:60', '0620', '6', '', null, undefined, 620, {}, '06:20-14:20']) {
            assert.equal(windowMinutes(v), null, `${JSON.stringify(v)} must not parse`);
        }
    });
    test('a row must be two real times, in order', () => {
        assert.equal(isValidWindowRow({ start: '06:20', end: '23:55' }), true);
        assert.equal(isValidWindowRow({ start: '23:55', end: '06:20' }), false, 'no wrapping window');
        assert.equal(isValidWindowRow({ start: '06:20', end: '06:20' }), false, 'zero-length is not a window');
        assert.equal(isValidWindowRow({ start: '06:20' }), false, 'half a row is not a row');
        assert.equal(isValidWindowRow(null), false);
    });
});

describe('normaliseWindow — the trust boundary', () => {
    test('missing / junk falls back to the app default', () => {
        for (const v of [undefined, null, {}, 'nope', 42, []]) {
            assert.deepEqual(normaliseWindow(v), { monSat: { ...DEFAULT_WINDOW.monSat }, sun: { ...DEFAULT_WINDOW.sun } });
        }
    });
    test('a stored window is kept verbatim', () => {
        const stored = { monSat: { start: '05:30', end: '23:55' }, sun: { start: '07:15', end: '23:55' } };
        assert.deepEqual(normaliseWindow(stored), stored);
    });
    test('rows fall back INDEPENDENTLY — a valid row survives a broken neighbour', () => {
        // The two rows are separate decisions. Discarding a good Sunday because Mon–Sat is corrupt
        // would throw away something a designer actually chose.
        const half = { monSat: { start: 'zzz', end: '23:55' }, sun: { start: '07:15', end: '23:55' } };
        const out = normaliseWindow(half);
        assert.deepEqual(out.sun, { start: '07:15', end: '23:55' }, 'the good row is kept');
        assert.deepEqual(out.monSat, { ...DEFAULT_WINDOW.monSat }, 'the broken row defaults whole');
    });
    test('does NOT mix a stored field with a default one', () => {
        // Per-FIELD fallback would invent a window nobody chose — and it would read as deliberate
        // on a printed sheet. A row is all-or-nothing.
        const out = normaliseWindow({ monSat: { start: '05:00', end: 'zzz' }, sun: DEFAULT_WINDOW.sun });
        assert.equal(out.monSat.start, DEFAULT_WINDOW.monSat.start, 'the stored 05:00 must NOT be kept');
        assert.equal(out.monSat.end, DEFAULT_WINDOW.monSat.end);
    });
    test('the default export is not mutable through a normalised copy', () => {
        const out = normaliseWindow(null);
        out.monSat.start = '01:00';
        assert.equal(DEFAULT_WINDOW.monSat.start, '06:20', 'DEFAULT_WINDOW must survive a caller edit');
    });
});

describe('isHourStaffed / windowForDay', () => {
    const win = DEFAULT_WINDOW;
    test('Sunday takes the Sunday row, every other day takes Mon–Sat', () => {
        assert.deepEqual(windowForDay(win, 'sun'), { ...DEFAULT_WINDOW.sun });
        for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
            assert.deepEqual(windowForDay(win, d), { ...DEFAULT_WINDOW.monSat });
        }
    });
    test('a PARTLY covered hour counts as staffed', () => {
        // The day opens 06:20, so cover is required within the 06:00 hour. Calling it "outside the
        // window" would hide a genuine hole at the very start of the day.
        assert.equal(isHourStaffed(win, 'mon', 6), true);
        assert.equal(isHourStaffed(win, 'mon', 5), false);
        assert.equal(isHourStaffed(win, 'mon', 23), true, 'closes 23:55 — the 23:00 hour is staffed');
    });
    test('Sunday is shorter at BOTH ends', () => {
        assert.equal(isHourStaffed(win, 'sun', 6), false, 'Sunday does not open until 07:15');
        assert.equal(isHourStaffed(win, 'sun', 7), true);
        assert.equal(isHourStaffed(win, 'sun', 23), true, 'closes 23:25 — the 23:00 hour is staffed');
        assert.equal(isHourStaffed(win, 'mon', 6), true, '…while Mon–Sat already is');
    });
});

describe('heatSpan', () => {
    const empty = Object.fromEntries(DAYS.map(d => [d, { hours: new Array(24).fill(0) }]));
    test('covers the whole staffed day even when nobody works most of it', () => {
        // THE DEFECT THIS FEATURE EXISTS FOR. The old span ran first-worked-hour → last-worked-hour,
        // so a design where everyone finishes at 14:20 dropped 15:00–23:00 out of the table
        // entirely and flagged nothing. The window keeps those columns on screen.
        const hourly = JSON.parse(JSON.stringify(empty));
        for (let h = 6; h < 15; h++) hourly.mon.hours[h] = 28;
        const { minH, maxH } = heatSpan(DEFAULT_WINDOW, hourly, DAYS);
        assert.equal(minH, 6);
        assert.equal(maxH, 24, 'the evening the station is open must stay visible');
    });
    test('stretches to include a duty OUTSIDE the window', () => {
        // Bounding by the window alone would hide someone rostered when the station is shut —
        // exactly what a reviewer needs to see.
        const hourly = JSON.parse(JSON.stringify(empty));
        hourly.mon.hours[3] = 1;
        assert.equal(heatSpan(DEFAULT_WINDOW, hourly, DAYS).minH, 3);
    });
    test('falls back to a sane span when there is nothing at all', () => {
        const noWin = { monSat: { start: 'x', end: 'y' }, sun: { start: 'x', end: 'y' } };
        // normaliseWindow rescues that to the default, so the span is still the staffed day.
        assert.deepEqual(heatSpan(noWin, empty, DAYS), { minH: 6, maxH: 24 });
    });
});

describe('windowsDiffer / isDefaultWindow / formatWindow', () => {
    test('two designs with different spans are NOT like for like', () => {
        const moved = { monSat: DEFAULT_WINDOW.monSat, sun: { start: '07:15', end: '23:55' } };
        assert.equal(windowsDiffer(DEFAULT_WINDOW, moved), true, 'the live Sunday question');
        assert.equal(windowsDiffer(DEFAULT_WINDOW, DEFAULT_WINDOW), false);
    });
    test('a missing window compares equal to the default — old designs are not "different"', () => {
        assert.equal(windowsDiffer(undefined, DEFAULT_WINDOW), false);
        assert.equal(isDefaultWindow(null), true);
    });
    test('a moved window is not the default', () => {
        assert.equal(isDefaultWindow({ monSat: { start: '05:00', end: '23:55' }, sun: DEFAULT_WINDOW.sun }), false);
    });
    test('formats both rows, so a sheet states what it was designed to', () => {
        assert.equal(formatWindow(DEFAULT_WINDOW), 'Mon–Sat 06:20–23:55 · Sun 07:15–23:25');
        assert.equal(formatWindow(null), formatWindow(DEFAULT_WINDOW), 'an unset window prints its effective value');
    });
    test('WINDOW_ROWS names every row the shape carries', () => {
        assert.deepEqual([...WINDOW_ROWS].sort(), Object.keys(normaliseWindow(null)).sort());
    });
});
