/**
 * Unit tests for perf-reporter.js — the WRITE-TIME ADMIN EXCLUSION and the one-shot login marker,
 * which keep the developer's own loads out of the App Speed figures while still consuming the login
 * marker (so an excluded sign-in can't mis-time a later staff load). The pure bucketing maths lives
 * in perf-stats.test.mjs; the reporter's decision layer was untested.
 *
 * Run: node --experimental-test-module-mocks --test perf-reporter.test.mjs
 */
import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

/** @type {any[]} */ let _samples = [];
const _ss = new Map();

mock.module('./firebase-client.js', {
    namedExports: { recordPerfSample: (/** @type {any} */ s) => { _samples.push(s); } },
});
mock.module('./roster-data.js', {
    namedExports: { CONFIG: { ADMIN_NAMES: ['G. Miller'] } },
});

// Minimal browser stubs. No navigation/paint entries → only the login sample can be recorded, which
// isolates exactly the admin-exclusion + one-shot-marker behaviour under test.
global.sessionStorage = /** @type {any} */ ({
    getItem: k => _ss.has(k) ? _ss.get(k) : null,
    setItem: (k, v) => { _ss.set(k, String(v)); },
    removeItem: k => { _ss.delete(k); },
});
global.window = /** @type {any} */ ({ matchMedia: () => ({ matches: false }) });
// global.navigator is a read-only getter in modern Node — define it instead of assigning.
Object.defineProperty(global, 'navigator', { value: /** @type {any} */ ({}), configurable: true });
// A working MARK table (v21.16): `markPageReady` writes here and the deferred `ready` recorder reads
// it back. Still no navigation/paint entries, which is deliberate — it proves the `ready` path does
// not depend on Navigation Timing, the guard it used to sit behind.
/** @type {Map<string, any>} */
const _marks = new Map();
global.performance = /** @type {any} */ ({
    getEntriesByType: () => [],
    getEntriesByName: (/** @type {string} */ n) => (_marks.has(n) ? [_marks.get(n)] : []),
    mark: (/** @type {string} */ n) => { _marks.set(n, { name: n, startTime: 640 }); },
});
// PerformanceObserver intentionally left undefined → recordFcp skips cleanly.

const { recordPageLatency, markLoginStart, clearLoginStart, markPageReady, PAGE_READY_MARK } =
    await import('./perf-reporter.js');
const LOGIN_KEY = 'myb_perf_login_t0';

beforeEach(() => { _samples = []; _ss.clear(); });

describe('markLoginStart / clearLoginStart', () => {
    test('markLoginStart stamps the session marker; clearLoginStart removes it', () => {
        markLoginStart();
        assert.equal(_ss.has(LOGIN_KEY), true);
        clearLoginStart();
        assert.equal(_ss.has(LOGIN_KEY), false);
    });
});

describe('recordPageLatency — admin exclusion + one-shot login marker', () => {
    test('an ADMIN session records NOTHING but STILL consumes the login marker', () => {
        _ss.set(LOGIN_KEY, String(Date.now() - 1000));  // a sign-in happened this session
        recordPageLatency('paycalc', 'G. Miller');
        assert.deepEqual(_samples, [], 'developer session records no perf samples');
        assert.equal(_ss.has(LOGIN_KEY), false, 'marker consumed so it cannot mis-time a later staff load');
    });

    test('a real staff member records the login-total sample and clears the marker', () => {
        _ss.set(LOGIN_KEY, String(Date.now() - 1200));
        recordPageLatency('paycalc', 'S. Silva');
        const login = _samples.find(s => s.page === 'login');
        assert.ok(login, 'login timing recorded for a real staff sign-in');
        assert.equal(login.metric, 'loginTotal');
        assert.equal(_ss.has(LOGIN_KEY), false, 'one-shot: marker cleared after recording');
    });

    test('no login marker → no login sample (and no throw with no nav/paint timing)', () => {
        recordPageLatency('calendar', 'S. Silva');
        assert.equal(_samples.find(s => s.page === 'login'), undefined);
    });

    test('a null identity (anonymous) is NOT excluded — it would record if timing existed', () => {
        _ss.set(LOGIN_KEY, String(Date.now() - 800));
        recordPageLatency('calendar', null);
        assert.ok(_samples.find(s => s.page === 'login'), 'anonymous is a real session, not the developer');
    });
});

