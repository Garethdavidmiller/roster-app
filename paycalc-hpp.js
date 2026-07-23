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
  taxYearForPeriod, capHours, getRateForPeriod, getLondonAllowanceForPeriod,
} from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, todaysPeriodNum, hasBankHoliday, hasBoxingDay, isTaxYearVisible } from './paycalc-periods.js';
import { getLoggedMember, getGrade, getEffectiveContr, getProRateFactor, getPensionDefault, getStoredRateForYear } from './paycalc-settings.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { readSavedPeriod, hppEstKey, hppActualKey, hppModeKey, ytdSrcKey, readPayslipActuals, isActualsDev } from './paycalc-migrations.js';
import { formatISO, parseSmartFloat } from './roster-data.js';
import { fmt, fdList } from './paycalc-format.js';

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

// ── AMOUNT SOURCE (v18.32; 'ytd' reworked to read the Year to Date card v18.34) ──────────────────
// The current-year estimate can come from three sources, mirroring the back-pay card's compute/enter
// toggle: 'hours' (default — the per-payslip estimator below), 'ytd' (derived FROM the Year to Date
// Figures card's Taxable Pay — see below), or 'exact' (a figure the member enters). Whichever mode
// is active, calcHPP writes the resulting figure to hppEstKey(ty) — so the existing January take-home
// add + prior-year rollover (both read hppEstKey via resolveHppForPeriod) work unchanged.

/**
 * Rough HPP from a Year to Date TAXABLE PAY figure. Taxable Pay is ALL pay (basic + premiums +
 * London, after pension); HPP is 7.69% of the PREMIUM part only. So we subtract the expected
 * non-premium pay (basic + London − pension) to isolate the premiums, then take 4/52. Pure — the
 * caller computes `nonPremiumYtd` from the covered periods (`_expectedNonPremiumYtd`). Clamps at 0
 * (a negative "premium" means the Taxable Pay figure is below expected basic — nothing to premium).
 * @param {number} taxablePayYtd  Year to Date Taxable Pay from the YTD card
 * @param {number} nonPremiumYtd  expected basic + London − pension over the covered periods
 * @returns {number}
 */
export function hppFromYtdTaxable(taxablePayYtd, nonPremiumYtd) {
  return Math.max(0, (taxablePayYtd || 0) - (nonPremiumYtd || 0)) * HPP_FRACTION;
}

/**
 * Expected NON-premium taxable pay (basic + London − pension) summed over the tax-year periods the
 * Year to Date figure covers (up to its source payslip, or today if unknown). Subtracted from the
 * YTD Taxable Pay to leave the premium pay that accrues HPP. Reads live grade/rate/pension via the
 * settings + calc helpers, so it tracks the mid-year rate/London steps. @param {any} ty
 * @returns {{ nonPremium: number, count: number }}
 */
function _expectedNonPremiumYtd(ty) {
  const grade       = getGrade();
  const settledRate = getStoredRateForYear(ty);
  const srcNum      = parseInt(lsGet(ytdSrcKey(ty)) ?? '', 10) || 0;
  // Cap at the YTD source payslip; if none recorded, cap at today's period (never the whole year,
  // which would over-count basic for periods not yet paid and understate the premium).
  const capNum = srcNum || todaysPeriodNum();
  const covered = getPeriods().filter(/** @param {any} p */ p => {
    const o = p.num - 48;
    return o >= ty.first && o <= ty.last && p.num <= capNum;
  });
  let nonPremium = 0;
  for (const p of covered) {
    // Pro-rate EVERY non-premium component by the joining factor (v18.55), mirroring calculate()
    // (London ×_proRateFactor at paycalc-app.js:904, pension ×getProRateFactor via _periodDefaultPension)
    // and the real payslip. `basic` already carries the factor via getEffectiveContr; London and
    // pension were left at FULL value — so for a mid-year joiner every pre-start period (factor 0)
    // added phantom "London − pension" non-premium pay (~£129/period) and the joining period
    // double-counted, biasing the rough 'ytd' HPP estimate LOW. Factor is 0 for a fully-pre-start
    // period and 1 for long-servers / noProRate returns, so this never over-reaches.
    const factor  = getProRateFactor(p);
    const basic   = getEffectiveContr(p) * getRateForPeriod(p, grade, ty.label, settledRate);
    const london  = getLondonAllowanceForPeriod(p, ty) * factor;
    const pension = (parseFloat(String(getPensionDefault(p))) || 0) * factor;
    nonPremium += basic + london - pension;
  }
  return { nonPremium, count: covered.length };
}

