/**
 * trains-change.test.mjs — what the Trains page says changes in December.
 * Run with: node --test trains-change.test.mjs   (no mocks; part of test:hygiene)
 *
 * The page's whole value is one sentence per train — "6 minutes later", "now runs to Birmingham" —
 * and a wrong one is worse than none, because a member of staff repeats it to a passenger. So the
 * pairing rules are pinned on small hand-made tables where the right answer is obvious, and then
 * the real generated tables are held to the facts that were checked against the printed books.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    serviceMinutes, alignTimes, compareRoutes, foldWeekdayVariants, basicHour, compareBasicHour,
    trainsNear, parseTypedTime, daysUntil, changeLabel, daysLabel, routeName, MAX_SHIFT_MIN, beyondLabel, lineDepth,
} from './trains-change.js';
import { TIMETABLES, STATIONS, CHANGE_DATE } from './trains-data.js';

/** @param {string} t @param {string} [st] @param {string} [via] @param {string} [days] @param {string} [stops] @returns {[string,string,string,string,string]} */
const row = (t, st = 'OXF', via = '', days = '', stops = '') => [t, st, via, days, stops];
const kinds = (/** @type {any[]} */ ts) => ts.map(t => `${t.now ?? '-'}>${t.dec ?? '-'} ${t.kind}`);

describe('the railway day', () => {
    test('starts at 03:00, so the last train of the evening sorts last', () => {
        assert.ok(serviceMinutes('00:15') > serviceMinutes('23:45'));
        assert.equal(serviceMinutes('03:00'), 0);
    });
});

describe('alignTimes — which December train is "the same train"', () => {
    test('identical times are unchanged; a small retiming is reported with its direction', () => {
        assert.deepEqual(kinds(alignTimes([row('10:06'), row('10:40')], [row('10:06'), row('10:43')])),
            ['10:06>10:06 same', '10:40>10:43 later']);
        const [t] = alignTimes([row('08:07')], [row('08:03')]);
        assert.equal(t.shift, -4);
        assert.equal(t.kind, 'earlier');
    });

    test('never crosses: two trains that both moved keep their order', () => {
        // A greedy nearest match pairs 17:10 with 17:08 and leaves 17:20 to 17:18 — fine here — but
        // with 17:10/17:20 against 17:19/17:29 it would pair 17:20 first and strand 17:10. In order:
        assert.deepEqual(kinds(alignTimes([row('17:10'), row('17:20')], [row('17:19'), row('17:29')])),
            ['17:10>17:19 later', '17:20>17:29 later']);
    });

    test('beyond the threshold a time is left unpaired, as new or no longer running', () => {
        const out = alignTimes([row('09:00')], [row(`09:${String(MAX_SHIFT_MIN + 1).padStart(2, '0')}`)]);
        assert.deepEqual(out.map(t => t.kind).sort(), ['gone', 'new']);
    });

    test('an extra train lands between its neighbours, listed in time order', () => {
        assert.deepEqual(kinds(alignTimes([row('10:36'), row('12:36')], [row('10:36'), row('11:36'), row('12:36')])),
            ['10:36>10:36 same', '->11:36 new', '12:36>12:36 same']);
    });

    test('works across midnight', () => {
        assert.deepEqual(kinds(alignTimes([row('23:55')], [row('00:05')])), ['23:55>00:05 later']);
    });
});

describe('foldWeekdayVariants — a train that runs at two times on different weekdays', () => {
    test('the Mondays-and-Fridays time follows its Tuesday-to-Thursday partner, not "no longer runs"', () => {
        const aligned = alignTimes([row('17:33', 'BSW', '', 'MFX'), row('17:37', 'BSW', '', 'MFO')], [row('17:33', 'BSW')]);
        const folded = foldWeekdayVariants(aligned);
        const mfo = folded.find(t => t.days === 'MFO');
        assert.equal(mfo?.dec, '17:33');
        assert.equal(mfo?.kind, 'earlier');
        assert.equal(folded.filter(t => t.kind === 'gone').length, 0);
    });

    test('a left-over with no partner on the opposite days is left alone', () => {
        const folded = foldWeekdayVariants(alignTimes([row('17:37', 'PRR', '', 'MFX')], []));
        assert.equal(folded[0].kind, 'gone');
    });
});

