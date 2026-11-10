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

import { test, describe, beforeEach, afterEach } from 'node:test';
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


// ── WHEN HAS A BUTTON-CLOSE LANDED? (v23.61) ────────────────────────────────────────────────────
//
// `_clearOverlayHistory` calls `history.back()`; the browser answers with a popstate LATER. A
// dialog opened in between pushes an entry the traversal then pops — it closes itself. Every sheet
// action used to wait out a fixed 320ms for that reason; `whenHistorySettled` and `close()`'s promise
// replace the timer with the two events themselves. The harness above fires the echo SYNCHRONOUSLY
// inside history.back(), which is exactly the case that hides this — so these tests swap in a
// `back()` that does NOT echo, and fire the echo by hand when the test says so.
describe('whenHistorySettled — the popstate echo, not a timer', () => {
    /** history.back() that records the call and leaves the echo to the test. */
    const silentBack = () => { global.history.back = () => { backCount++; }; };

    test('nothing outstanding → runs synchronously (a hardware-Back close has no echo to wait for)', async () => {
        const { whenHistorySettled } = await freshOverlay();
        let ran = 0;
        whenHistorySettled(() => { ran++; });
        assert.equal(ran, 1);
    });

    test('an outstanding echo → waits for it, then runs exactly once', async () => {
        const { _pushOverlayState, _clearOverlayHistory, whenHistorySettled } = await freshOverlay();
        silentBack();
        _pushOverlayState(() => {});
        _clearOverlayHistory();                 // history.back() issued, echo NOT yet arrived
        let ran = 0;
        whenHistorySettled(() => { ran++; });
        assert.equal(ran, 0, 'the echo is outstanding — a dialog opened now would be popped');
        pressBack();                            // the echo lands
        assert.equal(ran, 1, 'and the waiter runs on it');
        pressBack();                            // a later, unrelated pop
        assert.equal(ran, 1, 'once');
    });

    test('a browser that never sends the echo → the 500ms fallback runs it, and the late echo does not run it again', async () => {
        const { mock } = await import('node:test');
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            const { _pushOverlayState, _clearOverlayHistory, whenHistorySettled } = await freshOverlay();
            silentBack();
            _pushOverlayState(() => {});
            _clearOverlayHistory();
            let ran = 0;
            whenHistorySettled(() => { ran++; });
            mock.timers.tick(499);
            assert.equal(ran, 0);
            mock.timers.tick(1);
            assert.equal(ran, 1, 'the fallback covers a missing echo, as dismissOverlay covers a missing transitionend');
            pressBack();
            assert.equal(ran, 1, 'the late echo is absorbed without a second run');
        } finally { mock.timers.reset(); }
    });
});

