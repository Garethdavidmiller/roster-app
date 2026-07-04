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
  getTaxYearForOffset, awardRatesFor,
} from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, payslipPeriodNum, _setSelectPeriod } from './paycalc-periods.js';
import { getGrade, getEffectiveContr, getProRateFactor, getStoredRateForYear } from './paycalc-settings.js';
import { lsGet } from './ls.js';
import { SK, periodKey } from './paycalc-migrations.js';
import { _decodeHours } from './paycalc-hpp.js';
import { fd, fdShort, fmt } from './paycalc-format.js';

/**
 * The currently OFFERED (but not-yet-confirmed) annual pay award, as a percentage. Used to
 * pre-fill the back-pay card's "Pay rise %" so it opens with a live estimate — only while the
 * award year is unconfirmed (`ty.rateUnconfirmed`); once the real rate is entered/confirmed this
 * default no longer applies. UPDATE (or remove) when the award is agreed / a new one is offered.
 * Current: the 3.6% offered Jul 2026, awaiting RMT acceptance.
 */
const PENDING_AWARD_PCT = 3.6;

// ── TAX YEAR HELPER ───────────────────────────────────────────────────────────

/**
 * Period number the back-pay award is backdated FROM. Always the April period of the
 * current tax year — Chiltern's pay anniversary is always 1 April, so there is no user
 * choice to make (the old "Pay rise backdated from" selector was removed Jul 2026). The
 * April period is `48 + ty.first` (period offset `num - 48`, `ty.first` = the tax year's
 * first offset). Used as the accrual window's lower bound and to derive the award tax year.
 * @returns {number}
 */
export function _backdatedFromPNum() {
  const awardTy = getTaxYearForOffset(currentPeriodNum() - 48);
  return 48 + awardTy.first;
}

/**
 * Tax year the back-pay award belongs to — derived from the "backdated from"
 * period, NOT the period being viewed (which may be a different tax year).
 * Exported so coordinator's applyNewRate() can call it.
 * @param {number} fromPNum - Period number the award is backdated from.
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
  const oldRateEl   = /** @type {HTMLInputElement} */ (document.getElementById('oldRate'));
  const newRateEl   = /** @type {HTMLInputElement} */ (document.getElementById('newRateInput'));
  const oldLondonEl = /** @type {HTMLInputElement} */ (document.getElementById('oldLondon'));
  const newLondonEl = /** @type {HTMLInputElement} */ (document.getElementById('newLondon'));

  // The award year is the tax year of the SELECTED period, so the card computes the award for
  // whichever year you're viewing (historic OR pending). Its OLD rate = the rate paid before that
  // year's award = the prior year's rate — held per grade/year in AWARD_RATES (payslip-confirmed),
  // so it never depends on the mutable GRADES default. null = not on record (e.g. CES 2024/25) →
  // the old-rate box stays blank for manual entry.
  const award = awardRatesFor(getGrade(), ty.label);
  if (!oldRateEl.value && award && award.pre != null) oldRateEl.value = award.pre.toFixed(2);

  if (ty.rateUnconfirmed) {
    // Offered-but-unconfirmed award (e.g. the 2026/27 rise awaiting RMT acceptance): the OLD rate
    // is the prior year's rate (prefilled above from AWARD_RATES, or the stored rate as a fallback
    // for a grade with no recorded pre), and the NEW rate is not yet known — so leave NEW blank for
    // the "Pay rise %" helper (defaulted below) or manual entry.
    if (!oldRateEl.value)   oldRateEl.value   = getStoredRateForYear(ty).toFixed(2);
    if (!oldLondonEl.value) oldLondonEl.value = ty.londonAllow.toFixed(2);
    // Default the "Pay rise %" to the currently offered award so the card opens with an estimate.
    // The coordinator's _applyBpRisePct() then derives the New rate/London from it. Adjustable —
    // and only for the unconfirmed award year (once real rates are known this branch isn't taken).
    const pctEl = /** @type {HTMLInputElement | null} */ (document.getElementById('bpRisePct'));
    if (pctEl && !pctEl.value) pctEl.value = String(PENDING_AWARD_PCT);
  } else {
    // Settled award (e.g. 2025/26): the NEW rate is on record too, so prefill it — a historic
    // award opens fully populated (CEA 2025/26: old £20.06 → new £20.74). No "Pay rise %" default
    // (the real figures are known), so _applyBpRisePct is a no-op and won't touch these boxes.
    if (!newRateEl.value && award && award.rate != null) newRateEl.value = award.rate.toFixed(2);
    if (!oldLondonEl.value && ty.londonAllowPre) oldLondonEl.value = ty.londonAllowPre.toFixed(2);
    if (!newLondonEl.value)                      newLondonEl.value = ty.londonAllow.toFixed(2);
  }
  // Name the award year on the card so it's clear WHICH annual rise is being calculated.
  const awardScopeEl = document.getElementById('bpAwardScope');
  if (awardScopeEl) awardScopeEl.textContent = `You're calculating the ${ty.label} pay award (backdated to 1 April).`;
  // The award is always backdated to 1 April (Chiltern's pay anniversary) — computed
  // internally by _backdatedFromPNum(); there is no "backdated from" selector to pre-set.
  // Default the "paid in" period to the NEXT PAYDAY (the current period) — the lump sum most
  // likely lands on your next payslip. Adjustable; the paid-in period is itself excluded from the
  // accrual (in that month you're already on the new rate — see calcBackPay's _capPNum).
  const paidSel = /** @type {HTMLSelectElement} */ (document.getElementById('backPayPeriod'));
  if (paidSel && !paidSel.value) _setSelectPeriod(paidSel, currentPeriodNum());
  return calcBackPay();
}

