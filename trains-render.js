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
import { changeLabel, daysLabel, PATTERN_HOURS, compareRoutes, trainsNear, routeName, routeKey, LINES, lineDepth, dateWords, NEAR_WINDOW_MIN, serviceMinutes, holidaysWithin,
    JOURNEY_PLANNER_URL, minsWords, monthWords } from './trains-change.js';
import { pairColumns, lineOf, orderStations, stopChanges, parseStops } from './trains-stations.js';
import { aRealDay, weekdayGroups, weekdayWords, WEEKDAYS, runsOn } from './trains-weekdays.js';
import { minutesWords, hourNote, hourWords, andList } from './trains-verdict.js';
import { CHANGE_DATE } from './trains-data.js';

/** The three kinds of day in words, as the day tabs name them — one copy for every sentence that names one. */
export const DAY_NAMES = /** @type {Readonly<Record<'SX'|'SO'|'SU', string>>} */ (Object.freeze({ SX: 'Weekdays', SO: 'Saturdays', SU: 'Sundays' }));

/** The short names the grid's column heads use. Anything not listed shows its full name. */
const SHORT = /** @type {Record<string, string>} */ ({
    BMO: 'Birmingham', BSW: 'Snow Hill', SBJ: 'Stourbridge', OXF: 'Oxford', HWY: 'Wycombe',
    AYS: 'Aylesbury', AVP: 'Aylesbury Vale', BAN: 'Banbury', WRU: 'W Ruislip', GER: 'Gerrards X',
    PRR: 'Risborough', BIT: 'Bicester V', SAV: 'Stratford', LMS: 'Leamington', KGS: 'Kings Sutton',
});

/** The daytime window in words — "10:00 to 16:00" — from the constant, never typed. */
export const DAYTIME = `${String(PATTERN_HOURS.from).padStart(2, '0')}:00 to ${String(PATTERN_HOURS.to).padStart(2, '0')}:00`;

/** The two columns' names before the change, as `timetablePhase` gives them; the page always passes its own.
 *  Derived from the date, as every date on the page is: "From 13 Dec" was typed here. */
const DEFAULT_LABELS = Object.freeze({ old: 'Now', new: `From ${dateWords(CHANGE_DATE, 0, { short: true })}` });

/**
 * THE TIMES COME FROM TIMETABLES THAT HAVE ENDED (whole-app check, Nov 2026). Once December's books run out
 * (`timetablePhase` → 'ended'), the overview says both timetables have ended — and the lookup and the station
 * card went on answering from them in the present tense, "The 17:15 to Oxford: Same time as before 13 December".
 * So the two cards that answer a question say first where their times come from, with the planner one tap away,
 * as the overview's own line does (trains-cards.js → `renderOverview`).
 */
const ENDED_NOTE = '<p class="card-explainer tr-lead"><strong>These times come from timetables that have ended.</strong> '
    + `Check <a href="${JOURNEY_PLANNER_URL}" target="_blank" rel="noopener noreferrer">the journey planner</a> for today’s trains.</p>`;

/**
 * The changes view's name, in the tense of the change as the chips are (`changeLabel`): what is
 * coming, then what came. The tab, the card's title, the section, its `?` panel and its chevron all
 * go by it — only the tab and the title turned, so from 13 December a screen reader and the panel
 * went on saying "What’s changing" under a tab that said "What changed" (whole-app fix, Nov 2026).
 * @param {boolean} started
 * @returns {string}
 */
export const changesTitle = (started) => started ? 'What changed' : 'What’s changing';

/** How many headline changes show before "Show more"; Show more hands focus to the first one it revealed
 *  (trains-app.js → `refocus`), so the two read one number (whole-app review, 24 Nov 2026). */
export const HEADLINES_SHOWN = 5;

/** The note shown until the new timetable's stops are published, its month from the change date. */
export const partialStopsNote = () => `Where ${monthWords(CHANGE_DATE)}’s trains stop is not published yet, `
    + 'so each train is compared by where it ends. Through stations fill in when it is.';

/**
 * The overview's opening line, in the tense of the change: "This page compares today’s timetable with the
 * new one…" before it, "…the timetable that ran until…" from it. A sentence with a verb: "Today’s
 * timetable beside the new one that starts on…" was a caption, and read as one (words review, Nov 2026).
 * @param {string} change  'YYYY-MM-DD'
 * @param {boolean} started
 * @returns {string}
 */
export function leadWords(change, started) {
    const on = (/** @type {number} */ offset) => dateWords(change, offset, { weekday: true });
    return `This page compares ${started ? `the timetable that ran until ${on(-1)} with the new one, which started on` : 'today’s timetable with the new one that starts on'} ${on(0)}. `
        + 'Both are Chiltern’s published timetables, not live running information.';
}

/**
 * The note for the weeks after the change in which Chiltern says it will change times again
 * (`#trFestive`, shown until `FURTHER_CHANGES_UNTIL`). Its dates, and the holidays it names, come from
 * the two dates (`holidaysWithin`): it was typed into trains.html, so moving the dates for the next
 * books would have left it saying "13 December and 10 January" and "Christmas" in May.
 * @param {string} change  'YYYY-MM-DD'
 * @param {string} until   'YYYY-MM-DD', the last day of the further changes
 * @returns {string} HTML
 */
