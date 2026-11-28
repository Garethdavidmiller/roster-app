// @ts-check
/**
 * trains-journey.js — PURE: "Aylesbury, after 17:15" — where a customer is going and when, typed as one
 * line, read, and answered with the first train from Marylebone that stops there and the two after it.
 *
 * The question at the barrier (owner, Nov 2026): "a colleague should be able to enter 'Aylesbury, after
 * 17:15' and get the first useful answer: departure time, via Amersham or via High Wycombe, then the
 * next alternative." So this module answers ONE date, the way a departure board does — not the two
 * timetables side by side, which is the time-alone lookup's job (trains-render.js → `renderLookup`),
 * kept for "what happens to the 17:15?".
 *
 * ── NOTHING HERE IS A SECOND COPY ──────────────────────────────────────────────────────────────
 *
 * The time is read by `parseTypedTime` (trains-change.js), the one parser the time box has always used,
 * and the place by `matchStations` (trains-stations.js), the Stations tab's search — its aliases, short
 * forms, initials and codes. This module only splits the line into the two (`parseJourney`). The
 * timetable a date uses is `timetablePhase`'s, the switch the whole page turns by (`timetableOn`), and
 * which weekday trains run is `runsOn` (trains-weekdays.js): a Monday is answered from Monday's trains,
 * not from "one real day", because this answer is for a date and not a count.
 *
 * ── THE ROUTE IS SAID ONLY WHERE THE DATA TELLS TWO APART ──────────────────────────────────────
 *
 * The books give a route only to Aylesbury's trains — via High Wycombe ('H') or via Amersham ('A'), and a
 * train run on to Aylesbury Vale Parkway takes its line's (`LINES` in trains-change.js) — so a train's
 * route is `LINES[routeKey(row)]?.via ?? row[2]`, as the station cards read it. It is said for a
 * destination that trains of BOTH routes reach (`viaMatters`): Aylesbury today. Said of Gerrards Cross, a
 * via-High-Wycombe Aylesbury train's code would read as a route to a station before High Wycombe. A train
 * "via Amersham" is on Chiltern's route of that name; whether it stops at Amersham is in its stops.
 *
 * ── EVERY TIME IS LEAVING MARYLEBONE, AND THE DAY IS THE RAILWAY'S ────────────────────────────
 *
 * "After 17:15" is the time the train leaves Marylebone, at or after it. Times are compared in service
 * minutes from 03:00 (`serviceMinutes`), so "after 23:30" reaches the 00:10, and the date is the
 * railway's (`railwayToday`): at 00:30 the trains still to come are the evening's. No train left that
 * day, and the answer is the first one the next day — from that date's own timetable, so Saturday
 * 12 December's late question is answered from the timetable that starts on the Sunday.
 *
 * ── A TIME TYPED IN THE SMALL HOURS IS THE NEXT ONE TO COME ────────────────────────────────────
 *
 * Between 00:00 and 03:00 the railway day is still yesterday's, and every time from 03:00 on in it has
 * gone. Answered from it, "Aylesbury, after 08:00" at 01:00 on Sunday 13 December gave Saturday's 08:27,
 * from the old timetable — a train nobody can catch — when the customer wants Sunday's (Nov 2026). So a
 * time typed then means the next time that clock time comes round (`journeyDateAt`): from 03:00 on, the
 * coming calendar day; before 03:00, tonight while it has not passed, else the next night. And the words
 * "today" and "tomorrow" count from the calendar, not the railway day (`dayWord`), as the countdown's do
 * (`timetablePhase`): at 00:30 on a Tuesday, the morning's first train is "today", not "tomorrow".
 */

import { parseTypedTime, serviceMinutes, timetablePhase, dateWords, routeKey, LINES, railwayToday } from './trains-change.js';
import { callsOf, parseStops, matchStations } from './trains-stations.js';
import { WEEKDAYS, runsOn } from './trains-weekdays.js';

/** @typedef {import('./trains-change.js').TrainRow} TrainRow */
/** @typedef {'SX'|'SO'|'SU'} DayKind */
/** @typedef {{ change: string, festiveUntil: string, validUntil: string }} TimetableDates  'YYYY-MM-DD' each, as `timetablePhase` takes them */

/**
 * Words that join a place to a time — "to Aylesbury", "Aylesbury, after 17:15", "after 5pm to Wycombe" — dropped
 * where they open or close the place, never inside it: "Harrow-on-the-Hill" and "Chalfont & Latimer" keep theirs.
 */
