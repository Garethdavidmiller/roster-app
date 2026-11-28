// @ts-check
/**
 * admin-bulk-bar.js — the week card's bulk bar: tick days, choose a type, "Apply to ticked days".
 *
 * Owns: the type armed on the bar, its count and greyed-out Apply (the rule is `bulkApplyWaitingFor`,
 *   admin-bulk-apply.js, beside this), the three tick buttons, and the Apply press that stages each ticked row.
 * Does NOT own: the rows' look in each state (`_activateRow` / `_deactivateRow`, admin-week-row-state.js), the
 *   grid, the Save button's read of what is staged, or any save (admin-week-editor.js).
 *
 * WHY IT LEFT admin-week-editor.js (28 Nov 2026): the editor stood at 800 of its 800-line cap. In v23.98 this bar
 * lost to the row-state cluster as a seam because it needed seven injected dependencies; the row functions have
 * since become importable and the bar's refusals say themselves beside it, so it is told four things — the
 * member's records, the dirty marker, the success line and the editor's recount (`updateSaveBtn`). The recount
 * is INJECTED, not imported, because the editor calls `updateBulkSelCount` from it: importing it back would be a
 * cycle. Tested by test/admin-bulk-bar.test.mjs and, through the page, e2e/admin-week-grid.spec.js.
 */

import { teamMembers, getBaseShift, isSunday, parseISODate } from './roster-data.js';
import { isRestShift, isForbiddenOnSunday, isBeforeMemberStart } from './override-utils.js';
import { isWorkingDate } from './al-entitlement.js';
import { formatDisplay } from './admin-period-dates.js';
import { isChristmasClosureDate } from './christmas-leave.js';
import { TYPES } from './admin-shift-types.js';
import { bulkApplyWaitingFor, bulkSkippedLine } from './admin-bulk-apply.js';
import { _activateRow, _deactivateRow } from './admin-week-row-state.js';
import { setStatus } from './status-text.js';

/** The type currently armed on the bulk bar. */
let _bulkActiveType = '';

/** What the bar is told by the editor that wires it (see the header). */
let _deps = {
    /** @type {(m: string) => Map<string, any>} */ memberDateMap: () => new Map(),
    /** @type {() => void} */ markChanged: () => {},
    /** @type {(msg: string, lines?: string[], o?: { toast?: boolean }) => void} */ showSuccess: () => {},
    /** @type {() => void} */ recount: () => {},
};

/** A bulk-bar refusal, said BESIDE the bar (desktop audit: at the card's foot it sat under the Unsaved bar). '' clears. */
const _bulkSay = (/** @type {string} */ msg) => { const el = document.getElementById('bulkFeedback');
    if (el) { el.className = msg ? 'feedback error' : 'feedback'; setStatus(el, msg ? '⚠ ' + msg : ''); } };

/** The bulk bar as the grid stands — recounted by the editor's `updateSaveBtn` on every change: the count, and Apply greyed out with the reason under it (admin-bulk-apply.js). */
export function updateBulkSelCount() {
    _bulkSay('');   // whatever a press refused, the bar has changed since
    const ticked = [...(document.getElementById('weekGrid')?.querySelectorAll('.day-cb:checked') ?? [])]
        .map(cb => /** @type {HTMLElement|null} */ (cb.closest('.day-row'))?.dataset.date ?? ''), n = ticked.length;
    const why = bulkApplyWaitingFor(ticked, _bulkActiveType, _leftAloneBy(_bulkActiveType));
    const count = document.getElementById('bulkSelCount'), hint = document.getElementById('bulkApplyHint');
    const apply = /** @type {HTMLButtonElement|null} */ (document.getElementById('bulkApplyBtn'));
    if (count) count.textContent = n > 0 ? `${n} day${n > 1 ? 's' : ''} selected` : '';
    if (apply) apply.disabled = !!why;
    if (hint && hint.textContent !== why) hint.textContent = why;
}

