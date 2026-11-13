/**
 * links-design-store.test.mjs — the concurrency protocol, driven against a fake Firestore.
 *
 * Run: node scripts/run-tests.mjs links-design-store.test.mjs   (part of `npm run test:hygiene`)
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
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createDesignStore, isOfflineFailure } from './links-design-store.js';
import { SLOW_SAVE_MS } from './slow-save.js';
import { conflictOf } from './links-concurrency.js';
import { runGatedWrite, _resetUnconfirmedWrites, SIGNED_OUT_CODE, UNCONFIRMED_CODE } from './claim-retry.js';

const ID = 'design-1';
const ME = 'G. Miller';
const THEM = 'S. Silva';
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

/**
 * A Firestore fake for the one property that matters: what a transaction DECIDES when the document
 * moves under it. `onRead` fires inside the transaction's read, and the snapshot reads the store
 * lazily, so the body decides on whatever `onRead` left there — the competing writer, landing
 * between the read and the commit. The body runs ONCE. This said it "re-runs when the document
 * changed", which it never did (test audit, 7 Nov 2026); a test that needs a retried transaction
 * installs its own `runTransaction` — see "a RETRIED forced save decides afresh".
 *
 * `getDoc` answers as the REAL SDK does: offline, a document it does not hold REJECTS, whether the
 * cache has never seen it or knows it was deleted. This fake used to answer `exists() === false`
 * there — a question the real one refuses offline — so a test passed on a branch production can
 * never reach (whole-app fix, Nov 2026). `cache` adds `getDocFromCache`, which CAN tell the two
 * apart: `'knows-deleted'` is a cache that recorded the deletion, `'unknown'` one that never held it.
 */
