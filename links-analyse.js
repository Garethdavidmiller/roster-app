// @ts-check
/**
 * links-analyse.js — ONE reading of a Links design, shared by every panel that reports on it: the
 * Coverage card, the Design checks, the sticky summary strip and compare mode. Pure: no DOM, no
 * Firebase. Tested by links-analyse.test.mjs.
 *
 * `readAgainstService` is the one way a design is read against the December 2026 service — its OWN
 * window, minute by minute against who is on duty. The heat map, the summary strip and compare mode
 * each built that call themselves; three copies are three chances for the cells, the chip and the
 * comparison to disagree about the one question the card exists to answer.
 */

import { DAYS, ROTATING_LINES, calcHourlyCoverage } from './links-design.js';
import { normaliseWindow, windowForDay, rowMinutes } from './links-window.js';
import { DEC_2026_MOVEMENTS, dutySpans, summariseDemand } from './links-demand.js';

/**
 * One design read against the service, exactly as the Coverage card reads it: the hourly cover and
 * the demand summary (`uncovered` beside `outside` — a chip may never report one without the other).
 * @param {{ patterns: Record<string, any>, window?: any }} design
 * @param {number} [lines]
 */
export function readAgainstService(design, lines = ROTATING_LINES) {
    const hourly = calcHourlyCoverage(design.patterns, lines);
    const win = normaliseWindow(design.window);
    const sum = summariseDemand({
        movements: DEC_2026_MOVEMENTS,
        spans: dutySpans(design.patterns, lines),
        days: DAYS,
        windowFor: (day) => rowMinutes(windowForDay(win, day)),
    });
    return { hourly, sum };
}
