// @ts-check
/**
 * paycalc-save-line.js — the Pay Calculator's "not saved" line: what it says, what its Retry runs, and
 * who hears it change.
 *
 * Owns: which failure the line is about, the Retry beside it, the SETTING fields storage has not yet
 *   kept, when a later save may end the line, the Retry's focus when it hides, and the live region
 *   that speaks a change of state — and the status line's words for a payslip (`saveStatusWords`).
 * Does NOT own: the writes themselves, or reading storage (paycalc-app.js → `_commit`,
 *   `persistSetting`, `clearPeriod`, `updateSaveStatus`, which call in here).
 *
 * Out of paycalc-app.js (28 Nov 2026), where it was three loose variables that two code paths could
 * each leave half-updated. The e2e half is e2e/paycalc-saving.spec.js; the rules are pinned without a
 * browser by test/paycalc-save-line.test.mjs.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────────────────────────
 *
 * 1. THE WORDS AND THE RETRY ARE ONE FAILURE'S. The line's text and the Retry beside it change
 *    together or not at all. They were set apart: a setting refused while a Clear's failure stood kept
 *    the Clear's Retry under the setting's words, so "⚠ Not saved — try again" deleted the payslip's
 *    entries on one tap, without the two-tap confirm.
 * 2. A LINE ABOUT THE FORM OUTRANKS A SETTING'S. A setting refused while the form's line stands
 *    changes NOTHING on screen. It is not lost: every way that line can end stores or supersedes it —
 *    a form save that lands writes the whole form, the setting's field with it; a Clear that lands
 *    deletes the payslip's entries, which is what was asked for last; loading a payslip afresh shows
 *    what storage holds, as it does for typed figures. The form's line is the one to keep because only
 *    a whole-form save can end it truthfully — a setting writes its own fields and nothing typed.
 * 3. "SAVED" ONLY FOR WHAT STORAGE KEPT. A setting's line is ended by a setting's verified write only
 *    once every setting field refused since the line went up is stored. So a setting write CARRIES
 *    the refused fields too (`settingFields`): the student-loan skip saving after a refused Pension
 *    change stores the Pension change with it, rather than saying "saved" over it.
 * 4. A HIDDEN RETRY GIVES ITS FOCUS TO THE LINE. Retry hides the moment nothing is left to retry; if
 *    it held keyboard focus then, focus goes to the status line (`tabindex="-1"`), which reads out what
 *    happened, rather than dropping to <body> and the top of the page.
 * 5. A CHANGE OF STATE IS SPOKEN, A KEYSTROKE IS NOT. The status line repaints on every typed save,
 *    so it carries no live region (it would speak each keystroke). A separate off-screen region speaks
 *    only when the line goes up or changes its words, and when a write ends it ("saved again"). A
 *    payslip loaded afresh ends it silently: that is a new payslip, not a recovery. Where focus moved
 *    to the line (rule 4), the move speaks it, and the region is emptied rather than said twice.
 */

import { setStatus } from './status-text.js';
import { isDataEmpty, hasSavedComparison } from './paycalc-format.js';

/**
 * The status line's words for a payslip, and the class that colours them. Pure — the coordinator
 * reads storage and hands the answer in (paycalc-app.js → `updateSaveStatus`).
 *   - A failure on the line (`createSaveLine().text`) is said as it stands: what is on screen did not
 *     reach storage, so it is never "saved" for the figures storage still holds.
 *   - Saved entries that cannot be read say so, never "No entries saved" — anything typed replaces them.
 *   - Entries, or a pension figure of the payslip's own (more than half a penny off its default), are
 *     "saved"; only the figures typed from the real payslip are named as the comparison they are,
 *     since they compare the estimate with the payslip and do not change it.
 * @param {{ failure: string|null, saved: { data: any, error: any }|null, defaultPension: number }} a
 *   saved — `parseSavedPeriod`'s answer for what storage holds, null for nothing stored
 * @returns {{ text: string, cls: 'failed'|'corrupt'|'saved'|'unsaved' }}
 */
