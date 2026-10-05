// @ts-check
/**
 * firestore-transport.test.mjs — which devices get Firestore's long-polling transport (v24.55).
 * Run with: node --test firestore-transport.test.mjs
 *
 * The rule is narrow on purpose — Apple mobile devices only — so both directions are pinned: every
 * iPhone and iPad form gets it, and Android, desktop Chrome and desktop Safari do not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAppleMobile, firestoreTransportSettings } from './firestore-transport.js';

const UA = {
    iphone:   'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
    ipad:     'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    ipadOS:   'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    macSafari:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    android:  'Mozilla/5.0 (Linux; Android 16; SM-S941B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
    desktop:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
};

test('iPhones and iPads — including iPadOS posing as a Mac — get long-polling', () => {
    for (const nav of [
        { userAgent: UA.iphone, platform: 'iPhone', maxTouchPoints: 5 },
        { userAgent: UA.ipad, platform: 'iPad', maxTouchPoints: 5 },
        { userAgent: UA.ipadOS, platform: 'MacIntel', maxTouchPoints: 5 },
    ]) {
        assert.equal(isAppleMobile(nav), true, nav.userAgent);
        assert.deepEqual(firestoreTransportSettings(nav), { experimentalForceLongPolling: true });
    }
});

test('Android, desktop Chrome and desktop Safari keep the SDK default', () => {
    for (const nav of [
        { userAgent: UA.android, platform: 'Linux armv8l', maxTouchPoints: 5 },
        { userAgent: UA.desktop, platform: 'Win32', maxTouchPoints: 0 },
        { userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 },
    ]) {
        assert.equal(isAppleMobile(nav), false, nav.userAgent);
        assert.deepEqual(firestoreTransportSettings(nav), {});
    }
    assert.deepEqual(firestoreTransportSettings(undefined), {}, 'no navigator (a test, a worker) is not an iPhone');
});

test('firebase-client.js actually passes the settings to initializeFirestore — the wiring, not the rule', () => {
    // The rule above can be perfect and the iPhone still get the default, if the one line that uses
    // it stops doing so. Read the source: there is no way to load the real SDK in Node.
    const src = readFileSync(new URL('./firebase-client.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(src, /import\s*\{\s*firestoreTransportSettings\s*\}\s*from\s*'\.\/firestore-transport\.js'/);
    assert.match(src, /initializeFirestore\(app,\s*\{[^}]*\.\.\.firestoreTransportSettings\(\)/);
});
