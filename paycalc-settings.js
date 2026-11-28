// @ts-check
/**
 * paycalc-settings.js — each payslip's rate, contracted hours, the pension controls and Settings save/load.
 *
 * Owns: getEffectiveContr/getProRateFactor/getPensionDefault, the rates (settledRate, settledRateFor,
 *   awardGrade, periodRate), updateRateForPeriod, updateYtdForTaxYear, settingsKey, saveSettings,
 *   confirmSettings, setSettingsCardOpen, loadSettings, and wireSettingsCard — the card's place in the
 *   desktop Tab order and the setup banner's link to it.
 * Does NOT own: the grade setting and its controls (paycalc-grade-setting.js — re-exported below for
 *   the callers that read it here), the grade rules (paycalc-grade.js), period arithmetic
 *   (paycalc-periods.js), pay maths (paycalc-calc.js), roster hints (paycalc-roster-hint.js).
 * Edit here for: rates, settings persistence, rate/YTD field updates.
 * Do not edit here for: pay maths, period date maths, roster pre-fill.
 */

import { GRADES, taxYearForPeriod, calcProRateFactor, getPensionForPeriod, getRateForPeriod, isPreAwardPeriod, awardRatesFor, awardFromForYear } from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, periodByNum, viewedPeriod, todaysPeriodNum, visiblePeriods, appendPayslipOptions, offerRecordedPayslip } from './paycalc-periods.js';
import { SK, periodKey, ytdPayKey, ytdTaxKey, pcPrefix, readSavedPeriod, parseSavedPeriod } from './paycalc-migrations.js';
import { gradeForRole } from './roster-data.js';
import { byDays, gradeSplitLine, windowGrade } from './paycalc-grade.js';
import { awardWindow } from './paycalc-backpay-accrual.js';
import {
  getGradeSetting, gradeDaysFor, getContr, getLoggedMember, gradeToOffer, renderGradePrompt,
  saveGradeSetting, loadGradeSetting, isPeriodPriced, unpricedLineFor,
} from './paycalc-grade-setting.js';
import { lsGet, lsSet, lsSetVerified } from './ls.js';
import { fdShort } from './paycalc-format.js';
import { setStatus } from './status-text.js';
import { pensionToStore } from './paycalc-form-data.js';
import {
  parsePensionTimeline, serialisePensionTimeline, isOptedOutAt,
  withOptOutStartAt, withRejoinAt, optOutStartsAt, migrateLegacyOptOut,
} from './paycalc-pension.js';

// `gradeForRole` — which pay grade a member's ROLE is, or null when this app has no confirmed
// rates for it. It lives in roster-data.js (the Calendar asks it too); re-exported for this module's readers.
export { gradeForRole };
// The grade setting lives in paycalc-grade-setting.js; re-exported for its readers here.
export { getGradeSetting, gradeDaysFor, getContr, getLoggedMember, gradeToOffer, renderGradePrompt, isPeriodPriced, unpricedLineFor };

/**
 * Return effective contracted hours for the given period, pro-rated if the
 * logged-in member started mid-period.
 * @param {any} p - Period object with .start and .cutoff Date properties.
 * @returns {number} Contracted hours (full or pro-rated).
 */
export function getEffectiveContr(p) {
  const base   = getContr(p);
  if (!p) return base;
  if (getLoggedMember()?.noProRate) return base;
  const factor = calcProRateFactor(getLoggedMember()?.startDate, p.start, p.cutoff);
  return factor === 1 ? base : Math.round(base * factor);
}

/** Returns the fraction of the period that the logged-in member was employed — calcProRateFactor
 *  (paycalc-calc.js) holds the formula invariant. */
/** @param {any} p */
export function getProRateFactor(p) {
  if (!p) return 1;
  if (getLoggedMember()?.noProRate) return 1;
  return calcProRateFactor(getLoggedMember()?.startDate, p.start, p.cutoff);
}

/** The one tax year the retired v21.64–v21.77 opt-out flag can have been set in (see loadSettings). */
const LEGACY_OPT_OUT_YEAR = '2026/27';

/** The member's pension-status timeline, read fresh (it is small, and a stale copy is how a
 *  Settings save and the next recompute disagree). @returns {import('./paycalc-pension.js').PensionChange[]} */
function getPensionTimeline() {
  return parsePensionTimeline(lsGet(SK.pensionTimeline));
}

/** @param {import('./paycalc-pension.js').PensionChange[]} timeline @returns {boolean} whether it read back */
function savePensionTimeline(timeline) {
  return lsSetVerified(SK.pensionTimeline, serialisePensionTimeline(timeline));
}

/**
 * Was this member OUT of the pension scheme ON THIS PAYSLIP (opted out / withdrawn from the RPS)?
 *
 * PERIOD-AWARE, and that is the whole point (paycalc-pension.js): as a bare boolean it made the
 * default £0 for every payslip ever, rewriting history (£160.78 → £0.00 on a 2025/26 payslip,
 * £115.92 onto its take-home). No period in hand answers CONTRIBUTING — the answer that changes no
 * stored figure.
 *
 * @param {any} [pObj] @returns {boolean}
 */
export function isPensionOptedOut(pObj) {
  return isOptedOutAt(getPensionTimeline(), pObj?.num ?? null);
}

