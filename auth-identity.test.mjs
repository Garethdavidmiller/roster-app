/**
 * Unit tests for auth-identity.js — the account-identity derivations extracted from
 * firebase-client.js (v16.50) so they're directly testable in Node.
 * Run (no mocks): node --test auth-identity.test.mjs
 *
 * These are IDENTITY-CRITICAL: nameToEmail is the Firebase Auth account key, so a silent
 * change (e.g. two display names collapsing to one email → a shared account, or an
 * initial-stripping regression) would lock people into the wrong identity. Pin the exact
 * outputs. (normaliseSurname's parity with the Cloud Functions copy is covered separately
 * by surname-parity.test.mjs.)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseSurname, nameToEmail, surnamePassword, credentialCandidatesFor, isPasswordMigrated, isCredentialRejection } from './auth-identity.js';

/** Firestore Timestamp-like stub: an object exposing toMillis(). */
const ts = (/** @type {number} */ ms) => ({ toMillis: () => ms });

describe('normaliseSurname', () => {
    test('everything after the first word, lowercased, letters only', () => {
        assert.equal(normaliseSurname('G. Miller'), 'miller');
        assert.equal(normaliseSurname('C. Francisco-Charles'), 'franciscocharles');
        assert.equal(normaliseSurname('L. Atrakimaviciene'), 'atrakimaviciene');
    });
    test('joins a multi-word surname without spaces', () => {
        assert.equal(normaliseSurname('A. Van Der Berg'), 'vanderberg');
    });
    test('strips apostrophes and other non-alpha', () => {
        assert.equal(normaliseSurname("S. O'Brien"), 'obrien');
    });
    test('a name with no surname yields an empty string (padding is applied elsewhere)', () => {
        assert.equal(normaliseSurname('Madonna'), '');
    });
});

describe('nameToEmail', () => {
    test('initial.surname@myb-roster.local', () => {
        assert.equal(nameToEmail('G. Miller'), 'g.miller@myb-roster.local');
        assert.equal(nameToEmail('C. Francisco-Charles'), 'c.franciscocharles@myb-roster.local');
        assert.equal(nameToEmail('L. Atrakimaviciene'), 'l.atrakimaviciene@myb-roster.local');
    });
    test('the initial is the first letter of the first word, non-alpha stripped', () => {
        assert.equal(nameToEmail('A. Van Der Berg'), 'a.vanderberg@myb-roster.local');
    });
    test('two DIFFERENT members must not collapse to the same email (identity collision guard)', () => {
        assert.notEqual(nameToEmail('G. Miller'), nameToEmail('S. Miller'));
        assert.equal(nameToEmail('S. Miller'), 's.miller@myb-roster.local');
    });
});

describe('surnamePassword — the padded surname credential', () => {
    test('surnames ≥6 chars are used verbatim', () => {
        assert.equal(surnamePassword('G. Miller'), 'miller');
        assert.equal(surnamePassword('K. Jedlinski'), 'jedlinski');
    });
    test('short surnames are repeated to the Firebase 6-char minimum', () => {
        assert.equal(surnamePassword('A. Tuck'), 'tucktu');       // tuck → tucktu
        assert.equal(surnamePassword('T. Bibi'), 'bibibi');       // bibi → bibibi
        assert.ok(surnamePassword('C. Reen').length >= 6);        // reen → reenre
        assert.equal(surnamePassword('C. Reen'), 'reenre');
    });
    test('no surname → an unusable all-x password (never throws, unlike functions)', () => {
        assert.equal(surnamePassword('Madonna'), 'xxxxxx');
    });
});

