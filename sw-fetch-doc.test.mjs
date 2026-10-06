// @ts-check
// sw-fetch-doc.test.mjs — the service worker's DOCUMENT branch, run as the real worker script (Oct 2026
// external review: "add a SW no-cache-fallback navigation test").
//
// WHY A SANDBOX AND NOT THE OFFLINE LANE. The path this pins — a navigation with NOTHING cached —
// cannot be held in a real browser (e2e/offline.spec.js says why: `context.setOffline` cuts the page's
// network but not the worker's, and an online worker refills an emptied Cache Storage within
// milliseconds). So this file evaluates the WHOLE of service-worker.js in a vm context whose `caches`,
// `fetch` and `self` are stand-ins the test controls, captures the real `fetch` listener, and dispatches
// navigation events at it. Nothing is copied out of the worker: rename or reshape the branch and these
// fail, which is the point.
//
// What it pins (each is a way a member has been, or would be, shown the wrong page):
//   1. Nothing cached + a SLOW but working network → the real page, never the synthesised "Offline"
//      page (v24.61, iOS audit B3: the 2s race used to serve "Offline" to an online member).
//   2. Nothing cached + no network → the synthesised page, naming the page asked for, never cached.
//   3. Nothing cached + a 4xx/5xx → the SERVER's answer, not "Offline" about a device that is online.
//   4. A failing navigation preload on a miss → the worker's own fetch, not the offline page.
//   5. Something to fall back to + a hung network → the cached fallback at the 2s race.
//   6. The page itself cached → served at once, and the network still refreshes the cache.
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
const VERSION = /const APP_VERSION = '([^']+)'/.exec(SW_SRC)?.[1];
const CACHE = `myb-roster-v${VERSION}`;
/** The worker's timers run this many times faster, so a "2 s" race costs 100 ms of test time. */
const SPEED = 20;

/** An in-memory Cache Storage keyed by absolute URL. @param {Record<string, Record<string, string>>} seed */
function makeCaches(seed) {
    /** @type {Map<string, Map<string, Response>>} */
    const stores = new Map();
    const key = (/** @type {any} */ req, ignoreSearch = false) => {
        const u = new URL(typeof req === 'string' ? req : req.url, SCOPE);
        if (ignoreSearch) u.search = '';
        return u.href;
    };
    const cacheFor = (/** @type {string} */ name) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const m = /** @type {Map<string, Response>} */ (stores.get(name));
        return {
            async match(/** @type {any} */ req, /** @type {any} */ opts) {
                const hit = m.get(key(req));
                if (hit) return hit.clone();
                if (opts?.ignoreSearch) {
                    for (const [k, v] of m) if (key(k, true) === key(req, true)) return v.clone();
                }
                return undefined;
            },
            async put(/** @type {any} */ req, /** @type {Response} */ res) { m.set(key(req), res); },
            async keys() { return [...m.keys()]; },
        };
    };
    for (const [name, entries] of Object.entries(seed)) {
        const c = cacheFor(name);
        for (const [path, body] of Object.entries(entries)) c.put(path, new Response(body, { headers: { 'content-type': 'text/html' } }));
    }
    return {
        stores,
        api: {
            open: async (/** @type {string} */ n) => cacheFor(n),
            keys: async () => [...stores.keys()],
            match: async (/** @type {any} */ req, /** @type {any} */ opts) => {
                for (const n of stores.keys()) { const r = await cacheFor(n).match(req, opts); if (r) return r; }
                return undefined;
            },
        },
    };
}

/**
 * Boot the real worker in a sandbox and send it one navigation.
 * @param {{ cached?: Record<string, string>, network: (req: Request, signal?: AbortSignal) => Promise<Response>,
 *           preload?: Promise<Response|undefined>, path: string }} o
 */
async function navigate(o) {
    // The completion marker is always present: no warm-up starts, so "nothing cached" stays true.
    const { stores, api } = makeCaches({ [CACHE]: { './__precache-complete': 'ok', ...(o.cached || {}) } });
    /** @type {Record<string, Function>} */
    const listeners = {};
    const fetches = /** @type {string[]} */ ([]);
    const ctx = {
        self: {
            registration: { scope: SCOPE, navigationPreload: null },
            location: { origin: ORIGIN },
            addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { listeners[t] = fn; },
            skipWaiting() {}, clients: { claim: async () => {} },
        },
        caches: api,
        fetch: (/** @type {Request} */ req) => { fetches.push(req.url); return o.network(req, req.signal); },
        setTimeout: (/** @type {Function} */ fn, /** @type {number} */ ms) => setTimeout(fn, (ms || 0) / SPEED),
        clearTimeout,
        console: { log() {}, warn() {}, error() {} },
        Request, Response, Headers, URL, AbortController, Promise,
    };
    vm.createContext(ctx);
    vm.runInContext(SW_SRC, ctx, { filename: 'service-worker.js' });
    assert.equal(typeof listeners.fetch, 'function', 'the worker registers a fetch listener');

    /** @type {Promise<Response>|null} */
    let responded = null;
    const waits = /** @type {Promise<any>[]} */ ([]);
    listeners.fetch({
        request: { url: `${ORIGIN}${o.path}`, method: 'GET', headers: new Headers(), mode: 'navigate', destination: 'document' },
        preloadResponse: o.preload,
        respondWith: (/** @type {Promise<Response>} */ p) => { responded = p; },
        waitUntil: (/** @type {Promise<any>} */ p) => { waits.push(p); },
    });
    assert.ok(responded, 'a navigation is always answered by the worker');
    const res = await /** @type {Promise<Response>} */ (responded);
    return { res, body: await res.clone().text(), fetches, stores, settle: () => Promise.allSettled(waits) };
}

