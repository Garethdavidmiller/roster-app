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
  getTaxYearForOffset, taxYearForPeriod, awardRatesFor, awardFromForYear, capHours,
} from './paycalc-calc.js';
import { getPeriods, currentPeriodNum, todaysPeriodNum, payslipPeriodNum, _setSelectPeriod, buildBackPayPeriodSelect } from './paycalc-periods.js';
import { getGrade, getEffectiveContr, getProRateFactor, getStoredRateForYear } from './paycalc-settings.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { bpKey, readSavedPeriod } from './paycalc-migrations.js';
import { _decodeHours, isDataEmpty } from './paycalc-hpp.js';
import { fd, fdShort, fdLong, fdList, fmt } from './paycalc-format.js';

/**
 * The currently OFFERED (but not-yet-confirmed) annual pay award, as a percentage. Pre-fills the
 * back-pay card's "Pay rise %" so an UNCONFIRMED award year (`ty.rateUnconfirmed`) opens with a live
 * estimate. DORMANT right now — the 2026/27 award is confirmed (paid on the 28 Aug 2026 payslip; no TAX_YEARS
 * entry carries `rateUnconfirmed`) — and re-arms when the NEXT award year is added with
 * `rateUnconfirmed: true`. Update the % then.
 */
const PENDING_AWARD_PCT = 3.6;

// The award tax year the card's rate/London/%/manual boxes were last prefilled for. The card follows
// the VIEWED payslip's award year (v17.86), so this changes whenever the member navigates across a
// tax-year boundary — the change clears the previous year's figures (and resets the opt-in tick) so
// the new year prefills its own state; a year with a saved blob restores via restoreBpState instead.
/** @type {string|null} */
let _lastAwardYear = null;

// Set when restoreBpState found a CORRUPT saved blob (not merely absent). Surfaced ONCE by the next
// calcBackPay render so the reset isn't silent — the card meanwhile recomputes a correct default
// estimate (no-silent-caps; Finding #7, v16.99). Cleared when shown.
let _bpStateWasCorrupt = false;

/** Append the one-shot corrupt-saved-state warning to the card notice. Called on EVERY calcBackPay
 *  exit path (manual mode, empty compute, full render) — the early returns previously skipped it,
 *  so the flag leaked onto a later, unrelated render (review finding). */
function _surfaceCorruptReset(/** @type {HTMLElement} */ noticeEl) {
  if (!_bpStateWasCorrupt) return;
  _bpStateWasCorrupt = false;
  noticeEl.style.display = 'block';
  noticeEl.innerHTML += `<span class="pay-skip-warn">⚠️ Your saved back-pay entries couldn't be read and were reset — re-check the figures and the tick above.</span>`;
}

// ── PAID-IN PERIOD (pure) ─────────────────────────────────────────────────────

/**
 * The paid-in payslip period for a DECIDED award: the number of the FIRST period whose payday is
 * on/after the award-application date — the payslip that actually carries the backdated lump. PURE
 * (DOM callers pass `getPeriods()` + `awardFromForYear(label)`), so it is unit-testable. Extracted
 * v18.13 after an award-date MOVE (the 3.6% award, 31 Jul → 28 Aug) left a stale saved paid-in
 * pinning the lump to the old payslip — this locks the derivation so a future date move is caught by
 * a test, not by a member noticing the "green box" on the wrong payslip. Returns null for an
 * undecided award (no date) or when no period qualifies.
 * @param {Array<{num:number, payday:Date}>} periods  - ascending by payday, as getPeriods() returns
 * @param {Date|null|undefined} awardFrom
 * @returns {number|null}
 */
export function paidInPeriodNum(periods, awardFrom) {
  if (!awardFrom) return null;
  const p = periods.find(/** @param {any} x */ x => x.payday >= awardFrom);
  return p ? p.num : null;
}

// ── TAX YEAR HELPER ───────────────────────────────────────────────────────────

/**
 * Period number the back-pay award is backdated FROM. Always the April period of the VIEWED
 * payslip's tax year — Chiltern's pay anniversary is always 1 April, so there is no user choice
 * (the old "Pay rise backdated from" selector was removed Jul 2026). The April period is
 * `48 + ty.first`. Used as the accrual window's lower bound and to derive the award tax year.
 * @returns {number}
 */
