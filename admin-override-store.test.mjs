/**
 * admin-override-store.test.mjs — WHAT ADMIN HAS, AND WHETHER IT REALLY HAS IT.
 * Run with: node --experimental-test-module-mocks --test admin-override-store.test.mjs
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
    },
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
