// @ts-check
/**
 * paycalc-app.js — Pay Calculator coordinator for paycalc.html.
 *
 * Owns: onPeriodChange, calculate, autosave, WHEN a period is saved and loaded, INIT, event wiring.
 * Does NOT own: period arithmetic and the Year to Date source rules (paycalc-periods.js), grade,
 *   settings, the rate and what the Settings card says for a tax year (paycalc-settings.js), the roster
 *   hint bar (paycalc-roster-hint.js), HPP (paycalc-hpp.js), back pay (paycalc-backpay.js), pay maths
 *   AND what the payslip on screen is priced on (paycalc-calc.js → takeHomeInputs), HOW a field
 *   persists (paycalc-form-data.js), the result card's markup (paycalc-breakdown.js), the sticky
 *   take-home bar (paycalc-sticky-total.js), the Year to Date card's wiring (paycalc-ytd-card.js), the
 *   money banners' ticks and links (paycalc-money-banner.js) and the two-tap Clear
 *   (paycalc-clear-confirm.js).
 * A new RULE belongs in one of those, not here — coordinator-ratchet.test.mjs holds this file's size.
 *
 * The body is an exported init(), called by paycalc-boot.js (CSP `script-src 'self'` blocks inline
 * module scripts), so importing this module runs nothing and the sign-in gate can early-`return`.
 */

import { initSelectSheets } from './select-sheet.js';
import { formatISO, parseSmartFloat, parseSmartFloatOrNull } from './roster-data.js';
import { printedStamp, formatClock } from './date-format.js';
import {
  RATE_125, RATE_150, RATE_300,
  taxYearForPeriod, getThresholds,
  payslipGross, pricePayslip, takeHomeInputs,
} from './paycalc-calc.js';
import { resetOverrides } from './paycalc-roster-suggestions.js';
import { lsGet, lsSet, lsDel, lsKeys, lsAvailable, requestPersistentStorage } from './ls.js';
import { getSession, ensureNamedSession, reconcileExpiredIdentity } from './session.js';
import { requirePage, navGatesFor } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { paintRoleCard, PAYCALC_SIGN_IN_ABOUT } from './paycalc-role-card.js';
import { signOutAndLeave } from './page-session.js';
import { startPage } from './page-start.js';
import {
  CONFIG, getPeriods, currentPeriodNum, periodByNum, viewedPeriod, todaysPeriodNum, payslipPeriodNum,
  hasBoxingDay, hasBankHoliday,
  updateBhRows, buildPeriodSelect,
  updateTyTabs, jumpToTaxYear, prevPeriod, nextPeriod,
  setEarliestVisiblePeriod, isTaxYearVisible, visiblePeriods,
  _setSelectPeriod, payslipMayBeInHand, ytdUpdateFrom,
  appendPayslipOptions, payslipsShownTo,
} from './paycalc-periods.js';
import { payCalculatorPrices } from './pay-audience.js';
import {
  getEffectiveContr, getLoggedMember, getProRateFactor, getPensionDefault,
  applyPensionOptOutUI, wirePensionControls, periodDefaultPension, unpricedLineFor,
  updateRateForPeriod, updateYtdForTaxYear, paintSettingsForYear,
  saveSettings, confirmSettings, loadSettings, periodRate, wireSettingsCard,
} from './paycalc-settings.js';
import {
  updateRosterHint, updateJoinerNotice, toggleRosterDays,
  fillCategoryFromRoster, fillFromRoster, refreshFromCalendarInBackground,
  clearRosterSuggestedAll, _restoreRosterSuggested, snapKey, HM_PAIRS, recordCalendarFigures,
} from './paycalc-roster-hint.js';
import { calcHPP, commitPriorHppActual, resolveHppForPeriod, applyHppMode, restoreHppState, saveHppState } from './paycalc-hpp.js';
import {
  _bpAwardTaxYear, _backdatedFromPNum, applyBpMode, bpState, onBackPayChange,
  runCalcBackPay, applyBpRisePct, refreshBackPayCard, syncBackPayForViewedYear,
} from './paycalc-backpay.js';
import { hppTaxYearForPayslip } from './paycalc-hpp-schedule.js';
import { initNavPanel } from './nav-panel.js';
import { initCardCollapse, createLightbox, openCardNamedByHash } from './overlay.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady, clearLoginStart } from './perf-reporter.js';
import { SK, pcPrefix, periodKey, hppEstKey, hppActualKey, hppIncKey, ytdSrcKey, runMigrations, readPayslipActuals, isActualsDev, parseSavedPeriod } from './paycalc-migrations.js';
import { initPaycalcLightboxes, initPaycalcAbout } from './paycalc-lightboxes.js';
import { fdShort, fdLong, fmt, minutesFieldText, isDataEmpty } from './paycalc-format.js';
import { initYearCard, renderYearCard } from './paycalc-year-card.js';
import { numVal, hhmmDec, clampMins, _decHintEl, decPreview, wireIosTap, commitFocusedField, paintTaxCodeWarning, hoursTextToHM } from './paycalc-inputs.js';
import { emptyPeriodData, readFormData, writeFormData, settingFieldsWrite, syncNoSpecialTick } from './paycalc-form-data.js';
import { initTransferCard } from './paycalc-transfer-card.js';
import { classifyPayKey } from './paycalc-inventory.js';
import { buildSummaryRows, buildLoanLines, buildBreakdownRows, buildProvChips, buildBreakBar } from './paycalc-breakdown.js';

import { setStatus } from './status-text.js';
import { renderResultHeadline, renderYtdLine, wireYtdLine, renderUnpricedPayslip, renderActualCheck } from './paycalc-result-headline.js';
import { backPayBannerCopy, hppBannerCopy, paintBanner, wireBannerTicks } from './paycalc-money-banner.js';
import { initPaycalcStickyTotal } from './paycalc-sticky-total.js';
import { createClearConfirm } from './paycalc-clear-confirm.js';
import { refreshYtdSrc, updateYtdNote, wireYtdCard } from './paycalc-ytd-card.js';
import { setDisclosure, toggleDisclosure, toggleHoursExtra, toggleHppNote, toggleBD, toggleDisclaimer } from './paycalc-disclosures.js';

/**
 * May the drawer's two document links read (nav-panel.js `canReadDocuments`)? Only while `name` is still
 * this device's session: Pay is the one `soft` page, and offline the read answers from the device's
 * cache without asking a rule, so a session ended in another tab would still open what it left there.
 * @param {string|null|undefined} name the member the page was drawn for
 * @returns {() => boolean}
 */
const paycalcDocsGate = (name) => () => !!name && getSession()?.name === name;

/**
 * Withhold the calculator from a role it has no confirmed rates for, and say why.
 * Rationale: `gradeForRole`'s JSDoc (roster-data.js). It WITHHOLDS rather than captioning (a member
 * told "this may not apply" and handed a confident £ will use it), and it still wires the drawer, so
 * it is a refusal with a way out.
 * @param {any} member the signed-in teamMembers entry
 */
function _showUnsupportedRole(member) {
    // A BODY CLASS, never the `hidden` attribute: `.pc-side` is `display: contents` on mobile and
    // both are `flex` on desktop, each of which out-specifies `hidden`'s UA rule, so the
    // calculator would render in full while this code believed it was gone. See paycalc.css.
    document.body.classList.add('role-unsupported');
    document.getElementById('unsupportedGradeBanner')?.classList.remove('hidden');
    paintRoleCard(member);   // the words differ by who is reading — paycalc-role-card.js
    // About and the header logo, as on every page.
    const openAboutLightbox = initPaycalcAbout();
    initNavPanel({
        currentPage: 'paycalc',
        memberName:  member?.name || null,
        canReadDocuments: paycalcDocsGate(member?.name),
        ...navGatesFor(member?.name),   // the pill gates (auth-policy.js), as on every page
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut: () => signOutAndLeave({ to: './' }),
    });
    markPageReady();
    recordUsage('paycalc', member?.name || null);
}

