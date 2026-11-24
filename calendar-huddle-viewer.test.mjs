/**
 * calendar-huddle-viewer.test.mjs — the Daily Huddle viewer obeys the document gate (CALENDAR_DATA.md 15).
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs calendar-huddle-viewer.test.mjs
 *
 * WHY THIS FILE EXISTS (test audit, 7 Nov 2026). The viewer is the one document surface that holds
 * a LIVE subscription, so it is the one that has to be taken down when access goes: the listener
 * detached, what it delivered dropped, and an open viewer told why it no longer shows the Huddle.
 * Its sibling, calendar-doc-viewer.js, had 24 Node tests; this module had none, and its lock
 * teardown and generation guard rested on the browser suite alone.
 *
 * A FIRST, FOCUSED SET — not a suite. It drives the real `initHuddleViewer` through its own seams
 * (the gate's `onChange`, the `#huddle` tap, the snapshot callback) and pins two things:
 *   · the TEARDOWN: shutting the gate detaches the listener, a snapshot that outlives it delivers
 *     nothing, and an open viewer says "locked" instead of showing the Huddle;
 *   · the GENERATION GUARD: a subscription still waiting for a session must not attach after a lock
 *     has landed, and two starts waiting together attach ONE listener, not two.
 * Rendering (wrapTables, the sticky column) is e2e/pages.spec.js's.
 *
 * Each test imports a FRESH copy of the module (a query string makes a new instance; its own imports
 * still resolve to the mocks below), because `_huddleData` and `_huddleState` are module state that
 * lives for the page — one test's delivered Huddle would otherwise be the next test's starting point.
 */
import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── Fakes ───────────────────────────────────────────────────────────────────────────────────────

/** Every listener the viewer attached, in order, and whether it was later detached. */
/** @type {Array<{ onData: Function, onError: Function, detached: boolean }>} */
let listeners = [];
mock.module('./firebase-client.js', {
    namedExports: {
        subscribeToLatestHuddle: (/** @type {Function} */ onData, /** @type {Function} */ onError) => {
            const l = { onData, onError, detached: false };
            listeners.push(l);
            return () => { l.detached = true; };
        },
        resolveDocumentOpenUrl: (/** @type {any} */ a) => resolveOpen(a),
        fetchSignedDocumentUrl: async () => null,
    },
});
/** Which url an Open tap resolves to — a fixed one unless a test needs the record's own. @type {(a: any) => any} */
let resolveOpen = () => ({ url: 'https://firebasestorage.googleapis.com/v0/b/x/o/huddle.pdf' });
/** What the viewer asked of the history: each `history.back()` and each echo it claimed as its own. */
/** @type {string[]} */ let historyCalls = [];
/** The pop interceptors the viewer registered — a tap's `popstate` must be claimed, not read as Back. */
/** @type {Array<() => boolean>} */ let interceptors = [];
/** A close's finisher, held back while the test plays the fade — see `dismissOverlay` below. */
/** @type {Array<() => void>} */ let pendingFinishes = [];
/** When true, a close FADES: its finisher waits in `pendingFinishes` until the test runs it. */
let fadeCloses = false;
mock.module('./overlay.js', {
    namedExports: {
        lockBodyScroll() {}, _pushOverlayState() {}, trapFocus() {}, _isTopOverlay: () => true,
        dismissOverlay: (/** @type {any} */ el, /** @type {any} */ opts) => {
            el.classList.remove('open');
            let done = false;
            const finish = () => { if (done) return; done = true; el.classList.remove('visible'); opts?.afterClose?.(); };
            if (!fadeCloses) { finish(); return null; }
            pendingFinishes.push(finish);
            return finish;
        },
        registerPopInterceptor: (/** @type {() => boolean} */ fn) => { interceptors.push(fn); },
        suppressNextPop: () => { historyCalls.push('suppress'); },
        whenHistorySettled: (/** @type {() => void} */ fn) => fn(),
    },
});
/** Every open the viewer counted — one per tap, never two (v18.22), a carried tap included. */
/** @type {any[][]} */ let opens = [];
mock.module('./usage-reporter.js', { namedExports: { recordOpen: (/** @type {any[]} */ ...a) => { opens.push(a); } } });
mock.module('./session.js', { namedExports: { getSession: () => null } });
// THE SANITISER, faked as the identity so the body shows WHICH Huddle was drawn. Its dynamic import is
// still a real one, so it supplies the asynchronous gap the real first load of DOMPurify has — the gap
// every race in the inline-render block below is about. It records the options it was handed.
/** @type {any[]} */ let sanitizeOptions = [];
mock.module('./purify.es.mjs', {
    defaultExport: { sanitize: (/** @type {string} */ html, /** @type {any} */ opts) => { sanitizeOptions.push(opts); return html; } },
});

let _instance = 0;
/** A fresh module instance — see the header. @returns {Promise<typeof import('./calendar-huddle-viewer.js')>} */
const freshViewer = () => import(`./calendar-huddle-viewer.js?case=${++_instance}`);

// ── A DOM just rich enough for the viewer ───────────────────────────────────────────────────────

/** @type {any} */ let viewer;
/** @type {any} */ let body;
/** @type {Record<string, Function[]>} */ let docListeners;
/** @type {Function[]} */ let hashListeners;

