// @ts-check
/**
 * paycalc-hpp.js — Holiday Pay Premium estimator and shared period helpers.
 *
 * Owns: isDataEmpty, _decodeHours, _varPayForPeriod, calcHPP, updatePriorHpp.
 * Does NOT own: period arithmetic (paycalc-periods.js), settings (paycalc-settings.js),
 *   calculation engine (paycalc-app.js), back-pay (paycalc-backpay.js).
 * Edit here for: HPP maths, prior-year HPP section, variable-pay formula.
 * Do not edit here for: basic gross maths, tax/NI, period navigation.
 */

import {
  GRADES, HPP_FRACTION, RATE_125, RATE_150, RATE_300,
  getTaxYearForOffset, getLondonAllowanceForPeriod,
} from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, hasBankHoliday, hasBoxingDay } from './paycalc-periods.js';
import { getGrade, getLoggedMember, getEffectiveContr, getProRateFactor } from './paycalc-settings.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { periodKey, hppEstKey, hppActualKey } from './paycalc-migrations.js';
import { formatISO, MILLER_ACTUALS, parseSmartFloat } from './roster-data.js';

const fmt = (/** @type {number} */ n) => '£' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

/**
 * True when a period-data object has no hours or special flags entered.
 * Exported so coordinator (updateSaveStatus) and paycalc-backpay.js can import it.
 */
export function isDataEmpty(/** @type {any} */ d) {
  return !d.satH && !d.satM &&
         !d.bhH  && !d.bhM  &&
         !d.bhOtH && !d.bhOtM &&
         !d.otH  && !d.otM  &&
         !d.rdwH && !d.rdwM &&
         !d.sunH && !d.sunM &&
         !d.boxH && !d.boxM && !d.peer &&
         !d.slSkip && !d.otherAdj;
}

// Decode raw hours from a saved period data object. Guards BH/Boxing hours against
// periods that don't contain those days — localStorage can restore saved values into
// hidden rows, so we sanitise here rather than relying on the DOM row being hidden.
/**
 * Decode stored hour fields from a period data object into decimal totals.
 * Guards BH/Boxing fields against periods that don't contain those days.
 * Exported for paycalc-backpay.js.
 * @param {any} p - Period object.
 * @param {any} d - Saved period data from localStorage.
 */
export function _decodeHours(p, d) {
  return {
    satHrs:  (d.satH  || 0) + (d.satM  || 0) / 60,
    bhHrs:   hasBankHoliday(p) ? ((d.bhH   || 0) + (d.bhM   || 0) / 60) : 0,
    bhOtHrs: hasBankHoliday(p) ? ((d.bhOtH || 0) + (d.bhOtM || 0) / 60) : 0,
    otHrs:   (d.otH   || 0) + (d.otM   || 0) / 60,
    rdwHrs:  (d.rdwH  || 0) + (d.rdwM  || 0) / 60,
    sunHrs:  (d.sunH  || 0) + (d.sunM  || 0) / 60,
    boxHrs:  hasBoxingDay(p)  ? ((d.boxH  || 0) + (d.boxM  || 0) / 60) : 0,
  };
}

// Compute variable pay for one period from saved data. Used by calcHPP and
// updatePriorHpp to avoid duplicating the capping and London Allowance logic.
// bhCapped mirrors calculate(): when all contracted hours are Saturday, bhCapped = 0
// and the BH premium must not contribute to HPP (it wasn't in that period's gross).
/**
 * Compute variable (extra) pay for one period from saved data.
 * Used by calcHPP, updatePriorHpp, and paycalc-backpay.js.
 * Variable pay includes: OT, RDW, Sunday, Boxing Day, Saturday uplift, London Allowance.
 * Does NOT include: peer training, basic pay, expenses, bonuses.
 * @param {any} p - Period object.
 * @param {any} d - Saved period data.
 * @param {number} rate - Hourly rate.
 */
export function _varPayForPeriod(p, d, rate) {
  const r125      = rate * RATE_125, r150 = rate * RATE_150, r300 = rate * RATE_300;
  const { satHrs, bhHrs, bhOtHrs, otHrs, rdwHrs, sunHrs, boxHrs } = _decodeHours(p, d);
  const effContr  = getEffectiveContr(p);
  const satCapped = Math.min(satHrs, effContr);
  const normHrs   = effContr - satCapped;
  const bhCapped  = Math.min(bhHrs, normHrs);
  const pTy       = getTaxYearForOffset(p.num - 48);
  const pLondon   = getLondonAllowanceForPeriod(p, pTy) * getProRateFactor(p);
  return satCapped * (rate * (RATE_125 - 1)) +
         bhCapped  * (rate * (RATE_125 - 1)) +
         bhOtHrs   * r125                    +
         otHrs     * r125          +
         rdwHrs    * r125          +
         sunHrs    * r150          +
         boxHrs    * r300          +
         pLondon;
}

