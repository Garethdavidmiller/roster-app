// @ts-check
/**
 * calendar-team-onwith.js — Team Week View's "On with" card: the colleagues whose duties overlap one
 * member's shift on one date, by role, above the week grid (owner, 27 Nov 2026: "Who's on with me?").
 * Opened from the day panel's "Who’s on with me" through `showWhoIsOn` (calendar-team-view.js).
 *
 * Owns: who counts as a colleague for the card, the card's words and markup, which months it reads, and
 *   which dates it answers for.
 * Does NOT own: the overlap arithmetic or its order (team-overlap.js, pure and unit-tested), which shift
 *   anybody is on (Team View's `effectiveDay`, handed in — the same resolution its grid cells draw, so the
 *   card and the grid beneath it cannot disagree), how a shift LOOKS (Team View's own cell, `cellDisplay`,
 *   handed in: the card's shifts are the grid's cells — tint, emoji and words), fetching (the card's months
 *   go through Team View's SHARED month fetch, never one of its own: CALENDAR_DATA.md 6), or when the card
 *   is shown (Team View's state).
 *
 * THE REDESIGN (owner, 28 Nov 2026: "very ugly and clunky. It also needs to be by role. I do not need to see
 * who I am on in the past with either"). Three rules came of it, each easy to undo:
 *   · BY ROLE — one section per Team View grade tab (CEA, CES, Dispatcher), the member's own role first and
 *     the rest in the tabs' order (`rolesInOrder`), so the card is organised as the grid beneath it is. One
 *     list of every role mixed, a grade tag on some rows, was the defect.
 *   · TODAY AND LATER ONLY (`isPastDay`) — the day panel offers no button on a past day, and a past date
 *     reached any other way (a panel left open over midnight) draws nothing.
 *   · ONE LINE A COLLEAGUE — the name, their shift as the grid cell draws it, and the stretch together said
 *     quietly (`togetherWords`), in three tracks of fixed width (index.css) so every row lines up and none
 *     wraps at 320px. Colleagues working at times that share no minute are NOT listed: the grid beneath
 *     shows them, and a second list of them was most of the clutter.
 *
 * THREE DAYS, NOT ONE. The day before is read for a colleague's overnight still on in the morning, and the
 * day after for the early a member's own overnight meets. A Sunday's day before is last week, and on the
 * 1st last month — outside the week — so the card says which months it reads (`months`, `dates`), and is
 * WITHHELD like the grid while any of them is still being checked or could not be (`decideDisplay`): a
 * half-read card would list somebody as on with you whose leave had not loaded yet.
 *
 * Nobody absent, on leave or resting is listed, and never a reason: `workedTimes` only answers for a worked
 * day, and the card names a colleague's SHIFT, never why somebody is missing from it. A colleague working
 * with no times recorded is listed apart, "times not recorded" — never as not on with you, which the card
 * cannot know (team-overlap.js, rule 7).
 */

import { teamMembers, TEAM_GRADES, MONTH_NAMES, escapeHtml, isWorkedShift, parseISODate } from './roster-data.js';
import { DAY_NAMES, DAY_NAMES_FULL } from './date-format.js';
import { isBeforeMemberStart } from './override-utils.js';
import { worstKnowledge, decideDisplay } from './calendar-data-state.js';
import { workedTimes, whoIsOnWith, togetherWords } from './team-overlap.js';

/**
 * Local midnight of `iso`, moved by `by` days. Parsed with `parseISODate` (local noon), never
 * `new Date(str)`, which is UTC midnight and the previous day anywhere behind UTC.
 * @param {string} iso @param {number} [by] @returns {Date}
 */
export function dayOf(iso, by = 0) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() + by);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** "Friday 27 November" — the card's date, read to keep in mind rather than squeezed between arrows.
 *  @param {Date} d @returns {string} */
