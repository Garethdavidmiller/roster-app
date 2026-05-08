/**
 * paycalc.js — Pay Calculator UI layer.
 *
 * Owns: period select, form read/write, autosave, settings, HPP, sticky bar.
 * Does NOT own: pay maths (paycalc-calc.js), override cache/suggestion engine
 *   (paycalc-roster-suggestions.js), DOM for paycalc.html.
 * Edit here for: UI behaviour, form logic, period helpers, HPP accumulation.
 * Do not edit here for: tax/NI/gross maths, BH detection, override fetch.
 */

import { APP_VERSION, CONFIG as ROSTER_CONFIG, teamMembers, getBaseShift, formatISO, escapeHtml, getBankHolidays } from './roster-data.js?v=8.83';
import {
  P_YR, TAX_YEARS, GRADES, HPP_FRACTION,
  calcBandedTax, getTaxYearForOffset, getThresholds, getLondonAllowanceForPeriod,
  computeGross, computeTax, computeNI, computeSL, calcProRateFactor, getPensionForPeriod,
} from './paycalc-calc.js?v=8.83';
import { resetOverrides, getOverridesFetchState, fetchOverridesForPeriod, getRosterSuggestion } from './paycalc-roster-suggestions.js?v=8.83';
'use strict';

// ── SESSION GUARD ─────────────────────────────────────────────────────────────
// Redirect unsigned-in users to admin.html to sign in, then return here.
// Uses window.location.replace so the back button skips this page (avoids loops).
(function () {
  try {
    const session = JSON.parse(localStorage.getItem('myb_admin_session') || 'null');
    if (!(session && session.name)) {
      window.location.replace('./admin.html?redirect=paycalc');
    }
  } catch {
    window.location.replace('./admin.html?redirect=paycalc');
  }
})();

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Period arithmetic and app constants. Thresholds, tax years, and grades live in
// paycalc-calc.js so they can be imported by the Node test runner.
// ⚠️  TAX YEAR ROLLOVER: Each April, update ANCHOR_DATE, FIRST_OFFSET, LAST_OFFSET
//     and the threshold tables in paycalc-calc.js.
//     P48 anchor (13 Feb 2026) stays fixed as the offset reference point.
const CONFIG = {
  ANCHOR_DATE:    new Date(2026, 1, 13, 12, 0, 0), // P48 payday: 13 Feb 2026, noon local — MUST be noon to preserve the calcProRateFactor half-day invariant
  PERIOD_DAYS:    28,
  PERIODS_PER_YR: P_YR,
  CONTRACTED_HRS: 140,                   // default; per-grade value from GRADES object
  FIRST_OFFSET:   -11,   // P37 — first period of 2025/26 (~11 Apr 2025)
  LAST_OFFSET:     14,   // P62 — last period of 2026/27 (~11 Mar 2027)
  TAX_YEARS,             // imported from paycalc-calc.js
};

// ── G. MILLER ACTUAL PAYSLIP DATA ─────────────────────────────────────────────
// Actual figures from Gareth Miller's 2025/26 payslips, keyed by ISO payday date.
// gross = post-pension taxable pay (matches "Taxable Pay" line on payslip).
// Only shown when 'G. Miller' is the logged-in member; no other member sees this.
const MILLER_ACTUALS = {
  '2025-04-11': { gross: 4260.01, tax:  736.80, ni: 239.86, sl: 202.00, net: 3081.35, varPay: 1612.73 },
  '2025-05-09': { gross: 4382.88, tax:  786.00, ni: 242.32, sl: 214.00, net: 3140.56, varPay: 1735.59 },
  '2025-06-06': { gross: 4340.23, tax:  769.20, ni: 241.46, sl: 210.00, net: 3119.57, varPay: 1692.94 },
  '2025-07-04': { gross: 4883.78, tax:  986.40, ni: 252.33, sl: 259.00, net: 3386.05, varPay: 2236.49 },
  '2025-08-01': { gross: 4441.60, tax:  809.60, ni: 243.49, sl: 219.00, net: 3169.51, varPay: 1789.80 },
  '2025-08-29': { gross: 5145.55, tax: 1090.80, ni: 257.57, sl: 282.00, net: 3515.18, varPay: 2492.25 },
  '2025-09-26': { gross: 4810.43, tax:  957.20, ni: 250.87, sl:   0,    net: 3602.36, varPay: 2157.13 },
  '2025-10-24': { gross: 5477.49, tax: 1224.00, ni: 264.21, sl:   0,    net: 3989.28, varPay: 2137.60 },
  '2025-11-21': { gross: 4756.74, tax:  935.60, ni: 249.79, sl:   0,    net: 3571.35, varPay: 2007.92 },
  '2025-12-19': { gross: 5245.44, tax: 1131.20, ni: 259.57, sl:   0,    net: 3854.67, varPay: 2496.61 },
  '2026-01-16': { gross: 5048.39, tax: 1052.40, ni: 255.63, sl:   0,    net: 3740.36, varPay: 2195.89 },
  '2026-02-13': { gross: 5188.84, tax: 1108.40, ni: 258.44, sl:   0,    net: 3822.00, varPay: 2440.02 },
  '2026-03-13': { gross: 4572.71, tax:  862.00, ni: 246.11, sl:   0,    net: 3464.60, varPay: 1823.89 },
};

/** Return contracted hours for the currently selected grade. */
function getContr() {
  const g = localStorage.getItem(SK.grade);
  return (g && GRADES[g]) ? GRADES[g].contr : GRADES.cea.contr;
}

/** Return the teamMembers entry for the logged-in session user, or null. */
function getLoggedMember() {
  try {
    const sess = JSON.parse(localStorage.getItem('myb_admin_session') || 'null');
    if (!sess?.name) return null;
    return teamMembers.find(m => m.name === sess.name) || null;
  } catch { return null; }
}

/**
 * Return effective contracted hours for the given period, pro-rated if the
 * logged-in member started mid-period.
 * @param {object} p - Period object with .start and .cutoff Date properties.
 * @returns {number} Contracted hours (full or pro-rated).
 */
function getEffectiveContr(p) {
  const base   = getContr();
  if (!p) return base;
  const factor = calcProRateFactor(getLoggedMember()?.startDate, p.start, p.cutoff);
  return factor === 1 ? base : Math.round(base * factor);
}

/** Returns the fraction of the period that the logged-in member was employed.
 *  Delegates to calcProRateFactor (paycalc-calc.js) — see that function for
 *  the formula invariant and why startDate must be midnight local time. */
function getProRateFactor(p) {
  if (!p) return 1;
  return calcProRateFactor(getLoggedMember()?.startDate, p.start, p.cutoff);
}

/** Full-period pension default for the current grade, period-aware.
 *  Pass a period object to get the correct rate for that payday (handles cut-overs). */
function getPensionDefault(pObj) {
  const g = localStorage.getItem(SK.grade);
  const grade = g && GRADES[g] ? g : 'cea';
  if (pObj?.payday) return getPensionForPeriod(grade, pObj.payday);
  return GRADES[grade]?.pension ?? '';
}

// ── STORAGE KEYS ──────────────────────────────────────────────────────────────
const SK = { rate:'cea_rate', rates:'cea_rates', code:'cea_code', sl:'cea_sl', pension:'cea_pension', setup:'cea_setup_done', ytdPay:'cea_ytd_pay', ytdTax:'cea_ytd_tax', grade:'cea_grade' };
// cea_rates is a JSON object: { '2025/26': 20.74, '2026/27': 21.50 }
// Separate rate per tax year so updating for a pay award doesn't distort historical periods.

// Per-tax-year HPP storage — keyed by tax year label so prior-year data survives TY rollover.
// cea_hpp_est_2025_26  — running/final estimate, written on every calcHPP() call
// cea_hpp_actual_2025_26 — confirmed amount from January payslip, written by user
function hppEstKey(ty)    { return `cea_hpp_est_${ty.label.replace('/', '_')}`; }
function hppActualKey(ty) { return `cea_hpp_actual_${ty.label.replace('/', '_')}`; }
// YTD (Year to Date) figures are specific to each tax year — storing them per-year
// prevents 2025/26 YTD values from corrupting the cumulative tax calculation in 2026/27.
function ytdPayKey(ty)    { return `cea_ytd_pay_${ty.label.replace('/', '_')}`; }
function ytdTaxKey(ty)    { return `cea_ytd_tax_${ty.label.replace('/', '_')}`; }

// Session-level tracker — prevents Settings card from auto-opening more than once per tax year
// per browser session. Cleared on page reload. Uses tax year label as the key.
const _settingsPrompted = new Set();

// ── HELP CONTENT — per-card tip text ─────────────────────────────────────────
// Keys match the data-help attribute on each .help-btn.
// Tips support <strong> for emphasis — rendered via innerHTML in the lightbox.
const HELP_CONTENT = {
  hours: {
    title: 'Your Hours — how it works',
    tips: [
      '<strong>Glossary:</strong> AL = Annual Leave · RDW = Rest Day Worked (you worked on your scheduled day off) · BH = Bank Holiday · CEA / CES = your pay grade · HPP = Holiday Pay Premium (annual lump sum in January).',
      'Your contract includes <strong>140 hours per period</strong> at your base rate. You don\'t enter those — they\'re included automatically as basic pay. (CES and CEA are both 140 hours.)',
      'If your name is in the roster, a hint bar appears at the top of this section showing your special shifts for the period — Saturday, Sunday, bank holiday, rest day working (RDW), and Boxing Day. Tap <strong>Fill blanks from roster →</strong> to pre-fill any <em>empty</em> fields in one tap. It will never overwrite hours you\'ve already typed. Filled fields turn gold; the highlight clears as soon as you edit them. Saturday and Boxing Day come from the base roster only. Sunday, bank holiday, and RDW shifts also include any overrides added by admin.',
      'Only enter hours at a <strong>different rate</strong>: rostered Saturdays (time-and-a-quarter, 1.25×), overtime (time-and-a-quarter, 1.25×), rest days and unrostered Saturdays (1.25×), Sundays (time-and-a-half, 1.5×), Boxing Day (triple time, 3×).',
      '<strong>Bank holiday rows</strong> appear automatically in periods that contain one. "Bank Holiday Rostered" is for contracted shifts on a bank holiday; "Bank Holiday RDW" is for working a rest day that happened to fall on a bank holiday.',
      'Boxing Day rows only appear in the January payslip period — they\'re hidden the rest of the time. In January 2027 (P60), Boxing Day 3× applies to shifts worked on 26 Dec; the substitute bank holiday (Mon 28 Dec 2026) goes in Bank Holiday Rostered, not Boxing Day.',
      'The <strong>cut-off date</strong> is the last shift date counted in this pay period. Shifts on or after that date go into the next period.',
      'Each entry updates the estimate instantly — no need to tap a calculate button.',
    ],
  },
  settings: {
    title: 'Settings — where to find things',
    tips: [
      '<strong>Hourly rate:</strong> shown on your payslip next to your name, or on your contract. CEA rate is currently £20.74; CES rate is currently £21.81. Both change each April with the pay award.',
      '<strong>Tax code:</strong> shown at the top of your payslip (e.g. 1257L). It tells HMRC how much tax-free income you get. Most Marylebone staff are on 1257L. A code starting with S means you pay Scottish income tax rates. If you\'re unsure, check your payslip or contact payroll.',
      '<strong>Pension contribution:</strong> your payslip calls this "Smart RPS CR Scheme" — it\'s the same thing. <strong>Pension is saved separately for each period</strong> — so if yours changes mid-year, update it here and past periods will keep their own recorded amount. The label next to the field shows which period you\'re editing.',
      '<strong>Student loan:</strong> only tick this if you see a student loan deduction line on your payslip. If you repay by direct debit (not through your wages), leave this as None. The plan number is printed on your payslip next to the deduction — choose the matching one.',
      `<strong>London Allowance (£${TAX_YEARS[TAX_YEARS.length - 1].londonAllow.toFixed(2)}/period):</strong> a fixed supplement paid to all Marylebone staff (CEA and CES). It\'s included automatically — you don\'t need to enter it.`,
      'Your hourly rate is saved per tax year — updating it for 2026/27 won\'t affect your 2025/26 figures. Pension and hours are saved per individual period.',
    ],
  },
  accuracy: {
    title: 'Match Your Payslip — why it helps',
    tips: [
      'By default, the app divides your tax-free allowance equally across all 13 pay periods. This is usually accurate, but can drift if you had an unusually high or low pay period earlier in the year.',
      'Entering <strong>Year to Date figures</strong> switches to a cumulative PAYE-style estimate — usually much closer to your payslip, especially later in the year.',
      'Find <strong>"Total taxable pay"</strong> and <strong>"Total tax deducted"</strong> in the <strong>Year to Date</strong> box on your payslip (usually bottom-right). Update them each time you get a new payslip.',
      'Once your January payslip arrives with the confirmed Holiday Pay Premium amount, enter it in the <strong>Holiday Pay Premium</strong> card below to replace the running estimate.',
    ],
  },
  hpp: {
    title: 'Holiday Pay Premium (HPP)',
    tips: [
      'When you take annual leave, Chiltern only pay your <strong>basic contracted rate</strong> — you miss out on overtime, rest day pay, and Sunday pay for those days.',
      'To compensate, Chiltern calculate a <strong>Holiday Pay Premium of 7.69%</strong> of your extra pay above basic hours (overtime, rest day working, Sundays, and London Allowance) across the whole tax year.',
      'This is paid as a <strong>single lump sum in your January payslip</strong> every year — it doesn\'t appear on any other payslip.',
      'The estimate builds across all periods you\'ve entered in the current tax year. When you move into the next tax year, the prior year\'s estimate carries forward into this card — enter the confirmed January payslip figure there to replace it.',
    ],
  },
  backpay: {
    title: 'Pay Rise Back Pay — when to use it',
    tips: [
      'Use this when a pay award is <strong>backdated to 1 April</strong>. Chiltern calculate the rate difference across every period since April, then pay the total on one payslip.',
      'Enter your <strong>old and new hourly rates</strong> and London Allowance figures. The calculator uses the hours you\'ve already entered for each period.',
      'The lump sum is taxed in the period it lands — if it pushes your income over a higher tax band that month, you may receive less than the gross figure shown.',
      'Tap <strong>"Apply new rate"</strong> to update Settings with the new rate so all future estimates use the correct figure.',
    ],
  },
};
function periodKey(pNum) { return `cea_p${pNum}`; }