/**
 * New value after applying a percentage pay rise — e.g. raiseByPercent(20.74, 3.6) → 21.4866.
 * Pure. Returns 0 when either input is non-positive so a caller can treat 0 as "nothing to fill"
 * (used by the "Pay rise %" shortcut to derive the New rate/London from the Old figure).
 * @param {number} oldVal
 * @param {number} pct
 * @returns {number}
 */
export function raiseByPercent(oldVal, pct) {
  if (!(oldVal > 0) || !(pct > 0)) return 0;
  return oldVal * (1 + pct / 100);
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

  const fromPNum  = _backdatedFromPNum();
  const bpSel     = /** @type {HTMLSelectElement} */ (document.getElementById('backPayPeriod'));
  const bpPNum    = bpSel ? +bpSel.value : 0; // "paid in" period — also the cap
  const bpP       = bpPNum ? getPeriods().find(/** @param {any} x */ x => x.num === bpPNum) : null;
  const hasRate   = oldRate   > 0 && newRate   > 0 && newRate   > oldRate;
  const hasLondon = oldLondon > 0 && newLondon > 0 && newLondon > oldLondon;

  const labelEl    = document.getElementById('backPayTotalLabel');
  const periodWrap = document.getElementById('backPayPeriodWrap');
  const applyWrap  = document.getElementById('applyRateWrap');
  const applyBtn   = document.getElementById('applyRateBtn');

  // Estimate banner — visible whenever the award's tax-year rates are still unconfirmed
  // (offered, awaiting acceptance). Set before the early return so it shows the moment the
  // card opens, even before any figures are entered.
  const estimateNote = document.getElementById('bpEstimateNote');
  if (estimateNote) estimateNote.style.display = _bpAwardTaxYear(fromPNum)?.rateUnconfirmed ? 'block' : 'none';

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
  // not accidentally pull in periods from that later year. When no explicit period
  // is chosen (the "— all periods with saved data —" option), _bpAwardTaxYear falls
  // back to the CURRENT tax year, so the fence still holds — previously this was
  // `null`, dropping the fence entirely and spilling one award's rate-diff across
  // saved periods of the OTHER tax year (an inflated lump sum).
  const awardTy    = _bpAwardTaxYear(fromPNum);
  let rows          = '';
  let grandTotal    = 0;
  let grandVarTotal = 0;
  let pCount        = 0;

  // Upper cap for accrual = up to but NOT INCLUDING the "paid in" period, AND no later than today.
  // Excluding the paid-in month: in the period the lump sum lands you are already paid at the NEW
  // rate, so that month is current pay, not back pay (confirmed by Gareth Jul 2026). Capping at
  // today's period also stops a future paid-in — or an unselected one — from adding contracted
  // rate-diff for weeks not yet worked (a period the user merely opened autosaves a record, so it
  // can't be excluded by emptiness alone).
  const _capPNum = Math.min(bpPNum ? bpPNum - 1 : Infinity, currentPeriodNum());
  periods.forEach(/** @param {any} p */ p => {
    try {
      if (fromPNum && p.num < fromPNum) return;
      if (_capPNum && p.num > _capPNum) return;
      // Skip periods outside the award tax year (e.g. when "paid in" period is
      // in the following year — don't apply 2025/26 rate diff to 2026/27 work).
      if (awardTy && getTaxYearForOffset(p.num - 48) !== awardTy) return;
      const raw = lsGet(periodKey(p.num));
      // Include EVERY period in the award window — even one never opened in the app. A normal
      // contracted week is owed the rise whether worked or paid at contracted rate on leave/sick
      // (confirmed by Gareth), so an unvisited period defaults to empty data → contracted-only
      // (no variable). _decodeHours returns zeros for `{}`, so ratePay reduces to exactly the
      // contracted component + London diff. GUARDED by fromPNum: with no "backdated from" period
      // selected there is no award window, so an unvisited period has nothing to accrue and is
      // skipped — otherwise contracted arrears would be summed across unbounded history.
      if (!raw && !fromPNum) return;
      const d = raw ? JSON.parse(raw) : {};
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
        // Accumulate the PENNY-ROUNDED row value into the total so the displayed rows always
        // sum to the displayed total (each row prints fmt(backPay) = 2dp; summing the unrounded
        // values could leave the total 1p off the rows on a figure staff cross-check by hand).
        const bpRow    = Math.round(backPay * 100) / 100;
        grandTotal    += bpRow;
        grandVarTotal += varPay;
        pCount++;
        rows += `<div class="bp-row">
          <span class="bp-lbl">P${payslipPeriodNum(p)} · ${fd(p.payday)}</span>
          <span class="bp-val">${fmt(bpRow)}</span>
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
    if (hasLondon) parts.push(`London Allowance ${fmt(oldLondon)} → ${fmt(newLondon)}`);
    totalBasEl.textContent = `${pCount} period${pCount > 1 ? 's' : ''} backdated · ${parts.join(' · ')}`;

    if (periodWrap) periodWrap.style.display = 'block';

    noticeEl.style.display = 'block';
    if (bpP) {
      const payLong = bpP.payday.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London'
      });
      noticeEl.innerHTML = `⚠️ This lump sum will appear on your <strong>P${payslipPeriodNum(bpP)} payslip (paid ${payLong})</strong>. It is taxed in full in that period — if it pushes your income over a tax band threshold, you may receive less than the gross figure shown.`;
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
