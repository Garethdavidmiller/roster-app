// @lane unit
/**
 * nav-bell.test.mjs — the drawer's notification bell: a refresh never paints over a tap, and the
 * toggle says its state once.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/nav-bell.test.mjs   (part of `npm run test:unit`)
 *
 * Each drawer open starts a bell refresh it does not wait for. A tap while that refresh was still
 * reading repainted the bell, when the read answered, with the state from BEFORE the tap: 🔕 "off"
 * on a device just subscribed, until the next open (review, 21 Nov 2026). It drives the real
 * `initNavPanel` with `notif.js` answering on promises the test resolves in the losing order.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);
const R = new URL('./', REPO_ROOT_URL).href;
const defer = () => { let res; const p = new Promise(r => { res = r; }); return { p, res }; };
let peek = async () => 'off-default'; let enable = async () => 'on'; let disable = async () => 'off-default'; let mirror = false;
mock.module(R + 'firebase-client.js', { namedExports: {
    getLatestCircular: async () => null, getLatestNewsletter: async () => null, isSafeStorageUrl: () => true,
    resolveDocumentOpenUrl: () => null, fetchSignedDocumentUrl: async () => null, currentUserAfterBoot: async () => ({ uid: 'u' }) } });
mock.module(R + 'notif.js', { namedExports: { notifSupported: () => true, peekNotifState: () => peek(),
    enableNotifications: () => enable(), disableNotifications: () => disable(), releaseDevicePush: async () => {}, onPagesMirror: () => mirror } });
mock.module(R + 'overlay.js', { namedExports: { lockBodyScroll() {}, unlockBodyScroll() {}, suppressNextPop() {}, pinCloseButton() {},
    registerPopInterceptor() {}, whenHistorySettled: (fn) => fn(), watchScrollFade: () => () => {}, closeOnBackdropTap() {} } });
mock.module(R + 'ls.js', { namedExports: { lsGet: () => null, lsSet() {}, lsDel() {} } });
mock.module(R + 'usage-reporter.js', { namedExports: { recordUsage() {}, recordOpen() {} } });
function el() { const a = new Map(); const on = {}; return { on, dataset: {}, style: {}, textContent: '', hidden: false, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener: (t, f) => { on[t] = f; }, removeEventListener() {},
    setAttribute: (k, v) => a.set(k, String(v)), removeAttribute: (k) => a.delete(k), getAttribute: (k) => a.get(k) ?? null, hasAttribute: (k) => a.has(k),
    focus() {}, remove() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [] }; }
const els = new Map();
globalThis.document = { getElementById: (id) => { if (!els.has(id)) els.set(id, el()); return els.get(id); }, createElement: () => el(), body: el(),
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
const location = { pathname: '/admin.html', search: '', hash: '', href: 'https://x/admin.html', replace() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, location };
globalThis.location = location; globalThis.history = { pushState() {}, back() {}, state: null };
const { initNavPanel } = await import(R + 'nav-panel.js');
const tick = () => new Promise(r => setTimeout(r, 0));
test('a drawer-open refresh that answers after the tap repaints over it', async () => {
    initNavPanel({ currentPage: 'admin', memberName: 'A. Test', onSignOut() {} });
    const burger = document.getElementById('navMenuBtn'), bell = document.getElementById('navNotifBell'), close = document.getElementById('navPanelClose');
    burger.on.click(); await tick(); await tick();
    assert.equal(bell.dataset.notifState, 'off-default');
    close.on.click();
    const P = defer(), E = defer(); peek = () => P.p; enable = () => E.p;
    burger.on.click(); await tick();          // refresh started, its peek still out
    const tap = bell.on.click();              // tap to turn on
    E.res('on'); await tap;                   // enable answers first…
    P.res('off-default'); await tick(); await tick();   // …the stale peek (read before the subscribe) answers after
    assert.equal(bell.dataset.notifState, 'on', 'the tap\'s answer stands: the stale read painted nothing');
    assert.equal(bell.getAttribute('aria-pressed'), 'true');
});

test('the toggle says its state once; checking and blocked are not on/off', async () => {
    const bell = document.getElementById('navNotifBell'), burger = document.getElementById('navMenuBtn'), close = document.getElementById('navPanelClose');
    for (const [state, pressed, label] of [['on', 'true', 'Notifications'], ['off-default', 'false', 'Notifications'],
        ['denied', null, 'Notifications blocked — how to allow them']]) {
        close.on.click(); peek = async () => state;
        burger.on.click(); await tick(); await tick();
        assert.deepEqual([bell.getAttribute('aria-pressed'), bell.getAttribute('aria-label')], [pressed, label], state);
    }
});

test('a BLOCKED bell\'s tap is handed to the drawer it sits in: the visual close, then the info panel with this page\'s route', async () => {
    // The bell left nav-panel.js for nav-bell.js (25 Nov 2026) and reaches the drawer only through the two
    // collaborators it is handed. Driven directly, with both recorded: the order matters (the drawer closes
    // visually, keeping its history entry, before the info panel reuses that entry), and so does the page —
    // on Settings the card that says how is on the page under the drawer, so the route is not the menu's.
    const { wireNavBell } = await import(R + 'nav-bell.js');
    for (const [page, route] of [['admin', '☰ → Settings → Notifications'], ['settings', 'The Notifications card on this page']]) {
        const bell = el(); els.set('navNotifBell', bell); els.set('navNotifIcon', el());
        /** @type {any[]} */ const calls = [];
        const refresh = wireNavBell({ currentPage: page, _closePanelVisualOnly: () => calls.push('visual close'),
            _openComingSoon: (/** @type {any} */ t, /** @type {any} */ body) => calls.push([t, body]) });
        peek = async () => 'denied';
        await refresh();
        await bell.on.click();
        assert.equal(calls[0], 'visual close', page);
        assert.equal(calls[1]?.[0], bell, `${page}: the info panel takes its title and icon from the bell itself`);
        assert.ok(String(calls[1]?.[1]).includes(route), `${page}: ${calls[1]?.[1]}`);
        assert.equal(calls.length, 2, `${page}: one tap, one hand-over`);
    }
});

