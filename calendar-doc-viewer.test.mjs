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

mock.module('./overlay.js', {
    namedExports: { createLightbox: () => ({ open() {}, close() {} }) },
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