describe('recordPageLatency — boot phases (v20.33)', () => {
    // Swap in a performance stub carrying a navigation entry and (optionally) the SDK-ready mark.
    // The phase SPLIT itself is pure and tested in perf-stats.test.mjs; what's under test here is
    // the reporter's WIRING — that the mark is read, the spans reach recordPerfSample as their own
    // metrics, and an absent mark or SW degrades to fewer samples rather than wrong ones.
    const nav = { responseStart: 220, domContentLoadedEventEnd: 1600, workerStart: 40 };
    /** @param {any} navEntry @param {number|null} markMs @param {number|null} [readyMs] */
    function stubPerformance(navEntry, markMs, readyMs = null) {
        global.performance = /** @type {any} */ ({
            getEntriesByType: (/** @type {string} */ t) => t === 'navigation' && navEntry ? [navEntry] : [],
            getEntriesByName: (/** @type {string} */ n) => {
                if (n === 'myb-sdk-ready' && markMs != null) return [{ startTime: markMs }];
                if (n === PAGE_READY_MARK && readyMs != null) return [{ startTime: readyMs }];
                return [];
            },
        });
    }

    test('records all three phase spans alongside ttfb/domReady', () => {
        stubPerformance(nav, 1100);
        recordPageLatency('calendar', 'S. Silva');
        const byMetric = Object.fromEntries(_samples.map(s => [s.metric, s]));
        assert.equal(byMetric.swBoot?.bucket,  'lt500ms');   // 180ms
        assert.equal(byMetric.sdkLoad?.bucket, '500ms-1s');  // 880ms
        assert.equal(byMetric.appBoot?.bucket, '500ms-1s');  // 500ms
        assert.equal(byMetric.swBoot?.page, 'calendar', 'phases carry the page dimension like every metric');
        assert.ok(byMetric.ttfb && byMetric.domReady, 'the existing metrics still record beside the phases');
    });

    test('no SDK mark → nav-only metrics record, mark-based phases are absent', () => {
        stubPerformance(nav, null);
        recordPageLatency('calendar', 'S. Silva');
        const metrics = _samples.map(s => s.metric);
        assert.ok(metrics.includes('swBoot'), 'the SW span needs no mark');
        assert.ok(!metrics.includes('sdkLoad') && !metrics.includes('appBoot'),
            'a missing mark must drop the spans it defines — recording them from garbage would be worse than a gap');
    });

    test('no service worker (workerStart 0) → no swBoot sample', () => {
        stubPerformance({ ...nav, workerStart: 0 }, 1100);
        recordPageLatency('calendar', 'S. Silva');
        assert.ok(!_samples.some(s => s.metric === 'swBoot'),
            'a first visit has no SW wake to measure — a fabricated span would flatter or smear it');
        assert.ok(_samples.some(s => s.metric === 'sdkLoad'), 'mark-based spans unaffected');
    });

    test('admin exclusion covers the phases too', () => {
        stubPerformance(nav, 1100);
        recordPageLatency('calendar', 'G. Miller');
        assert.deepEqual(_samples, [], 'the developer’s own boot phases must not pollute the diagnosis');
    });
});


