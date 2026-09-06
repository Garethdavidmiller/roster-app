// @ts-check
/**
 * calendar-app.js — Calendar UI for index.html.
 *
 * Owns: month carousel, Team Week View, notification wiring, month-jump picker,
 *   day-detail lightbox, About lightbox wiring.
 * Does NOT own: rendering (calendar-renderer.js), override cache (calendar-overrides.js),
 *   member selection (calendar-member.js), swipe (calendar-swipe.js),
 *   sync chip + initial fetch (calendar-initial-fetch.js),
 *   AL lightbox (calendar-al-lightbox.js), roster data (roster-data.js).
 * Edit here for: calendar state, event wiring, initial data fetch.
 * Do not edit here for: pay maths, admin features, override entry.
 */

import { CONFIG, MONTH_NAMES, computeEaster, getPaydaysAndCutoffs, formatISO } from './roster-data.js';
import { authReady, authBootstrap } from './firebase-client.js';
import { lsGet, lsSet } from './ls.js';
import { getSession, clearSession } from './session.js';   // reconcileExpiredIdentity now runs inside calendar-access.js
import { canOpenOvertime } from './auth-policy.js';       // nav-drawer pill gating only — never a boundary
import { initTeamView } from './calendar-team-view.js';
import { initNavPanel } from './nav-panel.js';
import { notifSupported, getNotifState, enableNotifications } from './notif.js';
import { _pushOverlayState, _clearOverlayHistory, createLightbox } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { initCalendarNotices } from './calendar-notices.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady, markMilestone } from './perf-reporter.js';
import { initHuddleViewer } from './calendar-huddle-viewer.js';
import { initDocViewer } from './calendar-doc-viewer.js';
import { rosterOverridesCache, ensureOverridesCached, getShiftTypesInMonth, _initialFetchInProgress, setOverrideAccess, setOverrideAccessLostHandler, monthKey, clearFetchedMonth } from './calendar-overrides.js';
import { forget as forgetOverrideKnowledge, knowledgeOf, decideDisplay, showsRoster } from './calendar-data-state.js';
import { initCalendarAccess, calendarAccessReady, calendarAuthReady, getAccessType, isViewerMode, lockCalendar, handleAccessLost } from './calendar-access.js';
import { getCurrentMember, getSelectedMemberIndex, saveSelectedMember, populateTeamMemberDropdown, validateTeamMembers, takeStaleMemberName, isFirstRun } from './calendar-member.js';
import { buildCalendarContainer } from './calendar-renderer.js';
import { getDisplayMonth, getDisplayYear, setDisplayMonth, setDisplayYear, changeDisplay, persistViewedMonth } from './calendar-state.js';
import { initSwipeHandler, isSwipeCooldown, isSwipeGestureActive } from './calendar-swipe.js';
import { initCalendarLightboxes } from './calendar-al-lightbox.js';
import { initInitialFetch } from './calendar-initial-fetch.js';
import { initInstallPrompt } from './install-prompt.js';
import { applyTextScale } from './text-scale.js';
import { initCalendarTooltip, initCalendarKeyboard } from './calendar-keyboard.js';

import { setStatus } from './status-text.js';
// ── THE CALENDAR ACCESS BOOTSTRAP (v20.12) ──────────────────────────────────────────────────────
//
// This replaced an unconditional `signInAnonymously` fallback. That existed because `overrides` was
// world-readable (`allow read;`) and the Calendar's best-effort WRITES — the error reporter, the
// usage counter, the push-subscription renewal — still needed `request.auth != null`. Override reads
// now require a real member `name` claim or the shared `calendarViewer` capability, so an anonymous
// identity would grant nothing at all: it would be a round trip that buys a token no rule accepts.
// Do not re-add it "so telemetry keeps working" — a locked Calendar recording a page view it never
// showed is not a measurement worth an authenticated session for.
//
// `calendarAccessReady` (calendar-access.js) is the replacement, and it is a stronger promise than
// the one it replaces: it resolves only when this browser may actually SEE the roster.
//
// `_startCalendarWorkspace` is assigned inside the init try-block below and invoked once, from the
// access callback at the module tail. It is a `let` rather than a hoisted function declaration
// precisely so that the assignment sits with the code it initialises.
/** @type {(() => void)|null} */
let _startCalendarWorkspace = null;

/** How long the boot will wait for the local override cache before painting anything (v21.29).
 *  Short on purpose: it is a chance for the cache to win, not a loading state. Long enough for an
 *  IndexedDB read that has already started, far too short to be noticed if it misses. */
const CACHE_FIRST_PAINT_MS = 90;

/**
 * Mark the page ready ONLY when a real roster grid is on screen.
 *
 * `markPageReady` used to be called unconditionally after the first render — and that render is
 * frequently "Checking this month…", because a withheld grid is exactly what the knowledge model
 * produces while the override state is unknown. So the App Speed card's "usable" figure was timing
 * the moment the Calendar finished deciding it had nothing to show yet, which is the opposite of
 * usable, and it did so most often on the SLOWEST loads — the ones where the data had not arrived.
 *
 * `render` and `stale` are both real grids: one is current, the other is labelled last-known. Both
 * are a roster the member can read, which is what the metric claims to measure. `loading` and
 * `unavailable` are not, and neither may be timed as though it were.
 *
 * Idempotent downstream (the first `markPageReady` wins), so this is safe to call after every
 * render — which is the point: whichever render first puts a grid up is the one that counts.
 */
function _markReadyIfGridShown() {
    try {
        // NOT BEFORE THE BOOT HAS CHOSEN ITS SURFACE. Phase 1 of the initial fetch paints from the
        // local cache and calls back, and on a cache hit that happens BEFORE `restoreTeamView()`
        // has run — so `isTeamViewMode()` is still false and a team-view member's readiness would
        // be timed against a Calendar grid they are about to be taken off. The boot sets this the
        // instant it has rendered, so the mark lands within the same tick either way.
        if (!_bootSurfaceDecided) return;
        // ASK THE SURFACE THAT IS ON SCREEN. Team View gates on the WORST knowledge across the
        // months its week spans, and a week routinely spans two — so reading the Calendar's display
        // month here would time the wrong thing in both directions. Each surface computes its own
        // answer; what COUNTS as a roster is `showsRoster`, beside the states it reads.
        if (_teamView?.isTeamViewMode()) {
            // `isGridConfirmed()` is Team View's own word for authoritative, so it answers the same
            // question `display` answers below: did the network serve this grid, or the cache?
            if (_teamView.isGridShown()) markPageReady(_teamView.isGridConfirmed() ? 'fetched' : 'cached');
            // BOTH RUNGS, NOT JUST THE FIRST (v21.37, external review). This branch used to return
            // here, so a launch that restored straight into Team View was counted at "Shifts shown"
            // and never at "Confirmed" — the surface simply dropped out of the ladder at the far
            // end. Harmless for the roster (the grid was right either way) and NOT harmless for the
            // decision the ladder exists to inform: LATENCY_PLAN.md reads the gap between those two
            // rungs to decide whether narrower Firestore reads are worth doing, and a whole surface
            // missing from one end widens that gap for free.
            if (_teamView.isGridConfirmed()) markMilestone('rosterLive');
            return;
        }
        const display = decideDisplay(knowledgeOf(monthKey(getDisplayYear(), getDisplayMonth())));
        // WHAT SERVED IT, not merely that something did (v21.99). The two display states that count
        // as a roster already carry the answer — `render` means the authoritative read landed,
        // `stale` means the local cache did and phase 2 has not returned. That distinction is the
        // whole of `LATENCY_PLAN.md` Phase 2's value: narrowing the server read cannot move a load
        // the cache already served. Derived here rather than tracked separately, so it can never
        // disagree with the grid it describes.
        if (showsRoster(display)) markPageReady(display === 'render' ? 'fetched' : 'cached');
        // The LAST rung, and the reason `ready` is not the end of the ladder: a device can put
        // yesterday's roster up instantly and take another two seconds to confirm it. Without this
        // the card would call that load fast, which for a member checking whether their shift
        // changed is the one question the cached grid cannot answer.
        if (display === 'render') markMilestone('rosterLive');
    } catch { /* the metric must never be able to break the boot */ }
}

