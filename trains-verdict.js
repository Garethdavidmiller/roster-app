// @ts-check
/**
 * trains-verdict.js — PURE: a station's change in words. The one sentence a colleague can repeat
 * (`verdictFor`), the rest of what changed after it (`balanceFacts`), and the phrases both are built
 * from — trains an hour, minutes past the hour — which the card's figures table is written in too, so
 * the sentence and the table never say one figure two ways.
 *
 * The figures are trains-stations.js's (`summarise`); this module only says them. Two rules hold the
 * words to the figures, and each is argued beside its function: every claim is one the table shows
 * (`verdictFor`), and a gain is never said without its cost (`balanceFacts`).
 */

import { serviceMinutes, dateWords, monthWords } from './trains-change.js';
import { CHANGE_DATE } from './trains-data.js';
import { REAL_DAY, runsOn } from './trains-weekdays.js';

/** @typedef {import('./trains-change.js').PairedTrain} PairedTrain */
/** @typedef {import('./trains-stations.js').StationSummary} StationSummary */
/** @typedef {import('./trains-stations.js').StationTrain} StationTrain */

/**
 * A first or last train that moves by less than this is a re-timing, not news: the headlines' rule for
 * a last train (trains-headlines.js) and the card's for both.
 */
export const EDGE_SHIFT_MIN = 10;

/**
 * A fastest journey that changes by less than this is not said: one minute can be the books' own
 * rounding, since every time they print is to the minute.
 */
export const JOURNEY_SHIFT_MIN = 2;

/**
 * @typedef {{ tone: 'same'|'more'|'less'|'moved'|'unknown', text: string, also: string[] }} Verdict
 *   text — the one sentence; also — the rest of what the figures table says changed, each a sentence
 *   of its own (`balanceFacts`), then what the other weekdays have when they differ
 */

/** "6 more trains a day: 47, was 41." — or, for a count that holds, "the same number of trains a day: 46." */
const countWords = (/** @type {number} */ was, /** @type {number} */ is) => {
    const n = Math.abs(is - was);
    return is === was ? `the same number of trains a day: ${is}.` : `${n} ${is > was ? 'more' : 'fewer'} ${n === 1 ? 'train' : 'trains'} a day: ${is}, was ${was}.`;
};

/**
 * One sentence a member of staff can repeat, then the rest of what changed. The order is the order of
 * what matters to a passenger: whether there is a service at all, how often, how many, then when. Every
 * claim is one the figures table beside it shows, so the sentence can never say something the numbers
 * do not. Coming back, the minutes are when trains leave the station on the card (`boardingTime`).
 *
 * THE REST IS SAID TOO, BOTH WAYS (external reviews, 15 and 18 Nov 2026). The sentence chose one fact,
 * so Aylesbury's card read "6 more trains a day: 47, was 41." above a table whose first train moved 34
 * minutes earlier and whose fastest journey grew from 51 minutes to 53 — the one fact a colleague
 * repeated was the good one. `also` carries each of the others that clears its bar (`balanceFacts`).
 *
 * WHERE THE WEEKDAYS DISAGREE, `days` NAMES THE DAYS (see the header): the sentence is the real day's,
 * so it says whose — "Tuesday to Thursday, 1 fewer train a day: 46, was 47." — and each other group
 * of days gets one line after the rest: its count, then whatever of its own balance the lines above
 * do not already say, as one sentence its days begin — "Mondays and Fridays, 1 more train a day: 55,
 * was 54; fastest journey 2 minutes longer: 24 min, was 22." One sentence, not two, because a second
 * would read as every day's.
 * @param {StationSummary} now
 * @param {StationSummary|null} dec
 * @param {PairedTrain[]|null} trains
 * @param {'dep'|'arr'} [dir]
 * @param {{ change?: string|null, started?: boolean, days?: string|null, others?: { words: string, now: StationSummary, dec: StationSummary }[] }} [when]
 *   see stationView; with no `change`, the data module's. days / others — `dayScope`'s
 * @returns {Verdict}
 */
