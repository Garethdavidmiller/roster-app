// @ts-check
/**
 * admin-day-change.js — what each staged day of Change a Shift becomes, before → after, beside Save and in the
 * receipt (owner, 27 Nov 2026: "show the consequence of a change beside Save … use the same wording in the
 * receipt afterwards").
 *
 * The "before" is what the row's day shows NOW and the "after" what the staged change will make it, both asked of
 * the Calendar's own resolver (`resolveDayShift`), so the line says what a member would see; the words are
 * `changeWords` (admin-save-receipt.js), shared with the receipt. The week editor stamps each row with what it
 * shows (`data-now-shows`, `data-base-shift`, `data-xmas-due`) as it draws it. Tested through the page by
 * e2e/admin-saves.spec.js.
 */
import { isSunday } from './roster-data.js';
import { isChristmasOrBoxingDay } from './override-utils.js';
import { resolveDayShift } from './christmas-leave.js';
import { collectWeekRows } from './admin-week-collect.js';
import { changeWords } from './admin-save-receipt.js';
import { formatDisplay } from './admin-period-dates.js';

/**
 * Each staged day's before → after (`changeWords`), as the Calendar would draw it, by date: the line
 * beside Save and the receipt's words for the day. A day whose change leaves it looking the same, or
 * a row the grid did not draw, has none.
 * @param {Element|null} grid @param {Array<{date: string, type: string, value: string}>} toSave
 * @returns {Map<string, string>}
 */
export function stagedDayChanges(grid, toSave) {
    /** @type {Map<string, string>} */ const out = new Map();
    // Words for the receipt, never a reason a save fails: a grid it cannot read gives none, and the receipt
    // falls back to its own description of each day.
    if (typeof grid?.querySelector !== 'function') return out;
    for (const e of toSave) {
        const row = /** @type {HTMLElement|null} */ (grid?.querySelector(`.day-row[data-date="${e.date}"]`) ?? null);
        const before = row?.dataset.nowShows;
        if (!row || before == null) continue;
        const after = resolveDayShift({ type: e.type, value: e.value }, row.dataset.baseShift ?? '', isSunday(e.date),
            row.dataset.xmasDue === '1', isChristmasOrBoxingDay(e.date)).shift;
        if (after && after !== before) out.set(e.date, changeWords(before, after));
    }
    return out;
}

/** The staged days' changes for the PREVIEW: the collector run on read-only stand-ins for the rows,
 *  so a row still being typed into is never marked as an error before Save is pressed.
 *  @param {HTMLElement[]} rows @param {string} memberName @param {Element|null} grid */
export function previewChanges(rows, memberName, grid) {
    const quiet = rows.map(r => ({ dataset: r.dataset, querySelector: (/** @type {string} */ q) => r.querySelector(q),
        querySelectorAll: (/** @type {string} */ q) => r.querySelectorAll(q),
        classList: { contains: (/** @type {string} */ c) => r.classList.contains(c), add() {}, remove() {} } }));
    // A preview never stands in the way of Save: a row it cannot read (half drawn, a field missing) gives no
    // lines, and the count above still says what is staged.
    try {
        const { toSave } = collectWeekRows({ rows: /** @type {any} */ (quiet), memberName, formatDate: formatDisplay });
        return stagedDayChanges(grid, toSave);
    } catch { return new Map(); }
}

