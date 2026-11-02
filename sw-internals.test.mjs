// @ts-check
// sw-internals.test.mjs — unit tests for the PURE helper functions inside service-worker.js.
//
// service-worker.js is a CLASSIC service worker (registered without { type: 'module' } — see
// sw-register.js), so it cannot `import` an ES module and its helpers cannot be imported here the
// normal way. Physically extracting them into an importable module would require an
// `importScripts('./…')` change to the SW, whose real-worker load behaviour cannot be verified in
// this test environment (the e2e suite blocks the service worker) — a change to the highest-outage-
// risk file with no way to prove it here.
//
// Instead this test makes the helpers testable WITHOUT changing the SW at runtime: it reads the SW
// source, slices out each pure function BY NAME (brace-matched), and evaluates that exact source in
// a sandbox. So the assertions run against the SW's REAL code — no duplicate copy to drift, no
// runtime change. If a helper is renamed/removed the extraction throws and this test fails loudly,
// which is the intended drift signal.
//
// Covers: _appCacheVersion + compareAppCacheDesc (the v16.86 cross-version cache sort — previously
// only exercised by a one-off render check), ctSafe (content-type guard), unredirect (redirect strip).
// Part of test:hygiene (no mocks).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SW = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');

/**
 * Slice out a top-level `function <name>(…) { … }` from source by brace-matching from its opening
 * brace to the matching close. Nested object/block braces are balanced correctly; the SW helpers
 * contain no braces inside strings or comments, so a plain depth counter is sufficient.
 * @param {string} src @param {string} name
 */
function extractFn(src, name) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `service-worker.js no longer defines function ${name}() — update this test`);
    let i = src.indexOf('{', start);
    for (let depth = 0; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) { i++; break; }
    }
    return src.slice(start, i);
}

// Evaluate the four pure helpers' REAL source in one sandbox; Response is injected for unredirect.
const NAMES = ['_appCacheVersion', 'compareAppCacheDesc', 'ctSafe', 'unredirect'];
const body = NAMES.map(n => extractFn(SW, n)).join('\n');
const { _appCacheVersion, compareAppCacheDesc, ctSafe, unredirect } =
    new Function('Response', `${body}\nreturn { ${NAMES.join(', ')} };`)(Response);

// A minimal Response-like stub for ctSafe (it only reads headers.get). @param {string|null} ct
const resWithCt = (ct) => ({ headers: { get: () => ct } });

describe('_appCacheVersion', () => {
    test('parses a normal cache name to [major, minor]', () => {
        assert.deepEqual(_appCacheVersion('myb-roster-v16.85'), [16, 85]);
    });
    test('parses a two-digit minor and a .00 minor', () => {
        assert.deepEqual(_appCacheVersion('myb-roster-v17.00'), [17, 0]);
        assert.deepEqual(_appCacheVersion('myb-roster-v16.09'), [16, 9]);
    });
    test('a missing minor defaults to 0 (never NaN)', () => {
        assert.deepEqual(_appCacheVersion('myb-roster-v16'), [16, 0]);
    });
    test('a garbage suffix yields [0,0], never NaN (comparator safety)', () => {
        assert.deepEqual(_appCacheVersion('myb-roster-vXYZ'), [0, 0]);
    });
});

describe('compareAppCacheDesc', () => {
    test('sorts real (two-digit-minor) app caches NEWEST-first', () => {
        const names = ['myb-roster-v16.84', 'myb-roster-v17.00', 'myb-roster-v16.85', 'myb-roster-v16.99'];
        assert.deepEqual(
            [...names].sort(compareAppCacheDesc),
            ['myb-roster-v17.00', 'myb-roster-v16.99', 'myb-roster-v16.85', 'myb-roster-v16.84'],
            'major dominates; within 16.x the two-digit minor descends',
        );
    });
    test('major version dominates the minor', () => {
        assert.ok(compareAppCacheDesc('myb-roster-v17.00', 'myb-roster-v16.99') < 0, 'v17.00 sorts before v16.99');
    });
    test('minor compares as an INTEGER — a one-digit minor sorts below a larger two-digit one', () => {
        // Real cache names are always X.YY (2-digit minor from the bump script), so this never occurs
        // in practice; the test pins the documented integer-minor behaviour: 84 > 9, so v16.9 < v16.84.
        assert.ok(compareAppCacheDesc('myb-roster-v16.84', 'myb-roster-v16.9') < 0);
    });
    test('never returns NaN (which would corrupt the sort) even for malformed names', () => {
        const r = compareAppCacheDesc('myb-roster-vXYZ', 'myb-roster-v16.85');
        assert.ok(Number.isFinite(r), `comparator returned ${r}`);
    });
    test('equal versions compare as 0 (stable)', () => {
        assert.equal(compareAppCacheDesc('myb-roster-v16.85', 'myb-roster-v16.85'), 0);
    });
});

