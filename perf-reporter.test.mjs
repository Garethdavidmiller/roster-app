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
