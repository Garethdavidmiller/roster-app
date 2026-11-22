// @ts-check
/**
 * trains-stations.js — PURE: the timetable seen from a STATION, not from the end of the line.
 *
 * Staff are asked "how do I get to Gerrards Cross?", not "what is the 10:10's terminus?". So the
 * Trains page is organised by the station a customer is going to (or coming back from), and every
 * figure here is about one station: trains a day, trains an hour in the daytime (`PATTERN_HOURS` —
 * never "off-peak", a fare at a ticket office), the minutes past the hour, the fastest journey, the
 * first and last train. This module computes them; the page renders.
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
 * Every COUNT is of one real day — a weekday's is a Tuesday's — and where the weekdays disagree a
 * card names the days its figures are true of (`dayScope`): trains-weekdays.js says why. What the
 * card's sentence says, and the words its figures are written in: trains-verdict.js.
 */

import { serviceMinutes, alignTimes, compareRoutes, foldWeekdayVariants, routeKey, LINES, lineDepth, PATTERN_HOURS, MAX_SHIFT_MIN } from './trains-change.js';
import { STATION_ORDER } from './trains-data.js';
import { REAL_DAY, WEEKDAYS, aRealDay, runsOn, onWeekday, weekdayGroups, weekdayWords, daysCode } from './trains-weekdays.js';
import { verdictFor } from './trains-verdict.js';

/** @typedef {import('./trains-change.js').TrainRow} TrainRow */
/** @typedef {import('./trains-change.js').PairedTrain} PairedTrain */
/** @typedef {import('./trains-weekdays.js').Weekday} Weekday */
/** @typedef {import('./trains-verdict.js').Verdict} Verdict */

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

/** Each stops field read once (`parseStops`): the headlines read every station on every weekday, and
 *  re-reading the same few hundred strings was most of their time. Keyed by the string, not the row, so
 *  a row edited in place cannot be answered from its old stops; frozen, so no caller can edit a shared answer. */
const STOPS_READ = /** @type {Map<string, ReadonlyArray<Readonly<{ crs: string, time: string }>>>} */ (new Map());

/**
 * A row's stops as `[{ crs, time }]`. Empty when they are not known. Read-only: the answer is shared.
 * @param {TrainRow} row
 * @returns {ReadonlyArray<Readonly<{ crs: string, time: string }>>}
 */
