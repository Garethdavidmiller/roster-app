// @ts-check
/**
 * paycalc-form-data.js — the per-period form ↔ saved-data round trip for paycalc.html.
 *
 * Owns: the saved-period SCHEMA (`emptyPeriodData`) and the two halves of its round trip —
 *   `readFormData` (form → object, for autosave) and `writeFormData` (object → form, for load/clear) —
 *   and the rule that hours on screen supersede the no-special-rate-hours tick (`syncNoSpecialTick`).
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

import { hmPair, numVal } from './paycalc-inputs.js';
import { parseSmartFloatOrNull } from './roster-data.js';
import { minutesFieldText, HM_PAIRS } from './paycalc-format.js';
import { isSavedPeriodShape } from './paycalc-inventory.js';

// isDataEmpty — whether a saved payslip counts as entered — reads this schema's fields and lives in
// paycalc-format.js, the zero-import pure home beside HM_PAIRS; import it from there.

/**
 * The saved-period schema — the shape written to localStorage for one pay period.
 *
 * NOTE: deliberately has NO `pension` key. A cleared period must fall back to the period's own
 * default, and `writeFormData` only restores a pension when the saved value `!= null` — so an
 * ABSENT key and an explicit null both mean "apply the default", while a stored `0` survives as the
 * genuine salary-sacrifice opt-out. Adding `pension: 0` here would silently re-introduce the
 * pre-v16.84 defect for every cleared period.
 *
 * `noSpecialHours` is the "No special-rate hours on this payslip" tick: the zeros were checked, so
 * the payslip counts as entered (isDataEmpty). It is only ever true beside no hours (`readFormData`).
 *
 * @returns {Record<string, any>}
 */
export function emptyPeriodData() {
    return { satH: 0, satM: 0, bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0, otH: 0, otM: 0, rdwH: 0, rdwM: 0,
             sunH: 0, sunM: 0, boxH: 0, boxM: 0, peer: 0, slSkip: false, otherAdj: 0, noSpecialHours: false,
             actualNet: null, actualGross: null, actualTax: null, actualNi: null, actualPension: null };
}

/** Does the form on screen hold any special-rate hours — read as `readFormData` stores them? */
function _specialHoursOnScreen() {
    return HM_PAIRS.some(({ hId, mId }) => { const r = hmPair(hId, mId); return r.h > 0 || r.m > 0; });
}

/**
 * The "No special-rate hours on this payslip" tick (`#noSpecialCheck`) shows only while the payslip
 * on screen holds no special-rate hours, and hours arriving in any box clear it — typed, or the
 * calendar's suggestion shown in gold. HOURS SUPERSEDE THE TICK, so what the tick shows is always what
 * the next save stores (`readFormData` stores it only beside no hours), and a payslip can never say
 * both. Run on every calculate(). The row is hidden by the `hidden` CLASS: `.toggle-row` sets
 * `display`, which out-ranks the `hidden` attribute's own rule.
 */
export function syncNoSpecialTick() {
    const row = document.getElementById('noSpecialRow');
    const tick = /** @type {HTMLInputElement|null} */ (document.getElementById('noSpecialCheck'));
    if (!row || !tick) return;
    const hours = _specialHoursOnScreen();
    row.classList.toggle('hidden', hours);
    if (hours) tick.checked = false;
}

/**
 * What a pension field's text is STORED as — the one rule, shared by `readFormData` (autosave) and
 * `confirmSettings` (the Settings Save patches the on-screen payslip). The Save path had its own
 * `parseFloat(raw) || 0` until the 72-hour review, which froze the default onto the payslip and read
 * a pasted "£151.86" as a £0 opt-out.
 *
 * Blank or garbage → null (the caller re-applies the period default), never 0: a transient blank or a
 * stray "." left mid-edit used to persist as a real £0 opt-out (pre-v16.84 / v16.84). A typed "0" is
 * a genuine opt-out and is kept. Self-heal (v18.43): a value still EQUAL to this period's default is
 * stored as null, so the period keeps following `PENSION_STEPS`; a custom figure persists. Mirrors
 * updateSaveStatus's _hasCustomPension comparison (default × pro-rate, 2dp, ±0.005). A null
 * `periodDefaultPension` skips the self-heal, as the old inline code did when no period was found.
 * @param {string} raw @param {number|null} periodDefaultPension
 * @returns {number|null}
 */
export function pensionToStore(raw, periodDefaultPension) {
    if (String(raw ?? '').trim() === '') return null;
    const v = parseSmartFloatOrNull(raw);
    if (v != null && periodDefaultPension != null && Math.abs(v - periodDefaultPension) < 0.005) return null;
    return v;
}

/** A payslip-actual field: a typed figure, or null for blank/garbage — never a phantom 0.
 * @param {string} id @returns {number|null} */
function _readActual(id) {
    const _el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
    return (_el && _el.value.trim() !== '') ? parseSmartFloatOrNull(_el.value) : null;
}