/** Reflect the out-of-scheme choice in the amount field: an amount nobody pays is not editable.
 *  Disabled rather than hidden — the figure still answers "what came off my pay?", as nil.
 *  Takes the VIEWED period: the lock follows the timeline, so a payslip from before the member left
 *  the scheme stays editable and keeps its real figure.
 *  @param {any} [pObj] */
export function applyPensionOptOutUI(pObj) {
  const out = isPensionOptedOut(pObj);
  const amt = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));
  if (amt) {
    amt.disabled = out;
    if (out) amt.value = '0.00';
  }
  document.getElementById('pensionAmt')?.closest('.pfx')?.classList.toggle('is-disabled', out);
  // A payslip worked as a CES starts at the CEA figure (no CES pension line is on record,
  // VAL-PAY-007), and SAYS so beside the box — except inside an opt-out spell, locked at £0.00.
  const cesNote = document.getElementById('pensionCesNote');
  if (cesNote) cesNote.hidden = out || !pObj || !gradeDaysFor(pObj).some(x => x.grade === 'ces');
}

/**
 * Build (and set) the "not in the scheme from which payslip?" control.
 *
 * The same shape as the student-loan cutover select below it (one option per visible payslip,
 * grouped by tax year, date first): one idiom for "name the first payslip where this changed".
 *
 * WHAT IT IS SET TO MATTERS. Re-opening Settings shows the payslip already ON RECORD, not today's:
 * defaulting back to the current payslip invites an accidental correction that silently moves
 * months of pension. Only a member who has never recorded a change gets today's payslip.
 *
 * @param {import('./paycalc-pension.js').PensionChange[]} timeline
 */
export function buildPensionFromSelect(timeline) {
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('pensionOptOutFrom'));
  const field = document.getElementById('pensionOptOutField');
  if (!sel) return;
  sel.innerHTML = '';
  appendPayslipOptions(sel, visiblePeriods());
  // WHAT THE SELECT IS SET TO IS WHAT `saveSettings` ACTS ON: while TICKED it names where the spell
  // begins; while UNTICKED, the payslip on screen — how the hint records a rejoin. Set to the spell's
  // start on an untick, every untick erased the spell rather than ending it.
  //
  // `currentPeriodNum()` READS THE PERIOD SELECT, which does not exist yet at boot (it returns 0), so
  // fall through to today's payslip: a select set to a value no option carries selects nothing.
  const checked = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionOptOutCheck'))?.checked;
  const start   = checked ? optOutStartsAt(timeline) : null;
  offerRecordedPayslip(sel, start);
  sel.value = String(start ?? (currentPeriodNum() || todaysPeriodNum()));
  // Shown only while out of the scheme: its question has no answer once back in (a rejoin is dated
  // by the payslip on screen, not this control).
  field?.classList.toggle('hidden', !checked);
}

/**
 * Payslip `p`'s DEFAULT pension, UNROUNDED: the period-aware scheme default (PENSION_STEPS via
 * getPensionDefault) × the joining-period pro-rate. The ONE statement of that rule — the field's
 * figure below rounds it, and a saved payslip with no figure of its own is priced on it as it stands
 * (paycalc-hpp.js → `savedPeriodPension`, which passes the factor it already holds).
 * @param {any} p @param {number} [factor] getProRateFactor(p), unless the caller holds it
 * @returns {number}
 */
export function joinerDefaultPension(p, factor = getProRateFactor(p)) {
  return (parseFloat(String(getPensionDefault(p))) || 0) * factor;
}

/**
 * This period's DEFAULT pension as the £ number the field would show: `joinerDefaultPension`,
 * rounded to 2dp. The ONE source for every comparison/write of it. No period → the bare current default.
 * @param {any} [p] @returns {number}
 */
export function periodDefaultPension(p) {
  return p
    ? parseFloat(joinerDefaultPension(p).toFixed(2))
    : (parseFloat(String(getPensionDefault())) || 0);
}

/**
 * Wire the pension card's two controls — the "not in the scheme" tick and the payslip it starts
 * from. Everything they touch is here; the coordinator injects only what it alone knows.
 *
 * ORDER MATTERS in the tick handler. The date control is BUILT before the save, so a first tick has
 * a payslip to date itself from (`saveSettings` reads that control), and an UN-tick is dated to the
 * payslip on screen rather than the spell's own start, which turned every rejoin into an erasure.
 *
 * @param {{ autosave: () => void }} deps  the coordinator's persist-and-reprice — it owns what is saved
 *   (only the pension field, and only into a payslip that already has readable entries).
 */
