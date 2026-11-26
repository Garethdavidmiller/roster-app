// @ts-check
/**
 * overtime-manager.js — the reviewer's workspace for ONE selected week.
 *
 * Owns: the three views built from a week's data — By day, Awaiting, and the change indicators.
 * Every WORD comes from `overtime-format.js`; the READ is `loadWeekDetail` in `overtime-data.js`;
 * the planning horizon that got the reviewer here belongs to `overtime-review-controller.js`.
 *
 * ── NO FIREBASE IMPORT, DELIBERATELY ────────────────────────────────────────────────────────────
 *
 * `firebase-client.js` statically imports the SDK from the gstatic CDN, so anything importing it is
 * unloadable in a Node test. This module writes one string into a host element — the part worth
 * testing exhaustively — so the read lives next door and this stays reachable from
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
 * The third is under constant pressure to be folded into the second. They are opposites: one person
 * said no, the other said nothing, and only the second is worth a phone call.
 *
 * ── TWO LENSES, AND ONLY ONE OF THEM CHANGES THE ARITHMETIC ─────────────────────────────────────
 *
 * DAY is a pure hide/show over rows already on the page: the counts do not move, because the count
 * for Tuesday is the count for Tuesday whichever day you are looking at.
 *
 * GRADE is not: a gap in the CEA line is not filled by an available CES, so a filter that left the
 * counts alone would put a misleading number on screen. A grade pick RE-RENDERS from the same data,
 * and every figure follows it.
 *
 * So the whole render is a pure function of `(data, state)` with no incremental DOM work, which
 * makes "the counts agree with the rows" structural.
 */

import { setStatus } from './status-text.js';
import {
    shortDate, deadlineLabel, printedLabel, weekSpan, weekLabel, countsCopy, answerCopy, answerTone,
    isUnavailable, isAvailableAnswer, asAtLine, rosterBadge, sameAnswer, answerAnchorStale,
    declaredAgo, isWithdrawn, withdrawnLine, canRestoreNow, weekAvailabilitySummary, reminderLine,
    gradeScopeLabel, putBackWindow,
} from './overtime-format.js';
import { releaseRequestLine } from './overtime-sunday-release.js';
import { escapeHtml as esc } from './roster-data.js';   // the ONE escaper (was a local copy)

/**
 * Render the workspace into `host`.
 *
 * @param {HTMLElement} host
 * @param {any} win the window row from the planning horizon (carries the stored milestones)
 * @param {{ participants: any[], submissions: Map<string, any>,
 *   roster?: Record<string, Record<string, any>> }} data
 * @param {{ dates: string[], now: number, grade?: string, onGrade?: (g: string) => void,
 *   day?: string, onDay?: (d: string) => void, onRefresh?: () => void,
 *   onAsk?: (memberName: string, ask: boolean) => void, refreshFailed?: boolean, printedAt?: number }} opts
 *   `grade` is the reviewer's standing choice, handed back in by the coordinator; `onGrade` is how
 *   it gets there. `day`/`onDay` are the same pair for the DAY lens, handed back only across a
 *   SAME-WEEK re-render (a day's values are this window's dates). `onRefresh`, when provided,
 *   renders a Refresh control beside the freshness line (the data is a one-shot snapshot);
 *   `refreshFailed` says a newer read did not arrive, so this snapshot is still the one drawn;
 *   `printedAt` is the corrected clock at THIS paint, for the sheet's "Printed …" line (never the
 *   snapshot's `now`, never the device clock — `stampPrinted` moves it on). `onAsk` is the only
 *   MUTATION this module can start: it hands the decision straight back out, so the module stays a
 *   pure render.
 * @returns {{ grade: string }} the grade the workspace opened on
 */
