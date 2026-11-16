// @ts-check
/**
 * trains-cards.js — paints each card of trains.html from the page's state: the overview, the changes
 * list, the time lookup, the station picker and card, Last trains and the stopping grid.
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
import { parseTypedTime, daysUntil, timetablePhase, dateWords, railwayToday, JOURNEY_PLANNER_URL } from './trains-change.js';
import { stationView, busiestStations, matchStations, stoppingGrid, stopsKnown, stationBands, lastTrains } from './trains-stations.js';
import { headlineChanges } from './trains-headlines.js';
import { renderHeadlines, renderStation, renderGrid, renderLookup as lookupHtml, renderTotals, renderPicks, renderLastTrains, DAYTIME, DAY_NAMES,
    leadWords, renderFurtherChanges } from './trains-render.js';

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
 * @property {boolean} pickerOpen    the station search and chips are on screen (always, until a station is chosen)
 * @property {number|null} gridCol   the grid column whose stops alone are shown
 */

/** Whether every December train carries its stops — true since v24.80, when Chiltern's December books were parsed; false from a stopless source. */
export const DEC_STOPS_KNOWN = Object.values(TIMETABLES.dec).every(d => d.dep.every(stopsKnown) && d.arr.every(stopsKnown));
/** Where the page is in the timetable's life, read fresh each render (trains-app.js's header). */
export const phase = () => timetablePhase(railwayToday(), { change: CHANGE_DATE, festiveUntil: FURTHER_CHANGES_UNTIL, validUntil: DEC_VALID_UNTIL });
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
    el('trPartial')?.toggleAttribute('hidden', DEC_STOPS_KNOWN);
    // Chiltern's further changes are not in its books; the note, worded from their dates, goes once they end.
    const festive = el('trFestive');
    if (festive) { festive.hidden = !p.festive; setHTML(festive, renderFurtherChanges(CHANGE_DATE, FURTHER_CHANGES_UNTIL)); }
    setText('trOverviewHint', `What change${p.started ? 'd' : 's'} at Marylebone from ${dateWords(CHANGE_DATE)}`);
    const ended = el('trEnded');   // the journey planner as a link; the static words named Chiltern's
    if (ended) { ended.hidden = p.phase !== 'ended'; setHTML(ended, `<strong>Both timetables on this page have ended.</strong> Check <a href="${JOURNEY_PLANNER_URL}" target="_blank" rel="noopener noreferrer">the journey planner</a> for today’s trains.`); }
    setText('trGridNow', p.oldLabel);
    setText('trGridDec', p.newLabel);
}

/** The changes view: its list, the lookup, and the desktop's jump card. @param {PageState} state @param {ReturnType<typeof phase>} p */
export function renderChanges(state, p) {
    const day = TIMETABLES.now[state.day], dec = TIMETABLES.dec[state.day];
    setText('trChangesHint', `${DAY_NAMES[state.day]}, trains leaving Marylebone — biggest change first`);
    setHTML(el('trChanges'), renderHeadlines(HEADLINES.get(state.day) ?? HEADLINES.set(state.day, headlineChanges(day.dep, dec.dep, STATIONS)).get(state.day), { showAll: state.allHeads, partial: !dec.dep.every(stopsKnown) }));
    renderLookup(state);
    // The desktop's jump card (trains.css shows it from 1024px): the busiest stations, as the Stations tab offers them.
    setHTML(el('trJumpPicks'), renderPicks(busiestStations((p.started ? dec : day).dep), { typed: false, selected: state.station, stations: STATIONS, last: lsGet(LAST_STATION_KEY) }));
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
    setHTML(el('trStation'), renderStation(view, { stations: STATIONS, dir: state.sdir, showTrains: false, allTrains: state.allTrains,
        labels: { old: p.oldLabel, new: p.newLabel }, started: p.started, leafFall: leaf ? { minutes: LEAF_FALL.minutes, until: dateWords(LEAF_FALL.until) } : null }));
}

/** "What happens to the 17:15?" — trains-render.js writes the answer. @param {PageState} state */
export function renderLookup(state) {
    const typed = /** @type {HTMLInputElement|null} */ (el('trLookupInput'))?.value.trim() ?? '';
    const at = typed ? parseTypedTime(typed) : null;
    const p = phase();
    setHTML(el('trLookupResult'), !typed ? '' : !at ? '<p class="card-explainer tr-lead">Type a time like 17:15, 1715 or 5.15pm.</p>'
        : lookupHtml({ at, day: state.day, nowRows: TIMETABLES.now[state.day].dep, decRows: TIMETABLES.dec[state.day].dep,
            started: p.started, labels: { old: p.oldLabel, new: p.newLabel }, change: CHANGE_DATE, stations: STATIONS }));
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