/** True once the boot has rendered EITHER the Calendar or Team View, so the ready metric knows
 *  which surface it is measuring. See `_markReadyIfGridShown`. */
let _bootSurfaceDecided = false;

// ── THE FIRST TWO RUNGS OF THE START LADDER (v21.29) ────────────────────────────────────────────
//
// Marked HERE rather than inside the modules that own these events, and that is deliberate: both
// would otherwise need `perf-reporter.js`, which imports `firebase-client.js` — so marking inside
// `firebase-client` would be an import cycle, and marking inside `calendar-access` would put
// telemetry in the one module whose job is to decide whether this browser may see anything at all.
// Observed from outside, the instants are the same to within a microtask.
//
// Deliberately NOT awaited by anything. A milestone is a record of when something happened; it must
// never become a thing the boot waits for.
authBootstrap.then(() => markMilestone('authBoot')).catch(() => { /* never rejects */ });
calendarAccessReady.then(() => markMilestone('access')).catch(() => { /* never rejects */ });

/** Set once `initTeamView` has run. Module-scope because `_markReadyIfGridShown` is declared above
 *  the coordinator's init block and must not close over a `teamView` that does not exist yet.
 *  @type {any} */
let _teamView = null;

// ============================================
// CEA ROSTER CALENDAR
// ============================================
// Performance Optimizations:
// - Member fetched once per render (not 31+ times)
// - Bank holidays computed on demand from roster-data.js
// - Pure functions for predictable behavior
// - CSS variables for instant theme changes
// ============================================

// CONFIG.APP_VERSION is set in roster-data.js from the exported APP_VERSION constant.
// No manual version override needed here.


// Assigned by the About-lightbox IIFE; lets the nav-panel drawer logo open the
// same About panel that the header logo opens on the calendar page.
/** @type {any} */
let openAboutLightbox = null;

// Returned by initCalendarLightboxes(); lets a day-cell tap (touch devices)
// surface the same shift label / extras / override note that desktop users get
// from the hover tooltip, and lets renderCalendar() close the AL lightbox on
// member change (stale data). Both handles are ready before the swipe init.
// NOT deferred behind Calendar access, and checked rather than assumed (v20.12). This attaches
// handlers; it fetches nothing. The AL lightbox's own Firestore read happens in its `onOpen`, fired
// by `#alBtn`, which lives inside `#calendarControls` — hidden while locked, so out of the
// accessibility tree and out of tab order. And that read is a plain `getDocs`, which is SERVER-first,
// so the tightened rule denies it outright: there is no cache path here for the gate to have to
// cover. Same reasoning for `initCalendarTooltip`/`initCalendarKeyboard` further down — with
// `#calendarDisplay` empty they have nothing to act on.
const { openDayDetail, closeALLightbox } = initCalendarLightboxes({ navigateToPaycalc });

// (Calendar display state lives in calendar-state.js; swipe cooldown in calendar-swipe.js)

// ============================================
// TEAM VIEW
// ============================================
const teamView = initTeamView({
    rosterOverridesCache,
    ensureOverridesCached,
    monthKey,
    clearFetchedMonth,
    getSelectedMemberIndex,
    isFirstRun,
    renderCalendar,
    _pushOverlayState,
    _clearOverlayHistory,
});
_teamView = teamView;   // see `_markReadyIfGridShown` — the ready metric asks whichever surface is on screen


// ============================================
// MONTH NAVIGATION
// ============================================

// Central month navigation — all buttons, keyboard and swipe go through here.
// State change is pure (calendar-state.js); this wrapper adds the UI side-effect.
/** @param {any} delta */
function changeMonth(delta) {
    changeDisplay(delta);
    dismissSwipeHint();
}

// Show a one-time swipe hint on the calendar for first-time visitors.
// Only shown on touch devices — desktop users navigate with Prev/Next buttons.
// Dismissed permanently on the first month navigation (swipe or button), or
// auto-dismissed after 6s — without the timer, a user who saw the hint but
// didn't navigate would be shown it again on every reload.
// The phone's text scale, stamped on <html> before anything is laid out, so the action row can go
// compact where five buttons would otherwise wrap (text-scale.js has the reasoning and the numbers).
applyTextScale(document);

(function initSwipeHint() {
    if (lsGet('myb_swipe_hint_seen')) return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const hint = document.getElementById('swipeHint');
    if (!hint) return;
    hint.style.display = '';
    setTimeout(dismissSwipeHint, 6000);
})();

function dismissSwipeHint() {
    const hint = document.getElementById('swipeHint');
    if (!hint || hint.style.display === 'none') return;
    lsSet('myb_swipe_hint_seen', '1');
    hint.classList.add('fade-out');
    setTimeout(() => { hint.style.display = 'none'; hint.classList.remove('fade-out'); }, 400);
}


// Navigate to the pay calculator for a given payday ISO date string.
// Goes straight to ./paycalc.html — paycalc does its own in-place login when needed (it no longer
// bounces through admin.html to authenticate). Always call this helper — never duplicate the nav logic.
/** @param {any} paydayStr */
function navigateToPaycalc(paydayStr) {
    // paycalc handles its own in-place sign-in for unsigned users (Option B, v14.45+), so go
    // there directly — the ?payday= param survives the post-login reload. (Previously this
    // bounced unsigned users to admin?redirect=paycalc, which no longer returns here.)
    window.location.href = `./paycalc.html?payday=${paydayStr}`;
}


// AL and day-detail lightboxes initialised above via initCalendarLightboxes().

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

// updateLegend — shows/hides conditional legend items:
//   Spare/RDW/AL/Absent(sick)/Other — only when that shift type actually appears this month
//     (row 2 as a whole is hidden when none of them do)
//   Night        — only for Dispatcher roster members
//   🎄 Christmas — only in December
//   🐣 Easter    — only in the month Easter Sunday falls in
// Called inside renderCalendar() on every navigation.
/** @param {any} id */
function _legendEl(id) {
    return document.getElementById(id);
}

