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
 *
 * ── COMPARE: THE PROPOSALS SIDE BY SIDE (owner, 28 Nov 2026: "Do 2, not as the default view") ───────────────────
 *
 * `buildSelectorTable` draws the same month for every proposal (and, for "Compare with mine", the reader's roster today beside
 * one), from the same starting week, as ONE TABLE: dates down
 * the side, a column per proposal, so one row reads "this day, under each proposal". Turned the other way — Team Week
 * View's way, a row per person and a column per day — it scrolled sideways on a phone and put the three answers for one
 * day in three different rows. Its cells ARE Team Week View's (index.css → `.tv-cell` and its `.tv-*` colours), with the
 * words Team Week View gives each kind of day, so a Compare cell reads exactly as a colleague's day reads there. The
 * month's heading is the Calendar's own, as on the month, so the month picker opens from it here too.
 */

import { MONTH_NAMES, isSameDay, isBankHoliday, isChristmasDay, isEasterSunday, isPayday, isCutoffDate, isWorkedShift, getShiftClass, shiftBadgeParts, escapeHtml } from './roster-data.js';
import { createCalendarHeader, createDayCell, dayCellParts, dayCellName, dayMarkers, shiftWords, splitShiftLine, CHRISTMAS_LEAVE_WORDS } from './calendar-renderer.js';
import { ROTATING_LINES } from './link-designer-design.js';
import { dayOn, monthLines, isCoverLine, compareRows } from './links-selector-core.js';
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

/** Team Week View's cell for a kind of day (calendar-team-view.js → getTeamCellDisplay), by the Calendar's own classes. */
const TV_CLASS = Object.freeze({ 'early-shift': 'tv-early', 'late-shift': 'tv-late', 'night-shift': 'tv-night', 'rest-day': 'tv-rest',
    'spare-day': 'tv-spare', 'al-day': 'tv-al' });

/**
 * One column of a side-by-side table: a proposal from the chosen week, or the reader's own roster today.
 * @typedef {{ key: string, name: string, kind: 'proposal'|'mine', chosen?: boolean,
 *   dayAt: (date: Date) => import('./links-selector-core.js').SelectorDay, isCover?: (line: number) => boolean }} TableColumn
 */

/**
 * One day of one column as a cell: the text Team Week View shows, its colour class, and what it says aloud — a cover
 * week's spare day and a Sunday shift say what they are, as the month's day panel does, because a cell is all there is.
 * @param {import('./links-selector-core.js').SelectorDay} day @param {Date} date @param {boolean} cover
 * @returns {{ html: string, cls: string, label: string }}
 */
function tableCell(day, date, cover) {
    if (day.blank) return { html: '', cls: '', label: '' };
    const { shift, christmasLeave } = day;
    const cls = TV_CLASS[/** @type {keyof typeof TV_CLASS} */ (getShiftClass(shift))] ?? '';
    if (shift === 'RD' || shift === 'OFF') return { html: '–', cls, label: 'Rest day' };
    if (shift === 'SPARE') return { html: '📋 Spare', cls, label: cover ? 'Spare, a cover week' : 'Spare day' };
    if (shift === 'AL') return { html: '🏖️ AL', cls, label: christmasLeave ? CHRISTMAS_LEAVE_WORDS : 'Annual leave' };
    const { emoji } = shiftBadgeParts(shift);
    const words = shiftWords(shift, NO_MEMBER, false);
    const sunday = date.getDay() === 0 && isWorkedShift(shift);
    // The emoji and the time on ONE line where the column has the room, the time under it where it has not: never the
    // time broken at its dash.
    return { html: `<span class="cmp-ico" aria-hidden="true">${emoji}</span> <span class="cmp-time">${escapeHtml(shift)}</span>`,
        cls, label: sunday ? `${words}, overtime` : words };
}

/**
 * The same month in every column, side by side: a `.calendar-container` with the Calendar's heading and one table — a
 * row per date, a column per `columns` entry — that the page's swipe moves like a month. Compare hands it every proposal;
 * "Compare with mine" hands it the reader's roster today and the chosen proposal.
 * @param {ReadonlyArray<TableColumn>} columns in order
 * @param {number} startLine @param {number} year @param {number} month 0-indexed
 * @param {{ today?: Date, caption: string }} opts
 * @returns {HTMLElement}
 */
