/**
 * app.js — Calendar UI for index.html.
 *
 * Owns: month carousel, swipe gestures, shift cell render, override cache for
 *   the calendar view, Team Week View, notification wiring, sync chip.
 * Does NOT own: roster data (roster-data.js), Firebase init (firebase-client.js).
 * Edit here for: calendar display, swipe behaviour, override cache.
 * Do not edit here for: pay maths, admin features, override entry.
 */

import { CONFIG, teamMembers, DAY_NAMES, MONTH_NAMES, getALEntitlement, RAMADAN_STARTS, EID_FITR_DATES, EID_ADHA_DATES, ISLAMIC_NEW_YEAR_DATES, MAWLID_DATES, HOLI_DATES, NAVRATRI_DATES, DUSSEHRA_DATES, DIWALI_DATES, RAKSHA_BANDHAN_DATES, CHINESE_NEW_YEAR_DATES, LANTERN_FESTIVAL_DATES, QINGMING_DATES, DRAGON_BOAT_DATES, MID_AUTUMN_DATES, JAMAICAN_ASH_WEDNESDAY_DATES, JAMAICAN_LABOUR_DAY_DATES, JAMAICAN_EMANCIPATION_DATES, JAMAICAN_INDEPENDENCE_DATES, JAMAICAN_HEROES_DAY_DATES, isSameDay, computeEaster, isBankHoliday, isChristmasDay, isEasterSunday, getPaydaysAndCutoffs, isPayday, isCutoffDate, CONGOLESE_MARTYRS_DATES, CONGOLESE_LIBERATION_DATES, CONGOLESE_HEROES_DATES, CONGOLESE_INDEPENDENCE_DATES, PORTUGUESE_CARNIVAL_DATES, PORTUGUESE_FREEDOM_DATES, PORTUGUESE_LABOUR_DATES, PORTUGUESE_PORTUGAL_DAY_DATES, PORTUGUESE_CORPUS_CHRISTI_DATES, PORTUGUESE_ASSUMPTION_DATES, PORTUGUESE_REPUBLIC_DATES, PORTUGUESE_RESTORATION_DATES, PORTUGUESE_IMMACULATE_DATES, getShiftKind, getShiftClass, getShiftBadge, getWeekNumberForDate, getRosterForMember, getBaseShift, escapeHtml, formatISO, isSunday, getFaithBadge, resolveFaithCalendar, SWIPE_THRESHOLD, SWIPE_VELOCITY } from './roster-data.js';
import { db, collection, query, where, getDocs } from './firebase-client.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { getSession, clearSession } from './session.js';
import { initTeamView } from './app-team-view.js';
import { isBeforeMemberStart, shouldReplaceOverride } from './app-override-utils.js';
import { initNavPanel } from './nav-panel.js';
import { notifSupported, getNotifState, enableNotifications } from './notif.js';
import { _pushOverlayState, _clearOverlayHistory, createLightbox } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initHuddleViewer } from './app-huddle-viewer.js';

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

// ============================================
// FIREBASE — db imported from firebase-client.js
// Caches declared here so renderCalendar() always finds a Map — even on
// the first synchronous render before Firestore responds.
// ============================================

// Caches keyed "memberName|YYYY-MM-DD" and memberName respectively.
const rosterOverridesCache  = new Map();
const memberSettingsCache   = new Map();
const fetchedMonths         = new Set();
// Cache for getShiftTypesInMonth(). Key: "memberName|year|month".
// Cleared whenever fetchOverridesForRange() writes new data into rosterOverridesCache.
const shiftTypesMonthCache  = new Map();

// Set when localStorage held a member name that's no longer in the roster.
// renderCalendar() shows a brief info banner once then clears this flag.
let _staleMemberName = null;

// Guards against ensureOverridesCached() triggering a competing fetch while
// the initial 3-month load is already in flight. Set true before the IIFE
// await, cleared in its finally block.
let _initialFetchInProgress = false;

// Assigned by the About-lightbox IIFE; lets the nav-panel drawer logo open the
// same About panel that the header logo opens on the calendar page.
let openAboutLightbox = null;

// ============================================
// BANK HOLIDAYS / PAYDAY / DATE UTILITIES
// ============================================
// isSameDay, computeEaster, isBankHoliday, isChristmasDay, isEasterSunday,
// getPaydaysAndCutoffs, isPayday, isCutoffDate — all imported from roster-data.js.

const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Accessible-label text for each shift kind returned by getShiftKind().
const SHIFT_KIND_LABELS = { early: 'Early shift', late: 'Late shift', night: 'Night shift' };

// ============================================
// DATA VALIDATION
// ============================================

// validateRosterPatterns() already runs automatically when roster-data.js loads.
// We only keep validateTeamMembers() here — it checks team member object shape,
// which has no equivalent in the shared module.

// Validate team members data
function validateTeamMembers() {
    const errors = [];
    
    if (!teamMembers || teamMembers.length === 0) {
        errors.push('No team members defined');
        return errors;
    }
    
    teamMembers.forEach((member, index) => {
        if (!member.name) {
            errors.push(`Team member at index ${index} has no name`);
        }
        if (!member.currentWeek || member.currentWeek < 1) {
            errors.push(`${member.name || `Index ${index}`}: Invalid currentWeek`);
        }
        if (!member.role) {
            errors.push(`${member.name || `Index ${index}`}: Missing role field (expected "CEA", "CES" etc.)`);
        }
        if (member.rosterType !== 'main' && member.rosterType !== 'bilingual' && member.rosterType !== 'fixed' && member.rosterType !== 'ces' && member.rosterType !== 'dispatcher') {
            errors.push(`${member.name || `Index ${index}`}: Unknown rosterType "${member.rosterType}" (expected "main", "bilingual", "fixed", "ces" or "dispatcher")`);
        }
        if (member.rosterType === 'bilingual' && member.currentWeek > CONFIG.BILINGUAL_ROSTER_WEEKS) {
            errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds bilingual roster weeks (${CONFIG.BILINGUAL_ROSTER_WEEKS})`);
        }
        if (member.rosterType === 'main' && member.currentWeek > CONFIG.MAIN_ROSTER_WEEKS) {
            errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds main roster weeks (${CONFIG.MAIN_ROSTER_WEEKS})`);
        }
        if (member.rosterType === 'ces' && member.currentWeek > CONFIG.CES_ROSTER_WEEKS) {
            errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds CES roster weeks (${CONFIG.CES_ROSTER_WEEKS})`);
        }
        if (member.rosterType === 'dispatcher' && member.currentWeek > CONFIG.DISPATCHER_ROSTER_WEEKS) {
            errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds dispatcher roster weeks (${CONFIG.DISPATCHER_ROSTER_WEEKS})`);
        }
    });
    
    return errors;
}

// ============================================
// CALENDAR STATE
// ============================================

// Current date: Always evaluated fresh to handle app staying open past midnight
function getToday() { return new Date(); }

let currentDisplayMonth = getToday().getMonth();
let currentDisplayYear = getToday().getFullYear();

// Restore last-viewed month from localStorage (if valid, within app bounds, and not a future month).
// Future months are not restored so the app always opens on the current month when the user was
// previously browsing ahead — staff should see today's roster on open, not a month they peeked at.
(function restoreViewedMonth() {
    const m = parseInt(lsGet('myb_roster_month'), 10);
    const y = parseInt(lsGet('myb_roster_year'),  10);
    if (!isNaN(m) && !isNaN(y) && y >= CONFIG.MIN_YEAR && y <= CONFIG.MAX_YEAR && m >= 0 && m <= 11) {
        const today = getToday();
        const isFuture = y > today.getFullYear() || (y === today.getFullYear() && m > today.getMonth());
        if (!isFuture) {
            currentDisplayMonth = m;
            currentDisplayYear  = y;
        }
    }
})();

