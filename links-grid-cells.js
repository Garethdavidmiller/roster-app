// @ts-check
/**
 * links-grid-cells.js — what one cell of a Links grid SAYS: its label, its accessible name, and the
 * markup the editable grid, the compare grids and their cover rows are drawn from. Pure: no DOM, no
 * Firebase. Tested by links-grid-cells.test.mjs.
 *
 * ── WHY ONE MODULE (Nov 2026) ───────────────────────────────────────────────────────────────────
 *
 * The coordinator's grid and links-compare.js's two read-only grids each built their cells, and the
 * copies drifted: the accessibility fix that gave a cell its name — what it shows, then what that
 * stands for, "RD, rest day" (WCAG 2.5.3, v25.27) — reached the editable grid and not the compare
 * grids, which went on saying "RD". One producer, so a change reaches every grid.
 *
 * ── THREE RULES AN EDIT CAN BREAK ───────────────────────────────────────────────────────────────
 *
 * 1. **A cell's name starts with what it SHOWS** (`cellName`), so a voice user can say the words on
 *    the button. "06:20 to 14:20" put a word between the two times read off the chip.
 * 2. **A compare cell is not a control.** It is a `<span>` (compare cells cannot be operated, and as
 *    buttons they announced hundreds of dead controls), and a name on a span needs a role to carry it:
 *    `role="img"`, because an `aria-label` on a role-less span is not allowed and is not read.
 * 3. **An all-rest line is "not yet designed"** (`isUnfilledPattern`), flagged amber — never a vacancy.
 */

import { escapeHtml } from './roster-data.js';
import { DAYS } from './links-design.js';

/** The day names, in `DAYS` order. */
export const DAY_LABELS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

/**
 * A cell's compact label: "06:20\n14:20" on two lines (a CSS `pre-line` cell), or "RD" / "SP".
 * @param {any} shift
 */
export function shiftLabel(shift) {
    if (!shift || shift === 'RD' || shift === 'OFF') return 'RD';
    if (shift === 'SPARE') return 'SP';
    const dash = shift.indexOf('-');
    return dash > 0 ? `${shift.slice(0, dash)}\n${shift.slice(dash + 1)}` : shift;
}

/** A cell's or a paint chip's NAME: what it shows, then what that stands for (rule 1). @param {any} shift */
export function cellName(shift) {
    const l = shiftLabel(shift);
    return l === 'RD' ? 'RD, rest day' : l === 'SP' ? 'SP, spare' : String(shift);
}

/** An all-rest line: a blank for a line nobody has designed yet. */
export const emptyPattern = () => Object.fromEntries(DAYS.map(d => [d, 'RD']));

/** Is this line still all rest — "not yet designed" (rule 3)? @param {any} p */
export const isUnfilledPattern = (p) => DAYS.every(d => {
    const s = p?.[d] ?? 'RD';
    return s === 'RD' || s === 'OFF';
});

/** What a cell is called on a screen reader: "Line 3 Mon: RD, rest day". @param {string|number} pos @param {string} day @param {any} shift */
export const cellAriaName = (pos, day, shift) => `Line ${pos} ${DAY_LABELS[DAYS.indexOf(day)]}: ${cellName(shift)}`;

/**
 * One EDITABLE cell: a button the grid's input module operates.
 * @param {string} pos @param {string} day @param {any} shift @param {(shift: any) => string} classify  `classifyShift`
 */
export function editCellHtml(pos, day, shift, classify) {
    return `<td class="shift-cell"><button class="shift-cell-btn type-${classify(shift)}" `
        + `data-pos="${pos}" data-day="${day}" aria-label="${escapeHtml(cellAriaName(pos, day, shift))}">`
        + `${escapeHtml(shiftLabel(shift))}</button></td>`;
}

/**
 * One READ-ONLY compare cell (rule 2), outlined when it differs from the other design's.
 * @param {string} pos @param {string} day @param {any} shift @param {boolean} differs @param {(shift: any) => string} classify
 */
export function compareCellHtml(pos, day, shift, differs, classify) {
    return `<td class="shift-cell${differs ? ' cell-diff' : ''}"><span class="shift-cell-btn type-${classify(shift)}" `
        + `role="img" aria-label="${escapeHtml(cellAriaName(pos, day, shift))}">${escapeHtml(shiftLabel(shift))}</span></td>`;
}

/**
 * The cover row's day cells — how many work each day, and of which type — for the editable grid's
 * footer and each compare grid's alike. Night is shown only when present: it is the "something here
 * is wrong" flag (`classifyShift` reads anything it cannot parse as night).
 * @param {Record<string, {early: number, late: number, spare: number, night: number}>} cov  from `calcCoverage`
 */
export function coverCellsHtml(cov) {
    return DAYS.map(d => {
        const { early, late, spare, night } = cov[d];
        return `<td class="cov-cell"><span class="cov-num">${early + late + spare + night}</span>`
            + `<span class="cov-label-e"> E:${early}</span> <span class="cov-label-l">L:${late}</span>`
            + (night ? ` <span class="cov-label-n">N:${night}</span>` : '')
            + (spare ? ` <span class="cov-label-s">SP:${spare}</span>` : '')
            + `</td>`;
    }).join('');
}
