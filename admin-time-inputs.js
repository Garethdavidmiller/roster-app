// @ts-check
/**
 * admin-time-inputs.js — the Admin week grid's time boxes: what each keystroke shows, where focus
 * goes once a time is complete, and how an unfinished or impossible time is flagged.
 *
 * Owns: two DELEGATED `document` listeners for every `.time-input` (the per-row start/end boxes and
 *   the bulk bar's `#bulkStart`/`#bulkEnd`).
 * Does NOT own: the typing RULE (`formatClockInput`, clock-input.js — "0730" → "07:30", and "630" →
 *   "06:30", never "63:0") or what a valid time is (`TIME_RE`, roster-data.js); nor the row's staged
 *   state, which the editor marks from its own `input` listener on each box.
 *
 * ── WHY IT IS ITS OWN MODULE (v24.64) ─────────────────────────────────────────────────────────
 *
 * `admin-week-editor.js` stood one line under its ratchet cap (external review, Oct 2026: "no
 * headroom"). This cluster needed nothing from the editor — no state, no injected service — which is
 * what the v23.98 extraction (`admin-week-row-state.js`) named as the shape of a real seam. And it
 * carried a COPY of `formatClockInput`: the editor's formatter predated clock-input.js, whose header
 * explained the copy by the focus move. The focus move is wiring and stays here; the rule is no
 * longer restated, so the week grid and every other clock box cannot drift apart.
 *
 * ── THE RE-ENTRY GUARD IS LOAD-BEARING ─────────────────────────────────────────────────────────
 *
 * Assigning to `value` inside an `input` listener fires ANOTHER `input` event on iOS Safari (not on
 * Android Chrome). Without `_formatting` the handler reformats its own output.
 */

import { TIME_RE } from './roster-data.js';
import { formatClockInput } from './clock-input.js';

let _formatting = false;
let _wired = false;

/** Attach the two delegated listeners, once per page life. @returns {void} */
export function initTimeInputs() {
    if (_wired) return;
    _wired = true;
    // Typing 4 digits auto-inserts the colon: "0730" → "07:30"
    document.addEventListener('input', e => {
        if (_formatting || !/** @type {Element} */ (e.target).classList.contains('time-input')) return;
        const timeInput = /** @type {HTMLInputElement} */ (e.target);
        timeInput.classList.remove('input-error');
        timeInput.removeAttribute('aria-invalid');
        _formatting = true;
        timeInput.value = formatClockInput(timeInput.value);
        _formatting = false;
        // A complete time moves on: start → its row's end, bulk start → bulk end.
        if (timeInput.value.length === 5) {
            if (timeInput.classList.contains('day-start')) {
                /** @type {HTMLElement|null} */ (timeInput.closest('.day-row')?.querySelector('.day-end'))?.focus();
            } else if (timeInput.id === 'bulkStart') {
                /** @type {HTMLElement|null} */ (document.getElementById('bulkEnd'))?.focus();
            }
        }
    });

    document.addEventListener('focusout', e => {
        if (!/** @type {Element} */ (e.target).classList.contains('time-input')) return;
        const timeInput = /** @type {HTMLInputElement} */ (e.target);
        const val = timeInput.value.trim();
        if (!val) { timeInput.classList.remove('input-error'); timeInput.removeAttribute('aria-invalid'); return; }
        const invalid = !TIME_RE.test(val);
        timeInput.classList.toggle('input-error', invalid);
        // Expose the failure to assistive tech, not just via the CSS class. The input
        // already points at its error span through aria-describedby.
        if (invalid) timeInput.setAttribute('aria-invalid', 'true');
        else timeInput.removeAttribute('aria-invalid');
    });
}
