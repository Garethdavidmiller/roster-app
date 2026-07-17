// Tests for the pure `monthCells` helper in date-picker.js (the DOM-driven picker
// itself is exercised by the Playwright e2e drive, not here). Part of test:hygiene —
// importing date-picker.js is side-effect-free (all DOM access is inside functions).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// date-picker.js imports overlay.js, which registers a top-level popstate listener —
// stub the browser globals so the module graph loads in Node, then dynamic-import
// (static import would hoist above the stubs). Same pattern as overlay.test.mjs.
global.window  = { addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false }) };
global.history = { pushState: () => {}, back: () => {} };
global.document = { addEventListener: () => {} };

const { monthCells } = await import('./date-picker.js');

test('monthCells — January 2026 (starts Thursday → 3 Monday-first blanks, 31 days)', () => {
    const cells = monthCells(2026, 0);
    const leading = cells.findIndex(c => c !== null);
    assert.equal(leading, 3, 'Thursday start → 3 leading nulls (Mon-first)');
    assert.equal(cells.slice(0, 3).every(c => c === null), true);
    assert.equal(cells[3], '2026-01-01');
    assert.equal(cells[cells.length - 1], '2026-01-31');
    assert.equal(cells.length, 3 + 31);
});

test('monthCells — February 2026 (starts Sunday → 6 blanks, 28 days, non-leap)', () => {
    const cells = monthCells(2026, 1);
    assert.equal(cells.filter(c => c === null).length, 6);
    assert.equal(cells.filter(c => c !== null).length, 28);
    assert.equal(cells[6], '2026-02-01');
    assert.equal(cells[cells.length - 1], '2026-02-28');
});

test('monthCells — a Monday-start month has zero leading blanks', () => {
    // June 2026: 1 June 2026 is a Monday.
    const cells = monthCells(2026, 5);
    assert.notEqual(cells[0], null);
    assert.equal(cells[0], '2026-06-01');
    assert.equal(cells.filter(c => c !== null).length, 30);
});

test('monthCells — real days are zero-padded, in-order, contiguous ISO strings', () => {
    const cells = monthCells(2026, 6).filter(c => c !== null); // July
    assert.equal(cells[0], '2026-07-01');   // zero-padded day
    assert.equal(cells[8], '2026-07-09');
    for (let i = 1; i < cells.length; i++) {
        assert.equal(new Date(cells[i]) - new Date(cells[i - 1]), 864e5, 'consecutive days');
    }
});

test('monthCells — leap February 2028 has 29 days', () => {
    const cells = monthCells(2028, 1).filter(c => c !== null);
    assert.equal(cells.length, 29);
    assert.equal(cells[28], '2028-02-29');
});
