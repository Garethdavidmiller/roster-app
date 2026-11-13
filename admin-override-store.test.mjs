/**
 * admin-override-store.test.mjs — WHAT ADMIN HAS, AND WHETHER IT REALLY HAS IT.
 * Run with: node --experimental-test-module-mocks scripts/run-tests.mjs admin-override-store.test.mjs
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * The pure half of this feature is already tested hard: `admin-override-coverage.test.mjs` pins what
 * the cache may CLAIM, and `override-utils.test.mjs` pins what a row MEANS. Neither can see the part
 * that has actually gone wrong in production, because that part is not a calculation — it is the
 * ORDER several asynchronous reads write the cache in, and which of them was allowed to run at all.
 * A perfect `hasAuthorityFor` still answers about a member whose read the store silently skipped.
 *
 * ── ORGANISED BY WHAT A WRONG ANSWER COSTS ──────────────────────────────────────────────────────
 *
 * Not by function. Every function here is trivially right on its own; the defects are in how they
 * combine, so a per-function suite would pass on exactly the code that produced them.
 *
 *   1. THE LOAD NEVER HAPPENS. The shipped defect: one shared in-flight promise handed to a caller
 *      asking a DIFFERENT question. Nothing errors. The week grid sits on "Loading…" for ever and
 *      the Saved Changes card states the member has none — which is indistinguishable from a member
 *      who genuinely has none, and is the answer a manager acts on.
 *   2. THE CACHE CLAIMS TO KNOW WHAT IT NEVER READ. Silent, and it corrupts the roster: a write gate
 *      that asks the cache gets a confident yes about a member whose documents never arrived.
 *   3. THE CACHE KEEPS WHAT HAS BEEN DELETED. A member read is authoritative, so a row it does not
 *      contain is gone; surviving in the cache makes a deleted booking real again.
 *   4. THE SCREEN SAYS SOMETHING UNTRUE. Staged pills painted over, or a stopped load still saying
 *      "Loading…". Both fail in the patient direction, which is why nobody reports them as errors.
 *
 * ── THE HARNESS ─────────────────────────────────────────────────────────────────────────────────
 *
 * `firebase-client.js` is mocked (it pulls the gstatic SDK, which cannot load in Node) and each test
 * imports the store under its own query string, because the cache and the coverage record are
 * module-level state with no public reset — a shared instance would make these tests order-dependent,
 * which is the one thing a concurrency suite must not be.
 *
 * `getDocs` is driven by a per-test handler that can HOLD a read open, which is the whole point: the
 * interleavings below cannot be produced by any ordering of real calls.
 */

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// The store reads the page for the selected member and paints into the table. Elements are created
// on demand so `innerHTML`/`textContent` writes land somewhere inspectable.
/** @type {Record<string, any>} */
let _els = {};
function el(id) {
    if (!_els[id]) _els[id] = {
        id, value: '', innerHTML: '', textContent: '',
        /** @type {Record<string, Function[]>} */ _on: {},
        addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (this._on[t] ??= []).push(fn); },
    };
    return _els[id];
}
/** Fire a listener the module attached. The retry affordance is only real if pressing it does
 *  something, and only a fired event can show that. */
function fire(/** @type {string} */ id, /** @type {string} */ type, /** @type {any} */ ev = {}) {
    (_els[id]?._on?.[type] ?? []).forEach((/** @type {Function} */ fn) => fn(ev));
}
/** Let every queued microtask run, so a load that has been STARTED has reached its first await. */
const tick = () => new Promise(res => setTimeout(res, 0));
global.document = { getElementById: (/** @type {string} */ id) => _els[id] ?? null };

// ── THE FAKE FIRESTORE ──────────────────────────────────────────────────────────────────────────
// The clause builders return descriptions rather than opaque handles, so `getDocs` can tell a member
// read from a collection read — which is what every test below turns on.
/** @type {Array<{ member: string|null, cap: number|null }>} */
let _reads = [];
/** @type {(q: any) => Promise<any[]>} */
let _handler = async () => [];

function snapOf(rows) {
    return { size: rows.length, forEach: (/** @type {any} */ fn) => rows.forEach(r => fn({ id: r.id, data: () => r })) };
}

mock.module('./firebase-client.js', {
    namedExports: {
        db: {},
        COLLECTIONS: { overrides: 'overrides' },
        collection: () => ({ path: 'overrides' }),
        where: (/** @type {string} */ _f, /** @type {string} */ _op, /** @type {string} */ v) => ({ kind: 'where', member: v }),
        orderBy: () => ({ kind: 'orderBy' }),
        limit: (/** @type {number} */ n) => ({ kind: 'limit', n }),
        query: (/** @type {any} */ _c, /** @type {any} */ ...clauses) => ({
            member: clauses.find(c => c.kind === 'where')?.member ?? null,
            cap: clauses.find(c => c.kind === 'limit')?.n ?? null,
        }),
        getDocs: async (/** @type {any} */ q) => {
            _reads.push({ member: q.member, cap: q.cap });
            return snapOf(await _handler(q));
        },
        // THE SERVER'S COPY of single documents (Oct 2026): what a delete re-reads before it runs.
        doc: (/** @type {any} */ _db, /** @type {any} */ _c, /** @type {string} */ id) => ({ id }),
        getDoc: async (/** @type {any} */ ref) => {
            if (_serverFails) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
            return { exists: () => _server.has(ref.id), data: () => _server.get(ref.id), metadata: { fromCache: _serverCached } };
        },
        // THE SERVER'S TRANSACTIONS (v25.89), modelled on Firestore's own rule — because the whole fix is
        // about what happens when a document read inside one CHANGES before it commits: the SDK runs the
        // function again, and the re-run meets the change. A fake that ran it once could only test the
        // comparison, never the race the comparison used to lose.
        runTransaction: async (/** @type {any} */ _db, /** @type {Function} */ fn) => _runTx(fn),
        // A BATCH (v25.90): what an ordinary save commits OFFLINE — no reads, no check, applied as it
        // stands. Counted, so a test can say which kind of commit carried a save.
        writeBatch: () => {
            /** @type {Array<[string, string, any]>} */ const ops = [];
            return {
                set: (/** @type {any} */ ref, /** @type {any} */ data) => { ops.push(['set', ref.id, data]); },
                delete: (/** @type {any} */ ref) => { ops.push(['delete', ref.id, null]); },
                commit: async () => { _batchCommits++; for (const [kind, id, data] of ops) serverWrite(id, kind === 'set' ? data : null); },
            };
        },
    },
});
/** Batches committed — the offline path's only trace. */
let _batchCommits = 0;
/** @type {Map<string, any>} */ const _server = new Map();
let _serverCached = false;
let _serverFails = false;
/** Every server document's version, bumped by every write — what a transaction's reads are held to. @type {Map<string, number>} */
const _versions = new Map();
/** A write that lands on the server — a colleague's, or a committed transaction's. Null deletes. */
function serverWrite(/** @type {string} */ id, /** @type {any} */ data) {
    if (data === null) _server.delete(id); else _server.set(id, data);
    _versions.set(id, (_versions.get(id) ?? 0) + 1);
}
/** Runs ONCE, after a transaction has read and before it commits: the gap the review reproduced. @type {(() => void)|null} */
let _betweenReadAndCommit = null;
/** How many times a transaction's function ran, and what the committed ones deleted. */
let _txRuns = 0;
/** @type {string[]} */ const _txDeleted = [];
/** @type {Error|null} */ let _txFails = null;
/** Commits that LAND but whose answer is lost (`unavailable`): Firestore then runs the function again
 *  (transaction_runner.ts → isRetryableTransactionError), and the re-run reads the commit's own writes. */
