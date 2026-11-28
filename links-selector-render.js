// @ts-check
/**
 * links-selector-render.js — one month of a proposal, drawn as the Calendar draws a month (links-selector.html).
 *
 * ── THE CALENDAR'S CELLS, NOT A COPY OF THEM ───────────────────────────────────────────────────
 *
 * Every visible piece comes from the Calendar's own builders in calendar-renderer.js — `createDayCell` (the badge and
 * the time), `dayCellParts` and `dayCellName` (what the cell says aloud), `shiftWords` and `splitShiftLine` (the words
 * the day panel shows), `dayMarkers` (⭐ 💷 ✂️ 🎄 🐣 📍) — and the grid wears index.css's classes, which the page loads. So a
 * proposal's Monday early turn is the same gold ☀️ cell a member already reads on the Calendar, and a change to how the
 * Calendar draws a day reaches this page by itself.
 *
 * What this module does NOT take is `buildCalendarContainer`. That function draws a MEMBER: it reads their recorded
 * changes, waits for the month's read to settle, and stands a stored copy in for it — the whole of CALENDAR_DATA.md. A
 * proposal has none of those, and handing it a made-up member to get past them would put a proposal one argument away
 * from the Calendar's own data path (newlink-boundary.test.mjs keeps the two apart). So the month is assembled here,
 * from the same parts, with nothing to wait for. The Calendar's data modules ARE still loaded, as imports of the cell
 * builders and the swipe (calendar-overrides.js, calendar-member.js, calendar-state.js) — inert, because this page never
 * grants Calendar access, so nothing calls a read; what this module avoids is CALLING the data path, not loading it.
 *
 * ── WHAT IS DIFFERENT, ON PURPOSE ──────────────────────────────────────────────────────────────
 *
 * - Days before the link starts are BLANK (links-selector-core.js): a date and nothing else, never today's roster.
 * - The header names the proposal's WEEKS the month falls on ("Weeks 3–7"), where the Calendar names the roster's.
 * - The cells carry no "As rostered" and no "changed from": nothing is recorded against a proposal.
 * - A spare day in a cover week, and a Sunday shift, carry a line for the day panel saying what they are
 *   (`data-detail-cover`, `data-detail-sunday`): the proposal's grid is all a colleague has to read it by.
 */

import { MONTH_NAMES, isSameDay, isBankHoliday, isChristmasDay, isEasterSunday, isPayday, isCutoffDate, isWorkedShift, getShiftClass } from './roster-data.js';
import { createCalendarHeader, createDayCell, dayCellParts, dayCellName, dayMarkers, shiftWords, splitShiftLine, CHRISTMAS_LEAVE_WORDS } from './calendar-renderer.js';
import { ROTATING_LINES } from './link-designer-design.js';
import { dayOn, monthLines, isCoverLine } from './links-selector-core.js';
import { DAY_NAMES, DAY_NAMES_FULL } from './date-format.js';

// The app's one list of day names (date-format.js), as the Calendar's grid reads it.
const FULL_DAY_NAMES = DAY_NAMES_FULL;
const SHORT_DAY_NAMES = DAY_NAMES;

/** No member is drawn, so no member's `permanentShift` forces a badge: every worked day wears its time's own kind. */
const NO_MEMBER = Object.freeze({});

/**
 * The words the Calendar's day cell is NAMED by, in its order, for one proposal day.
 * @param {Date} date @param {string} shift @param {boolean} christmasLeave @param {string} markers
 */
function cellName(date, shift, christmasLeave, markers) {
    const isWorkedDay = isWorkedShift(shift);
    const { badgeWord, timeShown } = dayCellParts(shift, undefined, isWorkedDay, '');
    return dayCellName({
        weekday: FULL_DAY_NAMES[date.getDay()], day: date.getDate(), badgeWord, timeShown,
        fullWords: christmasLeave ? CHRISTMAS_LEAVE_WORDS : shiftWords(shift, NO_MEMBER, false),
        markers, monthYear: `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`,
    });
}

/**
 * One month of `proposal` for somebody starting on `startLine`: a `.calendar-container` the Calendar's swipe and styles
 * already understand.
 * @param {{ code: string, patterns: Record<string, Record<string, string>> }} proposal
 * @param {string} proposalName the name shown, for the day panel
 * @param {number} startLine
 * @param {number} year
 * @param {number} month 0-indexed
 * @param {{ onDayDetail?: (cell: HTMLElement) => void, today?: Date }} [opts]
 * @returns {HTMLElement}
 */
