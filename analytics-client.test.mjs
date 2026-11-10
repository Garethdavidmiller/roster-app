// @ts-nocheck
/**
 * analytics-client.test.mjs — the error log and the usage/speed counters, EXECUTED against a fake
 * Firestore (v24.64). Possible only because `analytics-client.js` takes its Firebase handles as
 * arguments; while this code lived in `firebase-client.js` none of it could load in Node.
 *
 * Organised by the module's two properties (its header): telemetry never affects the app, and no
 * counter carries an identity — plus the error log's own promises, that an overflow is SAID and that
 * the admin's Resolve goes through the gated write.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalyticsClient } from './analytics-client.js';
import { monthKey, prevMonthKey } from './usage-stats.js';

const DAY = 86_400_000;
const ts = (ms) => ({ toMillis: () => ms });

/** A recording fake. `docs` maps a `collection/id` path to its data; `queryResults` answers getDocs;
 *  `fromCache(pathOrQuery)` marks that read as answered by the device's offline cache. */
function harness(opts = {}) {
    const writes = [];
    const deletes = [];
    const updates = [];
    const docs = new Map(Object.entries(opts.docs || {}));
    const gated = [];
    class FieldPath { constructor(...segs) { this.segs = segs; } }
    const fs = {
        doc: (_db, c, id) => ({ path: `${c}/${id}` }),
        collection: (_db, c) => ({ path: c }),
        where: (f, op, v) => ({ where: [f, op, v] }),
        limit: (n) => ({ limit: n }),
        query: (col, ...parts) => ({ col: col.path, parts }),
        getDoc: async (ref) => {
            if (opts.getDocThrows?.(ref.path)) throw new Error('read failed');
            const d = docs.get(ref.path);
            return { exists: () => d !== undefined, data: () => d, metadata: { fromCache: !!opts.fromCache?.(ref.path) } };
        },
        getDocs: async (q) => {
            if (opts.getDocsThrows?.(q)) throw new Error('query failed');
            // A query's limit is honoured, as Firestore's is — a cap the fake ignored could not be tested.
            const lim = q.parts.find(p => p.limit !== undefined)?.limit ?? Infinity;
            return { docs: (opts.queryResults?.(q) || []).slice(0, lim).map(r => ({ id: r.id, data: () => r })),
                metadata: { fromCache: !!opts.fromCache?.(q) } };
        },
        setDoc: async (ref, data, o) => { if (opts.setDocRejects) throw new Error('denied'); writes.push({ path: ref.path, data, merge: !!o?.merge }); },
        addDoc: async (col, data) => { if (opts.addDocRejects) throw new Error('denied'); writes.push({ path: col.path, data }); },
        deleteDoc: async (ref) => { deletes.push(ref.path); },
        updateDoc: (ref, field, value) => {
            if (opts.updateThrows) throw new Error('storage wedged');   // SYNCHRONOUS — past any .catch
            if (!(field instanceof FieldPath)) throw new Error('a dotted path with a digit-led segment is invalid');
            updates.push({ path: ref.path, field: field.segs, value });
            return Promise.resolve();
        },
        serverTimestamp: () => 'TS',
        increment: (n) => ({ inc: n }),
        deleteField: () => 'DEL',
        FieldPath,
    };
    const client = buildAnalyticsClient({
        db: {}, collections: { clientErrors: 'clientErrors', analytics: 'analytics' }, fs,
        writeWithClaimRetry: (fn) => { gated.push(true); return fn(); },
        appVersion: '24.64',
    });
    return { client, writes, deletes, updates, gated };
}