export function _backdatedFromPNum() {
  // v17.86: derive the award from the VIEWED period (currentPeriodNum) again — the card follows the
  // payslip on screen so each year's back pay is viewable/reconcilable (per-year viewing restored;
  // the v16.91 pinning to todaysPeriodNum is replaced by per-YEAR saved state, so switching years no
  // longer resets the include-tick — bpKey(ty) keeps each year's blob separate).
  const awardTy = getTaxYearForOffset(currentPeriodNum() - 48);
  return 48 + awardTy.first;
}

/** The amount-source mode currently selected in the card ('compute' | 'manual'). */
function _bpMode() {
  const m = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="bpMode"]:checked'));
  return m ? m.value : 'compute';
}

/** Default mode for an award year: the CURRENT award computes an estimate from your hours; a PRIOR
 *  (already-paid) award defaults to entering the actual figure from the payslip (owner: Jul 2026). */
function _defaultBpMode(/** @type {{label:string}} */ ty) {
  const currentAward = getTaxYearForOffset(todaysPeriodNum() - 48);
  return ty.label === currentAward.label ? 'compute' : 'manual';
}

/** Reflect a mode into the DOM: tick the radio and show the matching field group. Exported so the
 *  coordinator can call it when the member flips the toggle. */
export function applyBpMode(mode = '') {
  const m = mode || _bpMode();
  const manual = m === 'manual';
  const radio = /** @type {HTMLInputElement|null} */ (document.getElementById(manual ? 'bpModeManual' : 'bpModeCompute'));
  if (radio) radio.checked = true;
  const cf = document.getElementById('bpComputeFields');
  const mw = document.getElementById('bpManualWrap');
  if (cf) cf.style.display = manual ? 'none' : '';
  if (mw) mw.style.display = manual ? '' : 'none';
  return m;
}

/**
 * Tax year the back-pay award belongs to — derived from the "backdated from" period.
 * Exported for the coordinator and tests.
 * @param {number} fromPNum - Period number the award is backdated from.
 */
export function _bpAwardTaxYear(fromPNum) {
  const p = fromPNum ? getPeriods().find(/** @param {any} x */ x => x.num === fromPNum) : null;
  // The `fromPNum` falsy fallback is dead in the card flows (callers pass _backdatedFromPNum(), never
  // 0); kept as currentPeriodNum for the existing contract/test.
  return getTaxYearForOffset((p ? p.num : currentPeriodNum()) - 48);
}

// ── BACK PAY CARD PRE-FILL ────────────────────────────────────────────────────

/**
 * Pre-fill the Back Pay card inputs when it opens (initCardCollapse onToggle).
 * Returns the result of calcBackPay() so coordinator can update its BP state.
 * @returns {{ bpAmount: number, bpVarAmount: number, bpPNum: number, bpIsEstimate: boolean, bpIncluded: boolean }}
 */