/** The 'ytd'-mode rough figure and its ingredients, read live from the Year to Date card.
 *  hpp is 0 when the source can't estimate (no Taxable Pay entered, or no covered periods yet —
 *  the caller branches on taxable/count for the specific message). Shared by _renderHppManual
 *  and the per-radio figures (_updateModeAmounts) so the two can never disagree. @param {any} ty
 *  @returns {{ taxable: number, nonPremium: number, count: number, extra: number, hpp: number }} */
function _ytdRoughHpp(ty) {
  const ytdPayEl = /** @type {HTMLInputElement|null} */ (document.getElementById('ytdPay'));
  const taxable  = Math.max(0, parseSmartFloat(ytdPayEl?.value ?? '') || 0);
  const { nonPremium, count } = _expectedNonPremiumYtd(ty);
  return {
    taxable, nonPremium, count,
    extra: Math.max(0, taxable - nonPremium),
    hpp:   (taxable > 0 && count > 0) ? hppFromYtdTaxable(taxable, nonPremium) : 0,
  };
}

/** The amount-source mode currently selected on the card ('hours' | 'ytd' | 'exact'; default 'hours'). */
function _hppMode() {
  const r = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="hppMode"]:checked'));
  return r ? r.value : 'hours';
}

/** Reflect a mode into the DOM: tick its radio and show only the matching input group. Exported so
 *  the coordinator can restore a saved mode. @param {string} [mode] */
export function applyHppMode(mode = '') {
  const m = mode || _hppMode();
  const radio = /** @type {HTMLInputElement|null} */ (document.getElementById(
    m === 'ytd' ? 'hppModeYtd' : m === 'exact' ? 'hppModeExact' : 'hppModeHours'));
  if (radio) radio.checked = true;
  const ytdWrap   = document.getElementById('hppYtdWrap');
  const exactWrap = document.getElementById('hppExactWrap');
  if (ytdWrap)   ytdWrap.style.display   = m === 'ytd'   ? '' : 'none';
  if (exactWrap) exactWrap.style.display = m === 'exact' ? '' : 'none';
}

/** Persist the card's mode + the exact-figure input for a tax year (one JSON blob). The 'ytd' mode
 *  has no input of its own (it reads the Year to Date card), so only the mode + exact are stored. @param {any} ty */
export function saveHppState(ty) {
  if (!ty) return;
  const exactEl = /** @type {HTMLInputElement|null} */ (document.getElementById('hppExactAmt'));
  lsSet(hppModeKey(ty), JSON.stringify({ mode: _hppMode(), exact: exactEl ? exactEl.value : '' }));
}

/** Restore a tax year's saved mode + exact-figure input into the DOM (called before calcHPP reads it
 *  on a period/year change). Missing/corrupt blob → default 'hours'. @param {any} ty */
export function restoreHppState(ty) {
  let s = /** @type {{mode?:string, exact?:string}} */ ({});
  try { const raw = ty ? lsGet(hppModeKey(ty)) : null; if (raw) s = JSON.parse(raw); } catch { s = {}; }
  const exactEl = /** @type {HTMLInputElement|null} */ (document.getElementById('hppExactAmt'));
  if (exactEl) exactEl.value = s.exact || '';
  applyHppMode(s.mode === 'ytd' || s.mode === 'exact' ? s.mode : 'hours');
}

/** The status-word label, shared by both modes: bare "Estimated" when a prior-year subhead carries
 *  the year, else the self-contained form. @param {any} ty */
function _hppLabelText(ty) {
  const idx = CONFIG.TAX_YEARS.findIndex(t => t.label === ty.label);
  const hasPrior = idx > 0 && isTaxYearVisible(CONFIG.TAX_YEARS[idx - 1]);
  return hasPrior ? 'Estimated' : `Estimated ${ty.label} Holiday Pay Premium`;
}

/** The "how it's calculated" explainer, shared by both modes (it describes what HPP IS). @param {any} ty */
function _hppNoteHtml(ty) {
  return `<strong>How it's calculated (confirmed by Chiltern payroll):</strong> Your extra pay above basic hours (Saturday, overtime, rest day working, Sunday, bank-holiday and Boxing Day premiums) × 7.69% (that's 4 weeks' leave out of 52). Basic pay, London Allowance, peer training, expenses and bonuses are not included. This estimate covers the <strong>tax year ${ty.label}</strong> — Chiltern will pay it in <strong>January ${ty.hppPaidJan}</strong>, and it shows as <strong>Holiday Pay Premium</strong> on that payslip. The more of your payslips you enter above, the closer this gets to the full-year figure.`;
}

