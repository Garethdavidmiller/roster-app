// @ts-check
/**
 * paycalc-periods.js — Period arithmetic and select UI for paycalc.html.
 *
 * Owns: CONFIG (period anchor + tax years), getPeriods cache, bhsForYear / hasBankHoliday /
 *   hasBoxingDay, CONDITIONAL_ROWS, period select DOM helpers, tax-year tab sync,
 *   period navigation (prev / next / jump).
 * Does NOT own: grade/settings persistence (paycalc-settings.js), calculation
 *   engine (paycalc-app.js), roster hints (paycalc-roster-hint.js).
 * Edit here for: period date maths, adding a new tax year, period select UI.
 * Do not edit here for: pay maths, grade rates, settings save/load.
 */

import {
  P_YR, TAX_YEARS, getTaxYearForOffset, readTaxCode,
} from './paycalc-calc.js';
import { getBankHolidays } from './roster-data.js';
import { periodsInTaxYear } from './paycalc-hpp-schedule.js';
import { fdLong, fdShort } from './paycalc-format.js';
import { MONTH_NAMES } from './date-format.js';

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Period arithmetic constants.
// ⚠️  TAX YEAR ROLLOVER: add the new year to TAX_YEARS and the threshold tables in paycalc-calc.js.
//     NOTHING here moves by hand (.claude/rules/paycalc.md → "The tax year rollover"):
//   · LAST_OFFSET is the last tax year's last payslip, READ from TAX_YEARS (Nov 2026 debt pass —
//     it was a literal restating the table, so a new year could be added and never offered).
//   · ANCHOR_DATE never moves. Every payslip a member saves is keyed by its number, `48 + offset`
//     (getPeriods), so a new anchor would silently re-date every saved entry.
//   · FIRST_OFFSET never rises in passing, which is why it is a literal and NOT read from
//     TAX_YEARS[0]: the pension opt-out, the student-loan stop and the Year to Date source are stored
//     as payslip numbers, and dropping a year from the list leaves those naming a payslip no list
//     offers — retiring a year needs its own decision and a migration, not a side effect of an edit
//     to the table.
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
  LAST_OFFSET:    TAX_YEARS[TAX_YEARS.length - 1].last,   // today 14: internal num 62, the last of 2026/27 (payday 12 Mar 2027; printed "Period 52")
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
/** The first payslip the current member was employed for; null = not set yet (the grid's first). @type {number|null} */
let _firstEmployedPNum = null;

/**
 * The first payslip a member was employed for: the first period whose window ends on or after their
 * start date — exactly where `calcProRateFactor` stops being 0. Anybody with no `startDate`, and a
 * full-year `noProRate` secondment return, counts from the grid's first payslip.
 * @param {any} member @returns {any} the period
 */
function _joinPeriod(member) {
  const periods = getPeriods();
  const start = member?.startDate;
  if (!start || member?.noProRate) return periods[0];
  return periods.find((/** @type {any} */ p) => start <= p.cutoff) || periods[periods.length - 1];
}

/**
 * The first period of the member's JOIN tax year — the earliest period they may view. Genuine new
 * starters (a `startDate`, and NOT a full-year `noProRate` secondment return) are clamped to their
 * join year; everyone else sees the whole supported range. Pure — exported for tests.
 * @param {any} member - teamMembers entry (or null).
 * @returns {number} period num (>= the supported range's first period).
 */
export function computeEarliestVisiblePNum(member) {
  const floor = 48 + CONFIG.FIRST_OFFSET;
  const joinTy = getTaxYearForOffset(_joinPeriod(member).num - 48);
  return Math.max(floor, 48 + joinTy.first);
}

/**
 * The payslips the Pay page can show `member` — from their earliest visible period to the grid's
 * last: the span `payCalculatorPrices` (pay-audience.js) is asked over by the page's own gate and by
 * Settings' Pay Calculator Data card (24 Nov 2026), so the card shows for exactly the members the
 * page admits. Pure: it reads no stored state.
 * @param {any} member - teamMembers entry (or null)
 * @returns {any[]}
 */
export function payslipsShownTo(member) {
  const floor = computeEarliestVisiblePNum(member);
  return getPeriods().filter((/** @type {any} */ p) => p.num >= floor);
}

