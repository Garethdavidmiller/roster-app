// @ts-check
/**
 * paycalc-settings.js — Grade/contracted-hours helpers and Settings save/load.
 *
 * Owns: grade cache, getContr/getLoggedMember/getEffectiveContr/getProRateFactor/
 *   getPensionDefault, updateRateForPeriod, updateYtdForTaxYear, settingsKey,
 *   saveSettings, confirmSettings, setSettingsCardOpen, loadSettings.
 * Does NOT own: period arithmetic (paycalc-periods.js), pay maths (paycalc-calc.js),
 *   roster hints (paycalc-app.js).
 * Edit here for: grade helpers, settings persistence, rate/YTD field updates.
 * Do not edit here for: pay maths, period date maths, roster pre-fill.
 */

import { GRADES, getTaxYearForOffset, calcProRateFactor, getPensionForPeriod } from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum } from './paycalc-periods.js';
import { SK, periodKey, ytdPayKey, ytdTaxKey, pcPrefix } from './paycalc-migrations.js';
import { getSession } from './session.js';
import { teamMembers } from './roster-data.js';
import { lsGet, lsSet } from './ls.js';

// ── GRADE CACHE ───────────────────────────────────────────────────────────────
// lsGet is called in calculate() / calcHPP() on every keystroke; the grade only
// changes when the user picks a different one in Settings.
/** @type {any} */
let _gradeCache = null;
/** Return the stored grade key (e.g. 'cea'). */
export function getGrade() {
  if (_gradeCache !== null) return _gradeCache;
  _gradeCache = lsGet(SK.grade) || '';
  return _gradeCache;
}
function invalidateGrade() { _gradeCache = null; }

/** Return contracted hours for the currently selected grade. */
export function getContr() {
  const g = getGrade();
  return (g && GRADES[g]) ? GRADES[g].contr : GRADES.cea.contr;
}

/** Return the teamMembers entry for the logged-in session user, or null. */
export function getLoggedMember() {
  const sess = getSession();
  if (!sess?.name) return null;
  return teamMembers.find(m => m.name === sess.name) || null;
}

/**
 * Return effective contracted hours for the given period, pro-rated if the
 * logged-in member started mid-period.
 * @param {any} p - Period object with .start and .cutoff Date properties.
 * @returns {number} Contracted hours (full or pro-rated).
 */
export function getEffectiveContr(p) {
  const base   = getContr();
  if (!p) return base;
  if (getLoggedMember()?.noProRate) return base;
  const factor = calcProRateFactor(getLoggedMember()?.startDate, p.start, p.cutoff);
  return factor === 1 ? base : Math.round(base * factor);
}

/** Returns the fraction of the period that the logged-in member was employed.
 *  Delegates to calcProRateFactor (paycalc-calc.js) — see that function for
 *  the formula invariant and why startDate must be midnight local time. */
/** @param {any} p */
export function getProRateFactor(p) {
  if (!p) return 1;
  if (getLoggedMember()?.noProRate) return 1;
  return calcProRateFactor(getLoggedMember()?.startDate, p.start, p.cutoff);
}

/** Full-period pension default for the current grade, period-aware.
 *  Pass a period object to get the correct rate for that payday (handles cut-overs). */
/** @param {any} [pObj] */
export function getPensionDefault(pObj) {
  const g = getGrade();
  const grade = g && GRADES[g] ? g : 'cea';
  if (pObj?.payday) return getPensionForPeriod(grade, pObj.payday);
  return GRADES[grade]?.pension ?? '';
}

// ── PER-TAX-YEAR RATE ─────────────────────────────────────────────────────────
// Loads the stored rate for the given tax year into the hourly rate field.
// Falls back to the legacy single rate, then to the current grade's default.
/**
 * Stored hourly rate for a tax year (pure — no DOM). Falls back to the legacy single-rate key, then
 * the grade default. Use this wherever a SPECIFIC tax year's rate is needed (e.g. the prior-year HPP
 * estimate) — reading the live `hourlyRate` field or the current grade default gives the wrong year's
 * rate after an April pay award.
 *
 * `useLegacyFallback` (default true) controls the middle leg — the legacy single `SK.rate` key. That
 * key holds the LAST-SAVED rate (not year-specific), so it is the right migration fallback when
 * loading a rate into the field, but WRONG for a PRIOR year's estimate: after an award it would price
 * last year at the new rate. Callers estimating a specific past year (updatePriorHpp) pass `false` so
 * an absent per-year rate falls straight through to the grade default instead.
 * @param {any} ty
 * @param {boolean} [useLegacyFallback=true]
 * @returns {number}
 */