describe('compareRoutes — one train, a different destination', () => {
    test('a train cut from one route and added to another at the same time is ONE rerouted train', () => {
        const routes = compareRoutes([row('10:36', 'BAN')], [row('10:36', 'BSW')]);
        const ban = routes.find(r => r.key === 'BAN'), bsw = routes.find(r => r.key === 'BMO');   // Snow Hill is the Moor Street line
        assert.equal(ban?.trains[0].kind, 'rerouted');
        assert.equal(changeLabel(/** @type {any} */ (ban).trains[0], STATIONS), 'Will run to Birmingham Snow Hill');
        assert.equal(changeLabel(/** @type {any} */ (bsw).trains[0], STATIONS), 'Was the 10:36 to Banbury');
        assert.equal(ban?.tally.gone, 0);
        assert.equal(bsw?.tally.new, 0);
    });

    test('the Aylesbury route is part of where a train goes', () => {
        const routes = compareRoutes([row('07:57', 'AYS', 'H')], [row('07:57', 'AYS', 'A')]);
        assert.equal(routes.length, 2);
        assert.equal(changeLabel(routes.find(r => r.via === 'H')?.trains[0] ?? /** @type {any} */ ({}), STATIONS), 'Will run to Aylesbury via Amersham');
    });

    test('arrivals are worded as where the train comes from', () => {
        const routes = compareRoutes([row('09:13', 'BAN')], [row('09:12', 'BMO')]);
        const bmo = routes.find(r => r.key === 'BMO');
        assert.equal(changeLabel(/** @type {any} */ (bmo).trains[0], STATIONS, 'arr'), 'Was the 09:13 from Banbury');
        const ban = routes.find(r => r.key === 'BAN');
        assert.equal(changeLabel(/** @type {any} */ (ban).trains[0], STATIONS, 'arr'), 'Will come from Birmingham Moor Street, 09:12');
    });

    test('across routes only a close match counts — otherwise it is a genuinely new train', () => {
        const routes = compareRoutes([row('10:00', 'BAN')], [row('10:10', 'BSW')]);
        assert.deepEqual(routes.map(r => r.trains[0].kind).sort(), ['gone', 'new']);
    });
});

describe('a line that runs on — Aylesbury Vale Parkway is the Amersham line, one stop further', () => {
    test('the Parkway has no route of its own: its trains are the line\'s', () => {
        const routes = compareRoutes([row('10:27', 'AYS', 'A'), row('10:57', 'AVP')], [row('10:27', 'AYS', 'A'), row('10:57', 'AVP')]);
        assert.deepEqual(routes.map(r => [r.key, r.station, r.via, r.nowCount]), [['AYSA', 'AYS', 'A', 2]]);
        assert.equal(routeName(STATIONS, routes[0].station, routes[0].via), 'Aylesbury via Amersham');
    });

    test('a kept train whose END moves is one train, worded by where it now ends or starts', () => {
        const [cut] = compareRoutes([row('08:27', 'AVP')], [row('08:27', 'AYS', 'A')])[0].trains;
        assert.equal(cut.kind, 'terminus');
        assert.equal(changeLabel(cut, STATIONS), 'Will end at Aylesbury');
        const [ext] = compareRoutes([row('07:57', 'AYS', 'A')], [row('07:59', 'AVP')])[0].trains;
        assert.equal(changeLabel(ext, STATIONS), 'Will go on to Aylesbury Vale Parkway, 07:59');
        assert.equal(changeLabel(ext, STATIONS, 'arr'), 'Will start at Aylesbury Vale Parkway, 07:59');
    });

    test('the via-High-Wycombe Aylesbury trains are a different line and are not folded in', () => {
        const routes = compareRoutes([row('10:52', 'AYS', 'H'), row('10:57', 'AVP')], []);
        assert.deepEqual(routes.map(r => r.key).sort(), ['AYSA', 'AYSH']);
    });

    test('the basic hour marks which minutes run on', () => {
        const hours = ['10', '11', '12', '13', '14', '15'];
        const [line] = basicHour(hours.flatMap(h => [row(`${h}:27`, 'AYS', 'A'), row(`${h}:57`, 'AVP')]));
        assert.deepEqual([line.key, line.minutes, line.beyond], ['AYSA', [27, 57], [{ minute: 57, to: 'AVP' }]]);
    });

    test('and says so in words, December first', () => {
        const r = { key: 'AYSA', dec: [27, 57], decBeyond: [{ minute: 57, to: 'AVP' }], nowBeyond: [{ minute: 27, to: 'AVP' }] };
        assert.equal(beyondLabel(r, STATIONS), ':57 goes on to Aylesbury Vale Parkway');
        assert.equal(beyondLabel(r, STATIONS, 'arr'), ':57 starts at Aylesbury Vale Parkway');
        assert.equal(beyondLabel({ ...r, key: 'OXF' }, STATIONS), '');
    });
});