export function buildSelectorTable(columns, startLine, year, month, opts) {
    const today = opts.today ?? new Date();
    const container = document.createElement('div');
    container.className = 'calendar-container selector-compare';
    container.dataset.selectorMonth = `${year}-${String(month + 1).padStart(2, '0')}`;

    const lines = monthLines(startLine, year, month);
    const header = document.createElement('div');
    header.className = 'calendar-header';
    header.innerHTML = createCalendarHeader(lines?.first ?? '', lines?.last ?? '', lines ? 'Week' : '', month, year, ROTATING_LINES);
    container.appendChild(header);

    const monthName = MONTH_NAMES[month];
    const span = columns.length;
    const colClass = (/** @type {TableColumn} */ c) => `${c.chosen ? ' cmp-chosen' : ''}${c.kind === 'mine' ? ' cmp-mine' : ''}`;
    const head = columns.map(c => `<th scope="col" class="cmp-col${colClass(c)}"${c.chosen ? ' aria-current="true"' : ''}>${escapeHtml(c.name)}</th>`).join('');
    const rows = compareRows(startLine, year, month);
    // WHAT A CELL CANNOT SAY, said under the table (staff-copy.md: educate at the point of use): a month's grid has the
    // day panel for it, and these cells open nothing. Only for what this month shows — the day panel's own words.
    let sundayWorked = false, cover = false;
    const body = rows.map(row => {
        if (row.kind === 'week') return `<tr class="cmp-week"><th scope="colgroup" colspan="${span + 1}">Week ${row.line}</th></tr>`;
        if (row.kind === 'before') {
            const dates = row.first.getDate() === row.last.getDate() ? `${row.first.getDate()}` : `${row.first.getDate()}–${row.last.getDate()}`;
            return `<tr class="cmp-before"><th scope="row" class="tv-name-col">${dates}</th>`
                + `<td class="tv-cell cmp-blank" colspan="${span}">Before the new link starts</td></tr>`;
        }
        const { date } = row;
        // The month's holiday markers, which bear on what a rota asks of you — not its pay markers, which do not differ
        // between rotas (the key hides those two here: links-selector.css).
        const marks = [isBankHoliday(date) ? ['⭐', 'bank holiday'] : null, isChristmasDay(date) ? ['🎄', 'Christmas Day'] : null,
            isEasterSunday(date) ? ['🐣', 'Easter Sunday'] : null].filter(Boolean);
        const marksHtml = marks.map(m => ` <span aria-hidden="true">${/** @type {string[]} */ (m)[0]}</span><span class="visually-hidden">, ${/** @type {string[]} */ (m)[1]}</span>`).join('');
        const isToday = isSameDay(date, today);
        const dayHead = `<th scope="row" class="tv-name-col cmp-day${date.getDay() === 0 ? ' cmp-sunday' : ''}${isToday ? ' cmp-today' : ''}">`
            + `<span class="cmp-wd">${SHORT_DAY_NAMES[date.getDay()]}</span> <span class="cmp-dn">${date.getDate()}</span>`
            + `<span class="visually-hidden"> ${monthName}${isToday ? ', today' : ''}</span>${marksHtml}</th>`;
        const cells = columns.map(c => {
            const day = c.dayAt(date);
            const isCover = !day.blank && day.shift === 'SPARE' && !!c.isCover?.(day.line);
            if (!day.blank && date.getDay() === 0 && isWorkedShift(day.shift)) sundayWorked = true;
            if (isCover) cover = true;
            const cell = tableCell(day, date, isCover);
            return `<td class="tv-cell ${cell.cls}${colClass(c)}" aria-label="${escapeHtml(`${c.name}: ${cell.label}`)}">${cell.html}</td>`;
        }).join('');
        return `<tr>${dayHead}${cells}</tr>`;
    }).join('');
    const foot = [
        sundayWorked ? 'Sunday shifts are overtime.' : '',
        cover ? 'Spare is a cover week: four shifts between Monday and Saturday, set nearer the time, to cover leave and absence.' : '',
    ].filter(Boolean).join(' ');

    const wrap = document.createElement('div');
    wrap.className = 'cmp-wrap';
    wrap.innerHTML = `<table class="team-table cmp-table cmp-cols-${span}">
        <caption class="visually-hidden">${escapeHtml(opts.caption)}: ${monthName} ${year}</caption>
        <thead><tr><th scope="col" class="tv-name-col">Day</th>${head}</tr></thead>
        <tbody>${body}</tbody></table>${foot ? `<p class="cmp-foot">${foot}</p>` : ''}`;
    container.appendChild(wrap);
    return container;
}

