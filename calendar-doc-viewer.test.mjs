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
import { resolveDocumentOpenUrl as realResolveDocumentOpenUrl } from './storage-utils.js';

let _circularImpl = () => Promise.resolve(null);

// The stub must honour onClose — that callback is what invalidates an in-flight open (v19.13),
// so a stub that swallows it would make the close tests below pass against broken code.
let _lbClose = () => {};
/** Every history step the viewer took, and the pop interceptors it registered (cal-docs-8). */
let _historyCalls = [];
let _interceptors = [];
mock.module('./overlay.js', {
    namedExports: {
        // onOpen and afterClose run as the real lifecycle runs them: before the overlay shows, and
        // once a close has landed — the paint-order raise (cal-docs-6) lives in that pair.
        createLightbox: (cfg) => {
            _lbClose = () => { cfg?.onClose?.(); cfg?.afterClose?.(); };
            return { open() { cfg?.onOpen?.(); }, close() { _lbClose(); } };
        },
        registerPopInterceptor: (fn) => { _interceptors.push(fn); },
        suppressNextPop: () => { _historyCalls.push('suppress'); },
        whenHistorySettled: (fn) => fn(),
    },
});
// The short-lived-url fetch (v24.19). Swapped per test; `null` is the state the app SHIPS in
// (no IAM grant yet), so it is the default here too.
let _signedImpl = () => Promise.resolve(null);
mock.module('./firebase-client.js', {
    namedExports: {
        getLatestCircular:   (...a) => _circularImpl(...a),
        getLatestNewsletter: () => Promise.resolve(null),
        isSafeStorageUrl:    () => true,
        officeViewerUrl:     (u) => u,
        fetchSignedDocumentUrl: (...a) => _signedImpl(...a),
        // THE REAL ONE, deliberately. Stubbing the decision would leave this file testing that the
        // viewer calls a function, which is not the question — the question is which url a member
        // ends up opening, and only the real rule answers that.
        resolveDocumentOpenUrl: realResolveDocumentOpenUrl,
    },
});
/** @type {any[][]} every recordOpen call, so the open counter's IDENTITY can be asserted (v25.00) */
const _opens = [];
mock.module('./usage-reporter.js', { namedExports: { recordOpen: (...a) => { _opens.push(a); } } });
// The SESSION, not the Calendar's selected member, is the open counter's identity (v25.00): on the
// station PC the selection is whichever row was picked last, and excluding on it dropped staff opens.
let _session = null;
mock.module('./session.js', { namedExports: { getSession: () => _session } });

const { initDocViewer } = await import('./calendar-doc-viewer.js');

// ── Minimal fake DOM ──────────────────────────────────────────────────────────
function makeEl() {
    const kids = [], listeners = {}, attrs = {};
    let text = '';
    const el = {
        _children: kids, _attrs: attrs, _parent: null, className: '', type: '', style: {},
        // Setting the text replaces the children, as it does in a browser.
        get textContent() { return text + kids.map(c => (typeof c === 'string' ? c : c.textContent)).join(''); },
        set textContent(v) { text = v; kids.length = 0; },
        get children() { return kids.filter(c => typeof c !== 'string'); },
        appendChild(c) { kids.push(c); c._parent = el; return c; },
        append(...parts) { kids.push(...parts); },
        remove() { const at = el._parent?._children.indexOf(el) ?? -1; if (at >= 0) el._parent._children.splice(at, 1); el._parent = null; },
        addEventListener(e, fn) { (listeners[e] ||= []).push(fn); },
        setAttribute(k, v) { attrs[k] = v; }, focus() {},
        classList: { contains: () => false },
        _fire(e) { (listeners[e] || []).forEach(fn => fn()); },
    };
    return el;
}
let _els;
/** The page's `pagehide`/`pageshow`/`hashchange` listeners, by type. */
let _winListeners;
/** A stand-in sessionStorage, so the carried tap (cal-docs-1) can be read and written. */
let _tabStore;
function setupDOM() {
    _els = { docViewer: makeEl(), docViewerContent: makeEl(), docViewerTitle: makeEl(),
             docViewerStatus: makeEl(), docViewerBody: makeEl(), docViewerClose: makeEl() };
    _els.docViewerBody.appendChild(_els.docViewerStatus);   // the status line starts inside the body (index.html)
    _winListeners = {};
    _tabStore = new Map();
    global.document = {
        getElementById: id => _els[id] ?? null,
        createElement:  () => makeEl(),
        addEventListener() {}, removeEventListener() {},
    };
    global.window = {
        location: { hash: '', pathname: '/', search: '' },
        addEventListener(t, fn) { (_winListeners[t] ||= []).push(fn); },
        open() { return null; },
    };
    // bare globals in browsers, as the module uses them
    global.history = { replaceState() { _historyCalls.push('replace'); }, back() { _historyCalls.push('back'); } };
    global.sessionStorage = {
        getItem: k => (_tabStore.has(k) ? _tabStore.get(k) : null),
        setItem: (k, v) => { _tabStore.set(k, String(v)); },
        removeItem: k => { _tabStore.delete(k); },
    };
}
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
/** Text of everything currently in the viewer body — its status line first, then any button. */
const bodyText = () => _els.docViewerBody._children.map(c => c.textContent).filter(Boolean).join(' | ');