// ============================================
// SWIPE GESTURE STATE
// ============================================
let swipeCooldown = false;

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
// Ensures clamping logic lives in exactly one place.
function changeMonth(delta) {
    currentDisplayMonth += delta;
    if (currentDisplayMonth > 11) { currentDisplayMonth = 0; currentDisplayYear++; }
    if (currentDisplayMonth < 0)  { currentDisplayMonth = 11; currentDisplayYear--; }
    if (currentDisplayYear > CONFIG.MAX_YEAR) { currentDisplayYear = CONFIG.MAX_YEAR; currentDisplayMonth = 11; }
    if (currentDisplayYear < CONFIG.MIN_YEAR) { currentDisplayYear = CONFIG.MIN_YEAR; currentDisplayMonth = 0;  }
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

// Get selected team member index (default to G. Miller)
// Resolve DEFAULT_MEMBER_NAME to an index at runtime — safe against array reordering.
// Returns 0 as ultimate fallback if the name isn't found.
function getDefaultMemberIndex() {
    const idx = teamMembers.findIndex(m => m.name === CONFIG.DEFAULT_MEMBER_NAME && !m.hidden);
    return idx !== -1 ? idx : 0;
}

// Selection is stored by name (not index) so it survives array reordering.
function getSelectedMemberIndex() {
    const savedName = lsGet('myb_roster_selected_member');
    if (savedName) {
        const idx = teamMembers.findIndex(m => m.name === savedName && !m.hidden);
        if (idx !== -1) return idx;
        // savedName stored but not found — stale entry from a removed member
        _staleMemberName = savedName;
        lsDel('myb_roster_selected_member');
        return getDefaultMemberIndex();
    }
    // No saved selection (fresh device) — auto-select from the admin session if present
    // so the logged-in staff member sees their own calendar without triggering a
    // member-switch cache clear when they pick themselves from the dropdown.
    const sess = getSession();
    if (sess?.name) {
        const idx = teamMembers.findIndex(m => m.name === sess.name && !m.hidden);
        if (idx !== -1) {
            saveSelectedMember(idx);
            return idx;
        }
    }
    return getDefaultMemberIndex();
}

// Save selected team member by name
function saveSelectedMember(index) {
    if (index >= 0 && index < teamMembers.length) {
        lsSet('myb_roster_selected_member', teamMembers[index].name);
    }
}

// Populate team member dropdown
function populateTeamMemberDropdown() {
    const select = document.getElementById('teamMemberSelect');
    if (!select) return;
    
    // Clear any existing options
    select.innerHTML = '';
    
    // Get selected member index using dedicated helper
    const selectedIndex = getSelectedMemberIndex();
    
    // Build dropdown — flat list if only one role present, optgroup per role if multiple.
    // This means no visual change today (all CEA), but CES entries appear in their own
    // group automatically the moment the first CES member is added.
    const visibleMembers = teamMembers
        .map((member, index) => ({ member, index }))
        .filter(({ member }) => !member.hidden);

    const distinctRoles = [...new Set(visibleMembers.map(({ member }) => member.role || 'CEA'))];
    const useGroups = distinctRoles.length > 1;

    if (useGroups) {
        distinctRoles.forEach(role => {
            const group = document.createElement('optgroup');
            group.label = role;
            visibleMembers
                .filter(({ member }) => (member.role || 'CEA') === role)
                .forEach(({ member, index }) => {
                    const option = document.createElement('option');
                    option.value = index;
                    option.textContent = member.name;
                    if (index === selectedIndex) option.selected = true;
                    group.appendChild(option);
                });
            select.appendChild(group);
        });
    } else {
        // Single role — flat list, no group label shown
        visibleMembers.forEach(({ member, index }) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = member.name;
            if (index === selectedIndex) option.selected = true;
            select.appendChild(option);
        });
    }
}

// getWeekNumberForDate, getShiftKind, getShiftClass, getShiftBadge — imported from roster-data.js

// Helper: Get current selected member
function getCurrentMember() {
    const selectedIndex = getSelectedMemberIndex();
    const member = teamMembers[selectedIndex];
    
    if (!member) {
        console.error(`Invalid team member index: ${selectedIndex}`);
        // Fallback to first team member
        return teamMembers[0] || { name: 'Unknown', currentWeek: 1, rosterType: 'main', role: 'CEA' };
    }
    
    return member;
}

// getRosterForMember — imported from roster-data.js

// Helper: Create calendar header HTML (pure function — takes explicit month/year, no global state)
function createCalendarHeader(firstWeekNum, lastWeekNum, weekPrefix, month, year) {
    // Fixed roster (empty weekPrefix) — no week number to display
    let weekDisplay = '';
    if (weekPrefix !== '') {
        if (firstWeekNum === lastWeekNum) {
            weekDisplay = `· ${weekPrefix} ${firstWeekNum}`;
        } else {
            // Build plural: append 's' to the last word of the prefix
            // "CEA Week" → "CEA Weeks", "BL Week" → "BL Weeks", "CES Week" → "CES Weeks", "Week" → "Weeks"
            const lastSpaceIdx = weekPrefix.lastIndexOf(' ');
            const pluralPrefix = lastSpaceIdx !== -1
                ? weekPrefix.slice(0, lastSpaceIdx + 1) + weekPrefix.slice(lastSpaceIdx + 1) + 's'
                : weekPrefix + 's';
            weekDisplay = `· ${pluralPrefix} ${firstWeekNum}-${lastWeekNum}`;
        }
    }
    return `
        <div class="month-year" role="button" tabindex="0" aria-label="Jump to month — currently ${MONTH_NAMES[month]} ${year}">${MONTH_NAMES[month]} ${year}</div>
        <div class="week-info">
            ${weekDisplay ? `<span class="week-info-text">${weekDisplay}</span>` : ''}
        </div>
    `;
}

// escapeHtml — imported from roster-data.js

// Navigate to the pay calculator for a given payday ISO date string.
// Requires a valid session; otherwise redirects to admin login with a return hint.
function navigateToPaycalc(paydayStr) {
    if (getSession()?.name) {
        window.location.href = `./paycalc.html?payday=${paydayStr}`;
    } else {
        window.location.href = './admin.html?redirect=paycalc';
    }
}

// Helper: Create day cell HTML (pure function)
// isWorkedDay — pre-calculated by caller (shift !== RD/SPARE/OFF) to avoid duplication.
// permanentShift ('early'|'late'|undefined) — overrides badge on worked days and suppresses time.
// rdwTime — actual shift time for RDW overrides (e.g. '08:00-16:30'), since shift='RDW' sentinel.
// ============================================
// FAITH CALENDAR HELPERS
// ============================================


function createDayCell(date, shift, permanentShift, isWorkedDay, rdwTime = '', faithMarker = null) {
    let badge;
    // RDW always gets its own badge regardless of permanentShift — it's a distinct pay category
    if (shift !== 'RDW' && isWorkedDay && permanentShift === 'late') {
        badge = '<span class="shift-badge badge-late"><span>🌙</span><span>Late</span></span>';
    } else if (shift !== 'RDW' && isWorkedDay && permanentShift === 'early') {
        badge = '<span class="shift-badge badge-early"><span>☀️</span><span>Early</span></span>';
    } else {
        badge = getShiftBadge(shift);
    }
    const displayTime = shift === 'RDW' ? rdwTime : shift;
    // Insert a word-break opportunity after the hyphen so "06:20-14:20"
    // breaks as "06:20-" / "14:20" on narrow mobile cells, not mid-digit.
    const displayTimeHtml = displayTime ? displayTime.replace('-', '-<wbr>') : '';
    return `
        <div class="day-number">${date.getDate()}</div>
        ${badge}
        ${isWorkedDay && !permanentShift && displayTimeHtml ? `<div class="shift-time">${displayTimeHtml}</div>` : ''}
        ${faithMarker ? `<span class="day-faith" aria-label="${escapeHtml(faithMarker.label)}" title="${escapeHtml(faithMarker.label)}">${faithMarker.icon}</span>` : ''}
    `;
}

// ============================================
// SWIPE GESTURE DETECTION
// ============================================

// SWIPE_THRESHOLD and SWIPE_VELOCITY imported from roster-data.js — shared with admin-app.js

// Calculate swipe direction based on touch coordinates, distance and velocity.
// A gesture commits if it crosses SWIPE_THRESHOLD distance OR exceeds VELOCITY_THRESHOLD
// speed — a fast confident flick registers even if the finger didn't travel far.
function getSwipeDirection(startX, startY, endX, endY, elapsed) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;

    // Calculate angle — swipe must be mostly horizontal (< 30° from horizontal axis)
    const angle = Math.abs(Math.atan2(deltaY, deltaX) * 180 / Math.PI);
    const isHorizontal = angle < 30 || angle > 150;
    if (!isHorizontal) return null;

    const distance = Math.abs(deltaX);
    const velocity = elapsed > 0 ? distance / elapsed : 0; // px/ms

    // Commit if distance threshold met OR velocity threshold met (fast flick)
    if (distance < SWIPE_THRESHOLD && velocity < SWIPE_VELOCITY) return null;

    return deltaX > 0 ? 'right' : 'left';
}

// ============================================
// CALENDAR RENDERING
// ============================================