describe('ctSafe', () => {
    test('an .html asset accepts an html content-type', () => {
        assert.equal(ctSafe('index.html', resWithCt('text/html; charset=utf-8')), true);
    });
    test('an .html asset accepts a MISSING content-type (offline-first stub tolerance)', () => {
        assert.equal(ctSafe('index.html', resWithCt(null)), true);
    });
    test('an .html asset REJECTS a non-html content-type', () => {
        assert.equal(ctSafe('index.html', resWithCt('application/json')), false);
    });
    test('the scope root ("./" and "/") is treated as html', () => {
        assert.equal(ctSafe('./', resWithCt(null)), true);
        assert.equal(ctSafe('/', resWithCt('text/html')), true);
    });
    test('a JS asset REJECTS a text/html body (the interstitial-poisoning guard)', () => {
        assert.equal(ctSafe('calendar-app.js', resWithCt('text/html')), false);
    });
    test('a JS asset accepts its real JS content-type', () => {
        assert.equal(ctSafe('calendar-app.js', resWithCt('text/javascript')), true);
    });
    test('a non-html asset accepts a MISSING content-type', () => {
        assert.equal(ctSafe('icon-192.png', resWithCt(null)), true);
    });
    // Positive-validation tightening (v17.01, Finding #10): a non-html asset served with a
    // wrong-but-not-html content-type used to slip through (only text/html was rejected).
    test('a JS asset REJECTS a wrong non-html content-type (application/json)', () => {
        assert.equal(ctSafe('calendar-app.js', resWithCt('application/json')), false);
    });
    test('an .mjs asset accepts a JS content-type but rejects a JSON one', () => {
        assert.equal(ctSafe('purify.es.mjs', resWithCt('text/javascript')), true);
        assert.equal(ctSafe('purify.es.mjs', resWithCt('application/json')), false);
    });
    test('a CSS asset accepts text/css and rejects a mismatch', () => {
        assert.equal(ctSafe('index.css', resWithCt('text/css')), true);
        assert.equal(ctSafe('index.css', resWithCt('image/png')), false);
    });
    test('a PNG accepts image/png and rejects a mismatch', () => {
        assert.equal(ctSafe('icon-192.png', resWithCt('image/png')), true);
        assert.equal(ctSafe('icon-192.png', resWithCt('text/plain')), false);
    });
    test('a woff2 font accepts font/woff2', () => {
        assert.equal(ctSafe('fonts/inter-latin.woff2', resWithCt('font/woff2')), true);
    });
    test('manifest.json accepts application/manifest+json and application/json', () => {
        assert.equal(ctSafe('manifest.json', resWithCt('application/manifest+json')), true);
        assert.equal(ctSafe('manifest.json', resWithCt('application/json')), true);
    });
    test('an UNKNOWN extension keeps the lenient reject-only-html rule', () => {
        // A future asset kind must never be silently dropped: only a text/html body is rejected.
        assert.equal(ctSafe('data.xml', resWithCt('application/xml')), true);
        assert.equal(ctSafe('data.xml', resWithCt('text/html')), false);
    });
});

describe('unredirect', () => {
    test('a non-redirected response passes straight through (same object)', () => {
        const res = new Response('x', { status: 200 });
        assert.equal(unredirect(res), res);
    });
    test('a redirected response is re-wrapped as a fresh, non-redirected Response preserving status', () => {
        const orig = new Response('body', { status: 200, statusText: 'OK' });
        Object.defineProperty(orig, 'redirected', { value: true });
        const out = unredirect(orig);
        assert.notEqual(out, orig, 'must be a new Response');
        assert.equal(out.redirected, false, 'the redirected flag is cleared');
        assert.equal(out.status, 200);
    });
});

