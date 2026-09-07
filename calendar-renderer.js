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
    isPayday, isCutoffDate, getShiftKind, getShiftClass, getShiftBadge, shiftBadgeParts,
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
 * **"LAST SAVED BY", NOT "CHANGED BY"** (v22.79, external review). `changedBy` is whoever wrote the
 * document that is currently winning — the LATEST writer, which is not always the person who made
 * the substantive change. A manager moving 06:20 to 07:00 is the author; a second manager whose
 * range booking later lands the same 07:00 on that day rewrites the document and takes over the
 * name. That is not hypothetical — v22.71 fixed the cache precisely so the panel REFRESHES on a
 * same-value re-save by a different person, which is that case reproduced.
 *
 * The old wording claimed authorship and was wrong in exactly that case, sending a member to ask
 * somebody who would say they had changed nothing. "Last saved by" is true in both, and its "last"
 * carries the useful signal the shorter phrasing loses: there may have been earlier edits. It is
 * the same discipline as `getALEntitlement` returning null rather than a plausible figure belonging
 * to somebody else — where the app cannot say the stronger thing, it says the weaker one.
 *
 * @param {string|undefined} source     'manual' | 'roster_import'
 * @param {string|undefined} changedBy  the writer's member name
 * @returns {string}
 */
export function changeProvenance(source, changedBy) {
    if (source === 'roster_import') return 'From the weekly roster';
    return changedBy ? `Last saved by ${changedBy}` : '';
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
    // A VALUE THE APP ITSELF CANNOT READ IS NOT A LATE SHIFT (v22.89).
    //
    // The ladder below has no branch for "I don't know": `getShiftKind` calls everything that is
    // not an early or a night a LATE, so an unparseable value came back as "Late shift SEE NATHAN"
    // — a confident, wrong name, on the one day the member tapped BECAUSE it looked wrong. The cell
    // beside it wears ❓ Unknown from `shiftBadgeParts`, so the two surfaces stated different
    // things about the same day and only one of them admitted to not knowing.
    //
    // Asked of `shiftBadgeParts` rather than re-tested here, because that function is already the
    // one authority on what a value IS, and a second regex would be free to disagree with it. The
    // raw value is kept: a real Supervisor roster says "SEE NATHAN", and that is information a
    // member can act on where "not recognised" alone is not.
    if (shiftBadgeParts(shift).cls === 'badge-unknown') return `Not recognised: ${shift}`;
    return SHIFT_KIND_LABELS[getShiftKind(shift, member)]
        + ((member.permanentShift && !alwaysTime) ? '' : ` ${shift}`);
}

/**
 * THE SHIFT LINE, SPLIT SO A TIME CANNOT BREAK IN HALF.
 *
 * "Early shift 07:00-16:00" is one string, and at 320px the day panel has ~240px of content width —
 * so it wraps, and a browser will happily break at the hyphen INSIDE the value, leaving
 * "Early shift 07:00-" above "16:00". A shift time split across two lines is not a slightly worse
 * line break; it is a number that no longer reads as a number. Measured at 320 x 700, not reasoned.
 *
 * Splitting here rather than in the panel keeps it pure and testable, and keeps the ONE regex that
 * knows what a time looks like out of a view module. The words keep any trailing clause the Other
 * grammar adds ("Training — Rest Day Worked"), because only the final `HH:MM-HH:MM` is atomic.
 *
 * @param {string} text a rendered shift line from `shiftWords` (+ any RDW time the caller appended)
 * @returns {{ words: string, time: string }} `time` is '' when the line carries none
 */
export function splitShiftLine(text) {
    const m = /\s(\d{1,2}:\d{2}-\d{1,2}:\d{2})$/.exec(text || '');
    return m ? { words: (text || '').slice(0, m.index), time: m[1] } : { words: text || '', time: '' };
}