const JOINERS = new Set(['after', 'from', 'at', 'leaving', 'departing', 'around', 'about', 'by', 'to', 'for', 'next', 'first',
    'train', 'trains', 'the', 'and', 'then', 'please']);

/** A token that is part of a time: it holds a digit, or it is the a.m./p.m. after one ("5.15 pm"). */
const HALF_DAY = /^[ap]\.?(?:m\.?)?$/i;

/** The times people say by name, alone or after a 12 ("12 noon"). @type {Readonly<Record<string, string>>} */
const NAMED_TIMES = Object.freeze({ noon: '12:00', midday: '12:00', midnight: '00:00' });
/** A token's named time, or undefined. @param {string} t @returns {string|undefined} */
const namedTime = (t) => NAMED_TIMES[t.toLowerCase().replace(/[^a-z]/g, '')];

/**
 * One typed line, split into the place and the time. The time is every token with a digit in it, and an
 * a.m. or p.m. straight after one; it is read by `parseTypedTime`, so it is a time on exactly the terms the
 * time box has always had ("17:15", "1715", "5.15pm", "5 pm"; never a bare "5"). "Noon", "midday" and
 * "midnight" are times too, alone or after a 12. A name run into its time, "Aylesbury17:15", is split where
 * the letters meet the digits. The rest, with the joining words at either end of each side of the time taken
 * off, is the place.
 * @param {string} text
 * @returns {{ place: string, timeText: string, time: string|null }}
 *   place — '' when only a time was typed · timeText — the time as typed, '' when none ·
 *   time — 'HH:MM', or null when no time was typed or what was typed is not one
 */
export function parseJourney(text) {
    const tokens = String(text ?? '').replace(/(\p{L})(?=\d)/gu, '$1 ').trim().split(/[\s,;]+/).filter(Boolean);
    const timeAt = tokens.map((t, i) => /\d/.test(t) || !!namedTime(t) || (HALF_DAY.test(t) && i > 0 && /\d/.test(tokens[i - 1])));
    const timeText = tokens.filter((_, i) => timeAt[i]).join(' ');
    const first = timeAt.indexOf(true), last = timeAt.lastIndexOf(true);
    const trim = (/** @type {string[]} */ words) => {
        let a = 0, b = words.length;
        while (a < b && JOINERS.has(words[a].toLowerCase())) a++;
        while (b > a && JOINERS.has(words[b - 1].toLowerCase())) b--;
        return words.slice(a, b);
    };
    const sides = first === -1 ? [tokens] : [tokens.slice(0, first), tokens.slice(last + 1)];
    const place = sides.map(trim).filter(s => s.length).map(s => s.join(' ')).join(' ');
    // A named time stands alone, or after a 12 that says the same ("12 noon"); with any other figure it is no time.
    const named = tokens.map(namedTime).find(Boolean);
    const figures = tokens.filter((t, i) => timeAt[i] && !namedTime(t)).join(' ');
    const time = named ? (!figures || /^12(?:[:.]?00)?$/.test(figures) ? named : null) : timeText ? parseTypedTime(timeText) : null;
    return { place, timeText, time };
}

