/**
 * app.js — Calendar UI for index.html.
 *
 * Owns: month carousel, swipe gestures, shift cell render, override cache for
 *   the calendar view, Team Week View, notification wiring, sync chip.
 * Does NOT own: roster data (roster-data.js), Firebase init (firebase-client.js).
 * Edit here for: calendar display, swipe behaviour, override cache.
 * Do not edit here for: pay maths, admin features, override entry.
 */

import { CONFIG, teamMembers, DAY_NAMES, getALEntitlement, RAMADAN_STARTS, EID_FITR_DATES, EID_ADHA_DATES, ISLAMIC_NEW_YEAR_DATES, MAWLID_DATES, HOLI_DATES, NAVRATRI_DATES, DUSSEHRA_DATES, DIWALI_DATES, RAKSHA_BANDHAN_DATES, CHINESE_NEW_YEAR_DATES, LANTERN_FESTIVAL_DATES, QINGMING_DATES, DRAGON_BOAT_DATES, MID_AUTUMN_DATES, JAMAICAN_ASH_WEDNESDAY_DATES, JAMAICAN_LABOUR_DAY_DATES, JAMAICAN_EMANCIPATION_DATES, JAMAICAN_INDEPENDENCE_DATES, JAMAICAN_HEROES_DAY_DATES, isSameDay, getBankHolidays, isBankHoliday, isChristmasDay, isEasterSunday, getPaydaysAndCutoffs, isPayday, isCutoffDate, CONGOLESE_MARTYRS_DATES, CONGOLESE_LIBERATION_DATES, CONGOLESE_HEROES_DATES, CONGOLESE_INDEPENDENCE_DATES, PORTUGUESE_CARNIVAL_DATES, PORTUGUESE_FREEDOM_DATES, PORTUGUESE_LABOUR_DATES, PORTUGUESE_PORTUGAL_DAY_DATES, PORTUGUESE_CORPUS_CHRISTI_DATES, PORTUGUESE_ASSUMPTION_DATES, PORTUGUESE_REPUBLIC_DATES, PORTUGUESE_RESTORATION_DATES, PORTUGUESE_IMMACULATE_DATES, isEarlyShift, isNightShift, getShiftClass, getShiftBadge, getWeekNumberForDate, getRosterForMember, getBaseShift, escapeHtml, formatISO, isSunday, getFaithBadge, resolveFaithCalendar, CALENDAR_NAMES, SWIPE_THRESHOLD, SWIPE_VELOCITY } from './roster-data.js';
import { db, collection, query, where, getDocs, subscribeToLatestHuddle, savePushSubscription } from './firebase-client.js';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.es.mjs';
import { lsGet, lsSet, lsDel } from './ls.js';
import { initTeamView } from './app-team-view.js';
import { isBeforeMemberStart, shouldReplaceOverride } from './app-override-utils.js';
import { initNavPanel } from './nav-panel.js';

// ============================================
// CEA ROSTER CALENDAR
// ============================================
// Performance Optimizations:
// - Member fetched once per render (not 31+ times)
// - Bank holidays computed on demand from roster-data.js
// - Pure functions for predictable behavior
// - CSS variables for instant theme changes
// ============================================

// CONFIG.APP_VERSION is now set in roster-data.js from the exported APP_VERSION constant.
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

// Tracks the currently-displayed member name (for the print header attribute).
// rosterOverridesCache is keyed "memberName|date" and stores all members' data,
// so it does NOT need to be cleared when the selected member changes.
let _cachedMemberName = null;

// Set when localStorage held a member name that's no longer in the roster.
// renderCalendar() shows a brief info banner once then clears this flag.
let _staleMemberName = null;

// Guards against ensureOverridesCached() triggering a competing fetch while
// the initial 3-month load is already in flight. Set true before the IIFE
// await, cleared in its finally block.
let _initialFetchInProgress = false;

// Body scroll lock for lightboxes — iOS Safari ignores overflow:hidden on body,
// so we pin position:fixed at the current scroll offset and restore on close.
let _lbScrollY = 0;
function lockBodyScroll() {
    _lbScrollY = window.scrollY;
    document.body.style.setProperty('--lb-scroll-y', `-${_lbScrollY}px`);
    document.body.classList.add('lb-open');
}
function unlockBodyScroll() {
    document.body.classList.remove('lb-open');
    document.body.style.removeProperty('--lb-scroll-y');
    window.scrollTo(0, _lbScrollY);
}

// Android Back button — overlay/Team View support.
// Opening any overlay pushes a shallow history entry; Back dismisses it
// instead of navigating away. Closing via a button clears the entry via
// history.back(), which fires popstate but the flag is already false by then.
let _overlayHistoryPushed = false;
let _backHandler = null;
function _pushOverlayState(closeHandler) {
    if (!_overlayHistoryPushed) {
        history.pushState({ mybOverlay: true }, '');
        _overlayHistoryPushed = true;
    }
    _backHandler = closeHandler;
}
function _clearOverlayHistory() {
    if (_overlayHistoryPushed) {
        _overlayHistoryPushed = false;
        _backHandler = null;
        history.back();
    }
}
window.addEventListener('popstate', () => {
    if (!_overlayHistoryPushed) return;
    _overlayHistoryPushed = false;
    const fn = _backHandler;
    _backHandler = null;
    fn?.();
});

// ============================================
// BANK HOLIDAYS / PAYDAY / DATE UTILITIES
// ============================================
// isSameDay, getBankHolidays, isBankHoliday, isChristmasDay, isEasterSunday,
// getPaydaysAndCutoffs, isPayday, isCutoffDate — all imported from roster-data.js.

