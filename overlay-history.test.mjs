/**
 * Unit tests for the overlay.js Android-Back history STACK (_pushOverlayState /
 * _clearOverlayHistory + the popstate listener).
 * Run with: node --test overlay-history.test.mjs
 *
 * The existing overlay.test.mjs stubs window.addEventListener as a no-op, so it can't
 * dispatch popstate. This suite installs a capturing harness (records the popstate
 * handler + counts history.pushState/back) BEFORE importing overlay.js, and re-imports
 * a FRESH module instance per test (query-string cache-bust) so the module-level stack
 * state never leaks between tests.
 *
 * Model:
 *   - history.pushState()  → pushCount++
 *   - history.back()       → backCount++, then fires the captured popstate handler
 *                            (the "echo" the real browser sends after a programmatic back)
 *   - pressBack()          → fires the popstate handler WITHOUT a history.back() call —
 *                            models a hardware/Android Back press (the browser popped the
 *                            entry itself; our code must not double-pop).
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let popstateHandler = /** @type {null | (() => void)} */ (null);
let pushCount = 0;
let backCount = 0;

global.window = /** @type {any} */ ({
    addEventListener: (/** @type {string} */ type, /** @type {any} */ fn) => {
        if (type === 'popstate') popstateHandler = fn;
    },
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false }),
});
global.history = /** @type {any} */ ({
    pushState: () => { pushCount++; },
    back:      () => { backCount++; popstateHandler?.(); },
});
global.document = /** @type {any} */ ({
    body: { classList: { add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} } },
    addEventListener: () => {}, removeEventListener: () => {},
});

/** Fire a hardware/Android Back press: the browser already popped the entry. */
function pressBack() { popstateHandler?.(); }

let _seq = 0;
/** Load a fresh overlay.js instance (fresh module-level stack + popstate registration). */
async function freshOverlay() {
    pushCount = 0; backCount = 0; popstateHandler = null;
    return import('./overlay.js?history-test=' + (_seq++));
}

