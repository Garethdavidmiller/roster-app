// slow-save.test.mjs — the "waiting for signal" watcher (slow-save.js, v24.21).
// Pure: timers are injected, so nothing here waits eight real seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchSlowCommit, withSlowSaveNotice, writesInFlight, SLOW_SAVE_MS, SLOW_SAVE_TEXT, SLOW_SAVE_TEXT_BATCHED, SLOW_SAVE_TEXT_ONLINE, SLOW_SAVE_TEXT_BATCHED_ONLINE, slowSaveText, SLOW_SAVE_EVENT } from './slow-save.js';

/** A controllable clock: fire() runs every pending timer, as if its time had come. */
function fakeTimers() {
    const pending = new Map(); let next = 1;
    return {
        setTimer: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
        clearTimer: id => pending.delete(id),
        fire: () => { for (const [id, t] of [...pending]) { pending.delete(id); t.fn(); } },
        pending,
    };
}
const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const tick = () => new Promise(r => setImmediate(r));

test('a write the server answers quickly shows nothing and clears nothing', async () => {
    const t = fakeTimers(); let slow = 0, done = 0;
    const out = await watchSlowCommit(Promise.resolve('ok'), { ...t, onSlow: () => slow++, onDone: () => done++ });
    await tick();
    t.fire();                                   // the timer's moment passes AFTER the write landed
    assert.equal(out, 'ok');
    assert.equal(slow, 0, 'a settled write must never raise the notice');
    assert.equal(done, 0, 'and must not clear one it never raised — another write may own it');
    assert.equal(t.pending.size, 0, 'the timer is cleared on settle');
});

test('a write still waiting when the time comes raises the notice, and settling clears it', async () => {
    const t = fakeTimers(); const d = deferred(); let slow = 0, done = 0;
    const watched = watchSlowCommit(d.p, { ...t, onSlow: () => slow++, onDone: () => done++ });
    t.fire();
    assert.equal(slow, 1);
    assert.equal(done, 0, 'still waiting — the notice stays up');
    d.resolve('landed');
    assert.equal(await watched, 'landed', 'the caller sees the write\'s own result');
    await tick();
    assert.equal(done, 1);
});

test('a slow write that is then REFUSED still clears the notice and still rejects to the caller', async () => {
    const t = fakeTimers(); const d = deferred(); let done = 0;
    const watched = watchSlowCommit(d.p, { ...t, onSlow: () => {}, onDone: () => done++ });
    t.fire();
    const err = Object.assign(new Error('nope'), { code: 'permission-denied' });
    d.reject(err);
    await assert.rejects(watched, e => e === err, 'the caller\'s error path must see the SAME error');
    await tick();
    assert.equal(done, 1, 'a refusal must not leave "held on this phone" on screen');
});

test('the watcher returns the very promise it was given — it cannot alter a result', () => {
    const t = fakeTimers(); const p = Promise.resolve(1);
    assert.equal(watchSlowCommit(p, t), p);
});

test('the threshold and the wording', () => {
    assert.equal(SLOW_SAVE_MS, 8000);
    // It must never claim the write is SAVED: a held write can still be refused when it arrives.
    assert.doesNotMatch(SLOW_SAVE_TEXT, /\bsaved\b/i);
    assert.match(SLOW_SAVE_TEXT, /held on this device/, 'not "phone": the roster upload runs on desktop');
    assert.doesNotMatch(SLOW_SAVE_TEXT, /!/, 'calm tone — no exclamation marks');
    // v24.26: a second tab leaves the SDK on a memory-only cache, and a refused write is retried only
    // while the page is open — so "you can leave" was a claim that could lose the change.
    assert.doesNotMatch(SLOW_SAVE_TEXT, /can leave/i);
});

test('a BATCHED save never tells the reader they can leave (v24.23)', () => {
    // Only the batch in flight is held on the device; a batch not yet started exists nowhere, so
    // leaving strands it. v24.21 said "You can leave this page" to the roster upload too.
    for (const line of [SLOW_SAVE_TEXT_BATCHED, SLOW_SAVE_TEXT_BATCHED_ONLINE]) {
        assert.doesNotMatch(line, /can leave/i);
        assert.match(line, /Keep this page open/);
        assert.doesNotMatch(line, /\bsaved\b/i);
    }
});

test('"Waiting for signal" only when the browser says it is OFFLINE (v24.54)', () => {
    // An iPhone with full bars was told "Waiting for signal" on every save: the notice is a timer and
    // cannot know why the server is slow, so it may name the signal only when it is known to be gone.
    const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const setOnline = (/** @type {boolean} */ v) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: v }, configurable: true });
    try {
        setOnline(true);
        assert.equal(slowSaveText(false), SLOW_SAVE_TEXT_ONLINE);
        assert.equal(slowSaveText(true), SLOW_SAVE_TEXT_BATCHED_ONLINE);
        assert.doesNotMatch(SLOW_SAVE_TEXT_ONLINE, /signal/i, 'online: the signal is not the known cause');
        assert.doesNotMatch(SLOW_SAVE_TEXT_ONLINE, /\bsaved\b|!/i);
        assert.match(SLOW_SAVE_TEXT_ONLINE, /held on this device/);
        setOnline(false);
        assert.equal(slowSaveText(false), SLOW_SAVE_TEXT);
        assert.equal(slowSaveText(true), SLOW_SAVE_TEXT_BATCHED);
        assert.match(SLOW_SAVE_TEXT, /Waiting for signal/);
    } finally {
        if (had) Object.defineProperty(globalThis, 'navigator', had); else delete /** @type {any} */ (globalThis).navigator;
    }
});

