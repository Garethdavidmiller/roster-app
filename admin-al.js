// @ts-check
// admin-al.js — Annual Leave Booking section for admin.html
// Imports data and Firebase directly; receives admin-app.js-owned DOM handles
// and shared functions via initALSection(deps) to avoid circular imports.

import { teamMembers, getALEntitlement, getBaseShift, isSunday, escapeHtml } from './roster-data.js';
import { isRestShift } from './app-override-utils.js';
import { getAllOverrides, recordRangeOverrides, formatDisplay, buildMemberDateMap } from './admin-overrides.js';
import { buildRangePicker, getDateRange } from './admin-rangepicker.js';

const esc = escapeHtml;

// Module-level state for the AL over-entitlement confirmation flow.
// triggerConfirmedALSave() is called by the confirm bar in admin-app.js when
// the user accepts saving over their AL entitlement.
let _alBookingConfirmed = false;
/** @type {any} */
let _alSaveBtnRef       = null;
/** @type {any} */
let _alFeedbackTimer    = null;

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
 * @param {string|null}       deps.currentUser         Logged-in user name (for changedBy field)
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
    currentUser, showALConfirm, hideALConfirm, showInChangeAShift, showSuccess,
}) {
const alFrom     = /** @type {HTMLInputElement}  */ (document.getElementById('alFrom'));
const alTo       = /** @type {HTMLInputElement}  */ (document.getElementById('alTo'));
const alPreview  = /** @type {HTMLElement} */ (document.getElementById('alPreview'));
const alSaveBtn  = /** @type {HTMLButtonElement} */ (document.getElementById('alSaveBtn'));
const alFeedback = /** @type {HTMLElement} */ (document.getElementById('alFeedback'));
_alSaveBtnRef = alSaveBtn;

populateMemberDropdown(alMember);
// iOS Safari ignores select.value on optgroup-nested options — set option.selected directly.
if (lastMember) { for (const o of alMember.options) if (o.value === lastMember) { o.selected = true; break; } }
syncMemberDisplay();

// alMember is kept in sync by the fieldMember change handler in admin-app.js.
// No separate change handler here — it was never reachable because alMember is hidden.

function getAlDates() {
    const dates = getDateRange(alFrom.value, alTo.value);
    if (dates && dates.length > 60) return dates; // let preview show the too-long error
    return dates;
}

function updateAlPreview() {
    const member = alMember.value;
    const dates  = getAlDates();

    if (!member) {
        alPreview.className = 'al-preview empty';
        alPreview.textContent = 'Select a staff member above.';
        alSaveBtn.disabled = true;
        return;
    }
    if (!alFrom.value || !alTo.value) {
        alPreview.className = 'al-preview empty';
        alPreview.textContent = 'Select a date range to see a preview.';
        alSaveBtn.disabled = true;
        return;
    }

    if (dates === null) {
        alPreview.className = 'al-preview error';
        alPreview.textContent = '"To" date must be on or after "From" date.';
        alSaveBtn.disabled = true;
        return;
    }

    if (dates.length > 60) {
        alPreview.className = 'al-preview error';
        alPreview.textContent = `That's ${dates.length} days — maximum range is 60 days.`;
        alSaveBtn.disabled = true;
        return;
    }

    const fromDisp = formatDisplay(dates[0]);
    const toDisp   = formatDisplay(dates[dates.length - 1]);
    const rangeStr = dates.length === 1 ? fromDisp : `${fromDisp} – ${toDisp}`;

    // Count rest days (RD/OFF) in the range to warn the user.
    // Checks both the base roster and any existing RD/OFF Firestore overrides so the
    // preview matches what the booking will actually skip.
    const memberObj = teamMembers.find(m => m.name === member);
    let restCount  = 0;
    let spareCount = 0; // spare days that will be booked as AL (not already overridden to RD)
    if (memberObj) {
        const memberOvByDate = buildMemberDateMap(memberObj.name);
        dates.forEach(dateStr => {
            const d    = new Date(dateStr + 'T12:00:00');
            // Check order matches recordRangeOverrides: Sunday → override → base
            if (isSunday(dateStr)) { restCount++; return; }
            const ov = memberOvByDate.get(dateStr);
            if (ov && isRestShift((/** @type {any} */ (ov)).value)) { restCount++; return; }
            const base = getBaseShift(memberObj, d);
            if (isRestShift(base)) { restCount++; return; }
            if (base === 'SPARE') spareCount++;
        });
    }
    const workDays  = dates.length - restCount;
    const label     = workDays === 1 ? '1 working day' : `${workDays} working day${workDays !== 1 ? 's' : ''}`;
    const restNote  = restCount > 0 ? ` <em>(+ ${restCount} rest day${restCount > 1 ? 's' : ''} skipped)</em>` : '';
    // Warn for CEA/CES when spare (unconfirmed) shifts will be booked as AL
    const isSpareRole = memberObj && (memberObj.role === 'CEA' || memberObj.role === 'CES');
    const spareNote = (isSpareRole && spareCount > 0)
        ? `<br><em>⚠ ${spareCount} of these day${spareCount !== 1 ? 's are' : ' is'} an unconfirmed "Spare" shift. If the actual shift ends up longer than 7 hours, it may use more than 1 AL day — check with management if unsure.</em>`
        : '';

    alPreview.className = 'al-preview ready';
    alPreview.innerHTML = `🏖️ <strong>${label}</strong> of Annual Leave for ${esc(member)}: ${rangeStr}${restNote}${spareNote}`;
    alSaveBtn.disabled = workDays === 0;
}

alFrom.addEventListener('change', () => { hideALConfirm?.(); updateAlPreview(); updateALBanner(); updateALBookedBox(); });
alTo.addEventListener('change',   () => { hideALConfirm?.(); updateAlPreview(); updateALBanner(); updateALBookedBox(); });
const alPicker = buildRangePicker('al');
updateAlPreview();

alSaveBtn.addEventListener('click', async () => {
    // Capture and immediately reset the confirmed flag so early returns never
    // leave it set true, which would silently skip the entitlement check on
    // the next save attempt.
    const confirmedOverLimit = _alBookingConfirmed;
    _alBookingConfirmed = false;

    const member = alMember.value;
    const dates  = getAlDates();
    if (!member || !dates || !dates.length) return;

    // Annual leave entitlement check — runs for each calendar year spanned by
    // the booking (a Dec–Jan range touches two years).
    const memberObj = teamMembers.find(m => m.name === member);
    if (!confirmedOverLimit) {
        const memberOvByDate = buildMemberDateMap(member);
        // Mirror recordRangeOverrides: exclude Sundays, existing RD overrides, and base rest days
        const workingDates = dates.filter(d => {
            if (isSunday(d)) return false;
            const ov = memberOvByDate.get(d);
            if (ov && isRestShift((/** @type {any} */ (ov)).value)) return false;
            const base = getBaseShift(/** @type {any} */ (memberObj), new Date(d + 'T12:00:00'));
            return !isRestShift(base);
        });
        const years = [...new Set(workingDates.map(d => d.substring(0, 4)))];
        for (const yearStr of years) {
            const entitlement    = getALEntitlement(/** @type {any} */ (memberObj), parseInt(yearStr, 10), getAllOverrides());
            // Collect existing AL dates as a Set to subtract overlap from the new booking
            // (re-booking dates already marked AL must not double-count toward the cap).
            const existingALDates = new Set(
                getAllOverrides()
                    .filter(o => o.memberName === member && o.type === 'annual_leave' &&
                                 o.date?.startsWith(yearStr) && !isSunday(o.date))
                    .map(o => o.date)
            );
            const existingAL     = existingALDates.size;
            const newALInYear    = workingDates.filter(d => d.startsWith(yearStr) && !existingALDates.has(d)).length;
            const projectedTotal = existingAL + newALInYear;
            if (projectedTotal > entitlement) {
                const over = projectedTotal - entitlement;
                showALConfirm(
                    `${member} will be ${over} day${over !== 1 ? 's' : ''} over their ${yearStr} AL entitlement`,
                    `${projectedTotal} days used of ${entitlement} allowed in ${yearStr}`,
                    null // null = AL booking path (not week editor)
                );
                return;
            }
        }
    }

    alFeedback.className = 'feedback';
    alSaveBtn.disabled    = true;
    alSaveBtn.textContent = `Saving ${dates.length} day${dates.length > 1 ? 's' : ''}…`;

    try {
        const { workingCount } = await recordRangeOverrides({
            type: 'annual_leave', value: 'AL', memberName: member, dates, changedBy: currentUser ?? '',
        });

        if (!workingCount) {
            alFeedback.className = 'feedback error';
            alFeedback.textContent = '⚠ No working days in that range — nothing to record.';
            alFeedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
        }

        alFeedback.className = 'feedback success';
        alFeedback.textContent = `✓ Recorded ${workingCount} day${workingCount > 1 ? 's' : ''} of Annual Leave for ${member}`;
        clearTimeout(_alFeedbackTimer);
        _alFeedbackTimer = setTimeout(() => { alFeedback.className = 'feedback'; }, 7000);
        // The form resets and Change-a-Shift scrolls into view below, so also fire
        // the bottom toast — confirmation must be visible regardless of scroll.
        showSuccess?.(`Recorded ${workingCount} day${workingCount > 1 ? 's' : ''} of Annual Leave for ${member}`);

        alPicker.reset();
        updateAlPreview();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
        // Jump the Change a Shift section to show what was just recorded.
        showInChangeAShift?.(member, dates[0]);
    } catch (err) {
        console.error('[Admin] AL save failed:', err);
        clearTimeout(_alFeedbackTimer);
        alFeedback.className = 'feedback error';
        alFeedback.textContent = (/** @type {any} */ (err)).message === 'auth/session-expired'
            ? '⚠ Session expired — please sign out and sign back in.'
            : "⚠ Couldn't save — check your connection and try again.";
    } finally {
        alSaveBtn.disabled    = false;
        alSaveBtn.textContent = 'Record annual leave';
    }
});
} // end initALSection
