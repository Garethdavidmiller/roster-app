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
        getDocs: async (q) => ({ docs: (opts.queryResults?.(q) || []).map(r => ({ id: r.id, data: () => r })) }),
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

    test('Resolve goes through the GATED write and stamps resolvedAt', async () => {
        const { client, writes, gated } = harness();
        await client.resolveClientError('e1');
        assert.equal(gated.length, 1, 'an unconfirmed write must be able to stop it');
        assert.deepEqual(writes[0], { path: 'clientErrors/e1', data: { resolved: true, resolvedAt: 'TS' }, merge: true });
    });
});
