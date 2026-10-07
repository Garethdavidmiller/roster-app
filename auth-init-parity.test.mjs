// @ts-check
/**
 * auth-init-parity.test.mjs — Firebase Auth is initialised WITHOUT the popup/redirect resolver
 * (Oct 2026 production review).
 *
 * `getAuth()` installs that resolver, and on mobile, Safari and iOS the SDK initialises it
 * proactively and AWAITS it before restoring the signed-in user: Google's `apis.google.com` script
 * plus a hidden `firebaseapp.com` iframe on the critical path of every iPhone launch, for a feature
 * (popup / redirect sign-in) this app has never used. `firebase-client.js` uses `initializeAuth`
 * with getAuth's own persistence list instead. Nothing at runtime would notice the resolver
 * returning — the app works, it is just slower on exactly the phones staff use — so this is a
 * source check, the kind the no-build estate keeps for things only a profiler would otherwise see.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./firebase-client.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

test('firebase-client.js initialises Auth with initializeAuth, never getAuth', () => {
    assert.doesNotMatch(SRC, /\bgetAuth\s*\(/, 'getAuth() brings back the popup resolver and its iPhone boot cost');
    assert.match(SRC, /\binitializeAuth\s*\(\s*app\s*,/);
});

test('…and never passes a popup/redirect resolver', () => {
    assert.doesNotMatch(SRC, /popupRedirectResolver|browserPopupRedirectResolver/);
});

test('…with getAuth\'s own persistence order, so a restore behaves exactly as before', () => {
    assert.match(SRC, /persistence:\s*\[\s*indexedDBLocalPersistence\s*,\s*browserLocalPersistence\s*,\s*browserSessionPersistence\s*\]/);
});
