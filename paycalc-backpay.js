// @ts-check
/**
 * paycalc-backpay.js — Back-pay lump sum calculator for paycalc.html.
 *
 * Owns: prefillBackPay, calcBackPay, restoreBpState, _bpAwardTaxYear, the pure story strip
 *   (bpStoryHtml), and the card's state as the take-home reads it (bpState, and the wrappers that
 *   adopt calcBackPay's answer — runCalcBackPay, applyBpRisePct, refreshBackPayCard,
 *   syncBackPayForViewedYear).
 * Does NOT own: the calculation engine (paycalc-app.js), settings (paycalc-settings.js), which
 *   figure goes in which box (paycalc-backpay-state.js), or the award arithmetic itself
 *   (paycalc-backpay-accrual.js — imported from there by everyone, the tests included).
 * Edit here for: back-pay calculation logic, lump sum breakdown rendering.
 * Do not edit here for: pay maths, period navigation, HPP formula.
 *
 * calcBackPay() returns { bpAmount, bpVarAmount, bpPNum, bpIsEstimate, bpIncluded }; the wrappers
 * at the foot compare it with bpState and re-price (onBackPayChange → calculate()) if it changed.
 */

import { parseSmartFloat } from './roster-data.js';
import {
  getTaxYearForOffset, taxYearForPeriod, awardRatesFor, awardFromForYear,
} from './paycalc-calc.js';
import { getPeriods, currentPeriodNum, periodByNum, todaysPeriodNum, payslipPeriodNum, _setSelectPeriod, buildBackPayPeriodSelect, payslipMayBeInHand } from './paycalc-periods.js';
import { paidInPeriodNum, _awardBackdateDate, awardWindowFactor, _accrueBackPayPeriod, awardWindow } from './paycalc-backpay-accrual.js';
import { awardGrade, getEffectiveContr, getProRateFactor, settledRate } from './paycalc-settings.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { bpKey, readSavedPeriod } from './paycalc-migrations.js';
import { _decodeHours } from './paycalc-hpp.js';
import { fd, fdShort, fdLong, fdList, fmt, isDataEmpty } from './paycalc-format.js';
import { numVal } from './paycalc-inputs.js';
import { readBpFields, bpFieldWrites, resolveAuthoritativeRates, allRatesOnRecord, resolvePaidInPeriod, blobFitsGrade } from './paycalc-backpay-state.js';

import { setStatus } from './status-text.js';
/**
 * The pay award OFFERED for a tax year whose award is accepted but not yet on a payslip
 * (`ty.rateUnconfirmed`), as a percentage, KEYED BY THAT YEAR'S LABEL. It pre-fills the back-pay
 * card's "Pay rise %", so such a year opens with a live estimate.
 *
 * Keyed by year (paycalc-2-23), so a paid award's percentage cannot re-arm for whichever year is next
 * flagged. A flagged year with no entry opens with the box blank and estimates nothing: invariant 1.
 *
 * EMPTY while no award is pending. When the NEXT award is announced, flag its tax year and add
 * `'<year>': <announced %>` here (docs/PAYCALC_REFERENCE.md → "When the NEXT award is announced").
 * @type {Readonly<Record<string, number>>}
 */
const PENDING_AWARD_PCT = Object.freeze({});

// The award tax year the card's boxes were last prefilled for. The card follows the VIEWED payslip's
// award year, so crossing a tax-year boundary clears the previous year's figures and tick; a year with
// a saved blob restores via restoreBpState instead.
/** @type {string|null} */
let _lastAwardYear = null;

// The grade the card's rate boxes were last filled or restored under. A box with no figure on record
// for the grade now in force keeps its contents, so a grade change must blank it, or one grade's
// figure is priced against another's (paycalc-2-9; see blobFitsGrade).
/** @type {string|null} */
let _bpGrade = null;

// The award year whose saved card state restoreBpState found UNREADABLE (not merely absent) and
// reset (no-silent-caps; Finding #7). Its notice carries the warning on EVERY render until the member
// changes that year's card (paycalc-2-10) — not one-shot, as the coordinator renders twice in one tick.
/** @type {string|null} */
let _bpCorruptYear = null;

/** Append the reset warning to the card notice while `label`'s state is the one that was reset.
 *  Called on EVERY calcBackPay exit path (manual mode, empty compute, full render). @param {HTMLElement} noticeEl @param {string|undefined} label */
function _surfaceCorruptReset(noticeEl, label) {
  if (!label || _bpCorruptYear !== label) return;
  noticeEl.style.display = 'block';
  noticeEl.innerHTML += `<span class="pay-skip-warn"><span aria-hidden="true">⚠️</span> Your saved back-pay entries couldn't be read and were reset — re-check the figures and the tick above.</span>`;
}

// ── TAX YEAR HELPER ───────────────────────────────────────────────────────────

/**
 * Period number the back-pay award is backdated FROM. Always the April period of the VIEWED
 * payslip's tax year — Chiltern's pay anniversary is always 1 April, so there is no user choice (do
 * not re-add a "backdated from" field). The April period is `48 + ty.first`: the accrual window's
 * lower bound, and the award tax year.
 * @returns {number}
 */
export function _backdatedFromPNum() {
  // The VIEWED period's award: the card follows the payslip on screen, and per-year saved state
  // (bpKey(ty)) keeps each year's blob and tick separate.
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
  const p = fromPNum ? periodByNum(fromPNum) : null;
  // The falsy `fromPNum` fallback is dead in the card flows; kept for the existing contract/test.
  return getTaxYearForOffset((p ? p.num : currentPeriodNum()) - 48);
}

// ── BACK PAY CARD PRE-FILL ────────────────────────────────────────────────────

