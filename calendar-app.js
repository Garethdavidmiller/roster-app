// @ts-check
/**
 * calendar-app.js — Calendar UI for index.html.
 *
 * Owns: the page's wiring — month navigation (the Prev/Next/Today buttons and `goToToday`, which
 *   the keys press), `renderCalendar` and the first-run prompt, the About and Team-help lightbox
 *   wiring, and the access bootstrap that starts the workspace.
 * Does NOT own: rendering, and what a month shows (calendar-renderer.js → `monthOnScreen`), Team Week
 *   View (calendar-team-view.js), override cache (calendar-overrides.js), member selection
 *   (calendar-member.js), swipe (calendar-swipe.js), the keyboard shortcuts (calendar-keyboard.js),
 *   the month-jump picker (calendar-month-jump.js), the member's own-roster copy — paint and save
 *   (calendar-own-copy.js), sync chip + initial fetch (calendar-initial-fetch.js), the AL and
 *   day-detail panels (calendar-al-lightbox.js), the notification strip (calendar-notif-prompt.js).
 * Edit here for: event wiring, and the order the page starts in.
 * Do not edit here for: pay maths, admin features, override entry.
 */

import { enhanceSelect } from './select-sheet.js';
import { CONFIG, MONTH_NAMES, computeEaster, resolveMemberRoster } from './roster-data.js';
import { formatClock, printedStamp } from './date-format.js';
import { authReady, getLatestNewsletter, getLatestCircular } from './firebase-client.js';
import { checkLatestNewsletter } from './newsletter-recency.js';
import { checkLatestCircular } from './doc-dates.js';
import { lsGet, lsSet } from './ls.js';
import { getSession, ensureNamedSession, refreshClaimsIfStale } from './session.js';   // reconcileExpiredIdentity now runs inside calendar-access.js
import { initPasswordForce, passwordStepMayBeDue } from './password-force.js';
import { TEAM_VIEW } from './storage-keys.js';
import { initTeamView } from './calendar-team-view.js';
import { wireCalendarDrawer, rewireCalendarDrawer } from './calendar-drawer.js';
import { _pushOverlayState, _clearOverlayHistory, createLightbox, confirmDialog } from './overlay.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { CARD_TIPS as CALENDAR_TIPS } from './calendar-tips.js';
import { printOrExplain, explainNoPrint } from './print-guard.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initCalendarNotices } from './calendar-notices.js';
import { registerServiceWorker, reloadWhileHidden } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady, markMilestone, markAwaitingInput } from './perf-reporter.js';
import { initHuddleViewer } from './calendar-huddle-viewer.js';
import { initDocViewer } from './calendar-doc-viewer.js';
import { rosterOverridesCache, ensureOverridesCached, getShiftTypesInMonth, _initialFetchInProgress, hasOverrideAccess, setOverrideAccessLostHandler, monthKey, clearFetchedMonth } from './calendar-overrides.js';
import { forget as forgetOverrideKnowledge, knowledgeOf, decideDisplay, showsRoster } from './calendar-data-state.js';
import { createLegend } from './calendar-legend.js';
import { initCalendarAccess, calendarAccessReady, calendarAuthReady, getAccessType, handleAccessLost } from './calendar-access.js';
import { personalActionsAllowed } from './calendar-access-core.js';
import { getCurrentMember, getSelectedMemberIndex, saveSelectedMember, populateTeamMemberDropdown, validateTeamMembers, takeStaleMemberName, isFirstRun } from './calendar-member.js';
import { buildCalendarContainer, setSnapshotSource, monthOnScreen, rovingCellFor } from './calendar-renderer.js';
import { clearSnapshot } from './calendar-snapshot.js';
import { createOwnCopy } from './calendar-own-copy.js';
import { initMonthJump } from './calendar-month-jump.js';
import { getDisplayMonth, getDisplayYear, setDisplayMonth, setDisplayYear, changeDisplay, persistViewedMonth, watchLocalDate } from './calendar-state.js';
import { initSwipeHandler, isSwipeCooldown, isSwipeGestureActive } from './calendar-swipe.js';
import { createRedrawScheduler } from './calendar-redraw.js';
import { initCalendarLightboxes } from './calendar-al-lightbox.js';
import { initInitialFetch } from './calendar-initial-fetch.js';
import { initInstallPrompt } from './install-prompt.js';
import { initNotifPrompt } from './calendar-notif-prompt.js';
import { hasDocumentAccess, documentAccess } from './calendar-doc-access.js';
import { onCalendarAccess } from './calendar-access-state.js';
import { applyTextScale } from './text-scale.js';
import { initCalendarTooltip, initCalendarKeyboard, initCalendarShortcuts } from './calendar-keyboard.js';

import { setStatus } from './status-text.js';
import { signOutAndLeave, reloadIfRestoredForSomeoneElse, rebaseRestoreGuard } from './page-session.js';
import { showMirrorBanner } from './mirror-move.js';
// ── THE CALENDAR ACCESS BOOTSTRAP ───────────────────────────────────────────────────────────────
//
// There is NO anonymous sign-in here, and it must not come back "so telemetry keeps working".
// Override reads require a real member `name` claim, so an anonymous identity would buy a token no
// rule accepts (AUTH_AND_SESSIONS.md 9), and a locked Calendar recording a page view it never showed
// is not a measurement worth an authenticated session for.
//
// `calendarAccessReady` (calendar-access.js) resolves only when this browser may actually SEE the
// roster.
//
// `_startCalendarWorkspace` is assigned inside the init try-block below and invoked once, from the
// access callback at the module tail. It is a `let` rather than a hoisted function declaration
// precisely so that the assignment sits with the code it initialises.
/** @type {(() => void)|null} */
let _startCalendarWorkspace = null;

/** How long the boot will wait for the local override cache before painting anything.
 *  Short on purpose: it is a chance for the cache to win, not a loading state. Long enough for an
 *  IndexedDB read that has already started, far too short to be noticed if it misses. */
const CACHE_FIRST_PAINT_MS = 90;

/**
 * Mark the page ready ONLY when a real roster grid is on screen.
 *
 * The first render is frequently "Checking this month…", a withheld grid; timing that as "usable"
 * would time the moment the Calendar decided it had nothing to show yet — most often on the SLOWEST
 * loads. `render` and `stale` are both real grids (one current, one labelled last-known); `loading`
 * and `unavailable` are not, and neither may be timed as though it were.
 *
 * Idempotent downstream (the first `markPageReady` wins), so this is safe to call after every
 * render — whichever render first puts a grid up is the one that counts.
 */
function _markReadyIfGridShown() {
    try {
        // NOT BEFORE THE BOOT HAS CHOSEN ITS SURFACE. Phase 1 of the initial fetch paints from the
        // local cache and calls back, and on a cache hit that happens BEFORE `restoreTeamView()`
        // has run — so `isTeamViewMode()` is still false and a team-view member's readiness would
        // be timed against a Calendar grid they are about to be taken off. The boot reaches the
        // `surface` stage the instant it has rendered, so the mark lands within the same tick either way.
        if (!redraw.reached('surface')) return;
        // ASK THE SURFACE THAT IS ON SCREEN. Team View gates on the WORST knowledge across the
        // months its week spans, and a week routinely spans two — so reading the Calendar's display
        // month here would time the wrong thing in both directions. Each surface computes its own
        // answer; what COUNTS as a roster is `showsRoster`, beside the states it reads.
        if (teamView.isTeamViewMode()) {
            if (teamView.isGridShown()) markPageReady();
            return;
        }
        // ASKED WITHOUT THE STORED COPY, deliberately — not `monthOnScreen` (calendar-renderer.js),
        // which the grid and the legend ask. A loading month the member's own copy stands in for is
        // drawn `stale`, but it is not the live roster this figure times: the copy has a milestone of
        // its own (`rosterSnapshot`, calendar-own-copy.js). Counted here too, the first mark — the one
        // that wins — would time the copy again rather than the roster a read put on screen.
        const display = decideDisplay(knowledgeOf(monthKey(getDisplayYear(), getDisplayMonth())));
        if (showsRoster(display)) markPageReady();
    } catch { /* the metric must never be able to break the boot */ }
}

