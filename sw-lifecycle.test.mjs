// @ts-check
// sw-lifecycle.test.mjs — the service worker's UPDATE steps, run as the real worker script.
//
// WHY THIS EXISTS (test audit, 7 Nov 2026). Six mutations of the update path left every suite that
// reads the worker green — 449 tests across 18 files — because no test ever fired `install` or
// `activate`, and every harness set up exactly one cache in which every fetch succeeded:
//   1. install waiting for the whole precache          (the v15.41 "updates with a lot of lag" bug)
//   2. the precache moved inside activate's waitUntil  (every request of the reloaded page queued)
//   3. old caches deleted after a PARTIAL warm-up      (the transition fallback thrown away)
//   4. the completion marker written after a partial   (the missing files are never retried)
//   5. a page served from ANY version's cache          (an old release's HTML over new modules)
//   6. the fallback looked up oldest-first             (the same, on the offline path)
// The weekly offline lane cannot see them either: it has one fresh cache and every asset succeeds.
//
// The method is sw-fetch-doc.test.mjs's: evaluate the WHOLE of service-worker.js in a vm context
// whose `self`, `caches` and `fetch` are stand-ins this file controls. Nothing is copied out of the
// worker. Part of test:hygiene (no mocks, nothing installed).

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
const OLD_CACHE = 'myb-roster-v1.00';
const MARKER = `${ORIGIN}/__precache-complete`;
/** Worker timers run this much faster, so a 30 s fetch timeout costs 300 ms of test time. */
const SPEED = 100;

/** In-memory Cache Storage keyed by absolute URL, with `delete`. With `readBodies`, `put` reads the
 *  whole body before it resolves, as the real Cache API does — so a body that never ends hangs it.
 *  @param {Record<string, Record<string, string>>} seed @param {boolean} [readBodies] */
function makeCaches(seed, readBodies = false) {
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
                if (opts?.ignoreSearch) for (const [k, v] of m) if (key(k, true) === key(req, true)) return v.clone();
                return undefined;
            },
            async put(/** @type {any} */ req, /** @type {Response} */ res) {
                m.set(key(req), readBodies ? new Response(await res.arrayBuffer(), { status: res.status, headers: res.headers }) : res);
            },
            async keys() { return [...m.keys()]; },
        };
    };
    for (const [name, entries] of Object.entries(seed)) {
        if (!stores.has(name)) stores.set(name, new Map());
        const m = /** @type {Map<string, Response>} */ (stores.get(name));
        // Seeded synchronously, not through `put`: the worker reads its marker the moment it boots.
        for (const [path, body] of Object.entries(entries)) m.set(key(path), new Response(body, { headers: { 'content-type': 'text/html' } }));
    }
    return {
        stores,
        api: {
            open: async (/** @type {string} */ n) => cacheFor(n),
            keys: async () => [...stores.keys()],
            delete: async (/** @type {string} */ n) => stores.delete(n),
            // CREATION order, as the platform's is — which is exactly why the worker must not use it.
            match: async (/** @type {any} */ req, /** @type {any} */ opts) => {
                for (const n of stores.keys()) { const r = await cacheFor(n).match(req, opts); if (r) return r; }
                return undefined;
            },
        },
    };
}

/** A 200 with NO content-type (a byte body sets none), which `ctSafe` accepts for every asset kind. */
const okAsset = () => new Response(new Uint8Array([120]), { status: 200 });
const never = () => new Promise(() => {});

/**
 * Boot the real worker. `network` answers every fetch the worker makes, and is handed the request's
 * abort signal. `readBodies`: see makeCaches.
 * @param {{ seed: Record<string, Record<string, string>>, network: (url: string, signal?: AbortSignal) => Promise<Response>, readBodies?: boolean, navigationPreload?: any }} o
 */
function boot(o) {
    const { stores, api } = makeCaches(o.seed, o.readBodies);
    /** @type {Record<string, Function>} */
    const listeners = {};
    const fetched = /** @type {string[]} */ ([]);
    let skipped = false;
    // A worker resolves a relative URL against its own location; Node's Request has no base.
    const Req = class extends Request {
        constructor(/** @type {any} */ input, /** @type {any} */ init) {
            super(typeof input === 'string' ? new URL(input, SCOPE).href : input, init);
        }
    };
    const ctx = {
        self: {
            registration: { scope: SCOPE, navigationPreload: o.navigationPreload ?? null },
            location: { origin: ORIGIN },
            addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { listeners[t] = fn; },
            skipWaiting() { skipped = true; },
            clients: { claim: async () => {} },
        },
        caches: api,
        fetch: (/** @type {any} */ req) => {
            const url = typeof req === 'string' ? new URL(req, SCOPE).href : req.url;
            fetched.push(url);
            return o.network(url, typeof req === 'string' ? undefined : req.signal);
        },
        setTimeout: (/** @type {Function} */ fn, /** @type {number} */ ms) => setTimeout(fn, (ms || 0) / SPEED),
        clearTimeout,
        console: { log() {}, warn() {}, error() {} },
        Request: Req, Response, Headers, URL, AbortController, Promise,
    };
    vm.createContext(ctx);
    vm.runInContext(SW_SRC, ctx, { filename: 'service-worker.js' });
    return {
        listeners, stores, fetched, skippedWaiting: () => skipped,
        /** Is a warm-up still running? Read from the worker's own state, not guessed from fetches. */
        warming: () => vm.runInContext('_warmupInFlight !== null', ctx),
    };
}

