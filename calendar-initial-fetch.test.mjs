/**
 * Unit tests for calendar-initial-fetch.js — initial 3-month fetch and sync-chip state machine.
 * Run: node --experimental-test-module-mocks --test calendar-initial-fetch.test.mjs
 *
 * Covers: month pre-claiming, _initialFetchInProgress flag lifecycle, renderCalendar
 * callback paths, sync-chip appearance (800ms timer), timeout error state (10s),
 * retry success/failure, and calendar-fetching CSS class management.
 *
 * Note: mock.module provides a static snapshot for named exports; _initialFetchInProgress
 * cannot be tested as a live binding through module mocks. The visibilitychange tests
 * verify handler registration only.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Mock-controllable state ───────────────────────────────────────────────────

let _fetchImpl        = () => Promise.resolve();
let _progressHistory  = [];   // calls to setInitialFetchInProgress
let _addMonthsHistory = [];   // calls to addFetchedMonths
let _clearMonthsHistory = []; // calls to clearFetchedMonth
let _fakeFetchInProgress = false;
let _cacheFetchImpl   = () => Promise.resolve(false);   // phase 1: local-cache paint

mock.module('./calendar-overrides.js', {
    namedExports: {
        _initialFetchInProgress:    false,
        setInitialFetchInProgress(v) { _progressHistory.push(v); _fakeFetchInProgress = v; },
        addFetchedMonths(keys)       { _addMonthsHistory.push([...keys]); },
        clearFetchedMonth(key)       { _clearMonthsHistory.push(key); },
        monthKey:                    (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`,
        fetchOverridesForRange:      (...args) => _fetchImpl(...args),
        fetchOverridesForRangeFromCache: (...args) => _cacheFetchImpl(...args),
    },
});

mock.module('./roster-data.js', {
    namedExports: {
        formatISO: d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    },
});

const { initInitialFetch } = await import('./calendar-initial-fetch.js');

// ── Minimal DOM helpers ───────────────────────────────────────────────────────

function makeEl(tag) {
    const _classes   = new Set();
    const _attrs     = {};
    const _children  = [];
    const _listeners = {};
    const el = {
        _tag: tag, _classes, _children,
        dataset: {}, innerHTML: '', textContent: '',
        style: {}, disabled: false, type: '',
        setAttribute(k, v) { _attrs[k] = String(v); },
        getAttribute(k)    { return _attrs[k] !== undefined ? _attrs[k] : null; },
        appendChild(c)     { _children.push(c); return c; },
        remove()           { this._removed = true; },
        focus()            {},
        addEventListener(evt, fn) {
            if (!_listeners[evt]) _listeners[evt] = [];
            _listeners[evt].push(fn);
        },
        /** Invoke addEventListener listeners AND the on<evt> handler property (e.g. onclick),
         *  so the test exercises whichever the production code uses. */
        _fire(evt)         {
            (_listeners[evt] || []).forEach(fn => fn());
            const on = /** @type {any} */ (el)['on' + evt];
            if (typeof on === 'function') on();
        },
        classList: {
            add(...cls)    { cls.forEach(c => _classes.add(c)); },
            remove(...cls) { cls.forEach(c => _classes.delete(c)); },
            contains:  c  => _classes.has(c),
        },
    };
    Object.defineProperty(el, 'className', {
        get() { return [..._classes].join(' '); },
        set(v) { _classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => _classes.add(c)); },
        enumerable: true, configurable: true,
    });
    Object.defineProperty(el, 'isConnected', {
        get() { return !this._removed; },
        enumerable: true, configurable: true,
    });
    return el;
}

let _header, _calGrid, _docListeners;

/**
 * @param {{ header?: boolean }} [opts] header:false models FIRST RUN and TEAM VIEW — the two states
 *   where `.calendar-header` genuinely does not exist in the DOM, so no sync chip can ever be shown.
 */
function setupDOM(opts = {}) {
    const withHeader = opts.header !== false;
    _header = makeEl('div');
    _header.className = 'calendar-header';
    _calGrid = makeEl('div');
    _docListeners = {};
    global.document = {
        createElement: tag => makeEl(tag),
        getElementById: id  => id === 'calendarDisplay' ? _calGrid : null,
        querySelector:  sel => (withHeader && sel === '.calendar-header') ? _header : null,
        addEventListener(evt, fn) {
            if (!_docListeners[evt]) _docListeners[evt] = [];
            _docListeners[evt].push(fn);
        },
        removeEventListener() {},
        hidden: false,
    };
}