// The version is APP_VERSION in roster-data.js (read by the About lightbox). No override here.

// Assigned by the About-lightbox IIFE; lets the nav-panel drawer logo open the
// same About panel that the header logo opens on the calendar page.
/** @type {any} */
let openAboutLightbox = null;

// Returned by initCalendarLightboxes(); lets a day-cell click or tap (any pointer) open the day
// panel, and lets the redraw scheduler's `nameApplied` (below) close the AL lightbox when the name
// picker changes member (its figures would be the previous name's). Both are ready before the swipe init.
// NOT deferred behind Calendar access, and checked rather than assumed. This attaches handlers; it
// fetches nothing. The AL lightbox's own Firestore read happens in its `onOpen`, fired by `#alBtn`,
// inside `#calendarControls` — hidden while locked, so out of the accessibility tree and tab order —
// and that read REFUSES an answer the offline cache gave (CALENDAR_DATA.md 16). Same reasoning for
// `initCalendarTooltip`/`initCalendarKeyboard` further down: with `#calendarDisplay` empty they have
// nothing to act on, and the keyboard ACTS only inside it, so the stored copy painted in the lock
// slot before the grant is read, never used.
const { openDayDetail, closeALLightbox } = initCalendarLightboxes({ navigateToPaycalc, isTeamView: () => teamView.isTeamViewMode() });


// ── TEAM VIEW ──
const teamView = initTeamView({
    rosterOverridesCache,
    ensureOverridesCached,
    monthKey,
    clearFetchedMonth,
    getSelectedMemberIndex,
    isFirstRun,
    // Whose row is marked as the reader's own: the member signed in by name, never the picker's choice.
    ownName: () => (getAccessType() === 'named' ? getSession()?.name : null),
    renderCalendar,
    getDisplayedMonth: () => ({ month: getDisplayMonth(), year: getDisplayYear() }),
    onMonthRead: _repaintAfterMonthRead,   // a read Team View starts may land after it has been left
    _pushOverlayState,
    _clearOverlayHistory,
});

// ── THE MEMBER'S OWN ROSTER, SHOWN WHILE THE SIGN-IN CHECK RUNS (calendar-own-copy.js) ────────────
// Offered only on the member's OWN calendar, signed in by name, outside Team View; that module says
// when it is painted and kept, and why neither path can be mistaken for what the server said. Its
// source is registered HERE, at module scope, so no render can run before the renderer can ask it.
// The listeners that clear it on a lost grant stay below (ACCESS LOST), with the grid's.
const ownCopy = createOwnCopy({
    sessionName: () => getSession()?.name,
    accessType: getAccessType,
    isTeamViewMode: () => teamView.isTeamViewMode(),
    currentMemberName: () => /** @type {any} */ (getCurrentMember())?.name,
    cache: rosterOverridesCache,
    monthKey,
    buildCalendarContainer,
    markMilestone,
});
setSnapshotSource(ownCopy.snapshotFor);

// ── WHEN THE PAGE MAY DRAW (calendar-redraw.js) ──
// How far start-up has got, the ONE wait for a swipe to finish, and what the next draw owes: one
// scheduler, and its header says why they are not a variable each in this file. Every BACKGROUND
// repaint goes through `redraw.repaint`, and the name picker through `redraw.nameChanged`. A press
// the reader made (Prev, Next, Today, a key, the month picker, Try again) calls `renderCalendar`
// itself.
const redraw = createRedrawScheduler({
    gestureLive: isSwipeGestureActive,
    teamViewOn: () => teamView.isTeamViewMode(),
    drawCalendar: renderCalendar,
    drawTeam: () => teamView.refreshFromCache(),
    // Read live, so a second pick made during the wait is the one saved (v16.19).
    saveName: () => saveSelectedMember(parseInt(_teamMemberSelect.value, 10)),
    nameApplied: () => closeALLightbox?.(),   // its figures would be the previous name's
});


// ── MONTH NAVIGATION ──

// Central month navigation — all buttons, keyboard and swipe go through here.
// State change is pure (calendar-state.js); this wrapper adds the UI side-effect.
/** @param {any} delta */
function changeMonth(delta) {
    changeDisplay(delta);
    dismissSwipeHint();
}

// The phone's text scale, stamped on <html> before anything is laid out, so the action row can go
// compact where five buttons would otherwise wrap (text-scale.js has the reasoning and the numbers).
applyTextScale(document);

// Show a one-time swipe hint on the calendar for first-time visitors.
// Only shown on touch devices — desktop users navigate with Prev/Next buttons.
// Dismissed permanently on the first month navigation (swipe or button), or
// auto-dismissed after 6s — without the timer, a user who saw the hint but
// didn't navigate would be shown it again on every reload.
(function initSwipeHint() {
    if (lsGet('myb_swipe_hint_seen')) return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const hint = document.getElementById('swipeHint');
    if (!hint) return;
    // Not until the Calendar is OPEN: locked, the hint is hidden with the workspace, and its 6s timer
    // would still mark it seen. Nor over the first-run prompt, which has no month to swipe: it waits
    // for the name to be picked.
    const show = () => { hint.style.display = ''; setTimeout(dismissSwipeHint, 6000); };
    calendarAccessReady.then(() => {
        if (!isFirstRun()) show(); else document.getElementById('teamMemberSelect')?.addEventListener('change', show, { once: true });
    });
})();

function dismissSwipeHint() {
    const hint = document.getElementById('swipeHint');
    if (!hint || hint.style.display === 'none') return;
    lsSet('myb_swipe_hint_seen', '1');
    hint.classList.add('fade-out');
    // Hidden once the fade has run. Its length is the stylesheet's (.swipe-hint, index.css), read back
    // rather than restated: a copy of the number here had already drifted from it.
    const fadeMs = (parseFloat(getComputedStyle(hint).transitionDuration) || 0) * 1000;
    setTimeout(() => { hint.style.display = 'none'; hint.classList.remove('fade-out'); }, fadeMs + 50);
}


// Navigate to the pay calculator for a given payday ISO date string.
// Goes straight to ./paycalc.html — paycalc does its own in-place login when needed and keeps the
// query. Always call this helper — never duplicate the nav logic.
//
// THE ONE GATE FOR EVERY ROUTE TO THE CALCULATOR — the calculator is somebody's OWN, so
// `personalActionsAllowed` (calendar-access-core.js, which carries the whole argument; CALENDAR_DATA.md
// 14) decides here as well as on the day panel's buttons. Gating HERE means a route added later
// inherits it rather than having to remember. Returns whether it went, because a refused Enter must
// fall through to the day panel rather than become a dead key; see calendar-keyboard.js.
/** @param {any} paydayStr @returns {boolean} */
function navigateToPaycalc(paydayStr) {
    if (!personalActionsAllowed({
        accessType:  getAccessType(),
        sessionName: getSession()?.name,
        shownMember: /** @type {any} */ (getCurrentMember())?.name,
    })) return false;
    window.location.href = `./paycalc.html?payday=${paydayStr}`;
    return true;
}


