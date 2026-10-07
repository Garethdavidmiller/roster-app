// @ts-check
/**
 * trains-change.js — PURE: what changes at Marylebone when the December 2026 timetable starts.
 *
 * Owns every judgement the Trains page makes about two timetables; the page only renders. No DOM,
 * no Firebase, no clock — `today` is always passed in, so every answer here is testable.
 *
 * ── WHAT "THE SAME TRAIN" MEANS, AND WHY IT IS AN ALIGNMENT ─────────────────────────────────────
 *
 * Neither source carries an identity that survives a timetable change, so a train cannot be
 * looked up in December by name. What a member of staff means by "the 17:15 to Aylesbury" is the
 * train in that SLOT — the one leaving for the same place at about the same time. So each route's
 * two lists of times are ALIGNED: paired in order, never crossing, at the lowest total shift, and
 * a time is left unpaired — new, or no longer running — only when pairing it would cost more than
 * `MAX_SHIFT_MIN`. Order-preserving matters: a greedy nearest-time match can pair the 17:10 with
 * the 17:20 and the 17:20 with the 17:08, which reads as two trains swapping places when nothing
 * of the kind happened.
 *
 * The threshold is a judgement, stated once here. Twenty minutes keeps a retimed train recognisable
 * ("6 minutes later") without pairing a half-hourly service with a different train an hour on.
 *
 * ── THE ROUTE IS PART OF WHERE A TRAIN GOES ─────────────────────────────────────────────────────
 *
 * Aylesbury is reached via High Wycombe or via Amersham, and the journeys differ by most of an
 * hour, so the two are different routes here. A train that keeps its time but changes route is
 * therefore reported as one gone and one new, which is what it is to the person on it.
 *
 * ── A LINE THAT RUNS ON IS ONE LINE ─────────────────────────────────────────────────────────────
 *
 * Aylesbury Vale Parkway trains are the Amersham-line Aylesbury trains running one stop further,
 * and Birmingham Snow Hill and Stourbridge Junction trains are Birmingham Moor Street trains run on
 * (owner, 7 Oct 2026). Treated as destinations of their own, a train cut back from the Parkway to
 * Aylesbury read as one train removed and another added, and the basic hour showed a half-hourly
 * line as two unrelated hourly services. So `LINES` folds a line's onward stops into the line: the
 * trains are compared as one list, and a train whose time holds but whose end moves is a
 * 'terminus' change — "now ends at Aylesbury", "now goes on to Stourbridge Junction". Each train
 * still says where it actually ends; nothing about the destination is lost.
 *
 * ── THE RAILWAY DAY STARTS AT 03:00 ─────────────────────────────────────────────────────────────
 *
 * A 00:15 departure is the last train of the evening, not the first of the morning, so every
 * ordering here counts minutes from 03:00 (`serviceMinutes`).
 */

/** The largest retiming still reported as "the same train, moved". See the header. */
export const MAX_SHIFT_MIN = 20;

/** The largest gap between a train that stops running and a new one still read as the same train
 *  going somewhere else. Tighter than MAX_SHIFT_MIN on purpose: across routes, nothing else ties
 *  the two together. */
export const MAX_REROUTE_MIN = 5;

/**
 * Lines that run on: the onward stops' trains are this line's trains (see the header). Keyed by the
 * line's route key; `onward` lists the stations past the line's own, NEAREST FIRST, each with the
 * short name a train's row uses under its time.
 * @type {Readonly<Record<string, Readonly<{ station: string, via: string, onward: ReadonlyArray<{ station: string, short: string }> }>>>}
 */
export const LINES = Object.freeze({
    AYSA: Object.freeze({ station: 'AYS', via: 'A', onward: Object.freeze([{ station: 'AVP', short: 'Parkway' }]) }),
    BMO:  Object.freeze({ station: 'BMO', via: '',  onward: Object.freeze([
        { station: 'BSW', short: 'Snow Hill' }, { station: 'SBJ', short: 'Stourbridge' }]) }),
});

/** An onward station's route key → the line it belongs to. Onward stations carry no route. */
const LINE_OF = /** @type {Record<string, string>} */ (Object.fromEntries(
    Object.entries(LINES).flatMap(([key, line]) => line.onward.map(o => [o.station, key]))));

