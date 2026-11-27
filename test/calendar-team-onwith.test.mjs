// @ts-check
// @lane hygiene
/**
 * calendar-team-onwith.test.mjs — Team View's "On with" card (calendar-team-onwith.js), EXECUTED against
 * the real roster with a hand-made day for each member. team-overlap.test.mjs proves the arithmetic; this
 * proves what reaches the card: who is listed and in what order, who never is (a leaver, somebody on leave
 * or resting), whose day a neighbouring overnight is, the grade shown only across grades, and the wait
 * while a month it reads is still being checked. Part of test:hygiene.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { teamMembers, TEAM_GRADES } from '../roster-data.js';
import { buildOnWithCard, colleaguesOf, dayOf, cardDate } from '../calendar-team-onwith.js';
import { noteKnowledge, _reset } from '../calendar-data-state.js';
import { formatISO } from '../roster-data.js';

const ISO = '2026-11-27';                       // a Friday
const monthKey = (/** @type {number} */ y, /** @type {number} */ m) => `${y}-${m}`;
const current = (/** @type {string} */ grade) => teamMembers.filter(m => !m.hidden && m.role === grade
    && !(m.startDate && m.startDate > dayOf(ISO, -1)));
const [me, early, long, touching, onLeave, nightBefore] = current('CEA');
const ces = current('CES')[0];
const leaver = teamMembers.find(m => m.hidden && TEAM_GRADES.includes(m.role));

/** @type {Map<string, string>} "name|iso" → the shift that day; anything absent is a rest day */
let shifts = new Map();
const day = (/** @type {any} */ m, /** @type {string} */ iso, /** @type {string} */ shift) => shifts.set(`${m.name}|${iso}`, shift);
const effectiveDay = (/** @type {any} */ m, /** @type {Date} */ d) => {
    const shift = shifts.get(`${m.name}|${formatISO(d)}`) ?? 'RD';
    return shift.startsWith('RDW ') ? { shift: 'RDW', rdwTime: shift.slice(4) } : { shift, rdwTime: '' };
};
const card = () => buildOnWithCard({ onWith: { name: me.name, iso: ISO }, effectiveDay, monthKey }).html;
/** The names in the card's list, in order. */
const listed = (/** @type {string} */ html) => [...html.matchAll(/<span class="tv-onwith-name">([^<]+)</g)].map(m => m[1]);

describe('premises', () => {
    test('the roster has the members these tests need', () => {
        for (const m of [me, early, long, touching, onLeave, nightBefore, ces, leaver]) assert.ok(m, 'the roster has too few members to stage the card');
    });
});

describe('the card', () => {
    beforeEach(() => {
        _reset();
        noteKnowledge(['2026-10'], 'authoritative');   // November, by the test's own spelling (month index 10)
        shifts = new Map();
        day(me, ISO, '14:00-22:30');
        day(early, ISO, '06:00-15:00');          // the owner's example: together 14:00–15:00
        day(long, ISO, '13:00-21:00');           // together 7 hours: first
        day(touching, ISO, '06:00-14:00');       // hands over at 14:00: also working, never together
        day(onLeave, ISO, 'AL');
        day(ces, ISO, 'RDW 16:00-23:00');        // another grade, on Rest Day Working: 6½ hours, second
        day(leaver, ISO, '14:00-22:00');         // hidden: never listed, whatever they are rostered
    });

    test('lists the overlaps longest first, each with "Together", under a dated heading', () => {
        const html = card();
        assert.match(html, new RegExp(`On with ${me.name} · Friday 27 November`));
        assert.deepEqual(listed(html), [long.name, ces.name, early.name]);
        assert.match(html, /Together 14:00–15:00/);
        assert.match(html, /Together 14:00–21:00/);
    });

    test('a colleague on another grade shows it, one on the same grade does not', () => {
        const html = card();
        assert.match(html, new RegExp(`${ces.name}<span class="tv-onwith-grade">CES</span>`));
        assert.doesNotMatch(html, new RegExp(`${early.name}<span class="tv-onwith-grade">`));
        assert.match(html, /Rest Day Working 16:00–23:00/);
    });

    test('touching ends are "also working", and leave, rest and a leaver appear nowhere', () => {
        const html = card();
        assert.match(html, new RegExp(`Also working that day, not at the same time:.*${touching.name}`));
        assert.doesNotMatch(html, new RegExp(onLeave.name.replace('.', '\\.')), 'somebody on leave was listed');
        assert.doesNotMatch(html, new RegExp(leaver.name.replace('.', '\\.')), 'a leaver was listed');
        assert.ok(!colleaguesOf(me, dayOf(ISO)).includes(leaver));
        assert.ok(!colleaguesOf(me, dayOf(ISO)).includes(me), 'the member was listed as their own colleague');
    });

    test('an overnight from the day before is listed, and says whose day it is', () => {
        day(me, ISO, '05:00-13:00');
        day(nightBefore, '2026-11-26', '22:00-06:00');
        const html = card();
        assert.ok(listed(html).includes(nightBefore.name), 'the previous night\'s shift was not read');
        assert.match(html, /22:00–06:00 <span class="tv-onwith-when">from Thursday<\/span>/);
        assert.match(html, /Together 05:00–06:00/);
    });

    test('the member\'s own overnight meets tomorrow\'s early, which says it is Saturday\'s', () => {
        day(me, ISO, '21:00-05:00');
        day(nightBefore, '2026-11-28', '04:00-12:00');
        const html = card();
        assert.match(html, /04:00–12:00 <span class="tv-onwith-when">on Saturday<\/span>/);
        assert.match(html, /Together 04:00–05:00/);
    });

    test('nobody overlapping: one calm line says so', () => {
        shifts = new Map();
        day(me, ISO, '14:00-22:30');
        assert.match(card(), new RegExp(`Nobody else is on at the same time as ${me.name}\\.`));
    });

    test('withheld while a month it reads is still being checked — the day after, across a month end', () => {
        // 30 November: the day after is 1 December, which nobody has read.
        const html = buildOnWithCard({ onWith: { name: me.name, iso: '2026-11-30' }, effectiveDay, monthKey }).html;
        assert.match(html, /Checking who is on/);
        assert.doesNotMatch(html, /Together/);
        const { months } = buildOnWithCard({ onWith: { name: me.name, iso: '2026-11-30' }, effectiveDay, monthKey });
        assert.deepEqual(months, ['2026-10', '2026-11'], 'the card did not say which months it reads');
    });

    test('no card for nobody, and a note when the member has no shift with times', () => {
        assert.equal(buildOnWithCard({ onWith: null, effectiveDay, monthKey }).html, '');
        day(me, ISO, 'RD');
        assert.match(card(), /has no shift with times on Friday 27 November/);
        assert.equal(cardDate(dayOf(ISO)), 'Friday 27 November');
    });
});
