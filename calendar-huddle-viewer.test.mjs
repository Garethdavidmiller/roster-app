/**
 * calendar-huddle-viewer.test.mjs — the Daily Huddle viewer obeys the document gate (CALENDAR_DATA.md 15).
 * Run: node --experimental-test-module-mocks --test calendar-huddle-viewer.test.mjs
 *
 * WHY THIS FILE EXISTS (test audit, 7 Nov 2026). The viewer is the one document surface that holds
 * a LIVE subscription, so it is the one that has to be taken down when access goes: the listener
 * detached, what it delivered dropped, and an open viewer told why it no longer shows the Huddle.
 * Its sibling, calendar-doc-viewer.js, had 24 Node tests; this module had none, and its lock
 * teardown and generation guard rested on the browser suite alone.
 *
 * A FIRST, FOCUSED SET — not a suite. It drives the real `initHuddleViewer` through its own seams
 * (the gate's `onChange`, the `#huddle` tap, the snapshot callback) and pins two things:
 *   · the TEARDOWN: shutting the gate detaches the listener, a snapshot that outlives it delivers
 *     nothing, and an open viewer says "locked" instead of showing the Huddle;
 *   · the GENERATION GUARD: a subscription still waiting for a session must not attach after a lock
 *     has landed, and two starts waiting together attach ONE listener, not two.
 * Rendering (wrapTables, the sticky column) is e2e/pages.spec.js's.
 *
 * Each test imports a FRESH copy of the module (a query string makes a new instance; its own imports
 * still resolve to the mocks below), because `_huddleData` and `_huddleState` are module state that
 * lives for the page — one test's delivered Huddle would otherwise be the next test's starting point.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Fakes ───────────────────────────────────────────────────────────────────────────────────────

/** Every listener the viewer attached, in order, and whether it was later detached. */
/** @type {Array<{ onData: Function, onError: Function, detached: boolean }>} */
let listeners = [];
mock.module('./firebase-client.js', {
    namedExports: {
        subscribeToLatestHuddle: (/** @type {Function} */ onData, /** @type {Function} */ onError) => {
            const l = { onData, onError, detached: false };
            listeners.push(l);
            return () => { l.detached = true; };
        },
        resolveDocumentOpenUrl: () => ({ url: 'https://firebasestorage.googleapis.com/v0/b/x/o/huddle.pdf' }),
        fetchSignedDocumentUrl: async () => null,
    },
});
mock.module('./overlay.js', {
    namedExports: {
        lockBodyScroll() {}, _pushOverlayState() {}, trapFocus() {}, _isTopOverlay: () => true,
        dismissOverlay: (/** @type {any} */ el) => { el.classList.remove('visible'); el.classList.remove('open'); },
    },
});
mock.module('./usage-reporter.js', { namedExports: { recordOpen() {} } });
mock.module('./session.js', { namedExports: { getSession: () => null } });

let _instance = 0;
/** A fresh module instance — see the header. @returns {Promise<typeof import('./calendar-huddle-viewer.js')>} */
const freshViewer = () => import(`./calendar-huddle-viewer.js?case=${++_instance}`);

// ── A DOM just rich enough for the viewer ───────────────────────────────────────────────────────

/** @type {any} */ let viewer;
/** @type {any} */ let body;
/** @type {Record<string, Function[]>} */ let docListeners;
/** @type {Function[]} */ let hashListeners;

function el() {
    const classes = new Set();
    return {
        innerHTML: '', _listeners: /** @type {Record<string, Function[]>} */ ({}),
        classList: { add: (/** @type {string} */ c) => classes.add(c), remove: (/** @type {string} */ c) => classes.delete(c), contains: (/** @type {string} */ c) => classes.has(c) },
        addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (this._listeners[t] ||= []).push(fn); },
        focus() {},
    };
}

function setupDOM() {
    viewer = el(); body = el();
    const nodes = /** @type {Record<string, any>} */ ({ huddleViewer: viewer, huddleViewerBody: body, huddleViewerClose: el() });
    docListeners = {}; hashListeners = [];
    /** @type {any} */ (globalThis).document = {
        getElementById: (/** @type {string} */ id) => nodes[id] ?? null,
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (docListeners[t] ||= []).push(fn); },
        removeEventListener() {},
        activeElement: null,
        hidden: false,
    };
    /** @type {any} */ (globalThis).window = {
        location: { hash: '', pathname: '/', search: '' },
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { if (t === 'hashchange') hashListeners.push(fn); },
        open() { return null; },
    };
    /** @type {any} */ (globalThis).history = { replaceState() {} };
    /** @type {any} */ (globalThis).requestAnimationFrame = (/** @type {Function} */ fn) => fn();
}

