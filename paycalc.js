import { APP_VERSION, CONFIG as ROSTER_CONFIG, teamMembers, getBaseShift, formatISO, escapeHtml } from './roster-data.js?v=8.09';
import { db, collection, query, where, getDocs } from './firebase-client.js?v=8.09';
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
// Single source of truth for all app constants — matches MYB Roster pattern.
// ⚠️  TAX YEAR ROLLOVER: Each April, update the following:
//     ANCHOR_DATE, FIRST_OFFSET, LAST_OFFSET,
//     and the TAX / NI / SL threshold values below.
//     P48 anchor (13 Feb 2026) stays fixed as the offset reference point.
const CONFIG = {
  // Period arithmetic
  ANCHOR_DATE:    new Date(2026, 1, 13), // P48 payday: 13 Feb 2026 (fixed reference)
  PERIOD_DAYS:    28,
  PERIODS_PER_YR: 13,
  CONTRACTED_HRS: 140,                   // default; per-grade value from GRADES object
  LONDON_ALLOW:   276.16,               // London Allowance per period (£3,590.08/yr)
  FIRST_OFFSET:   -11,   // P37 — first period of 2025/26 (~11 Apr 2025)
  LAST_OFFSET:     14,   // P62 — last period of 2026/27 (~11 Mar 2027)
  // ── Tax year definitions ────────────────────────────────────────────────────
  // "Tax year" here means: payday falls in that Apr→Mar window.
  // 2025/26: P37 (paid ~11 Apr 2025) → P49 (paid ~13 Mar 2026)  offsets -11 to +1
  // 2026/27: P50 (paid ~10 Apr 2026) → P62 (paid ~11 Mar 2027)  offsets  +2 to +14
  // hppPaidJan = the January in which Chiltern pay that year's HPP lump sum
  TAX_YEARS: [
    // londonAllowPre=pre-award, londonAllow=post-award, londonAllowFrom=first payday at new rate
    { label: '2025/26', first: -11, last:  1, hppPaidJan: 2027,
      londonAllow: 276.16, londonAllowPre: 267.12, londonAllowFrom: new Date(2025, 9, 24) },
    { label: '2026/27', first:   2, last: 14, hppPaidJan: 2028, londonAllow: 276.16 }, // ⚠️ Update londonAllowPre + londonAllow when pay award confirmed
  ],
};

// Convenience aliases (keeps calculation code readable)
const P_YR   = CONFIG.PERIODS_PER_YR;

// ── TAX & NI THRESHOLDS BY TAX YEAR ──────────────────────────────────────────
// All annual figures ÷ 13 to give 4-weekly amounts.
// Both years confirmed: personal allowance and band thresholds frozen at 2025/26 levels
// until April 2028 (Autumn Budget 2024). NI rates and thresholds unchanged for 2026/27.
// ⚠️  Review after each Autumn Budget and Spring Statement.
const TAX_BY_YEAR = {
  '2025/26': { pa: 12570/P_YR, b: 50270/P_YR, h: 125140/P_YR, r20:0.20, r40:0.40, r45:0.45 },
  '2026/27': { pa: 12570/P_YR, b: 50270/P_YR, h: 125140/P_YR, r20:0.20, r40:0.40, r45:0.45 }, // confirmed frozen
};
// NI thresholds are set weekly by HMRC; the correct 4-weekly value is weekly × 4.
// PT 2025/26: £242/wk × 4 = £968. UEL 2025/26: £967/wk × 4 = £3,868.
// Using annual ÷ 13 (£966.97 / £3,867.70) would overstate NI by ~£0.09/period.
const NI_BY_YEAR = {
  '2025/26': { pt: 242 * 4, uel: 967 * 4, r8:0.08, r2:0.02 },
  '2026/27': { pt: 242 * 4, uel: 967 * 4, r8:0.08, r2:0.02 }, // confirmed unchanged
};
// Student loan thresholds by tax year — HMRC publishes these each April.
// ⚠️ Review after each Autumn Budget and update next tax year's values.
const SL_BY_YEAR = {
  '2025/26': {
    plan1:   { t: 24990/P_YR, r: 0.09 },
    plan2:   { t: 27295/P_YR, r: 0.09 },
    plan4:   { t: 31395/P_YR, r: 0.09 }, // Scotland
    plan5:   { t: 25000/P_YR, r: 0.09 },
    postgrad:{ t: 21000/P_YR, r: 0.06 },
  },
  '2026/27': {
    plan1:   { t: 26900/P_YR, r: 0.09 }, // HMRC SL guidance Apr 2026
    plan2:   { t: 29385/P_YR, r: 0.09 }, // HMRC SL guidance Apr 2026
    plan4:   { t: 33795/P_YR, r: 0.09 }, // HMRC SL guidance Apr 2026 (Scotland)
    plan5:   { t: 25000/P_YR, r: 0.09 }, // unchanged
    postgrad:{ t: 21000/P_YR, r: 0.06 }, // unchanged
  },
};

