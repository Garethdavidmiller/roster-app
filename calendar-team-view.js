// @ts-check
/**
 * calendar-team-view.js — Team Week View for index.html.
 *
 * Owns: team view state (mode, current week, grade), grid render, Firestore
 *   override fetch, toggle, chrome updates, ARIA week announcement.
 * Does NOT own: personal calendar rendering, override cache population,
 *   overlay history management (all passed as deps).
 * Edit here for: team grid layout, grade tab logic, week navigation, cell display.
 * Do not edit here for: personal calendar, override cache management, nav structure.
 */

import { CONFIG, teamMembers, DAY_NAMES, MONTH_NAMES, TEAM_GRADES, getBaseShift, escapeHtml, formatISO,
         SHIFT_TIME_REGEX, getShiftKind, isSunday } from './roster-data.js';
import { lsGet, lsSet } from './ls.js';
import { isBeforeMemberStart, parseOtherValue, OTHER_FLAVOURS, resolveEffectiveShift } from './override-utils.js';

// Warn at most once per session per unknown shift type — avoids console spam on every render.
const _unknownShiftWarned = new Set();

/**
 * Initialises the Team Week View.
 *
 * @param {object} deps
 * @param {Map<any,any>} deps.rosterOverridesCache   Shared override cache keyed "memberName|date"
 * @param {Function} deps.ensureOverridesCached  Shared month-fetch machinery (calendar-overrides.js):
 *   ensureOverridesCached(year, month, renderFn) — deduped by fetchedMonths, authoritatively fetches
 *   a month's overrides into the shared cache (or no-ops if already fetched) and calls renderFn on a
 *   fresh fetch. The Team view uses THIS (not its own per-week query) so there is ONE authoritative
 *   fetcher per month — see the eviction-race note on renderTeamView.
 * @param {Function} deps.getSelectedMemberIndex Returns index of logged-in member in teamMembers
 * @param {Function} deps.isFirstRun             True for a brand-new visitor who hasn't picked a name
 * @param {Function} deps.renderCalendar         Called when team view is dismissed
 * @param {Function} deps._pushOverlayState      Registers Back-button close handler
 * @param {Function} deps._clearOverlayHistory   Removes Back-button handler when closing via button
 * @returns {{ toggleTeamView: any, isTeamViewMode: any, restoreTeamView: any, jumpToCurrentWeek: any, refreshFromCache: any }}
 */
