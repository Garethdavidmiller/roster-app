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
let peek = async () => 'off-default'; let enable = async () => 'on';
mock.module(R + 'firebase-client.js', { namedExports: {
    getLatestCircular: async () => null, getLatestNewsletter: async () => null, isSafeStorageUrl: () => true,
    resolveDocumentOpenUrl: () => null, fetchSignedDocumentUrl: async () => null, currentUserAfterBoot: async () => ({ uid: 'u' }) } });
mock.module(R + 'notif.js', { namedExports: { notifSupported: () => true, peekNotifState: () => peek(),
    enableNotifications: () => enable(), disableNotifications: async () => 'off-default', releaseDevicePush: async () => {} } });
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
