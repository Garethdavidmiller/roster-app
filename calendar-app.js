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
import { getSession, clearSession } from './session.js';
import { initTeamView } from './calendar-team-view.js';
import { initNavPanel } from './nav-panel.js';
import { notifSupported, getNotifState, enableNotifications } from './notif.js';
import { _pushOverlayState, _clearOverlayHistory, createLightbox } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { initHuddleViewer } from './calendar-huddle-viewer.js';
import { rosterOverridesCache, ensureOverridesCached, getShiftTypesInMonth, _initialFetchInProgress } from './calendar-overrides.js';
import { getCurrentMember, getSelectedMemberIndex, saveSelectedMember, populateTeamMemberDropdown, validateTeamMembers, takeStaleMemberName } from './calendar-member.js';
import { buildCalendarContainer } from './calendar-renderer.js';
import { getDisplayMonth, getDisplayYear, setDisplayMonth, setDisplayYear, changeDisplay, persistViewedMonth } from './calendar-state.js';
import { initSwipeHandler, isSwipeCooldown } from './calendar-swipe.js';
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
const { openDayDetail, closeALLightbox } = initCalendarLightboxes();

// (Calendar display state lives in calendar-state.js; swipe cooldown in calendar-swipe.js)

// ============================================
// TEAM VIEW
// ============================================
const teamView = initTeamView({
    rosterOverridesCache,
    getSelectedMemberIndex,
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
// Requires a valid session; otherwise redirects to admin login with a return hint.
// Always call this helper — never duplicate the navigation logic at a call site.
/** @param {any} paydayStr */
function navigateToPaycalc(paydayStr) {
    // paycalc handles its own in-place sign-in for unsigned users (Option B, v14.45+), so go
    // there directly — the ?payday= param survives the post-login reload. (Previously this
    // bounced unsigned users to admin?redirect=paycalc, which no longer returns here.)
    window.location.href = `./paycalc.html?payday=${paydayStr}`;
}


// AL and day-detail lightboxes initialised above via initCalendarLightboxes().

// updateLegend — shows/hides conditional legend items:
//   Spare/RDW/AL — only when that shift type actually appears this month
//   Night        — only for Dispatcher roster members
//   🎄 Christmas — only in December
//   🐣 Easter    — only in the month Easter Sunday falls in
//   Faith events — only for opted-in calendar, only the months that event falls in
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
    // Hide the whole row-2 if all four are absent
    const row2 = _legendEl('legend-row-2');
    if (row2) row2.style.display = (typesThisMonth.has('SPARE') || typesThisMonth.has('RDW') || typesThisMonth.has('AL') || typesThisMonth.has('SICK')) ? '' : 'none';

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

// renderCalendar — used for all non-swipe navigation (buttons, keyboard, today).
// Sets data-member-name for print header then builds and inserts fresh container.
function renderCalendar() {
    try {
        const member = getCurrentMember();

        // If the previously-selected member was removed from the roster, show a one-time notice.
        const stale = takeStaleMemberName();
        if (stale) _showStaleMemberBanner(stale, (/** @type {any} */ (member)).name);

        // Update legend for current member and month (Night, 🎄, 🥚 are conditional)
        updateLegend();

        // Set team member name on header for printing
        const headerElement = document.querySelector('.header');
        if (headerElement) headerElement.setAttribute('data-member-name', (/** @type {any} */ (member)).name);

        const calendarDisplay = document.getElementById('calendarDisplay');
        if (!calendarDisplay) throw new Error('Calendar display element not found');

        document.title = `MYB Roster — ${MONTH_NAMES[getDisplayMonth()]} ${getDisplayYear()}`;

        // Persist so the user returns to the same month after closing the app
        persistViewedMonth();

        const calendarContainer = buildCalendarContainer(getDisplayMonth(), getDisplayYear(), {
            navigateToPaycalc,
            onDayDetail: /** @param {any} cell */ (cell) => openDayDetail?.(cell),
        });
        calendarDisplay.innerHTML = '';
        calendarDisplay.appendChild(calendarContainer);

        // Update Prev/Next buttons at year/month boundaries
        // aria-disabled signals the limit to screen readers; opacity gives visual feedback
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

        // Ensure Firestore overrides are cached for the displayed month.
        // No-op if already fetched; fires a background fetch and re-render if not
        // (e.g. when the user navigates beyond the initial 3-month window).
        // Skipped while the initial 3-month fetch is in flight to avoid a competing
        // fetch that could race against it and produce a blank re-render mid-load.
        if (!_initialFetchInProgress) {
            const _mAtFetch = getSelectedMemberIndex();
            ensureOverridesCached(getDisplayYear(), getDisplayMonth(), () => {
                if (!teamView.isTeamViewMode() && getSelectedMemberIndex() === _mAtFetch) renderCalendar();
            });
        }

    } catch (error) {
        console.error('Error rendering calendar:', error);
        const calendarDisplay = document.getElementById('calendarDisplay');
        if (calendarDisplay) {
            const errDiv = document.createElement('div');
            errDiv.className = 'calendar-error';
            errDiv.setAttribute('role', 'alert');
            errDiv.innerHTML = '<h2><span aria-hidden="true">⚠️</span> Couldn\'t display your roster</h2><p>Close the app and open it again. If it keeps happening, check your connection or contact the admin team.</p>';
            calendarDisplay.innerHTML = '';
            calendarDisplay.appendChild(errDiv);
        }
    }
}


// ============================================
// EVENT LISTENERS
// ============================================

(/** @type {HTMLElement} */ (document.getElementById('teamMemberSelect'))).addEventListener('change', (e) => {
    if (isSwipeCooldown()) return; // Don't interrupt a swipe animation
    saveSelectedMember(parseInt(/** @type {HTMLSelectElement} */ (e.target).value, 10));
    renderCalendar();
    // Close AL lightbox if open — data would be stale for the new member
    closeALLightbox?.();
});


(/** @type {HTMLElement} */ (document.getElementById('prevMonth'))).addEventListener('click', (e) => {
    if (isSwipeCooldown()) return;
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


(/** @type {HTMLElement} */ (document.getElementById('todayBtn'))).addEventListener('click', () => {
    if (isSwipeCooldown()) return;
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

(/** @type {HTMLElement} */ (document.getElementById('nextMonth'))).addEventListener('click', (e) => {
    if (isSwipeCooldown()) return;
    if (/** @type {Element} */ (e.currentTarget).getAttribute('aria-disabled') === 'true') return;
    changeMonth(1);
    renderCalendar();
    announceMonthChange();
});

// Pay button — navigates to paycalc.html for any signed-in staff member.
// If no session exists, sends the user to admin.html to sign in, then redirects back.
(/** @type {HTMLElement} */ (document.getElementById('payBtn'))).addEventListener('click', () => {
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
        const { paydays } = getPaydaysAndCutoffs(yr);
        for (const payday of paydays) {
            const cutoff = new Date(payday); cutoff.setDate(cutoff.getDate() - 6);
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

(/** @type {HTMLElement} */ (document.getElementById('adminBtn'))).addEventListener('click', () => {
    const today = new Date();
    const isCurrentMonth = getDisplayMonth() === today.getMonth() && getDisplayYear() === today.getFullYear();
    const targetDate = isCurrentMonth ? today : new Date(getDisplayYear(), getDisplayMonth(), 1);
    const yyyy = String(targetDate.getFullYear()).padStart(4, '0');
    const mm   = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd   = String(targetDate.getDate()).padStart(2, '0');
    location.href = `admin.html?date=${yyyy}-${mm}-${dd}`;
});

(/** @type {HTMLElement} */ (document.getElementById('teamViewBtn'))).addEventListener('click', teamView.toggleTeamView);

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
                banner.textContent = '⚠️ The app couldn\'t load some staff details — please tell the admin team.';
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

        // Restore team view if the user was in it before the last refresh
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
            renderCalendar,
            updateLegend,
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
                appLabel: 'MYB Roster',
                getUserName: () => (/** @type {any} */ (getCurrentMember()))?.name || 'Not selected',
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
                    if (teamView.isTeamViewMode()) {
                        const ls = document.createElement('style');
                        ls.textContent = '@page { size: A4 landscape; margin: 1cm; }';
                        document.head.appendChild(ls);
                        window.print();
                        window.addEventListener('afterprint', () => ls.remove(), { once: true });
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

            // Populate year select once (2024–2030)
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
            // Don't fire behind ANY open lightbox — focus sits on a button there,
            // so the input check above doesn't help: arrows/t would silently
            // change the month behind the overlay and p would print it.
            if (document.querySelector('.lb-overlay.visible')) return;
            if (isSwipeCooldown()) return; // Don't interrupt a swipe animation
            if (teamView.isTeamViewMode()) {
                if (e.key === 'ArrowLeft')  document.getElementById('tvPrevWeek')?.click();
                if (e.key === 'ArrowRight') document.getElementById('tvNextWeek')?.click();
                if (e.key === 't' || e.key === 'T') teamView.jumpToCurrentWeek();
                return;
            }
            // Guard: when a calendar day cell has focus, arrow keys move between cells
            // (handled by initCalendarKeyboard). Only navigate months when no cell is focused.
            if (e.key === 'ArrowLeft'  && !document.activeElement?.classList.contains('calendar-day')) { changeMonth(-1); renderCalendar(); announceMonthChange(); }
            if (e.key === 'ArrowRight' && !document.activeElement?.classList.contains('calendar-day')) { changeMonth(1);  renderCalendar(); announceMonthChange(); }
            if (e.key === 't' || e.key === 'T') { const now = new Date(); setDisplayMonth(now.getMonth()); setDisplayYear(now.getFullYear()); renderCalendar(); pulseToday(); announceMonthChange(); }
            if (e.key === 'p' || e.key === 'P') {
                if (!document.getElementById('huddleViewer')?.classList.contains('open')) window.print();
            }
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
initInitialFetch({
    isTeamViewMode: () => teamView.isTeamViewMode(),
    renderCalendar,
});

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


// Resolves once a usable Firebase Auth user exists: a named account if one is already
// signed in (e.g. Admin/Paycalc opened first — an existing user already has a token, so
// signInAnonymously would race or replace them), otherwise a fresh anonymous session.
// EVERY Firestore write on the calendar — error reporter, usage counter, AND the push-
// subscription renewal — awaits this so none runs before request.auth is set. Without it,
// an already-installed PWA re-saved its push subscription with no auth user → the write was
// rejected by the `request.auth != null` rule → the bell stuck "off-lapsed" with no retry.
// See ROADMAP "Push-subscription writes can race auth".
const calendarAuthReady = authReady
    .then(() => auth.currentUser ? null : signInAnonymously(auth).catch(() => {}))
    .catch(() => {});


// ============================================
// PUSH NOTIFICATIONS — silent subscription renewal
// ============================================
// Push notification handling:
//   - If permission already granted: silently renew/migrate subscription (VAPID key rotation check)
//   - If permission not yet asked: show one-off prompt strip on the calendar
(function initNotifications() {
    // Already granted — getNotifState() handles VAPID rotation and keeps the
    // subscription fresh. Early-return avoids showing the prompt.
    if (Notification.permission === 'granted') {
        calendarAuthReady.then(() => getNotifState()).catch((/** @type {any} */ err) => console.warn('[Notifications] Renewal failed:', err.message));
        return;
    }

    // notifSupported() folds in the iOS-standalone rule — no prompt in a plain browser tab.
    if (!notifSupported()) return;
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
        calendarAuthReady.then(() => enableNotifications()).catch((/** @type {any} */ err) => console.warn('[Notifications] Enable failed:', err.message));
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
calendarAuthReady.finally(() => { initErrorReporter(); recordUsage('calendar'); });

const _calendarSession = getSession();
initNavPanel({
    currentPage: 'calendar',
    memberName:  _calendarSession?.name || null,
    isAdmin:         CONFIG.ADMIN_NAMES.includes(_calendarSession?.name),
    isLinksDesigner: CONFIG.LINKS_DESIGNERS.includes(_calendarSession?.name),
    onLogoClick: () => openAboutLightbox?.(),
    onSignOut:   _calendarSession ? () => {
        clearSession();
        window.location.reload();
    } : null,
});

