// @ts-check
/**
 * leave-year.js — WHICH YEAR'S ALLOWANCE a day of annual leave comes out of (v25.18).
 *
 * ── THE RULE, AND THE ONE EXCEPTION ─────────────────────────────────────────────────────────────
 *
 * A day of annual leave counts against the year of its own date. That is the default, it needs no
 * record, and it is what every override written before this module already says.
 *
 * The exception (owner, 3 Nov 2026): some staff are allowed to take a few of their 2026 days in early
 * January 2027. Such a day is still annual leave on 4 January 2027 — the calendar, the roster and the
 * pay calculator all see an ordinary day off — but it spends a day of 2026's allowance, not 2027's.
 * The override for that one day carries `leaveYear: 2026`, and nothing else changes.
 *
 * The pattern is DEFAULT BY RULE, EXCEPTION BY RECORD — the same shape as `replacedType`
 * (override-utils.js). The alternative the depot workbook uses, one "carried forward: 3" figure per
 * person, was weighed and declined: 2027 would read 35 days all year, even after the carried days
 * had gone, and it cannot say which days the carried ones were. AL_WORKBOOK.md §9 records how the two
 * bookkeepings agree (next year's remaining) and differ (last year's, by exactly the carried days).
 *
 * ── WHAT THE OWNER DECIDED (3 Nov 2026) ─────────────────────────────────────────────────────────
 *
 *   1. A member may move their OWN January days; a manager or the admin anyone's. That is the
 *      override write isolation unchanged, so the rules needed no clause about WHO.
 *   2. Any January leave day can be moved, and it stays correctable after January. There is no
 *      lock on 31 January.
 *   3. No more than the previous year has left. A count across documents, which Firestore rules
 *      cannot take — so it is the app's refusal (`leaveYearChoices` in al-entitlement.js), on the
 *      same footing as the leave booking's own over-entitlement warning.
 *
 * ── THE SHAPE IS THE RULES' SHAPE, EXACTLY ──────────────────────────────────────────────────────
 *
 * `isValidLeaveYear` states what firestore.rules accepts: annual leave, dated in January, naming the
 * year before as a whole number. A record that says anything else counts against its own year —
 * the reader ignores what the writer could never have stored, rather than trusting it.
 *
 * ── THE SWITCH GOVERNS THE CHOICE, NEVER THE COUNTING ───────────────────────────────────────────
 *
 * `LEAVE_YEAR_CHOICE` decides whether the app OFFERS the choice. The rules that accept the field and
 * the client that writes it go out in separate releases (backend first — CLAUDE.md, Workflows), so
 * the client ships with the switch off and a later one-line release turns it on. COUNTING honours a
 * stored `leaveYear` whatever the switch says: the record is the truth, and turning the switch back
 * off must not make a day that was moved silently move back on every screen.
 */

/** Whether the app OFFERS the choice. Off until the rules that accept `leaveYear` are deployed.
 *  @type {boolean} — declared, so turning it on is a one-word change the checker does not query. */
export const LEAVE_YEAR_CHOICE = false;

/** The first January the choice is offered for: 2027 is the first year staff carry days into. */
export const LEAVE_YEAR_FROM = 2027;

const JANUARY_RE = /^(\d{4})-01-(0[1-9]|[12]\d|3[01])$/;

/**
 * Is the choice switched on? `__E2E.leaveYearChoice` is a TEST SEAM, the same shape as
 * `overtimeEnabled` in auth-policy.js: the browser suites set it to drive the real panel while the
 * switch is off for everyone else. Nothing in production sets `__E2E`, and setting it by hand offers
 * only a write the deployed rules refuse until they accept the field.
 * @returns {boolean}
 */
export function leaveYearChoiceEnabled() {
    const seam = /** @type {any} */ (globalThis).__E2E?.leaveYearChoice;
    return typeof seam === 'boolean' ? seam : LEAVE_YEAR_CHOICE === true;
}

/**
 * The year of an ISO date, as a number.
 * @param {string} date `YYYY-MM-DD` @returns {number}
 */
