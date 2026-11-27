// @ts-check
/**
 * link-designer-brush-bar.js — the paint bar above the Link Designer design grid (`#brushBar`): which chips it
 * shows, the armed brush, and arming or disarming it. The single source of truth for the armed
 * brush: the coordinator and the grid only ASK for it (`armed`) or disarm it (`dearm`).
 *
 * Moved out of link-designer-app.js on 25 Nov 2026 (the coordinator's maintainability split), its bodies and
 * comments as they were. The brush was a `let` in the coordinator, read by the grid's input and the
 * Escape key; it now lives here, and the working copy is read through `getDesign`.
 *
 * ── RULES AN EDIT CAN BREAK ─────────────────────────────────────────────────────────────────────
 *
 * 1. **The chips are the times THIS DESIGN is made of** (`brushTimes`, v21.14), never a fixed list.
 *    A fixed list painted shifts the design did not contain and could not paint the ones it did —
 *    measured once, an overlap of zero — and still looked as if it worked. An empty design falls back
 *    to the default table, and no night or past-midnight duty is ever offered (`normaliseCustomShift`).
 * 2. **The armed brush is unioned in**, so a chip cannot vanish mid-paint.
 * 3. **The bar is redrawn after a paint only when its SIGNATURE changes** (`renderIfChanged`): a drag
 *    paints cell by cell, and a redraw per cell would tear out the chips under the stroke.
 * 4. **A chip shows BOTH times**, as the cell it paints does: several shifts share a start, and
 *    start-only chips were identical pairs painting different shifts (v19.43). Its name is
 *    `cellName`'s, what it shows first.
 * 5. **The chips are new elements on every render**, so the armed one is lit again, or the brush
 *    stays armed with nothing lit.
 * 6. **A Custom… time re-renders the bar with it** (links-app-6) — it is usually not on the bar, so
 *    arming it lit nothing — and focus goes to its chip, the Custom… button having been replaced.
 *
 * `brushTimes` is pure and tested by link-designer-brush-bar.test.mjs; the bar itself by e2e/link-designer.spec.js
 * ("every paint chip is a shift the design actually contains", in both directions).
 */

import { escapeHtml } from './roster-data.js';
import { classifyShift, normaliseCustomShift } from './link-designer-design.js';
import { DEFAULT_SHIFT_TIMES } from './link-designer-default-targets.js';
import { shiftLabel, cellName } from './link-designer-grid-cells.js';

/**
 * The paint chips' times: those `patterns` is made of, the armed `brush` unioned in, early and late in
 * time order. Rest, OFF and spare are not times; a design with none falls back to the default table.
 * @param {Record<string, any>|null|undefined} patterns @param {string|null} brush
 * @returns {{ early: string[], late: string[] }}
 */
export function brushTimes(patterns, brush) {
    const out = new Set();
    for (const row of Object.values(patterns || {})) {
        for (const s of Object.values(/** @type {any} */ (row) || {})) {
            if (s && s !== 'RD' && s !== 'OFF' && s !== 'SPARE' && normaliseCustomShift(s)) out.add(s);   // never a night or past-midnight duty
        }
    }
    if (!out.size) for (const t of DEFAULT_SHIFT_TIMES) out.add(t);
    if (brush && brush !== 'RD' && brush !== 'SPARE') out.add(brush);
    const early = [], late = [];
    for (const s of [...out].sort()) {
        const cls = classifyShift(s);
        if (cls === 'late') late.push(s); else early.push(s);
    }
    return { early, late };
}

/** What the bar shows, as one comparable string (rule 3). @param {{ early: string[], late: string[] }} times */
export const brushSig = ({ early, late }) => early.join(',') + '|' + late.join(',');

/**
 * Wire the paint bar, once.
 * @param {{ getDesign: () => ({ patterns: Record<string, any> } | null), isComparing: () => boolean,
 *           askCustomShift: (message: string) => Promise<string|null>, customPrompt: string }} deps
 *   `askCustomShift` asks for a Custom… time and says why a refused one was refused (the coordinator's);
 *   `customPrompt` is its question.
 */
