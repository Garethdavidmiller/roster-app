// @ts-check
/**
 * trains-app.js — coordinator for trains.html: what changes at Marylebone on 13 December 2026.
 *
 * Owns: the access gate, the session wiring, and which view is on screen — the day, the question
 * (what's changing / a station / the basic hour) and the chosen station. Every judgement about the
 * timetables is `trains-change.js` and `trains-stations.js`; every word of HTML is `trains-render.js`;
 * the timetables themselves are the generated `trains-data.js`. Nothing here reads the network: the
 * page works offline from its first open.
 *
 * ── WHO IT IS FOR, AND WHY IT IS GATED ─────────────────────────────────────────────────────────
 *
 * A PREVIEW for the admin while the page is shaped (owner, 7 Oct 2026), to become every member's
 * "Trains" page later. The gate is CLIENT UX, not a boundary: the timetable is public information
 * and `trains-data.js` is served to anyone, like every module. Opening it to staff is one line in
 * `auth-policy.js` and one flag in `nav-panel.js`, which page-contract-parity requires to move
 * together.
 *
 * ── TEACH THE CHANGE, NOT THE TIMETABLE ────────────────────────────────────────────────────────
 *
 * The page is read in the weeks BEFORE the change by staff who will be asked about it — "how do I
 * get to Gerrards Cross?", not "what is the 10:10's terminus?". So it is organised by the STATION a
 * customer is going to, answers in a sentence before it shows a table, and keeps the basic hour as
 * one picture, because that is the thing worth memorising (owner brief, 7 Oct 2026).
 *
 * What comes after the preview — the teaching extras, and the at-a-glance page it becomes on
 * 13 December: docs/ROADMAP.md → "Trains page — what comes after the preview".
 */

import { CONFIG, escapeHtml as esc } from './roster-data.js';   // esc: every innerHTML value goes through it
import { initNavPanel } from './nav-panel.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { getSession, ensureNamedSession, sessionReady, resolveSession, reconcileExpiredIdentity } from './session.js';
import { guardNamedSession, signOutAndLeave, reloadIfRestoredForSomeoneElse } from './page-session.js';
import { requirePage, canOpenOvertime } from './auth-policy.js';
import { initCardCollapse } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { TIMETABLES, STATIONS, CHANGE_DATE } from './trains-data.js';
import { CARD_TIPS } from './trains-tips.js';
import { compareRoutes, trainsNear, parseTypedTime, daysUntil, changeLabel, routeName } from './trains-change.js';
import { stationView, busiestStations, matchStations, headlineChanges, stoppingGrid, stopsKnown } from './trains-stations.js';
import { renderHeadlines, renderStation, renderGrid } from './trains-render.js';

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
 */

const DAY_NAMES = /** @type {Record<Day, string>} */ ({ SX: 'Weekdays', SO: 'Saturdays', SU: 'Sundays' });

/** Coordinator body, invoked by trains-boot.js. Exported so a test can import without running. */
export function init() {
    reloadIfRestoredForSomeoneElse();
    // Tear down a lingering privileged Firebase identity whose local session has expired.
    reconcileExpiredIdentity().catch(() => {});

    const currentUser = getSession()?.name ?? null;

    // Decided from the LOCAL session, as Operations and Overtime do — the auth store is often still
    // initialising here, and a role-gated page must not treat "pending" as "allowed".
    const access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'trains');
    if (access.decision === 'login') {
        initLoginOverlay({
            pageLabel: 'Trains',
            // No session saved (iOS private mode can refuse the write): reload into a fresh sign-in.
            onSuccess: () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } },
        });
        return;
    }
    if (access.decision === 'forbidden') {
        // A preview: a member who reached the URL goes back to the roster, quietly.
        window.location.replace('./');
        return;
    }
    const member = /** @type {string} */ (currentUser);
    dismissLoginOverlay();
    registerServiceWorker();

    const established = ensureNamedSession(member);
    resolveSession(established);
    guardNamedSession({ page: 'trains', pageLabel: 'Trains', member, established });

    /** @type {any} */
    let openAboutLightbox = null;
    initNavPanel({
        authReady: sessionReady,
        currentPage: 'trains',
        memberName: member,
        isAdmin: CONFIG.ADMIN_NAMES.includes(member),
        isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(member),
        canOpenOvertime: canOpenOvertime(member),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut: () => signOutAndLeave({ to: './' }),
    });
    openAboutLightbox = initAboutLightbox();

    initTipsLightbox(CARD_TIPS, { getIsAdmin: () => CONFIG.ADMIN_NAMES.includes(member) });
    for (const id of ['trOverview', 'trChanges', 'trLookup', 'trStations', 'trPattern']) {
        initCardCollapse(`${id}ToggleHeader`, `${id}Body`, `${id}Chevron`);
    }

    // Open on today's kind of day — what a member is most likely to be asked about.
    const dow = new Date().getDay();
    /** @type {PageState} */
    const state = { day: dow === 6 ? 'SO' : dow === 0 ? 'SU' : 'SX', view: 'changes', station: null, sdir: 'dep', grid: 'dec', allHeads: false, allTrains: false };

    renderOverview();
    wire(state, () => render(state));
    render(state);
    markPageReady();

    sessionReady.then(() => {
        initErrorReporter();
        recordUsage('trains', member);
        recordPageLatency('trains', member);
    });
    sessionReady.then(() => initPasswordForce(member)).catch(() => {});
}

