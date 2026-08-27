/**
 * doc-retention.test.mjs — the six-month sweep, driven against fakes (v21.86).
 *
 * Run: node --test doc-retention.test.mjs   (part of `npm run test:hygiene`)
 *
 * This is the only destructive operation the browser performs on shared data and it had no tests
 * for nineteen versions, because it lived inside `firebase-client.js` — a module that imports the
 * Firebase SDK from gstatic and so cannot be loaded in Node. An external audit found two defects in
 * it by reading the source, which was the only method available to anybody.
 *
 * Organised by what each defect DESTROYS, since a retention bug is never merely untidy:
 *   · a clock months fast deletes documents that are still current, on a schedule nobody set;
 *   · a stale delete removes the FRESH metadata for a date somebody just re-uploaded, and then
 *     cleans up the OLD file — so the document vanishes and the new file is orphaned.
 * And one block for the other direction, because a sweep too timid to delete anything is a silent
 * failure too: the collection just grows.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pruneOldDocs } from './doc-retention.js';

const COLL = 'circulars';
const TODAY = '2026-08-27';
const ts = (iso) => ({ toDate: () => new Date(iso) });

/**
 * A Firestore fake holding date-keyed metadata documents.
 * `onBeforeDelete` is the seam that lets a test slip a competing writer between the query and the
 * transaction — the interleaving the audit described, which no ordering of real calls can force.
 */
function makeFs(docs, { onBeforeDelete } = {}) {
    const store = new Map(Object.entries(docs));
    const snapOf = (id) => ({ id, exists: () => store.has(id), data: () => store.get(id) });
    const deleted = [];
    const fs = {
        db: {},
        doc: (_db, _c, id) => ({ id }),
        getDoc: async (ref) => snapOf(ref.id),
        collection: (_db, c) => ({ c }),
        query: (_c, w) => ({ w }),
        where: (_f, _op, value) => ({ value }),
        getDocs: async (q) => ({
            docs: [...store.keys()].filter((id) => id < q.w.value).map(snapOf),
        }),
        runTransaction: async (_db, fn) => fn({
            get: async (ref) => snapOf(ref.id),
            delete: (ref) => { deleted.push(ref.id); store.delete(ref.id); },
        }),
    };
    if (onBeforeDelete) {
        const inner = fs.runTransaction;
        fs.runTransaction = async (db, fn) => { onBeforeDelete(store); return inner(db, fn); };
    }
    return { fs, store, deleted };
}

function makeStorage() {
    const removed = [];
    return { removed, refFn: (_s, path) => ({ path }), deleteObject: async (r) => { removed.push(r.path); } };
}

const oldDoc  = (id) => ({ date: id, storagePath: `${COLL}/${id}-old.pdf`, fileType: 'pdf', uploadedAt: ts(`${id}T09:00:00Z`) });

describe('the clock must be the SERVER\'s', () => {
    test('the cutoff follows the SERVER time, not this machine\'s', async () => {
        // The two clocks must give DIFFERENT answers or the test proves nothing. The first draft
        // anchored the server at today's real date, so `new Date()` and the server agreed and the
        // case passed with the old client-clock code still in — found by mutation.
        //
        // Server says 1 March 2026 → cutoff 1 Sep 2025.  A document dated 1 Dec 2025 is INSIDE
        // retention and must survive. A machine whose clock reads the real "now" (late Aug 2026)
        // would put the cutoff at the end of Feb 2026 and delete it.
        const SERVER_NOW = '2026-03-01T10:00:00Z';
        const docs = {
            '2025-12-01': oldDoc('2025-12-01'),          // inside retention BY SERVER TIME
            '2025-01-01': oldDoc('2025-01-01'),          // expired under either clock
            [TODAY]: { date: TODAY, storagePath: `${COLL}/${TODAY}-new.pdf`, uploadedAt: ts(SERVER_NOW) },
        };
        const { fs, store, deleted } = makeFs(docs);
        const st = makeStorage();
        await pruneOldDocs(COLL, TODAY, {}, st.refFn, st.deleteObject, fs);

        assert.ok(store.has('2025-12-01'),
            'a document still inside retention by SERVER time must survive a faster local clock');
        assert.deepEqual(deleted, ['2025-01-01'], 'and the genuinely expired one still goes');
    });

    test('no server timestamp on the anchor → NOTHING is swept', async () => {
        // Fail safe rather than fall back to the local clock: retention is housekeeping and the
        // next upload runs it again, so there is no version of this worth guessing a date for.
        const { fs, deleted } = makeFs({
            '2020-01-01': oldDoc('2020-01-01'),
            [TODAY]: { date: TODAY, storagePath: 'x' },      // no uploadedAt
        });
        const st = makeStorage();
        await pruneOldDocs(COLL, TODAY, {}, st.refFn, st.deleteObject, fs);
        assert.deepEqual(deleted, []);
        assert.deepEqual(st.removed, []);
    });

    test('an unreadable anchor → NOTHING is swept', async () => {
        const { fs, deleted } = makeFs({ '2020-01-01': oldDoc('2020-01-01') });
        fs.getDoc = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
        const st = makeStorage();
        await pruneOldDocs(COLL, TODAY, {}, st.refFn, st.deleteObject, fs);
        assert.deepEqual(deleted, []);
    });
});

