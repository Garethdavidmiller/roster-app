// @ts-check
/**
 * paycalc-app.js — Pay Calculator coordinator for paycalc.html.
 *
 * Owns: onPeriodChange, calculate, autosave, WHEN a period is saved and loaded, INIT, event wiring.
 * Does NOT own: period arithmetic and the Year to Date source rules (paycalc-periods.js), grade,
 *   settings and the rate (paycalc-settings.js), the roster hint bar (paycalc-roster-hint.js), HPP
 *   (paycalc-hpp.js), back pay (paycalc-backpay.js), pay maths (paycalc-calc.js), HOW a field
 *   persists (paycalc-form-data.js), the result card's markup (paycalc-breakdown.js) and the
 *   sticky take-home bar (paycalc-sticky-total.js).
 * A new RULE belongs in one of those, not here — coordinator-ratchet.test.mjs holds this file's size.
 *
 * The body is an exported init(), called by paycalc-boot.js (CSP `script-src 'self'` blocks inline
 * module scripts), so importing this module runs nothing and the sign-in gate can early-`return`.
 */

import { initSelectSheets } from './select-sheet.js';
import { CONFIG as ROSTER_CONFIG, formatISO, parseSmartFloat, parseSmartFloatOrNull } from './roster-data.js';
import { printedStamp, formatClock } from './date-format.js';
import {
  GRADES, RATE_125, RATE_150, RATE_300,
  getTaxYearForOffset, taxYearForPeriod, getThresholds, getLondonAllowanceForPeriod,
  computeGross, computeTax, computeNI, computeSL, getPensionForPeriod, takeHomePay,
} from './paycalc-calc.js';
import { resetOverrides, fetchOverridesForPeriod, getRosterSuggestion } from './paycalc-roster-suggestions.js';
import { lsGet, lsSet, lsDel, lsKeys, lsAvailable, requestPersistentStorage } from './ls.js';
import { getSession, ensureNamedSession, reconcileExpiredIdentity } from './session.js';
import { requirePage, canOpenOvertime, canOpenNewlink } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { paintRoleCard, PAYCALC_SIGN_IN_ABOUT } from './paycalc-role-card.js';
import { signOutAndLeave, reloadIfRestoredForSomeoneElse } from './page-session.js';
import {
  CONFIG, getPeriods, currentPeriodNum, todaysPeriodNum, payslipPeriodNum,
  hasBoxingDay, hasBankHoliday,
  updateBhRows, buildPeriodSelect,
  updateTyTabs, jumpToTaxYear, prevPeriod, nextPeriod,
  setEarliestVisiblePeriod, isTaxYearVisible, visiblePeriods,
  _setSelectPeriod, buildYtdSourceSelect, ytdSourceToStamp, ytdSourceAfterRetype, ytdAnchorStatus, payslipMayBeInHand, ytdUpdateFrom,
  appendPayslipOptions,
} from './paycalc-periods.js';
import {
  getGrade, getEffectiveContr, getLoggedMember, getProRateFactor, getPensionDefault,
  applyPensionOptOutUI, wirePensionControls, gradeForRole, periodDefaultPension,
  updateRateForPeriod, updateYtdForTaxYear, settingsKey, setSettingsCardOpen,
  saveSettings, confirmSettings, loadSettings, periodRate, wireSettingsCard,
} from './paycalc-settings.js';
import {
  updateRosterHint, updateJoinerNotice, toggleRosterDays,
  fillCategoryFromRoster, fillFromRoster, _applyRosterSuggestion,
  clearRosterSuggestedAll, _restoreRosterSuggested, snapKey, HM_PAIRS,
} from './paycalc-roster-hint.js';
import { isDataEmpty, calcHPP, commitPriorHppActual, resolveHppForPeriod, applyHppMode, restoreHppState, saveHppState } from './paycalc-hpp.js';
import { prefillBackPay, calcBackPay, restoreBpState, _bpAwardTaxYear, _backdatedFromPNum, raiseByPercent, applyBpMode } from './paycalc-backpay.js';
import { hppTaxYearForPayslip } from './paycalc-hpp-schedule.js';
import { initNavPanel } from './nav-panel.js';
import { initCardCollapse, createLightbox, openCardNamedByHash } from './overlay.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady, clearLoginStart } from './perf-reporter.js';
import { SK, pcPrefix, periodKey, hppEstKey, hppActualKey, hppIncKey, ytdSrcKey, runMigrations, readPayslipActuals, isActualsDev, parseSavedPeriod } from './paycalc-migrations.js';
import { initPaycalcLightboxes } from './paycalc-lightboxes.js';
import { fd, fdShort, fdLong, fmt, minutesFieldText } from './paycalc-format.js';
import { initYearCard, renderYearCard } from './paycalc-year-card.js';
import { numVal, numValOr, hhmmDec, clampMins, _decHintEl, decPreview, wireIosTap, commitFocusedField, paintTaxCodeWarning, hoursTextToHM } from './paycalc-inputs.js';
import { emptyPeriodData, readFormData, writeFormData, settingFieldsWrite } from './paycalc-form-data.js';
import { initTransferCard } from './paycalc-transfer-card.js';
import { classifyPayKey } from './paycalc-inventory.js';
import { buildSummaryRows, buildLoanLines, buildBreakdownRows, buildActualCheck, buildActualComparison, buildProvChips, buildBreakBar } from './paycalc-breakdown.js';

import { setStatus } from './status-text.js';
import { renderResultHeadline, renderYtdLine, wireYtdLine } from './paycalc-result-headline.js';
import { backPayBannerCopy, hppBannerCopy, paintBanner } from './paycalc-money-banner.js';
import { initPaycalcStickyTotal } from './paycalc-sticky-total.js';

/**
 * Withhold the calculator from a role it has no confirmed rates for, and say why.
 * Rationale: `gradeForRole`'s JSDoc (roster-data.js). Two things an editor here needs — it WITHHOLDS rather than
 * captioning (the page's whole output is one confident £ figure, and a member told "this may not
 * apply" and handed one will use it), and it still wires the drawer, so it is a refusal with a way
 * out rather than a dead end.
 * @param {any} member the signed-in teamMembers entry
 */
function _showUnsupportedRole(member) {
    // A BODY CLASS, never the `hidden` attribute: `.pc-work`/`.pc-side` are `display: contents` on
    // mobile and `flex` on desktop, both of which out-specify `hidden`'s UA rule, so the
    // calculator would render in full while this code believed it was gone. See paycalc.css.
    document.body.classList.add('role-unsupported');
    document.getElementById('unsupportedGradeBanner')?.classList.remove('hidden');
    paintRoleCard(member);   // the words differ by who is reading — paycalc-role-card.js
    initNavPanel({
        currentPage: 'paycalc',
        memberName:  member?.name || null,
        isAdmin:         ROSTER_CONFIG.ADMIN_NAMES.includes(member?.name ?? ''),
        isLinksDesigner: ROSTER_CONFIG.LINKS_DESIGNERS.includes(member?.name ?? ''),
        canOpenOvertime: canOpenOvertime(member?.name ?? ''), canOpenNewlink: canOpenNewlink(member?.name ?? ''),
        onSignOut: () => signOutAndLeave({ to: './' }),
    });
    markPageReady();
    recordUsage('paycalc', member?.name || null);
}

