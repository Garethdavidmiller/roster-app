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
import { DAYS, ROTATING_LINES, classifyShift, calcCoverage, runDesignChecks, weeklyHours } from './links-design.js';
import { assessFatigue } from './links-fatigue.js';
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

        renderSummaryStrip(design, other);
        renderCompareGrid('compareGridBodyRowsA', 'compareGridFootA', design.patterns, other.patterns);
        renderCompareGrid('compareGridBodyRowsB', 'compareGridFootB', other.patterns, design.patterns);
        wrap.classList.add('compare-mode-active');
    }

    /**
     * A -> B in the figures a designer is actually choosing between (v22.60, external review).
     *
     * Compare mode put two grids side by side and outlined the differing cells gold, which is a
     * PICTURE of the difference: reading it meant holding 336 cells in your head and doing the
     * comparison privately. This does the arithmetic — how many cells differ and across how many
     * lines, then the four figures that decide which design is better.
     *
     * Every figure comes from the SAME pure function the single-design panels call, so the two
     * views cannot report a design differently four seconds apart. It scores nothing and picks no
     * winner: `A -> B` and the reader decides, which is the rule the coverage and fatigue panels
     * already follow.
     * @param {any} a the ACTIVE design @param {any} b the one being compared against
     */
    function renderSummaryStrip(a, b) {
        const el = document.getElementById('compareSummary');
        if (!el) return;
        let cells = 0;
        const lines = new Set();
        for (let pos = 1; pos <= TOTAL_POS; pos++) {
            const p = a.patterns[String(pos)] || emptyPattern();
            const q = b.patterns[String(pos)] || emptyPattern();
            for (const d of DAYS) {
                if ((p[d] ?? 'RD') !== (q[d] ?? 'RD')) { cells++; lines.add(pos); }
            }
        }
        const ca = runDesignChecks(a.patterns, TOTAL_POS), cb = runDesignChecks(b.patterns, TOTAL_POS);
        const fa = assessFatigue(a.patterns, TOTAL_POS),   fb = assessFatigue(b.patterns, TOTAL_POS);
        const ha = weeklyHours(a.patterns, TOTAL_POS),     hb = weeklyHours(b.patterns, TOTAL_POS);
        const hrs = (/** @type {any} */ h) => h.exSunday === null ? '—'
            : `${Math.floor(h.exSunday / 60)}h ${String(Math.round(h.exSunday % 60)).padStart(2, '0')}m`;
        // An UNCHANGED figure still renders. Showing only what moved would leave the reader unable
        // to tell "the same" from "not measured", which is this app's most repeated defect.
        const row = (/** @type {string} */ label, /** @type {any} */ x, /** @type {any} */ y) =>
            `<li><span class="compare-sum-label">${escapeHtml(label)}</span>` +
            `<span class="compare-sum-val${String(x) === String(y) ? ' compare-sum-val--same' : ''}">` +
            `${escapeHtml(String(x))} → ${escapeHtml(String(y))}</span></li>`;
        el.innerHTML =
            `<p class="compare-sum-head"><strong>${cells}</strong> cell${cells === 1 ? '' : 's'} differ` +
            `${cells ? ` across <strong>${lines.size}</strong> line${lines.size === 1 ? '' : 's'}` : ''}</p>` +
            `<ul class="compare-sum-list">` +
            row('Hours a week (excl. Sunday)', hrs(ha), hrs(hb)) +
            row('Full weekends off', ca.weekendsOff, cb.weekendsOff) +
            row('Rest under 12 hours', ca.turnarounds.length, cb.turnarounds.length) +
            row('ORR factors present', fa.present, fb.present) +
            `</ul>`;
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
                // A SPAN, NOT A BUTTON (v22.60, external review). These cells cannot be operated —
                // `.links-grid--compare` sets `pointer-events: none` and every one carried
                // `tabindex="-1"` — so rendering them as buttons announced 336 controls to a screen
                // reader that do nothing when reached. The class stays, because it is what carries
                // the shift colouring; `role` and `tabindex` go, because there is nothing to press.
                return `<td class="shift-cell${diff}">` +
                    `<span class="shift-cell-btn type-${type}" ` +
                    `aria-label="Line ${posStr} ${DAY_LABELS[di]}: ${escapeHtml(shift)}">` +
                    `${escapeHtml(label)}</span></td>`;
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
