/**
 * app.js — Calendar UI for index.html.
 *
 * Owns: month carousel, swipe gestures, shift cell render, override cache for
 *   the calendar view, Team Week View, notification wiring, sync chip.
 * Does NOT own: roster data (roster-data.js), Firebase init (firebase-client.js).
 * Edit here for: calendar display, swipe behaviour, override cache.
 * Do not edit here for: pay maths, admin features, override entry.
 */

import { CONFIG, teamMembers, weeklyRoster, bilingualRoster, fixedRoster, cesRoster, dispatcherRoster, DAY_KEYS, DAY_NAMES, MONTH_ABB, getALEntitlement, RAMADAN_STARTS, EID_FITR_DATES, EID_ADHA_DATES, ISLAMIC_NEW_YEAR_DATES, MAWLID_DATES, HOLI_DATES, NAVRATRI_DATES, DUSSEHRA_DATES, DIWALI_DATES, RAKSHA_BANDHAN_DATES, CHINESE_NEW_YEAR_DATES, LANTERN_FESTIVAL_DATES, QINGMING_DATES, DRAGON_BOAT_DATES, MID_AUTUMN_DATES, JAMAICAN_ASH_WEDNESDAY_DATES, JAMAICAN_LABOUR_DAY_DATES, JAMAICAN_EMANCIPATION_DATES, JAMAICAN_INDEPENDENCE_DATES, JAMAICAN_HEROES_DAY_DATES, isSameDay, getBankHolidays, isBankHoliday, isChristmasDay, isEasterSunday, getPaydaysAndCutoffs, isPayday, isCutoffDate, CONGOLESE_MARTYRS_DATES, CONGOLESE_LIBERATION_DATES, CONGOLESE_HEROES_DATES, CONGOLESE_INDEPENDENCE_DATES, PORTUGUESE_CARNIVAL_DATES, PORTUGUESE_FREEDOM_DATES, PORTUGUESE_LABOUR_DATES, PORTUGUESE_PORTUGAL_DAY_DATES, PORTUGUESE_CORPUS_CHRISTI_DATES, PORTUGUESE_ASSUMPTION_DATES, PORTUGUESE_REPUBLIC_DATES, PORTUGUESE_RESTORATION_DATES, PORTUGUESE_IMMACULATE_DATES, SHIFT_TIME_REGEX, isChristmasRD, isEarlyShift, isNightShift, getShiftClass, getShiftBadge, getWeekNumberForDate, getRosterForMember, getBaseShift, escapeHtml, formatISO, isSunday, getFaithBadge, SWIPE_THRESHOLD, SWIPE_VELOCITY } from './roster-data.js?v=8.73';
import { db, collection, query, where, getDocs, getLatestHuddle, savePushSubscription, deletePushSubscription } from './firebase-client.js?v=8.73';

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

// Restore last-viewed month from localStorage (if valid and within app bounds)
(function restoreViewedMonth() {
    const m = parseInt(localStorage.getItem('myb_roster_month'), 10);
    const y = parseInt(localStorage.getItem('myb_roster_year'),  10);
    if (!isNaN(m) && !isNaN(y) && y >= CONFIG.MIN_YEAR && y <= CONFIG.MAX_YEAR && m >= 0 && m <= 11) {
        currentDisplayMonth = m;
        currentDisplayYear  = y;
    }
})();

// ============================================
// SWIPE GESTURE STATE
// ============================================
let swipeCooldown = false;

// ============================================
// HUDDLE BUTTON STATE
// Persists across renders — #huddleBtn is re-created on every renderCalendar()
// and renderTeamView() call. Module-level state lets applyHuddleButtonState()
// immediately restore the correct enabled/disabled label on each new button.
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
// TEAM VIEW STATE
// ============================================
let teamViewMode = false;

/** Sunday of the week currently shown in team view. Reset to current week on each open. */
let currentTeamWeekStart = (() => { const s = getSunday(new Date()); return s; })();

/** Grade tab shown in team view. Defaults to the logged-in member's role. */
let currentTeamGrade = (() => {
    try {
        const idx  = getSelectedMemberIndex();
        const role = idx >= 0 ? teamMembers[idx].role : 'CEA';
        return (role === 'CES' || role === 'Dispatcher') ? role : 'CEA';
    } catch { return 'CEA'; }
})();

/** Returns the Sunday of the week containing `date` (Chiltern week: Sun–Sat). */
function getSunday(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay()); // getDay() 0=Sun, so subtract to reach Sunday
    return d;
}