// Period data schema — all fields that get saved per period
function emptyPeriodData() {
  return { satH:0, satM:0, bhH:0, bhM:0, bhOtH:0, bhOtM:0, otH:0, otM:0, rdwH:0, rdwM:0, sunH:0, sunM:0, boxH:0, boxM:0, peer:0, slSkip:false, otherAdj:0 };
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
const fd = d => d.toLocaleDateString('en-GB', {
  day:'numeric', month:'short', year:'2-digit', timeZone:'Europe/London'
});
const fdShort = d => d.toLocaleDateString('en-GB', {
  day:'numeric', month:'short', timeZone:'Europe/London'
});
const fmt = n => '£' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ── INPUT HELPERS ─────────────────────────────────────────────────────────────
function numVal(id)    { return parseFloat(document.getElementById(id).value) || 0; }
function intVal(id)    { return parseInt(document.getElementById(id).value)   || 0; }
function hhmmDec(hId, mId) { return intVal(hId) + intVal(mId) / 60; }

function clampMins(mId) {
  const el = document.getElementById(mId);
  const v  = parseInt(el.value);
  if (!isNaN(v)) { if (v > 59) el.value = 59; if (v < 0) el.value = 0; }
}

function onHhMm(hId, mId, warnId) {
  // Validate Saturday hours don't exceed contracted hours (pro-rated for joining periods)
  if (warnId) {
    const hrs   = hhmmDec(hId, mId);
    const warn  = document.getElementById(warnId);
    const curP  = getPeriods().find(x => x.num === currentPeriodNum());
    const contr = getEffectiveContr(curP);
    if (hrs > contr) {
      document.getElementById(hId).value = contr;
      document.getElementById(mId).value = 0;
      warn.textContent = `⚠ Capped at ${contr} hrs — your contracted maximum for this period`;
      warn.classList.add('show');
    } else if (hrs < contr) {
      warn.classList.remove('show');
    }
    // hrs === contr: warning stays as-is so it remains visible after clamping
  }
  calculate();
}

// ── PAY PERIODS ───────────────────────────────────────────────────────────────
// Structure of each period:
//   cutoff  = Saturday (last day shifts count; also the hours-submission deadline)
//   start   = Sunday after the previous period's cutoff (first day shifts count)
//   payday  = Friday 6 days after cutoff (the day Chiltern pay into your account)
function getPeriods() {
  const out = [];
  for (let offset = CONFIG.FIRST_OFFSET; offset <= CONFIG.LAST_OFFSET; offset++) {
    const payday = new Date(CONFIG.ANCHOR_DATE);
    payday.setDate(payday.getDate() + offset * CONFIG.PERIOD_DAYS);
    const cutoff = new Date(payday); cutoff.setDate(cutoff.getDate() - 6);
    // start = day after previous cutoff = cutoff - 27 days (not payday - 27)
    const start  = new Date(cutoff); start.setDate(start.getDate() - CONFIG.PERIOD_DAYS + 1);
    out.push({ payday, start, cutoff, num: 48 + offset });
  }
  return out;
}

function hasBoxingDay(p) {
  // Check whether 26 Dec falls within the shift window (start → cutoff)
  for (let y = p.start.getFullYear(); y <= p.cutoff.getFullYear(); y++) {
    const bd = new Date(y, 11, 26);
    if (bd >= p.start && bd <= p.cutoff) return true;
  }
  return false;
}

// ── BANK HOLIDAY DETECTION ────────────────────────────────────────────────────
// Uses getBankHolidays() from roster-data.js — calculated algorithmically, no
// hardcoded dates to maintain. Boxing Day (26 Dec) is handled separately by
// hasBoxingDay() at 3× rate, so it is excluded here.
function _bhsForYear(year) {
  return getBankHolidays(year).filter(d => !(d.getMonth() === 11 && d.getDate() === 26));
}

function hasBankHoliday(p) {
  const years = new Set([p.start.getFullYear(), p.cutoff.getFullYear()]);
  for (const y of years) {
    if (_bhsForYear(y).some(bh => bh >= p.start && bh <= p.cutoff)) return true;
  }
  return false;
}

// Rows that are conditionally shown/hidden based on period content.
// Each entry: { condition(p), rows: [id], fields: [id] }
const CONDITIONAL_ROWS = [
  {
    condition: hasBankHoliday,
    rows:   ['bhRow', 'bhOtRow'],
    fields: ['bhH', 'bhM', 'bhOtH', 'bhOtM'],
  },
];

function updateBhRows(p) {
  CONDITIONAL_ROWS.forEach(({ condition, rows, fields }) => {
    const show = condition(p);
    rows.forEach(id => document.getElementById(id)?.classList.toggle('hidden', !show));
    if (!show) fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  });
}

// getTaxYearForOffset, getThresholds, getLondonAllowanceForPeriod, calcBandedTax
// are imported from paycalc-calc.js above.

// ── PERIOD SELECT ─────────────────────────────────────────────────────────────
function buildPeriodSelect() {
  const sel     = document.getElementById('periodSelect');
  const periods = getPeriods();
  const today   = new Date();

  // Default to the first period whose payday is still in the future — this is a pay predictor,
  // so staff want to see what they're about to be paid, not what they already received.
  // If all paydays have passed (end of supported range), fall back to the last period.
  const upcoming = periods.find(p => p.payday > today);
  let defPNum    = upcoming ? upcoming.num : periods[periods.length - 1].num;

  // URL params let the roster calendar pre-select a specific period.
  // ?payday=YYYY-MM-DD  — tap on a 💷 payday cell jumps directly to that period.
  // ?month=YYYY-MM      — 💷 header button passes the currently viewed calendar month.
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

  sel.innerHTML = '';
  let currentGroup    = null;
  let currentTyLabel  = null;

  periods.forEach(p => {
    // Start a new <optgroup> when the tax year changes
    const ty = getTaxYearForOffset(p.num - 48);
    if (ty.label !== currentTyLabel) {
      currentGroup = document.createElement('optgroup');
      currentGroup.label = `Tax year ${ty.label}`;
      sel.appendChild(currentGroup);
      currentTyLabel = ty.label;
    }

    const o = document.createElement('option');
    o.value = p.num;
    const payStr = p.payday.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London'
    });
    o.textContent = `P${p.num} · Paid ${payStr}`;
    currentGroup.appendChild(o);
  });

  sel.value = defPNum;
  onPeriodChange();
  buildBackPayPeriodSelect();
}

function buildBackPayPeriodSelect() {
  const sel     = document.getElementById('backPayPeriod');
  const fromSel = document.getElementById('backPayFrom');
  if (!sel && !fromSel) return;

  const periods = getPeriods();

  function populate(el, placeholder) {
    if (!el) return;
    el.innerHTML = `<option value="">${placeholder}</option>`;
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
      o.textContent = `P${p.num} · Paid ${payStr}`;
      currentGroup.appendChild(o);
    });
  }

  populate(sel,     '— select when the lump sum will land —');
  populate(fromSel, '— all periods with saved data —');
}

// ── PER-TAX-YEAR RATE ─────────────────────────────────────────────────────────
// Loads the stored rate for the given tax year into the hourly rate field.
// Falls back to the legacy single rate, then to the current grade's default.
function updateRateForPeriod(ty) {
  let rates = {};
  try { rates = JSON.parse(localStorage.getItem(SK.rates) || '{}'); } catch(e) { console.warn('[PayCalc] Rates store corrupted'); }
  const g     = localStorage.getItem(SK.grade);
  const rate  = rates[ty.label]
             || parseFloat(localStorage.getItem(SK.rate))
             || (g && GRADES[g] ? GRADES[g].rate : GRADES.cea.rate);
  document.getElementById('hourlyRate').value = rate.toFixed(2);
  // Update label to show which tax year this rate applies to
  const lbl = document.getElementById('rateYearLabel');
  if (lbl) lbl.textContent = `for ${ty.label}`;
}

// Loads the stored Year to Date figures for this tax year into the Improve Accuracy fields.
// Called from onPeriodChange() so values reset correctly when switching between tax years.
function updateYtdForTaxYear(ty) {
  const payEl = document.getElementById('ytdPay');
  const taxEl = document.getElementById('ytdTax');
  if (!payEl || !taxEl) return;
  if (document.activeElement !== payEl) payEl.value = localStorage.getItem(ytdPayKey(ty)) || '';
  if (document.activeElement !== taxEl) taxEl.value = localStorage.getItem(ytdTaxKey(ty)) || '';
}

// ── TAX YEAR TABS ─────────────────────────────────────────────────────────────
function updateTyTabs() {
  const pNum = currentPeriodNum();
  const offset = pNum - 48;
  CONFIG.TAX_YEARS.forEach((ty, i) => {
    const tab = document.getElementById(`tyTab${i}`);
    if (tab) tab.classList.toggle('active', offset >= ty.first && offset <= ty.last);
  });
}

function jumpToTaxYear(tyIndex) {
  const ty      = CONFIG.TAX_YEARS[tyIndex];
  if (!ty) return;
  const periods = getPeriods();
  // Find first period of that tax year
  const first   = periods.find(p => (p.num - 48) >= ty.first && (p.num - 48) <= ty.last);
  if (!first) return;
  document.getElementById('periodSelect').value = first.num;
  onPeriodChange();
}

function prevPeriod() {
  const sel     = document.getElementById('periodSelect');
  const periods = getPeriods();
  const idx     = periods.findIndex(x => x.num === +sel.value);
  if (idx > 0) { sel.value = periods[idx - 1].num; onPeriodChange(); }
}

function nextPeriod() {
  const sel     = document.getElementById('periodSelect');
  const periods = getPeriods();
  const idx     = periods.findIndex(x => x.num === +sel.value);
  if (idx < periods.length - 1) { sel.value = periods[idx + 1].num; onPeriodChange(); }
}

