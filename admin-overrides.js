// @ts-check
/**
 * admin-overrides.js — Change a Shift section of the admin portal.
 *
 * Owns: the two save paths (executeSave, recordRangeOverrides), the shift-rule glue and
 *   buildMemberDateMap; re-exports the grid, list, cache and type table for one import site.
 * Does NOT own: the grid (admin-week-editor.js), the list (admin-saved-changes.js), the cache
 *   (admin-override-store.js), the rules (admin-shift-rules.js), login, or the AL/absence cards.
 * Edit here for: what a save writes. Do not edit here for: grid rendering, auth, roster upload.
 *
 * Initialised by admin-app.js via initOverrides().
 */

import { teamMembers, getBaseShift, formatISO, isSunday, parseISODate } from './roster-data.js';
import { shouldReplaceOverride, buildOverrideWrite, buildOverrideCacheRecord, nextLeaveYear, chunkByWrites } from './override-utils.js';
import { manualOverrideId } from './override-id.js';
import { db, doc, serverTimestamp, auth, writeWithClaimRetry, COLLECTIONS } from './firebase-client.js';
import { saveFailureMessage } from './claim-retry.js';
// The cache, what it knows, and the reads that fill it — see admin-override-store.js. Re-exported
// below so admin-app.js and the tests keep one import site for the whole Change-a-Shift surface.
import { TYPES, PILL_TYPES } from './admin-shift-types.js';
import { initSavedChanges, renderTable, resetTableMemberFilter } from './admin-saved-changes.js';
import { initWeekEditor, renderWeekGrid, buildWeekGridInto, updateWeekNavLabel, updateSaveBtn,
         resetBulkPills, resetStagedRows, _hasStagedEdits, setSaveInFlight, isSaveInFlight, sendingDays, NOT_ON_ROSTER_LINE } from './admin-week-editor.js';
import { stagedDayChanges } from './admin-day-change.js';
export { TYPES, PILL_TYPES, renderTable, resetTableMemberFilter,
         renderWeekGrid, buildWeekGridInto, updateWeekNavLabel, updateSaveBtn, resetBulkPills, _hasStagedEdits, setSaveInFlight, isSaveInFlight, sendingDays,
         NOT_ON_ROSTER_LINE };
import { initOverrideStore, getAllOverrides, setAllOverrides, removeFromCache, mutateCache,
         whenOverridesReady, whenLoadSettled, isOverrideCacheLoaded, hasOverrideAuthorityFor,
         loadOverrides, ensureMemberLoaded, idsReplacedBy, withManualDuplicates, commitChecked } from './admin-override-store.js';
export { initOverrideStore, getAllOverrides, setAllOverrides, removeFromCache,
         whenOverridesReady, whenLoadSettled, isOverrideCacheLoaded, hasOverrideAuthorityFor,
         loadOverrides, ensureMemberLoaded };
import { sessionReady } from './session.js';
import { parseOtherValue, OTHER_FLAVOURS } from './override-utils.js';
import { replacedTypeOnWrite, rangeWriteDates } from './al-swapped-days.js';
import { rangeSundayCorrections } from './admin-al-projection.js';
import { checkShiftRules } from './admin-shift-rules.js';
import { buildSaveReceipt } from './admin-save-receipt.js';
import { withSlowSaveNotice } from './slow-save.js';
import { drawnRecords, drawnDays, sendingEntries } from './admin-week-row-state.js';
import { formatDisplay, namedDays } from './admin-period-dates.js';
import { initOwnWrite, syncWeekAfterOwnWrite } from './admin-own-write.js';

// ── PRIVATE STATE ─────────────────────────────────────────────────────────────
let _currentUser      = '';
/** @type {(msg: string, lines?: string[]) => void} */
let _showSuccess      = () => {};
/** @type {(msg: string) => void} */
let _showError        = () => {};
/** @type {() => void} */
let _onAfterSave      = () => {};  // refresh AL/sick banners after any write
/** @type {() => void} */
let _markChanged      = () => {};

/**
 * Builds a Map<dateISO, override> for a specific member from the override cache.
 * O(N+D) alternative to O(N×D) per-date lookups. Call once per render cycle.
 * @param {string} memberName
 * @returns {Map<string, any>}
 */