export function renderWeekDetail(host, win, data,
    { dates, now, grade: initialGrade = 'ALL', onGrade, day: initialDay = 'ALL', onDay, onRefresh, onAsk,
        refreshFailed = false, printedAt = now }) {
    /**
     * The grade currently in view. `ALL` is not a grade — no participant can carry it as one.
     *
     * IT SURVIVES A WEEK SWITCH, BECAUSE IT IS ABOUT THE REVIEWER, NOT THE WEEK — a clerk working the
     * CEA line stays on it. The DAY deliberately does not persist (its values are this window's dates).
     * The choice is held by the coordinator rather than a module-level variable, which no reload
     * clears and no test can reset.
     */
    // …but only a grade THIS week's frozen population holds — otherwise "0 of 0" with no strip to
    // recover from, so it degrades to ALL. `onGrade` is not called: the choice comes back on the next
    // week that holds it.
    let grade = (initialGrade === 'ALL'
        || gradesPresent((data.participants || []).filter(p => !isWithdrawn(p))).includes(initialGrade))
        ? initialGrade : 'ALL';
    /**
     * The day currently in view — `ALL`, or one of the window's dates. A handed-back day that is
     * not one of THIS window's dates falls back to `ALL` rather than filtering every panel to a
     * date the week does not contain — a coordinator bug upstream must degrade to the whole week,
     * never to an empty one.
     */
    let day = (initialDay === 'ALL' || dates.includes(initialDay)) ? initialDay : 'ALL';
    paint();
    // Which grade it OPENED on — not the one handed in, when that fell back above — so the card
    // header's chip counts the people the card does.
    return { grade };

    function paint() {
        host.innerHTML = build(win, data, { dates, now, grade, day, canRefresh: !!onRefresh, refreshFailed, printedAt });
        wireGlance(host, next => { day = next; onDay?.(next); paint(); refocus(host, 'data-glance', next); });
        wireGrades(host, next => { grade = next; onGrade?.(next); paint(); refocus(host, 'data-grade', next); });
        wireAsk(host, onAsk);
        wireRefresh(host, onRefresh);
        // The thunk reads the SAME lens state the panels were built from — grade-filtered,
        // withdrawn-excluded, day-narrowed — so the copied text cannot disagree with the screen.
        // Its scope and "as at" are the print head's own (`gradeScopeLabel`, the same `now`).
        wireCopy(host, () => weekAvailabilitySummary({
            weekEnding: win.weekEnding, dates,
            participants: ofGrade((data.participants || []).filter(p => !isWithdrawn(p)), grade),
            submissions: data.submissions, day, grade, asAt: now,
        }));
    }
}

/**
 * Put the keyboard on the successor of a control a repaint replaced — otherwise focus falls to
 * <body>. Matched by value, not by selector, so no name or grade needs escaping.
 * @param {HTMLElement|null} host @param {string} attr @param {string} value
 * @returns {boolean} whether a successor was found
 */
export function refocus(host, attr, value) {
    if (typeof host?.querySelectorAll !== 'function') return false;
    const next = /** @type {HTMLElement|undefined} */ (Array.from(host.querySelectorAll(`[${attr}]`))
        .find(n => n.getAttribute(attr) === value));
    next?.focus();
    return !!next;
}

/** Focus fell out of the page (its element was replaced) rather than being moved on by the reader. */
export const focusLost = () => !document.activeElement || document.activeElement === document.body;

/**
 * Restamp the sheet's "Printed …" line with the moment it prints, so two printouts can be put in
 * order. The page calls this on `beforeprint`; iOS sends none for AirPrint, so there the line keeps
 * its paint-time stamp.
 * @param {HTMLElement|null} host the workspace @param {number} nowMs the corrected clock
 */
export function stampPrinted(host, nowMs) {
    const line = host?.querySelector?.('.ot-print-printed');
    if (line) line.textContent = printedLabel(nowMs);
}

/**
 * Wire the Copy-summary control — the clerk's bridge to wherever the rostering conversation
 * actually happens (email, the rostering system, a phone call with a pen). Clipboard only; the
 * summary text itself is `weekAvailabilitySummary` (overtime-format.js), where its three-sections
 * rule is argued and tested.
 * @param {HTMLElement} host @param {() => string} summaryText
 */
function wireCopy(host, summaryText) {
    if (typeof host?.querySelector !== 'function') return;
    const btn = /** @type {HTMLButtonElement|null} */ (host.querySelector('.ot-copy-btn'));
    const status = /** @type {HTMLElement|null} */ (host.querySelector('.ot-copy-status'));
    btn?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(summaryText());
            if (status) setStatus(status, '✓ Copied');
        } catch {
            // Clipboard access can be refused (permissions, non-secure context). The print view
            // renders the same data selectable, so point there rather than dead-ending.
            if (status) setStatus(status, '⚠ Couldn\u2019t copy — use Print and copy from there');
        }
    });
}

/**
 * Wire the Refresh control. Same guard shape as the other wire fns: a host with no query surface
 * (the unit tests' two-line fake) simply leaves the markup inert.
 * @param {HTMLElement} host @param {(() => any) | undefined} onRefresh resolves once the week has repainted
 */