// ── WHILE A TAP IS IN FLIGHT IT SAYS WHICH WAY, AND A TURN-ON THAT FAILS SAYS SO (owner, 26 Nov 2026) ──────
// "Checking…" named both a first read and a tap, so a screen reader heard the bell "checking" for up to eight
// seconds after the member asked it to turn on. And a permission given whose subscription still failed fell
// back to 🔕 with nothing said; the Settings card says ENABLE_FAILED_LINE, and the bell now says it too, in
// the panel its blocked tap uses, under a heading of its own.
test('a tap names its direction while in flight, from the state before it', async () => {
    const { wireNavBell } = await import(R + 'nav-bell.js');
    for (const [before, label] of [['off-default', 'Notifications — turning on…'], ['off-lapsed', 'Notifications — turning on…'], ['on', 'Notifications — turning off…']]) {
        const bell = el(); els.set('navNotifBell', bell); els.set('navNotifIcon', el());
        const refresh = wireNavBell({ currentPage: 'admin', _closePanelVisualOnly() {}, _openComingSoon() {} });
        peek = async () => before;
        await refresh();
        const E = defer(); enable = () => E.p;
        const tap = bell.on.click();
        assert.equal(bell.getAttribute('aria-label'), label, before);
        assert.equal(bell.hasAttribute('aria-pressed'), false, `${before}: a tap in flight is not on or off`);
        E.res('on'); await tap;
    }
    enable = async () => 'on';
});

