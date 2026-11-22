// @ts-check
/**
 * links-today.js — what the Links workspace reads from TODAY's roster: the shift times its cell
 * sheet offers, and today's link measured against the ORR fatigue factors for comparison. Pure: no
 * DOM, no Firebase. Tested by links-today.test.mjs.
 *
 * ── TWO RULES AN EDIT CAN BREAK ─────────────────────────────────────────────────────────────────
 *
 * 1. **The MAIN roster only** (since v19.98). The new link is the CEA roster WIDENED and does not take
 *    on the bilingual roster's work, so its times — none shared with main — are never offered, and a
 *    bilingual figure would compare against a rotation the design does not replace. Never splice
 *    two cycles together either: the JOIN reported a run of 19 days that neither roster has.
 * 2. **Each factor's threshold is its own row's** (links-fatigue.js), never typed here: a sentence
 *    that types "13" and "4" goes on saying them after the rule it quotes has moved. The cycle's
 *    length is MEASURED from the roster, not stated.
 *
 * The baseline is measured ONCE per roster object (links-app-20): today's roster is a constant for
 * the session, and it ran for every painted cell — about a fifth of a paint's work — for one answer.
 */

import { weeklyRoster } from './roster-data.js';
import { classifyShift } from './links-design.js';
import { DEFAULT_SHIFT_TIMES } from './links-default-targets.js';
import { assessFatigue } from './links-fatigue.js';

/**
 * The shift times the workspace offers. `early`/`late` are the MAIN roster's own (rule 1); the cell
 * sheet's `earlyOptions`/`lateOptions` add the default target table's, so a design generated from the
 * default can be edited to any time it is made of — listing only the roster's left a row's time on
 * screen and unselectable. CEAs work no nights, so none is listed (the brush bar uses the DESIGN's own
 * times, which is neither list).
 * @param {Record<string, Record<string, string>>} [cycle]  a rotation, week → day → shift
 * @param {readonly string[]} [defaults]
 */
export function shiftOptionLists(cycle = weeklyRoster, defaults = DEFAULT_SHIFT_TIMES) {
    const worked = new Set();
    for (const week of Object.values(cycle)) {
        for (const shift of Object.values(week)) {
            if (shift && shift !== 'RD' && shift !== 'OFF' && shift !== 'SPARE') worked.add(shift);
        }
    }
    const split = (/** @type {Iterable<string>} */ times) => {
        /** @type {string[]} */ const early = [], late = [];
        for (const s of [...new Set(times)].sort()) {
            const cls = classifyShift(s);
            if (cls === 'early') early.push(s); else if (cls === 'late') late.push(s);
        }
        return { early, late };
    };
    const roster = split(worked), all = split([...worked, ...defaults]);
    return { early: roster.early, late: roster.late, earlyOptions: all.early, lateOptions: all.late };
}

/** @type {WeakMap<object, {summary: string, detail: string}|null>} */
const _measured = new WeakMap();

/**
 * Today's link against the fatigue factors, for the Design checks card's comparison row — or null
 * when it cannot be measured, so the panel omits the row rather than showing a wrong one.
 * @param {Record<string, Record<string, string>>} [cycle]  the MAIN rotation, week → day → shift
 * @returns {{summary: string, detail: string}|null}
 */
export function currentLinkBaseline(cycle = weeklyRoster) {
    if (_measured.has(cycle)) return /** @type {any} */ (_measured.get(cycle));
    /** @type {{summary: string, detail: string}|null} */ let answer = null;
    try {
        /** @type {Record<string, any>} */ const patterns = {};
        let lines = 0;
        for (const k of Object.keys(cycle)) patterns[String(++lines)] = cycle[k];
        const a = assessFatigue(patterns, lines);
        const pick = (/** @type {string} */ code) => a.results.find((/** @type {any} */ x) => x.code === code && x.status !== 'n/a');
        const ff11 = pick('FF11'), ff15 = pick('FF15');
        answer = {
            summary: `Today's link already features ${a.present} of these factors on the main ${lines}-line cycle — the link a new design would replace.`,
            detail: `Longest run without a two-day break: ${ff11?.value}, against FF11's ${ff11?.threshold}.`
                + ` Longest run of consecutive early starts: ${ff15?.value}, against FF15's ${ff15?.threshold}.`
                + ` Measured on the main cycle at its own length, not spliced into one rotation.`,
        };
    } catch (err) {
        console.warn('[Links] Baseline unavailable:', err);
    }
    _measured.set(cycle, answer);
    return answer;
}