/** Render the current-year card from a NON-hours source and persist the resulting figure to
 *  hppEstKey so the take-home add + rollover use it exactly like the hours-mode figure. Deleting on
 *  zero mirrors the hours path so a cleared/empty source can't leave a stale figure.
 *  - 'ytd'   : derive a ROUGH premium figure from the Year to Date card's Taxable Pay (#ytdPay).
 *  - 'exact' : the member's own entered figure (#hppExactAmt).
 *  @param {any} ty @param {string} mode */
function _renderHppManual(ty, mode) {
  const amountEl = document.getElementById('hppAmount');
  const basisEl  = document.getElementById('hppBasis');

  if (mode === 'ytd') {
    const y = _ytdRoughHpp(ty);
    if (y.taxable <= 0) {
      lsDel(hppEstKey(ty));
      if (amountEl) amountEl.textContent = '£–';
      if (basisEl)  basisEl.textContent  = 'Fill in the Year to Date Figures card above (Taxable Pay) to use this';
      return;
    }
    // Zero covered periods (a tax year that hasn't started yet — reachable once next year is added
    // to TAX_YEARS ahead of April, as each new award year is): nonPremium would be 0 and the WHOLE
    // Taxable Pay would be presented as premium — wildly overstated. Refuse to estimate instead.
    if (y.count === 0) {
      lsDel(hppEstKey(ty));
      if (amountEl) amountEl.textContent = '£–';
      if (basisEl)  basisEl.textContent  = `No ${ty.label} payslips have been paid yet, so there's nothing to estimate from — try again once the year is under way.`;
      return;
    }
    const { extra, hpp } = y;
    if (hpp > 0) lsSet(hppEstKey(ty), hpp.toFixed(2)); else lsDel(hppEstKey(ty));
    if (amountEl) amountEl.textContent = hpp > 0 ? fmt(hpp) : '£–';
    if (basisEl) {
      basisEl.innerHTML = hpp > 0
        ? `Rough estimate: ${fmt(extra)} premium pay (your Year to Date Taxable Pay minus expected basic pay + London) × 7.69% · due January ${ty.hppPaidJan} <span class="hpp-partial-hint">This is an approximation from your Year to Date pay — for the accurate figure, fill in your hours on each payslip in the calculator and choose the first option.</span>`
        : `Your Year to Date Taxable Pay looks lower than the expected basic pay, so there's no premium to estimate from it — fill in your hours on each payslip in the calculator instead, or enter the figure yourself.`;
    }
    return;
  }

  // 'exact' — the member's own figure.
  const exactEl = /** @type {HTMLInputElement|null} */ (document.getElementById('hppExactAmt'));
  const hpp     = Math.max(0, parseSmartFloat(exactEl?.value ?? '') || 0);
  if (hpp > 0) lsSet(hppEstKey(ty), hpp.toFixed(2)); else lsDel(hppEstKey(ty));
  if (amountEl) amountEl.textContent = hpp > 0 ? fmt(hpp) : '£–';
  if (basisEl)  basisEl.textContent  = hpp > 0
    ? `Your entered figure · due January ${ty.hppPaidJan}`
    : 'Enter your Holiday Pay Premium figure above';
}

/**
 * The hours-mode ('from my payslips') estimate, extracted from calcHPP (v18.40) so it can run in
 * EVERY mode — it feeds the per-radio figures as well as the hours-mode render. NO side effects:
 * no DOM writes, no persistence (calcHPP's hours path owns those, guarded on `skipped`).
 *
 * Rate: THIS tax year's stored settled rate — deliberately NOT the live #hourlyRate field.
 * The field shows the PRE-AWARD rate whenever a pre-award period is selected (updateRateForPeriod),
 * so reading it made the whole-year HPP estimate SHIFT depending on which period you were viewing
 * (same year → two different premiums, purely from clicking Prev/Next). The stored year rate is
 * stable across navigation and mirrors updatePriorHpp's prior-year path, which already does this.
 *
 * @param {any} ty @param {any[]} allPeriods
 * @returns {{ hpp: number, totalVar: number, pCount: number, usingActuals: boolean,
 *             paidCount: number, skipped: number[], total: number, missingPaid: Date[] }}
 */
