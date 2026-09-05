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

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { registerServiceWorker, _resetForTest } = await import('./sw-register.js');

const _realSetInterval   = globalThis.setInterval;
const _realClearInterval = globalThis.clearInterval;

/**
 * Build a fake service-worker environment and install it on globalThis.
 * `hasRegistration` controls what getRegistration() resolves — defaults to `controlled`
 * (a controlled page always has a registration); pass it explicitly for the hard-reload case.
 * @param {{ controlled?: boolean, waiting?: boolean, hasRegistration?: boolean, deferRegister?: boolean }} [opts]
 *   deferRegister — register() returns a promise that resolves ONLY when resolveRegister() is
 *   called, so a test can fire controllerchange in the window between getRegistration resolving
 *   and register resolving (the first-install race).
 */
function makeHarness({ controlled = false, waiting = false, hasRegistration = controlled, deferRegister = false, failRegister = false } = {}) {
    /** @type {Record<string, Function[]>} */
    const swListeners = {};
    const posted = /** @type {any[]} */ ([]);
    const registration = {
        waiting: waiting ? { postMessage: (/** @type {any} */ m) => posted.push(m) } : null,
        installing: null,
        addEventListener: () => {},
        update: () => Promise.resolve(),
    };
    /** @type {(() => void)|null} */
    let _resolveRegister = null;
    const container = {
        controller: controlled ? {} : null,
        getRegistration: () => Promise.resolve(hasRegistration ? registration : undefined),
        register: () => deferRegister
            ? new Promise(res => { _resolveRegister = () => res(registration); })
            : (failRegister ? Promise.reject(new Error('register failed')) : Promise.resolve(registration)),
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
    /** @type {Record<string, Function[]>} */
    const docListeners = {};
    globalThis.document = /** @type {any} */ ({
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => {
            (docListeners[t] = docListeners[t] || []).push(fn);
        },
        hidden: false,
        visibilityState: 'visible',
    });
    // A real 60-min interval would hold the test process open — stub it.
    globalThis.setInterval   = /** @type {any} */ (() => 0);
    globalThis.clearInterval = /** @type {any} */ (() => {});
    // The update-reload marker `perf-reporter.js` reads on the next load. A Map, not a stub that
    // swallows writes: what these cases assert is the VALUE that was stored and when.
    /** @type {Map<string, string>} */
    const store = new Map();
    globalThis.sessionStorage = /** @type {any} */ ({
        getItem: (/** @type {string} */ k) => (store.has(k) ? store.get(k) : null),
        setItem: (/** @type {string} */ k, /** @type {any} */ v) => { store.set(k, String(v)); },
        removeItem: (/** @type {string} */ k) => { store.delete(k); },
    });

    // Release the once-per-page-life guard so each test case registers fresh (v16.23).
    _resetForTest();

    return {
        state,
        posted,
        container,
        swListeners,
        store,
        fireControllerChange() { (swListeners['controllerchange'] || []).forEach(fn => fn()); },
        docListeners,
        /** Background/foreground the fake page, firing visibilitychange like a browser does. */
        setVisibility(/** @type {'visible'|'hidden'} */ v) {
            globalThis.document.visibilityState = v;
            globalThis.document.hidden = v === 'hidden';
            (docListeners['visibilitychange'] || []).forEach(fn => fn());
        },
        /** Resolve a deferred register() (only meaningful with deferRegister: true). */
        resolveRegister() { _resolveRegister?.(); },
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

test('first-install race: a claim that fires BEFORE register() resolves is still suppressed (listener attached pre-register)', async () => {
    // The regression guard for v16.88. With the controllerchange listener attached inside
    // register().then (the old position), a first-install claim firing in the gap before that
    // .then ran was missed → suppressNextClaim stayed true → the NEXT genuine update was wrongly
    // suppressed. The listener is now attached BEFORE register(), so the early claim consumes the
    // flag. Deferring register() reproduces exactly that window.
    const h = makeHarness({ controlled: false, deferRegister: true });
    try {
        registerServiceWorker();
        await h.flush();                 // getRegistration resolves; listener attached; register() pending
        h.fireControllerChange();        // first-install claim arrives BEFORE register() resolves
        assert.equal(h.state.reloads, 0, 'the early first-install claim must not reload');
        h.resolveRegister();             // register() finally resolves
        await h.flush();
        h.fireControllerChange();        // a genuine later update
        assert.equal(h.state.reloads, 1,
            'the suppression flag was consumed by the early claim, so the next update MUST reload');
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

test('register() failure then re-invocation does NOT stack a second controllerchange listener (B3)', async () => {
    // The controllerchange listener is attached BEFORE register() (v16.88), and the .catch resets
    // `_registered` so the in-place-login re-invocation can RETRY registration. Without the separate
    // latch, that retry re-ran the body and attached a SECOND listener — each with its own beforeReload
    // closure → a DOUBLE "reload?" confirm on the next update.
    const h = makeHarness({ controlled: true, failRegister: true });
    try {
        registerServiceWorker({ beforeReload: () => {} });   // register() rejects → _registered resets
        await h.flush();
        assert.equal((h.swListeners['controllerchange'] || []).length, 1, 'listener attached once despite the failure');
        registerServiceWorker({ beforeReload: () => {} });   // in-place-login retry after the failed register
        await h.flush();
        assert.equal((h.swListeners['controllerchange'] || []).length, 1,
            'the retry must NOT attach a second controllerchange listener (would double-fire beforeReload)');
    } finally { h.restore(); }
});


// ── deferWhileVisible: a release must not take the page away mid-read (v22.90) ──────────────────
//
// Organised by what each wrong answer COSTS, because they are not symmetrical. Reloading a member
// who is READING is the shipped defect and the expensive one: the roster vanishes, a second full
// boot runs including the auth round trip, and it reads as the app being slow — which is exactly
// the complaint this came from. NEVER reloading is the failure a careless fix produces: the device
// keeps running old JS against the new SW's version cache, which is the mixed-version hazard the
// reload exists to close. So both directions are pinned, and the DEFAULT is pinned too — the pages
// that ask before reloading must not silently acquire this.

describe('deferWhileVisible — the update waits for the member to look away', () => {
    test('a visible page is NOT reloaded when the update lands', async () => {
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            registerServiceWorker({ deferWhileVisible: true });
            await h.flush();
            h.fireControllerChange();
            assert.equal(h.state.reloads, 0,
                'the member was reading; the roster must not vanish and rebuild under them');
        } finally { h.restore(); }
    });

    test('and it reloads the moment they DO look away', async () => {
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            registerServiceWorker({ deferWhileVisible: true });
            await h.flush();
            h.fireControllerChange();
            h.setVisibility('hidden');
            assert.equal(h.state.reloads, 1,
                'deferring must not mean never — the device would run old JS against the new cache');
        } finally { h.restore(); }
    });

    test('an update that arrives while ALREADY hidden reloads at once', async () => {
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            registerServiceWorker({ deferWhileVisible: true });
            await h.flush();
            h.setVisibility('hidden');
            h.fireControllerChange();
            assert.equal(h.state.reloads, 1, 'nobody is watching, which is the whole condition');
        } finally { h.restore(); }
    });

    test('two releases while they read still cost exactly ONE reload', async () => {
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            registerServiceWorker({ deferWhileVisible: true });
            await h.flush();
            h.fireControllerChange();
            h.fireControllerChange();
            h.setVisibility('hidden');
            assert.equal(h.state.reloads, 1, 'a superseded update must not stack a second reload');
        } finally { h.restore(); }
    });

    // THE CASE WITH THE TEETH, and the one above does not have them. Consuming `pendingReload`
    // rather than merely reading it only matters on the SECOND hide, and a single hide cycle passes
    // either way — a mutation that dropped the consume survived the test above and was caught only
    // here. It bites on `beforeReload` pages specifically: the default path is already guarded by
    // `reloadFired`, but a page that supplies its own reload (the Calendar does) has no such guard,
    // so a stale pending entry fires its reload again every time the member backgrounds the app.
    test('backgrounding a SECOND time does not re-fire an update already spent', async () => {
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            let called = 0;
            registerServiceWorker({ deferWhileVisible: true, beforeReload: () => { called++; } });
            await h.flush();
            h.fireControllerChange();
            h.setVisibility('hidden');
            assert.equal(called, 1, 'the update runs when they first look away');
            h.setVisibility('visible');
            h.setVisibility('hidden');
            assert.equal(called, 1,
                'no new release has landed — backgrounding again must not reload them a second time');
        } finally { h.restore(); }
    });

    test('coming back to the foreground does not reload — only hiding does', async () => {
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            registerServiceWorker({ deferWhileVisible: true });
            await h.flush();
            h.fireControllerChange();
            h.setVisibility('visible');
            assert.equal(h.state.reloads, 0, 'a visibilitychange to VISIBLE is the member arriving');
        } finally { h.restore(); }
    });

    test('WITHOUT the flag the reload is immediate — the other pages are untouched', async () => {
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            registerServiceWorker();
            await h.flush();
            h.fireControllerChange();
            assert.equal(h.state.reloads, 1,
                'admin/operations/links must keep reloading as they do today');
        } finally { h.restore(); }
    });

    test('deferral still routes through beforeReload, not around it', async () => {
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            let called = 0;
            registerServiceWorker({ deferWhileVisible: true, beforeReload: () => { called++; } });
            await h.flush();
            h.fireControllerChange();
            assert.equal(called, 0, 'held while visible');
            h.setVisibility('hidden');
            assert.equal(called, 1, 'the page owns HOW it reloads; this only owns WHEN');
            assert.equal(h.state.reloads, 0, 'beforeReload replaces the default reload');
        } finally { h.restore(); }
    });
});