let _landsUnanswered = 0;
async function _runTx(/** @type {Function} */ fn) {
    if (_txFails) throw _txFails;
    for (let attempt = 0; attempt < 5; attempt++) {
        _txRuns++;
        /** @type {Map<string, number>} */ const readAt = new Map();
        /** @type {Array<[string, string, any]>} */ const ops = [];
        await fn({
            get: async (/** @type {any} */ ref) => {
                readAt.set(ref.id, _versions.get(ref.id) ?? 0);
                const data = _server.get(ref.id);
                return { exists: () => _server.has(ref.id), data: () => (data ? { ...data } : undefined) };
            },
            set: (/** @type {any} */ ref, /** @type {any} */ data) => { ops.push(['set', ref.id, data]); },
            delete: (/** @type {any} */ ref) => { ops.push(['delete', ref.id, null]); },
        });   // a refusal thrown inside rejects the whole transaction, as the real one does
        const between = _betweenReadAndCommit; _betweenReadAndCommit = null; between?.();
        if ([...readAt].some(([id, v]) => (_versions.get(id) ?? 0) !== v)) continue;   // read is stale: run it again
        for (const [kind, id, data] of ops) { serverWrite(id, kind === 'set' ? data : null); if (kind === 'delete') _txDeleted.push(id); }
        if (_landsUnanswered > 0) { _landsUnanswered--; continue; }   // landed, answer lost: run it again
        return;
    }
    throw Object.assign(new Error('transaction contention'), { code: 'aborted' });
}

// THE SESSION (Nov 2026). Every read waits for `sessionReady`. It is a one-shot promise in the app, so the
// mock hands out a THENABLE that defers to whichever promise a test set: settled for everybody, held for
// the one test that is about the wait — and no test depends on the order the others ran in.
/** @type {Promise<boolean>} */ let _session = Promise.resolve(true);
mock.module('./session.js', {
    namedExports: { sessionReady: { then: (/** @type {any} */ ok, /** @type {any} */ no) => _session.then(ok, no) } },
});

/** A read held open until the test releases it. The only way to express "a second load arrived
 *  while the first was still out", which is where every defect in block 1 lives. */
function gate() {
    /** @type {(rows: any[]) => void} */ let release = () => {};
    const promise = new Promise(res => { release = rows => res(rows); });
    return { promise, release };
}

let _n = 0;
/** A store with its own cache and coverage record, plus the renderer spies it was initialised with. */
async function freshStore() {
    const store = await import(`./admin-override-store.js?n=${++_n}`);
    const calls = { table: 0, grid: 0, after: 0 };
    let staged = false;
    store.initOverrideStore({
        renderTable:    () => { calls.table += 1; },
        renderWeekGrid: () => { calls.grid  += 1; },
        hasStagedEdits: () => staged,
        onAfterLoad:    () => { calls.after += 1; },
    });
    return { store, calls, stage: (/** @type {boolean} */ v) => { staged = v; } };
}

beforeEach(() => {
    _els = {};
    _reads = [];
    _handler = async () => [];
    _session = Promise.resolve(true);
});

const row = (/** @type {string} */ id, /** @type {string} */ member, /** @type {string} */ date) =>
    ({ id, memberName: member, date, type: 'shift', value: '09:00-17:00' });


describe('1 · the load never happens', () => {
    test('a member selected while another member is loading is still fetched', async () => {
        const { store } = await freshStore();
        const first = gate();
        _handler = async q => (q.member === 'A. One' ? first.promise : [row('b1', 'B. Two', '2026-09-01')]);

        // The shipped defect handed loadA's in-flight promise to the second caller, so B's query
        // never ran — and nothing anywhere reported that. Only the READ LIST can see it: the
        // returned promises are indistinguishable either way, because `loadOverrides` is `async`
        // and so wraps whatever it returns in a fresh promise.
        const loadA = store.loadOverrides({ member: 'A. One' });
        const loadB = store.loadOverrides({ member: 'B. Two' });

        first.release([row('a1', 'A. One', '2026-09-01')]);
        await Promise.all([loadA, loadB]);

        assert.deepEqual(_reads.map(r => r.member), ['A. One', 'B. Two']);
        assert.equal(store.hasOverrideAuthorityFor('B. Two'), true);
        assert.equal(store.getAllOverrides().length, 2);
    });

    test('a repeat of the SAME query shares the flight rather than reading twice', async () => {
        const { store } = await freshStore();
        const held = gate();
        _handler = async () => held.promise;

        const one = store.loadOverrides({ member: 'A. One' });
        const two = store.loadOverrides({ member: 'A. One' });
        await tick();
        assert.equal(_reads.length, 1, 'the second caller joins the flight rather than re-reading');

        held.release([row('a1', 'A. One', '2026-09-01')]);
        await Promise.all([one, two]);
        assert.equal(_reads.length, 1, 'and no catch-up read follows it');
    });

    test('a queued load runs AFTER the one it is behind, never on top of it', async () => {
        const { store } = await freshStore();
        const all = gate();
        _handler = async q => (q.member ? [row('a2', 'A. One', '2026-09-02')] : all.promise);

        const loadAll    = store.loadOverrides({ everyone: true });
        const loadMember = store.loadOverrides({ everyone: false, member: 'A. One' });
        await tick();
        // The collection read is still out, so the member read must not have started yet — a member
        // slice written first and then buried under a wholesale read is the Calendar's eviction bug.
        assert.equal(_reads.length, 1, 'the queued load waits rather than racing');

        all.release([row('a1', 'A. One', '2026-09-01'), row('c1', 'C. Three', '2026-09-01')]);
        await Promise.all([loadAll, loadMember]);

        assert.deepEqual(_reads.map(r => r.member), [null, 'A. One']);
        // A. One's slice is the LATER read's, and the collection read's other member survived.
        assert.deepEqual(store.getAllOverrides().map(o => o.id).sort(), ['a2', 'c1']);
    });

    test('a failed load does not wedge the next one', async () => {
        const { store } = await freshStore();
        _handler = async () => { throw new Error('offline'); };
        await store.loadOverrides({ member: 'A. One' });

        _handler = async () => [row('a1', 'A. One', '2026-09-01')];
        await store.loadOverrides({ member: 'A. One' });
        assert.equal(_reads.length, 2);
        assert.equal(store.getAllOverrides().length, 1);
    });

    // The boot read went out before the silent sign-in had landed — with no credential, which the rules
    // refuse — and nothing read again once it had. See loadOverrides' own comment.
    test('no read goes out until the session is there, and the first load reads once it is', async () => {
        const { store } = await freshStore();
        /** @type {(v: boolean) => void} */ let signedIn = () => {};
        _session = new Promise(res => { signedIn = res; });
        _handler = async () => [row('a1', 'A. One', '2026-09-01')];

        const boot = store.loadOverrides({ member: 'A. One' });
        await tick(); await tick();
        assert.equal(_reads.length, 0, 'no read while the sign-in is still out');

        signedIn(true);
        await boot;
        assert.deepEqual(_reads.map(r => r.member), ['A. One'], 'the held read runs, once, when the session lands');
        assert.equal(store.hasOverrideAuthorityFor('A. One'), true);
    });
});


