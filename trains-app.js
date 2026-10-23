// @ts-check
/**
 * trains-app.js — coordinator for trains.html: what changes at Marylebone on 13 December 2026.
 *
 * Owns: the access gate, the session wiring, and which view is on screen — the day, the question
 * (what's changing / a station / where they stop) and the chosen station. Every judgement about the
 * timetables is `trains-change.js` and `trains-stations.js`; every word of HTML is `trains-render.js`;
 * the timetables themselves are the generated `trains-data.js`. Nothing here reads the network: once
 * opened, the page works offline.
 *
 * ── WHO IT IS FOR ──────────────────────────────────────────────────────────────────────────────
 *
 * Every signed-in member, since v24.81 (owner, 20 Oct 2026 — "make the trains page live for
 * everyone"); an admin preview from v24.71 while it was shaped. The sign-in is the app's ordinary
 * front door, not a boundary: the timetable is public information and `trains-data.js` is served to
 * anyone, like every module. Narrowing it again is one line in `auth-policy.js` and one flag in
 * `nav-panel.js`, which page-contract-parity requires to move together.
 *
 * And the station PIN, since v24.84 (owner, 22 Oct 2026), whose staff are the ones customers ask:
 * the policy's `staffPin` flag has the page ask `holdsStaffPin` before offering a sign-in, and every
 * other protected page still signs the PIN out on arrival (session.js → `reconcileExpiredIdentity`).
 *
 * ── TEACH THE CHANGE, NOT THE TIMETABLE ────────────────────────────────────────────────────────
 *
 * The page is read in the weeks BEFORE the change by staff who will be asked about it — "how do I
 * get to Gerrards Cross?", not "what is the 10:10's terminus?". So it is organised by the STATION a
 * customer is going to, answers in a sentence before it shows a table, and keeps the basic hour as
 * one picture, because that is the thing worth memorising (owner brief, 7 Oct 2026).
 *
 * ── OPEN ON THE ANSWERS (v24.92) ───────────────────────────────────────────────────────────────
 *
 * Measured on a Pixel 5 (393×727) before this release: the first headline began at 589px, under
 * 318px of overview prose and two rows of controls; a tap on a headline landed the answer at 421px,
 * under 266px of search box and station chips; the time lookup — the one thing needed with a
 * customer waiting — sat at 1,450px. So the overview opens collapsed from the second visit
 * (`OVERVIEW_SEEN_KEY`; its header says everything it still needs to, and the one caveat a member
 * must not miss moved to a line beneath the tabs), the station picker folds away once a station is
 * chosen (`pickerOpen`), and the lookup comes first — collapsed on a phone, so the list is still the
 * first thing read, and opening it puts the cursor in the box. The grid gained a column tap that
 * shows one train's stops alone (`gridCol`) and a fixed copy of its column heads (trains-grid-mirror.js).
 *
 * ── ON AND AFTER THE CHANGE ─────────────────────────────────────────────────────────────────────
 *
 * The page does not stop at 13 December. `timetablePhase` (trains-change.js) decides, from the clock,
 * what the first column is called ("Now", then "Until 12 Dec"), which timetable "the 17:15" means in
 * the lookup, and when both timetables have ended — read fresh on every render, so a page left open
 * over the change turns with it. Until v24.83 only the countdown chip knew the date.
 *
 * What comes after the preview — the teaching extras, and the at-a-glance page it becomes on
 * 13 December: docs/ROADMAP.md → "Trains page — what comes after the preview".
 */

import { CONFIG } from './roster-data.js';
import { lsGet, lsSet } from './ls.js';
import { initNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, ensureNamedSession, sessionReady, resolveSession, reconcileExpiredIdentity, holdsStaffPin, signOutStaffPin } from './session.js';
import { guardNamedSession, signOutAndLeave, reloadIfRestoredForSomeoneElse } from './page-session.js';
import { requirePage, canOpenOvertime, admitsStaffPin } from './auth-policy.js';
import { PIN_FIRST_HASH } from './calendar-access-core.js';
import { initCardCollapse } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { TIMETABLES, STATIONS, CHANGE_DATE, FURTHER_CHANGES_UNTIL, DEC_VALID_UNTIL, LEAF_FALL } from './trains-data.js';
import { CARD_TIPS } from './trains-tips.js';
import { parseTypedTime, daysUntil, timetablePhase, dateWords } from './trains-change.js';
import { stationView, busiestStations, matchStations, headlineChanges, stoppingGrid, stopsKnown, stationBands } from './trains-stations.js';
import { renderHeadlines, renderStation, renderGrid, renderLookup as lookupHtml, renderTotals, renderPicks, DAYTIME } from './trains-render.js';
import { syncGridMirror } from './trains-grid-mirror.js';

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

