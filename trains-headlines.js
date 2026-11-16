// @ts-check
/**
 * trains-headlines.js — PURE: "what's changing", the Trains page's headline list. One line per
 * station, the biggest change first, worded so a colleague can repeat it to a customer.
 *
 * Every figure is read through trains-stations.js — one real day (`aRealDay`), December answered only
 * where it can be known (`decemberKnown`) — and this module decides only which changes make a line,
 * how a line is worded, and which lines fold into another's (`foldSameTrains`). The page renders the
 * result (trains-render.js → `renderHeadlines`).
 */

import { serviceMinutes, alignTimes } from './trains-change.js';
import { STATION_ORDER } from './trains-data.js';
import { aRealDay, callsOf, decemberKnown, endingAt, summarise, callingAt, hourChanged, sameRegularity, rateWords,
    minutesWords, lineOf, andList } from './trains-stations.js';

/** @typedef {import('./trains-change.js').TrainRow} TrainRow */

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
