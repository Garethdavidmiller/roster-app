// @ts-check
/**
 * trains-stations.js — PURE: the timetable seen from a STATION, not from the end of the line.
 *
 * Staff are asked "how do I get to Gerrards Cross?", not "what is the 10:10's terminus?". So the
 * Trains page is organised by the station a customer is going to (or coming back from), and every
 * figure here is about one station: trains a day, trains an hour off-peak, the minutes past the
 * hour, the fastest journey, the first and last train. This module computes them; the page renders.
 *
 * ── WHAT IS KNOWN, AND WHAT IS NOT YET ─────────────────────────────────────────────────────────
 *
 * Every train carries its stops (`row[4]`), read from Chiltern's printed timetables — today's, and
 * since v24.80 December's, when Chiltern published its December books. Before that, December came
 * from the roster office's simplifier, which holds only the time at Marylebone and the far end, and
 * the rules below are what kept the page honest then; they still hold for any source without stops
 * (build.py falls back to the simplifier). Without stops, a December figure is reported for a
 * station only when it can be known WITHOUT them:
 *   - a train calls where it ends, and
 *   - on a line that runs on (`LINES` in trains-change.js) it also calls at the line's stations
 *     before its end — owner fact: those trains ARE the line's trains, run on.
 * A station is "knowable" when every one of today's trains calling there ends there or further
 * along its line; anywhere else, December is `null` and the page says it is waiting, rather than
 * counting only the trains that happen to end there and calling that the service. A short count
 * presented as the answer is the failure this rule exists to prevent.
 *
 * ── EVERY TIME IS WHERE THE PASSENGER GETS ON ──────────────────────────────────────────────────
 *
 * Going there, that is Marylebone: when a train leaves. Coming back, it is the station on the card —
 * when the train leaves THERE (`boardingTime`), with its time into Marylebone as small print. Until
 * v24.83 coming back was measured at Marylebone too, and a train that kept its London arrival but
 * left Banbury ten minutes sooner read "No change" — to the one person it mattered to, a missed
 * train. Journey minutes are measured between the two ends either way, and need the train's stops.
 *
 * ── ONE REAL DAY ────────────────────────────────────────────────────────────────────────────────
 *
 * Today's weekdays are not all alike: a few trains run only on Mondays and Fridays and their
 * partners only Tuesday to Thursday. Counted row by row, one train was two, and "146 a weekday" was
 * a day that never happens. So every COUNT is of one real day (`aRealDay`) — a weekday's is a
 * Tuesday-to-Thursday's, three days of five — while a station's train list still shows both
 * versions, each with its days.
 */

import { serviceMinutes, alignTimes, compareRoutes, LINES, lineDepth, PATTERN_HOURS, MAX_SHIFT_MIN } from './trains-change.js';
import { STATION_ORDER } from './trains-data.js';

/** @typedef {import('./trains-change.js').TrainRow} TrainRow */
/** @typedef {import('./trains-change.js').PairedTrain} PairedTrain */

/**
 * @typedef {object} StationSummary
 * @property {number} total        trains in the day
 * @property {number[]} hourCounts trains in each daytime hour (PATTERN_HOURS), first hour first
 * @property {number} daytime      trains in the daytime window altogether
 * @property {[number, number]} hourRange  the fewest and the most trains in any one daytime hour — shown
 *                                 to a reader, because an average of 2 hid two hours with only 1 train
 * @property {number|null} typical the trains in a TYPICAL daytime hour — a count MOST of the hours share —
 *                                 or null when no count does (`rateWords` then gives the range). A tie
 *                                 went to the higher until v24.83, which made 3, 3, 2, 2, 1, 1 "usually 3"
 * @property {number[]} minutes    minutes past the hour, at the boarding station, that repeat in most daytime hours
 * @property {number|null} fastest quickest journey in minutes, or null when no train's stop times are known
 * @property {string|null} first   first train of the railway day, at the boarding station
 * @property {string|null} last    last train of the railway day, at the boarding station
 */

/**
 * The trains of one real day of this kind (see the header): a weekday's figures are a Tuesday to
 * Thursday's, so a Mondays-and-Fridays-only train ('MFO') and a Wednesdays-only one ('WO') are left
 * out of every count. A day with no exceptions is returned whole.
 * @param {TrainRow[]} rows
 * @returns {TrainRow[]}
 */
export const aRealDay = (rows) => rows.filter(r => r[3] !== 'MFO' && r[3] !== 'WO');

/**
 * When a passenger gets on (see the header): leaving Marylebone, the train's time there; coming back,
 * its time at `crs` — the departure, from its stops — or its Marylebone time when its stops are not
 * known.
 * @param {TrainRow} row
 * @param {string} crs
 * @param {'dep'|'arr'} dir
 * @returns {string}
 */
export function boardingTime(row, crs, dir) {
    if (dir === 'dep') return row[0];
    return parseStops(row).find(s => s.crs === crs)?.time ?? row[0];
}

/**
 * A row's stops as `[{ crs, time }]`. Empty when they are not known.
 * @param {TrainRow} row
 * @returns {{ crs: string, time: string }[]}
 */
export function parseStops(row) {
    const s = row[4] ?? '';
    if (!s) return [];
    return s.split(' ').map(t => ({ crs: t.slice(0, 3), time: `${t.slice(3, 5)}:${t.slice(5, 7)}` }));
}

/** @param {TrainRow} row */
export const stopsKnown = (row) => !!row[4];

/**
 * The stations a row calls at, beyond Marylebone. Known stops when the row has them; otherwise only
 * what can be inferred (see the header): where it ends, and the earlier stations of its line.
 * @param {TrainRow} row
 * @returns {string[]}
 */
export function callsOf(row) {
    if (stopsKnown(row)) return parseStops(row).map(s => s.crs);
    const line = lineOf(row[1]);
    if (!line) return [row[1]];
    return [line.station, ...line.onward.map(o => o.station)].slice(0, lineDepth(row[1]) + 1);
}

/**
 * The line a station belongs to, as its own station or an onward stop — or undefined.
 * @param {string} crs
 */
export function lineOf(crs) {
    return Object.values(LINES).find(l => l.station === crs || l.onward.some(o => o.station === crs));
}

/**
 * The trains that call at `crs`.
 * @param {TrainRow[]} rows
 * @param {string} crs
 * @returns {TrainRow[]}
 */
export const callingAt = (rows, crs) => rows.filter(r => callsOf(r).includes(crs));

/**
 * The trains whose far end is `crs`. December knows these without any stops, which is why a
 * station most trains run through can still compare them.
 * @param {TrainRow[]} rows
 * @param {string} crs
 * @returns {TrainRow[]}
 */
export const endingAt = (rows, crs) => rows.filter(r => r[1] === crs);

/**
 * Whether a December figure for `crs` can be trusted although December's stops are missing: every
 * one of TODAY's trains calling there either ends there or ends further along the same line.
 * @param {TrainRow[]} nowRows   today's trains, same day and direction
 * @param {string} crs
 * @returns {boolean}
 */