/**
 * ONE PROPOSAL'S WHOLE YEAR (owner, 28 Nov 2026: "do exactly the same with year view"): twelve small months, every day
 * coloured by its kind in the colours the rest of the app gives it (Team Week View's `.tv-*` fills: early orange, late
 * blue — a pair that stays apart for the common colour-blindnesses — rest plain, spare purple, Christmas leave teal), so
 * the RHYTHM shows: where the earlies and lates run, where the rest days fall, where the cover weeks are. A small cell
 * cannot carry a time, so each says it aloud instead (its `aria-label`), and a month's name opens that month — where the
 * day panel has the rest. Days before the link starts are the month view's blank days.
 * @param {{ code: string, patterns: Record<string, Record<string, string>> }} proposal
 * @param {number} startLine @param {number} year
 * @param {{ today?: Date, firstMonth?: number, lastMonth?: number }} [opts] the months of the year the page can show
 * @returns {HTMLElement}
 */
export function buildSelectorYear(proposal, startLine, year, opts = {}) {
    const today = opts.today ?? new Date();
    const container = document.createElement('div');
    container.className = 'calendar-container selector-year';
    container.dataset.selectorYear = String(year);
    const head = document.createElement('div');
    head.className = 'calendar-header';
    head.innerHTML = `<div class="month-display"><h2 class="yr-title">${year}</h2></div>`;
    container.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'yr-months';
    const first = opts.firstMonth ?? 0, last = opts.lastMonth ?? 11;
    for (let m = first; m <= last; m++) {
        const monthName = MONTH_NAMES[m];
        const lead = new Date(year, m, 1).getDay();
        const days = new Date(year, m + 1, 0).getDate();
        let cells = '';
        for (let i = 0; i < lead; i++) cells += '<td class="yr-pad" aria-hidden="true"></td>';
        for (let d = 1; d <= days; d++) {
            const date = new Date(year, m, d);
            const day = dayOn(proposal, startLine, date);
            const weekday = FULL_DAY_NAMES[date.getDay()];
            const isToday = isSameDay(date, today) ? ' yr-today' : '';
            if (day.blank) {
                cells += `<td class="yr-day yr-blank${isToday}" aria-label="${weekday} ${d}: before the new link starts">${d}</td>`;
            } else {
                const cls = TV_CLASS[/** @type {keyof typeof TV_CLASS} */ (getShiftClass(day.shift))] ?? '';
                const words = day.christmasLeave ? CHRISTMAS_LEAVE_WORDS : shiftWords(day.shift, NO_MEMBER, false);
                const sunday = date.getDay() === 0 && isWorkedShift(day.shift) ? ', overtime' : '';
                cells += `<td class="yr-day ${cls}${isToday}" aria-label="${weekday} ${d}: ${escapeHtml(words)}${sunday}">${d}</td>`;
            }
            if ((lead + d) % 7 === 0 && d < days) cells += '</tr><tr>';
        }
        const tail = (7 - ((lead + days) % 7)) % 7;
        for (let i = 0; i < tail; i++) cells += '<td class="yr-pad" aria-hidden="true"></td>';
        const section = document.createElement('section');
        section.className = 'yr-month';
        section.innerHTML = `<h3 class="yr-name"><button type="button" class="yr-open" data-year="${year}" data-month="${m}"
                aria-label="${monthName} ${year}: open the month">${monthName}</button></h3>
            <table class="yr-grid"><caption class="visually-hidden">${monthName} ${year}</caption>
                <thead><tr>${SHORT_DAY_NAMES.map(n => `<th scope="col" aria-label="${FULL_DAY_NAMES[SHORT_DAY_NAMES.indexOf(n)]}">${n[0]}</th>`).join('')}</tr></thead>
                <tbody><tr>${cells}</tr></tbody></table>`;
        grid.appendChild(section);
    }
    container.appendChild(grid);
    return container;
}
