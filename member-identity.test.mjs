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
    ({ name, email: nameToEmail(name), firebase: { sign_in_provider: 'password' } });

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
        null, undefined, 'G. Miller', {},
    ];
    for (const c of impostors) assert.equal(memberNameFromClaims(/** @type {any} */ (c)), null, JSON.stringify(c));
});

test('an email differing only in case is still the member (Firebase lower-cases emails)', () => {
    assert.equal(memberNameFromClaims({ ...real('G. Miller'), email: 'G.Miller@myb-roster.local' }), 'G. Miller');
});
