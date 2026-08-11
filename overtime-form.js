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
import { loadRosterContext, rosterLabel, rosterBadge, modesFor } from './overtime-roster.js';
import {
    weekLabel, weekSpan, deadlineLabel, shortDate, phaseCopy, answerCopy, answerTone,
    answerAnchorStale, submitDisposition,
} from './overtime-format.js';

/**
 * Button labels per mode. `before`/`after` get their boundary spliced in at render.
 * @type {Record<string, string>}
 */
const MODE_LABELS = {
    unavailable:  'Not available',
    all_day:      'Available all day',
    before:       'Before {until}',
    after:        'After {from}',
    before_after: 'Before & after duty',
    custom:       'Custom times',
};

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

    paintDays();
    updateSubmitState();
    submitBtn?.addEventListener('click', onSubmit);

    // ── Render ──────────────────────────────────────────────────────────────────────────────────

    function shell() {
        return `
            <div class="ot-form-head">
                <div class="ot-form-week">${esc(weekLabel(win.weekEnding))}</div>
                <div class="ot-form-meta">
                    Roster week ${esc(weekSpan(win.weekStart, win.weekEnding))}<br>
                    ${closed
                        ? `Closed — the final deadline was ${esc(deadlineLabel(win.finalDeadlineAt))}`
                        : `${esc(phaseCopy(win.phase))}<br>Changes close ${esc(deadlineLabel(win.finalDeadlineAt))}`}
                </div>
            </div>
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
        return `
            <div class="ot-day${answered ? ' ot-day--answered' : ''}" data-day="${esc(date)}">
                <div class="ot-day-head">
                    <span class="ot-day-name">${esc(shortDate(date))}</span>
                    <span class="ot-day-roster" aria-label="Rostered: ${esc(rosterLabel(c))}">${rosterBadge(c)}</span>
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

    /** The one thing a custom range needs to say out loud: that it crosses midnight. */
    /** @param {any} a */
    function customHint(a) {
        if (!a.start || !a.end) return 'Enter both times';
        if (a.start === a.end)  return 'Start and end cannot match';
        return a.nextDay ? 'Ends the next day' : '';
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
     */
    /** @param {string} mode @param {any} c @param {any} previous */
    function buildAnswer(mode, c, previous) {
        switch (mode) {
            case 'unavailable':
            case 'all_day':
                return { mode };
            case 'before':
                return { mode, until: c?.start || '' };
            case 'after':
                return { mode, from: c?.end || '' };
            case 'before_after':
                return { mode, until: c?.start || '', from: c?.end || '' };
            case 'custom':
                // Re-pressing Custom keeps whatever was typed rather than clearing it.
                return previous?.mode === 'custom'
                    ? previous
                    : { mode, start: '', end: '', nextDay: false };
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
        submitBtn.disabled = false;

        if (r.ok) {
            baseRevision = r.data.revision;
            pendingMutationId = null;
            say(r.data.noop ? 'Already saved — no changes to record.' : '✓ Availability submitted.', 'ok');
            updateSubmitState();
            onSaved();
            return;
        }

        if (r.code === 'timeout') { pendingMutationId = r.mutationId; await reconcile(); return; }
        if (r.code === 'revision-conflict') { showConflict(r); return; }
        if (r.code === 'closed') {
            say('This form closed before your answers reached the server. Speak to a Manager.', 'warn');
            return;
        }
        if (r.code === 'cancelled') return;   // the member navigated away; nothing to report
        say(`Couldn't save (${r.code}). Check your connection and try again.`, 'warn');
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
            say('✓ Your earlier submission did save.', 'ok');
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
                paintDays();
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
