// @ts-check
/**
 * trains-cards.js — paints each card of trains.html from the page's state: the overview, the changes
 * list, Find a train (the one lookup: a station and a time, or a time alone), the station picker and card,
 * Last trains and the stopping grid.
 *
 * Split from trains-app.js, which keeps the page's STATE and its wiring — which view is on screen,
 * what a press changes, focus after a redraw. Here, each card reads the timetables through
 * trains-stations.js and trains-headlines.js, takes its words from trains-render.js, and is written
 * to the page; nothing here decides what is on screen or reads the network.
 *
 * Every painter reads `phase()` afresh, never a value kept from an earlier render, so a page left
 * open over the change turns with it (trains-app.js → "On and after the change"). And every HTML
 * write goes through `setHTML`, which skips an unchanged region, so a live region is not announced
 * again for a press that did not change it.
 */

import { lsGet, lsSet } from './ls.js';
import { TIMETABLES, STATIONS, CHANGE_DATE, FURTHER_CHANGES_UNTIL, DEC_VALID_UNTIL, LEAF_FALL } from './trains-data.js';
import { daysUntil, timetablePhase, dateWords, railwayToday, JOURNEY_PLANNER_URL } from './trains-change.js';
import { parseJourney, findStation, journeyDateAt, journey, isoDate } from './trains-journey.js';
import { stationView, busiestStations, matchStations, stoppingGrid, stopsKnown, stationBands, lastTrains } from './trains-stations.js';
import { headlineChanges } from './trains-headlines.js';
import { renderHeadlines, renderStation, renderGrid, renderLookup as lookupHtml, renderTotals, renderPicks, renderLastTrains, DAYTIME, DAY_NAMES,
    leadWords, renderFurtherChanges, partialStopsNote, renderJourney, renderNoStation } from './trains-render.js';

/** @typedef {'SX'|'SO'|'SU'} Day */
/** @typedef {'dep'|'arr'} Dir */
/** @typedef {'changes'|'stations'|'grid'} View */
/**
 * @typedef {object} PageState
 * @property {Day} day
 * @property {View} view
 * @property {string|null} station   the station on the Stations view
 * @property {Dir} sdir              going there, or coming back
 * @property {'now'|'dec'} grid      which basic hour the grid shows
 * @property {boolean} allHeads      the changes list expanded
 * @property {boolean} allTrains     a station's unchanged trains shown too
 * @property {boolean} showTrains    a station's "Train by train" list open — kept as the direction, day or station changes
 * @property {boolean} pickerOpen    the station search and chips are on screen (always, until a station is chosen)
 * @property {number|null} gridCol   the grid column whose stops alone are shown
 */

/** Whether every December train carries its stops — true since v24.80, when Chiltern's December books were parsed; false from a stopless source. */
export const DEC_STOPS_KNOWN = Object.values(TIMETABLES.dec).every(d => d.dep.every(stopsKnown) && d.arr.every(stopsKnown));
/** Where the page is in the timetable's life, read fresh each render (trains-app.js's header): from the railway day, and
 *  the countdown's words from the calendar date — the two differ for three hours after midnight (`timetablePhase`). */
export const phase = () => {
    const now = new Date();
    return timetablePhase(railwayToday(now), { change: CHANGE_DATE, festiveUntil: FURTHER_CHANGES_UNTIL, validUntil: DEC_VALID_UNTIL }, now);
};
/** The station this device looked at last: first among the chips, and what the page opens on once it opens on Stations. */
export const LAST_STATION_KEY = 'myb_trains_station';
/** The grid's two bands — the books' two lines — found from every row the page holds (trains-stations.js, `stationBands`). */
const BANDS = stationBands(Object.values(TIMETABLES).flatMap(t => Object.values(t).flatMap(d => [...d.dep, ...d.arr])));
/** The two whole-network answers, kept by day: they depend on nothing else, the tables never change while the page is
 *  open, and each was 40–75 ms of every press — on Stations, for a card that starts folded. */
const HEADLINES = new Map(), LAST = new Map();