beforeEach(() => {
    _circularImpl = () => Promise.resolve(null); _signedImpl = () => Promise.resolve(null);
    _historyCalls = []; _interceptors = [];
    setupDOM();
});

describe('doc viewer — THE DOCUMENT GATE (v23.17): a locked tap reads nothing, and the unlock finishes it', () => {
    test('while locked: the message, and NO fetch — cached or live', async () => {
        let fetched = 0;
        _circularImpl = () => { fetched++; return Promise.resolve(null); };
        global.window.location.hash = '#circular';
        const subs = [];
        initDocViewer({ authReady: Promise.resolve(), docAccess: { has: () => false, onChange: fn => { subs.push(fn); return () => {}; } } });
        await flush();
        assert.equal(fetched, 0, 'a locked viewer must not issue the read — the local cache would answer it');
        assert.match(bodyText(), /Enter the staff PIN, or sign in, to read the Weekly Retail Circular/);
        assert.equal(subs.length, 1, 'it subscribes to the gate so the unlock can finish the tap');
    });

    test('the grant finishes the held tap — the deep link survives the unlock', async () => {
        let fetched = 0;
        _circularImpl = () => { fetched++; return Promise.resolve(null); };
        let open = false;
        const subs = [];
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve(), docAccess: { has: () => open, onChange: fn => { subs.push(fn); return () => {}; } } });
        await flush();
        assert.equal(fetched, 0);
        open = true; subs.forEach(fn => fn(true));   // the PIN goes in
        await flush();
        assert.equal(fetched, 1, 'the read the lock held back runs exactly once');
        assert.match(bodyText(), /No Weekly Retail Circular has been uploaded yet/, 'and its result is on screen');
    });

    test('a tap the reader CLOSED while locked is STILL finished by the PIN — closing was the only way to reach the form', async () => {
        // The locked message sits over the PIN card. The first cut dropped the held tap on close,
        // which meant: notification tap → message → close it to type → PIN → nothing. Found by the
        // e2e, where Playwright could not even reach the PIN field through the overlay.
        let fetched = 0;
        _circularImpl = () => { fetched++; return Promise.resolve(null); };
        let open = false;
        const subs = [];
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve(), docAccess: { has: () => open, onChange: fn => { subs.push(fn); return () => {}; } } });
        await flush();
        _lbClose();   // the reader closes the message to get at the PIN form beneath it
        await flush();
        open = true; subs.forEach(fn => fn(true));
        await flush();
        assert.equal(fetched, 1, 'the document they came for opens once the PIN is in');
    });
});

describe('doc viewer — a LOCK while a document is loading takes it down (v24.56)', () => {
    test('the read in flight renders nothing, and the viewer says what unlocks it', async () => {
        /** @type {(v: any) => void} */ let land = () => {};
        _circularImpl = () => new Promise(r => { land = r; });
        let open = true;
        const subs = [];
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve(), docAccess: { has: () => open, onChange: fn => { subs.push(fn); return () => {}; } } });
        await flush();
        open = false; subs.forEach(fn => fn(false));   // access lost mid-read
        land({ storageUrl: 'https://firebasestorage.googleapis.com/x', date: '2026-10-01', fileType: 'pdf' });
        await flush();
        assert.doesNotMatch(bodyText(), /Open/, 'a read from before the lock must not offer the document');
        assert.match(bodyText(), /Enter the staff PIN, or sign in, to read the Weekly Retail Circular/);
        let fetched = 0;
        _circularImpl = () => { fetched++; return Promise.resolve(null); };
        open = true; subs.forEach(fn => fn(true));   // the PIN it asked for goes in
        await flush();
        assert.equal(fetched, 1, 'the document re-opens — the message asked for the PIN, so the PIN must work');
    });
});

