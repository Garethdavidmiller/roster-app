// @ts-check
/**
 * paycalc-grade-setting.js — the member's GRADE SETTING on this device, and the page's grade controls.
 *
 * Owns: the setting itself (`getGradeSetting` — 'roster', the default, or a grade the member chose
 *   from a payslip on — cached, because calculate() reads it on every keystroke), the signed-in
 *   member (`getLoggedMember`), a payslip's grade days for that member (`gradeDaysFor`, `getContr`),
 *   saving it from the Grade box and its "from which payslip?" (`saveGradeSetting`), loading it —
 *   including the ONE conversion of a grade saved before grades had dates (`loadGradeSetting`) — and
 *   what the page says about it: the grade prompt, the roster's line under the Grade box and the
 *   one-time note.
 * Does NOT own: the rules (paycalc-grade.js, pure), the rates a grade is paid at, or the rest of
 *   Settings (paycalc-settings.js, which imports this and re-exports what its callers read).
 *
 * Its own module, rather than a section of paycalc-settings.js, because dating the grade took that
 * file past 900 lines (coordinator-ratchet.test.mjs), and this is one subject with one state. It must
 * never import paycalc-settings.js: that is the direction import-graph.test.mjs holds.
 */

import { GRADES } from './paycalc-calc.js';
import { getPeriods, currentPeriodNum, todaysPeriodNum, visiblePeriods, appendPayslipOptions, offerRecordedPayslip } from './paycalc-periods.js';
import { SK } from './paycalc-migrations.js';
import { getSession } from './session.js';
import { teamMembers, gradeForRole } from './roster-data.js';
import { roleOn, rolesInRange } from './roster-roles.js';
import {
  FROM_ROSTER, gradeDays, byDays, settingFromLegacy, rosterStretches, rosterGradeLine, gradeChangeNote,
} from './paycalc-grade.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { setStatus } from './status-text.js';

// ── THE GRADE SETTING, AND A PAYSLIP'S GRADE DAYS ─────────────────────────────
// Which grade prices a payslip (paycalc-grade.js): 'roster' — the roster's dated grades, the default
// — or a grade the member chose, from a payslip on. Read on every keystroke (calculate, calcHPP), so
// it is cached until a save or a load changes it.
/** @type {import('./paycalc-grade.js').GradeSetting|null} */
let _gradeCache = null;
/**
 * The member's grade setting. A grade saved before grades had dates has no `from`, and READS as
 * covering every payslip — exactly what it did — until loadSettings migrates it (settingFromLegacy).
 * @returns {import('./paycalc-grade.js').GradeSetting}
 */
export function getGradeSetting() {
  if (_gradeCache) return _gradeCache;
  const g = lsGet(SK.grade) || '';
  const from = parseInt(lsGet(SK.gradeFrom) ?? '', 10);
  _gradeCache = GRADES[g]
    ? { grade: g, from: Number.isFinite(from) ? from : 0 }
    : { grade: FROM_ROSTER, from: 0 };
  return _gradeCache;
}
/** Forget the cached setting, so the next read sees what was just stored. */
function invalidateGrade() { _gradeCache = null; }

/**
 * The grades a payslip's days were worked under, for the signed-in member (paycalc-grade.js →
 * gradeDays). With nobody the roster holds there is nothing to ask — the page refuses before anything
 * is priced (paycalc-app.js) — so CEA stands in, as it always has, for the test harnesses and the
 * instant before the refusal paints.
 * @param {any} p
 * @returns {import('./paycalc-grade.js').GradePart[]}
 */
export function gradeDaysFor(p) {
  if (!p) return [];
  const parts = gradeDays(getLoggedMember(), p, getGradeSetting());
  return parts.length ? parts : [{ grade: 'cea', days: 28 }];
}

/**
 * Contracted hours for a payslip, by its grades' days — 140 for both grades today, so a payslip that
 * spans a promotion is 140 too. Without a payslip, the hours of a chosen grade, else CEA's.
 * @param {any} [p]
 * @returns {number}
 */
export function getContr(p) {
  if (!p) return GRADES[getGradeSetting().grade]?.contr ?? GRADES.cea.contr;
  return byDays(gradeDaysFor(p), g => GRADES[g]?.contr) ?? GRADES.cea.contr;
}

/** Return the teamMembers entry for the logged-in session user, or null. */
export function getLoggedMember() {
  const sess = getSession();
  if (!sess?.name) return null;
  return teamMembers.find(m => m.name === sess.name) || null;
}