export function renderFurtherChanges(change, until) {
    const holidays = holidaysWithin(change, until);
    // Each date stays on one line, as the typed copy kept it with `&nbsp;`: generated with plain
    // spaces, "13 December" broke after the 13 on a 390px phone (whole-app check, Nov 2026).
    const together = (/** @type {string} */ words) => words.replace(/ /g, '&nbsp;');
    const when = `between ${together(dateWords(change))} and ${together(dateWords(until))}`;
    // It is the holidays' TIMES that are missing, not the holidays — and "changing times again" had no
    // "first time" before the change. The present tense holds on both sides of 13 December: an
    // arrangement before it, what is happening during it (words review, Nov 2026).
    return holidays
        ? `<strong>${esc(holidays)} times are not on this page.</strong> Chiltern is changing some times ${when}, most of all over the holidays.`
        : `<strong>Chiltern’s further changes are not on this page.</strong> Chiltern is changing some times ${when}.`;
}

/**
 * What the Trains sign-in card says (login-overlay.js → `about`): what the page is for, as every other
 * page's card says it (login-core.js). The line and link that sent a station computer to the staff PIN
 * went with the PIN (owner, 23 Nov 2026): only a member's own sign-in opens this page now.
 */
export const SIGN_IN_ABOUT = Object.freeze({
    // Its date is derived, and it holds in every phase — "before and after", not "what will change"
    // (words review, Nov 2026). The date holds together, as renderFurtherChanges's does: at 390px "13"
    // ended a line and "December" began the next.
    lines: Object.freeze([`Chiltern’s trains from Marylebone before and after the timetable change on ${dateWords(CHANGE_DATE).replace(' ', ' ')}: by station, by time, and where each train stops.`]),
});

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
 * the exception ("New route", "New times") — trains-stations.js writes all three. NOTHING IS
 * CLIPPED: the stations a new train also calls at are said in that detail and nowhere else on the
 * page, so a two-line clamp would have hidden a fact rather than depth.
 * @param {{ crs: string, tone: string, text: string, lead?: string, detail?: string, chip?: string }[]} items
 *   lead / detail / chip as `headlineChanges` returns them; a bare `text` renders as the lead alone
 * @param {{ showAll: boolean, partial: boolean }} opts  partial: December's stops are not in yet
 * @returns {string}
 */
export function renderHeadlines(items, { showAll, partial }) {
    const shown = showAll ? items : items.slice(0, HEADLINES_SHOWN);
    // The chip says what KIND of change, in words a reader can repeat: "More" alone asked "more what?".
    const word = /** @type {Record<string, string>} */ ({ more: 'More trains', less: 'Fewer trains', moved: 'New times' });
    const list = shown.length
        ? `<ul class="tr-heads">${shown.map(h => `<li><button type="button" class="tr-head" data-station="${esc(h.crs)}">`
            + `<span class="tr-chip tr-chip--${h.tone === 'more' ? 'new' : h.tone === 'less' ? 'gone' : 'moved'}">${esc(h.chip ?? word[h.tone] ?? '')}</span>`
            + `<span class="tr-head-text"><span class="tr-head-lead">${esc(h.lead ?? h.text)}</span>`
            + (h.detail ? `<span class="tr-head-detail">${esc(h.detail)}</span>` : '')
            + `</span><span class="tr-head-go" aria-hidden="true">›</span></button></li>`).join('')}</ul>`
        : '<p class="card-explainer tr-lead">No big changes found for this day.</p>';
    // "Show all 10 changes" read as the whole list, when every retimed train is on a station's card
    // instead (v24.83): say how many more LINES, and where the small changes are. A row is "a change",
    // as the `?` panel calls it: on a railway page, "choose a line" read as the Aylesbury line.
    const more = !showAll && items.length > shown.length
        ? `<button type="button" class="tr-more" id="trHeadsMore">Show ${items.length - shown.length} more</button>` : '';
    const small = items.length
        ? '<p class="card-explainer tr-note">The biggest changes only. A train a few minutes earlier or later is on its station’s card — choose a change above, or use Stations.</p>'
        : '';
    const note = partial
        ? `<p class="card-explainer tr-note">More stations appear here once Chiltern publishes where ${monthWords(CHANGE_DATE)}’s trains stop.</p>`
        : '';
    return list + more + small + note;
}

/**
 * Where one train goes beyond (or comes from before) the station on screen, as few words as a phone
 * row can hold. On a line that runs on (`LINES`), the onward stop's short name — "on to Aylesbury
 * Vale" — because "to Aylesbury Vale Parkway" wrapped onto three lines on every train that runs on.
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
 *   labels?: { old: string, new: string }, started?: boolean, ended?: boolean, leafFall?: { minutes: number, until: string }|null }} ctx
 *   showTrains: the list starts open · allTrains: the unchanged trains are shown too · labels: the two
 *   columns' names (`timetablePhase`) · started: the change has happened, for the tense of the chips and
 *   of the list's own words ("5 change" → "5 changed") · ended: both timetables have ended (`ENDED_NOTE`) ·
 *   leafFall: coming back on a line whose trains run early for leaf fall until `until`, the note to give
 * @returns {string}
 */
