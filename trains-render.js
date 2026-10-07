// @ts-check
/**
 * trains-render.js — the Trains page's HTML, as strings, from trains-stations.js's answers.
 *
 * Pure: no DOM, no state. The coordinator (trains-app.js) decides WHAT to show and wires the
 * clicks; this decides how each answer reads. Kept apart so the coordinator stays a coordinator,
 * and so the words can be checked without a browser.
 *
 * ── FOR DUMMIES, AT A GLANCE ───────────────────────────────────────────────────────────────────
 *
 * Every view answers first and explains on tap (owner brief, 7 Oct 2026): a station card opens on
 * its one-sentence verdict, the basic hour is a single picture, and the changes list is sentences a
 * colleague can repeat to a customer. Station names, never codes; numbers people already use (trains
 * an hour, minutes past the hour, journey minutes, first and last train). Colour never carries a
 * meaning alone — every tone has its word.
 */

import { escapeHtml as esc } from './roster-data.js';
import { changeLabel, daysLabel } from './trains-change.js';
import { pairColumns, lineOf } from './trains-stations.js';

/** The short names the grid's column heads use. Anything not listed shows its full name. */
const SHORT = /** @type {Record<string, string>} */ ({
    BMO: 'Birmingham', BSW: 'Snow Hill', SBJ: 'Stourbridge', OXF: 'Oxford', HWY: 'Wycombe',
    AYS: 'Aylesbury', AVP: 'Parkway', BAN: 'Banbury', WRU: 'W Ruislip', GER: 'Gerrards X',
    PRR: 'Risborough', BIT: 'Bicester V', SAV: 'Stratford', LMS: 'Leamington', KGS: 'Kings Sutton',
});

const mm = (/** @type {number[]} */ ms) => ms.length ? ms.map(m => `:${String(m).padStart(2, '0')}`).join(' ') : '—';
const none = '<span class="tr-none"><span aria-hidden="true">—</span><span class="sr-only">none</span></span>';
/** A grid dot, with its meaning in words for a screen reader. @param {string} kind @param {string} words */
const dot = (kind, words) => `<span class="tr-dot${kind ? ` tr-dot--${kind}` : ''}" aria-hidden="true"></span><span class="sr-only">${words}</span>`;

/**
 * The ranked changes list.
 * @param {{ crs: string, tone: string, text: string }[]} items
 * @param {{ showAll: boolean, partial: boolean }} opts  partial: December's stops are not in yet
 * @returns {string}
 */
export function renderHeadlines(items, { showAll, partial }) {
    const shown = showAll ? items : items.slice(0, 5);
    const word = /** @type {Record<string, string>} */ ({ more: 'More', less: 'Less', moved: 'Moved' });
    const list = shown.length
        ? `<ul class="tr-heads">${shown.map(h => `<li><button type="button" class="tr-head" data-station="${esc(h.crs)}">`
            + `<span class="tr-chip tr-chip--${h.tone === 'more' ? 'new' : h.tone === 'less' ? 'gone' : 'moved'}">${esc(word[h.tone] ?? '')}</span>`
            + `<span class="tr-head-text">${esc(h.text)}</span><span class="tr-head-go" aria-hidden="true">›</span></button></li>`).join('')}</ul>`
        : '<p class="card-explainer tr-lead">No big changes found for this day.</p>';
    const more = !showAll && items.length > shown.length
        ? `<button type="button" class="tr-more" id="trHeadsMore">Show all ${items.length} changes</button>` : '';
    const note = partial
        ? '<p class="card-explainer tr-note">Only the stations at the end of a line can be compared yet. The rest appear here once Chiltern publishes December’s stops.</p>'
        : '';
    return list + more + note;
}

/**
 * Where one train goes beyond (or comes from before) the station on screen, as few words as a phone
 * row can hold. On a line that runs on (`LINES`), the onward stop's short name — "on to Parkway" —
 * because "to Aylesbury Vale Parkway" wrapped onto three lines on every train that runs on.
 * @param {string|undefined} to       the train's end
 * @param {string} crs                the station on screen
 * @param {Readonly<Record<string, string>>} stations
 * @param {boolean} leaving
 * @returns {string}  '' when the train ends here
 */