describe('credentialCandidatesFor — gated dual-attempt (PASSWORD_PLAN §3.2)', () => {
    test('a custom password is the sole candidate (does NOT normalise to the surname)', () => {
        assert.deepEqual(credentialCandidatesFor('G. Miller', 'Str0ng!pass'), ['Str0ng!pass']);
    });
    test('typing the exact lowercase surname → one candidate (raw == derived, deduped)', () => {
        assert.deepEqual(credentialCandidatesFor('G. Miller', 'miller'), ['miller']);
    });
    test('typing a mixed-case surname → raw first, THEN the derived surname (the gated fallback)', () => {
        assert.deepEqual(credentialCandidatesFor('G. Miller', 'Miller'), ['Miller', 'miller']);
        assert.deepEqual(credentialCandidatesFor('G. Miller', 'MILLER'), ['MILLER', 'miller']);
    });
    test('a short surname typed → raw then the PADDED derived surname', () => {
        assert.deepEqual(credentialCandidatesFor('T. Bibi', 'Bibi'), ['Bibi', 'bibibi']);
        // typing the padded form itself dedupes to one
        assert.deepEqual(credentialCandidatesFor('T. Bibi', 'bibibi'), ['bibibi']);
    });
    test('the fallback is GATED: a non-surname password never yields the surname candidate', () => {
        // The security-critical case — an attacker typing junk must NOT get the surname attempt.
        assert.deepEqual(credentialCandidatesFor('G. Miller', 'anything'), ['anything']);
        assert.deepEqual(credentialCandidatesFor('G. Miller', 'x'), ['x']);
    });
    test('leading/trailing whitespace is trimmed (iOS keyboard lockout guard); empty → no candidates', () => {
        assert.deepEqual(credentialCandidatesFor('G. Miller', '  Str0ng!  '), ['Str0ng!']);
        assert.deepEqual(credentialCandidatesFor('G. Miller', '   '), []);
        assert.deepEqual(credentialCandidatesFor('G. Miller', ''), []);
    });
});

describe('isPasswordMigrated — the Operations/Settings status predicate (PASSWORD_PLAN §6)', () => {
    test('no status doc / null / undefined → not migrated', () => {
        assert.equal(isPasswordMigrated(null), false);
        assert.equal(isPasswordMigrated(undefined), false);
        assert.equal(isPasswordMigrated({}), false);
    });
    test('passwordSetAt present, no resetAt → migrated', () => {
        assert.equal(isPasswordMigrated({ passwordSetAt: ts(1000) }), true);
    });
    test('resetAt present, no passwordSetAt → not migrated (still on surname default)', () => {
        assert.equal(isPasswordMigrated({ resetAt: ts(1000) }), false);
    });
    test('set AFTER the last reset → migrated', () => {
        assert.equal(isPasswordMigrated({ passwordSetAt: ts(2000), resetAt: ts(1000) }), true);
    });
    test('reset AFTER the set → NOT migrated (a later admin reset re-flags surname default)', () => {
        assert.equal(isPasswordMigrated({ passwordSetAt: ts(1000), resetAt: ts(2000) }), false);
    });
    test('set EXACTLY equal to reset → migrated (>=, boundary)', () => {
        assert.equal(isPasswordMigrated({ passwordSetAt: ts(1500), resetAt: ts(1500) }), true);
    });
    test('a zero passwordSetAt is treated as absent (not migrated)', () => {
        assert.equal(isPasswordMigrated({ passwordSetAt: ts(0) }), false);
    });
    test('a field without toMillis() is treated as 0 (no throw)', () => {
        assert.equal(isPasswordMigrated({ passwordSetAt: {} }), false);
        assert.equal(isPasswordMigrated({ passwordSetAt: ts(1000), resetAt: {} }), true);
    });
});

describe('isCredentialRejection — the shared candidate-ladder stop predicate (PASSWORD_PLAN §3.2)', () => {
    test('definitive credential-rejection codes → true (try the next candidate)', () => {
        for (const code of ['auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found']) {
            assert.equal(isCredentialRejection(code), true, code);
        }
    });
    test('transient / non-credential failures → false (STOP, do not retry the surname candidate)', () => {
        // These are exactly the codes the sign-in AND Settings-reauth ladders must NOT keep retrying on.
        for (const code of ['auth/network-request-failed', 'auth/too-many-requests', 'auth/operation-not-allowed',
                            'auth/requires-recent-login', 'auth/internal-error', 'auth/user-disabled']) {
            assert.equal(isCredentialRejection(code), false, code);
        }
    });
    test('undefined / empty / unknown code → false (fail safe: stop rather than loop)', () => {
        assert.equal(isCredentialRejection(undefined), false);
        assert.equal(isCredentialRejection(''), false);
        assert.equal(isCredentialRejection('auth/something-new'), false);
    });
});