export function parseStops(row) {
    const s = row[4] ?? '';
    if (!s) return [];
    let read = STOPS_READ.get(s);
    if (!read) {
        read = Object.freeze(s.split(' ').map(t => Object.freeze({ crs: t.slice(0, 3), time: `${t.slice(3, 5)}:${t.slice(5, 7)}` })));
        STOPS_READ.set(s, read);
    }
    return read;
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
 * @param {{ change?: string|null, started?: boolean }} [when] the change date (ISO) the verdict names, and
 *   whether it has come. Every date the page shows is derived from the data module (v24.96): the verdicts typed
 *   "13 December" until the 72-hour review, which is how that sentence had become a claim rather than a fact.
 * @returns {{ crs: string, now: StationSummary, dec: StationSummary|null, trains: PairedTrain[]|null,
 *   ending: { now: StationSummary, dec: StationSummary, trains: PairedTrain[], through: number }|null,
 *   others: OtherDays[], verdict: Verdict }}
 *   others — the weekdays whose figures are not the real day's (see the header, "where the days
 *   disagree"), for the card's small print; empty on every other day, and on most weekdays
 */
export function stationView(nowRows, decRows, crs, dir, when = {}) {
    const now = summarise(nowRows, crs, dir);
    const byTime = (/** @type {TrainRow[]} */ rs) => [...rs].sort((a, b) => serviceMinutes(a[0]) - serviceMinutes(b[0]));
    if (decemberKnown(nowRows, decRows, crs)) {
        const dec = summarise(decRows, crs, dir);
        const trains = stationTrains(nowRows, decRows, crs, dir);
        const scope = dayScope(nowRows, decRows, crs, dir);
        return { crs, now, dec, trains, ending: null, others: scope.others,
            verdict: verdictFor(now, dec, trains, dir, { ...when, days: scope.days, others: scope.others }) };
    }
    const eNow = endingAt(nowRows, crs), eDec = endingAt(decRows, crs);
    if (!eNow.length && !eDec.length) return { crs, now, dec: null, trains: null, ending: null, others: [], verdict: verdictFor(now, null, null, dir, when) };
    // As the rest of the card does: one real day's count, and a Monday-and-Friday train folded onto its
    // Tuesday-to-Thursday partner's December time (`foldWeekdayVariants`). Counted row by row, the two
    // versions of one train were two trains that END here, and "through" came out a train short; aligned
    // without the fold, the Monday-and-Friday one "no longer ran" (Trains review, Nov 2026 — unreachable
    // while December's books carry every stop, and kept for books that may not).
    const endNow = summarise(eNow, crs, dir);
    const ending = {
        now: endNow, dec: summarise(eDec, crs, dir),
        trains: foldWeekdayVariants(alignTimes(byTime(eNow), byTime(eDec))), through: now.total - endNow.total,
    };
    return { crs, now, dec: null, trains: null, ending, others: [], verdict: verdictFor(ending.now, ending.dec, ending.trains, dir, when) };
}

/**
 * @typedef {{ days: Weekday[], words: string, short: string, now: StationSummary, dec: StationSummary }} OtherDays
 *   one group of weekdays whose figures differ from the real day's: its days, in words ("Mondays and
 *   Fridays") and as small print ("Mon and Fri"), and its figures before and after the change
 */

/**
 * Which weekdays a station's figures are true of (see the header). Every figure the card shows is
 * compared, day by day: when they agree, `days` is null and nothing on the card changes; when they do
 * not, `days` names the real day's group ("Tuesday to Thursday") and `others` holds the rest.
 * @param {TrainRow[]} nowRows
 * @param {TrainRow[]} decRows
 * @param {string} crs
 * @param {'dep'|'arr'} dir
 * @returns {{ days: string|null, others: OtherDays[] }}
 */
function dayScope(nowRows, decRows, crs, dir) {
    const figures = (/** @type {TrainRow[]} */ rows) => {
        const s = summarise(rows, crs, dir);
        return [s.total, s.daytime, s.typical, s.hourRange, s.minutes, s.fastest, s.first, s.last];
    };
    const groups = weekdayGroups(nowRows, decRows, figures);
    if (groups.length < 2) return { days: null, others: [] };
    const real = groups.find(g => g.days.includes(REAL_DAY)) ?? groups[0];
    return {
        days: weekdayWords(real.days),
        others: groups.filter(g => g !== real).map(g => ({
            days: g.days, words: weekdayWords(g.days), short: weekdayWords(g.days, { short: true }),
            now: summarise(onWeekday(nowRows, g.days[0]), crs, dir), dec: summarise(onWeekday(decRows, g.days[0]), crs, dir),
        })),
    };
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
 * somewhere else linked across routes. The time lookup reads the same answer, so the two disagree
 * only where two of those pairs cross at this station and are swapped here (`uncross`) — until v24.83 a station card aligned only its own trains, by time alone, and
 * told a member the Mondays-and-Fridays 17:37 "No longer runs" while the lookup said "4 mins earlier
 * (17:33)" of the same train.
 *
 * Then each pair is read AT this station, because a train can keep running and stop calling here, or
 * start calling here: 'passes' — it still runs, it no longer stops here; 'calls' — it ran, and now
 * stops here. "Will stop running" ("No longer runs" from the change) and "New train" are kept for
 * trains that really go or come. Where two of the line's pairs cross at this station, their December
 * partners are swapped first (`uncross`, below): read at the station, a pairing never crosses.
 *
 * Coming back, each time is the train's departure from `crs` and a retiming is measured there — see
 * the header for why.
 * @param {TrainRow[]} nowRows   one day and direction, every train
 * @param {TrainRow[]} decRows
 * @param {string} crs
 * @param {'dep'|'arr'} dir
 * @param {import('./trains-change.js').RouteChange[]} [routes]  `compareRoutes(nowRows, decRows)`, when the
 *   caller reads many stations of one day — it is the same for every station, and the slow part
 * @returns {StationTrain[]}  in boarding-time order
 */
export function stationTrains(nowRows, decRows, crs, dir, routes = compareRoutes(nowRows, decRows)) {
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
    /** @type {{ t: PairedTrain, n: TrainRow|undefined, d: TrainRow|undefined }[]} */
    const pairs = [];
    for (const t of routes.flatMap(r => r.trains)) {
        if (t.kind === 'rerouted' && t.side === 'new') continue;               // its 'old' side carries both trains
        const n = t.now ? nowBy.get(key(t.now, t.nowTo, t.days)) : undefined;
        const d = t.dec ? decBy.get(key(t.dec, t.decTo)) : undefined;
        if (calls(n) || calls(d)) pairs.push({ t: { ...t }, n, d });
    }
    uncross(pairs, crs, dir);
    /** @type {StationTrain[]} */
    const out = [];
    for (const { t, n, d } of pairs) {
        const nHere = calls(n), dHere = calls(d);
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
    // EVERY DECEMBER TRAIN ON EVERY WEEKDAY IT RUNS. A pair runs on its current train's days, so a December
    // train paired only with a Tuesday-to-Thursday one was on no row on a Monday or Friday, while the card's
    // own count had it: December's 07:40 from High Wycombe, given by `uncross` to the Tue-to-Thu 07:33, and
    // three trains the line left that way before it (24-hour check, 22 Nov 2026). On the days nothing
    // carries it, it is listed as what it is there — a train today's timetable has nothing in place of.
    for (const d of decRows) {
        if (!calls(d)) continue;
        const k = `${d[0]} ${d[1]}`;
        const missing = WEEKDAYS.filter(w => runsOn(d[3], w) && !once.some(s => s.dec && `${s.dec} ${s.decTo}` === k && runsOn(s.days, w)));
        if (!missing.length) continue;
        once.push({ now: null, dec: d[0], decTo: d[1], kind: 'new', shift: 0, days: daysCode(missing), via: d[2],
            decAt: boardingTime(d, crs, dir), ...(dir === 'arr' ? { decIn: d[0] } : {}) });
    }
    const at = (/** @type {StationTrain} */ s) => serviceMinutes(/** @type {string} */ (s.nowAt ?? s.decAt ?? s.now ?? s.dec));
    return once.sort((a, b) => at(a) - at(b));
}

/**
 * PAIRED AT MARYLEBONE, NEVER CROSSING AT THE STATION. The line's pairing is order-preserving at
 * Marylebone, route by route (`compareRoutes`); read at a station two routes meet, two pairs can cross
 * there. Coming back to High Wycombe on a weekday, today's 07:21 (into Marylebone 08:00) was paired with
 * December's 07:40, and today's 07:33 with December's 07:27, so the card said "19 mins later" of a train
 * whose slot December fills six minutes on, and "6 mins earlier" of the one after it (Trains review, Nov
 * 2026). So where two trains that both call here, on a day both run, cross at the station, their December
 * partners are swapped. A swap never adds to the minutes moved altogether — of two crossed pairs, the
 * uncrossed pairing is never the dearer — and each one takes a crossing away, so it ends. The swapped
 * pair is then said as what it now is: the same route, or a train that now comes from or goes to
 * somewhere else (`rerouted`). Swapped on the days the two share, a December train can be left with no
 * partner on the others — `stationTrains` then lists it there as new, so no weekday loses it. The lookup is timed at Marylebone, where nothing crossed, and keeps its
 * pairing: there, the 08:00 from High Wycombe is still the 08:18.
 * @param {{ t: PairedTrain, n: TrainRow|undefined, d: TrainRow|undefined }[]} pairs  changed in place
 * @param {string} crs
 * @param {'dep'|'arr'} dir
 */
function uncross(pairs, crs, dir) {
    const here = (/** @type {TrainRow|undefined} */ r) => !!r && callsOf(r).includes(crs);
    const both = pairs.filter(p => here(p.n) && here(p.d));
    const at = (/** @type {TrainRow} */ r) => serviceMinutes(boardingTime(r, crs, dir));
    const together = (/** @type {string} */ a, /** @type {string} */ b) => WEEKDAYS.some(w => runsOn(a, w) && runsOn(b, w));
    // Aylesbury's two routes are two journeys (trains-change.js, "the route is part of where a train goes"):
    // a train via Amersham is never swapped onto one via High Wycombe, however the times fall.
    const via = (/** @type {TrainRow} */ r) => LINES[routeKey(r)]?.via ?? r[2];
    const cost = (/** @type {TrainRow} */ n, /** @type {TrainRow} */ d) => Math.abs(at(d) - at(n));
    /** @type {Set<typeof pairs[number]>} */
    const swapped = new Set();
    // Each swap takes away a crossing, so the bound is never met; it keeps a later edit from hanging.
    for (let guard = both.length * both.length; guard > 0; guard--) {
        // The crossing whose swap saves the most minutes first: a train crossed with two others is given the
        // partner that fits it best, and the other pairings are left as the line made them.
        const best = both.flatMap(p => both.flatMap(q => {
            const [pn, pd, qn, qd] = /** @type {TrainRow[]} */ ([p.n, p.d, q.n, q.d]);
            const crossed = together(p.t.days, q.t.days) && at(pn) < at(qn) && at(pd) > at(qd)
                && via(pn) === via(qd) && via(qn) === via(pd);
            return crossed ? [{ p, q, saves: cost(pn, pd) + cost(qn, qd) - cost(pn, qd) - cost(qn, pd) }] : [];
        })).sort((a, b) => b.saves - a.saves)[0];
        if (!best) break;
        const { p, q } = best;
        [p.d, q.d] = [q.d, p.d];
        swapped.add(p).add(q);
    }
    for (const p of swapped) {
        const n = /** @type {TrainRow} */ (p.n), d = /** @type {TrainRow} */ (p.d);
        const { other: _other, side: _side, ...t } = p.t;
        const shift = serviceMinutes(d[0]) - serviceMinutes(n[0]);
        p.t = routeKey(n) === routeKey(d)
            ? { ...t, dec: d[0], decTo: d[1], shift, kind: n[1] !== d[1] ? 'terminus' : shift === 0 ? 'same' : shift > 0 ? 'later' : 'earlier' }
            : { ...t, dec: d[0], decTo: d[1], shift, kind: 'rerouted', side: 'old', other: { station: d[1], via: d[2], time: d[0] } };
    }
}

/**
 * The stops a kept train gains and loses on the way — "it no longer stops at Kings Sutton". The time
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

/**
 * Other names a station goes by, searched as well as the printed one, which stays the name shown.
 * National Rail and the Rangers guide call STY "Stratford-upon-Avon Parkway", and typing that found
 * nothing, because the timetable book prints "Stratford Parkway" (whole-app review, Oct 2026).
 */
const ALSO_KNOWN_AS = /** @type {Readonly<Record<string, readonly string[]>>} */ ({
    STY: ['Stratford-upon-Avon Parkway'],
});

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
    /** How well one spelling of a station's name matches — the ladder below, or -1. */
    const rankOf = (/** @type {string} */ crs, /** @type {string} */ name) => {
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
        return rank;
    };
    for (const [crs, name] of Object.entries(stations)) {
        if (crs === 'MYB') continue;
        // The printed name and any other name the station goes by; the printed one is what is SHOWN.
        let rank = -1, whole = false;
        for (const known of [name, ...(ALSO_KNOWN_AS[crs] ?? [])]) {
            // Half a step behind the same match on a PRINTED name, so "stratford-on-avon" offers the
            // town before the Parkway that is also known by it, rather than the alphabet deciding.
            const found = rankOf(crs, known);
            if (found < 0) continue;
            const r = found + (known === name ? 0 : 0.5);
            if (rank < 0 || r < rank) rank = r;
            if (words(known).join(' ') === qWords.join(' ')) whole = true;
        }
        if (rank >= 0) hits.push({ crs, name, rank, whole });
    }
    const order = new Map(prefer.map((c, i) => [c, i]));
    const busy = (/** @type {string} */ crs) => order.get(crs) ?? prefer.length;
    return hits.sort((a, b) => a.rank - b.rank || Number(b.whole) - Number(a.whole) || busy(a.crs) - busy(b.crs) || a.name.localeCompare(b.name))
        .slice(0, n).map(h => h.crs);
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

/**
 * The last train from Marylebone to every station, before and after — the late turn's question
 * ("what's the last train to Beaconsfield tonight?") for the whole network at once (v24.94). Each
 * figure is the one the station card shows as "Last train", from `summarise`, so the two never
 * disagree: the Marylebone departure of the last train that calls there, on a typical day of that
 * kind (the Monday-and-Friday and Wednesday-only trains left out, as everywhere on the page).
 * @param {TrainRow[]} nowRows  trains leaving Marylebone, today's timetable
 * @param {TrainRow[]} decRows  the same, December's
 * @returns {{ crs: string, now: string|null, dec: string|null, shift: number|null,
 *   kind: 'same'|'later'|'earlier'|'new'|'gone' }[]}
 *   in the books' order · shift: minutes December's is later, negative for earlier, null when a side has no train
 */
export function lastTrains(nowRows, decRows) {
    const called = new Set([...nowRows, ...decRows].flatMap(r => callsOf(r)));
    return orderStations([[...called]]).map((crs) => {
        const now = summarise(nowRows, crs, 'dep').last, dec = summarise(decRows, crs, 'dep').last;
        const shift = now && dec ? serviceMinutes(dec) - serviceMinutes(now) : null;
        /** @type {'same'|'later'|'earlier'|'new'|'gone'} */
        const kind = !now ? 'new' : !dec ? 'gone' : shift === 0 ? 'same' : /** @type {number} */ (shift) > 0 ? 'later' : 'earlier';
        return { crs, now, dec, shift, kind };
    }).filter(r => r.now || r.dec);
}