describe('doc viewer — a COLD deep link waits for the access decision before calling itself locked', () => {
    // The viewer is wired before the Calendar decides access, so a notification tap that cold-opens
    // the page finds the gate shut simply because nothing has been decided yet — and told a
    // signed-in member to enter the staff PIN for the second or two the decision took.
    test('undecided: "Loading…", not the PIN message', async (t) => {
        // Mock timers (test audit, 7 Nov 2026): a decision that never comes leaves the viewer's own 8s
        // bound waiting, correctly — on the real clock it held this file open for eight seconds.
        t.mock.timers.enable({ apis: ['setTimeout'] });
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve(), accessDecided: new Promise(() => {}),
            docAccess: { has: () => false, onChange: () => () => {} } });
        await flush();
        assert.doesNotMatch(bodyText(), /staff PIN/, 'a member was told to enter the PIN before access was decided');
        assert.match(bodyText(), /Loading/);
    });

    test('decided LOCKED: only now does it say what unlocks it', async () => {
        let decide = () => {};
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve(), accessDecided: new Promise(r => { decide = r; }),
            docAccess: { has: () => false, onChange: () => () => {} } });
        await flush();
        decide(); await flush();
        assert.match(bodyText(), /Enter the staff PIN, or sign in, to read the Weekly Retail Circular/);
    });

    test('decided GRANTED: the held tap reads, and the PIN message never appears', async () => {
        let fetched = 0;
        _circularImpl = () => { fetched++; return Promise.resolve(null); };
        let open = false, decide = () => {};
        const subs = [];
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve(), accessDecided: new Promise(r => { decide = r; }),
            docAccess: { has: () => open, onChange: fn => { subs.push(fn); return () => {}; } } });
        await flush();
        open = true; subs.forEach(fn => fn(true)); decide();   // the grant lands, then the decision settles
        await flush();
        assert.equal(fetched, 1);
        assert.doesNotMatch(bodyText(), /staff PIN/);
    });

    test('once decided, a LATER locked tap says what unlocks it straight away', async () => {
        /** @type {Function|null} */ let onHash = null;
        global.window.addEventListener = (ev, fn) => { if (ev === 'hashchange') onHash = fn; };
        initDocViewer({ authReady: Promise.resolve(), accessDecided: Promise.resolve(),
            docAccess: { has: () => false, onChange: () => () => {} } });
        await flush();
        global.window.location.hash = '#circular';
        onHash?.();
        assert.match(bodyText(), /Enter the staff PIN, or sign in/, 'a tap after the decision sat on "Loading…"');
    });

    test('a waiting tap the reader CLOSED is not re-shown by the decision', async () => {
        let decide = () => {};
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve(), accessDecided: new Promise(r => { decide = r; }),
            docAccess: { has: () => false, onChange: () => () => {} } });
        await flush();
        _lbClose();
        _els.docViewerStatus.textContent = '';
        decide(); await flush();
        assert.equal(bodyText(), '', 'the decision wrote into a viewer the reader had closed');
    });
});

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

