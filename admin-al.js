// @ts-check
// admin-al.js — Annual Leave Booking section for admin.html
// Thin wrapper over the shared createRangeBookingSection factory (admin-range-booking.js):
// it supplies the AL-specific config — the 60-day range cap, the 🏖️ preview with the
// spare-shift warning, the swapped-day question (al-swapped-days.js), the projection of what
// the save will write (admin-al-projection.js), and the over-entitlement pre-save check that
// drives the confirm bar. It owns none of those rules; it brings them to the shared factory.
// Imports data and Firebase directly; receives admin-app.js-owned DOM handles and shared
// functions via initALSection(deps) to avoid circular imports.

import { escapeHtml, parseISODate } from './roster-data.js';
import { isBeforeMemberStart } from './override-utils.js';
import { getAllOverrides, buildMemberDateMap } from './admin-overrides.js';
import { createRangeBookingSection } from './admin-range-booking.js';
import { swapDecisionDates } from './al-swapped-days.js';
import { projectAlBooking, projectAlOverage, overridesAfterSave, lieuGoesWords } from './admin-al-projection.js';
import { spareShiftNote, countSpareDays } from './admin-al-spare-note.js';

const esc = escapeHtml;

/**
 * What a saved booking says it recorded: `n` days written for `m`, `held` of them already leave, so not
 * new (the preview's own count, renderReady). "Recorded 5 days" over three already booked said 5 where
 * the balance fell by 2.
 * @param {number} n @param {string} m @param {number} held
 */
function recordedWords(n, m, held) {
    if (!held) return `Recorded ${n} day${n > 1 ? 's' : ''} of Annual Leave for ${m}`;
    const fresh = n - held;
    return `${fresh ? `Recorded ${fresh} new day${fresh > 1 ? 's' : ''} of Annual Leave` : 'No new days of Annual Leave'} for ${m} (${held} already booked)`;
}

// Module-level state for the AL over-entitlement confirmation flow.
// triggerConfirmedALSave() is called by the confirm bar in admin-app.js when
// the user accepts saving over their AL entitlement.
let _alBookingConfirmed = false;
/** @type {any} */
let _alSaveBtnRef       = null;

/**
 * Called by the AL confirm bar "Save anyway" button in admin-app.js — and the answer is for THIS press
 * only (review, Nov 2026). The click handler takes the flag at its very top, synchronously, so it has
 * been read by the time `.click()` returns; unless the press never reached the handler. A Save the page
 * has disabled since the bar went up (a period deleted below, and a rest day asks its question again)
 * ignores `.click()`, and the flag left set took the NEXT ordinary Save past the allowance check unasked.
 */
