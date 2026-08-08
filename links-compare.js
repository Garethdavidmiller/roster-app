// @ts-check
/**
 * links-compare.js — Compare mode for links.html: view two saved designs side by side with a
 * gold-outline diff on differing cells. Extracted from links-app.js (v17.71, extraction programme).
 *
 * This module is the SINGLE SOURCE OF TRUTH for the two compare state vars (`compareMode` +
 * `compareDesignId`) — links-app.js no longer stores them. The coordinator only ever ASKS this
 * module for them (`isCompareMode` / `getCompareId`) or RESETS them (`resetCompare`), so the two can
 * never disagree. It reads the rest of the design state READ-ONLY via getters and never touches the
 * coordinator's save/concurrency baseline (design / dirty / loadedUpdatedAt / baselineUnknown) —
 * which is what makes this a safe slice.
 *
 * `initLinksCompare(deps)` returns the compare API. The coordinator injects read-only getters for the
 * design collection + a few render callbacks and local helpers (all defined in links-app.js).
 */
import { escapeHtml } from './roster-data.js';
import { DAYS, ROTATING_LINES, classifyShift, calcCoverage } from './links-design.js';
import { formatWindow, windowsDiffer } from './links-window.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// The rotation length, IMPORTED (v19.98). It was a local literal `28` — the fourth copy of a
// number links-design.js had already been made the single declaration of at v19.38, and the one
// the earlier sweep missed. When the rotation went 28 -> 22 this module alone kept rendering 28
// rows, so compare mode showed six rows of rest days that the grid beside it did not have and no
// analysis counted. Never restate this number.
const TOTAL_POS = ROTATING_LINES;

/**
 * @param {object} deps
 * @param {() => Array<{id:string, name:string, patterns:Object, window?:any}>} deps.getDesigns
 * @param {() => any} deps.getActiveDesignId
 * @param {() => ({ name?: string, patterns: Record<string, any>, window?: any } | null)} deps.getDesign
 * @param {() => void} deps.renderDesignPicker
 * @param {() => void} deps.renderGrid
 * @param {() => void} deps.renderBrushBar
 * @param {() => void} deps.dearmBrush
 * @param {() => Record<string, any>} deps.emptyPattern
 * @param {(p: any) => boolean} deps.isUnfilledPattern
 * @param {(shift: string) => string} deps.shiftLabel
 */