export function endWords(to, crs, stations, leaving) {
    if (!to || to === crs) return '';
    const line = lineOf(crs);
    const onward = line && line.onward.find(o => o.station === to);
    if (onward) return `${leaving ? 'on to' : 'from'} ${onward.short}`;
    return `${leaving ? 'to' : 'from'} ${stations[to] ?? to}`;
}

/**
 * One station's card body. The train list shows the trains that CHANGE; the ones that stay the same
 * are one tap away, counted, so the few real changes are not buried under rows of "No change".
 * @param {ReturnType<typeof import('./trains-stations.js').stationView>} view
 * @param {{ stations: Readonly<Record<string, string>>, dir: 'dep'|'arr', showTrains: boolean, allTrains?: boolean }} ctx
 *   showTrains: the list starts open · allTrains: the unchanged trains are shown too
 * @returns {string}
 */
export function renderStation(view, { stations, dir, showTrains, allTrains = false }) {
    const { now, dec } = view;
    const leaving = dir === 'dep';
    const cell = (/** @type {string|number|null|undefined} */ v) => (v === null || v === undefined || v === '') ? none : esc(String(v));
    const decCell = (/** @type {(s: NonNullable<typeof dec>) => string|number|null} */ f) => dec ? cell(f(dec)) : none;
    const row = (/** @type {string} */ label, /** @type {string} */ a, /** @type {string} */ b) =>
        `<tr><th scope="row">${esc(label)}</th><td>${a}</td><td>${b}</td></tr>`;
    const journey = (/** @type {number|null} */ n) => n === null ? null : `${n} min`;
    const table = '<table class="tr-st-table"><thead><tr><th scope="col"><span class="sr-only">Figure</span></th>'
        + '<th scope="col">Now</th><th scope="col">From 13 Dec</th></tr></thead><tbody>'
        + row('Trains a day', cell(now.total), decCell(d => d.total))
        + row('Off-peak, trains an hour', cell(now.perHour), decCell(d => d.perHour))
        + row(leaving ? 'Leaves Marylebone at' : 'Gets into Marylebone at', cell(mm(now.minutes)), decCell(d => mm(d.minutes)))
        + row('Fastest journey', cell(journey(now.fastest)), decCell(d => journey(d.fastest)))
        + row(leaving ? 'First train' : 'First arrival', cell(now.first), decCell(d => d.first))
        + row(leaving ? 'Last train' : 'Last arrival', cell(now.last), decCell(d => d.last))
        + '</tbody></table>';
    const verdict = `<p class="tr-verdict tr-verdict--${view.verdict.tone}">${esc(view.verdict.text)}</p>`;
    const minutesNote = '<p class="card-explainer tr-note">Times past the hour are at Marylebone, between 10:00 and 16:00.'
        + (dec && dec.fastest === null && now.fastest !== null ? ' December journey times arrive with Chiltern’s published timetable.' : '') + '</p>';
    if (!view.trains) return verdict + table + minutesNote;
    const changed = view.trains.filter(t => t.kind !== 'same');
    const same = view.trains.length - changed.length;
    const shown = allTrains ? view.trains : changed;
    const trains = shown.map((t) => {
        const chip = t.kind === 'earlier' || t.kind === 'later' ? 'moved' : t.kind;
        const end = (/** @type {string|undefined} */ to) => {
            const words = endWords(to, view.crs, stations, leaving);
            return words ? `<span class="tr-days">${esc(words)}</span>` : '';
        };
        const days = t.now ? daysLabel(t.days) : '';
        return `<tr class="tr-row tr-row--${chip}"><td>${t.now ? esc(t.now) : none}${days ? `<span class="tr-days">${esc(days)}</span>` : ''}${t.now ? end(t.nowTo) : ''}</td>`
            + `<td>${t.dec ? esc(t.dec) : none}${t.dec ? end(t.decTo) : ''}</td>`
            + `<td><span class="tr-chip tr-chip--${chip}">${esc(changeLabel(t, stations, dir))}</span></td></tr>`;
    }).join('');
    const tally = changed.length
        ? `${changed.length} change${changed.length === 1 ? 's' : ''}, ${same} stay${same === 1 ? 's' : ''} the same`
        : `All ${same} stay the same`;
    const list = shown.length
        ? `<table class="tr-trains"><thead><tr><th scope="col">Now</th><th scope="col">From 13 Dec</th><th scope="col">What changes</th></tr></thead>`
            + `<tbody>${trains}</tbody></table>`
        : '<p class="card-explainer tr-lead">Every train keeps its time.</p>';
    const more = !allTrains && same
        ? `<button type="button" class="tr-more" id="trAllTrains">Show the ${same} that stay${same === 1 ? 's' : ''} the same</button>` : '';
    return verdict + table + minutesNote
        + `<details class="tr-route"${showTrains || allTrains ? ' open' : ''}><summary class="tr-route-sum"><span class="tr-route-name">Train by train</span>`
        + `<span class="tr-route-what">${esc(tally)} · ${leaving ? 'leaving' : 'getting into'} Marylebone</span></summary>`
        + list + more + '</details>';
}