export function triggerConfirmedALSave() {
    _alBookingConfirmed = true;
    try { _alSaveBtnRef?.click(); } finally { _alBookingConfirmed = false; }
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
        const { consuming, writing } = projectAlBooking({ member: memberObj, dates, ovByDate, swapAnswers });
        // Against the allowance AFTER the save (6 Nov 2026 review): leave over a worked Boxing Day
        // takes back its day in lieu, so the same booking can fit before and not after.
        const overage = projectAlOverage({
            member: memberObj, memberName: member, overrides: getAllOverrides(), consuming,
            after: overridesAfterSave(getAllOverrides(), { memberName: member,
                writes: writing.map(date => ({ date, type: 'annual_leave', value: 'AL' })) }),
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
     * `projection` is always given: `project` below is always supplied, and `projectAlBooking`
     * returns counts even with no member resolved.
     *
     * @param {{ member: string, dates: string[], memberObj: any, memberOvByDate: Map<string, any>|null,
     *   rangeStr: string, projection?: any, sundays?: string[], sundayNote?: string }} ctx
     */
    function renderReady({ member, dates, memberObj, memberOvByDate, rangeStr, projection, sundays = [], sundayNote = '' }) {
        // A day that is STILL Spare — not one a roster upload has since assigned (admin-al-spare-note.js).
        const spareCount = countSpareDays(memberObj, dates, memberOvByDate);
        const c = projection.counts;
        // DAYS THAT ALREADY HOLD LEAVE ARE NOT NEW DAYS (review, Nov 2026). The save writes them again,
        // at the cost they already had, so "5 days" over three days already booked was booked where the
        // balance fell by 2. They are counted apart, by the projection's own `alreadyBooked`.
        const held = new Set(/** @type {string[]} */ (projection.alreadyBooked ?? []));
        const heldNote = held.size ? `${held.size} already booked` : '';
        const days = (/** @type {number} */ n, /** @type {string} */ tail = '') =>
            `${n}${held.size ? ' new' : ''} day${n === 1 ? '' : 's'}${tail}`;
        let label, restNote = '';
        if (c.unanswered > 0) {
            // Unanswered days are not counted in or out yet, so the total is deliberately withheld —
            // a figure that is about to change is worse than no figure.
            const settled = c.consuming + c.freeWritten - held.size;
            label = days(settled, ' so far');
            restNote = ` <em>(+ ${[heldNote, `${c.unanswered} rest day${c.unanswered > 1 ? 's' : ''} to answer below`].filter(Boolean).join(', ')})</em>`;
        } else {
            label = days(projection.consuming.filter(/** @param {string} d */ d => !held.has(d)).length);
            const parts = heldNote ? [heldNote] : [];
            // A written day that costs nothing is an RDW day — worked, but declining overtime is not
            // leave. It is reported because it IS being recorded, just not charged.
            // …EXCEPT A WORKED BOXING DAY (6 Nov 2026 review): its leave is free, but the work it
            // replaces earned a day in lieu, which goes with it. "At no cost" was untrue of it, so it
            // is named on its own, and the over-allowance check counts the day it takes back.
            // A Dispatcher's worked bank holiday is the same, and its leave is NOT free (7 Nov 2026
            // review), so only a lieu day that is also free comes out of "at no cost".
            const lieuDays = /** @type {string[]} */ (projection.lieuLost ?? []);
            const free = projection.freeWritten.filter(/** @param {string} d */ d => !lieuDays.includes(d) && !held.has(d)).length;
            if (free > 0) parts.push(`${free} day${free > 1 ? 's' : ''} recorded at no cost`);
            if (lieuDays.length) parts.push(lieuGoesWords(lieuDays));
            // Christmas Day and Boxing Day are named as themselves (v25.37): never counted, and for a
            // member due at work already shown as leave, so "rest day" would be the wrong word. A
            // worked Sunday is not skipped either: the save sets it as a rest day (whole-app check).
            // Nor is a day before the member's start date a rest day: they had not started (whole-app
            // fix, 10 Nov 2026). The range writer never writes one, so it is skipped all the same.
            const beforeStart = /** @type {string[]} */ (projection.skipped ?? []).filter(d =>
                isBeforeMemberStart(memberObj, parseISODate(d)) && !projection.christmas.includes(d) && !sundays.includes(d)).length;
            const rest = c.skipped - (c.christmas ?? 0) - sundays.length - beforeStart;
            if (rest > 0)          parts.push(`${rest} rest day${rest > 1 ? 's' : ''} skipped`);
            if (beforeStart > 0)   parts.push(`${beforeStart} day${beforeStart > 1 ? 's' : ''} skipped before the start date`);
            if (sundayNote)        parts.push(sundayNote);
            if (c.christmas > 0) {
                const names = [.../** @type {Set<string>} */ (new Set(projection.christmas.map(/** @param {string} d */ d =>
                    d.endsWith('-12-25') ? 'Christmas Day' : 'Boxing Day')))];
                parts.push(`${names.join(' and ')}, never counted`);
            }
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
        // A day that already held leave is written again but is not a new day (renderReady says why).
        successFeedback: (n, m, held = 0) => `✓ ${recordedWords(n, m, held)}`,
        successToast:    (n, m, held = 0) => recordedWords(n, m, held),
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
