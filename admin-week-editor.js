// @ts-check
/**
 * admin-week-editor.js — the seven-day grid, its pills, and everything staged but not yet saved.
 *
 * ── WHY IT LEFT THE COORDINATOR (v21.38) ────────────────────────────────────────────────────────
 *
 * The largest of the surfaces `admin-overrides.js` owned, and the one the review named first: the
 * week grid, the per-row type pills, the bulk bar, and the Save button's read of what is staged.
 * All of it is one job — decide what a week SHOULD say — and it ends where `executeSave` begins.
 *
 * ── STAGED IS NOT SAVED, AND THE DIFFERENCE IS LOAD-BEARING ─────────────────────────────────────
 *
 * `hasStagedEdits` is the reason a background refresh does not repaint over an admin mid-edit, and
 * it counts BOTH directions: a row given a type that is not an unchanged prefill (a staged change)
 * and a prefilled row un-ticked (a staged REMOVAL). Counting only the first is a defect that has
 * shipped here before — the refresh discarded staged removals while `userMadeChanges` stayed true,
 * which blocked the week swipe and left a phantom unsaved-changes warning behind.
 *
 * ── AN UNREAD MEMBER IS NOT A MEMBER WITH NO CHANGES ────────────────────────────────────────────
 *
 * The load is staged per member, so this grid can be asked to draw somebody whose overrides have
 * never been fetched. Painting seven base-roster days would be indistinguishable from a genuinely
 * clear week. It draws a loading state instead — and a distinct FAILED state, because saying
 * "Loading…" over a load that has stopped is the same false claim in the patient direction.
 *
 * Permissions, feedback and the dirty-state marker arrive through `initWeekEditor`, which is what
 * keeps this out of a cycle with the coordinator that wires it.
 */

import { teamMembers, getBaseShift, getShiftBadge, getSpecialDayBadges, formatISO, isSunday,
         DAY_NAMES, MONTH_ABB, escapeHtml, TIME_RE, parseISODate } from './roster-data.js';
import { isRestShift, isForbiddenOnSunday, parseOtherValue, OTHER_FLAVOURS } from './override-utils.js';
import { TYPES, PILL_TYPES } from './admin-shift-types.js';
import { hasOverrideAuthorityFor, loadFailedFor, loadOverrides } from './admin-override-store.js';

// ── INJECTED ──────────────────────────────────────────────────────────────────
let _currentIsAdmin = false;
/** @type {(msg: string) => void} */   let _showError    = () => {};
/** @type {(msg: string) => void} */   let _showSuccess  = () => {};
/** @type {() => void} */              let _markChanged  = () => {};
/** @type {(m: string) => Map<string, any>} */ let buildMemberDateMap = () => new Map();

/**
 * @param {object} deps
 * @param {boolean} deps.currentIsAdmin
 * @param {(msg: string) => void} deps.showError
 * @param {(msg: string) => void} deps.showSuccess
 * @param {() => void} deps.markChanged
 * @param {(m: string) => Map<string, any>} deps.memberDateMap
 * @returns {void}
 */
export function initWeekEditor(deps) {
    _currentIsAdmin   = deps.currentIsAdmin;
    _showError        = deps.showError;
    _showSuccess      = deps.showSuccess;
    _markChanged      = deps.markChanged;
    buildMemberDateMap = deps.memberDateMap;
    _initBulkBar();
    _initTimeInputs();
}

/** True when the week grid currently holds STAGED (unsaved) work — mirrors updateSaveBtn's
 *  save/delete counts so it catches BOTH a staged addition/change (a row with a chosen type that
 *  isn't an unchanged prefill) AND a staged REMOVAL (a prefilled row unticked → existingId, no
 *  type). Used to avoid re-rendering the week grid over the admin's in-progress edits — by
 *  loadOverrides AND by the Saved-Changes delete paths (v16.82: deleting an unrelated saved change
 *  must not silently discard staged pills; the old active-pill-only check also missed staged
 *  removals). Exported so admin-app's period-delete path can apply the same guard. */
