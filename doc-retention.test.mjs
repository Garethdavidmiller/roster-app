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
 *
 * ── THE HARNESS USED TO RE-STATE THE RULE, SO IT COULD NOT SEE IT BREAK ──────────────────────────
 *
 * A later mutation sweep found all THREE arguments of the retention query unguarded — `'<'` flipped
 * to `'>'`, widened to `'<='`, and the field swapped from `date` to `uploadedAt` all survived every
 * lane — and the cause was here, not in the module. The `where` fake discarded the field and the
 * operator (`(_f, _op, value) => ({ value })`) and `getDocs` then re-implemented the filter itself,
 * `id < q.w.value`. Whatever the module asked for, the harness swept by the rule it remembered.
 *
 * The fake now RECORDS `(field, op, value)` and applies exactly that predicate to each document's
 * own data. Invert the operator and this fake deletes what Firestore would have deleted: every
 * current Circular and Newsletter, and its Storage object, on the next upload.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pruneOldDocs } from './doc-retention.js';
import { sixMonthCutoffISO } from './storage-utils.js';

const COLL = 'circulars';
const TODAY = '2026-08-27';
const ts = (iso) => ({ toDate: () => new Date(iso) });

/**
 * Apply ONE recorded `where` clause to a document's own data, as the server would.
 * Deliberately NOT "the filter this sweep is supposed to use" — that restatement is what let three
 * mutations of the real query pass. An operator this fake does not model throws, because a clause
 * silently matching nothing is indistinguishable from a collection with nothing in it.
 */
function applyWhere(c, data) {
    const actual = data?.[c.field];
    switch (c.op) {
        case '<':  return actual <   c.value;
        case '<=': return actual <=  c.value;
        case '>':  return actual >   c.value;
        case '>=': return actual >=  c.value;
        case '==': return actual === c.value;
        default: throw new Error(`fake Firestore: unmodelled operator ${JSON.stringify(c.op)}`);
    }
}

/**
 * A Firestore fake holding date-keyed metadata documents.
 * `onBeforeDelete` is the seam that lets a test slip a competing writer between the query and the
 * transaction — the interleaving the audit described, which no ordering of real calls can force.
 * `queries` records what was actually ASKED, so a test can assert on the clause as well as on what
 * it swept.
 */
function makeFs(docs, { onBeforeDelete } = {}) {
    const store = new Map(Object.entries(docs));
    const snapOf = (id) => ({ id, exists: () => store.has(id), data: () => store.get(id) });
    const deleted = [];
    const queries = [];
    const fs = {
        db: {},
        doc: (_db, _c, id) => ({ id }),
        getDoc: async (ref) => snapOf(ref.id),
        collection: (_db, c) => ({ c }),
        query: (coll, ...constraints) => ({ coll, constraints }),
        where: (field, op, value) => ({ field, op, value }),
        getDocs: async (q) => {
            queries.push(q);
            return {
                docs: [...store.entries()]
                    .filter(([, data]) => q.constraints.every((c) => applyWhere(c, data)))
                    .map(([id]) => snapOf(id)),
            };
        },
        runTransaction: async (_db, fn) => fn({
            get: async (ref) => snapOf(ref.id),
            delete: (ref) => { deleted.push(ref.id); store.delete(ref.id); },
        }),
    };
    if (onBeforeDelete) {
        const inner = fs.runTransaction;
        fs.runTransaction = async (db, fn) => { onBeforeDelete(store); return inner(db, fn); };
    }
    return { fs, store, deleted, queries };
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

describe('the query asks for OLD documents — field, operator and boundary', () => {
    // All three arguments of `where('date', '<', cutoff)` survived mutation until the harness above
    // stopped restating the filter. They fail in different directions and only one is visible:
    // `>` sweeps every CURRENT document and spares the old ones; `<=` takes one day too many;
    // `uploadedAt` prunes by when a file arrived rather than what it is about.
    const SERVER_NOW = '2026-03-01T10:00:00Z';
    const CUTOFF = sixMonthCutoffISO(new Date(SERVER_NOW));   // the real rule, not a hand-typed date
    const anchor = { date: TODAY, storagePath: `${COLL}/${TODAY}-new.pdf`, uploadedAt: ts(SERVER_NOW) };

    test('it asks by DATE, strictly EARLIER than the cutoff', async () => {
        const { fs, queries } = makeFs({ [TODAY]: anchor });
        const st = makeStorage();
        await pruneOldDocs(COLL, TODAY, {}, st.refFn, st.deleteObject, fs);

        assert.equal(queries.length, 1, 'one sweep query');
        assert.deepEqual(queries[0].constraints, [{ field: 'date', op: '<', value: CUTOFF }]);
    });

    test('a CURRENT document is never the one swept', async () => {
        // The destructive direction, and the one with no warning: an inverted operator deletes the
        // live Circular and its Storage object on the very next upload, leaving the expired ones.
        const current = '2026-02-20';   // inside retention by server time
        const { fs, store, deleted } = makeFs({
            [current]: oldDoc(current),
            '2025-01-01': oldDoc('2025-01-01'),
            [TODAY]: anchor,
        });
        const st = makeStorage();
        await pruneOldDocs(COLL, TODAY, {}, st.refFn, st.deleteObject, fs);

        assert.ok(store.has(current), 'a document inside retention must survive its own sweep');
        assert.deepEqual(st.removed, [`${COLL}/2025-01-01-old.pdf`], 'and only the expired file goes');
        assert.deepEqual(deleted, ['2025-01-01']);
    });

    test('a document dated EXACTLY on the cutoff survives — six months is not yet expired', async () => {
        // The boundary `<` vs `<=`, and the only shape that can tell them apart. Every other
        // fixture here sits comfortably one side or the other, which is why the widening passed.
        const { fs, store, deleted } = makeFs({ [CUTOFF]: oldDoc(CUTOFF), [TODAY]: anchor });
        const st = makeStorage();
        await pruneOldDocs(COLL, TODAY, {}, st.refFn, st.deleteObject, fs);

        assert.ok(store.has(CUTOFF), `${CUTOFF} is the cutoff itself, not past it`);
        assert.deepEqual(deleted, []);
    });

    test('retention is keyed on what the document is ABOUT, not when it arrived', async () => {
        // A backdated correction uploaded this morning for a date eight months gone is old data and
        // goes; keying on `uploadedAt` would keep it for another six months, and would equally
        // delete a current document somebody re-uploaded a year ago.
        const backdated = '2025-01-05';
        const { fs, deleted } = makeFs({
            [backdated]: { date: backdated, storagePath: `${COLL}/${backdated}-old.pdf`,
                           fileType: 'pdf', uploadedAt: ts(SERVER_NOW) },   // arrived just now
            [TODAY]: anchor,
        });
        const st = makeStorage();
        await pruneOldDocs(COLL, TODAY, {}, st.refFn, st.deleteObject, fs);

        assert.deepEqual(deleted, [backdated]);
        assert.deepEqual(st.removed, [`${COLL}/${backdated}-old.pdf`]);
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
