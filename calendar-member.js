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
import { SELECTED_MEMBER } from './storage-keys.js';

// Set when getSelectedMemberIndex() finds a saved name that is no longer in the roster.
// Consumed by renderCalendar() via takeStaleMemberName() to show a one-time banner.
/** @type {string|null} */
let _staleMemberName = null;

// In-memory backstop for the selected member index. In iOS Safari private mode lsSet() silently
// no-ops, so a picked name would never persist and isFirstRun() would stay true forever — the
// first-run prompt would re-appear on every render and the user could never reach their calendar.
// saveSelectedMember() records the choice here too, so within the page session the selection sticks
// and the prompt clears even when localStorage is unavailable. (Onboarding H1, private-mode fix.)
/** @type {number|null} */
let _selectedIndexFallback = null;

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

// Captured at MODULE LOAD — before ANY code can call getSelectedMemberIndex() (which clears a
// stale removed-member key). ES modules evaluate once, before the importer's body runs, so this
// snapshot reliably reflects "did a saved member exist when the page loaded". It is what keeps a
// cleared-stale fallback DISTINCT from a true first run. (H1)
const _hadSavedMemberAtStart = !!lsGet(SELECTED_MEMBER);

/**
 * True only for a brand-new visitor: NEVER had a saved member (at load) AND none now AND no
 * signed-in session. Consumed by calendar-app.js to show a "choose your name" prompt instead of
 * rendering the default member's roster (which a new user could mistake for their own). Once they
 * pick a name it's saved and this returns false forever after.
 *
 * A returning user whose saved member was REMOVED had a key at load, so `_hadSavedMemberAtStart`
 * is true and this stays false — they keep the old behaviour (default calendar + "no longer in the
 * roster" banner), not the prompt. (Onboarding H1.)
 * @returns {boolean}
 */
export function isFirstRun() {
    return !_hadSavedMemberAtStart && _selectedIndexFallback === null
        && !lsGet(SELECTED_MEMBER) && !getSession()?.name;
}

/** @returns {number} */
export function getSelectedMemberIndex() {
    const savedName = lsGet(SELECTED_MEMBER);
    if (savedName) {
        const idx = teamMembers.findIndex(m => m.name === savedName && !m.hidden);
        if (idx !== -1) return idx;
        // savedName stored but not found — stale entry from a removed member
        _staleMemberName = savedName;
        lsDel(SELECTED_MEMBER);
        return getDefaultMemberIndex();
    }
    // In-memory backstop for when localStorage writes silently fail (iOS private mode): a name
    // picked this session was recorded here even though lsSet() no-opped.
    if (_selectedIndexFallback !== null) return _selectedIndexFallback;
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

/**
 * Test-only: clear the in-memory selection backstop so each unit test starts from a clean module
 * state (mirrors how takeStaleMemberName() resets _staleMemberName in beforeEach). Not used in
 * production — the fallback is meant to persist for the life of the page.
 */
export function _resetSelectionFallbackForTests() {
    _selectedIndexFallback = null;
}

/** @param {number} index */
export function saveSelectedMember(index) {
    if (index >= 0 && index < teamMembers.length) {
        _selectedIndexFallback = index;
        lsSet(SELECTED_MEMBER, teamMembers[index].name);
    }
}

export function populateTeamMemberDropdown() {
    const select = document.getElementById('teamMemberSelect');
    if (!select) return;
    select.innerHTML = '';
    const firstRun = isFirstRun();
    const selectedIndex = getSelectedMemberIndex();

    // First run: lead with a placeholder and pre-select NOTHING real, so a brand-new
    // visitor is prompted to pick their own name rather than shown someone else's roster.
    if (firstRun) {
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = '— Choose your name —';
        ph.selected = true;
        ph.disabled = true;
        select.appendChild(ph);
    }

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
                    if (!firstRun && index === selectedIndex) option.selected = true;
                    group.appendChild(option);
                });
            select.appendChild(group);
        });
    } else {
        visibleMembers.forEach(({ member, index }) => {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = member.name;
            if (!firstRun && index === selectedIndex) option.selected = true;
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
    /** @type {string[]} */
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
