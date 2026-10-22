/**
 * trains-stations.test.mjs — the Trains page seen from a station, and the words it shows.
 * Run with: node --test trains-stations.test.mjs   (no mocks; part of test:hygiene)
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
import {
    parseStops, stopsKnown, callsOf, lineOf, callingAt, knowableWithoutStops, decemberKnown, summarise,
    stationView, verdictFor, minutesWords, hourWords, hourNote, rateWords, busiestStations, matchStations, headlineChanges, stoppingGrid, orderStations, pairColumns,
    aRealDay, boardingTime, stationTrains, stopChanges,
} from './trains-stations.js';
import { renderHeadlines, renderStation, renderGrid, endWords, renderLookup, renderTotals } from './trains-render.js';
import { changeLabel } from './trains-change.js';
import { TIMETABLES, STATIONS, STATION_ORDER, CHANGE_DATE } from './trains-data.js';

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
    test('counts, the off-peak hour, minutes past the hour, journey, first and last', () => {
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
        assert.equal(verdictFor(s({}), s({ total: 0 }), []).text, 'No direct trains from 13 December.');
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
        assert.equal(verdictFor(s({ typical: 0, hourRange: [0, 0] }), s({ typical: 0, hourRange: [0, 0], total: 12 }), []).text, '2 more trains a day: 12, was 10.', 'no off-peak claim for a station with no off-peak trains');
        assert.equal(verdictFor(s({ typical: 2, hourRange: [1, 2] }), s({ total: 15 }), []).text, '5 more trains a day: 15, was 10.', 'a typical hour that stays 2 is not an off-peak change, however the exceptions fill in');
        assert.equal(verdictFor(s({}), s({ minutes: [10, 40] }), []).text, 'Same number of trains. In the daytime they leave at :10 and :40 past the hour, was :06 and :36.');
        // Weekday Beaconsfield, coming back: December's :13 is :10 in two hours of six, so it stops
        // "repeating" — but nothing went. Never "from :13 and :39 to :39" of three trains an hour.
        assert.equal(verdictFor(s({ minutes: [13, 39] }), s({ minutes: [39] }), [/** @type {any} */ ({ kind: 'earlier' })]).text,
            'Same number of trains a day, but 1 is different — see Train by train below.');
        assert.equal(verdictFor(s({}), s({}), []).text, 'No change.');
        assert.equal(verdictFor(s({}), s({}), [/** @type {any} */ ({ kind: 'later' })]).text, 'Same number of trains a day, but 1 is different — see Train by train below.');
        // Leaving on time but getting there later is a change: "No change." sat above "159 → 164 min".
        assert.equal(verdictFor(s({}), s({}), [/** @type {any} */ ({ kind: 'same', farShift: 5 })]).text, 'Same number of trains a day, but 1 is different — see Train by train below.');
    });

    test('no train either side is not "No change." (v24.83)', () => {
        assert.equal(verdictFor(s({ total: 0 }), s({ total: 0 }), [], 'dep').text, 'No direct trains from Marylebone on this day, now or from 13 December.');
        assert.equal(verdictFor(s({ total: 0 }), s({ total: 0 }), [], 'arr').text, 'No direct trains to Marylebone on this day, now or from 13 December.');
        const sud = stationView(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep, 'SUD', 'dep');
        assert.equal(renderStation(sud, { stations: STATIONS, dir: 'dep', showTrains: false }),
            '<p class="tr-verdict tr-verdict--same">No direct trains from Marylebone on this day, now or from 13 December.</p>', 'no table of noughts, no train list');
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
        assert.equal(w(2, [2, 2, 2, 2, 1, 3]), '2 (1 to 3 in some hours)');
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
        assert.deepEqual(m('stratford-on-avon'), ['SAV']);
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
        assert.equal(sx.find(h => h.crs === 'BAN')?.text, '5 more trains a day to Banbury (42, was 37); 3 of them also stop at Bicester North');
        assert.equal(sx.find(h => h.crs === 'HDM')?.text, '2 fewer trains a day to Haddenham & Thame Parkway (41, was 43)');
        assert.ok(!sx.some(h => h.crs === 'PRR'), 'Princes Risborough: one fewer on a real weekday, no headline');
        // Warwick's "a train goes as others come" was that same twin, read as a train withdrawn.
        for (const crs of ['HOH', 'RIC', 'CLW', 'CFO', 'AMR', 'GMN', 'WND', 'SKM', 'BCS', 'WRP', 'DDG', 'SOL', 'WRW']) {
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
    test('one column per train repeating most off-peak hours, rows in calling order', () => {
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
        assert.equal((html.match(/class="tr-head"/g) ?? []).length, 5);
        // Never "Show all": the list is the biggest changes, and every small one is on a station card (v24.83).
        assert.match(html, />Show 2 more</);
        assert.match(html, /The biggest changes only\. A train a few minutes earlier or later is on its station’s card/);
        assert.match(html, /once Chiltern publishes where December’s trains stop/);
        assert.doesNotMatch(renderHeadlines(items, { showAll: true, partial: false }), /Show \d+ more|once Chiltern publishes/);
        assert.match(renderHeadlines([], { showAll: false, partial: false }), /No big changes/);
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

describe('the station card, the lookup and the totals as a member reads them (v24.83)', () => {
    test('the columns are named by the date, and the leaf-fall note comes back only on its line', () => {
        const view = stationView(TIMETABLES.now.SO.arr, TIMETABLES.dec.SO.arr, 'AMR', 'arr');
        const html = renderStation(view, { stations: STATIONS, dir: 'arr', showTrains: true, labels: { old: 'Until 12 Dec', new: 'From 13 Dec' },
            started: true, leafFall: { minutes: 3, until: '10 January' } });
        assert.match(html, /<th scope="col">Until 12 Dec<\/th><th scope="col">From 13 Dec<\/th>/);
        assert.match(html, /<strong>Leaf fall:<\/strong> until 10 January, trains to London on this line leave up to 3 minutes earlier than usual\./);
        // It names the columns as the table above it does, so it stays true when they are renamed on 13 December.
        assert.match(html, /The Until 12 Dec column includes that and the From 13 Dec column does not, so a change of 3 minutes or less here may be leaf fall\. Check the journey planner before 10 January\./);
        assert.match(view.verdict.text, /they leave at :14 past the hour, was :08/, 'Saturday Amersham, timed at Amersham');
        assert.doesNotMatch(renderStation(stationView(TIMETABLES.now.SO.dep, TIMETABLES.dec.SO.dep, 'AMR', 'dep'),
            { stations: STATIONS, dir: 'dep', showTrains: false, leafFall: { minutes: 3, until: '10 January' } }), /Leaf fall/, 'not going there');
    });
    test('the lookup: the day the member chose, a train\'s days, and the stops it drops', () => {
        const look = (/** @type {'SX'|'SO'|'SU'} */ day, /** @type {string} */ time, started = false) =>
            renderLookup({ at: time, day, nowRows: TIMETABLES.now[day].dep, decRows: TIMETABLES.dec[day].dep, started,
                labels: started ? { old: 'Until 12 Dec', new: 'From 13 Dec' } : { old: 'Now', new: 'From 13 Dec' }, change: CHANGE_DATE, stations: STATIONS });
        assert.match(look('SO', '10:36'), /No Saturday train leaves at exactly 10:36 in today’s timetable\./);
        assert.match(look('SX', '10:36'), /<strong>The 10:36 to Banbury:<\/strong> Will run to Birmingham Snow Hill\. From 13 December it does not stop at Kings Sutton\./);
        assert.match(look('SX', '17:37'), /<strong>The 17:37 to Birmingham Snow Hill \(Mon and Fri only\):<\/strong> 4 mins earlier \(17:33\)\./);
        assert.match(look('SX', '17:37'), /17:37<\/span> Birmingham Moor Street <span class="tr-near-on">on to Snow Hill<\/span> <span class="tr-days">Mon and Fri only<\/span>/);
        // From the change, "the 15:38" is December's — it used to answer "No train leaves at exactly 15:38 today".
        assert.match(look('SU', '15:38', true), /<strong>The 15:38 to Birmingham Moor Street:<\/strong> New from 13 December\./);
        assert.match(look('SX', '10:36', true), /Until 12 December this was the 10:36 to Banbury\./);
        assert.match(look('SX', '10:36', true), /<h3 class="tr-near-head">Until 12 Dec<\/h3>/);
    });
    test('the totals count one real day of each kind, each kept on one line', () => {
        const html = renderTotals(TIMETABLES);
        assert.match(html, /<span class="tr-total">weekdays 145 → <strong>158<\/strong> <span class="tr-delta tr-delta--up">\+13<\/span><\/span>/);
        assert.match(html, /<span class="tr-total">Sundays 91 → <strong>94<\/strong>/);
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