function onPeriodChange() {
  const pNum    = +document.getElementById('periodSelect').value;
  const periods = getPeriods();
  const p       = periods.find(x => x.num === pNum);
  if (!p) return;
  const cutStr  = fdShort(p.cutoff);

  // Prev / Next button states
  const idx = periods.findIndex(x => x.num === pNum);
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  prevBtn.disabled = (idx <= 0);
  nextBtn.disabled = (idx >= periods.length - 1);
  prevBtn.setAttribute('aria-label', idx <= 0
    ? 'No earlier period available — this is the first one'
    : 'View earlier period');
  nextBtn.setAttribute('aria-label', idx >= periods.length - 1
    ? 'No later period available — this is the last one'
    : 'View later period');

  // Meta row — two lines
  // Row 1: the shift dates (start → cutoff, not start → payday)
  // Row 2: payday + tax year (payday is already in the dropdown label, but useful as context)
  const ty = getTaxYearForOffset(p.num - 48);
  const startStr = p.start.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'Europe/London'
  });
  const cutLongStr = p.cutoff.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London'
  });
  const payStr = p.payday.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London'
  });
  document.getElementById('pmRange').textContent   = `${startStr} – ${cutLongStr}`;
  document.getElementById('pmSub').textContent     = `💷 Paid: ${payStr}  ·  Tax year ${ty.label}`;
  document.getElementById('periodBadge').textContent = `P${p.num}`;
  document.getElementById('netPeriod').textContent   = `Paid ${fd(p.payday)}`;

  // Update cut-off date in sub descriptions
  document.getElementById('overtimeSub').textContent =
    `Extra hours on top of a rostered shift (cut-off: ${cutStr}). Shows as "Overtime 1.25" on your payslip.`;
  document.getElementById('rdwSub').textContent =
    `You came in on a rest day, including any unrostered Saturdays (cut-off: ${cutStr}). Shows as "RDW 1.25" on your payslip.`;
  document.getElementById('sundaySub').textContent =
    `Any hours you worked on a Sunday (cut-off: ${cutStr}). Shows as "RDW Sun 1.5" on your payslip.`;

  // Boxing Day — uses same pattern as CONDITIONAL_ROWS but needs the banner too
  const boxing = hasBoxingDay(p);
  document.getElementById('boxingBanner').classList.toggle('visible', boxing);
  document.getElementById('boxingRow').classList.toggle('hidden', !boxing);
  if (!boxing) { document.getElementById('boxH').value = ''; document.getElementById('boxM').value = ''; }

  // Update tax year tab active state
  updateTyTabs();

  // Load the rate and Year to Date figures for this period's tax year
  updateRateForPeriod(ty);
  updateYtdForTaxYear(ty);
  // Update the "for P__" label next to the pension field so users can see
  // which period's pension they are viewing or editing.
  const pensionPeriodLbl = document.getElementById('pensionPeriodLabel');
  if (pensionPeriodLbl) pensionPeriodLbl.textContent = `for P${p.num}`;

  // Settings confirmation check for this tax year.
  const tyConfirmed = localStorage.getItem(settingsKey(ty));
  // Always keep the title current so the hardcoded HTML default never shows stale text.
  document.getElementById('setupBannerTitle').textContent = `👋 Set up for ${ty.label}`;
  if (tyConfirmed) {
    // Confirmed — hide banner, update card header hint with saved values.
    document.getElementById('setupBanner').classList.add('hidden');
    const _hdrGrade = localStorage.getItem(SK.grade);
    const rate = parseFloat(document.getElementById('hourlyRate').value || String(GRADES[_hdrGrade]?.rate ?? GRADES.cea.rate)).toFixed(2);
    const code = (document.getElementById('taxCode').value || '1257L').toUpperCase();
    document.getElementById('settingsHint').textContent = `✓ ${ty.label} — £${rate}/hr · ${code}`;
  } else {
    // Not yet confirmed — show banner with the current tax year label.
    document.getElementById('setupBannerTitle').textContent = `👋 Set up for ${ty.label}`;
    document.getElementById('setupBannerBody').innerHTML =
      `Enter your <strong>hourly rate</strong> and <strong>tax code</strong> in ⚙️ Your Settings below, then tap <strong>Save settings</strong>. These settings apply to ${ty.label} only — you'll be prompted again when the new tax year starts.`;
    document.getElementById('setupBanner').classList.remove('hidden');
    // Auto-open settings once per session per TY — only for returning users (new users
    // already see the settings card open). Show the in-card notice for returning users.
    if (!_settingsPrompted.has(ty.label)) {
      _settingsPrompted.add(ty.label);
      if (localStorage.getItem(SK.setup)) {
        document.getElementById('settingsToggle').classList.add('open');
        document.getElementById('settingsBody').classList.add('open');
        const notice = document.getElementById('settingsNewYearNotice');
        notice.textContent = ty.label === '2026/27'
          ? `New tax year ${ty.label} — the pay award has not yet been confirmed. The default rate may be out of date. Update once your payslip reflects the new rate (awards are often backdated to April), then tap Save settings.`
          : `New tax year ${ty.label} — check your hourly rate is up to date, then tap Save settings.`;
        notice.classList.remove('hidden');
      }
    }
  }

  // Show/hide bank holiday rows based on whether this period has any
  updateBhRows(p);

  // Show rate-unconfirmed notice when in a period where the pay award isn't finalised
  const _rateNoticeEl = document.getElementById('rateUnconfirmedNotice');
  if (_rateNoticeEl) _rateNoticeEl.classList.toggle('hidden', ty.label !== '2026/27');

  // Read session now so we can set the correct initial fetch state
  let session2;
  try { session2 = JSON.parse(localStorage.getItem('myb_admin_session') || 'null'); } catch { session2 = null; }

  // Reset override cache before rendering the hint — clears stale data from the
  // previous period and sets the initial fetch state.
  resetOverrides(session2?.name ? 'checking' : 'base-only');

  // Collapse the day list on period change — reset before updateRosterHint so the
  // subsequent Firestore refresh doesn't close it again if the user opens it.
  const _dayListEl    = document.getElementById('rosterDayList');
  const _daysToggleEl = document.getElementById('rosterDaysToggle');
  if (_dayListEl)    _dayListEl.style.display = 'none';
  if (_daysToggleEl) _daysToggleEl.textContent = 'Show days ▼';

  // Update roster suggestion card and joiner notice for this period.
  updateRosterHint();
  updateJoinerNotice(p);

  // Update Pay → Calendar link for this period
  const _rvl = document.getElementById('rosterViewLink');
  if (_rvl) _rvl.href = `./index.html?date=${formatISO(p.start)}`;

  // Fetch admin-added overrides from Firestore in the background.
  if (session2?.name) {
    fetchOverridesForPeriod(p, session2.name).then(status => {
      if (status === 'cancelled') return;
      updateRosterHint();
      // Silently refresh any gold-highlighted fields filled during 'checking' state.
      const _refreshP = getPeriods().find(x => x.num === currentPeriodNum());
      if (_refreshP) {
        const _refreshS = getRosterSuggestion(_refreshP, getLoggedMember());
        if (_refreshS) { _applyRosterSuggestion(_refreshS); autosave(); }
      }
    });
  }

  // Load saved data for this period
  loadPeriodData(p.num);

  // Set data attribute for print header annotation
  const hdr = document.querySelector('.app-header');
  if (hdr) {
    const now = new Date().toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
    hdr.setAttribute('data-print-line',
      `Period P${p.num} · Paid ${fdShort(p.payday)}  ·  Printed ${now}`
    );
  }
}

// ── PERIOD DATA SAVE / LOAD ───────────────────────────────────────────────────
function currentPeriodNum() {
  return +document.getElementById('periodSelect').value;
}

function readFormData() {
  return {
    satH: intVal('satH'), satM: intVal('satM'),
    bhH:  intVal('bhH'),  bhM:  intVal('bhM'),
    bhOtH:intVal('bhOtH'),bhOtM:intVal('bhOtM'),
    otH:  intVal('otH'),  otM:  intVal('otM'),
    rdwH: intVal('rdwH'), rdwM: intVal('rdwM'),
    sunH: intVal('sunH'), sunM: intVal('sunM'),
    boxH: intVal('boxH'), boxM: intVal('boxM'),
    peer: +document.getElementById('peerVal').textContent,
    slSkip:   document.getElementById('slSkipCheck').checked,
    otherAdj: parseFloat(document.getElementById('otherAdj').value) || 0,
    pension:  parseFloat(document.getElementById('pensionAmt').value) || 0,
  };
}

function writeFormData(d) {
  clearRosterSuggestedAll();
  const set = (id, v) => { document.getElementById(id).value = v || ''; };
  set('satH', d.satH || ''); set('satM', d.satM || '');
  set('bhH',   d.bhH   || ''); set('bhM',   d.bhM   || '');
  set('bhOtH', d.bhOtH || ''); set('bhOtM', d.bhOtM || '');
  set('otH',   d.otH   || ''); set('otM',   d.otM   || '');
  set('rdwH', d.rdwH || ''); set('rdwM', d.rdwM || '');
  set('sunH', d.sunH || ''); set('sunM', d.sunM || '');
  set('boxH', d.boxH || ''); set('boxM', d.boxM || '');
  document.getElementById('peerVal').textContent  = d.peer || 0;
  document.getElementById('slSkipCheck').checked  = d.slSkip || false;
  document.getElementById('otherAdj').value        = d.otherAdj || '';
  // Restore pension only when period data has a saved value; period-specific default is
  // applied by the caller (loadPeriodData or clearPeriod) when d.pension is null.
  // Loose != null so that pension = 0 (salary sacrifice opted out) is preserved correctly.
  const pa = document.getElementById('pensionAmt');
  if (pa && d.pension != null) pa.value = d.pension;
}

function updateAdjSign() {
  const btn = document.getElementById('adjSignBtn');
  btn.textContent = _adjNegative ? '−' : '+';
  btn.setAttribute('aria-label', _adjNegative ? 'Toggle sign: currently negative' : 'Toggle sign: currently positive');
  btn.classList.toggle('negative', _adjNegative);
}

function isDataEmpty(d) {
  return !d.satH && !d.satM &&
         !d.bhH  && !d.bhM  &&
         !d.bhOtH && !d.bhOtM &&
         !d.otH  && !d.otM  &&
         !d.rdwH && !d.rdwM &&
         !d.sunH && !d.sunM &&
         !d.boxH && !d.boxM && !d.peer &&
         !d.slSkip && !d.otherAdj;
}

function autosave() {
  calculate(); // no-op double-call is harmless but kept here for standalone inputs
  const pNum = currentPeriodNum();
  const d    = readFormData();
  try {
    localStorage.setItem(periodKey(pNum), JSON.stringify(d));
    updateSaveStatus(pNum);
  } catch(e) { /* storage unavailable */ }
}

function loadPeriodData(pNum) {
  let d = emptyPeriodData();
  try {
    const raw = localStorage.getItem(periodKey(pNum));
    if (raw) d = JSON.parse(raw);
  } catch(e) { /* use empty */ }
  writeFormData(d);
  // If no pension has been manually saved for this period, apply the period-specific
  // default. This handles both: (a) pension rate cut-overs (old periods show the old
  // rate, new periods show the new rate) and (b) joining-period pro-ration.
  const _pObj = getPeriods().find(x => x.num === pNum);
  if (d.pension == null && _pObj) {
    const _fullPension = getPensionDefault(_pObj);
    const pa = document.getElementById('pensionAmt');
    if (pa) pa.value = (_fullPension * getProRateFactor(_pObj)).toFixed(2);
  }
  _adjNegative = (d.otherAdj || 0) < 0;
  updateAdjSign();
  // Auto-expand "more options" if this period has extras saved
  const hasExtras = d.slSkip || d.otherAdj;
  const extraBody = document.getElementById('hoursExtra');
  const extraBtn  = document.getElementById('hoursShowMore');
  if (hasExtras && !extraBody.classList.contains('open')) {
    extraBody.classList.add('open');
    extraBtn.classList.add('open');
    extraBtn.querySelector('.show-more-arrow').textContent = '▲';
    document.getElementById('hoursShowMoreLabel').textContent = 'Hide adjustments';
  } else if (!hasExtras && extraBody.classList.contains('open')) {
    extraBody.classList.remove('open');
    extraBtn.classList.remove('open');
    extraBtn.querySelector('.show-more-arrow').textContent = '▼';
    document.getElementById('hoursShowMoreLabel').textContent = 'Other adjustments';
  }
  updateSaveStatus(pNum);
  calculate();
}

function updateSaveStatus(pNum) {
  const el  = document.getElementById('saveStatus');
  const raw = localStorage.getItem(periodKey(pNum));
  if (raw) {
    let d;
    try { d = JSON.parse(raw); } catch(e) { d = null; }
    if (d && !isDataEmpty(d)) {
      el.textContent = '✓ Entries saved for this period';
      el.className   = 'save-status saved';
      return;
    }
  }
  el.textContent = 'No entries saved for this period';
  el.className   = 'save-status unsaved';
}

const _clearState = { pending: false, timer: null, countdownTimer: null };

function clearPeriod() {
  const btn = document.getElementById('clearBtn');
  if (!_clearState.pending) {
    _clearState.pending = true;
    let secs = 3;
    btn.textContent = `Tap again to confirm (${secs})`;
    btn.classList.add('confirming');
    // Countdown tick every second
    _clearState.countdownTimer = setInterval(() => {
      secs--;
      if (secs > 0) btn.textContent = `Tap again to confirm (${secs})`;
    }, 1000);
    _clearState.timer = setTimeout(() => {
      clearInterval(_clearState.countdownTimer);
      _clearState.pending = false;
      btn.textContent = 'Clear all entries';
      btn.classList.remove('confirming');
    }, 3000);
    return;
  }
  clearTimeout(_clearState.timer);
  clearInterval(_clearState.countdownTimer);
  _clearState.pending = false;
  btn.textContent = 'Clear all entries';
  btn.classList.remove('confirming');
  const pNum = currentPeriodNum();
  localStorage.removeItem(periodKey(pNum));
  writeFormData(emptyPeriodData());
  // Apply the period-specific pension default (pro-rated for joining periods, rate-cut-over
  // aware) — writeFormData no longer does this when d.pension is null.
  const _clearP = getPeriods().find(x => x.num === currentPeriodNum());
  if (_clearP) {
    const _pa = document.getElementById('pensionAmt');
    if (_pa) _pa.value = (getPensionDefault(_clearP) * getProRateFactor(_clearP)).toFixed(2);
  }
  _adjNegative = false;
  updateAdjSign();
  updateSaveStatus(pNum);
  calculate();
}

function clearRosterSuggestedAll() {
  document.querySelectorAll('.hhmm-field input.roster-suggested')
    .forEach(el => el.classList.remove('roster-suggested'));
}

// ── SETTINGS SAVE / LOAD ──────────────────────────────────────────────────────
// settingsKey: per-tax-year "confirmed" flag, separate from the raw saved values.
function settingsKey(ty) { return `cea_setup_${ty.label.replace('/', '_')}`; }