export function getStoredRateForYear(ty, useLegacyFallback = true) {
  /** @type {Record<string, any>} */
  let rates = {};
  try { rates = JSON.parse(lsGet(SK.rates) || '{}'); } catch(_e) { console.warn('[PayCalc] Rates store corrupted'); }
  const g = getGrade();
  return rates[ty.label]
      || (useLegacyFallback ? parseFloat(lsGet(SK.rate) ?? '') : 0)
      || (g && GRADES[g] ? GRADES[g].rate : GRADES.cea.rate);
}

/** Load the stored rate for the given tax year into the hourly rate field. */
/** @param {any} ty */
export function updateRateForPeriod(ty) {
  const rate = getStoredRateForYear(ty);
  /** @type {HTMLInputElement} */ (document.getElementById('hourlyRate')).value = rate.toFixed(2);
  // Update label to show which tax year this rate applies to
  const lbl = document.getElementById('rateYearLabel');
  if (lbl) lbl.textContent = `for ${ty.label}`;
}

/** Load the stored Year to Date figures for this tax year into the Improve Accuracy fields.
 *  Called from onPeriodChange() so values reset correctly when switching between tax years. */
/** @param {any} ty */
export function updateYtdForTaxYear(ty) {
  const payEl = /** @type {HTMLInputElement} */ (document.getElementById('ytdPay'));
  const taxEl = /** @type {HTMLInputElement} */ (document.getElementById('ytdTax'));
  if (!payEl || !taxEl) return;
  if (document.activeElement !== payEl) payEl.value = lsGet(ytdPayKey(ty)) || '';
  if (document.activeElement !== taxEl) taxEl.value = lsGet(ytdTaxKey(ty)) || '';
}

// ── SETTINGS SAVE / LOAD ──────────────────────────────────────────────────────

/** Per-tax-year localStorage key for the "confirmed" flag. */
/** @param {any} ty */
export function settingsKey(ty) { return `${pcPrefix()}setup_${ty.label.replace('/', '_')}`; }

/** Persist all field values. Called on every input change (auto-save).
 *  Does NOT set the confirmed flag or collapse the card — that's confirmSettings(). */
export function saveSettings() {
  const rateVal = /** @type {HTMLInputElement} */ (document.getElementById('hourlyRate')).value;
  const pNum    = currentPeriodNum();
  const curP    = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
  const curTy   = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  /** @type {Record<string, any>} */
  let rates = {};
  try { rates = JSON.parse(lsGet(SK.rates) || '{}'); } catch(_e) { console.warn('[PayCalc] Rates store corrupted, resetting'); }
  const _savedGrade   = /** @type {HTMLSelectElement} */ (document.getElementById('gradeSelect')).value;
  const _gradeDefault = GRADES[_savedGrade]?.rate ?? GRADES.cea.rate;
  rates[curTy.label] = parseFloat(rateVal) || _gradeDefault;
  lsSet(SK.rates,     JSON.stringify(rates));
  lsSet(SK.rate,      rateVal);
  lsSet(SK.code,      /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value);
  lsSet(SK.sl,        /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value);
  // Save grade and invalidate cache before getPensionDefault — it calls getGrade()
  // which reads the cache; if the user changed grade, the cache still holds the old
  // value at this point, so getPensionDefault would return the wrong pension amount.
  lsSet(SK.grade, /** @type {HTMLSelectElement} */ (document.getElementById('gradeSelect')).value);
  invalidateGrade();
  // On a joining period the pension field shows the pro-rated amount.
  // Always write the full-period default to SK.pension so future full periods
  // don't inherit the pro-rated value as their default.
  const _pensionToSave = getProRateFactor(curP) < 1
    ? getPensionDefault(curP)
    : /** @type {HTMLInputElement} */ (document.getElementById('pensionAmt')).value;
  lsSet(SK.pension, _pensionToSave);
  lsSet(ytdPayKey(curTy), /** @type {HTMLInputElement} */ (document.getElementById('ytdPay')).value);
  lsSet(ytdTaxKey(curTy), /** @type {HTMLInputElement} */ (document.getElementById('ytdTax')).value);
}

