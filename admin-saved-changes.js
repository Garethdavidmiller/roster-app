// @ts-check
/**
 * admin-saved-changes.js — the Saved Changes list: what has been recorded, and un-recording it.
 *
 * ── WHY IT LEFT THE COORDINATOR (v21.38) ────────────────────────────────────────────────────────
 *
 * The second of the two splits the external Admin review asked for. `admin-overrides.js` owned four
 * distinct surfaces; this is the one a manager uses to ANSWER A QUESTION rather than to change
 * something — what is on record for this member, this month — and its editing is deletion, which is
 * a different write path with a different failure mode from the week editor's.
 *
 * ── THE ONE INVARIANT: IT MAY NOT CLAIM COMPLETENESS IT DOES NOT HAVE ───────────────────────────
 *
 * The "All staff" view is a different question from "this member", and it is answered from a cache
 * that may hold only the selected member. `coversAllStaff()` is asked at RENDER time, not merely
 * when the toggle is pressed: the toggle flips a flag and then starts a load, and if that load
 * fails or is still running, a later re-render from any unrelated action would otherwise draw three
 * rows and label them "(all staff)" with the button agreeing. A manager asking "has anyone else
 * booked that week?" would get no, and act on it. That shipped once in this release and is the
 * reason the check is here rather than at the toggle.
 *
 * The renderers and permissions arrive through `initSavedChanges` rather than being imported, which
 * is what keeps this out of a cycle with the coordinator that wires it.
 */

import { escapeHtml } from './roster-data.js';
import { db, doc, deleteDoc, writeBatch, writeWithClaimRetry, COLLECTIONS } from './firebase-client.js';
import { TYPES } from './admin-shift-types.js';
import { getAllOverrides, removeFromCache, isTruncated, coversAllStaff, OVERRIDES_QUERY_CAP, loadOverrides } from './admin-override-store.js';

import { setStatus } from './status-text.js';
// ── INJECTED ──────────────────────────────────────────────────────────────────
let _currentIsAdmin   = false;
let _currentIsManager = false;
/** @type {(msg: string) => void} */          let _showError      = () => {};
/** @type {(e: MouseEvent) => void} */        let _onEditRow      = () => {};
/** @type {() => void} */                     let _onAfterSave    = () => {};
/** @type {() => void} */                     let renderWeekGrid  = () => {};
/** @type {() => boolean} */                  let _hasStagedEdits = () => false;
/** @type {(iso: string) => string} */        let formatDisplay   = (s) => s;

/** Delegated listeners are attached once per page life — see the note in initWeekEditor. */
let _wired = false;

/**
 * @param {object} deps
 * @param {boolean} deps.currentIsAdmin
 * @param {boolean} deps.currentIsManager
 * @param {(msg: string) => void} deps.showError
 * @param {(e: MouseEvent) => void} deps.onEditRow
 * @param {() => void} deps.onAfterSave
 * @param {() => void} deps.onRenderWeekGrid
 * @param {() => boolean} deps.hasStagedEdits
 * @param {(iso: string) => string} deps.formatDate
 * @returns {void}
 */
export function initSavedChanges(deps) {
    _currentIsAdmin   = deps.currentIsAdmin;
    _currentIsManager = deps.currentIsManager;
    _showError        = deps.showError;
    _onEditRow        = deps.onEditRow;
    _onAfterSave      = deps.onAfterSave;
    renderWeekGrid    = deps.onRenderWeekGrid;
    _hasStagedEdits   = deps.hasStagedEdits;
    formatDisplay     = deps.formatDate;
    // Deps above every time; wiring once — see the note in `initWeekEditor` for why (v21.94).
    // `_initOverridesTable` delegates on `#overrideTableBody` and the bulk bar, so a second attach
    // would make one tap of the two-tap Delete both arm and execute.
    if (_wired) return;
    _wired = true;
    _initOverridesTable();
}

/** Clears the "show all staff" toggle and re-renders the table. Call when the selected member changes. */
export function resetTableMemberFilter() {
    _tableShowAllOverrides = false;
    renderTable();
}

/** Whether the list is showing every member rather than the selected one. */
let _tableShowAllOverrides = false;

