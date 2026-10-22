/**
 * trains-change.test.mjs — what the Trains page says changes in December.
 * Run with: node --test trains-change.test.mjs   (no mocks; part of test:hygiene)
 *
 * The page's whole value is one sentence per train — "6 minutes later", "Will run to Birmingham" —
 * and a wrong one is worse than none, because a member of staff repeats it to a passenger. So the
 * pairing rules are pinned on small hand-made tables where the right answer is obvious, and then
 * the real generated tables are held to the facts that were checked against the printed books.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    serviceMinutes, alignTimes, compareRoutes, foldWeekdayVariants, trainsNear, parseTypedTime, daysUntil, changeLabel,
    daysLabel, routeName, MAX_SHIFT_MIN, NEAR_WINDOW_MIN, lineDepth, timetablePhase, dateWords,
} from './trains-change.js';
import { stoppingGrid, aRealDay, callsOf } from './trains-stations.js';
import { TIMETABLES, STATIONS, CHANGE_DATE, FURTHER_CHANGES_UNTIL, DEC_VALID_UNTIL, LEAF_FALL } from './trains-data.js';

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
        // The threshold itself, in minutes the tips state: 20 is still the same train, 21 is not.
        assert.equal(MAX_SHIFT_MIN, 20);
        assert.deepEqual(kinds(alignTimes([row('09:00')], [row('09:20')])), ['09:00>09:20 later']);
    });

    test('the unpaired are listed by time, not by where the alignment left them', () => {
        // The backtrack puts both new trains before the one that goes; a reader scans by time.
        assert.deepEqual(kinds(alignTimes([row('10:30')], [row('10:00'), row('11:00')])), ['->10:00 new', '10:30>- gone', '->11:00 new']);
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
        // The window the page states ("within 15 minutes") is the one it uses.
        assert.equal(NEAR_WINDOW_MIN, 15);
        assert.deepEqual(trainsNear([row('17:00'), row('16:59')], [], '17:15').now.map(r => r[0]), ['17:00']);
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
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'same' })), 'No change');
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'new' })), 'New train');
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'gone' })), 'No longer runs');
        assert.equal(daysLabel('MFO'), 'Mon and Fri only');
        assert.equal(daysLabel('MFX'), 'Tue to Thu only');
        assert.equal(daysLabel(''), '');
        assert.equal(routeName(STATIONS, 'AYS', 'H'), 'Aylesbury via High Wycombe');
        assert.equal(routeName(STATIONS, 'OXF', ''), 'Oxford');
    });

    test('a station\'s own words: a train that passes it, or starts calling, is not one that goes or comes (v24.83)', () => {
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'passes' })), 'Will no longer stop here');
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'calls' })), 'Will stop here');
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'passes' }), {}, 'dep', { started: true }), 'No longer stops here');
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'calls' }), {}, 'dep', { started: true }), 'Now stops here');
        // Kept at the station, moved at the other end: the second thing a passenger asks.
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'same', farShift: 5 })), 'Same time, gets there 5 mins later');
        assert.equal(changeLabel(/** @type {any} */ ({ kind: 'same', farShift: -1 }), {}, 'arr'), 'Same time, gets in 1 min earlier');
        // A new end that also moves the train here says both — the station's change first.
        const t = /** @type {any} */ ({ kind: 'terminus', nowTo: 'BMO', decTo: 'SBJ', dec: '09:16', shift: 3, atShift: -1 });
        assert.equal(changeLabel(t, STATIONS, 'arr', { withTime: false }), '1 min earlier, will start at Stourbridge Junction');
        assert.equal(changeLabel(t, STATIONS, 'arr'), 'Will start at Stourbridge Junction, 09:16', 'the lookup keeps its time');
    });

    test('the tense follows the change date: "Will" before it, "Now" after (v24.83)', () => {
        const [ext] = compareRoutes([row('07:57', 'AYS', 'A')], [row('07:57', 'AVP')])[0].trains;
        assert.equal(changeLabel(ext, STATIONS), 'Will go on to Aylesbury Vale Parkway');
        assert.equal(changeLabel(ext, STATIONS, 'dep', { started: true }), 'Now goes on to Aylesbury Vale Parkway');
        assert.equal(changeLabel(ext, STATIONS, 'arr', { started: true }), 'Now starts at Aylesbury Vale Parkway');
        const ban = compareRoutes([row('10:36', 'BAN')], [row('10:36', 'BSW')]).find(r => r.key === 'BAN');
        assert.equal(changeLabel(/** @type {any} */ (ban).trains[0], STATIONS, 'dep', { started: true }), 'Now runs to Birmingham Snow Hill');
    });
});