describe('the READY milestone (v20.80)', () => {
    // ── WHY THIS METRIC EXISTS, AND WHY THE TESTS ARE SHAPED LIKE THIS ──────────────────────────
    //
    // The card's two page metrics stopped describing what their labels claim the moment the v20.12
    // access gate landed: `fcp` is the splash painting, and `domReady` fires while the Calendar can
    // still be blank (measured — fcp 512ms, domReady 669ms, roster on screen 2630ms). So the ONE
    // thing worth pinning is that `ready` is genuinely INDEPENDENT of `domReady`: a fabricated
    // fallback would put the very number this metric exists to contradict under its label, and no
    // assertion about buckets or wiring would notice.
    const nav = { responseStart: 220, domContentLoadedEventEnd: 700, workerStart: 40 };
    /** @param {any} navEntry @param {number|null} markMs @param {number|null} readyMs */
    function stubPerformance(navEntry, markMs, readyMs) {
        global.performance = /** @type {any} */ ({
            getEntriesByType: (/** @type {string} */ t) => t === 'navigation' && navEntry ? [navEntry] : [],
            getEntriesByName: (/** @type {string} */ n) => {
                if (n === 'myb-sdk-ready' && markMs != null) return [{ startTime: markMs }];
                if (n === PAGE_READY_MARK && readyMs != null) return [{ startTime: readyMs }];
                return [];
            },
        });
    }

    test('a page that never marks records NO ready sample — absent, never borrowed from domReady', () => {
        stubPerformance(nav, 500, null);
        recordPageLatency('paycalc', 'S. Silva');
        const metrics = _samples.map(s => s.metric);
        assert.ok(metrics.includes('domReady'), 'the existing metrics are unaffected');
        assert.ok(!metrics.includes('ready'),
            'a missing milestone must be a GAP — falling back to domReady would republish the exact ' +
            'number this metric exists to contradict, under a label that says it is something else');
    });

    test('the mark is recorded as its own metric, and it is NOT domReady', () => {
        // The real shape: DCL at 700ms while the roster arrives at 2630ms. Different metric,
        // different BUCKET — a test where the two agreed would pass on a fallback implementation.
        stubPerformance(nav, 500, 2630);
        recordPageLatency('calendar', 'S. Silva');
        const byMetric = Object.fromEntries(_samples.map(s => [s.metric, s]));
        assert.equal(byMetric.ready?.bucket, '1-3s');
        assert.equal(byMetric.domReady?.bucket, '500ms-1s');
        assert.equal(byMetric.ready?.page, 'calendar', 'it carries the page dimension like every metric');
    });

    test('an ADMIN session records no ready sample either', () => {
        stubPerformance(nav, 500, 2630);
        recordPageLatency('calendar', 'G. Miller');
        assert.deepEqual(_samples, []);
    });

    test('markPageReady is idempotent — a re-render must not re-time the page', () => {
        /** @type {string[]} */ const marked = [];
        global.performance = /** @type {any} */ ({
            getEntriesByType: () => [],
            getEntriesByName: (/** @type {string} */ n) =>
                n === PAGE_READY_MARK ? marked.map(() => ({ startTime: 1 })) : [],
            mark: (/** @type {string} */ n) => { marked.push(n); },
        });
        markPageReady();
        markPageReady();
        assert.deepEqual(marked, [PAGE_READY_MARK]);
    });

    test('markPageReady is silent where the Performance API is missing', () => {
        global.performance = /** @type {any} */ ({});
        assert.doesNotThrow(() => markPageReady());
    });
});

describe('the `usable` milestone survives losing the race (v21.16)', async () => {
    // A FRESH MODULE INSTANCE, deliberately. The "page is ready" signal is a one-shot promise scoped
    // to the module — exactly right in a browser, where one instance serves one page load, and fatal
    // to a test that shares a process with the idempotency test above, which marks the page and
    // resolves it first. Importing under a distinct specifier gives this block its own unresolved
    // signal, so these tests do not depend on where they sit in the file. The `mock.module` stubs
    // are keyed on the DEPENDENCY specifier, which resolves identically from either instance.
    const fresh = await import('./perf-reporter.js?fresh=usable');
    const { recordPageLatency, markPageReady } = fresh;

    // Earlier tests swap `global.performance` for their own stubs (one replaces it with `{}` to
    // prove the reporter is silent without the API), so reinstall the mark table here rather than
    // trusting whatever the previous test left behind.
    beforeEach(() => {
        _marks.clear();
        global.performance = /** @type {any} */ ({
            getEntriesByType: () => [],
            getEntriesByName: (/** @type {string} */ n) => (_marks.has(n) ? [_marks.get(n)] : []),
            mark: (/** @type {string} */ n) => { _marks.set(n, { name: n, startTime: 640 }); },
        });
    });

    // ── WHAT THIS PINS ──────────────────────────────────────────────────────────────────────────
    //
    // `recordPageLatency` reads the mark table at the instant it is called. On the Calendar the mark
    // is written by a DIFFERENT promise chain — the first grid render — and nothing orders the two,
    // so whether a load contributed a `usable` sample was decided by which chain finished first.
    //
    // Measured on a real month: three pages mark themselves ready and took 1,044 opens between them;
    // 218 `ready` samples were recorded. Four loads in five were dropped, and the survivors were
    // whichever ones happened to win a race — so the figure could not be read in either direction.
    //
    // The order below is the one that used to lose. `markPageReady` is called AFTER
    // `recordPageLatency` has already returned, which is the whole point.
    test('a mark that arrives AFTER the reading still records', async () => {
        _marks.clear();
        recordPageLatency('calendar', 'S. Silva');
        assert.equal(_samples.find(s => s.metric === 'ready'), undefined,
            'nothing to record yet — the page is not ready');

        markPageReady();
        await Promise.resolve();   // let the deferred recorder run

        const ready = _samples.find(s => s.metric === 'ready');
        assert.ok(ready, 'the load contributes its `usable` sample once the page IS ready');
        assert.equal(ready.page, 'calendar', 'attributed to the page that was loading');
        assert.equal(ready.bucket, '500ms-1s', 'bucketed from the mark, not from when it was noticed');
    });

    test('and it is recorded ONCE, not once per waiting page', async () => {
        // The mark is process-wide and resolves a single promise. A second `recordPageLatency` on
        // the same load must not produce a second sample from the same mark — that would inflate the
        // very metric this fix exists to make readable.
        markPageReady();                       // the page is ALREADY ready before the reading
        recordPageLatency('calendar', 'S. Silva');
        await Promise.resolve();
        assert.equal(_samples.filter(s => s.metric === 'ready').length, 1,
            'the mark already existed, so it is read inline — not deferred a second time');
    });

    test('an ADMIN load records no `ready`, deferred or otherwise', async () => {
        // The write-time developer exclusion has to survive the deferral. Recording it late would be
        // a hole in an exclusion that every other metric on this card honours.
        _samples.length = 0;
        recordPageLatency('calendar', 'G. Miller');
        markPageReady();
        await Promise.resolve();
        assert.deepEqual(_samples, [], 'the developer\'s own load is excluded at every point');
    });
});