// ── Renders ─────────────────────────────────────────────────────────────────────────────────────

/** The countdown chip and the three totals. */
function renderOverview() {
    const days = daysUntil(new Date(), CHANGE_DATE);
    setText('trCountdown', days > 1 ? `${days} days to go`
        : days === 1 ? 'Starts tomorrow'
        : days === 0 ? 'Starts today'
        : 'Now running');

    const body = el('trTotals')?.querySelector('tbody');
    if (!body) return;
    body.innerHTML = /** @type {Day[]} */ (['SX', 'SO', 'SU']).map((d) => {
        const now = TIMETABLES.now[d].dep.length, dec = TIMETABLES.dec[d].dep.length;
        return `<tr><th scope="row">${esc(DAY_NAMES[d])}</th><td>${now}</td>`
            + `<td>${dec}${delta(dec - now)}</td></tr>`;
    }).join('');
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
        const host = el('trChanges');
        if (host) host.innerHTML = renderHeadlines(headlineChanges(day.dep, dec.dep, STATIONS), { showAll: state.allHeads, partial: !dec.dep.every(stopsKnown) });
        renderLookup(state);
    } else if (state.view === 'stations') {
        renderStationView(state);
    } else {
        const host = el('trPattern');
        if (host) host.innerHTML = renderGrid(stoppingGrid(day.dep), stoppingGrid(dec.dep), state.grid, STATIONS);
    }
}

/** The station picker and, once one is chosen, its card. @param {PageState} state */
function renderStationView(state) {
    const input = /** @type {HTMLInputElement|null} */ (el('trStationInput'));
    const picks = el('trStationPicks'), host = el('trStation'), dirs = el('trStationDir');
    const rows = TIMETABLES.now[state.day][state.sdir];
    const typed = input?.value.trim() ?? '';
    const offered = typed ? matchStations(STATIONS, typed) : busiestStations(TIMETABLES.now[state.day].dep);
    if (picks) {
        // Say what the chips ARE: without a label, eight station names read as a random selection.
        const label = `<p class="tr-picks-label">${typed ? 'Matching stations' : 'Busiest stations'}</p>`;
        picks.innerHTML = offered.length
            ? label + offered.map(crs => `<button type="button" class="tr-pick" data-station="${esc(crs)}" aria-pressed="${crs === state.station}">${esc(STATIONS[crs] ?? crs)}</button>`).join('')
            : '<p class="card-explainer tr-lead">No station matches that.</p>';
    }
    setText('trStationTitle', state.station ? STATIONS[state.station] ?? state.station : 'Stations');
    if (dirs) dirs.hidden = !state.station;
    if (!host) return;
    if (!state.station) { host.innerHTML = '<p class="card-explainer tr-lead">Pick a station above, or start typing its name.</p>'; return; }
    const view = stationView(rows, TIMETABLES.dec[state.day][state.sdir], state.station, state.sdir);
    host.innerHTML = renderStation(view, { stations: STATIONS, dir: state.sdir, showTrains: false, allTrains: state.allTrains });
}

/**
 * "What happens to the 17:15?" — the trains leaving near a typed time, before and after.
 * @param {PageState} state
 */
