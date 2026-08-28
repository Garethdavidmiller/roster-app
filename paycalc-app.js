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
import { requirePage, canOpenOvertime } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import {
  CONFIG, getPeriods, currentPeriodNum, todaysPeriodNum, payslipPeriodNum,
  hasBoxingDay, hasBankHoliday,
  updateBhRows, buildPeriodSelect,
  updateTyTabs, jumpToTaxYear, prevPeriod, nextPeriod,
  setEarliestVisiblePeriod, isTaxYearVisible, visiblePeriods,
  _setSelectPeriod, buildYtdSourceSelect,
} from './paycalc-periods.js';
import {
  getGrade, getEffectiveContr, getLoggedMember, getProRateFactor, getPensionDefault,
  applyPensionOptOutUI, wirePensionControls, gradeForRole, periodDefaultPension,
  updateRateForPeriod, updateYtdForTaxYear, settingsKey, setSettingsCardOpen,
  saveSettings, confirmSettings, loadSettings, getStoredRateForYear,
} from './paycalc-settings.js';
import {
  updateRosterHint, updateJoinerNotice, toggleRosterDays,
  fillCategoryFromRoster, fillFromRoster, _applyRosterSuggestion,
  clearRosterSuggestedAll, _restoreRosterSuggested, snapKey, HM_PAIRS,
} from './paycalc-roster-hint.js';
import { isDataEmpty, calcHPP, updatePriorHpp, resolveHppForPeriod, applyHppMode, restoreHppState, saveHppState } from './paycalc-hpp.js';
import { prefillBackPay, calcBackPay, restoreBpState, _bpAwardTaxYear, _backdatedFromPNum, raiseByPercent, applyBpMode } from './paycalc-backpay.js';
import { computeYearSoFar } from './paycalc-year-summary.js';
import { hppTaxYearForPayslip, hppPaidInTaxYear } from './paycalc-hpp-schedule.js';
import { initNavPanel } from './nav-panel.js';
import { initCardCollapse } from './overlay.js';
import { registerServiceWorker } from './sw-register.js';
import { initErrorReporter } from './error-reporter.js';
import { initPasswordForce } from './password-force.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency, markPageReady } from './perf-reporter.js';
import { SK, periodKey, hppEstKey, hppActualKey, hppIncKey, ytdSrcKey, runMigrations, readPayslipActuals, isActualsDev, parseSavedPeriod } from './paycalc-migrations.js';
import { initPaycalcLightboxes } from './paycalc-lightboxes.js';
import { fd, fdShort, fdLong, fdList, fmt, decimalToHM } from './paycalc-format.js';
import { numVal, numValOr, hhmmDec, clampMins, _decHintEl, decPreview, wireIosTap } from './paycalc-inputs.js';
import { emptyPeriodData, readFormData, writeFormData } from './paycalc-form-data.js';
import { initTransferCard } from './paycalc-transfer-card.js';
import { buildSummaryRows, buildBreakdownRows, buildActualCheck, buildProvChips } from './paycalc-breakdown.js';

import { setStatus } from './status-text.js';
import { initPaycalcStickyTotal } from './paycalc-sticky-total.js';
/**
 * Phase 4a.2 (ARCHITECTURE_PLAN.md): the coordinator body is an exported init()
 * called by paycalc-boot.js (a 2-line bootstrap — CSP `script-src 'self'` blocks
 * inline module scripts). The local-identity gate below early-`return`s instead of
 * throwing, and importing this module no longer auto-runs it (testability). Body
 * unchanged otherwise — same statements, same order, one indent level in.
 */
