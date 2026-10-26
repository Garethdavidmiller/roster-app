/**
 * Unit tests for perf-reporter.js — what a page open records, and above all what it must NOT.
 *
 * The App Speed review (Oct 2026) found two kinds of time in the figures that were nobody waiting
 * for the app: loads nobody was watching (the Calendar's release reload runs while the page is
 * hidden, by design) and time a person spent typing a password or the staff PIN. Both are excluded
 * now, and both exclusions are the kind of rule a later edit breaks without any figure looking wrong
 * — a hidden load still produces a perfectly plausible bucket. So most cases below drive the real
 * production path with a page that hides, loads hidden, or waits for typing, and assert ABSENCE.
 *
 * The pure bucketing maths lives in perf-stats.test.mjs.
 *
 * Run: node --experimental-test-module-mocks --test perf-reporter.test.mjs
 */
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

/** @type {any[]} */ const _samples = [];
const _ss = new Map();

mock.module('./firebase-client.js', {
    namedExports: { recordPerfSample: (/** @type {any} */ s) => { _samples.push(s); } },
});
mock.module('./roster-data.js', {
    namedExports: { CONFIG: { ADMIN_NAMES: ['G. Miller'] } },
});

global.sessionStorage = /** @type {any} */ ({
    getItem: k => _ss.has(k) ? _ss.get(k) : null,
    setItem: (k, v) => { _ss.set(k, String(v)); },
    removeItem: k => { _ss.delete(k); },
});

const LOGIN_KEY = 'myb_perf_login_t0';
const SW_KEY = 'myb_perf_sw_reload';
/** Epoch ms at which every simulated load starts (`performance.timeOrigin`). */
const T = 1_790_000_000_000;

/** The simulated `performance.now()` — milliseconds into the load. */
const clock = { now: 0 };
/** @type {Map<string, any>} */ const _marks = new Map();
/** @type {Record<string, Function[]>} */ let _docListeners = {};
/** @type {Function[]} */ let _rafQueue = [];
/** @type {any} */ let doc = null;

/**
 * A FRESH MODULE INSTANCE per case, with the page's environment in place BEFORE it is imported. The
 * visibility watcher reads `document` at import, and `ready`, the first-visible moment and the typing
 * gate are one-shot module state — right in a browser, where one instance serves one page load, and
 * fatal to tests sharing one. The `mock.module` stubs are keyed on the dependency's resolved URL, so
 * every instance gets them.
 * @param {string} tag
 * @param {{ hidden?: boolean, prerendering?: boolean, nav?: any, paint?: number|null, visTimeline?: any[]|null,
 *           raf?: boolean, standalone?: boolean, conn?: string, readyState?: string }} [env]
 */
async function load(tag, env = {}) {
    const { hidden = false, prerendering = false, nav = null, paint = null, visTimeline = null,
        raf = false, standalone = false, conn, readyState = 'complete' } = env;
    _samples.length = 0; _ss.clear(); _marks.clear(); _docListeners = {}; _rafQueue = [];
    clock.now = 0;
    global.performance = /** @type {any} */ ({
        timeOrigin: T,
        now: () => clock.now,
        getEntriesByType: (/** @type {string} */ t) => {
            if (t === 'navigation') return nav ? [nav] : [];
            if (t === 'paint') return paint != null ? [{ name: 'first-contentful-paint', startTime: paint }] : [];
            if (t === 'visibility-state') return visTimeline || [];
            return [];
        },
        getEntriesByName: (/** @type {string} */ n) => (_marks.has(n) ? [_marks.get(n)] : []),
        mark: (/** @type {string} */ n) => { _marks.set(n, { name: n, startTime: clock.now }); },
    });
    doc = {
        visibilityState: hidden ? 'hidden' : 'visible',
        prerendering,
        readyState,
        addEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => { (_docListeners[type] ||= []).push(fn); },
    };
    global.document = doc;
    global.window = /** @type {any} */ ({ matchMedia: () => ({ matches: standalone }), navigator: {} });
    Object.defineProperty(global, 'navigator', { value: conn ? { connection: { effectiveType: conn } } : {}, configurable: true });
    if (raf) global.requestAnimationFrame = /** @type {any} */ ((/** @type {Function} */ cb) => { _rafQueue.push(cb); return 1; });
    else delete global.requestAnimationFrame;
    return import(`./perf-reporter.js?case=${tag}`);
}