/** The countdown chip, the opening line, the notes that depend on the date, and the three totals. @param {ReturnType<typeof phase>} p */
export function renderOverview(p) {
    setText('trCountdown', p.countdown);
    setText('trLead', leadWords(CHANGE_DATE, p.started));
    setHTML(el('trTotals'), renderTotals(TIMETABLES));
    // The one caveat about missing stops, said once, here — and gone the day December's stops arrive.
    const partial = el('trPartial');
    if (partial) { partial.toggleAttribute('hidden', DEC_STOPS_KNOWN); partial.textContent = partialStopsNote(); }
    // Chiltern's further changes are not in its books; the note, worded from their dates, goes once they end.
    const festive = el('trFestive');
    if (festive) { festive.hidden = !p.festive; setHTML(festive, renderFurtherChanges(CHANGE_DATE, FURTHER_CHANGES_UNTIL)); }
    // "What changed … from 13 December" read as a change still going on; it happened ON the day (words review, Nov 2026).
    setText('trOverviewHint', p.started ? `What changed at Marylebone on ${dateWords(CHANGE_DATE)}` : `What changes at Marylebone from ${dateWords(CHANGE_DATE)}`);
    const ended = el('trEnded');   // the journey planner as a link; the static words named Chiltern's
    if (ended) { ended.hidden = p.phase !== 'ended'; setHTML(ended, `<strong>Both timetables on this page have ended.</strong> Check <a href="${JOURNEY_PLANNER_URL}" target="_blank" rel="noopener noreferrer">the journey planner</a> for today’s trains.`); }
    setText('trGridNow', p.oldLabel);
    setText('trGridDec', p.newLabel);
}

/** The changes view: its list. @param {PageState} state */
export function renderChanges(state) {
    const day = TIMETABLES.now[state.day], dec = TIMETABLES.dec[state.day];
    setText('trChangesHint', `${DAY_NAMES[state.day]}, trains leaving Marylebone — biggest change first`);
    setHTML(el('trChanges'), renderHeadlines(HEADLINES.get(state.day) ?? HEADLINES.set(state.day, headlineChanges(day.dep, dec.dep, STATIONS)).get(state.day), { showAll: state.allHeads, partial: !dec.dep.every(stopsKnown) }));
}

/**
 * The journey box's station chips, under the box on a wide screen (trains.css shows them from 1024px): the busiest
 * stations of the timetable running, as the Stations tab offers them, each opening its station's card — what the
 * desktop's "Jump to a station" card did until the two lookups became one (Nov 2026).
 * @param {PageState} state @param {ReturnType<typeof phase>} p
 */
export function renderJump(state, p) {
    const run = TIMETABLES[p.started ? 'dec' : 'now'][state.day];
    setHTML(el('trJumpPicks'), renderPicks(busiestStations(run.dep), { typed: false, selected: state.station, stations: STATIONS, last: lsGet(LAST_STATION_KEY) }));
}

/** The stopping grid. The day is named in the subtitle because the day tabs do not print. @param {PageState} state */
export function renderPattern(state) {
    const day = TIMETABLES.now[state.day], dec = TIMETABLES.dec[state.day];
    setText('trPatternHint', `${DAY_NAMES[state.day]}: the trains that leave at the same minutes in most hours from ${DAYTIME}, and where each one stops`);
    setHTML(el('trPattern'), renderGrid(stoppingGrid(day.dep), stoppingGrid(dec.dep), state.grid, STATIONS, { focus: state.gridCol, bands: BANDS }));
}

/** The station chips alone — what typing in the station box changes. @param {PageState} state */
export function renderStationPicks(state) {
    const typed = /** @type {HTMLInputElement|null} */ (el('trStationInput'))?.value.trim() ?? '';
    // Equal matches go busiest first — on weekdays, so the station Enter opens does not change with the day chosen. Busiest
    // on the timetable RUNNING, as the chips are: counted on today's for good, they described a stopped one from 13 December.
    const run = TIMETABLES[phase().started ? 'dec' : 'now'];
    const offered = typed ? matchStations(STATIONS, typed, 6, busiestStations(run.SX.dep, Infinity)) : busiestStations(run[state.day].dep);
    setHTML(el('trStationPicks'), renderPicks(offered, { typed: !!typed, selected: state.station, stations: STATIONS, last: lsGet(LAST_STATION_KEY) }));
}

/** The Last trains card: every station's last train from Marylebone, now beside December, for the day chosen. @param {PageState} state */
export function renderLast(state) {
    const p = phase();
    setText('trLastHint', `${DAY_NAMES[state.day]}: the last train from Marylebone to every station`);
    setHTML(el('trLast'), renderLastTrains(LAST.get(state.day) ?? LAST.set(state.day, lastTrains(TIMETABLES.now[state.day].dep, TIMETABLES.dec[state.day].dep)).get(state.day),
        { stations: STATIONS, labels: { old: p.oldLabel, new: p.newLabel }, bands: BANDS, started: p.started }));
}

