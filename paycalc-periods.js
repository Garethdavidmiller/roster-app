// @ts-check
/**
 * paycalc-periods.js — Period arithmetic and select UI for paycalc.html.
 *
 * Owns: CONFIG (period anchor + tax years), getPeriods cache, hasBankHoliday /
 *   hasBoxingDay, CONDITIONAL_ROWS, period select DOM helpers, tax-year tab sync,
 *   period navigation (prev / next / jump).
 * Does NOT own: grade/settings persistence (paycalc-settings.js), calculation
 *   engine (paycalc-app.js), roster hints (paycalc-app.js for now).
 * Edit here for: period date maths, adding a new tax year, period select UI.
 * Do not edit here for: pay maths, grade rates, settings save/load.
 */

import {
  P_YR, TAX_YEARS, getTaxYearForOffset,
} from './paycalc-calc.js';
import { bhsForYear } from './paycalc-roster-suggestions.js';
import { fdLong } from './paycalc-format.js';

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Period arithmetic constants.
// ⚠️  TAX YEAR ROLLOVER: Each April, update ANCHOR_DATE, FIRST_OFFSET, LAST_OFFSET
//     and the threshold tables in paycalc-calc.js.
//     The anchor (13 Feb 2026) stays fixed as the offset reference point (internal num 48).
//
// NB: `num` below is an INTERNAL, monotonic offset id (37…62), NOT the number printed on the
// payslip. The payslip counts weeks-into-the-tax-year (×4 per period, resetting each April):
// April = "Period 4", … 13 Feb 2026 = "Period 48", last = "Period 52". Convert with
// payslipPeriodNum() for any user-facing label; never key storage/maths off the payslip number.
export const CONFIG = {
  ANCHOR_DATE:    new Date(2026, 1, 13, 12, 0, 0), // internal num 48 payday: 13 Feb 2026 (printed "Period 48"), noon local — MUST be noon to preserve the calcProRateFactor half-day invariant
  PERIOD_DAYS:    28,
  PERIODS_PER_YR: P_YR,
  FIRST_OFFSET:   -11,   // internal num 37 — first period of 2025/26 (~11 Apr 2025; printed "Period 4")
  LAST_OFFSET:     14,   // internal num 62 — last period of 2026/27 (payday 12 Mar 2027; printed "Period 52")
  TAX_YEARS,             // imported from paycalc-calc.js
};

// ── PAY PERIODS ───────────────────────────────────────────────────────────────
// Structure of each period:
//   cutoff  = Saturday (last day shifts count; also the hours-submission deadline)
//   start   = Sunday after the previous period's cutoff (first day shifts count)
//   payday  = Friday 6 days after cutoff (the day Chiltern pay into your account)
// Period array is fully determined by CONFIG constants — same result every call.
// Cache once; ~78 Date allocations saved per calculate() (called 6× per keystroke).
/** @type {any} */
let _periodsCache = null;

/** Return the full array of pay periods for the supported date range. Cached. */
export function getPeriods() {
  if (_periodsCache) return _periodsCache;
  const out = [];
  for (let offset = CONFIG.FIRST_OFFSET; offset <= CONFIG.LAST_OFFSET; offset++) {
    const payday = new Date(CONFIG.ANCHOR_DATE);
    payday.setDate(payday.getDate() + offset * CONFIG.PERIOD_DAYS);
    const cutoff = new Date(payday); cutoff.setDate(cutoff.getDate() - 6);
    // start = day after previous cutoff = cutoff - 27 days (not payday - 27)
    const start  = new Date(cutoff); start.setDate(start.getDate() - CONFIG.PERIOD_DAYS + 1);
    out.push({ payday, start, cutoff, num: 48 + offset });
  }
  _periodsCache = out;
  return out;
}

/**
 * The period number as PRINTED ON THE CHILTERN PAYSLIP. The payslip counts the cumulative
 * WEEK within the tax year — each 4-weekly period advances it by 4 — and RESETS every April.
 * So period 1 of a tax year (April) is "Period 4", period 2 is "Period 8", … period 12 is
 * "Period 48" (13 Feb 2026, the anchor), period 13 is "Period 52". Confirmed by Gareth
 * Jul 2026 (April's payslip says Period 4; the anchor 13 Feb 2026 says Period 48).
 *
 * This is DISPLAY-ONLY. The internal `p.num` (37…62, an offset from the P48 anchor) is
 * unchanged — it stays the localStorage key and the monotonic value for tax-year maths.
 * The payslip number can't serve those roles: it resets 52→4 each April, so it is neither
 * unique across years nor monotonic. Never store or key off this value; only show it.
 * @param {{ num: number }} p - A period object from getPeriods().
 * @returns {number} The printed payslip period number (4, 8, … 48, 52).
 */
