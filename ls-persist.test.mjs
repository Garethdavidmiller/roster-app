// @ts-check
/**
 * ls-persist.test.mjs — `requestPersistentStorage`, the durability request behind the pay data.
 *
 * Organised by what each wrong answer COSTS, and the two directions are not symmetrical:
 *
 *   NOT ASKING when there is data to protect is silent and permanent — the member keeps entering
 *   payslips into storage the browser is still free to evict, and finds out only when a year of
 *   figures is gone. Nothing surfaces it; `persisted()` is not read anywhere.
 *
 *   ASKING when there is nothing to protect costs a Firefox permission doorhanger at a moment the
 *   member cannot connect to anything they did — the reason the prefix gate exists at all.
 *
 * The module is imported fresh per test (`?t=` cache-bust) because the one-shot flag is read from
 * the fake storage rather than module state, but the import graph is shared otherwise.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/** Minimal localStorage double — the same throwing behaviour ls.js exists to absorb. */
function fakeStorage(initial = {}, { throwOnAccess = false } = {}) {
    let map = { ...initial };
    return {
        get length() { if (throwOnAccess) throw new Error('SecurityError'); return Object.keys(map).length; },
        key(i) { if (throwOnAccess) throw new Error('SecurityError'); return Object.keys(map)[i] ?? null; },
        getItem(k) { if (throwOnAccess) throw new Error('SecurityError'); return k in map ? map[k] : null; },
        setItem(k, v) { if (throwOnAccess) throw new Error('SecurityError'); map[k] = String(v); },
        removeItem(k) { if (throwOnAccess) throw new Error('SecurityError'); delete map[k]; },
        _map: () => map,
    };
}

/** Load ls.js against a given storage + navigator.storage, returning the module and a call log. */
async function load({ store, persistImpl }) {
    globalThis.localStorage = /** @type {any} */ (store);
    const calls = [];
    // `navigator` is a getter-only global in Node 22 — defineProperty, not assignment.
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: persistImpl === undefined
            ? {}                                        // WebKit: no navigator.storage at all
            : { storage: { persist: (/** @type {any[]} */ ...a) => { calls.push(a); return persistImpl(); } } },
    });
    const mod = await import(`./ls.js?t=${Math.random()}`);
    return { mod, calls };
}

describe('not asking when there IS something to protect (silent data loss)', () => {
    test('asks once the device holds a key under the prefix', async () => {
        const store = fakeStorage({ 'myb_pc_gmiller_p24': '{"satH":8}' });
        const { mod, calls } = await load({ store, persistImpl: () => Promise.resolve(true) });
        mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(calls.length, 1, 'a device holding pay data must ask for durable storage');
    });

    test('a key that merely CONTAINS the prefix does not count — it must start with it', async () => {
        const store = fakeStorage({ 'other_myb_pc_gmiller_p24': 'x' });
        const { mod, calls } = await load({ store, persistImpl: () => Promise.resolve(true) });
        mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(calls.length, 0);
    });
});

describe('asking when there is NOTHING to protect (an unexplainable prompt)', () => {
    test('a first-run device with no pay data is not asked', async () => {
        const store = fakeStorage({ 'myb_selected_member': 'G. Miller' });
        const { mod, calls } = await load({ store, persistImpl: () => Promise.resolve(true) });
        mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(calls.length, 0, 'no pay data yet — nothing to explain a prompt with');
    });

    test('another member\'s data does not trigger MY request', async () => {
        const store = fakeStorage({ 'myb_pc_ssilva_p24': '{"satH":8}' });
        const { mod, calls } = await load({ store, persistImpl: () => Promise.resolve(true) });
        mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(calls.length, 0);
    });

    test('it is ONE-SHOT — a refusal is not re-asked on the next page open', async () => {
        const store = fakeStorage({ 'myb_pc_gmiller_p24': '{"satH":8}' });
        const first = await load({ store, persistImpl: () => Promise.resolve(false) });   // refused
        first.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(first.calls.length, 1);
        const second = await load({ store, persistImpl: () => Promise.resolve(false) });  // same device
        second.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(second.calls.length, 0, 'the device flag must survive into the next page open');
    });
});

