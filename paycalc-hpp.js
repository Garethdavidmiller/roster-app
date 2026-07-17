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
  taxYearForPeriod, capHours,
} from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, hasBankHoliday, hasBoxingDay, isTaxYearVisible } from './paycalc-periods.js';
import { getLoggedMember, getEffectiveContr, getStoredRateForYear } from './paycalc-settings.js';
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

/**
 * Resolve which HPP figure applies for a tax year's January payslip: a CONFIRMED actual —
 * present in storage, EVEN £0 — always wins over the running estimate. A member who enters the
 * real figure from their payslip (including a genuine £0, e.g. after a year of absence) must
 * override any earlier estimate; before v17.26 the `actual > 0` test silently ignored a confirmed
 * £0 and kept adding the stale estimate to the January take-home. Absence of the actual (never
 * entered / cleared) falls back to the estimate. Negatives clamp to 0 (a payslip HPP can't be
 * negative). PURE — the single source of the "actual beats estimate" rule, shared by calcHPP's
 * take-home add (paycalc-app.js) and the prior-year display (updatePriorHpp).
 * @param {string|null|undefined} actualRaw - raw stored actual ('' / null = not confirmed)
 * @param {string|null|undefined} estRaw    - raw stored estimate
 * @returns {{ amount: number, isEstimate: boolean, hasActual: boolean }}
 */