// saveSettings: persists all field values. Called on every input change (auto-save).
// Does NOT set the confirmed flag or collapse the card — that's confirmSettings().
function saveSettings() {
  const rateVal = document.getElementById('hourlyRate').value;
  const pNum    = currentPeriodNum();
  const curP    = getPeriods().find(x => x.num === pNum);
  const curTy   = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  let rates = {};
  try { rates = JSON.parse(localStorage.getItem(SK.rates) || '{}'); } catch(e) { console.warn('[PayCalc] Rates store corrupted, resetting'); }
  const _savedGrade   = document.getElementById('gradeSelect').value;
  const _gradeDefault = GRADES[_savedGrade]?.rate ?? GRADES.cea.rate;
  rates[curTy.label] = parseFloat(rateVal) || _gradeDefault;
  localStorage.setItem(SK.rates,     JSON.stringify(rates));
  localStorage.setItem(SK.rate,      rateVal);
  localStorage.setItem(SK.code,      document.getElementById('taxCode').value);
  localStorage.setItem(SK.sl,        document.getElementById('studentLoan').value);
  // On a joining period the pension field shows the pro-rated amount.
  // Always write the full-period default to SK.pension so future full periods
  // don't inherit the pro-rated value as their default.
  // Always write the full-period rate (not the field value when pro-rated) so
  // the global default is correct for future full periods.
  const _pensionToSave = getProRateFactor(curP) < 1
    ? getPensionDefault(curP)
    : document.getElementById('pensionAmt').value;
  localStorage.setItem(SK.pension, _pensionToSave);
  localStorage.setItem(ytdPayKey(curTy), document.getElementById('ytdPay').value);
  localStorage.setItem(ytdTaxKey(curTy), document.getElementById('ytdTax').value);
  localStorage.setItem(SK.grade,         document.getElementById('gradeSelect').value);
}

// confirmSettings: called by the Save button. Saves, marks this tax year as confirmed,
// updates the card header hint, collapses the card.
function confirmSettings() {
  saveSettings();
  const pNum  = currentPeriodNum();
  const curP  = getPeriods().find(x => x.num === pNum);
  const curTy = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  // If this period already has saved hours, patch its pension value in-place.
  // We only update existing records — we don't create an hours-empty record just
  // because the user tapped Save settings.
  const existingRaw = localStorage.getItem(periodKey(pNum));
  if (existingRaw) {
    try {
      const d = JSON.parse(existingRaw);
      d.pension = parseFloat(document.getElementById('pensionAmt').value) || 0;
      localStorage.setItem(periodKey(pNum), JSON.stringify(d));
    } catch(e) {}
  }
  localStorage.setItem(settingsKey(curTy), '1');
  localStorage.setItem(SK.setup, '1');
  document.getElementById('setupBanner').classList.add('hidden');
  document.getElementById('settingsNewYearNotice').classList.add('hidden');
  // Update header hint to show confirmed summary
  const rate = parseFloat(document.getElementById('hourlyRate').value).toFixed(2);
  const code = (document.getElementById('taxCode').value || '1257L').toUpperCase();
  document.getElementById('settingsHint').textContent =
    `✓ ${curTy.label} — £${rate}/hr · ${code}`;
  // Brief "saved" confirmation then collapse
  const fb = document.getElementById('settingsSaveFeedback');
  fb.textContent = '✓ Settings saved';
  setTimeout(() => {
    fb.textContent = '';
    document.getElementById('settingsToggle').classList.remove('open');
    document.getElementById('settingsBody').classList.remove('open');
  }, 2500);
  calculate();
}

function loadSettings() {
  // Migrate legacy single rate to per-tax-year rates if not already done
  if (!localStorage.getItem(SK.rates)) {
    const legacyRate = localStorage.getItem(SK.rate);
    if (legacyRate) {
      const rates = {};
      CONFIG.TAX_YEARS.forEach(ty => { rates[ty.label] = parseFloat(legacyRate); });
      localStorage.setItem(SK.rates, JSON.stringify(rates));
    }
  }
  // Rate is set per-period in updateRateForPeriod() called from onPeriodChange —
  // no need to set it here; the field will update when buildPeriodSelect fires.
  const code    = localStorage.getItem(SK.code);
  const sl      = localStorage.getItem(SK.sl);
  const pension = localStorage.getItem(SK.pension);
  const done    = localStorage.getItem(SK.setup);
  if (code)    document.getElementById('taxCode').value     = code.toUpperCase();
  if (sl)      document.getElementById('studentLoan').value = sl;
  let grade = localStorage.getItem(SK.grade);
  if (!grade || !GRADES[grade]) {
    // Auto-detect from the logged-in member's role
    try {
      const sess = JSON.parse(localStorage.getItem('myb_admin_session') || 'null');
      if (sess?.name) {
        const member = teamMembers.find(m => m.name === sess.name);
        if (member?.role === 'CES') grade = 'ces';
      }
    } catch(e) {}
  }
  if (grade && GRADES[grade]) {
    document.getElementById('gradeSelect').value = grade;
    localStorage.setItem(SK.grade, grade);
  }
  document.getElementById('pensionAmt').value = pension ?? getPensionDefault();
  // Migrate legacy global YTD values (cea_ytd_pay / cea_ytd_tax) to per-year keys
  const legacyYtdPay = localStorage.getItem(SK.ytdPay);
  const legacyYtdTax = localStorage.getItem(SK.ytdTax);
  if (legacyYtdPay || legacyYtdTax) {
    const firstTy = CONFIG.TAX_YEARS[0];
    if (!localStorage.getItem(ytdPayKey(firstTy))) localStorage.setItem(ytdPayKey(firstTy), legacyYtdPay || '');
    if (!localStorage.getItem(ytdTaxKey(firstTy))) localStorage.setItem(ytdTaxKey(firstTy), legacyYtdTax || '');
    localStorage.removeItem(SK.ytdPay);
    localStorage.removeItem(SK.ytdTax);
  }
  // Settings card starts closed in HTML. Open it only for first-time users.
  // (Previously started open and was removed for returning users — caused a visible flash.)
  if (!done) {
    document.getElementById('settingsToggle').classList.add('open');
    document.getElementById('settingsBody').classList.add('open');
  } else {
    // Migration: mark all tax years confirmed if global setup flag already set (v1.13+)
    CONFIG.TAX_YEARS.forEach(ty => {
      if (!localStorage.getItem(settingsKey(ty))) {
        localStorage.setItem(settingsKey(ty), '1');
      }
    });
  }
  // Migration: copy legacy global hppActual (cea_hpp_actual) to per-year key if needed
  const legacyHppActual = localStorage.getItem('cea_hpp_actual');
  if (legacyHppActual) {
    const firstTy = CONFIG.TAX_YEARS[0];
    if (!localStorage.getItem(hppActualKey(firstTy))) {
      localStorage.setItem(hppActualKey(firstTy), legacyHppActual);
    }
    localStorage.removeItem('cea_hpp_actual');
  }

  // Migration (v8.83): two-part pension localStorage cleanup.
  //
  // Part A — pension rate cut-over (all users, P51+):
  //   Any period with payday ≥ May 8 2026 and pension === £154.77 (old full-period
  //   default) is updated to £147.36. Only the exact old default is patched — custom
  //   values are untouched.
  //
  // Part B — joining-period anchor bug (joiners only):
  //   ANCHOR_DATE was midnight before v8.83; it must be noon to maintain the
  //   calcProRateFactor half-day invariant. With a midnight anchor, M. Okeke's P51
  //   pro-ration factor was 13/28 instead of the correct 14/28, producing auto-saved
  //   pension values of £71.86 or £68.42 instead of £73.68. The old-rate noon-anchor
  //   value (£77.39) is also stale. All three are fingerprint values that cannot
  //   plausibly be intentional custom entries.
  if (!localStorage.getItem('cea_pension_v882_migrated')) {
    const _pensionCutover = new Date(2026, 4, 8);
    const _member = getLoggedMember();
    const _joiningP = _member?.startDate
      ? getPeriods().find(p => _member.startDate > p.start && _member.startDate <= p.cutoff)
      : null;

    getPeriods().forEach(p => {
      const raw = localStorage.getItem(periodKey(p.num));
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        let changed = false;

        // Part A: full old-rate default on P51+
        if (p.payday >= _pensionCutover && d.pension === 154.77) {
          d.pension = 147.36;
          changed = true;
        }

        // Part B: stale joining-period pro-rated values (all three known fingerprints)
        if (_joiningP && p.num === _joiningP.num && !changed) {
          const _correctPension = parseFloat(
            (getPensionDefault(p) * calcProRateFactor(_member.startDate, p.start, p.cutoff)).toFixed(2)
          );
          const _stale = new Set([71.86, 68.42, 77.39]); // auto-computed old values
          if (_stale.has(d.pension) && d.pension !== _correctPension) {
            d.pension = _correctPension;
            changed = true;
          }
        }

        if (changed) localStorage.setItem(periodKey(p.num), JSON.stringify(d));
      } catch(e) {}
    });
    localStorage.setItem('cea_pension_v882_migrated', '1');
  }
}

// ── ROSTER-AWARE FILL ─────────────────────────────────────────────────────────
// Override cache state, Firestore fetch, and getRosterSuggestion are owned by
// paycalc-roster-suggestions.js. UI updates after the fetch promise resolves
// are handled in onPeriodChange above.

let _adjNegative = false; // tracks intended sign of otherAdj independently of value

/** Formats hours+minutes as a compact string: "7h 30m", "7h", or "30m". */
function fmtH(h, m) {
  if (h && m) return `${h}h ${m}m`;
  if (h)      return `${h}h`;
  return `${m}m`;
}

function updateRosterHint() {
  const card = document.getElementById('rosterHintBar');
  if (!card) return;

  const p = getPeriods().find(x => x.num === currentPeriodNum());
  if (!p) { card.style.display = 'none'; return; }

  const s = getRosterSuggestion(p, getLoggedMember());
  if (!s) { card.style.display = 'none'; return; }

  // State badge
  const badge = document.getElementById('rosterStateBadge');
  if (badge) {
    if (getOverridesFetchState() === 'loaded') {
      badge.textContent  = '✓ Roster + overrides';
      badge.className    = 'roster-state-badge loaded';
    } else if (getOverridesFetchState() === 'checking') {
      badge.textContent  = '↻ Checking…';
      badge.className    = 'roster-state-badge checking';
    } else {
      badge.textContent  = '⚠ Base roster only';
      badge.className    = 'roster-state-badge base-only';
    }
  }

  // Category rows — only render rows that have data
  const rows = document.getElementById('rosterRows');
  if (rows) {
    const cats = [
      { cat: 'sat', icon: '🗓️', label: 'Rostered Sat', h: s.satH, m: s.satM, count: s.satCount, fromOv: s.satFromOv },
      { cat: 'sun', icon: '☀️', label: 'Sunday',       h: s.sunH, m: s.sunM, count: s.sunCount, fromOv: s.sunFromOv },
      { cat: 'bh',   icon: '🏦', label: 'Bank holiday', h: s.bhH,   m: s.bhM,   count: s.bhCount,   fromOv: s.bhFromOv },
      { cat: 'bhOt', icon: '🏦', label: 'BH overtime',  h: s.bhOtH, m: s.bhOtM, count: s.bhOtCount, fromOv: true       },
      { cat: 'ot',   icon: '⏰', label: 'Overtime',     h: s.otH,   m: s.otM,   count: s.otCount,   fromOv: true       },
      { cat: 'rdw',  icon: '💼', label: 'RDW',          h: s.rdwH,  m: s.rdwM,  count: s.rdwCount,  fromOv: true       },
      { cat: 'box', icon: '🎁', label: 'Boxing Day',   h: s.boxH, m: s.boxM, count: s.boxCount, fromOv: s.boxFromOv },
    ].filter(r => r.count > 0);

    rows.innerHTML = cats.map(r => {
      const total  = fmtH(r.h, r.m);
      const dayStr = r.count === 1 ? '1 day' : `${r.count} days`;
      const src    = getOverridesFetchState() === 'loaded'
        ? (r.fromOv ? ' · Override' : ' · Base roster') : '';
      return `<button class="roster-row" type="button" data-cat="${r.cat}" ` +
          `aria-label="Fill ${r.label} hours from roster">` +
        `<span class="roster-row-icon" aria-hidden="true">${r.icon}</span>` +
        `<span class="roster-row-label">${r.label}</span>` +
        `<span class="roster-row-total">${total}</span>` +
        `<span class="roster-row-meta">${dayStr}${src}</span>` +
        `<span class="roster-cat-arrow" aria-hidden="true">→</span>` +
        `</button>`;
    }).join('');
  }

  // Day list visibility — show/hide toggle based on whether there is any data.
  // The list itself is only collapsed on period change (handled in onPeriodChange),
  // so a Firestore refresh does not close an open day list mid-review.
  const dayList    = document.getElementById('rosterDayList');
  const daysToggle = document.getElementById('rosterDaysToggle');
  if (daysToggle) daysToggle.style.display = s.days.length ? '' : 'none';
  renderRosterDayList(s.days);
  card.style.display = '';
}

const _DAY_ABBS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const _MON_ABBS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _DAY_CHIP_LABELS = { sat: 'Rostered Sat', sun: 'Sunday', bh: 'Bank holiday', bhOt: 'BH overtime', ot: 'Overtime', box: 'Boxing Day', rdw: 'RDW' };

/**
 * Show (or hide) a notice when the logged-in member started mid-period,
 * explaining that their contracted hours have been pro-rated.
 * @param {object} p - Current period object.
 */