function updateLegend() {
    const member = getCurrentMember();

    // Spare / RDW / AL — conditional on whether they appear this month
    const typesThisMonth = member
        ? getShiftTypesInMonth(member, getDisplayYear(), getDisplayMonth())
        : new Set();
    const setLegendItemVisible = /** @param {any} id @param {any} visible */ (id, visible) => { const legendItem = _legendEl(id); if (legendItem) legendItem.style.display = visible ? '' : 'none'; };
    setLegendItemVisible('legend-spare', typesThisMonth.has('SPARE'));
    setLegendItemVisible('legend-rdw',   typesThisMonth.has('RDW'));
    setLegendItemVisible('legend-al',    typesThisMonth.has('AL'));
    setLegendItemVisible('legend-sick',  typesThisMonth.has('SICK'));
    setLegendItemVisible('legend-other',   typesThisMonth.has('OTHER'));
    // Hide the whole row-2 if all five are absent
    const row2 = _legendEl('legend-row-2');
    if (row2) row2.style.display = (typesThisMonth.has('SPARE') || typesThisMonth.has('RDW') || typesThisMonth.has('AL') || typesThisMonth.has('SICK') || typesThisMonth.has('OTHER')) ? '' : 'none';

    const isDispatcher = member && (/** @type {any} */ (member)).rosterType === 'dispatcher';
    const nightItem = _legendEl('legend-night');
    if (nightItem) nightItem.style.display = isDispatcher ? '' : 'none';

    const christmasItem = _legendEl('legend-christmas');
    if (christmasItem) christmasItem.style.display = getDisplayMonth() === 11 ? '' : 'none';

    // Easter Sunday can fall in March or April — check which month it's in this year
    const easterItem = _legendEl('legend-easter');
    if (easterItem) {
        const easterSunMonth = computeEaster(getDisplayYear()).getMonth();
        easterItem.style.display = getDisplayMonth() === easterSunMonth ? '' : 'none';
    }

    // ── And whether the legend is shown AT ALL (v20.41) ─────────────────────────────────────────
    //
    // The legend is a KEY to the grid, so it goes when the grid does: with the month withheld it
    // keys nothing, and being derived from the BASE roster it would go on announcing this month's
    // shift types beside a panel saying we do not yet know them.
    //
    // HERE and not in renderCalendar, which is where v20.40 put it and where it was wrong. A swipe
    // COMMIT calls updateLegend() but never renderCalendar() — the incoming carousel panel simply
    // becomes the live view — so the decision was skipped on exactly the navigation people use most.
    // Both directions were broken: swipe from a withheld month onto a good one and the legend stayed
    // hidden until some later full render; swipe onto an unfetched one and it stayed up over the wait
    // panel. `updateLegend` is the one function every path calls, which makes it the choke point,
    // the same argument that put the grid gate in `buildCalendarContainer` rather than here.
    //
    // Team View owns the legend while it is active (applyTeamViewChrome hides it), so we stand down;
    // exiting it calls renderCalendar, which comes back through here and settles the real answer.
    const legendEl = /** @type {HTMLElement|null} */ (document.querySelector('.legend'));
    if (legendEl && !teamView.isTeamViewMode()) {
        const shown = decideDisplay(knowledgeOf(monthKey(getDisplayYear(), getDisplayMonth())));
        legendEl.style.display = (shown === 'render' || shown === 'stale') ? '' : 'none';
    }
}

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
    banner.textContent = `"${staleName}" is no longer in the roster — showing ${fallbackName}'s calendar. Use the dropdown to select the correct person.`;
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 30000);
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
          '<p>Pick your name from the menu above, and your roster will appear.</p>' +
        '</div>';
    // Don't leave a real member's name on the print header while no one is selected.
    document.querySelector('.header')?.removeAttribute('data-member-name');
    // Announce to screen readers — the prompt replaces the calendar grid silently otherwise.
    const announcer = document.getElementById('ariaAnnouncer');
    if (announcer) {
        announcer.textContent = '';
        requestAnimationFrame(() => {
            announcer.textContent = 'Choose your name from the menu above to see your shifts.';
        });
    }
}

/**
 * "Try again" from the withheld-grid panel (v20.40) — the recovery for a month whose overrides
 * could not be read, where before there was nothing to press because the base roster simply went up
 * as though it were current.
 *
 * Forgets the month BEFORE re-fetching, on purpose: that repaints the wait state immediately, so a
 * press on a slow connection visibly does something instead of leaving the failure panel sitting
 * there. `clearFetchedMonth` re-arms both the fetch (it releases the claim) and the one-shot failure
 * repaint, so a second failure is reported rather than swallowed.
 * @param {number} year
 * @param {number} month - 0-indexed
 */
function retryMonth(year, month) {
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
        if (isFirstRun()) { showFirstRunPrompt(); return; }
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

        document.title = `Marylebone Roster — ${MONTH_NAMES[getDisplayMonth()]} ${getDisplayYear()}`;

        // Persist so the user returns to the same month after closing the app
        persistViewedMonth();

        const calendarContainer = buildCalendarContainer(getDisplayMonth(), getDisplayYear(), {
            navigateToPaycalc,
            onDayDetail: /** @param {any} cell */ (cell) => openDayDetail?.(cell),
            // No button while the initial 3-month fetch is still running: the sync chip in the
            // header is already the retry for that, and a second control racing a per-month fetch
            // against the in-flight range fetch is the v18.76 two-authoritative-reconcilers bug
            // (the later, staler snapshot evicts what the earlier one just loaded).
            onRetryMonth: _initialFetchInProgress ? undefined : retryMonth,
        });
        // Preserve keyboard focus across the re-render. Wiping #calendarDisplay drops focus to
        // <body>, after which calendar-app.js's document keydown handler treats arrows as MONTH
        // jumps instead of day steps. Capture whether a day cell was focused, then restore the new
        // roving anchor below. Doing it HERE (the render choke point) covers BOTH the synchronous
        // PageUp/Down month change AND the async override-fetch re-render that follows when paging
        // beyond the cached window (v16.55) — the case a keyboard-only fix in calendar-keyboard.js
        // missed. preventScroll so a background re-render can't yank the viewport.
        const _hadCellFocus = document.activeElement instanceof HTMLElement
            && document.activeElement.classList.contains('calendar-day');
        calendarDisplay.innerHTML = '';
        calendarDisplay.appendChild(calendarContainer);
        if (_hadCellFocus) {
            /** @type {HTMLElement|null} */
            (calendarContainer.querySelector('.calendar-day:not(.other-month)[tabindex="0"]'))?.focus({ preventScroll: true });
        }

        updateNavButtonState();

        // Ensure Firestore overrides are cached for the displayed month.
        // No-op if already fetched; fires a background fetch and re-render if not
        // (e.g. when the user navigates beyond the initial 3-month window).
        // Skipped while the initial 3-month fetch is in flight to avoid a competing
        // fetch that could race against it and produce a blank re-render mid-load.
        if (!_initialFetchInProgress) {
            const _mAtFetch = getSelectedMemberIndex();
            ensureOverridesCached(getDisplayYear(), getDisplayMonth(), () => {
                if (!teamView.isTeamViewMode() && getSelectedMemberIndex() === _mAtFetch) renderCalendarWhenIdle();
            });
        }

    } catch (error) {
        console.error('[calendar] Error rendering calendar:', error);
        const calendarDisplay = document.getElementById('calendarDisplay');
        if (calendarDisplay) {
            const errDiv = document.createElement('div');
            errDiv.className = 'calendar-error';
            errDiv.setAttribute('role', 'alert');
            errDiv.innerHTML = '<h2><span aria-hidden="true">⚠️</span> Couldn\'t display your roster</h2><p>Close the app and open it again. If it keeps happening, check your connection or contact the admin.</p>';
            calendarDisplay.innerHTML = '';
            calendarDisplay.appendChild(errDiv);
        }
    }
}


// ============================================
// EVENT LISTENERS
// ============================================

// Deferred background render (v16.23). renderCalendar wipes #calendarDisplay — a BACKGROUND
// caller (initial-fetch resolution, override-fetch callback) firing mid-gesture detached the
// swipe carousel's panels: the commit then animated dead nodes and the screen stayed frozen on
// the OLD month while title/legend/persisted state advanced to the new one. Defer until no
// gesture is live (pointerdown → resolution, plus the commit cooldown). Single pending timer.
/** @type {ReturnType<typeof setTimeout>|null} */
let _pendingIdleRender = null;
function renderCalendarWhenIdle() {
    // Guard team-view mode on BOTH branches (was only on the deferred retry below) so the direct
    // path can never paint the personal calendar into #calendarDisplay while team view is active —
    // self-consistent regardless of whether a future caller pre-checks the mode.
    if (!isSwipeGestureActive()) { if (!teamView.isTeamViewMode()) renderCalendar(); return; }
    if (_pendingIdleRender) return;
    _pendingIdleRender = setTimeout(function retry() {
        if (isSwipeGestureActive()) { _pendingIdleRender = setTimeout(retry, 120); return; }
        _pendingIdleRender = null;
        if (!teamView.isTeamViewMode()) renderCalendar();
    }, 120);
}