beforeEach(() => {
    _progressHistory     = [];
    _addMonthsHistory    = [];
    _clearMonthsHistory  = [];
    _fakeFetchInProgress = false;
    _fetchImpl           = () => Promise.resolve();
    _cacheFetchImpl      = () => Promise.resolve(false);
    setupDOM();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function flushAsync(ticks = 3) {
    for (let i = 0; i < ticks; i++) await Promise.resolve();
}

function getSyncChip() {
    return _header._children.find(c => c._classes.has('sync-chip')) || null;
}

// ── Pre-fetch synchronous setup ───────────────────────────────────────────────

describe('pre-fetch synchronous setup', () => {
    test('setInitialFetchInProgress(true) called synchronously before any await', () => {
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        assert.equal(_progressHistory[0], true);
    });

    test('addFetchedMonths called once with three month keys', () => {
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        assert.equal(_addMonthsHistory.length, 1);
        assert.equal(_addMonthsHistory[0].length, 3);
    });

    test('pre-claimed keys are the consecutive prev/current/next months', () => {
        _fetchImpl = () => new Promise(() => {});
        const now  = new Date();
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const fmt  = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
        const expected = [
            fmt(prev.getFullYear(), prev.getMonth()),
            fmt(now.getFullYear(),  now.getMonth()),
            fmt(next.getFullYear(), next.getMonth()),
        ];
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        assert.deepEqual(_addMonthsHistory[0], expected);
    });
});

// ── Success path ──────────────────────────────────────────────────────────────

describe('success path', () => {
    test('renderCalendar() called when fetch resolves and not in team view', async () => {
        let rendered = false;
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => { rendered = true; } });
        await flushAsync();
        assert.equal(rendered, true);
    });

    test('renderCalendar() NOT called when isTeamViewMode() returns true', async () => {
        let rendered = false;
        initInitialFetch({ isTeamViewMode: () => true, renderCalendar: () => { rendered = true; } });
        await flushAsync();
        assert.equal(rendered, false);
    });

    test('renderTeamView() IS called on success while in team view (v18.21 regression)', async () => {
        // The two-sided stand-down: without this notification, a user in team view when the
        // 3-month fetch resolved was stranded on a base-roster grid — this path rendered
        // nothing, and the team week fetch then reconciled against the already-populated
        // cache → "no change" → skipped ITS re-render too. Deterministic on boot-into-team-view
        // (IndexedDB persistence makes this fetch reliably win), so refreshing never recovered.
        let calRendered = false, teamRendered = false;
        initInitialFetch({
            isTeamViewMode: () => true,
            renderCalendar: () => { calRendered = true; },
            renderTeamView: () => { teamRendered = true; },
        });
        await flushAsync();
        assert.equal(teamRendered, true,  'team view must be repainted from the fresh cache');
        assert.equal(calRendered,  false, 'the personal calendar render stays suppressed in team view');
    });

    test('renderTeamView() NOT called when in calendar view', async () => {
        let teamRendered = false;
        initInitialFetch({
            isTeamViewMode: () => false,
            renderCalendar: () => {},
            renderTeamView: () => { teamRendered = true; },
        });
        await flushAsync();
        assert.equal(teamRendered, false);
    });

    test('setInitialFetchInProgress(false) called in finally on success', async () => {
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync();
        assert.ok(_progressHistory.includes(false));
    });

    test('no sync chip when fetch resolves before 800ms timer fires', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync();
        // Timer cleared in finally — ticking past 800ms should not create a chip
        t.mock.timers.tick(900);
        assert.equal(getSyncChip(), null);
    });

    test('calendar-fetching class absent after successful fetch', async () => {
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync();
        assert.ok(!_calGrid._classes.has('calendar-fetching'));
    });
});

// ── Failure path ──────────────────────────────────────────────────────────────