/** @type {any} */ let closeBtn;
/** @type {any} */ let statusLine;
/** The page's `pagehide`/`pageshow` listeners, by type. */
/** @type {Record<string, Function[]>} */ let winListeners;
/** A stand-in sessionStorage, for the tap carried across a reload (cal-docs-1). */
/** @type {Map<string, string>} */ let tabStore;
/** Every url the page handed to window.open, and every call's arguments whole. */
/** @type {string[]} */ let windowOpens;
/** @type {any[][]} */ let windowOpenArgs;
/** The "📄 Open Huddle" button — one element the viewer re-wires on each draw; its LAST listener is the one on screen. */
/** @type {any} */ let openFileBtn;

function el() {
    const classes = new Set();
    let html = '';
    return {
        // Setting the markup replaces what was put in front of it, as it does in a browser.
        get innerHTML() { return html; },
        set innerHTML(v) { html = v; this._prepended = []; },
        _listeners: /** @type {Record<string, Function[]>} */ ({}),
        /** @type {any[]} */ _prepended: [], /** @type {any[]} */ _kids: [], /** @type {Record<string, string>} */ _attrs: {},
        /** @type {Record<string, any[]>} */ _q: {},
        style: {}, tabIndex: -1, scrollWidth: 0, clientWidth: 0, textContent: '', id: '', className: '', type: '',
        classList: { add: (/** @type {string} */ c) => classes.add(c), remove: (/** @type {string} */ c) => classes.delete(c), contains: (/** @type {string} */ c) => classes.has(c) },
        addEventListener(/** @type {string} */ t, /** @type {Function} */ fn) { (this._listeners[t] ||= []).push(fn); },
        prepend(/** @type {any} */ n) { n._parent = this; this._prepended.unshift(n); },
        /** @type {any} */ _parent: null,
        remove() { const p = this._parent; if (p) p._prepended = p._prepended.filter((/** @type {any} */ x) => x !== this); this._parent = null; },
        append(/** @type {any[]} */ ...parts) { this._kids.push(...parts); },
        appendChild(/** @type {any} */ c) { this._kids.push(c); return c; },
        setAttribute(/** @type {string} */ k, /** @type {string} */ v) { this._attrs[k] = String(v); },
        querySelectorAll(/** @type {string} */ sel) { return this._q[sel] ?? []; },
        focus() {},
    };
}
/** The words an element carries, its children's included. @param {any} n @returns {string} */
const textOf = (n) => (typeof n === 'string' ? n : `${n.textContent}${(n._kids ?? []).map(textOf).join('')}`);
/** What the viewer body shows: anything put in front of it, then its markup. */
const shown = () => [...body._prepended.map(textOf), body.innerHTML].join(' | ');

function setupDOM() {
    viewer = el(); body = el(); closeBtn = el(); statusLine = el(); openFileBtn = el();
    const nodes = /** @type {Record<string, any>} */ ({ huddleViewer: viewer, huddleViewerBody: body, huddleViewerClose: closeBtn, huddleViewerStatus: statusLine, huddleOpenFileBtn: openFileBtn });
    docListeners = {}; hashListeners = []; winListeners = {}; tabStore = new Map(); windowOpens = []; windowOpenArgs = [];
    /** @type {any} */ (globalThis).document = {
        getElementById: (/** @type {string} */ id) => nodes[id] ?? null,
        createElement: () => el(),
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (docListeners[t] ||= []).push(fn); },
        removeEventListener() {},
        activeElement: null,
        hidden: false,
    };
    /** @type {any} */ (globalThis).window = {
        location: { hash: '', pathname: '/', search: '' },
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => {
            if (t === 'hashchange') hashListeners.push(fn);
            else (winListeners[t] ||= []).push(fn);
        },
        open(/** @type {any[]} */ ...a) { windowOpens.push(a[0]); windowOpenArgs.push(a); return null; },
    };
    /** @type {any} */ (globalThis).sessionStorage = {
        getItem: (/** @type {string} */ k) => (tabStore.has(k) ? tabStore.get(k) : null),
        setItem: (/** @type {string} */ k, /** @type {string} */ v) => { tabStore.set(k, String(v)); },
        removeItem: (/** @type {string} */ k) => { tabStore.delete(k); },
    };
    /** @type {any} */ (globalThis).history = {
        replaceState() { historyCalls.push('replace'); },
        back() { historyCalls.push('back'); },
    };
    /** @type {any} */ (globalThis).requestAnimationFrame = (/** @type {Function} */ fn) => fn();
}

/** The document gate, as calendar-doc-access.js presents it: `has`, plus `onChange` subscribers. */
function makeGate(/** @type {boolean} */ open) {
    let isOpen = open;
    /** @type {Function[]} */ const subs = [];
    return {
        has: () => isOpen,
        onChange: (/** @type {Function} */ fn) => { subs.push(fn); return () => {}; },
        /** Move the gate and tell the viewer, as the coordinator does on a grant or a re-lock. */
        set(/** @type {boolean} */ v) { isOpen = v; subs.forEach(fn => fn(v)); },
    };
}

/** A `#huddle` arrival on an already-open page — the drawer link, or a notification tap. */
function tapHuddle() {
    window.location.hash = '#huddle';
    hashListeners.forEach(fn => fn());
}

