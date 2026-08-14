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
    isUnavailable, isAvailableAnswer, asAtLine, rosterBadge, sameAnswer, answerAnchorStale,
    declaredAgo, isWithdrawn, withdrawnLine,
} from './overtime-format.js';

/**
 * Render the workspace into `host`.
 *
 * @param {HTMLElement} host
 * @param {any} win the window row from the planning horizon (carries the stored milestones)
 * @param {{ participants: any[], submissions: Map<string, any>,
 *   roster?: Record<string, Record<string, any>>, rosterKnown?: boolean }} data
 * @param {{ dates: string[], now: number, grade?: string, onGrade?: (g: string) => void,
 *   onAsk?: (memberName: string, ask: boolean) => void }} opts
 *   `grade` is the reviewer's standing choice, handed back in by the coordinator; `onGrade` is how
 *   it gets there. See below. `onAsk` is the only MUTATION this module can start: it hands the
 *   decision straight back out, because writing is the coordinator's job and this module is a pure
 *   render everywhere else — which is what makes it testable with a two-line fake DOM.
 */
export function renderWeekDetail(host, win, data, { dates, now, grade: initialGrade = 'ALL', onGrade, onAsk }) {
    /**
     * The grade currently in view. `ALL` is not a grade — no participant can carry it as one.
     *
     * ── IT SURVIVES A WEEK SWITCH, BECAUSE IT IS ABOUT THE REVIEWER, NOT THE WEEK ───────────────
     *
     * This used to reset to `ALL` on every render, and every week switch is a fresh render — so a
     * clerk working the CEA line was returned to the whole team each time they moved between weeks,
     * which is most of what this page is for. Exactly the defect fixed for the DAY lens at v20.75,
     * one level up and still there.
     *
     * The DAY deliberately does not persist: its values are this window's dates, so carrying one
     * into another week would filter to a date that week does not contain. Grade is a property of
     * the person reading, and their job does not change when they look at a different Saturday.
     *
     * The choice is held by the coordinator rather than a module-level variable so it lives exactly
     * as long as the page does — a `let` up here would be shared process state that no reload
     * clears and no test can reset.
     */
    let grade = initialGrade;
    /** The day currently in view — `ALL`, or one of the window's dates. */
    let day = 'ALL';
    paint();

    function paint() {
        host.innerHTML = build(win, data, { dates, now, grade, day });
        wireGlance(host, next => { day = next; paint(); });
        wireGrades(host, next => { grade = next; onGrade?.(next); paint(); });
        wireAsk(host, onAsk);
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
 * When this window's population was FROZEN — the earliest participant's creation instant.
 *
 * ── A DENOMINATOR THAT MOVES OVERNIGHT MUST SAY SO ──────────────────────────────────────────────
 *
 * The nightly job tops up every still-open window with anybody newly eligible, so "1 of 1 received"
 * on Monday can be "1 of 2 received · 1 no response" on Tuesday with nothing on screen accounting
 * for it. A reviewer cannot tell that apart from somebody who stopped answering — and one of those
 * is worth a phone call while the other is not.
 *
 * Everybody frozen at creation is written in ONE batch and shares a commit timestamp, so the
 * earliest is the freeze instant and anybody materially later was added afterwards. Derived rather
 * than stored: the window's own `createdAt` would be a second copy of the same fact, free to drift.
 *
 * Returns 0 when it cannot be established, which reads as "nobody was added late" — the quiet
 * direction, because a wrongly-marked row accuses the system of something it may not have done.
 * @param {any[]} participants
 * @returns {number}
 */
function frozenAt(participants) {
    const times = (participants || []).map(p => p.createdAt).filter(t => typeof t === 'number' && t > 0);
    return times.length ? Math.min(...times) : 0;
}

/**
 * Tolerance on that comparison. One batch's writes share a commit time, but not to the millisecond
 * across a retry, and a marker that fires on batch jitter would appear on the whole population at
 * once — which is worse than never appearing, because it would train a reviewer to ignore it.
 */
const ADDED_LATER_TOLERANCE_MS = 60_000;

/**
 * The whole surface as one string. Pure — same inputs, same output, no DOM reads.
 * @param {any} win
 * @param {{ participants: any[], submissions: Map<string, any>,
 *   roster?: Record<string, Record<string, any>>, rosterKnown?: boolean }} data
 * @param {{ dates: string[], now: number, grade: string, day?: string }} state
 */
function build(win, data, { dates, now, grade, day = 'ALL' }) {
    const { submissions } = data;
    // WITHDRAWN COMES OFF FIRST, before the grade filter and before anything is counted. A person
    // who has left is not somebody the week is short of an answer from, and leaving them in the
    // panels is how a reviewer ends up ringing them — which is the whole reason withdrawal exists.
    // The grade chips are computed from the remaining population too, or a grade could survive in
    // the strip with nobody under it.
    const active = (data.participants || []).filter(p => !isWithdrawn(p));
    const withdrawn = (data.participants || []).filter(isWithdrawn);
    const grades = gradesPresent(active);
    const participants = ofGrade(active, grade);
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
        <!-- TWO sentences, and the second one is a boundary rather than a caution (owner, Aug 2026).
             Availability is offered AROUND what somebody is already rostered; it is never an offer
             to move or give up a rostered duty. "All day" beside an 07:00–15:00 shift had three
             readings and the app committed to none, and the dangerous one — that the clerk may take
             the duty away — costs a member the shift they planned their week around. It lives here
             rather than only in the help panel because a tip is opt-in and this is a rule.
             (No backticks in this comment: it sits inside a template literal, and one would end it
             — the same trap that broke the calendar lock panel earlier.) -->
        <div class="ot-current-note">
            Availability reflects what staff submitted before the final cut-off. Confirm directly
            with the employee before arranging short-notice cover.
            <strong>What people offer here is time around whatever they are already rostered</strong>
            — it is never an offer to change or give up a rostered duty.
        </div>
        ${gradeStrip(grades, grade)}
        ${glanceStrip(dates, participants, submissions, day)}
        ${dates.map(date => dayPanel(date, participants, submissions, day, data.roster || {},
            { now, frozenAt: frozenAt(active) })).join('')}
        ${awaitingPanel(participants, submissions, { now, frozenAt: frozenAt(active) })}
        ${askedPanel(participants, submissions, win.phase === 'CLOSED')}
        ${withdrawnPanel(ofGrade(withdrawn, grade), win.phase === 'CLOSED')}`;
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
 * Wire the two participation controls. Same enhancement-over-complete-markup contract as the rest:
 * without a handler the buttons are simply inert, and the week still reads correctly.
 *
 * Nothing here re-renders. The write is asynchronous and can fail, so the page must not show the
 * person moving between panels before the server has agreed — that is the shape of an optimistic
 * update, and on this control it would tell a reviewer somebody had been taken out of the counts
 * when they had not.
 * @param {HTMLElement} host @param {((memberName: string, ask: boolean) => void) | undefined} onAsk
 */
function wireAsk(host, onAsk) {
    if (typeof host?.querySelectorAll !== 'function' || !onAsk) return;
    host.querySelectorAll('[data-stop-asking]').forEach(btn =>
        btn.addEventListener('click', () => onAsk(String(btn.getAttribute('data-stop-asking')), false)));
    host.querySelectorAll('[data-ask-again]').forEach(btn =>
        btn.addEventListener('click', () => onAsk(String(btn.getAttribute('data-ask-again')), true)));
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
            // POSITIVE. `!isUnavailable(undefined)` is true, so the negation counted a member
            // whose submission lacked this date as available — inventing a body for a shift.
            return sub && isAvailableAnswer(sub.days?.[date]);
        }).length;
        // ── ZERO IS A JUDGEMENT THE APP CAN MAKE; "ENOUGH" IS NOT (v20.87, external audit) ──────
        //
        // There used to be a third tone: 1–2 was amber, 3+ was plain. That put the app's opinion on
        // a number it has no basis for. Four people all available only before 07:00 does not fill a
        // 15:00–23:00 vacancy, and two available all day might fill two — the count alone cannot
        // tell them apart, because only the reviewer knows which shift is short.
        //
        // Zero survives, because zero is the one figure that means the same thing whatever the
        // vacancy: nobody offered anything, so this day cannot be solved from this page at all.
        const tone = n === 0 ? 'none' : 'some';
        return `<button type="button" class="ot-glance-day ot-glance-day--${tone}"
                        data-glance="${esc(date)}" aria-pressed="${date === activeDay}"
                        aria-label="${esc(shortDate(date))} — ${n} with some availability">
                    <span class="ot-glance-name">${esc(shortDate(date))}</span>
                    <span class="ot-glance-count">${n}</span>
                </button>`;
    }).join('');
    return `
        <div class="ot-glance" role="group" aria-label="Staff with some availability, by day — choose a day to show only that day">
            <button type="button" class="ot-glance-day ot-glance-day--all" data-glance="ALL" aria-pressed="${activeDay === 'ALL'}">
                <span class="ot-glance-name">All week</span>
            </button>
            ${chips}
        </div>
        <!-- Says what the numbers ARE. Without it a bare row of counts invites the reading the
             tones no longer offer — that a bigger number is a solved day. -->
        <p class="ot-glance-note">Each number is how many people offered SOME availability that
        day — not whether it covers the shift you need.</p>`;
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
/** @param {string} date @param {any[]} participants @param {Map<string, any>} submissions
 *  @param {string} activeDay @param {Record<string, Record<string, any>>} roster */
function dayPanel(date, participants, submissions, activeDay = 'ALL', roster = {}, meta = {}) {
    /** @type {string[]} */ const available = [];
    /** @type {string[]} */ const unavailable = [];
    /** @type {string[]} */ const noResponse = [];

    for (const p of participants) {
        const ctx = roster[p.memberName]?.[date] || null;
        const sub = submissions.get(p.memberName);
        if (!sub) { noResponse.push(personRow(p, null, null, ctx, null, meta)); continue; }
        const day = sub.days?.[date];
        const row = personRow(p, day, sub.history, ctx,
            sub.history?.initialRevision?.days?.[date], meta, sub.updatedAt);
        // THREE-VALUED, asked positively (v20.87). It used to be `isUnavailable(day) ? unavailable
        // : available`, whose negation is TRUE for a missing day — so a submission that somehow
        // lacked this date filed that person under Available, with no answer chip beside their
        // name to contradict it. Now each section requires its own positive answer, and a day
        // neither of them claims falls through to No response, which is what it is: they submitted
        // a form, and it says nothing about this date.
        if (isAvailableAnswer(day)) available.push(row);
        else if (isUnavailable(day)) unavailable.push(row);
        else noResponse.push(row);
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
 *
 * ── THE ROSTER BELONGS ON THIS ROW (v20.87, external audit) ─────────────────────────────────────
 *
 * "Available after 15:00" is only actionable next to what that person is rostered to work. The
 * member's own form knows the duty — it is what generated the option — and until now the app threw
 * that away at exactly the point somebody had to make a decision from it. It matters most in the
 * case the feature exists for: a member who answered "Rest day · available all day" and has SINCE
 * been given overtime is no use for sickness cover, and the reviewer's screen did not say so.
 *
 * `answerAnchorStale` then warns where the two disagree — the same predicate the member's form
 * uses, so both ends of the record flag the same fact rather than one noticing and the other not.
 *
 * ── AND WHAT CHANGED, NOT MERELY THAT SOMETHING DID ─────────────────────────────────────────────
 *
 * `changedSinceInitial` was a flag repeated under a person's name on all seven days, saying only
 * that some day somewhere had moved. The initial revision is already downloaded — that is the point
 * of keeping immutable revisions — so the row can show the actual before-and-after on the day it
 * happened, which is what a clerk revisiting a decision needs. Days that did not change say
 * nothing, so the marker means something wherever it appears.
 *
 * ── AND HOW OLD THE STATEMENT IS ────────────────────────────────────────────────────────────────
 *
 * The row said who, what they are rostered and what they said — and nothing about WHEN they said
 * it. Mid-week sickness is the case that breaks on: an "available all day" written nineteen days
 * ago, before a roster the member has since seen and planned around, looked exactly as fresh as one
 * written this morning. The roster chip fixed half of that (what they are working now); this is the
 * other half (how old the statement is).
 *
 * @param {any} p @param {any} day @param {any} history
 * @param {any} ctx that member's roster for THIS date, or null when it could not be read
 * @param {any} initialDay what they had said for this date at the initial deadline, if anything
 * @param {{ now?: number, frozenAt?: number, stopAsking?: boolean, showRoster?: boolean }} meta the
 *   corrected clock, when this window's population was frozen (see `frozenAt`), whether this row may
 *   offer to stop expecting an answer (true only on the Awaiting panel, see there), and whether a
 *   roster chip belongs on it at all — which is a different question from whether one could be read
 * @param {number} [updatedAt] when this person last changed their form
 */
function personRow(p, day, history, ctx = null, initialDay = null, meta = {}, updatedAt = 0) {
    const flags = [];
    // ADDED AFTER THIS WEEK OPENED. Not a judgement on the person — the opposite: it accounts for a
    // denominator that grew overnight, so a reviewer does not read a fresh name in "No response" as
    // somebody who has gone quiet.
    if (meta.frozenAt && p.createdAt && p.createdAt > meta.frozenAt + ADDED_LATER_TOLERANCE_MS) {
        flags.push('Added after this week opened');
    }
    // Whole-submission facts first — these are about the FORM, not about this date.
    if (history?.lateInitial) flags.push('Submitted after initial deadline');
    // Per-DAY, and only where this day genuinely moved. `sameAnswer` is structural for the same
    // reason the member's form uses it: the two sides pass through different producers and a key
    // reorder is not a change of mind.
    else if (initialDay && day && !sameAnswer(initialDay, day)) {
        flags.push(`Changed after initial deadline · was ${answerCopy(initialDay)}`);
    }
    // The roster moved out from under an answer that was anchored to it. Distinct from the above:
    // there the MEMBER changed their mind, here the roster changed under a declaration they stand
    // by — and a clerk acting on it needs to know which of the two happened.
    if (answerAnchorStale(day, ctx)) flags.push('Roster changed since this answer');
    // Only where there IS an answer to date. A row in "No response" has nothing to be old.
    const age = day ? declaredAgo(updatedAt, meta.now || 0) : null;
    return `
        <div class="ot-person">
            <span class="ot-person-name">${esc(p.memberName)}</span>
            ${p.grade ? `<span class="ot-person-grade">${esc(p.grade)}</span>` : ''}
            ${meta.showRoster === false ? ''
                // NOT the same as `ctx === null`, which means the roster read FAILED and prints
                // "Roster unavailable". The Awaiting panel is not showing a duty at all — its rows
                // span the whole week — and printing an unavailability notice there stated
                // something untrue about data that was read perfectly well two panels up. Its own
                // comment had said "no roster badge on this panel" since v20.87 while every row
                // carried one.
                : `<span class="ot-person-roster"><span class="visually-hidden">Rostered: </span>${rosterBadge(ctx)}</span>`}
            ${day ? `<span class="ot-answer ot-answer--${answerTone(day)}">${esc(answerCopy(day))}</span>` : ''}
            ${age ? `<span class="ot-person-age"><span class="visually-hidden">Said </span>${esc(age)}</span>` : ''}
            ${meta.stopAsking
                ? `<button type="button" class="ot-person-btn" data-stop-asking="${esc(p.memberName)}">Stop asking</button>`
                : ''}
            ${flags.length ? `<div class="ot-person-flags">${
                flags.map(f => `<span class="ot-person-flag">${esc(f)}</span>`).join('')}</div>` : ''}
        </div>`;
}

/** The people who have not answered at all — the list a reminder or a phone call works from. */
/** @param {any[]} participants @param {Map<string, any>} submissions @param {any} meta */
function awaitingPanel(participants, submissions, meta = {}) {
    const waiting = participants.filter(p => !submissions.has(p.memberName));
    return `
        <div class="ot-day-panel">
            <div class="ot-day-panel-head">Awaiting a form</div>
            ${waiting.length
                // NO roster badge on this panel, deliberately. Every other row is about ONE date and
                // can carry that date's duty; this list spans the whole week, so a single badge
                // would have to pick a day, and whichever it picked would be read as "what they are
                // working" rather than "what they are working on the Tuesday". The by-day panels
                // above already show these people, with the right roster on each.
                //
                // It no longer carries "Stop asking" (v21.20, external review). It was the ONLY
                // place that did, and this panel by definition holds people who have NOT submitted
                // — so somebody who answered and then left had no route to withdrawal at all, on a
                // page whose endpoint has supported it since v20.95. That is the commoner case, not
                // the rarer one: a leaver two weeks out has usually already filled the form in.
                // The control moved to `askedPanel` below, which lists everyone.
                ? waiting.map(p => personRow(p, null, null, null, null,
                    { ...meta, showRoster: false })).join('')
                : '<div class="ot-section-empty">Everyone has responded</div>'}
        </div>`;
}

/**
 * WHO IS BEING ASKED — the one home for participant management (v21.20, external review).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * "Stop asking" used to live only on the Awaiting panel, which holds exactly the people who have
 * NOT submitted. So the case it was built for — somebody leaves, or moves into Management, two
 * weeks before a week they have already answered — had no route through the UI at all, while the
 * endpoint had supported it since v20.95. A capability the server has and the page cannot reach is
 * the same as not having it.
 *
 * ── ONE PLACE, NOT SEVEN ────────────────────────────────────────────────────────────────────────
 *
 * The obvious alternative is a button on every person row. That is seven buttons per person on a
 * page that already repeats each name once per day, for an action taken a handful of times a year —
 * and it would put a destructive control inside the panels a reviewer scrolls fastest. So this is a
 * single list, at the bottom, next to the panel showing who has ALREADY been stood down. The two
 * belong together: one is the population, the other is what has been taken out of it.
 *
 * It states each person's position (answered / no form yet) so the reviewer is not made to
 * cross-reference the panels above to know what withdrawing somebody would discard.
 *
 * ── AT FULL LAUNCH IT IS THE WHOLE ROSTER ───────────────────────────────────────────────────────
 *
 * Today the beta makes this a handful of rows. Open to everyone it becomes ~50, which sounds like a
 * lot until you notice the seven day panels above already carry each name once — this adds a
 * fourteenth of what is on the page, at the bottom, muted. If it ever does need collapsing, collapse
 * it; do not solve it by moving the control back onto rows, which is the bug this panel exists for.
 * ── A CLOSED WEEK IS A RECORD, SO IT LOSES ITS CONTROLS (v21.23, external review) ───────────────
 *
 * The server has always refused a withdrawal on a closed week — that week is the record the roster
 * was planned from — but the panel offered the button anyway, so the only way to learn the rule was
 * to press it and be told no. An interface should not offer what it already knows cannot succeed.
 *
 * The heading moves to the PAST TENSE with it. That is not decoration: "Who is being asked" over a
 * finished week is a false statement in the present tense, and it is the sentence a reviewer reads
 * when working out why nobody has responded.
 * @param {any[]} participants the ACTIVE population, already grade-filtered
 * @param {Map<string, any>} submissions
 * @param {boolean} [closed] the week's final deadline has passed
 */
function askedPanel(participants, submissions, closed = false) {
    if (!participants.length) return '';
    return `
        <div class="ot-day-panel ot-day-panel--muted">
            <div class="ot-day-panel-head">${closed ? 'Who was asked' : 'Who is being asked'}</div>
            <div class="ot-section-note">${closed
                ? 'This week has closed, so who was asked can no longer be changed.'
                : `Everyone counted on this page. Use <strong>Stop asking</strong>
                when somebody has left or moved role — their answers are kept, they come out of the
                counts, and you can put them back while the week is open.`}</div>
            ${participants.map(p => `
                <div class="ot-person">
                    <span class="ot-person-name">${esc(p.memberName)}</span>
                    ${p.grade ? `<span class="ot-person-grade">${esc(p.grade)}</span>` : ''}
                    <span class="ot-person-note">${submissions.has(p.memberName)
                        ? 'Answered' : 'No form yet'}</span>
                    ${closed ? '' : `<button type="button" class="ot-person-btn" data-stop-asking="${esc(p.memberName)}">Stop asking</button>`}
                </div>`).join('')}
        </div>`;
}

/**
 * The people this week has stopped expecting an answer from.
 *
 * ── IT RENDERS ONLY WHEN THERE IS SOMEBODY IN IT, UNLIKE THE THREE DAY SECTIONS ─────────────────
 *
 * That difference is deliberate and the reasoning is the opposite way round. An empty "No response"
 * must still draw its heading, because a hidden one makes "nobody outstanding" look exactly like a
 * section that failed to render. Here the absence carries no such ambiguity: nobody has been
 * withdrawn from almost every week, and a permanent empty panel on every screen would be furniture
 * — and furniture is what a reviewer stops reading. When it IS there, it is a statement that the
 * expected count on this page is smaller than the frozen population, which is a thing to notice.
 * Like `askedPanel`, it goes read-only and past-tense on a CLOSED week (v21.23) — the server refuses
 * a restore there, so offering "Ask again" was offering a button that could only fail.
 * @param {any[]} withdrawn
 * @param {boolean} [closed] the week's final deadline has passed
 */
function withdrawnPanel(withdrawn, closed = false) {
    if (!withdrawn.length) return '';
    return `
        <div class="ot-day-panel ot-day-panel--muted">
            <div class="ot-day-panel-head">${closed ? 'Was not asked' : 'Not being asked'}</div>
            <div class="ot-section-note">Left out of the counts above. Their forms and anything they
                already said are kept.</div>
            ${withdrawn.map(p => `
                <div class="ot-person ot-person--withdrawn">
                    <span class="ot-person-name">${esc(p.memberName)}</span>
                    ${p.grade ? `<span class="ot-person-grade">${esc(p.grade)}</span>` : ''}
                    <span class="ot-person-note">${esc(withdrawnLine(p))}</span>
                    ${closed ? '' : `<button type="button" class="ot-person-btn" data-ask-again="${esc(p.memberName)}">Ask again</button>`}
                </div>`).join('')}
        </div>`;
}

/** @param {any} s */
function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
