/**
 * admin-overrides.js — Change a Shift section of the admin portal.
 *
 * Owns: allOverrides cache, week grid render, bulk bar, save/delete to Firestore,
 *   Saved Changes table, shift rule validation, time input auto-format.
 * Does NOT own: login, AL booking, sick days, cultural calendar, notifications.
 * Edit here for: grid rendering, override CRUD, bulk bar, validation rules.
 * Do not edit here for: AL/sick booking flows, auth, roster upload.
 *
 * Extracted from admin-app.js. Initialised by admin-app.js via initOverrides().
 */

import { teamMembers, getBaseShift, formatISO, getShiftBadge, getSpecialDayBadges,
         isSunday, DAY_NAMES, MONTH_ABB, escapeHtml } from './roster-data.js?v=8.66';
import { db, collection, query, orderBy, limit, getDocs,
         deleteDoc, doc, serverTimestamp, writeBatch } from './firebase-client.js?v=8.66';

// ── TYPES ────────────────────────────────────────────────────────────────────
export const TYPES = {
    spare_shift:  { label: 'Spare shift',      fixed: true,  fixedValue: 'SPARE' },
    shift:        { label: 'Shift',            fixed: false },
    rdw:          { label: 'Rest Day Worked',  fixed: false },
    annual_leave: { label: 'Annual Leave',     fixed: true,  fixedValue: 'AL' },
    correction:   { label: 'Set as Rest Day',  fixed: true,  fixedValue: 'RD' },
    sick:         { label: 'Absent',           fixed: true,  fixedValue: 'SICK' },
    // Legacy types — no pill buttons; kept so old Saved Changes records display correctly
    allocated:    { label: 'Allocated shift',  fixed: false },
    overtime:     { label: 'Overtime',         fixed: false },
    swap:         { label: 'Swap',             fixed: false },
};

// ── PRIVATE STATE ─────────────────────────────────────────────────────────────
let _allOverrides   = [];
let _bulkActiveType = '';
let _currentUser      = '';
let _currentIsAdmin   = false;
let _showSuccess      = () => {};
let _showError        = () => {};
let _onAfterSave      = () => {};  // refresh AL/sick banners after any write
let _markChanged      = () => {};
let _onEditRow        = () => {};  // handleEdit lives in admin-app.js; passed as callback

// ── PUBLIC STATE ACCESSORS ────────────────────────────────────────────────────
export function getAllOverrides()    { return _allOverrides; }
export function setAllOverrides(arr) { _allOverrides = arr; }

// ── INIT ──────────────────────────────────────────────────────────────────────
/**
 * Wire up all event listeners for the Change a Shift section.
 * Must be called once from admin-app.js after the DOM is ready.
 *
 * @param {object} opts
 * @param {string}   opts.currentUser       Logged-in member name (written to changedBy on saves)
 * @param {boolean}  opts.currentIsAdmin    Whether the user has admin rights
 * @param {Function} opts.showSuccess       Show a success message in the week editor
 * @param {Function} opts.showError         Show an error message in the week editor
 * @param {Function} opts.onAfterSave       Called after any write; refreshes AL/sick banners
 * @param {Function} opts.markChanged       Marks the week grid as having unsaved changes
 * @param {Function} opts.onEditRow         handleEdit from admin-app.js — jumps to edit an override
 */
export function initOverrides({ currentUser, currentIsAdmin, showSuccess, showError,
                                 onAfterSave, markChanged, onEditRow }) {
    _currentUser    = currentUser;
    _currentIsAdmin = currentIsAdmin;
    _showSuccess    = showSuccess;
    _showError      = showError;
    _onAfterSave    = onAfterSave;
    _markChanged    = markChanged;
    _onEditRow      = onEditRow;

    _initBulkBar();
    _initOverridesTable();
    _initTimeInputs();
}

// ── WEEK GRID ─────────────────────────────────────────────────────────────────
/**
 * Updates the week nav label to show the Sun–Sat range containing dateStr,
 * and highlights it when it is the current week.
 * @param {string} dateStr  YYYY-MM-DD
 */
export function updateWeekNavLabel(dateStr) {
    if (!dateStr) return;
    const picked   = new Date(dateStr + 'T12:00:00');
    const sunday   = new Date(picked);
    sunday.setDate(picked.getDate() - picked.getDay());
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    const label = document.getElementById('weekNavLabel');
    if (label) {
        label.textContent =
            `${sunday.getDate()} ${MONTH_ABB[sunday.getMonth()]} – ${saturday.getDate()} ${MONTH_ABB[saturday.getMonth()]} ${saturday.getFullYear()}`;
        const todaySun = new Date();
        todaySun.setDate(todaySun.getDate() - todaySun.getDay());
        label.classList.toggle('is-current-week', sunday.toDateString() === todaySun.toDateString());
    }
}