describe('it can never break the page', () => {
    test('no navigator.storage at all (WebKit) — returns quietly, and still flags', async () => {
        const store = fakeStorage({ 'myb_pc_gmiller_p24': 'x' });
        const { mod } = await load({ store, persistImpl: undefined });
        assert.doesNotThrow(() => mod.requestPersistentStorage('myb_pc_gmiller_'));
    });

    test('a REJECTED persist() promise is swallowed', async () => {
        const store = fakeStorage({ 'myb_pc_gmiller_p24': 'x' });
        const { mod } = await load({ store, persistImpl: () => Promise.reject(new Error('nope')) });
        assert.doesNotThrow(() => mod.requestPersistentStorage('myb_pc_gmiller_'));
        await new Promise(r => setTimeout(r, 0));   // let the rejection settle unhandled-free
    });

    test('storage that throws on every access (iOS private mode) is survivable', async () => {
        const store = fakeStorage({}, { throwOnAccess: true });
        const { mod, calls } = await load({ store, persistImpl: () => Promise.resolve(true) });
        assert.doesNotThrow(() => mod.requestPersistentStorage('myb_pc_gmiller_'));
        assert.equal(calls.length, 0);
    });

    test('an empty prefix never asks — a bad caller cannot ask on every device', async () => {
        const store = fakeStorage({ 'anything': 'x' });
        const { mod, calls } = await load({ store, persistImpl: () => Promise.resolve(true) });
        mod.requestPersistentStorage('');
        assert.equal(calls.length, 0);
    });
});

// ── WRITING TWO KEYS, OR NEITHER (v22.19, external review) ──────────────────────────────────────
//
// `lsSetVerified(a) && lsSetVerified(b)` returns the right ANSWER and leaves the wrong STATE. The
// caller sees false and reports "couldn't save"; key A has changed anyway. The pay calculator's
// bulk fill is where it bit: a period holding Calendar hours without its gold roster snapshot reads
// as hand-entered — a lie about provenance, and (because an entered period is never re-filled) a
// state the retry the message invites cannot reach.
//
// Organised by what each wrong answer COSTS. A missed rollback is silent and permanent; a
// rollback that fires when it should not would throw away a write that succeeded.
describe('lsSetBothVerified — two keys or neither', () => {
    /** A storage that refuses writes to specific keys, as a full disk or a quota would. */
    const refusing = (initial, refuse) => {
        const s = fakeStorage(initial);
        const set = s.setItem.bind(s);
        s.setItem = (k, v) => { if (refuse.includes(k)) return; set(k, v); };   // silently drops it
        return s;
    };

    // ── A HALF-WRITE LEFT BEHIND ────────────────────────────────────────────────────────────────

    test('THE BUG: B fails, so A is put back to what it held', async () => {
        const store = refusing({ a: 'old-a' }, ['b']);
        const { mod } = await load({ store, persistImpl: () => Promise.resolve(true) });
        assert.equal(mod.lsSetBothVerified('a', 'new-a', 'b', 'new-b'), false);
        assert.equal(store._map().a, 'old-a', 'A must not keep a value the caller was told did not save');
        assert.equal('b' in store._map(), false);
    });

    test('and when A held NOTHING, it is removed rather than left empty', async () => {
        // The difference matters: an absent period key and a period key holding "{}" are different
        // states to every reader downstream.
        const store = refusing({}, ['b']);
        const { mod } = await load({ store, persistImpl: () => Promise.resolve(true) });
        assert.equal(mod.lsSetBothVerified('a', 'new-a', 'b', 'new-b'), false);
        assert.equal('a' in store._map(), false, 'restored to absent, not to an empty string');
    });

    test('a rollback that itself fails still reports failure', async () => {
        // Storage that refuses everything cannot undo either. The caller must never be told a
        // half-write succeeded, which is the one guarantee still available here.
        const store = refusing({ a: 'old-a' }, ['a', 'b']);
        const { mod } = await load({ store, persistImpl: () => Promise.resolve(true) });
        assert.equal(mod.lsSetBothVerified('a', 'new-a', 'b', 'new-b'), false);
    });

    // ── A GOOD WRITE THROWN AWAY ────────────────────────────────────────────────────────────────

    test('both land → true, and both hold their new values', async () => {
        const store = fakeStorage({ a: 'old-a' });
        const { mod } = await load({ store, persistImpl: () => Promise.resolve(true) });
        assert.equal(mod.lsSetBothVerified('a', 'new-a', 'b', 'new-b'), true);
        assert.equal(store._map().a, 'new-a');
        assert.equal(store._map().b, 'new-b');
    });

    test('A failing means B is never attempted', async () => {
        // Ordering, not tidiness: writing B for a period whose data did not save would leave a
        // snapshot describing figures that are not there.
        const store = refusing({}, ['a']);
        const { mod } = await load({ store, persistImpl: () => Promise.resolve(true) });
        assert.equal(mod.lsSetBothVerified('a', 'new-a', 'b', 'new-b'), false);
        assert.equal('b' in store._map(), false, 'B must not be written on its own');
    });

    test('storage that throws outright is absorbed, not propagated', async () => {
        const { mod } = await load({ store: fakeStorage({}, { throwOnAccess: true }),
            persistImpl: () => Promise.resolve(true) });
        assert.equal(mod.lsSetBothVerified('a', '1', 'b', '2'), false, 'iOS private mode, not a crash');
    });
});
