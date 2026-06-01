/**
 * app-team-view.js — Team Week View for index.html.
 *
 * Owns: team view state (mode, current week, grade), grid render, Firestore
 *   override fetch, toggle, chrome updates, ARIA week announcement.
 * Does NOT own: personal calendar rendering, override cache population,
 *   overlay history management (all passed as deps).
 * Edit here for: team grid layout, grade tab logic, week navigation, cell display.
 * Do not edit here for: personal calendar, override cache management, nav structure.
 */

import { CONFIG, teamMembers, DAY_NAMES, TEAM_GRADES, getBaseShift, escapeHtml, formatISO,
         SHIFT_TIME_REGEX, isEarlyShift, isNightShift } from './roster-data.js';
import { db, collection, query, where, getDocs } from './firebase-client.js';
import { lsGet, lsSet } from './ls.js';
import { isBeforeMemberStart, shouldReplaceOverride } from './app-override-utils.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

// Warn at most once per session per unknown shift type — avoids console spam on every render.
const _unknownShiftWarned = new Set();

/**
 * Initialises the Team Week View.
 *
 * @param {object} deps
 * @param {Map}      deps.rosterOverridesCache   Shared override cache keyed "memberName|date"
 * @param {Function} deps.getSelectedMemberIndex Returns index of logged-in member in teamMembers
 * @param {Function} deps.renderCalendar         Called when team view is dismissed
 * @param {Function} deps._pushOverlayState      Registers Back-button close handler
 * @param {Function} deps._clearOverlayHistory   Removes Back-button handler when closing via button
 * @returns {{ toggleTeamView, applyTeamViewChrome, isTeamViewMode, renderTeamView,
 *             announceTeamWeek, restoreTeamView, jumpToCurrentWeek }}
 */
