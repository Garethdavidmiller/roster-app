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
  HPP_FRACTION, RATE_125, RATE_150, RATE_300,
  getTaxYearForOffset, taxYearForPeriod, capHours,
} from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, hasBankHoliday, hasBoxingDay, isTaxYearVisible } from './paycalc-periods.js';
import { getLoggedMember, getEffectiveContr, getProRateFactor, getStoredRateForYear } from './paycalc-settings.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { readSavedPeriod, hppEstKey, hppActualKey, readPayslipActuals, isActualsDev } from './paycalc-migrations.js';
import { formatISO, parseSmartFloat } from './roster-data.js';
import { fmt } from './paycalc-format.js';

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
  const { satCapped, bhCapped } = capHours({ effContr: getEffectiveContr(p), satHrs, bhHrs });
  const pTy       = getTaxYearForOffset(p.num - 48);
  // London is priced at the SETTLED (post-award) value for the whole year — `pTy.londonAllow`, NOT
  // the period-aware getLondonAllowanceForPeriod (which returns the OLD London for a pre-award
  // period). This mirrors the settled-whole-year RATE the caller passes in: after the mid-year award
  // (paid via the back-pay lump) a member's London for EVERY period of the year is the new value, so
  // the HPP base is new-London × periods. Pricing it period-aware under-counted the pre-award London
  // uplift (~£4/yr for a London member) — the bug the removed back-pay HPP add used to mask (v16.90).
  const pLondon   = pTy.londonAllow * getProRateFactor(p);
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
 *
 * Back pay is deliberately NOT added into the premium here (v16.89 — double-count fix). calcHPP
 * prices EVERY period of the year at getStoredRateForYear(ty) — the SETTLED (post-award) rate — so a
 * pre-award period already contributes its variable pay AT THE NEW RATE, which includes the award
 * uplift. The back-pay lump's "variable portion" is that SAME uplift, so adding it on top counted it
 * twice. Whether Chiltern pays one combined HPP or a separate HPP on the lump, the TOTAL a member
 * receives = every period's variable pay at the new rate × 7.69% — exactly what this new-rate pricing
 * already produces. The paid-in tick still adds the lump to that period's TAKE-HOME (_bpThisPeriod in
 * the coordinator); only the redundant HPP inflation is removed. Do not re-thread back pay in here
 * without also switching the whole-year pricing to period-aware rates (which was rejected — it made
 * the estimate shift with the viewed period; see the rate comment below).
 *
 * Both the RATE and (since v16.90) the LONDON allowance are priced settled-whole-year in
 * _varPayForPeriod, so a pre-award period's variable pay already carries the full award — there is
 * genuinely nothing left for back pay to add here.
 */
