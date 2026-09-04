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
import { DAYS, ROTATING_LINES, classifyShift, calcCoverage, runDesignChecks, weeklyHours, hmFromHours } from './links-design.js';
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
    /**
     * Show only the lines where the two designs differ (v22.73, external review).
     *
     * The rotation is 24 lines and a real proposal changes three or four of them, so the reader's
     * job was to find those four among 168 cells of agreement. It is a VIEW, never a filter on the
     * comparison itself: every figure in the strip above is still computed over the whole design,
     * and the cover row still totals every line — which is why the strip says so while this is on.
     * A count you cannot see the basis of is the thing this app most often gets wrong.
     *
     * Session-scoped, like `compareMode` itself. It survives switching the compared design on
     * purpose — a designer works through several in a row — but see `_filterActive`: it is not
     * APPLIED when nothing differs, or the grid would empty itself and read as a failed load.
     */
    let diffOnly = false;
    /** Which lines differ in the pair currently on screen. Set by the strip, read by the grids. */
    let _diffLines = new Set();
    /** The filter is only APPLIED when it would leave something to look at. */
    const _filterActive = () => diffOnly && _diffLines.size > 0;

    function isCompareMode() { return compareMode; }
    function getCompareId() { return compareDesignId; }
    /** Reset compare state (called by the picker on delete/select and by the generator on apply).
     *  Does NOT re-render — the caller already re-renders the picker/grid/compare in its own flow. */
    function resetCompare() { compareMode = false; compareDesignId = null; diffOnly = false; }

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
        // LEAVING clears the filter; switching the compared design does not (v22.73). The
        // distinction is which act means "start again": re-entering compare mode should show the
        // whole picture, because a filter silently already on hides most of a design the designer
        // has only just opened, and the one clue is a clause in the strip above it. Working through
        // several designs against the same baseline is the opposite — re-ticking each time is
        // friction with nothing at stake, since the reader chose the view seconds ago.
        if (!compareMode) { compareDesignId = null; diffOnly = false; }
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

        // ORDER IS LOAD-BEARING: the strip computes `_diffLines`, and both the filter control and
        // the grids' class read it. Rendering a grid first would apply the previous pair's answer.
        renderSummaryStrip(design, other);
        renderCompareFilter();
        renderCompareGrid('compareGridBodyRowsA', 'compareGridFootA', design.patterns, other.patterns);
        renderCompareGrid('compareGridBodyRowsB', 'compareGridFootB', other.patterns, design.patterns);
        wrap.classList.toggle('compare-diff-only', _filterActive());
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
        // The SAME walk the grids will filter on, done once and shared — two passes over the same
        // 336 cells could disagree about which lines differ, and then the strip would state a
        // number of lines the grid below it does not show.
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
        // `weeklyHours().exSunday` is DECIMAL HOURS, and `hmFromHours` is the one formatter for it —
        // its own header says so, having been written after three hand-rolled copies rendered
        // "34h 60m". This was a fourth copy and it read the figure as MINUTES: a 35-hour week
        // rendered "0h 35m", live, on the surface a designer uses to choose between two proposals.
        // Nothing was out of range and nothing threw. Import the formatter; never restate it.
        const hrs = (/** @type {any} */ h) => h.exSunday === null ? '—' : hmFromHours(h.exSunday);
        // An UNCHANGED figure still renders. Showing only what moved would leave the reader unable
        // to tell "the same" from "not measured", which is this app's most repeated defect.
        const row = (/** @type {string} */ label, /** @type {any} */ x, /** @type {any} */ y) =>
            `<li><span class="compare-sum-label">${escapeHtml(label)}</span>` +
            `<span class="compare-sum-val${String(x) === String(y) ? ' compare-sum-val--same' : ''}">` +
            `${escapeHtml(String(x))} → ${escapeHtml(String(y))}</span></li>`;
        _diffLines = lines;
        el.innerHTML =
            `<p class="compare-sum-head"><strong>${cells}</strong> cell${cells === 1 ? '' : 's'} differ` +
            `${cells ? ` across <strong>${lines.size}</strong> line${lines.size === 1 ? '' : 's'}` : ''}` +
            // STATED WHILE THE FILTER IS ON, not merely implied by the button's label. Every figure
            // in this strip, and the cover row under each grid, is computed over the WHOLE design;
            // a reader looking at four rows has every reason to read them as the basis of the
            // numbers beside them, and would be wrong by twenty lines.
            `${_filterActive() ? ' — the figures here and the cover row below still cover all '
                + `${TOTAL_POS} lines` : ''}</p>` +
            `<ul class="compare-sum-list">` +
            row('Hours a week (excl. Sunday)', hrs(ha), hrs(hb)) +
            row('Full weekends off', ca.weekendsOff, cb.weekendsOff) +
            row('Rest under 12 hours', ca.turnarounds.length, cb.turnarounds.length) +
            row('ORR factors present', fa.present, fb.present) +
            `</ul>`;
    }

    /**
     * The "only the lines that differ" control (v22.73).
     *
     * OFFERED ONLY WHEN IT WOULD CHANGE SOMETHING, which is two refusals rather than one: nothing
     * differs (the filter would empty the grid), and everything differs (it would hide nothing, and
     * a control that visibly does nothing when pressed teaches a designer to distrust the rest).
     * Rebuilt on every render rather than toggled, because the count in its label moves with the
     * pair on screen.
     */
    function renderCompareFilter() {
        const box = document.getElementById('compareFilter');
        if (!box) return;
        const hiddenCount = TOTAL_POS - _diffLines.size;
        const offer = _diffLines.size > 0 && hiddenCount > 0;
        box.hidden = !offer;
        if (!offer) { box.innerHTML = ''; return; }
        const on = _filterActive();
        box.innerHTML =
            `<button type="button" id="compareDiffOnlyBtn" class="btn-set compare-filter-btn" ` +
            `aria-pressed="${on}">${on
                ? `Showing the ${_diffLines.size} line${_diffLines.size === 1 ? '' : 's'} that differ`
                : `Show only the ${_diffLines.size} line${_diffLines.size === 1 ? '' : 's'} that differ`}` +
            `</button>` +
            `<span class="compare-filter-note">${on
                ? `${hiddenCount} identical line${hiddenCount === 1 ? '' : 's'} hidden`
                : ''}</span>`;
        document.getElementById('compareDiffOnlyBtn')?.addEventListener('click', () => {
            diffOnly = !diffOnly;
            renderCompare();
        });
    }

    /**
     * Keep the two columns on the same day (v22.73).
     *
     * Each column is its own `overflow-x` area — it has to be, since two 560px-minimum tables
     * cannot both fit a 1000px card — so scrolling one to reach Saturday left the other on Sunday,
     * and the gold outlines a designer is reading across were no longer beside each other. Wired
     * ONCE, at init: both wrappers are static markup.
     *
     * The guard is a flag rather than a diff of positions: assigning `scrollLeft` fires the other
     * element's `scroll` event, which would assign back, and on a sub-pixel difference the two can
     * volley indefinitely. Cleared on the next frame, so a genuine user scroll immediately after is
     * not swallowed.
     *
     * **AN ECHO THAT CHANGES NOTHING MUST NOT ARM THE GUARD** (v22.74). Writing `to.scrollLeft`
     * fires a `scroll` on `to`, whose handler finds the two already in agreement and has nothing to
     * do. Arming the flag for it anyway holds the sync shut for a frame, and any scroll of the other
     * column landing in that frame is dropped in silence. So the ORDER of the two checks is the
     * point: decide there is work BEFORE claiming the guard. The flag still covers what it was
     * written for, a re-entry that genuinely disagrees.
     *
     * **This was found while diagnosing a WebKit test failure that turned out NOT to be this** — and
     * the distinction is worth keeping, because the tempting story (a real cross-engine bug) is the
     * wrong one. The spec was firing a synthetic `scroll` synchronously after assigning
     * `scrollLeft`, twice, inside a single frame; no user and no browser produces that, and the
     * second event landed inside the guard the first had just armed. Measured: the pre-fix module
     * passes the corrected spec. The reordering above is a genuine improvement standing on its own
     * unit tests, not the cause of that red.
     */
    function initScrollSync() {
        const cols = /** @type {HTMLElement[]} */ (
            Array.from(document.querySelectorAll('.compare-grid-scroll')));
        if (cols.length !== 2) return;
        let syncing = false;
        cols.forEach((from, i) => {
            from.addEventListener('scroll', () => {
                if (syncing) return;
                const to = cols[1 - i];
                if (to.scrollLeft === from.scrollLeft) return;   // an echo: nothing to do, nothing to guard
                syncing = true;
                to.scrollLeft = from.scrollLeft;
                requestAnimationFrame(() => { syncing = false; });
            }, { passive: true });
        });
    }
    initScrollSync();

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
            // MARKED, not omitted. The row is always rendered and CSS hides it, so the filter is a
            // view the stylesheet owns — the markup stays a complete picture of the design, which
            // is what keeps `Ctrl+F`, print and a screenshot honest.
            const same     = DAYS.every(d => (p[d] ?? 'RD') === (op[d] ?? 'RD'));
            const rowClass = `${isUnfilledPattern(p) ? 'row-unfilled' : ''}${same ? ' row-same' : ''}`.trim();

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
