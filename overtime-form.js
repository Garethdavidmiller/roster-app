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
 *    week. Submit stays disabled until all seven are chosen, and the first unanswered day is what
 *    the error focuses. A default would be an answer this member did not give, about their own
 *    life, submitted under their name.
 *
 * 2. **The client never refuses a submission near the deadline.** `submitDisposition` returns
 *    `check-with-server` for the first fifteen minutes past it, and this module SENDS. A page that
 *    greys the button out on its own clock has denied somebody who was in time and left them
 *    nothing to do about it.
 *
 * 3. **A timeout is not a failure.** `AbortController` stops us waiting; it does not stop the
 *    server writing. So a timeout goes into RECONCILIATION — re-read state, look for our own
 *    `clientMutationId` — and only reports what it can actually establish. The three outcomes
 *    ("it did save" / "it did not" / "we could not tell") each have their own copy, because
 *    collapsing them is how a member ends up submitting a second, contradictory version.
 */

import * as OTD from './overtime-data.js';
import { loadRosterContext, rosterBadge } from './overtime-roster.js';
import {
    weekLabel, weekSpan, shortDate, answerCopy, answerTone, deadlineLines,
    answerAnchorStale, submitDisposition, modesFor, submitFailureCopy, sameAnswer, receiptLine,
} from './overtime-format.js';

/**
 * Button labels per mode. `before`/`after` get their boundary spliced in at render.
 *
 * ── ONE GRAMMAR: every green pill completes "Available …" (v20.84) ──────────────────────────────
 *
 * "Not available" stands apart — it is the charcoal answer, deliberately the odd one out — and the
 * rest are ellipses of one stem: All day · Up to 12 hours · Before 07:00 · After 15:00 · Before &
 * after duty · Custom times. The set used to mix three grammars ("Available all day" carried its
 * stem, "Up to 12 hours" elided it, "Custom times" named a control), which is what "the wording is
 * messy" looks like at pill scale. The recorded CHIP (`answerCopy`) keeps the full "Available all
 * day" form on purpose: chips stand alone on the reviewer's list, where the stem is the meaning —
 * a button sits inside a radiogroup already labelled "Availability on <day>".
 * @type {Record<string, string>}
 */
const MODE_LABELS = {
    unavailable:  'Not available',
    all_day:      'All day',
    // Replaced at render from the day's roster — see `modeButton`. The stem here is the rest-day
    // reading; a day with a duty on it gets the "in total" form instead.
    twelve_hours: 'Up to a 12-hour turn',
    before:       'Before {until}',
    after:        'After {from}',
    before_after: 'Before & after duty',
    custom:       'Custom times',
};

/**
 * The "up to 12 hours" label for a day that ALREADY has a duty on it.
 *
 * The owner settled the rule in Aug 2026: the declaration means the member's whole day may run to
 * twelve hours, INCLUDING what is rostered — not twelve hours on top of it. On a rest day there is
 * nothing to include, so "a 12-hour turn" says it exactly; beside an 07:00–15:00 duty the same
 * phrase is ambiguous in an eight-hour way, and a roster clerk could reasonably plan 07:00–19:00
 * from one reading and 04:00–16:00 from another.
 *
 * Both forms complete the page's one grammar — every green pill finishes "Available …" (v20.84).
 */