// ── THE MARKER THAT SAYS "THIS LOAD FOLLOWED A RELEASE" (v22.91) ────────────────────────────────
//
// v22.90 deferred the update reload and shipped with the cost it removes unmeasured. This marker is
// the measurement's write half; `perf-reporter.test.mjs` owns the read half and the recency rule.
//
// The rule tested, the WIRING not — that is this repo's named blind spot, and it is exactly the
// shape here: `markUpdateReload` could be perfect and record nothing, because the line that calls it
// sits on one branch of a path with four ways through. So these cases assert the marker is written
// on the paths a member actually takes, and NOT on the one that is not an update at all.
describe('the update-reload marker', () => {
    const KEY = 'myb_perf_sw_reload';

    test('a default-path reload writes the marker before reloading', async () => {
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            registerServiceWorker();
            await h.flush();
            h.fireControllerChange();
            assert.equal(h.state.reloads, 1);
            assert.ok(h.store.has(KEY), 'the load that follows this reload must be attributable');
            assert.ok(Number(h.store.get(KEY)) > 0, 'a timestamp, not a flag — the reader refuses stale ones');
        } finally { h.restore(); }
    });

    test('a beforeReload page writes it too — the reload it does is still an update', async () => {
        // The branch a naive placement misses. `run()` returns early into beforeReload, so a marker
        // written after that call would never be reached on admin, operations, links OR the calendar
        // — i.e. on every page that has one, which is every page the figure is about.
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            registerServiceWorker({ beforeReload: () => {} });
            await h.flush();
            h.fireControllerChange();
            assert.equal(h.state.reloads, 0, 'the page owns the reload');
            assert.ok(h.store.has(KEY), 'and it is still an update-caused load when it happens');
        } finally { h.restore(); }
    });

    test('a DEFERRED reload writes it when it finally runs, not when it was held', async () => {
        // The calendar's path since v22.90. Written at hide time, so the timestamp measures the gap
        // to the load that follows — which is what the recency bound is checked against. Written at
        // hold time it could be arbitrarily old by the time the member looks away, and every
        // deferred reload would be refused as stale: the metric would report zero on the one page
        // it was built for, and read as "releases never interrupt anybody".
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            registerServiceWorker({ deferWhileVisible: true });
            await h.flush();
            h.fireControllerChange();
            assert.equal(h.store.has(KEY), false, 'nothing has reloaded yet');
            h.setVisibility('hidden');
            assert.equal(h.state.reloads, 1);
            assert.ok(h.store.has(KEY));
        } finally { h.restore(); }
    });

    test('the FIRST-INSTALL claim writes NOTHING — it is not an update', async () => {
        // The suppressed branch returns before `run()`, and it must: a brand-new device's first
        // controllerchange is not a release landing on anybody. Marking it would file every first
        // open on every new install as an update open — a false positive at exactly the moment a
        // member has no history to compare it against.
        const h = makeHarness({ controlled: false });
        try {
            registerServiceWorker();
            await h.flush();
            h.fireControllerChange();
            assert.equal(h.state.reloads, 0);
            assert.equal(h.store.has(KEY), false);
        } finally { h.restore(); }
    });

    test('sessionStorage throwing does not stop the reload', async () => {
        // iOS private mode throws on every access. The marker is a measurement; the reload is how a
        // device stops running old code against a new cache. Losing the second to the first would
        // trade a real correctness property for a statistic.
        const h = makeHarness({ hasRegistration: true, controlled: true });
        try {
            globalThis.sessionStorage = /** @type {any} */ ({
                getItem: () => { throw new Error('SecurityError'); },
                setItem: () => { throw new Error('SecurityError'); },
                removeItem: () => { throw new Error('SecurityError'); },
            });
            registerServiceWorker();
            await h.flush();
            h.fireControllerChange();
            assert.equal(h.state.reloads, 1, 'the reload is not optional');
        } finally { h.restore(); }
    });
});