/**
 * Builds a 7-day week grid into container for the week containing dateStr.
 * Reads fieldMember.value and _allOverrides; has no side-effects on other state.
 * Used by renderWeekGrid and by the swipe carousel (adjacent panel pre-build).
 * @param {HTMLElement} container
 * @param {string}      dateStr  YYYY-MM-DD
 */
export function buildWeekGridInto(container, dateStr) {
    const fieldMember = document.getElementById('fieldMember');
    const shiftNote   = document.getElementById('shiftNote');
    const memberName  = fieldMember?.value;
    const member      = teamMembers.find(m => m.name === memberName);
    if (!member || !memberName || !dateStr) return;

    const picked = new Date(dateStr + 'T12:00:00');
    const sunday = new Date(picked);
    sunday.setDate(picked.getDate() - picked.getDay());

    const header = document.createElement('div');
    header.className = 'week-grid-header';
    header.innerHTML = `
        <div class="hdr-check"></div>
        <div class="hdr-day">Day</div>
        <div class="hdr-base">Base roster</div>
        <div class="hdr-pills">Change to</div>
        <div class="hdr-time">Shift time</div>`;
    container.appendChild(header);

    const faithCalendar = document.querySelector('input[name="faithCalendar"]:checked')?.value || 'none';

    for (let i = 0; i < 7; i++) {
        const date    = new Date(sunday);
        date.setDate(sunday.getDate() + i);
        const dateISO = formatISO(date);
        const baseShift = getBaseShift(member, date);

        const badges    = getSpecialDayBadges(date, dateISO, faithCalendar);
        const badgeHTML = badges.map(b => `<span class="day-badge" title="${b.title}">${b.icon}</span>`).join('');

        const existing = _allOverrides.find(o => o.memberName === memberName && o.date === dateISO);

        const row = document.createElement('div');
        const isToday = dateISO === formatISO(new Date());
        row.className   = 'day-row' + (existing ? ' has-override' : '') + (isToday ? ' today' : '');
        row.dataset.date = dateISO;
        if (existing) row.dataset.existingId = existing.id;

        row.innerHTML = `
            <div class="col-check">
                <input type="checkbox" class="day-cb" aria-label="${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_ABB[date.getMonth()]}">
            </div>
            <div class="col-day">
                <span class="day-name">${DAY_NAMES[date.getDay()]}</span>
                <span class="day-date">${date.getDate()} ${MONTH_ABB[date.getMonth()]}${badgeHTML}${existing ? ' <span class="overwrite-badge">⚠ Saved</span>' : ''}</span>
            </div>
            <div class="col-base">${getShiftBadge(baseShift)}</div>
            <div class="col-pills">
                <button class="type-pill-btn pill-annual_leave" data-type="annual_leave">AL</button>
                <button class="type-pill-btn pill-spare_shift"  data-type="spare_shift">Spare</button>
                <button class="type-pill-btn pill-shift"        data-type="shift">Shift</button>
                <button class="type-pill-btn pill-rdw"          data-type="rdw">RDW</button>
                <button class="type-pill-btn pill-sick"         data-type="sick">Absent</button>
                <button class="type-pill-btn pill-correction"   data-type="correction">Rest Day</button>
            </div>
            <div class="col-time">
                <input type="text" class="time-input day-start" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" title="24-hour start time, e.g. 06:20">
                <span class="time-sep">–</span>
                <input type="text" class="time-input day-end" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" title="24-hour end time, e.g. 14:20">
                <span class="time-note">No time needed</span>
                <span class="time-hint">24h · max 12 hrs</span>
                <span class="time-error-msg">Use HH:MM format (e.g. 07:00)</span>
            </div>`;

        container.appendChild(row);

        // Sundays are uncontracted — disable the AL pill
        if (date.getDay() === 0) {
            const alPill = row.querySelector('.pill-annual_leave');
            if (alPill) {
                alPill.disabled = true;
                alPill.title    = 'Annual leave cannot be recorded on a Sunday — Sundays are not contracted days';
            }
        }

        const checkbox = row.querySelector('.day-cb');
        const pills    = row.querySelectorAll('.type-pill-btn');
        const startEl  = row.querySelector('.day-start');
        const endEl    = row.querySelector('.day-end');

        // Pre-fill with existing override — mark as prefilled so Save button stays disabled until user edits
        if (existing) {
            const legacyToShift = { overtime: 'shift', swap: 'shift', allocated: 'shift' };
            const prefillType   = legacyToShift[existing.type] ?? existing.type;
            const typeMeta      = TYPES[prefillType];
            _activateRow(row, checkbox, pills, startEl, endEl, prefillType);
            row.classList.add('prefilled-existing');
            if (typeMeta && !typeMeta.fixed && existing.value && existing.value.includes('-')) {
                const [s, e] = existing.value.split('-');
                startEl.value = s;
                endEl.value   = e;
            }
            if (existing.note && shiftNote) shiftNote.value = existing.note;
        }

        pills.forEach(pill => {
            pill.addEventListener('click', () => {
                const type    = pill.dataset.type;
                const already = pill.classList.contains('active');
                row.classList.remove('prefilled-existing');
                if (already) {
                    _deactivateRow(row, checkbox, pills, startEl, endEl);
                } else {
                    _activateRow(row, checkbox, pills, startEl, endEl, type);
                    if (!TYPES[type]?.fixed) startEl.focus();
                }
                _markChanged();
                updateSaveBtn();
            });
        });

        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                row.classList.remove('prefilled-existing');
                _deactivateRow(row, checkbox, pills, startEl, endEl);
            }
            _markChanged();
            updateSaveBtn();
            _updateBulkSelCount();
        });

        startEl.addEventListener('change', () => { row.classList.remove('prefilled-existing'); _markChanged(); updateSaveBtn(); });
        endEl.addEventListener('change',   () => { row.classList.remove('prefilled-existing'); _markChanged(); updateSaveBtn(); });
    }
}

