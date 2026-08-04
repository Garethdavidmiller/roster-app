// Tests for links-compare.js — compare mode extracted from links-app.js. Fake DOM, no module mocks
// → runs in `npm run test:hygiene`. Proves the OWNED compare state (toggle/select/reset) + the
// render (both grids, headers, diff cells) + the injected-getter seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const els = /** @type {Record<string, any>} */ ({});
function mkEl() {
    const set = new Set();
    return {
        innerHTML: '', textContent: '', style: {},
        classList: { add: (/** @type {string} */ c) => set.add(c), remove: (/** @type {string} */ c) => set.delete(c), contains: (/** @type {string} */ c) => set.has(c) },
    };
}
function resetDom() {
    for (const id of ['compareGridsWrap', 'compareHeadA', 'compareHeadB', 'compareGridBodyRowsA', 'compareGridBodyRowsB', 'compareGridFootA', 'compareGridFootB']) els[id] = mkEl();
}
resetDom();
global.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] || null });

const { initLinksCompare } = await import('./links-compare.js');

const DAYKEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const rest = () => Object.fromEntries(DAYKEYS.map(d => [d, 'RD']));
function fullPatterns(shift = '06:00-14:00') {
    const p = /** @type {Record<string, any>} */ ({});
    for (let i = 1; i <= 28; i++) p[String(i)] = { sun: 'RD', mon: shift, tue: shift, wed: shift, thu: shift, fri: shift, sat: 'RD' };
    return p;
}

/** Two designs: A (early) active, B (late). */
function makeDeps(overrides = {}) {
    const calls = { renderDesignPicker: 0, renderGrid: 0, renderBrushBar: 0, dearmBrush: 0 };
    const deps = {
        getDesigns: () => [{ id: 'a', name: 'A', patterns: fullPatterns() }, { id: 'b', name: 'B', patterns: fullPatterns('12:00-19:00') }],
        getActiveDesignId: () => 'a',
        getDesign: () => ({ id: 'a', name: 'A', patterns: fullPatterns() }),
        renderDesignPicker: () => { calls.renderDesignPicker++; },
        renderGrid: () => { calls.renderGrid++; },
        renderBrushBar: () => { calls.renderBrushBar++; },
        dearmBrush: () => { calls.dearmBrush++; },
        emptyPattern: rest,
        isUnfilledPattern: (/** @type {any} */ p) => DAYKEYS.every(d => (p[d] ?? 'RD') === 'RD'),
        shiftLabel: (/** @type {string} */ s) => s,
        ...overrides,
    };
    return { deps, calls };
}

test('initial state: not comparing, no compare id', () => {
    const c = initLinksCompare(makeDeps().deps);
    assert.equal(c.isCompareMode(), false);
    assert.equal(c.getCompareId(), null);
});

test('toggle with >=2 designs enters compare + auto-picks a non-active id; toggles back off', () => {
    resetDom();
    const { deps, calls } = makeDeps();
    const c = initLinksCompare(deps);
    c.toggleCompareMode();
    assert.equal(c.isCompareMode(), true);
    assert.equal(c.getCompareId(), 'b');            // the non-active design
    assert.ok(calls.dearmBrush >= 1 && calls.renderDesignPicker >= 1);
    c.toggleCompareMode();
    assert.equal(c.isCompareMode(), false);
    assert.equal(c.getCompareId(), null);
});

test('toggle is a no-op with <2 designs', () => {
    const { deps } = makeDeps({ getDesigns: () => [{ id: 'a', name: 'A', patterns: fullPatterns() }] });
    const c = initLinksCompare(deps);
    c.toggleCompareMode();
    assert.equal(c.isCompareMode(), false);
});

test('renderCompare renders both grids + headers with diff cells when comparing', () => {
    resetDom();
    const c = initLinksCompare(makeDeps().deps);
    c.toggleCompareMode();   // enters compare (id='b'), which calls renderCompare
    assert.ok(els.compareGridsWrap.classList.contains('compare-mode-active'));
    // Headers are innerHTML since v19.54 — each carries its design's STAFFED WINDOW beneath the
    // name. That is not decoration: compare diffs CELLS, so two designs built to different spans
    // would otherwise sit side by side reading as like for like.
    assert.match(els.compareHeadA.innerHTML, /^A/);
    assert.match(els.compareHeadB.innerHTML, /^B/);
    for (const el of [els.compareHeadA, els.compareHeadB]) {
        assert.match(el.innerHTML, /compare-window/, 'each column must state its window');
        assert.match(el.innerHTML, /Mon–Sat 06:20–23:55 · Sun 07:15–23:25/, 'an unset window shows its effective value');
    }
    assert.match(els.compareGridBodyRowsA.innerHTML, /shift-cell/);
    assert.match(els.compareGridBodyRowsA.innerHTML, /cell-diff/);   // A (early) vs B (late) differ
    assert.match(els.compareGridFootA.innerHTML, /cov-cell/);
});

test('renderCompare clears the active class when not comparing', () => {
    resetDom();
    const c = initLinksCompare(makeDeps().deps);
    els.compareGridsWrap.classList.add('compare-mode-active');
    c.renderCompare();   // not comparing → removes the class
    assert.equal(els.compareGridsWrap.classList.contains('compare-mode-active'), false);
});

test('resetCompare clears state', () => {
    const c = initLinksCompare(makeDeps().deps);
    c.toggleCompareMode();
    assert.equal(c.isCompareMode(), true);
    c.resetCompare();
    assert.equal(c.isCompareMode(), false);
    assert.equal(c.getCompareId(), null);
});

test('selectCompareDesign sets the compare id and re-renders the picker', () => {
    resetDom();
    const { deps, calls } = makeDeps();
    const c = initLinksCompare(deps);
    const before = calls.renderDesignPicker;
    c.selectCompareDesign('b');
    assert.equal(c.getCompareId(), 'b');
    assert.ok(calls.renderDesignPicker > before);
});
