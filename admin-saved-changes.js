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
 * reason the check is here rather than at the toggle. The same holds for ONE member: an empty list
 * for a member whose records were never read is "loading" or "couldn't load", not "no changes".
 *
 * The renderers and permissions arrive through `initSavedChanges` rather than being imported, which
 * is what keeps this out of a cycle with the coordinator that wires it.
 */

import { escapeHtml } from './roster-data.js';
import { auth, writeWithClaimRetry } from './firebase-client.js';

const BULK_DELETE_CHUNK = 200;   // per transaction — under Firestore's 500, as the range booking
import { TYPES, rowValueText } from './admin-shift-types.js';
import { getAllOverrides, removeFromCache, isTruncated, coversAllStaff, OVERRIDES_QUERY_CAP, loadOverrides, withManualDuplicates,
         asShown, deleteIfUnchanged, deleteChunks, staleDeleteVerdict, DELETE_REFUSED, hasOverrideAuthorityFor, loadFailedFor } from './admin-override-store.js';
import { setStatus } from './status-text.js';
import { unconfirmedWriteLine, isAccessFailure } from './claim-retry.js';
import { withSlowSaveNotice } from './slow-save.js';
// The two-tap ✕ and the feedback line's fade, shared with the Recorded-dates lists (their header says why).
import { armConfirm, disarmConfirm, holdFeedback, fadeFeedback } from './admin-booked-periods.js';

/** The receipt's account of a duplicate cleared alongside (v24.48): said, never silent. @param {number} n */
const _olderCopies = (n) => n > 0 ? `, and ${n} older cop${n === 1 ? 'y' : 'ies'} of the same day` : '';
/** Newest first, then by name — the order every write path left the cache in, so the list no longer
 *  depends on which path last touched it: a member's read returns Firestore's id order (whole-app
 *  check, 10 Nov 2026). @param {any} a @param {any} b */
const _newestFirst = (a, b) => (b.date || '').localeCompare(a.date || '')
    || (a.memberName || '').localeCompare(b.memberName || '') || String(a.id).localeCompare(String(b.id));
/** What to do about a failed delete, said for where the fix is: a refused write is not a poor signal,
 *  and blaming the connection "sends them to fix the one thing that is not wrong" (claim-retry.js). */
const _cause = (/** @type {any} */ err) => isAccessFailure(err)
    ? 'you may have been signed out. Please sign in again.' : 'check your connection and try again.';
/** Why a bulk delete stopped part done when a later chunk found a row changed since the list loaded. */
const PART_REFUSED = 'someone else has changed one of them since your list loaded. Reload the page to see the latest.';
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

/** Clears the "show all staff" toggle and re-renders the table. Call when the selected member changes.
 *  A new member is a new list, so the month filter starts again from the role's default: applied on the
 *  first render only, one member with nothing this month left every later one on "All months". */
export function resetTableMemberFilter() {
    _tableShowAllOverrides = false;
    const filter = document.getElementById('overridesMonthFilter');
    if (filter) delete filter.dataset.initialized;
    renderTable();
}

