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
//
// …AND IT LEAVES A REST DAY'S RDW OR FREE LEAVE AS IT IS (review, Nov 2026). The Calendar shows an absence
// on a rest day only where it replaced contracted work, so one written over Rest Day Working, or over leave
// that cost nothing, hid a record that showed and was counted as an absence day. Such a day is not written
// (`absenceHiddenDates`, al-swapped-days.js), unless that work earned a day in lieu (above); the preview and
// the receipt name it by date, so the manager can deal with it in Change a Shift, and a range with nothing
// else in it cannot be saved (the card hands the factory its projection, as the AL card does).
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
import { isBeforeMemberStart } from './override-utils.js';
import { isChristmasClosureDate } from './christmas-leave.js';
import { createRangeBookingSection } from './admin-range-booking.js';
import { getAllOverrides, buildMemberDateMap } from './admin-overrides.js';
import { projectAbsenceRange, lieuGoesWords } from './admin-al-projection.js';
import { formatDisplay, namedDays } from './admin-period-dates.js';
import { TYPES } from './admin-shift-types.js';

const esc = escapeHtml;

/** What a rest day the range leaves as it is holds, in the app's words, and the pill that removes it.
 *  Leave or Rest Day Working are the two kinds `projectAbsenceRange` names (al-swapped-days.js). @param {any} ov */
const heldOn = (ov) => (ov?.type === 'annual_leave' ? { what: 'leave', pill: TYPES.annual_leave.pill }
    : { what: TYPES[ov?.type]?.label ?? 'a change', pill: TYPES[ov?.type]?.pill ?? '' });

/**
 * The preview's words for the rest days an absence range leaves as they are — an absence there would
 * never show on the Calendar (`absenceHiddenDates`) — one phrase per kind of record, the days named.
 * @param {string[]} dates @param {Map<string, any>|null|undefined} ovByDate @returns {string[]}
 */
function leftAloneWords(dates, ovByDate) {
    /** @type {Map<string, string[]>} */ const byWhat = new Map();
    for (const d of dates) { const { what } = heldOn(ovByDate?.get(d)); byWhat.set(what, [...(byWhat.get(what) ?? []), d]); }
    return [...byWhat].map(([what, ds]) => ds.length === 1
        ? `${namedDays(ds)} left as it is: ${what} on a rest day, where an absence would not show`
        : `${namedDays(ds)} left as they are: ${what} on rest days, where an absence would not show`);
}

/** The receipt's line for one of those days, in the week grid's receipt form (admin-save-receipt.js).
 *  @param {string} date @param {any} ov */
function leftAloneLine(date, ov) {
    const { what, pill } = heldOn(ov);
    return `${formatDisplay(date)} — rest day; the ${what} recorded here was left as it is, as an absence on a rest day `
        + `does not show on the Calendar${pill ? ` (to remove it, select ${pill} on the day in Change a Shift)` : ''}`;
}

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
    // The press clears it too, for a Save disabled since the bar went up, which a click never reaches.
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
        // WHAT THIS SAVE WILL DO, for the factory as for the preview (review, Nov 2026): the writer's own dates
        // (`projectAbsenceRange` → `rangeWriteDates`), so Save is live only when a day will be written — a
        // range whose one working day is left as it is (below) records nothing, and Save says so by being off.
        project: ({ member, dates, memberObj, ovByDate }) => {
            const absence = allowanceAfter(member, memberObj, dates, ovByDate);
            return { ...absence, counts: { writing: absence.writing.length } };
        },
        renderReady: ({ member, dates, memberObj, memberOvByDate, rangeStr, workDays, restCount, projection, sundays = [], sundayNote = '' }) => {
            // What the save writes is the writer's own rule (`projectAbsenceRange` → `rangeWriteDates`), so
            // the count and the days it leaves are read from it — and a day in lieu the absence takes back
            // is named, as the AL card names it (header).
            const absence  = projection ?? (memberObj && memberOvByDate ? allowanceAfter(member, memberObj, dates, memberOvByDate) : null);
            const written  = absence ? absence.writing.length : workDays;
            const label    = written === 1 ? '1 absence day' : `${written} absence days`;
            // EVERY DAY LEFT ALONE IS NAMED FOR WHAT IT IS, as the AL card names them (review, Nov 2026):
            // a worked Sunday is set as a rest day beside the absence (the shared range writer's Sunday
            // rule), so it is named, not skipped; Christmas Day and Boxing Day are themselves — for a member
            // due at work the Calendar shows them as leave, so "rest day" was the wrong word; and a day
            // before the start date is not a rest day, it is before they started. A rest day holding Rest
            // Day Working or leave, where an absence would never show, is left as it is and named by date
            // (`leftAloneWords`), so it can be dealt with in Change a Shift. The rest are rest days.
            const kept     = /** @type {string[]} */ (absence?.leftAlone ?? []);
            const left     = absence ? dates.filter(d => !absence.writing.includes(d) && !sundays.includes(d) && !kept.includes(d)) : [];
            const xmas     = left.filter(d => isChristmasClosureDate(d));
            const early    = left.filter(d => !xmas.includes(d) && isBeforeMemberStart(memberObj, parseISODate(d))).length;
            const rest     = absence ? left.length - xmas.length - early : restCount - sundays.length;
            const days     = [...new Set(xmas.map(d => (d.endsWith('-12-25') ? 'Christmas Day' : 'Boxing Day')))];
            const parts    = [...(rest > 0 ? [`${rest} rest day${rest > 1 ? 's' : ''} skipped`] : []),
                ...(early > 0 ? [`${early} day${early > 1 ? 's' : ''} skipped before the start date`] : []),
                ...(sundayNote ? [sundayNote] : []), ...(days.length ? [`${days.join(' and ')} skipped`] : []),
                ...leftAloneWords(kept, memberOvByDate),
                ...(absence?.lieuLost.length ? [lieuGoesWords(absence.lieuLost, 'absent')] : [])];
            const restNote = parts.length ? ` <em>(+ ${parts.join(', ')})</em>` : '';
            return `🪑 <strong>${label}</strong> for ${esc(member)}: ${rangeStr}${restNote}`;
        },
        // …and the receipt names each of those days again, with what to do about it.
        leftAloneLines: (projection, ovByDate) => (projection?.leftAlone ?? []).map((/** @type {string} */ d) => leftAloneLine(d, ovByDate?.get(d))),
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
            if (overage) showALConfirm?.(overage.headline, overage.detail, null, [], () => {
                confirmNext = true;
                try { section.saveBtn.click(); } finally { confirmNext = false; }
            });
            return !!overage;
        },
    });

    // Exposed so admin-app.js can refresh the preview when the staff member changes
    // at the top bar (see the matching note in admin-al.js). (stale-preview fix)
    return { updateSickPreview: section.updatePreview };
}
