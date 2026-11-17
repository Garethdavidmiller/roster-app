// @ts-check
/**
 * paycalc-hpp.js — Holiday Pay Premium estimator and shared period helpers.
 *
 * Owns: _decodeHours, _varPayForPeriod, calcHPP, updatePriorHpp, what a confirmed
 *   prior-year premium is stored as (priorHppToStore, commitPriorHppActual), and whether a year's
 *   premium is still the member's to estimate (premiumStillToEstimate — the January notice's reader).
 *   It re-exports isDataEmpty, which lives in paycalc-format.js.
 * Does NOT own: period arithmetic (paycalc-periods.js), settings (paycalc-settings.js),
 *   calculation engine (paycalc-app.js), back-pay (paycalc-backpay.js).
 * Edit here for: HPP maths, prior-year HPP section, variable-pay formula.
 * Do not edit here for: basic gross maths, tax/NI, period navigation.
 */

import {
  HPP_FRACTION, RATE_125, RATE_150, RATE_300,
  taxYearForPeriod, capHours, getLondonAllowanceForPeriod, awardFromForYear, awardRatesFor,
} from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, hasBankHoliday, hasBoxingDay, isTaxYearVisible, payslipMayBeInHand } from './paycalc-periods.js';
import { getLoggedMember, awardGrade, periodRate, settledRateFor, getEffectiveContr, getProRateFactor, getPensionDefault, isPensionOptedOut, isPeriodPriced } from './paycalc-settings.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { readSavedPeriod, hppEstKey, hppActualKey, hppModeKey, ytdSrcKey, readPayslipActuals, isActualsDev } from './paycalc-migrations.js';
import { formatISO, parseSmartFloat, parseSmartFloatOrNull } from './roster-data.js';
import { fmt, fdList, fdLong } from './paycalc-format.js';
import { hppPayslipForTaxYear, hppPaidInTaxYear, periodsInTaxYear } from './paycalc-hpp-schedule.js';
import { paidInPeriodNum, _awardBackdateDate, awardLumpNonPremium } from './paycalc-backpay-accrual.js';
import { resolveAuthoritativeRates } from './paycalc-backpay-state.js';

// ── SHARED HELPERS ────────────────────────────────────────────────────────────

// isDataEmpty (no hours or special flags entered) lives in paycalc-format.js — the fill-year module
// needs it without this import chain — and is re-exported for the coordinator and paycalc-backpay.js.
export { isDataEmpty } from './paycalc-format.js';
import { isDataEmpty } from './paycalc-format.js';

/**
 * Resolve which HPP figure applies for a tax year's January payslip: a CONFIRMED actual —
 * present in storage, EVEN £0 (a genuine £0 after a year of absence) — always wins over the running
 * estimate. Absence of the actual (never entered / cleared) falls back to the estimate. Negatives
 * clamp to 0 (a payslip HPP can't be negative). Stored text that is not a figure confirms nothing —
 * read as a confirmed £0 it would take the estimate out of the January payslip. PURE — the single source of the
 * "actual beats estimate" rule, shared by calcHPP's take-home add (paycalc-app.js) and the
 * prior-year display (updatePriorHpp).
 * @param {string|null|undefined} actualRaw - raw stored actual ('' / null = not confirmed)
 * @param {string|null|undefined} estRaw    - raw stored estimate
 * @returns {{ amount: number, isEstimate: boolean, hasActual: boolean }}
 */
export function resolveHppForPeriod(actualRaw, estRaw) {
  const actual = parseSmartFloatOrNull(actualRaw);
  if (actual != null) return { amount: Math.max(0, actual), isEstimate: false, hasActual: true };
  const est = Math.max(0, parseFloat(String(estRaw ?? '')) || 0);
  return { amount: est, isEstimate: est > 0, hasActual: false };
}

/**
 * Decode stored hour fields from a period data object into decimal totals.
 * Guards BH/Boxing fields against periods without those days — storage can restore a hidden row's value.
 * Exported for paycalc-backpay.js.
 * @param {any} p - Period object.
 * @param {any} d - Saved period data from localStorage.
 */
export function _decodeHours(p, d) {
  // Read every field AS A NUMBER: a backup made elsewhere can hold "5", and `"5" + 0.5` is "50.5"
  // (fifty hours of overtime where the form showed five). Text that is not a figure is 0.
  const n = (/** @type {any} */ v) => Number(v) || 0;
  return {
    satHrs:  n(d.satH)  + n(d.satM)  / 60,
    bhHrs:   hasBankHoliday(p) ? (n(d.bhH)   + n(d.bhM)   / 60) : 0,
    bhOtHrs: hasBankHoliday(p) ? (n(d.bhOtH) + n(d.bhOtM) / 60) : 0,
    otHrs:   n(d.otH)   + n(d.otM)   / 60,
    rdwHrs:  n(d.rdwH)  + n(d.rdwM)  / 60,
    sunHrs:  n(d.sunH)  + n(d.sunM)  / 60,
    boxHrs:  hasBoxingDay(p)  ? (n(d.boxH)  + n(d.boxM)  / 60) : 0,
  };
}

/**
 * The pension a SAVED payslip is priced with — the one rule for every reader of a saved payslip (the
 * year block and the rough Year to Date premium), matching what calculate() does with the pension
 * box: nothing inside an opt-out spell; the payslip's own figure when it reads as one, floored at £0
 * because a negative would add untaxed headroom; otherwise the period default, scaled for a joining period.
 * @param {any} p @param {any} d - the saved payslip, or null @param {number} factor - getProRateFactor(p)
 * @returns {number}
 */
export function savedPeriodPension(p, d, factor) {
  if (isPensionOptedOut(p)) return 0;
  const own = d && d.pension != null ? parseSmartFloatOrNull(String(d.pension)) : null;
  return own != null ? Math.max(0, own) : (parseFloat(String(getPensionDefault(p))) || 0) * factor;
}

// bhCapped mirrors calculate(): when all contracted hours are Saturday, bhCapped = 0
// and the BH premium must not contribute to HPP (it wasn't in that period's gross).
/**
 * Compute variable (extra) pay for one period from saved data — the pay that ACCRUES HPP.
 * Used by calcHPP (through _hoursEstimate) and updatePriorHpp. Back pay prices its own
 * `varPay` in `_accrueBackPayPeriod` (paycalc-backpay-accrual.js), which mirrors this one.
 * Includes: OT, RDW, Sunday, Boxing Day, Saturday uplift, bank-holiday premium.
 * Does NOT include: London Allowance, peer training, basic pay, expenses, bonuses.
 *
 * London Allowance is a FIXED allowance paid EVERY period — including the periods you are on
 * leave — so it needs no holiday premium and does NOT accrue HPP (.claude/rules/paycalc.md
 * invariant 6, owner-confirmed; a real payslip shows the HPP lump as its own line).
 * @param {any} p - Period object.
 * @param {any} d - Saved period data.
 * @param {number} rate - Hourly rate.
 */