// Scottish income tax bands (Holyrood-set). Bands are stored as per-period
// TAXABLE income tops (i.e. total income threshold minus PA, divided by P_YR).
// PA is still set by Westminster (£12,570 both years).
// Source: gov.scot Scottish Income Tax factsheets 2025/26 and 2026/27.
// ⚠️ Update each year — especially starter and basic tops which Holyrood adjusts annually.
const SCOTTISH_TAX_BY_YEAR = {
  '2025/26': { pa: 12570/P_YR, bands: [
    { top:  2827/P_YR, rate: 0.19 }, // Starter  19%  £12,571–£15,397
    { top: 14921/P_YR, rate: 0.20 }, // Basic    20%  £15,397–£27,491
    { top: 31092/P_YR, rate: 0.21 }, // Intermediate 21%  £27,491–£43,662
    { top: 62430/P_YR, rate: 0.42 }, // Higher   42%  £43,662–£75,000
    { top: 112570/P_YR, rate: 0.45 }, // Advanced 45%  £75,000–£125,140
    { top: Infinity,   rate: 0.48 }, // Top      48%  over £125,140
  ]},
  '2026/27': { pa: 12570/P_YR, bands: [
    { top:  3967/P_YR, rate: 0.19 }, // Starter  19%  £12,571–£16,537
    { top: 16956/P_YR, rate: 0.20 }, // Basic    20%  £16,537–£29,526
    { top: 31092/P_YR, rate: 0.21 }, // Intermediate 21%  £29,526–£43,662
    { top: 62430/P_YR, rate: 0.42 }, // Higher   42%  £43,662–£75,000
    { top: 112570/P_YR, rate: 0.45 }, // Advanced 45%  £75,000–£125,140
    { top: Infinity,   rate: 0.48 }, // Top      48%  over £125,140
  ]},
};

// HPP: (Gross − Basic) × 4/52 — confirmed by Marie Firby, Chiltern payroll
const HPP_FRACTION = 4 / 52;

// ── GRADES — contractual data per grade ───────────────────────────────────────
// Each grade entry drives contracted hours, default rate, and default pension.
// 2026/27 rates: CES and CEA pay awards not yet confirmed — update when announced.
const GRADES = {
  cea: { label: 'CEA — £20.74/hr', rate: 20.74, contr: 140, pension: 154.77 },
  ces: { label: 'CES — £21.81/hr', rate: 21.81, contr: 140, pension: 154.77 }, // 2025/26 rate; 2026/27 TBC
  // dispatch: { label: 'Dispatch', rate: 0, contr: 0, pension: 0 }, // add when confirmed
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
  const base = getContr();
  if (!p) return base;
  const member = getLoggedMember();
  if (!member?.startDate) return base;
  const sd = member.startDate;
  if (sd <= p.start) return base;          // started before this period — full hours
  if (sd > p.cutoff) return 0;             // not yet employed in this period
  const msPerDay     = 86400000;
  const daysEmployed = Math.round((p.cutoff - sd) / msPerDay) + 1;
  const totalDays    = Math.round((p.cutoff - p.start) / msPerDay) + 1;
  return Math.round(base * daysEmployed / totalDays);
}

