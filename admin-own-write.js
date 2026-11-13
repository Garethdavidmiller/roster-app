// @ts-check
/**
 * admin-own-write.js — WHAT A WRITE THIS PAGE MAKES ITSELF DOES TO THE WEEK ON SCREEN.
 *
 * Owns: bringing Change a Shift's week grid into line after one of the page's OWN writes that is not
 *   the week's own save — a Saved Changes delete (one row, the ticked rows, or the part of a ticked
 *   delete that landed), a Recorded dates delete, a leave or absence range (or the part that landed)
 *   and a leave-year move — and the words for a staged change that write cleared.
 * Does NOT own: the writes; drawing the week (admin-week-editor.js, injected through `initOwnWrite`,
 *   so this module loads in Node); a row's states (admin-week-row-state.js).
 * Edit here for: what happens to a staged row when the page itself changes its day.
 *
 * ── THE DEFECT IT CLOSES (Nov 2026, review) ─────────────────────────────────────────────────────
 *
 * The week save is CHECKED (v25.89/v25.90): each day it writes or clears must still hold the record
 * its ROW was drawn from (`drawnDays`, admin-week-row-state.js; `commitChecked`,
 * admin-override-store.js). Each write above left the grid alone while a change was staged in it, so
 * as not to throw that change away (v16.82). Together they refused the admin's own work: a row went on
 * comparing with a record the page had itself just deleted or replaced, the next Save said "Someone
 * else has changed …", and its advice — reload — discarded every staged change.
 *
 * ── THE RULE: ONLY THE DAYS THE WRITE TOUCHED ───────────────────────────────────────────────────
 *
 * Nothing staged: the whole week is redrawn, as it always was. Something staged: only the rows of the
 * days the write touched are looked at, each against what the day holds NOW (the cache, which the
 * write has just updated, read by drawing the week afresh), and only a row whose record changed is
 * replaced — with exactly the row a full redraw would draw. Every other row, staged or not, keeps the
 * record it was drawn from, and that is what keeps a COLLEAGUE'S change refused exactly as before: a
 * read that brought it into the page under a staged row never redraws that row, and nor does a write
 * to another day. Redrawing the week and putting the staged rows back would have put the colleague's
 * record under the staged edit, and the save would then have written over it.
 *
 * ── A STAGED CHANGE ON A DAY THE WRITE CHANGED IS CLEARED AND NAMED, NEVER SAVED OVER IT ────────
 *
 * It was made over one version of the day. Saving it over another would silently undo what the page
 * has just done — a leave booking turned back into the shift typed before it, a leave-year move
 * reversed, an import a delete uncovered replaced unseen. So the day is drawn as it now stands and the
 * card that made the write names it: "Your unsaved change to Mon 24 Aug in Change a Shift was cleared,
 * because that day has just changed. Set it again if you still want it." The other staged rows stay,
 * and the day set again saves, because its row now compares with what the day holds. Two consequences:
 *   · a staged REMOVAL whose record the write has already removed is simply redrawn, unnamed — what it
 *     asked for has happened, and there is nothing to set again;
 *   · clearing a staged row is a change to the staged rows, so `markChanged` runs, as a tap would: it
 *     drops the over-allowance bar's captured batch, whose "Save anyway" would write the cleared change.
 * A colleague's change ALREADY in the page for a touched day surfaces the same way — the row shows it
 * and the staged change is cleared — rather than being refused at Save. Never written over: the day is
 * on screen as it is before anybody sets it again.
 *
 * Tested by admin-own-write.test.mjs (the rule, the words, the sync over a fake grid drawn by the real
 * row state) and, through each writer, admin-saved-changes.test.mjs, admin-overrides.test.mjs and
 * e2e/admin.spec.js ("THE PAGE'S OWN WRITE IS NOT A COLLEAGUE'S").
 */

import { sameOverrideRecord } from './override-compare.js';
import { drawnDays, isStagedRow, readRowDraft } from './admin-week-row-state.js';
import { namedDays } from './admin-period-dates.js';

/** The week grid's own functions, set by `initOwnWrite`. Until then nothing is drawn. */
const _deps = {
    /** @type {(container: HTMLElement, dateStr: string) => void} */ build: () => {},
    /** @type {() => void} */ redraw: () => {},
    /** @type {() => void} */ recount: () => {},
    /** @type {() => boolean} */ hasStagedEdits: () => false,
    /** @type {() => void} */ markChanged: () => {},
};