const DAY_NAMES = /** @type {Record<Day, string>} */ ({ SX: 'Weekdays', SO: 'Saturdays', SU: 'Sundays' });
/** Whether every December train carries its stops — true since v24.80, when Chiltern's December books were parsed; false from a stopless source. */
const DEC_STOPS_KNOWN = Object.values(TIMETABLES.dec).every(d => d.dep.every(stopsKnown) && d.arr.every(stopsKnown));
/** Where the page is in the timetable's life, read fresh each render (see the header). */
const phase = () => timetablePhase(new Date(), { change: CHANGE_DATE, festiveUntil: FURTHER_CHANGES_UNTIL, validUntil: DEC_VALID_UNTIL });
/** Set once the overview card has been on screen on this device: it opens collapsed from then on (v24.92). */
const OVERVIEW_SEEN_KEY = 'myb_trains_overview_seen';
/** The grid's two bands — the books' two lines — found from every row the page holds (trains-stations.js, `stationBands`). */
const BANDS = stationBands(Object.values(TIMETABLES).flatMap(t => Object.values(t).flatMap(d => [...d.dep, ...d.arr])));

/** Coordinator body, invoked by trains-boot.js. Exported so a test can import without running. */
export function init() {
    reloadIfRestoredForSomeoneElse();
    const currentUser = getSession()?.name ?? null;

    // Decided from the LOCAL session, as Operations and Overtime do — the auth store is often still
    // initialising here, and a role-gated page must not treat "pending" as "allowed".
    const access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'trains');
    if (access.decision === 'login') {
        // No member — but the station PIN reads this page too (v24.84), so ask for it BEFORE offering a
        // sign-in: a station PC is not shown one, and keeps the PIN it unlocked the Calendar with. The
        // policy decides whether to ask at all, so dropping its flag also signs the PIN out here again.
        const pin = admitsStaffPin('trains') ? holdsStaffPin() : reconcileExpiredIdentity().then(() => false);
        pin.then((held) => held ? start(null) : initLoginOverlay({
            pageLabel: 'Trains',
            // No session saved (iOS private mode can refuse the write): reload into a fresh sign-in.
            onSuccess: () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } },
        }));
        return;
    }
    if (access.decision === 'forbidden') {
        // Not reachable while the policy admits every member (v24.81). Kept so that a role added
        // back to the policy fails closed — back to the roster, quietly — rather than open.
        window.location.replace('./');
        return;
    }
    // Tear down a lingering privileged Firebase identity whose local session has expired.
    reconcileExpiredIdentity().catch(() => {});
    start(/** @type {string} */ (currentUser));
}

/**
 * The page, for a member — or, with `member` null, for the station PIN, which is nobody: no session
 * to establish or guard, no password to force, and the drawer's Lock where a member has Sign out.
 * @param {string|null} member
 */
