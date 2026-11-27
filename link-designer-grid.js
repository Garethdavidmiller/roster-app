// @ts-check
/**
 * link-designer-grid.js — the Link Designer design grid on screen: drawing it (or the empty state in its place),
 * what a cell press MEANS — paint it with the armed brush, or open the shift sheet over it — and the
 * per-line totals and the Cover footer that follow every edit. link-designer-grid-input.js operates the grid
 * (keyboard, mouse strokes); link-designer-grid-cells.js says what one cell says.
 *
 * Moved out of link-designer-app.js on 25 Nov 2026 (the coordinator's maintainability split), its bodies and
 * comments as they were. The working copy, `dirty` and the load state stay the coordinator's: the
 * grid READS the copy through `getDesign` (and writes a painted cell into its `patterns`, the object
 * the coordinator holds), reports an edit through `markEdited`, and asks `describeEmpty` what the card
 * says while there is no design.
 *
 * ── RULES AN EDIT CAN BREAK ─────────────────────────────────────────────────────────────────────
 *
 * 1. **The value a cell already holds is not a change** (`applyShift`, v19.38), or a stray tap arms
 *    every unsaved-work question.
 * 2. **A paint repaints only what reads the cell**: the cell's button IN PLACE (replaced, it dropped
 *    focus to `<body>` after every keyboard edit), its row's flag and totals (a whole-grid render
 *    would tear out the cell under the pointer), the footer, the Coverage card and the checks.
 * 3. **The cell sheet is the app's own** (`openOptionSheet`), never a native `<select>`, whose popup
 *    the OS draws (v23.38). The button stays put, so a dismissed sheet has changed nothing. The
 *    options are `shiftOptionsHtml`'s, read off a DETACHED select by `readGroups`: one producer, its
 *    `<optgroup>`s the sheet's headings (select-sheet-parity.test.mjs recognises the detached select).
 * 4. **The empty card has FOUR states, and only the last two may offer to make a design** — the words
 *    and the rule are `emptyStateFor` (link-designer-design-load.js); this only puts them on the card.
 * 5. **The hint never describes a grid that is not on screen** (v19.66).
 * 6. **A design holding MORE lines than the rotation is said, never trimmed** (v19.98): the grid and
 *    every panel read the rotation's lines, the rest are stored and saved with it.
 * 7. **A cover week's totals are the contracted week, muted** (a convention, not a reading), its days
 *    a dash — unknown, not none; a floor is orange and ends in "+"; and a reason ADDS to the figure
 *    (links-app-15) — a cell's name replaces its content, and the total went unread. The hours
 *    averages are `weeklyHours`', as the checks row and the strip read them; only the DAYS average is
 *    the footer's own, over the WORKING lines (invariant 7), so both divisors are printed.
 * 8. **No night time is offered** (`shiftOptionsHtml`): CEAs work no nights, and
 *    `normaliseCustomShift` refuses one typed.
 *
 * The pure parts — `shiftOptionsHtml`, `totalCellsHtml`, `coverFootHtml` — are tested by
 * link-designer-grid.test.mjs; the grid itself by e2e/link-designer.spec.js.
 */

import { escapeHtml } from './roster-data.js';
import { DAYS, ROTATING_LINES, classifyShift, calcCoverage, hmFromHours, hoursFigure, lineTotals, weeklyHours } from './link-designer-design.js';
import { createLightbox } from './overlay.js';
import { openOptionSheet, readGroups } from './select-sheet.js';
import { createGridInput, trackPaintBarHeight } from './link-designer-grid-input.js';
import { DAY_LABELS, shiftLabel, cellAriaName, emptyPattern, isUnfilledPattern, editCellHtml, coverCellsHtml } from './link-designer-grid-cells.js';

const TOTAL_POS = ROTATING_LINES;   // the one declaration is link-designer-design.js's: every line rotates

/**
 * The options of any shift list: the cell sheet's (`includeRdSpare`) or the generator's time selects. CEAs work
 * no nights, so no night time is offered; `normaliseCustomShift` refuses one typed.
 * @param {string|null} currentVal @param {boolean} includeRdSpare
 * @param {{ early: string[], late: string[] }} offered  the times offered (`shiftOptionLists`, link-designer-today.js)
 */
