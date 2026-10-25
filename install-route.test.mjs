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
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

/** The knobs the module reads, changed per test through getters so the module sees them live. */
const browser = { coarse: true, standalone: false, hostname: 'myb-roster.web.app', ios: false };
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

describe('installRoute(): where the install notice may ask, and how', () => {
    test('inside the installed app there is no route at all', () => {
        browser.standalone = true;
        assert.equal(installRoute(), null);
        browser.standalone = false;
    });

    test('a fine pointer (a desktop) gets no route: Chrome\'s own offer is left alone there', () => {
        browser.coarse = false;
        assert.equal(installRoute(), null);
        browser.coarse = true;
    });

    test('a phone browser with no offer: the menu on Android, Share on iOS, and not the mirror', () => {
        assert.deepEqual(installRoute(), { how: 'menu', mirror: false });
        browser.ios = true;
        assert.deepEqual(installRoute(), { how: 'ios', mirror: false });
        browser.ios = false;
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
        browser.ios = false;
        browser.hostname = 'myb-roster.web.app';
    });

    test('the installed-app guard still wins over a held offer', () => {
        browser.standalone = true;
        assert.equal(installRoute(), null);
        browser.standalone = false;
        assert.equal(installRoute()?.how, 'prompt', 'and the offer is still held afterwards');
    });
});
