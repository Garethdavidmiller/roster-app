// @ts-check
/**
 * links-grid-input.js — how the design grid on links.html is OPERATED: from a keyboard, one Tab stop
 * and the arrow keys; with a mouse, a press-and-drag that paints every cell it crosses.
 *
 * The coordinator (`links-app.js`) still decides what a cell MEANS — paint it with the armed brush, or
 * open the shift sheet over it. This module decides only which cell an input lands on, and keeps focus
 * where a keyboard user left it. It reaches for no id of its own, so its rule, `cellAfterKey`, is
 * tested in Node (links-grid-input.test.mjs) and the wiring in a browser (e2e/links.spec.js).
 *
 * ── ONE TAB STOP, NOT ONE PER CELL (desktop audit, Nov 2026) ──────────────────────────────────────
 *
 * Every cell is a `<button>`, and every button was a Tab stop — the whole rotation times seven days
 * between the paint bar and the generator, so a keyboard user crossed the grid to reach the next card.
 * It is now a ROVING TABINDEX, the WAI-ARIA data-grid pattern: the cell last used is the grid's one Tab
 * stop (`tabindex="0"`) and every other is `-1`; the arrow keys move between cells and stop at the
 * edges; Home and End go to either end of a line, and with Ctrl to the first or last cell of the grid.
 * The table keeps its own semantics (no `role="grid"`), so a screen reader still reads a table, and
 * every cell's name still says its line, its day and its shift.
 *
 * Focus SURVIVES AN EDIT only because `applyShift` repaints the cell's button in place. It used to
 * build a new one, and focus — on the button Enter had just pressed, or the one the shift sheet's
 * close had just handed it back to — fell to `<body>` after every keyboard edit.
 *
 * ── A MOUSE STROKE PAINTS EVERY CELL IT CROSSES ───────────────────────────────────────────────────
 *
 * With a brush armed, pressing a cell paints it, moving over others with the button held paints them
 * too, and the release ends the stroke. Three things keep it honest:
 *   1. ONLY A MOUSE. A finger on a phone scrolls the grid, and a touch stroke would paint every cell a
 *      scroll began on. Touch and pen keep what they had: the tap's `click` paints one cell.
 *   2. THE CLICK THAT ENDS A STROKE BELONGS TO IT. The press has already painted, so that click must
 *      neither paint again nor — after Escape disarmed the brush mid-stroke — open the sheet. A
 *      keyboard's click (`detail` 0) never belongs to a stroke.
 *   3. EVERY CELL GOES THROUGH THE COORDINATOR'S `paint` — `applyShift`, which owns the dirty flag and
 *      "the same value is not a change". A stroke is only a faster way of clicking.
 *
 * ── THE PAINT BAR STAYS IN REACH ──────────────────────────────────────────────────────────────────
 *
 * From 768px on a fine pointer the paint bar sticks above the grid and the day header sticks beneath
 * it (links.css) — at the bar's HEIGHT, which wraps with the chips, so `trackPaintBarHeight` measures
 * it and publishes it on the table as `--brush-bar-h`.
 */

/** @typedef {{ pos: number, day: number }} GridPoint  a 1-based line and a 0-based day column */

/**
 * Where a key moves the grid's cursor, or null when the grid does not own that key. Pure.
 * The arrows step one cell and stop at the edges, as a data grid's do; Home and End go to either end
 * of the line, and with Ctrl to the first or the last cell of the whole grid.
 * @param {string} key  a `KeyboardEvent.key`
 * @param {GridPoint} at
 * @param {{ lines: number, days: number, ctrl?: boolean }} size
 * @returns {GridPoint|null}
 */
export function cellAfterKey(key, at, { lines, days, ctrl = false }) {
    const pos = Math.min(Math.max(at.pos, 1), lines);
    const day = Math.min(Math.max(at.day, 0), days - 1);
    switch (key) {
        case 'ArrowLeft':  return { pos, day: Math.max(0, day - 1) };
        case 'ArrowRight': return { pos, day: Math.min(days - 1, day + 1) };
        case 'ArrowUp':    return { pos: Math.max(1, pos - 1), day };
        case 'ArrowDown':  return { pos: Math.min(lines, pos + 1), day };
        case 'Home':       return { pos: ctrl ? 1 : pos, day: 0 };
        case 'End':        return { pos: ctrl ? lines : pos, day: days - 1 };
        default:           return null;
    }
}

/**
 * Wire the grid body. Every handler is delegated to the body, so a re-render can never orphan one.
 * @param {HTMLElement|null} body  holds the cells: `.shift-cell-btn` buttons carrying `data-pos` and `data-day`
 * @param {{ lines: number, days: string[], ready: () => boolean, armed: () => boolean,
 *           paint: (pos: string, day: string) => void, edit: (cell: HTMLElement) => void }} opts
 *   `armed`: is a brush on · `paint`: paint one cell with it · `edit`: open the shift sheet over one
 * @returns {{ render: (html: string) => void }}
 */
