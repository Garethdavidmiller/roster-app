// @ts-check
/**
 * admin-week-row-state.js — WHAT A WEEK-GRID ROW LOOKS LIKE IN EACH OF ITS STATES.
 *
 * Owns: turning one `.day-row` on and off, drawing it from its saved record (`prefillRow`), and
 *   keeping the four things that depend on a row's current type in step with it — the RDW warning,
 *   the Spare submenu mode, the swapped-day question, and the overwrite badge. And, since the iPhone
 *   audit (Nov 2026), a row's staged state
 *   AS DATA: `isStagedRow` (the one test of "is this row staged?") and the reading and putting back
 *   of a week's staged rows that a kept draft is made of (`readWeekDraft` / `applyWeekDraft`,
 *   unsaved-draft.js).
 * Does NOT own: which rows exist, which week is shown, the bulk bar, the draft's storage, or any save.
 * Edit here for: a new per-row control, or a change to what an active/inactive row shows. A new
 *   per-row control that a save reads must be read and put back here too, or a restored draft
 *   silently drops it.
 *
 * ── WHY IT IS ITS OWN MODULE (v23.98) ──────────────────────────────────────────────────────────
 *
 * `admin-week-editor.js` had reached its ratchet cap of 950 lines with ZERO headroom, so the next
 * change to the Admin week grid — any change — would have had to pay for an extraction first. That
 * is the worst moment to choose one: under a hard stop, the cheapest cut wins rather than the right
 * one. So it was taken deliberately, with nothing pending.
 *
 * TWO CANDIDATES WERE MEASURED, AND THE OBVIOUS ONE LOST. The bulk bar looks like the natural
 * seam — its own strip of UI, its own `bulk*` ids, its own state — but moving it needs SEVEN
 * injected dependencies (`showError`, `showSuccess`, `markChanged`, `activateRow`, `deactivateRow`,
 * `updateSaveBtn`, `memberDateMap`) for 181 lines. A boundary that has to be told about seven
 * things is not a boundary; it is a cut made to create room, which is exactly what this extraction
 * was trying to avoid.
 *
 * This cluster needs NONE. It imports the shift-type table, the Other-day grammar and the status
 * helper and nothing else — every function takes a row element and reads the DOM under it. That is what a
 * seam looks like: the functions here do not know the editor exists.
 *
 * Keep it that way. If something in here starts needing the editor's state or its injected
 * services, the seam has moved and this module is the wrong home for it.
 */

import { TYPES } from './admin-shift-types.js';
import { parseOtherValue } from './override-utils.js';
import { setStatus } from './status-text.js';

/**
 * Show the "originally rostered" warning only when the RDW tick is ON for a day whose
 * base roster is NOT a rest day (owner decision, Jul 2026: allow it — the admin may know
 * the roster is wrong — but say plainly that a real rostered shift is being repaid as RDW).
 * Rest-day rows never warn (the tick is the normal state there, pre-ticked).
 * @param {HTMLElement} row
 */
export function _syncOtherRdwWarn(row) {
    const warn = /** @type {HTMLElement|null} */ (row.querySelector('.other-rdw-warn'));
    if (!warn) return;
    const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
    const optsVisible = !(/** @type {HTMLElement|null} */ (row.querySelector('.other-opts'))?.hidden);
    warn.hidden = !(optsVisible && cb?.checked && row.dataset.baseIsRd !== '1');
}

/**
 * Reflect a "Spare" choice inside the Other submenu (v15.57 — Spare moved under Other).
 * Spare is a fixed placeholder: no RDW, no times. Reuse the `.fixed-type` machinery to hide
 * the time inputs (and show "No time needed"), and `.other-spare` to hide the RDW tick + hint.
 * Picking any Other-family flavour clears it (Other days keep their optional times). The collector
 * reads the active flavour and, when it's SPARE, writes a `spare_shift`/'SPARE' override.
 * @param {HTMLElement} row
 */
export function _syncOtherSpareMode(row) {
    const spareActive = !!row.querySelector('.other-flavour-btn.active[data-flavour="SPARE"]');
    row.classList.toggle('other-spare', spareActive);
    row.classList.toggle('fixed-type',  spareActive);
    const s = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
    const e = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
    if (s) s.tabIndex = spareActive ? -1 : 0;
    if (e) e.tabIndex = spareActive ? -1 : 0;
    _syncOtherRdwWarn(row);
}

/**
 * @param {HTMLElement} row
 * @param {HTMLInputElement|null} checkbox
 * @param {NodeListOf<Element>} pills
 * @param {HTMLInputElement|null} startEl
 * @param {HTMLInputElement|null} endEl
 * @param {string} type
 */