export function buildSelectorMonth(proposal, proposalName, startLine, year, month, opts = {}) {
    const today = opts.today ?? new Date();
    const container = document.createElement('div');
    container.className = 'calendar-container';
    container.dataset.selectorMonth = `${year}-${String(month + 1).padStart(2, '0')}`;

    const lines = monthLines(startLine, year, month);
    const header = document.createElement('div');
    header.className = 'calendar-header';
    // THE CALENDAR'S HEADING, WHOLE (owner, 28 Nov 2026): the month's name opens the Calendar's own month picker
    // (calendar-month-jump.js, handed this page's months by links-selector-app.js), and the note beside it names the weeks
    // the month falls on — "Weeks 3–7", as the Calendar's says "CEA Weeks 3–7", the word New CEA Link uses for them too.
    header.innerHTML = createCalendarHeader(lines?.first ?? '', lines?.last ?? '', lines ? 'Week' : '', month, year, ROTATING_LINES);
    container.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    grid.addEventListener('click', (e) => {
        const cell = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.calendar-day'));
        if (!cell || cell.classList.contains('other-month') || cell.classList.contains('selector-blank')) return;
        opts.onDayDetail?.(cell);
    });

    for (const name of SHORT_DAY_NAMES) {
        const h = document.createElement('div');
        h.className = 'day-header';
        h.textContent = name;
        grid.appendChild(h);
    }

    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevLast = new Date(year, month, 0).getDate();
    const filler = (/** @type {number} */ n) => {
        const c = document.createElement('div');
        c.className = 'calendar-day other-month';
        c.setAttribute('aria-hidden', 'true');
        c.innerHTML = `<div class="day-number">${n}</div>`;
        return c;
    };
    for (let i = 0; i < first.getDay(); i++) grid.appendChild(filler(prevLast - first.getDay() + i + 1));

    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month, d);
        const day = dayOn(proposal, startLine, date);
        const cell = document.createElement('div');
        const monthYear = `${MONTH_NAMES[month]} ${year}`;

        if (day.blank) {
            // A date and nothing else: today's link still runs, and this page does not draw it. Still a stop for the
            // Calendar's arrow keys (calendar-keyboard.js), which walk every day of the month, so it can be focused and says
            // why it is empty; Enter on it opens nothing.
            cell.className = 'calendar-day selector-blank';
            cell.setAttribute('aria-label', `${FULL_DAY_NAMES[date.getDay()]} ${d} — before the new link starts — ${monthYear}`);
            cell.setAttribute('role', 'img');
            cell.setAttribute('tabindex', '-1');
            cell.dataset.tooltip = 'Before the new link starts';
            cell.innerHTML = `<div class="day-number">${d}</div>`;
            grid.appendChild(cell);
            continue;
        }

        const { shift, line, christmasLeave } = day;
        const isWorkedDay = isWorkedShift(shift);
        const isToday = isSameDay(date, today), isBH = isBankHoliday(date), isXmas = isChristmasDay(date);
        const isEaster = isEasterSunday(date), isPay = isPayday(date), isCutoff = isCutoffDate(date);
        const markers = dayMarkers({ isToday, isBH, isXmas, isEaster, isPay, isCutoff });
        const extras = markers.map(m => m.label).join(', ');
        const words = christmasLeave ? 'Annual leave' : shiftWords(shift, NO_MEMBER, false);

        cell.className = `calendar-day ${getShiftClass(shift)}`;
        cell.setAttribute('role', 'button');
        cell.setAttribute('tabindex', '-1');
        cell.setAttribute('aria-label', cellName(date, shift, christmasLeave, extras));
        // The pieces the day panel shows, as the Calendar's cells carry them — read back by links-selector-app.js.
        cell.dataset.detailDay = `${FULL_DAY_NAMES[date.getDay()]} ${d} ${MONTH_NAMES[month]} ${year}`;
        cell.dataset.detailWeek = `Week ${line}`;
        cell.dataset.detailWho = proposalName;
        cell.dataset.detailShiftValue = shift;
        // The Calendar's desktop hover line (calendar-keyboard.js → initCalendarTooltip): the day's words, then its markers.
        cell.dataset.tooltip = [christmasLeave ? CHRISTMAS_LEAVE_WORDS : words, extras].filter(Boolean).join(' · ');
        // A spare day in a cover week says what a cover week IS, in the day panel — the word "Spare" alone teaches nothing.
        if (shift === 'SPARE' && isCoverLine(proposal, line)) cell.dataset.detailCover = date.getDay() === 0 ? 'sunday' : 'week';
        // A Sunday shift is overtime, never part of the contracted week (CLAUDE.md → "Sundays are non-contracted"), and the
        // New CEA Link page says so beside its grids. Drawn here as a plain early or late, it would read as a contracted one.
        else if (date.getDay() === 0 && isWorkedDay) cell.dataset.detailSunday = 'overtime';
        const split = splitShiftLine(words);
        cell.dataset.detailShiftWords = split.words;
        if (split.time) cell.dataset.detailShiftTime = split.time;
        if (christmasLeave) cell.dataset.detailChristmas = String(d);
        if (markers.length) cell.dataset.detailMarkers = JSON.stringify(markers);
        if (isToday)  cell.classList.add('today');
        if (isBH)     cell.classList.add('bank-holiday');
        if (isXmas)   cell.classList.add('christmas-day');
        if (isEaster) cell.classList.add('easter-day');
        if (isPay)    cell.classList.add('payday');
        if (isCutoff) cell.classList.add('cutoff');
        cell.innerHTML = createDayCell(date, shift, undefined, isWorkedDay, '');
        grid.appendChild(cell);
    }

    const used = first.getDay() + daysInMonth;
    for (let i = 1; i <= (7 - (used % 7)) % 7; i++) grid.appendChild(filler(i));

    // Roving tabindex, as the Calendar's: today where it is in the month, else the first day that has a shift, else the 1st.
    const cells = [...grid.querySelectorAll('.calendar-day:not(.other-month)')];
    const anchor = cells.find(c => c.classList.contains('today')) ?? cells.find(c => c.getAttribute('role') === 'button') ?? cells[0];
    anchor?.setAttribute('tabindex', '0');

    container.appendChild(grid);
    return container;
}