export function buildMemberDateMap(memberName) {
    const map = new Map();
    for (const o of getAllOverrides()) {
        if (o.memberName !== memberName) continue;
        const existing = map.get(o.date);
        if (!existing || shouldReplaceOverride(existing, o)) map.set(o.date, o);
    }
    return map;
}

// `isWorkingDate` lives in `al-entitlement.js` beside `consumesEntitlement` ("is it written?" / "does it
// cost a day?"); re-exported so every call site is unchanged.
export { isWorkingDate } from './al-entitlement.js';


// ── INIT ──────────────────────────────────────────────────────────────────────
/**
 * Wire up all event listeners for the Change a Shift section.
 * Must be called once from admin-app.js after the DOM is ready.
 *
 * @param {object} opts
 * @param {string}   opts.currentUser       Logged-in member name (written to changedBy on saves)
 * @param {boolean}  opts.currentIsAdmin    Whether the user has admin rights
 * @param {boolean} [opts.currentIsManager] Whether the user has manager rights (full access, like admin)
 * @param {(msg: string, lines?: string[]) => void} opts.showSuccess  Success message; `lines` is the per-day save receipt
 * @param {(msg: string) => void} opts.showError    Show an error message in the week editor
 * @param {() => void} opts.onAfterSave       Called after any write; refreshes AL/sick banners
 * @param {() => void} opts.markChanged       Marks the week grid as having unsaved changes
 * @param {(e: MouseEvent) => void} opts.onEditRow   handleEdit from admin-app.js - jumps to edit an override
 * @param {(msg: string, sub: string, pendingSave: null, pendingDelete: string[], resume: () => void) => void} [opts.showALConfirm]
 *        the over-allowance bar, which a Saved Changes delete raises when it lowers an allowance (admin-saved-changes.js)
 */
export function initOverrides({ currentUser, currentIsAdmin, currentIsManager = false, showSuccess, showError,
                                 onAfterSave, markChanged, onEditRow, showALConfirm }) {
    _currentUser    = currentUser;
    _showSuccess    = showSuccess;
    // The store owns the cache and the reads; it repaints through these. Injected rather than
    // imported back, which is what keeps the graph acyclic (import-graph.test.mjs).
    initWeekEditor({
        canPickMember: currentIsAdmin || currentIsManager, showSuccess,
        markChanged: () => _markChanged(),
        memberDateMap: buildMemberDateMap,
    });
    // The page's OWN writes other than the week's save bring the grid into line through this (admin-own-write.js).
    initOwnWrite({ build: buildWeekGridInto, redraw: renderWeekGrid, recount: updateSaveBtn, hasStagedEdits: _hasStagedEdits, markChanged: () => _markChanged() });
    initSavedChanges({
        currentIsAdmin, currentIsManager, showError,
        onEditRow, onAfterSave: () => _onAfterSave(),
        onOwnWrite: syncWeekAfterOwnWrite,
        formatDate: formatDisplay,
        showALConfirm,
    });
    initOverrideStore({
        renderTable, renderWeekGrid,
        hasStagedEdits: _hasStagedEdits,
        onAfterLoad: () => _onAfterSave(),
    });
    _showError      = showError;
    _onAfterSave    = onAfterSave;
    _markChanged    = markChanged;
    // The once-only wiring guard lives with the LISTENERS (`initWeekEditor`, `initSavedChanges`);
    // `initOverrides` re-assigns identity on every call, which is the part that must NOT be guarded.
}

// ── SAVE ──────────────────────────────────────────────────────────────────────
/** A save refused because a day it touches has changed, named (v25.90): ONE commit, so nothing in it was saved.
 *  Exported for the week grid's own refusal of the same thing, found before the commit (admin-app.js). */
export const refusedLine = (/** @type {string[]} */ dates) => `Someone else has changed ${namedDays(dates)} since the page loaded, so nothing was saved. Reload the page to see the latest, then try again.`;
/**
 * Writes a batch of override changes to Firestore and updates the in-memory cache.
 * Disables the Save button while running; re-enables in the finally block.
 * @param {Array<{memberName:string, date:string, type:string, value:string, note:string, existingId:string,
 *                swapped?:boolean}>} toSave  `swapped` is an INSTRUCTION, not a field: it marks a rest day the
 *        admin has declared a swapped-in working day, and is stripped before the Firestore write (v23.75).
 * @param {string[]} toDelete  Firestore document IDs to delete
 * @param {string[]} [skipped]  dates staged but deliberately NOT written — see buildSaveReceipt. With
 *        nothing else to write this still reports, rather than being a Save that did nothing silently.
 * @param {string[]} [keptLeave]  the subset of `skipped` that still holds leave afterwards, so the
 *        receipt does not call a day clear that the Calendar is about to show leave on.
 */
