/**
 * links-design-store.test.mjs — the concurrency protocol, driven against a fake Firestore.
 *
 * Run: node --test links-design-store.test.mjs   (part of `npm run test:hygiene`)
 *
 * ── WHY THIS FILE IS THE POINT OF THE EXTRACTION ────────────────────────────────────────────────
 *
 * `links-concurrency.js` has had thorough unit tests for its three pure rules since v19.38, and an
 * external audit still found two silent overwrites in the code that CALLS them — in different
 * functions, both the same shape. The rules were right; they were being asked about a moment that
 * had already passed, and nothing could see that because the orchestration lived in a 3,200-line
 * coordinator importing the Firebase SDK from gstatic, which cannot be loaded in Node.
 *
 * The store takes its Firebase handles as arguments, so the interleaving that produced each bug can
 * be replayed here deterministically. `interleave` is the whole apparatus: it runs a competing
 * writer at the exact instant between a transaction's read and its commit — the window no ordering
 * of real calls can reliably force, and the window both defects lived in.
 *
 * Organised by what a wrong answer DESTROYS, because in a shared workspace it is never our own
 * work: it is the colleague's, they never saw it happen, and they find out on reopening.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDesignStore, isOfflineFailure } from './links-design-store.js';

const ID = 'design-1';
const ME = 'G. Miller';
const THEM = 'S. Silva';
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

/**
 * A Firestore fake with real transaction semantics for the one property that matters: the callback
 * re-runs when the document changed under it. `onRead` fires between the transaction's read and its
 * commit, which is where a competing writer belongs.
 */
function makeDb({ initial = null, onRead = null, failTx = null } = {}) {
    let store = initial ? { ...initial } : null;
    let reads = 0;
    const writes = [];
    const db = {};
    const api = {
        db,
        doc: () => ({ id: ID }),
        getDoc: async () => ({ exists: () => store !== null, data: () => store }),
        setDoc: async (_ref, payload, opts) => {
            writes.push({ kind: opts?.merge ? 'merge' : 'set', payload });
            store = opts?.merge ? { ...(store || {}), ...payload } : { ...payload };
        },
        addDoc: async (_col, payload) => { store = { ...payload }; writes.push({ kind: 'add', payload }); return { id: ID }; },
        getDocs: async () => ({ docs: store ? [{ id: ID, data: () => store }] : [] }),
        runTransaction: async (_db, fn) => {
            if (failTx) { const e = new Error(failTx.message || 'tx failed'); e.code = failTx.code; throw e; }
            return fn({
                get: async () => {
                    reads++;
                    const snap = { exists: () => store !== null, data: () => store };
                    if (onRead) onRead(reads, (next) => { store = next; });
                    return snap;
                },
                set: (_ref, payload, opts) => {
                    writes.push({ kind: opts?.merge ? 'tx-merge' : 'tx-set', payload });
                    store = opts?.merge ? { ...(store || {}), ...payload } : { ...payload };
                },
                delete: () => { writes.push({ kind: 'tx-delete' }); store = null; },
            });
        },
        serverTimestamp: () => ts(9_000),
        deleteField: () => '__DELETE__',
        designsCol: {},
        withClaimRetry: (/** @type {Function} */ fn) => fn(),
        isOnline: () => true,
    };
    return { api, writes, current: () => store };
}

describe('a co-editor\'s save is never lost to a RENAME', () => {
    test('the baseline does not advance when somebody saved underneath us', async () => {
        // The audit's interleaving. We hold revision 1000. Between our read and our write, S. Silva
        // saves revision 2000. The rename is a merge, so their patterns survive it — the damage is
        // to our BASELINE, and it only shows up on our NEXT save, which is why it went unnoticed.
        const { api } = makeDb({
            initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME },
            onRead: (n, setStore) => {
                if (n === 1) setStore({ name: 'A', updatedAt: ts(2000), updatedBy: THEM, patterns: { 1: 'theirs' } });
            },
        });
        const store = createDesignStore(api);
        const res = await store.rename({ id: ID, name: 'B', by: ME, preBaseline: 1000 });

        assert.equal(res.baselineFresh, false,
            'our baseline may NOT move to a revision whose content we never took in — the next ' +
            'save must still prompt');
    });

    test('and it DOES advance when nothing moved', async () => {
        // The opposite failure. A rename that never advances the baseline means a designer working
        // alone is asked "someone else saved" about their own rename, every time — which teaches
        // people to click through the one prompt that protects them.
        const { api } = makeDb({ initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME } });
        const store = createDesignStore(api);
        const res = await store.rename({ id: ID, name: 'B', by: ME, preBaseline: 1000 });
        assert.equal(res.baselineFresh, true);
    });

    test('a rename still writes the new name in the contested case', async () => {
        // Standing down on the BASELINE must not mean standing down on the rename — the user asked
        // for it, and it is a merge that cannot hurt anybody.
        const { api, writes } = makeDb({
            initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME },
            onRead: (n, setStore) => { if (n === 1) setStore({ name: 'A', updatedAt: ts(2000), updatedBy: THEM }); },
        });
        await createDesignStore(api).rename({ id: ID, name: 'B', by: ME, preBaseline: 1000 });
        const w = writes.find(x => x.kind === 'tx-merge');
        assert.ok(w, 'the rename was written');
        assert.equal(w.payload.name, 'B');
    });
});

