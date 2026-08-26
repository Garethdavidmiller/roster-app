// @ts-check
/**
 * paycalc-settings.js — Grade/contracted-hours helpers and Settings save/load.
 *
 * Owns: grade cache, getContr/getLoggedMember/getEffectiveContr/getProRateFactor/
 *   getPensionDefault, updateRateForPeriod, updateYtdForTaxYear, settingsKey,
 *   saveSettings, confirmSettings, setSettingsCardOpen, loadSettings.
 * Does NOT own: period arithmetic (paycalc-periods.js), pay maths (paycalc-calc.js),
 *   roster hints (paycalc-app.js).
 * Edit here for: grade helpers, settings persistence, rate/YTD field updates.
 * Do not edit here for: pay maths, period date maths, roster pre-fill.
 */

import { GRADES, taxYearForPeriod, calcProRateFactor, getPensionForPeriod, getRateForPeriod, isPreAwardPeriod, awardRatesFor, awardFromForYear } from './paycalc-calc.js';
import { CONFIG, getPeriods, currentPeriodNum, todaysPeriodNum, visiblePeriods, payslipPeriodNum } from './paycalc-periods.js';
import { SK, periodKey, ytdPayKey, ytdTaxKey, pcPrefix } from './paycalc-migrations.js';
import { getSession } from './session.js';
import { teamMembers } from './roster-data.js';
import { lsGet, lsSet } from './ls.js';
import { fdShort, fdLong } from './paycalc-format.js';
import {
  parsePensionTimeline, serialisePensionTimeline, isOptedOutAt, withPensionChange,
  optOutStartsAt, hasAnyPensionChange, migrateLegacyOptOut,
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

/**
 * The pay grade this app has CONFIRMED rates and contract terms for, given a member's role — or
 * null when it has none (v21.78).
 *
 * Written because the absence of a grade was indistinguishable from CEA. `getGrade()` returns ''
 * for anybody the app never stored one for, and every consumer then falls back to `GRADES.cea`, so
 * a Dispatcher or a manager opening the calculator received a complete, plausible CEA estimate.
 * That is worse than an unsupported state: an unverified figure at least looks unverified, whereas
 * this one was somebody else's pay presented as theirs.
 *
 * Dispatcher pay is not modelled because the rates and contractual terms are not on record — see
 * `.claude/rules/paycalc.md`. Do not invent them, and do not extend this map to a role until a real
 * payslip has confirmed it.
 *
 * @param {string|undefined|null} role @returns {'cea'|'ces'|null}
 */
export function gradeForRole(role) {
  if (role === 'CEA') return 'cea';
  if (role === 'CES') return 'ces';
  return null;
}

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
  let group = null; let groupLabel = '';
  for (const p of visiblePeriods()) {
    const ty = taxYearForPeriod(p);
    if (ty.label !== groupLabel) {
      groupLabel = ty.label;
      group = document.createElement('optgroup');
      group.label = `Tax year ${ty.label}`;
      sel.appendChild(group);
    }
    const o = document.createElement('option');
    o.value = String(p.num);
    o.textContent = `Paid ${fdLong(p.payday)} · P${payslipPeriodNum(p)}`;
    group?.appendChild(o);
  }
  // `currentPeriodNum()` READS THE PERIOD SELECT, which does not exist yet when loadSettings runs
  // at boot — it returns 0 there. Falling through to today's payslip keeps the control meaningful
  // on that first paint instead of leaving it on a value no option carries.
  const start = optOutStartsAt(timeline);
  sel.value = String(start ?? (currentPeriodNum() || todaysPeriodNum()));
  // Shown while she is out of the scheme, and KEPT once any change is on record — a rejoin has to
  // name the payslip it starts on, and with the control hidden the moment the tick comes off there
  // is nowhere to say it. Hidden only for the member who has never left, who should not be asked
  // to date something that did not happen.
  field?.classList.toggle('hidden', !hasAnyPensionChange(timeline)
      && !(/** @type {HTMLInputElement|null} */ (document.getElementById('pensionOptOutCheck'))?.checked));
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
 * ORDER MATTERS in the tick handler, twice. The date control is BUILT before the save, so a first
 * tick has a payslip to date itself from (`saveSettings` reads that control, and an unbuilt one
 * holds nothing). And `saveSettings` runs a SECOND time at the end, after the field has been
 * rebuilt: the first call persists the change while the field still shows the old state's figure,
 * so without the second, un-ticking left the member-level default at '0.00' behind a box reading
 * "in the scheme" — which a pay-data backup then carries to her next device (v21.77).
 *
 * @param {{ autosave: () => void }} deps  autosave is the coordinator's — it owns when to persist.
 */
export function wirePensionControls({ autosave }) {
  const _viewed = () => getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
  const _amt = () => /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));

  document.getElementById('pensionOptOutCheck')?.addEventListener('change', () => {
    buildPensionFromSelect(getPensionTimeline());
    saveSettings();
    buildPensionFromSelect(getPensionTimeline());
    const p = _viewed();
    applyPensionOptOutUI(p);
    // Un-ticking must put the scheme figure back: the field is showing a £0.00 that is no longer
    // anybody's default, and leaving it would persist as a real opt-out on the next save.
    const amt = _amt();
    if (amt && !amt.disabled) amt.value = periodDefaultPension(p).toFixed(2);
    saveSettings();
    autosave();
  });

  // Moving the boundary re-prices both sides of it, so the field, the lock and the estimate are
  // all repainted — not merely recalculated.
  document.getElementById('pensionOptOutFrom')?.addEventListener('change', () => {
    saveSettings();
    const p = _viewed();
    applyPensionOptOutUI(p);
    const amt = _amt();
    if (amt && !amt.disabled) amt.value = periodDefaultPension(p).toFixed(2);
    autosave();
  });
}