/**
 * Read the period form into a saveable object.
 *
 * A LOCKED PENSION BOX IS NOBODY'S FIGURE (17 Nov 2026). Inside a pension opt-out spell the box is
 * disabled and reads £0.00 (`applyPensionOptOutUI`), which equals that payslip's default of £0, so the
 * round trip stored "the default" — null — over whatever figure the payslip held. Any edit there, or a
 * Settings save, erased a pension the member had typed, and correcting the opt-out date then brought
 * the payslip back at the scheme default instead of their figure. So while the box is locked the
 * payslip's own saved figure is carried, untouched and dormant (every surface prices a payslip in the
 * spell at £0 whatever it holds — paycalc-3-3).
 *
 * @param {{ adjNegative?: boolean, periodDefaultPension?: number|null, savedPension?: number|null }} [opts]
 *   adjNegative — the coordinator's current ± state for `otherAdj`.
 *   periodDefaultPension — this period's default pension (default × pro-rate, 2dp). Omit or pass
 *   null to skip the self-heal, which is what the old inline code did when no period was found.
 *   savedPension — what this payslip's saved entries hold for the pension (null for none), stored
 *   again unchanged while the box is locked. Every caller that SAVES passes it.
 * @returns {Record<string, any>}
 */
export function readFormData({ adjNegative = false, periodDefaultPension = null, savedPension = null } = {}) {
    const _pa = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));
    // hmPair, not two intVal reads: an hours box still holding "7.5" (not yet blurred) is stored as
    // the 7h 30m the blur would write, never parseInt's 7.
    const _hm = (/** @type {string} */ h, /** @type {string} */ m) => {
        const r = hmPair(h, m);
        return { [h]: r.h, [m]: r.m };
    };
    const _noSpecial = /** @type {HTMLInputElement|null} */ (document.getElementById('noSpecialCheck'));
    return {
        ..._hm('satH', 'satM'), ..._hm('bhH', 'bhM'), ..._hm('bhOtH', 'bhOtM'),
        ..._hm('otH', 'otM'), ..._hm('rdwH', 'rdwM'), ..._hm('sunH', 'sunM'), ..._hm('boxH', 'boxM'),
        peer: +(/** @type {HTMLElement} */ (document.getElementById('peerVal'))).textContent,
        slSkip: /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked,
        // Hours typed supersede the tick, so it is stored only beside none (syncNoSpecialTick).
        noSpecialHours: !!_noSpecial?.checked && !_specialHoursOnScreen(),
        otherAdj: (() => { const _r = Math.abs(numVal('otherAdj') || 0); return adjNegative ? -_r : _r; })(),
        // Blank/garbage → null, a typed "0" kept, the period default → null: `pensionToStore` above.
        // A locked box (an opt-out spell) keeps the payslip's own saved figure — see the header.
        pension: _pa?.disabled ? (savedPension ?? null) : pensionToStore(_pa?.value ?? '', periodDefaultPension),
        // Real take-home from the payslip (v18.42 — review item 3): null when blank/garbage, like
        // pension — mid-edit autosaves must not store a phantom £0 "actual". Deliberately NOT in
        // isDataEmpty: a period with only this figure has no hours to compute from.
        actualNet: _readActual('actualNetInput'),
        // The other payslip lines (v22.07 — the estimate-vs-payslip comparison). Same null-when-
        // blank rule as actualNet, for the same reason: a mid-edit autosave storing £0 "actual
        // tax" would render a confident, wrong difference row. None of them joins isDataEmpty —
        // a period holding only payslip actuals has no hours to compute from.
        actualGross:   _readActual('actualGrossInput'),
        actualTax:     _readActual('actualTaxInput'),
        actualNi:      _readActual('actualNiInput'),
        actualPension: _readActual('actualPensionInput'),
    };
}

/**
 * A SETTING changed (the loan plan, the pension scheme), and the payslip on screen carries a field it
 * touches: what to store, carrying ONLY those fields into the saved entries — or null, when there is
 * nothing readable to carry them into.
 *
 * Not `autosave`, which writes the whole form (whole-app review, Oct 2026). That saved the calendar's
 * display-only suggestion as though the member had entered it (invariant 11: viewing never persists)
 * and wrote over saved entries that could not be read, which only something the member TYPES may
 * replace. A payslip with nothing saved has nothing to keep in step, so it stays unsaved.
 *
 * @param {string|null} raw  what storage holds for the payslip
 * @param {Record<string, any>} formNow  `readFormData`'s answer
 * @param {string[]} fields
 * @returns {string|null}
 */