const _teamMemberSelect = /** @type {HTMLSelectElement} */ (document.getElementById('teamMemberSelect'));
/** @type {ReturnType<typeof setTimeout>|null} */
let _pendingMemberApply = null;
/** Apply the dropdown's CURRENT selection (read live so a value change during the wait is honoured). */
function _applyTeamMemberChange() {
    saveSelectedMember(parseInt(_teamMemberSelect.value, 10));
    // Only repaint the personal calendar when NOT in team view. A change deferred past the swipe
    // cooldown can resolve AFTER the user entered Team View; renderCalendar would then paint the
    // personal calendar into the shared display while the mode/button still read "team view" (v16.21).
    if (!teamView.isTeamViewMode()) renderCalendar();
    // Close AL lightbox if open — data would be stale for the new member
    closeALLightbox?.();
}
// `?.` null-guard (matches the #prevMonth handler below): this is attached at MODULE SCOPE, before
// the init try/catch, so an uncaught throw here (were #teamMemberSelect ever renamed/absent) would
// blank-splash the whole app. `_applyTeamMemberChange` only runs from inside this listener, so a null
// element simply attaches nothing.
_teamMemberSelect?.addEventListener('change', () => {
    // During the ~400ms swipe cooldown, don't apply immediately (it would fight the swipe
    // animation) — but NEVER silently drop the change: the native <select> value has already
    // moved, so bare-returning left the dropdown showing member B over member A's roster
    // permanently (getCurrentMember keeps reading the saved OLD member) until a reselect/reload.
    // Defer instead, re-reading the live value so a later pick during the wait still wins (v16.19).
    // Gate on the FULL gesture window (v16.23), not just the post-intent cooldown — the poll
    // could otherwise fire renderCalendar inside a NEW gesture's pre-intent dead zone (finger
    // down, <5px moved), detaching the freshly-parked carousel panels (the D1 desync).
    if (isSwipeGestureActive()) {
        // Single pending timer: repeated changes during the cooldown must not stack N independent
        // pollers (each would fire its own apply). The live re-read means the latest pick wins (v16.21).
        if (_pendingMemberApply) return;
        _pendingMemberApply = setTimeout(function retry() {
            if (isSwipeGestureActive()) { _pendingMemberApply = setTimeout(retry, 60); return; }
            _pendingMemberApply = null;
            _applyTeamMemberChange();
        }, 60);
        return;
    }
    _applyTeamMemberChange();
});