/** Full-period pension default for the current grade, period-aware.
 *  Pass a period object to get the correct rate for that payday (handles cut-overs).
 *
 *  THE OPT-OUT IS APPLIED HERE, and here only (v21.64). Four sites ask what a payslip's pension
 *  should be when the member has not typed one — the field default and calculate()'s fallback (via
 *  `_periodDefaultPension`, paycalc-app.js), the HPP non-premium estimate (paycalc-hpp.js) and the
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
// Loads the stored rate for the given tax year into the hourly rate field.
// Falls back to the legacy single rate, then to the current grade's default.
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
 * Load the rate for the given period into the hourly rate field. Period-aware: a period paid
 * BEFORE its tax year's mid-year pay-award date shows the pre-award rate (e.g. 2025/26 periods
 * before 24 Oct 2025 show £20.06, not the settled £20.74) — so the calculator matches the real
 * payslip for historic periods. calculate() reads this field, so no change is needed there.
 * @param {any} ty  - the period's tax year
 * @param {any} [p] - the period (enables the mid-year step; omitted → settled rate only)
 */
export function updateRateForPeriod(ty, p) {
  const grade    = getGrade();
  const settled  = getStoredRateForYear(ty);
  const preAward = !!p && isPreAwardPeriod(p, grade, ty.label);
  const rate     = preAward ? getRateForPeriod(p, grade, ty.label, settled) : settled;
  const field    = /** @type {HTMLInputElement} */ (document.getElementById('hourlyRate'));
  field.value = rate.toFixed(2);
  // The rate is FIXED BY GRADE (v17.87) — ALWAYS read-only; the member never types it. A pre-rise
  // payslip shows that period's historic rate, a current/post-rise payslip the new rate.
  field.readOnly = true;
  field.title    = 'Set by your grade — CEA and CES each have a fixed hourly rate';
  const lbl = document.getElementById('rateYearLabel');
  if (lbl) lbl.textContent = preAward ? `${ty.label} · pre-rise rate` : `${ty.label} · current rate`;
  // Spell out the pre/post-rise position plainly under the field (owner: make pre vs post clear).
  const note = document.getElementById('rateStepNote');
  if (note) {
    const from = awardFromForYear(ty.label);
    const show = preAward && !!from;
    note.textContent = show
      ? `This payslip predates the ${fdShort(from)} pay rise — later payslips switch to the new rate automatically.`
      : '';
    note.style.display = show ? '' : 'none';
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
  // repaying. The select may not exist in old cached HTML — guard rather than throw.
  const _slPaidOffEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('slPaidOffFrom'));
  if (_slPaidOffEl) lsSet(SK.slPaidOff, _slPaidOffEl.value);
  // Out of the scheme — saved BEFORE the amount below, because getPensionDefault() reads it and
  // the amount's own fallback must see the state the member just chose.
  //
  // A CHANGE DATED TO A PAYSLIP, not a global flag (v21.78): the `from` select carries the payslip
  // the spell begins at, and `withPensionChange` collapses a re-statement of the current state to
  // nothing, so the repeated saves this function gets (every keystroke in the pension field lands
  // here) can not accumulate entries. With no select rendered — old cached HTML — the change dates
  // from the payslip being viewed today, which is the reading the control defaults to anyway.
  const _optOut = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionOptOutCheck'));
  if (_optOut) {
    const _fromEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('pensionOptOutFrom'));
    const _fromNum = parseInt(_fromEl?.value ?? '', 10);
    const _from = Number.isFinite(_fromNum) ? _fromNum : currentPeriodNum();
    savePensionTimeline(withPensionChange(getPensionTimeline(), _from, !!_optOut.checked));
  }
  // On a joining period the pension field shows the pro-rated amount.
  // Always write the full-period default to SK.pension so future full periods
  // don't inherit the pro-rated value as their default.
  const _pensionToSave = getProRateFactor(curP) < 1
    ? getPensionDefault(curP)
    : /** @type {HTMLInputElement} */ (document.getElementById('pensionAmt')).value;
  lsSet(SK.pension, _pensionToSave);
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
      const _pRaw = /** @type {HTMLInputElement} */ (document.getElementById('pensionAmt')).value.trim();
      d.pension = (isPensionOptedOut(curP) || _pRaw === '') ? null : (parseFloat(_pRaw) || 0);
      lsSet(periodKey(pNum), JSON.stringify(d));
    } catch {}
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
  if (hintEl) hintEl.textContent = `✓ ${curTy.label} — £${rate}/hr${_cfPre ? ' · pre-rise' : ''}`;
  // Brief "saved" confirmation then collapse
  const fb = document.getElementById('settingsSaveFeedback');
  if (fb) fb.textContent = '✓ Settings saved';
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
  if (toggle) toggle.classList.toggle('open', open);
  if (body)   body.classList.toggle('open', open);
  // aria-expanded lives on the collapse CONTROL (the arrow), not the header — the header is no
  // longer role="button" (v17.50), so aria-expanded on it is invalid ARIA. Mirror initCardCollapse.
  const ctrl = toggle?.querySelector('.card-toggle-arrow') || toggle;
  if (ctrl) ctrl.setAttribute('aria-expanded', String(open));
}

