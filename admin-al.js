// admin-al.js — Annual Leave Booking section for admin.html
// Extracted from admin-app.js at v9.93.
//
// Imports data and Firebase directly; receives admin-app.js-owned DOM handles
// and shared functions via initALSection(deps) to avoid circular imports.

import { teamMembers, getALEntitlement, getBaseShift, formatISO, isSunday, escapeHtml } from './roster-data.js';
import { getAllOverrides, recordRangeOverrides, formatDisplay } from './admin-overrides.js';
import { buildRangePicker } from './admin-rangepicker.js';

const esc = escapeHtml;

// Module-level state for the AL over-entitlement confirmation flow.
// triggerConfirmedALSave() is called by the confirm bar in admin-app.js when
// the user accepts saving over their AL entitlement.
let _alBookingConfirmed = false;
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
 * @param {HTMLSelectElement} deps.sickMember          The sick member dropdown (kept in sync)
 * @param {HTMLSelectElement} deps.fieldMember         The week-editor member dropdown (kept in sync)
 * @param {HTMLInputElement}  deps.fieldDate           The week-editor date input
 * @param {Function}          deps.syncMemberDisplay   Updates the AL read-only member label
 * @param {Function}          deps.syncSickMemberDisplay Updates the sick read-only member label
 * @param {Function}          deps.populateMemberDropdown Fills a <select> with teamMembers
 * @param {string|null}       deps.lastMember          Last-used member name from localStorage
 * @param {Function}          deps.confirmNavigate     Shows the unsaved-changes banner; returns true if no unsaved changes
 * @param {Function}          deps.updateALBanner      Refreshes the AL entitlement banner
 * @param {Function}          deps.updateALBookedBox   Refreshes the AL booked-periods box
 * @param {Function}          deps.updateSickBookedBox Refreshes the sick booked-periods box
 * @param {string|null}       deps.currentUser         Logged-in user name (for changedBy field)
 * @param {Function}          deps.showALConfirm       Shows the over-entitlement confirmation bar
 * @param {Function}          deps.lsSet               Safe localStorage.setItem wrapper
 */