describe('2 · the cache claims to know what it never read', () => {
    test('a member read grants authority over that member and nobody else', async () => {
        const { store } = await freshStore();
        _handler = async () => [row('a1', 'A. One', '2026-09-01')];
        await store.loadOverrides({ member: 'A. One' });

        assert.equal(store.hasOverrideAuthorityFor('A. One'), true);
        assert.equal(store.hasOverrideAuthorityFor('B. Two'), false);
        assert.equal(store.coversAllStaff(), false);
    });

    test('a member with no overrides is still authoritatively known', async () => {
        // An empty slice and an unfetched member look identical in the data, which is exactly why
        // authority is answered from what was REQUESTED.
        const { store } = await freshStore();
        _handler = async () => [];
        await store.loadOverrides({ member: 'A. One' });
        assert.equal(store.hasOverrideAuthorityFor('A. One'), true);
    });

    test('a TRUNCATED collection read covers the list but not a write', async () => {
        const { store } = await freshStore();
        const cap = store.OVERRIDES_QUERY_CAP;
        _handler = async () => Array.from({ length: cap + 1 }, (_, i) => row(`x${i}`, 'A. One', '2026-09-01'));
        await store.loadOverrides({ everyone: true });

        assert.equal(store.isTruncated(), true);
        assert.equal(store.getAllOverrides().length, cap, 'the +1 probe row is dropped');
        assert.equal(store.coversAllStaff(), true, 'the LIST is covered');
        assert.equal(store.hasOverrideAuthorityFor('A. One'), false, 'a capped read is not a complete one');
    });

    test('a TRUNCATED read keeps a covered member\'s history from beyond the cap (review A12)', async () => {
        // The member stays authoritative after a capped read (withAll keeps `members`), so the rows
        // the capped read could not return must stay too — replacing the cache dropped them.
        const { store } = await freshStore();
        _handler = async () => [row('old', 'A. One', '2020-01-01'), row('a1', 'A. One', '2026-09-01')];
        await store.loadOverrides({ member: 'A. One' });
        const cap = store.OVERRIDES_QUERY_CAP;
        _handler = async () => Array.from({ length: cap + 1 }, (_, i) => row(`x${i}`, 'B. Two', '2026-09-01'));
        await store.loadOverrides({ everyone: true });

        assert.equal(store.hasOverrideAuthorityFor('A. One'), true);
        assert.ok(store.getAllOverrides().some(o => o.id === 'old'), 'the covered member\'s old leave is still counted');
    });

    test('a collection read at exactly the cap is complete, not truncated', async () => {
        const { store } = await freshStore();
        const cap = store.OVERRIDES_QUERY_CAP;
        _handler = async () => Array.from({ length: cap }, (_, i) => row(`x${i}`, 'A. One', '2026-09-01'));
        await store.loadOverrides({ everyone: true });

        assert.equal(store.isTruncated(), false);
        assert.equal(store.hasOverrideAuthorityFor('Z. Nine'), true);
    });

    test('a FAILED member load grants nothing and is reported as failed, not as empty', async () => {
        const { store } = await freshStore();
        _handler = async () => { throw new Error('offline'); };
        await store.loadOverrides({ member: 'A. One' });

        assert.equal(store.loadFailedFor('A. One'), true);
        assert.equal(store.hasOverrideAuthorityFor('A. One'), false);

        _handler = async () => [row('a1', 'A. One', '2026-09-01')];
        await store.loadOverrides({ member: 'A. One' });
        assert.equal(store.loadFailedFor('A. One'), false, 'a success clears the failure');
    });

    // RETRY AFTER A CAPPED "ALL STAFF" READ (whole-app check, Nov 2026). Left to its default, a Retry asked
    // for everybody again — the capped collection, which never covers the member — so it redrew the same
    // failure for ever. Only switching away and back, or a reload, got out.
    test('Retry after a capped All-staff read fetches the member whose own read failed', async () => {
        const { store } = await freshStore();
        const cap = store.OVERRIDES_QUERY_CAP;
        el('overrideTableBody'); el('retryLoadLink');
        _handler = async () => Array.from({ length: cap + 1 }, (_, i) => row(`x${i}`, 'B. Two', '2026-09-01'));
        await store.loadOverrides({ everyone: true });
        el('fieldMember').value = 'A. One';   // then the manager picks somebody, and their read is dropped
        _handler = async q => { if (q.member) throw new Error('dropped'); return []; };
        await store.ensureMemberLoaded('A. One');
        assert.equal(store.loadFailedFor('A. One'), true, 'premise: the member read failed');

        _reads = [];
        _handler = async q => (q.member ? [row('a1', 'A. One', '2026-09-01')] : Array.from({ length: cap + 1 }, (_, i) => row(`x${i}`, 'B. Two', '2026-09-01')));
        fire('retryLoadLink', 'click');
        await store.whenLoadSettled();
        assert.deepEqual(_reads, [{ member: 'A. One', cap: null }], 'Retry reads the member, not the capped collection');
        assert.equal(store.hasOverrideAuthorityFor('A. One'), true);
        assert.equal(store.loadFailedFor('A. One'), false);
    });

    // …and its cousin: a member on screen whom only an earlier COMPLETE read covered loses cover when a later
    // refresh comes back capped. Nothing was failing, so nothing offered a Retry: "Loading…" for ever.
    test('a refresh that comes back capped reads the member on screen it no longer covers', async () => {
        const { store } = await freshStore();
        const cap = store.OVERRIDES_QUERY_CAP;
        el('fieldMember').value = 'B. Two'; el('fieldDate').value = '2026-09-07';
        _handler = async () => [row('a1', 'A. One', '2026-09-01')];
        await store.loadOverrides({ everyone: true });
        assert.equal(store.hasOverrideAuthorityFor('B. Two'), true, 'premise: a complete read covers everybody');

        _reads = [];
        _handler = async q => (q.member ? [row('b1', 'B. Two', '2026-09-03')] : Array.from({ length: cap + 1 }, (_, i) => row(`x${i}`, 'A. One', '2026-09-01')));
        await store.loadOverrides();   // the return-to-page refresh: everybody, as the cache claims
        await store.whenLoadSettled();
        assert.deepEqual(_reads, [{ member: null, cap: cap + 1 }, { member: 'B. Two', cap: null }]);
        assert.equal(store.hasOverrideAuthorityFor('B. Two'), true);
    });

    test('a delete drops rows without widening what the cache claims', async () => {
        const { store } = await freshStore();
        _handler = async () => [row('a1', 'A. One', '2026-09-01'), row('a2', 'A. One', '2026-09-02')];
        await store.loadOverrides({ member: 'A. One' });

        store.removeFromCache(['a1']);
        assert.deepEqual(store.getAllOverrides().map(o => o.id), ['a2']);
        assert.equal(store.coversAllStaff(), false, 'removing a row learns nothing about anybody');
    });

    test('a post-write cache mutation learns nothing either', async () => {
        const { store } = await freshStore();
        _handler = async () => [row('a1', 'A. One', '2026-09-01')];
        await store.loadOverrides({ member: 'A. One' });

        store.mutateCache(rows => [...rows, row('a9', 'A. One', '2026-09-09')]);
        assert.equal(store.getAllOverrides().length, 2);
        assert.equal(store.coversAllStaff(), false);
    });
});