export function wirePensionControls({ autosave }) {
  const _viewed = () => viewedPeriod();
  const _amt = () => /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));

  // THE PAYSLIP'S OWN FIGURE SURVIVES BOTH CONTROLS (paycalc-3-3). An UNLOCKED field shows a payslip's
  // stored pension, as loadPeriodData would — never the scheme default — and a LOCKED one leaves it
  // dormant behind the lock's £0.00, which every surface prices at £0.
  const _own = (/** @type {any} */ p) => (p ? readSavedPeriod(p.num).data?.pension : null) ?? null;
  const _repaint = (/** @type {any} */ p) => {
    const amt = _amt();
    if (!amt || amt.disabled) return;
    const own = _own(p);
    amt.value = own != null ? String(own) : periodDefaultPension(p).toFixed(2);
  };
  // `autosave` persists the field and re-prices. Behind a locked £0.00 the payslip's own figure is
  // kept by the round trip (`readFormData`'s `savedPension`) and put back here too, so it lies
  // dormant rather than lost whatever save this module is handed.
  const _persist = () => {
    const p = _viewed();
    const own = _amt()?.disabled ? _own(p) : null;
    autosave();
    if (own != null) keepSavedPension(p.num, own);
  };

  document.getElementById('pensionOptOutCheck')?.addEventListener('change', () => {
    buildPensionFromSelect(getPensionTimeline());
    saveSettings();
    buildPensionFromSelect(getPensionTimeline());
    const p = _viewed();
    applyPensionOptOutUI(p);
    // Un-ticking must take the lock's £0.00 away, or the next save persists it as a real opt-out.
    _repaint(p);
    _persist();
  });

  // Moving the boundary re-prices both sides of it, so the field, the lock and the estimate are all
  // repainted. `saveSettings` MOVES the spell's start rather than recording a second change (a later
  // pick would be swallowed by the earlier change in front of it). The control is then rebuilt from
  // the record: a start moved at or before an earlier rejoin is refused (`withOptOutStartAt`), and
  // the select must not go on naming it (paycalc-1-10).
  document.getElementById('pensionOptOutFrom')?.addEventListener('change', () => {
    saveSettings();
    buildPensionFromSelect(getPensionTimeline());
    const p = _viewed();
    applyPensionOptOutUI(p);
    _repaint(p);
    _persist();
  });
}

/**
 * Put a payslip's own saved pension back after a write that replaced it (see `wirePensionControls`).
 * Only into a payslip that can be read, and only when it now holds something else.
 * @param {number} pNum @param {number} pension
 */
function keepSavedPension(pNum, pension) {
  const { data } = readSavedPeriod(pNum);
  if (!data || typeof data !== 'object' || data.pension === pension) return;
  if (!lsSetVerified(periodKey(pNum), JSON.stringify({ ...data, pension }))) console.warn('[paycalc] a payslip\'s own pension could not be put back — period ' + pNum);
}

/** Full-period pension default for the current grade, period-aware.
 *  Pass a period object to get the correct rate for that payday (handles cut-overs).
 *
 *  THE OPT-OUT IS APPLIED HERE, and here only. Four sites ask what a payslip's pension is when the
 *  member has not typed one — the field default and calculate()'s fallback (via
 *  `periodDefaultPension`), the HPP non-premium estimate (paycalc-hpp.js) and the year summary
 *  (paycalc-year-summary.js) — and answering it in one function is what makes the four agree.
 *
 *  It changes the DEFAULT, never a stored figure, and only from the payslip the member named onwards.
 */
/** @param {any} [pObj] */
export function getPensionDefault(pObj) {
  if (isPensionOptedOut(pObj)) return 0;
  // Both grades share PENSION_STEPS, so any grade the payslip was worked under gives the same figure.
  const g = pObj ? gradeDaysFor(pObj).find(x => x.grade)?.grade : getGradeSetting().grade;
  const grade = g && GRADES[g] ? g : 'cea';
  if (pObj?.payday) return getPensionForPeriod(grade, pObj.payday);
  return GRADES[grade]?.pension ?? '';
}

// ── PER-TAX-YEAR RATE ─────────────────────────────────────────────────────────
// Derived, never stored (invariant 8): the year's settled award rate, else the grade default. A
// legacy `rate`/`rates` key left on a device is never read.
/**
 * The settled (post-award) hourly rate a GRADE is paid in a tax year (pure — no DOM): AWARD_RATES'
 * figure for the year, else the grade default. The rate is FIXED BY GRADE and never stored
 * (invariant 8). The mid-year pre/post-rise step is applied per period by getRateForPeriod.
 * @param {string} grade - 'cea' | 'ces'
 * @param {any} ty
 * @returns {number}
 */
export function settledRate(grade, ty) {
  const award = awardRatesFor(grade, ty.label);
  return (award && award.rate != null ? award.rate : 0)
      || (GRADES[grade] ? GRADES[grade].rate : GRADES.cea.rate);
}

/**
 * A PAYSLIP's settled rate: each grade it was worked under at its settled rate for the year,
 * weighted by its days (paycalc-grade.js → byDays). Use it wherever every period of a year is priced
 * at the settled rate — the Holiday Pay Premium estimate, which does that on purpose (paycalc.md).
 * null for a payslip with a day under a role that has no rates — never CEA's rate in its place
 * (invariant 13): the caller leaves that payslip out.
 * @param {any} p
 * @param {any} [ty] - p's tax year (derived when omitted)
 * @returns {number|null}
 */
export function settledRateFor(p, ty = taxYearForPeriod(p)) {
  return byDays(gradeDaysFor(p), g => settledRate(g, ty));
}

/**
 * The grade an award's backdated months were worked under (paycalc-grade.js → windowGrade). The card
 * prices ONE grade's old and new rates, and it must be the grade of the months the award covers, not
 * the grade of the payslip on screen: a member promoted after an award was paid is owed that award at
 * the grade they held while they earned it. The window is the payslips calcBackPay accrues — the
 * award year's, from its April one, before the payslip that carried the award, up to today. With no
 * such payslip yet, the payslip on screen decides; with nobody to ask, CEA (gradeDaysFor).
 *
 * A window that SPANS a change of grade is priced at the grade held at its end, and logged: no
 * member's dates produce one today, and paycalc-grade-wiring.test.mjs fails the commit that would.
 * null when neither the window nor the payslip on screen was worked under a grade with rates — a
 * manager's award is not this calculator's to price, so the card refuses (invariant 13).
 * @param {any} awardTy
 * @returns {string|null} 'cea' | 'ces' | null
 */
