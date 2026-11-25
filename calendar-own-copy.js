// @ts-check
/**
 * calendar-own-copy.js — WHEN and HOW the member's own stored roster is shown and kept on the
 * Calendar (v24.59; left calendar-app.js on 25 Nov 2026).
 *
 * Owns: whether the copy may be offered for a calendar (`snapshotFor`, the source the renderer asks),
 *   its paint into the lock slot before the access decision (`paintBeforeGrant`), its save after a
 *   render (`save`), and the one RULE among them — which records are kept (`ownMonthsToStore`).
 * Does NOT own: the stored copy itself, its window, its ageing or its deletion (calendar-snapshot.js);
 *   what a month draws with it (calendar-renderer.js → `monthOnScreen`); the access decision
 *   (calendar-access.js); the clearing listeners, which stay in calendar-app.js beside the other
 *   things a lost grant takes away (calendar-access-state.test.mjs pins them there).
 *
 * ── THE MEMBER'S OWN ROSTER, SHOWN WHILE THE SIGN-IN CHECK RUNS (calendar-snapshot.js) ──────────
 *
 * Offered only on the member's OWN calendar, signed in by name, outside Team View — the copy is
 * theirs and nobody else's. Before the grant it is painted into the lock slot (the place the
 * skeleton would stand) with no handlers, so nothing on it can act; after the grant the renderer asks
 * the source calendar-app.js registers (`setSnapshotSource(ownCopy.snapshotFor)`) for any month still
 * loading. Neither path touches `rosterOverridesCache` or the knowledge states, so the copy can never
 * be mistaken for what the server said.
 *
 * ── TWO ORDERS THAT HOLD IT TOGETHER, BOTH IN calendar-app.js ──────────────────────────────────
 *
 *   · `paintBeforeGrant` is SYNCHRONOUS and handed to `initCalendarAccess` as `paintBeforeDecision`,
 *     which runs it before the decision's first await. An async paint is not an instant one.
 *   · The source is registered at module scope, before the first render, so no grid is ever drawn
 *     without being able to ask it.
 *
 * Everything that reaches Firebase is handed in (`deps`), so this module loads in Node, and the rule
 * that decides what is stored is a pure function tested there (calendar-own-copy.test.mjs).
 */

import { lsGet } from './ls.js';
import { TEAM_VIEW, SELECTED_MEMBER } from './storage-keys.js';
import { teamMembers } from './roster-data.js';
import { snapshotMonth, saveSnapshotMonths, clearSnapshot, MONTHS_BEFORE, MONTHS_AFTER } from './calendar-snapshot.js';
import { getDisplayMonth, getDisplayYear, addMonths } from './calendar-state.js';
import { knowledgeOf } from './calendar-data-state.js';
import { mountLockCard } from './calendar-lock-slot.js';

/**
 * The months the stored copy keeps, around `now` (MONTHS_BEFORE before, MONTHS_AFTER after), as
 * month keys.
 * @param {Date} now
 * @param {(year: number, month: number) => string} monthKey - calendar-overrides.js's, handed in
 * @returns {string[]}
 */
export function ownCopyWindow(now, monthKey) {
    /** @type {string[]} */ const keys = [];
    for (let d = -MONTHS_BEFORE; d <= MONTHS_AFTER; d++) {
        const { month, year } = addMonths(now.getMonth(), now.getFullYear(), d);
        keys.push(monthKey(year, month));
    }
    return keys;
}

/**
 * THE RULE: which of the override cache's records become the member's stored copy.
 *
 * Only months the SERVER settled (`authoritative`): a month answered from this device's cache, or
 * not answered at all, is not something the copy may later present as the member's roster. And
 * only the member's OWN records: the cache holds everybody's, and the copy is one member's
 * (calendar-snapshot.js → "ONE MEMBER, AND ONLY THEIR OWN ROWS"). A settled month with no records
 * is still kept, as an empty list — "nothing changed" is an answer, and the stored copy needs it.
 *
 * The cache keys a record by `name|YYYY-MM-DD` and stores neither inside it, so both are put back.
 *
 * @param {string} name - the member signed in
 * @param {Iterable<[string, any]>} cache - `rosterOverridesCache`'s entries
 * @param {string[]} keys - the months to consider (`ownCopyWindow`)
 * @param {(key: string) => string} knowledge - what is known of a month (calendar-data-state.js)
 * @returns {Record<string, any[]>} month key → that month's records for `name`
 */