/** Whether the list is showing every member rather than the selected one. */
let _tableShowAllOverrides = false;

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
    const bulkDeleteBtn      = /** @type {HTMLButtonElement|null} */ (document.getElementById('bulkDeleteBtn'));
    const countChip          = document.getElementById('overridesCountChip');
    const selectedMember     = fieldMember?.value;
    // THE TOOLBAR STARTS AGAIN WITH THE ROWS (whole-app check, 10 Nov 2026). Every row is rebuilt, so
    // nothing is ticked: before either exit below, or an emptied list kept a live "Delete selected"
    // and a ticked "Select all", and a partial selection kept "Select all" at its dash.
    if (selectAllOverrides) { selectAllOverrides.checked = false; selectAllOverrides.indeterminate = false; }
    if (bulkDeleteBtn) { bulkDeleteBtn.style.display = 'none'; if (bulkDeleteBtn.classList.contains('confirming')) disarmConfirm(bulkDeleteBtn, 'Delete selected'); }
    // THE ALL-STAFF VIEW ASKS A DIFFERENT QUESTION, SO IT ASKS IT HERE TOO (v21.38, review): the toggle
    // only STARTS a load, and a failed or running one leaves the flag over a per-member cache — three
    // rows labelled "(all staff)" (header). `coversAllStaff()` is the LIST's question;
    // `hasOverrideAuthorityFor` is every WRITE's.
    const showAll            = _tableShowAllOverrides && coversAllStaff();
    // One member on screen → their name is stated once, at the top, not on every row (v23.12). add/remove,
    // not toggle(force): the unit suite's fake DOM has no `toggle`, and a throw there aborted the render.
    const memberFilter       = showAll ? '' : (selectedMember || '');
    // Keyed on the FILTER, not on the toggle (v23.15 review): with no member selected and the
    // All-staff view off, the rows below are everyone's, and hiding the names on that list would
    // leave nothing to tell one row from the next.
    if (tableBody) { if (memberFilter) tableBody.classList.add('oc-single-member'); else tableBody.classList.remove('oc-single-member'); }
    const memberRows         = (memberFilter
        ? getAllOverrides().filter(o => o.memberName === memberFilter)
        : getAllOverrides()).slice().sort(_newestFirst);

    // Update "Show all / This member" toggle button
    const showAllBtn = document.getElementById('showAllOverridesBtn');
    if (showAllBtn) {
        // Only admin/manager may reveal every member's changes — a locked self-service user
        // always has their own name selected, so gating on selectedMember alone exposed the
        // "All staff" toggle to them, contradicting the card's "your own changes only" tip.
        showAllBtn.hidden = !selectedMember || !(_currentIsAdmin || _currentIsManager);
        showAllBtn.textContent = showAll ? 'This member only' : 'All staff';
    }

    // NOT READ IS NOT "NO CHANGES" (whole-app check, 10 Nov 2026). An unread member and one with nothing
    // recorded are the same empty slice; this said "No recorded changes yet" over a failed load (replacing
    // its Retry) or a running one. Before the month filter, which would take its default from nothing.
    // Rows a capped all-staff read left in the cache are still listed, under the cap note below.
    if (memberFilter && !showAll && !memberRows.length && !hasOverrideAuthorityFor(memberFilter)) {
        const failed = loadFailedFor(memberFilter);
        if (listCount) listCount.textContent = failed ? 'Error' : 'Loading…';
        if (countChip) countChip.textContent = '';
        if (tableBody) tableBody.innerHTML = failed
            ? `<div class="override-state">${globalThis.navigator?.onLine === false
                ? 'You\'re offline — saved changes can\'t be checked until you reconnect.' : 'Couldn\'t load saved changes.'}`
              + '<br><span class="reload-link" data-retry-member role="button" tabindex="0">↻ Retry</span></div>'
            : '<div role="status"><span class="visually-hidden">Loading saved changes…</span></div>'
              + '<div class="skeleton-row" aria-hidden="true"></div>'.repeat(3);
        return;
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
    // Header context chip (v18.16): the list's current count while the card is collapsed, empty at zero
    // (its :empty rule hides it). "+" when the load hit the query cap (v18.23, no-silent-caps): older
    // rows exist beyond ANY view then, so a bare number would read as exact.
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

    rows.forEach(o => {
        const typeMeta     = TYPES[o.type];
        const eid   = escapeHtml(o.id   || '');
        const edate = escapeHtml(o.date || '');
        const etype = escapeHtml(o.type || '');
        const ename = escapeHtml(o.memberName || '');
        const card = document.createElement('div');
        card.className = 'override-card';
        // The shown date is escaped too: the rules pin `date`, but an Admin-SDK write passes no rule.
        card.innerHTML = `
            <input type="checkbox" class="row-select" data-id="${eid}" aria-label="Select ${ename} ${edate}">
            <div class="oc-body">
                <div class="oc-head"><span class="oc-date">${escapeHtml(formatDisplay(o.date))}</span><span class="oc-member">${ename}</span></div>
                <div class="oc-detail"><span class="list-type-pill lpill-${etype}">${typeMeta ? typeMeta.label : etype}</span>${o.source === 'roster_import' ? '<span class="source-pill">PDF upload</span>' : ''}${rowValueText(etype, o.value) ? `<span class="oc-value">${escapeHtml(rowValueText(etype, o.value))}</span>` : ''}</div>
            </div>
            <div class="oc-actions">
                <button type="button" class="btn-edit" data-member="${ename}" data-date="${edate}" aria-label="Edit ${ename} ${edate}">✎</button>
                <button type="button" class="btn-delete" data-id="${eid}" aria-label="Delete ${ename} ${edate}">✕</button>
            </div>`;
        if (tableBody) tableBody.appendChild(card);
    });
    // Listeners are delegated once, in _initOverridesTable() — not 3 × N per render.
}