export function prefillBackPay() {
  // The VIEWED period's award (per-year viewing, v17.86): the card follows the payslip on screen,
  // with per-year saved state (bpKey(ty)) keeping each year's figures and tick independent.
  const pNum = currentPeriodNum();
  const curP = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
  const ty   = taxYearForPeriod(curP);
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
    const manualEl = document.getElementById('bpManualAmt');
    if (manualEl) /** @type {HTMLInputElement} */ (manualEl).value = '';
    // Reset the OPT-IN tick too (review finding): the tick is a shared DOM checkbox, so without this
    // a year with NO saved blob inherited the previously-viewed year's tick — a lump the member never
    // opted into joined the new year's paid-in take-home. A year's own saved tick still restores via
    // restoreBpState (which bypasses this prefill path entirely when a blob exists).
    const _tick = /** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'));
    if (_tick) _tick.checked = false;
    applyBpMode(_defaultBpMode(ty));   // current award → compute; prior award → enter-from-payslip
    _lastAwardYear = ty.label;
  }
  // The amount-source toggle is always available (both years can compute OR enter the figure).
  const modeRow = document.getElementById('bpModeRow');
  if (modeRow) modeRow.style.display = '';

  // Rebuild the paid-in options for THIS award's window (its April onward — a payslip that predates
  // the award can't carry its lump), preserving a still-valid selection. A selection from another
  // award year is filtered out and falls through to the default below — without this, a 2026/27
  // paid-in survived a switch to the 2025/26 award and pushed the historic lump into a live
  // period's take-home (the wrong-period injection bug).
  const paidSel = /** @type {HTMLSelectElement} */ (document.getElementById('backPayPeriod'));
  if (paidSel) {
    const keep = paidSel.value;
    buildBackPayPeriodSelect(48 + ty.first, 48 + ty.last); // bounded to THIS award's tax year
    if (keep) _setSelectPeriod(paidSel, +keep); // no-op if the kept period isn't in this award's window
  }

  // NB: the "Pay rise %" field visibility and the rate-box read-only lock are applied in calcBackPay
  // (which runs after BOTH prefill and restoreBpState), not here — otherwise a year switch that
  // restores a saved blob would keep the previous year's lock/visibility state.

  // The award year is TODAY's award (pinned above), so the card always computes the current award
  // regardless of the period being viewed. Its OLD rate = the rate paid before that year's award =
  // the prior year's rate — held per grade/year in AWARD_RATES (payslip-confirmed), so it never
  // depends on the mutable GRADES default. null = not on record (e.g. CES 2024/25) → the old-rate box
  // stays blank for manual entry.
  const award = awardRatesFor(getGrade(), ty.label);
  if (!oldRateEl.value && award && award.pre != null) oldRateEl.value = award.pre.toFixed(2);

  if (ty.rateUnconfirmed) {
    // Accepted-but-unconfirmed award (e.g. the 2026/27 rise accepted by the RMT, awaiting payment): the OLD rate
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
  // (The story strip at the top of the card — #bpAwardScope — is written by calcBackPay, not here:
  // it includes the computed £, which only calcBackPay knows, and every prefill path ends in
  // calcBackPay(). v18.39.)
  const _fromDate = awardFromForYear(ty.label);
  // The award is always backdated to 1 April (Chiltern's pay anniversary) — computed
  // internally by _backdatedFromPNum(); there is no "backdated from" selector to pre-set.
  // Default the "paid in" period: a SETTLED award defaults to the payslip that actually carried
  // the lump (the award-application date — 2025/26: 24 Oct 2025), so the lump lands where it
  // really landed and that period's estimate matches the real payslip. A pending award defaults to
  // TODAY'S payday (todaysPeriodNum) — the "next payday" the design intends, matching calcBackPay's
  // todaysPeriodNum() accrual cap (v16.83 review fix). Adjustable either way; the paid-in period is
  // itself excluded from the accrual (see calcBackPay's _capPNum).
  if (paidSel && !paidSel.value) {
    const _target = _fromDate
      ? (paidInPeriodNum(getPeriods(), _fromDate) ?? pNum)
      : todaysPeriodNum();
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
    // Per-tax-year blob (v17.86): keyed by the VIEWED award year (bpKey(ty)), so each year's rates,
    // mode, manual amount, paid-in and include-tick persist independently — switching years can't
    // overwrite another year's state. This is what lets the card safely follow the viewed payslip
    // again (the reason v16.91 had to pin it to one award).
    const awardTy = _bpAwardTaxYear(_backdatedFromPNum());
    const v = /** @param {string} id */ (id) => /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ?? '';
    lsSet(bpKey(awardTy), JSON.stringify({
      year: awardTy.label, mode: _bpMode(), manual: v('bpManualAmt'),
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
  // Restore the VIEWED award year's own blob (bpKey(ty)). Per-year keys mean there is no cross-year
  // contamination to guard against — the old s.year mismatch discard is gone (each year has its own
  // key). Returns true when a blob was applied — even an all-blank one (a deliberate clear must stick).
  const awardTy = _bpAwardTaxYear(_backdatedFromPNum());
  let s = null;
  try {
    s = JSON.parse(lsGet(bpKey(awardTy)) || 'null');
  } catch {
    // Corrupt saved card state — self-heal the bad key and flag it so the next calcBackPay render
    // tells the member their entries were reset (no-silent-caps; Finding #7).
    _bpStateWasCorrupt = true;
    lsDel(bpKey(awardTy));
  }
  if (!s) return false;
  const set = /** @param {string} id @param {any} val */ (id, val) => {
    const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
    if (el && val != null) el.value = String(val);
  };
  // Clean slate FIRST (review finding): a field the blob doesn't carry must end up EMPTY, not keep
  // the previously-viewed year's value — without this, a year switch left the old year's figures in
  // any box the new year's blob (or the calcBackPay enforcement) doesn't overwrite, e.g. the
  // no-recorded-figure CES 2025/26 old-rate box silently inheriting the 2026/27 rate.
  for (const _id of ['bpRisePct', 'oldRate', 'newRateInput', 'oldLondon', 'newLondon', 'bpManualAmt']) {
    const _el = /** @type {HTMLInputElement|null} */ (document.getElementById(_id));
    if (_el) _el.value = '';
  }
  set('bpRisePct', s.pct); set('oldRate', s.oldR); set('newRateInput', s.newR);
  set('oldLondon', s.oldL); set('newLondon', s.newL); set('bpManualAmt', s.manual);
  const paidSel = document.getElementById('backPayPeriod');
  // Rebuild the paid-in list for THIS award's year before applying the saved selection — the select
  // otherwise still holds the previously-viewed year's periods, so _setSelectPeriod would no-op and
  // the paid-in would stick on the wrong year (v17.86 per-year switch).
  if (paidSel) buildBackPayPeriodSelect(48 + awardTy.first, 48 + awardTy.last);
  if (paidSel && s.paidIn) _setSelectPeriod(paidSel, +s.paidIn);
  // Safety net (review finding): a decided award hides the selector, so if the saved paid-in is
  // missing or no longer valid for this year's window, fall back to the award payslip — otherwise
  // bpPNum would be 0 and the lump would silently drop to £0 with no way to fix it.
  if (paidSel && !(/** @type {HTMLSelectElement} */ (paidSel)).value) {
    const _from = awardFromForYear(awardTy.label);
    const _tgt  = _from ? (paidInPeriodNum(getPeriods(), _from) ?? 0) : todaysPeriodNum();
    if (_tgt) _setSelectPeriod(paidSel, _tgt);
  }
  const incTick = /** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'));
  if (incTick) incTick.checked = s.inc === '1';
  applyBpMode(s.mode || _defaultBpMode(awardTy));
  _lastAwardYear = awardTy.label;
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

/**
 * The plain-English STORY for the top of the back-pay card (v18.39 — "lead with the story, not the
 * controls"): one or two sentences stating the award's shape (which award, paid from which payslip,
 * backdated to which 1 April) and this member's figure. Rendered into #bpAwardScope by calcBackPay
 * on every recompute, so the £ tracks the inputs live; the rate boxes/toggles below become the
 * mechanics, not the message.
 *
 * PURE — returns an HTML string. Every input is app-internal (tax-year labels, paydays, computed
 * amounts); no user-entered text passes through, so no escaping is needed.
 *
 * @param {{ label: string, fromDate: Date|null, payday: Date|null, pNum: number, amount: number,
 *           state: 'computed'|'manual'|'manual-empty'|'no-figures'|'empty-window',
 *           now?: Date }} o
 *   state — which sentence-2 to append: 'computed' (rate×hours estimate → "roughly £X"),
 *   'manual' (figure typed from the payslip → exact), 'manual-empty' (prompt for the figure),
 *   'no-figures' (compute mode with no rates yet → award facts only), 'empty-window' (no periods
 *   accrued). `now` is injectable for tests; defaults to the real clock.
 * @returns {string}
 */
export function bpStoryHtml(o) {
  const apr  = `1 April ${String(o.label).slice(0, 4)}`;
  const past = !!(o.payday && o.payday < (o.now || new Date()));
  const slip = o.payday ? `your <strong>${fdLong(o.payday)} payslip</strong> (P${o.pNum})` : 'one payslip';
  let s1;
  if (o.fromDate) {
    s1 = past
      ? `The <strong>${o.label} pay award</strong> was paid from ${slip} but backdated to <strong>${apr}</strong> — everything owed in between arrived as one lump sum on that payslip.`
      : `The <strong>${o.label} pay award</strong> is paid from ${slip} but backdated to <strong>${apr}</strong> — everything owed in between arrives as one lump sum on that payslip.`;
  } else {
    s1 = `The <strong>${o.label} pay award</strong> hasn't been paid yet — when it lands, it's backdated to <strong>${apr}</strong> and everything owed arrives as one lump sum.`;
  }
  let s2 = '';
  if (o.state === 'computed')          s2 = ` Yours is roughly <span class="bp-story-amt">${fmt(o.amount)}</span>.`;
  else if (o.state === 'manual')       s2 = past
    ? ` Yours was <span class="bp-story-amt">${fmt(o.amount)}</span>, from your payslip.`
    : ` You've entered <span class="bp-story-amt">${fmt(o.amount)}</span> as your figure.`;
  else if (o.state === 'manual-empty') s2 = ' Enter your figure from that payslip below.';
  else if (o.state === 'empty-window') s2 = ' Nothing to backdate for you yet.';
  return s1 + s2;   // 'no-figures' → the award facts alone
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
    // backPay = the whole lump (basic + premium + peer + London arrears are all owed).
    // varPay = the HPP-ACCRUING portion only — premiums, NOT London (London doesn't accrue HPP;
    // see paycalc-hpp.js _varPayForPeriod). Currently unused (v16.89 stopped feeding it into HPP),
    // but kept correct so a future re-wire can't reintroduce the London-in-HPP bug.
    backPay: i.effContr * i.rateDiff + premium + (i.peer || 0) * 2 * i.rateDiff + londonPart,
    varPay:  premium,
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
  const rowsEl       = /** @type {HTMLElement} */ (document.getElementById('backPayRows'));
  const totalEl      = /** @type {HTMLElement} */ (document.getElementById('backPayTotal'));
  const totalAmtEl   = /** @type {HTMLElement} */ (document.getElementById('backPayTotalAmt'));
  const totalBasEl   = /** @type {HTMLElement} */ (document.getElementById('backPayTotalBasis'));
  const noticeEl     = /** @type {HTMLElement} */ (document.getElementById('backPayNotice'));
  const breakdownBtn = /** @type {HTMLElement} */ (document.getElementById('bpBreakdownBtn'));

  const fromPNum  = _backdatedFromPNum();
  // Derived ONCE and reused (estimate banner, tax-year fence, award-from cap) —
  // previously the same tax year was re-derived three times in this function.
  const awardTy   = _bpAwardTaxYear(fromPNum);
  // A DECIDED award (its payment date is on record — awardFromForYear) lands on a KNOWN payslip, so
  // the "which payslip?" selector is hidden and set automatically (v17.87 — owner: "that should be
  // automatic"). The notice below still names the payslip. Only an undecided future award shows the
  // selector. `_periodDisplay` = 'block' when the selector should show, else 'none'.
  const _awardFromDate = awardFromForYear(awardTy?.label);
  const _awardDecided  = !!_awardFromDate;
  const _periodDisplay = _awardDecided ? 'none' : 'block';
  // Compute-mode rate boxes, applied HERE (runs after both prefill AND restoreBpState, so a year
  // switch can't leave the previous year's state). For a SETTLED award each box locks ONLY when its
  // authoritative figure is ON RECORD (AWARD_RATES / TAX_YEARS) — and locking also WRITES that figure
  // into the box, so a stale restored/typed value can never be frozen in (review F2). A box with no
  // recorded figure (e.g. the CES 2025/26 old rate) stays PERMANENTLY editable — the lock decision
  // never looks at the box's contents, so typing into it can't trigger a mid-typing lock (review F1:
  // the earlier value!=='' test locked the box on the first keystroke's recompute and persisted the
  // fragment). Runs BEFORE the input reads below so this pass computes with the enforced figures.
  const _settled = !awardTy?.rateUnconfirmed;
  const _award   = awardRatesFor(getGrade(), awardTy?.label ?? '');
  /** @type {Record<string, number|null>} */
  const _auth = {
    oldRate:      _settled && _award && _award.pre  != null ? _award.pre  : null,
    newRateInput: _settled && _award && _award.rate != null ? _award.rate : null,
    oldLondon:    _settled && awardTy?.londonAllowPre != null ? awardTy.londonAllowPre : null,
    newLondon:    _settled && awardTy?.londonAllow    != null ? awardTy.londonAllow    : null,
  };
  for (const [_id, _v] of Object.entries(_auth)) {
    const _el = /** @type {HTMLInputElement|null} */ (document.getElementById(_id));
    if (!_el) continue;
    const _lk = _v != null;
    if (_lk) _el.value = _v.toFixed(2);
    _el.readOnly = _lk;
    _el.classList.toggle('bp-rate-locked', _lk);
  }
  const _pctField = document.getElementById('bpRisePctField');
  if (_pctField) _pctField.style.display = awardTy?.rateUnconfirmed ? '' : 'none';

  const oldRate   = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('oldRate')).value);
  const newRate   = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('newRateInput')).value);
  const oldLondon = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('oldLondon')).value);
  const newLondon = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('newLondon')).value);
  const bpSel     = /** @type {HTMLSelectElement} */ (document.getElementById('backPayPeriod'));
  // A DECIDED award's paid-in payslip is deterministic (the award-application payslip) and its
  // selector is HIDDEN, so DERIVE it here rather than trust a persisted value. Without this, a
  // paid-in saved before an award-date MOVE (the 3.6% award deferred 31 Jul → 28 Aug) stays pinned to
  // the old payslip — the include banner ("green box") shows on the wrong, now-invisible payslip with
  // no control to fix it. restoreBpState restores that stale value, so overriding it here is the
  // single choke point; _saveBpState (below) then heals the persisted blob. (v18.12)
  if (bpSel && _awardDecided) {
    const _tgt = paidInPeriodNum(getPeriods(), awardFromForYear(awardTy.label)) ?? 0;
    if (_tgt && +bpSel.value !== _tgt) _setSelectPeriod(bpSel, _tgt);
  }
  const bpPNum    = bpSel ? +bpSel.value : 0; // "paid in" period — also the cap
  const bpP       = bpPNum ? getPeriods().find(/** @param {any} x */ x => x.num === bpPNum) : null;
  const hasRate   = oldRate   > 0 && newRate   > 0 && newRate   > oldRate;
  const hasLondon = oldLondon > 0 && newLondon > 0 && newLondon > oldLondon;
  // Opt-in tick (OFF by default): the lump is only ADDED to the paid-in payslip's take-home when
  // ticked. The card still computes and shows the lump either way; the coordinator gates the gross.
  const bpIncluded = !!(/** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'))?.checked);

  // The story strip at the top of the card — award shape + this member's figure, ahead of the
  // controls (v18.39). Written on EVERY exit path below so it can never show a stale £.
  const _storyEl = /** @type {HTMLElement|null} */ (document.getElementById('bpAwardScope'));
  const _story = /** @param {'computed'|'manual'|'manual-empty'|'no-figures'|'empty-window'} state
                     @param {number} [amount] */ (state, amount = 0) => {
    if (_storyEl) _storyEl.innerHTML = bpStoryHtml({
      label: awardTy?.label || '', fromDate: _awardFromDate, payday: bpP?.payday || null,
      pNum: bpP ? payslipPeriodNum(bpP) : 0, amount, state,
    });
  };

  // Persist the raw inputs per member (autosave, like every other paycalc field) so the lump
  // survives a reload — restored by restoreBpState() at init.
  _saveBpState();

  const labelEl    = document.getElementById('backPayTotalLabel');
  const periodWrap = document.getElementById('backPayPeriodWrap');

  // Estimate banner — visible whenever the award's tax-year rates are still unconfirmed (accepted
  // by the RMT but not yet confirmed on payslips). Set before the early return so it shows the moment the
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

  // ── MANUAL MODE (enter-the-amount-from-your-payslip) ─────────────────────────
  // The default for a PRIOR, already-paid award: the member types the actual lump printed on their
  // payslip, so no rate×hours accrual runs (and it needs none of that year's old hours). Still uses
  // the paid-in period + opt-in tick, so it lands on the right payslip's take-home when ticked.
  if (_bpMode() === 'manual') {
    if (estimateNote) estimateNote.style.display = 'none';
    if (orderWarn)    orderWarn.style.display    = 'none';
    rowsEl.innerHTML = '';   // compute-mode breakdown rows must not linger in the DOM
    _resetBreakdown(rowsEl, breakdownBtn);
    const manualAmt = parseSmartFloat(/** @type {HTMLInputElement|null} */ (document.getElementById('bpManualAmt'))?.value || '');
    if (!(manualAmt > 0)) {
      _story('manual-empty');
      totalEl.style.display  = 'none';
      if (periodWrap) periodWrap.style.display = 'none';
      noticeEl.style.display = 'block';
      noticeEl.textContent   = 'ℹ️ Enter the back-pay lump sum from your payslip above.';
      _surfaceCorruptReset(noticeEl);
      return { bpAmount: 0, bpVarAmount: 0, bpPNum: 0, bpIsEstimate: false, bpIncluded };
    }
    _story('manual', manualAmt);
    totalEl.style.display  = 'block';
    totalAmtEl.textContent = fmt(manualAmt);
    if (labelEl) labelEl.textContent = bpP ? `💷 Lump sum · Paid ${fdShort(bpP.payday)}` : '💷 Lump sum on one payslip';
    totalBasEl.textContent = `Entered from your ${awardTy.label} payslip`;
    if (periodWrap) periodWrap.style.display = _periodDisplay;
    noticeEl.style.display = 'block';
    if (bpP) {
      const payLong = fdLong(bpP.payday);
      noticeEl.innerHTML = bpP.payday < new Date()
        ? `ℹ️ This lump sum appeared on your <strong>${payLong} payslip</strong> (P${payslipPeriodNum(bpP)}). It was taxed in full in that period.`
        : `⚠️ This lump sum will appear on your <strong>${payLong} payslip</strong> (P${payslipPeriodNum(bpP)}). It is taxed in full in that period.`;
    } else {
      noticeEl.textContent = '⚠️ Select which payslip carried this lump sum above.';
    }
    _surfaceCorruptReset(noticeEl);
    const newBpPNum = bpPNum > 0 ? bpPNum : 0;
    return { bpAmount: newBpPNum > 0 ? manualAmt : 0, bpVarAmount: 0, bpPNum: newBpPNum, bpIsEstimate: false, bpIncluded };
  }

  if (!hasRate && !hasLondon) {
    _story('no-figures');
    rowsEl.innerHTML = '';
    _resetBreakdown(rowsEl, breakdownBtn);
    totalEl.style.display      = 'none';
    noticeEl.style.display     = 'none';
    if (periodWrap) periodWrap.style.display = 'none';
    _surfaceCorruptReset(noticeEl);
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
  const _awardFrom = _awardFromDate;
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
  const _skipped = /** @type {string[]} */ ([]);   // periods whose saved data couldn't be read — surfaced, never dropped silently
  // Window payslips with NO saved hours (v18.42 — review item 2): they still accrue the contracted
  // rate-diff (a normal week is owed the rise regardless), but any PREMIUM arrears they carried are
  // missing — so they're NAMED in the notice instead of the count being silently optimistic.
  const _basicOnly = /** @type {Date[]} */ ([]);
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
      const parsed = readSavedPeriod(p.num);
      // Include EVERY period in the award window — even one never opened in the app. A normal
      // contracted week is owed the rise whether worked or paid at contracted rate on leave/sick
      // (confirmed by Gareth), so an unvisited period defaults to empty data → contracted-only
      // (no variable). _decodeHours returns zeros for `{}`, so ratePay reduces to exactly the
      // contracted component + London diff. GUARDED by fromPNum: with no "backdated from" period
      // selected there is no award window, so an unvisited period has nothing to accrue and is
      // skipped — otherwise contracted arrears would be summed across unbounded history.
      if (parsed.error) { _skipped.push(fdShort(p.payday)); console.warn('[PayCalc] Back-pay corrupt period', p.num); return; }
      if (!parsed.data && !fromPNum) return;
      const d = parsed.data || {};
      if (!parsed.data || isDataEmpty(d)) _basicOnly.push(p.payday);
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
          <span class="bp-lbl">${fd(p.payday)} · P${payslipPeriodNum(p)}</span>
          <span class="bp-val">${fmt(bpRow)}</span>
        </div>`;
      }
    } catch (e) {
      // A corrupted saved period must not abort the whole lump — but dropping its arrears
      // silently would under-state money, so record it (surfaced below) as well as tracing it.
      _skipped.push(fdShort(p.payday));
      console.warn('[PayCalc] Back-pay skipped period', p.num, e);
    }
  });

  if (grandTotal > 0) {
    _story('computed', grandTotal);
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

    if (periodWrap) periodWrap.style.display = _periodDisplay;

    noticeEl.style.display = 'block';
    if (bpP) {
      const payLong = fdLong(bpP.payday);
      // A paid-in payday in the past means the lump has already been paid (a settled award being
      // reviewed) — say so in the past tense; "will appear" for a nine-months-ago payslip reads wrong.
      noticeEl.innerHTML = bpP.payday < new Date()
        ? `ℹ️ This lump sum appeared on your <strong>${payLong} payslip</strong> (P${payslipPeriodNum(bpP)}). It was taxed in full in that period.`
        : `⚠️ This lump sum will appear on your <strong>P${payslipPeriodNum(bpP)} payslip (paid ${payLong})</strong>. It is taxed in full in that period — if it pushes your income over a tax band threshold, you may receive less than the gross figure shown.`;
    } else {
      noticeEl.textContent = '⚠️ This lump sum is taxed in the period it is paid. Select a period above to see a specific warning. If it pushes your income over a tax band threshold that month, you may receive less than the gross figure shown.';
    }
    if (_basicOnly.length) {
      noticeEl.innerHTML += ` No hours are saved for ${fdList(_basicOnly)} — ${_basicOnly.length > 1 ? 'those payslips were' : 'that payslip was'} counted at the basic-rate arrears only, so any overtime or weekend arrears ${_basicOnly.length > 1 ? 'they' : 'it'} carried are missing. Fill ${_basicOnly.length > 1 ? 'them' : 'it'} in on the calculator for the full figure.`;
    }

    rowsEl.innerHTML = rows;
    breakdownBtn.style.display = 'flex';
    // If the panel is open, re-fit its inline max-height to the fresh rows (they may be
    // taller/shorter than the content the height was measured against).
    if (rowsEl.classList.contains('open')) rowsEl.style.maxHeight = `${rowsEl.scrollHeight}px`;
  } else {
    _story('empty-window');
    totalEl.style.display = 'none';
    if (periodWrap) periodWrap.style.display = 'none';
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

  // A corrupt saved period was excluded, so the lump above may be too low — say so rather than
  // quietly under-stating money (the app's no-silent-caps principle). Only trips on malformed
  // localStorage (old migration, manual import, storage damage); noticeEl is already visible in
  // both branches above, so append to it.
  if (_skipped.length) {
    noticeEl.style.display = 'block';
    noticeEl.innerHTML += `<span class="pay-skip-warn">⚠️ Couldn't read ${_skipped.length} saved payslip${_skipped.length > 1 ? 's' : ''} (${_skipped.join(', ')}), so this total may be too low. Open ${_skipped.length > 1 ? 'those payslips' : 'that payslip'} on the calculator to re-save, then check again.</span>`;
  }

  // Surface a CORRUPT saved-CARD-state reset once (Finding #7) — shared helper, also called on the
  // early-return paths above.
  _surfaceCorruptReset(noticeEl);

  const newBpPNum   = (grandTotal > 0 && bpPNum > 0) ? bpPNum : 0;
  const newBpAmt    = newBpPNum > 0 ? grandTotal    : 0;
  const newBpVarAmt = newBpPNum > 0 ? grandVarTotal : 0;
  // bpIsEstimate: the lump derives from an accepted-but-unconfirmed award (the 3.6% default) —
  // the result card must say "estimated" wherever it surfaces this figure.
  return { bpAmount: newBpAmt, bpVarAmount: newBpVarAmt, bpPNum: newBpPNum,
           bpIsEstimate: !!awardTy?.rateUnconfirmed, bpIncluded };
}