function start(member) {
    dismissLoginOverlay();
    registerServiceWorker();
    if (member) {
        const established = ensureNamedSession(member);
        resolveSession(established);
        guardNamedSession({ page: 'trains', pageLabel: 'Trains', member, established });
    }
    const isAdmin = !!member && CONFIG.ADMIN_NAMES.includes(member);

    /** @type {any} */
    let openAboutLightbox = null;
    initNavPanel({
        authReady: member ? sessionReady : Promise.resolve(),
        currentPage: 'trains',
        memberName: member,
        isAdmin,
        isLinksDesigner: !!member && CONFIG.LINKS_DESIGNERS.includes(member),
        canOpenOvertime: canOpenOvertime(member),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut: member ? () => signOutAndLeave({ to: './' }) : null,
        onLockCalendar: member ? null : { isViewer: () => true, lock: lockStaffPin },
    });
    openAboutLightbox = initAboutLightbox();

    initTipsLightbox(CARD_TIPS, { getIsAdmin: () => isAdmin });
    const cards = Object.fromEntries(['trOverview', 'trChanges', 'trLookup', 'trStations', 'trPattern'].map(id => [id,
        // Opening the lookup — by its chevron or its header — puts the cursor in the box: that is what
        // a member opened it to do. `setOpen` runs the same callback, but only ever with `false` here.
        initCardCollapse(`${id}ToggleHeader`, `${id}Body`, `${id}Chevron`, id === 'trLookup' ? (/** @type {boolean} */ open) => { if (open) el('trLookupInput')?.focus(); } : undefined)]));
    // OPEN ON THE ANSWERS (the header). The overview is read once; from the next visit its header —
    // title, hint and the countdown chip — says everything it needs to, and the card opens collapsed.
    // Except when both timetables have ended: then its one message IS the card's, and must be seen.
    if (lsGet(OVERVIEW_SEEN_KEY) && phase().phase !== 'ended') cards.trOverview.setOpen(false);
    lsSet(OVERVIEW_SEEN_KEY, '1');
    // On a phone the lookup sits above the changes list and starts collapsed: its header says what it
    // is for, the list stays the first thing read, and the box is one tap away rather than two
    // screens. A desktop has the room, and keeps it open in its own column.
    if (window.matchMedia('(max-width: 1023px)').matches) cards.trLookup.setOpen(false);

    // Open on today's kind of day — what a member is most likely to be asked about.
    const dow = new Date().getDay();
    /** @type {PageState} */
    const state = { day: dow === 6 ? 'SO' : dow === 0 ? 'SU' : 'SX', view: 'changes', station: null, sdir: 'dep', grid: DEC_STOPS_KNOWN ? 'dec' : 'now',
        allHeads: false, allTrains: false, pickerOpen: true, gridCol: null };
    // The grid opens on TODAY until December's stops exist: a December grid of end stations alone read
    // as a broken page, and it was the first thing the tab showed (owner, 7 Oct 2026).

    renderOverview();
    wire(state);
    render(state);
    markPageReady();
    // A page left open overnight still turns the countdown — and, on the day, every label with it.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { renderOverview(); render(state); } });

    if (member) {
        sessionReady.then(() => {
            initErrorReporter();
            recordUsage('trains', member);
            recordPageLatency('trains', member);
        });
        sessionReady.then(() => initPasswordForce(member)).catch(() => {});
        return;
    }
    // The station PIN is already the current Firebase user (holdsStaffPin read it), and the rules take
    // these writes from it — so there is nothing to wait for, and no member to name in them.
    initErrorReporter();
    recordUsage('trains', null);
    recordPageLatency('trains', null);
}

/** The drawer's Lock for the station PIN: sign it out, then the Calendar's PIN card, as `lockCalendar` does. */
async function lockStaffPin() {
    await signOutStaffPin();
    window.location.replace('./' + PIN_FIRST_HASH);
}

// ── Renders ─────────────────────────────────────────────────────────────────────────────────────

/** The countdown chip, the opening line, the notes that depend on the date, and the three totals. */
function renderOverview() {
    const p = phase();
    setText('trCountdown', p.countdown);
    setText('trLead', p.started
        ? `The timetable that ran until ${dateWords(CHANGE_DATE, -1, { weekday: true })} beside the new one, which started on ${dateWords(CHANGE_DATE, 0, { weekday: true })}. Both are Chiltern’s published timetables, not live running information.`
        : `Today’s timetable beside the new one that starts on ${dateWords(CHANGE_DATE, 0, { weekday: true })}. Both are Chiltern’s published timetables, not live running information.`);
    setHTML(el('trTotals'), renderTotals(TIMETABLES));
    // The one caveat about missing stops, said once, here — and gone the day December's stops arrive.
    const partial = el('trPartial');
    if (partial) partial.hidden = DEC_STOPS_KNOWN;
    // Christmas and New Year are not in Chiltern's books; the note goes once its further changes end.
    const festive = el('trFestive');
    if (festive) festive.hidden = !p.festive;
    const ended = el('trEnded');
    if (ended) ended.hidden = p.phase !== 'ended';
    setText('trGridNow', p.oldLabel);
    setText('trGridDec', p.newLabel);
}

