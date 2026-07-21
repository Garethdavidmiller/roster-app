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
import { auth, authReady, signInAnonymously } from './firebase-client.js';
import { lsGet, lsSet } from './ls.js';
import { getSession, clearSession, reconcileExpiredIdentity } from './session.js';
import { initTeamView } from './calendar-team-view.js';
import { initNavPanel } from './nav-panel.js';
import { notifSupported, getNotifState, enableNotifications } from './notif.js';
import { _pushOverlayState, _clearOverlayHistory, createLightbox } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency } from './perf-reporter.js';
import { initHuddleViewer } from './calendar-huddle-viewer.js';
import { initDocViewer } from './calendar-doc-viewer.js';
import { rosterOverridesCache, ensureOverridesCached, getShiftTypesInMonth, clearShiftTypesCache, _initialFetchInProgress } from './calendar-overrides.js';
import { getCurrentMember, getSelectedMemberIndex, saveSelectedMember, populateTeamMemberDropdown, validateTeamMembers, takeStaleMemberName, isFirstRun } from './calendar-member.js';
import { buildCalendarContainer } from './calendar-renderer.js';
import { getDisplayMonth, getDisplayYear, setDisplayMonth, setDisplayYear, changeDisplay, persistViewedMonth } from './calendar-state.js';
import { initSwipeHandler, isSwipeCooldown, isSwipeGestureActive } from './calendar-swipe.js';
import { initCalendarLightboxes } from './calendar-al-lightbox.js';
import { initInitialFetch } from './calendar-initial-fetch.js';
import { initCalendarTooltip, initCalendarKeyboard } from './calendar-keyboard.js';

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
const { openDayDetail, closeALLightbox } = initCalendarLightboxes({ navigateToPaycalc });

// (Calendar display state lives in calendar-state.js; swipe cooldown in calendar-swipe.js)

// ============================================
// TEAM VIEW
// ============================================
const teamView = initTeamView({
    rosterOverridesCache,
    clearShiftTypesCache,
    getSelectedMemberIndex,
    isFirstRun,
    renderCalendar,
    _pushOverlayState,
    _clearOverlayHistory,
});


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

        // Update legend for current member and month (Night, 🎄, 🐣 are conditional)
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
        console.error('Error rendering calendar:', error);
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
        // validateRosterPatterns() already ran at module load in roster-data.js.
        // Only run the team-member shape check here — it's unique to this file.
        const allErrors = validateTeamMembers();
        if (allErrors.length > 0) {
            console.error('⚠️ ROSTER DATA VALIDATION ERRORS:');
            allErrors.forEach(error => console.error('  - ' + error));
            const banner = document.getElementById('errorBanner');
            if (banner) {
                banner.textContent = '⚠️ Some roster details couldn\'t load — please tell the admin.';
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
        initInitialFetch({
            isTeamViewMode: () => teamView.isTeamViewMode(),
            // Deferred: the 3-month fetch can resolve mid-swipe on a slow connection — an immediate
            // render would wipe the carousel and freeze the grid on the old month (v16.23).
            renderCalendar: renderCalendarWhenIdle,
            // Team view active when the 3-month fetch lands → repaint its grid from the cache
            // (v18.21 — without this an early/boot-time team view stayed base-roster-only: see
            // initInitialFetch's JSDoc for the two-sided stand-down).
            renderTeamView: () => teamView.refreshFromCache(),
        });

        // Restore team view if the user was in it before the last refresh; else render the
        // personal calendar. renderCalendar() itself shows the first-run "choose your name"
        // prompt when no member is picked and no session exists (see its guard). (H1)
        if (lsGet('myb_team_view') === '1') {
            teamView.restoreTeamView();
        } else {
            renderCalendar();
        }

        // Dismiss splash screen after first render — rAF ensures the calendar
        // is painted before the fade starts (setTimeout(300) was arbitrary).
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
        });


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
    console.error('Initialization error:', error);
    // Always hide the splash — an error banner is more useful than an infinite loading screen
    const splashEl = document.getElementById('splash');
    if (splashEl) splashEl.remove();
    const banner = document.getElementById('errorBanner');
    if (banner) {
        banner.textContent = '⚠️ Couldn\'t start the calendar — please refresh the page.';
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
});

// ============================================
// HUDDLE VIEWER — initialised via calendar-huddle-viewer.js
// ============================================
initHuddleViewer();

// ============================================
// CIRCULAR / NEWSLETTER VIEWER — opened from a #circular/#newsletter notification deep link
// ============================================
initDocViewer();


