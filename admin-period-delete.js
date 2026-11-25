// @ts-check
/**
 * admin-period-delete.js — a Recorded-dates row's ✕: delete one booked period of leave or absence.
 *
 * Owns: the order a period delete does things in — which records go and what the line says
 *   (`periodDelete`), the over-allowance question it owes, the one checked transaction, and what the
 *   page is told afterwards.
 * Does NOT own: the list and its two-tap (admin-booked-periods.js, two-tap.js), which records a period
 *   holds (`periodDelete`, admin-booked-periods.js), the transaction (`deleteIfUnchanged`,
 *   admin-override-store.js) or the failure wording (`deleteFailureLine`, beside it).
 * Edit here for: what a period delete does, and in what order. Built by admin-app.js, which hands it
 *   every page handle and every Firebase call, so the whole of it runs in Node
 *   (admin-period-delete.test.mjs).
 *
 * ── WHY IT LEFT THE COORDINATOR (25 Nov 2026) ───────────────────────────────────────────────────
 *
 * Its rules were guarded by reading admin-app.js's SOURCE, because the coordinator imports Firebase and
 * could not load in a test: that the control is marked in flight before the first await was a string
 * search. Here every dependency is injected, and the same rule is asserted by tapping twice.
 *
 * ── THE ROWS AS SHOWN ───────────────────────────────────────────────────────────────────────────
 *
 * The records a delete compares with the server are the ones the row listed at the FIRST tap. Answered
 * "Save anyway", the over-allowance question hands back what was on screen then (`atPress`), so the
 * answer deletes what it was asked about and a colleague's change since is still refused (review,
 * 21 Nov 2026).
 *
 * ── THE OVER-ALLOWANCE QUESTION A DELETE OWES (external review of v26.58) ───────────────────────
 *
 * As Saved Changes' ✕ and Delete selected ask it (`planAlDelete`): deleting December leave in a Spare
 * week over New Year moves its four onto January's days, and deleting a worked day's record can take
 * back a day in lieu — either can leave a year over.
 *
 * ── IN FLIGHT FROM THE CONFIRMING TAP, BEFORE ANYTHING IS AWAITED (review, 22 Nov 2026) ─────────
 *
 * Marked only after the session wait, a second confirming tap during that wait still found the control
 * armed and enabled, passed `twoTap`, and started a second delete of the same days. A disabled control
 * takes no tap, and the `finally` gives it back on every path, the signed-out one included.
 *
 * ── THE SESSION WAIT ────────────────────────────────────────────────────────────────────────────
 *
 * As the week grid's save does: `auth.currentUser` is briefly null while a returning session restores,
 * and a delete then would report a false "Delete failed".
 */

import { periodDelete } from './admin-booked-periods.js';
import { planAlDelete } from './admin-al-week-save.js';
import { withClearedDays } from './admin-own-write.js';
import { deleteFailureLine } from './admin-override-store.js';
import { holdFeedback, fadeFeedback } from './feedback-line.js';
import { setStatus } from './status-text.js';

/**
 * Build the Recorded-dates delete.
 * @param {{
 *   getOverrides: () => any[],
 *   members: any[],
 *   isRestGap: (iso: string, memberObj: any) => boolean,
 *   isRead: (memberName: string) => boolean,
 *   showConfirm: (msg: string, sub: string, pendingSave: null, pendingDelete: any[], resume: () => void, owner: 'al'|'sick') => void,
 *   sessionReady: Promise<any>,
 *   signedIn: () => boolean,
 *   commit: (shown: any[]) => Promise<any>,
 *   removeFromCache: (ids: Set<string>) => void,
 *   afterDelete: () => void,
 *   syncWeek: (rows: any[]) => string[],
 *   showToast: (msg: string) => void,
 * }} deps
 *   `commit` — the checked transaction, with its claim retry and slow-save notice (admin-app.js);
 *   `afterDelete` — the Saved Changes table and every view of leave and absence, redrawn; `syncWeek` —
 *   the week follows the delete (admin-own-write.js), and answers the staged days it cleared.
 * @returns {(type: string, memberName: string, start: string, end: string, feedbackEl: HTMLElement|null,
 *            btn: HTMLButtonElement, listedCount?: number,
 *            ask?: { resume?: (atPress: any) => void, atPress?: { shown: any[], said: string } }) => Promise<void|'asked'>}
 *   the list's `onDelete` (admin-booked-periods.js): 'asked' when the question is up and nothing was deleted
 */
