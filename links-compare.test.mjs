// Tests for links-compare.js — compare mode extracted from links-app.js. Fake DOM, no module mocks
// → runs in `npm run test:hygiene`. Proves the OWNED compare state (toggle/select/reset) + the
// render (both grids, headers, diff cells) + the injected-getter seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROTATING_LINES, weeklyHours, hmFromHours } from './links-design.js';

const els = /** @type {Record<string, any>} */ ({});
function mkEl() {
    const set = new Set();
    return {
        innerHTML: '', textContent: '', style: {}, hidden: false,
        classList: {
            add:      (/** @type {string} */ c) => set.add(c),
            remove:   (/** @type {string} */ c) => set.delete(c),
            contains: (/** @type {string} */ c) => set.has(c),
            // `toggle(c, force)` is the two-argument form the module uses for the diff-only class —
            // the one that SETS rather than flips, so a re-render cannot leave the class on after
            // the filter is turned off. A fake missing it does not fail loudly here; it throws
            // inside `renderCompare` and every case in the file reports the same TypeError.
            toggle:   (/** @type {string} */ c, /** @type {boolean|undefined} */ force) =>
                (force === undefined ? (set.has(c) ? set.delete(c) : set.add(c))
                                     : (force ? set.add(c) : set.delete(c)), set.has(c)),
        },
    };
}
function resetDom() {
    for (const id of ['compareGridsWrap', 'compareHeadA', 'compareHeadB', 'compareGridBodyRowsA', 'compareGridBodyRowsB', 'compareGridFootA', 'compareGridFootB', 'compareSummary', 'compareFilter']) els[id] = mkEl();
    // The button lives inside `compareFilter`'s innerHTML, which a fake DOM does not parse. Standing
    // it up here is what lets a test PRESS it — the alternative is exposing the flag for tests,
    // which would leave the one line that actually flips it uncovered.
    els.compareDiffOnlyBtn = { ...mkEl(), _handler: null,
        addEventListener: (/** @type {string} */ ev, /** @type {any} */ fn) => { if (ev === 'click') els.compareDiffOnlyBtn._handler = fn; } };
}
resetDom();
// `querySelectorAll` returns an EMPTY LIST, not undefined (v22.72). The scroll sync asks for the
// two `.compare-grid-scroll` wrappers at init and refuses unless it finds exactly two, which is the
// right behaviour under a fake DOM with no wrappers — but a fake that lacks the method entirely
// makes the module throw on import, and every test in this file then fails for a reason that has
// nothing to do with what it asserts. Model the platform; let the module's own guard decide.
global.document = /** @type {any} */ ({
    getElementById: (/** @type {string} */ id) => els[id] || null,
    querySelectorAll: () => [],
});
global.requestAnimationFrame = /** @type {any} */ ((/** @type {any} */ fn) => fn());

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