// ── THE SWEEP DELETES ONLY OLDER CACHES (v25.06, whole-app review) ───────────────────────────────
// The warm-up's sweep used to delete every `myb-roster-v*` cache but its own. An old worker that was
// still re-filling an incomplete cache when the next release installed — the new worker opens its
// cache the moment its script is evaluated — finished, deleted the NEWER cache, and the new worker's
// own sweep then deleted the old one: no app cache left, and an offline launch got the Offline page.
describe('isOlderVersion', () => {
    const isOlderVersion = new Function(`${extractFn(SW, 'isOlderVersion')}; return isOlderVersion;`)();
    test('compares dotted numeric versions part by part', () => {
        assert.equal(isOlderVersion('25.05', '25.06'), true);
        assert.equal(isOlderVersion('25.06', '25.05'), false, 'a NEWER version is never older');
        assert.equal(isOlderVersion('25.06', '25.06'), false, 'its own version is not older');
        assert.equal(isOlderVersion('25.09', '25.10'), true, 'numeric, not string order');
        assert.equal(isOlderVersion('24.99', '25.00'), true);
        assert.equal(isOlderVersion('12.18.2', '12.19.0'), true);
        assert.equal(isOlderVersion('12.19.0', '12.19'), false);
    });
    test('an unparseable name is kept, never swept', () => {
        assert.equal(isOlderVersion('test', '25.06'), false);
    });
});

describe('two workers sharing one Cache Storage — the newer cache survives', () => {
    test('an old worker finishing its warm-up late does not delete the next release\'s cache', async () => {
        const OLD = /const APP_VERSION = '([^']+)'/.exec(SW)?.[1] ?? '';
        const [maj, min] = OLD.split('.').map(Number);
        const NEW = `${maj}.${String(min + 1).padStart(2, '0')}`;
        const SW_NEW = SW.replace(`const APP_VERSION = '${OLD}'`, `const APP_VERSION = '${NEW}'`);
        const SCOPE = 'https://myb-roster.web.app/';
        /** @type {Map<string, Map<string, any>>} */ const named = new Map();
        const key = (/** @type {any} */ r) => new URL(typeof r === 'string' ? r : r.url, SCOPE).href;
        const makeCache = (/** @type {Map<string, any>} */ store) => ({
            async match(/** @type {any} */ r) { const v = store.get(key(r)); return v ? v.clone() : undefined; },
            async put(/** @type {any} */ r, /** @type {any} */ res) { store.set(key(r), res); },
            async keys() { return [...store.keys()]; },
        });
        const caches = {   // a deleted cache's handle keeps working but is unreachable by name (spec)
            async open(/** @type {string} */ n) { if (!named.has(n)) named.set(n, new Map()); return makeCache(/** @type {any} */ (named.get(n))); },
            async keys() { return [...named.keys()]; },
            async delete(/** @type {string} */ n) { return named.delete(n); },
            async match(/** @type {any} */ r) { for (const st of named.values()) { const v = await makeCache(st).match(r); if (v) return v; } return undefined; },
        };
        const ct = (/** @type {string} */ u) => /\.m?js$/.test(u) ? 'text/javascript' : u.endsWith('.css') ? 'text/css'
            : (u.endsWith('.html') || u.endsWith('/')) ? 'text/html' : u.endsWith('.json') ? 'application/json'
            : u.endsWith('.png') ? 'image/png' : u.endsWith('.woff2') ? 'font/woff2' : 'text/plain';
        const boot = (/** @type {string} */ src, /** @type {number} */ latencyMs) => {
            const ctx = {
                self: { registration: { scope: SCOPE, navigationPreload: null }, location: { origin: 'https://myb-roster.web.app' },
                        addEventListener() {}, skipWaiting() {}, clients: { claim: async () => {} } },
                caches, setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} },
                fetch: (/** @type {any} */ req) => new Promise(res => setTimeout(() => {
                    const url = typeof req === 'string' ? req : req.url;
                    res(new Response('x', { status: 200, headers: { 'content-type': ct(url) } }));
                }, latencyMs)),
                Request: class extends Request { constructor(/** @type {any} */ i, /** @type {any} */ o) { super(typeof i === 'string' ? new URL(i, SCOPE).href : i, o); } },
                Response, Headers, URL, AbortController, Promise,
            };
            vm.createContext(ctx);
            vm.runInContext(src, ctx);
        };
        boot(SW, 1);                                   // the old worker wakes with its marker missing
        await new Promise(r => setTimeout(r, 5));
        boot(SW_NEW, 4);                               // the next release installs and opens its cache
        await new Promise(r => setTimeout(r, 1500));   // both warm-ups run to completion
        assert.ok(named.has(`myb-roster-v${NEW}`), 'the NEWER cache must still be reachable by name');
        assert.ok(!named.has(`myb-roster-v${OLD}`), 'and the new worker, once complete, sweeps the old');
    });
});