/** Return the grade-level pension default, based on whatever grade is saved in localStorage. */
function getPensionDefault() {
  const g = localStorage.getItem(SK.grade);
  return GRADES[g && GRADES[g] ? g : 'cea']?.pension ?? '';
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
      '<strong>London Allowance (£276.16/period):</strong> a fixed supplement paid to all Marylebone staff. It\'s included automatically — you don\'t need to enter it.',
      'Your hourly rate is saved per tax year — updating it for 2026/27 won\'t affect your 2025/26 figures. Pension and hours are saved per individual period.',
    ],
  },
  accuracy: {
    title: 'Match Your Payslip — why it helps',
    tips: [
      'By default, the app divides your tax-free allowance equally across all 13 pay periods. This is usually accurate, but can drift if you had an unusually high or low pay period earlier in the year.',
      'Entering <strong>Year to Date figures</strong> switches to the same calculation method your employer uses — significantly more accurate.',
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
// England & Wales bank holidays for the covered period range (P37–P62, Apr 2025–Mar 2027).
// Boxing Day (26 Dec) is handled separately by hasBoxingDay() at 3× rate.
// ⚠️ Update each year with confirmed dates from gov.uk/bank-holidays
const BANK_HOLIDAYS_EW = [
  new Date(2025,  3, 18), // Good Friday 2025
  new Date(2025,  3, 21), // Easter Monday 2025
  new Date(2025,  4,  5), // Early May BH 2025
  new Date(2025,  4, 26), // Spring BH 2025
  new Date(2025,  7, 25), // Summer BH 2025
  new Date(2025, 11, 25), // Christmas Day 2025
  new Date(2026,  0,  1), // New Year's Day 2026
  new Date(2026,  3,  3), // Good Friday 2026
  new Date(2026,  3,  6), // Easter Monday 2026
  new Date(2026,  4,  4), // Early May BH 2026
  new Date(2026,  4, 25), // Spring BH 2026
  new Date(2026,  7, 31), // Summer BH 2026
  new Date(2026, 11, 25), // Christmas Day 2026
  new Date(2026, 11, 28), // Boxing Day substitute 2026 (26 Dec is a Saturday → Mon 28 Dec)
  new Date(2027,  0,  1), // New Year's Day 2027
];

function hasBankHoliday(p) {
  // Returns true if any E&W bank holiday (other than 26 Dec) falls in the period window
  return BANK_HOLIDAYS_EW.some(bh => bh >= p.start && bh <= p.cutoff);
}

function isDateInBHList(d) {
  return BANK_HOLIDAYS_EW.some(bh =>
    bh.getFullYear() === d.getFullYear() &&
    bh.getMonth()    === d.getMonth()    &&
    bh.getDate()     === d.getDate()
  );
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

// ── TAX YEAR HELPERS ──────────────────────────────────────────────────────────
function getTaxYearForOffset(offset) {
  return CONFIG.TAX_YEARS.find(ty => offset >= ty.first && offset <= ty.last) || CONFIG.TAX_YEARS[0];
}
function getThresholds(yearLabel) {
  const ty = CONFIG.TAX_YEARS.find(t => t.label === yearLabel) || CONFIG.TAX_YEARS[0];
  if (!TAX_BY_YEAR[yearLabel]) console.warn(`[PayCalc] No tax data for ${yearLabel} — using 2025/26 thresholds. Update TAX_BY_YEAR, NI_BY_YEAR, SL_BY_YEAR, and SCOTTISH_TAX_BY_YEAR.`);
  return {
    tax:         TAX_BY_YEAR[yearLabel]          || TAX_BY_YEAR['2025/26'],
    scottishTax: SCOTTISH_TAX_BY_YEAR[yearLabel] || SCOTTISH_TAX_BY_YEAR['2025/26'],
    ni:          NI_BY_YEAR[yearLabel]           || NI_BY_YEAR['2025/26'],
    sl:          SL_BY_YEAR[yearLabel]           || SL_BY_YEAR['2025/26'],
    londonAllow: ty.londonAllow,
  };
}
/**
 * Return the London Allowance for a specific pay period.
 * When a pay award mid-year changes the allowance, periods before londonAllowFrom
 * use londonAllowPre; from londonAllowFrom onwards use londonAllow.
 * @param {{payday: Date}} p
 * @param {{londonAllow: number, londonAllowPre?: number, londonAllowFrom?: Date}} ty
 * @returns {number}
 */
function getLondonAllowanceForPeriod(p, ty) {
  if (ty.londonAllowPre && ty.londonAllowFrom && p.payday < ty.londonAllowFrom) {
    return ty.londonAllowPre;
  }
  return ty.londonAllow;
}


/**
 * Apply progressive tax bands to a taxable amount.
 * @param {number} taxable - Taxable income (already after personal allowance).
 * @param {Array<{top: number, rate: number}>} bands - Bands with cumulative taxable tops.
 * @param {number} [scale=1] - Multiply all tops by this factor (for cumulative PAYE with N periods).
 * @returns {number} Tax due.
 */
function calcBandedTax(taxable, bands, scale = 1) {
  let tax = 0, prev = 0;
  for (const band of bands) {
    if (taxable <= prev) break;
    const top   = band.top === Infinity ? Infinity : band.top * scale;
    const slice = Math.min(taxable, top) - prev;
    tax += slice * band.rate;
    prev = top;
  }
  return tax;
}

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

  // Clear the override cache before rendering the hint — without this, the first
  // hint render uses override data from the previous period (stale Firestore results).
  _overrideFetchToken++;
  _overridesByDate = new Map();
  // 'checking' if a Firestore fetch is about to start, 'base-only' if no session logged in.
  _overridesFetchState = session2?.name ? 'checking' : 'base-only';

  // Update roster suggestion card and joiner notice for this period.
  updateRosterHint();
  updateJoinerNotice(p);

  // Update Pay → Calendar link for this period
  const _rvl = document.getElementById('rosterViewLink');
  if (_rvl) _rvl.href = `./index.html?date=${formatISO(p.start)}`;

  // Fetch admin-added overrides from Firestore in the background.
  if (session2?.name) fetchOverrideSpecialDaysForPeriod(p, session2.name);

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
  // Restore pension from period data if saved; otherwise use the global Settings default.
  // `d.pension != null` is intentionally loose-null so that pension = 0 (no deduction)
  // is preserved correctly — 0 is falsy and would otherwise fall through to the default.
  const pa = document.getElementById('pensionAmt');
  if (pa) {
    if (d.pension != null) {
      pa.value = d.pension;
    } else {
      pa.value = localStorage.getItem(SK.pension) ?? getPensionDefault();
    }
  }
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
  localStorage.setItem(SK.pension,   document.getElementById('pensionAmt').value);
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
}

// ── ROSTER-AWARE FILL ─────────────────────────────────────────────────────────

/**
 * Scan the period window using the logged-in member's base roster, merged
 * with any admin-entered overrides from Firestore. Overrides *replace* the
 * base shift for a day (so an AL/RD/SICK override on a Sunday correctly
 * suppresses that Sunday's base shift). Returns totals for Saturday, Sunday,
 * Bank Holiday, RDW, and Boxing Day shifts, or null if nothing applies.
 */

// Per-date override cache for the current period — YYYY-MM-DD → { type, value }.
// Populated asynchronously by fetchOverrideSpecialDaysForPeriod(); read
// synchronously by getRosterSuggestion(). Cleared on every period change so
// stale data from the previous period can never leak into the current one.
let _overridesByDate = new Map();

// Monotonic request token — incremented on every period change. A Firestore
// fetch only writes its results if its token is still the latest, so a slow
// fetch from an earlier period can never overwrite the current period's data.
let _overrideFetchToken = 0;

// 'checking':  Firestore fetch in progress — overrides not yet applied.
// 'base-only': No session logged in, or fetch failed — showing base roster only.
// 'loaded':    Firestore succeeded — overrides applied to suggestions.
let _overridesFetchState = 'base-only';

let _adjNegative = false; // tracks intended sign of otherAdj independently of value

/**
 * Queries Firestore for override documents in the period window and stores
 * them in _overridesByDate keyed by ISO date. Non-work values (AL, RD, SICK,
 * SPARE) are kept — getRosterSuggestion needs to know about them to skip the
 * base shift on that day.
 *
 * Race protection: captures a fetch token on entry and discards the response
 * if a newer period change has superseded this fetch while it was in flight.
 *
 * Fires and forgets from onPeriodChange — if Firestore is unavailable the
 * map stays empty and the base-roster-only totals are shown instead.
 */
async function fetchOverrideSpecialDaysForPeriod(p, memberName) {
  const thisToken = _overrideFetchToken; // onPeriodChange already incremented — just capture
  _overridesByDate = new Map();
  try {
    // Query by date range only — no memberName equality filter. Adding memberName
    // as an equality filter alongside a date range requires a composite Firestore
    // index that doesn't exist in this project. app.js uses the same date-only
    // pattern and filters by member client-side, so we do the same here.
    const q = query(
      collection(db, 'overrides'),
      where('date', '>=', formatISO(p.start)),
      where('date', '<=', formatISO(p.cutoff))
    );
    const snap = await getDocs(q);
    // A newer period change has superseded this fetch — discard the result
    if (thisToken !== _overrideFetchToken) return;
    const map = new Map();
    snap.forEach(doc => {
      const d = doc.data();
      if (!d.date || d.memberName !== memberName) return; // filter to current member
      // If a date has multiple override docs, keep the most recently created one.
      // createdAt is a Firestore server timestamp — toMillis() gives ms since epoch.
      const existing = map.get(d.date);
      const docTs    = d.createdAt?.toMillis?.() ?? 0;
      const existTs  = existing?._ts ?? -1;
      if (!existing || docTs > existTs) {
        map.set(d.date, { type: d.type, value: d.value, _ts: docTs });
      }
    });
    _overridesByDate = map;
    _overridesFetchState = 'loaded';
    updateRosterHint();
  } catch {
    _overridesFetchState = 'base-only';
    updateRosterHint(); // re-render so state badge updates from loading → base-only
  }
}

function getRosterSuggestion(p) {
  let session;
  try { session = JSON.parse(localStorage.getItem('myb_admin_session') || 'null'); } catch { return null; }
  if (!session?.name) return null;

  const member = teamMembers.find(m => m.name === session.name);
  if (!member) return null;

  let satMins = 0, sunMins = 0, bhMins = 0, boxMins = 0, rdwMins = 0;
  let satCount = 0, sunCount = 0, bhCount = 0, boxCount = 0, rdwCount = 0;
  let satFromOv = false, sunFromOv = false, bhFromOv = false, boxFromOv = false;
  const days = []; // individual dated shifts for the day list

  const cur = new Date(p.start);
  while (cur <= p.cutoff) {
    const noon = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 12);
    const iso  = formatISO(cur);
    const ov   = _overridesByDate.get(iso);

    // Replacement-aware: if an override exists for this date it wins over the
    // base roster entirely. Non-work values (AL, RD, SICK, SPARE) fall through
    // the HH:MM-HH:MM guard below and correctly suppress the day.
    const effValue = ov ? ov.value : getBaseShift(member, noon);
    const effType  = ov ? ov.type  : null;

    if (effValue && effValue.includes('-') && effValue.includes(':')) {
      const parts = effValue.split('-');
      const [sh, sm] = parts[0].split(':').map(Number);
      const [eh, em] = parts[1].split(':').map(Number);
      let mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins <= 0) mins += 24 * 60; // overnight shift

      const dow      = cur.getDay(); // 0 = Sun, 6 = Sat
      const isBoxing = cur.getMonth() === 11 && cur.getDate() === 26;
      const isBH     = !isBoxing && isDateInBHList(cur);

      const fromOv = !!ov; // true if this day came from a Firestore override
      if (isBoxing) {
        boxMins += mins; boxCount++;
        if (fromOv) boxFromOv = true;
        days.push({ date: new Date(cur), shift: effValue, type: 'box', source: fromOv ? 'override' : 'base' });
      } else if (isBH) {
        bhMins += mins; bhCount++;
        if (fromOv) bhFromOv = true;
        days.push({ date: new Date(cur), shift: effValue, type: 'bh', source: fromOv ? 'override' : 'base' });
      } else if (dow === 0) {
        // Sunday — the higher Sunday rate applies whether this is a base rostered
        // Sunday or an RDW override on a Sunday. Always tagged 'sun' so the day
        // list chip matches the field it fills (Sunday, not RDW).
        sunMins += mins; sunCount++;
        if (fromOv) sunFromOv = true;
        days.push({ date: new Date(cur), shift: effValue, type: 'sun', source: fromOv ? 'override' : 'base' });
      } else if (effType === 'rdw') {
        // Rest-day-worked on a weekday or Saturday — always an override
        rdwMins += mins; rdwCount++;
        days.push({ date: new Date(cur), shift: effValue, type: 'rdw', source: 'override' });
      } else if (dow === 6) {
        satMins += mins; satCount++;
        if (fromOv) satFromOv = true;
        days.push({ date: new Date(cur), shift: effValue, type: 'sat', source: fromOv ? 'override' : 'base' });
      }
      // Mon–Fri non-BH, non-RDW: already in contracted basic pay — nothing to fill
    }
    cur.setDate(cur.getDate() + 1);
  }

  if (!satCount && !sunCount && !bhCount && !rdwCount && !boxCount) return null;

  const allDays = days.sort((a, b) => a.date - b.date);

  return {
    satH: Math.floor(satMins / 60), satM: satMins % 60,
    sunH: Math.floor(sunMins / 60), sunM: sunMins % 60,
    bhH:  Math.floor(bhMins  / 60), bhM:  bhMins  % 60,
    rdwH: Math.floor(rdwMins / 60), rdwM: rdwMins % 60,
    boxH: Math.floor(boxMins / 60), boxM: boxMins % 60,
    satCount, sunCount, bhCount, rdwCount, boxCount,
    satFromOv, sunFromOv, bhFromOv, boxFromOv, rdwFromOv: true, // RDW is always an override
    memberName: member.name,
    days: allDays,
  };
}

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

  const s = getRosterSuggestion(p);
  if (!s) { card.style.display = 'none'; return; }

  // State badge
  const badge = document.getElementById('rosterStateBadge');
  if (badge) {
    if (_overridesFetchState === 'loaded') {
      badge.textContent  = '✓ Roster + overrides';
      badge.className    = 'roster-state-badge loaded';
    } else if (_overridesFetchState === 'checking') {
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
      { cat: 'bh',  icon: '🏦', label: 'Bank holiday', h: s.bhH,  m: s.bhM,  count: s.bhCount,  fromOv: s.bhFromOv  },
      { cat: 'rdw', icon: '💼', label: 'RDW',          h: s.rdwH, m: s.rdwM, count: s.rdwCount, fromOv: true        },
      { cat: 'box', icon: '🎁', label: 'Boxing Day',   h: s.boxH, m: s.boxM, count: s.boxCount, fromOv: s.boxFromOv },
    ].filter(r => r.count > 0);

    rows.innerHTML = cats.map(r => {
      const total  = fmtH(r.h, r.m);
      const dayStr = r.count === 1 ? '1 day' : `${r.count} days`;
      const src    = _overridesFetchState === 'loaded'
        ? (r.fromOv ? ' · Override' : ' · Base roster') : '';
      return `<div class="roster-row">` +
        `<span class="roster-row-icon">${r.icon}</span>` +
        `<span class="roster-row-label">${r.label}</span>` +
        `<span class="roster-row-total">${total}</span>` +
        `<span class="roster-row-meta">${dayStr}${src}</span>` +
        `<button class="roster-cat-btn" type="button" data-cat="${r.cat}" ` +
          `aria-label="Fill ${r.label} hours from roster">Fill →</button>` +
        `</div>`;
    }).join('');
  }

  // Day list — reset to closed state on every period change
  const dayList    = document.getElementById('rosterDayList');
  const daysToggle = document.getElementById('rosterDaysToggle');
  if (dayList)    dayList.style.display = 'none';
  if (daysToggle) {
    daysToggle.textContent = 'Show days ▼';
    daysToggle.style.display = s.days.length ? '' : 'none';
  }
  renderRosterDayList(s.days);
  card.style.display = '';
}

