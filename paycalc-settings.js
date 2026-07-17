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

import { GRADES, taxYearForPeriod, calcProRateFactor, getPensionForPeriod, getRateForPeriod, isPreAwardPeriod } from './paycalc-calc.js';
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

/**
 * Load the rate for the given period into the hourly rate field. Period-aware: a period paid
 * BEFORE its tax year's mid-year pay-award date shows the pre-award rate (e.g. 2025/26 periods
 * before 24 Oct 2025 show £20.06, not the settled £20.74) — so the calculator matches the real
 * payslip for historic periods. calculate() reads this field, so no change is needed there.
 * @param {any} ty  - the period's tax year
 * @param {any} [p] - the period (enables the mid-year step; omitted → settled rate only)
 */
export function updateRateForPeriod(ty, p) {
  const grade    = getGrade();
  const settled  = getStoredRateForYear(ty);
  const preAward = !!p && isPreAwardPeriod(p, grade, ty.label);
  const rate     = preAward ? getRateForPeriod(p, grade, ty.label, settled) : settled;
  const field    = /** @type {HTMLInputElement} */ (document.getElementById('hourlyRate'));
  field.value = rate.toFixed(2);
  // On a pre-award period the field shows the fixed HISTORIC rate (a payslip fact, not a setting) —
  // make it read-only so a typed edit isn't silently discarded by saveSettings (which persists the
  // settled rate for that year, never the pre-rise value). Editable again on post-award/current periods.
  field.readOnly = preAward;
  field.title    = preAward ? 'Rate paid before this year’s mid-year pay rise — fixed for this period' : '';
  // Label: show the tax year, and flag when the pre-rise rate is in effect so a user checking an
  // early-in-the-year payslip isn't surprised the rate is lower than the settled one.
  const lbl = document.getElementById('rateYearLabel');
  if (lbl) lbl.textContent = preAward ? `for ${ty.label} · pre-rise rate` : `for ${ty.label}`;
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
  const curTy   = taxYearForPeriod(curP);
  /** @type {Record<string, any>} */
  let rates = {};
  try { rates = JSON.parse(lsGet(SK.rates) || '{}'); } catch(_e) { console.warn('[PayCalc] Rates store corrupted, resetting'); }
  const _savedGrade   = /** @type {HTMLSelectElement} */ (document.getElementById('gradeSelect')).value;
  const _gradeDefault = GRADES[_savedGrade]?.rate ?? GRADES.cea.rate;
  const _fieldRate    = parseFloat(rateVal) || _gradeDefault;
  // Guard the SETTLED rate on a pre-award period: the field shows that period's OLD (pre-rise)
  // rate, so never persist it as the year's settled rate. Store the settled rate instead — mirrors
  // the pension pro-rate guard below. (On a normal/post-award period _fieldRate is the settled rate.)
  // Uses the shared isPreAwardPeriod predicate (single source, also used by getRateForPeriod).
  const _isPreAward  = !!curP && isPreAwardPeriod(curP, _savedGrade, curTy.label);
  const _rateToSave  = _isPreAward ? getStoredRateForYear(curTy) : _fieldRate;
  rates[curTy.label] = _rateToSave;
  lsSet(SK.rates,     JSON.stringify(rates));
  lsSet(SK.rate,      _rateToSave.toFixed(2));
  lsSet(SK.code,      /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value);
  lsSet(SK.sl,        /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value);
  lsSet(SK.pgLoan,    /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked ? '1' : '');
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
  const curTy = taxYearForPeriod(curP);
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
  let   sl      = lsGet(SK.sl);
  let   pgLoan  = lsGet(SK.pgLoan);
  const pension = lsGet(SK.pension);
  const done    = lsGet(SK.setup);
  if (code)    /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value     = code.toUpperCase();
  // Migration (v17.17): the Student Loan select used to carry 'postgrad' as a plan option; it is now a
  // plan (None/1/2/4/5) PLUS a separate Postgraduate Loan flag, which can apply ALONGSIDE a plan. A saved
  // 'postgrad' selection becomes plan 'none' + PGL on, re-persisted ONCE so it never re-migrates.
  if (sl === 'postgrad') { sl = 'none'; pgLoan = '1'; lsSet(SK.sl, 'none'); lsSet(SK.pgLoan, '1'); }
  if (sl)      /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value = sl;
  /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked = pgLoan === '1';
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
    // One-time legacy migration (was: run on EVERY load). Users who completed setup
    // before per-tax-year confirmation tracking existed have SK.setup but no per-year
    // flags — mark the tax years that exist NOW as confirmed so they aren't re-prompted
    // for a year they already effectively set up.
    //
    // Guarded so it runs ONCE per member: a tax year ADDED LATER must NOT be swept up
    // here, so its "👋 New tax year" setup banner appears the first time the member opens
    // a period in it. Pay rates change every April, so silently carrying the old year's
    // rate into a new one risked a stale-rate calculation with no prompt to review it.
    // (Re-running on every load was what defeated the banner the UI copy already promises.)
    const migratedKey = `${pcPrefix()}setup_years_migrated`;
    if (!lsGet(migratedKey)) {
      CONFIG.TAX_YEARS.forEach(ty => {
        if (!lsGet(settingsKey(ty))) lsSet(settingsKey(ty), '1');
      });
      lsSet(migratedKey, '1');
    }
  }
}