/** Returns an array of 7 Date objects Sun–Sat starting from `sunday`. */
function getTeamWeekDates(sunday) {
    return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(sunday);
        d.setDate(d.getDate() + i);
        return d;
    });
}


/**
 * Returns the effective shift display data for a member on a date,
 * applying any cached Firestore overrides over the base roster.
 * @returns {{ text: string, cls: string }}
 */
function getTeamCellDisplay(member, date) {
    const dateStr  = formatISO(date);
    const cacheKey = `${member.name}|${dateStr}`;

    let shift = getBaseShift(member, date);

    const override = rosterOverridesCache.get(cacheKey);
    if (override) {
        if      (override.type === 'annual_leave') shift = 'AL';
        else if (override.type === 'sick')         shift = 'SICK';
        else if (override.type === 'correction')   shift = 'RD';
        else if (override.type === 'rdw')          shift = 'RDW|' + (override.value || '');
        else if (override.type === 'spare_shift')  shift = 'SPARE';
        else if (override.value)                   shift = override.value;
    }

    if (shift === 'RD' || shift === 'OFF') return { text: '–', cls: 'tv-rest' };
    if (shift === 'SPARE')                 return { text: '📋 Spare', cls: 'tv-spare' };
    if (shift === 'AL')                    return { text: '🏖️ AL', cls: 'tv-al' };
    if (shift === 'SICK')                  return { text: '🪑', cls: 'tv-sick' };
    if (shift === 'RDW')                   return { text: '💼 RDW', cls: 'tv-rdw' };
    if (shift.startsWith('RDW|')) {
        return { text: `💼 ${shift.slice(4)}`, cls: 'tv-rdw' };
    }
    if (SHIFT_TIME_REGEX.test(shift)) {
        let emoji = '🌙';
        if      (member.permanentShift === 'early') emoji = '☀️';
        else if (member.permanentShift === 'late')  emoji = '🌙';
        else if (isNightShift(shift))               emoji = '🦉';
        else if (isEarlyShift(shift))               emoji = '☀️';

        const cls = member.permanentShift === 'early' ? 'tv-early'
                  : member.permanentShift === 'late'  ? 'tv-late'
                  : isNightShift(shift)               ? 'tv-night'
                  : isEarlyShift(shift)               ? 'tv-early'
                  : 'tv-late';
        return { text: `${emoji} ${shift}`, cls };
    }
    return { text: escapeHtml(shift), cls: '' };
}

/**
 * Renders the team week grid for the given grade into #calendarDisplay.
 * Safe to call multiple times (re-render on week/grade change or after Firestore loads).
 *
 * @param {string} grade  'CEA' | 'CES' | 'Dispatcher'
 * @param {object} [opts]
 * @param {boolean} [opts.skipFetch=false]  Pass true when re-rendering without a new
 *   Firestore fetch (grade tab change, or callback re-render after fetch completes).
 *   Prevents the fetch loop: fetch → re-render → fetch → re-render…
 */
