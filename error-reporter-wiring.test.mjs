// @ts-check
/**
 * error-reporter-wiring.test.mjs — the reporter's WIRING, which error-reporter.test.mjs cannot see.
 * Run: node --experimental-test-module-mocks --test error-reporter-wiring.test.mjs   (part of test:unit)
 *
 * error-reporter.test.mjs pins the noise FILTERS (`shouldReport`, in client-errors.js) from both
 * sides. It never loads error-reporter.js itself — so the module that actually listens for errors,
 * dedups them and writes the record went untested behind a filename that looks like it is covered
 * (module-coverage-parity only counted it named because a COMMENT said so; v24.28 review).
 *
 * "The rule tested, the wiring not" is this repo's named risk, and this module is the textbook
 * shape of it: every filter could be perfect and the Error Log still silent, because the listener
 * was never attached, the filter's verdict was discarded, or a corrupt session blob threw inside
 * the reporter's own catch-all. So this drives `initErrorReporter` through the two window events a
 * browser fires and asserts on the one observable result — the payload handed to logClientError.
 *
 * Only the Firebase write and localStorage are stubbed. `shouldReport` is the REAL filter, so a
 * wiring that stopped consulting it would fail here too.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** @type {any[]} */
const writes = [];
/** @type {string|null} */
let authBlob = null;

mock.module('./firebase-client.js', { namedExports: { logClientError: (/** @type {any} */ rec) => { writes.push(rec); } } });
mock.module('./ls.js', { namedExports: { lsGet: () => authBlob } });
mock.module('./session.js', { namedExports: { AUTH_KEY: 'test_auth_key' } });
mock.module('./roster-data.js', { namedExports: { APP_VERSION: '99.99' } });

/** @type {Record<string, (e: any) => void>} */
const listeners = {};
globalThis.window = /** @type {any} */ ({
    addEventListener: (/** @type {string} */ type, /** @type {any} */ fn) => { listeners[type] = fn; },
});
globalThis.location = /** @type {any} */ ({ hostname: 'myb-roster.web.app', pathname: '/roster-app/admin.html' });
// Every browser has `navigator`; Node grew a global one only at 21. CI runs this lane on Node 20,
// where the reporter's `navigator.userAgent` threw inside its own listener and every write vanished.
if (typeof globalThis.navigator === 'undefined') {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
}

const { initErrorReporter } = await import('./error-reporter.js');
initErrorReporter();

const OWN = 'https://myb-roster.web.app/admin-app.js';
/** Fire a window `error` event the way a browser does for an uncaught throw. */
const throwError = (/** @type {Error} */ error, filename = OWN) => listeners.error({ error, message: error.message, filename });

beforeEach(() => {
    writes.length = 0;
    authBlob = JSON.stringify({ name: 'G. Miller' });
});

describe('initErrorReporter attaches to both ways a page can fail', () => {
    test('uncaught errors AND unhandled rejections', () => {
        assert.equal(typeof listeners.error, 'function', 'no window "error" listener — thrown errors are never reported');
        assert.equal(typeof listeners.unhandledrejection, 'function', 'no "unhandledrejection" listener — async failures are never reported');
    });
});

describe('a real error reaches the Error Log with who, where and which version', () => {
    test('an uncaught throw from app code is written once, fully attributed', () => {
        throwError(new Error('cannot read properties of undefined (reading "week")'));
        assert.equal(writes.length, 1);
        const [rec] = writes;
        assert.equal(rec.memberName, 'G. Miller');
        assert.equal(rec.page, 'admin.html', 'the page is the file name, not the /roster-app/ mirror path');
        assert.equal(rec.message, 'cannot read properties of undefined (reading "week")');
        assert.equal(rec.appVersion, '99.99');
        assert.match(rec.stack, /cannot read properties/);
    });

    test('an unhandled rejection is written too', () => {
        listeners.unhandledrejection({ reason: new Error('save rejected mid-write') });
        assert.deepEqual(writes.map(w => w.message), ['save rejected mid-write']);
    });

    test('a plain-object rejection is serialised, not "[object Object]"', () => {
        listeners.unhandledrejection({ reason: { code: 'permission-denied', where: 'overrides' } });
        assert.equal(writes.length, 1);
        assert.match(writes[0].message, /"code":"permission-denied"/);
    });
});

describe('the reporter stays quiet exactly where the filter says, and nowhere else', () => {
    test('the same message twice in a session is ONE record', () => {
        throwError(new Error('a bug that fires on every scroll'));
        throwError(new Error('a bug that fires on every scroll'));
        assert.equal(writes.length, 1);
    });

    test('filtered noise is never written (the filter\'s verdict is not discarded)', () => {
        listeners.error({ error: null, message: 'Script error.', filename: '' });
        listeners.error({ error: null, message: 'ResizeObserver loop completed with undelivered notifications.', filename: OWN });
        assert.deepEqual(writes, []);
    });

    test('a CORRUPT session blob still reports — as "unknown" — rather than silencing the session', () => {
        authBlob = '{not json';
        throwError(new Error('the broken session is the one most likely to be erroring'));
        assert.equal(writes.length, 1);
        assert.equal(writes[0].memberName, 'unknown');
    });
});