export function resolveHppForPeriod(actualRaw, estRaw) {
  const hasActual = actualRaw != null && String(actualRaw).trim() !== '';
  if (hasActual) {
    return { amount: Math.max(0, parseSmartFloat(actualRaw) || 0), isEstimate: false, hasActual: true };
  }
  const est = Math.max(0, parseFloat(String(estRaw ?? '')) || 0);
  return { amount: est, isEstimate: est > 0, hasActual: false };
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
// updatePriorHpp to avoid duplicating the capping logic.
// bhCapped mirrors calculate(): when all contracted hours are Saturday, bhCapped = 0
// and the BH premium must not contribute to HPP (it wasn't in that period's gross).
/**
 * Compute variable (extra) pay for one period from saved data — the pay that ACCRUES HPP.
 * Used by calcHPP, updatePriorHpp, and paycalc-backpay.js.
 * Includes: OT, RDW, Sunday, Boxing Day, Saturday uplift, bank-holiday premium.
 * Does NOT include: London Allowance, peer training, basic pay, expenses, bonuses.
 *
 * London Allowance is a FIXED allowance paid EVERY period — including the periods you are on
 * leave — so it needs no holiday premium and does NOT accrue HPP. This is the documented payroll
 * rule (KNOWN_LIMITATIONS.md #3: "basic pay / London Allowance (no HPP)"), confirmed by the owner;
 * a real payslip shows the annual HPP lump as its own line, separate from London Allowance. London
 * was wrongly folded into the HPP base (v16.90, priced settled-whole-year); removed at v17.23.
 * @param {any} p - Period object.
 * @param {any} d - Saved period data.
 * @param {number} rate - Hourly rate.
 */
export function _varPayForPeriod(p, d, rate) {
  const r125      = rate * RATE_125, r150 = rate * RATE_150, r300 = rate * RATE_300;
  const { satHrs, bhHrs, bhOtHrs, otHrs, rdwHrs, sunHrs, boxHrs } = _decodeHours(p, d);
  const { satCapped, bhCapped } = capHours({ effContr: getEffectiveContr(p), satHrs, bhHrs });
  return satCapped * (rate * (RATE_125 - 1)) +
         bhCapped  * (rate * (RATE_125 - 1)) +
         bhOtHrs   * r125                    +
         otHrs     * r125          +
         rdwHrs    * r125          +
         sunHrs    * r150          +
         boxHrs    * r300;
}

// ── HPP ESTIMATOR ─────────────────────────────────────────────────────────────
// Formula from Chiltern payroll (Marie Firby): (variable pay above basic) × 4/52 = HPP.
// "Above basic" here means the genuinely VARIABLE premiums (OT/RDW/Sun/Sat/BH/Boxing) only —
// the fixed London Allowance is paid every period incl. during leave, so it does NOT accrue HPP
// (see _varPayForPeriod). Confirmed by a real Jan-2026 payslip (HPP and London are separate lines).

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
 * The RATE is priced settled-whole-year (getStoredRateForYear), so a pre-award period's variable
 * pay already carries the full award and there is nothing left for back pay to add here. (London
 * Allowance does NOT enter the HPP base at all — removed v17.23; see _varPayForPeriod.)
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
  // Only touch the persisted estimate when the computation was CLEAN (no unreadable periods).
  // When periods were skipped, `hpp` is UNDER-stated (missing them) — so neither overwrite a
  // previously-complete stored figure (the pre-v17.26 bug: `if (hpp > 0)` wrote regardless) nor
  // delete it. The card still SHOWS the understated hpp with the "may be too low" warning.
  if (_skipped.length === 0) {
    if (hpp > 0) lsSet(hppEstKey(ty), hpp.toFixed(2));
    else lsDel(hppEstKey(ty));
  }

  // One heading pattern with the prior section: "Last year (2025/26)" / "This year (2026/27)"
  // subheads carry the year, so the amount label is just the status word — matching the prior
  // block's Estimated/✓ Confirmed labels. When the prior section is HIDDEN (first tax year /
  // new-starter clamp) no subhead shows, so keep the full self-contained label.
  const _tyIdx    = CONFIG.TAX_YEARS.findIndex(t => t.label === ty.label);
  const _hasPrior = _tyIdx > 0 && isTaxYearVisible(CONFIG.TAX_YEARS[_tyIdx - 1]);
  if (labelEl) labelEl.textContent = _hasPrior ? 'Estimated' : `Estimated ${ty.label} Holiday Pay Premium`;
  if (pCount === 0) {
    if (amountEl) amountEl.textContent = '£–';
    if (basisEl)  basisEl.textContent  = 'Enter your hours on each payslip above to calculate';
    // EVERY readable period failed to parse — the worst case must not be the silent one (the
    // partial-corruption warning below only renders on the non-empty branch).
    if (_skipped.length && basisEl) {
      basisEl.innerHTML += ` <span class="pay-skip-warn">⚠️ Couldn't read ${_skipped.length} saved payslip${_skipped.length > 1 ? 's' : ''}, so no premium could be calculated — open ${_skipped.length > 1 ? 'those periods' : 'that period'} above and enter the hours again.</span>`;
    }
  } else {
    if (amountEl) amountEl.textContent = fmt(hpp);
    if (basisEl) {
      // Show pCount OUT OF the year's total periods so a member with only a few payslips entered
      // sees WHY the figure is small (the single biggest support-question risk — a partial estimate
      // looks authoritative). One 4-weekly period = one payslip, so "payslips" reads plainer than
      // "periods" for staff.
      const _total = periods.length;
      basisEl.textContent = usingActuals
        ? `All ${pCount} payslips of ${ty.label} · ${fmt(totalVar)} extra pay × 7.69% · from your payslips · due January ${ty.hppPaidJan}`
        : `${pCount} of ${_total} payslip${_total !== 1 ? 's' : ''} entered · ${fmt(totalVar)} extra pay × 7.69% · due January ${ty.hppPaidJan}`;
      // Clean partial (no unreadable periods): nudge the member that the estimate isn't the
      // full-year figure yet. (When periods were skipped, the "may be too low" warning below covers it.)
      if (!usingActuals && _skipped.length === 0 && pCount < _total) {
        basisEl.innerHTML += ` <span class="hpp-partial-hint">For the full-year figure, fill in your hours on each payslip of the year.</span>`;
      }
    }
    // A corrupt saved period was excluded, so this premium may be too low — surface it rather than
    // quietly under-stating money (no-silent-caps). Rare: only malformed localStorage trips it.
    if (_skipped.length && basisEl) {
      basisEl.innerHTML += ` <span class="pay-skip-warn">⚠️ Couldn't read ${_skipped.length} saved payslip${_skipped.length > 1 ? 's' : ''}, so this may be too low — open ${_skipped.length > 1 ? 'those periods' : 'that period'} above and enter the hours again.</span>`;
    }
  }

  const noteEl = document.getElementById('hppNote');
  if (noteEl) {
    noteEl.innerHTML = `<strong>How it's calculated (confirmed by Chiltern payroll):</strong> Your extra pay above basic hours (Saturday, overtime, rest day working, Sunday, bank-holiday and Boxing Day premiums) × 7.69% (that's 4 weeks' leave out of 52). Basic pay, London Allowance, peer training, expenses and bonuses are not included. This estimate covers the <strong>tax year ${ty.label}</strong> — Chiltern will pay it in <strong>January ${ty.hppPaidJan}</strong>, and it shows as <strong>Holiday Pay Premium</strong> on that payslip. The more of your payslips you enter above, the closer this gets to the full-year figure.`;
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
  // A confirmed actual is signalled by KEY PRESENCE, not `> 0` — a member who enters a genuine £0
  // from their payslip has confirmed it (v17.26). smart-parse so a pre-v16.84 raw "1,200" self-heals.
  const hasActual = actualRaw != null && actualRaw.trim() !== '';
  const actual    = hasActual ? Math.max(0, parseSmartFloat(actualRaw) || 0) : 0;

  // If no stored estimate yet, compute on the fly so the prior-year HPP section
  // is populated on first login even before the user has visited a prior-year period.
  if (est === 0 && !hasActual) {
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

    // Persist only a CLEAN prior-year estimate — a partial (skipped-period) figure is understated
    // and must not overwrite a good stored value or the January take-home add (mirrors calcHPP).
    if (est > 0 && _priorSkipped === 0) lsSet(hppEstKey(priorTy), est.toFixed(2));
  }

  const pNum = currentPeriodNum();
  const curP = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
  const isJanPayday = curP &&
    curP.payday.getFullYear() === priorTy.hppPaidJan &&
    curP.payday.getMonth() === 0;

  const priorHppTitleEl    = document.getElementById('priorHppTitle');
  const currentHppTitleEl  = document.getElementById('currentHppTitle');
  if (priorHppTitleEl)   priorHppTitleEl.textContent   = `Last year (${priorTy.label})`;
  if (currentHppTitleEl) currentHppTitleEl.textContent = `This year (${ty.label})`;

  const dueBadge = document.getElementById('priorHppDueBadge');
  if (dueBadge) dueBadge.classList.toggle('hidden', !isJanPayday || hasActual);

  const amtLabel = document.getElementById('priorHppAmtLabel');
  const amtEl    = document.getElementById('priorHppAmt');
  const basisEl  = document.getElementById('priorHppBasis');

  if (hasActual) {
    if (amtLabel) amtLabel.innerHTML  = `<span class="actual-badge">✓ Confirmed</span>`;
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
      ? `Couldn't read ${_priorSkipped} saved ${priorTy.label} payslip${_priorSkipped > 1 ? 's' : ''} — open ${_priorSkipped > 1 ? 'those periods' : 'that period'} and enter the hours again, then check your January ${priorTy.hppPaidJan} payslip`
      : `No ${priorTy.label} variable pay recorded — check your January ${priorTy.hppPaidJan} payslip`;
  }
  // Corrupt periods behind a PARTIAL estimate: the figure shown may be too low — say so (v16.70).
  if (_priorSkipped > 0 && !hasActual && est > 0 && basisEl) {
    basisEl.innerHTML += ` <span class="pay-skip-warn">⚠️ Couldn't read ${_priorSkipped} saved period${_priorSkipped > 1 ? 's' : ''}, so this may be too low.</span>`;
  }

  const input = document.getElementById('priorHppActualInput');
  if (input) {
    const stored = actualRaw || '';
    if (document.activeElement !== input) /** @type {HTMLInputElement} */ (input).value = stored;
  }

  section.classList.remove('hidden');
}