// Refresh the Prev/Next buttons' disabled state at the MIN_YEAR/MAX_YEAR boundaries.
// aria-disabled signals the limit to screen readers; opacity gives visual feedback. Called from
// renderCalendar AND from the swipe commit (via the swipe handler dep) — a swipe off a boundary
// month onto an already-cached month does not re-run renderCalendar, so without this the button
// stays greyed-out and its click handler keeps hard-returning on a month where navigation is valid.
function updateNavButtonState() {
    const atStart = getDisplayYear() === CONFIG.MIN_YEAR && getDisplayMonth() === 0;
    const atEnd   = getDisplayYear() === CONFIG.MAX_YEAR && getDisplayMonth() === 11;
    const prevBtn = document.getElementById('prevMonth');
    const nextBtn = document.getElementById('nextMonth');
    if (prevBtn) {
        prevBtn.setAttribute('aria-disabled', atStart ? 'true' : 'false');
        prevBtn.style.opacity = atStart ? '0.4' : '';
    }
    if (nextBtn) {
        nextBtn.setAttribute('aria-disabled', atEnd ? 'true' : 'false');
        nextBtn.style.opacity = atEnd ? '0.4' : '';
    }
}

// ── THE MONTH LEGEND ────────────────────────────────────────────────────────────────────────────
// `calendar-legend.js` owns both of its decisions — which keys apply, and whether the legend applies
// at all — and argues why the shown/hidden answer belongs to the legend UPDATE, not to a render.
const legend = createLegend({
    getCurrentMember,
    // The month's keys come from the same records the grid is drawn from — the stored copy while the
    // month loads, as the renderer reads it (an 🏖️ day must not show with no AL key).
    getShiftTypesInMonth: (member, y, m) => getShiftTypesInMonth(member, y, m, monthOnScreen(member, y, m).snapshot),
    getDisplayYear,
    getDisplayMonth,
    computeEaster,
    resolveMemberRoster,
    // A loading month the member's stored copy is drawn for IS a grid on screen — the renderer draws
    // it `stale` — so it gets its key by the same rule.
    displayVerdict: () => monthOnScreen(getCurrentMember(), getDisplayYear(), getDisplayMonth()).display,
    isTeamViewMode: () => teamView.isTeamViewMode(),
    isFirstRun,
});
const updateLegend = () => legend.update();

/**
 * Shows the one-time "stale member removed from roster" error banner.
 * Called from the pre-branch init block (team-view path) and from renderCalendar()
 * (calendar-view path). takeStaleMemberName() is one-shot so only one path fires.
 * @param {string} staleName  The name that was no longer found in the roster.
 * @param {string} fallbackName  The member now being shown.
 */
function _showStaleMemberBanner(staleName, fallbackName) {
    const banner = document.getElementById('errorBanner');
    if (!banner) return;
    // A LINE OF ITS OWN, BESIDE WHATEVER THE BANNER ALREADY SAYS. The start-up roster check may have
    // written its warning here first, to stay until a reload; only this line times out, and the
    // banner goes with it only when nothing else is left in it.
    const line = document.createElement('div');
    // The signed-in member's OWN name (a row hidden after a move into management, say) is said to
    // them, not about them in quotes.
    line.textContent = `${staleName === getSession()?.name ? 'Your name' : `"${staleName}"`} is no longer in the roster — showing ${fallbackName}'s calendar. Choose a name from the list below.`;
    banner.appendChild(line);
    banner.classList.add('visible');
    setTimeout(() => {
        line.remove();
        if (!banner.textContent?.trim()) banner.classList.remove('visible');
    }, 30000);
}

/**
 * First-run state (Onboarding H1): no member picked yet and not signed in. Show a prompt
 * to choose a name INSTEAD of rendering the default member's roster (which a brand-new user
 * could mistake for their own). Picking a name fires the dropdown `change` handler →
 * saveSelectedMember → renderCalendar, which replaces this prompt with the real calendar.
 */
function showFirstRunPrompt() {
    const el = document.getElementById('calendarDisplay');
    if (!el) return;
    el.innerHTML =
        '<div class="first-run-prompt">' +
          '<div class="first-run-emoji" aria-hidden="true">👋</div>' +
          '<h2>Choose your name to see your shifts</h2>' +
          '<p>Pick your name from the list above, and your roster will appear.</p>' +
        '</div>';
    // Don't leave a real member's name on the print header while no one is selected.
    document.querySelector('.header')?.removeAttribute('data-member-name');
    // Announce to screen readers — the prompt replaces the calendar grid silently otherwise.
    const announcer = document.getElementById('ariaAnnouncer');
    if (announcer) {
        announcer.textContent = '';
        requestAnimationFrame(() => {
            announcer.textContent = 'Choose your name from the list above to see your shifts.';
        });
    }
}

/** Withdraws the initial sync's failure chip; set once `initInitialFetch` runs. */
let _dismissSyncError = () => {};

/**
 * "Try again" from the withheld-grid panel — the recovery for a month whose overrides could not be
 * read.
 *
 * Forgets the month BEFORE re-fetching, on purpose: that repaints the wait state immediately, so a
 * press on a slow connection visibly does something. `clearFetchedMonth` re-arms both the fetch (it
 * releases the claim) and the one-shot failure repaint, so a second failure is reported rather than
 * swallowed.
 * @param {number} year
 * @param {number} month - 0-indexed
 */
function retryMonth(year, month) {
    _dismissSyncError();
    const key = monthKey(year, month);
    clearFetchedMonth(key);
    forgetOverrideKnowledge(key);
    // Calendar only: this button lives on the MONTH panel, which never renders in Team View — that
    // surface has its own `#tvRetry`, wired to the week's own months.
    renderCalendar();
}