/**
 * Why Apply leaves a ticked day alone for `type`, beyond the Sunday rule (admin-bulk-apply.js names
 * each): before the member's start date, or — for Absent — a rest day by `isWorkingDate`, so a
 * swapped-in shift saved on a rest day counts as work here too. (The Absence card also passes over a rest
 * day's RDW or free leave, which an absence would hide; the grid records what it is told on such a day.)
 * @param {string} type @returns {(date: string) => import('./admin-bulk-apply.js').LeftAlone}
 */
function _leftAloneBy(type) {
    const name   = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value ?? '';
    const member = teamMembers.find(m => m.name === name);
    const map    = member && type === 'sick' ? _deps.memberDateMap(name) : null;
    return d => !member ? '' : isBeforeMemberStart(member, parseISODate(d)) ? 'start'
        : !map || isWorkingDate(member, d, map) ? ''
        // Christmas Day and Boxing Day are named as themselves; then rest by the base roster, or a working day
        // a SAVED change has set as rest — each said apart (admin-bulk-apply.js).
        : isChristmasClosureDate(d) ? 'christmas'
        : isRestShift(getBaseShift(member, parseISODate(d))) ? 'rest' : 'setRest';
}

// ── BULK BAR ──────────────────────────────────────────────────────────────────
/**
 * Clears the active bulk-bar type pill, hides the time inputs, resets values, and recounts the
 * "N days selected" line — here, because a week SWIPE settles by calling this on a fresh panel.
 */
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
    // The LABEL span, not the button's textContent, which would wipe its step-number circle.
    const bulkApplyLabel = document.getElementById('bulkApplyLabel');
    if (bulkApplyLabel) bulkApplyLabel.textContent = 'Apply to ticked days';
    updateBulkSelCount();
}

/**
 * Wire the bar's listeners — ONCE per page life: the editor calls this inside its own once-only guard, and the
 * deps it passes read the editor's live state, so nothing here needs re-telling.
 * @param {typeof _deps} deps
 */