export function awardGrade(awardTy) {
  if (awardTy) {
    // The window calcBackPay accrues (awardWindow), capped at today's payslip.
    const parts = awardWindow(getPeriods(), awardTy, { capNum: todaysPeriodNum() })
      .flatMap(/** @param {any} p */ p => gradeDaysFor(p));
    const { grade, mixed } = windowGrade(parts);
    if (mixed) console.warn('[PayCalc] back pay: the ' + awardTy.label + ' award window spans a change of grade — priced at the later one');
    if (grade) return grade;
  }
  const onScreen = periodByNum(currentPeriodNum() || todaysPeriodNum());
  return gradeDaysFor(onScreen).find(x => x.grade)?.grade ?? null;
}

/**
 * The hourly rate a payslip was PAID at, and whether that is the rate before its tax year's pay
 * award: a payslip paid before the award's mid-year date was paid the earlier rate (2025/26 payslips
 * before 24 Oct 2025 at £20.06, not the settled £20.74), every other one the year's settled rate.
 * ONE answer for the rate field, the Settings card's collapsed summary and calculate(), so a summary
 * can never quote the new rate over a payslip priced at the old one.
 *
 * A payslip worked under two grades is each grade's rate weighted by its days, UNROUNDED: 7 days
 * as a CEA and 21 as a CES in 2026/27 is £22.3225, so 140 contracted hours come to the £3,125.15
 * that 35 hours at £21.49 and 105 at £22.60 do (paycalc-grade.js). The field shows it to the penny;
 * calculate() uses this figure, never the field's rounding. A payslip with a day under a role that
 * has no rates has NO rate (null) — never CEA's in its place (invariant 13).
 * @param {any} ty - the period's tax year
 * @param {any} [p] - the period (omitted → the settled rate of a chosen grade, else CEA's)
 * @returns {{ rate: number|null, preAward: boolean }}
 */
export function periodRate(ty, p) {
  if (!p) {
    const g = getGradeSetting().grade;
    return { rate: settledRate(GRADES[g] ? g : 'cea', ty), preAward: false };
  }
  const parts = gradeDaysFor(p);
  const rate  = byDays(parts, g => getRateForPeriod(p, g, ty.label, settledRate(g, ty)));
  const preAward = rate != null && parts.some(x => !!x.grade && isPreAwardPeriod(p, x.grade, ty.label));
  return { rate, preAward };
}

/**
 * The Settings card's collapsed summary for a payslip: "✓ 2026/27 — £21.49/hr", with "· pre-rise" on
 * a payslip paid before its year's award — or, for a payslip that cannot be priced, no rate at all.
 * ONE writer for the coordinator's summary and confirmSettings', so the two cannot disagree.
 * @param {any} ty @param {any} [p] @returns {string}
 */
export function settingsSummary(ty, p) {
  const { rate, preAward } = periodRate(ty, p);
  return rate == null ? `✓ ${ty.label} — no rate for this payslip`
    : `✓ ${ty.label} — £${rate.toFixed(2)}/hr${preAward ? ' · pre-rise' : ''}`;
}

/**
 * Load the rate for the given period into the hourly rate field — `periodRate`'s answer, to the
 * penny, with its label and the plain-English line under it. The field is display: calculate() asks
 * `periodRate` itself, so a payslip spanning a change of grade is priced at the unrounded blend.
 * @param {any} ty  - the period's tax year
 * @param {any} [p] - the period (enables the mid-year step; omitted → settled rate only)
 */
export function updateRateForPeriod(ty, p) {
  const { rate, preAward } = periodRate(ty, p);
  const parts    = p ? gradeDaysFor(p) : [];
  const field    = /** @type {HTMLInputElement} */ (document.getElementById('hourlyRate'));
  field.value = rate == null ? '–' : rate.toFixed(2);
  // The rate is FIXED BY GRADE — ALWAYS read-only; the member never types it.
  field.readOnly = true;
  // A payslip before the year's pay rise, for a grade whose earlier rate is not on record (CES
  // 2025/26): priced at the later rate, the only figure there is, and never labelled "current rate"
  // as though that were what it paid (invariant 1).
  const from      = awardFromForYear(ty.label);
  const preUnknown = !preAward && !!p && !!from && p.payday < from
    && parts.some(x => !!x.grade && awardRatesFor(x.grade, ty.label)?.pre == null);
  const lbl = document.getElementById('rateYearLabel');
  if (lbl) lbl.textContent = `${ty.label} · ${rate == null ? 'no rate' : preAward ? 'pre-rise rate' : preUnknown ? 'post-rise rate' : 'current rate'}`;
  // Spell out the pre/post-rise position plainly under the field (owner: make pre vs post clear),
  // and, on a payslip that spans a change of grade, the two rates and the days behind the blend.
  const note = document.getElementById('rateStepNote');
  if (note) {
    const step = preAward && from
      ? `This payslip was paid before the ${fdShort(from)} pay rise — later payslips switch to the new rate automatically.`
      : preUnknown && from
        ? `This payslip was paid before the ${fdShort(from)} pay rise, and the rate before it isn't on record for your grade — so this estimate uses the later rate, and your payslip will show less basic pay.`
        : '';
    const split = p
      ? gradeSplitLine({ parts, rateOf: g => getRateForPeriod(p, g, ty.label, settledRate(g, ty)), start: p.start, today: new Date() })
      : '';
    note.textContent = rate == null ? unpricedLineFor(p) : [step, split].filter(Boolean).join(' ');
    note.style.display = note.textContent ? '' : 'none';
  }
}