document.getElementById('prevMonth')?.addEventListener('click', (e) => {
    if (isSwipeCooldown()) return;
    // During first run renderCalendar() early-returns to keep the "choose your name" prompt up, so
    // changeMonth() would silently drift the hidden month/year and the calendar later renders on the
    // wrong month instead of today. No-op the relative nav until a name is chosen (v16.21).
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


document.getElementById('todayBtn')?.addEventListener('click', () => {
    if (isSwipeCooldown()) return;
    if (isFirstRun()) return;   // prompt is up — don't pulse/announce a month the user can't see (v16.23)
    if (teamView.isTeamViewMode()) {
        teamView.jumpToCurrentWeek();
    } else {
        const now = new Date();
        setDisplayMonth(now.getMonth());
        setDisplayYear(now.getFullYear());
        renderCalendar();
        pulseToday();
        announceMonthChange();
    }
});

document.getElementById('nextMonth')?.addEventListener('click', (e) => {
    if (isSwipeCooldown()) return;
    if (isFirstRun()) return;   // don't drift the hidden month behind the first-run prompt (v16.21)
    if (/** @type {Element} */ (e.currentTarget).getAttribute('aria-disabled') === 'true') return;
    changeMonth(1);
    renderCalendar();
    announceMonthChange();
});

// Pay button — navigates to paycalc.html for any staff member.
// No session needed here: paycalc runs its own in-place login (via navigateToPaycalc).
document.getElementById('payBtn')?.addEventListener('click', () => {
    // paycalc shows its own in-place login for unsigned users — navigate there directly.
    const m = String(getDisplayMonth() + 1).padStart(2, '0');
    window.location.href = `./paycalc.html?month=${getDisplayYear()}-${m}`;
});

// lightboxPrintBtn is wired by the shared about-lightbox.js (initAboutLightbox below).

// Pay period strip — shows the current pay period dates + link to the pay calculator.
// Only shown when a session exists (same condition as the pay button navigation).
(function initPayPeriodStrip() {
    const strip = document.getElementById('payPeriodStrip');
    if (!strip) return;
    const session = getSession();
    if (!session?.name) return; // Not logged in — hide the strip entirely

    const today = new Date();
    let period  = null;

    for (const yr of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
        const { paydays, cutoffs } = getPaydaysAndCutoffs(yr);
        for (let i = 0; i < paydays.length; i++) {
            const payday = paydays[i];
            // Use the cutoff getPaydaysAndCutoffs already computed ("most recent Saturday before
            // payday") instead of a fixed payday−6. When a bank holiday shifts a payday off Friday
            // (e.g. Good Friday → Thursday), payday−6 lands on Friday, one day before the true
            // Saturday cutoff — so the displayed range and the on/off window were a day early.
            const cutoff = cutoffs[i];
            const start  = new Date(cutoff);  start.setDate(start.getDate() - 27);
            // Compare date-only strings: payday is at noon, so today <= payday (timestamp)
            // would hide the strip from midday onwards on the actual payday. ISO string
            // comparison is lexicographically correct for zero-padded YYYY-MM-DD.
            if (formatISO(today) >= formatISO(start) && formatISO(today) <= formatISO(payday)) {
                period = { payday, cutoff, start }; break;
            }
        }
        if (period) break;
    }
    if (!period) return;

    const fmt    = /** @param {any} d */ d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
    const payISO = formatISO(period.payday);
    strip.innerHTML = `Pay period: <a class="pay-period-link" href="./paycalc.html?payday=${payISO}">${fmt(period.start)} – ${fmt(period.cutoff)}</a> · paid ${fmt(period.payday)}`;
    strip.style.display = '';
})();

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

(function initTeamLightboxes() {
    const lb = document.getElementById('teamInfoLightbox');
    if (!lb) return;

    // Shared canonical lifecycle — replaces a permanent document keydown
    // listener and a delayed (afterClose) focus restore that had drifted from
    // the pattern every other lightbox follows.
    const teamInfo = createLightbox({
        overlay:  lb,
        content:  /** @type {HTMLElement} */ (document.getElementById('teamInfoContent')),
        closeBtn: /** @type {HTMLElement} */ (document.getElementById('teamInfoClose')),
    });

    // Event delegation — #teamHelpBtn is re-created on every renderTeamView() call.
    document.addEventListener('click', e => {
        if (/** @type {Element} */ (e.target).closest('#teamHelpBtn')) teamInfo.open();
    });
})();

// Modules are always deferred — the DOM is fully parsed before this code runs.
// No DOMContentLoaded wrapper needed; initialize directly.
try {
    // ── THE CALENDAR WORKSPACE — deferred until access is granted (v20.12) ───────────────────────
    //
    // Everything that puts ROSTER DATA on screen lives in here, and none of it runs until
    // `calendar-access.js` says this browser may see it. That is the primary gate, and it is a
    // structural one: while the Calendar is locked there is no member dropdown, no rendered grid, no
    // Team View and no override fetch — not hidden ones, ABSENT ones. Hiding a rendered Calendar
    // behind an overlay would leave the data in the DOM for a screen reader, a devtools pane, or one
    // CSS rule going missing; there is nothing to reveal here because nothing was built.
    //
    // The SECOND gate is `setOverrideAccess` in calendar-overrides.js, which refuses the reads at
    // source. Both exist because they fail differently: this one is a call-ORDER property that a
    // future edit could break silently, and that one is a refusal that it could not.
    //
    // What stays OUTSIDE: the header, the nav drawer, the About panel, the document viewers and the
    // splash dismissal. The guides, the Huddle, the Circular and the Newsletter are reachable
    // without Calendar access on purpose — making somebody type the staff PIN to read the Railcard
    // guide would be locking the building to reach the noticeboard.
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

        // Show stale-member banner before branching on view mode so team-view
        // users also see "X removed from roster" on the next open.
        // takeStaleMemberName() is one-shot; renderCalendar() calls it again safely
        // (returns null) and won't show a duplicate banner.
        const staleAtLoad = takeStaleMemberName();
        if (staleAtLoad) _showStaleMemberBanner(staleAtLoad, (/** @type {any} */ (getCurrentMember())).name);

        // Start the initial 3-month override fetch BEFORE the first render (v16.23). It sets
        // _initialFetchInProgress + pre-claims the window's months, so the first renderCalendar's
        // ensureOverridesCached no longer fires a COMPETING per-month fetch for the display month —
        // that duplicate read logged a bogus "[Firestore] Duplicate override" warn per doc on
        // every launch and doubled the month's reads. (Previously called at the module tail.)
        const _initialFetch = initInitialFetch({
            isTeamViewMode: () => teamView.isTeamViewMode(),
            // Deferred: the 3-month fetch can resolve mid-swipe on a slow connection — an immediate
            // render would wipe the carousel and freeze the grid on the old month (v16.23).
            renderCalendar: () => { renderCalendarWhenIdle(); _markReadyIfGridShown(); },
            // Team view active when the 3-month fetch lands → repaint its grid from the cache
            // (v18.21 — without this an early/boot-time team view stayed base-roster-only: see
            // initInitialFetch's JSDoc for the two-sided stand-down).
            renderTeamView: () => { teamView.refreshFromCache(); _markReadyIfGridShown(); },
            // Phase 2 (the authoritative server read) waits for this; phase 1 (the local-cache
            // paint) deliberately does not — see AUTH_PLAN.md → E1. Since v20.12 the promise is
            // `calendarAccessReady`, which is ALREADY RESOLVED whenever this runs: the whole
            // workspace is deferred behind it. It is still passed rather than dropped, because the
            // retry path re-reads it and the two-phase structure is what makes the gate legible.
            authReady: calendarAccessReady,
            // A read refused because ACCESS has gone reopens the unlock card instead of looping on
            // the sync chip's retry, which an expired session can never satisfy (v20.12). The gate
            // is CLOSED first: re-locking the UI while override reads stayed permitted would leave
            // the local-cache path open behind the card.
            onAccessLost: () => { setOverrideAccess(false); handleAccessLost(); },
        });

        // ── LET THE LOCAL CACHE WIN THE FIRST PAINT (v21.29, external latency review) ────────────
        //
        // Phase 1 of the initial fetch reads IndexedDB with no network and no auth, and on a
        // returning device it usually answers in a few milliseconds. But the first render used to
        // fire SYNCHRONOUSLY beside it, so that device reliably painted "Checking this month…" and
        // then repainted with data that had been milliseconds away — the eye's first meaningful
        // impression of the app was a spinner it never needed to see.
        //
        // Bounded, and short. A cache MISS resolves false immediately, a slow read falls through at
        // the deadline, and either way the old behaviour follows — so nothing waits on a device that
        // has nothing to show. This is the one place in the boot where waiting is the faster answer.
        // WHEN THE DEVICE'S OWN SAVED COPY BECAME AVAILABLE (v22.95) — the ladder rung that splits
        // the Unlocked → Shifts shown gap. The 5 Sep 2026 field read put Unlocked at 58% over a
        // second and Shifts shown at 78%, with no rung between them to say where the eighteen
        // points went, and 98% of attributed starts are served from this very cache.
        //
        // MARKED HERE, in the coordinator, and not inside `calendar-initial-fetch.js` — the same
        // rule as the three rungs above: the modules that own these events do not carry telemetry.
        // It is not only tidiness. Importing `perf-reporter.js` into that module pulls the gstatic
        // Firebase graph into it, and its test suite stops loading at all; the first cut did
        // exactly that and `calendar-initial-fetch.test.mjs` refused to build.
        //
        // Only on a real hit: a device with no saved copy has no such moment, and giving it one
        // would put first-visit boots into a distribution about how quickly storage answers.
        // Attached BEFORE the race so a cache that settles fast is still marked — the race's own
        // timeout branch discards which promise won, and this must not depend on that.
        _initialFetch.cacheSettled
            .then(painted => { if (painted) markMilestone('rosterCached'); })
            .catch(() => { /* never rejects; here so a future change cannot make it unhandled */ });

        const _cachePainted = await Promise.race([
            _initialFetch.cacheSettled,
            new Promise(r => setTimeout(r, CACHE_FIRST_PAINT_MS)),
        ]);

        // Restore team view if the user was in it before the last refresh; else render the
        // personal calendar. renderCalendar() itself shows the first-run "choose your name"
        // prompt when no member is picked and no session exists (see its guard). (H1)
        if (lsGet('myb_team_view') === '1') {
            teamView.restoreTeamView();
        } else if (_cachePainted !== true) {
            // SKIPPED when phase 1 already painted: it renders through this same path the moment
            // its cache read lands, so rendering again here is a second full grid build a few
            // milliseconds later for an identical result. Only the non-team case can skip — phase 1
            // runs before `restoreTeamView`, so it always paints the CALENDAR, and a team-view
            // member still needs the restore below it.
            renderCalendar();
        }

        _bootSurfaceDecided = true;
        _markReadyIfGridShown();

        // Swipe gesture handler — see calendar-swipe.js for full implementation.
        initSwipeHandler({
            isTeamViewMode: () => teamView.isTeamViewMode(),
            changeMonth,
            // Deferred: this dep only fires from restoreIncoming's background fetch callback,
            // which can resolve during a NEW gesture (v16.23).
            renderCalendar: renderCalendarWhenIdle,
            updateLegend,
            updateNavButtonState,
            navigateToPaycalc,
            openDayDetail: (cell) => openDayDetail?.(/** @type {HTMLElement} */ (cell)),
            onRetryMonth: retryMonth,
        });
    };

    // ── The splash comes down either way ────────────────────────────────────────────────────────
    // Outside the workspace function DELIBERATELY. It used to sit after the first render, which was
    // right when the first render was unconditional; now a locked Calendar would sit behind the
    // splash for ever and the PIN panel would never be seen. Clearing it here means the member sees
    // either their roster or the unlock card, and never a loading screen with no way out.
    // (splash-watchdog.js is the backstop for the module graph failing entirely, not for this.)
    const splash = document.getElementById('splash');
    if (splash) {
        requestAnimationFrame(() => {
            splash.classList.add('hidden');
            // Fallback timer — iOS may not fire transitionend if the tab is backgrounded mid-fade.
            const splashFallback = setTimeout(() => splash.remove(), 1000);
            splash.addEventListener('transitionend', () => {
                clearTimeout(splashFallback);
                splash.remove();
            }, { once: true });
        });
    }

        // ============================================
        // ICON LIGHTBOX / ABOUT PANEL
        // Lifecycle, SW status, bug link, and print machinery are the shared
        // about-lightbox.js. The calendar adds two page-specific behaviours:
        // content that swaps with the team-view mode (onOpen) and a landscape
        // @page rule when printing the team week (printFn).
        // ============================================
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
                getUserName: () => isFirstRun() ? 'Not selected' : ((/** @type {any} */ (getCurrentMember()))?.name || 'Not selected'),
                onOpen() {
                    // Swap content based on current view mode
                    const inTeam = teamView.isTeamViewMode();
                    if (calendarTips)  calendarTips.hidden  = inTeam;
                    if (teamViewTips)  teamViewTips.hidden  = !inTeam;
                    if (teamViewBadge) teamViewBadge.hidden = !inTeam;
                    if (printBtn)  printBtn.textContent  = inTeam ? '🖨️ Print this week\'s roster' : '🖨️ Print this calendar';
                    if (printHint) printHint.textContent = inTeam ? 'Prints in A4 landscape — select landscape in your print settings if needed' : 'Prints the current month\'s calendar';
                },
                // Team view prints in landscape; calendar uses the stylesheet's portrait @page.
                printFn() {
                    // Always clear a leaked team-view @page from a PRIOR print first. afterprint is
                    // unreliable on iOS Safari and when the dialog is cancelled, so the landscape rule
                    // could linger and flip the NEXT (portrait) calendar print to landscape. Clearing
                    // at the top of BOTH branches, plus a single reused id (never stack orphans),
                    // guarantees each print starts from the right page orientation (v16.21).
                    document.getElementById('tvPrintPage')?.remove();
                    if (teamView.isTeamViewMode()) {
                        const ls = document.createElement('style');
                        ls.id = 'tvPrintPage';
                        ls.textContent = '@page { size: A4 landscape; margin: 1cm; }';
                        document.head.appendChild(ls);
                        window.print();
                        window.addEventListener('afterprint', () => document.getElementById('tvPrintPage')?.remove(), { once: true });
                    } else {
                        window.print();
                    }
                },
            });
            if (!about) return;

            // Calendar keeps its header logo opening About (no "back" target on
            // home). Also expose it so the nav-panel drawer logo opens the same panel.
            openAboutLightbox = about.open;
            // The logo opens the About panel — make it a keyboard-operable control (it was a
            // non-focusable <img> with a click handler). Its own label describes the ACTION (the
            // <img alt> stays the brand). About is also reachable via the nav-drawer brand button. v18.29.
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

        // ============================================
        // MONTH/YEAR JUMP PICKER
        // ============================================
        (function() {
            const overlay    = document.getElementById('monthJumpOverlay');
            const card       = document.getElementById('monthJumpCard');
            const selMonth   = /** @type {HTMLSelectElement} */ (document.getElementById('monthJumpMonth'));
            const selYear    = /** @type {HTMLSelectElement} */ (document.getElementById('monthJumpYear'));
            const btnConfirm = document.getElementById('monthJumpConfirm');
            const btnCancel  = document.getElementById('monthJumpCancel');
            if (!overlay) return;

            // Populate year select once (CONFIG.MIN_YEAR..MAX_YEAR)
            for (let y = CONFIG.MIN_YEAR; y <= CONFIG.MAX_YEAR; y++) {
                const opt = document.createElement('option');
                opt.value = String(y); opt.textContent = String(y);
                selYear.appendChild(opt);
            }
            // Populate month select once
            MONTH_NAMES.forEach((name, i) => {
                const opt = document.createElement('option');
                opt.value = String(i); opt.textContent = name;
                selMonth.appendChild(opt);
            });

            // Shared canonical lifecycle — adds the focus restore this picker
            // never had (closing used to drop keyboard focus to <body>).
            // No .lb-close button here: Cancel is the close control.
            const picker = createLightbox({
                overlay,
                content: card || undefined,
                initialFocus: () => selMonth || undefined,
                onOpen() {
                    selMonth.value = String(getDisplayMonth());
                    selYear.value  = String(getDisplayYear());
                },
            });

            // Delegated click: any .month-year element (rebuilt on each render)
            (/** @type {HTMLElement} */ (document.getElementById('calendarDisplay'))).addEventListener('click', e => {
                if (/** @type {Element} */ (e.target).closest('.month-year')) picker.open();
            });
            (/** @type {HTMLElement} */ (document.getElementById('calendarDisplay'))).addEventListener('keydown', e => {
                if (/** @type {Element} */ (e.target).closest('.month-year') && (/** @type {KeyboardEvent} */ (e).key === 'Enter' || /** @type {KeyboardEvent} */ (e).key === ' ')) {
                    e.preventDefault(); picker.open();
                }
            });

            btnConfirm?.addEventListener('click', () => {
                setDisplayMonth(parseInt(selMonth.value, 10));
                setDisplayYear(parseInt(selYear.value, 10));
                picker.close();
                renderCalendar();
                announceMonthChange();
                // renderCalendar() rebuilt the heading the focus restore pointed
                // at — move focus onto the freshly rendered equivalent.
                /** @type {HTMLElement} */ (document.querySelector('.month-year'))?.focus();
            });

            btnCancel?.addEventListener('click', () => picker.close());
        })();

        // ============================================
        // KEYBOARD SHORTCUTS (Desktop)
        // ============================================
        document.addEventListener('keydown', (e) => {
            // Don't fire if user is typing in an input
            if (/** @type {Element} */ (e.target).tagName === 'SELECT' || /** @type {Element} */ (e.target).tagName === 'INPUT') return;
            // Don't fire behind ANY open overlay — focus sits on a button there,
            // so the input check above doesn't help: arrows/t would silently
            // change the month behind the overlay (and PERSIST the drift via
            // persistViewedMonth) and p would print it. The huddle viewer and the
            // nav drawer are NOT .lb-overlay lightboxes, so they need their own
            // checks (v16.69 review fix — the month drifted behind the Huddle).
            if (document.querySelector('.lb-overlay.visible')) return;
            if (document.getElementById('huddleViewer')?.classList.contains('visible')) return;
            if (document.querySelector('.nav-panel.open')) return;
            if (isSwipeCooldown()) return; // Don't interrupt a swipe animation
            if (isFirstRun()) return;      // don't drift the hidden month behind the first-run prompt (v16.21)
            if (teamView.isTeamViewMode()) {
                if (e.key === 'ArrowLeft')  document.getElementById('tvPrevWeek')?.click();
                if (e.key === 'ArrowRight') document.getElementById('tvNextWeek')?.click();
                if (e.key === 't' || e.key === 'T') teamView.jumpToCurrentWeek();
                return;
            }
            // Guard: when a calendar day cell has focus, arrow keys move between cells
            // (handled by initCalendarKeyboard). Only navigate months when no cell is focused.
            // Honour the year-boundary no-op like the Prev/Next buttons do (they check aria-disabled,
            // set at the boundary during render) — otherwise at Dec MAX_YEAR / Jan MIN_YEAR this
            // re-rendered and screen-reader-announced the identical clamped month (v16.21).
            if (e.key === 'ArrowLeft'  && !document.activeElement?.classList.contains('calendar-day')
                && document.getElementById('prevMonth')?.getAttribute('aria-disabled') !== 'true') { changeMonth(-1); renderCalendar(); announceMonthChange(); }
            if (e.key === 'ArrowRight' && !document.activeElement?.classList.contains('calendar-day')
                && document.getElementById('nextMonth')?.getAttribute('aria-disabled') !== 'true') { changeMonth(1);  renderCalendar(); announceMonthChange(); }
            if (e.key === 't' || e.key === 'T') { const now = new Date(); setDisplayMonth(now.getMonth()); setDisplayYear(now.getFullYear()); renderCalendar(); pulseToday(); announceMonthChange(); }
            // Any open overlay (lightbox / huddle viewer / nav drawer) already returned above, so
            // print is unguarded here.
            if (e.key === 'p' || e.key === 'P') window.print();
        });

} catch (error) {
    console.error('[calendar] Initialization error:', error);
    // Always hide the splash — an error banner is more useful than an infinite loading screen
    const splashEl = document.getElementById('splash');
    if (splashEl) splashEl.remove();
    const banner = document.getElementById('errorBanner');
    if (banner) {
        setStatus(banner, '⚠️ Couldn\'t start the calendar — please refresh the page.');
        banner.classList.add('visible');
    }
}