/** Load persisted settings into the form fields. */
export function loadSettings() {
  // Rate is set per-period in updateRateForPeriod() called from onPeriodChange —
  // no need to set it here; the field will update when buildPeriodSelect fires.
  const code    = lsGet(SK.code);
  let   sl      = lsGet(SK.sl);
  let   pgLoan  = lsGet(SK.pgLoan);
  const pension = lsGet(SK.pension);
  const done    = lsGet(SK.setup);
  if (code)    /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value     = code.toUpperCase();
  // Migration (v17.17): the Student Loan select used to carry 'postgrad' as a plan option; it is now a
  // plan (None/1/2/4/5) PLUS a separate Postgraduate Loan flag, which can apply ALONGSIDE a plan. A saved
  // 'postgrad' selection becomes plan 'none' + PGL on, re-persisted ONCE so it never re-migrates.
  if (sl === 'postgrad') { sl = 'none'; pgLoan = '1'; lsSet(SK.sl, 'none'); lsSet(SK.pgLoan, '1'); }
  if (sl)      /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value = sl;
  /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked = pgLoan === '1';
  // Loan-repaid cutover (v18.41). The coordinator builds the payslip options BEFORE calling
  // loadSettings, so the saved p.num resolves to a real option here (an unknown value no-ops).
  const _slPaidOff   = lsGet(SK.slPaidOff);
  const _slPaidOffEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('slPaidOffFrom'));
  if (_slPaidOffEl && _slPaidOff) _slPaidOffEl.value = _slPaidOff;
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
  // dated to the FIRST PAYSLIP OF THE CURRENT TAX YEAR — the feature shipped 23 Aug 2026, so
  // anybody holding the flag set it in 2026/27 — and the property that makes that safe is
  // directional: every payslip it moves, it moves from a wrongly-imposed £0 back to the scheme
  // default. It can not impose a £0 on a payslip that did not already have one. Persisted at once
  // so the result is stable and correctable in the control below, rather than recomputed on each
  // load; the timeline key's EXISTENCE is what ends the migration, so an emptied one stays empty.
  // todaysPeriodNum(), NOT currentPeriodNum(): this runs before buildPeriodSelect(), so the period
  // select does not exist and currentPeriodNum() returns 0. The migration then failed SAFE (an
  // undatable change records nothing) and so never ran at all — caught by its own e2e. Today's
  // payslip is the right anchor regardless: the tax year being asked for is the one the retired
  // flag could first have been set in.
  const _curP = getPeriods().find(/** @param {any} x */ x => x.num === todaysPeriodNum());
  if (lsGet(SK.pensionTimeline) === null && lsGet(SK.pensionOptOut) === '1') {
    const _curTy = _curP ? taxYearForPeriod(_curP) : null;
    const _firstOfYear = _curTy
      ? (getPeriods().find(/** @param {any} x */ x => taxYearForPeriod(x)?.label === _curTy.label)?.num ?? null)
      : null;
    savePensionTimeline(migrateLegacyOptOut(true, _firstOfYear));
  }
  const _tl = getPensionTimeline();
  // The TICK states today's position (is she in the scheme now?); the SELECT states when the
  // current spell began. Two different questions, and collapsing them is what the timeline exists
  // to prevent — the tick alone cannot say which payslips it covers.
  const _optOutEl = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionOptOutCheck'));
  if (_optOutEl) _optOutEl.checked = optOutStartsAt(_tl) !== null;
  buildPensionFromSelect(_tl);
  /** @type {HTMLInputElement} */ (document.getElementById('pensionAmt')).value =
    isPensionOptedOut(_curP) ? '0.00' : (pension ?? getPensionDefault(_curP));
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
    const migratedKey = `${pcPrefix()}setup_years_migrated`;
    if (!lsGet(migratedKey)) {
      CONFIG.TAX_YEARS.forEach(ty => {
        if (!lsGet(settingsKey(ty))) lsSet(settingsKey(ty), '1');
      });
      lsSet(migratedKey, '1');
    }
  }
}