export function initLinksCompare(deps) {
    const { getDesigns, getActiveDesignId, getDesign, renderDesignPicker, renderGrid,
        renderBrushBar, dearmBrush, emptyPattern, isUnfilledPattern, shiftLabel } = deps;

    let compareMode = false;
    /** @type {any} */
    let compareDesignId = null;

    function isCompareMode() { return compareMode; }
    function getCompareId() { return compareDesignId; }
    /** Reset compare state (called by the picker on delete/select and by the generator on apply).
     *  Does NOT re-render — the caller already re-renders the picker/grid/compare in its own flow. */
    function resetCompare() { compareMode = false; compareDesignId = null; }

    /** Toggle between single-design and compare views. */
    function toggleCompareMode() {
        const designs = getDesigns();
        if (designs.length < 2) return;
        // Disarm any painting brush before toggling — like every other renderBrushBar caller.
        // renderBrushBar early-returns while compare is ON (so it never rebuilds/clears the chips),
        // so a brush left armed here survived the compare round-trip with no visible highlight, and
        // the next cell tap silently PAINTED instead of opening the edit dropdown (v16.19).
        dearmBrush();
        compareMode = !compareMode;
        if (compareMode && !compareDesignId) {
            compareDesignId = designs.find(d => d.id !== getActiveDesignId())?.id ?? null;
        }
        if (!compareMode) compareDesignId = null;
        renderDesignPicker();
        renderGrid();
        renderBrushBar();
        renderCompare();
    }

    /**
     * Select the design shown in the compare column.
     * @param {any} id
     */
    function selectCompareDesign(id) {
        compareDesignId = id;
        renderDesignPicker();
        renderCompare();
    }

    /** Render (or clear) the compare grid pair. */
    function renderCompare() {
        const wrap = document.getElementById('compareGridsWrap');
        if (!wrap) return;

        const design = getDesign();
        if (!compareMode || !design || !compareDesignId) {
            wrap.classList.remove('compare-mode-active');
            return;
        }
        const other = getDesigns().find(x => x.id === compareDesignId);
        if (!other) { wrap.classList.remove('compare-mode-active'); return; }

        const headA = document.getElementById('compareHeadA');
        const headB = document.getElementById('compareHeadB');
        // THE STAFFED WINDOW MUST APPEAR HERE (v19.54). Compare mode diffs CELLS, not windows, so
        // two designs built to different spans would sit side by side looking like for like — the
        // per-design window would become a way to make an unfair comparison look fair. Stated on
        // both columns, and called out when they disagree, so the difference cannot pass unread.
        const differ = windowsDiffer(design.window, other.window);
        const head = (/** @type {Element|null} */ el, /** @type {string} */ name, /** @type {any} */ win) => {
            if (!el) return;
            el.innerHTML = `${escapeHtml(name)}` +
                `<span class="compare-window${differ ? ' compare-window--differs' : ''}">${escapeHtml(formatWindow(win))}</span>`;
        };
        head(headA, design.name || 'Design A', design.window);
        head(headB, other.name   || 'Design B', other.window);

        renderCompareGrid('compareGridBodyRowsA', 'compareGridFootA', design.patterns, other.patterns);
        renderCompareGrid('compareGridBodyRowsB', 'compareGridFootB', other.patterns, design.patterns);
        wrap.classList.add('compare-mode-active');
    }

    /**
     * Render a read-only compare grid into tbodyId/tfootId.
     * Cells that differ from otherPatterns get the .cell-diff class.
     * @param {any} tbodyId
     * @param {any} tfootId
     * @param {any} patterns
     * @param {any} otherPatterns
     */
    function renderCompareGrid(tbodyId, tfootId, patterns, otherPatterns) {
        const tbody = document.getElementById(tbodyId);
        const tfoot = document.getElementById(tfootId);
        if (!tbody) return;

        const rows = [];
        for (let pos = 1; pos <= TOTAL_POS; pos++) {
            const posStr   = String(pos);
            const p        = patterns[posStr] || emptyPattern();
            const op       = otherPatterns[posStr] || emptyPattern();
            const rowClass = isUnfilledPattern(p) ? 'row-unfilled' : '';

            const dayCells = DAYS.map((d, di) => {
                const shift = p[d]  ?? 'RD';
                const other = op[d] ?? 'RD';
                const type  = classifyShift(shift);
                const label = shiftLabel(shift);
                const diff  = shift !== other ? ' cell-diff' : '';
                return `<td class="shift-cell${diff}">` +
                    `<button class="shift-cell-btn type-${type}" tabindex="-1" ` +
                    `aria-label="Line ${posStr} ${DAY_LABELS[di]}: ${escapeHtml(shift)}">` +
                    `${escapeHtml(label)}</button></td>`;
            }).join('');

            rows.push(`<tr class="${rowClass}" data-pos="${posStr}"><td class="pos-num">${posStr}</td>${dayCells}</tr>`);
        }
        tbody.innerHTML = rows.join('');

        if (tfoot) {
            const cov   = calcCoverage(patterns);
            const cells = DAYS.map(d => {
                const { early, late, spare, night } = (/** @type {Record<string, any>} */ (cov))[d];
                const worked = early + late + spare + night;
                return `<td class="cov-cell">` +
                    `<span class="cov-num">${worked}</span>` +
                    `<span class="cov-label-e"> E:${early}</span>` +
                    ` <span class="cov-label-l">L:${late}</span>` +
                    (night ? ` <span class="cov-label-n">N:${night}</span>` : '') +
                    (spare ? ` <span class="cov-label-s">SP:${spare}</span>` : '') +
                    `</td>`;
            }).join('');
            tfoot.innerHTML = `<tr><td class="col-pos cov-foot-label">Cover</td>${cells}</tr>`;
        }
    }

    return { toggleCompareMode, selectCompareDesign, renderCompare, isCompareMode, getCompareId, resetCompare };
}