function yearOf(date) { return Number(date.slice(0, 4)); }

/**
 * Is `y` a `leaveYear` the rules accept for `date`? January, and exactly the year before.
 * @param {string|null|undefined} date `YYYY-MM-DD`
 * @param {unknown} y
 * @returns {boolean}
 */
export function isValidLeaveYear(date, y) {
    if (typeof date !== 'string' || !JANUARY_RE.test(date)) return false;
    return Number.isInteger(y) && y === yearOf(date) - 1;
}

/**
 * The PREVIOUS year a leave day comes out of, or null when it counts against its own year.
 * Takes the date separately because the calendar's cache records do not carry one.
 * @param {{type?: string, leaveYear?: unknown}|null|undefined} record
 * @param {string} date `YYYY-MM-DD`
 * @returns {number|null}
 */
export function carriedFrom(record, date) {
    if (!record || record.type !== 'annual_leave') return null;
    return isValidLeaveYear(date, record.leaveYear) ? /** @type {number} */ (record.leaveYear) : null;
}

/**
 * The year whose allowance a WINNING annual-leave override counts against.
 * @param {{date: string, type?: string, leaveYear?: unknown}} o
 * @returns {number}
 */
export function leaveYearOf(o) {
    return carriedFrom(o, o.date) ?? yearOf(o.date);
}

/**
 * What `leaveYear` a rewrite of a day should carry, given the record it is about to delete.
 *
 * A write is delete-then-set, so without this an ordinary edit of a moved day — a manager re-saving
 * the week it sits in, a roster import over it — would quietly put it back on its own year. Leave
 * stays leave ⇒ the choice is carried. The day stops being leave ⇒ the choice goes with it, and if
 * it becomes leave again that is a new booking, which starts from the default.
 *
 * @param {{type?: string, leaveYear?: unknown}|null|undefined} existing the record being replaced
 * @param {string} newType the type being written
 * @param {string} date `YYYY-MM-DD`, the day being written
 * @returns {number|null}
 */
export function nextLeaveYear(existing, newType, date) {
    if (newType !== 'annual_leave') return null;
    return carriedFrom(existing, date);
}

/**
 * May the app OFFER the choice for this date? A January date in a year the choice covers.
 * @param {string} date `YYYY-MM-DD` @returns {boolean}
 */
export function canChooseLeaveYear(date) {
    return typeof date === 'string' && JANUARY_RE.test(date) && yearOf(date) >= LEAVE_YEAR_FROM;
}

/**
 * The Januaries the choice is offered for, today: this year's and next year's, from
 * `LEAVE_YEAR_FROM`. This year's stays listed after January ends (the owner's decision 2).
 * @param {string} todayStr `YYYY-MM-DD`
 * @returns {number[]}
 */
export function offeredJanuaries(todayStr) {
    const y = yearOf(todayStr);
    return [y, y + 1].filter(j => j >= LEAVE_YEAR_FROM);
}

/**
 * The Calendar leave panel's line about days that cross New Year, or null when none do.
 *
 * Without it the figures look wrong in both directions: this year's Booked includes a day dated next
 * year, and next year's figures leave out a day that is plainly on its calendar.
 * @param {{ year: number, carriedIn: number, carriedOut: number }} args
 *   carriedIn — next January's days counted towards `year`; carriedOut — this January's days
 *   counted towards the year before
 * @returns {string|null}
 */
export function carryLine({ year, carriedIn, carriedOut }) {
    const days = (/** @type {number} */ n) => `${n} day${n === 1 ? '' : 's'}`;
    const parts = [];
    if (carriedIn > 0) parts.push(`Includes ${days(carriedIn)} in January ${year + 1}.`);
    if (carriedOut > 0) {
        parts.push(`${days(carriedOut)} in January ${carriedOut === 1 ? 'comes' : 'come'} out of ${year - 1}’s allowance.`);
    }
    return parts.length ? parts.join(' ') : null;
}
