/**
 * install-route.test.mjs — installRoute() against the REAL install-prompt.js, under a fake window.
 * Run: node --test --experimental-test-module-mocks install-route.test.mjs   (part of `npm run test:unit`)
 *
 * WHY THIS EXISTS (v24.96, the 72-hour review). calendar-notices.test.mjs replaces the whole of
 * install-prompt.js with a mock, so its install-notice matrix proves what the notice DOES with a route
 * and nothing about how the route is DECIDED — and the two decisive guards had no test anywhere:
 * `isStandalone()` (no notice inside the installed app) and `!mirror` (never the browser's one-tap
 * offer on the Pages mirror, which serves the manifest and so DOES get a `beforeinstallprompt` on
 * Chrome Android — a one-tap install of the mirror is the one thing the notice exists to prevent).
 * Deleting either guard left every suite green. This file imports the real module under a window it
 * controls, fires the browser's offer at it, and pins each guard where it lives.
 */
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/** Where every test starts. Reset before each one rather than put back on each test's last line
 *  (test audit, 7 Nov 2026): a failed assertion skipped the put-back and ran the next test on the
 *  wrong browser, so one real failure arrived looking like several. */
const DEFAULTS = Object.freeze({ coarse: true, standalone: false, hostname: 'myb-roster.web.app', ios: false });
/** The knobs the module reads, changed per test through getters so the module sees them live. */
const browser = { ...DEFAULTS };
beforeEach(() => { Object.assign(browser, DEFAULTS); });
/** @type {Record<string, Function[]>} */
const listeners = {};
function installFakeBrowser() {
    const win = {
        matchMedia: (/** @type {string} */ q) => ({ matches: q.includes('standalone') ? browser.standalone : q.includes('coarse') ? browser.coarse : false }),
        navigator: { standalone: false },
        location: { get hostname() { return browser.hostname; } },
        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { (listeners[t] ??= []).push(fn); },
        removeEventListener() {},
    };
    globalThis.window = /** @type {any} */ (win);
    // navigator is a read-only Node global — redefined, not assigned (as notif.test.mjs does).
    Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { platform: 'Linux', maxTouchPoints: 1 } });
    const el = () => ({ hidden: false, style: {}, textContent: '', addEventListener() {} });
    globalThis.document = /** @type {any} */ ({ getElementById: () => el() });
    globalThis.getComputedStyle = /** @type {any} */ (() => ({ getPropertyValue: () => '1' }));   // the strip "can be seen"
    globalThis.localStorage = /** @type {any} */ ({ getItem: () => null, setItem() {}, removeItem() {} });
}
installFakeBrowser();
// notif.js (isIOS) imports firebase-client.js, which loads the Firebase SDK from gstatic — not importable
// in Node. The only thing install-prompt.js takes from it is isIOS, answered from the same knob.
mock.module('./notif.js', { namedExports: { isIOS: () => browser.ios } });
const { installRoute, initInstallPrompt } = await import('./install-prompt.js');

/**
 * Fire the browser's install offer at the module, as Chrome does, wiring the strip first if no test
 * has. The held offer is module state, so a test that needs one makes its own: the last test below
 * used to borrow the offer the one before it fired, and run alone it read 'menu' (test audit,
 * 7 Nov 2026).
 */