/**
 * WHAT IS TRUE OF THIS DATE — the day markers, as icon + name, in one authority.
 *
 * The icons are the calendar cell's OWN markers, not a second vocabulary invented for the panel:
 * ⭐ bank holiday, 💷 payday, ✂️ cut-off, 🐣 Easter Sunday, 🎄 Christmas Day, all declared as
 * `::before`/`::after` content in `index.css`. That matters because the panel is where a member
 * goes to ask "what is that star on the cell?" — and until v22.70 it answered by naming the day in
 * a comma-joined gold sentence with the star nowhere in it. The one place the legend is read was
 * the one place the legend was absent.
 *
 * `Today` gets a glyph of its own rather than being left bare: it is the only marker with no cell
 * icon (the cell tints its day number instead), so a chip row where one chip alone had no icon
 * would read as a chip that failed to load.
 *
 * The ORDER is deliberate and is not the cell's z-order: the date's own identity first (Christmas,
 * Easter, bank holiday), then Today, then the pay facts — a member reading downwards gets what the
 * day IS before what it PAYS. Boxing Day is deliberately absent, matching the cell, which is left
 * plain so 26 December still reads as an overtime opportunity (index.css says so beside the 🎄).
 *
 * Pure — it takes booleans, not a date, so the caller's existing `is*` calls are not repeated and
 * this cannot disagree with the classes the same call sites set on the cell.
 *
 * @param {{isToday?:boolean, isBH?:boolean, isXmas?:boolean, isEaster?:boolean, isPay?:boolean, isCutoff?:boolean}} f
 * @returns {{icon:string, label:string}[]}
 */
export function dayMarkers(f) {
    const out = [];
    if (f.isXmas)   out.push({ icon: '🎄', label: 'Christmas Day' });
    if (f.isEaster) out.push({ icon: '🐣', label: 'Easter Sunday' });
    if (f.isBH)     out.push({ icon: '⭐', label: 'Bank holiday' });
    if (f.isToday)  out.push({ icon: '📍', label: 'Today' });
    if (f.isPay)    out.push({ icon: '💷', label: 'Payday' });
    if (f.isCutoff) out.push({ icon: '✂️', label: 'Cut-off date' });
    return out;
}

/**
 * WHICH ROSTER WEEK THIS DATE FALLS IN — the panel's half of the header's week note.
 *
 * The month header carries "CEA Weeks 12–16", and on a phone that context is gone the moment the
 * day panel opens over it. One DATE resolves to exactly one week, so the panel can state precisely
 * what the header can only give as a range.
 *
 * TWO THINGS THIS MUST NOT DO, both of them one careless line away:
 *
 *   · **Never state a week for a FIXED line.** `getWeekNumberForDate` returns `currentWeek` for a
 *     fixed roster — which names WHICH FIXED PATTERN the member sits on, not a position in a
 *     rotation. Printed as "Week 2" it reads as the second week of a cycle that does not exist.
 *     `weekPrefix` is `''` for exactly those members, and that is the same test the header makes,
 *     so the two surfaces cannot disagree about who has a week at all.
 *   · **Resolve per DATE, never from the member's base fields.** Both calls below apply
 *     `resolveMemberRoster`, so a member with a scheduled `rosterChanges` move gets the roster they
 *     are actually on that day.
 *
 * The second point is also where the panel EARNS its place rather than repeating the header: in a
 * transition month the header suppresses the week label altogether (`isTransitionMonth` — one month
 * spanning two numbering schemes cannot honestly be written as a range), and the panel is then the
 * only place the week is available.
 *
 * @param {any} member the team member record
 * @param {Date} date  the date whose week is wanted
 * @returns {string} e.g. `'CEA Week 15'` — or `''` where the member has no rotating week
 */
export function weekContext(member, date) {
    if (!member || !date) return '';
    const { weekPrefix } = getRosterForMember(member, date);
    if (!weekPrefix) return '';
    return `${weekPrefix} ${getWeekNumberForDate(date, member)}`;
}

/**
 * Builds the HTML string for the calendar's month/week header.
 * Pure — takes explicit params, reads no global state.
 */