function makeDb({ initial = null, onRead = null, failTx = null, cache = /** @type {null|'knows-deleted'|'unknown'} */ (null) } = {}) {
    let store = initial ? { ...initial } : null;
    let reads = 0;
    const writes = [];
    const db = {};
    const offlineMiss = () => Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
    /** @type {any} */
    const api = {
        db,
        doc: () => ({ id: ID }),
        getDoc: async () => {
            if (store === null && !api.isOnline()) throw offlineMiss();
            return { exists: () => store !== null, data: () => store };
        },
        ...(cache ? { getDocFromCache: async () => {
            if (store !== null) return { exists: () => true, data: () => store };
            if (cache === 'knows-deleted') return { exists: () => false, data: () => undefined };
            throw offlineMiss();
        } } : {}),
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
        ownWritesSent: async () => true,   // nothing queued on this device (rule 5 has its own block)
    };
    // `setStore` lets a test move the server at a moment no ordering of real calls can
    // reach — see the read-back window block at the foot of this file.
    return { api, writes, current: () => store, setStore: (next) => { store = next; } };
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

    test('a RETRIED forced save decides afresh — the losing attempt\'s verdict does not survive', async () => {
        // Firestore re-runs a transaction's body when a document it read changed before the commit,
        // and the forced save clears its verdicts at the top of the body for exactly that. `makeDb`
        // runs the body ONCE, so the reset had no test and the code said so (test audit, 7 Nov 2026).
        // Here the body runs twice: the first attempt finds the design in the bin, the second finds a
        // colleague has restored it, at the very version this user agreed to replace — so it writes.
        const { api, writes } = makeDb();
        let attempt = 0;
        const live = { name: 'A', updatedAt: ts(2000), updatedBy: THEM };
        const tx = {
            get: async () => {
                attempt++;
                const d = attempt === 1 ? { ...live, deletedAt: ts(2500), deletedBy: THEM } : live;
                return { exists: () => true, data: () => d };
            },
            set: (/** @type {any} */ _ref, /** @type {any} */ payload) => writes.push({ kind: 'tx-set', payload }),
            delete: () => writes.push({ kind: 'tx-delete' }),
        };
        api.runTransaction = async (/** @type {any} */ _db, /** @type {Function} */ fn) => { await fn(tx); return fn(tx); };
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, baselineUnknown: false,
            currentUser: ME, forcing: true, forceAgainstRevision: 2000,
        });
        assert.equal(attempt, 2, 'premise: the body ran twice');
        assert.equal(writes.filter(w => w.kind === 'tx-set').length, 1, 'the second attempt wrote');
        assert.equal(res.status, 'saved', 'and the save says so — not the bin the first attempt saw');
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
        const { api, writes, current } = makeDb({
            initial: { name: 'A', deletedAt: ts(500), deletedBy: ME },
            onRead: (n, setStore) => { if (n === 1) setStore({ name: 'A', updatedAt: ts(2000), updatedBy: THEM }); },
        });
        const outcome = await createDesignStore(api).purge(ID);
        assert.equal(outcome, 'restored-elsewhere');
        // The DESIGN, not just the word for it (test audit, 7 Nov 2026). This asserted
        // `api.getDocs !== null`, which cannot fail, so a purge that reported the restore and then
        // deleted the design anyway passed — the one destructive action here with no undo.
        assert.deepEqual(writes.filter(w => w.kind === 'tx-delete'), [], 'nothing was deleted');
        assert.equal(current()?.updatedBy, THEM, 'the restored design is still there');
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
        // The baseline is the REVISION the create committed (v22.18) — known without a read-back,
        // which is the whole point: `updatedAt` is a serverTimestamp and cannot be known by its own
        // writer, so a colleague's save can land between the write and the read.
        assert.equal(res.baseline.loadedRevision, 1, 'a new design establishes revision 1');
    });

    // ── RESTORING AN ALREADY-RESTORED DESIGN WRITES NOTHING (v22.32, external review) ──────────
    //
    // Alice's bin is stale; Bob has already restored the design. Alice presses Restore. The old
    // code did the merge anyway — clearing already-clear fields and BUMPING THE REVISION — which
    // the comment called a harmless no-op. It is not one: an editor holding the immediately
    // preceding revision then meets a "someone else saved this" conflict about a design whose
    // content nobody touched, which is precisely the false conflict the test below argues teaches
    // people to click through the real one.
    //
    // Asserting on WRITES, not on the return value: a status can be returned while the write still
    // happens, and it is the write that manufactures the conflict.
    test('restoring one somebody else already restored writes nothing at all', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', revision: 6 } });   // no deletedAt
        const res = await createDesignStore(api).restore(ID, ME);
        assert.equal(writes.length, 0,
            'no write — clearing already-clear fields still bumps the revision, and that '
            + 'manufactures a conflict for anyone holding revision 6');
        assert.equal(res.status, 'already-restored',
            'a distinct status, so the workspace can report success without advancing a baseline '
            + 'to a revision no write produced');
        assert.equal(res.revision, undefined, 'there is no committed revision to hand back');
    });

    test('a restored design arms it too — it is an OLD document others may hold', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', deletedAt: ts(500), deletedBy: ME, revision: 6 } });
        const res = await createDesignStore(api).restore(ID, ME);
        assert.ok(res.updatedAt, 'the server stamp was read back');
        const w = writes[0];
        assert.equal(w.kind, 'tx-merge',
            'a MERGE — a replace would push our load-time copy over theirs — and inside a '
            + 'TRANSACTION since v22.18, because the revision it bumps is read in the same step');
        assert.equal(w.payload.deletedAt, '__DELETE__', 'the fields are cleared, not set to null');
        // A restore is a write every co-editor sees, so the counter has to move. Leaving it alone
        // brought the design back still wearing revision 6, while the restorer's own entry carried
        // none — so their very next save would be told somebody else had saved it. Not destructive,
        // and a false conflict is what teaches people to click through the real one.
        assert.equal(res.revision, 7, 'the restore committed a revision, and says which');
        assert.equal(w.payload.revision, 7);
    });

    // ── THE RESTORE HANDS BACK WHAT IT BROUGHT BACK (whole-app review, Oct 2026) ───────────────
    //
    // A's bin row was read when the bin opened. Since then B saved a change, so the SERVER holds
    // B's patterns. The restore's merge brings B's version back — and the caller used to rebuild
    // the design from A's stale row and stamp it with the new revision, so A's next save matched,
    // raised no conflict, and wrote A's old patterns over B's. The only copy entitled to the
    // revision is the one the transaction read, so the store must return it.
    test('a restore returns the content the server holds, not anything the caller had', async () => {
        const theirs = { 1: { sun: 'RD', mon: '07:15-15:15', tue: 'RD', wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' } };
        const win = { monSat: { start: '06:20', end: '23:55' }, sun: { start: '07:15', end: '23:25' } };
        const { api } = makeDb({ initial: {
            name: 'Renamed by B', patterns: theirs, window: win,
            deletedAt: ts(500), deletedBy: 'S. Silva', revision: 9,
        } });
        const res = await createDesignStore(api).restore(ID, ME);
        assert.equal(res.status, 'ok');
        assert.equal(res.revision, 10);
        assert.deepEqual(res.data, { name: 'Renamed by B', patterns: theirs, window: win },
            'the name, patterns and window the transaction read — the caller builds from these');
    });

    // ── RESTORE ANSWERS ABOUT THE ROW AS IT IS NOW, NOT AS THE BIN REMEMBERS IT ────────────────
    //
    // Same stale-row race as "Remove for good" above, from the other side: A opens the bin, B acts,
    // A presses Restore. `purge` had re-read inside its transaction since v21.87; `restore` had not
    // (external review, 1 Sep 2026).
    //
    // The damage was BOUNDED BY THE RULES rather than by this code, and that distinction is worth
    // keeping straight. A merge write against a hard-deleted id recreates a skeleton — no name, no
    // patterns — which `firestore.rules` refuses, so production never resurrected one. What the
    // designer actually got was "check your connection and try again" about a design that is not
    // coming back however many times they press it. A wording problem standing on a schema rule.
    //
    // These are unit tests of the STORE, so they prove the outcome is now distinguishable at all;
    // that the workspace then says it in words is links-app.js's half.
    test('restoring a design somebody removed for good reports it GONE, and writes nothing', async () => {
        const { api, writes, current } = makeDb({ initial: null });
        const res = await createDesignStore(api).restore(ID, ME);
        assert.equal(res.status, 'gone');
        assert.deepEqual(writes, [],
            'nothing may be written — a merge here recreates the document as a nameless skeleton, '
            + 'and relying on the rules to bounce it is relying on a control that lives elsewhere');
        assert.equal(current(), null, 'the design stays gone');
    });

    test('the ordinary restore still reports ok and its revision', async () => {
        const { api } = makeDb({ initial: { name: 'A', deletedAt: ts(500), deletedBy: ME, revision: 6 } });
        const res = await createDesignStore(api).restore(ID, ME);
        assert.equal(res.status, 'ok', 'the success path must carry a status too, or the caller '
            + 'cannot tell the three outcomes apart without checking for absent fields');
        assert.equal(res.revision, 7);
    });

    test('soft delete is a merge as well — a transactional one', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', patterns: { 1: 'theirs' } } });
        const res = await createDesignStore(api).softDelete(ID, ME);
        assert.equal(writes[0].kind, 'tx-merge');
        assert.equal(writes[0].payload.patterns, undefined, 'our patterns are not written over theirs');
        assert.deepEqual(res, { queued: false, status: 'deleted' });
    });

    // ── A DELETE ASKS WHAT IS THERE (whole-app fix, Nov 2026 — the rules reader's lead) ──────────
    // It was a blind merge. On a design a colleague had already BINNED it wrote over who deleted it
    // and when; on one REMOVED FOR GOOD it wrote a nameless skeleton the rules refuse, and the
    // designer read "check your connection" about a design that was already gone. Neither is a
    // failure — a delete asks for a design that is not live, and that is what there is — so both come
    // back as what was found, with nothing written.
    test('a design a colleague already binned: nothing written, and the bin keeps who deleted it', async () => {
        const { api, writes, current } = makeDb({ initial: { name: 'A', deletedAt: ts(1500), deletedBy: THEM } });
        const res = await createDesignStore(api).softDelete(ID, ME);
        assert.equal(res.status, 'already-deleted');
        assert.equal(res.deletedData?.deletedBy, THEM);
        assert.deepEqual(writes, []);
        assert.equal(current()?.deletedBy, THEM);
    });

    test('a design removed for good: nothing written — no skeleton', async () => {
        const { api, writes, current } = makeDb({ initial: null });
        const res = await createDesignStore(api).softDelete(ID, ME);
        assert.equal(res.status, 'gone');
        assert.deepEqual(writes, []);
        assert.equal(current(), null);
    });

    test('offline, a cache that knows it is binned or gone queues nothing either', async () => {
        for (const [initial, cache, status] of /** @type {Array<[any, any, string]>} */ ([
            [{ name: 'A', deletedAt: ts(1500), deletedBy: THEM }, null, 'already-deleted'],
            [null, 'knows-deleted', 'gone'],
        ])) {
            const { api, writes } = makeDb({ initial, cache });
            api.isOnline = () => false;
            assert.equal((await createDesignStore(api).softDelete(ID, ME)).status, status);
            assert.deepEqual(writes, [], status);
        }
    });

    test('a RETRIED delete decides afresh — the losing attempt\'s finding does not survive', async () => {
        const { api, writes } = makeDb();
        let attempt = 0;
        api.runTransaction = async (/** @type {any} */ _db, /** @type {Function} */ fn) => {
            /** @type {any[]} */ let pending = [];
            const tx = {
                get: async () => (++attempt === 1
                    ? { exists: () => true, data: () => ({ name: 'A', deletedAt: ts(1500), deletedBy: THEM }) }
                    : { exists: () => true, data: () => ({ name: 'A' }) }),
                set: (/** @type {any} */ _r, /** @type {any} */ p, /** @type {any} */ o) => pending.push({ kind: o?.merge ? 'tx-merge' : 'tx-set', payload: p }),
            };
            await fn(tx);   // the losing attempt: Firestore discards what it wrote
            pending = [];
            const r = await fn(tx);
            writes.push(...pending);
            return r;
        };
        const res = await createDesignStore(api).softDelete(ID, ME);
        assert.equal(attempt, 2, 'premise: the body ran twice');
        assert.equal(res.status, 'deleted', 'a colleague restored it between attempts, so this delete is the one that binned it');
        assert.equal(writes.length, 1);
    });

    // The AUTOMATIC bin move (v24.47) decides from a list read earlier, so it must ask again at commit.
    test('binIfStill moves a design that still matches, as a merge', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', patterns: { 1: 'old' } } });
        assert.equal(await createDesignStore(api).binIfStill(ID, ME, () => true), 'moved');
        assert.equal(writes.length, 1);
        assert.equal(writes[0].payload.deletedBy, ME);
        assert.equal(writes[0].payload.patterns, undefined);
    });
    test('binIfStill leaves alone a design that no longer matches — restored or redrawn since', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', patterns: { 1: 'redrawn' } } });
        assert.equal(await createDesignStore(api).binIfStill(ID, ME, () => false), 'skipped');
        assert.deepEqual(writes, []);
    });
    test('binIfStill does not re-delete a design already in the bin, or recreate a gone one', async () => {
        const binned = makeDb({ initial: { name: 'A', deletedAt: ts(500), deletedBy: 'S. Silva' } });
        assert.equal(await createDesignStore(binned.api).binIfStill(ID, ME, () => true), 'skipped');
        assert.deepEqual(binned.writes, [], 'the bin keeps who really deleted it');
        const gone = makeDb({ initial: null });
        assert.equal(await createDesignStore(gone.api).binIfStill(ID, ME, () => true), 'skipped');
        assert.deepEqual(gone.writes, []);
    });
});

