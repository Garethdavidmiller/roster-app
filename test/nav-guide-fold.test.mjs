// @lane unit
/**
 * nav-guide-fold.test.mjs — the drawer's guide list follows the Reference fold, query or none.
 * Run: node --experimental-test-module-mocks scripts/run-tests.mjs test/nav-guide-fold.test.mjs   (part of `npm run test:unit`)
 *
 * Reference folded while a search was showing, then the drawer closed and reopened: the reopen clears
 * the query, and `render()` un-hid the full guide list beneath a heading still marked folded — every
 * guide visible and reachable by Tab under a collapsed arrow (review, 21 Nov 2026). It drives the REAL
 * `initNavPanel` and `initGuideSearch` on a small fake DOM whose `hidden` and `class` setters fire the
 * MutationObservers the two modules rely on.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);
const R = new URL('./', REPO_ROOT_URL).href;

mock.module(R + 'firebase-client.js', { namedExports: {
    getLatestCircular: async () => null, getLatestNewsletter: async () => null, isSafeStorageUrl: () => true,
    resolveDocumentOpenUrl: () => null, fetchSignedDocumentUrl: async () => null, currentUserAfterBoot: async () => ({ uid: 'u' }) } });
mock.module(R + 'notif.js', { namedExports: { notifSupported: () => false, peekNotifState: async () => 'off-default',
    enableNotifications: async () => 'on', disableNotifications: async () => 'off-default', releaseDevicePush: async () => {} } });
mock.module(R + 'overlay.js', { namedExports: { lockBodyScroll() {}, unlockBodyScroll() {}, suppressNextPop() {}, pinCloseButton() {},
    registerPopInterceptor() {}, whenHistorySettled: (fn) => fn(), watchScrollFade: () => () => {}, closeOnBackdropTap() {} } });
mock.module(R + 'ls.js', { namedExports: { lsGet: () => null, lsSet() {}, lsDel() {} } });
mock.module(R + 'usage-reporter.js', { namedExports: { recordUsage() {}, recordOpen() {} } });

/** Observers by target, fired by hand when an attribute they watch changes. */
const observers = [];
globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; } observe(t, o) { observers.push({ t, o, cb: this.cb }); } };
const fire = (el, attr) => observers.filter(x => x.t === el && x.o.attributeFilter.includes(attr)).forEach(x => x.cb());

function el(id) {
    const attrs = new Map(); const cls = new Set(); const on = {};
    const e = {
        id, on, dataset: {}, style: {}, textContent: '', value: '', _hidden: false,
        get hidden() { return this._hidden; }, set hidden(v) { const c = this._hidden !== !!v; this._hidden = !!v; if (c) fire(this, 'hidden'); },
        classList: { add: (c) => { const n = !cls.has(c); cls.add(c); if (n) fire(e, 'class'); }, remove: (c) => { const n = cls.has(c); cls.delete(c); if (n) fire(e, 'class'); },
            toggle: (c, on2) => { on2 ? e.classList.add(c) : e.classList.remove(c); }, contains: (c) => cls.has(c) },
        addEventListener: (t, fn) => { on[t] = fn; }, removeEventListener() {},
        setAttribute: (k, v) => attrs.set(k, String(v)), removeAttribute: (k) => attrs.delete(k), getAttribute: (k) => attrs.has(k) ? attrs.get(k) : null,
        hasAttribute: (k) => attrs.has(k), focus() {}, blur() {}, remove() {}, appendChild() {}, append() {}, querySelector: () => null, querySelectorAll: () => [],
        getBoundingClientRect: () => ({ top: 0 }),
    };
    return e;
}
const els = new Map();
globalThis.document = { getElementById: (id) => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); },
    createElement: () => el('x'), body: el('body'), activeElement: null,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
const location = { pathname: '/admin.html', search: '', hash: '', href: 'https://x/admin.html', replace() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }), setTimeout, clearTimeout, location, open: () => null };
globalThis.location = location;
globalThis.history = { pushState() {}, back() {}, state: null };

const { initNavPanel } = await import(R + 'nav-panel.js');
const { initGuideSearch } = await import(R + 'nav-guide-search.js');

test('fold Reference with a query, close and reopen the drawer', () => {
    initNavPanel({ currentPage: 'admin', memberName: 'A. Test', onSignOut() {} });
    const toggle = document.getElementById('navGuidesToggle');
    toggle.setAttribute('aria-expanded', 'true');      // as _inject renders it
    const input = document.getElementById('navGuideSearchInput');
    const list = document.getElementById('navGuidesList');
    const panel = document.getElementById('navPanel');
    initGuideSearch({ guides: [{ icon: 'x', label: 'Railcard Guide', url: './railcard-guide.html', openId: 'guide-railcard' }] });
    document.getElementById('navMenuBtn').on.click();   // open (class change → observer records wasOpen)
    input.value = 'railcard'; input.on.input();
    assert.equal(list.hidden, true, 'results replace the static list');
    toggle.on.click();                                   // fold Reference
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(list.hidden, true, 'folded: list hidden');
    document.getElementById('navPanelClose').on.click(); // close
    document.getElementById('navMenuBtn').on.click();   // reopen → the observer clears the query
    assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'premise: still folded after the reopen');
    assert.equal(list.hidden, true, 'the static list stays hidden under a folded Reference heading');
    // CONTROL: unfolding shows it again — the fix follows the fold, it does not pin the list shut.
    toggle.on.click();
    assert.equal(list.hidden, false, 'unfolded: the list is back');
});