// ── HPP ESTIMATOR ─────────────────────────────────────────────────────────────
// Formula from Chiltern payroll (Marie Firby):
// (Gross - Basic) × 4/52 = HPP

/**
 * Compute and display the HPP estimate for the current tax year.
 * Called by calculate() after every calculation.
 * @param {number} bpVarAmount - Variable portion of back pay (coordinator state).
 * @param {number} bpPNum - Period number the back pay lands in (coordinator state).
 */
export function calcHPP(bpVarAmount, bpPNum) {
  const _hppGrade       = getGrade();
  const _hppDefaultRate = GRADES[_hppGrade]?.rate ?? GRADES.cea.rate;
  const rate       = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('hourlyRate')).value) || _hppDefaultRate;
  const allPeriods = getPeriods();

  const pNum    = currentPeriodNum();
  const curP    = allPeriods.find(/** @param {any} x */ x => x.num === pNum);
  const ty      = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  const periods = allPeriods.filter(/** @param {any} p */ p => {
    const o = p.num - 48;
    return o >= ty.first && o <= ty.last;
  });

  let totalVar    = 0;
  let pCount      = 0;
  let usingActuals = false;

  periods.forEach(/** @param {any} p */ p => {
    try {
      // Variable back pay was earned in past periods but received in bpPNum.
      // Added before the saved-data check so it still counts when the lump-sum
      // period itself has no hours entered yet.
      if (bpVarAmount > 0 && p.num === bpPNum) totalVar += bpVarAmount;

      const _hppActualKey = formatISO(p.payday);
      const _hppActual = getLoggedMember()?.name === 'G. Miller'
        ? (/** @type {Record<string, any>} */ (MILLER_ACTUALS))[_hppActualKey] : null;
      if (_hppActual?.varPay != null) {
        totalVar += _hppActual.varPay;
        pCount++;
        usingActuals = true;
        return;
      }

      const raw = lsGet(periodKey(p.num));
      if (!raw) return;
      const d = JSON.parse(raw);
      if (isDataEmpty(d)) return;
      pCount++;
      totalVar += _varPayForPeriod(p, d, rate);
    } catch {}
  });

  const hpp      = totalVar * HPP_FRACTION;
  const amountEl = document.getElementById('hppAmount');
  const basisEl  = document.getElementById('hppBasis');
  const labelEl  = document.getElementById('hppLabel');

  // Persist the running estimate so it survives when the user moves to the next
  // tax year. Delete when the estimate drops to zero to avoid a stale figure
  // silently being added to the January payslip after entries are cleared.
  if (hpp > 0) lsSet(hppEstKey(ty), hpp.toFixed(2));
  else         lsDel(hppEstKey(ty));

  if (pCount === 0) {
    if (labelEl) labelEl.textContent = `Estimated ${ty.label} Holiday Pay Premium`;
    if (amountEl) amountEl.textContent = '£–';
    if (basisEl)  basisEl.textContent  = 'Enter hours across your periods above to calculate';
  } else {
    if (labelEl) labelEl.textContent = `Estimated ${ty.label} Holiday Pay Premium`;
    if (amountEl) amountEl.textContent = fmt(hpp);
    if (basisEl)  basisEl.textContent  = usingActuals
      ? `All ${pCount} periods of ${ty.label} · ${fmt(totalVar)} extra pay × 7.69% · from your payslips · due January ${ty.hppPaidJan}`
      : `${pCount} period${pCount > 1 ? 's' : ''} of ${ty.label} · ${fmt(totalVar)} extra pay × 7.69% · due January ${ty.hppPaidJan}`;
  }

  const noteEl = document.getElementById('hppNote');
  if (noteEl) {
    noteEl.innerHTML = `<strong>How it's calculated (confirmed by Chiltern payroll):</strong> All extra pay above your basic hours (overtime, rest day working, Sundays, and London Allowance) × 7.69%. Basic pay, peer training, expenses and bonuses are not included. This estimate covers the <strong>tax year ${ty.label}</strong> — Chiltern will pay it in <strong>January ${ty.hppPaidJan}</strong>. It's reduced proportionally if you weren't employed for the full year.`;
  }

  updatePriorHpp(ty);
}

// ── PRIOR YEAR HPP SECTION ───────────────────────────────────────────────────
// Shows the previous tax year's HPP estimate (or confirmed actual) in the HPP card.
// Called at the end of calcHPP() so it refreshes whenever the main calculation runs.

