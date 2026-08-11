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
        ${dates.map(date => dayPanel(date, participants, submissions)).join('')}
        ${awaitingPanel(participants, submissions)}`;
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
        <div class="ot-day-panel">
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