describe('failure path', () => {
    test('error chip appears immediately on fast failure (before 800ms)', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => Promise.reject(new Error('network error'));
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync();
        const chip = getSyncChip();
        assert.ok(chip, 'error chip should be created');
        assert.ok(chip._classes.has('sync-chip-error'));
        assert.equal(chip.disabled, false);
    });

    test('error chip text is the retry prompt', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => Promise.reject(new Error('fail'));
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync();
        assert.equal(getSyncChip()?.textContent, "⚠ Couldn't update — tap to retry");
    });

    test('retry is wired via onclick — one click issues exactly one request', async () => {
        let calls = 0;
        // First call (initial fetch) rejects; subsequent calls (the retry) resolve.
        _fetchImpl = () => { calls++; return calls === 1 ? Promise.reject(new Error('x')) : Promise.resolve(); };
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync();
        const chip = getSyncChip();
        assert.ok(chip, 'error chip appears on failure');
        // Wired via the idempotent onclick PROPERTY (not addEventListener): assigning replaces,
        // so handlers can never accumulate the way {once} listeners did across the timeout +
        // rejection paths and fire a single click as two retries.
        assert.equal(typeof chip.onclick, 'function');
        const before = calls;
        chip._fire('click');     // exactly one user click
        await flushAsync();
        assert.equal(calls - before, 1, 'one click must issue exactly one retry request');
    });

    test('renderCalendar() NOT called when fetch fails', async () => {
        _fetchImpl = () => Promise.reject(new Error('fail'));
        let rendered = false;
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => { rendered = true; } });
        await flushAsync();
        assert.equal(rendered, false);
    });

    test('setInitialFetchInProgress(false) called in finally on failure', async () => {
        _fetchImpl = () => Promise.reject(new Error('fail'));
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync();
        assert.ok(_progressHistory.includes(false));
    });

    test('calendar-fetching class removed in finally on failure', async () => {
        _fetchImpl = () => Promise.reject(new Error('fail'));
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync();
        assert.ok(!_calGrid._classes.has('calendar-fetching'));
    });

    test('releases the 3 pre-claimed months on failure so they can be re-fetched later', async () => {
        _fetchImpl = () => Promise.reject(new Error('fail'));
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync();
        // The same three month keys added up-front must be cleared, or ensureOverridesCached would
        // short-circuit them forever (no retry chip exists in team-view/first-run).
        assert.deepEqual(new Set(_clearMonthsHistory), new Set(_addMonthsHistory[0]));
        assert.equal(_clearMonthsHistory.length, 3);
    });
});

// ── Sync-chip state machine (timer-driven) ────────────────────────────────────

describe('sync-chip state machine', () => {
    test('loading chip appears after 800ms when fetch is still pending', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });

        assert.equal(getSyncChip(), null, 'no chip before 800ms');
        t.mock.timers.tick(800);
        const chip = getSyncChip();
        assert.ok(chip, 'chip should appear after 800ms');
        assert.equal(chip.textContent, '↻ Updating your shifts…');
        assert.equal(chip.disabled, true);
    });

    test('calendar-fetching class added to calGrid at 800ms', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        t.mock.timers.tick(800);
        assert.ok(_calGrid._classes.has('calendar-fetching'));
    });

    test('timeout at 10s changes chip to error state with retry button enabled', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        t.mock.timers.tick(800);   // loading chip created
        t.mock.timers.tick(9200);  // 10s total → timeout fires

        const chip = getSyncChip();
        assert.ok(chip, 'chip should still exist after timeout');
        assert.ok(chip._classes.has('sync-chip-error'));
        assert.equal(chip.textContent, "⚠ Couldn't update — tap to retry");
        assert.equal(chip.disabled, false);
    });

    test('timeout removes calendar-fetching class', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        t.mock.timers.tick(800);
        assert.ok(_calGrid._classes.has('calendar-fetching'), 'class added at 800ms');
        t.mock.timers.tick(9200);
        assert.ok(!_calGrid._classes.has('calendar-fetching'), 'class removed at 10s');
    });

    test('loading chip removed when fetch resolves after it was shown', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        let resolveIt;
        _fetchImpl = () => new Promise(res => { resolveIt = res; });

        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        // Let phase 1 (cache paint) + authReady settle so the SERVER fetch is actually in flight and
        // `resolveIt` is assigned — since v19.01 the authoritative read starts a few microtasks after
        // init, not synchronously (AUTH_PLAN.md → E1 two-phase load).
        await flushAsync();
        t.mock.timers.tick(800);

        const chip = getSyncChip();
        assert.ok(chip, 'chip should be present before resolve');

        resolveIt();
        await flushAsync();

        assert.equal(chip._removed, true, 'chip should be removed after successful fetch');
    });
});

