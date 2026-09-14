// @ts-check
// admin-al.js — Annual Leave Booking section for admin.html
// Thin wrapper over the shared createRangeBookingSection factory (admin-range-booking.js):
// it supplies the AL-specific config — the 60-day range cap, the 🏖️ preview with the
// spare-shift warning, and the over-entitlement pre-save check that drives the confirm bar.
// Imports data and Firebase directly; receives admin-app.js-owned DOM handles and shared
// functions via initALSection(deps) to avoid circular imports.

import { getBaseShift, escapeHtml, parseISODate } from './roster-data.js';
import { getAllOverrides, isWorkingDate, buildMemberDateMap } from './admin-overrides.js';
import { createRangeBookingSection } from './admin-range-booking.js';
import { swapDecisionDates } from './al-swapped-days.js';
import { projectAlBooking, projectAlOverage } from './admin-al-projection.js';
import { spareShiftNote } from './admin-al-spare-note.js';

const esc = escapeHtml;

// Module-level state for the AL over-entitlement confirmation flow.
// triggerConfirmedALSave() is called by the confirm bar in admin-app.js when
// the user accepts saving over their AL entitlement.
let _alBookingConfirmed = false;
/** @type {any} */
let _alSaveBtnRef       = null;

/** Called by the AL confirm bar "Save anyway" button in admin-app.js. */
export function triggerConfirmedALSave() {
    _alBookingConfirmed = true;
    _alSaveBtnRef?.click();
}

/**
 * Sets up all Annual Leave Booking interactivity.
 *
 * @param {object} deps
 * @param {HTMLSelectElement} deps.alMember            The AL member dropdown
 * @param {Function}          deps.syncMemberDisplay   Updates the AL read-only member label
 * @param {Function}          deps.populateMemberDropdown Fills a <select> with teamMembers
 * @param {string|null}       deps.lastMember          Last-used member name from localStorage
 * @param {Function}          deps.updateALBanner      Refreshes the AL entitlement banner
 * @param {Function}          deps.setALPickerYear     Records the year the range picker is DISPLAYING
 * @param {Function}          deps.updateALBookedBox   Refreshes the AL booked-periods box
 * @param {Function}          deps.updateSickBookedBox Refreshes the sick booked-periods box
 * @param {() => (string|null)} deps.getCurrentUser     Live getter for the logged-in user name (for the
 *   changedBy field) — a getter, not a value, so an in-place sign-in (Phase 9) is reflected at write time
 * @param {Function}          deps.showALConfirm       Shows the over-entitlement confirmation bar
 * @param {Function}          deps.hideALConfirm       Hides the over-entitlement confirmation bar
 * @param {Function}          deps.showInChangeAShift  Jumps the Change a Shift section to a member + date
 * @param {Function}          deps.showSuccess         Shows the scroll-independent bottom success toast
 */
