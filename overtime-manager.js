// @ts-check
/**
 * overtime-manager.js — the reviewer's workspace for ONE selected week.
 *
 * Owns: the three views built from a week's data — By day, Awaiting, and the change indicators.
 * Every WORD comes from `overtime-format.js`; the READ is `loadWeekDetail` in `overtime-data.js`;
 * the planning horizon that got the reviewer here belongs to `overtime-app.js`.
 *
 * ── NO FIREBASE IMPORT, DELIBERATELY ────────────────────────────────────────────────────────────
 *
 * `firebase-client.js` statically imports the SDK from the gstatic CDN, so anything importing it is
 * unloadable in a Node test — the same constraint that produced `storage-utils.js`, `auth-identity.js`
 * and `client-errors.js`. This module writes one string into a host element, which is exactly the
 * part worth testing exhaustively, so the read lives next door and this stays reachable from
 * `overtime-manager.test.mjs` with a two-line fake DOM.
 *
 * ── BY DAY IS FIRST BECAUSE IT IS THE QUESTION ──────────────────────────────────────────────────
 *
 * The clerk is not browsing people; they are filling a Saturday. So the primary view groups by
 * DATE and, within a date, into three sections that must never merge:
 *
 *     Available     ·  what they offered, with the times
 *     Not available ·  an explicit answer
 *     No response   ·  no form at all — UNKNOWN, and not a decision
 *
 * The third is the one under constant pressure to be folded into the second, because they look
 * alike in a list and a shorter list is tidier. They are opposites: one person said no, the other
 * said nothing, and a clerk who cannot tell them apart cannot know who is worth a phone call.
 */

import {
    shortDate, deadlineLabel, weekLabel, weekSpan, countsCopy, answerCopy, isUnavailable,
} from './overtime-format.js';

/**
 * Render the workspace into `host`.
 *
 * @param {HTMLElement} host
 * @param {any} win the window row from the planning horizon (carries the stored milestones)
 * @param {{ participants: any[], submissions: Map<string, any> }} data
 * @param {{ dates: string[] }} opts
 */
export function renderWeekDetail(host, win, data, { dates }) {
    const { participants, submissions } = data;
    const received = participants.filter(p => submissions.has(p.memberName)).length;

    host.innerHTML = `
        <div class="ot-detail-head">
            <div class="ot-detail-week">${esc(weekLabel(win.weekEnding))}</div>
            <div class="ot-detail-meta">
                Roster week ${esc(weekSpan(win.weekStart, win.weekEnding))} ·
                final deadline ${esc(deadlineLabel(win.finalDeadlineAt))}
            </div>
            <div class="ot-detail-counts">${esc(countsCopy(participants.length, received))}</div>
            ${win.audience === 'restricted'
                ? `<div class="ot-detail-audience">Beta audience · ${participants.length} expected `
                  + `${participants.length === 1 ? 'participant' : 'participants'}</div>`
                : ''}
        </div>
        <div class="ot-current-note">
            Availability reflects what staff submitted before the final cut-off. Confirm directly
            with the employee before arranging short-notice cover.
        </div>
        ${glanceStrip(dates, participants, submissions)}
        ${dates.map(date => dayPanel(date, participants, submissions)).join('')}
        ${awaitingPanel(participants, submissions)}`;

    wireGlance(host);
}

/**
 * THE WHOLE WEEK IN ONE LINE, and a way to look at one day of it.
 *
 * ── WHY A LIST OF DAYS WAS NOT ENOUGH ───────────────────────────────────────────────────────────
 *
 * The by-day view answers "who can work Saturday?" correctly and, at full roster size, slowly: seven
 * day panels, three sections each, **308 name rows**. A clerk filling one shift on one day had to
 * scroll past six days they did not ask about, and — worse — could not see where the WEEK was
 * thin without reading all of it. The count that matters most ("Tuesday has two people") was
 * derivable from the page and stated nowhere on it.
 *
 * So the week opens with one row of seven days, each showing how many are available, and a day with
 * NOBODY says so in its own colour rather than by being an empty section further down. Tapping a day
 * shows only that day; "All week" brings them back. Nothing is hidden that was not already there —
 * this is a lens over the same rows, not a summary that could disagree with them.
 * @param {string[]} dates @param {any[]} participants @param {Map<string, any>} submissions
 */