export function shiftOptionsHtml(currentVal, includeRdSpare, { early: EARLY_OPTIONS, late: LATE_OPTIONS }) {
    const opt = (/** @type {any} */ val, /** @type {any} */ label) => {
        const sel = val === currentVal ? ' selected' : '';
        return `<option value="${escapeHtml(val)}"${sel}>${escapeHtml(label)}</option>`;
    };
    const known = new Set([...EARLY_OPTIONS, ...LATE_OPTIONS]);
    const isUnknown = currentVal && currentVal !== 'RD' && currentVal !== 'SPARE' && !known.has(currentVal);
    return [
        ...(includeRdSpare ? [opt('RD', 'RD — Rest Day'), opt('SPARE', 'SPARE — Standby')] : []),
        ...(isUnknown ? (includeRdSpare
            ? ['<optgroup label="Current">', opt(currentVal, `${currentVal} (current)`), '</optgroup>']
            : [opt(currentVal, currentVal)]) : []),
        ...(EARLY_OPTIONS.length ? [
            `<optgroup label="Early${includeRdSpare ? ' (starting before 11:00)' : ''}">`,
            ...EARLY_OPTIONS.map(s => opt(s, s)), '</optgroup>',
        ] : []),
        ...(LATE_OPTIONS.length ? [
            `<optgroup label="Late${includeRdSpare ? ' (starting 11:00 or after)' : ''}">`,
            ...LATE_OPTIONS.map(s => opt(s, s)), '</optgroup>',
        ] : []),
        // The paint chip's own label: longer text cut itself mid-word in the phone's narrow 16px column.
        opt('__custom__', 'Custom…'),
    ].join('');
}

/**
 * One line's three totals (v21.09). A COVER week shows the contracted week, muted, because it is a convention and
 * not a reading; its days are a dash — unknown, not none. An unfilled line is dashes, not "0h 00m" noise.
 * @param {{exSundayMinutes: number, allMinutes: number, days: number|null, assumed: boolean,
 *          unreadable: number, loneSpare?: number, unfilled: boolean}|undefined} t
 */
export function totalCellsHtml(t) {
    // The reason ADDS to the figure (links-app-15): a cell's name replaces its content, and the total went unread.
    const cell = (/** @type {string} */ text, /** @type {string} */ extra = '', /** @type {string} */ why = '') =>
        `<td class="tot-cell${extra}"${why ? ` aria-label="${escapeHtml(`${text === '—' ? 'Not known' : text}. ${why}`)}"` : ''}>${escapeHtml(text)}</td>`;
    if (!t || t.unfilled) return cell('—') + cell('—') + cell('—');
    if (t.assumed) {   // a timed Sunday overtime turn is real hours on top, and the footer counts it
        const h = hmFromHours(t.exSundayMinutes / 60), all = hmFromHours(t.allMinutes / 60);
        const why = 'Cover week — counted as the contracted week; it carries no stored times';
        return cell(h, ' tot-assumed', why) + cell(all, ' tot-assumed', all === h ? why : 'Cover week — the contracted week, plus its Sunday overtime')
            + cell('—', ' tot-assumed', 'A cover week does not record which days it works');
    }
    // A floor — an unreadable duty, or a lone spare day with no times (lineTotals) — is orange and ends in "+".
    const floor = t.unreadable + (t.loneSpare ?? 0);
    const flag = floor ? ' tot-uncertain' : '';
    // A line with no Sunday duty has the same figure twice; muting the repeat lets the Sunday lines stand out.
    const same = !floor && t.allMinutes === t.exSundayMinutes ? ' tot-same' : '';
    const why  = floor ? [
        t.unreadable ? `${t.unreadable} duty time${t.unreadable === 1 ? '' : 's'} on this line could not be read` : '',
        t.loneSpare ? `${t.loneSpare} spare day${t.loneSpare === 1 ? '' : 's'} on this line carr${t.loneSpare === 1 ? 'ies' : 'y'} no times` : '',
    ].filter(Boolean).join(', and ') + ', so these totals are a floor' : '';
    return cell(hmFromHours(t.exSundayMinutes / 60), flag, why)
        + cell(hmFromHours(t.allMinutes / 60), flag + same, same ? 'No Sunday duty on this line' : why)
        + cell(String(t.days ?? '—'), flag, why);
}

