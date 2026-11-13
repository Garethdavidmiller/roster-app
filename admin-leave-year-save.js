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
 * the record already said: `replacedType`, so a swapped-in day still costs a day after it moves, and
 * its `note` (v25.89: it was written as '', which dropped a note while promising nothing changed).
 *
 * ── A STALE PAGE MAY NOT WRITE A DAY OFF BACK INTO EXISTENCE ────────────────────────────────────
 *
 * The save is a fresh annual-leave record, so on a page loaded this morning it would resurrect leave
 * cancelled on another device since, or write leave over a shift a manager has just given. So the
 * check and the write are ONE transaction (`commitIfUnchanged`, admin-override-store.js, v25.89): the
 * record shown must still be there and unchanged, every record the save deletes must be the one this
 * page loaded, and the fixed id must hold nothing it has not. Until v25.89 they were a re-read and a
 * separate batch, and a shift a manager saved between the two was turned back into leave (external
 * review, Nov 2026). The fields carried over are read from the server's copy inside the transaction,
 * never the page's. What it cannot see — a re-import on another device that adds a record beside the
 * one shown — is the saves' accepted last-writer-wins.
 */

import { db, doc, serverTimestamp, auth, writeWithClaimRetry, COLLECTIONS } from './firebase-client.js';
import { sessionReady } from './session.js';
import { buildOverrideWrite, buildOverrideCacheRecord, nextReplacedType } from './override-utils.js';
import { manualOverrideId } from './override-id.js';
import { isValidLeaveYear, canChooseLeaveYear } from './leave-year.js';
import { whenOverridesReady, whenLoadSettled, hasOverrideAuthorityFor, idsReplacedBy, mutateCache,
         commitIfUnchanged, LEAVE_YEAR_CHANGED_LINE } from './admin-override-store.js';
import { buildMemberDateMap } from './admin-overrides.js';
import { renderTable } from './admin-saved-changes.js';
import { syncWeekAfterOwnWrite } from './admin-own-write.js';
import { withSlowSaveNotice } from './slow-save.js';

/** What this save's own refusals say. `saveFailureMessage` shows a refusal's `line` as it is; thrown
 *  as bare messages, all three read "check your connection" (whole-app check, 10 Nov 2026). */
const REFUSALS = {
    'auth/session-expired': "You've been signed out, so nothing was saved — please sign in again.",
    'cache/load-failed':    "This member's saved changes couldn't be loaded, so nothing was saved. Reload the page, then try again.",
    'leave-year/invalid':   "That year can't be chosen for this day, so nothing was saved.",
};
/** @param {keyof typeof REFUSALS} code @returns {Error} the code as its message, the words as its `line` */
const refusal = (code) => Object.assign(new Error(code), { line: REFUSALS[code] });

/**
 * Move one January leave day to `leaveYear`'s allowance (or back to its own, with null).
 * @param {{ memberName: string, date: string, leaveYear: number|null, changedBy: string }} opts
 * @returns {Promise<string[]>} the day, when a change staged on it in Change a Shift was cleared because
 *          the move changed it (admin-own-write.js) — for the panel to say; otherwise empty
 * @throws {Error} 'auth/session-expired', 'cache/load-failed' or 'leave-year/invalid' (as the message,
 *         with the words in `line`), a stale-page refusal carrying `line`, or a Firestore error —
 *         `saveFailureMessage` words every one of them
 */
export async function setLeaveYear({ memberName, date, leaveYear, changedBy }) {
    await sessionReady;
    await whenOverridesReady();
    if (!hasOverrideAuthorityFor(memberName)) await whenLoadSettled().catch(() => {});
    if (!hasOverrideAuthorityFor(memberName)) throw refusal('cache/load-failed');
    if (!auth.currentUser) throw refusal('auth/session-expired');
    if (!canChooseLeaveYear(date) || (leaveYear !== null && !isValidLeaveYear(date, leaveYear))) {
        throw refusal('leave-year/invalid');
    }
    const shown = buildMemberDateMap(memberName).get(date);
    if (!shown || shown.type !== 'annual_leave') {
        throw Object.assign(new Error(LEAVE_YEAR_CHANGED_LINE), { line: LEAVE_YEAR_CHANGED_LINE });
    }

    const fixedId = manualOverrideId(memberName, date);
    const dropped = new Set(idsReplacedBy(memberName, date, shown.id));
    /** @type {any} */
    let fields = null;
    /** The day as THIS move leaves it: this editor's annual leave in the chosen year, whatever it replaced gone.
     *  @param {Map<string, any>} latest */
    const movedHere = (latest) => {
        const at = latest.get(fixedId);
        return !!at && at.memberName === memberName && at.date === date && at.type === 'annual_leave' && at.value === 'AL'
            && at.source === 'manual' && at.changedBy === changedBy && (at.leaveYear ?? null) === (leaveYear ?? null)
            && [...dropped].every(id => latest.get(id) === null);
    };
    const { done, latest } = await withSlowSaveNotice(writeWithClaimRetry(() => commitIfUnchanged(
        // The record shown — which must still be there — every record the save deletes, and the fixed id
        // it lands on: each still what this page loaded for it, or, where it loaded nothing, nothing.
        [shown, ...dropped, fixedId],
        (/** @type {any} */ tx, /** @type {Map<string, any>} */ latest) => {
            const now = latest.get(shown.id);   // the server's copy, equal to `shown` by the check
            for (const id of dropped) tx.delete(doc(db, COLLECTIONS.overrides, id));
            fields = { memberName, date, type: 'annual_leave', value: 'AL', note: now.note ?? '', source: 'manual', changedBy,
                       replacedType: nextReplacedType(now, 'annual_leave'), leaveYear };
            tx.set(doc(db, COLLECTIONS.overrides, fixedId), buildOverrideWrite(fields, serverTimestamp()));
        },
        // A re-run after a commit whose answer was lost reads THIS move — another year, another stamp — and
        // must not call it a colleague's change and say nothing was saved (v25.89, review; commitIfUnchanged).
        { mustExist: [shown.id], line: LEAVE_YEAR_CHANGED_LINE, alreadyDone: movedHere })), { held: false });
    const saved = done ? latest.get(fixedId) : null;   // already there: the server's own copy, its stamp included
    const docs = [saved ? buildOverrideCacheRecord(fixedId, saved, saved.createdAt) : buildOverrideCacheRecord(fixedId, fields, new Date())];

    // The same landing as the other two writes (admin-overrides.js): any load in flight first, then
    // a merge by id, so a snapshot newer than the commit cannot leave the day in the cache twice.
    await whenLoadSettled().catch(() => {});
    const newIds = new Set(docs.map(d => d.id));
    mutateCache(rows => [...rows.filter(o => !dropped.has(o.id) && !newIds.has(o.id)), ...docs]);
    mutateCache(rows => [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
    renderTable();
    // The week follows the move: all of it with nothing staged, else this day's row — the record a save of the day
    // compares with — a change staged on it cleared rather than saved over the moved leave (admin-own-write.js).
    return syncWeekAfterOwnWrite(docs);
}
