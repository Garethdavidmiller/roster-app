// @ts-check
/**
 * paycalc-form-data.js — the per-period form ↔ saved-data round trip for paycalc.html.
 *
 * Owns: the saved-period SCHEMA (`emptyPeriodData`) and the two halves of its round trip —
 *   `readFormData` (form → object, for autosave) and `writeFormData` (object → form, for load/clear).
 * Does NOT own: WHEN to save or load (paycalc-app.js's autosave/loadPeriodData/clearPeriod), the
 *   storage keys (paycalc-migrations.js), or the field-level parsing primitives (paycalc-inputs.js).
 * Edit here for: adding a saved field, or changing how a field persists.
 *
 * WHY THIS MODULE EXISTS (v19.11). These ~70 lines produced four money-affecting defects in four
 * releases, every one of them the same shape — a value the form could legitimately hold being
 * persisted as something it does not mean:
 *
 *   - pre-v16.84  a blank pension coerced to 0 by `|| 0`, so an autosave firing while the field was
 *                 transiently empty stored a PERMANENT £0 and overstated take-home by ~£147/period.
 *   - v16.84      `numVal` floored garbage to 0, so a stray "." or "-" left mid-edit stored the same
 *                 £0 "opt-out" — identical error, different input.
 *   - v18.42      `actualNet` had the identical shape: a mid-edit autosave stored a phantom £0.
 *   - v18.43      a pension equal to the period default had to become null, or the period froze onto
 *                 an old default and stopped healing when the default changed.
 *
 * Each was fixed by adding a comment. None was covered by a test, because the logic sat inside a
 * 1,963-line coordinator with no seam to test it through. The bug class is a ROUND-TRIP ASYMMETRY —
 * what read stores and what write restores drifting apart — which is exactly what a write→read→write
 * test catches and a comment never can. Hence the extraction: the seam is the point, not the
 * line count.
 *
 * The two coordinator dependencies are INJECTED rather than imported, so this module needs no
 * coordinator state and no module mocks to test:
 *   - `adjNegative` — the ± sign of the "other adjustment", which the coordinator owns because the
 *     sign button, the typed-negative handler and clearPeriod all mutate it.
 *   - `periodDefaultPension` — this period's default (default × pro-rate, 2dp), needed only for the
 *     v18.43 self-heal.
 */

import { intVal, numVal } from './paycalc-inputs.js';
import { parseSmartFloatOrNull } from './roster-data.js';

/**
 * The saved-period schema — the shape written to localStorage for one pay period.
 *
 * NOTE: deliberately has NO `pension` key. A cleared period must fall back to the period's own
 * default, and `writeFormData` only restores a pension when the saved value `!= null` — so an
 * ABSENT key and an explicit null both mean "apply the default", while a stored `0` survives as the
 * genuine salary-sacrifice opt-out. Adding `pension: 0` here would silently re-introduce the
 * pre-v16.84 defect for every cleared period.
 *
 * @returns {Record<string, any>}
 */
export function emptyPeriodData() {
    return { satH: 0, satM: 0, bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0, otH: 0, otM: 0, rdwH: 0, rdwM: 0,
             sunH: 0, sunM: 0, boxH: 0, boxM: 0, peer: 0, slSkip: false, otherAdj: 0, actualNet: null };
}

/**
 * Read the period form into a saveable object.
 *
 * @param {{ adjNegative?: boolean, periodDefaultPension?: number|null }} [opts]
 *   adjNegative — the coordinator's current ± state for `otherAdj`.
 *   periodDefaultPension — this period's default pension (default × pro-rate, 2dp). Omit or pass
 *   null to skip the self-heal, which is what the old inline code did when no period was found.
 * @returns {Record<string, any>}
 */
