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
import { normaliseSurname, nameToEmail } from './auth-identity.js';

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
