// @ts-check
/**
 * newlink-config.test.mjs — the December link page's settings, and the one switch that must not be flipped alone.
 * Run: node --test newlink-config.test.mjs   (part of `npm run test:hygiene`)
 *
 * `PHASE` is the page's lifecycle switch, and only 'preview' is built: the admin alone. Two failures are possible and
 * both are silent in the app — a preview leaking to members because the policy was widened ahead of the switch, or the
 * switch flipped to a phase whose gate does not exist, so the page tells colleagues it is open while nobody but the
 * admin can reach it. This file holds the switch, the policy and the pill to one story.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHASE, CLOSES, AUDIENCE, audienceNames, PACK_BASE, HAVE_YOUR_SAY, PREPARED_BY } from './newlink-config.js';
import { PAGE_POLICIES, requirePageAuth, admitsStaffPin } from './auth-policy.js';
import { teamMembers } from './roster-data.js';

test('the preview is the admin\'s alone — the switch, the policy and the pill agree', () => {
    assert.equal(PHASE, 'preview',
        'only the preview is built. Opening the page needs its audience gate first — a role in auth-policy.js and a pill '
        + 'flag in nav-panel.js (newlink-config.js header) — and then this test widens with it.');
    const policy = PAGE_POLICIES.newlink;
    assert.deepEqual(policy.role, ['admin']);
    assert.equal(admitsStaffPin('newlink'), false, 'never the station PIN (owner, 2 Nov 2026: "No, signed-in only")');
    const nav = readFileSync(new URL('./nav-panel.js', import.meta.url), 'utf8');
    assert.match(nav, /\{\s*id:\s*'newlink',[^}]*adminOnly:\s*true/, 'the pill is the admin\'s alone too');

    // The decision itself, not only the table: the admin in, everybody else out — a designer and a manager included.
    const named = (/** @type {string} */ member) => ({ status: 'named', member });
    assert.equal(requirePageAuth(named('G. Miller'), policy, { admin: true }).decision, 'allow');
    assert.equal(requirePageAuth(named('S. Silva'), policy, { designer: true }).decision, 'forbidden');
    assert.equal(requirePageAuth(named('D. Watts'), policy, { manager: true }).decision, 'forbidden');
    assert.equal(requirePageAuth(named('T. Bibi'), policy, {}).decision, 'forbidden');
    assert.equal(requirePageAuth({ status: 'signedOut', member: null }, policy, {}).decision, 'login');
});

test('the closing date is a real day, or null — "a date to be agreed"', () => {
    if (CLOSES === null) return;
    assert.match(CLOSES, /^\d{4}-\d{2}-\d{2}$/);
    const [y, mo, d] = CLOSES.split('-').map(Number);
    const day = new Date(y, mo - 1, d);
    assert.ok(day.getFullYear() === y && day.getMonth() === mo - 1 && day.getDate() === d, `${CLOSES} is not a day`);
});

test('the audience: null stands for every CEA on the roster; a list must name real people', () => {
    const names = audienceNames();
    assert.ok(names.length >= 20, `the audience reads as ${names.length} people`);
    const byName = new Map(teamMembers.map(m => [m.name, m]));
    for (const n of names) assert.ok(byName.has(n), `${n} is not on the roster — spell names as teamMembers does`);
    if (AUDIENCE === null) {
        assert.ok(names.every(n => byName.get(n)?.role === 'CEA'), 'the stand-in is CEAs only');
        assert.ok(names.every(n => !byName.get(n)?.hidden), 'and nobody who has left');
    } else {
        assert.equal(new Set(AUDIENCE).size, AUDIENCE.length, 'nobody twice');
    }
});

test('the pack base is the served docs folder, over https', () => {
    assert.match(PACK_BASE, /^https:\/\/[^/]+\/.*docs\/links-26\/$/);
});

test('the drafted words promise nothing the page does not do, and name no recommendation', () => {
    const words = [...HAVE_YOUR_SAY, PREPARED_BY].join(' ');
    assert.doesNotMatch(words, /recommend/i);
    assert.match(words, /managers/, 'it says who decides');
    assert.match(words, /does not collect/, 'and that the page itself collects nothing');
});