// ── A ROSTER GRADE THAT DIFFERS FROM A CHOSEN ONE IS ASKED ABOUT, NEVER APPLIED ───────────────────
// (owner, 10 Nov 2026). A grade the member CHOSE outranks the roster, and applying the roster's grade
// silently would overwrite a deliberate setting — somebody acting up, or a roster row not yet
// corrected. Before grades had dates every saved grade was treated as chosen, which is how a member
// moved from CEA to CES kept CEA rates with nothing on the page saying so; now the roster decides by
// default and only a grade chosen by hand can disagree with it. So the page ASKS, once, in one line at
// the top — and remembers a "Keep" against the grade it declined, so the question comes back only if
// the roster later names a different grade.
const GRADE_NAMES = /** @type {Record<string, string>} */ ({
  cea: 'Customer Experience Ambassador',
  ces: 'Customer Experience Supervisor',
});

/**
 * The roster's grade to offer, or null when there is nothing to ask. PURE.
 * Nothing is asked without a chosen grade (the roster is deciding, so it cannot disagree with
 * itself), when the role has no confirmed rates (the page refuses instead), when the two agree, or
 * when the member already chose to keep their own grade over THIS roster grade.
 *
 * `role` may be the LIST of roster grades over the payslip on screen (`rolesInRange`), because a
 * grade has a date (`roleHistory`, read by roster-roles.js): a member promoted part-way through a payslip
 * holds both grades in it, and a saved grade that is EITHER of them is not contradicted — a promotion
 * released days early must not ask "switch?" about payslips worked before it. A payslip spanning two
 * grades offers neither, since one grade cannot price it.
 * @param {string|null|undefined} stored - the grade the member chose, if it covers the payslip on screen
 * @param {string|null|undefined|Array<string|null|undefined>} role - the member's roster role ('CEA',
 *   'CES', …), or the roles the roster gives over the payslip on screen
 * @param {string|null|undefined} kept - the roster grade the member last declined, if any
 * @returns {string|null}
 */
export function gradeToOffer(stored, role, kept) {
  if (!stored || !GRADES[stored]) return null;
  const grades = [...new Set((Array.isArray(role) ? role : [role]).map(r => gradeForRole(r)))];
  if (grades.includes(/** @type {any} */ (stored))) return null;
  if (grades.length !== 1) return null;
  const rosterGrade = grades[0];
  if (!rosterGrade || !GRADES[rosterGrade]) return null;
  if (kept === rosterGrade) return null;
  return rosterGrade;
}

/**
 * The roster grades the question compares against: the member's grades over the payslip on screen
 * (or, before the payslip selector is built — loadSettings runs first — the payslip being earned
 * today), from the dated `roleHistory`. Without a member there is nothing to compare.
 * @returns {Array<string|undefined>|undefined}
 */
function rosterRolesOnScreen() {
  const m = getLoggedMember();
  if (!m) return undefined;
  const num = currentPeriodNum() || todaysPeriodNum();
  const p = getPeriods().find(/** @param {any} x */ x => x.num === num);
  return p ? rolesInRange(m, p.start, p.cutoff).map(r => r.role) : [roleOn(m, new Date())];
}

/**
 * The grade the member CHOSE, when it covers the payslip the question is about — the one on screen,
 * or before the payslip selector is built the one being earned today — else null. With the roster
 * deciding there is nothing to ask: its own grades cannot disagree with it.
 * @returns {string|null}
 */
function chosenGradeOnScreen() {
  const s = getGradeSetting();
  if (s.grade === FROM_ROSTER || !GRADES[s.grade]) return null;
  return (currentPeriodNum() || todaysPeriodNum()) >= (s.from || 0) ? s.grade : null;
}

/**
 * Paint the grade prompt (#gradePrompt). `mayShow` is true only on load: a member who changes the
 * Grade box during a visit has just answered the question themselves, so a save may HIDE the prompt
 * (the two now agree) but never raise it. An answered prompt keeps its confirmation until reload.
 * @param {boolean} [mayShow]
 */
export function renderGradePrompt(mayShow = false) {
  const box = document.getElementById('gradePrompt');
  if (!box?.dataset || box.dataset.answered) return;
  const offer = gradeToOffer(chosenGradeOnScreen(), rosterRolesOnScreen(), lsGet(SK.gradeKept));
  if (!offer) { box.hidden = true; return; }
  if (!mayShow && box.hidden) return;
  const current = /** @type {string} */ (chosenGradeOnScreen());
  const text = document.getElementById('gradePromptText');
  const use = document.getElementById('gradePromptUse');
  const keep = document.getElementById('gradePromptKeep');
  if (!text || !use || !keep) return;
  text.textContent = `The roster lists you as ${offer.toUpperCase()} (${GRADE_NAMES[offer]}), `
    + `but this calculator is using ${current.toUpperCase()} rates.`;
  use.textContent = `Use ${offer.toUpperCase()} rates`;
  keep.textContent = `Keep ${current.toUpperCase()}`;
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    use.addEventListener('click', () => answerGradePrompt(box, 'use'));
    keep.addEventListener('click', () => answerGradePrompt(box, 'keep'));
  }
  box.hidden = false;
}