test('a turn-on that ends "off-lapsed" opens the info panel with the card\'s failure line; other answers open nothing', async () => {
    const { wireNavBell } = await import(R + 'nav-bell.js');
    const { ENABLE_FAILED_LINE } = await import(R + 'notif-card-core.js');
    for (const [answer, opens] of [['off-lapsed', true], ['on', false], ['off-default', false], ['denied', false]]) {
        const bell = el(); els.set('navNotifBell', bell); els.set('navNotifIcon', el());
        /** @type {any[]} */ const calls = [];
        const refresh = wireNavBell({ currentPage: 'admin', _closePanelVisualOnly: () => calls.push('visual close'),
            _openComingSoon: (/** @type {any} */ t, /** @type {any} */ body) => calls.push([t, body]) });
        peek = async () => 'off-default';
        await refresh();
        enable = async () => answer;
        await bell.on.click();
        if (!opens) { assert.deepEqual(calls, [], `${answer}: nothing to explain`); continue; }
        assert.equal(calls[0], 'visual close');
        assert.equal(calls[1]?.[1], ENABLE_FAILED_LINE, 'the same words as the Settings card');
        assert.equal(calls[1]?.[0]?.dataset?.csTitle, 'Couldn’t turn notifications on', 'its own heading, not the blocked one');
        assert.equal(bell.dataset.notifState, 'off-lapsed', 'and the bell shows what is true');
    }
    // The drawer closed during a slow toggle: the panel would reuse a history entry the drawer has given up.
    const bell = el(); els.set('navNotifBell', bell); els.set('navNotifIcon', el());
    /** @type {any} */ (bell).closest = (/** @type {string} */ sel) => (sel === '[aria-hidden="true"]' ? {} : null);
    /** @type {any[]} */ const calls = [];
    const refresh = wireNavBell({ currentPage: 'admin', _closePanelVisualOnly: () => calls.push('visual close'),
        _openComingSoon: () => calls.push('panel') });
    peek = async () => 'off-default';
    await refresh();
    enable = async () => 'off-lapsed';
    await bell.on.click();
    assert.deepEqual(calls, [], 'no panel over a drawer that has closed');
    enable = async () => 'on';
});

// ── AN OFF BELL ON THE PAGES MIRROR EXPLAINS; AN ON ONE STILL TURNS OFF (owner, 26 Nov 2026) ──────────────────
// A subscription made at the GitHub Pages mirror belongs to an address that will close, and a member who also turns
// them on at the main address gets every broadcast twice. The Settings card and the Calendar strip offered no Turn on
// there; the bell did. Its OFF tap now opens the drawer's info panel with the card's own mirror line, and never asks
// notif.js to subscribe — while an ON bell (a device subscribed there before v26.92) still turns them off.
test('on the Pages mirror an OFF bell opens the info panel with the card\'s mirror line and never calls enable', async () => {
    const { wireNavBell } = await import(R + 'nav-bell.js');
    const { MIRROR_OFF_LINE, notifCardWords } = await import(R + 'notif-card-core.js');
    // The bell's words ARE the card's: the card's lead, its link's text and its tail, read through the card's own function.
    const card = notifCardWords({ supported: true, state: 'off-default', offByChoice: false, ios: false, android: true,
        installed: false, onMirror: true, appLabel: null });
    assert.equal(MIRROR_OFF_LINE, card.status + card.link?.text + card.link?.tail, 'one sentence, two surfaces');
    mirror = true;
    try {
        for (const before of ['off-default', 'off-lapsed']) {
            const bell = el(); els.set('navNotifBell', bell); els.set('navNotifIcon', el());
            /** @type {any[]} */ const calls = [];
            const refresh = wireNavBell({ currentPage: 'admin', _closePanelVisualOnly: () => calls.push('visual close'),
                _openComingSoon: (/** @type {any} */ t, /** @type {any} */ body) => calls.push([t, body]) });
            peek = async () => before;
            await refresh();
            assert.equal(bell.hasAttribute('aria-pressed'), false, `${before}: an off bell here is not a toggle`);
            assert.equal(bell.getAttribute('aria-label'), 'Notifications off — where to turn them on', before);
            let enables = 0; enable = async () => { enables++; return 'on'; };
            await bell.on.click();
            assert.equal(enables, 0, `${before}: the mirror tap never asks to subscribe`);
            assert.equal(calls[0], 'visual close', before);
            assert.equal(calls[1]?.[1], MIRROR_OFF_LINE, `${before}: the Settings card's mirror line`);
            assert.equal(calls[1]?.[0]?.dataset?.csTitle, 'Turn on at the app’s main address', `${before}: its own heading`);
            assert.equal(calls.length, 2, `${before}: one tap, one hand-over`);
            assert.equal(bell.dataset.notifState, before, `${before}: the bell is left as it was`);
        }
    } finally { mirror = false; enable = async () => 'on'; }
});