export function verdictFor(now, dec, trains, dir = 'dep', { change = null, started = false, days = null, others = [] } = {}) {
    if (!dec) {
        const month = monthWords(change || CHANGE_DATE);
        return { tone: 'unknown', text: `${month} not known yet: Chiltern has not published where its ${month} trains stop. Today’s figures are below.`, also: [] };
    }
    const lead = leadOf(now, dec, trains, dir, change, started);
    // Lower-case only the first letter: every sentence here opens on a word of ours ("Same", "More", "No",
    // "Fastest", "First", "Last") or a figure, never a name.
    const lower = (/** @type {string} */ t) => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
    const text = days ? `${days}, ${lower(lead.text)}` : lead.text;
    // A service that starts or ends, or none either side, is its own whole answer: nothing to balance.
    const balance = lead.kind === 'new' || lead.kind === 'gone' || lead.kind === 'none' ? [] : balanceFacts(now, dec, lead);
    const otherDays = others.map((o) => {
        if (!o.now.total && !o.dec.total) return `${o.words}, no direct trains.`;
        const gained = o.dec.total - o.now.total;
        const own = balanceFacts(o.now, o.dec, { tone: gained > 0 ? 'more' : gained < 0 ? 'less' : 'same', kind: 'daily' })
            .filter(f => !balance.includes(f));
        return `${o.words}, ${[countWords(o.now.total, o.dec.total), ...own.map(lower)].map(f => f.replace(/\.$/, '')).join('; ')}.`;
    });
    return { tone: lead.tone, text, also: [...balance, ...otherDays] };
}

/**
 * The one sentence, and which kind of fact it chose — the rest is `balanceFacts`'s.
 * @param {StationSummary} now
 * @param {StationSummary} dec
 * @param {PairedTrain[]|null} trains
 * @param {'dep'|'arr'} dir
 * @param {string|null} change
 * @param {boolean} started
 * @returns {{ tone: 'same'|'more'|'less'|'moved', text: string, kind: 'none'|'new'|'gone'|'hour'|'daily'|'minutes'|'moved'|'same' }}
 */
function leadOf(now, dec, trains, dir, change, started) {
    const from = dateWords(change || CHANGE_DATE);
    // No train either side — a station that only some days reach. It used to say "No change." over a
    // table of noughts, which a reader takes for "the trains carry on as they are".
    if (!now.total && !dec.total) {
        return { tone: 'same', kind: 'none', text: dir === 'dep'
            ? `No direct trains from Marylebone on this day${started ? '' : `, now or from ${from}`}.`
            : `No direct trains to Marylebone on this day${started ? '' : `, now or from ${from}`}.` };
    }
    if (!now.total && dec.total) {
        return { tone: 'more', kind: 'new', text: dec.total === 1
            ? `New from ${from}: one direct train, the ${dec.first}.`
            : `New from ${from}: ${dec.total} direct trains a day.` };
    }
    // Never "No direct trains from 13 December": coming back, "trains from" names where a train starts,
    // and the sentence read as trains from a place (Trains review, Nov 2026).
    if (now.total && !dec.total) {
        return { tone: 'less', kind: 'gone', text: started ? `No direct trains on this day since ${from}.` : `From ${from}, no direct trains on this day.` };
    }
    if (hourChanged(now, dec)) {
        const more = dec.daytime > now.daytime;
        return { tone: more ? 'more' : 'less', kind: 'hour',
            text: `${more ? 'More' : 'Fewer'} trains in the daytime: ${rateWords(dec)}, was ${rateWords(now, { short: true })}.` };
    }
    const gained = dec.total - now.total;
    if (gained) return { tone: gained > 0 ? 'more' : 'less', kind: 'daily', text: countWords(now.total, dec.total) };
    if (sameRegularity(now, dec) && now.minutes.join() !== dec.minutes.join()) {
        return { tone: 'moved', kind: 'minutes', text: `Same number of trains a day. In the daytime they leave at ${minutesWords(dec.minutes)} past the hour, was ${minutesWords(now.minutes)}.` };
    }
    // A train that leaves on time but gets there later is a change too: "No change." sat above
    // "Fastest journey 159 → 164 min" at Cradley Heath (v24.83). Counted on one real day, as every count
    // on the card is: the list below shows a Mondays-and-Fridays train AND its Tuesday-to-Thursday twin,
    // and counting both said "7 are different" at Islip, where 6 are on any one day (18 Nov 2026).
    // And it counts DECEMBER'S trains that differ: a kept train that moved, at either end, and a train
    // new to this station. A stop moved from one train to another is one change, not two — counting the
    // train that stops calling AND the one that starts said "11 are different" at Kings Sutton, of a
    // day of 10 (Trains review, Nov 2026). With the count held, every train that leaves the list is
    // matched by one that joins it, so the joiners are the whole story.
    const moved = (trains ?? []).filter(t => runsOn(t.days, REAL_DAY) && t.dec && (!t.now
        || t.kind !== 'same' || (/** @type {StationTrain} */ (t).farShift ?? 0) !== 0)).length;
    if (moved) return { tone: 'moved', kind: 'moved', text: `Same number of trains a day, but ${moved} ${moved === 1 ? 'is' : 'are'} different — see Train by train below.` };
    return { tone: 'same', kind: 'same', text: 'No change.' };
}