test('a design is addressed through the INJECTED collection, never a second copy of its name', async () => {
    const { api } = makeDb({ initial: { name: 'A' } });
    const addressed = /** @type {any[]} */ ([]);
    api.designsCol = { path: 'linkDesignsElsewhere' };
    api.doc = (/** @type {any[]} */ ...a) => { addressed.push(a.slice(1)); return { id: ID }; };
    await createDesignStore(api).softDelete(ID, ME);
    assert.deepEqual(addressed[0], ['linkDesignsElsewhere', ID]);
});

describe('what counts as offline', () => {
    // The predicate that decides whether the unserialised path may be taken at all. Too broad and
    // rule 2 is back to being advisory.
    const online = () => false;      // isOfflineNow(): the device does not report itself offline
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
    test('…except an answer from the page\'s OWN write machinery, which no browser state turns into "offline"', () => {
        // The gate refusing a write while an earlier one is unconfirmed, and an account that signed
        // out mid-write (claim-retry.js). Neither is the absence of a server.
        assert.equal(isOfflineFailure({ code: UNCONFIRMED_CODE }, () => true), false);
        assert.equal(isOfflineFailure({ code: SIGNED_OUT_CODE }, () => true), false);
    });
});

describe('a write the page\'s own gate refused is never "queued" (whole-app fix, Nov 2026)', () => {
    // claim-retry.js: once a write on this page ends unconfirmed (signed out mid-write), every later
    // write is refused until a reload. Offline, that refusal was read as "no server": the store took
    // the queued path, the queue's own refusal was only logged, and the page said "Saved in this
    // browser" about a write nothing had issued. The REAL gate, because the wrapper every other test
    // injects (fn => fn()) has no gate to close.
    const closeGate = async () => {
        _resetUnconfirmedWrites();
        await runGatedWrite(() => Promise.reject(Object.assign(new Error('signed out'), { code: SIGNED_OUT_CODE })))
            .catch(() => {});
    };
    const offlineGated = () => {
        const db = makeDb({ initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME, revision: 2 },
            failTx: { code: 'unavailable', message: 'client is offline' } });
        db.api.isOnline = () => false;
        db.api.withClaimRetry = (/** @type {Function} */ fn) => runGatedWrite(fn);
        return db;
    };
    /** @type {Array<[string, (s: any) => Promise<any>]>} */
    const writers = [
        ['save', s => s.save({ id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, loadedRevision: 2, baselineUnknown: false, currentUser: ME })],
        ['create', s => s.create({ name: 'New' })],
        ['rename', s => s.rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 2 })],
        ['softDelete', s => s.softDelete(ID, ME)],
    ];
    for (const [what, run] of writers) {
        test(`${what}: the refusal reaches the caller, and nothing is written`, async () => {
            await closeGate();
            try {
                const { api, writes } = offlineGated();
                await assert.rejects(run(createDesignStore(api)), (/** @type {any} */ err) => err.code === UNCONFIRMED_CODE,
                    'a refusal before anything was issued is not a queued write — the caller words it as unconfirmed');
                assert.deepEqual(writes, []);
            } finally { _resetUnconfirmedWrites(); }
        });
    }

    test('a save SIGNED OUT mid-transaction while offline says so, rather than being queued', async () => {
        // The transaction is abandoned with the sign-out code, which also closes the gate. Read as
        // offline, the store went on to queue — refused by the gate it had just closed — and the
        // designer was told about "an earlier change", not that they had been signed out.
        _resetUnconfirmedWrites();
        try {
            const { api, writes } = offlineGated();
            api.runTransaction = async () => { throw Object.assign(new Error('signed out'), { code: SIGNED_OUT_CODE }); };
            await assert.rejects(writers[0][1](createDesignStore(api)), (/** @type {any} */ err) => err.code === SIGNED_OUT_CODE);
            assert.deepEqual(writes, []);
        } finally { _resetUnconfirmedWrites(); }
    });
});

