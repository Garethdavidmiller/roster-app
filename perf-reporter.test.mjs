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
global.performance = /** @type {any} */ ({ getEntriesByType: () => [] });
// PerformanceObserver intentionally left undefined → recordFcp skips cleanly.

const { recordPageLatency, markLoginStart, clearLoginStart } = await import('./perf-reporter.js');
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
    /** @param {any} navEntry @param {number|null} markMs */
    function stubPerformance(navEntry, markMs) {
        global.performance = /** @type {any} */ ({
            getEntriesByType: (/** @type {string} */ t) => t === 'navigation' && navEntry ? [navEntry] : [],
            getEntriesByName: (/** @type {string} */ n) =>
                n === 'myb-sdk-ready' && markMs != null ? [{ startTime: markMs }] : [],
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