/**
 * Update the prior-year HPP section of the HPP card.
 * @param {any} ty - Current tax year object from CONFIG.TAX_YEARS.
 */
export function updatePriorHpp(ty) {
  const section = document.getElementById('priorHppSection');
  if (!section) return;

  const tyIdx = CONFIG.TAX_YEARS.findIndex(t => t.label === ty.label);
  if (tyIdx <= 0) {
    section.classList.add('hidden');
    return;
  }

  const priorTy   = /** @type {any} */ (CONFIG.TAX_YEARS[tyIdx - 1]);
  const estRaw    = lsGet(hppEstKey(priorTy));
  const actualRaw = lsGet(hppActualKey(priorTy));
  let   est       = estRaw    ? parseFloat(estRaw)    : 0;
  const actual    = actualRaw ? parseFloat(actualRaw) : 0;

  // If no stored estimate yet, compute on the fly so the prior-year HPP section
  // is populated on first login even before the user has visited a prior-year period.
  if (est === 0 && !actual) {
    const _priorPeriods = getPeriods().filter(/** @param {any} p */ p => {
      const o = p.num - 48;
      return o >= priorTy.first && o <= priorTy.last;
    });

    if (getLoggedMember()?.name === 'G. Miller') {
      const _priorVar = _priorPeriods.reduce((/** @type {number} */ sum, /** @type {any} */ p) => {
        const a = (/** @type {Record<string, any>} */ (MILLER_ACTUALS))[formatISO(p.payday)];
        return a?.varPay != null ? sum + a.varPay : sum;
      }, 0);
      if (_priorVar > 0) est = _priorVar * HPP_FRACTION;
    } else {
      const _hppGrade = getGrade();
      const rate = GRADES[_hppGrade]?.rate ?? GRADES.cea.rate;
      let _priorVar = 0;
      _priorPeriods.forEach(/** @param {any} p */ p => {
        try {
          const raw = lsGet(periodKey(p.num));
          if (!raw) return;
          const d = JSON.parse(raw);
          if (isDataEmpty(d)) return;
          _priorVar += _varPayForPeriod(p, d, rate);
        } catch {}
      });
      if (_priorVar > 0) est = _priorVar * HPP_FRACTION;
    }

    if (est > 0) lsSet(hppEstKey(priorTy), est.toFixed(2));
  }

  const pNum = currentPeriodNum();
  const curP = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
  const isJanPayday = curP &&
    curP.payday.getFullYear() === priorTy.hppPaidJan &&
    curP.payday.getMonth() === 0;

  const priorHppTitleEl    = document.getElementById('priorHppTitle');
  const currentHppTitleEl  = document.getElementById('currentHppTitle');
  if (priorHppTitleEl)   priorHppTitleEl.textContent   = `${priorTy.label} Holiday Pay Premium`;
  if (currentHppTitleEl) currentHppTitleEl.textContent = `This year (${ty.label})`;

  const dueBadge = document.getElementById('priorHppDueBadge');
  if (dueBadge) dueBadge.classList.toggle('hidden', !isJanPayday || actual > 0);

  const amtLabel = document.getElementById('priorHppAmtLabel');
  const amtEl    = document.getElementById('priorHppAmt');
  const basisEl  = document.getElementById('priorHppBasis');

  if (actual > 0) {
    if (amtLabel) amtLabel.innerHTML  = `${priorTy.label} HPP <span class="actual-badge">✓ Confirmed</span>`;
    if (amtEl)    amtEl.textContent   = fmt(actual);
    if (basisEl)  basisEl.textContent = `Confirmed from your January ${priorTy.hppPaidJan} payslip`;
  } else if (est > 0) {
    if (amtLabel) amtLabel.textContent = isJanPayday ? 'Expected on this payslip' : 'Estimated';
    if (amtEl)    amtEl.textContent    = fmt(est);
    if (basisEl)  basisEl.textContent  = isJanPayday
      ? `Check your January ${priorTy.hppPaidJan} payslip and enter the confirmed amount below`
      : `Estimated from your ${priorTy.label} periods · due January ${priorTy.hppPaidJan}`;
  } else {
    if (amtLabel) amtLabel.textContent = 'Estimated';
    if (amtEl)    amtEl.textContent    = '£–';
    if (basisEl)  basisEl.textContent  = `No ${priorTy.label} variable pay recorded — check your January ${priorTy.hppPaidJan} payslip`;
  }

  const input = document.getElementById('priorHppActualInput');
  if (input) {
    const stored = actualRaw || '';
    if (document.activeElement !== input) /** @type {HTMLInputElement} */ (input).value = stored;
  }

  section.classList.remove('hidden');
}