/** Fire a lifecycle event and report whether every promise it was told to wait for settled in time. */
async function fire(/** @type {Function} */ listener, ms = 200) {
    const waits = /** @type {Promise<any>[]} */ ([]);
    listener({ waitUntil: (/** @type {Promise<any>} */ p) => { waits.push(p); } });
    const settled = await Promise.race([
        Promise.allSettled(waits).then(() => true),
        new Promise(r => setTimeout(() => r(false), ms)),
    ]);
    return { waits: waits.length, settled };
}

/** Wait until the warm-up has stopped fetching — it has nothing to report its completion through. */
async function warmupDone(/** @type {{ fetched: string[] }} */ w) {
    let last = -1;
    for (let i = 0; i < 200; i++) {
        await new Promise(r => setTimeout(r, 15));
        if (w.fetched.length > 0 && w.fetched.length === last) return;
        last = w.fetched.length;
    }
    throw new Error('the warm-up never settled');
}

describe('service worker — install and activate never wait for the precache (v15.41)', () => {
    test('install takes over at once, while the warm-up is still fetching', async () => {
        const w = boot({ seed: { [CACHE]: {} }, network: never });   // a hung network — no marker, so a warm-up is running
        await new Promise(r => setTimeout(r, 20));
        assert.ok(w.fetched.length > 0, 'premise: a warm-up is in flight');
        const r = await fire(w.listeners.install);
        assert.equal(w.skippedWaiting(), true, 'install calls skipWaiting');
        assert.equal(r.settled, true, 'install must not hold the update behind ~200 fetches');
    });

    test('activate claims at once — the page\'s requests are not queued behind the warm-up', async () => {
        const w = boot({ seed: { [CACHE]: {} }, network: never });
        await new Promise(r => setTimeout(r, 20));
        const r = await fire(w.listeners.activate);
        assert.ok(r.waits > 0, 'premise: activate waits for the claim');
        assert.equal(r.settled, true, 'every fetch of the reloaded page would wait until the warm-up finished');
    });

    test('activate turns Navigation Preload OFF — the setting outlives the worker that set it', async () => {
        // With HTML served from this version's cache and never re-fetched, a preload is a network
        // request on every open whose answer is thrown away; a release that once enabled it left it on
        // in the registration, so turning it off has to be done, not merely not done.
        const calls = /** @type {string[]} */ ([]);
        const w = boot({ seed: { [CACHE]: { './__precache-complete': '1' } }, network: never,
            navigationPreload: { enable: async () => { calls.push('enable'); }, disable: async () => { calls.push('disable'); } } });
        const r = await fire(w.listeners.activate);
        assert.equal(r.settled, true);
        assert.deepEqual(calls, ['disable']);
    });
});

describe('service worker — a PARTIAL warm-up keeps the fallback and retries (v15.46)', () => {
    const failOne = (/** @type {string} */ url) => Promise.resolve(url.endsWith('/admin.html') ? new Response('', { status: 500 }) : okAsset());

    test('one asset failing: the old version\'s cache is KEPT, and no completion marker is written', async () => {
        const w = boot({ seed: { [CACHE]: {}, [OLD_CACHE]: { './index.html': 'old release' } }, network: failOne });
        await warmupDone(w);
        assert.ok(w.fetched.some(u => u.endsWith('/admin.html')), 'premise: the failing asset was asked for');
        assert.ok(w.stores.has(OLD_CACHE), 'the old cache is the fallback for exactly the files that just failed');
        assert.equal(w.stores.get(CACHE)?.has(MARKER), false, 'a marker now would stop the next wake retrying the gap');
    });

    test('CONTROL: everything cached — the old cache goes, and the marker is written', async () => {
        const w = boot({ seed: { [CACHE]: {}, [OLD_CACHE]: { './index.html': 'old release' } }, network: () => Promise.resolve(okAsset()) });
        await warmupDone(w);
        assert.equal(w.stores.has(OLD_CACHE), false, 'a complete warm-up sweeps the superseded cache');
        assert.equal(w.stores.get(CACHE)?.has(MARKER), true);
    });
});