export function _hasStagedEdits() {
    const weekGrid = document.getElementById('weekGrid');
    if (!weekGrid) return false;
    return [...weekGrid.querySelectorAll('.day-row')].some(r => {
        const el = /** @type {HTMLElement} */ (r);
        return (el.dataset.type && !el.classList.contains('prefilled-existing')) // staged add/change
            || (!el.dataset.type && el.dataset.existingId);                       // staged removal
    });
}

/**
 * Return every row in the week grid to its unstaged state.
 *
 * Called after a successful save. It lives here because the row lifecycle does — `executeSave` used
 * to reach into `_deactivateRow` directly, which is the coordinator knowing how a row is built.
 * @returns {void}
 */
export function resetStagedRows() {
    document.getElementById('weekGrid')?.querySelectorAll('.day-row').forEach(rowEl => {
        const row      = /** @type {HTMLElement} */ (rowEl);
        const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
        const pills    = row.querySelectorAll('.type-pill-btn');
        const s        = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
        const e        = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
        if (checkbox) _deactivateRow(row, checkbox, pills, s, e);
    });
}

/** Returns a new Date set to the Sunday of the week containing dateStr. */
/** @param {string} dateStr */
function getSundayOfWeek(dateStr) {
    const d = parseISODate(dateStr);
    d.setDate(d.getDate() - d.getDay());
    return d;
}

/** The type currently armed on the bulk bar. */
let _bulkActiveType = '';

