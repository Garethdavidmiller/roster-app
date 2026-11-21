// @ts-check
/**
 * trains-app.js — coordinator for trains.html: what changes at Marylebone on 13 December 2026.
 *
 * Owns: the access gate, the session wiring, and which view is on screen — the day, the question
 * (what's changing / a station / where they stop) and the chosen station. Every judgement about the
 * timetables is `trains-change.js`, `trains-stations.js` (with `trains-weekdays.js` and
 * `trains-verdict.js`) and `trains-headlines.js`; every word of HTML
 * is `trains-render.js`; each card is written to the page by `trains-cards.js`; the timetables
 * themselves are the generated `trains-data.js`. Nothing here reads the network: once opened, the
 * page works offline.
 *
 * ── WHO IT IS FOR ──────────────────────────────────────────────────────────────────────────────
 *
 * Every signed-in member (owner, 20 Oct 2026 — "make the trains page live for everyone"). The
 * sign-in is the app's ordinary front door, not a boundary: the timetable is public information and
 * `trains-data.js` is served to anyone, like every module. Narrowing it again is one line in
 * `auth-policy.js` and one flag in `nav-panel.js`, which page-contract-parity requires to move together.
 *
 * And the station PIN (owner, 22 Oct 2026), whose staff are the ones customers ask: the policy's
 * `staffPin` flag has the page ask `holdsStaffPin` before offering a sign-in, and every other
 * protected page still signs the PIN out on arrival (session.js → `reconcileExpiredIdentity`).
 *
 * ── TEACH THE CHANGE, NOT THE TIMETABLE ────────────────────────────────────────────────────────
 *
 * The page is read in the weeks BEFORE the change by staff who will be asked about it — "how do I
 * get to Gerrards Cross?", not "what is the 10:10's terminus?". So it is organised by the STATION a
 * customer is going to, answers in a sentence before it shows a table, and keeps the basic hour as
 * one picture, because that is the thing worth memorising (owner brief, 7 Oct 2026).
 *
 * ── OPEN ON THE ANSWERS ────────────────────────────────────────────────────────────────────────
 *
 * Measured on a Pixel 5 (393×727): the first headline began at 589px, under the overview prose and
 * two rows of controls, and the time lookup — the one thing needed with a customer waiting — sat at
 * 1,450px. So the overview opens collapsed from the second visit (`OVERVIEW_SEEN_KEY`; its header
 * says everything it still needs to, and the one caveat a member must not miss — Christmas,
 * `#trFestive` — sits OUTSIDE the fold, so a folded card still shows it: inside it, nobody on a
 * second visit saw it), the station picker folds away once a station is chosen (`pickerOpen`), and
 * the lookup comes first — collapsed on a phone, so the list is still the first thing read, and
 * opening it puts the cursor in the box. A grid column tap shows one train's stops alone (`gridCol`).
 *
 * ── ON AND AFTER THE CHANGE ─────────────────────────────────────────────────────────────────────
 *
 * The page does not stop at 13 December. `timetablePhase` (trains-change.js) decides, from the clock,
 * what the first column is called ("Now", then "Until 12 Dec"), which timetable "the 17:15" means in
 * the lookup, and when both timetables have ended — read fresh on every render, so a page left open
 * over the change turns with it.
 *
 * And a page left open IN VIEW turns too. A render came only from a press, a Back or the tab coming
 * back into view, so the station computer's tab, never hidden, kept yesterday's kind of day — the
 * lookup answered a Sunday morning from Saturday's trains — and its countdown, its Christmas line and
 * its folded overview, past 03:00 and past the end of the books. So the page asks once a minute, and
 * before a key in either box redraws one card, whether the railway day has turned (`turnIfNewDay`) —
 * or the calendar date, at midnight, which the countdown's words count from (`timetablePhase`).
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
import { requirePage, canOpenOvertime, canOpenNewlink, admitsStaffPin } from './auth-policy.js';
import { PIN_FIRST_HASH } from './calendar-access-core.js';
import { initCardCollapse } from './overlay.js';
import { initAboutLightbox, wireHeaderLogo } from './about-lightbox.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { STATIONS } from './trains-data.js';
import { CARD_TIPS, tipsOn } from './trains-tips.js';
import { railwayToday } from './trains-change.js';
import { changesTitle, SIGN_IN_ABOUT } from './trains-render.js';
import { DEC_STOPS_KNOWN, LAST_STATION_KEY, phase, renderOverview, renderChanges, renderPattern, renderStationPicks, renderLast,
    renderStationCard, renderLookup, setText, el } from './trains-cards.js';
import { syncGridMirror } from './trains-grid-mirror.js';

/** @typedef {import('./trains-cards.js').Day} Day */
/** @typedef {import('./trains-cards.js').Dir} Dir */
/** @typedef {import('./trains-cards.js').View} View */
/** @typedef {import('./trains-cards.js').PageState} PageState */

