// Tests for links-compare.js — compare mode extracted from links-app.js. Fake DOM, no module mocks
// → runs in `npm run test:hygiene`. Proves the OWNED compare state (toggle/select/reset) + the
// render (both grids, headers, diff cells) + the injected-getter seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROTATING_LINES } from './links-design.js';

const els = /** @type {Record<string, any>} */ ({});
function mkEl() {
    const set = new Set();
    return {
        innerHTML: '', textContent: '', style: {},
        classList: { add: (/** @type {string} */ c) => set.add(c), remove: (/** @type {string} */ c) => set.delete(c), contains: (/** @type {string} */ c) => set.has(c) },
    };
}
function resetDom() {
    for (const id of ['compareGridsWrap', 'compareHeadA', 'compareHeadB', 'compareGridBodyRowsA', 'compareGridBodyRowsB', 'compareGridFootA', 'compareGridFootB', 'compareSummary']) els[id] = mkEl();
}
resetDom();
global.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] || null });

const { initLinksCompare } = await import('./links-compare.js');

const DAYKEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const rest = () => Object.fromEntries(DAYKEYS.map(d => [d, 'RD']));
// Sized from ROTATING_LINES: compare renders that many rows, and this module held its OWN literal
// 28 until v19.98 — so a fixture with its own copy would have agreed with the bug rather than
// catching it.
function fullPatterns(shift = '06:00-14:00') {
    const p = /** @type {Record<string, any>} */ ({});
    for (let i = 1; i <= ROTATING_LINES; i++) p[String(i)] = { sun: 'RD', mon: shift, tue: shift, wed: shift, thu: shift, fri: shift, sat: 'RD' };
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

// ── THE DIFFERENCE, NOT A PICTURE OF IT (v22.60, external review) ───────────────────────────────
//
// Compare mode put two grids side by side and outlined the differing cells gold, which is a picture:
// reading it meant holding 336 cells in your head and doing the comparison privately. The strip does
// the arithmetic. Organised by what a wrong summary costs — a figure that is WRONG sends a designer
// into a room with the wrong option, and a figure that is MISSING quietly reads as "no difference".
test('compare states how much differs, and states it in lines as well as cells', () => {
    resetDom();
    const a = fullPatterns('06:00-14:00');
    const b = fullPatterns('06:00-14:00');
    b['2'].mon = '14:00-22:00';           // one cell, one line
    const api = initLinksCompare(makeDeps({
        getDesigns: () => [{ id: 'a', name: 'A', patterns: a }, { id: 'b', name: 'B', patterns: b }],
        getDesign:  () => ({ id: 'a', name: 'A', patterns: a }),
    }).deps);
    api.toggleCompareMode(); api.selectCompareDesign('b'); api.renderCompare();
    const html = els.compareSummary.innerHTML;
    assert.match(html, /<strong>1<\/strong> cell differ/, 'the cell count is wrong or absent');
    assert.match(html, /<strong>1<\/strong> line/,
        'the strip counts cells but not LINES. 18 cells on one line and 18 across six are different '
        + 'proposals, and the grids cannot be scanned for that.');
});

test('an UNCHANGED figure still renders — "the same" must not look like "not measured"', () => {
    resetDom();
    const a = fullPatterns('06:00-14:00');
    const b = fullPatterns('06:00-14:00');
    b['2'].mon = '14:00-22:00';
    const api = initLinksCompare(makeDeps({
        getDesigns: () => [{ id: 'a', name: 'A', patterns: a }, { id: 'b', name: 'B', patterns: b }],
        getDesign:  () => ({ id: 'a', name: 'A', patterns: a }),
    }).deps);
    api.toggleCompareMode(); api.selectCompareDesign('b'); api.renderCompare();
    const html = els.compareSummary.innerHTML;
    for (const label of ['Hours a week', 'Full weekends off', 'Rest under 12 hours', 'ORR factors present']) {
        assert.ok(html.includes(label),
            `"${label}" is missing from the compare summary. Rendering only the figures that MOVED `
            + 'leaves the reader unable to tell an identical figure from one nobody measured.');
    }
    assert.match(html, /compare-sum-val--same/,
        'no figure is marked unchanged, so either they all moved (they cannot have) or the muted '
        + 'state is not being applied and every figure reads as a difference');
});

test('the compare grid renders no operable control — those cells cannot be pressed', () => {
    // `.links-grid--compare` sets `pointer-events: none` and every cell carried `tabindex="-1"`,
    // so 336 <button> elements were announced to a screen reader and did nothing when reached.
    resetDom();
    const api = initLinksCompare(makeDeps().deps);
    api.toggleCompareMode(); api.selectCompareDesign('b'); api.renderCompare();
    for (const id of ['compareGridBodyRowsA', 'compareGridBodyRowsB']) {
        assert.doesNotMatch(els[id].innerHTML, /<button/,
            `${id} still renders <button> cells. They are inert by CSS, which a screen reader does `
            + 'not read: it announces a control the user cannot operate.');
        assert.match(els[id].innerHTML, /shift-cell-btn/, 'the shift colouring class was dropped with the button');
    }
});