// ============================================
// INITIAL 3-MONTH FETCH + SYNC CHIP + VISIBILITY GUARD
// See calendar-initial-fetch.js.
// ============================================
// initInitialFetch moved into the init try-block ABOVE the first renderCalendar (v16.23) — it
// must set _initialFetchInProgress + pre-claim the 3 months before any render can fetch.

// ============================================
// PRINT HEADER — stamp timestamp before printing
// ============================================
// iOS Safari does not fire beforeprint when AirPrint is invoked, so we also stamp
// eagerly on load. The beforeprint handler is kept for desktop browsers, where it
// updates both attributes to the moment of printing.
function stampPrintDate() {
    const now    = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    const header = document.querySelector('.header');
    if (!header) return;
    header.setAttribute('data-print-date', `Printed: ${now}`);
    // First run (no member picked yet): don't stamp a default member onto the print header —
    // this also runs on `beforeprint`, so without the guard it would re-add the name that
    // showFirstRunPrompt() cleared. (H1)
    if (isFirstRun()) { header.removeAttribute('data-member-name'); return; }
    header.setAttribute('data-member-name', (/** @type {any} */ (getCurrentMember())).name);
}
stampPrintDate();
window.addEventListener('beforeprint', stampPrintDate);

// Small delay so any in-flight render cycle completes before the page tears down.
registerServiceWorker({
    beforeReload: () => setTimeout(() => window.location.reload(), 500),
    bfcache: true,
    // The Calendar is the app's opening page and the one staff reported as slow, and it is the only
    // page where an update can interrupt PURE READING — there is nothing here to save, so nothing to
    // ask about. `deferWhileVisible` holds the reload until the member looks away; the reasoning,
    // and why the pages with confirm dialogs deliberately do not get it, is in sw-register.js.
    deferWhileVisible: true,
});

