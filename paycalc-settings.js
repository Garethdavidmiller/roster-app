// @ts-check
/**
 * paycalc-settings.js — Grade/contracted-hours helpers and Settings save/load.
 *
 * Owns: grade cache, getContr/getLoggedMember/getEffectiveContr/getProRateFactor/
 *   getPensionDefault, updateRateForPeriod, updateYtdForTaxYear, settingsKey,
 *   saveSettings, confirmSettings, setSettingsCardOpen, loadSettings, and wireSettingsCard — the
 *   card's place in the desktop Tab order and the setup banner's link to it.
 * Does NOT own: period arithmetic (paycalc-periods.js), pay maths (paycalc-calc.js),
 *   roster hints (paycalc-roster-hint.js).
 * Edit here for: grade helpers, settings persistence, rate/YTD field updates.
 * Do not edit here for: pay maths, period date maths, roster pre-fill.
 */

import { GRADES, taxYearForPeriod, calcProRateFactor, getPensionForPeriod, getRateForPeriod, isPreAwardPeriod, awardRatesFor, awardFromForYear } from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, todaysPeriodNum, visiblePeriods, appendPayslipOptions } from './paycalc-periods.js';
import { SK, periodKey, ytdPayKey, ytdTaxKey, pcPrefix, readSavedPeriod } from './paycalc-migrations.js';
import { getSession } from './session.js';
import { teamMembers, gradeForRole } from './roster-data.js';
import { lsGet, lsSet } from './ls.js';
import { fdShort } from './paycalc-format.js';
import { setStatus } from './status-text.js';
import { pensionToStore } from './paycalc-form-data.js';
import {
  parsePensionTimeline, serialisePensionTimeline, isOptedOutAt,
  withOptOutStartAt, withRejoinAt, optOutStartsAt, migrateLegacyOptOut,
} from './paycalc-pension.js';

// ── GRADE CACHE ───────────────────────────────────────────────────────────────
// lsGet is called in calculate() / calcHPP() on every keystroke; the grade only
// changes when the user picks a different one in Settings.
/** @type {any} */
let _gradeCache = null;
/** Return the stored grade key (e.g. 'cea'). */
export function getGrade() {
  if (_gradeCache !== null) return _gradeCache;
  _gradeCache = lsGet(SK.grade) || '';
  return _gradeCache;
}
function invalidateGrade() { _gradeCache = null; }

/** Return contracted hours for the currently selected grade. */
export function getContr() {
  const g = getGrade();
  return (g && GRADES[g]) ? GRADES[g].contr : GRADES.cea.contr;
}

// `gradeForRole` — which pay grade a member's ROLE is, or null when this app has no confirmed
// rates for it (v21.78). It lives in roster-data.js since v24.86, where the Calendar's Year to Date
// notice can ask the same question without loading this module; re-exported so nothing here moves.
export { gradeForRole };

/** Return the teamMembers entry for the logged-in session user, or null. */
export function getLoggedMember() {
  const sess = getSession();
  if (!sess?.name) return null;
  return teamMembers.find(m => m.name === sess.name) || null;
}

/**
 * Return effective contracted hours for the given period, pro-rated if the
 * logged-in member started mid-period.
 * @param {any} p - Period object with .start and .cutoff Date properties.
 * @returns {number} Contracted hours (full or pro-rated).
 */
export function getEffectiveContr(p) {
  const base   = getContr();
  if (!p) return base;
  if (getLoggedMember()?.noProRate) return base;
  const factor = calcProRateFactor(getLoggedMember()?.startDate, p.start, p.cutoff);
  return factor === 1 ? base : Math.round(base * factor);
}

/** Returns the fraction of the period that the logged-in member was employed.
 *  Delegates to calcProRateFactor (paycalc-calc.js) — see that function for
 *  the formula invariant and why startDate must be midnight local time. */
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
export function getPensionTimeline() {
  return parsePensionTimeline(lsGet(SK.pensionTimeline));
}

/** @param {import('./paycalc-pension.js').PensionChange[]} timeline */
export function savePensionTimeline(timeline) {
  lsSet(SK.pensionTimeline, serialisePensionTimeline(timeline));
}

