// MYB Roster — Pay Calculator core math
// Pure functions only — no DOM, no Firebase, no browser globals.
// Imported by paycalc.js (browser) and paycalc.test.mjs (Node test runner).

export const P_YR = 13; // 13 four-weekly pay periods per year

// ── Tax year definitions ───────────────────────────────────────────────────
// "Tax year" here means: payday falls in that Apr–Mar window.
// Period offsets are relative to the P48 anchor (13 Feb 2026).
// 2025/26: P37 → P49  (offsets -11 to +1)
// 2026/27: P50 → P62  (offsets  +2 to +14)
export const TAX_YEARS = [
  { label: '2025/26', first: -11, last:  1, hppPaidJan: 2027,
    londonAllow: 276.16, londonAllowPre: 267.08, londonAllowFrom: new Date(2025, 9, 24) },
  { label: '2026/27', first:   2, last: 14, hppPaidJan: 2028,
    londonAllow: 276.16 }, // ⚠️ Update londonAllowPre + londonAllow when 2026/27 pay award confirmed
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
export const GRADES = {
  cea: { label: 'CEA — £20.74/hr', rate: 20.74, contr: 140, pension: 154.77 },
  ces: { label: 'CES — £21.81/hr', rate: 21.81, contr: 140, pension: 154.77 }, // 2026/27 rate TBC
};

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
 * @returns {{ tax, scottishTax, ni, sl, londonAllow }}
 */
export function getThresholds(yearLabel) {
  const ty = TAX_YEARS.find(t => t.label === yearLabel) || TAX_YEARS[0];
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
 * @returns {{ gross, satCapped, normHrs, bhCapped, nonBhNorm,
 *             gBasicNorm, gBasicSat, gBankHol, gBhOt, gOvertime,
 *             gRdw, gSunday, gBoxing, gPeer }}
 */
export function computeGross(i) {
  const r125 = i.rate * 1.25, r150 = i.rate * 1.50, r300 = i.rate * 3.00;
  const satCapped  = Math.min(i.satHrs, i.effContr);
  const normHrs    = i.effContr - satCapped;
  const bhCapped   = Math.min(i.bhHrs, normHrs);
  const nonBhNorm  = normHrs - bhCapped;

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
 * When ytdPay/ytdTax are provided and the code is cumulative, switches to
 * HMRC cumulative PAYE method: total tax owed YTD minus already collected.
 *
 * @param {number} sacGross - Post-pension-sacrifice gross
 * @param {string} taxCode  - Raw PAYE code, e.g. '1257L', 'S1257L', 'BR', 'K500', '1257LW1'
 * @param {{ tax: object, scottishTax: object }} t - getThresholds() result
 * @param {object} [opts]
 * @param {number} [opts.ytdPay=0]       - YTD pay from last payslip
 * @param {number} [opts.ytdTax=0]       - YTD tax from last payslip
 * @param {number|null} [opts.periodN]   - HMRC 4-weekly period number 1–13 (required for cumulative)
 * @returns {{ tax: number, usingCumulative: boolean }}
 */
export function computeTax(sacGross, taxCode, t, { ytdPay = 0, ytdTax = 0, periodN = null } = {}) {
  const rawCode    = (taxCode || '1257L').toUpperCase().replace(/\s+/g, '');
  const isNonCum   = /[WM]1$|X$/.test(rawCode);
  const baseCode   = rawCode.replace(/[WM]1$|X$/, '');
  const isScottish = /^S/.test(baseCode);
  const TAX = t.tax, SCOT = t.scottishTax;

  function resolvePA() {
    let pa = (isScottish ? SCOT : TAX).pa;
    if (baseCode === '0T' || baseCode === 'S0T') return 0;
    const km = baseCode.match(/^[SC]?K(\d+)$/);
    if (km) return -(parseInt(km[1]) * 10 / P_YR); // K code: negative allowance
    const nm = baseCode.match(/^[SC]?(\d+)L$/);
    if (nm) return parseInt(nm[1]) * 10 / P_YR;
    return pa;
  }

  function taxOnAmount(amount, scale) {
    if (baseCode === 'NT') return 0;
    if (baseCode === 'BR' || baseCode === 'SBR') return amount * (isScottish ? SCOT.bands[1].rate : TAX.r20);
    if (baseCode === 'D0' || baseCode === 'SD0') return amount * (isScottish ? 0.42 : TAX.r40);
    if (baseCode === 'D1' || baseCode === 'SD1') return amount * (isScottish ? 0.48 : TAX.r45);
    const pa = resolvePA();
    const scaledPa = pa * (scale || 1);
    const taxable = Math.max(0, amount - scaledPa);
    if (isScottish) return calcBandedTax(taxable, SCOT.bands, scale || 1);
    const basicBand = Math.max(0, TAX.b * (scale || 1) - Math.max(0, scaledPa));
    const highBand  = Math.max(0, TAX.h - TAX.b) * (scale || 1);
    if      (taxable <= basicBand)            return taxable * TAX.r20;
    else if (taxable <= basicBand + highBand) return basicBand * TAX.r20 + (taxable - basicBand) * TAX.r40;
    else                                      return basicBand * TAX.r20 + highBand * TAX.r40 + (taxable - basicBand - highBand) * TAX.r45;
  }

  // Cumulative PAYE: recalculate total tax owed on all YTD income, subtract what's been collected
  if ((ytdPay > 0 || ytdTax > 0) && !isNonCum && periodN !== null) {
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
  const slPlan = slByYear[plan];
  if (!slPlan) return 0;
  return Math.floor(Math.max(0, (sacGross - slPlan.t) * slPlan.r));
}
