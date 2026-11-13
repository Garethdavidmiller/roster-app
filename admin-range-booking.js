// @ts-check
// admin-range-booking.js — shared skeleton for the two admin.html date-range booking
// sections (Annual Leave Booking + Sick Days Recording). Both were near-identical:
// dropdown + range picker → live preview → Firestore batch write via recordRangeOverrides.
// The per-section differences (range-length rule, preview copy, the AL over-entitlement
// pre-save check, which boxes refresh) are passed in as config/hooks; admin-al.js and
// admin-sick.js are thin wrappers over this factory (they keep their own public exports).
//
// Owns: element lookup by prefix, dropdown population (the remembered member set through its options),
//   the shared preview guard chain (no member / no dates / bad range), rest-day counting
//   via isWorkingDate, the change-listener wiring, and the whole save→feedback→refresh flow
//   incl. the session-expired vs generic error split.
// Does NOT own: the AL entitlement maths, the AL confirm-bar flag, or the spare-shift warning —
//   admin-al.js injects them via the preSave / renderReady / project / swapQuestion hooks (the
//   maths itself is admin-al-projection.js and admin-al-spare-note.js).
//
// ── ONE PICTURE OF THE MEMBER, AND THE SAVE ACTS ON THE ONE ON SCREEN NOW ──────────────────────
//
// What a save will do is decided by `_plan` — the record as it stands, and the answers given — and
// the preview draws it. The Save click decides AGAIN, at the click, and refuses on two answers the
// preview may not have had (whole-app check, 10 Nov 2026):
//   · the member's records are not read yet (or the read failed). The over-allowance check, the
//     swap answers and the receipt were decided from the cache as it stood, while the write waited
//     for the read and decided again from what arrived — one save, two pictures of the member. The
//     week grid refuses in the same state, in the same words.
//   · a rest day needs the question and has not got it — the record changed under a drawn preview
//     (a period deleted from the list below). It was left out of the save without a word; the rule
//     is "ask, and refuse to save unanswered" (.claude/rules/admin.md), so the question is redrawn.

import { teamMembers } from './roster-data.js';
import { recordRangeOverrides, formatDisplay, buildMemberDateMap, isWorkingDate, isSaveInFlight, setSaveInFlight,
         hasOverrideAuthorityFor } from './admin-overrides.js';
import { loadFailedFor, DELETE_REFUSED } from './admin-override-store.js';
import { buildRangePicker, getDateRange } from './admin-rangepicker.js';
import { buildSaveReceipt } from './admin-save-receipt.js';
import { rangeSundayCorrections } from './admin-al-projection.js';
import { holdFeedback, fadeFeedback } from './admin-booked-periods.js';