export function initBulkBar(deps) {
    _deps = deps;
    const bulkTypePills = document.getElementById('bulkTypePills');
    const bulkTimeGroup = document.getElementById('bulkTimeGroup');
    const bulkStart     = /** @type {HTMLInputElement|null} */ (document.getElementById('bulkStart'));
    const bulkEnd       = /** @type {HTMLInputElement|null} */ (document.getElementById('bulkEnd'));
    const bulkApplyBtn  = /** @type {HTMLButtonElement|null} */ (document.getElementById('bulkApplyBtn'));
    const weekGrid      = document.getElementById('weekGrid');

    if (bulkTypePills) {
        // DELEGATED ON THE CONTAINER: `#bulkTypePills` ships empty and `admin-app.js` fills it at init,
        // and the wiring runs once — per-pill listeners would depend on the order and die on a rebuild.
        bulkTypePills.addEventListener('click', (e) => {
            const pill = /** @type {HTMLButtonElement|null} */ (
                /** @type {Element} */ (e.target).closest('.type-pill-btn'));
            if (!pill || !bulkTypePills.contains(pill)) return;
            const type    = pill.dataset.type ?? '';
            const already = pill.classList.contains('active');
            resetBulkPills();   // pills, times, label and Apply back to rest; a second press stops there
            if (already) return;
            pill.classList.add('active');
            pill.setAttribute('aria-pressed', 'true');
            _bulkActiveType = type; updateBulkSelCount();
            const bulkApplyLabel = document.getElementById('bulkApplyLabel');
            if (bulkApplyLabel) bulkApplyLabel.textContent = `Apply “${TYPES[type]?.label ?? type}” to ticked days`;
            if (bulkTimeGroup) bulkTimeGroup.style.display = (TYPES[type] && !TYPES[type].fixed) ? 'flex' : 'none';
        });
    }

    /**
     * Deselect one out-of-selection row for the bulk tick buttons. Three cases:
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
        // Only when staged state changed — ticking stages nothing, and a false flag freezes the week swipe.
        if (stagedChanged) _deps.markChanged();
        _deps.recount();
    });

    document.getElementById('bulkSelWorking')?.addEventListener('click', () => {
        let stagedChanged = false;
        const memberName = /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value;
        const member = memberName ? teamMembers.find(m => m.name === memberName) : null;
        // Priority-correct, once: manual beats roster_import per date.
        const selMemberDateMap = memberName ? _deps.memberDateMap(memberName) : null;
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const dateISO  = row.dataset.date ?? '';
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox) return;
            // The cards' rule (`isWorkingDate`): a saved rest-day correction makes a day rest, and a
            // shift swapped onto a rest day makes it worked — the AL card charges that day, so this ticks it.
            if (member && selMemberDateMap && isWorkingDate(member, dateISO, selMemberDateMap)) {
                checkbox.checked = true;
                if (!row.dataset.type) row.classList.add('selected');
            } else {
                stagedChanged = _bulkDeselectRow(row, checkbox) || stagedChanged;   // see bulkSelMonFri
            }
        });
        if (stagedChanged) _deps.markChanged();
        _deps.recount();
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
        _deps.recount();
    });

    bulkApplyBtn?.addEventListener('click', () => {
        if (!_bulkActiveType) { _bulkSay('Choose a type in step 2 first, then select Apply.'); return; }
        const typeMeta = TYPES[_bulkActiveType], leftAlone = _leftAloneBy(_bulkActiveType);
        let applied = 0;
        /** @type {string[]} */ const ticked = [];
        /** @type {Array<{ date: string, why: 'sunday' | 'rest' | 'setRest' | 'christmas' | 'start' }>} */ const skipped = [];
        weekGrid?.querySelectorAll('.day-row').forEach(rowEl => {
            const row      = /** @type {HTMLElement} */ (rowEl);
            const checkbox = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-cb'));
            if (!checkbox || !checkbox.checked) return;
            const date = row.dataset.date ?? '';
            ticked.push(date);
            if (isForbiddenOnSunday(_bulkActiveType) && isSunday(date)) { skipped.push({ date, why: 'sunday' }); return; } // Layer 2 of the Sunday rule — the list is `SUNDAY_FORBIDDEN_TYPES` (override-utils.js).
            const why = leftAlone(date);
            if (why) { skipped.push({ date, why }); return; }   // Absent on a rest day; any day before the start date
            const pills   = row.querySelectorAll('.type-pill-btn');
            const startEl = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-start'));
            const endEl   = /** @type {HTMLInputElement|null} */ (row.querySelector('.day-end'));
            // User-edited — cleared FIRST, so _activateRow sees a staged row (the swap question asks only one).
            row.classList.remove('prefilled-existing');
            _activateRow(row, checkbox, pills, startEl, endEl, _bulkActiveType);
            applied++;
            if (typeMeta && !typeMeta.fixed) {
                if (bulkStart?.value && startEl) startEl.value = bulkStart.value;
                if (bulkEnd?.value && endEl)     endEl.value   = bulkEnd.value;
            }
        });
        // Backstops: Apply is greyed out for both of these before a press (admin-bulk-apply.js).
        if (!ticked.length) { _bulkSay('Tick some days first — use the buttons above, or tick days in the week below.'); return; }
        if (applied === 0)  { _bulkSay(bulkApplyWaitingFor(ticked, _bulkActiveType, leftAlone) || 'Nothing applied.'); return; }
        _deps.markChanged();
        _deps.recount();   // …and with it the bulk bar's count and Apply
        // Name the ticked days left alone, so "All 7 → 4 applied" isn't a surprise.
        const said = bulkSkippedLine(applied, skipped, formatDisplay);
        if (said) _deps.showSuccess(said, undefined, { toast: false });   // staged, not saved: never the save's toast
    });
}