/**
 * The rest of what the figures table says changed, as sentences to go after the verdict's own: the
 * day's count when the sentence was about the daytime, the fastest journey, and the first and last
 * train — each only past its bar (`EDGE_SHIFT_MIN`, `JOURNEY_SHIFT_MIN`), each with both figures, as
 * the sentence has. The facts that go the sentence's way come first, then the ones that go against it,
 * so a gain is never said without its cost — "6 more trains a day" is followed by the earlier first
 * train, then the longer fastest journey. A sentence that leans neither way takes the gains first.
 * @param {StationSummary} now
 * @param {StationSummary} dec
 * @param {{ tone: string, kind: string }} lead
 * @returns {string[]}
 */
export function balanceFacts(now, dec, lead) {
    /** @type {{ text: string, better: boolean }[]} */
    const facts = [];
    if (lead.kind === 'hour' && dec.total !== now.total) {
        const text = countWords(now.total, dec.total);
        facts.push({ text: text.charAt(0).toUpperCase() + text.slice(1), better: dec.total > now.total });
    }
    if (now.fastest !== null && dec.fastest !== null && Math.abs(dec.fastest - now.fastest) >= JOURNEY_SHIFT_MIN) {
        const d = dec.fastest - now.fastest;
        facts.push({ text: `Fastest journey ${Math.abs(d)} minutes ${d < 0 ? 'shorter' : 'longer'}: ${dec.fastest} min, was ${now.fastest}.`, better: d < 0 });
    }
    const shift = (/** @type {string|null} */ a, /** @type {string|null} */ b) => a && b ? serviceMinutes(b) - serviceMinutes(a) : 0;
    const first = shift(now.first, dec.first);
    if (Math.abs(first) >= EDGE_SHIFT_MIN) facts.push({ text: `First train ${first < 0 ? 'earlier' : 'later'}: ${dec.first}, was ${now.first}.`, better: first < 0 });
    const last = shift(now.last, dec.last);
    if (Math.abs(last) >= EDGE_SHIFT_MIN) facts.push({ text: `Last train ${last > 0 ? 'later' : 'earlier'}: ${dec.last}, was ${now.last}.`, better: last > 0 });
    const gainsFirst = lead.tone !== 'less';
    return [...facts.filter(f => f.better === gainsFirst), ...facts.filter(f => f.better !== gainsFirst)].map(f => f.text);
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
 * Whether one station's daytime times, today and from the change, can be compared minute for minute:
 * the same number of times repeat in most hours on both sides, so a difference is a train that MOVED.
 * A train whose minute only wobbles stops "repeating" without going anywhere — Beaconsfield's December
 * :13 arrival is :10 in two hours of six — and comparing lists of different lengths said "from :13 and :39 to :39" of a
 * station that keeps all three trains an hour (v24.80, seen once December's stops were known).
 * @param {StationSummary} now
 * @param {StationSummary} dec
 */
export const sameRegularity = (now, dec) => now.minutes.length > 0 && now.minutes.length === dec.minutes.length;

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
 * The exception to the typical hour — "1 in some hours", "none in one hour", "5 or 6 in some hours" —
 * or '' when every hour is the same or there is no typical hour.
 * @param {StationSummary} s
 * @returns {string}
 */
export function hourNote(s) {
    const [lo, hi] = s.hourRange, t = s.typical;
    if (lo === hi || t === null) return '';
    const odd = s.hourCounts.filter(n => n !== t);
    // Each count an unusual hour has, named: a range hid a 5 inside "4 (6 in some hours)" and put the
    // typical inside its own exception — "2 (1 to 3 in some hours)" (Trains review, Nov 2026).
    const other = andList([...new Set(odd)].sort((a, b) => a - b).map(n => n === 0 ? 'none' : String(n)), 'or');
    return `${other} in ${odd.length === 1 ? 'one hour' : 'some hours'}`;
}

/**
 * Minutes past the hour as a reader says them: ":27", ":27 and :57", ":06, :10 and :40".
 * @param {number[]} ms
 * @returns {string}
 */
export function minutesWords(ms) {
    return andList(ms.map(m => `:${String(m).padStart(2, '0')}`));
}

/**
 * A list as a reader says it: "A", "A and B", "A, B and C" — or, with `word`, "A, B or C".
 * @param {string[]} ws
 * @param {'and'|'or'} [word]
 * @returns {string}
 */
export const andList = (ws, word = 'and') => ws.length < 2 ? (ws[0] ?? '') : `${ws.slice(0, -1).join(', ')} ${word} ${ws[ws.length - 1]}`;