/**
 * Loads override documents from Firestore into the store's cache,
 * then renders the table, week grid, and calls onAfterSave to refresh AL/sick banners.
 */
/**
 * Renders the Saved Changes table from _allOverrides.
 * Filtered by the currently selected member and the month/year dropdown.
 * When _tableShowAllOverrides is true, shows all members (admin toggle).
 */
export function renderTable() {
    const fieldMember        = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const tableBody          = document.getElementById('overrideTableBody');
    const listCount          = document.getElementById('listCount');
    const overridesMonthFilter = /** @type {HTMLSelectElement|null} */ (document.getElementById('overridesMonthFilter'));
    const selectAllOverrides = /** @type {HTMLInputElement|null} */ (document.getElementById('selectAllOverrides'));
    const bulkDeleteBtn      = document.getElementById('bulkDeleteBtn');
    const selectedMember     = fieldMember?.value;
    // THE ALL-STAFF VIEW ASKS A DIFFERENT QUESTION, SO IT ASKS IT HERE TOO (v21.38, review). The
    // toggle flips a flag and then STARTS a load; if that load fails, is still running, or was
    // coalesced away, the flag stays true with a per-member cache behind it — and this function
    // would render three rows and label them "(all staff)" with the button agreeing. A manager
    // asking "has anyone else booked that week?" would get no, and act on it. `coversAllStaff()` is
    // the LIST's question — distinct from `hasOverrideAuthorityFor`, which is every WRITE's.
    const showAll            = _tableShowAllOverrides && coversAllStaff();
    const memberFilter       = showAll ? '' : (selectedMember || '');
    const memberRows         = memberFilter
        ? getAllOverrides().filter(o => o.memberName === memberFilter)
        : getAllOverrides();

    // Update "Show all / This member" toggle button
    const showAllBtn = document.getElementById('showAllOverridesBtn');
    if (showAllBtn) {
        // Only admin/manager may reveal every member's changes — a locked self-service user
        // always has their own name selected, so gating on selectedMember alone exposed the
        // "All staff" toggle to them, contradicting the card's "your own changes only" tip.
        showAllBtn.hidden = !selectedMember || !(_currentIsAdmin || _currentIsManager);
        showAllBtn.textContent = showAll ? 'This member only' : 'All staff';
    }

    if (overridesMonthFilter) {
        const months = [...new Set(memberRows.map(o => (o.date || '').substring(0, 7)))]
            .filter(Boolean).sort((a, b) => b.localeCompare(a));
        const isFirstRender = !overridesMonthFilter.dataset.initialized;
        const today         = new Date();
        const currentMonth  = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        // Self-service staff mostly check FUTURE-dated leave, so default them to "All months" — a
        // current-month default hid a booking made for a later month behind the filter, reading as
        // "nothing saved". Admin/manager browse heavily, so keep their current-month default.
        const defaultMonth  = (_currentIsAdmin || _currentIsManager) ? currentMonth : '';
        const prevValue     = isFirstRender ? defaultMonth : overridesMonthFilter.value;
        overridesMonthFilter.dataset.initialized = '1';
        overridesMonthFilter.innerHTML = '<option value="">All months</option>';
        months.forEach(ym => {
            const [y, m] = ym.split('-');
            const label  = `${new Date(+y, +m - 1, 1).toLocaleString('en-GB', { month: 'long' })} ${y}`;
            const opt    = document.createElement('option');
            opt.value    = ym;
            opt.textContent = label;
            if (ym === prevValue) opt.selected = true;
            overridesMonthFilter.appendChild(opt);
        });
    }

    const monthFilter = overridesMonthFilter?.value || '';
    const rows = monthFilter
        ? memberRows.filter(o => (o.date || '').startsWith(monthFilter))
        : memberRows;
    if (listCount) {
        const label   = `${rows.length} saved change${rows.length !== 1 ? 's' : ''}`;
        const context = showAll ? ' (all staff)' : '';
        // No-silent-caps: when the load hit the query cap, say the list is the most-recent subset so
        // an admin isn't misled into thinking an unlisted old booking doesn't exist (Finding #8).
        const capped  = isTruncated() ? ` — showing the ${OVERRIDES_QUERY_CAP} most recent; older changes aren't listed` : '';
        listCount.textContent = label + context + capped;
    }
    // Header context chip (v18.16): the count at a glance while the card is collapsed. Mirrors the
    // list's current view (member/month filter); empty at zero — the :empty rule hides the chip.
    // "+" when the load hit the query cap (v18.23 — no-silent-caps, matching the Error Log chip's
    // '100+'): a capped load means older rows exist beyond ANY current view, so a bare number on a
    // collapsed card would read as exact.
    const countChip = document.getElementById('overridesCountChip');
    if (countChip) countChip.textContent = rows.length
        ? String(rows.length) + (isTruncated() ? '+' : '') : '';

    if (!rows.length) {
        const who = memberFilter ? ` for ${escapeHtml(memberFilter)}` : '';
        // Month-aware: never claim "nothing saved" when a month filter is just narrowing the view
        // (a booking for another month is still there) — point the user at "All months".
        const msg = monthFilter
            ? `No changes in the selected month${who}. Choose “All months” above to see other dates.`
            : `No recorded changes yet${who}. Any shifts you record will appear here.`;
        if (tableBody) tableBody.innerHTML = `<div class="override-state">${msg}</div>`;
        return;
    }

    if (tableBody) tableBody.innerHTML = '';
    if (selectAllOverrides) selectAllOverrides.checked = false;
    if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'none';

    rows.forEach(o => {
        const typeMeta     = TYPES[o.type];
        const isLegacyType = ['allocated', 'overtime', 'swap'].includes(o.type);
        const eid   = escapeHtml(o.id   || '');
        const edate = escapeHtml(o.date || '');
        const etype = escapeHtml(o.type || '');
        const ename = escapeHtml(o.memberName || '');
        const card = document.createElement('div');
        card.className = 'override-card';
        card.innerHTML = `
            <input type="checkbox" class="row-select" data-id="${eid}" aria-label="Select ${ename} ${edate}">
            <div class="oc-body">
                <div class="oc-head"><span class="oc-date">${formatDisplay(o.date)}</span><span class="oc-member">${ename}</span></div>
                <div class="oc-detail"><span class="list-type-pill lpill-${etype}">${typeMeta ? typeMeta.label : etype}</span>${isLegacyType ? '<span class="legacy-pill">old format</span>' : ''}${o.source === 'roster_import' ? '<span class="source-pill">PDF upload</span>' : ''}<span class="oc-value">${escapeHtml(o.value)}</span></div>
            </div>
            <div class="oc-actions">
                <button class="btn-edit" data-member="${ename}" data-date="${edate}" aria-label="Edit ${ename} ${edate}">Edit</button>
                <button class="btn-delete" data-id="${eid}" aria-label="Delete ${ename} ${edate}">Delete</button>
            </div>`;
        if (tableBody) tableBody.appendChild(card);
    });
    // Delegated listeners attached once in _initOverridesTable() — see below.
    // Previously: 3 × N listeners per render (e.g. 6000 for 2000 overrides).
}