const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                   'July', 'August', 'September', 'October', 'November', 'December'];

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
// HUDDLE BUTTON STATE
// #huddleBtn lives in the static <header> and is never re-created.
// Module-level state lets applyHuddleButtonState() update it any time
// the Firestore subscription fires, regardless of render order.
// ============================================
let _huddleData  = null;
let _huddleState = 'loading'; // 'loading' | 'ready' | 'none' | 'error'

function applyHuddleButtonState() {
    const btn = document.getElementById('huddleBtn');
    if (!btn) return;
    if (_huddleState === 'loading') {
        btn.disabled = true;
    } else if (_huddleState === 'none') {
        btn.disabled = true;
        btn.title = 'No briefing uploaded today';
        btn.setAttribute('aria-label', 'Huddle — no briefing uploaded yet');
    } else if (_huddleState === 'error') {
        btn.disabled = true;
        btn.title = "Couldn't load the briefing";
        btn.setAttribute('aria-label', "Huddle — couldn't load, check your connection");
    } else {
        btn.disabled = false;
        btn.title = "Open today's Huddle";
        btn.setAttribute('aria-label', "Open today's Huddle");
    }
}

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
// Dismissed permanently on the first month navigation (swipe or button).
(function initSwipeHint() {
    if (lsGet('myb_swipe_hint_seen')) return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const hint = document.getElementById('swipeHint');
    if (!hint) return;
    hint.style.display = '';
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
    try {
        const sess = JSON.parse(lsGet('myb_admin_session') || 'null');
        if (sess?.name) {
            const idx = teamMembers.findIndex(m => m.name === sess.name && !m.hidden);
            if (idx !== -1) {
                saveSelectedMember(idx);
                return idx;
            }
        }
    } catch (_) {}
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

// getWeekNumberForDate, isEarlyShift, isNightShift, getShiftClass, getShiftBadge — imported from roster-data.js

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
        <div class="month-year" role="button" tabindex="0" aria-label="Jump to month — currently ${monthNames[month]} ${year}">${monthNames[month]} ${year}</div>
        <div class="week-info">
            ${weekDisplay ? `<span class="week-info-text">${weekDisplay}</span>` : ''}
        </div>
    `;
}

// escapeHtml — imported from roster-data.js

// Navigate to the pay calculator for a given payday ISO date string.
// Requires a valid session; otherwise redirects to admin login with a return hint.
function navigateToPaycalc(paydayStr) {
    try {
        const sess = JSON.parse(lsGet('myb_admin_session') || 'null');
        if (sess && sess.name) {
            window.location.href = `./paycalc.html?payday=${paydayStr}`;
        } else {
            window.location.href = './admin.html?redirect=paycalc';
        }
    } catch { window.location.href = './admin.html?redirect=paycalc'; }
}

// Helper: Create day cell HTML (pure function)
// isWorkedDay — pre-calculated by caller (shift !== RD/SPARE/OFF) to avoid duplication.
// permanentShift ('early'|'late'|undefined) — overrides badge on worked days and suppresses time.
// rdwTime — actual shift time for RDW overrides (e.g. '08:00-16:30'), since shift='RDW' sentinel.
// ============================================
// FAITH CALENDAR HELPERS
// ============================================

// resolveFaithCalendar and CALENDAR_NAMES are imported from roster-data.js.

// Returns { icon, label } for the faith marker on this date, or null if none.
// Delegates the lookup to getFaithBadge() in roster-data.js — the single source
// of truth for cultural calendar markers.
function getFaithMarker(dateStr, memberName) {
    const faithCalendar = resolveFaithCalendar(memberSettingsCache.get(memberName));
    return getFaithBadge(dateStr, faithCalendar);
}

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
    const roster = getRosterForMember(member);

    const today = getToday();
    const calendarContainer = document.createElement('div');
    calendarContainer.className = 'calendar-container';

    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
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
            const [y, mo, d] = cutoffIso.split('-').map(Number);
            const paydayDate = new Date(y, mo - 1, d);
            const _daysToPayday = ((CONFIG.FIRST_PAYDAY.getDay() - 6 + 7) % 7) || 7;
            paydayDate.setDate(paydayDate.getDate() + _daysToPayday);
            navigateToPaycalc(formatISO(paydayDate));
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
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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
                } else if (override.type === 'sick' && (shift === 'RD' || shift === 'OFF')) {
                    // Sick override on a base rest day — suppress it. Absence only applies
                    // to days the member was scheduled to work.
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
            : member.permanentShift === 'late'  ? 'Late shift'
            : member.permanentShift === 'early' ? 'Early shift'
            : isEarlyShift(shift) ? `Early shift ${shift}`
            : `Late shift ${shift}`;
        const faithMarker = getFaithMarker(dateStr, member.name);

        const extras = [
            isSameDay(currentDate, today) ? 'Today' : '',
            isBankHoliday(currentDate) ? 'Bank holiday' : '',
            isChristmasDay(currentDate) ? 'Christmas Day' : '',
            isEasterSunday(currentDate) ? 'Easter Sunday' : '',
            isPayday(currentDate) ? 'Payday' : '',
            isCutoffDate(currentDate) ? 'Cut-off date' : '',
            faithMarker ? faithMarker.label : '',
        ].filter(Boolean).join(', ');
        dayCell.setAttribute('aria-label',
            `${fullDayNames[currentDate.getDay()]} ${currentDate.getDate()} ${monthNames[month]} ${year} — ${shiftLabel}${extras ? ' — ' + extras : ''}`
        );
        dayCell.setAttribute('tabindex', '-1');
        const ttShift = shiftLabel + (shift === 'RDW' && rdwTime ? ` ${rdwTime}` : '');
        const ttParts = [ttShift];
        if (extras) ttParts.push(extras);
        if (overrideNote) ttParts.push(`"${overrideNote}"`);
        dayCell.dataset.tooltip = ttParts.join(' · ');

        if (isSameDay(currentDate, today)) dayCell.classList.add('today');
        if (isBankHoliday(currentDate))    dayCell.classList.add('bank-holiday');
        if (isChristmasDay(currentDate))   dayCell.classList.add('christmas-day');
        if (isEasterSunday(currentDate))   dayCell.classList.add('easter-day');
        if (isPayday(currentDate)) {
            dayCell.classList.add('payday');
            dayCell.style.cursor = 'pointer';
            dayCell.dataset.paydayIso = dateStr;
        }
        if (isCutoffDate(currentDate)) {
            dayCell.classList.add('cutoff');
            dayCell.style.cursor = 'pointer';
            dayCell.dataset.cutoffIso = dateStr;
        }

        dayCell.innerHTML = createDayCell(currentDate, shift, member.permanentShift, isWorkedDay, rdwTime, faithMarker);
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
    const closeBtn     = document.getElementById('alLightboxClose');
    const takenEl      = document.getElementById('alLbTaken');
    const bookedEl     = document.getElementById('alLbBooked');
    const remEl        = document.getElementById('alLbRemaining');
    const entEl        = document.getElementById('alLbEntitlement');
    const yearEl       = document.getElementById('alLbYear');
    const breakdownEl  = document.getElementById('alLbBreakdown');

    let _alFocusReturn = null;
    function openALLightbox() {
        _alFocusReturn = document.activeElement;
        lb.classList.add('visible');
        requestAnimationFrame(() => lb.classList.add('open'));
        lockBodyScroll();
        _pushOverlayState(closeALLightbox);
        document.addEventListener('keydown', onKey);
        loadALStats();
    }

    function closeALLightbox() {
        _clearOverlayHistory();
        lb.classList.remove('open');
        const _alUnlockTimer = setTimeout(() => {
            lb.classList.remove('visible');
            unlockBodyScroll();
        }, 500);
        lb.addEventListener('transitionend', () => {
            clearTimeout(_alUnlockTimer);
            lb.classList.remove('visible');
            unlockBodyScroll();
        }, { once: true });
        document.removeEventListener('keydown', onKey);
        _alFocusReturn?.focus();
        _alFocusReturn = null;
    }

    function onKey(e) { if (e.key === 'Escape') closeALLightbox(); }

    async function loadALStats() {
        const member  = getCurrentMember();
        const year    = currentDisplayYear;
        const yearStr = String(year);

        yearEl.textContent  = yearStr;
        takenEl.textContent = '…';
        bookedEl.textContent = '…';
        remEl.textContent   = '…';

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
            const snap = await getDocs(query(
                collection(db, 'overrides'),
                where('date', '>=', `${yearStr}-01-01`),
                where('date', '<=', `${yearStr}-12-31`)
            ));
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
        }
    }

    window.closeALLightbox = closeALLightbox;

    document.getElementById('alBtn').addEventListener('click', openALLightbox);
    closeBtn.addEventListener('click', closeALLightbox);
    lb.addEventListener('click', e => { if (e.target === lb) closeALLightbox(); });
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

        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const ov = !isBeforeMemberStart(member, date) ? rosterOverridesCache.get(`${member.name}|${dateStr}`) : null;
        if (ov && !(ov.type === 'sick' && (shift === 'RD' || shift === 'OFF'))) {
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
// Legend elements are static in the HTML; cache references on first call to skip
// ~40 getElementById lookups per navigation. Stored in a module-level Map populated
// lazily so it survives across renders.
const _legendElCache = new Map();
function _legendEl(id) {
    let el = _legendElCache.get(id);
    if (el === undefined) { el = document.getElementById(id); _legendElCache.set(id, el); }
    return el;
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
        const holidays = getBankHolidays(currentDisplayYear);
        const easterMonday = holidays.find(h => h.getDay() === 1 && h.getMonth() >= 2 && h.getMonth() <= 3);
        let easterSunMonth = -1;
        if (easterMonday) {
            const easterSun = new Date(easterMonday);
            easterSun.setDate(easterMonday.getDate() - 1);
            easterSunMonth = easterSun.getMonth();
        }
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
    for (const [id, [dateSet, cal]] of Object.entries(legendIds)) {
        const el = _legendEl(id);
        if (el) el.style.display = faithInMonth(dateSet, cal) ? '' : 'none';
    }

    // Show/hide the faith row container itself — visible only when at least one item inside it is shown.
    const faithRow = _legendEl('legend-faith-row');
    if (faithRow) {
        const anyFaithVisible = [...faithRow.querySelectorAll('.legend-item')]
            .some(el => el.style.display !== 'none');
        faithRow.style.display = anyFaithVisible ? '' : 'none';
    }

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
        // Re-check faith row visibility now that CNY item state is final.
        if (faithRow) {
            const anyFaithVisible = [...faithRow.querySelectorAll('.legend-item')]
                .some(el => el.style.display !== 'none');
            faithRow.style.display = anyFaithVisible ? '' : 'none';
        }
    }
}

// renderCalendar — used for all non-swipe navigation (buttons, keyboard, today).
// Sets data-member-name for print header then builds and inserts fresh container.
function renderCalendar() {
    try {
        const member = getCurrentMember();

        _cachedMemberName = member.name;

        // If the previously-selected member was removed from the roster, show a one-time notice.
        if (_staleMemberName) {
            const stale = _staleMemberName;
            _staleMemberName = null;
            const banner = document.getElementById('errorBanner');
            if (banner) {
                banner.textContent = `${stale} is no longer in the roster — now showing ${member.name}'s calendar.`;
                banner.classList.add('visible');
                setTimeout(() => banner.classList.remove('visible'), 5000);
            }
        }

        // Update legend for current member and month (Night, 🎄, 🥚 are conditional)
        updateLegend();

        // Set team member name on header for printing
        const headerElement = document.querySelector('.header');
        if (headerElement) headerElement.setAttribute('data-member-name', member.name);

        const calendarDisplay = document.getElementById('calendarDisplay');
        if (!calendarDisplay) throw new Error('Calendar display element not found');

        document.title = `MYB Roster — ${monthNames[currentDisplayMonth]} ${currentDisplayYear}`;

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

        applyHuddleButtonState();

    } catch (error) {
        console.error('Error rendering calendar:', error);
        const calendarDisplay = document.getElementById('calendarDisplay');
        if (calendarDisplay) {
            const errDiv = document.createElement('div');
            errDiv.className = 'calendar-error';
            errDiv.innerHTML = '<h2>⚠️ Couldn\'t load the schedule</h2><p>Close the app and open it again. If it keeps happening, check your connection or contact the admin team.</p>';
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
    updateFaithHint();
    // Close AL lightbox if open — data would be stale for the new member
    if (typeof closeALLightbox === 'function') closeALLightbox();
});