// Builds and returns a fully populated calendar-container div.
// Accepts explicit month/year so callers never need to mutate global display state.
// Defaults to currentDisplayMonth/Year so existing callers (renderCalendar) are unchanged.
function buildCalendarContainer(month = currentDisplayMonth, year = currentDisplayYear) {
    const member = getCurrentMember();
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    // Resolve the roster descriptor for the displayed month so the week-prefix
    // label (e.g. "CES Week") follows any scheduled rosterChanges transition.
    const roster = getRosterForMember(member, firstDay);

    const today = getToday();
    const calendarContainer = document.createElement('div');
    calendarContainer.className = 'calendar-container';

    const firstWeekNum = getWeekNumberForDate(firstDay, member);
    const lastWeekNum  = getWeekNumberForDate(lastDay,  member);

    // Header
    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML = createCalendarHeader(firstWeekNum, lastWeekNum, roster.weekPrefix, month, year);
    calendarContainer.appendChild(header);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    // Single delegated click listener for payday/cutoff cells — replaces per-cell
    // listener attachment (one per ~6 special cells per month was previously creating
    // closures that were GC'd on next render).
    grid.addEventListener('click', (e) => {
        const cell = e.target.closest('.calendar-day');
        if (!cell) return;
        const paydayIso = cell.dataset.paydayIso;
        if (paydayIso) { navigateToPaycalc(paydayIso); return; }
        const cutoffIso = cell.dataset.cutoffIso;
        if (cutoffIso) {
            // Look up the payday paired with this cutoff rather than adding a fixed
            // offset: paydays shift backwards over bank holidays, so the cutoff→payday
            // gap is not constant. cutoffs[] and paydays[] are parallel arrays, and the
            // cutoff cell only renders when isCutoffDate() is true for its own calendar
            // year, so the cutoff is guaranteed to live in that year's result.
            const cutoffYear = Number(cutoffIso.slice(0, 4));
            const { paydays, cutoffs } = getPaydaysAndCutoffs(cutoffYear);
            const idx = cutoffs.findIndex(c => formatISO(c) === cutoffIso);
            if (idx !== -1) navigateToPaycalc(formatISO(paydays[idx]));
        }
    });

    DAY_NAMES.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        dayHeader.textContent = day;
        grid.appendChild(dayHeader);
    });

    const startDay = firstDay.getDay();
    const prevMonthLastDay = new Date(year, month, 0);
    for (let i = 0; i < startDay; i++) {
        const adjacentMonthCell = document.createElement('div');
        adjacentMonthCell.className = 'calendar-day other-month';
        adjacentMonthCell.setAttribute('aria-hidden', 'true');
        const dayNum = prevMonthLastDay.getDate() - startDay + i + 1;
        adjacentMonthCell.innerHTML = `<div class="day-number">${dayNum}</div>`;
        grid.appendChild(adjacentMonthCell);
    }

    const daysInMonth = lastDay.getDate();
    const faithCalendar = resolveFaithCalendar(memberSettingsCache.get(member.name));
    for (let day = 1; day <= daysInMonth; day++) {
        const currentDate = new Date(year, month, day);

        // getBaseShift handles: Christmas RD, startDate suppression, roster lookup
        let shift = getBaseShift(member, currentDate);

        // Firestore override — applied after the Christmas check so the base rule holds
        // for Dec 25, while Dec 26 (Boxing Day) can still become RDW for overtime.
        // Cache key: "memberName|YYYY-MM-DD" — pipe avoids ambiguity with names containing
        // spaces and dots. The cache is populated by the Firebase module script on load.
        let overrideNote = '';
        let rdwTime = '';
        const dateStr = formatISO(currentDate);
        {
            const override = !isBeforeMemberStart(member, currentDate) ? rosterOverridesCache.get(`${member.name}|${dateStr}`) : null;
            if (override) {
                // RDW overrides carry a real shift time as their value, but must
                // render with the RDW colour scheme, not Early/Late/Night. Swap
                // the value for the 'RDW' sentinel so getShiftClass/Badge pick up
                // the correct pink styling. The actual time is preserved in rdwTime
                // so it can still be shown below the badge.
                if (override.type === 'rdw') {
                    rdwTime = override.value;
                    shift   = 'RDW';
                    overrideNote = override.note;
                } else if (override.type === 'sick' && (shift === 'RD' || shift === 'OFF' || isSunday(dateStr))) {
                    // Sick override on a base rest day, or ANY Sunday — suppress it.
                    // Absence only applies to contracted working days; Sundays are
                    // non-contracted for all grades, so absence never shows on a Sunday
                    // even when the rotating roster brings a worked Sunday into the
                    // absence range (belt-and-braces for any legacy Sunday SICK data).
                } else {
                    shift = override.value;
                    overrideNote = override.note;
                }
            }
        }

        const isWorkedDay = shift !== 'RD' && shift !== 'SPARE' && shift !== 'OFF' && shift !== 'AL' && shift !== 'SICK';
        const shiftClass = shift === 'RDW'                                    ? getShiftClass(shift)
                         : isWorkedDay && member.permanentShift === 'late'  ? 'late-shift'
                         : isWorkedDay && member.permanentShift === 'early' ? 'early-shift'
                         : getShiftClass(shift);
        const dayCell = document.createElement('div');
        dayCell.className = `calendar-day ${shiftClass}`;

        const shiftLabel = shift === 'RD' || shift === 'OFF' ? 'Rest day'
            : shift === 'SPARE' ? 'Spare day'
            : shift === 'AL'    ? 'Annual leave'
            : shift === 'SICK'  ? 'Absence'
            : shift === 'RDW'   ? 'Rest day worked'
            : SHIFT_KIND_LABELS[getShiftKind(shift, member)]
                + (member.permanentShift ? '' : ` ${shift}`);
        const faithMarker = getFaithBadge(dateStr, faithCalendar);

        const isToday  = isSameDay(currentDate, today);
        const isBH     = isBankHoliday(currentDate);
        const isXmas   = isChristmasDay(currentDate);
        const isEaster = isEasterSunday(currentDate);
        const isPay    = isPayday(currentDate);
        const isCutoff = isCutoffDate(currentDate);

        const extras = [
            isToday  ? 'Today' : '',
            isBH     ? 'Bank holiday' : '',
            isXmas   ? 'Christmas Day' : '',
            isEaster ? 'Easter Sunday' : '',
            isPay    ? 'Payday' : '',
            isCutoff ? 'Cut-off date' : '',
            faithMarker ? faithMarker.label : '',
        ].filter(Boolean).join(', ');
        dayCell.setAttribute('aria-label',
            `${fullDayNames[currentDate.getDay()]} ${currentDate.getDate()} ${MONTH_NAMES[month]} ${year} — ${shiftLabel}${extras ? ' — ' + extras : ''}`
        );
        dayCell.setAttribute('tabindex', '-1');
        const ttShift = shiftLabel + (shift === 'RDW' && rdwTime ? ` ${rdwTime}` : '');
        const ttParts = [ttShift];
        if (extras) ttParts.push(extras);
        if (overrideNote) ttParts.push(`"${overrideNote}"`);
        dayCell.dataset.tooltip = ttParts.join(' · ');

        if (isToday)  dayCell.classList.add('today');
        if (isBH)     dayCell.classList.add('bank-holiday');
        if (isXmas)   dayCell.classList.add('christmas-day');
        if (isEaster) dayCell.classList.add('easter-day');
        if (isPay) {
            dayCell.classList.add('payday');
            dayCell.dataset.paydayIso = dateStr;
        }
        if (isCutoff) {
            dayCell.classList.add('cutoff');
            dayCell.dataset.cutoffIso = dateStr;
        }

        dayCell.innerHTML = createDayCell(currentDate, shift, member.permanentShift, isWorkedDay, rdwTime, faithMarker);
        if (faithMarker) dayCell.classList.add('has-faith');
        grid.appendChild(dayCell);
    }

    const totalCells = startDay + daysInMonth;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 1; i <= remainingCells; i++) {
        const adjacentMonthCell = document.createElement('div');
        adjacentMonthCell.className = 'calendar-day other-month';
        adjacentMonthCell.setAttribute('aria-hidden', 'true');
        adjacentMonthCell.innerHTML = `<div class="day-number">${i}</div>`;
        grid.appendChild(adjacentMonthCell);
    }

    // Roving tabindex — today's cell is the keyboard entry point; others sit at -1
    // so Tab reaches the calendar in one keystroke, then arrows move between days.
    const rovingCells  = [...grid.querySelectorAll('.calendar-day:not(.other-month)')];
    const rovingAnchor = rovingCells.find(c => c.classList.contains('today')) || rovingCells[0];
    if (rovingAnchor) rovingAnchor.setAttribute('tabindex', '0');

    calendarContainer.appendChild(grid);
    return calendarContainer;
}

// ============================================
// ANNUAL LEAVE LIGHTBOX
// ============================================
(function() {
    const lb           = document.getElementById('alLightbox');
    const takenEl      = document.getElementById('alLbTaken');
    const bookedEl     = document.getElementById('alLbBooked');
    const remEl        = document.getElementById('alLbRemaining');
    const entEl        = document.getElementById('alLbEntitlement');
    const yearEl       = document.getElementById('alLbYear');
    const breakdownEl  = document.getElementById('alLbBreakdown');

    // Shared canonical lifecycle (focus save/restore, Escape, Tab trap,
    // Android Back) — the inline focus-trap copy this replaces predated
    // trapFocus being extracted to overlay.js at v11.40.
    const alLb = createLightbox({
        overlay:  lb,
        content:  document.getElementById('alLightboxContent'),
        closeBtn: document.getElementById('alLightboxClose'),
        onOpen:   () => loadALStats(),
    });

    const alErrorEl = document.getElementById('alLbError');

    async function loadALStats() {
        const member  = getCurrentMember();
        const year    = currentDisplayYear;
        const yearStr = String(year);

        yearEl.textContent  = yearStr;
        takenEl.textContent = '…';
        bookedEl.textContent = '…';
        remEl.textContent   = '…';
        if (alErrorEl) alErrorEl.hidden = true;

        if (!member) {
            takenEl.textContent = bookedEl.textContent = remEl.textContent = entEl.textContent = '—';
            if (breakdownEl) breakdownEl.hidden = true;
            return;
        }

        entEl.textContent = '…';

        // today's date as YYYY-MM-DD for comparing AL dates
        const todayStr = formatISO(new Date());

        try {
            let taken = 0;
            let booked = 0;
            // Collect all overrides for this member so Dispatcher lieu days can be calculated.
            // Date-range query with client-side memberName filter — matches the calendar pattern
            // and avoids depending on a deployed composite (memberName + date) index.
            const memberOverrides = [];
            const snap = await Promise.race([
                getDocs(query(
                    collection(db, 'overrides'),
                    where('date', '>=', `${yearStr}-01-01`),
                    where('date', '<=', `${yearStr}-12-31`)
                )),
                new Promise((_, reject) => setTimeout(() => reject(new Error('AL load timeout')), 15_000)),
            ]);
            snap.forEach(d => {
                const data = d.data();
                if (data.memberName !== member.name) return;
                memberOverrides.push(data);
                // Sundays are uncontracted — don't count Sunday AL entries
                if (data.type === 'annual_leave' && data.date && data.date.startsWith(yearStr) &&
                        !isSunday(data.date)) {
                    if (data.date <= todayStr) taken++; else booked++;
                }
            });
            const entitlement = getALEntitlement(member, year, memberOverrides);
            entEl.textContent = entitlement;
            const remaining = entitlement - taken - booked;
            takenEl.textContent  = taken;
            bookedEl.textContent = booked;
            remEl.textContent    = remaining;
            remEl.className      = 'al-lb-val' + (remaining <= 0 ? ' empty' : remaining <= 5 ? ' low' : '');
            // Dispatchers: explain the entitlement split (22 base + bank holiday lieu days)
            if (breakdownEl) {
                if (member.role === 'Dispatcher') {
                    const lieu = entitlement - 22;
                    breakdownEl.textContent = `22 base + ${lieu} BH lieu`;
                    breakdownEl.hidden = false;
                } else {
                    breakdownEl.hidden = true;
                }
            }
        } catch (e) {
            console.error('[AL lightbox] Failed:', e);
            takenEl.textContent = bookedEl.textContent = remEl.textContent = entEl.textContent = '—';
            if (breakdownEl) breakdownEl.hidden = true;
            if (alErrorEl) alErrorEl.hidden = false;
        }
    }

    window.closeALLightbox = alLb.close;

    document.getElementById('alBtn').addEventListener('click', alLb.open);
})();

