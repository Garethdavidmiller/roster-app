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

/** Load ls.js against a given storage + navigator.storage, returning the module and a call log.
 *  `installed` answers the display-mode query; `notifications` is the Notification permission. */
async function load({ store, persistImpl, installed = false, notifications = false }) {
    globalThis.localStorage = /** @type {any} */ (store);
    /** @type {any} */ (globalThis).matchMedia = (/** @type {string} */ q) => ({ matches: installed && q === '(display-mode: standalone)' });
    /** @type {any} */ (globalThis).Notification = { permission: notifications ? 'granted' : 'default' };
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

    test('a refusal is not re-asked on the next page open while NOTHING has changed', async () => {
        const store = fakeStorage({ 'myb_pc_gmiller_p24': '{"satH":8}' });
        const first = await load({ store, persistImpl: () => Promise.resolve(false) });   // refused
        first.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(first.calls.length, 1);
        const second = await load({ store, persistImpl: () => Promise.resolve(false) });  // same device
        second.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(second.calls.length, 0, 'the device flag must survive into the next page open');
    });
});

// ── A REFUSAL IS NOT FOR EVER (Nov 2026, the owner's decision) ────────────────────────────────────
// The one-shot flag was written whatever the answer, so Chrome's likely first answer — a silent no, in
// a tab, before the app is installed — stood after the member installed it, when Chrome would say yes.
describe('asked again when the answer can now be yes — and only then', () => {
    const tick = () => new Promise(r => setTimeout(r, 0));

    test('a refusal in a TAB is asked again once the app runs INSTALLED — and then not again', async () => {
        const store = fakeStorage({ 'myb_pc_gmiller_p24': '{"satH":8}' });
        const tab = await load({ store, persistImpl: () => Promise.resolve(false) });
        tab.mod.requestPersistentStorage('myb_pc_gmiller_');
        await tick();
        assert.equal(tab.calls.length, 1);
        const app = await load({ store, persistImpl: () => Promise.resolve(false), installed: true });
        app.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(app.calls.length, 1, 'installing is the lever that can turn the no into a yes');
        await tick();
        const again = await load({ store, persistImpl: () => Promise.resolve(false), installed: true });
        again.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(again.calls.length, 0, 'one more ask per lever, not one per open');
        const backInTab = await load({ store, persistImpl: () => Promise.resolve(false) });
        backInTab.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(backInTab.calls.length, 0, 'a tab after the installed ask has nothing new to offer');
    });

    test('notifications allowed since the last ask are a lever too — and a lever is remembered', async () => {
        const store = fakeStorage({ 'myb_pc_gmiller_p24': 'x' });
        const installed = await load({ store, persistImpl: () => Promise.resolve(false), installed: true });
        installed.mod.requestPersistentStorage('myb_pc_gmiller_');
        await tick();
        const notifInTab = await load({ store, persistImpl: () => Promise.resolve(false), notifications: true });
        notifInTab.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(notifInTab.calls.length, 1, 'allowing notifications can change the answer');
        await tick();
        const both = await load({ store, persistImpl: () => Promise.resolve(false), installed: true, notifications: true });
        both.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(both.calls.length, 0, 'both levers have each had their ask — the tab one must not forget the install');
    });

    test('a GRANT is never asked again, whatever changes', async () => {
        const store = fakeStorage({ 'myb_pc_gmiller_p24': 'x' });
        const first = await load({ store, persistImpl: () => Promise.resolve(true) });
        first.mod.requestPersistentStorage('myb_pc_gmiller_');
        await tick();
        const later = await load({ store, persistImpl: () => Promise.resolve(true), installed: true, notifications: true });
        later.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(later.calls.length, 0, 'durable already — there is nothing to ask for');
    });

    test('the flag written before Nov 2026 reads as asked in a tab — an install still earns its ask', async () => {
        const store = fakeStorage({ 'myb_pc_gmiller_p24': 'x', 'myb_storage_persist_asked': '1' });
        const tab = await load({ store, persistImpl: () => Promise.resolve(false) });
        tab.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(tab.calls.length, 0, 'the old one-shot still holds where nothing has changed');
        const app = await load({ store, persistImpl: () => Promise.resolve(false), installed: true });
        app.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(app.calls.length, 1, 'the Android tab-then-install case, on a device that asked under the old rule');
    });
});

