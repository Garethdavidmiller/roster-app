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
import { GUIDE_PAGES, REDIRECT_PAGES } from './scripts/app-pages.mjs';

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

/** An older release's cache, as a device mid-transition holds one. */
const OLDER_CACHE = 'myb-roster-v1.00';

/**
 * Boot the real worker in a sandbox and send it one navigation. `older` seeds an older release's cache;
 * `scope` installs it under another scope (the Pages mirror's sub-path); `unanswered` allows the worker
 * to leave the request to the browser, reported as `{ answered: false }`.
 * @param {{ cached?: Record<string, string>, older?: Record<string, string>, network: (req: Request, signal?: AbortSignal) => Promise<Response>,
 *           preload?: Promise<Response|undefined>, path: string, mode?: string, destination?: string, scope?: string, unanswered?: boolean }} o
 * @returns {Promise<any>}
 */
async function navigate(o) {
    // The completion marker is always present: no warm-up starts, so "nothing cached" stays true.
    const { stores, api } = makeCaches({
        ...(o.older ? { [OLDER_CACHE]: o.older } : {}),
        [CACHE]: { './__precache-complete': 'ok', ...(o.cached || {}) },
    });
    /** @type {Record<string, Function>} */
    const listeners = {};
    const fetches = /** @type {string[]} */ ([]);
    const fetchModes = /** @type {string[]} */ ([]);
    const scope = o.scope ?? SCOPE;
    const origin = new URL(scope).origin;
    const ctx = {
        self: {
            registration: { scope, navigationPreload: null },
            location: { origin },
            addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { listeners[t] = fn; },
            skipWaiting() {}, clients: { claim: async () => {} },
        },
        caches: api,
        fetch: (/** @type {Request} */ req) => { fetches.push(req.url); fetchModes.push(req.cache); return o.network(req, req.signal); },
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
        request: { url: `${origin}${o.path}`, method: 'GET', headers: new Headers(), mode: o.mode ?? 'navigate', destination: o.destination ?? 'document', credentials: 'same-origin' },
        preloadResponse: o.preload,
        respondWith: (/** @type {Promise<Response>} */ p) => { responded = p; },
        waitUntil: (/** @type {Promise<any>} */ p) => { waits.push(p); },
    });
    if (!responded && o.unanswered) return { answered: false, fetches, stores };
    assert.ok(responded, 'a navigation is always answered by the worker');
    const res = await /** @type {Promise<Response>} */ (responded);
    return { res, body: await res.clone().text(), fetches, fetchModes, stores, settle: () => Promise.allSettled(waits) };
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

describe('service worker — a MISS answered by navigation preload (same-day bug check)', () => {
    test('the preload is SERVED, but what is STORED is the worker\'s own no-cache fetch', async () => {
        // A preload uses the navigation's own cache mode, so on the Pages mirror it can be last
        // release's page from the HTTP cache; stored, it would stay for the whole version.
        const { body, stores, fetchModes, settle } = await navigate({
            path: '/admin.html',
            preload: Promise.resolve(ok('<h1>OLD release</h1>')),
            network: async () => ok('<h1>NEW release</h1>'),
        });
        assert.match(body, /OLD release/, 'the member is not kept waiting for a second fetch');
        await settle();
        const stored = await stores.get(CACHE)?.get(`${ORIGIN}/admin.html`)?.clone().text();
        assert.match(String(stored), /NEW release/, 'the version cache holds the fresh page, never the preload');
        assert.ok(fetchModes.includes('no-cache'), 'and it was fetched past the HTTP cache');
    });
});