/** A name as words to compare whole: lower case, "&" as "and", no apostrophes, full stops or hyphens. @param {string} s */
const nameWords = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/['’.]/g, '').split(/[\s-]+/).filter(Boolean).join(' ');

/**
 * The station a place names, by the Stations tab's search (`matchStations`): its first match, which is what
 * Enter opens there, and the other matches, for "or did you mean".
 *
 * A STATION'S FULL NAME, THEN WORDS THE BOX DOES NOT READ — "Aylesbury tomorrow", "Aylesbury, after 17:15 via
 * Amersham" — is that station, and the words after it are `unused`, so the answer can say it has not used them
 * (trains-render.js → `renderJourney`). Only a name typed in FULL, or a code: "west ruislop" is not taken for
 * whichever West the search ranks first.
 *
 * When nothing matches, the CLOSEST: the matches of the longest beginning of what was typed, three letters or
 * more, that finds any — "aylsbury" finds nothing, "ayl" finds both Aylesburys — so a slip in the middle of a
 * word still offers the station. Never Marylebone, which the search leaves out: every train here leaves from it.
 * @param {string} place
 * @param {Readonly<Record<string, string>>} stations
 * @param {readonly string[]} [prefer]  station codes, busiest first (the page passes the running timetable's)
 * @returns {{ crs: string|null, others: string[], closest: string[], unused?: string }}  unused — the words after a station's full name
 */
export function findStation(place, stations, prefer = []) {
    const found = matchStations(stations, place, 4, prefer);
    if (found.length) return { crs: found[0], others: found.slice(1), closest: [] };
    const typed = place.trim().split(/\s+/);
    for (let n = typed.length - 1; n >= 1; n--) {
        const name = typed.slice(0, n).join(' ');
        const near = matchStations(stations, name, 4, prefer);
        const crs = near.find(c => nameWords(stations[c] ?? '') === nameWords(name) || c.toLowerCase() === name.toLowerCase());
        if (crs) return { crs, others: near.filter(c => c !== crs), closest: [], unused: typed.slice(n).join(' ') };
    }
    const q = place.trim();
    for (let n = q.length - 1; n >= 3; n--) {   // three letters at least: "no" of "noon" is the start of every North
        const near = matchStations(stations, q.slice(0, n), 4, prefer);
        if (near.length) return { crs: null, others: [], closest: near };
    }
    return { crs: null, others: [], closest: [] };
}

/** The kind of day a date is, as the day tabs name it. @param {Date} date @returns {DayKind} */
export const dayKindOf = (date) => { const dow = date.getDay(); return dow === 6 ? 'SO' : dow === 0 ? 'SU' : 'SX'; };

/** A date as 'YYYY-MM-DD', on the local calendar — what `dateWords` takes. @param {Date} date */
export const isoDate = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** The same date `days` later, at midday, so no clock change can move it. @param {Date} date @param {number} days */
export const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);

/**
 * The date a journey is answered for: `today` (the railway day) when it is the kind of day chosen, else the
 * next date of that kind — the Saturdays tab, on a Friday, asks about tomorrow; on a Sunday, about six days on.
 * @param {Date} today
 * @param {DayKind} kind
 * @returns {Date}
 */
export function journeyDate(today, kind) {
    for (let i = 0; i < 7; i++) {
        const d = addDays(today, i);
        if (dayKindOf(d) === kind) return d;
    }
    return addDays(today, 0);
}