// ── Retry ─────────────────────────────────────────────────────────────────────

describe('retry', () => {
    test('retry chip text changes to "Retrying…" immediately before await', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        t.mock.timers.tick(800);
        t.mock.timers.tick(9200);

        const chip = getSyncChip();
        _fetchImpl = () => new Promise(() => {});  // retry also hangs
        chip._fire('click');
        // doRetry runs synchronously until first await — text changes before await
        assert.equal(chip.textContent, '↻ Retrying…');
    });

    test('retry calls addFetchedMonths again to re-register the month range', (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        t.mock.timers.tick(800);
        t.mock.timers.tick(9200);

        const countBefore = _addMonthsHistory.length;
        _fetchImpl = () => new Promise(() => {});
        getSyncChip()._fire('click');
        assert.equal(_addMonthsHistory.length, countBefore + 1);
    });

    test('retry success: chip removed and renderCalendar called', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => new Promise(() => {});
        let rendered = false;
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => { rendered = true; } });
        t.mock.timers.tick(800);
        t.mock.timers.tick(9200);

        const chip = getSyncChip();
        assert.ok(chip?._classes.has('sync-chip-error'));

        _fetchImpl = () => Promise.resolve();
        chip._fire('click');
        await flushAsync();

        assert.equal(chip._removed, true, 'chip should be removed on retry success');
        assert.equal(rendered, true, 'renderCalendar should be called on retry success');
    });

    test('retry failure: chip stays in error state with retry enabled', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        t.mock.timers.tick(800);
        t.mock.timers.tick(9200);

        const chip = getSyncChip();
        _fetchImpl = () => Promise.reject(new Error('retry also failed'));
        chip._fire('click');
        await flushAsync();

        assert.ok(chip._classes.has('sync-chip-error'));
        assert.equal(chip.textContent, "⚠ Couldn't update — tap to retry");
        assert.equal(chip.disabled, false);
    });

    // Regression: v13.97 — the original slow request could reject AFTER a retry
    // had already succeeded, overwriting the success state with an error chip.
    test('original request rejection after retry success does not recreate error chip', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });

        let resolveOrig, rejectOrig;
        _fetchImpl = () => new Promise((res, rej) => { resolveOrig = res; rejectOrig = rej; });

        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        // Let phase 1 (cache paint) + authReady settle so the SERVER fetch is actually in flight and
        // `rejectOrig` is assigned — since v19.01 the authoritative read starts a few microtasks after
        // init, not synchronously (AUTH_PLAN.md → E1 two-phase load).
        await flushAsync();
        t.mock.timers.tick(800);
        t.mock.timers.tick(9200);

        // Retry is now shown. Make the retry succeed.
        const chip = getSyncChip();
        _fetchImpl = () => Promise.resolve();
        chip._fire('click');
        await flushAsync(5); // retry awaits authReady then resolves → chip removed

        assert.equal(chip._removed, true, 'chip should be removed after retry succeeds');

        // Now the original slow request finally rejects — must NOT recreate the error chip.
        rejectOrig(new Error('belated original failure'));
        await flushAsync();

        // Any new chip created would have been appended to _header._children.
        // The original chip was removed (._removed=true); no new chip should have been added.
        const visibleChips = _header._children.filter(c => c._classes.has('sync-chip') && !c._removed);
        assert.equal(visibleChips.length, 0, 'no visible error chip should appear after belated original rejection');
    });
});

// ── visibilitychange ──────────────────────────────────────────────────────────
// _initialFetchInProgress is a static snapshot in the mock binding — only handler
// registration and the "does not fire when hidden" guard are testable here.