export function payslipPeriodNum(p) {
  const ty = getTaxYearForOffset(p.num - 48);
  // (p.num - firstNumOfTaxYear + 1) = 1-based period index within the tax year; ×4 = weeks.
  return 4 * (p.num - (48 + ty.first) + 1);
}

// ── MEMBER VISIBILITY CLAMP ────────────────────────────────────────────────────
// A member who only started THIS tax year should not see earlier tax years in the pay
// calculator — "from this year onwards". The clamp is at a tax-year boundary (the first period
// of the member's JOIN tax year), so a year is either fully visible or fully hidden. Set once by
// the coordinator via setEarliestVisiblePeriod(getLoggedMember()) — paycalc-periods.js can't import
// getLoggedMember (that would be a circular import), so the member is passed in.

/** Earliest period num the current member may view; null = not set yet (no clamp). @type {number|null} */
let _earliestVisiblePNum = null;

/**
 * The first period of the member's JOIN tax year — the earliest period they may view. Genuine new
 * starters (a `startDate`, and NOT a full-year `noProRate` secondment return) are clamped to their
 * join year; everyone else sees the whole supported range. Pure — exported for tests.
 * @param {any} member - teamMembers entry (or null).
 * @returns {number} period num (>= the supported range's first period).
 */
export function computeEarliestVisiblePNum(member) {
  const floor = 48 + CONFIG.FIRST_OFFSET;
  const start = member?.startDate;
  if (!start || member?.noProRate) return floor; // no startDate, or full-year return → see everything
  const periods = getPeriods();
  // The tax year the member joined in = the tax year of the first period whose window ends on/after
  // their start date (i.e. the first period they were employed for).
  const joinP  = periods.find((/** @type {any} */ p) => start <= p.cutoff) || periods[periods.length - 1];
  const joinTy = getTaxYearForOffset(joinP.num - 48);
  return Math.max(floor, 48 + joinTy.first);
}

/** Store the current member's earliest visible period. Call once from init before building selects. */
export function setEarliestVisiblePeriod(/** @type {any} */ member) {
  _earliestVisiblePNum = computeEarliestVisiblePNum(member);
}

/** The stored earliest visible period num (the supported range's first period if unset). */
export function getEarliestVisiblePNum() {
  return _earliestVisiblePNum ?? (48 + CONFIG.FIRST_OFFSET);
}

/** getPeriods() filtered to the periods the current member may view. */
export function visiblePeriods() {
  const floor = getEarliestVisiblePNum();
  return getPeriods().filter((/** @type {any} */ p) => p.num >= floor);
}

/** True if any period of the given tax year is visible to the current member. */
export function isTaxYearVisible(/** @type {any} */ ty) {
  return (48 + ty.last) >= getEarliestVisiblePNum();
}

/**
 * The period number for TODAY (the first period whose payday is still in the future — the one
 * currently being earned). Independent of what the user has SELECTED in the period dropdown.
 * Used by the back-pay accrual to cap arrears at today, so selecting a future period can't accrue
 * arrears for weeks not yet worked.
 */
export function todaysPeriodNum() {
  const periods = getPeriods();
  const today = new Date();
  const upcoming = periods.find((/** @type {any} */ p) => p.payday > today);
  return upcoming ? upcoming.num : periods[periods.length - 1].num;
}

