// @ts-check
/**
 * admin-leave-year-save.js — the save behind the "which year's allowance" panel (v25.18).
 *
 * Moves one January leave day between the two allowances it may come out of: the previous year's
 * (`leaveYear` set) or its own (`leaveYear: null`, the field absent). The day stays annual leave and
 * nothing else about it changes. The owner's decisions are in leave-year.js; the CAP ("no more than
 * the previous year has left") is the panel's to refuse (`leaveYearChoices.prevOpen`), because it is
 * a count across documents that the rules cannot take and the panel is where it is shown.
 *
 * Its own module because admin-overrides.js is at its ratchet cap (coordinator-ratchet.test.mjs) and
 * this is a write with a rule in it — see the stale-page refusal below — rather than wiring.
 *
 * ── THE SAME WRITE AS EVERY MANUAL SAVE ─────────────────────────────────────────────────────────
 *
 * Delete-then-set onto the fixed id (override-id.js), `source: 'manual'` — the only source a member
 * or manager may write, so an imported leave day becomes the member's own record — and carrying what
 * the record already said: `replacedType`, so a swapped-in day still costs a day after it moves.
 *
 * ── A STALE PAGE MAY NOT WRITE A DAY OFF BACK INTO EXISTENCE ────────────────────────────────────
 *
 * The save is a fresh annual-leave record, so on a page loaded this morning it would resurrect leave
 * cancelled on another device since, or write leave over a shift a manager has just given. So the
 * day is re-read from the server first (`assertStillLeave`, admin-override-store.js) and the save is
 * refused unless it is still the leave on screen. What it cannot see — a re-import on another device
 * that leaves the shown record in place beside a newer one — is the saves' accepted last-writer-wins.
 */

import { db, doc, serverTimestamp, writeBatch, auth, writeWithClaimRetry, COLLECTIONS } from './firebase-client.js';
import { sessionReady } from './session.js';
import { buildOverrideWrite, buildOverrideCacheRecord, nextReplacedType } from './override-utils.js';
import { manualOverrideId } from './override-id.js';
import { isValidLeaveYear, canChooseLeaveYear } from './leave-year.js';
import { whenOverridesReady, whenLoadSettled, hasOverrideAuthorityFor, idsReplacedBy, mutateCache,
         assertStillLeave, LEAVE_YEAR_CHANGED_LINE } from './admin-override-store.js';
import { buildMemberDateMap } from './admin-overrides.js';
import { renderTable } from './admin-saved-changes.js';
import { renderWeekGrid, _hasStagedEdits } from './admin-week-editor.js';
import { withSlowSaveNotice } from './slow-save.js';

/**
 * Move one January leave day to `leaveYear`'s allowance (or back to its own, with null).
 * @param {{ memberName: string, date: string, leaveYear: number|null, changedBy: string }} opts
 * @returns {Promise<void>}
 * @throws {Error} 'auth/session-expired', 'cache/load-failed', 'leave-year/invalid', a refusal
 *         carrying `line`, or a Firestore error — `saveFailureMessage` words every one of them
 */
export async function setLeaveYear({ memberName, date, leaveYear, changedBy }) {
    await sessionReady;
    await whenOverridesReady();
    if (!hasOverrideAuthorityFor(memberName)) await whenLoadSettled().catch(() => {});
    if (!hasOverrideAuthorityFor(memberName)) throw new Error('cache/load-failed');
    if (!auth.currentUser) throw new Error('auth/session-expired');
    if (!canChooseLeaveYear(date) || (leaveYear !== null && !isValidLeaveYear(date, leaveYear))) {
        throw new Error('leave-year/invalid');
    }
    const shown = buildMemberDateMap(memberName).get(date);
    if (!shown || shown.type !== 'annual_leave') {
        throw Object.assign(new Error(LEAVE_YEAR_CHANGED_LINE), { line: LEAVE_YEAR_CHANGED_LINE });
    }

    const { docs, dropped } = await withSlowSaveNotice(writeWithClaimRetry(async () => {
        await assertStillLeave(memberName, date, shown);
        const batch = writeBatch(db);
        /** @type {Set<string>} */
        const dropped = new Set();
        for (const id of idsReplacedBy(memberName, date, shown.id)) {
            batch.delete(doc(db, COLLECTIONS.overrides, id));
            dropped.add(id);
        }
        const newRef = doc(db, COLLECTIONS.overrides, manualOverrideId(memberName, date));
        const fields = { memberName, date, type: 'annual_leave', value: 'AL', note: '', source: 'manual', changedBy,
                         replacedType: nextReplacedType(shown, 'annual_leave'), leaveYear };
        batch.set(newRef, buildOverrideWrite(fields, serverTimestamp()));
        await batch.commit();
        return { docs: [buildOverrideCacheRecord(newRef.id, fields, new Date())], dropped };
    }));

    // The same landing as the other two writes (admin-overrides.js): any load in flight first, then
    // a merge by id, so a snapshot newer than the commit cannot leave the day in the cache twice.
    await whenLoadSettled().catch(() => {});
    const newIds = new Set(docs.map(d => d.id));
    mutateCache(rows => [...rows.filter(o => !dropped.has(o.id) && !newIds.has(o.id)), ...docs]);
    mutateCache(rows => [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
    renderTable();
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const fieldDate   = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
    if (fieldMember?.value && fieldDate?.value && !_hasStagedEdits()) renderWeekGrid();
}