function updateJoinerNotice(p) {
  const el = document.getElementById('joinerNotice');
  if (!el || !p) return;
  const member = getLoggedMember();
  if (!member?.startDate || member.startDate <= p.start) { el.style.display = 'none'; return; }
  if (member.startDate > p.cutoff) { el.style.display = 'none'; return; }
  const msPerDay     = 86400000;
  const daysEmployed = Math.round((p.cutoff - member.startDate) / msPerDay) + 1;
  const totalDays    = Math.round((p.cutoff - p.start) / msPerDay) + 1;
  const proRated     = getEffectiveContr(p);
  const base         = getContr();
  const startFmt     = member.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  el.textContent = `📅 You joined on ${startFmt}. For this period: contracted hours ${proRated} of ${base}, London Allowance and pension contribution scaled to ${daysEmployed} of ${totalDays} days.`;
  el.style.display = '';
}

/** Populates the collapsible day list with the individual shifts behind the suggestion. */
function renderRosterDayList(days) {
  const list = document.getElementById('rosterDayList');
  if (!list) return;
  if (!days || !days.length) { list.innerHTML = ''; return; }

  list.innerHTML = days.map(d => {
    const dt      = d.date;
    const dateStr = `${_DAY_ABBS[dt.getDay()]} ${dt.getDate()} ${_MON_ABBS[dt.getMonth()]}`;
    const chipLabel = _DAY_CHIP_LABELS[d.type] || '';
    return `<div class="roster-day-row">` +
      `<span class="roster-day-date">${dateStr}</span>` +
      `<span class="roster-day-shift">${escapeHtml(d.shift)}</span>` +
      (chipLabel ? `<span class="roster-day-chip roster-day-chip--${d.type}">${chipLabel}</span>` : '') +
      `</div>`;
  }).join('');
}

/** Toggles the day list open/closed. */
function toggleRosterDays() {
  const list = document.getElementById('rosterDayList');
  const btn  = document.getElementById('rosterDaysToggle');
  if (!list || !btn) return;
  const opening = list.style.display === 'none';
  list.style.display = opening ? '' : 'none';
  btn.textContent    = opening ? 'Hide days ▲' : 'Show days ▼';
}

/** Fills a single H/M field pair if currently blank. */
function _suggestIfBlank(hId, mId, hVal, mVal) {
  const elH = document.getElementById(hId);
  const elM = document.getElementById(mId);
  if (!elH || !elM) return;
  // Skip only if the field has a manually-entered value (gold class already removed).
  // Fields that are blank, or still gold from a previous fill, are safe to overwrite.
  const hEdited = elH.value !== '' && !elH.classList.contains('roster-suggested');
  const mEdited = elM.value !== '' && !elM.classList.contains('roster-suggested');
  if (hEdited || mEdited) return;
  if (hVal == null && mVal == null) return;
  elH.value = hVal ?? '';
  elM.value = mVal ?? '';
  elH.classList.add('roster-suggested');
  elM.classList.add('roster-suggested');
}

/** Fills only the named category's hours from the current roster suggestion. */
function fillCategoryFromRoster(cat) {
  const p = getPeriods().find(x => x.num === currentPeriodNum());
  if (!p) return;
  const s = getRosterSuggestion(p, getLoggedMember());
  if (!s) return;
  const map = {
    sat:  ['satH',  'satM',  s.satH,  s.satM  ],
    sun:  ['sunH',  'sunM',  s.sunH,  s.sunM  ],
    bh:   ['bhH',   'bhM',   s.bhH,   s.bhM   ],
    bhOt: ['bhOtH', 'bhOtM', s.bhOtH, s.bhOtM ],
    ot:   ['otH',   'otM',   s.otH,   s.otM   ],
    rdw:  ['rdwH',  'rdwM',  s.rdwH,  s.rdwM  ],
    box:  ['boxH',  'boxM',  s.boxH,  s.boxM  ],
  };
  const args = map[cat];
  if (args) { _suggestIfBlank(...args); autosave(); }
}

/** Applies a suggestion object to all H/M field pairs.
 *  force=false (default): skips fields already manually entered.
 *  force=true: overwrites all fields — used by the "Fill from roster" button. */
function _applyRosterSuggestion(s, force = false) {
  const pairs = [
    ['satH',  'satM',  s.satH,  s.satM ],
    ['sunH',  'sunM',  s.sunH,  s.sunM ],
    ['bhH',   'bhM',   s.bhH,   s.bhM  ],
    ['bhOtH', 'bhOtM', s.bhOtH, s.bhOtM],
    ['otH',   'otM',   s.otH,   s.otM  ],
    ['rdwH',  'rdwM',  s.rdwH,  s.rdwM ],
    ['boxH',  'boxM',  s.boxH,  s.boxM ],
  ];
  for (const [hId, mId, hVal, mVal] of pairs) {
    if (force) {
      const elH = document.getElementById(hId);
      const elM = document.getElementById(mId);
      if (!elH || !elM) continue;
      if (hVal == null && mVal == null) continue;
      elH.value = hVal ?? '';
      elM.value = mVal ?? '';
      elH.classList.add('roster-suggested');
      elM.classList.add('roster-suggested');
    } else {
      _suggestIfBlank(hId, mId, hVal, mVal);
    }
  }
}

/** Fills ALL categories from the current roster suggestion, overwriting existing values. */
function fillFromRoster() {
  const p = getPeriods().find(x => x.num === currentPeriodNum());
  if (!p) return;
  const s = getRosterSuggestion(p, getLoggedMember());
  if (!s) return;
  _applyRosterSuggestion(s, true);
  autosave();
  // Brief confirmation — tap Clear all entries to undo
  const hint = document.getElementById('rosterHintText');
  if (hint) {
    const prev = hint.textContent;
    hint.textContent = '✓ Filled — tap "Clear all entries" to undo';
    setTimeout(() => { hint.textContent = prev; }, 3000);
  }
}

// ── CALCULATION ENGINE ────────────────────────────────────────────────────────
function updateBadges(rate) {
  const f = (r, mult) => `${mult}×  ·  £${(rate * r).toFixed(2)}/hr`;
  document.getElementById('badge-sat').textContent = f(1.25, '1.25');
  document.getElementById('badge-bh').textContent   = f(1.25, '1.25');
  document.getElementById('badge-bhot').textContent = f(1.25, '1.25');
  document.getElementById('badge-ot').textContent   = f(1.25, '1.25');
  document.getElementById('badge-rdw').textContent = f(1.25, '1.25');
  document.getElementById('badge-sun').textContent = f(1.50, '1.5');
  document.getElementById('badge-box').textContent = f(3.00, '3');
}