/** The page becomes hidden or visible `at` ms into the load. @param {'hidden'|'visible'} state @param {number} at */
function setVisibility(state, at) {
    clock.now = at;
    doc.visibilityState = state;
    (_docListeners.visibilitychange || []).forEach(f => f());
}
/** Let every deferred recorder run (promise chains, the DCL re-read, the frame wait). */
const settle = () => new Promise(r => setTimeout(r, 0));
const metrics = () => _samples.map(s => s.metric);
const sample = (/** @type {string} */ m) => _samples.find(s => s.metric === m);

describe('markLoginStart / clearLoginStart', () => {
    test('markLoginStart stamps the session marker; clearLoginStart removes it', async () => {
        const { markLoginStart, clearLoginStart } = await load('login-marker');
        markLoginStart();
        assert.equal(_ss.has(LOGIN_KEY), true);
        clearLoginStart();
        assert.equal(_ss.has(LOGIN_KEY), false);
    });
});

describe('the developer\'s own loads are excluded at every point', () => {
    test('an ADMIN load records NOTHING, yet still consumes both one-shot markers', async () => {
        const { recordPageLatency, markPageReady, markMilestone } = await load('admin', { nav: { domContentLoadedEventEnd: 700 }, paint: 300 });
        _ss.set(LOGIN_KEY, String(T - 1000));
        _ss.set(SW_KEY, String(T - 200));
        clock.now = 800;
        markMilestone('rosterSnapshot');
        recordPageLatency('calendar', 'G. Miller');
        clock.now = 2000;
        markPageReady();
        await settle();
        assert.deepEqual(_samples, [], 'no sample of any kind');
        assert.equal(_ss.has(LOGIN_KEY), false, 'so it cannot mis-time a later staff load');
        assert.equal(_ss.has(SW_KEY), false, 'so it cannot mis-label a later staff load');
    });

    test('a load with no name (the staff PIN) is a staff load, not the developer\'s', async () => {
        const { recordPageLatency, markPageReady } = await load('pin');
        recordPageLatency('calendar', null);
        clock.now = 900;
        markPageReady();
        await settle();
        assert.ok(sample('ready'));
    });
});