/**
 * Was this member OUT of the pension scheme ON THIS PAYSLIP (opted out / withdrawn from the RPS)?
 *
 * PERIOD-AWARE SINCE v21.78, and that is the whole point — see paycalc-pension.js. As a bare
 * boolean this made the pension default £0 for every payslip there has ever been, so a historical
 * payslip storing `null` (the round trip's self-heal, which is most of them) was rewritten
 * retroactively: reproduced at £160.78 → £0.00 on a 2025/26 payslip, £115.92 onto its take-home.
 *
 * No period in hand answers CONTRIBUTING, not "the latest state" — the answer that changes no
 * stored figure.
 *
 * @param {any} [pObj] @returns {boolean}
 */
export function isPensionOptedOut(pObj) {
  return isOptedOutAt(getPensionTimeline(), pObj?.num ?? null);
}

/** Reflect the out-of-scheme choice in the amount field: an amount nobody pays is not editable,
 *  and a field that stays live while reading £0.00 invites the member to "fix" it and wonder why it
 *  will not hold. Disabled rather than hidden — the figure is still the answer to "what came off my
 *  pay?", and hiding it would make the deduction unexplained rather than explained as nil.
 *
 *  Takes the VIEWED period (v21.78): the lock follows the timeline, so a payslip from before she
 *  left the scheme stays editable and keeps its real figure. Locking it everywhere was the visible
 *  half of the retroactive bug.
 *  @param {any} [pObj] */
export function applyPensionOptOutUI(pObj) {
  const out = isPensionOptedOut(pObj);
  const amt = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));
  if (amt) {
    amt.disabled = out;
    if (out) amt.value = '0.00';
  }
  document.getElementById('pensionAmt')?.closest('.pfx')?.classList.toggle('is-disabled', out);
}

/**
 * Make a "from which payslip?" select able to SHOW the payslip already on record (paycalc-3-8).
 *
 * The pension opt-out start and the student-loan stop each list the payslips the member can see
 * (`visiblePeriods()`), and setting a select to a value no option carries selects nothing. So a
 * recorded payslip the list no longer reaches — a start date added after the choice was made, or a
 * tax year dropped from the grid at a rollover — came up blank, `calculate()` read the blank loan
 * stop as "still deducted", and the next settings save wrote the blank back: erasing the loan stop
 * and MOVING the opt-out start to the payslip on screen. Nothing said so.
 *
 * So the recorded payslip is offered ahead of the rest, in its own tax-year group and worded as every
 * payslip list words one (`appendPayslipOptions`) — or, when the grid no longer generates it at all,
 * as a plain "An earlier payslip", which is all that is still known about it. The record is then
 * what the control shows, what `calculate()` reads and what a save writes back.
 * @param {HTMLSelectElement} sel
 * @param {number|null} num  the recorded payslip (internal `p.num`); nothing is added for none
 */
function offerRecordedPayslip(sel, num) {
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

/**
 * Build (and set) the "not in the scheme from which payslip?" control.
 *
 * The same shape as the student-loan cutover select directly below it — one option per visible
 * payslip, grouped by tax year, date first — because it answers the same kind of question and a
 * member should not have to learn two idioms for "name the first payslip where this changed".
 *
 * WHAT IT IS SET TO MATTERS. Re-opening Settings shows the payslip already ON RECORD, not today's:
 * defaulting a populated control back to the current payslip invites an accidental correction that
 * silently moves months of pension. Only a member who has never recorded a change gets today's
 * payslip, and for her the control is the question, not an answer to re-confirm.
 *
 * @param {import('./paycalc-pension.js').PensionChange[]} timeline
 */
export function buildPensionFromSelect(timeline) {
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('pensionOptOutFrom'));
  const field = document.getElementById('pensionOptOutField');
  if (!sel) return;
  sel.innerHTML = '';
  appendPayslipOptions(sel, visiblePeriods());
  // WHAT THE SELECT IS SET TO IS WHAT `saveSettings` ACTS ON, so it carries both answers (v21.80):
  // while the box is TICKED it names where the spell begins, and while it is UNTICKED it names the
  // payslip the member is looking at — which is how the hint beneath it has told her to record a
  // rejoin since v21.78 ("untick the box while viewing the first payslip that has a deduction
  // again"). Setting it to the spell's own start on an untick, as the first cut did, made every
  // untick erase the spell rather than end it.
  //
  // `currentPeriodNum()` READS THE PERIOD SELECT, which does not exist yet when loadSettings runs
  // at boot — it returns 0 there. Falling through to today's payslip keeps the control meaningful
  // on that first paint instead of leaving it on a value no option carries.
  const checked = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionOptOutCheck'))?.checked;
  const start   = checked ? optOutStartsAt(timeline) : null;
  offerRecordedPayslip(sel, start);
  sel.value = String(start ?? (currentPeriodNum() || todaysPeriodNum()));
  // Shown only while she is out of the scheme: it asks one question ("not in the scheme from which
  // payslip?") and that question has no answer once she is back in. A rejoin is dated by the
  // payslip on screen, not by this control, so leaving it up afterwards would put a label that is
  // no longer true in front of a value nothing reads.
  field?.classList.toggle('hidden', !checked);
}

