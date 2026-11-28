// @lane hygiene
/**
 * trains-journey.test.mjs — "Aylesbury, after 17:15": the Trains page's one lookup, read and answered.
 * Run with: node scripts/run-tests.mjs test/trains-journey.test.mjs   (no mocks; part of test:hygiene)
 *
 * The pure half (trains-journey.js and trains-render.js → `renderJourney`) on the REAL timetables, so a
 * regenerated `trains-data.js` that changes an answer fails here with the train named. The wiring — the box,
 * the day tabs, the clock — is e2e/trains.spec.js → "Find a train".
 *
 * The guards that matter most, each proven by deleting or inverting its line (scripts/mutate.mjs):
 *   - the time filter: a train that leaves before the time asked is never the answer;
 *   - the timetable switch: a date from 13 December is answered from the new timetable, and the day after the
 *     last train of the old one from the new one too;
 *   - the alternatives: the next two trains, in the order they leave, after the first.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseJourney, findStation, journey, journeyDate, journeyDateAt, dayWord, timetableOn, departures, viaMatters, dayKindOf, isoDate, addDays } from '../trains-journey.js';
import { renderJourney, renderNoStation, timeHint, holidayOf, DAY_WORDS } from '../trains-render.js';
import { TIMETABLES, STATIONS, CHANGE_DATE, FURTHER_CHANGES_UNTIL, DEC_VALID_UNTIL } from '../trains-data.js';

const dates = { change: CHANGE_DATE, festiveUntil: FURTHER_CHANGES_UNTIL, validUntil: DEC_VALID_UNTIL };
/** A local date at midday, as the page makes them. @param {number} m 1–12 @param {number} d */
const day = (m, d, y = 2026) => new Date(y, m - 1, d, 12);
/** @param {string} crs @param {string|null} at @param {Date} date */
const ask = (crs, at, date) => journey({ crs, at, date, timetables: TIMETABLES, dates });
const deps = (/** @type {{ dep: string }[]} */ ts) => ts.map(t => t.dep);
/** Tags out, entities in: the words a reader sees. @param {string} html */
const words = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

describe('parseJourney — a place and a time typed as one line', () => {
    test('the owner\'s example and its variants', () => {
        assert.deepEqual(parseJourney('Aylesbury, after 17:15'), { place: 'Aylesbury', timeText: '17:15', time: '17:15' });
        assert.deepEqual(parseJourney('aylesbury 5.15pm'), { place: 'aylesbury', timeText: '5.15pm', time: '17:15' });
        assert.deepEqual(parseJourney('High Wycombe'), { place: 'High Wycombe', timeText: '', time: null });
        assert.deepEqual(parseJourney('Aylesbury'), { place: 'Aylesbury', timeText: '', time: null });
    });

    test('a time alone is a time, read by the time box\'s own parser', () => {
        for (const [typed, time] of [['17:15', '17:15'], ['1715', '17:15'], ['5.15pm', '17:15'], ['5.15 pm', '17:15'], ['515', '05:15'], ['12am', '00:00']]) {
            assert.deepEqual(parseJourney(typed), { place: '', timeText: typed, time }, typed);
        }
        // Never a guess: a bare hour is no time, as it never was.
        assert.deepEqual(parseJourney('5'), { place: '', timeText: '5', time: null });
    });

    test('the joining words go from either end of the place, never from inside it', () => {
        assert.equal(parseJourney('after 5 pm to wycombe').place, 'wycombe');
        assert.equal(parseJourney('after 5 pm to wycombe').time, '17:00');
        assert.equal(parseJourney('to Harrow on the Hill at 9am').place, 'Harrow on the Hill');
        assert.equal(parseJourney('17:15 to Gerrards Cross').place, 'Gerrards Cross');
        assert.equal(parseJourney('Chalfont and Latimer, from 0800').place, 'Chalfont and Latimer');
        assert.equal(parseJourney('   ').place, '');
    });

    test('a station with a time that is not one keeps the station and says the time is unread', () => {
        assert.deepEqual(parseJourney('aylesbury 25:00'), { place: 'aylesbury', timeText: '25:00', time: null });
        assert.deepEqual(parseJourney('aylesbury 5'), { place: 'aylesbury', timeText: '5', time: null });
    });
});