/**
 * Called by the Save button. Saves, marks this tax year as confirmed,
 * updates the card header hint, collapses the card.
 * @param {Function} calculate - Coordinator's calculate() callback.
 */
export function confirmSettings(calculate) {
  saveSettings();
  const pNum  = currentPeriodNum();
  const curP  = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
  const curTy = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  // If this period already has saved hours, patch its pension value in-place.
  const existingRaw = lsGet(periodKey(pNum));
  if (existingRaw) {
    try {
      const d = JSON.parse(existingRaw);
      // Blank field → null (loadPeriodData re-applies the period default), NOT 0. Coercing blank to
      // 0 here persisted a permanent £0 pension for the period — the same overstatement the
      // readFormData/calculate null convention closes. A typed "0" is a genuine opt-out and is kept.
      const _pRaw = /** @type {HTMLInputElement} */ (document.getElementById('pensionAmt')).value.trim();
      d.pension = _pRaw === '' ? null : (parseFloat(_pRaw) || 0);
      lsSet(periodKey(pNum), JSON.stringify(d));
    } catch {}
  }
  lsSet(settingsKey(curTy), '1');
  lsSet(SK.setup, '1');
  document.getElementById('setupBanner')?.classList.add('hidden');
  document.getElementById('settingsNewYearNotice')?.classList.add('hidden');
  // Update header hint. Fall back to grade default when rate field is blank.
  const _cfGrade = getGrade();
  const rate = (parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('hourlyRate')).value)
    || (GRADES[_cfGrade]?.rate ?? GRADES.cea.rate)).toFixed(2);
  const code = (/** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value || '1257L').toUpperCase();
  const hintEl = document.getElementById('settingsHint');
  if (hintEl) hintEl.textContent = `✓ ${curTy.label} — £${rate}/hr · ${code}`;
  // Brief "saved" confirmation then collapse
  const fb = document.getElementById('settingsSaveFeedback');
  if (fb) fb.textContent = '✓ Settings saved';
  setTimeout(() => {
    if (fb) fb.textContent = '';
    setSettingsCardOpen(false);
  }, 2500);
  calculate();
}

/** Programmatic open/close for the Settings card — keeps aria-expanded in
 *  sync with the classes that initCardCollapse manages on user toggles. */
/** @param {any} open */
export function setSettingsCardOpen(open) {
  const toggle = document.getElementById('settingsToggle');
  const body   = document.getElementById('settingsBody');
  if (toggle) toggle.classList.toggle('open', open);
  if (body)   body.classList.toggle('open', open);
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
}

/** Load persisted settings into the form fields. */
export function loadSettings() {
  // Rate is set per-period in updateRateForPeriod() called from onPeriodChange —
  // no need to set it here; the field will update when buildPeriodSelect fires.
  const code    = lsGet(SK.code);
  const sl      = lsGet(SK.sl);
  const pension = lsGet(SK.pension);
  const done    = lsGet(SK.setup);
  if (code)    /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value     = code.toUpperCase();
  if (sl)      /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value = sl;
  let grade = lsGet(SK.grade);
  if (!grade || !GRADES[grade]) {
    // Auto-detect from the logged-in member's role
    if (getLoggedMember()?.role === 'CES') grade = 'ces';
  }
  if (grade && GRADES[grade]) {
    /** @type {HTMLSelectElement} */ (document.getElementById('gradeSelect')).value = grade;
    lsSet(SK.grade, grade);
    invalidateGrade();
  }
  /** @type {HTMLInputElement} */ (document.getElementById('pensionAmt')).value = pension ?? getPensionDefault();
  // Settings card starts closed in HTML. Open it only for first-time users.
  if (!done) {
    setSettingsCardOpen(true);
  } else {
    // Mark all tax years confirmed if the global setup flag was already set (v1.13+)
    CONFIG.TAX_YEARS.forEach(ty => {
      if (!lsGet(settingsKey(ty))) lsSet(settingsKey(ty), '1');
    });
  }
}