/** Everything that depends on the state: the pressed tabs, the visible view and its contents. @param {PageState} state */
function render(state) {
    for (const b of /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-day],[data-view],[data-sdir],[data-grid]')])) {
        const on = b.dataset.day ? b.dataset.day === state.day : b.dataset.view ? b.dataset.view === state.view
            : b.dataset.sdir ? b.dataset.sdir === state.sdir : b.dataset.grid === state.grid;
        b.setAttribute('aria-pressed', String(on));
    }
    for (const [view, id] of /** @type {[View, string][]} */ ([['changes', 'trViewChanges'], ['stations', 'trViewStations'], ['grid', 'trViewGrid']])) {
        const section = el(id);
        if (section) section.hidden = state.view !== view;
    }
    const day = TIMETABLES.now[state.day], dec = TIMETABLES.dec[state.day];
    if (state.view === 'changes') {
        setText('trChangesHint', `${DAY_NAMES[state.day]}, trains leaving Marylebone — biggest change first`);
        setHTML(el('trChanges'), renderHeadlines(headlineChanges(day.dep, dec.dep, STATIONS), { showAll: state.allHeads, partial: !dec.dep.every(stopsKnown) }));
        renderLookup(state);
    } else if (state.view === 'stations') {
        renderPicks_(state);
        renderStationCard(state);
    } else {
        // The day is named in the subtitle because the day tabs do not print (v24.83).
        setText('trPatternHint', `${DAY_NAMES[state.day]}: the trains that leave at the same minutes in most hours from ${DAYTIME}, and where each one stops`);
        setHTML(el('trPattern'), renderGrid(stoppingGrid(day.dep), stoppingGrid(dec.dep), state.grid, STATIONS, { focus: state.gridCol, bands: BANDS }));
    }
    // The fixed copy of the grid's column heads: rebuilt from whatever the grid now is — including
    // nothing, when another view is on screen (trains-grid-mirror.js).
    syncGridMirror(el('trPattern'));
}

/** The station chips alone — what typing in the station box changes. @param {PageState} state */
function renderPicks_(state) {
    const typed = /** @type {HTMLInputElement|null} */ (el('trStationInput'))?.value.trim() ?? '';
    // Equal matches go busiest first — on weekdays, so the station Enter opens does not change with the day chosen.
    const offered = typed ? matchStations(STATIONS, typed, 6, busiestStations(TIMETABLES.now.SX.dep, Infinity))
        : busiestStations(TIMETABLES.now[state.day].dep);
    setHTML(el('trStationPicks'), renderPicks(offered, { typed: !!typed, selected: state.station, stations: STATIONS }));
}

/** The chosen station's card. @param {PageState} state */
function renderStationCard(state) {
    const name = state.station ? STATIONS[state.station] ?? state.station : null;
    setText('trStationTitle', name ?? 'Stations');
    // The subtitle shows the journey the card is about, the way a departure board does — and the day,
    // which the day tabs cannot say on paper.
    setText('trStationHint', !name ? 'Where is the customer going, or coming back from?'
        : `${DAY_NAMES[state.day]} · ${state.sdir === 'dep' ? `London Marylebone → ${name}` : `${name} → London Marylebone`}`);
    // The search box and the chips are for FINDING a station; under a chosen one they fold away, and
    // "Change station" stands in their place (v24.92 — the answer sat 266px below the station's name).
    const folded = !!state.station && !state.pickerOpen;
    const picker = el('trStationPicker');
    if (picker) picker.hidden = folded;
    const change = el('trStationChange');
    if (change) change.hidden = !folded;
    const dirs = el('trStationDir');
    if (dirs) dirs.hidden = !state.station;
    if (!state.station) { setHTML(el('trStation'), '<p class="card-explainer tr-lead">Pick a station above, or start typing its name.</p>'); return; }
    const p = phase();
    const view = stationView(TIMETABLES.now[state.day][state.sdir], TIMETABLES.dec[state.day][state.sdir], state.station, state.sdir);
    const leaf = state.sdir === 'arr' && LEAF_FALL.stations.includes(state.station) && daysUntil(new Date(), LEAF_FALL.until) >= 0;
    setHTML(el('trStation'), renderStation(view, { stations: STATIONS, dir: state.sdir, showTrains: false, allTrains: state.allTrains,
        labels: { old: p.oldLabel, new: p.newLabel }, started: p.started, leafFall: leaf ? { minutes: LEAF_FALL.minutes, until: dateWords(LEAF_FALL.until) } : null }));
}

/** "What happens to the 17:15?" — trains-render.js writes the answer. @param {PageState} state */
function renderLookup(state) {
    const typed = /** @type {HTMLInputElement|null} */ (el('trLookupInput'))?.value.trim() ?? '';
    const at = typed ? parseTypedTime(typed) : null;
    const p = phase();
    setHTML(el('trLookupResult'), !typed ? '' : !at ? '<p class="card-explainer tr-lead">Type a time like 17:15, 1715 or 5.15pm.</p>'
        : lookupHtml({ at, day: state.day, nowRows: TIMETABLES.now[state.day].dep, decRows: TIMETABLES.dec[state.day].dep,
            started: p.started, labels: { old: p.oldLabel, new: p.newLabel }, change: CHANGE_DATE, stations: STATIONS }));
}

// ── Wiring ──────────────────────────────────────────────────────────────────────────────────────

