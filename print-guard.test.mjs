import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { printIsBlocked, PRINT_UNAVAILABLE_TEXT } from './print-guard.js';

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

describe('printIsBlocked — any page launched from the Home Screen on an iPhone or iPad', () => {
    it('a home-screen app is blocked whatever its user agent claims — every recent iPhone says 18_7', () => {
        assert.equal(IPHONE_FROZEN.includes('18_7'), true, 'the fixture is the frozen string a real iOS 27 device sends');
        assert.equal(printIsBlocked({ standalone: true }), true);
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