// ============================================
// HUDDLE VIEWER — initialised via calendar-huddle-viewer.js
// ============================================
// `authReady` (persistence configured), NOT `calendarAccessReady`. The Huddle, Circular and
// Newsletter collections are openly readable by design (OPERATIONS_REFERENCE.md → "Huddle
// notification tap behaviour"), so these viewers need no Calendar access — and gating them on it
// would strand a locked visitor: this subscription does a plain `await`, so a promise that never
// resolves would leave a nav-drawer tap loading for ever. What they DO need is persistence to be
// configured before any token work, which is exactly what `authReady` is.
initHuddleViewer({ authReady });

// ============================================
// CIRCULAR / NEWSLETTER VIEWER — opened from a #circular/#newsletter notification deep link
// ============================================
initDocViewer({ authReady });   // same reasoning as the Huddle viewer above


// `calendarAccessReady` is imported at the top of the module — it is consumed by initInitialFetch
// and by the telemetry block below.


// ============================================
// PUSH NOTIFICATIONS — silent subscription renewal
// ============================================
// Push notification handling:
//   - If permission already granted: silently renew/migrate subscription (VAPID key rotation check)
//   - If permission not yet asked: show one-off prompt strip on the calendar
(function initNotifications() {
    // Guard support FIRST. notifSupported() folds in the `'Notification' in window` check and the
    // iOS-standalone rule, so in a plain iOS Safari tab (where the Notification global is absent)
    // we return before ever touching `Notification.permission` — reading it unguarded threw a
    // ReferenceError at module top level, aborting the rest of the module (nav panel, error
    // reporter, keyboard nav). Do not reorder this below the permission checks.
    if (!notifSupported()) return;

    // Already granted — getNotifState() handles VAPID rotation and keeps the
    // subscription fresh. Early-return avoids showing the prompt.
    if (Notification.permission === 'granted') {
        // NAMED sessions only (v20.12). This renews the subscription and re-stamps its `owner` with
        // the current Firebase uid, and under a shared Calendar viewer that uid is the SAME for
        // every office PC in the building — so one machine's renewal would overwrite the owner of a
        // real member's subscription, and any viewer anywhere could then delete it. Skipping is a
        // no-op write-wise, so an existing subscription is left exactly as it was; the only thing
        // lost is VAPID-rotation self-healing during a viewer session, which is a rare manual event
        // on a machine that should not be carrying somebody's notifications anyway.
        calendarAuthReady
            // `open` too (v20.16): with the staff PIN switched off the Calendar is back on its
            // pre-v20.12 anonymous model, and renewal under an anonymous uid is exactly what it did
            // then. Only VIEWER mode is excluded, because that uid is shared by every office PC.
            // Gated on AUTH rather than access: a lapsed subscription re-subscribes, which is a
            // Firestore write, and in `open` mode access resolves before the session exists.
            .then(() => { const t = getAccessType(); if (t === 'named' || t === 'open') return getNotifState(); })
            .catch((/** @type {any} */ err) => console.warn('[Notifications] Renewal failed:', err.message));
        return;
    }

    if (Notification.permission === 'denied') return;
    if (lsGet('myb_notif_prompt_done')) return;

    const prompt     = document.getElementById('notifPrompt');
    const enableBtn  = document.getElementById('notifPromptEnable');
    const dismissBtn = document.getElementById('notifPromptDismiss');
    if (!prompt || !enableBtn || !dismissBtn) return;
    const _prompt = /** @type {HTMLElement} */ (prompt);

    // Offered to NAMED sessions only, and only once access is settled (v20.12). Two reasons, and
    // the second is the one that would not occur to you: a subscription made under the shared
    // viewer is owned by an identity fifty people share, so it can be deleted by any of them — and
    // it would sit on a shared office PC pushing one person's Huddle to a machine in the mess room
    // indefinitely, with nobody who could turn it off. A staff member who wants notifications wants
    // them on their own phone, where they are signed in.
    calendarAuthReady.then(() => {
        // Same rule as the renewal above: everyone EXCEPT the shared viewer. With the PIN switched
        // off that restores the prompt to every calendar visitor, which is what it was before.
        const t = getAccessType();
        if (t !== 'named' && t !== 'open') return;
        _prompt.style.display = 'flex';
    });
    function hide() { _prompt.style.display = 'none'; }

    enableBtn.addEventListener('click', async () => {
        hide();
        try {
            // Request the permission FIRST, inside the click's transient user activation (v16.23).
            // Awaiting an auth round-trip first ran requestPermission outside the gesture:
            // iOS/WebKit silently rejects a no-gesture request and Chrome demotes it to the quiet
            // UI, so the tap did nothing. Only the Firestore subscription SAVE needs auth.
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
                lsSet('myb_notif_prompt_done', '1');   // asked and declined — don't re-prompt
                return;
            }
            // Already resolved — the prompt is only shown from inside a `calendarAuthReady`
            // callback — but kept so the gesture/auth ordering above stays explicit at the one
            // place it matters.
            await calendarAuthReady;
            await enableNotifications();   // permission already granted → goes straight to subscribe
        } catch (err) {
            console.warn('[Notifications] Enable failed:', /** @type {any} */ (err).message);
        }
    });

    dismissBtn.addEventListener('click', () => {
        hide();
        lsSet('myb_notif_prompt_done', '1');
    });
})();

// The install strip. Wired AFTER the notification prompt's IIFE above, and it hides that strip
// when it shows — one ask at a time, install first, because on iOS notifications are impossible
// until the app is installed. The precedence rule and everything it turns on: install-prompt.js.
initInstallPrompt({ accessReady: calendarAuthReady, getAccessType });

