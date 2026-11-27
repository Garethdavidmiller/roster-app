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
 * from the same parts, with nothing to wait for.
 *
 * ── WHAT IS DIFFERENT, ON PURPOSE ──────────────────────────────────────────────────────────────
 *
 * - Days before the link starts are BLANK (links-selector-core.js): a date and nothing else, never today's roster.
 * - The header names the LINES the month's weeks fall on ("Lines 3–7"), where the Calendar names roster weeks.
 * - The month name is not a button: the Calendar's opens its month picker, and this page has none.
 * - The cells carry no "As rostered" and no "changed from": nothing is recorded against a proposal.
 */

import { MONTH_NAMES, isSameDay, isBankHoliday, isChristmasDay, isEasterSunday, isPayday, isCutoffDate, isWorkedShift, getShiftClass } from './roster-data.js';
import { createCalendarHeader, createDayCell, dayCellParts, dayCellName, dayMarkers, shiftWords, splitShiftLine } from './calendar-renderer.js';
import { ROTATING_LINES } from './link-designer-design.js';
import { dayOn, monthLines } from './links-selector-core.js';

const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
        fullWords: christmasLeave ? 'Annual leave (Christmas, not counted)' : shiftWords(shift, NO_MEMBER, false),
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
    header.innerHTML = createCalendarHeader(lines?.first ?? '', lines?.last ?? '', lines ? 'Line' : '', month, year, ROTATING_LINES);
    // The Calendar's month name opens its month picker; here there is none, so it is plain text, not a dead button.
    const monthName = header.querySelector('.month-year');
    if (monthName) { monthName.removeAttribute('role'); monthName.removeAttribute('tabindex'); monthName.removeAttribute('aria-label'); }
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
            // A date and nothing else: today's link still runs, and this page does not draw it.
            cell.className = 'calendar-day selector-blank';
            cell.setAttribute('aria-label', `${FULL_DAY_NAMES[date.getDay()]} ${d} — before the new link starts — ${monthYear}`);
            cell.setAttribute('role', 'img');
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
        cell.dataset.detailWeek = `Line ${line}`;
        cell.dataset.detailWho = proposalName;
        cell.dataset.detailShiftValue = shift;
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

    // Roving tabindex, as the Calendar's: today where it is in the month, else the first day that has a shift.
    const cells = [...grid.querySelectorAll('.calendar-day[role="button"]')];
    const anchor = cells.find(c => c.classList.contains('today')) ?? cells[0];
    anchor?.setAttribute('tabindex', '0');

    container.appendChild(grid);
    return container;
}