describe('it can never break the page', () => {
    test('no navigator.storage at all (an older WebKit) — returns quietly, and records nothing', async () => {
        // Nothing was asked, so nothing may say it was: an iPhone updated to a Safari that HAS the API
        // must ask on its next open (Safari 17 brought it), not find a flag from before it existed.
        const store = fakeStorage({ 'myb_pc_gmiller_p24': 'x' });
        const { mod } = await load({ store, persistImpl: undefined });
        assert.doesNotThrow(() => mod.requestPersistentStorage('myb_pc_gmiller_'));
        assert.equal('myb_storage_persist_asked' in store._map(), false);
        const updated = await load({ store, persistImpl: () => Promise.resolve(false) });
        updated.mod.requestPersistentStorage('myb_pc_gmiller_');
        assert.equal(updated.calls.length, 1);
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

    // ── THE OTHER HALF-STATE: B LANDED, ITS READ-BACK DID NOT ──────────────────────────────────
    //
    // `lsSetVerified` writes and then reads back, so it reports failure in two different worlds: B
    // never landed, and B landed under a storage layer that then would not read it. They are
    // indistinguishable from here — and until v22.26 the rollback covered only the first, putting A
    // back while leaving B changed. That is the same half-state this function exists to prevent,
    // arrived at from the opposite side, and it is worse than the one it was written for: the
    // paycalc period reverts while the Calendar snapshot that describes it does not.
    //
    // Found by external review. It needs a store that WRITES faithfully and lies on read, which no
    // existing helper here does — `refusing` refuses the write itself.
    /**
     * A store that writes faithfully but fails ONE nominated read of `key` — the read-back that
     * `lsSetVerified` uses to confirm the write. Transient on purpose: a permanently unreadable key
     * is a different (and unrecoverable) world, because the prior value could never have been read
     * either, so there is nothing to restore. The first version of this fake was that harsher store
     * and it asserted the wrong thing — it made the pre-write snapshot null too, so "restore B"
     * became "delete B", and the test failed against a correct fix.
     */
    function failsNthRead(initial, key, n) {
        const inner = fakeStorage(initial);
        let reads = 0;
        return {
            get length() { return inner.length; },
            key(i) { return inner.key(i); },
            getItem(k) {
                if (k !== key) return inner.getItem(k);
                reads += 1;
                return reads === n ? null : inner.getItem(k);
            },
            setItem(k, v) { inner.setItem(k, v); },
            removeItem(k) { inner.removeItem(k); },
            _map: inner._map,
        };
    }

    test('B lands but its read-back blips → BOTH keys are put back, not just A', async () => {
        // Reads of 'b': 1 = the pre-write snapshot, 2 = the verification, 3 = the rollback's own
        // verification. Only the second fails.
        const store = failsNthRead({ a: 'old-a', b: 'old-b' }, 'b', 2);
        const { mod } = await load({ store, persistImpl: () => Promise.resolve(true) });
        assert.equal(mod.lsSetBothVerified('a', 'new-a', 'b', 'new-b'), false,
            'an unverifiable B is still a failure — the caller must never be told it worked');
        assert.equal(store._map().a, 'old-a', 'A must be rolled back');
        assert.equal(store._map().b, 'old-b',
            'B must be rolled back too. It LANDED, and leaving it gives old-A beside new-B — the '
            + 'same half-state this function promises never to leave, reached from the other side.');
    });

    test('a B that held nothing before is REMOVED, not left carrying the new value', async () => {
        const store = failsNthRead({ a: 'old-a' }, 'b', 2);
        const { mod } = await load({ store, persistImpl: () => Promise.resolve(true) });
        assert.equal(mod.lsSetBothVerified('a', 'new-a', 'b', 'new-b'), false);
        assert.equal(store._map().a, 'old-a');
        assert.equal('b' in store._map(), false, 'B held nothing before, so it must hold nothing after');
    });

    test('storage that throws outright is absorbed, not propagated', async () => {
        const { mod } = await load({ store: fakeStorage({}, { throwOnAccess: true }),
            persistImpl: () => Promise.resolve(true) });
        assert.equal(mod.lsSetBothVerified('a', '1', 'b', '2'), false, 'iOS private mode, not a crash');
    });
});

// ── WILL THIS BROWSER SAVE AT ALL? (the iPhone audit, 7 Nov 2026) ───────────────────────────────
//
// The Pay Calculator promised "Saved automatically as you type" over storage that kept nothing.
// `lsAvailable` is what it now asks first, and the two wrong answers cost different things: a false
// YES is that promise again, over figures that vanish when the page closes; a false NO puts a
// warning in front of a member whose figures are perfectly safe.
describe('lsAvailable — a write that reads back, or not available', () => {
    test('working storage says yes, and leaves nothing behind', async () => {
        const store = fakeStorage({ 'myb_pc_gmiller_p24': '{"satH":8}' });
        const { mod } = await load({ store, persistImpl: undefined });
        assert.equal(mod.lsAvailable(), true);
        assert.deepEqual(Object.keys(store._map()), ['myb_pc_gmiller_p24'],
            'the probe must be removed — a stray key would ride along in a scan of the device');
    });

    test('storage that throws on every access says no, without throwing', async () => {
        const { mod } = await load({ store: fakeStorage({}, { throwOnAccess: true }), persistImpl: undefined });
        assert.equal(mod.lsAvailable(), false);
    });

    test('READS WORK, WRITES THROW (a full quota) — the shape in which a page renders and saves nothing', async () => {
        const store = fakeStorage({ 'myb_admin_session': '{"name":"G. Miller"}' });
        store.setItem = () => { throw new Error('QuotaExceededError'); };
        const { mod } = await load({ store, persistImpl: undefined });
        assert.equal(mod.lsGet('myb_admin_session'), '{"name":"G. Miller"}', 'the session still reads');
        assert.equal(mod.lsAvailable(), false, 'and yet nothing typed would be kept');
    });

    test('a write that is silently DROPPED is caught by the read-back', async () => {
        const store = fakeStorage({});
        store.setItem = () => {};   // accepts the call, keeps nothing
        const { mod } = await load({ store, persistImpl: undefined });
        assert.equal(mod.lsAvailable(), false);
    });
});