describe('visibilitychange', () => {
    test('visibilitychange handler registered on document', () => {
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        assert.ok((_docListeners['visibilitychange']?.length ?? 0) > 0);
    });

    test('handler does not call renderCalendar when document.hidden is true', () => {
        _fetchImpl = () => new Promise(() => {});
        let rendered = false;
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => { rendered = true; } });
        global.document.hidden = true;
        _docListeners['visibilitychange']?.[0]?.();
        assert.equal(rendered, false);
    });
});

// ── E1: the render path must never be gated on auth (AUTH_PLAN.md → E1) ───────
//
// THE INVARIANT THIS FILE EXISTS TO PIN. Track E will require a session to READ overrides. The
// tempting implementation — await the auth promise, then fetch — puts a live signInAnonymously
// round-trip in front of data the device already has in its Firestore cache, so a returning phone on
// flaky signal waits on the network to see a roster it could paint instantly. That breaks the app's
// central promise ("offline first — Firestore is an enhancement") on its primary surface, and it does
// so invisibly: no unit test would notice, and e2e/offline.spec.js is opt-in AND stubs Firebase at
// the network layer, so it can observe neither.
//
// So: phase 1 (local cache) must go out and paint with auth UNRESOLVED. Phase 2 (the authoritative
// server read) is the only part allowed to wait.

describe('E1 — auth must not gate the cache paint', () => {
    test('the cache read still paints when authReady never resolves', async () => {
        let cacheCalled = false;
        let serverCalled = false;
        _cacheFetchImpl = () => { cacheCalled = true; return Promise.resolve(true); };
        _fetchImpl      = () => { serverCalled = true; return Promise.resolve(); };
        const renderCalendar = mock.fn();

        initInitialFetch({
            isTeamViewMode: () => false,
            renderCalendar,
            authReady: new Promise(() => {}),   // never resolves — a hung sign-in
        });
        await flushAsync(6);

        assert.equal(cacheCalled, true, 'phase 1 must not wait for auth');
        assert.equal(renderCalendar.mock.callCount() >= 1, true,
            'the cached roster must be painted even though auth never arrived');
        assert.equal(serverCalled, false, 'phase 2 correctly still waiting on auth');
    });

    test('an empty cache paints nothing (no spurious render) but still does not block', async () => {
        _cacheFetchImpl = () => Promise.resolve(false);   // first visit / evicted IndexedDB
        const renderCalendar = mock.fn();

        initInitialFetch({
            isTeamViewMode: () => false,
            renderCalendar,
            authReady: new Promise(() => {}),
        });
        await flushAsync(6);

        assert.equal(renderCalendar.mock.callCount(), 0,
            'nothing cached → nothing to paint; the server phase owns the first render');
    });

    // v19.07 — the regression check on v19.01 found this. doRetry awaited authReady PLAINLY, so a
    // hung sign-in stranded the chip on "Retrying…", disabled, with no handler: a dead end worse
    // than the failure it was recovering from. The retry chip only appears after the 10s timeout,
    // so auth has already had 10s+ to settle by the time anyone can tap it.
    test('a retry still completes when authReady never resolves (no dead-end chip)', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let serverCalls = 0;
        _fetchImpl = () => { serverCalls++; return new Promise(() => {}); };  // original hangs

        initInitialFetch({
            isTeamViewMode: () => false,
            renderCalendar: () => {},
            authReady: new Promise(() => {}),   // sign-in never settles
        });
        await flushAsync();
        t.mock.timers.tick(800);
        t.mock.timers.tick(9200);               // error chip appears

        const chip = getSyncChip();
        assert.ok(chip, 'the error chip should be present');
        // Phase 2's own auth wait is bounded by SYNC_TIMEOUT_MS, so by now it has already given up
        // waiting and attempted its read (v19.08 — that bound is what stops the fetch state leaking).
        // Measure the RETRY specifically rather than a total, so this test tracks the retry path only.
        const before = serverCalls;
        _fetchImpl = () => { serverCalls++; return Promise.resolve(); };   // retry would succeed
        chip._fire('click');
        await flushAsync();
        t.mock.timers.tick(2000);               // the bounded auth wait elapses
        await flushAsync(6);

        assert.equal(serverCalls > before, true,
            'the retry must reach the read even though auth never settled — otherwise the chip is a dead end');
    });

    test('phase 2 runs the authoritative read once auth resolves', async () => {
        let serverCalled = false;
        _cacheFetchImpl = () => Promise.resolve(true);
        _fetchImpl      = () => { serverCalled = true; return Promise.resolve(); };

        initInitialFetch({
            isTeamViewMode: () => false,
            renderCalendar: mock.fn(),
            authReady: Promise.resolve(),
        });
        await flushAsync(8);

        assert.equal(serverCalled, true, 'the server read must still happen — the cache is not the truth');
    });

    // v19.08 — the state leak underneath the v19.07 fix. Phase 2's OWN `await authReady` was still
    // unbounded, so when a sign-in never settled the async IIFE never settled either: neither `catch`
    // nor `finally` ran. `_initialFetchInProgress` stayed true and the three months stayed claimed in
    // `fetchedMonths` for the life of the page, silently disabling every later refresh. The 10s timer
    // painted a retry chip, but only where a `.calendar-header` exists — not first-run, not Team View.
    test('a never-settling authReady must not leak the fetch state past the deadline', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        initInitialFetch({
            isTeamViewMode: () => false,
            renderCalendar: () => {},
            authReady: new Promise(() => {}),   // sign-in never settles
        });
        await flushAsync();

        assert.equal(_progressHistory.includes(false), false,
            'still legitimately in progress before the deadline');

        t.mock.timers.tick(10000);   // SYNC_TIMEOUT_MS — phase 2 gives up waiting and reads anyway
        await flushAsync(8);

        assert.equal(_progressHistory.includes(false), true,
            'the IIFE must ALWAYS settle so `finally` releases the in-progress flag — otherwise the ' +
            'three months stay claimed forever and no later navigation can re-fetch them');
        assert.equal(_calGrid._classes.has('calendar-fetching'), false,
            'and the grid must not be left wearing the fetching state permanently');
    });
});