function wireRefresh(host, onRefresh) {
    if (typeof host?.querySelector !== 'function' || !onRefresh) return;
    const btn = /** @type {HTMLButtonElement|null} */ (host.querySelector('.ot-refresh-btn'));
    btn?.addEventListener('click', () => {
        // SAY IT IS WORKING, and stop a second press starting a second read. Nothing resets this:
        // every path out of a read repaints the workspace and replaces this button.
        btn.disabled = true;
        btn.textContent = 'Refreshing…';
        // The new button takes the keyboard back — unless the reader moved on while it read.
        Promise.resolve(onRefresh()).then(() => {
            if (focusLost()) /** @type {HTMLElement|null} */ (host.querySelector('.ot-refresh-btn'))?.focus();
        });
    });
}

/**
 * The grades present in THIS window's frozen population, in roster order.
 *
 * DERIVED, never a fixed list: a hardcoded set would offer a chip that filters to an empty page and
 * omit a grade added later. Participants arrive sorted by `rosterOrder`, so first appearance is
 * roster order.
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
 * A DENOMINATOR THAT MOVES OVERNIGHT MUST SAY SO: the nightly top-up can turn "1 of 1" into "1 of 2"
 * with nothing on screen accounting for it. Everybody frozen at creation shares one batch's commit
 * timestamp, so the earliest is the freeze instant. Derived rather than stored.
 *
 * Returns 0 when it cannot be established — "nobody was added late", the quiet direction.
 * @param {any[]} participants
 * @returns {number}
 */
function frozenAt(participants) {
    const times = (participants || []).map(p => p.createdAt).filter(t => typeof t === 'number' && t > 0);
    return times.length ? Math.min(...times) : 0;
}

/**
 * Tolerance on that comparison: a marker firing on batch jitter would appear on the whole population
 * at once and train a reviewer to ignore it.
 */
const ADDED_LATER_TOLERANCE_MS = 60_000;

/**
 * The whole surface as one string. Pure — same inputs, same output, no DOM reads.
 * @param {any} win
 * @param {{ participants: any[], submissions: Map<string, any>,
 *   roster?: Record<string, Record<string, any>> }} data
 * @param {{ dates: string[], now: number, grade: string, day?: string, canRefresh?: boolean,
 *   refreshFailed?: boolean, printedAt?: number }} state
 */