function updateFaithHint() {
    const member = getCurrentMember();
    const hint = document.getElementById('faithHint');
    if (!hint) return;
    const cal = member ? resolveFaithCalendar(memberSettingsCache?.get(member.name)) : 'none';
    if (cal !== 'none') {
        hint.textContent = (CALENDAR_NAMES[cal] || 'Cultural') + ' calendar markers active';
        hint.style.display = '';
    } else {
        hint.style.display = 'none';
    }
}

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
        announcer.textContent = `${monthNames[currentDisplayMonth]} ${currentDisplayYear}`;
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
    try {
        const session = JSON.parse(lsGet('myb_admin_session') || 'null');
        if (session && session.name) {
            const m = String(currentDisplayMonth + 1).padStart(2, '0');
            window.location.href = `./paycalc.html?month=${currentDisplayYear}-${m}`;
        } else {
            window.location.href = './admin.html?redirect=paycalc';
        }
    } catch {
        window.location.href = './admin.html?redirect=paycalc';
    }
});

// lightboxPrintBtn handler lives inside the about-lightbox IIFE below,
// where closeLightbox() is in scope — see initAboutLightbox.

// Pay period strip — shows the current pay period dates + link to the pay calculator.
// Only shown when a session exists (same condition as the pay button navigation).
(function initPayPeriodStrip() {
    const strip = document.getElementById('payPeriodStrip');
    if (!strip) return;
    let session;
    try {
        session = JSON.parse(lsGet('myb_admin_session') || 'null');
    } catch { session = null; }
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
    const content = document.getElementById('teamInfoContent');
    if (!lb) return;

    let _trigger = null; // element that opened the lightbox — restored on close

    function openTeamInfo() {
        _trigger = document.activeElement;
        lb.classList.add('visible');
        requestAnimationFrame(() => {
            lb.classList.add('open');
            document.getElementById('teamInfoClose')?.focus();
        });
        lockBodyScroll();
        _pushOverlayState(closeTeamInfo);
    }
    function closeTeamInfo() {
        _clearOverlayHistory();
        lb.classList.remove('open');
        const _teamInfoUnlockTimer = setTimeout(() => {
            lb.classList.remove('visible');
            unlockBodyScroll();
            if (_trigger && typeof _trigger.focus === 'function') {
                _trigger.focus();
                _trigger = null;
            }
        }, 500);
        lb.addEventListener('transitionend', () => {
            clearTimeout(_teamInfoUnlockTimer);
            lb.classList.remove('visible');
            unlockBodyScroll();
            if (_trigger && typeof _trigger.focus === 'function') {
                _trigger.focus();
                _trigger = null;
            }
        }, { once: true });
    }

    document.getElementById('teamInfoClose')?.addEventListener('click', closeTeamInfo);
    lb.addEventListener('click', e => { if (e.target === lb) closeTeamInfo(); });

    document.addEventListener('keydown', e => {
        if (!lb.classList.contains('visible')) return;
        if (e.key === 'Escape') { closeTeamInfo(); return; }
        // Focus trap — cycle through all focusable elements inside the lightbox
        if (e.key === 'Tab') {
            const focusable = [...lb.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            )].filter(el => !el.disabled);
            if (focusable.length === 0) { e.preventDefault(); return; }
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        }
    });

    // Event delegation — #teamHelpBtn is re-created on every renderTeamView() call.
    document.addEventListener('click', e => {
        if (e.target.closest('#teamHelpBtn')) openTeamInfo();
    });
})();