export function ownMonthsToStore(name, cache, keys, knowledge) {
    const entries = [...cache];
    /** @type {Record<string, any[]>} */ const months = {};
    for (const key of keys) {
        if (knowledge(key) !== 'authoritative') continue;   // only what the SERVER settled
        const prefix = `${name}|${key}-`;
        months[key] = entries.filter(([k]) => k.startsWith(prefix))
            .map(([k, r]) => ({ ...r, memberName: name, date: k.slice(k.indexOf('|') + 1) }));
    }
    return months;
}

/**
 * The Calendar's own-copy handles, wired to the page.
 * @param {{
 *   sessionName: () => string|undefined,
 *   accessType: () => string,
 *   isTeamViewMode: () => boolean,
 *   currentMemberName: () => string|undefined,
 *   cache: Map<string, any>,
 *   monthKey: (year: number, month: number) => string,
 *   buildCalendarContainer: (month: number, year: number, opts: any) => HTMLElement,
 *   markMilestone: (id: 'rosterSnapshot') => void,
 * }} deps
 */
export function createOwnCopy(deps) {
    /** Is the calendar for `name` the reader's own view: signed in as them, their name picked (or none
     *  picked yet), Team View not saved as open? Read from storage, because the pre-grant paint runs
     *  before the member picker or Team View exists. @param {string} name */
    const isOwnView = (name) => !!name && deps.sessionName() === name
        && (lsGet(SELECTED_MEMBER) ?? name) === name && lsGet(TEAM_VIEW) !== '1';

    /** The member's stored copy of a month, where the live grid may show it — the renderer's source.
     *  @param {string} name @param {number} year @param {number} month @returns {Map<string, any>|null} */
    const snapshotFor = (name, year, month) =>
        deps.accessType() === 'named' && isOwnView(name) && !deps.isTeamViewMode() ? snapshotMonth(name, year, month) : null;

    /** Paint the stored copy in the lock slot before the access decision. Synchronous on purpose
     *  (header). @returns {boolean} painted */
    function paintBeforeGrant() {
        try {
            const name = deps.sessionName();
            if (!name || !isOwnView(name)) return false;
            const member = teamMembers.find(m => m.name === name && !m.hidden && !m.managerOnly);
            if (!member) { clearSnapshot(); return false; }   // a leaver, or a login-only account
            const days = snapshotMonth(name, getDisplayYear(), getDisplayMonth());
            if (!days) return false;
            const card = mountLockCard({ id: 'calendarSnapshot', className: 'cal-snapshot' });
            card?.appendChild(deps.buildCalendarContainer(getDisplayMonth(), getDisplayYear(), { member, snapshot: days }));
            // The moment the member first sees their shifts, timed for the App Speed card (v24.85) —
            // only here, where the copy is actually on screen before the check, never for a fall-through.
            if (card) deps.markMilestone('rosterSnapshot');
            return !!card;
        } catch (e) { console.warn('[Calendar] own-roster copy not painted', e); return false; }
    }

    /** Keep the months the live read has settled for the member's own calendar. Called after every
     *  render; a render of somebody else's calendar keeps nothing. */
    function save() {
        try {
            const name = deps.sessionName();
            if (deps.accessType() !== 'named' || !isOwnView(name ?? '') || deps.isTeamViewMode()
                || deps.currentMemberName() !== name) return;
            const months = ownMonthsToStore(/** @type {string} */ (name), deps.cache,
                ownCopyWindow(new Date(), deps.monthKey), knowledgeOf);
            saveSnapshotMonths(/** @type {string} */ (name), months);
        } catch (e) { console.warn('[Calendar] own-roster copy not saved', e); }
    }

    return { snapshotFor, paintBeforeGrant, save };
}