export function init() {
    registerServiceWorker();   // BEFORE the sign-in gate, as Operations/Links: a signed-out view must still take an update
    // Tear down a lingering privileged Firebase identity whose local session has expired — BEFORE the
    // session guard's early return, as the expired path is exactly where one lingers. Fire-and-forget
    // and login-safe: a no-op on a valid session, and it stands down if a sign-in supersedes it.
    reconcileExpiredIdentity().catch(() => {});   // it handles and logs its own failures; this only keeps an unexpected one from going unhandled

    // ── THE START-UP (page-start.js): the Back guard BEFORE any decision, so no early return can skip it
    // (a bfcache restore does not re-run init(), so Back after a sign-out could show the previous member's
    // figures) — then the decision, the in-place sign-in (init() runs again, once, and runMigrations()
    // selects the right namespace — AUTH_ARCHITECTURE.md Phase 9) and the refusal.
    //
    // The decision is the page's OWN, not requirePage('paycalc') (AUTH_ARCHITECTURE.md Phase 7): the policy is
    // `soft`, which NEVER returns 'login', but the calculator namespaces its per-member storage (pcPrefix/SK)
    // by name, so a *local name* is a hard precondition. `soft` governs only the Firebase confirmation
    // (_initErrorReporting below), hence `establish: false`: this page owns its auth chain. "Simplifying" this
    // into requirePage would render with no identity. getSession() enforces the 60-day absolute expiry.
    //
    // A ROLE WITH NO CONFIRMED RATES REFUSES RATHER THAN GUESSING (the grade lookup reads "no grade" as
    // CEA everywhere). Decided here, before every other init step, so nothing can render a figure first —
    // and AGAIN for whoever signs in on this page's own card. Why: `gradeForRole`'s JSDoc (roster-data.js).
    // It asks the role AT THE TIME (owner, 16 Nov 2026; pay-audience.js): each payslip under a role with no
    // rates is refused on its own (calculate(), unpricedLineFor).
    //
    // A SESSION NAME THE ROSTER DOES NOT HOLD REFUSES TOO: a leaver or renamed member keeps a valid local
    // session and `getLoggedMember()` returns null — run on, the calculator would price at CEA rates in the
    // bare `myb_pc_` namespace, the shared legacy keys of everyone on the device.
    if (!startPage({ page: 'paycalc', label: 'Pay Calculator', about: PAYCALC_SIGN_IN_ABOUT, again: init, establish: false,
        decide: (session) => {
            if (!session?.name) return { decision: 'login', reason: 'no local member — the calculator keys every figure by name' };
            const member = getLoggedMember();
            return payCalculatorPrices(member, { periods: payslipsShownTo(member) })
                ? { decision: 'allow', reason: 'a role this calculator has rates for' }
                : { decision: 'forbidden', reason: 'no confirmed rates for this role, or a name the roster does not hold' };
        },
        refuse: (_decision, { member }) => {
            // No calculator follows, so nothing will read the sign-in timer: drop it, or the next page
            // opened within two minutes would count this visit as its sign-in time.
            clearLoginStart();
            _showUnsupportedRole(getLoggedMember() ?? { name: member });
        } })) return;

    // ── COORDINATOR STATE ─────────────────────────────────────────────────────────
    // The back-pay card keeps its own state (bpState, paycalc-backpay.js); calculate() reads it to add
    // the lump into that period's gross before tax/NI, and re-prices whenever it changes.
    onBackPayChange(() => calculate());

    // The default period num selected on page load (first upcoming payday), for the ● today button.
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

    // "7.5" (or "7,5", or "7:30") in an hours field splits into 7 hrs 30 mins on blur rather than
    // truncating to 7; the live preview (decPreview) has already shown it.
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
     * The Saturday contracted-hours cap. It does not re-price: every caller follows it at once with
     * `autosave()`, which ends in `calculate()`, so a run here priced the same screen twice.
     *
     * CAPPED WHEN THE BOX IS LEFT, WARNED WHILE TYPING: capping per keystroke rewrote an edit passing
     * through a larger number ("32" to "36" reads 362 for a moment) to the cap. Nothing is overpaid
     * meanwhile: the pay maths caps Saturday hours itself (`capHours`, paycalc-calc.js).
     * @param {string} hId
     * @param {string} mId
     * @param {string | null} warnId
     * @param {{ cap?: boolean }} [opts]  `cap: false` while the member is still typing in the pair
     * @returns {boolean} whether it REWROTE the boxes (capped them) — the one case leaving the box must save
     */
    function onHhMm(hId, mId, warnId, { cap = true } = {}) {
      // Validate Saturday hours don't exceed contracted hours (pro-rated for joining periods)
      if (warnId) {
        const hrs   = hhmmDec(hId, mId);
        const warn  = document.getElementById(warnId);
        const curP  = viewedPeriod();
        const contr = getEffectiveContr(curP);
        if (hrs > contr && !cap) {
          if (warn) { setStatus(warn, `⚠ More than ${contr} hrs, your contracted maximum for this period — it is capped there when you leave the box`); warn.classList.add('show'); }
        } else if (hrs > contr) {
          /** @type {HTMLInputElement} */ (document.getElementById(hId)).value = String(contr);
          /** @type {HTMLInputElement} */ (document.getElementById(mId)).value = minutesFieldText(0);
          if (warn) { setStatus(warn, `⚠ Capped at ${contr} hrs — your contracted maximum for this period`); warn.classList.add('show'); }
          return true;
        } else {
          if (warn) warn.classList.remove('show');
        }
      }
      return false;
    }

    function onPeriodChange() {
      _clearConfirm.reset();   // switching payslip disarms a pending two-tap Clear (paycalc-clear-confirm.js, rule 4)
      const pNum    = +/** @type {HTMLSelectElement} */ (document.getElementById('periodSelect')).value;
      const p       = periodByNum(pNum);
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

      const ty = taxYearForPeriod(p);
      const startStr = fdShort(p.start);
      const cutLongStr = fdLong(p.cutoff);
      // The payday is NOT repeated here (the select already reads "Paid 31 July 2026 · P20"): the meta
      // row carries the shift window, LABELLED "Hours worked", and the tax year; the P-badge cross-checks.
      /** @type {HTMLElement} */ (document.getElementById('pmRange')).textContent   = `Hours worked ${startStr} – ${cutLongStr}`;
      /** @type {HTMLElement} */ (document.getElementById('pmSub')).textContent     = `Tax year ${ty.label}`;
      /** @type {HTMLElement} */ (document.getElementById('periodBadge')).textContent = `P${payslipPeriodNum(p)}`;
      // fdLong, not fd: the picker above says "Paid 28 August 2026", and the most-read line of the page
      // must not spell the same date "28 Aug 26" a foot below it.
      /** @type {HTMLElement} */ (document.getElementById('netPeriod')).textContent   = `Paid ${fdLong(p.payday)}`;

      const boxing = hasBoxingDay(p);
      /** @type {HTMLElement} */ (document.getElementById('boxingBanner')).classList.toggle('visible', boxing);
      /** @type {HTMLElement} */ (document.getElementById('boxingRow')).classList.toggle('hidden', !boxing);
      // No blanking of the hidden Boxing Day boxes: loadPeriodData writes every box from the payslip's
      // saved entries, and calculate() reads Boxing Day hours only where the payslip has one.

      updateTyTabs();

      // The tax-year chip on the back-pay, HPP and Year to Date headers says WHICH year each card is
      // editing, even shut — COMPACT ("26/27"), as the full form wrapped the longest title on a phone.
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

      // Year to Date figures are stored per tax year WITH the payslip they came from (see calculate()).
      refreshYtdSrc(ty);

      // This tax year's HPP amount source, restored BEFORE loadPeriodData() runs calculate() (calcHPP
      // reads the mode), so each year shows its own choice.
      restoreHppState(ty);
      // The pension field's "for the … payslip" label.
      const pensionPeriodLbl = document.getElementById('pensionPeriodLabel');
      if (pensionPeriodLbl) pensionPeriodLbl.textContent = `for the ${fdShort(p.payday)} payslip`;

      // The Settings card's hint, the setup banner and the "New tax year" notice for this payslip's
      // tax year (paycalc-settings.js → paintSettingsForYear says what each shows, and when).
      paintSettingsForYear(ty, p);

      updateBhRows(p);

      // The rate-unconfirmed notices show ONLY on TODAY'S payslip (owner): warning on all 13 buried it.
      // todaysPeriodNum(), NOT currentPeriodNum() — which is the SELECTED period, so comparing it with
      // p.num is always true. Shown in Settings and on the result card, so it is seen with Settings shut.
      const _rateUnconfirmed = !!ty.rateUnconfirmed && p.num === todaysPeriodNum();
      const _rateNoticeEl = document.getElementById('rateUnconfirmedNotice');
      if (_rateNoticeEl) _rateNoticeEl.classList.toggle('hidden', !_rateUnconfirmed);
      const _resultRateNotice = document.getElementById('resultRateNotice');
      if (_resultRateNotice) _resultRateNotice.classList.toggle('hidden', !_rateUnconfirmed);

      const session2 = getSession();

      // Reset the override cache before rendering the hint, setting the initial fetch state.
      resetOverrides(session2?.name ? 'checking' : 'base-only');

      // Collapse the day list — before updateRosterHint, so the later refresh doesn't re-close it.
      const _dayListEl    = document.getElementById('rosterDayList');
      const _daysToggleEl = document.getElementById('rosterDaysToggle');
      if (_dayListEl)    _dayListEl.style.display = 'none';
      if (_daysToggleEl) { _daysToggleEl.textContent = 'Show days ▼'; _daysToggleEl.setAttribute('aria-expanded', 'false'); }

      updateRosterHint();
      updateJoinerNotice(p);

      // Pay → Calendar link for this period
      const _rvl = /** @type {HTMLAnchorElement | null} */ (document.getElementById('rosterViewLink'));
      if (_rvl) _rvl.href = `./?date=${formatISO(p.start)}`;

      // Fetch admin-added overrides from Firestore in the background.
      if (session2?.name) {
        _hoursTouchedSinceFetch = false; // start watching for in-flight user edits
        // Display-only: it re-fills the gold fields and the £, and saves nothing (paycalc-roster-hint.js).
        refreshFromCalendarInBackground(p, session2.name, {
          calculate, touchedSinceFetch: () => _hoursTouchedSinceFetch, loadWasCorrupt: () => _periodLoadWasCorrupt,
        });
      }

      // Load saved data for this period (which also applies the pension opt-out lock before pricing)
      loadPeriodData(p.num);

      // The back-pay card follows the viewed payslip's award year ALWAYS, open or not, so the banner and
      // take-home reflect the payslip on screen; per-year keys keep each year's tick, rates and amount apart.
      syncBackPayForViewedYear();

      stampPaycalcPrintLine();
    }

    // ── PERIOD DATA SAVE / LOAD ───────────────────────────────────────────────────
    function updateAdjSign() {
      const btn = /** @type {HTMLElement} */ (document.getElementById('adjSignBtn'));
      btn.textContent = _adjNegative ? '−' : '+';
      btn.setAttribute('aria-label', _adjNegative ? 'Toggle sign: currently negative' : 'Toggle sign: currently positive');
      btn.classList.toggle('negative', _adjNegative);
    }

    /** The pension payslip `pNum`'s saved entries hold (null for none): `readFormData` keeps it while an
     *  opt-out locks the box, rather than storing the lock's £0.00 over it. @param {number} pNum */
    const _savedPension = (pNum) => parseSavedPeriod(lsGet(periodKey(pNum))).data?.pension ?? null;

    function autosave() {
      const pNum = currentPeriodNum();   // SAVED before calculate() below: HPP and the year card read storage
      const _autoP = periodByNum(pNum);
      const d    = readFormData({
        adjNegative: _adjNegative,
        periodDefaultPension: _autoP ? periodDefaultPension(_autoP) : null,
        savedPension: _savedPension(pNum),
      });
      try {
        lsSet(periodKey(pNum), JSON.stringify(d));
        recordCalendarFigures(pNum);   // the snapshot describes what was just saved: gold pairs at their saved values (paycalc-3-1)
        updateSaveStatus(pNum);
      } catch { /* storage unavailable */ }
      runCalcBackPay();   // the lump accrues from SAVED hours, so it re-prices from what was just saved (paycalc-2-2)
      calculate();
    }
    /** A SETTING changed: carry only `fields` into this payslip's readable saved entries, then re-price
     *  (`autosave` would save the calendar's suggestion too — see `settingFieldsWrite`). @param {string[]} fields */
    const persistSetting = (fields) => () => { const pNum = currentPeriodNum(), p = periodByNum(pNum);
      const w = settingFieldsWrite(lsGet(periodKey(pNum)), readFormData({ adjNegative: _adjNegative,
        periodDefaultPension: p ? periodDefaultPension(p) : null, savedPension: _savedPension(pNum) }), fields);
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
      // parseSavedPeriod tells CORRUPT from missing: unreadable entries must not pose as an empty form,
      // or the member could type over them unknowing. The form loads empty (nothing is deleted until
      // they type), and updateSaveStatus says so.
      const _parsed = parseSavedPeriod(lsGet(periodKey(pNum)));
      if (_parsed.data) d = _parsed.data;
      _periodLoadWasCorrupt = !!_parsed.error;   // gates the background fetch's auto-apply
      clearRosterSuggestedAll();   // writeFormData expects the gold highlights cleared first
      _adjNegative = writeFormData(d).adjNegative;
      _restoreRosterSuggested(pNum);
      // No pension saved for this payslip → its own default: the step for its payday (old payslips
      // keep the old rate) and the joining-period pro-rate.
      const _pObj = periodByNum(pNum);
      _paintDefaultPension(d.pension == null ? _pObj : null);
      // The pension LOCK follows the viewed payslip (a member who left the scheme in August still
      // contributes on their July one). AFTER the paint above and BEFORE calculate(): applied after it,
      // a payslip holding a saved figure was priced WITH that deduction beside a locked £0.00.
      if (_pObj) applyPensionOptOutUI(_pObj);
      updateAdjSign();
      // Open "more options" when this payslip has extras saved — through setDisclosure, so the
      // button's aria-expanded and arrow stay in step with it.
      const hasExtras = !!(d.slSkip || d.otherAdj);
      setDisclosure('hoursShowMore', 'hoursExtra', hasExtras, { arrowSel: '.show-more-arrow' });
      updateSaveStatus(pNum);
      calculate();
      // Refresh the hint AFTER the new period's values are written: onPeriodChange's earlier call
      // compared against the PREVIOUS period's hours. Display-only; always safe.
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
          const _pObj = periodByNum(pNum);
          const _hasCustomPension = d.pension != null && Math.abs(d.pension - periodDefaultPension(_pObj)) > 0.005;
          if (!isDataEmpty(d) || _hasCustomPension) {
            setStatus(el, '✓ Entries saved for this payslip');
            el.className   = 'save-status saved';
            return;
          }
        }
      }
      el.textContent = 'No entries saved for this payslip';
      el.className   = 'save-status unsaved';
    }

    // The two-tap "Clear all entries" (paycalc-clear-confirm.js holds its rules): the second tap runs
    // clearPeriod. Disarmed on a change of payslip (onPeriodChange) and when the tab is hidden, below.
    const _clearConfirm = createClearConfirm(document.getElementById('clearBtn'), clearPeriod);
    // On hide: disarm "Select again to confirm" (iOS fires a suspended timer at once on resume — an accidental wipe), and let
    // go of the field in hand, so a figure that commits only on `change` (prior-year HPP) is kept if the page never returns.
    document.addEventListener('visibilitychange', () => { if (document.hidden) { _clearConfirm.reset(); commitFocusedField(); } });

    /** Clear the payslip on screen — the confirmed second tap of "Clear all entries". */
    function clearPeriod() {
      const pNum = currentPeriodNum();
      lsDel(periodKey(pNum));
      lsDel(snapKey(pNum));
      // Mark the form as user-touched BEFORE blanking it: programmatic writes fire no 'input', so a
      // fetch in flight would otherwise refill + autosave the fields just cleared.
      _hoursTouchedSinceFetch = true;
      clearRosterSuggestedAll();   // writeFormData expects the gold highlights cleared first
      writeFormData(emptyPeriodData());
      _paintDefaultPension(periodByNum(pNum));   // writeFormData leaves a null pension blank
      _adjNegative = false;
      updateAdjSign();
      updateSaveStatus(pNum);
      runCalcBackPay();   // the lump accrues from SAVED hours, and these were just deleted — as autosave re-prices it
      calculate();
      // Refresh the roster card, so rows don't keep a ✓ against now-empty fields.
      updateRosterHint();
    }

    // The last breakdown render, so an identical string skips innerHTML's parse and layout. The
    // summary is not cached: a confirmed payslip's figures write it too (paycalc-result-headline.js).
    /** @type {string | null} */
    let _lastBdBodyHtml = null;

    // ── CALCULATION ENGINE ────────────────────────────────────────────────────────
    /** The hours rows' badges: the multiplier, and what it pays an hour on THIS payslip. A payslip with
     *  no rate (a role with no confirmed rates) shows the multiplier alone — never CEA's £ in its place,
     *  nor the last payslip's (invariant 13) — and the markup ships no £ at all. @param {number|null} rate */
    function updateBadges(rate) {
      /** @type {(r: number, mult: any) => string} */
      const f = (r, mult) => (rate == null ? `${mult}×` : `${mult}×  ·  £${(rate * r).toFixed(2)}/hr`);
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
      const _curP   = periodByNum(_pNum);
      if (!_curP) { renderYtdLine(null); return; }   // from here on there is always a payslip
      syncNoSpecialTick();   // hours on screen, typed or gold, supersede the no-special-rate-hours tick
      const _ty     = taxYearForPeriod(_curP);
      const thresholds = getThresholds(_ty.label);

      // The payslip's rate from the one source the rate field and the Settings hint also read
      // (periodRate): its grades' rates weighted by their days, UNROUNDED — the field's two decimals
      // would leave a promotion-spanning payslip pennies short (paycalc-grade.js). NO rate is a payslip
      // under a role with no confirmed rates: no figure, never CEA's rate in its place (invariant 13).
      const _rate = periodRate(_ty, _curP).rate;
      renderUnpricedPayslip(_rate == null ? unpricedLineFor(_curP) : '');
      // No estimate, so no Year to Date source is passed: never the last payslip's "in use" beside £–.
      if (_rate == null) { updateBadges(null); calcHPP(); renderYtdLine(null); updateYtdNote(_ty, _curP, 0, false, ''); return; }
      const rate = Math.max(0, _rate);
      updateBadges(rate);
      const r125 = rate * RATE_125;
      const r150 = rate * RATE_150;
      const r300 = rate * RATE_300;
      const peer = +(/** @type {HTMLElement} */ (document.getElementById('peerVal'))).textContent;

      const _adjRaw   = Math.abs(numVal('otherAdj') || 0);
      const otherAdj  = _adjNegative ? -_adjRaw : _adjRaw;

      // The hours each row counts, the London Allowance and contracted hours a joiner's share of the
      // payslip scales, and the gross they price to: payslipGross (paycalc-calc.js), which reads the
      // boxes through hhmmDec. All DOM reads done; no more DOM access until UI writes below.
      const { london: LONDON, satHrs, bhHrs, bhOtHrs, oHrs, rHrs, sHrs, bHrs,
              gross, satCapped, bhCapped, nonBhNorm,
              gBasicNorm, gBasicSat, gBankHol, gBhOt, gOvertime,
              gRdw, gSunday, gBoxing, gPeer } = payslipGross(_curP, _ty, {
        rate, peerDays: peer, otherAdj,
        hours: hhmmDec, hasBankHoliday, hasBoxingDay, getProRateFactor, getEffectiveContr,
      });

      // The back-pay card's lump, its paid-in payslip and the member's opt-in tick — whether it JOINS
      // this payslip is takeHomeInputs' rule, below (the card computes and shows the lump either way).
      const { amount: _bpAmount, pNum: _bpPNum, isEstimate: _bpIsEstimate, included: _bpIncluded,
              fromPayslip: _bpFromPayslip } = bpState();

      // The HPP card FIRST: it stores the premiums read below (this year's, and last year's — the one a
      // January payslip carries — via updatePriorHpp); run after the read, the January banner painted
      // from nothing. calcHPP takes no back-pay input (invariant 5): the settled rate already holds the
      // lump's variable part, so feeding it in counts it twice. Nothing calculate() works out feeds it.
      calcHPP();

      // The HPP that lands on THIS payslip: the tax year whose premium a January payslip carries
      // (the prior year's — paycalc-hpp-schedule.js owns that relation, two Januaries included).
      const _hppTy = hppTaxYearForPayslip(_curP, getPeriods(), CONFIG.TAX_YEARS);
      // A CONFIRMED actual (stored, even £0) beats the estimate: resolveHppForPeriod is that one rule,
      // shared with the prior-year card so the two cannot disagree.
      const _hppRes = _hppTy
          ? resolveHppForPeriod(lsGet(hppActualKey(_hppTy)), lsGet(hppEstKey(_hppTy)))
          : { amount: 0, isEstimate: false, hasActual: false };
      // The Year to Date card's January pointer shows ONLY on that January payslip (owner), and only
      // where the HPP card's confirm box can take the figure: a member employed in the premium's year
      // (updatePriorHpp hides the section from a joiner) and the box open — once the payslip may be in
      // hand (paycalc-2-3, paycalc-hpp.js) or while it holds a confirmed figure.
      const _janHint = document.getElementById('ytdJanHppHint');
      if (_janHint) _janHint.hidden = !(_hppTy && isTaxYearVisible(_hppTy)
          && (_hppRes.hasActual || payslipMayBeInHand(_curP)));
      const _hppAmount     = _hppRes.amount;      // the HPP figure landing on this January payslip
      const _hppIsEstimate = _hppRes.isEstimate;
      // OPT-IN, like back pay: the member's tick for this premium's tax year (off by default).
      const _hppIncluded   = !!_hppTy && lsGet(hppIncKey(_hppTy)) === '1';

      // The "updates automatically" hint is for first use: once this payslip has hours it hides, and
      // the provenance chips use the space for facts.
      const _netHintEl = document.getElementById('netHint');
      if (_netHintEl) _netHintEl.hidden =
        satHrs > 0 || bhHrs > 0 || bhOtHrs > 0 || oHrs > 0 || rHrs > 0 || sHrs > 0 || bHrs > 0 || peer > 0;

      // Plan 5 is not repayable before 2026/27: the option is disabled where thresholds.sl has no plan5
      // key. A pre-existing plan5 selection is NOT reset (it stays valid for 2026/27): it computes £0
      // here and the row below explains it.
      const _slSel    = /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan'));
      const _plan5Allowed = !!(/** @type {Record<string, any>} */ (thresholds.sl)).plan5;
      const _plan5Opt = /** @type {HTMLOptionElement|null} */ (_slSel.querySelector('option[value="plan5"]'));
      if (_plan5Opt) _plan5Opt.disabled = !_plan5Allowed;

      const plan   = _slSel.value;
      const pgLoan = /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked;
      const slSkip = /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked;
      // One undergraduate plan AND a Postgraduate Loan can be repaid together — HMRC deducts each
      // independently; the summary shows a line per active loan (pricePayslip, buildLoanLines).
      const _anyLoan = plan !== 'none' || pgLoan;
      // The "not deducted this period" skip + its row apply to whichever loan(s) are active.
      /** @type {HTMLElement} */ (document.getElementById('slSkipRow')).classList.toggle('hidden', !_anyLoan);
      // The loans' stop: both stop together from one payslip; a member whose loans end apart uses the
      // per-period skip for the gap. Where it applies is takeHomeInputs' rule 4, below.
      const _slPaidOffSel   = /** @type {HTMLSelectElement|null} */ (document.getElementById('slPaidOffFrom'));
      const _slPaidOffField = document.getElementById('slPaidOffField');
      if (_slPaidOffField) _slPaidOffField.classList.toggle('hidden', !_anyLoan);
      // The Year to Date figures and the payslip they came from (cumulative PAYE; W1/M1/X excluded).
      const _ytdSrc = parseInt(lsGet(ytdSrcKey(_ty)) ?? '', 10) || 0;

      // WHAT THIS PAYSLIP IS PRICED ON: the boxes, read (a blank or unreadable box is null, never 0);
      // the rules that decide from them are takeHomeInputs' (paycalc-calc.js), tested there.
      const {
        bpThisPeriod: _bpThisPeriod, hppForPeriod: _hppForPeriod, grossWithBp, pension,
        slStopFrom: _slPaidOffFromP, slPaidOff, pricing,
      } = takeHomeInputs({
        p: _curP, ty: _ty, gross, plan, pgLoan, slSkip, thresholds,
        backPay: { pNum: _bpPNum, amount: _bpAmount, included: _bpIncluded },
        premium: { amount: _hppAmount, included: _hppIncluded },
        pensionBox: parseSmartFloatOrNull(/** @type {HTMLInputElement|null} */ (document.getElementById('pensionAmt'))?.value),
        pensionDefault: periodDefaultPension(_curP),
        slStopShown: _slPaidOffSel?.value, slStopStored: lsGet(SK.slPaidOff),
        ytdPay: parseSmartFloatOrNull(/** @type {HTMLInputElement|null} */ (document.getElementById('ytdPay'))?.value),
        ytdTax: parseSmartFloatOrNull(/** @type {HTMLInputElement|null} */ (document.getElementById('ytdTax'))?.value),
        ytdSrc: _ytdSrc,
        taxCode: /** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value,
      });
      const pensionWarn = document.getElementById('pensionWarn');
      if (pensionWarn) pensionWarn.classList.toggle('show', pension > grossWithBp && pension > 0);
      // PRICED by the one pipeline the year so far also uses (pricePayslip). Nothing below re-prices.
      const {
        sacGross, ni, slUnder, slPost, sl, afterPension: _shownAfterPension, net,
        tax, usingCumulative, refund: taxRefund, code: taxCodeUsed, recognised: taxCodeKnown,
        payLimited: taxPayLimited, ytdMisfit: taxYtdMisfit,
      } = pricePayslip(pricing);
      paintTaxCodeWarning({ code: taxCodeUsed, recognised: taxCodeKnown });   // a code priced on 1257L says so
      updateYtdNote(_ty, _curP, _ytdSrc, usingCumulative, taxCodeUsed, !!taxYtdMisfit);   // "in use" is what computeTax did

      // The loan rows of the summary, which never leave a £0 unexplained — buildLoanLines says how.
      const _slPaidOffP = slPaidOff ? periodByNum(_slPaidOffFromP) : null;
      const slLines = buildLoanLines({
        sacGross, plan, planLabel: _slSel.selectedOptions[0]?.textContent?.trim() ?? plan, pgLoan, slUnder, slPost, slSkip,
        slPaidOff, paidOffDay: _slPaidOffP ? fdShort(_slPaidOffP.payday) : '', sl: thresholds.sl, tyLabel: _ty.label,
      });

      updateBreakBar({ gross: grossWithBp, pension, tax, ni, sl, net });

      // UI
      /** @type {HTMLElement} */ (document.getElementById('netDisplay')).textContent = fmt(net);
      /** @type {HTMLElement} */ (document.getElementById('pensionRef')).textContent = pension.toFixed(2);

      // Check against the real payslip (paycalc-result-headline.js → renderActualCheck): the pension
      // the estimate DEDUCTED (sacGross floors at zero), and the payslip its Year to Date figures came from.
      const _srcP = _ytdSrc ? periodByNum(_ytdSrc) : null;
      renderActualCheck({ inHand: payslipMayBeInHand(_curP), net, taxCode: taxCodeUsed, recognised: taxCodeKnown,
        deducted: Math.min(pension, Math.max(0, grossWithBp)), ytdFrom: usingCumulative && _srcP ? fdShort(_srcP.payday) : '',
        estimate: { gross: _shownAfterPension, pension, tax, ni, net } });

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
        taxCode: taxCodeUsed, taxCodeRecognised: taxCodeKnown, taxPayLimited, taxYtdMisfit, ytdFrom: _srcP ? fdShort(_srcP.payday) : '',
      });

      const bd = buildBreakdownRows({
        nonBhNorm, rate, gBasicNorm, satCapped, r125, gBasicSat, bhCapped, gBankHol,
        bhOtHrs, gBhOt, oHrs, gOvertime, rHrs, gRdw, sHrs, r150, gSunday, bHrs, r300, gBoxing,
        peer, gPeer, LONDON, otherAdj, slSkip, slPaidOff, plan, pgLoan, usingCumulative,
        _bpThisPeriod, _bpIsEstimate, _hppForPeriod, _hppIsEstimate,
        paidOffDay: _slPaidOffP ? fdShort(_slPaidOffP.payday) : '',
        ytdFrom: _srcP ? fdShort(_srcP.payday) : '',
      });
      if (bd !== _lastBdBodyHtml) {
        // #bdRows, not #bdBody: the pension and absence notes are static siblings in the panel and
        // must survive the rebuild.
        /** @type {HTMLElement} */ (document.getElementById('bdRows')).innerHTML = bd;
        _lastBdBodyHtml = bd;
      }

      // ── THE HEADLINE FIGURE AND WHAT IT IS CALLED ──────────────────────────────
      // paycalc-result-headline.js writes every target on BOTH paths (a confirmed figure or this
      // estimate), or one branch's number sits under the other's label. `actual` is resolved HERE: the
      // gate is about identity, which belongs with the session.
      const _actualKey = formatISO(_curP.payday);
      const _actual    = isActualsDev(getLoggedMember())
        ? readPayslipActuals()[_actualKey] : null;
      renderResultHeadline({
        actual: _actual, net, payday: _curP.payday,
        bpThisPeriod: _bpThisPeriod, hppForPeriod: _hppForPeriod,
        bpIsEstimate: _bpIsEstimate, hppIsEstimate: _hppIsEstimate,
      });

      // The Year to Date line under the £ (owner, 7 Nov 2026): the rule is ytdUpdateFrom, the words renderYtdLine.
      renderYtdLine(_actual ? null : ytdUpdateFrom({ p: _curP, ty: _ty, src: _ytdSrc, inUse: usingCumulative,
        taxCode: taxCodeUsed, recognised: taxCodeKnown, misfit: !!taxYtdMisfit }));

      // The two OPT-IN MONEY BANNERS (paycalc-money-banner.js): one set of three states — included,
      // available but not added, nothing to say — right only while "available" never means "added".
      const _bpAvailableHere = _bpPNum > 0 && _bpPNum === _pNum && _bpAmount > 0;
      paintBanner({
        rootId: 'bpActiveBanner', textId: 'bpBannerText', tickId: 'bpBannerTick', noteId: 'bpBannerNote',
        available: _bpAvailableHere, included: _bpIncluded,
        copy: backPayBannerCopy({
          thisPeriod: _bpThisPeriod, amount: _bpAmount, isEstimate: _bpIsEstimate, fromPayslip: _bpFromPayslip,
          aprilYear: _bpAvailableHere ? _bpAwardTaxYear(_backdatedFromPNum()).label.slice(0, 4) : '',
          inHand: payslipMayBeInHand(_curP),
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

    function toggleBpBreakdown() {
      // Max-height from the rendered height, so a long breakdown is never clipped by the CSS
      // `.bd-body.open` cap; cleared on close so the collapse animates shut.
      toggleDisclosure('bpBreakdownBtn', 'backPayRows', {
        onToggle: (open, body) => { body.style.maxHeight = open ? `${body.scrollHeight}px` : ''; },
      });
    }

    // ── PEER STEPPER ──────────────────────────────────────────────────────────────
    /** @param {number} delta */
    function stepPeer(delta) {
      const el = /** @type {HTMLElement} */ (document.getElementById('peerVal'));
      el.textContent = String(Math.max(0, Math.min(10, +el.textContent + delta)));
      autosave();
    }

    // ── INIT ──────────────────────────────────────────────────────────────────────
    runMigrations({ getPeriods, getLoggedMember, getPensionDefault });

    // A FIRST VISIT (owner) gets the top privacy note and the setup banner's "Used the Pay Calculator
    // before?" line — an empty calculator may be a MOVED one (Safari and the Home Screen app keep
    // separate copies). First = no settings (SK.setup) and no payslip for THIS member (classifyPayKey),
    // read after runMigrations() selects the namespace; once per load, so nothing moves under a finger.
    // A browser that will not SAVE (`lsAvailable`, ls.js) swaps "Saved automatically" for a warning.
    {
      const pre = pcPrefix(), hasPayData = !!lsGet(SK.setup)
        || lsKeys().some(k => k.startsWith(pre) && classifyPayKey(k.slice(pre.length)).kind === 'payslip');
      document.getElementById('privacyNoteTop')?.classList.toggle('hidden', hasPayData);
      document.getElementById('setupRestore')?.toggleAttribute('hidden', hasPayData);
    }
    document.body.classList.toggle('storage-blocked', !lsAvailable());

    // Clamp the visible periods for a member who started this tax year. BEFORE the tabs + period
    // select are built (both read the clamp). Secondment returns (noProRate) are unaffected.
    setEarliestVisiblePeriod(getLoggedMember());

    // Tax-year tabs, generated from TAX_YEARS so the rollover only touches paycalc-calc.js. Before
    // buildPeriodSelect() + onPeriodChange() (updateTyTabs looks them up by id). A year before a new
    // starter's join year gets no tab; the id stays `tyTab${i}` at the ORIGINAL index so
    // updateTyTabs/jumpToTaxYear still align.
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
    // list (owner, 8 Nov 2026).
    const _slPaidOffSel = document.getElementById('slPaidOffFrom');
    if (_slPaidOffSel) appendPayslipOptions(_slPaidOffSel, visiblePeriods());

    loadSettings();
    // _defaultPeriodNum BEFORE onPeriodChange(), whose ● button check is `pNum === _defaultPeriodNum`.
    _defaultPeriodNum = buildPeriodSelect();
    onPeriodChange();
    // THE PAGE IS USABLE FROM HERE: the result card holds a real figure — the App Speed card's
    // "usable" milestone. (onPeriodChange also synced the back-pay card, so no restore is needed.)
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

    /** @type {HTMLElement} */ (document.getElementById('bdBtn')).addEventListener('click', toggleBD);
    /** @type {HTMLElement} */ (document.getElementById('rosterDaysToggle')).addEventListener('click', toggleRosterDays);

    // In-flight-edit tracking: genuine input in the Hours card stops a late override-fetch overwriting
    // it. On 'input', so programmatic .value fills never trip it.
    /** @type {HTMLElement|null} */ (document.getElementById('hoursCard'))?.addEventListener('input', () => { _hoursTouchedSinceFetch = true; });

    // Saturday: warned as typed, capped when either box is left (onHhMm says why).
    /** @type {HTMLElement} */ (document.getElementById('satH')).addEventListener('input', () => { onHhMm('satH','satM','satWarn', { cap: false }); autosave(); });
    /** @type {HTMLElement} */ (document.getElementById('satM')).addEventListener('input', () => { clampMins('satM'); onHhMm('satH','satM','satWarn', { cap: false }); autosave(); });
    for (const id of ['satH', 'satM']) {
      // SAVED ON LEAVING ONLY WHEN THE CAP REWROTE THE BOXES: typing saves as it goes, and a save on every
      // blur also saved the display-only gold figures of a box merely tapped and left (invariant 11).
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('blur', () => { if (onHhMm('satH','satM','satWarn')) autosave(); });
    }

    // Every other hours pair — minutes clamp + autosave; Saturday's, above, carries the cap as well.
    for (const { cat, hId, mId } of HM_PAIRS) {
      if (cat === 'sat') continue;
      /** @type {HTMLElement} */ (document.getElementById(hId)).addEventListener('input', autosave);
      /** @type {HTMLElement} */ (document.getElementById(mId)).addEventListener('input', () => { clampMins(mId); autosave(); });
    }
    // The payslip self-check figures persist with the period; autosave() re-renders the verdict.
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

    // Decimal auto-correction with its live "= 7h 30m" preview (autoDecimalHours).
    HM_PAIRS.forEach(({ hId: h, mId: m }) => {
      /** @type {HTMLElement} */ (document.getElementById(h)).addEventListener('input', () => decPreview(h));
      /** @type {HTMLElement} */ (document.getElementById(h)).addEventListener('blur', () => autoDecimalHours(h, m));
    });

    // Peer training stepper — through wireIosTap, like the period arrows (the field in hand commits first)
    wireIosTap(/** @type {HTMLElement} */ (document.getElementById('peerMinus')), () => stepPeer(-1), { releaseFocus: true });
    wireIosTap(/** @type {HTMLElement} */ (document.getElementById('peerPlus')),  () => stepPeer(1), { releaseFocus: true });

    // Back-pay inputs. New fields recalc; Old fields + "Pay rise %" re-derive New = Old × (1 + %) first.
    ['newRateInput','newLondon'].forEach(/** @param {string} id */ id => {
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('input', runCalcBackPay);
    });
    ['oldRate','oldLondon','bpRisePct'].forEach(/** @param {string} id */ id => {
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('input', applyBpRisePct);
    });
    // Amount-source toggle + manual amount.
    document.getElementsByName('bpMode').forEach(/** @param {any} r */ r =>
      r.addEventListener('change', () => { applyBpMode(); runCalcBackPay(); }));
    document.getElementById('bpManualAmt')?.addEventListener('input', runCalcBackPay);

    // HPP amount-source toggle + manual inputs: persist the choice for the viewed tax year and
    // recompute (calculate() → calcHPP reads the mode and writes hppEstKey).
    const _saveHppForViewedYear = () => {
      const _hp = viewedPeriod();
      saveHppState(taxYearForPeriod(_hp));
    };
    document.getElementsByName('hppMode').forEach(/** @param {any} r */ r =>
      r.addEventListener('change', () => { applyHppMode(); _saveHppForViewedYear(); calculate(); }));
    // 'ytd' mode reads the Year to Date card, whose edits already re-run calculate(). Only 'exact' has an input.
    document.getElementById('hppExactAmt')?.addEventListener('input', () => { _saveHppForViewedYear(); calculate(); });

    // Card collapse toggles (overlay.js). The header id as the chevron id toggles .open on the header,
    // which drives the .card-toggle-arrow rotation in CSS.
    initCardCollapse('settingsToggle',    'settingsBody',    'settingsToggle');
    initCardCollapse('payslipCardToggle', 'payslipCardBody', 'payslipCardToggle');
    initCardCollapse('hppCardToggle',     'hppCardBody',     'hppCardToggle');
    initCardCollapse('payTransferToggle', 'payTransferBody', 'payTransferToggle');
    initCardCollapse('backPayCardToggle', 'backPayBody',     'backPayCardToggle',
      /** @param {any} open */ open => {
        if (!open) return;
        // Prefill the rate boxes for the selected award year, then derive New from any defaulted "Pay rise %".
        refreshBackPayCard();
      });

    // The back-pay breakdown, its paid-in payslip and its opt-in tick; Save settings
    /** @type {HTMLElement} */ (document.getElementById('bpBreakdownBtn')).addEventListener('click', toggleBpBreakdown);
    /** @type {HTMLElement} */ (document.getElementById('backPayPeriod')).addEventListener('change', runCalcBackPay);
    /** @type {HTMLElement} */ (document.getElementById('bpIncludeTick')).addEventListener('change', runCalcBackPay);
    wireIosTap(/** @type {HTMLElement} */ (document.getElementById('saveSettingsBtn')), () => confirmSettings(calculate), { releaseFocus: true });

    /** @type {HTMLElement} */ (document.getElementById('hoursShowMore')).addEventListener('click', toggleHoursExtra);

    // The sticky take-home bar — the page's only keep-the-£-in-view; every guard in it answers a
    // reported iOS behaviour no headless browser reproduces, argued in paycalc-sticky-total.js.
    initPaycalcStickyTotal();

    // Roster fill — "Fill blank fields" + the per-category "Fill →" buttons — through wireIosTap, not
    // a bare click: with the soft keyboard up iOS cancels the click as the keyboard drops (staff-reported).
    const _fillBtn = document.getElementById('fillFromRosterBtn');
    if (_fillBtn) wireIosTap(_fillBtn, () => fillFromRoster(autosave));

    // Per-category fill buttons: delegation on #rosterRows, which survives re-renders.
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

    // Settings. The Grade box and the payslip a chosen grade starts from are ONE setting (paycalc-grade.js).
    const _onGradeChange = () => {
      // Preserve a hand-entered pension: replace it only while it still holds the pre-change default.
      // Read before saveSettings(), which moves the setting.
      const _gP = viewedPeriod();

      const _pa = /** @type {HTMLInputElement | null} */ (document.getElementById('pensionAmt'));
      const _oldPenDefault = _gP ? periodDefaultPension(_gP).toFixed(2) : '';
      const penUntouched = !_pa || _pa.value.trim() === '' || _pa.value === _oldPenDefault;

      saveSettings(); // calls invalidateGrade(), so everything below prices with the new setting
      // The hourly rate is fixed by grade and read-only: reload the new grade's rate for this payslip.
      if (_gP) updateRateForPeriod(taxYearForPeriod(_gP), _gP);
      if (_pa && penUntouched) _pa.value = periodDefaultPension(_gP).toFixed(2);
      // Recompute the back-pay card for the NEW grade: its saved blob holds the old grade's award rates
      // in read-only boxes. calcBackPay re-enforces AWARD_RATES; calculate() below covers pension and rate.
      runCalcBackPay();
      calculate();
    };
    /** @type {HTMLElement} */ (document.getElementById('gradeSelect')).addEventListener('change', _onGradeChange);
    document.getElementById('gradeFrom')?.addEventListener('change', _onGradeChange);
    // No #hourlyRate listener — the rate is read-only and grade-derived.
    /** @type {HTMLElement} */ (document.getElementById('taxCode')).addEventListener('input',     () => { saveSettings(); calculate(); });
    document.getElementById('taxCode')?.addEventListener('blur', calculate);   // its warning waits for the box to be left
    /** @type {HTMLElement} */ (document.getElementById('studentLoan')).addEventListener('change', () => {
      // Clear the "not deducted this period" skip only when NO loan is active (plan none AND no PGL).
      const _pg = /** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked;
      if (/** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value === 'none' && !_pg) {
        /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked = false;
      }
      saveSettings();
      persistSetting(['slSkip'])();   // the cleared skip flag, and nothing else
    });
    // The student-loan stop is a SETTING: persist + recompute, so the payslip on screen follows it.
    document.getElementById('slPaidOffFrom')?.addEventListener('change', () => { saveSettings(); calculate(); });
    // Postgraduate Loan flag — a SETTING, repayable ALONGSIDE a plan.
    /** @type {HTMLElement} */ (document.getElementById('pgLoanCheck')).addEventListener('change', () => {
      const _slNone = /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan')).value === 'none';
      if (_slNone && !(/** @type {HTMLInputElement} */ (document.getElementById('pgLoanCheck')).checked)) {
        /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked = false;
      }
      saveSettings();
      persistSetting(['slSkip'])();
    });
    // pensionAmt belongs to THIS payslip — autosave() stores it in the period's blob (one equal to the
    // default stores null, so the payslip keeps following PENSION_STEPS).
    /** @type {HTMLElement} */ (document.getElementById('pensionAmt')).addEventListener('input',  () => { saveSettings(); autosave(); });
    // The pension card's two controls are wired beside the card's rules (paycalc-settings.js), so the
    // tick, the date and the field cannot fall out of step; the coordinator supplies only how to persist.
    wirePensionControls({ autosave: persistSetting(['pension']) });

    // Per-period overrides — and the tick that says a payslip has no special-rate hours at all
    /** @type {HTMLElement} */ (document.getElementById('slSkipCheck')).addEventListener('change', autosave);
    document.getElementById('noSpecialCheck')?.addEventListener('change', autosave);
    /** @type {HTMLElement} */ (document.getElementById('otherAdj')).addEventListener('input', () => {
      // A typed negative sets the sign flag; the field keeps the absolute value (the ± button is authoritative).
      const _adjEl = /** @type {HTMLInputElement} */ (document.getElementById('otherAdj'));
      const raw = _adjEl.value;
      const v   = parseSmartFloat(raw);
      if (v < 0) {
        _adjNegative = true;
        // String, NOT toFixed: toFixed('-1')→'1.00' left the caret after '.00', so typing "-150" built
        // '1.0050'. String(abs) → '1' → '15' → '150'.
        _adjEl.value = String(Math.abs(v));
      }
      // Positive typed value: leave _adjNegative alone — the ± button is authoritative.
      updateAdjSign();
      autosave();
    });
    // The ± sign, through wireIosTap (paycalc-inputs.js): with the field focused, iOS cancels the click.
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

    // The Year to Date card's figure boxes and its "From which payslip?" select: the source each
    // typing stamps or moves, and the pick that keeps or un-anchors it (paycalc-ytd-card.js).
    wireYtdCard({ saveSettings, calculate });

    // The prior year's confirmed premium commits on `change` (leaving the field), NEVER on `input`:
    // commitPriorHppActual (paycalc-hpp.js) says what per-keystroke commits did to a confirmed figure.
    /** @type {HTMLElement} */ (document.getElementById('priorHppActualInput')).addEventListener('change', () => {
      const curP = viewedPeriod();
      commitPriorHppActual(taxYearForPeriod(curP), /** @type {HTMLInputElement} */ (document.getElementById('priorHppActualInput')).value);
      calculate();   // the January take-home, banner, chips and year block read the stored figure
    });

    // The two money banners' opt-in ticks and "view … card" links, and the HPP card's link to the
    // back-pay card (paycalc-money-banner.js → wireBannerTicks).
    wireBannerTicks({ calculate });

    // HPP formula toggle + disclaimer
    /** @type {HTMLElement} */ (document.getElementById('hppToggleBtn')).addEventListener('click', toggleHppNote);
    /** @type {HTMLElement} */ (document.getElementById('disclaimerToggle')).addEventListener('click', toggleDisclaimer);

    // ── LIGHTBOXES — paycalc-lightboxes.js, whose header lists them. Returns the About open handle for
    // the drawer logo.
    const { openAboutLightbox, showPayNotice } = initPaycalcLightboxes();

    // (The service worker is registered at the top of init(). Never a second lifecycle here: two
    // controllerchange listeners fired the reload twice.)

    // Establish the Firebase Auth session BEFORE starting error reporting: a valid 60-day local
    // session can outlive the Firebase one, and clientErrors writes are then rejected and silently
    // dropped. The reporter starts whatever the outcome.
    // The settle promise is kept for the drawer's Circular/Newsletter read (AUTH_PLAN.md → E1): this
    // `soft` page has no `sessionReady`. It always RESOLVES, so the drawer read never hangs.
    let _paycalcAuthSettled = Promise.resolve();
    (function _initErrorReporting() {
      const name = getSession()?.name;
      const afterAuth = () => {
        initErrorReporter(); recordUsage('paycalc', name ?? null); recordPageLatency('paycalc', name ?? null);
        // Forced set-password overlay (PASSWORD_DESIGN.md Phase 2). No `ready` barrier: this runs after
        // ensureNamedSession has settled, and on this `soft` page a member may arrive with a FAILED
        // Firebase session, where the overlay's `named`-only gate stops a block they could never satisfy.
        // The page's notices queue BEHIND it on the promise it returns, or one opens in front of a block
        // the member cannot dismiss; if the overlay is up, `openNoticeIfClear` defers the notice. `.catch`:
        // a failed overlay must never cost the member their notice — it fails open by design.
        initPasswordForce(name, {}).catch(() => {}).finally(() => showPayNotice());
      };
      // SOFT enforcement (AUTH_ARCHITECTURE.md Phase 7): the data is on the device and nothing isolated is
      // written, so a degraded session must NEVER block it — 'soft-allow' is only logged. Its one
      // 'forbidden', an Other Staff login, never reaches here (payCalculatorPrices asks the same policy).
      if (name) _paycalcAuthSettled = ensureNamedSession(name)
          .then(() => { if (requirePage(getAuthSnapshot(), 'paycalc').decision === 'soft-allow') console.warn('[Auth] paycalc running without a named session — error reporting may not record.'); })
          .catch(() => {/* reporter still starts below */})
          .finally(afterAuth);
      else afterAuth();
    }());

    // ── THE PICKER SHEETS, THE BACKUP CARD AND THE LATE WIRING ─────────────────────
    // Every dropdown opens the app's own sheet, so the calculator has ONE kind of dropdown. A title is
    // also the control's accessible name, so it carries its field's visible label word for word
    // (paycalc-copy-parity.test.mjs) — and the loan stop never says "paid off" (paycalc.md).
    initSelectSheets([
        { id: 'periodSelect',      title: 'Which pay period?', searchLabel: 'Search pay periods' },
        { id: 'gradeSelect',       title: 'Your grade' },
        { id: 'gradeFrom',         title: 'Use this grade from which payslip?', searchLabel: 'Search pay periods' },
        { id: 'studentLoan',       title: 'Student loan plan' },
        { id: 'pensionOptOutFrom', title: 'Not in the scheme from which payslip?', searchLabel: 'Search pay periods' },
        { id: 'slPaidOffFrom',     title: 'Student loan stopped being deducted?', searchLabel: 'Search pay periods' },
        { id: 'ytdSrcSelect',      title: 'From which payslip?' },
        { id: 'backPayPeriod',     title: 'Which payslip carries this lump sum?', searchLabel: 'Search pay periods' },
    ], { createLightbox });

    initTransferCard();   // late: the backup card reads the per-member namespace runMigrations() chose
    // A link to #payslipCard (the premium notice's, from another page) opens that card, held in view.
    openCardNamedByHash('payslipCard', 'payslipCardBody', 'payslipCardToggle');
    wireYtdLine();   // the take-home's Year to Date line opens the same card (paycalc-result-headline.js)
    wireSettingsCard({ openCardNamedByHash });   // its desktop place in the Tab order, and the banner's link to it
    // Pay data is localStorage-only and evictable until asked otherwise — see ls.js.
    requestPersistentStorage(pcPrefix());
    // The year card's fill control. After a bulk fill: reload the visible form ONLY if the fill wrote
    // it (filled, or ticked as having no special-rate hours), then recalculate.
    initYearCard({
      afterFill: (r) => {
        if ([...r.filled, ...r.checked].some((/** @type {any} */ p) => p.num === currentPeriodNum())) loadPeriodData(currentPeriodNum());
        runCalcBackPay();   // filled hours inside the award window move the lump (paycalc-2-2)
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
      const p = periodSel ? periodByNum(+periodSel.value) : null;
      // With a time, and the date in the app's own words — roster-data.js → "the provenance line
      // every printable surface closes on".
      const printedNow = new Date();
      const now = printedStamp(printedNow, formatClock(printedNow));
      // "Pay Calculator", never the old MYB name. The payday with its whole year, as the result card
      // and the picker say it ("Paid 20 Nov 2026").
      const label = p ? `Paid ${fdLong(p.payday)} (P${payslipPeriodNum(p)}) · ${now}` : `Pay Calculator · ${now}`;
      hdr.setAttribute('data-print-line', label);
    }
    stampPaycalcPrintLine();
    window.addEventListener('beforeprint', stampPaycalcPrintLine);

    // The pill gates are `navGatesFor`'s, spread at every initNavPanel call (page-contract-parity checks
    // each call; nav-gates.test.mjs checks the answer). `_showUnsupportedRole` draws the other drawer.
    const _paycalcMember = getLoggedMember();
    initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_AND_SESSIONS.md → "The two-phase load (E1)").
        authReady: _paycalcAuthSettled,
        currentPage: 'paycalc',
        memberName:  _paycalcMember?.name || null,
        canReadDocuments: paycalcDocsGate(_paycalcMember?.name),
        ...navGatesFor(_paycalcMember?.name),   // the pill gates (auth-policy.js), as on every page
        onLogoClick: () => openAboutLightbox?.(),
        // signOutAndLeave replaces, not navigates: the pay page leaves the history, so Back cannot
        // restore it (and its figures) from the bfcache for whoever picks the shared device up next.
        onSignOut:   _paycalcMember ? () => signOutAndLeave({ to: './' }) : null,
    });
    // (About's print button is about-lightbox.js's; a copy here left the page scroll-locked.)

}