// Modules are always deferred — the DOM is fully parsed before this code runs.
// No DOMContentLoaded wrapper needed; initialize directly.
try {
        // validateRosterPatterns() already ran at module load (roster-data.js line 1242).
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

        updateFaithHint();

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
                    document.title = `MYB Roster — ${monthNames[currentDisplayMonth]} ${currentDisplayYear}`;
                    updateLegend();
                    updateFaithHint();

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
        // ============================================
        // Shows app name, version, and live SW update status.
        // Update detection works by watching the SW registration:
        //   - registration.waiting  → a new SW has installed and is waiting
        //   - updatefound event     → a new SW has started installing
        // When a waiting SW is found, the "Update now" button appears.
        // Pressing it sends SKIP_WAITING to the waiting SW, which activates
        // it immediately. The page then reloads to run the new version.
        (function() {
            const lightbox     = document.getElementById('iconLightbox');
            const titleIcon    = document.querySelector('.title-icon');
            const versionEl    = document.getElementById('lightboxVersion');
            const statusEl     = document.getElementById('lightboxUpdateStatus');
            const closeBtn     = document.getElementById('iconLightboxClose');
            const contentCard  = document.getElementById('iconLightboxContent');
            const bugLink      = document.getElementById('bugReportLink');

            if (!lightbox || !titleIcon) return;

            // Populate version from CONFIG
            if (versionEl) versionEl.textContent = CONFIG.APP_VERSION;

            // ---- Update status ----
            function checkUpdateStatus() {
                if (statusEl) { statusEl.textContent = '✓ Up to date'; statusEl.className = 'lightbox-status up-to-date'; }
            }

            // Auto-update: skip waiting immediately, reload silently on controllerchange.
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(registration => {
                    function activate(w) { w.postMessage({ type: 'SKIP_WAITING' }); }

                    if (registration.waiting) activate(registration.waiting);

                    registration.addEventListener('updatefound', () => {
                        const nw = registration.installing;
                        if (!nw) return;
                        nw.addEventListener('statechange', () => {
                            if (nw.state === 'installed' && navigator.serviceWorker.controller) activate(nw);
                        });
                    });

                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        // Small delay so any in-flight render cycle completes before
                        // the page tears down — prevents overrides flashing then disappearing
                        // if the SW activates at the exact moment overrides have just rendered.
                        setTimeout(() => window.location.reload(), 500);
                    }, { once: true });

                    let swUpdateInterval = setInterval(() => registration.update(), 60 * 60 * 1000);
                    document.addEventListener('visibilitychange', () => {
                        if (document.hidden) {
                            clearInterval(swUpdateInterval);
                        } else {
                            clearInterval(swUpdateInterval);
                            registration.update();
                            swUpdateInterval = setInterval(() => registration.update(), 60 * 60 * 1000);
                        }
                    });
                    // iOS does not always fire visibilitychange when the tab is suspended/restored.
                    // pagehide/pageshow are more reliable triggers for the same lifecycle.
                    window.addEventListener('pagehide', () => clearInterval(swUpdateInterval));
                    window.addEventListener('pageshow', () => {
                        clearInterval(swUpdateInterval);
                        swUpdateInterval = setInterval(() => registration.update(), 60 * 60 * 1000);
                    });
                });
            }

            // ---- Open / close ----

            // Elements that swap depending on whether the calendar or team view is active
            const calendarTips = document.getElementById('calendarTips');
            const teamViewTips  = document.getElementById('teamViewTips');
            const teamViewBadge = document.getElementById('teamViewBadge');
            const printBtn      = document.getElementById('lightboxPrintBtn');
            const printHint     = document.getElementById('lightboxPrintHint');

            let _lbFocusReturn = null;
            function openLightbox() {
                _lbFocusReturn = document.activeElement;
                // Swap content based on current view mode
                const inTeam = teamView.isTeamViewMode();
                if (calendarTips)  calendarTips.hidden = inTeam;
                if (teamViewTips)  teamViewTips.hidden  = !inTeam;
                if (teamViewBadge) teamViewBadge.hidden = !inTeam;
                if (printBtn)  printBtn.textContent  = inTeam ? '🖨️ Print this week\'s roster' : '🖨️ Print this calendar';
                if (printHint) printHint.textContent = inTeam ? 'Use landscape orientation for best results' : 'Prints the current month\'s calendar';

                checkUpdateStatus(); // Refresh status every time it opens
                if (bugLink) {
                    const member   = getCurrentMember();
                    const name     = member ? member.name : 'Not selected';
                    const date     = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                    const ua       = navigator.userAgent;
                    const body     = `Please describe the bug:\n\n\n\n— Auto-filled —\nApp: MYB Roster v${CONFIG.APP_VERSION}\nUser: ${name}\nDate: ${date}\nBrowser: ${ua}`;
                    bugLink.href   = `mailto:${CONFIG.SUPPORT_EMAIL}?subject=${encodeURIComponent(`Bug Report — MYB Roster v${CONFIG.APP_VERSION}`)}&body=${encodeURIComponent(body)}`;
                }
                lightbox.classList.add('visible');
                requestAnimationFrame(() => lightbox.classList.add('open'));
                lockBodyScroll();
                _pushOverlayState(closeLightbox);
                document.addEventListener('keydown', onKeyDown);
            }

            function closeLightbox() {
                _clearOverlayHistory();
                lightbox.classList.remove('open');
                const _aboutUnlockTimer = setTimeout(() => {
                    lightbox.classList.remove('visible');
                    unlockBodyScroll();
                }, 500);
                lightbox.addEventListener('transitionend', () => {
                    clearTimeout(_aboutUnlockTimer);
                    lightbox.classList.remove('visible');
                    unlockBodyScroll();
                }, { once: true });
                document.removeEventListener('keydown', onKeyDown);
                _lbFocusReturn?.focus();
                _lbFocusReturn = null;
            }

            function onKeyDown(e) {
                if (e.key === 'Escape') closeLightbox();
            }

            titleIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                openLightbox(); // Content adjusts based on teamViewMode inside openLightbox()
            });

            // Tap the dark overlay or ✕ to close
            lightbox.addEventListener('click', closeLightbox);

            // Tapping the content card itself does NOT close (prevents accidental close)
            if (contentCard) contentCard.addEventListener('click', e => e.stopPropagation());
            if (closeBtn)    closeBtn.addEventListener('click',    closeLightbox);
            // Bug link opens mail app — stopPropagation prevents the overlay click handler closing the lightbox
            if (bugLink)     bugLink.addEventListener('click',     e => e.stopPropagation());

            // Print — close the lightbox first so it doesn't appear in the print output.
            // Wait for the exit transition before calling window.print(). Both the
            // transitionend path and the 550ms fallback guard against double invocation.
            // Team view uses landscape; calendar uses the default portrait @page in the stylesheet.
            if (printBtn) printBtn.addEventListener('click', () => {
                const isTeam = teamView.isTeamViewMode();
                closeLightbox();
                let printed = false;
                const doPrint = () => {
                    if (!printed) {
                        printed = true;
                        if (isTeam) {
                            const ls = document.createElement('style');
                            ls.textContent = '@page { size: A4 landscape; margin: 1cm; }';
                            document.head.appendChild(ls);
                            window.print();
                            window.addEventListener('afterprint', () => ls.remove(), { once: true });
                        } else {
                            window.print();
                        }
                    }
                };
                lightbox.addEventListener('transitionend', doPrint, { once: true });
                setTimeout(() => {
                    lightbox.removeEventListener('transitionend', doPrint);
                    doPrint();
                }, 550);
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
            monthNames.forEach((name, i) => {
                const opt = document.createElement('option');
                opt.value = i; opt.textContent = name;
                selMonth.appendChild(opt);
            });

            function openPicker() {
                selMonth.value = currentDisplayMonth;
                selYear.value  = currentDisplayYear;
                overlay.classList.add('visible');
                requestAnimationFrame(() => overlay.classList.add('open'));
                lockBodyScroll();
                _pushOverlayState(closePicker);
            }

            function closePicker() {
                _clearOverlayHistory();
                overlay.classList.remove('open');
                const _pickerUnlockTimer = setTimeout(() => {
                    overlay.classList.remove('visible');
                    unlockBodyScroll();
                }, 500);
                overlay.addEventListener('transitionend', () => {
                    clearTimeout(_pickerUnlockTimer);
                    overlay.classList.remove('visible');
                    unlockBodyScroll();
                }, { once: true });
            }

            // Delegated click: any .month-year element (rebuilt on each render)
            document.getElementById('calendarDisplay').addEventListener('click', e => {
                if (e.target.closest('.month-year')) openPicker();
            });
            document.getElementById('calendarDisplay').addEventListener('keydown', e => {
                if (e.target.closest('.month-year') && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault(); openPicker();
                }
            });

            btnConfirm.addEventListener('click', () => {
                currentDisplayMonth = parseInt(selMonth.value, 10);
                currentDisplayYear  = parseInt(selYear.value, 10);
                closePicker();
                renderCalendar();
                announceMonthChange();
            });

            btnCancel.addEventListener('click', closePicker);
            overlay.addEventListener('click', closePicker);
            card.addEventListener('click', e => e.stopPropagation());

            document.addEventListener('keydown', e => {
                if (e.key === 'Escape' && overlay.classList.contains('open')) closePicker();
            });
        })();

        // ============================================
        // KEYBOARD SHORTCUTS (Desktop)
        // ============================================
        document.addEventListener('keydown', (e) => {
            // Don't fire if user is typing in an input
            if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
            if (swipeCooldown) return; // Don't interrupt a swipe animation
            if (teamView.isTeamViewMode()) {
                if (e.key === 'ArrowLeft')  document.getElementById('tvPrevWeek')?.click();
                if (e.key === 'ArrowRight') document.getElementById('tvNextWeek')?.click();
                return;
            }
            if (e.key === 'ArrowLeft')  { changeMonth(-1); renderCalendar(); announceMonthChange(); }
            if (e.key === 'ArrowRight') { changeMonth(1);  renderCalendar(); announceMonthChange(); }
            if (e.key === 't' || e.key === 'T') { const now = getToday(); currentDisplayMonth = now.getMonth(); currentDisplayYear = now.getFullYear(); renderCalendar(); pulseToday(); announceMonthChange(); }
            if (e.key === 'p' || e.key === 'P') {
                if (!document.getElementById('iconLightbox')?.classList.contains('visible') &&
                    !document.getElementById('huddleViewer')?.classList.contains('open')) window.print();
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
 * Format a Date as 'YYYY-MM-DD' for Firestore range queries.
 * @param {Date} date
 * @returns {string}
 */
function formatDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

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
        const startStr = formatDateStr(new Date(year, month, 1));
        const endStr   = formatDateStr(new Date(year, month + 1, 0));
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

        // Re-mark months so ensureOverridesCached won't double-fetch while this is in flight.
        fetchedMonths.clear();
        fetchedMonths.add(monthKey(prev.getFullYear(), prev.getMonth()));
        fetchedMonths.add(monthKey(now.getFullYear(),  now.getMonth()));
        fetchedMonths.add(monthKey(next.getFullYear(), next.getMonth()));

        const startStr = formatDateStr(new Date(prev.getFullYear(), prev.getMonth(), 1));
        const endStr   = formatDateStr(new Date(next.getFullYear(), next.getMonth() + 1, 0));

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
        const startStr = formatDateStr(new Date(prev.getFullYear(), prev.getMonth(), 1));
        const endStr   = formatDateStr(new Date(next.getFullYear(), next.getMonth() + 1, 0));

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
        updateFaithHint();

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

// Register service worker for PWA functionality
// ============================================
// PRINT HEADER — stamp timestamp before printing
// ============================================
// iOS Safari does not fire beforeprint when AirPrint is invoked, so we also stamp
// eagerly on load. The beforeprint handler is kept for desktop browsers, where it
// updates the timestamp to the moment of printing.
function stampPrintDate() {
    const now    = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    const header = document.querySelector('.header');
    if (header) header.setAttribute('data-print-date', `Printed: ${now}`);
}
stampPrintDate();
window.addEventListener('beforeprint', stampPrintDate);

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// ============================================
// TODAY'S HUDDLE BANNER
// ============================================
// HUDDLE VIEWER — in-app full-screen panel for PDF and DOCX
// ============================================
// PDF: opens in a new tab (Chrome renders natively).
// DOCX: htmlContent is pre-converted at upload time (by mammoth in the Cloud
//   Function or the admin upload page) and stored in the Firestore document.
//   The viewer just displays that HTML — no CORS fetch, no CDN dependency.

/**
 * Sanitise HTML from a DOCX conversion before rendering.
 * Uses DOMPurify with a strict allowlist — no attributes, no SVG, no script vectors.
 * @param {string} html
 * @returns {string}
 */
function sanitiseHtml(html) {
    return DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','b','i','br','table','thead','tbody','tr','th','td'],
        ALLOWED_ATTR: [],
    });
}

// ============================================
// HUDDLE BUTTON — event delegation + module-state
// #huddleBtn is in the static <header> and persists across renders.
// Event delegation on document is used for consistency with other overlays.
// _huddleData / _huddleState are set once at startup and survive page lifetime.
// ============================================
(function initHuddleViewer() {
    const viewer = document.getElementById('huddleViewer');
    const body   = document.getElementById('huddleViewerBody');
    const close  = document.getElementById('huddleViewerClose');

    // Detect notification tap — SW appends #huddle to the URL so we know to
    // auto-open the viewer once the Firestore subscription delivers data.
    // _autoOpen is mutable so the hashchange handler below can set it when the
    // page was already open and the SW navigated it to #huddle (vs. a fresh load).
    let _autoOpen = window.location.hash === '#huddle';
    if (_autoOpen) history.replaceState(null, '', window.location.pathname);
    let _autoOpened = false;

    let _viewerFocusReturn = null;
    function openViewer() {
        _viewerFocusReturn = document.activeElement;
        viewer.classList.add('visible');
        requestAnimationFrame(() => viewer.classList.add('open'));
        lockBodyScroll();
        _pushOverlayState(closeViewer);
        document.addEventListener('keydown', onKey);
    }
    function closeViewer() {
        _clearOverlayHistory();
        viewer.classList.remove('open');
        const _huddleUnlockTimer = setTimeout(() => {
            viewer.classList.remove('visible');
            unlockBodyScroll();
        }, 500);
        viewer.addEventListener('transitionend', () => {
            clearTimeout(_huddleUnlockTimer);
            viewer.classList.remove('visible');
            unlockBodyScroll();
        }, { once: true });
        document.removeEventListener('keydown', onKey);
        _viewerFocusReturn?.focus();
        _viewerFocusReturn = null;
    }
    function onKey(e) { if (e.key === 'Escape') closeViewer(); }

    if (close) {
        close.addEventListener('click', closeViewer);
    }

    // Event delegation — fires on every document click; only acts on #huddleBtn.
    document.addEventListener('click', e => {
        if (!e.target.closest('#huddleBtn')) return;
        if (_huddleState !== 'ready' || !_huddleData) return;
        const huddle = _huddleData;
        try {
            if (huddle.htmlContent) {
                body.innerHTML = sanitiseHtml(huddle.htmlContent);
                openViewer();
                close.focus();
            } else if (huddle.fileType === 'pdf' || !huddle.fileType) {
                // Open the PDF directly — Android Chrome's built-in PDF viewer
                // handles this natively and is far faster than routing through
                // Google Docs Viewer (which fetches, renders, and re-serves the file).
                window.open(huddle.storageUrl, '_blank', 'noopener');
            } else {
                body.innerHTML = '<p style="color:#c62828;font-weight:600">This Huddle could not be previewed — please re-upload the Word file from the Admin page.</p>';
                openViewer();
                close.focus();
            }
        } catch (err) {
            console.error('[Huddle] Viewer error:', err);
            body.innerHTML = '<p style="color:#c62828;font-weight:600">Could not display this Huddle — please try again.</p>';
            openViewer();
            close.focus();
        }
    });

    function _triggerAutoOpen(huddle) {
        _autoOpened = true;
        try {
            if (huddle.htmlContent) {
                body.innerHTML = sanitiseHtml(huddle.htmlContent);
                openViewer();
                close.focus();
            } else if (huddle.fileType === 'pdf' || !huddle.fileType) {
                // A notification tap carries no in-page user activation, so calling
                // window.open() directly here would be blocked as a pop-up — and
                // navigating the standalone window itself (location.href) to the
                // cross-origin PDF knocks the app out of standalone mode (it comes
                // back wrapped in browser chrome). Instead, open the viewer with an
                // explicit button: tapping it IS a real gesture, so the PDF opens as
                // a separate Custom Tab over the intact standalone app, and Back
                // returns to the clean app. (The manual #huddleBtn handler can call
                // window.open directly — that click is already a real gesture.)
                body.innerHTML = '<div class="huddle-open-prompt">'
                    + '<p>Today’s Huddle is ready.</p>'
                    + '<button type="button" id="huddleOpenFileBtn" class="huddle-open-btn">📄 Open Huddle</button>'
                    + '</div>';
                openViewer();
                const openBtn = document.getElementById('huddleOpenFileBtn');
                openBtn?.addEventListener('click', () => window.open(huddle.storageUrl, '_blank', 'noopener'));
                openBtn?.focus();
            }
        } catch (err) {
            console.error('[Huddle] Auto-open error:', err);
        }
    }

    // When the page is already open and the SW navigates it to #huddle (hash-only
    // navigation, no page reload), the IIFE has already run with _autoOpen=false.
    // The hashchange event fires instead — set _autoOpen and open immediately if
    // data is already loaded, or let the subscription callback catch it.
    window.addEventListener('hashchange', () => {
        if (window.location.hash !== '#huddle') return;
        history.replaceState(null, '', window.location.pathname);
        _autoOpen   = true;
        _autoOpened = false;
        if (_huddleState === 'ready' && _huddleData) _triggerAutoOpen(_huddleData);
    });

    // Real-time listener — fires from IndexedDB cache on repeat visits (near-instant)
    // then again when the server confirms. Also fires when a new huddle is uploaded,
    // so staff don't need to refresh the page.
    let _unsubHuddle = null;
    function startHuddleSubscription() {
        if (_unsubHuddle) _unsubHuddle();
        _unsubHuddle = subscribeToLatestHuddle(
            (huddle) => {
                if (!huddle) {
                    _huddleState = 'none';
                } else {
                    _huddleData  = huddle;
                    _huddleState = 'ready';
                    if (_autoOpen && !_autoOpened) _triggerAutoOpen(huddle);
                }
                applyHuddleButtonState();
            },
            (err) => {
                _huddleState = 'error';
                console.warn('[Huddle] Could not fetch latest huddle:', err);
                applyHuddleButtonState();
            }
        );
    }
    startHuddleSubscription();

    // If the tab was discarded while still loading, re-subscribe on return so
    // the Huddle button doesn't stay stuck in 'loading'.
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && _huddleState === 'loading') {
            startHuddleSubscription();
        }
    });

    // Safety timeout — don't leave the button in 'loading' forever if the
    // listener never fires (offline, blocked, etc.).
    setTimeout(() => {
        if (_huddleState === 'loading') {
            _huddleState = 'error';
            applyHuddleButtonState();
        }
    }, 8000);
})();

