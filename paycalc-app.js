/**
 * paycalc.js — Pay Calculator UI layer.
 *
 * Owns: period select, form read/write, autosave, settings, HPP, sticky bar.
 * Does NOT own: pay maths (paycalc-calc.js), override cache/suggestion engine
 *   (paycalc-roster-suggestions.js), DOM for paycalc.html.
 * Edit here for: UI behaviour, form logic, period helpers, HPP accumulation.
 * Do not edit here for: tax/NI/gross maths, BH detection, override fetch.
 */

import { CONFIG as ROSTER_CONFIG, teamMembers, getBaseShift, formatISO, escapeHtml, MILLER_ACTUALS } from './roster-data.js';
import {
  P_YR, TAX_YEARS, GRADES, HPP_FRACTION, RATE_125, RATE_150, RATE_300,
  calcBandedTax, getTaxYearForOffset, getThresholds, getLondonAllowanceForPeriod,
  computeGross, computeTax, computeNI, computeSL, calcProRateFactor, getPensionForPeriod,
} from './paycalc-calc.js';
import { resetOverrides, getOverridesFetchState, fetchOverridesForPeriod, getRosterSuggestion, bhsForYear } from './paycalc-roster-suggestions.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { getSession, clearSession, ensureFirebaseSession } from './session.js';
import { initNavPanel, archiveNotice, isNoticeExpired } from './nav-panel.js';
import { initCardCollapse, createLightbox } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { HELP_CONTENT } from './paycalc-help.js';
import { SK, periodKey, hppEstKey, hppActualKey, ytdPayKey, ytdTaxKey, runMigrations, NOTICE_YTD_KEY } from './paycalc-migrations.js';
'use strict';


// ── SESSION GUARD ─────────────────────────────────────────────────────────────
// Redirect unsigned-in users to admin.html to sign in, then return here.
// Uses window.location.replace so the back button skips this page (avoids loops).
// getSession() (session.js) enforces the 30-day absolute / 7-day idle expiry and
// refreshes the idle clock — a raw localStorage read would treat an expired
// session as valid forever.
(function () {
  if (!getSession()?.name) {
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
  FIRST_OFFSET:   -11,   // P37 — first period of 2025/26 (~11 Apr 2025)
  LAST_OFFSET:     14,   // P62 — last period of 2026/27 (~11 Mar 2027)
  TAX_YEARS,             // imported from paycalc-calc.js
};

// MILLER_ACTUALS imported from roster-data.js — payslip figures for G. Miller only.

// Grade cache — lsGet is called in calculate() / calcHPP() on every keystroke; the
// grade only changes when the user picks a different one in Settings.
let _gradeCache = null;
function getGrade() {
  if (_gradeCache !== null) return _gradeCache;
  _gradeCache = lsGet(SK.grade) || '';
  return _gradeCache;
}
function invalidateGrade() { _gradeCache = null; }

/** Return contracted hours for the currently selected grade. */
function getContr() {
  const g = getGrade();
  return (g && GRADES[g]) ? GRADES[g].contr : GRADES.cea.contr;
}

/** Return the teamMembers entry for the logged-in session user, or null. */
function getLoggedMember() {
  const sess = getSession();
  if (!sess?.name) return null;
  return teamMembers.find(m => m.name === sess.name) || null;
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
  if (getLoggedMember()?.noProRate) return base;
  const factor = calcProRateFactor(getLoggedMember()?.startDate, p.start, p.cutoff);
  return factor === 1 ? base : Math.round(base * factor);
}

/** Returns the fraction of the period that the logged-in member was employed.
 *  Delegates to calcProRateFactor (paycalc-calc.js) — see that function for
 *  the formula invariant and why startDate must be midnight local time. */
function getProRateFactor(p) {
  if (!p) return 1;
  if (getLoggedMember()?.noProRate) return 1;
  return calcProRateFactor(getLoggedMember()?.startDate, p.start, p.cutoff);
}

/** Full-period pension default for the current grade, period-aware.
 *  Pass a period object to get the correct rate for that payday (handles cut-overs). */
function getPensionDefault(pObj) {
  const g = getGrade();
  const grade = g && GRADES[g] ? g : 'cea';
  if (pObj?.payday) return getPensionForPeriod(grade, pObj.payday);
  return GRADES[grade]?.pension ?? '';
}

// SK, periodKey, hppEstKey, hppActualKey, ytdPayKey, ytdTaxKey imported from paycalc-migrations.js

// ── BACK PAY STATE ────────────────────────────────────────────────────────────
// Set by calcBackPay() when a "paid in" period is chosen. Read by calculate()
// to add the lump sum into that period's gross before computing tax/NI.
let _bpAmount    = 0; // gross back pay for the "paid in" period (0 = none)
let _bpVarAmount = 0; // variable (HPP-accruing) portion of the back pay lump sum
let _bpPNum      = 0; // period number that receives the back pay (0 = none)


// Session-level tracker — prevents Settings card from auto-opening more than once per tax year
// per browser session. Cleared on page reload. Uses tax year label as the key.
const _settingsPrompted = new Set();

// The default period num selected on page load (first upcoming payday). Used by
// the ● today-period button to know when to show itself.
let _defaultPeriodNum = null;

// HELP_CONTENT imported from paycalc-help.js
// periodKey (and SK, hppEstKey, hppActualKey, ytdPayKey, ytdTaxKey) imported from paycalc-migrations.js

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
function numVal(id) {
    // iOS keyboards can insert smart hyphens/minus and curly quotes; strip them
    // so parseFloat doesn't silently return NaN on otherwise-valid user input.
    const v = document.getElementById(id)?.value ?? '';
    if (!v) return 0;
    const cleaned = v
        .replace(/[‐-―−−]/g, '-')
        .replace(/[‘’]/g, "'")
        .trim();
    return parseFloat(cleaned) || 0;
}
function intVal(id)    { return parseInt(document.getElementById(id)?.value ?? '') || 0; }
function hhmmDec(hId, mId) { return intVal(hId) + intVal(mId) / 60; }

function clampMins(mId) {
  const el = document.getElementById(mId);
  const v  = parseInt(el.value);
  if (!isNaN(v)) { if (v > 59) el.value = 59; if (v < 0) el.value = 0; }
}

// Find (or lazily create) the live decimal-conversion hint that sits beneath an
// hours field's hrs:mins pair. Returns null if the field/markup is missing.
function _decHintEl(hId, make) {
  const wrap = document.getElementById(hId)?.closest('.hhmm-wrap');
  if (!wrap) return null;
  const col = wrap.parentElement;
  let hint = col.querySelector('.hhmm-dec-hint');
  if (!hint && make) {
    hint = document.createElement('div');
    hint.className = 'hhmm-dec-hint';
    hint.setAttribute('aria-hidden', 'true');
    col.appendChild(hint);
  }
  return hint;
}

// Live "= 7h 30m" preview shown WHILE a decimal is being typed, so the on-blur
// split is a visible transformation rather than a silent one (trust on a pay form).
function decPreview(hId) {
  const raw = document.getElementById(hId).value;
  const val = parseFloat(raw);
  if (raw.includes('.') && !isNaN(val) && val >= 0) {
    const h = Math.floor(val);
    const m = Math.round((val - h) * 60);
    const hint = _decHintEl(hId, true);
    if (hint) { hint.textContent = `= ${h}h ${String(m).padStart(2, '0')}m`; hint.hidden = false; }
  } else {
    const hint = _decHintEl(hId, false);
    if (hint) hint.hidden = true;
  }
}

// If someone types "7.5" into an hours field, split it into 7 hrs 30 mins
// automatically on blur rather than silently truncating to 7. The live preview
// (decPreview) has already shown the result, so the split is no surprise.
function autoDecimalHours(hId, mId) {
  const raw = document.getElementById(hId).value;
  if (!raw.includes('.')) return;
  const val = parseFloat(raw);
  if (isNaN(val) || val < 0) return;
  const h = Math.floor(val);
  const m = Math.round((val - h) * 60);
  document.getElementById(hId).value = String(h);
  document.getElementById(mId).value = m || '';
  const hint = _decHintEl(hId, false);
  if (hint) hint.hidden = true; // the split now shows in the hrs/mins fields
  autosave();
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
    } else {
      warn.classList.remove('show');
    }
  }
  calculate();
}