/**
 * Returns a Set of shift-type strings that actually appear in the given month
 * for the given member, after applying roster pattern + Firestore overrides.
 * Used by updateLegend() to show/hide Spare, RDW, and AL legend items.
 *
 * Result is memoised in shiftTypesMonthCache keyed by "memberName|year|month".
 * The cache is cleared by fetchOverridesForRange() whenever fresh override data
 * arrives from Firestore, so stale results are never served.
 *
 * @param {Object} member - member object from teamMembers
 * @param {number} year
 * @param {number} month - 0-indexed JS month
 * @returns {Set<string>}
 */
function getShiftTypesInMonth(member, year, month) {
    const cacheKey = `${member.name}|${year}|${month}`;
    if (shiftTypesMonthCache.has(cacheKey)) return shiftTypesMonthCache.get(cacheKey);

    const types = new Set();
    const days  = new Date(year, month + 1, 0).getDate(); // last day of month

    for (let day = 1; day <= days; day++) {
        const date    = new Date(year, month, day);
        // getBaseShift applies the Christmas RD rule before the roster lookup
        let shift = getBaseShift(member, date);

        const dateStr = formatISO(date);
        const ov = !isBeforeMemberStart(member, date) ? rosterOverridesCache.get(`${member.name}|${dateStr}`) : null;
        if (ov && !(ov.type === 'sick' && (shift === 'RD' || shift === 'OFF' || isSunday(dateStr)))) {
            shift = ov.type === 'rdw' ? 'RDW' : ov.value;
        }

        if (shift === 'SPARE') types.add('SPARE');
        else if (shift === 'RDW')  types.add('RDW');
        else if (shift === 'AL')   types.add('AL');
        else if (shift === 'SICK') types.add('SICK');
    }

    shiftTypesMonthCache.set(cacheKey, types);
    return types;
}

// updateLegend — shows/hides conditional legend items:
//   Spare/RDW/AL — only when that shift type actually appears this month
//   Night        — only for Dispatcher roster members
//   🎄 Christmas — only in December
//   🐣 Easter    — only in the month Easter Sunday falls in
//   Faith events — only for opted-in calendar, only the months that event falls in
// Called inside renderCalendar() on every navigation.
function _legendEl(id) {
    return document.getElementById(id);
}

function updateLegend() {
    const member = getCurrentMember();

    // Spare / RDW / AL — conditional on whether they appear this month
    const typesThisMonth = member
        ? getShiftTypesInMonth(member, currentDisplayYear, currentDisplayMonth)
        : new Set();
    const setLegendItemVisible = (id, visible) => { const legendItem = _legendEl(id); if (legendItem) legendItem.style.display = visible ? '' : 'none'; };
    setLegendItemVisible('legend-spare', typesThisMonth.has('SPARE'));
    setLegendItemVisible('legend-rdw',   typesThisMonth.has('RDW'));
    setLegendItemVisible('legend-al',    typesThisMonth.has('AL'));
    setLegendItemVisible('legend-sick',  typesThisMonth.has('SICK'));
    // Hide the whole row-2 if all four are absent
    const row2 = _legendEl('legend-row-2');
    if (row2) row2.style.display = (typesThisMonth.has('SPARE') || typesThisMonth.has('RDW') || typesThisMonth.has('AL') || typesThisMonth.has('SICK')) ? '' : 'none';

    const isDispatcher = member && member.rosterType === 'dispatcher';
    const nightItem = _legendEl('legend-night');
    if (nightItem) nightItem.style.display = isDispatcher ? '' : 'none';

    const christmasItem = _legendEl('legend-christmas');
    if (christmasItem) christmasItem.style.display = currentDisplayMonth === 11 ? '' : 'none';

    // Easter Sunday can fall in March or April — check which month it's in this year
    const easterItem = _legendEl('legend-easter');
    if (easterItem) {
        const easterSunMonth = computeEaster(currentDisplayYear).getMonth();
        easterItem.style.display = currentDisplayMonth === easterSunMonth ? '' : 'none';
    }

    // Faith calendar legend — show each item only in the month that date falls in,
    // and only when the current member has opted in to that calendar.
    const faithCalendar = member ? resolveFaithCalendar(memberSettingsCache?.get(member.name)) : 'none';
    const y = currentDisplayYear;
    const m = currentDisplayMonth;

    function faithInMonth(dateSet, requiredCalendar) {
        if (faithCalendar !== requiredCalendar) return false;
        for (const d of dateSet) {
            const [faithYear, faithMonth] = d.split('-').map(Number);
            if (faithYear === y && (faithMonth - 1) === m) return true;
        }
        return false;
    }

    const legendIds = {
        'legend-ramadan':        [RAMADAN_STARTS,                 'islamic'],
        'legend-eid-fitr':       [EID_FITR_DATES,                 'islamic'],
        'legend-eid-adha':       [EID_ADHA_DATES,                 'islamic'],
        'legend-islamic-ny':     [ISLAMIC_NEW_YEAR_DATES,         'islamic'],
        'legend-mawlid':         [MAWLID_DATES,                   'islamic'],
        'legend-holi':           [HOLI_DATES,                     'hindu'],
        'legend-navratri':       [NAVRATRI_DATES,                 'hindu'],
        'legend-dussehra':       [DUSSEHRA_DATES,                 'hindu'],
        'legend-diwali':         [DIWALI_DATES,                   'hindu'],
        'legend-raksha':         [RAKSHA_BANDHAN_DATES,           'hindu'],
        'legend-lantern':        [LANTERN_FESTIVAL_DATES,         'chinese'],
        'legend-qingming':       [QINGMING_DATES,                 'chinese'],
        'legend-dragon-boat':    [DRAGON_BOAT_DATES,              'chinese'],
        'legend-mid-autumn':     [MID_AUTUMN_DATES,               'chinese'],
        'legend-ash-wednesday':  [JAMAICAN_ASH_WEDNESDAY_DATES,   'jamaican'],
        'legend-labour-day':     [JAMAICAN_LABOUR_DAY_DATES,      'jamaican'],
        'legend-emancipation':   [JAMAICAN_EMANCIPATION_DATES,    'jamaican'],
        'legend-independence':   [JAMAICAN_INDEPENDENCE_DATES,    'jamaican'],
        'legend-heroes-day':     [JAMAICAN_HEROES_DAY_DATES,      'jamaican'],
        'legend-drc-martyrs':    [CONGOLESE_MARTYRS_DATES,        'congolese'],
        'legend-drc-liberation': [CONGOLESE_LIBERATION_DATES,     'congolese'],
        'legend-drc-heroes':     [CONGOLESE_HEROES_DATES,         'congolese'],
        'legend-drc-independence':[CONGOLESE_INDEPENDENCE_DATES,  'congolese'],
        'legend-pt-carnival':    [PORTUGUESE_CARNIVAL_DATES,      'portuguese'],
        'legend-pt-freedom':     [PORTUGUESE_FREEDOM_DATES,       'portuguese'],
        'legend-pt-labour':      [PORTUGUESE_LABOUR_DATES,        'portuguese'],
        'legend-pt-portugal-day':[PORTUGUESE_PORTUGAL_DAY_DATES,  'portuguese'],
        'legend-pt-corpus':      [PORTUGUESE_CORPUS_CHRISTI_DATES,'portuguese'],
        'legend-pt-assumption':  [PORTUGUESE_ASSUMPTION_DATES,    'portuguese'],
        'legend-pt-republic':    [PORTUGUESE_REPUBLIC_DATES,      'portuguese'],
        'legend-pt-restoration': [PORTUGUESE_RESTORATION_DATES,   'portuguese'],
        'legend-pt-immaculate':  [PORTUGUESE_IMMACULATE_DATES,    'portuguese'],
    };
    let faithVisible = false;
    for (const [id, [dateSet, cal]] of Object.entries(legendIds)) {
        const el = _legendEl(id);
        const visible = faithInMonth(dateSet, cal);
        if (el) el.style.display = visible ? '' : 'none';
        if (visible) faithVisible = true;
    }

    const faithRow = _legendEl('legend-faith-row');

    // Chinese New Year legend — use the zodiac icon for the matching year.
    const cnyEl   = document.getElementById('legend-cny');
    const cnyText = document.getElementById('legend-cny-text');
    if (cnyEl && cnyText) {
        let cnyVisible = false;
        if (faithCalendar === 'chinese') {
            for (const [dateStr, { icon, label }] of CHINESE_NEW_YEAR_DATES) {
                const [faithYear, faithMonth] = dateStr.split('-').map(Number);
                if (faithYear === y && (faithMonth - 1) === m) {
                    cnyText.textContent = `${icon} ${label}`;
                    cnyVisible = true;
                    break;
                }
            }
        }
        cnyEl.style.display = cnyVisible ? '' : 'none';
        if (cnyVisible) faithVisible = true;
    }

    if (faithRow) faithRow.style.display = faithVisible ? '' : 'none';
}