export function _varPayForPeriod(p, d, rate) {
  const r125      = rate * RATE_125, r150 = rate * RATE_150, r300 = rate * RATE_300;
  const { satHrs, bhHrs, bhOtHrs, otHrs, rdwHrs, sunHrs, boxHrs } = _decodeHours(p, d);
  const { satCapped, bhCapped } = capHours({ effContr: getEffectiveContr(p), satHrs, bhHrs });
  return satCapped * (rate * (RATE_125 - 1)) +
         bhCapped  * (rate * (RATE_125 - 1)) +
         bhOtHrs   * r125                    +
         otHrs     * r125          +
         rdwHrs    * r125          +
         sunHrs    * r150          +
         boxHrs    * r300;
}

// ── HPP ESTIMATOR ─────────────────────────────────────────────────────────────
// Formula from Chiltern payroll: (variable pay above basic) × 4/52 = HPP — the genuinely VARIABLE
// premiums (OT/RDW/Sun/Sat/BH/Boxing) only (see _varPayForPeriod).

// ── AMOUNT SOURCE ─────────────────────────────────────────────────────────────
// Three sources: 'hours' (default — the per-payslip estimator below), 'ytd' (derived FROM the Year to
// Date card's Taxable Pay) or 'exact' (a figure the member enters). Whichever is active, calcHPP
// writes the figure to hppEstKey(ty), which the January take-home add + prior-year rollover read.

/**
 * Rough HPP from a Year to Date TAXABLE PAY figure. Taxable Pay is ALL pay (basic + premiums +
 * London, after pension); HPP is 7.69% of the PREMIUM part only. So we subtract the expected
 * non-premium pay (basic + London − pension) to isolate the premiums, then take 4/52. Pure — the
 * caller computes `nonPremiumYtd` from the covered periods (`_expectedNonPremiumYtd`). Clamps at 0
 * (a negative "premium" means the Taxable Pay figure is below expected basic — nothing to premium).
 * @param {number} taxablePayYtd  Year to Date Taxable Pay from the YTD card
 * @param {number} nonPremiumYtd  expected basic + London − pension over the covered periods
 * @returns {number}
 */
export function hppFromYtdTaxable(taxablePayYtd, nonPremiumYtd) {
  return Math.max(0, (taxablePayYtd || 0) - (nonPremiumYtd || 0)) * HPP_FRACTION;
}

/**
 * Non-premium LUMPS inside a Year to Date Taxable Pay figure that the app itself holds exactly —
 * otherwise the 'ytd' estimate takes 7.69% of each. Three are known: peer-training pay (extra BASIC — 2h per day at the period rate, the same
 * `peerDays × 2 × rate` computeGross uses); last year's Holiday Pay Premium, which lands on this
 * year's January payslip (`hppCarrier`); and the pay award's back-pay lump (`awardCarrier`). Each
 * of the two lumps is inside the figure only once the payslip carrying it is covered.
 *
 * THE BACK-PAY LUMP COMES OUT ONLY IN PART (owner, 10 Nov 2026). Its PREMIUM arrears are premium pay
 * and stay in; its basic and London arrears come out. That split depends only on the record — the
 * award's rates, the London step and the award window — so it is computed, never guessed:
 * `awardLumpNonPremium` (paycalc-backpay-accrual.js) reuses the card's own accrual. Where a rate it
 * needs is not on record (the CES 2025/26 old rate) the caller passes nothing and says so instead.
 *
 * Pure. @param {{ covered: any[], readSaved: (n: number) => ({ data: any, error?: any }),
 *   rateFor: (p: any) => number, hppCarrier: { num: number }|null, priorHppAmount: number,
 *   awardCarrier?: { num: number }|null, awardNonPremium?: number }} a
 * @returns {number}
 */
export function knownYtdLumps({ covered, readSaved, rateFor, hppCarrier, priorHppAmount, awardCarrier = null, awardNonPremium = 0 }) {
  let sum = 0;
  for (const p of covered) {
    const peer = Number(readSaved(p.num)?.data?.peer) || 0;
    if (peer > 0) sum += peer * 2 * rateFor(p);
  }
  if (hppCarrier && covered.some(p => p.num === hppCarrier.num)) sum += Math.max(0, priorHppAmount || 0);
  if (awardCarrier && covered.some(p => p.num === awardCarrier.num)) sum += Math.max(0, awardNonPremium || 0);
  return sum;
}

/**
 * Expected NON-premium taxable pay (basic + London − pension) summed over the tax-year periods the
 * Year to Date figure covers (up to its source payslip, or today if unknown). Subtracted from the
 * YTD Taxable Pay to leave the premium pay that accrues HPP. Reads live grade/rate/pension via the
 * settings + calc helpers, so it tracks the mid-year rate/London steps. @param {any} ty
 * @returns {{ nonPremium: number, count: number, upTo: any, unpricedAward: any, unrecordedPremium: any, unpriced: any }}
 *   `upTo` — the last payslip the figure covers. `unpricedAward` — the payslip carrying a back-pay
 *   lump inside the figure that the record cannot split, else null. `unrecordedPremium` — the January
 *   payslip carrying a Holiday Pay Premium inside the figure that no record holds, else null.
 *   `unpriced` — a covered payslip worked under a role with no rates, whose basic pay cannot come out.
 */