const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
const LOCKED = 'Sign in to read the Daily Huddle.';
const READY  = 'The latest Huddle is ready.';
/** A PDF Huddle: no `htmlContent`, so the viewer draws its "Open Huddle" prompt (no sanitiser needed). */
const huddle = (/** @type {string} */ n) => ({ storageUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/${n}.pdf`, storagePath: `huddles/${n}.pdf`, fileType: 'pdf' });

beforeEach(() => {
    listeners = []; historyCalls = []; interceptors = []; pendingFinishes = []; fadeCloses = false;
    opens = []; sanitizeOptions = [];
    resolveOpen = () => ({ url: 'https://firebasestorage.googleapis.com/v0/b/x/o/huddle.pdf' });
    setupDOM();
});

// ── THE TEARDOWN ────────────────────────────────────────────────────────────────────────────────

describe('shutting the gate takes the Huddle down', () => {
    test('the listener is detached, an open viewer says "locked", and a late snapshot delivers nothing', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });   // the viewer's 8s loading bound — never reached here
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(true);
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await flush();
        assert.equal(listeners.length, 1, 'guard: with access, the subscription must attach');

        listeners[0].onData(huddle('monday'), false);
        tapHuddle();
        await flush();
        assert.ok(body.innerHTML.includes(READY), 'guard: the tap must have opened the Huddle');

        gate.set(false);                                   // the session expired
        assert.equal(listeners[0].detached, true, 'the live listener survived the lock — it would keep delivering');
        assert.ok(body.innerHTML.includes(LOCKED), 'the open viewer still shows a Huddle its reader may no longer read');

        // The listener's last answer, already on its way when the lock landed.
        listeners[0].onData(huddle('tuesday'), false);
        await flush();
        assert.ok(!body.innerHTML.includes(READY), 'a snapshot that outlived the lock was shown');
        assert.ok(body.innerHTML.includes(LOCKED));
    });

    test('what the lock dropped stays dropped — after the next grant, a tap waits for the NEW answer', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(true);
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await flush();
        listeners[0].onData(huddle('monday'), false);

        gate.set(false);
        gate.set(true);                                    // signed in again
        await flush();
        assert.equal(listeners.length, 2, 'the grant must start a fresh subscription');

        tapHuddle();                                       // before the fresh one has answered
        await flush();
        assert.ok(!body.innerHTML.includes(READY),
            'the Huddle delivered before the lock was opened — the lock must drop it, not keep it for later');

        listeners[1].onData(huddle('monday'), false);      // the new grant's own answer
        await flush();
        assert.ok(body.innerHTML.includes(READY), 'the held tap must finish once the new subscription answers');
    });

    test('while shut, no listener is attached at all — and the tap made then is finished by the unlock', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(false);
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await flush();
        assert.equal(listeners.length, 0, 'a listener attached while locked — the local cache answers without asking a rule');

        tapHuddle();
        assert.ok(body.innerHTML.includes(LOCKED), 'a locked tap must say what unlocks it, not do nothing');

        gate.set(true);
        await flush();
        assert.equal(listeners.length, 1);
        listeners[0].onData(huddle('monday'), false);
        await flush();
        assert.ok(body.innerHTML.includes(READY), 'the tap made on the sign-in card must open the Huddle once the member is signed in');
    });
});

// ── THE GENERATION GUARD ────────────────────────────────────────────────────────────────────────

describe('a subscription waiting for a session cannot attach late', () => {
    test('a lock that lands during the wait stops it attaching (v24.56)', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(true);
        /** @type {(v?: any) => void} */ let signedIn = () => {};
        initHuddleViewer({ authReady: new Promise(r => { signedIn = r; }), docAccess: gate });
        await flush();
        assert.equal(listeners.length, 0, 'guard: still waiting for the session');

        gate.set(false);                                   // re-locked before the session arrived
        signedIn();
        await flush();
        assert.equal(listeners.length, 0, 'the listener attached to a LOCKED page once the session arrived');
    });

    test('two starts waiting on the same session attach ONE listener, not two', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        /** @type {(v?: any) => void} */ let signedIn = () => {};
        initHuddleViewer({ authReady: new Promise(r => { signedIn = r; }), docAccess: makeGate(true) });
        await flush();
        // The page coming back into view while still 'loading' re-subscribes — the second start.
        (docListeners.visibilitychange || []).forEach(fn => fn());
        await flush();
        signedIn();
        await flush();
        assert.equal(listeners.length, 1, 'both waiting starts attached — every Huddle would be delivered twice');
    });
});

// ── THE WHOLE-APP REVIEW'S FINDINGS (10 Nov 2026) ───────────────────────────────────────────────────
// Each block below is one finding, driven through the real `initHuddleViewer` and its own seams.

/** A DOCX Huddle: `htmlContent`, so the viewer renders it INLINE, through the sanitiser. */
const docx = (/** @type {string} */ n, extra = '') => ({ storageUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/${n}.docx`, storagePath: `huddles/${n}.docx`, fileType: 'docx', htmlContent: `<p>HUDDLE-${n}</p>${extra}` });
/** Real time passing, measured without setTimeout — the viewer's deadline runs on the mocked clock. */
const settle = async (ms = 60) => { const end = performance.now() + ms; while (performance.now() < end) await new Promise(r => setImmediate(r)); };
/**
 * Wait until the sanitiser has been called `n` times in this test, then let the render that follows
 * it finish. The gap before that call is a REAL dynamic import of DOMPurify (mocked, but imported
 * through the loader all the same), and its length is the machine's: a fixed 60 ms was enough for
 * this file alone and not beside the rest of `npm test` — four inline cases failed there on
 * 10 Nov 2026. Waiting for the EVENT rather than a time also gives the "nothing was drawn" checks
 * after it their meaning: they run once the render they are about has had its chance.
 * @param {number} n
 */
const sanitised = async (n) => {
    const end = performance.now() + 10_000;
    while (sanitizeOptions.length < n) {
        if (performance.now() > end) throw new Error(`the sanitiser was called ${sanitizeOptions.length} time(s), not ${n}`);
        await new Promise(r => setImmediate(r));
    }
    await settle(20);
};
const HELD = 'myb_held_huddle_tap';
const closeTap = () => closeBtn._listeners.click.forEach((/** @type {Function} */ fn) => fn());

