// @ts-check
/**
 * roster-entry-control.js — answering an unreadable roster cell where the question is asked.
 *
 * Owns: the little type-pill + times editor that appears under an UNREADABLE review row, and the
 *   one rule about when a half-finished entry becomes a value.
 * Does NOT own: what an unreadable cell IS (admin-roster-upload.js), the value grammar
 *   (`manualCellValue`, override-utils.js) or the guards (`normaliseCellValue`, roster-cell-rules.js).
 * Edit here for: the control's markup, or what it says while incomplete.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────────────────────────
 *
 * An unreadable cell with no candidate readings was a DEAD END: the row said "check the paper
 * roster" and the only way to act on it was to finish the review, leave for the Admin page, and
 * remember the person and the day. v22.16 made that worse rather than better — an unmarked Sunday
 * time is now routed into the same state deliberately, so the traffic through the dead end went up.
 *
 * ── THE THREE RULES ────────────────────────────────────────────────────────────────────────────
 *
 * 1. **The pills are generated from `PILL_TYPES`** — the ONE declaration of which pills exist and
 *    in what order — so this control and Change a Shift cannot drift apart. `other` is dropped
 *    because its `FLAVOUR[" RDW"][" HH:MM-HH:MM"]` grammar needs sub-controls only the week editor
 *    has; the control SAYS so rather than offering a pill that does nothing.
 * 2. **Sunday exclusions are consulted, never restated.** `isForbiddenOnSunday` is the list; it has
 *    six numbered enforcement layers already and a seventh copy is how one of them goes stale.
 * 3. **An entry passes the guards a parsed value passes.** `commitEntry` composes through
 *    `manualCellValue` and then `normaliseCellValue` (roster-cell-rules.js), so entering a value can
 *    never be a route to write something the parsed path would have refused.
 *
 * ── WHY THE TIMES ARE TEXT AND NOT `<input type="time">` ───────────────────────────────────────
 *
 * `type="time"` was written first — it validates by construction and needs no formatter, which is a
 * real argument. It was replaced on a MEASUREMENT. Chromium renders that control from the OS/browser
 * format settings, not from the page, so it showed `06:00 AM` / `02:00 PM` even with
 * `navigator.language` forced to `en-GB` (checked, because the obvious explanation — an en-US test
 * browser — turned out to be the wrong one). Every other time on this page is 24-hour, and the shift
 * badges beside this control read `13:30-21:00`, so a 12-hour box in the one place the admin TYPES
 * is both inconsistent and genuinely ambiguous.
 *
 * Text does not weaken the guard: `manualCellValue` requires `HH:MM` on both boxes, so a half-typed
 * or malformed time simply produces no entry and writes nothing. What it needs instead is to SAY
 * so, which is what the hint under the boxes is for — and what `patchEntryRow` keeps true as the
 * admin types, because a re-render would destroy the field they are typing into.
 */

import { escapeHtml as esc, isSunday } from './roster-data.js';
import { TYPES, PILL_TYPES } from './admin-shift-types.js';
import { manualCellValue, isForbiddenOnSunday } from './override-utils.js';
import { normaliseCellValue } from './roster-cell-rules.js';

/** What the hint under the time boxes says, in both of its states. */
const HINT_DONE = '\u2713 this day will be saved';
const HINT_TODO = 'Enter both times in 24-hour form, e.g. 06:20';

/**
 * The in-place "enter it myself" control for an unreadable cell (v22.17).
 *
 * WHY IT EXISTS. An unreadable cell with no candidate readings was a dead end: the row said
 * "check the paper roster" and the only way to act was to finish the review, leave for the
 * Admin page, and remember the person and the day. v22.16 made that worse rather than better —
 * an unmarked Sunday time is now routed here deliberately, so the traffic through the dead end
 * went up. Answering it where the question is asked is the fix.
 *
 * The pills are generated from `PILL_TYPES` — the ONE declaration of which pills exist and in
 * what order — so this row and Change a Shift cannot drift apart, and `other` is dropped
 * because its grammar needs sub-controls only the week editor has (see `manualCellValue`).
 * Sunday exclusions come from `isForbiddenOnSunday`, consulted rather than restated: that list
 * has six numbered enforcement layers and a seventh copy is how one of them goes stale.
 *
 * ── WHY THE TIMES ARE TEXT AND NOT `<input type="time">` ───────────────────────────────────
 *
 * `type="time"` was written first — it validates by construction and needs no formatter, which
 * is a real argument. It was replaced on a MEASUREMENT. Chromium renders that control from the
 * OS/browser format settings, not from the page, so it showed `06:00 AM` / `02:00 PM` even with
 * `navigator.language` forced to `en-GB` (checked, because the obvious explanation — an en-US
 * test browser — turned out to be the wrong one). Every other time on this page is 24-hour, and
 * the shift badges beside this control read `13:30-21:00`, so a 12-hour box in the one place the
 * admin TYPES is both inconsistent and genuinely ambiguous.
 *
 * Text does not weaken the guard: `manualCellValue` requires `HH:MM` on both boxes, so a
 * half-typed or malformed time simply produces no entry and writes nothing. What it needs
 * instead is to SAY so, which is what the hint under the boxes is for.
 *
 * @param {string} key @param {any} s @param {string} date
 */
