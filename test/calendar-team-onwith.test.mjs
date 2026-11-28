// @ts-check
// @lane hygiene
/**
 * calendar-team-onwith.test.mjs — Team View's "On with" card (calendar-team-onwith.js), EXECUTED against
 * the real roster with a hand-made day for each member. team-overlap.test.mjs proves the arithmetic; this
 * proves what reaches the card: a section per role, the member's own first; who is listed in each and in
 * what order; who never is (a leaver, somebody on leave or resting, the member); whose day a neighbouring
 * overnight is; the stretch together said quietly; nothing for a past date; and the wait while a month it
 * reads is still being checked. Part of test:hygiene.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { teamMembers, TEAM_GRADES } from '../roster-data.js';
import { buildOnWithCard, colleaguesOf, dayOf, cardDate, isPastDay, rolesInOrder, onWithOffered, lastOfferedDay, ONWITH_WEEKS_AHEAD } from '../calendar-team-onwith.js';
import { noteKnowledge, _reset } from '../calendar-data-state.js';
import { formatISO } from '../roster-data.js';
import { resolveEffectiveShift } from '../override-utils.js';

const ISO = '2026-11-27';                       // a Friday
const TODAY = new Date(2026, 10, 27, 8, 0);     // that Friday morning: the card answers for today
const monthKey = (/** @type {number} */ y, /** @type {number} */ m) => `${y}-${m}`;
const current = (/** @type {string} */ grade) => teamMembers.filter(m => !m.hidden && m.role === grade
    && !(m.startDate && m.startDate > dayOf(ISO, -1)));
const [me, early, long, touching, onLeave, nightBefore] = current('CEA');
const [ces, ces2] = current('CES');
const leaver = teamMembers.find(m => m.hidden && TEAM_GRADES.includes(m.role));

/** @type {Map<string, string>} "name|iso" → the shift that day; anything absent is a rest day */
let shifts = new Map();
const day = (/** @type {any} */ m, /** @type {string} */ iso, /** @type {string} */ shift) => shifts.set(`${m.name}|${iso}`, shift);
/** "name|iso" → an override record and the base shift under it, resolved through the REAL ladder. */
let changes = new Map();
const change = (/** @type {any} */ m, /** @type {string} */ iso, /** @type {any} */ override, /** @type {string} */ base) =>
    changes.set(`${m.name}|${iso}`, { override, base });
const effectiveDay = (/** @type {any} */ m, /** @type {Date} */ d) => {
    const changed = changes.get(`${m.name}|${formatISO(d)}`);
    if (changed) return resolveEffectiveShift(changed.override, changed.base, false, false);
    const shift = shifts.get(`${m.name}|${formatISO(d)}`) ?? 'RD';
    return shift.startsWith('RDW ') ? { shift: 'RDW', rdwTime: shift.slice(4) } : { shift, rdwTime: '' };
};
/** A stand-in for Team View's cell: what the card is handed, recorded, so a test can see it was used. */
const cellDisplay = (/** @type {any} */ m, /** @type {Date} */ d) => {
    const { shift, rdwTime } = effectiveDay(m, d);
    return shift === 'RDW'
        ? { text: `💼 ${rdwTime || 'RDW'}`, cls: 'tv-rdw', label: `Rest Day Working${rdwTime ? ' ' + rdwTime : ''}` }
        : { text: shift, cls: 'tv-test', label: `cell ${shift}` };
};
const build = (/** @type {string} */ name = me.name, /** @type {string} */ iso = ISO, /** @type {Date} */ today = TODAY) =>
    buildOnWithCard({ onWith: { name, iso }, effectiveDay, cellDisplay, monthKey, today });
const card = () => build().html;
/** The card's sections, in order: each role's heading and the names listed under it, in order. */
const sections = (/** @type {string} */ html) => html.split('<div class="tv-onwith-group">').slice(1).map(sec => ({
    role: sec.match(/<h3 class="tv-onwith-role"[^>]*>([^<]+)</)?.[1],
    names: [...sec.split('tv-onwith-sub')[0].matchAll(/<span class="tv-onwith-name">([^<]+)</g)].map(m => m[1]),
    unknown: sec.includes('tv-onwith-sub') ? [...sec.split('tv-onwith-sub')[1].matchAll(/<span class="tv-onwith-name">([^<]+)</g)].map(m => m[1]) : [],
    html: sec,
}));
const section = (/** @type {string} */ html, /** @type {string} */ role) => /** @type {any} */ (sections(html).find(s => s.role === role));
/** The row a name heads, as markup. */
const rowOf = (/** @type {string} */ html, /** @type {string} */ name) =>
    html.match(new RegExp(`<li class="tv-onwith-row"[^>]*><span class="tv-onwith-name">${name.replace('.', '\\.')}</span>(.*?)</li>`))?.[1] ?? '';