// renderCalendar — used for all non-swipe navigation (buttons, keyboard, today).
// Sets data-member-name for print header then builds and inserts fresh container.
function renderCalendar() {
    try {
        // First-run (no member picked, not signed in): show the choose-your-name prompt instead
        // of the default member's roster. Guarding renderCalendar itself covers EVERY render path
        // — init, the initial Firestore fetch's re-render, swipe — so the prompt is never
        // overwritten. Picking a name saves it → isFirstRun() false → normal render. (H1)
        // The legend is asked too: leaving Team View has just un-hidden it, and a prompt has no key.
        if (isFirstRun()) { updateLegend(); showFirstRunPrompt(); return; }
        const member = getCurrentMember();

        // If the previously-selected member was removed from the roster, show a one-time notice.
        const stale = takeStaleMemberName();
        if (stale) _showStaleMemberBanner(stale, (/** @type {any} */ (member)).name);

        // Update legend for current member and month (Night, 🎄, 🐣 are conditional).
        // It also decides whether the legend is SHOWN at all — see updateLegend.
        updateLegend();

        // Set team member name on header for printing
        const headerElement = document.querySelector('.header');
        if (headerElement) headerElement.setAttribute('data-member-name', (/** @type {any} */ (member)).name);

        const calendarDisplay = document.getElementById('calendarDisplay');
        if (!calendarDisplay) throw new Error('Calendar display element not found');

        document.title = `${MONTH_NAMES[getDisplayMonth()]} ${getDisplayYear()} — Marylebone Roster`;

        // Persist so a member coming straight back finds this month (kept half an hour: calendar-state.js)
        persistViewedMonth();

        const calendarContainer = buildCalendarContainer(getDisplayMonth(), getDisplayYear(), {
            onDayDetail: /** @param {any} cell */ (cell) => openDayDetail?.(cell),
            // No button while the initial 3-month fetch is still running: the sync chip in the
            // header is already the retry for that read, and this render starts no read of its own
            // until it settles (below), so a Try again then would leave "Checking" with nothing behind it.
            onRetryMonth: _initialFetchInProgress ? undefined : retryMonth,
            checking: _initialFetchInProgress,   // the first check is running: "couldn't check" would be false
        });
        // Preserve keyboard focus across the re-render. Wiping #calendarDisplay drops focus to
        // <body>, after which the page's keyboard shortcuts (`initCalendarShortcuts`) treat arrows as
        // MONTH jumps instead of day steps. Doing it HERE (the render choke point) covers BOTH the
        // synchronous PageUp/Down month change AND the async override-fetch re-render that follows.
        // preventScroll so a background re-render can't yank the viewport. A render with no day cells
        // ("Checking this month", the failure panel) leaves the focus OWED, so the grid that follows
        // restores it. The debt is kept by calendar-redraw.js (`focusWanted` / `focusSettled`).
        // A BACKGROUND repaint of the same month gives focus back to the same DAY, by its
        // `data-detail-day` (`focusDay`, `rovingCellFor`); a press takes the new grid's anchor.
        const _active = document.activeElement;
        const _onCell = _active instanceof HTMLElement && _active.classList.contains('calendar-day');
        const _wantsFocus = redraw.focusWanted({
            onCell: _onCell,
            nowhere: !_active || _active === document.body,
            day: _onCell ? (/** @type {HTMLElement} */ (_active).dataset.detailDay ?? null) : null,
        });
        calendarDisplay.innerHTML = '';
        calendarDisplay.appendChild(calendarContainer);
        const _anchor = _wantsFocus ? rovingCellFor(calendarContainer, redraw.focusDay()) : null;
        _anchor?.focus({ preventScroll: true });
        redraw.focusSettled(_wantsFocus, !!_anchor);

        updateNavButtonState();
        ownCopy.save();

        // Ensure Firestore overrides are cached for the displayed month.
        // No-op if already fetched; fires a background fetch and re-render if not
        // (e.g. when the user navigates beyond the initial 3-month window).
        // Skipped while the initial 3-month fetch is in flight to avoid a competing
        // fetch that could race against it and produce a blank re-render mid-load.
        if (!_initialFetchInProgress) ensureOverridesCached(getDisplayYear(), getDisplayMonth(), _repaintAfterMonthRead);

    } catch (error) {
        console.error('[calendar] Error rendering calendar:', error);
        const calendarDisplay = document.getElementById('calendarDisplay');
        if (calendarDisplay) {
            const errDiv = document.createElement('div');
            errDiv.className = 'calendar-error';
            errDiv.setAttribute('role', 'alert');
            errDiv.innerHTML = '<h2><span aria-hidden="true">⚠️</span> Couldn\'t display this roster</h2><p>Close the app and open it again. If it keeps happening, check your connection or contact the admin.</p>';
            calendarDisplay.innerHTML = '';
            calendarDisplay.appendChild(errDiv);
        }
    }
}


// ── EVENT LISTENERS ──

// The one callback for a month read that lands later — a function with ONE identity, because
// `ensureOverridesCached` keeps its waiters by identity: several waits on one month repaint once.
// Deliberately unguarded by member: the read is everyone's, so a member switched mid-read is
// waiting on it too, and so is Team View — a read it started still repaints the Calendar if it
// lands after Team View is left. A BACKGROUND repaint, so it never lands under a swiping finger —
// calendar-redraw.js, rule 1.
function _repaintAfterMonthRead() { redraw.repaint('month-read'); }

// The first load's callback, on whichever surface is on screen: the same kind of repaint, and then
// the "usable" timing, which asks what is actually shown.
function _repaintAfterFirstLoad() { redraw.repaint('first-load'); _markReadyIfGridShown(); }

const _teamMemberSelect = /** @type {HTMLSelectElement} */ (document.getElementById('teamMemberSelect'));
// The member picker opens the app's OWN sheet rather than the OS dropdown (CLAUDE.md → "No native
// <select> POPUP"); the select stays the value holder, so the change handler below is unchanged.
enhanceSelect(_teamMemberSelect, { title: 'Whose roster are you reading?', placeholder: 'Choose your name', searchLabel: 'Search names', createLightbox });
// `?.` null-guard: this is attached at MODULE SCOPE, before the init try/catch, so an uncaught throw
// here (were #teamMemberSelect ever renamed/absent) would blank-splash the whole app.
// The change is applied now, or — during a swipe — as soon as the whole gesture has finished, and
// never dropped: a dropped change left the picker showing one name over another's roster. In Team
// View the name is saved and the Calendar is not drawn. Both rules, and the single wait, are
// calendar-redraw.js's (rules 1 to 3).
_teamMemberSelect?.addEventListener('change', () => { redraw.nameChanged(); });


document.getElementById('prevMonth')?.addEventListener('click', (e) => {
    if (isSwipeCooldown()) return;
    // During first run renderCalendar() early-returns to keep the "choose your name" prompt up, so
    // changeMonth() would silently drift the hidden month. No-op the relative nav until a name is chosen.
    if (isFirstRun()) return;
    // aria-disabled is set at the boundary — honour it as a true no-op so AT users
    // (and PageUp via .click()) don't trigger a pointless re-render/announce.
    if (/** @type {Element} */ (e.currentTarget).getAttribute('aria-disabled') === 'true') return;
    changeMonth(-1);
    renderCalendar();
    announceMonthChange();
});

// Briefly pulses the today cell - only called when navigating TO today
function pulseToday() {
    // Wait one frame for the DOM to settle after renderCalendar
    requestAnimationFrame(() => {
        const todayCell = document.querySelector('.calendar-day.today');
        if (!todayCell) return;
        // Remove class first in case it's already there, then re-add
        todayCell.classList.remove('today-pulse');
        void /** @type {HTMLElement} */ (todayCell).offsetWidth; // Force reflow to restart animation
        todayCell.classList.add('today-pulse');
        todayCell.addEventListener('animationend', () => {
            todayCell.classList.remove('today-pulse');
        }, { once: true });
    });
}

// Announce the new month to screen readers via aria-live region.
// Using a live region avoids programmatic focus on the month title, which
// caused mobile browsers to disturb the flex layout of .calendar-header.
function announceMonthChange() {
    const announcer = document.getElementById('ariaAnnouncer');
    if (!announcer) return;
    // Clear first so repeated same-direction navigation always fires the announcement
    announcer.textContent = '';
    requestAnimationFrame(() => {
        announcer.textContent = `${MONTH_NAMES[getDisplayMonth()]} ${getDisplayYear()}`;
    });
}


/**
 * Show this month, pulse today's cell and announce it: the Today button's action, and the T key's
 * (calendar-keyboard.js → `initCalendarShortcuts`). Each caller has already refused a swipe in
 * progress, Team View (which has its own today) and the first-run prompt.
 */
function goToToday() {
    const now = new Date();
    setDisplayMonth(now.getMonth());
    setDisplayYear(now.getFullYear());
    renderCalendar();
    pulseToday();
    announceMonthChange();
}

