/**
 * trains-stations.test.mjs — the Trains page seen from a station, and the words it shows.
 * Run with: node --test trains-stations.test.mjs   (no mocks; part of test:hygiene)
 *
 * The rule that matters most is the one that keeps the page honest while December's stops are
 * missing: a December figure is shown for a station only when it can be KNOWN without them. A short
 * count presented as the service is the failure this exists to prevent, so it is pinned both on
 * hand-made rows and on the real generated tables (Gerrards Cross and Oxford must say "waiting").
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseStops, stopsKnown, callsOf, lineOf, callingAt, knowableWithoutStops, decemberKnown, summarise,
    stationView, verdictFor, minutesWords, hourWords, hourNote, busiestStations, matchStations, headlineChanges, stoppingGrid, orderStations, pairColumns,
} from './trains-stations.js';
import { renderHeadlines, renderStation, renderGrid, endWords } from './trains-render.js';
import { TIMETABLES, STATIONS, STATION_ORDER } from './trains-data.js';

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

    test('the real tables: end-of-line stations answer, stations passed through say they are waiting', () => {
        const { now, dec } = { now: TIMETABLES.now.SX.dep, dec: TIMETABLES.dec.SX.dep };
        assert.ok(stationView(now, dec, 'AYS', 'dep').dec, 'Aylesbury');
        assert.ok(stationView(now, dec, 'BMO', 'dep').dec, 'Birmingham Moor Street');
        for (const crs of ['GER', 'HWY', 'OXF']) {
            const v = stationView(now, dec, crs, 'dep');
            assert.equal(v.dec, null, crs);
            assert.equal(v.trains, null, crs);
            assert.equal(v.verdict.tone, 'unknown', crs);
        }
    });
});

describe('summarise — one station in numbers people already use', () => {
    test('counts, the off-peak hour, minutes past the hour, journey, first and last', () => {
        const rows = [...hourly(6, 'OXF', ['GER', 'OXF']), ...hourly(40, 'OXF', ['OXF']), row('05:54', 'OXF', '', '', 'GER0620 OXF0700'), row('00:10', 'OXF', '', '', 'OXF0105')];
        const s = summarise(rows, 'OXF', 'dep');
        assert.equal(s.total, 14);
        assert.equal(s.perHour, 2);
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
});

describe('verdictFor — the one sentence', () => {
    const s = (/** @type {Partial<import('./trains-stations.js').StationSummary>} */ o) =>
        ({ total: 10, perHour: 2, hourRange: /** @type {[number, number]} */ ([2, 2]), typical: 2, minutes: [6, 36], fastest: null, first: '06:00', last: '23:00', ...o });
    test('waiting, new, gone, more an hour, fewer an hour, more a day, moved, the same', () => {
        assert.equal(verdictFor(s({}), null, null).tone, 'unknown');
        assert.equal(verdictFor(s({ total: 0 }), s({}), []).text, 'New from 13 December: 10 direct trains a day.');
        assert.equal(verdictFor(s({ total: 0 }), s({ total: 1, first: '09:31' }), []).text, 'New from 13 December: one direct train, the 09:31.');
        assert.equal(verdictFor(s({}), s({ total: 0 }), []).text, 'No direct trains from 13 December.');
        assert.equal(verdictFor(s({}), s({ typical: 3, hourRange: [3, 3] }), []).text, 'More trains off-peak: 3 an hour, was 2.');
        assert.equal(verdictFor(s({}), s({ typical: 1, hourRange: [1, 1] }), []).text, 'Fewer trains off-peak: 1 an hour, was 2.');
        // Saturday Moor Street: most hours one train today, most hours two in December, both with exceptions.
        assert.equal(verdictFor(s({ typical: 1, hourRange: [1, 2] }), s({ typical: 2, hourRange: [1, 2], total: 14 }), []).text,
            'More trains off-peak: usually 2 an hour, was 1.');
        assert.equal(verdictFor(s({}), s({ total: 15 }), []).text, '5 more trains a day: 15, was 10.');
        assert.equal(verdictFor(s({}), s({ total: 11, minutes: [10, 40] }), []).text, '1 more train a day: 11, was 10.', 'never "same number" when one more');
        assert.equal(verdictFor(s({ typical: 0, hourRange: [0, 0] }), s({ typical: 0, hourRange: [0, 0], total: 12 }), []).text, '2 more trains a day: 12, was 10.', 'no off-peak claim for a station with no off-peak trains');
        assert.equal(verdictFor(s({ typical: 2, hourRange: [1, 2] }), s({ total: 15 }), []).text, '5 more trains a day: 15, was 10.', 'a typical hour that stays 2 is not an off-peak change, however the exceptions fill in');
        assert.equal(verdictFor(s({}), s({ minutes: [10, 40] }), []).text, 'Same number of trains. Off-peak times change from :06 and :36 to :10 and :40 past the hour.');
        assert.equal(verdictFor(s({}), s({}), []).text, 'No change.');
        assert.equal(verdictFor(s({}), s({}), [/** @type {any} */ ({ kind: 'later' })]).text, 'Same number of trains a day, but 1 is different — see Train by train below.');
    });
});

