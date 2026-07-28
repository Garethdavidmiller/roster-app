/**
 * Unit tests for calendar-doc-viewer.js — the #circular / #newsletter notification viewer.
 * Run: node --experimental-test-module-mocks --test calendar-doc-viewer.test.mjs
 *
 * WHY THIS FILE EXISTS. v19.01 gave this path a PLAIN `await authReady`, with a comment arguing the
 * visible "Loading…" made an unbounded wait acceptable. It does not: a loading state says something
 * is happening, it does not make the wait RECOVERABLE. On a stalled connection where persistence
 * setup or `signInAnonymously` never settles, the fetch was never attempted and the viewer sat on
 * "Loading…" indefinitely — from an explicit user action (a notification tap), with no failure ever
 * announced to a screen reader and nothing to press.
 *
 * It shipped because nothing tested this module at all. These tests pin the two properties that
 * matter and would have caught it: the open always REACHES A TERMINAL STATE, and the failure state
 * carries a CONTROL rather than only text.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let _circularImpl = () => Promise.resolve(null);

// The stub must honour onClose — that callback is what invalidates an in-flight open (v19.13),
// so a stub that swallows it would make the close tests below pass against broken code.
let _lbClose = () => {};
mock.module('./overlay.js', {
    namedExports: {
        createLightbox: (cfg) => {
            _lbClose = () => { cfg?.onClose?.(); };
            return { open() {}, close() { _lbClose(); } };
        },
    },
});
mock.module('./firebase-client.js', {
    namedExports: {
        getLatestCircular:   (...a) => _circularImpl(...a),
        getLatestNewsletter: () => Promise.resolve(null),
        isSafeStorageUrl:    () => true,
        officeViewerUrl:     (u) => u,
    },
});
mock.module('./usage-reporter.js', { namedExports: { recordOpen: () => {} } });
mock.module('./calendar-member.js', {
    namedExports: { getCurrentMember: () => ({ name: 'G. Miller' }), isFirstRun: () => false },
});

const { initDocViewer } = await import('./calendar-doc-viewer.js');

// ── Minimal fake DOM ──────────────────────────────────────────────────────────
function makeEl() {
    const kids = [], listeners = {};
    const el = {
        _children: kids, textContent: '', className: '', type: '',
        appendChild(c) { kids.push(c); return c; },
        addEventListener(e, fn) { (listeners[e] ||= []).push(fn); },
        setAttribute() {}, focus() {},
        _fire(e) { (listeners[e] || []).forEach(fn => fn()); },
    };
    return el;
}
let _els;
function setupDOM() {
    _els = { docViewer: makeEl(), docViewerContent: makeEl(), docViewerTitle: makeEl(),
             docViewerBody: makeEl(), docViewerClose: makeEl() };
    global.document = {
        getElementById: id => _els[id] ?? null,
        createElement:  () => makeEl(),
        addEventListener() {}, removeEventListener() {},
    };
    global.window = {
        location: { hash: '', pathname: '/', search: '' },
        addEventListener() {},
        open() { return null; },
    };
    global.history = { replaceState() {} };   // bare global in browsers, as handleHash uses it
}
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
/** Text of everything currently rendered into the viewer body. */
const bodyText = () => _els.docViewerBody._children.map(c => c.textContent).join(' | ');

beforeEach(() => { _circularImpl = () => Promise.resolve(null); setupDOM(); });

