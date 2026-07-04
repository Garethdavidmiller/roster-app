// @ts-check
// MYB Roster — Pay Calculator core math
// Pure functions only — no DOM, no Firebase, no browser globals.
// Imported by paycalc-app.js (browser) and paycalc.test.mjs (Node test runner).

export const P_YR = 13; // 13 four-weekly pay periods per year

// Pay-rate multipliers — used by computeGross and imported by paycalc-app.js.
export const RATE_125 = 1.25;
export const RATE_150 = 1.50;
export const RATE_300 = 3.00;

// ── Tax year definitions ───────────────────────────────────────────────────
// "Tax year" here means: payday falls in that Apr–Mar window.
// `first`/`last` are INTERNAL num offsets relative to the anchor (internal num 48 = 13 Feb 2026),
// NOT payslip period numbers. The payslip prints weeks-into-the-year (×4, resets each April) —
// use payslipPeriodNum() in paycalc-periods.js for user-facing labels.
// 2025/26: internal num 37 → 49  (offsets -11 to +1) — printed P4 → P52
// 2026/27: internal num 50 → 62  (offsets  +2 to +14) — printed P4 → P52
export const TAX_YEARS = [
  { label: '2025/26', first: -11, last:  1, hppPaidJan: 2027,
    londonAllow: 276.16, londonAllowPre: 267.08, londonAllowFrom: new Date(2025, 9, 24) },
  { label: '2026/27', first:   2, last: 14, hppPaidJan: 2028,
    londonAllow: 276.16, rateUnconfirmed: true }, // ⚠️ Remove rateUnconfirmed + set londonAllowPre + londonAllow when pay award confirmed
];

// ── Tax & NI thresholds by tax year ───────────────────────────────────────
// All annual figures ÷ 13 to give 4-weekly amounts.
// PA and bands frozen at 2025/26 levels until April 2028 (Autumn Budget 2024).
export const TAX_BY_YEAR = {
  '2025/26': { pa: 12570/P_YR, b: 50270/P_YR, h: 125140/P_YR, r20:0.20, r40:0.40, r45:0.45 },
  '2026/27': { pa: 12570/P_YR, b: 50270/P_YR, h: 125140/P_YR, r20:0.20, r40:0.40, r45:0.45 }, // confirmed frozen
};

// NI thresholds: HMRC specifies these weekly; correct 4-weekly value is weekly × 4.
// PT 2025/26: £242/wk × 4 = £968. UEL 2025/26: £967/wk × 4 = £3,868.
// Using annual ÷ 13 would overstate NI by ~£0.09/period — hence weekly × 4.
export const NI_BY_YEAR = {
  '2025/26': { pt: 242 * 4, uel: 967 * 4, r8:0.08, r2:0.02 },
  '2026/27': { pt: 242 * 4, uel: 967 * 4, r8:0.08, r2:0.02 }, // confirmed unchanged
};

