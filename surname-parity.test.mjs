/**
 * Parity tests for the surname-derivation rule that is DELIBERATELY duplicated
 * across the ESM/CommonJS boundary:
 *   - browser:  normaliseSurname()  in auth-identity.js  (re-exported by firebase-client.js; used by session.js getSurname)
 *   - functions: nameToPassword()   in functions/roster-parse-helpers.js
 *
 * Cloud Functions are CommonJS and cannot import the browser ES module, so the
 * logic is copied. CLAUDE.md warns "If the rule ever changes, update both
 * locations." These tests fail loudly if the two ever drift — on EITHER side:
 *   1. Behavioural — exercise the real (importable) functions nameToPassword().
 *   2. Source-equivalence — assert both source files literally contain the one
 *      canonical derivation expression, so editing the regex in one file alone
 *      (the most likely drift) breaks the build even though that file is not
 *      directly importable here (firebase-client.js pulls the Firebase CDN).
 *
 * Pure — no Firebase, no network. Run: node --test surname-parity.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { nameToPassword } = require('./functions/roster-parse-helpers.js');
// The browser-side PADDED password builder (auth-identity.js is pure ESM — importable here, unlike
// firebase-client.js which pulls the Firebase CDN). This is the value ensureFirebaseSession actually
// signs in with, so it must equal the functions-side nameToPassword byte-for-byte or a short-surname
// member is locked out (client signs in with a different password than setupRosterAuth provisioned).
const { surnamePassword } = await import('./auth-identity.js');

// The single canonical derivation. BOTH source files must contain this exact
// expression; if you change it, change it in all three places (here + both files)
// and reset every staff member's password (see session.js getSurname warning).
const CANON = ".split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '')";

/** Reference implementation of the shared core derivation (unpadded surname). */
const core = (/** @type {string} */ name) =>
    name.split(' ').slice(1).join('').toLowerCase().replace(/[^a-z]/g, '');

/** Reference implementation of nameToPassword's padding (Firebase ≥6 chars). */
const expectedPassword = (/** @type {string} */ name) => {
    const s = core(name);
    return s.length >= 6 ? s : s.padEnd(6, s);
};

// Real teamMembers names + deliberate edge cases (hyphen, apostrophe, multi-word
// surname, short surname needing padding, accented letters).
const NAMES = [
    'G. Miller',             // miller
    'C. Francisco-Charles',  // franciscocharles
    'M. De Silva',           // desilva
    "C. O'Brien",            // obrien
    'L. Atrakimaviciene',    // atrakimaviciene
    'S. Boyle',              // boyle
    'K. Jedlinski',          // jedlinski
    'N. Bedingfield',        // bedingfield
    'A. Tuck',               // tuck → padded to tucktu
];

describe('surname derivation — browser ↔ functions parity', () => {
    test('nameToPassword matches the canonical core + padding for every name', () => {
        for (const name of NAMES) {
            assert.equal(nameToPassword(name), expectedPassword(name),
                `nameToPassword("${name}") drifted from the canonical rule`);
        }
    });

    test('short surnames are padded to the Firebase 6-char minimum', () => {
        // "A. Tuck" → "tuck" (4) → padEnd(6,'tuck') → "tucktu"
        assert.equal(nameToPassword('A. Tuck'), 'tucktu');
        assert.ok(nameToPassword('A. Tuck').length >= 6);
    });

    test('client surnamePassword (the actual login credential) matches functions nameToPassword', () => {
        // Guards the PADDING drift the source-equivalence check below does NOT cover: it asserts the
        // core regex, not the `padEnd(6, …)` tail. A divergence here locks out every short-surname
        // member (client would sign in with a different password than the server provisioned).
        for (const name of NAMES) {
            assert.equal(surnamePassword(name), nameToPassword(name),
                `surnamePassword("${name}") (client) drifted from nameToPassword (functions) — lockout risk`);
        }
    });

    test('a name with no surname throws rather than yielding an empty password', () => {
        assert.throws(() => nameToPassword('Madonna'), /no usable surname/);
    });

    test('both source files contain the identical canonical derivation expression', () => {
        // The browser copy moved to auth-identity.js (v16.50); firebase-client.js re-exports it.
        const browserSrc   = readFileSync(new URL('./auth-identity.js', import.meta.url), 'utf8');
        const functionsSrc = readFileSync(new URL('./functions/roster-parse-helpers.js', import.meta.url), 'utf8');
        assert.ok(browserSrc.includes(CANON),
            'auth-identity.js normaliseSurname no longer matches the canonical derivation');
        assert.ok(functionsSrc.includes(CANON),
            'functions/roster-parse-helpers.js nameToPassword no longer matches the canonical derivation');
    });
});