export function initALSection({
    alMember, sickMember, fieldMember, fieldDate,
    syncMemberDisplay, syncSickMemberDisplay,
    populateMemberDropdown, lastMember,
    confirmNavigate, updateALBanner, updateALBookedBox, updateSickBookedBox,
    currentUser, showALConfirm, lsSet,
}) {
const alFrom     = document.getElementById('alFrom');
const alTo       = document.getElementById('alTo');
const alPreview  = document.getElementById('alPreview');
const alSaveBtn  = document.getElementById('alSaveBtn');
const alFeedback = document.getElementById('alFeedback');
_alSaveBtnRef = alSaveBtn;

populateMemberDropdown(alMember);
if (lastMember) alMember.value = lastMember;
syncMemberDisplay();

// Sync alMember with the main member picker (keep them in step).
// Mirrors the fieldMember change handler — calls confirmNavigate so unsaved
// week-grid changes get the same "Discard or keep?" prompt.
alMember.addEventListener('change', () => {
    if (!alMember.value) return;
    const chosen = alMember.value;
    const go = () => {
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
        updateAlPreview();
        fieldMember.value  = chosen;
        sickMember.value   = chosen;
        syncMemberDisplay();
        syncSickMemberDisplay();
        lsSet('adminLastMember', chosen);
        lsSet('myb_roster_selected_member', chosen);
        renderWeekGrid();
        renderTable();
    };
    if (confirmNavigate(go)) { go(); return; }
    // Revert dropdown while banner waits for user decision
    alMember.value = fieldMember.value;
});

function getAlDates() {
    if (!alFrom.value || !alTo.value) return [];
    const from = new Date(alFrom.value + 'T12:00:00');
    const to   = new Date(alTo.value   + 'T12:00:00');
    if (to < from) return null; // invalid range
    const dates = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        dates.push(formatISO(new Date(d)));
    }
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
        // Build a Map<date, override> once instead of doing a linear .find() per date.
        // With N overrides and D dates this turns O(N×D) into O(N+D); for 1000 overrides
        // × 30 dates that's a 30,000× → 1,030 operations reduction per render.
        const memberOvByDate = new Map();
        for (const o of getAllOverrides()) {
            if (o.memberName === memberObj.name) memberOvByDate.set(o.date, o);
        }
        dates.forEach(dateStr => {
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (base === 'RD' || base === 'OFF') { restCount++; return; }
            // Also treat existing RD/OFF overrides as rest days (same logic as the booking filter)
            const ov = memberOvByDate.get(dateStr);
            if (ov && (ov.value === 'RD' || ov.value === 'OFF')) { restCount++; return; }
            // Sundays are uncontracted for all staff — skip, don't book AL
            if (isSunday(dateStr)) { restCount++; return; }
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

alFrom.addEventListener('change', () => { updateAlPreview(); updateALBanner(); updateALBookedBox(); });
alTo.addEventListener('change',   () => { updateAlPreview(); updateALBanner(); updateALBookedBox(); });
const alPicker = buildRangePicker('al');
updateAlPreview();

alSaveBtn.addEventListener('click', async () => {
    const member = alMember.value;
    const dates  = getAlDates();
    if (!member || !dates || !dates.length) return;

    // Annual leave entitlement check (skip if user already confirmed via the bar)
    const memberObj = teamMembers.find(m => m.name === member);
    if (!_alBookingConfirmed) {
        // Use the year from the booking dates, not the current calendar year
        const yearStr        = alFrom.value ? alFrom.value.substring(0, 4) : String(new Date().getFullYear());
        const entitlement    = getALEntitlement(memberObj, parseInt(yearStr, 10), getAllOverrides());
        // Sundays are uncontracted — exclude from entitlement counts
        const existingAL     = getAllOverrides().filter(o =>
            o.memberName === member &&
            o.type       === 'annual_leave' &&
            o.date       && o.date.startsWith(yearStr) && !isSunday(o.date)
        ).length;
        const newALInYear    = dates.filter(d => d.startsWith(yearStr) && !isSunday(d)).length;
        const projectedTotal = existingAL + newALInYear;
        if (projectedTotal > entitlement) {
            const over = projectedTotal - entitlement;
            showALConfirm(
                `${member} will be ${over} day${over !== 1 ? 's' : ''} over their AL entitlement`,
                `${projectedTotal} days used of ${entitlement} allowed in ${yearStr}`,
                null // null = AL booking path (not week editor)
            );
            return;
        }
    }
    _alBookingConfirmed = false; // reset after use

    alFeedback.className = 'feedback';
    alSaveBtn.disabled    = true;
    alSaveBtn.textContent = `Saving ${dates.length} day${dates.length > 1 ? 's' : ''}…`;

    try {
        const { workingCount } = await recordRangeOverrides({
            type: 'annual_leave', value: 'AL', memberName: member, dates, changedBy: currentUser,
        });

        if (!workingCount) {
            alFeedback.className = 'feedback error';
            alFeedback.textContent = '⚠ No working days in that range — nothing to record.';
            return;
        }

        alFeedback.className = 'feedback success';
        alFeedback.textContent = `✓ Recorded ${workingCount} day${workingCount > 1 ? 's' : ''} of Annual Leave for ${member}`;
        setTimeout(() => { alFeedback.className = 'feedback'; }, 7000);

        alPicker.reset();
        updateAlPreview();
        updateALBanner();
        updateALBookedBox();
        updateSickBookedBox();
    } catch (err) {
        console.error('[Admin] AL save failed:', err);
        alFeedback.className = 'feedback error';
        alFeedback.textContent = err.message === 'auth/session-expired'
            ? '⚠ Session expired — please sign out and sign back in.'
            : '⚠ Could not save — check your connection and try again.';
    } finally {
        alSaveBtn.disabled    = false;
        alSaveBtn.textContent = 'Record annual leave';
    }
});
} // end initALSection
