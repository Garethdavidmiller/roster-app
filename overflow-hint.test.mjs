/**
 * overflow-hint.test.mjs — the "swipe the table" line shows only while its table really scrolls.
 * Run: node scripts/run-tests.mjs overflow-hint.test.mjs   (part of `npm run test:hygiene`)
 *
 * The rule and its watch, with the browser's two collaborators stood in for: a ResizeObserver that
 * RECORDS what it is given and fires when the test says the size changed, and a frame queue the test
 * flushes. The wiring — the real lines, really hidden, on a real resize — is e2e/calendar.spec.js
 * (Team view) and e2e/trains.spec.js (the stopping grid).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { watchOverflowHint } from './overflow-hint.js';

/** A scroll box with a table in it, or without one. */
function box(/** @type {number} */ scrollWidth, /** @type {number} */ clientWidth, { table = true } = {}) {
    const t = table ? { tag: 'table' } : null;
    return { scrollWidth, clientWidth, table: t, querySelector: (/** @type {string} */ sel) => (sel === 'table' ? t : null) };
}
const line = () => ({ hidden: /** @type {boolean|undefined} */ (undefined) });

/** @type {FakeObserver[]} */ let observers;
/** @type {(() => void)[]} */ let frames;
class FakeObserver {
    /** @param {() => void} cb */
    constructor(cb) { this.cb = cb; /** @type {unknown[]} */ this.watched = []; this.connected = true; observers.push(this); }
    /** @param {unknown} el */ observe(el) { this.watched.push(el); }
    disconnect() { this.connected = false; }
    fire() { this.cb(); }
}
const flush = () => { for (const fn of frames.splice(0)) fn(); };
const run = (/** @type {any} */ wrap, /** @type {any} */ hint) => watchOverflowHint(wrap, hint);

beforeEach(() => {
    observers = [];
    frames = [];
    /** @type {any} */ (globalThis).ResizeObserver = FakeObserver;
    /** @type {any} */ (globalThis).requestAnimationFrame = (/** @type {() => void} */ fn) => frames.push(fn);
});
afterEach(() => {
    delete /** @type {any} */ (globalThis).ResizeObserver;
    delete /** @type {any} */ (globalThis).requestAnimationFrame;
});

describe('watchOverflowHint — the line shows only while the table scrolls sideways', () => {
    test('wider than its box shows the line, fitting hides it — measured at once, before any frame', () => {
        const wide = line(), fits = line();
        run(box(500, 300), wide);
        run(box(300, 300), fits);
        assert.equal(wide.hidden, false);
        assert.equal(fits.hidden, true);
        assert.equal(frames.length, 0, 'the first answer waited for a frame, so the line could arrive showing');
    });

    test('a rounding pixel is not a scroll; two are', () => {
        const one = line(), two = line();
        run(box(301, 300), one);
        run(box(302, 300), two);
        assert.equal(one.hidden, true);
        assert.equal(two.hidden, false);
    });

    test('a later change of size is measured again — a frame after the watch reports it, not inside it', () => {
        const wrap = box(500, 300), hint = line();
        run(wrap, hint);
        wrap.clientWidth = 600;                 // widened in place: a rotation, a resized window
        observers[0].fire();
        assert.equal(hint.hidden, false, 'changed inside the observer callback, which reports a resize loop');
        flush();
        assert.equal(hint.hidden, true, 'widened until it fits, and the line stayed');
        wrap.clientWidth = 320;                 // and narrowed again
        observers[0].fire();
        flush();
        assert.equal(hint.hidden, false, 'narrowed until it scrolls, and the line did not come back');
    });

    test('it watches the box AND its table, so a table that grows inside an unchanged box is seen', () => {
        const withTable = box(500, 300);
        run(withTable, line());
        assert.deepEqual(observers[0].watched, [withTable, withTable.table]);
        const bare = box(500, 300, { table: false });
        run(bare, line());
        assert.deepEqual(observers[1].watched, [bare]);
    });

    test('the watch is handed back, so the caller can stop it when the table goes', () => {
        const watch = run(box(500, 300), line());
        assert.equal(watch, observers[0]);
        watch?.disconnect();
        assert.equal(observers[0].connected, false);
    });

    test('nothing to watch — no box, or no line: null, nothing touched, nothing watched', () => {
        const hint = line();
        assert.equal(run(null, hint), null);
        assert.equal(hint.hidden, undefined);
        assert.equal(run(box(500, 300), null), null);
        assert.equal(observers.length, 0);
    });

    test('no ResizeObserver: measured once, and null — the line is right as drawn, if not after', () => {
        delete /** @type {any} */ (globalThis).ResizeObserver;
        const hint = line();
        assert.equal(run(box(500, 300), hint), null);
        assert.equal(hint.hidden, false);
    });
});