export function calcHPP() {
  const allPeriods = getPeriods();

  const pNum    = currentPeriodNum();
  const curP    = allPeriods.find(/** @param {any} x */ x => x.num === pNum);
  const ty      = taxYearForPeriod(curP);
  // Rate: THIS tax year's stored settled rate — deliberately NOT the live #hourlyRate field.
  // The field shows the PRE-AWARD rate whenever a pre-award period is selected (updateRateForPeriod),
  // so reading it made the whole-year HPP estimate SHIFT depending on which period you were viewing
  // (same year → two different premiums, purely from clicking Prev/Next). The stored year rate is
  // stable across navigation and mirrors updatePriorHpp's prior-year path, which already does this.
  const rate    = getStoredRateForYear(ty);
  const periods = allPeriods.filter(/** @param {any} p */ p => {
    const o = p.num - 48;
    return o >= ty.first && o <= ty.last;
  });

  let totalVar    = 0;
  let pCount      = 0;
  let usingActuals = false;
  const _skipped  = /** @type {number[]} */ ([]);   // periods whose saved data couldn't be read — surfaced, never dropped silently
  // Device-local payslip actuals (G. Miller only; imported once per device, never served).
  // When a period has real figures, its actual varPay is used instead of the entered-hours
  // estimate — read once here, not per period.
  const _actuals = isActualsDev(getLoggedMember()) ? readPayslipActuals() : null;

  periods.forEach(/** @param {any} p */ p => {
    try {
      const _hppActual = _actuals?.[formatISO(p.payday)];
      if (_hppActual?.varPay != null) {
        totalVar += _hppActual.varPay;
        pCount++;
        usingActuals = true;
        return;
      }

      const parsed = readSavedPeriod(p.num);
      if (parsed.error) { _skipped.push(p.num); console.warn('[PayCalc] HPP corrupt period', p.num); return; }
      if (!parsed.data) return;
      const d = parsed.data;
      if (isDataEmpty(d)) return;
      pCount++;
      totalVar += _varPayForPeriod(p, d, rate);
    } catch (e) {
      // A corrupt saved period must not abort the whole estimate, but dropping it silently would
      // under-state the premium — record it (surfaced below) and trace it.
      _skipped.push(p.num);
      console.warn('[PayCalc] HPP skipped period', p.num, e);
    }
  });

  const hpp      = totalVar * HPP_FRACTION;
  const amountEl = document.getElementById('hppAmount');
  const basisEl  = document.getElementById('hppBasis');
  const labelEl  = document.getElementById('hppLabel');

  // Persist the running estimate so it survives when the user moves to the next
  // tax year. Delete when the estimate drops to zero to avoid a stale figure
  // silently being added to the January payslip after entries are cleared —
  // but NEVER when periods were skipped as corrupt: a zero produced by failing to
  // READ the data is not "entries cleared", and wiping the previously-persisted
  // (correct) estimate would compound the loss.
  if (hpp > 0) lsSet(hppEstKey(ty), hpp.toFixed(2));
  else if (_skipped.length === 0) lsDel(hppEstKey(ty));

  if (labelEl) labelEl.textContent = `Estimated ${ty.label} Holiday Pay Premium`;
  if (pCount === 0) {
    if (amountEl) amountEl.textContent = '£–';
    if (basisEl)  basisEl.textContent  = 'Enter hours across your periods above to calculate';
    // EVERY readable period failed to parse — the worst case must not be the silent one (the
    // partial-corruption warning below only renders on the non-empty branch).
    if (_skipped.length && basisEl) {
      basisEl.innerHTML += ` <span class="pay-skip-warn">⚠️ Couldn't read ${_skipped.length} saved period${_skipped.length > 1 ? 's' : ''}, so no premium could be calculated — re-save ${_skipped.length > 1 ? 'them' : 'it'} on the calculator.</span>`;
    }
  } else {
    if (amountEl) amountEl.textContent = fmt(hpp);
    if (basisEl) {
      basisEl.textContent = usingActuals
        ? `All ${pCount} periods of ${ty.label} · ${fmt(totalVar)} extra pay × 7.69% · from your payslips · due January ${ty.hppPaidJan}`
        : `${pCount} period${pCount > 1 ? 's' : ''} of ${ty.label} · ${fmt(totalVar)} extra pay × 7.69% · due January ${ty.hppPaidJan}`;
    }
    // A corrupt saved period was excluded, so this premium may be too low — surface it rather than
    // quietly under-stating money (no-silent-caps). Rare: only malformed localStorage trips it.
    if (_skipped.length && basisEl) {
      basisEl.innerHTML += ` <span class="pay-skip-warn">⚠️ Couldn't read ${_skipped.length} saved period${_skipped.length > 1 ? 's' : ''}, so this may be too low — re-save ${_skipped.length > 1 ? 'them' : 'it'} on the calculator.</span>`;
    }
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
  // New-starter visibility clamp (v15.97): a member who only joined THIS tax year was never
  // employed in the prior year, so they earn no prior-year HPP — hide the section entirely, the
  // same clamp the period select / tax-year tabs / prev-next already honour. Without this a new
  // starter saw a misleading "No <prior year> variable pay recorded — check your January payslip"
  // prompt for a year they never worked (whole-codebase review, paycalc-maths finding #1).
  if (!isTaxYearVisible(priorTy)) { section.classList.add('hidden'); return; }
  const estRaw    = lsGet(hppEstKey(priorTy));
  const actualRaw = lsGet(hppActualKey(priorTy));
  let   est       = estRaw    ? parseFloat(estRaw)    : 0;
  let _priorSkipped = 0;   // corrupt prior-year periods — surfaced on the card, never console-only (v16.70)
  const actual    = actualRaw ? parseSmartFloat(actualRaw) : 0;  // smart-parse so a pre-v16.84 raw "1,200" self-heals (v16.84)

  // If no stored estimate yet, compute on the fly so the prior-year HPP section
  // is populated on first login even before the user has visited a prior-year period.
  if (est === 0 && !actual) {
    const _priorPeriods = getPeriods().filter(/** @param {any} p */ p => {
      const o = p.num - 48;
      return o >= priorTy.first && o <= priorTy.last;
    });

    if (isActualsDev(getLoggedMember())) {
      const _act = readPayslipActuals();
      const _priorVar = _priorPeriods.reduce((/** @type {number} */ sum, /** @type {any} */ p) => {
        const a = _act[formatISO(p.payday)];
        return a?.varPay != null ? sum + a.varPay : sum;
      }, 0);
      if (_priorVar > 0) est = _priorVar * HPP_FRACTION;
    } else {
      // The PRIOR year's stored per-year rate, else the grade default. Pass useLegacyFallback=false
      // so an absent per-year rate does NOT fall through to the legacy SK.rate (the last-saved rate):
      // after an April award that key holds the NEW rate, which would over-price last year's variable
      // pay in this persisted, January-payslip-bound estimate.
      const rate = getStoredRateForYear(priorTy, false);
      let _priorVar = 0;
      _priorPeriods.forEach(/** @param {any} p */ p => {
        try {
          const parsed = readSavedPeriod(p.num);
          if (parsed.error) { _priorSkipped++; console.warn('[PayCalc] HPP prior-year corrupt period', p.num); return; }
          if (!parsed.data) return;
          const d = parsed.data;
          if (isDataEmpty(d)) return;
          _priorVar += _varPayForPeriod(p, d, rate);
        } catch (e) {
          _priorSkipped++;
          console.warn('[PayCalc] HPP prior-year skipped period', p.num, e);
        }
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
    // "No variable pay recorded" would be a LIE when the truth is unreadable saved data (v16.70).
    if (basisEl)  basisEl.textContent  = _priorSkipped > 0
      ? `Couldn't read ${_priorSkipped} saved ${priorTy.label} period${_priorSkipped > 1 ? 's' : ''} — re-save ${_priorSkipped > 1 ? 'them' : 'it'} on the calculator, then check your January ${priorTy.hppPaidJan} payslip`
      : `No ${priorTy.label} variable pay recorded — check your January ${priorTy.hppPaidJan} payslip`;
  }
  // Corrupt periods behind a PARTIAL estimate: the figure shown may be too low — say so (v16.70).
  if (_priorSkipped > 0 && actual <= 0 && est > 0 && basisEl) {
    basisEl.innerHTML += ` <span class="pay-skip-warn">⚠️ Couldn't read ${_priorSkipped} saved period${_priorSkipped > 1 ? 's' : ''}, so this may be too low.</span>`;
  }

  const input = document.getElementById('priorHppActualInput');
  if (input) {
    const stored = actualRaw || '';
    if (document.activeElement !== input) /** @type {HTMLInputElement} */ (input).value = stored;
  }

  section.classList.remove('hidden');
}