import { setStatus } from './status-text.js';
import { unconfirmedWriteLine, saveFailureMessage, signedOutLine } from './claim-retry.js';
/**
 * Wire one date-range booking section (AL or sick).
 *
 * @param {object} cfg
 * @param {string}            cfg.prefix          Element-id + range-picker prefix ('al' | 'sick').
 * @param {HTMLSelectElement} cfg.memberSelect    The (hidden) member dropdown for this section.
 * @param {Function}          cfg.syncMemberDisplay Updates the read-only member label.
 * @param {Function}          cfg.populateMemberDropdown Fills a <select> with teamMembers.
 * @param {string|null}       cfg.lastMember      Last-used member name from localStorage.
 * @param {string}            cfg.previewClass    Base class for the preview element
 *   (' empty'/' error'/' ready' is appended). AL: 'al-preview'; sick: 'al-preview sick-preview'.
 * @param {string}            cfg.overrideType    recordRangeOverrides type ('annual_leave' | 'sick').
 * @param {string}            cfg.overrideValue   recordRangeOverrides value ('AL' | 'SICK').
 * @param {string}            cfg.savingLabel     Idle/restore text for the save button.
 * @param {string}            cfg.logLabel        console.error prefix ('AL' | 'Sick').
 * @param {(dates: string[]) => (string|null)} cfg.validateRange  Range-length rule → error msg or null.
 * @param {(ctx: { member: string, dates: string[], memberObj: any, memberOvByDate: Map<string, any>|null,
 *   rangeStr: string, workDays: number, restCount: number, projection?: any, sundays?: string[],
 *   sundayNote?: string }) => string} cfg.renderReady  Ready-state innerHTML. `sundays` are the Sundays
 *   this save will set as rest days (`rangeSundayCorrections`) — counted in `restCount`/`skipped`, but
 *   not skipped — and `sundayNote` says so in words, or is '' when there are none.
 * @param {(workingCount: number, member: string) => string} cfg.successFeedback  Inline ✓ feedback text.
 * @param {(workingCount: number, member: string) => string} cfg.successToast     Bottom-toast text.
 * @param {() => (string|null)} cfg.getCurrentUser  Live getter for the logged-in user name.
 * @param {Function}          [cfg.showInChangeAShift] Jumps Change a Shift to a member + date.
 * @param {Function}          [cfg.showSuccess]   Scroll-independent bottom success toast.
 * @param {Function}          [cfg.beforePreview] Runs before updatePreview in the change handlers (AL: hideALConfirm).
 * @param {Function}          [cfg.afterDateChange] Runs after updatePreview in the change handlers (refresh boxes).
 * @param {(year:number)=>void} [cfg.onViewYearChange] Called with the YEAR when the picker's displayed month crosses into a new one.
 * @param {Function}          [cfg.afterSave]     Runs after a successful save (refresh banner/boxes).
 * @param {Function}          [cfg.onClick]       Runs at the very top of the save click, before the member/dates
 *   guard (AL: captures + resets the over-limit-confirmed flag, exactly as the old top-of-handler code did).
 * @param {(ctx: { member: string, dates: string[], memberObj: any, ovByDate: Map<string, any>|null,
 *   swapAnswers: Map<string, boolean> }) => any} [cfg.project]  WHAT THIS SAVE WILL DO (v23.79, AL only) —
 *   given the stored state AND the admin's current swap answers. Its result is handed to `renderReady`
 *   as `projection` so the preview can describe the save truthfully rather than describing the roster.
 *   Omit it (the absence card does) and `projection` is null.
 * @param {(ctx: { member: string, dates: string[], memberObj: any, swapAnswers: Map<string, boolean> })
 *   => boolean} [cfg.preSave]  Runs after the
 *   member/dates guard; return true to abort the save (AL: the over-entitlement check that shows the confirm bar).
 * @param {(ctx: { dates: string[], memberObj: any, ovByDate: Map<string, any>|null }) => string[]} [cfg.swapQuestion]
 *   THE SWAPPED-DAY QUESTION (v23.75, AL only). Returns the dates in the range whose base roster says REST and
 *   which therefore would not cost a day — the only case where leave on a rest day is real is a member who
 *   SWAPPED working days. Supplying this makes the section ASK, per day, and REFUSE TO SAVE until every question
 *   has an answer; the dates answered "swapped" are passed to `recordRangeOverrides` as `swappedDates`. Omit it
 *   (the absence card does) and rest days are skipped silently exactly as before.
 * @returns {{ updatePreview: () => void, saveBtn: HTMLButtonElement }}
 */
