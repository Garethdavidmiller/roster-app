// @ts-check
/**
 * admin-overrides.js — Change a Shift section of the admin portal.
 *
 * Owns: allOverrides cache, week grid render, bulk bar, save/delete to Firestore,
 *   Saved Changes table, shift rule validation, time input auto-format.
 * Does NOT own: login, AL booking, sick days, notifications.
 * Edit here for: grid rendering, override CRUD, bulk bar, validation rules.
 * Do not edit here for: AL/sick booking flows, auth, roster upload.
 *
 * Initialised by admin-app.js via initOverrides().
 */

import { teamMembers, getBaseShift, formatISO, isSunday, MONTH_ABB, parseISODate } from './roster-data.js';
import { isRestShift, shouldReplaceOverride, buildOverrideWrite, buildOverrideCacheRecord } from './override-utils.js';
import { db, collection, doc, serverTimestamp, writeBatch, auth, writeWithClaimRetry, COLLECTIONS } from './firebase-client.js';
// The cache, what it knows, and the reads that fill it — see admin-override-store.js. Re-exported
// below so admin-app.js and the tests keep one import site for the whole Change-a-Shift surface.
import { TYPES, PILL_TYPES, WORKED_OVERRIDE_TYPES } from './admin-shift-types.js';
import { initSavedChanges, renderTable, resetTableMemberFilter } from './admin-saved-changes.js';
import { initWeekEditor, renderWeekGrid, buildWeekGridInto, updateWeekNavLabel, updateSaveBtn,
         resetBulkPills, resetStagedRows, _hasStagedEdits } from './admin-week-editor.js';
export { TYPES, PILL_TYPES, renderTable, resetTableMemberFilter,
         renderWeekGrid, buildWeekGridInto, updateWeekNavLabel, updateSaveBtn, resetBulkPills, _hasStagedEdits };
import { initOverrideStore, getAllOverrides, setAllOverrides, removeFromCache, mutateCache,
         whenOverridesReady, whenLoadSettled, isOverrideCacheLoaded, hasOverrideAuthorityFor,
         loadOverrides, ensureMemberLoaded } from './admin-override-store.js';
export { initOverrideStore, getAllOverrides, setAllOverrides, removeFromCache,
         whenOverridesReady, whenLoadSettled, isOverrideCacheLoaded, hasOverrideAuthorityFor,
         loadOverrides, ensureMemberLoaded };
import { sessionReady } from './session.js';
import { parseOtherValue, OTHER_FLAVOURS } from './override-utils.js';
import { checkShiftRules } from './admin-shift-rules.js';
import { buildSaveReceipt } from './admin-save-receipt.js';

// ── PRIVATE STATE ─────────────────────────────────────────────────────────────
let _currentUser      = '';
let _currentIsAdmin   = false;
// Managers have full access too (edit any member on their behalf). Both admin and manager
// may view the "All staff" override list; a locked self-service user may not.
let _currentIsManager = false;
/** @type {(msg: string, lines?: string[]) => void} */
let _showSuccess      = () => {};
/** @type {(msg: string) => void} */
let _showError        = () => {};
/** @type {() => void} */
let _onAfterSave      = () => {};  // refresh AL/sick banners after any write
/** @type {() => void} */
let _markChanged      = () => {};
/** @type {(e: MouseEvent) => void} */
let _onEditRow        = () => {};  // handleEdit lives in admin-app.js; passed as callback

// When true, renderTable shows all members instead of only the selected member.
// Reset to false when the selected member changes.


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

/**
 * SINGLE SOURCE: is `dateStr` a WORKING day for the member? Used by every AL/absence range
 * operation — the two previews (AL/sick rest-day counts) AND the save/entitlement/write paths.
 * Rule (Sunday -> override -> base): Sundays are never worked (uncontracted, CLAUDE.md); an existing
 * override decides the day (worked iff its value is not a rest shift, so a non-rest override like
 * RDW on a base-RD day IS worked); otherwise the base shift decides.
 *
 * Previously reimplemented four times: the AL/sick PREVIEWS used an older fall-through form that
 * counted a base-RD day with a non-rest (RDW) override as a REST day, while the save/entitlement
 * paths counted it as WORKED - so the preview under-reported vs what the booking actually wrote.
 * Consolidating onto this (the save/write rule) fixes that drift.
 * @param {any} memberObj  teamMembers entry
 * @param {string} dateStr  YYYY-MM-DD
 * @param {Map<string, any>} ovByDate  from buildMemberDateMap
 * @returns {boolean}
 */