describe('`ready` — the page usable, timed from the start of the load', () => {
    test('it is its own metric, and it is NOT domReady', async () => {
        // The real shape: the code loaded at 700ms, the roster on screen at 2630ms. A fallback to
        // domReady would republish the very number this metric exists to contradict.
        const { recordPageLatency, markPageReady } = await load('ready-own', { nav: { domContentLoadedEventEnd: 700 } });
        recordPageLatency('calendar', 'S. Silva');
        clock.now = 2630;
        markPageReady();
        await settle();
        assert.equal(sample('ready')?.bucket, '1-3s');
        assert.equal(sample('domReady')?.bucket, '500ms-1s');
        assert.equal(sample('ready')?.page, 'calendar');
    });

    test('a mark that arrives AFTER the reading still records (v21.16)', async () => {
        const { recordPageLatency, markPageReady } = await load('ready-late');
        recordPageLatency('calendar', 'S. Silva');
        await settle();
        assert.equal(sample('ready'), undefined, 'nothing to record yet');
        clock.now = 640;
        markPageReady();
        await settle();
        assert.equal(sample('ready')?.bucket, '500ms-1s', 'bucketed from the mark, not from when it was noticed');
    });

    test('a page that never marks records no `ready` — a gap, never a borrowed figure', async () => {
        const { recordPageLatency } = await load('ready-none', { nav: { domContentLoadedEventEnd: 700 } });
        recordPageLatency('paycalc', 'S. Silva');
        await settle();
        assert.ok(metrics().includes('domReady'));
        assert.ok(!metrics().includes('ready'));
    });

    test('markPageReady is idempotent, and a re-render cannot re-time the page', async () => {
        const { recordPageLatency, markPageReady } = await load('ready-once');
        clock.now = 500;
        markPageReady();
        clock.now = 4000;
        markPageReady();
        recordPageLatency('calendar', 'S. Silva');
        await settle();
        assert.equal(_samples.filter(s => s.metric === 'ready').length, 1);
        assert.equal(sample('ready').bucket, '500ms-1s', 'the FIRST call decided it');
    });

    test('markPageReady is silent where the Performance API is missing', async () => {
        const { markPageReady } = await load('ready-noapi');
        global.performance = /** @type {any} */ ({});
        assert.doesNotThrow(() => markPageReady());
    });

    test('it stamps after the frame that SHOWS the page, not before it is drawn', async () => {
        // Four pages marked ready with synchronous work still to run in the same task, so the mark
        // landed before the screen did. A visible page now waits for a frame and one more turn.
        const { markPageReady } = await load('ready-frame', { raf: true });
        clock.now = 300;
        markPageReady();
        assert.equal(_marks.size, 0, 'nothing stamped while the frame is pending');
        clock.now = 316;
        _rafQueue.forEach(cb => cb());
        await settle();
        assert.equal(_marks.get('myb-page-ready')?.startTime, 316);
    });

    test('a hidden page draws no frames, so it stamps at once', async () => {
        const { markPageReady } = await load('ready-hidden-stamp', { raf: true, hidden: true });
        clock.now = 300;
        markPageReady();
        assert.equal(_marks.get('myb-page-ready')?.startTime, 300);
    });
});

describe('a load nobody was watching records no timings (App Speed review, Oct 2026)', () => {
    test('a page that LOADED hidden — the Calendar\'s release reload — records none of the ordinary metrics', async () => {
        const { recordPageLatency, markPageReady, markMilestone } = await load('hidden-load',
            { hidden: true, nav: { domContentLoadedEventEnd: 900 }, paint: 400 });
        clock.now = 1200;
        markMilestone('rosterSnapshot');
        recordPageLatency('calendar', 'S. Silva');
        clock.now = 2500;
        markPageReady();
        await settle();
        assert.deepEqual(metrics(), [], 'a hidden page is slowed or frozen by the phone — its times measure the absence');
    });

    test('a page hidden part-way records what came before, and nothing after', async () => {
        const { recordPageLatency, markPageReady } = await load('hidden-mid',
            { nav: { domContentLoadedEventEnd: 700 }, paint: 300 });
        recordPageLatency('calendar', 'S. Silva');
        setVisibility('hidden', 1000);
        clock.now = 9000;
        markPageReady();                        // stamped while hidden
        setVisibility('visible', 9500);
        await settle();
        assert.ok(metrics().includes('fcp') && metrics().includes('domReady'), 'both landed while somebody watched');
        assert.ok(!metrics().includes('ready'), 'usable came after the page was hidden');
    });

    test('a hide BEFORE the module ran is read back from the browser\'s visibility timeline', async () => {
        const { recordPageLatency, markPageReady } = await load('hidden-early', {
            paint: 30, nav: { domContentLoadedEventEnd: 600 },
            visTimeline: [{ name: 'visible', startTime: 0 }, { name: 'hidden', startTime: 50 }],
        });
        recordPageLatency('calendar', 'S. Silva');
        clock.now = 800;
        markPageReady();
        await settle();
        assert.deepEqual(metrics(), ['fcp'], 'only the paint at 30ms came before the hide at 50ms');
    });

    test('a Chrome PRERENDER is left out by the same rule', async () => {
        const { recordPageLatency, markPageReady } = await load('prerender',
            { prerendering: true, nav: { domContentLoadedEventEnd: 600 }, paint: 200 });
        recordPageLatency('calendar', 'S. Silva');
        clock.now = 900;
        markPageReady();
        await settle();
        assert.deepEqual(metrics(), []);
    });
});