const _DAY_ABBS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const _MON_ABBS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _DAY_CHIP_LABELS = { sat: 'Rostered Sat', sun: 'Sunday', bh: 'Bank holiday', box: 'Boxing Day', rdw: 'RDW' };

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
  el.textContent = `📅 You joined on ${startFmt}. Your contracted hours for this period are ${proRated} of ${base} (${daysEmployed} of ${totalDays} days).`;
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
  if (parseInt(elH.value) || parseInt(elM.value)) return; // already has a value — skip
  if (!hVal && !mVal) return;
  elH.value = hVal || '';
  elM.value = mVal || '';
  elH.classList.add('roster-suggested');
  elM.classList.add('roster-suggested');
}

/** Fills only the named category's hours from the current roster suggestion. */
function fillCategoryFromRoster(cat) {
  const p = getPeriods().find(x => x.num === currentPeriodNum());
  if (!p) return;
  const s = getRosterSuggestion(p);
  if (!s) return;
  const map = {
    sat: ['satH', 'satM', s.satH, s.satM],
    sun: ['sunH', 'sunM', s.sunH, s.sunM],
    bh:  ['bhH',  'bhM',  s.bhH,  s.bhM ],
    rdw: ['rdwH', 'rdwM', s.rdwH, s.rdwM],
    box: ['boxH', 'boxM', s.boxH, s.boxM],
  };
  const args = map[cat];
  if (args) { _suggestIfBlank(...args); autosave(); }
}