export function knowableWithoutStops(nowRows, crs) {
    const line = lineOf(crs);
    return callingAt(nowRows, crs).every(r =>
        r[1] === crs || (!!line && lineOf(r[1]) === line && lineDepth(r[1]) > lineDepth(crs)));
}

/**
 * Whether December can be answered for `crs` at all: every December train's stops are known, or the
 * station is knowable without them.
 * @param {TrainRow[]} nowRows
 * @param {TrainRow[]} decRows
 * @param {string} crs
 */
export function decemberKnown(nowRows, decRows, crs) {
    return decRows.every(stopsKnown) || knowableWithoutStops(nowRows, crs);
}

/**
 * One station's figures for one timetable.
 * @param {TrainRow[]} rows
 * @param {string} crs
 * @param {'dep'|'arr'} dir
 * @returns {StationSummary}
 */
export function summarise(rows, crs, dir) {
    const at = (/** @type {TrainRow} */ r) => boardingTime(r, crs, dir);
    const here = callingAt(aRealDay(rows), crs).sort((a, b) => serviceMinutes(at(a)) - serviceMinutes(at(b)));
    const hours = PATTERN_HOURS.to - PATTERN_HOURS.from;
    const hourOf = (/** @type {TrainRow} */ r) => Number(at(r).slice(0, 2));
    const inWindow = here.filter((r) => hourOf(r) >= PATTERN_HOURS.from && hourOf(r) < PATTERN_HOURS.to);
    /** @type {Map<number, Set<number>>} */
    const seen = new Map();
    for (const r of inWindow) {
        const m = Number(at(r).slice(3, 5));
        if (!seen.has(m)) seen.set(m, new Set());
        /** @type {Set<number>} */ (seen.get(m)).add(hourOf(r));
    }
    const need = Math.floor(hours / 2) + 1;
    const hourCounts = Array.from({ length: hours }, (_, i) => inWindow.filter(r => hourOf(r) === PATTERN_HOURS.from + i).length);
    /** @type {Map<number, number>} */
    const freq = new Map();
    for (const n of hourCounts) freq.set(n, (freq.get(n) ?? 0) + 1);
    // TYPICAL means most of the hours: a count only half of them share is not what a passenger meets.
    const [mode, times] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0];
    const typical = times > hours / 2 ? mode : null;
    const minutes = [...seen.entries()].filter(([, hs]) => hs.size >= need).map(([m]) => m).sort((a, b) => a - b);
    const journeys = here.flatMap((r) => {
        const stop = parseStops(r).find(s => s.crs === crs);
        if (!stop) return [];
        const a = serviceMinutes(r[0]), b = serviceMinutes(stop.time);
        return [dir === 'dep' ? b - a : a - b];
    }).filter(n => n > 0);
    return {
        total: here.length,
        hourCounts,
        daytime: inWindow.length,
        hourRange: [Math.min(...hourCounts), Math.max(...hourCounts)],
        typical,
        minutes,
        fastest: journeys.length ? Math.min(...journeys) : null,
        first: here.length ? at(here[0]) : null,
        last: here.length ? at(here[here.length - 1]) : null,
    };
}

/**
 * The station, before and after. `dec` is null when December cannot be answered for the whole
 * station yet (see header). `trains` pairs today's trains calling here with December's, by
 * Marylebone time. `ending` is the fallback for a station most trains run THROUGH: the trains whose
 * far end is here need no stops to be compared, and for Oxford, High Wycombe or West Ruislip they are
 * most of the service — v24.74 hid them along with the through trains, and the owner noticed (7 Oct
 * 2026: "the change in times for trains that terminate in Oxford … seem to have disappeared"). Its
 * `through` is how many of today's callers run on, so the card can say what it is NOT comparing.
 * @param {TrainRow[]} nowRows
 * @param {TrainRow[]} decRows
 * @param {string} crs
 * @param {'dep'|'arr'} dir
 * @returns {{ crs: string, now: StationSummary, dec: StationSummary|null, trains: PairedTrain[]|null,
 *   ending: { now: StationSummary, dec: StationSummary, trains: PairedTrain[], through: number }|null,
 *   verdict: { tone: 'same'|'more'|'less'|'moved'|'unknown', text: string } }}
 */
export function stationView(nowRows, decRows, crs, dir) {
    const now = summarise(nowRows, crs, dir);
    const byTime = (/** @type {TrainRow[]} */ rs) => [...rs].sort((a, b) => serviceMinutes(a[0]) - serviceMinutes(b[0]));
    if (decemberKnown(nowRows, decRows, crs)) {
        const dec = summarise(decRows, crs, dir);
        const trains = stationTrains(nowRows, decRows, crs, dir);
        return { crs, now, dec, trains, ending: null, verdict: verdictFor(now, dec, trains, dir) };
    }
    const eNow = endingAt(nowRows, crs), eDec = endingAt(decRows, crs);
    if (!eNow.length && !eDec.length) return { crs, now, dec: null, trains: null, ending: null, verdict: verdictFor(now, null, null, dir) };
    const ending = {
        now: summarise(eNow, crs, dir), dec: summarise(eDec, crs, dir),
        trains: alignTimes(byTime(eNow), byTime(eDec)), through: now.total - eNow.length,
    };
    return { crs, now, dec: null, trains: null, ending, verdict: verdictFor(ending.now, ending.dec, ending.trains, dir) };
}

/**
 * @typedef {PairedTrain & { nowAt?: string, decAt?: string, nowIn?: string, decIn?: string, farShift?: number, atShift?: number, via?: string }} StationTrain
 *   nowAt / decAt — when the passenger gets on (`boardingTime`); coming back, nowIn / decIn are the
 *   times into Marylebone, for the small print. farShift — for a train kept at this station, how far
 *   the OTHER end moved (its arrival there going out, into Marylebone coming back), so a train that
 *   leaves on time but gets in later is not called "No change". atShift — for a train whose end
 *   moved, how far its time HERE moved too. via — the row's Aylesbury route ('A', 'H' or ''), so a
 *   card can tell an Amersham-line train from a via-Wycombe one (the leaf-fall rows, v24.92)
 */

/**
 * Every train that calls at `crs`, today and from the change, as ONE comparison seen from the station.
 *
 * WHICH TRAIN BECOMES WHICH is decided once, for the whole line (`compareRoutes`): each route's trains
 * aligned on their own, Monday-and-Friday versions folded onto their partner, a train that now goes
 * somewhere else linked across routes. The time lookup reads the same answer, so the two can no
 * longer disagree — until v24.83 a station card aligned only its own trains, by time alone, and
 * told a member the Mondays-and-Fridays 17:37 "No longer runs" while the lookup said "4 mins earlier
 * (17:33)" of the same train.
 *
 * Then each pair is read AT this station, because a train can keep running and stop calling here, or
 * start calling here: 'passes' — it still runs, it no longer stops here; 'calls' — it ran, and now
 * stops here. "No longer runs" and "New train" are kept for trains that really go or come.
 *
 * Coming back, each time is the train's departure from `crs` and a retiming is measured there — see
 * the header for why.
 * @param {TrainRow[]} nowRows   one day and direction, every train
 * @param {TrainRow[]} decRows
 * @param {string} crs
 * @param {'dep'|'arr'} dir
 * @returns {StationTrain[]}  in boarding-time order
 */
