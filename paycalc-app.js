// @ts-check
/**
 * paycalc-app.js — Pay Calculator coordinator for paycalc.html.
 *
 * Owns: onPeriodChange, calculate, autosave, form read/write, sticky bar,
 *   period data save/load, INIT, event listeners.
 * Does NOT own: period arithmetic (paycalc-periods.js), grade/settings
 *   (paycalc-settings.js), roster hint bar (paycalc-roster-hint.js),
 *   HPP maths (paycalc-hpp.js), back-pay maths (paycalc-backpay.js),
 *   pay maths (paycalc-calc.js), override cache (paycalc-roster-suggestions.js).
 * Edit here for: UI coordination, event wiring, calculate(), sticky bar.
 * Do not edit here for: pay maths, period date maths, HPP formula, back-pay maths.
 */

import { CONFIG as ROSTER_CONFIG, formatISO, parseSmartFloat, parseSmartFloatOrNull } from './roster-data.js';
import {
  GRADES, RATE_125, RATE_150, RATE_300,
  getTaxYearForOffset, taxYearForPeriod, getThresholds, getLondonAllowanceForPeriod,
  computeGross, computeTax, computeNI, computeSL, getPensionForPeriod,
  isPreAwardPeriod, getRateForPeriod,
} from './paycalc-calc.js';
import { resetOverrides, fetchOverridesForPeriod, getRosterSuggestion } from './paycalc-roster-suggestions.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { getSession, clearSession, ensureNamedSession, reconcileExpiredIdentity } from './session.js';
import { requirePage } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import {
  CONFIG, getPeriods, currentPeriodNum, todaysPeriodNum, payslipPeriodNum,
  hasBoxingDay, hasBankHoliday,
  updateBhRows, buildPeriodSelect,
  updateTyTabs, jumpToTaxYear, prevPeriod, nextPeriod,
  setEarliestVisiblePeriod, isTaxYearVisible, visiblePeriods,
  _setSelectPeriod,
} from './paycalc-periods.js';
import {
  getGrade, getEffectiveContr, getLoggedMember, getProRateFactor, getPensionDefault,
  updateRateForPeriod, updateYtdForTaxYear, settingsKey, setSettingsCardOpen,
  saveSettings, confirmSettings, loadSettings, getStoredRateForYear,
} from './paycalc-settings.js';
import {
  updateRosterHint, updateJoinerNotice, toggleRosterDays,
  fillCategoryFromRoster, fillFromRoster, _applyRosterSuggestion,
  clearRosterSuggestedAll, _restoreRosterSuggested, snapKey, HM_PAIRS,
} from './paycalc-roster-hint.js';
import { isDataEmpty, calcHPP, updatePriorHpp, resolveHppForPeriod } from './paycalc-hpp.js';
import { prefillBackPay, calcBackPay, restoreBpState, _bpAwardTaxYear, _backdatedFromPNum, raiseByPercent, applyBpMode } from './paycalc-backpay.js';
import { initNavPanel } from './nav-panel.js';
import { initCardCollapse } from './overlay.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency } from './perf-reporter.js';
import { SK, periodKey, hppEstKey, hppActualKey, hppIncKey, runMigrations, readPayslipActuals, isActualsDev, parseSavedPeriod } from './paycalc-migrations.js';
import { initPaycalcLightboxes } from './paycalc-lightboxes.js';
import { fd, fdShort, fmt, clampMinute, decimalToHM } from './paycalc-format.js';
'use strict';

/**
 * Phase 4a.2 (ARCHITECTURE_PLAN.md): the coordinator body is an exported init()
 * called by paycalc-boot.js (a 2-line bootstrap — CSP `script-src 'self'` blocks
 * inline module scripts). The local-identity gate below early-`return`s instead of
 * throwing, and importing this module no longer auto-runs it (testability). Body
 * unchanged otherwise — same statements, same order, one indent level in.
 */