/** Fills ALL categories from the current roster suggestion (blank fields only). */
function fillFromRoster() {
  const p = getPeriods().find(x => x.num === currentPeriodNum());
  if (!p) return;
  const s = getRosterSuggestion(p);
  if (!s) return;
  _suggestIfBlank('satH', 'satM', s.satH, s.satM);
  _suggestIfBlank('sunH', 'sunM', s.sunH, s.sunM);
  _suggestIfBlank('bhH',  'bhM',  s.bhH,  s.bhM);
  _suggestIfBlank('rdwH', 'rdwM', s.rdwH, s.rdwM);
  _suggestIfBlank('boxH', 'boxM', s.boxH, s.boxM);
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
  const { tax: TAX, scottishTax: SCOT, ni: NI, sl: SL } = getThresholds(_ty.label);
  const LONDON = _curP ? getLondonAllowanceForPeriod(_curP, _ty) : _ty.londonAllow;

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

  const _effContr  = getEffectiveContr(_curP);
  const satCapped  = Math.min(satHrs, _effContr);
  const normHrs    = _effContr - satCapped;      // non-Saturday contracted hours
  const bhCapped   = Math.min(bhHrs, normHrs); // clamp to available non-Sat hours
  const nonBhNorm  = normHrs - bhCapped;    // weekday non-BH contracted hours

  const gBasicNorm = nonBhNorm  * rate;   // weekday non-BH pay at 1.0×
  const gBasicSat  = satCapped  * r125;   // Saturday contracted pay at 1.25×
  // Bank Holiday Rostered: full 1.25× pay for contracted shifts on bank holidays.
  // Matches payslip line "Bank Holiday Rostered 1.25" exactly.
  const gBankHol   = bhCapped   * r125;
  const gBhOt      = bhOtHrs   * r125;
  const gOvertime  = oHrs      * r125;
  const gRdw       = rHrs      * r125;
  const gSunday    = sHrs      * r150;
  const gBoxing    = bHrs      * r300;
  const gPeer      = peer * 2  * rate;
  const otherAdj   = parseFloat(document.getElementById('otherAdj').value) || 0;
  const gross      = gBasicNorm + gBasicSat + gBankHol + gBhOt + gOvertime + gRdw + gSunday + gBoxing + gPeer + LONDON + otherAdj;

  // Pension — salary sacrifice: deducted from gross before tax and NI are calculated.
  // This reduces taxable pay and NI-able pay, saving the employee on both.
  const pension    = numVal('pensionAmt');
  const pensionWarn = document.getElementById('pensionWarn');
  if (pensionWarn) pensionWarn.classList.toggle('show', pension > gross && pension > 0);
  const sacGross   = Math.max(0, gross - pension); // clamped — pension cannot exceed gross

  // Income Tax (on sacGross, not gross)
  // Supports: nL, BR, D0, D1, NT, 0T, Kn, W1/M1/X suffix, S prefix (Scottish)
  const rawCode   = (document.getElementById('taxCode').value || '1257L').toUpperCase().replace(/\s+/g, '');
  const isNonCum  = /[WM]1$|X$/.test(rawCode);
  const baseCode  = rawCode.replace(/[WM]1$|X$/, '');
  const isScottish = /^S/.test(baseCode); // S-prefix → apply Holyrood bands
  let tax = 0;
  if (baseCode === 'NT') {
    tax = 0;
  } else if (baseCode === 'BR' || baseCode === 'SBR') {
    tax = sacGross * (isScottish ? SCOT.bands[1].rate : TAX.r20); // basic rate (20% both)
  } else if (baseCode === 'D0' || baseCode === 'SD0') {
    tax = sacGross * (isScottish ? 0.42 : TAX.r40); // higher rate (42% Scotland, 40% rUK)
  } else if (baseCode === 'D1' || baseCode === 'SD1') {
    tax = sacGross * (isScottish ? 0.48 : TAX.r45); // top/additional rate (48% Scotland, 45% rUK)
  } else {
    // Banded calculation — resolve personal allowance first
    let pa = (isScottish ? SCOT : TAX).pa; // standard allowance per period
    if (baseCode === '0T' || baseCode === 'S0T') {
      pa = 0;
    } else {
      const km = baseCode.match(/^[SC]?K(\d+)$/);
      if (km) {
        pa = -(parseInt(km[1]) * 10 / P_YR); // K code: negative allowance
      } else {
        const nm = baseCode.match(/^[SC]?(\d+)L$/);
        if (nm) pa = parseInt(nm[1]) * 10 / P_YR;
        // else: unrecognised code — falls back to standard allowance
      }
    }
    // taxable = sacGross minus allowance (K codes: pa is negative, so taxable grows)
    const taxable = Math.max(0, sacGross - pa);
    if (isScottish) {
      tax = calcBandedTax(taxable, SCOT.bands);
    } else {
      const basicBand = Math.max(0, TAX.b - Math.max(0, pa));
      const highBand  = Math.max(0, TAX.h - TAX.b);
      if      (taxable <= basicBand)            tax = taxable * TAX.r20;
      else if (taxable <= basicBand + highBand) tax = basicBand * TAX.r20 + (taxable - basicBand) * TAX.r40;
      else                                      tax = basicBand * TAX.r20 + highBand * TAX.r40 + (taxable - basicBand - highBand) * TAX.r45;
    }
  }

  // ── CUMULATIVE PAYE ───────────────────────────────────────────────────────────
  // When the user provides YTD figures from their last payslip, the app switches
  // to HMRC's cumulative method: calculate total tax owed on all income since 6 April,
  // then subtract what's already been collected. This corrects for overtime swings,
  // back pay, and mid-year code changes. W1/M1/X (non-cumulative) codes are excluded.
  const ytdP = numVal('ytdPay');
  const ytdT = numVal('ytdTax');
  let usingCumulative = false;

  if ((ytdP > 0 || ytdT > 0) && !isNonCum && _curP) {
    const N = (_curP.num - 48) - _ty.first + 1; // HMRC 4-weekly period number (1–13)
    const cumGross = ytdP + sacGross;

    // Resolve per-period PA — same logic as above, then scale to N periods
    let paPerPeriod = (isScottish ? SCOT : TAX).pa;
    if (baseCode === '0T' || baseCode === 'S0T') {
      paPerPeriod = 0;
    } else {
      const km = baseCode.match(/^[SC]?K(\d+)$/);
      if (km) {
        paPerPeriod = -(parseInt(km[1]) * 10 / P_YR);
      } else {
        const nm = baseCode.match(/^[SC]?(\d+)L$/);
        if (nm) paPerPeriod = parseInt(nm[1]) * 10 / P_YR;
      }
    }
    const cumPa      = paPerPeriod * N;
    const cumTaxable = Math.max(0, cumGross - cumPa);

    let cumTaxDue = 0;
    if (baseCode === 'NT') {
      cumTaxDue = 0;
    } else if (baseCode === 'BR' || baseCode === 'SBR') {
      cumTaxDue = cumGross * (isScottish ? SCOT.bands[1].rate : TAX.r20);
    } else if (baseCode === 'D0' || baseCode === 'SD0') {
      cumTaxDue = cumGross * (isScottish ? 0.42 : TAX.r40);
    } else if (baseCode === 'D1' || baseCode === 'SD1') {
      cumTaxDue = cumGross * (isScottish ? 0.48 : TAX.r45);
    } else if (isScottish) {
      // Scottish cumulative: scale each band top by N periods
      cumTaxDue = calcBandedTax(cumTaxable, SCOT.bands, N);
    } else {
      const cumBasicTop = TAX.b * N;
      const cumHighTop  = TAX.h * N;
      const cumBasicBnd = Math.max(0, cumBasicTop - Math.max(0, cumPa));
      const cumHighBnd  = Math.max(0, cumHighTop - cumBasicTop);
      if (cumTaxable <= cumBasicBnd) {
        cumTaxDue = cumTaxable * TAX.r20;
      } else if (cumTaxable <= cumBasicBnd + cumHighBnd) {
        cumTaxDue = cumBasicBnd * TAX.r20 + (cumTaxable - cumBasicBnd) * TAX.r40;
      } else {
        cumTaxDue = cumBasicBnd * TAX.r20 + cumHighBnd * TAX.r40 + (cumTaxable - cumBasicBnd - cumHighBnd) * TAX.r45;
      }
    }
    tax = Math.max(0, cumTaxDue - ytdT);
    usingCumulative = true;
  }

  // NI (on sacGross)
  const ni = sacGross <= NI.pt ? 0
    : (Math.min(sacGross, NI.uel) - NI.pt) * NI.r8 + Math.max(0, sacGross - NI.uel) * NI.r2;

  // Student Loan (on sacGross — HMRC applies SL on post-sacrifice earnings)
  // Thresholds are looked up per tax year (they rise each April).
  const plan    = document.getElementById('studentLoan').value;
  const SL_PLAN = (SL || {})[plan];
  const slSkip  = document.getElementById('slSkipCheck').checked;
  // Show the "not deducted this period" toggle only when a plan is selected
  document.getElementById('slSkipRow').classList.toggle('hidden', plan === 'none');
  const sl      = (SL_PLAN && !slSkip) ? Math.floor(Math.max(0, (sacGross - SL_PLAN.t) * SL_PLAN.r)) : 0;

  const net = sacGross - tax - ni - sl; // same as gross - pension - tax - ni - sl

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

  const _peekBtn = document.getElementById('resultPeekBtn');
  if (_peekBtn) _peekBtn.textContent = `↑ Estimated take-home: ${fmt(net)}`;

  calcHPP();
}