describe('cal-docs-2 · a render that waited for the sanitiser draws only if it is still wanted', () => {
    test('a newer Huddle that lands while the older one waits is the one drawn — once, and counted once', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        window.location.hash = '#huddle';                       // a cold notification tap
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(docx('YESTERDAY'), true);            // the local cache answers first…
        t.mock.timers.tick(8000);                                // …the server does not, so the saved copy is drawn…
        listeners[0].onData(docx('TODAY'), false);               // …and the server answers while that render waits
        await sanitised(2);
        assert.match(body.innerHTML, /HUDDLE-TODAY/, 'the OLDER Huddle was drawn as the latest');
        assert.ok(viewer.classList.contains('visible'));
        assert.equal(opens.length, 1, 'one tap, one open counted');
    });

    test('a lock that lands while it waits draws nothing; the viewer says what unlocks it, and a sign-in brings the Huddle', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        window.location.hash = '#huddle';
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(true);
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await settle();
        listeners[0].onData(docx('CACHED'), true);               // only the cache answers…
        t.mock.timers.tick(8000);                                // …so the deadline draws it, and the render waits
        gate.set(false);                                         // access lost meanwhile
        await sanitised(1);
        assert.doesNotMatch(shown(), /HUDDLE-CACHED/, 'the Huddle was drawn on a locked Calendar');
        assert.ok(body.innerHTML.includes(LOCKED), 'the member waiting on it is told what unlocks it');
        gate.set(true);
        await settle();
        listeners[1].onData(docx('CACHED'), false);
        await sanitised(2);
        assert.match(body.innerHTML, /HUDDLE-CACHED/, 'the sign-in the message asked for must bring the Huddle back');
    });

    test('a close while it waits is final: the viewer is not re-opened behind the member', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onError(new Error('boom'));                 // could not read
        tapHuddle();
        await settle();
        assert.ok(viewer.classList.contains('visible'), 'guard: the tap is answered with "Couldn\'t load"');
        listeners[0].onData(docx('LATE'), false);                // the Huddle arrives: its render waits
        closeTap();                                              // the member closes the viewer meanwhile
        await sanitised(1);
        assert.equal(viewer.classList.contains('visible'), false, 'the render re-opened a viewer the member had closed');
        assert.doesNotMatch(body.innerHTML, /HUDDLE-LATE/);
    });

    test('re-opened while a close is still fading, the viewer is still on screen when the fade ends', async (t) => {
        // The fade's finisher removes `.visible`. Run after a re-open, it hid the viewer just opened —
        // which then sat "open" and invisible with the page behind it scroll-locked (measured in
        // Chromium on a second Huddle tap while reading one, 10 Nov 2026).
        t.mock.timers.enable({ apis: ['setTimeout'] });
        fadeCloses = true;
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('monday'), false);
        tapHuddle();
        await settle();
        closeTap();                                              // the close starts fading…
        tapHuddle();                                             // …and a tap re-opens the viewer in the fade
        await settle();
        pendingFinishes.forEach(finish => finish());             // the fade ends
        assert.ok(viewer.classList.contains('visible'), 'the earlier close hid the viewer the tap had just opened');
    });
});

describe('cal-docs-10 · a tap made before the first answer is answered, and the wait has an end', () => {
    test('it says "Loading…", and the offline cache\'s empty answer then answers it', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        tapHuddle();                                             // ☰ → Daily Huddle, before any answer
        await settle();
        assert.ok(viewer.classList.contains('visible'), 'the tap drew nothing at all');
        assert.match(body.innerHTML, /Loading…/);
        listeners[0].onData(null, true);                         // only the local cache answers: empty
        await settle();
        assert.match(body.innerHTML, /Couldn’t load the Daily Huddle/, 'the tap was left unanswered');
    });

    test('in the Calendar\'s own order — the gate shut at wiring, opened by the grant — the deadline is real', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(false);                            // access is decided AFTER the viewer is wired
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await settle();
        gate.set(true);                                          // the grant
        await settle();
        tapHuddle();
        await settle();
        assert.match(body.innerHTML, /Loading…/);
        t.mock.timers.tick(8000);
        await settle();
        assert.match(body.innerHTML, /Couldn’t load the Daily Huddle/, 'still "Loading…" when the wait should have ended');
        listeners[0].onData(huddle('late'), false);              // a late answer still replaces the message
        await settle();
        assert.ok(body.innerHTML.includes(READY));
    });

    test('a COLD tap the offline cache answered empty is answered at the deadline, and once closed it stays closed', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        window.location.hash = '#huddle';
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(null, true);                         // a cold tap does not show the cache's "none"…
        await settle();
        assert.equal(viewer.classList.contains('visible'), false, 'guard: the cold-tap rule stands');
        t.mock.timers.tick(8000);                                // …but the deadline answers it
        await settle();
        assert.match(body.innerHTML, /Couldn’t load the Daily Huddle/, 'a cold tap was left unanswered for as long as the device stayed offline');
        closeTap();
        listeners[0].onData(huddle('later'), false);             // the signal comes back
        await settle();
        assert.equal(viewer.classList.contains('visible'), false, 'a tap answered and closed opened by itself later');
    });
});

