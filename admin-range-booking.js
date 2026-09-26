// @ts-check
// admin-range-booking.js — shared skeleton for the two admin.html date-range booking
// sections (Annual Leave Booking + Sick Days Recording). Both were near-identical:
// dropdown + range picker → live preview → Firestore batch write via recordRangeOverrides.
// The per-section differences (range-length rule, preview copy, the AL over-entitlement
// pre-save check, which boxes refresh) are passed in as config/hooks; admin-al.js and
// admin-sick.js are thin wrappers over this factory (they keep their own public exports).
//
// Owns: element lookup by prefix, dropdown population (incl. the iOS optgroup fix),
//   the shared preview guard chain (no member / no dates / bad range), rest-day counting
//   via isWorkingDate, the change-listener wiring, and the whole save→feedback→refresh flow
//   incl. the session-expired vs generic error split.
// Does NOT own: the AL entitlement maths, the AL confirm-bar flag, or the spare-shift warning —
//   those live in admin-al.js and are injected via the preSave / renderReady hooks.

import { teamMembers } from './roster-data.js';
import { recordRangeOverrides, formatDisplay, buildMemberDateMap, isWorkingDate } from './admin-overrides.js';
import { buildRangePicker, getDateRange } from './admin-rangepicker.js';

import { setStatus } from './status-text.js';
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
 *   rangeStr: string, workDays: number, restCount: number, projection?: any }) => string} cfg.renderReady  Ready-state innerHTML.
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

    /** @type {any} */
    let feedbackTimer = null;

    cfg.populateMemberDropdown(cfg.memberSelect);
    // iOS Safari ignores select.value on optgroup-nested options — set option.selected directly.
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

        // Count rest days (RD/OFF, and always Sundays) in the range to warn the user.
        // isWorkingDate is the single source that matches what the booking actually writes.
        const memberObj = teamMembers.find(m => m.name === member);
        let restCount = 0;
        /** @type {Map<string, any>|null} */
        let memberOvByDate = null;
        if (memberObj) {
            const ovMap = buildMemberDateMap(memberObj.name);
            memberOvByDate = ovMap;
            dates.forEach(dateStr => { if (!isWorkingDate(memberObj, dateStr, ovMap)) restCount++; });
        }
        const workDays = dates.length - restCount;

        // ── THE SWAPPED-DAY QUESTION ───────────────────────────────────────────────────────────
        // Asked ONLY when the range actually contains such a day (the owner's rule 1) — no rest
        // days, no block, and the section behaves exactly as it did before v23.75.
        //
        // RESOLVED BEFORE THE PREVIEW IS RENDERED (v23.79). It used to run after, so `renderReady`
        // described the range from the STORED state alone and could say "1 rest day skipped" about a
        // day the admin had just declared swapped — a day Save was about to count. Nothing may call
        // a date skipped when it is going to be recorded, so the answers are settled first and the
        // projection built from them is what the preview is given.
        if (member !== swapAnswersFor) { resetSwapAnswers(); swapAnswersFor = member; }
        const pending = cfg.swapQuestion
            ? cfg.swapQuestion({ dates, memberObj, ovByDate: memberOvByDate })
            : [];
        for (const d of [...swapAnswers.keys()]) if (!pending.includes(d)) swapAnswers.delete(d);

        const projection = cfg.project
            ? cfg.project({ member, dates, memberObj, ovByDate: memberOvByDate, swapAnswers })
            : null;

        previewEl.className = cfg.previewClass + ' ready';
        previewEl.innerHTML = cfg.renderReady({
            member, dates, memberObj, memberOvByDate, rangeStr, workDays, restCount, projection,
        });
        if (pending.length) previewEl.insertAdjacentHTML('beforeend', _swapBlock(pending));

        const answered = pending.filter(d => swapAnswers.has(d)).length;
        const swapDays = pending.filter(d => swapAnswers.get(d) === true).length;
        // Unanswered blocks the save outright (rule 2). Otherwise the old rule stands, with the
        // declared swaps counting towards "is there anything to write?".
        // `saving` first (v24.26): this runs on a swap answer, a date change and admin-app's
        // _refreshAlPreview, so while a held save waits it would re-arm Save from the form alone — and
        // the held save's new documents are not in the cache yet, so a second tap books every day again.
        // With a projection, "anything to write?" is ITS answer: a rest day holding an absence passes
        // `isWorkingDate` but, answered "free", writes nothing (review A2).
        const toWrite = projection ? projection.counts.writing : workDays + swapDays;
        saveBtn.disabled = saving || answered < pending.length || toWrite === 0;
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

        // `swapAnswers` goes WITH the dates (v23.79). The over-entitlement check has to project what
        // this save will do, and until the write runs a declared swap exists nowhere else — the
        // override map still says REST, so a check built on it alone warns about the wrong number of
        // days. Passed as a copy: the check must not be able to edit the admin's answers.
        if (cfg.preSave && cfg.preSave({
            member, dates, memberObj: teamMembers.find(m => m.name === member),
            swapAnswers: new Map(swapAnswers),
        })) return;

        feedbackEl.className = 'feedback';
        saving = true;
        saveBtn.disabled    = true;
        saveBtn.textContent = `Saving ${dates.length} day${dates.length > 1 ? 's' : ''}…`;

        try {
            const { workingCount } = await recordRangeOverrides({
                type: cfg.overrideType, value: cfg.overrideValue, memberName: member, dates, changedBy: cfg.getCurrentUser() ?? '',
                swappedDates: [...swapAnswers].filter(([, yes]) => yes).map(([d]) => d),
            });

            if (!workingCount) {
                feedbackEl.className = 'feedback error';
                setStatus(feedbackEl, '⚠ No working days in that range — nothing to record.');
                feedbackEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }

            feedbackEl.className = 'feedback success';
            // Through setStatus even though the string arrives from a CONFIG CALL — `successFeedback`
            // returns '✓ Recorded …', which no regex in status-glyph-parity can see (v21.94).
            setStatus(feedbackEl, cfg.successFeedback(workingCount, member));
            clearTimeout(feedbackTimer);
            feedbackTimer = setTimeout(() => { feedbackEl.className = 'feedback'; }, 7000);
            // The form resets and Change-a-Shift scrolls into view below, so also fire
            // the bottom toast — confirmation must be visible regardless of scroll.
            cfg.showSuccess?.(cfg.successToast(workingCount, member));

            picker.reset();
            updatePreview();
            cfg.afterSave?.();
            // Jump the Change a Shift section to show what was just recorded.
            cfg.showInChangeAShift?.(member, dates[0]);
        } catch (err) {
            console.error(`[Admin] ${cfg.logLabel} save failed:`, err);
            clearTimeout(feedbackTimer);
            feedbackEl.className = 'feedback error';
            setStatus(feedbackEl, (/** @type {any} */ (err)).partialCommit
                // A long range failed mid-way after earlier chunks committed. recordRangeOverrides
                // has already resynced the Saved-changes list from Firestore, so the admin can see
                // exactly what did land before retrying (v16.25).
                ? '⚠ The connection dropped part-way — some days may already be saved. The saved changes list has been refreshed; check it before trying again.'
                : (/** @type {any} */ (err)).message === 'cache/load-failed'
                    // The initial saved-changes read never succeeded, so recordRangeOverrides refused to
                    // write against an empty cache (would duplicate overrides / erase a worked Sunday).
                    ? "⚠ Couldn't load saved changes — reload the page before recording this."
                    : (/** @type {any} */ (err)).message === 'auth/session-expired'
                        ? "⚠ You've been signed out — please sign in again."
                        : "⚠ Couldn't save — check your connection and try again.");
        } finally {
            // Restore the button LABEL only — let updatePreview() govern the disabled state. On the
            // SUCCESS path picker.reset() has already cleared the range and updatePreview() disabled
            // the button (empty selection); forcing disabled=false here left the primary action
            // clickable with nothing selected and an empty-state preview. updatePreview() is correct
            // for BOTH outcomes (success → empty → disabled; error/no-op → range kept → enabled) (v16.19).
            saveBtn.textContent = cfg.savingLabel;
            saving = false;
            updatePreview();
        }
    });

    return { updatePreview, saveBtn };
}