describe('a SAVE never downgrades its guarantee while online', () => {
    test('an online transaction failure is reported, not worked around', async () => {
        // The second audit finding. Falling through to getDoc → check → setDoc here reinstates the
        // exact race the transaction exists to close, at the moment the mechanism is already
        // struggling — so a contended write would overwrite a colleague with no prompt at all.
        const { api, writes } = makeDb({
            initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME },
            failTx: { code: 'aborted', message: 'too much contention' },
        });
        const store = createDesignStore(api);
        await assert.rejects(
            () => store.save({ id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false, currentUser: ME }),
            /contention/);
        assert.deepEqual(writes, [], 'and nothing was written on the way out');
    });

    test('an OFFLINE failure still queues, with the baseline marked unknown', async () => {
        // Offline is a different kind of thing, not a lesser degree of online: no server, no
        // competing writer, and this app is deliberately offline-first. But nothing verified what
        // the server held, so the next save must prompt.
        const { api, writes } = makeDb({
            initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME },
            failTx: { code: 'unavailable', message: 'client is offline' },
        });
        api.isOnline = () => false;
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false, currentUser: ME,
        });
        assert.equal(res.status, 'queued');
        assert.equal(res.baseline.baselineUnknown, true, 'unknown, never null — null means "no guard"');
        assert.equal(writes.length, 1, 'the queued write did happen');
    });

    test('OFFLINE still consults what this device holds before queueing', async () => {
        // Firestore runs with persistentLocalCache, so the read below is usually served from
        // IndexedDB. It proves nothing about the server, but it can carry a deletion that reached
        // this device before the connection went — and queueing a blind write over that would
        // RESURRECT a design somebody deliberately deleted, the moment the network came back.
        //
        // This case exists because extracting the store dropped the check, and re-reading my own
        // diff is what found it. It is the sort of loss a behaviour-preserving move makes silently.
        const { api, writes } = makeDb({
            initial: { name: 'A', updatedAt: ts(1000), deletedAt: ts(1500), deletedBy: THEM },
            failTx: { code: 'unavailable', message: 'client is offline' },
        });
        api.isOnline = () => false;
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false, currentUser: ME,
        });
        assert.equal(res.status, 'deleted-elsewhere');
        assert.deepEqual(writes, [], 'and nothing was queued');
    });

    test('OFFLINE reports a cached conflict rather than queueing over it', async () => {
        const { api, writes } = makeDb({
            initial: { name: 'A', updatedAt: ts(2000), updatedBy: THEM },
            failTx: { code: 'unavailable', message: 'client is offline' },
        });
        api.isOnline = () => false;
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false, currentUser: ME,
        });
        assert.equal(res.status, 'conflict');
        assert.deepEqual(writes, []);
    });

    test('and queues normally when the cache shows nothing to worry about', async () => {
        // The other direction: an offline save that refuses to queue would strand a designer's
        // work on a device with no connection, which is the whole point of being offline-first.
        const { api, writes } = makeDb({
            initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME },
            failTx: { code: 'unavailable', message: 'client is offline' },
        });
        api.isOnline = () => false;
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false, currentUser: ME,
        });
        assert.equal(res.status, 'queued');
        assert.equal(writes.length, 1);
    });

    test('a competing save inside the transaction comes back as a CONFLICT, not an overwrite', async () => {
        const { api, writes } = makeDb({
            initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME },
            onRead: (n, setStore) => { if (n === 1) setStore({ name: 'A', updatedAt: ts(2000), updatedBy: THEM }); },
        });
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false, currentUser: ME,
        });
        assert.equal(res.status, 'conflict');
        assert.equal(res.conflict.by, THEM, 'and it names who, so the workspace can say so');
        assert.deepEqual(writes.filter(w => w.kind.startsWith('tx')), [], 'nothing was written');
    });

    test('a FORCE against the version the user was shown writes — that is what they chose', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', updatedAt: ts(2000), updatedBy: THEM } });
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false,
            currentUser: ME, forcing: true, forceAgainstRevision: 2000,
        });
        assert.equal(res.status, 'saved');
        assert.equal(writes.length, 1);
    });

    test('a THIRD save landing while the dialog sat open is NOT covered by that consent', async () => {
        // The audit's interleaving, and the reason a boolean was the wrong parameter. Alice holds
        // R1. Bob saves R2. The dialog names Bob and R2, and Alice reads it. Charlie saves R3.
        // Alice presses Replace — approving the replacement of a version that is no longer there.
        //
        // The old force was an unconditional `setDoc`: R3 was destroyed, Alice never saw it, and
        // Charlie found out on reopening. Consent names ONE revision, so anything else comes back
        // as a fresh conflict for the workspace to ask about on its own terms.
        const { api, writes } = makeDb({ initial: { name: 'A', updatedAt: ts(3000), updatedBy: 'C. Reen' } });
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false,
            currentUser: ME, forcing: true, forceAgainstRevision: 2000,   // they approved replacing R2
        });
        assert.equal(res.status, 'conflict', "R3 is not the version they agreed to replace");
        assert.equal(res.conflict.by, 'C. Reen', 'and the second ask names the RIGHT person');
        assert.deepEqual(writes, [], 'nothing was written');
    });

    test('a save landing INSIDE the forced transaction is caught too', async () => {
        // The narrower window: not think-time, but the microseconds between the transaction's own
        // read and its commit. The check is inside the transaction precisely so that both are one
        // rule — a pre-read-then-write would pass the test above and fail this one.
        const { api, writes } = makeDb({
            initial: { name: 'A', updatedAt: ts(2000), updatedBy: THEM },
            onRead: (n, setStore) => { if (n === 1) setStore({ name: 'A', updatedAt: ts(3000), updatedBy: 'C. Reen' }); },
        });
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false,
            currentUser: ME, forcing: true, forceAgainstRevision: 2000,
        });
        assert.equal(res.status, 'conflict');
        assert.deepEqual(writes.filter(w => w.kind.startsWith('tx')), [], 'nothing was written');
    });

    test('a design PURGED while the dialog sat open is not recreated by the force', async () => {
        // Soft delete is covered below; this is the harder one, because there is no `deletedAt` to
        // find — the document is simply gone, and a full `setDoc` would put it back with no trace
        // of the removal. It exits as `deleted-elsewhere` with no data, which is the same offer the
        // workspace makes for a soft delete: save mine as new.
        const { api, writes } = makeDb({ initial: null });
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false,
            currentUser: ME, forcing: true, forceAgainstRevision: 2000,
        });
        assert.equal(res.status, 'deleted-elsewhere');
        assert.equal(res.deletedData, null, 'and it does not invent a deleter');
        assert.deepEqual(writes, [], 'nothing was written');
    });

    test('FORCE still refuses a design deleted since the conflict was raised', async () => {
        // The two consents are different, and the gap between them is human think-time in a dialog.
        // Pressing "replace" answers "their SAVE should not win". It does not answer "their DELETE
        // should be undone" — a question nobody was asked, because the design was live when the
        // conflict was raised and was deleted while the dialog sat open.
        //
        // `docPayload` carries no `deletedAt`/`deletedBy`, and force does a full `setDoc`, so an
        // unguarded force REPLACES the document and strips the deletion: the design reappears in
        // the picker, and the colleague who deleted it is never told. That is precisely the outcome
        // the `deleted-elsewhere` branch exists to prevent, reached down the one path that skipped
        // the check.
        const { api, writes } = makeDb({ initial: { name: 'A', updatedAt: ts(2000), updatedBy: THEM,
                                                    deletedAt: ts(2500), deletedBy: THEM } });
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false,
            currentUser: ME, forcing: true, forceAgainstRevision: 2000,
        });
        assert.equal(res.status, 'deleted-elsewhere', 'force must not resurrect a deleted design');
        assert.equal(res.deletedData?.deletedBy, THEM, 'and it must say who deleted it');
        assert.deepEqual(writes, [], 'nothing was written');
    });

    test('a design deleted while we had it open is reported as such', async () => {
        // Not the same event as "someone saved a different version": a plain overwrite would
        // resurrect a design somebody deliberately deleted.
        const { api } = makeDb({ initial: { name: 'A', updatedAt: ts(1000), deletedAt: ts(1500), deletedBy: THEM } });
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false, currentUser: ME,
        });
        assert.equal(res.status, 'deleted-elsewhere');
        assert.equal(res.deletedData.deletedBy, THEM);
    });
});