// ── THE WIRING, NOT THE RULE (v24.19) ──────────────────────────────────────────────────────────
//
// `storage-utils.test.mjs` proves resolveDocumentOpenUrl chooses correctly. That is not the same
// as this viewer opening what it chose — the coordinator could fetch nothing, pass the wrong
// argument, or discard the result, and every one of those leaves that file green. This block drives
// the real module and asserts what a member's browser is actually handed.
describe('doc viewer — which URL the member actually opens (v24.19)', () => {

    const SIGNED = 'https://storage.googleapis.com/myb-roster.appspot.com/circulars/x.pdf?X-Goog-Expires=900';
    const STORED = 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/circulars%2Fx.pdf?token=perm';

    /** Open the circular, press its button, and report the url window.open received. */
    async function openedUrl() {
        let got = null;
        const realOpen = global.window.open;
        global.window.open = (u) => { got = u; return null; };
        try {
            global.window.location.hash = '#circular';
            initDocViewer({ authReady: Promise.resolve() });
            await flush();
            const btn = _els.docViewerBody._children.find(c => /Open/.test(c.textContent));
            assert.ok(btn, 'no open control was rendered');
            btn._fire('click');
            await flush();
        } finally { global.window.open = realOpen; }
        return got;
    }

    test('with a signed url available, THAT is what opens — not the permanent one', async () => {
        _circularImpl = () => Promise.resolve({ storageUrl: STORED, fileType: 'pdf' });
        _signedImpl   = () => Promise.resolve(SIGNED);
        assert.equal(await openedUrl(), SIGNED,
            'the viewer fetched a short-lived url and then opened the permanent one anyway — which '
            + 'is the whole change, silently undone');
    });

    test('with no signed url, the stored one still opens — a member is never stranded', async () => {
        // The state the app ships in: the IAM grant is not in place, so every call 503s and
        // fetchSignedDocumentUrl returns null. This must be indistinguishable from before v24.19.
        _circularImpl = () => Promise.resolve({ storageUrl: STORED, fileType: 'pdf' });
        _signedImpl   = () => Promise.resolve(null);
        assert.equal(await openedUrl(), STORED);
    });

    test('the open is counted against the SIGNED-IN member, never the selected one (v25.00)', async () => {
        // Nobody signed in (the station PC on the PIN): counted, whatever row is selected — an
        // admin's included, which is exactly the case that used to drop every staff open there.
        _circularImpl = () => Promise.resolve({ storageUrl: STORED, fileType: 'pdf' });
        _opens.length = 0; _session = null;
        await openedUrl();
        assert.deepEqual(_opens, [['circular', null]]);
        // The admin signed in: the reporter is handed the admin's name, and leaves the open out.
        _opens.length = 0; _session = { name: 'G. Miller' };
        await openedUrl();
        assert.deepEqual(_opens, [['circular', 'G. Miller']]);
        _session = null;
    });

    test('the fetch is asked for the right KIND', async () => {
        let asked = null;
        _circularImpl = () => Promise.resolve({ storageUrl: STORED, fileType: 'pdf' });
        _signedImpl   = (k) => { asked = k; return Promise.resolve(SIGNED); };
        await openedUrl();
        assert.equal(asked, 'circular',
            'the endpoint signs the LATEST document of the kind it is given, so a wrong kind here '
            + 'hands the member a url for somebody else\'s document');
    });

    test('a signed url that LAPSED before the tap is passed over for the stored one (v24.23)', async () => {
        // Minted when the viewer opened; the member locked the phone and came back. The click must
        // decide at the TAP, or it hands over a link that no longer works.
        _circularImpl = () => Promise.resolve({ storageUrl: STORED, fileType: 'pdf' });
        _signedImpl   = () => Promise.resolve({ url: SIGNED, expiresAt: Date.now() - 60_000, fileType: 'pdf' });
        assert.equal(await openedUrl(), STORED, 'a lapsed short-lived url was opened');
    });

    test('a LIVE signed url object opens as the signed url', async () => {
        _circularImpl = () => Promise.resolve({ storageUrl: STORED, fileType: 'pdf' });
        _signedImpl   = () => Promise.resolve({ url: SIGNED, expiresAt: Date.now() + 10 * 60_000, fileType: 'pdf' });
        assert.equal(await openedUrl(), SIGNED);
    });

    test('a signed url for a DIFFERENT upload is passed over — the viewer passes its own path (v24.33)', async () => {
        // The entry point, not the helper: deleting `storagePath: doc.storagePath` from the viewer's
        // call leaves every storage-utils test green, so the wiring is pinned here.
        _circularImpl = () => Promise.resolve({ storageUrl: STORED, fileType: 'pdf', storagePath: 'circulars/2026-09-25-a.pdf' });
        _signedImpl   = () => Promise.resolve({ url: SIGNED, expiresAt: Date.now() + 10 * 60_000, fileType: 'pdf',
            storagePath: 'circulars/2026-09-26-b.pdf' });
        assert.equal(await openedUrl(), STORED, 'the url for a newer upload was opened from this document\'s viewer');
    });

    test('and the same upload opens as the signed url', async () => {
        _circularImpl = () => Promise.resolve({ storageUrl: STORED, fileType: 'pdf', storagePath: 'circulars/2026-09-25-a.pdf' });
        _signedImpl   = () => Promise.resolve({ url: SIGNED, expiresAt: Date.now() + 10 * 60_000, fileType: 'pdf',
            storagePath: 'circulars/2026-09-25-a.pdf' });
        assert.equal(await openedUrl(), SIGNED);
    });

    test('the url is minted BEFORE the click, so the gesture is not spent', async () => {
        // The constraint that shaped this design. `window.open` without a user gesture is
        // pop-up-blocked and drops the PWA out of standalone, so the fetch must have finished by
        // the time the button exists — not be started by pressing it.
        let fetched = 0;
        _circularImpl = () => Promise.resolve({ storageUrl: STORED, fileType: 'pdf' });
        _signedImpl   = () => { fetched++; return Promise.resolve(SIGNED); };

        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve() });
        await flush();
        assert.equal(fetched, 1,
            'nothing was minted while the viewer loaded, so the click handler must be doing it — '
            + 'which spends the user gesture and gets the open pop-up-blocked');
    });
});

