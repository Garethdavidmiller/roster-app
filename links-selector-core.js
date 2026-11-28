// @ts-check
/**
 * links-selector-core.js — the Links Selector's rules, with no page attached (links-selector.html).
 *
 * ── WHAT THE PAGE IS FOR ───────────────────────────────────────────────────────────────────────
 *
 * Colleagues asked to SEE a proposal as a calendar (owner, 27 Nov 2026): choose one of the shortlisted proposals and the
 * line you would start on, and the page draws your months the way the Calendar draws them — the same grid, the same
 * badges, the same swipe — so a rota on paper becomes days you can recognise. The New CEA Link page shows the same
 * proposals as WEEK NUMBERS, and deliberately so (newlink-boundary.test.mjs: a proposal must never be read as somebody's
 * roster); this page puts them on DATES, and is built to be unmistakable instead: its own name, a note on every month that
 * it is a proposal, and no record of anybody's. Nothing here reads or writes Firestore.
 *
 * ── THE ROTATION ───────────────────────────────────────────────────────────────────────────────
 *
 * "Start on line x" means: in the week beginning Sunday `STARTS`, you work line x; each Sunday after it you move DOWN one
 * line, and after the last line you go back to line 1 — the way every rotating link in the app turns
 * (roster-data.js → getWeekNumberForDate). So the line on a date is one function of the start line and the whole weeks
 * since `STARTS`, and a month can never disagree with the month before it.
 *
 * ── THE DAYS IT DOES NOT DRAW ──────────────────────────────────────────────────────────────────
 *
 * Before `STARTS` every day is BLANK (owner, 27 Nov 2026: "Blank days"): today's link still runs then, and drawing it here
 * would put a real roster beside a proposed one. No leave, absence or changed shift is drawn on any day (owner: "Leave
 * out") — a proposal has none. Christmas follows the Calendar's own rule (christmas-leave.js): on 25 and 26 December a
 * day the proposal has you working shows as annual leave that is never counted, and anything else is a rest day.
 *
 * ── WHAT IT REMEMBERS ──────────────────────────────────────────────────────────────────────────
 *
 * The choice travels in the address (`?proposal=MB-26-V6&line=7`), so a colleague can send the exact view to somebody
 * else, and is kept on this device so the page reopens where it was left. A choice from either that names no proposal
 * or no line is ignored, never guessed at.
 */

import { PROPOSALS, proposalDisplayName } from './link-designer-proposals.js';
import { DAYS, ROTATING_LINES, isCoverWeek } from './link-designer-design.js';
import { isChristmasRD, getBaseShift } from './roster-data.js';
import { isChristmasDueByPattern, isChristmasLeaveDay } from './christmas-leave.js';

/**
 * The Sunday the new link starts, as the Links Selector draws it — PROVISIONAL (owner, 27 Nov 2026: "It should
 * provisionally start on Sunday 17th January"). newlink-config.js → STARTS holds the month the link starts ('2027-01');
 * this page needs the day, and the test holds the two to one month. Change both when the day is agreed.
 */
export const STARTS = '2027-01-17';

/** The first and last months the page can show: the start's month, and the end of the following year. */
export const FIRST_MONTH = Object.freeze({ year: 2027, month: 0 });
export const LAST_MONTH  = Object.freeze({ year: 2028, month: 11 });

const DAY_MS = 86_400_000;