describe('2b · the cache is newest first, whichever read filled it (whole-app check, Nov 2026)', () => {
    test('a member read, which Firestore answers in document-id order, is held newest first', async () => {
        // No `orderBy` on the member query (it needs no index), so ids decide the order: a roster import's
        // random id among the `m_<date>_…` manual ones. The Saved Changes list draws the cache as it stands.
        const { store } = await freshStore();
        _handler = async () => [row('m_2026-09-01_A', 'A. One', '2026-09-01'), row('Zx81', 'A. One', '2026-09-20'),
            row('m_2026-09-10_A', 'A. One', '2026-09-10'), row('aB3', 'A. One', '2026-08-30')];
        await store.loadOverrides({ member: 'A. One' });
        assert.deepEqual(store.getAllOverrides().map(o => o.date), ['2026-09-20', '2026-09-10', '2026-09-01', '2026-08-30']);
    });
});

describe('3 · the cache keeps what has been deleted', () => {
    test('a member read REPLACES that member’s slice', async () => {
        const { store } = await freshStore();
        _handler = async () => [row('a1', 'A. One', '2026-09-01'), row('a2', 'A. One', '2026-09-02')];
        await store.loadOverrides({ member: 'A. One' });

        // a1 was deleted by somebody else; the authoritative re-read no longer contains it.
        _handler = async () => [row('a2', 'A. One', '2026-09-02')];
        await store.loadOverrides({ member: 'A. One' });
        assert.deepEqual(store.getAllOverrides().map(o => o.id), ['a2']);
    });

    test('it leaves every other member alone', async () => {
        const { store } = await freshStore();
        _handler = async () => [row('a1', 'A. One', '2026-09-01'), row('b1', 'B. Two', '2026-09-01')];
        await store.loadOverrides({ everyone: true });

        // `everyone` must be said out loud here: it DEFAULTS to whatever the cache already claims,
        // so after an All-staff read a bare `{ member }` is still a collection read (deliberate —
        // it stops a later resync silently narrowing the list under an admin who opened All staff).
        _handler = async () => [];
        await store.loadOverrides({ everyone: false, member: 'A. One' });
        assert.deepEqual(store.getAllOverrides().map(o => o.id), ['b1']);
    });
});


describe('4 · the screen says something untrue', () => {
    test('a successful load does not paint over staged edits', async () => {
        const { store, calls, stage } = await freshStore();
        el('fieldMember').value = 'A. One';
        el('fieldDate').value   = '2026-09-01';
        stage(true);
        _handler = async () => [row('a1', 'A. One', '2026-09-01')];

        await store.loadOverrides({ member: 'A. One' });
        assert.equal(calls.table, 1, 'the list still refreshes');
        assert.equal(calls.grid, 0, 'the week grid is left alone while edits are staged');

        stage(false);
        await store.loadOverrides({ member: 'A. One' });
        assert.equal(calls.grid, 1, 'and is repainted once nothing is staged');
    });

    test('a failed load repaints the week grid into its OWN failed state', async () => {
        const { store, calls } = await freshStore();
        el('overrideTableBody');
        el('listCount');
        // The fake DOM does not build children from an `innerHTML` write, so the retry node the
        // module looks up after painting the failed state is provided here.
        el('retryLoadLink');
        _handler = async () => { throw new Error('offline'); };

        el('fieldMember').value = 'A. One';
        await store.loadOverrides({ everyone: false, member: 'A. One' });
        assert.equal(calls.grid, 1, 'a stopped load must not keep saying "Loading…"');
        assert.match(_els.overrideTableBody.innerHTML, /Retry/);
        assert.equal(_els.listCount.textContent, 'Error');

        // RETRY, NOT RELOAD — it must re-run the query, and re-resolve the member FROM THE PAGE, or
        // an admin who has moved on since the failure re-fetches the member they have left.
        _handler = async () => [row('b1', 'B. Two', '2026-09-01')];
        el('fieldMember').value = 'B. Two';
        fire('retryLoadLink', 'click');
        await store.whenLoadSettled();
        assert.deepEqual(_reads.map(r => r.member), ['A. One', 'B. Two']);
    });

    test('a failed REFRESH does not repaint over staged edits (review A10)', async () => {
        const { store, calls, stage } = await freshStore();
        el('overrideTableBody'); el('listCount'); el('retryLoadLink');
        el('fieldMember').value = 'A. One';
        el('fieldDate').value   = '2026-09-01';
        stage(true);
        _handler = async () => { throw new Error('offline'); };
        await store.loadOverrides({ everyone: true });
        assert.equal(calls.grid, 0, 'the staged rows belong to a member already loaded — keep them');
    });

    test('nobody selected runs no query at all, and still settles', async () => {
        const { store, calls } = await freshStore();
        _handler = async () => { throw new Error('should not be called'); };

        await store.loadOverrides({ everyone: false, member: '' });
        assert.equal(_reads.length, 0, 'pretending to have loaded would grant authority over nobody read');
        assert.equal(store.hasOverrideAuthorityFor(''), false);
        assert.equal(calls.table, 0);
        await store.whenOverridesReady();          // resolves, so a write gate cannot hang
    });

    test('the selected member is read from the page when the caller names nobody', async () => {
        const { store } = await freshStore();
        el('fieldMember').value = 'B. Two';
        _handler = async () => [row('b1', 'B. Two', '2026-09-01')];

        await store.loadOverrides();
        assert.deepEqual(_reads.map(r => r.member), ['B. Two']);
    });

    test('ensureMemberLoaded is a no-op for a member already covered', async () => {
        const { store } = await freshStore();
        _handler = async () => [row('a1', 'A. One', '2026-09-01')];
        await store.loadOverrides({ member: 'A. One' });
        await store.ensureMemberLoaded('A. One');
        assert.equal(_reads.length, 1, 'switching back to a loaded member must not flash a loading state');

        await store.ensureMemberLoaded('B. Two');
        assert.equal(_reads.length, 2);
    });
});