test('on the Pages mirror an ON bell still turns notifications off', async () => {
    const { wireNavBell } = await import(R + 'nav-bell.js');
    mirror = true;
    try {
        const bell = el(); els.set('navNotifBell', bell); els.set('navNotifIcon', el());
        /** @type {any[]} */ const calls = [];
        const refresh = wireNavBell({ currentPage: 'admin', _closePanelVisualOnly: () => calls.push('visual close'),
            _openComingSoon: () => calls.push('panel') });
        peek = async () => 'on';
        await refresh();
        assert.equal(bell.getAttribute('aria-pressed'), 'true', 'an on bell is a toggle here as anywhere');
        let disables = 0; disable = async () => { disables++; return 'off-default'; };
        await bell.on.click();
        assert.equal(disables, 1, 'the tap turned them off');
        assert.deepEqual(calls, [], 'no panel: turning off needs no explaining');
        assert.equal(bell.dataset.notifState, 'off-default');
        assert.equal(bell.getAttribute('aria-label'), 'Notifications off — where to turn them on', 'and now off, it says where they are turned on');
    } finally { mirror = false; disable = async () => 'off-default'; }
});

// ── A DRAWER CLOSED WHILE THE PANEL'S WORDS WERE BEING FETCHED OPENS NO PANEL (28 Nov 2026) ─────────────────
// Both explaining taps import notif-card-core.js first — on a first visit a network fetch. The off-lapsed path asked
// whether the drawer was open only BEFORE that import, and the mirror path never asked: a drawer closed while it
// landed had the info panel opened over the page, on a history entry the drawer had already given up. Here the drawer
// closes inside the import's wait, after every earlier question has been answered yes.
test('a drawer closed during the import of the panel\'s words: no panel, on the mirror tap and the failed turn-on alike', async () => {
    const { wireNavBell } = await import(R + 'nav-bell.js');
    for (const path of ['mirror', 'off-lapsed']) {
        mirror = path === 'mirror';
        try {
            const bell = el(); els.set('navNotifBell', bell); els.set('navNotifIcon', el());
            // The drawer is open when the tap begins. On the mirror nothing asks before the import, so it is closed
            // straight after the tap's first, synchronous part — inside the import's wait. On a failed turn-on the drawer
            // is asked about once the toggle answers (open: that ask is the old guard), and closed by the next ask.
            let hidden = false, asks = 0;
            /** @type {any} */ (bell).closest = (/** @type {string} */ sel) => {
                if (sel !== '[aria-hidden="true"]') return null;
                asks += 1;
                return hidden || (path === 'off-lapsed' && asks > 1) ? {} : null;
            };
            /** @type {any[]} */ const calls = [];
            const refresh = wireNavBell({ currentPage: 'admin', _closePanelVisualOnly: () => calls.push('visual close'),
                _openComingSoon: () => calls.push('panel') });
            peek = async () => 'off-default';
            await refresh();
            enable = async () => 'off-lapsed';
            const tap = bell.on.click();
            if (path === 'mirror') hidden = true;      // the drawer closes while the import is in flight
            await tap;
            if (path === 'off-lapsed') assert.equal(asks, 2, 'premise: asked before the import and again after it');
            assert.deepEqual(calls, [], `${path}: a panel opened over a drawer that had closed`);
            assert.equal(bell.disabled, false, `${path}: the bell is left usable`);
        } finally { mirror = false; enable = async () => 'on'; }
    }
});