export const cardDate = (d) => `${DAY_NAMES_FULL[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;

/**
 * Is `iso` a day before `today`'s? The card answers for today and later only (the header). Compared as local
 * dates, so 23:59 today is still today.
 * @param {string} iso @param {Date} today @returns {boolean}
 */
export function isPastDay(iso, today) {
    const t = new Date(today);
    t.setHours(0, 0, 0, 0);
    return dayOf(iso).getTime() < t.getTime();
}

/**
 * WHO COUNTS AS A COLLEAGUE: everybody Team View draws, across all three grade tabs — a roster member of a
 * Team View grade who is not `hidden`, and nobody before their start date. `hidden` ALONE, as the grid
 * and every picker filter: management and Other Staff logins are hidden rows (hidden-member-visibility.test.mjs
 * pins that coupling, and refuses a listing surface that grows a rule of its own). Sorted by name, which is
 * the order a tie keeps (team-overlap.js, rule 5). The card then groups them by `role`.
 * @param {any} shown @param {Date} date @returns {any[]}
 */
export function colleaguesOf(shown, date) {
    return teamMembers
        .filter(m => m !== shown && !m.hidden && TEAM_GRADES.includes(m.role) && !isBeforeMemberStart(m, date))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The roles the card lists, in order: the shown member's own first, then the rest in the grade tabs' order.
 * @param {string} own @returns {string[]}
 */
export function rolesInOrder(own) {
    return TEAM_GRADES.includes(own) ? [own, ...TEAM_GRADES.filter(g => g !== own)] : [...TEAM_GRADES];
}

/**
 * @typedef {(member: any, date: Date) => { text: string, cls: string, label?: string }} CellDisplay
 *   Team View's own cell: `text` is markup, already escaped; `cls` its tint class; `label` its words.
 */

/**
 * A shift as the grid's cell draws it: the same tint class, emoji and text, read out as the cell's label. A
 * neighbouring day's shift says whose day it is ("Fri") inside the chip.
 * @param {CellDisplay} cellDisplay @param {any} member @param {Date} date
 * @param {boolean} [sameDay]  false for a neighbouring day's shift
 * @returns {string}
 */
function shiftChip(cellDisplay, member, date, sameDay = true) {
    const { text, cls, label } = cellDisplay(member, date);
    const when = sameDay ? '' : `<span class="tv-onwith-day">${DAY_NAMES[date.getDay()]}</span> `;
    const said = (sameDay ? '' : `${DAY_NAMES_FULL[date.getDay()]}: `) + (label ?? '');
    return `<span class="tv-onwith-shift ${cls}"><span aria-hidden="true">${when}${text}</span>`
        + `<span class="visually-hidden">${escapeHtml(said)}</span></span>`;
}

/**
 * The card for `onWith`, or nothing when there is none, or when its date is past.
 * @param {object} args
 * @param {{ name: string, iso: string }|null} args.onWith  whose shift, on which date
 * @param {(member: any, date: Date) => { shift: string, rdwTime: string }} args.effectiveDay  Team View's resolution
 * @param {CellDisplay} args.cellDisplay  Team View's cell for a member on a date
 * @param {(year: number, month: number) => string} args.monthKey  the ONE spelling of a month's key
 * @param {Date} args.today  the clock, handed in so the past-day rule is testable at its boundary
 * @returns {{ html: string, months: string[], dates: Date[] }}  the markup, the months it reads (for Try
 *   again) and the three dates it reads (for the shared fetch)
 */
export function buildOnWithCard({ onWith, effectiveDay, cellDisplay, monthKey, today }) {
    const none = { html: '', months: [], dates: [] };
    const shown = onWith ? teamMembers.find(m => m.name === onWith.name) : null;
    if (!onWith || !shown || isPastDay(onWith.iso, today)) return none;
    const date = dayOf(onWith.iso);
    const dates = [dayOf(onWith.iso, -1), date, dayOf(onWith.iso, 1)];
    const months = [...new Set(dates.map(d => monthKey(d.getFullYear(), d.getMonth())))];
    const name = escapeHtml(shown.name);
    const shell = (/** @type {string} */ mine, /** @type {string} */ body) =>
        `<section class="tv-onwith" id="tvOnWith" aria-labelledby="tvOnWithTitle tvOnWithWhen">`
        + `<div class="tv-onwith-head"><h2 class="tv-onwith-title" id="tvOnWithTitle" tabindex="-1">On with ${name}</h2>`
        + `<button type="button" class="tv-onwith-hide" id="tvOnWithHide" aria-label="Hide who’s on with ${name}">Hide</button></div>`
        + `<p class="tv-onwith-mine"><span id="tvOnWithWhen">${cardDate(date)}</span>${mine}</p>`
        + body + '</section>';

    const display = decideDisplay(worstKnowledge(months));
    if (display === 'loading' || display === 'unavailable') {
        return { html: shell('', `<p class="tv-onwith-note" role="status">${display === 'unavailable'
            ? 'Couldn’t check who is on — shift changes couldn’t be loaded.'
            : 'Checking who is on — loading shift changes.'}</p>`), months, dates };
    }

    const myDay = effectiveDay(shown, date);
    const mine = workedTimes(myDay);
    if (!mine) return { html: shell('', `<p class="tv-onwith-note">${name} has no shift with times that day.</p>`), months, dates };

    const people = colleaguesOf(shown, date);
    const days = new Map(people.map(m => [m, dates.map(d => effectiveDay(m, d))]));   // the day before, the day, the day after
    const { together, timesUnknown } = whoIsOnWith(mine, people.map(m => {
        const [prev, day, next] = /** @type {any[]} */ (days.get(m));
        return { key: m, prev: workedTimes(prev), day: workedTimes(day), next: workedTimes(next), worksDay: isWorkedShift(day.shift) };
    }));

    // One row a colleague; a colleague with two stretches (an overnight either side as well as the day's) has
    // a line for each, the name beside the first (`data-lines`, index.css).
    const row = (/** @type {any} */ m, /** @type {string} */ cells, /** @type {number} */ lines) =>
        `<li class="tv-onwith-row"${lines > 1 ? ` data-lines="${lines}"` : ''}><span class="tv-onwith-name">${escapeHtml(m.name)}</span>${cells}</li>`;
    const sections = rolesInOrder(shown.role).map(role => {
        const on = together.filter(t => t.key.role === role).map(({ key: m, spans }) => row(m, spans.map(sp =>
            shiftChip(cellDisplay, m, dates[sp.day + 1], sp.day === 0)
            + `<span class="tv-onwith-when"><span class="visually-hidden">together </span>${togetherWords(mine, sp)}</span>`).join(''), spans.length));
        const unknown = timesUnknown.filter(m => m.role === role).map(m => row(m, shiftChip(cellDisplay, m, date), 1));
        const id = `tvOnWithRole-${escapeHtml(role)}`;
        return `<div class="tv-onwith-group"><h3 class="tv-onwith-role" id="${id}">${escapeHtml(role)}</h3>`
            + (on.length ? `<ul class="tv-onwith-list" aria-labelledby="${id}">${on.join('')}</ul>`
                : '<p class="tv-onwith-none">Nobody on at the same time</p>')
            + (unknown.length ? '<p class="tv-onwith-sub">Also working, times not recorded</p>'
                + `<ul class="tv-onwith-list">${unknown.join('')}</ul>` : '') + '</div>';
    }).join('');
    return { html: shell(shiftChip(cellDisplay, shown, date), `<div class="tv-onwith-roles">${sections}</div>`), months, dates };
}
