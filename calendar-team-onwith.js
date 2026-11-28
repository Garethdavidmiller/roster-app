// @ts-check
/**
 * calendar-team-onwith.js — Team Week View's "On with" card: the colleagues whose duties overlap one
 * member's shift on one date, longest together first, above the week grid (owner, 27 Nov 2026: "Who's on
 * with me?"). Opened from the day panel's "Who’s on with me" through `showWhoIsOn` (calendar-team-view.js).
 *
 * Owns: who counts as a colleague for the card, the card's words and markup, and which months it reads.
 * Does NOT own: the overlap arithmetic (team-overlap.js, pure and unit-tested), which shift anybody is on
 *   (Team View's `effectiveDay`, handed in — the same resolution its grid cells draw, so the card and the
 *   grid beneath it cannot disagree), fetching (the card's months go through Team View's SHARED month
 *   fetch, never one of its own: CALENDAR_DATA.md 6), or when the card is shown (Team View's state).
 *
 * THREE DAYS, NOT ONE. The day before is read for a colleague's overnight still on in the morning, and the
 * day after for the early a member's own overnight meets. A Sunday's day before is last week, and on the
 * 1st last month — outside the week — so the card says which months it reads (`months`, `dates`), and is
 * WITHHELD like the grid while any of them is still being checked or could not be (`decideDisplay`): a
 * half-read card would list somebody as on with you whose leave had not loaded yet.
 *
 * Nobody absent, on leave or resting is listed, and never a reason: `workedTimes` only answers for a worked
 * day, and the card names a colleague's SHIFT, never why somebody is missing from it. A colleague working
 * with no times recorded is listed apart, "times not recorded" — never "not at the same time", which the
 * card cannot know (team-overlap.js, rule 7).
 */

import { teamMembers, TEAM_GRADES, MONTH_NAMES, escapeHtml, getShiftKind, isWorkedShift, parseISODate } from './roster-data.js';
import { DAY_NAMES_FULL } from './date-format.js';
import { isBeforeMemberStart, parseOtherValue, OTHER_FLAVOURS } from './override-utils.js';
import { worstKnowledge, decideDisplay } from './calendar-data-state.js';
import { workedTimes, whoIsOnWith, rangeText } from './team-overlap.js';

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
 * WHO COUNTS AS A COLLEAGUE: everybody Team View draws, across all three grade tabs — a roster member of a
 * Team View grade who is not `hidden`, and nobody before their start date. `hidden` ALONE, as the grid
 * and every picker filter: management and Other Staff logins are hidden rows (hidden-member-visibility.test.mjs
 * pins that coupling, and refuses a listing surface that grows a rule of its own). Sorted by name, which is
 * the order a tie keeps (team-overlap.js, rule 5).
 * @param {any} shown @param {Date} date @returns {any[]}
 */