describe('createLightbox — close() resolves when the close has LANDED, both halves', () => {
    // A minimal overlay element: classes, a transitionend listener the test can fire, nothing else.
    function fakeOverlay() {
        const classes = new Set();
        /** @type {Record<string, Function[]>} */ const listeners = {};
        return {
            classList: { add: (/** @type {string} */ c) => classes.add(c), remove: (/** @type {string} */ c) => classes.delete(c), contains: (/** @type {string} */ c) => classes.has(c) },
            addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (listeners[t] ??= []).push(fn); },
            removeEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { listeners[t] = (listeners[t] ?? []).filter(f => f !== fn); },
            fade: () => (listeners.transitionend ?? []).slice().forEach(fn => fn({})),
        };
    }
    const microtasks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    const silentBack = () => { global.history.back = () => { backCount++; }; };

    async function openOne() {
        const { createLightbox } = await freshOverlay();
        silentBack();
        /** @type {any} */ (global.window).scrollY = 0;
        /** @type {any} */ (global.window).scrollTo = () => {};
        /** @type {any} */ (global).requestAnimationFrame = (/** @type {Function} */ fn) => fn();
        /** @type {any} */ (global.document).activeElement = null;
        const overlay = fakeOverlay();
        let landed = 0;
        const lb = createLightbox({ overlay: /** @type {any} */ (overlay), content: null, closeBtn: null, afterClose: () => { landed++; } });
        lb.open();
        return { lb, overlay, landedCount: () => landed };
    }

    test('fade first, echo second → resolves on the echo', async () => {
        const { lb, overlay, landedCount } = await openOne();
        let resolved = false;
        const p = lb.close().then(() => { resolved = true; });
        overlay.fade();  await microtasks();
        assert.equal(resolved, false, 'the fade alone is not a landing — the echo is still outstanding');
        assert.equal(landedCount(), 0);
        pressBack();     await microtasks();
        assert.equal(resolved, true);
        assert.equal(landedCount(), 1, 'afterClose fires at the same moment');
        await p;
    });

    test('echo first, fade second → resolves on the fade', async () => {
        const { lb, overlay, landedCount } = await openOne();
        let resolved = false;
        lb.close().then(() => { resolved = true; });
        pressBack();     await microtasks();
        assert.equal(resolved, false, 'the echo alone is not a landing — the panel is still fading');
        overlay.fade();  await microtasks();
        assert.equal(resolved, true);
        assert.equal(landedCount(), 1);
    });

    test('a second close() during the fade hands back the SAME landing, not a fresh resolved one', async () => {
        const { lb, overlay } = await openOne();
        const first = lb.close();
        let secondResolved = false;
        lb.close().then(() => { secondResolved = true; });
        await microtasks();
        assert.equal(secondResolved, false, 'a double-tap must not report the close as landed early');
        overlay.fade(); pressBack(); await microtasks();
        assert.equal(secondResolved, true);
        await first;
    });

    test('close() on an overlay that is not open resolves at once and lands nothing', async () => {
        const { lb, overlay, landedCount } = await openOne();
        lb.close(); overlay.fade(); pressBack(); await microtasks();
        assert.equal(landedCount(), 1);
        let resolved = false;
        lb.close().then(() => { resolved = true; });
        await microtasks();
        assert.equal(resolved, true);
        assert.equal(landedCount(), 1, 'no second landing for a close that closed nothing');
    });
});