function _expectedNonPremiumYtd(ty) {
  const srcNum      = parseInt(lsGet(ytdSrcKey(ty)) ?? '', 10) || 0;
  // Cap at the YTD source payslip. With none recorded — or the figures detached, the stored '0' —
  // cap at the last PAID payslip (`ytdAutoSource`'s assumption): the payslip still being earned is in
  // no Taxable Pay figure, and counting its basic would leave the estimate a payslip's basic short.
  const now    = new Date();
  const capNum = srcNum || ([...getPeriods()].reverse().find(/** @param {any} p */ p => p.payday <= now)?.num ?? 0);
  const covered = getPeriods().filter(/** @param {any} p */ p => {
    const o = p.num - 48;
    return o >= ty.first && o <= ty.last && p.num <= capNum;
  });
  const upTo = covered[covered.length - 1] ?? null;
  const unpriced = covered.find(/** @param {any} p */ p => !isPeriodPriced(p)) ?? null;
  if (unpriced) return { nonPremium: 0, count: covered.length, upTo, unpricedAward: null, unrecordedPremium: null, unpriced };
  let nonPremium = 0;
  for (const p of covered) {
    // Pro-rate EVERY non-premium component by the joining factor, mirroring calculate() and the real
    // payslip (`basic` carries it via getEffectiveContr): at full value, a mid-year joiner's pre-start
    // periods add phantom "London − pension" pay and bias the estimate LOW. Factor is 0 for a
    // fully-pre-start period and 1 for long-servers / noProRate returns, so this never over-reaches.
    const factor  = getProRateFactor(p);
    // The rate the payslip was PAID at, by the grades of its days (paycalc-settings.js → periodRate).
    const basic   = getEffectiveContr(p) * /** @type {number} */ (periodRate(ty, p).rate);
    const london  = getLondonAllowanceForPeriod(p, ty) * factor;
    // The member's OWN saved pension for the period when present — the typed YTD "Taxable Pay"
    // reflects the actual pension sacrifice, so subtracting only the default over-subtracts on any
    // period where the member overrode it. The one rule every saved-payslip reader shares:
    // savedPeriodPension (an opt-out spell, the floor at £0, the pro-rated default).
    const pension = savedPeriodPension(p, readSavedPeriod(p.num).data, factor);
    nonPremium += basic + london - pension;
  }
  // …plus the lumps the figure holds that are neither basic nor premium (see knownYtdLumps).
  const _paid  = hppPaidInTaxYear(ty, getPeriods(), CONFIG.TAX_YEARS);
  // The award's lump is priced at the grade its backdated months were worked under (awardGrade).
  const _grade = awardGrade(ty);
  const _award = _grade ? _awardLumpInYear(ty, _grade) : null;
  const _prior = _paid ? resolveHppForPeriod(lsGet(hppActualKey(_paid.taxYear)), lsGet(hppEstKey(_paid.taxYear))) : null;
  nonPremium += knownYtdLumps({
    covered, readSaved: readSavedPeriod,
    rateFor: (/** @type {any} */ p) => /** @type {number} */ (periodRate(ty, p).rate),
    hppCarrier: _paid?.payslip ?? null,
    priorHppAmount: _prior?.amount ?? 0,
    awardCarrier: _award?.carrier ?? null,
    awardNonPremium: _award?.nonPremium ?? 0,
  });
  // A lump inside the figure that the record cannot split is NAMED on the card, never guessed.
  const unpricedAward = (_award && _award.nonPremium == null
    && covered.some(/** @param {any} p */ p => p.num === _award.carrier.num)) ? _award.carrier : null;
  // So is a PREMIUM inside the figure that no tax year on record claims: the first year's
  // January payslip carries the year before's, which TAX_YEARS does not hold (16 Jan 2026, 2024/25's),
  // so it cannot come out. Nor can a year ON record whose premium the member has not recorded (no
  // confirmed figure and no estimate) — read as £0, it went uncaveated. A member with no payslip in
  // that year (premiumStillToEstimate's 'none') had none to record.
  const _jan = covered.find(/** @param {any} p */ p => p.payday.getMonth() === 0);
  const _priorKnown = !!_paid && (!!_prior?.hasActual || (_prior?.amount ?? 0) > 0 || premiumStillToEstimate(_paid.taxYear) === 'none');
  const unrecordedPremium = (_jan && !_priorKnown && getProRateFactor(_jan) > 0) ? _jan : null;
  return { nonPremium, count: covered.length, upTo, unpricedAward, unrecordedPremium, unpriced: null };
}

/**
 * The pay award's back-pay lump paid INSIDE `ty`: the payslip carrying it, and its non-premium share
 * from the record (`awardLumpNonPremium` — null when a rate it needs is not on record). Null for a
 * year whose award is undecided: no date, so no lump has been paid into any figure. @param {any} ty
 * @param {string} grade @returns {{ carrier: any, nonPremium: number|null }|null}
 */
function _awardLumpInYear(ty, grade) {
  const from = awardFromForYear(ty.label);
  if (!from) return null;
  const periods = getPeriods();
  const carrierNum = paidInPeriodNum(periods, from);
  const carrier = periods.find(/** @param {any} p */ p => p.num === carrierNum);
  if (!carrier) return null;
  const nonPremium = awardLumpNonPremium({
    window: periodsInTaxYear(ty, periods).filter(p => p.payday < from),
    auth: resolveAuthoritativeRates(ty, awardRatesFor(grade, ty.label)),
    backdate: _awardBackdateDate(ty),
    effContr: getEffectiveContr, proRateFactor: getProRateFactor,
    peerDays: (/** @type {any} */ p) => Number(readSavedPeriod(p.num)?.data?.peer) || 0,
  });
  return { carrier, nonPremium };
}

/** The 'ytd'-mode rough figure and its ingredients, read live from the Year to Date card.
 *  hpp is 0 when the source can't estimate (no Taxable Pay entered, or no covered periods yet —
 *  the caller branches on taxable/count for the specific message). Shared by _renderHppManual
 *  and the per-radio figures (_updateModeAmounts) so the two can never disagree. @param {any} ty
 *  @returns {{ taxable: number, nonPremium: number, count: number, extra: number, hpp: number,
 *              below: boolean, upTo: any, unpricedAward: any, unrecordedPremium: any, unpriced: any }} */
function _ytdRoughHpp(ty) {
  const ytdPayEl = /** @type {HTMLInputElement|null} */ (document.getElementById('ytdPay'));
  const taxable  = Math.max(0, parseSmartFloat(ytdPayEl?.value ?? '') || 0);
  const { nonPremium, count, upTo, unpricedAward, unrecordedPremium, unpriced } = _expectedNonPremiumYtd(ty);
  return {
    taxable, nonPremium, count, upTo, unpricedAward, unrecordedPremium, unpriced,
    extra: Math.max(0, taxable - nonPremium),
    // "Lower than the expected basic" is a refusal, so it needs to BE lower: a figure that matches
    // the expected non-premium pay to the penny is a member with no premium pay — £0.00, not a
    // refusal decided by floating-point noise in either direction.
    below: taxable - nonPremium < -0.005,
    hpp:   (taxable > 0 && count > 0 && !unpriced) ? hppFromYtdTaxable(taxable, nonPremium) : 0,
  };
}

/** The amount-source mode currently selected on the card ('hours' | 'ytd' | 'exact'; default 'hours'). */
function _hppMode() {
  const r = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="hppMode"]:checked'));
  return r ? r.value : 'hours';
}

/** Reflect a mode into the DOM: tick its radio and show only the matching input group. Exported so
 *  the coordinator can restore a saved mode. @param {string} [mode] */
export function applyHppMode(mode = '') {
  const m = mode || _hppMode();
  const radio = /** @type {HTMLInputElement|null} */ (document.getElementById(
    m === 'ytd' ? 'hppModeYtd' : m === 'exact' ? 'hppModeExact' : 'hppModeHours'));
  if (radio) radio.checked = true;
  const ytdWrap   = document.getElementById('hppYtdWrap');
  const exactWrap = document.getElementById('hppExactWrap');
  if (ytdWrap)   ytdWrap.style.display   = m === 'ytd'   ? '' : 'none';
  if (exactWrap) exactWrap.style.display = m === 'exact' ? '' : 'none';
}

/**
 * A tax year's saved amount source, read TOTALLY. Anything that is not a plain object — nothing
 * stored, unreadable text, or JSON that is `null`, a number, a string or an array — is "no saved
 * choice" (`mode: null`), and `damaged` says something WAS stored that could not be read. Only this
 * app writes the blob (`saveHppState`, always an object), so a value of another shape came from a
 * backup made elsewhere, and reading `.mode` off it must not throw during start-up.
 * @param {any} ty
 * @returns {{ mode: 'hours'|'ytd'|'exact'|null, exact: string, damaged: boolean }}
 */
