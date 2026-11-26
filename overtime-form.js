// @ts-check
/**
 * overtime-form.js — the member's seven-day availability form: render, collect, submit, reconcile.
 *
 * Owns: the DOM of one week's form and the submit lifecycle around it. Every RULE it obeys lives
 * elsewhere — the schema and the concurrency decision on the server, the words in
 * `overtime-format.js`, the roster context in `overtime-roster.js`. This module's job is to make
 * those legible on a phone and to be honest when something goes wrong.
 *
 * ── THREE THINGS HERE ARE EASY TO "TIDY" AND MUST NOT BE ────────────────────────────────────────
 *
 * 1. **An unanswered day is unanswered.** There is no default selection and no pre-fill from last
 *    week. A default would be an answer this member did not give, about their own life, submitted
 *    under their name.
 *
 *    Submit is NOT disabled while days are outstanding — it reads "N days still to answer", and
 *    pressing it refuses, says which day, and walks there. A disabled button explains nothing. The
 *    count and the press-time check agree about what "answered" means through `unfinishedDates`.
 *
 * 2. **The client never refuses a submission near the deadline.** `submitDisposition` returns
 *    `check-with-server` for the first fifteen minutes past it, and this module SENDS. A page that
 *    greys the button out on its own clock has denied somebody who was in time.
 *
 * 3. **A timeout is not a failure — and nor is a lost connection on a submit.** `AbortController`
 *    stops us waiting; it does not stop the server writing. So a timeout or a `network` failure
 *    goes into RECONCILIATION — re-read state, look for our own
 *    `clientMutationId` — and only reports what it can actually establish. The three outcomes
 *    ("it did save" / "it did not" / "we could not tell") each have their own copy, because
 *    collapsing them is how a member ends up submitting a second, contradictory version.
 */

import * as OTD from './overtime-data.js';
import { confirmDialog } from './overlay.js';
import { loadRosterContext, rosterBadge } from './overtime-roster.js';
import { shapeClockBoxInPlace, readClockBox, noteClockBoxBefore } from './clock-input.js';
import { escapeHtml as esc } from './roster-data.js';   // the ONE escaper (was a local copy)
import {
    weekLabel, weekSpan, shortDate, answerCopy, answerTone, deadlineLines, phaseChip, phaseTone,
    answerAnchorStale, submitDisposition, modesFor, offersFullTwelve, submitFailureCopy,
    sameAnswer, receiptLine, unfinishedDates, reconcileVerdict, conflictIsOurs, isAvailableAnswer, weekDates,
    writeOutcomeUnknown,
} from './overtime-format.js';
import { offersSundayRelease, SUNDAY_RELEASE_LABEL, SUNDAY_RELEASE_ASKED } from './overtime-sunday-release.js';
import { withMode, withFullTwelve, withRelease } from './overtime-answer.js';

/**
 * Button labels per mode. `before`/`after` get their boundary spliced in at render.
 *
 * ONE GRAMMAR: every green pill completes "Available …" — All day · Before 07:00 · After 15:00 ·
 * Before & after duty · Custom times; "Not available" is the charcoal odd one out. The recorded CHIP
 * (`answerCopy`) keeps the full "Available all day" form on purpose: chips stand alone on the
 * reviewer's list, where a button sits inside a radiogroup already labelled "Availability on <day>".
 * @type {Record<string, string>}
 */
const MODE_LABELS = {
    unavailable:  'Not available',
    all_day:      'All day',
    // Replaced at render from the day's roster — see `modeButton`; a day with a duty on it gets the
    // "in total" form. LEGACY — `modesFor` no longer offers it, but `dayBlock` re-adds a SAVED mode.
    // Do not delete these two labels: a saved answer would return with an unlabelled control.
    twelve_hours: 'For a full 12-hour turn',
    before:       'Before {until}',
    after:        'After {from}',
    before_after: 'Before & after duty',
    custom:       'Custom times',
};

/**
 * The 12-hour label for a day that ALREADY has a duty on it.
 *
 * Owner, Aug 2026: the member's whole day may run to twelve hours, INCLUDING what is rostered — not
 * twelve hours on top. Beside a duty "a 12-hour turn" is ambiguous by eight hours, so "IN TOTAL" is
 * load-bearing.
 */
const TWELVE_ON_DUTY = 'For a full 12 hours in total';

/**
 * The "all day" label for a day that ALREADY has a duty on it.
 *
 * AVAILABILITY IS ADDED TO A DUTY, NEVER SUBSTITUTED FOR ONE (owner, Aug 2026): "All day" beside a
 * duty could read as giving the duty up, a power no label should hand over by accident. So on a
 * worked day the button names the duty it wraps around.
 *
 * Reachable ONLY on an OVERNIGHT duty (and for a saved all_day answer): elsewhere `modesFor` offers
 * "Before & after duty" instead (overtime-format.js).
 */
const ALL_DAY_ON_DUTY = 'Any time around my shift';

/**
 * Build one week's form into `host`.
 *
 * @param {HTMLElement} host
 * @param {any} win the window as `getMyOvertimeState` returned it
 * @param {string} memberName
 * @param {{ onSaved: () => void }} deps
 */