function offerInstall() {
    if (!listeners.beforeinstallprompt?.length) initInstallPrompt({ accessReady: Promise.resolve(), getAccessType: () => 'named' });
    const fire = listeners.beforeinstallprompt?.at(-1);
    assert.ok(fire, 'guard: the strip must be listening for the offer');
    fire({ preventDefault() {}, prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
}

describe('installRoute(): where the install notice may ask, and how', () => {
    test('inside the installed app there is no route at all', () => {
        browser.standalone = true;
        assert.equal(installRoute(), null);
    });

    test('a fine pointer (a desktop) gets no route: Chrome\'s own offer is left alone there', () => {
        browser.coarse = false;
        assert.equal(installRoute(), null);
    });

    test('a phone browser with no offer: the menu on Android, Share on iOS, and not the mirror', () => {
        assert.deepEqual(installRoute(), { how: 'menu', mirror: false });
        browser.ios = true;
        assert.deepEqual(installRoute(), { how: 'ios', mirror: false });
    });

    test('once the browser has offered, the main address routes to that offer — and the mirror never does', () => {
        initInstallPrompt({ accessReady: Promise.resolve(), getAccessType: () => 'named' });
        assert.equal(listeners.beforeinstallprompt?.length, 1, 'the strip listens for the browser\'s offer');
        let prevented = 0;
        listeners.beforeinstallprompt[0]({ preventDefault() { prevented += 1; }, prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
        assert.equal(prevented, 1, 'the offer is held, not let through as Chrome\'s mini-infobar');
        assert.deepEqual(installRoute(), { how: 'prompt', mirror: false }, 'myb-roster.web.app: one tap through the held offer');
        browser.hostname = 'garethdavidmiller.github.io';
        assert.deepEqual(installRoute(), { how: 'menu', mirror: true }, 'the Pages mirror serves the manifest too, and its offer must NOT be taken');
        browser.ios = true;
        assert.deepEqual(installRoute(), { how: 'ios', mirror: true });
    });

    test('the installed-app guard still wins over a held offer', () => {
        offerInstall();
        browser.standalone = true;
        assert.equal(installRoute(), null);
        browser.standalone = false;
        assert.equal(installRoute()?.how, 'prompt', 'and the offer is still held afterwards');
    });
});

describe('the strip, once answered, stays answered for the visit (cal-docs-9, whole-app review 10 Nov 2026)', () => {
    // Chromium fires `beforeinstallprompt` AGAIN when the member cancels the dialog that Install
    // opened — "typically immediately after the userChoice property has resolved" (web.dev,
    // "Customize install"). The handler showed the strip whenever the event arrived, so a member who
    // had just said no was asked again at once, by a fresh button. The header promises the strip
    // "disappears whichever way the member answers".

    /** A page with ONE of each element, kept for the whole test, and a storage that works (or throws). */
    function stripPage({ storageThrows = false } = {}) {
        /** @type {Record<string, any>} */ const els = {};
        for (const id of ['installPrompt', 'installPromptAction', 'installPromptDismiss', 'installPromptSteps', 'notifPrompt']) {
            /** @type {Record<string, Function>} */ const on = {};
            els[id] = { id, hidden: false, style: { display: '' }, on,
                        addEventListener: (/** @type {string} */ t, /** @type {Function} */ fn) => { on[t] = fn; } };
        }
        globalThis.document = /** @type {any} */ ({ getElementById: (/** @type {string} */ id) => els[id] ?? null });
        /** @type {Map<string, string>} */ const store = new Map();
        globalThis.localStorage = /** @type {any} */ (storageThrows
            ? { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() {} }
            : { getItem: (/** @type {string} */ k) => store.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => { store.set(k, v); }, removeItem() {} });
        // A fresh wiring hears the offer alone — earlier tests' handlers are not this page's.
        delete listeners.beforeinstallprompt;
        delete listeners.appinstalled;
        initInstallPrompt({ accessReady: Promise.resolve(), getAccessType: () => 'named' });
        let prompts = 0;
        const offer = async () => {
            for (const fn of listeners.beforeinstallprompt ?? []) fn({ preventDefault() {}, prompt: async () => { prompts += 1; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
            for (let i = 0; i < 4; i++) await Promise.resolve();   // the accessReady hop
        };
        return { els, store, offer, prompts: () => prompts };
    }
    const settleAll = () => new Promise(r => setTimeout(r, 0));

    test('Install, then "Cancel" in the browser\'s dialog: the re-fired offer does not bring the strip back', async () => {
        const p = stripPage();
        await p.offer();
        assert.equal(p.els.installPrompt.style.display, 'flex', 'the strip was offered');
        p.els.installPromptAction.on.click();
        assert.equal(p.prompts(), 1, 'Install opened the browser\'s own dialog');
        assert.equal(p.els.installPrompt.style.display, 'none');
        await p.offer();                                   // Chromium fires again after the cancel
        await settleAll();
        assert.equal(p.els.installPrompt.style.display, 'none', 'the member has answered; the strip is not offered again');
    });

    test('× then a re-fired offer: still answered', async () => {
        const p = stripPage();
        await p.offer();
        p.els.installPromptDismiss.on.click();
        await p.offer();
        await settleAll();
        assert.equal(p.els.installPrompt.style.display, 'none');
    });

    test('where storage throws (iOS private mode), the answer still holds for the visit', async () => {
        const p = stripPage({ storageThrows: true });
        await p.offer();
        assert.equal(p.els.installPrompt.style.display, 'flex');
        p.els.installPromptAction.on.click();
        await p.offer();
        await settleAll();
        assert.equal(p.els.installPrompt.style.display, 'none', 'remembered in memory, not only on disk');
    });
});