document.getElementById('todayBtn')?.addEventListener('click', () => {
    if (isSwipeCooldown()) return;
    if (teamView.isTeamViewMode()) {
        teamView.jumpToCurrentWeek();   // Team View draws a first run itself, so 📍 works there too
    } else if (!isFirstRun()) {   // prompt is up — don't pulse/announce a month the user can't see
        goToToday();
    }
});

document.getElementById('nextMonth')?.addEventListener('click', (e) => {
    if (isSwipeCooldown()) return;
    if (isFirstRun()) return;   // don't drift the hidden month behind the first-run prompt
    if (/** @type {Element} */ (e.currentTarget).getAttribute('aria-disabled') === 'true') return;
    changeMonth(1);
    renderCalendar();
    announceMonthChange();
});

// Pay button — opens the calculator on the payslip PAID in the month being viewed (the 💷 in its
// grid), or, in the month we are in once its payday has been paid, the next one (`periodPaidInMonth`,
// paycalc-periods.js, which decides both), for anyone.
// DELIBERATELY NOT `navigateToPaycalc`, and not gated by `personalActionsAllowed`: that helper
// guards the routes that name a DAY (CALENDAR_DATA.md 14). This button names no member and no day:
// paycalc opens on the reader's OWN localStorage-namespaced data, or its own in-place login. So a
// reader tightening the helper must not believe this route inherits it.
document.getElementById('payBtn')?.addEventListener('click', () => {
    // paycalc shows its own in-place login for unsigned users — navigate there directly.
    const m = String(getDisplayMonth() + 1).padStart(2, '0');
    window.location.href = `./paycalc.html?month=${getDisplayYear()}-${m}`;
});

// lightboxPrintBtn is wired by the shared about-lightbox.js (initAboutLightbox below).

// Every "today" here is read at render time: re-render when the date turns (see `watchLocalDate`).
// (No pay-period strip under the controls — owner decision; payday stays on the grid's 💷/✂️ markers
// and the day panel's Pay estimate.)
// Before the first grant there is no workspace to repaint; the scheduler refuses that itself (rule 4).
// Team View's week follows the same rule as the month (`weekAfterDateChange`), moved BEFORE the repaint.
watchLocalDate((change) => {
    teamView.followDate(change);
    if (hasOverrideAccess()) redraw.repaint('date-turned');
}, { offToday: () => teamView.isOffThisWeek() });

document.getElementById('adminBtn')?.addEventListener('click', () => {
    const today = new Date();
    const isCurrentMonth = getDisplayMonth() === today.getMonth() && getDisplayYear() === today.getFullYear();
    const targetDate = isCurrentMonth ? today : new Date(getDisplayYear(), getDisplayMonth(), 1);
    const yyyy = String(targetDate.getFullYear()).padStart(4, '0');
    const mm   = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd   = String(targetDate.getDate()).padStart(2, '0');
    location.href = `admin.html?date=${yyyy}-${mm}-${dd}`;
});

document.getElementById('teamViewBtn')?.addEventListener('click', teamView.toggleTeamView);

(function initTeamTips() {
    // Team Week View's ? opens the app's ONE Tips panel (owner, 25 Nov 2026; calendar-tips.js says why). Its
    // button is redrawn on every renderTeamView(), so the click is delegated here rather than wired once.
    const tips = initTipsLightbox(CALENDAR_TIPS, { trigger: null });
    document.addEventListener('click', e => {
        const btn = /** @type {Element} */ (e.target).closest('#teamHelpBtn');
        if (btn && tips) tips.open(/** @type {HTMLElement} */ (btn).dataset.card ?? '');
    });
})();

