// @ts-check
// text-scale.test.mjs — the compact-row decision, organised by what a wrong answer costs.
// COMPACTING TOO EARLY changes the row on phones that were never short of space (Large text at
// 412px fits with room); COMPACTING TOO LATE leaves exactly the phones this exists for on two rows.
// The probe itself is measured in a browser by e2e/calendar.spec.js; here the decision is pinned,
// and the probe's fallbacks — the cases where it cannot measure and must never say "compact".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { COMPACT_FROM, LARGE_FROM, isCompact, tierFor, measureTextScale, applyTextScale } from './text-scale.js';

describe('compacting too early — the default look on phones that fit', () => {
    test('the default size is not compact', () => assert.equal(isCompact(1), false));
    test('"Large" (1.15×) is not compact — it still fits at 412px', () => assert.equal(isCompact(1.15), false));
    test('the threshold itself is where compact begins', () => assert.equal(isCompact(COMPACT_FROM), true));
});

describe('the heading row tightens a step earlier — 360px stops fitting at "Large"', () => {
    test('below 1.1× no tier', () => assert.equal(tierFor(1.05), null));
    test('"Large" (1.15×) is the large tier, not compact', () => assert.equal(tierFor(1.15), 'large'));
    test('the large threshold itself', () => assert.equal(tierFor(LARGE_FROM), 'large'));
    test('"Largest" (1.3×) is compact', () => assert.equal(tierFor(1.3), 'compact'));
    test('a probe that cannot measure has no tier', () => { for (const v of [NaN, Infinity]) assert.equal(tierFor(v), null); });
    test('applyTextScale stamps the large tier at 1.15×', () => {
        const doc = fakeDoc(16 * 1.15); applyTextScale(doc);
        assert.equal(doc.documentElement.attrs['data-text-scale'], 'large');
    });
});

describe('compacting too late — the phones this exists for', () => {
    test('"Largest" (1.3×) is compact — at 412px it needs 390px of 386', () => assert.equal(isCompact(1.3), true));
    test('1.5× is compact', () => assert.equal(isCompact(1.5), true));
});

describe('a probe that cannot measure never says compact', () => {
    test('NaN, Infinity and 0 are not compact', () => {
        for (const v of [NaN, Infinity, 0, -1]) assert.equal(isCompact(v), false, String(v));
    });
    test('no document → scale 1', () => assert.equal(measureTextScale(/** @type {any} */ (undefined)), 1));
    test('a document with no body → scale 1', () => assert.equal(measureTextScale(/** @type {any} */ ({})), 1));
    test('a probe that renders a zero box → scale 1', () => {
        const doc = fakeDoc(0);
        assert.equal(measureTextScale(doc), 1);
    });
});

// ── THE PROBE MUST NOT BE ABLE TO BLANK THE CALENDAR (v22.99, bug check) ────────────────────────
//
// `calendar-app.js` calls `applyTextScale(document)` at MODULE SCOPE, with no try above it. That
// makes this the one instrument in the app whose failure is not a missing measurement but a missing
// PAGE: an exception aborts the coordinator's evaluation and the grid renders nothing at all.
// Measured, not reasoned about — with a throw injected into the probe, a real browser drew ZERO
// `.calendar-day` cells.
//
// So the cost here is wildly asymmetric. Swallowing a probe failure loses a layout tier that most
// phones never needed; NOT swallowing it loses the roster. These cases pin the swallow, in the four
// shapes a hostile or exotic document can take.
describe('a failing probe costs the tier, never the page', () => {
    const throwingDoc = (/** @type {string} */ where) => ({
        body: {},
        documentElement: { setAttribute() {}, removeAttribute() {} },
        createElement() {
            if (where === 'createElement') throw new Error('no elements here');
            return {
                style: {}, setAttribute() {}, remove() {},
                set textContent(_v) { if (where === 'textContent') throw new Error('detached'); },
                getBoundingClientRect() {
                    if (where === 'rect') throw new Error('no layout');
                    return { height: 16 };
                },
            };
        },
    });

    for (const where of ['createElement', 'textContent', 'rect']) {
        test(`a throw from ${where} reports an unscaled 1, not an exception`, () => {
            const doc = throwingDoc(where);
            assert.equal(measureTextScale(/** @type {any} */ (doc)), 1);
            assert.doesNotThrow(() => applyTextScale(/** @type {any} */ (doc)));
        });
    }

    test('appendChild throwing is survived too — the probe never reaches the DOM', () => {
        const doc = /** @type {any} */ (throwingDoc('none'));
        doc.body.appendChild = () => { throw new Error('body is not accepting children'); };
        assert.equal(measureTextScale(doc), 1);
    });

    test('a documentElement that refuses the stamp still returns the reading', () => {
        const doc = /** @type {any} */ (throwingDoc('none'));
        doc.body.appendChild = () => {};
        doc.documentElement = { setAttribute() { throw new Error('frozen'); }, removeAttribute() {} };
        // 1.0 stamps nothing, so force a tier: the throw must come from the stamp, not the tier test.
        doc.createElement = () => ({ style: {}, setAttribute() {}, remove() {}, textContent: '',
            getBoundingClientRect: () => ({ height: 16 * 1.3 }) });
        assert.doesNotThrow(() => applyTextScale(doc));
    });
});

describe('the measurement and the stamp', () => {
    test('a 16px probe rendered 20.8px tall is 1.3×, and the root is stamped compact', () => {
        const doc = fakeDoc(20.8);
        assert.equal(Math.round(measureTextScale(doc) * 100) / 100, 1.3);
        assert.equal(applyTextScale(doc), 1.3);
        assert.equal(doc.documentElement.attrs['data-text-scale'], 'compact');
    });
    test('a 16px probe rendered 16px tall is 1×, and any stale stamp is removed', () => {
        const doc = fakeDoc(16);
        doc.documentElement.attrs['data-text-scale'] = 'compact';
        applyTextScale(doc);
        assert.equal('data-text-scale' in doc.documentElement.attrs, false);
    });
    test('the probe is removed after measuring — nothing is left in the body', () => {
        const doc = fakeDoc(16);
        measureTextScale(doc);
        assert.equal(doc.body.children.length, 0);
    });
    test('the e2e seam wins when present, and is ignored when absent or invalid', () => {
        const g = /** @type {any} */ (globalThis);
        g.__E2E = { textScale: 1.4 };
        assert.equal(measureTextScale(fakeDoc(16)), 1.4);
        g.__E2E = { textScale: 'big' };
        assert.equal(measureTextScale(fakeDoc(16)), 1);
        delete g.__E2E;
        assert.equal(measureTextScale(fakeDoc(16)), 1);
    });
});

/** The two-line fake DOM this needs: a body that holds a probe, and a probe with a rendered height. */
function fakeDoc(/** @type {number} */ probeHeight) {
    const body = { children: /** @type {any[]} */ ([]), appendChild(/** @type {any} */ el) { this.children.push(el); el.parent = this; } };
    const documentElement = { attrs: /** @type {Record<string,string>} */ ({}),
        setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attrs[k] = v; },
        removeAttribute(/** @type {string} */ k) { delete this.attrs[k]; } };
    return /** @type {any} */ ({
        body, documentElement,
        createElement() {
            return { textContent: '', style: { cssText: '' }, parent: /** @type {any} */ (null),
                setAttribute() {}, getBoundingClientRect() { return { height: probeHeight }; },
                remove() { const i = body.children.indexOf(this); if (i >= 0) body.children.splice(i, 1); } };
        },
    });
}