test('a finished SLOW save announces how long it took; a quick one announces nothing (v24.54)', async () => {
    /** @type {any[]} */ const seen = [];
    // Node's global is not an EventTarget the way a page's `window` is; lend it one for this test.
    const g = /** @type {any} */ (globalThis);
    const et = new EventTarget();
    g.addEventListener = et.addEventListener.bind(et);
    g.removeEventListener = et.removeEventListener.bind(et);
    g.dispatchEvent = et.dispatchEvent.bind(et);
    const listener = (/** @type {any} */ e) => seen.push(e.detail);
    globalThis.addEventListener(SLOW_SAVE_EVENT, listener);
    const prevDoc = globalThis.document, prevE2E = globalThis.__E2E;
    globalThis.document = /** @type {any} */ ({ getElementById: () => null, createElement: () => ({ setAttribute() {} }), body: { appendChild() {} } });
    globalThis.__E2E = { slowSaveMs: 5 };
    try {
        await withSlowSaveNotice(Promise.resolve('quick'));
        await tick();
        assert.deepEqual(seen, [], 'a save inside the threshold is not a diagnostic');
        const slow = deferred();
        const p = withSlowSaveNotice(slow.p, { batched: true });
        await new Promise(r => setTimeout(r, 30));
        slow.reject(new Error('refused')); await p.catch(() => {}); await tick();
        assert.deepEqual(seen.map(d => d.phase), ['slow', 'done'],
            'once as it BECOMES slow (so the token can be timed while it is), once when it settles');
        const done = seen[1];
        assert.ok(done.ms >= 5, 'it reports the time it actually took');
        assert.equal(done.batched, true);
        assert.equal(done.ok, false, 'and whether the server confirmed or refused it');
        assert.equal(typeof done.onlineWhenSlow, 'boolean');
    } finally {
        globalThis.removeEventListener(SLOW_SAVE_EVENT, listener);
        delete g.addEventListener; delete g.removeEventListener; delete g.dispatchEvent;
        globalThis.document = prevDoc; globalThis.__E2E = prevE2E;
    }
});

test('the notice: batched wording wins while any batched write waits, and it clears on the last', async () => {
    // A minimal document — enough for the notice's one element — so the reference counting is
    // exercised through the real exported wrapper rather than restated here.
    const el = { id: 'slowSaveNotice', hidden: true, textContent: '', setAttribute() {} };
    const prevDoc = globalThis.document, prevE2E = globalThis.__E2E;
    globalThis.document = /** @type {any} */ ({
        getElementById: (id) => (id === 'slowSaveNotice' && el.appended ? el : null),
        createElement: () => el,
        body: { appendChild: (n) => { n.appended = true; } },
    });
    globalThis.__E2E = { slowSaveMs: 5 };
    try {
        const a = deferred(), b = deferred();
        const pa = withSlowSaveNotice(a.p);
        const pb = withSlowSaveNotice(b.p, { batched: true });
        await new Promise(r => setTimeout(r, 30));
        assert.equal(el.hidden, false);
        assert.equal(el.textContent, slowSaveText(true), 'a batched write is waiting — stay-here wording');
        b.resolve(); await pb; await tick();
        assert.equal(el.hidden, false, 'the plain write still waits');
        assert.equal(el.textContent, slowSaveText(false), 'no batched write left — the ordinary wording returns');
        a.resolve(); await pa; await tick();
        assert.equal(el.hidden, true, 'the last write landed — the notice goes');
    } finally {
        globalThis.document = prevDoc; globalThis.__E2E = prevE2E;
    }
});

test('writesInFlight counts every wrapped write until it settles, quick or slow, success or failure (review A13)', async () => {
    // Admin's service-worker reload asks this before reloading: a range booking commits in chunks,
    // and a reload between two of them strands the rest.
    const a = deferred(), b = deferred();
    const base = writesInFlight();
    const pa = withSlowSaveNotice(a.p);
    const pb = withSlowSaveNotice(b.p, { batched: true });
    assert.equal(writesInFlight(), base + 2);
    a.resolve(); await pa; await tick();
    assert.equal(writesInFlight(), base + 1, 'one landed, one still waiting');
    b.reject(new Error('refused')); await pb.catch(() => {}); await tick();
    assert.equal(writesInFlight(), base, 'a refused write is no longer in flight either');
});

test('an UNCONFIRMED write keeps writesInFlight above zero, so no automatic reload strands it (v24.39)', async () => {
    const { writesInFlight } = await import('./slow-save.js');
    const { runGatedWrite, _resetUnconfirmedWrites, SIGNED_OUT_CODE } = await import('./claim-retry.js');
    _resetUnconfirmedWrites();
    assert.equal(writesInFlight(), 0);
    await runGatedWrite(async () => { throw Object.assign(new Error('gone'), { code: SIGNED_OUT_CODE }); }).catch(() => {});
    assert.equal(writesInFlight(), 1);
    _resetUnconfirmedWrites();
});
