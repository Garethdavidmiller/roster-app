// @ts-check
/**
 * roster-review-rows.js — one roster review row's markup, per cell state: what the admin sees for a
 * day of the imported week, and the controls they answer it with.
 *
 * Owns: `reviewRow` — the row's classes and inner HTML for a DIFF, REMOVE_IMPORT, GUARDED,
 *   UNREADABLE (with or without readings to offer) or CONFLICT cell.
 * Does NOT own: which state a cell is in or what is ticked (`computeCellStates`, roster-review-states.js),
 *   the GUARDED row's own markup (`guardedRowHtml`, beside it there), the entry control
 *   (roster-entry-control.js), the badges (`shiftDisplay` / `manualShiftDisplay`, admin-roster-upload.js,
 *   handed in), or any click — admin-roster-upload.js draws the row and wires it.
 * Read first: `.claude/rules/roster-import.md` — the import's whole contract.
 * Tested by admin-roster-upload.test.mjs (`reviewRow`).
 *
 * ── WHY IT LEFT THE COORDINATOR (25 Nov 2026) ───────────────────────────────────────────────────
 *
 * admin-roster-upload.js held the five rows' markup inline in its render loop, a hundred lines between
 * reading the week and wiring the clicks, where no test could reach it without a page. It is pure — a
 * cell state in, markup out — so it sits beside `guardedRowHtml`, the one row that had already left.
 * The reasoning for each row's controls moved with it, beside the branch that draws it.
 *
 * ── WHAT A ROW MAY NEVER DO ─────────────────────────────────────────────────────────────────────
 *
 * Show a default it does not have. A DIFF or REMOVE_IMPORT row's tick reads `chosen !== false`, so an
 * unticked row (a drifted member, an admin's skip, Christmas) is drawn unticked; a CONFLICT starts on
 * "Keep saved"; an UNREADABLE row with readings starts on NEITHER, because there is no safe default.
 * The row draws `chosen` — it never decides it.
 */

import { escapeHtml as esc } from './roster-data.js';
import { entryControlHtml, entryLeftAsRest } from './roster-entry-control.js';
import { guardedRowHtml, unreadableTagClass, CHRISTMAS_NOTE } from './roster-review-states.js';

/**
 * One review row: its classes and its inner HTML.
 * @param {{ key: string, s: any, date: string, dayName: string, dateStr: string,
 *           shiftDisplay: (shift: string, date?: string|null) => string,
 *           manualShiftDisplay: (s: any) => string }} a
 *   `key` is `member|date`; `s` that cell's state; `dayName` / `dateStr` how the day is named ("Mon",
 *   "2 Nov"); the two displays draw a value's badge (admin-roster-upload.js).
 * @returns {{ className: string, html: string }}
 */
