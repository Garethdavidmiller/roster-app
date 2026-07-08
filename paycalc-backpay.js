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
  getTaxYearForOffset, awardRatesFor, awardFromForYear, capHours,
} from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, todaysPeriodNum, payslipPeriodNum, _setSelectPeriod, buildBackPayPeriodSelect } from './paycalc-periods.js';
import { getGrade, getEffectiveContr, getProRateFactor, getStoredRateForYear } from './paycalc-settings.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { SK, periodKey, bpKey } from './paycalc-migrations.js';
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

// The award tax year the card's rate/London/% boxes were last prefilled for. The card computes the
// award for whichever tax year is selected in the main calculator, but reuses the same DOM inputs;
// when the year changes we must clear the stale figures so the next year's real rates prefill in
// (otherwise a 2026/27 estimate would be shown under a 2025/26 label — see prefillBackPay).
/** @type {string|null} */
let _lastAwardYear = null;

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
 * @returns {{ bpAmount: number, bpVarAmount: number, bpPNum: number, bpIsEstimate: boolean, bpIncluded: boolean }}
 */
export function prefillBackPay() {
  const pNum = currentPeriodNum();
  const curP = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
  const ty   = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  const oldRateEl   = /** @type {HTMLInputElement} */ (document.getElementById('oldRate'));
  const newRateEl   = /** @type {HTMLInputElement} */ (document.getElementById('newRateInput'));
  const oldLondonEl = /** @type {HTMLInputElement} */ (document.getElementById('oldLondon'));
  const newLondonEl = /** @type {HTMLInputElement} */ (document.getElementById('newLondon'));
  const pctEl0      = /** @type {HTMLInputElement | null} */ (document.getElementById('bpRisePct'));

  // If the award YEAR changed since the boxes were last filled, the old year's figures are
  // meaningless — clear them so this year's real rates prefill in below (the fills are blank-guarded,
  // so without this a stale 2026/27 estimate would persist under a 2025/26 label). Within a year the
  // guard is a no-op, preserving any manual corrections. Coordinator's _applyBpRisePct then refills a
  // cleared New from the % (pending) or leaves the prefilled New (settled).
  if (_lastAwardYear !== ty.label) {
    for (const el of [oldRateEl, newRateEl, oldLondonEl, newLondonEl, pctEl0]) if (el) el.value = '';
    _lastAwardYear = ty.label;
  }

  // Rebuild the paid-in options for THIS award's window (its April onward — a payslip that predates
  // the award can't carry its lump), preserving a still-valid selection. A selection from another
  // award year is filtered out and falls through to the default below — without this, a 2026/27
  // paid-in survived a switch to the 2025/26 award and pushed the historic lump into a live
  // period's take-home (the wrong-period injection bug).
  const paidSel = /** @type {HTMLSelectElement} */ (document.getElementById('backPayPeriod'));
  if (paidSel) {
    const keep = paidSel.value;
    buildBackPayPeriodSelect(48 + ty.first);
    if (keep) _setSelectPeriod(paidSel, +keep); // no-op if the kept period isn't in this award's window
  }

  // The "Pay rise %" shortcut only makes sense while the award is an estimate — for a settled year
  // the real old→new rates are on record and prefilled, so the % box would be a dead control
  // (its auto-fill deliberately never overwrites the prefilled figures). Hide it.
  const pctField = document.getElementById('bpRisePctField');
  if (pctField) pctField.style.display = ty.rateUnconfirmed ? '' : 'none';

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
  // Name the award year on the card so it's clear WHICH annual rise is being calculated. For a
  // settled award, also show WHEN it was applied — it explains why later periods aren't in the count.
  const awardScopeEl = document.getElementById('bpAwardScope');
  const _fromDate    = awardFromForYear(ty.label);
  if (awardScopeEl) awardScopeEl.textContent = _fromDate
    ? `You're calculating the ${ty.label} pay award — backdated to 1 April, applied from ${fdShort(_fromDate)} (later periods were already on the new rate).`
    : `You're calculating the ${ty.label} pay award (backdated to 1 April).`;
  // The award is always backdated to 1 April (Chiltern's pay anniversary) — computed
  // internally by _backdatedFromPNum(); there is no "backdated from" selector to pre-set.
  // Default the "paid in" period: a SETTLED award defaults to the payslip that actually carried
  // the lump (the award-application date — 2025/26: 24 Oct 2025), so the lump lands where it
  // really landed and that period's estimate matches the real payslip. A pending award defaults
  // to the NEXT PAYDAY (the current period). Adjustable either way; the paid-in period is itself
  // excluded from the accrual (see calcBackPay's _capPNum).
  if (paidSel && !paidSel.value) {
    const _target = _fromDate
      ? (getPeriods().find(/** @param {any} x */ x => x.payday >= _fromDate)?.num ?? pNum)
      : pNum;
    _setSelectPeriod(paidSel, _target);
  }
  return calcBackPay();
}