/**
 * Re-renders the full week grid for the currently selected member and date.
 * Resets unsaved-changes state, shows the bulk bar, and refreshes the Save button.
 */
export function renderWeekGrid() {
    const fieldMember = document.getElementById('fieldMember');
    const fieldDate   = document.getElementById('fieldDate');
    const weekGrid    = document.getElementById('weekGrid');
    const bulkBar     = document.getElementById('bulkBar');
    const saveBtn     = document.getElementById('saveBtn');
    const shiftNote   = document.getElementById('shiftNote');
    const memberName  = fieldMember?.value;
    const dateStr     = fieldDate?.value;

    updateWeekNavLabel(dateStr);

    if (!memberName || !dateStr) {
        if (weekGrid) weekGrid.innerHTML = `<div class="week-empty">${_currentIsAdmin ? 'Select a staff member and date above to load the week.' : 'Select a date above to load the week.'}</div>`;
        if (bulkBar)  bulkBar.style.display = 'none';
        if (saveBtn)  saveBtn.disabled = true;
        if (shiftNote) shiftNote.value = '';
        return;
    }

    if (weekGrid) weekGrid.innerHTML = '';
    if (shiftNote) shiftNote.value = '';

    if (!teamMembers.find(m => m.name === memberName)) {
        if (bulkBar) bulkBar.style.display = 'none';
        if (saveBtn) saveBtn.disabled = true;
        return;
    }

    const panel = document.createElement('div');
    panel.className = 'week-panel';
    buildWeekGridInto(panel, dateStr);
    if (weekGrid) weekGrid.appendChild(panel);
    if (bulkBar)  bulkBar.style.display = 'block';
    resetBulkPills();
    updateSaveBtn();
    _updateBulkSelCount();
}

function _activateRow(row, checkbox, pills, startEl, endEl, type) {
    checkbox.checked = true;
    row.classList.add('active');
    row.classList.remove('selected');
    pills.forEach(p => p.classList.toggle('active', p.dataset.type === type));
    if (TYPES[type]?.fixed) {
        row.classList.add('fixed-type');
        startEl.tabIndex = endEl.tabIndex = -1;
    } else {
        row.classList.remove('fixed-type');
        startEl.tabIndex = endEl.tabIndex = 0;
    }
    row.dataset.type = type;
    const badge = row.querySelector('.overwrite-badge');
    if (badge) badge.textContent = '⚠ Updating';
}

function _deactivateRow(row, checkbox, pills, startEl, endEl) {
    checkbox.checked = false;
    row.classList.remove('active', 'fixed-type', 'selected', 'row-error');
    pills.forEach(p => p.classList.remove('active'));
    startEl.value = endEl.value = '';
    startEl.classList.remove('input-error');
    endEl.classList.remove('input-error');
    startEl.tabIndex = endEl.tabIndex = -1;
    delete row.dataset.type;
    const badge = row.querySelector('.overwrite-badge');
    if (badge) badge.textContent = '⚠ Saved';
}

export function updateSaveBtn() {
    const weekGrid = document.getElementById('weekGrid');
    const saveBtn  = document.getElementById('saveBtn');
    if (!weekGrid || !saveBtn) return;
    const rows       = [...weekGrid.querySelectorAll('.day-row')];
    const saveCount  = rows.filter(r => r.dataset.type && !r.classList.contains('prefilled-existing')).length;
    const delCount   = rows.filter(r => !r.dataset.type && r.dataset.existingId).length;
    const total = saveCount + delCount;
    saveBtn.disabled = total === 0;
    const hint = document.getElementById('saveBtnHint');
    if (hint) {
        if (total > 0) {
            const parts = [];
            if (saveCount) parts.push(`${saveCount} day${saveCount > 1 ? 's' : ''} to save`);
            if (delCount)  parts.push(`${delCount} override${delCount > 1 ? 's' : ''} to remove`);
            hint.textContent = `Ready — ${parts.join(', ')}`;
        } else {
            hint.textContent = 'Select a type on at least one day, then tap Save changes';
        }
    }
}

