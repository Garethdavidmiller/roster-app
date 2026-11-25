// @lane hygiene
/**
 * trains-stations.test.mjs — the Trains page seen from a station, and the words it shows.
 * Run with: node scripts/run-tests.mjs test/trains-stations.test.mjs   (no mocks; part of test:hygiene)
 *
 * The rule that matters most is the one that keeps the page honest when December's stops are
 * missing: a December figure is shown for a station only when it can be KNOWN without them. A short
 * count presented as the service is the failure this exists to prevent. Since v24.80 the real
 * tables come from Chiltern's December books and carry every stop, so the rule is pinned on
 * hand-made rows — the shape a stopless source (the simplifier) would take — and the real tables
 * are pinned to answering every station in full.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    parseStops, stopsKnown, callsOf, lineOf, callingAt, knowableWithoutStops, decemberKnown, summarise,
    stationView, busiestStations, matchStations, stoppingGrid, orderStations, pairColumns,
    boardingTime, stationTrains, stopChanges, stationBands,
} from '../trains-stations.js';
import { aRealDay, runsOn, onWeekday, weekdayGroups, weekdayWords, daysCode, WEEKDAYS, REAL_DAY } from '../trains-weekdays.js';
import { verdictFor, minutesWords, hourWords, hourNote, rateWords, balanceFacts, EDGE_SHIFT_MIN, JOURNEY_SHIFT_MIN } from '../trains-verdict.js';
import { headlineChanges } from '../trains-headlines.js';
import { renderHeadlines, renderStation, renderGrid, endWords, renderLookup, renderTotals, renderLastTrains, renderPicks,
    leadWords, changesTitle, renderFurtherChanges, SIGN_IN_ABOUT, HEADLINES_SHOWN, partialStopsNote } from '../trains-render.js';
import { changeLabel, timetablePhase, dateWords, JOURNEY_PLANNER_URL, daysLabel, serviceMinutes, parseTypedTime } from '../trains-change.js';
import { CARD_TIPS } from '../trains-tips.js';
import { lastTrains } from '../trains-stations.js';
import { TIMETABLES, STATIONS, STATION_ORDER, CHANGE_DATE, FURTHER_CHANGES_UNTIL, DEC_VALID_UNTIL } from '../trains-data.js';

// Tests live in test/ but address files from the repository root (moved 24 Nov 2026).
const REPO_ROOT_URL = new URL('../', import.meta.url);

/** @returns {[string,string,string,string,string]} */
const row = (/** @type {string} */ t, st = 'OXF', via = '', days = '', stops = '') => [t, st, via, days, stops];
/** Every hour from 10 to 15 at minute `m`, ending at `st`, calling at `stops` (CRS list, times invented). */
const hourly = (/** @type {number} */ m, /** @type {string} */ st, /** @type {string[]} */ stops = []) =>
    [10, 11, 12, 13, 14, 15].map(h => row(`${h}:${String(m).padStart(2, '0')}`, st, '', '',
        stops.map((c, i) => `${c}${String(h).padStart(2, '0')}${String(Math.min(59, m + 10 * (i + 1))).padStart(2, '0')}`).join(' ')));

describe('stops — what a row says about where it calls', () => {
    test('parseStops reads CRS+HHMM pairs; an empty field is "not known", never "no stops"', () => {
        const r = row('10:06', 'OXF', '', '', 'HWY1035 OXF1112');
        assert.deepEqual(parseStops(r), [{ crs: 'HWY', time: '10:35' }, { crs: 'OXF', time: '11:12' }]);
        assert.equal(stopsKnown(r), true);
        assert.deepEqual(parseStops(row('10:06')), []);
        assert.equal(stopsKnown(row('10:06')), false);
    });

    test('without stops, a train calls only where it ends — or along the line it runs on past', () => {
        assert.deepEqual(callsOf(row('10:06', 'OXF')), ['OXF']);
        // Owner fact: Snow Hill and Stourbridge trains are Moor Street trains run on.
        assert.deepEqual(callsOf(row('10:36', 'BSW')), ['BMO', 'BSW']);
        assert.deepEqual(callsOf(row('10:36', 'SBJ')), ['BMO', 'BSW', 'SBJ']);
        // ...and Aylesbury Vale Parkway trains are Aylesbury trains via Amersham run on.
        assert.deepEqual(callsOf(row('10:57', 'AVP')), ['AYS', 'AVP']);
        assert.ok(lineOf('BSW') && lineOf('BSW') === lineOf('SBJ'));
        assert.equal(lineOf('GER'), undefined);
    });

    test('callingAt uses the known stops when there are any', () => {
        const rows = [row('10:06', 'OXF', '', '', 'GER1028 OXF1112'), row('10:10', 'HWY', '', '', 'HWY1045')];
        assert.deepEqual(callingAt(rows, 'GER').map(r => r[0]), ['10:06']);
    });
});

describe('knowing December without its stops', () => {
    test('a station is knowable only when every train calling there today ends there or further along its line', () => {
        const now = [row('10:36', 'BSW', '', '', 'HWY1100 BMO1215 BSW1220'), row('11:02', 'BMO', '', '', 'HWY1130 BMO1240')];
        assert.equal(knowableWithoutStops(now, 'BMO'), true);
        // High Wycombe is passed by trains ending elsewhere: counting only December trains that END
        // there would undercount it, so it is not knowable.
        assert.equal(knowableWithoutStops(now, 'HWY'), false);
    });

    test('once every December row carries its stops, every station is known', () => {
        const now = [row('10:06', 'OXF', '', '', 'GER1028 OXF1112')];
        assert.equal(decemberKnown(now, [row('10:08')], 'GER'), false);
        assert.equal(decemberKnown(now, [row('10:08', 'OXF', '', '', 'GER1030 OXF1114')], 'GER'), true);
    });

    test('without December\'s stops, a station trains run through compares the trains that END there', () => {
        // The simplifier, December's source before Chiltern's books, held no stops. High Wycombe is
        // passed by the Oxford train, so the whole station cannot be answered — but the trains that
        // end there can, and are (v24.77; v24.74 hid them, and the owner asked where Oxford's went).
        const now = [row('09:00', 'HWY', '', '', 'HWY0930'), row('10:00', 'HWY', '', '', 'HWY1030'), row('10:06', 'OXF', '', '', 'HWY1035 OXF1112')];
        const dec = [row('09:00', 'HWY'), row('10:00', 'HWY'), row('11:00', 'HWY'), row('10:06', 'OXF')];
        const hwy = stationView(now, dec, 'HWY', 'dep');
        assert.equal(hwy.dec, null);
        assert.equal(hwy.trains, null);
        assert.ok(hwy.ending);
        assert.deepEqual([hwy.ending.now.total, hwy.ending.dec.total, hwy.ending.through], [2, 3, 1]);
        assert.equal(hwy.verdict.text, '1 more train a day: 3, was 2.');
        // A station every train runs through, with nothing ending there, waits.
        const ger = stationView([row('10:06', 'OXF', '', '', 'GER1028 OXF1112')], [row('10:08', 'OXF')], 'GER', 'dep');
        assert.equal(ger.ending, null);
        assert.equal(ger.verdict.tone, 'unknown');
    });

    test('the real tables: Chiltern\'s December books carry every stop, so every station is answered in full', () => {
        for (const day of /** @type {const} */ (['SX', 'SO', 'SU'])) for (const dir of /** @type {const} */ (['dep', 'arr'])) {
            const now = TIMETABLES.now[day][dir], dec = TIMETABLES.dec[day][dir];
            for (const crs of new Set([...now, ...dec].flatMap(callsOf))) {
                const v = stationView(now, dec, crs, dir);
                assert.ok(v.dec && v.trains && !v.ending && v.verdict.tone !== 'unknown', `${day} ${dir} ${crs}`);
            }
        }
        // Oxford: v24.77 could compare only the trains that END there (35, then 36). With the stops,
        // the train that runs through to Banbury is counted too.
        assert.equal(stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'OXF', 'dep').verdict.text, '1 more train a day: 37, was 36.');
    });
});

describe('summarise — one station in numbers people already use', () => {
    test('counts, the daytime hour, minutes past the hour, journey, first and last', () => {
        const rows = [...hourly(6, 'OXF', ['GER', 'OXF']), ...hourly(40, 'OXF', ['OXF']), row('05:54', 'OXF', '', '', 'GER0620 OXF0700'), row('00:10', 'OXF', '', '', 'OXF0105')];
        const s = summarise(rows, 'OXF', 'dep');
        assert.equal(s.total, 14);
        assert.deepEqual(s.hourCounts, [2, 2, 2, 2, 2, 2]);
        assert.equal(s.daytime, 12);
        assert.deepEqual(s.hourRange, [2, 2]);
        assert.equal(s.typical, 2);
        assert.deepEqual(s.minutes, [6, 40]);
        assert.equal(s.first, '05:54');
        assert.equal(s.last, '00:10', 'the railway day ends after midnight');
        assert.equal(s.fastest, 10, 'the 10:40 reaches Oxford at 10:50');
        assert.equal(summarise(rows, 'GER', 'dep').total, 7);
    });

    test('no known stop times means no journey figure, never a guess', () => {
        assert.equal(summarise(hourly(6, 'OXF'), 'OXF', 'dep').fastest, null);
    });

    test('coming back measures the journey the other way', () => {
        const rows = [row('11:00', 'OXF', '', '', 'OXF1000 GER1035')];
        assert.equal(summarise(rows, 'OXF', 'arr').fastest, 60);
    });

    test('coming back, every time is when the train leaves THAT station (v24.83)', () => {
        const rows = [row('11:00', 'OXF', '', '', 'OXF1000 GER1035')];
        assert.equal(boardingTime(rows[0], 'GER', 'arr'), '10:35');
        assert.equal(boardingTime(rows[0], 'GER', 'dep'), '11:00', 'going there, it is Marylebone');
        assert.equal(boardingTime(row('11:00', 'OXF'), 'GER', 'arr'), '11:00', 'no stops known: Marylebone, never a guess');
        const s = summarise(rows, 'GER', 'arr');
        assert.deepEqual([s.first, s.last, s.minutes], ['10:35', '10:35', []]);
        // Hours are the station's: a train leaving Gerrards Cross at 09:58 is not a 10:00-hour train.
        assert.equal(summarise([row('10:20', 'OXF', '', '', 'OXF0900 GER0958')], 'GER', 'arr').daytime, 0);
    });

    test('one real day: a weekday counts a Tuesday to Thursday, never a train and its Monday-and-Friday twin (v24.83)', () => {
        const rows = [row('17:33', 'BSW', '', 'MFX', 'BAN1841 BSW1939'), row('17:37', 'BSW', '', 'MFO', 'BAN1841 BSW1939'), row('18:00', 'BSW', '', '', 'BAN1900 BSW2000')];
        assert.deepEqual(aRealDay(rows).map(r => r[0]), ['17:33', '18:00']);
        assert.equal(summarise(rows, 'BAN', 'dep').total, 2);
    });

    test('a typical hour is one MOST hours share — never a tie broken upwards (v24.83)', () => {
        const at = (/** @type {number[]} */ counts) => counts.flatMap((n, i) => Array.from({ length: n }, (_, k) => row(`${10 + i}:${String(5 + 20 * k).padStart(2, '0')}`, 'OXF', '', '', `OXF${10 + i}50`)));
        assert.equal(summarise(at([3, 3, 2, 2, 1, 1]), 'OXF', 'dep').typical, null);
        assert.equal(summarise(at([2, 2, 2, 2, 1, 1]), 'OXF', 'dep').typical, 2);
        assert.equal(summarise(at([1, 0, 1, 0, 1, 0]), 'OXF', 'dep').typical, null);
    });
});

describe('verdictFor — the one sentence', () => {
    const s = (/** @type {Partial<import('./trains-stations.js').StationSummary>} */ o) =>
        ({ total: 10, hourCounts: [2, 2, 2, 2, 2, 2], daytime: 12, hourRange: /** @type {[number, number]} */ ([2, 2]), typical: 2, minutes: [6, 36], fastest: null, first: '06:00', last: '23:00', ...o });
    test('waiting, new, gone, more an hour, fewer an hour, more a day, moved, the same', () => {
        assert.equal(verdictFor(s({}), null, null).tone, 'unknown');
        assert.equal(verdictFor(s({ total: 0 }), s({}), []).text, 'New from 13 December: 10 direct trains a day.');
        assert.equal(verdictFor(s({ total: 0 }), s({ total: 1, first: '09:31' }), []).text, 'New from 13 December: one direct train, the 09:31.');
        // Never "No direct trains from 13 December": coming back, "trains from" names a station (Trains review, Nov 2026).
        assert.equal(verdictFor(s({}), s({ total: 0 }), []).text, 'From 13 December, no direct trains on this day.');
        assert.equal(verdictFor(s({}), s({ total: 0 }), [], 'arr', { started: true }).text, 'No direct trains on this day since 13 December.');
        assert.equal(verdictFor(s({}), s({ typical: 3, hourRange: [3, 3], daytime: 18 }), []).text, 'More trains in the daytime: 3 an hour, was 2.');
        assert.equal(verdictFor(s({}), s({ typical: 1, hourRange: [1, 1], daytime: 6 }), []).text, 'Fewer trains in the daytime: 1 an hour, was 2.');
        // Saturday Moor Street: most hours one train today, most hours two in December, both with exceptions.
        assert.equal(verdictFor(s({ typical: 1, hourRange: [1, 2], daytime: 8 }), s({ typical: 2, hourRange: [1, 2], total: 14, daytime: 11 }), []).text,
            'More trains in the daytime: usually 2 an hour, was usually 1.');
        // No count most hours share: the range is the answer (v24.83 — a tie broken upwards said "usually 3").
        assert.equal(verdictFor(s({}), s({ typical: null, hourRange: [1, 3], daytime: 14 }), []).text, 'More trains in the daytime: 1 to 3 an hour, was 2.');
        // The colour can never say "more" of fewer trains: a typical hour up with the daytime total down is no hour claim.
        assert.doesNotMatch(verdictFor(s({ typical: 2, hourRange: [2, 5], daytime: 15 }), s({ typical: 3, hourRange: [1, 3], daytime: 14 }), []).text, /daytime/);
        assert.equal(verdictFor(s({}), s({ total: 15 }), []).text, '5 more trains a day: 15, was 10.');
        assert.equal(verdictFor(s({}), s({ total: 11, minutes: [10, 40] }), []).text, '1 more train a day: 11, was 10.', 'never "same number" when one more');
        assert.equal(verdictFor(s({ typical: 0, hourRange: [0, 0] }), s({ typical: 0, hourRange: [0, 0], total: 12 }), []).text, '2 more trains a day: 12, was 10.', 'no daytime claim for a station with no daytime trains');
        assert.equal(verdictFor(s({ typical: 2, hourRange: [1, 2] }), s({ total: 15 }), []).text, '5 more trains a day: 15, was 10.', 'a typical hour that stays 2 is not a daytime change, however the exceptions fill in');
        assert.equal(verdictFor(s({}), s({ minutes: [10, 40] }), []).text, 'Same number of trains a day. In the daytime they leave at :10 and :40 past the hour, was :06 and :36.');
        // Weekday Beaconsfield, coming back: December's :13 is :10 in two hours of six, so it stops
        // "repeating" — but nothing went. Never "from :13 and :39 to :39" of three trains an hour.
        assert.equal(verdictFor(s({ minutes: [13, 39] }), s({ minutes: [39] }), [/** @type {any} */ ({ kind: 'earlier', now: '10:13', dec: '10:10' })]).text,
            'Same number of trains a day, but 1 is different — see Train by train below.');
        assert.equal(verdictFor(s({}), s({}), []).text, 'No change.');
        // A stop moved from one train to another is ONE of the day's trains different, not two (Trains review,
        // Nov 2026: "11 are different" at Kings Sutton, of 10): the train that stops calling is not counted.
        assert.equal(verdictFor(s({}), s({}), /** @type {any} */ ([{ kind: 'passes', now: '10:06', dec: null, days: '' },
            { kind: 'calls', now: null, dec: '10:36', days: '' }])).text, 'Same number of trains a day, but 1 is different — see Train by train below.');
        assert.equal(verdictFor(s({}), s({}), [/** @type {any} */ ({ kind: 'later', now: '10:06', dec: '10:10' })]).text, 'Same number of trains a day, but 1 is different — see Train by train below.');
        // Leaving on time but getting there later is a change: "No change." sat above "159 → 164 min".
        assert.equal(verdictFor(s({}), s({}), [/** @type {any} */ ({ kind: 'same', farShift: 5, now: '10:06', dec: '10:06' })]).text, 'Same number of trains a day, but 1 is different — see Train by train below.');
    });

    test('no train either side is not "No change." (v24.83)', () => {
        assert.equal(verdictFor(s({ total: 0 }), s({ total: 0 }), [], 'dep').text, 'No direct trains from Marylebone on this day, now or from 13 December.');
        assert.equal(verdictFor(s({ total: 0 }), s({ total: 0 }), [], 'arr').text, 'No direct trains to Marylebone on this day, now or from 13 December.');
        const sud = stationView(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep, 'SUD', 'dep');
        assert.equal(renderStation(sud, { stations: STATIONS, dir: 'dep', showTrains: false }),
            '<p class="tr-verdict tr-verdict--same">No direct trains from Marylebone on this day, now or from 13 December.</p>'
            // …and the next step, which a "No direct trains" answer left out (words review, Nov 2026).
            + `<p class="card-explainer tr-note">For a journey with a change of train, check <a href="${JOURNEY_PLANNER_URL}" target="_blank" rel="noopener noreferrer">the journey planner</a>.</p>`,
            'no table of noughts, no train list');
        assert.doesNotMatch(renderStation(sud, { stations: STATIONS, dir: 'dep', showTrains: false, ended: true }), /For a journey with a change/, 'once ended, the ended note already links the planner');
    });
});