describe('timetablePhase — what the page calls things, on which day (v24.83)', () => {
    const D = { change: '2026-12-13', festiveUntil: '2027-01-10', validUntil: '2027-05-15' };
    const at = (/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ d, h = 10) => timetablePhase(new Date(y, m - 1, d, h), D);
    test('before the change: counting down, and the first column is today\'s', () => {
        assert.deepEqual(at(2026, 10, 21), { phase: 'before', started: false, countdown: '53 days to go', oldLabel: 'Now', newLabel: 'From 13 Dec', festive: true });
        assert.equal(at(2026, 12, 11).countdown, '2 days to go');
        assert.equal(at(2026, 12, 12, 23).countdown, 'Starts tomorrow');
    });
    test('from the change: the first column is the old timetable, by name', () => {
        assert.deepEqual(at(2026, 12, 13, 0), { phase: 'running', started: true, countdown: 'Starts today', oldLabel: 'Until 12 Dec', newLabel: 'From 13 Dec', festive: true });
        assert.equal(at(2026, 12, 20).countdown, 'Now running');
    });
    test('the Christmas note lasts through the 10th of January and not after', () => {
        assert.equal(at(2027, 1, 10, 23).festive, true);
        assert.equal(at(2027, 1, 11, 0).festive, false);
    });
    test('once December\'s books expire, the page says the timetable has ended', () => {
        assert.equal(at(2027, 5, 15, 23).phase, 'running');
        assert.deepEqual([at(2027, 5, 16).phase, at(2027, 5, 16).countdown], ['ended', 'Timetable ended']);
    });
    test('dates are derived, never typed', () => {
        assert.equal(dateWords('2026-12-13'), '13 December');
        assert.equal(dateWords('2026-12-13', -1, { weekday: true }), 'Saturday 12 December');
        assert.equal(dateWords('2026-12-13', 0, { short: true, weekday: true }), 'Sunday 13 Dec');
        assert.equal(dateWords('2027-01-01', -1), '31 December');
    });
});

// ── The generated tables, held to facts checked by hand against the printed books ─────────────

describe('trains-data.js', () => {
    test('the change date is the Sunday the December timetable starts', () => {
        assert.equal(CHANGE_DATE, '2026-12-13');
        assert.equal(new Date(2026, 11, 13).getDay(), 0);
    });

    test('the Christmas note lasts as long as the changes Chiltern says it will still make', () => {
        // Chiltern's timetable page (checked 20 Oct 2026): "Further changes will be made to the
        // timetable between 13 December 2026 and 10 January 2027".
        assert.equal(FURTHER_CHANGES_UNTIL, '2027-01-10');
        assert.ok(FURTHER_CHANGES_UNTIL > CHANGE_DATE);
        // The page shows the note while this is not negative: still on the 10th, gone on the 11th.
        assert.equal(daysUntil(new Date(2027, 0, 10, 23, 30), FURTHER_CHANGES_UNTIL), 0);
        assert.equal(daysUntil(new Date(2027, 0, 11, 0, 30), FURTHER_CHANGES_UNTIL), -1);
    });

    test('departure counts match the sources', () => {
        const counts = (/** @type {'now'|'dec'} */ side) => ['SX', 'SO', 'SU'].map(d => TIMETABLES[side][/** @type {'SX'} */ (d)].dep.length);
        // Rows, not trains: today's weekdays print a few trains twice, once for Mondays and Fridays and
        // once for the other days (v24.83 keeps the two apart where they stop differently).
        assert.deepEqual(counts('now'), [147, 100, 91]);
        // A real day — counted off the books by the data review (v24.83): 145 leave Marylebone on a
        // Tuesday to Thursday, 144 on a Monday or Friday. "146" was a day that never happens.
        assert.equal(aRealDay(TIMETABLES.now.SX.dep).length, 145);
        assert.equal(TIMETABLES.now.SX.dep.filter(r => r[3] !== 'MFX' && r[3] !== 'WO').length, 144);
        // Counted off the printed December books by hand (v24.80): weekdays 116 main-line columns
        // leaving Marylebone plus 45 in the Amersham book, less 3 printed in both; Saturdays and
        // Sundays the same way. The roster office's simplifier, December's source before the books,
        // had 157 on weekdays — its weekday plan was a draft, and the published evening peak moved.
        assert.deepEqual(counts('dec'), [158, 105, 94]);
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
                // Both sides from Chiltern's public books since v24.80, so every train has its stops.
                assert.ok(stops, `${side} ${t} ${st} has its stops`);
            }
        }
    });

    test('checked by hand: the 10:36 to Banbury now runs on to Birmingham Snow Hill', () => {
        const ban = compareRoutes(TIMETABLES.now.SX.dep, TIMETABLES.dec.SX.dep).find(r => r.key === 'BAN');
        const t = ban?.trains.find(x => x.now === '10:36');
        assert.equal(t && changeLabel(t, STATIONS), 'Will run to Birmingham Snow Hill');
    });

    test('checked by hand against the December book: the 10:36 and where it stops', () => {
        const t = TIMETABLES.dec.SX.dep.find(r => r[0] === '10:36');
        assert.equal(t?.[1], 'BSW');
        const at = Object.fromEntries((t?.[4] ?? '').split(' ').map(s => [s.slice(0, 3), s.slice(3)]));
        assert.deepEqual([at.HWY, at.BAN, at.LMS, at.BMO, at.BSW], ['1106', '1142', '1201', '1234', '1238']);
    });

    // These facts were checked by hand against the books, and are pinned on the grid the page DRAWS
    // (`stoppingGrid`). Until v24.83 they were pinned on `basicHour`, which nothing had rendered since
    // v24.74 — so the grid on screen had no hand-checked fact behind it at all.
    test('checked by hand: the weekday basic hour from 10:00 to 16:00, and where each runs to', () => {
        const cols = (/** @type {'now'|'dec'} */ side) => stoppingGrid(TIMETABLES[side].SX.dep).columns.map(c => `:${String(c.minute).padStart(2, '0')} ${c.end}${c.via}`);
        assert.deepEqual(cols('dec'), [':02 BMO', ':06 OXF', ':10 HWY', ':27 AYSA', ':36 BSW', ':40 OXF', ':57 AVP']);
        // Today's :27 Amersham train runs in only four of the six hours; December's in all six.
        assert.deepEqual(stoppingGrid(TIMETABLES.now.SX.dep).columns.filter(c => c.minute === 27).map(c => [c.hours, c.of]), [[4, 6]]);
    });

    test('checked by hand: a column is every hour\'s train — the :10 alternates West Ruislip and Denham Golf Club', () => {
        const ten = stoppingGrid(TIMETABLES.dec.SX.dep).columns.find(c => c.minute === 10);
        assert.deepEqual([...(ten?.some ?? [])].sort(), ['DGC', 'WRU'], 'each in some hours only');
        // The :36 reaches Birmingham every hour from December; today two of them end at Banbury.
        const now36 = stoppingGrid(TIMETABLES.now.SX.dep).columns.find(c => c.minute === 36);
        const dec36 = stoppingGrid(TIMETABLES.dec.SX.dep).columns.find(c => c.minute === 36);
        assert.ok(now36?.some.includes('LMS') && dec36?.calls.includes('LMS') && !dec36.some.includes('LMS'));
    });
});