export function initALSection({
    alMember,
    syncMemberDisplay,
    populateMemberDropdown, lastMember,
    updateALBanner, updateALBookedBox, updateSickBookedBox, setALPickerYear,
    getCurrentUser, showALConfirm, hideALConfirm, showInChangeAShift, showSuccess,
}) {
    // Captured at the top of each save click (before the member/dates guard) so an early
    // return never leaves _alBookingConfirmed set true, which would silently skip the
    // entitlement check on the next save attempt.
    let confirmedOverLimit = false;

    /**
     * AL over-entitlement check.
     *
     * **It projects the admin's CURRENT ANSWERS, not just what is on record** (v23.79). Until the
     * save runs, a rest day the admin has just declared a swapped working day still reads as REST in
     * the override map — so the old check filtered it out, and a member with one day left could be
     * booked two without ever seeing the bar. The write then recorded both, correctly, and left the
     * balance negative. `projectAlBooking` is the fix: it is the same projection the preview renders
     * and the same one the save writes.
     *
     * @param {{ member: string, dates: string[], memberObj: any, swapAnswers: Map<string, boolean> }} ctx
     */
    function checkEntitlement({ member, dates, memberObj, swapAnswers }) {
        if (confirmedOverLimit) return false;
        const ovByDate = buildMemberDateMap(member);
        const { consuming } = projectAlBooking({ member: memberObj, dates, ovByDate, swapAnswers });
        const overage = projectAlOverage({
            member: memberObj, memberName: member, overrides: getAllOverrides(), consuming,
        });
        if (overage) {
            showALConfirm(overage.headline, overage.detail, null); // null = AL booking path (not week editor)
            return true;
        }
        return false;
    }

    /**
     * The 🏖️ ready-state preview, including the CEA/CES spare-shift warning.
     *
     * **IT DESCRIBES THE SAVE, NOT THE ROSTER** (v23.79). The counts come from `projection`, which
     * knows the admin's swap answers; the old version counted working and rest days from the stored
     * state alone and so could say "1 rest day skipped" about a day it was about to record. Nothing
     * here may call a date skipped when Save will count it.
     *
     * Three states, in the order a reader meets them:
     *   something still to answer → say so, and say nothing about totals that are not settled yet;
     *   everything answered       → how many days of leave this will record;
     *   days that cost nothing    → named separately, never folded into the total.
     *
     * @param {{ member: string, dates: string[], memberObj: any, memberOvByDate: Map<string, any>|null,
     *   rangeStr: string, workDays: number, restCount: number, projection?: any }} ctx
     */
    function renderReady({ member, dates, memberObj, memberOvByDate, rangeStr, workDays, restCount, projection = null }) {
        // A worked day whose base is an unconfirmed Spare shift is flagged (it will be booked as AL).
        let spareCount = 0;
        if (memberObj) {
            dates.forEach(dateStr => {
                if (isWorkingDate(memberObj, dateStr, /** @type {Map<string, any>} */ (memberOvByDate)) &&
                    getBaseShift(memberObj, parseISODate(dateStr)) === 'SPARE') spareCount++;
            });
        }
        const c = projection?.counts;
        let label, restNote = '';
        if (!c) {                                    // no projection (no member resolved): old shape
            label = `${workDays} working day${workDays !== 1 ? 's' : ''}`;
            if (restCount > 0) restNote = ` <em>(+ ${restCount} rest day${restCount > 1 ? 's' : ''} skipped)</em>`;
        } else if (c.unanswered > 0) {
            // Unanswered days are not counted in or out yet, so the total is deliberately withheld —
            // a figure that is about to change is worse than no figure.
            const settled = c.consuming + c.freeWritten;
            label = settled === 1 ? '1 day so far' : `${settled} days so far`;
            restNote = ` <em>(+ ${c.unanswered} rest day${c.unanswered > 1 ? 's' : ''} to answer below)</em>`;
        } else {
            label = c.consuming === 1 ? '1 day' : `${c.consuming} days`;
            const parts = [];
            // A written day that costs nothing is an RDW day — worked, but declining overtime is not
            // leave. It is reported because it IS being recorded, just not charged.
            if (c.freeWritten > 0) parts.push(`${c.freeWritten} day${c.freeWritten > 1 ? 's' : ''} recorded at no cost`);
            if (c.skipped > 0)     parts.push(`${c.skipped} rest day${c.skipped > 1 ? 's' : ''} skipped`);
            if (parts.length) restNote = ` <em>(+ ${parts.join(', ')})</em>`;
        }
        const isSpareRole = memberObj && (memberObj.role === 'CEA' || memberObj.role === 'CES');
        // Wording, and why a Spare day costs exactly one: admin-al-spare-note.js's header.
        const noteText  = isSpareRole ? spareShiftNote(spareCount, dates.length) : '';
        const spareNote = noteText ? `<br><em>${esc(noteText)}</em>` : '';
        return `🏖️ <strong>${label}</strong> of Annual Leave for ${esc(member)}: ${rangeStr}${restNote}${spareNote}`;
    }

    const section = createRangeBookingSection({
        prefix: 'al',
        memberSelect: alMember,
        syncMemberDisplay,
        populateMemberDropdown, lastMember,
        previewClass: 'al-preview',
        overrideType: 'annual_leave', overrideValue: 'AL',
        savingLabel: 'Record annual leave',
        logLabel: 'AL',
        // Range is validated (incl. the too-long case) in the preview; max 60 days.
        validateRange: (dates) => dates.length > 60
            ? `That's ${dates.length} days — maximum range is 60 days.`
            : null,
        renderReady,
        successFeedback: (n, m) => `✓ Recorded ${n} day${n > 1 ? 's' : ''} of Annual Leave for ${m}`,
        successToast:    (n, m) => `Recorded ${n} day${n > 1 ? 's' : ''} of Annual Leave for ${m}`,
        getCurrentUser, showInChangeAShift, showSuccess,
        beforePreview: () => hideALConfirm?.(),
        // ASK ABOUT REST DAYS IN THE RANGE, AND REFUSE TO SAVE UNTIL EACH IS ANSWERED (v23.75).
        // Leave on a rest day costs nothing unless the member was SWAPPED onto it, and only the
        // person booking knows which. Deliberately AL-ONLY — `admin-sick.js` passes no
        // `swapQuestion`, so an absence keeps skipping rest days silently: being off sick on a day
        // you were not due to work is a different question, and not one this answers.
        swapQuestion: ({ dates, memberObj, ovByDate }) => swapDecisionDates({ dates, memberObj, ovByDate }),
        // The SAME projection the over-entitlement check and the write use (admin-al-projection.js).
        project: ({ dates, memberObj, ovByDate, swapAnswers }) =>
            projectAlBooking({ member: memberObj, dates, ovByDate, swapAnswers }),
        afterDateChange: () => { updateALBanner(); updateALBookedBox(); },
        // The picker crossing into another year is a change of SUBJECT, not of selection: the
        // figures above it describe a year, and the reader is now looking at a different one.
        // THE LIST TOO (v23.15): it opens on the banner's year (`pickBookedYear`'s preferred rung),
        // so re-running only the banner left the two naming different years — the figures for 2027
        // above a list still showing 2026. Found by the review; pinned by e2e.
        onViewYearChange: (/** @type {number} */ y) => { setALPickerYear(y); updateALBanner(); updateALBookedBox(); },
        afterSave: () => { updateALBanner(); updateALBookedBox(); updateSickBookedBox(); },
        onClick: () => { confirmedOverLimit = _alBookingConfirmed; _alBookingConfirmed = false; },
        preSave: checkEntitlement,
    });
    _alSaveBtnRef = section.saveBtn;

    // Expose the preview refresher so admin-app.js can re-run it when the staff member
    // changes at the top bar — otherwise the preview keeps naming the previous person
    // and their rest-day count until the date inputs are touched again. (stale-preview fix)
    return { updateAlPreview: section.updatePreview };
}