export function renderStation(view, { stations, dir, showTrains, allTrains = false, labels = DEFAULT_LABELS, started = false, ended = false, leafFall = null }) {
    const { ending } = view;
    const leaving = dir === 'dep';
    const name = stations[view.crs] ?? view.crs;
    // What the figures and the list are ABOUT: the whole station when December knows it; otherwise
    // only the trains that end here, labelled, so 36 trains are never taken for the full 37.
    const [now, dec, trains] = view.dec ? [view.now, view.dec, view.trains]
        : ending ? [ending.now, ending.dec, ending.trains] : [view.now, null, null];
    // Once both timetables have ended, the card says so before anything else (`ENDED_NOTE`).
    const endedNote = ended ? ENDED_NOTE : '';
    // The answer, then the rest of what changed (trains-verdict.js → `verdictFor`): a line each, quieter
    // than the answer, inside its accented box — so the cost of a gain is read with it, not found later.
    const also = (view.verdict.also ?? []).map(t => ` <span class="tr-verdict-also">${esc(t)}</span>`).join('');
    const verdict = `<p class="tr-verdict tr-verdict--${view.verdict.tone}">${esc(view.verdict.text)}${also}</p>`;
    // No direct train in the new timetable: the next step is the journey planner, which finds a route with
    // a change of train — "No direct trains" alone left a colleague with nothing to tell the customer
    // (words review, Nov 2026). Not once the books have ended: `ENDED_NOTE` already links it.
    const planner = dec && !dec.total && !ended
        ? `<p class="card-explainer tr-note">For a journey with a change of train, check <a href="${JOURNEY_PLANNER_URL}" target="_blank" rel="noopener noreferrer">the journey planner</a>.</p>`
        : '';
    // No train either side: the sentence is the whole answer. A table of noughts under "No change."
    // read as a service carrying on (v24.83).
    if (dec && !now.total && !dec.total) return endedNote + verdict + planner;
    const label = ending ? `<p class="tr-sub">${esc(leaving ? `Trains that end at ${name}` : `Trains that start at ${name}`)}</p>` : '';
    const throughNote = ending && ending.through > 0
        ? `<p class="card-explainer tr-note">${ending.through === 1 ? 'One other train a day calls' : `${ending.through} other trains a day call`} at ${esc(name)}`
            + `${leaving ? ` and ${ending.through === 1 ? 'runs' : 'run'} on past it` : ' on the way in'}. Those cannot be compared until Chiltern publishes where ${monthWords(CHANGE_DATE)}’s trains stop.</p>`
        : '';
    const cell = (/** @type {string|number|null|undefined} */ v) => (v === null || v === undefined || v === '') ? none : esc(String(v));
    // WHERE THE WEEKDAYS DISAGREE (trains-stations.js → `dayScope`): the figures are the real day's, and a
    // figure the other days have differently is small print beneath it — read aloud as "47 (Mon and Fri: 46)".
    const others = view.dec ? view.others ?? [] : [];
    const dayNotes = (/** @type {'now'|'dec'} */ side, /** @type {(s: import('./trains-stations.js').StationSummary) => string|number|null} */ f,
        /** @type {string|number|null} */ shown) => others.map((o) => {
        const v = f(o[side]);
        return v === null || v === '' || String(v) === String(shown) ? ''
            : `<span class="sr-only"> (</span><span class="tr-days">${esc(`${o.short}: ${v}`)}</span><span class="sr-only">)</span>`;
    }).join('');
    const nowCell = (/** @type {(s: import('./trains-stations.js').StationSummary) => string|number|null} */ f) => cell(f(now)) + dayNotes('now', f, f(now));
    const decCell = (/** @type {(s: NonNullable<typeof dec>) => string|number|null} */ f) => dec ? cell(f(dec)) + dayNotes('dec', f, f(dec)) : notKnown;
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
        + row('Trains a day', nowCell(s => s.total), decCell(d => d.total))
        + row('Daytime, trains an hour', hourCell(now) + dayNotes('now', hourWords, hourWords(now)), dec ? hourCell(dec) + dayNotes('dec', hourWords, hourWords(dec)) : notKnown)
        + row(`Daytime, leaves ${leaving ? 'Marylebone' : name} at`, nowCell(pastHour), decCell(pastHour))
        + row('Fastest journey', nowCell(s => journey(s.fastest)), decCell(d => journey(d.fastest)))
        + row('First train', nowCell(s => s.first), decCell(d => d.first))
        + row('Last train', nowCell(s => s.last), decCell(d => d.last))
        + '</tbody></table>';
    const minutesNote = '<p class="card-explainer tr-note">'
        + (leaving ? 'Times are when trains leave Marylebone.' : `Times are when trains leave ${esc(name)}; the small time under each is when it gets into Marylebone.`)
        + ` Daytime means ${DAYTIME}.`
        + (dec && dec.total && dec.fastest === null && now.fastest !== null ? ` ${monthWords(CHANGE_DATE)} journey times arrive with Chiltern’s published timetable.` : '') + '</p>';
    // Today's Amersham-line book is Chiltern's leaf-fall timetable and December's is not (trains-data.js,
    // LEAF_FALL): a few minutes' difference coming back may be the season, not the new timetable.
    const leafNote = leafFall && !leaving
        // "On this line" was untrue on Aylesbury's card, which holds trains via High Wycombe too, and
        // leaf fall itself went unexplained (words review, Nov 2026): the route is named, and what the
        // season is, in one clause.
        ? `<p class="card-explainer tr-note"><strong>Leaf fall:</strong> until ${esc(leafFall.until)}, trains to London via Amersham leave up to ${leafFall.minutes} minutes earlier than usual `
            + '(Chiltern’s autumn timetable: fallen leaves make the rails slippery, so these trains leave earlier to give them more time). '
            // Only a LATER December time can be the season: leaf fall moves today's trains earlier, so a
            // December train that is earlier still is a real change (v24.89, the 48-hour review — the
            // note said "a change of 3 minutes or less", and ten such earlier rows sat beneath it).
            // "Check the journey planner before 10 January" read as a deadline, and left out the 10th, the
            // last leaf-fall day — the note is still up on it (trains-cards.js).
            + `The ${esc(labels.old)} column includes that and the ${esc(labels.new)} column does not, so a train up to ${leafFall.minutes} minutes later in the ${esc(labels.new)} column may be leaf fall, not a real change. For trains up to and including ${esc(leafFall.until)}, check the journey planner.</p>`
        : '';
    if (!trains) return endedNote + verdict + planner + table + minutesNote + leafNote;
    const changed = trains.filter(t => t.kind !== 'same' || (/** @type {any} */ (t).farShift ?? 0) !== 0);
    const same = trains.length - changed.length;
    // When NOTHING changes, the unchanged trains are the list: "Every train keeps its time" with a second
    // button for Little Kimble's four rows was two taps to a list that had nothing to hide (words review,
    // Nov 2026).
    const whole = allTrains || !changed.length;
    const shown = whole ? trains : changed;
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
        // A train's days go under its time: today's, or — for a December train listed only on the days nothing
        // else carries it (`stationTrains`) — December's.
        const days = daysLabel(s.days);
        const nowT = s.nowAt ?? s.now, decT = s.decAt ?? s.dec;
        return `<tr class="tr-row tr-row--${chip}"><td>${nowT ? esc(nowT) : none}${s.now && days ? small(days) : ''}${nowT ? end(s.nowTo) : ''}${!leaving && s.nowIn ? small(`in ${s.nowIn}`) : ''}</td>`
            + `<td>${decT ? esc(decT) : none}${!s.now && days ? small(days) : ''}${decT ? end(s.decTo) : ''}${!leaving && s.decIn ? small(`in ${s.decIn}`) : ''}</td>`
            + `<td><span class="tr-chip tr-chip--${chip}">${esc(changeLabel(s, stations, dir, { started, withTime: false, here: view.crs }) + (quiet ? ' · may be leaf fall' : ''))}</span></td></tr>`;
    }).join('');
    // Never "0 stay the same": Amersham coming back read "38 change, 0 stay the same" (v24.83).
    // THE TENSE FOLLOWS THE CHANGE, as the chips beside it do (`changeLabel`): "5 change" until
    // 13 December read as a prediction for months after it had happened (whole-app fix, Nov 2026).
    const was = (/** @type {string} */ before, /** @type {string} */ after) => started ? after : before;
    const tally = (changed.length && !same ? (changed.length === 1 ? was('Its one train changes', 'Its one train changed') : `All ${changed.length} ${was('change', 'changed')}`)
        : changed.length ? `${changed.length} ${was(changed.length === 1 ? 'changes' : 'change', 'changed')}, ${same} ${was(same === 1 ? 'stays' : 'stay', 'stayed')} the same`
        : same === 1 ? was('Its one train stays the same', 'Its one train stayed the same') : `All ${same} ${was('stay', 'stayed')} the same`)
        + (leafFall && leafy ? ` · ${leafy} of them by ${leafFall.minutes} minute${leafFall.minutes === 1 ? '' : 's'} or less, which may be leaf fall` : '');
    const list = shown.length
        ? `<table class="tr-trains"><thead><tr><th scope="col">${esc(labels.old)}</th><th scope="col">${esc(labels.new)}</th><th scope="col">${was('What changes', 'What changed')}</th></tr></thead>`
            + `<tbody>${rowsHtml}</tbody></table>`
        : `<p class="card-explainer tr-lead">${was('Every train keeps its time.', 'Every train kept its time.')}</p>`;
    const more = !whole && same
        ? `<button type="button" class="tr-more" id="trAllTrains">Show the ${same} that ${was(same === 1 ? 'stays' : 'stay', 'stayed')} the same</button>` : '';
    // The figures and their notes are ONE block: on a desktop it is the left column beside the train list
    // (trains.css), and as separate grid items every note took the same cell, so the leaf-fall note was drawn
    // on top of the times note (whole-app check, Nov 2026). On a phone the block is ordinary flow.
    return endedNote + label + verdict + planner + `<div class="tr-st-figures">${table + minutesNote + leafNote + throughNote}</div>`
        + `<details class="tr-route"${showTrains || allTrains ? ' open' : ''}><summary class="tr-route-sum"><span class="tr-route-name">Train by train</span>`
        + `<span class="tr-route-what">${esc(tally)} · leaving ${esc(leaving ? 'Marylebone' : name)}</span></summary>`
        + list + more + '</details>';
}