export function createBrushBar({ getDesign, isComparing, askCustomShift, customPrompt }) {
    /** @type {any} */ let brush = null;   // the armed paint shift, or null
    /** What the bar shows now — see `renderIfChanged`. */
    let _lastBrushSig = '';

    /** @param {any} shift */
    function armBrush(shift) {
        brush = shift;
        document.querySelectorAll('.brush-chip').forEach(c => {
            const on = /** @type {HTMLElement} */ (c).dataset.shift === shift;
            c.classList.toggle('brush-chip--active', on);
            c.setAttribute('aria-pressed', String(on));
        });
    }

    function dearmBrush() {
        brush = null;
        document.querySelectorAll('.brush-chip').forEach(c => {
            c.classList.remove('brush-chip--active');
            c.setAttribute('aria-pressed', 'false');
        });
    }

    function renderBrushBar() {
        const bar = document.getElementById('brushBar');
        if (!bar) return;
        const design = getDesign();
        if (!design || isComparing()) { bar.style.display = 'none'; return; }
        bar.style.display = '';
        const { early: barEarly, late: barLate } = brushTimes(design.patterns, brush);
        _lastBrushSig = barEarly.join(',') + '|' + barLate.join(',');

        // A chip shows BOTH times, as the cell it paints does: several shifts share a start, and start-only chips were
        // identical pairs painting different shifts (v19.43). Its name is `cellName`'s, what it shows first.
        const chip = (/** @type {any} */ shift, /** @type {any} */ label, /** @type {any} */ typeClass, /** @type {any} */ extra = '', /** @type {any} */ spokenLabel = null) => {
            const say = spokenLabel ?? label;
            return `<button class="brush-chip type-${typeClass}${extra}" data-shift="${escapeHtml(shift)}" ` +
                `aria-pressed="false" aria-label="Paint: ${escapeHtml(say)}">${escapeHtml(label)}</button>`;
        };

        bar.innerHTML = [
            '<span class="brush-bar-label">Paint:</span>',
            chip('RD',    'RD',     'rd',    '', cellName('RD')),
            chip('SPARE', 'SP',     'spare', '', cellName('SPARE')),
            ...barEarly.map(s => chip(s, shiftLabel(s), 'early', '', cellName(s))),
            ...barLate.map(s  => chip(s, shiftLabel(s), 'late',  '', cellName(s))),
            `<button class="brush-chip brush-chip--custom" data-shift="__custom__" aria-pressed="false">Custom…</button>`,
        ].join('');
        // The chips are new elements: re-light the armed one, or the brush stays armed with nothing lit.
        if (brush) armBrush(brush);

        bar.querySelectorAll('.brush-chip').forEach(c => {
            c.addEventListener('click', async () => {
                const custom = /** @type {HTMLElement} */ (c).dataset.shift === '__custom__';
                let shift = /** @type {HTMLElement} */ (c).dataset.shift;
                if (custom) {
                    const typed = await askCustomShift(customPrompt);
                    if (!typed) return;
                    shift = typed;
                }
                if (brush === shift) dearmBrush();
                else armBrush(shift);
                // A Custom… time is usually not on the bar, so arming it lit nothing (links-app-6): the bar is drawn again
                // with it, and focus goes to its chip, the Custom… button having been replaced.
                if (custom) {
                    renderBrushBar();
                    /** @type {HTMLElement|null} */ (bar.querySelector(`.brush-chip[data-shift="${CSS.escape(brush ?? '__custom__')}"]`))?.focus();
                }
            });
        });
    }

    /** Redraw the bar only if the design's times changed (rule 3): a drag paints cell by cell. */
    function renderIfChanged() {
        const sig = brushSig(brushTimes(getDesign()?.patterns, brush));
        if (sig !== _lastBrushSig) renderBrushBar();
    }

    return {
        render: renderBrushBar,
        renderIfChanged,
        arm: armBrush,
        dearm: dearmBrush,
        /** The armed paint shift, or null. @returns {any} */
        armed: () => brush,
    };
}