function _updateBulkSelCount() {
    const weekGrid = document.getElementById('weekGrid');
    const el = document.getElementById('bulkSelCount');
    if (!el || !weekGrid) return;
    const n = weekGrid.querySelectorAll('.day-cb:checked').length;
    el.textContent = n > 0 ? `${n} day${n > 1 ? 's' : ''} selected` : '';
}

// ── BULK BAR ──────────────────────────────────────────────────────────────────
/** Clears the active bulk-bar type pill, hides the time inputs, and resets values. */
export function resetBulkPills() {
    _bulkActiveType = '';
    const bulkTypePills = document.getElementById('bulkTypePills');
    const bulkTimeGroup = document.getElementById('bulkTimeGroup');
    const bulkStart     = document.getElementById('bulkStart');
    const bulkEnd       = document.getElementById('bulkEnd');
    if (bulkTypePills) bulkTypePills.querySelectorAll('.type-pill-btn').forEach(p => p.classList.remove('active'));
    if (bulkTimeGroup) bulkTimeGroup.style.display = 'none';
    if (bulkStart) bulkStart.value = '';
    if (bulkEnd)   bulkEnd.value   = '';
}

function _initBulkBar() {
    const bulkTypePills = document.getElementById('bulkTypePills');
    const bulkTimeGroup = document.getElementById('bulkTimeGroup');
    const bulkStart     = document.getElementById('bulkStart');
    const bulkEnd       = document.getElementById('bulkEnd');
    const bulkApplyBtn  = document.getElementById('bulkApplyBtn');
    const weekGrid      = document.getElementById('weekGrid');

    if (bulkTypePills) {
        bulkTypePills.querySelectorAll('.type-pill-btn').forEach(pill => {
            pill.addEventListener('click', () => {
                const type    = pill.dataset.type;
                const already = pill.classList.contains('active');
                if (already) { resetBulkPills(); return; }
                bulkTypePills.querySelectorAll('.type-pill-btn').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                _bulkActiveType = type;
                if (bulkTimeGroup) bulkTimeGroup.style.display = (TYPES[type] && !TYPES[type].fixed) ? 'flex' : 'none';
                if (bulkStart) bulkStart.value = '';
                if (bulkEnd)   bulkEnd.value   = '';
            });
        });
    }

    document.getElementById('bulkSelMonFri')?.addEventListener('click', () => {
        weekGrid?.querySelectorAll('.day-row').forEach(row => {
            const dayIdx   = new Date(row.dataset.date + 'T12:00:00').getDay();
            const checkbox = row.querySelector('.day-cb');
            if (!checkbox) return;
            if (dayIdx >= 1 && dayIdx <= 5) {
                checkbox.checked = true;
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                _deactivateRow(row, checkbox, row.querySelectorAll('.type-pill-btn'),
                    row.querySelector('.day-start'), row.querySelector('.day-end'));
            }
        });
        updateSaveBtn(); _updateBulkSelCount();
    });

    document.getElementById('bulkSelWorking')?.addEventListener('click', () => {
        const memberName = document.getElementById('fieldMember')?.value;
        const member = memberName ? teamMembers.find(m => m.name === memberName) : null;
        weekGrid?.querySelectorAll('.day-row').forEach(row => {
            const date     = new Date(row.dataset.date + 'T12:00:00');
            const checkbox = row.querySelector('.day-cb');
            if (!checkbox) return;
            const base  = member ? getBaseShift(member, date) : 'RD';
            const works = base !== 'RD' && base !== 'OFF';
            if (works) {
                checkbox.checked = true;
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                _deactivateRow(row, checkbox, row.querySelectorAll('.type-pill-btn'),
                    row.querySelector('.day-start'), row.querySelector('.day-end'));
            }
        });
        updateSaveBtn(); _updateBulkSelCount();
    });

    document.getElementById('bulkSelAll')?.addEventListener('click', () => {
        weekGrid?.querySelectorAll('.day-row').forEach(row => {
            const checkbox = row.querySelector('.day-cb');
            if (!checkbox) return;
            checkbox.checked = true;
            if (!row.dataset.type) row.classList.add('selected');
        });
        updateSaveBtn(); _updateBulkSelCount();
    });

    bulkApplyBtn?.addEventListener('click', () => {
        if (!_bulkActiveType) { _showError('Choose a type in step 2 first, then tap Apply.'); return; }
        const typeMeta = TYPES[_bulkActiveType];
        weekGrid?.querySelectorAll('.day-row').forEach(row => {
            const checkbox = row.querySelector('.day-cb');
            if (!checkbox || !checkbox.checked) return;
            const pills   = row.querySelectorAll('.type-pill-btn');
            const startEl = row.querySelector('.day-start');
            const endEl   = row.querySelector('.day-end');
            _activateRow(row, checkbox, pills, startEl, endEl, _bulkActiveType);
            if (typeMeta && !typeMeta.fixed) {
                if (bulkStart?.value) startEl.value = bulkStart.value;
                if (bulkEnd?.value)   endEl.value   = bulkEnd.value;
            }
        });
        _markChanged();
        updateSaveBtn();
        _updateBulkSelCount();
    });
}