describe('a line with two onward stops — Snow Hill and Stourbridge are Moor Street trains run on', () => {
    test('all three are one route, named by the line\'s own station', () => {
        const routes = compareRoutes([row('10:02', 'BMO'), row('10:36', 'BSW'), row('16:37', 'SBJ')], []);
        assert.deepEqual(routes.map(r => [r.key, r.station, r.nowCount]), [['BMO', 'BMO', 3]]);
    });

    test('further along the line is "goes on to"; back towards London is "ends at"', () => {
        const [on] = compareRoutes([row('16:37', 'BMO')], [row('16:37', 'SBJ')])[0].trains;
        assert.equal(changeLabel(on, STATIONS), 'Will go on to Stourbridge Junction');
        const [back] = compareRoutes([row('18:37', 'SBJ')], [row('18:34', 'BSW')])[0].trains;
        assert.equal(changeLabel(back, STATIONS), 'Will end at Birmingham Snow Hill, 18:34');
    });

    test('lineDepth orders a line from its own station outwards', () => {
        assert.deepEqual(['BMO', 'BSW', 'SBJ', 'AYS', 'AVP', 'OXF'].map(lineDepth), [0, 1, 2, 0, 1, -1]);
    });

    test('a train rerouted ONTO the line names where it actually goes, not the line\'s station', () => {
        const ban = compareRoutes([row('10:36', 'BAN')], [row('10:36', 'BSW')]).find(r => r.key === 'BAN');
        assert.equal(changeLabel(/** @type {any} */ (ban).trains[0], STATIONS), 'Will run to Birmingham Snow Hill');
    });

    test('the basic-hour words name each onward stop separately', () => {
        const r = { key: 'BMO', dec: [2, 32, 36], decBeyond: [{ minute: 32, to: 'SBJ' }, { minute: 36, to: 'BSW' }], nowBeyond: [] };
        assert.equal(beyondLabel(r, STATIONS), ':32 goes on to Stourbridge Junction; :36 goes on to Birmingham Snow Hill');
    });
});

describe('the basic hour', () => {
    test('a minute counts when it repeats in most of the off-peak hours', () => {
        const rows = ['10', '11', '12', '13'].map(h => row(`${h}:06`)).concat([row('14:20')]);
        assert.deepEqual(basicHour(rows).map(r => r.minutes), [[6]]);
    });

    test('a weekday exception is never part of the pattern', () => {
        const rows = ['10', '11', '12', '13', '14', '15'].map(h => row(`${h}:33`, 'BSW', '', 'MFX'));
        assert.deepEqual(basicHour(rows), []);
    });

    test('before and after are paired by route, and flagged only when they differ', () => {
        const hours = ['10', '11', '12', '13', '14', '15'];
        const out = compareBasicHour(hours.map(h => row(`${h}:02`, 'BMO')),
            hours.flatMap(h => [row(`${h}:02`, 'BMO'), row(`${h}:32`, 'BMO')]));
        assert.deepEqual(out.map(r => [r.now, r.dec, r.changed]), [[[2], [2, 32], true]]);
    });
});

describe('looking up a time', () => {
    test('people type times in several ways; anything else is refused, never guessed', () => {
        for (const [typed, want] of [['17:15', '17:15'], ['1715', '17:15'], ['715', '07:15'], ['7.05', '07:05'], [' 9:30 ', '09:30'],
            // …and the way people SAY one (v24.79): an a.m./p.m. tail decides the half of the day.
            ['5.15pm', '17:15'], ['515pm', '17:15'], ['5:15 pm', '17:15'], ['5pm', '17:00'], ['7am', '07:00'],
            ['12pm', '12:00'], ['12am', '00:00'], ['12.30am', '00:30'], ['9.05 a.m.', '09:05'], ['17 15', '17:15'], ['17.15', '17:15']]) {
            assert.equal(parseTypedTime(typed), want, typed);
        }
        // A bare hour needs am or pm ("5" is 05:00 to a parser and 17:00 to the person); "13pm" is nobody's time.
        for (const bad of ['', '25:00', '17:60', 'noon', '1', '17:1', '5', '13pm', '0pm', '17:15pm', 'pm', '5.15xm']) assert.equal(parseTypedTime(bad), null, bad);
    });

    test('trainsNear returns both timetables within the window, in time order', () => {
        const near = trainsNear([row('17:20'), row('17:00'), row('18:00')], [row('17:10')], '17:15');
        assert.deepEqual(near.now.map(r => r[0]), ['17:00', '17:20']);
        assert.deepEqual(near.dec.map(r => r[0]), ['17:10']);
    });
});