describe('cal-docs-1 · a tap the lock is holding survives the sign-in\'s reload', () => {
    test('written down as the page unloads, taken back by the next load, and finished by the grant — counted once', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const first = await freshViewer();
        first.initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(false) });
        await settle();
        tapHuddle();                                             // a notification tap on the sign-in card
        assert.ok(body.innerHTML.includes(LOCKED));
        winListeners.pagehide.forEach(fn => fn());               // the sign-in reloads the page
        assert.match(tabStore.get(HELD) ?? '', /^\d+\|1$/, 'the held tap was not written down');

        const kept = new Map(tabStore);                          // the reloaded page: nothing else survives
        setupDOM(); tabStore = kept; listeners = [];
        const second = await freshViewer();
        const gate = makeGate(false);
        second.initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await settle();
        assert.equal(tabStore.has(HELD), false, 'a record is good for one load');
        gate.set(true);                                          // the sign-in's grant
        await settle();
        listeners[0].onData(huddle('monday'), false);
        await settle();
        assert.ok(body.innerHTML.includes(READY), 'the member signed in and the Huddle they tapped for never came');
        assert.equal(opens.length, 1, 'counted once across the reload');
    });

    test('only a tap the LOCK holds is written down: an answered tap, or one on an open Calendar, leaves nothing', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        tapHuddle();                                             // waiting on an open Calendar
        winListeners.pagehide.forEach(fn => fn());
        assert.equal(tabStore.has(HELD), false, 'a tap on an open Calendar was carried');
        listeners[0].onData(huddle('monday'), false);
        await settle();
        tabStore.set(HELD, `${Date.now()}|1`);                    // a stale record from an earlier unload…
        winListeners.pagehide.forEach(fn => fn());
        assert.equal(tabStore.has(HELD), false, '…is removed once the tap it carried has been answered');
    });

    test('a record more than a minute old is not carried', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        tabStore.set(HELD, `${Date.now() - 61_000}|1`);
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('monday'), false);
        await settle();
        assert.equal(viewer.classList.contains('visible'), false, 'a tap from an earlier visit opened the Huddle');
        assert.equal(tabStore.has(HELD), false);
    });

    test('back from the back/forward cache, the page\'s own memory is current, so the record is dropped', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(false) });
        await settle();
        tapHuddle();
        winListeners.pagehide.forEach(fn => fn());
        assert.ok(tabStore.has(HELD), 'guard: the locked tap was written down');
        winListeners.pageshow.forEach(fn => fn({ persisted: true }));
        assert.equal(tabStore.has(HELD), false);
    });
});

describe('cal-docs-8 · a tap leaves no dead history entry, and is not a Back press', () => {
    test('a tap on an open page takes its own entry back off the history — it does not rewrite it', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        historyCalls = [];
        tapHuddle();
        assert.deepEqual(historyCalls, ['back', 'suppress'], 'the tap\'s entry was rewritten into a dead copy of the page');
    });

    test('a COLD deep link\'s entry is the page\'s own: rewritten in place, never stepped back from', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        window.location.hash = '#huddle';
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        assert.deepEqual(historyCalls, ['replace'], 'stepping back from a cold open would leave the app');
    });

    test('the tap\'s own popstate is claimed, so it closes nothing — and nothing else is claimed', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        assert.equal(interceptors.length, 1);
        for (const [hash, claimed] of /** @type {const} */ ([['#huddle', true], ['', false], ['#circular', false], ['#staff-pin', false]])) {
            window.location.hash = hash;
            assert.equal(interceptors[0](), claimed, `popstate at "${hash}"`);
        }
    });
});

describe('the lock while the Huddle is on screen', () => {
    test('the message asks for a sign-in — and the sign-in brings the Huddle back, even after the message was closed', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(true);
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await settle();
        listeners[0].onData(huddle('monday'), false);
        tapHuddle();
        await settle();
        gate.set(false);
        assert.ok(body.innerHTML.includes(LOCKED));
        closeTap();                                              // the only way to reach the sign-in form beneath it
        gate.set(true);
        await settle();
        listeners[1].onData(huddle('monday'), false);
        await settle();
        assert.ok(viewer.classList.contains('visible') && body.innerHTML.includes(READY),
            'the message promised the Huddle for a sign-in, and the sign-in brought nothing back');
    });
});

describe('cal-docs-13 · a picture the in-app view leaves out is named, with the route to the file', () => {
    test('a Huddle with a picture says so, and its button opens the file', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(docx('PICS', '<p><img src="data:image/png;base64,AAAA"></p>'), false);
        tapHuddle();
        await sanitised(1);
        const note = body._prepended.find((/** @type {any} */ n) => /pictures/.test(textOf(n)));
        assert.ok(note, `nothing said a picture had been left out: ${shown()}`);
        const btn = note._kids.find((/** @type {any} */ k) => k.id === 'huddleOpenOriginalBtn');
        assert.ok(btn, 'the note gives no route to the file');
        btn._listeners.click.forEach((/** @type {Function} */ fn) => fn());
        assert.deepEqual(windowOpens, ['https://firebasestorage.googleapis.com/v0/b/x/o/huddle.pdf']);
    });

    test('a Huddle with no picture carries no such note', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(docx('PLAIN'), false);
        tapHuddle();
        await sanitised(1);
        assert.match(body.innerHTML, /HUDDLE-PLAIN/);
        assert.doesNotMatch(shown(), /pictures/);
    });
});