/**
 * How far along its line a station is: 0 for the line's own station, 1 for the first onward stop…
 * −1 when the station is not on a line.
 * @param {string} station
 * @returns {number}
 */
export function lineDepth(station) {
    for (const line of Object.values(LINES)) {
        if (line.station === station) return 0;
        const i = line.onward.findIndex(o => o.station === station);
        if (i >= 0) return i + 1;
    }
    return -1;
}

/** The hours the basic pattern is read from — the off-peak middle of the day. */
export const PATTERN_HOURS = Object.freeze({ from: 10, to: 16 });

/** @typedef {[string, string, string, string]} TrainRow  [time 'HH:MM', station, route, days] */
/** @typedef {'same'|'earlier'|'later'|'new'|'gone'|'rerouted'|'terminus'} ChangeKind */
/**
 * @typedef {object} PairedTrain
 * @property {string|null} now    the current time, or null for a new train
 * @property {string|null} dec    the December time, or null for one that stops running
 * @property {ChangeKind} kind
 * @property {number} shift       minutes later (+) or earlier (−); 0 when unpaired
 * @property {string} days        the current train's weekday exception ('' when none)
 * @property {{ station: string, via: string, time: string }} [other]  for 'rerouted': the train
 *           on the OTHER route it became (seen from the old route) or came from (from the new one)
 * @property {'old'|'new'} [side]  for 'rerouted': which of the two routes this row is listed under
 * @property {string} [nowTo]     the station the current train ends (or, arriving, starts) at
 * @property {string} [decTo]     the same for the December train — they differ only on a 'terminus' change
 */
/**
 * @typedef {object} RouteChange
 * @property {string} key         station + route, e.g. 'AYSH'
 * @property {string} station
 * @property {string} via         '' | 'H' | 'A'
 * @property {number} nowCount
 * @property {number} decCount
 * @property {PairedTrain[]} trains
 * @property {Record<ChangeKind, number>} tally
 */

/**
 * Minutes since 03:00 — the railway day.
 * @param {string} hhmm
 * @returns {number}
 */
export function serviceMinutes(hhmm) {
    const h = Number(hhmm.slice(0, 2)), m = Number(hhmm.slice(3, 5));
    return (h * 60 + m - 180 + 1440) % 1440;
}

/**
 * The route key — the station, plus the route where the station has two; an extension's trains
 * take the key of the line they run on from (`LINES`).
 * @param {TrainRow} row
 * @returns {string}
 */
export const routeKey = (row) => LINE_OF[row[1] + row[2]] ?? row[1] + row[2];

/**
 * Pair two sorted lists of times in order, at the least total shift (see the header).
 *
 * A textbook sequence alignment: leaving a time unpaired costs `maxShift`, pairing two costs the
 * minutes between them, and a pair further apart than `maxShift` is not allowed at all. So any two
 * times within the threshold are always better paired than both left over.
 *
 * @param {TrainRow[]} nowRows   one route's current trains, in service order
 * @param {TrainRow[]} decRows   the same route's December trains, in service order
 * @param {number} [maxShift]
 * @returns {PairedTrain[]}
 */
