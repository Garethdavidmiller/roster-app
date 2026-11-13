/**
 * Parity tests for the surname-derivation rule that is DELIBERATELY duplicated
 * across the ESM/CommonJS boundary:
 *   - browser:  normaliseSurname()  in auth-identity.js  (re-exported by firebase-client.js; behind every account email and surname default)
 *   - functions: surnameCore()      in functions/roster-parse-helpers.js (behind nameToEmail AND nameToPassword)
 *
 * Cloud Functions are CommonJS and cannot import the browser ES module, so the
 * logic is copied. CLAUDE.md warns "If the rule ever changes, update both
 * locations." These tests fail loudly if the two ever drift — on EITHER side:
 *   1. Behavioural — the two cores, and the password builders, compared over the whole roster.
 *   2. Source — ONE copy per side (audit F11, Nov 2026). The browser's letters-only normaliser was
 *      written out three times (the surname, the typed-surname gate, the surname block) and the
 *      functions' surname twice (the email, the password), so editing the regex in one place left
 *      a gate and the thing it gates disagreeing with every test green. Each side now has one, and
 *      the source checks below fail on a second.
 *
 * Pure — no Firebase, no network. Run: node scripts/run-tests.mjs surname-parity.test.mjs
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

// The single canonical derivation, in its two halves: the SURNAME words, then LETTERS only. The
// functions side writes it as one expression (CANON); the browser side splits it, so that the
// letters half can serve the gate and the surname block too. If you change either half, change it
// on both sides and here, and reset every staff member's password (auth-identity.js's header).
const SPLIT   = ".split(' ').slice(1).join('')";
const LETTERS = ".toLowerCase().replace(/[^a-z]/g, '')";
const CANON   = SPLIT + LETTERS;

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

    test('the two CORES agree on every real name and the awkward ones', async () => {
        // The cores themselves, not only what is built from them: the functions core feeds both the
        // address and the password, so a drift here moves the account AND its default at once.
        const { normaliseSurname } = await import('./auth-identity.js');
        const { surnameCore } = require('./functions/roster-parse-helpers.js');
        const { teamMembers } = await import('./roster-data.js');
        const names = [...teamMembers.map((/** @type {any} */ m) => m.name), ...NAMES,
            'X. Ünal', 'A. İnce', 'Z. Åberg', 'B. de la Cruz', '  L.  Spaced  Out  ', 'Madonna', ''];
        assert.ok(names.length > 50, `expected the whole roster, got ${names.length}`);
        for (const n of names) {
            assert.equal(surnameCore(n), normaliseSurname(n), `the two surname cores disagree on "${n}"`);
            assert.equal(surnameCore(n), core(n), `surnameCore("${n}") drifted from the canonical rule`);
        }
    });

    test('ONE copy per side, by source — every other use goes through it', () => {
        // The browser copy moved to auth-identity.js (v16.50); firebase-client.js re-exports it.
        const browserSrc   = readFileSync(new URL('./auth-identity.js', import.meta.url), 'utf8');
        const functionsSrc = readFileSync(new URL('./functions/roster-parse-helpers.js', import.meta.url), 'utf8');
        const count = (/** @type {string} */ src, /** @type {string} */ s) => src.split(s).length - 1;
        /** The body of a top-level function, from its declaration to the next top-level closing brace. */
        const body = (/** @type {string} */ src, /** @type {string} */ name) => {
            const at = src.search(new RegExp(`^(?:export )?function ${name}\\(`, 'm'));
            assert.ok(at >= 0, `${name} was not found — this check reads nothing`);
            return src.slice(at, src.indexOf('\n}', at) + 2);
        };
        // The functions side: the whole canonical expression, exactly once — inside surnameCore — and
        // both builders reach it through surnameCore rather than a copy of their own.
        assert.equal(count(functionsSrc, CANON), 1, 'functions/roster-parse-helpers.js must spell the surname rule exactly once');
        assert.match(functionsSrc, new RegExp(`function surnameCore\\(fullName\\) \\{ return fullName${CANON.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}; \\}`),
            'the one functions copy is surnameCore');
        assert.equal(count(functionsSrc, "replace(/[^a-z]/g, '')"), 1, 'a second letters-only copy crept into the functions side');
        for (const fn of ['nameToEmail', 'nameToPassword']) {
            assert.match(body(functionsSrc, fn), /surnameCore\(fullName\)/, `${fn} must take its surname from surnameCore`);
        }
        // The browser side: the LETTERS half exactly once — inside lettersOnly — and the surname, the
        // typed-surname gate and the surname block all reach it through lettersOnly.
        assert.equal(count(browserSrc, LETTERS), 1, 'auth-identity.js must spell the letters-only rule exactly once');
        assert.equal(count(browserSrc, "replace(/[^a-z]/g, '')"), 1, 'a second letters-only copy crept into auth-identity.js');
        assert.match(body(browserSrc, 'lettersOnly'), new RegExp(`return s${LETTERS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`),
            'the one browser copy is lettersOnly');
        assert.ok(body(browserSrc, 'normaliseSurname').includes(`lettersOnly(fullName${SPLIT})`),
            'normaliseSurname must be lettersOnly over the words after the first');
        for (const fn of ['credentialCandidatesFor', 'validateNewPassword']) {
            assert.match(body(browserSrc, fn), /lettersOnly\(/, `${fn} must compare through lettersOnly`);
        }
    });

    test('the gate and the surname block read a surname exactly as normaliseSurname does', async () => {
        // The behaviour the source check above protects: whatever the typed value's caps and
        // punctuation, the fallback is offered, and the surname refused, on the SAME reading.
        const { normaliseSurname, credentialCandidatesFor, validateNewPassword } = await import('./auth-identity.js');
        const { teamMembers } = await import('./roster-data.js');
        for (const { name } of teamMembers) {
            const s = normaliseSurname(name);
            if (!s) continue;
            const typed = `${s.toUpperCase()}!`;
            assert.ok(credentialCandidatesFor(name, typed).includes(surnamePassword(name)),
                `"${typed}" is ${name}'s surname, and the fallback was not offered`);
            const chosen = `${s.toUpperCase()}-${'1'.repeat(8)}`;
            assert.equal(validateNewPassword(name, chosen, chosen), 'Choose something other than your surname.',
                `"${chosen}" is ${name}'s surname, and it was accepted as a new password`);
        }
    });
});