describe('time spent typing is not load time (App Speed review, Oct 2026)', () => {
    test('a page that asked somebody to type before it was usable records no `ready`', async () => {
        // The staff PIN unlocks the Calendar without a reload, and six pages sign in on the page:
        // `ready` used to include reading the card and typing.
        const { recordPageLatency, markPageReady, markAwaitingInput } = await load('typed',
            { nav: { domContentLoadedEventEnd: 700 }, paint: 300 });
        recordPageLatency('calendar', null);
        clock.now = 900;
        markAwaitingInput();
        clock.now = 14000;
        markPageReady();
        await settle();
        assert.ok(!metrics().includes('ready'));
        assert.ok(metrics().includes('fcp') && metrics().includes('domReady'), 'neither can include typing, so both are kept');
    });

    test('a sign-in form that appears AFTER the page was usable does not drop it', async () => {
        const { recordPageLatency, markPageReady, markAwaitingInput } = await load('typed-after');
        recordPageLatency('settings', 'S. Silva');
        clock.now = 700;
        markPageReady();
        clock.now = 900;
        markAwaitingInput();
        await settle();
        assert.equal(sample('ready')?.bucket, '500ms-1s');
    });

    test('the FIRST request to type is the one that counts', async () => {
        const { recordPageLatency, markPageReady, markAwaitingInput } = await load('typed-first');
        recordPageLatency('calendar', null);
        clock.now = 400;
        markAwaitingInput();
        clock.now = 5000;
        markAwaitingInput();                    // a second card later must not move the gate
        clock.now = 2000;
        markPageReady();
        await settle();
        assert.ok(!metrics().includes('ready'), 'usable at 2s came after the first card at 400ms');
    });

    test('the stored-copy paint is held to the same rule', async () => {
        const { recordPageLatency, markMilestone, markAwaitingInput } = await load('typed-snapshot');
        recordPageLatency('calendar', null);
        clock.now = 300;
        markAwaitingInput();
        clock.now = 600;
        markMilestone('rosterSnapshot');
        await settle();
        assert.ok(!metrics().includes('rosterSnapshot'));
    });
});

describe('sign-in time ends when the page is USABLE, not when the reading runs', () => {
    test('timed from pressing "Sign in" to the `ready` mark', async () => {
        // Pressed 300ms into the load, usable at 2.6s: 2.3s. Ending at the call (500ms in) would
        // have read 200ms — "quick" for a sign-in that kept somebody waiting over two seconds.
        const { recordPageLatency, markPageReady } = await load('login-ready');
        _ss.set(LOGIN_KEY, String(T + 300));
        clock.now = 500;
        recordPageLatency('admin', 'S. Silva');
        await settle();
        assert.equal(sample('loginTotal'), undefined, 'nothing until the page is usable');
        assert.equal(_ss.has(LOGIN_KEY), false, 'the marker is consumed at once regardless');
        clock.now = 2600;
        markPageReady();
        await settle();
        const login = sample('loginTotal');
        assert.equal(login?.bucket, '1-3s');
        assert.equal(login?.page, 'login', 'one number, not split by destination');
    });

    test('a sign-in whose page was hidden before it was usable is not timed', async () => {
        const { recordPageLatency, markPageReady } = await load('login-hidden');
        _ss.set(LOGIN_KEY, String(T - 200));
        recordPageLatency('admin', 'S. Silva');
        setVisibility('hidden', 1000);
        clock.now = 30000;
        markPageReady();
        await settle();
        assert.equal(sample('loginTotal'), undefined);
    });

    test('an abandoned marker over two minutes old is ignored', async () => {
        const { recordPageLatency, markPageReady } = await load('login-stale');
        _ss.set(LOGIN_KEY, String(T - 3 * 60 * 1000));
        recordPageLatency('admin', 'S. Silva');
        clock.now = 800;
        markPageReady();
        await settle();
        assert.equal(sample('loginTotal'), undefined);
    });

    test('no marker, no sign-in sample', async () => {
        const { recordPageLatency, markPageReady } = await load('login-none');
        recordPageLatency('calendar', 'S. Silva');
        clock.now = 800;
        markPageReady();
        await settle();
        assert.equal(sample('loginTotal'), undefined);
    });
});