// ── WHAT A DIALOG RESOLVES TO (whole-app fix, 10 Nov 2026) ──────────────────────────────────────────
// The REAL confirmDialog, built into a small fake DOM and closed every way a member can close it.
// A DISMISSAL — the backdrop, Escape, Android Back — resolved false, the same as Cancel, and the
// unsaved-work offer's Cancel is Discard: a tap meant for the page landed on the backdrop and deleted
// the kept work (shared-ui-2). And the card stays tappable through its close fade, so a second tap
// re-ran its button: Confirm twice ran `onConfirm` twice, Cancel then Confirm resolved true (shared-ui-7).
describe('confirmDialog — a dismissal, a button, and a second tap during the fade', () => {
    /** @type {Function[]} */ let keydown = [];
    const realAdd = global.document.addEventListener, realRemove = global.document.removeEventListener;
    /** An element with classes, attributes, children and listeners the test can fire. @param {string} tag */
    function el(tag) {
        const cls = new Set(), attrs = /** @type {Record<string, string>} */ ({}), listeners = /** @type {Record<string, Function[]>} */ ({});
        const e = /** @type {any} */ ({
            tagName: tag.toUpperCase(), children: /** @type {any[]} */ ([]),
            set className(/** @type {string} */ v) { cls.clear(); v.split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
            get className() { return [...cls].join(' '); },
            classList: { add: (/** @type {string[]} */ ...c) => c.forEach(x => cls.add(x)), remove: (/** @type {string[]} */ ...c) => c.forEach(x => cls.delete(x)),
                contains: (/** @type {string} */ c) => cls.has(c), toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => (on ? cls.add(c) : cls.delete(c)) },
            setAttribute: (/** @type {string} */ k, /** @type {any} */ v) => { attrs[k] = String(v); },
            getAttribute: (/** @type {string} */ k) => attrs[k] ?? null, hasAttribute: (/** @type {string} */ k) => k in attrs,
            appendChild: (/** @type {any} */ c) => { e.children.push(c); return c; }, remove() {},
            focus() { /** @type {any} */ (global.document).activeElement = e; },
            addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (listeners[t] ??= []).push(fn); },
            removeEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { listeners[t] = (listeners[t] ?? []).filter(f => f !== fn); },
            fire: (/** @type {string} */ t) => (listeners[t] ?? []).slice().forEach(fn => fn({ target: e, preventDefault() {} })),
        });
        return e;
    }
    /** The dialog's button with this class. @param {any} root @param {string} cls @returns {any} */
    const find = (root, cls) => {
        for (const c of root.children) { if (c.classList.contains(cls)) return c; const d = find(c, cls); if (d) return d; }
        return null;
    };
    const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

    beforeEach(() => {
        keydown = [];
        // An echoing Back, as at the top of this file (an earlier block swapped in a silent one).
        global.history.back = () => { backCount++; popstateHandler?.(); };
        Object.assign(global.window, { scrollY: 0, scrollTo: () => {} });
        /** @type {any} */ (global).requestAnimationFrame = (/** @type {Function} */ fn) => fn();
        Object.assign(global.document, {
            activeElement: null, createElement: el,
            addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { if (t === 'keydown') keydown.push(fn); },
            removeEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { if (t === 'keydown') keydown = keydown.filter(f => f !== fn); },
        });
        Object.assign(global.document.body, { children: [], appendChild: (/** @type {any} */ c) => { /** @type {any} */ (global.document.body).children.push(c); return c; } });
    });
    afterEach(() => { Object.assign(global.document, { addEventListener: realAdd, removeEventListener: realRemove }); });

    /** Open the real dialog. Reduced motion closes it at once; otherwise the fade waits for `settle()`.
     *  @param {any} opts @param {{ fade?: boolean }} [how] */
    async function open(opts, { fade = false } = {}) {
        const { confirmDialog } = await freshOverlay();
        /** @type {any} */ (global.window).matchMedia = () => ({ matches: !fade });
        let value = /** @type {any} */ ('pending');
        const p = confirmDialog({ message: 'Restore your unsaved changes from 14:20?', confirmLabel: 'Restore', cancelLabel: 'Discard', ...opts });
        p.then((/** @type {any} */ v) => { value = v; });
        const overlay = /** @type {any} */ (global.document.body).children.at(-1);
        return {
            overlay, confirm: find(overlay, 'dialog-btn-confirm'), cancel: find(overlay, 'dialog-btn-cancel'),
            escape: () => keydown.slice().forEach(fn => fn({ key: 'Escape', preventDefault() {} })),
            settle: async () => { overlay.fire('transitionend'); await microtasks(); },
            result: async () => { await microtasks(); return value; },
        };
    }

    for (const [how, dismiss] of /** @type {Array<[string, (d: any) => void]>} */ ([
        ['a tap on the backdrop', (d) => d.overlay.fire('click')],
        ['Escape', (d) => d.escape()],
        ['Android Back', () => pressBack()],
    ])) {
        test(`${how} resolves the caller's dismissResult — and false, a Cancel, when there is none`, async () => {
            const asked = await open({ dismissResult: null });
            dismiss(asked);
            assert.equal(await asked.result(), null, `${how} answered the question — the unsaved-work offer read it as Discard`);
            const plain = await open({});
            dismiss(plain);
            assert.equal(await plain.result(), false, 'every other confirmDialog still reads a dismissal as Cancel');
        });
    }

    test('the buttons are answers whatever a dismissal resolves to: Cancel false, Confirm true', async () => {
        const discard = await open({ dismissResult: null });
        discard.cancel.fire('click');
        assert.equal(await discard.result(), false, 'Discard must still delete — it is the explicit answer');
        const restore = await open({ dismissResult: null });
        restore.confirm.fire('click');
        assert.equal(await restore.result(), true);
    });

    test('a second tap during the fade changes nothing — the first answer stands', async () => {
        const flip = await open({}, { fade: true });
        flip.cancel.fire('click');
        flip.confirm.fire('click');                       // the card is still on screen, and tappable
        await flip.settle();
        assert.equal(await flip.result(), false, 'Cancel then Confirm resolved a cancelled dialog as confirmed');

        let opens = 0;
        const twice = await open({ onConfirm: () => { opens++; } }, { fade: true });
        twice.confirm.fire('click');
        twice.confirm.fire('click');
        await twice.settle();
        assert.equal(await twice.result(), true);
        assert.equal(opens, 1, 'a double tap on "Open in Safari" opened two tabs');

        const dismissed = await open({ dismissResult: null }, { fade: true });
        dismissed.overlay.fire('click');
        dismissed.confirm.fire('click');
        await dismissed.settle();
        assert.equal(await dismissed.result(), null, 'a button tapped after a dismissal answered a question nobody saw out');
    });
});