describe('findStation — the Stations tab\'s own search', () => {
    test('its short forms, codes and partial names find the station', () => {
        for (const [typed, crs] of [['gerrards x', 'GER'], ['moor st', 'BMO'], ['HWY', 'HWY'], ['wycombe', 'HWY'], ['aylesbury', 'AYS'],
            ['stratford-upon-avon parkway', 'STY'], ['GERRARDS CROSS!', 'GER']]) {
            assert.equal(findStation(typed, STATIONS).crs, crs, typed);
        }
        assert.deepEqual(findStation('aylesbury', STATIONS).others, ['AVP'], 'the other Aylesbury is offered');
    });

    test('an unknown station is not guessed: it is not found, with the closest the search knows', () => {
        const slip = findStation('aylsbury', STATIONS);
        assert.equal(slip.crs, null);
        assert.ok(slip.closest.includes('AYS'), `closest: ${slip.closest}`);
        assert.deepEqual(findStation('zzzz', STATIONS), { crs: null, others: [], closest: [] });
        assert.equal(findStation('marylebone', STATIONS).crs, null, 'every train starts at Marylebone; it is never the destination');
    });
});

describe('journey — the first train there, then the next', () => {
    test('Aylesbury after 17:15 on a weekday: the 17:30 via Amersham, then the 17:41 and the 17:59', () => {
        const j = ask('AYS', '17:15', day(11, 27));     // Friday 27 November: today's timetable
        assert.deepEqual(deps(j.trains), ['17:30', '17:41', '17:59']);
        assert.deepEqual(j.trains[0], { ...j.trains[0], dep: '17:30', to: 'AVP', via: 'A', arrives: '18:21' });
        assert.equal(j.trains[1].to, 'AYS');
        assert.equal(j.via, true, 'Aylesbury is reached two ways, so the route is said');
        assert.equal(j.timetable.label, 'Timetable until Saturday 12 December');
        assert.equal(j.next, null);
    });

    test('the time filter: a train that leaves at the time asked counts, one a minute before never does', () => {
        assert.equal(ask('AYS', '17:30', day(11, 27)).trains[0].dep, '17:30');
        assert.equal(ask('AYS', '17:31', day(11, 27)).trains[0].dep, '17:41');
        // Every answer, at every minute of a weekday evening, leaves at or after the time asked, in order.
        for (let m = 0; m < 240; m += 7) {
            const at = `${String(17 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
            const got = deps(ask('HWY', at, day(11, 27)).trains);
            assert.ok(got.every(t => t >= at), `${at}: ${got}`);
            assert.deepEqual(got, [...got].sort(), `${at}: in the order they leave`);
        }
    });

    test('the trains are in the order they leave, by the railway day, whatever order the rows come in', () => {
        /** @type {import('../trains-change.js').TrainRow[]} */
        const rows = [['00:10', 'HWY', '', '', 'HWY0045'], ['18:00', 'HWY', '', '', 'HWY1830'], ['17:00', 'HWY', '', '', 'HWY1730'], ['16:00', 'OXF', '', '', 'OXF1700']];
        assert.deepEqual(deps(departures(rows, 'HWY', day(11, 28), '16:30')), ['17:00', '18:00', '00:10']);
        assert.deepEqual(departures(rows, 'HWY', day(11, 28), '23:00').map(t => `${t.dep} ${t.arrives}`), ['00:10 00:45']);
    });

    test('the next alternatives are the next trains to leave — on a Sunday, one via High Wycombe and a later one that gets there first', () => {
        const j = ask('AYS', '17:45', day(11, 29));     // Sunday 29 November
        assert.deepEqual(j.trains.map(t => `${t.dep} ${t.via} ${t.arrives}`), ['17:53 H 19:16', '17:57 A 18:55', '18:27 A 19:26']);
        const html = words(renderJourney(j, { crs: 'AYS', stations: STATIONS, asked: 'time', now: day(11, 29) }));
        assert.match(html, /First train to Aylesbury after 17:45 17:53 to Aylesbury , via High Wycombe Gets there at 19:16/);
        assert.match(html, /Then 17:57 to Aylesbury Vale Parkway , via Amersham Gets to Aylesbury at 18:55, before the 17:53/);
        assert.doesNotMatch(html, /18:27[^]*before the/, 'a train that gets there later says nothing of it');
    });

    test('a station only one route reaches says no route — a via-High-Wycombe train\'s code is not a route to Gerrards Cross', () => {
        assert.equal(viaMatters(TIMETABLES.now.SX.dep, 'GER'), false);
        assert.equal(viaMatters(TIMETABLES.now.SX.dep, 'AYS'), true);
        const j = ask('GER', '07:00', day(11, 27));
        assert.doesNotMatch(renderJourney(j, { crs: 'GER', stations: STATIONS, asked: 'time', now: day(11, 27) }), /via (High Wycombe|Amersham)/);
    });

    test('a weekday is answered from that weekday\'s trains: Banbury after 17:30 is the 17:37 on a Monday, the 17:33 on a Tuesday', () => {
        assert.equal(ask('BAN', '17:30', day(11, 30)).trains[0].dep, '17:37');   // Monday 30 November: Mondays and Fridays only
        assert.equal(ask('BAN', '17:30', day(12, 1)).trains[0].dep, '17:33');    // Tuesday 1 December: not Mondays and Fridays
    });

    test('from 13 December the new timetable answers: the Sunday 15:38 to Birmingham Moor Street is new then', () => {
        assert.equal(timetableOn(day(12, 12), dates).side, 'now');
        assert.equal(timetableOn(day(12, 13), dates).side, 'dec');
        assert.equal(timetableOn(day(12, 13), dates).label, 'Timetable from Sunday 13 December');
        assert.notEqual(ask('BMO', '15:30', day(12, 6)).trains[0].dep, '15:38', 'premise: the old Sunday has no 15:38');
        assert.equal(ask('BMO', '15:30', day(12, 13)).trains[0].dep, '15:38');
        assert.match(renderJourney(ask('BMO', '15:30', day(12, 13)), { crs: 'BMO', stations: STATIONS, asked: 'time', now: day(12, 13) }),
            /Sunday 13 December.*Timetable from Sunday 13 December.*Scheduled/);
    });

    test('past the last train: said, with the first one the next day — from the next day\'s own timetable', () => {
        // 23:59 still reaches the 00:10 (the railway day runs to 03:00).
        assert.equal(ask('BCF', '23:59', day(12, 12)).trains[0].dep, '00:10');
        const j = ask('BCF', '00:30', day(12, 12));     // Saturday 12 December, after the last train of the old timetable
        assert.deepEqual(j.trains, []);
        assert.ok(j.total > 0);
        assert.ok(j.next);
        assert.equal(isoDate(j.next.date), '2026-12-13');
        assert.equal(j.next.timetable.side, 'dec', 'the morning after is the new timetable\'s');
        assert.equal(j.next.trains[0].dep, departures(TIMETABLES.dec.SU.dep, 'BCF', day(12, 13), '03:00')[0].dep);
        const html = words(renderJourney(j, { crs: 'BCF', stations: STATIONS, asked: 'time', now: day(12, 12) }));
        assert.match(html, /^Saturday 12 December · Timetable until Saturday 12 December Scheduled No more trains to Beaconsfield today after 00:30\. First train tomorrow Sunday 13 December · Timetable from Sunday 13 December Scheduled Christmas and New Year times are not on this page\. [^]*? 07:42 to /);
        // Asked from the clock, the sentence names no minute, so it does not change (and is not read out) each minute.
        assert.match(words(renderJourney(j, { crs: 'BCF', stations: STATIONS, asked: 'now', now: day(12, 12) })), /No more trains to Beaconsfield today\. First train tomorrow/);
        // On another day than today, the day is named.
        assert.match(words(renderJourney(j, { crs: 'BCF', stations: STATIONS, asked: 'time', now: day(12, 1) })), /on Saturday 12 December after 00:30\. First train the day after/);
    });

    test('no train either day: said, and the journey planner offered', () => {
        const none = { ...ask('BCF', '00:30', day(12, 12)) };
        none.next = { ...(/** @type {NonNullable<typeof none.next>} */ (none.next)), trains: [] };
        assert.match(renderJourney(none, { crs: 'BCF', stations: STATIONS, asked: 'time', now: day(12, 12) }), /None tomorrow either\. For a journey with a change of train, check <a href="https:\/\/www\.nationalrail\.co\.uk\/journey-planner\/"/);
    });

    test('the whole day, when no time is given on another day', () => {
        const j = ask('AYS', null, day(11, 28));
        assert.equal(j.trains[0].dep, departures(TIMETABLES.now.SO.dep, 'AYS', day(11, 28), '03:00')[0].dep);
        assert.match(words(renderJourney(j, { crs: 'AYS', stations: STATIONS, asked: 'day', now: day(11, 20) })), /^Saturday 28 November · .* First train to Aylesbury \d\d:\d\d/);
    });

    test('the date asked: today while the day chosen is today\'s kind, else the next of that kind', () => {
        const fri = day(11, 27);
        assert.equal(isoDate(journeyDate(fri, 'SX')), '2026-11-27');
        assert.equal(isoDate(journeyDate(fri, 'SO')), '2026-11-28');
        assert.equal(isoDate(journeyDate(fri, 'SU')), '2026-11-29');
        assert.equal(isoDate(journeyDate(day(11, 29), 'SX')), '2026-11-30');
        assert.equal(dayKindOf(addDays(fri, 1)), 'SO');
    });
});

describe('renderJourney and renderNoStation — the words', () => {
    test('the answer names its date, its timetable and "Scheduled", and the stops are on tap', () => {
        const html = renderJourney(ask('AYS', '17:15', day(11, 27)), { crs: 'AYS', stations: STATIONS, asked: 'time', now: day(11, 27), others: ['AVP'] });
        assert.match(html, /^<p class="tr-jr-meta"><span>Friday 27 November<\/span>.*Timetable until Saturday 12 December.*<span class="tr-jr-sched">Scheduled<\/span><\/p>/);
        assert.match(html, /<details class="tr-jr-stops"><summary>Where it stops<span class="sr-only">, the 17:30<\/span><\/summary><ol class="tr-jr-stoplist"><li><span class="tr-near-time">17:30<\/span> London Marylebone<\/li>/);
        assert.match(html, /<li class="tr-jr-here"><span class="tr-near-time">18:21<\/span> <strong>Aylesbury<\/strong>/);
        assert.match(html, /data-station="AYS"[^]*All trains to and from Aylesbury/);
        assert.match(html, /Or did you mean<\/p><button type="button" class="tr-pick" data-journey="AVP">Aylesbury Vale Parkway<\/button>/);
        assert.doesNotMatch(html, /!/, 'no exclamation marks');
    });

    test('next train, from the clock, says "Next"; a typed time says "after"', () => {
        const j = ask('AYS', '17:15', day(11, 27));
        assert.match(renderJourney(j, { crs: 'AYS', stations: STATIONS, asked: 'now', now: day(11, 27) }), /<p class="tr-jr-ask">Next train to Aylesbury<\/p>/);
    });

    test('a station it cannot find: said, with the closest to choose from and how to ask', () => {
        const html = renderNoStation('aylsbury', ['AYS', 'AVP'], STATIONS);
        assert.match(html, /No station matches “aylsbury”\./);
        assert.match(html, /Closest matches<\/p><button type="button" class="tr-pick" data-journey="AYS">Aylesbury<\/button>/);
        assert.match(html, /Type a station, a time like 17:15, 1715 or 5\.15pm, or both: Aylesbury, after 17:15\./);
        assert.match(renderNoStation('<b>x</b>', [], STATIONS), /“&lt;b&gt;x&lt;\/b&gt;”/, 'what was typed is escaped');
        assert.match(renderNoStation('Marylebone', [], STATIONS), /Every train on this page leaves from London Marylebone/);
    });
});

// ── The small hours, the calendar's words, Christmas, and what the box reads (Nov 2026) ──────────────────────────
// Between 00:00 and 03:00 the railway day is still yesterday's, so a morning time typed then was answered from a day
// that had gone, and "today"/"tomorrow" counted from it. Each guard below was proven by breaking its line.

/** A local clock time. @param {number} m @param {number} d @param {number} h @param {number} [min] */
const clock = (m, d, h, min = 0, y = 2026) => new Date(y, m - 1, d, h, min);

describe('journeyDateAt — a time typed in the small hours is the next one to come', () => {
    test('01:00 on Sunday 13 December, "Aylesbury, after 08:00": Sunday\'s new-timetable trains, not Saturday\'s gone ones', () => {
        const date = journeyDateAt(clock(12, 13, 1), 'SO', '08:00');   // the page opens on Saturday's tab: it is Saturday's railway day
        assert.equal(isoDate(date), '2026-12-13');
        const j = ask('AYS', '08:00', date);
        assert.equal(j.timetable.side, 'dec');
        assert.deepEqual(deps(j.trains), ['08:53', '08:57', '09:53']);
        assert.equal(ask('AYS', '08:00', day(12, 12)).trains[0].dep, '08:27', 'premise: Saturday\'s answer is the gone 08:27');
    });

    test('every Friday night: 01:00 on a Saturday, "after 08:00" is that Saturday morning', () => {
        assert.equal(isoDate(journeyDateAt(clock(11, 28, 1), 'SX', '08:00')), '2026-11-28');
        assert.equal(isoDate(journeyDateAt(clock(11, 28, 1), 'SO', '08:00')), '2026-11-28');
        assert.equal(isoDate(journeyDateAt(clock(11, 28, 1), 'SU', '08:00')), '2026-11-29', 'another day tab still chooses its own day');
    });

    test('a small-hours time: tonight while it has not passed, this minute included; else the next night', () => {
        assert.equal(isoDate(journeyDateAt(clock(12, 13, 1), 'SO', '02:00')), '2026-12-12', 'still to come tonight');
        assert.equal(isoDate(journeyDateAt(clock(12, 13, 1), 'SO', '01:00')), '2026-12-12', 'this minute has not passed');
        assert.equal(isoDate(journeyDateAt(clock(12, 13, 1), 'SO', '00:30')), '2026-12-13', 'gone tonight: the next 00:30 is the Sunday night\'s');
    });

    test('outside the small hours, and with no time typed, nothing moves', () => {
        assert.equal(isoDate(journeyDateAt(clock(11, 27, 18), 'SX', '17:15')), '2026-11-27', 'a time gone this evening is still this evening\'s');
        assert.equal(isoDate(journeyDateAt(clock(11, 27, 3), 'SX', '02:00')), '2026-11-27');
        assert.equal(isoDate(journeyDateAt(clock(12, 13, 1), 'SO', null)), '2026-12-12', 'the next train from now is tonight\'s');
    });
});

describe('dayWord and renderJourney — "today" and "tomorrow" are the calendar\'s', () => {
    test('00:30 on Tuesday 1 December, "Aylesbury": none left tonight, and the first train is today\'s', () => {
        const now = clock(12, 1, 0, 30);
        const j = ask('AYS', '00:30', journeyDateAt(now, 'SX', null));
        assert.equal(isoDate(j.date), '2026-11-30', 'premise: the railway day is still Monday\'s');
        assert.deepEqual(j.trains, []);
        const html = words(renderJourney(j, { crs: 'AYS', stations: STATIONS, asked: 'now', now }));
        assert.match(html, /No more trains to Aylesbury tonight\. First train today Tuesday 1 December · Timetable until Saturday 12 December Scheduled 06:35 to /);
        assert.doesNotMatch(html, /tomorrow/);
    });

    test('the words: today, tomorrow and tonight by the calendar, else none', () => {
        const now = clock(12, 1, 0, 30);
        assert.equal(dayWord(day(12, 1), now), 'today');
        assert.equal(dayWord(day(12, 2), now), 'tomorrow');
        assert.equal(dayWord(day(11, 30), now), 'tonight');
        assert.equal(dayWord(day(11, 30), clock(12, 1, 9)), null, 'after 03:00 yesterday is not tonight');
        assert.equal(dayWord(day(12, 5), now), null);
    });
});

describe('renderJourney — a date Chiltern is still changing carries the page\'s Christmas line', () => {
    const line = /Christmas and New Year times are not on this page\./;
    test('Christmas Eve, 13 December and 10 January carry it; 12 December and 11 January do not', () => {
        const html = (/** @type {Date} */ d) => renderJourney(ask('AYS', '17:15', d), { crs: 'AYS', stations: STATIONS, asked: 'time', now: d });
        for (const d of [day(12, 24), day(12, 13), day(1, 10, 2027)]) assert.match(html(d), line, isoDate(d));
        for (const d of [day(12, 12), day(1, 11, 2027)]) assert.doesNotMatch(html(d), line, isoDate(d));
        assert.equal((html(day(12, 24)).match(/Christmas and New Year times/g) ?? []).length, 1, 'said once');
        assert.equal(timetableOn(day(12, 24), dates).festive, true);
    });
});

describe('parseJourney and findStation — the gaps', () => {
    test('noon, midday and midnight are times, alone or after a 12', () => {
        assert.deepEqual(parseJourney('Aylesbury noon'), { place: 'Aylesbury', timeText: 'noon', time: '12:00' });
        assert.equal(parseJourney('Aylesbury midday').time, '12:00');
        assert.equal(parseJourney('after midnight to Banbury').time, '00:00');
        assert.equal(parseJourney('Banbury after midnight').place, 'Banbury');
        assert.equal(parseJourney('Aylesbury 12 noon').time, '12:00');
        assert.equal(parseJourney('Aylesbury 3 noon').time, null, 'never a guess');
        assert.equal(parseJourney('Noonhill').place, 'Noonhill', 'a word that only starts with it is not it');
    });

    test('a name run into its time is split', () => {
        assert.deepEqual(parseJourney('Aylesbury17:15'), { place: 'Aylesbury', timeText: '17:15', time: '17:15' });
        assert.deepEqual(parseJourney('aylesbury5.15pm'), { place: 'aylesbury', timeText: '5.15pm', time: '17:15' });
    });

    test('a station\'s full name, then words the box does not read: the station, with those words said', () => {
        assert.deepEqual(findStation(parseJourney('Aylesbury tomorrow').place, STATIONS), { crs: 'AYS', others: ['AVP'], closest: [], unused: 'tomorrow' });
        const via = parseJourney('Aylesbury after 17:15 via Amersham');
        assert.equal(via.time, '17:15');
        assert.equal(findStation(via.place, STATIONS).unused, 'via Amersham');
        assert.equal(findStation('AYS tomorrow', STATIONS).crs, 'AYS');
        assert.equal(findStation('west ruislop', STATIONS).crs, null, 'only a full name: a slip is not taken for a station');
        const j = ask('AYS', null, day(11, 27));
        const html = words(renderJourney(j, { crs: 'AYS', stations: STATIONS, asked: 'day', now: day(11, 27), unused: 'tomorrow' }));
        assert.ok(html.startsWith('This box reads a station and a time, so “tomorrow” is not part of this answer. For another day, press Weekdays, Saturdays or Sundays. '
            + 'Weekdays answers for today, or the next weekday at a weekend; Saturdays and Sundays for the next one. For any other date, check the journey planner . Friday 27 November'), html);
        assert.doesNotMatch(renderJourney(j, { crs: 'AYS', stations: STATIONS, asked: 'day', now: day(11, 27) }), /This box reads/);
    });

    test('the day sentences only for words that name a day; the route sentence only where each train says its route', () => {
        const unread = (/** @type {string} */ crs, /** @type {string} */ unused) => {
            const html = words(renderJourney(ask(crs, '17:15', day(11, 27)), { crs, stations: STATIONS, asked: 'time', now: day(11, 27), unused }));
            return html.slice(0, html.indexOf('Friday 27 November'));
        };
        assert.equal(unread('AYS', 'via Amersham'), 'This box reads a station and a time, so “via Amersham” is not part of this answer. '
            + 'This answer takes trains by either route, and each one says which it takes. ');
        assert.equal(unread('GER', 'via Amersham'), 'This box reads a station and a time, so “via Amersham” is not part of this answer. ',
            'Gerrards Cross\'s trains say no route, so the sentence would not be true');
        assert.equal(unread('AYS', 'please hurry'), 'This box reads a station and a time, so “please hurry” is not part of this answer. ');
        assert.match(unread('AYS', 'on Saturday'), /For another day, press/);
        for (const w of ['tomorrow', 'Monday', 'sat', 'weekend', 'Sundays', 'thurs']) assert.match(w, DAY_WORDS, w);
        for (const w of ['via Amersham', 'Sunbury', 'satnav', 'monument']) assert.doesNotMatch(w, DAY_WORDS, w);
    });
});

describe('renderJourney — 25 and 26 December are an ordinary day\'s trains, never "Scheduled"', () => {
    const html = (/** @type {Date} */ d) => renderJourney(ask('AYS', '08:00', d), { crs: 'AYS', stations: STATIONS, asked: 'time', now: d });
    test('Christmas Day: no "Scheduled", and the ordinary Friday said first, with the planner', () => {
        const h = html(day(12, 25));
        assert.doesNotMatch(h, /Scheduled/);
        assert.match(words(h), /^Friday 25 December · Timetable from Sunday 13 December Christmas Day’s trains are not on this page — these are an ordinary Friday’s\. Check the journey planner \. Christmas and New Year times are not on this page\.[^]* First train to Aylesbury after 08:00 08:27 /);
        assert.match(h, /Check <a href="https:\/\/www\.nationalrail\.co\.uk\/journey-planner\/"/);
    });
    test('Boxing Day the same, as an ordinary Saturday; Christmas Eve and 27 December keep "Scheduled"', () => {
        assert.match(words(html(day(12, 26))), /Boxing Day’s trains are not on this page — these are an ordinary Saturday’s\./);
        assert.doesNotMatch(html(day(12, 26)), /Scheduled/);
        for (const d of [day(12, 24), day(12, 27)]) {
            assert.match(html(d), /<span class="tr-jr-sched">Scheduled<\/span>/, isoDate(d));
            assert.doesNotMatch(html(d), /trains are not on this page —/, isoDate(d));
        }
        assert.equal(holidayOf(day(12, 25)), 'Christmas Day');
        assert.equal(holidayOf(day(1, 25, 2027)), null);
    });
    test('the next day\'s first train, when it is Christmas Day, is said the same way', () => {
        // A station with no train left after 23:00 on Christmas Eve, so the answer is the next day's first.
        const crs = Object.keys(STATIONS).find(c => { const j = ask(c, '23:00', day(12, 24)); return !j.trains.length && j.next?.trains.length; });
        assert.ok(crs, 'premise: some station has no train after 23:00');
        const h = renderJourney(ask(/** @type {string} */ (crs), '23:00', day(12, 24)), { crs: /** @type {string} */ (crs), stations: STATIONS, asked: 'time', now: day(12, 24) });
        assert.match(words(h), /First train tomorrow Friday 25 December · Timetable from Sunday 13 December Christmas Day’s trains are not on this page/);
        assert.equal((h.match(/class="tr-jr-sched"/g) ?? []).length, 1, 'Christmas Eve\'s own line keeps it; the 25th\'s does not');
        assert.equal((h.match(/Scheduled means/g) ?? []).length, 0, 'the note about the word goes with it');
    });
});

describe('timeHint — a time the box cannot read', () => {
    test('a bare hour says why, and the ways to write it; anything else, the example', () => {
        const w = (/** @type {string} */ t) => words(timeHint(t));
        assert.equal(w('9'), '“9” is not a time this box reads — add the minutes or am/pm: 09:00, 9am or 9pm.');
        assert.equal(w('12'), '“12” is not a time this box reads — add the minutes or am/pm: 12:00, 12am or 12pm.');
        assert.equal(w('17'), '“17” is not a time this box reads — add the minutes: 17:00.');
        for (const t of ['25:00', '0', '24', '99', '5.7', '']) assert.equal(w(t), 'Type a time like 17:15, 1715 or 5.15pm.', t);
        assert.equal(parseJourney('Gerrards Cross for 9').timeText, '9', 'the station\'s time, as the box passes it');
    });
});