export function entryControlHtml(key, s, date) {
    const d = s.draft || { type: null, from: '', to: '' };
    const sun = isSunday(date);
    const pills = PILL_TYPES.filter(t => t !== 'other').map(t => {
        const off = sun && isForbiddenOnSunday(t);
        return `<button type="button" class="roster-entry-pill${d.type === t ? ' is-on' : ''}"
            data-key="${esc(key)}" data-entry-type="${t}" aria-pressed="${d.type === t}"
            ${off ? 'disabled title="Not allowed on a Sunday — Sunday work is RDW"' : ''}>${esc(TYPES[t].pill)}</button>`;
    }).join('');
    const needsTime = d.type === 'shift' || d.type === 'rdw';
    return `<div class="roster-entry" data-key="${esc(key)}">
        <div class="roster-entry-pills" role="group" aria-label="Choose the shift type">${pills}</div>
        ${needsTime ? `<div class="roster-entry-times">
            <input type="text" class="roster-entry-time" data-key="${esc(key)}" data-part="from"
                   value="${esc(d.from)}" inputmode="numeric" maxlength="5" placeholder="HH:MM"
                   autocomplete="off" aria-label="Start time (24-hour, HH:MM)">
            <span class="roster-entry-dash" aria-hidden="true">–</span>
            <input type="text" class="roster-entry-time" data-key="${esc(key)}" data-part="to"
                   value="${esc(d.to)}" inputmode="numeric" maxlength="5" placeholder="HH:MM"
                   autocomplete="off" aria-label="End time (24-hour, HH:MM)">
        </div>
        <p class="roster-entry-hint">${manualCellValue(d.type, d.from, d.to)
            ? '\u2713 this day will be saved'
            : 'Enter both times in 24-hour form, e.g. 06:20'}</p>` : ''}
        <p class="roster-entry-note">A training or other day? Use <strong>Change a Shift</strong> on the Admin page.</p>
    </div>`;
}


/**
 * Keep a row honest while the admin types (v22.17).
 *
 * The keystroke path deliberately does NOT re-render — that would destroy the input being typed
 * into — so without this the row went on reading "Not saved · couldn't read — check the paper
 * roster" while the summary above had already counted the entry. The screen contradicted itself.
 *
 * @param {Element|null|undefined} rowEl @param {boolean} done
 */
export function patchEntryRow(rowEl, done) {
    if (!rowEl) return;
    const act = rowEl.querySelector('.roster-act');
    if (act) {
        act.textContent = done ? 'Your entry' : "Couldn't read";
        act.classList.toggle('act-choice', done);
        act.classList.toggle('act-read', !done);
    }
    const note = rowEl.querySelector('.roster-remove-note');
    if (note) note.textContent = done
        ? '\u2713 you entered the shift below'
        : 'check the paper roster, or enter it below';
    const btn = rowEl.querySelector('.roster-choice-btn--enter');
    if (btn) {
        btn.textContent = done ? 'Entered — change it' : 'Enter the shift';
        btn.classList.toggle('is-chosen', done);
        btn.setAttribute('aria-pressed', String(done));
    }
    const hint = rowEl.querySelector('.roster-entry-hint');
    if (hint) hint.textContent = done ? HINT_DONE : HINT_TODO;
    rowEl.classList.toggle('roster-change-unreadable', !done);
}

/**
 * Turn the in-progress draft into a committed entry, or into nothing (v22.17).
 *
 * The composed value goes through `normaliseCellValue` — the SAME guards an ordinary parsed value
 * gets (the Sunday rewrite, the absence-on-a-rest-day rewrite, the RDW display marker). Entering a
 * value must never be a route to write something the parsed path would have refused; the pick
 * control already works this way and this joins it.
 *
 * @param {any} s a cell state
 */
export function commitEntry(s) {
    const d = s.draft || {};
    const raw = d.type ? manualCellValue(d.type, d.from, d.to) : null;
    if (!raw) { s.entered = null; if (s.chosen === 'entered') s.chosen = null; return; }
    s.entered = normaliseCellValue(raw, s.baseShift, s.date);
    s.chosen  = 'entered';
}