/** Store the current member's earliest visible period — and the first payslip they were employed
 *  for, which the Year to Date rules below keep to (a payslip from before somebody started has no
 *  figures of theirs on it). Call once from init before building selects. */
export function setEarliestVisiblePeriod(/** @type {any} */ member) {
  _earliestVisiblePNum = computeEarliestVisiblePNum(member);
  _firstEmployedPNum = _joinPeriod(member).num;
}

/** The first payslip the current member was employed for (the grid's first if unset). */
function _firstEmployed() {
  return _firstEmployedPNum ?? (48 + CONFIG.FIRST_OFFSET);
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
/** @type {WeakMap<Date[], Date[]>} */
const _bhsByList = new WeakMap();
/**
 * The year's bank holidays the pay calculator prices as bank holidays: every one but Boxing Day
 * (26 Dec), which is priced on its own at 3× (hasBoxingDay). One definition, shared with the
 * suggestion engine (paycalc-roster-suggestions.js); it lived there until Nov 2026, which made this
 * pure module load Firestore. Hot in the 28-day period scan and in hasBankHoliday() during recalc,
 * so the filtered list is kept per list getBankHolidays returns (which is itself kept per year).
 * @param {number} year @returns {Date[]}
 */
export function bhsForYear(year) {
  const all = /** @type {Date[]} */ (getBankHolidays(year));   // kept per year by roster-data.js
  let bhs = _bhsByList.get(all);
  if (!bhs) {
    bhs = all.filter((/** @type {Date} */ d) => !(d.getMonth() === 11 && d.getDate() === 26));
    _bhsByList.set(all, bhs);
  }
  return bhs;
}

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
// Selects the payslip `pNum` — and does NOTHING when this select does not offer it, where
// `select.value = x` would empty the select (the back-pay paid-in list relies on that). It was first
// written believing iOS Safari ignores `.value` with options inside <optgroup>; WebKit does not
// (measured 10 Nov 2026, desktop and iPhone emulation), so that is no longer a reason for it.
export function _setSelectPeriod(/** @type {any} */ sel, /** @type {any} */ pNum) {
  for (const o of sel.options) {
    if (+o.value === pNum) {
      o.selected = true;
      // SAY SO. Setting `selected` changes what the select holds without mutating an attribute or
      // firing an event, so nothing downstream can observe it — and since v23.36 the thing a member
      // actually READS is the enhanced trigger beside it, which repaints on a signal. Without this
      // line ←/→ and a tax-year jump moved the period (and every figure on the page) while the
      // picker went on naming the period you left: measured as "● Paid 25 Sept 2026 · P28" over a
      // page computing 11 Apr 2025, a wrong TAX YEAR under a take-home figure.
      // Deliberately NOT bubbling. A user's own pick does bubble, but this fires on the initial
      // load too, and paycalc delegates `input` on #hoursCard to mark the hours touched. No select
      // sits in that card today (measured) — non-bubbling means the fix does not depend on that
      // staying true. The trigger listens on the select itself.
      sel.dispatchEvent(new Event('input', { bubbles: false }));
      return;
    }
  }
}

/**
 * Append one option per payslip to `sel`, grouped by tax year, date first: "Paid 31 July 2026 · P20".
 * EVERY payslip list on the page is built here — the period picker, the Year to Date source, the
 * back-pay paid-in, the pension opt-out, the student-loan stop and a chosen grade's first payslip
 * (paycalc-grade-setting.js) — so a member meets one way of naming a payslip: staff remember
 * paydates, not period numbers (owner, Jul 2026), and the printed P-number stays as the cross-check
 * against the payslip.
 * @param {any} sel @param {any[]} periods
 * @param {{ currentPNum?: number }} [o]
 *   `currentPNum` marks the payslip being earned with "● ". Every list heads a tax year the same way,
 *   "Tax year 2026/27" — the student-loan stop's bare "2026/27" was the last exception (owner, 8 Nov 2026).
 */
export function appendPayslipOptions(sel, periods, { currentPNum } = {}) {
  /** @type {any} */ let group = null;
  /** @type {string|null} */ let label = null;
  for (const p of periods) {
    const ty = getTaxYearForOffset(p.num - 48);
    if (ty.label !== label) {
      label = ty.label;
      group = document.createElement('optgroup');
      group.label = `Tax year ${label}`;
      sel.appendChild(group);
    }
    const o = document.createElement('option');
    o.value = String(p.num);
    o.textContent = (currentPNum && p.num === currentPNum ? '● ' : '') + `Paid ${fdLong(p.payday)} · P${payslipPeriodNum(p)}`;
    group.appendChild(o);
  }
}

/**
 * Make a "from which payslip?" select able to SHOW the payslip already on record (paycalc-3-8).
 *
 * The pension opt-out start, the student-loan stop and a chosen grade's first payslip each list the
 * payslips the member can see (`visiblePeriods()`), and setting a select to a value no option carries
 * selects nothing. So a recorded payslip the list no longer reaches — a start date added after the
 * choice was made, or a tax year dropped from the grid at a rollover — came up blank, `calculate()`
 * read the blank loan stop as "still deducted", and the next settings save wrote the blank back:
 * erasing the loan stop and MOVING the opt-out start to the payslip on screen. Nothing said so.
 *
 * So the recorded payslip is offered ahead of the rest, in its own tax-year group and worded as every
 * payslip list words one (`appendPayslipOptions`) — or, when the grid no longer generates it at all,
 * as a plain "An earlier payslip", which is all that is still known about it. The record is then
 * what the control shows, what `calculate()` reads and what a save writes back.
 * @param {HTMLSelectElement} sel
 * @param {number|null} num  the recorded payslip (internal `p.num`); nothing is added for none
 */
export function offerRecordedPayslip(sel, num) {
  if (!num || Array.from(sel.options).some(o => Number(o.value) === num)) return;
  const p = getPeriods().find(/** @param {any} x */ x => x.num === num);
  /** @type {Node} */ let node;
  if (p) {
    node = document.createDocumentFragment();
    appendPayslipOptions(node, [p]);
  } else {
    const o = document.createElement('option');
    o.value = String(num);
    o.textContent = 'An earlier payslip, before this list starts';
    node = o;
  }
  sel.insertBefore(node, sel.querySelector('optgroup'));
}

function _populatePeriodSelect(/** @type {any} */ el, /** @type {any} */ periods, { placeholder, currentPNum } = /** @type {{ placeholder?: string, currentPNum?: number }} */ ({})) {
  if (!el) return;
  el.innerHTML = placeholder ? `<option value="">${placeholder}</option>` : '';
  appendPayslipOptions(el, periods, { currentPNum });
}

/**
 * The line shown when a deep link names a payslip this calculator does not carry — a payday before
 * its first tax year or after its last (whole-app review, Oct 2026). It used to open the current
 * payslip and say nothing, so a member who tapped Pay on April 2027 read November 2026's figures as
 * the ones they had asked for. Pure, so the words are pinned; '' when there is nothing to say.
 * @param {string} askedFor  the date or month the link named, as words — '' when it matched
 * @param {any[]} periods  the payslips on offer
 * @returns {string}
 */
export function periodLinkMissNote(askedFor, periods) {
  if (!askedFor || !periods.length) return '';
  return `There's no payslip for ${askedFor} in the calculator — it covers payslips paid `
    + `${fdLong(periods[0].payday)} to ${fdLong(periods[periods.length - 1].payday)}.`;
}

/**
 * The payslip a MONTH means: the one PAID in it (owner, 10 Nov 2026). The Calendar's 💷 Pay button
 * sends the month on screen as `?month=`, and staff name a payslip by the day it is paid — the 💷
 * marker in that month's grid is the payslip it should open.
 *
 * It used to open the payslip whose SHIFTS covered the month's 15th. A period's shifts end six days
 * before its payday, so whenever a month's payday falls before the 21st that is the payslip paid the
 * month AFTER: from November 2026 the Pay button opened the 18 Dec payslip while the 20 Nov one had
 * not been paid.
 *
 * A 28-day cycle pays thirteen times a year, so one month a year holds two paydays (July 2026: 3 Jul
 * and 31 Jul). Then it is the first of the two still to be paid, or the later once both are — the
 * one nearer today. Null when no payslip on offer is paid in that month (before or after the
 * calculator's range, or before a new starter's join year); the caller says so (`periodLinkMissNote`).
 * @param {any[]} periods  the payslips on offer, oldest first
 * @param {number} year
 * @param {number} month  1-based, as the link writes it
 * @param {Date} [now]
 * @returns {any|null}
 */
export function periodPaidInMonth(periods, year, month, now = new Date()) {
  const inMonth = periods.filter((/** @type {any} */ p) => p.payday.getFullYear() === year && p.payday.getMonth() === month - 1);
  if (!inMonth.length) return null;
  return inMonth.find((/** @type {any} */ p) => p.payday > now) ?? inMonth[inMonth.length - 1];
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

  // The current earning period (first future payday) — also the default selection.
  const upcoming     = periods.find((/** @type {any} */ p) => p.payday > today);
  const _currentPNum = upcoming ? upcoming.num : periods[periods.length - 1].num;
  let defPNum        = _currentPNum;

  // URL params let the roster calendar pre-select a specific period.
  const _urlParams = new URLSearchParams(window.location.search);
  const _paydayParam = _urlParams.get('payday');
  const _monthParam  = _urlParams.get('month');
  let _askedFor = '';   // the payslip a link asked for and the list does not hold, as words
  if (_paydayParam) {
    const [_py, _pm, _pd] = _paydayParam.split('-').map(Number);
    const _matched = periods.find((/** @type {any} */ p) =>
      p.payday.getFullYear() === _py &&
      p.payday.getMonth()    === _pm - 1 &&
      p.payday.getDate()     === _pd
    );
    if (_matched) defPNum = _matched.num;
    else if (_py && _pm >= 1 && _pm <= 12 && _pd) _askedFor = fdLong(new Date(_py, _pm - 1, _pd));
  } else if (_monthParam) {
    const [_my, _mm] = _monthParam.split('-').map(Number);
    // The payslip PAID in that month — the 💷 in the Calendar's grid — not the one whose shifts
    // cover it, which is usually paid the month after (periodPaidInMonth, owner 10 Nov 2026).
    const _matched = periodPaidInMonth(periods, _my, _mm, today);
    if (_matched) defPNum = _matched.num;
    // "June 2027" in full, as the paydays in the same sentence are (`fdLong`) — owner, 22 Nov 2026.
    else if (_my && _mm >= 1 && _mm <= 12) _askedFor = `${MONTH_NAMES[_mm - 1]} ${_my}`;
  }
  const _note = document.getElementById('periodLinkNote');
  if (_note) { _note.textContent = periodLinkMissNote(_askedFor, periods); _note.hidden = !_note.textContent; }

  _populatePeriodSelect(sel, periods, { currentPNum: _currentPNum });

  _setSelectPeriod(sel, defPNum);
  buildBackPayPeriodSelect();
  return _currentPNum; // coordinator stores this as _defaultPeriodNum
}

// ── WHICH PAYSLIP A YEAR TO DATE PAIR CAME FROM (72-hour review) ─────────────────────────────────
//
// Payslips are ISSUED before payday — so between a period's cut-off and its payday the member may
// already hold the payslip "today's" period will pay, and copy its Year to Date totals. Until the
// review the picker offered only payslips whose payday had passed, and the first-entry stamp named
// the one before today's: figures copied from the new payslip were anchored one payslip early, the
// cumulative method then added that payslip's own pay on top, and it was counted twice (measured:
// £193.40 of tax over on a £3,300 payslip). The two rules below are the fix.

/** @returns {{ upcoming: any, today: number }} the first unpaid payslip and its number, at `now`. */
function _todayAt(/** @type {Date} */ now) {
  const periods = getPeriods();
  const upcoming = periods.find((/** @type {any} */ p) => p.payday > now) ?? null;
  return { upcoming, today: upcoming ? upcoming.num : periods[periods.length - 1].num };
}

/**
 * Could the member be holding `p`'s payslip yet? From its CUT-OFF, not its payday — payslips are
 * issued before payday, so the one about to be paid may already be in their hand. Every paid
 * payslip is inside it too, because a cut-off always falls before its payday.
 *
 * ONE rule for the two surfaces that read a payslip the member holds (v24.87): the Year to Date
 * picker below, and the "Check against your payslip" box, which until then appeared only from
 * payday — so a member comparing the payslip in their hand, days before it paid, found no box.
 * @param {{ cutoff: Date }} p @param {Date} [now]
 */
export function payslipMayBeInHand(p, now = new Date()) {
  return p.cutoff <= now;
}

/**
 * May `p` be picked as the source of `ty`'s Year to Date figures? Any of the year's PAID payslips —
 * and, from its cut-off, the payslip about to be paid, because it may already be in the member's hand.
 * (It read `p.num < today || p.cutoff <= now` until v24.87; the first half is implied by the second,
 * since a paid payslip's cut-off is behind it, so the shared rule is the same answer.) Never a payslip
 * from before the member started: it carries no figures of theirs (whole-app review, Nov 2026).
 * @param {any} p @param {{ first:number, last:number }} ty @param {Date} [now]
 * @param {number} [firstPNum] the member's first payslip — `setEarliestVisiblePeriod` records it
 */
export function ytdSourceOffered(p, ty, now = new Date(), firstPNum = _firstEmployed()) {
  if (p.num < 48 + ty.first || p.num > 48 + ty.last || p.num < firstPNum) return false;
  return payslipMayBeInHand(p, now);
}

/**
 * The payslip to anchor Year to Date figures to when the member has not said: the payslip before
 * today's, clamped into the year — the standing assumption since v17.98. A member copying from a
 * payslip issued before its payday can correct it: the picker offers that payslip from its cut-off
 * (`ytdSourceOffered`). A window that recorded NOTHING until the member picked was tried in the Sep
 * 2026 review and removed the same day: a member who never picked was stamped one payslip LATE on
 * the first open after payday, the mirror image of the double count it set out to prevent.
 * @param {{ first:number, last:number }} ty @param {Date} [now]
 * @returns {number} a period number
 */
export function ytdAutoSource(ty, now = new Date()) {
  const { today } = _todayAt(now);
  return Math.min(Math.max(today - 1, 48 + ty.first), 48 + ty.last);
}

/**
 * The source to RECORD for `ty`'s Year to Date figures as the card loads, or null to record nothing.
 * Only when no source was EVER recorded (`raw` is null) and figures are in the boxes: figures from
 * before sources were recorded are anchored to the app's old standing assumption (`ytdAutoSource`),
 * so a maintained member's next estimate does not move. A recorded '0' is the member deliberately
 * un-anchoring them (the blank placeholder) and is never re-stamped — or the next period change would
 * quietly re-engage the cumulative method on figures they had detached. When that payslip cannot be in
 * the member's hand — not yet issued, or from before they started — the figures came from no payslip
 * of theirs in this year, and `YTD_SRC_EARLY` says so (below).
 * @param {string|null} raw  what storage holds @param {boolean} hasFigures
 * @param {{ first:number, last:number }} ty @param {Date} [now]
 * @param {number} [firstPNum] the member's first payslip — `setEarliestVisiblePeriod` records it
 * @returns {number|string|null} a period number, `YTD_SRC_EARLY`, or null
 */
export function ytdSourceToStamp(raw, hasFigures, ty, now = new Date(), firstPNum = _firstEmployed()) {
  if (raw != null || !hasFigures) return null;
  const src = ytdAutoSource(ty, now);
  // NEVER A PAYSLIP THAT CANNOT BE IN HAND (21 Nov 2026). Before the year's first payday,
  // `ytdAutoSource` clamps into the year and names its first payslip — not yet issued, and not
  // offered by the picker either, so the card showed its placeholder while storage held a source.
  // Last year's whole-year totals typed in March were then read as April's, and May's payslip was
  // charged the year's tax again (£2,967.84 where £435.00 was right). The same rule as the picker.
  // …AND THE FIGURES ARE NEVER FILED LATER EITHER (24 Nov 2026). Recording nothing only put the stamp
  // off: the first load after that payslip's cut-off found figures with no source and filed them
  // against it, so last year's totals were read as April's after all. A K code, exempt from the
  // under-the-code check, then charged May's payslip about £1,650 where £770.40 was right; any other
  // code was told the figures were "from your 10 Apr payslip". So the marker is recorded instead.
  const srcP = getPeriods().find((/** @type {any} */ x) => x.num === src);
  return srcP && ytdSourceOffered(srcP, ty, now, firstPNum) ? src : YTD_SRC_EARLY;
}

/**
 * The source recorded for Year to Date figures entered while no payslip of the member's in that tax
 * year could be in hand (`ytdSourceToStamp`) — last year's totals typed in March, or a joiner's
 * figures from before their first payslip. It names no payslip: every reader that parses a source
 * reads it as none, so the figures are used on no payslip and the card asks which payslip they came
 * from. It is not '0' (the member's own "not from a payslip"), because figures TYPED in again are a
 * first entry again (`refreshYtdSrc`'s `typed`), while the load-time stamp never files them.
 */
export const YTD_SRC_EARLY = 'early';

/**
 * The source to MOVE `ty`'s Year to Date figures to as the member types them in again, or null to
 * leave it (whole-app review, Nov 2026). The figures change on every payslip, so the take-home line
 * asks for the latest ones each month — and the source used to be stamped on FIRST entry only. Typing
 * the new totals over figures recorded from an older payslip left them anchored to that one: the line
 * went on asking, the card said "update them", and the payslip after the old source ran the cumulative
 * method on totals that already held its own pay (£628.80 of tax for £435.00 on 23 Oct 2026).
 *
 * So: when the recorded source is OLDER than the payslip the line names for the payslip on screen
 * (`ytdCopyFrom` — the same rule), the figures being typed are taken to come from that payslip. The
 * card's note names it and its picker corrects it, as for the first-entry stamp. A source never
 * recorded is the stamp's business, a deliberate '0' (detached) stays detached, and a payslip already
 * paid or a source at or after the one named is left alone.
 * @param {string|null} raw  what storage holds
 * @param {{ p: any, ty: { first: number }, now?: Date, firstPNum?: number }} a
 * @returns {number|null}
 */
export function ytdSourceAfterRetype(raw, { p, ty, now = new Date(), firstPNum = _firstEmployed() }) {
  const src = parseInt(raw ?? '', 10) || 0;
  if (!src) return null;
  const from = ytdCopyFrom({ p, ty, now, firstPNum });
  return from && src < from.num ? from.num : null;
}

/**
 * What the Year to Date card says about its figures on payslip `p`: the note under its heading, and
 * the chip in its header that is readable while the card is shut. Both are written together, so every
 * path that refreshes one refreshes the other.
 *
 * "IN USE" IS WHAT computeTax DID, NOT WHAT THE BOXES HOLD (whole-app review, Nov 2026). `inUse` is
 * its `usingCumulative`, which calculate() hands over on every run. The card used to work it out for
 * itself — "the payslip after the source, and either box has text" — and so said "✓ in use … they
 * sharpen this payslip's tax estimate" with one box still blank, under a week 1 / month 1 code that
 * never uses the figures, and with both boxes emptied, while the standard method ran each time.
 *  - The chip is '' when there is nothing to report: no figures, no source, or the year's first
 *    payslip, where Year to Date starts again.
 *  - The note is '' while no source is recorded or no figure is entered: the card's hint, its field
 *    labels and the select's label all ask for them already, and a fourth asking was noise.
 *  - Otherwise it names the source payslip, date first. On the payslip straight after it, figures not
 *    in use say why (a code that works each payslip out alone, a pair that does not fit the code —
 *    `misfit`, computeTax's `ytdMisfit` — or a pair not yet complete); elsewhere it offers the payslip
 *    before this one to update from once that one has been paid — only when that payslip is newer
 *    than the source, and never one from before the member started.
 * @param {{ p: any, ty: { label: string, first: number }, src: number, hasFigures: boolean,
 *           inUse?: boolean, taxCode?: string, misfit?: boolean, now?: Date, firstPNum?: number }} a
 * @returns {{ note: string, noteLive: boolean, chip: string, chipLive: boolean }}
 */
export function ytdAnchorStatus({ p, ty, src, hasFigures, inUse = false, taxCode = '', misfit = false, now = new Date(), firstPNum = _firstEmployed() }) {
  const srcP = src ? getPeriods().find((/** @type {any} */ x) => x.num === src) : null;
  const next = !!srcP && p.num === src + 1;
  const first = (p.num - 48) - ty.first + 1 <= 1;   // 1-based HMRC period within the tax year
  const chip = (!hasFigures || !srcP || first) ? '' : (inUse ? '✓ in use' : 'not in use');
  const out = { noteLive: inUse, chip, chipLive: inUse && !!chip };
  if (first) return { ...out, note: `This is the first payslip of ${ty.label} — Year to Date starts fresh in April, so you can leave these blank.` };
  if (!srcP || !hasFigures) return { ...out, note: '' };
  const from = `your <strong>${fdShort(srcP.payday)} payslip</strong> (P${payslipPeriodNum(srcP)})`;
  if (inUse) return { ...out, note: `<span aria-hidden="true">✓</span> Your Year to Date figures are from ${from} — they sharpen <strong>this payslip's</strong> tax estimate.` };
  // Never "the standard method" (18 Nov 2026): a term the member has no way to know. Each note says
  // what happens instead — this payslip's tax worked out from this payslip alone.
  if (next) return { ...out, note: readTaxCode(taxCode).nonCumulative
    ? `Your Year to Date figures are from ${from}, but a tax code ending in W1, M1 or X works out each payslip on its own, so these figures are not used.`
    : misfit
      // The figures are complete, but they and the code disagree (owner, 15 Nov 2026). Either side can
      // be wrong: the code in Your Settings, or the payslip chosen as their source — a source filed one
      // payslip out reads exactly like a wrong code (21 Nov 2026). The Income Tax line carries the two
      // figures; this says what to check, the source first because it is on this card.
      ? `Your Year to Date figures are from ${from}, but they don't fit your tax code, so this payslip's tax is worked out from this payslip alone. Check they came from that payslip, and that the code in Your Settings is the one printed on it.`
      : `Your Year to Date figures are from ${from} — fill in both <strong>Taxable Pay</strong> and <strong>Tax Paid</strong> to sharpen this payslip's tax estimate.` };
  // Only a payslip NEWER than the source is worth updating from (17 Nov 2026). On the source itself, or
  // one before it, the payslip before this one is OLDER than the figures already held — so the note
  // asked the member to replace good figures with stale ones, the opposite of the January notice that
  // had just sent them to the newest. The next payslip then found them misfitting its code.
  const prevP = getPeriods().find((/** @type {any} */ x) => x.num === p.num - 1);
  const upd = prevP && prevP.num > src && prevP.num >= firstPNum && prevP.num < _todayAt(now).today
    ? ` To sharpen this one, copy the figures from your <strong>${fdShort(prevP.payday)} payslip</strong> (P${payslipPeriodNum(prevP)}).`
    : '';
  // The payslip they DO sharpen is named (21 Nov 2026): "the payslip straight after it … to sharpen
  // it" used one "it" for the source and the next for this payslip, in a 32-word sentence.
  const nextP = getPeriods().find((/** @type {any} */ x) => x.num === src + 1);
  const sharpens = nextP ? `your <strong>${fdShort(nextP.payday)} payslip</strong>` : 'the payslip straight after it';
  return { ...out, note: `Your Year to Date figures are from ${from}, so they only sharpen ${sharpens}. This payslip's tax is worked out from this payslip alone.${upd}` };
}

/**
 * Populate the Year-to-Date "From which payslip?" selector with the tax year's PAID payslips
 * (you can only copy totals from a payslip that exists — plus, from its cut-off, the one about to be
 * paid: `ytdSourceOffered`), newest first — the latest payslip is
 * the overwhelmingly common source. Rebuilding clears the selection; the caller re-applies the
 * stored source afterwards. (v17.98)
 * @param {{ first:number, last:number }} ty - the tax year whose payslips to offer
 */
export function buildYtdSourceSelect(ty) {
  const sel = document.getElementById('ytdSrcSelect');
  if (!sel) return;
  const paid = visiblePeriods()
    .filter((/** @type {any} */ p) => ytdSourceOffered(p, ty))
    .reverse();
  // Short placeholder (v18.49): the previous "— which payslip did they come from? —" truncated at
  // 390px; the label + inline note above the select already ask the full question.
  _populatePeriodSelect(sel, paid, { placeholder: '— choose a payslip —' });
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
// The navigation below takes the coordinator's `onPeriodChange` as a callback rather than importing
// it: it lives inside paycalc-app.js's init(), and paycalc-app.js imports this module.

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
  const first   = periodsInTaxYear(ty, getPeriods())[0];
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

/**
 * The payslip whose Year to Date figures would sharpen the estimate for `p`, or null when the result
 * card should say nothing about them (owner, 7 Nov 2026).
 *
 * The figures change on every payslip, and calculate() uses them only on the payslip straight after
 * the one they were copied from; anywhere else tax is estimated from that payslip alone. So the line
 * under the take-home £ asks for the latest figures wherever copying them would change THIS
 * estimate, and stays quiet everywhere else:
 *  - never on a payslip already paid: the year keeps ONE pair of figures, so asking for an older
 *    payslip's would undo the estimate the member is waiting on;
 *  - never on the tax year's first payslip, where Year to Date starts fresh;
 *  - never for a non-cumulative code (W1, M1, X), NT or a flat-rate code, which the figures cannot change;
 *  - never for a code the calculator does not recognise (`recognised` is computeTax's): it is priced
 *    on the standard allowance, and Year to Date figures make a wrong code's estimate WORSE, which is
 *    why the "Check against your payslip" line holds that advice back too;
 *  - never while the figures are IN USE (`inUse` is computeTax's `usingCumulative`, so a box holding
 *    something unreadable counts as not in use), nor when they come from this payslip or a later one;
 *  - never while they do not fit the tax code (`misfit`, computeTax's `ytdMisfit`, owner, 15 Nov
 *    2026): they are already the right payslip's, so asking for them again would send the member to
 *    copy the same two figures, and the Year to Date card says what to check instead;
 *  - never for a payslip from before the member started (`firstPNum`), which carries none of theirs;
 *  - and only once the payslip to copy from can be in the member's hand (from its cut-off).
 * Which payslip that is, is `ytdCopyFrom` — shared with the source a re-typed pair moves to.
 * @param {{ p: any, ty: { first: number }, src: number, inUse: boolean, taxCode: string,
 *           recognised?: boolean, misfit?: boolean, now?: Date, firstPNum?: number }} a
 * @returns {any} the period to copy the figures from, or null
 */
export function ytdUpdateFrom({ p, ty, src, inUse, taxCode, recognised = true, misfit = false, now = new Date(), firstPNum = _firstEmployed() }) {
  if (!p) return null;
  const read = readTaxCode(taxCode);   // as computeTax reads it, so the two cannot disagree about one
  if (read.nonCumulative) return null;
  if (read.base === 'NT') return null;
  // A FLAT-RATE code (BR, D0, D1 and the Scottish flat rates) takes the same share of every pound,
  // so figures that fit it — the only ones used since 21 Nov 2026 — never move its tax.
  if (/^(S?BR|S?D[01]|SD[23])$/.test(read.base)) return null;
  if (recognised === false) return null;
  if (misfit) return null;
  if (inUse || (src && src >= p.num)) return null;
  return ytdCopyFrom({ p, ty, now, firstPNum });
}


/**
 * The payslip whose Year to Date figures would sharpen the estimate for `p` — the one before it — or
 * null where there is none to ask for: `p` already paid (the year keeps one pair of figures), the tax
 * year's first payslip, a payslip from before the member started, or one not yet in their hand (from
 * its cut-off). The ONE rule behind the take-home line (`ytdUpdateFrom`) and the source a re-typed
 * pair moves to (`ytdSourceAfterRetype`), so the payslip the line names is the payslip recorded.
 * @param {{ p: any, ty: { first: number }, now: Date, firstPNum: number }} a
 * @returns {any}
 */
function ytdCopyFrom({ p, ty, now, firstPNum }) {
  const prevP = p ? getPeriods().find((/** @type {any} */ x) => x.num === p.num - 1) : null;
  if (!prevP) return null;
  if (p.num < _todayAt(now).today) return null;
  if (p.num <= 48 + ty.first) return null;
  if (prevP.num < firstPNum) return null;
  return payslipMayBeInHand(prevP, now) ? prevP : null;
}