export async function executeSave(toSave, toDelete = [], skipped = [], keptLeave = []) {
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const fieldDate   = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
    const saveBtn     = /** @type {HTMLButtonElement|null} */ (document.getElementById('saveBtn'));
    const memberName  = fieldMember?.value;
    const savedDate   = fieldDate?.value;
    // Captured BEFORE the write, which removes them: the receipt must name what it removed. NOT
    // `.filter(Boolean)`: an unresolvable id is still a document deleted, and still a day in the count.
    // AS ITS ROW SHOWED IT: a load under staged edits refreshes the cache, not the grid, so the cache's
    // copy can be a colleague's newer record — and comparing with that would delete it.
    const drawn = drawnRecords(document.getElementById('weekGrid')), shownDays = drawnDays(document.getElementById('weekGrid'));
    // Each day's before → after, read off the rows before the save redraws them: the receipt says what the
    // preview beside Save said (owner, 27 Nov 2026).
    const changes = stagedDayChanges(document.getElementById('weekGrid'), toSave);
    const removedRows = toDelete.map(id => drawn.get(id) ?? getAllOverrides().find(o => o.id === id) ?? null);
    const total       = toSave.length + toDelete.length;

    // NOTHING TO WRITE IS STILL AN OUTCOME: every staged day can be a rest day answered "free", and a
    // Save must never do nothing silently. No round trip — no document to touch; the days are named.
    if (!total && skipped.length) {
        const only = buildSaveReceipt({ toSave: [], removed: [], memberName: memberName ?? '',
            formatDate: formatDisplay, skipped, keptLeave, describe: () => '' });   // describe never called: nothing written
        _showSuccess(only.summary, only.lines);
        resetStagedRows();
        // …AND RE-RENDER: `resetStagedRows` only deactivates a row and does not put back what a
        // PREFILLED row showed; a blank row would say a "free" day's existing record had gone.
        if (fieldMember?.value && fieldDate?.value) renderWeekGrid();
        updateSaveBtn();
        return;
    }

    // Disable BEFORE awaiting sessionReady: a double-tap during a slow sign-in would run twice (fixed
    // ids make that a wasted write, not a duplicate). The finally re-enables it. `grid`: the week is
    // held still until the batch lands and redraws it; `sending` keeps what it sends for a kept draft.
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = `Saving ${total} change${total !== 1 ? 's' : ''}…`; } setSaveInFlight(true, { grid: true, sending: sendingEntries(toSave, toDelete, removedRows, memberName) });

    await sessionReady;
    // Not before the initial load settles: a snapshot landing after this write would drop it from the cache.
    await whenOverridesReady();
    // A failed load leaves the cache empty and the admin operating blind: refuse, prompt a reload.
    // Asked of EVERY member the batch touches — authority is per member.
    const writeMembers = [...new Set([memberName, ...toSave.map(e => e.memberName)].filter(Boolean))];
    if (writeMembers.some(m => !hasOverrideAuthorityFor(m))) await whenLoadSettled().catch(() => {});   // still LOADING ≠ failed (v24.38)
    if (writeMembers.some(m => !hasOverrideAuthorityFor(m))) {
        _showError(globalThis.navigator?.onLine === false ? "You're offline, so this member's saved changes can't be checked — reconnect, then save."
            : "Couldn't load your saved changes — reload the page before making changes.");
        if (saveBtn) { saveBtn.textContent = 'Save changes'; }
        setSaveInFlight(false);
        return;
    }
    if (!auth.currentUser) {
        _showError("You've been signed out — please sign in again.");
        // This early return is before the try/finally — restore the button state it can't.
        if (saveBtn) { saveBtn.textContent = 'Save changes'; }
        setSaveInFlight(false);
        return;
    }

    // RE-READ, not trusted (re-review R-A5): a range booking made while this row sat staged can
    // have replaced its document, and deleting the stale id would leave the new one as a duplicate.
    toSave = toSave.map(e => ({ ...e, existingId: buildMemberDateMap(e.memberName).get(e.date)?.id ?? null }));
    const deleteIds = withManualDuplicates(toDelete);   // or a deleted day's older duplicate resurfaces (v24.48)
    try {
        // A re-runnable thunk, so writeWithClaimRetry can retry a stale-claim `permission-denied`: a
        // WriteBatch can't be re-committed, so it is rebuilt each attempt and RETURNS the docs to cache.
        // withSlowSaveNotice explains a long wait for the server and changes nothing else (slow-save.js).
        const { docs: newDocs, dropped } = await withSlowSaveNotice(writeWithClaimRetry(async () => {
            /** @type {any[]} */
            let docs = [];
            /** @type {Set<string>} */
            const dropped = new Set(deleteIds);
            const byId = new Map(getAllOverrides().map(o => [o.id, o]));   // a staged row carries only an id
            /** The writes, onto a batch or a transaction — which may run this again, so nothing carries over. @param {any} w */
            const fill = (w) => { docs = []; const gone = new Set(deleteIds); gone.forEach(id => w.delete(doc(db, COLLECTIONS.overrides, id)));
            toSave.forEach(entry => {
                // Read BEFORE the delete on the next line, which is what destroys it: on a swapped-in
                // day it is the only record of contracted work, on a moved January day of its year.
                const _under = entry.existingId ? byId.get(entry.existingId) : null;
                // A day answered "swapped" records `shift`, so the entitlement check sees contracted work.
                const replacedType = replacedTypeOnWrite(_under, entry.type, entry.swapped);
                // ONE id per member and date (override-id.js): a colleague's save lands on the same document.
                const fixedId = manualOverrideId(entry.memberName, entry.date);
                for (const id of idsReplacedBy(entry.memberName, entry.date, entry.existingId)) {
                    if (!gone.has(id)) { w.delete(doc(db, COLLECTIONS.overrides, id)); gone.add(id); dropped.add(id); }
                }
                // `swapped` is stripped HERE, with `existingId`: both are instructions to this
                // function, and the rest of `entry` is spread straight into the document. A stray
                // key reaches `hasOnly()` in firestore.rules and permission-denies the whole save.
                const { existingId: _, swapped: _swapped, ...data } = entry;
                const newRef = doc(db, COLLECTIONS.overrides, fixedId);
                const fields = { ...data, source: 'manual', changedBy: _currentUser, replacedType, leaveYear: nextLeaveYear(_under, entry.type, entry.date) };
                w.set(newRef, buildOverrideWrite(fields, serverTimestamp()));
                docs.push(buildOverrideCacheRecord(newRef.id, fields, new Date()));
            }); };
            // EVERY DAY IT TOUCHES must still be what its row showed (else what the page has), checked in ONE
            // transaction (commitChecked). Offline, a save that only writes is held unchecked; a removal waits.
            await commitChecked(fill, { shownFor: (m, d) => (m === memberName && shownDays.has(d) ? shownDays.get(d) : buildMemberDateMap(m).get(d)), line: refusedLine,
                removed: [...removedRows.map((r, i) => r ?? toDelete[i]), ...deleteIds], holdOffline: !deleteIds.size });
            return { docs, dropped };
        }), { held: !deleteIds.size && globalThis.navigator?.onLine === false });

        // A RECEIPT, NOT A COUNT: a manager's question is "did I change the days I meant to?", and a
        // bulk apply on the wrong days produces a perfectly plausible count.
        const receipt = buildSaveReceipt({
            toSave, removed: removedRows, memberName: memberName ?? '', skipped, keptLeave, changes,
            formatDate: formatDisplay,
            // An Other day's value is raw grammar (`TRG RDW 09:00-17:00`): name it by its full word instead.
            describe: e => {
                if (TYPES[e.type]?.fixed) return TYPES[e.type].label;
                if (e.type === 'other') {
                    const o = parseOtherValue(e.value);
                    const word = OTHER_FLAVOURS[o?.flavour ?? '']?.full ?? 'Other';
                    return [word, o?.rdw ? 'RDW' : '', o?.time || ''].filter(Boolean).join(' ');
                }
                return `${TYPES[e.type]?.label ?? e.type}${e.value ? ' ' + e.value : ''}`;
            },
        });
        _showSuccess(receipt.summary, receipt.lines);

        // THE MERGE IS BY ID: a read can already hold what was just written, and an append counts a day
        // twice in everything that counts rows (Saved Changes, AL taken and booked). The write's own
        // record replaces whatever a read brought back for the same id.
        const newIds     = new Set(newDocs.map(d => d.id));
        const removedIds = new Set([...dropped].filter(id => !newIds.has(id)));
        const merge = () => mutateCache(rows => {
            const kept = rows.filter(o => !removedIds.has(o.id) && !newIds.has(o.id));
            kept.push(...newDocs);
            kept.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            return kept;
        });
        // Only the view this save came from: a navigation while it waited drew rows nobody saved (A9).
        // ASKED AT EACH REDRAW, not once before the wait below — a navigation can land inside it too.
        const sameView = () => !!fieldMember?.value && !!fieldDate?.value
            && fieldMember.value === memberName && fieldDate.value === savedDate;
        // DRAWN AS SAVED NOW, not after the wait: a switched-off row with a saved record reads as a
        // staged REMOVAL, and the Unsaved bar and the kept-draft check would count it.
        merge();
        if (sameView()) renderWeekGrid();

        // AND ANY LOAD ALREADY RUNNING LANDS FIRST: `whenOverridesReady()` answers only for the boot
        // load, and a later one can assign a snapshot older than this write — so merge AGAIN once it
        // has landed. A FAILED load must not fail a committed save.
        await whenLoadSettled().catch(() => {});
        merge();
        renderTable();
        if (sameView()) renderWeekGrid();
        // AFTER the redraw: its "saved — forget the kept draft" asks whether anything is still staged.
        _onAfterSave();

    } catch (err) {
        console.error('[Admin] Save failed:', err);
        _showError(saveFailureMessage(err));
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
        setSaveInFlight(false);
    }
}