function _updateBulkDeleteVisibility() {
    const tableBody          = document.getElementById('overrideTableBody');
    const bulkDeleteBtn      = document.getElementById('bulkDeleteBtn');
    const selectAllOverrides = /** @type {HTMLInputElement|null} */ (document.getElementById('selectAllOverrides'));
    const checkedCount = tableBody?.querySelectorAll('.row-select:checked').length ?? 0;
    if (bulkDeleteBtn) { bulkDeleteBtn.style.display = checkedCount > 0 ? 'inline-block' : 'none'; if (bulkDeleteBtn.classList.contains('confirming')) disarmConfirm(bulkDeleteBtn, 'Delete selected'); }   // a changed selection disarms (v25.06)
    if (selectAllOverrides) {
        const total = tableBody?.querySelectorAll('.row-select').length ?? 0;
        selectAllOverrides.checked       = total > 0 && checkedCount === total;
        selectAllOverrides.indeterminate = checkedCount > 0 && checkedCount < total;
    }
}

/** Every write to `#listFeedback`: ONE fade per line, cancelled by each new message, so one delete's fade
 *  no longer takes down the next one's refusal. @param {string} text @param {'success'|'error'} kind @param {number} [fade] */
function _sayList(text, kind, fade = 0) {
    const el = document.getElementById('listFeedback');
    if (!el) return;
    holdFeedback(el);
    setStatus(el, text);
    el.className = `list-feedback ${kind}`;
    if (fade) fadeFeedback(el, 'list-feedback', fade);
}

/** A delete rebuilt the list under the focused control: hand focus to the ✕ now in its place, or to
 *  the line saying what happened — never to <body> (whole-app check, 10 Nov 2026). @param {number} pos */
function _refocusAfterDelete(pos) {
    const left = [...(document.getElementById('overrideTableBody')?.querySelectorAll('.btn-delete') ?? [])];
    /** @type {any} */ (left[Math.min(pos, left.length - 1)] ?? document.getElementById('listFeedback'))?.focus();
}