export function initTeamView({ rosterOverridesCache, getSelectedMemberIndex, renderCalendar,
                                _pushOverlayState, _clearOverlayHistory }) {

    // ── STATE ─────────────────────────────────────────────────────────────────

    let teamViewMode = false;

    /** Sunday of the week currently shown in team view. Reset to current week on each open. */
    let currentTeamWeekStart = getSunday(new Date());

    /** Grade tab shown in team view. Defaults to the logged-in member's role. */
    let currentTeamGrade = (() => {
        try {
            const idx  = getSelectedMemberIndex();
            const role = idx >= 0 ? teamMembers[idx].role : 'CEA';
            return TEAM_GRADES.includes(role) ? role : 'CEA';
        } catch { return 'CEA'; }
    })();

    // ── HELPERS ───────────────────────────────────────────────────────────────

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

        const override = !isBeforeMemberStart(member, date) ? rosterOverridesCache.get(cacheKey) : null;
        if (override) {
            if      (override.type === 'annual_leave') shift = 'AL';
            else if (override.type === 'sick' && shift !== 'RD' && shift !== 'OFF') shift = 'SICK';
            else if (override.type === 'correction')   shift = 'RD';
            else if (override.type === 'rdw')          shift = 'RDW|' + (override.value || '');
            else if (override.type === 'spare_shift')  shift = 'SPARE';
            else if (override.value && override.type !== 'sick') shift = override.value;
        }

        if (shift === 'RD' || shift === 'OFF') return { text: '–', cls: 'tv-rest' };
        if (shift === 'SPARE')                 return { text: '📋 Spare', cls: 'tv-spare' };
        if (shift === 'AL')                    return { text: '🏖️ AL', cls: 'tv-al' };
        if (shift === 'SICK')                  return { text: '🪑 Absent', cls: 'tv-sick' };
        if (shift === 'RDW')                   return { text: '💼 RDW', cls: 'tv-rdw' };
        if (shift.startsWith('RDW|')) {
            return { text: `💼 ${escapeHtml(shift.slice(4)) || 'RDW'}`, cls: 'tv-rdw' };
        }
        if (SHIFT_TIME_REGEX.test(shift)) {
            const shiftKind = member.permanentShift === 'early' ? 'early'
                            : member.permanentShift === 'late'  ? 'late'
                            : isNightShift(shift)               ? 'night'
                            : isEarlyShift(shift)               ? 'early'
                            :                                     'late';
            const EMOJI = { early: '☀️', late: '🌙', night: '🦉' };
            return { text: `${EMOJI[shiftKind]} ${escapeHtml(shift)}`, cls: `tv-${shiftKind}` };
        }
        if (!_unknownShiftWarned.has(shift)) { _unknownShiftWarned.add(shift); console.warn('[Team view] Unrecognised shift type:', shift); }
        return { text: escapeHtml(shift), cls: '' };
    }

    /** Formats a Sunday-anchored week as "19–25 May 2026" or "28 Apr – 4 May 2026". */
    function formatTeamWeekLabel(sunday) {
        const dates = getTeamWeekDates(sunday);
        const s = dates[0], e = dates[6];
        return s.getMonth() === e.getMonth()
            ? `${s.getDate()}–${e.getDate()} ${MONTH_NAMES[e.getMonth()]} ${e.getFullYear()}`
            : `${s.getDate()} ${MONTH_NAMES[s.getMonth()]} – ${e.getDate()} ${MONTH_NAMES[e.getMonth()]} ${e.getFullYear()}`;
    }

    // ── RENDER ────────────────────────────────────────────────────────────────

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

        const weekDates  = getTeamWeekDates(currentTeamWeekStart);
        const weekLabel  = formatTeamWeekLabel(currentTeamWeekStart);

        // Save scroll position before innerHTML wipe so it can be restored when skipFetch
        // (grade tab switch or Firestore callback re-render). Week navigation intentionally
        // resets scroll to today, so prevScrollLeft stays 0 in that case.
        const prevScrollLeft = skipFetch
            ? (calendarDisplay.querySelector('.team-table-wrap')?.scrollLeft ?? 0)
            : 0;

        const gradeMembers = teamMembers
            .filter(m => !m.hidden && m.role === grade)
            .sort((a, b) => a.name.localeCompare(b.name));

        const isCurrentWeek = currentTeamWeekStart.getTime() === getSunday(new Date()).getTime();
        // "This week" badge when on the current week; "↩ This week" nav button when browsing away.
        const currentBadge = isCurrentWeek
            ? '<span class="tv-current-badge">This week</span>'
            : '<button class="tv-today-btn" id="tvToday" aria-label="Jump to current week">↩ This week</button>';

        const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
        const todayIndex = weekDates.findIndex(d => d.getTime() === todayMidnight.getTime());

        const dayHeaders = weekDates.map((d, i) =>
            `<th class="tv-day-header${i === todayIndex ? ' tv-today-col' : ''}">${DAY_NAMES[i]}<span class="tv-day-num">${d.getDate()}</span></th>`
        ).join('');

        // Identify the logged-in member so their row can be visually distinguished.
        const myIdx  = getSelectedMemberIndex();
        const myName = myIdx >= 0 ? teamMembers[myIdx].name : null;

        const tableBody = gradeMembers.length === 0
            ? `<tr><td colspan="8" class="tv-empty">No staff in this grade</td></tr>`
            : gradeMembers.map(member => {
                const cells = weekDates.map((date, i) => {
                    const { text, cls } = getTeamCellDisplay(member, date);
                    return `<td class="tv-cell ${cls}${i === todayIndex ? ' tv-today-col' : ''}">${text}</td>`;
                }).join('');
                const myRow = member.name === myName ? ' class="tv-my-row"' : '';
                return `<tr${myRow}><td class="tv-name-col">${escapeHtml(member.name)}</td>${cells}</tr>`;
            }).join('');

        const gradeBtns = TEAM_GRADES.map(g =>
            `<button class="grade-tab${g === grade ? ' active' : ''}" role="tab" aria-selected="${g === grade}" tabindex="${g === grade ? '0' : '-1'}" aria-controls="gradeTabPanel" data-grade="${g}">${g}</button>`
        ).join('');

        calendarDisplay.innerHTML = `
            <div class="team-view-container">
                <div class="tv-print-header">Team View · ${grade} · ${weekLabel} · Printed ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                <div class="grade-tabs-row">
                    <div></div>
                    <div class="grade-tabs" role="tablist" aria-label="Grade selector">${gradeBtns}</div>
                    <div class="grade-tabs-actions">
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
                <div class="team-table-wrap" id="gradeTabPanel" role="tabpanel" aria-label="${grade} grade roster — week of ${weekLabel}">
                    <table class="team-table">
                        <thead><tr>
                            <th class="tv-name-col">Name</th>${dayHeaders}
                        </tr></thead>
                        <tbody>${tableBody}</tbody>
                    </table>
                </div>
                <p class="tv-scroll-hint touch-only">← Swipe table to see all 7 days →</p>
            </div>`;

        // Grade tab interaction — click or arrow key switches grade without a new fetch.
        // Arrow keys implement the ARIA tabs keyboard pattern (← → cycle between tabs).
        // After re-render the newly active tab receives focus so keyboard users stay oriented.
        const gradeTabList = calendarDisplay.querySelector('.grade-tabs');
        if (gradeTabList) {
            gradeTabList.addEventListener('click', e => {
                const tab = e.target.closest('.grade-tab');
                if (tab) renderTeamView(tab.dataset.grade, { skipFetch: true });
            });
            gradeTabList.addEventListener('keydown', e => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const tabs = [...gradeTabList.querySelectorAll('.grade-tab')];
                const idx  = tabs.findIndex(t => t === document.activeElement);
                if (idx === -1) return;
                const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
                renderTeamView(next.dataset.grade, { skipFetch: true });
                calendarDisplay.querySelector(`.grade-tab[data-grade="${next.dataset.grade}"]`)?.focus();
            });
        }

        const tvPrev  = calendarDisplay.querySelector('#tvPrevWeek');
        const tvNext  = calendarDisplay.querySelector('#tvNextWeek');
        const tvToday = calendarDisplay.querySelector('#tvToday');
        if (tvPrev) tvPrev.addEventListener('click', () => {
            const d = new Date(currentTeamWeekStart);
            d.setDate(d.getDate() - 7);
            if (d.getFullYear() < CONFIG.MIN_YEAR) return;
            currentTeamWeekStart = d;
            renderTeamView(currentTeamGrade);
            announceTeamWeek();
            calendarDisplay.querySelector('#tvPrevWeek')?.focus();
        });
        if (tvNext) tvNext.addEventListener('click', () => {
            const d = new Date(currentTeamWeekStart);
            d.setDate(d.getDate() + 7);
            if (d.getFullYear() > CONFIG.MAX_YEAR) return;
            currentTeamWeekStart = d;
            renderTeamView(currentTeamGrade);
            announceTeamWeek();
            calendarDisplay.querySelector('#tvNextWeek')?.focus();
        });
        if (tvToday) tvToday.addEventListener('click', () => {
            currentTeamWeekStart = getSunday(new Date());
            renderTeamView(currentTeamGrade);
            announceTeamWeek();
        });

        // Scroll hint — show once per device; lsSet marks it seen after first scroll.
        const tableWrap = calendarDisplay.querySelector('.team-table-wrap');
        const scrollHint = calendarDisplay.querySelector('.tv-scroll-hint');
        if (scrollHint && lsGet('myb_team_scroll_seen')) {
            scrollHint.style.display = 'none';
        } else if (tableWrap && scrollHint) {
            tableWrap.addEventListener('scroll', () => {
                scrollHint.style.display = 'none';
                lsSet('myb_team_scroll_seen', '1');
            }, { once: true });
        }

        // Restore scroll: keep position on grade-tab/fetch re-render; scroll today into view on open/week-nav.
        if (prevScrollLeft > 0 && tableWrap) {
            tableWrap.scrollLeft = prevScrollLeft;
        } else if (todayIndex >= 0 && tableWrap) {
            requestAnimationFrame(() => {
                const todayTh = tableWrap.querySelector('th.tv-today-col');
                const nameTh  = tableWrap.querySelector('th.tv-name-col');
                if (todayTh && nameTh) {
                    const wrapLeft  = tableWrap.getBoundingClientRect().left;
                    const cellLeft  = todayTh.getBoundingClientRect().left;
                    const nameWidth = nameTh.getBoundingClientRect().width;
                    tableWrap.scrollLeft = cellLeft - wrapLeft - nameWidth;
                }
            });
        }

        if (!skipFetch) {
            fetchTeamWeekOverrides(weekDates[0], weekDates[6], currentTeamWeekStart.getTime());
        }
    }

    // ── FIRESTORE FETCH ───────────────────────────────────────────────────────

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
                if (shouldReplaceOverride(existing, d)) {
                    // Skip re-render if the display-relevant fields haven't changed
                    // (common when IndexedDB and Firestore return identical data on repeat visits)
                    if (existing && existing.type === d.type && existing.value === d.value) return;
                    rosterOverridesCache.set(cacheKey, d);
                    updated = true;
                }
            });
            if (updated) renderTeamView(currentTeamGrade, { skipFetch: true });
        } catch (err) {
            console.warn('[TeamView] Could not fetch week overrides:', err);
        }
    }

    // ── TOGGLE / CHROME ───────────────────────────────────────────────────────

    /** Toggles between personal calendar and team week view. */
    function toggleTeamView() {
        teamViewMode = !teamViewMode;
        lsSet('myb_team_view', teamViewMode ? '1' : '');

        applyTeamViewChrome();

        if (teamViewMode) {
            _pushOverlayState(toggleTeamView); // Back returns to calendar
            currentTeamWeekStart = getSunday(new Date());
            renderTeamView(currentTeamGrade);
        } else {
            _clearOverlayHistory(); // Remove pushed entry when exiting via button
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
        document.body.classList.toggle('team-view-active', teamViewMode);
    }

    // ── ARIA / ACCESSIBILITY ──────────────────────────────────────────────────

    /** Announces the current team week to screen readers via #ariaAnnouncer. */
    function announceTeamWeek() {
        const announcer = document.getElementById('ariaAnnouncer');
        if (!announcer) return;
        announcer.textContent = '';
        requestAnimationFrame(() => { announcer.textContent = `Week of ${formatTeamWeekLabel(currentTeamWeekStart)}`; });
    }

    // ── CONVENIENCE ───────────────────────────────────────────────────────────

    /** Restores team view on page load when the user was previously in it. */
    function restoreTeamView() {
        teamViewMode = true;
        applyTeamViewChrome();
        renderTeamView(currentTeamGrade);
    }

    /** Jumps to the current week — called from the global Today button when in team view. */
    function jumpToCurrentWeek() {
        currentTeamWeekStart = getSunday(new Date());
        renderTeamView(currentTeamGrade);
        announceTeamWeek();
    }

    // ── PUBLIC API ────────────────────────────────────────────────────────────

    return {
        toggleTeamView,
        applyTeamViewChrome,
        isTeamViewMode:  () => teamViewMode,
        renderTeamView,
        announceTeamWeek,
        restoreTeamView,
        jumpToCurrentWeek,
    };
}