export function _activateRow(row, checkbox, pills, startEl, endEl, type) {
    if (checkbox) checkbox.checked = true;
    row.classList.add('active');
    row.classList.remove('selected');
    pills.forEach(p => {
        const on = (/** @type {HTMLElement} */ (p)).dataset.type === type;
        p.classList.toggle('active', on);
        p.setAttribute('aria-pressed', String(on));
    });
    if (TYPES[type]?.fixed) {
        row.classList.add('fixed-type');
        if (startEl) startEl.tabIndex = -1;
        if (endEl) endEl.tabIndex = -1;
    } else {
        row.classList.remove('fixed-type');
        if (startEl) startEl.tabIndex = 0;
        if (endEl) endEl.tabIndex = 0;
    }
    row.classList.remove('other-spare');   // clear any stale Spare-mode when (re)activating a type
    row.dataset.type = type;
    // Other-family options strip: visible only while the Other pill is active. The RDW tick
    // pre-ticks itself when the day's base roster is a rest day (OTHER_DAYS.md decision 8)
    // — smart default, still adjustable. Runs on BOTH the pill and bulk-apply paths.
    const otherOpts = /** @type {HTMLElement|null} */ (row.querySelector('.other-opts'));
    if (otherOpts) {
        otherOpts.hidden = type !== 'other';
        if (type === 'other') {
            const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
            if (cb && row.dataset.baseIsRd === '1') cb.checked = true;
        }
        _syncOtherRdwWarn(row);
        // Re-selecting Other must re-apply a Spare chip still active from before (review A18) —
        // the strip above just removed `other-spare`, so times and the RDW tick reappeared for a
        // row the collector will save as Spare.
        if (type === 'other') _syncOtherSpareMode(row);
    }
    _syncAlSwap(row);
    _syncOverwriteBadge(row);
}

/**
 * The swapped-day question (v23.75) follows the row's state, on EVERY path that changes it — the
 * pill, bulk apply, the checkbox and the bulk tick buttons (review A6). It lived in the pill
 * handler alone, so bulk-applied leave on a rest day was refused at Save with the question still
 * hidden, and an old "Swapped — counts" survived an untick into the next pick. Shown for staged
 * leave on a day `swapDecisionDates` asks about; hidden AND cleared otherwise, because a stale
 * answer would charge the next pick. A prefilled (saved, untouched) row is not being booked, so it
 * is not asked.
 * @param {HTMLElement} row
 */
export function _syncAlSwap(row) {
    const box = /** @type {HTMLElement|null} */ (row.querySelector('.col-al-swap'));
    if (!box) return;
    const ask = row.dataset.type === 'annual_leave' && row.dataset.alSwapAsk === '1'
        && !row.classList.contains('prefilled-existing');
    box.hidden = !ask;
    if (ask) return;
    delete row.dataset.alSwap;
    row.querySelectorAll('.al-swap-btn').forEach(b => b.setAttribute('aria-pressed', 'false'));
}

/**
 * Sync a day-row's overwrite badge to its state, relative to the override it was loaded with:
 *   • prefilled-existing (loaded, untouched) → "✓ Saved"    — already recorded, no change staged
 *   • active with a type   (a change staged)  → "⚠ Updating" — will overwrite the saved one on Save
 *   • deactivated          (type taken away)  → "⚠ Removing" — the saved override is deleted on Save
 * No-op on rows with no saved override (they have no .overwrite-badge).
 * @param {HTMLElement} row
 */
export function _syncOverwriteBadge(row) {
    const badge = row.querySelector('.overwrite-badge');
    if (!badge) return;
    // setStatus, not a bare assignment (v21.94): the badge's initial markup already wraps its
    // glyph in an `aria-hidden` span, and repainting it here used to replace that with a bare
    // '⚠ Updating' — so the row announced "warning sign Updating" from the second paint onwards.
    setStatus(badge, row.classList.contains('prefilled-existing') ? '✓ Saved'
        : row.dataset.type ? '⚠ Updating'
        : '⚠ Removing');
}

/**
 * Draw a row in the state its saved record puts it in — the record's type, Other flavour, RDW tick and
 * times — marked as an untouched prefill, from a clean row, so it also puts back a row edited since.
 * A Spare record shows as Other → Spare (v15.57: there is no top-level Spare pill), and an Other day is
 * read through its grammar: a naive `value.split('-')` would shred 'TRG RDW 08:00-16:00'.
 *
 * UNTICKED (owner, 10 Nov 2026): a tick means the manager chose the day for "Apply to ticked days" on
 * this visit, and a saved change is not that. A saved day opened ticked, so Apply re-typed it unasked,
 * and the only way to leave it out — unticking — also staged its deletion.
 * @param {HTMLElement} row
 * @param {{ type: string, value?: string }} existing  the record that wins the day
 */