/** Load the stored Year to Date figures for this tax year into the Year to Date Figures card. */
/** @param {any} ty */
export function updateYtdForTaxYear(ty) {
  const payEl = /** @type {HTMLInputElement} */ (document.getElementById('ytdPay'));
  const taxEl = /** @type {HTMLInputElement} */ (document.getElementById('ytdTax'));
  if (!payEl || !taxEl) return;
  if (document.activeElement !== payEl) payEl.value = lsGet(ytdPayKey(ty)) || '';
  if (document.activeElement !== taxEl) taxEl.value = lsGet(ytdTaxKey(ty)) || '';
}

// ── SETTINGS SAVE / LOAD ──────────────────────────────────────────────────────

/** Per-tax-year localStorage key for the "confirmed" flag. */
/** @param {any} ty */
export function settingsKey(ty) { return `${pcPrefix()}setup_${ty.label.replace('/', '_')}`; }

/** The card's line while a settings write has not read back. One sentence, shared by the autosave and Save. */
export const SETTINGS_NOT_SAVED = '⚠ Not saved — this device didn\u2019t keep your settings. Try again.';

/**
 * Show or withdraw the not-saved line. Withdraws only its OWN line, never Save's confirmation.
 * @param {boolean} ok
 */
function reportSettingsWrite(ok) {
  const fb = document.getElementById('settingsSaveFeedback');
  if (!fb) return;
  if (!ok) setStatus(fb, SETTINGS_NOT_SAVED);
  else if (fb.textContent === SETTINGS_NOT_SAVED) fb.textContent = '';
}

/** Persist all field values. Called on every input change (auto-save).
 *  Does NOT set the confirmed flag or collapse the card — that's confirmSettings().
 *  Every write is read back (`lsSetVerified`): a setting the device did not keep says so on the card,
 *  never silently, and Save does not report "saved" over it.
 *  @returns {boolean} true only when every write read back */
export function saveSettings() {
  let ok = true;
  /** @param {string} k @param {string} v */
  const put = (k, v) => { ok = lsSetVerified(k, v) && ok; };
  const pNum    = currentPeriodNum();
  const curP    = periodByNum(pNum);
  const curTy   = taxYearForPeriod(curP);
  // Save the grade setting FIRST — every helper below that prices a payslip (periodRate,
  // getPensionDefault) must read the NEW setting. paycalc-grade-setting.js.
  ok = saveGradeSetting(pNum) && ok;
  // The hourly rate is never persisted: it is derived by grade (invariant 8).
  put(SK.code,      /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value);
  put(SK.sl,        /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value);
  put(SK.pgLoan,    /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked ? '1' : '');
  // Loan-repaid cutover: the p.num of the first payslip with no deduction, '' = still repaying. The
  // select may not exist in old cached HTML. A select with NOTHING chosen never overwrites the
  // record ('' is "No — still deducted" only when that option is chosen) — paycalc-3-8.
  const _slPaidOffEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('slPaidOffFrom'));
  if (_slPaidOffEl && _slPaidOffEl.selectedIndex !== -1) put(SK.slPaidOff, _slPaidOffEl.value);
  // Out of the scheme. getPensionDefault() reads this timeline, so every repaint after this save —
  // the lock, the field's default, the estimate — sees the state the member just chose.
  //
  // A CHANGE DATED TO A PAYSLIP, not a global flag: the `from` select carries the payslip to act on
  // (with no select rendered — old cached HTML — the payslip being viewed).
  //
  // TICKED and UNTICKED are two different edits (invariant 12). Ticked MOVES the current spell's
  // start, so a LATER pick corrects it; unticked ENDS the spell at the payslip on screen — the
  // rejoin. Both are idempotent, as every keystroke in the pension field lands here.
  const _optOut = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionOptOutCheck'));
  if (_optOut) {
    const _fromEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('pensionOptOutFrom'));
    const _fromNum = parseInt(_fromEl?.value ?? '', 10);
    const _tl = getPensionTimeline();
    // A select that names no payslip leaves a spell already ON RECORD where it began — falling back to
    // the payslip on screen would MOVE it (paycalc-3-8). A first tick or a rejoin uses the payslip on screen.
    const _recorded = _optOut.checked ? optOutStartsAt(_tl) : null;
    const _from = Number.isFinite(_fromNum) ? _fromNum : (_recorded ?? currentPeriodNum());
    ok = savePensionTimeline(_optOut.checked ? withOptOutStartAt(_tl, _from) : withRejoinAt(_tl, _from)) && ok;
  }
  // No member-level pension is stored (paycalc-3-15): each payslip keeps its own figure through the
  // form round trip, and a payslip with none takes its period default.
  put(ytdPayKey(curTy), /** @type {HTMLInputElement} */ (document.getElementById('ytdPay')).value);
  put(ytdTaxKey(curTy), /** @type {HTMLInputElement} */ (document.getElementById('ytdTax')).value);
  reportSettingsWrite(ok);
  return ok;
}

/**
 * Called by the Save button. Saves, marks this tax year as confirmed,
 * updates the card header hint, collapses the card.
 * @param {Function} calculate - Coordinator's calculate() callback.
 */