// ── SAVE ──────────────────────────────────────────────────────────────────────
/**
 * Writes a batch of override changes to Firestore and updates the in-memory cache.
 * Disables the Save button while running; re-enables in the finally block.
 * @param {Array<{memberName,date,type,value,note,existingId}>} toSave
 * @param {string[]} toDelete  Firestore document IDs to delete
 */
export async function executeSave(toSave, toDelete = []) {
    const fieldMember = document.getElementById('fieldMember');
    const fieldDate   = document.getElementById('fieldDate');
    const weekGrid    = document.getElementById('weekGrid');
    const saveBtn     = document.getElementById('saveBtn');
    const shiftNote   = document.getElementById('shiftNote');
    const memberName  = fieldMember?.value;
    const overwrites  = toSave.filter(e => e.existingId).length;
    const creates     = toSave.length - overwrites;
    const removes     = toDelete.length;
    const total       = toSave.length + removes;

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = `Saving ${total} change${total !== 1 ? 's' : ''}…`; }

    try {
        const batch   = writeBatch(db);
        const newDocs = [];

        toDelete.forEach(id => batch.delete(doc(db, 'overrides', id)));

        toSave.forEach(entry => {
            if (entry.existingId) batch.delete(doc(db, 'overrides', entry.existingId));
            const { existingId: _, ...data } = entry;
            const newRef = doc(collection(db, 'overrides'));
            batch.set(newRef, { ...data, source: 'manual', createdAt: serverTimestamp(), changedBy: _currentUser });
            newDocs.push({ id: newRef.id, ...data, createdAt: new Date() });
        });
        await batch.commit();

        const parts = [];
        if (creates    > 0) parts.push(`${creates} added`);
        if (overwrites > 0) parts.push(`${overwrites} updated`);
        if (removes    > 0) parts.push(`${removes} removed`);
        _showSuccess(`${parts.join(', ')} for ${memberName}`);
        if (shiftNote) shiftNote.value = '';

        // Reset checked rows in the grid
        weekGrid?.querySelectorAll('.day-row').forEach(row => {
            const checkbox = row.querySelector('.day-cb');
            const pills    = row.querySelectorAll('.type-pill-btn');
            const s        = row.querySelector('.day-start');
            const e        = row.querySelector('.day-end');
            if (checkbox) _deactivateRow(row, checkbox, pills, s, e);
        });

        // Update in-memory cache — no Firestore round-trip needed
        const removedIds = new Set([...toDelete, ...toSave.filter(e => e.existingId).map(e => e.existingId)]);
        _allOverrides = _allOverrides.filter(o => !removedIds.has(o.id));
        _allOverrides.push(...newDocs);
        _allOverrides.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        renderTable();
        _onAfterSave();
        if (fieldMember?.value && fieldDate?.value) renderWeekGrid();

    } catch (err) {
        console.error('[Admin] Save failed:', err);
        _showError(err.code === 'permission-denied'
            ? 'Permission denied — contact your admin to check Firestore rules.'
            : 'Could not save — check your connection and try again.');
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save changes'; }
        updateSaveBtn();
    }
}

// ── OVERRIDES LIST ────────────────────────────────────────────────────────────
/**
 * Loads all override documents from Firestore into _allOverrides,
 * then renders the table, week grid, and calls onAfterSave to refresh AL/sick banners.
 */