describe('a permanent delete re-checks the row it was pressed on', () => {
    test('a design restored by somebody else is NOT removed', async () => {
        // The stale-row race, and the one destructive action in the workspace with no undo. A opens
        // the bin, B restores, A presses Remove for good on the row they can still see.
        const { api } = makeDb({
            initial: { name: 'A', deletedAt: ts(500), deletedBy: ME },
            onRead: (n, setStore) => { if (n === 1) setStore({ name: 'A', updatedAt: ts(2000), updatedBy: THEM }); },
        });
        const outcome = await createDesignStore(api).purge(ID);
        assert.equal(outcome, 'restored-elsewhere');
        assert.notEqual(api.getDocs, null);
    });

    test('a still-deleted design IS removed', async () => {
        const { api, current } = makeDb({ initial: { name: 'A', deletedAt: ts(500), deletedBy: ME } });
        assert.equal(await createDesignStore(api).purge(ID), 'removed');
        assert.equal(current(), null);
    });

    test('an already-gone design is not an error', async () => {
        const { api } = makeDb({ initial: null });
        assert.equal(await createDesignStore(api).purge(ID), 'gone');
    });
});

describe('creating and restoring ARM the baseline', () => {
    test('a new design carries a known baseline from its first save', async () => {
        // Without the read-back a just-created design had `updatedAt: null`, the guard read that as
        // "nothing to compare", and the first concurrent edit was clobbered silently.
        const { api } = makeDb();
        // The payload MUST carry the server timestamp, exactly as the real caller's `docPayload`
        // does — a fixture without one made this pass for the wrong reason on the first run.
        const res = await createDesignStore(api).create({ name: 'New', updatedAt: api.serverTimestamp() });
        assert.equal(res.baseline.baselineUnknown, false);
        assert.equal(res.baseline.loadedUpdatedAt, 9000);
    });

    test('a restored design arms it too — it is an OLD document others may hold', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', deletedAt: ts(500), deletedBy: ME } });
        const res = await createDesignStore(api).restore(ID, ME);
        assert.ok(res.updatedAt, 'the server stamp was read back');
        const w = writes[0];
        assert.equal(w.kind, 'merge', 'a MERGE — a replace would push our load-time copy over theirs');
        assert.equal(w.payload.deletedAt, '__DELETE__', 'the fields are cleared, not set to null');
    });

    test('soft delete is a merge as well', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', patterns: { 1: 'theirs' } } });
        await createDesignStore(api).softDelete(ID, ME);
        assert.equal(writes[0].kind, 'merge');
        assert.equal(writes[0].payload.patterns, undefined, 'our patterns are not written over theirs');
    });
});

describe('what counts as offline', () => {
    // The predicate that decides whether the unserialised path may be taken at all. Too broad and
    // rule 2 is back to being advisory.
    const online = () => false;      // navigator.onLine === true → "not offline"
    test('a contention abort is NOT offline', () => {
        assert.equal(isOfflineFailure({ code: 'aborted' }, online), false);
    });
    test('a deadline is NOT offline', () => {
        assert.equal(isOfflineFailure({ code: 'deadline-exceeded' }, online), false);
    });
    test('an internal error is NOT offline', () => {
        assert.equal(isOfflineFailure({ code: 'internal' }, online), false);
    });
    test('unavailable IS', () => {
        assert.equal(isOfflineFailure({ code: 'unavailable' }, online), true);
    });
    test('and so is the browser saying so, whatever the error', () => {
        assert.equal(isOfflineFailure({ code: 'aborted' }, () => true), true);
    });
});