/**
 * Withhold the calculator from a role it has no confirmed rates for, and say why (v21.78).
 * Rationale: AI_MAP → `gradeForRole`. Two things an editor here needs — it WITHHOLDS rather than
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
    initNavPanel({
        currentPage: 'paycalc',
        memberName:  member?.name || null,
        isAdmin:         ROSTER_CONFIG.ADMIN_NAMES.includes(member?.name ?? ''),
        isLinksDesigner: ROSTER_CONFIG.LINKS_DESIGNERS.includes(member?.name ?? ''),
        canOpenOvertime: canOpenOvertime(member?.name ?? ''),
        onSignOut: () => { clearSession(); window.location.href = './'; },
    });
    registerServiceWorker();
    markPageReady();
    recordUsage('paycalc', member?.name || null);
}

export function init() {
    // Tear down a lingering privileged Firebase identity whose local app session has expired, so a
    // direct deep-link to this page can't keep an old credential live (review item 7 / Finding #9).
    // Runs BEFORE the session-guard early-return below (the expired-session path is exactly where a
    // stale identity lingers). Fire-and-forget, login-safe: no-op on a valid session, stands down if a
    // login supersedes it.
    reconcileExpiredIdentity().catch(() => {});

    // ── SESSION GUARD (local-identity precondition) ───────────────────────────────
    // Not signed in → show the shared in-place sign-in (no redirect elsewhere). After sign-in,
    // reload back into the calculator. getSession() (session.js) enforces the 60-day absolute
    // expiry — a raw localStorage read would treat an expired session as valid forever. (The 7-day
    // idle clock this used to refresh went at v20.41; the read is pure now.) Early-return halts the
    // rest of init() (overlay is shown).
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

    // A ROLE WITH NO CONFIRMED RATES REFUSES RATHER THAN GUESSING (v21.78, external review): the
    // grade lookup treats "no grade stored" as CEA at every consumer, so ten Dispatchers and seven
    // manager accounts were being handed a polished estimate at somebody else's rate. Before every
    // other init step, so nothing can render a figure first. Why: AI_MAP → `gradeForRole`.
    const _roleMember = getLoggedMember();
    if (_roleMember && !gradeForRole(_roleMember.role)) {
      _showUnsupportedRole(_roleMember);
      return;
    }

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

    // ── PERIOD DATA ROUND TRIP — extracted to paycalc-form-data.js (v19.11) ─────────
    // emptyPeriodData / readFormData / writeFormData moved out so the round trip that four
    // money-affecting defects came from (v16.84, v18.42, v18.43 and its predecessor) is
    // finally testable. The coordinator keeps WHEN to save/load; the module keeps HOW a
    // field persists. `_adjNegative` and the period pension default are injected, so the
    // module needs no coordinator state.

    // ── DATE/CURRENCY HELPERS — imported from paycalc-format.js ──────────────────
    // fd / fdShort / fmt imported at the top of the file.

    // ── INPUT HELPERS ─────────────────────────────────────────────────────────────
    // The DOM-pure field readers + live decimal hint — numVal / numValOr / intVal / hhmmDec /
    // clampMins / _decHintEl / decPreview — are extracted to paycalc-inputs.js (v18.60, review
    // item 10) and imported above. The event WIRING that USES them (autoDecimalHours, onHhMm)
    // stays here because it closes over calculate()/autosave()/period state.

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
      // Re-run the Saturday contracted-hours cap on the SPLIT value (review finding): the cap fires
      // on 'input', but the blur-time decimal split writes new h/m values without it — "140.5" blurred
      // to 140h30m and was silently stored over the cap (money stayed right via capHours; the stored
      // fields and the ⚠ warning didn't).
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
          /** @type {HTMLInputElement} */ (document.getElementById(mId)).value = '0';
          if (warn) { setStatus(warn, `⚠ Capped at ${contr} hrs — your contracted maximum for this period`); warn.classList.add('show'); }
        } else {
          if (warn) warn.classList.remove('show');
        }
      }
      calculate();
    }

    // Period helpers (getPeriods, currentPeriodNum, updateBhRows, buildPeriodSelect,
    // updateTyTabs, jumpToTaxYear, prevPeriod, nextPeriod) imported from paycalc-periods.js.
    // getTaxYearForOffset, getThresholds, getLondonAllowanceForPeriod imported from paycalc-calc.js.

    /** True when either Year to Date field holds text — the shared guard the anchor stamp, the
     *  note and the header chip all branch on (was three inline copies; v18.46 — sweep item 10). */
    function _ytdHasFigures() {
      return ((/** @type {HTMLInputElement|null} */ (document.getElementById('ytdPay')))?.value.trim() || '') !== ''
          || ((/** @type {HTMLInputElement|null} */ (document.getElementById('ytdTax')))?.value.trim() || '') !== '';
    }

    /**
     * Refresh the Year-to-Date source-payslip anchor for the viewed tax year (v17.98): rebuild the
     * "From which payslip?" select with the year's paid payslips, restore the stored source (legacy
     * figures with no recorded source are stamped with the app's own standing assumption — the
     * payslip before today's, clamped into the year — making the old implicit behaviour explicit
     * and editable), and rewrite the note that states whether the figures sharpen THIS payslip.
     * @param {any} ty @param {any} p
     */
    function _refreshYtdSrc(ty, p) {
      const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('ytdSrcSelect'));
      if (!sel) return;
      buildYtdSourceSelect(ty);
      const _rawSrc = lsGet(ytdSrcKey(ty));
      let src = parseInt(_rawSrc ?? '', 10) || 0;
      const hasFigures = _ytdHasFigures();
      // Legacy stamp: ONLY when NO source was EVER recorded (raw === null) — anchor pre-v17.98 figures
      // to the payslip before TODAY's (the latest paid), clamped into this tax year, so a maintained
      // user's next-payslip estimate is unchanged. A recorded '0' means the member DELIBERATELY
      // un-anchored (picked the blank placeholder); that must PERSIST and never be re-stamped here —
      // otherwise the next period change silently re-engages cumulative PAYE against figures the
      // member detached (v18.12 — the un-anchor handler now records '0' rather than deleting the key).
      if (_rawSrc == null && hasFigures) {
        src = Math.min(Math.max(todaysPeriodNum() - 1, 48 + ty.first), 48 + ty.last);
        lsSet(ytdSrcKey(ty), String(src));
      }
      if (src) _setSelectPeriod(sel, src);
      _updateYtdNote(ty, p, src);
    }

    /** The YTD note: states which payslip the figures are from and whether they sharpen the one on
     *  screen (the cumulative method engages only on source + 1). Also writes the header status
     *  chip (#ytdStatusChip, v18.40 — review item 6) so the in-use state is visible even while the
     *  card is collapsed. @param {any} ty @param {any} p @param {number} src */
    function _updateYtdNote(ty, p, src) {
      const note = document.getElementById('ytdUptoNote');
      if (!note) return;
      const srcP0 = src ? getPeriods().find(/** @param {any} x */ x => x.num === src) : null;
      note.classList.toggle('ytd-upto-note--live', !!(srcP0 && p.num === src + 1));
      const periodIdx = (p.num - 48) - ty.first + 1; // 1-based HMRC period within the tax year
      // Header status chip: "✓ in use" (green) when the figures sharpen THIS payslip, "not in use"
      // when another payslip is viewed, empty (hidden) when there's nothing to report — no figures,
      // no source, or the year's first payslip (Year to Date starts fresh in April).
      const _chip = document.getElementById('ytdStatusChip');
      if (_chip) {
        const _hasFigures = _ytdHasFigures();
        const _live = !!(srcP0 && p.num === src + 1 && _hasFigures);
        _chip.classList.toggle('ytd-status-chip--live', _live);
        _chip.textContent = (!_hasFigures || !srcP0 || periodIdx <= 1) ? '' : (_live ? '✓ in use' : 'not in use');
        _chip.title = _live
          ? 'Your Year to Date figures sharpen this payslip’s tax estimate'
          : 'This payslip uses the standard method — the Year to Date figures don’t apply to it';
      }
      if (periodIdx <= 1) {
        note.innerHTML = `This is the first payslip of ${ty.label} — Year to Date starts fresh in April, so you can leave these blank.`;
        return;
      }
      const srcP = srcP0;   // same lookup as above — do not re-find (sweep item 10)
      if (!srcP) {
        // No source yet → NO note (v18.49): the old copy-and-pick prompt here was the FOURTH
        // statement of the same instruction on one screen (header hint, field labels, select
        // label all carry it). Empty → hidden via the .ytd-upto-note:empty CSS rule.
        note.innerHTML = '';
        return;
      }
      const from = `your <strong>${fdShort(srcP.payday)} payslip</strong> (P${payslipPeriodNum(srcP)})`;
      if (p.num === src + 1) {
        note.innerHTML = `<span aria-hidden="true">✓</span> Your Year to Date figures are from ${from} — they sharpen <strong>this payslip's</strong> tax estimate.`;
      } else {
        const prevP = getPeriods().find(/** @param {any} x */ x => x.num === p.num - 1);
        const upd = prevP && prevP.num < todaysPeriodNum()
          ? ` Update them from your <strong>${fdShort(prevP.payday)} payslip</strong> (P${payslipPeriodNum(prevP)}) to sharpen it.`
          : '';
        note.innerHTML = `Your Year to Date figures are from ${from}, so this payslip uses the standard method.${upd}`;
      }
    }

    function onPeriodChange() {
      _resetClearConfirm();   // switching period disarms a pending two-tap Clear (v16.84)
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
      // The payday is NOT repeated here (v18.45 — sweep item 2): the select directly above already
      // reads "Paid 31 Jul 2026 · P20" (date-first identity), so the meta row carries only what the
      // select doesn't — the shift-date range and the tax year. The gold P-badge stays (the docs'
      // payslip cross-check).
      // LABELLED (v21.69). This read as a bare "26 Jul – 22 Aug 2026" — the reader had to know
      // it meant the shift window, and because nothing said so, the same cut-off date was
      // restated inside three separate hours-row descriptions. Naming it here retires all three.
      /** @type {HTMLElement} */ (document.getElementById('pmRange')).textContent   = `Hours worked ${startStr} – ${cutLongStr}`;
      /** @type {HTMLElement} */ (document.getElementById('pmSub')).textContent     = `Tax year ${ty.label}`;
      /** @type {HTMLElement} */ (document.getElementById('periodBadge')).textContent = `P${payslipPeriodNum(p)}`;
      // fdLong, not fd (v21.69): the payslip picker directly above this reads "Paid 28 Aug 2026 ·
      // P24" while the hero read "Paid 28 Aug 26" — two formats for one date, a foot apart, and the
      // 2-digit one on the single most-read line of the page.
      /** @type {HTMLElement} */ (document.getElementById('netPeriod')).textContent   = `Paid ${fdLong(p.payday)}`;

      const boxing = hasBoxingDay(p);
      /** @type {HTMLElement} */ (document.getElementById('boxingBanner')).classList.toggle('visible', boxing);
      /** @type {HTMLElement} */ (document.getElementById('boxingRow')).classList.toggle('hidden', !boxing);
      if (!boxing) { /** @type {HTMLInputElement} */ (document.getElementById('boxH')).value = ''; /** @type {HTMLInputElement} */ (document.getElementById('boxM')).value = ''; }

      // Update tax year tab active state
      updateTyTabs();

      // Tax-year chip in the back-pay + HPP + Year-to-Date card headers — makes clear WHICH year
      // each card is editing, even when collapsed (all follow the viewed period's tax year). (v17.89)
      // The chip shows the COMPACT tax-year form ("26/27", v18.53) — the full "2026/27" tipped the
      // longest title ("Holiday Pay Premium (HPP)") into a two-line wrap on narrow phones; the full
      // year stays on the tabs and in the chip's tooltip. `.slice(2)` = drop the century digits.
      const _chipYear = /^\d{4}\/\d{2}$/.test(ty.label) ? ty.label.slice(2) : ty.label;
      for (const _cid of ['bpYearChip', 'hppYearChip', 'ytdYearChip']) {
        const _chip = document.getElementById(_cid);
        if (_chip) { _chip.textContent = _chipYear; _chip.title = `Tax year ${ty.label}`; }
      }
      // Settings card chip shows the PERIOD/payslip you're on (the rate + pension are period-specific)
      // — the settings summary already carries the tax year. (v17.92)
      const _spc = document.getElementById('settingsPeriodChip');
      // The PAYDAY, not the period number (v18.04 — owner: staff remember paydates, not P-numbers).
      if (_spc) _spc.textContent = fdShort(p.payday);

      // Load the rate and Year to Date figures for this period's tax year (period-aware: an
      // early-in-the-year period before its mid-year pay-award date shows the pre-rise rate).
      updateRateForPeriod(ty, p);
      updateYtdForTaxYear(ty);

      // Year-to-Date SOURCE anchor (v17.98 — owner: "doesn't YTD also need what payslip you're
      // attaching it to?"). The figures are stored once per tax year WITH the payslip they were
      // copied from (ytdSrcKey); the cumulative method engages only on the payslip immediately
      // after that source (see calculate()), and the note states the position plainly.
      _refreshYtdSrc(ty, p);

      // HPP amount-source (v18.32): restore THIS tax year's saved mode + manual inputs into the DOM
      // BEFORE loadPeriodData() runs calculate() (→ calcHPP reads the mode), so switching tax years
      // shows each year's own choice. Per-year, keyed like the HPP include-tick / back-pay blob.
      restoreHppState(ty);
      // Update the "for P__" label next to the pension field so users can see
      // which period's pension they are viewing or editing.
      const pensionPeriodLbl = document.getElementById('pensionPeriodLabel');
      if (pensionPeriodLbl) pensionPeriodLbl.textContent = `for the ${fdShort(p.payday)} payslip`;

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
        // No tax code in the collapsed summary (v17.95): with the period chip beside it the code
        // widowed onto a second line at 390px, and it's the least period-relevant item — the year,
        // rate and pre/post-rise position are the at-a-glance facts. The code lives inside the card.
        /** @type {HTMLElement} */ (document.getElementById('settingsHint')).textContent =
          `✓ ${ty.label} — £${rate}/hr${_hintPreAward ? ' · pre-rise' : ''}`;
      } else {
        /** @type {HTMLElement} */ (document.getElementById('setupBannerBody')).innerHTML =
          `We've filled in the usual defaults — <strong>check your grade and tax code</strong> in ⚙️ Your Settings below, then tap <strong>Save settings</strong>. You can add your hours with <strong>Fill from calendar</strong>. These settings apply to ${ty.label} only — you'll be prompted again when the new tax year starts.`;
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
                ? `New tax year ${ty.label} — a pay award has been accepted but isn't on payslips yet. Your rate stays on last year's until the award lands on a payslip, then it updates automatically. Check your tax code, then tap Save settings.`
                : `New tax year ${ty.label} — your hourly rate updates automatically. Check your tax code and pension, then tap Save settings.`;
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
          // Silently refresh any gold-highlighted fields filled during 'checking' state — but
          // DISPLAY-ONLY (v18.46 — sweep item 15, owner decision): the suggestion shows gold and
          // feeds the live estimate, but is NOT persisted. Merely VIEWING a payslip used to
          // autosave the suggestion, so the period counted as "entered" in the HPP / year-so-far /
          // back-pay aggregates without the member ever confirming it. Persistence now requires an
          // explicit action: typing anything (autosave captures the gold values with it — implicit
          // acceptance) or the Fill from calendar buttons. calculate() keeps the on-screen £ live.
          const _refreshP = getPeriods().find(/** @param {any} x */ x => x.num === _fetchedPNum);
          if (_refreshP) {
            const _refreshS = getRosterSuggestion(_refreshP, getLoggedMember());
            if (_refreshS) { _applyRosterSuggestion(_refreshS); calculate(); }
          }
        });
      }

      // Load saved data for this period
      loadPeriodData(p.num);
      // The pension LOCK follows the viewed payslip (v21.78) — a member who left the scheme in
      // August is still contributing on her July one. AFTER loadPeriodData deliberately: that
      // paints the value, and this may only override it where the timeline says there was none.
      applyPensionOptOutUI(p);

      // Sync the back-pay card to the newly-viewed period's award year (v17.86 per-year viewing) —
      // ALWAYS, not only when the card is open, so the banner + take-home reflect whichever payslip
      // is on screen (each year's lump lands on its own payslip; the coordinator still gates the
      // gross on `_bpPNum === _pNum`). Per-year keys keep each year's tick/rates/manual amount apart.
      _syncBackPayForViewedYear();

      stampPaycalcPrintLine();
    }

    // currentPeriodNum() imported from paycalc-periods.js

    // ── PERIOD DATA SAVE / LOAD ───────────────────────────────────────────────────
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
      const _autoP = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
      const d    = readFormData({
        adjNegative: _adjNegative,
        periodDefaultPension: _autoP ? periodDefaultPension(_autoP) : null,
      });
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
      clearRosterSuggestedAll();   // was writeFormData's opening statement (v19.11)
      _adjNegative = writeFormData(d).adjNegative;
      _restoreRosterSuggested(pNum);
      // If no pension has been manually saved for this period, apply the period-specific
      // default. This handles both: (a) pension rate cut-overs (old periods show the old
      // rate, new periods show the new rate) and (b) joining-period pro-ration.
      const _pObj = getPeriods().find(/** @param {any} x */ x => x.num === pNum);
      if (d.pension == null && _pObj) {
        const pa = /** @type {HTMLInputElement | null} */ (document.getElementById('pensionAmt'));
        if (pa) pa.value = periodDefaultPension(_pObj).toFixed(2);
      }
      updateAdjSign();
      // Auto-expand "more options" if this period has extras saved. Route through _setDisclosure so
      // the button's aria-expanded + arrow stay in step (a class-only .open left it stale — a screen
      // reader heard "collapsed" on the expanded disclosure). Idempotent, so no need to pre-check state.
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
          // Saved data exists but can't be read — say so, don't masquerade as "No entries saved"
          // (the user would type over the damaged blob without knowing it held anything) (v16.70).
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
      clearRosterSuggestedAll();   // was writeFormData's opening statement (v19.11)
      writeFormData(emptyPeriodData());
      // Apply the period-specific pension default (pro-rated for joining periods, rate-cut-over
      // aware) — writeFormData no longer does this when d.pension is null.
      const _clearP = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
      if (_clearP) {
        const _pa = /** @type {HTMLInputElement | null} */ (document.getElementById('pensionAmt'));
        if (_pa) _pa.value = periodDefaultPension(_clearP).toFixed(2);
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
        { id: 'pbbSL',      cls: 'pbb-sl',      val: sl,      label: 'Student Loan', legendId: 'pblSL', dotCls: 'pbl-dot pbb-sl' },
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
      // The field is read-only + grade-derived (v17.87), so this read is belt-and-braces: the
      // Math.max floor and grade-default fallback only matter if the DOM value is ever missing.
      // (The old typo/low-rate warnings were removed with the editable field — unreachable.)
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

      // Add back pay if this is the paid-in period AND the member ticked "add to take-home"
      // (opt-in, OFF by default — the card computes/show the lump either way).
      const _bpThisPeriod = (_bpPNum > 0 && _bpPNum === _pNum && _bpIncluded) ? _bpAmount : 0;

      // Add HPP estimate/actual if this is the January period where HPP is paid — i.e. the tax year
      // whose premium lands on THIS payslip (the prior year's; see paycalc-hpp-schedule.js, which
      // owns the payslip ↔ tax-year relation and guards the two-Januaries case). The estimate is
      // pre-computed by calcHPP() and stored in localStorage whenever the user views any period in
      // that tax year — by end of April it is essentially final.
      const _hppTy = hppTaxYearForPayslip(_curP, getPeriods(), CONFIG.TAX_YEARS);
      // A CONFIRMED actual (present in storage, even £0) beats the estimate — resolveHppForPeriod
      // is the single source of that rule (a confirmed £0 correctly adds nothing; the pre-v17.26
      // `actual > 0` test kept silently adding the stale estimate to take-home). Shared with the
      // prior-year card display so the two can't diverge.
      // January-only pointer in the Year to Date card (v18.50): visible ONLY while the viewed
      // payslip is the January one that carries HPP — as a permanent paragraph it read wrong on
      // every other payslip (owner, Jul 2026; the year-round version lives in the card's ? help).
      const _janHint = document.getElementById('ytdJanHppHint');
      if (_janHint) _janHint.hidden = !_hppTy;
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

      // First-use hint only (v18.45 — sweep item 5): once this period has any entered hours the
      // "updates automatically" line has done its job — hide it so the hero stays information-dense
      // (the provenance chips occupy that space with real facts).
      const _netHintEl = document.getElementById('netHint');
      if (_netHintEl) _netHintEl.hidden =
        satHrs > 0 || bhHrs > 0 || bhOtHrs > 0 || oHrs > 0 || rHrs > 0 || sHrs > 0 || bHrs > 0 || peer > 0;

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
          : periodDefaultPension(_curP);
      const pensionWarn = document.getElementById('pensionWarn');
      if (pensionWarn) pensionWarn.classList.toggle('show', pension > grossWithBp && pension > 0);
      const sacGross   = Math.max(0, grossWithBp - pension);

      // Income tax — cumulative PAYE when YTD figures provided (W1/M1/X excluded)
      // Pass null (not 0) when the field is empty so computeTax distinguishes "not provided" from "£0 entered"
      const ytdPayEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ytdPay'));
      const ytdTaxEl = /** @type {HTMLInputElement | null} */ (document.getElementById('ytdTax'));
      // Garbage (NaN) falls back to null too — a stray character means "not usable", not "£0 YTD",
      // so tax quietly stays non-cumulative rather than asserting a £0 year-to-date figure.
      let ytdP = (ytdPayEl?.value ?? '').trim() !== '' ? numValOr('ytdPay', null) : null;
      // Mirror the ytdPay guard — pass null (not 0) when blank so computeTax treats
      // "ytdPay filled, ytdTax left blank" as incomplete rather than "£0 tax collected".
      let ytdT = (ytdTaxEl?.value ?? '').trim() !== '' ? numValOr('ytdTax', null) : null;
      // SOURCE anchor (v17.98): the cumulative method adds this payslip's gross to the entered
      // totals, so it is only VALID on the payslip immediately after the one the figures came
      // from. Any other payslip falls back to the standard (non-cumulative) method — previously
      // stale figures were silently treated as last-payslip totals and quietly skewed the tax.
      const _ytdSrc = parseInt(lsGet(ytdSrcKey(_ty)) ?? '', 10) || 0;
      if (!(_ytdSrc && _curP && _curP.num === _ytdSrc + 1)) { ytdP = null; ytdT = null; }
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
      const _anyLoan = plan !== 'none' || pgLoan;
      // The "not deducted this period" skip + its row apply to whichever loan(s) are active.
      /** @type {HTMLElement} */ (document.getElementById('slSkipRow')).classList.toggle('hidden', !_anyLoan);
      // Loan-repaid cutover (v18.41 — review item 9): the loan settles ONCE, on a specific payslip —
      // deductions stop from that payslip onward while EARLIER payslips keep theirs, so historic
      // periods still reconcile against the real payslips (setting the plan to None would wrongly
      // strip them too). Complements slSkip (a one-off per-period skip). Applies to both loans —
      // HMRC stops PGL alongside when the balance clears; a member with genuinely separate end
      // dates can use the per-period skip for the gap.
      const _slPaidOffSel   = /** @type {HTMLSelectElement|null} */ (document.getElementById('slPaidOffFrom'));
      const _slPaidOffField = document.getElementById('slPaidOffField');
      if (_slPaidOffField) _slPaidOffField.classList.toggle('hidden', !_anyLoan);
      const _slPaidOffFromP = parseInt(_slPaidOffSel?.value || '', 10) || 0;
      const slPaidOff       = !!(_slPaidOffFromP && _pNum >= _slPaidOffFromP);
      // One undergraduate plan AND a Postgraduate Loan can be repaid together — HMRC deducts each
      // independently (9% above the plan threshold; 6% above the £21,000 PGL threshold). The TOTAL feeds
      // net + the break bar; the summary shows a separate line per active loan.
      const slUnder = slPaidOff ? 0 : computeSL(sacGross, plan, thresholds.sl, slSkip);
      const slPost  = (pgLoan && !slPaidOff) ? computeSL(sacGross, 'postgrad', thresholds.sl, slSkip) : 0;
      const sl = slUnder + slPost;

      const net = sacGross - tax - ni - sl;

      // Student/Postgraduate Loan summary lines — never silent when a loan is active (v16.77 clarity).
      // ONE shared builder so the plan and PGL rows can't drift: the PGL row previously lost the
      // "just above threshold → repayment rounds under £1" branch and wrongly said "under the
      // threshold" for pay that was ABOVE it (v17.20 fix). Per-loan states: a deduction; £0 because
      // Plan 5 isn't repayable this year; £0 genuinely under the threshold; or £0 because pay only just
      // exceeds the threshold so the 9%/6% rounds under £1 (v16.84 — "under the threshold" is wrong there).
      const _slPlanLabel = _slSel.selectedOptions[0]?.textContent?.trim() ?? plan;
      // Penny-floor the periodic threshold for DISPLAY exactly as computeSL does (Math.floor(t*100)/100)
      // — otherwise fmt() rounds the raw annual÷13 value and the parenthetical threshold in the message
      // can read 1p above the figure the deduction is actually computed against.
      const _pennyFloor  = (/** @type {number|undefined} */ t) => t == null ? t : Math.floor(t * 100) / 100;
      const _slThreshold = _pennyFloor((/** @type {Record<string, any>} */ (thresholds.sl))[plan]?.t);
      const _pgThreshold = _pennyFloor((/** @type {Record<string, any>} */ (thresholds.sl)).postgrad?.t);
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
      // The repaid cutover outranks the per-period skip (a settled loan is the stronger fact); the
      // skip governs BOTH loans → ONE combined row (was two identical rows), matching the single
      // breakdown line below.
      const _slPaidOffP = slPaidOff ? getPeriods().find(/** @param {any} x */ x => x.num === _slPaidOffFromP) : null;
      const slLines = (slPaidOff && _anyLoan)
        // NOT "repaid in full" — the same wording fix as the Settings label (v19.27). The member may
        // have moved to direct debit with a balance outstanding, which is the SLC's normal endgame.
        ? `<div class="sum-row sum-sl-zero"><span class="lbl">Student Loan — not deducted from your ${_slPaidOffP ? fdShort(_slPaidOffP.payday) + ' payslip' : 'chosen payslip'} onwards</span><span class="val">£0.00</span></div>`
        : (slSkip && _anyLoan)
        ? `<div class="sum-row sum-sl-zero"><span class="lbl">Student Loan — marked as not deducted this period</span><span class="val">£0.00</span></div>`
        : _slLine('Student Loan', slUnder, plan !== 'none', _slPlanLabel, _slThreshold,
                  plan === 'plan5' && !_plan5Allowed ? `Plan 5 is not repayable in ${_ty.label} (repayments begin April 2026)` : null)
          + _slLine('Postgraduate Loan', slPost, pgLoan, 'Postgraduate Loan', _pgThreshold, null);

      updateBreakBar(grossWithBp, pension, tax, ni, sl, net);

      // UI
      /** @type {HTMLElement} */ (document.getElementById('netDisplay')).textContent = fmt(net);
      /** @type {HTMLElement} */ (document.getElementById('pensionRef')).textContent = pension.toFixed(2);
      // (The pension explainer + absence caveat live INSIDE the Full pay breakdown now — v18.45,
      // sweep item 4: two permanent paragraphs at the result's foot diluted the real notices.)

      // Check against the real payslip (v18.42 — review item 3): PAID payslips only (a future one
      // has nothing to compare), verdict from the pure builder. The input autosaves in this
      // period's blob (actualNet), so each payslip keeps its own figure.
      const _caWrap = document.getElementById('checkActualWrap');
      if (_caWrap) {
        const _caPaid = _curP.payday <= new Date();
        _caWrap.hidden = !_caPaid;
        const _caEl = /** @type {HTMLInputElement|null} */ (document.getElementById('actualNetInput'));
        const _caActual = _caPaid ? Math.max(0, parseSmartFloat(_caEl?.value ?? '') || 0) : 0;
        const _caV = document.getElementById('actualVerdict');
        if (_caV) _caV.innerHTML = buildActualCheck(_caActual, net);
      }

      // Provenance chips under the take-home £ (v18.44 — review item 1): what fed THIS number.
      // Empty (invisible) on a normal payslip — chips only appear when noteworthy.
      const _chipsEl = document.getElementById('provChips');
      if (_chipsEl) {
        const _srcP = _ytdSrc ? getPeriods().find(/** @param {any} x */ x => x.num === _ytdSrc) : null;
        _chipsEl.innerHTML = buildProvChips({
          usingCumulative,
          srcLabel: _srcP ? fdShort(_srcP.payday) : '',
          bpAmount: _bpThisPeriod, hppAmount: _hppForPeriod,
          hoursFromCalendar: !!document.querySelector('#hoursCard .roster-suggested'),
        });
      }

      // Result markup is built by the two pure builders in paycalc-breakdown.js (review item 20) —
      // params are shorthand so field name === local name (see that module). calculate() keeps the
      // DOM read + pay maths; the string-building lives beside its unit tests.
      /** @type {HTMLElement} */ (document.getElementById('summary')).innerHTML = buildSummaryRows({
        _bpThisPeriod, _hppForPeriod, gross, grossWithBp, _bpIsEstimate, _hppIsEstimate,
        pension, sacGross, usingCumulative, tax, ni, slLines, net,
      });

      const bd = buildBreakdownRows({
        nonBhNorm, rate, gBasicNorm, satCapped, r125, gBasicSat, bhCapped, gBankHol,
        bhOtHrs, gBhOt, oHrs, gOvertime, rHrs, gRdw, sHrs, r150, gSunday, bHrs, r300, gBoxing,
        peer, gPeer, LONDON, otherAdj, slSkip, slPaidOff, plan, pgLoan, usingCumulative,
        _bpThisPeriod, _bpIsEstimate, _hppForPeriod, _hppIsEstimate,
      });
      if (bd !== _lastBdBodyHtml) {
        // #bdRows, not #bdBody: the pension/absence notes are static siblings inside the panel
        // (sweep item 4) and must survive the innerHTML rebuild.
        /** @type {HTMLElement} */ (document.getElementById('bdRows')).innerHTML = bd;
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
        if (_netLabel) setStatus(_netLabel, '✅ Your Actual Take-Home Pay');
        /** @type {HTMLElement} */ (document.getElementById('netDisplay')).textContent = fmt(_actual.net);
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
        // Keep the sticky label honest — this figure is the confirmed actual, not an estimate — and
        // lead with the payslip identity (v18.14) so a scrolled-away figure names WHICH payslip.
        const _stickyLbl = document.getElementById('stickyLabel');
        // Two-weight label (v18.15): the payday is the load-bearing part, so it renders full-white
        // semibold (.s-pay) while the boilerplate descriptor stays muted (.s-desc) — one flat
        // 0.75-opacity string read as noise. Static app-built markup, no user content.
        if (_stickyLbl) _stickyLbl.innerHTML = _curP
            ? `✅ <span class="s-pay">Paid ${fdShort(_curP.payday)}</span><span class="s-desc"> · Actual take-home</span>`
            : `<span class="s-desc">✅ Actual take-home</span>`;
        const _stickyBar = document.getElementById('stickyTotal');
        if (_stickyBar) _stickyBar.setAttribute('aria-label',
            `Actual take-home${_curP ? ` for the ${fdShort(_curP.payday)} payslip` : ''} — tap to view the full breakdown`);
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
        // Lead the sticky label with the payslip identity (v18.14) so a scrolled-away £ is never
        // ambiguous about WHICH payslip — the back-pay lump lands on only one, so this matters. The
        // full "(inc. back pay & HPP)" wording stays on the hero result card; the strip stays compact.
        const _stickyLbl = document.getElementById('stickyLabel');
        // Two-weight label (v18.15) — payday semibold, descriptor muted; see the actuals branch note.
        if (_stickyLbl) _stickyLbl.innerHTML = _curP
            ? `💷 <span class="s-pay">Paid ${fdShort(_curP.payday)}</span><span class="s-desc"> · Estimated take-home</span>`
            : `<span class="s-desc">💷 ${_suffix ? `Estimated take-home (${_suffix})` : 'Estimated take-home'}</span>`;
        const _stickyBar = document.getElementById('stickyTotal');
        if (_stickyBar) _stickyBar.setAttribute('aria-label',
            `Estimated take-home${_curP ? ` for the ${fdShort(_curP.payday)} payslip` : ''} — tap to view the full breakdown`);
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
      _renderYearSoFar(_ty, plan, pgLoan, _slPaidOffFromP);
    }

    /**
     * "This tax year so far" in the Year to Date card (v18.41 — review item 11): sums the year's
     * ENTERED payslips (headless per-payslip re-run — paycalc-year-summary.js) + a rough full-year
     * projection. Runs after every calculate() like calcHPP, so it tracks edits live. Hidden until
     * at least one payslip of the year has hours (quiet default).
     * @param {any} ty @param {string} plan @param {boolean} pgLoan @param {number} slPaidOffFromP
     */
    function _renderYearSoFar(ty, plan, pgLoan, slPaidOffFromP) {
      const el = document.getElementById('ytdYearSoFar');
      if (!el) return;
      const taxCode = (/** @type {HTMLInputElement} */ (document.getElementById('taxCode')).value || '1257L');
      // Pass the OPT-IN lumps so the year-so-far take-home agrees with the result card, which adds
      // them to the payslip they land on (bp → _bpPNum; HPP → the year's first January payslip).
      // Only when their include-tick is on — an un-ticked/estimated lump inflates neither surface.
      const bpLump = (_bpIncluded && _bpPNum > 0 && _bpAmount > 0) ? { pNum: _bpPNum, amount: _bpAmount } : null;
      // The HPP landing INSIDE this tax year is the PRIOR year's premium — a year's HPP is paid the
      // January AFTER it ends — so read the flags for THAT year, not the viewed one (v18.84: reading
      // hppIncKey(ty) asked the viewed year, whose own premium isn't paid until a year later, so the
      // tick came off the wrong year and the lump never joined these totals). Same single source as
      // the result card's _hppTy above, asked from the other direction.
      const _ysHpp = hppPaidInTaxYear(ty, getPeriods(), CONFIG.TAX_YEARS);
      const _ysHppTy = _ysHpp ? _ysHpp.taxYear : null;
      const _ysHppIncluded = !!_ysHppTy && lsGet(hppIncKey(_ysHppTy)) === '1';
      const _ysHppAmount = _ysHppIncluded
        ? resolveHppForPeriod(lsGet(hppActualKey(_ysHppTy)), lsGet(hppEstKey(_ysHppTy))).amount : 0;
      const hppLump = (_ysHppIncluded && _ysHppAmount > 0) ? { amount: _ysHppAmount } : null;
      const y = computeYearSoFar(ty, { taxCode, plan, pgLoan, slPaidOffFromP, bpLump, hppLump });
      if (!y.entered && !y.skipped) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
      const row = /** @param {string} lbl @param {number} val */ (lbl, val) =>
        `<div class="yearso-row"><span class="lbl">${lbl}</span><span class="val">≈ ${fmt(val)}</span></div>`;
      el.innerHTML =
        `<div class="yearso-head">This tax year so far <span class="yearso-count">${y.entered} of ${y.paid} paid payslip${y.paid !== 1 ? 's' : ''} entered</span></div>` +
        row('Taxable pay', y.taxable) + row('Tax', y.tax) + row('National Insurance', y.ni) +
        (y.sl > 0 ? row('Student Loan', y.sl) : '') +
        row('Take-home', y.net) +
        // Paid-but-empty payslips are NAMED (v18.42 — review item 2) so "N of M" is actionable.
        (y.missing.length ? `<div class="yearso-proj">Not entered yet: ${fdList(y.missing)}.</div>` : '') +
        // The projection is deliberately labelled rough — it assumes the rest of the year looks
        // like the entered payslips (premiums vary period to period).
        `<div class="yearso-proj">If the rest of ${ty.label} looks similar: take-home ≈ <strong>${fmt(y.projectedNet)}</strong> for the year (rough — based on your entered payslips).</div>` +
        (y.skipped ? `<div class="yearso-proj pay-skip-warn">⚠️ Couldn't read ${y.skipped} saved payslip${y.skipped > 1 ? 's' : ''}, so these totals may be too low.</div>` : '');
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
      // Max-height from the actual rendered height so a long back-pay breakdown (many periods,
      // large text/zoom) is never clipped by the fixed CSS `.bd-body.open` cap; cleared on close
      // so the CSS collapse animates shut. (Arrow rotation is CSS — .bd-btn.open .bd-arrow.)
      _toggleDisclosure('bpBreakdownBtn', 'backPayRows', {
        onToggle: (open, body) => { body.style.maxHeight = open ? `${body.scrollHeight}px` : ''; },
      });
    }

    // (applyNewRate removed v17.90 — the Settings hourly rate is now grade-fixed + auto-derived, so
    // there was nothing to push into settings; the button it drove was already permanently hidden.)

    // ── DISCLOSURE TOGGLES (one core; v18.46 — sweep item 11) ─────────────────────
    // The page's four button+panel disclosures shared the same 5-line open/close core, each
    // hand-rolled (and loadPeriodData carried a fifth inline copy of the arrow strings). ONE
    // helper now owns the core; per-toggle differences (arrow glyph, label swap, measured
    // max-height) ride the options. The disclaimer's More/Less inline-span toggle keeps its own
    // 3-line shape — it has no panel/arrow, so the helper would fit it worse than it helps.
    /**
     * Set a disclosure button + body to a SPECIFIC open state, keeping `aria-expanded` + the arrow
     * glyph in step. Shared by the click toggle AND the programmatic auto-open in loadPeriodData —
     * the latter used to add `.open` directly, leaving the button's `aria-expanded="false"` stale
     * (a screen reader heard "collapsed" on an expanded disclosure). Idempotent.
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

    // Hours show-more: label CONSTANT — only the arrow flips (v18.45, sweep item 6).
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
      el.textContent = String(Math.max(0, Math.min(10, +(/** @type {HTMLElement} */ (document.getElementById('peerVal'))).textContent + delta)));
      autosave();
    }

    // ── BREAKDOWN TOGGLE ──────────────────────────────────────────────────────────
    function toggleBD() { _toggleDisclosure('bdBtn', 'bdBody'); }   // arrow rotation is CSS

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

    // (The old fillGradeRateHint JS builder is gone — it existed to interpolate the grade RATES
    // into the hint, which duplicated the read-only rate field directly below; the static HTML
    // hint now carries the one-line version. v18.03)

    // Loan-repaid cutover options (v18.41 — review item 9): one option per visible payslip,
    // grouped by tax year, date-first. Built BEFORE loadSettings so the saved p.num restores.
    (function _buildSlPaidOffOptions() {
      const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('slPaidOffFrom'));
      if (!sel) return;
      let group = null; let groupLabel = '';
      for (const p of visiblePeriods()) {
        const ty = taxYearForPeriod(p);
        if (ty.label !== groupLabel) {
          groupLabel = ty.label;
          group = document.createElement('optgroup');
          group.label = ty.label;
          sel.appendChild(group);
        }
        const o = document.createElement('option');
        o.value = String(p.num);
        o.textContent = `Paid ${fdLong(p.payday)} · P${payslipPeriodNum(p)}`;   // full-year date — the list spans tax years
        (group || sel).appendChild(o);
      }
    })();

    loadSettings();
    // _defaultPeriodNum must be assigned BEFORE onPeriodChange() runs — the period
    // button visibility check is `pNum === _defaultPeriodNum`. buildPeriodSelect()
    // returns the default period number; we then call onPeriodChange() explicitly so
    // the button is correctly hidden on the initial load (not shown as if off-default).
    _defaultPeriodNum = buildPeriodSelect();
    onPeriodChange();
    // THE PAGE IS USABLE FROM HERE (v21.71). onPeriodChange restores the viewed payslip's saved
    // hours and runs calculate(), so this is the first moment the result card holds a real figure
    // rather than a placeholder — which is what a member means by the calculator being ready.
    //
    // It was absent until now, and this page of all of them: the App Speed card's "usable"
    // milestone is recorded only by pages that call this, so the page doing the MOST work before
    // it is usable (restore, resolve the period, calculate) was the one contributing nothing to
    // the figure. Anything felt as "the calculator is slow" was invisible in the measurement.
    markPageReady();

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
    // Payslip self-check figure (v18.42) — persists with the period like every other field;
    // autosave() recalculates, which re-renders the verdict.
    document.getElementById('actualNetInput')?.addEventListener('input', autosave);

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

    // HPP amount-source toggle + manual inputs (v18.32): flip the mode → show/hide the matching field
    // group, persist the choice for the viewed tax year, and recompute (calculate() → calcHPP reads
    // the mode and writes the resulting figure to hppEstKey, so the January take-home add is unchanged).
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

    // Back-pay inputs + period selectors + apply rate
    /** @type {HTMLElement} */ (document.getElementById('bpBreakdownBtn')).addEventListener('click', toggleBpBreakdown);
    /** @type {HTMLElement} */ (document.getElementById('backPayPeriod')).addEventListener('change', _runCalcBackPay);
    /** @type {HTMLElement} */ (document.getElementById('bpIncludeTick')).addEventListener('change', _runCalcBackPay);
    /** @type {HTMLElement} */ (document.getElementById('saveSettingsBtn')).addEventListener('click', () => confirmSettings(calculate));

    // Hours card — show more toggle
    /** @type {HTMLElement} */ (document.getElementById('hoursShowMore')).addEventListener('click', toggleHoursExtra);

    // (The Hours-header "result peek" button was removed at v16.78 — the #stickyTotal bar
    //  below carries the same live figure and the same tap-to-scroll to the result card.)

    // Sticky take-home bar — its own module since v21.89. Every guard in it is the fix to a
    // reported iOS behaviour that cannot be reproduced headless; the reasoning lives beside
    // the code, in paycalc-sticky-total.js.
    initPaycalcStickyTotal();

    // Roster fill — "Fill blank fields" button + per-category "Fill →" buttons.
    // wireIosTap, not a bare click listener (v21.66): tapped with the soft keyboard up — the
    // normal state on a form you type hours into — iOS cancels the click when the keyboard
    // dismisses, so "Replace with calendar values" silently did nothing (staff-reported as
    // "doesn't always work on iOS"). Same measured failure as the ± sign button below, which
    // now shares the one guarded implementation.
    const _fillBtn = document.getElementById('fillFromRosterBtn');
    if (_fillBtn) wireIosTap(_fillBtn, () => fillFromRoster(autosave));

    // Per-category fill buttons are dynamically rendered inside #rosterRows — delegation on the
    // container (which survives re-renders), through the same iOS tap guard.
    const _rosterRows = document.getElementById('rosterRows');
    if (_rosterRows) wireIosTap(_rosterRows, e => {
      const _eTarget = /** @type {Element} */ (e.target);
      const catBtn = _eTarget.closest('[data-cat]');
      if (catBtn) { fillCategoryFromRoster(/** @type {HTMLElement} */ (catBtn).dataset.cat || '', autosave); return; }
      if (_eTarget.closest('[data-action="focus-ot"]')) {
        const el = document.getElementById('otH');
        if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }
    });   // (closes the wireIosTap action)

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
      if (_pa && penUntouched) _pa.value = periodDefaultPension(_gP).toFixed(2);
      // Recompute the back-pay card for the NEW grade (review finding): its saved blob was built with
      // the old grade's award rates, and without this the stale lump persisted in read-only boxes with
      // no repair path. calcBackPay re-enforces the authoritative AWARD_RATES for the current grade
      // (and _saveBpState persists the corrected figures); _applyBpState triggers calculate() itself
      // if the lump changed, so the calculate() below stays for the pension/rate updates.
      _runCalcBackPay();
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
    // Loan-repaid cutover (v18.41) — a SETTING: persist + recompute so the viewed payslip's SL
    // reflects the new cutover immediately.
    document.getElementById('slPaidOffFrom')?.addEventListener('change', () => { saveSettings(); calculate(); });
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
    // The pension card's two controls are wired by the module that owns the card's rules
    // (v21.78) — the coordinator supplies only what it alone knows: this payslip's default, and
    // how to persist it. Keeping the wiring beside `buildPensionFromSelect`/`applyPensionOptOutUI`
    // is what stops the tick, the date and the field falling out of step with one another.
    wirePensionControls({ autosave });

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
      // The shared guarded implementation (paycalc-inputs.js, v21.66) — this button is where the
      // cancelled-click failure was first measured; the movement gate it gains is a strict
      // improvement (a scroll flick ending here no longer toggles the sign).
      const btn = /** @type {HTMLElement} */ (document.getElementById('adjSignBtn'));
      wireIosTap(btn, toggleAdjSign);
    })();

    // Payslip card inputs
    // YTD figures: auto-stamp the source payslip on first entry (defaults to the latest paid
    // payslip — where the totals almost always come from), then persist + recalc. The select
    // lets the member correct it if they copied from an older payslip. (v17.98)
    const _ytdFigureInput = () => {
      saveSettings();
      const _p2  = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
      const _ty2 = taxYearForPeriod(_p2);
      if (!lsGet(ytdSrcKey(_ty2))) _refreshYtdSrc(_ty2, _p2); else _updateYtdNote(_ty2, _p2, parseInt(lsGet(ytdSrcKey(_ty2)) ?? '', 10) || 0);
      calculate();
    };
    /** @type {HTMLElement} */ (document.getElementById('ytdPay')).addEventListener('input', _ytdFigureInput);
    /** @type {HTMLElement} */ (document.getElementById('ytdTax')).addEventListener('input', _ytdFigureInput);
    /** @type {HTMLElement} */ (document.getElementById('ytdSrcSelect')).addEventListener('change', () => {
      const _p2  = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
      const _ty2 = taxYearForPeriod(_p2);
      const _v = /** @type {HTMLSelectElement} */ (document.getElementById('ytdSrcSelect')).value;
      // Selecting the blank placeholder un-anchors the figures: record an explicit '0' source so
      // calculate() drops back to the standard (non-cumulative) method — matching the note it now
      // shows — and the un-anchor PERSISTS. (v18.08 deleted the key, which the legacy auto-stamp in
      // _refreshYtdSrc then silently re-anchored on the next period change because the figures remain;
      // '0' is a recorded value the stamp leaves alone — v18.12.)
      if (_v) lsSet(ytdSrcKey(_ty2), _v); else lsSet(ytdSrcKey(_ty2), '0');
      _updateYtdNote(_ty2, _p2, parseInt(_v, 10) || 0);
      calculate();
    });

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
    const { openAboutLightbox, showYtdNotice } = initPaycalcLightboxes();

    // ── SW UPDATE AUTO-ACTIVATION ─────────────────────────────────────────────────
    // Handled by the shared registerServiceWorker() call below (see "SERVICE WORKER").
    // A hand-rolled duplicate of that lifecycle used to live here; it was removed at
    // v12.96 because running both registered two controllerchange listeners and two
    // hourly update() timers, which could fire the post-update reload twice.

    // ── SERVICE WORKER ────────────────────────────────────────────────────────────
    registerServiceWorker();

    // Establish the Firebase Auth session BEFORE starting error reporting. A valid
    // 60-day localStorage session can outlive the Firebase Auth session (cleared or
    // lost), in which case clientErrors writes fail the `request.auth != null` rule
    // and are silently dropped — exactly when we most want the report. Mirrors the
    // admin/settings/operations pages. Error reporter starts regardless of the
    // outcome so synchronous init errors are still captured locally.
    // Captured so the nav drawer's Circular/Newsletter read can wait for the session, like every
    // other page (AUTH_PLAN.md → E1). paycalc has no `sessionReady` — it is the one `soft` page and
    // owns its auth chain locally — so the settle promise is hoisted here instead. It always
    // RESOLVES (the .catch below swallows a failed sign-in), which is correct for a soft page: the
    // drawer read proceeds either way rather than hanging on an identity paycalc never requires.
    let _paycalcAuthSettled = Promise.resolve();
    (function _initErrorReporting() {
      const name = getSession()?.name;
      const afterAuth = () => {
        initErrorReporter(); recordUsage('paycalc', name ?? null); recordPageLatency('paycalc', name ?? null);
        // Forced set-password overlay (PASSWORD_PLAN.md Phase 2). No `ready` barrier is passed: this
        // callback ALREADY runs after ensureNamedSession has settled, so getAuthSnapshot() reflects the
        // terminal identity. That matters most here — paycalc is the one `soft` page, so a member can
        // reach this line locally signed in with a FAILED Firebase session, and the overlay's
        // `named`-only gate is what stops it showing a block they could never satisfy.
        // The YTD notice queues BEHIND this one. `initPasswordForce` has always returned whether
        // it showed the overlay, and its own JSDoc says the value exists for "the next overlay that
        // has to queue behind this one" — this is that overlay. Before v21.91 nothing awaited it, so
        // a notice about copying two figures off a payslip opened in front of a set-password block
        // the member could not dismiss until they had satisfied it.
        //
        // We do not branch on the result: if the overlay IS up, `openNoticeIfClear` sees it and
        // defers, leaving the notice unflagged for the next load. Awaiting is the whole fix — it
        // moves the YTD notice after the decision instead of racing it. `.catch` because a failed
        // password overlay must never cost the member their notice, and `initPasswordForce` fails
        // open by design.
        initPasswordForce(name, {}).catch(() => {}).finally(() => showYtdNotice());
      };
      // SOFT enforcement (B1.2), now decided via the policy (ARCHITECTURE_PLAN.md Phase 7): the pay
      // calculator is localStorage-based and writes no isolated data, so a degraded/anonymous session
      // must NEVER block it. requirePage('paycalc') honours that — being `soft`, it returns ONLY 'allow'
      // (named confirmed) or 'soft-allow' (Firebase identity unconfirmed), never 'login'/'forbidden'. We
      // only log when the requirement is on AND the store reports 'soft-allow' (the member's own session
      // wasn't confirmed) — equivalent to the old `!named`. The store is fed by the Phase-2 bridge inside
      // ensureNamedSession, so getAuthSnapshot() reflects the terminal identity here. (ROSTER_CONFIG is
      // roster-data's CONFIG, imported as ROSTER_CONFIG to avoid the paycalc-periods CONFIG clash.)
      if (name) _paycalcAuthSettled = ensureNamedSession(name)
          .then(() => { if (ROSTER_CONFIG.ENFORCE_NAMED_SESSION && requirePage(getAuthSnapshot(), 'paycalc').decision === 'soft-allow') console.warn('[Auth] paycalc running without a named session — error reporting may not record.'); })
          .catch(() => {/* reporter still starts below */})
          .finally(afterAuth);
      else afterAuth();
    }());

    // ── BACK UP YOUR PAY DATA ─────────────────────────────────────────────────────
    // Runs late: it reads the per-member namespace runMigrations() activated above.
    initTransferCard();

    // ── PRINT HEADER STAMP ────────────────────────────────────────────────────────
    // iOS Safari does not fire beforeprint when AirPrint is invoked, so we also stamp
    // eagerly on load. The beforeprint handler is kept for desktop browsers.
    // onPeriodChange() also calls this so the stamp is always current when printing.
    function stampPaycalcPrintLine() {
      const hdr = document.querySelector('.app-header');
      if (!hdr) return;
      const periodSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('periodSelect'));
      const p = periodSel ? getPeriods().find(/** @param {any} x */ x => x.num === +periodSel.value) : null;
      const now = fdLong(new Date());
      // "Pay Calculator", not "MYB Pay Calculator" (v20.13). The app's on-screen name is
      // "Marylebone Roster" and "MYB" is not used for it in staff-facing copy — and a print header
      // is the one place a stale product name is carried out of the app on paper.
      const label = p ? `Paid ${fd(p.payday)} (P${payslipPeriodNum(p)}) · Printed ${now}` : `Pay Calculator · Printed ${now}`;
      hdr.setAttribute('data-print-line', label);
    }
    stampPaycalcPrintLine();
    window.addEventListener('beforeprint', stampPaycalcPrintLine);

    // A LITERAL options object at every initNavPanel call, on purpose (v21.78). This was briefly
    // factored into a shared `_navConfig()` — page-contract-parity refused it at once, and rightly:
    // it brace-matches the options of each call to prove a role-gated pill is passed its gate from
    // EVERY page, and an indirected config is invisible to that. The duplication with
    // `_showUnsupportedRole` is the price of a guard that can still see what it is guarding.
    const _paycalcMember = getLoggedMember();
    initNavPanel({
        // Drawer Circular/Newsletter read waits for the session (AUTH_PLAN.md → E1).
        authReady: _paycalcAuthSettled,
        currentPage: 'paycalc',
        memberName:  _paycalcMember?.name || null,
        isAdmin:         ROSTER_CONFIG.ADMIN_NAMES.includes(_paycalcMember?.name ?? ''),
        isLinksDesigner: ROSTER_CONFIG.LINKS_DESIGNERS.includes(_paycalcMember?.name ?? ''),
        canOpenOvertime: canOpenOvertime(_paycalcMember?.name ?? ''),
        onLogoClick: () => openAboutLightbox?.(),
        onSignOut:   _paycalcMember ? () => {
            clearSession(); // clears localStorage AND signs out Firebase Auth
            window.location.href = './';
        } : null,
    });

    // (Lightbox print button is wired by about-lightbox.js — the standalone IIFE
    // that lived here before v12.50 only removed .open, leaving body scroll locked.)

}