// ── 5 · a delete takes the copies it hides, and nothing it does not ────────────────────────────────
// The REAL `withManualDuplicates` — admin-saved-changes.test.mjs mocks this module, so until v24.53
// nothing exercised it through a seeded cache. The defect it pins: deleting the STALE copy of a day
// with two manual records also deleted the one on screen, under a receipt that called it "older".
describe('5 · withManualDuplicates widens a delete only to what it outranks', () => {
    const at = (/** @type {number} */ ms) => ({ toMillis: () => ms });
    const manual = (/** @type {string} */ id, /** @type {number} */ ms) => ({ ...row(id, 'G. Miller', '2026-06-16'), createdAt: at(ms) });
    const seed = async (/** @type {any[]} */ rows) => { const { store } = await freshStore(); store.setAllOverrides(rows); return store; };

    test('deleting the copy ON SCREEN takes the older one with it, or the older one resurfaces', async () => {
        const store = await seed([manual('old', 1000), manual('new', 2000)]);
        assert.deepEqual([...store.withManualDuplicates(['new'])].sort(), ['new', 'old']);
    });

    test('deleting the STALE copy leaves the one on screen alone', async () => {
        const store = await seed([manual('old', 1000), manual('new', 2000)]);
        assert.deepEqual([...store.withManualDuplicates(['old'])], ['old'],
            'the newer record is what the day shows — deleting the leftover must not take it');
    });

    test('an exact TIE is broken one way, so deleting one copy never takes both (v24.57)', async () => {
        const store = await seed([manual('a', 1000), manual('b', 1000)]);
        const fromA = [...store.withManualDuplicates(['a'])].sort();
        const fromB = [...store.withManualDuplicates(['b'])].sort();
        assert.ok(!(fromA.length === 2 && fromB.length === 2), 'one of the two must be deletable alone');
        assert.equal(fromA.length + fromB.length, 3, 'and the other still takes its leftover with it');
    });

    test('never another member, another date, or a roster import', async () => {
        const store = await seed([
            manual('mine', 2000),
            { ...row('other-member', 'S. Silva', '2026-06-16'), createdAt: at(1000) },
            { ...row('other-date', 'G. Miller', '2026-06-17'), createdAt: at(1000) },
            { ...row('import', 'G. Miller', '2026-06-16'), source: 'roster_import', createdAt: at(1000) },
        ]);
        assert.deepEqual([...store.withManualDuplicates(['mine'])], ['mine']);
        assert.deepEqual([...store.withManualDuplicates(['import'])], ['import'], 'an import is deleted alone');
    });
});

// ── 5b · a bulk delete's chunks never split a day (v25.89, review) ─────────────────────────────────
// Each chunk is its own transaction, so a colleague's edit can stop a bulk delete between two of them.
// The older copies used to follow every ticked row, so a ticked row could land in one chunk and the copy
// it hides in the next: stopped there, the copy resurfaced as the day's value under "Deleted N".
describe('5b · deleteChunks keeps each ticked row with the copies it hides', () => {
    const at = (/** @type {number} */ ms) => ({ toMillis: () => ms });
    const manual = (/** @type {string} */ id, /** @type {string} */ date, /** @type {number} */ ms) => ({ ...row(id, 'G. Miller', date), createdAt: at(ms) });
    const seed = async (/** @type {any[]} */ rows) => { const { store } = await freshStore(); store.setAllOverrides(rows); return store; };

    test('a ticked row and its older copy share a chunk, even where the copy would have spilled into the next', async () => {
        const store = await seed([manual('a', '2026-06-15', 2000), manual('b', '2026-06-16', 2000), manual('b-old', '2026-06-16', 1000)]);
        assert.deepEqual(store.deleteChunks(['a', 'b'], 2), [['a'], ['b', 'b-old']], 'b was split from the copy it hides');
    });

    test('every id once, chunks no larger than the limit, nothing lost', async () => {
        const rows = Array.from({ length: 7 }, (_, i) => manual(`r${i}`, `2026-06-${10 + i}`, 2000));
        const store = await seed(rows);
        const chunks = store.deleteChunks(rows.map(r => r.id), 3);
        assert.deepEqual(chunks.map((/** @type {string[]} */ c) => c.length), [3, 3, 1]);
        assert.deepEqual(chunks.flat().sort(), rows.map(r => r.id).sort());
    });

    test('a copy that was itself ticked is deleted once, with the row that hides it', async () => {
        const store = await seed([manual('new', '2026-06-16', 2000), manual('old', '2026-06-16', 1000)]);
        assert.deepEqual(store.deleteChunks(['new', 'old'], 200), [['new', 'old']]);
    });
});

