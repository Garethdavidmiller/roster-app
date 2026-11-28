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
 *
 * ── THE PREVIEW IS THE SAVE'S OWN PLAN ──────────────────────────────────────────────────────────
 *
 * Leave staged on a rest day answered "No — rest day, nothing recorded" is not written (`planAlWeekSave`, admin-al-week-save.js),
 * and the preview once read the collector alone, so it promised "Rest day → Annual leave" over a save that wrote
 * nothing and a receipt that said "rest day, no leave recorded". The preview runs the same planner on the same
 * answers and says each day it leaves alone in the receipt's words (`leftAloneWords`) — .claude/rules/admin.md: the
 * answer must reach every layer. And an absence the Calendar will not draw — on a rest day, with nothing contracted
 * under it — is said as what the Calendar shows (`hiddenAbsenceWords`), here and in the receipt, never "Absent".
 */
import { isSunday, teamMembers, escapeHtml } from './roster-data.js';
import { isChristmasOrBoxingDay, parseOtherValue } from './override-utils.js';
import { resolveDayShift } from './christmas-leave.js';
import { replacedTypeOnWrite } from './al-swapped-days.js';
import { collectWeekRows } from './admin-week-collect.js';
import { changeWords, hiddenAbsenceWords, leftAloneWords } from './admin-save-receipt.js';
import { planAlWeekSave } from './admin-al-week-save.js';
import { formatDisplay } from './admin-period-dates.js';
import { drawnDays } from './admin-week-row-state.js';

/**
 * A day as the Calendar draws it, as ONE value the receipt's words read (`dayWords`): the resolver's `shift` WITH its
 * hours slot (`rdwTime`). Rest Day Working, and a timed shift on a Sunday, resolve to the bare `'RDW'` with their hours
 * in `rdwTime`, so `.shift` alone said "Rest day → RDW" where the Calendar draws "RDW 09:00-17:00". An Other day with
 * no hours of its own shows the slot beneath its badge too — "RDW" on a rest day, else the base shift's time — so it
 * is put back into the Other grammar (`FLAVOUR[" RDW"][" HH:MM-HH:MM"]`), which `dayWords` already reads.
 * @param {{ shift: string, rdwTime?: string }} resolved what `resolveDayShift` answers @returns {string}
 */
export function shownValue({ shift, rdwTime = '' }) {
    const time = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(rdwTime) ? rdwTime : '';
    if (shift === 'RDW') return time ? `RDW ${time}` : 'RDW';
    const other = parseOtherValue(shift);
    if (!other || other.time) return shift;
    if (rdwTime === 'RDW') return other.rdw ? shift : `${shift} RDW`;
    return time ? `${shift} ${time}` : shift;
}

/**
 * What a row's day shows NOW, as `shownValue` says it: the before half of the line, stamped on the row as the week
 * editor draws it (`data-now-shows`). The same resolver, with the same inputs, as the after half below.
 * @param {any} existing the record the row is drawn from, or null @param {string} baseShift @param {string} dateISO
 * @param {boolean} xmasDue @returns {string}
 */
export function nowShows(existing, baseShift, dateISO, xmasDue) {
    return shownValue(resolveDayShift(existing ?? null, baseShift, isSunday(dateISO), xmasDue, isChristmasOrBoxingDay(dateISO)));
}

/**
 * Each staged day's before → after (`changeWords`), as the Calendar would draw it, by date: the line
 * beside Save and the receipt's words for the day. A day whose change leaves it looking the same, or
 * a row the grid did not draw, has none — except an absence the Calendar hides, which is written and so
 * is said as what the day will show (`hiddenAbsenceWords`).
 *
 * THE AFTER IS THE RECORD THE SAVE WRITES, `replacedType` included (`replacedTypeOnWrite`, the save's own call): an
 * absence on a rest day shows only when it replaced contracted work, so an absence staged over a swapped-in shift, an
 * Other day or a Spare turn is drawn Absent — and resolved from its type and value alone it read "Rest day".
 * @param {Element|null} grid
 * @param {Array<{date: string, type: string, value: string, swapped?: boolean}>} toSave
 * @param {Map<string, any>} [drawn] date → the record each row was drawn from (`drawnDays`), what the save replaces
 * @returns {Map<string, string>}
 */
export function stagedDayChanges(grid, toSave, drawn) {
    /** @type {Map<string, string>} */ const out = new Map();
    // Words for the receipt, never a reason a save fails: a grid it cannot read gives none, and the receipt
    // falls back to its own description of each day.
    if (typeof grid?.querySelector !== 'function') return out;
    const under = drawn ?? (typeof grid.querySelectorAll === 'function' ? drawnDays(/** @type {HTMLElement} */ (grid)) : new Map());
    for (const e of toSave) {
        const row = /** @type {HTMLElement|null} */ (grid?.querySelector(`.day-row[data-date="${e.date}"]`) ?? null);
        const before = row?.dataset.nowShows;
        if (!row || before == null) continue;
        const written = { type: e.type, value: e.value, replacedType: replacedTypeOnWrite(under.get(e.date) ?? null, e.type, e.swapped) };
        const after = nowShows(written, row.dataset.baseShift ?? '', e.date, row.dataset.xmasDue === '1');
        if (!after) continue;
        if (e.type === 'sick' && after !== 'SICK') out.set(e.date, hiddenAbsenceWords(before, after, e.date));
        else if (after !== before) out.set(e.date, changeWords(before, after));
    }
    return out;
}