function renderLookup(state) {
    const host = el('trLookupResult');
    const input = /** @type {HTMLInputElement|null} */ (el('trLookupInput'));
    if (!host || !input) return;
    const typed = input.value.trim();
    if (!typed) { host.innerHTML = ''; return; }
    const at = parseTypedTime(typed);
    if (!at) { host.innerHTML = '<p class="card-explainer tr-lead">Type a time like 17:15 or 1715.</p>'; return; }

    const nowRows = TIMETABLES.now[state.day].dep, decRows = TIMETABLES.dec[state.day].dep;
    const near = trainsNear(nowRows, decRows, at);

    // The exact train asked about, when there is one, answered in a sentence first.
    const exact = compareRoutes(nowRows, decRows).flatMap(r => r.trains.map(t => ({ r, t })))
        .filter(({ t }) => t.now === at && (t.kind !== 'rerouted' || t.side === 'old'));
    const answer = exact.map(({ r, t }) => {
        // Where THIS train goes: on a line that runs on, that is not always the route's own station.
        const name = t.nowTo && t.nowTo !== r.station ? STATIONS[t.nowTo] ?? t.nowTo : routeName(STATIONS, r.station, r.via);
        const label = changeLabel(t, STATIONS, 'dep');
        // A retimed or new train gets its December time; a rerouted one's label already carries it.
        const when = t.kind === 'earlier' || t.kind === 'later' ? ` (${t.dec})` : '';
        return `<p class="tr-answer"><strong>The ${esc(at)} to ${esc(name)}:</strong> ${esc(label)}${esc(when)}.</p>`;
    }).join('');

    const list = (/** @type {import('./trains-change.js').TrainRow[]} */ rows) => rows.length
        ? `<ul class="tr-near">${rows.map(([t, st, via]) => `<li><span class="tr-near-time">${esc(t)}</span> ${esc(routeName(STATIONS, st, via))}</li>`).join('')}</ul>`
        : '<p class="card-explainer tr-lead">No trains.</p>';
    host.innerHTML = answer
        + `<p class="card-explainer tr-lead">${esc(DAY_NAMES[state.day])}, leaving within 15 minutes of ${esc(at)}:</p>`
        + `<div class="tr-near-cols"><div><h3 class="tr-near-head">Now</h3>${list(near.now)}</div>`
        + `<div><h3 class="tr-near-head">From 13 Dec</h3>${list(near.dec)}</div></div>`;
}

// ── Wiring ──────────────────────────────────────────────────────────────────────────────────────

/**
 * One delegated click handler for every tab and every station button, and the two text inputs.
 * @param {PageState} state
 * @param {() => void} onChange
 */
function wire(state, onChange) {
    el('trainsMain')?.addEventListener('click', (e) => {
        const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('button[data-day],button[data-view],button[data-sdir],button[data-grid],button[data-station],#trHeadsMore,#trAllTrains'));
        if (!b) return;
        if (b.dataset.day) state.day = /** @type {Day} */ (b.dataset.day);
        if (b.dataset.view) state.view = /** @type {View} */ (b.dataset.view);
        if (b.dataset.sdir) state.sdir = /** @type {Dir} */ (b.dataset.sdir);
        if (b.dataset.grid) state.grid = /** @type {'now'|'dec'} */ (b.dataset.grid);
        if (b.id === 'trHeadsMore') state.allHeads = true;
        if (b.id === 'trAllTrains') state.allTrains = true;
        if (b.dataset.station) {
            // A change in the list opens its station — the next question is always "and what else?".
            state.station = b.dataset.station;
            state.allTrains = false;
            const fromList = state.view !== 'stations';
            state.view = 'stations';
            onChange();
            // From the changes list the card replaces the view the member was scrolled into.
            if (fromList) el('trViewStations')?.scrollIntoView({ block: 'nearest' });
            return;
        }
        onChange();
    });
    el('trLookupInput')?.addEventListener('input', onChange);
    el('trStationInput')?.addEventListener('input', onChange);
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

/** A signed difference as a chip, or nothing when there is none. @param {number} n */
function delta(n) {
    if (!n) return '';
    return ` <span class="tr-delta tr-delta--${n > 0 ? 'up' : 'down'}">${n > 0 ? '+' : '−'}${Math.abs(n)}</span>`;
}

/** @param {string} id @param {string} text */
function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
}

/** @param {string} id */
function el(id) { return document.getElementById(id); }