export function confirmSettings(calculate) {
  const fb = document.getElementById('settingsSaveFeedback');
  // Nothing is marked confirmed, and the card stays open, over settings the device did not keep.
  if (!saveSettings()) { if (fb) setStatus(fb, SETTINGS_NOT_SAVED); calculate(); return; }
  const pNum  = currentPeriodNum();
  const curP  = periodByNum(pNum);
  const curTy = taxYearForPeriod(curP);
  // If this period already has saved hours, patch its pension value in-place.
  const existingRaw = lsGet(periodKey(pNum));
  /** Did the in-place pension patch below fail on damaged storage? Drives the partial-success
   *  message at the end — see the catch for why a bare console.warn was not enough. */
  let _pensionPatchFailed = false;
  /** Did the patch's write itself not read back (storage refused it — the payslip is not damaged)? */
  let _pensionPatchNotKept = false;
  if (existingRaw) {
    try {
      // `parseSavedPeriod`, the Pay screen's own reader — never a bare JSON.parse. A list is valid JSON:
      // `.pension` set on it vanished in JSON.stringify, the same bytes went back, and Save said
      // "Settings saved" over a payslip it had not touched. A wrong shape is DAMAGED, and handled below.
      const { data: d, error } = parseSavedPeriod(existingRaw);
      if (error) throw new Error('not a saved period');
      // Blank field → null (loadPeriodData re-applies the period default), NOT 0, which would persist
      // a permanent £0 pension. A typed "0" is a genuine opt-out and is kept.
      // Out of the scheme → the payslip's pension is LEFT AS IT IS, never an explicit 0: nothing saved
      // already means 0 for an opted-out member, and keeps healing after a rejoin; a figure the member
      // DID type stays dormant behind the lock (readFormData says why).
      // `pensionToStore` — the autosave's own rule, not a second copy (a private `parseFloat(raw) || 0`
      // froze the payslip onto the default and read a pasted "£151.86" as £0).
      const _pRaw = /** @type {HTMLInputElement} */ (document.getElementById('pensionAmt')).value;
      if (!isPensionOptedOut(curP)) d.pension = pensionToStore(_pRaw, curP ? periodDefaultPension(curP) : null);
      if (!lsSetVerified(periodKey(pNum), JSON.stringify(d))) _pensionPatchNotKept = true;
    } catch (err) {
      // A corrupt saved period must not break Save — nor be reported as a success. The warning below
      // does NOT reach the Operations Error Log (`error-reporter.js` hooks `error` and
      // `unhandledrejection`, not `console.warn`), so the member is told: a PARTIAL SUCCESS, as
      // `readSavedPeriod`'s `{data, error}` lets back-pay and HPP say a period is corrupt.
      _pensionPatchFailed = true;
      console.warn('[paycalc] pension patch skipped — period ' + pNum + ' is unreadable:', /** @type {any} */ (err)?.message);
    }
  }
  // The marks that say this year is confirmed: if they did not keep, the card asks again next time —
  // so say so now rather than "saved".
  if (!(lsSetVerified(settingsKey(curTy), '1') && lsSetVerified(SK.setup, '1'))) {
    if (fb) setStatus(fb, SETTINGS_NOT_SAVED);
    calculate();
    return;
  }
  document.getElementById('setupBanner')?.classList.add('hidden');
  document.getElementById('settingsNewYearNotice')?.classList.add('hidden');
  // Header hint: periodRate's answer, period-aware, as the rate field and calculate() read it.
  const hintEl = document.getElementById('settingsHint');
  // No tax code here — one line at 390px.
  if (hintEl) setStatus(hintEl, settingsSummary(curTy, curP));
  // Brief "saved" confirmation then collapse — UNLESS the pension patch failed: that line asks the
  // member to act, so it STAYS and the card stays open.
  if (_pensionPatchNotKept) {
    if (fb) setStatus(fb, '⚠ Settings saved, but this payslip\u2019s pension figure couldn\u2019t be updated on this device. Try Save again.');
    calculate();
    return;
  }
  if (_pensionPatchFailed) {
    if (fb) setStatus(fb, '⚠ Settings saved, but this payslip\u2019s saved data is damaged and kept its old pension figure — clear and re-enter this period\u2019s hours.');
    calculate();
    return;
  }
  if (fb) setStatus(fb, '✓ Settings saved');
  setTimeout(() => {
    if (fb) fb.textContent = '';
    setSettingsCardOpen(false);
  }, 2500);
  calculate();
}

/** Programmatic open/close for the Settings card — keeps aria-expanded in
 *  sync with the classes that initCardCollapse manages on user toggles. */
/** @param {any} open */
export function setSettingsCardOpen(open) {
  const toggle = document.getElementById('settingsToggle');
  const body   = document.getElementById('settingsBody');
  // aria-expanded lives on the collapse CONTROL (the arrow), not the header, which is not a button.
  const ctrl = toggle?.querySelector('.card-toggle-arrow') || toggle;
  // A shut body is out of the Tab order (paycalc.css → `.collapsible-body`), so closing would strand
  // a keyboard member's focus: hand it to the arrow that reopens the card, without scrolling.
  if (!open && body?.contains?.(document.activeElement)) /** @type {HTMLElement|null} */ (ctrl)?.focus?.({ preventScroll: true });
  if (toggle) toggle.classList.toggle('open', open);
  if (body)   body.classList.toggle('open', open);
  if (ctrl) ctrl.setAttribute('aria-expanded', String(open));
}

