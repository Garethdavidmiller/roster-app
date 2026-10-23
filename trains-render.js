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
import { changeLabel, daysLabel, PATTERN_HOURS, compareRoutes, trainsNear, routeName, lineDepth, dateWords, NEAR_WINDOW_MIN, serviceMinutes } from './trains-change.js';
import { pairColumns, lineOf, minutesWords, hourNote, hourWords, orderStations, stopChanges, aRealDay, parseStops } from './trains-stations.js';

/** The short names the grid's column heads use. Anything not listed shows its full name. */
const SHORT = /** @type {Record<string, string>} */ ({
    BMO: 'Birmingham', BSW: 'Snow Hill', SBJ: 'Stourbridge', OXF: 'Oxford', HWY: 'Wycombe',
    AYS: 'Aylesbury', AVP: 'Aylesbury Vale', BAN: 'Banbury', WRU: 'W Ruislip', GER: 'Gerrards X',
    PRR: 'Risborough', BIT: 'Bicester V', SAV: 'Stratford', LMS: 'Leamington', KGS: 'Kings Sutton',
});

/** The daytime window in words — "10:00 to 16:00" — from the constant, never typed. */
export const DAYTIME = `${String(PATTERN_HOURS.from).padStart(2, '0')}:00 to ${String(PATTERN_HOURS.to).padStart(2, '0')}:00`;

/** The two columns' names, from `timetablePhase`: "Now" until the change, "Until 12 Dec" after it. */
const DEFAULT_LABELS = Object.freeze({ old: 'Now', new: 'From 13 Dec' });

const none = '<span class="tr-none"><span aria-hidden="true">—</span><span class="sr-only">none</span></span>';
/** A December figure that cannot be known yet — a dash too, but never read aloud as "none". */
const notKnown = '<span class="tr-none"><span aria-hidden="true">—</span><span class="sr-only">not known yet</span></span>';
/** A grid dot, with its meaning in words for a screen reader. @param {string} kind @param {string} words */
const dot = (kind, words) => `<span class="tr-dot${kind ? ` tr-dot--${kind}` : ''}" aria-hidden="true"></span><span class="sr-only">${words}</span>`;

/**
 * The ranked changes list.
 *
 * A ROW IS A LEAD AND ITS DETAIL (v24.92). Every word of every row was bold and the chip said "More
 * trains" on seven rows of eight, so nothing stood out and the Aylesbury row ran to six lines on a
 * phone. Now the one clause a colleague repeats is the bold line, the figures and every further
 * clause sit beneath it in smaller, quieter type, and the chip carries the number ("+6 a day") or
 * the exception ("New route", "Times move") — trains-stations.js writes all three. NOTHING IS
 * CLIPPED: the stations a new train also calls at are said in that detail and nowhere else on the
 * page, so a two-line clamp would have hidden a fact rather than depth.
 * @param {{ crs: string, tone: string, text: string, lead?: string, detail?: string, chip?: string }[]} items
 *   lead / detail / chip as `headlineChanges` returns them; a bare `text` renders as the lead alone
 * @param {{ showAll: boolean, partial: boolean }} opts  partial: December's stops are not in yet
 * @returns {string}
 */