// ── SHIFT RULE HELPERS ────────────────────────────────────────────────────────
/**
 * Returns the effective shift value for a member on a date, checking the
 * pending save batch first, then _allOverrides, then the base roster.
 * @param {string} memberName
 * @param {string} dateISO  YYYY-MM-DD
 * @param {any[]}  batch    Pending toSave entries
 * @param {string[]} [toDelete]  Override doc IDs being deleted in the SAME save — skipped so an
 *   adjacency check doesn't constrain against a shift this save is removing.
 */
export function getEffectiveShift(memberName, dateISO, batch, toDelete = []) {
    const inBatch = batch.find(e => e.date === dateISO);
    if (inBatch) return inBatch.value;
    let best = null;
    for (const o of getAllOverrides()) {
        if (o.memberName !== memberName || o.date !== dateISO) continue;
        if (toDelete.includes(o.id)) continue;   // this save is deleting it → it's not effective
        if (!best || shouldReplaceOverride(best, o)) best = o;
    }
    if (best) return best.value;
    const member = teamMembers.find(m => m.name === memberName);
    return member ? getBaseShift(member, parseISODate(dateISO)) : 'RD';
}

/**
 * Validates max shift duration (12 h) and minimum rest gap (12 h) for toSave.
 * Marks failing rows with .row-error in the DOM.
 *
 * DECIDES ELSEWHERE, PAINTS HERE: the rules are `checkShiftRules` (admin-shift-rules.js, no DOM).
 * This resolves the adjacent days and marks exactly the rows it was told failed — re-deriving them
 * from the messages is how a highlight and its sentence come to disagree.
 * @param {any[]}  toSave
 * @param {string} memberName
 * @param {string[]} [toDelete]  Override doc IDs being deleted in the same save (see getEffectiveShift).
 * @returns {string[]} Human-readable error strings (empty = valid)
 */
