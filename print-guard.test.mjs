import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { iosMajorVersion, printIsBlocked, PRINT_BLOCKED_FROM_IOS, PRINT_UNAVAILABLE_TEXT } from './print-guard.js';

// print-guard.test.mjs — the one rule that decides whether a print control prints or explains
// (iOS 27 audit A1). Organised by cost: BLOCKING a print that would have worked takes a feature away
// from an Android install or an iOS 26 iPhone; failing to block leaves a dead button, which is what
// shipped. Both directions are pinned.

const IPHONE_27 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPHONE_26 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

describe('iosMajorVersion — read from the user agent, null when it names none', () => {
    it('reads an iPhone and an iPod/iPad user agent', () => {
        assert.equal(iosMajorVersion(IPHONE_27), 27);
        assert.equal(iosMajorVersion(IPHONE_26), 26);
        assert.equal(iosMajorVersion('Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15'), 18);
    });
    it('an iPad on its desktop user agent, and anything that is not iOS, is null', () => {
        assert.equal(iosMajorVersion(IPAD_DESKTOP), null);
        assert.equal(iosMajorVersion(ANDROID), null);
        assert.equal(iosMajorVersion(''), null);
    });
});

describe('printIsBlocked — only a home-screen app on iOS 27 or later', () => {
    it('a Safari tab on iOS 27 prints — the bug is in the web-app shell, not the engine', () => {
        assert.equal(printIsBlocked({ standalone: false, iosMajor: 27 }), false);
    });
    it('an installed Android app prints — navigator.standalone is iOS-only, so it is never true there', () => {
        assert.equal(printIsBlocked({ standalone: false, iosMajor: null }), false);
    });
    it('a home-screen app on iOS 26 keeps its print — the bug does not exist there', () => {
        assert.equal(printIsBlocked({ standalone: true, iosMajor: PRINT_BLOCKED_FROM_IOS - 1 }), false);
    });
    it('a home-screen app on iOS 27 is blocked, and an unknown version (the iPad) is treated as current', () => {
        assert.equal(printIsBlocked({ standalone: true, iosMajor: 27 }), true);
        assert.equal(printIsBlocked({ standalone: true, iosMajor: 28 }), true);
        assert.equal(printIsBlocked({ standalone: true, iosMajor: null }), true);
    });
    it('the explanation names the fix, calmly', () => {
        assert.match(PRINT_UNAVAILABLE_TEXT, /Open this page in Safari/);
        assert.doesNotMatch(PRINT_UNAVAILABLE_TEXT, /!/);
    });
});
