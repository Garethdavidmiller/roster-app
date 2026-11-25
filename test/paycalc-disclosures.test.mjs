// @ts-check
// @lane hygiene
/**
 * paycalc-disclosures.test.mjs — the Pay page's disclosures (paycalc-disclosures.js).
 * Run: node scripts/run-tests.mjs test/paycalc-disclosures.test.mjs   (part of `npm run test:hygiene`)
 *
 * @nodeps-safe — runs on a bare checkout with nothing installed.
 *
 * One failure matters, and it is silent: a panel open while its button tells a screen reader
 * "collapsed" — which a class flipped on its own once did. So every disclosure is asserted on the
 * panel, the button's `aria-expanded` and its arrow together, on the click AND on a programmatic set.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** A recording fake element: a class set, attributes, text, and the children a selector can find. */
function el(/** @type {Record<string, any>} */ kids = {}) {
    const cls = new Set();
    return {
        textContent: '', attrs: /** @type {Record<string, string>} */ ({}),
        classList: {
            toggle(/** @type {string} */ c, /** @type {boolean} */ on = !cls.has(c)) { if (on) cls.add(c); else cls.delete(c); return on; },
            contains: (/** @type {string} */ c) => cls.has(c),
        },
        setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this.attrs[k] = v; },
        querySelector: (/** @type {string} */ sel) => kids[sel] ?? null,
    };
}

/** @type {Record<string, any>} */ let els;
beforeEach(() => {
    els = {
        hoursShowMore: el({ '.show-more-arrow': el() }), hoursExtra: el(),
        hppToggleBtn: el({ '.hpp-toggle-arrow': el() }), hppNoteBody: el(), hppToggleBtnLabel: el(),
        bdBtn: el(), bdBody: el(),
        disclaimerExtra: el(), disclaimerToggle: el(),
    };
    /** @type {any} */ (globalThis).document = { getElementById: (/** @type {string} */ id) => els[id] ?? null };
});

const { setDisclosure, toggleHoursExtra, toggleHppNote, toggleBD, toggleDisclaimer } = await import('../paycalc-disclosures.js');

describe('a panel and its button never disagree', () => {
    test('Hours "more options": open, then shut — panel, aria-expanded and arrow together', () => {
        toggleHoursExtra();
        assert.equal(els.hoursExtra.classList.contains('open'), true);
        assert.equal(els.hoursShowMore.attrs['aria-expanded'], 'true');
        assert.equal(els.hoursShowMore.querySelector('.show-more-arrow').textContent, '▲');
        toggleHoursExtra();
        assert.equal(els.hoursExtra.classList.contains('open'), false);
        assert.equal(els.hoursShowMore.attrs['aria-expanded'], 'false');
        assert.equal(els.hoursShowMore.querySelector('.show-more-arrow').textContent, '▼');
    });
    test('a programmatic set (loadPeriodData over saved extras) says "expanded" too, and is idempotent', () => {
        setDisclosure('hoursShowMore', 'hoursExtra', true, { arrowSel: '.show-more-arrow' });
        setDisclosure('hoursShowMore', 'hoursExtra', true, { arrowSel: '.show-more-arrow' });
        assert.equal(els.hoursExtra.classList.contains('open'), true);
        assert.equal(els.hoursShowMore.attrs['aria-expanded'], 'true');
    });
    test('the HPP details: the label says what the next press does', () => {
        toggleHppNote();
        assert.equal(els.hppToggleBtnLabel.textContent, 'Hide calculation details ');
        assert.equal(els.hppToggleBtn.attrs['aria-expanded'], 'true');
        toggleHppNote();
        assert.equal(els.hppToggleBtnLabel.textContent, 'How is this calculated? ');
    });
    test('the full breakdown and the disclaimer', () => {
        toggleBD();
        assert.equal(els.bdBody.classList.contains('open'), true);
        assert.equal(els.bdBtn.attrs['aria-expanded'], 'true');
        toggleDisclaimer();
        assert.equal(els.disclaimerExtra.classList.contains('open'), true);
        assert.equal(els.disclaimerToggle.textContent, 'Less ▲');
        assert.equal(els.disclaimerToggle.attrs['aria-expanded'], 'true');
    });
    test('a missing element is a no-op, never a throw', () => {
        els = {};
        assert.doesNotThrow(() => { setDisclosure('x', 'y', true); toggleBD(); toggleHoursExtra(); });
    });
});
