import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { printIsBlocked, printOrExplain, PRINT_UNAVAILABLE_TEXT, explainNoPrint } from './print-guard.js';

// print-guard.test.mjs — the one rule that decides whether a print control prints or explains
// (iOS 27 audit A1). Organised by cost: BLOCKING a print that would have worked takes a feature away
// from an Android install; failing to block leaves a dead button, which is what shipped — twice.
//
// THE SECOND TIME WAS THIS FILE'S FAULT (whole-app review, Oct 2026). The rule read the iOS version
// from the user agent, and every test here fed it an invented `iPhone OS 27_0`. No device sends that:
// WebKit freezes the version, so an iPhone on iOS 27 reports `18_7`, the guard read 18 and stood
// down, and every print button in the installed app was dead again while this suite stayed green.
// The user agents below are the frozen ones real devices send.

const IPHONE_FROZEN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

/**
 * Run `fn` on a page whose `navigator` is this one — the DEFAULT path, which reads the live page
 * rather than an argument. Node defines a getter-only `navigator`, so it is redefined and restored.
 * @param {{ userAgent: string, standalone?: boolean }} nav @param {() => void} fn
 */
function onDevice(nav, fn) {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    try { fn(); } finally {
        if (saved) Object.defineProperty(globalThis, 'navigator', saved);
        else delete /** @type {any} */ (globalThis).navigator;
    }
}

describe('printIsBlocked — any page launched from the Home Screen on an iPhone or iPad', () => {
    it('a home-screen app is blocked whatever its user agent claims — every recent iPhone says 18_7', () => {
        // THE USER AGENT IS NOW HANDED TO THE CODE (test audit, 7 Nov 2026). This test checked a
        // property of its own constant and passed `{ standalone: true }` straight in, so the guard
        // never saw a user agent at all — the version read the header describes could come back and
        // this would stay green. Here the page's own navigator carries each string, the guard reads
        // it the way it does on a phone, and the frozen 18_7 is blocked like every other.
        for (const ua of [IPHONE_FROZEN,
            'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
            'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148']) {
            onDevice({ userAgent: ua, standalone: true }, () => {
                assert.equal(printIsBlocked(), true, `a home-screen launch was allowed to print: ${ua}`);
                let printed = 0, explained = 0;
                assert.equal(printOrExplain({ print: () => { printed++; }, explain: () => { explained++; } }), false);
                assert.deepEqual([printed, explained], [0, 1], 'the control printed nothing and explained nothing');
            });
            onDevice({ userAgent: ua, standalone: false }, () => {
                assert.equal(printIsBlocked(), false, `the same device in a Safari tab must print: ${ua}`);
            });
        }
    });
    it('a Safari tab prints — the bug is in the web-app shell, not the engine', () => {
        assert.equal(printIsBlocked({ standalone: false }), false);
    });
    it('an installed Android app prints — navigator.standalone is iOS-only, so it is never true there', () => {
        assert.equal(printIsBlocked({ standalone: /** @type {any} */ (undefined) }), false);
    });
    it('the explanation names the fix, calmly', () => {
        assert.match(PRINT_UNAVAILABLE_TEXT, /Open this page in Safari/);
        assert.doesNotMatch(PRINT_UNAVAILABLE_TEXT, /!/);
    });
});

describe('explainNoPrint — Safari opens INSIDE the tap (v25.06, whole-app review)', () => {
    // The dialog settles after its close fade and its Back echo, so an open made after the await runs
    // outside the user gesture and is pop-up-blocked: "Open in Safari" did nothing on the one device
    // this path exists for. The real confirmDialog calls `onConfirm` synchronously from the button's
    // click handler; this fake does the same, then settles later, as the real one does.
    test('the open happens during the confirm tap, and never again after the dialog settles', async () => {
        const opened = [];
        const prev = globalThis.window;
        globalThis.window = /** @type {any} */ ({ location: { href: 'https://myb-roster.web.app/' }, open: (/** @type {string} */ u) => { opened.push(u); } });
        try {
            let duringTap = -1;
            const fakeConfirm = async (/** @type {any} */ opts) => {
                opts.onConfirm?.();           // the tap
                duringTap = opened.length;
                await new Promise(r => setTimeout(r, 10));   // the close fade + Back echo
                return true;
            };
            await explainNoPrint(fakeConfirm);
            assert.equal(duringTap, 1, 'Safari must open inside the tap, while the gesture is live');
            assert.equal(opened.length, 1, 'and only once — not again after the await');
        } finally { globalThis.window = prev; }
    });
    test('Close opens nothing', async () => {
        const opened = [];
        const prev = globalThis.window;
        globalThis.window = /** @type {any} */ ({ location: { href: 'x' }, open: (/** @type {string} */ u) => { opened.push(u); } });
        try {
            await explainNoPrint(async () => false);
            assert.equal(opened.length, 0);
        } finally { globalThis.window = prev; }
    });
});