export function createCalendarHeader(/** @type {any} */ firstWeekNum, /** @type {any} */ lastWeekNum, /** @type {any} */ weekPrefix, /** @type {any} */ month, /** @type {any} */ year) {
    let weekDisplay = '';
    if (weekPrefix !== '') {
        if (firstWeekNum === lastWeekNum) {
            weekDisplay = `${weekPrefix} ${firstWeekNum}`;
        } else {
            // Build plural: append 's' to the last word of the prefix
            // "CEA Week" → "CEA Weeks", "BL Week" → "BL Weeks"
            const lastSpaceIdx = weekPrefix.lastIndexOf(' ');
            const pluralPrefix = lastSpaceIdx !== -1
                ? weekPrefix.slice(0, lastSpaceIdx + 1) + weekPrefix.slice(lastSpaceIdx + 1) + 's'
                : weekPrefix + 's';
            // En-dash for the range (v18.19) — matches the Team Week View's "19–25 July" strip;
            // the ASCII hyphen was the app's one range rendered with the wrong dash.
            weekDisplay = `${pluralPrefix} ${firstWeekNum}–${lastWeekNum}`;
        }
    }
    // No "·" between the month and the week note (v22.87): the note's smaller grey type already
    // sets it apart, and the dot was 8px of the budget that keeps a 360px phone on one line.
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
            // The return value is IGNORED here, and that is the right answer rather than an
            // oversight (v23.07). `navigateToPaycalc` declines on a colleague's calendar or a
            // PIN-unlocked screen, and a declined click then does what a click on EVERY OTHER
            // desktop cell already does — nothing, because the hover tooltip is the desktop
            // route to a day's detail. The keyboard is the case that needs the answer, and it
            // takes it; see calendar-keyboard.js's Enter branch.
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
        // Before the member joined, `getBaseShift` has already suppressed the shift and no override
        // may apply — so this day has no roster at all. Kept as a NAMED value because the "As
        // rostered" branch below needs the same answer, and re-asking would be a second place for
        // the two to disagree.
        const preStart = isBeforeMemberStart(member, currentDate);
        const override = !preStart ? rosterOverridesCache.get(`${member.name}|${dateStr}`) : null;
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

        // ONE list, two renderings: the hover tooltip's comma sentence and the day panel's icon
        // chips. They used to be built separately and could name different days.
        const markers = dayMarkers({ isToday, isBH, isXmas, isEaster, isPay, isCutoff });
        const extras  = markers.map(m => m.label).join(', ');
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
        // The roster week this date falls in — see `weekContext`, which also owns the one case
        // that must stay silent (a fixed line has no rotating week to state).
        const weekLabel = weekContext(member, currentDate);
        if (weekLabel) dayCell.dataset.detailWeek = weekLabel;
        dayCell.dataset.detailShift = ttShift;
        // The raw effective value, so the panel can lead with the day's OWN kind glyph from
        // `shiftBadgeParts` (v22.70). Written on every day, changed or not: an unchanged day used
        // to be the one state the panel rendered in monochrome, which made the colour look like a
        // property of "something happened" rather than of the shift.
        dayCell.dataset.detailShiftValue = shift;
        // Split so the panel can hold the TIME together across a wrap — see `splitShiftLine`.
        const shiftLine = splitShiftLine(ttShift);
        dayCell.dataset.detailShiftWords = shiftLine.words;
        if (shiftLine.time) dayCell.dataset.detailShiftTime = shiftLine.time;
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
        } else if (_display === 'render' && !preStart) {
            // NOTHING WAS CHANGED — AND WE ACTUALLY KNOW THAT (v22.89, external review).
            //
            // An unchanged day rendered nothing in the panel's change slot, so "no change is on
            // record" and "nobody has looked yet" were the same blank to a member deliberately
            // checking a date they were unsure about. The panel can answer that, but only where the
            // answer is earned: `render` is the ONE display state backed by a settled server read.
            // On a `stale` month — last-known-good data, which the grid still draws — the flag is
            // withheld and the panel stays blank, because turning the absence of an override in a
            // possibly-superseded cache into "As rostered" is precisely the claim
            // calendar-data-state.js exists to stop. Silence is not the opposite claim; it is the
            // absence of one.
            //
            // Decided HERE rather than in the panel because both halves are already in hand at this
            // line — the base-vs-effective comparison and the month's knowledge — and a second copy
            // of the knowledge rule in a view module is how the two would come to disagree.
            //
            // `preStart` is the FOURTH way the claim can be unearned, and the only one that is not
            // about knowledge (v22.93). Before a member's start date `getBaseShift` suppresses every
            // shift to `RD`, so base and effective match and the day lands here — on a settled month,
            // which is the one state allowed to speak. The panel then confirmed a rest day nobody was
            // ever rostered for, on a month a new starter reaches by pressing Prev. "We do not know"
            // and "there is nothing to know" are different silences; only the first was covered.
            // The roster WEEK is deliberately still stated on such a day: the month header states it
            // too, and `weekContext`'s whole design is that the two surfaces cannot disagree.
            dayCell.dataset.detailAsRostered = '1';
        }
        if (extras)       dayCell.dataset.detailExtras = extras;
        // JSON rather than a re-parse of the sentence above: the panel needs the icons, and
        // matching them back out of "Bank holiday, Christmas Day" would be a second, silent copy of
        // the label list. Our own data, and the panel still guards the parse.
        if (markers.length) dayCell.dataset.detailMarkers = JSON.stringify(markers);

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