describe('service worker — a preload that lands AFTER the 2 s race (v25.06, whole-app review)', () => {
    test('still stores the worker\'s own fresh fetch, not nothing', async () => {
        // The store fetch reused `freshReq`, whose signal the race had just aborted — so it rejected at
        // once and the "a late one still refreshes the cache" promise in the header was not kept.
        // The fallback is the guide's copy in an OLDER release's cache: a race needs something to serve.
        const { body, stores } = await navigate({
            path: '/staff-guide.html',
            older: { './staff-guide.html': '<h1>last release\'s guide</h1>' },
            preload: after(250, () => ok('<h1>late preload</h1>')),
            network: async (_req, signal) => {
                if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
                return ok('<h1>fresh guide</h1>');
            },
        });
        assert.match(body, /last release's guide/, 'the race serves the fallback');
        await new Promise(r => setTimeout(r, 600));   // the preload lands, the store runs
        const stored = await stores.get(CACHE)?.get(`${ORIGIN}/staff-guide.html`)?.clone().text();
        assert.match(String(stored), /fresh guide/, 'the late answer must reach the cache for the next open');
    });
});

describe('service worker — a MISS whose fresh fetch is not a page', () => {
    test('a 200 that is not HTML (an interstitial, a JSON error) is never stored under the page', async () => {
        const { stores, settle } = await navigate({
            path: '/settings.html',
            preload: Promise.resolve(ok('<h1>Settings</h1>')),
            network: async () => new Response('{"error":1}', { status: 200, headers: { 'content-type': 'application/json' } }),
        });
        await settle();
        assert.equal(stores.get(CACHE)?.has(`${ORIGIN}/settings.html`), false);
    });
});

describe('service worker — a navigation with a FALLBACK cached', () => {
    test('a hung network is abandoned at the 2 s race for the cached fallback', async () => {
        let aborted = false;
        const t0 = Date.now();
        const { res, body } = await navigate({
            // The page is missing from THIS release's cache, and an older release still holds it —
            // the transition fallback, served at the race rather than after a hung network.
            path: '/settings.html',
            older: { './settings.html': '<h1>cached settings</h1>' },
            network: (_req, signal) => new Promise((_r, j) => signal?.addEventListener('abort', () => { aborted = true; j(new Error('aborted')); })),
        });
        assert.match(body, /cached settings/);
        assert.equal(res.status, 200);
        assert.ok(Date.now() - t0 < 1500, 'served at the race, not after a long wait');
        assert.equal(aborted, true, 'the worker\'s own fetch is cancelled at the race');
    });

    test('a page whose only fallback is the ROOT still races to it — an unknown page is the app', async () => {
        // The default in the table: a page that is none of the app's own falls back to the Calendar.
        const { body } = await navigate({
            path: '/no-such-page.html',
            cached: { './index.html': '<h1>cached roster</h1>' },
            network: (_req, signal) => new Promise((_r, j) => signal?.addEventListener('abort', () => j(new Error('aborted')))),
        });
        assert.match(body, /cached roster/);
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

    // ── A GUIDE NEVER GETS THE CALENDAR (Nov 2026, the owner's decision) ─────────────────────────
    // A first install's warm-up reaches the guides last, and a guide had no entry in the [keyword,
    // page] table — so its fallback was the Calendar, and on a slow but WORKING connection the race
    // served the Calendar under the guide's address: the drawer link appeared to do nothing. Every
    // guide, and each legacy stub, is checked from the page list the suites share.
    for (const { file } of GUIDE_PAGES) {
        test(`${file} missing from the cache waits for a slow network — never the Calendar in its place`, async () => {
            const { body } = await navigate({
                path: `/${file}`,
                cached: { './index.html': '<h1>cached roster</h1>' },
                network: () => after(3000 / SPEED, () => ok(`<h1>${file}</h1>`)),
            });
            assert.doesNotMatch(body, /cached roster/, 'the Calendar was served under a guide\'s address');
            assert.match(body, new RegExp(file.replace('.', '\\.')));
        });
    }

    test('offline, a guide with no copy of its own says so by NAME rather than opening the Calendar', async () => {
        const { body } = await navigate({
            path: '/fip-guide.html',
            cached: { './index.html': '<h1>cached roster</h1>' },
            network: () => Promise.reject(new TypeError('Failed to fetch')),
        });
        assert.match(body, /The FIP Travel Guide is not available offline/);
    });

    for (const { file, to } of REDIRECT_PAGES) {
        test(`the legacy stub ${file} with no copy of its own falls back to the guide it leads to`, async () => {
            const guide = to.replace(/^\.\//, '');
            const { body } = await navigate({
                path: `/${file}`,
                cached: { './index.html': '<h1>cached roster</h1>', [`./${guide}`]: `<h1>cached ${guide}</h1>` },
                network: (_req, signal) => new Promise((_r, j) => signal?.addEventListener('abort', () => j(new Error('aborted')))),
            });
            assert.match(body, new RegExp(`cached ${guide.replace('.', '\\.')}`));
        });
    }

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

describe('service worker — the page itself cached', () => {
    test('served at once, and a network copy NEVER rewrites it (Oct 2026 production review)', async () => {
        // The background rewrite was how a previous release got into the new cache — a preload the
        // browser answered from its HTTP cache (the Pages mirror sends max-age=600) — and how a new
        // release got into an old worker's cache. Within a version the page cannot change.
        const { body, settle, stores } = await navigate({
            path: '/settings.html',
            cached: { './settings.html': '<h1>this release</h1>' },
            network: async () => ok('<h1>some other release</h1>'),
        });
        assert.match(body, /this release/);
        await settle();
        await after(20, () => {});
        const all = await Promise.all([.../** @type {Map<string, Response>} */ (stores.get(CACHE)).values()].map(r => r.clone().text()));
        assert.ok(!all.some(t => /some other release/.test(t)), 'the cached page was rewritten');
    });
});

describe('service worker — a JS module (Oct 2026 production review)', () => {
    const js = (/** @type {string} */ t) => new Response(t, { status: 200, headers: { 'content-type': 'text/javascript' } });
    test('a cached module is served and NOT fetched at all', async () => {
        const { body, fetches } = await navigate({
            path: '/calendar-app.js', destination: 'script', mode: 'cors',
            cached: { './calendar-app.js': 'export const v = "this release";' },
            network: async () => js('export const v = "other";'),
        });
        assert.match(body, /this release/);
        assert.equal(fetches.length, 0, 'a version-pinned hit needs no network');
    });

    test('a MISS is fetched past the browser HTTP cache, and stored', async () => {
        const { body, fetchModes, stores, settle } = await navigate({
            path: '/calendar-app.js', destination: 'script', mode: 'cors',
            network: async () => js('export const v = "fresh";'),
        });
        assert.match(body, /fresh/);
        assert.deepEqual(fetchModes, ['no-cache'], 'the default mode returns a previous release from the HTTP cache');
        await settle(); await after(20, () => {});
        const keys = [.../** @type {Map<string, Response>} */ (stores.get(CACHE)).keys()];
        assert.ok(keys.some(k => k.endsWith('/calendar-app.js')));
    });
});

// ── THE REPOSITORY'S DOCUMENTS ARE THE NETWORK'S (trains-newlink-3) ─────────────────────────────
// The Pages mirror serves the whole repository, so the New link pack's PDFs under docs/ sit inside the
// mirror's scope. The cache-first branch stored each one a colleague opened in this release's cache
// and served that copy with no request at all — after the pack had been republished under the same
// name, until the next release. They are left to the browser now, on both addresses.
describe('service worker — a document under docs/ is never kept in the app\'s cache', () => {
    const pdf = (/** @type {string} */ body) => new Response(body, { status: 200, headers: { 'content-type': 'application/pdf' } });
    const MIRROR = 'https://garethdavidmiller.github.io/roster-app/';

    test('on the Pages mirror, a pack PDF opened in a new tab is left to the network', async () => {
        const r = await navigate({ scope: MIRROR, path: '/roster-app/docs/links-26/links-26-rules.pdf',
            network: async () => pdf('version 1'), unanswered: true });
        assert.equal(r.answered, false, 'the worker answered it, so the next open could come from its cache');
        assert.deepEqual(r.fetches, [], 'and it fetched nothing of its own to store');
    });

    test('so is any other file under docs/, an HTML one included, and on the main address too', async () => {
        for (const path of ['/docs/links-26/README.md', '/docs/links-26/presentations/', '/docs/links-26/x.html']) {
            const r = await navigate({ path, network: async () => ok('x'), unanswered: true });
            assert.equal(r.answered, false, path);
        }
    });

    test('CONTROL: the app\'s own icon is still answered from the cache — the pass-through is for docs/ alone', async () => {
        const { body, fetches } = await navigate({
            path: '/icon-192.png', mode: 'no-cors', destination: 'image',
            cached: { './icon-192.png': 'cached icon' }, network: async () => pdf('network icon'),
        });
        assert.equal(body, 'cached icon');
        assert.deepEqual(fetches, []);
    });
});