function renderTeamView(grade, opts = {}) {
    currentTeamGrade = grade;
    const { skipFetch = false } = opts;

    const calendarDisplay = document.getElementById('calendarDisplay');
    if (!calendarDisplay) return;

    const weekDates = getTeamWeekDates(currentTeamWeekStart);
    const weekStart = weekDates[0];
    const weekEnd   = weekDates[6];

    // Week label: "19–25 May 2026" or "28 Apr – 4 May 2026" for cross-month weeks
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    const weekLabel = sameMonth
        ? `${weekStart.getDate()}–${weekEnd.getDate()} ${monthNames[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`
        : `${weekStart.getDate()} ${monthNames[weekStart.getMonth()]} – ${weekEnd.getDate()} ${monthNames[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;

    const gradeMembers = teamMembers.filter(m => !m.hidden && m.role === grade);

    const isCurrentWeek = currentTeamWeekStart.getTime() === getSunday(new Date()).getTime();
    // "This week" badge when on the current week; "↩ This week" nav button when browsing away.
    const currentBadge = isCurrentWeek
        ? '<span class="tv-current-badge">This week</span>'
        : '<button class="tv-today-btn" id="tvToday" aria-label="Jump to current week">↩ This week</button>';

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const todayIndex = weekDates.findIndex(d => d.getTime() === todayMidnight.getTime());

    const dayHeaders = weekDates.map((d, i) =>
        `<th class="tv-day-header${i === todayIndex ? ' tv-today-col' : ''}">${dayLabels[i]}<span class="tv-day-num">${d.getDate()}</span></th>`
    ).join('');

    const tableBody = gradeMembers.length === 0
        ? `<tr><td colspan="8" class="tv-empty">No staff in this grade</td></tr>`
        : gradeMembers.map(member => {
            const cells = weekDates.map((date, i) => {
                const { text, cls } = getTeamCellDisplay(member, date);
                return `<td class="tv-cell ${cls}${i === todayIndex ? ' tv-today-col' : ''}">${text}</td>`;
            }).join('');
            return `<tr><td class="tv-name-col">${escapeHtml(member.name)}</td>${cells}</tr>`;
        }).join('');

    const gradeBtns = ['CEA', 'CES', 'Dispatcher'].map(g =>
        `<button class="grade-tab${g === grade ? ' active' : ''}" role="tab" aria-selected="${g === grade}" data-grade="${g}">${g}</button>`
    ).join('');

    calendarDisplay.innerHTML = `
        <div class="team-view-container">
            <div class="grade-tabs-row">
                <div></div>
                <div class="grade-tabs" role="tablist" aria-label="Grade selector">${gradeBtns}</div>
                <div class="grade-tabs-actions">
                    <button id="huddleBtn" class="huddle-icon-btn" aria-label="Open today's Huddle" title="Open today's Huddle">📋</button>
                    <button class="team-help-btn" id="teamHelpBtn" aria-label="Team view tips and colour key">?</button>
                </div>
            </div>
            <div class="team-week-row">
                <button class="tv-week-nav" id="tvPrevWeek" aria-label="Previous week">← Prev</button>
                <div class="team-week-center">
                    <span class="team-week-text">${weekLabel}</span>${currentBadge}
                </div>
                <button class="tv-week-nav" id="tvNextWeek" aria-label="Next week">Next →</button>
            </div>
            <div class="team-table-wrap">
                <table class="team-table" aria-label="Team roster — week of ${weekLabel}">
                    <thead><tr>
                        <th class="tv-name-col">Name</th>${dayHeaders}
                    </tr></thead>
                    <tbody>${tableBody}</tbody>
                </table>
            </div>
            <p class="tv-scroll-hint touch-only">← Swipe table to see all 7 days →</p>
        </div>`;

    // Grade tab clicks stay on the same week — no new Firestore fetch needed,
    // data for this week is already in the override cache.
    calendarDisplay.querySelectorAll('.grade-tab').forEach(tab =>
        tab.addEventListener('click', () => renderTeamView(tab.dataset.grade, { skipFetch: true }))
    );

    const tvPrev  = calendarDisplay.querySelector('#tvPrevWeek');
    const tvNext  = calendarDisplay.querySelector('#tvNextWeek');
    const tvToday = calendarDisplay.querySelector('#tvToday');
    if (tvPrev) tvPrev.addEventListener('click', () => {
        const d = new Date(currentTeamWeekStart);
        d.setDate(d.getDate() - 7);
        currentTeamWeekStart = d;
        renderTeamView(currentTeamGrade);
        announceTeamWeek();
    });
    if (tvNext) tvNext.addEventListener('click', () => {
        const d = new Date(currentTeamWeekStart);
        d.setDate(d.getDate() + 7);
        currentTeamWeekStart = d;
        renderTeamView(currentTeamGrade);
        announceTeamWeek();
    });
    if (tvToday) tvToday.addEventListener('click', () => {
        currentTeamWeekStart = getSunday(new Date());
        renderTeamView(currentTeamGrade);
        announceTeamWeek();
    });

    applyHuddleButtonState();

    // Dismiss scroll hint permanently after the user scrolls the table once.
    const tableWrap = calendarDisplay.querySelector('.team-table-wrap');
    const scrollHint = calendarDisplay.querySelector('.tv-scroll-hint');
    if (scrollHint && localStorage.getItem('myb_team_scroll_seen')) {
        scrollHint.hidden = true;
    } else if (tableWrap && scrollHint) {
        tableWrap.addEventListener('scroll', () => {
            scrollHint.hidden = true;
            localStorage.setItem('myb_team_scroll_seen', '1');
        }, { once: true });
    }

    if (!skipFetch) {
        // Background Firestore fetch — updates cache and re-renders only if new data arrived.
        // Pass the week start time so the callback can discard stale results if the user
        // navigated to a different week before this fetch completed.
        fetchTeamWeekOverrides(weekDates[0], weekDates[6], currentTeamWeekStart.getTime());
    }
}

/** Fetches all overrides for a week in one query and re-renders if new data is found.
 *  @param {Date}   weekStart  - Sunday of the week
 *  @param {Date}   weekEnd    - Saturday of the week
 *  @param {number} fetchToken - currentTeamWeekStart.getTime() at dispatch time;
 *                               result is discarded if the user has navigated away. */
async function fetchTeamWeekOverrides(weekStart, weekEnd, fetchToken) {
    try {
        const snap = await getDocs(query(
            collection(db, 'overrides'),
            where('date', '>=', formatISO(weekStart)),
            where('date', '<=', formatISO(weekEnd))
        ));
        // Discard if the user navigated to a different week while this was in flight
        if (!teamViewMode || currentTeamWeekStart.getTime() !== fetchToken) return;
        let updated = false;
        snap.forEach(doc => {
            const d          = doc.data();
            const cacheKey   = `${d.memberName}|${d.date}`;
            const existing   = rosterOverridesCache.get(cacheKey);
            const newManual  = d.source !== 'roster_import';
            const exManual   = existing && existing.source !== 'roster_import';
            if (!existing ||
                (newManual && !exManual) ||
                (newManual === exManual && (d.createdAt?.toMillis?.() ?? 0) > (existing?.createdAt?.toMillis?.() ?? 0))) {
                rosterOverridesCache.set(cacheKey, d);
                updated = true;
            }
        });
        if (updated) renderTeamView(currentTeamGrade, { skipFetch: true });
    } catch (err) {
        console.warn('[TeamView] Could not fetch week overrides:', err);
    }
}

/**
 * Toggles between personal calendar and team week view.
 */
function toggleTeamView() {
    teamViewMode = !teamViewMode;
    localStorage.setItem('myb_team_view', teamViewMode ? '1' : '');

    applyTeamViewChrome();

    if (teamViewMode) {
        currentTeamWeekStart = getSunday(new Date());
        renderTeamView(currentTeamGrade);
    } else {
        renderCalendar();
    }
}

/** Applies/removes all non-content DOM changes for team view mode. */
function applyTeamViewChrome() {
    const teamBtn = document.getElementById('teamViewBtn');
    const navRow  = document.getElementById('navRow');
    const legend  = document.querySelector('.legend');
    if (teamBtn) {
        teamBtn.classList.toggle('active', teamViewMode);
        teamBtn.textContent = teamViewMode ? '📅 Month' : '👥 Team';
        teamBtn.setAttribute('aria-label', teamViewMode
            ? 'Switch back to monthly calendar'
            : 'Switch to team week view');
        teamBtn.setAttribute('aria-pressed', teamViewMode ? 'true' : 'false');
    }
    if (navRow)  navRow.style.display = teamViewMode ? 'none' : '';
    if (legend)  legend.style.display = teamViewMode ? 'none' : '';
}

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
    if (localStorage.getItem('myb_swipe_hint_seen')) return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const hint = document.getElementById('swipeHint');
    if (!hint) return;
    hint.style.display = '';
})();

function dismissSwipeHint() {
    const hint = document.getElementById('swipeHint');
    if (!hint || hint.style.display === 'none') return;
    localStorage.setItem('myb_swipe_hint_seen', '1');
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
    const savedName = localStorage.getItem('myb_roster_selected_member');
    if (savedName) {
        const idx = teamMembers.findIndex(m => m.name === savedName && !m.hidden);
        if (idx !== -1) return idx;
        // savedName stored but not found — stale entry from a removed member
        _staleMemberName = savedName;
        localStorage.removeItem('myb_roster_selected_member');
        return getDefaultMemberIndex();
    }
    // No saved selection (fresh device) — auto-select from the admin session if present
    // so the logged-in staff member sees their own calendar without triggering a
    // member-switch cache clear when they pick themselves from the dropdown.
    try {
        const sess = JSON.parse(localStorage.getItem('myb_admin_session') || 'null');
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
        localStorage.setItem('myb_roster_selected_member', teamMembers[index].name);
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
            <button id="huddleBtn" class="huddle-icon-btn" aria-label="Open today's Huddle" title="Open today's Huddle">📋</button>
        </div>
    `;
}