export function isWorkingDate(memberObj, dateStr, ovByDate) {
    if (isSunday(dateStr)) return false;
    const ov = ovByDate.get(dateStr);
    if (ov) return !isRestShift(ov.value);
    return !isRestShift(getBaseShift(memberObj, parseISODate(dateStr)));
}

// ── INIT ──────────────────────────────────────────────────────────────────────
/** Guard so initOverrides wires its delegated listeners only once (see initOverrides). */
let _listenersWired = false;
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
 */
export function initOverrides({ currentUser, currentIsAdmin, currentIsManager = false, showSuccess, showError,
                                 onAfterSave, markChanged, onEditRow }) {
    _currentUser    = currentUser;
    _currentIsAdmin = currentIsAdmin;
    _currentIsManager = currentIsManager;
    _showSuccess    = showSuccess;
    // The store owns the cache and the reads; it repaints through these. Injected rather than
    // imported back, which is what keeps the graph acyclic (import-graph.test.mjs).
    initWeekEditor({
        currentIsAdmin, showError, showSuccess,
        markChanged: () => _markChanged(),
        memberDateMap: buildMemberDateMap,
    });
    initSavedChanges({
        currentIsAdmin, currentIsManager, showError,
        onEditRow, onAfterSave: () => _onAfterSave(),
        onRenderWeekGrid: renderWeekGrid,
        hasStagedEdits: _hasStagedEdits,
        formatDate: formatDisplay,
    });
    initOverrideStore({
        renderTable, renderWeekGrid,
        hasStagedEdits: _hasStagedEdits,
        onAfterLoad: () => _onAfterSave(),
    });
    _showError      = showError;
    _onAfterSave    = onAfterSave;
    _markChanged    = markChanged;
    _onEditRow      = onEditRow;

    // Wire the delegated listeners ONCE. initOverrides can be called twice on the in-place login path
    // (an optimistic 'allow' init, then again from showAdminLogin's onSuccess after B1 clears an
    // unconfirmable session). The table/bulk-bar listeners are delegated on stable containers and read
    // module state (_currentUser etc.) at event time — which the re-assignment above keeps fresh — so
    // attaching them a second time would double-fire every click (e.g. a single Delete tap would arm
    // AND execute, bypassing the two-tap confirm). Identity still refreshes on every call; wiring does not.
    if (!_listenersWired) {
        _listenersWired = true;
    }
}

// ── SAVE ──────────────────────────────────────────────────────────────────────
/**
 * Writes a batch of override changes to Firestore and updates the in-memory cache.
 * Disables the Save button while running; re-enables in the finally block.
 * @param {Array<{memberName:string, date:string, type:string, value:string, note:string, existingId:string}>} toSave
 * @param {string[]} toDelete  Firestore document IDs to delete
 */