// ── THE READ-BACK WINDOW (v22.18) ───────────────────────────────────────────────────────────────
//
// Every rule above is asked with a baseline, and until this release the baseline after a save came
// from a SEPARATE read of `updatedAt` — because a serverTimestamp cannot be known by its own
// writer. A colleague's save landing between our commit and that read handed us THEIR timestamp as
// our own baseline, so our next save matched, skipped the confirm, and destroyed their work.
//
// The window is not reachable by ordering real calls: it is between two awaits inside one function.
// `onWrite` opens it here for the same reason `onRead` opens the transaction's.
//
// Organised by what a wrong answer destroys, and the two directions are not symmetrical. MISSING A
// CONFLICT is silent, permanent, and somebody else's work. INVENTING one costs a dialog.
describe('the baseline after a save names what the save COMMITTED', () => {
    /** makeDb, plus a hook that fires after the transaction commits and before the stamp read-back. */
    function makeRaceDb({ initial = null, afterCommit = null } = {}) {
        const base = makeDb({ initial });
        let committed = false;
        const inner = base.api.getDoc;
        base.api.getDoc = async (ref) => {
            if (committed && afterCommit) { afterCommit(base.setStore); committed = false; }
            return inner(ref);
        };
        const innerTx = base.api.runTransaction;
        base.api.runTransaction = async (db, fn) => { const r = await innerTx(db, fn); committed = true; return r; };
        return base;
    }

    // ── MISSING A CONFLICT ──────────────────────────────────────────────────────────────────────

    test('THE BUG: a colleague saving between our commit and our read-back', async () => {
        const { api } = makeRaceDb({
            initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME, revision: 4 },
            afterCommit: (setStore) => setStore(
                { name: 'A', updatedAt: ts(3000), updatedBy: THEM, revision: 6, patterns: { 1: 'theirs' } }),
        });
        const store = createDesignStore(api);
        const res = await store.save({ id: ID, buildPayload: () => ({ name: 'mine' }),
            baseline: 1000, loadedRevision: 4, baselineUnknown: false, currentUser: ME });

        assert.equal(res.status, 'saved');
        // We committed 5. Their save made it 6, and the stamp we read back is THEIRS — which is
        // exactly why the baseline may not be built from it.
        assert.equal(res.baseline.loadedRevision, 5, 'the baseline is what WE wrote, not what we read');
        assert.equal(res.baseline.baselineUnknown, false);

        // And the consequence, which is the only thing that matters: the next save prompts.
        const next = await store.save({ id: ID, buildPayload: () => ({ name: 'mine again' }),
            baseline: res.baseline.loadedUpdatedAt, loadedRevision: res.baseline.loadedRevision,
            baselineUnknown: false, currentUser: ME });
        assert.equal(next.status, 'conflict', 'their revision 6 is not the 5 we committed');
        assert.equal(next.conflict.by, THEM);
    });

    test('a forced overwrite consents to a REVISION, not to whatever arrives', async () => {
        // The dialog named revision 6. Revision 7 landed while it sat open. Replacing 7 was never
        // agreed to, so it comes back as a fresh conflict rather than being destroyed.
        //
        // The TIMESTAMPS ARE UNREADABLE HERE ON PURPOSE — an unresolved `serverTimestamp()`, which
        // is what a recent write reads back as. The old check compares null against null, calls
        // that "nothing moved", and overwrites. Only the revision can see it. The first version of
        // this case gave the two a different `updatedAt` and passed with the revision check
        // deleted, which is a test asserting the fallback it was written to make redundant.
        const { api, current } = makeDb({
            initial: { name: 'A', updatedAt: null, updatedBy: THEM, revision: 7 },
        });
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, loadedRevision: 4,
            baselineUnknown: false, currentUser: ME, forcing: true,
            forceAgainstRev: 6, forceAgainstRevision: null,
        });
        assert.equal(res.status, 'conflict');
        assert.equal(res.conflict.rev, 7, 'and the fresh conflict names the version it found');
        assert.equal(current().name, 'A', 'their design is untouched');
    });

    // ── INVENTING ONE ───────────────────────────────────────────────────────────────────────────

    test('an ordinary second save does not prompt', async () => {
        const { api } = makeDb({ initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME, revision: 4 } });
        const store = createDesignStore(api);
        const first = await store.save({ id: ID, buildPayload: () => ({ name: 'mine' }),
            baseline: 1000, loadedRevision: 4, baselineUnknown: false, currentUser: ME });
        assert.equal(first.baseline.loadedRevision, 5);
        const second = await store.save({ id: ID, buildPayload: () => ({ name: 'again' }),
            baseline: first.baseline.loadedUpdatedAt, loadedRevision: 5,
            baselineUnknown: false, currentUser: ME });
        assert.equal(second.status, 'saved', 'our own committed revision matches');
        assert.equal(second.baseline.loadedRevision, 6);
    });

    test('a design nobody has saved since v22.18 still works on the timestamp', async () => {
        // No revision anywhere. Without this the release would prompt on every legacy design.
        const { api, current } = makeDb({ initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME } });
        const res = await createDesignStore(api).save({ id: ID, buildPayload: () => ({ name: 'mine' }),
            baseline: 1000, loadedRevision: null, baselineUnknown: false, currentUser: ME });
        assert.equal(res.status, 'saved');
        assert.equal(res.baseline.loadedRevision, 1, 'and it establishes revision 1 on the way through');
        assert.equal(current().revision, 1);
    });

    test('a forced overwrite of a legacy design falls back to the approved TIMESTAMP', async () => {
        // An in-flight dialog opened before this release names no revision. It must still resolve.
        const { api, current } = makeDb({ initial: { name: 'A', updatedAt: ts(2000), updatedBy: THEM } });
        const res = await createDesignStore(api).save({
            id: ID, buildPayload: () => ({ name: 'mine' }), baseline: 1000, loadedRevision: null,
            baselineUnknown: false, currentUser: ME, forcing: true,
            forceAgainstRev: null, forceAgainstRevision: 2000,
        });
        assert.equal(res.status, 'saved');
        assert.equal(current().name, 'mine');
    });

    test('a rename commits a revision the caller can arm its baseline from', async () => {
        const { api, current } = makeDb({ initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME, revision: 4 } });
        const res = await createDesignStore(api).rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 4 });
        assert.equal(res.baselineFresh, true);
        assert.equal(res.revision, 5);
        assert.equal(current().revision, 5, 'a rename moves the counter — to everyone else it IS a save');
    });

    test('a rename against a moved revision does not advance, whatever the timestamp says', async () => {
        // The timestamp happens to match — a same-millisecond save, or a clock the writer cannot
        // see. The revision is the answer that cannot be raced.
        const { api } = makeDb({ initial: { name: 'A', updatedAt: ts(1000), updatedBy: THEM, revision: 9 } });
        const res = await createDesignStore(api).rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 4 });
        assert.equal(res.baselineFresh, false);
    });
});

// ── FOUND BY THE SEP 2026 REVIEW ────────────────────────────────────────────────────────────────
describe('a design REMOVED FOR GOOD is not recreated by an ordinary save', () => {
    // The forced path has refused a vanished document since v21.96; the ordinary one did not. A
    // colleague bins the design and removes it for good while we hold it open, and our next save
    // wrote revision 1 into the empty slot — the design back from the dead, with nobody told.
    test('online: reported as deleted elsewhere, with no deleter invented, and nothing written', async () => {
        const { api, writes, current } = makeDb({ initial: null });
        const res = await createDesignStore(api).save({ id: ID, buildPayload: () => ({ name: 'mine' }),
            baseline: 1000, loadedRevision: 4, baselineUnknown: false, currentUser: ME });
        assert.equal(res.status, 'deleted-elsewhere');
        assert.equal(res.deletedData, null);
        assert.deepEqual(writes, []);
        assert.equal(current(), null, 'the design stays gone');
    });

    // Offline the question goes to the CACHE, and only `getDocFromCache` can answer it: plain
    // `getDoc` rejects for a document it does not hold, a deletion the cache recorded included
    // (whole-app fix, Nov 2026 — this test used to pass on a fake that answered what the SDK refuses).
    const offlineSave = (/** @type {any} */ cache) => {
        const db = makeDb({ initial: null, cache, failTx: { code: 'unavailable', message: 'client is offline' } });
        db.api.isOnline = () => false;
        return db;
    };
    const saveIt = (/** @type {any} */ api) => createDesignStore(api).save({ id: ID, buildPayload: () => ({ name: 'mine' }),
        baseline: 1000, loadedRevision: 4, baselineUnknown: false, currentUser: ME });

    test('offline: a cache that KNOWS it is gone is believed, and nothing is queued', async () => {
        const { api, writes } = offlineSave('knows-deleted');
        const res = await saveIt(api);
        assert.equal(res.status, 'deleted-elsewhere', 'queueing here recreates the design on reconnect');
        assert.deepEqual(writes, []);
    });

    test('offline: a cache that never held it cannot say, and the write is queued — offline-first', async () => {
        const { api, writes } = offlineSave('unknown');
        assert.equal((await saveIt(api)).status, 'queued');
        assert.equal(writes.length, 1);
    });

    test('offline, a FORCED save consults the cache the same way', async () => {
        const { api, writes } = offlineSave('knows-deleted');
        const res = await createDesignStore(api).save({ id: ID, buildPayload: () => ({ name: 'mine' }),
            baseline: 1000, loadedRevision: 4, baselineUnknown: false, currentUser: ME,
            forcing: true, forceAgainstRev: 4, forceAgainstRevision: null });
        assert.equal(res.status, 'deleted-elsewhere');
        assert.deepEqual(writes, []);
    });
});