describe('cal-docs-14 · a Huddle this device could not check is labelled a saved copy', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    /** @param {boolean} onLine */
    const setOnline = (onLine) => Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true });
    afterEach(() => { if (real) Object.defineProperty(globalThis, 'navigator', real); });
    const SAVED = /Saved copy — couldn’t check for changes/;

    for (const [kind, make] of /** @type {const} */ ([['an inline Huddle', docx], ['a PDF Huddle', huddle]])) {
        test(`offline, ${kind} answered by the cache alone says so, in the Calendar's own words`, async (t) => {
            t.mock.timers.enable({ apis: ['setTimeout'] });
            setOnline(false);
            const { initHuddleViewer } = await freshViewer();
            initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
            await settle();
            listeners[0].onData(make('SAVED'), true);
            tapHuddle();
            await (make === docx ? sanitised(1) : settle());     // only the inline Huddle is sanitised
            assert.match(shown(), SAVED, 'a Huddle this device could not check was shown as if it were current');
        });
    }

    test('online, a tap on a cached answer waits for the server, and its agreeing is shown unlabelled', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        setOnline(true);
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('monday'), true);
        tapHuddle();
        await settle();
        assert.match(body.innerHTML, /Loading…/, 'the cached answer was shown as the latest while the server could still be asked');
        listeners[0].onData(huddle('monday'), false);           // the server agrees (raised: includeMetadataChanges)
        await settle();
        assert.ok(body.innerHTML.includes(READY));
        assert.doesNotMatch(shown(), SAVED, 'a Huddle the server has just confirmed was labelled a saved copy');
    });

    test('online, a server that never answers: at the deadline the saved copy, labelled — and the label goes when it answers', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        setOnline(true);
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('monday'), true);
        tapHuddle();
        await settle();
        t.mock.timers.tick(8000);
        await settle();
        assert.ok(body.innerHTML.includes(READY), 'the tap was left on "Loading…" with a saved copy in hand');
        assert.match(shown(), SAVED, 'a copy this device could not check was shown as if it were current');
        listeners[0].onData(huddle('monday'), false);           // the signal comes back: the server agrees
        await settle();
        assert.doesNotMatch(shown(), SAVED, 'the label outlived the server confirming that very Huddle');
        assert.ok(body.innerHTML.includes(READY));
    });

    // D-L2 (v26.60 review): the deadline is armed before the wait for a session, so on a cold start
    // with a slow sign-in it could pass before the server was asked — and the first cached answer then
    // opened at once, labelled, as though the server had been asked and had not answered.
    test('a deadline that passes before the server is asked does not let the cached answer open', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        setOnline(true);
        window.location.hash = '#huddle';                      // a cold notification tap
        /** @type {() => void} */ let signedIn = () => {};
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: new Promise(r => { signedIn = () => r(undefined); }), docAccess: makeGate(true) });
        await settle();
        t.mock.timers.tick(8000);                               // the sign-in outlasts the deadline
        await settle();
        assert.equal(listeners.length, 0, 'premise: the server has not been asked');
        signedIn();
        await settle();
        listeners[0].onData(huddle('monday'), true);            // the cache answers first
        await settle();
        assert.doesNotMatch(shown(), SAVED, 'the cached Huddle was opened as a saved copy before the server was asked');
        assert.ok(!body.innerHTML.includes(READY), 'the cached Huddle was opened before the server was asked');
        listeners[0].onData(huddle('tuesday'), false);          // the server's answer is the one shown
        await settle();
        assert.ok(body.innerHTML.includes(READY));
        assert.doesNotMatch(shown(), SAVED);
    });

    test('…and once asked, a server that stays silent still gives way to the labelled copy at its own deadline', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        setOnline(true);
        window.location.hash = '#huddle';
        /** @type {() => void} */ let signedIn = () => {};
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: new Promise(r => { signedIn = () => r(undefined); }), docAccess: makeGate(true) });
        await settle();
        t.mock.timers.tick(8000);
        await settle();
        signedIn();
        await settle();
        listeners[0].onData(huddle('monday'), true);
        await settle();
        t.mock.timers.tick(8000);
        await settle();
        assert.ok(body.innerHTML.includes(READY), 'a tap was left without the copy in hand after the server stayed silent');
        assert.match(shown(), SAVED);
    });

    test('a server answer is never labelled, whatever the device says', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        setOnline(false);
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('monday'), false);
        tapHuddle();
        await settle();
        assert.doesNotMatch(shown(), SAVED);
    });
});

describe('cal-docs-7 · the keyboard can scroll the Huddle', () => {
    test('a table too wide for the viewer is a Tab stop; one that fits is not', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const wide = el(); wide.scrollWidth = 640; wide.clientWidth = 360;
        const fits = el(); fits.scrollWidth = 360; fits.clientWidth = 360;
        body._q['.huddle-table-wrap'] = [wide, fits];
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(docx('TABLES'), false);
        tapHuddle();
        await sanitised(1);
        assert.equal(wide.tabIndex, 0, 'a wide table the keyboard cannot reach cannot be scrolled');
        assert.equal(wide._attrs.role, 'group');
        assert.equal(fits.tabIndex, -1, 'a table that fits needs no stop of its own');
    });

    test('the body that scrolls the plan is a Tab stop in the markup, its ring drawn inside it', () => {
        const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
        const tag = html.match(/<div id="huddleViewerBody"[^>]*>/)?.[0] ?? '';
        assert.match(tag, /tabindex="0"/, 'the ✕ was the only Tab stop, so a long plan could not be scrolled');
        assert.match(tag, /role="group"/);
        // The ring's offset has ONE home, index.css (whole-app fix, 10 Nov 2026): the markup carried the same value
        // inline as well, which was two places to change and a style applied when nothing was focused.
        assert.doesNotMatch(tag, /\sstyle=/, 'the markup styles the box itself; the ring is index.css\'s');
        const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
        assert.match(css, /#huddleViewerBody:focus-visible\s*\{[^}]*outline-offset:\s*-\d/,
            'a ring outside a box that meets the screen edges is drawn off-screen');
    });
});

