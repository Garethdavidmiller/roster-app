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
 *   rangeStr: string, workDays: number, restCount: number }) => string} cfg.renderReady  Ready-state innerHTML.
 * @param {(workingCount: number, member: string) => string} cfg.successFeedback  Inline ✓ feedback text.
 * @param {(workingCount: number, member: string) => string} cfg.successToast     Bottom-toast text.
 * @param {() => (string|null)} cfg.getCurrentUser  Live getter for the logged-in user name.
 * @param {Function}          [cfg.showInChangeAShift] Jumps Change a Shift to a member + date.
 * @param {Function}          [cfg.showSuccess]   Scroll-independent bottom success toast.
 * @param {Function}          [cfg.beforePreview] Runs before updatePreview in the change handlers (AL: hideALConfirm).
 * @param {Function}          [cfg.afterDateChange] Runs after updatePreview in the change handlers (refresh boxes).
 * @param {Function}          [cfg.afterSave]     Runs after a successful save (refresh banner/boxes).
 * @param {Function}          [cfg.onClick]       Runs at the very top of the save click, before the member/dates
 *   guard (AL: captures + resets the over-limit-confirmed flag, exactly as the old top-of-handler code did).
 * @param {(ctx: { member: string, dates: string[], memberObj: any }) => boolean} [cfg.preSave]  Runs after the
 *   member/dates guard; return true to abort the save (AL: the over-entitlement check that shows the confirm bar).
 * @returns {{ updatePreview: () => void, saveBtn: HTMLButtonElement }}
 */
export function createRangeBookingSection(cfg) {
    const fromInput  = /** @type {HTMLInputElement}  */ (document.getElementById(cfg.prefix + 'From'));
    const toInput    = /** @type {HTMLInputElement}  */ (document.getElementById(cfg.prefix + 'To'));
    const previewEl  = /** @type {HTMLElement} */ (document.getElementById(cfg.prefix + 'Preview'));
    const saveBtn    = /** @type {HTMLButtonElement} */ (document.getElementById(cfg.prefix + 'SaveBtn'));
    const feedbackEl = /** @type {HTMLElement} */ (document.getElementById(cfg.prefix + 'Feedback'));

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

        previewEl.className = cfg.previewClass + ' ready';
        previewEl.innerHTML = cfg.renderReady({ member, dates, memberObj, memberOvByDate, rangeStr, workDays, restCount });
        saveBtn.disabled = workDays === 0;
    }

    function onDateChange() {
        cfg.beforePreview?.();
        updatePreview();
        cfg.afterDateChange?.();
    }
    fromInput.addEventListener('change', onDateChange);
    toInput.addEventListener('change', onDateChange);
    const picker = buildRangePicker(cfg.prefix);
    updatePreview();

    saveBtn.addEventListener('click', async () => {
        // onClick runs before the guard so a section (AL) can capture + reset per-click state
        // even on an early return, exactly as the old top-of-handler code did.
        cfg.onClick?.();

        const member = cfg.memberSelect.value;
        const dates  = getDates();
        if (!member || !dates || !dates.length) return;

        if (cfg.preSave && cfg.preSave({ member, dates, memberObj: teamMembers.find(m => m.name === member) })) return;

        feedbackEl.className = 'feedback';
        saveBtn.disabled    = true;
        saveBtn.textContent = `Saving ${dates.length} day${dates.length > 1 ? 's' : ''}…`;

        try {
            const { workingCount } = await recordRangeOverrides({
                type: cfg.overrideType, value: cfg.overrideValue, memberName: member, dates, changedBy: cfg.getCurrentUser() ?? '',
            });

            if (!workingCount) {
                feedbackEl.className = 'feedback error';
                feedbackEl.textContent = '⚠ No working days in that range — nothing to record.';
                feedbackEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }

            feedbackEl.className = 'feedback success';
            feedbackEl.textContent = cfg.successFeedback(workingCount, member);
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
            feedbackEl.textContent = (/** @type {any} */ (err)).partialCommit
                // A long range failed mid-way after earlier chunks committed. recordRangeOverrides
                // has already resynced the Saved-changes list from Firestore, so the admin can see
                // exactly what did land before retrying (v16.25).
                ? '⚠ The connection dropped part-way — some days may already be saved. The saved changes list has been refreshed; check it before trying again.'
                : (/** @type {any} */ (err)).message === 'auth/session-expired'
                    ? "⚠ You've been signed out — please sign in again."
                    : "⚠ Couldn't save — check your connection and try again.";
        } finally {
            // Restore the button LABEL only — let updatePreview() govern the disabled state. On the
            // SUCCESS path picker.reset() has already cleared the range and updatePreview() disabled
            // the button (empty selection); forcing disabled=false here left the primary action
            // clickable with nothing selected and an empty-state preview. updatePreview() is correct
            // for BOTH outcomes (success → empty → disabled; error/no-op → range kept → enabled) (v16.19).
            saveBtn.textContent = cfg.savingLabel;
            updatePreview();
        }
    });

    return { updatePreview, saveBtn };
}