describe('a RENAME of a design deleted elsewhere renames nothing (whole-app fix, Nov 2026)', () => {
    // The one transaction in the store that did not ask. A colleague BINNED the design: our rename
    // renamed the binned copy and signed it as ours, while our picker went on showing it live. They
    // REMOVED IT FOR GOOD: our merge wrote a skeleton the rules refuse, and the designer read "check
    // your connection" however often they tried. Save and restore already say what happened; rename
    // now hands the workspace the same fact, as an error it cannot mistake for success.
    const isGone = (/** @type {any} */ data) => (/** @type {any} */ err) =>
        err.code === 'deleted-elsewhere' && (data === null ? err.deletedData === null : err.deletedData?.deletedBy === data);

    test('binned elsewhere: refused, with who binned it, and the binned copy untouched', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME, revision: 4,
            deletedAt: ts(1500), deletedBy: THEM } });
        await assert.rejects(createDesignStore(api).rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 4 }), isGone(THEM));
        assert.deepEqual(writes, []);
    });

    test('removed for good: refused with no deleter invented, and no skeleton written', async () => {
        const { api, writes, current } = makeDb({ initial: null });
        await assert.rejects(createDesignStore(api).rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 4 }), isGone(null));
        assert.deepEqual(writes, []);
        assert.equal(current(), null);
    });

    test('offline: a cache that knows it was binned, or removed, refuses too — nothing is queued', async () => {
        for (const [initial, cache, who] of /** @type {Array<[any, any, any]>} */ ([
            [{ name: 'A', revision: 4, deletedAt: ts(1500), deletedBy: THEM }, null, THEM],
            [null, 'knows-deleted', null],
        ])) {
            const { api, writes } = makeDb({ initial, cache, failTx: { code: 'unavailable', message: 'client is offline' } });
            api.isOnline = () => false;
            await assert.rejects(createDesignStore(api).rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 4 }), isGone(who));
            assert.deepEqual(writes, [], JSON.stringify(initial));
        }
    });

    test('a RETRIED rename decides afresh — a design restored between attempts is renamed', async () => {
        const { api, writes } = makeDb();
        let attempt = 0;
        const live = { name: 'A', updatedAt: ts(1000), updatedBy: ME, revision: 4 };
        api.runTransaction = async (/** @type {any} */ _db, /** @type {Function} */ fn) => {
            /** @type {any[]} */ let pending = [];
            const tx = {
                get: async () => {
                    attempt++;
                    return attempt === 1 ? { exists: () => false, data: () => undefined } : { exists: () => true, data: () => live };
                },
                set: (/** @type {any} */ _r, /** @type {any} */ p) => pending.push({ kind: 'tx-merge', payload: p }),
            };
            await fn(tx);   // the losing attempt: Firestore discards what it wrote
            pending = [];
            const r = await fn(tx);
            writes.push(...pending);
            return r;
        };
        const res = await createDesignStore(api).rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 4 });
        assert.equal(attempt, 2, 'premise: the body ran twice');
        assert.equal(res.baselineFresh, true, 'the second attempt found it live, at the revision we hold');
        assert.equal(writes.length, 1);
    });
});

describe('a rename on a STALE baseline does not sign a colleague\'s save as ours', () => {
    // We hold revision 4; S. Silva saved 5. Our rename cannot advance our baseline — correct — but
    // it wrote `updatedBy: us`, so our next save's conflict dialog named US as the person who "saved
    // a different version", and we replaced it believing it was our own. It was their content.
    test('the merge carries the name and the revision, and leaves updatedBy alone', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', updatedAt: ts(2000), updatedBy: THEM, revision: 5 } });
        const store = createDesignStore(api);
        const res = await store.rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 4 });
        assert.equal(res.baselineFresh, false);
        const w = writes.find(x => x.kind === 'tx-merge');
        assert.equal(w.payload.name, 'B');
        assert.equal(w.payload.updatedBy, undefined, 'the colleague is still the last to have SAVED');
        assert.equal(w.payload.revision, 6, 'the counter still moves, so every holder of 5 is asked');

        const next = await store.save({ id: ID, buildPayload: () => ({ name: 'B' }),
            baseline: 1000, loadedRevision: 4, baselineUnknown: false, currentUser: ME });
        assert.equal(next.status, 'conflict');
        assert.equal(next.conflict.by, THEM, 'the dialog names the person whose work would be replaced');
    });

    test('a fresh rename still records who did it', async () => {
        const { api, writes } = makeDb({ initial: { name: 'A', updatedAt: ts(1000), updatedBy: THEM, revision: 4 } });
        await createDesignStore(api).rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 4 });
        assert.equal(writes.find(x => x.kind === 'tx-merge').payload.updatedBy, ME);
    });
});

describe('a QUEUED write can never wear a revision a colleague also holds', () => {
    // We are offline holding revision 2. S. Silva saves online: revision 3. Our queued write used to
    // land as (2 + 1) = 3 — the same number — so her next save matched, raised no conflict and wrote
    // straight over ours. The number a queued write stamps must be one no transactional save
    // produces from the same starting point.
    const offlineDb = (/** @type {any} */ initial) => {
        const db = makeDb({ initial, failTx: { code: 'unavailable', message: 'client is offline' } });
        db.api.isOnline = () => false;
        return db;
    };

    test('a queued save', async () => {
        const { api, writes } = offlineDb({ name: 'A', updatedAt: ts(1000), updatedBy: ME, revision: 2 });
        const res = await createDesignStore(api).save({ id: ID, buildPayload: () => ({ name: 'mine', updatedBy: ME }),
            baseline: 1000, loadedRevision: 2, baselineUnknown: false, currentUser: ME });
        assert.equal(res.status, 'queued');
        const rev = writes[0].payload.revision;
        assert.ok(Number.isInteger(rev) && rev > 2, `a positive integer above ours (rules: int >= 1): ${rev}`);
        assert.notEqual(rev, 3, 'not the revision a colleague\'s online save from 2 would produce');
        // And the consequence: S. Silva, holding the 3 she committed, is ASKED.
        assert.ok(conflictOf({ revision: rev, updatedBy: ME }, true,
            { loadedRevision: 3, loadedUpdatedAt: null, baselineUnknown: false, currentUser: THEM }));
    });

    test('a queued rename moves the counter too, so a holder of the old revision is asked', async () => {
        const { api, writes } = offlineDb({ name: 'A', updatedAt: ts(1000), updatedBy: ME, revision: 4 });
        const res = await createDesignStore(api).rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 4 });
        assert.equal(res.queued, true);
        const rev = writes[0].payload.revision;
        assert.ok(Number.isInteger(rev) && rev > 5, `the queued rename bumps past any online save from 4: ${rev}`);
    });
});

