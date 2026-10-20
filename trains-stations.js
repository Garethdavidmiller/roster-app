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
 * Today's trains carry every stop (`row[4]`), read from Chiltern's printed timetables. December's
 * do not: the simplifier holds only the time at Marylebone and the far end, and the stops arrive
 * with Chiltern's published December books. Until then a December figure is reported for a station
 * only when it can be known WITHOUT the stops:
 *   - a train calls where it ends, and
 *   - on a line that runs on (`LINES` in trains-change.js) it also calls at the line's stations
 *     before its end — owner fact: those trains ARE the line's trains, run on.
 * A station is "knowable" when every one of today's trains calling there ends there or further
 * along its line; anywhere else, December is `null` and the page says it is waiting, rather than
 * counting only the trains that happen to end there and calling that the service. A short count
 * presented as the answer is the failure this rule exists to prevent.
 *
 * Every figure is in MARYLEBONE time — when a train leaves, or gets in — because that is the clock
 * the people using this page stand under. Journey minutes are the one figure measured at the other
 * station, and need that train's stops.
 */

import { serviceMinutes, alignTimes, LINES, lineDepth, PATTERN_HOURS, MAX_SHIFT_MIN } from './trains-change.js';
import { STATION_ORDER } from './trains-data.js';

/** @typedef {import('./trains-change.js').TrainRow} TrainRow */
/** @typedef {import('./trains-change.js').PairedTrain} PairedTrain */

/**
 * @typedef {object} StationSummary
 * @property {number} total        trains in the day
 * @property {number} perHour      off-peak trains an hour (PATTERN_HOURS), rounded to the nearest whole
 * @property {[number, number]} hourRange  the fewest and the most trains in any one off-peak hour — shown
 *                                 to a reader, because an average of 2 hid two hours with only 1 train
 * @property {number} typical      the trains in a TYPICAL off-peak hour — the most common count (a tie goes to
 *                                 the higher). What the card says first; the range is its small print
 * @property {number[]} minutes    minutes past the hour, at Marylebone, that repeat in most off-peak hours
 * @property {number|null} fastest quickest journey in minutes, or null when no train's stop times are known
 * @property {string|null} first   first train of the railway day, Marylebone time
 * @property {string|null} last    last train of the railway day, Marylebone time
 */

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
    const here = callingAt(rows, crs).sort((a, b) => serviceMinutes(a[0]) - serviceMinutes(b[0]));
    const hours = PATTERN_HOURS.to - PATTERN_HOURS.from;
    const inWindow = here.filter((r) => {
        const h = Number(r[0].slice(0, 2));
        return h >= PATTERN_HOURS.from && h < PATTERN_HOURS.to;
    });
    /** @type {Map<number, Set<number>>} */
    const seen = new Map();
    for (const r of inWindow) {
        const h = Number(r[0].slice(0, 2)), m = Number(r[0].slice(3, 5));
        if (!seen.has(m)) seen.set(m, new Set());
        /** @type {Set<number>} */ (seen.get(m)).add(h);
    }
    const need = Math.floor(hours / 2) + 1;
    const perHourCounts = Array.from({ length: hours }, (_, i) =>
        inWindow.filter(r => Number(r[0].slice(0, 2)) === PATTERN_HOURS.from + i).length);
    /** @type {Map<number, number>} */
    const freq = new Map();
    for (const n of perHourCounts) freq.set(n, (freq.get(n) ?? 0) + 1);
    const typical = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
    const minutes = [...seen.entries()].filter(([, hs]) => hs.size >= need).map(([m]) => m).sort((a, b) => a - b);
    const journeys = here.flatMap((r) => {
        const stop = parseStops(r).find(s => s.crs === crs);
        if (!stop) return [];
        const a = serviceMinutes(r[0]), b = serviceMinutes(stop.time);
        return [dir === 'dep' ? b - a : a - b];
    }).filter(n => n > 0);
    return {
        total: here.length,
        perHour: Math.round(inWindow.length / hours),
        hourRange: [Math.min(...perHourCounts), Math.max(...perHourCounts)],
        typical,
        minutes,
        fastest: journeys.length ? Math.min(...journeys) : null,
        first: here[0]?.[0] ?? null,
        last: here[here.length - 1]?.[0] ?? null,
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
        const trains = alignTimes(byTime(callingAt(nowRows, crs)), byTime(callingAt(decRows, crs)));
        return { crs, now, dec, trains, ending: null, verdict: verdictFor(now, dec, trains) };
    }
    const eNow = endingAt(nowRows, crs), eDec = endingAt(decRows, crs);
    if (!eNow.length && !eDec.length) return { crs, now, dec: null, trains: null, ending: null, verdict: verdictFor(now, null, null) };
    const ending = {
        now: summarise(eNow, crs, dir), dec: summarise(eDec, crs, dir),
        trains: alignTimes(byTime(eNow), byTime(eDec)), through: now.total - eNow.length,
    };
    return { crs, now, dec: null, trains: null, ending, verdict: verdictFor(ending.now, ending.dec, ending.trains) };
}