// ── PAY PERIODS ───────────────────────────────────────────────────────────────
// Structure of each period:
//   cutoff  = Saturday (last day shifts count; also the hours-submission deadline)
//   start   = Sunday after the previous period's cutoff (first day shifts count)
//   payday  = Friday 6 days after cutoff (the day Chiltern pay into your account)
// Period array is fully determined by CONFIG constants — same result every call.
// Cache once; ~78 Date allocations saved per calculate() (called 6× per keystroke).
let _periodsCache = null;
function getPeriods() {
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

function hasBoxingDay(p) {
  // Check whether 26 Dec falls within the shift window (start → cutoff).
  // Normalise to midnight so a Boxing Day on the period-start day isn't missed —
  // p.start/p.cutoff are noon local; Boxing Day below is midnight local.
  // Same fix as hasBankHoliday().
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
function hasBankHoliday(p) {
  // Normalise to midnight so a BH on the period-start day isn't missed.
  // p.start/p.cutoff are noon local (inherited from FIRST_PAYDAY); BH dates are midnight local.
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
// iOS Safari ignores `select.value = x` when options are inside <optgroup> —
// the select stays blank and the change event never fires. Explicitly setting
// the matching option's .selected property works on all platforms.
function _setSelectPeriod(sel, pNum) {
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

  const _currentPNum = upcoming ? upcoming.num : periods[periods.length - 1].num;
  _populatePeriodSelect(sel, periods, { currentPNum: _currentPNum });

  _setSelectPeriod(sel, defPNum);
  // Always point the ● button at the current earning period regardless of URL params
  _defaultPeriodNum = _currentPNum;
  onPeriodChange();
  buildBackPayPeriodSelect();
}

function buildBackPayPeriodSelect() {
  const sel     = document.getElementById('backPayPeriod');
  const fromSel = document.getElementById('backPayFrom');
  if (!sel && !fromSel) return;
  const periods = getPeriods();
  _populatePeriodSelect(sel,     periods, { placeholder: '— select when the lump sum will land —' });
  _populatePeriodSelect(fromSel, periods, { placeholder: '— all periods with saved data —' });
}

// ── PER-TAX-YEAR RATE ─────────────────────────────────────────────────────────
// Loads the stored rate for the given tax year into the hourly rate field.
// Falls back to the legacy single rate, then to the current grade's default.
function updateRateForPeriod(ty) {
  let rates = {};
  try { rates = JSON.parse(lsGet(SK.rates) || '{}'); } catch(e) { console.warn('[PayCalc] Rates store corrupted'); }
  const g     = getGrade();
  const rate  = rates[ty.label]
             || parseFloat(lsGet(SK.rate))
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
  if (document.activeElement !== payEl) payEl.value = lsGet(ytdPayKey(ty)) || '';
  if (document.activeElement !== taxEl) taxEl.value = lsGet(ytdTaxKey(ty)) || '';
}

// ── TAX YEAR TABS ─────────────────────────────────────────────────────────────
function updateTyTabs() {
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

function jumpToTaxYear(tyIndex) {
  const ty      = CONFIG.TAX_YEARS[tyIndex];
  if (!ty) return;
  const periods = getPeriods();
  // Find first period of that tax year
  const first   = periods.find(p => (p.num - 48) >= ty.first && (p.num - 48) <= ty.last);
  if (!first) return;
  _setSelectPeriod(document.getElementById('periodSelect'), first.num);
  onPeriodChange();
}

function prevPeriod() {
  const sel     = document.getElementById('periodSelect');
  const periods = getPeriods();
  const idx     = periods.findIndex(x => x.num === +sel.value);
  if (idx > 0) { _setSelectPeriod(sel, periods[idx - 1].num); onPeriodChange(); }
}

function nextPeriod() {
  const sel     = document.getElementById('periodSelect');
  const periods = getPeriods();
  const idx     = periods.findIndex(x => x.num === +sel.value);
  if (idx < periods.length - 1) { _setSelectPeriod(sel, periods[idx + 1].num); onPeriodChange(); }
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

  // Show the ● today-period button only when not on the default (current) period
  const todayPeriodBtn = document.getElementById('todayPeriodBtn');
  if (todayPeriodBtn) {
    todayPeriodBtn.classList.toggle('hidden', pNum === _defaultPeriodNum);
  }

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
    `Came in on a rest day, or worked a Saturday that wasn't in your roster (cut-off: ${cutStr}). Shows as "RDW 1.25" on your payslip.`;
  document.getElementById('sundaySub').textContent =
    `Any hours you worked on a Sunday (cut-off: ${cutStr}). Shows as "RDW Sun 1.5" on your payslip.`;

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
  const tyConfirmed = lsGet(settingsKey(ty));
  // Always keep the title current so the hardcoded HTML default never shows stale text.
  document.getElementById('setupBannerTitle').textContent = `👋 Set up for ${ty.label}`;
  if (tyConfirmed) {
    // Confirmed — hide banner, update card header hint with saved values.
    document.getElementById('setupBanner').classList.add('hidden');
    const _hdrGrade = getGrade();
    const rate = parseFloat(document.getElementById('hourlyRate').value || String(GRADES[_hdrGrade]?.rate ?? GRADES.cea.rate)).toFixed(2);
    const code = (document.getElementById('taxCode').value || '1257L').toUpperCase();
    document.getElementById('settingsHint').textContent = `✓ ${ty.label} — £${rate}/hr · ${code}`;
  } else {
    document.getElementById('setupBannerBody').innerHTML =
      `Enter your <strong>hourly rate</strong> and <strong>tax code</strong> in ⚙️ Your Settings below, then tap <strong>Save settings</strong>. These settings apply to ${ty.label} only — you'll be prompted again when the new tax year starts.`;
    document.getElementById('setupBanner').classList.remove('hidden');
    // Auto-open settings once per session per TY — only for returning users (new users
    // already see the settings card open). Show the in-card notice for returning users.
    if (!_settingsPrompted.has(ty.label)) {
      _settingsPrompted.add(ty.label);
      if (lsGet(SK.setup)) {
        setSettingsCardOpen(true);
        const notice = document.getElementById('settingsNewYearNotice');
        notice.textContent = ty.rateUnconfirmed
          ? `New tax year ${ty.label} — the pay award has not yet been confirmed. The default rate may be out of date. Update once your payslip reflects the new rate (awards are often backdated to April), then tap Save settings.`
          : `New tax year ${ty.label} — check your hourly rate is up to date, then tap Save settings.`;
        notice.classList.remove('hidden');
      }
    }
  }

  // Show/hide bank holiday rows based on whether this period has any
  updateBhRows(p);

  // Show rate-unconfirmed notices when in a period where the pay award isn't finalised.
  // Two locations: one inside ⚙️ Settings (existing), one on the result card (new in v9.93)
  // so the warning is visible even when the Settings card is collapsed.
  const _rateUnconfirmed = !!ty.rateUnconfirmed;
  const _rateNoticeEl = document.getElementById('rateUnconfirmedNotice');
  if (_rateNoticeEl) _rateNoticeEl.classList.toggle('hidden', !_rateUnconfirmed);
  const _resultRateNotice = document.getElementById('resultRateNotice');
  if (_resultRateNotice) _resultRateNotice.classList.toggle('hidden', !_rateUnconfirmed);

  // Read session now so we can set the correct initial fetch state
  const session2 = getSession();

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
    const _fetchedPNum = p.num;
    fetchOverridesForPeriod(p, session2.name).then(status => {
      if (status === 'cancelled') return;
      // Guard: if the user switched period before the fetch resolved, do not
      // autosave override data from the old period into the new period.
      if (currentPeriodNum() !== _fetchedPNum) return;
      updateRosterHint();
      // Silently refresh any gold-highlighted fields filled during 'checking' state.
      const _refreshP = getPeriods().find(x => x.num === _fetchedPNum);
      if (_refreshP) {
        const _refreshS = getRosterSuggestion(_refreshP, getLoggedMember());
        if (_refreshS) { _applyRosterSuggestion(_refreshS); autosave(); }
      }
    });
  }

  // Load saved data for this period
  loadPeriodData(p.num);

  stampPaycalcPrintLine();
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
    otherAdj: (() => { const _r = Math.abs(parseFloat(document.getElementById('otherAdj').value) || 0); return _adjNegative ? -_r : _r; })(),
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
  const _rawAdj = d.otherAdj ?? 0;
  _adjNegative = _rawAdj < 0;
  document.getElementById('otherAdj').value = _rawAdj ? Math.abs(_rawAdj).toFixed(2) : '';
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
    lsSet(periodKey(pNum), JSON.stringify(d));
    updateSaveStatus(pNum);
  } catch(e) { /* storage unavailable */ }
}

function loadPeriodData(pNum) {
  let d = emptyPeriodData();
  try {
    const raw = lsGet(periodKey(pNum));
    if (raw) d = JSON.parse(raw);
  } catch(e) { /* use empty */ }
  writeFormData(d);
  _restoreRosterSuggested(pNum);
  // If no pension has been manually saved for this period, apply the period-specific
  // default. This handles both: (a) pension rate cut-overs (old periods show the old
  // rate, new periods show the new rate) and (b) joining-period pro-ration.
  const _pObj = getPeriods().find(x => x.num === pNum);
  if (d.pension == null && _pObj) {
    const _fullPension = getPensionDefault(_pObj);
    const pa = document.getElementById('pensionAmt');
    if (pa) pa.value = (_fullPension * getProRateFactor(_pObj)).toFixed(2);
  }
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
    document.getElementById('hoursShowMoreLabel').textContent = 'Unusual deductions or corrections';
  }
  updateSaveStatus(pNum);
  calculate();
}

function updateSaveStatus(pNum) {
  const el  = document.getElementById('saveStatus');
  const raw = lsGet(periodKey(pNum));
  if (raw) {
    let d;
    try { d = JSON.parse(raw); } catch(e) { d = null; }
    if (d) {
      const _pObj = getPeriods().find(x => x.num === pNum);
      const _defaultPension = _pObj
        ? parseFloat((getPensionDefault(_pObj) * getProRateFactor(_pObj)).toFixed(2))
        : getPensionDefault();
      const _hasCustomPension = d.pension != null && Math.abs(d.pension - _defaultPension) > 0.005;
      if (!isDataEmpty(d) || _hasCustomPension) {
        el.textContent = '✓ Entries saved for this period';
        el.className   = 'save-status saved';
        return;
      }
    }
  }
  el.textContent = 'No entries saved for this period';
  el.className   = 'save-status unsaved';
}

const _clearState = { pending: false, timer: null, countdownTimer: null };

// iOS suspends timers when a tab is backgrounded; on resume the queued setTimeout
// fires immediately, which could turn the "Tap again to confirm" prompt into an
// accidental wipe. Reset the confirm state whenever the tab becomes hidden.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && _clearState.pending) {
    clearTimeout(_clearState.timer);
    clearInterval(_clearState.countdownTimer);
    _clearState.pending = false;
    _clearState.timer = null;
    _clearState.countdownTimer = null;
    const btn = document.getElementById('clearBtn');
    if (btn) {
      btn.textContent = 'Clear all entries';
      btn.classList.remove('confirming');
    }
  }
});

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
  lsDel(periodKey(pNum));
  lsDel(snapKey(pNum));
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
  // Clearing blanks the fields programmatically — refresh the roster card so
  // rows don't keep showing ✓ matched against now-empty fields.
  updateRosterHint();
}

function clearRosterSuggestedAll() {
  document.querySelectorAll('.hhmm-field input.roster-suggested')
    .forEach(el => el.classList.remove('roster-suggested'));
}

// ── SETTINGS SAVE / LOAD ──────────────────────────────────────────────────────
// settingsKey: per-tax-year "confirmed" flag, separate from the raw saved values.
function settingsKey(ty) { return `myb_pc_setup_${ty.label.replace('/', '_')}`; }