describe('delete only what was read', () => {
    test('a date re-uploaded between the query and the delete is LEFT ALONE', async () => {
        // The audit's interleaving. Without the re-read this deletes the fresh metadata and then
        // removes the old object: the document is gone and the new file is orphaned.
        const docs = {
            '2025-12-01': oldDoc('2025-12-01'),
            [TODAY]: { date: TODAY, storagePath: 'x', uploadedAt: ts('2026-08-27T10:00:00Z') },
        };
        const { fs, store, deleted } = makeFs(docs, {
            onBeforeDelete: (s) => {
                // Somebody re-uploads a corrected file for that old date, right now.
                if (s.has('2025-12-01')) {
                    s.set('2025-12-01', { date: '2025-12-01', storagePath: `${COLL}/2025-12-01-FRESH.pdf`, fileType: 'pdf' });
                }
            },
        });
        const st = makeStorage();
        await pruneOldDocs(COLL, TODAY, {}, st.refFn, st.deleteObject, fs);

        assert.deepEqual(deleted, [], 'the replacement survives');
        assert.equal(store.get('2025-12-01').storagePath, `${COLL}/2025-12-01-FRESH.pdf`);
        assert.deepEqual(st.removed, [], 'and the new file is not orphaned by a stale cleanup');
    });

    test('a document already gone is not an error', async () => {
        const docs = {
            '2025-12-01': oldDoc('2025-12-01'),
            [TODAY]: { date: TODAY, storagePath: 'x', uploadedAt: ts('2026-08-27T10:00:00Z') },
        };
        const { fs, deleted } = makeFs(docs, { onBeforeDelete: (s) => s.delete('2025-12-01') });
        const st = makeStorage();
        await pruneOldDocs(COLL, TODAY, {}, st.refFn, st.deleteObject, fs);
        assert.deepEqual(deleted, []);
        assert.deepEqual(st.removed, []);
    });
});

describe('and it still actually sweeps', () => {
    test('an unchanged expired document is removed from BOTH systems', async () => {
        // The opposite failure: a guard too cautious to delete leaves the collection growing for
        // ever, which is the thing this function exists to prevent.
        const docs = {
            '2025-01-01': oldDoc('2025-01-01'),
            '2025-02-01': oldDoc('2025-02-01'),
            [TODAY]: { date: TODAY, storagePath: 'x', uploadedAt: ts('2026-08-27T10:00:00Z') },
        };
        const { fs, deleted } = makeFs(docs);
        const st = makeStorage();
        await pruneOldDocs(COLL, TODAY, {}, st.refFn, st.deleteObject, fs);

        assert.deepEqual(deleted.sort(), ['2025-01-01', '2025-02-01']);
        assert.deepEqual(st.removed.sort(),
            [`${COLL}/2025-01-01-old.pdf`, `${COLL}/2025-02-01-old.pdf`],
            'Firestore first, then Storage — the ordering that leaves an orphan rather than a 404');
    });

    test('the just-uploaded document is never swept, however old its date', async () => {
        // A historical correction: an admin uploads a file dated eight months ago. It must survive
        // its own prune, or the upload deletes itself.
        const backdated = '2025-12-01';
        const docs = { [backdated]: { date: backdated, storagePath: 'fresh', uploadedAt: ts('2026-08-27T10:00:00Z') } };
        const { fs, deleted } = makeFs(docs);
        const st = makeStorage();
        await pruneOldDocs(COLL, backdated, {}, st.refFn, st.deleteObject, fs);
        assert.deepEqual(deleted, []);
    });
});
