// @ts-check
/**
 * calendar-member.js — Team member selection for index.html.
 *
 * Owns: validateTeamMembers, getDefaultMemberIndex, getSelectedMemberIndex,
 *   saveSelectedMember, populateTeamMemberDropdown, getCurrentMember,
 *   takeStaleMemberName.
 * Does NOT own: display state (calendar-app.js), override cache (calendar-overrides.js).
 * Edit here for: member dropdown logic, stale-name handling.
 */

import { CONFIG, teamMembers } from './roster-data.js';
import { getSession } from './session.js';
import { lsGet, lsSet, lsDel } from './ls.js';

// Set when getSelectedMemberIndex() finds a saved name that is no longer in the roster.
// Consumed by renderCalendar() via takeStaleMemberName() to show a one-time banner.
let _staleMemberName = null;

/**
 * Consume and clear the stale member name (if any).
 * renderCalendar() calls this to detect and announce a removed member.
 * @returns {string|null}
 */
export function takeStaleMemberName() {
    const stale = _staleMemberName;
    _staleMemberName = null;
    return stale;
}

/** @returns {number} */
export function getDefaultMemberIndex() {
    const idx = teamMembers.findIndex(m => m.name === CONFIG.DEFAULT_MEMBER_NAME && !m.hidden);
    return idx !== -1 ? idx : 0;
}

/** @returns {number} */
export function getSelectedMemberIndex() {
    const savedName = lsGet('myb_roster_selected_member');
    if (savedName) {
        const idx = teamMembers.findIndex(m => m.name === savedName && !m.hidden);
        if (idx !== -1) return idx;
        // savedName stored but not found — stale entry from a removed member
        _staleMemberName = savedName;
        lsDel('myb_roster_selected_member');
        return getDefaultMemberIndex();
    }
    // No saved selection — auto-select from the admin session if present so the
    // logged-in staff member sees their own calendar without triggering a cache clear.
    const sess = getSession();
    if (sess?.name) {
        const idx = teamMembers.findIndex(m => m.name === sess.name && !m.hidden);
        if (idx !== -1) {
            saveSelectedMember(idx);
            return idx;
        }
    }
    return getDefaultMemberIndex();
}

/** @param {number} index */
export function saveSelectedMember(index) {
    if (index >= 0 && index < teamMembers.length) {
        lsSet('myb_roster_selected_member', teamMembers[index].name);
    }
}

export function populateTeamMemberDropdown() {
    const select = document.getElementById('teamMemberSelect');
    if (!select) return;
    select.innerHTML = '';
    const selectedIndex = getSelectedMemberIndex();

    // Build dropdown — flat list if only one role present, optgroup per role if multiple.
    const visibleMembers = teamMembers
        .map((member, index) => ({ member, index }))
        .filter(({ member }) => !member.hidden);

    const distinctRoles = [...new Set(visibleMembers.map(({ member }) => member.role || 'CEA'))];
    const useGroups = distinctRoles.length > 1;

    if (useGroups) {
        distinctRoles.forEach(role => {
            const group = document.createElement('optgroup');
            group.label = role;
            visibleMembers
                .filter(({ member }) => (member.role || 'CEA') === role)
                .forEach(({ member, index }) => {
                    const option = document.createElement('option');
                    option.value = String(index);
                    option.textContent = member.name;
                    if (index === selectedIndex) option.selected = true;
                    group.appendChild(option);
                });
            select.appendChild(group);
        });
    } else {
        visibleMembers.forEach(({ member, index }) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = member.name;
            if (index === selectedIndex) option.selected = true;
            select.appendChild(option);
        });
    }
}

/** @returns {object} */
export function getCurrentMember() {
    const selectedIndex = getSelectedMemberIndex();
    const member = teamMembers[selectedIndex];
    if (!member) {
        console.error(`Invalid team member index: ${selectedIndex}`);
        return teamMembers[0] || { name: 'Unknown', currentWeek: 1, rosterType: 'main', role: 'CEA' };
    }
    return member;
}

/** @returns {string[]} */
export function validateTeamMembers() {
    const errors = [];
    if (!teamMembers || teamMembers.length === 0) {
        errors.push('No team members defined');
        return errors;
    }
    teamMembers.forEach((member, index) => {
        if (!member.name) errors.push(`Team member at index ${index} has no name`);
        if (!member.currentWeek || member.currentWeek < 1) errors.push(`${member.name || `Index ${index}`}: Invalid currentWeek`);
        if (!member.role) errors.push(`${member.name || `Index ${index}`}: Missing role field (expected "CEA", "CES" etc.)`);
        if (member.rosterType !== 'main' && member.rosterType !== 'bilingual' && member.rosterType !== 'fixed' && member.rosterType !== 'ces' && member.rosterType !== 'dispatcher') {
            errors.push(`${member.name || `Index ${index}`}: Unknown rosterType "${member.rosterType}" (expected "main", "bilingual", "fixed", "ces" or "dispatcher")`);
        }
        if (member.rosterType === 'bilingual'  && member.currentWeek > CONFIG.BILINGUAL_ROSTER_WEEKS)   errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds bilingual roster weeks (${CONFIG.BILINGUAL_ROSTER_WEEKS})`);
        if (member.rosterType === 'main'       && member.currentWeek > CONFIG.MAIN_ROSTER_WEEKS)        errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds main roster weeks (${CONFIG.MAIN_ROSTER_WEEKS})`);
        if (member.rosterType === 'ces'        && member.currentWeek > CONFIG.CES_ROSTER_WEEKS)         errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds CES roster weeks (${CONFIG.CES_ROSTER_WEEKS})`);
        if (member.rosterType === 'dispatcher' && member.currentWeek > CONFIG.DISPATCHER_ROSTER_WEEKS)  errors.push(`${member.name}: currentWeek ${member.currentWeek} exceeds dispatcher roster weeks (${CONFIG.DISPATCHER_ROSTER_WEEKS})`);
    });
    return errors;
}