export function alignTimes(nowRows, decRows, maxShift = MAX_SHIFT_MIN) {
    const a = nowRows.map(r => serviceMinutes(r[0]));
    const b = decRows.map(r => serviceMinutes(r[0]));
    const n = a.length, m = b.length;
    // cost[i][j] — the cheapest alignment of the first i current and first j December times.
    const cost = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) cost[i][0] = i * maxShift;
    for (let j = 1; j <= m; j++) cost[0][j] = j * maxShift;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const d = Math.abs(a[i - 1] - b[j - 1]);
            const pair = d <= maxShift ? cost[i - 1][j - 1] + d : Infinity;
            cost[i][j] = Math.min(pair, cost[i - 1][j] + maxShift, cost[i][j - 1] + maxShift);
        }
    }
    /** @type {PairedTrain[]} */
    const out = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0) {
            const d = Math.abs(a[i - 1] - b[j - 1]);
            if (d <= maxShift && cost[i][j] === cost[i - 1][j - 1] + d) {
                const shift = b[j - 1] - a[i - 1];
                out.push({
                    now: nowRows[i - 1][0], dec: decRows[j - 1][0], shift, days: nowRows[i - 1][3],
                    kind: shift === 0 ? 'same' : shift > 0 ? 'later' : 'earlier',
                    nowTo: nowRows[i - 1][1], decTo: decRows[j - 1][1],
                });
                i--; j--; continue;
            }
        }
        if (i > 0 && cost[i][j] === cost[i - 1][j] + maxShift) {
            out.push({ now: nowRows[i - 1][0], dec: null, kind: 'gone', shift: 0, days: nowRows[i - 1][3], nowTo: nowRows[i - 1][1] });
            i--;
        } else {
            out.push({ now: null, dec: decRows[j - 1][0], kind: 'new', shift: 0, days: '', decTo: decRows[j - 1][1] });
            j--;
        }
    }
    out.reverse();
    // The backtrack interleaves the unpaired rows by table position, not by time; a reader scans
    // the list by time. Stable, so two trains at one minute keep their alignment order.
    const at = (/** @type {PairedTrain} */ t) => serviceMinutes(/** @type {string} */ (t.now ?? t.dec));
    return out.sort((x, y) => at(x) - at(y));
}

/**
 * The current timetable runs a few weekday trains at two times — one on Mondays and Fridays, one
 * Tuesday to Thursday. December has one train. Alignment pairs one of the two and leaves the other
 * "no longer runs", which is wrong: it still runs, at the December time. So a left-over train with
 * a day exception is paired to its partner's December time when the partner carries the opposite
 * exception and the gap is within MAX_SHIFT_MIN.
 *
 * @param {PairedTrain[]} trains  one route, aligned
 * @returns {PairedTrain[]}
 */
export function foldWeekdayVariants(trains) {
    const OPPOSITE = /** @type {Record<string, string>} */ ({ MFO: 'MFX', MFX: 'MFO' });
    return trains.map((t) => {
        if (t.kind !== 'gone' || !OPPOSITE[t.days] || !t.now) return t;
        const partner = trains.find(p => p.days === OPPOSITE[t.days] && p.now && p.dec
            && Math.abs(serviceMinutes(/** @type {string} */ (p.dec)) - serviceMinutes(/** @type {string} */ (t.now))) <= MAX_SHIFT_MIN);
        if (!partner) return t;
        const shift = serviceMinutes(/** @type {string} */ (partner.dec)) - serviceMinutes(t.now);
        return { ...t, dec: partner.dec, decTo: partner.decTo, shift, kind: shift === 0 ? 'same' : shift > 0 ? 'later' : 'earlier' };
    });
}

/** @param {TrainRow[]} rows */
const byService = (rows) => [...rows].sort((x, y) => serviceMinutes(x[0]) - serviceMinutes(y[0]));

/**
 * Every route on one day and direction, compared. Busiest December route first; a route that
 * stops altogether sorts by its current count instead, so it is not buried.
 *
 * @param {TrainRow[]} nowRows
 * @param {TrainRow[]} decRows
 * @returns {RouteChange[]}
 */
export function compareRoutes(nowRows, decRows) {
    /** @type {Map<string, { now: TrainRow[], dec: TrainRow[] }>} */
    const routes = new Map();
    const bucket = (/** @type {TrainRow} */ r) => {
        const k = routeKey(r);
        if (!routes.has(k)) routes.set(k, { now: [], dec: [] });
        return /** @type {{ now: TrainRow[], dec: TrainRow[] }} */ (routes.get(k));
    };
    for (const r of nowRows) bucket(r).now.push(r);
    for (const r of decRows) bucket(r).dec.push(r);

    const compared = [...routes.entries()].map(([key, { now, dec }]) => {
        const sample = now[0] ?? dec[0];
        const line = LINES[key];
        // On a line with an extension, a kept train whose END moved is a terminus change.
        const trains = foldWeekdayVariants(alignTimes(byService(now), byService(dec))).map(t =>
            (t.kind === 'same' || t.kind === 'earlier' || t.kind === 'later') && t.nowTo && t.decTo && t.nowTo !== t.decTo
                ? { ...t, kind: /** @type {ChangeKind} */ ('terminus') } : t);
        return {
            key, station: line?.station ?? sample[1], via: line?.via ?? sample[2],
            nowCount: now.length, decCount: dec.length, trains,
            tally: /** @type {Record<ChangeKind, number>} */ ({ same: 0, earlier: 0, later: 0, new: 0, gone: 0, rerouted: 0, terminus: 0 }),
        };
    });
    relinkAcrossRoutes(compared);
    for (const r of compared) for (const t of r.trains) r.tally[t.kind]++;
    return compared.sort((x, y) => Math.max(y.decCount, y.nowCount) - Math.max(x.decCount, x.nowCount) || x.key.localeCompare(y.key));
}