export function prefillRow(row, existing) {
    const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
    const pills    = row.querySelectorAll('.type-pill-btn');
    const startEl  = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
    const endEl    = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
    const isSpare  = existing.type === 'spare_shift';
    const meta     = TYPES[isSpare ? 'other' : existing.type];
    _deactivateRow(row, checkbox, pills, startEl, endEl);
    _activateRow(row, checkbox, pills, startEl, endEl, isSpare ? 'other' : existing.type);
    if (checkbox) checkbox.checked = false;
    const rdHint = /** @type {HTMLElement|null} */ (row.querySelector('.col-rd-hint'));
    if (rdHint) rdHint.hidden = true;
    row.classList.add('prefilled-existing');
    _syncAlSwap(row);         // a saved, untouched row is not being booked — not asked
    _syncOverwriteBadge(row); // loaded + untouched → "✓ Saved" (not "Updating")
    const other   = existing.type === 'other' ? parseOtherValue(existing.value) : null;
    const flavour = isSpare ? 'SPARE' : other?.flavour;
    if (flavour) row.querySelectorAll('.other-flavour-btn').forEach(b => {
        const on = /** @type {HTMLElement} */ (b).dataset.flavour === flavour;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
    });
    if (isSpare) _syncOtherSpareMode(row);   // hides the RDW tick and the times: "No time needed"
    if (other) {
        const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
        if (cb && !cb.disabled) cb.checked = other.rdw;
        _syncOtherRdwWarn(row);
    }
    const time = other ? other.time
        : meta && !meta.fixed && existing.value && existing.value.includes('-') ? existing.value : null;
    if (time && startEl && endEl) [startEl.value, endEl.value] = time.split('-');
}

/**
 * Turn a row off. Clearing `dataset.type` is what stages a DELETE of a saved record, so an
 * untouched saved row must never be deactivated by accident (`_bulkDeselectRow`, admin-week-editor.js).
 * @param {HTMLElement} row
 * @param {HTMLInputElement|null} checkbox
 * @param {NodeListOf<Element>} pills
 * @param {HTMLInputElement|null} startEl
 * @param {HTMLInputElement|null} endEl
 */
export function _deactivateRow(row, checkbox, pills, startEl, endEl) {
    if (checkbox) checkbox.checked = false;
    row.classList.remove('active', 'fixed-type', 'selected', 'row-error', 'other-spare');
    pills.forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
    if (startEl) {
        startEl.value = '';
        startEl.classList.remove('input-error');
        startEl.removeAttribute('aria-invalid');
        startEl.tabIndex = -1;
    }
    if (endEl) {
        endEl.value = '';
        endEl.classList.remove('input-error');
        endEl.removeAttribute('aria-invalid');
        endEl.tabIndex = -1;
    }
    delete row.dataset.type;
    // Reset the Other sub-controls: NO flavour selected (an explicit pick is required —
    // no silent Training default), no RDW, hidden.
    const otherOpts = /** @type {HTMLElement|null} */ (row.querySelector('.other-opts'));
    if (otherOpts) {
        otherOpts.hidden = true;
        row.querySelectorAll('.other-flavour-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
        });
        const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
        if (cb && !cb.disabled) cb.checked = false;   // rest-day rows keep their baked tick (RDW is automatic)
        _syncOtherRdwWarn(row);
    }
    _syncAlSwap(row);
    _syncOverwriteBadge(row);
}

// ── A ROW'S STAGED STATE AS DATA (iPhone audit, Nov 2026) ─────────────────────────────────────────
//
// A kept draft (unsaved-draft.js) is the staged rows of one week, read off the grid when the page is
// hidden and put back on the next load. Both halves are here, beside the two states they read and
// recreate, so a new per-row control is read and restored in the same place it is drawn.

/**
 * Is this row STAGED — a change, or a removal, that Save would write? The one test of it: a row given
 * a type that is not its untouched prefill, or a prefilled row whose type was taken away (a staged
 * DELETE, which leaves nothing on the row to look unsaved). `_hasStagedEdits` asks it of the grid.
 * @param {HTMLElement} row
 * @returns {boolean}
 */
export function isStagedRow(row) {
    return row.dataset.type ? !row.classList.contains('prefilled-existing') : !!row.dataset.existingId;
}

/**
 * @typedef {{ date: string, remove?: boolean, type?: string, start?: string, end?: string,
 *             flavour?: string, rdw?: boolean, swap?: string, was?: string }} RowDraft
 */

/**
 * One row's staged state as data, or null for a row with nothing staged. Everything the save
 * collector reads from a row (admin-app.js): the type, the times, the Other flavour and RDW tick, and
 * the swapped-day answer.
 * @param {HTMLElement} row
 * @returns {RowDraft|null}
 */