/** The document gate, as calendar-doc-access.js presents it: `has`, plus `onChange` subscribers. */
function makeGate(/** @type {boolean} */ open) {
    let isOpen = open;
    /** @type {Function[]} */ const subs = [];
    return {
        has: () => isOpen,
        onChange: (/** @type {Function} */ fn) => { subs.push(fn); return () => {}; },
        /** Move the gate and tell the viewer, as the coordinator does on a grant or a re-lock. */
        set(/** @type {boolean} */ v) { isOpen = v; subs.forEach(fn => fn(v)); },
    };
}

/** A `#huddle` arrival on an already-open page — the drawer link, or a notification tap. */
function tapHuddle() {
    window.location.hash = '#huddle';
    hashListeners.forEach(fn => fn());
}

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const LOCKED = 'Enter the staff PIN, or sign in, to read the Daily Huddle.';
const READY  = 'The latest Huddle is ready.';
/** A PDF Huddle: no `htmlContent`, so the viewer draws its "Open Huddle" prompt (no sanitiser needed). */
const huddle = (/** @type {string} */ n) => ({ storageUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/${n}.pdf`, storagePath: `huddles/${n}.pdf`, fileType: 'pdf' });

beforeEach(() => { listeners = []; setupDOM(); });

// ── THE TEARDOWN ────────────────────────────────────────────────────────────────────────────────

describe('shutting the gate takes the Huddle down', () => {
    test('the listener is detached, an open viewer says "locked", and a late snapshot delivers nothing', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });   // the viewer's 8s loading bound — never reached here
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(true);
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await flush();
        assert.equal(listeners.length, 1, 'guard: with access, the subscription must attach');

        listeners[0].onData(huddle('monday'), false);
        tapHuddle();
        await flush();
        assert.ok(body.innerHTML.includes(READY), 'guard: the tap must have opened the Huddle');

        gate.set(false);                                   // the session expired, or the PIN rotated
        assert.equal(listeners[0].detached, true, 'the live listener survived the lock — it would keep delivering');
        assert.ok(body.innerHTML.includes(LOCKED), 'the open viewer still shows a Huddle its reader may no longer read');

        // The listener's last answer, already on its way when the lock landed.
        listeners[0].onData(huddle('tuesday'), false);
        await flush();
        assert.ok(!body.innerHTML.includes(READY), 'a snapshot that outlived the lock was shown');
        assert.ok(body.innerHTML.includes(LOCKED));
    });

    test('what the lock dropped stays dropped — after the next grant, a tap waits for the NEW answer', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(true);
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await flush();
        listeners[0].onData(huddle('monday'), false);

        gate.set(false);
        gate.set(true);                                    // the PIN entered again
        await flush();
        assert.equal(listeners.length, 2, 'the grant must start a fresh subscription');

        tapHuddle();                                       // before the fresh one has answered
        await flush();
        assert.ok(!body.innerHTML.includes(READY),
            'the Huddle delivered before the lock was opened — the lock must drop it, not keep it for later');

        listeners[1].onData(huddle('monday'), false);      // the new grant's own answer
        await flush();
        assert.ok(body.innerHTML.includes(READY), 'the held tap must finish once the new subscription answers');
    });

    test('while shut, no listener is attached at all — and the tap made then is finished by the unlock', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(false);
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await flush();
        assert.equal(listeners.length, 0, 'a listener attached while locked — the local cache answers without asking a rule');

        tapHuddle();
        assert.ok(body.innerHTML.includes(LOCKED), 'a locked tap must say what unlocks it, not do nothing');

        gate.set(true);
        await flush();
        assert.equal(listeners.length, 1);
        listeners[0].onData(huddle('monday'), false);
        await flush();
        assert.ok(body.innerHTML.includes(READY), 'the tap made on the PIN card must open the Huddle once the PIN is in');
    });
});

// ── THE GENERATION GUARD ────────────────────────────────────────────────────────────────────────

describe('a subscription waiting for a session cannot attach late', () => {
    test('a lock that lands during the wait stops it attaching (v24.56)', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(true);
        /** @type {(v?: any) => void} */ let signedIn = () => {};
        initHuddleViewer({ authReady: new Promise(r => { signedIn = r; }), docAccess: gate });
        await flush();
        assert.equal(listeners.length, 0, 'guard: still waiting for the session');

        gate.set(false);                                   // re-locked before the session arrived
        signedIn();
        await flush();
        assert.equal(listeners.length, 0, 'the listener attached to a LOCKED page once the session arrived');
    });

    test('two starts waiting on the same session attach ONE listener, not two', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        /** @type {(v?: any) => void} */ let signedIn = () => {};
        initHuddleViewer({ authReady: new Promise(r => { signedIn = r; }), docAccess: makeGate(true) });
        await flush();
        // The page coming back into view while still 'loading' re-subscribes — the second start.
        (docListeners.visibilitychange || []).forEach(fn => fn());
        await flush();
        signedIn();
        await flush();
        assert.equal(listeners.length, 1, 'both waiting starts attached — every Huddle would be delivered twice');
    });
});
