// @ts-check
/**
 * links-analyse.test.mjs — the one reading of a Links design the panels share (links-analyse.js).
 * Run: node scripts/run-tests.mjs links-analyse.test.mjs   (part of `npm run test:hygiene`)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readAgainstService } from './links-analyse.js';
import { DAYS, ROTATING_LINES, calcHourlyCoverage } from './links-design.js';
import { DEC_2026_MOVEMENTS, dutySpans, summariseDemand } from './links-demand.js';
import { normaliseWindow, windowForDay, rowMinutes } from './links-window.js';

/** Every line an early on Mon–Sat, so the evening is bare. */
const mornings = () => Object.fromEntries(Array.from({ length: ROTATING_LINES }, (_, i) =>
    [String(i + 1), Object.fromEntries(DAYS.map(d => [d, d === 'sun' ? 'RD' : '06:20-14:20']))]));

describe('readAgainstService', () => {
    test('is the Coverage card\'s reading: the hourly cover, and the service read minute by minute against the design\'s window', () => {
        const design = { patterns: mornings(), window: null };
        const { hourly, sum } = readAgainstService(design);
        assert.deepEqual(hourly, calcHourlyCoverage(design.patterns, ROTATING_LINES));
        const win = normaliseWindow(null);
        assert.deepEqual(sum, summariseDemand({ movements: DEC_2026_MOVEMENTS, spans: dutySpans(design.patterns, ROTATING_LINES),
            days: DAYS, windowFor: (day) => rowMinutes(windowForDay(win, day)) }));
        assert.ok(sum.uncovered.length > 0, 'the premise: a mornings-only design leaves staffed hours with trains and nobody on');
    });
    test('each design is read against its OWN window', () => {
        const patterns = mornings();
        const standard = readAgainstService({ patterns, window: null });
        const early = readAgainstService({ patterns, window: { monSat: { start: '06:00', end: '14:20' }, sun: { start: '07:15', end: '23:25' } } });
        assert.ok(early.sum.uncovered.length < standard.sum.uncovered.length,
            'a window that closes when the mornings end has fewer staffed hours to leave bare');
    });
});
