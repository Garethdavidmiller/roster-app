// @ts-check
// admin-sick.js — Sick Days Recording section for admin.html
// Imports data and Firebase directly; receives admin-app.js-owned DOM handles
// and shared functions via initSickSection(deps) to avoid circular imports.

import { teamMembers, getBaseShift, isSunday, escapeHtml } from './roster-data.js';
import { recordRangeOverrides, formatDisplay, buildMemberDateMap } from './admin-overrides.js';
import { isRestShift } from './app-override-utils.js';
import { buildRangePicker, getDateRange } from './admin-rangepicker.js';

const esc = escapeHtml;

/** @type {any} */
let _sickFeedbackTimer = null;

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
 * @param {string|null}       deps.currentUser          Logged-in user name (for changedBy field)
 * @param {Function}          deps.showInChangeAShift   Jumps the Change a Shift section to a member + date
 * @param {Function}          deps.showSuccess          Shows the scroll-independent bottom success toast
 */
export function initSickSection({
    sickMember,
    syncSickMemberDisplay, populateMemberDropdown, lastMember,
    updateALBanner, updateALBookedBox, updateSickBookedBox, currentUser, showInChangeAShift, showSuccess,
}) {
const sickFrom     = /** @type {HTMLInputElement}  */ (document.getElementById('sickFrom'));
const sickTo       = /** @type {HTMLInputElement}  */ (document.getElementById('sickTo'));
const sickPreview  = /** @type {HTMLElement} */ (document.getElementById('sickPreview'));
const sickSaveBtn  = /** @type {HTMLButtonElement} */ (document.getElementById('sickSaveBtn'));
const sickFeedback = /** @type {HTMLElement} */ (document.getElementById('sickFeedback'));

populateMemberDropdown(sickMember);
// iOS Safari ignores select.value on optgroup-nested options — set option.selected directly.
if (lastMember) { for (const o of sickMember.options) if (o.value === lastMember) { o.selected = true; break; } }
syncSickMemberDisplay();

/**
 * Returns an array of ISO date strings from sickFrom to sickTo inclusive,
 * or null if the range is invalid (to < from), or [] if either input is empty.
 * Maximum range is 1 year (to allow for maternity/long-term absence).
 * @returns {string[]|null}
 */
function getSickDates() {
    return getDateRange(sickFrom.value, sickTo.value);
}

/** Refreshes the preview message and enables/disables the save button. */
function updateSickPreview() {
    const member = sickMember.value;
    const dates  = getSickDates();

    if (!member) {
        sickPreview.className = 'al-preview sick-preview empty';
        sickPreview.textContent = 'Select a staff member above.';
        sickSaveBtn.disabled = true;
        return;
    }
    if (!sickFrom.value || !sickTo.value) {
        sickPreview.className = 'al-preview sick-preview empty';
        sickPreview.textContent = 'Select a date range to see a preview.';
        sickSaveBtn.disabled = true;
        return;
    }

    if (dates === null) {
        sickPreview.className = 'al-preview sick-preview error';
        sickPreview.textContent = '"Last absence day" must be on or after "First absence day".';
        sickSaveBtn.disabled = true;
        return;
    }

    const from  = new Date(sickFrom.value + 'T12:00:00');
    const maxTo = new Date(from);
    maxTo.setFullYear(maxTo.getFullYear() + 1);
    const to    = new Date(sickTo.value   + 'T12:00:00');
    if (to > maxTo) {
        sickPreview.className = 'al-preview sick-preview error';
        sickPreview.textContent = 'Maximum range is 1 year.';
        sickSaveBtn.disabled = true;
        return;
    }

    const fromDisp = formatDisplay(dates[0]);
    const toDisp   = formatDisplay(dates[dates.length - 1]);
    const rangeStr = dates.length === 1 ? fromDisp : `${fromDisp} – ${toDisp}`;

    // Count rest days in the range — they will be skipped.
    // Sundays are always skipped (uncontracted for all staff).
    const memberObj = teamMembers.find(m => m.name === member);
    let restCount = 0;
    if (memberObj) {
        const memberOvByDate = buildMemberDateMap(memberObj.name);
        dates.forEach(dateStr => {
            if (isSunday(dateStr)) { restCount++; return; }
            const ov = memberOvByDate.get(dateStr);
            if (ov && isRestShift((/** @type {any} */ (ov)).value)) { restCount++; return; }
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (isRestShift(base)) { restCount++; return; }
        });
    }
    const workDays = dates.length - restCount;
    const label    = workDays === 1 ? '1 absence day' : `${workDays} absence days`;
    const restNote = restCount > 0 ? ` <em>(+ ${restCount} rest day${restCount > 1 ? 's' : ''} skipped)</em>` : '';

    sickPreview.className = 'al-preview sick-preview ready';
    sickPreview.innerHTML = `🪑 <strong>${label}</strong> for ${esc(member)}: ${rangeStr}${restNote}`;
    sickSaveBtn.disabled = workDays === 0;
}

sickFrom.addEventListener('change', () => { updateSickPreview(); updateSickBookedBox(); });
sickTo.addEventListener('change',   () => { updateSickPreview(); updateSickBookedBox(); });
const sickPicker = buildRangePicker('sick');
updateSickPreview();

sickSaveBtn.addEventListener('click', async () => {
    const member = sickMember.value;
    const dates  = getSickDates();
    if (!member || !dates || !dates.length) return;

    sickFeedback.className = 'feedback';
    sickSaveBtn.disabled    = true;
    sickSaveBtn.textContent = `Saving ${dates.length} day${dates.length > 1 ? 's' : ''}…`;

    try {
        const { workingCount } = await recordRangeOverrides({
            type: 'sick', value: 'SICK', memberName: member, dates, changedBy: currentUser ?? '',
        });

        if (!workingCount) {
            sickFeedback.className = 'feedback error';
            sickFeedback.textContent = '⚠ No working days in that range — nothing to record.';
            sickFeedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
        }

        sickFeedback.className = 'feedback success';
        sickFeedback.textContent = `✓ Recorded ${workingCount} absence day${workingCount > 1 ? 's' : ''} for ${member}`;
        clearTimeout(_sickFeedbackTimer);
        _sickFeedbackTimer = setTimeout(() => { sickFeedback.className = 'feedback'; }, 7000);
        // The form resets and Change-a-Shift scrolls into view below, so also fire
        // the bottom toast — confirmation must be visible regardless of scroll.
        showSuccess?.(`Recorded ${workingCount} absence day${workingCount > 1 ? 's' : ''} for ${member}`);

        sickPicker.reset();
        updateSickPreview();
        // Sick recording can overwrite AL days — refresh AL counts too.
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
        // Jump the Change a Shift section to show what was just recorded.
        showInChangeAShift?.(member, dates[0]);
    } catch (err) {
        console.error('[Admin] Sick save failed:', err);
        clearTimeout(_sickFeedbackTimer);
        sickFeedback.className = 'feedback error';
        sickFeedback.textContent = (/** @type {any} */ (err)).message === 'auth/session-expired'
            ? '⚠ Session expired — please sign out and sign back in.'
            : "⚠ Couldn't save — check your connection and try again.";
    } finally {
        sickSaveBtn.disabled    = false;
        sickSaveBtn.textContent = 'Record absence';
    }
});
} // end initSickSection