/** Set once the overview card has been on screen on this device: it opens collapsed from then on. */
const OVERVIEW_SEEN_KEY = 'myb_trains_overview_seen';
/** Today's kind of day, as the day tabs name it — the RAILWAY day, which runs to 03:00. @returns {Day} */
const todayDay = () => { const dow = railwayToday().getDay(); return dow === 6 ? 'SO' : dow === 0 ? 'SU' : 'SX'; };
let dayPinned = false;   // set once a day tab is pressed: the chosen day then survives the tab's sleep
/** The railway day and the phase the page last drew (`render`) — how a page left open notices either turn. */
const drawn = { day: '', phase: '' };
/**
 * The day the page was drawn for: the railway day, which says which timetable runs, AND the calendar date, which the
 * countdown's words count from (`timetablePhase`). Keyed on the railway day alone, a page left open over midnight said
 * "Starts tomorrow" until 03:00 on the day itself.
 */
const dayDrawn = () => `${railwayToday().toDateString()} · ${new Date().toDateString()}`;
/** The overview's collapse, opened by `render` when the page turns to both timetables having ended. */
let overviewCard = { setOpen(/** @type {boolean} */ _open) {} };

/** Coordinator body, invoked by trains-boot.js. Exported so a test can import without running. */
export function init() {
    reloadIfRestoredForSomeoneElse();
    registerServiceWorker();   // BEFORE the sign-in gate, as Operations/Links: a signed-out view must still take an update (whole-app review)
    const currentUser = getSession()?.name ?? null;

    // Decided from the LOCAL session, as Operations and Overtime do — the auth store is often still
    // initialising here, and a role-gated page must not treat "pending" as "allowed".
    const access = requirePage({ status: currentUser ? 'named' : 'signedOut', member: currentUser }, 'trains');
    if (access.decision === 'login') {
        // No member — but the station PIN reads this page too, so ask for it BEFORE offering a
        // sign-in: a station PC is not shown one, and keeps the PIN it unlocked the Calendar with. The
        // policy decides whether to ask at all, so dropping its flag also signs the PIN out here again.
        const pin = admitsStaffPin('trains') ? holdsStaffPin(undefined, () => start(null)) : reconcileExpiredIdentity().then(() => false);
        pin.then((held) => { if (held) { start(null); return; } document.body.classList.add('auth-ready'); initLoginOverlay({
            pageLabel: 'Trains', about: SIGN_IN_ABOUT,   // the way in for the station PIN, which opens this page too (trains-render.js)
            // No session saved (iOS private mode can refuse the write): reload into a fresh sign-in.
            onSuccess: () => { try { if (!getSession()) { window.location.reload(); return; } init(); } catch { window.location.reload(); } },
        }); });
        return;
    }
    if (access.decision === 'forbidden') {
        // Not reachable while the policy admits every member. Kept so that a role added
        // back to the policy fails closed — back to the roster, quietly — rather than open.
        window.location.replace('./');
        return;
    }
    // Tear down a lingering privileged Firebase identity whose local session has expired.
    reconcileExpiredIdentity().catch(() => {});   // it handles and logs its own failures; this only keeps an unexpected one from going unhandled
    start(/** @type {string} */ (currentUser));
}

/**
 * The page, for a member — or, with `member` null, for the station PIN, which is nobody: no session
 * to establish or guard, no password to force, and the drawer's Lock where a member has Sign out.
 * @param {string|null} member
 */
