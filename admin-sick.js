// @ts-check
// admin-sick.js — Sick Days Recording section for admin.html
// Thin wrapper over the shared createRangeBookingSection factory (admin-range-booking.js):
// it supplies the sick-specific config — the 1-year range cap (for maternity/long-term
// absence) and the 🪑 preview. Absence is not capped, so nothing here counts absence days.
//
// …BUT AN ABSENCE CAN LOWER THE LEAVE ALLOWANCE (review of v26.22). Recorded over a day whose WORK
// earned a day in lieu — a worked Boxing Day, a Dispatcher's worked bank holiday — it takes that day
// back, as leave over it does, and the card used to let the allowance fall without a word. So it
// names those days in the preview, and raises the over-allowance bar the AL card and the week grid
// share when the fall leaves the member over. Only a FALLING allowance can raise it; the rule is
// `projectAbsenceRange` (admin-al-projection.js), never a copy here.
// Imports data and Firebase directly; receives admin-app.js-owned DOM handles and shared
// functions via initSickSection(deps) to avoid circular imports.
//
// NO PER-YEAR FIGURE, which is why the AL banner's v22.82 year bug has no analogue here (checked
// behaviourally, not assumed). That defect was a figure scoped to a YEAR — leave taken, leave left
// — derived from a fallback year rather than from the year the range picker was DISPLAYING, so
// scrolling into 2027 left next year's fresh entitlement reading as spent. This card states nothing
// scoped to a year: the 1-year cap is measured from the picked start date, the preview is built
// from the picked dates, and the booked-absences box is given no `preferredYear`, so it opens on the
// latest year with an absence and its year chips say which year is shown. So the picker's
// `onViewYearChange` is deliberately not wired here — there is nothing on this card for it to correct.

import { escapeHtml, parseISODate } from './roster-data.js';
import { createRangeBookingSection } from './admin-range-booking.js';
import { getAllOverrides, buildMemberDateMap } from './admin-overrides.js';
import { projectAbsenceRange, lieuGoesWords } from './admin-al-projection.js';

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
 * @param {Function}          [deps.showALConfirm]      Shows the over-allowance confirmation bar; its
 *   fifth argument is what "Save anyway" runs (header)
 * @param {Function}          [deps.hideALConfirm]      Hides that bar
 */
export function initSickSection({
    sickMember,
    syncSickMemberDisplay, populateMemberDropdown, lastMember,
    updateALBanner, updateALBookedBox, updateSickBookedBox, getCurrentUser, showInChangeAShift, showSuccess,
    showALConfirm, hideALConfirm,
}) {
    // "Save anyway" sets the flag and clicks Save again; the click takes it into `confirmed` FIRST
    // and clears it, so an early return can never carry a confirmation into the next save (admin-al.js).
    let confirmNext = false, confirmed = false;

    /** The allowance this range leaves the member, read through the one rule (header). @param {string} member @param {any} memberObj @param {string[]} dates @param {Map<string, any>|null} [ovByDate] */
    const allowanceAfter = (member, memberObj, dates, ovByDate = buildMemberDateMap(member)) =>
        projectAbsenceRange({ member: memberObj, memberName: member, overrides: getAllOverrides(), ovByDate, dates });

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
        renderReady: ({ member, dates, memberObj, memberOvByDate, rangeStr, workDays, restCount, sundays = [], sundayNote = '' }) => {
            const label    = workDays === 1 ? '1 absence day' : `${workDays} absence days`;
            // A worked Sunday in the range is not skipped: the save sets it as a rest day, beside the
            // absence (the shared range writer's Sunday rule), so it is named, not counted as skipped.
            const rest     = restCount - sundays.length;
            // A day in lieu the absence takes back is named, as the AL card names it (header).
            const lieu     = memberObj && memberOvByDate ? allowanceAfter(member, memberObj, dates, memberOvByDate).lieuLost : [];
            const parts    = [...(rest > 0 ? [`${rest} rest day${rest > 1 ? 's' : ''} skipped`] : []), ...(sundayNote ? [sundayNote] : []),
                ...(lieu.length ? [lieuGoesWords(lieu, 'absent')] : [])];
            const restNote = parts.length ? ` <em>(+ ${parts.join(', ')})</em>` : '';
            return `🪑 <strong>${label}</strong> for ${esc(member)}: ${rangeStr}${restNote}`;
        },
        successFeedback: (n, m) => `✓ Recorded ${n} absence day${n > 1 ? 's' : ''} for ${m}`,
        successToast:    (n, m) => `Recorded ${n} absence day${n > 1 ? 's' : ''} for ${m}`,
        getCurrentUser, showInChangeAShift, showSuccess,
        // A changed range makes a showing bar stale: "Save anyway" would record the new range unchecked.
        beforePreview: () => hideALConfirm?.(),
        afterDateChange: () => { updateSickBookedBox(); },
        // Sick recording can overwrite AL days — refresh AL counts too.
        afterSave: () => { updateALBanner(); updateALBookedBox(); updateSickBookedBox(); },
        onClick: () => { confirmed = confirmNext; confirmNext = false; },
        // Only a FALLING allowance that leaves the member over raises the bar (header).
        preSave: ({ member, dates, memberObj }) => {
            const { overage } = confirmed || !showALConfirm ? { overage: null } : allowanceAfter(member, memberObj, dates);
            if (overage) showALConfirm?.(overage.headline, overage.detail, null, [], () => { confirmNext = true; section.saveBtn.click(); });
            return !!overage;
        },
    });

    // Exposed so admin-app.js can refresh the preview when the staff member changes
    // at the top bar (see the matching note in admin-al.js). (stale-preview fix)
    return { updateSickPreview: section.updatePreview };
}