function build(win, data, { dates, now, grade, day = 'ALL', canRefresh = false, refreshFailed = false, printedAt = now }) {
    const { submissions } = data;
    // WITHDRAWN COMES OFF FIRST, before the grade filter and before anything is counted — and the
    // grade chips are computed from the remaining population, or a chip could have nobody under it.
    const active = (data.participants || []).filter(p => !isWithdrawn(p));
    const withdrawn = (data.participants || []).filter(isWithdrawn);
    const grades = gradesPresent(active);
    const participants = ofGrade(active, grade);
    const received = participants.filter(p => submissions.has(p.memberName)).length;
    const scope = gradeScopeLabel(grade);

    // The reasons for this head live here, not in the markup:
    //
    // THE PRINT HEAD is paper only (the card header is chrome and does not print). It carries TWO
    // times: "as at" is how fresh the DATA is; "Printed" orders two printouts of one snapshot (with a
    // year; restamped by `stampPrinted`). The grade lens IS carried onto paper, so the scope line is
    // mandatory: four CEAs with no scope line read as the whole team.
    //
    // THE FRESHNESS LINE, on screen too: a one-shot snapshot would otherwise read as current. It is
    // the print head's own sentence, so screen and paper cannot disagree.
    //
    // THE CURRENT NOTE's second sentence is a boundary, not a caution (owner, Aug 2026): what people
    // offer is time AROUND their rostered duty, never an offer to change or give it up. Here, and not
    // only in the help, because a tip is opt-in.
    return `
        <div class="ot-detail-head">
            <div class="ot-print-head" aria-hidden="true">
                <div class="ot-print-title">Overtime availability — ${esc(weekLabel(win.weekEnding))}</div>
                <div class="ot-print-asat">${esc(asAtLine(now))}</div>
                <div class="ot-print-printed">${esc(printedLabel(printedAt))}</div>
                <div class="ot-print-scope">${esc(scope)}</div>
            </div>
            <div class="ot-detail-meta">
                Roster week ${esc(weekSpan(win.weekStart, win.weekEnding))} ·
                final deadline ${esc(deadlineLabel(win.finalDeadlineAt))}
            </div>
            <div class="ot-detail-counts">${esc(countsCopy(participants.length, received))}</div>
            <div class="ot-detail-asat">${esc(asAtLine(now))}${canRefresh
                ? ' <button type="button" class="ot-refresh-btn">Refresh</button>' : ''}
                <button type="button" class="ot-copy-btn">Copy summary</button>
                <span class="ot-copy-status" role="status"></span></div>
            ${refreshFailed ? `<div class="ot-reminder-line ot-reminder-line--warn" role="status">Couldn't refresh `
                + `just now — still showing availability as at ${esc(deadlineLabel(now))}.</div>` : ''}
            ${(() => {
                // The reminder audit: whether the deadline-morning reminder went out, and what it
                // reached. reminderLine owns the states, including the deliberate silence on CLOSED weeks.
                // A week OPENED after its initial deadline never had a reminder morning, so the
                // FINAL_OPEN "none recorded" warning would be a false alarm there.
                const late = frozenAt(data.participants) >= win.initialDeadlineAt;
                const r = late ? null : reminderLine(win.phase, win.initialDeadlineAt, win.reminderSentAt,
                    win.reminderOutstanding, win.reminderAccepted);
                return r ? `<div class="ot-reminder-line ot-reminder-line--${r.tone}">${esc(r.text)}</div>` : '';
            })()}
            ${win.audience === 'restricted'
                ? `<div class="ot-detail-audience">Beta audience · ${participants.length} expected `
                  + `${participants.length === 1 ? 'participant' : 'participants'}</div>`
                : ''}
        </div>
        <div class="ot-current-note">
            Availability reflects what staff submitted before the final cut-off. Confirm directly
            with the person before arranging short-notice cover.
            <strong>What people offer here is time around whatever they are already rostered</strong>
            — it is never an offer to change or give up a rostered duty.
        </div>
        ${gradeStrip(grades, grade)}
        ${glanceStrip(dates, participants, submissions, day)}
        ${dates.map(date => dayPanel(date, participants, submissions, day, data.roster || {},
            { now, frozenAt: frozenAt(active) })).join('')}
        ${awaitingPanel(participants, submissions, { now, frozenAt: frozenAt(active) })}
        ${askedPanel(participants, submissions, win.phase === 'CLOSED', putBackWindow(Number(win.initialDeadlineAt), now))}
        ${withdrawnPanel(ofGrade(withdrawn, grade), win.phase === 'CLOSED',
            { initialDeadlineAt: win.initialDeadlineAt, finalDeadlineAt: win.finalDeadlineAt, now })}`;
}

/**
 * Filter the week to one grade.
 *
 * Rendered ONLY when the window holds more than one grade — an inert control is worse than an absent
 * one. "Grade" rather than "role" is the app's own word for these values.
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
 * Nothing here re-renders: the write can fail, so the page must not show the person moving between
 * panels before the server has agreed (no optimistic update).
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
 * At full roster size the by-day view is hundreds of name rows, and where the WEEK is thin was stated
 * nowhere. So the week opens with one row of seven days, each with how many are available; a day
 * with NOBODY says so in its own colour. Tapping a day shows only that day. A lens over the same
 * rows, not a summary that could disagree with them.
 * @param {string[]} dates @param {any[]} participants @param {Map<string, any>} submissions @param {string} activeDay
 */
function glanceStrip(dates, participants, submissions, activeDay) {
    const chips = dates.map(date => {
        const n = participants.filter(p => {
            const sub = submissions.get(p.memberName);
            // POSITIVE: `!isUnavailable(undefined)` is true, and would invent a body for a shift.
            return sub && isAvailableAnswer(sub.days?.[date]);
        }).length;
        // ZERO IS A JUDGEMENT THE APP CAN MAKE; "ENOUGH" IS NOT — only the reviewer knows which shift
        // is short. Zero means the same whatever the vacancy: nobody offered anything.
        const tone = n === 0 ? 'none' : 'some';
        return `<button type="button" class="ot-glance-day ot-glance-day--${tone}"
                        data-glance="${esc(date)}" aria-pressed="${date === activeDay}"
                        aria-label="${esc(shortDate(date))} — ${n} with some availability">
                    <span class="ot-glance-name">${esc(shortDate(date))}</span>
                    <span class="ot-glance-count">${n}</span>
                </button>`;
    }).join('');
    // The note says what the numbers ARE — a bigger number is not a solved day.
    return `
        <div class="ot-glance" role="group" aria-label="Staff with some availability, by day — choose a day to show only that day">
            <button type="button" class="ot-glance-day ot-glance-day--all" data-glance="ALL" aria-pressed="${activeDay === 'ALL'}">
                <span class="ot-glance-name">All week</span>
            </button>
            ${chips}
        </div>
        <p class="ot-glance-note">Each number is how many people offered SOME availability that
        day — not whether it covers the shift you need.</p>`;
}

/**
 * Same enhancement-over-complete-markup contract as `wireGrades`: the default render carries every
 * day panel visible, so a host without query methods (the two-line fake DOM the render tests use)
 * simply gets the unfiltered week. The guard is what keeps the render testable without a browser.
 *
 * STATE, NOT A HAND-TOGGLED DOM — SO A GRADE SWITCH KEEPS THE DAY: both lenses go through the same
 * `(data, state) → markup` render.
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
        // THIS DATE's age, not the whole form's, which errs toward fresher. The whole-form stamp is
        // the fallback when the revision read fails — no age at all is worse than a coarse one.
        const row = personRow(p, day, sub.history, ctx,
            sub.history?.initialRevision?.days?.[date], meta,
            sub.history?.dayChangedAt?.[date] ?? sub.updatedAt);
        // THREE-VALUED, asked positively: each section requires its own positive answer, and a day
        // neither claims falls through to No response — the form says nothing about this date.
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
 * THE ROSTER BELONGS ON THIS ROW: "Available after 15:00" is only actionable next to what that
 * person is rostered to work. `answerAnchorStale` warns where the two disagree — the same predicate
 * the member's form uses, so both ends of the record flag the same fact.
 *
 * AND WHAT CHANGED, NOT MERELY THAT SOMETHING DID: the before-and-after shows on the day it
 * happened, from the initial revision; days that did not change say nothing.
 *
 * AND HOW OLD THE STATEMENT IS: an answer from nineteen days ago may predate a roster the member has
 * since planned around.
 *
 * @param {any} p @param {any} day @param {any} history
 * @param {any} ctx that member's roster for THIS date, or null when it could not be read
 * @param {any} initialDay what they had said for this date at the initial deadline, if anything
 * @param {{ now?: number, frozenAt?: number, showRoster?: boolean }} meta the corrected clock, when this
 *   window's population was frozen (see `frozenAt`), and whether a roster chip belongs on it at all — which
 *   is a different question from whether one could be read. (Stop asking moved to `askedPanel`.)
 * @param {number} [updatedAt] when this person last changed their form
 */
function personRow(p, day, history, ctx = null, initialDay = null, meta = {}, updatedAt = 0) {
    const flags = [];
    // ADDED AFTER THIS WEEK OPENED — not a judgement on the person: it accounts for a denominator
    // that grew overnight.
    if (meta.frozenAt && p.createdAt && p.createdAt > meta.frozenAt + ADDED_LATER_TOLERANCE_MS) {
        flags.push('Added after this week opened');
    }
    // Whole-submission facts first — these are about the FORM, not about this date.
    if (history?.lateInitial) flags.push('Submitted after initial deadline');
    // Per-DAY, and only where this day genuinely moved (`sameAnswer` is structural).
    else if (initialDay && day && !sameAnswer(initialDay, day)) {
        flags.push(`Changed after initial deadline · was ${answerCopy(initialDay)}`);
    }
    // The roster moved under an answer anchored to it — distinct from the member changing their mind.
    if (answerAnchorStale(day, ctx)) flags.push('Roster changed since this answer');
    // Only where there IS an answer to date. A row in "No response" has nothing to be old.
    const age = day ? declaredAgo(updatedAt, meta.now || 0) : null;
    // A Sunday-release request sits BESIDE the answer, never merged into it (invariants 1 and 14):
    // two different things the member said about one day, and collapsing them would lose one.
    return `
        <div class="ot-person">
            <span class="ot-person-name">${esc(p.memberName)}</span>
            ${p.grade ? `<span class="ot-person-grade">${esc(p.grade)}</span>` : ''}
            ${meta.showRoster === false ? ''
                // NOT the same as `ctx === null`, which means the roster read FAILED ("Roster
                // unavailable"). The Awaiting panel shows no duty at all — its rows span the week.
                : `<span class="ot-person-roster"><span class="visually-hidden">Rostered: </span>${rosterBadge(ctx)}</span>`}
            ${day ? `<span class="ot-answer ot-answer--${answerTone(day)}">${esc(answerCopy(day))}</span>` : ''}
            ${releaseRequestLine(day) ? `<span class="ot-release-flag">${esc(releaseRequestLine(day))}</span>` : ''}
            ${age ? `<span class="ot-person-age"><span class="visually-hidden">Said </span>${esc(age)}</span>` : ''}
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
                // NO roster badge on this panel, deliberately: this list spans the whole week, so a
                // badge would have to pick a day. "Stop asking" lives in `askedPanel`, which lists
                // everyone — this panel holds only those who have NOT submitted.
                ? waiting.map(p => personRow(p, null, null, null, null,
                    { ...meta, showRoster: false })).join('')
                : '<div class="ot-section-empty">Everyone has responded</div>'}
        </div>`;
}

/**
 * WHO IS BEING ASKED — the one home for participant management, listing everyone, so somebody who
 * answered and then left can still be withdrawn.
 *
 * ONE PLACE, NOT SEVEN: a button on every person row would put a destructive control in the panels
 * a reviewer scrolls fastest. So a single list, at the bottom, beside who has ALREADY been stood
 * down, stating each person's position (answered / no form yet). If it ever needs collapsing,
 * collapse it; do not move the control back onto rows.
 *
 * A CLOSED WEEK IS A RECORD, SO IT LOSES ITS CONTROLS (the server refuses them) and its heading moves
 * to the PAST TENSE — "Who is being asked" over a finished week would be false.
 * @param {any[]} participants the ACTIVE population, already grade-filtered
 * @param {Map<string, any>} submissions
 * @param {boolean} [closed] the week's final deadline has passed
 * @param {string} [putBack] until when a stop made now can be undone (`putBackWindow`)
 */
function askedPanel(participants, submissions, closed = false, putBack = 'until the first deadline') {
    if (!participants.length) return '';
    return `
        <div class="ot-day-panel ot-day-panel--muted">
            <div class="ot-day-panel-head">${closed ? 'Who was asked' : 'Who is being asked'}</div>
            <div class="ot-section-note">${closed
                ? 'This week has closed, so who was asked can no longer be changed.'
                : `Everyone counted on this page. Use <strong>Stop asking</strong>
                when somebody has left or moved role — their answers are kept, they come out of the
                counts, and you can put them back ${esc(putBack)}.`}</div>
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
 * IT RENDERS ONLY WHEN THERE IS SOMEBODY IN IT, UNLIKE THE THREE DAY SECTIONS: an empty "No
 * response" must draw its heading (hidden reads as a render failure), but a permanent empty panel
 * here would be furniture a reviewer stops reading. Like `askedPanel`, it goes read-only and
 * past-tense on a CLOSED week.
 *
 * PER PERSON: restoring is not the mirror of withdrawing (`canRestoreParticipant`), so "Ask again"
 * shows where `canRestoreNow` says the server would accept it, and a line says why not where it
 * would not — a silently missing button reads as a rendering fault.
 * @param {any[]} withdrawn
 * @param {boolean} [closed] the week's final deadline has passed
 * @param {{ initialDeadlineAt?: number, finalDeadlineAt?: number, now?: number }} [win] milestones for the per-row rule
 */