describe('telemetry never affects the app', () => {
    test('a refused error write is swallowed — the reporter never throws', async () => {
        const { client } = harness({ addDocRejects: true });
        assert.doesNotThrow(() => client.logClientError({ memberName: 'G. Miller', page: 'calendar', message: 'x', stack: '', appVersion: '24.64', userAgent: 'UA' }));
        await new Promise(r => setTimeout(r, 0));   // an unhandled rejection would fail the run here
    });

    test('refused counter writes are swallowed too', async () => {
        const { client } = harness({ setDocRejects: true });
        client.recordPageView('calendar');
        client.recordActiveAccount({ month: '2026-10' });
        client.recordOriginUse({ day: '2026-10-06', origin: 'web.app' });
        await new Promise(r => setTimeout(r, 0));
    });

    test('the Usage read survives its own prune — stale buckets go by FieldPath, never a dotted string', async () => {
        const { client, updates } = harness({ docs: {
            'analytics/activeAccounts': { months: {}, daily: { '2020-01-01': 3 } },
            'analytics/origins': { daily: { '2020-01-01|web.app': 1 } },
        } });
        const stats = await client.getUsageStats();
        assert.equal(stats.month.length, 7);
        assert.deepEqual(updates.map(u => u.field), [['daily', '2020-01-01'], ['daily', '2020-01-01|web.app']]);
        assert.ok(updates.every(u => u.value === 'DEL'));
    });

    test('a prune that throws SYNCHRONOUSLY still cannot reject the read', async () => {
        const { client } = harness({ updateThrows: true, docs: {
            'analytics/activeAccounts': { months: {}, daily: { '2020-01-01': 3 } },
            'analytics/origins': { daily: { '2020-01-01|web.app': 1 } },
        } });
        const stats = await client.getUsageStats();
        assert.equal(typeof stats.accountsLast30, 'number');
    });

    test('a missing origins document is the empty picture, not an error', async () => {
        const { client } = harness({ getDocThrows: (p) => p === 'analytics/origins' });
        const stats = await client.getUsageStats();
        assert.deepEqual(stats.origins, []);
    });
});

describe('no identity in a counter', () => {
    test('active accounts tick only the buckets the caller decided, and nothing at all for none', () => {
        const { client, writes } = harness();
        client.recordActiveAccount({});
        assert.equal(writes.length, 0, 'no bucket, no write');
        client.recordActiveAccount({ day: '2026-10-06' });
        return new Promise(r => setTimeout(r, 0)).then(() => {
            assert.deepEqual(writes[0], { path: 'analytics/activeAccounts', data: { daily: { '2026-10-06': { inc: 1 } } }, merge: true });
        });
    });

    test('a first INSTALLED open by an already-counted account ticks the install, not the visit', async () => {
        const { client, writes } = harness();
        client.recordOriginUse({ day: '2026-10-06', origin: 'web.app', installed: true, countVisit: false });
        await new Promise(r => setTimeout(r, 0));
        const keys = Object.keys(writes[0].data.daily);
        assert.equal(keys.length, 1);
        assert.match(keys[0], /\|pwa$/);
    });

    test('a MOVED rolling count is one merged write: +1 on today, -1 on the day it left (v25.00)', async () => {
        // One write, not two: two could land half-way, leaving a member counted twice or not at all.
        const { client, writes } = harness();
        client.recordActiveAccount({ day: '2026-10-09', fromDay: '2026-10-01' });
        client.recordActiveAccount({ day: '2026-10-09', fromDay: '2026-10-09' });   // never a -1 on today
        client.recordOriginUse({ day: '2026-10-09', origin: 'web', countVisit: true, fromDay: '2026-10-01',
            installed: true, fromPwaDay: '2026-10-02' });
        await new Promise(r => setTimeout(r, 0));
        assert.deepEqual(writes[0].data, { daily: { '2026-10-09': { inc: 1 }, '2026-10-01': { inc: -1 } } });
        assert.deepEqual(writes[1].data, { daily: { '2026-10-09': { inc: 1 } } });
        assert.deepEqual(writes[2].data, { daily: {
            '2026-10-09|web': { inc: 1 }, '2026-10-01|web': { inc: -1 },
            '2026-10-09|web|pwa': { inc: 1 }, '2026-10-02|web|pwa': { inc: -1 },
        } });
        assert.ok(writes.every(w => w.merge), 'merged, so the other counters in the document stay');
    });

    test('a page view is one merged increment in the month\'s document, keyed by page only', async () => {
        const { client, writes } = harness();
        client.recordPageView('paycalc');
        await new Promise(r => setTimeout(r, 0));
        assert.match(writes[0].path, /^analytics\/pv_\d{4}-\d{2}$/);
        assert.deepEqual(Object.keys(writes[0].data.counts), ['paycalc']);
    });
});

