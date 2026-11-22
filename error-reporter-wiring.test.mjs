// @ts-check
/**
 * error-reporter-wiring.test.mjs — the reporter's WIRING, which error-reporter.test.mjs cannot see.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs error-reporter-wiring.test.mjs   (part of test:unit)
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

mock.module('./firebase-client.js', { namedExports: { logClientError: (/** @type {any} */ rec) => { writes.push(rec); }, auth: null } });
mock.module('./ls.js', { namedExports: { lsGet: () => authBlob } });
mock.module('./session.js', { namedExports: { AUTH_KEY: 'test_auth_key' } });
mock.module('./roster-data.js', { namedExports: { APP_VERSION: '99.99' } });

/** @type {Record<string, (e: any) => void>} */
const listeners = {};
globalThis.window = /** @type {any} */ ({
    addEventListener: (/** @type {string} */ type, /** @type {any} */ fn) => { listeners[type] = fn; },
});
globalThis.location = /** @type {any} */ ({ hostname: 'myb-roster.web.app', pathname: '/roster-app/admin.html' });
// Every browser has `navigator`; Node grew a global one only at 21. CI ran this lane on Node 20,
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

    test('a blob that PARSES but names no string reports as "unknown" — the rule refuses anything else', () => {
        // firestore.rules → clientErrors takes `memberName is string && size() <= 100` and refuses the
        // WHOLE record otherwise, so `{"name":5}` silently dropped every report the session made.
        for (const [i, blob] of [JSON.stringify({ name: 5 }), JSON.stringify({ name: { first: 'G' } }), JSON.stringify({ name: '' }), 'null'].entries()) {
            authBlob = blob;
            throwError(new Error(`a session that names nobody, case ${i}`));
        }
        assert.deepEqual(writes.map(w => w.memberName), ['unknown', 'unknown', 'unknown', 'unknown']);
    });

    test('every capped field fits the rule\'s size, the name and the page included', () => {
        authBlob = JSON.stringify({ name: 'N'.repeat(150) });
        const prev = globalThis.location;
        globalThis.location = /** @type {any} */ ({ hostname: 'myb-roster.web.app', pathname: `/roster-app/${'p'.repeat(150)}.html` });
        try { throwError(new Error('the record must not be refused for its length')); }
        finally { globalThis.location = prev; }
        assert.equal(writes.length, 1);
        assert.equal(writes[0].memberName.length, 100, 'memberName.size() <= 100');
        assert.equal(writes[0].page.length, 100, 'page.size() <= 100');
    });
});

describe("WebKit's IndexedDB teardown: Firebase Auth's poll is dropped, a failing Firestore cache is WRITTEN (18 Nov 2026)", () => {
    // Both SDKs load from www.gstatic.com, and until 18 Nov 2026 the reporter handed the filter that
    // bare ORIGIN, recovered from the stack — so Firestore's broken offline cache, which the
    // Calendar's offline-first paint depends on, was dropped as Auth's harmless noise. An unhandled
    // rejection names no file of its own; only its stack says which script threw, so these drive the
    // real listener with the stack an iPhone sends (Safari's `fn@url:line:col` on every frame).
    const AUTH = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
    const FIRESTORE = 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
    /** @param {string} message @param {string} url @param {string[]} fns */
    const thrownIn = (message, url, fns) => {
        const e = new Error(message);
        e.stack = fns.map((f, i) => `${f}@${url}:1:${1000 + i}`).join('\n');
        return e;
    };

    test("the Auth poll that meets a closing connection is NOT written", () => {
        listeners.unhandledrejection({ reason: thrownIn(
            "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
            AUTH, ['getObjectStore', '_withRetries', '_poll']) });
        assert.deepEqual(writes, [], 'the noise the rule exists for is still kept out of the log');
    });

    test('the same loss inside Firestore\'s offline cache IS written', () => {
        const message = "IndexedDB transaction 'Get last remote snapshot version' failed: "
            + 'UnknownError: Connection to Indexed Database server lost. Refresh the page to try again';
        listeners.unhandledrejection({ reason: thrownIn(message, FIRESTORE, ['runTransaction', 'getLastRemoteSnapshotVersion']) });
        assert.deepEqual(writes.map(w => w.message), [message], 'a broken cache must reach the admin');
        assert.match(writes[0].stack, /firebase-firestore\.js/);
    });

    test('and as uncaught throws: dropped from the Auth script by its source alone, written from Firestore', () => {
        // A thrown value that is not an Error has no stack, so the source URL is all the filter has.
        listeners.error({ error: null, message: 'An internal error was encountered in the Indexed Database server', filename: AUTH });
        assert.deepEqual(writes, [], 'the Auth script, named by the source URL alone');
        throwError(thrownIn('An internal error was encountered in the Indexed Database server (store)', FIRESTORE, ['getStore']), FIRESTORE);
        assert.equal(writes.length, 1, 'the Firestore script, named by its source URL and its stack');
    });
});

describe('a slow save while online is written as a DIAGNOSTIC that says how much of the wait was in the background (v25.87)', () => {
    test('in the background, on screen throughout, and not measured — each worded, end to end', () => {
        // An installed iPhone app reported 81.8s to confirm, online, its token in 0.0s, and could not
        // say whether the connection was slow or the phone had frozen the app in the background.
        // THREE saves, because three is the reporter's ceiling per page: a fourth would be dropped.
        const slow = listeners['myb-slow-save'];
        assert.equal(typeof slow, 'function', 'no slow-save listener — a slow save leaves nothing in the Error Log');
        const done = (/** @type {object} */ d) => slow({ detail: { phase: 'done', onlineWhenSlow: true, batched: false, ok: true, ...d } });
        // Each also carries a different own-saves wait (22 Nov 2026), the field that says whether the
        // eight-second wait for this device's earlier saves ran out: none, one that ran out, and the
        // summary of several that drained.
        done({ id: 901, ms: 81_800, hiddenMs: 74_000 });
        done({ id: 902, ms: 8_100, hiddenMs: 0, ownWrites: { ms: 8_004, outcome: 'ran out', count: 1 } });
        done({ id: 903, ms: 12_000, hiddenMs: null, ownWrites: { ms: 40, outcome: 'drained', count: 3 } });
        const token = ' · sign-in token not measured', tail = ' · installed app: no';
        assert.deepEqual(writes.map(w => w.message), [
            `Slow save (diagnostic): the save took 81.8s to be confirmed — a save while the phone said it was online · in the background for 74.0s${token}${tail}`,
            `Slow save (diagnostic): the save took 8.1s to be confirmed — a save while the phone said it was online · on screen throughout${token} · own-saves wait 8.0s, ran out${tail}`,
            `Slow save (diagnostic): the save took 12.0s to be confirmed — a save while the phone said it was online · background time not measured${token} · own-saves wait 0.0s, drained (3 waits)${tail}`,
        ]);
        assert.ok(writes.every(w => w.message.length <= 300), 'every line fits the 300 characters the record keeps');
    });
});