export function init() {
    // Tear down a lingering privileged Firebase identity whose local app session has expired, so a
    // direct deep-link to this page can't keep an old credential live (review item 7 / Finding #9).
    // Runs BEFORE the session-guard early-return below (the expired-session path is exactly where a
    // stale identity lingers). Fire-and-forget, login-safe: no-op on a valid session, stands down if a
    // login supersedes it.
    reconcileExpiredIdentity().catch(() => {});

    // ── SESSION GUARD (local-identity precondition) ───────────────────────────────
    // Not signed in → show the shared in-place sign-in (no redirect elsewhere). After sign-in,
    // reload back into the calculator. getSession() (session.js) enforces the 30-day absolute /
    // 7-day idle expiry and refreshes the idle clock — a raw localStorage read would treat an
    // expired session as valid forever. Early-return halts the rest of init() (overlay is shown).
    //
    // DELIBERATELY NOT routed through requirePage('paycalc') (ARCHITECTURE_PLAN.md Phase 7). The
    // paycalc policy is `soft`, which by its tested invariant NEVER returns 'login' — a signed-out user
    // would get 'soft-allow'. But the calculator needs a member identity to namespace its per-member
    // localStorage (pcPrefix/SK), so a *local name* is a hard precondition, stricter than the page
    // policy. The policy's `soft` applies only to the Firebase-confirmation path (_initErrorReporting
    // below): once a local name exists, an unconfirmed/anonymous Firebase session never blocks the
    // calculator. Do not "simplify" this gate into requirePage — it would regress to rendering with no
    // identity.
    if (!getSession()?.name) {
      // On success: INPLACE_LOGIN off (default) → reload back into the calculator (today's path); on →
      // re-invoke init() in place — the body below never ran on this pass, so re-entering runs it once
      // with the just-saved session. The per-member namespace is handled for free: runMigrations()
      // (below) calls setPaycalcNamespace(getLoggedMember()) and saveSession already wrote the member
      // before onSuccess, so loadSettings reads the right namespace. (ARCHITECTURE_PLAN.md Phase 9.)
      // In-place re-invocation falls back to a reload if init() throws mid-wiring, so the in-place
      // path is never less robust than the reload path (the overlay is already torn down by then).
      const onSuccess = ROSTER_CONFIG.INPLACE_LOGIN.paycalc
          // Reload (fresh overlay) rather than re-invoke init() into a soft-lock if saveSession
          // silently failed (iOS private mode) and getSession() is still null. See operations-app.js.
          ? () => { try { if (!getSession()?.name) { window.location.reload(); return; } init(); } catch { window.location.reload(); } }
          : () => window.location.reload();
      initLoginOverlay({ pageLabel: 'Pay Calculator', onSuccess });
      return;
    }
    // In-place sign-in: remove the still-mounted overlay if we re-entered via onSuccess. No-op on a
    // normal already-signed-in load (no overlay present).
    dismissLoginOverlay();

    // Period helpers, grade helpers, settings, roster hint, HPP, back-pay all imported above.
    // SK, periodKey, hppEstKey, hppActualKey imported from paycalc-migrations.js

    // ── COORDINATOR STATE ─────────────────────────────────────────────────────────
    // Back pay state — set by _applyBpState() when calcBackPay() runs.
    // Read by calculate() to add the lump sum into that period's gross before tax/NI.
    let _bpAmount     = 0; // gross back pay for the "paid in" period (0 = none)
    let _bpPNum       = 0; // period number that receives the back pay (0 = none)
    let _bpIsEstimate = false; // lump derives from an unconfirmed award → label it "estimated"
    let _bpIncluded   = false; // the card's opt-in tick — the lump only joins the take-home when true

    // Session-level tracker — prevents Settings card from auto-opening more than once per tax year
    // per browser session. Cleared on page reload. Uses tax year label as the key.
    const _settingsPrompted = new Set();

    // The default period num selected on page load (first upcoming payday). Used by
    // the ● today-period button to know when to show itself.
    /** @type {number | null} */
    let _defaultPeriodNum = null;

    let _adjNegative = false; // tracks intended sign of otherAdj independently of value
    // True once the user types into / clears any hours field after a background override-fetch
    // began, so the late fetch's re-apply doesn't overwrite an in-flight edit (see onPeriodChange).
    let _hoursTouchedSinceFetch = false;
    // True when the CURRENTLY-loaded period's saved blob was CORRUPT (parseSavedPeriod returned an
    // error). The v16.70 warning promises "anything you type will replace them" — but the background
    // override-fetch would auto-apply a roster suggestion and autosave over the corrupt blob with NO
    // user action, breaking that promise (v16.82 review fix). So the fetch callback skips its
    // auto-apply+autosave on a corrupt load; only an explicit user action (typing, or "Fill from
    // calendar") may overwrite. Set in loadPeriodData on every period change.
    let _periodLoadWasCorrupt = false;

    // periodKey (and SK, hppEstKey, hppActualKey, ytdPayKey, ytdTaxKey) imported from paycalc-migrations.js

    // Period data schema — all fields that get saved per period
    function emptyPeriodData() {
      return { satH:0, satM:0, bhH:0, bhM:0, bhOtH:0, bhOtM:0, otH:0, otM:0, rdwH:0, rdwM:0, sunH:0, sunM:0, boxH:0, boxM:0, peer:0, slSkip:false, otherAdj:0 };
    }

    // ── DATE/CURRENCY HELPERS — imported from paycalc-format.js ──────────────────
    // fd / fdShort / fmt imported at the top of the file.

    // ── INPUT HELPERS ─────────────────────────────────────────────────────────────
    /**
     * @param {string} id
     */
    function numVal(id) {
        // iOS keyboards can insert smart hyphens/minus and curly quotes; parseSmartFloat
        // strips them so parseFloat doesn't silently return NaN on otherwise-valid input.
        return parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById(id))?.value ?? '');
    }
    /**
     * numVal, but floors an unparseable (NaN) result to `fallback`. The signed fields
     * (pension, Year-to-Date pay/tax) read numVal RAW after only a non-empty guard, so a
     * stray/pasted character (parseSmartFloat → NaN) would cascade £NaN through the whole
     * result card. Hours self-floor via intVal's `|| 0`; these need an explicit floor.
     * @param {string} id @param {number|null} fallback
     * @returns {number|null}
     */
    function numValOr(id, fallback) {
        // parseSmartFloatOrNull, NOT numVal: parseSmartFloat floors garbage to 0 (its `|| 0`), so
        // the old Number.isFinite(numVal(id)) check was dead code — an unparseable Year-to-Date
        // remnant (a lone "." or "-" left mid-edit, then autosaved) became £0, which flipped
        // computeTax into cumulative mode and collapsed Income Tax to £0.00. A non-parseable OR
        // empty value now genuinely returns the fallback ("not provided").
        const v = parseSmartFloatOrNull(/** @type {HTMLInputElement} */ (document.getElementById(id))?.value ?? '');
        return v === null ? fallback : v;
    }
    /** @param {string} id */
    // Math.max(0, …) floors at zero: hours/minutes can never be negative, and on desktop the
    // numeric field will accept a typed/pasted "-5" (mobile's numeric keypad has no minus), which
    // would otherwise subtract pay. Used only for hour/minute reads (hhmmDec) — never a signed field.
    function intVal(id)    { return Math.max(0, parseInt(/** @type {HTMLInputElement} */ (document.getElementById(id))?.value ?? '') || 0); }
    /**
     * @param {string} hId
     * @param {string} mId
     */
    function hhmmDec(hId, mId) { return intVal(hId) + intVal(mId) / 60; }

    /** @param {string} mId */
    function clampMins(mId) {
      const el = /** @type {HTMLInputElement|null} */ (document.getElementById(mId));
      if (!el) return;
      const v  = parseInt(el.value);
      if (isNaN(v)) return;
      const c = clampMinute(v);
      if (c !== v) el.value = String(c); // only rewrite when out of range (preserves a typed "05")
    }

    // Find (or lazily create) the live decimal-conversion hint that sits beneath an
    // hours field's hrs:mins pair. Returns null if the field/markup is missing.
    /**
     * @param {string} hId
     * @param {boolean} make
     */
    function _decHintEl(hId, make) {
      const wrap = document.getElementById(hId)?.closest('.hhmm-wrap');
      if (!wrap) return null;
      const col = wrap.parentElement;
      if (!col) return null;
      let hint = col.querySelector('.hhmm-dec-hint');
      if (!hint && make) {
        hint = document.createElement('div');
        hint.className = 'hhmm-dec-hint';
        hint.setAttribute('aria-hidden', 'true');
        col.appendChild(hint);
      }
      return hint;
    }

    // Live "= 7h 30m" preview shown WHILE a decimal is being typed, so the on-blur
    // split is a visible transformation rather than a silent one (trust on a pay form).
    /** @param {string} hId */
    function decPreview(hId) {
      const raw = /** @type {HTMLInputElement} */ (document.getElementById(hId)).value;
      const val = parseSmartFloat(raw);
      const hm = raw.includes('.') ? decimalToHM(val) : null;
      if (hm) {
        const hint = /** @type {HTMLElement | null} */ (_decHintEl(hId, true));
        if (hint) { hint.textContent = `= ${hm.h}h ${String(hm.m).padStart(2, '0')}m`; hint.hidden = false; }
      } else {
        const hint = /** @type {HTMLElement | null} */ (_decHintEl(hId, false));
        if (hint) hint.hidden = true;
      }
    }

    // If someone types "7.5" into an hours field, split it into 7 hrs 30 mins
    // automatically on blur rather than silently truncating to 7. The live preview
    // (decPreview) has already shown the result, so the split is no surprise.
    /**
     * @param {string} hId
     * @param {string} mId
     */
    function autoDecimalHours(hId, mId) {
      const raw = /** @type {HTMLInputElement} */ (document.getElementById(hId)).value;
      if (!raw.includes('.')) return;
      const hm = decimalToHM(parseSmartFloat(raw));
      if (!hm) return;
      /** @type {HTMLInputElement} */ (document.getElementById(hId)).value = String(hm.h);
      /** @type {HTMLInputElement} */ (document.getElementById(mId)).value = hm.m ? String(hm.m) : '';
      const hint = /** @type {HTMLElement | null} */ (_decHintEl(hId, false));
      if (hint) hint.hidden = true; // the split now shows in the hrs/mins fields
      autosave();
    }

    /**
     * @param {string} hId
     * @param {string} mId
     * @param {string | null} warnId
     */
    function onHhMm(hId, mId, warnId) {
      // Validate Saturday hours don't exceed contracted hours (pro-rated for joining periods)
      if (warnId) {
        const hrs   = hhmmDec(hId, mId);
        const warn  = document.getElementById(warnId);
        const curP  = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
        const contr = getEffectiveContr(curP);
        if (hrs > contr) {
          /** @type {HTMLInputElement} */ (document.getElementById(hId)).value = String(contr);
          /** @type {HTMLInputElement} */ (document.getElementById(mId)).value = '0';
          if (warn) { warn.textContent = `⚠ Capped at ${contr} hrs — your contracted maximum for this period`; warn.classList.add('show'); }
        } else {
          if (warn) warn.classList.remove('show');
        }
      }
      calculate();
    }

    // Period helpers (getPeriods, currentPeriodNum, updateBhRows, buildPeriodSelect,
    // updateTyTabs, jumpToTaxYear, prevPeriod, nextPeriod) imported from paycalc-periods.js.
    // getTaxYearForOffset, getThresholds, getLondonAllowanceForPeriod imported from paycalc-calc.js.

    function onPeriodChange() {
      _resetClearConfirm();   // switching period disarms a pending two-tap Clear (v16.84)
      const pNum    = +/** @type {HTMLSelectElement} */ (document.getElementById('periodSelect')).value;
      const periods = getPeriods();
      const p       = periods.find(/** @param {any} x */ x => x.num === pNum);
      if (!p) return;
      const cutStr  = fdShort(p.cutoff);

      // Prev / Next button states — over the VISIBLE periods (a new starter is clamped to their join
      // year), so the button state matches what prevPeriod/nextPeriod can actually navigate to.
      const _navPeriods = visiblePeriods();
      const idx = _navPeriods.findIndex(/** @param {any} x */ x => x.num === pNum);
      const prevBtn = /** @type {HTMLButtonElement} */ (document.getElementById('prevBtn'));
      const nextBtn = /** @type {HTMLButtonElement} */ (document.getElementById('nextBtn'));
      prevBtn.disabled = (idx <= 0);
      nextBtn.disabled = (idx >= _navPeriods.length - 1);
      prevBtn.setAttribute('aria-label', idx <= 0
        ? 'No earlier period available — this is the first one'
        : 'View earlier period');
      nextBtn.setAttribute('aria-label', idx >= _navPeriods.length - 1
        ? 'No later period available — this is the last one'
        : 'View later period');

      // Show the ● today-period button only when not on the default (current) period
      const todayPeriodBtn = document.getElementById('todayPeriodBtn');
      if (todayPeriodBtn) {
        todayPeriodBtn.classList.toggle('hidden', pNum === _defaultPeriodNum);
      }

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
      /** @type {HTMLElement} */ (document.getElementById('pmRange')).textContent   = `${startStr} – ${cutLongStr}`;
      /** @type {HTMLElement} */ (document.getElementById('pmSub')).textContent     = `💷 Paid: ${payStr}  ·  Tax year ${ty.label}`;
      /** @type {HTMLElement} */ (document.getElementById('periodBadge')).textContent = `P${payslipPeriodNum(p)}`;
      /** @type {HTMLElement} */ (document.getElementById('netPeriod')).textContent   = `Paid ${fd(p.payday)}`;

      // Update cut-off date in sub descriptions
      /** @type {HTMLElement} */ (document.getElementById('overtimeSub')).textContent =
        `Extra hours on top of a rostered shift (cut-off: ${cutStr}). Shows as "Overtime 1.25" on your payslip.`;
      /** @type {HTMLElement} */ (document.getElementById('rdwSub')).textContent =
        `Came in on a rest day, or worked a Saturday that wasn't in your roster (cut-off: ${cutStr}). Shows as "RDW 1.25" on your payslip.`;
      /** @type {HTMLElement} */ (document.getElementById('sundaySub')).textContent =
        `Any hours you worked on a Sunday (cut-off: ${cutStr}). Shows as "RDW Sun 1.5" on your payslip.`;

      const boxing = hasBoxingDay(p);
      /** @type {HTMLElement} */ (document.getElementById('boxingBanner')).classList.toggle('visible', boxing);
      /** @type {HTMLElement} */ (document.getElementById('boxingRow')).classList.toggle('hidden', !boxing);
      if (!boxing) { /** @type {HTMLInputElement} */ (document.getElementById('boxH')).value = ''; /** @type {HTMLInputElement} */ (document.getElementById('boxM')).value = ''; }

      // Update tax year tab active state
      updateTyTabs();

      // Tax-year chip in the back-pay + HPP card headers — makes clear WHICH year each card is
      // editing, even when collapsed (both cards follow the viewed period's tax year). (v17.89)
      for (const _cid of ['bpYearChip', 'hppYearChip']) {
        const _chip = document.getElementById(_cid);
        if (_chip) _chip.textContent = ty.label;
      }
      // Settings card chip shows the PERIOD/payslip you're on (the rate + pension are period-specific)
      // — the settings summary already carries the tax year. (v17.92)
      const _spc = document.getElementById('settingsPeriodChip');
      if (_spc) _spc.textContent = `P${payslipPeriodNum(p)} · ${fdShort(p.payday)}`;

      // Load the rate and Year to Date figures for this period's tax year (period-aware: an
      // early-in-the-year period before its mid-year pay-award date shows the pre-rise rate).
      updateRateForPeriod(ty, p);
      updateYtdForTaxYear(ty);

      // Year-to-Date "up to" note. The cumulative-PAYE tax method (computeTax) adds the entered YTD
      // figures to the VIEWED period's gross, so they are only correct when they are the totals as of
      // the payslip IMMEDIATELY BEFORE the one on screen. IMPORTANT: the figures are stored ONCE per
      // tax year (shared across all 13 periods) — the app does NOT know which payslip they came from.
      // So the note frames them as a single latest-payslip snapshot and names the ideal source
      // payslip for the viewed period, rather than implying a per-period accuracy it can't guarantee
      // (v17.33 note; wording softened v17.41 — the per-year storage means "enter from P44" could
      // otherwise read as satisfied while the fields still held older figures).
      const _ytdNote = document.getElementById('ytdUptoNote');
      if (_ytdNote) {
        const periodIdx = (p.num - 48) - ty.first + 1; // 1-based HMRC period within the tax year
        if (periodIdx <= 1) {
          // First payslip of the tax year — cumulative totals restart from £0 in April, so no prior
          // payslip exists to copy from.
          _ytdNote.innerHTML = `P${payslipPeriodNum(p)} is the first payslip of ${ty.label} — Year to Date starts fresh in April, so you can leave these blank.`;
        } else {
          const prevP = periods.find(/** @param {any} x */ x => x.num === p.num - 1);
          _ytdNote.innerHTML = prevP
            ? `The Year to Date figures are one running total from your <strong>latest payslip</strong>, shared across the year. They sharpen the P${payslipPeriodNum(p)} estimate most when they're the totals from the payslip just before it — <strong>P${payslipPeriodNum(prevP)} (paid ${fdShort(prevP.payday)})</strong>. Update them whenever a newer payslip arrives.`
            : `The Year to Date figures are one running total from your latest payslip — keep them updated as new payslips arrive.`;
        }
      }
      // Update the "for P__" label next to the pension field so users can see
      // which period's pension they are viewing or editing.
      const pensionPeriodLbl = document.getElementById('pensionPeriodLabel');
      if (pensionPeriodLbl) pensionPeriodLbl.textContent = `for P${payslipPeriodNum(p)}`;

      // Settings confirmation check for this tax year.
      const tyConfirmed = lsGet(settingsKey(ty));
      // Always keep the title current so the hardcoded HTML default never shows stale text.
      /** @type {HTMLElement} */ (document.getElementById('setupBannerTitle')).textContent = `👋 Estimate your take-home for ${ty.label}`;
      if (tyConfirmed) {
        // Confirmed — hide banner, update card header hint with saved values.
        /** @type {HTMLElement} */ (document.getElementById('setupBanner')).classList.add('hidden');
        const _hdrGrade = getGrade();
        // PERIOD-AWARE rate for the summary: on a pre-award period the payslip was actually paid at
        // the pre-rise rate, so show THAT (with a "· pre-rise rate" qualifier, mirroring the rate
        // field's own label) — otherwise the summary contradicts the £-breakdown + the payslip on
        // screen (the "why does July 3rd show the new rate at the top?" report). Post-award/current
        // periods show the year's settled rate. (Supersedes the v16.69 "always show the settled rate"
        // hint, which pre-dated a confirmed mid-year award making the two rates diverge on screen.)
        const _settledRate = getStoredRateForYear(ty);
        const _hintPreAward = isPreAwardPeriod(p, _hdrGrade, ty.label);
        const _hintRate = _hintPreAward ? getRateForPeriod(p, _hdrGrade, ty.label, _settledRate) : _settledRate;
        const rate = (_hintRate || numVal('hourlyRate') || (GRADES[_hdrGrade]?.rate ?? GRADES.cea.rate)).toFixed(2);
        const code = (/** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value || '1257L').toUpperCase();
        /** @type {HTMLElement} */ (document.getElementById('settingsHint')).textContent =
          `✓ ${ty.label} — £${rate}/hr${_hintPreAward ? ' · pre-rise rate' : ''} · ${code}`;
      } else {
        /** @type {HTMLElement} */ (document.getElementById('setupBannerBody')).innerHTML =
          `We've filled in the usual defaults — <strong>check your hourly rate and tax code</strong> in ⚙️ Your Settings below, then tap <strong>Save settings</strong>. You can add your hours with <strong>Fill from calendar</strong>. These settings apply to ${ty.label} only — you'll be prompted again when the new tax year starts.`;
        /** @type {HTMLElement} */ (document.getElementById('setupBanner')).classList.remove('hidden');
        // Auto-open settings once per session per TY — only for returning users (new users
        // already see the settings card open). Show the in-card notice for returning users.
        if (!_settingsPrompted.has(ty.label)) {
          _settingsPrompted.add(ty.label);
          if (lsGet(SK.setup)) {
            setSettingsCardOpen(true);
            const notice = document.getElementById('settingsNewYearNotice');
            if (notice) {
              notice.textContent = ty.rateUnconfirmed
                ? `New tax year ${ty.label} — the 3.6% pay award has been accepted by the RMT but isn't confirmed on payslips yet. The default rate may still be last year's; update once your payslip reflects the new rate, then tap Save settings.`
                : `New tax year ${ty.label} — check your hourly rate is up to date, then tap Save settings.`;
              notice.classList.remove('hidden');
            }
          }
        }
      }

      // Show/hide bank holiday rows based on whether this period has any
      updateBhRows(p);

      // Show rate-unconfirmed notices when the pay award isn't finalised — but ONLY on
      // TODAY'S pay period (owner request, v16.79): the award affects every period of the
      // pending tax year, but nagging on all 13 buried the warning in noise. Today's period
      // is the payslip about to be paid at a possibly-stale rate — the one place the warning
      // is actionable. Keyed to todaysPeriodNum() (date-based; NOT currentPeriodNum(), which
      // despite its name returns the SELECTED dropdown period — comparing that to p.num is
      // always true) so if confirmation slips past a period boundary the notice follows the
      // live payslip rather than dying on a hardcoded date.
      // Two locations: one inside ⚙️ Settings (existing), one on the result card (v9.93)
      // so the warning is visible even when the Settings card is collapsed.
      const _rateUnconfirmed = !!ty.rateUnconfirmed && p.num === todaysPeriodNum();
      const _rateNoticeEl = document.getElementById('rateUnconfirmedNotice');
      if (_rateNoticeEl) _rateNoticeEl.classList.toggle('hidden', !_rateUnconfirmed);
      const _resultRateNotice = document.getElementById('resultRateNotice');
      if (_resultRateNotice) _resultRateNotice.classList.toggle('hidden', !_rateUnconfirmed);

      // Read session now so we can set the correct initial fetch state
      const session2 = getSession();

      // Reset override cache before rendering the hint — clears stale data from the
      // previous period and sets the initial fetch state.
      resetOverrides(session2?.name ? 'checking' : 'base-only');

      // Collapse the day list on period change — reset before updateRosterHint so the
      // subsequent Firestore refresh doesn't close it again if the user opens it.
      const _dayListEl    = document.getElementById('rosterDayList');
      const _daysToggleEl = document.getElementById('rosterDaysToggle');
      if (_dayListEl)    _dayListEl.style.display = 'none';
      if (_daysToggleEl) _daysToggleEl.textContent = 'Show days ▼';

      // Update roster suggestion card and joiner notice for this period.
      updateRosterHint();
      updateJoinerNotice(p);

      // Update Pay → Calendar link for this period
      const _rvl = /** @type {HTMLAnchorElement | null} */ (document.getElementById('rosterViewLink'));
      if (_rvl) _rvl.href = `./?date=${formatISO(p.start)}`;

      // Fetch admin-added overrides from Firestore in the background.
      if (session2?.name) {
        const _fetchedPNum = p.num;
        _hoursTouchedSinceFetch = false; // start watching for in-flight user edits
        fetchOverridesForPeriod(p, session2.name).then(status => {
          if (status === 'cancelled') return;
          // Guard: if the user switched period before the fetch resolved, do not
          // autosave override data from the old period into the new period.
          if (currentPeriodNum() !== _fetchedPNum) return;
          updateRosterHint(); // display-only refresh of the hint bar — always safe
          // In-flight edits win: if the user typed into or cleared any hours field while the
          // fetch was in flight, do NOT re-apply the suggestion or autosave over their work —
          // a cleared auto-fill would otherwise be silently reinstated. The latest calendar
          // data still shows in the hint bar above, so they can tap "Fill from calendar".
          if (_hoursTouchedSinceFetch) return;
          // Never auto-apply + autosave over a CORRUPT period's blob (v16.82): that would overwrite
          // the damaged data with no user action, contradicting the warning's "anything YOU type
          // will replace them". The hint bar still refreshed above, so the member can choose to
          // "Fill from calendar" — an explicit action that legitimately replaces it.
          if (_periodLoadWasCorrupt) return;
          // Silently refresh any gold-highlighted fields filled during 'checking' state.
          const _refreshP = getPeriods().find(/** @param {any} x */ x => x.num === _fetchedPNum);
          if (_refreshP) {
            const _refreshS = getRosterSuggestion(_refreshP, getLoggedMember());
            if (_refreshS) { _applyRosterSuggestion(_refreshS); autosave(); }
          }
        });
      }

      // Load saved data for this period
      loadPeriodData(p.num);

      // Sync the back-pay card to the newly-viewed period's award year (v17.86 per-year viewing) —
      // ALWAYS, not only when the card is open, so the banner + take-home reflect whichever payslip
      // is on screen (each year's lump lands on its own payslip; the coordinator still gates the
      // gross on `_bpPNum === _pNum`). Per-year keys keep each year's tick/rates/manual amount apart.
      _syncBackPayForViewedYear();

      stampPaycalcPrintLine();
    }

    // currentPeriodNum() imported from paycalc-periods.js

    // ── PERIOD DATA SAVE / LOAD ───────────────────────────────────────────────────
    function readFormData() {
      return {
        satH: intVal('satH'), satM: intVal('satM'),
        bhH:  intVal('bhH'),  bhM:  intVal('bhM'),
        bhOtH:intVal('bhOtH'),bhOtM:intVal('bhOtM'),
        otH:  intVal('otH'),  otM:  intVal('otM'),
        rdwH: intVal('rdwH'), rdwM: intVal('rdwM'),
        sunH: intVal('sunH'), sunM: intVal('sunM'),
        boxH: intVal('boxH'), boxM: intVal('boxM'),
        peer: +(/** @type {HTMLElement} */ (document.getElementById('peerVal'))).textContent,
        slSkip:   /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked,
        otherAdj: (() => { const _r = Math.abs(numVal('otherAdj') || 0); return _adjNegative ? -_r : _r; })(),
        // A BLANK pension field must persist as null (→ caller re-applies the period default), not 0.
        // Coercing blank to 0 (the old `|| 0`) permanently stored £0 if autosave fired while the field
        // was transiently empty (e.g. cleared to retype), overstating take-home by ~£147. A typed "0"
        // still stores 0 (a genuine salary-sacrifice opt-out — see writeFormData's `!= null` restore).
        // parseSmartFloatOrNull, NOT numVal||0 (v16.84): numVal floors garbage to 0, so a stray "."
        // or "-" left mid-edit (then autosaved) stored a real £0 opt-out and overstated take-home by
        // ~£147. null (empty OR garbage) means "not provided" → the period default is re-applied on
        // load; a genuine typed "0" parses to 0 and is preserved (the deliberate opt-out).
        pension:  (() => { const _el = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt')); return (_el && _el.value.trim() !== '') ? parseSmartFloatOrNull(_el.value) : null; })(),
      };
    }

    /** @param {any} d */
    function writeFormData(d) {
      clearRosterSuggestedAll();
      const set = /** @param {string} id @param {any} v */ (id, v) => { /** @type {HTMLInputElement} */ (document.getElementById(id)).value = v || ''; };
      set('satH', d.satH || ''); set('satM', d.satM || '');
      set('bhH',   d.bhH   || ''); set('bhM',   d.bhM   || '');
      set('bhOtH', d.bhOtH || ''); set('bhOtM', d.bhOtM || '');
      set('otH',   d.otH   || ''); set('otM',   d.otM   || '');
      set('rdwH', d.rdwH || ''); set('rdwM', d.rdwM || '');
      set('sunH', d.sunH || ''); set('sunM', d.sunM || '');
      set('boxH', d.boxH || ''); set('boxM', d.boxM || '');
      /** @type {HTMLElement} */ (document.getElementById('peerVal')).textContent  = d.peer || 0;
      /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked  = d.slSkip || false;
      const _rawAdj = d.otherAdj ?? 0;
      _adjNegative = _rawAdj < 0;
      /** @type {HTMLInputElement} */ (document.getElementById('otherAdj')).value = _rawAdj ? Math.abs(_rawAdj).toFixed(2) : '';
      // Restore pension only when period data has a saved value; period-specific default is
      // applied by the caller (loadPeriodData or clearPeriod) when d.pension is null.
      // Loose != null so that pension = 0 (salary sacrifice opted out) is preserved correctly.
      const pa = /** @type {HTMLInputElement | null} */ (document.getElementById('pensionAmt'));
      if (pa && d.pension != null) pa.value = d.pension;
    }

    function updateAdjSign() {
      const btn = /** @type {HTMLElement} */ (document.getElementById('adjSignBtn'));
      btn.textContent = _adjNegative ? '−' : '+';
      btn.setAttribute('aria-label', _adjNegative ? 'Toggle sign: currently negative' : 'Toggle sign: currently positive');
      btn.classList.toggle('negative', _adjNegative);
    }

    // isDataEmpty imported from paycalc-hpp.js

    function autosave() {
      calculate(); // no-op double-call is harmless but kept here for standalone inputs
      const pNum = currentPeriodNum();
      const d    = readFormData();
      try {
        lsSet(periodKey(pNum), JSON.stringify(d));
        updateSaveStatus(pNum);
      } catch { /* storage unavailable */ }
    }

    /** @param {number} pNum */
    function loadPeriodData(pNum) {
      /** @type {any} */
      let d = emptyPeriodData();
      // parseSavedPeriod distinguishes CORRUPT from missing: a period whose saved JSON can't be
      // read must not silently present as an ordinary empty form ("No entries saved") — the user
      // could unknowingly type over damaged data. The form still loads empty (nothing is deleted;
      // the stored blob is only replaced if the user actually types), but updateSaveStatus shows
      // an explicit warning state instead (v16.70 review fix).
      const _parsed = parseSavedPeriod(lsGet(periodKey(pNum)));
      if (_parsed.data) d = _parsed.data;
      _periodLoadWasCorrupt = !!_parsed.error;   // gate the background fetch's auto-overwrite (v16.82)
      writeFormData(d);
      _restoreRosterSuggested(pNum);
      // If no pension has been manually saved for this period, apply the period-specific
      // default. This handles both: (a) pension rate cut-overs (old periods show the old
      // rate, new periods show the new rate) and (b) joining-period pro-ration.
      const _pObj = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
      if (d.pension == null && _pObj) {
        const _fullPension = getPensionDefault(_pObj);
        const pa = /** @type {HTMLInputElement | null} */ (document.getElementById('pensionAmt'));
        if (pa) pa.value = (_fullPension * getProRateFactor(_pObj)).toFixed(2);
      }
      updateAdjSign();
      // Auto-expand "more options" if this period has extras saved
      const hasExtras = d.slSkip || d.otherAdj;
      const extraBody = /** @type {HTMLElement | null} */ (document.getElementById('hoursExtra'));
      const extraBtn  = /** @type {HTMLElement | null} */ (document.getElementById('hoursShowMore'));
      if (hasExtras && extraBody && !extraBody.classList.contains('open')) {
        extraBody.classList.add('open');
        if (extraBtn) { extraBtn.classList.add('open'); /** @type {HTMLElement} */ (extraBtn.querySelector('.show-more-arrow')).textContent = '▲'; }
        /** @type {HTMLElement} */ (document.getElementById('hoursShowMoreLabel')).textContent = 'Hide adjustments';
      } else if (!hasExtras && extraBody && extraBody.classList.contains('open')) {
        extraBody.classList.remove('open');
        if (extraBtn) { extraBtn.classList.remove('open'); /** @type {HTMLElement} */ (extraBtn.querySelector('.show-more-arrow')).textContent = '▼'; }
        /** @type {HTMLElement} */ (document.getElementById('hoursShowMoreLabel')).textContent = 'Unusual deductions or corrections';
      }
      updateSaveStatus(pNum);
      calculate();
      // Refresh the roster hint bar AFTER the new period's field values are written. onPeriodChange
      // calls updateRosterHint() BEFORE loadPeriodData, so without this the hint would compare the new
      // period's calendar suggestion against the PREVIOUS period's entered hours until a fetch resolved
      // (and stay stale on a base-only member or a cancelled fetch). Display-only; always safe.
      updateRosterHint();
    }

    /** @param {number} pNum */
    function updateSaveStatus(pNum) {
      const el  = /** @type {HTMLElement} */ (document.getElementById('saveStatus'));
      const raw = lsGet(periodKey(pNum));
      if (raw) {
        const { data: d, error } = parseSavedPeriod(raw);
        if (error) {
          // Saved data exists but can't be read — say so, don't masquerade as "No entries saved"
          // (the user would type over the damaged blob without knowing it held anything) (v16.70).
          el.textContent = "⚠ Couldn't read this period's saved entries — anything you type will replace them";
          el.className   = 'save-status corrupt';
          return;
        }
        if (d) {
          const _pObj = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
          const _defaultPension = _pObj
            ? parseFloat((getPensionDefault(_pObj) * getProRateFactor(_pObj)).toFixed(2))
            : getPensionDefault();
          const _hasCustomPension = d.pension != null && Math.abs(d.pension - _defaultPension) > 0.005;
          if (!isDataEmpty(d) || _hasCustomPension) {
            el.textContent = '✓ Entries saved for this period';
            el.className   = 'save-status saved';
            return;
          }
        }
      }
      el.textContent = 'No entries saved for this period';
      el.className   = 'save-status unsaved';
    }

    const _clearState = /** @type {{ pending: boolean, timer: ReturnType<typeof setTimeout> | null, countdownTimer: ReturnType<typeof setInterval> | null }} */ ({ pending: false, timer: null, countdownTimer: null });

    // Disarm the two-tap "tap again to confirm" clear. Called on tab-hide AND on period change
    // (v16.84): without the period-change reset, arming Clear on period A then switching to B left
    // the confirm live, so ONE tap of Clear on B wiped B with no confirm.
    function _resetClearConfirm() {
      if (!_clearState.pending) return;
      clearTimeout(_clearState.timer ?? undefined);
      clearInterval(_clearState.countdownTimer ?? undefined);
      _clearState.pending = false;
      _clearState.timer = null;
      _clearState.countdownTimer = null;
      const btn = document.getElementById('clearBtn');
      if (btn) { btn.textContent = 'Clear all entries'; btn.classList.remove('confirming'); }
    }
    // iOS suspends timers when a tab is backgrounded; on resume the queued setTimeout fires
    // immediately, which could turn the "Tap again to confirm" prompt into an accidental wipe.
    document.addEventListener('visibilitychange', () => { if (document.hidden) _resetClearConfirm(); });

    function clearPeriod() {
      const btn = /** @type {HTMLElement | null} */ (document.getElementById('clearBtn'));
      if (!_clearState.pending) {
        _clearState.pending = true;
        let secs = 3;
        if (btn) { btn.textContent = `Tap again to confirm (${secs})`; btn.classList.add('confirming'); }
        // Countdown tick every second
        _clearState.countdownTimer = setInterval(() => {
          secs--;
          if (secs > 0 && btn) btn.textContent = `Tap again to confirm (${secs})`;
        }, 1000);
        _clearState.timer = setTimeout(() => {
          clearInterval(_clearState.countdownTimer ?? undefined);
          _clearState.pending = false;
          if (btn) { btn.textContent = 'Clear all entries'; btn.classList.remove('confirming'); }
        }, 3000);
        return;
      }
      clearTimeout(_clearState.timer ?? undefined);
      clearInterval(_clearState.countdownTimer ?? undefined);
      _clearState.pending = false;
      if (btn) { btn.textContent = 'Clear all entries'; btn.classList.remove('confirming'); }
      const pNum = currentPeriodNum();
      lsDel(periodKey(pNum));
      lsDel(snapKey(pNum));
      // Mark the form as user-touched BEFORE blanking it: programmatic .value writes never fire
      // the delegated 'input' listener, so without this an override fetch already in flight when
      // the user confirmed the clear would resolve, see the flag unset, and refill + autosave the
      // just-cleared fields — silently undoing an explicit destructive action (v16.69 review fix).
      _hoursTouchedSinceFetch = true;
      writeFormData(emptyPeriodData());
      // Apply the period-specific pension default (pro-rated for joining periods, rate-cut-over
      // aware) — writeFormData no longer does this when d.pension is null.
      const _clearP = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
      if (_clearP) {
        const _pa = /** @type {HTMLInputElement | null} */ (document.getElementById('pensionAmt'));
        if (_pa) _pa.value = (getPensionDefault(_clearP) * getProRateFactor(_clearP)).toFixed(2);
      }
      _adjNegative = false;
      updateAdjSign();
      updateSaveStatus(pNum);
      calculate();
      // Clearing blanks the fields programmatically — refresh the roster card so
      // rows don't keep showing ✓ matched against now-empty fields.
      updateRosterHint();
    }

    // clearRosterSuggestedAll, updateRosterHint, updateJoinerNotice, toggleRosterDays,
    // fillCategoryFromRoster, fillFromRoster, _applyRosterSuggestion,
    // _restoreRosterSuggested, snapKey imported from paycalc-roster-hint.js.
    // settingsKey, saveSettings, confirmSettings, setSettingsCardOpen, loadSettings
    // imported from paycalc-settings.js.

    // Cached output of the last bdBody render — avoids the parse+layout cost of
    // innerHTML when the rendered string is identical. Summary has two write paths
    // (estimated + Miller actual override) so it is not cached.
    /** @type {string | null} */
    let _lastBdBodyHtml = null;

    // ── CALCULATION ENGINE ────────────────────────────────────────────────────────
    /** @param {number} rate */
    function updateBadges(rate) {
      /** @type {function(number, any): string} */
      const f = (r, mult) => `${mult}×  ·  £${(rate * r).toFixed(2)}/hr`;
      /** @type {HTMLElement} */ (document.getElementById('badge-sat')).textContent = f(RATE_125, '1.25');
      /** @type {HTMLElement} */ (document.getElementById('badge-bh')).textContent   = f(RATE_125, '1.25');
      /** @type {HTMLElement} */ (document.getElementById('badge-bhot')).textContent = f(RATE_125, '1.25');
      /** @type {HTMLElement} */ (document.getElementById('badge-ot')).textContent   = f(RATE_125, '1.25');
      /** @type {HTMLElement} */ (document.getElementById('badge-rdw')).textContent = f(RATE_125, '1.25');
      /** @type {HTMLElement} */ (document.getElementById('badge-sun')).textContent = f(RATE_150, '1.5');
      /** @type {HTMLElement} */ (document.getElementById('badge-box')).textContent = f(RATE_300, '3');
    }

    /**
     * Render the proportional pay breakdown bar and legend above the summary rows.
     * @param {number} gross
     * @param {number} pension
     * @param {number} tax
     * @param {number} ni
     * @param {number} sl
     * @param {number} net
     */
    function updateBreakBar(gross, pension, tax, ni, sl, net) {
      const bar    = document.getElementById('payBreakBar');
      const legend = document.getElementById('payBreakLegend');
      if (!bar || !legend || !(gross > 0)) {
        bar?.classList.remove('pbb-visible');
        legend?.classList.remove('pbb-visible');
        return;
      }
      bar.classList.add('pbb-visible');
      legend.classList.add('pbb-visible');

      const pct = /** @param {number} v */ v => ((v / gross) * 100).toFixed(2);
      const fmtPct = /** @param {number} v */ v => `${((v / gross) * 100).toFixed(0)}%`;

      const segs = [
        { id: 'pbbPension', cls: 'pbb-pension', val: pension, label: 'Pension', legendId: 'pblPension', dotCls: 'pbl-dot pbb-pension' },
        { id: 'pbbTax',     cls: 'pbb-tax',     val: tax,     label: 'Tax',     legendId: 'pblTax',     dotCls: 'pbl-dot pbb-tax' },
        { id: 'pbbNI',      cls: 'pbb-ni',      val: ni,      label: 'NI',      legendId: 'pblNI',      dotCls: 'pbl-dot pbb-ni' },
        { id: 'pbbSL',      cls: 'pbb-sl',      val: sl,      label: 'Student loan', legendId: 'pblSL', dotCls: 'pbl-dot pbb-sl' },
        { id: 'pbbNet',     cls: 'pbb-net',     val: net,     label: 'Take-home', legendId: 'pblNet',   dotCls: 'pbl-dot pbb-net' },
      ];

      bar.innerHTML    = segs.filter(s => s.val > 0).map(s =>
        `<div class="pbb-seg ${s.cls}" style="flex-grow:${pct(s.val)}" title="${s.label} ${fmtPct(s.val)}"></div>`
      ).join('');
      legend.innerHTML = segs.filter(s => s.val > 0).map(s =>
        `<span class="pbl-item"><span class="${s.dotCls}"></span>${s.label} <strong>${fmtPct(s.val)}</strong></span>`
      ).join('');
    }

    function calculate() {
      // Resolve thresholds for the selected period's tax year
      const _pNum   = currentPeriodNum();
      const _curP   = getPeriods().find(/** @param {any} x */ x => x.num === _pNum);
      if (!_curP) return;
      const _ty     = taxYearForPeriod(_curP);
      const thresholds = getThresholds(_ty.label);
      const _proRateFactor = getProRateFactor(_curP);
      const LONDON = (_curP ? getLondonAllowanceForPeriod(_curP, _ty) : _ty.londonAllow) * _proRateFactor;

      const _calcGrade = getGrade();
      const _calcDefaultRate = GRADES[_calcGrade]?.rate ?? GRADES.cea.rate;
      // Math.max floor: a negative typed rate would produce a nonsense negative estimate with
      // neither rateWarn branch firing. Zero/empty still falls back to the grade default via ||.
      const rate = Math.max(0, numVal('hourlyRate')) || _calcDefaultRate;
      const _rateWarn = document.getElementById('rateWarn');
      if (_rateWarn) {
        if (numVal('hourlyRate') > 100)
          _rateWarn.textContent = `⚠ Looks like a typo — did you mean £${(numVal('hourlyRate') / 100).toFixed(2)}/hr?`;
        else if (numVal('hourlyRate') > 0 && numVal('hourlyRate') < 15)
          _rateWarn.textContent = '⚠ Rate seems low — double-check your payslip';
        else
          _rateWarn.textContent = '';
      }
      updateBadges(rate);
      const r125 = rate * RATE_125;
      const r150 = rate * RATE_150;
      const r300 = rate * RATE_300;
      const peer = +(/** @type {HTMLElement} */ (document.getElementById('peerVal'))).textContent;

      const satHrs  = hhmmDec('satH',  'satM');
      // Guard: only count BH/Boxing hours if this period actually contains those days.
      // localStorage can restore saved values into hidden rows, so we must sanitise here
      // rather than relying solely on the DOM row being hidden.
      const _hasBh = hasBankHoliday(_curP);
      const bhHrs   = _hasBh ? hhmmDec('bhH',   'bhM')   : 0;
      const bhOtHrs = _hasBh ? hhmmDec('bhOtH', 'bhOtM') : 0;
      const oHrs    = hhmmDec('otH',   'otM');
      const rHrs    = hhmmDec('rdwH',  'rdwM');
      const sHrs    = hhmmDec('sunH',  'sunM');
      const bHrs    = hasBoxingDay(_curP)   ? hhmmDec('boxH',  'boxM')   : 0;

      const _effContr = getEffectiveContr(_curP);
      const _adjRaw   = Math.abs(numVal('otherAdj') || 0);
      const otherAdj  = _adjNegative ? -_adjRaw : _adjRaw;

      // Pure gross calculation — all DOM reads done; no more DOM access until UI writes below
      const { gross, satCapped, bhCapped, nonBhNorm,
              gBasicNorm, gBasicSat, gBankHol, gBhOt, gOvertime,
              gRdw, gSunday, gBoxing, gPeer } = computeGross({
        effContr: _effContr, rate, satHrs, bhHrs, bhOtHrs, oHrs, rHrs, sHrs, bHrs,
        peerDays: peer, otherAdj, london: LONDON,
      });

      // Add back pay if this is the paid-in period AND the member ticked "add to take-home"
      // (opt-in, OFF by default — the card computes/show the lump either way).
      const _bpThisPeriod = (_bpPNum > 0 && _bpPNum === _pNum && _bpIncluded) ? _bpAmount : 0;

      // Add HPP estimate/actual if this is the January period where HPP is paid.
      // Finds the tax year whose hppPaidJan matches this period's payday year.
      // The estimate is pre-computed by calcHPP() and stored in localStorage whenever
      // the user views any period in that tax year — by end of April it is essentially final.
      const _hppTy = _curP ? CONFIG.TAX_YEARS.find(t =>
          _curP.payday.getFullYear() === t.hppPaidJan && _curP.payday.getMonth() === 0
      ) : null;
      // A CONFIRMED actual (present in storage, even £0) beats the estimate — resolveHppForPeriod
      // is the single source of that rule (a confirmed £0 correctly adds nothing; the pre-v17.26
      // `actual > 0` test kept silently adding the stale estimate to take-home). Shared with the
      // prior-year card display so the two can't diverge.
      const _hppRes = _hppTy
          ? resolveHppForPeriod(lsGet(hppActualKey(_hppTy)), lsGet(hppEstKey(_hppTy)))
          : { amount: 0, isEstimate: false, hasActual: false };
      const _hppAmount     = _hppRes.amount;      // the HPP figure landing on this January payslip
      const _hppIsEstimate = _hppRes.isEstimate;
      // OPT-IN, mirroring back pay (v17.29): the premium only JOINS the take-home when the member
      // ticks "Add this to your January payslip's take-home" on the HPP card (off by default, per
      // tax year). Until then it is shown as an informational "could land here" banner and is NOT
      // added — so an unconfirmed estimate never silently inflates the January take-home.
      const _hppIncluded   = !!_hppTy && lsGet(hppIncKey(_hppTy)) === '1';
      const _hppForPeriod  = _hppIncluded ? _hppAmount : 0;

      const grossWithBp = gross + _bpThisPeriod + _hppForPeriod;

      // Pension — salary sacrifice: deducted from gross before tax and NI are calculated.
      // A BLANK field means "use this period's default" (matching the null convention in
      // readFormData/loadPeriodData), NOT £0 — otherwise clearing the field to retype it would show
      // take-home momentarily inflated by the whole pension amount. A typed "0" still means opted-out.
      const _pField    = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));
      // parseSmartFloatOrNull distinguishes GARBAGE (a lone "." / "-" mid-edit → null) from a real
      // typed "0" (v16.84). Garbage or empty falls back to the period DEFAULT — NOT £0, which would
      // overstate take-home by the whole pension while the field was transiently unparseable. A typed
      // "0" is a genuine opt-out and is kept. Math.max(0, …): a pasted negative would add untaxed
      // headroom (sacGross = gross − pension) and inflate take-home — floor it like the hour fields.
      const _pRaw      = _pField && _pField.value.trim() !== '' ? parseSmartFloatOrNull(_pField.value) : null;
      const pension    = _pRaw != null
          ? Math.max(0, _pRaw)
          : (_curP ? parseFloat((getPensionDefault(_curP) * getProRateFactor(_curP)).toFixed(2)) : getPensionDefault());
      const pensionWarn = document.getElementById('pensionWarn');
      if (pensionWarn) pensionWarn.classList.toggle('show', pension > grossWithBp && pension > 0);
      const sacGross   = Math.max(0, grossWithBp - pension);

      // Income tax — cumulative PAYE when YTD figures provided (W1/M1/X excluded)
      // Pass null (not 0) when the field is empty so computeTax distinguishes "not provided" from "£0 entered"
      const ytdPayEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ytdPay'));
      const ytdTaxEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ytdTax'));
      // Garbage (NaN) falls back to null too — a stray character means "not usable", not "£0 YTD",
      // so tax quietly stays non-cumulative rather than asserting a £0 year-to-date figure.
      const ytdP = (ytdPayEl?.value ?? '').trim() !== '' ? numValOr('ytdPay', null) : null;
      // Mirror the ytdPay guard — pass null (not 0) when blank so computeTax treats
      // "ytdPay filled, ytdTax left blank" as incomplete rather than "£0 tax collected".
      const ytdT = (ytdTaxEl?.value ?? '').trim() !== '' ? numValOr('ytdTax', null) : null;
      const periodN = _curP ? (_curP.num - 48) - _ty.first + 1 : null;
      const { tax, usingCumulative } = computeTax(
        sacGross, /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value, thresholds,
        { ytdPay: ytdP, ytdTax: ytdT, periodN },
      );

      // NI and Student Loan (both on sacGross — salary sacrifice reduces all three bases)
      const ni = computeNI(sacGross, thresholds.ni);

      // Plan 5 is not repayable before 2026/27 — disable the option on a 2025/26 period so it can't be
      // newly picked. thresholds.sl has no plan5 key for 2025/26 (paycalc-calc.js), so availability
      // follows the data. A pre-existing plan5 selection is NOT reset (it stays valid for 2026/27
      // periods): it computes £0 here and is explained in the row below, not silently reinterpreted.
      const _slSel    = /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan'));
      const _plan5Allowed = !!(/** @type {Record<string, any>} */ (thresholds.sl)).plan5;
      const _plan5Opt = /** @type {HTMLOptionElement|null} */ (_slSel.querySelector('option[value="plan5"]'));
      if (_plan5Opt) _plan5Opt.disabled = !_plan5Allowed;

      const plan   = _slSel.value;
      const pgLoan = /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked;
      const slSkip = /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked;
      // The "not deducted this period" skip + its row apply to whichever loan(s) are active.
      /** @type {HTMLElement} */ (document.getElementById('slSkipRow')).classList.toggle('hidden', plan === 'none' && !pgLoan);
      // One undergraduate plan AND a Postgraduate Loan can be repaid together — HMRC deducts each
      // independently (9% above the plan threshold; 6% above the £21,000 PGL threshold). The TOTAL feeds
      // net + the break bar; the summary shows a separate line per active loan.
      const slUnder = computeSL(sacGross, plan, thresholds.sl, slSkip);
      const slPost  = pgLoan ? computeSL(sacGross, 'postgrad', thresholds.sl, slSkip) : 0;
      const sl = slUnder + slPost;

      const net = sacGross - tax - ni - sl;

      // Student/Postgraduate Loan summary lines — never silent when a loan is active (v16.77 clarity).
      // ONE shared builder so the plan and PGL rows can't drift: the PGL row previously lost the
      // "just above threshold → repayment rounds under £1" branch and wrongly said "under the
      // threshold" for pay that was ABOVE it (v17.20 fix). Per-loan states: a deduction; £0 because
      // Plan 5 isn't repayable this year; £0 genuinely under the threshold; or £0 because pay only just
      // exceeds the threshold so the 9%/6% rounds under £1 (v16.84 — "under the threshold" is wrong there).
      const _slPlanLabel = _slSel.selectedOptions[0]?.textContent?.trim() ?? plan;
      const _slThreshold = (/** @type {Record<string, any>} */ (thresholds.sl))[plan]?.t;
      const _pgThreshold = (/** @type {Record<string, any>} */ (thresholds.sl)).postgrad?.t;
      /** One summary line for a loan: amount>0 → deduction row; else a NAMED £0 reason (or '' if inactive).
       * @param {string} rowLabel @param {number} amount @param {boolean} active @param {string} planLabel
       * @param {number|undefined} threshold @param {string|null} notAvailableMsg */
      const _slLine = (rowLabel, amount, active, planLabel, threshold, notAvailableMsg) => {
        if (amount > 0)       return `<div class="sum-row sum-ded"><span class="lbl">${rowLabel}</span><span class="val">−${fmt(amount)}</span></div>`;
        if (!active)          return '';
        if (notAvailableMsg)  return `<div class="sum-row sum-sl-zero"><span class="lbl">${rowLabel} — ${notAvailableMsg}</span><span class="val">£0.00</span></div>`;
        if (threshold != null) return sacGross > threshold
          ? `<div class="sum-row sum-sl-zero"><span class="lbl">${rowLabel} — no deduction: your repayment is under £1 this period (pay only just exceeds the ${planLabel} threshold, ${fmt(threshold)})</span><span class="val">£0.00</span></div>`
          : `<div class="sum-row sum-sl-zero"><span class="lbl">${rowLabel} — no deduction: pay after pension is under the ${planLabel} threshold (${fmt(threshold)} per period)</span><span class="val">£0.00</span></div>`;
        return '';
      };
      // The per-period "not deducted" skip governs BOTH loans → ONE combined row (was two identical
      // rows), matching the single breakdown line below.
      const slLines = (slSkip && (plan !== 'none' || pgLoan))
        ? `<div class="sum-row sum-sl-zero"><span class="lbl">Student loan — marked as not deducted this period</span><span class="val">£0.00</span></div>`
        : _slLine('Student Loan', slUnder, plan !== 'none', _slPlanLabel, _slThreshold,
                  plan === 'plan5' && !_plan5Allowed ? `Plan 5 is not repayable in ${_ty.label} (repayments begin April 2026)` : null)
          + _slLine('Postgraduate Loan', slPost, pgLoan, 'Postgraduate Loan', _pgThreshold, null);

      updateBreakBar(grossWithBp, pension, tax, ni, sl, net);

      // UI
      /** @type {HTMLElement} */ (document.getElementById('netDisplay')).textContent = fmt(net);
      /** @type {HTMLElement} */ (document.getElementById('pensionRef')).textContent = pension.toFixed(2);
      /** @type {HTMLElement} */ (document.getElementById('payslipNote')).style.display = 'block';
      /** @type {HTMLElement} */ (document.getElementById('absenceCaveat')).style.display = 'block';

      /** @type {HTMLElement} */ (document.getElementById('summary')).innerHTML = `
        ${(_bpThisPeriod > 0 || _hppForPeriod > 0)
          ? `<div class="sum-row"><span class="lbl">Regular pay</span><span class="val">${fmt(gross)}</span></div>
             ${_bpThisPeriod > 0 ? `<div class="sum-row sum-bp"><span class="lbl">Back pay lump sum (pay award${_bpIsEstimate ? ' — estimate' : ''})</span><span class="val">+${fmt(_bpThisPeriod)}</span></div>` : ''}
             ${_hppForPeriod > 0 ? `<div class="sum-row sum-hpp"><span class="lbl">Holiday Pay Premium${_hppIsEstimate ? ' <span class="sum-est">(estimated)</span>' : ''}</span><span class="val">+${fmt(_hppForPeriod)}</span></div>` : ''}
             <div class="sum-row sum-gross"><span class="lbl">Total pay</span><span class="val">${fmt(grossWithBp)}</span></div>`
          : `<div class="sum-row sum-gross"><span class="lbl">Total pay</span><span class="val">${fmt(gross)}</span></div>`}
        ${pension > 0 ? `<div class="sum-row sum-ded"><span class="lbl">Pension contribution</span><span class="val">−${fmt(pension)}</span></div>` : ''}
        ${pension > 0 ? `<div class="sum-row sum-gross"><span class="lbl">Pay after pension deduction</span><span class="val">${fmt(sacGross)}</span></div>` : ''}
        <div class="sum-row sum-ded"><span class="lbl">Income Tax${usingCumulative ? ' <span style="font-size:var(--type-micro);font-weight:400;color:var(--text-faint);margin-left:4px">adjusted from payslip</span>' : ''}</span><span class="val">−${fmt(tax)}</span></div>
        <div class="sum-row sum-ded"><span class="lbl">National Insurance</span><span class="val">−${fmt(ni)}</span></div>
        ${slLines}
        <div class="sum-row sum-net"><span class="lbl">Estimated take-home pay${_bpThisPeriod > 0 && _hppForPeriod > 0 ? ` (inc. ${_bpIsEstimate ? 'estimated ' : ''}back pay & HPP)` : _bpThisPeriod > 0 ? ` (inc. ${_bpIsEstimate ? 'estimated ' : ''}back pay)` : _hppForPeriod > 0 ? ` (inc. ${_hppIsEstimate ? 'estimated ' : ''}HPP)` : ''}</span><span class="val">${fmt(net)}</span></div>
      `;

      const fh = /** @param {number} h */ h => {
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
        bd += `<div class="bd-row"><span class="b-lbl">Bank Holiday Overtime (${fh(bhOtHrs)} × ${fmt(r125)})</span><span class="b-val">${fmt(gBhOt)}</span></div>`;
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
      if (slSkip && (plan !== 'none' || pgLoan))
        bd += `<div class="bd-row"><span class="b-lbl" style="font-style:italic;color:var(--text-faint)">Student loan not deducted this period</span><span class="b-val"></span></div>`;
      if (usingCumulative)
        bd += `<div class="bd-row"><span class="b-lbl" style="font-style:italic;color:var(--text-faint)">Tax adjusted using Year to Date figures from your last payslip</span><span class="b-val"></span></div>`;
      if (_bpThisPeriod > 0)
        bd += `<div class="bd-row bd-extra"><span class="b-lbl">Back pay lump sum (pay award${_bpIsEstimate ? ' — estimate' : ''})</span><span class="b-val">+${fmt(_bpThisPeriod)}</span></div>`;
      if (_hppForPeriod > 0)
        bd += `<div class="bd-row bd-extra"><span class="b-lbl">Holiday Pay Premium${_hppIsEstimate ? ' (estimated)' : ''}</span><span class="b-val">+${fmt(_hppForPeriod)}</span></div>`;
      if (bd !== _lastBdBodyHtml) {
        /** @type {HTMLElement} */ (document.getElementById('bdBody')).innerHTML = bd;
        _lastBdBodyHtml = bd;
      }

      // ── G. Miller actual payslip override (device-local, v14.69) ────────────────
      // If G. Miller is logged in and this period has DEVICE-LOCAL payslip data
      // (readPayslipActuals — imported once per device, never served), show the
      // actual figures; the breakdown below still shows the estimate for comparison.
      const _actualKey  = _curP ? formatISO(_curP.payday) : null;
      const _actual     = _actualKey && isActualsDev(getLoggedMember())
        ? readPayslipActuals()[_actualKey] : null;
      const _netLabel   = document.getElementById('netLabel');

      if (_actual) {
        if (_netLabel) _netLabel.textContent = '✅ Your Actual Take-Home Pay';
        /** @type {HTMLElement} */ (document.getElementById('netDisplay')).textContent = fmt(_actual.net);
        /** @type {HTMLElement} */ (document.getElementById('payslipNote')).style.display   = 'none';
        /** @type {HTMLElement} */ (document.getElementById('absenceCaveat')).style.display = 'none';
        /** @type {HTMLElement} */ (document.getElementById('summary')).innerHTML = `
          <div class="sum-row sum-gross"><span class="lbl">Total pay</span><span class="val">${fmt(_actual.gross)}</span></div>
          <div class="sum-row sum-ded"><span class="lbl">Income Tax</span><span class="val">−${fmt(_actual.tax)}</span></div>
          <div class="sum-row sum-ded"><span class="lbl">National Insurance</span><span class="val">−${fmt(_actual.ni)}</span></div>
          ${_actual.sl > 0 ? `<div class="sum-row sum-ded"><span class="lbl">Student Loan</span><span class="val">−${fmt(_actual.sl)}</span></div>` : ''}
          <div class="sum-row sum-net"><span class="lbl">Actual take-home</span><span class="val">${fmt(_actual.net)}</span></div>
          <div class="sum-row" style="border-top:1px solid var(--border-light);margin-top:6px;padding-top:6px;font-size:var(--type-small);color:var(--text-faint)">
            <span class="lbl">Calculator estimate</span><span class="val">${fmt(net)}</span>
          </div>
        `;
        /** @type {HTMLElement} */ (document.getElementById('bdBtn')).innerHTML =
          `Compare with estimate &nbsp;<span class="bd-arrow">▼</span>`;
        const _stickyAmt = document.getElementById('stickyAmount');
        if (_stickyAmt) _stickyAmt.textContent = fmt(_actual.net);
        // Keep the sticky label honest — this figure is the confirmed actual, not an estimate.
        const _stickyLbl = document.getElementById('stickyLabel');
        if (_stickyLbl) _stickyLbl.textContent = '✅ Actual take-home';
      } else {
        const _suffix = _bpThisPeriod > 0 && _hppForPeriod > 0 ? `inc. ${_bpIsEstimate ? 'est. ' : ''}back pay & HPP`
            : _bpThisPeriod > 0  ? `inc. ${_bpIsEstimate ? 'est. ' : ''}back pay`
            : _hppForPeriod > 0  ? `inc. HPP${_hppIsEstimate ? ' estimate' : ''}`
            : null;
        if (_netLabel) _netLabel.textContent = _suffix
            ? `💷 Estimated Take-Home Pay (${_suffix})`
            : '💷 Estimated Take-Home Pay';
        const _stickyAmt = document.getElementById('stickyAmount');
        if (_stickyAmt) _stickyAmt.textContent = fmt(net);
        const _stickyLbl = document.getElementById('stickyLabel');
        if (_stickyLbl) _stickyLbl.textContent = _suffix
            ? `💷 Estimated take-home (${_suffix})`
            : '💷 Estimated take-home';
        /** @type {HTMLElement} */ (document.getElementById('bdBtn')).innerHTML =
          `Full pay breakdown &nbsp;<span class="bd-arrow">▼</span>`;
      }

      // BACK-PAY banner (on the paid-in payslip). Fixed structure in the HTML: text · opt-in tick
      // (#bpBannerTick, proxies the hidden card tick) · "view back pay card" link · accuracy note.
      // Two states: opted-in → "✓ Includes …"; available but not → "ℹ️ could land here — not added".
      const _bpBannerEl = document.getElementById('bpActiveBanner');
      if (_bpBannerEl) {
        const _bpAvailableHere = _bpPNum > 0 && _bpPNum === _pNum && _bpAmount > 0;
        if (_bpAvailableHere) {
          /** @type {HTMLElement} */ (document.getElementById('bpBannerText')).textContent = _bpThisPeriod > 0
            ? `✓ Includes ${_bpIsEstimate ? 'estimated ' : ''}back pay lump sum of ${fmt(_bpThisPeriod)}`
            // Confirmed award → the lump DOES land on this payslip (definite); an unconfirmed
            // estimate stays hedged ("could land"). Either way it's opt-in (not added unless ticked).
            : _bpIsEstimate
              ? `ℹ️ Estimated back pay lump sum of ${fmt(_bpAmount)} could land on this payslip — not added to this estimate`
              : `ℹ️ Your back pay lump sum of ${fmt(_bpAmount)} will land on this payslip — not added to this estimate`;
          /** @type {HTMLInputElement} */ (document.getElementById('bpBannerTick')).checked = _bpIncluded;
          const _bpAprilYr = _bpAwardTaxYear(_backdatedFromPNum()).label.slice(0, 4);
          /** @type {HTMLElement} */ (document.getElementById('bpBannerNote')).textContent =
            `For the best estimate, fill in your hours on each payslip back to 1 April ${_bpAprilYr}.`;
          _bpBannerEl.style.display = '';
        } else {
          _bpBannerEl.style.display = 'none';
        }
      }

      // HPP banner (on the January payslip the premium lands). Same fixed structure + opt-in tick
      // (#hppBannerTick, toggles the per-year hppIncKey flag directly). Available = a January payslip
      // with an HPP figure; Included = opted in. Two states mirror back pay.
      const _hppBannerEl = document.getElementById('hppActiveBanner');
      if (_hppBannerEl) {
        const _hppAvailableHere = !!_hppTy && _hppAmount > 0;
        if (_hppAvailableHere) {
          /** @type {HTMLElement} */ (document.getElementById('hppBannerText')).textContent = _hppForPeriod > 0
            ? `✓ Includes ${_hppIsEstimate ? 'estimated ' : ''}Holiday Pay Premium of ${fmt(_hppAmount)}`
            : `ℹ️ ${_hppIsEstimate ? 'Estimated' : 'A'} Holiday Pay Premium of ${fmt(_hppAmount)} could land on this payslip — not added to this estimate`;
          const _hppTick = /** @type {HTMLInputElement} */ (document.getElementById('hppBannerTick'));
          _hppTick.checked = _hppIncluded;
          _hppTick.dataset.year = _hppTy.label;   // so the once-wired change listener targets the right year
          // Second line: only once opted-in AND still an estimate — prompt to confirm from the payslip.
          /** @type {HTMLElement} */ (document.getElementById('hppBannerNote')).textContent =
            (_hppForPeriod > 0 && _hppIsEstimate)
              ? 'When your payslip arrives, enter the confirmed Holiday Pay Premium on the HPP card to replace this estimate.'
              : '';
          _hppBannerEl.style.display = '';
        } else {
          _hppBannerEl.style.display = 'none';
        }
      }

      // calcHPP takes no back-pay input: the HPP already prices every period of the year at the
      // settled (post-award) rate, so the lump's variable portion is already reflected — feeding
      // _bpVarAmount in as well double-counted it (v16.89). The tick still adds the lump to
      // _bpThisPeriod's take-home above.
      calcHPP();
    }

    // isDataEmpty, calcHPP, updatePriorHpp imported from paycalc-hpp.js.
    // _decodeHours, _varPayForPeriod are in paycalc-hpp.js but only imported by paycalc-backpay.js.

    // ── BACK PAY STATE WRAPPERS ───────────────────────────────────────────────────
    // prefillBackPay, calcBackPay, _bpAwardTaxYear imported from paycalc-backpay.js.
    // calcBackPay() returns { bpAmount, bpVarAmount, bpPNum } — this wrapper
    // compares against coordinator state and calls calculate() if changed.
    /** @param {{ bpAmount: any, bpPNum: any, bpIsEstimate?: boolean, bpIncluded?: boolean }} _
     *  (calcBackPay also returns bpVarAmount; it is intentionally not tracked since v16.89 — the HPP
     *  no longer consumes it, and any change to it moves bpAmount too, so recalc detection is intact.) */
    function _applyBpState({ bpAmount, bpPNum, bpIsEstimate = false, bpIncluded = false }) {
      if (bpPNum !== _bpPNum ||
          bpIsEstimate !== _bpIsEstimate ||
          bpIncluded   !== _bpIncluded   ||
          Math.abs(bpAmount    - _bpAmount)    > 0.001) {
        _bpAmount     = bpAmount;
        _bpPNum       = bpPNum;
        _bpIsEstimate = bpIsEstimate;
        _bpIncluded   = bpIncluded;
        calculate();
      }
    }
    function _runCalcBackPay() { _applyBpState(calcBackPay()); }

    /**
     * "Pay rise %" shortcut: when a percentage is entered, fill the New rate/London from
     * Old × (1 + %). A convenience only — the New boxes stay editable, and leaving the % blank
     * keeps them fully manual. Re-runs whenever the % or either Old figure changes.
     */
    // Last values we auto-filled into the New rate/London boxes, so _applyBpRisePct can tell a
    // still-auto value (safe to refresh) from one the user has hand-corrected (must not clobber).
    let _bpAutoNewR = '', _bpAutoNewL = '';
    function _applyBpRisePct() {
      const pct = numVal('bpRisePct');
      if (pct > 0) {
        const newREl = /** @type {HTMLInputElement} */ (document.getElementById('newRateInput'));
        const newLEl = /** @type {HTMLInputElement} */ (document.getElementById('newLondon'));
        const newR = raiseByPercent(numVal('oldRate'),   pct);
        const newL = raiseByPercent(numVal('oldLondon'), pct);
        // Only fill a New box that is blank or still holds our last auto value — never overwrite
        // a figure the user hand-corrected to their payslip. (The old code re-filled New on every
        // Old-field or % edit, clobbering a manual correction.)
        if (newR && (newREl.value === '' || newREl.value === _bpAutoNewR)) { newREl.value = newR.toFixed(2); _bpAutoNewR = newREl.value; }
        if (newL && (newLEl.value === '' || newLEl.value === _bpAutoNewL)) { newLEl.value = newL.toFixed(2); _bpAutoNewL = newLEl.value; }
      }
      _runCalcBackPay();
    }

    // Prefill + recompute the back-pay card for the currently-selected award year. Called on card
    // open AND from onPeriodChange when the card is open (so switching tax years re-prefills rates).
    function _refreshBackPayCard() {
      _applyBpState(prefillBackPay());
      _applyBpRisePct();
    }

    // Sync the back-pay card to the VIEWED award year (v17.86 per-year viewing): restore that year's
    // own saved blob, or — when it has none — prefill its default (compute for the current award,
    // enter-from-payslip for a prior one). Runs at init AND on every period change so the banner +
    // take-home reflect whichever payslip is on screen. Per-year keys (bpKey(ty)) mean switching
    // years loads the right state instead of resetting the tick — the fix that lets the card follow
    // the viewed period again (the reason v16.91 pinned it).
    function _syncBackPayForViewedYear() {
      if (restoreBpState()) {
        // Re-seed the "these New values were AUTO-derived from %" markers so _applyBpRisePct doesn't
        // clobber hand-edits (see v16.23 note in the old init block).
        const _rv = /** @param {string} id */ id => /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ?? '';
        const _pct = parseFloat(_rv('bpRisePct'));
        if (_pct > 0) {
          const dR = raiseByPercent(parseFloat(_rv('oldRate'))   || 0, _pct);
          const dL = raiseByPercent(parseFloat(_rv('oldLondon')) || 0, _pct);
          if (dR && _rv('newRateInput') === dR.toFixed(2)) _bpAutoNewR = _rv('newRateInput');
          if (dL && _rv('newLondon')    === dL.toFixed(2)) _bpAutoNewL = _rv('newLondon');
        }
        _runCalcBackPay();
      } else {
        _refreshBackPayCard();
      }
    }

    function toggleBpBreakdown() {
      const btn  = /** @type {HTMLElement} */ (document.getElementById('bpBreakdownBtn'));
      const body = /** @type {HTMLElement} */ (document.getElementById('backPayRows'));
      const open = btn.classList.toggle('open');
      body.classList.toggle('open', open);
      // Drive max-height from the actual rendered height so a long back-pay breakdown (many
      // periods, or large text/zoom) is never clipped by the fixed CSS `.bd-body.open` cap.
      // Cleared on close so the CSS collapse (max-height:0) animates the panel shut.
      body.style.maxHeight = open ? `${body.scrollHeight}px` : '';
      btn.setAttribute('aria-expanded', String(open));
    }

    // (applyNewRate removed v17.90 — the Settings hourly rate is now grade-fixed + auto-derived, so
    // there was nothing to push into settings; the button it drove was already permanently hidden.)

    // ── HPP FORMULA NOTE TOGGLE ───────────────────────────────────────────────────
    // ── HOURS SHOW MORE TOGGLE ────────────────────────────────────────────────────
    function toggleHoursExtra() {
      const btn  = /** @type {HTMLElement} */ (document.getElementById('hoursShowMore'));
      const body = /** @type {HTMLElement} */ (document.getElementById('hoursExtra'));
      const open = body.classList.toggle('open');
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      /** @type {HTMLElement} */ (btn.querySelector('.show-more-arrow')).textContent = open ? '▲' : '▼';
      /** @type {HTMLElement} */ (document.getElementById('hoursShowMoreLabel')).textContent = open
        ? 'Hide adjustments'
        : 'Unusual deductions or corrections';
    }

    function toggleHppNote() {
      const btn  = /** @type {HTMLElement} */ (document.getElementById('hppToggleBtn'));
      const body = /** @type {HTMLElement} */ (document.getElementById('hppNoteBody'));
      const open = body.classList.toggle('open');
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      /** @type {HTMLElement} */ (btn.querySelector('.hpp-toggle-arrow')).textContent = open ? '▲' : '▼';
      /** @type {HTMLElement} */ (document.getElementById('hppToggleBtnLabel')).textContent = open ? 'Hide calculation details ' : 'How is this calculated? ';
    }

    // ── DISCLAIMER TOGGLE ─────────────────────────────────────────────────────────
    function toggleDisclaimer() {
      const extra  = /** @type {HTMLElement} */ (document.getElementById('disclaimerExtra'));
      const toggle = /** @type {HTMLElement} */ (document.getElementById('disclaimerToggle'));
      const open   = extra.classList.toggle('open');
      toggle.textContent = open ? 'Less ▲' : 'More ▼';
      toggle.setAttribute('aria-expanded', String(open));
    }

    // ── PEER STEPPER ──────────────────────────────────────────────────────────────
    /** @param {number} delta */
    function stepPeer(delta) {
      const el = /** @type {HTMLElement} */ (document.getElementById('peerVal'));
      el.textContent = String(Math.max(0, Math.min(10, +(/** @type {HTMLElement} */ (document.getElementById('peerVal'))).textContent + delta)));
      autosave();
    }

    // ── BREAKDOWN TOGGLE ──────────────────────────────────────────────────────────
    function toggleBD() {
      const btn  = /** @type {HTMLElement} */ (document.getElementById('bdBtn'));
      const open = btn.classList.toggle('open');
      /** @type {HTMLElement} */ (document.getElementById('bdBody')).classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    }

    // ── INIT ──────────────────────────────────────────────────────────────────────
    runMigrations({ getPeriods, getLoggedMember, getPensionDefault });

    // Clamp the visible period range for a member who only started this tax year — they should
    // not see earlier tax years ("from this year onwards"). Must run BEFORE the tabs + period
    // select are built (both read the clamp). Secondment returns (noProRate) and long-serving
    // staff are unaffected.
    setEarliestVisiblePeriod(getLoggedMember());

    // Tax-year quick-jump tabs — generated from TAX_YEARS so the April rollover only
    // touches paycalc-calc.js (no hand-edited tab markup). Must run before
    // buildPeriodSelect() + onPeriodChange(): updateTyTabs looks the tabs up by id.
    // Tax years before a new starter's join year are skipped (their tab is never built);
    // the id stays `tyTab${i}` at the ORIGINAL index so updateTyTabs/jumpToTaxYear still align.
    (function buildTyTabs() {
      const wrap = document.getElementById('tyTabs');
      if (!wrap) return;
      CONFIG.TAX_YEARS.forEach((ty, i) => {
        if (!isTaxYearVisible(ty)) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ty-tab';
        b.id = `tyTab${i}`;
        b.textContent = ty.label;
        b.addEventListener('click', () => jumpToTaxYear(i, onPeriodChange));
        wrap.appendChild(b);
      });
    })();

    // Grade hint — rates interpolated from GRADES so the April pay award is a
    // one-place update (paycalc-calc.js), not a hunt through hardcoded HTML copy.
    (function fillGradeRateHint() {
      const el = document.getElementById('gradeRateHint');
      if (!el) return;
      el.textContent = 'CEA = Customer Experience Ambassador · CES = Customer Experience Supervisor. '
        + `Your grade sets your hourly rate below. CEA: £${GRADES.cea.rate.toFixed(2)}/hr · CES: £${GRADES.ces.rate.toFixed(2)}/hr.`;
    })();

    loadSettings();
    // _defaultPeriodNum must be assigned BEFORE onPeriodChange() runs — the period
    // button visibility check is `pNum === _defaultPeriodNum`. buildPeriodSelect()
    // returns the default period number; we then call onPeriodChange() explicitly so
    // the button is correctly hidden on the initial load (not shown as if off-default).
    _defaultPeriodNum = buildPeriodSelect();
    onPeriodChange();

    // Back-pay at init: onPeriodChange() above already synced the card to the opening period's award
    // year (restore its saved blob, else prefill its default) via _syncBackPayForViewedYear — so the
    // estimated/actual lump shows on the right payslip without the member ever opening the card. No
    // separate init restore is needed now the sync runs on every period change (v17.86).

    // ── EVENT LISTENERS (no inline handlers in HTML — roster-app convention) ──────

    // Period navigation
    /** @type {HTMLElement} */ (document.getElementById('periodSelect')).addEventListener('change', onPeriodChange);
    /** @type {HTMLElement} */ (document.getElementById('prevBtn')).addEventListener('click', () => prevPeriod(onPeriodChange));
    /** @type {HTMLElement} */ (document.getElementById('nextBtn')).addEventListener('click', () => nextPeriod(onPeriodChange));
    /** @type {HTMLElement} */ (document.getElementById('todayPeriodBtn')).addEventListener('click', () => {
      const sel = document.getElementById('periodSelect');
      _setSelectPeriod(sel, _defaultPeriodNum);
      onPeriodChange();
    });
    /** @type {HTMLElement} */ (document.getElementById('clearBtn')).addEventListener('click', clearPeriod);

    // Result breakdown toggle
    /** @type {HTMLElement} */ (document.getElementById('bdBtn')).addEventListener('click', toggleBD);

    // Roster day list toggle
    /** @type {HTMLElement} */ (document.getElementById('rosterDaysToggle')).addEventListener('click', toggleRosterDays);

    // In-flight-edit tracking: any genuine user input inside the Hours card marks the period
    // as "user is editing", so a late background override-fetch won't overwrite it (see
    // onPeriodChange). Delegated + on 'input', so programmatic .value fills never trip it.
    /** @type {HTMLElement|null} */ (document.getElementById('hoursCard'))?.addEventListener('input', () => { _hoursTouchedSinceFetch = true; });

    // Hours inputs — Saturday (has validation warn)
    /** @type {HTMLElement} */ (document.getElementById('satH')).addEventListener('input', () => { onHhMm('satH','satM','satWarn'); autosave(); });
    /** @type {HTMLElement} */ (document.getElementById('satM')).addEventListener('input', () => { clampMins('satM'); onHhMm('satH','satM','satWarn'); autosave(); });

    // Hours inputs — minutes clamp + autosave
    ['bhH','bhOtH','otH','rdwH','sunH','boxH'].forEach(/** @param {string} id */ id => {
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('input', autosave);
    });
    ['bhM','bhOtM','otM','rdwM','sunM','boxM'].forEach(/** @param {string} id */ id => {
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('input', () => { clampMins(id); autosave(); });
    });

    // Decimal auto-correction — if someone types "7.5" into an hours field, split it
    // into 7h 30m on blur instead of silently truncating to 7. A live "= 7h 30m"
    // preview shows while typing so the on-blur split is never a silent surprise.
    HM_PAIRS.forEach(({ hId: h, mId: m }) => {
      /** @type {HTMLElement} */ (document.getElementById(h)).addEventListener('input', () => decPreview(h));
      /** @type {HTMLElement} */ (document.getElementById(h)).addEventListener('blur', () => autoDecimalHours(h, m));
    });

    // Peer training stepper
    /** @type {HTMLElement} */ (document.getElementById('peerMinus')).addEventListener('click', () => stepPeer(-1));
    /** @type {HTMLElement} */ (document.getElementById('peerPlus')).addEventListener('click',  () => stepPeer(1));

    // Back-pay inputs. New fields: a manual edit just recalcs. Old fields + the "Pay rise %"
    // shortcut: re-derive the New figures from Old × (1 + %) when a % is present, then recalc.
    ['newRateInput','newLondon'].forEach(/** @param {string} id */ id => {
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('input', _runCalcBackPay);
    });
    ['oldRate','oldLondon','bpRisePct'].forEach(/** @param {string} id */ id => {
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('input', _applyBpRisePct);
    });
    // Amount-source toggle + manual amount (v17.86): flipping the mode shows/hides the field group
    // and recomputes; typing the manual figure recomputes.
    document.getElementsByName('bpMode').forEach(/** @param {any} r */ r =>
      r.addEventListener('change', () => { applyBpMode(); _runCalcBackPay(); }));
    document.getElementById('bpManualAmt')?.addEventListener('input', _runCalcBackPay);

    // Card collapse toggles — shared initCardCollapse (overlay.js) adds keyboard +
    // aria-expanded support. Passing the header id as the chevron id toggles .open
    // on the header itself, which drives the .card-toggle-arrow rotation in CSS.
    initCardCollapse('settingsToggle',    'settingsBody',    'settingsToggle');
    initCardCollapse('payslipCardToggle', 'payslipCardBody', 'payslipCardToggle');
    initCardCollapse('hppCardToggle',     'hppCardBody',     'hppCardToggle');
    initCardCollapse('backPayCardToggle', 'backPayBody',     'backPayCardToggle',
      /** @param {any} open */ open => {
        if (!open) return;
        // prefillBackPay fills the rate boxes for the selected award year; _applyBpRisePct then
        // derives the New rate/London from any defaulted "Pay rise %" (unconfirmed award). Shared
        // with onPeriodChange so a year switch while open re-prefills.
        _refreshBackPayCard();
      });

    // Back-pay inputs + period selectors + apply rate
    /** @type {HTMLElement} */ (document.getElementById('bpBreakdownBtn')).addEventListener('click', toggleBpBreakdown);
    /** @type {HTMLElement} */ (document.getElementById('backPayPeriod')).addEventListener('change', _runCalcBackPay);
    /** @type {HTMLElement} */ (document.getElementById('bpIncludeTick')).addEventListener('change', _runCalcBackPay);
    /** @type {HTMLElement} */ (document.getElementById('saveSettingsBtn')).addEventListener('click', () => confirmSettings(calculate));

    // Hours card — show more toggle
    /** @type {HTMLElement} */ (document.getElementById('hoursShowMore')).addEventListener('click', toggleHoursExtra);

    // (The Hours-header "result peek" button was removed at v16.78 — the #stickyTotal bar
    //  below carries the same live figure and the same tap-to-scroll to the result card.)

    // Sticky take-home bar — show when result card is off-screen on mobile
    (function () {
      const stickyBar  = document.getElementById('stickyTotal');
      const resultCard = document.querySelector('.result-card');
      if (!stickyBar || !resultCard || !('IntersectionObserver' in window)) return;
      // v16.12: no desktop skip — the bar runs at every width now. On desktop it backstops
      // the footer rows below the sticky col-3 result rail (v16.14): the rail keeps the live
      // figure visible across the work area, the bar covers the scroll past it.
      // Defensive single-init guard. init() runs exactly once (paycalc-boot.js), and a bfcache
      // restore THAWS the frozen document rather than re-executing module code — so this IIFE
      // does NOT re-run on a Back/Forward restore. The guard only matters if init() is ever
      // wired to run twice. An IntersectionObserver survives the bfcache freeze/thaw intact,
      // so there is deliberately NO pagehide-disconnect: a prior version disconnected the
      // observer on navigate-away and, because the IIFE never re-runs, nothing reconnected it —
      // after any Back/Forward restore the sticky bar froze over the footer for the rest of
      // the session (v16.19).
      if (stickyBar.dataset.obsInit) return;
      stickyBar.dataset.obsInit = '1';
      // Observe the £ amount display specifically, not the whole card.
      // threshold:0 fires when it fully leaves the viewport. Show the bar whenever the figure is
      // OFF-SCREEN IN EITHER DIRECTION (v16.69): the old `top < 0` guard ("scrolled off the top
      // only") was written for the pre-v16.67 DOM where the result sat ABOVE Hours — after the
      // v16.67 move (result below Hours on mobile) it suppressed the bar for the entire
      // hours-entry session, exactly when the live figure is most needed. Below-the-fold on load
      // now deliberately SHOWS the bar — that is the feature: the take-home stays visible while
      // entering hours above it.
      const netDisplay = document.getElementById('netDisplay') || resultCard;
      // rAF wrapper prevents class-toggle flicker during iOS momentum scroll, where
      // IntersectionObserver can fire repeatedly within a single frame.
      const obs = new IntersectionObserver(([entry]) => {
        requestAnimationFrame(() => {
          const show = !entry.isIntersecting;
          stickyBar.classList.toggle('visible', show);
          document.body.classList.toggle('sticky-active', show);
        });
      }, { threshold: 0, rootMargin: '-8px 0px 0px 0px' });
      obs.observe(netDisplay);
      // Hide the sticky bar while the iOS soft keyboard is up, otherwise it covers
      // the field the user is typing into. visualViewport shrinks when the keyboard
      // appears; a >150px drop is a reliable keyboard signal.
      if (window.visualViewport) {
        const _vv = window.visualViewport;
        let _inputFocused = false;
        let _baseVVH = _vv.height;

        document.addEventListener('focusin', e => {
          _inputFocused = /^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {Element} */ (e.target).tagName);
        });

        document.addEventListener('focusout', () => {
          _inputFocused = false;
          // Defer BOTH the keyboard-up removal AND the baseline rebase behind the same
          // !_inputFocused check. Moving directly from one field to the next fires
          // focusout→focusin, so an input is refocused before this timer runs and the soft
          // keyboard never actually goes down — meaning no visualViewport 'resize' fires to
          // re-add keyboard-up. Removing the class UNCONDITIONALLY on focusout therefore
          // re-showed the bar floating over the keyboard/active field the moment you tabbed
          // between hours fields, for the rest of the typing session (v16.19). Rebasing
          // _baseVVH here (only when the keyboard is genuinely down) is the pre-existing guard.
          // (Both are conservative — they can only skip a bad update. Needs real-iOS
          // verification: visualViewport keyboard behaviour can't be reproduced in headless/e2e.)
          setTimeout(() => {
            if (!_inputFocused) {
              stickyBar.classList.remove('keyboard-up');
              _baseVVH = _vv.height;
            }
          }, 300);
        });

        _vv.addEventListener('resize', () => {
          // Touch devices only (checked at event time): this heuristic detects the SOFT
          // keyboard. On desktop (v16.12 — the bar runs there too) a >120px window-height
          // shrink with an input focused (window resize, docked DevTools) is not a
          // keyboard and must not hide the bar.
          const keyboardUp = window.matchMedia('(pointer: coarse)').matches
              && _inputFocused && (_baseVVH - _vv.height) > 120;
          stickyBar.classList.toggle('keyboard-up', keyboardUp);
        }, { passive: true });
      }
      stickyBar.addEventListener('click', () =>
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' })
      );
      stickyBar.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); // Space must not also scroll the page
          resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    })();

    // Roster fill — "Fill blank fields" button + per-category "Fill →" buttons
    const _fillBtn = document.getElementById('fillFromRosterBtn');
    if (_fillBtn) _fillBtn.addEventListener('click', () => fillFromRoster(autosave));

    // Per-category fill buttons are dynamically rendered inside #rosterRows — use delegation
    document.getElementById('rosterRows')?.addEventListener('click', e => {
      const _eTarget = /** @type {Element} */ (e.target);
      const catBtn = _eTarget.closest('[data-cat]');
      if (catBtn) { fillCategoryFromRoster(/** @type {HTMLElement} */ (catBtn).dataset.cat || '', autosave); return; }
      if (_eTarget.closest('[data-action="focus-ot"]')) {
        const el = document.getElementById('otH');
        if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }
    });

    // Remove roster-suggested highlight and refresh comparison state as user edits hours
    document.querySelectorAll(HM_PAIRS.flatMap(p => ['#' + p.hId, '#' + p.mId]).join(',')).forEach(el => {
      el.addEventListener('input', () => {
        el.classList.remove('roster-suggested');
        updateRosterHint();
      });
    });

    // Tax year tab listeners are attached when the tabs are generated (see INIT).

    // Settings inputs
    /** @type {HTMLElement} */ (document.getElementById('gradeSelect')).addEventListener('change', () => {
      // Preserve hand-entered values: only replace the rate / pension if they still
      // hold the PREVIOUS grade's default (i.e. the user hasn't customised them).
      // The app explicitly asks staff to enter their exact payslip rate, so tapping
      // the grade (e.g. just to check it) must not silently wipe that figure.
      // lsGet(SK.grade) still holds the previous grade until saveSettings() runs.
      const _oldGrade = lsGet(SK.grade);
      const _gP = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());

      const _pa = /** @type {HTMLInputElement | null} */ (document.getElementById('pensionAmt'));
      const _oldPenDefault = (_oldGrade && GRADES[_oldGrade] && _gP)
        ? (getPensionForPeriod(_oldGrade, _gP.payday) * getProRateFactor(_gP)).toFixed(2)
        : '';
      const penUntouched = !_pa || _pa.value.trim() === '' || _pa.value === _oldPenDefault;

      saveSettings(); // calls invalidateGrade() so getGrade() returns the new grade below
      // The hourly rate is grade-fixed + read-only (v17.87) — refresh the period-aware rate for the
      // newly-selected grade (never a typed value); updateRateForPeriod also updates its pre/post label.
      if (_gP) updateRateForPeriod(taxYearForPeriod(_gP), _gP);
      if (_pa && penUntouched) _pa.value = (getPensionDefault(_gP) * getProRateFactor(_gP)).toFixed(2);
      calculate();
    });
    // No #hourlyRate listener — the rate is read-only and grade-derived (v17.87).
    /** @type {HTMLElement} */ (document.getElementById('taxCode')).addEventListener('input',     () => { saveSettings(); calculate(); });
    /** @type {HTMLElement} */ (document.getElementById('studentLoan')).addEventListener('change', () => {
      // Clear the "not deducted this period" skip only when NO loan is active (plan none AND no PGL) —
      // a Postgraduate Loan on its own still uses the skip row.
      const _pg = /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked;
      if (/** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value === 'none' && !_pg) {
        /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked = false;
      }
      saveSettings();
      autosave(); // persists the cleared slSkip flag; autosave() calls calculate() internally
    });
    // Postgraduate Loan flag — a SETTING (like the plan), repayable ALONGSIDE a plan. Reveal the
    // "not deducted this period" row when either loan is active; the toggle is handled in calculate().
    /** @type {HTMLElement} */ (document.getElementById('pgLoanCheck')).addEventListener('change', () => {
      const _slNone = /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value === 'none';
      if (_slNone && !(/** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked)) {
        /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked = false;
      }
      saveSettings();
      autosave();
    });
    // pensionAmt: save global default AND lock pension to current period immediately.
    // autosave() calls calculate() internally, so no separate calculate() call needed.
    /** @type {HTMLElement} */ (document.getElementById('pensionAmt')).addEventListener('input',  () => { saveSettings(); autosave(); });

    // Per-period overrides
    /** @type {HTMLElement} */ (document.getElementById('slSkipCheck')).addEventListener('change', autosave);
    /** @type {HTMLElement} */ (document.getElementById('otherAdj')).addEventListener('input', () => {
      // If the user manually typed a negative number, honour it: set the sign flag
      // and normalise the field to the absolute value so the ± button is authoritative.
      const _adjEl = /** @type {HTMLInputElement} */ (document.getElementById('otherAdj'));
      const raw = _adjEl.value;
      const v   = parseSmartFloat(raw);
      if (v < 0) {
        _adjNegative = true;
        // Normalise to the bare absolute value (String, NOT toFixed) so multi-digit typing
        // isn't corrupted: toFixed('-1')→'1.00' left the caret after '.00', so continuing to
        // type "-150" built '1.0050' (saved −1.005). String(abs) → '1' → '15' → '150' (saved −150).
        _adjEl.value = String(Math.abs(v));
      }
      // Positive typed value: leave _adjNegative alone — the ± button is authoritative.
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
        const input = /** @type {HTMLInputElement} */ (document.getElementById('otherAdj'));
        const val   = parseSmartFloat(input.value);
        // Only negate the value when it is nonzero — when zero, the button marks
        // intent so the next number typed will be shown as negative.
        if (val !== 0) input.value = Math.abs(val).toFixed(2);
        updateAdjSign();
        autosave();
      }
      const btn = /** @type {HTMLElement} */ (document.getElementById('adjSignBtn'));
      let touchFired = false;
      // passive:false is required so preventDefault() actually suppresses the
      // synthesised click — iOS treats touchend as passive by default.
      btn.addEventListener('touchend', (e) => { e.preventDefault(); touchFired = true; toggleAdjSign(); }, { passive: false });
      btn.addEventListener('click', () => { if (touchFired) { touchFired = false; return; } toggleAdjSign(); });
    })();

    // Payslip card inputs
    /** @type {HTMLElement} */ (document.getElementById('ytdPay')).addEventListener('input',    () => { saveSettings(); calculate(); });
    /** @type {HTMLElement} */ (document.getElementById('ytdTax')).addEventListener('input',    () => { saveSettings(); calculate(); });

    // Prior year HPP actual — saves to per-year key and refreshes the prior HPP section display.
    // Commit on `change` (fires on blur / keyboard "done"), NOT `input` (v17.26): committing per
    // keystroke made typing "843" flash "✓ Confirmed £8.00" mid-entry, and a mid-edit select-all
    // then a stray character (or an abandoned edit) silently DELETED a previously-confirmed figure
    // — the estimate then resurfaced in the January take-home. On blur the final value commits once.
    /** @type {HTMLElement} */ (document.getElementById('priorHppActualInput')).addEventListener('change', () => {
      const pNum  = currentPeriodNum();
      const curP  = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
      const curTy = taxYearForPeriod(curP);
      const tyIdx = CONFIG.TAX_YEARS.findIndex(t => t.label === curTy.label);
      if (tyIdx <= 0) return;
      const priorTy = CONFIG.TAX_YEARS[tyIdx - 1];
      // Store a CLEAN numeric string, not the raw field value (v16.84): a payslip-style
      // "1,200" or "£350" stored verbatim was later read with parseFloat → 1 / NaN. Smart-parse
      // (strips commas/£/smart-punctuation) then toFixed, mirroring how hppEst is stored. A blank
      // field clears the actual (lsDel); a genuine 0 is a valid confirmed figure. Negatives clamp
      // to 0 — a payslip HPP can't be negative.
      const _v = parseSmartFloatOrNull(/** @type {HTMLInputElement} */ (document.getElementById('priorHppActualInput')).value);
      if (_v != null) {
        lsSet(hppActualKey(priorTy), Math.max(0, _v).toFixed(2));
      } else {
        lsDel(hppActualKey(priorTy));
      }
      updatePriorHpp(curTy);
    });

    // HPP opt-in tick — lives IN the January-payslip banner (#hppBannerTick). The per-year flag it
    // controls is stamped on the checkbox's data-year during render, so this once-wired listener
    // always targets the correct tax year (the one whose HPP lands on the viewed payslip).
    document.getElementById('hppBannerTick')?.addEventListener('change', () => {
      const tick = /** @type {HTMLInputElement} */ (document.getElementById('hppBannerTick'));
      const yr = tick.dataset.year;
      const ty = CONFIG.TAX_YEARS.find(/** @param {any} t */ t => t.label === yr);
      if (!ty) return;
      if (tick.checked) lsSet(hppIncKey(ty), '1'); else lsDel(hppIncKey(ty));
      calculate();
    });
    // Back-pay opt-in tick in its banner — proxies the (hidden) card state-holder #bpIncludeTick,
    // reusing its full persist/recompute flow. And the two banners' "view … card" links.
    document.getElementById('bpBannerTick')?.addEventListener('change', () => {
      const src = /** @type {HTMLInputElement} */ (document.getElementById('bpBannerTick'));
      const dst = /** @type {HTMLInputElement} */ (document.getElementById('bpIncludeTick'));
      dst.checked = src.checked;
      dst.dispatchEvent(new Event('change', { bubbles: true }));
    });
    /** @param {string} cardId @param {string} bodyId @param {string} toggleId */
    const _bannerViewCard = (cardId, bodyId, toggleId) => {
      if (!document.getElementById(bodyId)?.classList.contains('open')) {
        /** @type {HTMLElement} */ (document.getElementById(toggleId))?.click();
      }
      document.getElementById(cardId)?.scrollIntoView({ behavior: 'smooth' });
    };
    document.getElementById('bpBannerViewLink')?.addEventListener('click', () => _bannerViewCard('backPayCard', 'backPayBody', 'backPayCardToggle'));
    document.getElementById('hppBannerViewLink')?.addEventListener('click', () => _bannerViewCard('hppCard', 'hppCardBody', 'hppCardToggle'));

    // HPP formula toggle + disclaimer + back-pay cross-link
    /** @type {HTMLElement} */ (document.getElementById('hppToggleBtn')).addEventListener('click', toggleHppNote);
    /** @type {HTMLElement} */ (document.getElementById('disclaimerToggle')).addEventListener('click', toggleDisclaimer);
    /** @type {HTMLElement} */ (document.getElementById('hppBackPayLink')).addEventListener('click', () => {
      const body = document.getElementById('backPayBody');
      // Route through the header click so initCardCollapse keeps aria-expanded in
      // sync and runs the open-time pre-fill.
      if (body && !body.classList.contains('open')) /** @type {HTMLElement} */ (document.getElementById('backPayCardToggle')).click();
      /** @type {HTMLElement} */ (document.getElementById('backPayCard')).scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // ── LIGHTBOXES — About, Help, Welcome, YTD notice, Decimal converter ──────────
    // All five lightboxes delegated to paycalc-lightboxes.js; returns the About
    // open handle so the nav-panel drawer logo can open the same panel.
    const { openAboutLightbox } = initPaycalcLightboxes();

    // ── SW UPDATE AUTO-ACTIVATION ─────────────────────────────────────────────────
    // Handled by the shared registerServiceWorker() call below (see "SERVICE WORKER").
    // A hand-rolled duplicate of that lifecycle used to live here; it was removed at
    // v12.96 because running both registered two controllerchange listeners and two
    // hourly update() timers, which could fire the post-update reload twice.

    // ── SERVICE WORKER ────────────────────────────────────────────────────────────
    registerServiceWorker();

    // Establish the Firebase Auth session BEFORE starting error reporting. A valid
    // 30-day localStorage session can outlive the Firebase Auth session (cleared or
    // lost), in which case clientErrors writes fail the `request.auth != null` rule
    // and are silently dropped — exactly when we most want the report. Mirrors the
    // admin/settings/operations pages. Error reporter starts regardless of the
    // outcome so synchronous init errors are still captured locally.
    (function _initErrorReporting() {
      const name = getSession()?.name;
      const afterAuth = () => { initErrorReporter(); recordUsage('paycalc', name ?? null); recordPageLatency('paycalc', name ?? null); };
      // SOFT enforcement (B1.2), now decided via the policy (ARCHITECTURE_PLAN.md Phase 7): the pay
      // calculator is localStorage-based and writes no isolated data, so a degraded/anonymous session
      // must NEVER block it. requirePage('paycalc') honours that — being `soft`, it returns ONLY 'allow'
      // (named confirmed) or 'soft-allow' (Firebase identity unconfirmed), never 'login'/'forbidden'. We
      // only log when the requirement is on AND the store reports 'soft-allow' (the member's own session
      // wasn't confirmed) — equivalent to the old `!named`. The store is fed by the Phase-2 bridge inside
      // ensureNamedSession, so getAuthSnapshot() reflects the terminal identity here. (ROSTER_CONFIG is
      // roster-data's CONFIG, imported as ROSTER_CONFIG to avoid the paycalc-periods CONFIG clash.)
      if (name) ensureNamedSession(name)
          .then(() => { if (ROSTER_CONFIG.ENFORCE_NAMED_SESSION && requirePage(getAuthSnapshot(), 'paycalc').decision === 'soft-allow') console.warn('[Auth] paycalc running without a named session — error reporting may not record.'); })
          .catch(() => {/* reporter still starts below */})
          .finally(afterAuth);
      else afterAuth();
    }());

    // ── PRINT HEADER STAMP ────────────────────────────────────────────────────────
    // iOS Safari does not fire beforeprint when AirPrint is invoked, so we also stamp
    // eagerly on load. The beforeprint handler is kept for desktop browsers.
    // onPeriodChange() also calls this so the stamp is always current when printing.
    function stampPaycalcPrintLine() {
      const hdr = document.querySelector('.app-header');
      if (!hdr) return;
      const periodSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('periodSelect'));
      const p = periodSel ? getPeriods().find(/** @param {any} x */ x => x.num === +periodSel.value) : null;
      const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      const label = p ? `Period P${payslipPeriodNum(p)} · Paid ${fdShort(p.payday)} · Printed ${now}` : `MYB Pay Calculator · Printed ${now}`;
      hdr.setAttribute('data-print-line', label);
    }
    stampPaycalcPrintLine();
    window.addEventListener('beforeprint', stampPaycalcPrintLine);

    const _paycalcMember = getLoggedMember();
    initNavPanel({
        currentPage: 'paycalc',
        memberName:  _paycalcMember?.name || null,
        isAdmin:         ROSTER_CONFIG.ADMIN_NAMES.includes(_paycalcMember?.name ?? ''),
        isLinksDesigner: ROSTER_CONFIG.LINKS_DESIGNERS.includes(_paycalcMember?.name ?? ''),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut:   _paycalcMember ? () => {
            clearSession(); // clears localStorage AND signs out Firebase Auth
            window.location.href = './';
        } : null,
    });

    // (Lightbox print button is wired by about-lightbox.js — the standalone IIFE
    // that lived here before v12.50 only removed .open, leaving body scroll locked.)

}