/**
 * The member's answer. "Use" sets the Grade box and ANNOUNCES the change, so the page's own change
 * handler re-prices everything a grade touches (rate, pension default, back pay) — the same path a
 * hand-picked grade takes. "Keep" remembers the roster grade it declined. Either way the question
 * gives way to one line saying what happened, which takes focus: the button just pressed is gone.
 * @param {HTMLElement} box @param {'use'|'keep'} answer
 */
function answerGradePrompt(box, answer) {
  const chosen = chosenGradeOnScreen();
  const offer = gradeToOffer(chosen, rosterRolesOnScreen(), lsGet(SK.gradeKept));
  const done = document.getElementById('gradePromptDone');
  if (!offer || !done) { box.hidden = true; return; }
  box.dataset.answered = '1';
  if (answer === 'use') {
    const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('gradeSelect'));
    // "Use" hands pricing back to the roster — its dated grades, not one grade on every payslip — so
    // the page's own change handler re-prices everything a grade touches, as for a hand-picked one.
    if (sel) {
      sel.value = FROM_ROSTER;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setStatus(done, `✓ Now using ${offer.toUpperCase()} rates.`);
  } else {
    lsSet(SK.gradeKept, offer);
    setStatus(done, `✓ Keeping ${String(chosen).toUpperCase()} rates. You can change your grade in Your Settings.`);
  }
  for (const id of ['gradePromptText', 'gradePromptActions']) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
  done.hidden = false;
  done.focus();
}

// ── WHAT THE ROSTER SAYS, IN WORDS — and, once, that a change of grade needs nothing doing ─────────
/**
 * The roster's grades over every payslip the member can see, as dated stretches (paycalc-grade.js).
 * [] with nobody signed in, or before the payslip list exists.
 * @returns {import('./paycalc-grade.js').RosterStretch[]}
 */
function rosterStretchesOnScreen() {
  const m = getLoggedMember();
  const vis = visiblePeriods();
  if (!m || !vis.length) return [];
  return rosterStretches(m, vis[0].start, vis[vis.length - 1].cutoff);
}

/**
 * The line under the Grade box (#gradeRosterLine): what the roster says, with its dates — "The roster
 * lists you as CEA until 21 Nov 2026, then CES from 22 Nov 2026." It is what "From the roster" means
 * for THIS member, and the comparison a member choosing a grade by hand is making.
 */
function renderGradeRosterLine() {
  const el = document.getElementById('gradeRosterLine');
  if (!el) return;
  const text = rosterGradeLine(rosterStretchesOnScreen());
  el.textContent = text;
  el.hidden = !text;
}

/**
 * The one-time note (#gradeNote) for a member whose roster grade changes within the payslips they
 * can see: it says the change needs nothing doing, because each payslip is priced at the grade held
 * on its days. Only while the roster decides (a grade chosen by hand is the grade prompt's business)
 * and only for a member the page prices. Painted on load; "OK" remembers the change on this device
 * (SK.gradeNote) and gives way to a line saying where the dates live, which takes focus — the button
 * just pressed is gone, as with the grade prompt's answers.
 */
function renderGradeNote() {
  const box = document.getElementById('gradeNote');
  if (!box?.dataset || box.dataset.answered) return;
  const m = getLoggedMember();
  const note = (m && gradeForRole(m.role) && getGradeSetting().grade === FROM_ROSTER)
    ? gradeChangeNote(rosterStretchesOnScreen(), new Date())
    : null;
  if (!note || lsGet(SK.gradeNote) === note.key) { box.hidden = true; return; }
  const text = document.getElementById('gradeNoteText');
  const ok = document.getElementById('gradeNoteOk');
  const done = document.getElementById('gradeNoteDone');
  if (!text || !ok || !done) return;
  text.textContent = note.text;
  box.dataset.key = note.key;
  if (!box.dataset.wired) {
    box.dataset.wired = '1';
    ok.addEventListener('click', () => {
      lsSet(SK.gradeNote, box.dataset.key || '');
      box.dataset.answered = '1';
      setStatus(done, '✓ Your grade\'s dates are in Your Settings, under Grade.');
      for (const id of ['gradeNoteText', 'gradeNoteActions']) {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      }
      done.hidden = false;
      done.focus();
    });
  }
  box.hidden = false;
}