describe('a queued write does not wait for a server that is not there', () => {
    // Firestore resolves `setDoc` only when the SERVER acknowledges it — never, while offline — so
    // awaiting it held "Saving…" on screen until the connection came back and the page never said
    // "queued". The write is started, left to the SDK's queue, and the call returns.
    const neverResolves = () => new Promise(() => {});
    const hang = () => new Promise(r => setTimeout(() => r('hung'), 200));

    test('save', async () => {
        const { api } = makeDb({ initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME, revision: 2 },
            failTx: { code: 'unavailable', message: 'client is offline' } });
        api.isOnline = () => false;
        let started = false;
        api.setDoc = () => { started = true; return neverResolves(); };
        const res = await Promise.race([
            createDesignStore(api).save({ id: ID, buildPayload: () => ({ name: 'mine' }),
                baseline: 1000, loadedRevision: 2, baselineUnknown: false, currentUser: ME }),
            hang(),
        ]);
        assert.notEqual(res, 'hung');
        assert.equal(/** @type {any} */ (res).status, 'queued');
        assert.equal(started, true, 'the write was still issued');
    });

    test('create (Sep 2026 re-review)', async () => {
        // `addDoc` has the same shape — it resolves on the server's ack — and the first save of a
        // generated design still awaited it, holding "Saving…" (and, page-wide, every Save) until
        // the connection came back. An auto-id reference names the document before the write.
        const { api } = makeDb();
        api.isOnline = () => false;
        /** @type {any} */ let wrote = null;
        api.addDoc = () => neverResolves();
        api.setDoc = (_ref, payload) => { wrote = payload; return neverResolves(); };
        const res = await Promise.race([createDesignStore(api).create({ name: 'New' }), hang()]);
        assert.notEqual(res, 'hung');
        assert.equal(/** @type {any} */ (res).queued, true);
        assert.equal(/** @type {any} */ (res).id, ID, 'the id is known before the write lands');
        assert.equal(wrote?.revision, 1, 'the queued create was issued, as revision 1');
        // Revision 1 is exact: nobody else can write a document whose id only this device holds.
        assert.equal(/** @type {any} */ (res).baseline.loadedRevision, 1);
    });

    test('create ONLINE, on a connection that cannot reach the server (links-design-2, whole-app fix, Nov 2026)', async () => {
        // The browser says online — Wi-Fi with no uplink — and the server never answers. The create was
        // AWAITED with no bound, unlike the transactions, which the SDK fails there: "Creating…" until the
        // signal came back. It now waits as long as a slow save does, and then comes back queued, with the
        // id it was named with before the write. Fake timers, so the bound itself is what is measured.
        const { api } = makeDb();
        api.isOnline = () => true;
        /** @type {any} */ let wrote = null;
        api.setDoc = (_ref, payload) => { wrote = payload; return neverResolves(); };
        const flushed = () => new Promise(r => setImmediate(() => r('hung')));
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            const pending = createDesignStore(api).create({ name: 'New' });
            mock.timers.tick(SLOW_SAVE_MS - 1);
            assert.equal(await Promise.race([pending, flushed()]), 'hung', 'not before the bound');
            mock.timers.tick(1);
            const res = /** @type {any} */ (await Promise.race([pending, flushed()]));
            assert.notEqual(res, 'hung', 'the press has an answer once the bound has passed');
            assert.equal(res.queued, true, 'and it is in the SDK\'s queue, and says so');
            assert.equal(res.id, ID, 'with the id it was named with before the write');
            assert.equal(wrote?.revision, 1, 'the create was issued, as revision 1');
        } finally { mock.timers.reset(); }
    });

    test('…while an online create the server answers in time is not called queued, and reads its stamp back', async () => {
        const { api, writes } = makeDb();
        const res = await createDesignStore(api).create({ name: 'New', updatedAt: api.serverTimestamp() });
        assert.ok(!res.queued);
        assert.equal(res.id, ID);
        assert.equal(writes.length, 1, 'one write');
        assert.equal(writes[0].payload.name, 'New');
        assert.notEqual(res.updatedAt, null, 'the stamp the server holds, read back');
    });

    test('soft delete (whole-app review, Oct 2026)', async () => {
        // Awaited offline, the delete appeared to do nothing — and landed later, after the designer
        // had gone on editing, switching the page away from those edits.
        const { api } = makeDb({ initial: { name: 'A', revision: 2 } });
        api.isOnline = () => false;
        /** @type {any} */ let wrote = null;
        api.setDoc = (_ref, payload, opts) => { wrote = { payload, opts }; return neverResolves(); };
        const res = await Promise.race([createDesignStore(api).softDelete(ID, ME), hang()]);
        assert.notEqual(res, 'hung');
        assert.equal(/** @type {any} */ (res).queued, true);
        assert.equal(wrote?.payload.deletedBy, ME, 'the queued delete was still issued');
        assert.equal(wrote?.opts?.merge, true, 'and is still a merge');
    });

    test('soft delete ONLINE, on a connection that cannot reach the server (whole-app fix, Nov 2026)', async () => {
        // The browser says online — Wi-Fi with no uplink, a dead mobile cell — and the real SDK holds a
        // plain write without ever answering: the delete had no outcome until the signal came back, and
        // then switched the page away from whatever had been edited meanwhile. A transaction is FAILED
        // there (`unavailable`, after the SDK's retries), so the delete is queued like a save.
        const { api } = makeDb({ initial: { name: 'A', revision: 2 }, failTx: { code: 'unavailable', message: 'client is offline' } });
        api.isOnline = () => true;
        let issued = false;
        api.setDoc = () => { issued = true; return neverResolves(); };
        const res = await Promise.race([createDesignStore(api).softDelete(ID, ME), hang()]);
        assert.notEqual(res, 'hung', 'the press has an answer');
        assert.equal(/** @type {any} */ (res).queued, true, 'the delete is in the SDK\'s queue, and says so');
        assert.equal(issued, true, 'and it was issued');
    });

    test('…while one the server commits is not called queued', async () => {
        const { api } = makeDb({ initial: { name: 'A', revision: 2 } });
        assert.equal((await createDesignStore(api).softDelete(ID, ME)).queued, false);
    });

    test('rename', async () => {
        const { api } = makeDb({ initial: { name: 'A', updatedAt: ts(1000), updatedBy: ME, revision: 2 },
            failTx: { code: 'unavailable', message: 'client is offline' } });
        api.isOnline = () => false;
        api.setDoc = () => neverResolves();
        const res = await Promise.race([
            createDesignStore(api).rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 2 }),
            hang(),
        ]);
        assert.notEqual(res, 'hung');
        assert.equal(/** @type {any} */ (res).queued, true);
    });
});