function _updateBulkDeleteVisibility() {
    const tableBody          = document.getElementById('overrideTableBody');
    const bulkDeleteBtn      = document.getElementById('bulkDeleteBtn');
    const selectAllOverrides = /** @type {HTMLInputElement|null} */ (document.getElementById('selectAllOverrides'));
    const checkedCount = tableBody?.querySelectorAll('.row-select:checked').length ?? 0;
    if (bulkDeleteBtn) bulkDeleteBtn.style.display = checkedCount > 0 ? 'inline-block' : 'none';
    if (selectAllOverrides) {
        const total = tableBody?.querySelectorAll('.row-select').length ?? 0;
        selectAllOverrides.checked       = total > 0 && checkedCount === total;
        selectAllOverrides.indeterminate = checkedCount > 0 && checkedCount < total;
    }
}

/**
 * @param {HTMLButtonElement} btn
 * @param {string} confirmLabel
 * @param {string} resetLabel
 */
function _armConfirmButton(btn, confirmLabel, resetLabel) {
    btn.classList.add('confirming');
    btn.textContent = confirmLabel;
    setTimeout(() => {
        if (btn.classList.contains('confirming')) {
            btn.classList.remove('confirming');
            btn.textContent = resetLabel;
        }
    }, 5000);
}

/** @param {MouseEvent} e */
async function _handleDelete(e) {
    // closest() makes this work both directly and via delegation.
    const btn     = /** @type {HTMLButtonElement|null} */ (/** @type {Element} */ (e.target).closest('.btn-delete'));
    if (!btn) return;
    const listFeedback = document.getElementById('listFeedback');
    const fieldMember  = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const fieldDate    = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
    if (!btn.classList.contains('confirming')) {
        _armConfirmButton(btn, '⚠ Delete?', 'Delete');
        return;
    }
    const deleted = getAllOverrides().find(o => o.id === btn.dataset.id);
    btn.disabled = true;
    btn.textContent = '…';
    try {
        // Wrap in writeWithClaimRetry so a just-provisioned manager on a pre-`manager`-claim token
        // self-heals (force-refresh + retry once) instead of a hard permission-denied — parity with
        // the executeSave / recordRangeOverrides / bulk-delete write paths.
        await writeWithClaimRetry(() => deleteDoc(doc(db, COLLECTIONS.overrides, btn.dataset.id ?? '')));
        removeFromCache([btn.dataset.id ?? '']);
        renderTable();
        _onAfterSave();
        // Don't rebuild the week grid over unsaved staged edits — deleting a Saved-Changes row is
        // unrelated to whatever the admin is mid-editing in the grid (v16.82). The delete is already
        // reflected in the table above; the grid refreshes next time it's rebuilt.
        if (fieldMember?.value && fieldDate?.value && !_hasStagedEdits()) renderWeekGrid();
        if (deleted && listFeedback) {
            const typeMeta = TYPES[deleted.type];
            setStatus(listFeedback, `✓ Deleted: ${deleted.memberName} — ${formatDisplay(deleted.date)} (${typeMeta ? typeMeta.label : deleted.type})`);
            listFeedback.className = 'list-feedback success';
            setTimeout(() => { listFeedback.className = 'list-feedback'; }, 6000);
        }
    } catch (err) {
        console.error('[Admin] Delete failed:', err);
        btn.disabled = false;
        btn.classList.remove('confirming');
        btn.textContent = 'Delete';
        if (listFeedback) {
            setStatus(listFeedback, (/** @type {any} */ (err))?.code === 'unavailable'
                ? '⚠ You appear to be offline — reconnect and try again.'
                : '⚠ Could not delete — check your connection and try again.');
            listFeedback.className = 'list-feedback error';
        }
    }
}