// ── THE ACCOUNT EMAIL — the identifier itself, and it was NOT guarded (v19.98) ──────────────────
//
// Everything above guards the PASSWORD half of the identity derivation. `nameToEmail` is the other
// half, duplicated across the same ESM/CommonJS boundary for the same reason, and nothing checked it:
//
//   browser:   nameToEmail()  in auth-identity.js   — what the client SIGNS IN as
//   functions: nameToEmail()  in functions/roster-parse-helpers.js — what setupRosterAuth PROVISIONS
//
// It is the more consequential of the two. A drifted password is a failed sign-in with an error the
// member can report; a drifted email means the server creates `x@myb-roster.local` while the client
// authenticates against `y@myb-roster.local` — an account that does not exist, for a member who is
// simply locked out, with "Set up accounts" reporting success.
//
// The two implementations are already written DIFFERENTLY, which is what makes this worth pinning
// rather than assuming: the browser delegates its surname to `normaliseSurname`, the functions copy
// inlines the same expression. They agree today on all 51 real names and on accents, apostrophes,
// hyphens, particles and doubled spaces — so this is a drift guard, not a bug report.
describe('nameToEmail parity across the browser / functions boundary', () => {
    const { nameToEmail: fnEmail } = require('./functions/roster-parse-helpers.js');

    test('both sides derive the same account email, on every real name and the awkward ones', async () => {
        const { nameToEmail: browserEmail } = await import('./auth-identity.js');
        const { teamMembers } = await import('./roster-data.js');
        const names = [
            ...teamMembers.map((/** @type {any} */ m) => m.name),
            "S. O'Brien", 'J. Smith-Jones', 'A. Van Der Berg', "M. D'Souza", 'X. Ünal',
            'P. Ng', '  L.  Spaced  Out  ', 'R. Mc Donald', 'T. St John', 'Z. Åberg',
            'N. José', 'K. Ekwueme-Okoye', 'B. de la Cruz',
        ];
        for (const n of names) {
            assert.equal(browserEmail(n), fnEmail(n),
                `nameToEmail("${n}") differs across the boundary — the client would sign in to an ` +
                'account setupRosterAuth never created');
        }
    });

    test('the derived email is always a usable Firebase identifier', () => {
        // Guards the shape rather than the spelling: whatever the rule becomes, it has to stay a
        // lowercase local-part on the synthetic domain, or Firebase rejects the account outright.
        for (const n of ['G. Miller', "S. O'Brien", 'A. Tuck']) {
            assert.match(fnEmail(n), /^[a-z]+\.[a-z]+@myb-roster\.local$/,
                `nameToEmail("${n}") = "${fnEmail(n)}" is not a valid synthetic account email`);
        }
    });
});