// ── HPP ESTIMATOR ─────────────────────────────────────────────────────────────
// Formula from Chiltern payroll (Marie Firby):
// (Gross - Basic) × 4/52 = HPP
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

  let totalVar  = 0;
  let pCount    = 0;

  periods.forEach(p => {
    try {
      const raw = localStorage.getItem(periodKey(p.num));
      if (!raw) return;
      const d = JSON.parse(raw);
      if (isDataEmpty(d)) return;
      pCount++;

      const r125 = rate * 1.25, r150 = rate * 1.50, r300 = rate * 3.00;
      const satHrs  = (d.satH  || 0) + (d.satM  || 0) / 60;
      const bhHrs   = (d.bhH   || 0) + (d.bhM   || 0) / 60;
      const bhOtHrs = (d.bhOtH || 0) + (d.bhOtM || 0) / 60;
      const otHrs   = (d.otH   || 0) + (d.otM   || 0) / 60;
      const rdwHrs  = (d.rdwH  || 0) + (d.rdwM  || 0) / 60;
      const sunHrs  = (d.sunH  || 0) + (d.sunM  || 0) / 60;
      const boxHrs  = (d.boxH  || 0) + (d.boxM  || 0) / 60;
      // Mirror the capping logic from calculate() — bhCapped can be 0 when all
      // contracted hours fall on Saturday, in which case the BH premium must not
      // contribute to HPP either (it was not included in that period's gross pay).
      // Use getEffectiveContr so joining periods use pro-rated hours consistently.
      const _hppEffContr = getEffectiveContr(p);
      const satCapped = Math.min(satHrs, _hppEffContr);
      const normHrs   = _hppEffContr - satCapped;
      const bhCapped  = Math.min(bhHrs, normHrs);

      // Variable pay = Gross minus Basic:
      // Saturday uplift (0.25× extra on contracted sat hours)
      // Bank Holiday premium (0.25× extra on contracted BH hours)
      // Full BH overtime, OT, RDW, Sunday, Boxing pay
      // London Allowance (explicitly included per Chiltern payroll)
      // NOT peer training (extra basic, not variable)
      const _pTy    = getTaxYearForOffset(p.num - 48);
      const pLondon = getLondonAllowanceForPeriod(p, _pTy);
      const varPay =
        satCapped * (rate * 0.25) +  // sat uplift above base rate
        bhCapped  * (rate * 0.25) +  // bank holiday rostered premium above base rate
        bhOtHrs   * r125           +  // full BH overtime pay
        otHrs     * r125           +  // full OT pay
        rdwHrs    * r125           +  // full RDW pay
        sunHrs    * r150           +  // full Sunday pay
        boxHrs    * r300           +  // full Boxing Day pay
        pLondon;                      // London Allowance per period (year-specific)

      totalVar += varPay;
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
    basisEl.textContent  = `${pCount} period${pCount > 1 ? 's' : ''} of ${ty.label} · ${fmt(totalVar)} extra pay × 7.69% · due January ${ty.hppPaidJan}`;
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
  const est       = estRaw    ? parseFloat(estRaw)    : 0;
  const actual    = actualRaw ? parseFloat(actualRaw) : 0;

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
      const satCapped = Math.min(satHrs, getContr());
      const normHrsBP = getContr() - satCapped;
      const bhCapped  = Math.min(bhHrs, normHrsBP);

      const ratePay =
        getContr()     * rateDiff        +
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

// Roster fill — "Fill blank fields" button + per-category "Fill →" buttons
const _fillBtn = document.getElementById('fillFromRosterBtn');
if (_fillBtn) _fillBtn.addEventListener('click', fillFromRoster);

// Per-category fill buttons are dynamically rendered inside #rosterRows — use delegation
document.getElementById('rosterRows')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-cat]');
  if (btn) fillCategoryFromRoster(btn.dataset.cat);
});

// Remove roster-suggested highlight as soon as the user edits any hours input
document.querySelectorAll('#satH,#satM,#bhH,#bhM,#bhOtH,#bhOtM,#sunH,#sunM,#boxH,#boxM').forEach(el => {
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