// Resolves once a usable Firebase Auth user exists: a named account if one is already
// signed in (e.g. Admin/Paycalc opened first — an existing user already has a token, so
// signInAnonymously would race or replace them), otherwise a fresh anonymous session.
// EVERY Firestore write on the calendar — error reporter, usage counter, AND the push-
// subscription renewal — awaits this so none runs before request.auth is set. Without it,
// an already-installed PWA re-saved its push subscription with no auth user → the write was
// rejected by the `request.auth != null` rule → the bell stuck "off-lapsed" with no retry.
// See ROADMAP → "Deferred security/reliability backlog" (the v14.23–28 push-subscription auth race fix).
// reconcileExpiredIdentity() FIRST (Finding #9): if a NAMED Firebase identity was restored from
// IndexedDB but the local app session has expired, sign it out here — the coordinated teardown the
// getSession() note prescribes (the calendar is the PWA start_url, so this runs on nearly every
// launch). The anon bootstrap then re-establishes an anonymous session in its place, so the calendar's
// best-effort writes still satisfy `request.auth != null` without carrying stale named privileges.
const calendarAuthReady = authReady
    .then(() => reconcileExpiredIdentity())
    .then(() => auth.currentUser ? null : signInAnonymously(auth).catch(() => {}))
    .catch(() => {});


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
        calendarAuthReady.then(() => getNotifState()).catch((/** @type {any} */ err) => console.warn('[Notifications] Renewal failed:', err.message));
        return;
    }

    if (Notification.permission === 'denied') return;
    if (lsGet('myb_notif_prompt_done')) return;

    const prompt     = document.getElementById('notifPrompt');
    const enableBtn  = document.getElementById('notifPromptEnable');
    const dismissBtn = document.getElementById('notifPromptDismiss');
    if (!prompt || !enableBtn || !dismissBtn) return;
    const _prompt = /** @type {HTMLElement} */ (prompt);

    _prompt.style.display = 'flex';
    function hide() { _prompt.style.display = 'none'; }

    enableBtn.addEventListener('click', async () => {
        hide();
        try {
            // Request the permission FIRST, inside the click's transient user activation (v16.23).
            // Awaiting calendarAuthReady first (a live signInAnonymously round-trip on a first
            // visit — exactly when this prompt shows) ran requestPermission outside the gesture:
            // iOS/WebKit silently rejects a no-gesture request and Chrome demotes it to the quiet
            // UI, so the tap did nothing. Only the Firestore subscription SAVE needs auth.
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') {
                lsSet('myb_notif_prompt_done', '1');   // asked and declined — don't re-prompt
                return;
            }
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

// Tooltip and keyboard navigation — see calendar-keyboard.js.
initCalendarTooltip();
initCalendarKeyboard({ navigateToPaycalc, openDayDetail });
// Error reporter + usage counter both write to Firestore (need request.auth) — gate them
// on the shared auth promise defined above, the same one the push renewal awaits.
calendarAuthReady.finally(() => {
    initErrorReporter();
    // The calendar is anonymous (no member arg → page view only, no active-account, as before). For the
    // admin-exclusion identity use the signed-in SESSION name, NOT the selected dropdown member: the
    // default dropdown selection is an admin (CONFIG.DEFAULT_MEMBER_NAME = 'G. Miller'), so keying on it
    // would wrongly exclude every fresh anonymous visitor. A signed-in admin (the developer) — identified
    // by the shared session, the same signal the authenticated pages use — is the real thing to skip.
    const _calIdentity = getSession()?.name ?? null;
    recordUsage('calendar', null, _calIdentity);
    recordPageLatency('calendar', _calIdentity);
});

const _calendarSession = getSession();
initNavPanel({
    currentPage: 'calendar',
    memberName:  _calendarSession?.name || null,
    // Open-counter exclusion identity: the session name, else the SELECTED member — but null on
    // a first-run device, where the "selection" is only the DEFAULT member (the developer) and
    // excluding on it would silently drop every fresh visitor's opens (v18.22 review fix — the
    // same trap the recordUsage call below documents avoiding).
    usageIdentity: _calendarSession?.name || (isFirstRun() ? null : getCurrentMember()?.name) || null,
    isAdmin:         CONFIG.ADMIN_NAMES.includes(_calendarSession?.name),
    isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(_calendarSession?.name),
    onLogoClick: () => openAboutLightbox?.(),
    onSignOut:   _calendarSession ? () => {
        clearSession();
        window.location.reload();
    } : null,
});