export async function loadOverrides() {
    const tableBody = document.getElementById('overrideTableBody');
    const listCount = document.getElementById('listCount');
    if (tableBody) tableBody.innerHTML = '<tr class="state-row"><td colspan="8"><span class="spinner"></span>Loading…</td></tr>';
    try {
        const snap = await getDocs(query(collection(db, 'overrides'), orderBy('date', 'desc'), limit(2000)));
        _allOverrides = [];
        snap.forEach(s => _allOverrides.push({ id: s.id, ...s.data() }));
        renderTable();
        const fieldMember = document.getElementById('fieldMember');
        const fieldDate   = document.getElementById('fieldDate');
        if (fieldMember?.value && fieldDate?.value) renderWeekGrid();
        _onAfterSave();
    } catch (err) {
        console.error('[Admin] Load failed:', err);
        if (tableBody) {
            tableBody.innerHTML = '<tr class="state-row"><td colspan="8">Couldn\'t load saved changes.<br><span class="reload-link" id="reloadLink">↻ Reload page</span></td></tr>';
            document.getElementById('reloadLink')?.addEventListener('click', () => location.reload());
        }
        if (listCount) listCount.textContent = 'Error';
    }
}

/**
 * Renders the Saved Changes table from _allOverrides.
 * Filtered by the currently selected member and the month/year dropdown.
 */