function calculate() {
  // Resolve thresholds for the selected period's tax year
  const _pNum   = currentPeriodNum();
  const _curP   = getPeriods().find(x => x.num === _pNum);
  const _ty     = _curP ? getTaxYearForOffset(_curP.num - 48) : CONFIG.TAX_YEARS[0];
  const thresholds = getThresholds(_ty.label);
  const _proRateFactor = getProRateFactor(_curP);
  const LONDON = (_curP ? getLondonAllowanceForPeriod(_curP, _ty) : _ty.londonAllow) * _proRateFactor;

  const _calcGrade = localStorage.getItem(SK.grade);
  const _calcDefaultRate = GRADES[_calcGrade]?.rate ?? GRADES.cea.rate;
  const rate = numVal('hourlyRate') || _calcDefaultRate;
  updateBadges(rate);
  const r125 = rate * 1.25;
  const r150 = rate * 1.50;
  const r300 = rate * 3.00;
  const peer = +document.getElementById('peerVal').textContent;

  const satHrs  = hhmmDec('satH',  'satM');
  // Guard: only count BH/Boxing hours if this period actually contains those days.
  // localStorage can restore saved values into hidden rows, so we must sanitise here
  // rather than relying solely on the DOM row being hidden.
  const bhHrs   = hasBankHoliday(_curP) ? hhmmDec('bhH',   'bhM')   : 0;
  const bhOtHrs = hasBankHoliday(_curP) ? hhmmDec('bhOtH', 'bhOtM') : 0;
  const oHrs    = hhmmDec('otH',   'otM');
  const rHrs    = hhmmDec('rdwH',  'rdwM');
  const sHrs    = hhmmDec('sunH',  'sunM');
  const bHrs    = hasBoxingDay(_curP)   ? hhmmDec('boxH',  'boxM')   : 0;

  const _effContr = getEffectiveContr(_curP);
  const otherAdj  = parseFloat(document.getElementById('otherAdj').value) || 0;

  // Pure gross calculation — all DOM reads done; no more DOM access until UI writes below
  const { gross, satCapped, normHrs, bhCapped, nonBhNorm,
          gBasicNorm, gBasicSat, gBankHol, gBhOt, gOvertime,
          gRdw, gSunday, gBoxing, gPeer } = computeGross({
    effContr: _effContr, rate, satHrs, bhHrs, bhOtHrs, oHrs, rHrs, sHrs, bHrs,
    peerDays: peer, otherAdj, london: LONDON,
  });

  // Pension — salary sacrifice: deducted from gross before tax and NI are calculated.
  const pension    = numVal('pensionAmt');
  const pensionWarn = document.getElementById('pensionWarn');
  if (pensionWarn) pensionWarn.classList.toggle('show', pension > gross && pension > 0);
  const sacGross   = Math.max(0, gross - pension);

  // Income tax — cumulative PAYE when YTD figures provided (W1/M1/X excluded)
  const ytdP = numVal('ytdPay');
  const ytdT = numVal('ytdTax');
  const periodN = _curP ? (_curP.num - 48) - _ty.first + 1 : null;
  const { tax, usingCumulative } = computeTax(
    sacGross, document.getElementById('taxCode').value, thresholds,
    { ytdPay: ytdP, ytdTax: ytdT, periodN },
  );

  // NI and Student Loan (both on sacGross — salary sacrifice reduces all three bases)
  const ni = computeNI(sacGross, thresholds.ni);

  const plan   = document.getElementById('studentLoan').value;
  const slSkip = document.getElementById('slSkipCheck').checked;
  document.getElementById('slSkipRow').classList.toggle('hidden', plan === 'none');
  const sl = computeSL(sacGross, plan, thresholds.sl, slSkip);

  const net = sacGross - tax - ni - sl;

  // UI
  document.getElementById('netDisplay').textContent = fmt(net);
  document.getElementById('pensionRef').textContent = pension.toFixed(2);
  document.getElementById('payslipNote').style.display = 'block';
  document.getElementById('absenceCaveat').style.display = 'block';

  document.getElementById('summary').innerHTML = `
    <div class="sum-row sum-gross"><span class="lbl">Total pay</span><span class="val">${fmt(gross)}</span></div>
    ${pension > 0 ? `<div class="sum-row sum-ded"><span class="lbl">Pension contribution</span><span class="val">−${fmt(pension)}</span></div>` : ''}
    ${pension > 0 ? `<div class="sum-row sum-gross"><span class="lbl">Pay after pension deduction</span><span class="val">${fmt(sacGross)}</span></div>` : ''}
    <div class="sum-row sum-ded"><span class="lbl">Income Tax${usingCumulative ? ' <span style="font-size:10px;font-weight:400;color:var(--text-faint);margin-left:4px">adjusted from payslip</span>' : ''}</span><span class="val">−${fmt(tax)}</span></div>
    <div class="sum-row sum-ded"><span class="lbl">National Insurance</span><span class="val">−${fmt(ni)}</span></div>
    ${sl > 0 ? `<div class="sum-row sum-ded"><span class="lbl">Student Loan</span><span class="val">−${fmt(sl)}</span></div>` : ''}
    <div class="sum-row sum-net"><span class="lbl">Estimated take-home pay</span><span class="val">${fmt(net)}</span></div>
  `;

  const fh = h => {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`;
  };
  let bd = '';
  bd += `<div class="bd-row"><span class="b-lbl">Basic pay — Mon–Fri (${fh(nonBhNorm)} × ${fmt(rate)})</span><span class="b-val">${fmt(gBasicNorm)}</span></div>`;
  if (satCapped > 0)
    bd += `<div class="bd-row"><span class="b-lbl">Basic pay — Saturday (${fh(satCapped)} × ${fmt(r125)})</span><span class="b-val">${fmt(gBasicSat)}</span></div>`;
  if (bhCapped > 0)
    bd += `<div class="bd-row"><span class="b-lbl">Bank Holiday Rostered (${fh(bhCapped)} × ${fmt(r125)})</span><span class="b-val">${fmt(gBankHol)}</span></div>`;
  if (bhOtHrs > 0)
    bd += `<div class="bd-row"><span class="b-lbl">Bank Holiday RDW (${fh(bhOtHrs)} × ${fmt(r125)})</span><span class="b-val">${fmt(gBhOt)}</span></div>`;
  if (oHrs > 0)
    bd += `<div class="bd-row"><span class="b-lbl">Overtime (${fh(oHrs)} × ${fmt(r125)})</span><span class="b-val">${fmt(gOvertime)}</span></div>`;
  if (rHrs > 0)
    bd += `<div class="bd-row"><span class="b-lbl">Rest Day Working (${fh(rHrs)} × ${fmt(r125)})</span><span class="b-val">${fmt(gRdw)}</span></div>`;
  if (sHrs > 0)
    bd += `<div class="bd-row"><span class="b-lbl">Sunday Working (${fh(sHrs)} × ${fmt(r150)})</span><span class="b-val">${fmt(gSunday)}</span></div>`;
  if (bHrs > 0)
    bd += `<div class="bd-row"><span class="b-lbl">Boxing Day Working (${fh(bHrs)} × ${fmt(r300)})</span><span class="b-val">${fmt(gBoxing)}</span></div>`;
  if (peer > 0)
    bd += `<div class="bd-row"><span class="b-lbl">Training Days (${peer} day${peer>1?'s':''} × 2h × ${fmt(rate)})</span><span class="b-val">${fmt(gPeer)}</span></div>`;
  bd += `<div class="bd-row"><span class="b-lbl">London Allowance</span><span class="b-val">${fmt(LONDON)}</span></div>`;
  if (otherAdj !== 0)
    bd += `<div class="bd-row"><span class="b-lbl">Other payroll adjustment</span><span class="b-val">${otherAdj >= 0 ? '+' : ''}${fmt(otherAdj)}</span></div>`;
  if (slSkip && plan !== 'none')
    bd += `<div class="bd-row"><span class="b-lbl" style="font-style:italic;color:var(--text-faint)">Student loan not deducted this period</span><span class="b-val"></span></div>`;
  if (usingCumulative)
    bd += `<div class="bd-row"><span class="b-lbl" style="font-style:italic;color:var(--text-faint)">Tax adjusted using Year to Date figures from your last payslip</span><span class="b-val"></span></div>`;
  document.getElementById('bdBody').innerHTML = bd;

  // ── G. Miller actual payslip override ──────────────────────────────────────
  // If the logged-in member is G. Miller and this period has hardcoded payslip
  // data, replace the estimate display with the actual figures. The breakdown
  // section below still shows the estimate so the comparison is visible.
  const _actualKey  = _curP ? formatISO(_curP.payday) : null;
  const _actual     = _actualKey && getLoggedMember()?.name === 'G. Miller'
    ? MILLER_ACTUALS[_actualKey] : null;
  const _netLabel   = document.getElementById('netLabel');

  if (_actual) {
    if (_netLabel) _netLabel.textContent = '✅ Your Actual Take-Home Pay';
    document.getElementById('netDisplay').textContent = fmt(_actual.net);
    document.getElementById('payslipNote').style.display   = 'none';
    document.getElementById('absenceCaveat').style.display = 'none';
    document.getElementById('summary').innerHTML = `
      <div class="sum-row sum-gross"><span class="lbl">Total pay</span><span class="val">${fmt(_actual.gross)}</span></div>
      <div class="sum-row sum-ded"><span class="lbl">Income Tax</span><span class="val">−${fmt(_actual.tax)}</span></div>
      <div class="sum-row sum-ded"><span class="lbl">National Insurance</span><span class="val">−${fmt(_actual.ni)}</span></div>
      ${_actual.sl > 0 ? `<div class="sum-row sum-ded"><span class="lbl">Student Loan</span><span class="val">−${fmt(_actual.sl)}</span></div>` : ''}
      <div class="sum-row sum-net"><span class="lbl">Actual take-home</span><span class="val">${fmt(_actual.net)}</span></div>
      <div class="sum-row" style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px;font-size:var(--type-small);color:var(--text-faint)">
        <span class="lbl">Calculator estimate</span><span class="val">${fmt(net)}</span>
      </div>
    `;
    document.getElementById('bdBtn').innerHTML =
      `Compare with estimate &nbsp;<span class="bd-arrow">▼</span>`;
    const _peekBtn = document.getElementById('resultPeekBtn');
    if (_peekBtn) _peekBtn.textContent = `↑ Actual take-home: ${fmt(_actual.net)}`;
    const _stickyAmt = document.getElementById('stickyAmount');
    if (_stickyAmt) _stickyAmt.textContent = fmt(_actual.net);
  } else {
    if (_netLabel) _netLabel.textContent = '💷 Estimated Take-Home Pay';
    const _peekBtn = document.getElementById('resultPeekBtn');
    if (_peekBtn) _peekBtn.textContent = `↑ Estimated take-home: ${fmt(net)}`;
    const _stickyAmt = document.getElementById('stickyAmount');
    if (_stickyAmt) _stickyAmt.textContent = fmt(net);
    document.getElementById('bdBtn').innerHTML =
      `Full pay breakdown &nbsp;<span class="bd-arrow">▼</span>`;
  }

  calcHPP();
}

// ── HPP ESTIMATOR ─────────────────────────────────────────────────────────────
// Formula from Chiltern payroll (Marie Firby):
// (Gross - Basic) × 4/52 = HPP

// Compute variable pay for one period from saved data. Used by calcHPP and
// updatePriorHpp to avoid duplicating the capping and London Allowance logic.
// bhCapped mirrors calculate(): when all contracted hours are Saturday, bhCapped = 0
// and the BH premium must not contribute to HPP (it wasn't in that period's gross).
function _varPayForPeriod(p, d, rate) {
  const r125      = rate * 1.25, r150 = rate * 1.50, r300 = rate * 3.00;
  const satHrs    = (d.satH  || 0) + (d.satM  || 0) / 60;
  const bhHrs     = (d.bhH   || 0) + (d.bhM   || 0) / 60;
  const bhOtHrs   = (d.bhOtH || 0) + (d.bhOtM || 0) / 60;
  const otHrs     = (d.otH   || 0) + (d.otM   || 0) / 60;
  const rdwHrs    = (d.rdwH  || 0) + (d.rdwM  || 0) / 60;
  const sunHrs    = (d.sunH  || 0) + (d.sunM  || 0) / 60;
  const boxHrs    = (d.boxH  || 0) + (d.boxM  || 0) / 60;
  const effContr  = getEffectiveContr(p);
  const satCapped = Math.min(satHrs, effContr);
  const normHrs   = effContr - satCapped;
  const bhCapped  = Math.min(bhHrs, normHrs);
  const pTy       = getTaxYearForOffset(p.num - 48);
  const pLondon   = getLondonAllowanceForPeriod(p, pTy) * getProRateFactor(p);
  return satCapped * (rate * 0.25) +
         bhCapped  * (rate * 0.25) +
         bhOtHrs   * r125          +
         otHrs     * r125          +
         rdwHrs    * r125          +
         sunHrs    * r150          +
         boxHrs    * r300          +
         pLondon;
}
// Variable pay includes: OT, RDW, Sunday, Boxing Day, Saturday uplift, London Allowance
// Does NOT include: peer training, basic pay, expenses, bonuses
function calcHPP() {
  const _hppGrade       = localStorage.getItem(SK.grade);
  const _hppDefaultRate = GRADES[_hppGrade]?.rate ?? GRADES.cea.rate;
  const rate       = numVal('hourlyRate') || _hppDefaultRate;
  const allPeriods = getPeriods();

  // HPP accumulates only within the selected period's tax year
  const pNum    = currentPeriodNum();
  const curP    = allPeriods.find(x => x.num === pNum);
  const ty      = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  const periods = allPeriods.filter(p => {
    const o = p.num - 48;
    return o >= ty.first && o <= ty.last;
  });

  let totalVar    = 0;
  let pCount      = 0;
  let usingActuals = false;

  periods.forEach(p => {
    try {
      // G. Miller: use hardcoded payslip varPay when available
      const _hppActualKey = formatISO(p.payday);
      const _hppActual = getLoggedMember()?.name === 'G. Miller'
        ? MILLER_ACTUALS[_hppActualKey] : null;
      if (_hppActual?.varPay != null) {
        totalVar += _hppActual.varPay;
        pCount++;
        usingActuals = true;
        return;
      }

      const raw = localStorage.getItem(periodKey(p.num));
      if (!raw) return;
      const d = JSON.parse(raw);
      if (isDataEmpty(d)) return;
      pCount++;
      totalVar += _varPayForPeriod(p, d, rate);
    } catch(e) {}
  });

  const hpp      = totalVar * HPP_FRACTION;
  const amountEl = document.getElementById('hppAmount');
  const basisEl  = document.getElementById('hppBasis');
  const labelEl  = document.getElementById('hppLabel');

  // Persist the running estimate so it survives when the user moves to the next tax year.
  // The prior year section reads this key to show the carry-forward amount.
  if (hpp > 0) localStorage.setItem(hppEstKey(ty), hpp.toFixed(2));

  // Current year always shows the estimate (the confirmed actual lives in the prior year section
  // once the user has moved to the following tax year).
  if (pCount === 0) {
    if (labelEl) labelEl.textContent = `Estimated ${ty.label} Holiday Pay Premium`;
    amountEl.textContent = '£–';
    basisEl.textContent  = 'Enter hours across your periods above to calculate';
  } else {
    if (labelEl) labelEl.textContent = `Estimated ${ty.label} Holiday Pay Premium`;
    amountEl.textContent = fmt(hpp);
    basisEl.textContent  = usingActuals
      ? `All ${pCount} periods of ${ty.label} · ${fmt(totalVar)} extra pay × 7.69% · from your payslips · due January ${ty.hppPaidJan}`
      : `${pCount} period${pCount > 1 ? 's' : ''} of ${ty.label} · ${fmt(totalVar)} extra pay × 7.69% · due January ${ty.hppPaidJan}`;
  }

  // Dynamic formula note
  const noteEl = document.getElementById('hppNote');
  if (noteEl) {
    noteEl.innerHTML = `<strong>How it's calculated (confirmed by Chiltern payroll):</strong> All extra pay above your basic hours (overtime, rest day working, Sundays, and London Allowance) × 7.69%. Basic pay, peer training, expenses and bonuses are not included. This estimate covers the <strong>tax year ${ty.label}</strong> — Chiltern will pay it in <strong>January ${ty.hppPaidJan}</strong>. It's reduced proportionally if you weren't employed for the full year.`;
  }

  // Update the prior year section (shows the previous tax year's HPP carry-forward)
  updatePriorHpp(ty);
}

// ── PRIOR YEAR HPP SECTION ───────────────────────────────────────────────────
// Shows the previous tax year's HPP estimate (or confirmed actual) in the HPP card.
// Called at the end of calcHPP() so it refreshes whenever the main calculation runs.
function updatePriorHpp(ty) {
  const section = document.getElementById('priorHppSection');
  if (!section) return;

  const tyIdx = CONFIG.TAX_YEARS.findIndex(t => t.label === ty.label);
  if (tyIdx <= 0) {
    section.classList.add('hidden');
    return;
  }

  const priorTy   = CONFIG.TAX_YEARS[tyIdx - 1];
  const estRaw    = localStorage.getItem(hppEstKey(priorTy));
  const actualRaw = localStorage.getItem(hppActualKey(priorTy));
  let   est       = estRaw    ? parseFloat(estRaw)    : 0;
  const actual    = actualRaw ? parseFloat(actualRaw) : 0;

  // If no stored estimate yet, compute it on the fly so the prior-year HPP
  // section is populated on first login even before the user has visited a
  // prior-year period. G. Miller uses payslip varPay; everyone else reads
  // whatever period data they have entered in localStorage.
  if (est === 0 && !actual) {
    const _priorPeriods = getPeriods().filter(p => {
      const o = p.num - 48;
      return o >= priorTy.first && o <= priorTy.last;
    });

    // G. Miller: derive from hardcoded payslip varPay figures
    if (getLoggedMember()?.name === 'G. Miller') {
      const _priorVar = _priorPeriods.reduce((sum, p) => {
        const a = MILLER_ACTUALS[formatISO(p.payday)];
        return a?.varPay != null ? sum + a.varPay : sum;
      }, 0);
      if (_priorVar > 0) est = _priorVar * HPP_FRACTION;

    } else {
      // Everyone else: sum variable pay from localStorage period entries
      const _hppGrade = localStorage.getItem(SK.grade);
      const rate = GRADES[_hppGrade]?.rate ?? GRADES.cea.rate;
      let _priorVar = 0;
      _priorPeriods.forEach(p => {
        try {
          const raw = localStorage.getItem(periodKey(p.num));
          if (!raw) return;
          const d = JSON.parse(raw);
          if (isDataEmpty(d)) return;
          _priorVar += _varPayForPeriod(p, d, rate);
        } catch(e) {}
      });
      if (_priorVar > 0) est = _priorVar * HPP_FRACTION;
    }

    if (est > 0) localStorage.setItem(hppEstKey(priorTy), est.toFixed(2));
  }

  // Is the current period's payday in the January when prior-year HPP is paid?
  const pNum = currentPeriodNum();
  const curP = getPeriods().find(x => x.num === pNum);
  const isJanPayday = curP &&
    curP.payday.getFullYear() === priorTy.hppPaidJan &&
    curP.payday.getMonth() === 0;

  document.getElementById('priorHppTitle').textContent      = `${priorTy.label} Holiday Pay Premium`;
  document.getElementById('currentHppTitle').textContent    = `This year (${ty.label})`;

  const dueBadge = document.getElementById('priorHppDueBadge');
  dueBadge.classList.toggle('hidden', !isJanPayday || actual > 0);

  const amtLabel = document.getElementById('priorHppAmtLabel');
  const amtEl    = document.getElementById('priorHppAmt');
  const basisEl  = document.getElementById('priorHppBasis');

  if (actual > 0) {
    amtLabel.innerHTML  = `${priorTy.label} HPP <span class="actual-badge">✓ Confirmed</span>`;
    amtEl.textContent   = fmt(actual);
    basisEl.textContent = `Confirmed from your January ${priorTy.hppPaidJan} payslip`;
  } else if (est > 0) {
    amtLabel.textContent = isJanPayday ? 'Expected on this payslip' : 'Estimated';
    amtEl.textContent    = fmt(est);
    basisEl.textContent  = isJanPayday
      ? `Check your January ${priorTy.hppPaidJan} payslip and enter the confirmed amount below`
      : `Estimated from your ${priorTy.label} periods · due January ${priorTy.hppPaidJan}`;
  } else {
    amtLabel.textContent = 'Estimated';
    amtEl.textContent    = '£–';
    basisEl.textContent  = `No ${priorTy.label} variable pay recorded — check your January ${priorTy.hppPaidJan} payslip`;
  }

  // Load stored actual into the input — only update if it differs to avoid disrupting typing
  const input = document.getElementById('priorHppActualInput');
  if (input) {
    const stored = actualRaw || '';
    if (document.activeElement !== input) input.value = stored;
  }

  section.classList.remove('hidden');
}