// ── Recovery where there is NO sync chip (first run · Team View) ──────────────
//
// WHY THIS BLOCK EXISTS. Every chip test above builds a `.calendar-header` and then asserts on the
// chip inside it. But the header does not exist during FIRST RUN or in TEAM VIEW — the module's own
// comments say so twice, and it is the stated reason the failure path releases the pre-claimed
// months at all. So the entire visible recovery mechanism is absent in exactly those two states, and
// `clearFetchedMonth` is the ONLY thing standing between a failed sync and a session that can never
// re-fetch those months.
//
// That made the most load-bearing line in the module the least tested one: a refactor that moved the
// release inside `if (syncChip)` — a natural-looking tidy-up, since everything around it is chip work
// — would pass every test above while permanently stranding first-run and Team View users on the
// base roster, with no error shown and no way to recover short of a reinstall.

describe('recovery without a sync chip (first run · team view)', () => {
    beforeEach(() => setupDOM({ header: false }));

    test('a failed fetch still releases the three months when no chip can be shown', async () => {
        _fetchImpl = () => Promise.reject(new Error('offline'));
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync(6);

        assert.deepEqual(new Set(_clearMonthsHistory), new Set(_addMonthsHistory[0]),
            'with no chip to tap, releasing the months is the ONLY recovery path — a later render or ' +
            'navigation re-fetches them via ensureOverridesCached');
        assert.equal(_clearMonthsHistory.length, 3);
    });

    test('a failed fetch with no header does not throw, and still clears the fetch state', async () => {
        _fetchImpl = () => Promise.reject(new Error('offline'));
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync(6);

        // If ensureChipAttached()'s null return were dereferenced, the catch would throw before
        // reaching `finally`'s cleanup — an unhandled rejection that leaves the grid mid-fetch.
        assert.equal(_progressHistory.includes(false), true, 'finally must still run');
        assert.equal(_calGrid._classes.has('calendar-fetching'), false);
    });

    test('the 10s timeout with no header leaves no fetching state on the grid', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _fetchImpl = () => new Promise(() => {});
        initInitialFetch({ isTeamViewMode: () => false, renderCalendar: () => {} });
        await flushAsync();

        t.mock.timers.tick(800);
        assert.equal(_calGrid._classes.has('calendar-fetching'), true,
            'the grid still shows it is fetching even though no chip exists to say so');

        t.mock.timers.tick(9200);
        assert.equal(_calGrid._classes.has('calendar-fetching'), false,
            'at the deadline the grid must stop looking busy — with no chip, this is the only signal ' +
            'these users get that the sync is over');
    });

    test('a failed fetch in TEAM VIEW releases the months and repaints nothing', async () => {
        _fetchImpl = () => Promise.reject(new Error('offline'));
        let teamRendered = false, calRendered = false;
        initInitialFetch({
            isTeamViewMode: () => true,
            renderCalendar: () => { calRendered = true; },
            renderTeamView: () => { teamRendered = true; },
        });
        await flushAsync(6);

        assert.equal(_clearMonthsHistory.length, 3,
            'Team View has no chip either — the release is its whole recovery story');
        assert.equal(teamRendered, false, 'nothing new to paint on failure; keep the last-good grid');
        assert.equal(calRendered,  false);
    });
});

