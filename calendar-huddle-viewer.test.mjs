/**
 * calendar-huddle-viewer.test.mjs — the Daily Huddle viewer obeys the document gate (CALENDAR_DATA.md 15).
 * Run: node --experimental-test-module-mocks --test calendar-huddle-viewer.test.mjs
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
        resolveDocumentOpenUrl: () => ({ url: 'https://firebasestorage.googleapis.com/v0/b/x/o/huddle.pdf' }),
        fetchSignedDocumentUrl: async () => null,
    },
});
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
/** Every url the page handed to window.open. */
/** @type {string[]} */ let windowOpens;

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
        prepend(/** @type {any} */ n) { this._prepended.unshift(n); },
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
    viewer = el(); body = el(); closeBtn = el(); statusLine = el();
    const nodes = /** @type {Record<string, any>} */ ({ huddleViewer: viewer, huddleViewerBody: body, huddleViewerClose: closeBtn, huddleViewerStatus: statusLine });
    docListeners = {}; hashListeners = []; winListeners = {}; tabStore = new Map(); windowOpens = [];
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
        open(/** @type {string} */ url) { windowOpens.push(url); return null; },
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
const LOCKED = 'Enter the staff PIN, or sign in, to read the Daily Huddle.';
const READY  = 'The latest Huddle is ready.';
/** A PDF Huddle: no `htmlContent`, so the viewer draws its "Open Huddle" prompt (no sanitiser needed). */
const huddle = (/** @type {string} */ n) => ({ storageUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/${n}.pdf`, storagePath: `huddles/${n}.pdf`, fileType: 'pdf' });

beforeEach(() => {
    listeners = []; historyCalls = []; interceptors = []; pendingFinishes = []; fadeCloses = false;
    opens = []; sanitizeOptions = [];
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

        gate.set(false);                                   // the session expired, or the PIN rotated
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
        gate.set(true);                                    // the PIN entered again
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
        assert.ok(body.innerHTML.includes(READY), 'the tap made on the PIN card must open the Huddle once the PIN is in');
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
        listeners[0].onData(docx('TODAY'), false);               // …and the server while that render waits
        await sanitised(2);
        assert.match(body.innerHTML, /HUDDLE-TODAY/, 'the OLDER Huddle was drawn as the latest');
        assert.ok(viewer.classList.contains('visible'));
        assert.equal(opens.length, 1, 'one tap, one open counted');
    });

    test('a lock that lands while it waits draws nothing; the viewer says what unlocks it, and the PIN brings the Huddle', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        window.location.hash = '#huddle';
        const { initHuddleViewer } = await freshViewer();
        const gate = makeGate(true);
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: gate });
        await settle();
        listeners[0].onData(docx('CACHED'), true);               // the render starts and waits
        gate.set(false);                                         // access lost meanwhile
        await sanitised(1);
        assert.doesNotMatch(shown(), /HUDDLE-CACHED/, 'the Huddle was drawn on a locked Calendar');
        assert.ok(body.innerHTML.includes(LOCKED), 'the member waiting on it is told what unlocks it');
        gate.set(true);
        await settle();
        listeners[1].onData(docx('CACHED'), false);
        await sanitised(2);
        assert.match(body.innerHTML, /HUDDLE-CACHED/, 'the PIN the message asked for must bring the Huddle back');
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
        assert.match(body.innerHTML, /Couldn't load the Daily Huddle/, 'the tap was left unanswered');
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
        assert.match(body.innerHTML, /Couldn't load the Daily Huddle/, 'still "Loading…" when the wait should have ended');
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
        assert.match(body.innerHTML, /Couldn't load the Daily Huddle/, 'a cold tap was left unanswered for as long as the device stayed offline');
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
    test('the message asks for the PIN — and the PIN brings the Huddle back, even after the message was closed', async (t) => {
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
        closeTap();                                              // the only way to reach the PIN form beneath it
        gate.set(true);
        await settle();
        listeners[1].onData(huddle('monday'), false);
        await settle();
        assert.ok(viewer.classList.contains('visible') && body.innerHTML.includes(READY),
            'the message promised the Huddle for the PIN, and the PIN brought nothing back');
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
    const SAVED = /Saved copy — couldn't check for changes/;

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

    test('online, the same cached answer is not labelled — the server agreeing raises no second answer to clear it', async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        setOnline(true);
        const { initHuddleViewer } = await freshViewer();
        initHuddleViewer({ authReady: Promise.resolve(), docAccess: makeGate(true) });
        await settle();
        listeners[0].onData(huddle('monday'), true);
        tapHuddle();
        await settle();
        assert.doesNotMatch(shown(), SAVED);
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
        assert.match(tag, /outline-offset:\s*-\d/, 'a ring outside a box that meets the screen edges is drawn off-screen');
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