// ── CARD COLLAPSE TOGGLES ─────────────────────────────────────────────────────
function toggleSettingsCard() {
  document.getElementById('settingsToggle').classList.toggle('open');
  document.getElementById('settingsBody').classList.toggle('open');
}

function togglePayslipCard() {
  document.getElementById('payslipCardToggle').classList.toggle('open');
  document.getElementById('payslipCardBody').classList.toggle('open');
}

function toggleHppCard() {
  document.getElementById('hppCardToggle').classList.toggle('open');
  document.getElementById('hppCardBody').classList.toggle('open');
}

function toggleBackPayCard() {
  const toggle = document.getElementById('backPayCardToggle');
  const body   = document.getElementById('backPayBody');
  const opening = !body.classList.contains('open');
  toggle.classList.toggle('open');
  body.classList.toggle('open');
  if (opening) {
    // Pre-fill London Allowance — old = pre-award rate, new = current rate
    const pNum = currentPeriodNum();
    const curP = getPeriods().find(x => x.num === pNum);
    const ty   = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
    const oldLondonEl = document.getElementById('oldLondon');
    const newLondonEl = document.getElementById('newLondon');
    if (!oldLondonEl.value && ty.londonAllowPre) oldLondonEl.value = ty.londonAllowPre.toFixed(2);
    if (!newLondonEl.value)                      newLondonEl.value = ty.londonAllow.toFixed(2);
    // Auto-select April — Chiltern's pay anniversary is always 1 April
    const fromSel = document.getElementById('backPayFrom');
    if (fromSel && !fromSel.value) fromSel.value = 48 + ty.first;
    calcBackPay();
  }
}

// ── BACK PAY CALCULATOR ───────────────────────────────────────────────────────

function calcBackPay() {
  const oldRate   = parseFloat(document.getElementById('oldRate').value);
  const newRate   = parseFloat(document.getElementById('newRateInput').value);
  const oldLondon = parseFloat(document.getElementById('oldLondon').value);
  const newLondon = parseFloat(document.getElementById('newLondon').value);
  const rowsEl       = document.getElementById('backPayRows');
  const totalEl      = document.getElementById('backPayTotal');
  const totalAmtEl   = document.getElementById('backPayTotalAmt');
  const totalBasEl   = document.getElementById('backPayTotalBasis');
  const noticeEl     = document.getElementById('backPayNotice');
  const breakdownBtn = document.getElementById('bpBreakdownBtn');

  const fromPNum  = +(document.getElementById('backPayFrom')?.value || 0);
  const bpSel     = document.getElementById('backPayPeriod');
  const bpPNum    = bpSel ? +bpSel.value : 0; // "paid in" period — also the cap
  const bpP       = bpPNum ? getPeriods().find(x => x.num === bpPNum) : null;
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
    return;
  }

  const rateDiff   = hasRate   ? newRate   - oldRate   : 0;
  const londonDiff = hasLondon ? newLondon - oldLondon : 0;
  const periods    = getPeriods();
  let rows         = '';
  let grandTotal   = 0;
  let pCount       = 0;

  periods.forEach(p => {
    try {
      if (fromPNum && p.num < fromPNum) return; // exclude before April
      if (bpPNum   && p.num > bpPNum)  return; // exclude after "paid in" period
      const raw = localStorage.getItem(periodKey(p.num));
      if (!raw) return;
      const d = JSON.parse(raw);
      if (isDataEmpty(d)) return;

      const satHrs  = (d.satH  || 0) + (d.satM  || 0) / 60;
      const bhHrs   = (d.bhH   || 0) + (d.bhM   || 0) / 60;
      const bhOtHrs = (d.bhOtH || 0) + (d.bhOtM || 0) / 60;
      const otHrs   = (d.otH   || 0) + (d.otM   || 0) / 60;
      const rdwHrs  = (d.rdwH  || 0) + (d.rdwM  || 0) / 60;
      const sunHrs  = (d.sunH  || 0) + (d.sunM  || 0) / 60;
      const boxHrs  = (d.boxH  || 0) + (d.boxM  || 0) / 60;
      // Cap sat/BH hours as calculate() does — back-pay must reflect actual gross paid.
      // Use getEffectiveContr so joining periods use pro-rated hours.
      const _bpEffContr = getEffectiveContr(p);
      const satCapped = Math.min(satHrs, _bpEffContr);
      const normHrsBP = _bpEffContr - satCapped;
      const bhCapped  = Math.min(bhHrs, normHrsBP);

      const ratePay =
        _bpEffContr    * rateDiff        +
        satCapped * rateDiff * 0.25 +
        bhCapped  * rateDiff * 0.25 +
        bhOtHrs   * rateDiff * 1.25 +
        otHrs    * rateDiff * 1.25 +
        rdwHrs   * rateDiff * 1.25 +
        sunHrs   * rateDiff * 1.50 +
        boxHrs   * rateDiff * 3.00 +
        (d.peer || 0) * 2 * rateDiff;

      const backPay = ratePay + londonDiff;

      if (backPay > 0) {
        grandTotal += backPay;
        pCount++;
        rows += `<div class="bp-row">
          <span class="bp-lbl">P${p.num} · ${fd(p.payday)}</span>
          <span class="bp-val">${fmt(backPay)}</span>
        </div>`;
      }
    } catch(e) {}
  });

  if (grandTotal > 0) {
    // Total headline
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

    // "Paid in" period selector
    if (periodWrap) periodWrap.style.display = 'block';

    // Tax caution
    noticeEl.style.display = 'block';
    if (bpP) {
      const payLong = bpP.payday.toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London'
      });
      noticeEl.innerHTML = `⚠️ This lump sum will appear on your <strong>P${bpP.num} payslip (paid ${payLong})</strong>. It is taxed in full in that period — if it pushes your income over a tax band threshold, you may receive less than the gross figure shown.`;
    } else {
      noticeEl.textContent = '⚠️ This lump sum is taxed in the period it is paid. Select a period above to see a specific warning. If it pushes your income over a tax band threshold that month, you may receive less than the gross figure shown.';
    }

    // Apply new rate button — shown once rates are confirmed
    if (applyWrap && applyBtn && hasRate) {
      const currentRate = numVal('hourlyRate');
      const alreadyApplied = Math.abs(currentRate - newRate) < 0.001;
      applyBtn.textContent = alreadyApplied
        ? `✓ New rate already applied — £${newRate.toFixed(2)}/hr`
        : `Apply new rate to settings — £${newRate.toFixed(2)}/hr →`;
      applyBtn.disabled = alreadyApplied;
      applyWrap.style.display = 'block';
    } else if (applyWrap) {
      applyWrap.style.display = 'none';
    }

    // Per-period breakdown
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
}

function toggleBpBreakdown() {
  document.getElementById('bpBreakdownBtn').classList.toggle('open');
  document.getElementById('backPayRows').classList.toggle('open');
}

function applyNewRate() {
  const newRate = parseFloat(document.getElementById('newRateInput').value);
  if (!newRate) return;
  document.getElementById('hourlyRate').value = newRate.toFixed(2);
  saveSettings();
  calculate();
  // Update button state to reflect it's been applied
  const btn = document.getElementById('applyRateBtn');
  const fb  = document.getElementById('applyRateFeedback');
  if (btn) { btn.textContent = `✓ New rate already applied — £${newRate.toFixed(2)}/hr`; btn.disabled = true; }
  if (fb)  { fb.textContent  = 'Settings updated — all future periods will now calculate at the new rate.'; }
}

// ── HPP FORMULA NOTE TOGGLE ───────────────────────────────────────────────────
// ── HOURS SHOW MORE TOGGLE ────────────────────────────────────────────────────
function toggleHoursExtra() {
  const btn  = document.getElementById('hoursShowMore');
  const body = document.getElementById('hoursExtra');
  const open = body.classList.toggle('open');
  btn.classList.toggle('open', open);
  btn.querySelector('.show-more-arrow').textContent = open ? '▲' : '▼';
  document.getElementById('hoursShowMoreLabel').textContent = open
    ? 'Hide adjustments'
    : 'Other adjustments';
}

function toggleHppNote() {
  const btn  = document.getElementById('hppToggleBtn');
  const body = document.getElementById('hppNoteBody');
  const open = body.classList.toggle('open');
  btn.classList.toggle('open', open);
  btn.querySelector('.hpp-toggle-arrow').textContent = open ? '▲' : '▼';
  document.getElementById('hppToggleBtnLabel').textContent = open ? 'Hide calculation details ' : 'How is this calculated? ';
}

// ── DISCLAIMER TOGGLE ─────────────────────────────────────────────────────────
function toggleDisclaimer() {
  const extra  = document.getElementById('disclaimerExtra');
  const toggle = document.getElementById('disclaimerToggle');
  const open   = extra.classList.toggle('open');
  toggle.textContent = open ? 'Less ▲' : 'More ▼';
}

// ── PEER STEPPER ──────────────────────────────────────────────────────────────
function stepPeer(delta) {
  const el = document.getElementById('peerVal');
  el.textContent = Math.max(0, Math.min(10, +el.textContent + delta));
  autosave();
}

// ── BREAKDOWN TOGGLE ──────────────────────────────────────────────────────────
function toggleBD() {
  document.getElementById('bdBtn').classList.toggle('open');
  document.getElementById('bdBody').classList.toggle('open');
}

// ── INIT ──────────────────────────────────────────────────────────────────────
loadSettings();
buildPeriodSelect();

// ── EVENT LISTENERS (no inline handlers in HTML — roster-app convention) ──────

// Period navigation
document.getElementById('periodSelect').addEventListener('change', onPeriodChange);
document.getElementById('prevBtn').addEventListener('click', prevPeriod);
document.getElementById('nextBtn').addEventListener('click', nextPeriod);
document.getElementById('clearBtn').addEventListener('click', clearPeriod);

// Result breakdown toggle
document.getElementById('bdBtn').addEventListener('click', toggleBD);

// Roster day list toggle
document.getElementById('rosterDaysToggle').addEventListener('click', toggleRosterDays);

// Hours inputs — Saturday (has validation warn)
document.getElementById('satH').addEventListener('input', () => { onHhMm('satH','satM','satWarn'); autosave(); });
document.getElementById('satM').addEventListener('input', () => { clampMins('satM'); onHhMm('satH','satM','satWarn'); autosave(); });

// Hours inputs — minutes clamp + autosave
['bhH','bhOtH','otH','rdwH','sunH','boxH'].forEach(id => {
  document.getElementById(id).addEventListener('input', autosave);
});
['bhM','bhOtM','otM','rdwM','sunM','boxM'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => { clampMins(id); autosave(); });
});

// Peer training stepper
document.getElementById('peerMinus').addEventListener('click', () => stepPeer(-1));
document.getElementById('peerPlus').addEventListener('click',  () => stepPeer(1));

// Back-pay inputs
['oldRate','newRateInput','oldLondon','newLondon'].forEach(id => {
  document.getElementById(id).addEventListener('input', calcBackPay);
});

// Card collapse toggles
document.getElementById('settingsToggle').addEventListener('click', toggleSettingsCard);
document.getElementById('payslipCardToggle').addEventListener('click', togglePayslipCard);
document.getElementById('hppCardToggle').addEventListener('click', toggleHppCard);
document.getElementById('backPayCardToggle').addEventListener('click', toggleBackPayCard);

// Back-pay inputs + period selectors + apply rate
document.getElementById('bpBreakdownBtn').addEventListener('click', toggleBpBreakdown);
document.getElementById('backPayFrom').addEventListener('change', calcBackPay);
document.getElementById('backPayPeriod').addEventListener('change', calcBackPay);
document.getElementById('applyRateBtn').addEventListener('click', applyNewRate);
document.getElementById('saveSettingsBtn').addEventListener('click', confirmSettings);

// Hours card — show more toggle
document.getElementById('hoursShowMore').addEventListener('click', toggleHoursExtra);