export async function renderWeekForm(host, win, memberName, { onSaved }) {
    const dates = weekDates(win.weekStart);
    // `let`: a send the server refuses as closed closes the form where it stands (`closeHere`).
    let closed = win.phase === 'CLOSED';

    host.innerHTML = `<div class="ot-state">Loading your roster…</div>`;
    const ctx = await loadRosterContext(memberName, dates);

    /** Working copy. Starts from the saved submission, or empty — never from a default. */
    /** @type {Record<string, any>} */
    const answers = win.submission?.days ? deepCopy(win.submission.days) : {};
    /** The revision this form is editing. 0 when nothing is saved yet. */
    let baseRevision = win.submission?.currentRevision ?? 0;
    /** The mutation id of a submission whose response we never saw. */
    /** @type {string|null} */
    let pendingMutationId = null;
    /** True from Submit until the send (and any timeout reconciliation) has settled. */
    let submitting = false;

    host.innerHTML = shell();
    const daysHost = /** @type {HTMLElement} */ (host.querySelector('.ot-days'));
    const feedback = /** @type {HTMLElement} */ (host.querySelector('.ot-feedback'));
    const submitBtn = /** @type {HTMLButtonElement} */ (host.querySelector('.ot-submit'));
    const headHost = /** @type {HTMLElement} */ (host.querySelector('.ot-form-head'));

    paintDays();
    updateSubmitState();
    submitBtn?.addEventListener('click', onSubmit);
    host.querySelector('.ot-bulk-unavailable')?.addEventListener('click', onAllUnavailable);

    /**
     * The handle the coordinator holds on this form.
     *
     * `isDirty` exists so that nothing DESTROYS a half-filled form without asking — the answers live
     * in this closure and nowhere else.
     *
     * `setPhase` lets the resync update the head (INITIAL_OPEN → FINAL_OPEN is still submittable)
     * without rebuilding the form and losing what was typed. See `wireDeadlineResync` in overtime-app.js.
     */
    // `isSubmitting`: a release's reload must not land while the send is in flight.
    return { isDirty, setPhase, isSubmitting: () => submitting };

    // ── Render ──────────────────────────────────────────────────────────────────────────────────

    // The page's furniture, with its reasons here rather than in the markup:
    //   · THE ALL-WEEK SHORTCUT PRE-FILLS, never submits: the member still sees seven days and
    //     presses Submit. No "copy last week": "after my duty" means THAT week's duty. Its QUESTION
    //     is not part of the button (one long underlined string read as a link).
    //   · THE CAP NOTE states the ceiling every plan is held to, so the willingness tick means
    //     something exact — only on an open form: it says "whatever you answer below".
    //   · THE SUBMIT BAR IS STICKY: the live answer to "how much is left?" on a long form. Its
    //     position lives in CSS; the member's view does not print (overtime.css prints a notice).
    //   · THE CLOSED NOTE says "recorded" only over a submission, never above seven unanswered days.
    function shell() {
        return `<div class="ot-form-head">${headInner()}</div>
            ${ctx.knowledge === 'error' ? `
                <div class="ot-roster-warning" role="status">${rosterWarning()}</div>` : ''}
            ${closed ? '' : `
                <div class="ot-bulk-row">
                    <span class="ot-bulk-q">Not available at all this week?</span>
                    <button type="button" class="ot-bulk-unavailable">Mark all seven days Not available</button>
                </div>
                <p class="ot-cap-note">A working day is never planned past 12 hours in total,
                whatever you answer below.</p>`}
            <div class="ot-days"></div>
            ${closed ? `
                <div class="ot-closed-note">
                    <strong>${win.submission ? 'Final availability recorded.' : 'Nothing was submitted for this week.'}</strong>
                    This form is now closed. If your circumstances have changed, speak to your manager.
                </div>` : `
                <div class="ot-submit-bar">
                    <div class="ot-feedback" aria-live="polite"></div>
                    <button type="button" class="btn-action btn-primary ot-submit">Submit availability</button>
                </div>`}`;
    }

    /**
     * The head's contents, separately from the shell — a successful save (the receipt) and a phase
     * move (past-tense deadlines) both change it after the first render.
     */
    function headInner() {
        const receipt = receiptLine(win.submission);
        return `
            <div class="ot-week-band ot-week-band--${esc(phaseTone(win.phase))}">
                <div class="ot-form-week">${esc(weekLabel(win.weekEnding))}</div>
                <div class="ot-form-span">
                    <span>${esc(weekSpan(win.weekStart, win.weekEnding))}</span>
                    <span class="ot-phase-chip ot-phase-chip--${esc(phaseTone(win.phase))}">${esc(phaseChip(win.phase))}</span>
                </div>
                ${deadlineBlock(win)}
                ${receipt ? `<div class="ot-form-receipt"><span aria-hidden="true">✓</span> ${esc(receipt)}</div>` : ''}
            </div>`;
    }

    /**
     * The two deadlines, as NAMED VALUES rather than a stack of sentences (owner): the member's
     * question is "by when must I answer". Each date gets an eyebrow label (`.field-eyebrow` idiom),
     * so the hierarchy comes from STRUCTURE; the live one (`lead`) is the larger, darker value. The
     * phase sentence sits BELOW the dates, as a caption to them.
     *
     * @param {any} win the window being rendered
     * @returns {string}
     */
    function deadlineBlock(win) {
        const lines = deadlineLines(win.phase, win.initialDeadlineAt, win.finalDeadlineAt, win.openedAt);
        const dates = lines.filter(l => l.label);
        // Only prose that is a WARNING reaches the head (see phaseChip); the ordinary state is the chip.
        const prose = lines.filter(l => !l.label && l.warn);
        return `
            <div class="ot-form-dates">
                ${dates.map(l => `
                    <div class="ot-form-when${l.lead ? ' ot-form-when--lead' : ''}">
                        <span class="ot-form-when-label">${esc(l.label)}</span>
                        <span class="ot-form-when-value">${esc(l.value)}</span>
                    </div>`).join('')}
            </div>
            ${prose.map(l => `<p class="ot-form-phase">${esc(l.text)}</p>`).join('')}`;
    }

    function paintHead() {
        if (headHost) headHost.innerHTML = headInner();
    }

    /** What a failed roster read means here — and on a CLOSED form, nothing is left to enter. */
    function rosterWarning() {
        return 'Couldn\'t confirm your current MYB roster.'
            + (closed ? '' : ' You can still enter availability using custom times.');
    }

    /** Has the member changed anything that is not on the server? @returns {boolean} */
    function isDirty() {
        return !closed && dates.some(d => {
            const s = dayState(answers[d], d);
            return s === 'set' || s === 'changed';
        });
    }

    /**
     * Take a new phase without touching the answers. Returns false when the phase would CLOSE the
     * form — that genuinely needs a rebuild (the controls have to go), so the caller reloads.
     * @param {string} phase
     */
    function setPhase(phase) {
        if (phase === 'CLOSED' || closed) return false;
        win.phase = phase;
        paintHead();
        return true;
    }

    function paintDays() {
        if (!daysHost) return;
        daysHost.innerHTML = dates.map(dayBlock).join('');
        if (closed) return;
        daysHost.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('click', () => {
            const date = String(btn.getAttribute('data-date'));
            const mode = String(btn.getAttribute('data-mode'));
            answers[date] = withMode(answers[date], mode, ctx.byDate[date]);
            paintDays();
            updateSubmitState();
            // PUT THE KEYBOARD BACK ON THE OPTION THAT WAS JUST CHOSEN: `paintDays` replaces the
            // list, so focus would fall to `<body>` and throw a keyboard user to the top on every day.
            focusMode(date, mode);
        }));
        daysHost.querySelectorAll('[data-mode]').forEach(btn => btn.addEventListener('keydown', (/** @type {any} */ e) => {
            // Left/right (and up/down) move within the group and SELECT as they go, which is how a
            // radio group behaves everywhere else. Without it the roving tabindex above would strand
            // a keyboard user on whichever option happened to be selected.
            const step = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1
                : (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : 0;
            if (!step) return;
            e.preventDefault();
            const group = [.../** @type {any} */ (btn.parentElement).querySelectorAll('[data-mode]')];
            const next = group[(group.indexOf(btn) + step + group.length) % group.length];
            const date = String(next.getAttribute('data-date'));
            answers[date] = withMode(answers[date], String(next.getAttribute('data-mode')), ctx.byDate[date]);
            paintDays();
            updateSubmitState();
            focusMode(date, String(next.getAttribute('data-mode')));
        }));
        daysHost.querySelectorAll('[data-fulltwelve]').forEach(box => box.addEventListener('change', () => {
            const date = String(box.getAttribute('data-fulltwelve'));
            // The shape rules (written only when true, deleted rather than set false, nothing on an
            // unavailable day) live in overtime-answer.js with the other two transitions.
            setAnswer(date, withFullTwelve(answers[date], /** @type {HTMLInputElement} */ (box).checked));
            // REPAINT, like every other control: the row's state tint is computed at paint time and
            // is the form's whole account of what is on the server, so it cannot go stale.
            paintDays();
            focusFullTwelve(date);
            updateSubmitState();
        }));
        daysHost.querySelectorAll('[data-reanchor]').forEach(btn => btn.addEventListener('click', () => {
            const date = String(btn.getAttribute('data-reanchor'));
            const mode = String(answers[date]?.mode);
            answers[date] = reanchored(answers[date], ctx.byDate[date]);
            paintDays();
            updateSubmitState();
            focusMode(date, mode);   // the note and its button are gone; the option they changed is not
        }));
        daysHost.querySelectorAll('[data-release]').forEach(box => box.addEventListener('change', () => {
            const date = String(box.getAttribute('data-release'));
            // NO ANSWER REQUIRED — this asks about CONTRACTED work. And it ANSWERS NOTHING: with no
            // availability answer the copy holds `{ releaseRequested: true }` with no mode, which
            // `dayUnfinished` still counts — never an invented `unavailable`. Rules: overtime-answer.js.
            setAnswer(date, withRelease(answers[date], /** @type {HTMLInputElement} */ (box).checked));
            paintDays();
            focusRelease(date);
            updateSubmitState();
        }));
        daysHost.querySelectorAll('.ot-custom-input').forEach(el => {
            const inp = /** @type {HTMLInputElement} */ (el);
            // SHAPED AS IT IS TYPED, by the rule every text clock box shares (clock-input.js): an
            // iPhone's number pad has no colon.
            inp.addEventListener('beforeinput', () => noteClockBoxBefore(inp));   // clock-input.js rule 7
            inp.addEventListener('input', e => {
                shapeClockBoxInPlace(inp, /** @type {InputEvent} */ (e));
            });
            // COMMITTED ON BLUR AS WELL AS CHANGE: setting `.value` from `input` resets WebKit's
            // change baseline, so on an iPhone `change` may never fire when the box is left
            // (admin-week-editor.js measured it). `commitCustom` is idempotent.
            inp.addEventListener('change', () => commitCustom(inp));
            inp.addEventListener('blur', () => commitCustom(inp));
        });
    }

    /** One custom-time box, as left, judged and written into its day's answer. @param {HTMLInputElement} inp */
    function commitCustom(inp) {
        const date = String(inp.getAttribute('data-date'));
        const which = String(inp.getAttribute('data-which'));
        const cur = answers[date];
        if (!cur || cur.mode !== 'custom') return;
        // TEXT boxes, so nothing guarantees `HH:MM`; anything that is not a REAL clock time is stored
        // as empty and the day stays unfinished. `readClockBox` is the app's one reading of a box
        // that is left (clock-input.js); leaving it settles a three-digit "630" (`finaliseClockInput`).
        const read = readClockBox(inp);
        cur[which] = read.value;
        // Write the settled form back so `0600` and `6:00` become `06:00` in the box the
        // member is looking at, rather than being silently discarded.
        if (cur[which]) inp.value = read.value;
        // `nextDay` is DERIVED from the two times, never asked; the server refuses a mismatch.
        cur.nextDay = !!(cur.start && cur.end && cur.end < cur.start);
        paintCustomHint(date);
        retintDay(date);
        updateSubmitState();
    }

    /**
     * Re-apply one day's state tint IN PLACE — a repaint would rebuild the time box being typed in.
     * Same `dayState` as a repaint, so the two cannot disagree.
     * @param {string} date
     */
    function retintDay(date) {
        const row = daysHost.querySelector(`.ot-day[data-day="${date}"]`);
        if (!row) return;
        row.classList.remove('ot-day--set', 'ot-day--changed', 'ot-day--saved');
        const state = dayState(answers[date], date);
        if (state) row.classList.add(`ot-day--${state}`);
    }

    /**
     * Which of admin's row states this day is in — the SAME grammar the Change-a-Shift week
     * teaches, so a member who knows one page can read the other:
     *
     *   (nothing)   unanswered — a plain surface row. Seven of these on first open is the normal
     *               state, not an error, so it carries no colour at all.
     *   `set`       chosen this sitting, nothing saved yet — admin's gold "ready to save" tint.
     *   `changed`   chosen this sitting and it DIFFERS from what is saved — admin's cream
     *               "you are about to overwrite something recorded" (`--al-confirm-bg`).
     *   `saved`     what is on the row is what the server holds — the green recorded accent.
     *
     * `sameAnswer` is structural, never `JSON.stringify`: the saved copy comes back from the
     * server with its own key order, and a member who has touched nothing must not see cream.
     * @param {any} a @param {string} date
     */
    function dayState(a, date) {
        if (!a) return '';
        const saved = win.submission?.days?.[date];
        if (!saved) return 'set';
        return sameAnswer(a, saved) ? 'saved' : 'changed';
    }

    /** @param {string} date */
    function dayBlock(date) {
        const c = ctx.byDate[date] || null;
        const a = answers[date];
        // A SAVED answer always gets its button, even when the current roster would not offer that
        // mode: the declaration stands until they change it, so the UI must show it.
        const modes = modesFor(c);
        if (a?.mode && !modes.includes(a.mode)) modes.push(a.mode);
        // A day is ANSWERED when it has a mode — not when it has an object. A Sunday-release request
        // alone is `{ releaseRequested: true }` with no mode (overtime-answer.js, rule 1).
        const answered = !!a?.mode;
        const state = dayState(a, date);
        // Admin's two-part day label (bold day, lighter date). The roster badge takes a visually
        // hidden "Rostered:" rather than an aria-label, which a plain span announces unreliably.
        const [dayName, ...dayDate] = shortDate(date).split(' ');
        return `
            <div class="ot-day${answered ? ' ot-day--answered' : ''}${state ? ` ot-day--${state}` : ''}" data-day="${esc(date)}">
                <div class="ot-day-head">
                    <span class="ot-day-name">${esc(dayName)} <span class="ot-day-date">${esc(dayDate.join(' '))}</span></span>
                    <span class="ot-day-roster"><span class="visually-hidden">Rostered: </span>${rosterBadge(c)}</span>
                </div>
                ${closed
                    ? `<div class="ot-day-answer"><span class="ot-answer ot-answer--${answerTone(a)}">${esc(answerCopy(a))}</span>${
                        a?.releaseRequested === true
                            ? `<span class="ot-release-chip">${esc(SUNDAY_RELEASE_ASKED)}</span>` : ''}</div>`
                    : `<div class="ot-modes" role="radiogroup" aria-label="Availability on ${esc(shortDate(date))}">
                        ${modes.map((m, i) => modeButton(date, m, c, a, i)).join('')}
                       </div>
                       ${a?.mode === 'custom' ? customRow(date, a) : ''}
                       ${fullTwelveRow(date, c, a)}
                       ${sundayReleaseRow(date, c, a)}
                       ${answerAnchorStale(a, c) ? staleNote(date, a, c) : ''}`}
            </div>`;
    }

    /**
     * An answer anchored to a shift that has since moved — said, with the way to the shift as it is
     * now. Re-pressing the chosen option keeps the saved answer,
     * so the new time was reachable only by choosing something else first. Offered only where the
     * roster still has that boundary: none on a rest day, and no "after" on an overnight duty.
     * @param {string} date @param {any} a @param {any} c
     */
    function staleNote(date, a, c) {
        const next = c?.hasTime && modesFor(c).includes(a.mode) ? reanchored(a, c) : null;
        const words = next ? answerCopy({ mode: next.mode, until: next.until, from: next.from }).replace(/^Available /, '') : '';
        return `<p class="ot-day-stale">Your shift has changed since you answered. Your answer
            still says <strong>${esc(answerCopy(a))}</strong> — change it if that no longer suits.${next ? `
            <button type="button" class="ot-mode ot-mode--yes" data-reanchor="${esc(date)}">Change it to ${esc(words)}</button>` : ''}</p>`;
    }   // (the answer pills' recipe: it chooses an available answer, and takes their 44px touch target)

    /** The two presses a member would make — another option, then this one — as one, through
     *  overtime-answer.js's own transitions, so the 12-hour tick and a Sunday request survive. */
    function reanchored(/** @type {any} */ a, /** @type {any} */ c) {
        return withMode(withMode(a, 'all_day', c), a.mode, c);
    }

    /**
     * ONE option in a radio group, not a toggle button.
     *
     * The options are mutually exclusive, so a radio group (not `aria-pressed`), with a roving
     * tabindex so Tab moves PAST the group rather than through every option on every day.
     *
     * A SELECTED OPTION IS LABELLED FROM THE ANSWER, NOT FROM THE ROSTER: the schema keeps concrete
     * clock boundaries (`AVAILABILITY_MODES`, overtime-core.js), so after a shift moves the member and
     * the reviewer must both see the time that was SAVED. An unselected option states what pressing
     * it would store — the current roster.
     * @param {string} date @param {string} mode @param {any} c @param {any} a @param {number} i
     */
    function modeButton(date, mode, c, a, i) {
        const on = a?.mode === mode;
        // A selected mode reads its boundary off the stored answer; anything else off the roster.
        let label = MODE_LABELS[mode];
        if (mode === 'before') label = label.replace('{until}', (on ? a.until : c?.start) || '');
        if (mode === 'after')  label = label.replace('{from}',  (on ? a.from  : c?.end)   || '');
        // The 12-hour and all-day labels change what the declaration MEANS beside a duty, and are
        // read off `c` even when selected: nothing in the answer was stored from the roster.
        if (mode === 'twelve_hours' && c?.hasTime) label = TWELVE_ON_DUTY;
        if (mode === 'all_day'      && c?.hasTime) label = ALL_DAY_ON_DUTY;
        // Exactly one control in the group is tabbable: the selected one, or the first when nothing
        // is selected yet — which is every day on a fresh form.
        const tabbable = on || (!a?.mode && i === 0);
        // The app's type-pill idiom, two tones: "not available" offers nothing; the rest differ in WHEN.
        const tone = mode === 'unavailable' ? 'no' : 'yes';
        return `<button type="button" class="ot-mode ot-mode--${tone}" role="radio" data-date="${esc(date)}" data-mode="${esc(mode)}"
                        aria-checked="${on}" tabindex="${tabbable ? 0 : -1}">${esc(label)}</button>`;
    }

    /**
     * The willingness tick — the SECOND question. It appears ONLY once a day has an available answer
     * (a refinement of one: when, then how long), and NEVER beside "Not available", which the server
     * refuses. "Up to" is exact here: PERMISSION for a long duty, not a commitment to a 12-hour turn.
     * @param {string} date @param {any} c @param {any} a
     */
    function fullTwelveRow(date, c, a) {
        if (!a?.mode || a.mode === 'unavailable') return '';
        // A tick ALREADY GIVEN is shown wherever the day stops asking, as a saved mode keeps its
        // button (dayBlock) — hidden, it could not be taken back and went out with every save.
        if (!offersFullTwelve(c) && a.fullTwelve !== true) return '';
        const on = a.fullTwelve === true;
        return `
            <label class="ot-longday">
                <input type="checkbox" class="ot-longday-box" data-fulltwelve="${esc(date)}"${on ? ' checked' : ''}>
                <span>I'd work up to a full 12-hour day</span>
            </label>`;
    }

    /**
     * ASK TO BE TAKEN OFF A ROSTERED SUNDAY (owner). Why it exists and what it may never
     * claim: `overtime-sunday-release.js`. Unlike the willingness tick it needs no availability
     * answer first — a member unavailable all week is exactly who may need taking off a Sunday duty.
     *
     * **The class attribute is STATIC and the checked state is a CSS `:has()`.** An interpolated
     * `class="..."` is read by `native-surface-parity.test.mjs` as a list of class names, so the
     * template's punctuation becomes junk "classes", one of which compiles to a regex matching
     * almost any selector — the guard then reports violations in files this never touched.
     * @param {string} date @param {any} c @param {any} a
     */
    function sundayReleaseRow(date, c, a) {
        // A request ALREADY MADE is shown, so it can be withdrawn, though the Sunday no longer offers
        // one (now a rest day, or the roster unread) — as `fullTwelveRow` does.
        if (!offersSundayRelease(date, c) && a?.releaseRequested !== true) return '';
        const on = a?.releaseRequested === true;
        // The note is the tick's DESCRIPTION, not a live region re-announced at every repaint.
        return `
            <label class="ot-release">
                <input type="checkbox" class="ot-release-box" data-release="${esc(date)}"${on ? ` checked aria-describedby="otReleaseSaid-${esc(date)}"` : ''}>
                <span>${esc(SUNDAY_RELEASE_LABEL)}</span>
            </label>
            ${on ? `<p class="ot-release-said" id="otReleaseSaid-${esc(date)}">${esc(SUNDAY_RELEASE_ASKED)}</p>` : ''}`;
    }

    /** @param {string} date @param {any} a */
    function customRow(date, a) {
        return `
            <div class="ot-custom">
                <label class="ot-custom-label">From
                    <input type="text" class="ot-custom-input" data-date="${esc(date)}" data-which="start"
                           inputmode="numeric" maxlength="5" placeholder="HH:MM" autocomplete="off"
                           value="${esc(a.start || '')}" required>
                </label>
                <label class="ot-custom-label">To
                    <input type="text" class="ot-custom-input" data-date="${esc(date)}" data-which="end"
                           inputmode="numeric" maxlength="5" placeholder="HH:MM" autocomplete="off"
                           value="${esc(a.end || '')}" required>
                </label>
                <span class="ot-custom-hint" data-hint="${esc(date)}">${esc(customHint(a))}</span>
            </div>`;
    }

    /**
     * The one thing a custom range must say out loud: it crosses midnight, and it still belongs to
     * THIS day.
     *
     * A DAY'S ANSWER IS ABOUT A DUTY THAT STARTS THAT DAY (owner, Aug 2026;
     * OVERTIME_AVAILABILITY.md), so the hint names the ownership, not merely the fact — or a member
     * would enter the small hours twice.
     * @param {any} a
     */
    function customHint(a) {
        if (!a.start || !a.end) return 'Enter both times as HH:MM, for example 06:00';
        if (a.start === a.end)  return 'Start and end cannot match';
        return a.nextDay ? 'Runs into the next day — still this day\'s answer' : '';
    }

    /**
     * Focus one day's option after a repaint. Both selection paths — pointer/keyboard activation
     * and the arrow keys — replace the whole day list, so both have to put the keyboard back.
     * @param {string} date @param {string} mode
     */
    function focusMode(date, mode) {
        /** @type {HTMLElement|null} */ (daysHost?.querySelector(
            `[data-day="${CSS.escape(date)}"] [data-mode="${CSS.escape(mode)}"]`))?.focus();
    }

    /** The repaint above rebuilds the checkbox, so focus has to be put back on it. @param {string} date */
    function focusFullTwelve(date) {
        /** @type {HTMLElement|null} */ (daysHost?.querySelector(
            `[data-fulltwelve="${CSS.escape(date)}"]`))?.focus();
    }

    /** Keep the keyboard where the member left it — the row is repainted on every change. */
    function focusRelease(/** @type {string} */ date) {
        /** @type {HTMLElement|null} */ (daysHost.querySelector(
            `[data-release="${CSS.escape(date)}"]`))?.focus();
    }

    /** @param {string} date */
    function paintCustomHint(date) {
        const el = daysHost?.querySelector(`[data-hint="${CSS.escape(date)}"]`);
        if (el) el.textContent = customHint(answers[date]);
    }

    // ── Answers ─────────────────────────────────────────────────────────────────────────────────

    /**
     * Put a transition's result back, deleting the day when nothing is left of it — a key holding
     * `undefined` would still be a key to `Object.keys`, the submit payload and the dirty-guard.
     * The transitions themselves live in overtime-answer.js, tested against each other.
     * @param {string} date @param {any} next
     */
    function setAnswer(date, next) {
        if (next === undefined) delete answers[date];
        else answers[date] = next;
    }

    /**
     * The dates still outstanding, in window order — the ONE traversal, and the one list.
     *
     * The count and the day an error walks to come from this one list, so they cannot disagree. The
     * rule lives in `overtime-format.js`; this closure only supplies the answers and the dates.
     * @returns {string[]}
     */
    function unfinished() {
        return unfinishedDates(answers, dates);
    }

    function updateSubmitState() {
        if (!submitBtn) return;
        const missing = unfinished().length;
        submitBtn.textContent = missing
            ? `${missing} ${missing === 1 ? 'day' : 'days'} still to answer`
            : (baseRevision ? 'Save changes' : 'Submit availability');
        // NOT disabled on incompleteness — a disabled button explains nothing; it refuses on press
        // and points at the day. It IS disabled while a send is in flight: a second press would race
        // the first into a revision conflict about the member's own save.
        submitBtn.disabled = submitting;
    }

    /**
     * Fill every day as "Not available" — a PRE-FILL, never a submission. The confirm names both
     * halves of that contract; existing staged or saved answers are overwritten in the WORKING COPY
     * only, so Submit (and the dirty-guard on leaving) still stand between this and the server.
     */
    async function onAllUnavailable() {
        const sendWord = baseRevision ? 'Save changes' : 'Submit availability';   // the button's own words
        const ok = await confirmDialog({
            title: 'Not available all week?',
            message: `This fills all seven days as \u201cNot available\u201d. Nothing is sent until you press ${sendWord}.`,
            confirmLabel: 'Fill all seven days',
        });
        if (!ok) return;
        // A mode change on every day at once, through the same transition as a single press — so a
        // staged Sunday-release request survives it (overtime-answer.js, rule 2).
        for (const d of dates) answers[d] = withMode(answers[d], 'unavailable', ctx.byDate[d]);
        paintDays();
        updateSubmitState();
        say(`All seven days set to Not available — press ${sendWord} to send your answer.`, 'ok');
    }

    // ── Submit ──────────────────────────────────────────────────────────────────────────────────

    async function onSubmit() {
        const outstanding = unfinished();
        if (outstanding.length) {
            const date = outstanding[0];
            say(`Answer ${date ? shortDate(date) : 'every day'} before submitting.`, 'warn');
            focusDay(date);
            return;
        }

        if (submitting) return;
        submitting = true;
        try { await sendSubmission(); }
        finally { submitting = false; if (submitBtn) submitBtn.disabled = false; }
    }

    /** The send and everything after it, run with `submitting` held (see updateSubmitState). */
    async function sendSubmission() {
        // The client's clock decides only what it SAYS, never whether to send. Past the grace band
        // it still sends — the server is the authority and its refusal is at least true.
        const disposition = submitDisposition(OTD.correctedNow(), win.finalDeadlineAt);
        say(disposition === 'open' ? 'Saving…' : 'Deadline may have passed — checking with the server…', 'busy');
        submitBtn.disabled = true;

        // A SNAPSHOT, sent and then recorded: the day controls stay live while "Saving…" shows, so
        // recording `answers` after the await would mark an unsent edit as saved.
        const sent = deepCopy(answers);
        const r = await OTD.submitOvertimeAvailability(win.weekEnding, sent, baseRevision);

        if (r.ok) {
            submitBtn.disabled = false;
            baseRevision = r.data.revision;
            pendingMutationId = null;
            // Write the win we hold, too: `renderMine` re-renders the week LIST from these objects.
            // The receipt's time moves with a real change, not a no-op; `serverNow` is the instant
            // the server decided the write — the one it stamps `acceptedAt` with.
            const at = !r.data.noop && typeof r.data.serverNow === 'number' ? r.data.serverNow : null;
            // The SERVER's phase at the moment it decided: accepted at 12:03 on the first deadline's
            // day, the head must stop saying "Answers due" — the page keeps no timer.
            if (r.data.phase === 'INITIAL_OPEN' || r.data.phase === 'FINAL_OPEN') win.phase = r.data.phase;
            win.submission = {
                ...(win.submission || {}),
                days: sent,
                currentRevision: r.data.revision,
                ...(at ? { updatedAt: at } : {}),
                ...(at && r.data.created ? { firstAcceptedAt: at } : {}),
            };
            say(r.data.noop ? 'Already saved — no changes to record.' : '✓ Availability submitted.', 'ok');
            // Repaint: the gold/cream tints are now simply SAVED.
            paintDays();
            // The receipt lives in the head, which `paintDays` does not own.
            paintHead();
            updateSubmitState();
            onSaved();
            return;
        }

        // The button stays disabled THROUGH reconciliation, or a second submission could race the
        // re-read. A `network` failure is as unknown as a timeout for a WRITE (iOS suspends a page
        // mid-request; a cut-off 200 reads as `network` — overtime-data.js), and so is a 5xx the
        // server did not name. Keeping the id lets a later conflict say the save was theirs.
        if (writeOutcomeUnknown(r)) {
            pendingMutationId = r.mutationId;
            await reconcile();
            submitBtn.disabled = false;
            return;
        }
        submitBtn.disabled = false;
        if (r.code === 'revision-conflict') { showConflict(r); return; }
        if (r.code === 'closed') { closeHere(); return; }

        // A refusal that names a DAY gets copy that names the day, and the page walks there.
        // Everything else gets words matched to what failed (submitFailureCopy).
        const failDate = typeof r.data?.date === 'string' ? r.data.date : null;
        say(submitFailureCopy(r.code, failDate ? shortDate(failDate) : null), 'warn');
        if (failDate) focusDay(failDate);
    }

    /**
     * The server refused the send because the form has CLOSED — the page never decides that on its
     * own clock (header rule 2), so this is where it learns. It becomes the closed form where it
     * stands: what the server HOLDS, read-only, and why.
     */
    function closeHere() {
        closed = true;
        win.phase = 'CLOSED';
        for (const d of Object.keys(answers)) delete answers[d];
        Object.assign(answers, win.submission?.days ? deepCopy(win.submission.days) : {});
        for (const sel of ['.ot-bulk-row', '.ot-cap-note']) host.querySelector(sel)?.remove();
        submitBtn?.remove();
        const warning = host.querySelector('.ot-roster-warning');
        if (warning) warning.innerHTML = rosterWarning();
        paintHead();
        paintDays();
        say('This form closed before your answers reached the server, so '
            + (win.submission ? 'this change was not saved — what you submitted earlier stands. '
                : 'nothing was submitted for this week. ')
            + 'If your circumstances have changed, speak to your manager.', 'warn');
    }

    /**
     * A timed-out or cut-off submission may still have been written. Re-read and look for OUR mutation id.
     *
     * Each verdict its own message, and `unknown` matters most: with the network still down there is
     * no honest answer, and guessing "failed" invites a second, conflicting submission.
     */
    async function reconcile() {
        say('Checking whether your form was saved…', 'busy');
        const state = await OTD.getMyOvertimeState({ keepReadAt: true });   // adopts the submission, not the phases
        const fresh = state.ok
            ? (state.data.windows || []).find((/** @type {any} */ w) => w.weekEnding === win.weekEnding)
            : null;
        const verdict = reconcileVerdict(state.ok, fresh?.submission, pendingMutationId, !!fresh);
        if (verdict === 'gone') {
            // The week is no longer ours to answer — almost always a withdrawal mid-flight. "It
            // didn't reach the server" would be unsupported, and send them to a form that has gone.
            pendingMutationId = null;
            say('This overtime week is no longer available to you, so we couldn\'t confirm the '
                + 'submission. If you\'ve been taken off this week, nothing more is needed.', 'warn');
            return;
        }
        if (verdict === 'unknown') {
            say('We couldn\'t confirm whether your form was saved. Check this week again when '
                + 'you\'re online, before submitting another version.', 'warn');
            return;
        }
        if (verdict === 'saved') {
            baseRevision = fresh.submission.currentRevision;
            pendingMutationId = null;
            win.submission = fresh.submission;   // the list rows read this — keep them truthful
            say('✓ Your earlier submission did save.', 'ok');
            // Repaint, as the success path does — or the cream tint would contradict "did save".
            // `win.submission` was just replaced, so `dayState` resolves every row to `saved`.
            paintDays();
            paintHead();
            updateSubmitState();
            onSaved();
            return;
        }
        pendingMutationId = null;
        say('That submission didn\'t reach the server. Your answers are still here — try again.', 'warn');
    }

    /**
     * Somebody else wrote since this form loaded — or, just as often, THIS member did, in a
     * request that timed out. The two want completely different words, and the server tells them
     * apart for us by returning the mutation id that won.
     */
    /** @param {any} r */
    function showConflict(r) {
        const mine = conflictIsOurs(pendingMutationId, r.data?.lastMutationId);
        const stored = r.data?.days ? summarise(r.data.days) : '';
        say(mine
            ? `Your earlier submission did save. Here's what's currently stored${stored ? ` — ${stored}` : ''}. `
              + 'Review it before making further changes.'
            : `A newer version of this form is already saved${stored ? ` — ${stored}` : ''}. `
              + "We haven't overwritten it.", 'warn');
        // Offer the authoritative state rather than merging: an automatic merge of two declarations
        // would produce a third that neither of them made.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ot-row-btn';
        btn.textContent = 'Show the saved version';
        btn.addEventListener('click', () => {
            if (r.data?.days) {
                Object.assign(answers, deepCopy(r.data.days));
                baseRevision = r.data.currentRevision;
                pendingMutationId = null;
                win.submission = {
                    ...(win.submission || {}),
                    days: deepCopy(r.data.days),
                    currentRevision: r.data.currentRevision,
                    ...(r.data.updatedAt ? { updatedAt: r.data.updatedAt } : {}),
                };
                paintDays();
                paintHead();
                updateSubmitState();
                say('Showing the saved version. Change what you need and submit again.', 'ok');
            }
        });
        feedback?.appendChild(document.createElement('br'));
        feedback?.appendChild(btn);
    }

    /** A one-line description of a stored week, for the conflict message — available by the RULE
     *  (`isAvailableAnswer`), never "any mode but unavailable", which counts an unreadable mode. */
    /** @param {Record<string, any>} days */
    function summarise(days) {
        const avail = Object.values(days).filter(isAvailableAnswer).length;
        return `available on ${avail} of ${Object.keys(days).length} days`;
    }

    /** @param {string} text @param {'ok'|'warn'|'busy'} tone */
    function say(text, tone) {
        if (!feedback) return;
        feedback.textContent = text;
        feedback.className = `ot-feedback ot-feedback--${tone}`;
    }

    /** @param {string|null} date */
    function focusDay(date) {
        if (!date) return;
        const block = daysHost?.querySelector(`[data-day="${CSS.escape(date)}"]`);
        block?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        /** @type {HTMLElement|null} */ (block?.querySelector('.ot-mode, .ot-custom-input'))?.focus();
    }
}

// ── Small helpers ───────────────────────────────────────────────────────────────────────────────

/** @param {any} o */
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