describe('words', () => {
    test('days to go are counted on dates, so the October clock change cannot make it a day out', () => {
        assert.equal(daysUntil(new Date(2026, 9, 7, 23, 30), '2026-12-13'), 67);
        assert.equal(daysUntil(new Date(2026, 11, 13, 0, 1), '2026-12-13'), 0);
        assert.equal(daysUntil(new Date(2026, 11, 14), '2026-12-13'), -1);
    });

    test('labels', () => {
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'later', shift: 1 })), '1 min later');
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'earlier', shift: -6 })), '6 mins earlier');
        assert.equal(daysLabel('MFO'), 'Mon and Fri only');
        assert.equal(daysLabel(''), '');
        assert.equal(routeName(STATIONS, 'AYS', 'H'), 'Aylesbury via High Wycombe');
        assert.equal(routeName(STATIONS, 'OXF', ''), 'Oxford');
    });
});

// ── The generated tables, held to facts checked by hand against the printed books ─────────────

describe('trains-data.js', () => {
    test('the change date is the Sunday the December timetable starts', () => {
        assert.equal(CHANGE_DATE, '2026-12-13');
        assert.equal(new Date(2026, 11, 13).getDay(), 0);
    });

    test('departure counts match the sources', () => {
        const counts = (/** @type {'now'|'dec'} */ side) => ['SX', 'SO', 'SU'].map(d => TIMETABLES[side][/** @type {'SX'} */ (d)].dep.length);
        assert.deepEqual(counts('now'), [146, 100, 91]);
        assert.deepEqual(counts('dec'), [157, 105, 94]);
    });

    test('every row is a well-formed passenger train at a named station', () => {
        for (const side of /** @type {const} */ (['now', 'dec'])) for (const day of /** @type {const} */ (['SX', 'SO', 'SU'])) {
            for (const kind of /** @type {const} */ (['dep', 'arr'])) for (const [t, st, via, days, stops] of TIMETABLES[side][day][kind]) {
                assert.match(t, /^([01]\d|2[0-3]):[0-5]\d$/);
                assert.ok(STATIONS[st], `${side} ${day} ${kind} ${t}: unnamed station ${st}`);
                assert.ok(via === '' || (st === 'AYS' && (via === 'H' || via === 'A')), `${t} ${st} route ${via}`);
                assert.ok(['', 'MFO', 'MFX', 'WO'].includes(days));
                if (side === 'dec') assert.equal(days, '', 'December has no weekday exceptions on record');
                assert.match(stops, /^(|[A-Z]{3}\d{4}( [A-Z]{3}\d{4})*)$/, `${side} ${day} ${kind} ${t}: stops`);
                for (const stop of stops ? stops.split(' ') : []) assert.ok(STATIONS[stop.slice(0, 3)], `unnamed stop ${stop}`);
                if (side === 'now') assert.ok(stops, `today's ${t} ${st} has its stops`);
            }
        }
    });

    test('checked by hand: the 10:36 to Banbury now runs on to Birmingham Snow Hill', () => {
        const ban = compareRoutes(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep).find(r => r.key === 'BAN');
        const t = ban?.trains.find(x => x.now === '10:36');
        assert.equal(t && changeLabel(t, STATIONS), 'Will run to Birmingham Snow Hill');
    });

    test('checked by hand: the weekday basic hour from 10:00 to 16:00', () => {
        const dec = basicHour(TIMETABLES.dec.SX.dep).map(r => `:${String(r.minutes[0]).padStart(2, '0')} ${r.key}`);
        assert.deepEqual(dec, [':02 BMO', ':06 OXF', ':10 HWY', ':27 AYSA']);
    });

    test('checked by hand: the Amersham line is half-hourly, the :57 running on to the Parkway', () => {
        const line = basicHour(TIMETABLES.dec.SX.dep).find(r => r.key === 'AYSA');
        assert.deepEqual(line?.minutes, [27, 57]);
        assert.deepEqual(line?.beyond, [{ minute: 57, to: 'AVP' }]);
    });

    test('checked by hand: the Birmingham line is half-hourly, the :36 running on to Snow Hill', () => {
        const line = basicHour(TIMETABLES.dec.SX.dep).find(r => r.key === 'BMO');
        assert.deepEqual(line?.minutes, [2, 36]);
        assert.deepEqual(line?.beyond, [{ minute: 36, to: 'BSW' }]);
    });
});