describe('after a release — the wait somebody had (App Speed review, Oct 2026)', () => {
    test('a reload watched from its start records `readyUpdate` BESIDE `ready`, from the same reading', async () => {
        const { recordPageLatency, markPageReady } = await load('rel-visible', { standalone: true, conn: '3g' });
        _ss.set(SW_KEY, String(T - 150));
        recordPageLatency('admin', 'S. Silva');
        clock.now = 1800;
        markPageReady();
        await settle();
        const ready = sample('ready'), upd = sample('readyUpdate');
        assert.ok(ready && upd);
        for (const k of ['bucket', 'page', 'mode', 'conn']) assert.equal(upd[k], ready[k], k);
        assert.equal(upd.mode, 'standalone');
        assert.equal(upd.conn, '3g');
    });

    test('a reload that ran while HIDDEN is timed from the member coming back — minutes later', async () => {
        // The marker is compared with when the load STARTED. The old "within a minute of the reading"
        // check dropped the label from exactly these loads, which stay frozen until the member returns.
        const { recordPageLatency, markPageReady } = await load('rel-hidden', { hidden: true });
        _ss.set(SW_KEY, String(T - 200));
        recordPageLatency('calendar', 'S. Silva');
        setVisibility('visible', 300000);       // five minutes away
        clock.now = 300400;
        markPageReady();
        await settle();
        assert.equal(sample('readyUpdate')?.bucket, 'lt500ms', '400ms after they came back');
        assert.equal(sample('ready'), undefined, 'not an ordinary open: nobody watched it load');
    });

    test('ready before they came back is a token instant — the fastest band', async () => {
        const { recordPageLatency, markPageReady } = await load('rel-hidden-ready', { hidden: true });
        _ss.set(SW_KEY, String(T - 100));
        recordPageLatency('calendar', 'S. Silva');
        clock.now = 2000;
        markPageReady();                        // stamped while hidden
        setVisibility('visible', 120000);
        await settle();
        assert.equal(sample('readyUpdate')?.bucket, 'lt500ms');
    });

    test('leaving again before it was usable leaves no wait to report', async () => {
        const { recordPageLatency, markPageReady } = await load('rel-left', { hidden: true });
        _ss.set(SW_KEY, String(T - 100));
        recordPageLatency('calendar', 'S. Silva');
        setVisibility('visible', 1000);
        setVisibility('hidden', 1500);
        clock.now = 3000;
        markPageReady();
        await settle();
        assert.equal(sample('readyUpdate'), undefined);
    });

    test('typing before it was usable leaves no wait to report either', async () => {
        const { recordPageLatency, markPageReady, markAwaitingInput } = await load('rel-typed', { hidden: true });
        _ss.set(SW_KEY, String(T - 100));
        recordPageLatency('calendar', null);
        setVisibility('visible', 1000);
        clock.now = 1100;
        markAwaitingInput();
        clock.now = 9000;
        markPageReady();
        await settle();
        assert.equal(sample('readyUpdate'), undefined);
    });

    test('a marker written well before this load started is refused — the declined-confirm case', async () => {
        const { recordPageLatency, markPageReady } = await load('rel-stale');
        _ss.set(SW_KEY, String(T - 11 * 1000));
        recordPageLatency('calendar', 'S. Silva');
        clock.now = 900;
        markPageReady();
        await settle();
        assert.ok(metrics().includes('ready'));
        assert.ok(!metrics().includes('readyUpdate'));
        assert.equal(_ss.has(SW_KEY), false, 'cleared, not left to go on being refused');
    });

    test('a marker from AFTER the load started is refused, beyond a second of clock slack', async () => {
        let mod = await load('rel-future');
        _ss.set(SW_KEY, String(T + 5000));
        mod.recordPageLatency('calendar', 'S. Silva');
        clock.now = 900;
        mod.markPageReady();
        await settle();
        assert.ok(!metrics().includes('readyUpdate'));

        mod = await load('rel-skew');
        _ss.set(SW_KEY, String(T + 500));
        mod.recordPageLatency('calendar', 'S. Silva');
        clock.now = 900;
        mod.markPageReady();
        await settle();
        assert.ok(metrics().includes('readyUpdate'), 'half a second of skew between the two clocks is allowed');
    });

    test('no marker, no `readyUpdate`; and the marker is one-shot', async () => {
        const { recordPageLatency, markPageReady } = await load('rel-none');
        recordPageLatency('calendar', 'S. Silva');
        clock.now = 900;
        markPageReady();
        await settle();
        assert.ok(!metrics().includes('readyUpdate'));

        const mod = await load('rel-oneshot');
        _ss.set(SW_KEY, String(T - 100));
        mod.recordPageLatency('calendar', 'S. Silva');
        assert.equal(_ss.has(SW_KEY), false, 'consumed by the load it labels');
    });
});