/** `STARTS` as a local-midnight Date. @returns {Date} */
export function startDate() {
    const [y, m, d] = STARTS.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/** Whole days from `a` to `b`, counted on the calendar, so a clock change cannot move a day. @param {Date} a @param {Date} b */
function daysBetween(a, b) {
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
}

/**
 * The line worked on `date` by somebody who starts on `startLine`, or null before the link starts.
 * @param {number} startLine 1 to ROTATING_LINES
 * @param {Date} date
 * @returns {number|null}
 */
export function lineOn(startLine, date) {
    const days = daysBetween(startDate(), date);
    if (days < 0) return null;
    const weeks = Math.floor(days / 7);
    return ((startLine - 1 + weeks) % ROTATING_LINES + ROTATING_LINES) % ROTATING_LINES + 1;
}

/**
 * @typedef {{ blank: true }
 *   | { blank: false, shift: string, line: number, christmasLeave: boolean }} SelectorDay
 */

/**
 * What the proposal gives on `date` to somebody starting on `startLine`.
 * `blank` before the link starts. On 25 and 26 December the Calendar's rule: a day the proposal has you WORKING is annual
 * leave that is never counted (`christmasLeave`), and every other day — a rest day, a spare day, a Sunday — is a rest day.
 * @param {{ patterns: Record<string, Record<string, string>> }} proposal
 * @param {number} startLine
 * @param {Date} date
 * @returns {SelectorDay}
 */
export function dayOn(proposal, startLine, date) {
    const line = lineOn(startLine, date);
    if (line === null) return { blank: true };
    const pattern = proposal.patterns[String(line)]?.[DAYS[date.getDay()]] ?? 'RD';
    if (isChristmasRD(date)) {
        // The Calendar's own rule, asked of the proposal's value (christmas-leave.js → isChristmasDueByPattern): never on a
        // Sunday, never on a spare day.
        const due = isChristmasDueByPattern(date, pattern);
        return { blank: false, shift: due ? 'AL' : 'RD', line, christmasLeave: due };
    }
    return { blank: false, shift: pattern, line, christmasLeave: false };
}

/**
 * The reader's OWN roster on `date`, as it is today — for "Compare with mine" (owner, 28 Nov 2026: "Do 5 … clear labelling").
 *
 * The member's base roster only, by the Calendar's own two rules: `getBaseShift` (the pattern, its start date and any
 * scheduled move, with 25 and 26 December at rest) and Christmas leave on top (`isChristmasLeaveDay`). What it never adds is
 * anything RECORDED — leave, absence, a changed shift — which lives in Firestore behind a claim; this page reads none of it
 * (owner: "Leave out"), and the column says so. Nor does it know which week of a proposal the member would start on: that
 * is decided later, which the page says too.
 * @param {any} member a teamMembers row
 * @param {Date} date
 * @returns {{ blank: false, shift: string, line: number, christmasLeave: boolean }} never blank: a roster has every day
 */
export function rosterDayOn(member, date) {
    const christmasLeave = isChristmasLeaveDay(member, date);
    return { blank: false, shift: christmasLeave ? 'AL' : getBaseShift(member, date), line: 0, christmasLeave };
}

/** The shortlisted proposals in the order the page lists them: A to Z by the name shown, as the New CEA Link page lists
 *  them — so neither page's order decides the other's. */
export function proposalsAtoZ() {
    return [...PROPOSALS].sort((a, b) => proposalDisplayName(a).localeCompare(proposalDisplayName(b), 'en-GB'));
}

/**
 * Is this line a cover week? The Link Designer's own rule (`isCoverWeek`): spare Monday to Saturday, whatever the Sunday —
 * the rule the New CEA Link page reads too, so the two pages cannot count a proposal's cover weeks differently.
 * @param {{ patterns: Record<string, Record<string, string>> }} proposal @param {number} line
 */
export function isCoverLine(proposal, line) {
    return isCoverWeek(proposal.patterns[String(line)]);
}

/**
 * The line picker's options for a proposal: every line, and which are cover weeks.
 * @param {{ patterns: Record<string, Record<string, string>> }} proposal
 * @returns {Array<{ value: string, label: string }>}
 */
export function lineOptions(proposal) {
    return Array.from({ length: ROTATING_LINES }, (_, i) => {
        const n = i + 1;
        return { value: String(n), label: isCoverLine(proposal, n) ? `Week ${n} · cover week` : `Week ${n}` };
    });
}

/**
 * The lines a month's days fall on, for its header: the first and the last, or null for a month wholly before the start.
 * @param {number} startLine @param {number} year @param {number} month 0-indexed
 * @returns {{ first: number, last: number }|null}
 */
export function monthLines(startLine, year, month) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    let first = null, last = null;
    for (let d = 1; d <= lastDay; d++) {
        const line = lineOn(startLine, new Date(year, month, d));
        if (line === null) continue;
        if (first === null) first = line;
        last = line;
    }
    return first === null || last === null ? null : { first, last };
}

/**
 * The kinds of day a month of the proposal draws, in the Calendar's own words for its key (calendar-overrides.js →
 * getShiftTypesInMonth): 'SPARE' and 'AL' are the two a proposal can have. Read through `dayOn`, as the grid is, so the
 * key can never name a day the grid does not show.
 * @param {{ patterns: Record<string, Record<string, string>> }} proposal @param {number} startLine
 * @param {number} year @param {number} month 0-indexed
 * @returns {Set<string>}
 */