describe('finding a station', () => {
    test('trains an hour read as the typical hour, with the exception in brackets — or the range when there is none', () => {
        const w = (/** @type {number|null} */ t, /** @type {number[]} */ c) =>
            hourWords(/** @type {any} */ ({ typical: t, hourCounts: c, hourRange: [Math.min(...c), Math.max(...c)] }));
        assert.equal(w(2, [2, 2, 2, 2, 2, 2]), '2');
        assert.equal(w(2, [2, 2, 2, 2, 1, 1]), '2 (1 in some hours)');
        assert.equal(w(2, [2, 2, 2, 2, 2, 1]), '2 (1 in one hour)');
        assert.equal(w(1, [1, 1, 1, 1, 2, 2]), '1 (2 in some hours)');
        // Each unusual count is named: a range put the typical inside its own exception, and hid a 5 in
        // "4 (6 in some hours)" (Trains review, Nov 2026).
        assert.equal(w(2, [2, 2, 2, 2, 1, 3]), '2 (1 or 3 in some hours)');
        assert.equal(w(4, [6, 4, 4, 4, 4, 5]), '4 (5 or 6 in some hours)');
        assert.equal(w(1, [3, 1, 1, 2, 1, 1]), '1 (2 or 3 in some hours)');
        assert.equal(w(3, [3, 3, 3, 0, 1, 5]), '3 (none, 1 or 5 in some hours)');
        assert.equal(w(1, [1, 1, 1, 1, 0, 0]), '1 (none in some hours)');
        assert.equal(w(null, [3, 3, 2, 2, 1, 1]), '1 to 3');
        assert.equal(w(null, [1, 0, 1, 0, 1, 0]), '1 every 2 hours');
        assert.equal(w(0, [0, 0, 0, 0, 0, 0]), '0');
        assert.equal(hourNote(/** @type {any} */ ({ typical: 2, hourCounts: [2, 2, 2, 2, 1, 1], hourRange: [1, 2] })), '1 in some hours');
        assert.equal(hourNote(/** @type {any} */ ({ typical: 2, hourCounts: [2, 2, 2, 2, 2, 2], hourRange: [2, 2] })), '');
        assert.equal(hourNote(/** @type {any} */ ({ typical: null, hourCounts: [3, 3, 2, 2, 1, 1], hourRange: [1, 3] })), '');
    });

    test('the daytime service in a sentence (v24.83)', () => {
        const r = (/** @type {number|null} */ t, /** @type {[number, number]} */ range, short = false) => rateWords(/** @type {any} */ ({ typical: t, hourRange: range }), { short });
        assert.equal(r(2, [2, 2]), '2 an hour');
        assert.equal(r(2, [1, 2]), 'usually 2 an hour');
        assert.equal(r(2, [1, 2], true), 'usually 2');
        assert.equal(r(null, [1, 3]), '1 to 3 an hour');
        assert.equal(r(null, [0, 1]), 'about 1 every 2 hours');
        assert.equal(r(0, [0, 0]), 'none in the daytime');
    });

    test('minutes past the hour read as a person says them', () => {
        assert.equal(minutesWords([27]), ':27');
        assert.equal(minutesWords([27, 57]), ':27 and :57');
        assert.equal(minutesWords([6, 10, 40]), ':06, :10 and :40');
        assert.equal(minutesWords([]), '');
    });

    test('typing matches the start of a word before anywhere, and never offers Marylebone', () => {
        const st = { MYB: 'London Marylebone', GER: 'Gerrards Cross', HWY: 'High Wycombe', AYS: 'Aylesbury', AVP: 'Aylesbury Vale Parkway' };
        assert.deepEqual(matchStations(st, 'wyc'), ['HWY']);
        assert.deepEqual(matchStations(st, 'ayl'), ['AYS', 'AVP']);
        assert.deepEqual(matchStations(st, 'lon'), []);
        assert.deepEqual(matchStations(st, '  '), []);
        assert.deepEqual(matchStations(st, 'ger'), ['GER'], 'its code works too');
    });

    // Whole-app review, Oct 2026: the timetable prints "Stratford Parkway", and National Rail and the
    // Rangers guide say "Stratford-upon-Avon Parkway" — typing the full name found nothing.
    test('a station\'s other name finds it, and the printed name is still the one offered', () => {
        assert.equal(STATIONS.STY, 'Stratford Parkway', 'the printed name is unchanged');
        assert.equal(matchStations(STATIONS, 'Stratford-upon-Avon Parkway')[0], 'STY');
        assert.equal(matchStations(STATIONS, 'stratford upon avon parkway')[0], 'STY');
        assert.ok(matchStations(STATIONS, 'stratford-upon-avon').includes('STY'), 'and the Parkway is offered beside the town');
        assert.ok(matchStations(STATIONS, 'stratford-upon-avon').includes('SAV'));
    });

    test('typing the way people say a station: short forms, word order, initials, codes (v24.79)', () => {
        const m = (/** @type {string} */ q) => matchStations(STATIONS, q);
        assert.deepEqual(m('moor st'), ['BMO']);
        assert.deepEqual(m('gerrards x'), ['GER']);
        assert.deepEqual(m('oxford pkwy'), ['OXP']);
        assert.deepEqual(m('bham'), ['BMO', 'BSW']);
        assert.deepEqual(m('stourbridge jn'), ['SBJ']);
        assert.deepEqual(m('w ruislip'), ['WRU']);
        assert.deepEqual(m('chalfont latimer'), ['CFO']);
        assert.deepEqual(m('chalfont & latimer'), ['CFO']);
        assert.deepEqual(m('thame'), ['HDM']);
        assert.deepEqual(m('bicester'), ['BCS', 'BIT']);
        assert.deepEqual(m('hw'), ['HWY'], 'initials');
        assert.deepEqual(m('gx'), ['GER'], 'initials with a short form');
        assert.deepEqual(m('oxf'), ['OXF', 'OXP'], 'the code first, then the names');
        assert.deepEqual(m('ruis'), ['SRU', 'WRU']);
        assert.deepEqual(m('london'), [], 'never Marylebone');
    });

    test('codes, run-together names and more short forms (v24.83)', () => {
        const m = (/** @type {string} */ q) => matchStations(STATIONS, q);
        // A code that is not also the start of the name: the tips promise "the three-letter code".
        assert.deepEqual(m('amr').slice(0, 1), ['AMR']);
        assert.deepEqual(m('bcf').slice(0, 1), ['BCF']);
        assert.deepEqual(m('hwy').slice(0, 1), ['HWY']);
        assert.deepEqual(m('gt missenden'), ['GMN']);
        assert.deepEqual(m('snowhill'), ['BSW']);
        assert.deepEqual(m('moorst'), ['BMO']);
        assert.deepEqual(m('highwycombe'), ['HWY']);
        // The town first; its Parkway, also known by the town's name, offered after it (whole-app review).
        assert.deepEqual(m('stratford-on-avon'), ['SAV', 'STY']);
        assert.deepEqual(m('b ham'), ['BMO', 'BSW']);
        // Nothing but punctuation is nothing typed — it once "matched" six stations at random.
        for (const q of ['.', "'", '-', ' - ']) assert.deepEqual(m(q), [], JSON.stringify(q));
    });

    test('busiest stations are the ones the most trains call at', () => {
        const rows = [row('10:00', 'OXF', '', '', 'HWY1030 OXF1100'), row('10:10', 'HWY', '', '', 'HWY1040')];
        assert.deepEqual(busiestStations(rows, 2), ['HWY', 'OXF']);
        assert.equal(busiestStations(TIMETABLES.now.SX.dep).length, 8);
    });
});

describe('headlineChanges — what you will be asked about', () => {
    test('a new direct service ranks above a change in daily count, and unknowable stations are left out', () => {
        const now = [...hourly(6, 'OXF', ['HWY', 'OXF'])];
        const dec = [...hourly(6, 'OXF'), row('12:30', 'SAV')];
        const out = headlineChanges(now, dec, { OXF: 'Oxford', SAV: 'Stratford-upon-Avon', HWY: 'High Wycombe' });
        assert.equal(out[0].text, 'A new direct train to Stratford-upon-Avon, the 12:30');
        assert.equal(out[0].tone, 'more');
        assert.ok(!out.some(h => h.crs === 'HWY'), 'High Wycombe cannot be answered yet, and nothing ends there');
        // Where trains DO end at a through station, the line is about those trains and says so.
        const partial = headlineChanges([...hourly(6, 'OXF', ['HWY', 'OXF']), row('09:00', 'HWY', '', '', 'HWY0930')],
            [...hourly(6, 'OXF'), row('09:00', 'HWY'), row('10:00', 'HWY'), row('11:00', 'HWY')], { OXF: 'Oxford', HWY: 'High Wycombe' });
        assert.equal(partial.find(h => h.crs === 'HWY')?.text, '2 more trains a day to High Wycombe (3, was 1); later last train, 11:00 (was 09:00); counting only the trains that end there');
    });

    test('the real weekday tables lead with something, and every headline names a station', () => {
        const out = headlineChanges(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, STATIONS);
        assert.ok(out.length > 0);
        for (const h of out) assert.ok(STATIONS[h.crs], h.crs);
    });

    test('one story, one line: a station whose change is a destination\'s own trains is named in its line', () => {
        const amersham = ['HOH', 'AMR', 'GMN', 'AYS'];
        const now = hourly(27, 'AYS', amersham);
        const dec = [...hourly(27, 'AYS', amersham),
            row('06:01', 'AYS', '', '', 'HOH0615 AMR0640 GMN0650 AYS0705'),
            row('07:01', 'AYS', '', '', 'AMR0740 GMN0750 AYS0805'),              // passes Harrow
            row('22:27', 'AYS', '', '', 'HOH2240 AMR2305 GMN2315 AYS2330')];
        const out = headlineChanges(now, dec, STATIONS);
        assert.equal(out.length, 1, 'four stations, one story');
        // "they" only for the same trains; "2 of them" where only some call, so Harrow's count stays true.
        // The last train is the same Marylebone 22:27 at every station, so saying it once loses nothing.
        assert.equal(out[0].text, '3 more trains a day to Aylesbury (9, was 6); they also stop at Amersham and Great Missenden; '
            + '2 of them also stop at Harrow-on-the-Hill; later last train, 22:27 (was 15:27)');
        assert.equal(out[0].crs, 'AYS', 'the line opens the destination, where the trains are going');
    });

    // The same story told the other way: trains that GO. Its clause read "they also stopped at", which on a
    // list read before the change too said trains still running had gone (whole-app check, Nov 2026). The
    // station is named losing them, which holds on either side of the change.
    test('one story, one line, for trains that go: the station is named losing them, in no tense', () => {
        const amersham = ['HOH', 'AMR', 'GMN', 'AYS'];
        const base = hourly(27, 'AYS', amersham);
        const now = [...base, row('06:01', 'AYS', '', '', 'HOH0615 AMR0640 GMN0650 AYS0705'),
            row('07:01', 'AYS', '', '', 'AMR0740 GMN0750 AYS0805'), row('22:27', 'AYS', '', '', 'HOH2240 AMR2305 GMN2315 AYS2330')];
        const out = headlineChanges(now, base, STATIONS);
        assert.equal(out.length, 1, 'four stations, one story');
        assert.equal(out[0].text, '3 fewer trains a day to Aylesbury (6, was 9); Amersham and Great Missenden lose them too; '
            + 'Harrow-on-the-Hill loses 2 of them too; earlier last train, 15:27 (was 22:27)');
        assert.doesNotMatch(out[0].text, /stopped|will stop|no longer/, 'a tense the list cannot keep on both sides of the change');
    });

    test('one story, one line — but never at the cost of a fact', () => {
        // Weekday Warwick: its change is some of Moor Street's trains, but ONE GOES as others come.
        // "2 of them" would count against "3 more", which is new trains less a withdrawn one.
        const now = [...hourly(2, 'BMO', ['WRW', 'BMO']), row('17:37', 'BMO', '', '', 'WRW1840 BMO1905')];
        const dec = [...hourly(2, 'BMO', ['WRW', 'BMO']), row('08:34', 'BMO', '', '', 'WRW0940 BMO1005'),
            row('09:34', 'BMO', '', '', 'WRW1040 BMO1105'), row('20:34', 'BMO', '', '', 'BMO2205'), row('21:34', 'BMO', '', '', 'WRW2240 BMO2305')];
        assert.deepEqual(headlineChanges(now, dec, STATIONS).map(h => h.crs).sort(), ['BMO', 'WRW']);
        // Saturday Haddenham: the same new trains as Moor Street, but its own hour changes differently
        // (3, was 2 — Moor Street's is 2, was 1), and folding would lose that.
        const sat = [...hourly(2, 'BMO', ['HDM', 'BMO']), ...hourly(45, 'BCS', ['HDM', 'BCS'])];
        const satDec = [...sat, ...hourly(32, 'BMO', ['HDM', 'BMO'])];
        const both = headlineChanges(sat, satDec, STATIONS);
        assert.deepEqual(both.map(h => h.crs).sort(), ['BMO', 'HDM']);
        assert.match(/** @type {string} */ (both.find(h => h.crs === 'HDM')?.text), /3 an hour in the daytime \(was 2\)/);
        // A brand-new direct service is the news itself, and never becomes a clause in another line.
        const fresh = headlineChanges([], [row('09:31', 'SAV', '', '', 'WRW1101 SAV1131')], STATIONS);
        assert.deepEqual(fresh.map(h => h.text), ['A new direct train to Stratford-upon-Avon, the 09:31', 'A new direct train to Warwick, the 09:31']);
        // A station a train passes cannot host one it ends beyond: Amersham's line never carries Aylesbury's trains.
        const passes = headlineChanges(hourly(27, 'AYS', ['AMR', 'AYS']), [...hourly(27, 'AYS', ['AMR', 'AYS']),
            row('06:01', 'AYS', '', '', 'AMR0640 AYS0705'), row('07:01', 'AYS', '', '', 'AMR0740 AYS0805')], STATIONS);
        assert.deepEqual(passes.map(h => h.crs), ['AYS']);
    });

    test('the real tables: one story, one line', () => {
        const sx = headlineChanges(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, STATIONS);
        assert.equal(sx.find(h => h.crs === 'AYS')?.text, '6 more trains a day to Aylesbury (47, was 41); they also stop at Amersham, '
            + 'Great Missenden, Wendover and Stoke Mandeville; 5 of them also stop at Harrow-on-the-Hill, Rickmansworth, Chorleywood and Chalfont & Latimer');
        // The clause sits beside the count it qualifies, before the line's onward clause.
        // One real day (v24.83): Moor Street was "3 more (35, was 32)" with today's Mondays-and-Fridays
        // 17:37 counted as a second train beside its Tuesday-to-Thursday 17:33.
        assert.equal(sx.find(h => h.crs === 'BMO')?.text, '4 more trains a day to Birmingham Moor Street (35, was 31); '
            + 'they also stop at Warwick Parkway, Dorridge and Solihull; 3 of them also stop at Warwick; 4 more go on to Snow Hill (18, was 14)');
        // Banbury's five new trains all stop at Bicester North, and Bicester North also loses two trains that run on to
        // Stourbridge without calling there: it keeps its own line, which is true. "3 of them also stop at Bicester
        // North" came from pairing its trains by nearest time across routes, not as its own card pairs them (Trains
        // review, Nov 2026). High Wycombe's three are Banbury's on a Tuesday, but on a Monday it also swaps the 17:45
        // for a new 17:41, so its own line stays too: a headline names no day.
        assert.equal(sx.find(h => h.crs === 'BAN')?.text, '5 more trains a day to Banbury (42, was 37)');
        assert.equal(sx.find(h => h.crs === 'BCS')?.text, '3 more trains a day to Bicester North (38, was 35)');
        assert.equal(sx.find(h => h.crs === 'HWY')?.text, '3 more trains a day to High Wycombe (90, was 87)');
        assert.equal(sx.find(h => h.crs === 'HDM')?.text, '2 fewer trains a day to Haddenham & Thame Parkway (41, was 43)');
        assert.ok(!sx.some(h => h.crs === 'PRR'), 'Princes Risborough: one fewer on a real weekday, no headline');
        // Warwick's "a train goes as others come" was that same twin, read as a train withdrawn.
        for (const crs of ['HOH', 'RIC', 'CLW', 'CFO', 'AMR', 'GMN', 'WND', 'SKM', 'WRP', 'DDG', 'SOL', 'WRW']) {
            assert.ok(!sx.some(h => h.crs === crs), `${crs} is told in its destination's line`);
        }
        const so = headlineChanges(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep, STATIONS);
        assert.ok(so.some(h => h.crs === 'HDM'), 'Saturday Haddenham keeps its own hour: 3, was 2');
        // Never "now": read before the change, "Last train to Hatton now 21:02" named a train that does not stop there yet.
        assert.equal(so.find(h => h.crs === 'HTN')?.text, 'Later last train to Hatton: 21:02 (was 20:32)');
        assert.match(/** @type {string} */ (so.find(h => h.crs === 'BMO')?.text), /they also stop at Bicester North, Banbury, Leamington Spa, Warwick, Warwick Parkway, Dorridge and Solihull; 2 of them also stop at High Wycombe$/);
    });
});

describe('the stopping-pattern grid', () => {
    test('one column per train repeating most daytime hours, rows in calling order', () => {
        const rows = [...hourly(10, 'HWY', ['WRU', 'GER', 'HWY']), ...hourly(6, 'OXF', ['GER', 'HWY', 'OXF']), row('12:20', 'BAN')];
        const g = stoppingGrid(rows);
        assert.deepEqual(g.columns.map(c => c.minute), [6, 10]);
        assert.deepEqual(g.stations, ['WRU', 'GER', 'HWY', 'OXF']);
        assert.ok(g.columns.every(c => c.known));
    });

    test('a Monday/Friday-only train is not part of the basic hour', () => {
        const rows = hourly(6, 'OXF').map(r => /** @type {typeof r} */ ([r[0], r[1], r[2], 'MFO', r[4]]));
        assert.equal(stoppingGrid(rows).columns.length, 0);
    });

    test('a column is every hour\'s train: a stop only some hours make is "some", and a part-time minute says so (v24.83)', () => {
        // The weekday :10 calls at West Ruislip in some hours and Denham Golf Club in the others; the
        // grid once showed whichever the middle train did, as if every hour.
        const rows = [10, 11, 12, 13, 14, 15].map(h => row(`${h}:10`, 'HWY', '', '', h % 2 ? `DGC${h}30 HWY${h}50` : `WRU${h}25 HWY${h}50`));
        const [col] = stoppingGrid(rows).columns;
        assert.deepEqual([[...col.some].sort(), col.calls.includes('HWY'), col.some.includes('HWY')], [['DGC', 'WRU'], true, false]);
        const html = renderGrid(stoppingGrid(rows), stoppingGrid(rows), 'now', STATIONS);
        assert.match(html, /<td><span class="tr-dot tr-dot--some" aria-hidden="true"><\/span><span class="sr-only">stops in some hours<\/span><\/td>/);
        assert.match(html, /tr-grid-key/, 'the half dot is in the key');
        // A minute that runs in four hours of six says so under its time.
        const part = stoppingGrid([10, 11, 12, 13].map(h => row(`${h}:27`, 'AYS', 'A', '', `AYS${h}55`)));
        assert.match(renderGrid(part, part, 'now', STATIONS), /<span class="tr-grid-via">4 of 6 hours<\/span>/);
        // Named by where MOST of its trains go: two Banbury hours do not make a Banbury column.
        const end = stoppingGrid([10, 11, 12, 13, 14, 15].map(h => row(`${h}:36`, h === 10 || h === 12 ? 'BAN' : 'BSW', '', '', h === 10 || h === 12 ? `BAN${h}50` : `BAN${h}50 BSW${h}58`)));
        assert.deepEqual([end.columns[0].end, end.columns[0].some], ['BSW', ['BSW']]);
    });

    test('orderStations follows the books, so every column reads downwards in travel order', () => {
        // The Saturday case that broke the merge: a via-Wycombe Aylesbury train and the Amersham line.
        const o = orderStations([['PRR', 'MRS', 'LTK', 'AYS'], ['HOH', 'RIC', 'AMR', 'AYS', 'AVP'], ['HWY', 'BMO']]);
        for (const c of ['PRR', 'MRS', 'LTK', 'AYS', 'HOH', 'RIC', 'AMR', 'AVP', 'HWY', 'BMO']) assert.ok(STATION_ORDER.includes(c), c);
        const at = (/** @type {string} */ c) => o.indexOf(c);
        assert.ok(at('PRR') < at('MRS') && at('MRS') < at('LTK') && at('LTK') < at('AYS'), 'via Wycombe reads down');
        assert.ok(at('HOH') < at('RIC') && at('RIC') < at('AMR') && at('AMR') < at('AYS') && at('AYS') < at('AVP'), 'via Amersham reads down');
        assert.ok(at('BMO') < at('HOH'), 'the Amersham line follows the main line, as the books do');
        // Stations the books do not know fall back to their own list order.
        assert.deepEqual(orderStations([['A', 'C'], ['A', 'B', 'C', 'D']]), ['A', 'B', 'C', 'D']);
        assert.deepEqual(orderStations([['A', 'B'], ['A', 'X']]), ['A', 'X', 'B']);
    });

    test('a column carries the Aylesbury route, and the grid names it', () => {
        const g = stoppingGrid(hourly(27, 'AYS').map(r => /** @type {typeof r} */ ([r[0], r[1], 'H', r[3], r[4]])));
        assert.equal(g.columns[0].via, 'H');
        assert.match(renderGrid(g, g, 'now', STATIONS), /<span class="tr-grid-via">via Wycombe<\/span>/);
        assert.doesNotMatch(renderGrid(stoppingGrid(hourly(6, 'OXF')), g, 'now', STATIONS), /tr-grid-via/);
    });

    test('pairColumns matches the same end within the shift limit, each of today\'s columns once', () => {
        const now = [{ minute: 6, end: 'OXF', calls: [] }, { minute: 40, end: 'OXF', calls: [] }];
        assert.deepEqual(pairColumns(now, [{ minute: 8, end: 'OXF' }, { minute: 7, end: 'OXF' }, { minute: 38, end: 'OXF' }, { minute: 2, end: 'BMO' }]).map(p => p?.minute ?? null), [6, null, 40, null]);
        // A different end is a different train, however close the minute: no false "no longer stops".
        assert.deepEqual(pairColumns([{ minute: 2, end: 'BMO', calls: [] }], [{ minute: 3, end: 'OXF' }]), [null]);
    });

    test('the real weekday basic hour today', () => {
        const g = stoppingGrid(TIMETABLES.now.SX.dep);
        assert.ok(g.columns.length >= 6);
        assert.ok(g.columns.every(c => c.known), 'today\'s stops are all published');
        assert.ok(g.stations.includes('GER'));
        assert.deepEqual(g.stations, [...g.stations].sort((a, b) => STATION_ORDER.indexOf(a) - STATION_ORDER.indexOf(b)), 'rows in the books\' order');
        assert.ok(STATION_ORDER.every(c => STATIONS[c]), 'every ordered station is named');
    });
});

