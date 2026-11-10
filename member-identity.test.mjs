// member-identity.test.mjs — the server's copy of "which member does this token speak for" (v24.23).
//
// functions/member-identity.js and `isMember()` in firestore.rules are two copies of one rule; the
// rules copy is run against every roster name in firestore.rules.test.mjs. This runs the SERVER copy
// against the same names, so a member cannot be recognised by the rules and refused by Overtime, or
// the reverse. Pure: needs no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { teamMembers } from './roster-member-data.js';
import { nameToEmail } from './auth-identity.js';

const require = createRequire(import.meta.url);
const { memberNameFromClaims } = require('./functions/member-identity.js');

const real = (/** @type {string} */ name) =>
    ({ name, member: name, email: nameToEmail(name), firebase: { sign_in_provider: 'password' } });

test('every roster member is recognised on their own account — the client and server emails agree', () => {
    const names = teamMembers.map(m => m.name);
    assert.ok(names.length > 40, `expected the whole roster, got ${names.length}`);
    for (const name of names) assert.equal(memberNameFromClaims(real(name)), name, `${name} is locked out`);
});

test('a name arriving any other way is nobody', () => {
    const impostors = [
        { name: 'G. Miller' },
        { name: 'G. Miller', firebase: { sign_in_provider: 'anonymous' } },
        { name: 'G. Miller', calendarViewer: true, firebase: { sign_in_provider: 'custom' } },
        { name: 'G. Miller', email: 'attacker@myb-roster.local', firebase: { sign_in_provider: 'password' } },
        { name: 'G. Miller', email: nameToEmail('G. Miller'), firebase: { sign_in_provider: 'google.com' } },
        { name: 'G. Miller', email: nameToEmail('S. Silva'), firebase: { sign_in_provider: 'password' } },
        { name: '', email: 'x', firebase: { sign_in_provider: 'password' } },
        // v24.27 — self-registered at the derived email: everything v24.23 checked, no server stamp.
        { name: 'G. Miller', email: nameToEmail('G. Miller'), firebase: { sign_in_provider: 'password' } },
        { name: 'G. Miller', member: 'S. Silva', email: nameToEmail('G. Miller'), firebase: { sign_in_provider: 'password' } },
        { name: 'G. Miller', member: true, email: nameToEmail('G. Miller'), firebase: { sign_in_provider: 'password' } },
        null, undefined, 'G. Miller', {},
    ];
    for (const c of impostors) assert.equal(memberNameFromClaims(/** @type {any} */ (c)), null, JSON.stringify(c));
});

test('the server\'s `member` stamp is not enough on its own — the provider and the email still decide', () => {
    // Every impostor above also lacks `member === name`, so that ONE check refused them all and the
    // other two could be deleted with this file green (test audit, 7 Nov 2026: removing the
    // password-provider check, or the email binding, left 321 tests in six suites passing). These
    // carry a correct stamp, so only the check under test can refuse them.
    const stamped = (/** @type {object} */ rest) => ({ name: 'G. Miller', member: 'G. Miller', ...rest });
    const impostors = [
        // the right email, the wrong way in
        stamped({ email: nameToEmail('G. Miller'), firebase: { sign_in_provider: 'google.com' } }),
        stamped({ email: nameToEmail('G. Miller'), firebase: { sign_in_provider: 'anonymous' } }),
        stamped({ email: nameToEmail('G. Miller'), firebase: { sign_in_provider: 'custom' } }),
        stamped({ email: nameToEmail('G. Miller') }),
        // the right way in, somebody else's address — or none
        stamped({ email: nameToEmail('S. Silva'), firebase: { sign_in_provider: 'password' } }),
        stamped({ email: 'attacker@myb-roster.local', firebase: { sign_in_provider: 'password' } }),
        stamped({ firebase: { sign_in_provider: 'password' } }),
    ];
    for (const c of impostors) assert.equal(memberNameFromClaims(/** @type {any} */ (c)), null, JSON.stringify(c));
});

test('an email differing only in case is still the member (Firebase lower-cases emails)', () => {
    assert.equal(memberNameFromClaims({ ...real('G. Miller'), email: 'G.Miller@myb-roster.local' }), 'G. Miller');
});

// claimedByAnotherMember (whole-app check, 10 Nov 2026) — Set up accounts adopts an existing account
// only when the member its claims name derives to that account's own address.
test('an account whose claims name another member is somebody else\'s; this address\'s own is not', () => {
    const { claimedByAnotherMember } = require('./functions/member-identity.js');
    const at = (/** @type {string} */ owner, /** @type {any} */ customClaims) => ({ email: nameToEmail(owner), customClaims });
    // every roster member's own account is their own — the same two derivations as above
    for (const { name } of teamMembers) {
        assert.equal(claimedByAnotherMember(at(name, { name, member: name })), null, `${name} refused on their own account`);
    }
    assert.equal(claimedByAnotherMember(at('A. Hared', { name: 'L. Springer', member: 'L. Springer' })), 'L. Springer');
    assert.equal(claimedByAnotherMember(at('A. Hared', { name: 'L. Springer' })), 'L. Springer', 'a pre-`member` account too');
    assert.equal(claimedByAnotherMember(at('L. Springer', { name: 'l. SPRINGER', member: 'l. SPRINGER' })), null,
        'a respelling that derives the same address is the same person');
    for (const c of [null, undefined, {}, { admin: true }, { stamped: true }]) {
        assert.equal(claimedByAnotherMember(at('L. Springer', c)), null, `${JSON.stringify(c)} names nobody`);
    }
    assert.equal(claimedByAnotherMember({ email: undefined, customClaims: { name: 'L. Springer' } }), 'L. Springer',
        'an account with no address is never assumed to be the claimed member\'s');
});