/**
 * The basic hour as a stopping-pattern grid. A column is every daytime hour's train at that minute
 * (trains-stations.js, `stoppingGrid`): a full dot where all of them stop, a half dot where only some
 * do, and "4 of 6 hours" under a minute that does not run every hour. In the December view, a column
 * paired with today's marks a stop it gains (a ring with a plus) and one it loses (a ring struck
 * through), each with words for a screen reader — two SHAPES, because the green and the red were
 * 1.04:1 apart in lightness (trains.css → `.tr-dot--new`), and the `?` panel names them by shape too.
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
        `<th scope="col" class="tr-grid-colhead${col === i ? ' tr-col-on' : ''}"><button type="button" class="tr-grid-colbtn" data-col="${i}" aria-pressed="${col === i}">`
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
            ? `<tr class="tr-grid-band"><td colspan="${grid.columns.length + 1}"><span class="tr-grid-band-label">${esc(bands[b].label)}</span></td></tr>` : '';
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
        ? `<p class="card-explainer tr-note">${monthWords(CHANGE_DATE)}’s stops are not published yet, so for now each ${monthWords(CHANGE_DATE)} column shows only where that train ends.</p>`
        : '';
    const anySome = grid.columns.some(c => c.some.length);
    const compared = mode === 'dec' && grid.columns.some(c => c.known);
    const keyItem = (/** @type {string} */ kind, /** @type {string} */ words) =>
        `<li><span class="tr-dot${kind ? ` tr-dot--${kind}` : ''}" aria-hidden="true"></span> ${words}</li>`;
    const key = anySome || compared
        ? '<ul class="tr-grid-key">' + keyItem('', 'stops every hour') + (anySome ? keyItem('some', 'some hours only') : '')
            + (compared ? keyItem('new', 'new stop') + keyItem('lost', 'no longer stops') : '') + '</ul>'
        : '';
    // Drawn hidden, and shown only while the grid really scrolls sideways (trains-grid-mirror.js).
    const swipe = '<p class="tr-grid-swipe touch-only" hidden>Swipe the table sideways for more trains.</p>';
    // What the chosen column is, in words — and the way back. Discovery does not depend on the
    // buttons being found: when none is chosen, one line says what they do.
    const c = col === null ? null : grid.columns[col];
    const focusLine = c
        ? `<p class="tr-grid-focus">Only where the <strong>:${String(c.minute).padStart(2, '0')} to ${esc(routeName(stations, c.end, c.via))}</strong> stops. `
            + '<button type="button" class="tr-more" id="trGridAll">Show every station</button></p>'
        : '<p class="card-explainer tr-note tr-grid-tip">Choose a time at the top to show only where that train stops.</p>';
    return unknown + key + focusLine + swipe + `<div class="tr-grid-wrap" tabindex="0" role="region" aria-label="Where they stop — scrolls sideways"><table class="tr-grid"><thead>${head}</thead><tbody>${origin}${body}</tbody></table></div>`;
}