export function createGridInput(body, opts) {
    if (!body) return { render() {} };
    const tbody = body;
    const { lines, days } = opts;
    let cursor = { pos: '1', day: days[0] };
    /** @type {number|null} */ let stroke = null;   // the pointerId of the mouse stroke in progress
    let strokeClick = false;                         // the press painted, so the click that ends it is spent
    let strokeGen = 0;

    const cellOf = (/** @type {any} */ target) => /** @type {HTMLElement|null} */ (target?.closest?.('.shift-cell-btn') ?? null);
    const cellAt = (/** @type {string} */ pos, /** @type {string} */ day) =>
        /** @type {HTMLElement|null} */ (tbody.querySelector(`.shift-cell-btn[data-pos="${pos}"][data-day="${day}"]`));
    const paint = (/** @type {HTMLElement} */ cell) => opts.paint(cell.dataset.pos ?? '', cell.dataset.day ?? '');

    /** Make `cell` the grid's one Tab stop. @param {HTMLElement} cell */
    function setCursor(cell) {
        cursor = { pos: cell.dataset.pos ?? '1', day: cell.dataset.day ?? days[0] };
        for (const b of tbody.querySelectorAll('.shift-cell-btn[tabindex="0"]')) if (b !== cell) b.setAttribute('tabindex', '-1');
        cell.setAttribute('tabindex', '0');
    }

    tbody.addEventListener('focusin', e => { const cell = cellOf(e.target); if (cell) setCursor(cell); });
    tbody.addEventListener('keydown', e => {
        const cell = cellOf(e.target);
        if (!cell || e.altKey || e.metaKey || e.shiftKey) return;
        const next = cellAfterKey(e.key, { pos: Number(cell.dataset.pos), day: days.indexOf(cell.dataset.day ?? '') },
            { lines, days: days.length, ctrl: e.ctrlKey });
        if (!next) return;   // Enter, Space, Tab and Escape keep their own meanings
        e.preventDefault();  // and an arrow never scrolls the page from inside the grid
        const to = cellAt(String(next.pos), days[next.day]);
        if (to) { setCursor(to); to.focus(); }
    });

    tbody.addEventListener('click', e => {
        const cell = cellOf(e.target);
        if (!cell || !opts.ready()) return;
        setCursor(cell);   // Safari does not focus a clicked button, so the click moves the Tab stop itself
        if (strokeClick && e.detail !== 0) { strokeClick = false; return; }
        if (opts.armed()) paint(cell);
        else opts.edit(cell);
    });

    tbody.addEventListener('pointerdown', e => {
        strokeGen++;
        strokeClick = false;
        if (e.pointerType !== 'mouse' || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        const cell = cellOf(e.target);
        if (!cell || !opts.ready() || !opts.armed()) return;
        stroke = e.pointerId;
        strokeClick = true;
        paint(cell);
    });
    tbody.addEventListener('pointerover', e => {
        if (stroke === null || e.pointerId !== stroke) return;
        // A release outside the window never reaches this page: no button held means the stroke is over.
        if (!(e.buttons & 1) || !opts.ready() || !opts.armed()) { stroke = null; return; }
        const cell = cellOf(e.target);
        if (cell) paint(cell);
    });
    const endStroke = () => {
        stroke = null;
        if (!strokeClick) return;
        // The click a release produces is dispatched in the same task as the release, so it has been
        // seen by the time this runs; a release off the grid produces none here, and is forgotten.
        const gen = strokeGen;
        setTimeout(() => { if (gen === strokeGen) strokeClick = false; }, 0);
    };
    document.addEventListener('pointerup', endStroke);
    document.addEventListener('pointercancel', endStroke);

    return {
        /** Replace the rows, keeping the Tab stop where it was — and keyboard focus, if a cell held it. @param {string} html */
        render(html) {
            const hadFocus = tbody.contains(document.activeElement);
            tbody.innerHTML = html;
            const cells = tbody.querySelectorAll('.shift-cell-btn');
            for (const b of cells) b.setAttribute('tabindex', '-1');
            const at = cellAt(cursor.pos, cursor.day) ?? /** @type {HTMLElement|null} */ (cells[0] ?? null);
            if (!at) return;
            setCursor(at);
            if (hadFocus) at.focus();
        },
    };
}

/**
 * Publish the paint bar's height on the grid's table as `--brush-bar-h`, for the day header to stick
 * beneath the bar (links.css). Measured, because the bar wraps with its chips; a hidden bar is 0.
 * @param {HTMLElement|null} bar
 * @param {HTMLElement|null} table
 */
export function trackPaintBarHeight(bar, table) {
    if (!bar || !table) return;
    // The fractional height, not `offsetHeight`: a rounded-down figure leaves a sub-pixel gap the rows show through.
    const measure = () => table.style.setProperty('--brush-bar-h', `${bar.getBoundingClientRect().height}px`);
    measure();
    // Shown, hidden or rebuilt, it is measured AS IT HAPPENS. A ResizeObserver alone was enough in Chromium,
    // but WebKit delivered its notice up to a second after the bar appeared, and a header measured before
    // then stuck to the top of the screen, under the bar.
    if (typeof MutationObserver === 'function') new MutationObserver(measure).observe(bar, { attributes: true, attributeFilter: ['style'], childList: true });
    // A wrap from a resize, from the font arriving or from a chip changing width: the ResizeObserver's.
    if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(bar);
}