function withdrawnPanel(withdrawn, closed = false, win = {}) {
    if (!withdrawn.length) return '';
    return `
        <div class="ot-day-panel ot-day-panel--muted">
            <div class="ot-day-panel-head">${closed ? 'Stopped being asked' : 'No longer asked'}</div>
            <div class="ot-section-note">Left out of the counts above. Their forms and anything they
                already said are kept.</div>
            ${withdrawn.map(p => {
                const restorable = !closed
                    && canRestoreNow(Number(win.initialDeadlineAt), p.withdrawnAt, Number(win.now),
                        Number(win.finalDeadlineAt));
                return `
                <div class="ot-person ot-person--withdrawn">
                    <span class="ot-person-name">${esc(p.memberName)}</span>
                    ${p.grade ? `<span class="ot-person-grade">${esc(p.grade)}</span>` : ''}
                    <span class="ot-person-note">${esc(withdrawnLine(p))}</span>
                    ${restorable
                        ? `<button type="button" class="ot-person-btn" data-ask-again="${esc(p.memberName)}">Ask again</button>`
                        : closed ? ''
                        : p.withdrawnAt ? '<span class="ot-person-note">Stopped before the first deadline, so they can’t be put back for this week</span>' : ''}
                </div>`;
            }).join('')}
        </div>`;
}