/** The tax years whose Settings card has already been opened for the member this page load, so a
 *  year not yet checked opens it ONCE, not on every payslip of the year. A reload starts it afresh. */
const _settingsPrompted = new Set();
/** The Settings header's hint as the markup writes it, put back over a tax year not yet checked.
 *  @type {string|null} */
let _settingsHintDefault = null;

/**
 * Paint what the Settings card and the setup banner say for the payslip on screen — run by
 * onPeriodChange on every change of payslip. The "checked" mark is `settingsKey`'s, one per tax
 * year, set by confirmSettings.
 *
 * - A year the member has CHECKED: the setup banner goes, and the header hint is the rate THIS
 *   payslip was paid at (`settingsSummary` — "pre-rise" where it was), never the year's settled rate
 *   over a payslip priced at the old one.
 * - A year NOT yet checked: the hint goes back to the markup's own (read before the first write), so
 *   another year's "✓ … £/hr" never stays over it, and the setup banner says what is true. A
 *   RETURNING member (`SK.setup`) also gets the card opened, once per load per year, with the "New
 *   tax year" notice; a new member already sees it open (loadSettings). Never for a year that is over.
 * - The "New tax year" notice names ONE year, so it goes when another is on screen, or Save would
 *   check the wrong year.
 * @param {any} ty  the payslip's tax year
 * @param {any} p   the payslip on screen
 */
export function paintSettingsForYear(ty, p) {
  const tyConfirmed = lsGet(settingsKey(ty));
  // Always keep the title current so the hardcoded HTML default never shows stale text.
  /** @type {HTMLElement} */ (document.getElementById('setupBannerTitle')).textContent = `👋 Estimate your take-home for ${ty.label}`;
  const hintEl = /** @type {HTMLElement} */ (document.getElementById('settingsHint'));
  _settingsHintDefault ??= hintEl.textContent ?? '';
  const yearNotice = document.getElementById('settingsNewYearNotice');
  if (yearNotice && yearNotice.dataset.ty !== ty.label) yearNotice.classList.add('hidden');
  if (tyConfirmed) {
    /** @type {HTMLElement} */ (document.getElementById('setupBanner')).classList.add('hidden');
    setStatus(hintEl, settingsSummary(ty, p));   // no tax code: it wrapped at 390px
    return;
  }
  hintEl.textContent = _settingsHintDefault;
  // What is TRUE: the tax code and student loan are single settings for every payslip; pension is
  // kept per payslip; the grade follows the roster by date unless the member chose one
  // (paycalc-grade-setting.js). Only the "checked" mark is per tax year.
  /** @type {HTMLElement} */ (document.getElementById('setupBannerBody')).innerHTML =
    `We've filled in the usual defaults — <strong>check your grade and tax code</strong> in <a href="#settingsCard" class="setup-settings-link">⚙️ Your Settings</a>, then select <strong>Save settings</strong>. You can add your hours with <strong>Fill from calendar</strong>. Your tax code and student loan apply to every payslip, your pension is kept per payslip, and your grade follows the roster by date unless you choose one — you'll be asked to check them again when a new tax year starts.`;
  /** @type {HTMLElement} */ (document.getElementById('setupBanner')).classList.remove('hidden');
  if (_settingsPrompted.has(ty.label) || 48 + ty.last < todaysPeriodNum()) return;
  _settingsPrompted.add(ty.label);
  if (!lsGet(SK.setup)) return;
  setSettingsCardOpen(true);
  if (yearNotice) {
    yearNotice.dataset.ty = ty.label;
    yearNotice.textContent = ty.rateUnconfirmed
      ? `New tax year ${ty.label} — a pay award has been accepted but isn't on payslips yet. Your rate stays on last year's until the award lands on a payslip, then it updates automatically. Check your tax code, then select Save settings.`
      : `New tax year ${ty.label} — your hourly rate updates automatically. Check your tax code and pension, then select Save settings.`;
    yearNotice.classList.remove('hidden');
  }
}

/**
 * WHERE THE SETTINGS CARD SITS, AND THE WAY TO IT.
 *
 * ITS PLACE. On a phone the card leads the work column, in the DOM. On a desktop the decided order
 * is the period band, Hours, then Settings (paycalc.md → Layout decisions), and CSS `order` moves
 * the PAINT, not the FOCUS (WCAG 2.4.3) — so from 1024px the card itself moves after Hours, and back
 * in front of the period band below it. paycalc.css keeps the `order` rules, which agree with the DOM.
 *
 * THE WAY TO IT. The setup banner's "⚙️ Your Settings" is a link (`#settingsCard`), ~1,450px above
 * the card on a desktop. It goes the road the banner's Restore link does (paycalc-transfer-card.js):
 * the deep link's open-and-keep-in-view, then focus on the grade. `openCardNamedByHash` is INJECTED:
 * overlay.js touches `window` at import, and this module is unit-tested in Node.
 * @param {{ openCardNamedByHash: (cardId: string, bodyId: string, toggleId: string) => boolean }} deps
 */
