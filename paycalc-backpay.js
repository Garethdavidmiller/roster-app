// @ts-check
/**
 * paycalc-backpay.js — Back-pay lump sum calculator for paycalc.html.
 *
 * Owns: prefillBackPay, calcBackPay, _bpAwardTaxYear.
 * Does NOT own: coordinator state (_bpAmount/_bpVarAmount/_bpPNum live in paycalc-app.js),
 *   calculation engine (paycalc-app.js), settings (paycalc-settings.js).
 * Edit here for: back-pay calculation logic, lump sum breakdown rendering.
 * Do not edit here for: pay maths, period navigation, HPP formula.
 *
 * calcBackPay() returns { bpAmount, bpVarAmount, bpPNum } — coordinator
 * (paycalc-app.js) compares against its own state and calls calculate() if changed.
 */

import { parseSmartFloat } from './roster-data.js';
import {
  RATE_125, RATE_150, RATE_300,
  getTaxYearForOffset,
} from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, _setSelectPeriod } from './paycalc-periods.js';
import { getEffectiveContr, getProRateFactor } from './paycalc-settings.js';
import { lsGet } from './ls.js';
import { SK, periodKey } from './paycalc-migrations.js';
import { _decodeHours } from './paycalc-hpp.js';
import { fd, fdShort, fmt } from './paycalc-format.js';

// ── TAX YEAR HELPER ───────────────────────────────────────────────────────────

/**
 * Tax year the back-pay award belongs to — derived from the "backdated from"
 * period, NOT the period being viewed (which may be a different tax year).
 * Exported so coordinator's applyNewRate() can call it.
 * @param {number} fromPNum - Period number of the "backdated from" selector value.
 */
export function _bpAwardTaxYear(fromPNum) {
  const p = fromPNum ? getPeriods().find(/** @param {any} x */ x => x.num === fromPNum) : null;
  return getTaxYearForOffset((p ? p.num : currentPeriodNum()) - 48);
}

// ── BACK PAY CARD PRE-FILL ────────────────────────────────────────────────────

/**
 * Pre-fill the Back Pay card inputs when it opens (initCardCollapse onToggle).
 * Returns the result of calcBackPay() so coordinator can update its BP state.
 * @returns {{ bpAmount: number, bpVarAmount: number, bpPNum: number }}
 */
export function prefillBackPay() {
  const pNum = currentPeriodNum();
  const curP = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
  const ty   = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  const oldLondonEl = /** @type {HTMLInputElement} */ (document.getElementById('oldLondon'));
  const newLondonEl = /** @type {HTMLInputElement} */ (document.getElementById('newLondon'));
  if (!oldLondonEl.value && ty.londonAllowPre) oldLondonEl.value = ty.londonAllowPre.toFixed(2);
  if (!newLondonEl.value)                      newLondonEl.value = ty.londonAllow.toFixed(2);
  // Auto-select April — Chiltern's pay anniversary is always 1 April. Use _setSelectPeriod (sets
  // option.selected), NOT `.value = …`: this select is populated with <optgroup>s, and iOS Safari
  // ignores a direct `.value` assignment on an optgroup select, so the default never applied there —
  // leaving fromPNum 0 → awardTy null → the tax-year fence removed → an inflated lump sum.
  const fromSel = /** @type {HTMLSelectElement} */ (document.getElementById('backPayFrom'));
  if (fromSel && !fromSel.value) _setSelectPeriod(fromSel, 48 + ty.first);
  return calcBackPay();
}

// ── BACK PAY CALCULATOR ───────────────────────────────────────────────────────

/**
 * Calculate the back-pay lump sum from the card inputs, render the results,
 * and return the new coordinator BP state.
 * Does NOT mutate coordinator state or call calculate() — caller handles that.
 * @returns {{ bpAmount: number, bpVarAmount: number, bpPNum: number }}
 */