/**
 * The grid's Cover footer row: each day's counts, then the rotation averages under the totals columns.
 * @param {any} cov  from calcCoverage
 * @param {any} totals  from lineTotals — the per-line rows this footer averages; without it, no averages
 * @param {Record<string, any>} patterns  the design's, for the hours averages
 */
export function coverFootHtml(cov, totals, patterns) {
    const cells = coverCellsHtml(cov);
    // The hours averages are `weeklyHours`', as the checks row and the strip read them; only the DAYS average is the
    // footer's own, over the WORKING lines (invariant 7), so both divisors are printed.
    const wh  = weeklyHours(patterns, TOTAL_POS);
    // "(partial)" says what `hoursFigure` says on the checks row and the strip, on a line of its own under the
    // figure: beside it, it widened the last columns past the card at 769px. Not a "+" floor — a line with no
    // readable time is LEFT OUT of the average, which can then be high as well as low.
    const avg = (/** @type {number|null} */ v, /** @type {string} */ text, /** @type {string} */ note, partial = false) =>
        `<td class="tot-cell tot-avg">` +
        (v === null ? `<span class="tot-avg-num">—</span>`
            : `<span class="tot-avg-num">${escapeHtml(text)}</span>`) +
        (partial && v !== null ? `<span class="tot-avg-note tot-avg-partial">(partial)</span>` : '') +
        `<span class="tot-avg-note">${escapeHtml(note)}</span></td>`;
    const lineWord = (/** @type {number} */ n, /** @type {string} */ w) => `over ${n} ${w}${n === 1 ? '' : 's'}`;
    const avgCells = totals
        ? avg(wh.exSunday, hoursFigure(wh).hm ?? '—', lineWord(TOTAL_POS, 'line'), hoursFigure(wh).partial)
        + avg(wh.all, hoursFigure(wh, 'all').hm ?? '—', lineWord(TOTAL_POS, 'line'), hoursFigure(wh, 'all').partial)
        + avg(totals.daysAverage, String(totals.daysAverage ?? ''), lineWord(totals.daysLines, 'working line'))
        : '';
    return `<tr><td class="col-pos cov-foot-label">Cover</td>${cells}${avgCells}</tr>`;
}

/**
 * Wire the design grid, once.
 * @param {object} deps
 * @param {() => ({ patterns: Record<string, any> } | null)} deps.getDesign  the working copy, or null
 * @param {() => void} deps.markEdited  a cell changed: the working copy is dirty, and the Save buttons follow
 * @param {() => { title: string, msg: string, offers: boolean, retry: boolean }} deps.describeEmpty  `emptyStateFor`'s answer now
 * @param {() => boolean} deps.isComparing
 * @param {{ armed: () => any, render: () => void, renderIfChanged: () => void }} deps.brushBar  link-designer-brush-bar.js
 * @param {(message: string, defaultValue?: string) => Promise<string|null>} deps.askCustomShift
 * @param {string} deps.customPrompt  the Custom… question
 * @param {(currentVal: string|null, includeRdSpare?: boolean) => string} deps.shiftOptions  `shiftOptionsHtml` on the offered times
 * @param {() => void} deps.renderCoverageCard
 * @param {() => void} deps.renderDesignChecks
 * @param {() => void} deps.renderSummary
 * @param {() => void} deps.openGenerator  opens the Build a link card, chevron and ARIA included
 * @returns {{ render: () => void }}
 */