// ============================================
// PUSH NOTIFICATIONS — silent subscription renewal
// ============================================
// Push notification handling:
//   - If permission already granted: silently renew/migrate subscription (VAPID key rotation check)
//   - If permission not yet asked: show one-off prompt strip on the calendar
(function initNotifications() {
    const VAPID_PUBLIC_KEY  = 'BDycpNlvciF7kfUv3yxSQ0iRzWdi3BDZipNf-vk7QYaOSsbbIgb5FRSW9GrJlZJlmThoyQrbK0t9sd3hEdmhgSg';
    const VAPID_VER_KEY     = 'myb_vapid_ver';
    const VAPID_FINGERPRINT = VAPID_PUBLIC_KEY.slice(0, 12);
    const PROMPT_DISMISSED  = 'myb_notif_prompt_done';

    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    function vapidKey() {
        const base64 = VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    }

    async function subscribe() {
        const reg   = await navigator.serviceWorker.ready;
        const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() });
        await savePushSubscription(fresh);
        lsSet(VAPID_VER_KEY, VAPID_FINGERPRINT);
        lsSet(PROMPT_DISMISSED, '1');
    }

    // Already granted — silently renew, checking for VAPID key rotation
    if (Notification.permission === 'granted') {
        navigator.serviceWorker.ready.then(async reg => {
            try {
                const sub = await reg.pushManager.getSubscription();
                if (!sub) return;
                if (lsGet(VAPID_VER_KEY) !== VAPID_FINGERPRINT) {
                    await sub.unsubscribe();
                    await subscribe();
                } else {
                    await savePushSubscription(sub);
                }
            } catch (err) {
                console.warn('[Notifications] Renewal failed:', err.message);
            }
        });
        return;
    }

    // Permission not yet asked — show one-off prompt unless already dismissed
    if (Notification.permission === 'denied') return;
    if (lsGet(PROMPT_DISMISSED)) return;

    // On iOS, Web Push only works inside a Home Screen PWA. In regular Safari the
    // permission request always fails silently, so showing the prompt would mislead.
    const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const _isStandalonePWA = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (_isIOS && !_isStandalonePWA) return;

    const prompt      = document.getElementById('notifPrompt');
    const enableBtn   = document.getElementById('notifPromptEnable');
    const dismissBtn  = document.getElementById('notifPromptDismiss');
    if (!prompt || !enableBtn || !dismissBtn) return;

    prompt.style.display = 'flex';

    function hide() { prompt.style.display = 'none'; }

    enableBtn.addEventListener('click', async () => {
        hide();
        try {
            const perm = await Notification.requestPermission();
            if (perm === 'granted') await subscribe();
            else lsSet(PROMPT_DISMISSED, '1');
        } catch (err) {
            console.warn('[Notifications] Enable failed:', err.message);
        }
    });

    dismissBtn.addEventListener('click', () => {
        hide();
        lsSet(PROMPT_DISMISSED, '1');
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

const _calendarSession = (() => {
    try { return JSON.parse(lsGet('myb_admin_session') || 'null'); } catch { return null; }
})();
initNavPanel({
    currentPage: 'calendar',
    memberName:  _calendarSession?.name || null,
    onSignOut:   _calendarSession ? () => {
        lsDel('myb_admin_session');
        window.location.reload();
    } : null,
});