export function createPeriodDelete(deps) {
    return async function deletePeriodOverrides(type, memberName, start, end, feedbackEl, btn, listedCount, ask = {}) {
        // WHICH RECORDS GO, AND WHAT THE LINE SAYS: `periodDelete` (admin-booked-periods.js) — scoped so a Sunday RD
        // correction another range still needs is kept (edge Sunday, A1), a stored Christmas day stays the Christmas
        // row's, and the line counts the DAYS the row listed (not documents), naming any uncounted ones it takes too.
        const allForDelete = deps.getOverrides();
        const memberObj = deps.members.find(m => m.name === memberName);
        const fresh = ask.atPress ? null : periodDelete({ overrides: allForDelete, type, memberName, start, end,
            isRestGap: d => deps.isRestGap(d, memberObj), listedCount });
        // THE ROWS AS SHOWN (header).
        const listed = new Set(fresh?.ids ?? []);
        const shown = ask.atPress?.shown ?? allForDelete.filter(o => listed.has(o.id));
        const said = ask.atPress?.said ?? fresh?.said ?? '';
        // THE BUTTON'S IDLE STATE IS admin-booked-periods.js's, restored when this promise settles.
        if (!shown.length) return;
        // THE OVER-ALLOWANCE QUESTION A DELETE OWES (header).
        const overage = ask.atPress || !ask.resume ? null
            : planAlDelete({ rows: shown, members: deps.members, overrides: allForDelete, isRead: deps.isRead });
        if (overage && ask.resume) {
            const resume = ask.resume, atPress = { shown, said };
            btn.focus?.();   // what the bar's Cancel goes back to
            deps.showConfirm(overage.headline, overage.detail, null, [], () => resume(atPress), type === 'sick' ? 'sick' : 'al');
            return 'asked';
        }
        const idSet = new Set(shown.map(o => o.id));
        // IN FLIGHT FROM THE CONFIRMING TAP, BEFORE ANYTHING IS AWAITED (header).
        btn.disabled    = true;
        btn.textContent = '…';
        try {
            await deps.sessionReady;   // the session wait (header)
            if (!deps.signedIn()) {
                if (feedbackEl) {
                    holdFeedback(feedbackEl);
                    setStatus(feedbackEl, "⚠ You've been signed out — please sign in again.");
                    feedbackEl.className = 'feedback error';
                }
                feedbackEl?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
                return;
            }
            // The rows this card LISTED are compared with the server and deleted in ONE transaction.
            await deps.commit(shown);
            deps.removeFromCache(idSet);   // drops the deleted rows; does NOT widen coverage
            // …and the page redrawn — the previews too: a range already picked was drawn over the deleted days (admin-2-2).
            deps.afterDelete();
            // The week follows the delete (admin-own-write.js): a change staged on a deleted day is cleared, named below.
            const cleared = deps.syncWeek(shown);
            if (feedbackEl) {
                setStatus(feedbackEl, withClearedDays(said, cleared));
                feedbackEl.className = 'feedback success';
                if (!cleared.length) fadeFeedback(feedbackEl, 'feedback', 6000);   // the line's ONE fade, which a later message cancels (admin-2-7)
            }
            // The inline line can be a screen above the deleted row, so the same toast Save gets.
            deps.showToast(said);
        } catch (err) {
            console.error('[Admin] Period delete failed:', err);
            if (feedbackEl) {
                // Never blamed on the connection when it was a refusal (admin-2-10), and never "Couldn't save":
                // a delete's words are `deleteFailureLine`'s, as every Admin delete's are.
                holdFeedback(feedbackEl);   // an earlier delete's fade must not take this error down (admin-2-7)
                setStatus(feedbackEl, deleteFailureLine(err, 'Could not delete'));   // the ⚠ is decoration, not a word to announce (status-text.js)
                feedbackEl.className = 'feedback error';
                // An error has to be READ, so it stays inline rather than in a 4s toast — and is
                // brought into view, because the control that failed can be a screen below it.
                feedbackEl.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
            }
        } finally {
            btn.disabled = false;
        }
    };
}