/**
 * This period's DEFAULT pension as the £ number the field would show: the period-aware scheme
 * default (PENSION_STEPS via getPensionDefault) × the joining-period pro-rate, rounded to 2dp.
 * The ONE source for a comparison/write that was hand-rolled at six sites (v18.46 — sweep item 9).
 * No period → the bare current default.
 *
 * Lives here rather than in the coordinator (v21.78): both its inputs are in this module, and it
 * is a pay RULE, which is what the coordinator ratchet asks to be moved out rather than capped.
 * @param {any} [p] @returns {number}
 */
export function periodDefaultPension(p) {
  return p
    ? parseFloat((getPensionDefault(p) * getProRateFactor(p)).toFixed(2))
    : (parseFloat(String(getPensionDefault())) || 0);
}

/**
 * Wire the pension card's two controls — the "not in the scheme" tick and the payslip it starts
 * from (v21.78). Here rather than in the coordinator because everything they touch is here; the
 * coordinator injects only what it alone knows.
 *
 * ORDER MATTERS in the tick handler. The date control is BUILT before the save, so a first tick has
 * a payslip to date itself from (`saveSettings` reads that control, and an unbuilt one holds
 * nothing) — and, since v21.80, so that an UN-tick is dated to the payslip on screen rather than to
 * the spell's own start, which is what turned every rejoin into an erasure. (A second `saveSettings`
 * at the end, there to re-save a member-level pension default after the field was rebuilt — v21.77 —
 * went with that default, which nothing read: paycalc-3-15.)
 *
 * @param {{ autosave: () => void }} deps  the coordinator's persist-and-reprice — it owns what is saved
 *   (since Oct 2026, only the pension field, and only into a payslip that already has readable entries).
 */