/** A clock time as 'HH:MM'. @param {Date} d */
const clockOf = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * The date a journey is answered for, from the clock and the time typed (the header's "small hours"). Outside
 * 00:00–03:00, and with no time typed, it is `journeyDate` on the railway day. In the small hours a typed time
 * that has passed on the railway day — every time from 03:00, and a small-hours time before now — means its
 * next time round: the coming calendar day's. The day tab still chooses the kind of day; the tab of the railway
 * day's own kind, which the page opens on, means "the next one" rather than a week on, so "after 08:00" at 01:00
 * on a Saturday is that Saturday morning's trains. The minute now has not passed: a train leaving now still counts.
 * @param {Date} now
 * @param {DayKind} kind  the day tab chosen
 * @param {string|null} at  the time typed, 'HH:MM', or null
 * @returns {Date}
 */
export function journeyDateAt(now, kind, at) {
    const today = railwayToday(now);
    if (!at || isoDate(today) === isoDate(now) || serviceMinutes(at) >= serviceMinutes(clockOf(now))) return journeyDate(today, kind);
    const coming = addDays(today, 1);
    return kind === dayKindOf(today) ? coming : journeyDate(coming, kind);
}

/**
 * A date in the words a member reads against the calendar (the header): 'today', 'tomorrow', or 'tonight' for the
 * railway day still running after midnight — else null, for the caller to name the date. Never from the railway
 * day: at 00:30 on Tuesday 1 December the first train, at 06:35, is today's.
 * @param {Date} date
 * @param {Date} now  the clock, whose calendar date the words count from
 * @returns {'today'|'tomorrow'|'tonight'|null}
 */
export function dayWord(date, now) {
    const at = isoDate(date);
    if (at === isoDate(now)) return 'today';
    if (at === isoDate(addDays(now, 1))) return 'tomorrow';
    return at === isoDate(railwayToday(now)) ? 'tonight' : null;
}

/**
 * The timetable a date runs on, by the page's own switch (`timetablePhase`): today's until the change, the new
 * one from it. Its label names it by its date, which is how a colleague tells a customer which one it is. And
 * `festive`: the date falls in the weeks after the change that Chiltern says it is still changing — the page's
 * own `#trFestive` window, from the same switch — so an answer for one carries that caveat (`renderJourney`).
 * @param {Date} date
 * @param {TimetableDates} dates
 * @returns {{ side: 'now'|'dec', ended: boolean, festive: boolean, label: string }}  ended — both timetables' books have run out
 */
export function timetableOn(date, dates) {
    const p = timetablePhase(date, dates);
    return {
        side: p.started ? 'dec' : 'now',
        ended: p.phase === 'ended',
        festive: p.started && p.festive,
        label: p.started ? `Timetable from ${dateWords(dates.change, 0, { weekday: true })}`
            : `Timetable until ${dateWords(dates.change, -1, { weekday: true })}`,
    };
}

/** A train's route as the station cards read it (the header). @param {TrainRow} row */
const viaOf = (row) => LINES[routeKey(row)]?.via ?? row[2];

/**
 * @typedef {object} Departure
 * @property {string} dep        when it leaves Marylebone, 'HH:MM'
 * @property {string} to         where it ends
 * @property {string} via        its Aylesbury route, 'A', 'H' or ''
 * @property {string|null} arrives  when it reaches the station asked about, or null when its stops are not known
 * @property {ReadonlyArray<Readonly<{ crs: string, time: string }>>} stops  every stop after Marylebone; empty when not known
 */

/**
 * The trains leaving Marylebone at or after `from` that stop at `crs` on `date`, in the order they leave.
 * @param {TrainRow[]} rows  leaving Marylebone, the date's kind of day, from the date's timetable
 * @param {string} crs
 * @param {Date} date        for its weekday: a Monday runs Monday's trains
 * @param {string} from      'HH:MM' — '03:00' is the start of the railway day
 * @returns {Departure[]}
 */
export function departures(rows, crs, date, from) {
    const weekday = dayKindOf(date) === 'SX' ? WEEKDAYS[date.getDay() - 1] : null;
    const after = serviceMinutes(from);
    return rows.filter(r => (!weekday || runsOn(r[3], weekday)) && callsOf(r).includes(crs) && serviceMinutes(r[0]) >= after)
        .sort((a, b) => serviceMinutes(a[0]) - serviceMinutes(b[0]))
        .map(r => ({ dep: r[0], to: r[1], via: viaOf(r), arrives: parseStops(r).find(s => s.crs === crs)?.time ?? null, stops: parseStops(r) }));
}

/**
 * Whether the route is worth saying for `crs`: trains of both Aylesbury routes reach it (the header).
 * @param {TrainRow[]} rows
 * @param {string} crs
 */
export function viaMatters(rows, crs) {
    const vias = new Set(rows.filter(r => callsOf(r).includes(crs)).map(viaOf));
    return vias.has('A') && vias.has('H');
}

/** How many trains an answer lists: the first, then the next alternatives. */
export const JOURNEY_TRAINS = 3;

/**
 * @typedef {object} JourneyDay
 * @property {Date} date
 * @property {{ side: 'now'|'dec', ended: boolean, festive: boolean, label: string }} timetable
 * @property {Departure[]} trains  the first, then up to two more
 * @property {number} total        trains that stop there that whole day
 * @property {boolean} via         whether to say each train's route (`viaMatters`)
 */

/**
 * "Aylesbury, after 17:15": the first train from Marylebone at or after `at` that stops at `crs` on `date`,
 * then the next ones. With none left that day, `next` is the first train the day after, from that day's
 * own timetable; otherwise it is null.
 * @param {{ crs: string, at: string|null, date: Date, timetables: Record<'now'|'dec', Record<DayKind, { dep: TrainRow[] }>>,
 *   dates: TimetableDates, count?: number }} o  at — 'HH:MM', or null for the whole day
 * @returns {JourneyDay & { at: string|null, next: JourneyDay|null }}
 */
export function journey({ crs, at, date, timetables, dates, count = JOURNEY_TRAINS }) {
    /** @returns {JourneyDay} */
    const on = (/** @type {Date} */ d, /** @type {string} */ from, /** @type {number} */ n) => {
        const timetable = timetableOn(d, dates);
        const rows = timetables[timetable.side][dayKindOf(d)].dep;
        return { date: d, timetable, trains: departures(rows, crs, d, from).slice(0, n),
            total: departures(rows, crs, d, '03:00').length, via: viaMatters(rows, crs) };
    };
    const day = on(date, at ?? '03:00', count);
    return { ...day, at, next: day.trains.length ? null : on(addDays(date, 1), '03:00', 1) };
}