describe('the error log', () => {
    test('more than 100 unresolved is SAID — truncated — and exactly 100 is not', async () => {
        const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, resolved: false, timestamp: ts(i) }));
        for (const [n, expected] of [[101, true], [100, false]]) {
            const { client } = harness({ queryResults: (q) => (q.parts[0].where[2] === false ? rows(n) : []) });
            const { errors, truncated } = await client.getClientErrors();
            assert.equal(truncated, expected, `${n} unresolved`);
            assert.equal(errors.length, 100);
        }
    });

    test('resolved records past retention are pruned; recent ones are kept', async () => {
        const now = Date.now();
        const { client, deletes } = harness({ queryResults: (q) => (q.parts[0].where[2] === true ? [
            { id: 'old', resolved: true, resolvedAt: ts(now - 120 * DAY), timestamp: ts(now - 121 * DAY) },
            { id: 'new', resolved: true, resolvedAt: ts(now - 1 * DAY), timestamp: ts(now - 2 * DAY) },
        ] : []) });
        await client.getClientErrors();
        assert.deepEqual(deletes, ['clientErrors/old']);
    });

    // ── PAST 200 RESOLVED (Nov 2026) ─────────────────────────────────────────────────────────────
    // The resolved read is `limit(200)` with no order, so past 200 Firestore hands back the 200 lowest
    // document ids — and the prune and the "recently resolved" rows both worked on that arbitrary 200.
    const resolvedRows = (/** @type {number} */ n, /** @type {number} */ now) => Array.from({ length: n },
        (_, i) => ({ id: `r${i}`, resolved: true, resolvedAt: ts(now - DAY), timestamp: ts(now - 2 * DAY) }));
    const isExpiryRead = (/** @type {any} */ q) => q.parts[0].where[0] === 'resolvedAt';

    test('an expired record OUTSIDE the resolved window is still pruned — the prune asks for it itself', async () => {
        const now = Date.now();
        const old = { id: 'past-the-window', resolved: true, resolvedAt: ts(now - 120 * DAY), timestamp: ts(now - 121 * DAY) };
        const { client, deletes } = harness({ queryResults: (q) => isExpiryRead(q) ? [old]
            : (q.parts[0].where[2] === true ? resolvedRows(201, now) : []) });
        await client.getClientErrors();
        assert.deepEqual(deletes, ['clientErrors/past-the-window']);
    });

    test('the expiry read asks by resolvedAt alone, before the retention cut-off — no composite index', async () => {
        const seen = /** @type {any[]} */ ([]);
        const { client } = harness({ queryResults: (q) => { seen.push(q); return []; } });
        const t0 = Date.now();
        await client.getClientErrors();
        const expiry = seen.find(isExpiryRead);
        assert.ok(expiry, 'the prune makes its own read');
        assert.equal(expiry.parts.length, 2, 'one filter and a limit — nothing that needs a composite index');
        assert.equal(expiry.parts[0].where[1], '<');
        const cut = /** @type {Date} */ (expiry.parts[0].where[2]).getTime();
        assert.ok(Math.abs(cut - (t0 - 90 * DAY)) < 5000, 'the cut-off is the 90-day retention, measured from resolution');
    });

    test('more than 200 resolved is SAID — resolvedTruncated — and exactly 200 is not', async () => {
        const now = Date.now();
        for (const [n, expected] of [[201, true], [200, false]]) {
            const { client } = harness({ queryResults: (q) => (!isExpiryRead(q) && q.parts[0].where[2] === true ? resolvedRows(n, now) : []) });
            const { resolvedTruncated } = await client.getClientErrors();
            assert.equal(resolvedTruncated, expected, `${n} resolved`);
        }
    });

    test('the expiry read failing costs the prune, never the Error Log', async () => {
        const now = Date.now();
        const old = { id: 'old', resolved: true, resolvedAt: ts(now - 120 * DAY), timestamp: ts(now - 121 * DAY) };
        const { client, deletes } = harness({
            getDocsThrows: isExpiryRead,
            queryResults: (q) => (q.parts[0].where[2] === true ? [old] : []),
        });
        const { errors } = await client.getClientErrors();
        assert.ok(Array.isArray(errors), 'the card still gets its list');
        assert.deepEqual(deletes, ['clientErrors/old'], 'and what the resolved read saw is still pruned');
    });

    test('Resolve goes through the GATED write and stamps resolvedAt', async () => {
        const { client, writes, gated } = harness();
        await client.resolveClientError('e1');
        assert.equal(gated.length, 1, 'an unconfirmed write must be able to stop it');
        assert.deepEqual(writes[0], { path: 'clientErrors/e1', data: { resolved: true, resolvedAt: 'TS' }, merge: true });
    });
});