describe('the stored-copy paint (`rosterSnapshot`, v24.85)', () => {
    test('a paint marked before the reading ran is recorded', async () => {
        const { recordPageLatency, markMilestone } = await load('snap-hit');
        clock.now = 350;
        markMilestone('rosterSnapshot');
        recordPageLatency('calendar', 'S. Silva');
        await settle();
        assert.equal(sample('rosterSnapshot')?.bucket, 'lt500ms');
    });

    test('an open with no stored copy has no such moment', async () => {
        const { recordPageLatency } = await load('snap-miss');
        recordPageLatency('calendar', 'S. Silva');
        await settle();
        assert.ok(!metrics().includes('rosterSnapshot'));
    });

    test('the retired rungs cannot be marked any more', async () => {
        const { recordPageLatency, markMilestone } = await load('snap-retired');
        recordPageLatency('calendar', 'S. Silva');
        for (const id of ['authBoot', 'access', 'rosterCached', 'rosterLive']) markMilestone(/** @type {any} */ (id));
        await settle();
        assert.deepEqual(metrics(), []);
    });
});

describe('code loaded and first paint', () => {
    test('`domReady` read too early waits for the event rather than being dropped', async () => {
        // The fastest opens of all lost the metric: called from inside the boot, the field still read 0.
        const nav = { domContentLoadedEventEnd: 0 };
        const { recordPageLatency } = await load('dcl-wait', { nav, readyState: 'loading' });
        recordPageLatency('calendar', 'S. Silva');
        await settle();
        assert.ok(!metrics().includes('domReady'));
        nav.domContentLoadedEventEnd = 420;
        (_docListeners.DOMContentLoaded || []).forEach(f => f());
        await settle();
        assert.equal(sample('domReady')?.bucket, 'lt500ms');
    });

    test('a first paint after the page was hidden is not recorded', async () => {
        const { recordPageLatency } = await load('fcp-hidden', {
            paint: 900, visTimeline: [{ name: 'hidden', startTime: 400 }],
        });
        recordPageLatency('calendar', 'S. Silva');
        await settle();
        assert.ok(!metrics().includes('fcp'));
    });
});

describe('the retired metrics are never written (App Speed review, Oct 2026)', () => {
    test('a full Calendar open writes only the six the card reads', async () => {
        // Navigation Timing carrying everything the boot phases and ttfb were read from, a source
        // passed to markPageReady the old way, and a release marker: none of the retired names may come back.
        const { recordPageLatency, markPageReady, markMilestone } = await load('retired', {
            nav: { responseStart: 220, domContentLoadedEventEnd: 700, workerStart: 40 }, paint: 300,
        });
        _ss.set(LOGIN_KEY, String(T + 100));
        _ss.set(SW_KEY, String(T - 50));
        _marks.set('myb-sdk-ready', { name: 'myb-sdk-ready', startTime: 500 });
        clock.now = 600;
        markMilestone('rosterSnapshot');
        recordPageLatency('calendar', 'S. Silva');
        clock.now = 1500;
        /** @type {any} */ (markPageReady)('cached');
        await settle();
        assert.deepEqual([...new Set(metrics())].sort(),
            ['domReady', 'fcp', 'loginTotal', 'ready', 'readyUpdate', 'rosterSnapshot']);
    });
});