function start(member) {
    document.body.classList.add('auth-ready');   // the cards show; the boot placeholder goes (trains.html)
    dismissLoginOverlay();
    if (member) {
        const established = ensureNamedSession(member);
        resolveSession(established);
        // The card a lost session gets says what the card at load says — the station PIN's way in too.
        guardNamedSession({ page: 'trains', pageLabel: 'Trains', member, established, about: SIGN_IN_ABOUT });
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
        canOpenOvertime: canOpenOvertime(member), canOpenNewlink: canOpenNewlink(member),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut: member ? () => signOutAndLeave({ to: './' }) : null,
        onLockCalendar: member ? null : { isViewer: () => true, lock: lockStaffPin },
    });
    openAboutLightbox = initAboutLightbox({ appLabel: 'Marylebone Roster — Trains', getUserName: () => member })?.open ?? null;
    wireHeaderLogo();

    // Each ? panel is read as it opens, for the railway day it is then (trains-tips.js → `tipsOn`): its
    // title turns at the change, and a line about weeks that have ended goes, on a page left open too.
    initTipsLightbox(Object.defineProperties({}, Object.fromEntries(Object.keys(CARD_TIPS).map(key =>
        [key, { enumerable: true, get: () => tipsOn(railwayToday())[key] }]))), { getIsAdmin: () => isAdmin });
    const cards = Object.fromEntries(['trOverview', 'trChanges', 'trLookup', 'trStations', 'trPattern', 'trLast', 'trJump'].map(id => [id,
        // Opening the lookup — by its chevron or its header — puts the cursor in the box: that is what
        // a member opened it to do. `setOpen` runs the same callback, but only ever with `false` here.
        initCardCollapse(`${id}ToggleHeader`, `${id}Body`, `${id}Chevron`, id === 'trLookup' ? (/** @type {boolean} */ open) => { if (open) el('trLookupInput')?.focus(); } : undefined)]));
    // OPEN ON THE ANSWERS (the header). The overview is read once; from the next visit its header —
    // title, hint and the countdown chip — says everything it needs to, and the card opens collapsed.
    // The Christmas line is not in the fold, so folding never hides it (trains.html). Except
    // when both timetables have ended: then its one message IS the card's, and must be seen —
    // which `render` sees to, on this first draw and on the draw that finds the page has turned.
    overviewCard = cards.trOverview;
    if (lsGet(OVERVIEW_SEEN_KEY)) cards.trOverview.setOpen(false);
    lsSet(OVERVIEW_SEEN_KEY, '1');
    // On a phone the lookup sits above the changes list and starts collapsed: its header says what it
    // is for, the list stays the first thing read, and the box is one tap away rather than two
    // screens. A desktop has the room, and keeps it open in its own column.
    if (window.matchMedia('(max-width: 1023px)').matches) cards.trLookup.setOpen(false);
    // Last trains starts folded: its header says it exists, and one tap opens the whole network.
    cards.trLast.setOpen(false);

    // Open on today's kind of day — what a member is most likely to be asked about. And, once
    // Chiltern's festive changes are over, on STATIONS: "what is changing" has become "the
    // timetable", and a station is the question — the one this device asked about last, if any.
    const p0 = phase();
    const settled = p0.started && !p0.festive && p0.phase !== 'ended';
    const remembered = lsGet(LAST_STATION_KEY);
    const opensOn = settled && remembered && STATIONS[remembered] ? remembered : null;
    /** @type {PageState} */
    const state = { day: todayDay(), view: settled ? 'stations' : 'changes', station: opensOn, sdir: 'dep',
        grid: DEC_STOPS_KNOWN ? 'dec' : 'now', allHeads: false, allTrains: false, pickerOpen: !opensOn, gridCol: null };
    // The grid opens on TODAY until December's stops exist: a December grid of end stations alone read
    // as a broken page, and it was the first thing the tab showed (owner, 7 Oct 2026).

    wire(state);
    render(state);
    markPageReady();
    // A page left open overnight still turns the countdown — and, on the day, every label with it.
    // A tab left open overnight (the station PC's, since the PIN reads this page) comes back on TODAY's
    // kind of day unless somebody chose one; the labels and the phase re-read too (`render`).
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(state); });
    // …and one that is never hidden is asked each minute (the header's "On and after the change").
    setInterval(() => { if (document.visibilityState === 'visible') turnIfNewDay(state); }, 60_000);

    if (member) {
        sessionReady.then(() => {
            initErrorReporter();
            recordUsage('trains', member);
            recordPageLatency('trains', member);
        });
        // Called now, with the session as its barrier: a sign-in's one-shot marker is spent as the page opens,
        // never only once the session is confirmed (password-force.js, "consume BEFORE any await"). It fails open by
        // itself; the `.catch` only keeps an unexpected rejection from going unhandled.
        initPasswordForce(member, { ready: sessionReady }).catch(() => {});
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

/** The whole page, read afresh on every press, Back and return: the kind of day first, unless a day was chosen, then the
 *  overview and the view — so no part is left on yesterday's date while another has turned (whole-app fix, Nov 2026). @param {PageState} state */
function render(state) {
    if (!dayPinned && state.day !== todayDay()) { state.day = todayDay(); state.gridCol = null; }
    const p = phase();
    // Both timetables ending is the overview's one message, so the card opens for it: on the first draw,
    // which a return visit had folded, and on the draw that finds the page has turned to it while open.
    if (p.phase === 'ended' && drawn.phase !== 'ended') overviewCard.setOpen(true);
    drawn.day = dayDrawn();
    drawn.phase = p.phase;
    renderOverview(p);
    for (const b of /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-day],[data-view],[data-sdir],[data-grid]')])) {
        const on = b.dataset.day ? b.dataset.day === state.day : b.dataset.view ? b.dataset.view === state.view
            : b.dataset.sdir ? b.dataset.sdir === state.sdir : b.dataset.grid === state.grid;
        b.setAttribute('aria-pressed', String(on));
    }
    for (const [view, id] of /** @type {[View, string][]} */ ([['changes', 'trViewChanges'], ['stations', 'trViewStations'], ['grid', 'trViewGrid']])) {
        const section = el(id);
        if (section) section.hidden = state.view !== view;
    }
    // The view's name follows the phase: a tab promising what is coming reads wrong the morning it has come —
    // and so did the names a screen reader hears, which stayed put: the section, its ? and its chevron.
    const words = changesTitle(p.started);
    for (const id of ['trChangesTab', 'trChangesTitle']) setText(id, words);
    for (const [id, name] of [['trViewChanges', words], ['trChangesChevron', `Toggle ${words}`], ['trChangesTips', `Tips for ${words.toLowerCase()}`]]) el(id)?.setAttribute('aria-label', name);
    // Only the view on screen is painted (trains-cards.js).
    if (state.view === 'changes') renderChanges(state, p);
    else if (state.view === 'stations') {
        renderStationPicks(state);
        renderStationCard(state);
        renderLast(state);
    } else renderPattern(state);
    // The fixed copy of the grid's column heads: rebuilt from whatever the grid now is — including
    // nothing, when another view is on screen (trains-grid-mirror.js).
    syncGridMirror(state.view === 'grid' ? el('trPattern') : null);
}