/** The chosen station's card. @param {PageState} state */
export function renderStationCard(state) {
    const name = state.station ? STATIONS[state.station] ?? state.station : null;
    setText('trStationTitle', name ?? 'Stations');
    // The subtitle shows the journey the card is about, the way a departure board does — and the day,
    // which the day tabs cannot say on paper.
    setText('trStationHint', !name ? 'Where is the customer going, or coming back from?'
        : `${DAY_NAMES[state.day]} · ${state.sdir === 'dep' ? `London Marylebone → ${name}` : `${name} → London Marylebone`}`);
    // The search box and the chips are for FINDING a station; under a chosen one they fold away, and
    // "Change station" stands in their place (the answer sat 266px below the station's name).
    const folded = !!state.station && !state.pickerOpen;
    const picker = el('trStationPicker');
    if (picker) picker.hidden = folded;
    const change = el('trStationChange');
    if (change) change.hidden = !folded;
    const dirs = el('trStationDir');
    if (dirs) dirs.hidden = !state.station;
    if (!state.station) { setHTML(el('trStation'), '<p class="card-explainer tr-lead">Pick a station above, or start typing its name.</p>'); return; }
    lsSet(LAST_STATION_KEY, state.station);   // remembered for the chips, and for where the page opens once it opens on Stations
    const p = phase();
    const view = stationView(TIMETABLES.now[state.day][state.sdir], TIMETABLES.dec[state.day][state.sdir], state.station, state.sdir, { change: CHANGE_DATE, started: p.started });
    const leaf = state.sdir === 'arr' && LEAF_FALL.stations.includes(state.station) && daysUntil(railwayToday(), LEAF_FALL.until) >= 0;
    setHTML(el('trStation'), renderStation(view, { stations: STATIONS, dir: state.sdir, showTrains: state.showTrains, allTrains: state.allTrains,
        labels: { old: p.oldLabel, new: p.newLabel }, started: p.started, ended: p.phase === 'ended',
        leafFall: leaf ? { minutes: LEAF_FALL.minutes, until: dateWords(LEAF_FALL.until) } : null }));
}

/**
 * A time with its a.m. or p.m. still to come: "5.15 ", "5 " (words review, Nov 2026). The answer the box
 * gave a keystroke ago stands until the tail is typed — "5 " otherwise put the hint, "Type a time like…",
 * up on the way to "5 pm" and the polite live region read it out. A tail begun, "5.15p" or "515a", is no
 * longer pending: it is a time (`parseTypedTime`), answered as one — kept pending, "5.15p" left the last
 * answer up beneath it indefinitely, a 05:15 one (24-hour check, 22 Nov 2026). Only an hour that CAN
 * take a.m. or p.m. (1 to 12): "17:15 " is not waiting for anything.
 * @param {string} raw  the box's value, untrimmed — a trailing space is part of the question
 * @returns {boolean}
 */
export function amPmPending(raw) {
    // The time may follow a station since the two lookups became one: "aylesbury 5 " waits as "5 " does.
    const m = String(raw).trimStart().match(/(?:^|[\s,])(\d{1,2})(?:[:.]?\d{2})?\s+$/);
    if (!m) return false;
    const h = Number(m[1]);
    return h >= 1 && h <= 12;
}

/** The day the lookup last answered for: a kept answer is kept only for the same day. @type {string|null} */
let lookupDay = null;
/** What the lookup last answered — the box, the day, the date and, for "the next train", the minute — so a redraw
 *  of the page that changes none of them is not worked out again (the time alone is 40–75 ms). @type {string} */
let lookupKey = '';

/** The dates the page's timetable switch turns on (`timetablePhase`). */
const DATES = Object.freeze({ change: CHANGE_DATE, festiveUntil: FURTHER_CHANGES_UNTIL, validUntil: DEC_VALID_UNTIL });

/** A time the box cannot read — alone, or after a station it found. */
const TIME_HINT = '<p class="card-explainer tr-lead">Type a time like 17:15, 1715 or 5.15pm.</p>';