// Re-entry guard for the time-input formatter: assigning to `value` inside an `input` listener
// triggers another `input` event on iOS Safari (but not on Android Chrome). Without this guard the
// handler reformats its own output.
let _formattingTime = false;

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
        // Same-month ranges collapse to "19–25 Jul 2026" (v18.90). The full form repeats the month
        // for no information, and at the documented 375px width it overflowed the nav pill — it
        // ellipsised to "19 Jul – 25 Jul 2026 …", dropping the 📅 tap affordance with it.
        // formatTeamWeekLabel (calendar-team-view.js) has always collapsed; admin was the outlier.
        // The CROSS-month form uses the same tight en-dash as the same-month one (v18.91). The
        // spaced " – " cost ~6px, and at 375px that was the difference between fitting and
        // ellipsising: v18.89 reclaimed 14px from this row (gap replaced padding) without
        // re-measuring, which pushed SIX cross-month weeks over the line. v18.90 then collapsed
        // only the same-month form, so today's week looked fixed while those six still clipped —
        // and what gets cut is the trailing 📅, the date-picker's only affordance.
        label.textContent = sunday.getMonth() === saturday.getMonth()
            ? `${sunday.getDate()}–${saturday.getDate()} ${MONTH_ABB[saturday.getMonth()]} ${saturday.getFullYear()}`
            : `${sunday.getDate()} ${MONTH_ABB[sunday.getMonth()]}–${saturday.getDate()} ${MONTH_ABB[saturday.getMonth()]} ${saturday.getFullYear()}`;
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
        const badgeHTML = badges.map(b => `<span class="day-badge" role="img" aria-label="${b.title}" title="${b.title}">${b.icon}</span>`).join('');

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
                <span class="day-date">${date.getDate()} ${MONTH_ABB[date.getMonth()]}${badgeHTML}${existing ? ` <span class="overwrite-badge"><span aria-hidden="true">⚠</span> ${escapeHtml(existing.value === 'SICK' ? 'Absent' : existing.value === 'SPARE' ? 'Spare' : (existing.value || existing.type))}</span>` : ''}</span>
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
                        `<button type="button" class="other-flavour-btn" data-flavour="${k}" aria-pressed="false">${f.full}</button>`
                    ).join('\n                    ')}
                    <button type="button" class="other-flavour-btn other-flavour-spare" data-flavour="SPARE" aria-pressed="false" title="On standby — shift not yet assigned"><span aria-hidden="true">📋</span> Spare</button>
                </span>
                <label class="other-rdw-label"><input type="checkbox" class="other-rdw-cb"${isRestShift(baseShift) ? ' checked disabled title="Rest day — RDW is automatic"' : ''}> Rest day (RDW)</label>
                <span class="other-rdw-warn" hidden>Originally rostered ${escapeHtml(baseShift)} this day — RDW pays it as rest-day working instead</span>
                <span class="other-opts-hint">Pick a type above, then times (optional — blank pays the default: base shift, or 8h RDW).</span>
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
                otherPill.title    = 'Other days (training, induction, assessment, team days) cannot be recorded on a Sunday — Sundays are not contracted days';
                otherPill.setAttribute('aria-label', 'Other — unavailable on Sundays (not a contracted day)');
            }
            // A worked Sunday is always Rest Day Working (RDW), never a plain shift — Sundays are
            // uncontracted, so any Sunday work is overtime. Disable the Shift pill and point staff at
            // RDW (the roster-upload path promotes Sunday shift→rdw for the same reason). Without this,
            // a Sunday saved as 'shift' rendered as an ordinary worked badge and the pay calculator's
            // Sunday-overtime pre-fill missed it, under-counting pay.
            const shiftPill = /** @type {HTMLButtonElement|null} */ (row.querySelector('.pill-shift'));
            if (shiftPill) {
                shiftPill.disabled = true;
                shiftPill.title    = 'A worked Sunday is recorded as Rest Day Working (RDW), not a shift — Sundays are not contracted days. Use the RDW pill.';
                shiftPill.setAttribute('aria-label', 'Shift — unavailable on Sundays; record Sunday work as Rest Day Working (RDW)');
            }
        }

        const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
        const pills    = row.querySelectorAll('.type-pill-btn');
        const startEl  = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
        const endEl    = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));

        // Pre-fill with existing override — mark as prefilled so Save button stays disabled until user edits
        if (existing) {
            const legacyToShift = { overtime: 'shift', allocated: 'shift' };
            // Spare moved under the Other pill (v15.57): an existing spare_shift override prefills
            // via Other → Spare (there is no top-level Spare pill anymore).
            const isSpare       = existing.type === 'spare_shift';
            const prefillType   = isSpare ? 'other'
                : ((/** @type {Record<string, any>} */ (legacyToShift))[existing.type] ?? existing.type);
            const typeMeta      = TYPES[prefillType];
            _activateRow(row, checkbox, pills, startEl, endEl, prefillType);
            row.classList.add('prefilled-existing');
            _syncOverwriteBadge(row); // loaded + untouched → "✓ Saved" (not "Updating")
            if (isSpare) {
                // Activate the Spare chip inside the now-open Other submenu; _syncOtherSpareMode
                // hides RDW/times and applies the fixed-type "No time needed" state.
                row.querySelectorAll('.other-flavour-btn').forEach(b => {
                    const on = (/** @type {HTMLElement} */ (b)).dataset.flavour === 'SPARE';
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                _syncOtherSpareMode(row);
            }
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
                if (_cb && !_cb.disabled) _cb.checked = _exOther.rdw;
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

        // Other-family sub-controls: flavour is a single-select toggle; the RDW tick marks an
        // Other rest-day. Both mark the grid changed like any other edit.
        row.querySelectorAll('.other-flavour-btn').forEach(btnEl => {
            const btn = /** @type {HTMLButtonElement} */ (btnEl);
            btn.addEventListener('click', () => {
                row.querySelectorAll('.other-flavour-btn').forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-pressed', String(on));
                });
                row.classList.remove('prefilled-existing');
                _syncOtherSpareMode(row);   // Spare hides RDW/times; Other-family flavours restore them
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

    // AN UNREAD MEMBER IS NOT A MEMBER WITH NO CHANGES (v21.38). The load is staged, so selecting
    // somebody whose slice has not arrived would paint seven base-roster days with no overrides on
    // them — which is exactly what a member with a clear week looks like, and an admin reading it
    // would conclude there is nothing recorded. Saving is refused in this state anyway; this is the
    // half that stops it being MISREAD. Cleared by the re-render `loadOverrides` runs on arrival.
    if (!hasOverrideAuthorityFor(memberName)) {
        // WAITING AND STUCK ARE DIFFERENT STATES (v21.38, review). Saying "Loading…" over a load
        // that has already failed is the same class of false claim as showing an empty week — it
        // just fails in the patient direction, and the admin waits instead of acting. The retry
        // lives HERE as well as in Saved Changes, because this is the card they are looking at.
        if (weekGrid) {
            if (loadFailedFor(memberName)) {
                weekGrid.innerHTML = '<div class="week-empty" role="alert">Couldn\'t load this member\'s saved changes.'
                    + '<br><span class="reload-link" id="retryWeekLink" role="button" tabindex="0">↻ Retry</span></div>';
                const r = document.getElementById('retryWeekLink');
                const again = () => { loadOverrides({ member: memberName }); };
                r?.addEventListener('click', again);
                r?.addEventListener('keydown', /** @param {KeyboardEvent} e */ e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); again(); }
                });
            } else {
                weekGrid.innerHTML = '<div class="week-empty" role="status">Loading this member\'s saved changes…</div>';
            }
        }
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
 * Reflect a "Spare" choice inside the Other submenu (v15.57 — Spare moved under Other).
 * Spare is a fixed placeholder: no RDW, no times. Reuse the `.fixed-type` machinery to hide
 * the time inputs (and show "No time needed"), and `.other-spare` to hide the RDW tick + hint.
 * Picking any Other-family flavour clears it (Other days keep their optional times). The collector
 * reads the active flavour and, when it's SPARE, writes a `spare_shift`/'SPARE' override.
 * @param {HTMLElement} row
 */
function _syncOtherSpareMode(row) {
    const spareActive = !!row.querySelector('.other-flavour-btn.active[data-flavour="SPARE"]');
    row.classList.toggle('other-spare', spareActive);
    row.classList.toggle('fixed-type',  spareActive);
    const s = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
    const e = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
    if (s) s.tabIndex = spareActive ? -1 : 0;
    if (e) e.tabIndex = spareActive ? -1 : 0;
    _syncOtherRdwWarn(row);
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
    row.classList.remove('other-spare');   // clear any stale Spare-mode when (re)activating a type
    row.dataset.type = type;
    // Other-family options strip: visible only while the Other pill is active. The RDW tick
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
    _syncOverwriteBadge(row);
}

/**
 * Sync a day-row's overwrite badge to its state, relative to the override it was loaded with:
 *   • prefilled-existing (loaded, untouched) → "✓ Saved"    — already recorded, no change staged
 *   • active with a type   (a change staged)  → "⚠ Updating" — will overwrite the saved one on Save
 *   • deactivated          (unticked)         → "⚠ Removing" — the saved override is deleted on Save
 * No-op on rows with no saved override (they have no .overwrite-badge).
 * @param {HTMLElement} row
 */
function _syncOverwriteBadge(row) {
    const badge = row.querySelector('.overwrite-badge');
    if (!badge) return;
    badge.textContent = row.classList.contains('prefilled-existing') ? '✓ Saved'
        : row.dataset.type ? '⚠ Updating'
        : '⚠ Removing';
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
    row.classList.remove('active', 'fixed-type', 'selected', 'row-error', 'other-spare');
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
    // Reset the Other sub-controls: NO flavour selected (an explicit pick is required —
    // no silent Training default), no RDW, hidden.
    const otherOpts = /** @type {HTMLElement|null} */ (row.querySelector('.other-opts'));
    if (otherOpts) {
        otherOpts.hidden = true;
        row.querySelectorAll('.other-flavour-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-pressed', 'false');
        });
        const cb = /** @type {HTMLInputElement|null} */ (row.querySelector('.other-rdw-cb'));
        if (cb && !cb.disabled) cb.checked = false;   // rest-day rows keep their baked tick (RDW is automatic)
        _syncOtherRdwWarn(row);
    }
    _syncOverwriteBadge(row);
}

export function updateSaveBtn() {
    const weekGrid = document.getElementById('weekGrid');
    const saveBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('saveBtn'));
    if (!weekGrid || !saveBtn) return;
    const rows       = /** @type {HTMLElement[]} */ ([...weekGrid.querySelectorAll('.day-row')]);
    rows.forEach(_syncOverwriteBadge); // keep every overwrite badge in step with its row's state
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

    // Inline change preview (v15.58) — a calm "what you're about to do" line above the
    // Save button, naming the member so a wrong-person / wrong-count edit is caught before
    // saving. Type-neutral copy; reuses the counts already computed above.
    const gridPreview = document.getElementById('gridPreview');
    let previewShown = false;
    if (gridPreview) {
        const memberName = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value;
        if (total > 0 && memberName) {
            // THE VERB BELONGS TO EACH CLAUSE, NOT TO THE SENTENCE (v21.40). This used to read
            // "You're about to save <n days to change>", which is what you get when one fixed verb
            // has to cover both halves — and it was worse on a pure deletion ("about to save 2 to
            // remove"). Each clause carries its own verb, so every combination is a sentence.
            const bits = [];
            if (saveCount) bits.push(`change <strong>${saveCount} day${saveCount > 1 ? 's' : ''}</strong>`);
            if (delCount)  bits.push(`remove <strong>${delCount} change${delCount > 1 ? 's' : ''}</strong>`);
            // #gridPreview is an aria-live region, and updateSaveBtn() also fires on every
            // time-input keystroke — only rewrite (and thus re-announce) when the summary
            // actually changes, so typing a shift time doesn't re-read the unchanged sentence.
            const sig = `${saveCount}|${delCount}|${memberName}`;
            if (gridPreview.dataset.sig !== sig) {
                gridPreview.innerHTML = `<span aria-hidden="true">🗓️</span> <span>You're about to ${bits.join(' and ')} for <strong>${escapeHtml(memberName)}</strong>.</span>`;
                gridPreview.dataset.sig = sig;
            }
            gridPreview.hidden = false;
            previewShown = true;
        } else {
            gridPreview.hidden = true;
            gridPreview.textContent = '';
            delete gridPreview.dataset.sig;
        }
    }

    const hint = document.getElementById('saveBtnHint');
    if (hint) {
        // Blank the hint only when the preview above is actually carrying the summary; if the
        // preview isn't showing (no member selected, or stale HTML without #gridPreview) fall
        // back to the guidance so there's never an enabled Save with no on-screen explanation.
        hint.textContent = previewShown ? '' : 'Select a type on at least one day, then tap Save changes';
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
    if (bulkTypePills) bulkTypePills.querySelectorAll('.type-pill-btn').forEach(p => { p.classList.remove('active'); p.setAttribute('aria-pressed', 'false'); });
    if (bulkTimeGroup) bulkTimeGroup.style.display = 'none';
    if (bulkStart) bulkStart.value = '';
    if (bulkEnd)   bulkEnd.value   = '';
    // Write the LABEL span, not the button's textContent — the button also carries the
    // step-number circle (.bulk-step-num), which textContent would wipe (v16.73).
    const bulkApplyLabel = document.getElementById('bulkApplyLabel');
    if (bulkApplyLabel) bulkApplyLabel.textContent = 'Apply to ticked days';
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
                const bulkApplyLabel = document.getElementById('bulkApplyLabel');
                if (bulkApplyLabel) bulkApplyLabel.textContent = `Apply “${TYPES[type]?.label ?? type}” to ticked days`;
                if (bulkTimeGroup) bulkTimeGroup.style.display = (TYPES[type] && !TYPES[type].fixed) ? 'flex' : 'none';
                if (bulkStart) bulkStart.value = '';
                if (bulkEnd)   bulkEnd.value   = '';
            });
        });
    }

    /**
     * Deselect one out-of-selection row for the bulk tick buttons (v16.23). Three cases:
     *  · UNTOUCHED prefilled row (existingId + prefilled-existing): visually uncheck only —
     *    _deactivateRow would clear dataset.type and stage a DELETE of the saved doc.
     *  · EDITED saved-override row (existingId, prefilled class removed): leave the checkbox
     *    CHECKED and the edit staged — unchecking it visually while the collector still saved
     *    the edit made the box lie, and deactivating staged a silent delete. The bulk buttons
     *    only tick days; they never unstage an edit.
     *  · Plain staged row (no existingId): deactivate as before. Returns true when staged
     *    state actually changed (drives _markChanged, which must not fire for mere ticking).
     * @param {HTMLElement} row @param {HTMLInputElement} checkbox
     * @returns {boolean} staged state changed
     */
    function _bulkDeselectRow(row, checkbox) {
        if (row.dataset.existingId) {
            if (row.classList.contains('prefilled-existing')) {
                checkbox.checked = false;
                row.classList.remove('selected');
            }
            return false;   // edited row: untouched (checkbox stays ticked, edit stays staged)
        }
        const hadStaged = !!row.dataset.type;
        _deactivateRow(row, checkbox, row.querySelectorAll('.type-pill-btn'),
            /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start')),
            /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end')));
        return hadStaged;
    }

    document.getElementById('bulkSelMonFri')?.addEventListener('click', () => {
        let stagedChanged = false;
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const dayIdx   = parseISODate((row.dataset.date ?? '')).getDay();
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox) return;
            if (dayIdx >= 1 && dayIdx <= 5) {
                checkbox.checked = true;
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                stagedChanged = _bulkDeselectRow(row, checkbox) || stagedChanged;
            }
        });
        // Only when staged state genuinely changed — mere ticking stages nothing, and a false
        // unsaved-changes flag also froze the admin week-swipe gesture (v16.23).
        if (stagedChanged) _markChanged();
        updateSaveBtn(); _updateBulkSelCount();
    });

    document.getElementById('bulkSelWorking')?.addEventListener('click', () => {
        let stagedChanged = false;
        const memberName = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value;
        const member = memberName ? teamMembers.find(m => m.name === memberName) : null;
        // Build priority-correct override map once — manual beats roster_import per date.
        const selMemberDateMap = memberName ? buildMemberDateMap(memberName) : null;
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const dateISO  = row.dataset.date ?? '';
            const date     = parseISODate(dateISO);
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
                stagedChanged = _bulkDeselectRow(row, checkbox) || stagedChanged;   // see bulkSelMonFri (v16.23)
            }
        });
        if (stagedChanged) _markChanged();
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
        // No _markChanged: ticking alone stages nothing (the collector keys off dataset.type).
        updateSaveBtn(); _updateBulkSelCount();
    });

    bulkApplyBtn?.addEventListener('click', () => {
        if (!_bulkActiveType) { _showError('Choose a type in step 2 first, then tap Apply.'); return; }
        const typeMeta = TYPES[_bulkActiveType];
        let ticked = 0, applied = 0, sundaySkipped = 0;
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox || !checkbox.checked) return;
            ticked++;
            if (isForbiddenOnSunday(_bulkActiveType) && isSunday(row.dataset.date ?? '')) { sundaySkipped++; return; } // Layer 2 of the Sunday rule — the list is `SUNDAY_FORBIDDEN_TYPES` (override-utils.js).
            const pills   = row.querySelectorAll('.type-pill-btn');
            const startEl = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
            const endEl   = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
            _activateRow(row, checkbox, pills, startEl, endEl, _bulkActiveType);
            row.classList.remove('prefilled-existing'); // mark as user-edited, not pre-filled
            applied++;
            if (typeMeta && !typeMeta.fixed) {
                if (bulkStart?.value && startEl) startEl.value = bulkStart.value;
                if (bulkEnd?.value && endEl)     endEl.value   = bulkEnd.value;
            }
        });
        // Silent-no-op fixes: "Apply" used to do nothing (no feedback) when no days were
        // ticked, or when the only ticked day was a Sunday that AL/Absent/Other skips.
        if (ticked === 0)  { _showError('Tick some days first — use the buttons above, or tap the day checkboxes.'); return; }
        if (applied === 0) { _showError('Nothing applied — Sunday is not a contracted day. Tick a working day.'); return; }
        _markChanged();
        updateSaveBtn();
        _updateBulkSelCount();
        // Tell the user when ticked Sundays were dropped, so "All 7 → 6 applied" isn't a surprise.
        if (sundaySkipped > 0) _showSuccess(`Set ${applied} day${applied !== 1 ? 's' : ''} — Sunday skipped (not a contracted day).`);
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
        const invalid = !TIME_RE.test(val);
        timeInput.classList.toggle('input-error', invalid);
        // Expose the failure to assistive tech, not just via the CSS class. The input
        // already points at its error span through aria-describedby.
        if (invalid) timeInput.setAttribute('aria-invalid', 'true');
        else timeInput.removeAttribute('aria-invalid');
    });
}