// ── 6 · a delete may not destroy a colleague's newer edit (Oct 2026; ONE transaction, v25.89) ──────
// Admin's cache never refreshes on its own, and a manual record has one id per member and day, so a
// delete aimed at what a manager saw this morning removed what a colleague had written since. The
// external review (Nov 2026) found the two gaps left after the first fix, and both are pinned here:
// the comparison was a separate read before a separate batch (a colleague's edit could land between),
// and it compared three fields (a January day moved to the other allowance compared equal).
describe('6 · a delete compares what it removes with what the page showed, in ONE transaction', () => {
    const seed = async (/** @type {any[]} */ rows) => { const { store } = await freshStore(); store.setAllOverrides(rows.map(r => ({ ...r }))); return store; };
    const al = { id: 'm_2026-06-16_G.%20Miller', memberName: 'G. Miller', date: '2026-06-16', type: 'annual_leave',
        value: 'AL', note: '', source: 'manual', changedBy: 'G. Miller', createdAt: { toMillis: () => 1_000 } };
    const refused = (/** @type {any} */ store) => (/** @type {any} */ e) => e.code === store.DELETE_REFUSED && e.line === store.CHANGED_ELSEWHERE_LINE;
    beforeEach(() => {
        _server.clear(); _versions.clear(); _serverCached = false; _serverFails = false;
        _betweenReadAndCommit = null; _txRuns = 0; _txDeleted.length = 0; _txFails = null; _landsUnanswered = 0;
    });

    test('unchanged on the server → deleted, in one transaction', async () => {
        const store = await seed([al]);
        serverWrite(al.id, { ...al });
        await store.deleteIfUnchanged(store.asShown([al.id]));
        assert.deepEqual(_txDeleted, [al.id]);
        assert.equal(_server.has(al.id), false);
    });

    test('a colleague changed the day BEFORE the delete read it → refused, nothing deleted', async () => {
        const store = await seed([al]);
        serverWrite(al.id, { ...al, type: 'rdw', value: '09:00-17:00', createdAt: { toMillis: () => 2_000 } });
        await assert.rejects(store.deleteIfUnchanged(store.asShown([al.id])), refused(store));
        assert.deepEqual(_txDeleted, []);
    });

    test('a colleague changed it AFTER the read and before the commit → run again, refused, and the colleague\'s edit survives', async () => {
        // The review's reproduction: Editor A checks the leave, Editor B replaces it with a worked shift,
        // A's delete commits and removes B's shift. Inside a transaction the stale read makes Firestore
        // run the function again, and the second run meets the shift.
        const store = await seed([al]);
        serverWrite(al.id, { ...al });
        _betweenReadAndCommit = () => serverWrite(al.id, { ...al, type: 'rdw', value: '09:00-17:00', changedBy: 'S. Manager', createdAt: { toMillis: () => 2_000 } });
        await assert.rejects(store.deleteIfUnchanged(store.asShown([al.id])), refused(store));
        assert.equal(_server.get(al.id)?.type, 'rdw', 'the shift a colleague saved is still there');
        assert.equal(_txRuns, 2, 'the transaction ran again because what it had read had changed');
        assert.deepEqual(_txDeleted, []);
    });

    test('only the ALLOWANCE changed — the same AL, the same value — is still a change (the review\'s second finding)', async () => {
        const store = await seed([al]);
        serverWrite(al.id, { ...al, leaveYear: 2026, createdAt: { toMillis: () => 2_000 } });
        await assert.rejects(store.deleteIfUnchanged(store.asShown([al.id])), refused(store));
        // …and not only through the revision: the same stamp with the allowance moved is refused too.
        serverWrite(al.id, { ...al, leaveYear: 2026 });
        await assert.rejects(store.deleteIfUnchanged(store.asShown([al.id])), refused(store));
    });

    test('re-saved with the very same values is still a change: its revision moved', async () => {
        const store = await seed([al]);
        serverWrite(al.id, { ...al, createdAt: { toMillis: () => 5_000 } });
        await assert.rejects(store.deleteIfUnchanged(store.asShown([al.id])), refused(store));
    });

    test('already gone on the server → no difference; nothing is refused', async () => {
        const store = await seed([al]);
        await store.deleteIfUnchanged(store.asShown([al.id]));
        assert.equal(_server.has(al.id), false);
    });

    test('an id the page does not hold, with a record under it on the server → refused: nobody was shown it', async () => {
        const store = await seed([]);
        serverWrite(al.id, { ...al });
        await assert.rejects(store.deleteIfUnchanged([al.id]), refused(store));
        assert.ok(_server.has(al.id));
    });

    test('what the person SAW is compared — not what a later load put in the cache', async () => {
        const store = await seed([al]);
        serverWrite(al.id, { ...al });
        const shown = store.asShown([al.id]);                                  // at the press
        const newer = { ...al, leaveYear: 2026, createdAt: { toMillis: () => 3_000 } };
        serverWrite(al.id, newer);
        store.setAllOverrides([{ ...newer }]);                                  // a load lands before the delete runs
        await assert.rejects(store.deleteIfUnchanged(shown), refused(store));
        assert.ok(_server.has(al.id), 'the newer record a load brought in was not deleted on the strength of the old one');
    });

    test('a row as shown WINS over the same id given bare — the week save hands both', async () => {
        // executeSave passes the rows it captured at the press and then every id it deletes; were the bare
        // id to win, the comparison would be with whatever a later load put in the cache.
        const store = await seed([al]);
        serverWrite(al.id, { ...al });
        const shown = store.asShown([al.id])[0];
        const newer = { ...al, leaveYear: 2026, createdAt: { toMillis: () => 3_000 } };
        serverWrite(al.id, newer);
        store.setAllOverrides([{ ...newer }]);
        await assert.rejects(store.commitIfUnchanged([shown, al.id], () => {}), refused(store));
        await assert.rejects(store.commitIfUnchanged([al.id, shown], () => {}), refused(store), 'in either order');
    });

    test('a rewrite that DEPENDS on a record refuses when it has gone, in its own words', async () => {
        const store = await seed([al]);
        await assert.rejects(store.commitIfUnchanged([al], () => { throw new Error('the write must not run'); },
            { mustExist: [al.id], line: 'gone since' }), (/** @type {any} */ e) => e.code === store.DELETE_REFUSED && e.line === 'gone since');
    });

    test('a transaction that cannot reach the server says so — not turned into a refusal — and deletes nothing', async () => {
        const store = await seed([al]);
        serverWrite(al.id, { ...al });
        _txFails = Object.assign(new Error('offline'), { code: 'unavailable' });
        await assert.rejects(store.deleteIfUnchanged(store.asShown([al.id])), (/** @type {any} */ e) => e.code === 'unavailable');
        assert.ok(_server.has(al.id));
    });

    test('the PRE-CHECK a long bulk delete runs first sees the allowance change too', async () => {
        const store = await seed([al]);
        serverWrite(al.id, { ...al });
        assert.equal(await store.staleDeleteVerdict([al.id]), null);
        serverWrite(al.id, { ...al, leaveYear: 2026 });
        assert.equal(await store.staleDeleteVerdict([al.id]), store.CHANGED_ELSEWHERE_LINE);
    });

    test('an offline-cache answer, or no answer, refuses the pre-check — it could not be made', async () => {
        const store = await seed([al]);
        serverWrite(al.id, { ...al });
        _serverCached = true;
        assert.equal(await store.staleDeleteVerdict([al.id]), store.UNCHECKED_DELETE_LINE);
        _serverCached = false; _serverFails = true;
        assert.equal(await store.staleDeleteVerdict([al.id]), store.UNCHECKED_DELETE_LINE);
    });
    // ── A COMMIT WHOSE ANSWER WAS LOST (v25.89, review) ───────────────────────────────────────────────
    // Firestore re-runs the function after `unavailable` on the commit, and the commit may have landed.
    test('a delete re-run after its own commit landed finds its rows gone — no difference, no refusal', async () => {
        const store = await seed([al]);
        serverWrite(al.id, { ...al });
        _landsUnanswered = 1;
        await store.deleteIfUnchanged(store.asShown([al.id]));
        assert.equal(_server.has(al.id), false);
        assert.equal(_txRuns, 2, 'premise: the function ran again after the commit landed');
    });

    test('a REWRITE re-run after its own commit landed is refused — unless `alreadyDone` recognises it, and then nothing more is written', async () => {
        const moved = { ...al, leaveYear: 2026, createdAt: { toMillis: () => 9_000 } };
        /** @param {any} store @param {any} [opts] */
        const run = (store, opts = {}) => {
            let writes = 0;
            const p = store.commitIfUnchanged([al], (/** @type {any} */ tx) => { writes++; tx.set({ id: al.id }, moved); }, { mustExist: [al.id], ...opts });
            return { p, writes: () => writes };
        };
        let store = await seed([al]);
        serverWrite(al.id, { ...al }); _landsUnanswered = 1;
        const bare = run(store);
        await assert.rejects(bare.p, refused(store), 'premise: without the predicate the re-run calls its own write a colleague\'s');
        assert.equal(_server.get(al.id)?.leaveYear, 2026, 'premise: and yet it had saved');

        store = await seed([al]);
        serverWrite(al.id, { ...al }); _landsUnanswered = 1;
        const known = run(store, { alreadyDone: (/** @type {Map<string, any>} */ latest) => latest.get(al.id)?.leaveYear === 2026 });
        const res = await known.p;
        assert.equal(res.done, true, 'a save that landed reported as refused');
        assert.equal(known.writes(), 1, 'the re-run wrote again');
        assert.equal(res.latest.get(al.id)?.leaveYear, 2026, 'and the caller is handed the server\'s copy');
    });

    test('`alreadyDone` is asked only when something differs — an unchanged day is simply written', async () => {
        const store = await seed([al]);
        serverWrite(al.id, { ...al });
        let asked = 0;
        const res = await store.commitIfUnchanged([al], (/** @type {any} */ tx) => tx.delete({ id: al.id }), { alreadyDone: () => { asked++; return true; } });
        assert.equal(res.done, false);
        assert.equal(asked, 0);
        assert.equal(_server.has(al.id), false);
    });
});