// Result peek — scrolls result card into view
document.getElementById('resultPeekBtn')?.addEventListener('click', () => {
  document.querySelector('.result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Sticky take-home bar — show when result card is off-screen on mobile
(function () {
  const stickyBar  = document.getElementById('stickyTotal');
  const resultCard = document.querySelector('.result-card');
  if (!stickyBar || !resultCard || !('IntersectionObserver' in window)) return;
  // Observe the £ amount display specifically, not the whole card.
  // threshold:0 fires when it fully leaves the viewport; boundingClientRect.top < 0
  // distinguishes "scrolled off the top" from "below the fold on load" (where top is
  // positive and we must not show the bar).
  const netDisplay = document.getElementById('netDisplay') || resultCard;
  const obs = new IntersectionObserver(([entry]) => {
    const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
    stickyBar.classList.toggle('visible', show);
    document.body.classList.toggle('sticky-active', show);
  }, { threshold: 0 });
  obs.observe(netDisplay);
  stickyBar.addEventListener('click', () =>
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' })
  );
  stickyBar.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();

// Roster fill — "Fill blank fields" button + per-category "Fill →" buttons
const _fillBtn = document.getElementById('fillFromRosterBtn');
if (_fillBtn) _fillBtn.addEventListener('click', fillFromRoster);

// Per-category fill buttons are dynamically rendered inside #rosterRows — use delegation
document.getElementById('rosterRows')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-cat]');
  if (btn) fillCategoryFromRoster(btn.dataset.cat);
});

// Remove roster-suggested highlight as soon as the user edits any hours input
document.querySelectorAll('#satH,#satM,#bhH,#bhM,#bhOtH,#bhOtM,#otH,#otM,#sunH,#sunM,#rdwH,#rdwM,#boxH,#boxM').forEach(el => {
  el.addEventListener('input', () => el.classList.remove('roster-suggested'));
});

// Tax year tabs
document.getElementById('tyTab0').addEventListener('click', () => jumpToTaxYear(0));
document.getElementById('tyTab1').addEventListener('click', () => jumpToTaxYear(1));

// Settings inputs
document.getElementById('gradeSelect').addEventListener('change', () => {
  const g = document.getElementById('gradeSelect').value;
  if (g && GRADES[g]) document.getElementById('hourlyRate').value = GRADES[g].rate.toFixed(2);
  saveSettings();
  calculate();
});
document.getElementById('hourlyRate').addEventListener('input',  () => { saveSettings(); calculate(); });
document.getElementById('taxCode').addEventListener('input',     () => { saveSettings(); calculate(); });
document.getElementById('studentLoan').addEventListener('change',() => { saveSettings(); calculate(); });
// pensionAmt: save global default AND lock pension to current period immediately.
// autosave() calls calculate() internally, so no separate calculate() call needed.
document.getElementById('pensionAmt').addEventListener('input',  () => { saveSettings(); autosave(); });

// Per-period overrides
document.getElementById('slSkipCheck').addEventListener('change', autosave);
document.getElementById('otherAdj').addEventListener('input', () => {
  // Sync _adjNegative from what the user typed (but don't reset it when they
  // clear the field — they may have just pressed − to mark intent before typing).
  const v = parseFloat(document.getElementById('otherAdj').value);
  if (v < 0) _adjNegative = true;
  else if (v > 0) _adjNegative = false;
  updateAdjSign();
  autosave();
});
// iOS: tapping adjSignBtn while the number input is focused causes the keyboard
// to dismiss first, which triggers a viewport layout shift that cancels the
// touch-to-click conversion — so 'click' never fires on iOS in that scenario.
// 'touchend' fires before the keyboard dismisses, so the input value is still
// readable. preventDefault() stops iOS from synthesising a duplicate 'click'.
(function () {
  function toggleAdjSign() {
    _adjNegative = !_adjNegative;
    const input = document.getElementById('otherAdj');
    const val   = parseFloat(input.value) || 0;
    // Only negate the value when it is nonzero — when zero, the button marks
    // intent so the next number typed will be shown as negative.
    if (val !== 0) input.value = (Math.abs(val) * (_adjNegative ? -1 : 1)).toFixed(2);
    updateAdjSign();
    autosave();
  }
  const btn = document.getElementById('adjSignBtn');
  let touchFired = false;
  btn.addEventListener('touchend', (e) => { e.preventDefault(); touchFired = true; toggleAdjSign(); });
  btn.addEventListener('click', () => { if (touchFired) { touchFired = false; return; } toggleAdjSign(); });
})();

// Payslip card inputs
document.getElementById('ytdPay').addEventListener('input',    () => { saveSettings(); calculate(); });
document.getElementById('ytdTax').addEventListener('input',    () => { saveSettings(); calculate(); });

// Prior year HPP actual — saves to per-year key and refreshes the prior HPP section display
document.getElementById('priorHppActualInput').addEventListener('input', () => {
  const pNum  = currentPeriodNum();
  const curP  = getPeriods().find(x => x.num === pNum);
  const curTy = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  const tyIdx = CONFIG.TAX_YEARS.findIndex(t => t.label === curTy.label);
  if (tyIdx <= 0) return;
  const priorTy = CONFIG.TAX_YEARS[tyIdx - 1];
  const val = document.getElementById('priorHppActualInput').value;
  if (val) {
    localStorage.setItem(hppActualKey(priorTy), val);
  } else {
    localStorage.removeItem(hppActualKey(priorTy));
  }
  updatePriorHpp(curTy);
});

// HPP formula toggle + disclaimer + back-pay cross-link
document.getElementById('hppToggleBtn').addEventListener('click', toggleHppNote);
document.getElementById('disclaimerToggle').addEventListener('click', toggleDisclaimer);
document.getElementById('hppBackPayLink').addEventListener('click', () => {
  const body = document.getElementById('backPayBody');
  if (!body.classList.contains('open')) toggleBackPayCard();
  document.getElementById('backPayCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ── ABOUT LIGHTBOX ────────────────────────────────────────────────────────────
(function () {
  const lightbox    = document.getElementById('iconLightbox');
  const appIcon     = document.getElementById('appIcon');
  const versionEl   = document.getElementById('lightboxVersion');
  const statusEl    = document.getElementById('lightboxUpdateStatus');
  const closeBtn    = document.getElementById('iconLightboxClose');
  const contentCard = document.getElementById('iconLightboxContent');

  if (!lightbox || !appIcon) return;

  // Bug report link — pre-populated with version and device info
  const bugLink = document.getElementById('bugReportLink');
  if (bugLink) {
    const body = `App: MYB Roster — Pay Calculator
Version: ${APP_VERSION}
Device: ${navigator.userAgent}

--- Describe the bug ---
`;
    bugLink.href = `mailto:${ROSTER_CONFIG.SUPPORT_EMAIL}?subject=${encodeURIComponent(`Bug Report — MYB Pay Calculator v${APP_VERSION}`)}&body=${encodeURIComponent(body)}`;
  }

  if (versionEl) versionEl.textContent = APP_VERSION;

  function checkUpdateStatus() {
    if (statusEl) { statusEl.textContent = '✓ Up to date'; statusEl.className = 'lightbox-status up-to-date'; }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      function activate(w) { w.postMessage({ type: 'SKIP_WAITING' }); }

      if (reg.waiting) activate(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) activate(nw);
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      }, { once: true });

      let updateInterval = setInterval(() => reg.update(), 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          clearInterval(updateInterval);
        } else {
          clearInterval(updateInterval);
          updateInterval = setInterval(() => reg.update(), 60 * 60 * 1000);
        }
      });
    });
  }

  function openLightbox() {
    checkUpdateStatus();
    lightbox.classList.add('visible');
    requestAnimationFrame(() => lightbox.classList.add('open'));
    document.addEventListener('keydown', onKeyDown);
  }
  function closeLightbox() {
    lightbox.classList.remove('open');
    lightbox.addEventListener('transitionend', () => {
      lightbox.classList.remove('visible');
    }, { once: true });
    document.removeEventListener('keydown', onKeyDown);
  }
  function onKeyDown(e) { if (e.key === 'Escape') closeLightbox(); }

  appIcon.addEventListener('click', e => { e.stopPropagation(); openLightbox(); });
  lightbox.addEventListener('click', closeLightbox);
  if (contentCard) contentCard.addEventListener('click', e => e.stopPropagation());
  if (closeBtn)    closeBtn.addEventListener('click', closeLightbox);
})();

// ── HELP LIGHTBOX ─────────────────────────────────────────────────────────────
// Generic lightbox driven by HELP_CONTENT — opened by any .help-btn[data-help].
(function () {
  const lb      = document.getElementById('helpLightbox');
  const content = document.getElementById('helpLightboxContent');
  const titleEl = document.getElementById('helpLightboxTitle');
  const listEl  = document.getElementById('helpLightboxList');
  const closeBtn = document.getElementById('helpLightboxClose');
  if (!lb) return;

  function openHelp(key) {
    const data = HELP_CONTENT[key];
    if (!data) return;
    titleEl.textContent = data.title;
    listEl.innerHTML = data.tips.map(t => `<li>${t}</li>`).join('');
    lb.classList.add('visible');
    requestAnimationFrame(() => lb.classList.add('open'));
    document.addEventListener('keydown', onKey);
  }

  function closeHelp() {
    lb.classList.remove('open');
    lb.addEventListener('transitionend', () => lb.classList.remove('visible'), { once: true });
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) { if (e.key === 'Escape') closeHelp(); }

  lb.addEventListener('click', closeHelp);
  if (content) content.addEventListener('click', e => e.stopPropagation());
  if (closeBtn) closeBtn.addEventListener('click', closeHelp);

  // Wire all ? buttons. stopPropagation prevents collapsible card toggles firing.
  document.querySelectorAll('.help-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openHelp(btn.dataset.help);
    });
  });
})();

// ── SERVICE WORKER REGISTRATION + AUTO-UPDATE TOAST ──────────────────────────
(function () {
  if (!('serviceWorker' in navigator)) return;

  // When a new SW takes control, store the new version and reload once.
  // Guard on navigator.serviceWorker.controller so we don't reload on first install
  // (when there was no previous controller).
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    }, { once: true });
  }

  // Sign-out — clears admin session and returns to the main app.
  // AUTH_KEY matches admin-app.js so the same session is cleared.
  document.getElementById('signOutBtn').addEventListener('click', () => {
    localStorage.removeItem('myb_admin_session');
    window.location.href = './index.html';
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(() => {})
      .catch(err => console.error('SW registration failed:', err));
  });
})();

// ── WELCOME LIGHTBOX ──────────────────────────────────────────────────────────
// Shown once, on the very first visit to the pay calculator. Never shown again.
// Dismissed by the ✕ button or clicking the overlay; guide link also dismisses it.
(function () {
  const WELCOME_KEY = 'cea_pay_welcome_shown';
  const lb       = document.getElementById('welcomeLightbox');
  const content  = document.getElementById('welcomeLightboxContent');
  const closeBtn = document.getElementById('welcomeLightboxClose');
  const guideLink = lb && lb.querySelector('.welcome-guide-link');
  if (!lb) return;

  function openWelcome() {
    const badge = document.getElementById('welcomeGradeBadge');
    if (badge) {
      const g = localStorage.getItem(SK.grade);
      badge.textContent = (g && GRADES[g] ? GRADES[g].label : 'CEA & CES') + ' grade';
    }
    lb.classList.add('visible');
    requestAnimationFrame(() => lb.classList.add('open'));
    document.addEventListener('keydown', onKeyDown);
  }

  function closeWelcome() {
    localStorage.setItem(WELCOME_KEY, '1');
    lb.classList.remove('open');
    lb.addEventListener('transitionend', () => lb.classList.remove('visible'), { once: true });
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) { if (e.key === 'Escape') closeWelcome(); }

  lb.addEventListener('click', closeWelcome);
  if (content)   content.addEventListener('click',  e => e.stopPropagation());
  if (closeBtn)  closeBtn.addEventListener('click',  closeWelcome);
  if (guideLink) guideLink.addEventListener('click', closeWelcome);

  if (!localStorage.getItem(WELCOME_KEY)) openWelcome();
})();

// ── DECIMAL HOURS CONVERTER ───────────────────────────────────────────────────
(function () {
  const toggle = document.getElementById('decimalConverterToggle');
  const body   = document.getElementById('decimalConverterBody');
  const input  = document.getElementById('decimalHrsInput');
  const result = document.getElementById('decimalHrsResult');
  if (!toggle || !body || !input || !result) return;

  toggle.addEventListener('click', () => {
    const open = toggle.classList.toggle('open');
    body.classList.toggle('open', open);
    if (open) input.focus();
  });

  function convert() {
    const val = parseFloat(input.value);
    if (isNaN(val) || val < 0) { result.textContent = '–'; return; }
    const totalMins = Math.round(val * 60);
    const hrs  = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs === 0) {
      result.textContent = `${mins} min${mins !== 1 ? 's' : ''}`;
    } else if (mins === 0) {
      result.textContent = `${hrs} hr${hrs !== 1 ? 's' : ''}`;
    } else {
      result.textContent = `${hrs} hr${hrs !== 1 ? 's' : ''} ${mins} min${mins !== 1 ? 's' : ''}`;
    }
  }

  input.addEventListener('input', convert);
})();