/**
 * One delegated click handler for every tab and every station button, and the two text inputs — each
 * input redraws only its own panel, so a live region is not re-announced for every key (v24.83).
 * @param {PageState} state
 */
function wire(state) {
    let pushed = false;     // a station opened from the changes list has a Back entry (Android Back returns to the list)
    el('trainsMain')?.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest(
            'button[data-day],button[data-view],button[data-sdir],button[data-grid],button[data-station],button[data-col],#trHeadsMore,#trAllTrains,#trGridAll,#trStationChange'));
        if (!b) return;
        const was = state.view, scope = b.parentElement?.closest('[id]')?.id ?? '';
        // A column index names a train of one day's grid, so another day or the other timetable lets it go.
        if (b.dataset.day) { state.day = /** @type {Day} */ (b.dataset.day); state.gridCol = null; }
        if (b.dataset.view) state.view = /** @type {View} */ (b.dataset.view);
        if (b.dataset.sdir) state.sdir = /** @type {Dir} */ (b.dataset.sdir);
        if (b.dataset.grid) { state.grid = /** @type {'now'|'dec'} */ (b.dataset.grid); state.gridCol = null; }
        if (b.dataset.col) { const i = Number(b.dataset.col); state.gridCol = state.gridCol === i ? null : i; }
        if (b.id === 'trGridAll') state.gridCol = null;
        if (b.id === 'trHeadsMore') state.allHeads = true;
        if (b.id === 'trAllTrains') state.allTrains = true;
        if (b.id === 'trStationChange') {
            // Back to finding a station, from the start: the last search would otherwise still be
            // filtering the chips to the station already on screen.
            state.pickerOpen = true;
            const box = /** @type {HTMLInputElement|null} */ (el('trStationInput'));
            if (box) box.value = '';
        }
        if (b.dataset.station) {
            // A change in the list opens its station — the next question is always "and what else?" —
            // going there, whichever way the card last faced.
            state.station = b.dataset.station;
            state.allTrains = false;
            state.pickerOpen = false;
            state.view = 'stations';
            if (was !== 'stations') { state.sdir = 'dep'; history.pushState({ trains: 'station' }, ''); pushed = true; }
        }
        if (pushed && was === 'stations' && state.view !== 'stations') { pushed = false; history.back(); }
        render(state);
        if (b.dataset.station) {
            // The chip pressed has folded away with the picker, so focus goes to the station's name —
            // the answer to what was pressed — and the card comes into view when the list was on screen.
            if (was !== 'stations') el('trViewStations')?.scrollIntoView({ block: 'nearest' });
            el('trStationTitle')?.focus();
        } else if (b.id === 'trStationChange') {
            el('trStationInput')?.focus();
        } else refocus(b, scope);
    });
    window.addEventListener('popstate', (e) => {
        if (!pushed || /** @type {any} */ (e.state)?.trains === 'station') return;
        pushed = false;
        state.view = 'changes';
        render(state);
    });
    el('trLookupInput')?.addEventListener('input', () => renderLookup(state));
    el('trStationInput')?.addEventListener('input', () => renderPicks_(state));
    // Enter takes the first match — with one station left, it is the one meant.
    el('trStationInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') /** @type {HTMLElement|null} */ (el('trStationPicks')?.querySelector('button[data-station]') ?? null)?.click();
    });
}

/**
 * Keyboard focus after a redraw (v24.83): the button pressed was replaced, so focus fell to <body>
 * and the next Tab started again at the menu. Its new copy takes focus back; a button that went
 * (Show more…) hands it to what it revealed. Looked for in the area it was pressed in: a station has a
 * button in the hidden changes list as well as among the chips.
 * @param {HTMLElement} b
 * @param {string} scope  the id of the nearest identified ancestor it had
 */
function refocus(b, scope) {
    if (b.isConnected && document.activeElement === b) return;
    const sel = ['day', 'view', 'sdir', 'grid', 'station', 'col'].map(k => b.dataset[k] ? `[data-${k}="${b.dataset[k]}"]` : '').find(Boolean);
    const next = /** @type {HTMLElement|null} */ (sel ? el(scope)?.querySelector(sel) ?? null
        : b.id === 'trHeadsMore' ? document.querySelectorAll('#trChanges .tr-head')[5] ?? null
        : b.id === 'trAllTrains' ? document.querySelector('#trStation .tr-route-sum')
        : b.id === 'trGridAll' ? document.querySelector('#trPattern .tr-grid-wrap') : null);
    next?.focus();
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
function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
}

/** @param {string} id */
function el(id) { return document.getElementById(id); }