describe('cal-docs-17 · the sanitiser passes only the two table attributes, as its comment says', () => {
    test('every data-* and aria-* attribute is refused, not only the ones the allowlist leaves out', async (t) => {
        // DOMPurify passes data-* and aria-* BEFORE consulting ALLOWED_ATTR unless told not to — read in
        // purify.es.mjs (`_isValidAttribute`). The browser suite drives the real sanitiser on them.
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(docx('ATTRS'), false);
        tapHuddle();
        await sanitised(1);
        assert.equal(sanitizeOptions.length, 1);
        assert.deepEqual(sanitizeOptions[0].ALLOWED_ATTR, ['colspan', 'rowspan']);
        assert.equal(sanitizeOptions[0].ALLOW_DATA_ATTR, false, 'data-* attributes would pass the sanitiser');
        assert.equal(sanitizeOptions[0].ALLOW_ARIA_ATTR, false, 'aria-* attributes would pass the sanitiser');
    });
});

describe('cal-docs-16 · what replaces "Loading…" is spoken', () => {
    test('each message goes into the dialog\'s status line, and a Huddle on screen clears it', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(false);
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await settle();
        tapHuddle();
        assert.equal(statusLine.textContent, LOCKED);
        closeTap();
        gate.set(true);
        await settle();
        listeners[0].onData(null, false);                        // the server: none uploaded
        await settle();
        assert.equal(statusLine.textContent, 'No Daily Huddle has been uploaded yet.');
        listeners[0].onData(huddle('monday'), false);
        await settle();
        assert.ok(body.innerHTML.includes(READY));
        assert.equal(statusLine.textContent, '', 'a stale message stayed in the status line under the Huddle');
    });
});

// ── A CLOSE BEFORE THE FIRST FRAME (15 Nov 2026) ─────────────────────────────────────────────────────
// `openViewer` fades the viewer in on the next frame, and a close can come first: an Escape before a
// slow engine draws, or a tab that runs no frames while hidden. Run late, that frame faded the viewer
// back in over the page it had just been closed off. The frames are HELD so each test says when they run.
describe('a close before the first frame keeps the viewer closed', () => {
    /** Hold every frame until the test runs them. @returns {Function[]} */
    const holdFrames = () => {
        /** @type {Function[]} */ const frames = [];
        /** @type {any} */ (globalThis).requestAnimationFrame = (/** @type {Function} */ fn) => { frames.push(fn); return 0; };
        return frames;
    };

    test('the late frame does not fade a closed viewer back in', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const frames = holdFrames();
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('monday'), false);
        tapHuddle();
        await settle();
        assert.ok(viewer.classList.contains('visible'), 'guard: the tap opened the viewer');
        assert.equal(viewer.classList.contains('open'), false, 'guard: its first frame has not run');
        closeTap();
        frames.forEach(fn => fn());
        assert.equal(viewer.classList.contains('open'), false, 'the late frame faded the closed viewer back in');
        assert.equal(viewer.classList.contains('visible'), false);
    });

    test('a frame nothing closed still fades the viewer in', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const frames = holdFrames();
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('monday'), false);
        tapHuddle();
        await settle();
        frames.forEach(fn => fn());
        assert.ok(viewer.classList.contains('open'), 'an open viewer never faded in');
    });
});

