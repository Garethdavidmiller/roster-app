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

import { teamMembers, getBaseShift, formatISO, getShiftBadge, getSpecialDayBadges,
         isSunday, DAY_NAMES, MONTH_ABB, escapeHtml } from './roster-data.js';
import { isRestShift, shouldReplaceOverride } from './override-utils.js';
import { db, collection, query, orderBy, limit, getDocs,
         deleteDoc, doc, serverTimestamp, writeBatch, auth, writeWithClaimRetry, COLLECTIONS } from './firebase-client.js';
import { sessionReady } from './session.js';
import { parseOtherValue, OTHER_FLAVOURS } from './override-utils.js';

// ── TYPES ────────────────────────────────────────────────────────────────────
/** @type {Record<string, any>} */
export const TYPES = {
    spare_shift:  { label: 'Spare shift',      pill: 'Spare',    fixed: true,  fixedValue: 'SPARE' },
    shift:        { label: 'Shift',            pill: 'Shift',    fixed: false },
    rdw:          { label: 'Rest Day Worked',  pill: 'RDW',      fixed: false },
    annual_leave: { label: 'Annual Leave',     pill: 'AL',       fixed: true,  fixedValue: 'AL' },
    correction:   { label: 'Set as Rest Day',  pill: 'Rest Day', fixed: true,  fixedValue: 'RD' },
    sick:         { label: 'Absent',           pill: 'Absent',   fixed: true,  fixedValue: 'SICK' },
    // Training / Induction / Assessment (OTHER_PLAN.md). NOT fixed — the time inputs show —
    // but times are OPTIONAL: blank is VALID (pay defaults apply: base shift on a rostered
    // day, 8h RDW on a training rest-day). Value is composed at save time from the row's
    // flavour buttons + RDW tick + optional times: FLAVOUR[" RDW"][" HH:MM-HH:MM"].
    // `timesOptional` is DESCRIPTIVE metadata — consumers branch on type === 'other'
    // explicitly (collector, validateShiftRules, prefill); keep it for the next such type.
    other:        { label: 'Other',            pill: 'Other',    fixed: false, timesOptional: true },
    // Legacy types — no pill buttons; kept so old Saved Changes records display correctly
    allocated:    { label: 'Allocated shift',  fixed: false },
    overtime:     { label: 'Overtime',         fixed: false },
    swap:         { label: 'Swap',             fixed: false },
};

/** Ordered list of type keys for the per-row and bulk-bar pill buttons (single source of truth).
 *  Order: AL · Spare · Shift · RDW · Absent · Rest Day — do not reorder; matches admin.html label order.
 */
export const PILL_TYPES = ['annual_leave', 'spare_shift', 'shift', 'rdw', 'sick', 'correction', 'other'];

// ── PRIVATE STATE ─────────────────────────────────────────────────────────────
/** @type {any[]} */
let _allOverrides   = [];
let _bulkActiveType = '';
let _currentUser      = '';
let _currentIsAdmin   = false;
/** @type {(msg: string) => void} */
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
let _tableShowAllOverrides = false;

// Re-entry guard for the time-input formatter: assigning to `value` inside an
// `input` listener triggers another `input` event on iOS Safari (but not on
// Android Chrome). Without this guard the handler reformats its own output.
let _formattingTime = false;

// ── PUBLIC STATE ACCESSORS ────────────────────────────────────────────────────
export function getAllOverrides()    { return _allOverrides; }
/** @param {any[]} arr */
export function setAllOverrides(arr) { _allOverrides = arr; }

/** Clears the "show all staff" toggle and re-renders the table. Call when the selected member changes. */
export function resetTableMemberFilter() {
    _tableShowAllOverrides = false;
    renderTable();
}

/** Returns a new Date set to the Sunday of the week containing dateStr. */
/** @param {string} dateStr */
function getSundayOfWeek(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() - d.getDay());
    return d;
}

/**
 * Builds a Map<dateISO, override> for a specific member from the override cache.
 * O(N+D) alternative to O(N×D) per-date lookups. Call once per render cycle.
 * @param {string} memberName
 * @returns {Map<string, any>}
 */
export function buildMemberDateMap(memberName) {
    const map = new Map();
    for (const o of _allOverrides) {
        if (o.memberName !== memberName) continue;
        const existing = map.get(o.date);
        if (!existing || shouldReplaceOverride(existing, o)) map.set(o.date, o);
    }
    return map;
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
 * @param {(msg: string) => void} opts.showSuccess  Show a success message in the week editor
 * @param {(msg: string) => void} opts.showError    Show an error message in the week editor
 * @param {() => void} opts.onAfterSave       Called after any write; refreshes AL/sick banners
 * @param {() => void} opts.markChanged       Marks the week grid as having unsaved changes
 * @param {(e: MouseEvent) => void} opts.onEditRow   handleEdit from admin-app.js - jumps to edit an override
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

    // Wire the delegated listeners ONCE. initOverrides can be called twice on the in-place login path
    // (an optimistic 'allow' init, then again from showAdminLogin's onSuccess after B1 clears an
    // unconfirmable session). The table/bulk-bar listeners are delegated on stable containers and read
    // module state (_currentUser etc.) at event time — which the re-assignment above keeps fresh — so
    // attaching them a second time would double-fire every click (e.g. a single Delete tap would arm
    // AND execute, bypassing the two-tap confirm). Identity still refreshes on every call; wiring does not.
    if (!_listenersWired) {
        _listenersWired = true;
        _initBulkBar();
        _initOverridesTable();
        _initTimeInputs();
    }
}