/**
 * Build (and set) the "from which payslip?" control under the Grade box — the pension opt-out's
 * shape, because it is the same kind of question. Shown only while a grade is chosen by hand: the
 * roster needs no date, it has its own. Re-opening Settings shows the payslip ON RECORD (never
 * before the first one the member can see); a member choosing a grade for the first time is offered
 * the payslip on screen, or before the selector exists the one being earned today.
 * @param {import('./paycalc-grade.js').GradeSetting} setting
 */
function buildGradeFromSelect(setting) {
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('gradeFrom'));
  if (!sel) return;
  const vis = visiblePeriods();
  sel.innerHTML = '';
  appendPayslipOptions(sel, vis);
  const chosen = setting.grade !== FROM_ROSTER && !!GRADES[setting.grade];
  const recorded = chosen ? Math.max(setting.from || 0, vis[0]?.num ?? 0) : null;
  offerRecordedPayslip(sel, recorded);
  sel.value = String(recorded ?? (currentPeriodNum() || todaysPeriodNum()));
  gradeFromShown();
}

/** The "from which payslip?" field shows only while the Grade box holds a grade chosen by hand. */
function gradeFromShown() {
  const v = /** @type {HTMLSelectElement|null} */ (document.getElementById('gradeSelect'))?.value;
  document.getElementById('gradeFromField')?.classList?.toggle('hidden', !(v && GRADES[v]));
}

// ── SAVING AND LOADING THE SETTING ────────────────────────────────────────────────────────────────
/**
 * Save the setting from the Grade box and its "from which payslip?" — called FIRST by saveSettings,
 * because every helper after it that prices a payslip (periodRate, getPensionDefault) must read the
 * NEW setting (v17.40 review fix). 'roster' follows the roster's dated grades; a chosen grade covers
 * every payslip from the one #gradeFrom names, and a select with NOTHING chosen states nothing, so it
 * never overwrites the record (paycalc-3-8). A grade picked by hand answers the grade prompt's
 * question, so the prompt is hidden if the two now agree.
 * @param {number} pNum  the payslip on screen (0 before the selector exists)
 */
export function saveGradeSetting(pNum) {
  const saved = /** @type {HTMLSelectElement} */ (document.getElementById('gradeSelect')).value;
  if (saved === FROM_ROSTER || GRADES[saved]) {
    lsSet(SK.grade, saved);
    const fromEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('gradeFrom'));
    if (saved === FROM_ROSTER) lsDel(SK.gradeFrom);
    else if (fromEl && fromEl.selectedIndex !== -1 && fromEl.value) lsSet(SK.gradeFrom, fromEl.value);
    else if (lsGet(SK.gradeFrom) == null) lsSet(SK.gradeFrom, String(pNum || todaysPeriodNum()));
  }
  invalidateGrade();
  gradeFromShown();
  renderGradePrompt();
}

/**
 * Load the setting and paint everything that shows it — called by loadSettings, after the payslip
 * selector is built. A device that saved a grade before grades had dates is converted ONCE
 * (settingFromLegacy): a grade the roster itself gives them hands over to the roster, dates and all;
 * a grade they kept over the roster's, or one the roster never gives them, stays exactly as it was.
 * Nothing saved is the roster's too — a first visit no longer writes down whichever grade happened to
 * be current, which is what used to re-price a promoted member's past.
 *
 * A grade the member CHOSE outranks the roster, so one the roster disagrees with is ASKED about here
 * (owner, 10 Nov 2026) — the only moment the prompt may appear. With the roster deciding, a change
 * of grade on it is SAID, once, instead: there is nothing to ask.
 */
export function loadGradeSetting() {
  // A load reads storage afresh: the cache is only ever a copy of what was last loaded or saved.
  invalidateGrade();
  const saved = lsGet(SK.grade);
  if (saved !== FROM_ROSTER && lsGet(SK.gradeFrom) == null) {
    const member = getLoggedMember();
    const vis    = visiblePeriods();
    const first  = vis[0], last = vis[vis.length - 1];
    const rosterGrades = (member && first && last)
      ? rolesInRange(member, first.start, last.cutoff).map(r => gradeForRole(r.role))
      : [];
    const setting = settingFromLegacy({ saved, kept: lsGet(SK.gradeKept), rosterGrades, firstNum: first?.num ?? 0 });
    lsSet(SK.grade, setting.grade);
    if (setting.grade === FROM_ROSTER) lsDel(SK.gradeFrom);
    else lsSet(SK.gradeFrom, String(setting.from));
    invalidateGrade();
  }
  const setting = getGradeSetting();
  /** @type {HTMLSelectElement} */ (document.getElementById('gradeSelect')).value = setting.grade;
  buildGradeFromSelect(setting);
  renderGradeRosterLine();
  renderGradePrompt(true);
  renderGradeNote();
}
