// @ts-check
/**
 * newlink-config.test.mjs — the new link page's settings, and the one switch that must not be flipped alone.
 * Run: node --test newlink-config.test.mjs   (part of `npm run test:hygiene`)
 *
 * `PHASE` is the page's lifecycle switch, and only 'preview' is built: the admin and the named previewers (CONFIG.NEWLINK_PREVIEW,
 * S. Silva since v25.33). Two failures are possible and
 * both are silent in the app — a preview leaking to members because the policy was widened ahead of the switch, or the
 * switch flipped to a phase whose gate does not exist, so the page tells colleagues it is open while nobody but the
 * admin can reach it. This file holds the switch, the policy and the pill to one story.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as config from './newlink-config.js';
import { PHASE, CLOSES, STARTS, TIMETABLE_STARTS, CONTACT, CONTACT_ROLE, AUDIENCE, audienceNames, PACK_BASE, HAVE_YOUR_SAY } from './newlink-config.js';
import { CHANGE_DATE } from './trains-data.js';
import { closesWords, startsWords } from './newlink-render.js';
import { PAGE_POLICIES, requirePage, admitsStaffPin, canOpenNewlink } from './auth-policy.js';
import { teamMembers, CONFIG } from './roster-data.js';

test('the preview is the admin\'s and the named previewers\' — the switch, the policy and the pill agree', () => {
    assert.equal(PHASE, 'preview',
        'only the preview is built. Opening the page needs its audience gate first — a role in auth-policy.js and a pill '
        + 'flag in nav-panel.js (newlink-config.js header) — and then this test widens with it.');
    assert.deepEqual(PAGE_POLICIES.newlink.role, ['admin', 'newlinkPreview']);
    assert.equal(admitsStaffPin('newlink'), false, 'never the station PIN (owner, 2 Nov 2026: "No, signed-in only")');
    const nav = readFileSync(new URL('./nav-panel.js', import.meta.url), 'utf8');
    assert.match(nav, /\{\s*id:\s*'newlink',[^}]*newlinkAudienceOnly:\s*true/, 'the pill has its own gate, read through canOpenNewlink');

    // The decision itself, through the REAL lists (requirePage reads CONFIG), not roles made up for the test: the admin
    // and S. Silva in; everybody else out — a manager included. That a Links designer is not enough is the role list
    // above (no `designer` in it): the real designer list has been the admin alone since 9 Nov 2026, so no real name can
    // show it here, and e2e/newlink.spec.js shows it with a designer list of its own.
    const decide = (/** @type {string} */ member) => requirePage({ status: 'named', member }, 'newlink').decision;
    assert.equal(decide('G. Miller'), 'allow');
    assert.equal(decide('S. Silva'), 'allow', 'the new link\'s contact (owner, 4 Nov 2026: "open up the new links page to S. Silva")');
    assert.equal(decide('M. Robson'), 'forbidden', 'a former Links designer, in neither list');
    assert.equal(decide('D. Watts'), 'forbidden', 'nor a manager');
    assert.equal(decide('T. Bibi'), 'forbidden');
    assert.equal(requirePage({ status: 'signedOut', member: null }, 'newlink').decision, 'login');
});

test('the pill is offered to exactly the people the page admits — every name on the roster', () => {
    // Two answers to one question (canOpenNewlink draws the pill on all nine pages; the policy decides who may stay), so
    // they are compared for every name rather than for the few above: a pill without the page bounces somebody, and a
    // page without the pill is reachable only by typing its address.
    const names = [...new Set([...teamMembers.map(m => m.name), ...CONFIG.ADMIN_NAMES, ...CONFIG.NEWLINK_PREVIEW])];
    const disagree = names.filter(n => canOpenNewlink(n) !== (requirePage({ status: 'named', member: n }, 'newlink').decision === 'allow'));
    assert.deepEqual(disagree, []);
    // A name spelt differently from teamMembers would grant nobody, silently.
    for (const n of CONFIG.NEWLINK_PREVIEW) {
        assert.ok(teamMembers.some(m => m.name === n && !m.hidden), `${n} is not an active name on the roster — spell it as teamMembers does`);
    }
});

