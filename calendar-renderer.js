// @ts-check
/**
 * calendar-renderer.js — Calendar cell and container building for index.html.
 *
 * Owns: createCalendarHeader, createDayCell, getSwipeDirection,
 *   buildCalendarContainer.
 * Does NOT own: display state (calendar-app.js), override fetching (calendar-overrides.js),
 *   member selection (calendar-member.js).
 * Edit here for: day cell HTML, calendar grid structure, month header, swipe math.
 */

import {
    DAY_NAMES, MONTH_NAMES,
    isSameDay, isBankHoliday, isChristmasDay, isEasterSunday,
    isPayday, isCutoffDate, getShiftKind, getShiftClass, getShiftBadge,
    getWeekNumberForDate, getRosterForMember, getBaseShift, formatISO, isSunday,
    SWIPE_THRESHOLD, SWIPE_VELOCITY, getPaydaysAndCutoffs,
} from './roster-data.js';
import { isBeforeMemberStart } from './app-override-utils.js';
import { getCurrentMember } from './calendar-member.js';
import { rosterOverridesCache } from './calendar-overrides.js';

const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SHIFT_KIND_LABELS = { early: 'Early shift', late: 'Late shift', night: 'Night shift' };

/**
 * Builds the HTML string for the calendar's month/week header.
 * Pure — takes explicit params, reads no global state.
 */