export function saveStatusWords({ failure, saved, defaultPension }) {
  if (failure) return { text: failure, cls: 'failed' };
  if (saved?.error) return { text: "⚠ Couldn't read this period's saved entries — anything you type will replace them", cls: 'corrupt' };
  const d = saved?.data;
  if (d) {
    const customPension = d.pension != null && Math.abs(d.pension - defaultPension) > 0.005;
    if (!isDataEmpty(d) || customPension) return { text: '✓ Entries saved for this payslip', cls: 'saved' };
    if (hasSavedComparison(d)) return { text: d.actualNet != null ? '✓ Take-home comparison saved' : '✓ Payslip comparison saved', cls: 'saved' };
  }
  return { text: 'No entries saved for this payslip', cls: 'unsaved' };
}

/** @typedef {'form'|'setting'} LineFrom */

/**
 * The page's one "not saved" line.
 * @returns {{
 *   readonly text: string|null,
 *   readonly retry: (() => void)|null,
 *   fail: (text: string, opts?: { from?: LineFrom, retry?: (() => void)|null, fields?: string[] }) => void,
 *   settingFields: (fields: string[]) => string[],
 *   settingStored: (fields: string[]) => void,
 *   stored: () => void,
 *   reset: () => void,
 *   paint: (els: { statusEl: HTMLElement|null, retryBtn: HTMLElement|null, liveEl: HTMLElement|null }) => void,
 * }}
 */
export function createSaveLine() {
  /** The line on show, or null. @type {string|null} */ let text = null;
  /** What it is about (rule 2). @type {LineFrom} */ let from = 'form';
  /** What its Retry runs, or null where there is nothing to retry. @type {(() => void)|null} */ let retry = null;
  /** Setting fields refused and not yet stored since the line went up (rule 3). */
  const refused = new Set();
  /** The text the page last showed, and whether a WRITE ended the line since (rule 5). */
  /** @type {string|null} */ let painted = null;
  let recovered = false;

  /** @param {boolean} byWrite */
  const end = (byWrite) => { text = null; retry = null; from = 'form'; refused.clear(); recovered = byWrite; };

  return {
    get text() { return text; },
    get retry() { return retry; },

    /** A write failed: put the line up, unless a form line outranks this setting's (rules 1, 2). */
    fail(t, { from: f = 'form', retry: r = null, fields = [] } = {}) {
      if (text && from === 'form' && f === 'setting') return;
      text = t; from = f; retry = r;
      for (const k of fields) refused.add(k);
    },

    /** What a setting's write must carry: its own fields and every one still refused (rule 3). */
    settingFields: (fields) => [...new Set([...fields, ...refused])],

    /** A setting's write of `fields` read back. It ends only a setting's line, and only once nothing
     *  refused is left unstored (rule 3). */
    settingStored(fields) {
      for (const k of fields) refused.delete(k);
      if (text && from === 'setting' && refused.size === 0) end(true);
    },

    /** A write of the whole form, or a clear, landed: whatever the line was about is stored. */
    stored: () => end(true),

    /** The payslip was loaded afresh from storage: the line goes, silently (rule 5). */
    reset: () => end(false),

    /** Show the Retry, move its focus if it hides (rule 4), and speak a change of state (rule 5).
     *  Called AFTER the status line has its words, which are what is spoken. */
    paint({ statusEl, retryBtn, liveEl }) {
      let focusMoved = false;
      if (retryBtn) {
        const hide = !(text && retry);
        if (hide && !retryBtn.hidden && retryBtn.ownerDocument?.activeElement === retryBtn && statusEl) {
          retryBtn.hidden = true;
          statusEl.focus();
          focusMoved = true;
        }
        retryBtn.hidden = hide;
      }
      const changed = text !== painted, byWrite = recovered;
      painted = text; recovered = false;
      if (!changed || !liveEl) return;
      if (focusMoved || (!text && !byWrite)) { liveEl.textContent = ''; return; }
      // The region never holds these words already: it is spoken only when the line's text changes, and
      // it holds the last words spoken or nothing — a failure's (which a status line with no failure
      // never shows) or a status line's (which a failure's never is) — so no change goes unheard.
      setStatus(liveEl, statusEl?.textContent ?? '');
    },
  };
}