test('the closing date is a real day, or null — "a date to be agreed"', () => {
    // Both branches check something (test audit, 7 Nov 2026). This returned early while CLOSES is null — the setting as
    // it ships today — so it passed having checked nothing, not even that the page then says "a date to be agreed".
    if (CLOSES === null) {
        assert.equal(closesWords(CLOSES), 'a date to be agreed');
        return;
    }
    assert.match(CLOSES, /^\d{4}-\d{2}-\d{2}$/);
    const [y, mo, d] = CLOSES.split('-').map(Number);
    const day = new Date(y, mo - 1, d);
    assert.ok(day.getFullYear() === y && day.getMonth() === mo - 1 && day.getDate() === d, `${CLOSES} is not a day`);
    assert.notEqual(closesWords(CLOSES), 'a date to be agreed', 'a set date is said as a date');
});

test('the audience: null stands for everyone on a normal CEA contract, not a CEA bilingual contract; a list must name real people', () => {
    const names = audienceNames();
    assert.ok(names.length >= 20, `the audience reads as ${names.length} people`);
    const byName = new Map(teamMembers.map(m => [m.name, m]));
    for (const n of names) assert.ok(byName.has(n), `${n} is not on the roster — spell names as teamMembers does`);
    if (AUDIENCE === null) {
        assert.ok(names.every(n => byName.get(n)?.role === 'CEA'), 'the stand-in is CEAs only');
        // Owner, 8 Nov 2026: "This link will only apply to people with the normal CEA contract and NOT the bilingual
        // contract who will still have their own links." The CONTRACT, as the leave allowance reads it — not the line
        assert.ok(names.every(n => !byName.get(n)?.bilingualContract), 'and nobody on a CEA bilingual contract');
        const due = teamMembers.filter(m => m.role === 'CEA' && !m.bilingualContract && !m.hidden && !m.managerOnly).map(m => m.name);
        assert.deepEqual([...names].sort(), [...due].sort(), 'everyone on a normal CEA contract, and nobody else');
        // A NORMAL CONTRACT ON THE BILINGUAL LINK IS ON THE NEW LINK (owner, 8 Nov 2026, of M. Campbell: "Keep her on the
        // new link"): whoever's base line is bilingual but whose contract is not is still in the list
        const onBilingualLine = teamMembers.filter(m => m.role === 'CEA' && !m.hidden && !m.bilingualContract
            && (m.rosterType === 'bilingual' || (m.rosterChanges ?? []).some(c => c.rosterType === 'bilingual')));
        for (const m of onBilingualLine) assert.ok(names.includes(m.name), `${m.name}: a normal CEA contract on the bilingual link, so on the new link`);
        assert.ok(teamMembers.some(m => m.role === 'CEA' && m.bilingualContract && !m.hidden),
            'a CEA bilingual contract on the roster for the rule to leave out — if none is left, this line can go');
        assert.ok(names.every(n => !byName.get(n)?.hidden), 'and nobody who has left');
    } else {
        assert.equal(new Set(AUDIENCE).size, AUDIENCE.length, 'nobody twice');
    }
});

test('the pack base is the served docs folder, over https', () => {
    assert.match(PACK_BASE, /^https:\/\/[^/]+\/.*docs\/links-26\/$/);
});

test('the drafted words promise nothing the page does not do, and name no recommendation', () => {
    const words = HAVE_YOUR_SAY.join(' ');
    assert.doesNotMatch(words, /recommend/i);
    // Who leads the change is said in the card where views are asked for — Sara Silva, as the RMT rep, never the admin
    // (owner, 4 Nov 2026) — and nothing more about how the choice is made: "It is deliberately vague."
    assert.equal(CONTACT_ROLE, 'the RMT rep');
    assert.match(words, /Sara Silva, the RMT rep, is leading the change\./);
    assert.doesNotMatch(words, /\badmin\b|G\. Miller|managers decide/i, 'nothing gives the impression that the admin, or the managers, choose among the three');
    assert.doesNotMatch(words, /final call|\bdecides?\b|decided by|goes to the managers/i, 'and no more: how the choice is made is left deliberately vague');
    assert.match(words, /does not collect/, 'and that the page itself collects nothing');
    // Every other state of the page is held to the same two patterns in newlink-render.test.mjs ("S. SILVA LEADS").
});