// saveSettings: persists all field values. Called on every input change (auto-save).
// Does NOT set the confirmed flag or collapse the card — that's confirmSettings().
function saveSettings() {
  const rateVal = document.getElementById('hourlyRate').value;
  const pNum    = currentPeriodNum();
  const curP    = getPeriods().find(x => x.num === pNum);
  const curTy   = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  let rates = {};
  try { rates = JSON.parse(lsGet(SK.rates) || '{}'); } catch(e) { console.warn('[PayCalc] Rates store corrupted, resetting'); }
  const _savedGrade   = document.getElementById('gradeSelect').value;
  const _gradeDefault = GRADES[_savedGrade]?.rate ?? GRADES.cea.rate;
  rates[curTy.label] = parseFloat(rateVal) || _gradeDefault;
  lsSet(SK.rates,     JSON.stringify(rates));
  lsSet(SK.rate,      rateVal);
  lsSet(SK.code,      document.getElementById('taxCode').value);
  lsSet(SK.sl,        document.getElementById('studentLoan').value);
  // On a joining period the pension field shows the pro-rated amount.
  // Always write the full-period default to SK.pension so future full periods
  // don't inherit the pro-rated value as their default.
  // Always write the full-period rate (not the field value when pro-rated) so
  // the global default is correct for future full periods.
  const _pensionToSave = getProRateFactor(curP) < 1
    ? getPensionDefault(curP)
    : document.getElementById('pensionAmt').value;
  lsSet(SK.pension, _pensionToSave);
  lsSet(ytdPayKey(curTy), document.getElementById('ytdPay').value);
  lsSet(ytdTaxKey(curTy), document.getElementById('ytdTax').value);
  lsSet(SK.grade,         document.getElementById('gradeSelect').value);
  invalidateGrade();
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
  const existingRaw = lsGet(periodKey(pNum));
  if (existingRaw) {
    try {
      const d = JSON.parse(existingRaw);
      d.pension = parseFloat(document.getElementById('pensionAmt').value) || 0;
      lsSet(periodKey(pNum), JSON.stringify(d));
    } catch(e) {}
  }
  lsSet(settingsKey(curTy), '1');
  lsSet(SK.setup, '1');
  document.getElementById('setupBanner').classList.add('hidden');
  document.getElementById('settingsNewYearNotice').classList.add('hidden');
  // Update header hint to show confirmed summary. Fall back to the grade
  // default when the rate field is blank — parseFloat('') is NaN and would
  // display as "£NaN/hr".
  const _cfGrade = getGrade();
  const rate = (parseFloat(document.getElementById('hourlyRate').value)
    || (GRADES[_cfGrade]?.rate ?? GRADES.cea.rate)).toFixed(2);
  const code = (document.getElementById('taxCode').value || '1257L').toUpperCase();
  document.getElementById('settingsHint').textContent =
    `✓ ${curTy.label} — £${rate}/hr · ${code}`;
  // Brief "saved" confirmation then collapse
  const fb = document.getElementById('settingsSaveFeedback');
  fb.textContent = '✓ Settings saved';
  setTimeout(() => {
    fb.textContent = '';
    setSettingsCardOpen(false);
  }, 2500);
  calculate();
}

/** Programmatic open/close for the Settings card — keeps aria-expanded in
 *  sync with the classes that initCardCollapse manages on user toggles. */
function setSettingsCardOpen(open) {
  const toggle = document.getElementById('settingsToggle');
  const body   = document.getElementById('settingsBody');
  toggle.classList.toggle('open', open);
  body.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
}

// _migrateCeaKeys and runMigrations moved to paycalc-migrations.js