/**
 * One sentence a member of staff can repeat. The order is the order of what matters to a passenger:
 * whether there is a service at all, how often, how many, then when. Every claim is one the figures
 * table beside it shows, so the sentence can never say something the numbers do not.
 * @param {StationSummary} now
 * @param {StationSummary|null} dec
 * @param {PairedTrain[]|null} trains
 * @returns {{ tone: 'same'|'more'|'less'|'moved'|'unknown', text: string }}
 */
export function verdictFor(now, dec, trains) {
    if (!dec) return { tone: 'unknown', text: 'December not known yet: Chiltern has not published where its December trains stop. Today’s figures are below.' };
    if (!now.total && dec.total) {
        return { tone: 'more', text: dec.total === 1
            ? `New from 13 December: one direct train, the ${dec.first}.`
            : `New from 13 December: ${dec.total} direct trains a day.` };
    }
    if (now.total && !dec.total) return { tone: 'less', text: 'No direct trains from 13 December.' };
    if (dec.typical !== now.typical) {
        // "usually" when either side's hours vary — the table beside says exactly how.
        const usually = now.hourRange[0] !== now.hourRange[1] || dec.hourRange[0] !== dec.hourRange[1] ? 'usually ' : '';
        return dec.typical > now.typical
            ? { tone: 'more', text: `More trains off-peak: ${usually}${dec.typical} an hour, was ${now.typical}.` }
            : { tone: 'less', text: `Fewer trains off-peak: ${usually}${dec.typical} an hour, was ${now.typical}.` };
    }
    const gained = dec.total - now.total;
    if (gained) {
        const n = Math.abs(gained), trainsWord = n === 1 ? 'train' : 'trains';
        return { tone: gained > 0 ? 'more' : 'less',
            text: `${n} ${gained > 0 ? 'more' : 'fewer'} ${trainsWord} a day: ${dec.total}, was ${now.total}.` };
    }
    if (now.minutes.length && dec.minutes.length && now.minutes.join() !== dec.minutes.join()) {
        return { tone: 'moved', text: `Same number of trains. Off-peak times change from ${minutesWords(now.minutes)} to ${minutesWords(dec.minutes)} past the hour.` };
    }
    const moved = (trains ?? []).filter(t => t.kind !== 'same').length;
    if (moved) return { tone: 'moved', text: `Same number of trains a day, but ${moved} ${moved === 1 ? 'is' : 'are'} different — see Train by train below.` };
    return { tone: 'same', text: 'No change.' };
}

/**
 * Trains an hour as the card states it: the typical hour first, the exception in brackets — "2",
 * "2 (1 in some hours)", "1 (2 in some hours)". A rounded average said "2" of a station with two
 * one-train hours and "1" of one with two two-train hours; neither is what a passenger meets.
 * @param {StationSummary} s
 * @returns {string}
 */
export function hourWords(s) {
    const note = hourNote(s);
    return note ? `${s.typical} (${note})` : String(s.typical);
}

/**
 * The exception to the typical hour — "1 in some hours" — or '' when every hour is the same. The
 * card prints it as small print under the number; `hourWords` is the same thing in one line.
 * @param {StationSummary} s
 * @returns {string}
 */
export function hourNote(s) {
    const [lo, hi] = s.hourRange, t = s.typical;
    if (lo === hi) return '';
    if (lo < t && hi > t) return `${lo} to ${hi} in some hours`;
    return `${lo < t ? lo : hi} in some hours`;
}