// Student loan thresholds by tax year — HMRC publishes these each April.
export const SL_BY_YEAR = {
  '2025/26': {
    // Confirmed against GOV.UK "Repaying your student loan" / SL3 2025-26 tables (checked Jul 2026).
    // These were previously the 2024/25 figures (24990/27295/31395) — thresholds rise each April.
    plan1:   { t: 26065/P_YR, r: 0.09 },
    plan2:   { t: 28470/P_YR, r: 0.09 },
    plan4:   { t: 32745/P_YR, r: 0.09 }, // Scotland
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

// Scottish income tax (Holyrood-set). Bands are per-period TAXABLE tops (total
// income threshold minus PA, divided by P_YR). PA still set by Westminster.
export const SCOTTISH_TAX_BY_YEAR = {
  '2025/26': { pa: 12570/P_YR, bands: [
    { top:  2827/P_YR, rate: 0.19 }, // Starter      19%  £12,571–£15,397
    { top: 14921/P_YR, rate: 0.20 }, // Basic        20%  £15,397–£27,491
    { top: 31092/P_YR, rate: 0.21 }, // Intermediate 21%  £27,491–£43,662
    { top: 62430/P_YR, rate: 0.42 }, // Higher       42%  £43,662–£75,000
    { top:112570/P_YR, rate: 0.45 }, // Advanced     45%  £75,000–£125,140
    { top: Infinity,   rate: 0.48 }, // Top          48%  over £125,140
  ]},
  '2026/27': { pa: 12570/P_YR, bands: [
    { top:  3967/P_YR, rate: 0.19 }, // Starter      19%  £12,571–£16,537
    { top: 16956/P_YR, rate: 0.20 }, // Basic        20%  £16,537–£29,526
    { top: 31092/P_YR, rate: 0.21 }, // Intermediate 21%  £29,526–£43,662
    { top: 62430/P_YR, rate: 0.42 }, // Higher       42%  £43,662–£75,000
    { top:112570/P_YR, rate: 0.45 }, // Advanced     45%  £75,000–£125,140
    { top: Infinity,   rate: 0.48 }, // Top          48%  over £125,140
  ]},
};

// Grade contractual data. 2026/27 pay awards not yet confirmed.
// pensionPre / pensionFrom: pension changed from £154.77 → £147.36 at the May 8 2026 payslip.
// Periods with payday < pensionFrom use pensionPre; from pensionFrom onwards use pension.
/** @type {Record<string, any>} */
export const GRADES = {
  cea: { label: 'CEA — £20.74/hr', rate: 20.74, contr: 140, pension: 147.36, pensionPre: 154.77, pensionFrom: new Date(2026, 4, 8) },
  ces: { label: 'CES — £21.81/hr', rate: 21.81, contr: 140, pension: 147.36, pensionPre: 154.77, pensionFrom: new Date(2026, 4, 8) }, // 2026/27 rate TBC
};

// ── Annual pay-award rates by grade + tax year ─────────────────────────────
// A pay rise happens once a year, backdated to 1 April (Chiltern's pay anniversary), and is
// typically PAID mid-year as a lump sum once the award is agreed (2025/26 landed on the 24 Oct
// 2025 payslip — see londonAllowFrom). This table is the authoritative record so the back-pay
// card can compute ANY year's award, not just the pending one:
//   `rate` = the settled rate for that tax year (null while an award is still unconfirmed).
//   `pre`  = the rate paid BEFORE that year's award was applied (i.e. the prior year's rate) —
//            the OLD rate for that year's back-pay. null = not on record (falls back to manual).
// Payslip-confirmed values: CEA 2024/25 = £20.06 (G. Miller payslip 09/05/2025, "Basic Pay @20.06").
// Each April, when the new award is agreed: set that year's `rate`, and add the next year with
// `pre` = this year's rate. Consumed ONLY by paycalc-backpay.js (the main calculator's per-year
// rate still comes from GRADES + the localStorage per-year override — unchanged).
// `pre` = the rate paid BEFORE the year's award was applied (the prior year's rate). The DATE the
// award was applied is NOT stored here — it is a property of the tax YEAR (rate + London step on
// one payslip: 2025/26 = 24 Oct 2025) and lives once as `londonAllowFrom` on TAX_YEARS, read via
// awardFromForYear() below. This keeps the award-application date a single source of truth (it used
// to be written three times, a drift hazard). null `pre`/`rate` = not on record / not yet confirmed.
/** @type {Record<string, Record<string, { rate: number|null, pre: number|null }>>} */
export const AWARD_RATES = {
  cea: {
    '2025/26': { rate: 20.74, pre: 20.06 },
    '2026/27': { rate: null,  pre: 20.74 }, // pending — 3.6% offered, awaiting RMT
  },
  ces: {
    '2025/26': { rate: 21.81, pre: null },  // 2024/25 CES rate not on record
    '2026/27': { rate: null,  pre: 21.81 },
  },
};

/**
 * The pay-award rates for a grade + tax-year label, or null if the grade/year is unknown.
 * @param {string} grade    - 'cea' | 'ces'
 * @param {string} tyLabel  - e.g. '2025/26'
 * @returns {{ rate: number|null, pre: number|null } | null}
 */
export function awardRatesFor(grade, tyLabel) {
  const g = AWARD_RATES[grade] || AWARD_RATES.cea;
  return g[tyLabel] || null;
}

/**
 * The date a tax year's pay award was APPLIED/paid (the backdated lump lands on this payslip; periods
 * paid before it were still on the old rate). Single source of truth = the year's `londonAllowFrom`
 * (rate + London step together). null when the year has no mid-year step (e.g. the pending 2026/27).
 * INVARIANT: any year with an AWARD_RATES `pre` must have a londonAllowFrom — asserted in paycalc.test.mjs.
 * @param {string} tyLabel
 * @returns {Date|null}
 */
export function awardFromForYear(tyLabel) {
  const ty = TAX_YEARS.find(t => t.label === tyLabel);
  return ty?.londonAllowFrom || null;
}

/**
 * True if `p` is a period paid BEFORE its tax year's award was applied — i.e. it was paid at the
 * prior year's (pre-award) rate. Requires a recorded `pre` rate AND an award date, AND payday < that
 * date. Single predicate shared by getRateForPeriod (main calc) and saveSettings (the persist guard).
 * @param {{ payday: Date }} p
 * @param {string} grade
 * @param {string} tyLabel
 * @returns {boolean}
 */
export function isPreAwardPeriod(p, grade, tyLabel) {
  const a    = awardRatesFor(grade, tyLabel);
  const from = awardFromForYear(tyLabel);
  return !!(a && a.pre != null && from && p.payday < from);
}

/**
 * The hourly rate to use for a period, honouring a MID-YEAR pay-award step. A pay award is
 * backdated to 1 April but PAID from a mid-year date (2025/26: 24 Oct 2025) — so periods paid
 * BEFORE that date were actually paid at the prior year's rate. Returns the recorded pre-award
 * rate for those periods, else the settled rate. Mirrors getLondonAllowanceForPeriod. A grade/year
 * with no recorded step (CES, or the pending 2026/27) always returns the settled rate.
 * @param {{ payday: Date }} p        - the period
 * @param {string} grade              - 'cea' | 'ces'
 * @param {string} tyLabel            - e.g. '2025/26'
 * @param {number} settledRate        - the year's settled rate (from getStoredRateForYear / the field)
 * @returns {number}
 */
export function getRateForPeriod(p, grade, tyLabel, settledRate) {
  const a = awardRatesFor(grade, tyLabel);
  return (a && a.pre != null && isPreAwardPeriod(p, grade, tyLabel)) ? a.pre : settledRate;
}

// HPP formula confirmed by Chiltern payroll (Marie Firby): (Gross − Basic) × 4/52
export const HPP_FRACTION = 4 / 52;

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Apply progressive tax bands to a taxable amount.
 * @param {number} taxable - Already after personal allowance.
 * @param {Array<{top: number, rate: number}>} bands
 * @param {number} [scale=1] - Multiply all band tops (for cumulative PAYE: pass period N).
 * @returns {number}
 */
export function calcBandedTax(taxable, bands, scale = 1) {
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

/**
 * Return the TAX_YEARS entry whose offset range contains the given period offset.
 * Falls back to the first entry if not found.
 * @param {number} offset - Period number relative to P48 anchor.
 */
export function getTaxYearForOffset(offset) {
  return TAX_YEARS.find(ty => offset >= ty.first && offset <= ty.last) || TAX_YEARS[0];
}

/**
 * Return threshold objects for a given tax year label.
 * Falls back to 2025/26 with a warning if year not found.
 * @param {string} yearLabel - e.g. '2025/26'
 * @returns {{ tax: any, scottishTax: any, ni: any, sl: any, londonAllow: number }}
 */
export function getThresholds(yearLabel) {
  const ty = TAX_YEARS.find(t => t.label === yearLabel) || TAX_YEARS[0];
  if (!(/** @type {Record<string, any>} */ (TAX_BY_YEAR))[yearLabel]) console.warn(`[PayCalc] No tax data for ${yearLabel} — using 2025/26 thresholds. Update TAX_BY_YEAR, NI_BY_YEAR, SL_BY_YEAR, and SCOTTISH_TAX_BY_YEAR.`);
  return {
    tax:         (/** @type {Record<string, any>} */ (TAX_BY_YEAR))[yearLabel]          || TAX_BY_YEAR['2025/26'],
    scottishTax: (/** @type {Record<string, any>} */ (SCOTTISH_TAX_BY_YEAR))[yearLabel] || SCOTTISH_TAX_BY_YEAR['2025/26'],
    ni:          (/** @type {Record<string, any>} */ (NI_BY_YEAR))[yearLabel]           || NI_BY_YEAR['2025/26'],
    sl:          (/** @type {Record<string, any>} */ (SL_BY_YEAR))[yearLabel]           || SL_BY_YEAR['2025/26'],
    londonAllow: ty.londonAllow,
  };
}

/**
 * Return the London Allowance for a specific pay period, accounting for
 * mid-year pay award cut-overs.
 * @param {{ payday: Date }} p
 * @param {{ londonAllow: number, londonAllowPre?: number, londonAllowFrom?: Date }} ty
 * @returns {number}
 */
export function getLondonAllowanceForPeriod(p, ty) {
  if (ty.londonAllowPre && ty.londonAllowFrom && p.payday < ty.londonAllowFrom) {
    return ty.londonAllowPre;
  }
  return ty.londonAllow;
}

/**
 * Return the pension contribution default for a grade and pay period.
 * Handles the cut-over at pensionFrom: periods before that date use pensionPre.
 * @param {string} grade - 'cea' | 'ces'
 * @param {Date} payday  - Period payday
 * @returns {number} Full-period pension contribution £
 */
export function getPensionForPeriod(grade, payday) {
  const g = GRADES[grade] ?? GRADES.cea;
  if (g.pensionPre && g.pensionFrom && payday < g.pensionFrom) return g.pensionPre;
  return g.pension;
}

/**
 * Calculate the pro-ration factor for a member who joined mid-period.
 *
 * FORMULA INVARIANT — must not be broken:
 *   - periodCutoff is always at local noon (inherited from FIRST_PAYDAY in getPeriods()).
 *   - startDate must always be midnight local time: new Date(year, month-1, day).
 *   - The resulting 0.5-day offset means Math.round always resolves X.5 to X+1 (JS
 *     rounds .5 up), giving the correct calendar-day count regardless of timezone.
 *
 * Example: M. Okeke, startDate = new Date(2026, 3, 20) = April 20 midnight.
 *   raw = (May 2 noon − April 20 midnight) / msPerDay = 12.5
 *   Math.round(12.5) = 13 → daysEmployed = 14 → factor = 14/28 = 0.5 (50%)
 *   Verified against May 8 2026 payslip: London Allowance = £276.16 × 0.5 = £138.08. ✓
 *
 * DO NOT change startDate to noon — it would break the formula.
 * DO NOT change Math.round to Math.floor — it would give 13/28 = 46.4% (wrong).
 *
 * @param {Date|null|undefined} startDate  - Member's start date (midnight local)
 * @param {Date} periodStart               - Period start Sunday (noon local)
 * @param {Date} periodCutoff              - Period cutoff Saturday (noon local)
 * @returns {number} 0–1 fraction (1 = full period, 0 = not yet started)
 */
export function calcProRateFactor(startDate, periodStart, periodCutoff) {
  if (!startDate || startDate <= periodStart) return 1;
  if (startDate > periodCutoff) return 0;
  const msPerDay     = 86400000;
  const daysEmployed = Math.round((+periodCutoff - +startDate) / msPerDay) + 1;
  const totalDays    = Math.round((+periodCutoff - +periodStart) / msPerDay) + 1;
  return daysEmployed / totalDays;
}

/**
 * Cap Saturday and Bank-Holiday hours against contracted hours, the way the payslip does:
 * Saturday hours fill contracted first (satCapped); Bank-Holiday hours take the remaining normal
 * hours (bhCapped); nonBhNorm is what's left as plain contracted basic. SINGLE SOURCE of the cap
 * rule — shared by computeGross, _varPayForPeriod (HPP) and _accrueBackPayPeriod (back-pay) so a
 * payroll-rule change can't silently diverge across the three. Pure.
 * @param {{ effContr: number, satHrs?: number, bhHrs?: number }} i
 * @returns {{ satCapped: number, normHrs: number, bhCapped: number, nonBhNorm: number }}
 */
export function capHours(i) {
  const satCapped = Math.min(i.satHrs || 0, i.effContr);
  const normHrs   = i.effContr - satCapped;
  const bhCapped  = Math.min(i.bhHrs || 0, normHrs);
  const nonBhNorm = normHrs - bhCapped;
  return { satCapped, normHrs, bhCapped, nonBhNorm };
}

/**
 * Compute gross pay and its named components from period inputs.
 * BH and Boxing Day hours must already be zeroed by the caller for periods that
 * don't contain those days — this function trusts the values it receives.
 *
 * @param {object} i
 * @param {number} i.effContr  - Effective contracted hours (may be pro-rated for joiners)
 * @param {number} i.rate      - Hourly rate £
 * @param {number} i.satHrs    - Saturday hours (decimal)
 * @param {number} i.bhHrs     - Bank holiday rostered hours
 * @param {number} i.bhOtHrs   - Bank holiday RDW hours
 * @param {number} i.oHrs      - Overtime hours
 * @param {number} i.rHrs      - Rest day working hours
 * @param {number} i.sHrs      - Sunday hours
 * @param {number} i.bHrs      - Boxing Day hours
 * @param {number} i.peerDays  - Peer training days (each = 2h at 1×)
 * @param {number} i.otherAdj  - Other adjustment £ (may be negative)
 * @param {number} i.london    - London Allowance £
 * @returns {{ gross: number, satCapped: number, normHrs: number, bhCapped: number, nonBhNorm: number,
 *             gBasicNorm: number, gBasicSat: number, gBankHol: number, gBhOt: number, gOvertime: number,
 *             gRdw: number, gSunday: number, gBoxing: number, gPeer: number }}
 */

export function computeGross(i) {
  const r125 = i.rate * RATE_125, r150 = i.rate * RATE_150, r300 = i.rate * RATE_300;
  const { satCapped, normHrs, bhCapped, nonBhNorm } = capHours(i);

  const gBasicNorm = nonBhNorm  * i.rate;
  const gBasicSat  = satCapped  * r125;
  const gBankHol   = bhCapped   * r125;
  const gBhOt      = i.bhOtHrs  * r125;
  const gOvertime  = i.oHrs     * r125;
  const gRdw       = i.rHrs     * r125;
  const gSunday    = i.sHrs     * r150;
  const gBoxing    = i.bHrs     * r300;
  const gPeer      = i.peerDays * 2 * i.rate;
  const gross      = gBasicNorm + gBasicSat + gBankHol + gBhOt + gOvertime +
                     gRdw + gSunday + gBoxing + gPeer + i.london + i.otherAdj;
  return { gross, satCapped, normHrs, bhCapped, nonBhNorm,
           gBasicNorm, gBasicSat, gBankHol, gBhOt, gOvertime,
           gRdw, gSunday, gBoxing, gPeer };
}

/**
 * Compute income tax for a pay period.
 * Supports: nL, BR, D0, D1, NT, 0T, Kn, W1/M1/X suffix, S prefix (Scottish).
 * When both ytdPay and ytdTax are provided (non-null) and the code is cumulative,
 * switches to HMRC cumulative PAYE method: total tax owed YTD minus already collected.
 * Pass null for either to fall back to per-period estimation.
 *
 * @param {number} sacGross - Post-pension-sacrifice gross
 * @param {string} taxCode  - Raw PAYE code, e.g. '1257L', 'S1257L', 'BR', 'K500', '1257LW1'
 * @param {{ tax: object, scottishTax: object }} t - getThresholds() result
 * @param {object} [opts]
 * @param {number|null} [opts.ytdPay]    - YTD pay from last payslip; null = not provided
 * @param {number|null} [opts.ytdTax]    - YTD tax from last payslip; null = not provided
 * @param {number|null} [opts.periodN]   - HMRC 4-weekly period number 1–13 (required for cumulative)
 * @returns {{ tax: number, usingCumulative: boolean }}
 */
export function computeTax(sacGross, taxCode, t, { ytdPay = null, ytdTax = null, periodN = null } = {}) {
  const rawCode    = (taxCode || '1257L').toUpperCase().replace(/\s+/g, '');
  const isNonCum   = /[WM]1$|X$/.test(rawCode);
  // Welsh (C-prefix) income-tax rates are identical to rUK/English (Wales has not diverged from
  // the Westminster rates), so strip a leading C and treat it as the equivalent rUK code. Without
  // this, CBR/CD0/CD1/CNT fell through to banded tax and C0T wrongly kept the full allowance.
  // (Numeric C-codes like C1257L were already handled by resolvePA's [SC]? prefix.)
  const baseCode   = rawCode.replace(/[WM]1$|X$/, '').replace(/^C/, '');
  const isScottish = /^S/.test(baseCode);
  const TAX = /** @type {any} */ (t.tax), SCOT = /** @type {any} */ (t.scottishTax);

  function resolvePA() {
    let pa = (isScottish ? SCOT : TAX).pa;
    if (baseCode === '0T' || baseCode === 'S0T') return 0;
    const km = baseCode.match(/^[SC]?K(\d+)$/);
    if (km) return -(parseInt(km[1]) * 10 / P_YR); // K code: negative allowance
    // L, M, N and T all encode the allowance the same way: (code number × 10). The suffix only says
    // WHY (L standard, M marriage-allowance recipient, N transferor, T other adjustments) — it does
    // not change the arithmetic. Matching only 'L' silently gave M/N/T codes the full £12,570 default.
    const nm = baseCode.match(/^[SC]?(\d+)[LMNT]$/);
    if (nm) return parseInt(nm[1]) * 10 / P_YR;
    return pa;
  }

  function taxOnAmount(/** @type {number} */ amount, /** @type {number|null} */ scale) {
    if (baseCode === 'NT') return 0;
    if (baseCode === 'BR' || baseCode === 'SBR') return amount * (isScottish ? SCOT.bands[1].rate : TAX.r20);
    // SD0 = Scottish INTERMEDIATE (21% = bands[2]); SD1 = Scottish HIGHER (42% = bands[3]).
    // (rUK D0 = higher 40%, D1 = additional 45%.) These previously pointed at bands[3]/[5]
    // (higher/top), over-taxing S-prefixed D0/D1 codes by a full band or two.
    if (baseCode === 'D0' || baseCode === 'SD0') return amount * (isScottish ? SCOT.bands[2].rate : TAX.r40);
    if (baseCode === 'D1' || baseCode === 'SD1') return amount * (isScottish ? SCOT.bands[3].rate : TAX.r45);
    const pa = resolvePA();
    const scaledPa = pa * (scale || 1);
    // HMRC floors taxable income to the nearest whole pound before applying rates.
    // Verified against G. Miller payslips P20 (01/08/2025) and P28 (26/09/2025).
    const taxable = Math.floor(Math.max(0, amount - scaledPa));
    if (isScottish) return calcBandedTax(taxable, SCOT.bands, scale || 1);
    // The basic-rate LIMIT is a fixed £37,700 of taxable income (= standard threshold TAX.b minus
    // standard PA), regardless of the code's own allowance. Deriving it as (TAX.b − thisCode'sPA)
    // was only correct for 1257L; a 0T (PA 0) or K code (negative PA) got a too-wide 20% band, taxing
    // income at 20% that should have been 40%.
    const basicBand = Math.max(0, (TAX.b - TAX.pa)) * (scale || 1);
    const highBand  = Math.max(0, TAX.h - TAX.b) * (scale || 1);
    if      (taxable <= basicBand)            return taxable * TAX.r20;
    else if (taxable <= basicBand + highBand) return basicBand * TAX.r20 + (taxable - basicBand) * TAX.r40;
    else                                      return basicBand * TAX.r20 + highBand * TAX.r40 + (taxable - basicBand - highBand) * TAX.r45;
  }

  // Cumulative PAYE: recalculate total tax owed on all YTD income, subtract what's been collected.
  // Both ytdPay and ytdTax must be non-null — 0 is valid (first period); null means "not provided".
  // Requiring both prevents ytdTax defaulting to 0 when only ytdPay is filled, which would
  // make Math.max(0, cumTaxDue - 0) massively overstate tax for the period.
  if (ytdPay != null && ytdTax != null && !isNonCum && periodN !== null) {
    const N = periodN;
    const cumGross = ytdPay + sacGross;
    const cumTaxDue = taxOnAmount(cumGross, N);
    return { tax: Math.max(0, cumTaxDue - ytdTax), usingCumulative: true };
  }

  return { tax: taxOnAmount(sacGross, null), usingCumulative: false };
}

/**
 * Compute National Insurance contribution.
 * 8% on earnings between PT and UEL; 2% above UEL.
 * @param {number} sacGross - Post-pension-sacrifice gross
 * @param {{ pt: number, uel: number, r8: number, r2: number }} ni
 * @returns {number}
 */
export function computeNI(sacGross, ni) {
  if (sacGross <= ni.pt) return 0;
  return (Math.min(sacGross, ni.uel) - ni.pt) * ni.r8 +
         Math.max(0, sacGross - ni.uel) * ni.r2;
}

/**
 * Compute Student Loan repayment. HMRC rounds down to the nearest whole pound.
 * @param {number} sacGross   - Post-pension-sacrifice gross
 * @param {string} plan       - 'plan1'|'plan2'|'plan4'|'plan5'|'postgrad'|'none'
 * @param {object} slByYear   - SL_BY_YEAR[yearLabel] (per-year plan threshold map)
 * @param {boolean} [skip]    - True when staff mark "not deducted this period"
 * @returns {number}
 */
export function computeSL(sacGross, plan, slByYear, skip = false) {
  if (skip || plan === 'none' || !slByYear) return 0;
  const slPlan = (/** @type {Record<string, any>} */ (slByYear))[plan];
  if (!slPlan) return 0;
  return Math.floor(Math.max(0, (sacGross - slPlan.t) * slPlan.r));
}
