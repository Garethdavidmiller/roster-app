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

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Period arithmetic constants.
// ⚠️  TAX YEAR ROLLOVER: Each April, update ANCHOR_DATE, FIRST_OFFSET, LAST_OFFSET
//     and the threshold tables in paycalc-calc.js.
//     P48 anchor (13 Feb 2026) stays fixed as the offset reference point.
export const CONFIG = {
  ANCHOR_DATE:    new Date(2026, 1, 13, 12, 0, 0), // P48 payday: 13 Feb 2026, noon local — MUST be noon to preserve the calcProRateFactor half-day invariant
  PERIOD_DAYS:    28,
  PERIODS_PER_YR: P_YR,
  FIRST_OFFSET:   -11,   // P37 — first period of 2025/26 (~11 Apr 2025)
  LAST_OFFSET:     14,   // P62 — last period of 2026/27 (~11 Mar 2027)
  TAX_YEARS,             // imported from paycalc-calc.js
};

// ── PAY PERIODS ───────────────────────────────────────────────────────────────
// Structure of each period:
//   cutoff  = Saturday (last day shifts count; also the hours-submission deadline)
//   start   = Sunday after the previous period's cutoff (first day shifts count)
//   payday  = Friday 6 days after cutoff (the day Chiltern pay into your account)
// Period array is fully determined by CONFIG constants — same result every call.
// Cache once; ~78 Date allocations saved per calculate() (called 6× per keystroke).
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

/** Return the period number currently shown in the period selector. */
export function currentPeriodNum() {
  return +document.getElementById('periodSelect').value;
}

/** True if 26 Dec falls within this period's shift window. */
export function hasBoxingDay(p) {
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
export function hasBankHoliday(p) {
  const start  = new Date(p.start.getFullYear(),  p.start.getMonth(),  p.start.getDate());
  const cutoff = new Date(p.cutoff.getFullYear(), p.cutoff.getMonth(), p.cutoff.getDate());
  const years  = new Set([start.getFullYear(), cutoff.getFullYear()]);
  for (const y of years) {
    if (bhsForYear(y).some(bh => bh >= start && bh <= cutoff)) return true;
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
export function updateBhRows(p) {
  CONDITIONAL_ROWS.forEach(({ condition, rows, fields }) => {
    const show = condition(p);
    rows.forEach(id => document.getElementById(id)?.classList.toggle('hidden', !show));
    if (!show) fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  });
}

// ── PERIOD SELECT ─────────────────────────────────────────────────────────────
// iOS Safari ignores `select.value = x` when options are inside <optgroup> —
// the select stays blank and the change event never fires. Explicitly setting
// the matching option's .selected property works on all platforms.
export function _setSelectPeriod(sel, pNum) {
  for (const o of sel.options) {
    if (+o.value === pNum) { o.selected = true; return; }
  }
}

function _populatePeriodSelect(el, periods, { placeholder, currentPNum } = {}) {
  if (!el) return;
  el.innerHTML = placeholder ? `<option value="">${placeholder}</option>` : '';
  let currentGroup = null, currentTyLabel = null;
  periods.forEach(p => {
    const ty = getTaxYearForOffset(p.num - 48);
    if (ty.label !== currentTyLabel) {
      currentGroup = document.createElement('optgroup');
      currentGroup.label = `Tax year ${ty.label}`;
      el.appendChild(currentGroup);
      currentTyLabel = ty.label;
    }
    const o = document.createElement('option');
    o.value = p.num;
    const payStr = p.payday.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London'
    });
    o.textContent = (currentPNum && p.num === currentPNum ? '● ' : '') + `P${p.num} · Paid ${payStr}`;
    currentGroup.appendChild(o);
  });
}

/**
 * Populate the period selector, navigate to the appropriate default period, and
 * return the current-earning period number (used by the coordinator as the ● anchor).
 *
 * @param {Function} onPeriodChange - Coordinator callback to call after selecting.
 * @returns {number} The current earning period number (first upcoming payday).
 */
export function buildPeriodSelect(onPeriodChange) {
  const sel     = document.getElementById('periodSelect');
  const periods = getPeriods();
  const today   = new Date();

  // Default to the first period whose payday is still in the future.
  const upcoming = periods.find(p => p.payday > today);
  let defPNum    = upcoming ? upcoming.num : periods[periods.length - 1].num;

  // URL params let the roster calendar pre-select a specific period.
  const _urlParams = new URLSearchParams(window.location.search);
  const _paydayParam = _urlParams.get('payday');
  const _monthParam  = _urlParams.get('month');
  if (_paydayParam) {
    const [_py, _pm, _pd] = _paydayParam.split('-').map(Number);
    const _matched = periods.find(p =>
      p.payday.getFullYear() === _py &&
      p.payday.getMonth()    === _pm - 1 &&
      p.payday.getDate()     === _pd
    );
    if (_matched) defPNum = _matched.num;
  } else if (_monthParam) {
    const [_my, _mm] = _monthParam.split('-').map(Number);
    const _mid = new Date(_my, _mm - 1, 15);
    const _matched = periods.find(p => p.start <= _mid && _mid <= p.cutoff);
    if (_matched) defPNum = _matched.num;
  }

  const _currentPNum = upcoming ? upcoming.num : periods[periods.length - 1].num;
  _populatePeriodSelect(sel, periods, { currentPNum: _currentPNum });

  _setSelectPeriod(sel, defPNum);
  onPeriodChange();
  buildBackPayPeriodSelect();
  return _currentPNum; // coordinator stores this as _defaultPeriodNum
}

/** Populate the back-pay period selectors. */
export function buildBackPayPeriodSelect() {
  const sel     = document.getElementById('backPayPeriod');
  const fromSel = document.getElementById('backPayFrom');
  if (!sel || !fromSel) return;
  const periods = getPeriods();
  _populatePeriodSelect(sel,     periods, { placeholder: '— select when the lump sum will land —' });
  _populatePeriodSelect(fromSel, periods, { placeholder: '— all periods with saved data —' });
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
  const first   = periods.find(p => (p.num - 48) >= ty.first && (p.num - 48) <= ty.last);
  if (!first) return;
  _setSelectPeriod(document.getElementById('periodSelect'), first.num);
  onPeriodChange();
}

/**
 * Navigate to the previous pay period.
 * @param {Function} onPeriodChange Coordinator callback.
 */
export function prevPeriod(onPeriodChange) {
  const sel     = document.getElementById('periodSelect');
  const periods = getPeriods();
  const idx     = periods.findIndex(x => x.num === +sel.value);
  if (idx > 0) { _setSelectPeriod(sel, periods[idx - 1].num); onPeriodChange(); }
}

/**
 * Navigate to the next pay period.
 * @param {Function} onPeriodChange Coordinator callback.
 */
export function nextPeriod(onPeriodChange) {
  const sel     = document.getElementById('periodSelect');
  const periods = getPeriods();
  const idx     = periods.findIndex(x => x.num === +sel.value);
  if (idx < periods.length - 1) { _setSelectPeriod(sel, periods[idx + 1].num); onPeriodChange(); }
}
