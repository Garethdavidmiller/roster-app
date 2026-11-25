// @ts-check
/**
 * links-window-editor.js — the staffed-window editor on the Links Coverage card: the Mon–Sat and
 * Sunday time boxes, the "(moved)" flag beside the "Staffed window" label, the reset, and the line
 * that says why a pair was refused. DOM wiring only: what a window MAY be is links-window.js's, and
 * the working copy is the coordinator's.
 *
 * Moved out of links-app.js on 25 Nov 2026 (the coordinator's maintainability split), its body and
 * comments as they were. It cannot own the working copy, so it READS it through `getDesign` and
 * hands an accepted edit back through `setWindow`, which replaces the copy, marks it dirty and
 * repaints — the one `dirty` flag stays where every unsaved-work question reads it.
 *
 * ── RULES AN EDIT CAN BREAK ─────────────────────────────────────────────────────────────────────
 *
 * 1. **An edit marks the design DIRTY** (`setWindow`): the window is part of the proposal, saved,
 *    compared and printed with it.
 * 2. **An invalid pair is REFUSED, never coerced** — a coerced window prints as one the designer
 *    chose. The refusal is written AFTER `paint()`, because `paint()` clears the status line.
 * 3. **A box commits on BLUR as well as `change`.** Setting `.value` from `input` resets WebKit's
 *    change baseline (admin-week-editor.js), and `change` never fired on an iPhone. `commit` is
 *    idempotent, so both firing is harmless.
 * 4. **A phone's numeric keypad has no colon**, so a time is shaped as it is typed and settled when
 *    the box is left (clock-input.js) — "240" left as typed is 02:40.
 *
 * Tested through its listeners by links-window-editor.test.mjs, and end to end in e2e/links.spec.js.
 */

import { normaliseWindow, isDefaultWindow, windowEditRefusal, canonicaliseWindowTime } from './links-window.js';
import { shapeClockBoxInPlace, settleClockBox } from './clock-input.js';

/**
 * Wire the staffed-window editor, once.
 * @param {{ getDesign: () => ({ window?: any } | null), setWindow: (next: any) => void }} deps
 *   `getDesign` is the working copy, or null; `setWindow` takes an accepted window, replaces the working copy's,
 *   marks it dirty and repaints the Coverage card (which calls the returned `paint`) and compare mode.
 * @returns {() => void} paint — puts the stored window back in the boxes; a no-op on a page without the editor
 */
export function createWindowEditor({ getDesign, setWindow }) {
    const box = /** @type {HTMLElement|null} */ (document.getElementById('windowEditor'));
    if (!box) return () => {};
    const els = {
        monSat: { start: /** @type {HTMLInputElement|null} */ (document.getElementById('winMonSatStart')),
                  end:   /** @type {HTMLInputElement|null} */ (document.getElementById('winMonSatEnd')) },
        sun:    { start: /** @type {HTMLInputElement|null} */ (document.getElementById('winSunStart')),
                  end:   /** @type {HTMLInputElement|null} */ (document.getElementById('winSunEnd')) },
    };
    const status = document.getElementById('winStatus');
    const moved  = /** @type {HTMLElement|null} */ (document.getElementById('winMoved'));
    const reset  = document.getElementById('winReset');
    // A phone's numeric keypad has no colon, so a time is shaped as it is typed; and it commits on BLUR as well as
    // change, because setting `.value` from `input` resets WebKit's change baseline (admin-week-editor.js) and
    // `change` never fired on an iPhone. `commit` is idempotent.
    for (const row of /** @type {const} */ (['monSat', 'sun'])) {
        for (const el of [els[row].start, els[row].end]) {
            el?.addEventListener('input', e => { shapeClockBoxInPlace(el, /** @type {InputEvent} */ (e)); });
            el?.addEventListener('blur', () => commit(row));
        }
    }

    function paint() {
        if (!box) return;
        const design = getDesign();
        box.hidden = !design;
        if (!design) return;
        const w = normaliseWindow(design.window);
        for (const row of /** @type {const} */ (['monSat', 'sun'])) {
            if (els[row].start) els[row].start.value = w[row].start;
            if (els[row].end)   els[row].end.value   = w[row].end;
        }
        // The moved flag sits beside the "Staffed window" label; `.win-status` is for a refusal only.
        if (moved) moved.hidden = isDefaultWindow(w);
        if (status) status.textContent = '';
    }

    /** @param {'monSat'|'sun'} row */
    function commit(row) {
        const design = getDesign();
        if (!design) return;
        const typed = [els[row].start, els[row].end].map(el => (el ? settleClockBox(el) : ''));   // "240" left as typed is 02:40
        const refused = windowEditRefusal(typed[0], typed[1]);   // the reason that applies, or null
        if (refused) {
            // Put the stored value back and say why — AFTER paint(), which clears the status line.
            paint();
            if (status) status.textContent = refused;
            return;
        }
        const start = canonicaliseWindowTime(typed[0]) || '', end = canonicaliseWindowTime(typed[1]) || '', candidate = { start, end };
        const next = normaliseWindow(design.window);
        if (next[row].start === start && next[row].end === end) return;
        next[row] = candidate;
        setWindow(next);   // the working copy, `dirty`, and the Coverage card (which repaints this editor) and compare mode
    }

    for (const row of /** @type {const} */ (['monSat', 'sun'])) {
        els[row].start?.addEventListener('change', () => commit(row));
        els[row].end?.addEventListener('change', () => commit(row));
    }
    reset?.addEventListener('click', () => {
        const design = getDesign();
        if (!design) return;
        if (isDefaultWindow(design.window)) return;
        setWindow(normaliseWindow(null));   // repaints the editor too — no separate paint() needed
    });
    return paint;
}