describe('finding a station', () => {
    test('trains an hour read as the typical hour, with the exception in brackets', () => {
        const w = (/** @type {number} */ t, /** @type {[number, number]} */ r) => hourWords(/** @type {any} */ ({ typical: t, hourRange: r }));
        assert.equal(w(2, [2, 2]), '2');
        assert.equal(w(2, [1, 2]), '2 (1 in some hours)');
        assert.equal(w(1, [1, 2]), '1 (2 in some hours)');
        assert.equal(w(3, [3, 4]), '3 (4 in some hours)');
        assert.equal(w(2, [1, 3]), '2 (1 to 3 in some hours)');
        assert.equal(w(0, [0, 0]), '0');
        assert.equal(hourNote(/** @type {any} */ ({ typical: 2, hourRange: [1, 2] })), '1 in some hours');
        assert.equal(hourNote(/** @type {any} */ ({ typical: 2, hourRange: [2, 2] })), '');
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
        assert.equal(out[0].text, 'Stratford-upon-Avon gets a direct train from Marylebone (the 12:30)');
        assert.equal(out[0].tone, 'more');
        assert.ok(!out.some(h => h.crs === 'HWY'), 'High Wycombe cannot be answered yet');
    });

    test('the real weekday tables lead with something, and every headline names a station', () => {
        const out = headlineChanges(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, STATIONS);
        assert.ok(out.length > 0);
        for (const h of out) assert.ok(STATIONS[h.crs], h.crs);
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
        const rows = hourly(6, 'OXF').map(r => /** @type {typeof r} */ ([r[0], r[1], r[2], 'MF', r[4]]));
        assert.equal(stoppingGrid(rows).columns.length, 0);
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
        assert.equal(out[0].text, 'Birmingham Moor Street: 2 trains an hour off-peak (was 1); 14 trains a day (was 8)');
    });

    test('a station a line runs on to is folded into the line\'s headline, never a second story', () => {
        const now = [...hourly(2, 'BMO'), row('18:02', 'BSW')];
        const dec = [...hourly(2, 'BMO'), row('18:02', 'BSW'), row('19:02', 'BSW'), row('20:02', 'BSW')];
        const out = headlineChanges(now, dec, STATIONS);
        assert.equal(out.length, 1);
        // The last train moves too: the onward clause still sits beside the count it qualifies.
        assert.equal(out[0].text, 'Birmingham Moor Street: 9 trains a day (was 7); 3 of them on to Snow Hill (was 1); last train 20:02 (was 18:02)');
        const real = headlineChanges(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, STATIONS);
        assert.ok(!real.some(h => h.crs === 'BSW' || h.crs === 'SBJ' || h.crs === 'AVP'), 'no onward station headlines its own line');
    });

    test('headlines: five, then a button for the rest, and the partial note', () => {
        const items = Array.from({ length: 7 }, (_, i) => ({ crs: 'AYS', tone: 'more', text: `Change ${i}` }));
        const html = renderHeadlines(items, { showAll: false, partial: true });
        assert.equal((html.match(/class="tr-head"/g) ?? []).length, 5);
        assert.match(html, /Show all 7 changes/);
        assert.match(html, /once Chiltern publishes December’s stops/);
        assert.doesNotMatch(renderHeadlines(items, { showAll: true, partial: false }), /Show all|tr-note/);
        assert.match(renderHeadlines([], { showAll: false, partial: false }), /No big changes/);
    });

    test('a headline is escaped and opens its station', () => {
        const html = renderHeadlines([{ crs: 'AYS', tone: 'less', text: '<b>x</b>' }], { showAll: false, partial: false });
        assert.match(html, /data-station="AYS"/);
        assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
        assert.match(html, />Less</);
    });

    test('a station card: verdict, today beside December, and a waiting December reads "not known yet" to a screen reader', () => {
        const view = stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'GER', 'dep');
        const html = renderStation(view, { stations: STATIONS, dir: 'dep', showTrains: false });
        assert.match(html, /tr-verdict--unknown/);
        assert.match(html, /Off-peak, leaves Marylebone at/);
        assert.match(html, /<td>:06, :10 and :40<\/td>/);
        assert.match(html, /<td>3<span class="sr-only"> \(<\/span><span class="tr-days">4 in some hours<\/span><span class="sr-only">\)<\/span><\/td>/, 'Gerrards Cross: three an hour, four in one — read aloud as "3 (4 in some hours)"');
        assert.match(html, /<span class="sr-only">not known yet<\/span>/);
        assert.doesNotMatch(html, /sr-only">none</, 'an unknown December figure is not "none"');
        assert.doesNotMatch(html, /See every train/, 'no train list without December');
        const back = renderStation(stationView(TIMETABLES.now.SX.arr, TIMETABLES.dec.SX.arr, 'AYS', 'arr'), { stations: STATIONS, dir: 'arr', showTrains: true });
        assert.match(back, /Off-peak, gets into Marylebone at/);
        assert.match(back, /<details class="tr-route" open>/);
    });

    test('the train list shows the trains that change; the rest are counted and one tap away', () => {
        const view = stationView(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep, 'AYS', 'dep');
        const changed = /** @type {any[]} */ (view.trains).filter(t => t.kind !== 'same').length;
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
    });

    test('a train that runs on names its onward stop in a few words', () => {
        assert.equal(endWords('AVP', 'AYS', STATIONS, true), 'on to Parkway');
        assert.equal(endWords('AVP', 'AYS', STATIONS, false), 'from Parkway');
        assert.equal(endWords('SBJ', 'BMO', STATIONS, true), 'on to Stourbridge');
        assert.equal(endWords('OXF', 'HWY', STATIONS, true), `to ${STATIONS.OXF}`);
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
        assert.match(dec, /tr-dot--lost/);
        assert.match(dec, /tr-dot--new/);
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