// ── THE WHOLE-APP REVIEW'S FINDINGS (10 Nov 2026) ───────────────────────────────────────────────────
const HELD = 'myb_held_doc_tap';
/** The document gate, as calendar-doc-access.js presents it, with a lever to move it. */
function gateOf(open) {
    let isOpen = open; const subs = [];
    return { has: () => isOpen, onChange: fn => { subs.push(fn); return () => {}; }, set(v) { isOpen = v; subs.forEach(fn => fn(v)); } };
}

describe('cal-docs-1 · a tap the lock is holding survives the sign-in\'s reload', () => {
    test('written down as the page unloads; the reloaded page reads it once, and the grant finishes it', async () => {
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve(), docAccess: gateOf(false) });
        await flush();
        assert.match(bodyText(), /Enter the staff PIN, or sign in/);
        _winListeners.pagehide.forEach(fn => fn());              // the sign-in reloads the page
        assert.match(_tabStore.get(HELD) ?? '', /^\d+\|circular$/, 'the held tap was not written down');

        const kept = new Map(_tabStore);                          // the reloaded page: nothing else survives
        setupDOM(); _tabStore = kept;
        let fetched = 0;
        _circularImpl = () => { fetched++; return Promise.resolve(null); };
        const gate = gateOf(false);
        initDocViewer({ authReady: Promise.resolve(), docAccess: gate });
        await flush();
        assert.equal(_tabStore.has(HELD), false, 'a record is good for one load');
        assert.equal(fetched, 0, 'still undecided: no read, cached or live');
        gate.set(true);                                           // the sign-in's grant
        await flush();
        assert.equal(fetched, 1, 'the member signed in and the document they tapped for never came');
        assert.match(bodyText(), /No Weekly Retail Circular has been uploaded yet/);
    });

    test('an open Calendar writes nothing; a record older than a minute is not read; a bfcache restore drops one', async () => {
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve(), docAccess: gateOf(true) });
        await flush();
        _winListeners.pagehide.forEach(fn => fn());
        assert.equal(_tabStore.has(HELD), false, 'a tap answered on an open Calendar was carried');

        setupDOM();
        _tabStore.set(HELD, `${Date.now() - 61_000}|circular`);
        let fetched = 0;
        _circularImpl = () => { fetched++; return Promise.resolve(null); };
        initDocViewer({ authReady: Promise.resolve(), docAccess: gateOf(true) });
        await flush();
        assert.equal(fetched, 0, 'a tap from an earlier visit opened the document');

        setupDOM();
        global.window.location.hash = '#newsletter';
        initDocViewer({ authReady: Promise.resolve(), docAccess: gateOf(false) });
        await flush();
        _winListeners.pagehide.forEach(fn => fn());
        assert.ok(_tabStore.has(HELD), 'guard: the locked tap was written down');
        _winListeners.pageshow.forEach(fn => fn({ persisted: true }));
        assert.equal(_tabStore.has(HELD), false, 'back from the back/forward cache the page\'s memory is current');
    });
});