// ── A NOTIFICATION TAP OPENS THE NEW HUDDLE, NOT YESTERDAY'S (review, 22 Nov 2026) ─────────────────────
// A notification says a new Huddle has arrived, and on a cold start the local cache — which cannot hold it
// yet — answers first. The viewer opened on that answer under "The latest Huddle is ready.", unlabelled,
// and an Open tap before the server answered opened yesterday's file. Online, a waiting tap now waits for
// the server within its deadline; past it the cached Huddle is shown, labelled a saved copy.
describe('a waiting tap opens on the server\'s answer, not on the cache\'s', () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    /** @param {boolean} onLine */
    const setOnline = (onLine) => Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true });
    afterEach(() => { if (real) Object.defineProperty(globalThis, 'navigator', real); });
    const SAVED = /Saved copy — couldn’t check for changes/;
    /** Press the Open button on screen (its newest wiring) and say which url it opened. */
    const pressOpen = () => { openFileBtn._listeners.click.at(-1)(); return windowOpens.at(-1); };

    test('a COLD tap, online: the cached Huddle is not shown, and the server\'s new one is — and that is what Open opens', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        setOnline(true);
        resolveOpen = (a) => ({ url: a.stored });
        window.location.hash = '#huddle';
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('YESTERDAY'), true);          // the cache answers first; the server has not
        await settle();
        assert.equal(viewer.classList.contains('visible'), false,
            'yesterday\'s Huddle was opened as "the latest" before the server had answered');
        listeners[0].onData(huddle('TODAY'), false);             // the server: the Huddle the notification was for
        await settle();
        assert.ok(viewer.classList.contains('visible') && body.innerHTML.includes(READY));
        assert.match(pressOpen(), /TODAY\.pdf$/, 'Open opened a Huddle other than the one the notification announced');
        assert.doesNotMatch(shown(), SAVED);
        assert.equal(opens.length, 1, 'one tap, one open counted');
    });

    test('a COLD tap whose server never answers is shown the saved copy at the deadline, labelled', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        setOnline(true);
        window.location.hash = '#huddle';
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('YESTERDAY'), true);
        t.mock.timers.tick(7999);
        await settle();
        assert.equal(viewer.classList.contains('visible'), false, 'premise: still waiting inside the deadline');
        t.mock.timers.tick(1);
        await settle();
        assert.ok(viewer.classList.contains('visible') && body.innerHTML.includes(READY), 'the tap was never answered');
        assert.match(shown(), SAVED, 'a Huddle nobody could check was shown unlabelled');
    });

    test('once a wait has run out, the next tap is answered at once — still labelled, until the server speaks', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        setOnline(true);
        window.location.hash = '#huddle';
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('YESTERDAY'), true);
        t.mock.timers.tick(8000);
        await settle();
        closeTap();
        tapHuddle();
        await settle();
        assert.ok(body.innerHTML.includes(READY), 'a second eight-second wait for a server already known not to answer');
        assert.match(shown(), SAVED);
    });

    test('offline there is no server to wait for: the labelled copy at once, as before', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        setOnline(false);
        window.location.hash = '#huddle';
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('YESTERDAY'), true);
        await settle();
        assert.ok(viewer.classList.contains('visible'), 'an offline tap was held for a server it cannot reach');
        assert.match(shown(), SAVED);
    });

    test('the documents client asks the SDK for metadata changes, so the server merely agreeing is an answer', async () => {
        const { buildDocumentClient } = await import('./documents-client.js');
        /** @type {any[]} */ let args = [];
        const client = buildDocumentClient(/** @type {any} */ ({
            db: {}, collections: { huddles: 'h', circulars: 'c', newsletters: 'n' },
            fs: { collection: () => ({}), query: () => ({}), orderBy: () => ({}), limit: () => ({}),
                  onSnapshot: (/** @type {any[]} */ ...a) => { args = a; return () => {}; } },
            getStorageSdk: async () => ({}), uploadBytesWithClaimRetry: async () => {}, utils: {},
            resolveUploadCommit: () => 'retry', pruneOldDocs: async () => {},
        }));
        /** @type {any[][]} */ const got = [];
        client.subscribeToLatestHuddle((/** @type {any[]} */ ...a) => got.push(a), () => {});
        assert.deepEqual(args[1], { includeMetadataChanges: true },
            'without it the SDK raises nothing when the server agrees with the cache, and a waiting tap waits out its deadline');
        const row = { storageUrl: 'https://x', storagePath: 'huddles/x.pdf' };
        args[2]({ empty: false, docs: [{ id: 'x', data: () => row }], metadata: { fromCache: false } });
        assert.deepEqual(got, [[row, false]], 'the server\'s answer reaches the viewer marked as the server\'s');
    });
});

// ── DOCUMENT LINKS → REPLACE IS NOT A NEW HUDDLE (review, 22 Nov 2026) ─────────────────────────────────────
// Replace gives the same file a new url. The viewer compared urls, so an open Huddle was drawn again under
// its reader — scrolled to the top, focus back on ✕. It compares the file's path now; and the Open button
// drawn before the Replace opens the NEW url, because the old one no longer opens anything.
describe('a new link to the same file does not redraw the Huddle', () => {
    test('an inline Huddle: not re-sanitised, not redrawn', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(docx('MON'), false);
        tapHuddle();
        await sanitised(1);
        body.innerHTML += '<!-- scrolled -->';                   // what a redraw would wipe
        listeners[0].onData({ ...docx('MON'), storageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/MON.docx?token=new' }, false);
        await settle();
        assert.match(body.innerHTML, /scrolled/, 'a new key for the same file redrew the open Huddle under its reader');
        assert.equal(sanitizeOptions.length, 1, 'the same file was sanitised again');
    });

    test('a PDF Huddle: the Open button drawn before the Replace opens the new link', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        resolveOpen = (a) => ({ url: a.stored });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('MON'), false);
        tapHuddle();
        await settle();
        const wired = openFileBtn._listeners.click.length;
        const replaced = { ...huddle('MON'), storageUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/MON.pdf?token=new' };
        listeners[0].onData(replaced, false);
        await settle();
        assert.equal(openFileBtn._listeners.click.length, wired, 'the Replace redrew the prompt');
        openFileBtn._listeners.click.at(-1)();
        assert.equal(windowOpens.at(-1), replaced.storageUrl, 'the button opened the link the Replace has just retired');
    });

    test('a DIFFERENT file is still a new Huddle, and is drawn', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(docx('MON'), false);
        tapHuddle();
        await sanitised(1);
        listeners[0].onData(docx('TUE'), false);
        await sanitised(2);
        assert.match(body.innerHTML, /HUDDLE-TUE/);
    });
});

describe('the file opens in a tab of its own, with no way back to this page', () => {
    test('the Open button passes noopener', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('MON'), false);
        tapHuddle();
        await settle();
        openFileBtn._listeners.click.at(-1)();
        assert.deepEqual(windowOpenArgs.at(-1)?.slice(1), ['_blank', 'noopener'],
            'the opened file could reach back into this page through window.opener');
    });
});

describe('a long unbroken line in a Word Huddle does not drag the plan sideways', () => {
    test('the body breaks it; the table cells keep break-word, which does not crush a column', () => {
        const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
        const rule = css.match(/#huddleViewerBody\s*\{([^}]*)\}/)?.[1] ?? '';
        assert.match(rule, /overflow-wrap:\s*anywhere/, 'a pasted link or row of dashes widened the viewer and it scrolled sideways');
        const cells = css.match(/#huddleViewerBody td, #huddleViewerBody th\s*\{([^}]*)\}/)?.[1] ?? '';
        assert.match(cells, /overflow-wrap:\s*break-word/, 'the cells inherited `anywhere`, which crushes a column to nothing');
    });
});
