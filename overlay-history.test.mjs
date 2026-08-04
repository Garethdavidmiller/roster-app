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
    body: {
        // Set-backed so `openNoticeIfClear` can ask whether an overlay is already up.
        classList: (() => { const set = new Set(); return {
            add: (/** @type {string} */ c) => set.add(c),
            remove: (/** @type {string} */ c) => set.delete(c),
            contains: (/** @type {string} */ c) => set.has(c),
        }; })(),
        style: { setProperty() {}, removeProperty() {} },
    },
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

// ─────────────────────────────────────────────────────────────────────────────
// Only the TOPMOST overlay reacts to Escape (v19.53).
//
// Every open overlay attaches its own document-level keydown listener, so one Escape fired all of
// them. Back was already right (one history entry consumed per press) and so was the ✕ (it belongs
// to one overlay) — Escape was the outlier, and the dangerous one: two one-time NOTICES open meant
// one keypress ran both onClose callbacks, archiving and permanently flagging the notice buried
// underneath for someone who never saw it. Proven in a browser before this was written.
// ─────────────────────────────────────────────────────────────────────────────
describe('_isTopOverlay — which overlay owns the keyboard', () => {
    test('with one overlay open, it is the top', async () => {
        const { _pushOverlayState, _isTopOverlay } = await freshOverlay();
        const a = () => {};
        _pushOverlayState(a);
        assert.equal(_isTopOverlay(a), true);
    });

    test('with two open, only the LAST pushed is the top', async () => {
        const { _pushOverlayState, _isTopOverlay } = await freshOverlay();
        const lower = () => {}, upper = () => {};
        _pushOverlayState(lower);
        _pushOverlayState(upper);
        assert.equal(_isTopOverlay(upper), true, 'the one the user can see');
        assert.equal(_isTopOverlay(lower), false, 'the buried one must ignore the key');
    });

    test('closing the top hands the keyboard back to the one underneath', async () => {
        const { _pushOverlayState, _clearOverlayHistory, _isTopOverlay } = await freshOverlay();
        const lower = () => {}, upper = () => {};
        _pushOverlayState(lower);
        _pushOverlayState(upper);
        _clearOverlayHistory(upper);
        assert.equal(_isTopOverlay(lower), true);
    });

    test('FAILS OPEN: a handler that is not on the stack counts as top', async () => {
        // A suppressed Escape is a user trapped in a dialog they cannot close — strictly worse than
        // an extra close. If we cannot prove an overlay is underneath another, it gets the key.
        const { _pushOverlayState, _isTopOverlay } = await freshOverlay();
        assert.equal(_isTopOverlay(() => {}), true, 'empty stack');
        _pushOverlayState(() => {});
        assert.equal(_isTopOverlay(() => {}), true, 'unregistered handler, non-empty stack');
    });
});

describe('openNoticeIfClear — a one-time notice never opens stacked', () => {
    test('opens when nothing else is up', async () => {
        const { openNoticeIfClear } = await freshOverlay();
        let opened = 0;
        assert.equal(openNoticeIfClear({ open: () => { opened++; } }), true);
        assert.equal(opened, 1);
    });

    test('defers — and does NOT open — when another overlay is already up', async () => {
        const { openNoticeIfClear } = await freshOverlay();
        document.body.classList.add('lb-open');
        let opened = 0;
        assert.equal(openNoticeIfClear({ open: () => { opened++; } }), false);
        assert.equal(opened, 0, 'not opening is the whole point: onClose cannot run, so the ' +
            'notice is never flagged seen and returns on the next load');
        document.body.classList.remove('lb-open');
    });
});