// ── 7 · AN ORDINARY SAVE IS CHECKED TOO, WHENEVER THE SERVER CAN BE ASKED (v25.90) ──────────────────────
// Until v25.90 only a save that deleted was checked, so of two managers saving one day the later simply
// won. `commitChecked` reads each day a save writes in the same transaction as the write, and refuses
// unless the day still holds what the page showed; offline it is a batch, held and unchecked, as before.
describe('7 · an ordinary save is checked too, whenever the server can be asked (v25.90)', () => {
    const FIXED = 'm_2026-06-16_G.%20Miller', DAY = '2026-06-16';
    const rec = (/** @type {any} */ over = {}) => ({ memberName: 'G. Miller', date: DAY, type: 'shift', value: '07:00-15:00',
        note: '', source: 'manual', changedBy: 'A. Manager', ...over });
    /** A save of the day, shaped as the week grid's: `replaces` deleted, the record set at the fixed id. */
    const saveDay = (/** @type {string[]} */ replaces = []) => (/** @type {any} */ w) => {
        replaces.forEach(id => w.delete({ id }));
        w.set({ id: FIXED }, { ...rec(), createdAt: null });
    };
    const seed = async (/** @type {any[]} */ rows) => { const { store } = await freshStore(); store.setAllOverrides(rows.map(r => ({ ...r }))); return store; };
    /** @type {string[][]} */ let named = [];
    const line = (/** @type {string[]} */ dates) => { named.push(dates); return `changed: ${dates.join(', ')}`; };
    const refused = (/** @type {any} */ store) => (/** @type {any} */ e) => e.code === store.DELETE_REFUSED && /^changed: /.test(e.line);
    /** Run `fn` on a device that says it is OFFLINE, then put navigator back. @template T @param {() => Promise<T>} fn */
    async function offline(fn) {
        const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
        try { return await fn(); } finally {
            if (was) Object.defineProperty(globalThis, 'navigator', was); else delete (/** @type {any} */ (globalThis)).navigator;
        }
    }
    beforeEach(() => {
        _server.clear(); _versions.clear(); _serverCached = false; _serverFails = false;
        _betweenReadAndCommit = null; _txRuns = 0; _txDeleted.length = 0; _txFails = null; _landsUnanswered = 0;
        _batchCommits = 0; named = [];
    });

    test('a day that showed nothing and still holds nothing → written, in ONE transaction, never a batch', async () => {
        const store = await seed([]);
        const res = await store.commitChecked(saveDay(), { shownFor: () => null, line });
        assert.deepEqual(res, { checked: true, done: false });
        assert.equal(_txRuns, 1);
        assert.equal(_batchCommits, 0, 'an online save went out unchecked');
        assert.equal(_server.get(FIXED)?.value, '07:00-15:00');
    });

    test('a colleague saved the day since → refused, nothing written, and the refusal is handed the DAY', async () => {
        const store = await seed([]);
        serverWrite(FIXED, rec({ type: 'annual_leave', value: 'AL', changedBy: 'S. Silva' }));
        await assert.rejects(store.commitChecked(saveDay(), { shownFor: () => null, line }), refused(store));
        assert.equal(_server.get(FIXED)?.type, 'annual_leave', "the colleague's leave was overwritten");
        assert.deepEqual(named, [[DAY]]);
    });

    test('the record the day showed has CHANGED since → refused', async () => {
        const shown = { id: FIXED, ...rec({ type: 'annual_leave', value: 'AL' }), createdAt: { toMillis: () => 1_000 } };
        const store = await seed([shown]);
        serverWrite(FIXED, { ...shown, type: 'sick', value: 'SICK', createdAt: { toMillis: () => 2_000 } });
        await assert.rejects(store.commitChecked(saveDay(), { shownFor: () => shown, line }), refused(store));
        assert.equal(_server.get(FIXED)?.type, 'sick');
    });

    test('the record the day showed has GONE since → refused, not quietly put back as something else', async () => {
        const shown = { id: FIXED, ...rec({ type: 'annual_leave', value: 'AL' }), createdAt: { toMillis: () => 1_000 } };
        const store = await seed([shown]);   // and the server no longer holds it: a colleague cancelled the leave
        await assert.rejects(store.commitChecked(saveDay(), { shownFor: () => shown, line }), refused(store));
        assert.equal(_server.has(FIXED), false);
    });

    test('a day that showed an IMPORT, unchanged → written, and the import it replaces deleted', async () => {
        const imp = { id: 'import-1', memberName: 'G. Miller', date: DAY, type: 'shift', value: '06:20-14:20', note: '', source: 'roster_import', createdAt: { toMillis: () => 1 } };
        const store = await seed([imp]);
        serverWrite('import-1', { ...imp });
        const res = await store.commitChecked(saveDay(['import-1']), { shownFor: () => imp, line });
        assert.equal(res.checked, true);
        assert.equal(_server.has('import-1'), false);
        assert.equal(_server.get(FIXED)?.value, '07:00-15:00');
    });

    test('what the ROW showed decides — a colleague\'s record a later read put in the cache is still a change', async () => {
        const theirs = { id: FIXED, ...rec({ type: 'rdw', value: '14:00-22:00', changedBy: 'S. Silva' }), createdAt: { toMillis: () => 2_000 } };
        const store = await seed([theirs]);           // the cache holds it now…
        serverWrite(FIXED, { ...theirs });
        await assert.rejects(store.commitChecked(saveDay(), { shownFor: () => null, line }), refused(store), '…but the row was drawn before it, showing nothing');
        assert.equal(_server.get(FIXED)?.type, 'rdw');
    });

    test('a commit whose answer was lost is recognised as this save: done, not refused, not written twice', async () => {
        const store = await seed([]);
        _landsUnanswered = 1;
        const res = await store.commitChecked(saveDay(), { shownFor: () => null, line });
        assert.deepEqual(res, { checked: true, done: true });
        assert.equal(_txRuns, 2, 'premise: the function ran again after the commit landed');
        assert.deepEqual(named, [], 'a save that landed was reported as a colleague\'s change');
    });

    test('a colleague\'s IDENTICAL save is still a colleague\'s — refused, never taken for this one', async () => {
        const store = await seed([]);
        serverWrite(FIXED, { ...rec({ changedBy: 'S. Silva' }), createdAt: null });
        await assert.rejects(store.commitChecked(saveDay(), { shownFor: () => null, line }), refused(store));
        assert.equal(_server.get(FIXED)?.changedBy, 'S. Silva');
    });

    test('a save that writes no day is never "done" — an empty comparison would call every refusal success', async () => {
        const shown = { id: 'k1', ...rec({ date: '2026-06-17', type: 'annual_leave', value: 'AL' }), createdAt: { toMillis: () => 1_000 } };
        const store = await seed([shown]);
        serverWrite('k1', { ...shown, value: 'SICK', type: 'sick', createdAt: { toMillis: () => 2_000 } });
        // Nothing set and nothing deleted, so every comparison `alreadyDone` could make is over an empty list.
        await assert.rejects(store.commitChecked(() => {}, { shownFor: () => null, removed: [shown], line, holdOffline: false }), refused(store));
        await assert.rejects(store.commitChecked((/** @type {any} */ w) => w.delete({ id: 'k1' }), { shownFor: () => null, removed: [shown], line, holdOffline: false }), refused(store));
        assert.equal(_server.get('k1')?.type, 'sick', 'the colleague\'s change was deleted');
    });

    test('"already done" needs the copies it replaces GONE too — the same record beside a live import is a change', async () => {
        // The record this save would write is on the server — but so is the import it was to replace, so it
        // did not land as this save; something else wrote it. Refused, rather than reported done over a day
        // still holding the copy the page meant to remove.
        const imp = { id: 'import-1', memberName: 'G. Miller', date: DAY, type: 'shift', value: '06:20-14:20', note: '', source: 'roster_import', createdAt: { toMillis: () => 1 } };
        const store = await seed([imp]);
        serverWrite('import-1', { ...imp });
        serverWrite(FIXED, { ...rec(), createdAt: null });
        await assert.rejects(store.commitChecked(saveDay(['import-1']), { shownFor: () => imp, line }), refused(store));
        assert.equal(_server.has('import-1'), true);
    });

    test('`mustBeAbsent` yields to a ROW given for the same id — the record the page showed is what is expected', async () => {
        const shown = { id: FIXED, ...rec({ type: 'annual_leave', value: 'AL' }), createdAt: { toMillis: () => 1_000 } };
        const store = await seed([shown]);
        serverWrite(FIXED, { ...shown });
        const res = await store.commitIfUnchanged([shown], (/** @type {any} */ tx) => tx.delete({ id: FIXED }), { mustBeAbsent: [FIXED] });
        assert.equal(res.done, false);
        assert.equal(_server.has(FIXED), false, 'an unchanged record the page showed was refused as a change');
    });

    test('OFFLINE → a batch, held on the device and unchecked, as every save was before', async () => {
        const store = await seed([]);
        serverWrite(FIXED, rec({ type: 'annual_leave', value: 'AL', changedBy: 'S. Silva' }));
        const res = await offline(() => store.commitChecked(saveDay(), { shownFor: () => null, line }));
        assert.deepEqual(res, { checked: false, done: false });
        assert.equal(_txRuns, 0, 'a transaction never queues on the device');
        assert.equal(_batchCommits, 1);
        assert.equal(_server.get(FIXED)?.value, '07:00-15:00', 'the trade, stated: offline cannot ask, so the later save stands');
    });

    test('"online" with no server (unavailable) → held as a batch, not lost', async () => {
        const store = await seed([]);
        _txFails = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
        const res = await store.commitChecked(saveDay(), { shownFor: () => null, line });
        assert.deepEqual(res, { checked: false, done: false });
        assert.equal(_batchCommits, 1);
        assert.equal(_server.get(FIXED)?.value, '07:00-15:00');
    });

    test('`holdOffline: false` — a save that removes a day — is never a batch: offline it still asks the server, and no server is an error', async () => {
        const store = await seed([]);
        _txFails = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
        await assert.rejects(offline(() => store.commitChecked(saveDay(), { shownFor: () => null, line, holdOffline: false })),
            (/** @type {any} */ e) => e.code === 'unavailable');
        assert.equal(_batchCommits, 0);
        assert.equal(_server.has(FIXED), false);
    });

    test('any other failure is the caller\'s to report — never turned into an unchecked batch', async () => {
        const store = await seed([]);
        _txFails = Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' });
        await assert.rejects(store.commitChecked(saveDay(), { shownFor: () => null, line }), (/** @type {any} */ e) => e.code === 'permission-denied');
        assert.equal(_batchCommits, 0);
    });
});