export function validateShiftRules(toSave, memberName, toDelete = []) {
    const weekGrid = document.getElementById('weekGrid');
    const memberObj = teamMembers.find(m => m.name === memberName);
    const { errors, failedDates } = checkShiftRules({
        toSave,
        isFixedType: t => Boolean(TYPES[t]?.fixed),
        resolveShift: iso => getEffectiveShift(memberName, iso, toSave, toDelete),
        baseShiftFor: iso => (memberObj ? getBaseShift(memberObj, parseISODate(iso)) : ''),
        formatDate: formatDisplay,
        shiftDate: (iso, delta) => {
            const d = parseISODate(iso);
            d.setDate(d.getDate() + delta);
            return formatISO(d);
        },
    });
    failedDates.forEach(date => {
        weekGrid?.querySelector(`.day-row[data-date="${date}"]`)?.classList.add('row-error');
    });
    return errors;
}

// ── RANGE ABSENCE SAVE ───────────────────────────────────────────────────────
/**
 * Writes a batch of AL or absence overrides for a date range.
 * Filters out rest days and Sundays — EXCEPT rest days passed in `swappedDates`, which the admin
 * has declared swapped-in working days; writes RD corrections for Sundays that
 * have a worked base shift. Updates the in-memory cache, re-renders the table,
 * and brings the week grid into line with the booking (admin-own-write.js).
 *
 * Does NOT handle entitlement checks, UI feedback, or picker reset — those
 * remain in admin-al.js and admin-sick.js respectively.
 *
 * @param {object} opts
 * @param {string}   opts.type        'annual_leave' | 'sick'
 * @param {string}   opts.value       'AL' | 'SICK'
 * @param {string}   opts.memberName
 * @param {string[]} opts.dates       Full date range including rest days
 * @param {string}   opts.changedBy   Written to the Firestore changedBy field
 * @param {string[]} [opts.swappedDates] Rest days the admin has DECLARED swapped-in working days,
 *        written as leave that COSTS a day (`replacedType: 'shift'`). Only the AL card supplies these.
 * @returns {Promise<{workingCount: number, sundayCount: number, cleared: string[]}>} `cleared`: the days whose
 *          change staged in Change a Shift the booking cleared — and on an error after part of it landed, `err.cleared`
 * @throws {Error} 'auth/session-expired' if no Firebase Auth session, or Firestore error
 */
