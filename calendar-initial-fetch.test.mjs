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

mock.module('./calendar-overrides.js', {
    namedExports: {
        _initialFetchInProgress:    false,
        setInitialFetchInProgress(v) { _progressHistory.push(v); _fakeFetchInProgress = v; },
        addFetchedMonths(keys)       { _addMonthsHistory.push([...keys]); },
        clearFetchedMonth(key)       { _clearMonthsHistory.push(key); },
        monthKey:                    (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`,
        fetchOverridesForRange:      (...args) => _fetchImpl(...args),
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

function setupDOM() {
    _header = makeEl('div');
    _header.className = 'calendar-header';
    _calGrid = makeEl('div');
    _docListeners = {};
    global.document = {
        createElement: tag => makeEl(tag),
        getElementById: id  => id === 'calendarDisplay' ? _calGrid : null,
        querySelector:  sel => sel === '.calendar-header' ? _header : null,
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
        t.mock.timers.tick(800);
        t.mock.timers.tick(9200);

        // Retry is now shown. Make the retry succeed.
        const chip = getSyncChip();
        _fetchImpl = () => Promise.resolve();
        chip._fire('click');
        await flushAsync(); // retry resolves → chip removed

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