/**
 * Wire the week grid in — by `initOverrides` (admin-overrides.js), beside the editor and the list.
 * @param {{ build: (container: HTMLElement, dateStr: string) => void, redraw: () => void, recount: () => void,
 *           hasStagedEdits: () => boolean, markChanged: () => void }} deps  `build` draws a week into a
 *        container (`buildWeekGridInto`), `redraw` the whole grid (`renderWeekGrid`), `recount` the Save
 *        button and its bars (`updateSaveBtn`); `markChanged` says the staged rows changed, as a tap does
 * @returns {void}
 */
export function initOwnWrite(deps) { Object.assign(_deps, deps); }

/**
 * What the row of one day the page's own write touched does (pure; header).
 * @param {{ drawn: any, now: any, staged: import('./admin-week-row-state.js').RowDraft|null }} day  `drawn`:
 *        the record the row was drawn from, or null; `now`: the day's record now, or null; `staged`: the
 *        row's staged change (`readRowDraft`), or null
 * @returns {'keep'|'redraw'|'clear'} `keep`: the day did not change, so the row stays as it is; `redraw`:
 *          draw it as it now stands; `clear`: the same, clearing a staged change, which is named
 */
export function ownWriteRowAction({ drawn, now, staged }) {
    if (drawn ? sameOverrideRecord(drawn, now) : !now) return 'keep';
    return !staged || (staged.remove && !now) ? 'redraw' : 'clear';
}

/**
 * Bring the week on screen into line with a write this page has just made (header). Call it once the
 * write has landed AND the cache holds its result.
 * @param {Iterable<any>} rows  the records the write deleted or wrote — anything carrying `memberName`
 *        and `date`; a bare id, or another member's record, touches nothing on screen
 * @returns {string[]} the days whose staged change was cleared, in date order, for `withClearedDays`
 */
export function syncWeekAfterOwnWrite(rows) {
    const grid   = document.getElementById('weekGrid');
    const member = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value;
    const week   = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'))?.value;
    if (!member || !week) return [];
    if (!_deps.hasStagedEdits()) { _deps.redraw(); return []; }
    const dates = new Set([...rows].filter(r => r && typeof r === 'object' && r.memberName === member && r.date).map(r => String(r.date)));
    if (!grid || !dates.size) return [];
    const fresh = document.createElement('div');
    _deps.build(fresh, week);
    const before = drawnDays(grid), after = drawnDays(fresh);
    /** @type {string[]} */ const cleared = [];
    let replaced = 0, stagedGone = false;
    for (const date of dates) {
        const row  = /** @type {HTMLElement|null} */ (grid.querySelector(`.day-row[data-date="${date}"]`));
        const next = /** @type {HTMLElement|null} */ (fresh.querySelector(`.day-row[data-date="${date}"]`));
        if (!row || !next) continue;   // not in the week on screen
        const act = ownWriteRowAction({ drawn: before.get(date) ?? null, now: after.get(date) ?? null, staged: readRowDraft(row) });
        if (act === 'keep') continue;
        if (isStagedRow(row)) stagedGone = true;
        else if (/** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'))?.checked) {
            // A tick on an unstaged row is the manager's choice of the day for Apply: it goes with the day.
            const cb = /** @type {HTMLInputElement|null} */ (next.querySelector('.day-cb'));
            if (cb) { cb.checked = true; if (!next.dataset.type) next.classList.add('selected'); }
        }
        row.replaceWith(next);
        replaced++;
        if (act === 'clear') cleared.push(date);
    }
    if (stagedGone) _deps.markChanged();
    if (replaced) _deps.recount();
    return cleared.sort();
}

/**
 * What the card that made the write says about the days whose staged change it cleared; '' for none.
 * @param {string[]} dates YYYY-MM-DD, in date order
 * @returns {string}
 */
export function clearedDaysLine(dates) {
    if (!dates.length) return '';
    return dates.length === 1
        ? `Your unsaved change to ${namedDays(dates)} in Change a Shift was cleared, because that day has just changed. Set it again if you still want it.`
        : `Your unsaved changes to ${namedDays(dates)} in Change a Shift were cleared, because those days have just changed. Set them again if you still want them.`;
}

/**
 * `text`, then `clearedDaysLine(dates)` as its next sentence; `text` alone when nothing was cleared.
 * @param {string} text @param {string[]} dates
 * @returns {string}
 */
export function withClearedDays(text, dates) {
    const line = clearedDaysLine(dates);
    return line ? `${text}${text.endsWith('.') ? '' : '.'} ${line}` : text;
}
