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
    getWeekNumberForDate, getRosterForMember, resolveMemberRoster, getBaseShift, formatISO, isSunday, isWorkedShift,
    SWIPE_THRESHOLD, SWIPE_VELOCITY, paydayForCutoff, escapeHtml,
} from './roster-data.js';
import { isBeforeMemberStart, isOtherValue, parseOtherValue, OTHER_FLAVOURS, resolveEffectiveShift } from './override-utils.js';
import { getCurrentMember } from './calendar-member.js';
import { rosterOverridesCache, monthKey } from './calendar-overrides.js';
import { knowledgeOf, decideDisplay } from './calendar-data-state.js';

const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SHIFT_KIND_LABELS = { early: 'Early shift', late: 'Late shift', night: 'Night shift' };

/**
 * WHO changed a day, in one short line — or nothing.
 *
 * The two answers are not the same shape. A ROSTER UPLOAD is the weekly roster arriving: the
 * `changedBy` on those documents is whoever ran the upload, and naming them would say they chose
 * the shift, which they did not. A MANUAL change is a person's decision, and that person is the one
 * to ask about it.
 *
 * Returns '' when the document cannot say — legacy rows written before `changedBy` existed. An
 * absent line is honest; a guessed name is not, and this one names a colleague.
 *
 * @param {string|undefined} source     'manual' | 'roster_import'
 * @param {string|undefined} changedBy  the writer's member name
 * @returns {string}
 */
export function changeProvenance(source, changedBy) {
    if (source === 'roster_import') return 'From the weekly roster';
    return changedBy ? `Changed by ${changedBy}` : '';
}

/**
 * The full words for a shift value — what the tooltip, the aria-label and the day-detail panel say.
 *
 * ONE function because there are now TWO callers: the shift a member is actually working, and (from
 * v22.64) the base-roster shift an override replaced. Two copies of this ladder would eventually
 * disagree about the same value, which on this panel would read as two different days.
 *
 * `alwaysTime` is what the base-roster line passes. A member with a `permanentShift` gets "Early
 * shift" with no time, because their badge never varies and the time would be noise — but the base
 * line exists precisely to answer "what was I rostered for?", where the time IS the answer. Without
 * it a permanent-early member whose 06:20 became 07:00 would read "Changed from Early shift".
 *
 * @param {string} shift    the shift value (base or effective)
 * @param {any}    member   the member record — `permanentShift` decides whether the time is implied
 * @param {boolean} derivedRdw  an Other day the override ladder derived as rest-day-worked
 * @param {boolean} [alwaysTime] state the time even when `permanentShift` would imply it
 * @returns {string}
 */
export function shiftWords(shift, member, derivedRdw, alwaysTime = false) {
    if (shift === 'RD' || shift === 'OFF') return 'Rest day';
    if (shift === 'SPARE') return 'Spare day';
    if (shift === 'AL')    return 'Annual leave';
    if (shift === 'SICK')  return 'Absent';
    if (shift === 'RDW')   return 'Rest day worked';
    const other = parseOtherValue(shift);
    if (other) {
        return OTHER_FLAVOURS[other.flavour].full
            + ((other.rdw || derivedRdw) ? ' — Rest Day Worked' : '')
            + (other.time ? ` ${other.time}` : '');
    }
    return SHIFT_KIND_LABELS[getShiftKind(shift, member)]
        + ((member.permanentShift && !alwaysTime) ? '' : ` ${shift}`);
}

/**
 * Builds the HTML string for the calendar's month/week header.
 * Pure — takes explicit params, reads no global state.
 */