export function reviewRow({ key, s, date, dayName, dateStr, shiftDisplay, manualShiftDisplay }) {
    /** @type {string[]} */
    const cls = ['roster-change-row'];
    if (s.state === 'CONFLICT') cls.push('roster-change-conflict');
    else if (s.state === 'DIFF' || s.state === 'REMOVE_IMPORT') cls.push('roster-change-diff');
    /** @type {string} */ let html;   // every branch below draws one
    if (s.state === 'DIFF') {
        const approved = s.chosen !== false;
        if (!approved) cls.push('is-skipped');
        html = `
            <button type="button" class="roster-tick${approved ? '' : ' off'}" data-key="${esc(key)}" aria-pressed="${approved}" aria-label="Save this change">${approved ? '✓' : ''}</button>
            <div class="roster-chg-day">
                <span class="roster-day-abbr">${dayName}</span>
                <span class="roster-day-date">${dateStr}</span>
            </div>
            <div class="roster-chg-vals">
                <span class="roster-from-val">${shiftDisplay(s.baseShift)}</span>
                <span class="roster-to-val"><span class="roster-arrow" aria-hidden="true">→</span>${shiftDisplay(s.displayShift ?? s.parsedShift, date)}</span>
                ${s.christmas ? `<span class="roster-remove-note">${CHRISTMAS_NOTE}</span>` : ''}
            </div>
            <span class="roster-act act-update">Update</span>`;
    } else if (s.state === 'REMOVE_IMPORT') {
        // A stale previous PDF import whose day now matches the base roster. Approving
        // DELETES the stale override (writes nothing) so it can't mask a future base change.
        // from = the currently-saved import value, to = the base it now matches.
        const approved = s.chosen !== false;
        if (!approved) cls.push('is-skipped');
        html = `
            <button type="button" class="roster-tick${approved ? '' : ' off'}" data-key="${esc(key)}" aria-pressed="${approved}" aria-label="Clear this old entry">${approved ? '✓' : ''}</button>
            <div class="roster-chg-day">
                <span class="roster-day-abbr">${dayName}</span>
                <span class="roster-day-date">${dateStr}</span>
            </div>
            <div class="roster-chg-vals">
                <span class="roster-from-val">${manualShiftDisplay(s)}</span>
                <span class="roster-to-val"><span class="roster-arrow" aria-hidden="true">→</span>${shiftDisplay(s.baseShift, date)}</span>
                <span class="roster-remove-note">${s.christmas ? CHRISTMAS_NOTE : 'no longer on the roster'}</span>
            </div>
            <span class="roster-act act-clear">Clear old</span>`;
    } else if (s.state === 'GUARDED') {
        // Said / did / why, plus the rest-day swap question (v24.42) — roster-review-states.js.
        cls.push('roster-change-guarded');
        html = guardedRowHtml({ key, s, dayName, dateStr, badgeHtml: shiftDisplay(s.parsedShift, date), esc });
    } else if (s.state === 'UNREADABLE' && s.options) {
        // The two reads disagreed and we know BOTH readings — offer them rather than a
        // dead end (owner, Jul 2026: "there is no way to choose the correct option from
        // the results screen"). Same control as a CONFLICT row, with one difference that
        // matters: there is no safe default here, so it starts on NEITHER. `chosen` stays
        // null until the admin picks, and null still writes nothing — the pre-v19.32
        // behaviour is exactly what you get by leaving it alone.
        const picked = typeof s.chosen === 'number' ? s.chosen : -1;
        if (picked < 0) cls.push('roster-change-unreadable');
        html = `
            <div class="roster-choicebox">
                <div class="roster-cb-day">
                    <div class="roster-chg-day">
                        <span class="roster-day-abbr">${dayName}</span>
                        <span class="roster-day-date">${dateStr}</span>
                    </div>
                    <span class="roster-act ${unreadableTagClass(s)}">${picked < 0 && s.chosen !== 'entered' ? "Couldn't read" : 'Your choice'}</span>
                </div>
                ${s.isManual && s.manualValue ? `<div class="roster-cb-opt">
                    <span class="roster-cb-lab">Saved</span>
                    <span class="roster-cv-manual">${manualShiftDisplay(s)}</span>
                </div>` : ''}
                <div class="roster-pick" role="group" aria-label="Choose the correct value">
                    ${s.options.map(/** @param {any} o @param {number} i */ (o, i) => `<button type="button" class="roster-choice-btn ${picked === i ? 'is-chosen' : ''}" data-key="${esc(key)}" data-opt="${i}" aria-pressed="${picked === i}">${shiftDisplay(o.display, date)}</button>`).join('')}
                    <button type="button" class="roster-choice-btn roster-choice-btn--skip ${picked < 0 && s.chosen !== 'entered' ? 'is-chosen' : ''}" data-key="${esc(key)}" data-opt="skip" aria-pressed="${picked < 0 && s.chosen !== 'entered'}">Skip</button>
                    <button type="button" class="roster-choice-btn roster-choice-btn--enter ${s.chosen === 'entered' ? 'is-chosen' : ''}${s.draft?.open ? ' is-open' : ''}" data-key="${esc(key)}" data-opt="enter" data-idle="Neither — enter it" data-done="Entered — change it" aria-pressed="${s.chosen === 'entered'}">${s.chosen === 'entered' && s.entered ? 'Entered — change it' : 'Neither — enter it'}</button>
                </div>
                ${s.draft?.open ? entryControlHtml(key, s, date) : ''}
            </div>`;
    } else if (s.state === 'UNREADABLE') {
        // No readings to offer: the cell couldn't be parsed. No tick, and nothing is written
        // unless the admin enters the day below (roster-entry-control.js).
        cls.push('roster-change-unreadable', 'roster-change-row--stacked');
        // The head keeps the ordinary day/value pairing side by side; the ROW becomes a
        // column so the entry control sits underneath at full width. Without the wrapper
        // the row's own flex made the pills a ~90px vertical column (measured — the
        // layout reads fine in the source, which is why this needed a screenshot).
        html = `
            <div class="roster-unread-head">
                <div class="roster-chg-day">
                    <span class="roster-day-abbr">${dayName}</span>
                    <span class="roster-day-date">${dateStr}</span>
                </div>
                <span class="roster-act ${entryLeftAsRest(s) ? 'act-none' : unreadableTagClass(s)}">${s.chosen === 'entered' && s.entered ? 'Your entry' : entryLeftAsRest(s) ? 'Not recorded' : "Couldn't read"}</span>
                <div class="roster-chg-vals">
                    ${shiftDisplay(s.parsedShift)}
                    <span class="roster-remove-note">${s.chosen === 'entered' && s.entered
                        ? '\u2713 you entered the shift below'
                        : entryLeftAsRest(s) ? 'a rest day \u2014 nothing is recorded' : 'check the paper roster, or enter it below'}</span>
                </div>
            </div>
            ${s.isManual && s.manualValue ? `<div class="roster-cb-opt">
                <span class="roster-cb-lab">Saved</span>
                <span class="roster-cv-manual">${manualShiftDisplay(s)}</span>
            </div>` : ''}
            <button type="button" class="roster-choice-btn roster-choice-btn--enter ${s.chosen === 'entered' ? 'is-chosen' : ''}${s.draft?.open ? ' is-open' : ''}" data-key="${esc(key)}" data-opt="enter" data-idle="Enter the shift" data-done="Entered — change it" aria-pressed="${s.chosen === 'entered'}">${s.chosen === 'entered' && s.entered ? 'Entered — change it' : 'Enter the shift'}</button>
            ${s.draft?.open ? entryControlHtml(key, s, date) : ''}`;
    } else {
        // CONFLICT — you already recorded something that differs from the new roster.
        // Defaults to keeping yours (chosen='manual', writes nothing); "Use new roster"
        // switches to chosen='pdf'. Plain labels replace the old Manual/PDF jargon; the
        // data-pick values are unchanged so the save path is identical.
        const usesPDF = s.chosen === 'pdf';
        html = `
            <div class="roster-choicebox">
                <div class="roster-cb-day">
                    <div class="roster-chg-day">
                        <span class="roster-day-abbr">${dayName}</span>
                        <span class="roster-day-date">${dateStr}</span>
                    </div>
                    <span class="roster-act act-choice">Your choice</span>
                </div>
                <div class="roster-cb-opt">
                    <span class="roster-cb-lab">Saved</span>
                    <span class="roster-cv-manual${usesPDF ? ' cv-dim' : ''}">${manualShiftDisplay(s)}</span>
                </div>
                <div class="roster-cb-opt">
                    <span class="roster-cb-lab">New roster</span>
                    <span class="roster-cv-pdf${usesPDF ? '' : ' cv-dim'}">${shiftDisplay(s.displayShift ?? s.parsedShift, date)}</span>
                </div>
                <div class="roster-pick" role="group" aria-label="Resolve conflict">
                    <button type="button" class="roster-choice-btn ${!usesPDF ? 'is-chosen' : ''}" data-key="${esc(key)}" data-pick="manual" aria-pressed="${!usesPDF}">Keep saved</button>
                    <button type="button" class="roster-choice-btn ${usesPDF ? 'is-chosen' : ''}" data-key="${esc(key)}" data-pick="pdf" aria-pressed="${usesPDF}">Use new roster</button>
                </div>
            </div>`;
    }
    return { className: cls.join(' '), html };
}