// ── Team View recovery through the retry path ─────────────────────────────────
// The retry lives on a chip, so it can only be reached with a header present — but a user can be in
// Team View WITH the calendar header still mounted (toggling views does not unmount it in every
// state). The retry's success branch picks the renderer by mode, and that branch was untested: a
// retry that repainted the personal calendar instead of the team grid would leave the Team View user
// looking at a stale base-roster grid with a chip that had just told them everything was fine.

describe('team view retry recovery', () => {
    test('a successful retry in team view repaints the TEAM grid, not the calendar', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        // Same call-time-lookup hazard as the failed-retry test below: pin that the original is
        // already in flight, so the repaint we assert on can only have come from doRetry.
        let calls = 0;
        _fetchImpl = () => { calls++; return new Promise(() => {}); };
        let teamRendered = false, calRendered = false;
        initInitialFetch({
            isTeamViewMode: () => true,
            renderCalendar: () => { calRendered = true; },
            renderTeamView: () => { teamRendered = true; },
        });
        await flushAsync(6);
        assert.equal(calls, 1, 'the original request must already be in flight before we arm the retry');

        t.mock.timers.tick(800);
        t.mock.timers.tick(9200);          // error chip appears

        const chip = getSyncChip();
        assert.ok(chip, 'the error chip should be present');
        assert.equal(teamRendered, false, 'nothing has repainted yet — the original is still hung');

        _fetchImpl = () => { calls++; return Promise.resolve(); };
        chip._fire('click');
        await flushAsync();
        t.mock.timers.tick(2000);          // RETRY_AUTH_WAIT_MS
        await flushAsync(6);

        assert.equal(calls, 2, 'exactly one further request — the retry');

        assert.equal(teamRendered, true,
            'the retry must repaint whichever view the user is actually looking at');
        assert.equal(calRendered, false,
            'repainting the personal calendar would leave the team grid stale behind a success message');
    });

    test('a failed retry releases the months so a later navigation can re-fetch', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        // `_fetchImpl` is read at CALL time, so a naive reassign-then-click can be picked up by the
        // ORIGINAL request instead of the retry — and then this test would pass on the original's
        // release while proving nothing about doRetry. Count the calls and assert which one we are
        // looking at, so the attribution is checked rather than assumed.
        let calls = 0;
        _fetchImpl = () => { calls++; return new Promise(() => {}); };   // original: hangs forever
        initInitialFetch({ isTeamViewMode: () => true, renderCalendar: () => {}, renderTeamView: () => {} });
        await flushAsync(6);
        assert.equal(calls, 1, 'the original request must already be in flight before we arm the retry');

        t.mock.timers.tick(800);
        t.mock.timers.tick(9200);

        const chip = getSyncChip();
        _clearMonthsHistory = [];          // isolate the RETRY's releases from the original failure's
        _fetchImpl = () => { calls++; return Promise.reject(new Error('still offline')); };
        chip._fire('click');
        await flushAsync();
        t.mock.timers.tick(2000);
        await flushAsync(6);

        assert.equal(calls, 2, 'exactly one further request — the retry — and the original still hung');
        assert.equal(_clearMonthsHistory.length, 3,
            'a failed retry re-claimed the months up-front, so it must release them again — otherwise ' +
            'one failed tap strands all three for the rest of the session');
    });
});
