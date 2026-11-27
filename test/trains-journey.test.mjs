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
import { parseJourney, findStation, journey, journeyDate, timetableOn, departures, viaMatters, dayKindOf, isoDate, addDays } from '../trains-journey.js';
import { renderJourney, renderNoStation } from '../trains-render.js';
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
        const html = words(renderJourney(j, { crs: 'AYS', stations: STATIONS, asked: 'time', today: true }));
        assert.match(html, /First train to Aylesbury after 17:45 17:53 to Aylesbury , via High Wycombe Gets there at 19:16/);
        assert.match(html, /Then 17:57 to Aylesbury Vale Parkway , via Amersham Gets to Aylesbury at 18:55, before the 17:53/);
        assert.doesNotMatch(html, /18:27[^]*before the/, 'a train that gets there later says nothing of it');
    });

    test('a station only one route reaches says no route — a via-High-Wycombe train\'s code is not a route to Gerrards Cross', () => {
        assert.equal(viaMatters(TIMETABLES.now.SX.dep, 'GER'), false);
        assert.equal(viaMatters(TIMETABLES.now.SX.dep, 'AYS'), true);
        const j = ask('GER', '07:00', day(11, 27));
        assert.doesNotMatch(renderJourney(j, { crs: 'GER', stations: STATIONS, asked: 'time', today: true }), /via (High Wycombe|Amersham)/);
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
        assert.match(renderJourney(ask('BMO', '15:30', day(12, 13)), { crs: 'BMO', stations: STATIONS, asked: 'time', today: true }),
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
        const html = words(renderJourney(j, { crs: 'BCF', stations: STATIONS, asked: 'time', today: true }));
        assert.match(html, /^Saturday 12 December · Timetable until Saturday 12 December Scheduled No more trains to Beaconsfield today after 00:30\. First train tomorrow Sunday 13 December · Timetable from Sunday 13 December Scheduled 07:42 to /);
        // Asked from the clock, the sentence names no minute, so it does not change (and is not read out) each minute.
        assert.match(words(renderJourney(j, { crs: 'BCF', stations: STATIONS, asked: 'now', today: true })), /No more trains to Beaconsfield today\. First train tomorrow/);
        // On another day than today, the day is named.
        assert.match(words(renderJourney(j, { crs: 'BCF', stations: STATIONS, asked: 'time', today: false })), /on Saturday 12 December after 00:30\. First train the day after/);
    });

    test('no train either day: said, and the journey planner offered', () => {
        const none = { ...ask('BCF', '00:30', day(12, 12)) };
        none.next = { ...(/** @type {NonNullable<typeof none.next>} */ (none.next)), trains: [] };
        assert.match(renderJourney(none, { crs: 'BCF', stations: STATIONS, asked: 'time', today: true }), /None tomorrow either\. For a journey with a change of train, check <a href="https:\/\/www\.nationalrail\.co\.uk\/journey-planner\/"/);
    });

    test('the whole day, when no time is given on another day', () => {
        const j = ask('AYS', null, day(11, 28));
        assert.equal(j.trains[0].dep, departures(TIMETABLES.now.SO.dep, 'AYS', day(11, 28), '03:00')[0].dep);
        assert.match(words(renderJourney(j, { crs: 'AYS', stations: STATIONS, asked: 'day', today: false })), /^Saturday 28 November · .* First train to Aylesbury \d\d:\d\d/);
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
        const html = renderJourney(ask('AYS', '17:15', day(11, 27)), { crs: 'AYS', stations: STATIONS, asked: 'time', today: true, others: ['AVP'] });
        assert.match(html, /^<p class="tr-jr-meta"><span>Friday 27 November<\/span>.*Timetable until Saturday 12 December.*<span class="tr-jr-sched">Scheduled<\/span><\/p>/);
        assert.match(html, /<details class="tr-jr-stops"><summary>Where it stops<span class="sr-only">, the 17:30<\/span><\/summary><ol class="tr-jr-stoplist"><li><span class="tr-near-time">17:30<\/span> London Marylebone<\/li>/);
        assert.match(html, /<li class="tr-jr-here"><span class="tr-near-time">18:21<\/span> <strong>Aylesbury<\/strong>/);
        assert.match(html, /data-station="AYS"[^]*All trains to and from Aylesbury/);
        assert.match(html, /Or did you mean<\/p><button type="button" class="tr-pick" data-journey="AVP">Aylesbury Vale Parkway<\/button>/);
        assert.doesNotMatch(html, /!/, 'no exclamation marks');
    });

    test('next train, from the clock, says "Next"; a typed time says "after"', () => {
        const j = ask('AYS', '17:15', day(11, 27));
        assert.match(renderJourney(j, { crs: 'AYS', stations: STATIONS, asked: 'now', today: true }), /<p class="tr-jr-ask">Next train to Aylesbury<\/p>/);
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
