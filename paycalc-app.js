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
  taxYearForPeriod, getThresholds, getLondonAllowanceForPeriod,
  computeGross, pricePayslip, takeHomeInputs,
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
 * this device's session (review, 22 Nov 2026): Pay is the one `soft` page, and offline the document read
 * answers from the device's cache without asking a rule — so a session ended in another tab, or a page
 * wired for nobody, would still open what an earlier session left there.
 * @param {string|null|undefined} name the member the page was drawn for
 * @returns {() => boolean}
 */
const paycalcDocsGate = (name) => () => !!name && getSession()?.name === name;

/**
 * Withhold the calculator from a role it has no confirmed rates for, and say why.
 * Rationale: `gradeForRole`'s JSDoc (roster-data.js). Two things an editor here needs — it WITHHOLDS rather than
 * captioning (the page's whole output is one confident £ figure, and a member told "this may not
 * apply" and handed one will use it), and it still wires the drawer, so it is a refusal with a way
 * out rather than a dead end.
 * @param {any} member the signed-in teamMembers entry
 */
function _showUnsupportedRole(member) {
    // A BODY CLASS, never the `hidden` attribute: `.pc-side` is `display: contents` on mobile and
    // both are `flex` on desktop, each of which out-specifies `hidden`'s UA rule, so the
    // calculator would render in full while this code believed it was gone. See paycalc.css.
    document.body.classList.add('role-unsupported');
    document.getElementById('unsupportedGradeBanner')?.classList.remove('hidden');
    paintRoleCard(member);   // the words differ by who is reading — paycalc-role-card.js
    // About and the header logo, as on every page — without them the drawer head and the logo did nothing here.
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
    // Tear down a lingering privileged Firebase identity whose local session has expired, so a direct
    // deep-link here can't keep an old credential live — BEFORE the session guard's early return, as
    // the expired path is exactly where one lingers. Fire-and-forget and login-safe: a no-op on a
    // valid session, and it stands down if a sign-in supersedes it.
    reconcileExpiredIdentity().catch(() => {});   // it handles and logs its own failures; this only keeps an unexpected one from going unhandled

    // ── THE START-UP (page-start.js): the Back guard FIRST, so no early return below can skip it — a page
    // restored from the bfcache does not re-run init(), so after a sign-out (or another member signing in on
    // another tab) Back could show the previous member's pay page, figures and all — then the decision, the
    // in-place sign-in (init() runs again, once, with the just-saved session, and runMigrations() selects the
    // right namespace for free — AUTH_ARCHITECTURE.md Phase 9) and the refusal.
    //
    // The decision is the page's OWN, not requirePage('paycalc') (AUTH_ARCHITECTURE.md Phase 7): the policy is
    // `soft`, which by its tested invariant NEVER returns 'login', but the calculator needs a member identity to
    // namespace its per-member storage (pcPrefix/SK), so a *local name* is a hard precondition, stricter than the
    // policy. `soft` governs only the Firebase confirmation (_initErrorReporting below), which is why the
    // start-up's session step is off (`establish: false`): this page owns its auth chain. "Simplifying" this into
    // requirePage would render with no identity. getSession() (session.js) enforces the 60-day absolute expiry.
    //
    // A ROLE WITH NO CONFIRMED RATES REFUSES RATHER THAN GUESSING: the grade lookup treats "no grade
    // stored" as CEA at every consumer, so every Dispatcher and manager account was handed a polished
    // estimate at somebody else's rate. Decided here, before every other init step, so nothing can render a
    // figure first — and decided AGAIN for whoever signs in on this page's own card. Why: `gradeForRole`'s
    // JSDoc (roster-data.js). It asks the role AT THE TIME (owner, 16 Nov 2026; pay-audience.js): a CES
    // promoted into management keeps the CES payslips on this page, and each payslip under a role with no
    // rates is refused on its own (calculate(), unpricedLineFor).
    //
    // A SESSION NAME THE ROSTER DOES NOT HOLD REFUSES TOO: a leaver or a renamed
    // member keeps a valid local session, `getLoggedMember()` returns null, and a null used to skip
    // this check — so the calculator ran on CEA rates and `setPaycalcNamespace(undefined)` opened the
    // bare `myb_pc_` namespace, i.e. the shared legacy keys of everyone on the device.
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
            // opened within two minutes would count this visit as its sign-in time (App Speed review).
            clearLoginStart();
            _showUnsupportedRole(getLoggedMember() ?? { name: member });
        } })) return;

    // ── COORDINATOR STATE ─────────────────────────────────────────────────────────
    // The back-pay card keeps its own state (bpState, paycalc-backpay.js); calculate() reads it to add
    // the lump into that period's gross before tax/NI, and re-prices whenever it changes.
    onBackPayChange(() => calculate());

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
     * The Saturday contracted-hours cap. It does not re-price: every caller follows it at once with
     * `autosave()`, which ends in `calculate()`, so a run here priced the same screen twice.
     *
     * CAPPED WHEN THE BOX IS LEFT, WARNED WHILE TYPING (edit-sequence tests, 25 Nov 2026). It capped on
     * every keystroke, so an edit passing through a larger number on its way to the one meant — "32" to
     * "36" by typing the 6 before deleting the 2 reads 362 for a moment — was rewritten to the cap, and
     * the digits being edited were gone. Nothing is overpaid meanwhile: the pay maths caps Saturday hours
     * itself (`capHours`, paycalc-calc.js), so the box only has to say so, and is rewritten once left.
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
      // The payday is NOT repeated here: the select above already reads "Paid 31 July 2026 · P20", so
      // the meta row carries what it does not — the shift window and the tax year — and the gold
      // P-badge stays as the payslip cross-check. The window is LABELLED "Hours worked": a bare
      // "26 Jul – 22 Aug 2026" left the reader to guess, and three hours rows each restated the cut-off.
      /** @type {HTMLElement} */ (document.getElementById('pmRange')).textContent   = `Hours worked ${startStr} – ${cutLongStr}`;
      /** @type {HTMLElement} */ (document.getElementById('pmSub')).textContent     = `Tax year ${ty.label}`;
      /** @type {HTMLElement} */ (document.getElementById('periodBadge')).textContent = `P${payslipPeriodNum(p)}`;
      // fdLong, not fd: the picker above says "Paid 28 August 2026", and the most-read line of the page
      // must not spell the same date "28 Aug 26" a foot below it.
      /** @type {HTMLElement} */ (document.getElementById('netPeriod')).textContent   = `Paid ${fdLong(p.payday)}`;

      const boxing = hasBoxingDay(p);
      /** @type {HTMLElement} */ (document.getElementById('boxingBanner')).classList.toggle('visible', boxing);
      /** @type {HTMLElement} */ (document.getElementById('boxingRow')).classList.toggle('hidden', !boxing);
      // No blanking of the hidden Boxing Day boxes here: loadPeriodData below writes every box from the
      // payslip's own saved entries, and calculate() reads Boxing Day hours only where the payslip has one.

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
      refreshYtdSrc(ty);

      // This tax year's HPP amount source, restored BEFORE loadPeriodData() runs calculate() (calcHPP
      // reads the mode), so each year shows its own choice.
      restoreHppState(ty);
      // Update the "for P__" label next to the pension field so users can see
      // which period's pension they are viewing or editing.
      const pensionPeriodLbl = document.getElementById('pensionPeriodLabel');
      if (pensionPeriodLbl) pensionPeriodLbl.textContent = `for the ${fdShort(p.payday)} payslip`;

      // The Settings card's hint, the setup banner and the "New tax year" notice for this payslip's
      // tax year (paycalc-settings.js → paintSettingsForYear says what each shows, and when).
      paintSettingsForYear(ty, p);

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
      if (_daysToggleEl) { _daysToggleEl.textContent = 'Show days ▼'; _daysToggleEl.setAttribute('aria-expanded', 'false'); }

      // Update roster suggestion card and joiner notice for this period.
      updateRosterHint();
      updateJoinerNotice(p);

      // Update Pay → Calendar link for this period
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

      // The back-pay card follows the viewed payslip's award year ALWAYS, not only while it is open,
      // so the banner and the take-home reflect the payslip on screen (the lump still joins only its own
      // payslip — takeHomeInputs); per-year keys keep each year's tick, rates and amount apart.
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
      const _pObj = periodByNum(pNum);
      _paintDefaultPension(d.pension == null ? _pObj : null);
      // The pension LOCK follows the viewed payslip — a member who left the scheme in August still
      // contributes on her July one. AFTER the paint above (it may only override a value where the
      // timeline says there was none) and BEFORE calculate() below: applied after it, a payslip
      // holding a saved figure was priced WITH that deduction beside a field reading a locked £0.00.
      if (_pObj) applyPensionOptOutUI(_pObj);
      updateAdjSign();
      // Open "more options" when this payslip has extras saved — through setDisclosure, so the
      // button's aria-expanded and arrow stay in step with it (a class alone told a screen reader
      // "collapsed" about an open panel).
      const hasExtras = !!(d.slSkip || d.otherAdj);
      setDisclosure('hoursShowMore', 'hoursExtra', hasExtras, { arrowSel: '.show-more-arrow' });
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
      // Mark the form as user-touched BEFORE blanking it: programmatic .value writes never fire the
      // delegated 'input' listener, so an override fetch in flight at the confirm would otherwise
      // resolve, see the flag unset, and refill + autosave the fields just cleared — undoing it.
      _hoursTouchedSinceFetch = true;
      clearRosterSuggestedAll();   // writeFormData expects the gold highlights cleared first
      writeFormData(emptyPeriodData());
      _paintDefaultPension(periodByNum(pNum));   // writeFormData leaves a null pension blank
      _adjNegative = false;
      updateAdjSign();
      updateSaveStatus(pNum);
      runCalcBackPay();   // the lump accrues from SAVED hours, and these were just deleted — as autosave re-prices it
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
      const _proRateFactor = getProRateFactor(_curP);
      const LONDON = getLondonAllowanceForPeriod(_curP, _ty) * _proRateFactor;

      // The payslip's rate from the one source the rate field and the Settings hint also read
      // (periodRate): its grades' rates weighted by their days, UNROUNDED. The field shows it to the
      // penny, and pricing a payslip that spans a promotion at the field's rounding would leave the
      // contracted pay pennies short of 35 hours at one rate plus 105 at the other (paycalc-grade.js).
      // NO rate is a payslip worked under a role with no confirmed rates (the page admits by the role
      // AT THE TIME): it gets no figure — never CEA's rate in its place (invariant 13).
      const _rate = periodRate(_ty, _curP).rate;
      renderUnpricedPayslip(_rate == null ? unpricedLineFor(_curP) : '');
      // No estimate here, so the Year to Date figures sharpen nothing: no source is passed, and the note
      // and chip say nothing — never the last payslip's "in use" beside £– (18 Nov 2026).
      if (_rate == null) { updateBadges(null); calcHPP(); renderYtdLine(null); updateYtdNote(_ty, _curP, 0, false, ''); return; }
      const rate = Math.max(0, _rate);
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

      // The back-pay card's lump, its paid-in payslip and the member's opt-in tick — whether it JOINS
      // this payslip is takeHomeInputs' rule, below (the card computes and shows the lump either way).
      const { amount: _bpAmount, pNum: _bpPNum, isEstimate: _bpIsEstimate, included: _bpIncluded,
              fromPayslip: _bpFromPayslip } = bpState();

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
      // OPT-IN, like back pay: the member's tick for this premium's tax year (off by default).
      const _hppIncluded   = !!_hppTy && lsGet(hppIncKey(_hppTy)) === '1';

      // The "updates automatically" hint is for first use: once this payslip has hours it hides, and
      // the provenance chips use the space for facts.
      const _netHintEl = document.getElementById('netHint');
      if (_netHintEl) _netHintEl.hidden =
        satHrs > 0 || bhHrs > 0 || bhOtHrs > 0 || oHrs > 0 || rHrs > 0 || sHrs > 0 || bHrs > 0 || peer > 0;

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

      // WHAT THIS PAYSLIP IS PRICED ON: the boxes, read (a blank or unreadable box is null, never 0),
      // and the rules that decide from them — a lump only on its own payslip and only once ticked, a
      // blank pension box as the payslip's default, the loans' stop, Year to Date figures only on the
      // payslip straight after their source — all takeHomeInputs' (paycalc-calc.js), tested there.
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
      // The payslip is PRICED by the one pipeline the year so far also uses (pricePayslip): NI and the
      // loans on the pay after pension, then the tax, then the take-home as the summary's rows show it,
      // each to the penny (takeHomePay). Everything above decided its inputs; nothing below re-prices.
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
      // paycalc-result-headline.js writes every target on BOTH paths — a confirmed payslip figure or
      // this estimate — because a target one path forgets keeps the previous render, and one branch's
      // number then sits under the other's label. `actual` is resolved HERE: the gate is about
      // identity, which belongs with the session, not with the words.
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
      // Max-height from the actual rendered height so a long back-pay breakdown (many periods,
      // large text/zoom) is never clipped by the fixed CSS `.bd-body.open` cap; cleared on close
      // so the CSS collapse animates shut. (Arrow rotation is CSS — .bd-btn.open .bd-arrow.)
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

    // Result breakdown toggle
    /** @type {HTMLElement} */ (document.getElementById('bdBtn')).addEventListener('click', toggleBD);

    // Roster day list toggle
    /** @type {HTMLElement} */ (document.getElementById('rosterDaysToggle')).addEventListener('click', toggleRosterDays);

    // In-flight-edit tracking: any genuine user input inside the Hours card marks the period
    // as "user is editing", so a late background override-fetch won't overwrite it (see
    // onPeriodChange). Delegated + on 'input', so programmatic .value fills never trip it.
    /** @type {HTMLElement|null} */ (document.getElementById('hoursCard'))?.addEventListener('input', () => { _hoursTouchedSinceFetch = true; });

    // Hours inputs — Saturday (has validation warn)
    // Warned as typed, capped when either box is left (onHhMm says why).
    /** @type {HTMLElement} */ (document.getElementById('satH')).addEventListener('input', () => { onHhMm('satH','satM','satWarn', { cap: false }); autosave(); });
    /** @type {HTMLElement} */ (document.getElementById('satM')).addEventListener('input', () => { clampMins('satM'); onHhMm('satH','satM','satWarn', { cap: false }); autosave(); });
    for (const id of ['satH', 'satM']) {
      // SAVED ON LEAVING ONLY WHEN THE CAP REWROTE THE BOXES (24-hour review, 25 Nov 2026). Everything typed is
      // saved as it is typed (above); a save on every blur also saved the calendar's display-only gold figures
      // when the box was merely tapped into and left — Next, a tab, the page hidden — so a payslip only LOOKED
      // at read as entered (invariant 11: viewing never persists).
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('blur', () => { if (onHhMm('satH','satM','satWarn')) autosave(); });
    }

    // Every other hours pair — minutes clamp + autosave; Saturday's, above, carries the cap as well.
    for (const { cat, hId, mId } of HM_PAIRS) {
      if (cat === 'sat') continue;
      /** @type {HTMLElement} */ (document.getElementById(hId)).addEventListener('input', autosave);
      /** @type {HTMLElement} */ (document.getElementById(mId)).addEventListener('input', () => { clampMins(mId); autosave(); });
    }
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
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('input', runCalcBackPay);
    });
    ['oldRate','oldLondon','bpRisePct'].forEach(/** @param {string} id */ id => {
      /** @type {HTMLElement} */ (document.getElementById(id)).addEventListener('input', applyBpRisePct);
    });
    // Amount-source toggle + manual amount: flipping the mode shows/hides the field group and
    // recomputes; typing the manual figure recomputes.
    document.getElementsByName('bpMode').forEach(/** @param {any} r */ r =>
      r.addEventListener('change', () => { applyBpMode(); runCalcBackPay(); }));
    document.getElementById('bpManualAmt')?.addEventListener('input', runCalcBackPay);

    // HPP amount-source toggle + manual inputs: flip the mode → show/hide the matching field group,
    // persist the choice for the viewed tax year, and recompute (calculate() → calcHPP reads the mode
    // and writes the resulting figure to hppEstKey, so the January take-home add is unchanged).
    const _saveHppForViewedYear = () => {
      const _hp = viewedPeriod();
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
        // prefillBackPay fills the rate boxes for the selected award year; applyBpRisePct then
        // derives the New rate/London from any defaulted "Pay rise %" (unconfirmed award). Shared
        // with onPeriodChange so a year switch while open re-prefills.
        refreshBackPayCard();
      });

    // The back-pay breakdown, its paid-in payslip and its opt-in tick; Save settings
    /** @type {HTMLElement} */ (document.getElementById('bpBreakdownBtn')).addEventListener('click', toggleBpBreakdown);
    /** @type {HTMLElement} */ (document.getElementById('backPayPeriod')).addEventListener('change', runCalcBackPay);
    /** @type {HTMLElement} */ (document.getElementById('bpIncludeTick')).addEventListener('change', runCalcBackPay);
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
    // The Grade box and the payslip a chosen grade starts from are ONE setting, so they share one
    // handler (paycalc-grade.js).
    const _onGradeChange = () => {
      // Preserve a hand-entered pension: replace it only while it still holds the default it held
      // BEFORE the change, so tapping the grade just to check it never wipes a figure copied off a
      // payslip. Read before saveSettings(), which is what moves the setting.
      const _gP = viewedPeriod();

      const _pa = /** @type {HTMLInputElement | null} */ (document.getElementById('pensionAmt'));
      const _oldPenDefault = _gP ? periodDefaultPension(_gP).toFixed(2) : '';
      const penUntouched = !_pa || _pa.value.trim() === '' || _pa.value === _oldPenDefault;

      saveSettings(); // calls invalidateGrade(), so everything below prices with the new setting
      // The hourly rate is fixed by grade and read-only: reload the new grade's rate for this payslip.
      if (_gP) updateRateForPeriod(taxYearForPeriod(_gP), _gP);
      if (_pa && penUntouched) _pa.value = periodDefaultPension(_gP).toFixed(2);
      // Recompute the back-pay card for the NEW grade: its saved blob holds the old grade's award
      // rates, and without this the stale lump stayed in read-only boxes with no way to repair it.
      // calcBackPay re-enforces AWARD_RATES (and saves the corrected figures); the card re-prices
      // only if the lump changed, so the calculate() below stays for the pension and rate.
      runCalcBackPay();
      calculate();
    };
    /** @type {HTMLElement} */ (document.getElementById('gradeSelect')).addEventListener('change', _onGradeChange);
    document.getElementById('gradeFrom')?.addEventListener('change', _onGradeChange);
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

    // Per-period overrides — and the tick that says a payslip has no special-rate hours at all
    /** @type {HTMLElement} */ (document.getElementById('slSkipCheck')).addEventListener('change', autosave);
    document.getElementById('noSpecialCheck')?.addEventListener('change', autosave);
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

    // The Year to Date card's figure boxes and its "From which payslip?" select: the source each
    // typing stamps or moves, and the pick that keeps or un-anchors it (paycalc-ytd-card.js).
    wireYtdCard({ saveSettings, calculate });

    // The prior year's confirmed premium commits on `change` (leaving the field), NEVER on `input`:
    // commitPriorHppActual (paycalc-hpp.js) says what per-keystroke commits did to a confirmed figure.
    /** @type {HTMLElement} */ (document.getElementById('priorHppActualInput')).addEventListener('change', () => {
      const curP = viewedPeriod();
      commitPriorHppActual(taxYearForPeriod(curP), /** @type {HTMLInputElement} */ (document.getElementById('priorHppActualInput')).value);
      // The January take-home, its banner, chips and the year block all read the stored figure.
      calculate();
    });

    // The two money banners' opt-in ticks and "view … card" links, and the HPP card's link to the
    // back-pay card (paycalc-money-banner.js → wireBannerTicks).
    wireBannerTicks({ calculate });

    // HPP formula toggle + disclaimer
    /** @type {HTMLElement} */ (document.getElementById('hppToggleBtn')).addEventListener('click', toggleHppNote);
    /** @type {HTMLElement} */ (document.getElementById('disclaimerToggle')).addEventListener('click', toggleDisclaimer);

    // ── LIGHTBOXES — About, Help, the two Pay notices, the data-ownership prompt, the developer's
    // payslip import, and the decimal converter card: paycalc-lightboxes.js, whose header lists them
    // (the Welcome lightbox was retired at v19.36). Returns the About open handle so the nav-panel
    // drawer logo can open the same panel.
    const { openAboutLightbox, showPayNotice } = initPaycalcLightboxes();

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
        // The page's notices — the Year to Date one, then the Holiday Pay Premium one — queue BEHIND
        // it, on the promise `initPasswordForce` returns for exactly that ("the next overlay that has
        // to queue behind this one"), or one opens in front of a set-password block the member cannot
        // dismiss. No branch on the result: if the overlay is up, `openNoticeIfClear` defers the
        // notice to the next load. `.catch` because a failed password overlay must never cost the
        // member their notice — it fails open by design.
        initPasswordForce(name, {}).catch(() => {}).finally(() => showPayNotice());
      };
      // SOFT enforcement (AUTH_ARCHITECTURE.md Phase 7): the calculator keeps its data on the device
      // and writes no isolated data, so a degraded or anonymous session must NEVER block it — being
      // `soft`, requirePage('paycalc') returns 'allow' or 'soft-allow', and 'soft-allow' (the
      // member's own session unconfirmed) is only logged. Its one 'forbidden', an Other Staff login,
      // never reaches here: payCalculatorPrices asks the same policy, and the role card is shown
      // above. ensureNamedSession feeds the auth store.
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
    // it — filled, or checked as having no special-rate hours (loadPeriodData re-reads storage and
    // restores the gold suggested state, or the tick), then recalculate, which re-renders the year
    // block, its receipt and the HPP the new hours feed.
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
      // "Pay Calculator", never the old MYB name: the app is "Marylebone Roster" on screen, and a
      // print header is where a stale name leaves the app on paper. The payday with its whole year,
      // as the result card and the picker say it ("Paid 20 Nov 2026") — never "20 Nov 26" on paper.
      const label = p ? `Paid ${fdLong(p.payday)} (P${payslipPeriodNum(p)}) · ${now}` : `Pay Calculator · ${now}`;
      hdr.setAttribute('data-print-line', label);
    }
    stampPaycalcPrintLine();
    window.addEventListener('beforeprint', stampPaycalcPrintLine);

    // The pill gates are `navGatesFor`'s, spread at every initNavPanel call (page-contract-parity checks
    // each call; nav-gates.test.mjs checks the answer). `_showUnsupportedRole` draws the other drawer.
    const _paycalcMember = getLoggedMember();
    initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_PLAN.md → E1).
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
    // (About's print button is about-lightbox.js's; a copy here once left the page scroll-locked.)
}