function _initOverridesTable() {
    const selectAllOverrides = /** @type {HTMLInputElement|null} */ (document.getElementById('selectAllOverrides'));
    const bulkDeleteBtn      = /** @type {HTMLButtonElement|null} */ (document.getElementById('bulkDeleteBtn'));
    const overridesMonthFilter = document.getElementById('overridesMonthFilter');
    const listFeedback       = document.getElementById('listFeedback');
    const fieldMember        = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const fieldDate          = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));

    // Delegated listeners — one per event type on the whole table body, replaces
    // attaching N per-row listeners on every renderTable() call.
    const tableBody = document.getElementById('overrideTableBody');
    if (tableBody) {
        tableBody.addEventListener('click', (e) => {
            const target = /** @type {Element} */ (e.target);
            if (target.closest('.btn-delete')) return _handleDelete(e);
            if (target.closest('.btn-edit'))   return _onEditRow(e);
        });
        tableBody.addEventListener('change', (e) => {
            if (/** @type {Element} */ (e.target).closest('.row-select')) _updateBulkDeleteVisibility();
        });
    }

    if (selectAllOverrides) {
        selectAllOverrides.addEventListener('change', () => {
            document.getElementById('overrideTableBody')?.querySelectorAll('.row-select')
                .forEach(cb => { /** @type {HTMLInputElement} */ (cb).checked = selectAllOverrides.checked; });
            _updateBulkDeleteVisibility();
        });
    }

    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', async () => {
            const checkedRows = /** @type {HTMLElement[]} */ ([...(document.getElementById('overrideTableBody')?.querySelectorAll('.row-select:checked') ?? [])]);
            if (!checkedRows.length) return;
            const ids = checkedRows.map(cb => /** @type {HTMLElement} */ (cb).dataset.id ?? '');

            // Two-tap confirmation — matches single-delete pattern
            if (!bulkDeleteBtn.classList.contains('confirming')) {
                _armConfirmButton(bulkDeleteBtn, `⚠ Delete ${ids.length}?`, 'Delete selected');
                return;
            }
            bulkDeleteBtn.classList.remove('confirming');

            bulkDeleteBtn.disabled = true;
            bulkDeleteBtn.textContent = `Deleting ${ids.length}…`;
            try {
                // Re-runnable thunk (fresh batch each attempt) so a stale-claim manager's bulk delete
                // self-heals once via writeWithClaimRetry rather than erroring.
                await writeWithClaimRetry(async () => {
                    const batch = writeBatch(db);
                    ids.forEach(id => batch.delete(doc(db, COLLECTIONS.overrides, id)));
                    await batch.commit();
                });
                removeFromCache(ids);
                renderTable();
                _onAfterSave();
                // Preserve unsaved staged week-grid edits across a bulk delete (v16.82) — see _handleDelete.
                if (fieldMember?.value && fieldDate?.value && !_hasStagedEdits()) renderWeekGrid();
                if (listFeedback) {
                    setStatus(listFeedback, `✓ Deleted ${ids.length} saved change${ids.length !== 1 ? 's' : ''}`);
                    listFeedback.className = 'list-feedback success';
                    setTimeout(() => { listFeedback.className = 'list-feedback'; }, 6000);
                }
            } catch (err) {
                console.error('[Admin] Bulk delete failed:', err);
                if (listFeedback) {
                    setStatus(listFeedback, (/** @type {any} */ (err))?.code === 'unavailable'
                        ? '⚠ You appear to be offline — reconnect and try again.'
                        : '⚠ Bulk delete failed — check your connection and try again.');
                    listFeedback.className = 'list-feedback error';
                }
            } finally {
                // RESTORE THE LABEL ON EVERY PATH, NOT JUST THE FAILING ONE (v21.94).
                //
                // The success path restored neither, and nothing else in the app writes this
                // button's `disabled` or `textContent` — `renderTable()` and
                // `_updateBulkDeleteVisibility()` only touch `style.display`. So one successful
                // bulk delete left it disabled reading “Deleting 3…” for the rest of the page
                // life, and ticking more rows re-SHOWED it in that dead state. Worse when the
                // delete emptied the view: `renderTable()` returns from its `!rows.length` branch
                // BEFORE the line that hides the button, so the dead control sat above an empty list.
                //
                // The single-row Delete has the same shape and is fine only because `renderTable()`
                // rebuilds `#overrideTableBody` and destroys that node. This button lives OUTSIDE
                // the table body, so it survives — and that asymmetry is exactly what made this
                // invisible to inspection.
                //
                // Label only; VISIBILITY stays with `_updateBulkDeleteVisibility`, which is the
                // pattern `executeSave` and `createRangeBookingSection` already follow.
                bulkDeleteBtn.disabled = false;
                bulkDeleteBtn.textContent = 'Delete selected';
            }
        });
    }

    if (overridesMonthFilter) {
        overridesMonthFilter.addEventListener('change', renderTable);
    }

    document.getElementById('showAllOverridesBtn')?.addEventListener('click', () => {
        if (!(_currentIsAdmin || _currentIsManager)) return;  // defence-in-depth: self-service can't view all staff
        _tableShowAllOverrides = !_tableShowAllOverrides;
        // TURNING IT ON IS A DIFFERENT QUESTION, SO IT MAY NEED A DIFFERENT READ (v21.38). The cache
        // holds whichever members have been selected; rendering "All staff" from that would list a
        // handful of people and call it everybody — a short list that looks complete, which is the
        // failure the query-cap banner exists to prevent one level up. Fetch the collection first.
        // Turning it OFF needs nothing: the member's slice is already covered.
        if (_tableShowAllOverrides && !coversAllStaff()) {
            loadOverrides({ everyone: true });   // renders on completion, and shows its own retry on failure
            return;
        }
        renderTable();
    });
}