export function stationTrains(nowRows, decRows, crs, dir) {
    const key = (/** @type {string} */ time, /** @type {string|undefined} */ end, /** @type {string} */ days = '') => `${time} ${end} ${days}`;
    const nowBy = new Map(nowRows.map(r => [key(r[0], r[1], r[3]), r]));
    const decBy = new Map(decRows.map(r => [key(r[0], r[1]), r]));          // a pair carries no December days
    const calls = (/** @type {TrainRow|undefined} */ r) => !!r && callsOf(r).includes(crs);
    // Whether December's train still runs on PAST this station: it calls somewhere today's reaches
    // only after it — going out, a later stop; coming back, an earlier one.
    const runsPast = (/** @type {TrainRow} */ n, /** @type {TrainRow} */ d) => {
        const a = callsOf(n), b = callsOf(d), i = a.indexOf(crs);
        return (dir === 'dep' ? a.slice(i + 1) : a.slice(0, i)).some(c => b.includes(c));
    };
    /** @type {StationTrain[]} */
    const out = [];
    for (const t of compareRoutes(nowRows, decRows).flatMap(r => r.trains)) {
        if (t.kind === 'rerouted' && t.side === 'new') continue;               // its 'old' side carries both trains
        const n = t.now ? nowBy.get(key(t.now, t.nowTo, t.days)) : undefined;
        const d = t.dec ? decBy.get(key(t.dec, t.decTo)) : undefined;
        const nHere = calls(n), dHere = calls(d);
        if (!nHere && !dHere) continue;
        /** @type {StationTrain} */
        const s = { ...t, via: (n ?? d)?.[2] ?? '' };
        // Gone from here. A train that still runs on past this station "no longer stops here"; one whose
        // end moved SHORT of it never reaches it, so it keeps its own words — "Will end at Birmingham
        // Moor Street", "Will run to West Ruislip" (v24.89, the 48-hour review: the page's own tip says
        // "no longer stops here" is a train that passes the station).
        if (nHere && !dHere) {
            const short = !!d && !!n && (s.kind === 'terminus' || s.kind === 'rerouted') && !runsPast(n, d);
            Object.assign(s, !d ? { kind: 'gone' } : short ? {} : { kind: 'passes' }, short ? { dec: null, shift: 0 } : { dec: null, decTo: undefined, shift: 0 });
        }
        if (!nHere && dHere) Object.assign(s, n ? { kind: 'calls' } : { kind: 'new' }, { now: null, nowTo: undefined, days: '', shift: 0 });
        if (s.now && n) s.nowAt = boardingTime(n, crs, dir);
        if (s.dec && d) s.decAt = boardingTime(d, crs, dir);
        if (dir === 'arr') {
            if (s.now) s.nowIn = s.now;
            if (s.dec) s.decIn = s.dec;
        }
        // A train whose far end moved can still have moved HERE — Banbury's 08:09 into London becomes
        // the 08:08 from Stourbridge — and here is where the passenger stands.
        if ((s.kind === 'terminus' || s.kind === 'rerouted') && nHere && dHere && s.nowAt && s.decAt) {
            s.atShift = serviceMinutes(s.decAt) - serviceMinutes(s.nowAt);
        }
        const kept = s.kind === 'same' || s.kind === 'earlier' || s.kind === 'later';
        if (kept && n && d && s.nowAt && s.decAt) {
            // A kept train's retiming is measured where the passenger gets on…
            const shift = serviceMinutes(s.decAt) - serviceMinutes(s.nowAt);
            s.shift = shift;
            s.kind = shift === 0 ? 'same' : shift > 0 ? 'later' : 'earlier';
            // …and where it gets them to is the second thing they ask: "Same time, gets there 5 mins later".
            const end = (/** @type {TrainRow} */ r) => dir === 'dep' ? parseStops(r).find(x => x.crs === crs)?.time : r[0];
            const a = end(n), b = end(d);
            if (a && b) s.farShift = serviceMinutes(b) - serviceMinutes(a);
        }
        out.push(s);
    }
    // A Monday-and-Friday train and its Tuesday-to-Thursday partner fold onto ONE December train
    // (`foldWeekdayVariants`), so where neither stopped here and December's does, both read "Will stop
    // here": one train listed twice, and counted twice in the tally and the sentence above it (v24.89,
    // the 48-hour review — Gerrards Cross's 17:45 to Oxford). A December train is listed once.
    const listed = new Set(out.filter(s => s.kind !== 'calls' && s.dec).map(s => `${s.dec} ${s.decTo}`));
    const once = out.filter((s) => {
        if (s.kind !== 'calls') return true;
        const k = `${s.dec} ${s.decTo}`;
        if (listed.has(k)) return false;
        listed.add(k);
        return true;
    });
    const at = (/** @type {StationTrain} */ s) => serviceMinutes(/** @type {string} */ (s.nowAt ?? s.decAt ?? s.now ?? s.dec));
    return once.sort((a, b) => at(a) - at(b));
}

/**
 * One sentence a member of staff can repeat. The order is the order of what matters to a passenger:
 * whether there is a service at all, how often, how many, then when. Every claim is one the figures
 * table beside it shows, so the sentence can never say something the numbers do not.
 * Coming back, the minutes are when trains leave the station on the card (`boardingTime`).
 * @param {StationSummary} now
 * @param {StationSummary|null} dec
 * @param {PairedTrain[]|null} trains
 * @param {'dep'|'arr'} [dir]
 * @returns {{ tone: 'same'|'more'|'less'|'moved'|'unknown', text: string }}
 */
