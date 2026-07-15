// @ts-check
// admin-sick.js — Sick Days Recording section for admin.html
// Thin wrapper over the shared createRangeBookingSection factory (admin-range-booking.js):
// it supplies the sick-specific config — the 1-year range cap (for maternity/long-term
// absence) and the 🪑 preview. No entitlement check and no confirm bar (absence is not capped).
// Imports data and Firebase directly; receives admin-app.js-owned DOM handles and shared
// functions via initSickSection(deps) to avoid circular imports.

import { escapeHtml, parseISODate } from './roster-data.js';
import { createRangeBookingSection } from './admin-range-booking.js';

const esc = escapeHtml;

/**
 * Sets up all Sick Days Recording interactivity.
 *
 * @param {object} deps
 * @param {HTMLSelectElement} deps.sickMember           The sick member dropdown
 * @param {Function}          deps.syncSickMemberDisplay Updates the sick read-only member label
 * @param {Function}          deps.populateMemberDropdown Fills a <select> with teamMembers
 * @param {string|null}       deps.lastMember           Last-used member name from localStorage
 * @param {Function}          deps.updateALBanner       Refreshes the AL entitlement banner
 * @param {Function}          deps.updateALBookedBox    Refreshes the AL booked-periods box
 * @param {Function}          deps.updateSickBookedBox  Refreshes the sick booked-periods box
 * @param {() => (string|null)} deps.getCurrentUser      Live getter for the logged-in user name (for the
 *   changedBy field) — a getter, not a value, so an in-place sign-in (Phase 9) is reflected at write time
 * @param {Function}          deps.showInChangeAShift   Jumps the Change a Shift section to a member + date
 * @param {Function}          deps.showSuccess          Shows the scroll-independent bottom success toast
 */
export function initSickSection({
    sickMember,
    syncSickMemberDisplay, populateMemberDropdown, lastMember,
    updateALBanner, updateALBookedBox, updateSickBookedBox, getCurrentUser, showInChangeAShift, showSuccess,
}) {
    const section = createRangeBookingSection({
        prefix: 'sick',
        memberSelect: sickMember,
        syncMemberDisplay: syncSickMemberDisplay,
        populateMemberDropdown, lastMember,
        previewClass: 'al-preview sick-preview',
        overrideType: 'sick', overrideValue: 'SICK',
        savingLabel: 'Record absence',
        logLabel: 'Sick',
        // Maximum range is 1 year (to allow for maternity / long-term absence).
        validateRange: (dates) => {
            const from  = parseISODate(dates[0]);
            const maxTo = new Date(from);
            maxTo.setFullYear(maxTo.getFullYear() + 1);
            const to    = parseISODate(dates[dates.length - 1]);
            return to > maxTo ? 'Maximum range is 1 year.' : null;
        },
        renderReady: ({ member, rangeStr, workDays, restCount }) => {
            const label    = workDays === 1 ? '1 absence day' : `${workDays} absence days`;
            const restNote = restCount > 0 ? ` <em>(+ ${restCount} rest day${restCount > 1 ? 's' : ''} skipped)</em>` : '';
            return `🪑 <strong>${label}</strong> for ${esc(member)}: ${rangeStr}${restNote}`;
        },
        successFeedback: (n, m) => `✓ Recorded ${n} absence day${n > 1 ? 's' : ''} for ${m}`,
        successToast:    (n, m) => `Recorded ${n} absence day${n > 1 ? 's' : ''} for ${m}`,
        getCurrentUser, showInChangeAShift, showSuccess,
        afterDateChange: () => { updateSickBookedBox(); },
        // Sick recording can overwrite AL days — refresh AL counts too.
        afterSave: () => { updateALBanner(); updateALBookedBox(); updateSickBookedBox(); },
    });

    // Exposed so admin-app.js can refresh the preview when the staff member changes
    // at the top bar (see the matching note in admin-al.js). (stale-preview fix)
    return { updateSickPreview: section.updatePreview };
}