// ── A BODY THAT STALLS AFTER ITS HEADERS (Nov 2026) ──────────────────────────────────────────────
// The warm-up's 30 s timeout was cleared when the HEADERS arrived, so a body that then stalled — the
// signal dropping half-way through a file — hung `cache.put`, its batch and the whole warm-up for the
// life of the worker: no later file cached, no marker, no sweep, and every fetch event's waitUntil
// keeping the worker pinned. The fake Cache reads bodies here, as the real one does.
describe('service worker — a warm-up body that stalls after its headers', () => {
    test('the 30 s timeout covers the body: that file is abandoned and the warm-up FINISHES', async () => {
        let aborted = 0;
        /** @param {string} url @param {AbortSignal} [signal] */
        const stallOne = (url, signal) => Promise.resolve(url.endsWith('/calendar-app.js')
            ? new Response(new ReadableStream({ start(c) {
                c.enqueue(new TextEncoder().encode('export const x = 1;'));   // half a file, then nothing
                signal?.addEventListener('abort', () => { aborted++; c.error(new DOMException('aborted', 'AbortError')); });
            } }), { status: 200 })
            : okAsset());
        const w = boot({ seed: { [CACHE]: {}, [OLD_CACHE]: { './index.html': 'old release' } }, network: stallOne, readBodies: true });
        // 1,500 s of worker time — fifty times the timeout. A healthy run finishes in well under a second;
        // 3 s ran out on a machine busy with browser suites (twice, 10 Nov 2026), and a warm-up that
        // never finishes fails at any deadline, so the margin costs only the wait when it does.
        const deadline = Date.now() + 15000;
        while (!w.fetched.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));   // it has started
        assert.ok(w.warming(), 'premise: a warm-up is running');
        while (w.warming() && Date.now() < deadline) await new Promise(r => setTimeout(r, 15));
        assert.equal(w.warming(), false, 'the warm-up never finished — one stalled body held it for the life of the worker');
        assert.ok(aborted > 0, 'the stalled body is aborted by the timeout, not left open');
        assert.ok(w.stores.get(CACHE)?.has(`${ORIGIN}/fip-guide.css`), 'files after the stalled batch are still cached');
        assert.equal(w.stores.get(CACHE)?.has(MARKER), false, 'one file missed, so no marker: the next wake retries it');
        assert.ok(w.stores.has(OLD_CACHE), 'and the old release is kept as the fallback for the file that missed');
    });
});

// Online, this release's page — never an older one at once. Offline, the worker falls back to an
// older copy on purpose (availability), but to the NEWEST one it has: the platform's own
// `caches.match` searches in CREATION order, i.e. oldest first, and an old page over this release's
// modules is a mixed-version page — so the further back, the worse (`matchNewestManagedCache`).
describe('service worker — which release a page comes from', () => {
    /** Send one navigation to a booted worker; resolves with the body the member gets. */
    async function open(/** @type {ReturnType<typeof boot>} */ w, /** @type {string} */ path) {
        /** @type {Promise<Response>|null} */ let responded = null;
        w.listeners.fetch({
            request: { url: `${ORIGIN}${path}`, method: 'GET', headers: new Headers(), mode: 'navigate', destination: 'document', credentials: 'same-origin' },
            respondWith: (/** @type {Promise<Response>} */ p) => { responded = p; },
            waitUntil() {},
        });
        assert.ok(responded, 'the worker answers a navigation');
        return (await /** @type {Promise<Response>} */ (responded)).text();
    }
    // This version's cache is complete except for the page asked for; two older ones hold it,
    // created OLDEST FIRST, as a device that has been through two releases would have them.
    const seed = () => ({
        [CACHE]: { './__precache-complete': '1' },
        [OLD_CACHE]: { './paycalc.html': 'OLDEST RELEASE' },
        'myb-roster-v2.00': { './paycalc.html': 'RECENT RELEASE' },
    });

    test('online: the current release from the network, not the old copy at once', async () => {
        const w = boot({ seed: seed(), network: () => Promise.resolve(new Response('NEW RELEASE', { headers: { 'content-type': 'text/html' } })) });
        const body = await open(w, '/paycalc.html');
        assert.match(body, /NEW RELEASE/, 'an old release\'s HTML over this release\'s modules is a mixed-version page');
    });

    test('offline: the NEWEST older copy — never the oldest', async () => {
        const w = boot({ seed: seed(), network: () => Promise.reject(new TypeError('Failed to fetch')) });
        const body = await open(w, '/paycalc.html');
        assert.match(body, /RECENT RELEASE/, 'the oldest-first global lookup is the one the fallback must not use');
    });
});
