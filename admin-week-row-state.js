// @ts-check
/**
 * admin-week-row-state.js — WHAT A WEEK-GRID ROW LOOKS LIKE IN EACH OF ITS STATES.
 *
 * Owns: turning one `.day-row` on and off, and keeping the three things that depend on a row's
 *   current type in step with it — the RDW warning, the Spare submenu mode, and the overwrite badge.
 * Does NOT own: which rows exist, what is staged, the bulk bar, or any save.
 * Edit here for: a new per-row control, or a change to what an active/inactive row shows.
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
 * This cluster needs NONE. 129 lines, importing the shift-type table and the status helper and
 * nothing else — every function takes a row element and reads the DOM under it. That is what a
 * seam looks like: the functions here do not know the editor exists.
 *
 * Keep it that way. If something in here starts needing the editor's state or its injected
 * services, the seam has moved and this module is the wrong home for it.
 */

import { TYPES } from './admin-shift-types.js';
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
    }
    _syncOverwriteBadge(row);
}

/**
 * Sync a day-row's overwrite badge to its state, relative to the override it was loaded with:
 *   • prefilled-existing (loaded, untouched) → "✓ Saved"    — already recorded, no change staged
 *   • active with a type   (a change staged)  → "⚠ Updating" — will overwrite the saved one on Save
 *   • deactivated          (unticked)         → "⚠ Removing" — the saved override is deleted on Save
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
    _syncOverwriteBadge(row);
}