// Modules are always deferred — the DOM is fully parsed before this code runs.
// No DOMContentLoaded wrapper needed; initialize directly.
try {
    // ── THE CALENDAR WORKSPACE — deferred until access is granted ────────────────────────────────
    //
    // Everything that puts ROSTER DATA on screen lives in here, and none of it runs until
    // `calendar-access.js` says this browser may see it. That is the primary gate, and it is a
    // structural one: until the first grant there is no member dropdown, no rendered grid, no Team
    // View and no override fetch — not hidden ones, ABSENT ones. Hiding a rendered Calendar behind an
    // overlay would leave the data in the DOM for a screen reader, a devtools pane, or one CSS rule
    // going missing. A re-lock cannot un-build the workspace, so it hides it and EMPTIES the grid
    // (the listeners at the foot).
    //
    // The SECOND gate is in calendar-overrides.js (THE ACCESS GATE), which refuses the reads at
    // source. Both exist because they fail differently: this one is a call-ORDER property that a
    // future edit could break silently, and that one is a refusal that it could not.
    //
    // What stays OUTSIDE: the header, the nav drawer, the About panel, the document viewers and the
    // splash dismissal. The guides are reachable without Calendar access on purpose. The document
    // viewers are wired here, but their reads open only with the grant (calendar-doc-access.js,
    // CALENDAR_DATA.md 15).
    _startCalendarWorkspace = async function startCalendarWorkspace() {
        // validateRosterPatterns() already ran at module load in roster-data.js.
        // Only run the team-member shape check here — it's unique to this file.
        const allErrors = validateTeamMembers();
        if (allErrors.length > 0) {
            console.error('⚠️ ROSTER DATA VALIDATION ERRORS:');
            allErrors.forEach(error => console.error('  - ' + error));
            const banner = document.getElementById('errorBanner');
            if (banner) {
                setStatus(banner, '⚠️ Some roster details couldn\'t load — please tell the admin.');
                banner.classList.add('visible');
            }
        }

        populateTeamMemberDropdown();
        updateLegend();

        // Show stale-member banner before branching on view mode so team-view users also see it.
        // takeStaleMemberName() is one-shot; renderCalendar() calls it again safely (returns null).
        const staleAtLoad = takeStaleMemberName();
        if (staleAtLoad) _showStaleMemberBanner(staleAtLoad, (/** @type {any} */ (getCurrentMember())).name);

        // Start the initial 3-month override fetch BEFORE the first render. It sets
        // _initialFetchInProgress + pre-claims the window's months, so the first renderCalendar's
        // ensureOverridesCached does not fire a COMPETING per-month fetch for the display month
        // (a duplicate read that doubled the month's reads on every launch).
        const _initialFetch = initInitialFetch({
            isTeamViewMode: () => teamView.isTeamViewMode(),
            // ONE callback for both surfaces: the scheduler asks which is on screen. The 3-month
            // fetch can resolve mid-swipe — an immediate Calendar render would wipe the carousel and
            // freeze the grid on the old month — and with Team View active when it lands, its grid is
            // repainted from the cache (see initInitialFetch's JSDoc for the two-sided stand-down).
            renderCalendar: _repaintAfterFirstLoad,
            renderTeamView: _repaintAfterFirstLoad,
            refetchTeamView: () => teamView.refetchShownWeek(),   // stale months released: re-READ, not repaint
            // Phase 2 (the authoritative server read) waits for this; phase 1 (the local-cache
            // paint) deliberately does not — see AUTH_AND_SESSIONS.md → "The two-phase load (E1)". The promise is ALREADY RESOLVED
            // whenever this runs (the whole workspace is deferred behind it); it is still passed,
            // because the retry path re-reads it and the two-phase structure keeps the gate legible.
            authReady: calendarAccessReady,
            // A read refused because ACCESS has gone reopens the sign-in card instead of looping on
            // the sync chip's retry. ONE call: it shuts the access state first and only then puts the
            // card up, so the local-cache path is never open behind it — see ACCESS LOST, below.
            onAccessLost: handleAccessLost,
        });
        _dismissSyncError = _initialFetch.dismissSyncError;

        // ── LET THE LOCAL CACHE WIN THE FIRST PAINT ──────────────────────────────────────────────
        //
        // Phase 1 of the initial fetch reads IndexedDB with no network and no session (Auth init
        // still gates it), and on a returning device it usually answers in a few milliseconds. A
        // first render fired SYNCHRONOUSLY beside it painted "Checking this month…" and then
        // repainted with data that had been milliseconds away.
        //
        // Bounded, and short. A cache MISS resolves false immediately, a slow read falls through at
        // the deadline, so nothing waits on a device that has nothing to show. This is the one place
        // in the boot where waiting is the faster answer.
        const _cachePainted = await Promise.race([
            _initialFetch.cacheSettled,
            new Promise(r => setTimeout(r, CACHE_FIRST_PAINT_MS)),
        ]);

        // Restore team view if the user was in it before the last refresh; else render the
        // personal calendar. renderCalendar() itself shows the first-run "choose your name"
        // prompt when no member is picked and no session exists (see its guard). (H1)
        if (lsGet(TEAM_VIEW) === '1') {
            teamView.restoreTeamView();
        } else if (_cachePainted !== true) {
            // SKIPPED when phase 1 already painted: it renders through this same path the moment
            // its cache read lands. Only the non-team case can skip — phase 1 runs before
            // `restoreTeamView`, so it always paints the CALENDAR, and a team-view member still
            // needs the restore.
            renderCalendar();
        }

        redraw.reach('surface');   // the ready metric may now time what is on screen
        _markReadyIfGridShown();

        // Swipe gesture handler — see calendar-swipe.js for full implementation.
        initSwipeHandler({
            isTeamViewMode: () => teamView.isTeamViewMode(),
            changeMonth,
            // Deferred: this dep only fires from restoreIncoming's background fetch callback,
            // which can resolve during a NEW gesture — or after Team View has opened.
            renderCalendar: _repaintAfterMonthRead,
            updateLegend,
            updateNavButtonState,
            openDayDetail: (cell) => openDayDetail?.(/** @type {HTMLElement} */ (cell)),
            onRetryMonth: retryMonth,
            announceMonthChange,
        });
    };

    // ── The splash comes down either way ────────────────────────────────────────────────────────
    // Outside the workspace function DELIBERATELY: a locked Calendar would otherwise sit behind the
    // splash for ever and the sign-in card would never be seen. The member sees either their roster
    // or a sign-in card, and never a loading screen with no way out.
    // (splash-watchdog.js is the backstop for the module graph failing entirely, not for this.)
    // It goes AT ONCE, a frame after the first render (index.css's splash block has why there is no fade).
    const splash = document.getElementById('splash');
    if (splash) requestAnimationFrame(() => splash.remove());

        // ── ICON LIGHTBOX / ABOUT PANEL ──
        // Lifecycle, SW status, bug link and print machinery are the shared about-lightbox.js; the
        // calendar adds content that swaps with the team-view mode (onOpen).
        (function() {
            const titleIcon = document.querySelector('.title-icon');
            if (!titleIcon) return;

            // Elements that swap depending on whether the calendar or team view is active
            const calendarTips  = document.getElementById('calendarTips');
            const teamViewTips  = document.getElementById('teamViewTips');
            const teamViewBadge = document.getElementById('teamViewBadge');
            const printBtn      = document.getElementById('lightboxPrintBtn');
            const printHint     = document.getElementById('lightboxPrintHint');

            const about = initAboutLightbox({
                appLabel: 'Marylebone Roster',
                // WHO IS REPORTING, as every other page says it: the signed-in member, or how the
                // Calendar was opened without one. The member on screen is a colleague's calendar as
                // often as the reader's own, so it has a line of its own.
                getUserName: () => getSession()?.name || 'Not signed in',
                getReportLines: () => [`Calendar shown: ${getAccessType() === 'none' ? 'None (locked)'
                    : isFirstRun() ? 'Not selected' : ((/** @type {any} */ (getCurrentMember()))?.name || 'Not selected')}`],
                onOpen() {
                    // Swap content based on current view mode
                    const inTeam = teamView.isTeamViewMode();
                    if (calendarTips)  calendarTips.hidden  = inTeam;
                    if (teamViewTips)  teamViewTips.hidden  = !inTeam;
                    if (teamViewBadge) teamViewBadge.hidden = !inTeam;
                    // The emoji keeps its own aria-hidden span, as the markup gives it: `textContent`
                    // would wipe it, and a screen reader would then say "printer".
                    if (printBtn)  printBtn.innerHTML    = '<span aria-hidden="true">🖨️</span> ' + (inTeam ? 'Print this week’s roster' : 'Print this calendar');
                    if (printHint) printHint.textContent = inTeam ? 'Prints in A4 landscape — select landscape in your print settings if needed' : 'Prints the current month’s calendar';
                },
                // Just print. The paper is decided by which VIEW is open, not by which control
                // reached the printer — `calendar-team-view.js`'s `applyTeamPrintPage` installs the
                // landscape @page while team view is active and removes it on the way out, so Ctrl+P,
                // File → Print and AirPrint print the same as this button.
                printFn() { window.print(); },
            });
            if (!about) return;

            // Calendar keeps its header logo opening About (no "back" target on
            // home). Also expose it so the nav-panel drawer logo opens the same panel.
            openAboutLightbox = about.open;
            // The logo opens the About panel — a keyboard-operable control. Its own label describes
            // the ACTION (the <img alt> stays the brand). About is also reachable via the drawer brand.
            const titleIconEl = /** @type {HTMLElement} */ (titleIcon);
            titleIconEl.setAttribute('role', 'button');
            titleIconEl.setAttribute('aria-label', 'About Marylebone Roster');
            titleIconEl.tabIndex = 0;
            titleIconEl.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); titleIconEl.click(); } });
            titleIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                about.open(); // Content adjusts based on teamViewMode inside onOpen()
            });
        })();

        // The month/year jump picker, opened from the month heading: calendar-month-jump.js.
        initMonthJump({ renderCalendar, announceMonthChange, getAccessType });

        // Keyboard shortcuts (desktop): ← → for a month or a week, T for today, P to print —
        // calendar-keyboard.js. The arrows PRESS Prev/Next and T is `goToToday`, so a key and a press
        // are one path. Registered here, before `initCalendarKeyboard` at the module tail, as before.
        initCalendarShortcuts({
            getAccessType,
            isTeamViewMode: () => teamView.isTeamViewMode(),
            isFirstRun,
            jumpToCurrentWeek: () => teamView.jumpToCurrentWeek(),
            goToToday,
            print: () => printOrExplain({ explain: () => explainNoPrint(confirmDialog) }),   // print-guard.js: a home-screen app on iOS 27 cannot print
        });

} catch (error) {
    console.error('[calendar] Initialisation error:', error);
    // Always hide the splash — an error banner is more useful than an infinite loading screen
    const splashEl = document.getElementById('splash');
    if (splashEl) splashEl.remove();
    const banner = document.getElementById('errorBanner');
    if (banner) {
        setStatus(banner, '⚠️ Couldn\'t start the calendar — please refresh the page.');
        banner.classList.add('visible');
    }
}