// ── A READ THE OFFLINE CACHE ANSWERED IS A FAILED LOAD (settings-ops-1, Nov 2026) ────────────────
// Offline, Firestore does not fail these reads: it answers from this device's cache, as of whenever it
// last heard, and the cards painted that as current — "✓ No errors recorded." over errors it had never
// seen. Each document is refused ON ITS OWN, so each read below is marked alone: a guard that skipped
// one of them would leave that one's test red.
describe('a read the offline cache answered is a failed load (settings-ops-1)', () => {
    /** The SDK's own code for "the client is offline", which every Operations card reads as "Couldn't load". */
    const offline = (/** @type {any} */ e) => e?.code === 'unavailable';
    const settle = () => new Promise(r => setTimeout(r, 0));
    const now = Date.now();
    const expired = (/** @type {string} */ id) => ({ id, resolved: true, resolvedAt: ts(now - 120 * DAY), timestamp: ts(now - 121 * DAY) });
    const isList = (/** @type {boolean} */ resolved) => (/** @type {any} */ q) => q.parts[0].where[0] === 'resolved' && q.parts[0].where[2] === resolved;
    const isExpiryRead = (/** @type {any} */ q) => q.parts[0].where[0] === 'resolvedAt';

    for (const [which, fromCache] of /** @type {const} */ ([['unresolved', isList(false)], ['resolved', isList(true)]])) {
        test(`the error log: the ${which} list from the cache fails the load, and no prune runs on it`, async () => {
            const { client, deletes } = harness({ fromCache, queryResults: (q) => (isList(true)(q) ? [expired('old')] : []) });
            await assert.rejects(client.getClientErrors(), offline);
            await settle();
            assert.deepEqual(deletes, [], 'no delete decided on the cache\'s copy');
        });
    }

    test('the error log: the prune\'s own read from the cache costs the prune, never the log', async () => {
        // Its failure path already exists — the prune falls back to what the resolved list saw — and a
        // cached answer takes it, rather than deleting on the cache's word.
        const { client, deletes } = harness({ fromCache: isExpiryRead, queryResults: (q) => (isExpiryRead(q) ? [expired('cached-old')] : []) });
        const { errors } = await client.getClientErrors();
        await settle();
        assert.deepEqual(errors, [], 'the log itself still loads');
        assert.deepEqual(deletes, []);
    });

    const d = new Date();
    for (const path of [`analytics/perf_${monthKey(d)}`, `analytics/perf_${prevMonthKey(d)}`]) {
        test(`App Speed: ${path} from the cache fails the load`, async () => {
            // Both months EXIST: offline, an uncached document already rejects, so only a cached one tests this.
            const { client } = harness({ fromCache: (p) => p === path, docs: {
                [`analytics/perf_${monthKey(d)}`]: { samples: {} }, [`analytics/perf_${prevMonthKey(d)}`]: { samples: {} },
            } });
            await assert.rejects(client.getPerfStats(), offline);
        });
    }

    const usageDocs = {
        [`analytics/pv_${monthKey(d)}`]: { counts: { calendar: 4 } },
        [`analytics/pv_${prevMonthKey(d)}`]: { counts: { calendar: 2 } },
        'analytics/activeAccounts': { months: {}, daily: { '2020-01-01': 3 } },
        'analytics/origins': { daily: { '2020-01-01|web.app': 1 } },
    };
    for (const path of Object.keys(usageDocs)) {
        test(`Usage: ${path} from the cache fails the load, and nothing is pruned`, async () => {
            // The origins read keeps its own soft failure for a document it cannot read; a CACHED one
            // means the device is offline, so it fails the card like the rest rather than reading as
            // "No opens recorded yet".
            const { client, updates } = harness({ fromCache: (p) => p === path, docs: usageDocs });
            await assert.rejects(client.getUsageStats(), offline);
            await settle();
            assert.deepEqual(updates, [], 'no prune decided on the cache\'s copy');
        });
    }
});
