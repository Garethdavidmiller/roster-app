// @ts-check
/**
 * huddle-table-grid.js — WHICH CELLS ARE ACTUALLY IN COLUMN 1 OF A HUDDLE TABLE.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────
 *
 * The Huddle viewer pins the first column so a row scrolled sideways still says whose it is. CSS
 * selects that column as `td:first-child`, and **that selector does not mean "column 1"** — it
 * means "the first cell written in this row's markup". The two agree only in a table where every
 * row states every cell, and the real Huddle is not one: the Gate line job cell carries
 * `rowspan="3"`, so the two rows beneath it write no cell of their own in column 1 and
 * `td:first-child` resolves to the CALL SIGN. C17 and C18 were pinned to the left edge, drawn on
 * top of the job cell's own text. Reported from a phone, twice, with a screenshot each time.
 *
 * There is no CSS answer — `:nth-col()` is unimplemented everywhere — so the column has to be
 * COMPUTED and marked. v22.31 met the report by switching the whole feature off for any table
 * containing a rowspan, which is safe and costs the feature precisely where it is worth most: the
 * real Huddle has rowspans, so no Huddle staff actually read was pinning anything.
 *
 * ── What it computes ─────────────────────────────────────────────────────────────────────────
 *
 * The HTML table grid: walk rows in order, carrying forward how many further rows each column is
 * still occupied by a cell spanning down from above, and place each written cell in the first
 * column not already taken. A cell is in column 1 when it lands at grid index 0. That is the same
 * slot assignment the browser performs to lay the table out, so the mask and the render agree by
 * construction rather than by resemblance.
 *
 * ── Two rules an edit can quietly break ──────────────────────────────────────────────────────
 *
 * **`rowspan="0"` means "to the end of this row group", not "one row".** The DOM reports it as the
 * integer 0, so the ordinary `|| 1` defaulting turns the widest span in HTML into the narrowest —
 * and every row under it then reports a column-1 cell it does not have, which is the reported
 * defect arriving by a second route. It is treated as spanning without end here. `colspan="0"` is
 * a different matter: browsers clamp it to 1 and so does this.
 *
 * **The answer is per CELL, never per row or per table.** A row can legitimately have no column-1
 * cell at all, and a table can mix the two. Anything that collapses this to one boolean is the
 * `td:first-child` mistake rewritten.
 *
 * Pure — no DOM, no imports — so the algorithm is exercised in Node over hand-built shapes
 * including the real Huddle's. `wrapTables` in calendar-huddle-viewer.js is the only caller; it
 * reads `rowSpan`/`colSpan` off the real cells and hands back the marking.
 *
 * Tested by huddle-table-grid.test.mjs, teeth-verified by four mutations. **One of them cannot be
 * made to fail and the reason is worth knowing**: advancing by `colSpan` rather than by 1 is
 * redundant, because the carry is already written across the cell's whole width and the skip loop
 * then steps over it. It is kept because it states the intent, and because the redundancy is a
 * property of the carry loop — anyone narrowing that write would silently need this line back.
 */

/**
 * Which of a table's written cells occupy physical column 1.
 *
 * @param {{ rowSpan?: number, colSpan?: number }[][]} rows one array per row, in document order,
 *   holding only the cells that row actually WRITES (a cell spanned into from above is absent —
 *   that is the whole point).
 * @returns {boolean[][]} the same shape, `true` where that cell starts at grid column 0.
 */
export function firstColumnMask(rows) {
    /** @type {number[]} carry[c] = further rows column c is still occupied for, from above. */
    const carry = [];
    const mask = [];

    for (const row of rows) {
        const out = [];
        let col = 0;
        for (const cell of row) {
            // Skip every column a cell from an earlier row is still sitting in.
            while ((carry[col] || 0) > 0) col++;
            out.push(col === 0);

            // `colspan="0"` is clamped to 1 by every browser; `rowspan="0"` is not — it runs to the
            // end of the row group, so it must never fall through to 1 (see the header).
            const colSpan = Math.max(1, cell.colSpan || 1);
            const rowSpan = cell.rowSpan === 0 ? Infinity : Math.max(1, cell.rowSpan || 1);
            for (let c = col; c < col + colSpan; c++) carry[c] = rowSpan;
            col += colSpan;
        }
        mask.push(out);
        for (let c = 0; c < carry.length; c++) if (carry[c] > 0) carry[c]--;
    }

    return mask;
}