/**
 * The staged days' changes for the PREVIEW: the collector run on read-only stand-ins for the rows, so a row still
 * being typed into is never marked as an error before Save is pressed — and then the save's own leave plan
 * (`planAlWeekSave`, as the Save handler calls it), so a day it leaves alone is said as the receipt will say it.
 * `leftAlone` are those days — staged, and not written — which the preview's count leaves out (`gridPreviewHtml`).
 * @param {HTMLElement[]} rows @param {string} memberName @param {Element|null} grid
 * @param {Map<string, any>|null} [ovByDate] the member's records in play (`buildMemberDateMap`), which the plan reads
 * @returns {{ changes: Map<string, string>, leftAlone: string[] }}
 */
export function previewChanges(rows, memberName, grid, ovByDate = null) {
    const quiet = rows.map(r => ({ dataset: r.dataset, querySelector: (/** @type {string} */ q) => r.querySelector(q),
        querySelectorAll: (/** @type {string} */ q) => r.querySelectorAll(q),
        classList: { contains: (/** @type {string} */ c) => r.classList.contains(c), add() {}, remove() {} } }));
    // A preview never stands in the way of Save: a row it cannot read (half drawn, a field missing) gives no
    // lines, and the count above still says what is staged.
    try {
        const { toSave, toDelete, swapAnswers } = collectWeekRows({ rows: /** @type {any} */ (quiet), memberName, formatDate: formatDisplay });
        const member = teamMembers.find(m => m.name === memberName);
        const plan = member ? planAlWeekSave({ member, memberName, toSave, toDelete, ovByDate, swapAnswers }) : null;
        const free = new Set(plan?.skipped ?? []), kept = new Set(plan?.keptLeave ?? []);
        const out = stagedDayChanges(grid, toSave);
        for (const d of free) out.set(d, leftAloneWords(d, kept.has(d)));   // the save writes no leave there
        return { changes: out, leftAlone: [...free] };
    } catch (err) {
        console.error('[Admin] The change preview could not read the week grid:', err);
        return { changes: new Map(), leftAlone: [] };
    }
}

/**
 * The preview beside Save as HTML, with the signature it is redrawn on: what is about to happen, naming the member,
 * so a wrong person or count is caught before saving — and, for a few days, what each becomes (`previewChanges`).
 * THE VERB BELONGS TO EACH CLAUSE, so every combination is a sentence. The preview is a live region that is asked on
 * every keystroke, so the caller rewrites it (and it is re-announced) only when `sig` changes.
 *
 * THE COUNT IS WHAT THE SAVE WRITES, not what is staged: a day the plan leaves alone (`leftAlone`, leave on a rest day
 * answered "No — rest day, nothing recorded") is staged and never written, so one such day said "You're about to
 * change 1 day" over a receipt saying "Nothing to record". With nothing written and nothing removed, it says so.
 * @param {{ saveCount: number, delCount: number, memberName: string, changes: Map<string, string>, leftAlone?: number }} args
 *   `saveCount` the staged rows; `leftAlone` how many of them the save's plan leaves alone
 * @returns {{ html: string, sig: string }}
 */
export function gridPreviewHtml({ saveCount, delCount, memberName, changes, leftAlone = 0 }) {
    const writes = Math.max(0, saveCount - leftAlone);
    const bits = [];
    if (writes)   bits.push(`change <strong>${writes} day${writes > 1 ? 's' : ''}</strong>`);
    if (delCount) bits.push(`remove <strong>${delCount} change${delCount > 1 ? 's' : ''}</strong>`);
    const dayLines = [...changes].sort(([a], [b]) => a.localeCompare(b))
        .map(([d, words]) => `<li>${escapeHtml(formatDisplay(d))}: ${escapeHtml(words)}</li>`).join('');
    const who = `<strong>${escapeHtml(memberName)}</strong>`;
    const lead = bits.length ? `You're about to ${bits.join(' and ')} for ${who}.` : `Nothing will be recorded for ${who}${dayLines ? ':' : '.'}`;
    // A list inside a <span> is invalid HTML (phrasing content may not hold one): the sentence's wrapper is a <div>.
    return { sig: `${writes}|${delCount}|${memberName}|${dayLines}`,
        html: `<span aria-hidden="true">🗓️</span> <div>${lead}`
            + (dayLines ? `<ul class="grid-preview-days">${dayLines}</ul>` : '') + '</div>' };
}