export function initTeamView({ rosterOverridesCache, ensureOverridesCached, getSelectedMemberIndex, isFirstRun, renderCalendar,
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
    function getSunday(/** @type {any} */ date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - d.getDay()); // getDay() 0=Sun, so subtract to reach Sunday
        return d;
    }

    /** Returns an array of 7 Date objects Sun–Sat starting from `sunday`. */
    function getTeamWeekDates(/** @type {any} */ sunday) {
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(sunday);
            d.setDate(d.getDate() + i);
            return d;
        });
    }

    /**
     * Returns the effective shift display data for a member on a date,
     * applying any cached Firestore overrides over the base roster.
     * @returns {{ text: string, cls: string, label?: string }}
     */
    function getTeamCellDisplay(/** @type {any} */ member, /** @type {any} */ date) {
        const dateStr  = formatISO(date);
        const cacheKey = `${member.name}|${dateStr}`;

        const baseShiftTV = getBaseShift(member, date);
        const override = !isBeforeMemberStart(member, date) ? rosterOverridesCache.get(cacheKey) : null;
        // ONE shared override→effective-shift ladder (calendar renderer + month legend use it too,
        // v16.48) so the Team view can never disagree with them — including the non-contracted
        // suppression (sick on rest/Sunday, AL/Other on Sunday; the Sunday-AL case fixed v16.37).
        // `shift` is the canonical value; an rdw override arrives as 'RDW' with its time in rdwTime,
        // and an Other day's derived-RDW-ness comes back as derivedRdw.
        const { shift, rdwTime, derivedRdw } = resolveEffectiveShift(override, baseShiftTV, isSunday(dateStr));

        // `label` is the accessible name (used as the cell's aria-label) so meaning
        // never depends on colour alone (the rest cell is just a coloured "–") and
        // decorative emoji aren't read out as part of the shift.
        if (shift === 'RD' || shift === 'OFF') return { text: '–', cls: 'tv-rest', label: 'Rest day' };
        if (shift === 'SPARE')                 return { text: '📋 Spare', cls: 'tv-spare', label: 'Spare' };
        if (shift === 'AL')                    return { text: '🏖️ AL', cls: 'tv-al', label: 'Annual leave' };
        if (shift === 'SICK')                  return { text: '🪑 Absent', cls: 'tv-sick', label: 'Absent' };
        if (shift === 'RDW') {
            // rdw override → shift 'RDW' + its time in rdwTime (a base 'RDW' never exists, so this
            // one path covers every RDW cell — it absorbs the old separate 'RDW|time' branch).
            const t = rdwTime || '';
            return { text: `💼 ${escapeHtml(t) || 'RDW'}`, cls: 'tv-rdw', label: `Rest day worked${t ? ' ' + t : ''}` };
        }
        const _trg = parseOtherValue(shift);
        if (_trg) {
            // 🏷️ + short flavour word in the tiny cell; FULL word in the accessible label
            // (+ RDW/time detail), mirroring the calendar's tap behaviour.
            const f = OTHER_FLAVOURS[_trg.flavour];
            // Derived RDW-ness comes from the shared resolver (explicit flag OR rest-day base) so it
            // matches the calendar + pay engine exactly.
            const label = f.full + (derivedRdw ? ' — Rest Day Worked' : '')
                + (_trg.time ? ` ${_trg.time}` : '');
            return { text: `🏷️ ${f.badge}`, cls: 'tv-other', label };
        }
        if (SHIFT_TIME_REGEX.test(shift)) {
            const shiftKind = getShiftKind(shift, member);
            const EMOJI = { early: '☀️', late: '🌙', night: '🦉' };
            return { text: `${EMOJI[shiftKind]} ${escapeHtml(shift)}`, cls: `tv-${shiftKind}`, label: `${shiftKind} shift ${shift}` };
        }
        if (!_unknownShiftWarned.has(shift)) { _unknownShiftWarned.add(shift); console.warn('[Team view] Unrecognised shift type:', shift); }
        return { text: escapeHtml(shift), cls: '', label: shift };
    }

    /** Formats a Sunday-anchored week as "19–25 May 2026" or "28 Apr – 4 May 2026". */
    function formatTeamWeekLabel(/** @type {any} */ sunday) {
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
            `<th scope="col" class="tv-day-header${i === todayIndex ? ' tv-today-col' : ''}">${DAY_NAMES[i]}<span class="tv-day-num">${d.getDate()}</span></th>`
        ).join('');

        // Identify the logged-in member so their row can be visually distinguished. On first run the
        // member index falls back to the default member — that isn't "my" row, so suppress the
        // highlight until the visitor has actually picked their name. (Onboarding H1.)
        const myIdx  = getSelectedMemberIndex();
        const myName = (!isFirstRun?.() && myIdx >= 0) ? teamMembers[myIdx].name : null;

        const tableBody = gradeMembers.length === 0
            ? `<tr><td colspan="8" class="tv-empty">No staff in this grade</td></tr>`
            : gradeMembers.map(member => {
                const cells = weekDates.map((date, i) => {
                    const { text, cls, label } = getTeamCellDisplay(member, date);
                    const aria = label ? ` aria-label="${escapeHtml(label)}"` : '';
                    return `<td class="tv-cell ${cls}${i === todayIndex ? ' tv-today-col' : ''}"${aria}>${text}</td>`;
                }).join('');
                const myRow = member.name === myName ? ' class="tv-my-row"' : '';
                return `<tr${myRow}><th scope="row" class="tv-name-col">${escapeHtml(member.name)}</th>${cells}</tr>`;
            }).join('');

        const gradeBtns = TEAM_GRADES.map(g =>
            `<button class="grade-tab${g === grade ? ' active' : ''}" role="tab" id="gradeTab-${g}" aria-selected="${g === grade}" tabindex="${g === grade ? '0' : '-1'}" aria-controls="gradeTabPanel" data-grade="${g}">${g}</button>`
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
                <div class="team-table-wrap" id="gradeTabPanel" role="tabpanel" aria-labelledby="gradeTab-${grade}" aria-label="${grade} grade roster — week of ${weekLabel}">
                    <table class="team-table">
                        <thead><tr>
                            <th scope="col" class="tv-name-col">Name</th>${dayHeaders}
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
                const tab = /** @type {Element} */ (e.target).closest('.grade-tab');
                if (tab) renderTeamView(/** @type {HTMLElement} */ (tab).dataset.grade ?? '', { skipFetch: true });
            });
            gradeTabList.addEventListener('keydown', e => {
                const ke = /** @type {KeyboardEvent} */ (e);
                if (ke.key !== 'ArrowRight' && ke.key !== 'ArrowLeft') return;
                e.preventDefault();
                const tabs = [...gradeTabList.querySelectorAll('.grade-tab')];
                const idx  = tabs.findIndex(t => t === document.activeElement);
                if (idx === -1) return;
                const next = /** @type {HTMLElement} */ (tabs[(idx + (ke.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]);
                renderTeamView(next.dataset.grade ?? '', { skipFetch: true });
                /** @type {HTMLElement} */ (calendarDisplay.querySelector(`.grade-tab[data-grade="${next.dataset.grade ?? ''}"]`))?.focus();
            });
        }

        const tvPrev  = calendarDisplay.querySelector('#tvPrevWeek');
        const tvNext  = calendarDisplay.querySelector('#tvNextWeek');
        const tvToday = calendarDisplay.querySelector('#tvToday');
        if (tvPrev) tvPrev.addEventListener('click', () => {
            const d = new Date(currentTeamWeekStart);
            d.setDate(d.getDate() - 7);
            // Clamp on the week's END (Saturday), not its start (v16.23): the week containing
            // 1 Jan of MIN_YEAR starts the previous December (e.g. Sun 31 Dec 2023 for Mon
            // 1 Jan 2024), so a week-start check made 1–6 Jan of MIN_YEAR unreachable.
            const end = new Date(d);
            end.setDate(end.getDate() + 6);
            if (end.getFullYear() < CONFIG.MIN_YEAR) return;
            currentTeamWeekStart = d;
            renderTeamView(currentTeamGrade);
            announceTeamWeek();
            /** @type {HTMLElement} */ (calendarDisplay.querySelector('#tvPrevWeek'))?.focus();
        });
        if (tvNext) tvNext.addEventListener('click', () => {
            const d = new Date(currentTeamWeekStart);
            d.setDate(d.getDate() + 7);
            if (d.getFullYear() > CONFIG.MAX_YEAR) return;
            currentTeamWeekStart = d;
            renderTeamView(currentTeamGrade);
            announceTeamWeek();
            /** @type {HTMLElement} */ (calendarDisplay.querySelector('#tvNextWeek'))?.focus();
        });
        if (tvToday) tvToday.addEventListener('click', () => {
            currentTeamWeekStart = getSunday(new Date());
            renderTeamView(currentTeamGrade);
            announceTeamWeek();
            // The "↩ This week" button is replaced by a non-interactive "This week"
            // badge on the current week, so focus can't return to it. Move focus to a
            // stable control (Next week) instead of letting it drop to <body>.
            /** @type {HTMLElement} */ (calendarDisplay.querySelector('#tvNextWeek'))?.focus();
        });

        // Scroll hint — show once per device; lsSet marks it seen after first scroll.
        const tableWrap = calendarDisplay.querySelector('.team-table-wrap');
        const scrollHint = calendarDisplay.querySelector('.tv-scroll-hint');
        if (scrollHint && lsGet('myb_team_scroll_seen')) {
            /** @type {HTMLElement} */ (scrollHint).style.display = 'none';
        } else if (tableWrap && scrollHint) {
            tableWrap.addEventListener('scroll', () => {
                /** @type {HTMLElement} */ (scrollHint).style.display = 'none';
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
                    // NOTE (v18.90): when today is late in the week this lands mid-column, so a
                    // sliver of the previous day shows beside the sticky name column. Snapping back
                    // to the nearest column start was tried and REVERTED — it pushed today itself
                    // off-screen, and showing today is the whole point of this scroll. At maximum
                    // scroll a partial column somewhere is unavoidable with a sticky first column;
                    // having it fall on the far side, away from today, is the better trade.
                    tableWrap.scrollLeft = cellLeft - wrapLeft - nameWidth;
                }
            });
        }

        if (!skipFetch) {
            ensureTeamWeekCached(weekDates);
        }
    }

    // ── FIRESTORE FETCH ───────────────────────────────────────────────────────

    /**
     * Ensure the shown week's overrides are cached, via the SHARED month-fetch machinery
     * (`ensureOverridesCached`) rather than an independent per-week query.
     *
     * WHY (the "team view sometimes loses overrides on click-through" bug): the old per-week fetch
     * called `reconcileRangeIntoCache` directly, which is AUTHORITATIVE for its range — it evicts any
     * in-range cache key its snapshot omits. That made TWO authoritative reconcilers race on the same
     * dates: the initial 3-month fetch would load + render this week's overrides, then the team-week
     * fetch would resolve LATER with a staler/emptier snapshot (Firestore served it from the
     * not-yet-synced local cache) and EVICT them, wiping the grid back to the base roster.
     * `ensureOverridesCached` is deduped by `fetchedMonths`, so a month already owned by the calendar
     * fetch is a no-op here (the cache already holds its data — no re-query, no eviction) and only a
     * genuinely un-fetched month (e.g. a week navigated outside the 3-month window) triggers one
     * authoritative fetch. `refreshFromCache` repaints the CURRENT week/grade from cache (focus-
     * preserving, and a no-op once team view is exited), so a late fetch can never render a stale week
     * — which also subsumes the old fetch-token guard. A Sun–Sat week can straddle two months, so
     * ensure each distinct month the week touches.
     * @param {Date[]} weekDates  the 7 Sun–Sat dates of the shown week
     */
    function ensureTeamWeekCached(weekDates) {
        const seen = new Set();
        for (const d of weekDates) {
            const key = `${d.getFullYear()}-${d.getMonth()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            ensureOverridesCached(d.getFullYear(), d.getMonth(), refreshFromCache);
        }
    }

    /**
     * Re-render the grid from the ALREADY-populated shared cache, no re-fetch (v18.21). Called by the
     * initial 3-month fetch's success path when team view is active, and by `ensureTeamWeekCached`
     * when a month it needed has just landed. `skipFetch` avoids a redundant query / fetch↔render
     * loop. Focus preservation (v18.22, same v16.69 pattern): this async repaint can land right after
     * a keyboard navigation restored focus, and without capture/restore it dropped focus to <body>.
     */
    function refreshFromCache() {
        if (!teamViewMode) return;
        const _display  = document.getElementById('calendarDisplay');
        const _activeId = document.activeElement instanceof HTMLElement
            && _display?.contains(document.activeElement) ? document.activeElement.id : null;
        renderTeamView(currentTeamGrade, { skipFetch: true });
        if (_activeId) document.getElementById(_activeId)?.focus({ preventScroll: true });
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
            _clearOverlayHistory(toggleTeamView); // Remove THIS overlay's pushed entry when exiting via button
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
        if (navRow)  /** @type {HTMLElement} */ (navRow).style.display = teamViewMode ? 'none' : '';
        if (legend)  /** @type {HTMLElement} */ (legend).style.display = teamViewMode ? 'none' : '';
        // The same #calendarDisplay region holds a 7-day team table in team view — keep its
        // accessible name honest for screen-reader users instead of always saying "calendar".
        const display = document.getElementById('calendarDisplay');
        if (display) display.setAttribute('aria-label', teamViewMode ? 'Team week roster' : 'Monthly roster calendar');
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
        // Push the same Back-handler the toggle path uses (v16.16). Without it, a user who
        // relaunches the PWA into team view has no history entry for hardware Back to consume,
        // so Back exits the app instead of returning to the month calendar — inconsistent with
        // entering team view via the toggle.
        _pushOverlayState(toggleTeamView);
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
        isTeamViewMode:  () => teamViewMode,
        restoreTeamView,
        jumpToCurrentWeek,
        refreshFromCache,
    };
}