export function init() {
    // BACK/FORWARD CACHE ON A SHARED DEVICE: a page restored from the bfcache does not re-run init(),
    // so after a sign-out (or another member signing in on another tab) Back could show the previous
    // member's pay page, figures and all. page-session.js's guard runs FIRST, so no early return
    // below (sign-in, unsupported role) can skip it.
    reloadIfRestoredForSomeoneElse();
    registerServiceWorker();   // BEFORE the sign-in gate, as Operations/Links: a signed-out view must still take an update
    // Tear down a lingering privileged Firebase identity whose local session has expired, so a direct
    // deep-link here can't keep an old credential live — BEFORE the session guard's early return, as
    // the expired path is exactly where one lingers. Fire-and-forget and login-safe: a no-op on a
    // valid session, and it stands down if a sign-in supersedes it.
    reconcileExpiredIdentity().catch(() => {});

    // ── SESSION GUARD (local-identity precondition) ───────────────────────────────
    // Not signed in → the shared in-place sign-in (no redirect elsewhere). getSession() (session.js)
    // enforces the 60-day absolute expiry — a raw localStorage read would treat an expired session as
    // valid forever. The early return halts the rest of init() while the overlay is shown.
    //
    // DELIBERATELY NOT routed through requirePage('paycalc') (AUTH_ARCHITECTURE.md Phase 7): the
    // policy is `soft`, which by its tested invariant NEVER returns 'login', but the calculator needs a
    // member identity to namespace its per-member storage (pcPrefix/SK), so a *local name* is a hard
    // precondition, stricter than the policy. `soft` governs only the Firebase confirmation
    // (_initErrorReporting below). "Simplifying" this into requirePage would render with no identity.
    if (!getSession()?.name) {
      // On success, re-invoke init() in place — the body below never ran on this pass, so it runs
      // once with the just-saved session, and runMigrations() selects the right namespace for free
      // (AUTH_ARCHITECTURE.md Phase 9). If init() throws mid-wiring it falls back to a reload, so the
      // in-place path is never less robust than the reload one; and it reloads (a fresh overlay)
      // rather than re-enter a soft-lock when saveSession silently failed (iOS private mode).
      const onSuccess = () => { try { if (!getSession()?.name) { window.location.reload(); return; } init(); } catch { window.location.reload(); } };
      initLoginOverlay({ pageLabel: 'Pay Calculator', onSuccess, about: PAYCALC_SIGN_IN_ABOUT });
      return;
    }
    // In-place sign-in: remove the still-mounted overlay if we re-entered via onSuccess. No-op on a
    // normal already-signed-in load (no overlay present).
    dismissLoginOverlay();

    // A ROLE WITH NO CONFIRMED RATES REFUSES RATHER THAN GUESSING: the grade lookup treats "no grade
    // stored" as CEA at every consumer, so every Dispatcher and manager account was handed a polished
    // estimate at somebody else's rate. Before every other init step, so nothing can render a figure
    // first. Why: `gradeForRole`'s JSDoc (roster-data.js).
    //
    // A SESSION NAME THE ROSTER DOES NOT HOLD REFUSES TOO: a leaver or a renamed
    // member keeps a valid local session, `getLoggedMember()` returns null, and a null used to skip
    // this check — so the calculator ran on CEA rates and `setPaycalcNamespace(undefined)` opened the
    // bare `myb_pc_` namespace, i.e. the shared legacy keys of everyone on the device.
    const _roleMember = getLoggedMember();
    if (!_roleMember || !gradeForRole(_roleMember.role)) {
      // No calculator follows, so nothing will read the sign-in timer: drop it, or the next page
      // opened within two minutes would count this visit as its sign-in time (App Speed review).
      clearLoginStart();
      _showUnsupportedRole(_roleMember ?? { name: getSession()?.name });
      return;
    }

    // ── COORDINATOR STATE ─────────────────────────────────────────────────────────
    // Back pay state — set by _applyBpState() when calcBackPay() runs.
    // Read by calculate() to add the lump sum into that period's gross before tax/NI.
    let _bpAmount     = 0; // gross back pay for the "paid in" period (0 = none)
    let _bpPNum       = 0; // period number that receives the back pay (0 = none)
    let _bpIsEstimate = false; // lump derives from an unconfirmed award → label it "estimated"
    let _bpIncluded   = false; // the card's opt-in tick — the lump only joins the take-home when true
    let _bpFromPayslip = false; // the lump was typed from the payslip, so hours cannot sharpen it

    // Session-level tracker — prevents Settings card from auto-opening more than once per tax year
    // per browser session. Cleared on page reload. Uses tax year label as the key.
    const _settingsPrompted = new Set();
    /** The Settings header's hint as the markup writes it, put back over a tax year not yet checked. @type {string|null} */
    let _settingsHintDefault = null;

    // The default period num selected on page load (first upcoming payday). Used by
    // the ● today-period button to know when to show itself.
    /** @type {number | null} */
    let _defaultPeriodNum = null;

    let _adjNegative = false; // tracks intended sign of otherAdj independently of value
    // True once the user types into / clears any hours field after a background override-fetch
    // began, so the late fetch's re-apply doesn't overwrite an in-flight edit (see onPeriodChange).
    let _hoursTouchedSinceFetch = false;
    // True when the CURRENTLY-loaded period's saved blob was CORRUPT (parseSavedPeriod's error). The
    // warning promises "anything you type will replace them", so the background override-fetch must
    // not auto-apply a roster suggestion and autosave over it with no user action: only typing, or
    // "Fill from calendar", may overwrite. Set in loadPeriodData on every period change.
    let _periodLoadWasCorrupt = false;

    // ── INPUT WIRING ──────────────────────────────────────────────────────────────
    // The field readers are paycalc-inputs.js's and HOW a field persists is paycalc-form-data.js's
    // (`_adjNegative` and the period pension default are injected into it); the wiring stays here
    // because it closes over calculate(), autosave() and the period state.

    // If someone types "7.5" (or "7,5", or "7:30") into an hours field, split it into 7 hrs 30 mins
    // automatically on blur rather than silently truncating to 7. The live preview
    // (decPreview) has already shown the result, so the split is no surprise.
    /**
     * @param {string} hId
     * @param {string} mId
     */
    function autoDecimalHours(hId, mId) {
      const hm = hoursTextToHM(/** @type {HTMLInputElement} */ (document.getElementById(hId)).value);   // paycalc-inputs.js
      if (!hm) return;
      /** @type {HTMLInputElement} */ (document.getElementById(hId)).value = String(hm.h);
      /** @type {HTMLInputElement} */ (document.getElementById(mId)).value = hm.m ? minutesFieldText(hm.m) : '';
      const hint = /** @type {HTMLElement | null} */ (_decHintEl(hId, false));
      if (hint) hint.hidden = true; // the split now shows in the hrs/mins fields
      // Re-run the Saturday contracted-hours cap on the SPLIT value: the cap fires on 'input', and
      // without this "140.5" blurred to 140h30m and was stored over the cap, with no ⚠ warning.
      if (hId === 'satH') onHhMm('satH', 'satM', 'satWarn');
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
          /** @type {HTMLInputElement} */ (document.getElementById(mId)).value = minutesFieldText(0);
          if (warn) { setStatus(warn, `⚠ Capped at ${contr} hrs — your contracted maximum for this period`); warn.classList.add('show'); }
        } else {
          if (warn) warn.classList.remove('show');
        }
      }
      calculate();
    }

    /** True when either Year to Date field holds text — the one guard the anchor stamp, the note and
     *  the header chip all branch on. */
    function _ytdHasFigures() {
      return ((/** @type {HTMLInputElement|null} */ (document.getElementById('ytdPay')))?.value.trim() || '') !== ''
          || ((/** @type {HTMLInputElement|null} */ (document.getElementById('ytdTax')))?.value.trim() || '') !== '';
    }

    /**
     * Refresh the Year to Date card's source anchor for the viewed tax year: rebuild the "From which
     * payslip?" select, record a source for figures that never had one (`ytdSourceToStamp`) and select
     * the stored source. Its note and chip follow in the calculate() that every caller runs next.
     * @param {any} ty
     */
    function _refreshYtdSrc(ty) {
      const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('ytdSrcSelect'));
      if (!sel) return;
      buildYtdSourceSelect(ty);
      const _rawSrc = lsGet(ytdSrcKey(ty));
      const stamp = ytdSourceToStamp(_rawSrc, _ytdHasFigures(), ty);
      if (stamp != null) lsSet(ytdSrcKey(ty), String(stamp));
      const src = stamp ?? (parseInt(_rawSrc ?? '', 10) || 0);
      if (src) _setSelectPeriod(sel, src);
    }

    /** The Year to Date note and header chip for the payslip on screen (`ytdAnchorStatus`), from what
     *  computeTax DID — written by calculate() on every run, so a tax code or a half-typed pair that
     *  stops the figures being used is said at once.
     *  @param {any} ty @param {any} p @param {number} src @param {boolean} inUse @param {string} taxCode */
    function _updateYtdNote(ty, p, src, inUse, taxCode) {
      const note = document.getElementById('ytdUptoNote');
      if (!note) return;
      const s = ytdAnchorStatus({ p, ty, src, hasFigures: _ytdHasFigures(), inUse, taxCode });
      note.classList.toggle('ytd-upto-note--live', s.noteLive);
      note.innerHTML = s.note;   // '' is hidden by `.ytd-upto-note:empty`
      const chip = document.getElementById('ytdStatusChip');
      if (chip) { chip.classList.toggle('ytd-status-chip--live', s.chipLive); chip.textContent = s.chip; }
    }

    function onPeriodChange() {
      _resetClearConfirm();   // switching period disarms a pending two-tap Clear (_resetClearConfirm says why)
      const pNum    = +/** @type {HTMLSelectElement} */ (document.getElementById('periodSelect')).value;
      const periods = getPeriods();
      const p       = periods.find(/** @param {any} x */ x => x.num === pNum);
      if (!p) return;

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
      const startStr = fdShort(p.start);
      const cutLongStr = fdLong(p.cutoff);
      // The payday is NOT repeated here: the select above already reads "Paid 31 Jul 2026 · P20", so
      // the meta row carries what it does not — the shift window and the tax year — and the gold
      // P-badge stays as the payslip cross-check. The window is LABELLED "Hours worked": a bare
      // "26 Jul – 22 Aug 2026" left the reader to guess, and three hours rows each restated the cut-off.
      /** @type {HTMLElement} */ (document.getElementById('pmRange')).textContent   = `Hours worked ${startStr} – ${cutLongStr}`;
      /** @type {HTMLElement} */ (document.getElementById('pmSub')).textContent     = `Tax year ${ty.label}`;
      /** @type {HTMLElement} */ (document.getElementById('periodBadge')).textContent = `P${payslipPeriodNum(p)}`;
      // fdLong, not fd: the picker above says "Paid 28 Aug 2026", and the most-read line of the page
      // must not spell the same date "28 Aug 26" a foot below it.
      /** @type {HTMLElement} */ (document.getElementById('netPeriod')).textContent   = `Paid ${fdLong(p.payday)}`;

      const boxing = hasBoxingDay(p);
      /** @type {HTMLElement} */ (document.getElementById('boxingBanner')).classList.toggle('visible', boxing);
      /** @type {HTMLElement} */ (document.getElementById('boxingRow')).classList.toggle('hidden', !boxing);
      if (!boxing) { /** @type {HTMLInputElement} */ (document.getElementById('boxH')).value = ''; /** @type {HTMLInputElement} */ (document.getElementById('boxM')).value = ''; }

      // Update tax year tab active state
      updateTyTabs();

      // The tax-year chip on the back-pay, HPP and Year to Date headers says WHICH year each card is
      // editing, even shut. The COMPACT form ("26/27"): the full "2026/27" wrapped the longest title
      // onto two lines on a narrow phone, and the full year is on the tax-year tabs above.
      const _chipYear = /^\d{4}\/\d{2}$/.test(ty.label) ? ty.label.slice(2) : ty.label;   // drop the century
      for (const _cid of ['bpYearChip', 'hppYearChip', 'ytdYearChip']) {
        const _chip = document.getElementById(_cid);
        if (_chip) _chip.textContent = _chipYear;
      }
      // The Settings chip names the PAYSLIP on screen by its payday (the rate and pension are per
      // payslip, and staff remember paydates, not P-numbers); its summary carries the tax year.
      const _spc = document.getElementById('settingsPeriodChip');
      if (_spc) _spc.textContent = fdShort(p.payday);

      // The rate (pre-rise on a payslip before the year's award) and the year's Year to Date figures.
      updateRateForPeriod(ty, p);
      updateYtdForTaxYear(ty);

      // The Year to Date figures are stored per tax year WITH the payslip they were copied from; the
      // cumulative method uses them only on the payslip straight after it (see calculate()).
      _refreshYtdSrc(ty);

      // This tax year's HPP amount source, restored BEFORE loadPeriodData() runs calculate() (calcHPP
      // reads the mode), so each year shows its own choice.
      restoreHppState(ty);
      // Update the "for P__" label next to the pension field so users can see
      // which period's pension they are viewing or editing.
      const pensionPeriodLbl = document.getElementById('pensionPeriodLabel');
      if (pensionPeriodLbl) pensionPeriodLbl.textContent = `for the ${fdShort(p.payday)} payslip`;

      // Settings confirmation check for this tax year.
      const tyConfirmed = lsGet(settingsKey(ty));
      // Always keep the title current so the hardcoded HTML default never shows stale text.
      /** @type {HTMLElement} */ (document.getElementById('setupBannerTitle')).textContent = `👋 Estimate your take-home for ${ty.label}`;
      // The card's header hint is written on BOTH branches: written only once checked, it kept
      // "✓ 2026/27 — £21.49/hr" over a 2025/26 payslip priced at £20.74. An unchecked year gets back
      // the markup's own hint, read before the first write.
      const _hintEl = /** @type {HTMLElement} */ (document.getElementById('settingsHint'));
      _settingsHintDefault ??= _hintEl.textContent ?? '';
      if (tyConfirmed) {
        /** @type {HTMLElement} */ (document.getElementById('setupBanner')).classList.add('hidden');
        // The rate THIS payslip was paid at, as the rate field shows it (periodRate), with the field's
        // "pre-rise" qualifier — never the year's settled rate over a payslip priced at the old one.
        const { rate: _hintRate, preAward: _hintPreAward } = periodRate(ty, p);
        const rate = (_hintRate || numVal('hourlyRate') || (GRADES[getGrade()]?.rate ?? GRADES.cea.rate)).toFixed(2);
        // No tax code here: beside the period chip it wrapped onto a second line at 390px, and the
        // year, the rate and its pre-rise position are the at-a-glance facts. The code is in the card.
        setStatus(_hintEl, `✓ ${ty.label} — £${rate}/hr${_hintPreAward ? ' · pre-rise' : ''}`);
      } else {
        _hintEl.textContent = _settingsHintDefault;
        // What is TRUE (whole-app review): grade, tax code, loan and pension are single settings used
        // for every payslip of every year; only the "checked" mark is per tax year.
        /** @type {HTMLElement} */ (document.getElementById('setupBannerBody')).innerHTML =
          `We've filled in the usual defaults — <strong>check your grade and tax code</strong> in <a href="#settingsCard" class="setup-settings-link">⚙️ Your Settings</a>, then select <strong>Save settings</strong>. You can add your hours with <strong>Fill from calendar</strong>. Your settings apply to every payslip — you'll be asked to check them again when a new tax year starts.`;
        /** @type {HTMLElement} */ (document.getElementById('setupBanner')).classList.remove('hidden');
        // Auto-open settings once per session per TY — only for returning users (new users already
        // see the settings card open) — with the "New tax year" notice. Never for a year that is
        // over: it is not new, and its settings are the ones every payslip already uses.
        if (!_settingsPrompted.has(ty.label) && 48 + ty.last >= todaysPeriodNum()) {
          _settingsPrompted.add(ty.label);
          if (lsGet(SK.setup)) {
            setSettingsCardOpen(true);
            const notice = document.getElementById('settingsNewYearNotice');
            if (notice) {
              notice.textContent = ty.rateUnconfirmed
                ? `New tax year ${ty.label} — a pay award has been accepted but isn't on payslips yet. Your rate stays on last year's until the award lands on a payslip, then it updates automatically. Check your tax code, then select Save settings.`
                : `New tax year ${ty.label} — your hourly rate updates automatically. Check your tax code and pension, then select Save settings.`;
              notice.classList.remove('hidden');
            }
          }
        }
      }

      // Show/hide bank holiday rows based on whether this period has any
      updateBhRows(p);

      // The rate-unconfirmed notices show ONLY on TODAY'S payslip (owner): the award touches every
      // payslip of the pending year, but warning on all 13 buried it, and today's is the one about to
      // be paid at a possibly-stale rate. todaysPeriodNum(), NOT currentPeriodNum() — which, despite
      // its name, is the SELECTED period, so comparing it with p.num is always true. Shown in Settings
      // and on the result card, so it is seen with Settings shut.
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
          // Never over a CORRUPT period's blob (`_periodLoadWasCorrupt` says why); the hint bar above
          // still refreshed, so "Fill from calendar" — an explicit action — can replace it.
          if (_periodLoadWasCorrupt) return;
          // Refresh the gold fields filled while 'checking' — DISPLAY-ONLY (owner decision; invariant
          // 11): the suggestion feeds the live £ but is NOT saved, or merely VIEWING a payslip would
          // count it as "entered" for HPP, the year so far and back pay. Saving needs an explicit act:
          // typing anything (autosave takes the gold values with it) or the Fill from calendar buttons.
          const _refreshP = getPeriods().find(/** @param {any} x */ x => x.num === _fetchedPNum);
          if (_refreshP) {
            const _refreshS = getRosterSuggestion(_refreshP, getLoggedMember());
            if (_refreshS) { _applyRosterSuggestion(_refreshS); calculate(); updateRosterHint(); }   // the hint again AFTER the fill
          }
        });
      }

      // Load saved data for this period (which also applies the pension opt-out lock before pricing)
      loadPeriodData(p.num);

      // The back-pay card follows the viewed payslip's award year ALWAYS, not only while it is open,
      // so the banner and the take-home reflect the payslip on screen (calculate() still gates the
      // lump on `_bpPNum === _pNum`); per-year keys keep each year's tick, rates and amount apart.
      _syncBackPayForViewedYear();

      stampPaycalcPrintLine();
    }

    // ── PERIOD DATA SAVE / LOAD ───────────────────────────────────────────────────
    function updateAdjSign() {
      const btn = /** @type {HTMLElement} */ (document.getElementById('adjSignBtn'));
      btn.textContent = _adjNegative ? '−' : '+';
      btn.setAttribute('aria-label', _adjNegative ? 'Toggle sign: currently negative' : 'Toggle sign: currently positive');
      btn.classList.toggle('negative', _adjNegative);
    }

    function autosave() {
      const pNum = currentPeriodNum();   // SAVED before calculate() below: HPP and the year card read storage
      const _autoP = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
      const d    = readFormData({
        adjNegative: _adjNegative,
        periodDefaultPension: _autoP ? periodDefaultPension(_autoP) : null,
      });
      try {
        lsSet(periodKey(pNum), JSON.stringify(d));
        updateSaveStatus(pNum);
      } catch { /* storage unavailable */ }
      calculate();
    }
    /** A SETTING changed: carry only `fields` into this payslip's readable saved entries, then re-price
     *  (`autosave` would save the calendar's suggestion too — see `settingFieldsWrite`). @param {string[]} fields */
    const persistSetting = (fields) => () => { const pNum = currentPeriodNum(), p = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
      const w = settingFieldsWrite(lsGet(periodKey(pNum)), readFormData({ adjNegative: _adjNegative, periodDefaultPension: p ? periodDefaultPension(p) : null }), fields);
      if (w) { try { lsSet(periodKey(pNum), w); updateSaveStatus(pNum); } catch { /* storage unavailable */ } }
      calculate(); };

    /** Paint payslip `p`'s own default pension into the field; no payslip, no paint. @param {any} p */
    function _paintDefaultPension(p) {
      const pa = /** @type {HTMLInputElement | null} */ (document.getElementById('pensionAmt'));
      if (pa && p) pa.value = periodDefaultPension(p).toFixed(2);
    }

    /** @param {number} pNum */
    function loadPeriodData(pNum) {
      /** @type {any} */
      let d = emptyPeriodData();
      // parseSavedPeriod tells CORRUPT from missing: saved entries that cannot be read must not pose
      // as an empty form ("No entries saved"), or the member could type over them unknowing. The form
      // still loads empty (nothing is deleted until they type), and updateSaveStatus says so.
      const _parsed = parseSavedPeriod(lsGet(periodKey(pNum)));
      if (_parsed.data) d = _parsed.data;
      _periodLoadWasCorrupt = !!_parsed.error;   // gates the background fetch's auto-apply
      clearRosterSuggestedAll();   // writeFormData expects the gold highlights cleared first
      _adjNegative = writeFormData(d).adjNegative;
      _restoreRosterSuggested(pNum);
      // No pension saved for this payslip → its own default: the step for its payday (old payslips
      // keep the old rate) and the joining-period pro-rate.
      const _pObj = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
      _paintDefaultPension(d.pension == null ? _pObj : null);
      // The pension LOCK follows the viewed payslip — a member who left the scheme in August still
      // contributes on her July one. AFTER the paint above (it may only override a value where the
      // timeline says there was none) and BEFORE calculate() below: applied after it, a payslip
      // holding a saved figure was priced WITH that deduction beside a field reading a locked £0.00.
      if (_pObj) applyPensionOptOutUI(_pObj);
      updateAdjSign();
      // Open "more options" when this payslip has extras saved — through _setDisclosure, so the
      // button's aria-expanded and arrow stay in step with it (a class alone told a screen reader
      // "collapsed" about an open panel).
      const hasExtras = !!(d.slSkip || d.otherAdj);
      _setDisclosure('hoursShowMore', 'hoursExtra', hasExtras, { arrowSel: '.show-more-arrow' });
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
          // Saved entries that cannot be read say so, never "No entries saved" (loadPeriodData).
          setStatus(el, "⚠ Couldn't read this period's saved entries — anything you type will replace them");
          el.className   = 'save-status corrupt';
          return;
        }
        if (d) {
          const _pObj = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
          const _hasCustomPension = d.pension != null && Math.abs(d.pension - periodDefaultPension(_pObj)) > 0.005;
          if (!isDataEmpty(d) || _hasCustomPension) {
            setStatus(el, '✓ Entries saved for this period');
            el.className   = 'save-status saved';
            return;
          }
        }
      }
      el.textContent = 'No entries saved for this period';
      el.className   = 'save-status unsaved';
    }

    const _clearState = /** @type {{ pending: boolean, armedAt: number, timer: ReturnType<typeof setTimeout> | null, countdownTimer: ReturnType<typeof setInterval> | null }} */ ({ pending: false, armedAt: 0, timer: null, countdownTimer: null });
    /** A confirming tap sooner than this after arming is the SAME gesture — a double-tap, which iOS
     *  teaches by swallowing a first tap with the keypad up — never a prompt read and answered. */
    const CLEAR_CONFIRM_MIN_MS = 500;

    // Disarm the two-press "select again to confirm" clear — when it times out, when it is confirmed,
    // on tab-hide AND on period change: without the last, arming Clear on period A then switching to
    // B left the confirm live, so ONE tap of Clear on B wiped B with no confirm.
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
    // On hide: disarm "Select again to confirm" (iOS fires a suspended timer at once on resume — an accidental wipe), and let
    // go of the field in hand, so a figure that commits only on `change` (prior-year HPP) is kept if the page never returns.
    document.addEventListener('visibilitychange', () => { if (document.hidden) { _resetClearConfirm(); commitFocusedField(); } });

    function clearPeriod() {
      if (!_clearState.pending) {
        const btn = /** @type {HTMLElement | null} */ (document.getElementById('clearBtn'));
        _clearState.pending = true;
        let secs = 3;
        if (btn) { btn.textContent = `Select again to confirm (${secs})`; btn.classList.add('confirming'); }
        _clearState.countdownTimer = setInterval(() => {   // the countdown, a tick a second
          secs--;
          if (secs > 0 && btn) btn.textContent = `Select again to confirm (${secs})`;
        }, 1000);
        _clearState.timer = setTimeout(_resetClearConfirm, 3000);
        _clearState.armedAt = Date.now();
        return;
      }
      if (Date.now() - _clearState.armedAt < CLEAR_CONFIRM_MIN_MS) return;   // still the arming tap's gesture
      _resetClearConfirm();
      const pNum = currentPeriodNum();
      lsDel(periodKey(pNum));
      lsDel(snapKey(pNum));
      // Mark the form as user-touched BEFORE blanking it: programmatic .value writes never fire the
      // delegated 'input' listener, so an override fetch in flight at the confirm would otherwise
      // resolve, see the flag unset, and refill + autosave the fields just cleared — undoing it.
      _hoursTouchedSinceFetch = true;
      clearRosterSuggestedAll();   // writeFormData expects the gold highlights cleared first
      writeFormData(emptyPeriodData());
      _paintDefaultPension(getPeriods().find(/** @param {any} x */ x => x.num === pNum));   // writeFormData leaves a null pension blank
      _adjNegative = false;
      updateAdjSign();
      updateSaveStatus(pNum);
      calculate();
      // Clearing blanks the fields programmatically — refresh the roster card so
      // rows don't keep showing ✓ matched against now-empty fields.
      updateRosterHint();
    }

    // The last breakdown render, so an identical string skips innerHTML's parse and layout. The
    // summary is not cached: a confirmed payslip's figures write it too (paycalc-result-headline.js).
    /** @type {string | null} */
    let _lastBdBodyHtml = null;

    // ── CALCULATION ENGINE ────────────────────────────────────────────────────────
    /** @param {number} rate */
    function updateBadges(rate) {
      /** @type {(r: number, mult: any) => string} */
      const f = (r, mult) => `${mult}×  ·  £${(rate * r).toFixed(2)}/hr`;
      /** @type {HTMLElement} */ (document.getElementById('badge-sat')).textContent = f(RATE_125, '1.25');
      /** @type {HTMLElement} */ (document.getElementById('badge-bh')).textContent   = f(RATE_125, '1.25');
      /** @type {HTMLElement} */ (document.getElementById('badge-bhot')).textContent = f(RATE_125, '1.25');
      /** @type {HTMLElement} */ (document.getElementById('badge-ot')).textContent   = f(RATE_125, '1.25');
      /** @type {HTMLElement} */ (document.getElementById('badge-rdw')).textContent = f(RATE_125, '1.25');
      /** @type {HTMLElement} */ (document.getElementById('badge-sun')).textContent = f(RATE_150, '1.5');
      /** @type {HTMLElement} */ (document.getElementById('badge-box')).textContent = f(RATE_300, '3');
    }

    /** The share-of-pay bar and its legend above the summary (buildBreakBar); no pay, neither shows.
     *  @param {{ gross:number, pension:number, tax:number, ni:number, sl:number, net:number }} figures */
    function updateBreakBar(figures) {
      const bar = document.getElementById('payBreakBar'), legend = document.getElementById('payBreakLegend');
      const b = bar && legend ? buildBreakBar(figures) : null;
      bar?.classList.toggle('pbb-visible', !!b);
      legend?.classList.toggle('pbb-visible', !!b);
      if (b && bar && legend) { bar.innerHTML = b.bar; legend.innerHTML = b.legend; }
    }

    function calculate() {
      // Resolve thresholds for the selected period's tax year
      const _pNum   = currentPeriodNum();
      const _curP   = getPeriods().find(/** @param {any} x */ x => x.num === _pNum);
      if (!_curP) { renderYtdLine(null); return; }
      const _ty     = taxYearForPeriod(_curP);
      const thresholds = getThresholds(_ty.label);
      const _proRateFactor = getProRateFactor(_curP);
      const LONDON = (_curP ? getLondonAllowanceForPeriod(_curP, _ty) : _ty.londonAllow) * _proRateFactor;

      const _calcGrade = getGrade();
      const _calcDefaultRate = GRADES[_calcGrade]?.rate ?? GRADES.cea.rate;
      // The field is read-only and grade-derived, so the floor and the grade default only matter if
      // its value is ever missing.
      const rate = Math.max(0, numVal('hourlyRate')) || _calcDefaultRate;
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

      // Back pay joins only on its paid-in payslip AND once the member has ticked it in (opt-in, OFF
      // by default — the card computes and shows the lump either way).
      const _bpThisPeriod = (_bpPNum > 0 && _bpPNum === _pNum && _bpIncluded) ? _bpAmount : 0;

      // The HPP card FIRST, because it is what stores the premiums read below: this year's whenever a
      // payslip of the year is viewed, and last year's — the one a January payslip carries — the first
      // time it is worked out (updatePriorHpp). Run after the read, the pass that stored it painted
      // the January banner from nothing until something else recalculated. calcHPP takes no back-pay
      // input (invariant 5): it prices every period of the year at the settled rate, which already
      // holds the lump's variable part — feeding it in counted it twice. Nothing calculate() works out
      // is an input to it.
      calcHPP();

      // The HPP that lands on THIS payslip: the tax year whose premium a January payslip carries
      // (the prior year's — paycalc-hpp-schedule.js owns that relation, two Januaries included).
      const _hppTy = hppTaxYearForPayslip(_curP, getPeriods(), CONFIG.TAX_YEARS);
      // A CONFIRMED actual (stored, even £0) beats the estimate: resolveHppForPeriod is that one rule,
      // shared with the prior-year card so the two cannot disagree.
      const _hppRes = _hppTy
          ? resolveHppForPeriod(lsGet(hppActualKey(_hppTy)), lsGet(hppEstKey(_hppTy)))
          : { amount: 0, isEstimate: false, hasActual: false };
      // The Year to Date card's January pointer ("enter the confirmed figure from it in the Holiday Pay
      // Premium card") shows ONLY on that January payslip — on every other it read wrong (owner) — and
      // only where that card's confirm box can take the figure: a member employed in the premium's year
      // (updatePriorHpp hides the whole last-year section from a joiner) and a box that is open, which
      // it is once the payslip may be in hand — from its cut-off, the rule paycalc-2-3 gives the box in
      // paycalc-hpp.js — or while it holds a confirmed figure.
      const _janHint = document.getElementById('ytdJanHppHint');
      if (_janHint) _janHint.hidden = !(_hppTy && isTaxYearVisible(_hppTy)
          && (_hppRes.hasActual || payslipMayBeInHand(_curP)));
      const _hppAmount     = _hppRes.amount;      // the HPP figure landing on this January payslip
      const _hppIsEstimate = _hppRes.isEstimate;
      // OPT-IN, like back pay: the premium JOINS the take-home only once the member ticks it in (off
      // by default, per tax year); until then the banner says it could land here, and it is NOT added.
      const _hppIncluded   = !!_hppTy && lsGet(hppIncKey(_hppTy)) === '1';
      const _hppForPeriod  = _hppIncluded ? _hppAmount : 0;

      const grossWithBp = gross + _bpThisPeriod + _hppForPeriod;

      // The "updates automatically" hint is for first use: once this payslip has hours it hides, and
      // the provenance chips use the space for facts.
      const _netHintEl = document.getElementById('netHint');
      if (_netHintEl) _netHintEl.hidden =
        satHrs > 0 || bhHrs > 0 || bhOtHrs > 0 || oHrs > 0 || rHrs > 0 || sHrs > 0 || bHrs > 0 || peer > 0;

      // Pension — salary sacrifice, off the gross before tax and NI. A BLANK or unparseable field (a
      // lone "." or "-" mid-edit) means THIS payslip's default, never £0, or retyping the field would
      // flash a take-home inflated by the whole pension; a typed "0" is a genuine opt-out and is kept.
      // Floored at 0: a pasted negative would add untaxed headroom and inflate the take-home.
      const _pField    = /** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'));
      const _pRaw      = _pField && _pField.value.trim() !== '' ? parseSmartFloatOrNull(_pField.value) : null;
      const pension    = _pRaw != null
          ? Math.max(0, _pRaw)
          : periodDefaultPension(_curP);
      const pensionWarn = document.getElementById('pensionWarn');
      if (pensionWarn) pensionWarn.classList.toggle('show', pension > grossWithBp && pension > 0);
      const sacGross   = Math.max(0, grossWithBp - pension);

      // NI and Student Loan (both on sacGross — salary sacrifice reduces all three bases), BEFORE the
      // tax: neither depends on it, and the cumulative tax is bounded by what they leave (computeTax).
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
      const _anyLoan = plan !== 'none' || pgLoan;
      // The "not deducted this period" skip + its row apply to whichever loan(s) are active.
      /** @type {HTMLElement} */ (document.getElementById('slSkipRow')).classList.toggle('hidden', !_anyLoan);
      // The stop: deductions end from ONE payslip onward while EARLIER payslips keep theirs, so they
      // still match the real ones (setting the plan to None would strip those too). Both loans stop
      // together; a member whose loans end apart uses the per-period skip for the gap.
      const _slPaidOffSel   = /** @type {HTMLSelectElement|null} */ (document.getElementById('slPaidOffFrom'));
      const _slPaidOffField = document.getElementById('slPaidOffField');
      if (_slPaidOffField) _slPaidOffField.classList.toggle('hidden', !_anyLoan);
      // The select, else what is STORED: a stop naming a payslip the list no longer offers reads as ''
      // there and must stay in force (paycalc-periods.js → the rollover note). The select comes first,
      // as storage may be blocked, and saveSettings stores every pick before this runs.
      const _slPaidOffFromP = parseInt(_slPaidOffSel?.value || lsGet(SK.slPaidOff) || '', 10) || 0;
      const slPaidOff       = !!(_slPaidOffFromP && _pNum >= _slPaidOffFromP);
      // One undergraduate plan AND a Postgraduate Loan can be repaid together — HMRC deducts each
      // independently (9% above the plan threshold; 6% above the £21,000 PGL threshold). The TOTAL feeds
      // net + the break bar; the summary shows a separate line per active loan.
      const slUnder = slPaidOff ? 0 : computeSL(sacGross, plan, thresholds.sl, slSkip);
      const slPost  = (pgLoan && !slPaidOff) ? computeSL(sacGross, 'postgrad', thresholds.sl, slSkip) : 0;
      const sl = slUnder + slPost;

      // Income tax — cumulative PAYE when the Year to Date figures are given (W1/M1/X excluded). A
      // blank or unparseable box passes NULL, never 0: computeTax needs BOTH figures, and "Taxable Pay
      // typed, Tax Paid still blank" must read as incomplete, not as £0 of tax collected.
      const ytdPayEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ytdPay'));
      const ytdTaxEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ytdTax'));
      let ytdP = (ytdPayEl?.value ?? '').trim() !== '' ? numValOr('ytdPay', null) : null;
      let ytdT = (ytdTaxEl?.value ?? '').trim() !== '' ? numValOr('ytdTax', null) : null;
      // The cumulative method adds this payslip's pay to the totals entered, so it is VALID only on
      // the payslip straight after the one they came from; any other payslip uses the standard
      // method, or stale figures are silently treated as last-payslip totals and skew the tax.
      const _ytdSrc = parseInt(lsGet(ytdSrcKey(_ty)) ?? '', 10) || 0;
      if (!(_ytdSrc && _curP && _curP.num === _ytdSrc + 1)) { ytdP = null; ytdT = null; }
      const periodN = _curP ? (_curP.num - 48) - _ty.first + 1 : null;
      const { tax, usingCumulative, refund: taxRefund, code: taxCodeUsed, recognised: taxCodeKnown, payLimited: taxPayLimited } = computeTax(
        sacGross, /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value, thresholds,
        { ytdPay: ytdP, ytdTax: ytdT, periodN, otherDeductions: ni + sl },
      );
      paintTaxCodeWarning({ code: taxCodeUsed, recognised: taxCodeKnown });   // a code priced on 1257L says so
      _updateYtdNote(_ty, _curP, _ytdSrc, usingCumulative, taxCodeUsed);     // "in use" is what computeTax did

      // The take-home is the summary's rows subtracted, each to the penny as shown (takeHomePay).
      const { afterPension: _shownAfterPension, net } = takeHomePay({ gross: grossWithBp, pension, tax, ni, sl });

      // The loan rows of the summary, which never leave a £0 unexplained — buildLoanLines says how.
      const _slPaidOffP = slPaidOff ? getPeriods().find(/** @param {any} x */ x => x.num === _slPaidOffFromP) : null;
      const slLines = buildLoanLines({
        sacGross, plan, planLabel: _slSel.selectedOptions[0]?.textContent?.trim() ?? plan, pgLoan, slUnder, slPost, slSkip,
        slPaidOff, paidOffDay: _slPaidOffP ? fdShort(_slPaidOffP.payday) : '', sl: thresholds.sl, tyLabel: _ty.label,
      });

      updateBreakBar({ gross: grossWithBp, pension, tax, ni, sl, net });

      // UI
      /** @type {HTMLElement} */ (document.getElementById('netDisplay')).textContent = fmt(net);
      /** @type {HTMLElement} */ (document.getElementById('pensionRef')).textContent = pension.toFixed(2);

      // Check against the real payslip: shown from the payslip's CUT-OFF (it arrives before payday),
      // and a big gap names this estimate's tax code and pension first (buildActualCheck). The figure
      // autosaves in this payslip's own entries (actualNet).
      const _srcP = _ytdSrc ? getPeriods().find(/** @param {any} x */ x => x.num === _ytdSrc) : null;
      const _caWrap = document.getElementById('checkActualWrap');
      if (_caWrap) {
        const _caInHand = payslipMayBeInHand(_curP);
        _caWrap.hidden = !_caInHand;
        const _caEl = /** @type {HTMLInputElement|null} */ (document.getElementById('actualNetInput'));
        const _caActual = _caInHand ? Math.max(0, parseSmartFloat(_caEl?.value ?? '') || 0) : 0;
        const _caV = document.getElementById('actualVerdict');
        // The pension the estimate DEDUCTED: sacGross floors at zero, so a pension above the gross is
        // only taken up to it, and the check must name the figure it used.
        if (_caV) _caV.innerHTML = buildActualCheck(_caActual, net, { taxCode: taxCodeUsed, recognised: taxCodeKnown, pension: Math.min(pension, Math.max(0, grossWithBp)),
          ytdFrom: usingCumulative && _srcP ? fdShort(_srcP.payday) : '' });
        // The other payslip lines, compared with the SAME figures the summary rows display; the
        // comparison never guesses a cause (buildActualComparison). The payslip's pay figure is its
        // Taxable Pay, after the pension, so it is set against "Pay after pension deduction".
        const _cmpEl = document.getElementById('actualCompare');
        if (_cmpEl) {
          const _av = /** @param {string} id */ (id) => {
            const _e = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
            return (_e && _e.value.trim() !== '') ? parseSmartFloat(_e.value) : null;
          };
          _cmpEl.innerHTML = _caInHand ? buildActualComparison({
            actual: { gross: _av('actualGrossInput'), pension: _av('actualPensionInput'),
                      tax: _av('actualTaxInput'), ni: _av('actualNiInput'),
                      net: _caActual > 0 ? _caActual : null },
            estimate: { gross: _shownAfterPension, pension, tax, ni, net },
          }) : '';
        }
      }

      // Provenance chips under the take-home £ — what fed THIS number; none on a normal payslip.
      const _chipsEl = document.getElementById('provChips');
      if (_chipsEl) {
        _chipsEl.innerHTML = buildProvChips({
          usingCumulative,
          srcLabel: _srcP ? fdShort(_srcP.payday) : '',
          bpAmount: _bpThisPeriod, hppAmount: _hppForPeriod,
          hoursFromCalendar: !!document.querySelector('#hoursCard .roster-suggested'),
        });
      }

      // The result markup is paycalc-breakdown.js's, whose fields are named as these locals.
      /** @type {HTMLElement} */ (document.getElementById('summary')).innerHTML = buildSummaryRows({
        _bpThisPeriod, _hppForPeriod, gross, grossWithBp, _bpIsEstimate, _hppIsEstimate,
        pension, sacGross: _shownAfterPension, usingCumulative, tax, ni, slLines, net, taxRefund,
        taxCode: taxCodeUsed, taxCodeRecognised: taxCodeKnown, taxPayLimited,
      });

      const bd = buildBreakdownRows({
        nonBhNorm, rate, gBasicNorm, satCapped, r125, gBasicSat, bhCapped, gBankHol,
        bhOtHrs, gBhOt, oHrs, gOvertime, rHrs, gRdw, sHrs, r150, gSunday, bHrs, r300, gBoxing,
        peer, gPeer, LONDON, otherAdj, slSkip, slPaidOff, plan, pgLoan, usingCumulative,
        _bpThisPeriod, _bpIsEstimate, _hppForPeriod, _hppIsEstimate,
      });
      if (bd !== _lastBdBodyHtml) {
        // #bdRows, not #bdBody: the pension and absence notes are static siblings in the panel and
        // must survive the rebuild.
        /** @type {HTMLElement} */ (document.getElementById('bdRows')).innerHTML = bd;
        _lastBdBodyHtml = bd;
      }

      // ── THE HEADLINE FIGURE AND WHAT IT IS CALLED ──────────────────────────────
      // paycalc-result-headline.js writes every target on BOTH paths — a confirmed payslip figure or
      // this estimate — because a target one path forgets keeps the previous render, and one branch's
      // number then sits under the other's label. `actual` is resolved HERE: the gate is about
      // identity, which belongs with the session, not with the words.
      const _actualKey = _curP ? formatISO(_curP.payday) : null;
      const _actual    = _actualKey && isActualsDev(getLoggedMember())
        ? readPayslipActuals()[_actualKey] : null;
      renderResultHeadline({
        actual: _actual, net, payday: _curP ? _curP.payday : null,
        bpThisPeriod: _bpThisPeriod, hppForPeriod: _hppForPeriod,
        bpIsEstimate: _bpIsEstimate, hppIsEstimate: _hppIsEstimate,
      });

      // The Year to Date line under the £ (owner, 7 Nov 2026): the rule is ytdUpdateFrom, the words renderYtdLine.
      renderYtdLine(_actual ? null : ytdUpdateFrom({ p: _curP, ty: _ty, src: _ytdSrc, inUse: usingCumulative,
        taxCode: taxCodeUsed, recognised: taxCodeKnown }));

      // The two OPT-IN MONEY BANNERS (paycalc-money-banner.js): one set of three states — included,
      // available but not added, nothing to say — right only while "available" never means "added".
      const _bpAvailableHere = _bpPNum > 0 && _bpPNum === _pNum && _bpAmount > 0;
      paintBanner({
        rootId: 'bpActiveBanner', textId: 'bpBannerText', tickId: 'bpBannerTick', noteId: 'bpBannerNote',
        available: _bpAvailableHere, included: _bpIncluded,
        copy: backPayBannerCopy({
          thisPeriod: _bpThisPeriod, amount: _bpAmount, isEstimate: _bpIsEstimate, fromPayslip: _bpFromPayslip,
          aprilYear: _bpAvailableHere ? _bpAwardTaxYear(_backdatedFromPNum()).label.slice(0, 4) : '',
        }),
      });

      const _hppAvailableHere = !!_hppTy && _hppAmount > 0;
      paintBanner({
        rootId: 'hppActiveBanner', textId: 'hppBannerText', tickId: 'hppBannerTick', noteId: 'hppBannerNote',
        available: _hppAvailableHere, included: _hppIncluded,
        copy: hppBannerCopy({ forPeriod: _hppForPeriod, amount: _hppAmount, isEstimate: _hppIsEstimate }),
        tickYear: _hppTy ? _hppTy.label : undefined,
      });

      renderYearCard({
        ty: _ty, plan, pgLoan, slPaidOffFromP: _slPaidOffFromP,
        // The OPT-IN back-pay lump, so year-so-far agrees with the result card (see the module).
        bpLump: (_bpIncluded && _bpPNum > 0 && _bpAmount > 0) ? { pNum: _bpPNum, amount: _bpAmount } : null,
      });
    }

    // ── BACK PAY STATE WRAPPERS ───────────────────────────────────────────────────
    // Adopt what calcBackPay()/prefillBackPay() return, and re-price only if it changed.
    /** @param {{ bpAmount: any, bpPNum: any, bpIsEstimate?: boolean, bpIncluded?: boolean }} _
     *  (bpVarAmount is deliberately not tracked: nothing consumes it since HPP stopped taking back
     *  pay, and any change to it moves bpAmount too, so the re-price still fires.) The amount source
     *  is read off the card's own radio once the card has settled it — calcBackPay can put a manual
     *  pick back to compute — and is part of the state, because a typed lump can equal the worked-out
     *  one to the penny and the banner's note must still follow the switch. */
    function _applyBpState({ bpAmount, bpPNum, bpIsEstimate = false, bpIncluded = false }) {
      const fromPayslip = !!(/** @type {HTMLInputElement|null} */ (document.getElementById('bpModeManual'))?.checked);
      if (bpPNum !== _bpPNum ||
          bpIsEstimate !== _bpIsEstimate ||
          bpIncluded   !== _bpIncluded   ||
          fromPayslip  !== _bpFromPayslip ||
          Math.abs(bpAmount    - _bpAmount)    > 0.001) {
        _bpAmount     = bpAmount;
        _bpPNum       = bpPNum;
        _bpIsEstimate = bpIsEstimate;
        _bpIncluded   = bpIncluded;
        _bpFromPayslip = fromPayslip;
        calculate();
      }
    }
    function _runCalcBackPay() { _applyBpState(calcBackPay()); }

    // Last values we auto-filled into the New rate/London boxes, so _applyBpRisePct can tell a
    // still-auto value (safe to refresh) from one the user has hand-corrected (must not clobber).
    let _bpAutoNewR = '', _bpAutoNewL = '';
    /**
     * "Pay rise %" shortcut: when a percentage is entered, fill the New rate/London from
     * Old × (1 + %). A convenience only — the New boxes stay editable, and leaving the % blank
     * keeps them fully manual. Re-runs whenever the % or either Old figure changes.
     */
    function _applyBpRisePct() {
      const pct = numVal('bpRisePct');
      if (pct > 0) {
        const newREl = /** @type {HTMLInputElement} */ (document.getElementById('newRateInput'));
        const newLEl = /** @type {HTMLInputElement} */ (document.getElementById('newLondon'));
        const newR = raiseByPercent(numVal('oldRate'),   pct);
        const newL = raiseByPercent(numVal('oldLondon'), pct);
        // Only fill a New box that is blank or still holds our last auto value — never overwrite
        // a figure the user hand-corrected to their payslip.
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

    // Sync the back-pay card to the VIEWED award year: restore that year's own saved blob, or — when
    // it has none — prefill its default (compute for the current award, enter-from-payslip for a
    // prior one). Runs at init AND on every period change, so the banner and the take-home follow the
    // payslip on screen; per-year keys (bpKey(ty)) load each year's state rather than resetting its tick.
    function _syncBackPayForViewedYear() {
      if (restoreBpState()) {
        // Re-seed the "these New values were derived from the %" markers, so a restored box the
        // member corrected by hand is never re-filled by _applyBpRisePct.
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
      // Max-height from the actual rendered height so a long back-pay breakdown (many periods,
      // large text/zoom) is never clipped by the fixed CSS `.bd-body.open` cap; cleared on close
      // so the CSS collapse animates shut. (Arrow rotation is CSS — .bd-btn.open .bd-arrow.)
      _toggleDisclosure('bpBreakdownBtn', 'backPayRows', {
        onToggle: (open, body) => { body.style.maxHeight = open ? `${body.scrollHeight}px` : ''; },
      });
    }

    // ── DISCLOSURE TOGGLES — ONE open/close core ──────────────────────────────────
    // The page's button + panel disclosures share it; their differences (arrow glyph, label swap,
    // measured max-height) ride the options. The disclaimer's More/Less keeps its own three lines —
    // it has no panel and no arrow, so the helper would fit it worse than it helps.
    /**
     * Set a disclosure button + body to a SPECIFIC open state, keeping `aria-expanded` + the arrow
     * glyph in step — for the click AND for loadPeriodData's programmatic open, where a class alone
     * once told a screen reader "collapsed" about an open panel. Idempotent.
     * @param {string} btnId @param {string} bodyId @param {boolean} open
     * @param {{ arrowSel?: string, onToggle?: (open: boolean, body: HTMLElement) => void }} [opts]
     */
    function _setDisclosure(btnId, bodyId, open, opts = {}) {
      const btn  = /** @type {HTMLElement|null} */ (document.getElementById(btnId));
      const body = /** @type {HTMLElement|null} */ (document.getElementById(bodyId));
      if (!btn || !body) return;
      body.classList.toggle('open', open);
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (opts.arrowSel) {
        const a = btn.querySelector(opts.arrowSel);
        if (a) a.textContent = open ? '▲' : '▼';
      }
      opts.onToggle?.(open, body);
    }
    /**
     * Toggle a disclosure to the OPPOSITE of its current open state (the click path).
     * @param {string} btnId @param {string} bodyId
     * @param {{ arrowSel?: string, onToggle?: (open: boolean, body: HTMLElement) => void }} [opts]
     */
    function _toggleDisclosure(btnId, bodyId, opts = {}) {
      const body = /** @type {HTMLElement|null} */ (document.getElementById(bodyId));
      if (!body) return;
      _setDisclosure(btnId, bodyId, !body.classList.contains('open'), opts);
    }

    // Hours show-more: the label is CONSTANT — only the arrow flips.
    function toggleHoursExtra() { _toggleDisclosure('hoursShowMore', 'hoursExtra', { arrowSel: '.show-more-arrow' }); }

    function toggleHppNote() {
      _toggleDisclosure('hppToggleBtn', 'hppNoteBody', {
        arrowSel: '.hpp-toggle-arrow',
        onToggle: open => {
          const l = document.getElementById('hppToggleBtnLabel');
          if (l) l.textContent = open ? 'Hide calculation details ' : 'How is this calculated? ';
        },
      });
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
      el.textContent = String(Math.max(0, Math.min(10, +el.textContent + delta)));
      autosave();
    }

    // ── BREAKDOWN TOGGLE ──────────────────────────────────────────────────────────
    function toggleBD() { _toggleDisclosure('bdBtn', 'bdBody'); }   // arrow rotation is CSS

    // ── INIT ──────────────────────────────────────────────────────────────────────
    runMigrations({ getPeriods, getLoggedMember, getPensionDefault });

    // A FIRST VISIT (owner) gets the top privacy note and the setup banner's "Used the Pay Calculator
    // before?" line — an empty calculator may be a MOVED one, as Safari and the Home Screen app keep
    // separate copies. Nothing saved HERE = no settings (SK.setup) and no payslip for THIS member —
    // what a key IS, classifyPayKey says — read after runMigrations() selects the namespace, so another
    // member's data never counts; once per load, so nothing moves under a finger. A browser that will
    // not SAVE (`lsAvailable`, ls.js) swaps "Saved automatically" for a warning.
    {
      const pre = pcPrefix(), hasPayData = !!lsGet(SK.setup)
        || lsKeys().some(k => k.startsWith(pre) && classifyPayKey(k.slice(pre.length)).kind === 'payslip');
      document.getElementById('privacyNoteTop')?.classList.toggle('hidden', hasPayData);
      document.getElementById('setupRestore')?.toggleAttribute('hidden', hasPayData);
    }
    document.body.classList.toggle('storage-blocked', !lsAvailable());

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
        // Navigation, like the arrows below: one tap with the keypad up (wireIosTap).
        wireIosTap(b, () => jumpToTaxYear(i, onPeriodChange), { releaseFocus: true });
        wrap.appendChild(b);
      });
    })();

    // The student-loan stop's payslips, after its static "No — still deducted". Built BEFORE
    // loadSettings so the saved choice restores. Headed "Tax year 2026/27" like every other payslip
    // list — it read a bare "2026/27" until the owner asked for one wording (8 Nov 2026).
    const _slPaidOffSel = document.getElementById('slPaidOffFrom');
    if (_slPaidOffSel) appendPayslipOptions(_slPaidOffSel, visiblePeriods());

    loadSettings();
    // _defaultPeriodNum must be assigned BEFORE onPeriodChange() runs — the period
    // button visibility check is `pNum === _defaultPeriodNum`. buildPeriodSelect()
    // returns the default period number; we then call onPeriodChange() explicitly so
    // the button is correctly hidden on the initial load (not shown as if off-default).
    _defaultPeriodNum = buildPeriodSelect();
    onPeriodChange();
    // THE PAGE IS USABLE FROM HERE: onPeriodChange restored the viewed payslip's hours and ran
    // calculate(), so the result card holds a real figure — what a member means by "ready", and the
    // App Speed card's "usable" milestone. (It also synced the back-pay card to the opening payslip's
    // award year, so no separate restore of it is needed at init.)
    markPageReady();

    // ── EVENT LISTENERS (no inline handlers in HTML — roster-app convention) ──────

    // Period navigation. The arrows, 📍 and the tax-year tabs (and the peer stepper, Save settings)
    // take ONE tap with the keypad up (wireIosTap):
    /** @type {HTMLElement} */ (document.getElementById('periodSelect')).addEventListener('change', onPeriodChange);
    wireIosTap(/** @type {HTMLElement} */ (document.getElementById('prevBtn')), () => prevPeriod(onPeriodChange), { releaseFocus: true });
    wireIosTap(/** @type {HTMLElement} */ (document.getElementById('nextBtn')), () => nextPeriod(onPeriodChange), { releaseFocus: true });
    wireIosTap(/** @type {HTMLElement} */ (document.getElementById('todayPeriodBtn')), () => {
      _setSelectPeriod(document.getElementById('periodSelect'), _defaultPeriodNum);
      onPeriodChange();
    }, { releaseFocus: true });
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
    // The payslip self-check figures persist with the period like every other field; autosave()
    // recalculates, which re-renders the verdict.
    document.getElementById('actualNetInput')?.addEventListener('input', autosave);
    for (const _id of ['actualGrossInput', 'actualPensionInput', 'actualTaxInput', 'actualNiInput'])
      document.getElementById(_id)?.addEventListener('input', autosave);
    // The disclosure for the extra payslip lines — plain aria-expanded/hidden, no state class.
    document.getElementById('actualMoreBtn')?.addEventListener('click', () => {
      const _b = /** @type {HTMLButtonElement} */ (document.getElementById('actualMoreBtn'));
      const _w = document.getElementById('actualMoreWrap');
      const _open = _b.getAttribute('aria-expanded') === 'true';
      _b.setAttribute('aria-expanded', _open ? 'false' : 'true');
      if (_w) _w.hidden = _open;
    });

    // Decimal auto-correction — if someone types "7.5" into an hours field, split it
    // into 7h 30m on blur instead of silently truncating to 7. A live "= 7h 30m"
    // preview shows while typing so the on-blur split is never a silent surprise.
    HM_PAIRS.forEach(({ hId: h, mId: m }) => {
      /** @type {HTMLElement} */ (document.getElementById(h)).addEventListener('input', () => decPreview(h));
      /** @type {HTMLElement} */ (document.getElementById(h)).addEventListener('blur', () => autoDecimalHours(h, m));
    });

    // Peer training stepper — through wireIosTap, like the period arrows (the field in hand commits first)
    wireIosTap(/** @type {HTMLElement} */ (document.getElementById('peerMinus')), () => stepPeer(-1), { releaseFocus: true });
    wireIosTap(/** @type {HTMLElement} */ (document.getElementById('peerPlus')),  () => stepPeer(1), { releaseFocus: true });

    // Back-pay inputs. New fields: a manual edit just recalcs. Old fields + the "Pay rise %"
    // shortcut: re-derive the New figures from Old × (1 + %) when a % is present, then recalc.
    ['newRateInput','newLondon'].forEach(/** @param {string} id */ id => {
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('input', _runCalcBackPay);
    });
    ['oldRate','oldLondon','bpRisePct'].forEach(/** @param {string} id */ id => {
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('input', _applyBpRisePct);
    });
    // Amount-source toggle + manual amount: flipping the mode shows/hides the field group and
    // recomputes; typing the manual figure recomputes.
    document.getElementsByName('bpMode').forEach(/** @param {any} r */ r =>
      r.addEventListener('change', () => { applyBpMode(); _runCalcBackPay(); }));
    document.getElementById('bpManualAmt')?.addEventListener('input', _runCalcBackPay);

    // HPP amount-source toggle + manual inputs: flip the mode → show/hide the matching field group,
    // persist the choice for the viewed tax year, and recompute (calculate() → calcHPP reads the mode
    // and writes the resulting figure to hppEstKey, so the January take-home add is unchanged).
    const _saveHppForViewedYear = () => {
      const _hp = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
      saveHppState(taxYearForPeriod(_hp));
    };
    document.getElementsByName('hppMode').forEach(/** @param {any} r */ r =>
      r.addEventListener('change', () => { applyHppMode(); _saveHppForViewedYear(); calculate(); }));
    // 'ytd' mode has no input of its own — it reads the Year to Date card, and editing that card
    // already re-runs calculate() (→ calcHPP), so the HPP auto-updates. Only 'exact' has an input.
    document.getElementById('hppExactAmt')?.addEventListener('input', () => { _saveHppForViewedYear(); calculate(); });

    // Card collapse toggles — shared initCardCollapse (overlay.js) adds keyboard +
    // aria-expanded support. Passing the header id as the chevron id toggles .open
    // on the header itself, which drives the .card-toggle-arrow rotation in CSS.
    initCardCollapse('settingsToggle',    'settingsBody',    'settingsToggle');
    initCardCollapse('payslipCardToggle', 'payslipCardBody', 'payslipCardToggle');
    initCardCollapse('hppCardToggle',     'hppCardBody',     'hppCardToggle');
    initCardCollapse('payTransferToggle', 'payTransferBody', 'payTransferToggle');
    initCardCollapse('backPayCardToggle', 'backPayBody',     'backPayCardToggle',
      /** @param {any} open */ open => {
        if (!open) return;
        // prefillBackPay fills the rate boxes for the selected award year; _applyBpRisePct then
        // derives the New rate/London from any defaulted "Pay rise %" (unconfirmed award). Shared
        // with onPeriodChange so a year switch while open re-prefills.
        _refreshBackPayCard();
      });

    // The back-pay breakdown, its paid-in payslip and its opt-in tick; Save settings
    /** @type {HTMLElement} */ (document.getElementById('bpBreakdownBtn')).addEventListener('click', toggleBpBreakdown);
    /** @type {HTMLElement} */ (document.getElementById('backPayPeriod')).addEventListener('change', _runCalcBackPay);
    /** @type {HTMLElement} */ (document.getElementById('bpIncludeTick')).addEventListener('change', _runCalcBackPay);
    wireIosTap(/** @type {HTMLElement} */ (document.getElementById('saveSettingsBtn')), () => confirmSettings(calculate), { releaseFocus: true });

    // Hours card — show more toggle
    /** @type {HTMLElement} */ (document.getElementById('hoursShowMore')).addEventListener('click', toggleHoursExtra);

    // The sticky take-home bar — the page's only keep-the-£-in-view; every guard in it answers a
    // reported iOS behaviour no headless browser reproduces, argued in paycalc-sticky-total.js.
    initPaycalcStickyTotal();

    // Roster fill — "Fill blank fields" + the per-category "Fill →" buttons — through wireIosTap, not
    // a bare click: with the soft keyboard up (the normal state on this form) iOS cancels the click as
    // the keyboard drops, so "Replace with calendar values" did nothing — staff-reported, and the same
    // failure as the ± sign button below.
    const _fillBtn = document.getElementById('fillFromRosterBtn');
    if (_fillBtn) wireIosTap(_fillBtn, () => fillFromRoster(autosave));

    // Per-category fill buttons are dynamically rendered inside #rosterRows — delegation on the
    // container (which survives re-renders), through the same iOS tap guard.
    const _rosterRows = document.getElementById('rosterRows');
    if (_rosterRows) wireIosTap(_rosterRows, e => {
      const catBtn = /** @type {Element} */ (e.target).closest('[data-cat]');
      if (catBtn) fillCategoryFromRoster(/** @type {HTMLElement} */ (catBtn).dataset.cat || '', autosave);
    });   // (closes the wireIosTap action)

    // An edit makes the whole PAIR the member's (one pair, one author — _suggestIfBlank), so both boxes
    // lose the highlight — in the CAPTURE phase, before the field's own autosave → calculate() reads
    // the class for the "Hours from calendar" chip, which otherwise outlived the edit.
    document.getElementById('hoursCard')?.addEventListener('input', e => {
      const pair = HM_PAIRS.find(p => p.hId === /** @type {HTMLElement} */ (e.target).id || p.mId === /** @type {HTMLElement} */ (e.target).id);
      if (!pair) return;
      for (const id of [pair.hId, pair.mId]) document.getElementById(id)?.classList.remove('roster-suggested');
      updateRosterHint();
    }, true);

    // Settings inputs
    /** @type {HTMLElement} */ (document.getElementById('gradeSelect')).addEventListener('change', () => {
      // Preserve a hand-entered pension: replace it only while it still holds the PREVIOUS grade's
      // default, so tapping the grade just to check it never wipes a figure copied off a payslip.
      // lsGet(SK.grade) still holds the previous grade until saveSettings() runs.
      const _oldGrade = lsGet(SK.grade);
      const _gP = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());

      const _pa = /** @type {HTMLInputElement | null} */ (document.getElementById('pensionAmt'));
      const _oldPenDefault = (_oldGrade && GRADES[_oldGrade] && _gP)
        ? (getPensionForPeriod(_oldGrade, _gP.payday) * getProRateFactor(_gP)).toFixed(2)
        : '';
      const penUntouched = !_pa || _pa.value.trim() === '' || _pa.value === _oldPenDefault;

      saveSettings(); // calls invalidateGrade() so getGrade() returns the new grade below
      // The hourly rate is fixed by grade and read-only: reload the new grade's rate for this payslip.
      if (_gP) updateRateForPeriod(taxYearForPeriod(_gP), _gP);
      if (_pa && penUntouched) _pa.value = periodDefaultPension(_gP).toFixed(2);
      // Recompute the back-pay card for the NEW grade: its saved blob holds the old grade's award
      // rates, and without this the stale lump stayed in read-only boxes with no way to repair it.
      // calcBackPay re-enforces AWARD_RATES (and saves the corrected figures); _applyBpState re-prices
      // only if the lump changed, so the calculate() below stays for the pension and rate.
      _runCalcBackPay();
      calculate();
    });
    // No #hourlyRate listener — the rate is read-only and grade-derived.
    /** @type {HTMLElement} */ (document.getElementById('taxCode')).addEventListener('input',     () => { saveSettings(); calculate(); });
    document.getElementById('taxCode')?.addEventListener('blur', calculate);   // its warning waits for the box to be left
    /** @type {HTMLElement} */ (document.getElementById('studentLoan')).addEventListener('change', () => {
      // Clear the "not deducted this period" skip only when NO loan is active (plan none AND no PGL) —
      // a Postgraduate Loan on its own still uses the skip row.
      const _pg = /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked;
      if (/** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value === 'none' && !_pg) {
        /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked = false;
      }
      saveSettings();
      persistSetting(['slSkip'])();   // the cleared skip flag, and nothing else
    });
    // The student-loan stop is a SETTING: persist + recompute, so the payslip on screen follows it.
    document.getElementById('slPaidOffFrom')?.addEventListener('change', () => { saveSettings(); calculate(); });
    // Postgraduate Loan flag — a SETTING (like the plan), repayable ALONGSIDE a plan. Reveal the
    // "not deducted this period" row when either loan is active; the toggle is handled in calculate().
    /** @type {HTMLElement} */ (document.getElementById('pgLoanCheck')).addEventListener('change', () => {
      const _slNone = /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value === 'none';
      if (_slNone && !(/** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked)) {
        /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked = false;
      }
      saveSettings();
      persistSetting(['slSkip'])();
    });
    // pensionAmt: the figure belongs to THIS payslip — autosave() stores it in the period's own blob
    // (pensionToStore: one equal to the period default stores null, so the payslip keeps following
    // PENSION_STEPS) and calls calculate() itself; saveSettings() keeps the member-level settings.
    /** @type {HTMLElement} */ (document.getElementById('pensionAmt')).addEventListener('input',  () => { saveSettings(); autosave(); });
    // The pension card's two controls are wired by the module that owns the card's rules; the
    // coordinator supplies only how to persist. Keeping the wiring beside `buildPensionFromSelect` /
    // `applyPensionOptOutUI` is what stops the tick, the date and the field falling out of step.
    wirePensionControls({ autosave: persistSetting(['pension']) });

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
    // The ± sign, through wireIosTap (paycalc-inputs.js): tapped with the number field focused, iOS
    // drops the keyboard first and cancels the click — this button is where that was first measured.
    wireIosTap(/** @type {HTMLElement} */ (document.getElementById('adjSignBtn')), () => {
      _adjNegative = !_adjNegative;
      const input = /** @type {HTMLInputElement} */ (document.getElementById('otherAdj'));
      const val   = parseSmartFloat(input.value);
      // Only negate the value when it is nonzero — at zero the button marks intent, so the next
      // number typed shows as negative.
      if (val !== 0) input.value = Math.abs(val).toFixed(2);
      updateAdjSign();
      autosave();
    });

    // Payslip card inputs
    // Year to Date figures: stamp the source payslip on first entry (the latest paid one, where the
    // totals almost always come from), and move an older one to the payslip the take-home line names
    // when they are typed in again (ytdSourceAfterRetype); then persist + recalc. The select corrects it.
    // "Again" is figures already in the boxes when the edit began (_ytdOver — the two boxes are one
    // edit), and never a source picked in the select this visit (_ytdKeep): typed into empty boxes, or
    // after a pick, the figures come from the payslip the member chose, and moving it lost that choice.
    let _ytdOver = false; const _ytdKeep = new Set();
    const _ytdFigureInput = () => {
      saveSettings();
      const _p2  = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
      const _ty2 = taxYearForPeriod(_p2);
      const _raw = lsGet(ytdSrcKey(_ty2));
      const _moved = _ytdOver && !_ytdKeep.has(_ty2.label) ? ytdSourceAfterRetype(_raw, { p: _p2, ty: _ty2 }) : null;
      if (_moved != null) lsSet(ytdSrcKey(_ty2), String(_moved));
      if (_moved != null || !_raw) _refreshYtdSrc(_ty2);
      calculate();
    };
    for (const id of ['ytdPay', 'ytdTax']) {
      const el = /** @type {HTMLElement} */ (document.getElementById(id));
      el.addEventListener('focus', e => { if (!['ytdPay', 'ytdTax'].includes(/** @type {any} */ (e).relatedTarget?.id)) _ytdOver = _ytdHasFigures(); });
      el.addEventListener('input', _ytdFigureInput);
    }
    /** @type {HTMLElement} */ (document.getElementById('ytdSrcSelect')).addEventListener('change', () => {
      const _p2  = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
      const _ty2 = taxYearForPeriod(_p2);
      _ytdKeep.add(_ty2.label);
      const _v = /** @type {HTMLSelectElement} */ (document.getElementById('ytdSrcSelect')).value;
      // Picking the blank placeholder un-anchors the figures: record an explicit '0', so calculate()
      // drops to the standard method — as the note now says — and the un-anchor PERSISTS. Deleting
      // the key instead let the load-time stamp re-anchor them on the next period change, as the
      // figures remain; '0' is a recorded value it leaves alone (ytdSourceToStamp).
      if (_v) lsSet(ytdSrcKey(_ty2), _v); else lsSet(ytdSrcKey(_ty2), '0');
      calculate();   // which rewrites the note and chip
    });

    // The prior year's confirmed premium commits on `change` (leaving the field), NEVER on `input`:
    // commitPriorHppActual (paycalc-hpp.js) says what per-keystroke commits did to a confirmed figure.
    /** @type {HTMLElement} */ (document.getElementById('priorHppActualInput')).addEventListener('change', () => {
      const curP = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
      commitPriorHppActual(taxYearForPeriod(curP), /** @type {HTMLInputElement} */ (document.getElementById('priorHppActualInput')).value);
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

    // ── LIGHTBOXES — About, Help, the Year to Date notice, the data-ownership prompt, the developer's
    // payslip import, and the decimal converter card: paycalc-lightboxes.js, whose header lists them
    // (the Welcome lightbox was retired at v19.36). Returns the About open handle so the nav-panel
    // drawer logo can open the same panel.
    const { openAboutLightbox, showYtdNotice } = initPaycalcLightboxes();

    // (The service worker is registered at the top of init(), before the sign-in gate. Never a second
    // lifecycle here: two controllerchange listeners and two update() timers fired the reload twice.)

    // Establish the Firebase Auth session BEFORE starting error reporting: a valid 60-day local
    // session can outlive the Firebase one, and clientErrors writes are then rejected by the rules
    // and silently dropped — exactly when the report is wanted. The reporter starts whatever the
    // outcome, so synchronous init errors are still captured locally.
    // The settle promise is kept for the nav drawer's Circular/Newsletter read (AUTH_PLAN.md → E1):
    // paycalc, the one `soft` page, owns its auth chain and has no `sessionReady`. It always RESOLVES
    // (the .catch below swallows a failed sign-in), so the drawer read never hangs on an identity
    // this page does not require.
    let _paycalcAuthSettled = Promise.resolve();
    (function _initErrorReporting() {
      const name = getSession()?.name;
      const afterAuth = () => {
        initErrorReporter(); recordUsage('paycalc', name ?? null); recordPageLatency('paycalc', name ?? null);
        // Forced set-password overlay (PASSWORD_DESIGN.md Phase 2). No `ready` barrier is passed: this
        // callback ALREADY runs after ensureNamedSession has settled, so getAuthSnapshot() is the
        // terminal identity — and on this one `soft` page a member can arrive locally signed in with a
        // FAILED Firebase session, where the overlay's `named`-only gate stops a block they could
        // never satisfy.
        // The Year to Date notice queues BEHIND it, on the promise `initPasswordForce` returns for
        // exactly that ("the next overlay that has to queue behind this one"), or it opens in front of
        // a set-password block the member cannot dismiss. No branch on the result: if the overlay is
        // up, `openNoticeIfClear` defers the notice to the next load. `.catch` because a failed
        // password overlay must never cost the member their notice — it fails open by design.
        initPasswordForce(name, {}).catch(() => {}).finally(() => showYtdNotice());
      };
      // SOFT enforcement (AUTH_ARCHITECTURE.md Phase 7): the calculator keeps its data on the device
      // and writes no isolated data, so a degraded or anonymous session must NEVER block it — being
      // `soft`, requirePage('paycalc') returns only 'allow' or 'soft-allow', and 'soft-allow' (the
      // member's own session unconfirmed) is only logged. ensureNamedSession feeds the auth store.
      if (name) _paycalcAuthSettled = ensureNamedSession(name)
          .then(() => { if (requirePage(getAuthSnapshot(), 'paycalc').decision === 'soft-allow') console.warn('[Auth] paycalc running without a named session — error reporting may not record.'); })
          .catch(() => {/* reporter still starts below */})
          .finally(afterAuth);
      else afterAuth();
    }());

    // ── THE PICKER SHEETS, THE BACKUP CARD AND THE LATE WIRING ─────────────────────
    // Every dropdown here opens the app's own sheet rather than the OS one: the period picker is the
    // page's primary control, and the rest join it so the calculator has ONE kind of dropdown. A
    // title is also the control's accessible name, so it carries its field's visible label word for
    // word (paycalc-copy-parity.test.mjs) — and the loan stop never says "paid off" (paycalc.md).
    initSelectSheets([
        { id: 'periodSelect',      title: 'Which pay period?' },
        { id: 'gradeSelect',       title: 'Your grade' },
        { id: 'studentLoan',       title: 'Student loan plan' },
        { id: 'pensionOptOutFrom', title: 'Not in the scheme from which payslip?' },
        { id: 'slPaidOffFrom',     title: 'Student loan stopped being deducted?' },
        { id: 'ytdSrcSelect',      title: 'From which payslip?' },
        { id: 'backPayPeriod',     title: 'Which payslip carries this lump sum?' },
    ], { createLightbox });

    initTransferCard();   // late: the backup card reads the per-member namespace runMigrations() chose
    // The Calendar's Year to Date notice links to #payslipCard: open that card, held in view.
    openCardNamedByHash('payslipCard', 'payslipCardBody', 'payslipCardToggle');
    wireYtdLine();   // the take-home's Year to Date line opens the same card (paycalc-result-headline.js)
    wireSettingsCard({ openCardNamedByHash });   // its desktop place in the Tab order, and the banner's link to it
    // Pay data is localStorage-only and evictable until asked otherwise — see ls.js.
    requestPersistentStorage(pcPrefix());
    // The year card's fill control. After a bulk fill: reload the visible form ONLY if it was one of
    // the filled periods (loadPeriodData re-reads storage and restores the gold suggested state), then
    // recalculate, which re-renders the year block, its receipt and the HPP the new hours feed.
    initYearCard({
      afterFill: (r) => {
        if (r.filled.some((/** @type {any} */ p) => p.num === currentPeriodNum())) loadPeriodData(currentPeriodNum());
        calculate();
      },
    });

    // ── PRINT HEADER STAMP ────────────────────────────────────────────────────────
    // iOS Safari fires no beforeprint for AirPrint, so the stamp is also written on load and by every
    // onPeriodChange(); the beforeprint handler is for the desktop browsers.
    function stampPaycalcPrintLine() {
      const hdr = document.querySelector('.app-header');
      if (!hdr) return;
      const periodSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('periodSelect'));
      const p = periodSel ? getPeriods().find(/** @param {any} x */ x => x.num === +periodSel.value) : null;
      // With a time, and the date in the app's own words — roster-data.js → "the provenance line
      // every printable surface closes on".
      const printedNow = new Date();
      const now = printedStamp(printedNow, formatClock(printedNow));
      // "Pay Calculator", never the old MYB name: the app is "Marylebone Roster" on screen, and a
      // print header is where a stale name leaves the app on paper.
      const label = p ? `Paid ${fd(p.payday)} (P${payslipPeriodNum(p)}) · ${now}` : `Pay Calculator · ${now}`;
      hdr.setAttribute('data-print-line', label);
    }
    stampPaycalcPrintLine();
    window.addEventListener('beforeprint', stampPaycalcPrintLine);

    // A LITERAL options object at every initNavPanel call, on purpose: page-contract-parity
    // brace-matches each call's options to prove a role-gated pill gets its gate from EVERY page, and
    // a shared config would be invisible to it. The duplication with `_showUnsupportedRole` is the
    // price of a guard that can still see what it is guarding.
    const _paycalcMember = getLoggedMember();
    initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_PLAN.md → E1).
        authReady: _paycalcAuthSettled,
        currentPage: 'paycalc',
        memberName:  _paycalcMember?.name || null,
        isAdmin:         ROSTER_CONFIG.ADMIN_NAMES.includes(_paycalcMember?.name ?? ''),
        isLinksDesigner: ROSTER_CONFIG.LINKS_DESIGNERS.includes(_paycalcMember?.name ?? ''),
        canOpenOvertime: canOpenOvertime(_paycalcMember?.name ?? ''), canOpenNewlink: canOpenNewlink(_paycalcMember?.name ?? ''),
        onLogoClick: () => openAboutLightbox?.(),
        // signOutAndLeave replaces, not navigates: the pay page leaves the history, so Back cannot
        // restore it (and its figures) from the bfcache for whoever picks the shared device up next.
        onSignOut:   _paycalcMember ? () => signOutAndLeave({ to: './' }) : null,
    });
    // (About's print button is about-lightbox.js's; a copy here once left the page scroll-locked.)
}