// renderCalendar — used for all non-swipe navigation (buttons, keyboard, today).
// Sets data-member-name for print header then builds and inserts fresh container.
function renderCalendar() {
    try {
        const member = getCurrentMember();

        // If the previously-selected member was removed from the roster, show a one-time notice.
        if (_staleMemberName) {
            const stale = _staleMemberName;
            _staleMemberName = null;
            const banner = document.getElementById('errorBanner');
            if (banner) {
                banner.textContent = `"${stale}" is no longer in the roster — showing ${member.name}'s calendar. Use the dropdown to select the correct person.`;
                banner.classList.add('visible');
                // Keep visible for 30s — this is actionable (user needs to re-select).
                setTimeout(() => banner.classList.remove('visible'), 30000);
            }
        }

        // Update legend for current member and month (Night, 🎄, 🥚 are conditional)
        updateLegend();

        // Set team member name on header for printing
        const headerElement = document.querySelector('.header');
        if (headerElement) headerElement.setAttribute('data-member-name', member.name);

        const calendarDisplay = document.getElementById('calendarDisplay');
        if (!calendarDisplay) throw new Error('Calendar display element not found');

        document.title = `MYB Roster — ${MONTH_NAMES[currentDisplayMonth]} ${currentDisplayYear}`;

        // Persist so the user returns to the same month after closing the app
        lsSet('myb_roster_month', currentDisplayMonth);
        lsSet('myb_roster_year',  currentDisplayYear);

        const calendarContainer = buildCalendarContainer(); // uses defaults
        calendarDisplay.innerHTML = '';
        calendarDisplay.appendChild(calendarContainer);

        // Update Prev/Next buttons at year/month boundaries
        // aria-disabled signals the limit to screen readers; opacity gives visual feedback
        const atStart = currentDisplayYear === CONFIG.MIN_YEAR && currentDisplayMonth === 0;
        const atEnd   = currentDisplayYear === CONFIG.MAX_YEAR && currentDisplayMonth === 11;
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
            ensureOverridesCached(currentDisplayYear, currentDisplayMonth);
        }

    } catch (error) {
        console.error('Error rendering calendar:', error);
        const calendarDisplay = document.getElementById('calendarDisplay');
        if (calendarDisplay) {
            const errDiv = document.createElement('div');
            errDiv.className = 'calendar-error';
            errDiv.innerHTML = '<h2>⚠️ Couldn\'t display your roster</h2><p>Close the app and open it again. If it keeps happening, check your connection or contact the admin team.</p>';
            calendarDisplay.innerHTML = '';
            calendarDisplay.appendChild(errDiv);
        }
    }
}


// ============================================
// EVENT LISTENERS
// ============================================

document.getElementById('teamMemberSelect').addEventListener('change', (e) => {
    if (swipeCooldown) return; // Don't interrupt a swipe animation
    saveSelectedMember(parseInt(e.target.value, 10));
    updateLegend();
    renderCalendar();
    // Close AL lightbox if open — data would be stale for the new member
    window.closeALLightbox?.();
});


document.getElementById('prevMonth').addEventListener('click', () => {
    if (swipeCooldown) return;
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
        void todayCell.offsetWidth; // Force reflow to restart animation
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
        announcer.textContent = `${MONTH_NAMES[currentDisplayMonth]} ${currentDisplayYear}`;
    });
}


document.getElementById('todayBtn').addEventListener('click', () => {
    if (swipeCooldown) return;
    if (teamView.isTeamViewMode()) {
        teamView.jumpToCurrentWeek();
    } else {
        const now = getToday();
        currentDisplayMonth = now.getMonth();
        currentDisplayYear = now.getFullYear();
        renderCalendar();
        pulseToday();
        announceMonthChange();
    }
});

document.getElementById('nextMonth').addEventListener('click', () => {
    if (swipeCooldown) return;
    changeMonth(1);
    renderCalendar();
    announceMonthChange();
});

// Pay button — navigates to paycalc.html for any signed-in staff member.
// If no session exists, sends the user to admin.html to sign in, then redirects back.
document.getElementById('payBtn').addEventListener('click', () => {
    if (getSession()?.name) {
        const m = String(currentDisplayMonth + 1).padStart(2, '0');
        window.location.href = `./paycalc.html?month=${currentDisplayYear}-${m}`;
    } else {
        window.location.href = './admin.html?redirect=paycalc';
    }
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
            if (today >= start && today <= payday) { period = { payday, cutoff, start }; break; }
        }
        if (period) break;
    }
    if (!period) return;

    const fmt    = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
    const payISO = formatISO(period.payday);
    strip.innerHTML = `Pay period: <a class="pay-period-link" href="./paycalc.html?payday=${payISO}">${fmt(period.start)} – ${fmt(period.cutoff)}</a> · paid ${fmt(period.payday)}`;
    strip.style.display = '';
})();

document.getElementById('adminBtn').addEventListener('click', () => {
    const today = getToday();
    const isCurrentMonth = currentDisplayMonth === today.getMonth() && currentDisplayYear === today.getFullYear();
    const targetDate = isCurrentMonth ? today : new Date(currentDisplayYear, currentDisplayMonth, 1);
    const yyyy = String(targetDate.getFullYear()).padStart(4, '0');
    const mm   = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd   = String(targetDate.getDate()).padStart(2, '0');
    location.href = `admin.html?date=${yyyy}-${mm}-${dd}`;
});

document.getElementById('teamViewBtn').addEventListener('click', teamView.toggleTeamView);