describe('doc viewer — the open must always reach a terminal state', () => {
    test('a never-resolving authReady still ends in a failure state, not "Loading…" forever', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let fetched = false;
        _circularImpl = () => { fetched = true; return Promise.resolve(null); };

        // A notification tap lands on the hash, then the module initialises and opens the viewer.
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: new Promise(() => {}) });   // sign-in never settles
        await flush();

        t.mock.timers.tick(2000);      // the bounded auth wait elapses
        await flush();

        assert.equal(fetched, true,
            'past the bounded auth wait the read must be attempted — otherwise the viewer spins forever');
    });

    test('a LATE SUCCESS after the viewer is closed writes nothing and steals no focus', async () => {
        // Dismissal is as much a "no longer wanted" signal as a newer tap, and it was not treated as
        // one: the late resolve appended an Open button into the hidden dialog and called .focus() on
        // it. Invisible to a mouse user; for a keyboard or screen-reader user it drags focus out of
        // whatever the lightbox restored it to, into content that is not on screen.
        let resolveIt;
        _circularImpl = () => new Promise(res => { resolveIt = res; });
        let focused = 0;
        const origCreate = global.document.createElement;
        global.document.createElement = (...a) => {
            const el = origCreate(...a);
            el.focus = () => { focused++; };
            return el;
        };

        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve() });
        await flush();

        _lbClose();                                   // the member closes it while still loading
        resolveIt({ storageUrl: 'https://x/y.pdf', fileType: 'pdf' });
        await flush();

        assert.equal(focused, 0, 'nothing inside a dismissed dialog may take focus');
        assert.doesNotMatch(bodyText(), /Open /, 'and no button may be appended into it');
    });

    test('a LATE FAILURE after the viewer is closed writes nothing and steals no focus', async () => {
        let rejectIt;
        _circularImpl = () => new Promise((_r, rej) => { rejectIt = rej; });
        let focused = 0;
        const origCreate = global.document.createElement;
        global.document.createElement = (...a) => {
            const el = origCreate(...a);
            el.focus = () => { focused++; };
            return el;
        };

        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve() });
        await flush();

        _lbClose();
        rejectIt(new Error('offline'));
        await flush();

        assert.equal(focused, 0, 'the retry button must not be focused inside a closed viewer');
        assert.doesNotMatch(bodyText(), /Try again/, 'nor rendered into it');
    });

    test('a fetch that NEVER settles still reaches the failure state at the 8s deadline', async (t) => {
        // The other deadline. The test above covers auth never settling (the 2s bound); this covers
        // the read itself hanging — a stalled Firestore request that neither resolves nor rejects.
        // Without the total deadline the viewer sits on "Loading…" exactly as it did before v19.08,
        // just for a different reason, so the two bounds need separate cover.
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _circularImpl = () => new Promise(() => {});   // never settles

        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve() });
        await flush();

        t.mock.timers.tick(2000);      // past the auth bound — the read is attempted and hangs
        await flush();
        assert.doesNotMatch(bodyText(), /Try again/, 'still legitimately loading before the deadline');

        t.mock.timers.tick(6000);      // 8s total
        await flush();

        assert.match(bodyText(), /Try again/,
            'a hung read must land in the recoverable failure state, not spin forever');
    });

    test('the retry button issues a REAL second request', async (t) => {
        // The test below asserts the control exists. That is not the same as it working: an inert
        // button with the right label passes it, and a retry that does nothing is worse than no
        // retry at all — it looks like the app tried and failed twice.
        t.mock.timers.enable({ apis: ['setTimeout'] });
        let calls = 0;
        _circularImpl = () => { calls++; return Promise.reject(new Error('offline')); };

        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve() });
        await flush();
        assert.equal(calls, 1, 'precondition: the first attempt ran and failed');

        const btn = _els.docViewerBody._children.find(c => /Try again/.test(c.textContent));
        assert.ok(btn, 'the retry control is present');
        btn._fire('click');
        await flush();
        t.mock.timers.tick(2000);
        await flush();

        assert.equal(calls, 2, 'pressing it must actually re-read the document');
    });

    test('the failure state offers a retry CONTROL, not just text', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        _circularImpl = () => Promise.reject(new Error('offline'));

        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve() });
        await flush();

        const rendered = bodyText();
        assert.match(rendered, /Try again/,
            `the failure state must carry a control a user (and a screen reader) can act on — got: ${rendered}`);
    });
});