/** Redraw the whole page if the railway day, or the calendar date, has turned since it was drawn (the header). @param {PageState} state @returns {boolean} whether it did */
function turnIfNewDay(state) {
    if (dayDrawn() === drawn.day) return false;
    render(state);
    return true;
}

// ── Wiring ──────────────────────────────────────────────────────────────────────────────────────

/**
 * One delegated click handler for every tab and every station button, and the two text inputs — each
 * input redraws only its own panel, so a live region is not re-announced for every key.
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
        if (b.dataset.day) { state.day = /** @type {Day} */ (b.dataset.day); state.gridCol = null; dayPinned = true; }
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
    // A key redraws its own card — unless the railway day has turned since the page was drawn, when the
    // whole page turns first and the answer is that day's, not the one the page was opened on.
    el('trLookupInput')?.addEventListener('input', () => { if (!turnIfNewDay(state)) renderLookup(state); });
    el('trStationInput')?.addEventListener('input', () => { if (!turnIfNewDay(state)) renderStationPicks(state); });
    // Enter takes the first match — with one station left, it is the one meant.
    el('trStationInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') /** @type {HTMLElement|null} */ (el('trStationPicks')?.querySelector('button[data-station]') ?? null)?.click();
    });
}

/**
 * Keyboard focus after a redraw: the button pressed was replaced, so focus fell to <body>
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