// ── WHAT SERVED THE FIRST GRID (v21.99) ─────────────────────────────────────────────────────────
//
// This split exists to make ONE decision decidable: `LATENCY_PLAN.md` Phase 2 narrows the Calendar's
// authoritative Firestore read, and its whole value rests on how many loads reach a grid THROUGH
// that read rather than from the local cache. A cache-served load never touches the network on this
// path, so narrowing the read cannot move it at all.
//
// Organised by the two ways the attribution can lie. Reporting a cache-served load as fetch-served
// makes Phase 2 look worth doing on evidence about loads it cannot help — the expensive mistake,
// because the work is a rewrite of the read path with a documented eviction trap. Losing the
// attribution entirely leaves the plan where it already was, arguing.
describe('the `ready` sample says what served the grid', () => {
    // ONE MODULE INSTANCE PER CASE, and that is not ceremony. The source is module state written by
    // the first `markPageReady` and deliberately never rewritten — a later render reaching a
    // better-known state must not re-attribute the FIRST grid's timing. Sharing an instance would
    // therefore carry the previous test's source into the next one, and the two cases below that
    // assert an ABSENCE would pass or fail on where they sit in the file.
    const load = async (/** @type {string} */ tag) => {
        _marks.clear();
        _samples.length = 0;
        global.performance = /** @type {any} */ ({
            getEntriesByType: () => [],
            getEntriesByName: (/** @type {string} */ n) => (_marks.has(n) ? [_marks.get(n)] : []),
            mark: (/** @type {string} */ n) => { _marks.set(n, { name: n, startTime: 640 }); },
        });
        return import(`./perf-reporter.js?fresh=rs-${tag}`);
    };

    test('a cache-served grid is attributed to the cache, and still counted in `ready`', async () => {
        const { recordPageLatency, markPageReady } = await load('cached');
        recordPageLatency('calendar', 'S. Silva');
        markPageReady('cached');
        await Promise.resolve();
        const metrics = _samples.map(s => s.metric);
        assert.ok(metrics.includes('ready'), '`ready` must keep counting every load — its history is continuous');
        assert.ok(metrics.includes('readyCached'));
        assert.ok(!metrics.includes('readyFetched'), 'a cache hit is not a fetch');
    });

    test('both samples carry the SAME bucket — one reading, two names', async () => {
        // If they could differ, the split would not be a split: the card would be comparing two
        // different measurements and calling the difference a cache effect.
        const { recordPageLatency, markPageReady } = await load('bucket');
        recordPageLatency('calendar', 'S. Silva');
        markPageReady('fetched');
        await Promise.resolve();
        const ready = _samples.find(s => s.metric === 'ready');
        const attributed = _samples.find(s => s.metric === 'readyFetched');
        assert.ok(ready && attributed);
        assert.equal(attributed.bucket, ready.bucket);
        assert.equal(attributed.page, ready.page);
    });

    test('a page that does not know its source reports `ready` alone', async () => {
        // The three pages whose `.container` unhides on `auth-ready` call `markPageReady()` with no
        // argument. Inventing a source for them would put loads with no cache path at all into a
        // cache-versus-network comparison.
        const { recordPageLatency, markPageReady } = await load('none');
        recordPageLatency('settings', 'S. Silva');
        markPageReady();
        await Promise.resolve();
        const metrics = _samples.map(s => s.metric);
        assert.ok(metrics.includes('ready'));
        assert.ok(!metrics.some(m => m.startsWith('readyC') || m.startsWith('readyF')),
            'an unknown source must not be guessed at');
    });

    test('a nonsense source is ignored rather than stored', async () => {
        const { recordPageLatency, markPageReady } = await load('junk');
        recordPageLatency('calendar', 'S. Silva');
        markPageReady(/** @type {any} */ ('probably-cached'));
        await Promise.resolve();
        assert.ok(_samples.some(s => s.metric === 'ready'));
        assert.ok(!_samples.some(s => /^ready[CF]/.test(s.metric)));
    });

    test('the FIRST grid decides the source, not a later re-render', async () => {
        // The Calendar renders again the moment phase 2 lands, and that render is authoritative. If
        // the later call could overwrite the source, every cache-served load would end up filed as
        // fetch-served — which is the answer this whole split exists to avoid getting backwards, and
        // it would make Phase 2 look worth doing on evidence about loads it cannot help.
        const { recordPageLatency, markPageReady } = await load('first-wins');
        recordPageLatency('calendar', 'S. Silva');
        markPageReady('cached');
        markPageReady('fetched');
        await Promise.resolve();
        assert.ok(_samples.some(s2 => s2.metric === 'readyCached'));
        assert.ok(!_samples.some(s2 => s2.metric === 'readyFetched'));
    });
});

