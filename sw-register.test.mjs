// @ts-check
// sw-register.test.mjs — tests for the registerServiceWorker update lifecycle (v16.09; v16.23):
//   · the FIRST-INSTALL claim (no pre-existing registration, page uncontrolled) must NOT reload —
//     the page was just loaded from the network, so it already is the newest version;
//     reloading there double-loaded every brand-new device
//   · a HARD-RELOADED page (registration exists but controller is null — the browser bypassed the
//     SW) must NOT be treated as a first install: when a new SW claims it, that is a genuine
//     update and MUST reload (v16.23 — keying on the controller alone swallowed that update)
//   · a genuine update on an already-controlled page MUST reload, exactly once
//   · beforeReload receives EVERY controllerchange (no {once:true}) — a beforeReload that
//     declines (links' confirm → Cancel) must still get the next update's event
//   · the SKIP_WAITING message is only posted for a waiting SW when a controller exists
//   · registerServiceWorker is once-per-page-life (v16.23) — a re-invoked coordinator init()
//     (in-place sign-in) must not stack a second controllerchange handler/update interval
//
// No module mocks — runs in test:hygiene. The browser environment (navigator.serviceWorker,
// window, document, timers) is faked with plain objects; registerServiceWorker reads them
// all at call time, so no jsdom is needed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { registerServiceWorker, _resetForTest } = await import('./sw-register.js');

const _realSetInterval   = globalThis.setInterval;
const _realClearInterval = globalThis.clearInterval;

/**
 * Build a fake service-worker environment and install it on globalThis.
 * `hasRegistration` controls what getRegistration() resolves — defaults to `controlled`
 * (a controlled page always has a registration); pass it explicitly for the hard-reload case.
 * @param {{ controlled?: boolean, waiting?: boolean, hasRegistration?: boolean }} [opts]
 */
function makeHarness({ controlled = false, waiting = false, hasRegistration = controlled } = {}) {
    /** @type {Record<string, Function[]>} */
    const swListeners = {};
    const posted = /** @type {any[]} */ ([]);
    const registration = {
        waiting: waiting ? { postMessage: (/** @type {any} */ m) => posted.push(m) } : null,
        installing: null,
        addEventListener: () => {},
        update: () => Promise.resolve(),
    };
    const container = {
        controller: controlled ? {} : null,
        getRegistration: () => Promise.resolve(hasRegistration ? registration : undefined),
        register: () => Promise.resolve(registration),
        addEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => {
            (swListeners[type] = swListeners[type] || []).push(fn);
        },
    };
    const state = { reloads: 0 };

    // navigator exists as a real global in Node 21+ — replace via defineProperty.
    Object.defineProperty(globalThis, 'navigator', {
        value: { serviceWorker: container }, configurable: true, writable: true,
    });
    globalThis.window = /** @type {any} */ ({
        location: { reload: () => { state.reloads++; } },
        addEventListener: () => {},
    });
    globalThis.document = /** @type {any} */ ({ addEventListener: () => {}, hidden: false });
    // A real 60-min interval would hold the test process open — stub it.
    globalThis.setInterval   = /** @type {any} */ (() => 0);
    globalThis.clearInterval = /** @type {any} */ (() => {});

    // Release the once-per-page-life guard so each test case registers fresh (v16.23).
    _resetForTest();

    return {
        state,
        posted,
        container,
        swListeners,
        fireControllerChange() { (swListeners['controllerchange'] || []).forEach(fn => fn()); },
        /** Flush the getRegistration().then(register().then(...)) chain (all microtasks). */
        flush: () => new Promise(r => setTimeout(r, 0)),
        restore() {
            globalThis.setInterval   = _realSetInterval;
            globalThis.clearInterval = _realClearInterval;
        },
    };
}

test('first install: the claim controllerchange does NOT reload; the next one does', async () => {
    const h = makeHarness({ controlled: false });   // no registration either — true first install
    try {
        registerServiceWorker();
        await h.flush();
        h.fireControllerChange();                       // clients.claim() on first install
        assert.equal(h.state.reloads, 0, 'first-install claim must not reload');
        h.fireControllerChange();                       // a real update later in the session
        assert.equal(h.state.reloads, 1, 'a genuine update must reload');
    } finally { h.restore(); }
});

test('hard reload (registration exists, controller null): the next claim IS an update and reloads', async () => {
    const h = makeHarness({ controlled: false, hasRegistration: true });
    try {
        registerServiceWorker();
        await h.flush();
        h.fireControllerChange();                       // a NEW SW claims the bypassed page
        assert.equal(h.state.reloads, 1,
            'a hard-reloaded page must not be misclassified as a first install — its first claim is a genuine update');
    } finally { h.restore(); }
});

test('controlled page: an update reloads exactly once (double controllerchange guarded)', async () => {
    const h = makeHarness({ controlled: true });
    try {
        registerServiceWorker();
        await h.flush();
        h.fireControllerChange();
        h.fireControllerChange();
        assert.equal(h.state.reloads, 1, 'reloadFired must guard the default path');
    } finally { h.restore(); }
});

test('beforeReload: called on EVERY update controllerchange (declining must not swallow the next)', async () => {
    const h = makeHarness({ controlled: true });
    let calls = 0;
    try {
        registerServiceWorker({ beforeReload: () => { calls++; } });
        await h.flush();
        h.fireControllerChange();                       // e.g. links confirm → Cancel
        h.fireControllerChange();                       // the NEXT deploy must still prompt
        assert.equal(calls, 2, 'no {once:true} — every update must reach beforeReload');
        assert.equal(h.state.reloads, 0, 'beforeReload owns the reload decision');
    } finally { h.restore(); }
});

test('first install + beforeReload: claim skipped, update passed through', async () => {
    const h = makeHarness({ controlled: false });
    let calls = 0;
    try {
        registerServiceWorker({ beforeReload: () => { calls++; } });
        await h.flush();
        h.fireControllerChange();                       // first-install claim
        assert.equal(calls, 0, 'first-install claim must not reach beforeReload');
        h.fireControllerChange();
        assert.equal(calls, 1);
    } finally { h.restore(); }
});

test('waiting SW: SKIP_WAITING posted only when a controller already exists', async () => {
    const controlledH = makeHarness({ controlled: true, waiting: true });
    try {
        registerServiceWorker();
        await controlledH.flush();
        assert.deepEqual(controlledH.posted, [{ type: 'SKIP_WAITING' }], 'controlled + waiting → message');
    } finally { controlledH.restore(); }

    const freshH = makeHarness({ controlled: false, waiting: true });
    try {
        registerServiceWorker();
        await freshH.flush();
        assert.deepEqual(freshH.posted, [], 'first install (no controller) → no message');
    } finally { freshH.restore(); }
});

test('once-per-page-life: a second call (re-invoked init) does not stack handlers', async () => {
    const h = makeHarness({ controlled: true });
    try {
        registerServiceWorker();
        await h.flush();
        registerServiceWorker();                        // in-place sign-in re-invokes init()
        await h.flush();
        assert.equal((h.swListeners['controllerchange'] || []).length, 1,
            'second registration must be a no-op — one controllerchange handler only');
    } finally { h.restore(); }
});