export function createCalendarHeader(/** @type {any} */ firstWeekNum, /** @type {any} */ lastWeekNum, /** @type {any} */ weekPrefix, /** @type {any} */ month, /** @type {any} */ year) {
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
            // En-dash for the range (v18.19) — matches the Team Week View's "19–25 July" strip;
            // the ASCII hyphen was the app's one range rendered with the wrong dash.
            weekDisplay = `· ${pluralPrefix} ${firstWeekNum}–${lastWeekNum}`;
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
export function createDayCell(/** @type {any} */ date, /** @type {any} */ shift, /** @type {any} */ permanentShift, /** @type {any} */ isWorkedDay, rdwTime = '') {
    // RDW and Other days use rdwTime as a side-channel display string (shift itself is a
    // sentinel: 'RDW', or an Other-family value like 'TRG RDW'). Both always keep their OWN
    // badge regardless of permanentShift — distinct pay/day categories, never Early/Late.
    const isOther = isOtherValue(shift);
    let badge;
    if (shift !== 'RDW' && !isOther && isWorkedDay && permanentShift === 'late') {
        badge = '<span class="shift-badge badge-late"><span aria-hidden="true">🌙</span><span>Late</span></span>';
    } else if (shift !== 'RDW' && !isOther && isWorkedDay && permanentShift === 'early') {
        badge = '<span class="shift-badge badge-early"><span aria-hidden="true">☀️</span><span>Early</span></span>';
    } else {
        badge = getShiftBadge(shift);
    }
    const displayTime = (shift === 'RDW' || isOther) ? rdwTime : shift;
    // Escape the override value BEFORE inserting the intentional <wbr> — the value can be an
    // unvalidated legacy/Admin-SDK Firestore value, and this goes into innerHTML (the team view
    // escapes the same field). Word-break after the hyphen so "06:20-14:20" wraps as "06:20-"/"14:20".
    const displayTimeHtml = displayTime ? escapeHtml(displayTime).replace('-', '-<wbr>') : '';
    return `
        <div class="day-number">${date.getDate()}</div>
        ${badge}
        ${isWorkedDay && (!permanentShift || shift === 'RDW' || isOther) && displayTimeHtml ? `<div class="shift-time">${displayTimeHtml}</div>` : ''}
    `;
}

/**
 * Calculate swipe direction from pointer coordinates.
 * Returns 'left', 'right', or null if the gesture doesn't qualify.
 * Commits if distance ≥ SWIPE_THRESHOLD OR velocity ≥ SWIPE_VELOCITY (fast flick).
 */
export function getSwipeDirection(/** @type {any} */ startX, /** @type {any} */ startY, /** @type {any} */ endX, /** @type {any} */ endY, /** @type {any} */ elapsed) {
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
 * The grid we draw INSTEAD of the month when its overrides are not known yet (v20.40).
 *
 * Deliberately not a skeleton of the real grid. `.calendar-fetching` already shimmers the cells
 * during the initial fetch and it does not work for this: the shift times stay perfectly legible
 * underneath it, so it reads as "loading, and here is your roster" when the truthful message is
 * "this is not your roster yet". A cell that might be wrong must not be on screen at all.
 *
 * The copy names what is missing rather than saying "loading", because that is the part a member
 * needs in order to judge the screen — a rest day drawn without its overrides looks exactly like a
 * rest day, and only the absent leave/absence/shift-change layer makes the difference.
 *
 * @param {'loading'|'unavailable'} display
 * @param {() => void} [onRetry]  omit to draw no button (see buildCalendarContainer's opts)
 * @returns {HTMLElement}
 */
function buildGridPlaceholder(display, onRetry) {
    const panel = document.createElement('div');
    const failed = display === 'unavailable';
    panel.className = `calendar-pending${failed ? ' calendar-pending--failed' : ''}`;
    // status vs alert: a wait is a passing condition and must not interrupt, a failure is the end of
    // the road for this month and should be spoken when it happens.
    panel.setAttribute('role', failed ? 'alert' : 'status');
    panel.innerHTML = failed
        ? '<div class="calendar-pending-emoji" aria-hidden="true">⚠️</div>'
          + '<h2>Couldn\'t check this month</h2>'
          + '<p>Your annual leave, absences and shift changes couldn\'t be loaded, so this month '
          + 'isn\'t being shown — the rota underneath it may be out of date.</p>'
        : '<div class="calendar-pending-emoji" aria-hidden="true">⏳</div>'
          + '<h2>Checking this month</h2>'
          + '<p>Loading your annual leave, absences and shift changes.</p>';
    if (failed && onRetry) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'calendar-pending-retry';
        btn.textContent = 'Try again';
        btn.addEventListener('click', () => onRetry());
        panel.appendChild(btn);
    }
    return panel;
}

/**
 * Builds and returns a fully populated calendar-container div.
 * Accepts explicit month/year so callers never need to mutate global display state.
 * @param {number} month - 0-indexed JS month
 * @param {number} year
 * @param {{ navigateToPaycalc?: Function, onDayDetail?: Function, onRetryMonth?: Function }} [opts]
 *   navigateToPaycalc — called when a payday/cutoff cell is tapped
 *   onDayDetail       — called when any other cell is tapped on touch devices
 *   onRetryMonth      — called as (year, month) from the "Try again" button of the withheld-grid
 *                       panel. Omitted by callers that have no fetch to re-run (the swipe carousel's
 *                       off-screen panels), in which case no button is drawn — an inert control is
 *                       worse than none.
 */
export function buildCalendarContainer(month, year, opts = {}) {
    const { navigateToPaycalc, onDayDetail, onRetryMonth } = opts;
    const member = /** @type {any} */ (getCurrentMember());
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

    // A rosterChanges transition mid-month puts firstDay and lastDay on DIFFERENT rosters, so
    // firstWeekNum and lastWeekNum come from two different numbering schemes and a "Weeks X–Y" range
    // is nonsensical (e.g. "CEA Weeks 6–2", conflating a rotation week with a fixed-pattern id).
    // Detect it from the resolved roster descriptor at each month end (rosterType OR currentWeek
    // differs) and suppress the week label for that one month — every day cell is still resolved
    // per-date and correct. No-op for the vast majority (no rosterChanges → same descriptor).
    const rFirst = member ? resolveMemberRoster(member, firstDay) : null;
    const rLast  = member ? resolveMemberRoster(member, lastDay)  : null;
    const isTransitionMonth = !!(rFirst && rLast)
        && (rFirst.rosterType !== rLast.rosterType || rFirst.currentWeek !== rLast.currentWeek);
    const weekPrefix = isTransitionMonth ? '' : roster.weekPrefix;

    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML = createCalendarHeader(firstWeekNum, lastWeekNum, weekPrefix, month, year);
    calendarContainer.appendChild(header);

    // ── May this month's shifts be drawn at all? (v20.40) ───────────────────────────────────────
    //
    // The base roster below is computed locally and is therefore always available — and for anybody
    // with leave, an absence, a changed shift or an RDW it is WRONG. Those live only in Firestore.
    // Until a read has settled for this month, drawing the grid states something the app does not
    // know. See calendar-data-state.js for the four states and why `cached` is not one of the two
    // that withhold.
    //
    // The HEADER is deliberately built first and kept in every state: it carries the month label and
    // it is the mount point for the sync chip (calendar-initial-fetch.js watches for it). Withholding
    // the header as well would take the retry away in exactly the states that need one.
    const _display = decideDisplay(knowledgeOf(monthKey(year, month)));
    calendarContainer.dataset.overrideState = _display;
    if (_display === 'loading' || _display === 'unavailable') {
        calendarContainer.appendChild(buildGridPlaceholder(_display,
            // Wrapped only when there IS one — an always-defined arrow would make the panel
            // draw a button that calls nothing on the callers that deliberately omit it.
            onRetryMonth ? () => onRetryMonth(year, month) : undefined));
        return calendarContainer;
    }

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    // Single delegated click listener — replaces per-cell listener attachment.
    grid.addEventListener('click', (e) => {
        const cell = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.calendar-day'));
        // Exclude the greyed adjacent-month filler cells (v16.23): they carry no data-detail-*
        // attributes (and are aria-hidden), so a touch tap opened a BLANK day-detail lightbox.
        if (!cell || cell.classList.contains('other-month')) return;
        // Desktop: a click on a pay-marked cell jumps straight to the calculator (the hover tooltip
        // already showed it's a payday/cut-off). Touch has no hover, so a bare tap there used to
        // teleport to paycalc with no warning — instead open the day-detail lightbox, which offers an
        // explicit "View pay estimate" button for pay-marked days (v16.57).
        if (!window.matchMedia('(pointer: coarse)').matches) {
            const paydayIso = cell.dataset.paydayIso;
            if (paydayIso) { navigateToPaycalc?.(paydayIso); return; }
            const cutoffIso = cell.dataset.cutoffIso;
            if (cutoffIso) { const payday = paydayForCutoff(cutoffIso); if (payday) navigateToPaycalc?.(payday); }
            return;   // desktop non-pay cell: nothing (the hover tooltip covers the detail)
        }
        onDayDetail?.(cell);
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
        // for Dec 25, while Dec 26 (Boxing Day) can still become RDW for overtime. Resolved
        // via the ONE shared ladder (shared with Team view + the month legend, v16.48) so the
        // three consumers can never disagree. An Other day keeps its raw grammar value in
        // `shift` (the badge + label parse it); rdwTime/otherDerivedRdw drive the hours slot.
        const dateStr = formatISO(currentDate);
        const override = !isBeforeMemberStart(member, currentDate) ? rosterOverridesCache.get(`${member.name}|${dateStr}`) : null;
        // WHAT THE ROSTER SAID BEFORE THE CHANGE (v22.64). Captured here because the next line
        // overwrites `shift` with the effective value, and the base is then unrecoverable — the
        // day-detail panel could show "Early shift 07:00-16:00" with no way to tell whether that
        // was the rostered turn or a shift given on a SPARE week, which are different weeks of
        // somebody's life. `getBaseShift` has already applied start-date suppression, the
        // Christmas rules and any scheduled roster change, so this is the member's real base.
        const baseShift = shift;
        const { shift: _effShift, rdwTime, derivedRdw: otherDerivedRdw } =
            resolveEffectiveShift(override, shift, isSunday(dateStr));
        shift = _effShift;

        const isWorkedDay = isWorkedShift(shift);
        const shiftClass = shift === 'RDW' || isOtherValue(shift)          ? getShiftClass(shift)
                         : isWorkedDay && member.permanentShift === 'late'  ? 'late-shift'
                         : isWorkedDay && member.permanentShift === 'early' ? 'early-shift'
                         : getShiftClass(shift);
        const dayCell = document.createElement('div');
        dayCell.className = `calendar-day ${shiftClass}`;
        dayCell.setAttribute('role', 'button');

        // The FULL word on tap/tooltip/aria (the badge carries the short one). Shared with the
        // base-roster line below, so the two can never describe the same value differently.
        const shiftLabel = shiftWords(shift, member, otherDerivedRdw);

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
        dayCell.dataset.tooltip = ttParts.join(' · ');
        // Structured pieces for the tap-to-view day-detail lightbox (touch devices).
        dayCell.dataset.detailDay   = `${fullDayNames[currentDate.getDay()]} ${currentDate.getDate()} ${MONTH_NAMES[month]} ${year}`;
        dayCell.dataset.detailShift = ttShift;
        // Compared on the VALUES, not the words: a permanent-early member's 06:20 and 07:00 both
        // read "Early shift", so comparing labels would hide exactly the change worth stating.
        // A suppressed override resolves back to the base, so it correctly produces no line.
        if (baseShift !== shift) {
            dayCell.dataset.detailBase = shiftWords(baseShift, member, false, true);
            // The raw VALUES, not rendered badges: the panel derives colour and emoji from
            // `shiftBadgeParts`, so it cannot give a shift a different colour from the cell that
            // was tapped — and nothing writes markup out of a `data-` attribute.
            dayCell.dataset.detailBaseShift = baseShift;
            dayCell.dataset.detailNowShift  = shift;
            const by = changeProvenance(override?.source, override?.changedBy);
            if (by) dayCell.dataset.detailBy = by;
        }
        if (extras)       dayCell.dataset.detailExtras = extras;

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