// ── INITIAL 3-MONTH FETCH + SYNC CHIP + VISIBILITY GUARD ── calendar-initial-fetch.js, started inside
// the init try-block ABOVE the first renderCalendar: it must set _initialFetchInProgress +
// pre-claim the 3 months before any render can fetch.

// ── PRINT HEADER — stamp timestamp before printing ──
// iOS Safari does not fire beforeprint when AirPrint is invoked, so we also stamp
// eagerly on load. The beforeprint handler is kept for desktop browsers, where it
// updates both attributes to the moment of printing.
function stampPrintDate() {
    // `printedStamp`, not a `dateStyle: 'long'` locale string, so this sheet spells a day as the
    // Team View one does. roster-data.js → "the provenance line every printable surface closes on"
    // has the argument and the other four.
    const now    = new Date();
    const header = document.querySelector('.header');
    if (!header) return;
    header.setAttribute('data-print-date', printedStamp(now, formatClock(now)));
    // First run (no member picked yet): don't stamp a default member onto the print header —
    // this also runs on `beforeprint`, so without the guard it would re-add the name that
    // showFirstRunPrompt() cleared. (H1)
    if (isFirstRun()) { header.removeAttribute('data-member-name'); return; }
    header.setAttribute('data-member-name', (/** @type {any} */ (getCurrentMember())).name);
}
stampPrintDate();
window.addEventListener('beforeprint', stampPrintDate);

// Small delay so any in-flight render cycle completes before the page tears down — and the reload
// asks AGAIN whether anyone is looking when it fires (the frozen-resume race is in sw-register.js).
registerServiceWorker({
    beforeReload: () => setTimeout(() => reloadWhileHidden(), 500),
    bfcache: true,
    // The Calendar is the app's opening page and the one staff reported as slow, and it is the only
    // page where an update can interrupt PURE READING — there is nothing here to save, so nothing to
    // ask about. `deferWhileVisible` holds the reload until the member looks away; the reasoning,
    // and why the pages with confirm dialogs deliberately do not get it, is in sw-register.js.
    deferWhileVisible: true,
});

// ── HUDDLE VIEWER — initialised via calendar-huddle-viewer.js ──
// `authReady` (persistence configured) is what the READ needs; `documentAccess` is what PERMITS it
// (owner decision: the Huddle, Circular and Newsletter are behind a sign-in). The two are separate
// on purpose. `authReady` is a promise the viewers can await with a bound; access is a GATE they
// consult and subscribe to, opened by the full grant in `initCalendarAccess` below and shut when
// access is lost — so a locked visitor's tap is answered with a message rather than a read, and a
// notification tap that landed on a sign-in card is finished the moment the member signs in.
// calendar-doc-access.js carries the argument, including why the local Firestore cache is the
// reason a rules change alone could not do this.
initHuddleViewer({ authReady, docAccess: documentAccess });

// ── CIRCULAR / NEWSLETTER VIEWER — opened from a #circular/#newsletter notification deep link ──
/** @type {(v?: any) => void} */ let _accessDecided = () => {};   // settled by initCalendarAccess below
initDocViewer({ authReady, docAccess: documentAccess, accessDecided: new Promise(r => { _accessDecided = r; }) });   // same gate


// `calendarAccessReady` (imported above) gates the initial fetch and the swipe hint; the telemetry
// block below waits on `calendarAuthReady` instead, and says why.


// ── PUSH NOTIFICATIONS — the one-off prompt strip and the silent renewal: calendar-notif-prompt.js ──
// Both access rules the block carries (named only) are argued in that module's header.
initNotifPrompt({ authReady: calendarAuthReady, getAccessType });

// The install strip. Wired AFTER the notification prompt's IIFE above, and it hides that strip
// when it shows — one ask at a time, install first, because on iOS notifications are impossible
// until the app is installed. The precedence rule and everything it turns on: install-prompt.js.
initInstallPrompt({ accessReady: calendarAuthReady, getAccessType });

// Tooltip and keyboard navigation — see calendar-keyboard.js.
initCalendarTooltip();
initCalendarKeyboard({ navigateToPaycalc, openDayDetail });
// Error reporter + usage counter both write to Firestore (need an auth context — AUTH_AND_SESSIONS.md
// 13), so they wait for ACCESS, and on a locked Calendar they never run: with no identity these
// writes would be rejected by every rule. The cost is worth stating — a sign-in that FAILS on this
// page is invisible to the error log, so it shows up in staff reports rather than in the Operations
// Error Log card.
// `calendarAuthReady`, NOT `calendarAccessReady`: every grant now holds a real user, so the two
// coincide — but every call below writes to Firestore, and the write gate is the right promise.
calendarAuthReady.finally(() => {
    initErrorReporter();
    // For the admin exclusion use the signed-in SESSION name, NOT the selected member: the default
    // selection is an admin (CONFIG.DEFAULT_MEMBER_NAME), and a selection says whose roster is on
    // screen, not who is looking. The SELECTED member is passed too, as a dedup key only, for a load
    // with nobody signed in (usage-reporter.js header) — one argument doing both meant a station PC
    // left on the admin's row dropped every staff open on it.
    //
    // The `isFirstRun()` guard is what makes the fallback safe: before a member picks anyone the
    // "selection" is only CONFIG.DEFAULT_MEMBER_NAME — an admin — so keying on it unguarded would
    // silently exclude every fresh visitor from both the usage counts and the migration metric.
    recordUsage('calendar', getSession()?.name || null, isFirstRun() ? null : getCurrentMember()?.name || null);
    // SPEED TAKES THE SESSION ONLY. Its identity does one job — leaving the admin's own opens out —
    // and the usage counts above keep the fallback, because there the name is also a dedup key.
    recordPageLatency('calendar', getSession()?.name || null);
});

// Back after a sign-out elsewhere must not put a member's roster on screen for whoever picks the
// device up next (page-session.js — every protected page installs the same guard).
reloadIfRestoredForSomeoneElse();
// A desktop at the Pages mirror is told where the app lives now (mirror-move.js); nothing anywhere else.
showMirrorBanner();
// The menu, built for the session saved NOW — which pills, whose name, Sign out.
// calendar-drawer.js decides it, and can build it again after a sign-in that does not reload.
wireCalendarDrawer({
    authReady: calendarAuthReady,
    onLogoClick: () => openAboutLightbox?.(),
    onSignOut: () => signOutAndLeave(),
    canReadDocuments: hasDocumentAccess,
});
// THE NEWSLETTER'S ☰ BUTTON FOLLOWS ITS LATEST ISSUE (newsletter-recency.js, owner, 14 Nov 2026). Asked
// HERE, once a load, as the documents open, through the gate a tap passes. Every page's drawer then
// reads the answer this device keeps; a locked Calendar asks nothing.
checkLatestNewsletter({ ready: calendarAuthReady, canRead: hasDocumentAccess, fetchLatest: getLatestNewsletter });
// …and the Circular's date for its row (doc-dates.js), the same way; the Huddle's comes from its own listener.
checkLatestCircular({ ready: calendarAuthReady, canRead: hasDocumentAccess, fetchLatest: getLatestCircular });