function _hoursEstimate(ty, allPeriods) {
  const rate    = getStoredRateForYear(ty);
  const periods = allPeriods.filter(/** @param {any} p */ p => {
    const o = p.num - 48;
    // Exclude periods ENTIRELY before a mid-year joiner's start (v18.54): getProRateFactor is 0
    // only when the whole period predates startDate (it returns 1 for noProRate secondment returns
    // and for members with no startDate, so this never over-reaches). Without this a joiner's
    // pre-employment payslips landed in `missingPaid` ("Not entered yet: 10 Apr…") and inflated the
    // "N of 13" denominator — telling them to fill in payslips from before they joined. The HPP £ is
    // unchanged (those periods contribute £0 of variable pay either way); only the count/list fix.
    return o >= ty.first && o <= ty.last && getProRateFactor(p) !== 0;
  });

  let totalVar     = 0;
  let pCount       = 0;
  let paidCount    = 0;   // entered periods whose payday has passed (v18.51 — the "N paid + M upcoming" split)
  let usingActuals = false;
  const skipped = /** @type {number[]} */ ([]);   // periods whose saved data couldn't be read — surfaced, never dropped silently
  // Paid payslips with NO saved hours (v18.42 — review item 2): named on the card so "4 of 13"
  // becomes actionable. Only PAID paydays — a future payslip isn't "missing", it hasn't happened.
  const missingPaid = /** @type {Date[]} */ ([]);
  const _now = new Date();
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
        if (p.payday <= _now) paidCount++;
        usingActuals = true;
        return;
      }

      const parsed = readSavedPeriod(p.num);
      if (parsed.error) { skipped.push(p.num); console.warn('[PayCalc] HPP corrupt period', p.num); return; }
      if (!parsed.data || isDataEmpty(parsed.data)) {
        if (p.payday <= _now) missingPaid.push(p.payday);
        return;
      }
      pCount++;
      if (p.payday <= _now) paidCount++;
      totalVar += _varPayForPeriod(p, parsed.data, rate);
    } catch (e) {
      // A corrupt saved period must not abort the whole estimate, but dropping it silently would
      // under-state the premium — record it (surfaced by calcHPP) and trace it.
      skipped.push(p.num);
      console.warn('[PayCalc] HPP skipped period', p.num, e);
    }
  });

  return { hpp: totalVar * HPP_FRACTION, totalVar, pCount, paidCount, usingActuals, skipped, total: periods.length, missingPaid };
}

/**
 * Print each amount-source's CURRENT figure beside its radio (v18.40 — review item 4), so choosing
 * a mode is informed rather than blind — and a big gap between "from my payslips" and "from Year
 * to Date" is itself a signal the entered hours are incomplete. Estimates carry a leading "≈";
 * the member's own exact figure is shown plain. A source with nothing to offer shows nothing
 * (quiet default — the empty span costs no space).
 * @param {any} ty @param {{ hpp: number, pCount: number }} hoursRes
 */