// ── PERSISTENCE ───────────────────────────────────────────────────────────────
// The card's figures autosave per member (bpKey — myb_pc_<slug>_bp_state) like every other paycalc
// input, so the lump a member set up survives a reload. Previously the card's state was ephemeral:
// the paid-in period's take-home silently LOST the lump on reload until the card was reopened —
// the same period showed different take-home before and after a refresh.

/** Persist the card's raw inputs + the award year they belong to. Called from calcBackPay. */
function _saveBpState() {
  try {
    // Persist ONLY the CURRENT (today's) award year's state (v16.23). While viewing a historic
    // year — the calendar Pay pill / a past payday-cell tap deep-links init onto a past period,
    // and prev-period browsing with the card open recomputes too — an unconditional save
    // overwrote the member's current-year blob (include-tick, hand-corrected rates) with a
    // historic-year one. Trade-off (accepted): hand-entered figures for a HISTORIC award year
    // don't persist across reloads; they re-prefill from AWARD_RATES.
    const year = _bpAwardTaxYear(_backdatedFromPNum()).label;
    if (year !== _bpAwardTaxYear(todaysPeriodNum()).label) return;
    const v = /** @param {string} id */ (id) => /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ?? '';
    lsSet(bpKey(), JSON.stringify({
      year,
      pct:  v('bpRisePct'), oldR: v('oldRate'), newR: v('newRateInput'),
      oldL: v('oldLondon'), newL: v('newLondon'), paidIn: v('backPayPeriod'),
      inc:  /** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'))?.checked ? '1' : '',
    }));
  } catch { /* storage unavailable — card still works, just not persisted */ }
}

/**
 * Restore the persisted card figures into the DOM (card may stay closed). Only restores when the
 * stored award year matches the CURRENT award year — a stale year's figures are discarded (the
 * April rollover clean-slate). Sets _lastAwardYear so the first card-open doesn't wipe the
 * restored values.
 *
 * Returns true when a valid same-year blob was APPLIED — **even an all-blank one**: blank saved
 * fields mean the member deliberately cleared the card, and that choice must stick. The
 * coordinator treats false ("no saved state at all — first visit, or a new award year after the
 * rollover discard") as the cue to compute the DEFAULT pending-award estimate automatically.
 * @returns {boolean} true if a same-year saved state was applied.
 */
export function restoreBpState() {
  let s = null;
  try { s = JSON.parse(lsGet(bpKey()) || 'null'); } catch { /* corrupted — treat as absent */ }
  if (!s) return false;
  const year = _bpAwardTaxYear(_backdatedFromPNum()).label;
  if (s.year !== year) {
    // Delete ONLY a genuinely stale (past-year) blob — the April-rollover clean slate. When the
    // member is merely VIEWING a historic period (the calendar Pay pill / a past payday tap
    // deep-links init onto one), their CURRENT-year blob — include-tick, hand-corrected rates —
    // must survive; deleting it here silently dropped the lump from the paid-in payslip's
    // estimate on the next normal load (v16.23).
    if (s.year !== _bpAwardTaxYear(todaysPeriodNum()).label) lsDel(bpKey());
    return false;
  }
  const set = /** @param {string} id @param {any} val */ (id, val) => {
    const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
    if (el && val != null) el.value = String(val);
  };
  set('bpRisePct', s.pct); set('oldRate', s.oldR); set('newRateInput', s.newR);
  set('oldLondon', s.oldL); set('newLondon', s.newL);
  const paidSel = document.getElementById('backPayPeriod');
  if (paidSel && s.paidIn) _setSelectPeriod(paidSel, +s.paidIn);
  const incTick = /** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'));
  if (incTick) incTick.checked = s.inc === '1';
  _lastAwardYear = year;
  return true;
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
 * PURE per-period back-pay arithmetic — no DOM, no storage. Extracted from calcBackPay so the
 * money maths is unit-testable (paycalc-periods.test.mjs); calcBackPay maps DOM/storage to these
 * numbers and renders. Mirrors calculate()'s hour capping: Saturday hours cap at contracted,
 * bank-holiday hours cap at the remaining normal hours.
 *
 * PRECONDITION: rateDiff/londonDiff are ≥ 0 (calcBackPay zeroes an invalid pair before calling).
 *
 * backPay = contracted basic diff + premium-bucket diffs + peer diff + pro-rated London diff.
 * varPay  = the HPP-accruing portion — premium buckets + London diff only (contracted basic and
 *           peer pay are excluded, mirroring _varPayForPeriod).
 *
 * @param {{ effContr: number, proRateFactor: number, peer?: number, rateDiff: number, londonDiff: number,
 *           hours: { satHrs?: number, bhHrs?: number, bhOtHrs?: number, otHrs?: number,
 *                    rdwHrs?: number, sunHrs?: number, boxHrs?: number } }} i
 * @returns {{ backPay: number, varPay: number }}
 */
export function _accrueBackPayPeriod(i) {
  const { satHrs = 0, bhHrs = 0, bhOtHrs = 0, otHrs = 0, rdwHrs = 0, sunHrs = 0, boxHrs = 0 } = i.hours || {};
  const { satCapped, bhCapped } = capHours({ effContr: i.effContr, satHrs, bhHrs });
  const premium =
    satCapped * i.rateDiff * (RATE_125 - 1) +
    bhCapped  * i.rateDiff * (RATE_125 - 1) +
    bhOtHrs   * i.rateDiff * RATE_125       +
    otHrs     * i.rateDiff * RATE_125       +
    rdwHrs    * i.rateDiff * RATE_125       +
    sunHrs    * i.rateDiff * RATE_150       +
    boxHrs    * i.rateDiff * RATE_300;
  const londonPart = i.londonDiff * i.proRateFactor;
  return {
    backPay: i.effContr * i.rateDiff + premium + (i.peer || 0) * 2 * i.rateDiff + londonPart,
    varPay:  premium + londonPart,
  };
}

/**
 * Reset the per-period breakdown to fully closed. Needed whenever the rows are cleared/replaced
 * while the panel may be open: toggleBpBreakdown drives the panel with an INLINE max-height, which
 * outranks the CSS `.bd-body { max-height:0 }` collapse — without this reset the emptied panel
 * stayed visually expanded, the button needed two taps, and aria-expanded lied to screen readers.
 * @param {HTMLElement} rowsEl @param {HTMLElement} breakdownBtn
 */
function _resetBreakdown(rowsEl, breakdownBtn) {
  rowsEl.classList.remove('open');
  rowsEl.style.maxHeight = '';
  breakdownBtn.classList.remove('open');
  breakdownBtn.setAttribute('aria-expanded', 'false');
  breakdownBtn.style.display = 'none';
}

/**
 * Calculate the back-pay lump sum from the card inputs, render the results,
 * and return the new coordinator BP state.
 * Does NOT mutate coordinator state or call calculate() — caller handles that.
 * @returns {{ bpAmount: number, bpVarAmount: number, bpPNum: number, bpIsEstimate: boolean, bpIncluded: boolean }}
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
  // Derived ONCE and reused (estimate banner, tax-year fence, award-from cap, apply button) —
  // previously the same tax year was re-derived three times in this function.
  const awardTy   = _bpAwardTaxYear(fromPNum);
  const bpSel     = /** @type {HTMLSelectElement} */ (document.getElementById('backPayPeriod'));
  const bpPNum    = bpSel ? +bpSel.value : 0; // "paid in" period — also the cap
  const bpP       = bpPNum ? getPeriods().find(/** @param {any} x */ x => x.num === bpPNum) : null;
  const hasRate   = oldRate   > 0 && newRate   > 0 && newRate   > oldRate;
  const hasLondon = oldLondon > 0 && newLondon > 0 && newLondon > oldLondon;
  // Opt-in tick (OFF by default): the lump is only ADDED to the paid-in payslip's take-home when
  // ticked. The card still computes and shows the lump either way; the coordinator gates the gross.
  const bpIncluded = !!(/** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'))?.checked);

  // Persist the raw inputs per member (autosave, like every other paycalc field) so the lump
  // survives a reload — restored by restoreBpState() at init.
  _saveBpState();

  const labelEl    = document.getElementById('backPayTotalLabel');
  const periodWrap = document.getElementById('backPayPeriodWrap');
  const applyWrap  = document.getElementById('applyRateWrap');
  const applyBtn   = document.getElementById('applyRateBtn');

  // Estimate banner — visible whenever the award's tax-year rates are still unconfirmed
  // (offered, awaiting acceptance). Set before the early return so it shows the moment the
  // card opens, even before any figures are entered.
  const estimateNote = document.getElementById('bpEstimateNote');
  if (estimateNote) estimateNote.style.display = awardTy?.rateUnconfirmed ? 'block' : 'none';

  // Inverted Old/New pair (likely swapped boxes, or a typo) — without this hint the card just
  // shows nothing, with no clue why.
  const orderWarn = document.getElementById('bpOrderWarn');
  if (orderWarn) {
    const rateSwapped   = oldRate   > 0 && newRate   > 0 && newRate   <= oldRate;
    const londonSwapped = oldLondon > 0 && newLondon > 0 && newLondon <= oldLondon;
    orderWarn.style.display = (rateSwapped || londonSwapped) ? 'block' : 'none';
  }

  if (!hasRate && !hasLondon) {
    rowsEl.innerHTML = '';
    _resetBreakdown(rowsEl, breakdownBtn);
    totalEl.style.display      = 'none';
    noticeEl.style.display     = 'none';
    if (periodWrap) periodWrap.style.display = 'none';
    if (applyWrap)  applyWrap.style.display  = 'none';
    return { bpAmount: 0, bpVarAmount: 0, bpPNum: 0, bpIsEstimate: false, bpIncluded };
  }

  const rateDiff   = hasRate   ? newRate   - oldRate   : 0;
  const londonDiff = hasLondon ? newLondon - oldLondon : 0;
  const periods    = getPeriods();
  // Back-pay applies within a single tax-year anniversary — awardTy (derived above from the
  // April "backdated from" period) fences the accrual so a "paid in" period in a subsequent
  // year cannot pull in that later year's periods.
  // The date THIS award was applied/paid (mid-year lump). For a SETTLED award, periods paid on/after
  // it were already paid at the new rate and owe NO arrears — so the accrual must stop there, matching
  // the main calculator's mid-year rate step (getRateForPeriod). null for the pending award (not yet
  // paid) → no such cap, the whole window from April accrues.
  const _awardFrom = awardFromForYear(awardTy?.label);
  let rows          = '';
  let grandTotal    = 0;
  let grandVarTotal = 0;
  let pCount        = 0;

  // Upper cap for accrual = up to but NOT INCLUDING the "paid in" period, AND no later than TODAY.
  // Excluding the paid-in month: in the period the lump sum lands you are already paid at the NEW
  // rate, so that month is current pay, not back pay (confirmed by Gareth Jul 2026). Capping at
  // today's period (todaysPeriodNum — NOT the SELECTED period) stops a future paid-in or a future
  // period the user has merely navigated to from adding contracted rate-diff for weeks not yet worked.
  const _capPNum = Math.min(bpPNum ? bpPNum - 1 : Infinity, todaysPeriodNum());
  periods.forEach(/** @param {any} p */ p => {
    try {
      if (fromPNum && p.num < fromPNum) return;
      if (_capPNum && p.num > _capPNum) return;
      // Skip periods outside the award tax year (e.g. when "paid in" period is
      // in the following year — don't apply 2025/26 rate diff to 2026/27 work).
      if (awardTy && getTaxYearForOffset(p.num - 48) !== awardTy) return;
      // Skip periods already paid at the new rate (a settled award's mid-year application date) — they
      // owe no arrears. Without this the accrual would double-count a historic award viewed at a late period.
      if (_awardFrom && p.payday >= _awardFrom) return;
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
      // All the money arithmetic lives in the PURE _accrueBackPayPeriod (unit-tested) — this loop
      // only maps storage/settings to numbers. Pro-rating uses the exact factor (not the
      // integer-rounded effContr divided back) to avoid rounding error; hour caps mirror calculate().
      const { backPay, varPay } = _accrueBackPayPeriod({
        effContr:      getEffectiveContr(p),
        proRateFactor: getProRateFactor(p),
        peer:          d.peer || 0,
        rateDiff, londonDiff,
        hours: _decodeHours(p, d),
      });

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
    } catch (e) {
      // A corrupted saved period must not abort the whole lump — but dropping its arrears
      // silently would under-state money, so leave a developer trace (no staff-visible error).
      console.warn('[PayCalc] Back-pay skipped period', p.num, e);
    }
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
      // A paid-in payday in the past means the lump has already been paid (a settled award being
      // reviewed) — say so in the past tense; "will appear" for a nine-months-ago payslip reads wrong.
      noticeEl.innerHTML = bpP.payday < new Date()
        ? `ℹ️ This lump sum appeared on your <strong>P${payslipPeriodNum(bpP)} payslip (paid ${payLong})</strong>. It was taxed in full in that period.`
        : `⚠️ This lump sum will appear on your <strong>P${payslipPeriodNum(bpP)} payslip (paid ${payLong})</strong>. It is taxed in full in that period — if it pushes your income over a tax band threshold, you may receive less than the gross figure shown.`;
    } else {
      noticeEl.textContent = '⚠️ This lump sum is taxed in the period it is paid. Select a period above to see a specific warning. If it pushes your income over a tax band threshold that month, you may receive less than the gross figure shown.';
    }

    // "Apply new rate" button — shown once rates are entered. Compares against the stored rate
    // for the AWARD's tax year (awardTy, derived once above), not the rate field (which shows
    // whichever tax year is being viewed). While the award is unconfirmed the figure is an
    // ESTIMATE — the label must say so before it's written into Settings.
    if (applyWrap && applyBtn && hasRate) {
      /** @type {Record<string, any>} */
      let _storedRates = {};
      try { _storedRates = JSON.parse(lsGet(SK.rates) || '{}'); } catch {}
      const alreadyApplied = Math.abs((parseFloat(_storedRates[awardTy.label]) || 0) - newRate) < 0.001;
      const rateWord = awardTy.rateUnconfirmed ? 'estimated rate' : 'new rate';
      applyBtn.textContent = alreadyApplied
        ? `✓ ${rateWord[0].toUpperCase()}${rateWord.slice(1)} already applied — £${newRate.toFixed(2)}/hr (${awardTy.label})`
        : `Apply ${rateWord} to settings — £${newRate.toFixed(2)}/hr (${awardTy.label}) →`;
      /** @type {HTMLButtonElement} */ (applyBtn).disabled = alreadyApplied;
      applyWrap.style.display = 'block';
    } else if (applyWrap) {
      applyWrap.style.display = 'none';
    }

    rowsEl.innerHTML = rows;
    breakdownBtn.style.display = 'flex';
    // If the panel is open, re-fit its inline max-height to the fresh rows (they may be
    // taller/shorter than the content the height was measured against).
    if (rowsEl.classList.contains('open')) rowsEl.style.maxHeight = `${rowsEl.scrollHeight}px`;
  } else {
    totalEl.style.display = 'none';
    if (periodWrap) periodWrap.style.display = 'none';
    if (applyWrap)  applyWrap.style.display  = 'none';
    // Explain the empty state in the (visible) notice element. The old message lived inside the
    // collapsed breakdown panel — max-height:0 with its toggle hidden — so it was never actually
    // visible; and its text ("Enter hours for each period first") was stale anyway, since unvisited
    // periods now accrue contracted arrears. This state means the award window itself is empty
    // (e.g. the paid-in payslip is at/before April, or every window period pre-dates a joiner's start).
    noticeEl.style.display = 'block';
    noticeEl.textContent   = 'ℹ️ Nothing to backdate yet — there are no paid periods between April and the selected payslip.';
    rowsEl.innerHTML = '';
    _resetBreakdown(rowsEl, breakdownBtn);
  }

  const newBpPNum   = (grandTotal > 0 && bpPNum > 0) ? bpPNum : 0;
  const newBpAmt    = newBpPNum > 0 ? grandTotal    : 0;
  const newBpVarAmt = newBpPNum > 0 ? grandVarTotal : 0;
  // bpIsEstimate: the lump derives from an offered-but-unconfirmed award (the 3.6% default) —
  // the result card must say "estimated" wherever it surfaces this figure.
  return { bpAmount: newBpAmt, bpVarAmount: newBpVarAmt, bpPNum: newBpPNum,
           bpIsEstimate: !!awardTy?.rateUnconfirmed, bpIncluded };
}