export function createCalendarHeader(firstWeekNum, lastWeekNum, weekPrefix, month, year) {
    let weekDisplay = '';
    if (weekPrefix !== '') {
        if (firstWeekNum === lastWeekNum) {
            weekDisplay = `· ${weekPrefix} ${firstWeekNum}`;
        } else {
            // Build plural: append 's' to the last word of the prefix
            // "CEA Week" → "CEA Weeks", "BL Week" → "BL Weeks"
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

/**
 * Builds the inner HTML for a single day cell. Pure — takes explicit params.
 * rdwTime — actual shift time for RDW overrides, since shift='RDW' sentinel.
 */
export function createDayCell(date, shift, permanentShift, isWorkedDay, rdwTime = '') {
    let badge;
    // RDW always gets its own badge regardless of permanentShift — it's a distinct pay category
    if (shift !== 'RDW' && isWorkedDay && permanentShift === 'late') {
        badge = '<span class="shift-badge badge-late"><span aria-hidden="true">🌙</span><span>Late</span></span>';
    } else if (shift !== 'RDW' && isWorkedDay && permanentShift === 'early') {
        badge = '<span class="shift-badge badge-early"><span aria-hidden="true">☀️</span><span>Early</span></span>';
    } else {
        badge = getShiftBadge(shift);
    }
    const displayTime = shift === 'RDW' ? rdwTime : shift;
    // Word-break after the hyphen so "06:20-14:20" breaks as "06:20-" / "14:20" on narrow cells.
    const displayTimeHtml = displayTime ? displayTime.replace('-', '-<wbr>') : '';
    return `
        <div class="day-number">${date.getDate()}</div>
        ${badge}
        ${isWorkedDay && !permanentShift && displayTimeHtml ? `<div class="shift-time">${displayTimeHtml}</div>` : ''}
    `;
}

/**
 * Calculate swipe direction from pointer coordinates.
 * Returns 'left', 'right', or null if the gesture doesn't qualify.
 * Commits if distance ≥ SWIPE_THRESHOLD OR velocity ≥ SWIPE_VELOCITY (fast flick).
 */
export function getSwipeDirection(startX, startY, endX, endY, elapsed) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    // Swipe must be mostly horizontal (< 30° from horizontal axis)
    const angle = Math.abs(Math.atan2(deltaY, deltaX) * 180 / Math.PI);
    const isHorizontal = angle < 30 || angle > 150;
    if (!isHorizontal) return null;
    const distance = Math.abs(deltaX);
    const velocity = elapsed > 0 ? distance / elapsed : 0;
    if (distance < SWIPE_THRESHOLD && velocity < SWIPE_VELOCITY) return null;
    return deltaX > 0 ? 'right' : 'left';
}

/**
 * Builds and returns a fully populated calendar-container div.
 * Accepts explicit month/year so callers never need to mutate global display state.
 * @param {number} month - 0-indexed JS month
 * @param {number} year
 * @param {{ navigateToPaycalc?: Function, onDayDetail?: Function }} [opts]
 *   navigateToPaycalc — called when a payday/cutoff cell is tapped
 *   onDayDetail       — called when any other cell is tapped on touch devices
 */
export function buildCalendarContainer(month, year, opts = {}) {
    const { navigateToPaycalc, onDayDetail } = opts;
    const member = getCurrentMember();
    const firstDay = new Date(year, month, 1);
    const lastDay  = new Date(year, month + 1, 0);
    // Resolve the roster descriptor for the displayed month so the week-prefix
    // label (e.g. "CES Week") follows any scheduled rosterChanges transition.
    const roster = getRosterForMember(member, firstDay);
    const today = new Date();
    const calendarContainer = document.createElement('div');
    calendarContainer.className = 'calendar-container';

    const firstWeekNum = getWeekNumberForDate(firstDay, member);
    const lastWeekNum  = getWeekNumberForDate(lastDay,  member);

    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML = createCalendarHeader(firstWeekNum, lastWeekNum, roster.weekPrefix, month, year);
    calendarContainer.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    // Single delegated click listener — replaces per-cell listener attachment.
    grid.addEventListener('click', (e) => {
        const cell = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.calendar-day'));
        if (!cell) return;
        const paydayIso = cell.dataset.paydayIso;
        if (paydayIso) { navigateToPaycalc?.(paydayIso); return; }
        const cutoffIso = cell.dataset.cutoffIso;
        if (cutoffIso) {
            // Look up the payday paired with this cutoff rather than using a fixed offset —
            // paydays shift backwards over bank holidays so the gap is not constant.
            const cutoffYear = Number(cutoffIso.slice(0, 4));
            const { paydays, cutoffs } = getPaydaysAndCutoffs(cutoffYear);
            const idx = cutoffs.findIndex(c => formatISO(c) === cutoffIso);
            if (idx !== -1) navigateToPaycalc?.(formatISO(paydays[idx]));
            return;
        }
        // Any other in-month cell: on touch devices open the day-detail lightbox.
        if (window.matchMedia('(pointer: coarse)').matches) onDayDetail?.(cell);
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

        // getBaseShift handles: Christmas RD, startDate suppression, roster lookup.
        let shift = getBaseShift(member, currentDate);

        // Firestore override — applied after the Christmas check so the base rule holds
        // for Dec 25, while Dec 26 (Boxing Day) can still become RDW for overtime.
        let overrideNote = '';
        let rdwTime = '';
        const dateStr = formatISO(currentDate);
        {
            const override = !isBeforeMemberStart(member, currentDate) ? rosterOverridesCache.get(`${member.name}|${dateStr}`) : null;
            if (override) {
                if (override.type === 'rdw') {
                    rdwTime = override.value;
                    shift   = 'RDW';
                    overrideNote = override.note;
                } else if (override.type === 'sick' && (shift === 'RD' || shift === 'OFF' || isSunday(dateStr))) {
                    // Sick override on a base rest day, or ANY Sunday — suppress it.
                    // Rule: see CLAUDE.md — "Sundays are non-contracted" (layer 5: display suppression)
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
        dayCell.setAttribute('role', 'button');

        const shiftLabel = shift === 'RD' || shift === 'OFF' ? 'Rest day'
            : shift === 'SPARE' ? 'Spare day'
            : shift === 'AL'    ? 'Annual leave'
            : shift === 'SICK'  ? 'Absence'
            : shift === 'RDW'   ? 'Rest day worked'
            : SHIFT_KIND_LABELS[getShiftKind(shift, member)]
                + (member.permanentShift ? '' : ` ${shift}`);

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
        // Structured pieces for the tap-to-view day-detail lightbox (touch devices).
        dayCell.dataset.detailDay   = `${fullDayNames[currentDate.getDay()]} ${currentDate.getDate()} ${MONTH_NAMES[month]} ${year}`;
        dayCell.dataset.detailShift = ttShift;
        if (extras)       dayCell.dataset.detailExtras = extras;
        if (overrideNote) dayCell.dataset.detailNote   = overrideNote;

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

        dayCell.innerHTML = createDayCell(currentDate, shift, member.permanentShift, isWorkedDay, rdwTime);
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