// escapeHtml — imported from roster-data.js

// Helper: Create day cell HTML (pure function)
// isWorkedDay — pre-calculated by caller (shift !== RD/SPARE/OFF) to avoid duplication.
// permanentShift ('early'|'late'|undefined) — overrides badge on worked days and suppresses time.
// note — optional Firestore override note; shown as small muted text below the shift time.
// rdwTime — actual shift time for RDW overrides (e.g. '08:00-16:30'), since shift='RDW' sentinel.
// ============================================
// FAITH CALENDAR HELPERS
// ============================================

// Resolve which faith calendar the member has opted in to.
// Handles backward compat: old Firestore docs stored islamicMarkers:true.
function resolveFaithCalendar(settings) {
    if (!settings) return 'none';
    if (settings.faithCalendar) return settings.faithCalendar;
    return settings.islamicMarkers ? 'islamic' : 'none';
}

// Returns { icon, label } for the faith marker on this date, or null if none.
// Delegates the lookup to getFaithBadge() in roster-data.js — the single source
// of truth for cultural calendar markers.
function getFaithMarker(dateStr, memberName) {
    const faithCalendar = resolveFaithCalendar(memberSettingsCache.get(memberName));
    return getFaithBadge(dateStr, faithCalendar);
}

function createDayCell(date, shift, permanentShift, isWorkedDay, note = '', rdwTime = '', faithMarker = null) {
    let badge;
    if (isWorkedDay && permanentShift === 'late') {
        badge = '<span class="shift-badge badge-late"><span>🌙</span><span>Late</span></span>';
    } else if (isWorkedDay && permanentShift === 'early') {
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
            const override = rosterOverridesCache.get(`${member.name}|${dateStr}`);
            if (override) {
                // RDW overrides carry a real shift time as their value, but must
                // render with the RDW colour scheme, not Early/Late/Night. Swap
                // the value for the 'RDW' sentinel so getShiftClass/Badge pick up
                // the correct pink styling. The actual time is preserved in rdwTime
                // so it can still be shown below the badge.
                if (override.type === 'rdw') {
                    rdwTime = override.value;
                    shift   = 'RDW';
                } else {
                    shift = override.value;
                }
                overrideNote = override.note;
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

        if (isSameDay(currentDate, today)) dayCell.classList.add('today');
        if (isBankHoliday(currentDate))    dayCell.classList.add('bank-holiday');
        if (isChristmasDay(currentDate))   dayCell.classList.add('christmas-day');
        if (isEasterSunday(currentDate))   dayCell.classList.add('easter-day');
        if (isPayday(currentDate)) {
            dayCell.classList.add('payday');
            dayCell.style.cursor = 'pointer';
            dayCell.addEventListener('click', () => {
                try {
                    const sess = JSON.parse(localStorage.getItem('myb_admin_session') || 'null');
                    if (sess && sess.name) {
                        window.location.href = `./paycalc.html?payday=${dateStr}`;
                    } else {
                        window.location.href = './admin.html?redirect=paycalc';
                    }
                } catch { window.location.href = './admin.html?redirect=paycalc'; }
            });
        }
        if (isCutoffDate(currentDate))      dayCell.classList.add('cutoff');

        dayCell.innerHTML = createDayCell(currentDate, shift, member.permanentShift, isWorkedDay, overrideNote, rdwTime, faithMarker);
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

    function openALLightbox() {
        lb.classList.add('visible');
        requestAnimationFrame(() => lb.classList.add('open'));
        document.addEventListener('keydown', onKey);
        loadALStats();
    }

    function closeALLightbox() {
        lb.classList.remove('open');
        lb.addEventListener('transitionend', () => lb.classList.remove('visible'), { once: true });
        document.removeEventListener('keydown', onKey);
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
            // Collect all overrides for this member so Dispatcher lieu days can be calculated
            const memberOverrides = [];
            const snap = await getDocs(query(collection(db, 'overrides'), where('memberName', '==', member.name)));
            snap.forEach(d => {
                const data = d.data();
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
        const ov = rosterOverridesCache.get(`${member.name}|${dateStr}`);
        if (ov) shift = ov.type === 'rdw' ? 'RDW' : ov.value;

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
function updateLegend() {
    const member = getCurrentMember();

    // Spare / RDW / AL — conditional on whether they appear this month
    const typesThisMonth = member
        ? getShiftTypesInMonth(member, currentDisplayYear, currentDisplayMonth)
        : new Set();
    const setLegendItemVisible = (id, visible) => { const legendItem = document.getElementById(id); if (legendItem) legendItem.style.display = visible ? '' : 'none'; };
    setLegendItemVisible('legend-spare', typesThisMonth.has('SPARE'));
    setLegendItemVisible('legend-rdw',   typesThisMonth.has('RDW'));
    setLegendItemVisible('legend-al',    typesThisMonth.has('AL'));
    setLegendItemVisible('legend-sick',  typesThisMonth.has('SICK'));
    // Hide the whole row-2 if all four are absent
    const row2 = document.getElementById('legend-row-2');
    if (row2) row2.style.display = (typesThisMonth.has('SPARE') || typesThisMonth.has('RDW') || typesThisMonth.has('AL') || typesThisMonth.has('SICK')) ? '' : 'none';

    const isDispatcher = member && member.rosterType === 'dispatcher';
    const nightItem = document.getElementById('legend-night');
    if (nightItem) nightItem.style.display = isDispatcher ? '' : 'none';

    const christmasItem = document.getElementById('legend-christmas');
    if (christmasItem) christmasItem.style.display = currentDisplayMonth === 11 ? '' : 'none';

    // Easter Sunday can fall in March or April — check which month it's in this year
    const easterItem = document.getElementById('legend-easter');
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
        return [...dateSet].some(d => {
            const [faithYear, faithMonth] = d.split('-').map(Number);
            return faithYear === y && (faithMonth - 1) === m;
        });
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
        const el = document.getElementById(id);
        if (el) el.style.display = faithInMonth(dateSet, cal) ? '' : 'none';
    }

    // Show/hide the faith row container itself — visible only when at least one item inside it is shown.
    const faithRow = document.getElementById('legend-faith-row');
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
        localStorage.setItem('myb_roster_month', currentDisplayMonth);
        localStorage.setItem('myb_roster_year',  currentDisplayYear);

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
            errDiv.innerHTML = '<h2>⚠️ Couldn\'t load the schedule</h2><p>Close the app and open it again. If this keeps happening, try turning your internet off and on.</p>';
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
    const CALENDAR_NAMES = {
        islamic:    '🌙 Islamic calendar',
        hindu:      '🪔 Hindu calendar',
        chinese:    '🧧 Chinese calendar',
        jamaican:   '🇯🇲 Jamaican calendar',
        congolese:  '🇨🇩 Congolese calendar',
        portuguese: '🇵🇹 Portuguese calendar',
    };
    if (cal !== 'none') {
        hint.textContent = (CALENDAR_NAMES[cal] || 'Cultural calendar') + ' markers active';
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

function announceTeamWeek() {
    const announcer = document.getElementById('ariaAnnouncer');
    if (!announcer) return;
    const dates = getTeamWeekDates(currentTeamWeekStart);
    const s = dates[0], e = dates[6];
    const label = s.getMonth() === e.getMonth()
        ? `${s.getDate()}–${e.getDate()} ${monthNames[e.getMonth()]} ${e.getFullYear()}`
        : `${s.getDate()} ${monthNames[s.getMonth()]} – ${e.getDate()} ${monthNames[e.getMonth()]} ${e.getFullYear()}`;
    announcer.textContent = '';
    requestAnimationFrame(() => { announcer.textContent = `Week of ${label}`; });
}

document.getElementById('todayBtn').addEventListener('click', () => {
    if (swipeCooldown) return;
    if (teamViewMode) {
        currentTeamWeekStart = getSunday(new Date());
        renderTeamView(currentTeamGrade);
        announceTeamWeek();
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
        const session = JSON.parse(localStorage.getItem('myb_admin_session') || 'null');
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

// Print — moved from nav button to the about lightbox
document.getElementById('lightboxPrintBtn').addEventListener('click', () => {
    window.print();
});

// Pay period strip — shows the current pay period dates + link to the pay calculator.
// Only shown when a session exists (same condition as the pay button navigation).
(function initPayPeriodStrip() {
    const strip = document.getElementById('payPeriodStrip');
    if (!strip) return;
    let session;
    try {
        session = JSON.parse(localStorage.getItem('myb_admin_session') || 'null');
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

document.getElementById('teamViewBtn').addEventListener('click', toggleTeamView);

(function initTeamLightboxes() {
    const lb = document.getElementById('teamInfoLightbox');
    const content = document.getElementById('teamInfoContent');
    if (!lb) return;

    function openTeamInfo() {
        lb.classList.add('visible');
        requestAnimationFrame(() => lb.classList.add('open'));
    }
    function closeTeamInfo() {
        lb.classList.remove('open');
        lb.addEventListener('transitionend', () => lb.classList.remove('visible'), { once: true });
    }

    document.getElementById('teamInfoClose')?.addEventListener('click', closeTeamInfo);
    lb.addEventListener('click', e => { if (e.target === lb) closeTeamInfo(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && lb.classList.contains('visible')) closeTeamInfo(); });
    if (content) content.addEventListener('click', e => e.stopPropagation());

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
                banner.textContent = '⚠️ Roster data issue: ' + allErrors.join(' | ');
                banner.classList.add('visible');
            }
        }

        populateTeamMemberDropdown();
        updateLegend();

        // Restore team view if the user was in it before the last refresh
        if (localStorage.getItem('myb_team_view') === '1') {
            teamViewMode = true;
            applyTeamViewChrome();
            renderTeamView(currentTeamGrade);
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
                splash.addEventListener('transitionend', () => splash.remove(), { once: true });
            });
        }

        // Handle manifest shortcuts — ?shortcut=today jumps to current month
        if (new URLSearchParams(window.location.search).get('shortcut') === 'today') {
            const now = getToday();
            currentDisplayMonth = now.getMonth();
            currentDisplayYear = now.getFullYear();
            renderCalendar();
            pulseToday();
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
                if (!e.isPrimary || swipeCooldown || teamViewMode) return;

                gestureCurrentPanel = document.querySelector('.calendar-container:not(.carousel-panel)');
                if (!gestureCurrentPanel) return;

                // Prime the Vibration API on the first real user gesture.
                // Chrome Android requires a user activation before navigator.vibrate() works.
                if (navigator.vibrate) navigator.vibrate(0);

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
                            registration.update();
                            swUpdateInterval = setInterval(() => registration.update(), 60 * 60 * 1000);
                        }
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

            function openLightbox() {
                // Swap content based on current view mode
                const inTeam = teamViewMode;
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
                document.addEventListener('keydown', onKeyDown);
            }

            function closeLightbox() {
                lightbox.classList.remove('open');
                lightbox.addEventListener('transitionend', () => {
                    lightbox.classList.remove('visible');
                }, { once: true });
                document.removeEventListener('keydown', onKeyDown);
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
            }

            function closePicker() {
                overlay.classList.remove('open');
                overlay.addEventListener('transitionend', () => overlay.classList.remove('visible'), { once: true });
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
            if (teamViewMode) return;
            if (e.key === 'ArrowLeft')  { changeMonth(-1); renderCalendar(); announceMonthChange(); }
            if (e.key === 'ArrowRight') { changeMonth(1);  renderCalendar(); announceMonthChange(); }
            if (e.key === 't' || e.key === 'T') { const now = getToday(); currentDisplayMonth = now.getMonth(); currentDisplayYear = now.getFullYear(); renderCalendar(); pulseToday(); announceMonthChange(); }
            if (e.key === 'p' || e.key === 'P') { window.print(); }
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
/** Convert a Firestore Timestamp (or plain {seconds, nanoseconds} object) to milliseconds. */
function _tsToMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return 0;
}

/**
 * Decide whether an incoming override document should replace the existing
 * cached entry for the same member|date key.
 *
 * Priority rules (highest first):
 *   1. Manual overrides (no source field) always beat roster_import entries.
 *   2. Among entries of equal source-priority, the newer createdAt wins.
 *
 * This ensures a human-entered correction survives a roster re-import, and
 * that if two imports exist for the same date the most recent one is used.
 */
function _shouldReplaceOverride(existing, incoming) {
    if (!existing) return true;
    const existingIsImport = existing.source === 'roster_import';
    const incomingIsImport = incoming.source === 'roster_import';
    // Manual beats import
    if (existingIsImport && !incomingIsImport) return true;
    if (!existingIsImport && incomingIsImport) return false;
    // Same class — newer timestamp wins
    return _tsToMillis(incoming.createdAt) >= _tsToMillis(existing.createdAt);
}

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
                '— keeping', _shouldReplaceOverride(existing, incoming) ? 'incoming' : 'existing',
                { existing, incoming });
        }
        if (_shouldReplaceOverride(existing, incoming)) {
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
        if (!teamViewMode && getSelectedMemberIndex() === memberAtFetch) renderCalendar();
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
            syncChip.addEventListener('click', () => {
                fetchedMonths.clear();
                syncChip.remove();
                syncChip = null;
                ensureOverridesCached(currentDisplayYear, currentDisplayMonth);
            }, { once: true });
        }
        if (calGrid) calGrid.classList.remove('calendar-fetching');
    }, 10000);

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
            const local = localStorage.getItem(`faithCalendar_${m.name}`);
            if (local) {
                const existing = memberSettingsCache.get(m.name) || {};
                memberSettingsCache.set(m.name, { ...existing, faithCalendar: local });
            }
        });

        syncResolved = true;
        if (!teamViewMode) renderCalendar();
        updateFaithHint();

        // Briefly show "✓ Up to date" then fade the chip away
        if (syncChip) {
            syncChip.textContent = '✓ Up to date';
            syncChip.className = 'sync-chip sync-chip-ok';
            setTimeout(() => syncChip?.remove(), 1500);
            syncChip = null;
        }
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

// Register service worker for PWA functionality
// ============================================
// PRINT HEADER — stamp timestamp before printing
// ============================================
window.addEventListener('beforeprint', () => {
    const now    = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    const header = document.querySelector('.header');
    if (header) header.setAttribute('data-print-date', `Printed: ${now}`);
});

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
 * Strip dangerous elements and event handlers from HTML before rendering.
 * mammoth produces safe HTML (headings, paragraphs, lists) but Firestore data
 * is externally controlled, so we sanitise as a defence-in-depth measure.
 * @param {string} html
 * @returns {string}
 */
function sanitiseHtml(html) {
    // Allowlist approach: only known-safe tags survive; everything else is removed entirely.
    // Safer than a blocklist because new attack vectors (href="javascript:", <svg> handlers,
    // CSS expressions) don't require updating this function.
    // mammoth produces p/h1-h6/ul/ol/li/strong/em/table/tr/td/th/a — all covered below.
    const ALLOWED = new Set([
        'p','h1','h2','h3','h4','h5','h6',
        'ul','ol','li',
        'strong','em','b','i','br',
        'table','thead','tbody','tr','th','td',
        'div','span','a',
    ]);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Scope to doc.body — doc.querySelectorAll('*') would include <html>, <head>, and
    // <body> itself, none of which are in ALLOWED, so <body> would be removed and
    // doc.body would become null, crashing the return statement.
    // Remove disallowed elements entirely (including their children).
    doc.body.querySelectorAll('*').forEach(el => {
        if (!ALLOWED.has(el.tagName.toLowerCase())) el.remove();
    });
    // Strip all attributes from remaining elements — no href="javascript:", no on* handlers.
    doc.body.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(a => el.removeAttribute(a.name));
    });
    return doc.body.innerHTML;
}

// ============================================
// HUDDLE BUTTON — event delegation + module-state
// #huddleBtn is re-created on every renderCalendar() / renderTeamView() call.
// Delegation on document handles clicks regardless of which instance is live.
// _huddleData / _huddleState are set once at startup and survive re-renders.
// ============================================
(function initHuddleViewer() {
    const viewer = document.getElementById('huddleViewer');
    const body   = document.getElementById('huddleViewerBody');
    const close  = document.getElementById('huddleViewerClose');

    function openViewer() {
        viewer.classList.add('visible');
        requestAnimationFrame(() => viewer.classList.add('open'));
        document.addEventListener('keydown', onKey);
    }
    function closeViewer() {
        viewer.classList.remove('open');
        viewer.addEventListener('transitionend', () => {
            viewer.classList.remove('visible');
            body.classList.remove('has-iframe');
        }, { once: true });
        document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') closeViewer(); }

    if (close) {
        close.addEventListener('touchend', (e) => { e.preventDefault(); closeViewer(); });
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
                if (/Android/i.test(navigator.userAgent)) {
                    const iframe = document.createElement('iframe');
                    iframe.src   = 'https://docs.google.com/viewer?url=' + encodeURIComponent(huddle.storageUrl) + '&embedded=true';
                    iframe.title = 'Daily Huddle';
                    body.innerHTML = '';
                    body.appendChild(iframe);
                    body.classList.add('has-iframe');
                    openViewer();
                    close.focus();
                } else {
                    window.open(huddle.storageUrl, '_blank', 'noopener');
                }
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

    // Fetch huddle data once at startup — result persists in module-level state.
    (async () => {
        try {
            const huddle = await getLatestHuddle();
            if (!huddle) {
                _huddleState = 'none';
            } else {
                _huddleData  = huddle;
                _huddleState = 'ready';
            }
        } catch (err) {
            _huddleState = 'error';
            console.warn('[Huddle] Could not fetch latest huddle:', err);
        }
        applyHuddleButtonState();
    })();
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
        localStorage.setItem(VAPID_VER_KEY, VAPID_FINGERPRINT);
        localStorage.setItem(PROMPT_DISMISSED, '1');
    }

    // Already granted — silently renew, checking for VAPID key rotation
    if (Notification.permission === 'granted') {
        navigator.serviceWorker.ready.then(async reg => {
            try {
                const sub = await reg.pushManager.getSubscription();
                if (!sub) return;
                if (localStorage.getItem(VAPID_VER_KEY) !== VAPID_FINGERPRINT) {
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
    if (localStorage.getItem(PROMPT_DISMISSED)) return;

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
            else localStorage.setItem(PROMPT_DISMISSED, '1');
        } catch (err) {
            console.warn('[Notifications] Enable failed:', err.message);
        }
    });

    dismissBtn.addEventListener('click', () => {
        hide();
        localStorage.setItem(PROMPT_DISMISSED, '1');
    });
})();
