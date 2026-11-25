// @ts-check
// @lane hygiene
/**
 * links-build-button.test.mjs — the figure the Build press reads from a line-order number box
 * (`boxFigure`, links-build-button.js rule 4). Run: node scripts/run-tests.mjs
 * test/links-build-button.test.mjs   (part of `npm run test:hygiene`)
 *
 * The press itself — the question, the held button, the scroll anchor, the box written back — is
 * driven end to end in e2e/links.spec.js ("Long weekends — at least 0" is a real answer). What is
 * pinned here is the reading: `parseInt(…) || 4` once read a typed 0 as the default 4.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// overlay.js (imported for the press's question) listens on `window` as it loads.
/** @type {any} */ (globalThis).window ??= { addEventListener: () => {} };
const { boxFigure, STILL_LOADING } = await import('../links-build-button.js');

describe('a box\'s own figure, never a falsy one swapped for the default (rule 4)', () => {
    test('0 is a real answer', () => {
        assert.equal(boxFigure('0', 4), 0);
    });

    test('only a box holding no number falls back to the default', () => {
        for (const empty of ['', '  ', 'abc', '—']) assert.equal(boxFigure(empty, 4), 4, JSON.stringify(empty));
    });

    test('a figure under the minimum is raised to it, and a figure over it is kept', () => {
        assert.equal(boxFigure('0', 6, 1), 1);
        assert.equal(boxFigure('-3', 6, 1), 1);
        assert.equal(boxFigure('9', 6, 1), 9);
    });

    test('a box is read as a whole number (parseInt), its leading figure only', () => {
        assert.equal(boxFigure('3.9', 4), 3);
        assert.equal(boxFigure('5 lines', 4), 5);
    });
});

test('the loading answer says to wait, and what for', () => {
    assert.match(STILL_LOADING, /still loading/);
    assert.match(STILL_LOADING, /build the link once they are in/);
});