const TWELVE_ON_DUTY = 'Up to 12 hours in total';

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
    const closed = win.phase === 'CLOSED';

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

    host.innerHTML = shell();
    const daysHost = /** @type {HTMLElement} */ (host.querySelector('.ot-days'));
    const feedback = /** @type {HTMLElement} */ (host.querySelector('.ot-feedback'));
    const submitBtn = /** @type {HTMLButtonElement} */ (host.querySelector('.ot-submit'));
    const headHost = /** @type {HTMLElement} */ (host.querySelector('.ot-form-head'));

    paintDays();
    updateSubmitState();
    submitBtn?.addEventListener('click', onSubmit);

    /**
     * The handle the coordinator holds on this form.
     *
     * `isDirty` exists so that nothing DESTROYS a half-filled form without asking — a week switch, a
     * back-to-list, a deadline resync. The answers live in this closure and nowhere else, so from
     * outside there is no other way to know they are there.
     *
     * `setPhase` exists so that the resync has an alternative to destroying it. A window moving
     * INITIAL_OPEN → FINAL_OPEN is still fully submittable, so the only thing that has genuinely
     * changed is what the head should SAY; rebuilding the form to update a sentence threw away
     * everything the member had typed. See `wireDeadlineResync` in overtime-app.js.
     */
    return { isDirty, setPhase };

    // ── Render ──────────────────────────────────────────────────────────────────────────────────

    function shell() {
        return `<div class="ot-form-head">${headInner()}</div>
            ${ctx.knowledge === 'error' ? `
                <div class="ot-roster-warning" role="status">
                    Couldn't confirm your current MYB roster. You can still enter availability using
                    custom times.
                </div>` : ''}
            <div class="ot-days"></div>
            ${closed ? `
                <div class="ot-closed-note">
                    <strong>Final availability recorded.</strong>
                    This form is now closed. If your circumstances have changed, speak to a Manager.
                </div>` : `
                <div class="ot-feedback" aria-live="polite"></div>
                <button type="button" class="btn-action btn-primary ot-submit">Submit availability</button>`}`;
    }

    /**
     * The head's contents, separately from the shell — because two things now change it after the
     * first render: a successful save (the receipt appears) and a phase move (the deadline lines
     * turn past-tense). Both used to require rebuilding the whole form.
     */
    function headInner() {
        const receipt = receiptLine(win.submission);
        return `
            <div class="ot-form-week">${esc(weekLabel(win.weekEnding))}</div>
            ${receipt ? `<div class="ot-form-receipt"><span aria-hidden="true">✓</span> ${esc(receipt)}</div>` : ''}
            <div class="ot-form-meta">
                ${esc(weekSpan(win.weekStart, win.weekEnding))}<br>
                ${deadlineLines(win.phase, win.initialDeadlineAt, win.finalDeadlineAt)
                    .map(l => `<span class="ot-form-when${l.lead ? ' ot-form-when--lead' : ''}">${esc(l.text)}</span>`)
                    .join('<br>')}
            </div>`;
    }

    function paintHead() {
        if (headHost) headHost.innerHTML = headInner();
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
            answers[date] = buildAnswer(mode, ctx.byDate[date], answers[date]);
            paintDays();
            updateSubmitState();
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
            answers[date] = buildAnswer(String(next.getAttribute('data-mode')), ctx.byDate[date], answers[date]);
            paintDays();
            updateSubmitState();
            /** @type {any} */ (daysHost.querySelector(
                `[data-day="${CSS.escape(date)}"] [data-mode="${next.getAttribute('data-mode')}"]`))?.focus();
        }));
        daysHost.querySelectorAll('.ot-custom-input').forEach(inp => inp.addEventListener('change', () => {
            const date = String(inp.getAttribute('data-date'));
            const which = String(inp.getAttribute('data-which'));
            const cur = answers[date];
            if (!cur || cur.mode !== 'custom') return;
            cur[which] = /** @type {HTMLInputElement} */ (inp).value;
            // `nextDay` is DERIVED from the two times, never asked. The server refuses a mismatch,
            // so computing it here is not belt-and-braces — it is the only way a member can enter
            // an overnight period at all.
            cur.nextDay = !!(cur.start && cur.end && cur.end < cur.start);
            paintCustomHint(date);
            updateSubmitState();
        }));
    }

    /**
     * Which of admin's row states this day is in — the SAME grammar the Change-a-Shift week
     * teaches, so a member who knows one page can read the other (v20.83):
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
        // mode — a member who chose "After 15:00" and whose shift has since become a rest day would
        // otherwise see a day marked answered with nothing selected on it, and no way to tell what
        // they had said. Their declaration stands until they change it; the UI must show it.
        const modes = modesFor(c);
        if (a?.mode && !modes.includes(a.mode)) modes.push(a.mode);
        const answered = !!a;
        const state = dayState(a, date);
        // "Sun 30 Aug" splits into admin's two-part day label — the bold day, the lighter date —
        // so the two week-of-days surfaces read identically.
        const [dayName, ...dayDate] = shortDate(date).split(' ');
        return `
            <div class="ot-day${answered ? ' ot-day--answered' : ''}${state ? ` ot-day--${state}` : ''}" data-day="${esc(date)}">
                <div class="ot-day-head">
                    <span class="ot-day-name">${esc(dayName)} <span class="ot-day-date">${esc(dayDate.join(' '))}</span></span>
                    <!-- A visually-hidden prefix, not an aria-label: a label on a plain span is
                         unreliably announced, and the badge's own text (the shift name + times)
                         already reads well — it only needs the word that says what it IS. -->
                    <span class="ot-day-roster"><span class="visually-hidden">Rostered: </span>${rosterBadge(c)}</span>
                </div>
                ${closed
                    ? `<div class="ot-day-answer"><span class="ot-answer ot-answer--${answerTone(a)}">${esc(answerCopy(a))}</span></div>`
                    : `<div class="ot-modes" role="radiogroup" aria-label="Availability on ${esc(shortDate(date))}">
                        ${modes.map((m, i) => modeButton(date, m, c, a, i)).join('')}
                       </div>
                       ${a?.mode === 'custom' ? customRow(date, a) : ''}
                       ${answerAnchorStale(a, c) ? `
                        <p class="ot-day-stale" role="status">Your shift has changed since you
                        answered. Your answer still says <strong>${esc(answerCopy(a))}</strong> —
                        change it if that no longer suits.</p>` : ''}`}
            </div>`;
    }

    /**
     * ONE option in a radio group, not a toggle button.
     *
     * These six are mutually exclusive, so `aria-pressed` was telling a screen-reader user the wrong
     * thing about all of them at once — "not pressed" five times over, where the truth is "one of
     * six, this one selected". A radio group also carries the roving tabindex below, so Tab moves
     * PAST the group rather than through six controls on each of seven days.
     *
     * ── A SELECTED OPTION IS LABELLED FROM THE ANSWER, NOT FROM THE ROSTER ──────────────────────
     *
     * The stored schema keeps CONCRETE clock boundaries precisely so a later roster change cannot
     * silently re-point somebody's declaration (see `AVAILABILITY_MODES` in overtime-core.js). The
     * button label was defeating that: it was always built from the CURRENT shift, so a member who
     * answered "After 15:00" and whose shift was afterwards moved to 12:00–20:00 came back to a form
     * showing "After 20:00", selected — while the reviewer's screen, reading the same record, said
     * "Available after 15:00". Two people looking at one answer and seeing different times.
     *
     * So a selected option states what is SAVED. An unselected one states what pressing it would
     * store, which is the current roster — those are genuinely different questions and the answer to
     * each is now the one it asks.
     * @param {string} date @param {string} mode @param {any} c @param {any} a @param {number} i
     */
    function modeButton(date, mode, c, a, i) {
        const on = a?.mode === mode;
        // A selected mode reads its boundary off the stored answer; anything else off the roster.
        let label = MODE_LABELS[mode];
        if (mode === 'before') label = label.replace('{until}', (on ? a.until : c?.start) || '');
        if (mode === 'after')  label = label.replace('{from}',  (on ? a.from  : c?.end)   || '');
        // The 12-hour label is roster-dependent for a different reason from the two above: those
        // splice in a BOUNDARY, this one changes what the same declaration MEANS. With a duty
        // already on the day, twelve hours is a total the duty counts towards; with none, it is the
        // whole turn. Read off `c` and not off the answer even when selected, because unlike an
        // anchored boundary nothing about this answer is stored from the roster — there is no
        // earlier meaning to preserve, only the current day to describe.
        if (mode === 'twelve_hours' && c?.hasTime) label = TWELVE_ON_DUTY;
        // Exactly one control in the group is tabbable: the selected one, or the first when nothing
        // is selected yet — which is every day on a fresh form.
        const tabbable = on || (!a?.mode && i === 0);
        // The tone is the app's type-pill idiom: outlined in its own colour when idle, filled when
        // chosen. Two tones, because there are two answers — "not available" is the only one that
        // offers nothing, and the other five differ only in WHEN.
        const tone = mode === 'unavailable' ? 'no' : 'yes';
        return `<button type="button" class="ot-mode ot-mode--${tone}" role="radio" data-date="${esc(date)}" data-mode="${esc(mode)}"
                        aria-checked="${on}" tabindex="${tabbable ? 0 : -1}">${esc(label)}</button>`;
    }

    /** @param {string} date @param {any} a */
    function customRow(date, a) {
        return `
            <div class="ot-custom">
                <label class="ot-custom-label">From
                    <input type="time" class="ot-custom-input" data-date="${esc(date)}" data-which="start"
                           value="${esc(a.start || '')}" required>
                </label>
                <label class="ot-custom-label">To
                    <input type="time" class="ot-custom-input" data-date="${esc(date)}" data-which="end"
                           value="${esc(a.end || '')}" required>
                </label>
                <span class="ot-custom-hint" data-hint="${esc(date)}">${esc(customHint(a))}</span>
            </div>`;
    }

    /**
     * The one thing a custom range must say out loud: it crosses midnight, and it still belongs to
     * THIS day.
     *
     * ── A DAY'S ANSWER IS ABOUT A DUTY THAT STARTS THAT DAY (owner, Aug 2026) ───────────────────
     *
     * The app has always worked this way — answers are keyed by date, `nextDay` is derived from the
     * times, and the roster itself anchors every night turn to the day it starts on — but nothing
     * anywhere said so, which left an ordinary entry looking self-contradictory. Friday
     * 22:00–02:00 alongside Saturday "Not available" is a perfectly coherent pair under this rule
     * and an obvious mistake under the other one, and a member with no way to tell which they were
     * being asked for would reasonably enter the small hours twice.
     *
     * So the hint names the ownership rather than merely the fact. "Ends the next day" was true and
     * answered a question nobody was asking.
     * @param {any} a
     */
    function customHint(a) {
        if (!a.start || !a.end) return 'Enter both times';
        if (a.start === a.end)  return 'Start and end cannot match';
        return a.nextDay ? 'Runs into the next day — still this day\'s answer' : '';
    }

    /** @param {string} date */
    function paintCustomHint(date) {
        const el = daysHost?.querySelector(`[data-hint="${CSS.escape(date)}"]`);
        if (el) el.textContent = customHint(answers[date]);
    }

    // ── Answers ─────────────────────────────────────────────────────────────────────────────────

    /**
     * Turn a mode press into a stored answer, carrying concrete boundaries from the roster.
     * "Available after 15:00" stores `15:00` — never a reference to the shift, which may change.
     *
     * ── RE-PRESSING THE SELECTED MODE KEEPS THE SAVED ANSWER, FOR EVERY MODE ────────────────────
     *
     * Custom always had this rule (re-pressing must not wipe typed times); the anchored modes did
     * not, and the gap was a corruption path: a saved "Before 15:15" on a day whose roster has
     * since become a rest day still shows its button (a saved answer always does), and the stale
     * note beside it says "change it if that no longer suits" — inviting a tap on that very
     * button. Rebuilding from the CURRENT roster then produced `until: ''`, a day that still
     * rendered as answered, and a submit the server refused (`bad-time`). Verified end-to-end at
     * v20.75: the request carried the empty boundary. Keeping `previous` verbatim is also simply
     * what the press MEANS — "this, the thing already selected".
     */
    /** @param {string} mode @param {any} c @param {any} previous */
    function buildAnswer(mode, c, previous) {
        if (previous?.mode === mode) return previous;
        switch (mode) {
            case 'unavailable':
            case 'all_day':
            case 'twelve_hours':
                return { mode };
            case 'before':
                return { mode, until: c?.start || '' };
            case 'after':
                return { mode, from: c?.end || '' };
            case 'before_after':
                return { mode, until: c?.start || '', from: c?.end || '' };
            case 'custom':
                return { mode, start: '', end: '', nextDay: false };
            default:
                return { mode };
        }
    }

    /** All seven answered, and any custom pair complete and sane. */
    function isComplete() {
        return dates.every(d => {
            const a = answers[d];
            if (!a || !a.mode) return false;
            if (a.mode !== 'custom') return true;
            return !!a.start && !!a.end && a.start !== a.end;
        });
    }

    /** The first date the member has not finished — what an error focuses. */
    function firstIncomplete() {
        return dates.find(d => {
            const a = answers[d];
            if (!a || !a.mode) return true;
            return a.mode === 'custom' && (!a.start || !a.end || a.start === a.end);
        }) || null;
    }

    function updateSubmitState() {
        if (!submitBtn) return;
        const missing = dates.filter(d => !answers[d]).length;
        submitBtn.textContent = missing
            ? `${missing} ${missing === 1 ? 'day' : 'days'} still to answer`
            : (baseRevision ? 'Save changes' : 'Submit availability');
        // NOT disabled on incompleteness — a disabled button explains nothing, and this one has a
        // specific thing to say. It refuses on press and points at the day.
        submitBtn.disabled = false;
    }

    // ── Submit ──────────────────────────────────────────────────────────────────────────────────

    async function onSubmit() {
        if (!isComplete()) {
            const date = firstIncomplete();
            say(`Answer ${date ? shortDate(date) : 'every day'} before submitting.`, 'warn');
            focusDay(date);
            return;
        }

        // The client's clock decides only what it SAYS, never whether to send. Past the grace band
        // it still sends — the server is the authority and its refusal is at least true.
        const disposition = submitDisposition(OTD.correctedNow(), win.finalDeadlineAt);
        say(disposition === 'open' ? 'Saving…' : 'Deadline may have passed — checking with the server…', 'busy');
        submitBtn.disabled = true;

        const r = await OTD.submitOvertimeAvailability(win.weekEnding, answers, baseRevision);

        if (r.ok) {
            submitBtn.disabled = false;
            baseRevision = r.data.revision;
            pendingMutationId = null;
            // Write the win we hold, too. `renderMine` re-renders the week LIST from these same
            // window objects (the Back button, a tab switch) — and until v20.75 it re-read a
            // submission fetched at page load, so a member who submitted another week and pressed
            // Back was shown "Not submitted yet" about the form they had just watched succeed.
            win.submission = {
                ...(win.submission || {}),
                days: deepCopy(answers),
                currentRevision: r.data.revision,
            };
            say(r.data.noop ? 'Already saved — no changes to record.' : '✓ Availability submitted.', 'ok');
            // Repaint: rows that showed the gold "ready" or cream "changing a saved answer" tints
            // are now simply SAVED, and leaving the warning colours up over a recorded form would
            // keep telling the member something is still to do.
            paintDays();
            // The receipt lives in the head, so it needs its own repaint — `paintDays` only owns
            // the seven rows. Without this a member's first-ever submission leaves the head with no
            // receipt until they reload, which is the one moment they most want to see one.
            paintHead();
            updateSubmitState();
            onSaved();
            return;
        }

        // The button stays disabled THROUGH reconciliation: it re-reads state to decide whether
        // the timed-out write landed, and a second submission racing that read is exactly the
        // contradictory-double this feature is careful about everywhere else.
        if (r.code === 'timeout') {
            pendingMutationId = r.mutationId;
            await reconcile();
            submitBtn.disabled = false;
            return;
        }
        submitBtn.disabled = false;
        if (r.code === 'revision-conflict') { showConflict(r); return; }
        if (r.code === 'closed') {
            say('This form closed before your answers reached the server. Speak to a Manager.', 'warn');
            return;
        }
        if (r.code === 'cancelled') return;   // the member navigated away; nothing to report

        // A refusal that names a DAY gets copy that names the day, and the page walks there —
        // the message and the scroll agreeing about where the problem is. Everything else gets
        // words matched to what actually failed; see submitFailureCopy for why "check your
        // connection" was the wrong sentence for most of these.
        const failDate = typeof r.data?.date === 'string' ? r.data.date : null;
        say(submitFailureCopy(r.code, failDate ? shortDate(failDate) : null), 'warn');
        if (failDate) focusDay(failDate);
    }

    /**
     * A timed-out submission may still have been written. Re-read and look for OUR mutation id.
     *
     * Three outcomes, three messages, and the third one is the important one: when the network is
     * still down there is no honest answer, so it says so instead of guessing. Guessing "failed"
     * here invites a second submission that would then legitimately conflict.
     */
    async function reconcile() {
        say('Checking whether your form was saved…', 'busy');
        const state = await OTD.getMyOvertimeState();
        if (!state.ok) {
            say('We couldn\'t confirm whether your form was saved. Check this week again when '
                + 'you\'re online, before submitting another version.', 'warn');
            return;
        }
        const fresh = (state.data.windows || []).find((/** @type {any} */ w) => w.weekEnding === win.weekEnding);
        if (fresh?.submission?.lastMutationId && fresh.submission.lastMutationId === pendingMutationId) {
            baseRevision = fresh.submission.currentRevision;
            pendingMutationId = null;
            win.submission = fresh.submission;   // the list rows read this — keep them truthful
            say('✓ Your earlier submission did save.', 'ok');
            // Repaint for the same reason the success path does (v20.83) — and this path needs it
            // MORE, because it is the one that tells somebody their form saved after they had every
            // reason to think it had not. Without it the seven rows keep the cream "you are about
            // to overwrite a saved answer" tint over the words "your submission did save", which is
            // the page contradicting itself at the exact moment the member is looking for
            // reassurance. `win.submission` was just replaced above, so `dayState` now resolves
            // every row to `saved`.
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
        const mine = pendingMutationId && r.data?.lastMutationId === pendingMutationId;
        const stored = r.data?.days ? summarise(r.data.days) : '';
        say(mine
            ? `Your earlier submission did save. Here's what's currently stored${stored ? ` — ${stored}` : ''}. `
              + 'Review it before making further changes.'
            : `A newer version of this form is already saved${stored ? ` — ${stored}` : ''}. `
              + "We haven't overwritten it.", 'warn');
        // Offer the authoritative state rather than merging. Seven days is small enough for a
        // person to read, and an automatic merge of two declarations about somebody's own
        // availability would produce a third that neither of them made.
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

    /** A one-line description of a stored week, for the conflict message. */
    /** @param {Record<string, any>} days */
    function summarise(days) {
        const avail = Object.values(days).filter((/** @type {any} */ d) => d?.mode && d.mode !== 'unavailable').length;
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

/** The seven Sunday→Saturday ISO dates. Mirrors the server's `weekDates`, which is authoritative. */
/** @param {string} weekStart */
function weekDates(weekStart) {
    const [y, m, d] = String(weekStart).split('-').map(Number);
    return Array.from({ length: 7 }, (_, i) => {
        const dt = new Date(Date.UTC(y, m - 1, d + i));
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    });
}

/** @param {any} o */
function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

/** @param {any} s */
function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