export function wireSettingsCard({ openCardNamedByHash }) {
  const card  = document.getElementById('settingsCard');
  const hours = document.getElementById('hoursCard');
  const band  = document.querySelector('.period-controls');
  const wide  = window.matchMedia?.('(min-width: 1024px)');
  if (card && hours && band && wide) {
    const place = () => {
      const focused = document.activeElement;
      if (wide.matches) { if (hours.nextElementSibling !== card) hours.after(card); }
      else if (band.previousElementSibling !== card) band.before(card);
      // Moving a node takes its focus with it; a member part-way through the card keeps their place.
      if (focused instanceof HTMLElement && card.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
    };
    place();
    wide.addEventListener('change', place);
  }
  openCardNamedByHash('settingsCard', 'settingsBody', 'settingsToggle');   // a no-op without the fragment
  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('a[href="#settingsCard"]')) return;
    e.preventDefault();
    history.replaceState(history.state, '', '#settingsCard');   // no Back step, no hashchange
    openCardNamedByHash('settingsCard', 'settingsBody', 'settingsToggle');
    (document.getElementById('gradeSelectTrigger') ?? document.getElementById('gradeSelect'))?.focus({ preventScroll: true });
  });
}

/** Load persisted settings into the form fields. */
export function loadSettings() {
  // The rate is set per period by updateRateForPeriod() (onPeriodChange).
  const code    = lsGet(SK.code);
  let   sl      = lsGet(SK.sl);
  let   pgLoan  = lsGet(SK.pgLoan);
  const done    = lsGet(SK.setup);
  if (code)    /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value     = code.toUpperCase();
  // Migration: a saved 'postgrad' plan becomes plan 'none' + the separate Postgraduate Loan flag,
  // re-persisted ONCE so it never re-migrates.
  if (sl === 'postgrad') { sl = 'none'; pgLoan = '1'; lsSet(SK.sl, 'none'); lsSet(SK.pgLoan, '1'); }
  if (sl)      /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value = sl;
  /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked = pgLoan === '1';
  // Loan-repaid cutover. A saved payslip the options no longer reach is offered first: assigning a
  // value no option carries selects NOTHING (selectedIndex −1, value '' — Chromium and WebKit), which
  // calculate() reads as "still deducted" (paycalc-3-8).
  const _slPaidOff   = lsGet(SK.slPaidOff);
  const _slPaidOffEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('slPaidOffFrom'));
  if (_slPaidOffEl && _slPaidOff) {
    offerRecordedPayslip(_slPaidOffEl, parseInt(_slPaidOff, 10));
    _slPaidOffEl.value = _slPaidOff;
  }
  // ── THE GRADE SETTING: converted once if it was saved before grades had dates, then painted — the
  // Grade box, its "from which payslip?", the roster's line, the grade prompt and the one-time note
  // (paycalc-grade-setting.js → loadGradeSetting).
  loadGradeSetting();
  // ── PENSION STATUS: migrate the retired boolean, then paint the controls ──────────────────────
  //
  // The retired flag carried no date. It becomes a change dated to the FIRST PAYSLIP OF 2026/27 (the
  // only year it can have been set in), which is safe in one direction: every payslip it moves goes
  // from a wrongly-imposed £0 back to the scheme default, never the reverse. Persisted at once so it
  // is correctable in the control below; the timeline key's EXISTENCE ends the migration, so an
  // emptied one stays empty. The YEAR IS NAMED, NOT TODAY'S (paycalc-3-16), or a device first running
  // this after a rollover would put a deduction back on every 2026/27 payslip out of the scheme.
  const _curP = periodByNum(todaysPeriodNum());
  if (lsGet(SK.pensionTimeline) === null && lsGet(SK.pensionOptOut) === '1') {
    const _firstOfYear = getPeriods().find(/** @param {any} x */ x => taxYearForPeriod(x)?.label === LEGACY_OPT_OUT_YEAR)?.num ?? null;
    savePensionTimeline(migrateLegacyOptOut(true, _firstOfYear));
  }
  const _tl = getPensionTimeline();
  // The TICK states today's position (in the scheme now?); the SELECT states when the current spell
  // began — two questions, which the timeline exists to keep apart.
  const _optOutEl = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionOptOutCheck'));
  if (_optOutEl) _optOutEl.checked = optOutStartsAt(_tl) !== null;
  buildPensionFromSelect(_tl);
  // Today's payslip's default, so the box is never left on the page's static text; the payslip on
  // screen paints its own figure a moment later (loadPeriodData).
  /** @type {HTMLInputElement} */ (document.getElementById('pensionAmt')).value =
    isPensionOptedOut(_curP) ? '0.00' : periodDefaultPension(_curP).toFixed(2);
  applyPensionOptOutUI(_curP);
  // Settings card starts closed in HTML. Open it only for first-time users.
  if (!done) {
    setSettingsCardOpen(true);
  } else {
    // One-time legacy migration: a member set up before per-tax-year confirmation has SK.setup but no
    // per-year flags — mark the tax years that exist NOW as confirmed.
    //
    // ONCE per member: a tax year ADDED LATER must NOT be swept up, so its "👋 New tax year" banner
    // appears the first time the member opens it (rates change every April). And only for a member who
    // IS legacy — `setup` with no per-year flag at all (paycalc-3-16), or years never set up are
    // marked confirmed.

    const migratedKey = `${pcPrefix()}setup_years_migrated`;
    if (!lsGet(migratedKey)) {
      if (!CONFIG.TAX_YEARS.some(ty => lsGet(settingsKey(ty)))) {
        CONFIG.TAX_YEARS.forEach(ty => lsSet(settingsKey(ty), '1'));
      }
      lsSet(migratedKey, '1');
    }
  }
}