describe('trains-data.js — what the books print that a plain list of stops cannot say (v24.83)', () => {
    const train = (/** @type {'now'|'dec'} */ side, /** @type {'SX'|'SO'|'SU'} */ day, /** @type {'dep'|'arr'} */ dir, /** @type {string} */ t, /** @type {string} */ end) =>
        TIMETABLES[side][day][dir].filter(r => r[0] === t && r[1] === end);
    test('a pick-up-only stop is not a stop for anyone leaving London, nor a set-down-only one coming in', () => {
        // Each letter checked on the rendered page by the data review: "u" pick up only, "s" set down only.
        assert.ok(!callsOf(train('dec', 'SX', 'dep', '17:03', 'SBJ')[0]).includes('BCS'), 'December 17:03: Bicester North 17:56u');
        assert.ok(!callsOf(train('dec', 'SX', 'dep', '18:14', 'BAN')[0]).includes('HDM'), 'December 18:14: Haddenham 18:53u');
        assert.ok(!callsOf(train('now', 'SX', 'dep', '18:37', 'SBJ')[0]).includes('PRR'), 'today\'s 18:37: Princes Risborough 19:09u');
        assert.ok(!callsOf(train('dec', 'SX', 'arr', '11:20', 'BSW')[0]).includes('HWY'), 'December 11:20 in: High Wycombe 10:49s');
        assert.ok(!callsOf(train('dec', 'SU', 'arr', '10:15', 'BMO')[0]).includes('BAN'), 'December Sunday 10:15 in: Banbury 09:18s');
    });
    test('"c — arrives 8 minutes earlier": the arrival is what a passenger leaving London is told', () => {
        assert.match(train('now', 'SX', 'dep', '22:10', 'AYS')[0][4], /PRR2306/);
        assert.match(train('dec', 'SX', 'dep', '22:11', 'AYS')[0][4], /PRR2306/);
    });
    test('two weekday versions that stop differently stay two rows, each with its days', () => {
        const oxf = train('now', 'SX', 'dep', '17:45', 'OXF');
        assert.deepEqual(oxf.map(r => r[3]).sort(), ['MFO', 'MFX']);
        assert.ok(callsOf(/** @type {any} */ (oxf.find(r => r[3] === 'MFO'))).includes('HWY'), 'Mondays and Fridays: High Wycombe');
        assert.ok(callsOf(/** @type {any} */ (oxf.find(r => r[3] === 'MFX'))).includes('BCF'), 'other weekdays: Beaconsfield');
        assert.deepEqual(train('now', 'SX', 'arr', '08:03', 'OXF').map(r => r[3]).sort(), ['MFO', 'MFX']);
    });
    test('when the December books run out, and the leaf-fall weeks', () => {
        assert.equal(DEC_VALID_UNTIL, '2027-05-15');
        assert.equal(LEAF_FALL.until, '2027-01-10');
        assert.equal(LEAF_FALL.minutes, 3);
        assert.deepEqual([...LEAF_FALL.stations], ['AVP', 'AYS', 'SKM', 'WND', 'GMN', 'AMR', 'CFO', 'CLW']);
        for (const c of LEAF_FALL.stations) assert.ok(STATIONS[c], c);
    });
});