describe('premises', () => {
    test('the roster has the members these tests need', () => {
        for (const m of [me, early, long, touching, onLeave, nightBefore, ces, ces2, leaver]) assert.ok(m, 'the roster has too few members to stage the card');
    });
});

describe('the card', () => {
    beforeEach(() => {
        _reset();
        noteKnowledge(['2026-10'], 'authoritative');   // November, by the test's own spelling (month index 10)
        shifts = new Map();
        changes = new Map();
        day(me, ISO, '14:00-22:30');
        day(early, ISO, '06:00-15:00');          // the owner's example: together 14:00–15:00
        day(long, ISO, '13:00-21:00');           // together 14:00–21:00
        day(touching, ISO, '06:00-14:00');       // hands over at 14:00: never together, and not listed
        day(onLeave, ISO, 'AL');
        day(ces, ISO, 'RDW 16:00-23:00');        // another grade, on Rest Day Working
        day(leaver, ISO, '14:00-22:00');         // hidden: never listed, whatever they are rostered
    });

    test('BY ROLE: a section per grade tab, the member\'s own first, each listing only its own role', () => {
        const all = sections(card());
        assert.deepEqual(all.map(s => s.role), ['CEA', 'CES', 'Dispatcher']);
        assert.deepEqual(section(card(), 'CEA').names, [early.name, long.name]);
        assert.deepEqual(section(card(), 'CES').names, [ces.name]);
        for (const s of all) {
            for (const n of s.names) assert.equal(teamMembers.find(m => m.name === n)?.role, s.role, `${s.role} listed somebody of another role`);
        }
        assert.doesNotMatch(card(), /tv-onwith-grade/, 'a grade tag came back on a row');
    });

    test('BY ROLE: a CES member\'s card starts with CES', () => {
        day(ces, ISO, '14:00-22:00');
        assert.deepEqual(sections(build(ces.name).html).map(s => s.role), ['CES', 'CEA', 'Dispatcher']);
        assert.deepEqual(rolesInOrder('Dispatcher'), ['Dispatcher', 'CEA', 'CES']);
        assert.deepEqual(rolesInOrder('Manager'), TEAM_GRADES, 'a role with no tab moved the tabs\' order');
    });

    test('a role with nobody on at the same time says so, calmly', () => {
        assert.match(section(card(), 'Dispatcher').html, /<p class="tv-onwith-none">Nobody on at the same time<\/p>/);
    });

    test('in order of start within a role, and the stretch together said quietly', () => {
        day(ces2, ISO, '15:00-22:00');                                   // CES at 15:00, so before the 16:00 Rest Day Working
        assert.deepEqual(section(card(), 'CES').names, [ces2.name, ces.name]);
        assert.match(rowOf(card(), early.name), /until 15:00/);
        assert.match(rowOf(card(), long.name), /until 21:00/);
        assert.match(rowOf(card(), ces.name), /from 16:00/);
        assert.match(rowOf(card(), ces2.name), /15:00–22:00/);
        assert.doesNotMatch(card(), /Together|<strong|<b>/, 'the overlap shouts again');
    });

    test('a shift is the grid\'s own cell — its tint class and text — read out by its label', () => {
        const row = rowOf(card(), ces.name);
        assert.match(row, /<span class="tv-onwith-shift tv-rdw"><span aria-hidden="true">💼 16:00-23:00<\/span><span class="visually-hidden">Rest Day Working 16:00-23:00<\/span><\/span>/);
        assert.match(card(), /<p class="tv-onwith-mine"><span id="tvOnWithWhen">Friday 27 November<\/span><span class="tv-onwith-shift tv-test">/);
    });

    test('touching ends, leave, rest, a leaver and the member themselves appear nowhere', () => {
        const html = card();
        for (const m of [touching, onLeave, leaver, me]) {
            assert.ok(!sections(html).some(s => s.names.includes(m.name) || s.unknown.includes(m.name)), `${m === me ? 'the member' : 'somebody not on with them'} was listed`);
        }
        assert.doesNotMatch(html, /not at the same time/);
        assert.ok(!colleaguesOf(me, dayOf(ISO)).includes(leaver));
        assert.ok(!colleaguesOf(me, dayOf(ISO)).includes(me), 'the member was listed as their own colleague');
    });

    test('an overnight from the day before is listed first, and says whose day it is', () => {
        day(me, ISO, '05:00-13:00');
        day(early, ISO, '04:00-12:00');
        day(nightBefore, '2026-11-26', '22:00-06:00');
        const html = card();
        assert.deepEqual(section(html, 'CEA').names.slice(0, 2), [nightBefore.name, early.name], 'yesterday\'s overnight was not first');
        const row = rowOf(html, nightBefore.name);
        assert.match(row, /<span class="tv-onwith-day">Thu<\/span> 22:00-06:00/);
        assert.match(row, /Thursday: cell 22:00-06:00/);
        assert.match(row, /until 06:00/);
    });

    test('the member\'s own overnight meets tomorrow\'s early, which says it is Saturday\'s', () => {
        day(me, ISO, '21:00-05:00');
        day(nightBefore, '2026-11-28', '04:00-12:00');
        const row = rowOf(card(), nightBefore.name);
        assert.match(row, /<span class="tv-onwith-day">Sat<\/span> 04:00-12:00/);
        assert.match(row, /from 04:00/);
    });

    test('a colleague on Training with no time of their own is on the base shift\'s hours, and together', () => {
        day(me, ISO, '07:00-15:00');
        shifts.delete(`${early.name}|${ISO}`); shifts.delete(`${long.name}|${ISO}`);
        change(touching, ISO, { type: 'other', value: 'TRG' }, '06:00-14:00');   // the cell prints 06:00-14:00
        const html = card();
        assert.ok(section(html, 'CEA').names.includes(touching.name), 'a colleague on Training over the same hours was not listed');
        assert.match(rowOf(html, touching.name), /until 14:00/);
    });

    test('the member\'s own Training day on the base shift\'s hours has a card', () => {
        change(me, ISO, { type: 'other', value: 'TRG' }, '14:00-22:30');
        const html = card();
        assert.doesNotMatch(html, /has no shift with times/);
        assert.deepEqual(section(html, 'CEA').names, [early.name, long.name]);
    });

    test('working with no times recorded is listed apart in its own role, never as on with you', () => {
        day(early, ISO, 'RDW ');                                                  // Rest Day Working, no time recorded
        change(long, ISO, { type: 'other', value: 'TRG' }, 'RD');                 // Training on a rest day, no time
        const cea = section(card(), 'CEA');
        assert.deepEqual(cea.unknown, [early.name, long.name]);
        assert.ok(!cea.names.includes(early.name) && !cea.names.includes(long.name), 'unknown times were listed as together');
        assert.match(cea.html, /<p class="tv-onwith-sub">Also working, times not recorded<\/p>/);
        assert.doesNotMatch(section(card(), 'CES').html, /times not recorded/, 'the group appeared in a role with nobody in it');
    });

    test('nobody overlapping: every role says so', () => {
        shifts = new Map();
        day(me, ISO, '14:00-22:30');
        assert.equal(sections(card()).filter(s => /Nobody on at the same time/.test(s.html)).length, 3);
    });

    test('withheld while a month it reads is still being checked — the day after, across a month end', () => {
        // 30 November: the day after is 1 December, which nobody has read.
        const { html, months } = build(me.name, '2026-11-30');
        assert.match(html, /Checking who is on/);
        assert.doesNotMatch(html, /tv-onwith-row/);
        assert.deepEqual(months, ['2026-10', '2026-11'], 'the card did not say which months it reads');
        assert.match(html, /<p class="tv-onwith-note" role="status">/, 'a check under way is a status, not an alert');
        assert.doesNotMatch(html, /tvOnWithRetry/, 'nothing has failed yet, so there is nothing to try again');
    });

    test('a month only the card reads that could not be read offers the card\'s own Try again, as an alert', () => {
        // 30 November: the day after is 1 December, outside the week's months, so the grid's Try again
        // is not on screen. Without its own the card was a dead end (28 Nov 2026).
        noteKnowledge(['2026-11'], 'error');
        const { html, months } = build(me.name, '2026-11-30');
        assert.match(html, /Couldn’t check who is on/);
        assert.match(html, /<p class="tv-onwith-note" role="alert">/, 'a failure is announced, as the grid\'s is');
        assert.match(html, /<button type="button" class="tv-retry" id="tvOnWithRetry">Try again<\/button>/);
        assert.deepEqual(months, ['2026-10', '2026-11'], 'Try again needs the months the card reads');
    });

    test('no card for nobody, and a note when the member has no shift with times', () => {
        assert.equal(buildOnWithCard({ onWith: null, effectiveDay, cellDisplay, monthKey, today: TODAY }).html, '');
        day(me, ISO, 'RD');
        assert.match(card(), /has no shift with times that day/);
        assert.equal(cardDate(dayOf(ISO)), 'Friday 27 November');
    });
});