(function initTeamLightboxes() {
    const lb = document.getElementById('teamInfoLightbox');
    if (!lb) return;

    // Shared canonical lifecycle — replaces a permanent document keydown
    // listener and a delayed (afterClose) focus restore that had drifted from
    // the pattern every other lightbox follows.
    const teamInfo = createLightbox({
        overlay:  lb,
        content:  document.getElementById('teamInfoContent'),
        closeBtn: document.getElementById('teamInfoClose'),
    });

    // Event delegation — #teamHelpBtn is re-created on every renderTeamView() call.
    document.addEventListener('click', e => {
        if (e.target.closest('#teamHelpBtn')) teamInfo.open();
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

        // ============================================
        // SETUP SWIPE/DRAG GESTURES (Touch + Mouse + Trackpad)
        // ============================================
        // Uses the Pointer Events API — a single unified API for mouse, touch
        // and stylus. Works identically on mobile (finger swipe) and desktop
        // (click-drag or trackpad swipe). setPointerCapture() on pointerdown
        // ensures events keep firing even if the pointer leaves the element.
        // ============================================
        const calendarDisplay = document.getElementById('calendarDisplay');

        if (calendarDisplay) {
            // Respect prefers-reduced-motion — instant transitions for users who need it
            const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const TRANSITION             = prefersReducedMotion ? 'none' : 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
            const TRANSITION_DURATION_MS = prefersReducedMotion ? 0 : 350; // Must match the duration in TRANSITION above
            let prevPanel = null;
            let nextPanel = null;
            let isListening = false;     // True from pointerdown until gesture is resolved (tap or completed swipe)
            let isDragging = false;      // True only after horizontal intent is confirmed in pointermove
            let touchStartX = 0;
            let touchStartY = 0;
            let touchStartTime = 0;
            let gestureW = 0;            // Cached display width — measured on pointerdown, reused throughout gesture
            let gestureCurrentPanel = null; // Cached current panel — queried once on pointerdown, reused throughout gesture
            let rafId = null;            // requestAnimationFrame handle — throttles transform writes to one per frame
            let pendingX = 0;            // Most recent deltaX — consumed by the scheduled RAF frame
            let _vibratePrimed = false;  // navigator.vibrate(0) only needs to run once per page lifetime

            // Returns true if swiping in the given direction would actually change the month.
            // At the year boundaries, swiping toward the blocked side should always snap back.
            function canNavigate(direction) {
                if (direction === 'prev') {
                    return !(currentDisplayYear === CONFIG.MIN_YEAR && currentDisplayMonth === 0);
                }
                if (direction === 'next') {
                    return !(currentDisplayYear === CONFIG.MAX_YEAR && currentDisplayMonth === 11);
                }
                return true;
            }

            // Build a panel for an adjacent month using explicit month/year params —
            // no global state mutation, no risk of corruption if an exception is thrown.
            function buildAdjacentPanel(monthDelta) {
                let m = currentDisplayMonth + monthDelta;
                let y = currentDisplayYear;
                if (m > 11) { m = 0;  y++; }
                if (m < 0)  { m = 11; y--; }
                // Clamp to valid range
                if (y > CONFIG.MAX_YEAR) { y = CONFIG.MAX_YEAR; m = 11; }
                if (y < CONFIG.MIN_YEAR) { y = CONFIG.MIN_YEAR; m = 0;  }
                return buildCalendarContainer(m, y);
            }

            // Position a panel off-screen without transition.
            // Static layout (position/top/left/width) is in the .carousel-panel CSS class.
            // gestureW is cached on touchstart — no layout recalculation needed here.
            function parkPanel(panel, side) {
                panel.classList.add('carousel-panel');
                panel.style.transition = 'none';
                panel.style.transform  = `translate3d(${side === 'right' ? gestureW : -gestureW}px, 0, 0)`;
                panel.style.willChange = 'transform';
            }

            // Remove pre-built panels cleanly from DOM
            function discardPanels() {
                if (prevPanel && prevPanel.parentNode) prevPanel.remove();
                if (nextPanel && nextPanel.parentNode) nextPanel.remove();
                prevPanel = null;
                nextPanel = null;
            }

            let hapticFired = false;

            // pointerdown — record start position and pre-build adjacent panels.
            // Pointer Events unifies mouse, touch and stylus into one API. We defer setPointerCapture
            // to pointermove (once horizontal intent is confirmed) because capturing immediately on
            // pointerdown causes iOS Safari to mis-classify the gesture and suppress pointermove
            // events — the same approach used in admin.html where swipe works reliably on iOS.
            //
            // Panels are built here (not in pointermove) so that DOM construction and layer promotion
            // happen during the dead-zone before horizontal intent is confirmed. By the time the user
            // has moved far enough to trigger dragging, the GPU layers are already ready — eliminating
            // the jank spike that occurred when panels were built mid-swipe. If the gesture turns out
            // to be a tap, discardPanels() in pointerup cleans them up with no visible effect.
            calendarDisplay.addEventListener('pointerdown', (e) => {
                if (!e.isPrimary || swipeCooldown || teamView.isTeamViewMode()) return;

                gestureCurrentPanel = document.querySelector('.calendar-container:not(.carousel-panel)');
                if (!gestureCurrentPanel) return;

                // Prime the Vibration API once on the first user gesture only.
                // Chrome Android requires a user activation before navigator.vibrate() works,
                // but we only need to do it once per page lifetime, not on every pointerdown.
                if (!_vibratePrimed && navigator.vibrate) { navigator.vibrate(0); _vibratePrimed = true; }

                touchStartX    = e.clientX;
                touchStartY    = e.clientY;
                touchStartTime = Date.now();
                isListening    = true;
                isDragging     = false;
                hapticFired    = false;

                // Measure width now — avoids a forced layout reflow mid-gesture.
                gestureW = Math.ceil(calendarDisplay.getBoundingClientRect().width);

                // Promote current panel to its own compositor layer before dragging starts.
                gestureCurrentPanel.style.willChange = 'transform';

                // Build and park adjacent panels while the finger is still in the dead-zone.
                try {
                    if (canNavigate('prev')) {
                        prevPanel = buildAdjacentPanel(-1);
                        parkPanel(prevPanel, 'left');
                        calendarDisplay.appendChild(prevPanel);
                    }
                    if (canNavigate('next')) {
                        nextPanel = buildAdjacentPanel(1);
                        parkPanel(nextPanel, 'right');
                        calendarDisplay.appendChild(nextPanel);
                    }
                } catch (err) {
                    console.error('Failed to pre-build adjacent panels:', err);
                    discardPanels();
                }
            });

            // pointermove — confirm direction then track finger position.
            // On the first move past the dead zone we decide: vertical → abandon (panels were
            // pre-built in pointerdown, so discard them); horizontal → capture the pointer and
            // start dragging. Deferring setPointerCapture to here (not pointerdown) is the key
            // fix for iOS Safari, which is stricter than Android about gesture arbitration.
            calendarDisplay.addEventListener('pointermove', (e) => {
                if (!e.isPrimary || !isListening) return;

                const deltaX = e.clientX - touchStartX;
                const deltaY = e.clientY - touchStartY;

                if (!isDragging) {
                    // Dead zone — ignore tiny jitter
                    if (Math.abs(deltaX) <= 5 && Math.abs(deltaY) <= 5) return;

                    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
                        // Vertical intent — abandon; let the browser handle scrolling.
                        // Clean up the panels pre-built in pointerdown.
                        isListening = false;
                        discardPanels();
                        if (gestureCurrentPanel) {
                            gestureCurrentPanel.style.willChange = '';
                            gestureCurrentPanel = null;
                        }
                        return;
                    }

                    // Horizontal intent confirmed — panels are already in the DOM from pointerdown.
                    // Defer setPointerCapture to here (iOS Safari suppresses pointermove if captured
                    // on pointerdown). Disable transition so finger maps 1:1 to panel position.
                    calendarDisplay.setPointerCapture(e.pointerId);
                    gestureCurrentPanel.style.transition = 'none';
                    swipeCooldown = true;
                    isDragging    = true;
                }

                if (!gestureCurrentPanel) return;

                const RESISTANCE = 0.3;
                const atPrevBoundary = deltaX > 0 && !prevPanel;
                const atNextBoundary = deltaX < 0 && !nextPanel;
                const effectiveDeltaX = (atPrevBoundary || atNextBoundary)
                    ? deltaX * RESISTANCE
                    : deltaX;

                // RAF-throttle transform writes — pointermove fires faster than the display refresh
                // rate (up to 120 Hz on ProMotion). Writing style.transform on every event causes
                // redundant style mutations per frame and is the main source of swipe jitter on iOS.
                // Storing the latest position in pendingX and scheduling one RAF per frame keeps
                // transforms in sync with the compositor.
                // translate3d(x, 0, 0) is used instead of translateX(x) — functionally equivalent
                // but more reliably pushed to the GPU compositing thread on iOS Safari.
                pendingX = effectiveDeltaX;
                if (!rafId) {
                    rafId = requestAnimationFrame(() => {
                        rafId = null;
                        if (!gestureCurrentPanel) return;
                        gestureCurrentPanel.style.transform = `translate3d(${pendingX}px, 0, 0)`;
                        if (prevPanel) prevPanel.style.transform = `translate3d(${-gestureW + pendingX}px, 0, 0)`;
                        if (nextPanel) nextPanel.style.transform = `translate3d(${gestureW  + pendingX}px, 0, 0)`;
                    });
                }

                if (!hapticFired && !atPrevBoundary && !atNextBoundary && Math.abs(deltaX) >= SWIPE_THRESHOLD) {
                    if (navigator.vibrate) navigator.vibrate(30);
                    hapticFired = true;
                }
            });

            // pointerup — replaces touchend
            calendarDisplay.addEventListener('pointerup', (e) => {
                if (!e.isPrimary || !isListening) return;
                isListening = false;

                if (!isDragging) {
                    // Pointer went down and up without confirmed horizontal drag — was a tap.
                    // Discard the panels pre-built in pointerdown and clear layer promotion.
                    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
                    discardPanels();
                    if (gestureCurrentPanel) gestureCurrentPanel.style.willChange = '';
                    gestureCurrentPanel = null;
                    return;
                }
                isDragging = false;
                if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

                // Release pointer capture now gesture is complete
                try { calendarDisplay.releasePointerCapture(e.pointerId); } catch (_) {}

                const current = gestureCurrentPanel;
                if (!current) { discardPanels(); swipeCooldown = false; return; }

                const direction = getSwipeDirection(touchStartX, touchStartY, e.clientX, e.clientY, Date.now() - touchStartTime);
                const w = gestureW;

                if (direction) {
                    if (!hapticFired && navigator.vibrate) navigator.vibrate(30);

                    const incomingPanel = direction === 'left' ? nextPanel : prevPanel;
                    const discardPanel  = direction === 'left' ? prevPanel : nextPanel;

                    if (!incomingPanel) {
                        discardPanels();
                        current.style.transition = 'none';
                        current.style.transform  = '';
                        current.style.willChange = '';
                        swipeCooldown = false;
                        console.warn('Swipe commit: incomingPanel was null, aborting without state change');
                        return;
                    }

                    changeMonth(direction === 'left' ? 1 : -1);
                    document.title = `MYB Roster — ${MONTH_NAMES[currentDisplayMonth]} ${currentDisplayYear}`;
                    updateLegend();

                    current.style.transition       = TRANSITION;
                    current.style.transform        = `translate3d(${direction === 'left' ? -w : w}px, 0, 0)`;
                    incomingPanel.style.transition = TRANSITION;
                    incomingPanel.style.transform  = 'translate3d(0, 0, 0)';

                    if (discardPanel && discardPanel.parentNode) discardPanel.remove();

                    function restoreIncoming() {
                        incomingPanel.classList.remove('carousel-panel');
                        incomingPanel.style.transition = '';
                        incomingPanel.style.transform  = '';
                        incomingPanel.style.willChange = '';
                        if (current.parentNode) current.remove();
                        prevPanel = null;
                        nextPanel = null;
                        gestureCurrentPanel = null;
                        swipeCooldown = false;
                        // Swipe bypasses renderCalendar() so ensureOverridesCached() would
                        // never fire for the newly-visible month. After a member switch the
                        // 3-month IIFE cache is cleared and only the previously-viewed month
                        // was re-fetched — swiping to an adjacent month would show no overrides.
                        // This call is a no-op if the month is already cached.
                        ensureOverridesCached(currentDisplayYear, currentDisplayMonth);
                    }

                    const safetyTimer = setTimeout(restoreIncoming, TRANSITION_DURATION_MS + 50);
                    incomingPanel.addEventListener('transitionend', () => {
                        clearTimeout(safetyTimer);
                        restoreIncoming();
                    }, { once: true });

                } else {
                    current.style.transition = TRANSITION;
                    current.style.transform  = 'translate3d(0, 0, 0)';
                    current.style.willChange = '';
                    if (prevPanel) { prevPanel.style.transition = TRANSITION; prevPanel.style.transform = `translate3d(${-w}px, 0, 0)`; }
                    if (nextPanel) { nextPanel.style.transition = TRANSITION; nextPanel.style.transform = `translate3d(${w}px, 0, 0)`;  }
                    setTimeout(() => {
                        discardPanels();
                        gestureCurrentPanel = null;
                        swipeCooldown = false;
                    }, TRANSITION_DURATION_MS + 50);
                }
            });

            // pointercancel — fires when OS interrupts the gesture (call, notification, rotate)
            calendarDisplay.addEventListener('pointercancel', (e) => {
                if (!e.isPrimary || !isListening) return;
                isListening   = false;
                isDragging    = false;
                swipeCooldown = false;
                if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

                // Release pointer capture on cancel
                try { calendarDisplay.releasePointerCapture(e.pointerId); } catch (_) {}

                if (gestureCurrentPanel) {
                    gestureCurrentPanel.style.transition = 'none';
                    gestureCurrentPanel.style.transform  = '';
                    gestureCurrentPanel.style.willChange = '';
                    gestureCurrentPanel = null;
                }
                discardPanels();
            });

            // Prevent context menu on long-press (Android) or right-click (desktop)
            calendarDisplay.addEventListener('contextmenu', (e) => e.preventDefault());

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
                appLabel: 'MYB Roster',
                getUserName: () => getCurrentMember()?.name || 'Not selected',
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
            const selMonth   = document.getElementById('monthJumpMonth');
            const selYear    = document.getElementById('monthJumpYear');
            const btnConfirm = document.getElementById('monthJumpConfirm');
            const btnCancel  = document.getElementById('monthJumpCancel');
            if (!overlay) return;

            // Populate year select once (2024–2030)
            for (let y = CONFIG.MIN_YEAR; y <= CONFIG.MAX_YEAR; y++) {
                const opt = document.createElement('option');
                opt.value = y; opt.textContent = y;
                selYear.appendChild(opt);
            }
            // Populate month select once
            MONTH_NAMES.forEach((name, i) => {
                const opt = document.createElement('option');
                opt.value = i; opt.textContent = name;
                selMonth.appendChild(opt);
            });

            // Shared canonical lifecycle — adds the focus restore this picker
            // never had (closing used to drop keyboard focus to <body>).
            // No .lb-close button here: Cancel is the close control.
            const picker = createLightbox({
                overlay,
                content: card,
                initialFocus: () => selMonth,
                onOpen() {
                    selMonth.value = currentDisplayMonth;
                    selYear.value  = currentDisplayYear;
                },
            });

            // Delegated click: any .month-year element (rebuilt on each render)
            document.getElementById('calendarDisplay').addEventListener('click', e => {
                if (e.target.closest('.month-year')) picker.open();
            });
            document.getElementById('calendarDisplay').addEventListener('keydown', e => {
                if (e.target.closest('.month-year') && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault(); picker.open();
                }
            });

            btnConfirm.addEventListener('click', () => {
                currentDisplayMonth = parseInt(selMonth.value, 10);
                currentDisplayYear  = parseInt(selYear.value, 10);
                picker.close();
                renderCalendar();
                announceMonthChange();
                // renderCalendar() rebuilt the heading the focus restore pointed
                // at — move focus onto the freshly rendered equivalent.
                document.querySelector('.month-year')?.focus();
            });

            btnCancel.addEventListener('click', picker.close);
        })();

        // ============================================
        // KEYBOARD SHORTCUTS (Desktop)
        // ============================================
        document.addEventListener('keydown', (e) => {
            // Don't fire if user is typing in an input
            if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
            // Don't fire behind ANY open lightbox — focus sits on a button there,
            // so the input check above doesn't help: arrows/t would silently
            // change the month behind the overlay and p would print it.
            if (document.querySelector('.lb-overlay.visible')) return;
            if (swipeCooldown) return; // Don't interrupt a swipe animation
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
            if (e.key === 't' || e.key === 'T') { const now = getToday(); currentDisplayMonth = now.getMonth(); currentDisplayYear = now.getFullYear(); renderCalendar(); pulseToday(); announceMonthChange(); }
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
// FIRESTORE HELPER FUNCTIONS
// ============================================


/**
 * Generate a month key string (e.g. '2026-03') for the fetchedMonths Set.
 * @param {number} year
 * @param {number} month - 0-indexed JS month
 * @returns {string}
 */
function monthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Query Firestore for all override documents in a date range and populate the cache.
 * Documents with missing required fields are skipped and logged.
 * @param {string} startStr - 'YYYY-MM-DD' inclusive start
 * @param {string} endStr   - 'YYYY-MM-DD' inclusive end
 */
async function fetchOverridesForRange(startStr, endStr) {
    const q = query(
        collection(db, 'overrides'),
        where('date', '>=', startStr),
        where('date', '<=', endStr)
    );
    const snapshot = await getDocs(q);
    if (snapshot.size >= 1900) console.warn('[Firestore] Override query returned', snapshot.size, 'docs — approaching practical limit. Consider archiving old overrides.');
    snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.memberName || !data.date || !data.value) {
            console.error('[Firestore] Skipping malformed override document:', doc.id, data);
            return;
        }
        const key      = `${data.memberName}|${data.date}`;
        const incoming = {
            value:     data.value,
            note:      data.note   || '',
            type:      data.type   || '',
            source:    data.source || null,
            createdAt: data.createdAt || null,
        };
        const existing = rosterOverridesCache.get(key);
        if (existing) {
            console.warn('[Firestore] Duplicate override for', key,
                '— keeping', shouldReplaceOverride(existing, incoming) ? 'incoming' : 'existing',
                { existing, incoming });
        }
        if (shouldReplaceOverride(existing, incoming)) {
            rosterOverridesCache.set(key, incoming);
        }
    });
    // New override data may change which shift types appear in a month,
    // so invalidate the getShiftTypesInMonth() memo cache.
    shiftTypesMonthCache.clear();
}

/**
 * Ensure overrides for a given month are in the cache.
 * Called by renderCalendar() on every navigation — no-op if already fetched,
 * fires a background fetch and re-render if not.
 * @param {number} year
 * @param {number} month - 0-indexed JS month
 */
async function ensureOverridesCached(year, month) {
    const key = monthKey(year, month);
    if (fetchedMonths.has(key)) return;  // Already fetched — nothing to do

    // Mark before awaiting to prevent concurrent duplicate fetches
    // if renderCalendar() fires twice in quick succession for the same month.
    fetchedMonths.add(key);

    const memberAtFetch = getSelectedMemberIndex();
    try {
        const startStr = formatISO(new Date(year, month, 1));
        const endStr   = formatISO(new Date(year, month + 1, 0));
        await fetchOverridesForRange(startStr, endStr);
        if (!teamView.isTeamViewMode() && getSelectedMemberIndex() === memberAtFetch) renderCalendar();
    } catch (err) {
        fetchedMonths.delete(key);  // Allow retry on next navigation
        console.error('[Firestore] Failed to fetch overrides for', key, err);
    }
}

// ============================================
// INITIAL 3-MONTH FETCH
// Fetches previous, current, and next month in a single Firestore query.
// Pre-fills the cache for all three swipe positions so there is no visible
// delay when the user swipes left or right on first open.
// ============================================
(async () => {
    _initialFetchInProgress = true;

    const now  = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Mark all three months as fetched before awaiting — prevents
    // ensureOverridesCached() from issuing redundant per-month fetches
    // if renderCalendar() fires while the initial query is in flight.
    fetchedMonths.add(monthKey(prev.getFullYear(), prev.getMonth()));
    fetchedMonths.add(monthKey(now.getFullYear(),  now.getMonth()));
    fetchedMonths.add(monthKey(next.getFullYear(), next.getMonth()));

    // Show an "Updating your shifts…" chip after 800 ms if Firestore hasn't responded yet.
    // Injected into .calendar-header so it sits next to the month/year heading.
    // Also adds .calendar-fetching to the calendar container to trigger skeleton shimmer.
    // Cleared on success (brief "✓ Up to date"), or replaced with an error + retry on timeout.
    let syncChip = null;
    let syncResolved = false;
    const calGrid = document.getElementById('calendarDisplay');
    const loadingTimer = setTimeout(() => {
        const header = document.querySelector('.calendar-header');
        if (header && !syncResolved) {
            syncChip = document.createElement('span');
            syncChip.className = 'sync-chip';
            syncChip.setAttribute('aria-live', 'polite');
            syncChip.textContent = '↻ Updating your shifts…';
            header.appendChild(syncChip);
        }
        if (calGrid) calGrid.classList.add('calendar-fetching');
    }, 800);

    // If Firestore takes more than 10 s, show an error state with a retry link.
    const timeoutTimer = setTimeout(() => {
        if (syncResolved) return;
        if (syncChip) {
            syncChip.textContent = '⚠ Couldn\'t update — tap to retry';
            syncChip.className = 'sync-chip sync-chip-error';
            syncChip.style.cursor = 'pointer';
            syncChip.addEventListener('click', doRetry, { once: true });
        }
        if (calGrid) calGrid.classList.remove('calendar-fetching');
    }, 10000);

    // Retry handler — re-runs the same 3-month fetch as the initial load.
    // Shows "↻ Retrying…" while in flight so the user knows something is happening.
    // Restores the error chip (with another retry listener) if the attempt fails again.
    async function doRetry() {
        if (!syncChip) return;
        syncChip.textContent = '↻ Retrying…';
        syncChip.className = 'sync-chip';
        syncChip.style.cursor = 'default';
        syncChip.style.pointerEvents = 'none';

        // Re-mark the initial 3 months only — other months fetched during navigation stay cached.
        fetchedMonths.add(monthKey(prev.getFullYear(), prev.getMonth()));
        fetchedMonths.add(monthKey(now.getFullYear(),  now.getMonth()));
        fetchedMonths.add(monthKey(next.getFullYear(), next.getMonth()));

        const startStr = formatISO(new Date(prev.getFullYear(), prev.getMonth(), 1));
        const endStr   = formatISO(new Date(next.getFullYear(), next.getMonth() + 1, 0));

        try {
            await fetchOverridesForRange(startStr, endStr);
            syncResolved = true;
            if (syncChip) { syncChip.remove(); syncChip = null; }
            if (!teamView.isTeamViewMode()) renderCalendar();
        } catch (err) {
            console.error('[Firestore] Retry failed:', err);
            if (syncChip) {
                syncChip.textContent = '⚠ Couldn\'t update — tap to retry';
                syncChip.className = 'sync-chip sync-chip-error';
                syncChip.style.cursor = 'pointer';
                syncChip.style.pointerEvents = '';
                syncChip.addEventListener('click', doRetry, { once: true });
            }
        }
    }

    try {
        const startStr = formatISO(new Date(prev.getFullYear(), prev.getMonth(), 1));
        const endStr   = formatISO(new Date(next.getFullYear(), next.getMonth() + 1, 0));

        // Fetch overrides and member settings in parallel
        const [, settingsSnap] = await Promise.all([
            fetchOverridesForRange(startStr, endStr),
            getDocs(collection(db, 'memberSettings')).catch(e => {
                console.warn('[Firestore] memberSettings fetch failed:', e); return null;
            }),
        ]);

        if (settingsSnap) {
            settingsSnap.forEach(doc => {
                memberSettingsCache.set(doc.id, doc.data());
            });
        }

        // Overlay localStorage values set by admin.html on this device.
        // localStorage is same-origin so always readable here, and is
        // the authoritative store until Firestore rules allow memberSettings writes.
        teamMembers.forEach(m => {
            const local = lsGet(`faithCalendar_${m.name}`);
            if (local) {
                const existing = memberSettingsCache.get(m.name) || {};
                memberSettingsCache.set(m.name, { ...existing, faithCalendar: local });
            }
        });

        syncResolved = true;
        if (!teamView.isTeamViewMode()) renderCalendar();

        // Silently remove the chip on success — "Up to date" is noise.
        if (syncChip) { syncChip.remove(); syncChip = null; }
    } catch (err) {
        syncResolved = true;
        console.error('[Firestore] Initial override fetch failed — base roster will be used', err);
    } finally {
        _initialFetchInProgress = false;
        clearTimeout(loadingTimer);
        clearTimeout(timeoutTimer);
        if (syncChip && syncResolved && !syncChip.className.includes('sync-chip-error')) {
            syncChip.remove();
        }
        if (calGrid) calGrid.classList.remove('calendar-fetching');
    }
})();

// If the tab is suspended on iOS during the initial fetch and then restored,
// re-render from whatever cached data we have so the calendar is not blank.
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && _initialFetchInProgress) {
        if (!teamView.isTeamViewMode()) renderCalendar();
    }
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
    header.setAttribute('data-member-name', getCurrentMember().name);
}
stampPrintDate();
window.addEventListener('beforeprint', stampPrintDate);