/** @param {MouseEvent} e */
async function _handleDelete(e) {
    // closest() makes this work both directly and via delegation.
    const btn     = /** @type {HTMLButtonElement|null} */ (/** @type {Element} */ (e.target).closest('.btn-delete'));
    if (!btn) return;
    if (!btn.classList.contains('confirming')) { armConfirm(btn, 'Delete?', '✕'); return; }
    // Signed out: say so, not "check your connection" — the write would be refused anyway (v24.38).
    if (!auth.currentUser) { disarmConfirm(btn, '✕'); _sayList("⚠ You've been signed out — please sign in again.", 'error'); return; }
    const deleted = getAllOverrides().find(o => o.id === btn.dataset.id);
    // The row AND any older manual copy of the same day (v24.48 duplicates — external review, Oct
    // 2026): deleting only the newer one let the older resurface as the day's value, which the week
    // editor's delete already prevented. One transaction, so the day is never left half-cleared.
    const ids = [...withManualDuplicates([btn.dataset.id ?? ''])];
    const shown = asShown(ids);   // as on screen at the press: what the transaction compares the server with (v25.89)
    const hadFocus = document.activeElement === btn;
    const pos = [...(document.getElementById('overrideTableBody')?.querySelectorAll('.btn-delete') ?? [])].indexOf(btn);
    btn.disabled = true;
    btn.textContent = '…';
    try {
        // Wrap in writeWithClaimRetry so a just-provisioned manager on a pre-`manager`-claim token
        // self-heals (force-refresh + retry once) instead of a hard permission-denied — parity with
        // the executeSave / recordRangeOverrides / bulk-delete write paths. Compared and deleted in ONE
        // transaction, so a colleague's edit cannot land between the two (v25.89, external review).
        await withSlowSaveNotice(writeWithClaimRetry(() => deleteIfUnchanged(shown)), { held: false });
        removeFromCache(ids);
        renderTable();
        _onAfterSave();
        // Don't rebuild the week grid over unsaved staged edits — deleting a Saved-Changes row is
        // unrelated to whatever the admin is mid-editing in the grid (v16.82). The delete is already
        // reflected in the table above; the grid refreshes next time it's rebuilt.
        const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
        const fieldDate   = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
        if (fieldMember?.value && fieldDate?.value && !_hasStagedEdits()) renderWeekGrid();
        if (deleted) {
            const typeMeta = TYPES[deleted.type];
            _sayList(`✓ Deleted: ${deleted.memberName} — ${formatDisplay(deleted.date)} (${typeMeta ? typeMeta.label : deleted.type})${_olderCopies(ids.length - 1)}`, 'success', 6000);
        }
        if (hadFocus) _refocusAfterDelete(pos);
    } catch (err) {
        console.error('[Admin] Delete failed:', err);
        btn.disabled = false;
        disarmConfirm(btn, '✕');
        if (hadFocus) btn.focus();
        _sayList((/** @type {any} */ (err))?.code === DELETE_REFUSED ? '⚠ ' + /** @type {any} */ (err).line
            : (/** @type {any} */ (err))?.code === 'unavailable'
            ? '⚠ You appear to be offline — reconnect and try again.'
            : unconfirmedWriteLine(err, 'this delete', 'Saved Changes') ? '⚠ ' + unconfirmedWriteLine(err, 'this delete', 'Saved Changes')
            : '⚠ Could not delete — ' + _cause(err), 'error');
    }
}