/** Return the period number currently shown in the period selector. */
export function currentPeriodNum() {
  return +(/** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'))).value;
}

/** True if 26 Dec falls within this period's shift window. */
export function hasBoxingDay(/** @type {any} */ p) {
  const start  = new Date(p.start.getFullYear(),  p.start.getMonth(),  p.start.getDate());
  const cutoff = new Date(p.cutoff.getFullYear(), p.cutoff.getMonth(), p.cutoff.getDate());
  for (let y = start.getFullYear(); y <= cutoff.getFullYear(); y++) {
    const bd = new Date(y, 11, 26);
    if (bd >= start && bd <= cutoff) return true;
  }
  return false;
}

// ── BANK HOLIDAY DETECTION ────────────────────────────────────────────────────
// bhsForYear is exported from paycalc-roster-suggestions.js — one definition
// shared with the suggestion engine. Boxing Day (26 Dec) excluded; handled
// separately by hasBoxingDay() at 3× rate.

/** True if any bank holiday (excluding Boxing Day) falls within this period. */
export function hasBankHoliday(/** @type {any} */ p) {
  const start  = new Date(p.start.getFullYear(),  p.start.getMonth(),  p.start.getDate());
  const cutoff = new Date(p.cutoff.getFullYear(), p.cutoff.getMonth(), p.cutoff.getDate());
  const years  = new Set([start.getFullYear(), cutoff.getFullYear()]);
  for (const y of years) {
    if (bhsForYear(y).some((/** @type {any} */ bh) => bh >= start && bh <= cutoff)) return true;
  }
  return false;
}

// Rows that are conditionally shown/hidden based on period content.
// Each entry: { condition(p), rows: [id], fields: [id] }
export const CONDITIONAL_ROWS = [
  {
    condition: hasBankHoliday,
    rows:   ['bhRow', 'bhOtRow'],
    fields: ['bhH', 'bhM', 'bhOtH', 'bhOtM'],
  },
];

/** Show/hide the bank-holiday input rows depending on whether the period has a BH. */
export function updateBhRows(/** @type {any} */ p) {
  CONDITIONAL_ROWS.forEach(({ condition, rows, fields }) => {
    const show = condition(p);
    rows.forEach(id => document.getElementById(id)?.classList.toggle('hidden', !show));
    if (!show) fields.forEach(id => { const el = document.getElementById(id); if (el) /** @type {HTMLInputElement} */ (el).value = ''; });
  });
}

// ── PERIOD SELECT ─────────────────────────────────────────────────────────────
// iOS Safari ignores `select.value = x` when options are inside <optgroup> —
// the select stays blank and the change event never fires. Explicitly setting
// the matching option's .selected property works on all platforms.
export function _setSelectPeriod(/** @type {any} */ sel, /** @type {any} */ pNum) {
  for (const o of sel.options) {
    if (+o.value === pNum) { o.selected = true; return; }
  }
}

function _populatePeriodSelect(/** @type {any} */ el, /** @type {any} */ periods, { placeholder, currentPNum } = /** @type {{ placeholder?: string, currentPNum?: number }} */ ({})) {
  if (!el) return;
  el.innerHTML = placeholder ? `<option value="">${placeholder}</option>` : '';
  /** @type {any} */
  let currentGroup = null;
  /** @type {any} */
  let currentTyLabel = null;
  periods.forEach((/** @type {any} */ p) => {
    const ty = getTaxYearForOffset(p.num - 48);
    if (ty.label !== currentTyLabel) {
      currentGroup = document.createElement('optgroup');
      currentGroup.label = `Tax year ${ty.label}`;
      el.appendChild(currentGroup);
      currentTyLabel = ty.label;
    }
    const o = document.createElement('option');
    o.value = p.num;
    const payStr = fdLong(p.payday);
    // Date FIRST — staff remember paydates, not period numbers (owner, Jul 2026); the printed
    // P-number stays as the secondary cross-check against the payslip.
    o.textContent = (currentPNum && p.num === currentPNum ? '● ' : '') + `Paid ${payStr} · P${payslipPeriodNum(p)}`;
    currentGroup.appendChild(o);
  });
}

/**
 * Populate the period selector, navigate to the appropriate default period, and
 * return the current-earning period number (used by the coordinator as the ● anchor).
 *
 * @returns {number} The current earning period number (first upcoming payday).
 *   Caller must invoke `onPeriodChange()` immediately after assigning the return value
 *   so that `_defaultPeriodNum` is set before the first period-change handler runs.
 */
export function buildPeriodSelect() {
  const sel     = document.getElementById('periodSelect');
  const periods = visiblePeriods(); // hide tax years before a new starter's join year
  const today   = new Date();

  // Default to the first period whose payday is still in the future.
  const upcoming = periods.find((/** @type {any} */ p) => p.payday > today);
  let defPNum    = upcoming ? upcoming.num : periods[periods.length - 1].num;

  // URL params let the roster calendar pre-select a specific period.
  const _urlParams = new URLSearchParams(window.location.search);
  const _paydayParam = _urlParams.get('payday');
  const _monthParam  = _urlParams.get('month');
  if (_paydayParam) {
    const [_py, _pm, _pd] = _paydayParam.split('-').map(Number);
    const _matched = periods.find((/** @type {any} */ p) =>
      p.payday.getFullYear() === _py &&
      p.payday.getMonth()    === _pm - 1 &&
      p.payday.getDate()     === _pd
    );
    if (_matched) defPNum = _matched.num;
  } else if (_monthParam) {
    const [_my, _mm] = _monthParam.split('-').map(Number);
    // NOON, matching the period anchors (v16.23): every p.start/p.cutoff is noon-anchored
    // (ANCHOR_DATE invariant). A midnight 15th fell in the 12-hour gap whenever a period STARTS
    // on the 15th (start noon > midnight; prior cutoff Sat 14th noon < midnight) — e.g. Nov 2026
    // (P59 starts Sun 15 Nov) — so the ?month= deep link silently matched no period at all.
    const _mid = new Date(_my, _mm - 1, 15, 12);
    const _matched = periods.find((/** @type {any} */ p) => p.start <= _mid && _mid <= p.cutoff);
    if (_matched) defPNum = _matched.num;
  }

  const _currentPNum = upcoming ? upcoming.num : periods[periods.length - 1].num;
  _populatePeriodSelect(sel, periods, { currentPNum: _currentPNum });

  _setSelectPeriod(sel, defPNum);
  buildBackPayPeriodSelect();
  return _currentPNum; // coordinator stores this as _defaultPeriodNum
}

/**
 * Populate the back-pay "paid in" period selector. With `minPNum`/`maxPNum`, only periods inside
 * that range are offered — the back-pay card passes the award's own tax year (April → last period,
 * v17.86) so the dropdown can neither offer a payslip that predates the award nor leak into the
 * next year (a cross-year selection could survive a year switch). Rebuilding clears the selection;
 * callers re-select/default afterwards.
 * @param {number} [minPNum=0]
 * @param {number} [maxPNum=Infinity]
 */
/**
 * Populate the Year-to-Date "From which payslip?" selector with the tax year's PAID payslips
 * (you can only copy totals from a payslip that exists), newest first — the latest payslip is
 * the overwhelmingly common source. Rebuilding clears the selection; the caller re-applies the
 * stored source afterwards. (v17.98)
 * @param {{ first:number, last:number }} ty - the tax year whose payslips to offer
 */
export function buildYtdSourceSelect(ty) {
  const sel = document.getElementById('ytdSrcSelect');
  if (!sel) return;
  const today = todaysPeriodNum();
  const paid = visiblePeriods()
    .filter((/** @type {any} */ p) => p.num >= 48 + ty.first && p.num <= 48 + ty.last && p.num < today)
    .reverse();
  _populatePeriodSelect(sel, paid, { placeholder: '— which payslip did they come from? —' });
}

export function buildBackPayPeriodSelect(minPNum = 0, maxPNum = Infinity) {
  const sel = document.getElementById('backPayPeriod');
  if (!sel) return;
  // A new starter can only pay a lump into a period they can view (visiblePeriods). The optional
  // maxPNum bounds the list to the award's OWN tax year (v17.86): a backdated award is paid within
  // its own year, and without the upper bound a prior year's paid-in list leaked into the next year,
  // letting a stale cross-year selection (e.g. this year's payslip) survive a switch to a prior award.
  const periods = visiblePeriods().filter((/** @type {any} */ p) => p.num >= minPNum && p.num <= maxPNum);
  _populatePeriodSelect(sel, periods, { placeholder: '— select when the lump sum will land —' });
}

// ── TAX YEAR TABS ─────────────────────────────────────────────────────────────

/** Highlight the active tax-year tab for the currently selected period. */
export function updateTyTabs() {
  const pNum = currentPeriodNum();
  const offset = pNum - 48;
  CONFIG.TAX_YEARS.forEach((ty, i) => {
    const tab = document.getElementById(`tyTab${i}`);
    if (!tab) return;
    const active = offset >= ty.first && offset <= ty.last;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'true');
    else tab.removeAttribute('aria-current');
  });
}

/**
 * Jump the period selector to the first period of the given tax year.
 * @param {number}   tyIndex       Index into CONFIG.TAX_YEARS.
 * @param {Function} onPeriodChange Coordinator callback.
 */
export function jumpToTaxYear(tyIndex, onPeriodChange) {
  const ty      = CONFIG.TAX_YEARS[tyIndex];
  if (!ty) return;
  const periods = getPeriods();
  const first   = periods.find((/** @type {any} */ p) => (p.num - 48) >= ty.first && (p.num - 48) <= ty.last);
  if (!first) return;
  _setSelectPeriod(document.getElementById('periodSelect'), first.num);
  onPeriodChange();
}

/**
 * Navigate to the previous pay period.
 * @param {Function} onPeriodChange Coordinator callback.
 */
export function prevPeriod(onPeriodChange) {
  const sel     = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
  const periods = visiblePeriods(); // clamp: never step before a new starter's join year
  const idx     = periods.findIndex((/** @type {any} */ x) => x.num === +sel.value);
  if (idx > 0) { _setSelectPeriod(sel, periods[idx - 1].num); onPeriodChange(); }
}

/**
 * Navigate to the next pay period.
 * @param {Function} onPeriodChange Coordinator callback.
 */
export function nextPeriod(onPeriodChange) {
  const sel     = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
  const periods = visiblePeriods();
  const idx     = periods.findIndex((/** @type {any} */ x) => x.num === +sel.value);
  if (idx < periods.length - 1) { _setSelectPeriod(sel, periods[idx + 1].num); onPeriodChange(); }
}