describe('offline: our own queued rename is not a colleague\'s save, and Replace still works', () => {
    // Whole-app review, Oct 2026. Offline, a save consults the CACHE — and the cache showed our own
    // queued rename on top of the last saver's name, so the save after an offline rename read as
    // "S. Silva saved a different version". And the Replace that dialog offered ran a transaction,
    // which cannot run without a server, so it failed every time it was offered offline.
    const offlineDb = (/** @type {any} */ initial) => {
        const db = makeDb({ initial, failTx: { code: 'unavailable', message: 'client is offline' } });
        db.api.isOnline = () => false;
        return db;
    };
    const mine = () => ({ name: 'mine', updatedBy: ME });
    const save = (/** @type {any} */ store, extra = {}) => store.save({ id: ID, buildPayload: mine,
        baseline: 1000, loadedRevision: 5, baselineUnknown: false, currentUser: ME, ...extra });

    test('a save after our own offline rename queues — nobody else saved anything', async () => {
        const { api } = offlineDb({ name: 'A', updatedAt: ts(1000), updatedBy: THEM, revision: 5 });
        const store = createDesignStore(api);
        await store.rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 5 });
        const res = await save(store);
        assert.equal(res.status, 'queued', `the change in the cache was our own rename, not ${THEM}'s save`);
    });

    test('a colleague\'s save the cache held BEFORE our rename is still caught, and named', async () => {
        // We loaded 5; S. Silva's 6 reached this device; then we renamed, offline.
        const { api } = offlineDb({ name: 'A', updatedAt: ts(2000), updatedBy: THEM, revision: 6 });
        const store = createDesignStore(api);
        await store.rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 5 });
        const res = await save(store);
        assert.equal(res.status, 'conflict');
        assert.equal(res.conflict?.by, THEM);
    });

    test('a colleague\'s save that synced UNDER our queued rename is still caught (48-hour review)', async () => {
        // We loaded 5 and renamed offline. S. Silva saved 6 meanwhile, and our queued rename merged on
        // top of it when it synced: her content, her stamp and name, OUR revision. A later read cached
        // that, and we saved offline again. Matching on the revision alone took it for our own rename
        // and queued an overwrite of her save with no question.
        const db = offlineDb({ name: 'A', updatedAt: ts(1000), updatedBy: 'M. Robson', revision: 5 });
        const store = createDesignStore(db.api);
        await store.rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 5 });
        const ours = db.writes.at(-1)?.payload.revision;
        db.setStore({ name: 'B', updatedAt: ts(2000), updatedBy: THEM, revision: ours });
        const res = await save(store);
        assert.equal(res.status, 'conflict', 'her save sits under our revision — it is not our rename');
        assert.equal(res.conflict?.by, THEM);
    });

    test('two offline renames in a row are both our own — the second sees through the first', async () => {
        const { api } = offlineDb({ name: 'A', updatedAt: ts(1000), updatedBy: THEM, revision: 5 });
        const store = createDesignStore(api);
        await store.rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 5 });
        await new Promise(r => setTimeout(r, 2));   // a distinct clock revision for the second
        await store.rename({ id: ID, name: 'C', by: ME, preBaseline: 1000, preRevision: 5 });
        const res = await save(store);
        assert.equal(res.status, 'queued', `nobody but us has touched it — not ${THEM}`);
    });

    // ── …AND ONLINE (whole-app fix, Nov 2026) ───────────────────────────────────────────────────
    // The rename above synced: the server holds OUR clock revision over S. Silva's untouched content,
    // stamp and name. The next save is ONLINE, so it runs the TRANSACTION — which compared the raw
    // document with our baseline and said "S. Silva saved a different version … after you opened this
    // page", about our own rename. Only the offline consult saw through it.
    const renamedOfflineThenBackOnline = async (/** @type {any} */ initial) => {
        const db = makeDb({ initial });
        const tx = db.api.runTransaction;
        let offline = true;
        db.api.runTransaction = async (/** @type {any} */ d, /** @type {Function} */ fn) => {
            if (offline) throw Object.assign(new Error('client is offline'), { code: 'unavailable' });
            return tx(d, fn);
        };
        db.api.isOnline = () => !offline;
        const store = createDesignStore(db.api);
        await store.rename({ id: ID, name: 'B', by: ME, preBaseline: 1000, preRevision: 5 });
        offline = false;   // the queued merge has landed (the fake applied it) and the signal is back
        return { db, store, ours: db.current().revision };
    };
    const SILVA_5 = { name: 'A', updatedAt: ts(1000), updatedBy: THEM, revision: 5 };

    test('online, the first save after our own queued rename is a SAVE, not a conflict', async () => {
        const { store, ours } = await renamedOfflineThenBackOnline(SILVA_5);
        const res = await save(store);
        assert.equal(res.status, 'saved', `nobody but us has touched it since we loaded it — not ${THEM}`);
        assert.equal(res.baseline?.loadedRevision, ours + 1, 'and the counter moves on from the revision really there');
    });

    test('online: a colleague\'s save that synced UNDER our rename is still caught, and named', async () => {
        const { db, store, ours } = await renamedOfflineThenBackOnline(SILVA_5);
        db.setStore({ name: 'B', updatedAt: ts(2000), updatedBy: THEM, revision: ours });
        const res = await save(store);
        assert.equal(res.status, 'conflict', 'her save sits under our revision — it is not our rename');
        assert.equal(res.conflict?.by, THEM);
    });

    test('online: a colleague\'s save AFTER our rename synced is still caught', async () => {
        const { db, store, ours } = await renamedOfflineThenBackOnline(SILVA_5);
        db.setStore({ name: 'B', updatedAt: ts(3000), updatedBy: 'M. Robson', revision: ours + 1 });
        const res = await save(store);
        assert.equal(res.status, 'conflict');
        assert.equal(res.conflict?.by, 'M. Robson');
    });

    test('online: Replace, given against the version the cache showed under our rename, writes', async () => {
        // The cache held S. Silva's 6 before we renamed offline, so the dialog named her 6. Back online,
        // the server holds our revision over that 6 — the version agreed to, under our own rename.
        const { store } = await renamedOfflineThenBackOnline({ name: 'A', updatedAt: ts(2000), updatedBy: THEM, revision: 6 });
        const res = await save(store, { forcing: true, forceAgainstRev: 6, forceAgainstRevision: 2000 });
        assert.equal(res.status, 'saved', 'the only change since the dialog is our own rename');
    });

    test('online: a second rename after our queued one advances the baseline, as a fresh rename does', async () => {
        const { store } = await renamedOfflineThenBackOnline(SILVA_5);
        const res = await store.rename({ id: ID, name: 'C', by: ME, preBaseline: 1000, preRevision: 5 });
        assert.equal(res.baselineFresh, true, 'left stale, the save after it met the same false conflict');
        assert.equal(typeof res.revision, 'number');
    });

    test('Replace, offline, queues against the version it was shown', async () => {
        const { api, writes } = offlineDb({ name: 'A', updatedAt: ts(2000), updatedBy: THEM, revision: 6 });
        const store = createDesignStore(api);
        const res = await save(store);
        assert.equal(res.status, 'conflict', 'premise: the cache holds a save we never took in');
        const forced = await save(store, { forcing: true, forceAgainstRev: res.conflict.rev,
            forceAgainstRevision: res.conflict.at?.toMillis?.() ?? null });
        assert.equal(forced.status, 'queued', 'Replace offline failed every time — a transaction needs a server');
        assert.equal(writes.at(-1)?.payload.name, 'mine');
        assert.equal(forced.baseline?.baselineUnknown, true, 'nothing verified the server');
    });

    test('…and a cache that moved on from that version is a fresh conflict, never an overwrite', async () => {
        const db = offlineDb({ name: 'A', updatedAt: ts(2000), updatedBy: THEM, revision: 6 });
        const store = createDesignStore(db.api);
        const res = await save(store);
        db.setStore({ name: 'A2', updatedAt: ts(3000), updatedBy: 'M. Robson', revision: 7 });
        const forced = await save(store, { forcing: true, forceAgainstRev: res.conflict.rev,
            forceAgainstRevision: res.conflict.at?.toMillis?.() ?? null });
        assert.equal(forced.status, 'conflict');
        assert.equal(forced.conflict?.by, 'M. Robson');
        assert.equal(db.writes.length, 0, 'nothing queued over a version nobody was asked about');
    });
});