/** A clock time as 'HH:MM'. @param {Date} d */
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * THE ONE LOOKUP (owner, Nov 2026: "bring the existing time and station lookups together"). One box takes where
 * the customer is going and, if they say, when — "Aylesbury, after 17:15" — and answers with the first train there
 * (trains-journey.js, trains-render.js → `renderJourney`). A TIME ALONE is answered as it always was, "what happens
 * to the 17:15?", the two timetables side by side for the day chosen (`lookupHtml`).
 *
 * The journey is for a DATE: today's railway day while the day chosen is today's kind, else the next date of the
 * kind chosen (`journeyDate`) — and from now, today, when no time is given. In the small hours a time typed that
 * has gone on the railway day is the next one to come (`journeyDateAt`): at 01:00, "after 08:00" is this morning's.
 *
 * "THE NEXT TRAIN" COUNTS THE MINUTE NOW: a train leaving at 17:30 is still the answer at 17:30:40 — it may be at
 * the platform — and is gone from 17:31:00, when the page's redraw comes on the minute (trains-app.js → `onEachMinute`).
 * @param {PageState} state
 */
export function renderLookup(state) {
    const raw = /** @type {HTMLInputElement|null} */ (el('trLookupInput'))?.value ?? '';
    const typed = raw.trim();
    const result = el('trLookupResult');
    // An a.m./p.m. still being typed keeps the answer on screen (`amPmPending`) — for the day it answered,
    // and only when there is one: a day tab pressed meanwhile, or a box empty until now, answers afresh.
    if (amPmPending(raw) && lookupDay === state.day && result?.innerHTML) return;
    lookupDay = state.day;
    const ask = parseJourney(typed);
    const now = new Date(), today = railwayToday(now);
    const date = journeyDateAt(now, state.day, ask.time);
    const isToday = isoDate(date) === isoDate(today);
    const p = phase();
    // The calendar date too: "today" and "tomorrow" are the calendar's (`dayWord`), and turn at midnight.
    const key = JSON.stringify([typed, state.day, isoDate(today), isoDate(now), isoDate(date), p.phase, ask.place && !ask.time && isToday ? hhmm(now) : '']);
    if (key === lookupKey) return;   // nothing it answers from has changed: the answer on screen stands
    lookupKey = key;
    if (!typed) { setHTML(result, ''); return; }
    if (!ask.place) {
        const at = ask.time;
        setHTML(result, !at ? TIME_HINT
            : lookupHtml({ at, day: state.day, nowRows: TIMETABLES.now[state.day].dep, decRows: TIMETABLES.dec[state.day].dep,
                started: p.started, ended: p.phase === 'ended', labels: { old: p.oldLabel, new: p.newLabel }, change: CHANGE_DATE, stations: STATIONS }));
        return;
    }
    // Equal matches go busiest first, on the timetable running, as the Stations tab's search orders them.
    const found = findStation(ask.place, STATIONS, busiestStations(TIMETABLES[p.started ? 'dec' : 'now'].SX.dep, Infinity));
    if (!found.crs) { setHTML(result, renderNoStation(ask.place, found.closest, STATIONS)); return; }
    if (ask.timeText && !ask.time) { setHTML(result, TIME_HINT); return; }
    const at = ask.time ?? (isToday ? hhmm(now) : null);
    const j = journey({ crs: found.crs, at, date, timetables: TIMETABLES, dates: DATES });
    setHTML(result, renderJourney(j, { crs: found.crs, stations: STATIONS, asked: ask.time ? 'time' : isToday ? 'now' : 'day', now,
        others: found.others, unused: found.unused }));
}

/** Whether the lookup's answer moves on with the minute: "the next train from now" — a station with no time — and, in the
 *  small hours, a station with a time, whose date turns once that time has passed (`journeyDateAt`). */
export function lookupFollowsClock() {
    const ask = parseJourney(/** @type {HTMLInputElement|null} */ (el('trLookupInput'))?.value ?? '');
    return !!ask.place && (!ask.timeText || new Date().getHours() < 3);
}

/**
 * "Or did you mean": a station chip under the answer puts that station in the box, keeping the time typed.
 * @param {string} crs
 */
export function chooseJourneyStation(crs) {
    const box = /** @type {HTMLInputElement|null} */ (el('trLookupInput'));
    if (!box || !STATIONS[crs]) return;
    const { timeText } = parseJourney(box.value);
    box.value = timeText ? `${STATIONS[crs]}, after ${timeText}` : STATIONS[crs];
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

/** Write HTML only when it changed, so an unchanged live region is not announced again. */
const lastHtml = new WeakMap();
/** @param {HTMLElement|null} node @param {string} html */
function setHTML(node, html) {
    if (!node || lastHtml.get(node) === html) return;
    lastHtml.set(node, html);
    node.innerHTML = html;
}

/** @param {string} id @param {string} text */
export function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
}

/** @param {string} id */
export function el(id) { return document.getElementById(id); }