/**
 * Pre-fill the Back Pay card inputs when it opens (initCardCollapse onToggle).
 * Returns the result of calcBackPay() so coordinator can update its BP state.
 * @returns {{ bpAmount: number, bpVarAmount: number, bpPNum: number, bpIsEstimate: boolean, bpIncluded: boolean }}
 */
export function prefillBackPay() {
  _trackMemberEdits();
  // The VIEWED period's award, with per-year saved state (bpKey(ty)).
  const pNum = currentPeriodNum();
  const curP = periodByNum(pNum);
  const ty   = taxYearForPeriod(curP);
  const oldRateEl   = /** @type {HTMLInputElement} */ (document.getElementById('oldRate'));
  const newRateEl   = /** @type {HTMLInputElement} */ (document.getElementById('newRateInput'));
  const oldLondonEl = /** @type {HTMLInputElement} */ (document.getElementById('oldLondon'));
  const newLondonEl = /** @type {HTMLInputElement} */ (document.getElementById('newLondon'));
  const pctEl0      = /** @type {HTMLInputElement | null} */ (document.getElementById('bpRisePct'));

  // If the award YEAR changed since the boxes were last filled, clear them so this year's rates
  // prefill below (the fills are blank-guarded, so a stale figure would persist under the new label).
  // Within a year it is a no-op, preserving manual corrections.
  if (_lastAwardYear !== ty.label) {
    for (const el of [oldRateEl, newRateEl, oldLondonEl, newLondonEl, pctEl0]) if (el) el.value = '';
    const manualEl = document.getElementById('bpManualAmt');
    if (manualEl) /** @type {HTMLInputElement} */ (manualEl).value = '';
    // Reset the OPT-IN tick too: it is one shared checkbox, so a year with NO saved blob would inherit
    // the previous year's tick — a lump never opted into. A saved tick restores via restoreBpState.
    const _tick = /** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'));
    if (_tick) _tick.checked = false;
    applyBpMode(_defaultBpMode(ty));   // current award → compute; prior award → enter-from-payslip
    _lastAwardYear = ty.label;
  }
  // The amount-source toggle is always available (both years can compute OR enter the figure).
  const modeRow = document.getElementById('bpModeRow');
  if (modeRow) modeRow.style.display = '';

  // Rebuild the paid-in options for THIS award's tax year, preserving a still-valid selection. A
  // selection from another award year falls through to the default below, or a historic lump would
  // land in a live period's take-home.
  const paidSel = /** @type {HTMLSelectElement} */ (document.getElementById('backPayPeriod'));
  if (paidSel) {
    const keep = paidSel.value;
    buildBackPayPeriodSelect(48 + ty.first, 48 + ty.last); // bounded to THIS award's tax year
    if (keep) _setSelectPeriod(paidSel, +keep); // no-op if the kept period isn't in this award's window
  }

  // NB: the "Pay rise %" visibility and the rate-box lock are applied in calcBackPay (after BOTH
  // prefill and restoreBpState), or a restored year would keep the previous year's lock state.

  // OLD rate = the prior year's rate, from AWARD_RATES (payslip-confirmed), never the mutable GRADES
  // default. null = not on record (e.g. CES 2025/26) → the old-rate box stays blank for manual entry.
  const _grade = awardGrade(ty);
  if (!_grade) return calcBackPay();   // no grade with rates in the award's months: it refuses, nothing to fill
  const award = awardRatesFor(_grade, ty.label);
  if (!oldRateEl.value && award && award.pre != null) oldRateEl.value = award.pre.toFixed(2);

  if (ty.rateUnconfirmed) {
    // Accepted-but-unconfirmed award: OLD is the prior year's rate (AWARD_RATES, else the settled rate
    // as a fallback); NEW is not yet known, so it is left for the "Pay rise %" helper or manual entry.
    if (!oldRateEl.value)   oldRateEl.value   = settledRate(_grade, ty).toFixed(2);
    if (!oldLondonEl.value) oldLondonEl.value = ty.londonAllow.toFixed(2);
    // Default the "Pay rise %" to THIS year's offered award, when on record, so the card opens with an
    // estimate (applyBpRisePct derives New from it). Adjustable.
    const pctEl = /** @type {HTMLInputElement | null} */ (document.getElementById('bpRisePct'));
    const offered = PENDING_AWARD_PCT[ty.label];
    if (pctEl && !pctEl.value && offered != null) pctEl.value = String(offered);
  } else {
    // Settled award: the NEW rate is on record too, so a historic award opens fully populated (CEA
    // 2025/26: old £20.06 → new £20.74). No "Pay rise %" default, so applyBpRisePct leaves these alone.
    if (!newRateEl.value && award && award.rate != null) newRateEl.value = award.rate.toFixed(2);
    if (!oldLondonEl.value && ty.londonAllowPre) oldLondonEl.value = ty.londonAllowPre.toFixed(2);
    if (!newLondonEl.value)                      newLondonEl.value = ty.londonAllow.toFixed(2);
  }
  // (The story strip — #bpAwardScope — is written by calcBackPay, which alone knows the £.)
  const _fromDate = awardFromForYear(ty.label);
  // Default the "paid in" period: a SETTLED award defaults to the payslip that actually carried the
  // lump (its award-application date), so that period's estimate matches the real payslip. A pending
  // award defaults to TODAY'S payday (todaysPeriodNum), matching calcBackPay's accrual cap. The
  // paid-in period is itself excluded from the accrual (calcBackPay's _capPNum).
  if (paidSel && !paidSel.value) {
    const _target = _fromDate
      ? (paidInPeriodNum(getPeriods(), _fromDate) ?? pNum)
      : todaysPeriodNum();
    _setSelectPeriod(paidSel, _target);
  }
  _bpGrade = _grade;
  return calcBackPay();
}

// ── PERSISTENCE ───────────────────────────────────────────────────────────────
// The card's figures autosave per member (bpKey(ty) — myb_pc_<slug>_bp_state_<year>) like every other
// paycalc input, so the lump a member set up survives a reload.
//
// …but ONLY ONCE THE MEMBER HAS CHANGED IT (paycalc-2-6): until then the card holds only what the app
// derives on every visit, and saving that meant merely OPENING the page wrote back-pay state — which
// then counted as the member's own data in the transfer card, the "Replace your pay data?" dialog and
// Settings. A year that already has a saved blob keeps being saved (healing and a deliberate clear).

/** Award years whose card the MEMBER has changed in this page view. @type {Set<string>} */
const _bpTouched = new Set();
let _bpTouchWired = false;

/** Note the member changing the card: any input or change inside it, the banner's tick included
 *  (the coordinator proxies that to #bpIncludeTick as a bubbling change). Capture phase, so it runs
 *  before the coordinator's own listener recomputes and saves. Only BUBBLING events count: the app's
 *  own `_setSelectPeriod` announces a paid-in it sets with a non-bubbling `input`, which a capture
 *  listener would otherwise mistake for the member. Wired once, from the coordinator's first call. */
function _trackMemberEdits() {
  if (_bpTouchWired) return;
  const card = document.getElementById('backPayCard');
  if (!card || typeof card.addEventListener !== 'function') return;
  _bpTouchWired = true;
  const mark = (/** @type {Event} */ e) => {
    if (!e.bubbles) return;
    const label = _bpAwardTaxYear(_backdatedFromPNum()).label;
    _bpTouched.add(label);
    if (_bpCorruptYear === label) _bpCorruptYear = null;   // they are re-checking: the warning has done its job
  };
  card.addEventListener('input', mark, true);
  card.addEventListener('change', mark, true);
}

/** Persist the card's raw inputs + the award year they belong to. Called from calcBackPay. */
function _saveBpState() {
  try {
    // Per-tax-year blob, keyed by the VIEWED award year (bpKey(ty)): switching years can't overwrite
    // another year's state.
    const awardTy = _bpAwardTaxYear(_backdatedFromPNum());
    // Nothing of the member's yet, and nothing saved before: nothing to keep (see above).
    if (!_bpTouched.has(awardTy.label) && lsGet(bpKey(awardTy)) == null) return;
    const v = /** @param {string} id */ (id) => /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ?? '';
    // The text fields come from BP_FIELDS (paycalc-backpay-state.js), one list for save, clear and
    // restore (see its header).
    lsSet(bpKey(awardTy), JSON.stringify({
      year: awardTy.label, grade: awardGrade(awardTy), mode: _bpMode(),
      ...readBpFields(v),
      paidIn: v('backPayPeriod'),
      inc:  /** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'))?.checked ? '1' : '',
    }));
  } catch { /* storage unavailable — card still works, just not persisted */ }
}

/**
 * Restore the persisted card figures into the DOM (card may stay closed). Reads the VIEWED award
 * year's own blob (`bpKey(ty)`, one key per tax year), so there is no other year's state to discard.
 * Sets _lastAwardYear so the first card-open doesn't wipe the restored values.
 *
 * Returns true when that year's blob was APPLIED — **even an all-blank one**: blank saved fields
 * mean the member deliberately cleared the card, and that choice must stick. The coordinator
 * treats false ("no saved state for this award year — a first visit, or a year never changed") as
 * the cue to compute the DEFAULT estimate automatically.
 * @returns {boolean} true if this award year's saved state was applied.
 */
export function restoreBpState() {
  _trackMemberEdits();
  // The VIEWED award year's own blob (bpKey(ty)): per-year keys leave no cross-year state to discard.
  const awardTy = _bpAwardTaxYear(_backdatedFromPNum());
  /** @type {any} */ let s;
  try {
    s = JSON.parse(lsGet(bpKey(awardTy)) || 'null');
    // Only an OBJECT is a state this app wrote. A string, number or array came in some other way
    // (a backup made elsewhere) and is read as damage, never as a deliberate all-blank clear.
    if (s !== null && (typeof s !== 'object' || Array.isArray(s))) throw new TypeError('not a saved card state');
  } catch {
    // Corrupt saved card state — self-heal the bad key and flag the YEAR, so every render of its card
    // tells the member their entries were reset (no-silent-caps; Finding #7, paycalc-2-10).
    _bpCorruptYear = awardTy.label;
    lsDel(bpKey(awardTy));
    s = null;
  }
  if (!s) return false;
  // ONE pass over BP_FIELDS that blanks and applies together: a field the blob doesn't carry must end
  // up EMPTY, not keep the previously-viewed year's value (e.g. CES 2025/26's unrecorded old rate
  // inheriting 2026/27's). `bpFieldWrites` returns an entry for EVERY field.
  for (const { id, value } of bpFieldWrites(s)) {
    const _el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
    if (_el) _el.value = value;
  }
  // A blob saved under another grade: its figure in a box this grade has NO record for is that other
  // grade's, so it comes back blank rather than priced (paycalc-2-9). Recorded boxes need nothing —
  // calcBackPay writes the record into them.
  const _grade = awardGrade(awardTy);
  const _auth = resolveAuthoritativeRates(awardTy, _grade ? awardRatesFor(_grade, awardTy.label) : null);
  if (_grade && !blobFitsGrade(s, _grade, _auth)) {
    for (const [id, v] of Object.entries(_auth)) {
      const _el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
      if (v == null && _el) _el.value = '';
    }
  }
  _bpGrade = _grade;
  const paidSel = document.getElementById('backPayPeriod');
  // Rebuild the paid-in list for THIS award's year before applying the saved selection, or
  // _setSelectPeriod would no-op against the previous year's periods.
  if (paidSel) buildBackPayPeriodSelect(48 + awardTy.first, 48 + awardTy.last);
  if (paidSel && s.paidIn) _setSelectPeriod(paidSel, +s.paidIn);
  // Safety net: a decided award hides the selector, so a missing or invalid saved paid-in falls back
  // to the award payslip — otherwise bpPNum is 0 and the lump silently drops to £0 with no way to fix it.
  if (paidSel && !(/** @type {HTMLSelectElement} */ (paidSel)).value) {
    const _from = awardFromForYear(awardTy.label);
    // The ladder is resolvePaidInPeriod: a decided award whose payday falls beyond the period list
    // falls through to today's period, never 0 (the state this safety net exists to prevent).
    const _tgt = resolvePaidInPeriod({
      awardDecided:  !!_from,
      derivedPNum:   _from ? paidInPeriodNum(getPeriods(), _from) : null,
      savedPNum:     null,
      fallbackPNum:  todaysPeriodNum(),
    });
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
 * The plain-English STORY for the top of the back-pay card ("lead with the story, not the
 * controls"): the award's shape (which award, paid from which payslip, backdated to which 1 April)
 * and this member's figure. Rendered into #bpAwardScope by calcBackPay on every recompute.
 *
 * PURE — returns an HTML string. Every input is app-internal (tax-year labels, paydays, computed
 * amounts); no user-entered text passes through, so no escaping is needed.
 *
 * @param {{ label: string, fromDate: Date|null, payday: Date|null, pNum: number, amount: number,
 *           state: 'computed'|'manual'|'manual-empty'|'no-figures'|'needs-rate'|'empty-window'|'joined-after',
 *           now?: Date }} o
 *   state — which sentence-2 to append: 'computed' (rate×hours estimate → "roughly £X"),
 *   'manual' (figure typed from the payslip → exact), 'manual-empty' (prompt for the figure),
 *   'no-figures' (compute mode with no rates yet → award facts only), 'needs-rate' (an hourly rate
 *   is missing, so no figure), 'empty-window' (no periods accrued), 'joined-after' (the member
 *   started after the whole window — the payslip is "the", not "your", and nothing is "yet").
 *   `now` is injectable for tests; defaults to the real clock.
 * @returns {string}
 */
export function bpStoryHtml(o) {
  const apr  = `1 April ${String(o.label).slice(0, 4)}`;
  const past = !!(o.payday && o.payday < (o.now || new Date()));
  const whose = o.state === 'joined-after' ? 'the' : 'your';
  const slip = o.payday ? `${whose} <strong>${fdLong(o.payday)} payslip</strong> (P${o.pNum})` : 'one payslip';
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
  else if (o.state === 'needs-rate')   s2 = ' Fill in both hourly rates below to work yours out.';
  else if (o.state === 'empty-window') s2 = ' Nothing to backdate for you yet.';
  else if (o.state === 'joined-after') s2 = ' You started after the period it covers, so there is nothing to backdate for you.';
  return s1 + s2;   // 'no-figures' → the award facts alone
}

// ── BACK PAY CALCULATOR ───────────────────────────────────────────────────────

/**
 * Reset the per-period breakdown to fully closed whenever the rows are cleared/replaced: the panel's
 * INLINE max-height (toggleBpBreakdown) outranks the CSS collapse, so an emptied panel stayed open
 * with aria-expanded wrong.
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
  // Derived ONCE and reused (estimate banner, tax-year fence, award-from cap).
  const awardTy   = _bpAwardTaxYear(fromPNum);
  // A DECIDED award (payment date on record — awardFromForYear) lands on a KNOWN payslip, so the
  // "which payslip?" selector is hidden and set automatically (owner: "that should be automatic").
  // Only an undecided future award shows the selector.
  const _awardFromDate = awardFromForYear(awardTy?.label);
  const _awardDecided  = !!_awardFromDate;
  const _periodDisplay = _awardDecided ? 'none' : 'block';
  // Compute-mode rate boxes, applied HERE (after both prefill AND restoreBpState). Each box locks ONLY
  // when its figure is ON RECORD (AWARD_RATES / TAX_YEARS) — resolveAuthoritativeRates
  // (paycalc-backpay-state.js) decides — and two properties this loop depends on: the decision never
  // reads the box's CONTENTS (review F1 — locking on non-empty froze a fragment mid-typing), and a
  // locked box is WRITTEN with the recorded figure (review F2 — a stale value behind a padlock reads
  // as confirmed). A box with no recorded figure (CES 2025/26 old rate) stays PERMANENTLY editable.
  // Runs BEFORE the input reads below, so this pass computes with the enforced figures.
  const _grade = awardGrade(awardTy);
  // The award's months worked under a role with no rates (pay-audience.js admits by the role AT THE
  // TIME): no lump — awardRatesFor would hand back CEA's, a guess (invariant 13).
  if (!_grade) {
    rowsEl.innerHTML = '';
    _resetBreakdown(rowsEl, breakdownBtn);
    totalEl.style.display = 'none';
    const _wrap = document.getElementById('backPayPeriodWrap');
    if (_wrap) _wrap.style.display = 'none';
    noticeEl.style.display = 'block';
    setStatus(noticeEl, `ℹ️ No back pay estimate: in the months the ${awardTy?.label ?? ''} award covers, the roster lists you in a grade this calculator has no rates for.`);
    return { bpAmount: 0, bpVarAmount: 0, bpPNum: 0, bpIsEstimate: false, bpIncluded: false };
  }
  const _auth = resolveAuthoritativeRates(awardTy, awardRatesFor(_grade, awardTy?.label ?? ''));
  // The GRADE changed since these boxes were filled: a box the new grade has no record for still
  // holds the old grade's figure (often the record it was locked to a moment ago). Blank it — the
  // member is its only source now (paycalc-2-9). The coordinator's grade listener lands here.
  const _gradeChanged = _bpGrade !== null && _bpGrade !== _grade;
  _bpGrade = _grade;
  for (const [_id, _v] of Object.entries(_auth)) {
    const _el = /** @type {HTMLInputElement|null} */ (document.getElementById(_id));
    if (!_el) continue;
    if (_gradeChanged && _v == null) _el.value = '';
    const _lk = _v != null;
    if (_lk) _el.value = _v.toFixed(2);
    _el.readOnly = _lk;
    _el.classList.toggle('bp-rate-locked', _lk);
  }
  const _pctField = document.getElementById('bpRisePctField');
  if (_pctField) _pctField.style.display = awardTy?.rateUnconfirmed ? '' : 'none';

  // Fully-confirmed award → every box locked: the two Old→New rows collapse into ONE read-only line
  // (owner's screenshot review), and the hero basis shows the period count only, so the rates are
  // stated ONCE. Any figure NOT on record keeps the editable rows.
  const _allLocked = allRatesOnRecord(_auth);
  for (const _fid of ['bpRateField', 'bpLondonField']) {
    const _f = document.getElementById(_fid);
    if (_f) _f.style.display = _allLocked ? 'none' : '';
  }
  const _ratesLine = document.getElementById('bpRatesLine');
  if (_ratesLine) {
    _ratesLine.style.display = _allLocked ? '' : 'none';
    if (_allLocked) _ratesLine.innerHTML =
      `🔒 On record — hourly rate <strong>${fmt(/** @type {number} */ (_auth.oldRate))} → ${fmt(/** @type {number} */ (_auth.newRateInput))}</strong> · ` +
      `London Allowance <strong>${fmt(/** @type {number} */ (_auth.oldLondon))} → ${fmt(/** @type {number} */ (_auth.newLondon))}</strong> per period`;
  }

  const oldRate   = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('oldRate')).value);
  const newRate   = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('newRateInput')).value);
  const oldLondon = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('oldLondon')).value);
  const newLondon = parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById('newLondon')).value);
  const bpSel     = /** @type {HTMLSelectElement} */ (document.getElementById('backPayPeriod'));
  // A DECIDED award's paid-in payslip is deterministic and its selector HIDDEN, so DERIVE it here
  // rather than trust a persisted value — one saved before an award-date MOVE (31 Jul → 28 Aug) stayed
  // pinned to the old payslip with no control to fix it. The single choke point; _saveBpState heals
  // the blob.
  if (bpSel && _awardDecided) {
    // Rule 1 of the ladder (resolvePaidInPeriod) — `savedPNum` is deliberately not passed.
    const _tgt = resolvePaidInPeriod({
      awardDecided: true,
      derivedPNum:  paidInPeriodNum(getPeriods(), awardFromForYear(awardTy.label)),
      savedPNum:    null,
      fallbackPNum: null,
    });
    if (_tgt && +bpSel.value !== _tgt) _setSelectPeriod(bpSel, _tgt);
  }
  const bpPNum    = bpSel ? +bpSel.value : 0; // "paid in" period — also the cap
  const bpP       = bpPNum ? periodByNum(bpPNum) : null;
  const hasRate   = oldRate   > 0 && newRate   > 0 && newRate   > oldRate;
  const hasLondon = oldLondon > 0 && newLondon > 0 && newLondon > oldLondon;
  // Opt-in tick (OFF by default): the lump is only ADDED to the paid-in payslip's take-home when
  // ticked. The card still computes and shows the lump either way; the coordinator gates the gross.
  const bpIncluded = !!(/** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'))?.checked);

  // "Enter the amount from your payslip" needs the paid-in payslip in the member's HAND — from its
  // CUT-OFF (`payslipMayBeInHand`, paycalc-2-3) — or the option is disabled. A restored manual
  // selection for a payslip not yet in hand falls back to compute.
  const _payslipExists = !!(bpP && payslipMayBeInHand(bpP));
  const _manualRadio   = /** @type {HTMLInputElement|null} */ (document.getElementById('bpModeManual'));
  if (_manualRadio) {
    _manualRadio.disabled = !_payslipExists;
    const _opt = _manualRadio.closest('.bp-mode-opt');
    if (_opt) {
      _opt.classList.toggle('bp-mode-opt--disabled', !_payslipExists);
      // The reason is SAID in the row, not a title tooltip (hover-only is wrong on a phone).
      const why = document.getElementById('bpModeManualWhy');
      if (why) why.hidden = _payslipExists;
    }
    if (!_payslipExists && _bpMode() === 'manual') applyBpMode('compute');
  }

  // The story strip — written on EVERY exit path below so it can never show a stale £.
  const _storyEl = /** @type {HTMLElement|null} */ (document.getElementById('bpAwardScope'));
  const _story = /** @param {'computed'|'manual'|'manual-empty'|'no-figures'|'needs-rate'|'empty-window'|'joined-after'} state
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

  // Estimate banner — while the award's rates are unconfirmed; before the early returns, so it shows
  // before any figures are entered.
  const estimateNote = document.getElementById('bpEstimateNote');
  if (estimateNote) estimateNote.style.display = awardTy?.rateUnconfirmed ? 'block' : 'none';

  // Inverted Old/New pair (swapped boxes, or a typo) — otherwise the card shows nothing, with no clue why.
  const orderWarn = document.getElementById('bpOrderWarn');
  if (orderWarn) {
    const rateSwapped   = oldRate   > 0 && newRate   > 0 && newRate   <= oldRate;
    const londonSwapped = oldLondon > 0 && newLondon > 0 && newLondon <= oldLondon;
    orderWarn.style.display = (rateSwapped || londonSwapped) ? 'block' : 'none';
  }

  // ── MANUAL MODE (enter-the-amount-from-your-payslip) ─────────────────────────
  // The default for a PRIOR, already-paid award: the member types the lump printed on their payslip,
  // so no accrual runs. Still uses the paid-in period + opt-in tick.
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
      setStatus(noticeEl, 'ℹ️ Enter the back-pay lump sum from your payslip above.');
      _surfaceCorruptReset(noticeEl, awardTy?.label);
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
      // The story strip + hero already name the payslip — the notice carries only the tax fact.
      noticeEl.innerHTML = bpP.payday < new Date()
        ? 'ℹ️ The lump sum was taxed in full on that payslip.'
        : '⚠️ The lump sum is taxed in full on that payslip — if it pushes your income over a tax band threshold, you may receive less than the gross figure shown.';
    } else {
      setStatus(noticeEl, '⚠️ Select which payslip carried this lump sum above.');
    }
    _surfaceCorruptReset(noticeEl, awardTy?.label);
    const newBpPNum = bpPNum > 0 ? bpPNum : 0;
    return { bpAmount: newBpPNum > 0 ? manualAmt : 0, bpVarAmount: 0, bpPNum: newBpPNum, bpIsEstimate: false, bpIncluded };
  }

  if (!hasRate && !hasLondon) {
    _story('no-figures');
    rowsEl.innerHTML = '';
    _resetBreakdown(rowsEl, breakdownBtn);
    totalEl.style.display      = 'none';
    noticeEl.style.display     = 'none';
    noticeEl.innerHTML         = '';   // or the reset warning below lands after an earlier render's words
    if (periodWrap) periodWrap.style.display = 'none';
    _surfaceCorruptReset(noticeEl, awardTy?.label);
    return { bpAmount: 0, bpVarAmount: 0, bpPNum: 0, bpIsEstimate: false, bpIncluded };
  }

  // An hourly rate is MISSING (CES 2025/26's unrecorded old rate, untyped): the London arrears alone
  // are a sliver (£56.10 there) and must not pose as "Yours is roughly". No total; the card says what
  // it needs (paycalc-2-5; invariant 1). A swapped pair is #bpOrderWarn's.
  if (!(oldRate > 0) || !(newRate > 0)) {
    _story('needs-rate');
    rowsEl.innerHTML = '';
    _resetBreakdown(rowsEl, breakdownBtn);
    totalEl.style.display = 'none';
    if (periodWrap) periodWrap.style.display = 'none';
    noticeEl.style.display = 'block';
    setStatus(noticeEl, 'ℹ️ Fill in both hourly rates above to work out your lump sum — the London Allowance part alone would leave out most of it.');
    _surfaceCorruptReset(noticeEl, awardTy?.label);
    return { bpAmount: 0, bpVarAmount: 0, bpPNum: 0, bpIsEstimate: false, bpIncluded };
  }

  const rateDiff   = hasRate   ? newRate   - oldRate   : 0;
  const londonDiff = hasLondon ? newLondon - oldLondon : 0;
  const periods    = getPeriods();
  // The date THIS award was paid. For a SETTLED award, periods paid on/after it were already at the new
  // rate and owe NO arrears, matching getRateForPeriod's mid-year step. null for a pending award → the
  // whole window from April accrues.
  const _awardFrom = _awardFromDate;
  let rows          = '';
  let grandTotal    = 0;
  let grandVarTotal = 0;
  let pCount        = 0;

  // Upper cap for accrual = up to but NOT INCLUDING the "paid in" period, AND no later than TODAY.
  // Excluding the paid-in month: that month is already paid at the NEW rate, so it is current pay,
  // not back pay (confirmed by Gareth Jul 2026). Capping at today's period (NOT the SELECTED one)
  // stops a future period from adding rate-diff for weeks not yet worked.
  const _capPNum = Math.min(bpPNum ? bpPNum - 1 : Infinity, todaysPeriodNum());
  // 1 April of the award year — the date the rise is backdated TO, and the lower edge of the very
  // first period's accrual. Resolved once: it is the same for every period in the loop.
  const _backdateDate = _awardBackdateDate(awardTy);
  const _skipped = /** @type {string[]} */ ([]);   // periods whose saved data couldn't be read — surfaced, never dropped silently
  // Window payslips with NO saved hours still accrue the contracted rate-diff, but their PREMIUM
  // arrears are missing — so they're NAMED in the notice rather than the total silently optimistic.
  const _basicOnly = /** @type {Date[]} */ ([]);
  // The window's payslips, and those the member was employed for: none of them means they joined
  // after the period the award covers, which is its own state, not "nothing … yet" (paycalc-2-17).
  let _inWindow = 0, _employedInWindow = 0;
  // The window (awardWindow, the one definition): the award tax year's payslips from its first —
  // never a following year's — none paid on or after the award date (they owe no arrears), up to the
  // cap. A cap of 0 means none here, hence `|| Infinity`.
  awardWindow(periods, awardTy, { capNum: _capPNum || Infinity, awardFrom: _awardFrom }).forEach(/** @param {any} p */ p => {
    try {
      _inWindow++;
      if (getProRateFactor(p) > 0) _employedInWindow++;
      const parsed = readSavedPeriod(p.num);
      // Include EVERY period in the window, even one never opened: a contracted week is owed the rise
      // whether worked or on leave (confirmed by Gareth), so an unvisited period accrues the contracted
      // component + London diff only (_decodeHours returns zeros for `{}`).
      if (parsed.error) { _skipped.push(fdShort(p.payday)); console.warn('[PayCalc] Back-pay corrupt period', p.num); return; }
      const d = parsed.data || {};
      // Only NAME an empty period when it is the member's: getProRateFactor is 0 for a period ENTIRELY
      // before a joiner's start (which contributes £0 anyway), so a joiner is never asked to fill
      // payslips from before they joined.
      if ((!parsed.data || isDataEmpty(d)) && getProRateFactor(p) !== 0) _basicOnly.push(p.payday);
      // The money arithmetic is the PURE _accrueBackPayPeriod (unit-tested); this loop only maps
      // storage to numbers. Pro-rating uses the exact factor, not the rounded effContr divided back.
      const { backPay, varPay } = _accrueBackPayPeriod({
        effContr:      getEffectiveContr(p),
        proRateFactor: getProRateFactor(p),
        // Only the FIRST period in the window is ever a fraction: its shift weeks run back into
        // March, and the award is backdated to 1 April (v21.79 — VAL-PAY-001, settled against the
        // real payslip). Every later period returns 1.
        // DELETE THIS LINE AND THE DEFECT RETURNS IN SILENCE: the accrual falls back to its
        // `== null ? 1` default with every unit test still green. Guarded by the rendered £ in
        // e2e/paycalc-backpay.spec.js ("...scales the first period of the award window").
        windowFactor:  awardWindowFactor(p, _backdateDate),
        peer:          d.peer || 0,
        rateDiff, londonDiff,
        hours: _decodeHours(p, d),
      });

      if (backPay > 0) {
        // Accumulate the PENNY-ROUNDED row value, so the displayed rows always sum to the total.
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
      // A corrupted period must not abort the lump, nor be dropped silently: record it (surfaced below).
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
    // When the "On record" line already states the rates (_allLocked), the basis carries the count only.
    if (_allLocked) {
      totalBasEl.textContent = `${pCount} period${pCount > 1 ? 's' : ''} backdated at the rates on record`;
    } else {
      const parts = [];
      if (hasRate)   parts.push(`rate ${fmt(oldRate)} → ${fmt(newRate)}`);
      if (hasLondon) parts.push(`London Allowance ${fmt(oldLondon)} → ${fmt(newLondon)}`);
      totalBasEl.textContent = `${pCount} period${pCount > 1 ? 's' : ''} backdated · ${parts.join(' · ')}`;
    }

    if (periodWrap) periodWrap.style.display = _periodDisplay;

    noticeEl.style.display = 'block';
    if (bpP) {
      // The story strip + hero already name the payslip — the notice carries only the tax fact, in
      // the past tense for a payday already gone.
      noticeEl.innerHTML = bpP.payday < new Date()
        ? 'ℹ️ The lump sum was taxed in full on that payslip.'
        : '⚠️ The lump sum is taxed in full on that payslip — if it pushes your income over a tax band threshold, you may receive less than the gross figure shown.';
    } else {
      setStatus(noticeEl, '⚠️ This lump sum is taxed in the period it is paid. Choose the payslip above to see a specific warning. If it pushes your income over a tax band threshold that month, you may receive less than the gross figure shown.');
    }
    if (_basicOnly.length) {
      // ITS OWN PARAGRAPH: how the lump is TAXED and which payslips are MISSING HOURS (the only
      // actionable sentence on the card) are unrelated facts, so two blocks, action last. The plural
      // agreement is per clause, so a single missing payslip does not read as a list of one.
      const _many = _basicOnly.length > 1;
      noticeEl.innerHTML += `<span class="bp-notice-sep">No hours are saved for ${fdList(_basicOnly)} — ${_many ? 'those payslips were' : 'that payslip was'} counted at the basic-rate arrears only, so any overtime or weekend arrears ${_many ? 'they' : 'it'} carried are missing. Fill ${_many ? 'them' : 'it'} in on the calculator for the full figure.</span>`;
    }

    rowsEl.innerHTML = rows;
    breakdownBtn.style.display = 'flex';
    // If the panel is open, re-fit its inline max-height to the fresh rows.
    if (rowsEl.classList.contains('open')) rowsEl.style.maxHeight = `${rowsEl.scrollHeight}px`;
  } else {
    // A member who started after the whole window owes nothing and is owed nothing: say THAT, and
    // never "your … payslip" or "yet" — they had no such payslip, and nothing is coming.
    const _joinedAfter = _inWindow > 0 && _employedInWindow === 0;
    _story(_joinedAfter ? 'joined-after' : 'empty-window');
    totalEl.style.display = 'none';
    if (periodWrap) periodWrap.style.display = 'none';
    // Explain the empty state in the visible notice element: the award window itself is empty (e.g.
    // the paid-in payslip is at/before April).
    noticeEl.style.display = 'block';
    setStatus(noticeEl, _joinedAfter
      ? 'ℹ️ You started after the period this award covers, so there is nothing to backdate for you.'
      : 'ℹ️ Nothing to backdate yet — there are no paid periods between April and the selected payslip.');
    rowsEl.innerHTML = '';
    _resetBreakdown(rowsEl, breakdownBtn);
  }

  // A corrupt saved period was excluded, so the lump above may be too low — say so (no-silent-caps).
  // noticeEl is already visible in both branches above, so append to it.
  if (_skipped.length) {
    noticeEl.style.display = 'block';
    noticeEl.innerHTML += `<span class="pay-skip-warn"><span aria-hidden="true">⚠️</span> Couldn't read ${_skipped.length} saved payslip${_skipped.length > 1 ? 's' : ''} (${_skipped.join(', ')}), so this total may be too low. Open ${_skipped.length > 1 ? 'those payslips' : 'that payslip'} on the calculator to re-save, then check again.</span>`;
  }

  // Surface a CORRUPT saved-CARD-state reset (Finding #7) until the member changes the card — shared
  // helper, also called on the early-return paths above.
  _surfaceCorruptReset(noticeEl, awardTy?.label);

  const newBpPNum   = (grandTotal > 0 && bpPNum > 0) ? bpPNum : 0;
  const newBpAmt    = newBpPNum > 0 ? grandTotal    : 0;
  const newBpVarAmt = newBpPNum > 0 ? grandVarTotal : 0;
  // bpIsEstimate: the lump derives from an accepted-but-unconfirmed award (its percentage from
  // PENDING_AWARD_PCT, or typed) — the result card must say "estimated" wherever it surfaces this figure.
  return { bpAmount: newBpAmt, bpVarAmount: newBpVarAmt, bpPNum: newBpPNum,
           bpIsEstimate: !!awardTy?.rateUnconfirmed, bpIncluded };
}

// ── THE CARD'S STATE, AS THE TAKE-HOME READS IT ──────────────────────────────────────────────


/** What calculate() prices from this card — set only by `_applyBpState`. bpVarAmount is not tracked:
 *  nothing consumes it since HPP stopped taking back pay, and any change to it moves the amount too. */
const _bp = { amount: 0, pNum: 0, isEstimate: false, included: false, fromPayslip: false };
/** @type {() => void} */ let _onBpChange = () => {};

/** The card's state as the result card reads it (a copy). @returns {typeof _bp} */
export function bpState() { return { ..._bp }; }

/** The coordinator's re-price, run whenever the card's state changes. @param {() => void} fn */
export function onBackPayChange(fn) { _onBpChange = fn; }

/** Adopt what calcBackPay()/prefillBackPay() return, and re-price only if it changed. The amount
 *  source is read off the card's own radio once the card has settled it — calcBackPay can put a manual
 *  pick back to compute — and is part of the state, because a typed lump can equal the worked-out one
 *  to the penny and the banner's note must still follow the switch.
 *  @param {{ bpAmount: any, bpPNum: any, bpIsEstimate?: boolean, bpIncluded?: boolean }} r */
function _applyBpState({ bpAmount, bpPNum, bpIsEstimate = false, bpIncluded = false }) {
  const fromPayslip = !!(/** @type {HTMLInputElement|null} */ (document.getElementById('bpModeManual'))?.checked);
  if (bpPNum !== _bp.pNum || bpIsEstimate !== _bp.isEstimate || bpIncluded !== _bp.included
      || fromPayslip !== _bp.fromPayslip || Math.abs(bpAmount - _bp.amount) > 0.001) {
    Object.assign(_bp, { amount: bpAmount, pNum: bpPNum, isEstimate: bpIsEstimate, included: bpIncluded, fromPayslip });
    _onBpChange();
  }
}

/** Recompute the card from its boxes and adopt the result. */
export function runCalcBackPay() { _applyBpState(calcBackPay()); }

// Last values auto-filled into the New rate/London boxes, so applyBpRisePct can tell a still-auto
// value (safe to refresh) from one the member has hand-corrected (must not clobber).
let _bpAutoNewR = '', _bpAutoNewL = '';
/** "Pay rise %" shortcut: with a percentage entered, fill New rate/London from Old × (1 + %). A
 *  convenience only — the New boxes stay editable, and a blank % keeps them fully manual. Re-runs
 *  whenever the % or either Old figure changes. */
export function applyBpRisePct() {
  const pct = numVal('bpRisePct');
  if (pct > 0) {
    const newREl = /** @type {HTMLInputElement} */ (document.getElementById('newRateInput'));
    const newLEl = /** @type {HTMLInputElement} */ (document.getElementById('newLondon'));
    const newR = raiseByPercent(numVal('oldRate'),   pct);
    const newL = raiseByPercent(numVal('oldLondon'), pct);
    // Only a New box that is blank or still holds our last auto value — never a hand-corrected one.
    if (newR && (newREl.value === '' || newREl.value === _bpAutoNewR)) { newREl.value = newR.toFixed(2); _bpAutoNewR = newREl.value; }
    if (newL && (newLEl.value === '' || newLEl.value === _bpAutoNewL)) { newLEl.value = newL.toFixed(2); _bpAutoNewL = newLEl.value; }
  }
  runCalcBackPay();
}

/** Prefill + recompute the card for the selected award year: on card open, and on a period change
 *  through syncBackPayForViewedYear (so switching tax years re-prefills the rates). */
export function refreshBackPayCard() {
  _applyBpState(prefillBackPay());
  applyBpRisePct();
}

/** Sync the card to the VIEWED award year: restore that year's own saved blob, or — with none —
 *  prefill its default (compute for the current award, enter-from-payslip for a prior one). Runs at
 *  init AND on every period change, so the banner and the take-home follow the payslip on screen;
 *  per-year keys (bpKey(ty)) load each year's state rather than resetting its tick. */
export function syncBackPayForViewedYear() {
  if (!restoreBpState()) { refreshBackPayCard(); return; }
  // Re-seed the "these New values came from the %" markers, so a restored box the member corrected
  // by hand is never re-filled by applyBpRisePct.
  const _rv = /** @param {string} id */ id => /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ?? '';
  const _pct = parseFloat(_rv('bpRisePct'));
  if (_pct > 0) {
    const dR = raiseByPercent(parseFloat(_rv('oldRate'))   || 0, _pct);
    const dL = raiseByPercent(parseFloat(_rv('oldLondon')) || 0, _pct);
    if (dR && _rv('newRateInput') === dR.toFixed(2)) _bpAutoNewR = _rv('newRateInput');
    if (dL && _rv('newLondon')    === dL.toFixed(2)) _bpAutoNewL = _rv('newLondon');
  }
  runCalcBackPay();
}