export function verdictFor(now, dec, trains, dir = 'dep') {
    if (!dec) return { tone: 'unknown', text: 'December not known yet: Chiltern has not published where its December trains stop. Today’s figures are below.' };
    // No train either side — a station that only some days reach. It used to say "No change." over a
    // table of noughts, which a reader takes for "the trains carry on as they are".
    if (!now.total && !dec.total) {
        return { tone: 'same', text: dir === 'dep'
            ? 'No direct trains from Marylebone on this day, now or from 13 December.'
            : 'No direct trains to Marylebone on this day, now or from 13 December.' };
    }
    if (!now.total && dec.total) {
        return { tone: 'more', text: dec.total === 1
            ? `New from 13 December: one direct train, the ${dec.first}.`
            : `New from 13 December: ${dec.total} direct trains a day.` };
    }
    if (now.total && !dec.total) return { tone: 'less', text: 'No direct trains from 13 December.' };
    if (hourChanged(now, dec)) {
        const more = dec.daytime > now.daytime;
        return { tone: more ? 'more' : 'less',
            text: `${more ? 'More' : 'Fewer'} trains in the daytime: ${rateWords(dec)}, was ${rateWords(now, { short: true })}.` };
    }
    const gained = dec.total - now.total;
    if (gained) {
        const n = Math.abs(gained), trainsWord = n === 1 ? 'train' : 'trains';
        return { tone: gained > 0 ? 'more' : 'less',
            text: `${n} ${gained > 0 ? 'more' : 'fewer'} ${trainsWord} a day: ${dec.total}, was ${now.total}.` };
    }
    if (sameRegularity(now, dec) && now.minutes.join() !== dec.minutes.join()) {
        return { tone: 'moved', text: `Same number of trains. In the daytime they leave at ${minutesWords(dec.minutes)} past the hour, was ${minutesWords(now.minutes)}.` };
    }
    // A train that leaves on time but gets there later is a change too: "No change." sat above
    // "Fastest journey 159 → 164 min" at Cradley Heath (v24.83).
    const moved = (trains ?? []).filter(t => t.kind !== 'same' || (/** @type {StationTrain} */ (t).farShift ?? 0) !== 0).length;
    if (moved) return { tone: 'moved', text: `Same number of trains a day, but ${moved} ${moved === 1 ? 'is' : 'are'} different — see Train by train below.` };
    return { tone: 'same', text: 'No change.' };
}

/**
 * Whether the daytime service changed in a way a passenger meets: a different typical hour, or —
 * where either side has none — a different description AND a different number of daytime trains
 * (the same trains spread differently is left to the daily count and the times). Tone follows the
 * daytime total, so the colour can never say "more" of a sentence about fewer.
 * @param {StationSummary} now
 * @param {StationSummary} dec
 */
export function hourChanged(now, dec) {
    if (now.daytime === dec.daytime) return false;
    if (now.typical !== null && dec.typical !== null) {
        return now.typical !== dec.typical && Math.sign(dec.typical - now.typical) === Math.sign(dec.daytime - now.daytime);
    }
    return rateWords(now) !== rateWords(dec);
}

/**
 * The daytime service as a passenger would be told it: "2 an hour", "usually 2 an hour" (some hours
 * differ — the table says how), "1 to 3 an hour" (no count is shared by most hours), "about 1 every 2
 * hours". `short` drops the "an hour" a second figure in the same sentence does not need.
 * @param {StationSummary} s
 * @param {{ short?: boolean }} [opts]
 * @returns {string}
 */
export function rateWords(s, { short = false } = {}) {
    const [lo, hi] = s.hourRange;
    const unit = short ? '' : ' an hour';
    if (s.typical === null) return lo === 0 && hi === 1 ? 'about 1 every 2 hours' : `${lo} to ${hi}${unit}`;
    if (s.typical === 0) return lo === hi ? `none${short ? '' : ' in the daytime'}` : 'hardly any';
    return `${lo === hi ? '' : 'usually '}${s.typical}${unit}`;
}

/**
 * The stops a kept train gains and loses on the way — "it does not stop at Kings Sutton". The time
 * lookup said only where a train ENDS, so the 10:36 read "Will run to Birmingham Snow Hill" and said
 * nothing of Kings Sutton, which it stops calling at (v24.83). Stations past either train's end are
 * not listed: a train that runs further, or ends sooner, says so in its own words.
 * @param {TrainRow} nowRow
 * @param {TrainRow} decRow
 * @returns {{ lost: string[], gained: string[] }}  station codes, in the order the train reaches them
 */
export function stopChanges(nowRow, decRow) {
    if (!stopsKnown(nowRow) || !stopsKnown(decRow)) return { lost: [], gained: [] };
    const a = callsOf(nowRow), b = callsOf(decRow);
    const rank = new Map(STATION_ORDER.map((c, i) => [c, i]));
    // A train's calls before the OTHER train's end: up to it where this train stops there; where it
    // only passes it, up to the first call the books place beyond it; where it never gets that far,
    // up to its own end. The middle case was missing (v24.89, the 48-hour review): the 06:57 to
    // Gerrards Cross now ends at West Ruislip, which today's train passes, and "does not stop at
    // Denham Golf Club" named a station past its new end.
    const before = (/** @type {string[]} */ calls, /** @type {string} */ end, /** @type {string} */ own) => {
        let i = calls.indexOf(end);
        const r = rank.get(end);
        if (i === -1 && r !== undefined) i = calls.findIndex(c => (rank.get(c) ?? -1) > r);
        if (i === -1) i = calls.indexOf(own);
        return calls.slice(0, Math.max(0, i));
    };
    return {
        lost: before(a, decRow[1], nowRow[1]).filter(c => !b.includes(c)),
        gained: before(b, nowRow[1], decRow[1]).filter(c => !a.includes(c)),
    };
}

/**
 * Whether two stations' off-peak times can be compared minute for minute: the same number of times
 * repeat in most hours on both sides, so a difference is a train that MOVED. A train whose minute
 * only wobbles stops "repeating" without going anywhere — Beaconsfield's December :13 arrival is :10
 * in two hours of six — and comparing lists of different lengths said "from :13 and :39 to :39" of a
 * station that keeps all three trains an hour (v24.80, seen once December's stops were known).
 * @param {StationSummary} now
 * @param {StationSummary} dec
 */
const sameRegularity = (now, dec) => now.minutes.length > 0 && now.minutes.length === dec.minutes.length;

/**
 * Trains an hour as the card's figures cell states it: the typical hour, with the exception as small
 * print (`hourNote`) — "2", "2 (1 in some hours)", "1 (none in one hour)" — or, where no count is
 * shared by most hours, the range itself: "1 to 3", "1 every 2 hours". A rounded average said "2" of a
 * station with two one-train hours; a tie broken upwards said "3" of 3, 3, 2, 2, 1, 1 (v24.83).
 * @param {StationSummary} s
 * @returns {string}
 */
export function hourWords(s) {
    const [lo, hi] = s.hourRange;
    if (s.typical === null) return lo === 0 && hi === 1 ? '1 every 2 hours' : `${lo} to ${hi}`;
    const note = hourNote(s);
    return note ? `${s.typical} (${note})` : String(s.typical);
}

/**
 * The exception to the typical hour — "1 in some hours", "none in one hour" — or '' when every hour
 * is the same or there is no typical hour.
 * @param {StationSummary} s
 * @returns {string}
 */
export function hourNote(s) {
    const [lo, hi] = s.hourRange, t = s.typical;
    if (lo === hi || t === null) return '';
    const odd = s.hourCounts.filter(n => n !== t).length;
    const other = lo < t && hi > t ? `${lo} to ${hi}` : String(lo < t ? lo : hi);
    return `${other === '0' ? 'none' : other} in ${odd === 1 ? 'one hour' : 'some hours'}`;
}