export function shiftTypesInMonth(proposal, startLine, year, month) {
    const types = new Set();
    const days = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
        const day = dayOn(proposal, startLine, new Date(year, month, d));
        if (day.blank) continue;
        if (day.shift === 'SPARE') types.add('SPARE');
        else if (day.shift === 'AL') types.add('AL');
    }
    return types;
}

/**
 * The kinds of day a month draws across EVERY proposal shown side by side (Compare): the key under the table names what
 * any column has, by the same rule as one proposal's (`shiftTypesInMonth`), so it never names a day no column shows.
 * @param {ReadonlyArray<{ patterns: Record<string, Record<string, string>> }>} proposals @param {number} startLine
 * @param {number} year @param {number} month 0-indexed
 * @returns {Set<string>}
 */
export function shiftTypesInMonthAll(proposals, startLine, year, month) {
    const types = new Set();
    for (const p of proposals) for (const t of shiftTypesInMonth(p, startLine, year, month)) types.add(t);
    return types;
}

/**
 * @typedef {{ kind: 'before', first: Date, last: Date }
 *   | { kind: 'week', line: number }
 *   | { kind: 'day', date: Date }} CompareRow
 */

/**
 * The rows of Compare for one month, top to bottom (owner, 28 Nov 2026: the proposals side by side, same month, same week).
 * One row per date from the link's start, each week headed by its number — a week's number is the SAME in every column,
 * because every proposal is shown from the one starting week — and the days before the link starts folded into one row,
 * as the month leaves them blank. What each proposal gives on a date is `dayOn`, asked by the renderer per column, so a
 * column can never disagree with that proposal's own month.
 * @param {number} startLine @param {number} year @param {number} month 0-indexed
 * @returns {CompareRow[]}
 */
export function compareRows(startLine, year, month) {
    /** @type {CompareRow[]} */
    const rows = [];
    const days = new Date(year, month + 1, 0).getDate();
    /** @type {Date|null} */ let beforeFirst = null;
    /** @type {Date|null} */ let beforeLast = null;
    for (let d = 1; d <= days; d++) {
        const date = new Date(year, month, d);
        const line = lineOn(startLine, date);
        if (line === null) { beforeFirst ??= date; beforeLast = date; continue; }
        if (beforeFirst && beforeLast) { rows.push({ kind: 'before', first: beforeFirst, last: beforeLast }); beforeFirst = beforeLast = null; }
        if (date.getDay() === 0 || rows.every(r => r.kind !== 'week')) rows.push({ kind: 'week', line });
        rows.push({ kind: 'day', date });
    }
    if (beforeFirst && beforeLast) rows.push({ kind: 'before', first: beforeFirst, last: beforeLast });
    return rows;
}

/** Does the month have days before the link starts — the ones the grid leaves blank? @param {number} year @param {number} month */
export function hasBlankDays(year, month) {
    return lineOn(1, new Date(year, month, 1)) === null;
}

/** Is { year, month } inside the months the page shows? @param {number} year @param {number} month */
export function inRange(year, month) {
    const n = year * 12 + month;
    return n >= FIRST_MONTH.year * 12 + FIRST_MONTH.month && n <= LAST_MONTH.year * 12 + LAST_MONTH.month;
}

/** The month the page opens on: today's, inside the range — so before the link starts, its first month. @param {Date} [today] */
export function openingMonth(today = new Date()) {
    const y = today.getFullYear(), m = today.getMonth();
    if (inRange(y, m)) return { year: y, month: m };
    return y * 12 + m < FIRST_MONTH.year * 12 + FIRST_MONTH.month ? { ...FIRST_MONTH } : { ...LAST_MONTH };
}

/**
 * The choice to open with: the address's, else this device's, else the first proposal on line 1. Each half is taken only
 * when it names a real proposal or a real line, and the two sources are read SEPARATELY, so a link naming only a line
 * keeps the proposal this device last showed.
 *
 * `ignored` names each half the ADDRESS gave and this page could not use — a link to a proposal since dropped from the
 * shortlist, or a line mistyped — so the page can say so rather than quietly show something else (`ignoredWords`). What
 * this device kept is never reported: it is the page's own note, and a stale one is simply replaced.
 * @param {string} search the page's `location.search`
 * @param {{ proposal?: unknown, line?: unknown }|null} stored what this device kept
 * @returns {{ proposalId: string, line: number, ignored: Array<'proposal'|'line'>, view: 'month'|'compare'|'mine' }}
 */