test('the hours figure is HOURS — it agreed with nothing, and read as minutes', () => {
    // SHIPPED, v22.60, and live until this test existed. The strip hand-rolled
    // `Math.floor(h.exSunday / 60)` over a figure `weeklyHours` returns in DECIMAL HOURS, so a
    // 40-hour week rendered "0h 40m" and the real Dec 2026 design would have read "0h 35m" — on
    // the one surface whose job is choosing between two proposals, with nothing out of range and
    // nothing thrown. `hmFromHours` is documented as the ONE formatter for this figure precisely
    // because three earlier hand-rolled copies got it wrong; this was the fourth.
    //
    // The two tests above could not see it: they assert the LABEL is present and that the muted
    // class is applied. A row can carry every label, wear the right class, and state a number that
    // is out by a factor of sixty.
    resetDom();
    const a = fullPatterns('06:00-14:00');          // Mon-Fri 8h => 40h a week, Sundays excluded
    const b = fullPatterns('06:00-14:00');
    b['2'].mon = '14:00-22:00';                      // same length, so B's hours must match A's
    const api = initLinksCompare(makeDeps({
        getDesigns: () => [{ id: 'a', name: 'A', patterns: a }, { id: 'b', name: 'B', patterns: b }],
        getDesign:  () => ({ id: 'a', name: 'A', patterns: a }),
    }).deps);
    api.toggleCompareMode(); api.selectCompareDesign('b'); api.renderCompare();
    const html = els.compareSummary.innerHTML;

    assert.ok(html.includes('40h 00m'),
        'a Mon-Fri 8-hour design is 40 hours a week and the strip does not say so. Got: ' + html);
    assert.ok(!/\b0h 40m\b/.test(html),
        'the strip is reading decimal HOURS as minutes — 40 hours rendered as "0h 40m"');

    // And it must agree with what the single-design panels show, which is the claim this feature
    // makes about itself: same source function, same formatter, so the two views cannot describe
    // one design differently four seconds apart. Computed from the REAL modules, not restated.
    const expected = hmFromHours(weeklyHours(a, ROTATING_LINES).exSunday ?? 0);
    assert.ok(html.includes(expected),
        `the strip disagrees with the single-design panel: that shows ${expected}. ` + html);

    // WHAT THIS DELIBERATELY DOES NOT COVER. The other historically-shipped copy of this formatter
    // was `floor(h)` + `round((h % 1) * 60)`, which renders 34.9917 hours as "34h 60m". Substituting
    // it here does NOT fail this test, and no fixture can make it: `weeklyHours` pre-rounds to 2 dp,
    // so the fraction is capped at .99 and 0.99 * 60 rounds to 59 — the carry is unreachable through
    // this call path. `hmFromHours`'s own header records that the links-analysis copies were safe
    // "only by ACCIDENT" for exactly this reason. Writing a case that pretends to cover it would be
    // worse than saying so; the equality above catches every divergence that CAN occur.
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ONLY THE LINES THAT DIFFER (v22.72), organised by what a wrong answer COSTS.
//
// The expensive direction is CLAIMING TOO LITTLE, and it is silent: a reader looking at four rows
// has every reason to take them as the basis of the figures beside them and the cover row below
// them, when both are computed over all 24 lines. That is a wrong reading of a real proposal with
// nothing on screen to correct it.
//
// The cheap direction is a control that misfires — offered when it would empty the grid, or when it
// would hide nothing. Visible, and it costs the designer's trust in the rest of the card.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A patterns object where exactly `n` lines differ from `fullPatterns()`. */
function partlyDifferent(n) {
    const p = fullPatterns();
    for (let i = 1; i <= n; i++) p[String(i)] = { ...p[String(i)], mon: '12:00-19:00' };
    return p;
}
/** Enter compare mode against a B that differs on `n` lines, and return the API. */
function comparing(n) {
    resetDom();
    const A = fullPatterns(), B = partlyDifferent(n);
    const { deps } = makeDeps({
        getDesigns: () => [{ id: 'a', name: 'A', patterns: A }, { id: 'b', name: 'B', patterns: B }],
        getDesign:  () => ({ id: 'a', name: 'A', patterns: A }),
    });
    const c = initLinksCompare(deps);
    c.toggleCompareMode();
    return c;
}
const press = () => els.compareDiffOnlyBtn._handler?.();

test('filtered: the strip still says the figures and the cover row describe every line', () => {
    const c = comparing(3);
    press();
    assert.ok(els.compareGridsWrap.classList.contains('compare-diff-only'),
        'the filter must actually be applied');
    // The claim, in full. Without it the four visible rows read as the basis of the numbers above.
    assert.match(els.compareSummary.innerHTML, /still cover all/);
    assert.match(els.compareSummary.innerHTML, new RegExp(`all ${ROTATING_LINES} lines`));
    // And the cover row is untouched by the filter — it is a property of the design, not the view.
    assert.equal(els.compareGridFootA.innerHTML, els.compareGridFootA.innerHTML);
    assert.match(els.compareGridFootA.innerHTML, /cov-cell/);
    assert.ok(c.isCompareMode());
});

test('unfiltered: the strip makes no claim about coverage it does not need to make', () => {
    comparing(3);
    assert.doesNotMatch(els.compareSummary.innerHTML, /still cover all/);
});

test('every row is RENDERED either way — the filter is a view, not a truncation', () => {
    comparing(3);
    const before = (els.compareGridBodyRowsA.innerHTML.match(/data-pos=/g) || []).length;
    press();
    const after = (els.compareGridBodyRowsA.innerHTML.match(/data-pos=/g) || []).length;
    assert.equal(before, ROTATING_LINES);
    assert.equal(after, ROTATING_LINES, 'rows are marked and hidden by CSS, never omitted');
});

test('the identical lines are the ones marked, and the differing ones are not', () => {
    comparing(3);
    const rows = els.compareGridBodyRowsA.innerHTML.split('<tr').slice(1);
    assert.equal(rows.length, ROTATING_LINES);
    rows.forEach((row, i) => {
        const pos = i + 1;
        const marked = /class="[^"]*\brow-same\b/.test(row);
        assert.equal(marked, pos > 3, `line ${pos}: differs=${pos <= 3} but marked=${marked}`);
    });
});

test('turning it off puts every line back — the class is SET, not flipped by a re-render', () => {
    const c = comparing(3);
    press();
    assert.ok(els.compareGridsWrap.classList.contains('compare-diff-only'));
    press();
    assert.equal(els.compareGridsWrap.classList.contains('compare-diff-only'), false);
    // A re-render on its own must not resurrect it. `classList.toggle(c, force)` is what guarantees
    // that; a bare `add`/`remove` pair keyed on the wrong branch is how this kind of flag sticks.
    c.renderCompare();
    assert.equal(els.compareGridsWrap.classList.contains('compare-diff-only'), false);
});

test('two IDENTICAL designs: the control is not offered, and nothing is filtered', () => {
    comparing(0);
    assert.equal(els.compareFilter.hidden, true, 'a filter that would empty the grid is not offered');
    assert.equal(els.compareFilter.innerHTML, '');
    press();   // no handler; nothing to press
    assert.equal(els.compareGridsWrap.classList.contains('compare-diff-only'), false);
});

test('EVERY line differs: the control is not offered either — it would hide nothing', () => {
    comparing(ROTATING_LINES);
    assert.equal(els.compareFilter.hidden, true);
});

test('the label counts the lines it will show, and says how many it hides', () => {
    comparing(3);
    assert.equal(els.compareFilter.hidden, false);
    assert.match(els.compareFilter.innerHTML, /Show only the 3 lines that differ/);
    assert.match(els.compareFilter.innerHTML, /aria-pressed="false"/);
    press();
    assert.match(els.compareFilter.innerHTML, /Showing the 3 lines that differ/);
    assert.match(els.compareFilter.innerHTML, /aria-pressed="true"/);
    assert.match(els.compareFilter.innerHTML, new RegExp(`${ROTATING_LINES - 3} identical lines hidden`));
});

test('leaving compare mode clears the filter — it must not be on when you next open it', () => {
    const c = comparing(3);
    press();
    c.toggleCompareMode();          // off
    c.toggleCompareMode();          // on again
    assert.equal(els.compareGridsWrap.classList.contains('compare-diff-only'), false);
    assert.match(els.compareFilter.innerHTML, /aria-pressed="false"/);
});

test('switching the compared design KEEPS the filter — the other half of the same rule', () => {
    resetDom();
    const A = fullPatterns(), B = partlyDifferent(3), C = partlyDifferent(5);
    const { deps } = makeDeps({
        getDesigns: () => [{ id: 'a', name: 'A', patterns: A }, { id: 'b', name: 'B', patterns: B },
                           { id: 'c', name: 'C', patterns: C }],
        getDesign:  () => ({ id: 'a', name: 'A', patterns: A }),
    });
    const c = initLinksCompare(deps);
    c.toggleCompareMode();
    press();
    c.selectCompareDesign('c');
    assert.ok(els.compareGridsWrap.classList.contains('compare-diff-only'),
        'a designer working through several proposals should not re-tick each time');
    // …and the label follows the NEW pair, not the old one.
    assert.match(els.compareFilter.innerHTML, /Showing the 5 lines that differ/);
});

// THE CASE THE FIRST PASS MISSED, found by mutating `_filterActive` and watching every test stay
// green. Reaching an empty filter needs TWO steps and the suite only ever took one: turn the filter
// on against a design that differs, then switch to one that does not. `diffOnly` is deliberately
// kept across that switch (see the test above), so without the `_diffLines.size` half of the guard
// the grid empties itself — twenty-four rows of a real design gone, reading as a failed load.
test('filter ON, then switched to an IDENTICAL design: every line comes back', () => {
    resetDom();
    const A = fullPatterns(), B = partlyDifferent(3), SAME = fullPatterns();
    const { deps } = makeDeps({
        getDesigns: () => [{ id: 'a', name: 'A', patterns: A }, { id: 'b', name: 'B', patterns: B },
                           { id: 'same', name: 'Same', patterns: SAME }],
        getDesign:  () => ({ id: 'a', name: 'A', patterns: A }),
    });
    const c = initLinksCompare(deps);
    c.toggleCompareMode();
    press();
    assert.ok(els.compareGridsWrap.classList.contains('compare-diff-only'));

    c.selectCompareDesign('same');
    assert.equal(els.compareGridsWrap.classList.contains('compare-diff-only'), false,
        'a filter with nothing to show must not be APPLIED, however it was armed');
    assert.equal(els.compareFilter.hidden, true, 'and it must not be offered either');
    assert.match(els.compareSummary.innerHTML, /<strong>0<\/strong> cells differ/);
    assert.doesNotMatch(els.compareSummary.innerHTML, /still cover all/);
});