export function createDesignGrid(deps) {
    const { getDesign, markEdited, describeEmpty, isComparing, brushBar, askCustomShift, customPrompt, shiftOptions,
        renderCoverageCard, renderDesignChecks, renderSummary, openGenerator } = deps;

    /** The grid card's hint, which must not describe a grid that is not on screen (v19.66). @param {boolean} hasDesign */
    function _setGridHint(hasDesign) {
        const el = document.getElementById('linksGridHint');
        if (el) el.textContent = hasDesign
            ? 'Choose any shift cell to change it. Use the Paint bar to fill cells quickly. Save when done.'
            : `A link is ${TOTAL_POS} lines — everyone works line 1 one week, line 2 the next, all the way round.`;
    }

    /**
     * A design holding MORE lines than the rotation (v19.98). Nothing about opening one looks wrong — the grid and every
     * panel read the rotation's lines, and the next save writes the rest back — so it is assessed as one thing and stored
     * as another. The data is left alone (dropped on load or on save, it is somebody's work gone) and the fact is said.
     * A statement, not a `confirm()`: there is no decision to take now.
     */
    function _renderOverLengthNotice() {
        const el = document.getElementById('linksOverLengthNotice');
        if (!el) return;
        const design = getDesign();
        const held = Object.keys(/** @type {Record<string, any>} */ (design?.patterns || {})).length;
        if (!design || held <= TOTAL_POS) { el.style.display = 'none'; el.textContent = ''; return; }
        el.style.display = '';
        el.textContent = `This design holds ${held} lines and the rotation is now ${TOTAL_POS}. `
            + `Lines ${TOTAL_POS + 1}–${held} are not shown and are not counted in Coverage or Design `
            + `checks, but they are still stored and are saved with the design. It was built for the `
            + `${held}-line link; build the new one fresh rather than editing this.`;
    }

    function renderGrid() {
        const tbody      = document.getElementById('linksGridBodyRows');
        const tfoot      = document.getElementById('linksCoverageFoot');
        const wrapper    = document.getElementById('linksGridWrapper');
        const emptyState = document.getElementById('linksEmptyState');
        const saveRow    = document.getElementById('linksSaveRow');
        const design     = getDesign();

        if (!design) {
            renderSummary();   // hidden with the save row, but a stale strip would flash on the next design
            // FOUR states, and only the last two may offer to make a design — the words and the rule are
            // `emptyStateFor` (link-designer-design-load.js); this only puts them on the card.
            const empty = describeEmpty();
            const offers = empty.offers;
            const emptyMsg   = document.getElementById('linksEmptyMsg');
            const emptyTitle = document.querySelector('#linksEmptyState .link-designer-empty-title');
            const emptyActs  = /** @type {HTMLElement|null} */ (document.querySelector('#linksEmptyState .link-designer-empty-actions'));
            const retry      = document.getElementById('linksEmptyRetry');
            if (emptyTitle) emptyTitle.textContent = empty.title;
            if (emptyMsg) emptyMsg.innerHTML = empty.msg;
            if (emptyActs) emptyActs.style.display = offers ? '' : 'none';
            if (retry) retry.style.display = empty.retry ? '' : 'none';
            _setGridHint(false);
            _renderOverLengthNotice();   // `design` is null here, so this hides it
            if (wrapper)    wrapper.style.display    = 'none';
            if (emptyState) emptyState.style.display = '';
            if (saveRow)    saveRow.style.display    = 'none';
            if (tbody)      tbody.innerHTML          = '';
            if (tfoot)      tfoot.innerHTML          = '';
            document.body.classList.remove('link-designer-compare-on');
            if (offers) openGenerator();
            brushBar.render();
            renderCoverageCard();
            renderDesignChecks();
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        if (saveRow)    saveRow.style.display    = '';
        const emptyStatus = document.getElementById('linksEmptyStatus'); if (emptyStatus) emptyStatus.textContent = '';   // done with
        _setGridHint(true);

        // In compare mode the grid is hidden on SCREEN only (body class): print always outputs the open design.
        if (wrapper) wrapper.style.display = '';
        document.body.classList.toggle('link-designer-compare-on', isComparing());

        const totals = lineTotals(design.patterns, TOTAL_POS);
        const rows = [];
        for (let pos = 1; pos <= TOTAL_POS; pos++) {
            const posStr  = String(pos);
            const p        = (/** @type {Record<string, any>} */ (design.patterns))[posStr] || emptyPattern();
            const rowClass = isUnfilledPattern(p) ? 'row-unfilled' : '';

            const dayCells = DAYS.map(d => editCellHtml(posStr, d, p[d] ?? 'RD', classifyShift)).join('');

            rows.push(
                `<tr class="${rowClass}" data-pos="${posStr}">` +
                `<td class="pos-num">${posStr}</td>` +
                dayCells +
                totalCellsHtml(totals.rows[pos - 1]) +
                `</tr>`
            );
        }
        grid.render(rows.join(''));   // one Tab stop among the cells, and focus kept if a cell held it
        _renderOverLengthNotice();

        const cov = calcCoverage(design.patterns);
        renderFooter(cov, totals);
        renderCoverageCard();
    }

    /** Paint one cell and repaint what reads it. @param {any} pos @param {any} day @param {any} shift */
    function applyShift(pos, day, shift) {
        const design = getDesign();
        if (!design) return;
        const pats = /** @type {Record<string, any>} */ (design.patterns);
        if (!pats[pos]) pats[pos] = emptyPattern();
        // The value it already holds is not a change, or a stray tap arms every unsaved-work question (v19.38).
        if (pats[pos][day] === shift) return;
        pats[pos][day] = shift;
        markEdited();

        const tbody = document.getElementById('linksGridBodyRows');
        const btn = /** @type {HTMLElement|null} */ (tbody?.querySelector(`.shift-cell-btn[data-pos="${pos}"][data-day="${day}"]`) ?? null);
        if (btn) repaintCellBtn(btn, pos, day, shift);

        const tr = tbody?.querySelector(`tr[data-pos="${pos}"]`);
        if (tr) tr.classList.toggle('row-unfilled', isUnfilledPattern(pats[pos]));

        const cov = calcCoverage(design.patterns);
        // Only the EDITED row's totals: a whole-grid render would tear out the cell under the pointer.
        const totals = lineTotals(design.patterns, TOTAL_POS);
        if (tr) {
            tr.querySelectorAll('.tot-cell').forEach(el => el.remove());
            tr.insertAdjacentHTML('beforeend', totalCellsHtml(totals.rows[Number(pos) - 1]));
        }
        renderFooter(cov, totals);
        // The bar is the design's times, so it is redrawn only when they change: a drag paints cell by cell.
        brushBar.renderIfChanged();
        renderCoverageCard();
        renderDesignChecks();
    }

    /**
     * @param {any} cov
     * @param {any} [totals]  from lineTotals — the per-line rows this footer averages
     */
    function renderFooter(cov, totals) {
        const tfoot = document.getElementById('linksCoverageFoot');
        const design = getDesign();
        if (!tfoot || !design || !cov) return;
        tfoot.innerHTML = coverFootHtml(cov, totals, design.patterns);
    }

    /**
     * The app's own sheet over one cell — never a native `<select>`, whose popup the OS draws (v23.38). The button stays
     * put, so a dismissed sheet has changed nothing. The options are `shiftOptions`', read off a detached select by
     * the sheet's `readGroups`: one producer, its `<optgroup>`s the sheet's headings.
     * @param {any} btn
     */
    function openCellEdit(btn) {
        const design = getDesign();
        if (!design) return;
        const pos      = btn.dataset.pos;
        const day      = btn.dataset.day;
        const dayLabel = DAY_LABELS[DAYS.indexOf(day)];
        const current  = (/** @type {Record<string, any>} */ (design.patterns))[pos]?.[day] ?? 'RD';

        const holder = document.createElement('select');
        holder.innerHTML = shiftOptions(current, true);

        openOptionSheet({
            title: `Line ${pos} · ${dayLabel}`,
            searchLabel: 'Search shift times',
            groups: readGroups(holder),
            current,
            createLightbox,
            onPick: async value => {
                let newVal = value;
                if (newVal === '__custom__') {
                    const typed = await askCustomShift(customPrompt, current.includes('-') ? current : '');
                    if (!typed) return;   // cancelled or refused: the cell was never taken apart
                    newVal = typed;
                }
                // `applyShift` alone decides whether this is a change (v19.38).
                applyShift(pos, day, newVal);
            },
        });
    }

    /**
     * Repaint a cell's button IN PLACE: replaced, it dropped focus to `<body>` after every keyboard edit.
     * @param {HTMLElement} btn @param {any} pos @param {any} day @param {any} shift
     */
    function repaintCellBtn(btn, pos, day, shift) {
        btn.className = `shift-cell-btn type-${classifyShift(shift)}`;
        btn.setAttribute('aria-label', cellAriaName(pos, day, shift));
        btn.textContent = shiftLabel(shift);
    }

    // The grid's input is link-designer-grid-input.js's; what a cell MEANS — paint it, or open the sheet — is here.
    const grid = createGridInput(document.getElementById('linksGridBodyRows'), {
        lines: TOTAL_POS, days: DAYS, ready: () => !!getDesign(), armed: () => brushBar.armed() !== null,
        paint: (pos, day) => applyShift(pos, day, brushBar.armed()), edit: openCellEdit,
    });
    trackPaintBarHeight(document.getElementById('brushBar'), document.getElementById('linksGridTable'));

    return { render: renderGrid };
}
