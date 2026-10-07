// @ts-check
// sw-notification-tap.test.mjs — the service worker's `notificationclick`, run as the real worker script
// (Oct 2026 review: "a notification tap navigates the first app window it finds, with no check for
// unsaved or in-flight work", and "notificationclick is untested").
//
// Same sandbox idea as sw-fetch-doc.test.mjs: evaluate the WHOLE of service-worker.js in a vm context
// whose `clients` and `self` are stand-ins, capture the real listener, and dispatch a tap at it.
//
// What it pins:
//   1. A page that answers "busy" is NOT navigated — it is sent `myb-open-later` with the re-based url.
//   2. A page that answers "not busy" is navigated, as before.
//   3. A page that never answers (a release from before the question existed) is navigated after the
//      wait — the tap must still land.
//   4. No open window → a new one, at the re-based url; a payload naming another origin is re-based.
// Part of test:hygiene (no mocks, nothing installed).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SW_SRC = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
const ORIGIN = 'https://myb-roster.web.app';
const SCOPE = `${ORIGIN}/`;
/** Real time, deliberately. Sped up, the worker's 500 ms wait became 25 ms and lost the race to a
 *  port reply delayed by a loaded machine — a false red in the full suite. Only one case waits. */
const SPEED = 1;

/**
 * Boot the worker and tap one notification.
 * @param {{ windows: Array<{ answer?: 'busy'|'idle'|'silent' }>, url: string }} o
 */
async function tap(o) {
    /** @type {Record<string, Function>} */
    const listeners = {};
    const opened = /** @type {string[]} */ ([]);
    const wins = o.windows.map(w => {
        const rec = { navigated: /** @type {string[]} */ ([]), messages: /** @type {any[]} */ ([]) };
        const client = {
            url: `${SCOPE}admin.html`,
            focus: async () => client,
            navigate: async (/** @type {string} */ u) => { rec.navigated.push(u); return client; },
            postMessage(/** @type {any} */ msg, /** @type {any[]} */ ports) {
                rec.messages.push(msg);
                if (msg.type === 'myb-busy?' && w.answer !== 'silent') ports[0].postMessage({ busy: w.answer === 'busy' });
            },
        };
        return { client, rec };
    });
    const clients = {
        matchAll: async () => wins.map(w => w.client),
        openWindow: async (/** @type {string} */ u) => { opened.push(u); return null; },
        claim: async () => {},
    };
    const ctx = {
        self: {
            registration: { scope: SCOPE, navigationPreload: null, showNotification: async () => {} },
            location: { origin: ORIGIN },
            addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { listeners[t] = fn; },
            skipWaiting() {}, clients,
        },
        clients,
        caches: { open: async () => ({ match: async () => undefined, put: async () => {}, keys: async () => [] }), keys: async () => [], match: async () => undefined },
        fetch: async () => new Response('ok'),
        setTimeout: (/** @type {Function} */ fn, /** @type {number} */ ms) => setTimeout(fn, (ms || 0) / SPEED),
        clearTimeout,
        console: { log() {}, warn() {}, error() {} },
        Request, Response, Headers, URL, AbortController, Promise, MessageChannel,
    };
    vm.createContext(ctx);
    vm.runInContext(SW_SRC, ctx, { filename: 'service-worker.js' });
    assert.equal(typeof listeners.notificationclick, 'function', 'the worker registers a notificationclick listener');
    /** @type {Promise<any>|null} */
    let waited = null;
    listeners.notificationclick({
        notification: { close() {}, data: { url: o.url } },
        waitUntil: (/** @type {Promise<any>} */ p) => { waited = p; },
    });
    await waited;
    // A port's message is delivered on a later turn; let any stragglers land before reading.
    await new Promise(r => setTimeout(r, 10));
    return { opened, wins: wins.map(w => w.rec) };
}

describe('a notification tap never takes away unsaved work', () => {
    test('a BUSY page is left where it is, and asked instead', async () => {
        const { opened, wins } = await tap({ windows: [{ answer: 'busy' }], url: 'https://myb-roster.web.app/#huddle' });
        assert.deepEqual(wins[0].navigated, [], 'not navigated');
        assert.deepEqual(opened, [], 'and no second window');
        const later = wins[0].messages.find(m => m.type === 'myb-open-later');
        assert.ok(later, 'the page is sent the offer');
        assert.equal(later.url, `${SCOPE}#huddle`);
    });

    test('an idle page is navigated, as before', async () => {
        const { wins } = await tap({ windows: [{ answer: 'idle' }], url: 'https://myb-roster.web.app/paycalc.html?payday=2026-10-23' });
        assert.deepEqual(wins[0].navigated, [`${SCOPE}paycalc.html?payday=2026-10-23`]);
    });

    test('a page that never answers (an older release) is still navigated after the wait', async () => {
        const { wins } = await tap({ windows: [{ answer: 'silent' }], url: 'https://myb-roster.web.app/#huddle' });
        assert.deepEqual(wins[0].navigated, [`${SCOPE}#huddle`]);
    });
});

describe('the url is the worker\'s, not the payload\'s', () => {
    test('no open window → a new one, re-based onto this scope', async () => {
        const { opened } = await tap({ windows: [], url: 'https://elsewhere.example/overtime.html' });
        assert.deepEqual(opened, [`${SCOPE}overtime.html`]);
    });

    test('a page not on the allowlist lands on the app root', async () => {
        const { opened } = await tap({ windows: [], url: 'https://myb-roster.web.app/experiments/x.html' });
        assert.deepEqual(opened, [SCOPE]);
    });
});