describe('today and later only', () => {
    beforeEach(() => {
        _reset();
        noteKnowledge(['2026-10'], 'authoritative');
        shifts = new Map(); changes = new Map();
        day(me, ISO, '14:00-22:30');
        day(early, ISO, '06:00-15:00');
    });

    test('a past date draws nothing at all — no card, no months, no dates to fetch', () => {
        assert.deepEqual(build(me.name, ISO, new Date(2026, 10, 28, 0, 0)), { html: '', months: [], dates: [] });
    });

    test('today, to its last minute, and any later day draw the card', () => {
        assert.match(build(me.name, ISO, new Date(2026, 10, 27, 23, 59)).html, /tv-onwith-row/);
        assert.match(build(me.name, ISO, new Date(2026, 10, 20, 12, 0)).html, /tv-onwith-row/);
    });

    // TO THE SATURDAY ENDING THE WEEK THREE WEEKS ON, AND BOXING DAY (owner, 28 Nov 2026).
    test('the last day offered is the Saturday that ends the week three weeks on', () => {
        assert.equal(ONWITH_WEEKS_AHEAD, 3);
        const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        assert.equal(iso(lastOfferedDay(new Date(2026, 10, 28, 23, 59))), '2026-12-19', 'a Saturday ends its own week');
        assert.equal(iso(lastOfferedDay(new Date(2026, 10, 29, 0, 0))), '2026-12-26', 'from the Sunday, a new week');
        assert.equal(iso(lastOfferedDay(new Date(2026, 10, 25, 12, 0))), '2026-12-19', 'a Wednesday');
        assert.equal(iso(lastOfferedDay(new Date(2027, 2, 24, 12, 0))), '2027-04-17', 'across the clocks going forward');
    });

    test('offered from today to that Saturday, never after it — except Boxing Day', () => {
        const sat = new Date(2026, 10, 28, 9, 0);
        assert.equal(onWithOffered('2026-11-27', sat), false, 'yesterday');
        assert.equal(onWithOffered('2026-11-28', sat), true, 'today');
        assert.equal(onWithOffered('2026-12-19', sat), true, 'the last Saturday');
        assert.equal(onWithOffered('2026-12-20', sat), false, 'the Sunday after it');
        assert.equal(onWithOffered('2026-12-25', sat), false, 'Christmas Day is not the exception');
        assert.equal(onWithOffered('2026-12-26', sat), true, 'Boxing Day, beyond the three weeks');
        assert.equal(onWithOffered('2027-12-26', sat), true, 'Boxing Day next year too');
        assert.equal(onWithOffered('2025-12-26', sat), false, 'but never a Boxing Day gone past');
    });

    test('the card draws nothing for a day after the last one offered', () => {
        assert.deepEqual(build(me.name, ISO, new Date(2026, 9, 1, 12, 0)), { html: '', months: [], dates: [] },
            'four weeks before the date: not yet offered');
    });

    test('isPastDay compares local dates', () => {
        assert.equal(isPastDay('2026-11-27', new Date(2026, 10, 27, 23, 59)), false);
        assert.equal(isPastDay('2026-11-27', new Date(2026, 10, 28, 0, 0)), true);
        assert.equal(isPastDay('2026-11-28', new Date(2026, 10, 27, 0, 0)), false);
    });
});