// ── WEEK GRID ─────────────────────────────────────────────────────────────────
/**
 * Updates the week nav label to show the Sun–Sat range containing dateStr,
 * and highlights it when it is the current week.
 * @param {string} dateStr  YYYY-MM-DD
 */
export function updateWeekNavLabel(dateStr) {
    if (!dateStr) return;
    const sunday   = getSundayOfWeek(dateStr);
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
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const memberName  = fieldMember?.value;
    const member      = teamMembers.find(m => m.name === memberName);
    if (!member || !memberName || !dateStr) return;

    const sunday = getSundayOfWeek(dateStr);

    const header = document.createElement('div');
    header.className = 'week-grid-header';
    header.innerHTML = `
        <div class="hdr-check"></div>
        <div class="hdr-day">Day</div>
        <div class="hdr-base">Base roster</div>
        <div class="hdr-pills">Record as</div>
        <div class="hdr-time">Shift time</div>`;
    container.appendChild(header);

    // Compute once for the whole 7-row loop instead of allocating a Date per row.
    const todayISO      = formatISO(new Date());
    // buildMemberDateMap applies shouldReplaceOverride() so manual beats roster_import
    // (bare .find() would return whichever arrived first in the array — wrong precedence).
    const memberDateMap = buildMemberDateMap(memberName);

    for (let i = 0; i < 7; i++) {
        const date    = new Date(sunday);
        date.setDate(sunday.getDate() + i);
        const dateISO = formatISO(date);
        const baseShift = getBaseShift(member, date);

        const badges    = getSpecialDayBadges(date, dateISO);
        const badgeHTML = badges.map(b => `<span class="day-badge" title="${b.title}">${b.icon}</span>`).join('');

        const existing = memberDateMap.get(dateISO);

        const row = document.createElement('div');
        const isToday = dateISO === todayISO;
        // Unique id linking each row's time inputs to their inline error message
        // (aria-describedby / aria-errormessage need a per-row target id).
        const timeErrId = `timeErr-${dateISO}`;
        row.className   = 'day-row' + (existing ? ' has-override' : '') + (isToday ? ' today' : '');
        row.dataset.date = dateISO;
        row.dataset.baseIsRd = isRestShift(baseShift) ? '1' : '';
        if (existing) row.dataset.existingId = existing.id;

        row.innerHTML = `
            <div class="col-check">
                <input type="checkbox" class="day-cb" aria-label="${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_ABB[date.getMonth()]}">
            </div>
            <div class="col-day">
                <span class="day-name">${DAY_NAMES[date.getDay()]}</span>
                <span class="day-date">${date.getDate()} ${MONTH_ABB[date.getMonth()]}${badgeHTML}${existing ? ` <span class="overwrite-badge">⚠ ${escapeHtml(existing.value === 'SICK' ? 'Absent' : existing.value === 'SPARE' ? 'Spare' : (existing.value || existing.type))}</span>` : ''}</span>
            </div>
            <div class="col-base">${getShiftBadge(baseShift)}</div>
            <div class="col-pills">
                ${PILL_TYPES.map(t => `<button class="type-pill-btn pill-${t}" data-type="${t}" aria-pressed="false">${TYPES[t].pill}</button>`).join('\n                ')}
            </div>
            <div class="col-time">
                <input type="text" class="time-input day-start" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" title="24-hour start time, e.g. 06:20" aria-label="Start time (HH:MM)" aria-describedby="${timeErrId}">
                <span class="time-sep">–</span>
                <input type="text" class="time-input day-end" inputmode="numeric" placeholder="HH:MM" maxlength="5" tabindex="-1" title="24-hour end time, e.g. 14:20" aria-label="End time (HH:MM)" aria-describedby="${timeErrId}">
                <span class="time-note">No time needed</span>
                <span class="time-hint">24h · max 12 hrs</span>
                <span class="time-error-msg" id="${timeErrId}" role="alert">Use HH:MM format (e.g. 07:00)</span>
            </div>
            <div class="col-rd-hint" hidden>Base roster: Rest Day — use <strong>RDW</strong> if this was overtime</div>
            <div class="other-opts" hidden>
                <span class="other-flavour-group" role="group" aria-label="Type of day">
                    ${Object.entries(OTHER_FLAVOURS).map(([k, f]) =>
                        `<button type="button" class="other-flavour-btn${k === 'TRG' ? ' active' : ''}" data-flavour="${k}" aria-pressed="${k === 'TRG'}">${f.full}</button>`
                    ).join('\n                    ')}
                </span>
                <label class="other-rdw-label"><input type="checkbox" class="other-rdw-cb"> Rest day (RDW)</label>
                <span class="other-rdw-warn" hidden>Originally rostered ${escapeHtml(baseShift)} this day — RDW pays it as rest-day working instead</span>
                <span class="other-opts-hint">Times optional — blank pays the default (base shift, or 8h RDW)</span>
            </div>`;

        container.appendChild(row);

        // Rule: see CLAUDE.md — "Sundays are non-contracted" (layer 1: disable pills in week grid)
        if (isSunday(dateISO)) {
            const alPill = /** @type {HTMLButtonElement|null} */ (row.querySelector('.pill-annual_leave'));
            if (alPill) {
                alPill.disabled = true;
                alPill.title    = 'Annual leave cannot be recorded on a Sunday — Sundays are not contracted days';
                // Disabled buttons drop out of the tab order, so `title` is not reliably
                // announced — put the reason in the accessible name so a screen reader
                // reading the row in browse mode hears why the pill is unavailable.
                alPill.setAttribute('aria-label', 'Annual Leave — unavailable on Sundays (not a contracted day)');
            }
            const sickPill = /** @type {HTMLButtonElement|null} */ (row.querySelector('.pill-sick'));
            if (sickPill) {
                sickPill.disabled = true;
                sickPill.title    = 'Absence cannot be recorded on a Sunday — Sundays are not contracted days';
                sickPill.setAttribute('aria-label', 'Absent — unavailable on Sundays (not a contracted day)');
            }
            const otherPill = /** @type {HTMLButtonElement|null} */ (row.querySelector('.pill-other'));
            if (otherPill) {
                otherPill.disabled = true;
                otherPill.title    = 'Other days (training, induction, assessment) cannot be recorded on a Sunday — Sundays are not contracted days';
                otherPill.setAttribute('aria-label', 'Other — unavailable on Sundays (not a contracted day)');
            }
        }

        const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
        const pills    = row.querySelectorAll('.type-pill-btn');
        const startEl  = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
        const endEl    = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));

        // Pre-fill with existing override — mark as prefilled so Save button stays disabled until user edits
        if (existing) {
            const legacyToShift = { overtime: 'shift', allocated: 'shift' };
            const prefillType   = (/** @type {Record<string, any>} */ (legacyToShift))[existing.type] ?? existing.type;
            const typeMeta      = TYPES[prefillType];
            _activateRow(row, checkbox, pills, startEl, endEl, prefillType);
            row.classList.add('prefilled-existing');
            const _exOther = existing.type === 'other' ? parseOtherValue(existing.value) : null;
            if (_exOther) {
                // Restore flavour + RDW tick + optional times from the stored grammar —
                // a naive value.split('-') would shred 'TRG RDW 08:00-16:00'.
                row.querySelectorAll('.other-flavour-btn').forEach(b => {
                    const on = (/** @type {HTMLElement} */ (b)).dataset.flavour === _exOther.flavour;
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                const _cb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
                if (_cb) _cb.checked = _exOther.rdw;
                _syncOtherRdwWarn(row);
                if (_exOther.time) {
                    const [s, e] = _exOther.time.split('-');
                    /** @type {HTMLInputElement} */ (startEl).value = s;
                    /** @type {HTMLInputElement} */ (endEl).value   = e;
                }
            } else if (typeMeta && !typeMeta.fixed && existing.value && existing.value.includes('-')) {
                const [s, e] = existing.value.split('-');
                /** @type {HTMLInputElement} */ (startEl).value = s;
                /** @type {HTMLInputElement} */ (endEl).value   = e;
            }
        }

        pills.forEach(pillEl => {
            const pill = /** @type {HTMLButtonElement} */ (pillEl);
            pill.addEventListener('click', () => {
                const type    = pill.dataset.type ?? '';
                const already = pill.classList.contains('active');
                row.classList.remove('prefilled-existing');
                if (already) {
                    _deactivateRow(row, checkbox, pills, startEl, endEl);
                    // Time inputs return to tabindex=-1 on deactivate; keep focus on the
                    // (still-focusable) pill so keyboard users aren't stranded.
                    pill.focus();
                } else {
                    _activateRow(row, checkbox, pills, startEl, endEl, type);
                    // Pre-fill times from the base roster shift when choosing Shift or RDW,
                    // but only if the user hasn't already entered something.
                    if (!TYPES[type]?.fixed && !/** @type {HTMLInputElement} */ (startEl).value && !/** @type {HTMLInputElement} */ (endEl).value) {
                        if ((type === 'shift' || type === 'rdw') && baseShift && baseShift.includes('-')) {
                            const [prefillS, prefillE] = baseShift.split('-');
                            /** @type {HTMLInputElement} */ (startEl).value = prefillS;
                            /** @type {HTMLInputElement} */ (endEl).value   = prefillE;
                        }
                    }
                    // timesOptional types (Other): DON'T auto-focus the time input — on a phone the
                    // keyboard would pop over the just-revealed flavour/RDW sub-controls, for times
                    // that are optional and usually unknown. (This is timesOptional's behavioural job.)
                    if (!TYPES[type]?.fixed && !TYPES[type]?.timesOptional) /** @type {HTMLInputElement} */ (startEl).focus();
                }
                // Show RD hint when Shift is chosen on a base-rest day
                const rdHint = /** @type {HTMLElement|null} */ (row.querySelector('.col-rd-hint'));
                if (rdHint) rdHint.hidden = !(type === 'shift' && row.dataset.baseIsRd === '1' && !already);
                _markChanged();
                updateSaveBtn();
            });
        });

        if (checkbox) {
            checkbox.addEventListener('change', () => {
                if (/** @type {HTMLInputElement} */ (checkbox).checked) {
                    if (!row.dataset.type) row.classList.add('selected');
                } else {
                    row.classList.remove('prefilled-existing');
                    _deactivateRow(row, checkbox, pills, startEl, endEl);
                }
                _markChanged();
                updateSaveBtn();
                _updateBulkSelCount();
            });
        }

        // 'input' is needed alongside 'change' because the auto-format handler in
        // _initTimeInputs() programmatically sets element.value on each keystroke.
        // On Safari/WebKit this resets the browser's change-detection baseline, so
        // 'change' never fires when focus leaves (current value == last programmatic value).
        const onTimeEdit = () => { row.classList.remove('prefilled-existing'); _markChanged(); updateSaveBtn(); };
        if (startEl) {
            startEl.addEventListener('input',  onTimeEdit);
            startEl.addEventListener('change', onTimeEdit);
        }
        if (endEl) {
            endEl.addEventListener('input',    onTimeEdit);
            endEl.addEventListener('change',   onTimeEdit);
        }

        // Training sub-controls: flavour is a one-of-three toggle; the RDW tick marks a
        // training rest-day. Both mark the grid changed like any other edit.
        row.querySelectorAll('.other-flavour-btn').forEach(btnEl => {
            const btn = /** @type {HTMLButtonElement} */ (btnEl);
            btn.addEventListener('click', () => {
                row.querySelectorAll('.other-flavour-btn').forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                row.classList.remove('prefilled-existing');
                _markChanged(); updateSaveBtn();
            });
        });
        const otherRdwCb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
        if (otherRdwCb) otherRdwCb.addEventListener('change', () => {
            row.classList.remove('prefilled-existing');
            _syncOtherRdwWarn(row);
            _markChanged(); updateSaveBtn();
        });
    }
}

