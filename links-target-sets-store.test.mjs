/**
 * links-target-sets-store.test.mjs — the Firestore half of the saved staffing sets.
 * Run: node --test links-target-sets-store.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THIS FILE EXISTS. Until v22.57 this code lived inside `links-app.js` and could not be tested
 * at all: a transaction with a conflict window in it, inside a coordinator that imports the gstatic
 * Firebase SDK, so nothing about it would load in Node. Both halves had shipped defects — the read
 * collapsed a failure into an empty list (twice, at v21.07 and again at v22.56), and the write's
 * version check is the only thing standing between a confirm dialog's think-time and somebody
 * else's set being destroyed with no bin behind it.
 *
 * Organised by WHAT A WRONG ANSWER COSTS, because the two directions are not symmetrical:
 *
 *   - Reporting NOTHING when the read failed is silent and misleading, and these sets are SHARED —
 *     the designer concludes a colleague deleted them. This is the shipped defect.
 *   - Writing over a version nobody was shown destroys another designer's work, and for a delete
 *     there is no recovery. That window is forced here with an `onRead` seam, the same trick
 *     `links-design-store.test.mjs` uses, because no ordering of real calls can produce it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createTargetSetStore } from './links-target-sets-store.js';

/** A set document as Firestore hands it back. `updatedAt` is a Timestamp-alike. */
const ts = (/** @type {number} */ ms) => ({ toMillis: () => ms });
const setDoc = (/** @type {string} */ id, /** @type {number} */ at, extra = {}) => ({
    id, name: `Set ${id}`, createdBy: 'G. Miller', updatedBy: 'G. Miller',
    updatedAt: ts(at), slots: [{ time: '06:20-13:30', weekday: 1, sat: 0, sun: 0 }],
    spareLines: 0, ...extra,
});

/**
 * A fake Firestore with one seam: `onRead` runs INSIDE the transaction, between its read and its
 * commit. That is the whole point — it is the interleaving a real client cannot be made to produce.
 */
function fakeDb({ docs = {}, onRead = null, failList = false } = {}) {
    const store = { ...docs };
    const calls = { sets: [], deletes: [] };
    return {
        calls,
        peek: (/** @type {string} */ id) => store[id],
        deps: {
            db: {},
            collectionPath: 'linkTargetSets',
            setsCol: {},
            doc: (/** @type {any} */ _db, /** @type {string} */ _path, /** @type {string} */ id) => ({ id }),
            getDocs: async () => {
                if (failList) throw new Error('permission-denied');
                const rows = Object.values(store);
                return { forEach: (/** @type {any} */ fn) => rows.forEach(r => fn({ id: r.id, data: () => r })) };
            },
            writeWithClaimRetry: (/** @type {any} */ fn) => fn(),
            runTransaction: async (/** @type {any} */ _db, /** @type {any} */ body) => body({
                get: async (/** @type {any} */ ref) => {
                    // The competing writer lands BEFORE our read resolves — which is what a real
                    // conflict is: the picker showed one version, somebody saved another while the
                    // confirm dialog sat open, and the transaction's read returns THEIRS. The first
                    // cut of this seam captured the value first and then ran the writer, so the
                    // transaction never saw it and every conflict case passed for the wrong reason.
                    if (onRead) onRead(store, ref.id);
                    const now = store[ref.id];
                    return { exists: () => !!now, data: () => now };
                },
                set: (/** @type {any} */ ref, /** @type {any} */ payload) => {
                    calls.sets.push(ref.id); store[ref.id] = payload;
                },
                delete: (/** @type {any} */ ref) => { calls.deletes.push(ref.id); delete store[ref.id]; },
            }),
        },
    };
}

describe('reading the list: a failure is not an empty collection', () => {
    test('a refused or offline read reports error and no rows', async () => {
        const f = fakeDb({ docs: { a: setDoc('a', 10) }, failList: true });
        const res = await createTargetSetStore(f.deps).list();
        assert.equal(res.status, 'error',
            'a failed read reports ready. That is the v21.07/v22.56 defect: the picker then says '
            + '"No saved sets yet", and because these sets are SHARED the designer concludes a '
            + 'colleague deleted them.');
        assert.deepEqual(res.sets, []);
    });

    test('a genuinely empty collection is READY with no rows — the other half of the same answer', async () => {
        const res = await createTargetSetStore(fakeDb().deps).list();
        assert.equal(res.status, 'ready',
            'an empty account reports error, so the fix has merely moved the confusion: a designer '
            + 'with no sets is told something went wrong.');
        assert.deepEqual(res.sets, []);
    });

    test('rows come back sorted, and a corrupt document is skipped whole rather than half-loaded', async () => {
        const f = fakeDb({ docs: { b: setDoc('b', 10, { name: 'Zulu' }), a: setDoc('a', 10, { name: 'Alpha' }),
            bad: { id: 'bad', name: 'Broken' } } });   // no slots ⇒ refused by targetSetFromDoc
        const res = await createTargetSetStore(f.deps).list();
        assert.equal(res.status, 'ready');
        assert.deepEqual(res.sets.map(s => s.name), ['Alpha', 'Zulu'],
            'the list is unsorted, or the corrupt row was admitted');
    });
});