/** @typedef {import('./trains-change.js').TrainRow} TrainRow */

/**
 * The overview's totals: trains a day leaving Marylebone, one real day of each kind. A row a day under
 * one label (the polish of 2 Nov 2026): as one run-on line the three days wrapped mid-sequence on a
 * phone, a "+5 ·" stranded at a line's end. Each row reads, in order and as drawn, "Saturdays 100 →
 * 105 +5" — and the weekdays take a row for each kind of weekday when their counts differ
 * (trains-weekdays.js → `weekdayGroups`): "Mon and Fri 144 → 158 +14", "Tue to Thu 145 → 158 +13".
 * @param {{ now: Record<string, { dep: TrainRow[] }>, dec: Record<string, { dep: TrainRow[] }> }} timetables
 * @returns {string}
 */
export function renderTotals(timetables) {
    const total = (/** @type {string} */ label, /** @type {number} */ now, /** @type {number} */ dec) => {
        const delta = dec === now ? '' : ` <span class="tr-delta tr-delta--${dec > now ? 'up' : 'down'}">${dec > now ? '+' : '−'}${Math.abs(dec - now)}</span>`;
        return `<li class="tr-total"><span class="tr-total-day">${esc(label)}</span> <span class="tr-total-n">${now} → <strong>${dec}</strong></span>${delta}</li>`;
    };
    // A ROW FOR EACH KIND OF WEEKDAY, WHEN THEY DIFFER (external review, 18 Nov 2026): "Weekdays 145 → 158
    // +13" was a Tuesday to Thursday's, and a Monday or Friday has 144 and gains 14. One row when every
    // weekday agrees. Named as a train's days are marked beneath its time — "Mon and Fri", "Tue to Thu" —
    // because this is a box of figures, not a sentence: "Mondays and Fridays" needs 125px, and on a 320px
    // phone or under enlarged text it pushed the counts out of the day's 5.6em column (measured).
    const weekdays = weekdayGroups(timetables.now.SX.dep, timetables.dec.SX.dep, rows => rows.length);
    const cells = weekdays.map(g => total(weekdays.length > 1 ? weekdayWords(g.days, { short: true }) : DAY_NAMES.SX, g.now, g.dec)).join('')
        + /** @type {const} */ (['SO', 'SU']).map(d => total(DAY_NAMES[d], aRealDay(timetables.now[d].dep).length, aRealDay(timetables.dec[d].dep).length)).join('');
    return `<p class="field-eyebrow tr-totals-h">Trains a day leaving Marylebone</p><ul class="tr-totals-days">${cells}</ul>`;
}

/**
 * The station chips: what was typed matched, or the busiest stations — labelled, because eight names
 * with no label read as a random selection.
 * @param {string[]} offered
 * @param {{ typed: boolean, selected: string|null, stations: Readonly<Record<string, string>>, last?: string|null }} ctx
 *   last: the station this device looked at last, offered first before anything is typed (v24.94)
 * @returns {string}
 */