// ── RULE 5: A TRANSACTION WAITS FOR THIS DEVICE'S OWN QUEUED WRITES FIRST (v25.96) ─────────────────
// A transaction reads the server, and a save this store queued offline (rule 4) is not there yet. In
// the second after the signal returned, an online save read the server's older copy, wrote over it,
// and the queued save then landed on top: older work over newer. The fake below holds that queued
// write and lands it when the queue DRAINS — at the wait, or at `drain()`, whichever comes first, as
// the signal returning would.
describe('rule 5 — every transaction waits for this device\'s own queued writes first', () => {
    /** The server as it was before this device went offline, and the save this device queued since. */
    const SERVER = { name: 'A', patterns: 'before', revision: 5, updatedAt: ts(1000), updatedBy: ME };
    const QUEUED = { name: 'A', patterns: 'queued offline', revision: 1_763_000_000_000, updatedAt: ts(2000), updatedBy: ME };
    /** @param {{ sent?: Promise<boolean>|boolean }} [o] */
    function withQueue({ sent = true } = {}) {
        const db = makeDb({ initial: { ...SERVER } });
        let queued = /** @type {any} */ ({ ...QUEUED });
        const drain = () => { if (queued) { db.setStore(queued); queued = null; } };
        let asked = 0, txRuns = 0;
        db.api.ownWritesSent = async () => { asked++; const ok = await sent; if (ok) drain(); return ok; };
        const realTx = db.api.runTransaction;
        db.api.runTransaction = async (/** @type {any} */ d, /** @type {any} */ fn) => { txRuns++; return realTx(d, fn); };
        return { ...db, drain, asked: () => asked, txRuns: () => txRuns };
    }
    // Just after a queued save the baseline is UNKNOWN (rule 3), and the last saver is this designer.
    const saveNew = (/** @type {any} */ store) => store.save({ id: ID, buildPayload: () => ({ name: 'A', patterns: 'newer' }),
        baseline: null, baselineUnknown: true, currentUser: ME, loadedRevision: null });

    test('a save made after reconnecting waits for the queued one, so the newer work is what stays', async () => {
        const q = withQueue();
        const res = await saveNew(createDesignStore(q.api));
        q.drain();   // anything still queued lands now, whatever the store did
        assert.equal(res.status, 'saved');
        assert.equal(q.current().patterns, 'newer', 'the save queued offline landed over the newer one');
        assert.equal(q.current().revision, QUEUED.revision + 1, 'counted on from the revision the queued save stamped');
        assert.equal(q.asked(), 1);
    });

    test('a queue that has not drained in time: the save is queued BEHIND it, never checked against a stale server', async () => {
        const q = withQueue({ sent: false });
        const res = await saveNew(createDesignStore(q.api));
        assert.equal(res.status, 'queued');
        assert.equal(q.txRuns(), 0, 'a transaction read the server before this device\'s own save had reached it');
        assert.equal(q.writes.at(-1)?.kind, 'set', 'queued as a plain write, behind the one already waiting');
        assert.equal(res.baseline.baselineUnknown, true);
    });

    test('…and a rename and a delete queue behind it the same way', async () => {
        const r = withQueue({ sent: false });
        const renamed = await createDesignStore(r.api).rename({ id: ID, name: 'B', by: ME, preBaseline: null });
        assert.equal(renamed.queued, true);
        assert.equal(r.txRuns(), 0);
        const d = withQueue({ sent: false });
        const deleted = await createDesignStore(d.api).softDelete(ID, ME);
        assert.deepEqual([deleted.queued, deleted.status], [true, 'deleted']);
        assert.equal(d.txRuns(), 0);
        assert.equal(d.writes.at(-1)?.kind, 'merge');
    });

    test('a restore, a purge and the automatic bin are refused as offline — no transaction, nothing written', async () => {
        for (const run of [
            (/** @type {any} */ s) => s.restore(ID, ME),
            (/** @type {any} */ s) => s.purge(ID),
            (/** @type {any} */ s) => s.binIfStill(ID, ME, () => true),
        ]) {
            const q = withQueue({ sent: false });
            await assert.rejects(run(createDesignStore(q.api)), (/** @type {any} */ e) => e.code === 'unavailable' && e.unsent === true);
            assert.equal(q.txRuns(), 0);
            assert.deepEqual(q.writes, []);
        }
    });

    test('the automatic bin reads what the queued save left, not the server before it', async () => {
        // A design redrawn offline no longer matches the old-length rule; read before the queued save
        // landed, it still did, was binned — and the queued save then brought it back without `deletedAt`.
        const q = withQueue();
        const stillOld = (/** @type {any} */ data) => data.patterns === 'before';
        assert.equal(await createDesignStore(q.api).binIfStill(ID, ME, stillOld), 'skipped');
        q.drain();
        assert.equal(q.current().deletedAt, undefined);
    });

    test('the store refuses to be built without the wait', () => {
        const { api } = makeDb();
        delete (/** @type {any} */ (api)).ownWritesSent;
        assert.throws(() => createDesignStore(api), /ownWritesSent is required/);
    });
});