test('the new link starts in January 2027, the day not yet known — not with the timetable, which changes in December', () => {
    // Owner, 2 Nov 2026: "Whilst the new timetable will start in December, the new cea link design will be from January 1st."
    // 8 Nov 2026: "Needs to be changed everywhere that the new link will start in January 2027. We don't now know exactly
    // what day."
    assert.equal(STARTS, '2027-01');
    // ONE START, PAGE AND PACK: the sheets, the read-me and the decks say docs/links-26/tooling/link.mjs → LINK_STARTS
    const pack = /^export const LINK_STARTS = '([^']+)';$/m.exec(readFileSync(new URL('./docs/links-26/tooling/link.mjs', import.meta.url), 'utf8'))?.[1];
    assert.ok(pack, 'link.mjs states when the new link starts');
    assert.equal(startsWords(STARTS)?.replace(/^(in|on) /, ''), pack, 'the page says the start the pack says');
});

test('the contact is Sara Silva, S. Silva on the roster — a real member, and the only person the page\'s words name', () => {
    // Owner, 2 Nov 2026: "Sara Silva (S. Silva) is the primary contact for it not me." 8 Nov 2026: "Where it says tell
    // S. Silva. Can you make that Sara Silva."
    assert.equal(CONTACT, 'Sara Silva');
    const rostered = CONTACT.replace(/^(\p{Lu})\p{Ll}+ /u, '$1. ');   // the roster's spelling: an initial and the surname
    assert.equal(rostered, 'S. Silva');
    assert.ok(teamMembers.some(m => m.name === rostered && !m.hidden), 'the person named is on the roster, as S. Silva');
    const words = HAVE_YOUR_SAY.join(' ');
    assert.match(HAVE_YOUR_SAY[0], /^Tell Sara Silva or your manager/, 'Have your say names the contact, in full');
    assert.match(HAVE_YOUR_SAY[1], /^Sara Silva, the RMT rep, is leading the change\.$/);
    // no member is named by the roster's own spelling: the contact is named in full, and nobody else is named at all
    const named = teamMembers.map(m => m.name)
        .filter(n => words.includes(n) || (n !== rostered && words.includes(n.split(' ').pop())));
    assert.deepEqual(named, [], 'no other member is named as the person to ask');
});

test('nothing is written on the canvas under the last card — the footer line was not needed', () => {
    // Owner, 2 Nov 2026, of "S. Silva is the contact for the new link. The proposals were made with the rota-design tools in
    // this app.": "The wording at the very bottom is not needed." The contact is named where views are asked for (above),
    // so the line said nothing the page does not; it went with its setting, its markup and its style.
    assert.equal('CONTACT_LINE' in config, false, 'the setting for the line is gone');
    const html = readFileSync(new URL('./newlink.html', import.meta.url), 'utf8');
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    assert.ok(main.length > 1000, 'the page\'s <main> was not found — this test is checking nothing');
    assert.doesNotMatch(main, /<p\b[^>]*>\s*<\/p>\s*$/, 'an empty paragraph filled by script sits after the last card');
    assert.match(main, /<\/div>\s*$/, 'the last thing in <main> is the last card, closing');
    const css = readFileSync(new URL('./newlink.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /\.nl-prepared\b/, 'and no style is left for it');
});

test('the timetable date here is the Trains page\'s own — one date, two copies, pinned together', () => {
    // A copy, so this page does not load the whole timetable to know one day of it (test audit, 7 Nov 2026).
    assert.equal(TIMETABLE_STARTS, CHANGE_DATE,
        'the New link page and the Trains page disagree about when the new timetable starts — change both, together');
});