export async function recordRangeOverrides({ type, value, memberName, dates, changedBy, swappedDates = [] }) {
    // auth.currentUser is briefly null while a returning session restores; without this wait a save in
    // that window throws a FALSE 'auth/session-expired'. As executeSave().
    await sessionReady;
    // A cold cache would miss an existing roster_import shift (a duplicate) or a worked Sunday (erased
    // by an RD correction); a FAILED read is worse, so refuse — the caller asks for a reload.
    await whenOverridesReady();
    if (!hasOverrideAuthorityFor(memberName)) await whenLoadSettled().catch(() => {});   // still loading ≠ failed (v24.38)
    if (!hasOverrideAuthorityFor(memberName)) throw new Error('cache/load-failed');
    if (!auth.currentUser) throw new Error('auth/session-expired');

    const memberObj = teamMembers.find(m => m.name === memberName);

    const ovByDate = buildMemberDateMap(memberName);   // priority-correct: manual beats roster_import

    // Declared swapped-in rest days fail `isWorkingDate` (hence the question), so they are unioned in,
    // with a forced `replacedType` below. Never a Sunday: it holds no annual leave, for any grade.
    const swapped = new Set((Array.isArray(swappedDates) ? swappedDates : []).filter(d => !isSunday(d)));
    // Which dates are written: `rangeWriteDates` — an answered-"free" rest day never (review A2).
    const workingDates = rangeWriteDates({ type, dates, memberObj, ovByDate, swappedDates: [...swapped] });

    // A Sunday in the range with a worked base shift gets an RD correction, so the shift does not show
    // during the absence — unless it already holds a rest value or a WORKED record it would erase. ONE
    // rule, which the range cards' preview and receipt name too: `rangeSundayCorrections` (admin-al-projection.js).
    const sundayCorrections = rangeSundayCorrections({ dates, memberObj, ovByDate });

    // No working days → record nothing. A Sunday correction only makes sense ALONGSIDE a booking; on
    // its own it would silently erase a worked (possibly RDW) Sunday. (The Save is disabled there too.)
    if (!workingDates.length) return { workingCount: 0, sundayCount: 0, cleared: [] };

    // CHUNKED under Firestore's 500-writes-per-batch cap, which a year's absence range can cross — and
    // then the whole booking is lost. `chunkByWrites` counts WRITES (a set plus a delete per id
    // `idsReplacedBy` names), not dates. Each chunk is its own re-runnable writeWithClaimRetry thunk;
    // the partial-commit trade-off is the import's. In DATE order, and a Sunday correction never starts
    // a chunk: one batch is one server timestamp, which is how deleting the period knows the edge
    // Sunday is its own (computePeriodDeleteIds). The cache records share one stamp per batch to match.
    const ops = [
        ...workingDates.map(date => ({ date, type, value })),
        ...sundayCorrections.map(date => ({ date, type: 'correction', value: 'RD' })),
    ].sort((a, b) => a.date.localeCompare(b.date));
    const chunks = chunkByWrites(ops, op => 1 + idsReplacedBy(memberName, op.date, ovByDate.get(op.date)?.id).length,
        { keepWithPrevious: op => op.type === 'correction' });
    /** @type {any[]} */
    const newDocs = [];
    const deletedIds = new Set();
    for (const slice of chunks) {
        let res;
        try {
            res = await withSlowSaveNotice(writeWithClaimRetry(async () => {
                /** @type {any[]} */
                let docs = [];
                let delIds = new Set();
                const stamp  = new Date();
                /** The chunk's writes, onto a batch or a transaction — which may run it again. @param {any} w */
                const fill = (w) => { docs = []; delIds = new Set(); slice.forEach(op => {
                    const existing = ovByDate.get(op.date);
                    // Read BEFORE the delete, which destroys it: the only record that a swapped-in day was
                    // contracted work, and of a moved January day's year. A declared swap records `shift`.
                    const replacedType = replacedTypeOnWrite(existing, op.type, swapped.has(op.date));
                    const fixedId = manualOverrideId(memberName, op.date);   // one per member and date
                    for (const id of idsReplacedBy(memberName, op.date, existing?.id)) {
                        if (!delIds.has(id)) { w.delete(doc(db, COLLECTIONS.overrides, id)); delIds.add(id); }
                    }
                    const fields = { memberName, date: op.date, type: op.type, value: op.value, note: '', source: 'manual', changedBy, replacedType, leaveYear: nextLeaveYear(existing, op.type, op.date) };
                    w.set(doc(db, COLLECTIONS.overrides, fixedId), buildOverrideWrite(fields, serverTimestamp()));
                    docs.push(buildOverrideCacheRecord(fixedId, fields, stamp));
                }); };
                // Each day must still hold what this page had for it — checked online, held offline.
                await commitChecked(fill, { shownFor: (_m, d) => ovByDate.get(d), line: refusedLine });
                return { docs, delIds };
            }), { batched: chunks.length > 1, held: globalThis.navigator?.onLine === false });
        } catch (err) {
            // A chunk failed AFTER earlier ones committed: resync so Saved Changes is truthful, and tag
            // the error so the caller can say part of the range may have saved. A first-chunk SIGNED_OUT
            // may still land; the write gate (claim-retry.js) refuses a retry until reload.
            if (newDocs.length || deletedIds.size) {
                const landed = new Set([...deletedIds, ...newDocs.map(d => d.id)]);   // in the cache first, should the re-read fail
                mutateCache(rows => [...rows.filter(o => !landed.has(o.id)), ...newDocs]);
                try { await loadOverrides({ everyone: false, member: memberName }); } catch { /* best-effort resync — of the BOOKED member, not the dropdown's (A14); a capped re-read would not cover them */ }
                /** @type {any} */ (err).partialCommit = true;
                /** @type {any} */ (err).cleared = syncWeekAfterOwnWrite(newDocs);   // the week follows the days that landed
            }
            throw err;
        }
        newDocs.push(...res.docs);
        res.delIds.forEach(id => deletedIds.add(id));
    }

    // Any load already running lands FIRST, then the merge is BY ID — both for executeSave's reasons,
    // and here a duplicated row is a duplicated DAY of annual leave in the taken/booked figures.
    await whenLoadSettled().catch(() => {});
    const newIds = new Set(newDocs.map(d => d.id));
    // Update in-memory cache — no Firestore round-trip needed
    mutateCache(rows => [...rows.filter(o => !deletedIds.has(o.id) && !newIds.has(o.id)), ...newDocs]);
    mutateCache(rows => [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
    renderTable();
    // The week follows the booking (admin-own-write.js): all of it when nothing is staged (review A5), else the booked
    // days' rows, a change staged on one of them cleared and named rather than saved over the leave; the caller's jump asks.
    const cleared = syncWeekAfterOwnWrite(newDocs);
    return { workingCount: workingDates.length, sundayCount: sundayCorrections.length, cleared };
}

// ── DATE DISPLAY — lives in admin-period-dates.js; re-exported so its importers are unchanged ──
export { formatDisplay };