describe('overlay history stack — _pushOverlayState / _clearOverlayHistory / popstate', () => {
    test('single overlay: hardware Back invokes its handler, no history.back()', async () => {
        const { _pushOverlayState } = await freshOverlay();
        const calls = [];
        _pushOverlayState(() => calls.push('A'));
        assert.equal(pushCount, 1, 'one entry pushed');
        pressBack();
        assert.deepEqual(calls, ['A']);
        assert.equal(backCount, 0, 'hardware Back must not call history.back()');
    });

    test('single overlay: button close pops the entry and absorbs the echo (handler not re-invoked)', async () => {
        const { _pushOverlayState, _clearOverlayHistory } = await freshOverlay();
        const calls = [];
        _pushOverlayState(() => calls.push('A'));
        _clearOverlayHistory();
        assert.equal(backCount, 1, 'button close issues one history.back()');
        assert.deepEqual(calls, [], 'the echoed popstate must be absorbed, not run the handler');
        // Stack is now empty — a later Back is a no-op.
        pressBack();
        assert.deepEqual(calls, []);
    });

    test('nested overlays: Back closes ONLY the topmost; the next Back closes the lower one', async () => {
        const { _pushOverlayState } = await freshOverlay();
        const calls = [];
        _pushOverlayState(() => calls.push('A'));   // lower (e.g. Team View)
        _pushOverlayState(() => calls.push('B'));   // upper (e.g. a lightbox)
        assert.equal(pushCount, 2, 'each overlay pushes its own entry');
        pressBack();
        assert.deepEqual(calls, ['B'], 'first Back closes only the top overlay');
        pressBack();
        assert.deepEqual(calls, ['B', 'A'], 'second Back closes the lower overlay');
    });

    test('REGRESSION: a top handler that itself calls _clearOverlayHistory does NOT cascade-close the lower overlay', async () => {
        // This is the team-view toggle / lightbox-dismiss pattern: the close handler
        // calls _clearOverlayHistory(). On the Back path that call must be a no-op.
        const { _pushOverlayState, _clearOverlayHistory } = await freshOverlay();
        const calls = [];
        _pushOverlayState(() => calls.push('A'));                        // lower
        _pushOverlayState(() => { calls.push('B'); _clearOverlayHistory(); }); // upper, clears on close
        pressBack();
        assert.deepEqual(calls, ['B'], 'A must survive — no cascade');
        assert.equal(backCount, 0, 'the handler-internal _clearOverlayHistory must not issue a stray history.back()');
        pressBack();
        assert.deepEqual(calls, ['B', 'A'], 'the lower overlay closes on the next Back');
    });

    test('button-close of the top while a lower overlay exists: lower survives, then closes via Back', async () => {
        // e.g. About lightbox ✕ over Team View.
        const { _pushOverlayState, _clearOverlayHistory } = await freshOverlay();
        const calls = [];
        _pushOverlayState(() => calls.push('A'));   // Team View (lower)
        _pushOverlayState(() => calls.push('B'));   // About (upper)
        _clearOverlayHistory();                     // About ✕ (button close of the top)
        assert.equal(backCount, 1);
        assert.deepEqual(calls, [], 'button close does not invoke handlers');
        pressBack();
        assert.deepEqual(calls, ['A'], 'the lower overlay is still registered and Back closes it');
    });

    test('dedupe: re-registering the SAME handler does not stack a duplicate entry', async () => {
        const { _pushOverlayState } = await freshOverlay();
        const h = () => {};
        _pushOverlayState(h);
        _pushOverlayState(h);
        assert.equal(pushCount, 1, 'a repeated open() for the same overlay pushes one entry, not two');
    });

    test('button close then a fresh overlay + Back stays balanced (no leaked suppression)', async () => {
        const { _pushOverlayState, _clearOverlayHistory } = await freshOverlay();
        const calls = [];
        _pushOverlayState(() => calls.push('A'));
        _clearOverlayHistory();                     // absorbs exactly one echo
        _pushOverlayState(() => calls.push('B'));
        pressBack();                                // must run B (suppression already consumed)
        assert.deepEqual(calls, ['B']);
    });

    test('REGRESSION: double button-close of the TOP overlay does NOT pop the overlay beneath it', async () => {
        // e.g. About lightbox (top) over Team View (lower); user double-taps About's ✕ during
        // the 500ms fade. The SECOND _clearOverlayHistory(closeAbout) must find closeAbout already
        // gone and no-op — it must NOT pop closeTV.
        const { _pushOverlayState, _clearOverlayHistory } = await freshOverlay();
        const calls = [];
        const closeTV    = () => calls.push('TV');
        const closeAbout = () => calls.push('About');
        _pushOverlayState(closeTV);
        _pushOverlayState(closeAbout);
        _clearOverlayHistory(closeAbout);   // first ✕ tap
        assert.equal(backCount, 1, 'one history.back() for the real close');
        _clearOverlayHistory(closeAbout);   // second ✕ tap during fade — handler already gone
        assert.equal(backCount, 1, 'the double-tap must NOT issue a second history.back()');
        // Team View survived: a real Back now closes it (and only it).
        pressBack();
        assert.deepEqual(calls, ['TV']);
    });

    test('specific-handler close removes the RIGHT entry when a non-topmost overlay is dismissed', async () => {
        const { _pushOverlayState, _clearOverlayHistory } = await freshOverlay();
        const calls = [];
        const closeA = () => calls.push('A');   // lower
        const closeB = () => calls.push('B');   // upper
        _pushOverlayState(closeA);
        _pushOverlayState(closeB);
        _clearOverlayHistory(closeA);           // dismiss the LOWER one by identity
        assert.equal(backCount, 1);
        // Only closeB remains registered; a Back closes B (not A again).
        pressBack();
        assert.deepEqual(calls, ['B']);
    });
});