// ── OPENS A RELEASE CAUSED (v22.91) ─────────────────────────────────────────────────────────────
//
// v22.90 deferred the update reload so a release stops interrupting a member mid-read. It shipped
// with the cost it removes UNMEASURED, and this marker is the measurement.
//
// Organised by what a wrong answer costs, and the directions are not equal. A FALSE POSITIVE — an
// ordinary open filed as an update open — inflates the one number the fix is judged on, using
// somebody's slow morning as evidence for work that was already done. It is also the reachable one,
// because the marker is written before the reload is certain: links' confirm offers Cancel, and a
// flag left behind would attribute whatever that tab loaded next. A MISS only under-reports, and
// under-reporting a cost that has already been removed costs nothing but the argument.
//
// The one-shot rule is the same as the login marker's, and it exists for the same reason in reverse:
// the marker is ALWAYS cleared, and recorded only when the session is not the developer's.
describe('the `ready` sample says whether a release caused the open', () => {
    const SW_KEY = 'myb_perf_sw_reload';
    // Fresh instance per case, for the same reason the block above needs one: `_readySource` is
    // module state, and these cases drive `markPageReady` too.
    const load = async (/** @type {string} */ tag) => {
        _marks.clear();
        _samples.length = 0;
        _ss.clear();
        global.performance = /** @type {any} */ ({
            getEntriesByType: () => [],
            getEntriesByName: (/** @type {string} */ n) => (_marks.has(n) ? [_marks.get(n)] : []),
            mark: (/** @type {string} */ n) => { _marks.set(n, { name: n, startTime: 640 }); },
        });
        return import(`./perf-reporter.js?fresh=up-${tag}`);
    };

    test('a fresh marker records `readyUpdate` BESIDE `ready`, never instead of it', async () => {
        // Beside, because the share is a division: `ready` has to keep counting every open or the
        // denominator moves with the numerator and the percentage is meaningless.
        const { recordPageLatency, markPageReady } = await load('fresh');
        _ss.set(SW_KEY, String(Date.now() - 300));
        recordPageLatency('calendar', 'S. Silva');
        markPageReady('cached');
        await Promise.resolve();
        const metrics = _samples.map(s => s.metric);
        assert.ok(metrics.includes('ready'), '`ready` still counts this open');
        assert.ok(metrics.includes('readyUpdate'));
    });

    test('both samples carry the SAME bucket and page — one reading, two names', async () => {
        // If they could differ, the row would be comparing a different measurement to the one it is
        // presented as a subset of, and the card's share sentence would be arithmetic over two
        // populations.
        const { recordPageLatency, markPageReady } = await load('bucket');
        _ss.set(SW_KEY, String(Date.now() - 300));
        recordPageLatency('calendar', 'S. Silva');
        markPageReady('fetched');
        await Promise.resolve();
        const ready = _samples.find(s => s.metric === 'ready');
        const upd = _samples.find(s => s.metric === 'readyUpdate');
        assert.ok(ready && upd);
        assert.equal(upd.bucket, ready.bucket);
        assert.equal(upd.page, ready.page);
        assert.equal(upd.conn, ready.conn);
        assert.equal(upd.mode, ready.mode);
    });

    test('an ordinary open — no marker — is NOT an update open', async () => {
        const { recordPageLatency, markPageReady } = await load('none');
        recordPageLatency('calendar', 'S. Silva');
        markPageReady('cached');
        await Promise.resolve();
        assert.ok(_samples.some(s => s.metric === 'ready'));
        assert.ok(!_samples.some(s => s.metric === 'readyUpdate'),
            'nothing said a release caused this, so nothing may claim one did');
    });

    test('a STALE marker is refused — the declined-confirm case', async () => {
        // The reachable false positive. sw-register writes the marker before calling beforeReload,
        // and links' beforeReload can be declined; the marker then survives until that tab navigates
        // somewhere else, minutes or hours later. Refusing it is the whole reason it is a timestamp
        // and not a flag.
        const { recordPageLatency, markPageReady } = await load('stale');
        _ss.set(SW_KEY, String(Date.now() - 10 * 60 * 1000));
        recordPageLatency('calendar', 'S. Silva');
        markPageReady('cached');
        await Promise.resolve();
        assert.ok(_samples.some(s => s.metric === 'ready'));
        assert.ok(!_samples.some(s => s.metric === 'readyUpdate'));
        assert.equal(_ss.has(SW_KEY), false, 'and it is cleared, not left to go on being refused');
    });

    test('a marker from the FUTURE is refused rather than treated as instant', async () => {
        // A device whose clock jumped back between the write and the read. `now - t` is then
        // negative, which is smaller than the bound — so a naive one-sided comparison accepts it.
        const { recordPageLatency, markPageReady } = await load('future');
        _ss.set(SW_KEY, String(Date.now() + 5 * 60 * 1000));
        recordPageLatency('calendar', 'S. Silva');
        markPageReady('cached');
        await Promise.resolve();
        assert.ok(!_samples.some(s => s.metric === 'readyUpdate'));
    });

    test('the marker is ONE-SHOT: the open after the update open is ordinary', async () => {
        // Left in place it would mark every subsequent open in that tab, and the share would climb
        // towards 100% on a device that simply never closed the app.
        const { recordPageLatency, markPageReady } = await load('oneshot');
        _ss.set(SW_KEY, String(Date.now() - 300));
        recordPageLatency('calendar', 'S. Silva');
        markPageReady('cached');
        await Promise.resolve();
        assert.equal(_ss.has(SW_KEY), false);
        _samples.length = 0;
        const next = await load('oneshot-2');
        next.recordPageLatency('calendar', 'S. Silva');
        next.markPageReady('cached');
        await Promise.resolve();
        assert.ok(!_samples.some(s => s.metric === 'readyUpdate'));
    });

    test('an ADMIN reload records nothing but STILL consumes the marker', async () => {
        // Exactly the login marker's rule, and it bites harder here: the developer is the one person
        // who reloads onto a release constantly. A marker left behind by an excluded load would
        // attribute the next STAFF open on that device to an update that was never theirs.
        const { recordPageLatency, markPageReady } = await load('admin');
        _ss.set(SW_KEY, String(Date.now() - 300));
        recordPageLatency('calendar', 'G. Miller');
        markPageReady('cached');
        await Promise.resolve();
        assert.deepEqual(_samples, []);
        assert.equal(_ss.has(SW_KEY), false, 'consumed, so it cannot mis-attribute a later staff load');
    });
});