export function readRowDraft(row) {
    if (!isStagedRow(row)) return null;
    const date = row.dataset.date ?? '';
    if (!row.dataset.type) return { date, remove: true };
    const box = (/** @type {string} */ sel) => /** @type {HTMLInputElement|null} */ (row.querySelector(sel))?.value ?? '';
    const flavour = /** @type {HTMLElement|null} */ (row.querySelector('.other-flavour-btn.active'))?.dataset.flavour ?? '';
    const rdw = !!(/** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb')))?.checked;
    return { date, type: row.dataset.type, start: box('.day-start'), end: box('.day-end'), flavour, rdw, swap: row.dataset.alSwap ?? '' };
}

/**
 * Put one row back into the staged state `d` describes, through the same two states a tap reaches.
 * False — and the row left exactly as it was — when the row can no longer take it: a removal of a
 * record that is not there any more, or a type this day does not offer (a Sunday's disabled pills).
 * @param {HTMLElement} row
 * @param {RowDraft} d
 * @returns {boolean}
 */
export function applyRowDraft(row, d) {
    const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
    const pills    = row.querySelectorAll('.type-pill-btn');
    const startEl  = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
    const endEl    = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
    const pill = /** @type {HTMLButtonElement|undefined} */ ([...pills].find(p => /** @type {HTMLElement} */ (p).dataset.type === d.type));
    if (d.remove ? !row.dataset.existingId : (!pill || pill.disabled)) return false;
    // Cleared FIRST, as bulk apply does: `_activateRow` asks the swapped-day question only of a row
    // that is being booked, and a row still marked as its prefill is not.
    row.classList.remove('prefilled-existing');
    if (d.remove) { _deactivateRow(row, checkbox, pills, startEl, endEl); return true; }
    _activateRow(row, checkbox, pills, startEl, endEl, /** @type {string} */ (d.type));
    if (startEl) startEl.value = String(d.start ?? '');
    if (endEl) endEl.value = String(d.end ?? '');
    if (d.type === 'other') {
        row.querySelectorAll('.other-flavour-btn').forEach(b => {
            const on = /** @type {HTMLElement} */ (b).dataset.flavour === d.flavour;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
        const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
        if (cb && !cb.disabled) cb.checked = !!d.rdw;
        _syncOtherSpareMode(row);   // Spare hides the tick and the times; it re-syncs the RDW warning too
    }
    // Only where the question is asked of this row now: `_activateRow` has just shown or hidden it.
    const asked = !/** @type {HTMLElement|null} */ (row.querySelector('.col-al-swap'))?.hidden;
    if (asked && (d.swap === 'yes' || d.swap === 'no')) {
        row.dataset.alSwap = d.swap;
        row.querySelectorAll('.al-swap-btn').forEach(b =>
            b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.swap === d.swap)));
    }
    return true;
}

/**
 * Every staged row of the week on screen, as the draft keeps it: each with `was`, the saved record
 * the row was edited over (`savedSignature`, unsaved-draft.js), so a restore can tell when that has
 * changed since.
 * @param {ParentNode} grid
 * @param {(date: string) => string} was
 * @returns {RowDraft[]}
 */
export function readWeekDraft(grid, was) {
    return /** @type {RowDraft[]} */ ([...grid.querySelectorAll('.day-row')]
        .map(r => readRowDraft(/** @type {HTMLElement} */ (r)))
        .filter(Boolean))
        .map(d => ({ ...d, was: was(d.date) }));
}

/**
 * Put a kept week back on the grid on screen. A row is restored only while its saved record is still
 * the one it was edited over: a colleague's change since, or a booking made from another card, is
 * never overwritten by a draft nobody has looked at again. Those days come back in `left`, with any
 * row this week no longer has.
 * @param {ParentNode} grid
 * @param {any} rows      the draft's rows, as read back from storage
 * @param {(date: string) => string} was  the saved record on each day NOW
 * @returns {{ put: number, left: string[] }}
 */
export function applyWeekDraft(grid, rows, was) {
    const byDate = new Map([...grid.querySelectorAll('.day-row')]
        .map(r => [/** @type {HTMLElement} */ (r).dataset.date, /** @type {HTMLElement} */ (r)]));
    let put = 0;
    /** @type {string[]} */ const left = [];
    for (const d of Array.isArray(rows) ? rows : []) {
        if (!d || typeof d.date !== 'string') continue;
        const row = byDate.get(d.date);
        if (row && d.was === was(d.date) && applyRowDraft(row, d)) put++;
        else left.push(d.date);
    }
    return { put, left };
}