function loadSettings() {
  // Rate is set per-period in updateRateForPeriod() called from onPeriodChange —
  // no need to set it here; the field will update when buildPeriodSelect fires.
  const code    = lsGet(SK.code);
  const sl      = lsGet(SK.sl);
  const pension = lsGet(SK.pension);
  const done    = lsGet(SK.setup);
  if (code)    document.getElementById('taxCode').value     = code.toUpperCase();
  if (sl)      document.getElementById('studentLoan').value = sl;
  let grade = lsGet(SK.grade);
  if (!grade || !GRADES[grade]) {
    // Auto-detect from the logged-in member's role
    if (getLoggedMember()?.role === 'CES') grade = 'ces';
  }
  if (grade && GRADES[grade]) {
    document.getElementById('gradeSelect').value = grade;
    lsSet(SK.grade, grade);
    invalidateGrade();
  }
  document.getElementById('pensionAmt').value = pension ?? getPensionDefault();
  // Settings card starts closed in HTML. Open it only for first-time users.
  // (Previously started open and was removed for returning users — caused a visible flash.)
  if (!done) {
    setSettingsCardOpen(true);
  } else {
    // Mark all tax years confirmed if the global setup flag was already set (v1.13+)
    CONFIG.TAX_YEARS.forEach(ty => {
      if (!lsGet(settingsKey(ty))) lsSet(settingsKey(ty), '1');
    });
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

/** Maps a suggestion category to a confidence badge descriptor.
 *  Returns null for base-roster rows — no badge needed when the source is the
 *  scheduled rota. Badges only appear when the source or certainty is non-obvious. */
function _confBadge(cat, fromOv) {
  if (cat === 'ot' || cat === 'bhOt') return { text: 'Possible overtime', cls: 'conf-possible' };
  if (cat === 'rdw' || fromOv)        return { text: 'Recorded change',   cls: 'conf-recorded' };
  return null;
}

// Cached output of the last rosterRows / bdBody renders — avoids the parse+layout
// cost of innerHTML when the rendered string is identical (e.g. period change →
// multiple upstream calls with no change in field values, or typing a non-numeric
// key). Summary is not cached because it has two write paths (estimated + Miller
// actual override) which would make cache invalidation error-prone.
let _lastRosterRowsHtml = null;
let _lastBdBodyHtml     = null;

function updateRosterHint() {
  const card = document.getElementById('rosterHintBar');
  if (!card) return;

  const p = getPeriods().find(x => x.num === currentPeriodNum());
  if (!p) { card.style.display = 'none'; return; }

  const s = getRosterSuggestion(p, getLoggedMember());
  if (!s) { card.style.display = 'none'; return; }

  // State badge — only shown once the fetch has settled; hidden while checking
  const badge = document.getElementById('rosterStateBadge');
  if (badge) {
    if (getOverridesFetchState() === 'loaded') {
      badge.textContent  = '✓ Includes recorded changes';
      badge.className    = 'roster-state-badge loaded';
    } else if (getOverridesFetchState() === 'base-only') {
      badge.textContent  = '⚠ Scheduled only';
      badge.className    = 'roster-state-badge base-only';
    } else {
      badge.textContent  = '';
      badge.className    = 'roster-state-badge';
    }
  }

  // Category rows — only render rows that have data
  const rows = document.getElementById('rosterRows');
  if (rows) {
    const cats = [
      { cat: 'sat',  icon: '🗓️', label: 'Rostered Sat',         h: s.satH,  m: s.satM,  count: s.satCount,  fromOv: s.satFromOv },
      { cat: 'sun',  icon: '☀️', label: 'Sunday',              h: s.sunH,  m: s.sunM,  count: s.sunCount,  fromOv: s.sunFromOv },
      { cat: 'bh',   icon: '🏦', label: 'Bank holiday',        h: s.bhH,   m: s.bhM,   count: s.bhCount,   fromOv: s.bhFromOv  },
      { cat: 'bhOt', icon: '🏦', label: 'Bank holiday overtime', h: s.bhOtH, m: s.bhOtM, count: s.bhOtCount, fromOv: true        },
      { cat: 'ot',   icon: '⏰', label: 'Overtime',           h: s.otH,   m: s.otM,   count: s.otCount,   fromOv: true        },
      { cat: 'rdw',  icon: '💼', label: 'RDW',                h: s.rdwH,  m: s.rdwM,  count: s.rdwCount,  fromOv: true        },
      { cat: 'box',  icon: '🎁', label: 'Boxing Day',         h: s.boxH,  m: s.boxM,  count: s.boxCount,  fromOv: s.boxFromOv },
    ].filter(r => r.count > 0);

    const html = cats.map(r => {
      const suggestMins = r.h * 60 + r.m;
      const dayStr = r.count === 1 ? '1 day' : `${r.count} days`;

      // Read the current value in the matching form field pair (null = blank).
      const elH = document.getElementById(r.cat + 'H');
      const elM = document.getElementById(r.cat + 'M');
      const hv = elH?.value.trim() ?? '';
      const mv = elM?.value.trim() ?? '';
      const enteredMins = (hv === '' && mv === '') ? null
        : (parseInt(hv) || 0) * 60 + (parseInt(mv) || 0);

      const conf     = _confBadge(r.cat, r.fromOv);
      const confHtml = conf ? `<span class="conf-badge ${conf.cls}">${conf.text}</span>` : '';

      let rowClass, totalText, metaText, arrowHtml, ariaLabel;
      if (enteredMins === null) {
        // Blank — ready to fill
        rowClass  = 'roster-row';
        totalText = fmtH(r.h, r.m);
        metaText  = confHtml ? `${dayStr} · ${confHtml}` : dayStr;
        arrowHtml = `<span class="roster-cat-arrow" aria-hidden="true">→</span>`;
        ariaLabel = `Fill ${r.label} hours from roster`;
      } else if (enteredMins === suggestMins) {
        // Matched — entered value equals roster suggestion; source badge not needed
        rowClass  = 'roster-row roster-row--matched';
        totalText = fmtH(r.h, r.m);
        metaText  = dayStr;
        arrowHtml = `<span class="roster-cat-match" aria-hidden="true">✓</span>`;
        ariaLabel = `${r.label} matches roster: ${fmtH(r.h, r.m)}`;
      } else {
        // Differs — entered value doesn't match roster
        const entH = Math.floor(enteredMins / 60), entM = enteredMins % 60;
        rowClass  = 'roster-row roster-row--differs';
        totalText = `${fmtH(entH, entM)} entered`;
        metaText  = confHtml ? `Roster: ${fmtH(r.h, r.m)} · ${confHtml}` : `Roster: ${fmtH(r.h, r.m)}`;
        arrowHtml = `<span class="roster-cat-arrow roster-cat-arrow--differs" aria-hidden="true">→</span>`;
        ariaLabel = `${r.label}: you have ${fmtH(entH, entM)}, roster says ${fmtH(r.h, r.m)}. Tap to use roster`;
      }

      return `<button class="${rowClass}" type="button" data-cat="${r.cat}" ` +
          `aria-label="${ariaLabel}">` +
        `<span class="roster-row-icon" aria-hidden="true">${r.icon}</span>` +
        `<span class="roster-row-label">${r.label}</span>` +
        `<span class="roster-row-total">${totalText}</span>` +
        `<span class="roster-row-meta">${metaText}</span>` +
        arrowHtml +
        `</button>`;
    }).join('');
    if (html !== _lastRosterRowsHtml) {
      rows.innerHTML = html;
      _lastRosterRowsHtml = html;
    }
  }

  const hintTextEl = document.getElementById('rosterHintText');
  if (hintTextEl) {
    hintTextEl.textContent = getOverridesFetchState() === 'loaded'
      ? 'Likely special-rate hours only — Saturday, Sunday, bank holidays, RDW, and Boxing Day. Standard contracted hours are already included in basic pay. Check against what you actually worked.'
      : 'Base roster only — recorded shift changes not yet loaded. Special-rate hours only; standard contracted hours are already included in basic pay.';
  }

  // Adaptive bulk-fill label — "Fill" reads friendlier when there is nothing to
  // overwrite (the common first-time case); "Replace" is honest once the user has
  // typed values the button will clobber.
  const fillBtn = document.getElementById('fillFromRosterBtn');
  if (fillBtn) {
    const hasEntries = ['sat', 'sun', 'bh', 'bhOt', 'ot', 'rdw', 'box'].some(cat => {
      const h = document.getElementById(cat + 'H')?.value.trim() ?? '';
      const m = document.getElementById(cat + 'M')?.value.trim() ?? '';
      return h !== '' || m !== '';
    });
    fillBtn.textContent = hasEntries ? 'Replace with calendar values' : 'Fill from calendar';
  }

  // Day list visibility — show/hide toggle based on whether there is any data.
  // The list itself is only collapsed on period change (handled in onPeriodChange),
  // so a Firestore refresh does not close an open day list mid-review.
  const daysToggle = document.getElementById('rosterDaysToggle');
  if (daysToggle) daysToggle.style.display = s.days.length ? '' : 'none';
  renderRosterDayList(s.days);
  card.style.display = '';
}

const _DAY_ABBS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const _MON_ABBS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _DAY_CHIP_LABELS = { sat: 'Rostered Sat', sun: 'Sunday', bh: 'Bank holiday', bhOt: 'Bank holiday overtime', ot: 'Overtime', box: 'Boxing Day', rdw: 'RDW' };

/**
 * Show (or hide) a notice when the logged-in member started mid-period,
 * explaining that their contracted hours have been pro-rated.
 * @param {object} p - Current period object.
 */
function updateJoinerNotice(p) {
  const el = document.getElementById('joinerNotice');
  if (!el || !p) return;
  const member = getLoggedMember();
  if (!member?.startDate || member.startDate <= p.start || member?.noProRate) { el.style.display = 'none'; return; }
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
  if (hVal == null && mVal == null) return;
  // Treat H and M independently — a manually-edited field is skipped individually
  // rather than blocking its paired field. Prevents a user-typed minutes value from
  // preventing the hours field (blank) from receiving the roster value.
  const hEdited = elH.value !== '' && !elH.classList.contains('roster-suggested');
  const mEdited = elM.value !== '' && !elM.classList.contains('roster-suggested');
  if (!hEdited && hVal != null) {
    elH.value = hVal ?? '';
    elH.classList.add('roster-suggested');
  }
  if (!mEdited && mVal != null) {
    elM.value = mVal ?? '';
    elM.classList.add('roster-suggested');
  }
}

/** Fills only the named category's hours from the current roster suggestion. Force-fills
 *  because a row tap is an explicit user action — "I want the roster value here". */
function fillCategoryFromRoster(cat) {
  const p = getPeriods().find(x => x.num === currentPeriodNum());
  if (!p) return;
  const s = getRosterSuggestion(p, getLoggedMember());
  if (!s) return;
  const map = {
    sat:  ['satH',  'satM',  s.satH,  s.satM ],
    sun:  ['sunH',  'sunM',  s.sunH,  s.sunM ],
    bh:   ['bhH',   'bhM',   s.bhH,   s.bhM  ],
    bhOt: ['bhOtH', 'bhOtM', s.bhOtH, s.bhOtM],
    ot:   ['otH',   'otM',   s.otH,   s.otM  ],
    rdw:  ['rdwH',  'rdwM',  s.rdwH,  s.rdwM ],
    box:  ['boxH',  'boxM',  s.boxH,  s.boxM ],
  };
  const args = map[cat];
  if (!args) return;
  const [hId, mId, hVal, mVal] = args;
  const elH = document.getElementById(hId);
  const elM = document.getElementById(mId);
  if (elH && elM && hVal != null) {
    elH.value = hVal ?? '';
    elM.value = mVal ?? '';
    elH.classList.add('roster-suggested');
    elM.classList.add('roster-suggested');
    // Merge this category into the existing snapshot so reload can restore the
    // roster-suggested class for just these fields (without clobbering manually
    // entered values in other categories that were not filled from the roster).
    const pNum = currentPeriodNum();
    try {
      const existing = JSON.parse(lsGet(snapKey(pNum)) || '{}');
      existing[hId] = hVal ?? '';
      existing[mId] = mVal ?? '';
      lsSet(snapKey(pNum), JSON.stringify(existing));
    } catch(e) {}
  }
  autosave();
  // Programmatic value changes don't fire the input listeners — refresh the
  // roster card so the tapped row flips from "→ Fill" to "✓ matched".
  updateRosterHint();
}

/** Applies a suggestion object to all H/M field pairs.
 *  force=false (default): skips fields already manually entered.
 *  force=true: overwrites all fields — used by the "Replace with calendar values" button. */
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
  _saveRosterSnap(currentPeriodNum(), s);
}

// Per-period localStorage key for the last roster snapshot used for auto-fill.
const snapKey = pNum => `myb_pc_snap_${pNum}`;

/** Saves the suggestion values that were just applied so that loadPeriodData can restore
 *  the roster-suggested class on those fields after a page reload. Without this, a previously
 *  auto-filled non-zero value (e.g. rdwH=8) loses its gold class on reload and is mistaken
 *  for a manually-entered value, preventing the next Firestore fetch from updating it. */
function _saveRosterSnap(pNum, s) {
  try {
    lsSet(snapKey(pNum), JSON.stringify({
      satH: s.satH, satM: s.satM, sunH: s.sunH, sunM: s.sunM,
      bhH: s.bhH, bhM: s.bhM, bhOtH: s.bhOtH, bhOtM: s.bhOtM,
      otH: s.otH, otM: s.otM, rdwH: s.rdwH, rdwM: s.rdwM,
      boxH: s.boxH, boxM: s.boxM,
    }));
  } catch(e) {}
}

/** Re-adds roster-suggested to any field whose current value still matches the last roster
 *  snapshot, called immediately after writeFormData in loadPeriodData. This means _suggestIfBlank
 *  will update those fields if the Firestore fetch returns different values (e.g. admin added an
 *  RDW since the last time this period was open). Fields the user manually edited won't match
 *  the snapshot and keep their values untouched. */
function _restoreRosterSuggested(pNum) {
  let snap;
  try { const raw = lsGet(snapKey(pNum)); if (raw) snap = JSON.parse(raw); } catch(e) {}
  if (!snap) return;
  const pairs = [
    ['satH',  'satM',  snap.satH,  snap.satM ],
    ['sunH',  'sunM',  snap.sunH,  snap.sunM ],
    ['bhH',   'bhM',   snap.bhH,   snap.bhM  ],
    ['bhOtH', 'bhOtM', snap.bhOtH, snap.bhOtM],
    ['otH',   'otM',   snap.otH,   snap.otM  ],
    ['rdwH',  'rdwM',  snap.rdwH,  snap.rdwM ],
    ['boxH',  'boxM',  snap.boxH,  snap.boxM ],
  ];
  for (const [hId, mId, hVal, mVal] of pairs) {
    const elH = document.getElementById(hId);
    const elM = document.getElementById(mId);
    if (!elH || !elM) continue;
    // writeFormData writes 0 as '' (via `d.val || ''`); apply the same conversion for comparison.
    // Restore gold class independently per field so a partially-cleared pair still restores
    // the field that still matches — preventing its paired blank field from being skipped
    // by _suggestIfBlank when Firestore returns updated data.
    if (elH.value === String(hVal || '')) elH.classList.add('roster-suggested');
    if (elM.value === String(mVal || '')) elM.classList.add('roster-suggested');
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
  // Refresh row states (✓ matched) before the confirmation text swap below,
  // so the restored text after the timeout is the canonical hint.
  updateRosterHint();
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
  document.getElementById('badge-sat').textContent = f(RATE_125, '1.25');
  document.getElementById('badge-bh').textContent   = f(RATE_125, '1.25');
  document.getElementById('badge-bhot').textContent = f(RATE_125, '1.25');
  document.getElementById('badge-ot').textContent   = f(RATE_125, '1.25');
  document.getElementById('badge-rdw').textContent = f(RATE_125, '1.25');
  document.getElementById('badge-sun').textContent = f(RATE_150, '1.5');
  document.getElementById('badge-box').textContent = f(RATE_300, '3');
}

/** Render the proportional pay breakdown bar and legend above the summary rows. */
function updateBreakBar(gross, pension, tax, ni, sl, net) {
  const bar    = document.getElementById('payBreakBar');
  const legend = document.getElementById('payBreakLegend');
  if (!bar || !legend || !(gross > 0)) {
    bar?.classList.remove('pbb-visible');
    legend?.classList.remove('pbb-visible');
    return;
  }
  bar.classList.add('pbb-visible');
  legend.classList.add('pbb-visible');

  const pct = v => ((v / gross) * 100).toFixed(2);
  const fmtPct = v => `${((v / gross) * 100).toFixed(0)}%`;

  const segs = [
    { id: 'pbbPension', cls: 'pbb-pension', val: pension, label: 'Pension', legendId: 'pblPension', dotCls: 'pbl-dot pbb-pension' },
    { id: 'pbbTax',     cls: 'pbb-tax',     val: tax,     label: 'Tax',     legendId: 'pblTax',     dotCls: 'pbl-dot pbb-tax' },
    { id: 'pbbNI',      cls: 'pbb-ni',      val: ni,      label: 'NI',      legendId: 'pblNI',      dotCls: 'pbl-dot pbb-ni' },
    { id: 'pbbSL',      cls: 'pbb-sl',      val: sl,      label: 'Student loan', legendId: 'pblSL', dotCls: 'pbl-dot pbb-sl' },
    { id: 'pbbNet',     cls: 'pbb-net',     val: net,     label: 'Take-home', legendId: 'pblNet',   dotCls: 'pbl-dot pbb-net' },
  ];

  bar.innerHTML    = segs.filter(s => s.val > 0).map(s =>
    `<div class="pbb-seg ${s.cls}" style="flex-grow:${pct(s.val)}" title="${s.label} ${fmtPct(s.val)}"></div>`
  ).join('');
  legend.innerHTML = segs.filter(s => s.val > 0).map(s =>
    `<span class="pbl-item"><span class="${s.dotCls}"></span>${s.label} <strong>${fmtPct(s.val)}</strong></span>`
  ).join('');
}

function calculate() {
  // Resolve thresholds for the selected period's tax year
  const _pNum   = currentPeriodNum();
  const _curP   = getPeriods().find(x => x.num === _pNum);
  if (!_curP) return;
  const _ty     = _curP ? getTaxYearForOffset(_curP.num - 48) : CONFIG.TAX_YEARS[0];
  const thresholds = getThresholds(_ty.label);
  const _proRateFactor = getProRateFactor(_curP);
  const LONDON = (_curP ? getLondonAllowanceForPeriod(_curP, _ty) : _ty.londonAllow) * _proRateFactor;

  const _calcGrade = getGrade();
  const _calcDefaultRate = GRADES[_calcGrade]?.rate ?? GRADES.cea.rate;
  const rate = numVal('hourlyRate') || _calcDefaultRate;
  const _rateWarn = document.getElementById('rateWarn');
  if (_rateWarn) {
    if (numVal('hourlyRate') > 100)
      _rateWarn.textContent = `⚠ Looks like a typo — did you mean £${(numVal('hourlyRate') / 100).toFixed(2)}/hr?`;
    else if (numVal('hourlyRate') > 0 && numVal('hourlyRate') < 15)
      _rateWarn.textContent = '⚠ Rate seems low — double-check your payslip';
    else
      _rateWarn.textContent = '';
  }
  updateBadges(rate);
  const r125 = rate * RATE_125;
  const r150 = rate * RATE_150;
  const r300 = rate * RATE_300;
  const peer = +document.getElementById('peerVal').textContent;

  const satHrs  = hhmmDec('satH',  'satM');
  // Guard: only count BH/Boxing hours if this period actually contains those days.
  // localStorage can restore saved values into hidden rows, so we must sanitise here
  // rather than relying solely on the DOM row being hidden.
  const _hasBh = hasBankHoliday(_curP);
  const bhHrs   = _hasBh ? hhmmDec('bhH',   'bhM')   : 0;
  const bhOtHrs = _hasBh ? hhmmDec('bhOtH', 'bhOtM') : 0;
  const oHrs    = hhmmDec('otH',   'otM');
  const rHrs    = hhmmDec('rdwH',  'rdwM');
  const sHrs    = hhmmDec('sunH',  'sunM');
  const bHrs    = hasBoxingDay(_curP)   ? hhmmDec('boxH',  'boxM')   : 0;

  const _effContr = getEffectiveContr(_curP);
  const _adjRaw   = Math.abs(parseFloat(document.getElementById('otherAdj').value) || 0);
  const otherAdj  = _adjNegative ? -_adjRaw : _adjRaw;

  // Pure gross calculation — all DOM reads done; no more DOM access until UI writes below
  const { gross, satCapped, normHrs, bhCapped, nonBhNorm,
          gBasicNorm, gBasicSat, gBankHol, gBhOt, gOvertime,
          gRdw, gSunday, gBoxing, gPeer } = computeGross({
    effContr: _effContr, rate, satHrs, bhHrs, bhOtHrs, oHrs, rHrs, sHrs, bHrs,
    peerDays: peer, otherAdj, london: LONDON,
  });

  // Add back pay if this is the period the lump sum is paid in.
  const _bpThisPeriod = (_bpPNum > 0 && _bpPNum === _pNum) ? _bpAmount : 0;

  // Add HPP estimate/actual if this is the January period where HPP is paid.
  // Finds the tax year whose hppPaidJan matches this period's payday year.
  // The estimate is pre-computed by calcHPP() and stored in localStorage whenever
  // the user views any period in that tax year — by end of April it is essentially final.
  const _hppTy = _curP ? TAX_YEARS.find(t =>
      _curP.payday.getFullYear() === t.hppPaidJan && _curP.payday.getMonth() === 0
  ) : null;
  const _hppActualAmt  = _hppTy ? parseFloat(lsGet(hppActualKey(_hppTy)) || '0') : 0;
  const _hppEstAmt     = _hppTy ? parseFloat(lsGet(hppEstKey(_hppTy))    || '0') : 0;
  const _hppForPeriod  = _hppActualAmt > 0 ? _hppActualAmt : (_hppEstAmt || 0);
  const _hppIsEstimate = _hppTy && _hppForPeriod > 0 && !(_hppActualAmt > 0);

  const grossWithBp = gross + _bpThisPeriod + _hppForPeriod;

  // Pension — salary sacrifice: deducted from gross before tax and NI are calculated.
  const pension    = numVal('pensionAmt');
  const pensionWarn = document.getElementById('pensionWarn');
  if (pensionWarn) pensionWarn.classList.toggle('show', pension > grossWithBp && pension > 0);
  const sacGross   = Math.max(0, grossWithBp - pension);

  // Income tax — cumulative PAYE when YTD figures provided (W1/M1/X excluded)
  // Pass null (not 0) when the field is empty so computeTax distinguishes "not provided" from "£0 entered"
  const ytdPayEl = document.getElementById('ytdPay');
  const ytdTaxEl = document.getElementById('ytdTax');
  const ytdP = (ytdPayEl?.value ?? '').trim() !== '' ? numVal('ytdPay') : null;
  // Mirror the ytdPay guard — pass null (not 0) when blank so computeTax treats
  // "ytdPay filled, ytdTax left blank" as incomplete rather than "£0 tax collected".
  const ytdT = (ytdTaxEl?.value ?? '').trim() !== '' ? numVal('ytdTax') : null;
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

  updateBreakBar(grossWithBp, pension, tax, ni, sl, net);

  // UI
  document.getElementById('netDisplay').textContent = fmt(net);
  document.getElementById('pensionRef').textContent = pension.toFixed(2);
  document.getElementById('payslipNote').style.display = 'block';
  document.getElementById('absenceCaveat').style.display = 'block';

  document.getElementById('summary').innerHTML = `
    ${(_bpThisPeriod > 0 || _hppForPeriod > 0)
      ? `<div class="sum-row"><span class="lbl">Regular pay</span><span class="val">${fmt(gross)}</span></div>
         ${_bpThisPeriod > 0 ? `<div class="sum-row sum-bp"><span class="lbl">Back pay lump sum (pay award)</span><span class="val">+${fmt(_bpThisPeriod)}</span></div>` : ''}
         ${_hppForPeriod > 0 ? `<div class="sum-row sum-hpp"><span class="lbl">Holiday Pay Premium${_hppIsEstimate ? ' <span class="sum-est">(estimated)</span>' : ''}</span><span class="val">+${fmt(_hppForPeriod)}</span></div>` : ''}
         <div class="sum-row sum-gross"><span class="lbl">Total pay</span><span class="val">${fmt(grossWithBp)}</span></div>`
      : `<div class="sum-row sum-gross"><span class="lbl">Total pay</span><span class="val">${fmt(gross)}</span></div>`}
    ${pension > 0 ? `<div class="sum-row sum-ded"><span class="lbl">Pension contribution</span><span class="val">−${fmt(pension)}</span></div>` : ''}
    ${pension > 0 ? `<div class="sum-row sum-gross"><span class="lbl">Pay after pension deduction</span><span class="val">${fmt(sacGross)}</span></div>` : ''}
    <div class="sum-row sum-ded"><span class="lbl">Income Tax${usingCumulative ? ' <span style="font-size:var(--type-micro);font-weight:400;color:var(--text-faint);margin-left:4px">adjusted from payslip</span>' : ''}</span><span class="val">−${fmt(tax)}</span></div>
    <div class="sum-row sum-ded"><span class="lbl">National Insurance</span><span class="val">−${fmt(ni)}</span></div>
    ${sl > 0 ? `<div class="sum-row sum-ded"><span class="lbl">Student Loan</span><span class="val">−${fmt(sl)}</span></div>` : ''}
    <div class="sum-row sum-net"><span class="lbl">Estimated take-home pay${_bpThisPeriod > 0 && _hppForPeriod > 0 ? ' (inc. back pay & HPP)' : _bpThisPeriod > 0 ? ' (inc. back pay)' : _hppForPeriod > 0 ? ' (inc. HPP)' : ''}</span><span class="val">${fmt(net)}</span></div>
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
    bd += `<div class="bd-row"><span class="b-lbl">Bank Holiday Overtime (${fh(bhOtHrs)} × ${fmt(r125)})</span><span class="b-val">${fmt(gBhOt)}</span></div>`;
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
  if (_bpThisPeriod > 0)
    bd += `<div class="bd-row bd-extra"><span class="b-lbl">Back pay lump sum (pay award)</span><span class="b-val">+${fmt(_bpThisPeriod)}</span></div>`;
  if (_hppForPeriod > 0)
    bd += `<div class="bd-row bd-extra"><span class="b-lbl">Holiday Pay Premium${_hppIsEstimate ? ' (estimated)' : ''}</span><span class="b-val">+${fmt(_hppForPeriod)}</span></div>`;
  if (bd !== _lastBdBodyHtml) {
    document.getElementById('bdBody').innerHTML = bd;
    _lastBdBodyHtml = bd;
  }

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
    // Keep the sticky label honest — this figure is the confirmed actual, not an estimate.
    const _stickyLbl = document.getElementById('stickyLabel');
    if (_stickyLbl) _stickyLbl.textContent = '✅ Actual take-home';
  } else {
    const _suffix = _bpThisPeriod > 0 && _hppForPeriod > 0 ? 'inc. back pay & HPP'
        : _bpThisPeriod > 0  ? 'inc. back pay'
        : _hppForPeriod > 0  ? `inc. HPP${_hppIsEstimate ? ' estimate' : ''}`
        : null;
    if (_netLabel) _netLabel.textContent = _suffix
        ? `💷 Estimated Take-Home Pay (${_suffix})`
        : '💷 Estimated Take-Home Pay';
    const _peekBtn = document.getElementById('resultPeekBtn');
    if (_peekBtn) _peekBtn.textContent = _suffix
        ? `↑ Estimated take-home (${_suffix}): ${fmt(net)}`
        : `↑ Estimated take-home: ${fmt(net)}`;
    const _stickyAmt = document.getElementById('stickyAmount');
    if (_stickyAmt) _stickyAmt.textContent = fmt(net);
    const _stickyLbl = document.getElementById('stickyLabel');
    if (_stickyLbl) _stickyLbl.textContent = _suffix
        ? `💷 Estimated take-home (${_suffix})`
        : '💷 Estimated take-home';
    document.getElementById('bdBtn').innerHTML =
      `Full pay breakdown &nbsp;<span class="bd-arrow">▼</span>`;
  }

  const _bannerEl = document.getElementById('bpActiveBanner');
  if (_bannerEl) {
    if (_bpThisPeriod > 0) {
      // Keep banner element stable; only update text node + lazily-created link.
      // Previous version created a new <a> + listener on every recalc.
      _bannerEl.firstChild?.nodeType === Node.TEXT_NODE
        ? (_bannerEl.firstChild.nodeValue = `✓ Includes back pay lump sum of ${fmt(_bpThisPeriod)} · `)
        : (_bannerEl.textContent = `✓ Includes back pay lump sum of ${fmt(_bpThisPeriod)} · `);
      if (!_bannerEl.querySelector('button')) {
        // <button>, not href-less <a> — an anchor without href is mouse-only
        // (no keyboard focus, no Enter activation).
        const _bpLink = document.createElement('button');
        _bpLink.type = 'button';
        _bpLink.textContent = 'view back pay card';
        _bpLink.addEventListener('click', () => {
          document.getElementById('backPayCard').scrollIntoView({ behavior: 'smooth' });
        });
        _bannerEl.appendChild(_bpLink);
      }
      _bannerEl.style.display = '';
    } else {
      _bannerEl.style.display = 'none';
    }
  }

  calcHPP();
}

// ── HPP ESTIMATOR ─────────────────────────────────────────────────────────────
// Formula from Chiltern payroll (Marie Firby):
// (Gross - Basic) × 4/52 = HPP

// Decode raw hours from a saved period data object. Guards BH/Boxing hours against
// periods that don't contain those days — localStorage can restore saved values into
// hidden rows, so we sanitise here rather than relying on the DOM row being hidden.
function _decodeHours(p, d) {
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
function _varPayForPeriod(p, d, rate) {
  const r125      = rate * RATE_125, r150 = rate * RATE_150, r300 = rate * RATE_300;
  const { satHrs, bhHrs, bhOtHrs, otHrs, rdwHrs, sunHrs, boxHrs } = _decodeHours(p, d);
  const effContr  = getEffectiveContr(p);
  const satCapped = Math.min(satHrs, effContr);
  const normHrs   = effContr - satCapped;
  const bhCapped  = Math.min(bhHrs, normHrs);
  const pTy       = getTaxYearForOffset(p.num - 48);
  const pLondon   = getLondonAllowanceForPeriod(p, pTy) * getProRateFactor(p);
  return satCapped * (rate * (RATE_125 - 1)) +
         bhCapped  * (rate * (RATE_125 - 1)) +
         bhOtHrs   * r125                    +
         otHrs     * r125          +
         rdwHrs    * r125          +
         sunHrs    * r150          +
         boxHrs    * r300          +
         pLondon;
}
// Variable pay includes: OT, RDW, Sunday, Boxing Day, Saturday uplift, London Allowance
// Does NOT include: peer training, basic pay, expenses, bonuses
function calcHPP() {
  const _hppGrade       = getGrade();
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
      // Variable back pay was earned in past periods but received in _bpPNum.
      // Added before the saved-data check so it still counts when the lump-sum
      // period itself has no hours entered yet.
      if (_bpVarAmount > 0 && p.num === _bpPNum) totalVar += _bpVarAmount;

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

      const raw = lsGet(periodKey(p.num));
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
  // Delete the key when the estimate drops to zero — otherwise a stale figure
  // would silently be added to the January payslip after entries are cleared.
  if (hpp > 0) lsSet(hppEstKey(ty), hpp.toFixed(2));
  else         lsDel(hppEstKey(ty));

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
  const estRaw    = lsGet(hppEstKey(priorTy));
  const actualRaw = lsGet(hppActualKey(priorTy));
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
      const _hppGrade = getGrade();
      const rate = GRADES[_hppGrade]?.rate ?? GRADES.cea.rate;
      let _priorVar = 0;
      _priorPeriods.forEach(p => {
        try {
          const raw = lsGet(periodKey(p.num));
          if (!raw) return;
          const d = JSON.parse(raw);
          if (isDataEmpty(d)) return;
          _priorVar += _varPayForPeriod(p, d, rate);
        } catch(e) {}
      });
      if (_priorVar > 0) est = _priorVar * HPP_FRACTION;
    }

    if (est > 0) lsSet(hppEstKey(priorTy), est.toFixed(2));
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
// All collapsible card headers are wired through the shared initCardCollapse
// (overlay.js) in the listener section below — it adds keyboard (Enter/Space)
// and aria-expanded support that the old per-card toggle functions lacked.

/** Pre-fill the Back Pay card inputs when it opens (initCardCollapse onToggle). */
function prefillBackPay() {
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

// ── BACK PAY CALCULATOR ───────────────────────────────────────────────────────

/** Tax year the back-pay award belongs to — derived from the "backdated from"
 *  period, NOT the period being viewed (which may be a different tax year). */
function _bpAwardTaxYear(fromPNum) {
  const p = fromPNum ? getPeriods().find(x => x.num === fromPNum) : null;
  return getTaxYearForOffset((p ? p.num : currentPeriodNum()) - 48);
}

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
  let rows          = '';
  let grandTotal    = 0;
  let grandVarTotal = 0;
  let pCount        = 0;

  periods.forEach(p => {
    try {
      if (fromPNum && p.num < fromPNum) return; // exclude before April
      if (bpPNum   && p.num > bpPNum)  return; // exclude after "paid in" period
      const raw = lsGet(periodKey(p.num));
      if (!raw) return;
      const d = JSON.parse(raw);
      if (isDataEmpty(d)) return;

      const { satHrs, bhHrs, bhOtHrs, otHrs, rdwHrs, sunHrs, boxHrs } = _decodeHours(p, d);
      // Cap sat/BH hours as calculate() does — back-pay must reflect actual gross paid.
      // Use getEffectiveContr so joining periods use pro-rated hours.
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
        grandTotal    += backPay;
        grandVarTotal += varPay;
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

    // Apply new rate button — shown once rates are confirmed.
    // "Already applied" compares against the stored rate for the AWARD's tax
    // year, not the rate field (which shows the rate of whichever tax year is
    // being viewed and may legitimately differ).
    if (applyWrap && applyBtn && hasRate) {
      const _awardTy = _bpAwardTaxYear(fromPNum);
      let _storedRates = {};
      try { _storedRates = JSON.parse(lsGet(SK.rates) || '{}'); } catch(e) {}
      const alreadyApplied = Math.abs((parseFloat(_storedRates[_awardTy.label]) || 0) - newRate) < 0.001;
      applyBtn.textContent = alreadyApplied
        ? `✓ New rate already applied — £${newRate.toFixed(2)}/hr (${_awardTy.label})`
        : `Apply new rate to settings — £${newRate.toFixed(2)}/hr (${_awardTy.label}) →`;
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

  // Update the back pay state used by calculate() and calcHPP(), then re-run.
  // Only associate with a period when the user has explicitly chosen one.
  const newBpPNum    = (grandTotal > 0 && bpPNum > 0) ? bpPNum : 0;
  const newBpAmt     = newBpPNum > 0 ? grandTotal    : 0;
  const newBpVarAmt  = newBpPNum > 0 ? grandVarTotal : 0;
  if (newBpPNum !== _bpPNum ||
      Math.abs(newBpAmt    - _bpAmount)    > 0.001 ||
      Math.abs(newBpVarAmt - _bpVarAmount) > 0.001) {
    _bpAmount    = newBpAmt;
    _bpVarAmount = newBpVarAmt;
    _bpPNum      = newBpPNum;
    calculate();
  }
}

function toggleBpBreakdown() {
  const btn  = document.getElementById('bpBreakdownBtn');
  const open = btn.classList.toggle('open');
  document.getElementById('backPayRows').classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
}

function applyNewRate() {
  const newRate = parseFloat(document.getElementById('newRateInput').value);
  if (!newRate) return;
  // Write the rate against the AWARD's tax year. Going through the rate field +
  // saveSettings() would store it on whichever tax year is being viewed —
  // silently corrupting last year's rate if an old period happens to be open.
  const fromPNum = +(document.getElementById('backPayFrom')?.value || 0);
  const awardTy  = _bpAwardTaxYear(fromPNum);
  let rates = {};
  try { rates = JSON.parse(lsGet(SK.rates) || '{}'); } catch(e) { console.warn('[PayCalc] Rates store corrupted, resetting'); }
  rates[awardTy.label] = newRate;
  lsSet(SK.rates, JSON.stringify(rates));
  lsSet(SK.rate,  newRate.toFixed(2)); // legacy single-rate fallback for years with no stored rate
  // Refresh the rate field for the tax year being viewed (it may be a different
  // year, in which case its rate is correctly left unchanged).
  const curP  = getPeriods().find(x => x.num === currentPeriodNum());
  const curTy = curP ? getTaxYearForOffset(curP.num - 48) : CONFIG.TAX_YEARS[0];
  updateRateForPeriod(curTy);
  calculate();
  // Update button state to reflect it's been applied
  const btn = document.getElementById('applyRateBtn');
  const fb  = document.getElementById('applyRateFeedback');
  if (btn) { btn.textContent = `✓ New rate already applied — £${newRate.toFixed(2)}/hr (${awardTy.label})`; btn.disabled = true; }
  if (fb)  { fb.textContent  = `Settings updated — periods in ${awardTy.label} will now calculate at the new rate.`; }
}

// ── HPP FORMULA NOTE TOGGLE ───────────────────────────────────────────────────
// ── HOURS SHOW MORE TOGGLE ────────────────────────────────────────────────────
function toggleHoursExtra() {
  const btn  = document.getElementById('hoursShowMore');
  const body = document.getElementById('hoursExtra');
  const open = body.classList.toggle('open');
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  btn.querySelector('.show-more-arrow').textContent = open ? '▲' : '▼';
  document.getElementById('hoursShowMoreLabel').textContent = open
    ? 'Hide adjustments'
    : 'Unusual deductions or corrections';
}

function toggleHppNote() {
  const btn  = document.getElementById('hppToggleBtn');
  const body = document.getElementById('hppNoteBody');
  const open = body.classList.toggle('open');
  btn.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  btn.querySelector('.hpp-toggle-arrow').textContent = open ? '▲' : '▼';
  document.getElementById('hppToggleBtnLabel').textContent = open ? 'Hide calculation details ' : 'How is this calculated? ';
}

// ── DISCLAIMER TOGGLE ─────────────────────────────────────────────────────────
function toggleDisclaimer() {
  const extra  = document.getElementById('disclaimerExtra');
  const toggle = document.getElementById('disclaimerToggle');
  const open   = extra.classList.toggle('open');
  toggle.textContent = open ? 'Less ▲' : 'More ▼';
  toggle.setAttribute('aria-expanded', String(open));
}

// ── PEER STEPPER ──────────────────────────────────────────────────────────────
function stepPeer(delta) {
  const el = document.getElementById('peerVal');
  el.textContent = Math.max(0, Math.min(10, +el.textContent + delta));
  autosave();
}

// ── BREAKDOWN TOGGLE ──────────────────────────────────────────────────────────
function toggleBD() {
  const btn  = document.getElementById('bdBtn');
  const open = btn.classList.toggle('open');
  document.getElementById('bdBody').classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
}

// ── INIT ──────────────────────────────────────────────────────────────────────
runMigrations({ getPeriods, getLoggedMember, getPensionDefault });

// Tax-year quick-jump tabs — generated from TAX_YEARS so the April rollover only
// touches paycalc-calc.js (no hand-edited tab markup). Must run before
// buildPeriodSelect(): onPeriodChange → updateTyTabs looks the tabs up by id.
(function buildTyTabs() {
  const wrap = document.getElementById('tyTabs');
  if (!wrap) return;
  CONFIG.TAX_YEARS.forEach((ty, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ty-tab';
    b.id = `tyTab${i}`;
    b.textContent = ty.label;
    b.addEventListener('click', () => jumpToTaxYear(i));
    wrap.appendChild(b);
  });
})();

// Grade hint — rates interpolated from GRADES so the April pay award is a
// one-place update (paycalc-calc.js), not a hunt through hardcoded HTML copy.
(function fillGradeRateHint() {
  const el = document.getElementById('gradeRateHint');
  if (!el) return;
  el.textContent = 'CEA = Customer Experience Ambassador · CES = Customer Experience Supervisor. '
    + `Your grade sets the default hourly rate below. CEA: £${GRADES.cea.rate.toFixed(2)}/hr · CES: £${GRADES.ces.rate.toFixed(2)}/hr.`;
})();

loadSettings();
buildPeriodSelect();

// ── EVENT LISTENERS (no inline handlers in HTML — roster-app convention) ──────

// Period navigation
document.getElementById('periodSelect').addEventListener('change', onPeriodChange);
document.getElementById('prevBtn').addEventListener('click', prevPeriod);
document.getElementById('nextBtn').addEventListener('click', nextPeriod);
document.getElementById('todayPeriodBtn').addEventListener('click', () => {
  const sel = document.getElementById('periodSelect');
  _setSelectPeriod(sel, _defaultPeriodNum);
  onPeriodChange();
});
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

// Decimal auto-correction — if someone types "7.5" into an hours field, split it
// into 7h 30m on blur instead of silently truncating to 7. A live "= 7h 30m"
// preview shows while typing so the on-blur split is never a silent surprise.
[['satH','satM'],['bhH','bhM'],['bhOtH','bhOtM'],['otH','otM'],['rdwH','rdwM'],['sunH','sunM'],['boxH','boxM']].forEach(([h,m]) => {
  document.getElementById(h).addEventListener('input', () => decPreview(h));
  document.getElementById(h).addEventListener('blur', () => autoDecimalHours(h, m));
});

// Peer training stepper
document.getElementById('peerMinus').addEventListener('click', () => stepPeer(-1));
document.getElementById('peerPlus').addEventListener('click',  () => stepPeer(1));

// Back-pay inputs
['oldRate','newRateInput','oldLondon','newLondon'].forEach(id => {
  document.getElementById(id).addEventListener('input', calcBackPay);
});

// Card collapse toggles — shared initCardCollapse (overlay.js) adds keyboard +
// aria-expanded support. Passing the header id as the chevron id toggles .open
// on the header itself, which drives the .card-toggle-arrow rotation in CSS.
initCardCollapse('settingsToggle',    'settingsBody',    'settingsToggle');
initCardCollapse('payslipCardToggle', 'payslipCardBody', 'payslipCardToggle');
initCardCollapse('hppCardToggle',     'hppCardBody',     'hppCardToggle');
initCardCollapse('backPayCardToggle', 'backPayBody',     'backPayCardToggle',
  open => { if (open) prefillBackPay(); });

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
  // Skip on desktop — CSS hides the bar at ≥1024px, but the observer would still
  // toggle body.sticky-active (which adds bottom padding), causing layout shift.
  if (window.matchMedia('(min-width: 1024px)').matches) return;
  // Guard against bfcache double-init: if the page is restored from the back/forward
  // cache, this IIFE runs again — without this flag a second IntersectionObserver
  // would be created and leak listeners.
  if (stickyBar.dataset.obsInit) return;
  stickyBar.dataset.obsInit = '1';
  // Observe the £ amount display specifically, not the whole card.
  // threshold:0 fires when it fully leaves the viewport; boundingClientRect.top < 0
  // distinguishes "scrolled off the top" from "below the fold on load" (where top is
  // positive and we must not show the bar).
  const netDisplay = document.getElementById('netDisplay') || resultCard;
  // rAF wrapper prevents class-toggle flicker during iOS momentum scroll, where
  // IntersectionObserver can fire repeatedly within a single frame.
  const obs = new IntersectionObserver(([entry]) => {
    requestAnimationFrame(() => {
      const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      stickyBar.classList.toggle('visible', show);
      document.body.classList.toggle('sticky-active', show);
    });
  }, { threshold: 0, rootMargin: '-8px 0px 0px 0px' });
  obs.observe(netDisplay);
  // Disconnect on pagehide so a bfcache restore doesn't end up with two observers.
  window.addEventListener('pagehide', () => obs.disconnect(), { once: true });
  // Hide the sticky bar while the iOS soft keyboard is up, otherwise it covers
  // the field the user is typing into. visualViewport shrinks when the keyboard
  // appears; a >150px drop is a reliable keyboard signal.
  if (window.visualViewport) {
    let _inputFocused = false;
    let _baseVVH = window.visualViewport.height;

    document.addEventListener('focusin', e => {
      _inputFocused = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    });

    document.addEventListener('focusout', () => {
      _inputFocused = false;
      stickyBar.classList.remove('keyboard-up');
      // Refresh baseline after keyboard dismissal (orientation may have changed)
      setTimeout(() => {
        _baseVVH = window.visualViewport.height;
      }, 300);
    });

    window.visualViewport.addEventListener('resize', () => {
      const keyboardUp = _inputFocused && (_baseVVH - window.visualViewport.height) > 120;
      stickyBar.classList.toggle('keyboard-up', keyboardUp);
    }, { passive: true });
  }
  stickyBar.addEventListener('click', () =>
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' })
  );
  stickyBar.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Space must not also scroll the page
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
})();

// Roster fill — "Fill blank fields" button + per-category "Fill →" buttons
const _fillBtn = document.getElementById('fillFromRosterBtn');
if (_fillBtn) _fillBtn.addEventListener('click', fillFromRoster);

// Per-category fill buttons are dynamically rendered inside #rosterRows — use delegation
document.getElementById('rosterRows')?.addEventListener('click', e => {
  const catBtn = e.target.closest('[data-cat]');
  if (catBtn) { fillCategoryFromRoster(catBtn.dataset.cat); return; }
  if (e.target.closest('[data-action="focus-ot"]')) {
    const el = document.getElementById('otH');
    if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
});

// Remove roster-suggested highlight and refresh comparison state as user edits hours
document.querySelectorAll('#satH,#satM,#bhH,#bhM,#bhOtH,#bhOtM,#otH,#otM,#sunH,#sunM,#rdwH,#rdwM,#boxH,#boxM').forEach(el => {
  el.addEventListener('input', () => {
    el.classList.remove('roster-suggested');
    updateRosterHint();
  });
});

// Tax year tab listeners are attached when the tabs are generated (see INIT).

// Settings inputs
document.getElementById('gradeSelect').addEventListener('change', () => {
  // Preserve hand-entered values: only replace the rate / pension if they still
  // hold the PREVIOUS grade's default (i.e. the user hasn't customised them).
  // The app explicitly asks staff to enter their exact payslip rate, so tapping
  // the grade (e.g. just to check it) must not silently wipe that figure.
  // lsGet(SK.grade) still holds the previous grade until saveSettings() runs.
  const _oldGrade = lsGet(SK.grade);
  const g   = document.getElementById('gradeSelect').value;
  const _gP = getPeriods().find(x => x.num === currentPeriodNum());

  const rateEl = document.getElementById('hourlyRate');
  const _oldRateDefault = (_oldGrade && GRADES[_oldGrade]) ? GRADES[_oldGrade].rate.toFixed(2) : '';
  const rateUntouched   = rateEl.value.trim() === '' || rateEl.value === _oldRateDefault;
  if (g && GRADES[g] && rateUntouched) rateEl.value = GRADES[g].rate.toFixed(2);

  const _pa = document.getElementById('pensionAmt');
  const _oldPenDefault = (_oldGrade && GRADES[_oldGrade] && _gP)
    ? (getPensionForPeriod(_oldGrade, _gP.payday) * getProRateFactor(_gP)).toFixed(2)
    : '';
  const penUntouched = !_pa || _pa.value.trim() === '' || _pa.value === _oldPenDefault;

  saveSettings(); // calls invalidateGrade() so getGrade() returns the new grade below
  if (_pa && penUntouched) _pa.value = (getPensionDefault(_gP) * getProRateFactor(_gP)).toFixed(2);
  calculate();
});
document.getElementById('hourlyRate').addEventListener('input',  () => { saveSettings(); calculate(); });
document.getElementById('taxCode').addEventListener('input',     () => { saveSettings(); calculate(); });
document.getElementById('studentLoan').addEventListener('change', () => {
  if (document.getElementById('studentLoan').value === 'none') {
    document.getElementById('slSkipCheck').checked = false;
  }
  saveSettings();
  autosave(); // persists the cleared slSkip flag; autosave() calls calculate() internally
});
// pensionAmt: save global default AND lock pension to current period immediately.
// autosave() calls calculate() internally, so no separate calculate() call needed.
document.getElementById('pensionAmt').addEventListener('input',  () => { saveSettings(); autosave(); });

// Per-period overrides
document.getElementById('slSkipCheck').addEventListener('change', autosave);
document.getElementById('otherAdj').addEventListener('input', () => {
  // If the user manually typed a negative number, honour it: set the sign flag
  // and normalise the field to the absolute value so the ± button is authoritative.
  const raw = document.getElementById('otherAdj').value;
  const v   = parseFloat(raw);
  if (v < 0) {
    _adjNegative = true;
    document.getElementById('otherAdj').value = Math.abs(v).toFixed(2);
  }
  // Positive typed value: leave _adjNegative alone — the ± button is authoritative.
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
    if (val !== 0) input.value = Math.abs(val).toFixed(2);
    updateAdjSign();
    autosave();
  }
  const btn = document.getElementById('adjSignBtn');
  let touchFired = false;
  // passive:false is required so preventDefault() actually suppresses the
  // synthesised click — iOS treats touchend as passive by default.
  btn.addEventListener('touchend', (e) => { e.preventDefault(); touchFired = true; toggleAdjSign(); }, { passive: false });
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
    lsSet(hppActualKey(priorTy), val);
  } else {
    lsDel(hppActualKey(priorTy));
  }
  updatePriorHpp(curTy);
});

// HPP formula toggle + disclaimer + back-pay cross-link
document.getElementById('hppToggleBtn').addEventListener('click', toggleHppNote);
document.getElementById('disclaimerToggle').addEventListener('click', toggleDisclaimer);
document.getElementById('hppBackPayLink').addEventListener('click', () => {
  const body = document.getElementById('backPayBody');
  // Route through the header click so initCardCollapse keeps aria-expanded in
  // sync and runs the open-time pre-fill.
  if (!body.classList.contains('open')) document.getElementById('backPayCardToggle').click();
  document.getElementById('backPayCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ── ABOUT LIGHTBOX ────────────────────────────────────────────────────────────
// Exposed to module scope so the nav-panel drawer logo can open it (the header
// logo is now a back button — see appIcon handler below). Lifecycle, SW status,
// bug link, and print button are the shared about-lightbox.js.
let openAboutLightbox = null;
(function () {
  const about = initAboutLightbox({
    appLabel: 'MYB Pay Calculator',
    getUserName: () => getLoggedMember()?.name,
  });
  if (about) openAboutLightbox = about.open;

  // Header logo is a back-to-calendar button (About moved to the drawer logo).
  const appIcon = document.getElementById('appIcon');
  if (!appIcon) return;
  appIcon.title = 'Back to calendar';
  appIcon.setAttribute('aria-label', 'Back to calendar');
  appIcon.addEventListener('click', () => { window.location.href = './index.html'; });
})();

// ── SW UPDATE AUTO-ACTIVATION ─────────────────────────────────────────────────
// Handled by the shared registerServiceWorker() call below (see "SERVICE WORKER").
// A hand-rolled duplicate of that lifecycle used to live here; it was removed at
// v12.96 because running both registered two controllerchange listeners and two
// hourly update() timers, which could fire the post-update reload twice.

// ── HELP LIGHTBOX ─────────────────────────────────────────────────────────────
// Generic lightbox driven by HELP_CONTENT — opened by any .help-btn[data-help].
// Lifecycle (focus, Escape, trap, Android Back) is the shared createLightbox.
(function () {
  const lb      = document.getElementById('helpLightbox');
  const titleEl = document.getElementById('helpLightboxTitle');
  const listEl  = document.getElementById('helpLightboxList');
  if (!lb) return;

  const help = createLightbox({
    overlay:  lb,
    content:  document.getElementById('helpLightboxContent'),
    closeBtn: document.getElementById('helpLightboxClose'),
  });

  function openHelp(key) {
    const data = HELP_CONTENT[key];
    if (!data) return;
    titleEl.textContent = data.title;
    listEl.innerHTML = data.tips.map(t => `<li>${t}</li>`).join('');
    help.open();
  }

  // Wire all ? buttons. stopPropagation prevents collapsible card toggles firing.
  document.querySelectorAll('.help-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openHelp(btn.dataset.help);
    });
  });
})();

// ── SERVICE WORKER ────────────────────────────────────────────────────────────
registerServiceWorker();

// Establish the Firebase Auth session BEFORE starting error reporting. A valid
// 30-day localStorage session can outlive the Firebase Auth session (cleared or
// lost), in which case clientErrors writes fail the `request.auth != null` rule
// and are silently dropped — exactly when we most want the report. Mirrors the
// admin/settings/operations pages. Error reporter starts regardless of the
// outcome so synchronous init errors are still captured locally.
(function _initErrorReporting() {
  const name = getSession()?.name;
  if (name) ensureFirebaseSession(name).catch(() => {/* reporter still starts below */}).finally(initErrorReporter);
  else initErrorReporter();
}());

// Shared seen-flag key — used by the welcome lightbox and the YTD notice (which
// only shows after welcome has been dismissed). Defined at module level so both
// IIFEs read the same string without risk of divergence.
const WELCOME_KEY = 'myb_pc_pay_welcome_shown';

// ── WELCOME LIGHTBOX ──────────────────────────────────────────────────────────
// Shown once, on the very first visit to the pay calculator. Never shown again.
// Dismissed by the ✕ button or clicking the overlay; guide link also dismisses it.
(function () {
  const lb = document.getElementById('welcomeLightbox');
  if (!lb) return;

  const welcome = createLightbox({
    overlay:  lb,
    content:  document.getElementById('welcomeLightboxContent'),
    closeBtn: document.getElementById('welcomeLightboxClose'),
    onOpen() {
      const badge = document.getElementById('welcomeGradeBadge');
      if (badge) {
        const g = lsGet(SK.grade);
        badge.textContent = (g && GRADES[g] ? GRADES[g].label : 'CEA & CES') + ' grade';
      }
    },
    onClose: () => lsSet(WELCOME_KEY, '1'),
  });

  lb.querySelector('.welcome-guide-link')?.addEventListener('click', welcome.close);

  if (!lsGet(WELCOME_KEY)) welcome.open();
})();

// ── YTD NOTICE ────────────────────────────────────────────────────────────────
// Shown once after the welcome lightbox has been dismissed. Reminds staff to
// enter their year-to-date figures from previous payslips so the current-period
// tax estimate reflects what has already been deducted this tax year.
(function () {
  const NOTICE_DATE = '6 Apr 2026';
  // Silently expire on a new device if the notice is older than 90 days (tax-year range).
  if (isNoticeExpired(NOTICE_DATE, 90) && !lsGet(NOTICE_YTD_KEY)) { lsSet(NOTICE_YTD_KEY, '1'); return; }
  // Show only after the welcome lightbox has been seen, and only once.
  if (!lsGet(WELCOME_KEY) || lsGet(NOTICE_YTD_KEY)) return;

  const lb = document.getElementById('noticeYtdLightbox');
  if (!lb) return;

  const notice = createLightbox({
    overlay:  lb,
    content:  document.getElementById('noticeYtdContent'),
    closeBtn: document.getElementById('noticeYtdClose'),
    onClose: () => {
      // Archive first so the notice is recorded before the seen-flag suppresses it.
      archiveNotice({
        id:      'ytd_2627',
        title:   'Enter your YTD figures',
        section: 'Pay',
        date:    NOTICE_DATE,
        body:    'Open ⚙️ Your Settings and enter your YTD Gross Pay and YTD Tax Paid from your most recent payslip for accurate monthly tax estimates.',
      });
      lsSet(NOTICE_YTD_KEY, '1');
    },
  });

  notice.open();
})();

// ── DECIMAL HOURS CONVERTER ───────────────────────────────────────────────────
(function () {
  const toggle = document.getElementById('decimalConverterToggle');
  const body   = document.getElementById('decimalConverterBody');
  const input  = document.getElementById('decimalHrsInput');
  const result = document.getElementById('decimalHrsResult');
  if (!toggle || !body || !input || !result) return;

  initCardCollapse('decimalConverterToggle', 'decimalConverterBody',
    'decimalConverterToggle', open => { if (open) input.focus(); });

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

// ── PRINT HEADER STAMP ────────────────────────────────────────────────────────
// iOS Safari does not fire beforeprint when AirPrint is invoked, so we also stamp
// eagerly on load. The beforeprint handler is kept for desktop browsers.
// onPeriodChange() also calls this so the stamp is always current when printing.
function stampPaycalcPrintLine() {
  const hdr = document.querySelector('.app-header');
  if (!hdr) return;
  const periodSel = document.getElementById('periodSelect');
  const p = periodSel ? getPeriods().find(x => x.num === +periodSel.value) : null;
  const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const label = p ? `Period P${p.num} · Paid ${fdShort(p.payday)} · Printed ${now}` : `MYB Pay Calculator · Printed ${now}`;
  hdr.setAttribute('data-print-line', label);
}
stampPaycalcPrintLine();
window.addEventListener('beforeprint', stampPaycalcPrintLine);

const _paycalcMember = getLoggedMember();
initNavPanel({
    currentPage: 'paycalc',
    memberName:  _paycalcMember?.name || null,
    isAdmin:         ROSTER_CONFIG.ADMIN_NAMES.includes(_paycalcMember?.name),
    isLinksDesigner: ROSTER_CONFIG.LINKS_DESIGNERS.includes(_paycalcMember?.name),
    onLogoClick: () => openAboutLightbox?.(),
    onSignOut:   _paycalcMember ? () => {
        clearSession(); // clears localStorage AND signs out Firebase Auth
        window.location.href = './index.html';
    } : null,
});

// (Lightbox print button is wired by about-lightbox.js — the standalone IIFE
// that lived here before v12.50 only removed .open, leaving body scroll locked.)