describe('cal-docs-8 · a tap leaves no dead history entry, and is not a Back press', () => {
    test('a tap on an open page takes its own entry back off; a cold deep link\'s is rewritten in place', async () => {
        initDocViewer({ authReady: Promise.resolve() });
        await flush();
        assert.deepEqual(_historyCalls, [], 'nothing to consume on a page opened with no hash');
        global.window.location.hash = '#newsletter';
        _winListeners.hashchange.forEach(fn => fn());
        assert.deepEqual(_historyCalls, ['back', 'suppress'], 'the tap\'s entry was rewritten into a dead copy of the page');

        setupDOM(); _historyCalls = [];
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve() });
        assert.deepEqual(_historyCalls, ['replace'], 'stepping back from a cold open would leave the app');
    });

    test('the tap\'s own popstate is claimed, so it closes nothing — and only the two document hashes', () => {
        initDocViewer({ authReady: Promise.resolve() });
        assert.equal(_interceptors.length, 1);
        for (const [hash, claimed] of [['#circular', true], ['#newsletter', true], ['', false], ['#huddle', false], ['#staff-pin', false]]) {
            global.window.location.hash = hash;
            assert.equal(_interceptors[0](), claimed, `popstate at "${hash}"`);
        }
    });
});

describe('cal-docs-6 · opened over the Huddle viewer, it is drawn over it', () => {
    test('raised above the Huddle viewer\'s band for that open, and back in its own once closed', async () => {
        _els.huddleViewer = { classList: { contains: c => c === 'visible' } };
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve() });
        await flush();
        assert.equal(_els.docViewer.style.zIndex, 'calc(var(--z-notice) + 1)',
            'opened under the Huddle viewer while on top of the overlay stack — the tap seems to do nothing');
        _lbClose();
        assert.equal(_els.docViewer.style.zIndex, '');
    });

    test('with no Huddle viewer up it stays in the lightbox band', async () => {
        _els.huddleViewer = { classList: { contains: () => false } };
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve() });
        await flush();
        assert.ok(!_els.docViewer.style.zIndex, 'raised over nothing');
    });
});

describe('cal-docs-16 · the dialog is named for its document, and its outcome is spoken', () => {
    test('the title names it, the emoji hidden from that name; every message is in the ONE status line', async () => {
        global.window.location.hash = '#newsletter';
        const gate = gateOf(false);
        initDocViewer({ authReady: Promise.resolve(), docAccess: gate });
        await flush();
        const [glyph, words] = _els.docViewerTitle._children;
        assert.equal(glyph._attrs['aria-hidden'], 'true', 'the emoji would be read out as part of the dialog\'s name');
        assert.equal(words, 'Marylebone Newsletter');
        assert.match(_els.docViewerStatus.textContent, /Enter the staff PIN, or sign in, to read the Marylebone Newsletter/);
        assert.deepEqual(_els.docViewerBody._children, [_els.docViewerStatus], 'a message outside the status line is not spoken');
        gate.set(true);
        await flush();
        assert.equal(_els.docViewerStatus.textContent, 'No Marylebone Newsletter has been uploaded yet.');
    });

    test('a document ready to open clears the line: its button takes focus and speaks for itself', async () => {
        _circularImpl = () => Promise.resolve({ fileType: 'pdf',
            storageUrl: 'https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/circulars%2Fx.pdf?token=perm' });
        global.window.location.hash = '#circular';
        initDocViewer({ authReady: Promise.resolve() });
        await flush();
        assert.equal(_els.docViewerStatus.textContent, '', '"Loading…" was left standing beside the Open button');
        assert.match(_els.docViewerBody._children.map(c => c.textContent).join(''), /Open Weekly Retail Circular/);
    });

    test('in the markup: named by the title, not "Document"; the status line is a live region', async () => {
        const { readFileSync } = await import('node:fs');
        const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
        const dialog = html.match(/<div id="docViewer"[^>]*>/)?.[0] ?? '';
        assert.match(dialog, /aria-labelledby="docViewerTitle"/);
        assert.doesNotMatch(dialog, /aria-label="/, 'an aria-label would name it "Document" again, whichever was open');
        assert.match(html, /<div id="docViewerBody"[^>]*><p id="docViewerStatus"[^>]*role="status"/,
            'the status line is the body\'s first child, so its words sit where the messages always were');
    });
});