function _initOverridesTable() {
    const selectAllOverrides = /** @type {HTMLInputElement|null} */ (document.getElementById('selectAllOverrides'));
    const bulkDeleteBtn      = /** @type {HTMLButtonElement|null} */ (document.getElementById('bulkDeleteBtn'));
    const overridesMonthFilter = document.getElementById('overridesMonthFilter');
    const fieldMember        = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const fieldDate          = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));

    // Delegated listeners — one per event type on the whole table body, replaces
    // attaching N per-row listeners on every renderTable() call.
    const tableBody = document.getElementById('overrideTableBody');
    if (tableBody) {
        // The Retry `renderTable` draws for an unread member asks for THAT member, by name: a bare
        // `loadOverrides()` re-reads everybody once an All-staff read has been made.
        const retry = () => { loadOverrides({ everyone: false, member: fieldMember?.value ?? '' }); };
        tableBody.addEventListener('click', (e) => {
            const target = /** @type {Element} */ (e.target);
            if (target.closest('.btn-delete')) return _handleDelete(e);
            if (target.closest('.btn-edit'))   return _onEditRow(e);
            if (target.closest('[data-retry-member]')) retry();
        });
        tableBody.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && /** @type {Element} */ (e.target).closest('[data-retry-member]')) { e.preventDefault(); retry(); }
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
            const picked = checkedRows.map(cb => /** @type {HTMLElement} */ (cb).dataset.id ?? '');
            const chunks = deleteChunks(picked, BULK_DELETE_CHUNK), ids = chunks.flat();   // with their older copies, a day never split
            const shown = new Map(asShown(ids).map((r, i) => [ids[i], r]));

            // Two-tap confirm, ARMED FOR THIS SELECTION (v25.06): "⚠ Delete 1?" once deleted all three ticked by the 2nd tap.
            if (!bulkDeleteBtn.classList.contains('confirming') || bulkDeleteBtn.dataset.armedFor !== picked.join('|')) {
                bulkDeleteBtn.dataset.armedFor = picked.join('|');
                armConfirm(bulkDeleteBtn, `⚠ Delete ${picked.length}?`, 'Delete selected', `Confirm delete ${picked.length} selected change${picked.length !== 1 ? 's' : ''}`);
                return;
            }
            disarmConfirm(bulkDeleteBtn, 'Delete selected');   // name and class back before "Deleting…"
            if (!auth.currentUser) {   // as the single delete (v24.38)
                _sayList("⚠ You've been signed out — please sign in again.", 'error');
                return;
            }

            // Focus, if it was here, goes afterwards to what happened — or back here when nothing went.
            const hadFocus = document.activeElement === bulkDeleteBtn;
            /** @type {HTMLElement|null|undefined} */ let refocus;
            bulkDeleteBtn.disabled = true;
            bulkDeleteBtn.textContent = `Deleting ${picked.length}…`;
            /** @type {string[]} */
            const committed = []; let landed = 0;   // ids, and whole chunks, already deleted
            try {
                // Re-runnable thunk so a stale-claim manager's bulk delete self-heals once via
                // writeWithClaimRetry; a re-run resumes after the chunks already committed.
                // CHUNKED (Oct 2026): over 500 writes is refused. EACH CHUNK IS ONE TRANSACTION (v25.89), and
                // a list of several is first checked WHOLE, so what changed hours ago refuses it before any
                // chunk lands; only an edit racing the chunks themselves can leave it part done, said below.
                await withSlowSaveNotice(writeWithClaimRetry(async () => {
                    const stale = chunks.length > 1 && !landed ? await staleDeleteVerdict([...shown.values()]) : null;
                    if (stale) throw Object.assign(new Error(stale), { code: DELETE_REFUSED, line: stale });
                    for (const chunk of chunks.slice(landed)) {
                        await deleteIfUnchanged(chunk.map(id => shown.get(id)));
                        committed.push(...chunk); landed++;
                    }
                }), { batched: chunks.length > 1, held: false });
                removeFromCache(ids);
                renderTable();
                _onAfterSave();
                // Preserve unsaved staged week-grid edits across a bulk delete (v16.82) — see _handleDelete.
                if (fieldMember?.value && fieldDate?.value && !_hasStagedEdits()) renderWeekGrid();
                _sayList(`✓ Deleted ${picked.length} saved change${picked.length !== 1 ? 's' : ''}${_olderCopies(ids.length - picked.length)}`, 'success', 6000);
                refocus = document.getElementById('listFeedback');
            } catch (err) {
                console.error('[Admin] Bulk delete failed:', err);
                if (committed.length) { removeFromCache(committed); renderTable(); }
                const refused = /** @type {any} */ (err)?.code === DELETE_REFUSED, cause = refused ? PART_REFUSED : _cause(err);
                const unsure = unconfirmedWriteLine(err, 'this delete', 'Saved Changes');
                // AN UNKNOWN OUTCOME FIRST — the chunk in flight may still land, so nothing can be called "still
                // listed" — then PART DONE (v25.89, review): a refusal's own line says "nothing was deleted".
                _sayList(unsure ? '⚠ ' + unsure
                    : committed.length ? `⚠ Deleted ${picked.filter(id => committed.includes(id)).length} of ${picked.length} before it stopped — the rest are still listed. ${cause[0].toUpperCase()}${cause.slice(1)}`
                    : refused ? '⚠ ' + /** @type {any} */ (err).line
                    : (/** @type {any} */ (err))?.code === 'unavailable' ? '⚠ You appear to be offline — reconnect and try again.'
                    : '⚠ Bulk delete failed — ' + cause, 'error');
                refocus = committed.length ? document.getElementById('listFeedback') : bulkDeleteBtn;
            } finally {
                // RESTORE THE LABEL ON EVERY PATH, NOT JUST THE FAILING ONE (v21.94). Nothing else
                // writes this button's `disabled` or label, and unlike a row's ✕ it lives OUTSIDE the
                // table body, so no re-render replaces it: one successful bulk delete once left it
                // disabled reading "Deleting 3…" for the rest of the page life. Label only — VISIBILITY
                // is `renderTable`'s and `_updateBulkDeleteVisibility`'s.
                bulkDeleteBtn.disabled = false;
                disarmConfirm(bulkDeleteBtn, 'Delete selected');
            }
            if (hadFocus) refocus?.focus();
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