// ── Start the Calendar, or ask for a sign-in ─────────────────────────────────────────────────────
// The LAST thing the module does, deliberately: every shell subsystem above is wired first, so a
// locked visitor still has the nav drawer, the guides, the documents and the About panel. Only then
// is access decided, and only on `named` does the workspace exist at all.
// Whether a grant is the FIRST one is the start-up stage (calendar-redraw.js): `onGranted` reaches
// `workspace`, and `onEveryGrant` — which runs before it — reads that to tell "boot" from
// "re-grant". On boot the workspace does not exist yet and the repaint below would run against
// unbuilt state, so it must be skipped there and only there.

/** Settles when the forced set-password step has run, or was not due — the notices wait on it. */
/** @type {(v: any) => void} */ let _resolvePasswordForce = () => {};
const _passwordForceSettled = new Promise(resolve => { _resolvePasswordForce = resolve; });

/**
 * The "set your own password" step, on the Calendar — the front door is a sign-in, so this is where
 * most members sign in, and the one-shot marker that sign-in sets must be consumed here. Two things
 * about the shape:
 *   · Whether it could be due is asked HERE first (`passwordStepMayBeDue`: a sign-in marker, or no
 *     record that this device has seen the member's own password). `ensureNamedSession` has to run
 *     before it (below), and that must not become an unconditional step on every load of the app's
 *     most-opened page — the Calendar's boot is measured to the millisecond.
 *   · `ensureNamedSession` is passed as `ready`, not skipped. The Calendar's boot confirms an
 *     identity WITHOUT feeding the auth store, so `authStatus` would read unresolved, the gate would
 *     refuse, and the marker — consumed before the gate on purpose — would be gone for good. For a
 *     member already current it is a local check, no network.
 * Never rejects: the overlay fails open by design, and the notices queue behind this promise.
 * @returns {Promise<boolean>}
 */
async function _runPasswordForce() {
    const name = getSession()?.name;
    if (!name || getAccessType() !== 'named' || !passwordStepMayBeDue(name)) return false;
    try {
        return await initPasswordForce(name, { ready: ensureNamedSession(name).catch(() => false) });
    } catch (e) {
        console.warn('[Calendar] forced password step failed to run:', e);
        return false;
    }
}

/** The first grant's member-only steps: the claim sweep (else only in `ensureNamedSession`, which a
 *  named Calendar boot never calls) and the forced set-password step. Run from the ONE-SHOT
 *  `onGranted` — `grant()` sets the access type before calling it, so `named` is readable here, and
 *  a later grant is a RE-grant (a member signing in on a page granted before reloads it,
 *  calendar-access.js → `finishSignIn`). */
function _onFirstGrant() {
    if (getAccessType() !== 'named') { _resolvePasswordForce(false); return; }   // the notices need not wait
    refreshClaimsIfStale(CONFIG.CLAIM_EPOCH);   // fire-and-forget, one-shot per device per epoch
    _resolvePasswordForce(_runPasswordForce());
}

// ── ACCESS LOST, BY WHICHEVER ROUTE ──────────────────────────────────────────────────────────────
// Two routes notice a loss mid-session: the first load (`onAccessLost`, above) and a month read
// (navigation and Team View, through calendar-overrides.js). Both end in ONE call, `handleAccessLost`,
// which shuts the one access state and THEN puts the card up. What must follow a loss listens for
// that write in the module that owns it; this file shuts no gate (calendar-access-state.js says why).
// Clearing the member's stored copy (calendar-own-copy.js) and the grid is this file's: a Calendar
// that has lost access keeps neither — the card hides the month or week, but the page would still
// hold it; the next grant repaints it (`onEveryGrant`). Wired before access is decided, so neither
// can be missing when a read is refused.
setOverrideAccessLostHandler(handleAccessLost);
onCalendarAccess(({ open }) => { if (!open) clearSnapshot(); });
onCalendarAccess(({ open }) => { if (!open) document.getElementById('calendarDisplay')?.replaceChildren(); });

initCalendarAccess({
    // Synchronous, so the member's own copy is on screen before the decision's first await (calendar-own-copy.js).
    paintBeforeDecision: ownCopy.paintBeforeGrant,
    // A sign-in or come-back card means a person is about to type: the speed sample stops there
    // (perf-reporter.js → "A sample is time somebody spent waiting"). The sign-in card says so itself.
    onAwaitingInput: markAwaitingInput,
    // A sign-in on a card, granted WITHOUT a reload (calendar-access.js → `finishSignIn`): the two things
    // this page built at load for whoever was signed in then. The menu, for the member now (its pills,
    // their name, Sign out); and the Back guard, so a restore for them is not reloaded for nothing.
    // Everything else reads the session when it runs, or is built by the grant that follows.
    onSignedInInPlace: () => { rewireCalendarDrawer(); rebaseRestoreGuard(); },
    // EVERY grant, not just the first: what a re-lock takes away has to come back when access
    // returns. The roster reads and the documents are not reopened HERE: the grant opens both
    // itself, BEFORE this hook runs (calendar-access.js → `grant`, THE ONE WRITE). What is here is
    // the page's.
    onEveryGrant: () => {
        // The own-roster copy belongs to a NAMED grant; nothing else may inherit one.
        if (getAccessType() !== 'named') clearSnapshot();
        // A RE-grant also repaints. `grant()` un-hides the workspace exactly as the re-lock left it,
        // and nothing else asks for a render — every fetch in this app is pulled by one — so without
        // this a re-granted reader would look at the grid from BEFORE the lock. The repaint goes
        // through the ordinary paths on purpose: the grant has just cleared the month claims
        // (calendar-overrides.js → A GRANT IS A FRESH START), so `renderCalendar`'s own
        // `ensureOverridesCached` re-fetches the display month and the readiness model narrates it
        // honestly ("Checking this month" → grid). `restoreTeamView` is the team-side equivalent —
        // render + week fetch — and is safe to re-enter (`_pushOverlayState` dedupes its Back
        // handler; the chrome calls are idempotent).
        if (!redraw.reached('workspace')) return;
        if (teamView.isTeamViewMode()) teamView.restoreTeamView();
        else redraw.repaint('access-returned');
    },
    // ONCE: re-running this would re-wire the swipe handler and re-launch the initial 3-month fetch.
    onGranted: () => {
        redraw.reach('workspace');
        _onFirstGrant();
        // CAUGHT, because the workspace start is async (it awaits a bounded chance for the local
        // cache to paint first): an un-awaited async call with no catch would leave the member on
        // an empty workspace with nothing said. The catch SAYS so, as the synchronous start's does,
        // and rethrows on a fresh task so the Error Log still records it.
        Promise.resolve(_startCalendarWorkspace?.()).catch(err => {
            console.error('[Calendar] the workspace failed to start', err);
            const banner = document.getElementById('errorBanner');
            if (banner) {
                setStatus(banner, '⚠️ Couldn\'t start the calendar — please refresh the page.');
                banner.classList.add('visible');
            }
            setTimeout(() => { throw err; }, 0);
        });
    },
}).then((t) => {
    // Not a member's own grant — no access at all: the copy is not shown again. 'none' is also what a
    // silent sign-in still pending reads as, so that member loses the next open's instant paint.
    // Accepted (owner, 24 Nov 2026): keeping the copy instead would keep it after a sign-in that fails.
    if (t !== 'named') clearSnapshot();
    _accessDecided(t);
}, _accessDecided);

// The page's one-time notices live in calendar-notices.js (the /new-notice skill keeps the table of
// current ones; that header says which left early, and why they left this file). They queue behind
// the forced set-password step (above), the way the paycalc YTD notice does.
initCalendarNotices({ after: _passwordForceSettled });