export function renderTable() {
    const fieldMember        = document.getElementById('fieldMember');
    const tableBody          = document.getElementById('overrideTableBody');
    const listCount          = document.getElementById('listCount');
    const overridesMonthFilter = document.getElementById('overridesMonthFilter');
    const selectAllOverrides = document.getElementById('selectAllOverrides');
    const bulkDeleteBtn      = document.getElementById('bulkDeleteBtn');
    const memberFilter       = fieldMember?.value;
    const memberRows         = memberFilter
        ? _allOverrides.filter(o => o.memberName === memberFilter)
        : _allOverrides;

    if (overridesMonthFilter) {
        const months = [...new Set(memberRows.map(o => (o.date || '').substring(0, 7)))]
            .filter(Boolean).sort((a, b) => b.localeCompare(a));
        const isFirstRender = !overridesMonthFilter.dataset.initialized;
        const today         = new Date();
        const currentMonth  = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
        const prevValue     = isFirstRender ? currentMonth : overridesMonthFilter.value;
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
    if (listCount) listCount.textContent = `${rows.length} saved change${rows.length !== 1 ? 's' : ''}`;

    if (!rows.length) {
        if (tableBody) tableBody.innerHTML = '<tr class="state-row"><td colspan="8">No saved changes.</td></tr>';
        return;
    }

    if (tableBody) tableBody.innerHTML = '';
    if (selectAllOverrides) selectAllOverrides.checked = false;
    if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'none';

    rows.forEach(o => {
        const typeMeta    = TYPES[o.type];
        const isLegacyType = ['allocated', 'overtime', 'swap'].includes(o.type);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" class="row-select" data-id="${o.id}" aria-label="Select ${escapeHtml(o.memberName)} ${o.date}"></td>
            <td style="white-space:nowrap;font-weight:600">${formatDisplay(o.date)}</td>
            <td>${escapeHtml(o.memberName)}</td>
            <td><span class="list-type-pill lpill-${o.type}">${typeMeta ? typeMeta.label : escapeHtml(o.type)}</span>${isLegacyType ? '<span class="legacy-pill">legacy</span>' : ''}</td>
            <td style="font-family:monospace;font-size:12px">${escapeHtml(o.value)}</td>
            <td style="color:var(--text-light);font-style:italic">${escapeHtml(o.note)}${o.source === 'roster_import' ? '<span class="source-pill">PDF upload</span>' : ''}</td>
            <td><button class="btn-edit" data-member="${escapeHtml(o.memberName)}" data-date="${o.date}" aria-label="Edit ${escapeHtml(o.memberName)} ${o.date}">Edit</button></td>
            <td><button class="btn-delete" data-id="${o.id}" aria-label="Delete ${escapeHtml(o.memberName)} ${o.date}">Delete</button></td>`;
        if (tableBody) tableBody.appendChild(tr);
    });

    tableBody?.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', _handleDelete));
    tableBody?.querySelectorAll('.btn-edit').forEach(btn => btn.addEventListener('click', _onEditRow));
    tableBody?.querySelectorAll('.row-select').forEach(cb => cb.addEventListener('change', _updateBulkDeleteVisibility));
}

function _updateBulkDeleteVisibility() {
    const tableBody          = document.getElementById('overrideTableBody');
    const bulkDeleteBtn      = document.getElementById('bulkDeleteBtn');
    const selectAllOverrides = document.getElementById('selectAllOverrides');
    const checkedCount = tableBody?.querySelectorAll('.row-select:checked').length ?? 0;
    if (bulkDeleteBtn) bulkDeleteBtn.style.display = checkedCount > 0 ? 'inline-block' : 'none';
    if (selectAllOverrides) {
        const total = tableBody?.querySelectorAll('.row-select').length ?? 0;
        selectAllOverrides.checked       = total > 0 && checkedCount === total;
        selectAllOverrides.indeterminate = checkedCount > 0 && checkedCount < total;
    }
}

async function _handleDelete(e) {
    const btn     = e.currentTarget;
    const listFeedback = document.getElementById('listFeedback');
    const fieldMember  = document.getElementById('fieldMember');
    const fieldDate    = document.getElementById('fieldDate');
    if (!btn.classList.contains('confirming')) {
        btn.classList.add('confirming');
        btn.textContent = '⚠ Delete?';
        setTimeout(() => { if (btn.classList.contains('confirming')) { btn.classList.remove('confirming'); btn.textContent = 'Delete'; } }, 5000);
        return;
    }
    const deleted = _allOverrides.find(o => o.id === btn.dataset.id);
    btn.disabled = true;
    btn.textContent = '…';
    try {
        await deleteDoc(doc(db, 'overrides', btn.dataset.id));
        _allOverrides = _allOverrides.filter(o => o.id !== btn.dataset.id);
        renderTable();
        _onAfterSave();
        if (fieldMember?.value && fieldDate?.value) renderWeekGrid();
        if (deleted && listFeedback) {
            const typeMeta = TYPES[deleted.type];
            listFeedback.textContent = `✓ Deleted: ${deleted.memberName} — ${formatDisplay(deleted.date)} (${typeMeta ? typeMeta.label : deleted.type})`;
            listFeedback.className = 'list-feedback success';
            setTimeout(() => { listFeedback.className = 'list-feedback'; }, 6000);
        }
    } catch (err) {
        console.error('[Admin] Delete failed:', err);
        btn.disabled = false;
        btn.classList.remove('confirming');
        btn.textContent = 'Delete';
        if (listFeedback) {
            listFeedback.textContent = err.code === 'unavailable'
                ? '⚠ You appear to be offline — reconnect and try again.'
                : '⚠ Could not delete — check your connection and try again.';
            listFeedback.className = 'list-feedback error';
        }
    }
}

function _initOverridesTable() {
    const selectAllOverrides = document.getElementById('selectAllOverrides');
    const bulkDeleteBtn      = document.getElementById('bulkDeleteBtn');
    const overridesMonthFilter = document.getElementById('overridesMonthFilter');
    const listFeedback       = document.getElementById('listFeedback');
    const fieldMember        = document.getElementById('fieldMember');
    const fieldDate          = document.getElementById('fieldDate');

    if (selectAllOverrides) {
        selectAllOverrides.addEventListener('change', () => {
            document.getElementById('overrideTableBody')?.querySelectorAll('.row-select')
                .forEach(cb => { cb.checked = selectAllOverrides.checked; });
            _updateBulkDeleteVisibility();
        });
    }

    if (bulkDeleteBtn) {
        bulkDeleteBtn.addEventListener('click', async () => {
            const checkedRows = [...(document.getElementById('overrideTableBody')?.querySelectorAll('.row-select:checked') ?? [])];
            if (!checkedRows.length) return;
            const ids = checkedRows.map(cb => cb.dataset.id);
            bulkDeleteBtn.disabled = true;
            bulkDeleteBtn.textContent = `Deleting ${ids.length}…`;
            try {
                const batch = writeBatch(db);
                ids.forEach(id => batch.delete(doc(db, 'overrides', id)));
                await batch.commit();
                _allOverrides = _allOverrides.filter(o => !ids.includes(o.id));
                renderTable();
                _onAfterSave();
                if (fieldMember?.value && fieldDate?.value) renderWeekGrid();
                if (listFeedback) {
                    listFeedback.textContent = `✓ Deleted ${ids.length} saved change${ids.length !== 1 ? 's' : ''}`;
                    listFeedback.className = 'list-feedback success';
                    setTimeout(() => { listFeedback.className = 'list-feedback'; }, 6000);
                }
            } catch (err) {
                console.error('[Admin] Bulk delete failed:', err);
                bulkDeleteBtn.disabled = false;
                bulkDeleteBtn.textContent = 'Delete selected';
                if (listFeedback) {
                    listFeedback.textContent = err.code === 'unavailable'
                        ? '⚠ You appear to be offline — reconnect and try again.'
                        : '⚠ Bulk delete failed — check your connection and try again.';
                    listFeedback.className = 'list-feedback error';
                }
            }
        });
    }

    if (overridesMonthFilter) {
        overridesMonthFilter.addEventListener('change', renderTable);
    }
}

// ── TIME INPUTS ───────────────────────────────────────────────────────────────
function _initTimeInputs() {
    // Typing 4 digits auto-inserts the colon: "0730" → "07:30"
    document.addEventListener('input', e => {
        if (!e.target.classList.contains('time-input')) return;
        const timeInput = e.target;
        timeInput.classList.remove('input-error');
        let raw = timeInput.value.replace(/[^0-9]/g, '').slice(0, 4);
        if (raw.length === 3 && parseInt(raw.slice(0, 2), 10) > 23) raw = '0' + raw;
        timeInput.value = raw.length >= 3 ? raw.slice(0, 2) + ':' + raw.slice(2) : raw;
        if (raw.length === 4) {
            if (timeInput.classList.contains('day-start')) {
                timeInput.closest('.day-row')?.querySelector('.day-end')?.focus();
            } else if (timeInput.id === 'bulkStart') {
                document.getElementById('bulkEnd')?.focus();
            }
        }
    });

    document.addEventListener('focusout', e => {
        if (!e.target.classList.contains('time-input')) return;
        const val = e.target.value.trim();
        if (!val) { e.target.classList.remove('input-error'); return; }
        e.target.classList.toggle('input-error', !/^([01]\d|2[0-3]):[0-5]\d$/.test(val));
    });
}

// ── SHIFT RULE HELPERS ────────────────────────────────────────────────────────
function _parseMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function _effectiveEndMins(startStr, endStr) {
    const s = _parseMinutes(startStr), e = _parseMinutes(endStr);
    return e >= s ? e : e + 24 * 60;
}

function _fmtHours(mins) {
    const h = mins / 60;
    return (Number.isInteger(h) ? h : h.toFixed(1)) + 'h';
}

/**
 * Returns the effective shift value for a member on a date, checking the
 * pending save batch first, then _allOverrides, then the base roster.
 * @param {string} memberName
 * @param {string} dateISO  YYYY-MM-DD
 * @param {Array}  batch    Pending toSave entries
 */
export function getEffectiveShift(memberName, dateISO, batch) {
    const inBatch = batch.find(e => e.date === dateISO);
    if (inBatch) return inBatch.value;
    const inOverrides = _allOverrides.find(o => o.memberName === memberName && o.date === dateISO);
    if (inOverrides) return inOverrides.value;
    const member = teamMembers.find(m => m.name === memberName);
    return member ? getBaseShift(member, new Date(dateISO + 'T12:00:00')) : 'RD';
}

/**
 * Validates max shift duration (12 h) and minimum rest gap (12 h) for toSave.
 * Marks failing rows with .row-error in the DOM.
 * @param {Array}  toSave
 * @param {string} memberName
 * @returns {string[]} Human-readable error strings (empty = valid)
 */
export function validateShiftRules(toSave, memberName) {
    const weekGrid   = document.getElementById('weekGrid');
    const ruleErrors = [];

    toSave.forEach(entry => {
        const { date, value, type } = entry;
        if (TYPES[type]?.fixed) return;
        if (!value || !value.includes('-')) return;

        const [startStr, endStr] = value.split('-');
        const startMins = _parseMinutes(startStr);
        const endMins   = _effectiveEndMins(startStr, endStr);

        const markRow = () => {
            weekGrid?.querySelector(`.day-row[data-date="${date}"]`)?.classList.add('row-error');
        };

        const duration = endMins - startMins;
        if (duration > 12 * 60) {
            markRow();
            ruleErrors.push(`${formatDisplay(date)}: shift is ${_fmtHours(duration)} — max is 12h`);
            return;
        }

        // Check rest gap against adjacent days
        [-1, 1].forEach(delta => {
            const adjDate = new Date(date + 'T12:00:00');
            adjDate.setDate(adjDate.getDate() + delta);
            const adjISO   = formatISO(adjDate);
            const adjShift = getEffectiveShift(memberName, adjISO, toSave);
            if (!adjShift || !adjShift.includes('-')) return;
            const [adjStart, adjEnd] = adjShift.split('-');
            if (delta === -1) {
                const prevEnd  = _effectiveEndMins(adjStart, adjEnd);
                const prevMins = _parseMinutes(adjStart);
                const gap = startMins + 24 * 60 - prevEnd;
                if (gap < 12 * 60) {
                    markRow();
                    ruleErrors.push(`${formatDisplay(date)}: only ${_fmtHours(gap)} rest after ${formatDisplay(adjISO)} shift — need 12h`);
                }
            } else {
                const nextStart = _parseMinutes(adjStart);
                const gap = nextStart + 24 * 60 - endMins;
                if (gap < 12 * 60) {
                    markRow();
                    ruleErrors.push(`${formatDisplay(date)}: only ${_fmtHours(gap)} rest before ${formatDisplay(adjISO)} shift — need 12h`);
                }
            }
        });
    });

    return ruleErrors;
}

// ── DATE DISPLAY ──────────────────────────────────────────────────────────────
/** Formats YYYY-MM-DD as "18 Mar 2026". Returns "—" for empty input. */
export function formatDisplay(str) {
    if (!str) return '—';
    const [y, m, d] = str.split('-');
    return `${parseInt(d, 10)} ${MONTH_ABB[parseInt(m, 10) - 1]} ${y}`;
}