/**
 * A train that stops running on one route and a new one at the same time on another are, to the
 * person who catches it, one train that now goes somewhere else — the 10:36 to Banbury running on
 * to Birmingham, or an Aylesbury train changing route. Pairs each such left-over with the nearest
 * left-over on a different route, closest first, within MAX_REROUTE_MIN; both become 'rerouted'
 * and each names the other. Mutates the routes it is given.
 *
 * @param {{ station: string, via: string, key: string, trains: PairedTrain[] }[]} routes
 */
export function relinkAcrossRoutes(routes) {
    const gone = [], fresh = [];
    for (const r of routes) {
        for (const t of r.trains) {
            if (t.kind === 'gone' && t.now) gone.push({ r, t, at: serviceMinutes(t.now) });
            if (t.kind === 'new' && t.dec) fresh.push({ r, t, at: serviceMinutes(t.dec) });
        }
    }
    const pairs = [];
    for (const g of gone) for (const f of fresh) {
        const gap = Math.abs(g.at - f.at);
        if (g.r.key !== f.r.key && gap <= MAX_REROUTE_MIN) pairs.push({ g, f, gap });
    }
    pairs.sort((x, y) => x.gap - y.gap || x.g.at - y.g.at);
    const used = new Set();
    for (const { g, f } of pairs) {
        if (used.has(g.t) || used.has(f.t)) continue;
        used.add(g.t); used.add(f.t);
        const shift = f.at - g.at;
        g.t.kind = 'rerouted'; g.t.side = 'old'; g.t.dec = f.t.dec; g.t.decTo = f.t.decTo; g.t.shift = shift;
        g.t.other = endOf(f.r, f.t.decTo, /** @type {string} */ (f.t.dec));
        f.t.kind = 'rerouted'; f.t.side = 'new'; f.t.now = g.t.now; f.t.nowTo = g.t.nowTo; f.t.shift = shift; f.t.days = g.t.days;
        f.t.other = endOf(g.r, g.t.nowTo, /** @type {string} */ (g.t.now));
    }
}

/**
 * The other end of a rerouted train, named by where THAT train actually goes — on a line that runs
 * on, the route's own station is not necessarily it (the 10:36 to Banbury runs on to Snow Hill, not
 * to Moor Street). The route's `via` belongs to the route's own station only.
 * @param {{ station: string, via: string }} route
 * @param {string|undefined} to
 * @param {string} time
 */
function endOf(route, to, time) {
    const station = to ?? route.station;
    return { station, via: station === route.station ? route.via : '', time };
}

/**
 * The basic hour: for each route, the minutes past the hour it leaves at in most of the off-peak
 * hours. "Most" is a majority of the hours in `PATTERN_HOURS`, so one extra or missing train in a
 * single hour does not change the pattern.
 *
 * On a line that runs on, `beyond` lists the minutes whose trains mostly run past the line's own
 * station, with where most of them end.
 *
 * @param {TrainRow[]} rows
 * @returns {{ key: string, station: string, via: string, minutes: number[], beyond: { minute: number, to: string }[] }[]}  by first minute
 */