// Tooltip and keyboard navigation — see calendar-keyboard.js.
initCalendarTooltip();
initCalendarKeyboard({ navigateToPaycalc, openDayDetail });
// Error reporter + usage counter both write to Firestore (need request.auth) — gate them
// on the shared auth promise defined above, the same one the push renewal awaits.
// Telemetry waits for ACCESS, not merely for auth (v20.12), and on a locked Calendar it therefore
// never runs. That is the honest reading: with no identity at all these writes would be rejected by
// every rule, and a page view for a Calendar nobody was shown is not a figure worth an
// authenticated session to collect. The cost is real and worth stating — an unlock that FAILS is
// invisible to the error log, so a broken PIN exchange shows up in the Cloud Function logs and in
// staff reports rather than in the Operations Error Log card.
// `calendarAuthReady`, NOT `calendarAccessReady` (v20.22). In `open` mode the two are different
// instants: access is granted the moment the decision is made, deliberately WITHOUT waiting for the
// anonymous sign-in, so that the grid can paint. Every call below writes to Firestore, and every one
// of those rules requires `request.auth != null` — so gating them on access alone fired them into a
// window with no token and the writes were simply rejected. This is the same race the v14.23–28
// push-subscription fix was about, re-opened from the other side.
calendarAuthReady.finally(() => {
    initErrorReporter();
    // The calendar has no Auth session of its own, and since v19.95 that no longer keeps its
    // visitors out of the account figures: `recordUsage` takes ONE identity and counts it. For the
    // admin-exclusion identity use the signed-in SESSION name, NOT the selected dropdown member: the
    // default dropdown selection is an admin (CONFIG.DEFAULT_MEMBER_NAME = 'G. Miller'), so keying on it
    // would wrongly exclude every fresh anonymous visitor. A signed-in admin (the developer) — identified
    // by the shared session, the same signal the authenticated pages use — is the real thing to skip.
    // Falls back to the SELECTED member when nobody is signed in (v19.86, external review P2).
    // This was `getSession()?.name ?? null`, which is right for admin exclusion and wrong for the
    // other jobs the same argument does: it is also the dedup key for the address counters and (as
    // of v19.95) for the account counts, and calendar-only staff never sign in anywhere. With a
    // session-only identity that is null for them, so both metrics were blind to the exact
    // population they exist to observe: the people an old installed PWA can strand.
    //
    // The `isFirstRun()` guard is what makes the fallback safe, and it is the same one the nav
    // panel's open counters use ten lines below. Before a member picks anyone the "selection" is
    // only CONFIG.DEFAULT_MEMBER_NAME — an admin — so keying on it unguarded would silently
    // exclude every fresh visitor from both the usage counts and the migration metric.
    const _calIdentity = getSession()?.name || (isFirstRun() ? null : getCurrentMember()?.name) || null;
    recordUsage('calendar', _calIdentity);
    recordPageLatency('calendar', _calIdentity);
});

const _calendarSession = getSession();
initNavPanel({
    // The nav panel's `authReady` gates the Circular/Newsletter open counters — Firestore writes —
    // so it needs the AUTH promise, not the access one (v20.22).
    authReady: calendarAuthReady,
    currentPage: 'calendar',
    memberName:  _calendarSession?.name || null,
    // Open-counter exclusion identity: the session name, else the SELECTED member — but null on
    // a first-run device, where the "selection" is only the DEFAULT member (the developer) and
    // excluding on it would silently drop every fresh visitor's opens (v18.22 review fix — the
    // same trap the recordUsage call below documents avoiding).
    usageIdentity: _calendarSession?.name || (isFirstRun() ? null : getCurrentMember()?.name) || null,
    isAdmin:         CONFIG.ADMIN_NAMES.includes(_calendarSession?.name),
    isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(_calendarSession?.name),
    canOpenOvertime: canOpenOvertime(_calendarSession?.name),
    onLogoClick: () => openAboutLightbox?.(),
    onSignOut:   _calendarSession ? () => {
        clearSession();
        window.location.reload();
    } : null,
    // "Lock Calendar" — viewer mode only, and the nav drawer is the right home for it: it is a
    // leaving-the-desk action, not a Calendar control, and putting it in the header would give every
    // member a button they can never use. `isViewerMode()` is read at DRAWER-OPEN time (the thunk),
    // not at init, because access is resolved asynchronously and this call runs before it settles.
    onLockCalendar: { isViewer: isViewerMode, lock: lockCalendar },
});

// ── Start the Calendar, or ask for the staff PIN ─────────────────────────────────────────────────
// The LAST thing the module does, deliberately: every shell subsystem above is wired first, so a
// locked visitor still has the nav drawer, the guides, the documents and the About panel. Only then
// is access decided, and only on `named`/`viewer` does the workspace exist at all.
// Whether `onGranted` has run — i.e. whether a grant is the FIRST one. Read by `onEveryGrant` to
// tell "boot" from "re-unlock": on boot the workspace does not exist yet and the repaint below
// would run against unbuilt state, so it must be skipped there and only there.
let _workspaceStarted = false;

/** Enable or disable the member selector and the Team View button. @param {boolean} on */
function _crossMemberControls(on) {
    for (const id of ['teamMemberSelect', 'teamViewBtn']) {
        const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
        if (el) el.disabled = !on;
    }
}

initCalendarAccess({
    // EVERY grant, not just the first (v20.41). Both of these are things the access-lost path turns
    // OFF, so both have to come back on when access returns — which is precisely what re-entering
    // the PIN after a rotation is. Left in the one-shot below, a re-unlocked Calendar came back with
    // its override gate still shut: every read refused at source, every month stuck on "Checking
    // this month", and a Try again that could not win.
    // The argument is the PROVISIONAL SCOPE (v22.97): a member name means "this member's own data,
    // out of the local cache, nothing from the server"; `null` is the ordinary full grant; `false`
    // means the provisional paint is being withdrawn because the identity did not confirm.
    onEveryGrant: (/** @type {string|null|false} */ scope = null) => {
        if (scope === false) { setOverrideAccess(false); _crossMemberControls(true); return; }
        // Open the override reads BEFORE building the workspace. The reverse order would let the
        // first render's `ensureOverridesCached` run against a closed gate, silently claim nothing,
        // and leave the month unfetched for the session.
        setOverrideAccess(true, { provisionalMember: typeof scope === 'string' ? scope : null });
        // The two controls that would put SOMEBODY ELSE on screen. A provisional paint is scoped to
        // one member, so during it these are the only way to reach a grid the scope cannot fill —
        // the colleague's base roster would draw with their leave and absence silently missing.
        // `decideProvisionalAccess` already refuses a boot that STARTS in either state; this covers
        // the tap inside the window, which on a slow connection is a real second or two.
        _crossMemberControls(typeof scope !== 'string');
        // Month navigation and Team View reach Firestore through `ensureOverridesCached`, not
        // through the initial fetch — so they need the same access-lost recovery, and they are the
        // likelier path once a session has been open for a while (v20.15).
        setOverrideAccessLostHandler(handleAccessLost);
        // A RE-grant also repaints (v20.45). `grant()` un-hides the workspace exactly as the
        // re-lock left it, and nothing else asks for a render — every fetch in this app is pulled
        // by one — so without this the member who just entered the rotated PIN looked at the grid
        // from BEFORE the lock, up to fifteen minutes stale, until their next navigation. The
        // repaint goes through the ordinary paths on purpose: `setOverrideAccess(true)` has just
        // cleared the month claims, so `renderCalendar`'s own `ensureOverridesCached` re-fetches
        // the display month and the readiness model narrates it honestly ("Checking this month" →
        // grid) rather than this code hand-managing freshness. `restoreTeamView` is the team-side
        // equivalent — render + week fetch — and is safe to re-enter (`_pushOverlayState` dedupes
        // its Back handler; the chrome calls are idempotent).
        if (_workspaceStarted) {
            if (teamView.isTeamViewMode()) teamView.restoreTeamView();
            else renderCalendarWhenIdle();
        }
    },
    // ONCE: re-running this would re-wire the swipe handler and re-launch the initial 3-month fetch.
    onGranted: () => {
        _workspaceStarted = true;
        // CAUGHT, because the workspace start became async at v21.29 (it awaits a bounded chance
        // for the local cache to paint first). An un-awaited async call with no catch turns any
        // throw in here into an unhandled rejection — which `error-reporter.js` does capture, so it
        // would reach the Error Log, but the member would be left looking at an empty workspace
        // with nothing said and no way to know a reload might fix it. Reporting it here keeps the
        // failure attached to the thing that failed.
        Promise.resolve(_startCalendarWorkspace?.()).catch(err => {
            console.error('[Calendar] the workspace failed to start', err);
        });
    },
});

// The page's one-time notices (pw-own-2026, backpay-2026, and whatever /new-notice adds next).
// Their wiring lives in calendar-notices.js — see its header for why they left this file.
initCalendarNotices();
