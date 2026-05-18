// admin-sick.js — Sick Days Recording section for admin.html
// Extracted from admin-app.js at v9.93.
//
// Imports data and Firebase directly; receives admin-app.js-owned DOM handles
// and shared functions via initSickSection(deps) to avoid circular imports.

import { teamMembers, getBaseShift, formatISO, isSunday, escapeHtml } from './roster-data.js';
import { db, collection, doc, writeBatch, serverTimestamp } from './firebase-client.js';
import { getAllOverrides, setAllOverrides, renderWeekGrid, renderTable, formatDisplay } from './admin-overrides.js';

const esc = escapeHtml;

/**
 * Sets up all Sick Days Recording interactivity.
 *
 * @param {object} deps
 * @param {HTMLSelectElement} deps.sickMember           The sick member dropdown
 * @param {HTMLSelectElement} deps.fieldMember          The week-editor member dropdown (read-only here)
 * @param {HTMLInputElement}  deps.fieldDate            The week-editor date input
 * @param {Function}          deps.syncSickMemberDisplay Updates the sick read-only member label
 * @param {Function}          deps.populateMemberDropdown Fills a <select> with teamMembers
 * @param {string|null}       deps.lastMember           Last-used member name from localStorage
 * @param {Function}          deps.updateSickBookedBox  Refreshes the sick booked-periods box
 * @param {Function}          deps.buildRangePicker     Builds the date range picker for a given prefix
 * @param {string|null}       deps.currentUser          Logged-in user name (for changedBy field)
 */
export function initSickSection({
    sickMember, fieldMember, fieldDate,
    syncSickMemberDisplay, populateMemberDropdown, lastMember,
    updateSickBookedBox, buildRangePicker, currentUser,
}) {
const sickFrom     = document.getElementById('sickFrom');
const sickTo       = document.getElementById('sickTo');
const sickPreview  = document.getElementById('sickPreview');
const sickSaveBtn  = document.getElementById('sickSaveBtn');
const sickFeedback = document.getElementById('sickFeedback');

populateMemberDropdown(sickMember);
if (lastMember) sickMember.value = lastMember;
syncSickMemberDisplay();

/**
 * Returns an array of ISO date strings from sickFrom to sickTo inclusive,
 * or null if the range is invalid (to < from), or [] if either input is empty.
 * Maximum range is 1 year (to allow for maternity/long-term absence).
 * @returns {string[]|null}
 */
function getSickDates() {
    if (!sickFrom.value || !sickTo.value) return [];
    const from = new Date(sickFrom.value + 'T12:00:00');
    const to   = new Date(sickTo.value   + 'T12:00:00');
    if (to < from) return null;
    const dates = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        dates.push(formatISO(new Date(d)));
    }
    return dates;
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
        dates.forEach(dateStr => {
            if (isSunday(dateStr)) { restCount++; return; }
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (base === 'RD' || base === 'OFF') { restCount++; return; }
            const ov = getAllOverrides().find(o => o.memberName === memberObj.name && o.date === dateStr);
            if (ov && (ov.value === 'RD' || ov.value === 'OFF')) { restCount++; return; }
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

    const memberObj    = teamMembers.find(m => m.name === member);
    // Sundays are uncontracted — never record sick on a Sunday
    const workingDates = memberObj
        ? dates.filter(dateStr => {
            if (isSunday(dateStr)) return false;
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (base === 'RD' || base === 'OFF') return false;
            const ov = getAllOverrides().find(o => o.memberName === member && o.date === dateStr);
            if (ov && (ov.value === 'RD' || ov.value === 'OFF')) return false;
            return true;
          })
        : dates;

    // Sundays within the absence block that have a worked base shift need an explicit
    // RD correction — otherwise the base roster shift still shows on the calendar.
    const sundayCorrections = memberObj
        ? dates.filter(dateStr => {
            if (!isSunday(dateStr)) return false;
            const d    = new Date(dateStr + 'T12:00:00');
            const base = getBaseShift(memberObj, d);
            if (base === 'RD' || base === 'OFF') return false;  // already a rest day
            const ov = getAllOverrides().find(o => o.memberName === member && o.date === dateStr);
            if (ov && (ov.value === 'RD' || ov.value === 'OFF')) return false;  // already corrected
            return true;
          })
        : [];

    if (!workingDates.length) {
        sickFeedback.className = 'feedback error';
        sickFeedback.textContent = '⚠ No working days in that range — nothing to record.';
        return;
    }

    sickFeedback.className = 'feedback';
    sickSaveBtn.disabled    = true;
    sickSaveBtn.textContent = `Saving ${workingDates.length} day${workingDates.length > 1 ? 's' : ''}…`;

    try {
        const sickNewDocs    = [];
        const sickDeletedIds = new Set();
        const sickBatch      = writeBatch(db);
        workingDates.forEach(date => {
            const existing = getAllOverrides().find(o => o.memberName === member && o.date === date);
            if (existing) { sickBatch.delete(doc(db, 'overrides', existing.id)); sickDeletedIds.add(existing.id); }
            const newRef = doc(collection(db, 'overrides'));
            sickBatch.set(newRef, {
                memberName: member,
                date,
                type:      'sick',
                value:     'SICK',
                note:      '',
                source:    'manual',
                createdAt: serverTimestamp(),
                changedBy: currentUser
            });
            sickNewDocs.push({ id: newRef.id, memberName: member, date, type: 'sick', value: 'SICK', source: 'manual', note: '', createdAt: new Date() });
        });
        sundayCorrections.forEach(date => {
            const existing = getAllOverrides().find(o => o.memberName === member && o.date === date);
            if (existing) { sickBatch.delete(doc(db, 'overrides', existing.id)); sickDeletedIds.add(existing.id); }
            const newRef = doc(collection(db, 'overrides'));
            sickBatch.set(newRef, {
                memberName: member,
                date,
                type:      'correction',
                value:     'RD',
                note:      '',
                source:    'manual',
                createdAt: serverTimestamp(),
                changedBy: currentUser
            });
            sickNewDocs.push({ id: newRef.id, memberName: member, date, type: 'correction', value: 'RD', source: 'manual', note: '', createdAt: new Date() });
        });
        await sickBatch.commit();

        sickFeedback.className = 'feedback success';
        sickFeedback.textContent = `✓ Recorded ${workingDates.length} absence day${workingDates.length > 1 ? 's' : ''} for ${member}`;
        setTimeout(() => { sickFeedback.className = 'feedback'; }, 7000);

        sickPicker.reset();
        updateSickPreview();

        // Update in-memory cache — no Firestore round-trip needed
        const sickUpdated = getAllOverrides().filter(o => !sickDeletedIds.has(o.id));
        sickUpdated.push(...sickNewDocs);
        sickUpdated.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setAllOverrides(sickUpdated);
        renderTable();
        updateSickBookedBox();
        if (fieldMember.value && fieldDate.value) renderWeekGrid();
    } catch (err) {
        console.error('[Admin] Sick save failed:', err);
        sickFeedback.className = 'feedback error';
        sickFeedback.textContent = '⚠ Could not save — check your connection and try again.';
    } finally {
        sickSaveBtn.disabled    = false;
        sickSaveBtn.textContent = 'Record absence';
    }
});
} // end initSickSection