// Small delay so any in-flight render cycle completes before the page tears down.
registerServiceWorker({
    beforeReload: () => setTimeout(() => window.location.reload(), 500),
    bfcache: true,
});

// ============================================
// HUDDLE VIEWER — initialised via app-huddle-viewer.js
// ============================================
initHuddleViewer();


// ============================================
// PUSH NOTIFICATIONS — silent subscription renewal
// ============================================
// Push notification handling:
//   - If permission already granted: silently renew/migrate subscription (VAPID key rotation check)
//   - If permission not yet asked: show one-off prompt strip on the calendar
(function initNotifications() {
    // notifSupported() folds in the iOS-standalone rule (no push in a plain Safari
    // tab) AND confirms the Notification global exists. It MUST run before any
    // Notification.permission read: in an iOS Safari browser tab before 16.4 the
    // Notification global is undefined, so an unguarded access throws a
    // ReferenceError here and aborts the rest of app.js startup.
    if (!notifSupported()) return;

    // Already granted — getNotifState() handles VAPID rotation and keeps the
    // subscription fresh. Early-return avoids showing the prompt.
    if (Notification.permission === 'granted') {
        getNotifState().catch(err => console.warn('[Notifications] Renewal failed:', err.message));
        return;
    }

    if (Notification.permission === 'denied') return;
    if (lsGet('myb_notif_prompt_done')) return;

    const prompt     = document.getElementById('notifPrompt');
    const enableBtn  = document.getElementById('notifPromptEnable');
    const dismissBtn = document.getElementById('notifPromptDismiss');
    if (!prompt || !enableBtn || !dismissBtn) return;

    prompt.style.display = 'flex';
    function hide() { prompt.style.display = 'none'; }

    enableBtn.addEventListener('click', async () => {
        hide();
        enableNotifications().catch(err => console.warn('[Notifications] Enable failed:', err.message));
    });

    dismissBtn.addEventListener('click', () => {
        hide();
        lsSet('myb_notif_prompt_done', '1');
    });
})();