export function wirePensionControls({ autosave }) {
  const _viewed = () => getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
  const _amt = () => /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));

  // THE PAYSLIP'S OWN FIGURE SURVIVES BOTH CONTROLS (paycalc-3-3). A payslip that stores a pension of
  // its own keeps it: an UNLOCKED field shows it, as loadPeriodData would — never the scheme default,
  // which is what replaced it when a member corrected the date while viewing an earlier payslip, or
  // ticked by mistake and unticked — and a LOCKED one leaves it dormant behind the lock's £0.00, which
  // every surface prices at £0 (as every other payslip in an opt-out spell already does).
  const _own = (/** @type {any} */ p) => (p ? readSavedPeriod(p.num).data?.pension : null) ?? null;
  const _repaint = (/** @type {any} */ p) => {
    const amt = _amt();
    if (!amt || amt.disabled) return;
    const own = _own(p);
    amt.value = own != null ? String(own) : periodDefaultPension(p).toFixed(2);
  };
  // `autosave` persists the field and re-prices; the only re-price this module can reach. A locked
  // field reads £0.00, which the round trip stores as "the default" — so the payslip's own figure is
  // put back straight after, to lie dormant rather than be lost.
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
    // Un-ticking must take the lock's £0.00 away: it is no longer anybody's figure, and leaving it
    // would persist as a real opt-out on the next save.
    _repaint(p);
    _persist();
  });

  // Moving the boundary re-prices both sides of it, so the field, the lock and the estimate are
  // all repainted — not merely recalculated. `saveSettings` MOVES the spell's start rather than
  // recording a second change at the new payslip: re-picking a later one would otherwise be
  // swallowed by the earlier change still standing in front of it, leaving the select reading one
  // payslip and every figure using another until the next reload quietly put it back.
  document.getElementById('pensionOptOutFrom')?.addEventListener('change', () => {
    saveSettings();
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
  lsSet(periodKey(pNum), JSON.stringify({ ...data, pension }));
}

/** Full-period pension default for the current grade, period-aware.
 *  Pass a period object to get the correct rate for that payday (handles cut-overs).
 *
 *  THE OPT-OUT IS APPLIED HERE, and here only (v21.64). Four sites ask what a payslip's pension
 *  should be when the member has not typed one — the field default and calculate()'s fallback (via
 *  `periodDefaultPension`, above), the HPP non-premium estimate (paycalc-hpp.js) and the
 *  year summary (paycalc-year-summary.js) — and before this they all answered "the scheme rate",
 *  because being in the scheme was assumed rather than asked. A member who has withdrawn had no way
 *  to say so: her £0 held on the payslip she typed it into and reverted to £147.36 on every other,
 *  which understated her take-home by the whole contribution and mis-stated her tax and NI with it
 *  (the sacrifice comes off gross before both). Answering it in this one function is what makes the
 *  four agree; answering it in four would be four chances to drift.
 *
 *  It changes the DEFAULT, never a stored figure — and since v21.78 it changes it only from the
 *  payslip the member named onwards. Every caller but two already passes a period, which is what
 *  let one edit here fix the field, the calculation, the HPP estimate and the year summary at once.
 */
/** @param {any} [pObj] */
export function getPensionDefault(pObj) {
  if (isPensionOptedOut(pObj)) return 0;
  const g = getGrade();
  const grade = g && GRADES[g] ? g : 'cea';
  if (pObj?.payday) return getPensionForPeriod(grade, pObj.payday);
  return GRADES[grade]?.pension ?? '';
}

// ── PER-TAX-YEAR RATE ─────────────────────────────────────────────────────────
// Derived, never stored (invariant 8): the year's settled award rate, else the grade default. A
// legacy `rate`/`rates` key left on a device is never read.
/**
 * The hourly rate for a tax year (pure — no DOM). Since v17.87 the rate is FIXED BY GRADE and no
 * longer user-stored, so this derives it purely from AWARD_RATES (the year's confirmed settled rate)
 * with the grade default as a fallback. Use it wherever a SPECIFIC tax year's rate is needed (e.g. the
 * prior-year HPP estimate); the mid-year pre/post-rise step is applied per period by getRateForPeriod.
 * @param {any} ty
 * @returns {number}
 */
export function getStoredRateForYear(ty) {
  // The hourly rate is FIXED BY GRADE + the confirmed award (v17.87) — it is no longer user-editable
  // or stored, so it derives purely from AWARD_RATES (the year's settled rate) with the grade default
  // as a fallback. This removes the whole stale-saved-rate failure class (a device could otherwise
  // hold last year's rate). The mid-year pre/post-rise step is applied per period by getRateForPeriod.
  const g = getGrade();
  const award = awardRatesFor(g, ty.label);
  return (award && award.rate != null ? award.rate : 0)
      || (g && GRADES[g] ? GRADES[g].rate : GRADES.cea.rate);
}

/**
 * The hourly rate a payslip was PAID at, and whether that is the rate before its tax year's pay
 * award: a payslip paid before the award's mid-year date was paid the earlier rate (2025/26 payslips
 * before 24 Oct 2025 at £20.06, not the settled £20.74), every other one the year's settled rate.
 * ONE answer for the rate field and the Settings card's collapsed summary, which used to work it out
 * separately — and a summary quoting the new rate over a payslip priced at the old one is the
 * contradiction a member reported ("why does July 3rd show the new rate at the top?").
 * @param {any} ty - the period's tax year
 * @param {any} [p] - the period (omitted → the settled rate)
 * @returns {{ rate: number, preAward: boolean }}
 */
export function periodRate(ty, p) {
  const grade    = getGrade();
  const settled  = getStoredRateForYear(ty);
  const preAward = !!p && isPreAwardPeriod(p, grade, ty.label);
  return { rate: preAward ? getRateForPeriod(p, grade, ty.label, settled) : settled, preAward };
}

/**
 * Load the rate for the given period into the hourly rate field — `periodRate`'s answer, so the
 * calculator matches the real payslip for historic periods. calculate() reads this field.
 * @param {any} ty  - the period's tax year
 * @param {any} [p] - the period (enables the mid-year step; omitted → settled rate only)
 */
export function updateRateForPeriod(ty, p) {
  const grade    = getGrade();
  const { rate, preAward } = periodRate(ty, p);
  const field    = /** @type {HTMLInputElement} */ (document.getElementById('hourlyRate'));
  field.value = rate.toFixed(2);
  // The rate is FIXED BY GRADE (v17.87) — ALWAYS read-only; the member never types it. A pre-rise
  // payslip shows that period's historic rate, a current/post-rise payslip the new rate.
  field.readOnly = true;
  // A payslip before the year's pay rise, for a grade whose rate BEFORE it is not on record (CES
  // 2025/26). It is priced at the later rate — the only figure there is — and must never be labelled
  // "current rate" as though that were what it paid (whole-app review, Oct 2026; invariant 1).
  const from      = awardFromForYear(ty.label);
  const preUnknown = !preAward && !!p && !!from && p.payday < from && awardRatesFor(grade, ty.label)?.pre == null;
  const lbl = document.getElementById('rateYearLabel');
  if (lbl) lbl.textContent = `${ty.label} · ${preAward ? 'pre-rise rate' : preUnknown ? 'post-rise rate' : 'current rate'}`;
  // Spell out the pre/post-rise position plainly under the field (owner: make pre vs post clear).
  const note = document.getElementById('rateStepNote');
  if (note) {
    note.textContent = preAward && from
      ? `This payslip predates the ${fdShort(from)} pay rise — later payslips switch to the new rate automatically.`
      : preUnknown && from
        ? `This payslip predates the ${fdShort(from)} pay rise, and the rate before it isn't on record for your grade — so this estimate uses the later rate, and your payslip will show less basic pay.`
        : '';
    note.style.display = note.textContent ? '' : 'none';
  }
}

/** Load the stored Year to Date figures for this tax year into the Year to Date Figures card.
 *  Called from onPeriodChange() so values reset correctly when switching between tax years. */
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

/** Persist all field values. Called on every input change (auto-save).
 *  Does NOT set the confirmed flag or collapse the card — that's confirmSettings(). */
export function saveSettings() {
  const pNum    = currentPeriodNum();
  const curP    = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
  const curTy   = taxYearForPeriod(curP);
  const _savedGrade   = /** @type {HTMLSelectElement} */ (document.getElementById('gradeSelect')).value;
  // Save grade and invalidate the cache FIRST — every getGrade()-backed helper below
  // (getStoredRateForYear, getPensionDefault) must read the NEW grade. (v17.40 review fix.)
  lsSet(SK.grade, _savedGrade);
  invalidateGrade();
  // NB: the hourly rate is NO LONGER persisted (v17.87) — it is fixed by grade and derived by
  // getStoredRateForYear/getRateForPeriod, so there is nothing to save and no stale rate can form.
  lsSet(SK.code,      /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value);
  lsSet(SK.sl,        /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value);
  lsSet(SK.pgLoan,    /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked ? '1' : '');
  // Loan-repaid cutover (v18.41): the p.num of the first payslip with no deduction, '' = still
  // repaying. The select may not exist in old cached HTML — guard rather than throw. A select with
  // NOTHING chosen states nothing, so it never overwrites the record ('' is "No — still deducted"
  // only when that option is the one chosen) — paycalc-3-8.
  const _slPaidOffEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('slPaidOffFrom'));
  if (_slPaidOffEl && _slPaidOffEl.selectedIndex !== -1) lsSet(SK.slPaidOff, _slPaidOffEl.value);
  // Out of the scheme — saved BEFORE the amount below, because getPensionDefault() reads it and
  // the amount's own fallback must see the state the member just chose.
  //
  // A CHANGE DATED TO A PAYSLIP, not a global flag (v21.78): the `from` select carries the payslip
  // to act on. With no select rendered — old cached HTML — that is the payslip being viewed, which
  // is the reading the control defaults to anyway.
  //
  // TICKED and UNTICKED are two different edits, not one boolean written twice (v21.80). Ticked
  // MOVES the current spell's start, so re-picking a LATER payslip corrects it instead of being
  // swallowed by the earlier change still standing in front of it. Unticked ENDS the spell at the
  // payslip on screen — the rejoin. Both are idempotent, which they have to be: every keystroke in
  // the pension field lands here, and a re-statement of the state already recorded must add
  // nothing.
  const _optOut = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionOptOutCheck'));
  if (_optOut) {
    const _fromEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('pensionOptOutFrom'));
    const _fromNum = parseInt(_fromEl?.value ?? '', 10);
    const _tl = getPensionTimeline();
    // A select that names no payslip leaves a spell already ON RECORD where it began: falling back
    // to the payslip on screen MOVED it there, and gave every payslip in between its deduction back
    // (paycalc-3-8). With no spell yet — a first tick — or for a rejoin, the payslip on screen is
    // what the control means anyway.
    const _recorded = _optOut.checked ? optOutStartsAt(_tl) : null;
    const _from = Number.isFinite(_fromNum) ? _fromNum : (_recorded ?? currentPeriodNum());
    savePensionTimeline(_optOut.checked ? withOptOutStartAt(_tl, _from) : withRejoinAt(_tl, _from));
  }
  // No member-level pension is stored (paycalc-3-15): each payslip keeps its own figure through the
  // form round trip, and a payslip with none takes its period default. The `SK.pension` this wrote on
  // every keystroke was read only into a field loadPeriodData repaints in the same init.
  lsSet(ytdPayKey(curTy), /** @type {HTMLInputElement} */ (document.getElementById('ytdPay')).value);
  lsSet(ytdTaxKey(curTy), /** @type {HTMLInputElement} */ (document.getElementById('ytdTax')).value);
}