describe('writing: consent names a VERSION, not a document', () => {
    test('an overwrite lands when the set is still the revision the picker showed', async () => {
        const f = fakeDb({ docs: { a: setDoc('a', 10) } });
        const ok = await createTargetSetStore(f.deps).writeIfUnchanged({ id: 'a', updatedAt: ts(10) }, { v: 'new' });
        assert.equal(ok, true);
        assert.deepEqual(f.calls.sets, ['a']);
    });

    test('an overwrite REFUSES when somebody saved in the confirm dialog’s think-time', async () => {
        // The competing save lands between the transaction's read and its commit.
        const f = fakeDb({ docs: { a: setDoc('a', 10) }, onRead: (store) => { store.a = setDoc('a', 99); } });
        const ok = await createTargetSetStore(f.deps).writeIfUnchanged({ id: 'a', updatedAt: ts(10) }, { v: 'new' });
        assert.equal(ok, false,
            'the write landed on a version nobody was shown. A set has two writers — its creator and '
            + 'the admin — so the colleague whose save was destroyed never saw it happen.');
        assert.deepEqual(f.calls.sets, [], 'it reported a refusal and wrote anyway');
    });

    test('a DELETE refuses just the same — and there is no bin behind a set', async () => {
        const f = fakeDb({ docs: { a: setDoc('a', 10) }, onRead: (store) => { store.a = setDoc('a', 99); } });
        const ok = await createTargetSetStore(f.deps).writeIfUnchanged({ id: 'a', updatedAt: ts(10) }, null);
        assert.equal(ok, false);
        assert.deepEqual(f.calls.deletes, []);
    });

    test('already gone is SUCCESS for a delete and a refusal for an overwrite', async () => {
        // The asymmetry is deliberate: for a delete the outcome asked for is the outcome, but
        // recreating the document would resurrect a set somebody else deleted.
        const gone = fakeDb();
        const del = await createTargetSetStore(gone.deps).writeIfUnchanged({ id: 'a', updatedAt: ts(10) }, null);
        assert.equal(del, true, 'a set that is already gone reports a conflict on delete');

        const gone2 = fakeDb();
        const over = await createTargetSetStore(gone2.deps).writeIfUnchanged({ id: 'a', updatedAt: ts(10) }, { v: 'x' });
        assert.equal(over, false, 'overwriting a DELETED set succeeded — it would come back from the dead');
        assert.deepEqual(gone2.calls.sets, []);
    });

    test('a set nobody has ever saved (null updatedAt) is matched on that, not skipped', async () => {
        const f = fakeDb({ docs: { a: { id: 'a', updatedAt: null } } });
        const ok = await createTargetSetStore(f.deps).writeIfUnchanged({ id: 'a', updatedAt: null }, { v: 'new' });
        assert.equal(ok, true);
        // …and it still refuses once somebody gives it a version.
        const f2 = fakeDb({ docs: { a: { id: 'a', updatedAt: null } }, onRead: (store) => { store.a = setDoc('a', 5); } });
        const ok2 = await createTargetSetStore(f2.deps).writeIfUnchanged({ id: 'a', updatedAt: null }, { v: 'new' });
        assert.equal(ok2, false);
    });

    test('a RETRIED transaction re-decides from scratch rather than keeping the first verdict', async () => {
        // `writeWithClaimRetry` runs the body again after a stale-claim refresh. The `moved` flag is
        // reset inside the transaction for exactly this: a first attempt that saw a conflict must
        // not condemn a second attempt that does not.
        let attempt = 0;
        const f = fakeDb({ docs: { a: setDoc('a', 10) } });
        f.deps.writeWithClaimRetry = async (/** @type {any} */ fn) => { await fn(); return fn(); };
        f.deps.runTransaction = async (/** @type {any} */ _db, /** @type {any} */ body) => body({
            get: async () => {
                attempt++;
                // first pass sees a moved version, second sees the expected one
                return { exists: () => true, data: () => (attempt === 1 ? setDoc('a', 99) : setDoc('a', 10)) };
            },
            set: (/** @type {any} */ _r, /** @type {any} */ _p) => f.calls.sets.push('a'),
            delete: () => {},
        });
        const ok = await createTargetSetStore(f.deps).writeIfUnchanged({ id: 'a', updatedAt: ts(10) }, { v: 'new' });
        assert.equal(ok, true, 'the retry inherited the first attempt’s conflict verdict');
    });
});