export function settingFieldsWrite(raw, formNow, fields) {
    if (!raw) return null;
    let saved;
    try { saved = JSON.parse(raw); } catch { return null; }
    // The SHARED shape check (paycalc-inventory.js): a list passed `typeof === 'object'` here and was
    // spread into a fresh record, so a damaged period was rewritten on a mere setting change.
    if (!isSavedPeriodShape(saved)) return null;
    const next = { ...saved };
    for (const f of fields) next[f] = formNow[f];
    return JSON.stringify(next);
}

/**
 * Write a saved period object back into the form.
 *
 * The caller must clear the roster-suggested field highlighting FIRST (`clearRosterSuggestedAll()`
 * from paycalc-roster-hint.js) — it used to be this function's opening statement, but importing
 * that module here would drag its seven-module graph into what is otherwise a document-only unit,
 * and force every test of this file through module mocks.
 *
 * `only` writes just the named SAVED fields (`satH`, `peer`, `pension`…) and leaves every other box
 * as it is: a save merged with another tab's (paycalc-period-merge.js) brings the form up to the
 * figures it took from storage, and must not rewrite the box the member is typing in — "7." would
 * become "7" under their cursor. Omitted, every field is written, exactly as before.
 *
 * @param {any} d a saved period object (or `emptyPeriodData()`)
 * @param {{ only?: Set<string> }} [opts]
 * @returns {{ adjNegative: boolean }} the ± state the caller should adopt for `otherAdj`
 */
export function writeFormData(d, { only } = {}) {
    const want = (/** @type {string} */ f) => !only || only.has(f);
    const set = /** @param {string} id @param {any} v */ (id, v) => {
        if (want(id)) /** @type {HTMLInputElement} */ (document.getElementById(id)).value = v || '';
    };
    // A saved non-zero minutes value shows two digits ("05"), as a calendar fill does
    // (`minutesFieldText`). DISPLAY ONLY: readFormData parses the box, so "05" reads back as 5 and the
    // round trip is unchanged. A saved 0 stays BLANK, as it always has — the box's own "00"
    // placeholder shows through, and a blank box is what "nothing entered" checks look for.
    const mins = /** @param {any} v */ v => (v ? minutesFieldText(v) : '');
    set('satH', d.satH || ''); set('satM', mins(d.satM));
    set('bhH',   d.bhH   || ''); set('bhM',   mins(d.bhM));
    set('bhOtH', d.bhOtH || ''); set('bhOtM', mins(d.bhOtM));
    set('otH',   d.otH   || ''); set('otM',   mins(d.otM));
    set('rdwH', d.rdwH || ''); set('rdwM', mins(d.rdwM));
    set('sunH', d.sunH || ''); set('sunM', mins(d.sunM));
    set('boxH', d.boxH || ''); set('boxM', mins(d.boxM));
    if (want('peer')) /** @type {HTMLElement} */ (document.getElementById('peerVal')).textContent = d.peer || 0;
    if (want('slSkip')) /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked = d.slSkip || false;
    const _noSpecial = /** @type {HTMLInputElement|null} */ (document.getElementById('noSpecialCheck'));
    if (_noSpecial && want('noSpecialHours')) _noSpecial.checked = !!d.noSpecialHours;
    const _rawAdj = d.otherAdj ?? 0;
    const adjNegative = _rawAdj < 0;
    if (want('otherAdj')) /** @type {HTMLInputElement} */ (document.getElementById('otherAdj')).value =
        _rawAdj ? Math.abs(_rawAdj).toFixed(2) : '';
    // Restore pension only when period data has a saved value; period-specific default is
    // applied by the caller (loadPeriodData or clearPeriod) when d.pension is null.
    // Loose != null so that pension = 0 (salary sacrifice opted out) is preserved correctly.
    const pa = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));
    if (pa && d.pension != null && want('pension')) pa.value = d.pension;
    const an = /** @type {HTMLInputElement|null} */ (document.getElementById('actualNetInput'));
    if (an && want('actualNet')) an.value = d.actualNet != null ? d.actualNet : '';
    const _actuals = [['actualGrossInput', d.actualGross, 'actualGross'], ['actualTaxInput', d.actualTax, 'actualTax'],
        ['actualNiInput', d.actualNi, 'actualNi'], ['actualPensionInput', d.actualPension, 'actualPension']]
        .filter(([, , field]) => want(String(field)));
    for (const [id, v] of _actuals) {
        const _el = /** @type {HTMLInputElement|null} */ (document.getElementById(String(id)));
        if (_el) _el.value = v != null ? String(v) : '';
    }
    // Saved payslip lines must not be restored into a CLOSED disclosure — the member's own figures
    // (and the comparison table) would be on the page and invisible. Open it when any exist; a
    // period without them leaves the member's open/closed choice alone.
    if (_actuals.some(([, v]) => v != null)) {
        const _btn = document.getElementById('actualMoreBtn');
        const _wrap = document.getElementById('actualMoreWrap');
        if (_btn) _btn.setAttribute('aria-expanded', 'true');
        if (_wrap) _wrap.hidden = false;
    }
    return { adjNegative };
}
