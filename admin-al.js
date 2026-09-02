// @ts-check
// admin-al.js — Annual Leave Booking section for admin.html
// Thin wrapper over the shared createRangeBookingSection factory (admin-range-booking.js):
// it supplies the AL-specific config — the 60-day range cap, the 🏖️ preview with the
// spare-shift warning, and the over-entitlement pre-save check that drives the confirm bar.
// Imports data and Firebase directly; receives admin-app.js-owned DOM handles and shared
// functions via initALSection(deps) to avoid circular imports.

import { getALEntitlement, getBaseShift, escapeHtml, projectAnnualLeaveOverage, parseISODate } from './roster-data.js';
import { getAllOverrides, isWorkingDate, buildMemberDateMap } from './admin-overrides.js';
import { countedAlDates, consumesEntitlement } from './al-entitlement.js';
import { createRangeBookingSection } from './admin-range-booking.js';

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
    updateALBanner, updateALBookedBox, updateSickBookedBox,
    getCurrentUser, showALConfirm, hideALConfirm, showInChangeAShift, showSuccess,
}) {
    // Captured at the top of each save click (before the member/dates guard) so an early
    // return never leaves _alBookingConfirmed set true, which would silently skip the
    // entitlement check on the next save attempt.
    let confirmedOverLimit = false;

    /**
     * AL over-entitlement check — runs for each calendar year spanned by the booking
     * (a Dec–Jan range touches two years). Returns true to abort the save and show the
     * confirm bar; false to proceed.
     * @param {{ member: string, dates: string[], memberObj: any }} ctx
     */
    function checkEntitlement({ member, dates, memberObj }) {
        if (confirmedOverLimit) return false;
        const memberOvByDate = buildMemberDateMap(member);
        // Mirror recordRangeOverrides EXACTLY: exclude Sundays; if an override exists, follow it
        // (worked iff it is not a rest shift); otherwise fall back to the base shift. Falling
        // through to the base test when a NON-rest override (e.g. RDW) exists would exclude a
        // base-RD/RDW day here while recordRangeOverrides INCLUDES it — the check would then count
        // fewer days than are actually booked and let a booking slip over the cap unconfirmed.
        const workingDates = dates.filter(d => isWorkingDate(memberObj, d, memberOvByDate));
        const years = [...new Set(workingDates.map(d => d.substring(0, 4)))];
        for (const yearStr of years) {
            const entitlement = getALEntitlement(memberObj, parseInt(yearStr, 10), getAllOverrides());
            // No entitlement on record → nothing to cap against, so no confirm bar (v22.45). Same
            // reasoning as the week-grid check: a bar raised against a number we do not have is
            // worse than none. The booking itself is unaffected.
            if (entitlement === null) continue;
            // All existing AL for the year that CONSUMES entitlement — the Sunday and rest-day rules
            // now live in al-entitlement.js, which the banner and the week-grid save read too
            // (this file was the only one of the three that had the rest-day test). A re-booked day
            // already in this set is not double-counted toward the cap: the shared helper excludes
            // overlap from the new dates.
            const existingALDates = countedAlDates({ overrides: getAllOverrides(), member: memberObj, year: yearStr });
            // consumesEntitlement, not just isWorkingDate (v21.56): an rdw day inside the range is
            // WRITTEN (it is a worked day) but will not COST a day (declining overtime is not
            // leave), so counting it here raised a confirm bar for leave the member is not
            // spending — and disagreed with the week-grid check, which already asks this rule.
            const newALDates = workingDates.filter(d =>
                d.startsWith(yearStr) && consumesEntitlement(memberObj, d, memberOvByDate));
            const overage = projectAnnualLeaveOverage({ name: member, year: yearStr, existingALDates, newALDates, entitlement });
            if (overage) {
                showALConfirm(overage.headline, overage.detail, null); // null = AL booking path (not week editor)
                return true;
            }
        }
        return false;
    }

    /**
     * The 🏖️ ready-state preview, including the CEA/CES spare-shift warning.
     * @param {{ member: string, dates: string[], memberObj: any, memberOvByDate: Map<string, any>|null,
     *   rangeStr: string, workDays: number, restCount: number }} ctx
     */
    function renderReady({ member, dates, memberObj, memberOvByDate, rangeStr, workDays, restCount }) {
        // A worked day whose base is an unconfirmed Spare shift is flagged (it will be booked as AL).
        let spareCount = 0;
        if (memberObj) {
            dates.forEach(dateStr => {
                if (isWorkingDate(memberObj, dateStr, /** @type {Map<string, any>} */ (memberOvByDate)) &&
                    getBaseShift(memberObj, parseISODate(dateStr)) === 'SPARE') spareCount++;
            });
        }
        const label    = workDays === 1 ? '1 working day' : `${workDays} working day${workDays !== 1 ? 's' : ''}`;
        const restNote = restCount > 0 ? ` <em>(+ ${restCount} rest day${restCount > 1 ? 's' : ''} skipped)</em>` : '';
        const isSpareRole = memberObj && (memberObj.role === 'CEA' || memberObj.role === 'CES');
        const spareNote = (isSpareRole && spareCount > 0)
            ? `<br><em>⚠ ${spareCount} of these day${spareCount !== 1 ? 's are' : ' is'} an unconfirmed "Spare" shift. If the actual shift ends up longer than 7 hours, it may use more than 1 AL day — check with your manager if unsure.</em>`
            : '';
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
        afterDateChange: () => { updateALBanner(); updateALBookedBox(); },
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
