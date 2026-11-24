// @ts-check
/**
 * links-analyse.test.mjs — the one reading of a Links design the panels share (links-analyse.js).
 * Run: node scripts/run-tests.mjs test/links-analyse.test.mjs   (part of `npm run test:hygiene`)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readAgainstService, analyse } from '../links-analyse.js';
import { runDesignChecks, weeklyHours } from '../links-design.js';
import { assessFatigue } from '../links-fatigue.js';
import { assessHardLimits } from '../links-limits.js';
import { DAYS, ROTATING_LINES, calcHourlyCoverage } from '../links-design.js';
import { DEC_2026_MOVEMENTS, dutySpans, summariseDemand } from '../links-demand.js';
import { normaliseWindow, windowForDay, rowMinutes } from '../links-window.js';

/** Every line an early on Mon–Sat, so the evening is bare. */
const mornings = () => Object.fromEntries(Array.from({ length: ROTATING_LINES }, (_, i) =>
    [String(i + 1), Object.fromEntries(DAYS.map(d => [d, d === 'sun' ? 'RD' : '06:20-14:20']))]));

describe('analyse: one answer per CONTENT, shared by every panel', () => {
    test('the same content gives the same answer, part by part, whoever asks — and the figures are the owners\'', () => {
        const design = { patterns: mornings(), window: null };
        const a = analyse(design), b = analyse({ patterns: mornings(), window: null });
        assert.equal(a, b, 'a design with the same content, however it is held');
        assert.equal(a.fatigue, b.fatigue, 'each part computed once');
        assert.deepEqual(a.checks, runDesignChecks(design.patterns, ROTATING_LINES));
        assert.deepEqual(a.fatigue, assessFatigue(design.patterns, ROTATING_LINES));
        assert.deepEqual(a.limits, assessHardLimits(design.patterns, ROTATING_LINES));
        assert.deepEqual(a.hours, weeklyHours(design.patterns, ROTATING_LINES));
        assert.deepEqual(a.service, readAgainstService(design));
    });
    test('an edit IN PLACE is a new reading, and the kept one still describes the design before it (rules 1, 3)', () => {
        const design = { patterns: mornings(), window: null };
        const before = analyse(design);
        const hoursBefore = before.hours.exSunday;
        design.patterns['1'].mon = 'RD';   // as the grid edits: the same object
        const after = analyse(design);
        assert.notEqual(after, before);
        assert.notEqual(after.hours.exSunday, hoursBefore);
        assert.equal(before.hours.exSunday, hoursBefore, 'the kept answer was read from a copy');
    });
    test('a part first asked for AFTER an in-place edit still describes the design the reading was taken of', () => {
        const fresh = () => ({ ...mornings(), 2: { ...mornings()['2'], tue: '07:00-16:00' } });   // content no other test reads
        const design = { patterns: fresh(), window: null };
        const expected = weeklyHours(fresh(), ROTATING_LINES).exSunday;
        const reading = analyse(design);   // nothing read from it yet
        design.patterns['1'].mon = 'RD';
        assert.equal(reading.hours.exSunday, expected);
    });
    test('the window is part of the content', () => {
        const patterns = mornings();
        assert.notEqual(analyse({ patterns, window: null }).service,
            analyse({ patterns, window: { monSat: { start: '06:00', end: '14:20' }, sun: { start: '07:15', end: '23:25' } } }).service);
        assert.equal(analyse({ patterns, window: null }), analyse({ patterns, window: normaliseWindow(null) }), 'compared canonically');
    });
});

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