/**
 * Called by the Save button. Saves, marks this tax year as confirmed,
 * updates the card header hint, collapses the card.
 * @param {Function} calculate - Coordinator's calculate() callback.
 */
export function confirmSettings(calculate) {
  saveSettings();
  const pNum  = currentPeriodNum();
  const curP  = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
  const curTy = taxYearForPeriod(curP);
  // If this period already has saved hours, patch its pension value in-place.
  const existingRaw = lsGet(periodKey(pNum));
  /** Did the in-place pension patch below fail on damaged storage? Drives the partial-success
   *  message at the end — see the catch for why a bare console.warn was not enough. */
  let _pensionPatchFailed = false;
  if (existingRaw) {
    try {
      const d = JSON.parse(existingRaw);
      // Blank field → null (loadPeriodData re-applies the period default), NOT 0. Coercing blank to
      // 0 here persisted a permanent £0 pension for the period — the same overstatement the
      // readFormData/calculate null convention closes. A typed "0" is a genuine opt-out and is kept.
      // Out of the scheme → null, NOT an explicit 0. Null means "use the period default", which
      // for an opted-out member already IS 0 — and it keeps healing, so if she ever rejoins, the
      // periods she never typed a figure into follow the scheme again instead of being frozen at
      // a £0 nobody can see the reason for. Mirrors readFormData's self-heal for the same reason.
      // `pensionToStore` — the autosave's own rule, not a second copy of it. A private
      // `parseFloat(raw) || 0` here stored the period default as a number (freezing the payslip onto
      // it, so the next pension step never reached it) and read a pasted "£151.86" as £0.
      const _pRaw = /** @type {HTMLInputElement} */ (document.getElementById('pensionAmt')).value;
      d.pension = isPensionOptedOut(curP) ? null : pensionToStore(_pRaw, curP ? periodDefaultPension(curP) : null);
      lsSet(periodKey(pNum), JSON.stringify(d));
    } catch (err) {
      // A corrupt saved period must not break Save — but it must not be reported as a success
      // either (v22.45, external review). This catch existed to survive `JSON.parse` on damaged
      // storage and swallowed it in silence; v22.44 added a warning and claimed it reached the
      // Operations Error Log. **It does not**: `error-reporter.js` hooks `error` and
      // `unhandledrejection`, and nothing in the app intercepts `console.warn`. So the warning was
      // a developer aid described as a diagnostic trail, and the member still read "✓ Settings
      // saved" over a period that had kept its old pension figure.
      //
      // The honest answer is a PARTIAL SUCCESS, which is what the rest of the app does with this
      // shape — `readSavedPeriod` returns `{data, error}` so back-pay and HPP can SAY a period is
      // corrupt rather than dropping it; the save receipt names the days it could not change. The
      // settings themselves DID save, so this is not a failure; one consequence the member
      // reasonably expected did not happen, so it is not a success either.
      _pensionPatchFailed = true;
      console.warn('[paycalc] pension patch skipped — period ' + pNum + ' is unreadable:', /** @type {any} */ (err)?.message);
    }
  }
  lsSet(settingsKey(curTy), '1');
  lsSet(SK.setup, '1');
  document.getElementById('setupBanner')?.classList.add('hidden');
  document.getElementById('settingsNewYearNotice')?.classList.add('hidden');
  // Update header hint. Period-aware like the coordinator's hint writer (review parity fix): on a
  // pre-award payslip the field shows the pre-rise rate, so the hint must carry the same qualifier —
  // otherwise a Save briefly implied the pre-rise figure was the year's settled rate.
  const _cfGrade = getGrade();
  const rate = (parseFloat(/** @type {HTMLInputElement} */ (document.getElementById('hourlyRate')).value)
    || (GRADES[_cfGrade]?.rate ?? GRADES.cea.rate)).toFixed(2);
  const hintEl = document.getElementById('settingsHint');
  const _cfPre = !!curP && isPreAwardPeriod(curP, _cfGrade, curTy.label);
  // No tax code here — matches the coordinator's summary writer (one line at 390px; v17.95).
  if (hintEl) setStatus(hintEl, `✓ ${curTy.label} — £${rate}/hr${_cfPre ? ' · pre-rise' : ''}`);
  // Brief "saved" confirmation then collapse — UNLESS one consequence of the save could not be
  // applied, in which case the line STAYS and the card stays open. A partial-success message that
  // clears itself after 2.5 seconds and folds the card away is a message nobody reads, and this one
  // asks the member to go and do something.
  const fb = document.getElementById('settingsSaveFeedback');
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
  // aria-expanded lives on the collapse CONTROL (the arrow), not the header — the header is no
  // longer role="button" (v17.50), so aria-expanded on it is invalid ARIA. Mirror initCardCollapse.
  const ctrl = toggle?.querySelector('.card-toggle-arrow') || toggle;
  // A shut body is out of the Tab order (paycalc.css → `.collapsible-body`), so the save's own
  // close, 2.5s after "Save settings", would strand a keyboard member's focus on a control that is
  // about to vanish. Hand it to the arrow that reopens the card — the disclosure pattern — without
  // scrolling the page out from under them.
  if (!open && body?.contains?.(document.activeElement)) /** @type {HTMLElement|null} */ (ctrl)?.focus?.({ preventScroll: true });
  if (toggle) toggle.classList.toggle('open', open);
  if (body)   body.classList.toggle('open', open);
  if (ctrl) ctrl.setAttribute('aria-expanded', String(open));
}