// ============================================
// CALENDAR HOVER TOOLTIP (desktop only)
// ============================================
// Creates a single floating div and repositions it on mousemove.
// Reads data-tooltip set per cell in buildCalendarContainer().
// Not initialised on touch devices (matchMedia guard).
function initCalendarTooltip() {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const tip = document.createElement('div');
    tip.id = 'calTooltip';
    tip.hidden = true;
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);

    let _tipW = 0, _tipH = 0;
    document.addEventListener('mouseover', e => {
        const cell = e.target.closest('.calendar-day[data-tooltip]');
        if (!cell) { tip.hidden = true; return; }
        tip.textContent = cell.dataset.tooltip;
        tip.hidden = false;
        // Cache dimensions once after content changes — avoids forced reflow on every mousemove.
        const r = tip.getBoundingClientRect();
        _tipW = r.width;
        _tipH = r.height;
    });

    document.addEventListener('mousemove', e => {
        if (tip.hidden) return;
        tip.style.left = Math.min(e.clientX + 14, window.innerWidth  - _tipW - 8) + 'px';
        tip.style.top  = Math.min(e.clientY + 16, window.innerHeight - _tipH - 8) + 'px';
    });
}

// ============================================
// CALENDAR KEYBOARD NAVIGATION
// ============================================
// Arrow keys move focus between day cells (roving tabindex).
// PageUp / PageDown navigate months without touching the mouse.
function initCalendarKeyboard() {
    document.addEventListener('keydown', e => {
        const focused = document.activeElement;
        if (!focused?.classList.contains('calendar-day') || focused.classList.contains('other-month')) return;

        const cells = [...document.querySelectorAll('.calendar-day:not(.other-month)')];
        const idx   = cells.indexOf(focused);
        if (idx === -1) return;

        let next = null;
        switch (e.key) {
            case 'ArrowRight': next = cells[idx + 1]; break;
            case 'ArrowLeft':  next = cells[idx - 1]; break;
            case 'ArrowDown':  next = cells[idx + 7]; break;
            case 'ArrowUp':    next = cells[idx - 7]; break;
            case 'PageDown':
                e.preventDefault();
                document.getElementById('nextMonth')?.click();
                return;
            case 'PageUp':
                e.preventDefault();
                document.getElementById('prevMonth')?.click();
                return;
            default: return;
        }

        if (!next) return;
        e.preventDefault();
        focused.setAttribute('tabindex', '-1');
        next.setAttribute('tabindex', '0');
        next.focus();
    });
}

initCalendarTooltip();
initCalendarKeyboard();

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