export function readFormData({ adjNegative = false, periodDefaultPension = null } = {}) {
    return {
        satH: intVal('satH'), satM: intVal('satM'),
        bhH:  intVal('bhH'),  bhM:  intVal('bhM'),
        bhOtH: intVal('bhOtH'), bhOtM: intVal('bhOtM'),
        otH:  intVal('otH'),  otM:  intVal('otM'),
        rdwH: intVal('rdwH'), rdwM: intVal('rdwM'),
        sunH: intVal('sunH'), sunM: intVal('sunM'),
        boxH: intVal('boxH'), boxM: intVal('boxM'),
        peer: +(/** @type {HTMLElement} */ (document.getElementById('peerVal'))).textContent,
        slSkip: /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked,
        otherAdj: (() => { const _r = Math.abs(numVal('otherAdj') || 0); return adjNegative ? -_r : _r; })(),
        // A BLANK pension field must persist as null (→ caller re-applies the period default), not 0.
        // Coercing blank to 0 (the old `|| 0`) permanently stored £0 if autosave fired while the field
        // was transiently empty (e.g. cleared to retype), overstating take-home by ~£147. A typed "0"
        // still stores 0 (a genuine salary-sacrifice opt-out — see writeFormData's `!= null` restore).
        // parseSmartFloatOrNull, NOT numVal||0 (v16.84): numVal floors garbage to 0, so a stray "."
        // or "-" left mid-edit (then autosaved) stored a real £0 opt-out and overstated take-home by
        // ~£147. null (empty OR garbage) means "not provided" → the period default is re-applied on
        // load; a genuine typed "0" parses to 0 and is preserved (the deliberate opt-out).
        pension: (() => {
            const _el = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));
            if (!_el || _el.value.trim() === '') return null;
            const _v = parseSmartFloatOrNull(_el.value);
            // Self-heal (closes the KNOWN_LIMITATIONS "pension default is frozen onto a touched
            // period" deferral, done WITH the pension cut-overs as it prescribed — v18.43): a value
            // still EQUAL to this period's default is stored as null, so the period keeps healing to
            // future default changes; a genuinely custom pension (differs from the default) persists.
            // Mirrors updateSaveStatus's _hasCustomPension comparison (default × pro-rate, 2dp, ±0.005).
            if (_v != null && periodDefaultPension != null
                && Math.abs(_v - periodDefaultPension) < 0.005) return null;
            return _v;
        })(),
        // Real take-home from the payslip (v18.42 — review item 3): null when blank/garbage, like
        // pension — mid-edit autosaves must not store a phantom £0 "actual". Deliberately NOT in
        // isDataEmpty: a period with only this figure has no hours to compute from.
        actualNet: (() => {
            const _el = /** @type {HTMLInputElement|null} */ (document.getElementById('actualNetInput'));
            return (_el && _el.value.trim() !== '') ? parseSmartFloatOrNull(_el.value) : null;
        })(),
    };
}

/**
 * Write a saved period object back into the form.
 *
 * The caller must clear the roster-suggested field highlighting FIRST (`clearRosterSuggestedAll()`
 * from paycalc-roster-hint.js) — it used to be this function's opening statement, but importing
 * that module here would drag its seven-module graph into what is otherwise a document-only unit,
 * and force every test of this file through module mocks.
 *
 * @param {any} d a saved period object (or `emptyPeriodData()`)
 * @returns {{ adjNegative: boolean }} the ± state the caller should adopt for `otherAdj`
 */
export function writeFormData(d) {
    const set = /** @param {string} id @param {any} v */ (id, v) => {
        /** @type {HTMLInputElement} */ (document.getElementById(id)).value = v || '';
    };
    set('satH', d.satH || ''); set('satM', d.satM || '');
    set('bhH',   d.bhH   || ''); set('bhM',   d.bhM   || '');
    set('bhOtH', d.bhOtH || ''); set('bhOtM', d.bhOtM || '');
    set('otH',   d.otH   || ''); set('otM',   d.otM   || '');
    set('rdwH', d.rdwH || ''); set('rdwM', d.rdwM || '');
    set('sunH', d.sunH || ''); set('sunM', d.sunM || '');
    set('boxH', d.boxH || ''); set('boxM', d.boxM || '');
    /** @type {HTMLElement} */ (document.getElementById('peerVal')).textContent = d.peer || 0;
    /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked = d.slSkip || false;
    const _rawAdj = d.otherAdj ?? 0;
    const adjNegative = _rawAdj < 0;
    /** @type {HTMLInputElement} */ (document.getElementById('otherAdj')).value =
        _rawAdj ? Math.abs(_rawAdj).toFixed(2) : '';
    // Restore pension only when period data has a saved value; period-specific default is
    // applied by the caller (loadPeriodData or clearPeriod) when d.pension is null.
    // Loose != null so that pension = 0 (salary sacrifice opted out) is preserved correctly.
    const pa = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));
    if (pa && d.pension != null) pa.value = d.pension;
    const an = /** @type {HTMLInputElement|null} */ (document.getElementById('actualNetInput'));
    if (an) an.value = d.actualNet != null ? d.actualNet : '';
    return { adjNegative };
}