export function calcBackPay() {
  const oldRate   = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('oldRate')).value);
  const newRate   = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('newRateInput')).value);
  const oldLondon = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('oldLondon')).value);
  const newLondon = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('newLondon')).value);
  const rowsEl       = /** @type {HTMLElement} */ (document.getElementById('backPayRows'));
  const totalEl      = /** @type {HTMLElement} */ (document.getElementById('backPayTotal'));
  const totalAmtEl   = /** @type {HTMLElement} */ (document.getElementById('backPayTotalAmt'));
  const totalBasEl   = /** @type {HTMLElement} */ (document.getElementById('backPayTotalBasis'));
  const noticeEl     = /** @type {HTMLElement} */ (document.getElementById('backPayNotice'));
  const breakdownBtn = /** @type {HTMLElement} */ (document.getElementById('bpBreakdownBtn'));

  const fromPNum  = +(/** @type {HTMLSelectElement} */ (document.getElementById('backPayFrom'))?.value || 0);
  const bpSel     = /** @type {HTMLSelectElement} */ (document.getElementById('backPayPeriod'));
  const bpPNum    = bpSel ? +bpSel.value : 0; // "paid in" period — also the cap
  const bpP       = bpPNum ? getPeriods().find(/** @param {any} x */ x => x.num === bpPNum) : null;
  const hasRate   = oldRate   > 0 && newRate   > 0 && newRate   > oldRate;
  const hasLondon = oldLondon > 0 && newLondon > 0 && newLondon > oldLondon;

  const labelEl    = document.getElementById('backPayTotalLabel');
  const periodWrap = document.getElementById('backPayPeriodWrap');
  const applyWrap  = document.getElementById('applyRateWrap');
  const applyBtn   = document.getElementById('applyRateBtn');

  if (!hasRate && !hasLondon) {
    rowsEl.innerHTML = '';
    rowsEl.classList.remove('open');
    totalEl.style.display      = 'none';
    noticeEl.style.display     = 'none';
    breakdownBtn.style.display = 'none';
    if (periodWrap) periodWrap.style.display = 'none';
    if (applyWrap)  applyWrap.style.display  = 'none';
    return { bpAmount: 0, bpVarAmount: 0, bpPNum: 0 };
  }

  const rateDiff   = hasRate   ? newRate   - oldRate   : 0;
  const londonDiff = hasLondon ? newLondon - oldLondon : 0;
  const periods    = getPeriods();
  // Back-pay applies within a single tax-year anniversary — derive it from the
  // "backdated from" period so that a "paid in" period in a subsequent year does
  // not accidentally pull in periods from that later year.
  const awardTy    = fromPNum ? _bpAwardTaxYear(fromPNum) : null;
  let rows          = '';
  let grandTotal    = 0;
  let grandVarTotal = 0;
  let pCount        = 0;

  periods.forEach(/** @param {any} p */ p => {
    try {
      if (fromPNum && p.num < fromPNum) return;
      if (bpPNum   && p.num > bpPNum)  return;
      // Skip periods outside the award tax year (e.g. when "paid in" period is
      // in the following year — don't apply 2025/26 rate diff to 2026/27 work).
      if (awardTy && getTaxYearForOffset(p.num - 48) !== awardTy) return;
      const raw = lsGet(periodKey(p.num));
      if (!raw) return;   // never-visited period — conservatively excluded (we can't assume it was worked)
      const d = JSON.parse(raw);
      // Do NOT skip an "empty" (no special hours) period: a normal contracted week still owes the
      // contracted-hours rate diff on a rate award — dropping it lost the LARGEST component
      // (≈ effContr × rateDiff per period) with no field the user could fill to include it. For an
      // empty period _decodeHours returns zeros, so ratePay below reduces to exactly that contracted
      // component + the London diff, and the variable portion is zero.
      const { satHrs, bhHrs, bhOtHrs, otHrs, rdwHrs, sunHrs, boxHrs } = _decodeHours(p, d);
      // Cap sat/BH hours as calculate() does — back-pay must reflect actual gross paid.
      const _bpEffContr = getEffectiveContr(p);
      const satCapped = Math.min(satHrs, _bpEffContr);
      const normHrsBP = _bpEffContr - satCapped;
      const bhCapped  = Math.min(bhHrs, normHrsBP);

      const ratePay =
        _bpEffContr    * rateDiff                    +
        satCapped * rateDiff * (RATE_125 - 1) +
        bhCapped  * rateDiff * (RATE_125 - 1) +
        bhOtHrs   * rateDiff * RATE_125       +
        otHrs     * rateDiff * RATE_125       +
        rdwHrs    * rateDiff * RATE_125       +
        sunHrs    * rateDiff * RATE_150       +
        boxHrs    * rateDiff * RATE_300       +
        (d.peer || 0) * 2 * rateDiff;

      // Pro-rate londonDiff using the exact factor — avoids rounding error from
      // dividing the integer-rounded _bpEffContr back by getContr().
      const _bpScale = getProRateFactor(p);
      const backPay = ratePay + londonDiff * _bpScale;

      // Variable portion — mirrors _varPayForPeriod(): excludes basic contracted pay
      // (effContr × rateDiff) and peer pay. London Allowance diff is variable (HPP accrues on it).
      const varPay = (hasRate ? (
        satCapped * rateDiff * (RATE_125 - 1) +
        bhCapped  * rateDiff * (RATE_125 - 1) +
        bhOtHrs   * rateDiff * RATE_125       +
        otHrs     * rateDiff * RATE_125       +
        rdwHrs    * rateDiff * RATE_125       +
        sunHrs    * rateDiff * RATE_150       +
        boxHrs    * rateDiff * RATE_300
      ) : 0) + (hasLondon ? londonDiff * _bpScale : 0);

      if (backPay > 0) {
        grandTotal    += backPay;
        grandVarTotal += varPay;
        pCount++;
        rows += `<div class="bp-row">
          <span class="bp-lbl">P${p.num} · ${fd(p.payday)}</span>
          <span class="bp-val">${fmt(backPay)}</span>
        </div>`;
      }
    } catch {}
  });

  if (grandTotal > 0) {
    totalEl.style.display  = 'block';
    totalAmtEl.textContent = fmt(grandTotal);
    if (labelEl) {
      labelEl.textContent = bpP
        ? `💷 Lump sum · Paid ${fdShort(bpP.payday)}`
        : '💷 Lump sum on one payslip';
    }
    const parts = [];
    if (hasRate)   parts.push(`rate ${fmt(oldRate)} → ${fmt(newRate)}`);
    if (hasLondon) parts.push(`London Allow ${fmt(oldLondon)} → ${fmt(newLondon)}`);
    totalBasEl.textContent = `${pCount} period${pCount > 1 ? 's' : ''} backdated · ${parts.join(' · ')}`;

    if (periodWrap) periodWrap.style.display = 'block';

    noticeEl.style.display = 'block';
    if (bpP) {
      const payLong = bpP.payday.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London'
      });
      noticeEl.innerHTML = `⚠️ This lump sum will appear on your <strong>P${bpP.num} payslip (paid ${payLong})</strong>. It is taxed in full in that period — if it pushes your income over a tax band threshold, you may receive less than the gross figure shown.`;
    } else {
      noticeEl.textContent = '⚠️ This lump sum is taxed in the period it is paid. Select a period above to see a specific warning. If it pushes your income over a tax band threshold that month, you may receive less than the gross figure shown.';
    }

    // "Apply new rate" button — shown once rates are confirmed.
    // Compares against the stored rate for the AWARD's tax year, not the rate
    // field (which shows the rate of whichever tax year is being viewed).
    if (applyWrap && applyBtn && hasRate) {
      const _awardTy = _bpAwardTaxYear(fromPNum);
      /** @type {Record<string, any>} */
      let _storedRates = {};
      try { _storedRates = JSON.parse(lsGet(SK.rates) || '{}'); } catch {}
      const alreadyApplied = Math.abs((parseFloat(_storedRates[_awardTy.label]) || 0) - newRate) < 0.001;
      applyBtn.textContent = alreadyApplied
        ? `✓ New rate already applied — £${newRate.toFixed(2)}/hr (${_awardTy.label})`
        : `Apply new rate to settings — £${newRate.toFixed(2)}/hr (${_awardTy.label}) →`;
      /** @type {HTMLButtonElement} */ (applyBtn).disabled = alreadyApplied;
      applyWrap.style.display = 'block';
    } else if (applyWrap) {
      applyWrap.style.display = 'none';
    }

    rowsEl.innerHTML = rows;
    breakdownBtn.style.display = 'flex';
  } else {
    totalEl.style.display      = 'none';
    noticeEl.style.display     = 'none';
    breakdownBtn.style.display = 'none';
    if (periodWrap) periodWrap.style.display = 'none';
    if (applyWrap)  applyWrap.style.display  = 'none';
    rowsEl.innerHTML = '<p style="font-size:13px;color:var(--text-light);padding:8px 0">No saved periods found. Enter hours for each period first.</p>';
  }

  const newBpPNum   = (grandTotal > 0 && bpPNum > 0) ? bpPNum : 0;
  const newBpAmt    = newBpPNum > 0 ? grandTotal    : 0;
  const newBpVarAmt = newBpPNum > 0 ? grandVarTotal : 0;
  return { bpAmount: newBpAmt, bpVarAmount: newBpVarAmt, bpPNum: newBpPNum };
}