const ok = (/** @type {string} */ body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
const after = (/** @type {number} */ ms, /** @type {() => any} */ fn) => new Promise((r, j) => setTimeout(() => { try { r(fn()); } catch (e) { j(e); } }, ms));

describe('service worker — a navigation with NOTHING cached (v24.61)', () => {
    test('a slow but working network is WAITED for — the member gets the page, not "Offline"', async () => {
        // 3 s of worker time: well past the 2 s race that used to serve the synthesised page.
        const { res, body } = await navigate({ path: '/paycalc.html', network: () => after(3000 / SPEED, () => ok('<h1>Pay Calculator</h1>')) });
        assert.equal(res.status, 200);
        assert.match(body, /Pay Calculator/);
        assert.doesNotMatch(body, /not available offline/);
    });

    test('no network at all → the synthesised page, naming the page asked for, and never cached', async () => {
        const { res, body } = await navigate({ path: '/paycalc.html?payday=2026-10-28', network: () => Promise.reject(new TypeError('Failed to fetch')) });
        assert.equal(res.status, 200, 'a 5xx body can be suppressed by the browser — it must be 200');
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.match(body, /Pay Calculator is not available offline/);
        assert.match(body, /location\.reload\(\)/, 'its Try again reloads, keeping any #fragment a notification carried');
    });

    test('the root with no network names the roster', async () => {
        const { body } = await navigate({ path: '/', network: () => Promise.reject(new TypeError('Failed to fetch')) });
        assert.match(body, /The roster is not available offline/);
    });

    test('a 4xx/5xx is the SERVER\'s answer, not an "Offline" page about a device that is online', async () => {
        const { res, body } = await navigate({ path: '/settings.html', network: async () => new Response('down', { status: 503 }) });
        assert.equal(res.status, 503);
        assert.equal(body, 'down');
    });

    test('a failing navigation PRELOAD falls through to the worker\'s own fetch — online stays online', async () => {
        const { res, body, fetches } = await navigate({
            path: '/operations.html',
            preload: Promise.reject(new TypeError('preload failed')),
            network: async () => ok('<h1>Operations</h1>'),
        });
        assert.equal(res.status, 200);
        assert.match(body, /Operations/);
        assert.equal(fetches.length, 1, 'the worker fetched for itself');
    });

    test('a page fetched on a miss is cached under its BARE path, for the next open', async () => {
        const { stores, settle } = await navigate({ path: '/paycalc.html?payday=2026-10-28', network: async () => ok('<h1>Pay</h1>') });
        await settle();
        await after(20, () => {});
        const keys = [.../** @type {Map<string, Response>} */ (stores.get(CACHE)).keys()];
        assert.ok(keys.includes(`${ORIGIN}/paycalc.html`), `cached keys: ${keys.join(', ')}`);
        assert.ok(!keys.some(k => k.includes('payday=')), 'never one entry per query string');
    });
});

describe('service worker — a navigation with a FALLBACK cached', () => {
    test('a hung network is abandoned at the 2 s race for the cached fallback', async () => {
        let aborted = false;
        const t0 = Date.now();
        const { res, body } = await navigate({
            // A page with no fallback of its own (not one of the six in PAGE_FALLBACKS) falls back to
            // the root. NOT paycalc.html: its fallback is ./paycalc.html, so with only index.html
            // cached it has none and correctly waits for the network — case 1 above.
            path: '/staff-guide.html',
            cached: { './index.html': '<h1>cached roster</h1>' },
            network: (_req, signal) => new Promise((_r, j) => signal?.addEventListener('abort', () => { aborted = true; j(new Error('aborted')); })),
        });
        assert.match(body, /cached roster/);
        assert.equal(res.status, 200);
        assert.ok(Date.now() - t0 < 1500, 'served at the race, not after a long wait');
        assert.equal(aborted, true, 'the worker\'s own fetch is cancelled at the race');
    });

    test('a network that FAILS outright serves the fallback at once, not after the race', async () => {
        const t0 = Date.now();
        const { body } = await navigate({
            path: '/admin.html?member=G.%20Miller',
            cached: { './admin.html': '<h1>cached admin</h1>', './index.html': '<h1>root</h1>' },
            network: () => Promise.reject(new TypeError('Failed to fetch')),
        });
        // The PAGE's own copy (matched ignoring the query), not the root's — and no 2 s wait.
        assert.match(body, /cached admin/);
        assert.ok(Date.now() - t0 < 2000 / SPEED, 'a failed fetch does not wait out the race');
    });

    test('a page whose own fallback is missing does NOT borrow another page\'s', async () => {
        // paycalc.html with only index.html cached: no fallback, so it waits for the network
        // rather than racing — never the Calendar served in place of the Pay Calculator.
        const { body } = await navigate({
            path: '/paycalc.html',
            cached: { './index.html': '<h1>root</h1>' },
            network: () => after(3000 / SPEED, () => ok('<h1>Pay Calculator</h1>')),
        });
        assert.match(body, /Pay Calculator/);
    });
});

describe('service worker — the page itself cached (stale-while-revalidate, v16.10)', () => {
    test('served at once, and the network still refreshes the cache for the next open', async () => {
        const { body, settle, stores } = await navigate({
            path: '/settings.html',
            cached: { './settings.html': '<h1>old settings</h1>' },
            network: async () => ok('<h1>new settings</h1>'),
        });
        assert.match(body, /old settings/);
        await settle();
        await after(20, () => {});
        const fresh = /** @type {Map<string, Response>} */ (stores.get(CACHE)).get(`${ORIGIN}/settings.html`);
        assert.match(await /** @type {Response} */ (fresh).text(), /new settings/);
    });
});
