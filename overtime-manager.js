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
 *
 * ── TWO LENSES, AND ONLY ONE OF THEM CHANGES THE ARITHMETIC ─────────────────────────────────────
 *
 * DAY is a pure hide/show over rows already on the page: the counts do not move, because the count
 * for Tuesday is the count for Tuesday whichever day you are looking at.
 *
 * GRADE is not. A gap in the CEA line is not filled by an available CES, so "Tuesday has two"
 * answers nothing unless those two are the grade you are short of. A filter that dimmed the rows
 * and left the counts alone would be worse than no filter — it would put a number on screen that
 * looks like an answer to the question being asked and is an answer to a different one. So a grade
 * pick RE-RENDERS from the same data, and every figure on the surface follows it.
 *
 * That is also why the whole render is a pure function of `(data, state)` with no incremental DOM
 * work: repainting is cheap, and it makes "the counts agree with the rows" structural rather than
 * something two code paths have to keep remembering.
 */

import {
    shortDate, deadlineLabel, weekSpan, weekLabel, countsCopy, answerCopy, answerTone,
    isUnavailable, asAtLine,
} from './overtime-format.js';

/**
 * Render the workspace into `host`.
 *
 * @param {HTMLElement} host
 * @param {any} win the window row from the planning horizon (carries the stored milestones)
 * @param {{ participants: any[], submissions: Map<string, any> }} data
 * @param {{ dates: string[], now: number }} opts
 */
export function renderWeekDetail(host, win, data, { dates, now }) {
    /** The grade currently in view. `ALL` is not a grade — no participant can carry it as one. */
    let grade = 'ALL';
    /** The day currently in view — `ALL`, or one of the window's dates. */
    let day = 'ALL';
    paint();

    function paint() {
        host.innerHTML = build(win, data, { dates, now, grade, day });
        wireGlance(host, next => { day = next; paint(); });
        wireGrades(host, next => { grade = next; paint(); });
    }
}

/**
 * The grades present in THIS window's frozen population, in roster order.
 *
 * DERIVED, never a fixed list of the app's grades. A hardcoded set would offer a Dispatcher chip on
 * a week with no dispatchers in it — a control that filters to an empty page — and would silently
 * omit a grade added to the roster later. Participants arrive sorted by `rosterOrder`, so first
 * appearance is roster order, which is the order a reviewer already thinks in.
 * @param {any[]} participants
 */
function gradesPresent(participants) {
    /** @type {string[]} */
    const seen = [];
    for (const p of participants || []) {
        if (p.grade && !seen.includes(p.grade)) seen.push(p.grade);
    }
    return seen;
}

/** @param {any[]} participants @param {string} grade */
function ofGrade(participants, grade) {
    return grade === 'ALL' ? participants : participants.filter(p => p.grade === grade);
}

/**
 * The whole surface as one string. Pure — same inputs, same output, no DOM reads.
 * @param {any} win
 * @param {{ participants: any[], submissions: Map<string, any> }} data
 * @param {{ dates: string[], now: number, grade: string, day?: string }} state
 */
function build(win, data, { dates, now, grade, day = 'ALL' }) {
    const { submissions } = data;
    const grades = gradesPresent(data.participants);
    const participants = ofGrade(data.participants, grade);
    const received = participants.filter(p => submissions.has(p.memberName)).length;
    const scope = grade === 'ALL' ? 'All grades' : `${grade} only`;

    return `
        <div class="ot-detail-head">
            <!-- No week name here ON SCREEN. The card header states it two lines above, in
                 otWeekHint, and repeating it immediately below was the same duplication as the page
                 title removed at v20.62 — a surface that has not decided where its subject is named.
                 PRINT is the exception, and the reason is that the card header is chrome and does
                 not print: a sheet of names with no week on it is worse than no sheet, because it
                 can be acted on. So the week is emitted here and shown only on paper. -->
            <div class="ot-print-head" aria-hidden="true">
                <div class="ot-print-title">Overtime availability — ${esc(weekLabel(win.weekEnding))}</div>
                <div class="ot-print-asat">${esc(asAtLine(now))}</div>
                <!-- The grade filter IS carried into print, unlike the day filter — printing one
                     grade's availability is a real thing to want. That makes stating it mandatory:
                     a sheet showing four CEAs with no scope line reads as the whole team. -->
                <div class="ot-print-scope">${esc(scope)}</div>
            </div>
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
        ${gradeStrip(grades, grade)}
        ${glanceStrip(dates, participants, submissions, day)}
        ${dates.map(date => dayPanel(date, participants, submissions, day)).join('')}
        ${awaitingPanel(participants, submissions)}`;
}

/**
 * Filter the week to one grade.
 *
 * Rendered ONLY when the window holds more than one grade. A single-grade week would get a control
 * with one real option beside "All" — inert, and an inert control is worse than an absent one
 * because it invites a press that changes nothing.
 *
 * "Grade" rather than "role" is the app's own word for these values: it is what the login dropdown
 * groups by, and what every person row on this very page already prints beside the name.
 * @param {string[]} grades @param {string} active
 */
function gradeStrip(grades, active) {
    if (grades.length < 2) return '';
    const chip = (/** @type {string} */ value, /** @type {string} */ label) => `<button type="button" class="ot-grade" data-grade="${esc(value)}"
                    aria-pressed="${value === active}">${esc(label)}</button>`;
    return `
        <div class="ot-grades" role="group" aria-label="Filter by grade">
            ${chip('ALL', 'All grades')}
            ${grades.map(g => chip(g, g)).join('')}
        </div>`;
}