/**
 * WHERE THE SETTINGS CARD SITS, AND THE WAY TO IT (desktop audit, 7 Nov 2026). Wiring, both halves.
 *
 * ITS PLACE. On a phone the card leads the work column, in the DOM, which is how a first-time
 * member meets it first. On a desktop the decided order is the period band, Hours, then Settings
 * (paycalc.md → Layout decisions), and that used to be CSS `order` alone — which moves the PAINT,
 * not the FOCUS: Tab ran through Your Settings' `?` and arrow at the foot of the page before it went
 * back up to the tax-year tabs (WCAG 2.4.3). So from 1024px the card itself moves after Hours, and
 * back in front of the period band below it, on the grid's own breakpoint. paycalc.css keeps the
 * `order` rules, which now agree with the DOM, so the paint before this runs is already the decided one.
 *
 * THE WAY TO IT. The setup banner asks a member to check their grade and tax code in "⚙️ Your
 * Settings" — on a desktop ~1,450px below the banner, behind the whole Hours card. Those words are a
 * link (`#settingsCard`, written by paycalc-app.js), and it goes the road the banner's Restore link
 * does (paycalc-transfer-card.js): the deep link's open-and-keep-in-view, so a tap while the page is
 * still growing still lands — then focus on the grade, the first thing the banner asks about. The
 * fragment is a deep link in its own right too. `openCardNamedByHash` is INJECTED, as
 * `wirePensionControls` takes `autosave`: overlay.js touches `window` at import, and this module is
 * unit-tested in Node.
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
  // Rate is set per-period in updateRateForPeriod() called from onPeriodChange —
  // no need to set it here; the field will update when buildPeriodSelect fires.
  const code    = lsGet(SK.code);
  let   sl      = lsGet(SK.sl);
  let   pgLoan  = lsGet(SK.pgLoan);
  const done    = lsGet(SK.setup);
  if (code)    /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value     = code.toUpperCase();
  // Migration (v17.17): the Student Loan select used to carry 'postgrad' as a plan option; it is now a
  // plan (None/1/2/4/5) PLUS a separate Postgraduate Loan flag, which can apply ALONGSIDE a plan. A saved
  // 'postgrad' selection becomes plan 'none' + PGL on, re-persisted ONCE so it never re-migrates.
  if (sl === 'postgrad') { sl = 'none'; pgLoan = '1'; lsSet(SK.sl, 'none'); lsSet(SK.pgLoan, '1'); }
  if (sl)      /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value = sl;
  /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked = pgLoan === '1';
  // Loan-repaid cutover (v18.41). The coordinator builds the payslip options BEFORE calling
  // loadSettings; a saved payslip that list no longer reaches is offered first, because a select set
  // to a value no option carries selects NOTHING — which calculate() reads as "still deducted" and
  // the next save writes back over the record (paycalc-3-8).
  const _slPaidOff   = lsGet(SK.slPaidOff);
  const _slPaidOffEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('slPaidOffFrom'));
  if (_slPaidOffEl && _slPaidOff) {
    offerRecordedPayslip(_slPaidOffEl, parseInt(_slPaidOff, 10));
    _slPaidOffEl.value = _slPaidOff;
  }
  let grade = lsGet(SK.grade);
  if (!grade || !GRADES[grade]) {
    // Auto-detect from the logged-in member's role. Via gradeForRole (v21.78) rather than an
    // inline CES check, so "this role has no grade" is an answer the app can act on instead of
    // silently becoming CEA further down.
    grade = gradeForRole(getLoggedMember()?.role) ?? grade;
  }
  if (grade && GRADES[grade]) {
    /** @type {HTMLSelectElement} */ (document.getElementById('gradeSelect')).value = grade;
    lsSet(SK.grade, grade);
    invalidateGrade();
  }
  // ── PENSION STATUS: migrate the retired boolean, then paint the controls ──────────────────────
  //
  // The v21.64 flag carried no date, so no migration can recover the real one. It becomes a change
  // dated to the FIRST PAYSLIP OF 2026/27 — the feature shipped 23 Aug 2026 and was retired at
  // v21.78, so anybody holding the flag set it in 2026/27 — and the property that makes that safe is
  // directional: every payslip it moves, it moves from a wrongly-imposed £0 back to the scheme
  // default. It can not impose a £0 on a payslip that did not already have one. Persisted at once
  // so the result is stable and correctable in the control below, rather than recomputed on each
  // load; the timeline key's EXISTENCE is what ends the migration, so an emptied one stays empty.
  // The YEAR IS NAMED, NOT TODAY'S (paycalc-3-16): "the current tax year" was 2026/27 only until the
  // 2027/28 rollover, after which a device first running this would have dated the opt-out from
  // 2027/28 and put a deduction back on every 2026/27 payslip the member was out of the scheme for.
  const _curP = getPeriods().find(/** @param {any} x */ x => x.num === todaysPeriodNum());
  if (lsGet(SK.pensionTimeline) === null && lsGet(SK.pensionOptOut) === '1') {
    const _firstOfYear = getPeriods().find(/** @param {any} x */ x => taxYearForPeriod(x)?.label === LEGACY_OPT_OUT_YEAR)?.num ?? null;
    savePensionTimeline(migrateLegacyOptOut(true, _firstOfYear));
  }
  const _tl = getPensionTimeline();
  // The TICK states today's position (is she in the scheme now?); the SELECT states when the
  // current spell began. Two different questions, and collapsing them is what the timeline exists
  // to prevent — the tick alone cannot say which payslips it covers.
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
    // One-time legacy migration (was: run on EVERY load). Users who completed setup
    // before per-tax-year confirmation tracking existed have SK.setup but no per-year
    // flags — mark the tax years that exist NOW as confirmed so they aren't re-prompted
    // for a year they already effectively set up.
    //
    // Guarded so it runs ONCE per member: a tax year ADDED LATER must NOT be swept up
    // here, so its "👋 New tax year" setup banner appears the first time the member opens
    // a period in it. Pay rates change every April, so silently carrying the old year's
    // rate into a new one risked a stale-rate calculation with no prompt to review it.
    // (Re-running on every load was what defeated the banner the UI copy already promises.)
    //
    // And only for a member who IS legacy — `setup` with no per-year flag at all (paycalc-3-16).
    // Save settings writes both, so everybody since then has one; stamping them too marked years
    // they never set up as confirmed, a joiner's backup included.
    const migratedKey = `${pcPrefix()}setup_years_migrated`;
    if (!lsGet(migratedKey)) {
      if (!CONFIG.TAX_YEARS.some(ty => lsGet(settingsKey(ty)))) {
        CONFIG.TAX_YEARS.forEach(ty => lsSet(settingsKey(ty), '1'));
      }
      lsSet(migratedKey, '1');
    }
  }
}