export function basicHour(rows) {
    const hours = PATTERN_HOURS.to - PATTERN_HOURS.from;
    const need = Math.floor(hours / 2) + 1;
    /** @type {Map<string, { station: string, via: string, seen: Map<number, Set<number>>, ends: Map<number, Map<string, number>> }>} */
    const routes = new Map();
    for (const r of rows) {
        const h = Number(r[0].slice(0, 2)), m = Number(r[0].slice(3, 5));
        if (h < PATTERN_HOURS.from || h >= PATTERN_HOURS.to || r[3]) continue;   // a weekday exception is not the pattern
        const k = routeKey(r);
        const line = LINES[k];
        if (!routes.has(k)) routes.set(k, { station: line?.station ?? r[1], via: line?.via ?? r[2], seen: new Map(), ends: new Map() });
        const route = /** @type {any} */ (routes.get(k));
        if (!route.seen.has(m)) route.seen.set(m, new Set());
        route.seen.get(m).add(h);
        if (line) {
            if (!route.ends.has(m)) route.ends.set(m, new Map());
            route.ends.get(m).set(r[1], (route.ends.get(m).get(r[1]) ?? 0) + 1);
        }
    }
    const out = [];
    for (const [key, { station, via, seen, ends }] of routes) {
        const minutes = [...seen.entries()].filter(([, hs]) => hs.size >= need).map(([m]) => m).sort((x, y) => x - y);
        const beyond = minutes.flatMap((m) => {
            const counts = [...(ends.get(m) ?? new Map()).entries()].sort((x, y) => y[1] - x[1]);
            const [to] = counts[0] ?? [station];
            return to !== station ? [{ minute: m, to }] : [];
        });
        if (minutes.length) out.push({ key, station, via, minutes, beyond });
    }
    return out.sort((x, y) => x.minutes[0] - y.minutes[0] || x.key.localeCompare(y.key));
}

/**
 * The basic hour, before and after, one row per route that appears in either.
 *
 * @param {TrainRow[]} nowRows
 * @param {TrainRow[]} decRows
 * @returns {{ key: string, station: string, via: string, now: number[], dec: number[], nowBeyond: { minute: number, to: string }[], decBeyond: { minute: number, to: string }[], changed: boolean }[]}
 */
export function compareBasicHour(nowRows, decRows) {
    const now = basicHour(nowRows), dec = basicHour(decRows);
    /** @typedef {{ key: string, station: string, via: string, now: number[], dec: number[], nowBeyond: { minute: number, to: string }[], decBeyond: { minute: number, to: string }[], changed: boolean }} PatternRow */
    /** @type {Map<string, PatternRow>} */
    const rows = new Map();
    const blank = (/** @type {{ key: string, station: string, via: string }} */ r) =>
        ({ key: r.key, station: r.station, via: r.via, now: [], dec: [], nowBeyond: [], decBeyond: [], changed: true });
    for (const r of now) rows.set(r.key, { ...blank(r), now: r.minutes, nowBeyond: r.beyond });
    for (const r of dec) {
        const row = rows.get(r.key) ?? blank(r);
        row.dec = r.minutes;
        row.decBeyond = r.beyond;
        rows.set(r.key, row);
    }
    const first = (/** @type {{ now: number[], dec: number[] }} */ r) => Math.min(...r.dec, ...r.now);
    return [...rows.values()]
        .map(r => ({ ...r, changed: r.now.join() !== r.dec.join() || JSON.stringify(r.nowBeyond) !== JSON.stringify(r.decBeyond) }))
        .sort((x, y) => first(x) - first(y) || x.key.localeCompare(y.key));
}

/**
 * Every train within `window` minutes of a time, before and after — "what happens to the 17:15?".
 *
 * @param {TrainRow[]} nowRows
 * @param {TrainRow[]} decRows
 * @param {string} hhmm
 * @param {number} [window]
 * @returns {{ now: TrainRow[], dec: TrainRow[] }}
 */
export function trainsNear(nowRows, decRows, hhmm, window = 15) {
    const at = serviceMinutes(hhmm);
    const near = (/** @type {TrainRow[]} */ rows) =>
        byService(rows.filter(r => Math.abs(serviceMinutes(r[0]) - at) <= window));
    return { now: near(nowRows), dec: near(decRows) };
}

/**
 * Read a typed time the way people type one: "17:15", "17.15", "1715", "715", "7:05". Returns
 * 'HH:MM', or null when it is not a time — never a guess at what was meant.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parseTypedTime(text) {
    const s = String(text ?? '').trim();
    let h, m;
    const sep = s.match(/^(\d{1,2})[:.](\d{2})$/);
    if (sep) { h = Number(sep[1]); m = Number(sep[2]); }
    else if (/^\d{3,4}$/.test(s)) { h = Number(s.slice(0, -2)); m = Number(s.slice(-2)); }
    else return null;
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Whole days from `today` to the change, counted on calendar dates (never by milliseconds, which a
 * clock change in October would make 23 or 25 hours). 0 on the day itself; negative after it.
 *
 * @param {Date} today
 * @param {string} changeDate  'YYYY-MM-DD'
 * @returns {number}
 */