export function initialChoice(search, stored) {
    const params = new URLSearchParams(search || '');
    const codes = new Set(PROPOSALS.map(p => p.code));
    const pick = (/** @type {unknown} */ v) => (typeof v === 'string' && codes.has(v) ? v : null);
    const num = (/** @type {unknown} */ v) => {
        const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,2}$/.test(v) ? Number(v) : NaN;
        return Number.isInteger(n) && n >= 1 && n <= ROTATING_LINES ? n : null;
    };
    const code = pick(params.get('proposal')) ?? pick(stored?.proposal) ?? proposalsAtoZ()[0].code;
    const line = num(params.get('line')) ?? num(stored?.line) ?? 1;
    /** @type {Array<'proposal'|'line'>} */
    const ignored = [];
    if (params.has('proposal') && pick(params.get('proposal')) === null) ignored.push('proposal');
    if (params.has('line') && num(params.get('line')) === null) ignored.push('line');
    // Neither side-by-side view is where the page OPENS by itself (owner: "not as the default view"): only an address that
    // asks for one — a shared link, or a reload of one — and this device never remembers it.
    const asked = params.get(VIEW_PARAM);
    const view = asked === COMPARE_VIEW || asked === MINE_VIEW ? asked : MONTH_VIEW;
    return { proposalId: /** @type {any} */ (PROPOSALS.find(p => p.code === code)).id, line, ignored, view };
}

/**
 * What the page says when the address named something it could not show, or '' when it named nothing wrong. It says what
 * IS shown instead, so a colleague who followed somebody's link knows they are not looking at what was sent.
 * @param {ReadonlyArray<'proposal'|'line'>} ignored from `initialChoice`
 * @param {string} proposalName the proposal shown
 * @param {number} line the line shown
 */
export function ignoredWords(ignored, proposalName, line) {
    const proposal = ignored.includes('proposal'), badLine = ignored.includes('line');
    if (proposal && badLine) return `The link you opened names a proposal and a week that aren’t here, so this shows ${proposalName} from week ${line}.`;
    if (proposal) return `The link you opened names a proposal that isn’t on the shortlist, so this shows ${proposalName}.`;
    if (badLine) return `The link you opened names a week that isn’t one of the ${ROTATING_LINES}, so this shows week ${line}.`;
    return '';
}

/**
 * The refusal card's words for a signed-in colleague the page does not admit. Three answers, each true for its reader:
 * an Other Staff login has no roster line at all; a colleague outside the New CEA Link page's audience (a bilingual
 * contract, a Dispatcher) keeps their own link, so the page will never be for them — said so during the beta too, where
 * "not open to you yet" would promise what it never will; and everybody else is waiting for the beta to end.
 * `newlink` is true only for that last reader: they are in the New CEA Link page's audience, so the card may send them
 * there; neither of the other two can open it. The words state no count of proposals — the shortlist is PROPOSALS, and
 * a number written here is a copy waiting to drift from it.
 * @param {{ otherStaff: boolean, inAudience: boolean }} who `inAudience`: would the page admit them once it opens?
 * @returns {{ title: string, why: string, newlink: boolean }}
 */
export function refusalWords({ otherStaff, inAudience }) {
    if (otherStaff) return { title: 'The Links Selector is for the CEA roster',
        why: 'It shows the proposed new rota for colleagues on a normal CEA contract. An Other Staff login has no roster line, so there is nothing here for it.',
        newlink: false };
    if (!inAudience) return { title: 'The Links Selector doesn’t apply to your contract',
        why: 'It shows the proposed new rota for colleagues on a normal CEA contract, and yours keeps its own link.',
        newlink: false };
    return { title: 'The Links Selector isn’t open to you yet',
        why: 'It is being tried out before it opens. In the meantime, you can compare the proposals on the New CEA Link page.',
        newlink: true };
}

/** The address's word for the view, and its values: `?view=compare` is Compare all, `?view=mine` is Compare with mine, and
 *  no `view` is the month. */
export const VIEW_PARAM = 'view';
export const MONTH_VIEW = 'month';
export const COMPARE_VIEW = 'compare';
export const MINE_VIEW = 'mine';

/** The address's query for a choice. @param {{ code: string }} proposal @param {number} line @param {string} [view] */
export function choiceQuery(proposal, line, view = MONTH_VIEW) {
    return `?proposal=${encodeURIComponent(proposal.code)}&line=${line}${view !== MONTH_VIEW ? `&${VIEW_PARAM}=${view}` : ''}`;
}
