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

const DAY = 86_400_000;
const ts = (ms) => ({ toMillis: () => ms });

/** A recording fake. `docs` maps a `collection/id` path to its data; `queryResults` answers getDocs. */
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
            return { exists: () => d !== undefined, data: () => d };
        },
        getDocs: async (q) => {
            if (opts.getDocsThrows?.(q)) throw new Error('query failed');
            // A query's limit is honoured, as Firestore's is — a cap the fake ignored could not be tested.
            const lim = q.parts.find(p => p.limit !== undefined)?.limit ?? Infinity;
            return { docs: (opts.queryResults?.(q) || []).slice(0, lim).map(r => ({ id: r.id, data: () => r })) };
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
