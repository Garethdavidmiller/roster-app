// slow-save.test.mjs — the "waiting for signal" watcher (slow-save.js, v24.21).
// Pure: timers are injected, so nothing here waits eight real seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchSlowCommit, SLOW_SAVE_MS, SLOW_SAVE_TEXT } from './slow-save.js';

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
    assert.match(SLOW_SAVE_TEXT, /held on this phone/);
    assert.doesNotMatch(SLOW_SAVE_TEXT, /!/, 'calm tone — no exclamation marks');
});