/**
 * @param {HTMLElement} host @param {(grade: string) => void} onPick
 * Same enhancement-over-complete-markup contract as `wireGlance`: the unfiltered week is already
 * rendered and correct before this runs.
 */
function wireGrades(host, onPick) {
    if (typeof host?.querySelectorAll !== 'function') return;
    host.querySelectorAll('[data-grade]').forEach(chip =>
        chip.addEventListener('click', () => onPick(String(chip.getAttribute('data-grade')))));
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
 * @param {string[]} dates @param {any[]} participants @param {Map<string, any>} submissions @param {string} activeDay
 */
function glanceStrip(dates, participants, submissions, activeDay) {
    const chips = dates.map(date => {
        const n = participants.filter(p => {
            const sub = submissions.get(p.memberName);
            return sub && !isUnavailable(sub.days?.[date]);
        }).length;
        const tone = n === 0 ? 'none' : (n <= 2 ? 'low' : 'ok');
        return `<button type="button" class="ot-glance-day ot-glance-day--${tone}"
                        data-glance="${esc(date)}" aria-pressed="${date === activeDay}">
                    <span class="ot-glance-name">${esc(shortDate(date))}</span>
                    <span class="ot-glance-count">${n}</span>
                </button>`;
    }).join('');
    return `
        <div class="ot-glance" role="group" aria-label="Available staff by day — choose a day to show only that day">
            <button type="button" class="ot-glance-day ot-glance-day--all" data-glance="ALL" aria-pressed="${activeDay === 'ALL'}">
                <span class="ot-glance-name">All week</span>
            </button>
            ${chips}
        </div>`;
}

/**
 * Same enhancement-over-complete-markup contract as `wireGrades`: the default render carries every
 * day panel visible, so a host without query methods (the two-line fake DOM the render tests use)
 * simply gets the unfiltered week. The guard is what keeps the render testable without a browser.
 *
 * ── STATE, NOT A HAND-TOGGLED DOM — SO A GRADE SWITCH KEEPS THE DAY ─────────────────────────────
 *
 * Until v20.75 this handler flipped `hidden` on the panels directly while the grade chips
 * re-rendered the whole surface — two mechanisms over one view, and the repaint silently reset the
 * day to "All week". A clerk looking at Saturday's CEAs who tapped CES was bounced back to the
 * full week with no sign of why. Both lenses now go through the same `(data, state) → markup`
 * render, which is the module's own stated model.
 * @param {HTMLElement} host @param {(day: string) => void} onPick
 */
function wireGlance(host, onPick) {
    if (typeof host?.querySelectorAll !== 'function') return;
    host.querySelectorAll('[data-glance]').forEach(chip =>
        chip.addEventListener('click', () => onPick(String(chip.getAttribute('data-glance')))));
}

/** One date: available, not available, no response — three sections, never merged. */
/** @param {string} date @param {any[]} participants @param {Map<string, any>} submissions @param {string} activeDay */
function dayPanel(date, participants, submissions, activeDay = 'ALL') {
    /** @type {string[]} */ const available = [];
    /** @type {string[]} */ const unavailable = [];
    /** @type {string[]} */ const noResponse = [];

    for (const p of participants) {
        const sub = submissions.get(p.memberName);
        if (!sub) { noResponse.push(personRow(p, null, null)); continue; }
        const day = sub.days?.[date];
        const row = personRow(p, day, sub.history);
        (isUnavailable(day) ? unavailable : available).push(row);
    }

    // `hidden` in the MARKUP, not toggled afterwards — the render stays a pure function of state.
    // The default state hides nothing, so script-off (and the fake-DOM tests) get the whole week;
    // print CSS force-shows hidden panels, so a filtered screen still yields an unfiltered sheet.
    const hide = activeDay !== 'ALL' && activeDay !== date;
    return `
        <div class="ot-day-panel" data-date="${esc(date)}"${hide ? ' hidden' : ''}>
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

/**
 * One person on one date: who, what grade, and what they said — the last as a BADGE, in the same
 * chip language the calendar and the roster-review table use for a day's state.
 *
 * `day` is the stored answer, not a rendered string: the words and the tone are two views of the
 * same value and deriving them from one argument is what stops a green chip ever reading
 * "Not available". Pass `null` for somebody who has not answered at all — that is a real state
 * (`none`), not a missing string.
 * @param {any} p @param {any} day @param {any} history
 */
function personRow(p, day, history) {
    const flags = [];
    if (history?.lateInitial) flags.push('Submitted after initial deadline');
    else if (history?.changedSinceInitial) flags.push('Changed since initial deadline');
    return `
        <div class="ot-person">
            <span class="ot-person-name">${esc(p.memberName)}</span>
            ${p.grade ? `<span class="ot-person-grade">${esc(p.grade)}</span>` : ''}
            ${day ? `<span class="ot-answer ot-answer--${answerTone(day)}">${esc(answerCopy(day))}</span>` : ''}
            ${flags.length ? `<div class="ot-person-flags">${
                flags.map(f => `<span class="ot-person-flag">${esc(f)}</span>`).join('')}</div>` : ''}
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
                ? waiting.map(p => personRow(p, null, null)).join('')
                : '<div class="ot-section-empty">Everyone has responded</div>'}
        </div>`;
}

/** @param {any} s */
function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