export function renderPicks(offered, { typed, selected, stations, last = null }) {
    if (!offered.length) return '<p class="card-explainer tr-lead">No station matches that.</p>';
    const chip = (/** @type {string} */ crs) => `<button type="button" class="tr-pick" data-station="${esc(crs)}" aria-pressed="${crs === selected}">${esc(stations[crs] ?? crs)}</button>`;
    // Before anything is typed, the station this device looked at last comes first, under its own
    // label (v24.94): a member asks about the same station again and again — their own commute, the
    // barrier's regulars — and it is one chip rather than a search. Never while typing: the matches
    // are the answer to what was typed. The label is "You looked at": on a page of train times,
    // "Last time" read as one (words review, Nov 2026).
    const remembered = !typed && last && stations[last] ? `<p class="tr-picks-label">You looked at</p>${chip(last)}` : '';
    return remembered + `<p class="tr-picks-label">${typed ? 'Matching stations' : 'Busiest stations'}</p>`
        + offered.filter(crs => !remembered || crs !== last).map(chip).join('');
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
 * @param {{ at: string, day: 'SX'|'SO'|'SU', nowRows: TrainRow[], decRows: TrainRow[], started: boolean, ended?: boolean,
 *   labels: { old: string, new: string }, change: string, stations: Readonly<Record<string, string>> }} o
 *   at: the parsed time · change: the change date, 'YYYY-MM-DD' · ended: both timetables have ended, so the
 *   answer opens by saying so (`ENDED_NOTE`)
 * @returns {string}
 */
export function renderLookup({ at, day, nowRows, decRows, started, ended = false, labels, change, stations }) {
    const near = trainsNear(nowRows, decRows, at);
    const from = dateWords(change), until = dateWords(change, -1);
    const rowOf = (/** @type {TrainRow[]} */ rows, /** @type {string|null} */ time, /** @type {string|undefined} */ end, /** @type {string|undefined} */ days = undefined) =>
        time ? rows.find(x => x[0] === time && x[1] === end && (days === undefined || x[3] === days)) : undefined;
    const named = (/** @type {{ station: string, via: string }} */ r, /** @type {string|undefined} */ to) =>
        to && to !== r.station ? stations[to] ?? to : routeName(stations, r.station, r.via);
    /** "A, B and C" — or, with `word`, "A, B or C". */
    const stopsWords = (/** @type {TrainRow|undefined} */ n, /** @type {TrainRow|undefined} */ d) => {
        // Across Aylesbury's two routes the route is the story. Asked of the ROUTE a train takes, not of
        // its row's code: one run on to Aylesbury Vale Parkway carries no code (onward stops have none)
        // but takes its line's, and compared by code the stops it dropped went unsaid (whole-app check,
        // Nov 2026). A train whose end moves to another line keeps the comparison, as it always did.
        const via = (/** @type {TrainRow} */ r) => LINES[routeKey(r)]?.via ?? r[2];
        if (!n || !d || via(n) !== via(d)) return '';
        const { lost, gained } = stopChanges(n, d);
        // "It does not stop at Haddenham & Thame Parkway and Kings Sutton" could be read as "not at
        // both" — as if it still stopped at one. It stops at neither, so the list takes "or".
        const bits = [...(lost.length ? [`no longer stops at ${andList(lost.map(c => stations[c] ?? c), 'or')}`] : []),
            ...(gained.length ? [`also stops at ${andList(gained.map(c => stations[c] ?? c))}`] : [])];
        return bits.length ? ` From ${from} it ${bits.join(', and ')}.` : '';
    };
    // When a train gets to its end. A kept train can leave on time and still arrive at a different
    // time — the 21:02 to Stourbridge gets there 6 minutes later — which the station cards say and
    // the lookup answered "No change" (v24.89, the 48-hour review).
    const arrives = (/** @type {TrainRow|undefined} */ r) => r ? parseStops(r).find(x => x.crs === r[1])?.time : undefined;
    const mins = minsWords;
    const lc = (/** @type {string} */ s) => s.charAt(0).toLowerCase() + s.slice(1);
    const pairs = compareRoutes(nowRows, decRows).flatMap(r => r.trains.map(t => ({ r, t })));
    const exact = pairs.filter(({ t }) => started
        ? t.dec === at && (t.kind !== 'rerouted' || t.side === 'new')
        : t.now === at && (t.kind !== 'rerouted' || t.side === 'old'));
    // A DECEMBER TRAIN IS NEW ON THE WEEKDAYS NOTHING BECAME IT (review of v26.60, Nov 2026). December's 17:41 to
    // Princes Risborough runs every weekday and was the 17:37 only Tuesday to Thursday: "Until 12 December it left
    // at 17:37 on Tuesday to Thursday" was all a Monday passenger read, where Princes Risborough's card lists it as
    // new on a Monday. So where today's trains that became one December train leave weekdays out, those days are
    // said. Two of today's trains become one December train only as a Monday-and-Friday version and its partner
    // (`foldWeekdayVariants`), which between them leave no weekday out, so the sentence is never said twice of one
    // train. A train new on every day already says so.
    const newOn = (/** @type {import('./trains-change.js').PairedTrain} */ t, /** @type {string} */ subject) => {
        // A December train new on every day is one pair with no days, which runs on all of them.
        const its = pairs.filter(({ t: p }) => p.dec === t.dec && p.decTo === t.decTo);
        const missing = WEEKDAYS.filter(w => !its.some(({ t: p }) => runsOn(p.days, w)));
        return missing.length ? ` On ${weekdayWords(missing)} ${subject} a new train.` : '';
    };
    const answer = exact.map(({ r, t }) => {
        const n = rowOf(nowRows, t.now, t.nowTo, t.days), d = rowOf(decRows, t.dec, t.decTo);
        const days = daysLabel(t.days);
        const a = arrives(n), b = arrives(d);
        const far = t.kind === 'same' && a && b ? serviceMinutes(b) - serviceMinutes(a) : 0;
        if (!started) {
            const when = t.kind === 'earlier' || t.kind === 'later' ? ` (${t.dec})` : '';
            const stops = stopsWords(n, d);
            const label = changeLabel(far ? { ...t, farShift: far } : t, stations, 'dep', { withTime: false });
            // A new end that comes with a new time says the time FIRST, the way a plain retime does
            // ("4 mins later (17:33)"): "Will end at Birmingham Moor Street, 16:41" read as arriving at
            // Moor Street at 16:41, when 16:41 is the new time it leaves Marylebone (words review, Nov 2026).
            const moved = t.shift && (t.kind === 'terminus' || t.kind === 'rerouted')
                ? `${mins(Math.abs(t.shift))} ${t.shift > 0 ? 'later' : 'earlier'} (${t.dec}), ${lc(label)}` : '';
            // "No change. From 13 December it also stops at Kings Sutton." contradicted itself in one
            // breath, while the Kings Sutton card called the same train "Will stop here": with a stop
            // changed, the TIME is what has not (v24.96, the 72-hour review).
            const head = moved || (label === 'No change' && stops ? 'Same time' : label);
            return `<p class="tr-answer"><strong>The ${esc(at)} to ${esc(named(r, t.nowTo))}${days ? ` (${esc(days)})` : ''}:</strong> `
                + `${esc(head)}${esc(when)}.${esc(stops)}</p>`;
        }
        // From the change, the same pairing read the other way: what the running train used to be.
        // The days in the cards' own words (trains-weekdays.js): typed here as "Tuesdays to Thursdays",
        // with a 'Wednesdays' for any code it did not know (words review, Nov 2026).
        const on = days ? ` on ${weekdayWords(WEEKDAYS.filter(w => runsOn(t.days, w)))}` : '';
        const o = t.other;
        // A new end that came with a new time keeps the old time too, as the before-change answer
        // does — "it ended at Birmingham Moor Street" of a train that was the 17:07 (v24.89).
        const was = t.kind === 'same' ? `Same time as before ${from}${on}${far ? `, but gets there ${mins(Math.abs(far))} ${far > 0 ? 'later' : 'earlier'} than it did` : ''}`
            : t.kind === 'earlier' || t.kind === 'later' ? `Until ${until} it left at ${t.now}${on}`
            : t.kind === 'new' ? `New from ${from}`
            : t.kind === 'terminus' ? `Until ${until}${on ? `,${on},` : ''} it ${t.shift ? `left at ${t.now} and ` : ''}${lineDepth(/** @type {string} */ (t.decTo)) > lineDepth(/** @type {string} */ (t.nowTo)) ? 'ended at' : 'went on to'} ${stations[/** @type {string} */ (t.nowTo)] ?? t.nowTo}`
            : o ? `Until ${until} this was the ${o.time} to ${routeName(stations, o.station, o.via)}` : `New from ${from}`;
        return `<p class="tr-answer"><strong>The ${esc(at)} to ${esc(named(r, t.decTo))}:</strong> ${esc(was)}.${esc(stopsWords(n, d))}${esc(newOn(t, 'it is'))}</p>`;
    }).join('');
    const adj = /** @type {Record<string, string>} */ ({ SX: 'weekday', SO: 'Saturday', SU: 'Sunday' })[day];
    // NO TRAIN AT THAT TIME IN THE RUNNING TIMETABLE — BUT ONE IN THE OTHER (words review, Nov 2026). Before
    // the change, 09:31 answered "No weekday train leaves at exactly 09:31" under a headline about the new
    // 09:31 to Stratford-upon-Avon. So the other timetable's train at that time is said next: from the
    // change, what it will be; after it, the mirror — what the train at that time was, and what became of it.
    // "In the current timetable", not "today’s": the day chosen above need not be today. "From 13 December",
    // never "From Sunday 13 December": on the Weekdays tab, a Sunday read as the wrong day.
    /** Where a train's end moves to, as a clause: ", and ends at Birmingham Moor Street". */
    const endMove = (/** @type {import('./trains-change.js').PairedTrain} */ t, /** @type {string} */ where) =>
        t.kind === 'rerouted' ? `, and runs to ${where}`
        : t.kind === 'terminus' ? `, and ${lineDepth(/** @type {string} */ (t.decTo)) > lineDepth(/** @type {string} */ (t.nowTo)) ? 'goes on to' : 'ends at'} ${where}` : '';
    const otherSide = answer ? [] : pairs.filter(({ t }) => started
        ? t.now === at && (t.kind !== 'rerouted' || t.side === 'old')
        : t.dec === at && (t.kind !== 'rerouted' || t.side === 'new')).map(({ r, t }) => {
        const days = daysLabel(t.days) ? ` (${daysLabel(t.days)})` : '';
        const o = t.other;
        if (!started) {
            if (t.kind === 'new' || !t.now) return `From ${from} the ${at} is a new train to ${named(r, t.decTo)}.`;
            // A rerouted train's old self is on another route: named from it, not from this one.
            const was = t.kind === 'rerouted' && o ? `${o.time} to ${routeName(stations, o.station, o.via)}` : `${t.now} to ${named(r, t.nowTo)}`;
            // The same December train's other weekdays, as the answer above says them (`newOn`).
            return `From ${from} the ${was}${days} leaves at ${at} instead${endMove(t, named(r, t.decTo))}.${newOn(t, `the ${at} is`)}`;
        }
        const was = `The ${at} to ${named(r, t.nowTo)}${days} ran until ${until}`;
        if (t.kind === 'gone' || !t.dec) return `${was}, and no longer runs.`;
        const to = t.kind === 'rerouted' && o ? routeName(stations, o.station, o.via) : named(r, t.decTo);
        return `${was}. From ${from} it leaves at ${t.dec} instead${endMove(t, to)}.`;
    });
    const noExact = answer ? '' : `<p class="card-explainer tr-lead">No ${adj} train leaves at exactly ${esc(at)}${started ? '' : ' in the current timetable'}.`
        + `${otherSide.map(w => ` ${esc(w)}`).join('')}</p>`;
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
    // A train's IDENTITY is its time, end and route; the days it runs are not part of it. December's
    // rows carry no weekday exception, so the Tue–Thu 17:33 to Snow Hill and its December self, which
    // runs every weekday, are one train — v24.94 keyed on the days too and marked that train "only in
    // this timetable" on BOTH sides (v24.96, the 72-hour review). Two identical lists — days included —
    // are shown ONCE and said to be the same, which a member was comparing them by eye to learn; where
    // they differ, a row whose identity the other side lacks is marked.
    const ident = (/** @type {TrainRow} */ r) => r.slice(0, 3).join('|');
    const key = (/** @type {TrainRow} */ r) => r.slice(0, 4).join('|');
    const onlyIn = (/** @type {TrainRow[]} */ rows, /** @type {TrainRow[]} */ other) =>
        new Set(rows.filter(r => !other.some(o => ident(o) === ident(r))).map(key));
    const same = near.now.length === near.dec.length && near.now.every((r, i) => key(r) === key(near.dec[i]));
    const list = (/** @type {TrainRow[]} */ rows, /** @type {Set<string>} */ only = new Set()) => rows.length
        ? `<ul class="tr-near">${rows.map((r) => { const [t, st, via, days] = r; const mark = only.has(key(r));
            return `<li${mark ? ' class="tr-near-only"' : ''}><span class="tr-near-time">${esc(t)}</span> ${where(st, via)}`
                + `${daysLabel(days) ? ` <span class="tr-days">${esc(daysLabel(days))}</span>` : ''}`
                + `${mark ? '<span class="sr-only"> — only in this timetable</span>' : ''}</li>`; }).join('')}</ul>`
        : '<p class="card-explainer tr-lead">No trains.</p>';
    const within = `${esc(DAY_NAMES[day])}, leaving within ${NEAR_WINDOW_MIN} minutes of ${esc(at)}`;
    const endedNote = ended ? ENDED_NOTE : '';
    if (same) {
        // "In both timetables": the two labels lower-cased read "the same trains until 12 dec and from 13 dec"
        // (words review, Nov 2026).
        return endedNote + answer + noExact
            + (near.now.length ? `<p class="card-explainer tr-lead">${within} — <strong>the same trains</strong> in both timetables:</p>`
                : `<p class="card-explainer tr-lead">${within}:</p>`)
            + `<div class="tr-near-cols tr-near-cols--one"><div>${list(near.now)}</div></div>`;
    }
    // The bar is said in words beneath the lists, not only to a screen reader: drawn alone, a navy edge and
    // bold type meant nothing to a colleague who had not read the `?` panel (words review, Nov 2026).
    const onlyNow = onlyIn(near.now, near.dec), onlyDec = onlyIn(near.dec, near.now);
    const barNote = onlyNow.size || onlyDec.size
        ? '<p class="card-explainer tr-note">A bar at the left marks a train in only one of the two lists: a new train, one that stops running, or one whose time or destination is different.</p>'
        : '';
    return endedNote + answer + noExact
        + `<p class="card-explainer tr-lead">${within}:</p>`
        + `<div class="tr-near-cols"><div><h3 class="tr-near-head">${esc(labels.old)}</h3>${list(near.now, onlyNow)}</div>`
        + `<div><h3 class="tr-near-head">${esc(labels.new)}</h3>${list(near.dec, onlyDec)}</div></div>` + barNote;
}

/**
 * "Last trains": every station's last train from Marylebone, before and after, for one kind of day
 * (v24.94). One row per station in the books' order, banded by line like the grid. December's time is
 * bold where it moved, with a chip saying by how much; "New" or "No train" where a side has none. A
 * station whose last train keeps its time is a quiet row, so the changes are what stand out.
 * @param {ReturnType<typeof import('./trains-stations.js').lastTrains>} rows
 * @param {{ stations: Readonly<Record<string, string>>, labels: { old: string, new: string },
 *   bands?: { label: string, stations: string[] }[], started?: boolean }} o
 *   started — the change has happened, for the tense of the chips' column heading
 * @returns {string}
 */
export function renderLastTrains(rows, { stations, labels, bands = [], started = false }) {
    if (!rows.length) return '<p class="card-explainer tr-lead">No trains.</p>';
    const mins = minsWords;
    const what = (/** @type {typeof rows[number]} */ r) => r.kind === 'new' ? '<span class="tr-chip tr-chip--new">New</span>'
        : r.kind === 'gone' ? '<span class="tr-chip tr-chip--gone">No train</span>'
        : r.kind === 'later' || r.kind === 'earlier' ? `<span class="tr-chip tr-chip--moved">${mins(/** @type {number} */ (r.shift))} ${r.kind}</span>` : '';
    const bandOf = (/** @type {string} */ crs) => bands.findIndex(b => b.stations.includes(crs));
    const banded = new Set(rows.map(r => bandOf(r.crs)).filter(i => i >= 0)).size > 1;
    // An empty cell is a dash to the eye and "none" to a screen reader, as on a station card: a bare "—"
    // was read aloud as "dash", or not at all (words review, Nov 2026).
    const dash = none;
    let lastBand = -1;
    const body = rows.map((r) => {
        const band = bandOf(r.crs);
        const head = banded && band >= 0 && band !== lastBand ? `<tr class="tr-last-band"><td colspan="4">${esc(bands[band].label)}</td></tr>` : '';
        if (band >= 0) lastBand = band;
        const dec = !r.dec ? dash : r.kind === 'same' ? esc(r.dec) : `<strong>${esc(r.dec)}</strong>`;
        return `${head}<tr><th scope="row">${esc(stations[r.crs] ?? r.crs)}</th><td>${r.now ? esc(r.now) : dash}</td><td>${dec}</td><td>${what(r)}</td></tr>`;
    }).join('');
    return `<table class="tr-last"><thead><tr><th scope="col">Station</th><th scope="col">${esc(labels.old)}</th><th scope="col">${esc(labels.new)}</th>`
        // The chips' column is headed on screen as Train by train's is (words review, Nov 2026): unheaded, a
        // "4 mins later" chip did not say WHICH last train moved, the old one or the new.
        + `<th scope="col">${started ? 'What changed' : 'What changes'}</th></tr></thead><tbody>${body}</tbody></table>`;
}