export async function executeSave(toSave, toDelete = []) {
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const fieldDate   = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
    const saveBtn     = /** @type {HTMLButtonElement|null} */ (document.getElementById('saveBtn'));
    const memberName  = fieldMember?.value;
    // Captured BEFORE the write: after it these rows are gone, and a receipt that cannot name what
    // it removed is missing the half a manager is least able to reconstruct from the grid.
    // NOT `.filter(Boolean)` (review): an id the cache cannot resolve is still a document being
    // deleted, and dropping it would take the day out of the receipt AND out of its count.
    const removedRows = toDelete.map(id => getAllOverrides().find(o => o.id === id) ?? null);
    // The per-kind counters went with the summary line they fed — the receipt names the DAYS, so
    // "2 added, 1 updated" had nobody left to tell (v21.38).
    const total       = toSave.length + toDelete.length;

    // Disable the button BEFORE awaiting sessionReady (v16.23). While sessionReady is still
    // pending (early after a slow-auth page load), a double-tap could pass the collector twice —
    // each run deletes existingId idempotently but MINTS ITS OWN new doc → duplicate overrides
    // for the same member/date. The finally below re-enables on every exit path.
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = `Saving ${total} change${total !== 1 ? 's' : ''}…`; }

    await sessionReady;
    // Don't mutate the cache until the initial load has settled — otherwise the in-flight initial
    // snapshot can resolve AFTER this write and overwrite `_allOverrides`, silently dropping the
    // change we just saved from the Saved-changes list (v16.85).
    await whenOverridesReady();
    // A failed initial load leaves the cache empty; the just-computed toSave/toDelete would still write
    // correctly to Firestore, but the admin is operating blind (their Saved-Changes view never loaded).
    // Refuse uniformly with the other write paths and prompt a reload (Finding #2, v16.97).
    // Every member this batch touches, not merely the one in the dropdown: the entries carry their
    // own `memberName`, and authority is now per member, so the question has to be asked of each.
    const writeMembers = [...new Set([memberName, ...toSave.map(e => e.memberName)].filter(Boolean))];
    if (writeMembers.some(m => !hasOverrideAuthorityFor(m))) {
        _showError("Couldn't load your saved changes — reload the page before making changes.");
        if (saveBtn) { saveBtn.textContent = 'Save changes'; }
        updateSaveBtn();
        return;
    }
    if (!auth.currentUser) {
        _showError("You've been signed out — please sign in again.");
        // This early return is before the try/finally — restore the button state it can't.
        if (saveBtn) { saveBtn.textContent = 'Save changes'; }
        updateSaveBtn();
        return;
    }

    try {
        // Build + commit as a re-runnable thunk so writeWithClaimRetry can retry once on a
        // stale-claim `permission-denied` (a just-provisioned manager on a pre-`manager`-claim token).
        // A WriteBatch can't be re-committed, so the batch (and newDocs) is rebuilt on each attempt;
        // the thunk RETURNS newDocs so the retry's fresh doc IDs are the ones we cache below.
        const newDocs = await writeWithClaimRetry(async () => {
            const batch = writeBatch(db);
            /** @type {any[]} */
            const docs = [];

            toDelete.forEach(id => batch.delete(doc(db, COLLECTIONS.overrides, id)));

            toSave.forEach(entry => {
                if (entry.existingId) batch.delete(doc(db, COLLECTIONS.overrides, entry.existingId));
                const { existingId: _, ...data } = entry;
                const newRef = doc(collection(db, COLLECTIONS.overrides));
                const fields = { ...data, source: 'manual', changedBy: _currentUser };
                batch.set(newRef, buildOverrideWrite(fields, serverTimestamp()));
                docs.push(buildOverrideCacheRecord(newRef.id, fields, new Date()));
            });
            await batch.commit();
            return docs;
        });

        // A RECEIPT, NOT A COUNT (v21.38). "2 added, 1 removed" cannot answer the question a manager
        // actually has — did I change the days I meant to? — and the commonest real mistake here
        // (a bulk apply that caught the wrong days, a grid left on last week) produces a perfectly
        // plausible count. The days are known before the commit, so this costs nothing.
        const receipt = buildSaveReceipt({
            toSave, removed: removedRows, memberName: memberName ?? '',
            formatDate: formatDisplay,
            // An Other day's value is the raw grammar `FLAVOUR[" RDW"][" HH:MM-HH:MM"]`, so printing it
            // gave "Other TRG RDW 09:00-17:00" — internal spelling in the one line that tells a
            // manager what they just did. The full word is what every other surface shows.
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

        resetStagedRows();   // the row lifecycle belongs to the week editor (v21.38)

        // AND ANY LOAD ALREADY RUNNING HAS TO LAND FIRST (v21.41). `whenOverridesReady()` above is a
        // one-shot latch — it answers for the BOOT load and, once resolved, for ever after says
        // nothing about the loads that follow: a member switch, the All-staff toggle, a Retry. Any of
        // those can be in flight when a save commits, and when it resolves it assigns the cache
        // wholesale from a snapshot taken BEFORE the write, so the day just saved disappears from
        // Saved Changes while sitting correctly in Firestore — the admin's own receipt and the list
        // disagreeing, which reads as data loss. `whenLoadSettled()` was written for this at v21.38
        // and called from nowhere (AI_MAP said otherwise). The `catch` is not incidental: a FAILED
        // load must not fail a save that has already committed.
        await whenLoadSettled().catch(() => {});
        // Update in-memory cache — no Firestore round-trip needed
        const removedIds = new Set([...toDelete, ...toSave.filter(e => e.existingId).map(e => e.existingId)]);
        mutateCache(rows => {
            const kept = rows.filter(o => !removedIds.has(o.id));
            kept.push(...newDocs);
            kept.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            return kept;
        });
        renderTable();
        _onAfterSave();
        if (fieldMember?.value && fieldDate?.value) renderWeekGrid();

    } catch (err) {
        console.error('[Admin] Save failed:', err);
        _showError((/** @type {any} */ (err))?.code === 'permission-denied'
            ? "Couldn't save — you may have been signed out. Please sign in again."
            : "Couldn't save — check your connection and try again.");
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
        updateSaveBtn();
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
 *   adjacency check doesn't constrain against a shift this save is removing (v16.83 review fix).
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
 * DECIDES ELSEWHERE, PAINTS HERE (v21.38): the rules are `checkShiftRules` in
 * `admin-shift-rules.js`, which has no DOM and no cache — the two things that made a legally
 * load-bearing check awkward to test. This resolves the adjacent days, then marks exactly the rows
 * it was told failed; deriving the rows again from the messages is how a highlight and its sentence
 * come to disagree.
 * @param {any[]}  toSave
 * @param {string} memberName
 * @param {string[]} [toDelete]  Override doc IDs being deleted in the same save (v16.83) — so an
 *   adjacency check doesn't constrain against a shift this save is removing.
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
 * Filters out rest days and Sundays; writes RD corrections for Sundays that
 * have a worked base shift. Updates the in-memory cache and re-renders the
 * table and week grid.
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
 * @returns {Promise<{workingCount: number, sundayCount: number}>}
 * @throws {Error} 'auth/session-expired' if no Firebase Auth session, or Firestore error
 */
export async function recordRangeOverrides({ type, value, memberName, dates, changedBy }) {
    // Wait for the Firebase Auth session to be (re-)established before the currentUser check —
    // mirrors executeSave(). A returning user has a valid LOCAL session but auth.currentUser is null
    // for a moment while Firebase restores; without this await an AL/sick save fired in that window
    // throws a FALSE 'auth/session-expired' (the v14.83 review's write-race). sessionReady resolves on
    // the same onAuthStateChanged the restore completes on, so the wait is sub-second on a normal load.
    await sessionReady;
    // Wait for the initial cache load before building ovByDate — on a cold cache buildMemberDateMap
    // returns an empty map, so an existing roster_import shift wouldn't be deleted (duplicate) and a
    // not-yet-loaded worked Sunday could be erased by an RD correction (v16.85).
    await whenOverridesReady();
    // If that initial read FAILED the cache is empty, not merely cold — writing now would build the
    // exact duplicate/erased-Sunday corruption the wait above guards against. Refuse rather than corrupt;
    // the caller surfaces a "reload before recording" message (Finding #2, v16.97).
    if (!hasOverrideAuthorityFor(memberName)) throw new Error('cache/load-failed');
    if (!auth.currentUser) throw new Error('auth/session-expired');

    const memberObj = teamMembers.find(m => m.name === memberName);

    // Build a priority-correct Map<date, override> — buildMemberDateMap applies
    // shouldReplaceOverride() so manual overrides beat roster_import entries.
    const ovByDate = buildMemberDateMap(memberName);

    const workingDates = memberObj
        ? dates.filter(dateStr => isWorkingDate(memberObj, dateStr, ovByDate)) // single-source rule (Sundays non-contracted per CLAUDE.md)
        : [];

    // Sundays within the range that have a worked base shift need an explicit RD correction
    // so the base roster shift doesn't still show on the calendar during the absence period.
    const sundayCorrections = memberObj
        ? dates.filter(dateStr => {
            if (!isSunday(dateStr)) return false;
            const base = getBaseShift(memberObj, parseISODate(dateStr));
            if (isRestShift(base)) return false;
            // Skip the RD correction when the existing override is already a rest shift (RD/OFF —
            // nothing to correct, avoid churn) OR is a genuinely WORKED override that correction/RD
            // would silently ERASE. WORKED_OVERRIDE_TYPES covers both the current types
            // (rdw/shift/spare_shift) AND the legacy-but-still-in-data ones (allocated/overtime/swap
            // — Sunday work is always overtime, so these are the most likely to appear on a Sunday);
            // omitting them clobbered a legacy Sunday overtime doc. A NON-worked override that
            // shouldn't be on a Sunday (sick/AL) still gets corrected to RD, preserving the v12.61
            // masking behaviour for those. (v16.19)
            const ov = ovByDate.get(dateStr);
            if (ov && (isRestShift(ov.value) || WORKED_OVERRIDE_TYPES.has(ov.type))) return false;
            return true;
          })
        : [];

    // No working days → record nothing (and report sundayCount:0 accurately). A Sunday RD
    // correction only makes sense ALONGSIDE an AL/absence booking (so a worked Sunday inside the
    // absence range shows as RD, not its shift). With zero working days there is no absence to
    // accompany, so writing a standalone correction/RD would SILENTLY erase a worked (possibly
    // RDW/overtime) Sunday — worse than doing nothing. (This is UI-unreachable anyway: the AL/sick
    // save button is disabled when workDays === 0, computed with the same isWorkingDate rule.)
    if (!workingDates.length) return { workingCount: 0, sundayCount: 0 };

    // Combine the two write sets into one op list and CHUNK it. A single un-chunked batch —
    // delete existing + set new = up to 2 ops per date — blows Firestore's hard 500-writes-per-
    // batch cap on a long absence range: ~250 working days each already carrying a roster_import
    // override → ~500 ops, so the WHOLE commit was rejected and the booking silently lost
    // (admin-sick allows a ~1-year range). Mirror _saveOverrideBatches' CHUNK=200 (200 dates ×
    // 2 ops = 400 ops < 500). Each chunk is its own re-runnable writeWithClaimRetry thunk (a
    // just-provisioned manager's stale `manager` claim self-heals per chunk), rebuilt on each
    // attempt because a WriteBatch can't be re-committed. Accepts the same partial-commit-on-
    // mid-range-failure trade-off _saveOverrideBatches already carries (v16.19).
    const ops = [
        ...workingDates.map(date => ({ date, type, value })),
        ...sundayCorrections.map(date => ({ date, type: 'correction', value: 'RD' })),
    ];
    const CHUNK = 200;
    /** @type {any[]} */
    const newDocs = [];
    const deletedIds = new Set();
    for (let i = 0; i < ops.length; i += CHUNK) {
        const slice = ops.slice(i, i + CHUNK);
        let res;
        try {
            res = await writeWithClaimRetry(async () => {
                /** @type {any[]} */
                const docs   = [];
                const delIds = new Set();
                const batch  = writeBatch(db);
                slice.forEach(op => {
                    const existing = ovByDate.get(op.date);
                    if (existing) { batch.delete(doc(db, COLLECTIONS.overrides, existing.id)); delIds.add(existing.id); }
                    const newRef = doc(collection(db, COLLECTIONS.overrides));
                    const fields = { memberName, date: op.date, type: op.type, value: op.value, note: '', source: 'manual', changedBy };
                    batch.set(newRef, buildOverrideWrite(fields, serverTimestamp()));
                    docs.push(buildOverrideCacheRecord(newRef.id, fields, new Date()));
                });
                await batch.commit();
                return { docs, delIds };
            });
        } catch (err) {
            // A chunk failed AFTER earlier chunks committed → Firestore holds partial data the
            // in-memory cache doesn't reflect (the cache update below never runs). Resync from
            // Firestore so the Saved-changes list is TRUTHFUL, and tag the error so the caller can
            // warn the user that some of the range may already have saved (v16.25). A first-chunk
            // failure committed nothing, so the cache is still consistent — no resync needed.
            if (newDocs.length || deletedIds.size) {
                try { await loadOverrides(); } catch { /* best-effort resync */ }
                /** @type {any} */ (err).partialCommit = true;
            }
            throw err;
        }
        newDocs.push(...res.docs);
        res.delIds.forEach(id => deletedIds.add(id));
    }

    // Any load already running lands FIRST — the same ordering `executeSave` takes, and for the same
    // reason: `whenOverridesReady()` above answers only for the boot load (v21.41). A range booking
    // is the write where this matters most, because it is the one that can put a fortnight of annual
    // leave into the list and then watch it disappear.
    await whenLoadSettled().catch(() => {});
    // Update in-memory cache — no Firestore round-trip needed
    mutateCache(rows => [...rows.filter(o => !deletedIds.has(o.id)), ...newDocs]);
    mutateCache(rows => [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
    renderTable();
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const fieldDate   = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
    if (fieldMember?.value && fieldDate?.value) renderWeekGrid();

    return { workingCount: workingDates.length, sundayCount: sundayCorrections.length };
}

// ── DATE DISPLAY ──────────────────────────────────────────────────────────────
/**
 * Formats YYYY-MM-DD as "18 Mar 2026". Returns "—" for empty input.
 * @param {string} str
 */
export function formatDisplay(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${parseInt(d, 10)} ${MONTH_ABB[parseInt(m, 10) - 1]} ${y}`;
}