/**
 * Re-renders the full week grid for the currently selected member and date.
 * Resets unsaved-changes state, shows the bulk bar, and refreshes the Save button.
 */
export function renderWeekGrid() {
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const fieldDate   = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
    const weekGrid    = document.getElementById('weekGrid');
    const bulkBar     = document.getElementById('bulkBar');
    const saveBtn     = /** @type {HTMLButtonElement|null} */ (document.getElementById('saveBtn'));
    const memberName  = fieldMember?.value;
    const dateStr     = fieldDate?.value;

    updateWeekNavLabel(dateStr ?? '');

    if (!memberName || !dateStr) {
        if (weekGrid) weekGrid.innerHTML = `<div class="week-empty">${_currentIsAdmin ? 'Select a staff member and date above to load the week.' : 'Select a date above to load the week.'}</div>`;
        if (bulkBar)  bulkBar.style.display = 'none';
        if (saveBtn)  saveBtn.disabled = true;
        return;
    }

    if (weekGrid) weekGrid.innerHTML = '';

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

/**
 * Show the "originally rostered" warning only when the RDW tick is ON for a day whose
 * base roster is NOT a rest day (owner decision, Jul 2026: allow it — the admin may know
 * the roster is wrong — but say plainly that a real rostered shift is being repaid as RDW).
 * Rest-day rows never warn (the tick is the normal state there, pre-ticked).
 * @param {HTMLElement} row
 */
function _syncOtherRdwWarn(row) {
    const warn = /** @type {HTMLElement|null} */ (row.querySelector('.other-rdw-warn'));
    if (!warn) return;
    const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
    const optsVisible = !(/** @type {HTMLElement|null} */ (row.querySelector('.other-opts'))?.hidden);
    warn.hidden = !(optsVisible && cb?.checked && row.dataset.baseIsRd !== '1');
}

/**
 * @param {HTMLElement} row
 * @param {HTMLInputElement|null} checkbox
 * @param {NodeListOf<Element>} pills
 * @param {HTMLInputElement|null} startEl
 * @param {HTMLInputElement|null} endEl
 * @param {string} type
 */
function _activateRow(row, checkbox, pills, startEl, endEl, type) {
    if (checkbox) checkbox.checked = true;
    row.classList.add('active');
    row.classList.remove('selected');
    pills.forEach(p => {
        const on = (/** @type {HTMLElement} */ (p)).dataset.type === type;
        p.classList.toggle('active', on);
        p.setAttribute('aria-pressed', String(on));
    });
    if (TYPES[type]?.fixed) {
        row.classList.add('fixed-type');
        if (startEl) startEl.tabIndex = -1;
        if (endEl) endEl.tabIndex = -1;
    } else {
        row.classList.remove('fixed-type');
        if (startEl) startEl.tabIndex = 0;
        if (endEl) endEl.tabIndex = 0;
    }
    row.dataset.type = type;
    // Training options strip: visible only while the Training pill is active. The RDW tick
    // pre-ticks itself when the day's base roster is a rest day (OTHER_PLAN.md decision 8)
    // — smart default, still adjustable. Runs on BOTH the pill and bulk-apply paths.
    const otherOpts = /** @type {HTMLElement|null} */ (row.querySelector('.other-opts'));
    if (otherOpts) {
        otherOpts.hidden = type !== 'other';
        if (type === 'other') {
            const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
            if (cb && row.dataset.baseIsRd === '1') cb.checked = true;
        }
        _syncOtherRdwWarn(row);
    }
    const badge = row.querySelector('.overwrite-badge');
    if (badge) badge.textContent = '⚠ Updating';
}

/**
 * @param {HTMLElement} row
 * @param {HTMLInputElement|null} checkbox
 * @param {NodeListOf<Element>} pills
 * @param {HTMLInputElement|null} startEl
 * @param {HTMLInputElement|null} endEl
 */
function _deactivateRow(row, checkbox, pills, startEl, endEl) {
    if (checkbox) checkbox.checked = false;
    row.classList.remove('active', 'fixed-type', 'selected', 'row-error');
    pills.forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
    if (startEl) {
        startEl.value = '';
        startEl.classList.remove('input-error');
        startEl.removeAttribute('aria-invalid');
        startEl.tabIndex = -1;
    }
    if (endEl) {
        endEl.value = '';
        endEl.classList.remove('input-error');
        endEl.removeAttribute('aria-invalid');
        endEl.tabIndex = -1;
    }
    delete row.dataset.type;
    // Reset the training sub-controls to their defaults (Train flavour, no RDW, hidden).
    const otherOpts = /** @type {HTMLElement|null} */ (row.querySelector('.other-opts'));
    if (otherOpts) {
        otherOpts.hidden = true;
        row.querySelectorAll('.other-flavour-btn').forEach(b => {
            const on = (/** @type {HTMLElement} */ (b)).dataset.flavour === 'TRG';
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
        const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
        if (cb) cb.checked = false;
        _syncOtherRdwWarn(row);
    }
    const badge = row.querySelector('.overwrite-badge');
    if (badge) badge.textContent = '⚠ Existing';
}

export function updateSaveBtn() {
    const weekGrid = document.getElementById('weekGrid');
    const saveBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('saveBtn'));
    if (!weekGrid || !saveBtn) return;
    const rows       = /** @type {HTMLElement[]} */ ([...weekGrid.querySelectorAll('.day-row')]);
    const saveCount  = rows.filter(r => r.dataset.type && !r.classList.contains('prefilled-existing')).length;
    const delCount   = rows.filter(r => !r.dataset.type && r.dataset.existingId).length;
    const total = saveCount + delCount;
    saveBtn.disabled = total === 0;

    // Staged bar — mirrors the save state as a fixed bottom affordance so users
    // can save without scrolling back up to the Save button.
    const stagedBar   = document.getElementById('stagedBar');
    const stagedCount = document.getElementById('stagedCount');
    if (stagedBar) {
        stagedBar.hidden = total === 0;
        if (stagedCount) {
            const parts = [];
            if (saveCount) parts.push(`${saveCount} day${saveCount > 1 ? 's' : ''}`);
            if (delCount)  parts.push(`${delCount} to remove`);
            stagedCount.textContent = parts.join(', ');
        }
    }

    const hint = document.getElementById('saveBtnHint');
    if (hint) {
        if (total > 0) {
            const parts = [];
            if (saveCount) parts.push(`${saveCount} day${saveCount > 1 ? 's' : ''} to save`);
            if (delCount)  parts.push(`${delCount} change${delCount > 1 ? 's' : ''} to remove`);
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
    const bulkStart     = /** @type {HTMLInputElement|null} */ (document.getElementById('bulkStart'));
    const bulkEnd       = /** @type {HTMLInputElement|null} */ (document.getElementById('bulkEnd'));
    const bulkApplyBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('bulkApplyBtn'));
    if (bulkTypePills) bulkTypePills.querySelectorAll('.type-pill-btn').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
    if (bulkTimeGroup) bulkTimeGroup.style.display = 'none';
    if (bulkStart) bulkStart.value = '';
    if (bulkEnd)   bulkEnd.value   = '';
    if (bulkApplyBtn) bulkApplyBtn.textContent = '3. Apply to ticked days';
}

function _initBulkBar() {
    const bulkTypePills = document.getElementById('bulkTypePills');
    const bulkTimeGroup = document.getElementById('bulkTimeGroup');
    const bulkStart     = /** @type {HTMLInputElement|null} */ (document.getElementById('bulkStart'));
    const bulkEnd       = /** @type {HTMLInputElement|null} */ (document.getElementById('bulkEnd'));
    const bulkApplyBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('bulkApplyBtn'));
    const weekGrid      = document.getElementById('weekGrid');

    if (bulkTypePills) {
        bulkTypePills.querySelectorAll('.type-pill-btn').forEach(pillEl => {
            const pill = /** @type {HTMLButtonElement} */ (pillEl);
            pill.addEventListener('click', () => {
                const type    = pill.dataset.type ?? '';
                const already = pill.classList.contains('active');
                if (already) { resetBulkPills(); return; }
                bulkTypePills.querySelectorAll('.type-pill-btn').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
                pill.classList.add('active');
                pill.setAttribute('aria-pressed', 'true');
                _bulkActiveType = type;
                if (bulkApplyBtn) bulkApplyBtn.textContent = `3. Apply "${TYPES[type]?.label ?? type}" to ticked days`;
                if (bulkTimeGroup) bulkTimeGroup.style.display = (TYPES[type] && !TYPES[type].fixed) ? 'flex' : 'none';
                if (bulkStart) bulkStart.value = '';
                if (bulkEnd)   bulkEnd.value   = '';
            });
        });
    }

    document.getElementById('bulkSelMonFri')?.addEventListener('click', () => {
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const dayIdx   = new Date((row.dataset.date ?? '') + 'T12:00:00').getDay();
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox) return;
            if (dayIdx >= 1 && dayIdx <= 5) {
                checkbox.checked = true;
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                // Prefilled rows (existing override, unedited) are only visually unchecked —
                // calling _deactivateRow would clear dataset.type and queue them for deletion.
                if (row.dataset.existingId && row.classList.contains('prefilled-existing')) {
                    checkbox.checked = false;
                    row.classList.remove('selected');
                } else {
                    _deactivateRow(row, checkbox, row.querySelectorAll('.type-pill-btn'),
                        /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start')),
                        /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end')));
                }
            }
        });
        updateSaveBtn(); _updateBulkSelCount();
    });

    document.getElementById('bulkSelWorking')?.addEventListener('click', () => {
        const memberName = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value;
        const member = memberName ? teamMembers.find(m => m.name === memberName) : null;
        // Build priority-correct override map once — manual beats roster_import per date.
        const selMemberDateMap = memberName ? buildMemberDateMap(memberName) : null;
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const dateISO  = row.dataset.date ?? '';
            const date     = new Date(dateISO + 'T12:00:00');
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox) return;
            const base = member ? getBaseShift(member, date) : 'RD';
            // Also respect recorded RD corrections so corrected days aren't re-selected
            const ov    = selMemberDateMap?.get(dateISO) ?? null;
            const isRD  = isRestShift(base) || (ov && isRestShift(ov.value));
            if (!isRD) {
                checkbox.checked = true;
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                if (row.dataset.existingId && row.classList.contains('prefilled-existing')) {
                    checkbox.checked = false;
                    row.classList.remove('selected');
                } else {
                    _deactivateRow(row, checkbox, row.querySelectorAll('.type-pill-btn'),
                        /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start')),
                        /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end')));
                }
            }
        });
        updateSaveBtn(); _updateBulkSelCount();
    });

    document.getElementById('bulkSelAll')?.addEventListener('click', () => {
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox) return;
            checkbox.checked = true;
            if (!row.dataset.type) row.classList.add('selected');
        });
        updateSaveBtn(); _updateBulkSelCount();
    });

    bulkApplyBtn?.addEventListener('click', () => {
        if (!_bulkActiveType) { _showError('Choose a type in step 2 first, then tap Apply.'); return; }
        const typeMeta = TYPES[_bulkActiveType];
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox || !checkbox.checked) return;
            if ((_bulkActiveType === 'annual_leave' || _bulkActiveType === 'sick' || _bulkActiveType === 'other') && isSunday(row.dataset.date ?? '')) return; // Rule: see CLAUDE.md — "Sundays are non-contracted" (layer 2: bulk-bar skip)
            const pills   = row.querySelectorAll('.type-pill-btn');
            const startEl = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
            const endEl   = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
            _activateRow(row, checkbox, pills, startEl, endEl, _bulkActiveType);
            row.classList.remove('prefilled-existing'); // mark as user-edited, not pre-filled
            if (typeMeta && !typeMeta.fixed) {
                if (bulkStart?.value && startEl) startEl.value = bulkStart.value;
                if (bulkEnd?.value && endEl)     endEl.value   = bulkEnd.value;
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
 * @param {Array<{memberName:string, date:string, type:string, value:string, note:string, existingId:string}>} toSave
 * @param {string[]} toDelete  Firestore document IDs to delete
 */
export async function executeSave(toSave, toDelete = []) {
    const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
    const fieldDate   = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
    const weekGrid    = document.getElementById('weekGrid');
    const saveBtn     = /** @type {HTMLButtonElement|null} */ (document.getElementById('saveBtn'));
    const memberName  = fieldMember?.value;
    const overwrites  = toSave.filter(e => e.existingId).length;
    const creates     = toSave.length - overwrites;
    const removes     = toDelete.length;
    const total       = toSave.length + removes;

    await sessionReady;
    if (!auth.currentUser) {
        _showError('Session expired — please sign out and sign back in.');
        return;
    }

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = `Saving ${total} change${total !== 1 ? 's' : ''}…`; }

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
                batch.set(newRef, { ...data, source: 'manual', createdAt: serverTimestamp(), changedBy: _currentUser });
                docs.push({ id: newRef.id, ...data, createdAt: new Date() });
            });
            await batch.commit();
            return docs;
        });

        const parts = [];
        if (creates    > 0) parts.push(`${creates} added`);
        if (overwrites > 0) parts.push(`${overwrites} updated`);
        if (removes    > 0) parts.push(`${removes} removed`);
        _showSuccess(`${parts.join(', ')} for ${memberName}`);

        // Reset checked rows in the grid
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            const pills    = row.querySelectorAll('.type-pill-btn');
            const s        = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
            const e        = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
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
        _showError((/** @type {any} */ (err))?.code === 'permission-denied'
            ? "Couldn't save — your session may have expired. Please sign out and sign back in."
            : "Couldn't save — check your connection and try again.");
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
    if (tableBody) tableBody.innerHTML = '<tr class="state-row"><td colspan="7"><span class="spinner"></span>Loading…</td></tr>';
    try {
        const snap = await getDocs(query(collection(db, COLLECTIONS.overrides), orderBy('date', 'desc'), limit(5000)));
        _allOverrides = [];
        snap.forEach(/** @param {any} s */ s => _allOverrides.push({ id: s.id, ...s.data() }));
        renderTable();
        const fieldMember = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'));
        const fieldDate   = /** @type {HTMLInputElement|null} */ (document.getElementById('fieldDate'));
        if (fieldMember?.value && fieldDate?.value) renderWeekGrid();
        _onAfterSave();
    } catch (err) {
        console.error('[Admin] Load failed:', err);
        if (tableBody) {
            tableBody.innerHTML = '<tr class="state-row"><td colspan="7">Couldn\'t load saved changes.<br><span class="reload-link" id="reloadLink">↻ Reload page</span></td></tr>';
            document.getElementById('reloadLink')?.addEventListener('click', () => location.reload());
        }
        if (listCount) listCount.textContent = 'Error';
    }
}

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
    const memberFilter       = _tableShowAllOverrides ? '' : (selectedMember || '');
    const memberRows         = memberFilter
        ? _allOverrides.filter(o => o.memberName === memberFilter)
        : _allOverrides;

    // Update "Show all / This member" toggle button
    const showAllBtn = document.getElementById('showAllOverridesBtn');
    if (showAllBtn) {
        showAllBtn.hidden = !selectedMember;
        showAllBtn.textContent = _tableShowAllOverrides ? 'This member only' : 'All staff';
    }

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
    if (listCount) {
        const label   = `${rows.length} saved change${rows.length !== 1 ? 's' : ''}`;
        const context = _tableShowAllOverrides ? ' (all staff)' : '';
        listCount.textContent = label + context;
    }

    if (!rows.length) {
        const who = memberFilter ? ` for ${escapeHtml(memberFilter)}` : '';
        if (tableBody) tableBody.innerHTML = `<tr class="state-row"><td colspan="7">No recorded changes yet${who}. Any shifts you record will appear here.</td></tr>`;
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
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="checkbox" class="row-select" data-id="${eid}" aria-label="Select ${ename} ${edate}"></td>
            <td style="white-space:nowrap;font-weight:600">${formatDisplay(o.date)}</td>
            <td>${ename}</td>
            <td><span class="list-type-pill lpill-${etype}">${typeMeta ? typeMeta.label : etype}</span>${isLegacyType ? '<span class="legacy-pill">old format</span>' : ''}${o.source === 'roster_import' ? '<span class="source-pill">PDF upload</span>' : ''}</td>
            <td style="font-family:monospace;font-size:12px">${escapeHtml(o.value)}${o.note ? `<span class="override-note" title="${escapeHtml(o.note)}">${escapeHtml(o.note)}</span>` : ''}</td>
            <td><button class="btn-edit" data-member="${ename}" data-date="${edate}" aria-label="Edit ${ename} ${edate}">Edit</button></td>
            <td><button class="btn-delete" data-id="${eid}" aria-label="Delete ${ename} ${edate}">Delete</button></td>`;
        if (tableBody) tableBody.appendChild(tr);
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
    const deleted = _allOverrides.find(o => o.id === btn.dataset.id);
    btn.disabled = true;
    btn.textContent = '…';
    try {
        // Wrap in writeWithClaimRetry so a just-provisioned manager on a pre-`manager`-claim token
        // self-heals (force-refresh + retry once) instead of a hard permission-denied — parity with
        // the executeSave / recordRangeOverrides / bulk-delete write paths.
        await writeWithClaimRetry(() => deleteDoc(doc(db, COLLECTIONS.overrides, btn.dataset.id ?? '')));
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
            listFeedback.textContent = (/** @type {any} */ (err))?.code === 'unavailable'
                ? '⚠ You appear to be offline — reconnect and try again.'
                : '⚠ Could not delete — check your connection and try again.';
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
                    listFeedback.textContent = (/** @type {any} */ (err))?.code === 'unavailable'
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

    document.getElementById('showAllOverridesBtn')?.addEventListener('click', () => {
        _tableShowAllOverrides = !_tableShowAllOverrides;
        renderTable();
    });
}

// ── TIME INPUTS ───────────────────────────────────────────────────────────────
function _initTimeInputs() {
    // Typing 4 digits auto-inserts the colon: "0730" → "07:30"
    document.addEventListener('input', e => {
        if (_formattingTime || !/** @type {Element} */ (e.target).classList.contains('time-input')) return;
        const timeInput = /** @type {HTMLInputElement} */ (e.target);
        timeInput.classList.remove('input-error');
        timeInput.removeAttribute('aria-invalid');
        let raw = timeInput.value.replace(/[^0-9]/g, '').slice(0, 4);
        if (raw.length === 3 && parseInt(raw.slice(0, 2), 10) > 23) raw = '0' + raw; // without this, "630" → "63:0"
        _formattingTime = true;
        timeInput.value = raw.length >= 3 ? raw.slice(0, 2) + ':' + raw.slice(2) : raw;
        _formattingTime = false;
        if (raw.length === 4) {
            if (timeInput.classList.contains('day-start')) {
                /** @type {HTMLElement|null} */ (timeInput.closest('.day-row')?.querySelector('.day-end'))?.focus();
            } else if (timeInput.id === 'bulkStart') {
                /** @type {HTMLElement|null} */ (document.getElementById('bulkEnd'))?.focus();
            }
        }
    });

    document.addEventListener('focusout', e => {
        if (!/** @type {Element} */ (e.target).classList.contains('time-input')) return;
        const timeInput = /** @type {HTMLInputElement} */ (e.target);
        const val = timeInput.value.trim();
        if (!val) { timeInput.classList.remove('input-error'); timeInput.removeAttribute('aria-invalid'); return; }
        const invalid = !/^([01]\d|2[0-3]):[0-5]\d$/.test(val);
        timeInput.classList.toggle('input-error', invalid);
        // Expose the failure to assistive tech, not just via the CSS class. The input
        // already points at its error span through aria-describedby.
        if (invalid) timeInput.setAttribute('aria-invalid', 'true');
        else timeInput.removeAttribute('aria-invalid');
    });
}

// ── SHIFT RULE HELPERS ────────────────────────────────────────────────────────
/** @param {string} timeStr */
function _parseMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

/**
 * @param {string} startStr
 * @param {string} endStr
 */
function _effectiveEndMins(startStr, endStr) {
    const s = _parseMinutes(startStr), e = _parseMinutes(endStr);
    return e >= s ? e : e + 24 * 60;
}

/** @param {number} mins */
function _fmtHours(mins) {
    const h = mins / 60;
    return (Number.isInteger(h) ? h : h.toFixed(1)) + 'h';
}

/**
 * Returns the effective shift value for a member on a date, checking the
 * pending save batch first, then _allOverrides, then the base roster.
 * @param {string} memberName
 * @param {string} dateISO  YYYY-MM-DD
 * @param {any[]}  batch    Pending toSave entries
 */
export function getEffectiveShift(memberName, dateISO, batch) {
    const inBatch = batch.find(e => e.date === dateISO);
    if (inBatch) return inBatch.value;
    let best = null;
    for (const o of _allOverrides) {
        if (o.memberName !== memberName || o.date !== dateISO) continue;
        if (!best || shouldReplaceOverride(best, o)) best = o;
    }
    if (best) return best.value;
    const member = teamMembers.find(m => m.name === memberName);
    return member ? getBaseShift(member, new Date(dateISO + 'T12:00:00')) : 'RD';
}

/**
 * Validates max shift duration (12 h) and minimum rest gap (12 h) for toSave.
 * Marks failing rows with .row-error in the DOM.
 * @param {any[]}  toSave
 * @param {string} memberName
 * @returns {string[]} Human-readable error strings (empty = valid)
 */
export function validateShiftRules(toSave, memberName) {
    const weekGrid   = document.getElementById('weekGrid');
    /** @type {string[]} */
    const ruleErrors = [];

    toSave.forEach(entry => {
        const { date, value, type } = entry;
        if (TYPES[type]?.fixed) return;
        // Other-family values carry the grammar FLAVOUR[" RDW"][" HH:MM-HH:MM"] — a naive
        // split('-') would shred it into NaN and silently skip every check. No times →
        // nothing to validate (the pay defaults apply); times → validate the time part.
        let checkValue = value;
        if (type === 'other') {
            const _t = parseOtherValue(value);
            if (!_t || !_t.time) return;
            checkValue = _t.time;
        }
        if (!checkValue || !checkValue.includes('-')) return;

        const [startStr, endStr] = checkValue.split('-');
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
            let adjShift = getEffectiveShift(memberName, adjISO, toSave);
            // Adjacent training values: a TIMED training constrains via its actual times; an
            // untimed as-base training constrains via its BASE shift (the member attends those
            // hours); only an untimed training REST-day is exempt (its hours are unknowable here).
            const _adjOther = parseOtherValue(adjShift);
            if (_adjOther) {
                if (_adjOther.time) {
                    adjShift = _adjOther.time;
                } else if (_adjOther.rdw) {
                    return;
                } else {
                    const _adjMember = teamMembers.find(m => m.name === memberName);
                    adjShift = _adjMember ? getBaseShift(_adjMember, new Date(adjISO + 'T12:00:00')) : '';
                    if (parseOtherValue(adjShift) || isRestShift(adjShift)) return;
                }
            }
            if (!adjShift || !adjShift.includes('-')) return;
            const [adjStart, adjEnd] = adjShift.split('-');
            if (delta === -1) {
                const prevEnd = _effectiveEndMins(adjStart, adjEnd);
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
    if (!auth.currentUser) throw new Error('auth/session-expired');

    const memberObj = teamMembers.find(m => m.name === memberName);

    // Build a priority-correct Map<date, override> — buildMemberDateMap applies
    // shouldReplaceOverride() so manual overrides beat roster_import entries.
    const ovByDate = buildMemberDateMap(memberName);

    const workingDates = memberObj
        ? dates.filter(dateStr => {
            if (isSunday(dateStr)) return false; // Rule: see CLAUDE.md — "Sundays are non-contracted" (layer 3: recordRangeOverrides filter)
            const ov = ovByDate.get(dateStr);
            // An existing override (e.g. RDW) takes precedence over the base shift:
            // if it marks the day as worked, include it even when base is RD.
            if (ov) return !isRestShift(ov.value);
            const base = getBaseShift(memberObj, new Date(dateStr + 'T12:00:00'));
            return !isRestShift(base);
          })
        : [];

    // Sundays within the range that have a worked base shift need an explicit RD correction
    // so the base roster shift doesn't still show on the calendar during the absence period.
    const sundayCorrections = memberObj
        ? dates.filter(dateStr => {
            if (!isSunday(dateStr)) return false;
            const base = getBaseShift(memberObj, new Date(dateStr + 'T12:00:00'));
            if (isRestShift(base)) return false;
            const ov = ovByDate.get(dateStr);
            if (ov && isRestShift(ov.value)) return false;
            return true;
          })
        : [];

    if (!workingDates.length) return { workingCount: 0, sundayCount: sundayCorrections.length };

    // Build + commit as a re-runnable thunk so writeWithClaimRetry can retry once on a stale-claim
    // `permission-denied` (a just-provisioned manager booking AL/absence on-behalf before their
    // `manager` claim has propagated). The batch, newDocs and deletedIds are rebuilt on each attempt
    // — a WriteBatch can't be re-committed — and the thunk RETURNS them so the retry's fresh doc IDs
    // are the ones cached below.
    const { newDocs, deletedIds } = await writeWithClaimRetry(async () => {
        /** @type {any[]} */
        const docs   = [];
        const delIds = new Set();
        const batch  = writeBatch(db);

        workingDates.forEach(date => {
            const existing = ovByDate.get(date);
            if (existing) { batch.delete(doc(db, COLLECTIONS.overrides, existing.id)); delIds.add(existing.id); }
            const newRef = doc(collection(db, COLLECTIONS.overrides));
            batch.set(newRef, {
                memberName, date, type, value, note: '', source: 'manual',
                createdAt: serverTimestamp(), changedBy,
            });
            docs.push({ id: newRef.id, memberName, date, type, value, source: 'manual', note: '', createdAt: new Date() });
        });

        sundayCorrections.forEach(date => {
            const existing = ovByDate.get(date);
            if (existing) { batch.delete(doc(db, COLLECTIONS.overrides, existing.id)); delIds.add(existing.id); }
            const newRef = doc(collection(db, COLLECTIONS.overrides));
            batch.set(newRef, {
                memberName, date, type: 'correction', value: 'RD', note: '', source: 'manual',
                createdAt: serverTimestamp(), changedBy,
            });
            docs.push({ id: newRef.id, memberName, date, type: 'correction', value: 'RD', source: 'manual', note: '', createdAt: new Date() });
        });

        await batch.commit();
        return { newDocs: docs, deletedIds: delIds };
    });

    // Update in-memory cache — no Firestore round-trip needed
    _allOverrides = _allOverrides.filter(o => !deletedIds.has(o.id));
    _allOverrides.push(...newDocs);
    _allOverrides.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
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