function _updateModeAmounts(ty, hoursRes) {
  const set = /** @param {string} id @param {string} txt */ (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };
  set('hppModeHoursAmt', (hoursRes.pCount > 0 && hoursRes.hpp > 0) ? `≈ ${fmt(hoursRes.hpp)}` : '');
  const _ytd = _ytdRoughHpp(ty);
  set('hppModeYtdAmt', _ytd.hpp > 0 ? `≈ ${fmt(_ytd.hpp)}` : '');
  const exactEl = /** @type {HTMLInputElement|null} */ (document.getElementById('hppExactAmt'));
  const exact   = Math.max(0, parseSmartFloat(exactEl?.value ?? '') || 0);
  set('hppModeExactAmt', exact > 0 ? fmt(exact) : '');
}

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

  // Label + explainer are the same in every amount-source mode — set them once, up front.
  const _labelEl = document.getElementById('hppLabel');
  if (_labelEl) _labelEl.textContent = _hppLabelText(ty);
  const _noteEl = document.getElementById('hppNote');
  if (_noteEl) _noteEl.innerHTML = _hppNoteHtml(ty);

  // The hours estimate is computed in EVERY mode now (v18.40 — review item 4): it feeds the
  // per-radio figures so choosing an amount source is informed, not blind. Persistence stays
  // strictly per-mode below — only the ACTIVE mode's figure is written to hppEstKey.
  const hoursRes = _hoursEstimate(ty, allPeriods);
  _updateModeAmounts(ty, hoursRes);

  // Manual amount sources ('ytd' / 'exact') short-circuit the per-payslip estimator below (v18.32).
  const _mode = _hppMode();
  if (_mode !== 'hours') { _renderHppManual(ty, _mode); updatePriorHpp(ty); return; }

  const { hpp, totalVar, pCount, usingActuals, skipped: _skipped } = hoursRes;
  const amountEl = document.getElementById('hppAmount');
  const basisEl  = document.getElementById('hppBasis');

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

  // The status-word label ("Estimated" / self-contained form) was set up front via _hppLabelText.
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
      const _total = hoursRes.total;
      // When entered periods include FUTURE payslips (calendar-filled ahead of time), say so —
      // "11 of 13 entered" hid that 7 of them hadn't been paid yet, which made the count clash
      // with the Year to Date card's "4 of 4 paid" frame (v18.51 — owner's screenshot review).
      const _upcoming = pCount - hoursRes.paidCount;
      const _countPhrase = _upcoming > 0
        ? `${hoursRes.paidCount} paid + ${_upcoming} upcoming payslips entered`
        : `${pCount} of ${_total} payslip${_total !== 1 ? 's' : ''} entered`;
      basisEl.textContent = usingActuals
        ? `All ${pCount} payslips of ${ty.label} · ${fmt(totalVar)} extra pay × 7.69% · from your payslips · due January ${ty.hppPaidJan}`
        : `${_countPhrase} · ${fmt(totalVar)} extra pay × 7.69% · due January ${ty.hppPaidJan}`;
      // Clean partial (no unreadable periods): nudge the member that the estimate isn't the
      // full-year figure yet, NAMING the paid payslips still empty so "N of M" is actionable
      // (v18.42 — review item 2). All paid payslips entered → say so; only future ones remain.
      if (!usingActuals && _skipped.length === 0 && pCount < _total) {
        const _miss = hoursRes.missingPaid;
        basisEl.innerHTML += ` <span class="hpp-partial-hint">${_miss.length
          ? `Not entered yet: ${fdList(_miss)}. For the full-year figure, fill in your hours on each payslip of the year.`
          : `You're up to date — later payslips join the estimate as the year goes on.`}</span>`;
      }
    }
    // A corrupt saved period was excluded, so this premium may be too low — surface it rather than
    // quietly under-stating money (no-silent-caps). Rare: only malformed localStorage trips it.
    if (_skipped.length && basisEl) {
      basisEl.innerHTML += ` <span class="pay-skip-warn">⚠️ Couldn't read ${_skipped.length} saved payslip${_skipped.length > 1 ? 's' : ''}, so this may be too low — open ${_skipped.length > 1 ? 'those periods' : 'that period'} above and enter the hours again.</span>`;
    }
  }

  // The "how it's calculated" note was set up front via _hppNoteHtml (shared with the manual modes).
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
      // The PRIOR year's settled rate — derived from AWARD_RATES per tax year (v17.87), so last
      // year prices at last year's rate, never the current one. (The second arg is a retained
      // no-op since the localStorage rate store was removed.)
      const rate = getStoredRateForYear(priorTy);
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
  // The confirm input is DISABLED until the January payslip carrying the premium EXISTS
  // (v18.51 — mirrors the back-pay manual-entry gate): there is no printed figure to copy from a
  // payslip that hasn't been paid. First January payday of the due year = the earliest it can
  // arrive; a stored actual (shouldn't exist pre-payday) still displays either way.
  const _janPayday = getPeriods().find(/** @param {any} p */ p =>
    p.payday.getFullYear() === priorTy.hppPaidJan && p.payday.getMonth() === 0)?.payday;
  const _janArrived = !!(_janPayday && _janPayday < new Date());
  if (input) {
    const stored = actualRaw || '';
    if (document.activeElement !== input) /** @type {HTMLInputElement} */ (input).value = stored;
    /** @type {HTMLInputElement} */ (input).disabled = !_janArrived && !hasActual;
  }
  // The entry apparatus must not go stale once a figure is confirmed (v17.99): the "enter when the
  // payslip arrives" note only shows while EMPTY, and the hint flips to how to undo.
  const actNote = document.getElementById('priorHppActualNote');
  if (actNote) actNote.classList.toggle('hidden', hasActual);
  const actHint = document.getElementById('priorHppActualHint');
  if (actHint) actHint.innerHTML = hasActual
    ? 'Entered from your January payslip — clear the box to go back to the estimate.'
    : _janArrived
      ? `Find the <strong>Holiday Pay Premium</strong> line on your January ${priorTy.hppPaidJan} payslip and enter it here — it replaces the estimate above and updates your January take-home.`
      : `Unlocks when your January ${priorTy.hppPaidJan} payslip arrives — the confirmed <strong>Holiday Pay Premium</strong> figure on it replaces the estimate above.`;

  section.classList.remove('hidden');
}