/**
 * Minutes past the hour as a reader says them: ":27", ":27 and :57", ":06, :10 and :40".
 * @param {number[]} ms
 * @returns {string}
 */
export function minutesWords(ms) {
    const w = ms.map(m => `:${String(m).padStart(2, '0')}`);
    return w.length < 2 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
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
    for (const r of rows) for (const crs of callsOf(r)) counts.set(crs, (counts.get(crs) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([crs]) => crs);
}

/** Short forms people type for a word in a station's name, each standing for the printed word. */
const SHORT_FORMS = /** @type {Readonly<Record<string, readonly string[]>>} */ ({
    birmingham: ['bham', 'brum'], cross: ['x'], parkway: ['pkwy', 'pway'], junction: ['jn', 'jct'],
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
 * @param {Readonly<Record<string, string>>} stations
 * @param {string} typed
 * @param {number} [n]
 * @returns {string[]}
 */
export function matchStations(stations, typed, n = 6) {
    const q = typed.trim().toLowerCase();
    if (!q) return [];
    const qWords = words(q);
    const compact = q.replace(/[^a-z]/g, '');
    /** @type {{ crs: string, name: string, rank: number }[]} */
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
        const rank = crs.toLowerCase() === q ? 0
            : inOrder && first === 0 ? 1
            : inOrder ? 2
            : compact.length >= 2 && initials.includes(compact) ? 3
            : q.length >= 3 && words(name).join(' ').includes(q) ? 4      // "hw" is in SmetHWick; a fragment needs three letters
            : -1;
        if (rank >= 0) hits.push({ crs, name, rank });
    }
    return hits.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, n).map(h => h.crs);
}

/**
 * The biggest changes, ranked, as sentences a colleague can repeat to a customer — "the five you'll
 * be asked about". CONSEQUENCE FIRST: "5 more trains a day to Aylesbury (46, was 41)", never
 * "Aylesbury: 46 trains a day (was 41)", which left the reader to do the arithmetic (v24.78). One
 * line per station, its biggest change first and the rest as clauses; a station a line runs ON to
 * is folded into its line's sentence; a station most trains run through is compared by the trains
 * that end there, and the line says so. Only stations whose December can be answered are
 * considered, so the list grows by itself when December's stops arrive.
 * @typedef {{ kind: string, named: string, tail: string, tone: 'more'|'less'|'moved', score: number }} HeadlinePart
 *   named — the clause when it opens the sentence (it carries the station's name); tail — as a
 *   later clause, when the name has already been said
 * @param {TrainRow[]} nowRows   leaving Marylebone, one day
 * @param {TrainRow[]} decRows
 * @param {Readonly<Record<string, string>>} stations
 * @returns {{ crs: string, tone: 'more'|'less'|'moved', text: string, score: number }[]}
 */
export function headlineChanges(nowRows, decRows, stations) {
    const places = new Set([...nowRows, ...decRows].flatMap(callsOf));
    /** @type {{ crs: string, tone: 'more'|'less'|'moved', score: number, parts: HeadlinePart[], text: string }[]} */
    const out = [];
    for (const crs of places) {
        const known = decemberKnown(nowRows, decRows, crs);
        const eNow = known ? nowRows : endingAt(nowRows, crs), eDec = known ? decRows : endingAt(decRows, crs);
        if (!known && !eNow.length && !eDec.length) continue;
        const now = summarise(eNow, crs, 'dep'), dec = summarise(eDec, crs, 'dep');
        const name = stations[crs] ?? crs;
        if (known && !now.total && dec.total) {
            out.push({ crs, tone: 'more', score: 100 + dec.total, parts: [], text: dec.total === 1
                ? `A new direct train to ${name}, the ${dec.first}` : `New direct trains to ${name}: ${dec.total} a day` });
            continue;
        }
        if (known && now.total && !dec.total) { out.push({ crs, tone: 'less', score: 100 + now.total, parts: [], text: `No more direct trains to ${name}` }); continue; }
        /** @type {HeadlinePart[]} */
        const parts = [];
        if (dec.typical !== now.typical) {
            const more = dec.typical > now.typical;
            const usually = now.hourRange[0] !== now.hourRange[1] || dec.hourRange[0] !== dec.hourRange[1] ? 'usually ' : '';
            const tail = `${usually}${dec.typical} an hour off-peak (was ${now.typical})`;
            parts.push({ kind: 'hour', named: `${more ? 'More' : 'Fewer'} trains to ${name}: ${tail}`, tail, tone: more ? 'more' : 'less', score: 80 + Math.abs(dec.typical - now.typical) });
        } else if (now.minutes.length && dec.minutes.length && now.minutes.join() !== dec.minutes.join()) {
            const tail = `leave at ${minutesWords(dec.minutes)} past the hour (was ${minutesWords(now.minutes)})`;
            parts.push({ kind: 'minutes', named: `Trains to ${name} ${tail}`, tail, tone: 'moved', score: 60 });
        }
        const gained = dec.total - now.total;
        if (Math.abs(gained) >= 2) {
            const more = gained > 0, n = Math.abs(gained);
            parts.push({ kind: 'daily', named: `${n} ${more ? 'more' : 'fewer'} trains a day to ${name} (${dec.total}, was ${now.total})`,
                tail: `${n} ${more ? 'more' : 'fewer'} a day (${dec.total}, was ${now.total})`, tone: more ? 'more' : 'less', score: 40 + n });
        }
        if (now.last && dec.last && Math.abs(serviceMinutes(dec.last) - serviceMinutes(now.last)) >= 10) {
            parts.push({ kind: 'last', named: `Last train to ${name} now ${dec.last} (was ${now.last})`, tail: `last train ${dec.last} (was ${now.last})`, tone: 'moved', score: 30 });
        }
        if (!parts.length) continue;
        parts.sort((a, b) => b.score - a.score);
        if (!known) parts.push({ kind: 'ending', named: '', tail: 'counting only the trains that end there', tone: 'moved', score: 0 });
        out.push({ crs, tone: parts[0].tone, score: parts[0].score, parts, text: '' });
    }
    // A station a line runs ON to (Snow Hill, Stourbridge, the Parkway) is part of its line's story,
    // not a second one: "3 more trains a day to Snow Hill" are three of Moor Street's own new trains,
    // counted again. Folded into the line's sentence, straight after the daily count it qualifies.
    for (const h of [...out]) {
        const line = lineOf(h.crs);
        if (!line || line.station === h.crs) continue;
        const parent = out.find(p => p.crs === line.station);
        if (!parent) continue;
        const before = summarise(nowRows, h.crs, 'dep'), after = summarise(decRows, h.crs, 'dep');
        const short = line.onward.find(o => o.station === h.crs)?.short ?? stations[h.crs] ?? h.crs;
        const diff = after.total - before.total;
        if (diff) {
            const tail = `${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} go on to ${short} (${after.total}, was ${before.total})`;
            if (parent.parts.length) {
                const at = parent.parts.findIndex(p => p.kind === 'daily');
                parent.parts.splice(at === -1 ? parent.parts.length : at + 1, 0, { kind: 'onward', named: '', tail, tone: 'moved', score: 0 });
            } else parent.text += `; ${tail}`;
        }
        out.splice(out.indexOf(h), 1);
    }
    for (const h of out) if (h.parts.length) h.text = h.parts[0].named + h.parts.slice(1).map(p => `; ${p.tail}`).join('');
    return out.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text)).map(({ crs, tone, text, score }) => ({ crs, tone, text, score }));
}

/**
 * The basic hour as a stopping-pattern grid: one column per train that repeats every off-peak hour,
 * one row per station, a dot where it stops. Each column is a real train from the middle of the
 * window, so its dots are that train's stops. `known` is false for a column whose stops are not
 * published yet — its only dots are the inferred ones (`callsOf`). `via` is the Aylesbury route ('H'
 * or 'A'), so two Aylesbury columns can be told apart in the heading.
 * @param {TrainRow[]} rows   leaving Marylebone, one day
 * @returns {{ columns: { minute: number, end: string, via: string, known: boolean, calls: string[] }[], stations: string[] }}
 */
export function stoppingGrid(rows) {
    const hours = PATTERN_HOURS.to - PATTERN_HOURS.from;
    const need = Math.floor(hours / 2) + 1;
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
            const mid = rs[Math.floor(rs.length / 2)];                    // a real train, mid-window
            return { minute, end: mid[1], via: mid[2], known: stopsKnown(mid), calls: callsOf(mid) };
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
