// @ts-check
/**
 * admin-bulk-apply.js — WHAT THE WEEK CARD'S "APPLY TO TICKED DAYS" IS WAITING FOR, as the sentence
 * the line under it says: '' when it can act.
 *
 * Owns: the one rule for when the bulk bar's Apply is greyed out, and the words that say why.
 * Does NOT own: the bar, the ticking or the applying (admin-week-editor.js), nor which types a Sunday
 *   refuses — that is `SUNDAY_FORBIDDEN_TYPES` (override-utils.js), consulted here and never restated.
 *
 * Apply is greyed out until it can do something, with the reason in the line under it — Save changes'
 * own pattern (owner, 7 Nov 2026). The last case only a press used to find — every ticked day a Sunday,
 * and a type a Sunday refuses — is known before the press, so it is said before it too (owner, 8 Nov
 * 2026). THIS IS NOT A LAYER OF THE SUNDAY RULE: the apply still skips a Sunday row itself (layer 2),
 * and a week with a Sunday among working days still applies the rest and says the Sunday was skipped.
 * It only stops Apply being offered when nothing could apply. Pure, so it is tested in Node
 * (admin-bulk-apply.test.mjs) rather than only through a browser.
 *
 * TWO MORE DAYS APPLY LEAVES ALONE, each said as the Sunday is, named in the line Apply leaves:
 *   'rest'  — Absent on a rest day (owner, 10 Nov 2026: "Skip rest days"), as the Absence card and the
 *             roster import already do, in their words: "rest days skipped", "a rest day on the base
 *             roster, so nothing is recorded".
 *   'start' — any type before the member's start date, which the Calendar never shows (Nov 2026).
 * Which days those are is the caller's (`leftAlone`): it needs the member and their records.
 */
import { isForbiddenOnSunday } from './override-utils.js';
import { isSunday } from './roster-data.js';

/** @typedef {'' | 'rest' | 'start'} LeftAlone */

/**
 * @param {string[]} tickedDates  the ticked rows' dates, YYYY-MM-DD
 * @param {string} type           the bulk type chosen, '' when none is
 * @param {(date: string) => LeftAlone} [leftAlone]  why Apply leaves a day alone, beyond the Sunday rule
 * @returns {string}              '' when Apply can act; otherwise what is still missing, as the line says it
 */
export function bulkApplyWaitingFor(tickedDates, type, leftAlone = () => '') {
    const n = tickedDates.length;
    if (!n) return type ? 'Tick the days to apply it to' : 'Tick at least one day and choose a type';
    if (!type) return `Choose a type for the ticked day${n > 1 ? 's' : ''}`;
    const sunday = (/** @type {string} */ d) => isForbiddenOnSunday(type) && isSunday(d);
    if (tickedDates.every(sunday)) return 'Sunday isn’t a contracted day — tick a working day';
    const why = tickedDates.filter(d => !sunday(d)).map(leftAlone);
    if (!why.every(Boolean)) return '';
    if (why.every(w => w === 'rest')) return 'An absence isn’t recorded on a rest day — tick a working day';
    if (why.every(w => w === 'start')) return 'Nothing is recorded before the start date — tick a later day';
    return 'None of the ticked days can take it — tick a working day';
}

/**
 * What Apply says about the ticked days it left alone — each named, with why — or '' when it left none.
 * @param {number} applied  how many days took the type
 * @param {Array<{ date: string, why: 'sunday' | 'rest' | 'start' }>} skipped
 * @param {(iso: string) => string} fmt  a date as the page writes it
 * @returns {string}
 */
export function bulkSkippedLine(applied, skipped, fmt) {
    if (!skipped.length) return '';
    const of = (/** @type {string} */ w) => skipped.filter(s => s.why === w).map(s => fmt(s.date));
    const list = (/** @type {string[]} */ a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0]);
    const rest = of('rest'), start = of('start'), parts = [];
    if (of('sunday').length) parts.push('Sunday skipped (not a contracted day)');
    if (rest.length) parts.push(`${list(rest)} skipped: ${rest.length > 1 ? 'rest days' : 'a rest day'} on the base roster, so nothing is recorded`);
    if (start.length) parts.push(`${list(start)} skipped: before the start date, so nothing is recorded`);
    return `Set ${applied} day${applied !== 1 ? 's' : ''} — ${parts.join('; ')}.`;
}
