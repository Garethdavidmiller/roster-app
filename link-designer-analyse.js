// @ts-check
/**
 * link-designer-analyse.js — ONE reading of a Link Designer design, shared by every panel that reports on it: the
 * Coverage card, the Design checks, the sticky summary strip and compare mode. Pure: no DOM, no
 * Firebase. Tested by link-designer-analyse.test.mjs.
 *
 * ── `analyse`, AND WHY (Nov 2026) ───────────────────────────────────────────────────────────────
 *
 * Each panel computed its own figures, so one painted cell ran the fatigue factors, the design
 * checks and the service reading two to four times over for the same answer. Every figure still
 * comes from the one function that owns it; what is shared is the ANSWER, keyed on CONTENT:
 *
 * 1. **Keyed on content, never on the object.** The grid edits `patterns` in place, so an object key
 *    would hand back the figures from before the edit. The key is the patterns, the canonical window
 *    and the line count, so the same design reads the same whoever asks first — the
 *    order-independence the panels' separate calls existed to keep.
 * 2. **Each part is computed when it is first asked for**, once; a panel that never reads the hours
 *    does not pay for them.
 * 3. **The answers are read-only**, and read from a frozen COPY of the design: a later edit cannot
 *    reach a kept answer, and a consumer that edited one would change what the next panel reads.
 *
 * `readAgainstService` is the one way a design is read against the December 2026 service — its OWN
 * window, minute by minute against who is on duty. The heat map, the summary strip and compare mode
 * each built that call themselves; three copies are three chances for the cells, the chip and the
 * comparison to disagree about the one question the card exists to answer.
 */

import { DAYS, ROTATING_LINES, calcHourlyCoverage, runDesignChecks, weeklyHours } from './link-designer-design.js';
import { assessFatigue } from './link-designer-fatigue.js';
import { assessHardLimits } from './link-designer-limits.js';
import { normaliseWindow, windowForDay, rowMinutes } from './link-designer-window.js';
import { DEC_2026_MOVEMENTS, dutySpans, summariseDemand } from './link-designer-demand.js';

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

/** How many readings are kept: the open design and a compared one, with room for the next edit. */
const KEEP = 4;
/** @type {Map<string, any>} oldest first */
const _readings = new Map();

/**
 * Everything the panels report about one design, computed on first ask (rule 2) and shared while
 * its content is unchanged (rule 1).
 * @param {{ patterns: Record<string, any>, window?: any }} design
 * @param {number} [lines]
 * @returns {{ readonly checks: ReturnType<typeof runDesignChecks>, readonly fatigue: ReturnType<typeof assessFatigue>,
 *             readonly limits: ReturnType<typeof assessHardLimits>, readonly hours: ReturnType<typeof weeklyHours>,
 *             readonly service: ReturnType<typeof readAgainstService> }}
 */
export function analyse(design, lines = ROTATING_LINES) {
    const key = JSON.stringify([design.patterns ?? {}, normaliseWindow(design.window), lines]);
    const kept = _readings.get(key);
    if (kept) { _readings.delete(key); _readings.set(key, kept); return kept; }
    const d = Object.freeze({ patterns: JSON.parse(JSON.stringify(design.patterns ?? {})), window: design.window ?? null });
    /** @type {Record<string, any>} */ const done = {};
    const once = (/** @type {string} */ part, /** @type {() => any} */ read) => (part in done ? done[part] : (done[part] = read()));
    const reading = Object.freeze({
        get checks() { return once('checks', () => runDesignChecks(d.patterns, lines)); },
        get fatigue() { return once('fatigue', () => assessFatigue(d.patterns, lines, { window: d.window })); },
        get limits() { return once('limits', () => assessHardLimits(d.patterns, lines)); },
        get hours() { return once('hours', () => weeklyHours(d.patterns, lines)); },
        get service() { return once('service', () => readAgainstService(d, lines)); },
    });
    _readings.set(key, reading);
    if (_readings.size > KEEP) _readings.delete(/** @type {string} */ (_readings.keys().next().value));
    return reading;
}