describe('the words on screen', () => {
    test('one headline per station, its biggest change first', () => {
        const now = [...hourly(2, 'BMO'), row('18:02', 'BMO'), row('19:02', 'BMO')];
        const dec = [...hourly(2, 'BMO'), ...hourly(32, 'BMO'), row('18:02', 'BMO'), row('19:02', 'BMO')];
        const out = headlineChanges(now, dec, { BMO: 'Birmingham Moor Street' });
        assert.equal(out.length, 1);
        assert.equal(out[0].text, 'More trains to Birmingham Moor Street: 2 an hour in the daytime (was 1); 6 more a day (14, was 8)');
    });

    test('a station a line runs on to is folded into the line\'s headline, never a second story', () => {
        const now = [...hourly(2, 'BMO'), row('18:02', 'BSW')];
        const dec = [...hourly(2, 'BMO'), row('18:02', 'BSW'), row('19:02', 'BSW'), row('20:02', 'BSW')];
        const out = headlineChanges(now, dec, STATIONS);
        assert.equal(out.length, 1);
        // The last train moves too: the onward clause still sits beside the count it qualifies.
        assert.equal(out[0].text, '2 more trains a day to Birmingham Moor Street (9, was 7); 2 more go on to Snow Hill (3, was 1); later last train, 20:02 (was 18:02)');
        // …but only when the onward station says nothing its line does not: a Snow Hill last train of
        // its own keeps its own line (v24.83 — it vanished with the fold).
        const own = headlineChanges([...hourly(2, 'BMO'), row('18:02', 'BSW')], [...hourly(2, 'BMO'), row('16:02', 'BSW'), row('17:02', 'BSW'), row('17:32', 'BMO')], STATIONS);
        assert.ok(own.some(h => h.crs === 'BSW' && /earlier last train/i.test(h.text)), JSON.stringify(own.map(h => h.text)));
        // And one more train "goes", never "go" — here Snow Hill's later last train is Moor Street's own.
        const one = headlineChanges([...hourly(2, 'BMO'), row('18:02', 'BSW')], [...hourly(2, 'BMO'), row('18:02', 'BSW'), row('20:02', 'BSW')], STATIONS);
        assert.deepEqual(one.map(h => h.text), ['Later last train to Birmingham Moor Street: 20:02 (was 18:02); 1 more goes on to Snow Hill (2, was 1)']);
        const real = headlineChanges(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, STATIONS);
        assert.ok(!real.some(h => h.crs === 'BSW' || h.crs === 'SBJ' || h.crs === 'AVP'), 'no onward station headlines its own line');
    });

    test('headlines: five, then a button for the rest, and the partial note', () => {
        const items = Array.from({ length: 7 }, (_, i) => ({ crs: 'AYS', tone: 'more', text: `Change ${i}` }));
        const html = renderHeadlines(items, { showAll: false, partial: true });
        assert.equal((html.match(/class="tr-head"/g) ?? []).length, HEADLINES_SHOWN);
        assert.equal(HEADLINES_SHOWN, 5, 'premise: the number Show more hands focus past (trains-app.js → refocus)');
        // Never "Show all": the list is the biggest changes, and every small one is on a station card (v24.83).
        assert.match(html, />Show 2 more</);
        assert.match(html, /The biggest changes only\. A train a few minutes earlier or later is on its station’s card/);
        assert.match(html, /once Chiltern publishes where December’s trains stop/);
        assert.doesNotMatch(renderHeadlines(items, { showAll: true, partial: false }), /Show \d+ more|once Chiltern publishes/);
        assert.match(renderHeadlines([], { showAll: false, partial: false }), /No big changes/);
    });

    // The overview's partial-stops note takes its month from the change date, as every other note does,
    // never a month typed into trains.html (whole-app review, 24 Nov 2026).
    test('the partial-stops note names the change date\'s month', () => {
        const month = new Date(CHANGE_DATE + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long' });
        assert.equal(partialStopsNote(), `Where ${month}’s trains stop is not published yet, so each train is compared by where it ends. Through stations fill in when it is.`);
        const html = readFileSync(new URL('./trains.html', REPO_ROOT_URL), 'utf8');
        assert.match(html, /<p class="card-explainer tr-note" id="trPartial" hidden><\/p>/, 'the note types its own words in the markup');
    });

    test('a headline is escaped and opens its station', () => {
        const html = renderHeadlines([{ crs: 'AYS', tone: 'less', text: '<b>x</b>' }], { showAll: false, partial: false });
        assert.match(html, /data-station="AYS"/);
        assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
        assert.match(html, />Fewer trains</);
    });

    test('a station card: verdict, today beside December, and a waiting December reads "not known yet" to a screen reader', () => {
        // From a source without December's stops (the simplifier, before the books): Gerrards Cross is
        // passed by a train ending elsewhere and nothing ends there, so December waits.
        const view = stationView([row('10:06', 'OXF', '', '', 'GER1028 OXF1112')], [row('10:08', 'OXF')], 'GER', 'dep');
        const html = renderStation(view, { stations: STATIONS, dir: 'dep', showTrains: false });
        assert.match(html, /tr-verdict--unknown/);
        assert.match(html, /Daytime, leaves Marylebone at/);
        assert.match(html, /<span class="sr-only">not known yet<\/span>/);
        assert.doesNotMatch(html, /sr-only">none</, 'an unknown December figure is not "none"');
        assert.doesNotMatch(html, /tr-route|tr-sub/, 'no train list, and no "trains that end here" label, where nothing ends');

        // High Wycombe from the same kind of source: the figures and the list are about the trains
        // that END there, and say so — and what they leave out.
        const now = [row('09:00', 'HWY', '', '', 'HWY0930'), row('10:00', 'HWY', '', '', 'HWY1030'), row('10:06', 'OXF', '', '', 'HWY1035 OXF1112')];
        const dec = [row('09:00', 'HWY'), row('10:00', 'HWY'), row('11:00', 'HWY'), row('10:06', 'OXF')];
        const hwy = renderStation(stationView(now, dec, 'HWY', 'dep'), { stations: STATIONS, dir: 'dep', showTrains: false });
        assert.match(hwy, /<p class="tr-sub">Trains that end at High Wycombe<\/p>/);
        assert.match(hwy, /1 more train a day: 3, was 2\./);
        assert.match(hwy, /One other train a day calls at High Wycombe and runs on past it\./);
        assert.match(hwy, /<details class="tr-route">/, 'the trains that end there are listed, today beside December');
        // Coming back, the same trains START there, and the one from Oxford comes through on the way in.
        const nowIn = [row('09:30', 'HWY', '', '', 'HWY0900'), row('10:30', 'HWY', '', '', 'HWY1000'), row('11:12', 'OXF', '', '', 'OXF1006 HWY1040')];
        const decIn = [row('09:30', 'HWY'), row('10:30', 'HWY'), row('11:30', 'HWY'), row('11:12', 'OXF')];
        const hwyIn = renderStation(stationView(nowIn, decIn, 'HWY', 'arr'), { stations: STATIONS, dir: 'arr', showTrains: false });
        assert.match(hwyIn, /Trains that start at High Wycombe/);
        assert.match(hwyIn, /One other train a day calls at High Wycombe on the way in\./);

        // The real tables carry every stop (v24.80), so no real card waits or answers for part of a station.
        for (const dir of /** @type {const} */ (['dep', 'arr'])) for (const crs of ['GER', 'OXF', 'HWY', 'BCF', 'WRU']) {
            const real = renderStation(stationView(TIMETABLES.now.SX[dir], TIMETABLES.dec.SX[dir], crs, dir), { stations: STATIONS, dir, showTrains: false });
            assert.doesNotMatch(real, /not known yet|tr-sub|cannot be compared/, `${dir} ${crs}`);
        }
        const back = renderStation(stationView(TIMETABLES.now.SX.arr, TIMETABLES.dec.SX.arr, 'AYS', 'arr'), { stations: STATIONS, dir: 'arr', showTrains: true });
        assert.match(back, /Daytime, leaves Aylesbury at/);
        assert.match(back, /Times are when trains leave Aylesbury; the small time under each is when it gets into Marylebone\./);
        assert.match(back, /<details class="tr-route" open>/);
    });

    test('the train list shows the trains that change; the rest are counted and one tap away', () => {
        const view = stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'AYS', 'dep');
        const changed = /** @type {any[]} */ (view.trains).filter(t => t.kind !== 'same' || t.farShift).length;
        const same = /** @type {any[]} */ (view.trains).length - changed;
        assert.ok(changed > 0 && same > 0);
        const html = renderStation(view, { stations: STATIONS, dir: 'dep', showTrains: true });
        assert.equal((html.match(/class="tr-row /g) ?? []).length, changed);
        assert.doesNotMatch(html, /No change/);
        assert.match(html, new RegExp(`${changed} change, ${same} stay the same`));
        assert.match(html, new RegExp(`id="trAllTrains">Show the ${same} that stay the same<`));
        const all = renderStation(view, { stations: STATIONS, dir: 'dep', showTrains: false, allTrains: true });
        assert.equal((all.match(/class="tr-row /g) ?? []).length, changed + same);
        assert.match(all, /<details class="tr-route" open>/, 'showing all keeps the list open');
        assert.doesNotMatch(all, /trAllTrains/);
        // Every train at Amersham coming back changes: the count says so, rather than "0 stay the same".
        const amr = renderStation(stationView(TIMETABLES.now.SX.arr, TIMETABLES.dec.SX.arr, 'AMR', 'arr'), { stations: STATIONS, dir: 'arr', showTrains: false });
        assert.match(amr, /All 38 change · leaving Amersham/);
        assert.doesNotMatch(amr, /0 stay|trAllTrains/);
    });

    // THE LIST'S WORDS TURN WITH ITS CHIPS (whole-app fix, Nov 2026). From 13 December the chips said
    // "Now stops here" while the list beside them was still headed "What changes" and counted "5 change,
    // 12 stay the same": a forecast of something that had happened.
    test('the train list speaks in the tense of the change, as its chips do', () => {
        const view = stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'AYS', 'dep');
        const changed = /** @type {any[]} */ (view.trains).filter(t => t.kind !== 'same' || t.farShift).length;
        const same = /** @type {any[]} */ (view.trains).length - changed;
        const before = renderStation(view, { stations: STATIONS, dir: 'dep', showTrains: true });
        const after = renderStation(view, { stations: STATIONS, dir: 'dep', showTrains: true, started: true });
        assert.match(before, /<th scope="col">What changes<\/th>/);
        assert.match(after, /<th scope="col">What changed<\/th>/);
        assert.match(after, new RegExp(`${changed} changed, ${same} stayed the same`));
        assert.match(after, new RegExp(`id="trAllTrains">Show the ${same} that stayed the same<`));
        assert.doesNotMatch(after, /What changes|stays? the same|\d change,/, 'nothing left in the forecast tense');
        const amr = renderStation(stationView(TIMETABLES.now.SX.arr, TIMETABLES.dec.SX.arr, 'AMR', 'arr'), { stations: STATIONS, dir: 'arr', showTrains: false, started: true });
        assert.match(amr, /All 38 changed · leaving Amersham/);
        // Every train keeps its time: the unchanged trains ARE the list, in either tense — "Every train keeps its
        // time" over a second button was two taps to rows that had nothing to hide (words review, Nov 2026).
        const kept = stationView(hourly(6, 'OXF'), hourly(6, 'OXF'), 'OXF', 'dep');
        for (const started of [false, true]) {
            const html = renderStation(kept, { stations: STATIONS, dir: 'dep', showTrains: false, started });
            assert.match(html, new RegExp(`All 6 ${started ? 'stayed' : 'stay'} the same · leaving Marylebone</span></summary><table class="tr-trains">`));
            assert.equal((html.match(/tr-row--same/g) ?? []).length, 6, 'every unchanged train is listed');
            assert.doesNotMatch(html, /trAllTrains|Every train kep/, 'no second tap, and no sentence in their place');
        }
    });

    test('a train that runs on names its onward stop in a few words', () => {
        // "Aylesbury Vale", never "Parkway": five stations on the page are Parkways (v24.83).
        assert.equal(endWords('AVP', 'AYS', STATIONS, true), 'on to Aylesbury Vale');
        assert.equal(endWords('AVP', 'AYS', STATIONS, false), 'from Aylesbury Vale');
        assert.equal(endWords('SBJ', 'BMO', STATIONS, true), 'on to Stourbridge');
        assert.equal(endWords('OXF', 'HWY', STATIONS, true), `to ${STATIONS.OXF}`);
        assert.equal(endWords('OXF', 'HWY', STATIONS, false), `from ${STATIONS.OXF}`, 'coming back, where it started');
        assert.equal(endWords('AYS', 'AYS', STATIONS, true), '');
        assert.equal(endWords(undefined, 'AYS', STATIONS, true), '');
    });

    test('the grid: today\'s stops are dots with words; December keeps today\'s row order and marks gained and lost stops', () => {
        const nowG = stoppingGrid([...hourly(6, 'OXF', ['GER', 'HWY', 'OXF'])]);
        const decG = stoppingGrid([...hourly(8, 'OXF', ['HWY', 'BCS', 'OXF'])]);
        const now = renderGrid(nowG, decG, 'now', STATIONS);
        assert.match(now, /:06/);
        // It scrolls sideways on a phone, so a keyboard must be able to reach it (axe, mobile Safari).
        assert.match(now, /<div class="tr-grid-wrap" tabindex="0" role="region" aria-label="[^"]+">/);
        assert.match(now, /<span class="sr-only">stops<\/span>/);
        const dec = renderGrid(nowG, decG, 'dec', STATIONS);
        // In a CELL, not the key — the key names both whatever the cells hold.
        assert.match(dec, /<td><span class="tr-dot tr-dot--lost" aria-hidden="true"><\/span><span class="sr-only">no longer stops<\/span><\/td>/);
        assert.match(dec, /<td><span class="tr-dot tr-dot--new" aria-hidden="true"><\/span><span class="sr-only">new stop<\/span><\/td>/);
        assert.match(dec, /tr-grid-key/);
        const order = [...dec.matchAll(/<th scope="row" class="tr-grid-st">([^<]+)</g)].map(m => m[1]);
        assert.deepEqual(order.slice(1), [STATIONS.GER, STATIONS.HWY, STATIONS.OXF, STATIONS.BCS]);
    });

    test('a December column with unknown stops shows only its end, and says so — no empty rows', () => {
        const nowG = stoppingGrid(hourly(6, 'OXF', ['GER', 'HWY', 'OXF']));
        const decG = stoppingGrid(hourly(8, 'OXF'));
        const html = renderGrid(nowG, decG, 'dec', STATIONS);
        assert.match(html, /stops are not published yet/);
        const rows = [...html.matchAll(/<th scope="row" class="tr-grid-st">([^<]+)</g)].map(m => m[1]);
        assert.deepEqual(rows, ['London Marylebone', STATIONS.OXF]);
        assert.doesNotMatch(html, /tr-dot--lost/, 'an unknown stop is not a lost stop');
    });
});

describe('a station\'s trains, one comparison with the time lookup (v24.83)', () => {
    const at = (/** @type {'SX'|'SO'|'SU'} */ d, /** @type {'dep'|'arr'} */ dir, /** @type {string} */ crs) => stationTrains(TIMETABLES.now[d][dir], TIMETABLES.dec[d][dir], crs, dir);
    test('the Mondays-and-Fridays 17:37 to Snow Hill is 4 minutes earlier, as the lookup says — never "No longer runs"', () => {
        for (const crs of ['BAN', 'LMS', 'WRW', 'SOL', 'BMO', 'BSW']) {
            const t = at('SX', 'dep', crs).find(x => x.now === '17:37' && x.days === 'MFO');
            assert.deepEqual([t?.kind, t?.dec], ['earlier', '17:33'], crs);
        }
    });
    test('a train that keeps running but stops calling is "no longer stops here"; one that starts calling, "stops here"', () => {
        const kgs = at('SX', 'dep', 'KGS');
        assert.equal(kgs.find(x => x.now === '10:36')?.kind, 'passes', 'the 10:36 runs on to Snow Hill, past Kings Sutton');
        assert.equal(kgs.find(x => x.dec === '09:02')?.kind, 'calls');
        assert.equal(changeLabel(/** @type {any} */ (kgs.find(x => x.now === '10:36')), STATIONS, 'dep'), 'Will no longer stop here');
    });
    test('coming back, a train is timed at the station: Stourbridge\'s 06:14 leaves on time and gets in later', () => {
        const t = at('SX', 'arr', 'SBJ').find(x => x.nowAt === '06:14');
        assert.deepEqual([t?.kind, t?.decAt, t?.nowIn, t?.decIn, t?.farShift], ['same', '06:14', '08:42', '08:53', 11]);
        assert.equal(changeLabel(/** @type {any} */ (t), STATIONS, 'arr'), 'Same time, gets in 11 mins later');
        // Banbury's 08:09 (into London 09:13) becomes the 08:08 from Stourbridge: both facts, the station's first.
        const ban = at('SX', 'arr', 'BAN').find(x => x.nowAt === '08:09');
        assert.equal(changeLabel(/** @type {any} */ (ban), STATIONS, 'arr', { withTime: false }), '1 min earlier, will start at Stourbridge Junction');
    });
    test('the stops a kept train gains or loses on the way', () => {
        const n = TIMETABLES.now.SX.dep.find(r => r[0] === '10:36'), d = TIMETABLES.dec.SX.dep.find(r => r[0] === '10:36');
        assert.deepEqual(stopChanges(/** @type {any} */ (n), /** @type {any} */ (d)), { lost: ['KGS'], gained: [] });
    });
});

describe('the 48-hour review\'s Trains findings, on the real books (v24.89)', () => {
    const look = (/** @type {'SX'|'SO'|'SU'} */ day, /** @type {string} */ time, started = false) =>
        renderLookup({ at: time, day, nowRows: TIMETABLES.now[day].dep, decRows: TIMETABLES.dec[day].dep, started,
            labels: started ? { old: 'Until 12 Dec', new: 'From 13 Dec' } : { old: 'Now', new: 'From 13 Dec' }, change: CHANGE_DATE, stations: STATIONS });
    const card = (/** @type {'SX'|'SO'|'SU'} */ d, /** @type {'dep'|'arr'} */ dir, /** @type {string} */ crs) => stationTrains(TIMETABLES.now[d][dir], TIMETABLES.dec[d][dir], crs, dir);
    const words = (/** @type {any} */ t, /** @type {'dep'|'arr'} */ dir) => changeLabel(t, STATIONS, dir, { withTime: false });

    test('the lookup says when a train that leaves on time gets there at a different time — as the station card does', () => {
        assert.match(look('SX', '21:02'), /<strong>The 21:02 to Stourbridge Junction:<\/strong> Same time, gets there 6 mins later\./);
        assert.match(look('SX', '09:10'), /Same time, gets there 5 mins earlier\. From 13 December it no longer stops at Beaconsfield\./);
        assert.match(look('SU', '12:38'), /<strong>The 12:38 to Birmingham Moor Street:<\/strong> Same time, gets there 6 mins earlier\./);
        assert.match(look('SX', '21:02', true), /Same time as before 13 December, but gets there 6 mins later than it did\./);
        // And still "No change" where nothing did.
        assert.match(look('SX', '10:06'), /<strong>The 10:06 to Oxford:<\/strong> No change\./);
    });
    test('after the change, a train whose end moved keeps the time it used to leave at', () => {
        assert.match(look('SX', '17:03', true), /<strong>The 17:03 to Stourbridge Junction:<\/strong> Until 12 December it left at 17:07 and ended at Birmingham Moor Street\./);
        assert.match(look('SX', '16:41', true), /Until 12 December it left at 16:37 and went on to Stourbridge Junction\./);
    });
    test('a December train is listed once, however many of today\'s trains fold onto it', () => {
        const ger = card('SX', 'dep', 'GER').filter(t => t.dec === '17:45' && t.decTo === 'OXF');
        assert.equal(ger.length, 1, 'the 17:45 to Oxford read "Will stop here" twice');
        assert.equal(stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'GER', 'dep').verdict.text,
            'Same number of trains a day, but 14 are different — see Train by train below.');
        assert.equal(card('SX', 'arr', 'SRG').filter(t => t.dec === '08:02' && t.decTo === 'OXF').length, 1);
    });
    test('two trains are one only if they share a stop: a withdrawn train is not "no longer stops here"', () => {
        // Coming back, the 07:54 and 08:26 from Gerrards Cross are withdrawn. They used to be paired with
        // a Banbury and a Leamington fast that reach Marylebone at the same time and share none of their stops.
        const ger = card('SX', 'arr', 'GER');
        for (const at of ['07:54', '08:26']) assert.equal(ger.find(t => t.nowAt === at)?.kind, 'gone', at);
        assert.equal(card('SX', 'arr', 'BAN').find(t => t.decAt === '07:10')?.kind, 'new', 'the Banbury fast is a new train');
        // A real reroute shares its stops and is still one train.
        assert.equal(card('SX', 'dep', 'KGS').find(t => t.now === '10:36')?.kind, 'passes');
    });
    test('a train cut back short of a station says where it ends, not that it passes the station', () => {
        const sbj = card('SX', 'dep', 'SBJ').find(t => t.now === '16:37');
        assert.equal(words(sbj, 'dep'), 'Will end at Birmingham Moor Street');
        assert.equal(sbj?.dec, null, 'no December time at a station the train no longer reaches');
        assert.equal(words(card('SX', 'dep', 'GER').find(t => t.now === '06:57'), 'dep'), 'Will run to West Ruislip');
        assert.equal(words(card('SX', 'arr', 'AVP').find(t => t.nowAt === '09:40'), 'arr'), 'Will start at Aylesbury');
        // One that still runs THROUGH the station keeps "no longer stops here".
        assert.equal(words(card('SX', 'dep', 'BCS').find(t => t.now === '17:07'), 'dep'), 'Will no longer stop here');
    });
    test('the stops a train drops are never past its new end, even where today\'s train passes that end', () => {
        const n = TIMETABLES.now.SX.dep.find(r => r[0] === '06:57'), d = TIMETABLES.dec.SX.dep.find(r => r[0] === '06:57');
        assert.deepEqual(stopChanges(/** @type {any} */ (n), /** @type {any} */ (d)), { lost: [], gained: [] });
        assert.match(look('SX', '06:57'), /<strong>The 06:57 to Gerrards Cross:<\/strong> Will run to West Ruislip\.<\/p>/);
    });
    test('two names that match equally: the one typed in full, then the busier station', () => {
        const busiest = busiestStations(TIMETABLES.now.SX.dep, Infinity);
        assert.equal(matchStations(STATIONS, 'risborough', 6, busiest)[0], 'PRR', 'Enter opened Monks Risborough');
        assert.equal(matchStations(STATIONS, 'warwick', 6, busiest)[0], 'WRW', 'the name typed in full beats a busier Parkway');
        assert.equal(matchStations(STATIONS, 'denham', 6, busiest)[0], 'DNM');
        assert.deepEqual(matchStations(STATIONS, 'risborough'), ['MRS', 'PRR'], 'with no preference, the alphabet as before');
    });
});

describe('the station card, the lookup and the totals as a member reads them (v24.83)', () => {
    test('the columns are named by the date, and the leaf-fall note comes back only on its line', () => {
        const view = stationView(TIMETABLES.now.SO.arr, TIMETABLES.dec.SO.arr, 'AMR', 'arr');
        const html = renderStation(view, { stations: STATIONS, dir: 'arr', showTrains: true, labels: { old: 'Until 12 Dec', new: 'From 13 Dec' },
            started: true, leafFall: { minutes: 3, until: '10 January' } });
        assert.match(html, /<th scope="col">Until 12 Dec<\/th><th scope="col">From 13 Dec<\/th>/);
        // "Via Amersham", not "on this line": Aylesbury's card holds trains via High Wycombe too. And what leaf fall is.
        assert.match(html, /<strong>Leaf fall:<\/strong> until 10 January, trains to London via Amersham leave up to 3 minutes earlier than usual \(Chiltern’s autumn timetable: fallen leaves make the rails slippery, so these trains leave earlier to give them more time\)\./);
        // It names the columns as the table above it does, so it stays true when they are renamed on 13 December.
        // Only a LATER December time can be the season — leaf fall moves today's trains earlier (v24.89).
        // The planner line takes in the last leaf-fall day: "before 10 January" read as a deadline and left the 10th out.
        assert.match(html, /The Until 12 Dec column includes that and the From 13 Dec column does not, so a train up to 3 minutes later in the From 13 Dec column may be leaf fall, not a real change\. For trains up to and including 10 January, check the journey planner\./);
        assert.doesNotMatch(html, /before 10 January/);
        assert.doesNotMatch(html, /a change of 3 minutes or less/);
        assert.match(view.verdict.text, /they leave at :14 past the hour, was :08/, 'Saturday Amersham, timed at Amersham');
        assert.doesNotMatch(renderStation(stationView(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep, 'AMR', 'dep'),
            { stations: STATIONS, dir: 'dep', showTrains: false, leafFall: { minutes: 3, until: '10 January' } }), /Leaf fall/, 'not going there');
    });
    test('the lookup: the day the member chose, a train\'s days, and the stops it drops', () => {
        const look = (/** @type {'SX'|'SO'|'SU'} */ day, /** @type {string} */ time, started = false) =>
            renderLookup({ at: time, day, nowRows: TIMETABLES.now[day].dep, decRows: TIMETABLES.dec[day].dep, started,
                labels: started ? { old: 'Until 12 Dec', new: 'From 13 Dec' } : { old: 'Now', new: 'From 13 Dec' }, change: CHANGE_DATE, stations: STATIONS });
        assert.match(look('SO', '10:36'), /No Saturday train leaves at exactly 10:36 in the current timetable\./);
        assert.match(look('SX', '10:36'), /<strong>The 10:36 to Banbury:<\/strong> Will run to Birmingham Snow Hill\. From 13 December it no longer stops at Kings Sutton\./);
        assert.match(look('SX', '17:37'), /<strong>The 17:37 to Birmingham Snow Hill \(Mon and Fri only\):<\/strong> 4 mins earlier \(17:33\)\./);
        assert.match(look('SX', '17:37'), /17:37<\/span> Birmingham Moor Street <span class="tr-near-on">on to Snow Hill<\/span> <span class="tr-days">Mon and Fri only<\/span>/);
        // From the change, "the 15:38" is December's — it used to answer "No train leaves at exactly 15:38 today".
        assert.match(look('SU', '15:38', true), /<strong>The 15:38 to Birmingham Moor Street:<\/strong> New from 13 December\./);
        assert.match(look('SX', '10:36', true), /Until 12 December this was the 10:36 to Banbury\./);
        assert.match(look('SX', '10:36', true), /<h3 class="tr-near-head">Until 12 Dec<\/h3>/);
    });
    // A train run on to Aylesbury Vale Parkway carries no route code, while its Aylesbury self is "via
    // Amersham" — one line, two codes. The stops it dropped went unsaid, because the lookup compared the
    // codes, not the route (whole-app check, Nov 2026; no such train drops a stop in today's books).
    test('the lookup names the stops a train drops when it is run on to the Parkway, on either side of the change', () => {
        const nowRows = [row('07:57', 'AYS', 'A', '', 'HOH0810 AMR0835 GMN0845 WND0852 SKM0858 AYS0905')];
        const decRows = [row('07:57', 'AVP', '', '', 'HOH0810 AMR0835 WND0852 SKM0858 AYS0905 AVP0911')];
        for (const started of [false, true]) {
            const html = renderLookup({ at: '07:57', day: 'SX', nowRows, decRows, started, labels: { old: 'Now', new: 'From 13 Dec' }, change: CHANGE_DATE, stations: STATIONS });
            assert.match(html, /From 13 December it no longer stops at Great Missenden\./, started ? 'after the change' : 'before the change');
        }
        // Across Aylesbury's two routes the route is still the story, and no stops are compared.
        const viaWycombe = [row('07:57', 'AYS', 'H', '', 'HWY0830 PRR0845 AYS0905')];
        assert.doesNotMatch(renderLookup({ at: '07:57', day: 'SX', nowRows, decRows: viaWycombe, started: false,
            labels: { old: 'Now', new: 'From 13 Dec' }, change: CHANGE_DATE, stations: STATIONS }), /no longer stops at|also stops at/);
    });
    // "Weekdays 145 → 158, +13" was a Tuesday to Thursday's: on a Monday or Friday 144 leave Marylebone,
    // and they gain 14 (external review, 18 Nov 2026). Each kind of weekday whose count differs has its row.
    test('the totals count one real day of each kind, a cell each under one label — a kind of weekday each, where they differ', () => {
        const html = renderTotals(TIMETABLES);
        assert.match(html, /<p class="field-eyebrow tr-totals-h">Trains a day leaving Marylebone<\/p>/);
        assert.match(html, /<ul class="tr-totals-days"><li class="tr-total"><span class="tr-total-day">Mon and Fri<\/span> <span class="tr-total-n">144 → <strong>158<\/strong><\/span> <span class="tr-delta tr-delta--up">\+14<\/span><\/li>/,
            'Mondays and Fridays first, as the week runs');
        assert.match(html, /<\/li><li class="tr-total"><span class="tr-total-day">Tue to Thu<\/span> <span class="tr-total-n">145 → <strong>158<\/strong><\/span> <span class="tr-delta tr-delta--up">\+13<\/span><\/li><li class="tr-total"><span class="tr-total-day">Saturdays/);
        assert.match(html, /<span class="tr-total-day">Sundays<\/span> <span class="tr-total-n">91 → <strong>94<\/strong>/);
        assert.equal((html.match(/<li class="tr-total">/g) ?? []).length, 4, 'two kinds of weekday, Saturdays and Sundays');
        assert.doesNotMatch(html, /Weekdays/, 'no row says a figure is every weekday\'s that is not');
        // Where every weekday has the same count — December's books run every weekday train every weekday — one row.
        const same = renderTotals({ now: TIMETABLES.dec, dec: TIMETABLES.dec });
        assert.match(same, /<li class="tr-total"><span class="tr-total-day">Weekdays<\/span> <span class="tr-total-n">158 → <strong>158<\/strong><\/span><\/li>/);
        assert.equal((same.match(/<li class="tr-total">/g) ?? []).length, 3);
    });
});

describe('the station card\'s own cells (v24.83)', () => {
    test('the December column is December\'s figures, never today\'s', () => {
        const view = stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'AYS', 'dep');
        const html = renderStation(view, { stations: STATIONS, dir: 'dep', showTrains: false });
        const cells = (/** @type {string} */ label) => [...(html.match(new RegExp(`<th scope="row">${label}</th><td>([^<]*)</td><td>([^<]*)</td>`)) ?? [])].slice(1);
        assert.deepEqual(cells('First train'), [view.now.first, /** @type {any} */ (view.dec).first]);
        assert.deepEqual(cells('Last train'), [view.now.last, /** @type {any} */ (view.dec).last]);
        assert.notEqual(view.now.first, /** @type {any} */ (view.dec).first, 'a station whose first train moves, so a swapped cell would show');
        assert.deepEqual(cells('Fastest journey'), [`${view.now.fastest} min`, `${/** @type {any} */ (view.dec).fastest} min`]);
    });
    test('a station\'s name is escaped wherever the card writes it', () => {
        const odd = { ...STATIONS, AYS: '<b>Aylesbury</b>' };
        const html = renderStation(stationView(TIMETABLES.now.SX.arr, TIMETABLES.dec.SX.arr, 'AYS', 'arr'), { stations: odd, dir: 'arr', showTrains: true, allTrains: true });
        assert.doesNotMatch(html, /<b>Aylesbury<\/b>/);
        assert.match(html, /&lt;b&gt;Aylesbury&lt;\/b&gt;/);
    });
});

describe('the UX pass (v24.92): leads and chips, the two lines, one train at a time, quiet leaf-fall rows', () => {
    const everyRow = Object.values(TIMETABLES).flatMap(t => Object.values(t).flatMap(d => [...d.dep, ...d.arr]));

    test('a headline is a lead, its detail and a chip — and its text is still the whole sentence', () => {
        const sx = headlineChanges(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, STATIONS);
        const ays = /** @type {NonNullable<ReturnType<typeof headlineChanges>[0]>} */ (sx.find(h => h.crs === 'AYS'));
        assert.equal(ays.lead, '6 more trains a day to Aylesbury');
        assert.equal(ays.chip, '+6 a day');
        assert.equal(ays.detail, '47, was 41 · they also stop at Amersham, Great Missenden, Wendover and Stoke Mandeville · 5 of them also stop at Harrow-on-the-Hill, Rickmansworth, Chorleywood and Chalfont & Latimer');
        // The sentence a test pins and a screen reader hears has not moved.
        assert.equal(ays.text, '6 more trains a day to Aylesbury (47, was 41); they also stop at Amersham, Great Missenden, Wendover and Stoke Mandeville; 5 of them also stop at Harrow-on-the-Hill, Rickmansworth, Chorleywood and Chalfont & Latimer');
        const sav = /** @type {any} */ (sx.find(h => h.crs === 'SAV'));
        assert.equal(sav.chip, 'New route');
        assert.equal(sav.lead, sav.text);
        assert.equal(sav.detail, '');
        assert.equal(sx.find(h => h.crs === 'HDM')?.chip, '−2 a day');
        const so = headlineChanges(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep, STATIONS);
        const htn = /** @type {any} */ (so.find(h => h.crs === 'HTN'));
        assert.deepEqual([htn.lead, htn.detail, htn.chip], ['Later last train to Hatton: 21:02', 'was 20:32', 'New times']);
        // A frequency change leads without its bracket, and the bracket is the detail.
        const bmo = /** @type {any} */ (so.find(h => h.crs === 'BMO'));
        assert.equal(bmo.lead, 'More trains to Birmingham Moor Street: usually 2 an hour in the daytime');
        assert.match(bmo.detail, /^was usually 1 · 4 more a day \(28, was 24\) · they also stop at/);
        assert.equal(bmo.chip, '+4 a day');
        // A withdrawn direct service, and a fold's clause landing in the detail of a line with no parts.
        const gone = headlineChanges([row('10:00', 'SAV', '', '', 'WRW1101 SAV1131')], [], STATIONS);
        assert.deepEqual([gone.find(h => h.crs === 'SAV')?.chip, gone.find(h => h.crs === 'SAV')?.lead], ['No direct trains', 'No more direct trains to Stratford-upon-Avon']);
        const onward = /** @type {any} */ (headlineChanges([], [row('10:02', 'BMO'), row('11:02', 'BSW')], STATIONS)[0]);
        assert.equal(onward.lead, 'New direct trains to Birmingham Moor Street: 2 a day');
        assert.equal(onward.detail, '1 more goes on to Snow Hill (1, was 0)');
        assert.equal(onward.text, `${onward.lead}; ${onward.detail}`);
    });

    test('stationBands: the two books\' lines, found from the rows', () => {
        const bands = stationBands(everyRow);
        assert.deepEqual(bands.map(b => b.label), ['Main line', 'Aylesbury via Amersham']);
        assert.deepEqual(bands[1].stations, ['HOH', 'RIC', 'CLW', 'CFO', 'AMR', 'GMN', 'WND', 'SKM', 'AYS', 'AVP']);
        assert.deepEqual([...bands[0].stations, ...bands[1].stations], [...STATION_ORDER], 'every station in one band, in the books\' order');
        // A Parkway train carries no route code and is still an Amersham-line train.
        assert.equal(stationBands([row('06:35', 'AVP', '', '', 'HOH0647 AYS0734 AVP0742')]).length, 2);
        // A via-Wycombe train calling at Harrow would make Harrow the main line's; the Parkway, still
        // only Amersham's, keeps a band of its own.
        const mixed = stationBands([row('06:35', 'AVP', '', '', 'HOH0647 AVP0742'), row('07:00', 'HWY', 'H', '', 'HOH0712 HWY0745')]);
        assert.ok(mixed[0].stations.includes('HOH') && mixed[1].stations.join() === 'AVP', JSON.stringify(mixed));
        // Nothing via Amersham: one band, and the grid then draws no band rows.
        assert.deepEqual(stationBands(hourly(6, 'OXF', ['HWY', 'OXF'])).map(b => b.label), ['Main line']);
    });

    test('renderGrid: every column head is a button; pressed, only that train\'s rows show; the lines are banded', () => {
        const nowG = stoppingGrid(TIMETABLES.now.SX.dep), decG = stoppingGrid(TIMETABLES.dec.SX.dep);
        const bands = stationBands(everyRow);
        const all = renderGrid(nowG, decG, 'dec', STATIONS, { bands });
        assert.equal((all.match(/class="tr-grid-colbtn"/g) ?? []).length, decG.columns.length);
        // The label is its own span: the cell spans every column, so only the span can be pinned left (trains.css).
        assert.match(all, /<tr class="tr-grid-band"><td colspan="\d+"><span class="tr-grid-band-label">Main line<\/span><\/td><\/tr>/);
        assert.match(all, /<span class="tr-grid-band-label">Aylesbury via Amersham<\/span><\/td>/);
        assert.match(all, /Choose a time at the top to show only where that train stops/);
        assert.doesNotMatch(all, /tr-grid-focus|tr-col-on|aria-pressed="true"/);
        const i = decG.columns.findIndex(c => c.end === 'OXF');
        const one = renderGrid(nowG, decG, 'dec', STATIONS, { focus: i, bands });
        const was = pairColumns(nowG.columns, decG.columns)[i];
        const rows = new Set([...decG.columns[i].calls, ...(was?.calls ?? [])]);
        assert.equal((one.match(/<tr><th scope="row"/g) ?? []).length, rows.size, 'the stations it stops at, and any it stopped at');
        assert.equal((one.match(/aria-pressed="true"/g) ?? []).length, 1);
        assert.match(one, /<th scope="col" class="tr-grid-colhead tr-col-on"><button/);
        // Every head cell carries the class that hands its padding to the button (v24.96): the whole
        // cell is the tap target, not the 28px of text inside it.
        assert.equal((one.match(/<th scope="col" class="tr-grid-colhead/g) ?? []).length, decG.columns.length);
        assert.match(one, /Only where the <strong>:06 to Oxford<\/strong> stops\. <button type="button" class="tr-more" id="trGridAll">Show every station<\/button>/);
        assert.doesNotMatch(one, /tr-grid-band/, 'one line\'s rows alone are not banded');
        assert.doesNotMatch(renderGrid(nowG, decG, 'dec', STATIONS), /tr-grid-band/, 'no bands passed, none drawn');
        assert.doesNotMatch(renderGrid(nowG, decG, 'dec', STATIONS, { focus: 99 }), /tr-col-on/, 'an out-of-range column is ignored');
        assert.match(renderGrid(nowG, decG, 'now', STATIONS, { bands }), /Aylesbury via Amersham<\/span><\/td>/, 'today\'s grid is banded too');
    });

    test('renderHeadlines: a bold lead and quieter detail; a bare text is the lead alone', () => {
        const html = renderHeadlines([{ crs: 'AYS', tone: 'more', text: 'T', lead: 'Lead', detail: 'Detail', chip: '+6 a day' },
            { crs: 'OXF', tone: 'less', text: 'Bare' }], { showAll: true, partial: false });
        assert.match(html, /<span class="tr-chip tr-chip--new">\+6 a day<\/span><span class="tr-head-text"><span class="tr-head-lead">Lead<\/span><span class="tr-head-detail">Detail<\/span><\/span>/);
        assert.match(html, /<span class="tr-chip tr-chip--gone">Fewer trains<\/span><span class="tr-head-text"><span class="tr-head-lead">Bare<\/span><\/span>/);
        // A row is "a change", as the ? panel calls it: on a railway page "choose a line" read as a railway line.
        assert.match(html, /is on its station’s card — choose a change above, or use Stations\./);
        assert.doesNotMatch(html, /choose a line/);
    });

    test('coming back on a leaf-fall line, a shift within the leaf-fall minutes is quiet text that says why — never via Wycombe, earlier, or going there', () => {
        const view = stationView(TIMETABLES.now.SX.arr, TIMETABLES.dec.SX.arr, 'AYS', 'arr');
        const leaf = { minutes: 3, until: '10 January' };
        const html = renderStation(view, { stations: STATIONS, dir: 'arr', showTrains: true, allTrains: true, leafFall: leaf });
        const quiet = view.trains?.filter(t => t.kind === 'later' && (t.shift ?? 0) <= 3 && /** @type {any} */ (t).via !== 'H') ?? [];
        const loud = view.trains?.filter(t => t.kind === 'later' && (t.shift ?? 0) <= 3 && /** @type {any} */ (t).via === 'H') ?? [];
        assert.ok(quiet.length > 0, 'the real Aylesbury card has such rows');
        assert.equal((html.match(/tr-chip--same">\d mins? later · may be leaf fall</g) ?? []).length, quiet.length);
        assert.equal((html.match(/tr-chip--moved">[123] mins? later</g) ?? []).length, loud.length, 'a via-Wycombe train keeps its chip: leaf fall is the Amersham line\'s');
        assert.match(html, /tr-chip--moved">\d+ mins later</, 'a bigger shift keeps its chip');
        assert.match(html, new RegExp(`${quiet.length} of them by 3 minutes or less, which may be leaf fall`));
        assert.doesNotMatch(html, /earlier · may be leaf fall/);
        const dep = renderStation(stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'AYS', 'dep'), { stations: STATIONS, dir: 'dep', showTrains: true, allTrains: true, leafFall: leaf });
        assert.doesNotMatch(dep, /may be leaf fall/);
        assert.doesNotMatch(renderStation(view, { stations: STATIONS, dir: 'arr', showTrains: true, allTrains: true }), /may be leaf fall/);
    });
});


describe('the eight improvements (v24.94): Last trains, the remembered station, one list when the lists match', () => {
    const DATES = { change: CHANGE_DATE, festiveUntil: FURTHER_CHANGES_UNTIL, validUntil: DEC_VALID_UNTIL };
    const at = (/** @type {string} */ iso) => timetablePhase(new Date(iso), DATES);

    // The caveat by phase was the first of the eight (caveatWords). Owner, 2 Nov 2026: "Can we lose the
    // December times can still change card. This is the confirmed final timetable." It went in every
    // phase (trains-change.js → JOURNEY_PLANNER_URL has why), so what is held now is the absence — and
    // that the journey planner the line linked is still offered, by the overview's ? panel.
    test('no caveat line beneath the tabs, and the planner it linked is still one tap away (v25.13)', () => {
        const page = readFileSync(new URL('./trains.html', REPO_ROOT_URL), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        // The coordinator and the module that paints its cards — either could write the line again.
        const app = ['./trains-app.js', './trains-cards.js'].map(f => readFileSync(new URL(f, REPO_ROOT_URL), 'utf8')).join('\n');
        assert.doesNotMatch(page, /id="trCaveat"|tr-caveat-line/, 'the line is back in trains.html');
        assert.doesNotMatch(page, /can still change/i, 'the page says the timetable can still change');
        assert.doesNotMatch(app, /trCaveat/, 'trains-app.js or trains-cards.js writes a caveat line again');
        // The panels' own strings, as the lightbox renders them (JSON would escape the link's quotes).
        const html = (/** @type {any} */ panel) => panel.sections.flatMap((/** @type {any} */ s) => s.items.map((/** @type {any} */ i) => i.html)).join(' ');
        const all = Object.values(CARD_TIPS).map(html).join(' ');
        assert.doesNotMatch(all, /can still change|they can change/i, 'a ? panel says the timetable can still change');
        const overview = html(CARD_TIPS.overview);
        assert.ok(overview.includes(`href="${JOURNEY_PLANNER_URL}"`), 'the overview ? panel no longer links the journey planner');
        assert.match(overview, /<a href="[^"]+" target="_blank" rel="noopener noreferrer">the journey planner<\/a>/, 'the planner link opens without handing the page its opener');
    });

    test('lastTrains — the station card\'s own "Last train" for every station, in the books\' order, with how it moved', () => {
        const rows = lastTrains(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep);
        assert.ok(rows.length > 20);
        assert.ok(rows.every(r => r.now || r.dec), 'a station with no train either side is left out');
        const beac = rows.find(r => r.crs === 'BCF');
        assert.deepEqual(beac, { crs: 'BCF', now: '00:10', dec: '00:10', shift: 0, kind: 'same' });
        assert.equal(beac?.now, summarise(TIMETABLES.now.SX.dep, 'BCF', 'dep').last, 'never disagrees with the station card');
        // The books' order: the stations STATION_ORDER knows come in its order.
        const ranks = rows.map(r => STATION_ORDER.indexOf(r.crs)).filter(i => i >= 0);
        assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
        // Saturdays: Hatton's last train moves half an hour later (the headline says so too).
        const hatton = /** @type {string} */ (Object.keys(STATIONS).find(k => STATIONS[k] === 'Hatton'));
        const sat = lastTrains(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep).find(r => r.crs === hatton);
        assert.deepEqual(sat, { crs: hatton, now: '20:32', dec: '21:02', shift: 30, kind: 'later' });
    });

    // The Last trains ? panel said the Monday-and-Friday trains are left out "as they are from the figures on
    // a station's card" — true until the card began naming the days its figures are for (external review, 18
    // Nov 2026). What a colleague needs is the answer to "is that Friday's last train too?", and it is: every
    // weekday's last trains are the same. A timetable that makes it untrue fails here, and the panel must
    // then name the days as a station's card does (trains-weekdays.js → `weekdayGroups`).
    test('the Last trains panel says a weekday\'s last trains are every weekday\'s — and they are', () => {
        const panel = CARD_TIPS.last.sections.flatMap(s => s.items.map(i => i.html)).join(' ');
        assert.match(panel, /On weekdays the last trains are the same every day, Monday to Friday\./);
        const usual = lastTrains(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep);
        for (const day of WEEKDAYS) {
            assert.deepEqual(lastTrains(onWeekday(TIMETABLES.now.SX.dep, day), onWeekday(TIMETABLES.dec.SX.dep, day)), usual,
                `${day}'s last trains differ from the panel's: name the days in the panel (trains-render.js → renderLastTrains) and reword trains-tips.js`);
        }
        const mfo = /** @type {any} */ (TIMETABLES.now.SX.dep.find(r => r[3] === 'MFO'));
        assert.ok(mfo, 'premise: a weekday train runs on Mondays and Fridays only');
        const crs = mfo[1];
        const view = stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, crs, 'dep', { change: CHANGE_DATE, started: false });
        assert.equal(view.now.total, aRealDay(TIMETABLES.now.SX.dep).filter(r => callsOf(r).includes(crs)).length, 'the figures count one real day');
        assert.match(renderStation(view, { stations: STATIONS, dir: 'dep', showTrains: true, allTrains: true }), /Mon and Fri only/,
            'and the list under them names the Monday-and-Friday train, with its days');
    });

    test('renderLastTrains — banded by line, the moved time bold with a chip, a kept time quiet', () => {
        const labels = { old: 'Now', new: 'From 13 Dec' };
        const bands = stationBands([...TIMETABLES.now.SO.dep, ...TIMETABLES.dec.SO.dep]);
        const html = renderLastTrains(lastTrains(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep), { stations: STATIONS, labels, bands });
        assert.match(html, /<thead><tr><th scope="col">Station<\/th><th scope="col">Now<\/th><th scope="col">From 13 Dec<\/th>/);
        assert.match(html, /<tr class="tr-last-band"><td colspan="4">Main line<\/td><\/tr>/);
        assert.match(html, /<tr class="tr-last-band"><td colspan="4">Aylesbury via Amersham<\/td><\/tr>/);
        assert.match(html, /<th scope="row">Hatton<\/th><td>20:32<\/td><td><strong>21:02<\/strong><\/td><td><span class="tr-chip tr-chip--moved">30 mins later<\/span><\/td>/);
        assert.match(html, /<th scope="row">Beaconsfield<\/th><td>00:10<\/td><td>00:10<\/td><td><\/td>/, 'unchanged: no bold, no chip');
        assert.equal(renderLastTrains([], { stations: STATIONS, labels }), '<p class="card-explainer tr-lead">No trains.</p>');
        const gone = renderLastTrains([{ crs: 'BCF', now: '23:00', dec: null, shift: null, kind: 'gone' }, { crs: 'HWY', now: null, dec: '23:30', shift: null, kind: 'new' }], { stations: STATIONS, labels });
        assert.match(gone, /No train<\/span>/); assert.match(gone, /tr-chip--new">New<\/span>/);
        assert.doesNotMatch(gone, /tr-last-band/, 'one line alone is not banded');
        // The chips' column is named for a screen reader in the tense of the change, as the station card's is.
        // On screen too, as Train by train's is (words review, Nov 2026): unheaded, a chip did not say which time moved.
        assert.match(html, /<th scope="col">What changes<\/th><\/tr><\/thead>/);
        assert.match(renderLastTrains(lastTrains(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep), { stations: STATIONS, labels, bands, started: true }),
            /<th scope="col">What changed<\/th><\/tr><\/thead>/);
    });

    test('renderPicks — the remembered station first as "You looked at", once, and never while typing', () => {
        const base = { typed: false, selected: null, stations: STATIONS };
        const html = renderPicks(['HWY', 'BCF', 'GER'], { ...base, last: 'BCF' });
        assert.match(html, /^<p class="tr-picks-label">You looked at<\/p><button type="button" class="tr-pick" data-station="BCF" aria-pressed="false">Beaconsfield<\/button><p class="tr-picks-label">Busiest stations<\/p>/);
        assert.equal((html.match(/data-station="BCF"/g) ?? []).length, 1, 'offered once, not twice');
        assert.doesNotMatch(renderPicks(['HWY', 'BCF'], { ...base, typed: true, last: 'BCF' }), /You looked at/);
        assert.doesNotMatch(renderPicks(['HWY'], { ...base, last: 'XXX' }), /You looked at/, 'a code the books do not know is ignored');
        assert.doesNotMatch(renderPicks(['HWY'], base), /You looked at/);
    });

    test('renderLookup — two identical near lists are shown once; a train only one side has is marked', () => {
        const common = { started: false, labels: { old: 'Now', new: 'From 13 Dec' }, change: CHANGE_DATE, stations: STATIONS };
        const same = renderLookup({ at: '17:16', day: 'SO', nowRows: TIMETABLES.now.SO.dep, decRows: TIMETABLES.dec.SO.dep, ...common });
        assert.match(same, /— <strong>the same trains<\/strong> in both timetables:<\/p><div class="tr-near-cols tr-near-cols--one">/);
        assert.doesNotMatch(same, /tr-near-head|tr-near-only/);
        const differ = renderLookup({ at: '10:36', day: 'SX', nowRows: TIMETABLES.now.SX.dep, decRows: TIMETABLES.dec.SX.dep, ...common });
        assert.equal((differ.match(/tr-near-head/g) ?? []).length, 2);
        assert.match(differ, /<li class="tr-near-only"><span class="tr-near-time">10:36<\/span> Banbury<span class="sr-only"> — only in this timetable<\/span><\/li>/);
        assert.doesNotMatch(differ, /tr-near-only"><span class="tr-near-time">10:40/, 'a train both sides have is not marked');
    });
});

describe('the 72-hour review (v24.96): one train is one train, "Same time" over a changed stop, dates derived', () => {
    const args = (/** @type {string} */ at, /** @type {'SX'|'SO'|'SU'} */ day, extra = {}) => ({
        at, day, nowRows: TIMETABLES.now[day].dep, decRows: TIMETABLES.dec[day].dep, started: false,
        labels: { old: 'Now', new: 'From 13 Dec' }, change: CHANGE_DATE, stations: STATIONS, ...extra });

    test('the near lists never mark a train "only in this timetable" when the other side runs it at the same time, end and route', () => {
        // The Tue–Thu 17:33 to Snow Hill and December's every-weekday 17:33 are one train; so are the
        // two 17:45 Oxford variants and December's one. v24.94 keyed on the days and marked all of them.
        const h = renderLookup(args('17:33', 'SX'));
        assert.doesNotMatch(h, /tr-near-only"><span class="tr-near-time">17:33/, 'the 17:33 to Snow Hill is on both sides');
        assert.doesNotMatch(h, /tr-near-only"><span class="tr-near-time">17:45/, 'the 17:45 to Oxford is on both sides');
        // A time only one side has at all is still marked (the 17:37 Princes Risborough became the 17:41).
        assert.match(h, /tr-near-only"><span class="tr-near-time">17:37<\/span> Princes Risborough/);
        assert.match(h, /tr-near-only"><span class="tr-near-time">17:41<\/span> Princes Risborough/);
    });

    test('a difference in the days alone is neither "the same trains" nor a train only one side has', () => {
        const decRows = TIMETABLES.dec.SX.dep;
        const days = TIMETABLES.now.SX.dep.find(r => r[3])?.[3];
        assert.ok(days, 'the current weekday book has a train with a days exception');
        // December's own rows as "now", with one of them running on some days only.
        const nowRows = decRows.map(r => r[0] === '17:33' ? [r[0], r[1], r[2], days, ...r.slice(4)] : r);
        const h = renderLookup(args('17:33', 'SX', { nowRows, decRows }));
        assert.equal((h.match(/tr-near-head/g) ?? []).length, 2, 'two columns: the days changed');
        assert.doesNotMatch(h, /the same trains/);
        assert.doesNotMatch(h, /tr-near-only/, 'and no train is marked as only one side\'s');
    });

    test('"Same time" heads an answer whose stops changed; "No change" stays for a train nothing happened to', () => {
        const a = renderLookup(args('09:02', 'SX'));
        assert.match(a, /<strong>The 09:02 to Birmingham Moor Street:<\/strong> Same time\. From 13 December it also stops at Kings Sutton\./);
        assert.doesNotMatch(a, /No change\. From 13 December/);
        const sat = renderLookup(args('08:02', 'SO'));
        // "Or", not "and": it stops at none of the three, and "does not stop at A and B" read as "not at both".
        assert.match(sat, /Same time\. From 13 December it no longer stops at Kings Sutton, Hatton or Lapworth\./);
        assert.match(renderLookup(args('08:35', 'SX')), /From 13 December it no longer stops at Haddenham &amp; Thame Parkway or Kings Sutton\./);
        for (const time of ['08:35', '17:07', '17:45', '18:07']) {
            const html = renderLookup(args(time, 'SX'));
            assert.doesNotMatch(html, /does not stop at/, `the ${time}: the old wording`);
            const lost = html.match(/no longer stops at (.*?)(?:, and also stops at |\.<\/p>)/)?.[1];
            assert.ok(lost, `premise: the ${time} loses a stop on the way`);
            assert.doesNotMatch(lost, / and /, `the ${time}: its lost stops are listed with "and" — "${lost}"`);
        }
        // Somewhere in the weekday book a train neither moves nor changes a stop: its answer is still "No change."
        const untouched = TIMETABLES.now.SX.dep.map(r => renderLookup(args(r[0], 'SX'))).find(h => /No change\.<\/p>/.test(h));
        assert.ok(untouched, 'a train with nothing changed keeps the plain answer');
    });

    test('the verdicts take the change date from the data, and drop "now or from" once it has come', () => {
        const sav = Object.keys(STATIONS).find(c => /Stratford/.test(STATIONS[c]));
        assert.ok(sav, 'Stratford-upon-Avon is in the station table');
        const now = TIMETABLES.now.SX.dep, dec = TIMETABLES.dec.SX.dep;
        assert.equal(stationView(now, dec, sav, 'dep', { change: CHANGE_DATE }).verdict.text, 'New from 13 December: one direct train, the 09:31.');
        assert.match(stationView(now, dec, sav, 'dep', { change: '2027-05-16' }).verdict.text, /^New from 16 May: /, 'moving the constant moves the sentence');
        assert.equal(stationView(now, dec, sav, 'dep').verdict.text, 'New from 13 December: one direct train, the 09:31.', 'no date given: the data module\'s');
        // A station no Saturday train reaches on either side reads "now or from" before the change and not after.
        const none = STATION_ORDER.find(c => { const v = stationView(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep, c, 'dep', { change: CHANGE_DATE }); return /^No direct trains from Marylebone on this day, now or from 13 December\.$/.test(v.verdict.text); });
        assert.ok(none, 'such a station exists in the Saturday books');
        assert.equal(stationView(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep, none, 'dep', { change: CHANGE_DATE, started: true }).verdict.text, 'No direct trains from Marylebone on this day.');
    });
});

describe('the whole-app fix (Nov 2026): the overview\'s words by date, and the sign-in card\'s words', () => {
    test('the opening line turns at the change, its days read from the date', () => {
        assert.equal(leadWords(CHANGE_DATE, false), 'This page compares today’s timetable with the new one that starts on Sunday 13 December. Both are Chiltern’s published timetables, not live running information.');
        assert.equal(leadWords(CHANGE_DATE, true), 'This page compares the timetable that ran until Saturday 12 December with the new one, which started on Sunday 13 December. Both are Chiltern’s published timetables, not live running information.');
        assert.match(leadWords('2027-05-16', false), /starts on Sunday 16 May\./, 'moving the date moves the sentence');
    });

    test('the changes view is named in the tense of the change', () => {
        assert.equal(changesTitle(false), 'What’s changing');
        assert.equal(changesTitle(true), 'What changed');
    });

    // It was typed into trains.html: "Christmas and New Year are not on this page. Chiltern is changing
    // times again between 13 December and 10 January" — with only its switch generated.
    test('the further-changes note is worded from its two dates, and names only the holidays inside them', () => {
        // `&nbsp;` inside each date, as the typed copy had it: a date breaking after its day number
        // ("13" at a line's end, "December" on the next) is what the generated sentence did at 390px.
        assert.equal(renderFurtherChanges(CHANGE_DATE, FURTHER_CHANGES_UNTIL),
            '<strong>Christmas and New Year times are not on this page.</strong> Chiltern is changing some times between 13&nbsp;December and 10&nbsp;January, most of all over the holidays.');
        assert.equal(renderFurtherChanges('2026-12-13', '2026-12-28'),
            '<strong>Christmas times are not on this page.</strong> Chiltern is changing some times between 13&nbsp;December and 28&nbsp;December, most of all over the holidays.');
        assert.equal(renderFurtherChanges('2027-05-16', '2027-06-13'),
            '<strong>Chiltern’s further changes are not on this page.</strong> Chiltern is changing some times between 16&nbsp;May and 13&nbsp;June.');
        // It is the holidays' TIMES that are missing, and "again" had no first time before the change.
        assert.doesNotMatch(renderFurtherChanges(CHANGE_DATE, FURTHER_CHANGES_UNTIL), /again|(?:Year|Christmas) (?:is|are) not/);
        // And the page carries no copy of it to go stale: the paragraph is written by the script alone.
        const page = readFileSync(new URL('./trains.html', REPO_ROOT_URL), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        assert.match(page, /<p class="card-explainer tr-festive" id="trFestive" hidden><\/p>/);
    });

    test('a station card with no labels given names the columns from the change date, never a typed one', () => {
        const html = renderStation(stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'HWY', 'dep'), { stations: STATIONS, dir: 'dep', showTrains: false });
        assert.match(html, new RegExp(`<th scope="col">Now</th><th scope="col">From ${dateWords(CHANGE_DATE, 0, { short: true })}</th>`));
        assert.equal(timetablePhase(new Date(2026, 9, 1), { change: CHANGE_DATE, festiveUntil: FURTHER_CHANGES_UNTIL, validUntil: DEC_VALID_UNTIL }).newLabel,
            `From ${dateWords(CHANGE_DATE, 0, { short: true })}`, 'the same words timetablePhase gives the page');
    });

    // The staff PIN is retired (owner, 23 Nov 2026): the card's PIN line and its "Use the staff PIN instead"
    // link to the Calendar's PIN card went with it.
    test('the Trains sign-in card says what the page is for, and no longer sends anybody to a PIN', () => {
        // What the page is for comes first, as on every other page's card, its date held together.
        assert.deepEqual(SIGN_IN_ABOUT.lines, ['Chiltern’s trains from Marylebone before and after the timetable change on 13\u00a0December: by station, by time, and where each train stops.']);
        assert.equal('link' in SIGN_IN_ABOUT, false, 'the link to the Calendar\'s PIN card is gone');
        assert.doesNotMatch(JSON.stringify(SIGN_IN_ABOUT), /PIN|staff-pin/);
    });
});

// ── WHAT THE ? PANELS AND THE CARDS SAY ABOUT WHAT THE PAGE DRAWS (whole-app check, Nov 2026) ──────────────
describe('the panels name what the page draws, and an ended timetable says so where it answers', () => {
    /** A panel's items, as the lightbox renders them. @param {keyof typeof CARD_TIPS} key */
    const panel = (key) => CARD_TIPS[key].sections.flatMap(s => s.items.map(i => i.html)).join(' ');

    // The panel explained "More trains", "Fewer trains" and "Times move" while the list showed "+6 a day", "−2 a day"
    // and "New route": the two words are for a change whose count a day stays put, which no line of the real books has.
    // Every kind of chip `headlineChanges` writes is made here — from the books, and from hand-made rows for the kinds
    // the books do not hold — and the panel must quote each; a chip of a kind this test does not know fails it.
    test('the changes panel quotes every kind of chip the list can show', () => {
        const words = panel('changes');
        const twoAnHour = [...hourly(6, 'OXF'), ...hourly(36, 'OXF')];
        const sameDayFewerHourly = [...hourly(6, 'OXF'), ...['06:05', '06:35', '07:05', '07:35', '08:05', '08:35'].map(t => row(t, 'OXF'))];
        const chips = new Set([
            ...headlineChanges(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, STATIONS),
            ...headlineChanges(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep, STATIONS),
            ...headlineChanges([row('10:00', 'SAV', '', '', 'WRW1101 SAV1131')], [], STATIONS),   // a direct service withdrawn
            ...headlineChanges(twoAnHour, sameDayFewerHourly, STATIONS),                           // the same count a day, fewer an hour
            ...headlineChanges(sameDayFewerHourly, twoAnHour, STATIONS),                           // …and more an hour
        ].map(h => h.chip));
        const FIXED = ['New route', 'No direct trains', 'New times', 'More trains', 'Fewer trains'];
        for (const chip of FIXED) {
            assert.ok(chips.has(chip), `premise: no line was made with the chip "${chip}"`);
            assert.ok(words.includes(`<strong>${chip}</strong>`), `the changes panel does not explain the chip "${chip}"`);
        }
        const counted = [...chips].filter(c => !FIXED.includes(c));
        assert.deepEqual(counted.filter(c => !/^[+−]\d+ a day$/.test(c)), [], 'a chip of a kind this test does not know — explain it in the panel, then here');
        for (const sign of ['+', '−']) {
            assert.ok(counted.some(c => c.startsWith(sign)), `premise: no "${sign}N a day" chip was made`);
            assert.match(words, new RegExp(`<strong>\\${sign}\\d+ a day</strong>`), `the panel does not show a "${sign}N a day" chip as the list writes it`);
        }
    });

    // Since the whole-app review the grid draws a stop gained as a ring with a plus and one lost as a ring struck
    // through — as a green ring and a red one they were 1.04:1 apart in lightness — and the panel went on teaching
    // the colours, the one cue the page had stopped relying on. The shapes are read off trains.css.
    test('the pattern panel names a stop gained and a stop lost by the shapes the grid draws', () => {
        const css = readFileSync(new URL('./trains.css', REPO_ROOT_URL), 'utf8');
        const rule = (/** @type {string} */ cls) => css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
        const gained = rule('tr-dot--new'), lost = rule('tr-dot--lost');
        assert.match(gained, /inset 0 0 0 2px/, 'premise: a stop gained is drawn as a ring');
        assert.match(gained, /6px 2px[\s\S]*2px 6px/, 'premise: with a plus in it — a bar each way');
        assert.match(lost, /inset 0 0 0 2px/, 'premise: a stop lost is drawn as a ring');
        assert.match(lost, /linear-gradient\(135deg/, 'premise: struck through — one diagonal bar');
        const words = panel('pattern');
        assert.match(words, /A ring with a plus is a stop a train gains/);
        assert.match(words, /a ring struck through is one it loses/);
        assert.doesNotMatch(words, /green ring|hollow|red dot/i, 'the colours the marks no longer rely on');
    });

    // From the end of December's books only the overview said the timetables had ended; the lookup and the station card
    // answered from them in the present tense — "The 17:15 to Oxford: Same time as before 13 December".
    const ENDED = /^<p class="card-explainer tr-lead"><strong>These times come from timetables that have ended\.<\/strong> Check <a href="([^"]+)" target="_blank" rel="noopener noreferrer">the journey planner<\/a> for today’s trains\.<\/p>/;
    const labels = { old: 'Until 12 Dec', new: 'From 13 Dec' };

    test('once both timetables have ended, a station card says so before anything else — and only then', () => {
        for (const dir of /** @type {const} */ (['dep', 'arr'])) {
            const view = stationView(TIMETABLES.now.SX[dir], TIMETABLES.dec.SX[dir], 'BCF', dir, { change: CHANGE_DATE, started: true });
            const ctx = { stations: STATIONS, dir, showTrains: false, labels, started: true };
            assert.equal(renderStation(view, { ...ctx, ended: true }).match(ENDED)?.[1], JOURNEY_PLANNER_URL, `${dir}: the line, first, linking the planner`);
            assert.doesNotMatch(renderStation(view, ctx), /timetables that have ended/, `${dir}: not while the books run`);
        }
        // A station no train reaches that day, whose verdict is the whole card, says it too.
        const none = stationView(TIMETABLES.now.SU.dep, TIMETABLES.dec.SU.dep, 'BER', 'dep', { change: CHANGE_DATE, started: true });
        assert.ok(none.dec && !none.now.total && !none.dec.total, 'premise: no Sunday train from Marylebone calls at Bearley, in either timetable');
        assert.match(renderStation(none, { stations: STATIONS, dir: 'dep', showTrains: false, labels, started: true, ended: true }), ENDED);
    });

    test('once both timetables have ended, the lookup says so before its answer — with a train at that time and without', () => {
        const look = (/** @type {'SX'|'SO'} */ day, /** @type {string} */ at, ended = true) => renderLookup({ at, day, nowRows: TIMETABLES.now[day].dep,
            decRows: TIMETABLES.dec[day].dep, started: true, ended, labels, change: CHANGE_DATE, stations: STATIONS });
        assert.match(look('SX', '17:15'), ENDED);
        assert.match(look('SX', '17:15'), /<\/p><p class="tr-answer"><strong>The 17:15 to Oxford:<\/strong>/, 'and then the answer');
        assert.match(look('SO', '17:16'), ENDED, 'no train at exactly that time, and the near lists shown once');
        assert.match(look('SX', '10:36'), ENDED, 'the near lists in two columns');
        assert.doesNotMatch(look('SX', '17:15', false), /timetables that have ended/);
    });
});

// WHERE THE WEEKDAYS DISAGREE, THE PAGE NAMES THEM, AND A GAIN IS SAID WITH ITS COST (external review,
// 18 Nov 2026). "Weekdays 145 → 158, +13" was a Tuesday to Thursday's — on a Monday or Friday 144 leave
// Marylebone, and they gain 14. Princes Risborough's card said "1 fewer train a day" of a Monday that has
// the same number. And Aylesbury's said "6 more trains a day" above a table whose first train moved 34
// minutes earlier and whose fastest journey grew by 2 minutes, neither of which it said.
describe('the days a figure is true of, and the rest of what changed (external review, 18 Nov 2026)', () => {
    /** @returns {import('./trains-stations.js').StationSummary} */
    const s = (/** @type {Partial<import('./trains-stations.js').StationSummary>} */ o) => ({ total: 10, hourCounts: [2, 2, 2, 2, 2, 2], daytime: 12,
        hourRange: /** @type {[number, number]} */ ([2, 2]), typical: 2, minutes: [6, 36], fastest: 50, first: '06:30', last: '23:00', ...o });
    const none = { total: 0, hourCounts: [0, 0, 0, 0, 0, 0], daytime: 0, hourRange: /** @type {[number, number]} */ ([0, 0]), typical: 0, minutes: [], fastest: null, first: null, last: null };
    const view = (/** @type {'dep'|'arr'} */ dir, /** @type {string} */ crs) => stationView(TIMETABLES.now.SX[dir], TIMETABLES.dec.SX[dir], crs, dir);
    /** A train counted by "N are different" (trains-verdict.js → `leadOf`): one of December's, kept and moved, or new here. */
    const isDifferent = (/** @type {any} */ t) => !!t.dec && (!t.now || t.kind !== 'same' || (t.farShift ?? 0) !== 0);

    test('runsOn: each weekday exception the books document, and every day for none', () => {
        const on = (/** @type {string} */ code) => WEEKDAYS.filter(d => runsOn(code, d));
        assert.deepEqual(on('MFO'), ['Mon', 'Fri']);
        assert.deepEqual(on('MFX'), ['Tue', 'Wed', 'Thu']);
        assert.deepEqual(on('WO'), ['Wed']);
        assert.deepEqual(on(''), [...WEEKDAYS]);
        assert.equal(REAL_DAY, 'Tue', 'one real day is a Tuesday, as a Wednesday and a Thursday are');
        // Each code's days, written short, are what a train's days say beneath its time.
        for (const code of ['MFO', 'MFX', 'WO']) assert.equal(daysLabel(code), `${weekdayWords(WEEKDAYS.filter(d => runsOn(code, d)), { short: true })} only`, code);
    });

    test('daysCode: some weekdays as a train\'s days — the books\' own code where one fits, else the days, which runsOn reads', () => {
        // A station card lists a December train on the days nothing else carries it (`stationTrains`).
        assert.deepEqual([daysCode(['Mon', 'Fri']), daysCode(['Tue', 'Wed', 'Thu']), daysCode(['Wed']), daysCode([...WEEKDAYS])], ['MFO', 'MFX', 'WO', '']);
        const rest = daysCode(['Mon', 'Tue', 'Thu', 'Fri']);
        assert.equal(rest, 'Mon Tue Thu Fri', 'no code names every weekday but Wednesday');
        assert.deepEqual(WEEKDAYS.filter(d => runsOn(rest, d)), ['Mon', 'Tue', 'Thu', 'Fri']);
        assert.equal(daysLabel(rest), 'Mon, Tue, Thu and Fri only');
        assert.equal(daysLabel(daysCode(['Tue', 'Thu'])), 'Tue and Thu only');
        assert.equal(daysLabel('XYZ'), '', 'a code nobody knows is no label');
    });

    test('every day code in the books is one runsOn knows, and only a weekday table carries one', () => {
        for (const side of /** @type {const} */ (['now', 'dec'])) for (const day of /** @type {const} */ (['SX', 'SO', 'SU'])) for (const dir of /** @type {const} */ (['dep', 'arr'])) {
            for (const r of TIMETABLES[side][day][dir]) {
                assert.ok(['', 'MFO', 'MFX', 'WO'].includes(r[3]), `${side} ${day} ${dir} ${r[0]}: "${r[3]}" — teach runsOn the code, or it is counted every day`);
                if (day !== 'SX') assert.equal(r[3], '', `${side} ${day} ${dir} ${r[0]}: a weekday exception on a weekend table`);
            }
        }
    });

    test('onWeekday: one weekday\'s trains, their codes settled so every one of them counts', () => {
        const rows = [row('17:33', 'BSW', '', 'MFX', 'BAN1841'), row('17:37', 'BSW', '', 'MFO', 'BAN1841'), row('18:00', 'BSW', '', '', 'BAN1900'), row('12:00', 'BSW', '', 'WO', 'BAN1300')];
        assert.deepEqual(onWeekday(rows, 'Mon').map(r => `${r[0]}${r[3]}`), ['17:37', '18:00'], 'the Monday train, its code cleared');
        assert.deepEqual(onWeekday(rows, 'Wed').map(r => r[0]), ['17:33', '18:00', '12:00']);
        assert.equal(summarise(onWeekday(rows, 'Mon'), 'BAN', 'dep').total, 2, 'a Monday counts its Monday train');
        assert.equal(summarise(onWeekday(rows, 'Wed'), 'BAN', 'dep').total, 3, 'and a Wednesday its Wednesday one');
        assert.equal(summarise(rows, 'BAN', 'dep').total, 2, 'one real day, a Tuesday, has neither');
    });

    test('weekdayGroups: the weekdays a figure agrees on, in the order of the week — one group where nothing differs', () => {
        const count = (/** @type {import('./trains-change.js').TrainRow[]} */ rows) => rows.length;
        const plain = [row('10:00'), row('11:00')];
        assert.deepEqual(weekdayGroups(plain, [row('10:00')], count), [{ days: [...WEEKDAYS], now: 2, dec: 1 }]);
        // The real weekday departures: Mondays and Fridays first, as the week runs.
        assert.deepEqual(weekdayGroups(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, count),
            [{ days: ['Mon', 'Fri'], now: 144, dec: 158 }, { days: ['Tue', 'Wed', 'Thu'], now: 145, dec: 158 }]);
        // A Wednesdays-only train parts Wednesday from the rest.
        assert.deepEqual(weekdayGroups([...plain, row('12:00', 'OXF', '', 'WO')], plain, count).map(g => g.days), [['Mon', 'Tue', 'Thu', 'Fri'], ['Wed']]);
        // Two days are one group only if both timetables agree on them.
        assert.deepEqual(weekdayGroups(plain, [row('10:00', 'OXF', '', 'MFO')], count),
            [{ days: ['Mon', 'Fri'], now: 2, dec: 1 }, { days: ['Tue', 'Wed', 'Thu'], now: 2, dec: 0 }]);
    });

    test('weekdayWords: a run of three days or more is a range, anything else a list — or short, as a train\'s days are marked', () => {
        const both = (/** @type {any} */ days) => [weekdayWords(days), weekdayWords(days, { short: true })];
        assert.deepEqual(both(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']), ['Weekdays', 'Mon to Fri']);
        assert.deepEqual(both(['Mon', 'Fri']), ['Mondays and Fridays', 'Mon and Fri']);
        assert.deepEqual(both(['Tue', 'Wed', 'Thu']), ['Tuesday to Thursday', 'Tue to Thu']);
        assert.deepEqual(both(['Mon', 'Tue', 'Wed', 'Thu']), ['Monday to Thursday', 'Mon to Thu']);
        assert.deepEqual(both(['Wed']), ['Wednesdays', 'Wed']);
        assert.deepEqual(both(['Mon', 'Tue']), ['Mondays and Tuesdays', 'Mon and Tue'], 'two days are a pair, never a range');
        assert.deepEqual(both(['Mon', 'Tue', 'Thu', 'Fri']), ['Mondays, Tuesdays, Thursdays and Fridays', 'Mon, Tue, Thu and Fri']);
    });

    test('balanceFacts: the rest of what changed, each only past its bar, the sentence\'s way first', () => {
        const more = { tone: 'more', kind: 'daily' };
        assert.deepEqual([EDGE_SHIFT_MIN, JOURNEY_SHIFT_MIN], [10, 2]);
        // Under the bars, nothing: 9 minutes at either end, a minute on the journey.
        assert.deepEqual(balanceFacts(s({}), s({ fastest: 51, first: '06:21', last: '23:09' }), more), []);
        // At the bars, each fact with both figures — the gains first under a sentence of more trains…
        const moved = s({ fastest: 52, first: '06:20', last: '23:10' });
        assert.deepEqual(balanceFacts(s({}), moved, more),
            ['First train earlier: 06:20, was 06:30.', 'Last train later: 23:10, was 23:00.', 'Fastest journey 2 minutes longer: 52 min, was 50.']);
        // …and the costs first under a sentence of fewer, so the facts that agree with it are read with it.
        assert.deepEqual(balanceFacts(s({}), moved, { tone: 'less', kind: 'daily' }),
            ['Fastest journey 2 minutes longer: 52 min, was 50.', 'First train earlier: 06:20, was 06:30.', 'Last train later: 23:10, was 23:00.']);
        assert.deepEqual(balanceFacts(s({}), s({ fastest: 47, first: '06:45', last: '22:40' }), more),
            ['Fastest journey 3 minutes shorter: 47 min, was 50.', 'First train later: 06:45, was 06:30.', 'Last train earlier: 22:40, was 23:00.']);
        // A sentence about the daytime hour is followed by the day's count, when that changed too.
        assert.deepEqual(balanceFacts(s({}), s({ total: 15 }), { tone: 'more', kind: 'hour' }), ['5 more trains a day: 15, was 10.']);
        assert.deepEqual(balanceFacts(s({}), s({}), { tone: 'more', kind: 'hour' }), []);
        assert.deepEqual(balanceFacts(s({}), s({ total: 15 }), more), [], 'a sentence that is the count is not followed by it');
        // After midnight is later, not earlier: the railway day runs on past it.
        assert.deepEqual(balanceFacts(s({}), s({ last: '00:10' }), more), ['Last train later: 00:10, was 23:00.']);
        // No journey figure on one side, no journey fact — never a guess.
        assert.deepEqual(balanceFacts(s({ fastest: null }), s({ fastest: 40 }), more), []);
    });

    test('verdictFor: Aylesbury\'s gain is said with its cost, as the review asked', () => {
        const ays = view('dep', 'AYS');
        assert.equal(ays.verdict.text, '6 more trains a day: 47, was 41.');
        assert.deepEqual(ays.verdict.also, ['First train earlier: 06:01, was 06:35.', 'Fastest journey 2 minutes longer: 53 min, was 51.']);
        // Coming back the sentence is the daytime hour, so the day's count follows it.
        const back = view('arr', 'AYS');
        assert.equal(back.verdict.text, 'More trains in the daytime: usually 2 an hour, was 1 to 3.');
        assert.deepEqual(back.verdict.also, ['5 more trains a day: 42, was 37.', 'Fastest journey 3 minutes shorter: 55 min, was 58.']);
        // A service that starts or ends is its own whole answer: nothing to balance.
        assert.deepEqual(verdictFor(none, s({ first: '06:00' }), []).also, []);
        assert.deepEqual(verdictFor(s({}), none, []).also, []);
        assert.deepEqual(verdictFor(none, none, []).also, []);
        assert.deepEqual(verdictFor(s({}), null, null).also, [], 'nor a December not known yet');
    });

    test('verdictFor: where the weekdays disagree, the sentence names its days and each other group gets a line', () => {
        const prr = view('dep', 'PRR');
        assert.equal(prr.verdict.text, 'Tuesday to Thursday, 1 fewer train a day: 46, was 47.');
        assert.deepEqual(prr.verdict.also, ['Mondays and Fridays, the same number of trains a day: 46.']);
        assert.deepEqual(prr.others.map(o => [o.days, o.words, o.short, o.now.total, o.dec.total]), [[['Mon', 'Fri'], 'Mondays and Fridays', 'Mon and Fri', 46, 46]]);
        const hwy = view('arr', 'HWY');
        assert.equal(hwy.verdict.text, 'Tuesday to Thursday, 2 more trains a day: 87, was 85.');
        assert.deepEqual(hwy.verdict.also, ['Mondays and Fridays, 3 more trains a day: 87, was 84.']);
        // An other-days line carries its own balance, as one sentence its days begin (a second sentence
        // would read as every day's), and leaves out what the lines above it have said.
        assert.deepEqual(view('arr', 'BCF').verdict.also, ['Mondays and Fridays, 1 more train a day: 55, was 54; fastest journey 2 minutes longer: 24 min, was 22.']);
        assert.deepEqual(view('dep', 'BCF').verdict.also, ['Fastest journey 3 minutes shorter: 21 min, was 24.', 'Mondays and Fridays, 1 more train a day: 53, was 52.']);
        // Days with no train either side say so, not "the same number of trains a day: 0".
        assert.deepEqual(verdictFor(s({}), s({ total: 9 }), [], 'dep', { days: 'Tuesday to Thursday', others: [{ words: 'Mondays and Fridays', now: none, dec: none }] }),
            { tone: 'less', text: 'Tuesday to Thursday, 1 fewer train a day: 9, was 10.', also: ['Mondays and Fridays, no direct trains.'] });
        // Most cards: every weekday agrees, and no day is named.
        const ays = view('dep', 'AYS');
        assert.deepEqual(ays.others, []);
        assert.doesNotMatch([ays.verdict.text, ...ays.verdict.also].join(' '), /Monday|Tuesday|Friday/);
        // A Saturday or a Sunday has no weekday exceptions, so never a day named.
        for (const day of /** @type {const} */ (['SO', 'SU'])) for (const dir of /** @type {const} */ (['dep', 'arr'])) for (const crs of ['AYS', 'BCF', 'HWY', 'PRR', 'OXF', 'BMO']) {
            assert.deepEqual(stationView(TIMETABLES.now[day][dir], TIMETABLES.dec[day][dir], crs, dir).others, [], `${day} ${dir} ${crs}`);
        }
    });

    test('"N are different" counts one real day\'s trains, as every count on the card does', () => {
        // Islip's list shows a Mondays-and-Fridays train AND its Tuesday-to-Thursday twin, and the sentence
        // counted both: "7 are different", where 6 are on any one day.
        assert.equal(view('dep', 'ISP').verdict.text, 'Same number of trains a day, but 6 are different — see Train by train below.');
        assert.equal(view('arr', 'BCF').verdict.text, 'Tuesday to Thursday, same number of trains a day, but 23 are different — see Train by train below.');
        // Every such sentence in the books is true of each day it speaks of. A timetable that breaks this
        // fails here, and the count must then be grouped by day as the figures are (`dayScope`).
        let checked = 0;
        for (const dir of /** @type {const} */ (['dep', 'arr'])) for (const crs of Object.keys(STATIONS)) {
            const v = view(dir, crs);
            const n = v.verdict.text.match(/but (\d+) (?:is|are) different/)?.[1];
            if (!n) continue;
            checked++;
            for (const day of WEEKDAYS.filter(d => !v.others.some(o => o.days.includes(d)))) {
                const onDay = stationTrains(onWeekday(TIMETABLES.now.SX[dir], day), onWeekday(TIMETABLES.dec.SX[dir], day), crs, dir).filter(isDifferent).length;
                assert.equal(onDay, Number(n), `${dir} ${crs}: "${v.verdict.text}" — ${onDay} on a ${day}`);
            }
        }
        assert.ok(checked >= 4, `premise: weekday cards that count their different trains (${checked})`);
    });

    test('a station card: another day\'s figure is small print beside the real day\'s, and read in brackets', () => {
        const prr = renderStation(view('dep', 'PRR'), { stations: STATIONS, dir: 'dep', showTrains: false });
        assert.match(prr, /<p class="tr-verdict tr-verdict--less">Tuesday to Thursday, 1 fewer train a day: 46, was 47\. <span class="tr-verdict-also">Mondays and Fridays, the same number of trains a day: 46\.<\/span><\/p>/);
        assert.match(prr, /<tr><th scope="row">Trains a day<\/th><td>47<span class="sr-only"> \(<\/span><span class="tr-days">Mon and Fri: 46<\/span><span class="sr-only">\)<\/span><\/td><td>46<\/td><\/tr>/,
            'December\'s 46 is every weekday\'s, so it has none');
        const figures = prr.match(/<table class="tr-st-table">[^]*?<\/table>/)?.[0] ?? '';
        assert.equal((figures.match(/class="tr-days"/g) ?? []).length, 1, 'only the figure that differs');
        // A figure other than the count: Beaconsfield coming back, whose Monday and Friday fastest journey is 22 minutes today.
        const bcf = renderStation(view('arr', 'BCF'), { stations: STATIONS, dir: 'arr', showTrains: false });
        assert.match(bcf, /<tr><th scope="row">Fastest journey<\/th><td>25 min<span class="sr-only"> \(<\/span><span class="tr-days">Mon and Fri: 22 min<\/span><span class="sr-only">\)<\/span><\/td><td>24 min<\/td><\/tr>/);
        // The daytime hour: a Mondays-and-Fridays train in the 12:00 hour gives those days a busier hour.
        const nowRows = [...hourly(6, 'OXF', ['OXF']), row('12:40', 'OXF', '', 'MFO', 'OXF1250')];
        const hour = renderStation(stationView(nowRows, hourly(6, 'OXF', ['OXF']), 'OXF', 'dep'), { stations: STATIONS, dir: 'dep', showTrains: false });
        const mon = summarise(onWeekday(nowRows, 'Mon'), 'OXF', 'dep');
        assert.match(hour, new RegExp(`<tr><th scope="row">Daytime, trains an hour</th><td>1<span class="sr-only"> \\(</span><span class="tr-days">Mon and Fri: ${hourWords(mon).replace(/[()]/g, '\\$&')}</span>`));
        // The rest of what changed is a line each inside the answer's box, escaped as the answer is.
        const ays = renderStation(view('dep', 'AYS'), { stations: STATIONS, dir: 'dep', showTrains: false });
        assert.match(ays, /<p class="tr-verdict tr-verdict--more">6 more trains a day: 47, was 41\. <span class="tr-verdict-also">First train earlier: 06:01, was 06:35\.<\/span> <span class="tr-verdict-also">Fastest journey 2 minutes longer: 53 min, was 51\.<\/span><\/p>/);
        const forged = { ...view('dep', 'AYS'), verdict: { tone: /** @type {const} */ ('more'), text: 'x', also: ['<b>y</b>'] } };
        assert.match(renderStation(forged, { stations: STATIONS, dir: 'dep', showTrains: false }), /<span class="tr-verdict-also">&lt;b&gt;y&lt;\/b&gt;<\/span>/);
    });

    test('the headlines read the same on every weekday, so they need not name a day', () => {
        // Each station's line leads with the same figures on every day. Which station is told in another's line
        // can differ — a weekday's own pairing can swap a train at one station that another day does not — so a
        // station with a line on one side and none on the other must be named in the other side's lines.
        const usual = headlineChanges(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, STATIONS);
        for (const day of WEEKDAYS) {
            const own = headlineChanges(onWeekday(TIMETABLES.now.SX.dep, day), onWeekday(TIMETABLES.dec.SX.dep, day), STATIONS);
            for (const crs of new Set([...usual, ...own].map(h => h.crs))) {
                const a = usual.find(h => h.crs === crs), b = own.find(h => h.crs === crs);
                if (a && b) {
                    assert.deepEqual([b.lead, b.chip, b.detail.split(' · ')[0]], [a.lead, a.chip, a.detail.split(' · ')[0]],
                        `${day}'s ${crs} line differs: a headline is one real day's, so name its days (trains-headlines.js) as a station's card does`);
                } else {
                    assert.ok((a ? own : usual).some(h => h.text.includes(STATIONS[crs])), `${day}: ${crs} has a line on one side and is not named on the other`);
                }
            }
        }
    });
});

describe('the Trains review (Nov 2026): counts, pairings at the station, and the books themselves', () => {
    const DAYS = /** @type {const} */ (['SX', 'SO', 'SU']), DIRS = /** @type {const} */ (['dep', 'arr']);
    const stationsOf = () => Object.keys(STATIONS).filter(c => c !== 'MYB');

    test('"N are different" is never more of the day\'s trains than the day has', () => {
        // Kings Sutton's card said "11 are different" of a day of 10: a stop that moved from one train to
        // another was counted as the train that stops calling AND the one that starts.
        let checked = 0;
        for (const d of DAYS) for (const dir of DIRS) for (const crs of stationsOf()) {
            const v = stationView(TIMETABLES.now[d][dir], TIMETABLES.dec[d][dir], crs, dir);
            const n = Number(v.verdict.text.match(/but (\d+) (?:is|are) different/)?.[1] ?? NaN);
            if (Number.isNaN(n)) continue;
            checked++;
            assert.ok(n <= /** @type {NonNullable<typeof v.dec>} */ (v.dec).total, `${d} ${dir} ${crs}: "${v.verdict.text}" of a day of ${v.dec?.total}`);
        }
        assert.ok(checked >= 20, `premise: cards that count their different trains (${checked})`);
        const kgs = stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'KGS', 'dep');
        assert.equal(kgs.verdict.text, 'Same number of trains a day, but 7 are different — see Train by train below.');
    });

    test('a station\'s pairings never cross where the passenger gets on — High Wycombe, coming back on a weekday', () => {
        const hwy = stationTrains(TIMETABLES.now.SX.arr, TIMETABLES.dec.SX.arr, 'HWY', 'arr');
        const of = (/** @type {string} */ at, days = '') => hwy.find(t => t.nowAt === at && t.days === days);
        // Today's 07:21 is December's 07:27, which now starts at Princes Risborough — never "19 mins later".
        assert.deepEqual([of('07:21')?.decAt, of('07:21')?.kind], ['07:27', 'rerouted']);
        assert.equal(changeLabel(/** @type {any} */ (of('07:21')), STATIONS, 'arr', { withTime: false }), '6 mins later, will come from Princes Risborough');
        assert.equal(of('07:33', 'MFX')?.decAt, '07:40', 'the 07:33 is never "6 mins earlier" onto the 07:27 another train takes');
        assert.equal(of('07:27', 'MFX')?.decAt, '07:32');
        assert.deepEqual([of('07:33', 'MFO')?.decAt, of('07:33', 'MFO')?.kind], ['07:32', 'earlier'], 'the pairing nothing crossed is left as the line made it');
    });

    test('no station, day or direction has two pairings that cross at the station on a day both run', () => {
        const at = (/** @type {string} */ t) => serviceMinutes(t);
        const together = (/** @type {string} */ a, /** @type {string} */ b) => WEEKDAYS.some(w => runsOn(a, w) && runsOn(b, w));
        let pairs = 0;
        for (const d of DAYS) for (const dir of DIRS) for (const crs of stationsOf()) {
            const kept = stationTrains(TIMETABLES.now[d][dir], TIMETABLES.dec[d][dir], crs, dir).filter(t => t.nowAt && t.decAt);
            pairs += kept.length;
            for (const p of kept) for (const q of kept) {
                if (!together(p.days, q.days) || p.via !== q.via) continue;
                assert.ok(!(at(/** @type {string} */ (p.nowAt)) < at(/** @type {string} */ (q.nowAt)) && at(/** @type {string} */ (p.decAt)) > at(/** @type {string} */ (q.decAt))),
                    `${d} ${dir} ${crs}: ${p.nowAt}→${p.decAt} crosses ${q.nowAt}→${q.decAt}`);
            }
        }
        assert.ok(pairs > 1000, `premise: kept trains read (${pairs})`);
    });

    test('every train calling at a station, today\'s and December\'s, is on its card once on every weekday it runs', () => {
        // December's 07:40 from High Wycombe runs every weekday, and the swap that uncrossed it gave it to a Tuesday-to-
        // Thursday train: on a Monday or Friday it was on no row of the card, whose sentence counted it (24-hour check,
        // 22 Nov 2026). Read on each weekday, in both directions, for every station either timetable calls at.
        const line = (/** @type {import('./trains-change.js').TrainRow} */ r) => `${r[0]} ${r[1]}`;
        const sorted = (/** @type {string[]} */ xs) => [...xs].sort();
        let checked = 0;
        for (const d of DAYS) for (const dir of DIRS) {
            const nowRows = TIMETABLES.now[d][dir], decRows = TIMETABLES.dec[d][dir];
            const places = new Set([...nowRows, ...decRows].flatMap(callsOf));
            for (const crs of places) {
                const v = stationView(nowRows, decRows, crs, dir, { change: CHANGE_DATE });
                if (!v.trains) {
                    assert.ok(!v.ending || v.ending.through >= 0, `${d} ${dir} ${crs}: ${v.ending?.through} through`);
                    continue;
                }
                for (const w of d === 'SX' ? WEEKDAYS : [REAL_DAY]) {
                    const on = v.trains.filter(t => runsOn(t.days, w));
                    const where = `${d} ${dir} ${crs} ${w}`;
                    assert.deepEqual(sorted(on.filter(t => t.now).map(t => `${t.now} ${t.nowTo}`)),
                        sorted(callingAt(onWeekday(nowRows, w), crs).map(line)), `${where}: today's trains`);
                    assert.deepEqual(sorted(on.filter(t => t.dec).map(t => `${t.dec} ${t.decTo}`)),
                        sorted(callingAt(onWeekday(decRows, w), crs).map(line)), `${where}: December's trains`);
                    checked++;
                }
            }
        }
        assert.ok(checked > 400, `premise: station days read (${checked})`);
    });

    test('a December train left without a partner on some weekdays is listed on those days as new — High Wycombe, coming back', () => {
        const hwy = stationView(TIMETABLES.now.SX.arr, TIMETABLES.dec.SX.arr, 'HWY', 'arr', { change: CHANGE_DATE });
        const rows = (/** @type {import('./trains-weekdays.js').Weekday} */ w) => (hwy.trains ?? []).filter(t => runsOn(t.days, w) && t.decAt === '07:40')
            .map(t => `${t.nowAt ?? '—'}>${t.decAt} ${changeLabel(t, STATIONS, 'arr', { withTime: false, here: 'HWY' })}`);
        assert.deepEqual(rows('Tue'), ['07:33>07:40 7 mins later, will start here']);
        assert.deepEqual(rows('Mon'), ['—>07:40 New train']);
        assert.deepEqual(rows('Fri'), rows('Mon'));
        // The card marks the row's days under the December time, as it does under today's for a train that has them.
        const html = renderStation(hwy, { stations: STATIONS, dir: 'arr', showTrains: true, allTrains: true, started: false });
        assert.match(html, /<\/td><td>07:40<span class="tr-days">Mon and Fri only<\/span>/);
        // Its sentence is a Tuesday's, which the Monday-and-Friday row does not join.
        assert.equal(hwy.verdict.text, 'Tuesday to Thursday, 2 more trains a day: 87, was 85.');
    });

    test('one slot\'s two weekday versions on two routes read as one retimed train, never one lost and one new (review of v26.60)', () => {
        // Princes Risborough, coming back: Tuesday to Thursday the 07:21 starts there (08:07 into Marylebone); on a
        // Monday and Friday the 07:21 is the Oxford train (08:03), at the same stops and minutes. December's 07:13
        // runs every weekday. The card said, of a Monday, "Will no longer stop here" AND "New train" — and counted two.
        const card = (/** @type {'dep'|'arr'} */ dir, /** @type {string} */ crs) => {
            const v = stationView(TIMETABLES.now.SX[dir], TIMETABLES.dec.SX[dir], crs, dir, { change: CHANGE_DATE });
            const rows = (/** @type {import('../trains-weekdays.js').Weekday} */ w, /** @type {string} */ at) => (v.trains ?? [])
                .filter(t => runsOn(t.days, w) && (t.nowAt === at || t.decAt === at))
                .map(t => `${t.nowAt ?? '—'}>${t.decAt ?? '—'} ${changeLabel(t, STATIONS, dir, { withTime: false, here: crs })}`);
            return { v, rows, html: renderStation(v, { stations: STATIONS, dir, showTrains: true, allTrains: true, started: false }) };
        };
        const prr = card('arr', 'PRR');
        assert.deepEqual(prr.rows('Tue', '07:21'), ['07:21>07:13 8 mins earlier'], 'premise: the Tuesday-to-Thursday version');
        assert.deepEqual(prr.rows('Mon', '07:21'), ['07:21>07:13 8 mins earlier, will start here']);
        assert.deepEqual(prr.rows('Mon', '07:13'), prr.rows('Mon', '07:21'), 'December\'s 07:13 is on that one row on a Monday, never a new one');
        assert.deepEqual(prr.rows('Fri', '07:21'), prr.rows('Mon', '07:21'));
        // Read through the card itself: one row for the Monday-and-Friday train, and no new 07:13 under its days.
        assert.doesNotMatch(prr.html, /<td>07:13<span class="tr-days">Mon and Fri only<\/span>/);
        assert.match(prr.html, /<td>07:21<span class="tr-days">Mon and Fri only<\/span>.*?<\/td><td>07:13.*?8 mins earlier, will start here/);
        // High Wycombe, leaving: the Monday-and-Friday 17:45 to Oxford calls there; Tuesday to Thursday the 17:37 to
        // Princes Risborough does. December's 17:41 to Princes Risborough runs every weekday.
        const hwy = card('dep', 'HWY');
        assert.deepEqual(hwy.rows('Tue', '17:41'), ['17:37>17:41 4 mins later']);
        assert.deepEqual(hwy.rows('Mon', '17:41'), ['17:45>17:41 4 mins earlier, will run to Princes Risborough']);
        assert.deepEqual(hwy.rows('Mon', '17:45'), hwy.rows('Mon', '17:41'));
        // Saunderton, leaving: neither of today's 17:45s to Oxford is carried on by a train that stopped THERE —
        // the 17:37 to Princes Risborough runs through — so nothing ties them to December's 17:41, which stays a
        // train that now stops there, every weekday.
        const sdr = card('dep', 'SDR');
        assert.deepEqual(['Mon', 'Tue'].map(w => sdr.rows(/** @type {any} */ (w), '17:41')), [['—>17:41 Will stop here'], ['—>17:41 Will stop here']]);
        // The sentence is a Tuesday's count, which the fold does not touch.
        assert.equal(prr.v.verdict.text, '2 more trains a day: 40, was 38.');
    });

    test('a slot is folded across routes only on the books\' own evidence: the opposite weekday version, here, within the bar', () => {
        // Hand-made, leaving Marylebone, read at High Wycombe — the real 17:37 / 17:45 pattern.
        const prrTrain = (days = 'MFX') => row('17:37', 'PRR', '', days, 'HWY1807 PRR1818');
        const oxfMF = (days = 'MFO') => row('17:45', 'OXF', '', days, 'HWY1813 PRR1826 OXF1906');
        const oxfTT = row('17:45', 'OXF', '', 'MFX', 'PRR1826 OXF1906');
        const dec = (prr = '17:41', stops = 'HWY1809 PRR1822') => [row(prr, 'PRR', '', '', stops), row('17:45', 'OXF', '', '', 'PRR1826 OXF1907')];
        const words = (/** @type {any[]} */ ts) => ts.map(t => `${t.nowAt ?? '—'}>${t.decAt ?? '—'} ${changeLabel(t, STATIONS, 'dep', { withTime: false })}${t.days ? ` (${daysLabel(t.days)})` : ''}`);
        // The two versions: one row each, the Monday-and-Friday one retimed onto its partner's December train.
        assert.deepEqual(words(stationTrains([prrTrain(), oxfMF(), oxfTT], dec(), 'HWY', 'dep')),
            ['17:37>17:41 4 mins later (Tue to Thu only)', '17:45>17:41 4 mins earlier, will run to Princes Risborough (Mon and Fri only)']);
        // Time alone is not evidence: a train calling here every day that stops calling is not a weekday version.
        assert.deepEqual(words(stationTrains([prrTrain(), oxfMF('')], dec(), 'HWY', 'dep')),
            ['17:37>17:41 4 mins later (Tue to Thu only)', '—>17:41 New train (Mon and Fri only)', '17:45>— Will no longer stop here']);
        // Only the OPPOSITE version is evidence: a Wednesdays-only train and a Mondays-and-Fridays one are not one slot.
        assert.deepEqual(words(stationTrains([prrTrain('WO'), oxfMF(), oxfTT], dec(), 'HWY', 'dep')),
            ['17:37>17:41 4 mins later (Wed only)', '—>17:41 New train (Mon, Tue, Thu and Fri only)', '17:45>— Will no longer stop here (Mon and Fri only)']);
        // A December train already on a Monday-and-Friday row here is not given a second one.
        assert.deepEqual(words(stationTrains([prrTrain(), row('17:39', 'PRR', '', 'MFO', 'HWY1809 PRR1820'), oxfMF(), oxfTT], dec(), 'HWY', 'dep')),
            ['17:37>17:41 4 mins later (Tue to Thu only)', '17:39>17:41 2 mins later (Mon and Fri only)', '17:45>— Will no longer stop here (Mon and Fri only)']);
        // Never across Aylesbury's two routes, as `uncross` never swaps them: a via-Wycombe train that stops running is
        // not the via-Amersham one's Monday-and-Friday version, however the minutes fall.
        assert.deepEqual(words(stationTrains([row('17:37', 'AYS', 'A', 'MFX', 'AMR1815 AYS1838'), row('17:45', 'AYS', 'H', 'MFO', 'HWY1813 AYS1840')],
            [row('17:41', 'AYS', 'A', '', 'AMR1819 AYS1842')], 'AYS', 'dep')),
            ['17:37>17:41 4 mins later (Tue to Thu only)', '—>17:41 New train (Mon and Fri only)', '17:45>— Will stop running (Mon and Fri only)']);
        // Only a train that stops calling here is re-paired: one whose December train still calls here keeps it.
        const keeps = words(stationTrains([prrTrain(), oxfMF()], [dec()[0], row('17:47', 'OXF', '', '', 'HWY1815 PRR1828 OXF1908')], 'HWY', 'dep'));
        assert.ok(keeps.includes('17:45>17:47 2 mins later (Mon and Fri only)') && keeps.includes('—>17:41 New train (Mon and Fri only)'), keeps.join(' | '));
        // Past MAX_SHIFT_MIN at the station, the slot is not the same: 17:45 and 17:21 are 24 minutes apart.
        assert.deepEqual(words(stationTrains([prrTrain(), oxfMF(), oxfTT], dec('17:21', 'HWY1749 PRR1802'), 'HWY', 'dep')),
            ['—>17:21 New train (Mon and Fri only)', '17:37>17:21 16 mins earlier (Tue to Thu only)', '17:45>— Will no longer stop here (Mon and Fri only)']);
    });

    test('two pairings cross only on a day both trains run, and a swap says what the train now is', () => {
        // Hand-made, leaving Marylebone: today's 10:00 to Oxford and 10:05 to High Wycombe both call at Gerrards
        // Cross; December's Oxford train is ten minutes later and its Wycombe one seven minutes earlier.
        const now = (/** @type {string} */ a, /** @type {string} */ b) => [row('10:00', 'OXF', '', a, 'GER1020 OXF1100'), row('10:05', 'HWY', '', b, 'GER1025 HWY1040')];
        const dec = [row('10:10', 'OXF', '', '', 'GER1030 OXF1110'), row('09:58', 'HWY', '', '', 'GER1018 HWY1033')];
        const words = (/** @type {any[]} */ ts) => ts.map(t => `${t.nowAt ?? '—'}>${t.decAt} ${changeLabel(t, STATIONS, 'dep', { withTime: false })}${t.days ? ` (${daysLabel(t.days)})` : ''}`);
        // A Mondays-and-Fridays train and a Tuesday-to-Thursday one never run on one day: nothing crosses. And each
        // December train, which runs every weekday, is new on the days its partner does not run.
        assert.deepEqual(words(stationTrains(now('MFO', 'MFX'), dec, 'GER', 'dep')), ['—>09:58 New train (Mon and Fri only)',
            '10:00>10:10 10 mins later (Mon and Fri only)', '10:05>09:58 7 mins earlier (Tue to Thu only)', '—>10:10 New train (Tue to Thu only)']);
        // Every day: uncrossed, each train goes where the other's December train goes.
        assert.deepEqual(words(stationTrains(now('', ''), dec, 'GER', 'dep')),
            ['10:00>09:58 2 mins earlier, will run to High Wycombe', '10:05>10:10 5 mins later, will run to Oxford']);
        // Crossed on the days both run, Tuesday to Thursday (High Wycombe's 07:21 and 07:33, 24-hour check): swapped,
        // and on a Monday or Friday the December train the swap gave the Tue-to-Thu train is listed, as new.
        assert.deepEqual(words(stationTrains(now('', 'MFX'), dec, 'GER', 'dep')), ['10:00>09:58 2 mins earlier, will run to High Wycombe',
            '10:05>10:10 5 mins later, will run to Oxford (Tue to Thu only)', '—>10:10 New train (Mon and Fri only)']);
    });

    test('no station card\'s train list names the card\'s own station: it says "here"', () => {
        // "7 mins later, will come from High Wycombe" on High Wycombe's card, "Will end at Aylesbury" on Aylesbury's.
        // Read through renderStation, so the card passing its station to changeLabel is what is tested.
        const names = Object.entries(STATIONS).sort((a, b) => b[1].length - a[1].length);
        let chips = 0, here = 0;
        for (const d of DAYS) for (const dir of DIRS) for (const crs of stationsOf()) for (const started of [false, true]) {
            const view = stationView(TIMETABLES.now[d][dir], TIMETABLES.dec[d][dir], crs, dir, { started });
            const html = renderStation(view, { stations: STATIONS, dir, showTrains: true, allTrains: true, started });
            for (const [, chip] of html.matchAll(/<td><span class="tr-chip tr-chip--[a-z]+">([^<]*)<\/span><\/td><\/tr>/g)) {
                chips++;
                const text = chip.replace(/&amp;/g, '&');
                if (/(?:start|end)s? here$/.test(text)) here++;
                const named = names.find(([, n]) => text.includes(n))?.[0];
                assert.notEqual(named, crs, `${d} ${dir} ${crs}${started ? ', after the change' : ''}: "${text}"`);
            }
        }
        assert.ok(chips > 5000, `premise: train-list chips read (${chips})`);
        assert.ok(here >= 14, `premise: rows that say "here" of an end at the card's station (${here})`);
    });

    test('Aylesbury\'s two routes are never swapped onto each other to uncross them', () => {
        // Sunday, coming back: today's 07:15 and 07:19 cross at Aylesbury, but one is via Amersham and one via High
        // Wycombe — most of an hour apart — so each keeps its own route's December train.
        const ays = stationTrains(TIMETABLES.now.SU.arr, TIMETABLES.dec.SU.arr, 'AYS', 'arr');
        assert.deepEqual(['07:15', '07:19'].map(t => ays.find(x => x.nowAt === t)?.kind), ['later', 'same']);
    });

    test('a weekday headline folds a station into another\'s only when its trains are that station\'s own (`stationTrains`)', () => {
        const sx = headlineChanges(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, STATIONS);
        // All five of Banbury's new trains stop at Bicester North, which also loses two: never "3 of them also stop".
        assert.doesNotMatch(sx.find(h => h.crs === 'BAN')?.text ?? '', /Bicester North/);
        assert.equal(sx.find(h => h.crs === 'BCS')?.text, '3 more trains a day to Bicester North (38, was 35)');
    });

    test('without December\'s stops, the trains that end here count one real day and fold a Monday-and-Friday twin', () => {
        // Hand-made: a stopless December, as the simplifier would give it. Today one train ends at High Wycombe
        // every day, one has a Mondays-and-Fridays and a Tuesday-to-Thursday version, and one runs on to Banbury.
        const now = [row('10:00', 'HWY', '', '', 'HWY1030'), row('17:30', 'HWY', '', 'MFO', 'HWY1800'),
            row('17:34', 'HWY', '', 'MFX', 'HWY1804'), row('11:00', 'BAN', '', '', 'HWY1130 BAN1200')];
        const dec = [row('10:00', 'HWY'), row('17:32', 'HWY'), row('11:00', 'BAN')];
        const v = stationView(now, dec, 'HWY', 'dep', { change: CHANGE_DATE });
        const ending = /** @type {NonNullable<typeof v.ending>} */ (v.ending);
        assert.equal(ending.through, 1, 'one train runs through on a Tuesday, not none');
        assert.deepEqual(ending.trains.map(t => `${t.now}>${t.dec} ${t.kind}`), ['10:00>10:00 same', '17:30>17:32 later', '17:34>17:32 earlier'],
            'the Mondays-and-Fridays 17:30 runs at December\'s 17:32, never "no longer runs"');
        assert.equal(v.verdict.text, 'Same number of trains a day, but 1 is different — see Train by train below.');
        // And a December not known at all is named by the change date's month, never a typed one.
        assert.match(verdictFor(summarise(now, 'GER', 'dep'), null, null, 'dep', { change: '2027-05-16' }).text, /^May not known yet: Chiltern has not published where its May trains stop\./);
    });

    // The generated data (build.py) is the page's only source, and nothing else held it to its own documented shape.
    test('the books: every row is the shape trains-data.js documents', () => {
        let rows = 0;
        for (const tt of /** @type {const} */ (['now', 'dec'])) for (const d of DAYS) for (const dir of DIRS) {
            for (const r of TIMETABLES[tt][d][dir]) {
                rows++;
                const where = `${tt} ${d} ${dir} ${r[0]} ${r[1]}`;
                assert.match(r[0], /^([01]\d|2[0-3]):[0-5]\d$/, where);
                assert.ok(STATIONS[/** @type {keyof typeof STATIONS} */ (r[1])] && r[1] !== 'MYB', `${where}: an end the books do not name`);
                assert.ok(!r[2] || r[1] === 'AYS', `${where}: a route code is Aylesbury's alone`);
                assert.ok(['H', 'A', ''].includes(r[2]), where);
                assert.ok(['', 'MFO', 'MFX', 'WO'].includes(r[3]) && (!r[3] || d === 'SX'), `${where}: day code ${r[3]}`);
                const stops = r[4].split(' ');
                for (const s of stops) assert.match(s, /^[A-Z]{3}\d{4}$/, where);
                const codes = stops.map(s => s.slice(0, 3));
                for (const c of codes) assert.ok(STATIONS[/** @type {keyof typeof STATIONS} */ (c)], `${where}: a stop the books do not name, ${c}`);
                assert.ok(!codes.includes('MYB'), `${where}: Marylebone is never one of a train's stops`);
                assert.equal(new Set(codes).size, codes.length, `${where}: a stop listed twice`);
                assert.equal(dir === 'dep' ? codes[codes.length - 1] : codes[0], r[1], `${where}: the far end is the ${dir === 'dep' ? 'last' : 'first'} stop`);
                // Every time rises along the train, Marylebone's included: a backwards one would be a journey of
                // no minutes, which `summarise` drops rather than shows.
                const mins = parseStops(r).map(s => serviceMinutes(s.time));
                const seq = dir === 'dep' ? [serviceMinutes(r[0]), ...mins] : [...mins, serviceMinutes(r[0])];
                seq.forEach((m, i) => assert.ok(i === 0 || m > seq[i - 1], `${where}: times do not rise (${r[4]})`));
            }
        }
        assert.ok(rows > 1000, `premise: rows read (${rows})`);
    });

    test('the mutations that survived the review now fail a test', () => {
        // pairColumns: across the hour, :55 and :05 are ten minutes apart, not fifty.
        assert.deepEqual(pairColumns([{ minute: 55, end: 'OXF' }], [{ minute: 5, end: 'OXF' }]).map(c => c?.minute ?? null), [55]);
        // The headline's last-train bar is "at least": a last train exactly EDGE_SHIFT_MIN later is news.
        assert.equal(EDGE_SHIFT_MIN, 10, 'premise: the times below are ten minutes apart');
        const day = hourly(6, 'OXF', ['GER', 'OXF']);
        const edge = headlineChanges([...day, row('22:00', 'OXF', '', '', 'GER2209 OXF2230')],
            [...day, row('22:10', 'OXF', '', '', 'GER2219 OXF2240')], STATIONS).find(h => h.crs === 'OXF');
        assert.equal(edge?.lead, 'Later last train to Oxford: 22:10');
        // busiestStations: a tie between two stations is broken by the code, so the page's picks never shuffle.
        assert.deepEqual(busiestStations([row('10:00', 'OXF', '', '', 'HWY1030 GER1040 OXF1100')], 3), ['GER', 'HWY', 'OXF']);
        // stoppingGrid: a column split evenly between two ends is named by the one further along the line.
        const split = [10, 11, 12, 13, 14, 15].map(h => row(`${h}:06`, h % 2 ? 'OXF' : 'HWY', '', '', h % 2 ? `HWY${h}35 OXF${h}55` : `HWY${h}35`));
        assert.equal(stoppingGrid(split).columns[0].end, 'OXF');
    });
});

// ── THE WORDS REVIEW (Nov 2026): the lookup's answer, read by a colleague who has never used the page ──────────
describe('the lookup and the cards as the words review read them (Nov 2026)', () => {
    const look = (/** @type {'SX'|'SO'|'SU'} */ day, /** @type {string} */ time, started = false, nowRows = TIMETABLES.now[day].dep, decRows = TIMETABLES.dec[day].dep) =>
        renderLookup({ at: time, day, nowRows, decRows, started,
            labels: started ? { old: 'Until 12 Dec', new: 'From 13 Dec' } : { old: 'Now', new: 'From 13 Dec' }, change: CHANGE_DATE, stations: STATIONS });

    // "Will end at Birmingham Moor Street, 16:41" read as arriving at Moor Street at 16:41: the new time it
    // leaves Marylebone comes first, as a plain retime's does.
    test('a new end that comes with a new time says the time first', () => {
        assert.match(look('SX', '16:37'), /<strong>The 16:37 to Stourbridge Junction:<\/strong> 4 mins later \(16:41\), will end at Birmingham Moor Street\./);
        assert.match(look('SX', '08:35'), /<strong>The 08:35 to Banbury:<\/strong> 1 min earlier \(08:34\), will run to Birmingham Snow Hill\./);
        assert.doesNotMatch(look('SX', '16:37'), /Birmingham Moor Street, 16:41/);
        // With no new time, the end alone, as before.
        assert.match(look('SX', '10:36'), /<strong>The 10:36 to Banbury:<\/strong> Will run to Birmingham Snow Hill\./);
    });

    // 09:31 answered "No weekday train leaves at exactly 09:31" under a headline about the new 09:31.
    test('no train at that time in the running timetable, but one in the other: it says what that train is', () => {
        assert.match(look('SX', '09:31'), /No weekday train leaves at exactly 09:31 in the current timetable\. From 13 December the 09:31 is a new train to Stratford-upon-Avon\.<\/p>/);
        assert.match(look('SX', '05:55'), /From 13 December the 05:54 to High Wycombe leaves at 05:55 instead\./);
        assert.match(look('SX', '08:34'), /From 13 December the 08:35 to Banbury leaves at 08:34 instead, and runs to Birmingham Snow Hill\./);
        assert.match(look('SX', '17:03'), /From 13 December the 17:07 to Birmingham Moor Street leaves at 17:03 instead, and goes on to Stourbridge Junction\./);
        // From the change, the mirror: the train that time used to be, and what became of it.
        assert.match(look('SX', '08:35', true), /No weekday train leaves at exactly 08:35\. The 08:35 to Banbury ran until 12 December\. From 13 December it leaves at 08:34 instead, and runs to Birmingham Snow Hill\.<\/p>/);
        assert.match(look('SX', '07:54', true, [row('07:54', 'GER')], [row('08:30', 'GER')]),
            /No weekday train leaves at exactly 07:54\. The 07:54 to Gerrards Cross ran until 12 December, and no longer runs\.<\/p>/);
        // And nothing is added where neither timetable has a train then, or where one leaves at that time.
        assert.match(look('SX', '10:38'), /No weekday train leaves at exactly 10:38 in the current timetable\.<\/p>/);
        assert.doesNotMatch(look('SX', '16:37'), /No weekday train|is a new train/);
    });

    // Review of v26.60: after the change, the 17:41 to Princes Risborough was described by its Tuesday-to-Thursday
    // history alone, where the station cards list it as new on a Monday and Friday.
    test('a December train that was today\'s on only some weekdays says it is new on the others', () => {
        assert.match(look('SX', '17:41', true), /<strong>The 17:41 to Princes Risborough:<\/strong> Until 12 December it left at 17:37 on Tuesday to Thursday\.[^<]* On Mondays and Fridays it is a new train\.<\/p>/);
        // Both versions became it: nothing is new on any weekday, and the sentence is not said.
        assert.doesNotMatch(look('SX', '17:33', true), /is a new train/);
        assert.match(look('SX', '17:33', true), /Until 12 December it left at 17:37 on Mondays and Fridays\./);
        // Before the change, the same December train named by the time it will leave (hand-made: the books have an
        // Aylesbury train at 17:41 today, so the real 17:41 is answered by that one).
        const now = [row('17:37', 'PRR', '', 'MFX', 'HWY1807 PRR1818')], dec = [row('17:41', 'PRR', '', '', 'HWY1809 PRR1822')];
        assert.match(look('SX', '17:41', false, now, dec),
            /From 13 December the 17:37 to Princes Risborough \(Tue to Thu only\) leaves at 17:41 instead\. On Mondays and Fridays the 17:41 is a new train\.<\/p>/);
        const both = [...now, row('17:39', 'PRR', '', 'MFO', 'HWY1809 PRR1820')];
        assert.doesNotMatch(look('SX', '17:41', false, both, dec), /is a new train/);
        assert.doesNotMatch(look('SX', '17:41', true, both, dec), /is a new train/);
    });

    // The days a train runs, in the cards' words: the lookup typed its own, "Tuesdays to Thursdays".
    test('after the change, a train\'s days are named as the cards name them', () => {
        const html = look('SX', '17:33', true);
        assert.match(html, /Same time as before 13 December on Tuesday to Thursday\./);
        assert.match(html, /Until 12 December it left at 17:37 on Mondays and Fridays\./);
        assert.doesNotMatch(html, /Tuesdays to Thursdays/);
        assert.match(look('SX', '07:00', true, [row('07:00', 'OXF', '', 'WO')], [row('07:00', 'OXF')]), /Same time as before 13 December on Wednesdays\./);
    });

    // The bar beside a train in one list only was explained to a screen reader alone.
    test('the near lists say in words what the bar marks, and only when a train is marked', () => {
        const differ = look('SX', '10:36');
        assert.match(differ, /tr-near-only/);
        assert.match(differ, /<p class="card-explainer tr-note">A bar at the left marks a train in only one of the two lists: a new train, one that stops running, or one whose time or destination is different\.<\/p>$/);
        const same = look('SO', '17:16');
        assert.doesNotMatch(same, /tr-near-only|A bar at the left/);
        assert.match(same, /— <strong>the same trains<\/strong> in both timetables:/);
        // Two lists that differ only in a train's days are drawn as two, with nothing marked — and no note.
        const days = look('SX', '17:33', false, [row('17:33', 'BSW', '', 'MFX')], [row('17:33', 'BSW')]);
        assert.match(days, /tr-near-head/);
        assert.doesNotMatch(days, /tr-near-only|A bar at the left/);
    });

    test('an empty Last trains cell is "none" to a screen reader, as on a station card', () => {
        const html = renderLastTrains([/** @type {any} */ ({ crs: 'OXF', now: null, dec: '23:07', kind: 'new' })], { stations: STATIONS, labels: { old: 'Now', new: 'From 13 Dec' } });
        assert.match(html, /<td><span class="tr-none"><span aria-hidden="true">—<\/span><span class="sr-only">none<\/span><\/span><\/td><td>/);
    });

    test('a station with no direct train from the change points to the journey planner; one that keeps every time lists them', () => {
        const ber = renderStation(stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'BER', 'dep'), { stations: STATIONS, dir: 'dep', showTrains: false });
        assert.match(ber, /^<p class="tr-verdict[^>]*>No direct trains[^<]*<\/p><p class="card-explainer tr-note">For a journey with a change of train, check <a href="https:\/\/www\.nationalrail\.co\.uk\/journey-planner\/"/);
        // A station with direct trains on both sides is not sent to the planner.
        assert.doesNotMatch(renderStation(stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'HWY', 'dep'), { stations: STATIONS, dir: 'dep', showTrains: false }), /journey-planner/);
    });

    // "5 pm" passes through "5 ", which is no time, so the box put up its hint and the live region read it. A tail begun
    // ("5.15p") is a time now, answered as one: kept pending, it left the last answer up beneath it (24-hour check).
    test('a.m. or p.m. still to come is recognised, for an hour that can take one — and a tail begun is a time', async () => {
        const { amPmPending } = await import('../trains-cards.js');
        for (const v of ['5 ', '5.15 ', '515 ', '12 ', '12.15  ']) assert.equal(amPmPending(v), true, v);
        for (const v of ['', '5', '5.', '5.1', '5.15', '5.15pm', '5.15 a.m.', '1715 ', '17:15p', '0.15 ', '13p', 'abc ',
            '5.15p', '5.15 p', '5.15p.', '515a', '12p', '10.15p']) assert.equal(amPmPending(v), false, v);
        for (const v of ['5.15p', '5.15 p', '5.15p.', '515a', '12p', '10.15p']) assert.ok(parseTypedTime(v), `${v} is answered as a time`);
    });
});