export function renderHeadlines(items, { showAll, partial }) {
    const shown = showAll ? items : items.slice(0, 5);
    // The chip says what KIND of change, in words a reader can repeat: "More" alone asked "more what?".
    const word = /** @type {Record<string, string>} */ ({ more: 'More trains', less: 'Fewer trains', moved: 'Times move' });
    const list = shown.length
        ? `<ul class="tr-heads">${shown.map(h => `<li><button type="button" class="tr-head" data-station="${esc(h.crs)}">`
            + `<span class="tr-chip tr-chip--${h.tone === 'more' ? 'new' : h.tone === 'less' ? 'gone' : 'moved'}">${esc(h.chip ?? word[h.tone] ?? '')}</span>`
            + `<span class="tr-head-text"><span class="tr-head-lead">${esc(h.lead ?? h.text)}</span>`
            + (h.detail ? `<span class="tr-head-detail">${esc(h.detail)}</span>` : '')
            + `</span><span class="tr-head-go" aria-hidden="true">›</span></button></li>`).join('')}</ul>`
        : '<p class="card-explainer tr-lead">No big changes found for this day.</p>';
    // "Show all 10 changes" read as the whole list, when every retimed train is on a station's card
    // instead (v24.83): say how many more LINES, and where the small changes are.
    const more = !showAll && items.length > shown.length
        ? `<button type="button" class="tr-more" id="trHeadsMore">Show ${items.length - shown.length} more</button>` : '';
    const small = items.length
        ? '<p class="card-explainer tr-note">The biggest changes only. A train a few minutes earlier or later is on its station’s card — tap a line, or use Stations.</p>'
        : '';
    const note = partial
        ? '<p class="card-explainer tr-note">More stations appear here once Chiltern publishes where December’s trains stop.</p>'
        : '';
    return list + more + small + note;
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
 *
 * Every time is when the passenger gets on (trains-stations.js → "Every time is where the passenger
 * gets on"): leaving Marylebone going there, leaving the station on the card coming back — and then
 * each train's time into Marylebone is the small print beneath it.
 * @param {ReturnType<typeof import('./trains-stations.js').stationView>} view
 * @param {{ stations: Readonly<Record<string, string>>, dir: 'dep'|'arr', showTrains: boolean, allTrains?: boolean,
 *   labels?: { old: string, new: string }, started?: boolean, leafFall?: { minutes: number, until: string }|null }} ctx
 *   showTrains: the list starts open · allTrains: the unchanged trains are shown too · labels: the two
 *   columns' names (`timetablePhase`) · started: the change has happened, for the tense of a new end ·
 *   leafFall: coming back on a line whose trains run early for leaf fall until `until`, the note to give
 * @returns {string}
 */
export function renderStation(view, { stations, dir, showTrains, allTrains = false, labels = DEFAULT_LABELS, started = false, leafFall = null }) {
    const { ending } = view;
    const leaving = dir === 'dep';
    const name = stations[view.crs] ?? view.crs;
    // What the figures and the list are ABOUT: the whole station when December knows it; otherwise
    // only the trains that end here, labelled, so 36 trains are never taken for the full 37.
    const [now, dec, trains] = view.dec ? [view.now, view.dec, view.trains]
        : ending ? [ending.now, ending.dec, ending.trains] : [view.now, null, null];
    const verdict = `<p class="tr-verdict tr-verdict--${view.verdict.tone}">${esc(view.verdict.text)}</p>`;
    // No train either side: the sentence is the whole answer. A table of noughts under "No change."
    // read as a service carrying on (v24.83).
    if (dec && !now.total && !dec.total) return verdict;
    const label = ending ? `<p class="tr-sub">${esc(leaving ? `Trains that end at ${name}` : `Trains that start at ${name}`)}</p>` : '';
    const throughNote = ending && ending.through > 0
        ? `<p class="card-explainer tr-note">${ending.through === 1 ? 'One other train a day calls' : `${ending.through} other trains a day call`} at ${esc(name)}`
            + `${leaving ? ` and ${ending.through === 1 ? 'runs' : 'run'} on past it` : ' on the way in'}. Those cannot be compared until Chiltern publishes where December’s trains stop.</p>`
        : '';
    const cell = (/** @type {string|number|null|undefined} */ v) => (v === null || v === undefined || v === '') ? none : esc(String(v));
    const decCell = (/** @type {(s: NonNullable<typeof dec>) => string|number|null} */ f) => dec ? cell(f(dec)) : notKnown;
    const row = (/** @type {string} */ label, /** @type {string} */ a, /** @type {string} */ b) =>
        `<tr><th scope="row">${esc(label)}</th><td>${a}</td><td>${b}</td></tr>`;
    const journey = (/** @type {number|null} */ n) => n === null ? null : `${n} min`;
    /** The typical hour, with its exception as small print beneath — read aloud as "2 (1 in some hours)". */
    const hourCell = (/** @type {import('./trains-stations.js').StationSummary} */ x) => {
        const note = hourNote(x);
        return note ? `${x.typical}<span class="sr-only"> (</span><span class="tr-days">${esc(note)}</span><span class="sr-only">)</span>` : esc(hourWords(x));
    };
    /** The minutes that repeat; "Varies" when trains run in the daytime but at no regular minute. */
    const pastHour = (/** @type {import('./trains-stations.js').StationSummary} */ x) =>
        x.minutes.length ? minutesWords(x.minutes) : x.hourRange[1] ? 'Varies' : null;
    const table = '<table class="tr-st-table"><thead><tr><th scope="col"><span class="sr-only">Figure</span></th>'
        + `<th scope="col">${esc(labels.old)}</th><th scope="col">${esc(labels.new)}</th></tr></thead><tbody>`
        + row('Trains a day', cell(now.total), decCell(d => d.total))
        + row('Daytime, trains an hour', hourCell(now), dec ? hourCell(dec) : notKnown)
        + row(`Daytime, leaves ${leaving ? 'Marylebone' : name} at`, cell(pastHour(now)), decCell(pastHour))
        + row('Fastest journey', cell(journey(now.fastest)), decCell(d => journey(d.fastest)))
        + row('First train', cell(now.first), decCell(d => d.first))
        + row('Last train', cell(now.last), decCell(d => d.last))
        + '</tbody></table>';
    const minutesNote = '<p class="card-explainer tr-note">'
        + (leaving ? 'Times are when trains leave Marylebone.' : `Times are when trains leave ${esc(name)}; the small time under each is when it gets into Marylebone.`)
        + ` Daytime means ${DAYTIME}.`
        + (dec && dec.total && dec.fastest === null && now.fastest !== null ? ' December journey times arrive with Chiltern’s published timetable.' : '') + '</p>';
    // Today's Amersham-line book is Chiltern's leaf-fall timetable and December's is not (trains-data.js,
    // LEAF_FALL): a few minutes' difference coming back may be the season, not the new timetable.
    const leafNote = leafFall && !leaving
        ? `<p class="card-explainer tr-note"><strong>Leaf fall:</strong> until ${esc(leafFall.until)}, trains to London on this line leave up to ${leafFall.minutes} minutes earlier than usual. `
            // Only a LATER December time can be the season: leaf fall moves today's trains earlier, so a
            // December train that is earlier still is a real change (v24.89, the 48-hour review — the
            // note said "a change of 3 minutes or less", and ten such earlier rows sat beneath it).
            + `The ${esc(labels.old)} column includes that and the ${esc(labels.new)} column does not, so a train up to ${leafFall.minutes} minutes later in the ${esc(labels.new)} column may only be leaf fall. Check the journey planner before ${esc(leafFall.until)}.</p>`
        : '';
    if (!trains) return verdict + table + minutesNote + leafNote;
    const changed = trains.filter(t => t.kind !== 'same' || (/** @type {any} */ (t).farShift ?? 0) !== 0);
    const same = trains.length - changed.length;
    const shown = allTrains ? trains : changed;
    const CHIP = /** @type {Record<string, string>} */ ({ earlier: 'moved', later: 'moved', terminus: 'rerouted', passes: 'gone', calls: 'new' });
    // Coming back on a leaf-fall line, a December time LATER by no more than the leaf-fall minutes may
    // be the season rather than the timetable — the note above the list says so — and nine of
    // Aylesbury's 42 rows coming back wore an amber chip for a shift of 3 minutes or less, among the
    // new trains and reroutes. Those rows read as quiet text that says why, and the tally counts
    // them, so the chips left on the list are the changes worth finding (v24.92; measured).
    // Never for a train via High Wycombe: leaf fall is the Amersham line's, and Aylesbury's card holds both.
    const mayBeLeaf = (/** @type {import('./trains-stations.js').StationTrain} */ t) =>
        !!leafFall && !leaving && t.kind === 'later' && (t.shift ?? 0) <= leafFall.minutes && t.via !== 'H';
    const leafy = changed.filter(mayBeLeaf).length;
    const rowsHtml = shown.map((t) => {
        const s = /** @type {import('./trains-stations.js').StationTrain} */ (t);
        // A train whose end moves is styled as a route change; one that stops or starts calling here
        // as a train lost or gained, because to this station that is what it is.
        const quiet = mayBeLeaf(s);
        const chip = quiet ? 'same' : CHIP[s.kind] ?? s.kind;
        const end = (/** @type {string|undefined} */ to) => {
            const words = endWords(to, view.crs, stations, leaving);
            return words ? `<span class="tr-days">${esc(words)}</span>` : '';
        };
        const small = (/** @type {string|undefined} */ txt) => txt ? `<span class="tr-days">${esc(txt)}</span>` : '';
        const days = s.now ? daysLabel(s.days) : '';
        const nowT = s.nowAt ?? s.now, decT = s.decAt ?? s.dec;
        return `<tr class="tr-row tr-row--${chip}"><td>${nowT ? esc(nowT) : none}${days ? small(days) : ''}${nowT ? end(s.nowTo) : ''}${!leaving && s.nowIn ? small(`in ${s.nowIn}`) : ''}</td>`
            + `<td>${decT ? esc(decT) : none}${decT ? end(s.decTo) : ''}${!leaving && s.decIn ? small(`in ${s.decIn}`) : ''}</td>`
            + `<td><span class="tr-chip tr-chip--${chip}">${esc(changeLabel(s, stations, dir, { started, withTime: false }) + (quiet ? ' · may be leaf fall' : ''))}</span></td></tr>`;
    }).join('');
    // Never "0 stay the same": Amersham coming back read "38 change, 0 stay the same" (v24.83).
    const tally = (changed.length && !same ? (changed.length === 1 ? 'Its one train changes' : `All ${changed.length} change`)
        : changed.length ? `${changed.length} change${changed.length === 1 ? 's' : ''}, ${same} stay${same === 1 ? 's' : ''} the same`
        : same === 1 ? 'Its one train stays the same' : `All ${same} stay the same`)
        + (leafFall && leafy ? ` · ${leafy} of them by ${leafFall.minutes} minute${leafFall.minutes === 1 ? '' : 's'} or less, which may be leaf fall` : '');
    const list = shown.length
        ? `<table class="tr-trains"><thead><tr><th scope="col">${esc(labels.old)}</th><th scope="col">${esc(labels.new)}</th><th scope="col">What changes</th></tr></thead>`
            + `<tbody>${rowsHtml}</tbody></table>`
        : '<p class="card-explainer tr-lead">Every train keeps its time.</p>';
    const more = !allTrains && same
        ? `<button type="button" class="tr-more" id="trAllTrains">Show the ${same} that stay${same === 1 ? 's' : ''} the same</button>` : '';
    return label + verdict + table + minutesNote + leafNote + throughNote
        + `<details class="tr-route"${showTrains || allTrains ? ' open' : ''}><summary class="tr-route-sum"><span class="tr-route-name">Train by train</span>`
        + `<span class="tr-route-what">${esc(tally)} · leaving ${esc(leaving ? 'Marylebone' : name)}</span></summary>`
        + list + more + '</details>';
}

/**
 * The basic hour as a stopping-pattern grid. A column is every daytime hour's train at that minute
 * (trains-stations.js, `stoppingGrid`): a full dot where all of them stop, a half dot where only some
 * do, and "4 of 6 hours" under a minute that does not run every hour. In the December view, a column
 * paired with today's marks a stop it gains (ring) and one it loses (hollow), each with words for a
 * screen reader.
 *
 * ONE TRAIN AT A TIME, AND THE TWO LINES NAMED (v24.92). On a phone the grid is 39 rows and four of
 * its seven columns, read two ways at once. Each column head is a button: pressed, the grid shows
 * only the stations that train stops at (and, in December's view, any it stopped at and no longer
 * does), so "does the :06 stop at Beaconsfield?" is answered down one short column. And the rows
 * are banded as the books divide them — the main line, then Aylesbury via Amersham — so the empty
 * region where one line's dots end reads as structure, not as a gap. Nothing is faded: the other
 * columns are left out, never dimmed (css-tokens.md → opacity on a group).
 * @param {ReturnType<typeof import('./trains-stations.js').stoppingGrid>} nowGrid
 * @param {ReturnType<typeof import('./trains-stations.js').stoppingGrid>} decGrid
 * @param {'now'|'dec'} mode
 * @param {Readonly<Record<string, string>>} stations
 * @param {{ focus?: number|null, bands?: { label: string, stations: string[] }[] }} [opts]
 *   focus — the index of the one column to show the stops of; bands — the row bands
 *   (trains-stations.js, `stationBands`); band rows are drawn only when more than one band has rows
 * @returns {string}
 */
export function renderGrid(nowGrid, decGrid, mode, stations, { focus = null, bands = [] } = {}) {
    const grid = mode === 'now' ? nowGrid : decGrid;
    if (!grid.columns.length) return '<p class="card-explainer tr-lead">No train leaves at the same minute in most daytime hours on this day.</p>';
    const paired = mode === 'dec' ? pairColumns(nowGrid.columns, decGrid.columns) : [];
    const col = focus !== null && focus >= 0 && focus < grid.columns.length ? focus : null;
    /** 'all', 'some' (only some of the column's hours stop there) or '' (none). */
    const stopsAt = (/** @type {{ calls: string[], some?: string[] }} */ c, /** @type {string} */ crs) =>
        !c.calls.includes(crs) ? '' : c.some?.includes(crs) ? 'some' : 'all';
    // December keeps today's row order, so flipping the toggle moves dots and never rows. A row is
    // shown when a December train stops there, or when a train it can be compared with stopped there
    // and no longer does — never for a column whose December stops are still unknown.
    const want = new Set(mode === 'dec'
        ? [...grid.stations, ...paired.flatMap((p, i) => p && grid.columns[i].known ? p.calls : [])]
        : grid.stations);
    // With one column chosen, only the rows it has something to say about.
    const inFocus = (/** @type {string} */ crs) => col === null || !!stopsAt(grid.columns[col], crs)
        || (mode === 'dec' && grid.columns[col].known && !!paired[col] && !!stopsAt(/** @type {any} */ (paired[col]), crs));
    const rowsOrder = orderStations([nowGrid.stations, grid.stations]).filter(s => want.has(s) && inFocus(s));
    const on = (/** @type {number} */ i) => col === i ? ' class="tr-col-on"' : '';
    const head = '<tr><th scope="col" class="tr-grid-st">Station</th>' + grid.columns.map((c, i) =>
        `<th scope="col"${on(i)}><button type="button" class="tr-grid-colbtn" data-col="${i}" aria-pressed="${col === i}">`
        + `<span class="tr-grid-min">:${String(c.minute).padStart(2, '0')}</span>`
        + `<span class="tr-grid-end">${esc(SHORT[c.end] ?? stations[c.end] ?? c.end)}</span>`
        // Two Aylesbury columns look alike until the route is named; the dots below agree with it.
        + (c.via === 'H' ? '<span class="tr-grid-via">via Wycombe</span>' : c.via === 'A' ? '<span class="tr-grid-via">via Amersham</span>' : '')
        + (c.hours < c.of ? `<span class="tr-grid-via">${c.hours} of ${c.of} hours</span>` : '')
        + `<span class="sr-only">${col === i ? ', showing only its stops' : ', show only its stops'}</span></button></th>`).join('') + '</tr>';
    const origin = '<tr class="tr-grid-origin"><th scope="row" class="tr-grid-st">London Marylebone</th>'
        + grid.columns.map((_, i) => `<td${on(i)}>${dot('', 'stops')}</td>`).join('') + '</tr>';
    const bandOf = (/** @type {string} */ crs) => bands.findIndex(b => b.stations.includes(crs));
    const banded = new Set(rowsOrder.map(bandOf).filter(i => i >= 0)).size > 1;
    let lastBand = -1;
    const body = rowsOrder.map((crs) => {
        const b = bandOf(crs);
        const band = banded && b >= 0 && b !== lastBand
            ? `<tr class="tr-grid-band"><td colspan="${grid.columns.length + 1}">${esc(bands[b].label)}</td></tr>` : '';
        if (b >= 0) lastBand = b;
        return band + `<tr><th scope="row" class="tr-grid-st">${esc(stations[crs] ?? crs)}</th>`
        + grid.columns.map((c, i) => {
            const td = (/** @type {string} */ inner) => `<td${on(i)}>${inner}</td>`;
            const here = stopsAt(c, crs);
            const before = paired[i];
            if (mode === 'dec' && c.known && before) {
                const was = stopsAt(before, crs);
                if (here && !was) return td(dot('new', here === 'some' ? 'new stop, some hours' : 'new stop'));
                if (!here && was) return td(dot('lost', 'no longer stops'));
                if (here === 'all' && was === 'some') return td(dot('', 'stops, now every hour'));
                if (here === 'some' && was === 'all') return td(dot('some', 'stops in some hours only, was every hour'));
            }
            return here === 'some' ? td(dot('some', 'stops in some hours')) : here ? td(dot('', 'stops')) : td('');
        }).join('') + '</tr>';
    }).join('');
    const unknown = mode === 'dec' && grid.columns.some(c => !c.known)
        ? '<p class="card-explainer tr-note">December’s stops are not published yet, so for now each December column shows only where that train ends.</p>'
        : '';
    const anySome = grid.columns.some(c => c.some.length);
    const compared = mode === 'dec' && grid.columns.some(c => c.known);
    const keyItem = (/** @type {string} */ kind, /** @type {string} */ words) =>
        `<li><span class="tr-dot${kind ? ` tr-dot--${kind}` : ''}" aria-hidden="true"></span> ${words}</li>`;
    const key = anySome || compared
        ? '<ul class="tr-grid-key">' + keyItem('', 'stops every hour') + (anySome ? keyItem('some', 'some hours only') : '')
            + (compared ? keyItem('new', 'new stop') + keyItem('lost', 'no longer stops') : '') + '</ul>'
        : '';
    const swipe = grid.columns.length > 4 ? '<p class="tr-grid-swipe touch-only">Swipe the table sideways for more trains.</p>' : '';
    // What the chosen column is, in words — and the way back. Discovery does not depend on the
    // buttons being found: when none is chosen, one line says what they do.
    const c = col === null ? null : grid.columns[col];
    const focusLine = c
        ? `<p class="tr-grid-focus">Only where the <strong>:${String(c.minute).padStart(2, '0')} to ${esc(routeName(stations, c.end, c.via))}</strong> stops. `
            + '<button type="button" class="tr-more" id="trGridAll">Show every station</button></p>'
        : '<p class="card-explainer tr-note tr-grid-tip">Tap a time at the top to show only where that train stops.</p>';
    return unknown + key + focusLine + swipe + `<div class="tr-grid-wrap" tabindex="0" role="region" aria-label="Where they stop — scrolls sideways"><table class="tr-grid"><thead>${head}</thead><tbody>${origin}${body}</tbody></table></div>`;
}

/** @typedef {import('./trains-change.js').TrainRow} TrainRow */

/**
 * The overview's totals line: trains a day leaving Marylebone, one real day of each kind (a weekday's
 * is a Tuesday to Thursday's — trains-stations.js, `aRealDay`). Each day's figure is kept on one line.
 * @param {{ now: Record<string, { dep: TrainRow[] }>, dec: Record<string, { dep: TrainRow[] }> }} timetables
 * @returns {string}
 */
export function renderTotals(timetables) {
    const words = /** @type {Record<string, string>} */ ({ SX: 'weekdays', SO: 'Saturdays', SU: 'Sundays' });
    return 'Trains a day leaving Marylebone: ' + ['SX', 'SO', 'SU'].map((d) => {
        const now = aRealDay(timetables.now[d].dep).length, dec = aRealDay(timetables.dec[d].dep).length;
        const delta = dec === now ? '' : ` <span class="tr-delta tr-delta--${dec > now ? 'up' : 'down'}">${dec > now ? '+' : '−'}${Math.abs(dec - now)}</span>`;
        return `<span class="tr-total">${words[d]} ${now} → <strong>${dec}</strong>${delta}</span>`;
    }).join(' · ');
}

/**
 * The station chips: what was typed matched, or the busiest stations — labelled, because eight names
 * with no label read as a random selection.
 * @param {string[]} offered
 * @param {{ typed: boolean, selected: string|null, stations: Readonly<Record<string, string>> }} ctx
 * @returns {string}
 */
export function renderPicks(offered, { typed, selected, stations }) {
    if (!offered.length) return '<p class="card-explainer tr-lead">No station matches that.</p>';
    return `<p class="tr-picks-label">${typed ? 'Matching stations' : 'Busiest stations'}</p>`
        + offered.map(crs => `<button type="button" class="tr-pick" data-station="${esc(crs)}" aria-pressed="${crs === selected}">${esc(stations[crs] ?? crs)}</button>`).join('');
}

/**
 * "What happens to the 17:15?" — the trains leaving near a typed time, before and after, and the one
 * asked about answered in a sentence first.
 *
 * Which train is "the 17:15" depends on WHICH TIMETABLE IS RUNNING: today's until the change, and
 * December's from it — until v24.83 it was always today's, so from 13 December a member typing a
 * train that ran said "No train leaves at exactly …". The answer names a train's days when it has
 * them (a Mondays-and-Fridays train and its partner read as two trains four minutes apart), the day
 * the member chose rather than "today", and the stops a kept train gains or loses on the way.
 * @param {{ at: string, day: 'SX'|'SO'|'SU', nowRows: TrainRow[], decRows: TrainRow[], started: boolean,
 *   labels: { old: string, new: string }, change: string, stations: Readonly<Record<string, string>> }} o
 *   at: the parsed time · change: the change date, 'YYYY-MM-DD'
 * @returns {string}
 */
export function renderLookup({ at, day, nowRows, decRows, started, labels, change, stations }) {
    const near = trainsNear(nowRows, decRows, at);
    const from = dateWords(change), until = dateWords(change, -1);
    const rowOf = (/** @type {TrainRow[]} */ rows, /** @type {string|null} */ time, /** @type {string|undefined} */ end, /** @type {string|undefined} */ days = undefined) =>
        time ? rows.find(x => x[0] === time && x[1] === end && (days === undefined || x[3] === days)) : undefined;
    const named = (/** @type {{ station: string, via: string }} */ r, /** @type {string|undefined} */ to) =>
        to && to !== r.station ? stations[to] ?? to : routeName(stations, r.station, r.via);
    const andList = (/** @type {string[]} */ ws) => ws.length < 2 ? (ws[0] ?? '') : `${ws.slice(0, -1).join(', ')} and ${ws[ws.length - 1]}`;
    const stopsWords = (/** @type {TrainRow|undefined} */ n, /** @type {TrainRow|undefined} */ d) => {
        if (!n || !d || n[2] !== d[2]) return '';             // across Aylesbury's two routes the route is the story
        const { lost, gained } = stopChanges(n, d);
        const bits = [...(lost.length ? [`does not stop at ${andList(lost.map(c => stations[c] ?? c))}`] : []),
            ...(gained.length ? [`also stops at ${andList(gained.map(c => stations[c] ?? c))}`] : [])];
        return bits.length ? ` From ${from} it ${bits.join(', and ')}.` : '';
    };
    // When a train gets to its end. A kept train can leave on time and still arrive at a different
    // time — the 21:02 to Stourbridge gets there 6 minutes later — which the station cards say and
    // the lookup answered "No change" (v24.89, the 48-hour review).
    const arrives = (/** @type {TrainRow|undefined} */ r) => r ? parseStops(r).find(x => x.crs === r[1])?.time : undefined;
    const mins = (/** @type {number} */ m) => `${m} min${m === 1 ? '' : 's'}`;
    const pairs = compareRoutes(nowRows, decRows).flatMap(r => r.trains.map(t => ({ r, t })));
    const exact = pairs.filter(({ t }) => started
        ? t.dec === at && (t.kind !== 'rerouted' || t.side === 'new')
        : t.now === at && (t.kind !== 'rerouted' || t.side === 'old'));
    const answer = exact.map(({ r, t }) => {
        const n = rowOf(nowRows, t.now, t.nowTo, t.days), d = rowOf(decRows, t.dec, t.decTo);
        const days = daysLabel(t.days);
        const a = arrives(n), b = arrives(d);
        const far = t.kind === 'same' && a && b ? serviceMinutes(b) - serviceMinutes(a) : 0;
        if (!started) {
            const when = t.kind === 'earlier' || t.kind === 'later' ? ` (${t.dec})` : '';
            return `<p class="tr-answer"><strong>The ${esc(at)} to ${esc(named(r, t.nowTo))}${days ? ` (${esc(days)})` : ''}:</strong> `
                + `${esc(changeLabel(far ? { ...t, farShift: far } : t, stations, 'dep'))}${esc(when)}.${esc(stopsWords(n, d))}</p>`;
        }
        // From the change, the same pairing read the other way: what the running train used to be.
        const on = days ? ` on ${days === 'Mon and Fri only' ? 'Mondays and Fridays' : days === 'Tue to Thu only' ? 'Tuesdays to Thursdays' : 'Wednesdays'}` : '';
        const o = t.other;
        // A new end that came with a new time keeps the old time too, as the before-change answer
        // does — "it ended at Birmingham Moor Street" of a train that was the 17:07 (v24.89).
        const was = t.kind === 'same' ? `Same time as before ${from}${on}${far ? `, but gets there ${mins(Math.abs(far))} ${far > 0 ? 'later' : 'earlier'} than it did` : ''}`
            : t.kind === 'earlier' || t.kind === 'later' ? `Until ${until} it left at ${t.now}${on}`
            : t.kind === 'new' ? `New from ${from}`
            : t.kind === 'terminus' ? `Until ${until}${on ? `,${on},` : ''} it ${t.shift ? `left at ${t.now} and ` : ''}${lineDepth(/** @type {string} */ (t.decTo)) > lineDepth(/** @type {string} */ (t.nowTo)) ? 'ended at' : 'went on to'} ${stations[/** @type {string} */ (t.nowTo)] ?? t.nowTo}`
            : o ? `Until ${until} this was the ${o.time} to ${routeName(stations, o.station, o.via)}` : `New from ${from}`;
        return `<p class="tr-answer"><strong>The ${esc(at)} to ${esc(named(r, t.decTo))}:</strong> ${esc(was)}.${esc(stopsWords(n, d))}</p>`;
    }).join('');
    const adj = /** @type {Record<string, string>} */ ({ SX: 'weekday', SO: 'Saturday', SU: 'Sunday' })[day];
    const noExact = answer ? '' : `<p class="card-explainer tr-lead">No ${adj} train leaves at exactly ${esc(at)}${started ? '' : ' in today’s timetable'}.</p>`;
    const where = (/** @type {string} */ st, /** @type {string} */ via) => {
        // A train that runs on past its line's station is named by the line, then where it goes on to —
        // "Birmingham Moor Street, on to Stourbridge": "Stourbridge Junction" alone reads as a train
        // that misses Birmingham.
        const line = lineOf(st);
        if (line && line.station !== st) {
            const on = endWords(st, line.station, stations, true);
            if (on) return `${esc(routeName(stations, line.station, via))} <span class="tr-near-on">${esc(on)}</span>`;
        }
        return esc(routeName(stations, st, via));
    };
    const list = (/** @type {TrainRow[]} */ rows) => rows.length
        ? `<ul class="tr-near">${rows.map(([t, st, via, days]) => `<li><span class="tr-near-time">${esc(t)}</span> ${where(st, via)}`
            + `${daysLabel(days) ? ` <span class="tr-days">${esc(daysLabel(days))}</span>` : ''}</li>`).join('')}</ul>`
        : '<p class="card-explainer tr-lead">No trains.</p>';
    const dayName = /** @type {Record<string, string>} */ ({ SX: 'Weekdays', SO: 'Saturdays', SU: 'Sundays' })[day];
    return answer + noExact
        + `<p class="card-explainer tr-lead">${esc(dayName)}, leaving within ${NEAR_WINDOW_MIN} minutes of ${esc(at)}:</p>`
        + `<div class="tr-near-cols"><div><h3 class="tr-near-head">${esc(labels.old)}</h3>${list(near.now)}</div>`
        + `<div><h3 class="tr-near-head">${esc(labels.new)}</h3>${list(near.dec)}</div></div>`;
}
