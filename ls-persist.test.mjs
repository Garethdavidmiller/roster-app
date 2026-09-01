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