/**
 * Minutes past the hour as a reader says them: ":27", ":27 and :57", ":06, :10 and :40".
 * @param {number[]} ms
 * @returns {string}
 */
export function minutesWords(ms) {
    return andList(ms.map(m => `:${String(m).padStart(2, '0')}`));
}

/** A list as a reader says it: "A", "A and B", "A, B and C". */
const andList = (/** @type {string[]} */ ws) => ws.length < 2 ? (ws[0] ?? '') : `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`;

/**
 * The stations staff are most likely to be asked about: the most trains calling today, busiest first.
 * @param {TrainRow[]} rows
 * @param {number} [n]
 * @returns {string[]}
 */
export function busiestStations(rows, n = 8) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const r of aRealDay(rows)) for (const crs of callsOf(r)) counts.set(crs, (counts.get(crs) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([crs]) => crs);
}

/** Short forms people type for a word in a station's name, each standing for the printed word. */
const SHORT_FORMS = /** @type {Readonly<Record<string, readonly string[]>>} */ ({
    birmingham: ['bham', 'brum'], cross: ['x'], parkway: ['pkwy', 'pway'], junction: ['jn', 'jct'],
    great: ['gt'], street: ['st'], upon: ['on'],
});

/** A name or a query as the words a person types: lower case, "&" as "and", no apostrophes or hyphens. */
const words = (/** @type {string} */ s) => s.toLowerCase().replace(/&/g, ' and ').replace(/['’.]/g, '').split(/[\s-]+/).filter(Boolean);

/**
 * Stations whose name matches what was typed, the way people type one (v24.79): "wyc", "moor st",
 * "gerrards x", "oxford pkwy", "bham", "chalfont latimer", "w ruislip", the initials "hw", or the
 * three-letter code. Each typed word must begin a word of the name (or a short form of it), in the
 * name's order. Ranked: the code itself, then a name that starts like the query, then a match
 * anywhere in the name, then initials, then any fragment — so "oxf" offers Oxford before Oxford
 * Parkway, and "ruis" offers both Ruislips. Never Marylebone: every journey here starts or ends there.
 * Two names that match equally put the name typed in full first, then the busier station (`prefer`),
 * then the alphabet — Enter opens the first, and "risborough" opened Monks Risborough (v24.89).
 * @param {Readonly<Record<string, string>>} stations
 * @param {string} typed
 * @param {number} [n]
 * @param {readonly string[]} [prefer]  station codes, most likely first — the page passes the busiest
 * @returns {string[]}
 */
export function matchStations(stations, typed, n = 6, prefer = []) {
    const q = typed.trim().toLowerCase();
    const qWords = words(q);
    // Nothing but punctuation is nothing typed: an empty word list "matches" every name (v24.83).
    if (!qWords.length) return [];
    const compact = q.replace(/[^a-z]/g, '');
    /** @type {{ crs: string, name: string, rank: number, whole: boolean }[]} */
    const hits = [];
    for (const [crs, name] of Object.entries(stations)) {
        if (crs === 'MYB') continue;
        const tokens = words(name).map(w => [w, ...(SHORT_FORMS[w] ?? [])]);
        let at = 0, first = -1;
        const inOrder = qWords.every((qw) => {
            const i = tokens.findIndex((forms, k) => k >= at && forms.some(f => f.startsWith(qw)));
            if (i === -1) return false;
            if (first === -1) first = i;
            at = i + 1;
            return true;
        });
        const initials = tokens.reduce((acc, forms) => acc.flatMap(a => forms.map(f => a + f[0])), ['']);
        // The name with its spaces gone, in every short form — so "snowhill", "moorst", "highwycombe"
        // and "bhammoor" find what "snow hill", "moor st" and "high wycombe" already did.
        const runTogether = tokens.reduce((acc, forms) => acc.flatMap(a => forms.map(f => a + f.replace(/[^a-z]/g, ''))), ['']);
        const rank = crs.toLowerCase() === q ? 0
            : inOrder && first === 0 ? 1
            : inOrder ? 2
            : compact.length >= 2 && initials.includes(compact) ? 3
            : compact.length >= 4 && runTogether.some(f => f.includes(compact)) ? 4
            : q.length >= 3 && words(name).join(' ').includes(q) ? 4      // "hw" is in SmetHWick; a fragment needs three letters
            : -1;
        if (rank >= 0) hits.push({ crs, name, rank, whole: words(name).join(' ') === qWords.join(' ') });
    }
    const order = new Map(prefer.map((c, i) => [c, i]));
    const busy = (/** @type {string} */ crs) => order.get(crs) ?? prefer.length;
    return hits.sort((a, b) => a.rank - b.rank || Number(b.whole) - Number(a.whole) || busy(a.crs) - busy(b.crs) || a.name.localeCompare(b.name))
        .slice(0, n).map(h => h.crs);
}

/**
 * The biggest changes, ranked, as sentences a colleague can repeat to a customer — "the five you'll
 * be asked about". CONSEQUENCE FIRST: "5 more trains a day to Aylesbury (46, was 41)", never
 * "Aylesbury: 46 trains a day (was 41)", which left the reader to do the arithmetic (v24.78). One
 * line per station, its biggest change first and the rest as clauses; a station a line runs ON to
 * is folded into its line's sentence, and so is a station whose change is made of a destination's
 * own trains; a station most trains run through is compared by the trains that end there, and the
 * line says so. Only stations whose December can be answered are considered.
 * @typedef {{ kind: string, named: string, tail: string, tone: 'more'|'less'|'moved', score: number, brief?: string, note?: string }} HeadlinePart
 *   named — the clause when it opens the sentence (it carries the station's name); tail — as a
 *   later clause, when the name has already been said; brief / note — the opening clause for the
 *   screen (v24.92): the sentence without its figures, and the figures alone ("47, was 41")
 * @typedef {{ crs: string, tone: 'more'|'less'|'moved', score: number, parts: HeadlinePart[], text: string, lead: string, tails: string[], route: 'new'|'gone'|null, delta: number, sig: Set<string> }} Headline
 *   sig — the trains the station's change is made of: '+' and the December train for each new one,
 *   '-' and today's for each that goes, so two stations' changes can be compared train for train;
 *   lead / tails — a headline with no parts (a new or withdrawn direct service) keeps its sentence
 *   here, and the clauses a fold adds to it; route says which of the two it is; delta — the
 *   station's change in trains a day, for the chip
 *
 * ON SCREEN A HEADLINE IS A LEAD AND ITS DETAIL (v24.92). `text` is still the whole sentence — what a
 * test pins and a screen reader hears — but a row that was six lines of bold on a phone now opens
 * with its one bold clause, `lead` ("6 more trains a day to Aylesbury"), and carries the figures and
 * every further clause beneath it as `detail` ("47, was 41 · they also stop at …"). `chip` is the
 * words for the coloured chip: the change in trains a day where there is one ("+6 a day"), which
 * scans down a list the way seven green "More trains" did not, else the kind of change.
 * @param {TrainRow[]} nowRows   leaving Marylebone, one day
 * @param {TrainRow[]} decRows
 * @param {Readonly<Record<string, string>>} stations
 * @returns {{ crs: string, tone: 'more'|'less'|'moved', text: string, lead: string, detail: string, chip: string, score: number }[]}
 */
export function headlineChanges(nowRows, decRows, stations) {
    // One real day (see the header): a train that runs Mondays and Fridays, and its Tuesday-to-
    // Thursday partner, are one train — counted twice, they put Haddenham's weekday at 44 trains.
    nowRows = aRealDay(nowRows);
    decRows = aRealDay(decRows);
    const places = new Set([...nowRows, ...decRows].flatMap(callsOf));
    const byTime = (/** @type {TrainRow[]} */ rs) => [...rs].sort((a, b) => serviceMinutes(a[0]) - serviceMinutes(b[0]));
    /** @type {Headline[]} */
    const out = [];
    for (const crs of places) {
        const known = decemberKnown(nowRows, decRows, crs);
        const eNow = known ? nowRows : endingAt(nowRows, crs), eDec = known ? decRows : endingAt(decRows, crs);
        if (!known && !eNow.length && !eDec.length) continue;
        const now = summarise(eNow, crs, 'dep'), dec = summarise(eDec, crs, 'dep');
        const name = stations[crs] ?? crs;
        // A train is its time, its end and its days: one minute can be two trains — today's weekday
        // 17:37 runs to Snow Hill on Mondays and Fridays and to Princes Risborough on the other days.
        const sig = new Set(alignTimes(byTime(callingAt(eNow, crs)), byTime(callingAt(eDec, crs))).flatMap(t =>
            t.kind === 'new' ? [`+${t.dec} ${t.decTo}`] : t.kind === 'gone' ? [`-${t.now} ${t.nowTo} ${t.days}`] : []));
        if (known && !now.total && dec.total) {
            out.push({ crs, tone: 'more', score: 100 + dec.total, parts: [], sig, text: '', tails: [], route: 'new', delta: dec.total, lead: dec.total === 1
                ? `A new direct train to ${name}, the ${dec.first}` : `New direct trains to ${name}: ${dec.total} a day` });
            continue;
        }
        if (known && now.total && !dec.total) {
            out.push({ crs, tone: 'less', score: 100 + now.total, parts: [], sig, text: '', tails: [], route: 'gone', delta: -now.total, lead: `No more direct trains to ${name}` });
            continue;
        }
        /** @type {HeadlinePart[]} */
        const parts = [];
        if (hourChanged(now, dec)) {
            const more = dec.daytime > now.daytime;
            const tail = `${rateWords(dec)} in the daytime (was ${rateWords(now, { short: true })})`;
            const step = now.typical !== null && dec.typical !== null ? Math.abs(dec.typical - now.typical) : 1;
            parts.push({ kind: 'hour', named: `${more ? 'More' : 'Fewer'} trains to ${name}: ${tail}`, tail, tone: more ? 'more' : 'less', score: 80 + step,
                brief: `${more ? 'More' : 'Fewer'} trains to ${name}: ${rateWords(dec)} in the daytime`, note: `was ${rateWords(now, { short: true })}` });
        } else if (sameRegularity(now, dec) && now.minutes.join() !== dec.minutes.join()) {
            const tail = `leave at ${minutesWords(dec.minutes)} past the hour (was ${minutesWords(now.minutes)})`;
            parts.push({ kind: 'minutes', named: `Trains to ${name} ${tail}`, tail, tone: 'moved', score: 60,
                brief: `Trains to ${name} leave at ${minutesWords(dec.minutes)} past the hour`, note: `was ${minutesWords(now.minutes)}` });
        }
        const gained = dec.total - now.total;
        if (Math.abs(gained) >= 2) {
            const more = gained > 0, n = Math.abs(gained);
            parts.push({ kind: 'daily', named: `${n} ${more ? 'more' : 'fewer'} trains a day to ${name} (${dec.total}, was ${now.total})`,
                tail: `${n} ${more ? 'more' : 'fewer'} a day (${dec.total}, was ${now.total})`, tone: more ? 'more' : 'less', score: 40 + n,
                brief: `${n} ${more ? 'more' : 'fewer'} trains a day to ${name}`, note: `${dec.total}, was ${now.total}` });
        }
        if (now.last && dec.last && Math.abs(serviceMinutes(dec.last) - serviceMinutes(now.last)) >= 10) {
            // Never "now": read before the change, "Last train to Hatton now 21:02" named a train that
            // does not stop there yet (v24.83). Later/earlier says which way, true on either side of it.
            const later = serviceMinutes(dec.last) > serviceMinutes(now.last) ? 'Later' : 'Earlier';
            parts.push({ kind: 'last', named: `${later} last train to ${name}: ${dec.last} (was ${now.last})`, tail: `${later.toLowerCase()} last train, ${dec.last} (was ${now.last})`, tone: 'moved', score: 30,
                brief: `${later} last train to ${name}: ${dec.last}`, note: `was ${now.last}` });
        }
        if (!parts.length) continue;
        parts.sort((a, b) => b.score - a.score);
        if (!known) parts.push({ kind: 'ending', named: '', tail: 'counting only the trains that end there', tone: 'moved', score: 0 });
        out.push({ crs, tone: parts[0].tone, score: parts[0].score, parts, sig, text: '', lead: '', tails: [], route: null, delta: gained });
    }
    // A station a line runs ON to (Snow Hill, Stourbridge, the Parkway) is part of its line's story,
    // not a second one: "3 more trains a day to Snow Hill" are three of Moor Street's own new trains,
    // counted again. Folded into the line's sentence, straight after the daily count it qualifies.
    for (const h of [...out]) {
        const line = lineOf(h.crs);
        if (!line || line.station === h.crs) continue;
        const parent = out.find(p => p.crs === line.station);
        if (!parent) continue;
        // The clause below carries a daily count and nothing else, so anything more the onward station
        // says must already be its line's own words — the same last train is one fact. Otherwise it
        // keeps its own line: a Snow Hill last train the line's sentence does not mention went with it
        // (v24.83).
        if (!h.parts.every(p => p.kind === 'daily' || parent.parts.some(q => q.kind === p.kind && q.tail === p.tail))) continue;
        const before = summarise(nowRows, h.crs, 'dep'), after = summarise(decRows, h.crs, 'dep');
        const short = line.onward.find(o => o.station === h.crs)?.short ?? stations[h.crs] ?? h.crs;
        const diff = after.total - before.total;
        if (diff) {
            const n = Math.abs(diff);
            const tail = `${n} ${diff > 0 ? 'more' : 'fewer'} ${n === 1 ? 'goes' : 'go'} on to ${short} (${after.total}, was ${before.total})`;
            if (parent.parts.length) {
                const at = parent.parts.findIndex(p => p.kind === 'daily');
                parent.parts.splice(at === -1 ? parent.parts.length : at + 1, 0, { kind: 'onward', named: '', tail, tone: 'moved', score: 0 });
            } else parent.tails.push(tail);
        }
        out.splice(out.indexOf(h), 1);
    }
    foldSameTrains(out, nowRows, decRows, stations);
    for (const h of out) {
        if (h.parts.length) {
            h.text = h.parts[0].named + h.parts.slice(1).map(p => `; ${p.tail}`).join('');
            h.lead = h.parts[0].brief ?? h.parts[0].named;
            h.tails = [...(h.parts[0].note ? [h.parts[0].note] : []), ...h.parts.slice(1).map(p => p.tail)];
        } else h.text = h.lead + h.tails.map(t => `; ${t}`).join('');
    }
    return out.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
        .map(({ crs, tone, text, lead, tails, route, delta, score }) => ({ crs, tone, text, lead, detail: tails.join(' · '), chip: headlineChip(tone, route, delta), score }));
}

/**
 * The words on a headline's chip (v24.92). A new or withdrawn direct service is named as such — its
 * count is the whole service; a line about times moving says so; otherwise the change in trains a
 * day, signed, and the kind of change only when the count did not move.
 * @param {'more'|'less'|'moved'} tone
 * @param {'new'|'gone'|null} route
 * @param {number} delta
 * @returns {string}
 */
function headlineChip(tone, route, delta) {
    if (route === 'new') return 'New route';
    if (route === 'gone') return 'No direct trains';
    if (tone === 'moved') return 'Times move';
    if (delta) return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} a day`;
    return tone === 'less' ? 'Fewer trains' : 'More trains';
}

/**
 * The grid's rows in two bands, as Chiltern's two books divide them (v24.92): the main line, and
 * the Aylesbury line via Amersham — the stations only its trains call at, which `STATION_ORDER`
 * prints last. Found from the rows, never typed: a station is Amersham's when every train calling
 * there is an Amersham-line train — Aylesbury via Amersham (route 'A'), or one that runs on past
 * Aylesbury along that line (`LINES`: the Parkway trains carry no route code of their own) — and
 * its band is the order from the first such station on (Aylesbury itself, reached both ways, sits
 * in that band as the books place it). One band when the rows hold no such station — hand-made
 * tables, or a day with no Amersham trains — and the grid then draws no band rows at all.
 * @param {TrainRow[]} rows   every row the page holds, both timetables, both directions
 * @param {readonly string[]} [order]
 * @returns {{ label: string, stations: string[] }[]}
 */
export function stationBands(rows, order = STATION_ORDER) {
    const amersham = (/** @type {TrainRow} */ r) => r[2] === 'A' || (r[1] !== 'AYS' && lineOf(r[1])?.via === 'A');
    /** @type {Map<string, boolean>} */
    const onlyA = new Map();
    for (const r of rows) for (const c of callsOf(r)) onlyA.set(c, (onlyA.get(c) ?? true) && amersham(r));
    const at = order.findIndex(c => onlyA.get(c) === true);
    if (at === -1) return [{ label: 'Main line', stations: [...order] }];
    return [{ label: 'Main line', stations: order.slice(0, at) }, { label: 'Aylesbury via Amersham', stations: order.slice(at) }];
}

/**
 * ONE STORY, ONE LINE (v24.80). Once every December stop was known, a new train was counted again at
 * every station it calls at: weekdays opened with the same six Amersham-line trains told five times —
 * "6 more trains a day to Amersham", "… to Aylesbury", "… to Great Missenden" — and four "5 more"
 * lines under them. So a station whose change is made ENTIRELY of a destination's trains joins that
 * destination's sentence by name, and its own line goes:
 *   - the destination is a station trains END at, further along the books' order: the place a
 *     passenger is told the train is going, never a station it passes on the way;
 *   - "they also stop at" only when the two changes are the same trains. A station with only some of
 *     them reads "5 of them also stop at", so its own count is still in the sentence — and only when
 *     both changes run one way, or "them" would count a train that goes;
 *   - nothing the station's own line said is lost: it folds only when every clause of it is a daily
 *     count, or a clause the destination's sentence states word for word — every time here is at
 *     Marylebone, so the same words are the same fact. Haddenham keeps its Saturday line — 3 an
 *     hour, was 2 — though its new trains are Birmingham's.
 * A new or withdrawn direct service never folds: it is the news.
 * @param {Headline[]} out   changed in place: folded stations removed, named in their destination's line
 * @param {TrainRow[]} nowRows
 * @param {TrainRow[]} decRows
 * @param {Readonly<Record<string, string>>} stations
 */
function foldSameTrains(out, nowRows, decRows, stations) {
    const ends = new Set([...nowRows, ...decRows].map(r => r[1]));
    const rank = new Map(STATION_ORDER.map((c, i) => [c, i]));
    const along = (/** @type {string} */ crs) => rank.get(crs) ?? -1;
    const oneWay = (/** @type {Headline} */ h) => [...h.sig].every(x => x[0] === (h.tone === 'more' ? '+' : '-'));
    const foldsInto = (/** @type {Headline} */ h, /** @type {Headline} */ y) => y !== h && y.tone === h.tone
        && ends.has(y.crs) && along(y.crs) > along(h.crs)
        && [...h.sig].every(x => y.sig.has(x)) && (h.sig.size === y.sig.size || (oneWay(h) && oneWay(y)))
        && h.parts.every(p => p.kind === 'daily' || y.parts.some(q => q.kind === p.kind && q.tail === p.tail));
    /** @type {Map<Headline, Headline>} */
    const host = new Map();
    for (const h of out) {
        if (h.tone === 'moved' || !h.parts.length || !h.sig.size) continue;
        // The tightest fit: the fewest trains, then the furthest along — the end of the line they run to.
        const best = out.filter(y => foldsInto(h, y)).sort((a, b) => a.sig.size - b.sig.size || along(b.crs) - along(a.crs))[0];
        if (best) host.set(h, best);
    }
    // "Further along" makes every chain end; the bound keeps a later edit from turning a wrong answer into a hang.
    const top = (/** @type {Headline} */ h) => {
        let y = h;
        for (let i = 0; i < out.length && host.has(y); i++) y = /** @type {Headline} */ (host.get(y));
        return y;
    };
    /** @type {Map<Headline, Headline[]>} */
    const joined = new Map();
    for (const h of host.keys()) joined.set(top(h), [...(joined.get(top(h)) ?? []), h]);
    for (const [y, hs] of joined) {
        /** @type {Map<number, string[]>} how many of the destination's trains each station shares — all of them first */
        const shares = new Map();
        for (const h of hs.sort((a, b) => along(a.crs) - along(b.crs))) {
            const k = h.sig.size === y.sig.size ? Infinity : h.sig.size;
            shares.set(k, [...(shares.get(k) ?? []), stations[h.crs] ?? h.crs]);
        }
        const clauses = [...shares.entries()].sort((a, b) => b[0] - a[0]).map(([k, names]) => {
            const all = k === Infinity;
            const who = all ? (y.sig.size === 1 ? 'it' : 'they') : `${k === 1 ? 'one' : k} of them`;
            const plural = all ? y.sig.size > 1 : k > 1;
            return `${who} also ${y.tone === 'less' ? 'stopped' : plural ? 'stop' : 'stops'} at ${andList(names)}`;
        });
        if (y.parts.length) {
            // Straight after the count it qualifies, before a line's onward clause: "they" is that count's trains.
            const daily = y.parts.findIndex(p => p.kind === 'daily');
            y.parts.splice(daily === -1 ? 1 : daily + 1, 0, ...clauses.map(tail => /** @type {HeadlinePart} */ ({ kind: 'also', named: '', tail, tone: 'moved', score: 0 })));
        } else y.tails.push(...clauses);
    }
    for (const h of host.keys()) out.splice(out.indexOf(h), 1);
}

/**
 * @typedef {{ minute: number, end: string, via: string, known: boolean, calls: string[], some: string[], hours: number, of: number }} GridColumn
 *   calls — every station a train in this column stops at; some — those only SOME of its hours stop
 *   at; hours — how many of the `of` daytime hours it runs in at all
 */

/**
 * The basic hour as a stopping-pattern grid: one column per train that leaves at the same minute in
 * most daytime hours, one row per station, a dot where it stops.
 *
 * A COLUMN IS EVERY HOUR'S TRAIN, NOT ONE OF THEM. Until v24.83 each column was the train from the
 * middle of the window, and its stops were called the hour's: the weekday :10 calls at West Ruislip
 * in some hours and Denham Golf Club in the others, and the grid — "the one thing worth learning by
 * heart" — showed Denham Golf Club every hour and West Ruislip never. Now a station every one of the
 * column's trains stops at is a dot; one only some stop at is in `some`, drawn as a half dot; the
 * column is named by the end most of its trains run to (a tie goes to the further along); and a
 * minute that runs in fewer than all the hours says how many. `known` is false when any of its
 * trains' stops are unpublished — then its dots are the inferred ones (`callsOf`). `via` is the
 * Aylesbury route ('H' or 'A'), so two Aylesbury columns can be told apart in the heading.
 * @param {TrainRow[]} rows   leaving Marylebone, one day
 * @returns {{ columns: GridColumn[], stations: string[] }}
 */
export function stoppingGrid(rows) {
    const hours = PATTERN_HOURS.to - PATTERN_HOURS.from;
    const need = Math.floor(hours / 2) + 1;
    const rank = new Map(STATION_ORDER.map((c, i) => [c, i]));
    /** The value most of `xs` share; a tie goes to the furthest along the line. @param {string[]} xs */
    const mostly = (xs) => {
        /** @type {Map<string, number>} */
        const n = new Map();
        for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
        return [...n.entries()].sort((a, b) => b[1] - a[1] || (rank.get(b[0]) ?? -1) - (rank.get(a[0]) ?? -1) || a[0].localeCompare(b[0]))[0][0];
    };
    /** @type {Map<number, TrainRow[]>} */
    const byMinute = new Map();
    for (const r of rows) {
        const h = Number(r[0].slice(0, 2));
        if (h < PATTERN_HOURS.from || h >= PATTERN_HOURS.to || r[3]) continue;
        const m = Number(r[0].slice(3, 5));
        if (!byMinute.has(m)) byMinute.set(m, []);
        /** @type {TrainRow[]} */ (byMinute.get(m)).push(r);
    }
    const columns = [...byMinute.entries()]
        .filter(([, rs]) => new Set(rs.map(r => r[0].slice(0, 2))).size >= need)
        .sort((a, b) => a[0] - b[0])
        .map(([minute, rs]) => {
            /** @type {Map<string, number>} */
            const stopsAt = new Map();
            for (const r of rs) for (const c of callsOf(r)) stopsAt.set(c, (stopsAt.get(c) ?? 0) + 1);
            const calls = [...stopsAt.keys()];
            return {
                minute, end: mostly(rs.map(r => r[1])), via: mostly(rs.map(r => r[2])), known: rs.every(stopsKnown),
                calls, some: calls.filter(c => /** @type {number} */ (stopsAt.get(c)) < rs.length),
                hours: new Set(rs.map(r => r[0].slice(0, 2))).size, of: hours,
            };
        });
    return { columns, stations: orderStations(columns.map(c => c.calls)) };
}

/**
 * One station order out of several stopping lists. A station the books know goes where Chiltern
 * prints it (`STATION_ORDER` — the main line, then the Amersham line, Aylesbury with the latter), so
 * every column reads downwards in travel order whichever lists are on screen. Merging the lists
 * alone could not do that: a via-Wycombe Aylesbury train put Aylesbury at the foot of the main
 * line, and the Amersham line's dots then jumped back up the page to reach it (v24.75, Saturdays).
 * A station the books do not know is placed straight after the one it follows in its own list.
 * @param {string[][]} lists
 * @param {readonly string[]} [canonical]
 * @returns {string[]}
 */
export function orderStations(lists, canonical = STATION_ORDER) {
    const rank = new Map(canonical.map((c, i) => [c, i]));
    /** @type {string[]} */
    const order = [];
    for (const list of [...lists].sort((a, b) => b.length - a.length)) {
        list.forEach((crs, i) => {
            if (order.includes(crs)) return;
            const r = rank.get(crs);
            if (r !== undefined) {
                const at = order.findIndex(c => (rank.get(c) ?? -1) > r);
                order.splice(at === -1 ? order.length : at, 0, crs);
                return;
            }
            const before = list.slice(0, i).reverse().find(c => order.includes(c));
            order.splice(before ? order.indexOf(before) + 1 : 0, 0, crs);
        });
    }
    return order;
}

/**
 * Pair the December grid's columns with today's, so a dot can say what changed: the same end, the
 * nearest minute within MAX_SHIFT_MIN. Returns, per December column index, today's column or null.
 * @param {{ minute: number, end: string }[]} now
 * @param {{ minute: number, end: string }[]} dec
 * @returns {({ minute: number, end: string, calls: string[] }|null)[]}
 */
export function pairColumns(now, dec) {
    const used = new Set();
    return dec.map((d) => {
        const best = now
            .map((n, i) => ({ n, i, gap: Math.min(Math.abs(n.minute - d.minute), 60 - Math.abs(n.minute - d.minute)) }))
            .filter(x => !used.has(x.i) && x.n.end === d.end && x.gap <= MAX_SHIFT_MIN)
            .sort((a, b) => a.gap - b.gap)[0];
        if (!best) return null;
        used.add(best.i);
        return /** @type {any} */ (best.n);
    });
}