function glanceStrip(dates, participants, submissions) {
    const chips = dates.map(date => {
        const n = participants.filter(p => {
            const sub = submissions.get(p.memberName);
            return sub && !isUnavailable(sub.days?.[date]);
        }).length;
        const tone = n === 0 ? 'none' : (n <= 2 ? 'low' : 'ok');
        return `<button type="button" class="ot-glance-day ot-glance-day--${tone}"
                        data-glance="${esc(date)}" aria-pressed="false">
                    <span class="ot-glance-name">${esc(shortDate(date))}</span>
                    <span class="ot-glance-count">${n}</span>
                </button>`;
    }).join('');
    return `
        <div class="ot-glance" role="group" aria-label="Available staff by day — choose a day to show only that day">
            <button type="button" class="ot-glance-day ot-glance-day--all" data-glance="ALL" aria-pressed="true">
                <span class="ot-glance-name">All week</span>
            </button>
            ${chips}
        </div>`;
}

/**
 * Chips filter the day panels already on the page — no re-fetch, no second source of truth.
 *
 * A genuine ENHANCEMENT over markup that is already complete and correct: every day is rendered and
 * visible before this runs, so a host without query methods (the two-line fake DOM the render tests
 * use, which is the right level for asserting what the markup SAYS) simply gets the unfiltered week.
 * The guard is what keeps the render testable without a browser — not a swallowed error.
 * @param {HTMLElement} host
 */
function wireGlance(host) {
    if (typeof host?.querySelectorAll !== 'function') return;
    const chips = [...host.querySelectorAll('[data-glance]')];
    const panels = [...host.querySelectorAll('.ot-day-panel[data-date]')];
    chips.forEach(chip => chip.addEventListener('click', () => {
        const pick = chip.getAttribute('data-glance');
        chips.forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
        panels.forEach(pnl => {
            const show = pick === 'ALL' || pnl.getAttribute('data-date') === pick;
            // `hidden` alone would not hide it — `.ot-day-panel` sets no display, but the companion
            // rule in overtime.css keeps this honest either way. See page-visibility-parity.
            /** @type {any} */ (pnl).hidden = !show;
        });
    }));
}

/** One date: available, not available, no response — three sections, never merged. */
/** @param {string} date @param {any[]} participants @param {Map<string, any>} submissions */
function dayPanel(date, participants, submissions) {
    /** @type {string[]} */ const available = [];
    /** @type {string[]} */ const unavailable = [];
    /** @type {string[]} */ const noResponse = [];

    for (const p of participants) {
        const sub = submissions.get(p.memberName);
        if (!sub) { noResponse.push(personRow(p, '', null)); continue; }
        const day = sub.days?.[date];
        const row = personRow(p, answerCopy(day), sub.history);
        (isUnavailable(day) ? unavailable : available).push(row);
    }

    return `
        <div class="ot-day-panel" data-date="${esc(date)}">
            <div class="ot-day-panel-head">${esc(shortDate(date))}</div>
            ${section('Available', available, 'ok')}
            ${section('Not available', unavailable, 'muted')}
            ${section('No response', noResponse, 'unknown')}
        </div>`;
}

/** @param {string} title @param {string[]} rows @param {string} tone */
function section(title, rows, tone) {
    // An EMPTY section still renders its heading and says so. Hiding it would make "nobody is
    // available on Saturday" indistinguishable from "the Saturday section did not render".
    return `
        <div class="ot-section ot-section--${tone}">
            <div class="ot-section-head">${esc(title)} <span class="ot-section-count">${rows.length}</span></div>
            ${rows.length ? rows.join('') : '<div class="ot-section-empty">Nobody</div>'}
        </div>`;
}

/** @param {any} p @param {string} answer @param {any} history */
function personRow(p, answer, history) {
    const flags = [];
    if (history?.lateInitial) flags.push('Submitted after initial deadline');
    else if (history?.changedSinceInitial) flags.push('Changed since initial deadline');
    return `
        <div class="ot-person">
            <span class="ot-person-name">${esc(p.memberName)}</span>
            ${p.grade ? `<span class="ot-person-grade">${esc(p.grade)}</span>` : ''}
            ${answer ? `<span class="ot-person-answer">${esc(answer)}</span>` : ''}
            ${flags.map(f => `<span class="ot-person-flag">${esc(f)}</span>`).join('')}
        </div>`;
}

/** The people who have not answered at all — the list a reminder or a phone call works from. */
/** @param {any[]} participants @param {Map<string, any>} submissions */
function awaitingPanel(participants, submissions) {
    const waiting = participants.filter(p => !submissions.has(p.memberName));
    return `
        <div class="ot-day-panel">
            <div class="ot-day-panel-head">Awaiting a form</div>
            ${waiting.length
                ? waiting.map(p => personRow(p, '', null)).join('')
                : '<div class="ot-section-empty">Everyone has responded</div>'}
        </div>`;
}

/** @param {any} s */
function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
