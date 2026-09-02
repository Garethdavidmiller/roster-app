/**
 * huddle-table-grid.test.mjs — the physical-column walk behind the Huddle's sticky job column.
 *
 * Organised by what a wrong answer COSTS, because the two directions are not symmetrical and only
 * one of them has been reported from a phone:
 *
 *   MARKING A CELL THAT IS NOT IN COLUMN 1 pins it to the left edge on top of the cell that
 *   genuinely is there. That is the shipped defect — C17 and C18 drawn over the Gate line job
 *   cell — and it is silent in every test that builds a rectangular table, because a rectangular
 *   table is the one shape where "first cell written" and "column 1" agree.
 *
 *   MISSING A CELL THAT IS in column 1 loses the pin for that row: the row scrolls away from its
 *   own job name. Visible, harmless, and self-explanatory when it happens.
 *
 * So the first block is the one with teeth. The fixture in it is the REAL Huddle's shape, taken
 * from the reported screenshot: a five-column duty board whose Gate line job cell spans the C17
 * and C18 rows.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { firstColumnMask } from './huddle-table-grid.js';

/** Terser fixtures: `cell()` is an ordinary 1×1, `cell(3)` spans three rows. */
const cell = (rowSpan = 1, colSpan = 1) => ({ rowSpan, colSpan });
const plainRow = (n) => Array.from({ length: n }, () => cell());

describe('marking a cell that is not in column 1 (the reported defect)', () => {
    test('the real Huddle: rows under a spanning job cell mark nothing', () => {
        // Shift        | Call Sign | Early | Middle | Late
        // Gate line ↓3 | Reminder  | ...   | ...    | ...
        //              | C17       | ...   | ...    | ...      ← writes 4 cells, none in column 1
        //              | C18       | ...   | ...    | ...
        // Booking Off. | —         | ...   | ...    | ...
        const mask = firstColumnMask([
            plainRow(5),
            [cell(3), ...plainRow(4)],
            plainRow(4),
            plainRow(4),
            plainRow(5),
        ]);

        assert.deepEqual(mask[1], [true, false, false, false, false], 'the Gate line cell IS column 1');
        assert.deepEqual(mask[2], [false, false, false, false],
            'C17 writes no column-1 cell — pinning its call sign is the reported bug');
        assert.deepEqual(mask[3], [false, false, false, false], 'and neither does C18');
        assert.deepEqual(mask[4], [true, false, false, false, false],
            'the row after the span reclaims column 1');
    });

    test('a span that reaches the last row leaves every row under it unmarked', () => {
        const mask = firstColumnMask([[cell(3), cell()], [cell()], [cell()]]);
        assert.deepEqual(mask, [[true], [false], [false]].map((m, i) => i === 0 ? [true, false] : m));
    });

    test('rowspan="0" spans to the end, and must not default to one row', () => {
        // The DOM reports rowspan="0" as the integer 0. `|| 1` turns the widest span in HTML into
        // the narrowest, and every row beneath then claims a column-1 cell it does not have —
        // the same overlap arriving by a second route.
        const mask = firstColumnMask([[cell(0), cell()], [cell()], [cell()], [cell()]]);
        assert.deepEqual(mask.slice(1), [[false], [false], [false]],
            'rowspan=0 runs to the end of the group; nothing below it is in column 1');
    });

    test('a colspan in column 1 marks only the one cell that starts there', () => {
        const mask = firstColumnMask([[cell(1, 2), cell(), cell()], plainRow(4)]);
        assert.deepEqual(mask[0], [true, false, false], 'the wide cell starts at column 0; the rest do not');
    });

    test('stacked spans of different depths each release their column on their own row', () => {
        //  A↓3 | B↓2 | c
        //      |     | c
        //      | d   | c      ← B's span ended, so this row writes into column 2 first
        //  e   | f   | g
        const mask = firstColumnMask([
            [cell(3), cell(2), cell()],
            [cell()],
            [cell(), cell()],
            plainRow(3),
        ]);
        assert.deepEqual(mask[1], [false], 'still inside both spans');
        assert.deepEqual(mask[2], [false, false], 'B released, A has not — first written cell is column 1? no');
        assert.deepEqual(mask[3], [true, false, false], 'both released');
    });
});

describe('missing a cell that IS in column 1 (the visible, lesser failure)', () => {
    test('a plain rectangular table marks the first cell of every row', () => {
        const mask = firstColumnMask([plainRow(5), plainRow(5), plainRow(5)]);
        for (const row of mask) assert.deepEqual(row, [true, false, false, false, false]);
    });

    test('a single-column table marks every cell', () => {
        assert.deepEqual(firstColumnMask([[cell()], [cell()]]), [[true], [true]]);
    });

    test('a span in a LATER column never suppresses column 1', () => {
        //  a | B↓2 | c
        //  a |     | c        ← writes 2 cells; the first is still column 1
        const mask = firstColumnMask([[cell(), cell(2), cell()], [cell(), cell()]]);
        assert.deepEqual(mask[1], [true, false],
            'a span elsewhere must not cost this row its pin');
    });

    test('an empty table and an empty row are answers, not crashes', () => {
        assert.deepEqual(firstColumnMask([]), []);
        assert.deepEqual(firstColumnMask([[], plainRow(2)]), [[], [true, false]]);
    });
});

describe('the shape of the answer', () => {
    test('it is per CELL — never one boolean per row or per table', () => {
        // Anything that collapses this is `td:first-child` rewritten.
        const mask = firstColumnMask([plainRow(3), [cell(2), cell(), cell()], plainRow(2)]);
        assert.equal(mask.length, 3);
        assert.deepEqual(mask.map(r => r.length), [3, 3, 2], 'one entry per WRITTEN cell');
    });

    test('the mask lines up with the rows it was built from', () => {
        const rows = [plainRow(5), [cell(3), ...plainRow(4)], plainRow(4)];
        const mask = firstColumnMask(rows);
        rows.forEach((row, i) => assert.equal(mask[i].length, row.length,
            `row ${i}: a caller indexes cells by position, so the shapes must match exactly`));
    });
});
