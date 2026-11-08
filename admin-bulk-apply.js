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
 */
import { isForbiddenOnSunday } from './override-utils.js';
import { isSunday } from './roster-data.js';

/**
 * @param {string[]} tickedDates  the ticked rows' dates, YYYY-MM-DD
 * @param {string} type           the bulk type chosen, '' when none is
 * @returns {string}              '' when Apply can act; otherwise what is still missing, as the line says it
 */
export function bulkApplyWaitingFor(tickedDates, type) {
    const n = tickedDates.length;
    if (!n) return type ? 'Tick the days to apply it to' : 'Tick at least one day and choose a type';
    if (!type) return `Choose a type for the ticked day${n > 1 ? 's' : ''}`;
    if (isForbiddenOnSunday(type) && tickedDates.every(isSunday)) return 'Sunday isn’t a contracted day — tick a working day';
    return '';
}