export function readHppState(ty) {
  const raw = ty ? lsGet(hppModeKey(ty)) : null;
  if (raw == null || raw === '') return { mode: null, exact: '', damaged: false };
  /** @type {any} */ let s;
  try { s = JSON.parse(raw); } catch { s = undefined; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { mode: null, exact: '', damaged: true };
  const mode = s.mode === 'hours' || s.mode === 'ytd' || s.mode === 'exact' ? s.mode : null;
  const exact = typeof s.exact === 'string' ? s.exact
    : (typeof s.exact === 'number' && Number.isFinite(s.exact)) ? String(s.exact) : '';
  return { mode, exact, damaged: false };
}

/**
 * Tax years whose saved amount-source choice was UNREADABLE when restored and has not been chosen
 * again since. The card falls back to the hours estimate, and until the member picks
 * an option calcHPP neither overwrites the stored figure — which may be their own typed premium,
 * feeding the January payslip — nor stays silent about why the card shows something else.
 * @type {Set<string>}
 */
const _hppChoiceUnreadable = new Set();

/** Persist the card's mode + the exact-figure input for a tax year (one JSON blob). The 'ytd' mode
 *  has no input of its own (it reads the Year to Date card), so only the mode + exact are stored. @param {any} ty */
export function saveHppState(ty) {
  if (!ty) return;
  const exactEl = /** @type {HTMLInputElement|null} */ (document.getElementById('hppExactAmt'));
  lsSet(hppModeKey(ty), JSON.stringify({ mode: _hppMode(), exact: exactEl ? exactEl.value : '' }));
  _hppChoiceUnreadable.delete(ty.label);   // the member has chosen again
}

/** Restore a tax year's saved mode + exact-figure input into the DOM (called before calcHPP reads it
 *  on a period/year change). Missing or unreadable → default 'hours'. Read through `readHppState`,
 *  which is total: this runs inside start-up (onPeriodChange), where a throw breaks every load. @param {any} ty */
export function restoreHppState(ty) {
  const s = readHppState(ty);
  if (ty) { if (s.damaged) _hppChoiceUnreadable.add(ty.label); else _hppChoiceUnreadable.delete(ty.label); }
  const exactEl = /** @type {HTMLInputElement|null} */ (document.getElementById('hppExactAmt'));
  if (exactEl) exactEl.value = s.exact;
  applyHppMode(s.mode === 'ytd' || s.mode === 'exact' ? s.mode : 'hours');
}

/** The status-word label: bare "Estimated" when a prior-year subhead carries the year, else the
 *  self-contained form. The member's OWN figure ('exact' mode) is not an estimate, so it is labelled
 *  as theirs; the two estimate modes ('hours', 'ytd') keep "Estimated". @param {any} ty @param {string} [mode] */
function _hppLabelText(ty, mode = 'hours') {
  const idx = CONFIG.TAX_YEARS.findIndex(t => t.label === ty.label);
  const hasPrior = idx > 0 && isTaxYearVisible(CONFIG.TAX_YEARS[idx - 1]);
  if (mode === 'exact') return hasPrior ? 'Your figure' : `Your ${ty.label} Holiday Pay Premium`;
  return hasPrior ? 'Estimated' : `Estimated ${ty.label} Holiday Pay Premium`;
}

/** The "how it's calculated" explainer, shared by both modes (it describes what HPP IS). @param {any} ty */
function _hppNoteHtml(ty) {
  return `<strong>How it's calculated (confirmed by Chiltern payroll):</strong> Your extra pay above basic hours (Saturday, overtime, rest day working, Sunday, bank-holiday and Boxing Day premiums) × 7.69% (that's 4 weeks' leave out of 52). Basic pay, London Allowance, peer training, expenses and bonuses are not included. This estimate covers the <strong>tax year ${ty.label}</strong> — Chiltern will pay it in <strong>January ${ty.hppPaidJan}</strong>, and it shows as <strong>Holiday Pay Premium</strong> on that payslip. The more of your payslips you enter above, the closer this gets to the full-year figure.`;
}

/** Render the current-year card from a NON-hours source and persist the resulting figure to
 *  hppEstKey so the take-home add + rollover use it exactly like the hours-mode figure. Deleting on
 *  zero mirrors the hours path so a cleared/empty source can't leave a stale figure.
 *  - 'ytd'   : derive a ROUGH premium figure from the Year to Date card's Taxable Pay (#ytdPay).
 *  - 'exact' : the member's own entered figure (#hppExactAmt).
 *  @param {any} ty @param {string} mode */
function _renderHppManual(ty, mode) {
  const amountEl = document.getElementById('hppAmount');
  const basisEl  = document.getElementById('hppBasis');

  if (mode === 'ytd') {
    const y = _ytdRoughHpp(ty);
    if (y.taxable <= 0) {
      lsDel(hppEstKey(ty));
      if (amountEl) amountEl.textContent = '£–';
      if (basisEl)  basisEl.textContent  = 'Fill in the Year to Date Figures card above (Taxable Pay) to use this';
      return;
    }
    // Zero covered periods (a tax year that hasn't started yet — reachable once next year is added
    // to TAX_YEARS ahead of April, as each new award year is): nonPremium would be 0 and the WHOLE
    // Taxable Pay would be presented as premium — wildly overstated. Refuse to estimate instead.
    if (y.count === 0) {
      lsDel(hppEstKey(ty));
      if (amountEl) amountEl.textContent = '£–';
      if (basisEl)  basisEl.textContent  = `No ${ty.label} payslips have been paid yet, so there's nothing to estimate from — try again once the year is under way.`;
      return;
    }
    // A covered payslip under a role with no rates: its basic pay cannot come out, so no figure.
    if (y.unpriced) {
      lsDel(hppEstKey(ty));
      if (amountEl) amountEl.textContent = '£–';
      if (basisEl)  basisEl.textContent  = `Your Year to Date pay includes your ${fdLong(y.unpriced.payday)} payslip, which this calculator can't estimate for your grade then, so it can't work out the premium from it — enter the figure yourself instead.`;
      return;
    }
    const { extra, hpp } = y;
    if (Math.round(hpp * 100) > 0) lsSet(hppEstKey(ty), hpp.toFixed(2)); else lsDel(hppEstKey(ty));
    if (amountEl) amountEl.textContent = y.below ? '£–' : fmt(hpp);
    if (basisEl) {
      // A back-pay lump in the figure that the record cannot split is SAID, never guessed out (owner).
      const c = y.unpricedAward;
      const lumpNote = c
        ? ` <span class="hpp-partial-hint">This may include back pay: the pay-rise lump on your ${fdLong(c.payday)} payslip is part of your Year to Date pay, and the rates needed to take it out aren't on record, so this figure may be too high.</span>`
        : '';
      // Last year's premium inside the figure, when no record says how much it was: said, never guessed out.
      const u = y.unrecordedPremium;
      const premiumNote = u
        ? ` <span class="hpp-partial-hint">This may be a little high: your Year to Date pay includes any Holiday Pay Premium on your ${fdLong(u.payday)} payslip, and the calculator has no record of that to take out.</span>`
        : '';
      // What the figure COVERS, said: a part-year figure for a year that has ended reads as low.
      const yearLast = /** @type {any} */ (periodsInTaxYear(ty, getPeriods()).pop());
      const part = y.upTo && yearLast && y.upTo.num < yearLast.num && payslipMayBeInHand(yearLast)
        ? ` <span class="hpp-partial-hint">It covers ${ty.label} only up to that payslip, so it may be low — the Year to Date pay on your ${fdLong(yearLast.payday)} payslip covers the whole year.</span>` : '';
      basisEl.innerHTML = !y.below
        ? `Rough estimate from your Year to Date pay up to your ${fdLong(y.upTo.payday)} payslip: ${fmt(extra)} premium pay (your Year to Date Taxable Pay minus expected basic pay + London) × 7.69% · due January ${ty.hppPaidJan} <span class="hpp-partial-hint">This is an approximation from your Year to Date pay — for the accurate figure, fill in your hours on each payslip in the calculator and choose the first option.</span>${part}${lumpNote}${premiumNote}`
        : `Your Year to Date Taxable Pay looks lower than the expected basic pay, so there's no premium to estimate from it — fill in your hours on each payslip in the calculator instead, or enter the figure yourself.`;
    }
    return;
  }

  // 'exact' — the member's own figure.
  const exactEl = /** @type {HTMLInputElement|null} */ (document.getElementById('hppExactAmt'));
  const hpp     = Math.max(0, parseSmartFloat(exactEl?.value ?? '') || 0);
  if (hpp > 0) lsSet(hppEstKey(ty), hpp.toFixed(2)); else lsDel(hppEstKey(ty));
  if (amountEl) amountEl.textContent = hpp > 0 ? fmt(hpp) : '£–';
  if (basisEl)  basisEl.textContent  = hpp > 0
    ? `Entered by you · due January ${ty.hppPaidJan}`
    : 'Enter your Holiday Pay Premium figure above';
}

/**
 * The hours-mode ('from my payslips') estimate, run in EVERY mode — it feeds the per-radio figures
 * as well as the hours-mode render. NO side effects: no DOM writes, no persistence (calcHPP's hours
 * path owns those, guarded on `skipped`).
 *
 * Rate: THIS tax year's settled rate — deliberately NOT the live #hourlyRate field, which shows the
 * PRE-AWARD rate on a pre-award period, so the whole-year estimate would SHIFT with the period viewed.
 *
 * @param {any} ty @param {any[]} allPeriods
 * @returns {{ hpp: number, totalVar: number, pCount: number, usingActuals: boolean,
 *             paidCount: number, skipped: number[], total: number, missingPaid: Date[] }}
 */
function _hoursEstimate(ty, allPeriods) {
  const periods = allPeriods.filter(/** @param {any} p */ p => {
    const o = p.num - 48;
    // Exclude periods ENTIRELY before a mid-year joiner's start (getProRateFactor 0 — never for a
    // noProRate return or a member with no startDate), and payslips under a role with no rates.
    return o >= ty.first && o <= ty.last && getProRateFactor(p) !== 0 && isPeriodPriced(p);
  });

  let totalVar     = 0;
  let pCount       = 0;
  let paidCount    = 0;   // entered periods whose payday has passed (v18.51 — the "N paid + M upcoming" split)
  let usingActuals = false;
  const skipped = /** @type {number[]} */ ([]);   // periods whose saved data couldn't be read — surfaced, never dropped silently
  // Paid payslips with NO saved hours: named on the card so "4 of 13"
  // becomes actionable. Only PAID paydays — a future payslip isn't "missing", it hasn't happened.
  const missingPaid = /** @type {Date[]} */ ([]);
  const _now = new Date();
  // Device-local payslip actuals (developer account only, never served): a period's real varPay
  // replaces the entered-hours estimate — read once here, not per period.
  const _actuals = isActualsDev(getLoggedMember()) ? readPayslipActuals() : null;

  periods.forEach(/** @param {any} p */ p => {
    try {
      const _hppActual = _actuals?.[formatISO(p.payday)];
      if (_hppActual?.varPay != null) {
        totalVar += _hppActual.varPay;
        pCount++;
        if (p.payday <= _now) paidCount++;
        usingActuals = true;
        return;
      }

      const parsed = readSavedPeriod(p.num);
      if (parsed.error) { skipped.push(p.num); console.warn('[PayCalc] HPP corrupt period', p.num); return; }
      if (!parsed.data || isDataEmpty(parsed.data)) {
        if (p.payday <= _now) missingPaid.push(p.payday);
        return;
      }
      pCount++;
      if (p.payday <= _now) paidCount++;
      // Each payslip at ITS settled rate: the grades it was worked under, weighted by their days.
      totalVar += _varPayForPeriod(p, parsed.data, /** @type {number} */ (settledRateFor(p, ty)));
    } catch (e) {
      // A corrupt saved period must not abort the whole estimate, but dropping it silently would
      // under-state the premium — record it (surfaced by calcHPP) and trace it.
      skipped.push(p.num);
      console.warn('[PayCalc] HPP skipped period', p.num, e);
    }
  });

  return { hpp: totalVar * HPP_FRACTION, totalVar, pCount, paidCount, usingActuals, skipped, total: periods.length, missingPaid };
}

/**
 * Print each amount-source's CURRENT figure beside its radio, so choosing a mode is informed — and a
 * big gap between "from my payslips" and "from Year to Date" itself signals incomplete hours.
 * Estimates carry a leading "≈"; the member's own figure is plain; a source with nothing shows nothing.
 * @param {any} ty @param {{ hpp: number, pCount: number }} hoursRes
 */
function _updateModeAmounts(ty, hoursRes) {
  const set = /** @param {string} id @param {string} txt */ (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };
  set('hppModeHoursAmt', (hoursRes.pCount > 0 && hoursRes.hpp > 0) ? `≈ ${fmt(hoursRes.hpp)}` : '');
  const _ytd = _ytdRoughHpp(ty);
  set('hppModeYtdAmt', Math.round(_ytd.hpp * 100) > 0 ? `≈ ${fmt(_ytd.hpp)}` : '');
  const exactEl = /** @type {HTMLInputElement|null} */ (document.getElementById('hppExactAmt'));
  const exact   = Math.max(0, parseSmartFloat(exactEl?.value ?? '') || 0);
  set('hppModeExactAmt', exact > 0 ? fmt(exact) : '');
}

/**
 * Compute and display the HPP estimate for the current tax year.
 * Called by calculate() after every calculation.
 *
 * Back pay is deliberately NOT added into the premium here (invariant 5): every period is priced at
 * its SETTLED (post-award) rate (settledRateFor), which already includes the award uplift — the
 * lump's variable portion — so adding the lump would count it twice. The paid-in tick still adds the
 * lump to that period's TAKE-HOME. London accrues none (invariant 6).
 */
export function calcHPP() {
  const allPeriods = getPeriods();

  const pNum    = currentPeriodNum();
  const curP    = allPeriods.find(/** @param {any} x */ x => x.num === pNum);
  const ty      = taxYearForPeriod(curP);

  // Label + explainer are set once, up front. The explainer is the same in every amount-source mode;
  // the label says "Estimated" for the two estimates and names the member's own figure as theirs.
  const _mode = _hppMode();
  const _labelEl = document.getElementById('hppLabel');
  if (_labelEl) _labelEl.textContent = _hppLabelText(ty, _mode);
  const _noteEl = document.getElementById('hppNote');
  if (_noteEl) _noteEl.innerHTML = _hppNoteHtml(ty);

  // The hours estimate is computed in EVERY mode (it feeds the per-radio figures); persistence stays
  // strictly per-mode below — only the ACTIVE mode's figure is written to hppEstKey.
  const hoursRes = _hoursEstimate(ty, allPeriods);
  _updateModeAmounts(ty, hoursRes);

  // Manual amount sources ('ytd' / 'exact') short-circuit the per-payslip estimator below.
  if (_mode !== 'hours') { _renderHppManual(ty, _mode); updatePriorHpp(ty); return; }

  const { hpp, totalVar, pCount, usingActuals, skipped: _skipped } = hoursRes;
  const amountEl = document.getElementById('hppAmount');
  const basisEl  = document.getElementById('hppBasis');

  // Persist the running estimate so it survives into the next tax year; delete it at zero so a
  // stale figure is not added to the January payslip after entries are cleared. Only when the
  // computation was CLEAN: with periods skipped as corrupt, `hpp` is UNDER-stated, so neither
  // overwrite nor delete a stored figure (the card still SHOWS it, with the "may be too low"
  // warning). Nor while this year's saved CHOICE is unreadable: hours mode is then a fallback
  // nobody chose, and the stored figure may be the member's own.
  const _choiceLost = _hppChoiceUnreadable.has(ty.label);
  if (_skipped.length === 0 && !_choiceLost) {
    if (hpp > 0) lsSet(hppEstKey(ty), hpp.toFixed(2));
    else lsDel(hppEstKey(ty));
  }

  // The status-word label ("Estimated" / self-contained form) was set up front via _hppLabelText.
  if (pCount === 0) {
    if (amountEl) amountEl.textContent = '£–';
    if (basisEl)  basisEl.textContent  = 'Enter your hours on each payslip above to calculate';
    // EVERY readable period failed to parse — the worst case must not be the silent one (the
    // partial-corruption warning below only renders on the non-empty branch).
    if (_skipped.length && basisEl) {
      basisEl.innerHTML += ` <span class="pay-skip-warn"><span aria-hidden="true">⚠️</span> Couldn't read ${_skipped.length} saved payslip${_skipped.length > 1 ? 's' : ''}, so no premium could be calculated — open ${_skipped.length > 1 ? 'those periods' : 'that period'} above and enter the hours again.</span>`;
    }
  } else {
    if (amountEl) amountEl.textContent = fmt(hpp);
    if (basisEl) {
      // Show pCount OUT OF the year's total payslips, so a member with only a few entered sees WHY
      // the figure is small (a partial estimate looks authoritative).
      const _total = hoursRes.total;
      // When entered periods include FUTURE payslips (calendar-filled ahead of time), say so, or the
      // count clashes with the Year to Date card's "4 of 4 paid" frame.
      const _upcoming = pCount - hoursRes.paidCount;
      const _countPhrase = _upcoming > 0
        ? `${hoursRes.paidCount} paid and ${_upcoming} upcoming ${hoursRes.paidCount + _upcoming === 1 ? 'payslip' : 'payslips'} entered`
        : `${pCount} of ${_total} payslip${_total !== 1 ? 's' : ''} entered`;
      basisEl.textContent = usingActuals
        ? `All ${pCount} payslips of ${ty.label} · ${fmt(totalVar)} extra pay × 7.69% · from your payslips · due January ${ty.hppPaidJan}`
        : `${_countPhrase} · ${fmt(totalVar)} extra pay × 7.69% · due January ${ty.hppPaidJan}`;
      // Clean partial (no unreadable periods): nudge the member that the estimate isn't the
      // full-year figure yet, NAMING the paid payslips still empty so "N of M" is actionable.
      // All paid payslips entered → say so; only future ones remain.
      if (!usingActuals && _skipped.length === 0 && pCount < _total) {
        const _miss = hoursRes.missingPaid;
        basisEl.innerHTML += ` <span class="hpp-partial-hint">${_miss.length
          ? `Not entered yet: ${fdList(_miss)}. For the full-year figure, fill in your hours on each payslip of the year.`
          : `You're up to date — later payslips join the estimate as the year goes on.`}</span>`;
      }
    }
    // A corrupt saved period was excluded, so this premium may be too low — surface it rather than
    // quietly under-stating money (no-silent-caps). Rare: only malformed localStorage trips it.
    if (_skipped.length && basisEl) {
      basisEl.innerHTML += ` <span class="pay-skip-warn"><span aria-hidden="true">⚠️</span> Couldn't read ${_skipped.length} saved payslip${_skipped.length > 1 ? 's' : ''}, so this may be too low — open ${_skipped.length > 1 ? 'those periods' : 'that period'} above and enter the hours again.</span>`;
    }
  }
  if (_choiceLost && basisEl) {
    const kept = resolveHppForPeriod(null, lsGet(hppEstKey(ty))).amount;
    basisEl.innerHTML += ` <span class="pay-skip-warn"><span aria-hidden="true">⚠️</span> Your saved choice of where this figure comes from couldn't be read, so this shows the estimate from your hours. ${kept > 0
      ? `Your saved figure of ${fmt(kept)} stays in use until you choose an option above.`
      : 'Choose an option above to keep one.'}</span>`;
  }

  // The "how it's calculated" note was set up front via _hppNoteHtml (shared with the manual modes).
  updatePriorHpp(ty);
}

// ── PRIOR YEAR HPP SECTION ───────────────────────────────────────────────────
// Shows the previous tax year's HPP estimate (or confirmed actual) in the HPP card.
// Called at the end of calcHPP() so it refreshes whenever the main calculation runs.

/**
 * What a confirmed prior-year premium, as typed, is STORED as: a clean 2dp figure, or null to clear
 * the confirmation — never the text verbatim ("1,200" reads back through parseFloat as 1). Blank or
 * not a figure clears it; a typed 0 IS a confirmed figure (a year of absence); a negative floors to 0.
 * @param {string} raw @returns {string|null}
 */
export function priorHppToStore(raw) {
  const v = parseSmartFloatOrNull(raw);
  return v == null ? null : Math.max(0, v).toFixed(2);
}

/**
 * Commit the prior-year premium typed on the card of payslip year `ty` into THAT year's prior year,
 * and repaint the section. The caller commits on `change` (leaving the field), never per keystroke,
 * which flashed "✓ Confirmed £8.00" on the way to 843 and let a stray key delete a confirmed figure.
 * The first tax year on record has no prior year to commit to.
 * @param {any} ty - the viewed payslip's tax year @param {string} raw - the field's text
 */
export function commitPriorHppActual(ty, raw) {
  const idx = CONFIG.TAX_YEARS.findIndex(t => t.label === ty.label);
  if (idx <= 0) return;
  const key = hppActualKey(CONFIG.TAX_YEARS[idx - 1]);
  const v = priorHppToStore(raw);
  if (v != null) lsSet(key, v); else lsDel(key);
  updatePriorHpp(ty);
}

/**
 * Is a tax year's premium still this member's to estimate? The reader of the Pay page's January notice
 * (`hpp_2526`, paycalc-lightboxes.js), asked as it is wired; 'none' or 'done' retires it unseen.
 *  - 'none' — no payslip in the year: its last pay period closed before they started.
 *  - 'done' — a figure the member made: confirmed off the January payslip, typed in, or stored from
 *    the Year to Date pay on the year's LAST payslip — a rough figure from an earlier one covers part
 *    of the year, and is the low figure the notice is there to replace.
 *  - 'open' — anything else; an hours estimate from part of the year is no reason to stay quiet.
 * @param {any} ty  a CONFIG.TAX_YEARS entry @returns {'none'|'done'|'open'}
 */
export function premiumStillToEstimate(ty) {
  const own  = periodsInTaxYear(ty, getPeriods());
  const last = own[own.length - 1];
  if (!last || getProRateFactor(last) === 0) return 'none';
  if (resolveHppForPeriod(lsGet(hppActualKey(ty)), null).hasActual) return 'done';
  const s = readHppState(ty);
  const wholeYear = (parseInt(lsGet(ytdSrcKey(ty)) ?? '', 10) || 0) >= last.num;
  // "Typed in" means a figure in the box: a stored figure beside an EMPTY "Enter the figure yourself"
  // box was never theirs (`_typedByMember`).
  const theirs = !s.damaged && ((s.mode === 'ytd' && wholeYear) || (s.mode === 'exact' && _typedByMember(s)));
  return theirs && resolveHppForPeriod(null, lsGet(hppEstKey(ty))).amount > 0 ? 'done' : 'open';
}

/** Is there a figure in a year's "Enter the figure yourself" box, as its saved state holds it?
 *  @param {{ exact: string }} s  `readHppState`'s answer @returns {boolean} */
function _typedByMember(s) {
  return (parseSmartFloatOrNull(s.exact) ?? 0) > 0;
}

/**
 * Which amount source wrote a tax year's STORED premium: that year's own saved choice ('hours' when it
 * never had one, as calcHPP then ran in hours mode), or 'unknown' when the saved choice is unreadable.
 * @param {any} ty @returns {'hours'|'ytd'|'exact'|'unknown'}
 */
function _savedSourceOf(ty) {
  const s = readHppState(ty);
  return s.damaged ? 'unknown' : (s.mode ?? 'hours');
}

/**
 * Last year's premium in the words its own card uses for it — never "Estimated from your periods"
 * over one payslip of thirteen, or over a figure the member typed themselves. The count is a fact
 * about what is saved, so it is stated as one ("N of M … entered").
 * @param {any} priorTy @param {'hours'|'ytd'|'exact'|'unknown'} source @returns {string}
 */
function _priorSourcePhrase(priorTy, source) {
  if (source === 'exact') return 'Entered by you';
  if (source === 'ytd')   return `Rough estimate from your ${priorTy.label} Year to Date pay`;
  if (source === 'hours') {
    const h = _hoursEstimate(priorTy, getPeriods());
    if (h.pCount > 0) return `${h.pCount} of ${h.total} ${priorTy.label} payslip${h.total !== 1 ? 's' : ''} entered`;
  }
  return `Estimated from your ${priorTy.label} payslips`;
}

/**
 * What last year's block asks for when that year's chosen source has no figure in it yet — said where
 * the member is, and pointing to where the figure is made: that year's own Holiday Pay Premium card.
 * The Year to Date route names the year's LAST payslip, whose Year to Date box holds the whole year
 * (the January notice's route).
 * @param {any} priorTy @param {'ytd'|'exact'|'unknown'} source @returns {string}
 */
function _priorSourcePrompt(priorTy, source) {
  const year = priorTy.label;
  if (source === 'exact') return `No figure yet — you chose to enter the ${year} figure yourself. Open any ${year} payslip and type it into this card.`;
  if (source === 'ytd') {
    const last = /** @type {any} */ (periodsInTaxYear(priorTy, getPeriods()).pop());
    const where = last ? `your ${fdLong(last.payday)} payslip` : `your last ${year} payslip`;
    return `No figure yet — you chose a rough estimate from your ${year} Year to Date pay. Open ${where} and copy its Year to Date Taxable Pay into Year to Date Figures.`;
  }
  return `Your saved choice of where the ${year} figure comes from couldn't be read — open any ${year} payslip and choose an option in this card.`;
}

/**
 * Update the prior-year HPP section of the HPP card.
 * @param {any} ty - Current tax year object from CONFIG.TAX_YEARS.
 */
export function updatePriorHpp(ty) {
  const section = document.getElementById('priorHppSection');
  if (!section) return;

  const tyIdx = CONFIG.TAX_YEARS.findIndex(t => t.label === ty.label);
  if (tyIdx <= 0) {
    section.classList.add('hidden');
    return;
  }

  const priorTy   = /** @type {any} */ (CONFIG.TAX_YEARS[tyIdx - 1]);
  // New-starter visibility clamp: a member who only joined THIS tax year earns no prior-year HPP —
  // hide the section entirely, the clamp the period select / tax-year tabs / prev-next honour.
  if (!isTaxYearVisible(priorTy)) { section.classList.add('hidden'); return; }
  const estRaw    = lsGet(hppEstKey(priorTy));
  const actualRaw = lsGet(hppActualKey(priorTy));
  let   est       = estRaw    ? parseFloat(estRaw)    : 0;
  let _priorSkipped = 0;   // corrupt prior-year periods — surfaced on the card, never console-only (v16.70)
  // A confirmed actual is any stored FIGURE, not `> 0` (a genuine £0 is confirmed). One rule with the
  // take-home's, so the card and the January payslip can never disagree about what is confirmed.
  const { hasActual, amount: actual } = resolveHppForPeriod(actualRaw, null);
  const _anyStored = actualRaw != null && actualRaw.trim() !== '';   // even text that is not a figure
  // A STORED figure is whatever that year's own amount source last wrote; one computed below is from
  // the saved hours, which only happens while that source IS the hours. The block says which — see
  // _priorSourcePhrase.
  const source = _savedSourceOf(priorTy);
  // "Enter the figure yourself" with nothing in its box has no figure of the member's. A stored one
  // beside it was worked out from hours by this function before 17 Nov 2026 and only labelled as
  // theirs — so it goes, as calcHPP deletes it on that year's own payslip.
  if (source === 'exact' && est > 0 && !hasActual && !_typedByMember(readHppState(priorTy))) {
    lsDel(hppEstKey(priorTy));
    est = 0;
  }

  // If no stored estimate yet, compute on the fly so the prior-year HPP section
  // is populated on first login even before the user has visited a prior-year period.
  // ONLY WHILE THAT YEAR'S SOURCE IS ITS HOURS (17 Nov 2026). A year whose member chose to type the
  // figure, or to work it from Year to Date pay, has nothing from them yet: an hours figure stored here
  // was then read back under THEIR choice's name ("Your figure — Entered by you", or "Rough estimate
  // from your Year to Date pay"), counted as done, and taken to the January payslip — a figure not on
  // record, dressed as one (paycalc.md invariant 1). Nothing is computed; the block asks for theirs.
  if (est === 0 && !hasActual && source === 'hours') {
    const _priorPeriods = getPeriods().filter(/** @param {any} p */ p => {
      const o = p.num - 48;
      return o >= priorTy.first && o <= priorTy.last;
    });

    if (isActualsDev(getLoggedMember())) {
      const _act = readPayslipActuals();
      const _priorVar = _priorPeriods.reduce((/** @type {number} */ sum, /** @type {any} */ p) => {
        const a = _act[formatISO(p.payday)];
        return a?.varPay != null ? sum + a.varPay : sum;
      }, 0);
      if (_priorVar > 0) est = _priorVar * HPP_FRACTION;
    } else {
      // The PRIOR year's settled rate — derived from AWARD_RATES per tax year, so last
      // year prices at last year's rate, never the current one — and per payslip, by the grades its
      // days were worked under (settledRateFor).
      let _priorVar = 0;
      _priorPeriods.forEach(/** @param {any} p */ p => {
        try {
          const parsed = readSavedPeriod(p.num);
          if (parsed.error) { _priorSkipped++; console.warn('[PayCalc] HPP prior-year corrupt period', p.num); return; }
          if (!parsed.data) return;
          const d = parsed.data;
          if (isDataEmpty(d) || !isPeriodPriced(p)) return;   // never priced as CEA's (pay-audience.js)
          _priorVar += _varPayForPeriod(p, d, /** @type {number} */ (settledRateFor(p, priorTy)));
        } catch (e) {
          _priorSkipped++;
          console.warn('[PayCalc] HPP prior-year skipped period', p.num, e);
        }
      });
      if (_priorVar > 0) est = _priorVar * HPP_FRACTION;
    }

    // Persist only a CLEAN prior-year estimate — a partial (skipped-period) figure is understated
    // and must not overwrite a good stored value or the January take-home add (mirrors calcHPP).
    if (est > 0 && _priorSkipped === 0) lsSet(hppEstKey(priorTy), est.toFixed(2));
  }

  const pNum = currentPeriodNum();
  const curP = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
  // Is the payslip on screen the one that carries LAST year's premium? Asked of the shared
  // schedule (paycalc-hpp-schedule.js) rather than re-derived here (invariant 4).
  const _carrier = hppPayslipForTaxYear(priorTy, getPeriods());
  const isJanPayday = !!(curP && _carrier && _carrier.num === curP.num);

  const priorHppTitleEl    = document.getElementById('priorHppTitle');
  const currentHppTitleEl  = document.getElementById('currentHppTitle');
  if (priorHppTitleEl)   priorHppTitleEl.textContent   = `Last year (${priorTy.label})`;
  if (currentHppTitleEl) currentHppTitleEl.textContent = `This year (${ty.label})`;

  const dueBadge = document.getElementById('priorHppDueBadge');
  if (dueBadge) dueBadge.classList.toggle('hidden', !isJanPayday || hasActual);

  // The confirm box opens once the January payslip carrying the premium can be IN THE MEMBER'S HAND —
  // from its cut-off, not its payday (`payslipMayBeInHand`, the app's one rule for that). A stored
  // actual keeps it open whatever the date: a wrong figure must never be locked in.
  const inHand = !!(_carrier && payslipMayBeInHand(/** @type {any} */ (_carrier)));   // a full grid period

  const amtLabel = document.getElementById('priorHppAmtLabel');
  const amtEl    = document.getElementById('priorHppAmt');
  const basisEl  = document.getElementById('priorHppBasis');

  if (hasActual) {
    if (amtLabel) amtLabel.innerHTML  = `<span class="actual-badge"><span aria-hidden="true">✓</span> Confirmed</span>`;
    if (amtEl)    amtEl.textContent   = fmt(actual);
    if (basisEl)  basisEl.textContent = `Confirmed from your January ${priorTy.hppPaidJan} payslip`;
  } else if (est > 0) {
    const basis  = _priorSourcePhrase(priorTy, source);
    if (amtLabel) amtLabel.textContent = isJanPayday ? 'Expected on this payslip' : source === 'exact' ? 'Your figure' : 'Estimated';
    if (amtEl)    amtEl.textContent    = fmt(est);
    // Never "enter the confirmed amount below" over a box that is still locked.
    if (basisEl)  basisEl.textContent  = !isJanPayday ? `${basis} · due January ${priorTy.hppPaidJan}`
      : inHand ? `${basis} — check your January ${priorTy.hppPaidJan} payslip and enter the confirmed amount below`
      : `${basis} — enter the confirmed amount below once your January ${priorTy.hppPaidJan} payslip arrives`;
  } else {
    if (amtLabel) amtLabel.textContent = source === 'exact' ? 'Your figure' : 'Estimated';
    if (amtEl)    amtEl.textContent    = '£–';
    // "No variable pay recorded" would be a LIE when the truth is unreadable saved data — or when the
    // member chose a source that has nothing in it yet, which is what that source's own card asks for.
    if (basisEl)  basisEl.textContent  = source !== 'hours'
      ? _priorSourcePrompt(priorTy, source)
      : _priorSkipped > 0
        ? `Couldn't read ${_priorSkipped} saved ${priorTy.label} payslip${_priorSkipped > 1 ? 's' : ''} — open ${_priorSkipped > 1 ? 'those periods' : 'that period'} and enter the hours again, then check your January ${priorTy.hppPaidJan} payslip`
        : `No ${priorTy.label} variable pay recorded — check your January ${priorTy.hppPaidJan} payslip`;
  }
  // Corrupt periods behind a PARTIAL estimate: the figure shown may be too low — say so.
  if (_priorSkipped > 0 && !hasActual && est > 0 && basisEl) {
    basisEl.innerHTML += ` <span class="pay-skip-warn"><span aria-hidden="true">⚠️</span> Couldn't read ${_priorSkipped} saved period${_priorSkipped > 1 ? 's' : ''}, so this may be too low.</span>`;
  }

  const input = document.getElementById('priorHppActualInput');
  // DISABLED until that payslip can be in hand (`inHand`, above): there is no printed figure to copy
  // before then. Anything stored keeps it enabled — a figure that needs correcting, or text that
  // needs clearing, must never be locked in.
  if (input) {
    const stored = actualRaw || '';
    if (document.activeElement !== input) /** @type {HTMLInputElement} */ (input).value = stored;
    /** @type {HTMLInputElement} */ (input).disabled = !inHand && !_anyStored;
  }
  // The entry apparatus must not go stale once a figure is confirmed: the "enter when the
  // payslip arrives" note only shows while EMPTY, and the hint flips to how to undo.
  const actNote = document.getElementById('priorHppActualNote');
  if (actNote) actNote.classList.toggle('hidden', hasActual);
  const actHint = document.getElementById('priorHppActualHint');
  // The premium joins a take-home only through the opt-in tick in that payslip's green note, so the
  // hint says where that is rather than promising the take-home changes on its own.
  if (actHint) actHint.innerHTML = hasActual
    ? 'Entered from your January payslip — clear the box to go back to the estimate.'
    : inHand
      ? `Find the <strong>Holiday Pay Premium</strong> line on your January ${priorTy.hppPaidJan} payslip and enter it here — it replaces the estimate above. To count it in that payslip's take-home, tick the box in its green note.`
      : `Unlocks when your January ${priorTy.hppPaidJan} payslip arrives — the confirmed <strong>Holiday Pay Premium</strong> figure on it replaces the estimate above.`;

  section.classList.remove('hidden');
}