/**
 * The basic hour as a stopping-pattern grid. In the December view, a column paired with today's
 * marks a stop it gains (ring) and one it loses (hollow), each with words for a screen reader.
 * @param {ReturnType<typeof import('./trains-stations.js').stoppingGrid>} nowGrid
 * @param {ReturnType<typeof import('./trains-stations.js').stoppingGrid>} decGrid
 * @param {'now'|'dec'} mode
 * @param {Readonly<Record<string, string>>} stations
 * @returns {string}
 */
export function renderGrid(nowGrid, decGrid, mode, stations) {
    const grid = mode === 'now' ? nowGrid : decGrid;
    if (!grid.columns.length) return '<p class="card-explainer tr-lead">No train repeats every hour on this day.</p>';
    const paired = mode === 'dec' ? pairColumns(nowGrid.columns, decGrid.columns) : [];
    // December keeps today's row order, so flipping the toggle moves dots and never rows. A row is
    // shown when a December train stops there, or when a train it can be compared with stopped there
    // and no longer does — never for a column whose December stops are still unknown.
    const want = new Set(mode === 'dec'
        ? [...grid.stations, ...paired.flatMap((p, i) => p && grid.columns[i].known ? p.calls : [])]
        : grid.stations);
    const rowsOrder = [...nowGrid.stations, ...grid.stations].filter((s, i, all) => want.has(s) && all.indexOf(s) === i);
    const head = '<tr><th scope="col" class="tr-grid-st">Station</th>' + grid.columns.map(c =>
        `<th scope="col"><span class="tr-grid-min">:${String(c.minute).padStart(2, '0')}</span>`
        + `<span class="tr-grid-end">${esc(SHORT[c.end] ?? stations[c.end] ?? c.end)}</span></th>`).join('') + '</tr>';
    const origin = '<tr class="tr-grid-origin"><th scope="row" class="tr-grid-st">London Marylebone</th>'
        + grid.columns.map(() => `<td>${dot('', 'stops')}</td>`).join('') + '</tr>';
    const body = rowsOrder.map(crs => `<tr><th scope="row" class="tr-grid-st">${esc(stations[crs] ?? crs)}</th>`
        + grid.columns.map((c, i) => {
            const here = c.calls.includes(crs);
            const before = paired[i];
            if (mode === 'dec' && c.known && before) {
                const was = before.calls.includes(crs);
                if (here && !was) return `<td>${dot('new', 'new stop')}</td>`;
                if (!here && was) return `<td>${dot('lost', 'no longer stops')}</td>`;
            }
            return here ? `<td>${dot('', 'stops')}</td>` : '<td></td>';
        }).join('') + '</tr>').join('');
    const unknown = mode === 'dec' && grid.columns.some(c => !c.known)
        ? '<p class="card-explainer tr-note">December’s stops are not published yet, so for now each December column shows only where that train ends.</p>'
        : '';
    const key = mode === 'dec' && grid.columns.some(c => c.known)
        ? '<ul class="tr-grid-key"><li><span class="tr-dot" aria-hidden="true"></span> stops</li><li><span class="tr-dot tr-dot--new" aria-hidden="true"></span> new stop</li><li><span class="tr-dot tr-dot--lost" aria-hidden="true"></span> no longer stops</li></ul>'
        : '';
    const swipe = grid.columns.length > 4 ? '<p class="tr-grid-swipe touch-only">Swipe the table sideways for more trains.</p>' : '';
    return unknown + key + swipe + `<div class="tr-grid-wrap"><table class="tr-grid"><thead>${head}</thead><tbody>${origin}${body}</tbody></table></div>`;
}