export function createRangeBookingSection(cfg) {
    const fromInput  = /** @type {HTMLInputElement}  */ (document.getElementById(cfg.prefix + 'From'));
    const toInput    = /** @type {HTMLInputElement}  */ (document.getElementById(cfg.prefix + 'To'));
    const previewEl  = /** @type {HTMLElement} */ (document.getElementById(cfg.prefix + 'Preview'));
    const saveBtn    = /** @type {HTMLButtonElement} */ (document.getElementById(cfg.prefix + 'SaveBtn'));
    const feedbackEl = /** @type {HTMLElement} */ (document.getElementById(cfg.prefix + 'Feedback'));

    // ── THE SWAPPED-DAY ANSWERS ────────────────────────────────────────────────────────────────
    //
    // `true` = the admin says the member was swapped onto this rest day, so the leave costs a day.
    // `false` = a genuine rest day, costing nothing (what the app always assumed, silently).
    // A date ABSENT from the map is UNANSWERED, and that is the state that blocks the save — the
    // owner's rule (14 Sep 2026): a question that appears must be answered, because a default is
    // how this went wrong in the first place.
    /** @type {Map<string, boolean>} */
    const swapAnswers = new Map();
    /** Answers are about ONE member over ONE range; changing either makes them meaningless. */
    const resetSwapAnswers = () => swapAnswers.clear();
    /** Who the current answers describe. The member can change without the RANGE changing — the top
     *  bar re-points this card at somebody else — and a date that is a rest day for both people
     *  would otherwise carry the previous member's answer into the new member's booking. */
    let swapAnswersFor = '';

    cfg.populateMemberDropdown(cfg.memberSelect);
    // Through the options, not `.value`: a remembered member no longer listed leaves the dropdown as it was, where `.value` would empty it. (WebKit honours `.value` with <optgroup>s — measured 10 Nov 2026.)
    if (cfg.lastMember) {
        for (const o of cfg.memberSelect.options) if (o.value === cfg.lastMember) { o.selected = true; break; }
    }
    cfg.syncMemberDisplay();

    // The member dropdown is kept in sync by the fieldMember change handler in admin-app.js.
    // No separate change handler here — it was never reachable because the dropdown is hidden.

    /** The raw range; validation (incl. too-long) happens in updatePreview. @returns {string[]|null} */
    function getDates() {
        return getDateRange(fromInput.value, toInput.value);
    }

    /** True while this card's save is waiting on the server (v24.26). */
    let saving = false;

    /**
     * Every write to this card's feedback line goes through here, so a fade started for an earlier
     * message can never hide a later one — an error, or a receipt meant never to time out. The fade
     * is the line's own (`holdFeedback`), shared with the list below that reports its deletes on it.
     * @param {''|'success'|'error'} kind @param {string} [text]
     */
    function _say(kind, text) {
        holdFeedback(feedbackEl);
        feedbackEl.className = kind ? `feedback ${kind}` : 'feedback';
        if (text !== undefined) setStatus(feedbackEl, text);
    }

    function _setEmpty(/** @type {string} */ msg) {
        previewEl.className = cfg.previewClass + ' empty';
        previewEl.textContent = msg;
        saveBtn.disabled = true;
    }
    function _setError(/** @type {string} */ msg) {
        previewEl.className = cfg.previewClass + ' error';
        previewEl.textContent = msg;
        saveBtn.disabled = true;
    }

    /**
     * What a save of `dates` for `member` would do NOW — the one computation the preview draws and
     * the Save click checks (header). It also settles the swap answers: a new member drops them, and
     * an answer for a day that no longer needs the question is forgotten.
     * @param {string} member @param {string[]} dates
     */
    function _plan(member, dates) {
        // Count rest days (RD/OFF, and always Sundays) in the range to warn the user.
        // isWorkingDate is the single source that matches what the booking actually writes.
        const memberObj = teamMembers.find(m => m.name === member);
        /** @type {Map<string, any>|null} */
        const ovByDate = memberObj ? buildMemberDateMap(memberObj.name) : null;
        let restCount = 0;
        if (memberObj && ovByDate) dates.forEach(d => { if (!isWorkingDate(memberObj, d, ovByDate)) restCount++; });
        const workDays = dates.length - restCount;
        // Asked ONLY when the range actually contains such a day (the owner's rule 1) — no rest days,
        // no block. Resolved BEFORE the projection (v23.79): nothing may call a date skipped when
        // Save is going to record it, so the answers are settled first.
        if (member !== swapAnswersFor) { resetSwapAnswers(); swapAnswersFor = member; }
        const pending = cfg.swapQuestion ? cfg.swapQuestion({ dates, memberObj, ovByDate }) : [];
        for (const d of [...swapAnswers.keys()]) if (!pending.includes(d)) swapAnswers.delete(d);
        const projection = cfg.project ? cfg.project({ member, dates, memberObj, ovByDate, swapAnswers }) : null;
        /** @type {string[]} the rest days still waiting for their answer */
        const open = projection?.unanswered ?? pending.filter(d => !swapAnswers.has(d));
        // With a projection, "anything to write?" is ITS answer: a rest day holding an absence passes
        // `isWorkingDate` but, answered "free", writes nothing (review A2).
        const toWrite = projection ? projection.counts.writing : workDays + pending.filter(d => swapAnswers.get(d) === true).length;
        // The worked Sundays the writer sets as rest days — only ever alongside a day of the booking.
        const sundays = toWrite > 0 ? rangeSundayCorrections({ dates, memberObj, ovByDate }) : [];
        return { memberObj, ovByDate, restCount, workDays, pending, projection, open, toWrite, sundays };
    }

    function updatePreview() {
        const member = cfg.memberSelect.value;
        const dates  = getDates();

        if (!member)                         { _setEmpty('Select a staff member above.'); return; }
        if (!fromInput.value || !toInput.value) { _setEmpty('Select a date range to see a preview.'); return; }
        if (dates === null)                  { _setError('The end date must be on or after the start date.'); return; }

        const rangeErr = cfg.validateRange(dates);
        if (rangeErr) { _setError(rangeErr); return; }

        const fromDisp = formatDisplay(dates[0]);
        const toDisp   = formatDisplay(dates[dates.length - 1]);
        const rangeStr = dates.length === 1 ? fromDisp : `${fromDisp} – ${toDisp}`;

        const p = _plan(member, dates);
        const n = p.sundays.length;
        previewEl.className = cfg.previewClass + ' ready';
        previewEl.innerHTML = cfg.renderReady({
            member, dates, memberObj: p.memberObj, memberOvByDate: p.ovByDate, rangeStr,
            workDays: p.workDays, restCount: p.restCount, projection: p.projection, sundays: p.sundays,
            sundayNote: n ? (n === 1 ? '1 Sunday set as a rest day' : `${n} Sundays set as rest days`) : '',
        });
        if (p.pending.length) previewEl.insertAdjacentHTML('beforeend', _swapBlock(p.pending));

        // Unanswered blocks the save outright (rule 2); otherwise "is there anything to write?".
        // `saving` first (v24.26): this runs on a swap answer, a date change and admin-app's
        // _refreshAlPreview, so while a held save waits it would re-arm Save from the form alone — and
        // the held save's new documents are not in the cache yet, so a second tap books every day again.
        saveBtn.disabled = saving || p.open.length > 0 || p.toWrite === 0;
    }

    /**
     * The question, one row per affected day. Buttons rather than checkboxes because the answer is
     * a CHOICE between two readings of the day, not a thing to opt into — and because an unticked
     * checkbox looks answered, which is the one thing this must never look.
     * @param {string[]} pending
     */
    function _swapBlock(pending) {
        const rows = pending.map(d => {
            const yes = swapAnswers.get(d) === true;
            const no  = swapAnswers.get(d) === false;
            return `<div class="swapday-row" data-date="${d}">`
                 + `<span class="swapday-date">${formatDisplay(d)}</span>`
                 + `<span class="swapday-opts">`
                 + `<button type="button" class="swapday-opt" data-answer="yes" data-date="${d}" aria-pressed="${yes}">Swapped — counts</button>`
                 + `<button type="button" class="swapday-opt" data-answer="no"  data-date="${d}" aria-pressed="${no}">Rest day — free</button>`
                 + `</span></div>`;
        }).join('');
        const n = pending.length;
        return `<div class="swapday-ask" role="group" aria-label="Rest days in this range">`
             + `<p class="swapday-lead"><strong>${n === 1 ? 'This day is a rest day' : `${n} of these days are rest days`}</strong> on the roster. `
             + `Leave on a rest day only costs a day if the member was <strong>swapped</strong> onto it. `
             + `Answer each one — nothing is recorded until you do.</p>${rows}</div>`;
    }

    /**
     * The days this save changes or leaves alone that its headline does not say, as receipt lines:
     * rest days answered "Rest day — free" (.claude/rules/admin.md → "AL on a rest day is ASKED
     * about": the receipt names the days it left alone, on BOTH surfaces) — named differently when
     * leave already stands on one — and the worked Sundays set as rest days (whole-app check: the
     * preview called those "skipped" and the receipt said nothing).
     *
     * Read from the SAME plan the click checked, so it cannot disagree with what the write does.
     * Built BEFORE the write, because a day named as already holding leave is a fact about the
     * record the save found. The Sundays are confirmed against the writer's own count afterwards.
     * @param {string} member @param {ReturnType<typeof _plan>} plan
     * @returns {{ leftAlone: string[], sundays: string[] }} receipt lines, each in date order
     */
    function _receipt(member, plan) {
        const skipped = plan.projection?.answeredFree ?? [];
        const keptLeave = skipped.filter(/** @param {string} d */ d => plan.ovByDate?.get(d)?.type === 'annual_leave');
        // The week grid's own wording, from its own builder — never a second copy of it here.
        const lines = (/** @type {any} */ args) => buildSaveReceipt({ toSave: [], removed: [], memberName: member,
            formatDate: formatDisplay, describe: () => 'Sunday, set as a rest day', ...args }).lines;
        return {
            leftAlone: skipped.length ? lines({ skipped, keptLeave }) : [],
            sundays: plan.sundays.length ? lines({ toSave: plan.sundays.map(date => ({ date, type: 'correction', value: 'RD' })) }) : [],
        };
    }

    /**
     * The success line, with the member's name kept on ONE line (polish round 2): "Recorded 4 days
     * of Annual Leave for R." / "Forrester-Blackstock" broke at 390px. The name goes in a nowrap
     * span — the Change a Shift preview does the same with its `<strong>` — built as nodes, like
     * `setStatus`, because the name is data. `textContent` still reads back the whole sentence.
     * @param {string} text @param {string} member @param {string[]} lines
     */
    function _showSaved(text, member, lines) {
        const at = member ? text.lastIndexOf(member) : -1;
        if (at < 0) { setStatus(feedbackEl, text); }
        else {
            setStatus(feedbackEl, text.slice(0, at));
            const doc  = feedbackEl.ownerDocument;
            const name = doc.createElement('span');
            name.className = 'feedback-name';
            name.textContent = member;
            feedbackEl.appendChild(name);
            const after = text.slice(at + member.length);
            if (after) feedbackEl.appendChild(doc.createTextNode(after));
        }
        if (lines.length) {
            // Shown, not folded: these are the one part of this save the headline does not say.
            const doc  = feedbackEl.ownerDocument;
            const wrap = doc.createElement('div');
            wrap.className = 'save-receipt';
            const ul = doc.createElement('ul');
            for (const l of lines) { const li = doc.createElement('li'); li.textContent = l; ul.appendChild(li); }
            wrap.appendChild(ul);
            feedbackEl.appendChild(wrap);
        }
    }

    // Delegated, because the block is rebuilt on every preview.
    previewEl.addEventListener('click', e => {
        const btn = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('.swapday-opt'));
        if (!btn) return;
        const date = btn.dataset.date || '';
        if (!date) return;
        swapAnswers.set(date, btn.dataset.answer === 'yes');
        // A changed answer changes what Save books, so a showing over-limit bar is stale — "Save
        // anyway" would book the new answers unchecked (review A19; the week grid's v16.69 rule).
        cfg.beforePreview?.();
        updatePreview();
        // The preview was rebuilt under the pressed button, which took a keyboard user's focus to
        // <body> (whole-app review, Oct 2026) — hand it to the same answer in the new block.
        /** @type {HTMLElement|null} */ (previewEl.querySelector(
            `.swapday-opt[data-date="${date}"][data-answer="${btn.dataset.answer}"]`))?.focus({ preventScroll: true });
    });

    function onDateChange() {
        cfg.beforePreview?.();
        resetSwapAnswers();   // a different range is a different set of days to judge
        updatePreview();
        cfg.afterDateChange?.();
    }
    fromInput.addEventListener('change', onDateChange);
    toInput.addEventListener('change', onDateChange);
    const picker = buildRangePicker(cfg.prefix, { onViewYearChange: cfg.onViewYearChange });
    updatePreview();

    saveBtn.addEventListener('click', async () => {
        if (saving) return;   // a disabled button cannot be tapped, but it can be .click()ed
        // onClick runs before the guard so a section (AL) can capture + reset per-click state
        // even on an early return, exactly as the old top-of-handler code did.
        cfg.onClick?.();

        const member = cfg.memberSelect.value;
        const dates  = getDates();
        if (!member || !dates || !dates.length) return;

        // NOT ON A RECORD THAT HAS NOT BEEN READ (header) — the week grid's refusal, in its words.
        if (!hasOverrideAuthorityFor(member)) {
            _say('error', globalThis.navigator?.onLine === false
                ? "⚠ You're offline, so this member's saved changes can't be checked — reconnect, then try again."
                : loadFailedFor(member)
                    ? "⚠ Couldn't load this member's saved changes — reload the page before recording this."
                    : "⚠ Still loading this member's saved changes — try again in a moment.");
            return;
        }
        // THE SAVE ACTS ON THIS MOMENT'S PLAN, NOT THE PREVIEW'S (header): a rest day that now needs
        // the question is asked, by redrawing the preview, and named — never silently left out.
        const plan = _plan(member, dates);
        if (plan.open.length) {
            updatePreview();
            _say('error', '⚠ ' + plan.open.map(/** @param {string} d */ d =>
                `${formatDisplay(d)}: say whether this rest day was a swapped working day`).join(' · '));
            return;
        }

        // `swapAnswers` goes WITH the dates (v23.79). The over-entitlement check has to project what
        // this save will do, and until the write runs a declared swap exists nowhere else — the
        // override map still says REST, so a check built on it alone warns about the wrong number of
        // days. Passed as a copy: the check must not be able to edit the admin's answers.
        if (cfg.preSave && cfg.preSave({
            member, dates, memberObj: plan.memberObj,
            swapAnswers: new Map(swapAnswers),
        })) return;

        // ONE WRITE AT A TIME ON THIS PAGE (v24.38). This card and Change a Shift each read the same
        // day's existing record and each replace it; run together, both deleted the old document and
        // each wrote a new one, leaving two for the day. The grid's in-flight flag is the shared lock.
        if (isSaveInFlight()) {
            _say('error', '⚠ Another change is still saving — try again when it has finished.');
            return;
        }
        _say('');
        saving = true;
        setSaveInFlight(true);
        saveBtn.disabled    = true;
        saveBtn.textContent = `Saving ${dates.length} day${dates.length > 1 ? 's' : ''}…`;

        // Before the write: see `_receipt`.
        const receipt = _receipt(member, plan);

        try {
            const { workingCount, sundayCount } = await recordRangeOverrides({
                type: cfg.overrideType, value: cfg.overrideValue, memberName: member, dates, changedBy: cfg.getCurrentUser() ?? '',
                swappedDates: [...swapAnswers].filter(([, yes]) => yes).map(([d]) => d),
            });

            if (!workingCount) {
                _say('error', '⚠ No working days in that range — nothing to record.');
                feedbackEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }

            // The Sundays are named only when the writer set exactly those — the count it returns is
            // the one fact about them that comes back, and a receipt may not name a day it did not change.
            const sundays = sundayCount === plan.sundays.length ? receipt.sundays
                : sundayCount ? [`${sundayCount === 1 ? '1 Sunday' : `${sundayCount} Sundays`} in the range set as ${sundayCount === 1 ? 'a rest day' : 'rest days'}`] : [];
            const lines = [...receipt.leftAlone, ...sundays];
            _say('success');
            // Through setStatus even though the string arrives from a CONFIG CALL — `successFeedback`
            // returns '✓ Recorded …', which no regex in status-glyph-parity can see (v21.94).
            _showSaved(cfg.successFeedback(workingCount, member), member, lines);
            // A receipt that names days does not time out — the week grid's rule (v21.38): a manager
            // checking it against a paper request can outlast any number picked here.
            if (!lines.length) fadeFeedback(feedbackEl, 'feedback', 7000);
            // The form resets and Change-a-Shift scrolls into view below, so also fire
            // the bottom toast — confirmation must be visible regardless of scroll.
            cfg.showSuccess?.(cfg.successToast(workingCount, member));

            // The range clears; the MONTH stays (owner's decided default, 10 Nov 2026). Moving the
            // picker back to today crossed a year after a next-year booking, and the banner above
            // switched to this year's figures beside "✓ Recorded" — it now keeps the year just booked.
            picker.reset({ keepView: true });
            updatePreview();
            cfg.afterSave?.();
            // Jump the Change a Shift section to show what was just recorded.
            cfg.showInChangeAShift?.(member, dates[0]);
        } catch (err) {
            console.error(`[Admin] ${cfg.logLabel} save failed:`, err);
            _say('error', unconfirmedWriteLine(err, 'this booking', 'Saved Changes')
                // Signed out while a chunk waited (claim-retry.js): held for that account, and
                // earlier chunks may have landed — the same check either way (v24.37). Or refused
                // because an earlier write on this page is unconfirmed (v24.39).
                ? '⚠ ' + ((/** @type {any} */ (err)).partialCommit ? signedOutLine('the rest of this booking', 'Saved Changes') : saveFailureMessage(err))
                : (/** @type {any} */ (err)).partialCommit
                // A long range failed mid-way after earlier chunks committed. recordRangeOverrides
                // has already resynced the Saved-changes list from Firestore, so the admin can see
                // exactly what did land before retrying (v16.25). A later part REFUSED because a
                // colleague had changed one of its days is said as that, not as the connection (v25.90).
                ? ((/** @type {any} */ (err)).code === DELETE_REFUSED
                    ? '⚠ Someone else has changed a day in this range, so it stopped part-way — some days are saved. The saved changes list has been refreshed; check it before trying again.'
                    : '⚠ The connection dropped part-way — some days may already be saved. The saved changes list has been refreshed; check it before trying again.')
                : (/** @type {any} */ (err)).message === 'cache/load-failed'
                    // The initial saved-changes read never succeeded, so recordRangeOverrides refused to
                    // write against an empty cache (would duplicate overrides / erase a worked Sunday).
                    ? "⚠ Couldn't load saved changes — reload the page before recording this."
                    : (/** @type {any} */ (err)).message === 'auth/session-expired'
                        ? "⚠ You've been signed out — please sign in again."
                        // Everything else is the week grid's own wording (whole-app check): a refused
                        // write (`permission-denied`) is a sign-in problem, not the connection.
                        : '⚠ ' + saveFailureMessage(err));
        } finally {
            // Restore the button LABEL only — let updatePreview() govern the disabled state. On the
            // SUCCESS path picker.reset() has already cleared the range and updatePreview() disabled
            // the button (empty selection); forcing disabled=false here left the primary action
            // clickable with nothing selected and an empty-state preview. updatePreview() is correct
            // for BOTH outcomes (success → empty → disabled; error/no-op → range kept → enabled) (v16.19).
            saveBtn.textContent = cfg.savingLabel;
            saving = false;
            setSaveInFlight(false);
            updatePreview();
        }
    });

    /** A rebuild under a focused answer hands focus to the same answer in the new block — the click
     *  path above did this since Oct 2026; a refresh when the member's records arrive did not, and a
     *  keyboard user on an answer dropped to <body> (48-hour review, Nov 2026). */
    function refreshKeepingFocus() {
        const active = /** @type {HTMLElement|null} */ (previewEl.ownerDocument?.activeElement ?? null);
        const keep = active && previewEl.contains(active) && active.matches?.('.swapday-opt')
            ? `.swapday-opt[data-date="${active.dataset.date}"][data-answer="${active.dataset.answer}"]` : null;
        updatePreview();
        if (keep) /** @type {HTMLElement|null} */ (previewEl.querySelector(keep))?.focus({ preventScroll: true });
    }

    return { updatePreview: refreshKeepingFocus, saveBtn };
}