export function colleaguesOf(shown, date) {
    return teamMembers
        .filter(m => m !== shown && !m.hidden && TEAM_GRADES.includes(m.role) && !isBeforeMemberStart(m, date))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A shift as the card writes it: its kind's emoji (decorative, so hidden from a screen reader), then what it
 * is and its times with an en dash. Escaped: names and values reach innerHTML.
 * @param {any} member @param {{ shift: string, rdwTime?: string }} day @param {string|null} times
 * @returns {string}
 */
function shiftHtml(member, day, times) {
    const t = times ? escapeHtml(rangeText(times)) : '';
    const ico = (/** @type {string} */ e) => `<span aria-hidden="true">${e}</span> `;
    if (day.shift === 'RDW') return `${ico('💼')}Rest Day Working${t ? ' ' + t : ''}`;
    const other = parseOtherValue(day.shift);
    if (other) return `${ico('🏷️')}${escapeHtml(OTHER_FLAVOURS[other.flavour].full)}${t ? ' ' + t : ''}`;
    if (times) {
        const EMOJI = { early: '☀️', late: '🌙', night: '🦉' };
        return `${ico(EMOJI[getShiftKind(times, member)])}${t}`;
    }
    return escapeHtml(day.shift);
}

/**
 * The card for `onWith`, or nothing when there is none.
 * @param {object} args
 * @param {{ name: string, iso: string }|null} args.onWith  whose shift, on which date
 * @param {(member: any, date: Date) => { shift: string, rdwTime: string }} args.effectiveDay  Team View's resolution
 * @param {(year: number, month: number) => string} args.monthKey  the ONE spelling of a month's key
 * @returns {{ html: string, months: string[], dates: Date[] }}  the markup, the months it reads (for Try
 *   again) and the three dates it reads (for the shared fetch)
 */
export function buildOnWithCard({ onWith, effectiveDay, monthKey }) {
    const none = { html: '', months: [], dates: [] };
    const shown = onWith ? teamMembers.find(m => m.name === onWith.name) : null;
    if (!onWith || !shown) return none;
    const date = dayOf(onWith.iso);
    const dates = [dayOf(onWith.iso, -1), date, dayOf(onWith.iso, 1)];
    const months = [...new Set(dates.map(d => monthKey(d.getFullYear(), d.getMonth())))];
    const name = escapeHtml(shown.name);
    const shell = (/** @type {string} */ body) =>
        `<section class="tv-onwith" id="tvOnWith" aria-labelledby="tvOnWithTitle">`
        + `<div class="tv-onwith-head"><h2 class="tv-onwith-title" id="tvOnWithTitle" tabindex="-1">On with ${name} · ${cardDate(date)}</h2>`
        + `<button type="button" class="tv-onwith-hide" id="tvOnWithHide" aria-label="Hide who’s on with ${name}">Hide</button></div>`
        + body + '</section>';

    const display = decideDisplay(worstKnowledge(months));
    if (display === 'loading' || display === 'unavailable') {
        return { html: shell(`<p class="tv-onwith-note" role="status">${display === 'unavailable'
            ? 'Couldn’t check who is on — shift changes couldn’t be loaded.'
            : 'Checking who is on — loading shift changes.'}</p>`), months, dates };
    }

    const myDay = effectiveDay(shown, date);
    const mine = workedTimes(myDay);
    if (!mine) return { html: shell(`<p class="tv-onwith-note">${name} has no shift with times on ${cardDate(date)}.</p>`), months, dates };

    const people = colleaguesOf(shown, date);
    const days = new Map(people.map(m => [m, dates.map(d => effectiveDay(m, d))]));   // the day before, the day, the day after
    const { together, alsoWorking, timesUnknown } = whoIsOnWith(mine, people.map(m => {
        const [prev, day, next] = /** @type {any[]} */ (days.get(m));
        return { key: m, prev: workedTimes(prev), day: workedTimes(day), next: workedTimes(next), worksDay: isWorkedShift(day.shift) };
    }));
    // A colleague's grade only where it differs from the shown member's: the card lists across the tabs.
    const grade = (/** @type {any} */ m) => m.role === shown.role ? '' : `<span class="tv-onwith-grade">${escapeHtml(m.role)}</span>`;
    // Whose day a neighbouring shift is: an overnight from the day before, or tomorrow's early.
    const whose = (/** @type {-1|0|1} */ day) => day === 0 ? ''
        : ` <span class="tv-onwith-when">${day === -1 ? 'from' : 'on'} ${DAY_NAMES_FULL[dates[day + 1].getDay()]}</span>`;

    const rows = together.map(({ key: m, spans }) => {
        const resolved = /** @type {any[]} */ (days.get(m));
        const parts = spans.map(sp =>
            `<span class="tv-onwith-pair"><span class="tv-onwith-shift">${shiftHtml(m, resolved[sp.day + 1], sp.time)}${whose(sp.day)}</span>`
            + `<span class="tv-onwith-together">Together ${sp.from}–${sp.to}</span></span>`).join('');
        return `<li class="tv-onwith-row"><span class="tv-onwith-name">${escapeHtml(m.name)}${grade(m)}</span>${parts}</li>`;
    }).join('');
    const list = together.length
        ? `<ul class="tv-onwith-list">${rows}</ul>`
        : `<p class="tv-onwith-note">Nobody else is on at the same time as ${name}.</p>`;
    // The rest who are working that day, in two groups: at times that share no minute, and with no times
    // recorded (team-overlap.js, rule 7) — "not at the same time" is a claim the second group cannot carry.
    const group = (/** @type {any[]} */ who, /** @type {string} */ label) => !who.length ? ''
        : `<p class="tv-onwith-also"><span class="tv-onwith-also-label">${label}</span> `
          + who.map(m => {
              const day = /** @type {any[]} */ (days.get(m))[1];
              return `<span class="tv-onwith-also-item">${escapeHtml(m.name)}${grade(m)} ${shiftHtml(m, day, workedTimes(day))}</span>`;
          }).join(' <span aria-hidden="true">·</span> ') + '</p>';
    const also = group(alsoWorking, 'Also working that day, not at the same time:')
        + group(timesUnknown, 'Also working that day, times not recorded:');
    const myLine = `<p class="tv-onwith-mine">${name}’s shift: ${shiftHtml(shown, myDay, mine)}</p>`;
    return { html: shell(myLine + list + also), months, dates };
}