export function daysUntil(today, changeDate) {
    const [y, mo, d] = changeDate.split('-').map(Number);
    const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((Date.UTC(y, mo - 1, d) - a) / 86_400_000);
}

/**
 * The wording for one paired train's change — the one place the page's change words are written.
 *
 * @param {PairedTrain} t
 * @param {Readonly<Record<string, string>>} [stations]  names for a rerouted train's other route
 * @param {'dep'|'arr'} [dir]  leaving Marylebone ("runs to") or arriving ("comes from")
 * @returns {string}
 */
export function changeLabel(t, stations = {}, dir = 'dep') {
    const mins = (/** @type {number} */ n) => `${n} min${n === 1 ? '' : 's'}`;
    switch (t.kind) {
        case 'same':    return 'No change';
        case 'later':   return `${mins(t.shift)} later`;
        case 'earlier': return `${mins(-t.shift)} earlier`;
        case 'new':     return 'New train';
        case 'gone':    return 'No longer runs';
        case 'terminus': {
            const to = /** @type {string} */ (t.decTo), name = stations[to] ?? to;
            const further = lineDepth(to) > lineDepth(/** @type {string} */ (t.nowTo));
            const what = dir === 'arr' ? `Now starts at ${name}` : further ? `Now goes on to ${name}` : `Now ends at ${name}`;
            return t.shift ? `${what}, ${t.dec}` : what;
        }
        default: {
            const o = /** @type {NonNullable<PairedTrain['other']>} */ (t.other);
            const where = routeName(stations, o.station, o.via);
            if (t.side === 'new') return dir === 'dep' ? `Was the ${o.time} to ${where}` : `Was the ${o.time} from ${where}`;
            const verb = dir === 'dep' ? 'Now runs to' : 'Now comes from';
            return t.shift ? `${verb} ${where}, ${o.time}` : `${verb} ${where}`;
        }
    }
}

/**
 * The words under a line's name in the basic hour: which of its minutes run on, and where to —
 * ":57 goes on to Aylesbury Vale Parkway". December's pattern when it has one, today's otherwise.
 * '' for a route that does not run on, or none of whose minutes do.
 *
 * @param {{ key: string, dec: number[], decBeyond: { minute: number, to: string }[], nowBeyond: { minute: number, to: string }[] }} r  a compareBasicHour row
 * @param {Readonly<Record<string, string>>} stations
 * @param {'dep'|'arr'} [dir]
 * @returns {string}
 */
export function beyondLabel(r, stations, dir = 'dep') {
    const beyond = r.dec.length ? r.decBeyond : r.nowBeyond;
    if (!LINES[r.key] || !beyond.length) return '';
    /** @type {Map<string, number[]>} */
    const byEnd = new Map();
    for (const { minute, to } of beyond) byEnd.set(to, [...(byEnd.get(to) ?? []), minute]);
    return [...byEnd.entries()].map(([to, ms]) => {
        const at = ms.map(m => `:${String(m).padStart(2, '0')}`).join(' and ');
        const one = ms.length === 1;
        const verb = dir === 'arr' ? (one ? 'starts at' : 'start at') : (one ? 'goes on to' : 'go on to');
        return `${at} ${verb} ${stations[to] ?? to}`;
    }).join('; ');
}

/**
 * A current train's weekday exception, in words. '' when it runs every day of its kind.
 * @param {string} days
 * @returns {string}
 */
export function daysLabel(days) {
    return { MFO: 'Mon and Fri only', MFX: 'Tue to Thu only', WO: 'Wed only' }[days] ?? '';
}

/**
 * The route's name as a passenger would say it.
 * @param {Readonly<Record<string, string>>} stations
 * @param {string} station
 * @param {string} via
 * @returns {string}
 */
export function routeName(stations, station, via) {
    const name = stations[station] ?? station;
    return via === 'H' ? `${name} via High Wycombe` : via === 'A' ? `${name} via Amersham` : name;
}
